using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api;
using Api.Contracts;
using Domain.Entity;
using Domain.Enum;
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

/// <summary>
/// Api host for the store / social / settings slices: in-memory repository, real wardrobe rows seeded through
/// <see cref="ClosetSeeder"/>, a fake weather provider, a configured admin and postback secrets.
/// </summary>
public sealed class StoreSocialApiFactory : WebApplicationFactory<Entrypoint>
{
    public const string AdminEmail = "admin@droblet.test";
    public const string NetworkSecret = "network-secret-for-tests";
    public const string DirectSecret = "direct-secret-for-tests";
    public const string Password = "Sifre1234";
    public const string AdminPassword = "AdminSifre-2026";
    public const string AdminSigningKey = "admin-test-signing-key-0123456789-zyxwvutsrqponm";
    public const string BootstrapEmail = "owner@droblet.test";
    public const string AdminOrigin = "https://droblet-admin.alatech.co";

    public CapturingEmailService Email { get; } = new();
    public InMemorySettingsStore Settings { get; } = new();

    public InMemoryRepository Repository { get; } = new();
    public ClosetSeeder Closet => _closet ??= new ClosetSeeder(Repository);
    private ClosetSeeder? _closet;
    public FakeWeatherProvider Weather { get; } = new();
    public CapturingEventManager Events { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Jwt:SecretKey", "test-only-signing-key-0123456789-abcdefghijklmnop");
        builder.UseSetting("Photos:Bucket", "test-bucket");
        builder.UseSetting("AdminJwt:SecretKey", AdminSigningKey);
        builder.UseSetting("AdminAuth:RequestsPerMinute", "100000");
        builder.UseSetting("AdminAuth:BootstrapSuperAdminEmail", BootstrapEmail);
        builder.UseSetting("AdminAuth:AllowedOrigins:0", AdminOrigin);
        builder.UseSetting("CatalogImages:Bucket", "test-catalog-images");
        builder.UseSetting("CatalogImages:PublicBaseUrl", "https://test-catalog-images.s3.eu-central-1.amazonaws.com");
        builder.UseSetting("AffiliatePostback:NetworkSecret", NetworkSecret);
        builder.UseSetting("AffiliatePostback:DirectSecret", DirectSecret);
        builder.UseSetting("Affiliate:DefaultCommissionRateBps", "800");
        builder.UseSetting("Social:FeedPageSize", "2");
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IRepository>();
            services.AddSingleton<IRepository>(Repository);
            services.RemoveAll<IObjectStorage>();
            services.AddSingleton<IObjectStorage>(new FakeObjectStorage());
            services.RemoveAll<IEmailService>();
            services.AddSingleton<IEmailService>(Email);
            // Presigned POSTs are signed locally: a client with dummy credentials exercises the real S3CatalogImageStorage.
            services.RemoveAll<Amazon.S3.IAmazonS3>();
            services.AddSingleton<Amazon.S3.IAmazonS3>(new Amazon.S3.AmazonS3Client(new Amazon.Runtime.BasicAWSCredentials("test", "test"), Amazon.RegionEndpoint.EUCentral1));
            services.RemoveAll<Domain.Services.Admin.ISettingsStore>();
            services.AddSingleton<Domain.Services.Admin.ISettingsStore>(Settings);
            services.RemoveAll<IPasswordHasher>();
            services.AddSingleton<IPasswordHasher>(new PasswordHasher(1_000));
            services.RemoveAll<IEventManager>();
            services.AddSingleton<IEventManager>(Events);
            services.RemoveAll<IWeatherProvider>();
            services.AddSingleton<IWeatherProvider>(Weather);
        });
    }

    public static string Unique(string prefix = "u") => prefix + Guid.NewGuid().ToString("N")[..10];

    public async Task<(HttpClient Client, AuthResponse Auth)> RegisterAsync(string? email = null, string name = "Ayşe Yılmaz", bool grantConsents = true)
    {
        var client = CreateClient();
        var response = await client.PostAsJsonAsync("v1/auth/register", new { name, email = email ?? $"{Guid.NewGuid():N}@example.com", password = Password, ageConfirmed = true }, ApiFactory.Json);
        if (response.StatusCode == HttpStatusCode.Conflict && email is not null)
            response = await client.PostAsJsonAsync("v1/auth/login", new { email, password = Password }, ApiFactory.Json);
        response.EnsureSuccessStatusCode();
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        if (grantConsents)
            await ApiFactory.GrantAllConsentsAsync(client);
        return (client, auth);
    }

    private readonly Dictionary<string, string> _adminTokens = [];
    private readonly SemaphoreSlim _adminGate = new(1, 1);

    /// <summary>
    /// A client signed in as an admin of <paramref name="role"/> through the real two-step sign-in (password, then the
    /// e-mailed code). The admin row is seeded directly; the session is cached per e-mail so tests stay under the
    /// sign-in rate limits.
    /// </summary>
    public async Task<HttpClient> AdminAsync(AdminRole role = AdminRole.SuperAdmin, string? email = null)
    {
        email ??= role == AdminRole.SuperAdmin ? AdminEmail : $"{role.ToString().ToLowerInvariant()}@droblet.test";
        await _adminGate.WaitAsync();
        try
        {
            if (!_adminTokens.TryGetValue(email, out var token))
            {
                await SeedAdminAsync(email, role);
                token = (await AdminSignInAsync(email, AdminPassword)).GetProperty("accessToken").GetString()!;
                _adminTokens[email] = token;
            }
            return AdminClient(token);
        }
        finally
        {
            _adminGate.Release();
        }
    }

    public HttpClient AdminClient(string accessToken)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        return client;
    }

    /// <summary>Creates (if missing) an admin with <see cref="AdminPassword"/>; returns its id.</summary>
    public async Task<string> SeedAdminAsync(string email, AdminRole role, bool disabled = false)
    {
        var normalized = email.Trim().ToLowerInvariant();
        var existing = await Repository.GetAsync<AdminEmailIndexEntity>(AdminEmailIndexEntity.GetPk(), AdminEmailIndexEntity.GetSk(normalized));
        if (existing is not null)
            return existing.AdminId;
        var now = DateTime.UtcNow;
        var admin = new AdminUserEntity
        {
            Id = Domain.Extensions.Ulid.New(now), Email = normalized, Name = role.ToString(), Role = role, PasswordSet = true, Disabled = disabled,
            CreatedAt = now, UpdatedAt = now,
        };
        await Repository.TransactWriteAsync(
        [
            TransactWriteOperation.Create(new AdminEmailIndexEntity { Email = normalized, AdminId = admin.Id }),
            TransactWriteOperation.Create(admin),
            TransactWriteOperation.Put(new AdminCredentialEntity { AdminId = admin.Id, PasswordHash = Services.GetRequiredService<IPasswordHasher>().Hash(AdminPassword), UpdatedAt = now }),
        ]);
        return admin.Id;
    }

    /// <summary>Step 1 + step 2; returns the AdminSession JSON.</summary>
    public async Task<JsonElement> AdminSignInAsync(string email, string password)
    {
        var client = CreateClient();
        var login = await client.PostJsonAsync("v1/admin/auth/login", new { email, password });
        login.EnsureSuccessStatusCode();
        var challengeId = (await login.JsonAsync()).GetProperty("challengeId").GetString()!;
        var verify = await client.PostJsonAsync("v1/admin/auth/verify", new { challengeId, code = LastCodeFor(email) });
        verify.EnsureSuccessStatusCode();
        return await verify.JsonAsync();
    }

    public string LastCodeFor(string email)
    {
        lock (Email.Sent)
        {
            var message = Email.Sent.Last(m => string.Equals(m.To, email, StringComparison.OrdinalIgnoreCase)
                                               && (m.Subject.Contains("code", StringComparison.OrdinalIgnoreCase) || m.Subject.Contains("kod", StringComparison.OrdinalIgnoreCase)));
            return System.Text.RegularExpressions.Regex.Match(message.TextBody, @"\b\d{6}\b").Value;
        }
    }

    public string LastLinkTokenFor(string email)
    {
        lock (Email.Sent)
        {
            var message = Email.Sent.Last(m => string.Equals(m.To, email, StringComparison.OrdinalIgnoreCase) && m.TextBody.Contains("reset-password?token=", StringComparison.Ordinal));
            return Uri.UnescapeDataString(System.Text.RegularExpressions.Regex.Match(message.TextBody, @"token=(\S+)").Groups[1].Value);
        }
    }

    /// <summary>A user with a handle, a closet visibility and (optionally) three style tags.</summary>
    public async Task<TestUser> UserAsync(ClosetVisibility visibility = ClosetVisibility.Public, StyleTag[]? tags = null, string name = "Ayşe Yılmaz")
    {
        var (client, auth) = await RegisterAsync(name: name);
        var handle = Unique();
        (await client.PutJsonAsync("v1/tenant/profile/handle", new { handle })).EnsureSuccessStatusCode();
        if (visibility != ClosetVisibility.FollowersOnly) // FollowersOnly is the default of a new account (decision 7)
            (await client.PutJsonAsync("v1/tenant/profile/visibility", new { closetVisibility = visibility, baseVersion = 2 })).EnsureSuccessStatusCode();
        if (tags is not null)
            (await client.PutJsonAsync("v1/tenant/style-profile", new { segment = Segment.Women, styleTags = tags, budget = Budget.Mixed, baseVersion = 0 })).EnsureSuccessStatusCode();
        return new TestUser(client, auth.TenantId, auth.UserId, handle);
    }

    public static object Text(string tr, string? en = null) => en is null ? new { tr } : new { tr, en };

    public async Task<string> SeedBrandAsync(HttpClient admin, AffiliateSource source = AffiliateSource.Network, string? checkoutUrl = null, string? clickIdParameter = null, int? commissionRateBps = null)
    {
        var id = Unique("brand-");
        (await admin.PutJsonAsync($"v1/admin/brand/{id}", new { name = "Marka " + id[^4..], source, checkoutUrl, clickIdParameter, commissionRateBps, websiteUrl = "https://brand.example" }))
            .EnsureSuccessStatusCode();
        return id;
    }

    public async Task<string> SeedProductAsync(HttpClient admin, string brandId, long priceMinor = 129_900, ProductCategory category = ProductCategory.Shirt,
        string[]? colors = null, string[]? sizes = null, PriceBand priceBand = PriceBand.HighStreet, string? tr = null, string? en = null, string? affiliateUrl = "https://shop.example/p?utm=x")
    {
        var id = Unique("prod-");
        var response = await admin.PutJsonAsync($"v1/admin/product/{id}", new
        {
            brandId, name = Text(tr ?? "Keten Gömlek", en ?? "Linen Shirt"), category, colors = colors ?? ["white"], sizes = sizes ?? ["S", "M"],
            priceMinor, priceBand, images = new[] { "https://img.example/1.jpg" }, affiliateUrl,
        });
        response.EnsureSuccessStatusCode();
        return id;
    }

    public static HttpRequestMessage SignedPostback(string source, object body, string secret)
    {
        var json = JsonSerializer.Serialize(body, ApiFactory.Json);
        var request = new HttpRequestMessage(HttpMethod.Post, $"v1/affiliate/postback/{source}") { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        request.Headers.Add(PostbackSignature.Header, PostbackSignature.Compute(secret, Encoding.UTF8.GetBytes(json)));
        return request;
    }
}

