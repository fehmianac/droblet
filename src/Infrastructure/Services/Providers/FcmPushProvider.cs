using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Services.Providers;

/// <summary>
/// Firebase Cloud Messaging HTTP v1 without the Firebase SDK (README §9.2: no third-party SDKs): a service-account
/// JWT is exchanged for an OAuth access token, then messages:send is called. iOS goes through APNs via FCM.
/// Without a configured service account every send answers NotConfigured. Tokens are never logged.
/// </summary>
public sealed class FcmPushProvider(
    HttpClient http,
    IOptionsMonitor<FirebaseServiceAccountOptions> options,
    TimeProvider timeProvider,
    ILogger<FcmPushProvider> logger) : IPushProvider
{
    private const string Scope = "https://www.googleapis.com/auth/firebase.messaging";
    private readonly SemaphoreSlim _tokenGate = new(1, 1);
    private string? _accessToken;
    private DateTimeOffset _accessTokenExpiresAt;

    public async Task<PushResult> SendAsync(PushMessage message, CancellationToken ct)
    {
        var account = options.CurrentValue;
        if (!account.IsConfigured)
            return PushResult.NotConfigured;

        try
        {
            var accessToken = await AccessTokenAsync(account, ct);
            using var request = new HttpRequestMessage(HttpMethod.Post,
                $"{account.MessagingBaseUrl.TrimEnd('/')}/v1/projects/{Uri.EscapeDataString(account.ProjectId!)}/messages:send");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            request.Content = JsonContent.Create(new
            {
                message = new
                {
                    token = message.Token,
                    notification = new { title = message.Title, body = message.Body },
                    data = message.Data,
                },
            });

            using var response = await http.SendAsync(request, ct);
            if (response.IsSuccessStatusCode)
                return PushResult.Sent;

            var body = await response.Content.ReadAsStringAsync(ct);
            if (response.StatusCode == HttpStatusCode.NotFound || body.Contains("UNREGISTERED", StringComparison.Ordinal))
                return PushResult.Unregistered;

            logger.LogWarning("FCM send failed with status {Status}", (int)response.StatusCode);
            return PushResult.Failed;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "FCM send failed");
            return PushResult.Failed;
        }
    }

    private async Task<string> AccessTokenAsync(FirebaseServiceAccountOptions account, CancellationToken ct)
    {
        var now = timeProvider.GetUtcNow();
        if (_accessToken is not null && now < _accessTokenExpiresAt)
            return _accessToken;

        await _tokenGate.WaitAsync(ct);
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
                throw new HttpRequestException($"Token endpoint answered {(int)response.StatusCode}.");

            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            _accessToken = document.RootElement.GetProperty("access_token").GetString()
                           ?? throw new JsonException("access_token missing.");
            var expiresIn = document.RootElement.TryGetProperty("expires_in", out var e) && e.TryGetInt32(out var seconds) ? seconds : 3600;
            _accessTokenExpiresAt = now.AddSeconds(Math.Max(60, expiresIn - 120));
            return _accessToken;
        }
        finally
        {
            _tokenGate.Release();
        }
    }
}
