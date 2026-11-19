using System.Text.RegularExpressions;

namespace Ops;

/// <summary>The value of the worker/Ai/Pricing parameter in template.yaml (searched from the working directory upwards).</summary>
internal static partial class TemplatePricing
{
    [GeneratedRegex(@"Name: !Sub /droblet/\$\{Stage\}/worker/Ai/Pricing\s*\n(?:[^\n]*\n){1,3}?\s*Value: '(?<value>[^'\n]*)'")]
    private static partial Regex Pattern();

    /// <summary>The JSON as configuration keys under <paramref name="prefix"/> (what the SSM loader makes of it); re-loadable, unlike a stream source.</summary>
    public static Dictionary<string, string?> Flatten(string json, string prefix)
    {
        var result = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        void Walk(System.Text.Json.Nodes.JsonNode? node, string path)
        {
            switch (node)
            {
                case System.Text.Json.Nodes.JsonObject obj:
                    foreach (var (key, value) in obj)
                        Walk(value, path + ":" + key);
                    break;
                case System.Text.Json.Nodes.JsonArray array:
                    for (var i = 0; i < array.Count; i++)
                        Walk(array[i], path + ":" + i.ToString(System.Globalization.CultureInfo.InvariantCulture));
                    break;
                case System.Text.Json.Nodes.JsonValue value:
                    result[path] = value.ToJsonString().Trim('"');
                    break;
            }
        }
        Walk(System.Text.Json.Nodes.JsonNode.Parse(json), prefix);
        return result;
    }

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
