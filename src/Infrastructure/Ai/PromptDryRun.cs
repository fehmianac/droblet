namespace Infrastructure.Ai;

/// <summary>
/// One admin dry-run ("Dene"): inside <see cref="Begin"/> the provider uses the given draft templates instead of the
/// published ones, never reports failures to the runtime safety, and records what it sent and the raw answer.
/// Flows with the async context only, so concurrent jobs in the same process are not affected.
/// </summary>
public sealed class PromptDryRun : IDisposable
{
    private static readonly AsyncLocal<PromptDryRun?> CurrentRun = new();

    private readonly PromptDryRun? _outer;

    private PromptDryRun(IReadOnlyDictionary<string, string> drafts)
    {
        Drafts = drafts;
        _outer = CurrentRun.Value;
    }

    public static PromptDryRun? Current => CurrentRun.Value;

    /// <summary>Key → template used for this run instead of the published override.</summary>
    public IReadOnlyDictionary<string, string> Drafts { get; }

    public string? SystemPrompt { get; set; }
    public string? UserPrompt { get; set; }
    public string? RawOutput { get; set; }
    public string? UsedModel { get; set; }
    public TokenUsage? Usage { get; set; }
    public double? DurationMs { get; set; }

    public static PromptDryRun Begin(IReadOnlyDictionary<string, string> drafts)
    {
        var run = new PromptDryRun(drafts);
        CurrentRun.Value = run;
        return run;
    }

    public void Dispose() => CurrentRun.Value = _outer;
}
