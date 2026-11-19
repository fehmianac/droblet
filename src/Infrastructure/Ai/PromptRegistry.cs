using Domain.Entity;
using Domain.Manager;
using Domain.Options;
using Domain.Services.Admin;
using Domain.Services.Ai;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Ai;

/// <summary>
/// DynamoDB-backed <see cref="IPromptRegistry"/> for the workers. All published overrides are one Query (partition
/// ai#prompt, a few KB), kept in memory for Ai:Prompts:CacheSeconds; concurrent callers share one refresh. A failed
/// read (throttling, permissions, network) is logged and answers "no override" — the code default — for a short
/// retry interval, so the store can never stop an AI job. An override that no longer passes the catalog validation
/// (e.g. a placeholder was renamed in code after it was published) is ignored the same way.
/// The repository and the audit log are resolved on first use, so building the provider never touches AWS.
/// </summary>
public sealed class PromptRegistry(
    Lazy<IRepository> repositoryLazy,
    IOptionsMonitor<AiOptions> options,
    Lazy<IAuditLog> auditLazy,
    TimeProvider time,
    ILogger<PromptRegistry> logger) : IPromptRegistry
{
    private IRepository Repository => repositoryLazy.Value;
    private IAuditLog Audit => auditLazy.Value;

    /// <summary>After a failed read the code defaults are used for this long before the store is asked again.</summary>
    public static readonly TimeSpan RetryAfterFailure = TimeSpan.FromSeconds(15);

    private sealed record Snapshot(IReadOnlyDictionary<string, PromptOverride> Overrides, DateTimeOffset ExpiresAt);

    private static readonly Snapshot Empty = new(new Dictionary<string, PromptOverride>(), DateTimeOffset.MinValue);

    private readonly SemaphoreSlim _refresh = new(1, 1);
    private volatile Snapshot? _snapshot;

    public async ValueTask<PromptOverride?> GetAsync(string key, CancellationToken ct)
    {
        if (!options.CurrentValue.Prompts.Enabled)
            return null;
        var snapshot = await SnapshotAsync(ct);
        return snapshot.Overrides.GetValueOrDefault(key);
    }

    /// <summary>Drops the cached snapshot (tests; a worker that just wrote an override).</summary>
    public void Invalidate() => _snapshot = null;

    private async ValueTask<Snapshot> SnapshotAsync(CancellationToken ct)
    {
        var current = _snapshot;
        if (current is not null && time.GetUtcNow() < current.ExpiresAt)
            return current;

        await _refresh.WaitAsync(ct);
        try
        {
            current = _snapshot;
            if (current is not null && time.GetUtcNow() < current.ExpiresAt)
                return current;
            current = await LoadAsync(ct);
            _snapshot = current;
            return current;
        }
        finally
        {
            _refresh.Release();
        }
    }

    private async Task<Snapshot> LoadAsync(CancellationToken ct)
    {
        var ttl = TimeSpan.FromSeconds(Math.Clamp(options.CurrentValue.Prompts.CacheSeconds, 1, 3600));
        try
        {
            var rows = await Repository.GetAllAsync<AiPromptEntity>(AiPromptEntity.GetPk(), ct);
            var overrides = new Dictionary<string, PromptOverride>(StringComparer.Ordinal);
            foreach (var row in rows.Where(r => r.Text is not null))
            {
                var definition = PromptCatalog.Find(row.Key);
                if (definition is null || PromptCatalog.Validate(definition, row.Text).Count > 0)
                {
                    logger.LogWarning("Prompt override {Key} v{Version} ignored: not a valid template of this build; the code default is used", row.Key, row.PublishedVersion);
                    continue;
                }
                overrides[row.Key] = new PromptOverride(row.Key, row.PublishedVersion, row.Text!);
            }
            return new Snapshot(overrides, time.GetUtcNow() + ttl);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            logger.LogWarning("Prompt overrides could not be read ({Error}); code defaults are used", ex.GetType().Name);
            return Empty with { ExpiresAt = time.GetUtcNow() + (ttl < RetryAfterFailure ? ttl : RetryAfterFailure) };
        }
    }

    // ── Runtime safety ──────────────────────────────────────────────────────────────────────────────────────────────

    public async Task ReportFailureAsync(IReadOnlyCollection<PromptOverride> used, string reason, CancellationToken ct)
    {
        var settings = options.CurrentValue.Prompts;
        if (used.Count == 0 || settings.FailureThreshold <= 0)
            return;
        var window = TimeSpan.FromMinutes(Math.Clamp(settings.FailureWindowMinutes, 1, 24 * 60));
        var now = time.GetUtcNow();
        var bucket = now.ToUnixTimeSeconds() / (long)window.TotalSeconds;
        foreach (var prompt in used)
        {
            try
            {
                var failures = await Repository.IncrementCounterAsync("ai#promptfail", $"{prompt.Key}#v{prompt.Version}#{bucket}", "count",
                    (now + window + window).ToUnixTimeSeconds(), ct);
                logger.LogWarning("Prompt override {Key} v{Version}: unusable answer ({Reason}), {Failures} in the current {Window} min window",
                    prompt.Key, prompt.Version, reason, failures, (int)window.TotalMinutes);
                if (failures >= settings.FailureThreshold)
                    await FallBackAsync(prompt, failures, reason, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning("Prompt failure of {Key} could not be recorded ({Error})", prompt.Key, ex.GetType().Name);
            }
        }
    }

    /// <summary>
    /// Switches <paramref name="failed"/> back to the entry that was live before it (the previous version's text, or
    /// the code default), as a new history entry; writes an audit entry and marks the prompt for the panel banner.
    /// Only when the failed version is still the live one (another fallback or a publish may have happened meanwhile).
    /// </summary>
    private async Task FallBackAsync(PromptOverride failed, long failures, string reason, CancellationToken ct)
    {
        var head = await Repository.GetAsync<AiPromptEntity>(AiPromptEntity.GetPk(), AiPromptEntity.GetSk(failed.Key), ct);
        if (head is null || head.PublishedVersion != failed.Version || head.Text is null)
            return;

        var previousNumber = failed.Version - 1;
        var previous = previousNumber >= 1
            ? await Repository.GetAsync<AiPromptVersionEntity>(AiPromptVersionEntity.GetPk(failed.Key), AiPromptVersionEntity.GetSk(previousNumber), ct)
            : null;
        var now = time.GetUtcNow().UtcDateTime;
        var entry = new AiPromptVersionEntity
        {
            Key = failed.Key,
            Number = head.PublishedVersion + 1,
            Text = previous?.Text,
            Action = "auto_fallback",
            SourceVersion = previous is null ? 0 : previousNumber,
            Author = null,
            At = now,
            Note = $"Automatic fallback: v{failed.Version} failed {failures} times ({reason})",
        };
        var before = new { version = head.PublishedVersion, text = head.Text };
        head.PublishedVersion = entry.Number;
        head.Text = entry.Text;
        head.PublishedBy = null;
        head.PublishedAt = now;
        head.Note = entry.Note;
        head.Fallback = new AiPromptFallback(now, failed.Version, entry.Number, failures, reason);

        var result = await Repository.TransactWriteAsync([TransactWriteOperation.PutVersioned(head), TransactWriteOperation.Create(entry)], ct);
        if (!result.Applied)
            return;
        Invalidate();
        logger.LogError("Prompt override {Key} v{Failed} switched back to v{Source} after {Failures} unusable answers ({Reason})",
            failed.Key, failed.Version, entry.SourceVersion, failures, reason);
        await Audit.WriteAsync(null, "ai.prompt.auto_fallback", "ai_prompt", failed.Key, before,
            new { version = entry.Number, sourceVersion = entry.SourceVersion, text = entry.Text ?? "(code default)", failures, reason }, null, ct);
    }
}
