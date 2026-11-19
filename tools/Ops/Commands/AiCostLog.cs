using System.Globalization;
using System.Text.RegularExpressions;
using Domain.Options;
using Domain.Services;
using Infrastructure.Telemetry;

namespace Ops.Commands;

/// <summary>One worker run as its "Job timings" log line tells it (JobMessageHandler): job id, kind and every provider call.</summary>
internal sealed record LoggedJob(DateTime At, string Function, string JobId, string Kind, IReadOnlyList<AiCallRecord> Calls);

/// <summary>
/// Parses the "Job timings … | ai calls …" line the workers write per run (WorkerHost JobMessageHandler.Describe). Older
/// lines have no "imgin / tier / usd" tail; their cost is recomputed from the token counts with today's price list
/// (an image edit without the image/text split counts <see cref="AssumedImagePromptTokens"/> as text, the rest as image input).
/// </summary>
internal static partial class AiCostLog
{
    /// <summary>Assumption for old image-edit lines: the text prompt of a cleanup / try-on edit is about this many tokens.</summary>
    public const int AssumedImagePromptTokens = 200;

    [GeneratedRegex(@"Job timings (?<job>\S+) (?<kind>\S+) attempt \d+ cold \S+: .*?\| ai calls (?<calls>.*)$")]
    private static partial Regex LinePattern();

    [GeneratedRegex(@"^(?<op>\S+) (?<model>\S*) (?<ms>\d+)ms (?<status>\d+) in (?<in>\d*) \(cached (?<cached>\d*)\) out (?<out>\d*) \(reasoning (?<reason>\d*)\) effort (?<effort>\S+) img (?<size>[^/\s]+)/(?<quality>\S+) req (?<req>\d*)B(?: imgin (?<imgin>\S+) tier (?<tier>\S+) usd (?<usd>\S+))?")]
    private static partial Regex CallPattern();

    public static LoggedJob? Parse(DateTime at, string function, string message)
    {
        // Structured (JSON) Lambda logs escape nothing in this line; a trailing quote / brace of the JSON wrapper is cut off.
        var match = LinePattern().Match(message.TrimEnd().TrimEnd('}', '"'));
        if (!match.Success)
            return null;
        var calls = match.Groups["calls"].Value.Split("; ", StringSplitOptions.RemoveEmptyEntries)
            .Select(ParseCall).Where(c => c is not null).Select(c => c!).ToList();
        return new LoggedJob(at, function, match.Groups["job"].Value, match.Groups["kind"].Value, calls);
    }

    public static AiCallRecord? ParseCall(string text)
    {
        var m = CallPattern().Match(text.Trim());
        if (!m.Success)
            return null;
        static long? Long(Group g) => g.Success && long.TryParse(g.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : null;
        static string? Text(Group g) => g.Success && g.Value is { Length: > 0 } v && v != "-" ? v : null;
        decimal? usd = m.Groups["usd"].Success && decimal.TryParse(m.Groups["usd"].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var u) ? u : null;
        return new AiCallRecord(m.Groups["op"].Value, Text(m.Groups["model"]), Long(m.Groups["ms"]) ?? 0, (int)(Long(m.Groups["status"]) ?? 0),
            Long(m.Groups["in"]), Long(m.Groups["out"]), Long(m.Groups["cached"]), Long(m.Groups["reason"]), Text(m.Groups["size"]), Text(m.Groups["quality"]),
            Long(m.Groups["req"]), Text(m.Groups["effort"]), Long(m.Groups["imgin"]), Text(m.Groups["tier"]), usd);
    }

    /// <summary>The call's cost with today's price list (the logged estimate is not reused: prices may have been missing then).</summary>
    public static decimal? Cost(AiPricingOptions pricing, AiCallRecord call)
    {
        if (call.Status is not (>= 200 and < 300))
            return null;
        var imageIn = call.InputImageTokens;
        if (AiCost.IsImageOperation(call.Operation) && imageIn is null && call.InputTokens is { } input)
            imageIn = Math.Max(0, input - AssumedImagePromptTokens);
        return AiCost.Estimate(pricing, call.Operation, call.Model, call.ServiceTier,
            new AiUsage(call.InputTokens, call.CachedTokens, call.OutputTokens, imageIn), call.ImageSize, call.ImageQuality);
    }
}

/// <summary>
/// A named settings variant of ai-cost: "name:key=value,key=value", several separated by ';' (no spaces — the workflow
/// splits arguments on whitespace). "base" (or a name without settings) = the stage's current config.
/// Text keys: effort, effort.{op}, model, fast, fastops (a|b), detail.{op}, tier, tier.{op}, maxout.{op}, compact, cap,
/// weekbatch, cachekey. Image keys: imagemodel (another OpenAI image model, measurement only), quality, size, fidelity,
/// uses (cleanup|tryon|tryon4|tryonface; default cleanup|tryon).
/// </summary>
internal sealed record CostVariant(string Name, IReadOnlyDictionary<string, string> Settings)
{
    public static readonly CostVariant Base = new("base", new Dictionary<string, string>());

