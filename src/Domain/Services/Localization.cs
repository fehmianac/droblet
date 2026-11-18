using System.Globalization;

namespace Domain.Options
{
    /// <summary>
    /// Supported UI / content languages (owner requirement: TR and EN first, more later). Adding a language is a config
    /// change (/droblet/{stage}/api/Localization) plus data — no code lists languages anywhere else.
    /// </summary>
    public sealed class LocalizationOptions
    {
        public const string Section = "Localization";
        private static readonly string[] Fallback = ["tr", "en"];

        /// <summary>Empty = tr, en. (Kept empty by default so configuration replaces the list instead of appending to it.)</summary>
        public List<string> SupportedLanguages { get; set; } = [];
        public string DefaultLanguage { get; set; } = "tr";

        public IReadOnlyList<string> Languages =>
            SupportedLanguages.Count > 0 ? SupportedLanguages.Select(l => l.Trim().ToLowerInvariant()).Distinct().ToList() : Fallback;

        public bool IsSupported(string? language) => language is not null && Languages.Contains(language, StringComparer.Ordinal);
    }
}

namespace Domain.Services
{
    /// <summary>
    /// Language of the current request: profile language → Accept-Language → default. Outside a request: the default.
    /// The API never returns prose of its own — only stored content resolved with this, and stable codes / enums.
    /// </summary>
    public interface IRequestLanguage
    {
        Task<string> GetAsync(CancellationToken ct);
        string Default { get; }
    }

    /// <summary>Localized stored content: a map { "tr": "…", "en": "…" }.</summary>
    public static class LocalizedText
    {
        public static string? Resolve(IReadOnlyDictionary<string, string>? text, string language, string defaultLanguage)
        {
            if (text is null || text.Count == 0)
                return null;
            if (text.TryGetValue(language, out var exact) && !string.IsNullOrWhiteSpace(exact))
                return exact;
            if (text.TryGetValue(defaultLanguage, out var fallback) && !string.IsNullOrWhiteSpace(fallback))
                return fallback;
            return text.Values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
        }

        public static Dictionary<string, string> Normalize(IReadOnlyDictionary<string, string>? text) =>
            text?.Where(p => !string.IsNullOrWhiteSpace(p.Value))
                .GroupBy(p => p.Key.Trim().ToLowerInvariant())
                .ToDictionary(g => g.Key, g => g.First().Value.Trim(), StringComparer.Ordinal) ?? [];

        public static Dictionary<string, string>? NormalizeOptional(IReadOnlyDictionary<string, string>? text) =>
            Normalize(text) is { Count: > 0 } map ? map : null;

        /// <summary>
        /// Valid when every key is a supported language and no value exceeds maxLength; when required, the default
        /// language must be present (it is the fallback of every other language).
        /// </summary>
        public static bool IsValid(IReadOnlyDictionary<string, string>? text, bool required, int maxLength, IReadOnlyList<string> languages, string defaultLanguage)
        {
            var map = Normalize(text);
            if (text is not null && text.Keys.Any(k => !languages.Contains(k.Trim().ToLowerInvariant(), StringComparer.Ordinal)))
                return false;
            if (map.Values.Any(v => v.Length > maxLength))
                return false;
            return !required || map.ContainsKey(defaultLanguage);
        }

        /// <summary>First supported language of an Accept-Language header, by q weight ("en-US,en;q=0.9,tr;q=0.8" → en).</summary>
        public static string? Negotiate(string? acceptLanguage, IReadOnlyList<string> languages)
        {
            if (string.IsNullOrWhiteSpace(acceptLanguage))
                return null;
            return acceptLanguage.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select((part, index) =>
                {
                    var pieces = part.Split(';', StringSplitOptions.TrimEntries);
                    var q = pieces.Skip(1).FirstOrDefault(p => p.StartsWith("q=", StringComparison.OrdinalIgnoreCase)) is { } weight
                            && double.TryParse(weight[2..], NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : 1.0;
                    return (Language: pieces[0].Split('-')[0].ToLowerInvariant(), Q: q, Index: index);
                })
                .Where(x => x.Q > 0 && languages.Contains(x.Language, StringComparer.Ordinal))
                .OrderByDescending(x => x.Q).ThenBy(x => x.Index)
                .Select(x => x.Language)
                .FirstOrDefault();
        }
    }
}
