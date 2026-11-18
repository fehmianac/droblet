using System.Security.Claims;
using Domain.Extensions;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Services.Providers;

/// <summary>Validates a provider id token against the provider's JWKS (OIDC discovery, cached and refreshed on key rotation).</summary>
public sealed class OidcTokenValidator(IConfigurationManager<OpenIdConnectConfiguration> configurationManager, TimeProvider timeProvider)
{
    private readonly JsonWebTokenHandler _handler = new() { MapInboundClaims = false };

    public async Task<ClaimsIdentity?> ValidateAsync(string token, IEnumerable<string> issuers, IReadOnlyList<string> audiences, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var configuration = await configurationManager.GetConfigurationAsync(ct);
            var result = await _handler.ValidateTokenAsync(token, new TokenValidationParameters
            {
                ValidIssuers = issuers,
                ValidAudiences = audiences,
                IssuerSigningKeys = configuration.SigningKeys,
                ValidateIssuerSigningKey = true,
                RequireSignedTokens = true,
                RequireExpirationTime = true,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromMinutes(2),
                LifetimeValidator = (notBefore, expires, _, p) =>
                {
                    var now = timeProvider.GetUtcNow().UtcDateTime;
                    return (notBefore is null || notBefore <= now.Add(p.ClockSkew)) && expires is not null && expires > now.Subtract(p.ClockSkew);
                },
                ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            });

            if (result.IsValid)
                return result.ClaimsIdentity;

            // Provider rotated its keys since we cached them: refresh once and retry.
            if (attempt == 0 && result.Exception is SecurityTokenSignatureKeyNotFoundException)
            {
                configurationManager.RequestRefresh();
                continue;
            }
            return null;
        }
        return null;
    }

    public static ConfigurationManager<OpenIdConnectConfiguration> ForMetadata(string metadataAddress) =>
        new(metadataAddress, new OpenIdConnectConfigurationRetriever(), new HttpDocumentRetriever { RequireHttps = true });

    internal static bool ClaimIsTrue(ClaimsIdentity identity, string type) =>
        identity.FindFirst(type)?.Value is { } v && bool.TryParse(v, out var b) && b;
}

public sealed class AppleIdentityVerifier(
    OidcTokenValidator validator,
    IOptionsMonitor<AppleAuthOptions> options,
    ILogger<AppleIdentityVerifier> logger) : IAppleIdentityVerifier
{
    public async Task<ExternalIdentity?> VerifyAsync(string identityToken, string nonce, CancellationToken ct)
    {
        var audiences = options.CurrentValue.Audiences();
        if (audiences.Count == 0)
            throw new ProviderNotConfiguredException("apple");

        var identity = await validator.ValidateAsync(identityToken, [AppleAuthOptions.Issuer], audiences, ct);
        if (identity is null)
        {
            logger.LogInformation("Apple identity token rejected");
            return null;
        }

        // The app may send the raw nonce or its SHA-256 (what native Sign in with Apple puts in the token).
        var tokenNonce = identity.FindFirst("nonce")?.Value;
        if (string.IsNullOrEmpty(tokenNonce) || (tokenNonce != nonce && tokenNonce != nonce.Sha256Hex()))
        {
            logger.LogInformation("Apple identity token nonce mismatch");
            return null;
        }

        var subject = identity.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(subject))
            return null;

        return new ExternalIdentity(subject, identity.FindFirst("email")?.Value, OidcTokenValidator.ClaimIsTrue(identity, "email_verified"));
    }
}

public sealed class GoogleIdentityVerifier(
    OidcTokenValidator validator,
    IOptionsMonitor<GoogleAuthOptions> options,
    ILogger<GoogleIdentityVerifier> logger) : IGoogleIdentityVerifier
{
    public async Task<ExternalIdentity?> VerifyAsync(string idToken, CancellationToken ct)
    {
        var audiences = options.CurrentValue.Audiences();
        if (audiences.Count == 0)
            throw new ProviderNotConfiguredException("google");

        var identity = await validator.ValidateAsync(idToken, GoogleAuthOptions.Issuers, audiences, ct);
        if (identity is null)
        {
            logger.LogInformation("Google id token rejected");
            return null;
        }

        var subject = identity.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(subject))
            return null;

        return new ExternalIdentity(subject, identity.FindFirst("email")?.Value, OidcTokenValidator.ClaimIsTrue(identity, "email_verified"));
    }
}
