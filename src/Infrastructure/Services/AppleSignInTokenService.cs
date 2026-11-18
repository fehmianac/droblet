using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Infrastructure.Services.Purchases;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Services;

public interface IAppleSignInTokenService
{
    /// <summary>
    /// Sign in with Apple: exchanges the one-time authorizationCode for a refresh token and stores it (encrypted) on the
    /// Apple identity, so the account can be revoked at Apple when it is deleted. Best effort: never fails the sign-in.
    /// </summary>
    Task StoreFromAuthorizationCodeAsync(string subject, string authorizationCode, CancellationToken ct);

    /// <summary>Account deletion: revokes every stored Apple token of the user. Skipped (logged) while the key is CHANGE_ME.</summary>
    Task RevokeForUserAsync(string userId, CancellationToken ct);
}

/// <summary>
/// Apple token exchange (POST /auth/token) and revocation (POST /auth/revoke) — App Store guideline 5.1.1(v): an app that
/// offers Sign in with Apple must revoke the user's tokens when the account is deleted. The client secret is an ES256
/// JWT (iss = team 4LB4RD97A9, sub = client id = bundle id, aud = https://appleid.apple.com, kid = AppleAuth:KeyId)
/// signed with the .p8 key in SSM api/AppleAuth/PrivateKey. Tokens are never logged.
/// </summary>
public sealed class AppleSignInTokenService(
    HttpClient http,
    IRepository repository,
    IOptionsMonitor<AppleAuthOptions> options,
    IOptionsMonitor<JwtOptions> jwt,
    TimeProvider timeProvider,
    ILogger<AppleSignInTokenService> logger) : IAppleSignInTokenService
{
    public async Task StoreFromAuthorizationCodeAsync(string subject, string authorizationCode, CancellationToken ct)
    {
        var apple = options.CurrentValue;
        if (!apple.CanRevokeTokens)
        {
            logger.LogInformation("Apple token exchange skipped: AppleAuth key not configured");
            return;
        }

        try
        {
            using var response = await http.PostAsync(apple.TokenUrl, new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = apple.EffectiveClientId,
                ["client_secret"] = ClientSecret(apple, timeProvider.GetUtcNow()),
                ["code"] = authorizationCode,
                ["grant_type"] = "authorization_code",
            }), ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Apple token exchange answered {Status}", (int)response.StatusCode);
                return;
            }

            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var refreshToken = document.RootElement.TryGetProperty("refresh_token", out var r) ? r.GetString() : null;
            if (string.IsNullOrEmpty(refreshToken))
                return;

            var identity = await repository.GetAsync<AuthIdentityEntity>(AuthIdentityEntity.GetPk(), AuthIdentityEntity.GetSk(AuthProvider.Apple, subject), ct);
            if (identity is null)
                return;
            identity.AppleRefreshToken = AppleTokenProtector.Protect(refreshToken, apple, jwt.CurrentValue);
            await repository.SaveAsync(identity, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException or CryptographicException && !ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Apple token exchange failed");
        }
    }

    public async Task RevokeForUserAsync(string userId, CancellationToken ct)
    {
        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(userId), ct);
        if (user is null)
            return;
        var prefix = AuthIdentityEntity.GetSk(AuthProvider.Apple, "");
        foreach (var sk in user.Identities.Where(sk => sk.StartsWith(prefix, StringComparison.Ordinal)))
        {
            var identity = await repository.GetAsync<AuthIdentityEntity>(AuthIdentityEntity.GetPk(), sk, ct);
            if (identity?.AppleRefreshToken is not { Length: > 0 } stored)
            {
                logger.LogInformation("Apple identity of user {UserId} has no stored token to revoke", userId);
                continue;
            }
            await RevokeAsync(stored, ct);
        }
    }

    private async Task RevokeAsync(string stored, CancellationToken ct)
    {
        var apple = options.CurrentValue;
        if (!apple.CanRevokeTokens)
        {
            logger.LogWarning("Apple token revocation skipped: AppleAuth key not configured (deletion continues)");
            return;
        }

        var token = AppleTokenProtector.Unprotect(stored, apple, jwt.CurrentValue);
        if (token is null)
        {
            logger.LogWarning("Stored Apple token could not be decrypted (key changed?); deletion continues");
            return;
        }

        try
        {
            using var request = RevokeRequest(apple, token, timeProvider.GetUtcNow());
            using var response = await http.SendAsync(request, ct);
            if (response.IsSuccessStatusCode)
                logger.LogInformation("Apple token revoked");
            else
                logger.LogWarning("Apple token revocation answered {Status}; deletion continues", (int)response.StatusCode);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Apple token revocation failed; deletion continues");
        }
    }

    /// <summary>POST https://appleid.apple.com/auth/revoke — form: client_id, client_secret, token, token_type_hint.</summary>
    public static HttpRequestMessage RevokeRequest(AppleAuthOptions apple, string refreshToken, DateTimeOffset now) =>
        new(HttpMethod.Post, apple.RevokeUrl)
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = apple.EffectiveClientId,
                ["client_secret"] = ClientSecret(apple, now),
                ["token"] = refreshToken,
                ["token_type_hint"] = "refresh_token",
            }),
        };

    /// <summary>ES256 client secret (Apple: at most 6 months; 5 minutes here — it is minted per call).</summary>
    public static string ClientSecret(AppleAuthOptions apple, DateTimeOffset now)
    {
        using var ecdsa = ECDsa.Create();
        ecdsa.ImportFromPem(Pem.Normalize(apple.PrivateKey!));
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = apple.TeamId,
            Audience = AppleAuthOptions.Issuer,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = now.UtcDateTime.AddMinutes(5),
            Claims = new Dictionary<string, object> { ["sub"] = apple.EffectiveClientId },
            SigningCredentials = new SigningCredentials(
                new ECDsaSecurityKey(ecdsa) { KeyId = apple.KeyId, CryptoProviderFactory = new CryptoProviderFactory { CacheSignatureProviders = false } },
                SecurityAlgorithms.EcdsaSha256),
        });
    }
}

