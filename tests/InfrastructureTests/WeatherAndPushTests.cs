using System.Net;
using System.Security.Cryptography;
using System.Text;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Infrastructure.Services.Providers;
using Infrastructure.Services.Weather;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Tests.Shared;

namespace InfrastructureTests;

internal sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    public List<(HttpMethod Method, Uri Uri, string? Body, string? Authorization)> Requests { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        Requests.Add((request.Method, request.RequestUri!, body, request.Headers.Authorization?.ToString()));
        return respond(request);
    }

    public static HttpResponseMessage Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
}

internal sealed class FixedLanguage(string language) : IRequestLanguage
{
    public string Default => "tr";
    public Task<string> GetAsync(CancellationToken ct) => Task.FromResult(language);
}

public class OpenMeteoWeatherProviderTests
{
    private const string ForecastJson = """
        {"latitude":41.0,"longitude":29.0,"timezone":"Europe/Istanbul",
         "daily":{"time":["2026-11-18","2026-11-19","2026-11-20"],
                  "weather_code":[61,3,null],
                  "temperature_2m_max":[15.26,17.0,12.5],
                  "temperature_2m_min":[8.04,9.5,null],
                  "precipitation_probability_max":[70,null,10]}}
        """;

    private const string GeocodingJson = """
        {"results":[
          {"id":745044,"name":"İstanbul","latitude":41.01384,"longitude":28.94966,"country_code":"TR","country":"Türkiye","admin1":"İstanbul","timezone":"Europe/Istanbul"},
          {"id":1,"name":"No coordinates"}]}
        """;

    private static (OpenMeteoWeatherProvider Provider, StubHandler Handler) Create(Func<HttpRequestMessage, HttpResponseMessage> respond)
    {
        var handler = new StubHandler(respond);
        return (new OpenMeteoWeatherProvider(new HttpClient(handler), Fixtures.Monitor(new WeatherOptions())), handler);
    }

    [Fact]
    public async Task GetDaily_ParsesDays_MapsWmoCodes_SkipsIncompleteDays_SendsNoKey()
    {
        var (provider, handler) = Create(_ => StubHandler.Json(ForecastJson));

        var days = await provider.GetDailyAsync(41.0, 29.0, 7, default);

        Assert.Equal(2, days.Count); // the third day has no minimum
        Assert.Equal(new DailyForecast("2026-11-18", 8.0, 15.3, WeatherCondition.Rain, 61, 70), days[0]);
        Assert.Equal(new DailyForecast("2026-11-19", 9.5, 17.0, WeatherCondition.Cloudy, 3, null), days[1]);
        var uri = handler.Requests.Single().Uri;
        Assert.Equal("api.open-meteo.com", uri.Host);
        Assert.Contains("latitude=41.0&longitude=29.0", uri.Query);
        Assert.Contains("forecast_days=7", uri.Query);
        Assert.Contains("timezone=auto", uri.Query);
        Assert.DoesNotContain("key", uri.Query, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SearchCities_ParsesResults_PassesLanguage_EmptyWhenNoResults()
    {
        var (provider, handler) = Create(_ => StubHandler.Json(GeocodingJson));
        var (emptyProvider, _) = Create(_ => StubHandler.Json("""{"generationtime_ms":0.3}"""));

        var cities = await provider.SearchCitiesAsync("İst an", "tr", 8, default);
        var none = await emptyProvider.SearchCitiesAsync("zzzz", "en", 8, default);

        Assert.Equal(new CityDto("745044", "İstanbul", "İstanbul", "Türkiye", "TR", 41.01384, 28.94966, "Europe/Istanbul"), Assert.Single(cities));
        Assert.Empty(none);
        var uri = handler.Requests.Single().Uri;
        Assert.Equal("geocoding-api.open-meteo.com", uri.Host);
        Assert.Contains("language=tr", uri.Query);
        Assert.Contains("name=%C4%B0st%20an", uri.Query);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests, "{}")]
    [InlineData(HttpStatusCode.OK, "not json")]
    [InlineData(HttpStatusCode.OK, "{\"reason\":\"no daily\"}")]
    public async Task ProviderProblems_BecomeWeatherUnavailable(HttpStatusCode status, string body)
    {
        var (provider, _) = Create(_ => StubHandler.Json(body, status));

        await Assert.ThrowsAsync<WeatherUnavailableException>(() => provider.GetDailyAsync(41, 29, 7, default));
    }

    [Fact]
    public async Task NetworkFailure_BecomesWeatherUnavailable()
    {
        var (provider, _) = Create(_ => throw new HttpRequestException("dns"));

        await Assert.ThrowsAsync<WeatherUnavailableException>(() => provider.SearchCitiesAsync("ist", "tr", 8, default));
    }
}

public class WeatherServiceTests
{
    private sealed class CountingProvider : IWeatherProvider
    {
        public int Calls;
        public bool Down;
        /// <summary>Days at the end of the horizon the provider leaves empty (Open-Meteo: the last ~2 of 16).</summary>
        public int MissingTail;