    private static readonly string[] Keys = ["effort", "model", "fast", "fastops", "tier", "compact", "cap", "weekbatch", "cachekey", "imagemodel", "quality", "size", "fidelity", "uses"];
    private static readonly string[] PrefixKeys = ["effort.", "detail.", "tier.", "maxout."];

    public string? Get(string key) => Settings.TryGetValue(key, out var value) ? value : null;

    public static IReadOnlyList<CostVariant> ParseAll(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return [Base];
        return raw.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(Parse).ToList();
    }

    public static string? ParseError(string raw)
    {
        foreach (var part in raw.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var variant = Parse(part);
            if (!Regex.IsMatch(variant.Name, "^[a-z0-9._-]{1,32}$"))
                return $"bad variant name '{variant.Name}'";
            if (variant.Settings.Keys.FirstOrDefault(k => !Keys.Contains(k) && !PrefixKeys.Any(p => k.StartsWith(p, StringComparison.Ordinal))) is { } bad)
                return $"unknown key '{bad}' in '{variant.Name}'";
            if (variant.Settings.Values.FirstOrDefault(v => !Regex.IsMatch(v, "^[A-Za-z0-9._|x-]{1,64}$")) is { } badValue)
                return $"bad value '{badValue}' in '{variant.Name}'";
        }
        return null;
    }

    private static CostVariant Parse(string part)
    {
        var colon = part.IndexOf(':', StringComparison.Ordinal);
        var name = (colon < 0 ? part : part[..colon]).Trim().ToLowerInvariant();
        var settings = new Dictionary<string, string>(StringComparer.Ordinal);
        if (colon >= 0)
            foreach (var pair in part[(colon + 1)..].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var eq = pair.IndexOf('=', StringComparison.Ordinal);
                if (eq > 0)
                    settings[pair[..eq].Trim().ToLowerInvariant()] = pair[(eq + 1)..].Trim();
            }
        return new CostVariant(name, settings);
    }

    /// <summary>The variant applied to a copy of the stage's AI options (text keys and image keys).</summary>
    public void Apply(AiOptions o)
    {
        foreach (var (key, value) in Settings)
        {
            switch (key)
            {
                case "effort":
                    o.ReasoningEffort.Clear();
                    if (value != "default") o.ReasoningEffort["Default"] = value;
                    break;
                case "model": o.TextModel = value; break;
                case "fast": o.FastTextModel = value; break;
                case "fastops": o.FastTextOperations = value.Replace('|', ','); break;
                case "tier": o.ServiceTier = value == "default" ? null : value; break;
                case "cachekey": o.PromptCacheKey = value is "1" or "true"; break;
                case "imagemodel": o.ImageModel = value; break;
                case "quality" or "size" or "fidelity" or "uses": break; // image keys: below
                case "compact" or "cap" or "weekbatch": break;              // stylist keys: Compact / Cap / WeekBatch
                default:
                    var dot = key.IndexOf('.', StringComparison.Ordinal);
                    if (dot <= 0)
                        break;
                    var (prefix, op) = (key[..dot], key[(dot + 1)..]);
                    if (prefix == "effort") o.ReasoningEffort[op] = value;
                    else if (prefix == "detail") o.VisionDetail[op] = value;
                    else if (prefix == "tier") o.ServiceTiers[op] = value;
                    else if (prefix == "maxout" && int.TryParse(value, out var max)) o.MaxOutputTokens[op] = max;
                    break;
            }
        }
        var uses = (Get("uses") ?? "cleanup|tryon").Split('|');
        string? Value(string k) => Get(k) is { } v && v != "default" ? v : null;
        if (uses.Contains("cleanup"))
        {
            if (Get("quality") is not null) o.Image.CleanupQuality = Value("quality");
            if (Get("size") is not null) o.Image.CleanupSize = Value("size");
        }
        if (uses.Contains("tryon") || uses.Contains("tryon4") || uses.Contains("tryonface"))
        {
            if (Get("quality") is not null) o.Image.TryOnQuality = Value("quality");
            if (Get("size") is not null) o.Image.TryOnSize = Value("size");
            if (Get("fidelity") is not null) o.Image.TryOnInputFidelity = Value("fidelity");
        }
    }

    public bool Compact(bool fallback) => Get("compact") is { } v ? v is "1" or "true" : fallback;
    public int Cap(int fallback) => int.TryParse(Get("cap"), out var cap) && cap > 0 ? cap : fallback;
    public int WeekBatch(int fallback) => int.TryParse(Get("weekbatch"), out var days) && days >= 0 ? days : fallback;
    public bool Uses(string use) => (Get("uses") ?? "cleanup|tryon").Split('|').Contains(use);
}
