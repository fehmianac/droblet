using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Infrastructure.Services;
using Infrastructure.Services.Providers;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Tests.Shared;

namespace InfrastructureTests;

public class AppleSignInTokenServiceTests
{
    private static readonly ECDsa Key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    private static AppleAuthOptions Configured() => new()
    {
        BundleId = "com.alatech.droplet",
        TeamId = "4LB4RD97A9",
        KeyId = "ABC123DEFG",
        PrivateKey = Key.ExportPkcs8PrivateKeyPem(),
    };

    private static readonly JwtOptions Jwt = new() { SecretKey = "test-only-signing-key-0123456789-abcdefghijklmnop" };

    private static (AppleSignInTokenService Service, StubHandler Http, InMemoryRepository Repository) Create(AppleAuthOptions apple)
    {
        var http = new StubHandler(request => request.RequestUri!.AbsolutePath == "/auth/token"
            ? StubHandler.Json("""{"access_token":"a","token_type":"Bearer","expires_in":3600,"refresh_token":"apple-refresh-1","id_token":"x"}""")
            : new HttpResponseMessage(HttpStatusCode.OK));
        var repository = new InMemoryRepository();
        return (new AppleSignInTokenService(new HttpClient(http), repository, Fixtures.Monitor(apple), Fixtures.Monitor(Jwt), Fixtures.Clock(),
            NullLogger<AppleSignInTokenService>.Instance), http, repository);
    }

    private static async Task SeedAppleUserAsync(InMemoryRepository repository)
    {
        var identity = new AuthIdentityEntity { Provider = AuthProvider.Apple, Subject = "001234.abcd", UserId = "u1" };
        await repository.SaveAsync(identity);
        await repository.SaveAsync(new UserEntity { Id = "u1", TenantId = "t1", Identities = [identity.Sk, AuthIdentityEntity.GetSk(AuthProvider.Email, "a@b.co")] });
    }