        public Task<IReadOnlyList<DailyForecast>> GetDailyAsync(double latitude, double longitude, int days, CancellationToken ct)
        {
            if (Down) throw new WeatherUnavailableException("down");
            Calls++;
            return Task.FromResult<IReadOnlyList<DailyForecast>>(Enumerable.Range(0, days - MissingTail)
                .Select(i => new DailyForecast($"2026-11-{18 + i:00}", Calls, 20, WeatherCondition.Clear, 0, null)).ToList());
        }

        public Task<IReadOnlyList<CityDto>> SearchCitiesAsync(string query, string language, int count, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<CityDto>>([new CityDto("745044", language == "en" ? "Istanbul" : "İstanbul", null, language == "en" ? "Turkey" : "Türkiye", "TR", 41.01, 28.95, "Europe/Istanbul")]);
    }

    private static (WeatherService Service, CountingProvider Provider, InMemoryRepository Repository, FakeTimeProvider Clock) Create(string language = "tr")
    {
        var repository = new InMemoryRepository();
        var provider = new CountingProvider();
        var clock = Fixtures.Clock();
        var service = new WeatherService(repository, provider, new FixedLanguage(language), Fixtures.Monitor(new WeatherOptions { CacheMinutes = 60 }), clock, NullLogger<WeatherService>.Instance);
        return (service, provider, repository, clock);
    }

    [Fact]
    public async Task Forecast_IsCachedForCacheMinutes_ThenRefreshed_WithTtlOnEveryRow()
    {
        var (service, provider, repository, clock) = Create();

        var first = await service.GetForecastByLocationAsync(41.0082, 28.9784, 7, default);
        clock.Advance(TimeSpan.FromMinutes(59));
        var cached = await service.GetForecastByLocationAsync(41.01, 28.96, 3, default);
        clock.Advance(TimeSpan.FromMinutes(2));
        var refreshed = await service.GetForecastByLocationAsync(41.0082, 28.9784, 7, default);

        Assert.Equal(2, provider.Calls);
        Assert.Equal(7, first.Days.Count);
        Assert.Equal(3, cached.Days.Count);
        Assert.Equal(first.FetchedAt, cached.FetchedAt);
        Assert.Equal(2, refreshed.Days[0].MinC);                                      // values of the second fetch
        var rows = await repository.GetAllAsync<WeatherForecastEntity>(WeatherForecastEntity.GetPk("geo:41.0:29.0"));
        Assert.Equal(IWeatherService.HorizonDays, rows.Count);                        // the whole provider horizon is cached
        Assert.All(rows, r => Assert.True(r.Ttl > clock.GetUtcNow().ToUnixTimeSeconds()));
    }

    [Fact]
    public async Task AShortHorizon_IsStillServedFromTheCache_ButALegacySevenDayBatchIsRefetchedForMoreDays()
    {
        var (service, provider, repository, _) = Create();
        provider.MissingTail = 2;                                                     // 16 asked, 14 complete

        var first = await service.GetForecastByLocationAsync(41, 29, IWeatherService.HorizonDays, default);
        var again = await service.GetForecastByLocationAsync(41, 29, IWeatherService.HorizonDays, default);

        Assert.Equal((1, 14, 14), (provider.Calls, first.Days.Count, again.Days.Count));

        // A batch written by the old 7-day fetch is not the horizon: a longer read fetches again.
        await repository.BatchWriteAsync(Enumerable.Range(0, 7).Select(i => (Domain.Entity.Base.IEntity)new WeatherForecastEntity
        {
            LocationKey = "geo:10.0:10.0", Date = $"2026-11-{18 + i:00}", MinC = 1, MaxC = 2, Condition = WeatherCondition.Clear,
            FetchedAt = Fixtures.Now, Ttl = long.MaxValue,
        }).ToList());
        var legacy = await service.GetForecastByLocationAsync(10, 10, IWeatherService.HorizonDays, default);
        Assert.Equal((2, 14), (provider.Calls, legacy.Days.Count));
    }

    [Fact]
    public async Task ProviderDown_ServesStaleCache_ThrowsOnlyWhenNothingIsCached()
    {
        var (service, provider, _, clock) = Create();
        await service.GetForecastByLocationAsync(41, 29, 7, default);
        clock.Advance(TimeSpan.FromHours(3));
        provider.Down = true;

        var stale = await service.GetForecastByLocationAsync(41, 29, 7, default);

        Assert.Equal(7, stale.Days.Count);
        await Assert.ThrowsAsync<WeatherUnavailableException>(() => service.GetForecastByLocationAsync(10, 10, 7, default));
    }

