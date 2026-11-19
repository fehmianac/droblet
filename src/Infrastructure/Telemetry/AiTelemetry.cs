using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Infrastructure.Telemetry;

/// <summary>
/// Per-job stage timings (ms) of one worker run. Thread-safe: parallel branches of a job (Task.WhenAll) add to the same
/// instance through <see cref="AiTelemetry"/>'s AsyncLocal. Stages measured more than once (e.g. every DynamoDB call
/// under "db") are summed — those are cumulative, and parallel calls can add up to more than the wall time.
/// </summary>
public sealed class StageTimings
{
    private readonly object _gate = new();
    private readonly Dictionary<string, double> _ms = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _counts = new(StringComparer.Ordinal);
    private readonly List<AiCallRecord> _calls = [];
    private readonly Stopwatch _watch = Stopwatch.StartNew();

    public string? JobId { get; set; }
    public string? JobKind { get; set; }
    public int Attempt { get; set; } = 1;
    public bool ColdStart { get; set; }

    /// <summary>Milliseconds since this run began (worker handler start).</summary>
    public long ElapsedMs => (long)_watch.Elapsed.TotalMilliseconds;

    public void Add(string stage, double ms)
    {
        lock (_gate)
        {
            _ms[stage] = _ms.GetValueOrDefault(stage) + Math.Max(0, ms);
            _counts[stage] = _counts.GetValueOrDefault(stage) + 1;
        }
    }

    /// <summary>Sets (not adds) a stage — for values measured outside the run (queue wait, init).</summary>
    public void Set(string stage, double ms)
    {
        lock (_gate)
        {
            _ms[stage] = Math.Max(0, ms);
            _counts[stage] = 1;
        }
    }

    public void AddCall(AiCallRecord call)
    {
        lock (_gate)
            _calls.Add(call);
        Add("ai." + call.Operation, call.DurationMs);
    }

    public StageScope Measure(string stage) => new(this, stage);

    public IReadOnlyList<AiCallRecord> Calls
    {
        get
        {
            lock (_gate)
                return _calls.ToList();
        }
    }

    public int CountOf(string stage)
    {
        lock (_gate)
            return _counts.GetValueOrDefault(stage);
    }

    /// <summary>ms per stage, rounded, plus "worker" = the run so far.</summary>
    public Dictionary<string, long> Snapshot()
    {
        lock (_gate)
        {
            var snapshot = _ms.ToDictionary(kv => kv.Key, kv => (long)Math.Round(kv.Value), StringComparer.Ordinal);
            snapshot["worker"] = ElapsedMs;
            return snapshot;
        }
    }
}

/// <summary>One provider call: model, duration, token usage (cached prompt tokens included), image settings, outcome.</summary>
public sealed record AiCallRecord(
    string Operation,
    string? Model,
    double DurationMs,
    int Status,
    long? InputTokens = null,
    long? OutputTokens = null,
    long? CachedTokens = null,
    long? ReasoningTokens = null,
    string? ImageSize = null,
    string? ImageQuality = null,
    long? RequestBytes = null,
    string? ReasoningEffort = null);

public readonly struct StageScope(StageTimings? timings, string stage) : IDisposable
{
    private readonly long _start = Stopwatch.GetTimestamp();

    public void Dispose() => timings?.Add(stage, Stopwatch.GetElapsedTime(_start).TotalMilliseconds);
}

/// <summary>
/// Ambient per-job timings (AsyncLocal): the worker entrypoint begins a run, services and the AI provider add stages
/// without new parameters, JobLifecycle copies the snapshot into the job record (`timings`), and the entrypoint emits
/// one structured log line + CloudWatch Embedded Metric Format (namespace Droblet/Ai) at the end.
/// Outside a run every call is a no-op.
/// </summary>
public static class AiTelemetry
{
    public const string Namespace = "Droblet/Ai";

    private static readonly AsyncLocal<StageTimings?> CurrentRun = new();

    public static StageTimings? Current => CurrentRun.Value;

    public static StageTimings Begin()
    {
        var timings = new StageTimings();
        CurrentRun.Value = timings;
        return timings;
    }

    public static void End() => CurrentRun.Value = null;

    public static StageScope Measure(string stage) => new(CurrentRun.Value, stage);

    public static void Add(string stage, double ms) => CurrentRun.Value?.Add(stage, ms);

