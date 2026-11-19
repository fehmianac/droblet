namespace Domain.Services.Ai;

/// <summary>A published prompt override: the template that replaces the code default of <paramref name="Key"/>.</summary>
public sealed record PromptOverride(string Key, int Version, string Template);

/// <summary>
/// The prompt overrides the AI provider applies (admin "AI → Promptlar"). Reads are served from an in-memory snapshot
/// refreshed at most every Ai:Prompts:CacheSeconds (60 s); an unreachable store means "no override" — the code default
/// is used, never an error.
/// </summary>
public interface IPromptRegistry
{
    /// <summary>The published override of <paramref name="key"/>, or null when the code default is live.</summary>
    ValueTask<PromptOverride?> GetAsync(string key, CancellationToken ct);

    /// <summary>
    /// A call that used these overrides gave an unusable answer (invalid JSON / DTO, refusal, cut off). Over the
    /// threshold within the window the override is switched back to the previous version or the code default. Never throws.
    /// </summary>
    Task ReportFailureAsync(IReadOnlyCollection<PromptOverride> used, string reason, CancellationToken ct);
}

/// <summary>No overrides: every prompt is the code default (tools, tests, a provider built without a registry).</summary>
public sealed class CodeDefaultPrompts : IPromptRegistry
{
    public static readonly CodeDefaultPrompts Instance = new();

    public ValueTask<PromptOverride?> GetAsync(string key, CancellationToken ct) => ValueTask.FromResult<PromptOverride?>(null);

    public Task ReportFailureAsync(IReadOnlyCollection<PromptOverride> used, string reason, CancellationToken ct) => Task.CompletedTask;
}
