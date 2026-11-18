using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Services.Purchases;

public sealed record AppleSubscriptionStatus(string SignedTransactionInfo, string? SignedRenewalInfo, int Status);

public interface IAppStoreServerApi
{
    bool IsConfigured { get; }
    /// <summary>GET /inApps/v1/transactions/{transactionId} → signedTransactionInfo (null when unknown).</summary>
    Task<string?> GetTransactionAsync(string transactionId, string? environment, CancellationToken ct);
    /// <summary>GET /inApps/v1/subscriptions/{transactionId} → the latest transaction + renewal info of the chain.</summary>
    Task<AppleSubscriptionStatus?> GetSubscriptionStatusAsync(string originalTransactionId, string? environment, CancellationToken ct);
}

/// <summary>
/// App Store Server API without an SDK: an ES256 JWT signed with the In-App Purchase key (SSM api/Store/IapPrivateKey,
/// key id Store:IapKeyId, issuer Store:IssuerId; aud appstoreconnect-v1, bid = bundle id, 20 min lifetime). Production
/// is tried first, then sandbox on 404 (Apple's recommendation), unless the environment is already known.
/// Not configured (any value empty / CHANGE_ME) → IsConfigured false and every call returns null.
/// </summary>
public sealed class AppStoreServerApi(HttpClient http, IOptionsMonitor<StoreOptions> options, TimeProvider timeProvider, ILogger<AppStoreServerApi> logger) : IAppStoreServerApi
{
    private readonly object _gate = new();
    private string? _token;
    private DateTimeOffset _tokenExpiresAt;

    public bool IsConfigured => options.CurrentValue.HasAppStoreServerApi;

    public async Task<string?> GetTransactionAsync(string transactionId, string? environment, CancellationToken ct)
    {
        using var document = await GetAsync($"/inApps/v1/transactions/{Uri.EscapeDataString(transactionId)}", environment, ct);
        return document is null ? null : StoreRules.Str(document.RootElement, "signedTransactionInfo");
    }

    public async Task<AppleSubscriptionStatus?> GetSubscriptionStatusAsync(string originalTransactionId, string? environment, CancellationToken ct)
    {
        using var document = await GetAsync($"/inApps/v1/subscriptions/{Uri.EscapeDataString(originalTransactionId)}", environment, ct);
        if (document is null || !document.RootElement.TryGetProperty("data", out var groups) || groups.ValueKind != JsonValueKind.Array)
            return null;

        foreach (var group in groups.EnumerateArray())
        {
            if (!group.TryGetProperty("lastTransactions", out var last) || last.ValueKind != JsonValueKind.Array)
                continue;
            foreach (var item in last.EnumerateArray())
            {
                if (StoreRules.Str(item, "originalTransactionId") != originalTransactionId)
                    continue;
                var signed = StoreRules.Str(item, "signedTransactionInfo");
                if (signed is not null)
                    return new AppleSubscriptionStatus(signed, StoreRules.Str(item, "signedRenewalInfo"), StoreRules.Int(item, "status") ?? 0);
            }
        }
        return null;
    }

    private async Task<JsonDocument?> GetAsync(string path, string? environment, CancellationToken ct)
    {
        var store = options.CurrentValue;
        if (!store.HasAppStoreServerApi)
            return null;

        var bases = environment switch
        {
            StoreRules.SandboxEnvironment => new[] { store.AppStoreServerApiSandboxUrl },
            StoreRules.ProductionEnvironment => [store.AppStoreServerApiUrl],
            _ => [store.AppStoreServerApiUrl, store.AppStoreServerApiSandboxUrl],
        };

        foreach (var baseUrl in bases)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl.TrimEnd('/')}{path}");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token(store));
            using var response = await http.SendAsync(request, ct);
            if (response.StatusCode == HttpStatusCode.NotFound)
                continue;
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("App Store Server API answered {Status}", (int)response.StatusCode);
                return null;
            }
            return JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        }
        return null;
    }

    /// <summary>The bearer token (cached ~15 min). Public for the composition test.</summary>
    public string Token(StoreOptions store)
    {
        var now = timeProvider.GetUtcNow();
        lock (_gate)
        {
            if (_token is not null && now < _tokenExpiresAt)
                return _token;

            _token = CreateToken(store, now);
            _tokenExpiresAt = now.AddMinutes(15);
            return _token;
        }
    }

    public static string CreateToken(StoreOptions store, DateTimeOffset now)
    {
        using var ecdsa = ECDsa.Create();
        ecdsa.ImportFromPem(Pem.Normalize(store.IapPrivateKey!));
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = store.IssuerId,
            Audience = "appstoreconnect-v1",
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = now.UtcDateTime.AddMinutes(20),
            Claims = new Dictionary<string, object> { ["bid"] = store.BundleId },
            SigningCredentials = new SigningCredentials(
                new ECDsaSecurityKey(ecdsa) { KeyId = store.IapKeyId, CryptoProviderFactory = new CryptoProviderFactory { CacheSignatureProviders = false } },
                SecurityAlgorithms.EcdsaSha256),
        });
    }
}

/// <summary>.p8 / PEM values pasted into SSM sometimes arrive with literal "\n" or without line breaks.</summary>
public static class Pem
{
    public static string Normalize(string value)
    {
        var pem = value.Trim().Replace("\\n", "\n", StringComparison.Ordinal);
        if (pem.Contains("-----BEGIN", StringComparison.Ordinal))
            return pem;
        // Bare base64 body (no armour): wrap it as PKCS#8.
        return $"-----BEGIN PRIVATE KEY-----\n{pem}\n-----END PRIVATE KEY-----";
    }
}