    /// <summary>Times an async step under <paramref name="stage"/>.</summary>
    public static async Task<T> TimeAsync<T>(string stage, Func<Task<T>> step)
    {
        using var _ = Measure(stage);
        return await step();
    }

    public static async Task TimeAsync(string stage, Func<Task> step)
    {
        using var _ = Measure(stage);
        await step();
    }
}

/// <summary>
/// CloudWatch Embedded Metric Format: one JSON document per stage (dimensions Env × Job × Stage, metric DurationMs)
/// and one per provider call (Env × Job × Stage=ai.{operation}, metrics InputTokens / OutputTokens / CachedTokens).
/// Written straight to the process stdout (not Console.Out, which the .NET Lambda runtime prefixes with a timestamp
/// and request id — a prefixed line is not parsed as EMF).
/// </summary>
public static class EmbeddedMetrics
{
    private static readonly object Gate = new();
    private static StreamWriter? _stdout;

    /// <summary>Tests capture the documents here instead of stdout.</summary>
    public static Action<string>? Sink { get; set; }

    public static bool Enabled => Sink is not null || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AWS_LAMBDA_FUNCTION_NAME"));

    public static IReadOnlyList<string> Documents(StageTimings timings, string env, DateTimeOffset now)
    {
        var job = timings.JobKind ?? "unknown";
        var timestamp = now.ToUnixTimeMilliseconds();
        var documents = new List<string>();
        foreach (var (stage, ms) in timings.Snapshot())
            documents.Add(Document(env, job, stage, timestamp, new() { ["DurationMs"] = ms }, "Milliseconds", timings));
        foreach (var call in timings.Calls)
        {
            var metrics = new Dictionary<string, double>();
            if (call.InputTokens is { } input) metrics["InputTokens"] = input;
            if (call.OutputTokens is { } output) metrics["OutputTokens"] = output;
            if (call.CachedTokens is { } cached) metrics["CachedTokens"] = cached;
            if (metrics.Count > 0)
                documents.Add(Document(env, job, "ai." + call.Operation, timestamp, metrics, "Count", timings, call));
        }
        return documents;
    }

    public static void Emit(StageTimings timings, string env, DateTimeOffset now)
    {
        if (!Enabled)
            return;
        foreach (var document in Documents(timings, env, now))
            Write(document);
    }

    private static string Document(string env, string job, string stage, long timestamp, Dictionary<string, double> metrics, string unit,
        StageTimings timings, AiCallRecord? call = null)
    {
        var definitions = new JsonArray(metrics.Keys.Select(name => (JsonNode)new JsonObject { ["Name"] = name, ["Unit"] = unit }).ToArray());
        var root = new JsonObject
        {
            ["_aws"] = new JsonObject
            {
                ["Timestamp"] = timestamp,
                ["CloudWatchMetrics"] = new JsonArray(new JsonObject
                {
                    ["Namespace"] = AiTelemetry.Namespace,
                    ["Dimensions"] = new JsonArray(new JsonArray("Env", "Job", "Stage")),
                    ["Metrics"] = definitions,
                }),
            },
            ["Env"] = env,
            ["Job"] = job,
            ["Stage"] = stage,
            ["JobId"] = timings.JobId,
            ["Attempt"] = timings.Attempt,
            ["ColdStart"] = timings.ColdStart,
        };
        if (call is not null)
        {
            root["Model"] = call.Model;
            root["ImageSize"] = call.ImageSize;
            root["ImageQuality"] = call.ImageQuality;
        }
        foreach (var (name, value) in metrics)
            root[name] = value;
        return root.ToJsonString();
    }

    private static void Write(string line)
    {
        if (Sink is { } sink)
        {
            sink(line);
            return;
        }
        lock (Gate)
        {
            _stdout ??= new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
            _stdout.WriteLine(line);
        }
    }

    /// <summary>"queue_wait=812 init=0 db=95 …" — the compact form used in the structured log line.</summary>
    public static string Compact(IReadOnlyDictionary<string, long> timings) =>
        string.Join(' ', timings.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => $"{kv.Key}={kv.Value.ToString(CultureInfo.InvariantCulture)}"));

    public static string Json(IReadOnlyDictionary<string, long> timings) => JsonSerializer.Serialize(timings);
}