    [Fact]
    public async Task ClientSecret_IsAnEs256JwtForAppleId()
    {
        var apple = Configured();
        var secret = AppleSignInTokenService.ClientSecret(apple, Fixtures.Now);

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(secret, new TokenValidationParameters
        {
            ValidIssuer = "4LB4RD97A9",
            ValidAudience = "https://appleid.apple.com",
            IssuerSigningKey = new ECDsaSecurityKey(ECDsa.Create(Key.ExportParameters(false))),
            ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256],
            LifetimeValidator = (_, expires, _, _) => expires > Fixtures.Now,
        });
        Assert.True(result.IsValid, result.Exception?.Message);
        var token = (JsonWebToken)result.SecurityToken;
        Assert.Equal("com.alatech.droplet", token.Subject);
        Assert.Equal("ABC123DEFG", token.Kid);
        Assert.True(token.ValidTo <= Fixtures.Now.AddMonths(6));
    }

    [Fact]
    public async Task RevokeRequest_PostsTheDocumentedForm()
    {
        using var request = AppleSignInTokenService.RevokeRequest(Configured(), "apple-refresh-1", Fixtures.Now);
        var form = (await request.Content!.ReadAsStringAsync()).Split('&').Select(p => p.Split('=')).ToDictionary(p => p[0], p => Uri.UnescapeDataString(p[1]));

        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://appleid.apple.com/auth/revoke", request.RequestUri!.ToString());
        Assert.Equal("com.alatech.droplet", form["client_id"]);
        Assert.Equal("apple-refresh-1", form["token"]);
        Assert.Equal("refresh_token", form["token_type_hint"]);
        Assert.Equal(3, form["client_secret"].Split('.').Length);
    }

    [Fact]
    public async Task SignIn_StoresTheRefreshTokenEncrypted_AndDeletionRevokesIt()
    {
        var (service, http, repository) = Create(Configured());
        await SeedAppleUserAsync(repository);

        await service.StoreFromAuthorizationCodeAsync("001234.abcd", "code-1", default);
        var stored = (await repository.GetAsync<AuthIdentityEntity>(AuthIdentityEntity.GetPk(), AuthIdentityEntity.GetSk(AuthProvider.Apple, "001234.abcd")))!.AppleRefreshToken;
        Assert.NotNull(stored);
        Assert.DoesNotContain("apple-refresh-1", stored);
        Assert.Contains("grant_type=authorization_code", http.Requests[0].Body);
        Assert.Contains("code=code-1", http.Requests[0].Body);

        await service.RevokeForUserAsync("u1", default);
        var revoke = Assert.Single(http.Requests, r => r.Uri.AbsolutePath == "/auth/revoke");
        Assert.Contains("token=apple-refresh-1", revoke.Body);
    }

    [Fact]
    public async Task WhileTheKeyIsChangeMe_NothingIsCalled_AndNothingThrows()
    {
        var apple = Configured();
        apple.PrivateKey = null; // CHANGE_ME is bound as null (ConfigSecret)
        var (service, http, repository) = Create(apple);
        await SeedAppleUserAsync(repository);
        var identity = (await repository.GetAsync<AuthIdentityEntity>(AuthIdentityEntity.GetPk(), AuthIdentityEntity.GetSk(AuthProvider.Apple, "001234.abcd")))!;
        identity.AppleRefreshToken = AppleTokenProtector.Protect("apple-refresh-1", apple, Jwt);
        await repository.SaveAsync(identity);

        await service.StoreFromAuthorizationCodeAsync("001234.abcd", "code-1", default);
        await service.RevokeForUserAsync("u1", default);

        Assert.Empty(http.Requests);
    }

    [Fact]
    public void Protector_RoundTrips_WithTheDedicatedOrTheJwtDerivedKey()
    {
        var jwtOnly = new AppleAuthOptions();
        var dedicated = new AppleAuthOptions { TokenEncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) };

        var a = AppleTokenProtector.Protect("secret-token", jwtOnly, Jwt);
        var b = AppleTokenProtector.Protect("secret-token", dedicated, Jwt);

        Assert.StartsWith("j1.", a);
        Assert.StartsWith("k1.", b);
        Assert.Equal("secret-token", AppleTokenProtector.Unprotect(a, dedicated, Jwt)); // older rows still open after the key is added
        Assert.Equal("secret-token", AppleTokenProtector.Unprotect(b, dedicated, Jwt));
        Assert.Null(AppleTokenProtector.Unprotect(b, jwtOnly, Jwt));
        Assert.Null(AppleTokenProtector.Unprotect(a[..^4] + "AAAA", dedicated, Jwt)); // tampered
    }
}

public class ApnsPushProviderTests
{
    private static ApnsOptions Configured() => new()
    {
        ApnsKey = ECDsa.Create(ECCurve.NamedCurves.nistP256).ExportPkcs8PrivateKeyPem(),
        ApnsKeyId = "KEY1234567",
        ApnsTeamId = "4LB4RD97A9",
    };

    private static readonly PushMessage Message = new("a1b2c3d4", "Bugünün kombini hazır", "Planladığın look seni bekliyor.",
        new Dictionary<string, string> { ["type"] = "morning_outfit", ["day"] = "2026-11-19" }) { TokenType = PushTokenType.Apns };

    [Fact]
    public async Task Compose_IsAnHttp2AlertPushWithTheDataBesideAps()
    {
        using var request = ApnsPushProvider.Compose("https://api.push.apple.com", Configured(), Message, "jwt");
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());