    [Fact]
    public async Task Cities_AreRememberedPerLanguage_AndResolveInTheRequestLanguage()
    {
        var (turkish, _, repository, clock) = Create("tr");
        var english = new WeatherService(repository, new CountingProvider(), new FixedLanguage("en"), Fixtures.Monitor(new WeatherOptions()), clock, NullLogger<WeatherService>.Instance);
        var german = new WeatherService(repository, new CountingProvider(), new FixedLanguage("de"), Fixtures.Monitor(new WeatherOptions()), clock, NullLogger<WeatherService>.Instance);

        await turkish.SearchCitiesAsync("ist", default);
        var beforeEnglishSearch = await english.GetCityAsync("745044", default);
        await english.SearchCitiesAsync("ist", default);

        Assert.Equal("İstanbul", beforeEnglishSearch!.Name);                           // falls back to the default language
        Assert.Equal("Istanbul", (await english.GetCityAsync("745044", default))!.Name);
        Assert.Equal("Türkiye", (await turkish.GetCityAsync("745044", default))!.Country);
        Assert.Equal("İstanbul", (await german.GetCityAsync("745044", default))!.Name);
        Assert.Null(await turkish.GetCityAsync("1", default));
        Assert.Null(await turkish.GetForecastByCityAsync("1", 7, default));
        Assert.Equal("city:745044", (await turkish.GetForecastByCityAsync("745044", 2, default))!.LocationKey);
    }
}

public class FcmPushProviderTests
{
    private static FirebaseServiceAccountOptions Account()
    {
        using var rsa = RSA.Create(2048);
        return new FirebaseServiceAccountOptions { ProjectId = "droblet-test", ClientEmail = "push@droblet-test.iam.gserviceaccount.com", PrivateKey = rsa.ExportPkcs8PrivateKeyPem() };
    }

    private static readonly PushMessage Message = new("device-token", "Haftanın edit'i yayında", "Bu haftanın yedi look'una göz at.", new Dictionary<string, string> { ["type"] = "weekly_edit" });

    private static (FcmPushProvider Provider, StubHandler Handler) Create(FirebaseServiceAccountOptions account, Func<HttpRequestMessage, HttpResponseMessage> send)
    {
        var handler = new StubHandler(request => request.RequestUri!.Host == "oauth2.googleapis.com"
            ? StubHandler.Json("""{"access_token":"ya29.test","expires_in":3600,"token_type":"Bearer"}""")
            : send(request));
        return (new FcmPushProvider(new HttpClient(handler), Fixtures.Monitor(account), Fixtures.Clock(), NullLogger<FcmPushProvider>.Instance), handler);
    }

    [Fact]
    public async Task NotConfigured_SendsNothing()
    {
        var (provider, handler) = Create(new FirebaseServiceAccountOptions(), _ => StubHandler.Json("{}"));

        Assert.Equal(PushResult.NotConfigured, await provider.SendAsync(Message, default));
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Send_ExchangesAServiceAccountJwtOnce_ThenCallsMessagesSendWithBearer()
    {
        var (provider, handler) = Create(Account(), _ => StubHandler.Json("""{"name":"projects/droblet-test/messages/1"}"""));

        var first = await provider.SendAsync(Message, default);
        var second = await provider.SendAsync(Message, default);

        Assert.Equal((PushResult.Sent, PushResult.Sent), (first, second));
        Assert.Equal(3, handler.Requests.Count);                                      // one token exchange, two sends
        var token = handler.Requests[0];
        Assert.Contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer", token.Body);
        var assertion = new Microsoft.IdentityModel.JsonWebTokens.JsonWebToken(Uri.UnescapeDataString(token.Body!.Split("assertion=")[1]));
        Assert.Equal("push@droblet-test.iam.gserviceaccount.com", assertion.Issuer);
        Assert.Equal("https://www.googleapis.com/auth/firebase.messaging", assertion.GetClaim("scope").Value);
        Assert.Equal("RS256", assertion.Alg);
        var send = handler.Requests[1];
        Assert.Equal("https://fcm.googleapis.com/v1/projects/droblet-test/messages:send", send.Uri.ToString());
        Assert.Equal("Bearer ya29.test", send.Authorization);
        Assert.Contains("\"token\":\"device-token\"", send.Body);
        Assert.Contains("\"type\":\"weekly_edit\"", send.Body);
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound, """{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}""", PushResult.Unregistered)]
    [InlineData(HttpStatusCode.BadRequest, """{"error":{"status":"INVALID_ARGUMENT"}}""", PushResult.Failed)]
    [InlineData(HttpStatusCode.ServiceUnavailable, "{}", PushResult.Failed)]
    public async Task Send_MapsProviderErrors(HttpStatusCode status, string body, PushResult expected)
    {
        var (provider, _) = Create(Account(), _ => StubHandler.Json(body, status));

        Assert.Equal(expected, await provider.SendAsync(Message, default));
    }

    [Fact]
    public async Task Send_NetworkFailure_IsFailed_NotAnException()
    {
        var (provider, _) = Create(Account(), _ => throw new HttpRequestException("down"));

        Assert.Equal(PushResult.Failed, await provider.SendAsync(Message, default));
    }
}
