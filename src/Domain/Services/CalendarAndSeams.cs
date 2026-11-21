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
/// The supported languages and the default one — always the Localization config (Localization:SupportedLanguages /
/// Localization:DefaultLanguage, SSM /droblet/{stage}/…/Localization). No code lists languages anywhere else:
/// adding a language is a config change plus data.
/// </summary>
public sealed class LanguagePolicy
{
    public static readonly LanguagePolicy BuiltIn = new(["tr", "en"], "tr");

    public IReadOnlyList<string> Supported { get; }
    public string Default { get; }

    public LanguagePolicy(IEnumerable<string>? supported, string? defaultLanguage)
    {
        var languages = (supported ?? []).Select(Code).Where(l => l.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        if (languages.Count == 0)
            languages = ["tr", "en"];
        var fallback = Code(defaultLanguage);
        // The default language is always supported: it is the fallback of every other one.
        Default = fallback.Length == 0 ? languages[0] : fallback;
        if (!languages.Contains(Default, StringComparer.Ordinal))
            languages.Insert(0, Default);
        Supported = languages;
    }

    public static LanguagePolicy From(Options.LocalizationOptions options) => new(options.SupportedLanguages, options.DefaultLanguage);

    public bool IsSupported(string? language) => language is not null && Supported.Contains(language, StringComparer.Ordinal);

    /// <summary>A single language tag ("en", "en-US", "EN_us") → its supported primary code, else null.</summary>
    public string? Normalize(string? language)
    {
        if (string.IsNullOrWhiteSpace(language))
            return null;
        var primary = Code(language.Trim().Split(',', ';', '-', '_')[0]);
        return IsSupported(primary) ? primary : null;
    }

    /// <summary>First supported language of an Accept-Language header by q weight, else null.</summary>
    public string? Negotiate(string? acceptLanguage) => LocalizedText.Negotiate(acceptLanguage, Supported);

    /// <summary>Profile language first, then the request's Accept-Language, then the default.</summary>
    public string Language(string? profileLanguage, string? acceptLanguage = null) =>
        Normalize(profileLanguage) ?? Negotiate(acceptLanguage) ?? Default;

    private static string Code(string? value) => (value ?? "").Trim().ToLowerInvariant();
}

/// <summary>
/// Languages and localized reference text. The Api never returns user-facing prose of its own: only codes / enums,
/// AI-generated text (in the user's language, stored with that language) and reference names stored as a
/// { "tr": "…", "en": "…" } map that is resolved per request with a default-language fallback. A third language is
/// config + data only. <see cref="Policy"/> is set once at start-up from the Localization options (AddDrobletCore).
/// </summary>
public static class Localized
{
    /// <summary>Built-in default: record defaults and the mandatory key of seed files. Runtime checks use <see cref="Policy"/>.</summary>
    public const string Default = "tr";

    private static volatile LanguagePolicy _policy = LanguagePolicy.BuiltIn;

    public static LanguagePolicy Policy => _policy;

    public static void Configure(Options.LocalizationOptions options) => _policy = LanguagePolicy.From(options);

    public static IReadOnlyDictionary<string, string> Of(string tr, string en) =>
        new Dictionary<string, string>(StringComparer.Ordinal) { ["tr"] = tr, ["en"] = en };

    /// <summary>Profile language first, then the request's Accept-Language, then the default language.</summary>
    public static string Language(string? profileLanguage, string? requestLanguage = null) => _policy.Language(profileLanguage, requestLanguage);

    public static string? Normalize(string? language) => _policy.Normalize(language);

