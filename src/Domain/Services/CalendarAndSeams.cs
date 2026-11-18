using System.Globalization;
using Domain.Enum;
using Domain.Services.Ai;

namespace Domain.Services;

/// <summary>Calendar days are the user's local day as yyyy-MM-dd (rule 23) — never an instant.</summary>
public static class CalendarDay
{
    public const string Format = "yyyy-MM-dd";
    public const string MonthFormat = "yyyy-MM";

    public static bool TryParse(string? value, out DateOnly date) =>
        DateOnly.TryParseExact(value, Format, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    public static bool IsValid(string? value) => TryParse(value, out _);

    public static DateOnly Parse(string value) => DateOnly.ParseExact(value, Format, CultureInfo.InvariantCulture);

    public static string ToText(DateOnly date) => date.ToString(Format, CultureInfo.InvariantCulture);

    public static bool TryParseMonth(string? value, out DateOnly firstDay) =>
        DateOnly.TryParseExact(value, MonthFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out firstDay);

    /// <summary>Inclusive list of days; empty when to &lt; from.</summary>
    public static IReadOnlyList<string> Range(DateOnly from, DateOnly to)
    {
        var days = new List<string>();
        for (var day = from; day <= to; day = day.AddDays(1))
            days.Add(ToText(day));
        return days;
    }
}

/// <summary>
/// Languages and localized reference text. The Api never returns user-facing prose of its own: only codes / enums,
/// AI-generated text (in the user's language, stored with that language) and reference names stored as a
/// { "tr": "…", "en": "…" } map that is resolved per request with a Turkish fallback. A third language is data only.
/// </summary>
public static class Localized
{
    public const string Default = "tr";
    public static readonly IReadOnlyList<string> Supported = ["tr", "en"];

    public static IReadOnlyDictionary<string, string> Of(string tr, string en) =>
        new Dictionary<string, string>(StringComparer.Ordinal) { ["tr"] = tr, ["en"] = en };

    /// <summary>Profile language first, then the request's Accept-Language, then Turkish.</summary>
    public static string Language(string? profileLanguage, string? requestLanguage = null) =>
        Normalize(profileLanguage) ?? Normalize(requestLanguage) ?? Default;

    public static string? Normalize(string? language)
    {
        if (string.IsNullOrWhiteSpace(language))
            return null;
        var primary = language.Trim().Split(',', ';', '-', '_')[0].ToLowerInvariant();
        return Supported.Contains(primary) ? primary : null;
    }

    public static string Resolve(IReadOnlyDictionary<string, string>? names, string? language)
    {
        if (names is null || names.Count == 0)
            return "";
        if (Normalize(language) is { } wanted && names.TryGetValue(wanted, out var text) && !string.IsNullOrWhiteSpace(text))
            return text;
        return names.TryGetValue(Default, out var fallback) && !string.IsNullOrWhiteSpace(fallback) ? fallback : names.Values.First();
    }
}

public static class SeasonRules
{
    /// <summary>Meteorological season, northern hemisphere (market: Türkiye).</summary>
    public static Season For(DateOnly date) => date.Month switch
    {
        3 or 4 or 5 => Season.Spring,
        6 or 7 or 8 => Season.Summer,
        9 or 10 or 11 => Season.Autumn,
        _ => Season.Winter,
    };
}

// ── Weather seam (E4). The weather provider (A-4) is implemented elsewhere; until then the null service answers "unknown".

public sealed record WeatherQuery(string? CityId, double? Latitude, double? Longitude, string From, string To);

public sealed record DailyForecast(string Date, int MinTempC, int MaxTempC, WeatherCondition Condition, int? PrecipitationChance = null);

public interface IWeatherService
{
    /// <summary>Daily forecast for the inclusive day range. Missing days are simply absent; an empty list = weather unknown.</summary>
    Task<IReadOnlyList<DailyForecast>> GetForecastAsync(WeatherQuery query, CancellationToken ct);
}

public sealed class NullWeatherService : IWeatherService
{
    public Task<IReadOnlyList<DailyForecast>> GetForecastAsync(WeatherQuery query, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<DailyForecast>>([]);
}

// ── Catalog seam (E8 is built elsewhere). Wardrobe, looks, stylist and try-on only need this read-only snapshot.

/// <summary>The part of a catalog product the wardrobe side needs. Retired products are never offered for new references.</summary>
public sealed record ProductSnapshot(
    string Id,
    string Name,
    string? BrandId,
    string? BrandName,
    ItemCategory Category,
    IReadOnlyList<string> ColorIds,
    string? Fabric,
    IReadOnlyList<Season> Seasons,
    string? ImageKey,
    bool Retired);

public interface ICatalogProductLookup
{
    Task<ProductSnapshot?> GetAsync(string productId, CancellationToken ct);
    /// <summary>Garment image bytes for try-on (global, background-removed asset). null = not available.</summary>
    Task<ImageInput?> ReadImageAsync(ProductSnapshot product, CancellationToken ct);
}

/// <summary>Editorial look -> its catalog products (try-on target kind EditLook). null = unknown look.</summary>
public interface IEditLookLookup
{
    Task<IReadOnlyList<string>?> GetProductIdsAsync(string editLookId, CancellationToken ct);
}

public sealed class NullEditLookLookup : IEditLookLookup
{
    public Task<IReadOnlyList<string>?> GetProductIdsAsync(string editLookId, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<string>?>(null);
}

// ── Service result shared by the E2–E7 services (the Api maps Kind to an HTTP status in one place).

public enum ResultKind { Ok, Created, Accepted, NoContent, NotFound, Conflict, Invalid, Forbidden, PaymentRequired }

public sealed record ServiceResult<T>(ResultKind Kind, T? Value = default, string? Code = null)
{
    public bool IsSuccess => Kind is ResultKind.Ok or ResultKind.Created or ResultKind.Accepted or ResultKind.NoContent;
}

public static class ServiceResult
{
    public static ServiceResult<T> Ok<T>(T value) => new(ResultKind.Ok, value);
    public static ServiceResult<T> Created<T>(T value) => new(ResultKind.Created, value);
    public static ServiceResult<T> Accepted<T>(T value) => new(ResultKind.Accepted, value);
    public static ServiceResult<T> NoContent<T>() => new(ResultKind.NoContent);
    public static ServiceResult<T> NotFound<T>(string? code = null) => new(ResultKind.NotFound, default, code);
    /// <summary>Version conflict: carries the current record (409 body) — or a code for uniqueness conflicts.</summary>
    public static ServiceResult<T> Conflict<T>(T? current, string? code = null) => new(ResultKind.Conflict, current, code);
    public static ServiceResult<T> Invalid<T>(string code) => new(ResultKind.Invalid, default, code);
    public static ServiceResult<T> Forbidden<T>(string code) => new(ResultKind.Forbidden, default, code);
    public static ServiceResult<T> PaymentRequired<T>(string code) => new(ResultKind.PaymentRequired, default, code);
}
