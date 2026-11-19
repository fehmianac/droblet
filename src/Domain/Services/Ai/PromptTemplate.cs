using System.Text.RegularExpressions;

namespace Domain.Services.Ai;

/// <summary>
/// Prompt templates with <c>{{name}}</c> placeholders (letters and digits, starting with a letter). Rendering is one
/// pass: a value that itself contains <c>{{…}}</c> is never expanded again. Pure; used by the code defaults, the
/// registry overrides and the admin validation alike.
/// </summary>
public static partial class PromptTemplate
{
    [GeneratedRegex(@"\{\{([A-Za-z][A-Za-z0-9]*)\}\}")]
    private static partial Regex PlaceholderPattern();

    /// <summary>Any "{{" or "}}" that is not part of a well-formed placeholder.</summary>
    [GeneratedRegex(@"\{\{|\}\}")]
    private static partial Regex BracePattern();

    public static string Token(string name) => "{{" + name + "}}";

    public static string Render(string template, IReadOnlyDictionary<string, string>? values) =>
        values is null || values.Count == 0
            ? template
            : PlaceholderPattern().Replace(template, m => values.TryGetValue(m.Groups[1].Value, out var value) ? value : m.Value);

    public static string Render(string template, params (string Name, string Value)[] values) =>
        Render(template, values.ToDictionary(v => v.Name, v => v.Value, StringComparer.Ordinal));

    /// <summary>Placeholder names in order of first appearance (distinct).</summary>
    public static IReadOnlyList<string> Placeholders(string template) =>
        PlaceholderPattern().Matches(template).Select(m => m.Groups[1].Value).Distinct(StringComparer.Ordinal).ToList();

    /// <summary>Offset of the first placeholder (= length of the static prefix), or the template length when there is none.</summary>
    public static int StaticPrefixLength(string template) =>
        PlaceholderPattern().Match(template) is { Success: true } m ? m.Index : template.Length;

    /// <summary>True when the template has a "{{" or "}}" outside a well-formed placeholder (e.g. "{{ name }}", "{{name").</summary>
    public static bool HasMalformedPlaceholder(string template)
    {
        var stripped = PlaceholderPattern().Replace(template, "");
        return BracePattern().IsMatch(stripped);
    }
}