/// <summary>
/// AES-256-GCM for the stored Apple refresh token. Key: AppleAuth:TokenEncryptionKey (base64, 32 bytes; SSM SecureString
/// created by deploy-infra) — or, when that is not set, HKDF-SHA256 of Jwt:SecretKey. The prefix records which key
/// sealed the value ("k1." dedicated, "j1." JWT-derived) so a later switch still decrypts older rows.
/// </summary>
public static class AppleTokenProtector
{
    public static string Protect(string plaintext, AppleAuthOptions apple, JwtOptions jwt)
    {
        var (prefix, key) = ConfigSecret.IsSet(apple.TokenEncryptionKey) && TryDedicatedKey(apple.TokenEncryptionKey!, out var dedicated)
            ? ("k1", dedicated)
            : ("j1", JwtDerivedKey(jwt));
        var nonce = RandomNumberGenerator.GetBytes(12);
        var data = Encoding.UTF8.GetBytes(plaintext);
        var cipher = new byte[data.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(key, 16))
            aes.Encrypt(nonce, data, cipher, tag, Encoding.ASCII.GetBytes(prefix));
        return $"{prefix}.{Convert.ToBase64String([.. nonce, .. cipher, .. tag])}";
    }

    public static string? Unprotect(string stored, AppleAuthOptions apple, JwtOptions jwt)
    {
        var dot = stored.IndexOf('.');
        if (dot <= 0)
            return null;
        var prefix = stored[..dot];
        byte[]? key = prefix switch
        {
            "k1" when ConfigSecret.IsSet(apple.TokenEncryptionKey) && TryDedicatedKey(apple.TokenEncryptionKey!, out var k) => k,
            "j1" when !string.IsNullOrEmpty(jwt.SecretKey) => JwtDerivedKey(jwt),
            _ => null,
        };
        if (key is null)
            return null;
        try
        {
            var blob = Convert.FromBase64String(stored[(dot + 1)..]);
            if (blob.Length < 28)
                return null;
            var plain = new byte[blob.Length - 28];
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(blob.AsSpan(0, 12), blob.AsSpan(12, plain.Length), blob.AsSpan(12 + plain.Length), plain, Encoding.ASCII.GetBytes(prefix));
            return Encoding.UTF8.GetString(plain);
        }
        catch (Exception ex) when (ex is FormatException or CryptographicException)
        {
            return null;
        }
    }

    private static bool TryDedicatedKey(string value, out byte[] key)
    {
        try
        {
            key = Convert.FromBase64String(value.Trim());
            return key.Length == 32;
        }
        catch (FormatException)
        {
            key = [];
            return false;
        }
    }

    private static byte[] JwtDerivedKey(JwtOptions jwt) =>
        HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(jwt.SecretKey), 32, info: Encoding.ASCII.GetBytes("droblet-apple-refresh-token"));
}
