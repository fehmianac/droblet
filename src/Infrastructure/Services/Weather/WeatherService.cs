using Domain.Entity;
using Domain.Entity.Base;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Weather;

/// <summary>
/// Forecasts through a global cache (WeatherForecastEntity, TTL): one provider call per location per
/// Weather:CacheMinutes whatever the number of users. A stale cache is served when the provider is down.
/// </summary>
public sealed class WeatherService(
    IRepository repository,
    IWeatherProvider provider,
    IRequestLanguage requestLanguage,
    IOptionsMonitor<WeatherOptions> options,
    TimeProvider timeProvider,
    ILogger<WeatherService> logger) : IWeatherService
{
    private const int CitySearchCount = 8;
    private static readonly TimeSpan StaleGrace = TimeSpan.FromDays(1);

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<CityDto?> GetCityAsync(string cityId, CancellationToken ct)
    {
        var city = await repository.GetAsync<CityEntity>(CityEntity.GetPk(), CityEntity.GetSk(cityId), ct);
        return city is null ? null : ToDto(city, await requestLanguage.GetAsync(ct));
    }

    public async Task<IReadOnlyList<CityDto>> SearchCitiesAsync(string query, CancellationToken ct)
    {
        var language = await requestLanguage.GetAsync(ct);
        IReadOnlyList<CityDto> cities;
        try
        {
            cities = await provider.SearchCitiesAsync(query.Trim(), language, CitySearchCount, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "City search failed");
            throw new WeatherUnavailableException("City search is unavailable.", ex);
        }

        // Remember what was offered, so a chosen cityId resolves to coordinates without another provider call.
        // Names are kept per language: each search adds the names of its own language to the city record.
        if (cities.Count > 0)
        {
            var now = Now;
            var known = (await repository.BatchGetAsync(cities.Select(c => new CityEntity { Id = c.Id }).ToList(), ct)).ToDictionary(c => c.Id);
            var rows = new List<IEntity>();
            foreach (var c in cities)
            {
                var row = known.GetValueOrDefault(c.Id) ?? new CityEntity { Id = c.Id };
                row.Name[language] = c.Name;
                if (c.Region is not null) (row.Region ??= [])[language] = c.Region;
                if (c.Country is not null) (row.Country ??= [])[language] = c.Country;
                row.CountryCode = c.CountryCode;
                row.Latitude = c.Latitude;
                row.Longitude = c.Longitude;
                row.TimeZone = c.TimeZone;
                row.UpdatedAt = now;
                rows.Add(row);
            }
            await repository.BatchWriteAsync(rows, ct);
        }
        return cities;
    }

    public async Task<WeatherForecast?> GetForecastByCityAsync(string cityId, int days, CancellationToken ct)
    {
        var city = await GetCityAsync(cityId, ct);
        if (city is null)
            return null;
        return await ForecastAsync(WeatherRules.CityKey(cityId), city, city.Latitude, city.Longitude, days, ct);
    }

    public Task<WeatherForecast> GetForecastByLocationAsync(double latitude, double longitude, int days, CancellationToken ct)
    {
        var lat = WeatherRules.RoundCoordinate(latitude);
        var lon = WeatherRules.RoundCoordinate(longitude);
        return ForecastAsync(WeatherRules.LocationKey(lat, lon), null, lat, lon, days, ct);
    }

    private async Task<WeatherForecast> ForecastAsync(string locationKey, CityDto? city, double latitude, double longitude, int days, CancellationToken ct)
    {
        days = WeatherRules.ClampDays(days);
        var now = Now;
        var cached = await LatestBatchAsync(locationKey, ct);
        if (cached.Count >= days && now - cached[0].FetchedAt < TimeSpan.FromMinutes(options.CurrentValue.CacheMinutes))
            return ToForecast(locationKey, city, cached, days);

        IReadOnlyList<DailyForecast> fresh;
        try
        {
            fresh = await provider.GetDailyAsync(latitude, longitude, IWeatherService.MaxDays, ct);
            if (fresh.Count == 0)
                throw new WeatherUnavailableException("The provider returned no forecast.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Weather provider failed for {LocationKey}", locationKey);
            if (cached.Count > 0)
                return ToForecast(locationKey, city, cached, days); // stale beats nothing
            throw ex as WeatherUnavailableException ?? new WeatherUnavailableException("Weather is unavailable.", ex);
        }

        var ttl = now.AddMinutes(options.CurrentValue.CacheMinutes).Add(StaleGrace).ToUnixTimeSeconds();
        var rows = fresh.Select(d => new WeatherForecastEntity
        {
            LocationKey = locationKey, Date = d.Date, MinC = d.MinC, MaxC = d.MaxC, Condition = d.Condition, WeatherCode = d.WeatherCode,
            PrecipitationProbability = d.PrecipitationProbability, FetchedAt = now, Ttl = ttl,
        }).ToList();
        await repository.BatchWriteAsync(rows.Cast<IEntity>().ToList(), ct);
        return ToForecast(locationKey, city, rows, days);
    }

    /// <summary>Rows of the most recent fetch, by date. Older days still waiting for their TTL are ignored.</summary>
    private async Task<List<WeatherForecastEntity>> LatestBatchAsync(string locationKey, CancellationToken ct)
    {
        var rows = await repository.GetAllAsync<WeatherForecastEntity>(WeatherForecastEntity.GetPk(locationKey), ct);
        if (rows.Count == 0)
            return rows;
        var latest = rows.Max(r => r.FetchedAt);
        return rows.Where(r => r.FetchedAt == latest).OrderBy(r => r.Date, StringComparer.Ordinal).ToList();
    }

    private static WeatherForecast ToForecast(string locationKey, CityDto? city, List<WeatherForecastEntity> rows, int days) =>
        new(locationKey, city, rows[0].FetchedAt, rows.Take(days)
            .Select(r => new DailyForecast(r.Date, r.MinC, r.MaxC, r.Condition, r.WeatherCode, r.PrecipitationProbability)).ToList());

    private CityDto ToDto(CityEntity c, string language) => new(
        c.Id,
        LocalizedText.Resolve(c.Name, language, requestLanguage.Default) ?? "",
        LocalizedText.Resolve(c.Region, language, requestLanguage.Default),
        LocalizedText.Resolve(c.Country, language, requestLanguage.Default),
        c.CountryCode, c.Latitude, c.Longitude, c.TimeZone);
}