/// <summary>SSM double for the admin settings endpoints.</summary>
public sealed class InMemorySettingsStore : Domain.Services.Admin.ISettingsStore
{
    public System.Collections.Concurrent.ConcurrentDictionary<string, string> Values { get; } = new(StringComparer.Ordinal);

    public Task<string?> GetAsync(string name, CancellationToken ct) => Task.FromResult(Values.TryGetValue(name, out var value) ? value : null);

    public Task PutAsync(string name, string value, CancellationToken ct)
    {
        Values[name] = value;
        return Task.CompletedTask;
    }
}

public sealed record TestUser(HttpClient Client, string TenantId, string UserId, string Handle);

/// <summary>
/// Seeds REAL wardrobe rows (Item / Look / Trip entities) into the repository, so social and store endpoints read
/// them through the production IClosetReader (WardrobeClosetReader) — no fake closet.
/// </summary>
public sealed class ClosetSeeder(InMemoryRepository repository)
{
    public const string SharedItemId = "item-1";

    public string AddLook(string tenantId, DateTime? createdAt = null, string? productId = null)
    {
        var at = createdAt ?? DateTime.UtcNow;
        var id = Domain.Extensions.Ulid.New(at);
        AddItem(tenantId, SharedItemId, ItemCategory.Top, "white");
        var slots = new List<LookSlotValue> { new() { Slot = OutfitSlot.Top, ItemId = SharedItemId } };
        if (productId is not null)
            slots.Add(new LookSlotValue { Slot = OutfitSlot.BagAccessory, ProductId = productId });
        repository.SaveAsync(new LookEntity
        {
            Id = id, TenantId = tenantId, Name = "Ofis", Occasion = Occasion.Office, Slots = slots, Source = LookSource.User,
            CreatedAt = at, UpdatedAt = at, Version = 1,
        }).GetAwaiter().GetResult();
        return id;
    }

