using System.Text.Json;
using System.Text.Json.Serialization;
using Domain.Enum;
using Domain.Services.Ai;

namespace Domain.Services.Styling;

/// <summary>Weather of one day as the stylist model sees it (whole degrees).</summary>
public sealed record PromptWeather(int MinTempC, int MaxTempC, WeatherCondition Condition);

/// <summary>
/// The user message of the three stylist calls (pure; the worker and ops ai-cost build the same prompt). Per-user
/// context first (stable between requests → a cacheable prefix), the request itself last. With compact aliases
/// (Stylist:CompactPrompt) the candidates are descriptor strings, ids are aliases and null fields are left out.
/// </summary>
public static class StylistPrompts
{
    private static readonly JsonSerializerOptions CompactOptions = new(StylingJson.Options) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    private static string Serialize<T>(T value, CandidateAliases aliases) =>
        aliases.Compact ? JsonSerializer.Serialize(value, CompactOptions) : StylingJson.Serialize(value);

    public static string Outfit(CandidateAliases aliases, IEnumerable<CandidateItem> candidates, string language, object? styleProfile, object? palette, int count,
        bool onlyMyWardrobe, IEnumerable<IReadOnlyList<string>> avoidCombinations, string date, Season season, Occasion? occasion, PromptWeather? weather,
        string? freeText, string? pinnedItemId) =>
        Serialize(new
        {
            language,
            styleProfile,
            palette,
            candidates = candidates.Select(aliases.Describe),
            productCandidates = Array.Empty<object>(), // filled by the catalog module ("Parçamı tamamla")
            count,
            onlyMyWardrobe,
            avoidCombinations = aliases.Combinations(avoidCombinations),
            date,
            season,
            occasion,
            weather,
            freeText,
            pinnedItemId = aliases.AliasOrNull(pinnedItemId),
        }, aliases);

    public sealed record WeekDay(string Date, Occasion? Occasion, PromptWeather? Weather);

    public static string Week(CandidateAliases aliases, IEnumerable<CandidateItem> candidates, string language, object? styleProfile, string weekStart,
        IEnumerable<WeekDay> days) =>
        Serialize(new
        {
            language,
            styleProfile,
            candidates = candidates.Select(aliases.Describe),
            weekStart,
            days = days.Select(d => new { d.Date, d.Occasion, weather = d.Weather }),
        }, aliases);

    /// <summary>Suitcase: the trip, one look per date, the expected capsule (CapsuleRules) and the re-wear ratio.</summary>
    public static string Pack(CandidateAliases aliases, IEnumerable<CandidateItem> candidates, string language, object trip, object days, object capsule,
        double minRewearRatio) =>
        Serialize(new
        {
            language,
            candidates = candidates.Select(aliases.Describe),
            trip,
            days,
            capsule,
            minRewearRatio,
        }, aliases);
}
