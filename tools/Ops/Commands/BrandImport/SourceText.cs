using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Domain.Services;

namespace Ops.Commands.BrandImport;

/// <summary>Text handling shared by every source: folding for look-ups, Turkish-aware title casing, HTML → plain text. Pure.</summary>
internal static partial class SourceText
{
    public const int MaxNameLength = 160;
    public const int MaxDescriptionLength = 2000;

    /// <summary>Lower case, Turkish letters folded to ASCII, runs of white space as one space: the key of every look-up table.</summary>
    public static string Fold(string? value) => WhiteSpace().Replace(CatalogRules.NormalizeText(value), " ");

    /// <summary>Words that stay Latin in a Turkish upper-case name ("MICRO" is not "Mıcro").</summary>
    private static readonly HashSet<string> LatinWords = new(StringComparer.Ordinal)
    {
        "micro", "mini", "midi", "maxi", "slim", "fit", "skinny", "straight", "regular", "oversize", "relaxed", "wide", "high", "rise",
        "shirt", "sweatshirt", "bikini", "denim", "vintage", "limited", "edition", "exclusive", "print", "basic", "twill", "design",
        "city", "icon", "iconic", "signature", "satin", "silk", "linen", "pin", "stripe", "initials", "trim",
    };

    /// <summary>"VİZON TRİKO MİDİ ETEK" → "Vizon Triko Midi Etek" with Turkish casing (I → ı, İ → i; i → İ, ı → I), independent of the machine's culture.</summary>
    public static string TitleCase(string? name)
    {
        var text = WhiteSpace().Replace(name ?? "", " ").Trim();
        var builder = new StringBuilder(text.Length);
        var start = 0;
        while (start < text.Length)
        {
            if (!char.IsLetter(text[start]))
            {
                builder.Append(text[start++]);
                continue;
            }
            var end = start;
            while (end < text.Length && (char.IsLetter(text[end]) || text[end] == '\''))
                end++;
            var word = text[start..end];
            var latin = LatinWords.Contains(string.Concat(word.Select(LowerLatin)));
            // A letter right after a digit continues it ("2li", "100cm"): no capital.
            var capital = start == 0 || !char.IsDigit(text[start - 1]);
            for (var i = 0; i < word.Length; i++)
            {
                var lower = latin ? LowerLatin(word[i]) : LowerTr(word[i]);
                builder.Append(i == 0 && capital ? (latin ? char.ToUpperInvariant(lower) : UpperTr(lower)) : lower);
            }
            start = end;
        }
        return builder.ToString();
    }

    /// <summary>The name as the app shows it: title-cased when the site shouts, single-spaced, at most <see cref="MaxNameLength"/> characters.</summary>
    public static string DisplayName(string? name, bool titleCase)
    {
        var text = titleCase ? TitleCase(name) : WhiteSpace().Replace(name ?? "", " ").Trim();
        return text.Length > MaxNameLength ? text[..MaxNameLength].TrimEnd() : text;
    }

    private static char LowerTr(char c) => c switch { 'I' => 'ı', 'İ' => 'i', _ => char.ToLowerInvariant(c) };

    private static char LowerLatin(char c) => c is 'I' or 'İ' ? 'i' : char.ToLowerInvariant(c);

    private static char UpperTr(char c) => c switch { 'i' => 'İ', 'ı' => 'I', _ => char.ToUpperInvariant(c) };

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhiteSpace();

    [GeneratedRegex(@"<\s*(br|/p|/div|/li|/h[1-6]|/tr)\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex LineBreakTag();

    [GeneratedRegex(@"<(script|style)\b.*?</\1\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex CodeBlock();

    [GeneratedRegex("<[^>]*>")]
    private static partial Regex Tag();

    /// <summary>HTML → plain lines (tags dropped, entities decoded, blank lines removed).</summary>
    public static string StripHtml(string? html)
    {
        if (string.IsNullOrWhiteSpace(html))
            return "";
        var text = CodeBlock().Replace(html, " ");
        text = LineBreakTag().Replace(text, "\n");
        text = WebUtility.HtmlDecode(Tag().Replace(text, " ")).Replace(' ', ' ');
        var lines = text.Split('\n').Select(l => WhiteSpace().Replace(l, " ").Trim()).Where(l => l.Length > 0);
        return string.Join('\n', lines);
    }

    /// <summary>The page's description (often empty) followed by its material line ("%100 Pamuk"); null when both are empty.</summary>
    public static string? Description(string? descriptionHtml, string? material)
    {
        var parts = new[] { StripHtml(descriptionHtml), StripHtml(material) }.Where(p => p.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        if (parts.Count == 0)
            return null;
        var text = string.Join('\n', parts);
        return text.Length > MaxDescriptionLength ? text[..(MaxDescriptionLength - 1)].TrimEnd() + "…" : text;
    }
}