    public void AddItem(string tenantId, string id, ItemCategory category, params string[] colors)
    {
        var now = DateTime.UtcNow;
        repository.SaveAsync(new ItemEntity
        {
            Id = id, TenantId = tenantId, Name = id == SharedItemId ? "Beyaz gömlek" : id, Category = category, ColorIds = colors.ToList(),
            Seasons = [Domain.Services.Ai.Season.Spring], Source = ItemSource.Photo,
            ImageKey = $"{StorageKeys.TenantRoot(tenantId)}items/{id}/clean.webp",
            OriginalImageKey = $"{StorageKeys.TenantRoot(tenantId)}items/{id}/original.jpg",
            CreatedAt = now, UpdatedAt = now, Version = 1,
        }).GetAwaiter().GetResult();
    }

    /// <summary>A finished trip (ended yesterday or earlier).</summary>
    public void AddTrip(string tenantId, string id, int endedDaysAgo = 10)
    {
        var end = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-endedDaysAgo);
        repository.SaveAsync(new TripEntity
        {
            Id = id, TenantId = tenantId, CityId = "2988507", CityName = "Paris",
            StartDate = CalendarDay.ToText(end.AddDays(-3)), EndDate = CalendarDay.ToText(end),
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow, Version = 1,
        }).GetAwaiter().GetResult();
    }
}