    public static string Resolve(IReadOnlyDictionary<string, string>? names, string? language)
    {
        if (names is null || names.Count == 0)
            return "";
        var policy = _policy;
        if (policy.Normalize(language) is { } wanted && names.TryGetValue(wanted, out var text) && !string.IsNullOrWhiteSpace(text))
            return text;
        if (names.TryGetValue(policy.Default, out var fallback) && !string.IsNullOrWhiteSpace(fallback))
            return fallback;
        return names.TryGetValue(Default, out var builtIn) && !string.IsNullOrWhiteSpace(builtIn) ? builtIn : names.Values.First();
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

// ── Weather seam (E4). IWeatherService / DailyForecast live in ISettingsServices.cs (Open-Meteo provider + cache).

public sealed record WeatherQuery(string? CityId, double? Latitude, double? Longitude, string From, string To);

public static class WeatherServiceExtensions
{
    /// <summary>
    /// Daily forecast for the inclusive day range, coordinates first (location permission), then the city.
    /// Missing days are simply absent; an empty list = weather unknown (no location, unknown city, provider down,
    /// or days beyond the provider's horizon). Never throws for a weather failure: weather is context, not a dependency.
    /// </summary>
    public static async Task<IReadOnlyList<DailyForecast>> GetForecastAsync(this IWeatherService weather, WeatherQuery query, CancellationToken ct)
    {
        try
        {
            WeatherForecast? forecast = null;
            if (query.Latitude is { } lat && query.Longitude is { } lon && WeatherRules.IsValidCoordinate(lat, lon))
                forecast = await weather.GetForecastByLocationAsync(lat, lon, IWeatherService.HorizonDays, ct);
            else if (!string.IsNullOrWhiteSpace(query.CityId))
                forecast = await weather.GetForecastByCityAsync(query.CityId, IWeatherService.HorizonDays, ct);
            if (forecast is null)
                return [];
            return forecast.Days
                .Where(d => string.CompareOrdinal(d.Date, query.From) >= 0 && string.CompareOrdinal(d.Date, query.To) <= 0)
                .ToList();
        }
        catch (WeatherUnavailableException)
        {
            return [];
        }
    }
}

// ── Catalog seam. Wardrobe, looks, stylist and try-on only need this read-only snapshot of a catalog product
// (implemented on ICatalogService / IContentService in Infrastructure.Services.Integration).

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

/// <summary>
/// Editorial look -> its catalog products (try-on target kind EditLook). null = unknown look.
/// Id forms: "{editLookId}" (weekly edit look, first price-band variant), "{editLookId}@{priceBand}" (a given variant,
/// e.g. "edit-2026-w47-d1@luxuryTouch") and "{collectionId}/{lookId}" (creator / series collection look).
/// </summary>
public interface IEditLookLookup
{
    Task<IReadOnlyList<string>?> GetProductIdsAsync(string editLookId, CancellationToken ct);
}

// ── Service result shared by the E2–E7 services (the Api maps Kind to an HTTP status in one place).

public enum ResultKind { Ok, Created, Accepted, NoContent, NotFound, Conflict, Invalid, Forbidden, PaymentRequired, TooManyRequests }

public sealed record ServiceResult<T>(ResultKind Kind, T? Value = default, string? Code = null)
{
    /// <summary>Extra ProblemDetails members of a failure (e.g. resetsAt of teen_stylist_daily_limit).</summary>
    public IReadOnlyDictionary<string, object?>? Extensions { get; init; }

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
    public static ServiceResult<T> TooManyRequests<T>(string code) => new(ResultKind.TooManyRequests, default, code);

    /// <summary>
    /// A refused EntitlementDecision: a used-up teen stylist allowance → 429 with resetsAt; anything else → 403 with its code
    /// (premium_required, parental_consent_required, teen_stylist_unavailable…).
    /// </summary>
    public static ServiceResult<T> Denied<T>(EntitlementDecision decision) =>
        decision.ResetsAt is { } resetsAt
            ? new(ResultKind.TooManyRequests, default, decision.Reason) { Extensions = new Dictionary<string, object?> { ["resetsAt"] = resetsAt } }
            : Forbidden<T>(decision.Reason ?? Constant.ErrorCodes.PremiumRequired);
}
