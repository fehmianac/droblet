using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api;
using Api.Contracts;
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
/// Api host for the store / social / settings slices: in-memory repository, a fake wardrobe (IClosetReader — the real
/// one belongs to the wardrobe slice), a fake weather provider, a configured admin and postback secrets.
/// </summary>
public sealed class StoreSocialApiFactory : WebApplicationFactory<Entrypoint>
{
    public const string AdminEmail = "admin@droblet.test";
    public const string NetworkSecret = "network-secret-for-tests";
    public const string DirectSecret = "direct-secret-for-tests";
    public const string Password = "Sifre1234";

    public InMemoryRepository Repository { get; } = new();
    public FakeClosetReader Closet { get; } = new();
    public FakeWeatherProvider Weather { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Jwt:SecretKey", "test-only-signing-key-0123456789-abcdefghijklmnop");
        builder.UseSetting("Photos:Bucket", "test-bucket");
        builder.UseSetting("Admin:Emails:0", AdminEmail);
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
            services.AddSingleton<IEmailService>(new CapturingEmailService());
            services.RemoveAll<IPasswordHasher>();
            services.AddSingleton<IPasswordHasher>(new PasswordHasher(1_000));
            services.RemoveAll<IClosetReader>();
            services.AddSingleton<IClosetReader>(Closet);
            services.RemoveAll<IWeatherProvider>();
            services.AddSingleton<IWeatherProvider>(Weather);
        });
    }

    public static string Unique(string prefix = "u") => prefix + Guid.NewGuid().ToString("N")[..10];

    public async Task<(HttpClient Client, AuthResponse Auth)> RegisterAsync(string? email = null, string name = "Ayşe Yılmaz")
    {
        var client = CreateClient();
        var response = await client.PostAsJsonAsync("v1/auth/register", new { name, email = email ?? $"{Guid.NewGuid():N}@example.com", password = Password }, ApiFactory.Json);
        if (response.StatusCode == HttpStatusCode.Conflict && email is not null)
            response = await client.PostAsJsonAsync("v1/auth/login", new { email, password = Password }, ApiFactory.Json);
        response.EnsureSuccessStatusCode();
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>(ApiFactory.Json))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return (client, auth);
    }

    public async Task<HttpClient> AdminAsync() => (await RegisterAsync(AdminEmail, "Admin")).Client;

    /// <summary>A user with a handle, a closet visibility and (optionally) three style tags.</summary>
    public async Task<TestUser> UserAsync(ClosetVisibility visibility = ClosetVisibility.Public, StyleTag[]? tags = null, string name = "Ayşe Yılmaz")
    {
        var (client, auth) = await RegisterAsync(name: name);
        var handle = Unique();
        (await client.PutJsonAsync("v1/tenant/profile/handle", new { handle })).EnsureSuccessStatusCode();
        if (visibility != ClosetVisibility.Private)
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

public sealed record TestUser(HttpClient Client, string TenantId, string UserId, string Handle);

public sealed class FakeClosetReader : IClosetReader
{
    private readonly Dictionary<string, List<ClosetItem>> _items = [];
    private readonly Dictionary<string, List<ClosetLook>> _looks = [];
    private readonly Dictionary<string, List<ClosetTrip>> _trips = [];

    public string AddLook(string tenantId, DateTime? createdAt = null, string? productId = null)
    {
        var id = Domain.Extensions.Ulid.New(createdAt);
        var pieces = new List<ClosetLookPiece> { new(ProductSlot.Top, "item-1", null, "Beyaz gömlek", "https://signed.example/item-1") };
        if (productId is not null)
            pieces.Add(new ClosetLookPiece(ProductSlot.Bag, null, productId));
        lock (_looks)
        {
            if (!_looks.TryGetValue(tenantId, out var list)) _looks[tenantId] = list = [];
            list.Add(new ClosetLook(id, "Ofis", "office", createdAt ?? DateTime.UtcNow, pieces));
        }
        return id;
    }

    public void AddItem(string tenantId, string id, ProductCategory category, params string[] colors)
    {
        lock (_items)
        {
            if (!_items.TryGetValue(tenantId, out var list)) _items[tenantId] = list = [];
            list.Add(new ClosetItem(id, id, category, colors, $"https://signed.example/{id}"));
        }
    }

    public void AddTrip(string tenantId, string id)
    {
        lock (_trips)
        {
            if (!_trips.TryGetValue(tenantId, out var list)) _trips[tenantId] = list = [];
            list.Add(new ClosetTrip(id, "Paris", "2026-10"));
        }
    }

    public Task<IReadOnlyList<ClosetItem>> GetItemsAsync(string tenantId, CancellationToken ct)
    {
        lock (_items) return Task.FromResult<IReadOnlyList<ClosetItem>>(_items.GetValueOrDefault(tenantId)?.ToList() ?? []);
    }

    public Task<IReadOnlyList<ClosetLook>> GetLooksAsync(string tenantId, CancellationToken ct)
    {
        lock (_looks) return Task.FromResult<IReadOnlyList<ClosetLook>>(_looks.GetValueOrDefault(tenantId)?.OrderByDescending(l => l.CreatedAt).ToList() ?? []);
    }

    public async Task<ClosetLook?> GetLookAsync(string tenantId, string lookId, CancellationToken ct) =>
        (await GetLooksAsync(tenantId, ct)).FirstOrDefault(l => l.Id == lookId);

    public Task<IReadOnlyList<ClosetTrip>> GetCompletedTripsAsync(string tenantId, CancellationToken ct)
    {
        lock (_trips) return Task.FromResult<IReadOnlyList<ClosetTrip>>(_trips.GetValueOrDefault(tenantId)?.ToList() ?? []);
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
