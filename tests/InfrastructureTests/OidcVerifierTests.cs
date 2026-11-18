using System.Security.Cryptography;
using Domain.Extensions;
using Domain.Options;
using Domain.Services;
using Infrastructure.Services.Providers;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace InfrastructureTests;

public class OidcVerifierTests
{
    private const string BundleId = "com.alatech.droplet";
    private readonly RsaSecurityKey _key = new(RSA.Create(2048)) { KeyId = "kid-1" };
    private readonly RsaSecurityKey _otherKey = new(RSA.Create(2048)) { KeyId = "kid-1" };

    private OidcTokenValidator Validator()
    {
        var config = new OpenIdConnectConfiguration();
        config.SigningKeys.Add(_key);
        return new OidcTokenValidator(new StaticConfigurationManager<OpenIdConnectConfiguration>(config), TimeProvider.System);
    }

    private static string Token(SecurityKey key, string issuer, string audience, Dictionary<string, object> claims, DateTime? expires = null) =>
        new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            Expires = expires ?? DateTime.UtcNow.AddMinutes(5),
            NotBefore = DateTime.UtcNow.AddMinutes(-10),
            IssuedAt = DateTime.UtcNow.AddMinutes(-10),
            Claims = claims,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.RsaSha256),
        });

    private AppleIdentityVerifier Apple(string bundle = BundleId) =>
        new(Validator(), Fixtures.Monitor(new AppleAuthOptions { BundleId = bundle }), NullLogger<AppleIdentityVerifier>.Instance);

    private GoogleIdentityVerifier Google(params string[] clientIds) =>
        new(Validator(), Fixtures.Monitor(new GoogleAuthOptions { ClientIds = clientIds.ToList() }), NullLogger<GoogleIdentityVerifier>.Instance);

    private static Dictionary<string, object> AppleClaims(string nonce) => new()
    {
        ["sub"] = "001234.apple",
        ["email"] = "a@privaterelay.appleid.com",
        ["email_verified"] = "true",
        ["nonce"] = nonce,
    };

    [Fact]
    public async Task Apple_ValidToken_ReturnsIdentity()
    {
        var token = Token(_key, AppleAuthOptions.Issuer, BundleId, AppleClaims("raw-nonce"));

        var identity = await Apple().VerifyAsync(token, "raw-nonce", default);

        Assert.NotNull(identity);
        Assert.Equal("001234.apple", identity.Subject);
        Assert.True(identity.EmailVerified);
    }

    [Fact]
    public async Task Apple_TokenCarriesHashedNonce_Accepted()
    {
        var token = Token(_key, AppleAuthOptions.Issuer, BundleId, AppleClaims("raw-nonce".Sha256Hex()));

        Assert.NotNull(await Apple().VerifyAsync(token, "raw-nonce", default));
    }

    [Fact]
    public async Task Apple_NonceMismatch_Rejected()
    {
        var token = Token(_key, AppleAuthOptions.Issuer, BundleId, AppleClaims("other"));

        Assert.Null(await Apple().VerifyAsync(token, "raw-nonce", default));
    }

    [Fact]
    public async Task Apple_WrongAudience_Rejected()
    {
        var token = Token(_key, AppleAuthOptions.Issuer, "com.someone.else", AppleClaims("n"));

        Assert.Null(await Apple().VerifyAsync(token, "n", default));
    }

    [Fact]
    public async Task Apple_WrongIssuer_Rejected()
    {
        var token = Token(_key, "https://evil.example", BundleId, AppleClaims("n"));

        Assert.Null(await Apple().VerifyAsync(token, "n", default));
    }

    [Fact]
    public async Task Apple_SignedWithUnknownKey_Rejected()
    {
        var token = Token(_otherKey, AppleAuthOptions.Issuer, BundleId, AppleClaims("n"));

        Assert.Null(await Apple().VerifyAsync(token, "n", default));
    }

    [Fact]
    public async Task Apple_Expired_Rejected()
    {
        var token = Token(_key, AppleAuthOptions.Issuer, BundleId, AppleClaims("n"), expires: DateTime.UtcNow.AddMinutes(-5));

        Assert.Null(await Apple().VerifyAsync(token, "n", default));
    }

    [Fact]
    public async Task Apple_NotConfigured_Throws()
    {
        await Assert.ThrowsAsync<ProviderNotConfiguredException>(() => Apple(bundle: "").VerifyAsync("x", "n", default));
    }

    [Fact]
    public async Task Google_ValidTokenForAnyConfiguredClient_ReturnsIdentity()
    {
        var token = Token(_key, "https://accounts.google.com", "android-client", new Dictionary<string, object>
        {
            ["sub"] = "google-123", ["email"] = "a@gmail.com", ["email_verified"] = true,
        });

        var identity = await Google("ios-client", "android-client").VerifyAsync(token, default);

        Assert.Equal("google-123", identity?.Subject);
        Assert.True(identity?.EmailVerified);
    }

    [Fact]
    public async Task Google_UnknownClientId_Rejected()
    {
        var token = Token(_key, "accounts.google.com", "someone-else", new Dictionary<string, object> { ["sub"] = "g" });

        Assert.Null(await Google("ios-client").VerifyAsync(token, default));
    }

    [Fact]
    public async Task Google_NotConfigured_Throws()
    {
        await Assert.ThrowsAsync<ProviderNotConfiguredException>(() => Google().VerifyAsync("x", default));
    }
}
