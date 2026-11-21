using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Api;
using Api.Contracts;
using Domain.Manager;
using Domain.Services;
using Infrastructure.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Tests.Shared;

namespace ApiTests;

public class ApiFactory : WebApplicationFactory<Entrypoint>
{
    public InMemoryRepository Repository { get; } = new();
    public FakeObjectStorage Storage { get; } = new();
    public CapturingEmailService Email { get; } = new();
    public FakeAppleVerifier Apple { get; } = new();
    public FakeGoogleVerifier Google { get; } = new();

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Jwt:SecretKey", "test-only-signing-key-0123456789-abcdefghijklmnop");
        builder.UseSetting("Photos:Bucket", "test-bucket");
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IRepository>();
            services.AddSingleton<IRepository>(Repository);
            services.RemoveAll<IObjectStorage>();
            services.AddSingleton<IObjectStorage>(Storage);
            services.RemoveAll<IEmailService>();
            services.AddSingleton<IEmailService>(Email);
            services.RemoveAll<IAppleIdentityVerifier>();
            services.AddSingleton<IAppleIdentityVerifier>(Apple);
            services.RemoveAll<IGoogleIdentityVerifier>();
            services.AddSingleton<IGoogleIdentityVerifier>(Google);
            services.RemoveAll<IPasswordHasher>();
            services.AddSingleton<IPasswordHasher>(new PasswordHasher(1_000));
            services.RemoveAll<Domain.Manager.IEventManager>();
            services.AddSingleton<Domain.Manager.IEventManager>(Events);
        });
    }

    public CapturingEventManager Events { get; } = new();

    /// <summary>
    /// A signed-in test user. grantConsents (default): every explicit consent is given on the current text version, so tests of
    /// other features are not stopped by the consent guards; ConsentEndpointTests register with grantConsents: false.
    /// </summary>
    public async Task<(HttpClient Client, AuthResponse Auth)> RegisterAsync(string? email = null, string password = "Sifre1234", bool grantConsents = true)
    {
        var client = CreateClient();
        var response = await client.PostAsJsonAsync("v1/auth/register",
            new { name = "Ayşe", email = email ?? $"{Guid.NewGuid():N}@example.com", password, ageConfirmed = true }, Json);
        response.EnsureSuccessStatusCode();
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>(Json))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        if (grantConsents)
            await GrantAllConsentsAsync(client);
        return (client, auth);
    }

    public static async Task GrantAllConsentsAsync(HttpClient client)
    {
        var consents = Enum.GetValues<Domain.Enum.ConsentType>().Where(t => t != Domain.Enum.ConsentType.TeenTryOn)   // teen accounts only
            .Select(t => new { type = t, granted = true, version = Domain.Options.ConsentOptions.DefaultVersion }).ToArray();
        var response = await client.PutAsJsonAsync("v1/tenant/consents", new { consents, source = "test" }, Json);
        response.EnsureSuccessStatusCode();
    }
}

/// <summary>Queue double: records what the Api would have put on a worker queue.</summary>
public sealed class CapturingEventManager : Domain.Manager.IEventManager
{
    public List<Domain.Events.IJobRequestedEvent> Published { get; } = [];

    public Task PublishAsync(Domain.Events.IJobRequestedEvent jobEvent, CancellationToken ct = default)
    {
        lock (Published) Published.Add(jobEvent);
        return Task.CompletedTask;
    }

    public IReadOnlyList<T> Of<T>(string tenantId) where T : Domain.Events.IJobRequestedEvent
    {
        lock (Published) return Published.OfType<T>().Where(e => e.TenantId == tenantId).ToList();
    }
}

public sealed class CapturingEmailService : IEmailService
{
    public List<EmailMessage> Sent { get; } = [];

    public Task SendAsync(EmailMessage message, CancellationToken ct)
    {
        lock (Sent) Sent.Add(message);
        return Task.CompletedTask;
    }
}

public sealed class FakeAppleVerifier : IAppleIdentityVerifier
{
    public bool Configured { get; set; } = true;

    // Test token format: "valid:{sub}:{email}" — anything else is rejected.
    public Task<ExternalIdentity?> VerifyAsync(string identityToken, string nonce, CancellationToken ct)
    {
        if (!Configured) throw new ProviderNotConfiguredException("apple");
        var parts = identityToken.Split(':');
        return Task.FromResult(parts is ["valid", var sub, var email] ? new ExternalIdentity(sub, email, true) : null);
    }
}

public sealed class FakeGoogleVerifier : IGoogleIdentityVerifier
{
    public Task<ExternalIdentity?> VerifyAsync(string idToken, CancellationToken ct)
    {
        var parts = idToken.Split(':');
        return Task.FromResult(parts is ["valid", var sub, var email] ? new ExternalIdentity(sub, email, true) : null);
    }
}

public static class HttpExtensions
{
    public static async Task<JsonElement> JsonAsync(this HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    public static async Task<string?> CodeAsync(this HttpResponseMessage response) =>
        (await response.JsonAsync()).TryGetProperty("code", out var code) ? code.GetString() : null;

    public static Task<HttpResponseMessage> PostJsonAsync(this HttpClient client, string url, object body) =>
        client.PostAsJsonAsync(url, body, ApiFactory.Json);

    public static Task<HttpResponseMessage> PutJsonAsync(this HttpClient client, string url, object body) =>
        client.PutAsJsonAsync(url, body, ApiFactory.Json);
}
