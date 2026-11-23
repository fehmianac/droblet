using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Infrastructure.Services.Purchases;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Services.Providers;

/// <summary>
/// Apple Push Notification service over HTTP/2 with token auth (.p8 key, no SDK). iOS registers its raw APNs device
/// token (expo-notifications getDevicePushTokenAsync), so iOS goes here and Android goes to FCM. Production first;
/// a token from a development build answers BadDeviceToken there and is retried on the sandbox host. Tokens never logged.
/// </summary>
public sealed class ApnsPushProvider(
    HttpClient http,
    IOptionsMonitor<ApnsOptions> options,
    TimeProvider timeProvider,
    ILogger<ApnsPushProvider> logger) : IPushProvider
{
    private readonly object _gate = new();
    private string? _jwt;
    private DateTimeOffset _jwtIssuedAt;

    public async Task<PushResult> SendAsync(PushMessage message, CancellationToken ct)
    {
        var apns = options.CurrentValue;
        if (!apns.IsConfigured)
            return PushResult.NotConfigured;

        try
        {
            var result = await SendToAsync(apns.ApnsProductionUrl, apns, message, ct);
            // The other environment: a development build's token, or an auth key Apple issued for the sandbox only
            // (403 BadEnvironmentKeyInToken on the production host).
            if (result is ApnsAnswer.BadDeviceToken or ApnsAnswer.BadEnvironmentKey)
            {
                var sandbox = await SendToAsync(apns.ApnsSandboxUrl, apns, message, ct);
                if (result == ApnsAnswer.BadEnvironmentKey && sandbox != ApnsAnswer.Sent)
                    logger.LogWarning("APNs key {KeyId} is not valid for the production environment and the sandbox did not accept the device: create a key for 'Sandbox & Production'", apns.ApnsKeyId);
                result = result == ApnsAnswer.BadEnvironmentKey && sandbox != ApnsAnswer.Sent ? ApnsAnswer.BadEnvironmentKey : sandbox;
            }
            return result switch
            {
                ApnsAnswer.Sent => PushResult.Sent,
                ApnsAnswer.Unregistered or ApnsAnswer.BadDeviceToken => PushResult.Unregistered,
                // A configuration problem, never the device's fault: its token must be kept.
                ApnsAnswer.BadEnvironmentKey => PushResult.Failed,
                _ => PushResult.Failed,
            };
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "APNs send failed");
            return PushResult.Failed;
        }
    }

    private enum ApnsAnswer { Sent, BadDeviceToken, Unregistered, BadEnvironmentKey, Failed }

    private async Task<ApnsAnswer> SendToAsync(string baseUrl, ApnsOptions apns, PushMessage message, CancellationToken ct)
    {
        using var request = Compose(baseUrl, apns, message, Token(apns));
        using var response = await http.SendAsync(request, ct);
        if (response.IsSuccessStatusCode)
            return ApnsAnswer.Sent;

        var reason = "";
        try
        {
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            reason = body.RootElement.TryGetProperty("reason", out var r) ? r.GetString() ?? "" : "";
        }
        catch (JsonException)
        {
        }

        if (response.StatusCode == HttpStatusCode.Gone || reason == "Unregistered")
            return ApnsAnswer.Unregistered;
        if (reason is "BadDeviceToken" or "DeviceTokenNotForTopic")
            return ApnsAnswer.BadDeviceToken;
        logger.LogWarning("APNs answered {Status} {Reason}", (int)response.StatusCode, reason);
        return reason == "BadEnvironmentKeyInToken" ? ApnsAnswer.BadEnvironmentKey : ApnsAnswer.Failed;
    }

    /// <summary>The APNs request (public for the composition test): POST /3/device/{token}, HTTP/2, alert push.</summary>
    public static HttpRequestMessage Compose(string baseUrl, ApnsOptions apns, PushMessage message, string providerToken)
    {
        var payload = new Dictionary<string, object>
        {
            ["aps"] = new Dictionary<string, object>
            {
                ["alert"] = new Dictionary<string, string> { ["title"] = message.Title, ["body"] = message.Body },
                ["sound"] = "default",
            },
        };
        // Custom keys sit next to "aps"; the app reads them as the notification's data (deep link).
        foreach (var (key, value) in message.Data)
            if (key != "aps")
                payload[key] = value;

        var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl.TrimEnd('/')}/3/device/{Uri.EscapeDataString(message.Token)}")
        {
            Version = HttpVersion.Version20,
            VersionPolicy = HttpVersionPolicy.RequestVersionExact,
            Content = JsonContent.Create(payload),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("bearer", providerToken);
        request.Headers.TryAddWithoutValidation("apns-topic", apns.ApnsTopic);
        request.Headers.TryAddWithoutValidation("apns-push-type", "alert");
        request.Headers.TryAddWithoutValidation("apns-priority", "10");
        return request;
    }

    /// <summary>Provider token: ES256 JWT (iss = team id, kid = key id), reused ~40 minutes (Apple: 20–60).</summary>
    private string Token(ApnsOptions apns)
    {
        var now = timeProvider.GetUtcNow();
        lock (_gate)
        {
            if (_jwt is not null && now - _jwtIssuedAt < TimeSpan.FromMinutes(40))
                return _jwt;
            using var ecdsa = ECDsa.Create();
            ecdsa.ImportFromPem(Pem.Normalize(apns.ApnsKey!));
            _jwt = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
            {
                Issuer = apns.ApnsTeamId,
                IssuedAt = now.UtcDateTime,
                // APNs reads only iss + iat (kid comes from the key id); the expiry is ignored by APNs.
                Expires = now.UtcDateTime.AddHours(1),
                NotBefore = now.UtcDateTime,
                SigningCredentials = new SigningCredentials(
                    new ECDsaSecurityKey(ecdsa) { KeyId = apns.ApnsKeyId, CryptoProviderFactory = new CryptoProviderFactory { CacheSignatureProviders = false } },
                    SecurityAlgorithms.EcdsaSha256),
            });
            _jwtIssuedAt = now;
            return _jwt;
        }
    }
}

/// <summary>Routes a push by the device's token type: APNs tokens to APNs, everything else to FCM.</summary>
public sealed class RoutingPushProvider(FcmPushProvider fcm, ApnsPushProvider apns) : IPushProvider
{
    public Task<PushResult> SendAsync(PushMessage message, CancellationToken ct) =>
        message.TokenType == PushTokenType.Apns ? apns.SendAsync(message, ct) : fcm.SendAsync(message, ct);
}
