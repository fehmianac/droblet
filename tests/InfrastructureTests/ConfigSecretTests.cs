using System.Net;
using Amazon.Extensions.Configuration.SystemsManager;
using Amazon.SimpleSystemsManagement.Model;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure;
using Infrastructure.Ai;
using Infrastructure.Services.Providers;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;

namespace InfrastructureTests;

/// <summary>deploy creates secret SSM parameters with the literal CHANGE_ME: that must behave exactly like "not configured".</summary>
public class ConfigSecretTests
{
    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("CHANGE_ME", false)]
    [InlineData(" CHANGE_ME ", false)]
    [InlineData("change_me", true)]      // only the exact placeholder
    [InlineData("sk-live-123", true)]
    public void IsSet(string? value, bool expected)
    {
        Assert.Equal(expected, ConfigSecret.IsSet(value));
        Assert.Equal(expected ? value : null, ConfigSecret.OrNull(value));
    }

    private static ServiceProvider Services(Dictionary<string, string?> values)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDrobletCore(configuration);
        services.AddDrobletApiServices(configuration);
        return services.BuildServiceProvider();
    }

    [Fact]
    public void BoundOptions_SeeThePlaceholderAsNotSet()
    {
        using var services = Services(new()
        {
            ["Ai:Enabled"] = "true", ["Ai:ApiKey"] = "CHANGE_ME", ["Ai:TextModel"] = "gpt-text", ["Ai:ImageModel"] = "gpt-image",
            ["Store:NotificationKey"] = "CHANGE_ME",
            ["AppleAuth:PrivateKey"] = "CHANGE_ME",
            ["Email:SendGrid:ApiKey"] = "CHANGE_ME",
            ["Push:ServiceAccountJson"] = "CHANGE_ME",
        });

        var ai = services.GetRequiredService<IOptionsMonitor<AiOptions>>().CurrentValue;
        var store = services.GetRequiredService<IOptionsMonitor<StoreOptions>>().CurrentValue;
        var apple = services.GetRequiredService<IOptionsMonitor<AppleAuthOptions>>().CurrentValue;
        var email = services.GetRequiredService<IOptionsMonitor<EmailOptions>>().CurrentValue;
        var push = services.GetRequiredService<IOptionsMonitor<FirebaseServiceAccountOptions>>().CurrentValue;

        Assert.Null(ai.ApiKey);
        Assert.False(ai.HasApiKey);
        Assert.Equal("gpt-text", ai.TextModel);
        Assert.Null(store.NotificationKey);
        Assert.False(store.HasNotificationKey);
        Assert.Null(apple.PrivateKey);
        Assert.False(apple.HasPrivateKey);
        Assert.Null(email.SendGrid.ApiKey);
        Assert.False(push.IsConfigured);
    }

    [Fact]
    public void BoundOptions_KeepRealSecrets()
    {
        using var services = Services(new()
        {
            ["Ai:ApiKey"] = "sk-real", ["Store:NotificationKey"] = "store-key", ["AppleAuth:PrivateKey"] = "-----BEGIN PRIVATE KEY-----", ["Email:SendGrid:ApiKey"] = "SG.real",
        });

        Assert.Equal("sk-real", services.GetRequiredService<IOptionsMonitor<AiOptions>>().CurrentValue.ApiKey);
        Assert.True(services.GetRequiredService<IOptionsMonitor<StoreOptions>>().CurrentValue.HasNotificationKey);
        Assert.True(services.GetRequiredService<IOptionsMonitor<AppleAuthOptions>>().CurrentValue.HasPrivateKey);
        Assert.Equal("SG.real", services.GetRequiredService<IOptionsMonitor<EmailOptions>>().CurrentValue.SendGrid.ApiKey);
    }

    // ── OpenAI key ──────────────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("CHANGE_ME")]
    [InlineData("")]
    [InlineData(null)]
    public async Task OpenAi_WithPlaceholderKey_IsNotConfigured_AndCallsNothing(string? key)
    {
        var handler = new StubHandler(_ => StubHandler.Json("{}"));
        var options = new AiOptions { Enabled = true, ApiKey = key, TextModel = "gpt-text", ImageModel = "gpt-image", BaseUrl = "https://ai.test" };
        var provider = new OpenAiProvider(new HttpClient(handler), Fixtures.Monitor(options), NullLogger<OpenAiProvider>.Instance);

        Assert.False(provider.IsConfigured);
        await Assert.ThrowsAsync<AiProviderException>(() => provider.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, "{}"), default));
        Assert.Empty(handler.Requests); // the placeholder is never sent as a bearer token
    }

    // ── FCM service account ─────────────────────────────────────────────────────────────────────────────────────

    private static FirebaseServiceAccountOptions Bind(Dictionary<string, string?> values)
    {
        var options = new FirebaseServiceAccountOptions();
        FirebaseServiceAccountBinder.Bind(new ConfigurationBuilder().AddInMemoryCollection(values).Build(), options);
        return options;
    }

    [Fact]
    public async Task Fcm_WithPlaceholderServiceAccount_IsNotConfigured_AndCallsNothing()
    {
        var handler = new StubHandler(_ => StubHandler.Json("{}"));
        var account = Bind(new() { ["Push:ServiceAccountJson"] = "CHANGE_ME" });
        var provider = new FcmPushProvider(new HttpClient(handler), Fixtures.Monitor(account), new FakeTimeProvider(), NullLogger<FcmPushProvider>.Instance);

        var result = await provider.SendAsync(new PushMessage("token", "t", "b", new Dictionary<string, string>()), default);

        Assert.False(account.IsConfigured);
        Assert.Equal(PushResult.NotConfigured, result);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public void Fcm_ServiceAccount_BindsFromEveryShape()
    {
        const string file = """{"type":"service_account","project_id":"droblet-prod","private_key":"-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n","client_email":"push@droblet-prod.iam.gserviceaccount.com","token_uri":"https://oauth2.googleapis.com/token"}""";

        var asString = Bind(new() { ["Push:ServiceAccountJson"] = file });
        // What the SSM loader produces for a JSON parameter value: flattened child keys.
        var flattened = Bind(new()
        {
            ["Push:ServiceAccountJson:project_id"] = "droblet-prod", ["Push:ServiceAccountJson:client_email"] = "push@droblet-prod.iam.gserviceaccount.com",
            ["Push:ServiceAccountJson:private_key"] = "-----BEGIN PRIVATE KEY-----",
        });
        var legacy = Bind(new() { ["FirebaseServiceAccount:ProjectId"] = "p", ["FirebaseServiceAccount:ClientEmail"] = "e", ["FirebaseServiceAccount:PrivateKey"] = "k" });
        var partPlaceholder = Bind(new() { ["Push:ServiceAccountJson:project_id"] = "p", ["Push:ServiceAccountJson:client_email"] = "e", ["Push:ServiceAccountJson:private_key"] = "CHANGE_ME" });
        var garbage = Bind(new() { ["Push:ServiceAccountJson"] = "not json" });
        var nothing = Bind(new());

        Assert.True(asString.IsConfigured);
        Assert.Equal(("droblet-prod", "push@droblet-prod.iam.gserviceaccount.com"), (asString.ProjectId, asString.ClientEmail));
        Assert.StartsWith("-----BEGIN PRIVATE KEY-----", asString.PrivateKey);
        Assert.True(flattened.IsConfigured);
        Assert.Equal("https://oauth2.googleapis.com/token", flattened.TokenUri); // default kept
        Assert.True(legacy.IsConfigured);
        Assert.False(partPlaceholder.IsConfigured);
        Assert.False(garbage.IsConfigured);
        Assert.False(nothing.IsConfigured);
    }

    // ── Postback shared secrets ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void PostbackSecret_PlaceholderIsNoSecret()
    {
        var placeholder = new AffiliatePostbackOptions { NetworkSecret = "CHANGE_ME", DirectSecret = "CHANGE_ME", DirectBrandSecrets = { ["brand-a"] = "CHANGE_ME", ["brand-b"] = "real-b" } };

        Assert.Null(PostbackSignature.SecretFor(placeholder, AffiliateSource.Network, null));
        Assert.Null(PostbackSignature.SecretFor(placeholder, AffiliateSource.Direct, "brand-a"));
        Assert.Equal("real-b", PostbackSignature.SecretFor(placeholder, AffiliateSource.Direct, "brand-b"));
        Assert.Equal("net", PostbackSignature.SecretFor(new AffiliatePostbackOptions { NetworkSecret = "net" }, AffiliateSource.Network, null));
    }

    // ── SSM shapes: worker/Ai (String JSON) + worker/Ai/ApiKey (SecureString, plain value) ───────────────────────

    private static IConfiguration FromSsm(string path, params (string Name, string Value)[] parameters)
    {
        var processed = new JsonOrStringParameterProcessor().ProcessParameters(
            parameters.Select(p => new Parameter { Name = $"{path}/{p.Name}", Value = p.Value }), path);
        return new ConfigurationBuilder().AddInMemoryCollection(processed!).Build();
    }

    [Fact]
    public void WorkerAi_JsonParameter_And_NestedPlainApiKey_BindToOneSection()
    {
        var configuration = FromSsm("/droblet/dev/worker",
            ("Ai", """{"Enabled":true,"Provider":"OpenAI","TextModel":"gpt-text","ImageModel":"gpt-image"}"""),
            ("Ai/ApiKey", "sk-proj-abc_DEF-123"),
            ("Entitlements", """{"Premium":{"TryOnCreditsPerMonth":30},"Free":{"ItemRecognitionLimit":10}}"""));
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDrobletCore(configuration);
        services.AddDrobletAi();
        using var provider = services.BuildServiceProvider();

        var ai = provider.GetRequiredService<IOptionsMonitor<AiOptions>>().CurrentValue;

        Assert.Equal((true, "OpenAI", "gpt-text", "gpt-image", "sk-proj-abc_DEF-123"), (ai.Enabled, ai.Provider, ai.TextModel, ai.ImageModel, ai.ApiKey));
        Assert.True(provider.GetRequiredService<IAiProvider>().IsConfigured);
        Assert.Equal(30, provider.GetRequiredService<IOptionsMonitor<EntitlementOptions>>().CurrentValue.Premium.TryOnCreditsPerMonth);
    }

    [Fact]
    public void WorkerAi_WithThePlaceholderKey_IsNotConfigured()
    {
        var configuration = FromSsm("/droblet/dev/worker",
            ("Ai", """{"Enabled":true,"Provider":"OpenAI","TextModel":"gpt-text","ImageModel":"gpt-image"}"""),
            ("Ai/ApiKey", "CHANGE_ME"));
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDrobletCore(configuration);
        services.AddDrobletAi();
        using var provider = services.BuildServiceProvider();

        Assert.Null(provider.GetRequiredService<IOptionsMonitor<AiOptions>>().CurrentValue.ApiKey);
        Assert.False(provider.GetRequiredService<IAiProvider>().IsConfigured);
    }

    [Fact]
    public void ApiLambda_NeedsNoAiKey()
    {
        // The Api reads /droblet/{stage}/api only: no Ai section at all, and it never registers an AI provider.
        var configuration = FromSsm("/droblet/dev/api", ("Entitlements", """{"Premium":{"TryOnCreditsPerMonth":30}}"""));
        using var services = Services(configuration.AsEnumerable().ToDictionary(p => p.Key, p => p.Value));

        Assert.Null(services.GetService<IAiProvider>());
        Assert.Null(services.GetRequiredService<IOptionsMonitor<AiOptions>>().CurrentValue.ApiKey);
        Assert.Null(services.GetService<IStylistModel>());
        Assert.Null(services.GetService<ITryOnRenderer>());
    }
}
