using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using Domain.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Services.Purchases;

public interface IGooglePlayDeveloperApi
{
    bool IsConfigured { get; }
    /// <summary>purchases.subscriptionsv2.get → SubscriptionPurchaseV2 JSON (null when the token is unknown).</summary>
    Task<JsonDocument?> GetSubscriptionAsync(string purchaseToken, CancellationToken ct);
    /// <summary>purchases.products.get → ProductPurchase JSON (null when unknown).</summary>
    Task<JsonDocument?> GetProductAsync(string productId, string purchaseToken, CancellationToken ct);
    Task<bool> AcknowledgeSubscriptionAsync(string productId, string purchaseToken, CancellationToken ct);
    Task<bool> ConsumeProductAsync(string productId, string purchaseToken, CancellationToken ct);
}

/// <summary>
/// Google Play Developer API (androidpublisher v3) over plain HTTPS with the service account in SSM SecureString
/// api/Store/GooglePlayServiceAccountJson (the key file as downloaded). The account needs "View financial data" and
/// "Manage orders and subscriptions" in Play Console. Not configured → IsConfigured false, every call returns null/false.
/// </summary>
public sealed class GooglePlayDeveloperApi(HttpClient http, IOptionsMonitor<StoreOptions> options, TimeProvider timeProvider, ILogger<GooglePlayDeveloperApi> logger) : IGooglePlayDeveloperApi
{
    private const string Scope = "https://www.googleapis.com/auth/androidpublisher";
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string? _accessToken;
    private DateTimeOffset _accessTokenExpiresAt;

    public bool IsConfigured => options.CurrentValue.HasGooglePlayApi;

    private string Base(StoreOptions store) =>
        $"{store.GooglePlayApiUrl.TrimEnd('/')}/androidpublisher/v3/applications/{Uri.EscapeDataString(store.AndroidPackage)}/purchases";

    public Task<JsonDocument?> GetSubscriptionAsync(string purchaseToken, CancellationToken ct) =>
        GetAsync(store => $"{Base(store)}/subscriptionsv2/tokens/{Uri.EscapeDataString(purchaseToken)}", ct);

    public Task<JsonDocument?> GetProductAsync(string productId, string purchaseToken, CancellationToken ct) =>
        GetAsync(store => $"{Base(store)}/products/{Uri.EscapeDataString(productId)}/tokens/{Uri.EscapeDataString(purchaseToken)}", ct);

    public Task<bool> AcknowledgeSubscriptionAsync(string productId, string purchaseToken, CancellationToken ct) =>
        PostAsync(store => $"{Base(store)}/subscriptions/{Uri.EscapeDataString(productId)}/tokens/{Uri.EscapeDataString(purchaseToken)}:acknowledge", ct);

    public Task<bool> ConsumeProductAsync(string productId, string purchaseToken, CancellationToken ct) =>
        PostAsync(store => $"{Base(store)}/products/{Uri.EscapeDataString(productId)}/tokens/{Uri.EscapeDataString(purchaseToken)}:consume", ct);

    private async Task<JsonDocument?> GetAsync(Func<StoreOptions, string> url, CancellationToken ct)
    {
        var store = options.CurrentValue;
        if (!store.HasGooglePlayApi)
            return null;
        using var request = new HttpRequestMessage(HttpMethod.Get, url(store));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await AccessTokenAsync(store.GooglePlay, ct));
        using var response = await http.SendAsync(request, ct);
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone or HttpStatusCode.BadRequest)
            return null;
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("Play Developer API answered {Status}", (int)response.StatusCode);
            throw new HttpRequestException($"Play Developer API answered {(int)response.StatusCode}.");
        }
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
    }

    private async Task<bool> PostAsync(Func<StoreOptions, string> url, CancellationToken ct)
    {
        var store = options.CurrentValue;
        if (!store.HasGooglePlayApi)
            return false;
        using var request = new HttpRequestMessage(HttpMethod.Post, url(store)) { Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json") };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await AccessTokenAsync(store.GooglePlay, ct));
        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
            logger.LogWarning("Play Developer API acknowledge/consume answered {Status}", (int)response.StatusCode);
        return response.IsSuccessStatusCode;
    }

    private async Task<string> AccessTokenAsync(GoogleServiceAccount account, CancellationToken ct)
    {
        var now = timeProvider.GetUtcNow();
        if (_accessToken is not null && now < _accessTokenExpiresAt)
            return _accessToken;

        await _gate.WaitAsync(ct);
        try
        {
            if (_accessToken is not null && now < _accessTokenExpiresAt)
                return _accessToken;

            using var rsa = RSA.Create();
            rsa.ImportFromPem(account.PrivateKey!.Replace("\\n", "\n", StringComparison.Ordinal));
            var assertion = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
            {
                Issuer = account.ClientEmail,
                Audience = account.TokenUri,
                IssuedAt = now.UtcDateTime,
                NotBefore = now.UtcDateTime,
                Expires = now.UtcDateTime.AddMinutes(60),
                Claims = new Dictionary<string, object> { ["scope"] = Scope },
                SigningCredentials = new SigningCredentials(new RsaSecurityKey(rsa) { CryptoProviderFactory = new CryptoProviderFactory { CacheSignatureProviders = false } }, SecurityAlgorithms.RsaSha256),
            });

            using var response = await http.PostAsync(account.TokenUri, new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:jwt-bearer",
                ["assertion"] = assertion,
            }), ct);
            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"Google token endpoint answered {(int)response.StatusCode}.");

            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            _accessToken = document.RootElement.GetProperty("access_token").GetString() ?? throw new JsonException("access_token missing.");
            var expiresIn = document.RootElement.TryGetProperty("expires_in", out var e) && e.TryGetInt32(out var seconds) ? seconds : 3600;
            _accessTokenExpiresAt = now.AddSeconds(Math.Max(60, expiresIn - 120));
            return _accessToken;
        }
        finally
        {
            _gate.Release();
        }
    }
}

/// <summary>
/// Binds Store:GooglePlayServiceAccountJson into StoreOptions.GooglePlay. Shapes that reach us: CHANGE_ME / empty
/// (not configured), the key file as ONE JSON string (env var / user secrets), or flattened child keys
/// (Store:GooglePlayServiceAccountJson:client_email …) — what the SSM loader produces from a JSON parameter value.
/// </summary>
public static class GoogleServiceAccountBinder
{
    public const string JsonKey = "Store:GooglePlayServiceAccountJson";

    public static void Bind(IConfiguration configuration, GoogleServiceAccount target)
    {
        var section = configuration.GetSection(JsonKey);
        Func<string, string?> read;
        if (ConfigSecret.IsSet(section.Value))
        {
            try
            {
                using var document = JsonDocument.Parse(section.Value!);
                var values = document.RootElement.ValueKind == JsonValueKind.Object
                    ? document.RootElement.EnumerateObject().Where(p => p.Value.ValueKind == JsonValueKind.String).ToDictionary(p => p.Name, p => p.Value.GetString())
                    : [];
                read = key => values.GetValueOrDefault(key);
            }
            catch (JsonException)
            {
                return;
            }
        }
        else
        {
            read = key => section[key];
        }

        target.ClientEmail = ConfigSecret.OrNull(read("client_email"));
        target.PrivateKey = ConfigSecret.OrNull(read("private_key"));
        target.TokenUri = ConfigSecret.OrNull(read("token_uri")) ?? target.TokenUri;
    }
}