        Assert.Equal("https://api.push.apple.com/3/device/a1b2c3d4", request.RequestUri!.ToString());
        Assert.Equal(HttpVersion.Version20, request.Version);
        Assert.Equal("bearer jwt", request.Headers.Authorization!.ToString());
        Assert.Equal("com.alatech.droplet", request.Headers.GetValues("apns-topic").Single());
        Assert.Equal("alert", request.Headers.GetValues("apns-push-type").Single());
        Assert.Equal("Bugünün kombini hazır", body.RootElement.GetProperty("aps").GetProperty("alert").GetProperty("title").GetString());
        Assert.Equal("morning_outfit", body.RootElement.GetProperty("type").GetString());
    }

    [Fact]
    public async Task DevelopmentToken_IsRetriedOnTheSandboxHost()
    {
        var http = new StubHandler(r => r.RequestUri!.Host == "api.push.apple.com"
            ? StubHandler.Json("""{"reason":"BadDeviceToken"}""", HttpStatusCode.BadRequest)
            : new HttpResponseMessage(HttpStatusCode.OK));
        var provider = new ApnsPushProvider(new HttpClient(http), Fixtures.Monitor(Configured()), Fixtures.Clock(), NullLogger<ApnsPushProvider>.Instance);

        Assert.Equal(PushResult.Sent, await provider.SendAsync(Message, default));
        Assert.Equal(["api.push.apple.com", "api.sandbox.push.apple.com"], http.Requests.Select(r => r.Uri.Host));
        Assert.StartsWith("bearer ", http.Requests[0].Authorization);
    }

    [Fact]
    public async Task SandboxOnlyKey_IsRetriedOnTheSandboxHost_AndADeviceItCannotReachStaysRegistered()
    {
        // A key Apple issued for the sandbox: production refuses the key, the sandbox accepts a development build's token.
        var http = new StubHandler(r => r.RequestUri!.Host == "api.push.apple.com"
            ? StubHandler.Json("""{"reason":"BadEnvironmentKeyInToken"}""", HttpStatusCode.Forbidden)
            : new HttpResponseMessage(HttpStatusCode.OK));
        var provider = new ApnsPushProvider(new HttpClient(http), Fixtures.Monitor(Configured()), Fixtures.Clock(), NullLogger<ApnsPushProvider>.Instance);
        Assert.Equal(PushResult.Sent, await provider.SendAsync(Message, default));
        Assert.Equal(["api.push.apple.com", "api.sandbox.push.apple.com"], http.Requests.Select(r => r.Uri.Host));

        // A release build's token: the sandbox does not know it. That is a key problem — Failed, never Unregistered.
        var release = new StubHandler(r => r.RequestUri!.Host == "api.push.apple.com"
            ? StubHandler.Json("""{"reason":"BadEnvironmentKeyInToken"}""", HttpStatusCode.Forbidden)
            : StubHandler.Json("""{"reason":"BadDeviceToken"}""", HttpStatusCode.BadRequest));
        var blocked = new ApnsPushProvider(new HttpClient(release), Fixtures.Monitor(Configured()), Fixtures.Clock(), NullLogger<ApnsPushProvider>.Instance);
        Assert.Equal(PushResult.Failed, await blocked.SendAsync(Message, default));
    }

    [Fact]
    public async Task Gone_IsUnregistered_AndNoKeyIsNotConfigured()
    {
        var http = new StubHandler(_ => StubHandler.Json("""{"reason":"Unregistered"}""", HttpStatusCode.Gone));
        var provider = new ApnsPushProvider(new HttpClient(http), Fixtures.Monitor(Configured()), Fixtures.Clock(), NullLogger<ApnsPushProvider>.Instance);
        Assert.Equal(PushResult.Unregistered, await provider.SendAsync(Message, default));

        var off = new ApnsPushProvider(new HttpClient(http), Fixtures.Monitor(new ApnsOptions { ApnsKey = "CHANGE_ME", ApnsKeyId = "K", ApnsTeamId = "T" }),
            Fixtures.Clock(), NullLogger<ApnsPushProvider>.Instance);
        Assert.Equal(PushResult.NotConfigured, await off.SendAsync(Message, default));
    }

    [Fact]
    public async Task Routing_SendsApnsTokensToApns_AndFcmTokensToFcm()
    {
        var apnsHttp = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
        var apns = new ApnsPushProvider(new HttpClient(apnsHttp), Fixtures.Monitor(Configured()), Fixtures.Clock(), NullLogger<ApnsPushProvider>.Instance);
        var fcm = new FcmPushProvider(new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK))),
            Fixtures.Monitor(new FirebaseServiceAccountOptions()), Fixtures.Clock(), NullLogger<FcmPushProvider>.Instance);
        var router = new RoutingPushProvider(fcm, apns);

        Assert.Equal(PushResult.Sent, await router.SendAsync(Message, default));
        Assert.Equal(PushResult.NotConfigured, await router.SendAsync(Message with { TokenType = PushTokenType.Fcm }, default));
        Assert.Single(apnsHttp.Requests);
    }
}
