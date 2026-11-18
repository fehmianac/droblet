using System.Globalization;
using System.Text.Json;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Weather;

/// <summary>
/// Open-Meteo forecast + geocoding over plain HTTPS: no API key, no SDK. PROPOSAL — the provider is an open owner
/// decision (A-4); Open-Meteo's free tier is for non-commercial use, a commercial plan or another provider plugs in
/// behind <see cref="IWeatherProvider"/> without touching callers. Only rounded coordinates are sent.
/// </summary>
public sealed class OpenMeteoWeatherProvider(HttpClient http, IOptionsMonitor<WeatherOptions> options) : IWeatherProvider
{
    public async Task<IReadOnlyList<DailyForecast>> GetDailyAsync(double latitude, double longitude, int days, CancellationToken ct)
    {
        var url = string.Create(CultureInfo.InvariantCulture,
            $"{options.CurrentValue.ForecastBaseUrl.TrimEnd('/')}/v1/forecast?latitude={latitude:0.0###}&longitude={longitude:0.0###}" +
            $"&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days={days}");

        using var document = await GetJsonAsync(url, ct);
        if (!document.RootElement.TryGetProperty("daily", out var daily) || !daily.TryGetProperty("time", out var time))
            throw new WeatherUnavailableException("Unexpected forecast response.");

        var result = new List<DailyForecast>();
        for (var i = 0; i < time.GetArrayLength(); i++)
        {
            var date = time[i].GetString();
            if (date is null || Number(daily, "temperature_2m_min", i) is not { } min || Number(daily, "temperature_2m_max", i) is not { } max)
                continue;
            var code = (int)(Number(daily, "weather_code", i) ?? -1);
            var rain = Number(daily, "precipitation_probability_max", i);
            result.Add(new DailyForecast(date, Math.Round(min, 1), Math.Round(max, 1), WeatherRules.ConditionFromWmo(code), code, rain is null ? null : (int)Math.Round(rain.Value)));
        }
        return result;
    }

    public async Task<IReadOnlyList<CityDto>> SearchCitiesAsync(string query, string language, int count, CancellationToken ct)
    {
        var url = $"{options.CurrentValue.GeocodingBaseUrl.TrimEnd('/')}/v1/search?name={Uri.EscapeDataString(query)}" +
                  $"&count={count.ToString(CultureInfo.InvariantCulture)}&language={Uri.EscapeDataString(language)}&format=json";

        using var document = await GetJsonAsync(url, ct);
        if (!document.RootElement.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array)
            return []; // Open-Meteo omits "results" when nothing matches

        var cities = new List<CityDto>();
        foreach (var r in results.EnumerateArray())
        {
            if (!r.TryGetProperty("id", out var id) || Text(r, "name") is not { } name
                || !r.TryGetProperty("latitude", out var lat) || !r.TryGetProperty("longitude", out var lon))
                continue;
            cities.Add(new CityDto(id.GetRawText().Trim('"'), name, Text(r, "admin1"), Text(r, "country"), Text(r, "country_code"),
                lat.GetDouble(), lon.GetDouble(), Text(r, "timezone")));
        }
        return cities;
    }

    private async Task<JsonDocument> GetJsonAsync(string url, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, options.CurrentValue.TimeoutSeconds)));
        try
        {
            using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode)
                throw new WeatherUnavailableException($"Weather provider answered {(int)response.StatusCode}.");
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            return await JsonDocument.ParseAsync(stream, cancellationToken: timeout.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new WeatherUnavailableException("Weather provider timed out.");
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException)
        {
            throw new WeatherUnavailableException("Weather provider call failed.", ex);
        }
    }

    private static double? Number(JsonElement parent, string property, int index) =>
        parent.TryGetProperty(property, out var array) && array.ValueKind == JsonValueKind.Array && index < array.GetArrayLength()
        && array[index].ValueKind == JsonValueKind.Number
            ? array[index].GetDouble()
            : null;

    private static string? Text(JsonElement parent, string property) =>
        parent.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