public sealed class FakeWeatherProvider : IWeatherProvider
{
    public int ForecastCalls;
    public bool Down { get; set; }
    public List<(double Lat, double Lon)> Requested { get; } = [];

    public Task<IReadOnlyList<DailyForecast>> GetDailyAsync(double latitude, double longitude, int days, CancellationToken ct)
    {
        if (Down) throw new WeatherUnavailableException("down");
        Interlocked.Increment(ref ForecastCalls);
        lock (Requested) Requested.Add((latitude, longitude));
        var start = new DateOnly(2026, 11, 18);
        return Task.FromResult<IReadOnlyList<DailyForecast>>(Enumerable.Range(0, days)
            .Select(i => new DailyForecast(WeeklyEditRules.Format(start.AddDays(i)), 8 + i, 15 + i, WeatherCondition.Rain, 61, 70)).ToList());
    }

    public Task<IReadOnlyList<CityDto>> SearchCitiesAsync(string query, string language, int count, CancellationToken ct)
    {
        if (Down) throw new WeatherUnavailableException("down");
        IReadOnlyList<CityDto> cities = query.StartsWith("ist", StringComparison.OrdinalIgnoreCase)
            ? [new CityDto("745044", language == "en" ? "Istanbul" : "İstanbul", language == "en" ? "Istanbul" : "İstanbul", language == "en" ? "Türkiye" : "Türkiye", "TR", 41.01384, 28.94966, "Europe/Istanbul")]
            : [];
        return Task.FromResult(cities);
    }
}
