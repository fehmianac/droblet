using System.Text.RegularExpressions;

namespace Ops;

/// <summary>The value of the worker/Ai/Pricing parameter in template.yaml (searched from the working directory upwards).</summary>
internal static partial class TemplatePricing
{
    [GeneratedRegex(@"Name: !Sub /droblet/\$\{Stage\}/worker/Ai/Pricing\s*\n(?:[^\n]*\n){1,3}?\s*Value: '(?<value>[^'\n]*)'")]
    private static partial Regex Pattern();

    public static string? Json(string? start = null)
    {
        for (var dir = new DirectoryInfo(start ?? Directory.GetCurrentDirectory()); dir is not null; dir = dir.Parent)
        {
            var path = Path.Combine(dir.FullName, "template.yaml");
            if (File.Exists(path))
                return Pattern().Match(File.ReadAllText(path)) is { Success: true } match ? match.Groups["value"].Value : null;
        }
        return null;
    }
}
