using Domain.Entity;

namespace Domain.Services.Admin;

// Admin "Bakım" (maintenance) jobs. docs/api/admin.md §5d, docs/images.md §8.

public record MaintenanceActorDto(string Id, string Email);

public record MaintenanceSkipReasonDto(string Reason, int Count);

public record MaintenanceFailedItemDto(string TenantId, string ItemId, string Reason);

public record MaintenanceRunDto(
    string Id,
    string Kind,
    bool DryRun,
    MaintenanceRunStatus Status,
    int Tenants,
    int Scanned,
    int Published,
    int AlreadyPublic,
    int Skipped,
    int Hidden,
    int RenditionsMade,
    int Failed,
    IReadOnlyList<MaintenanceSkipReasonDto> SkipReasons,
    IReadOnlyList<MaintenanceFailedItemDto> FailedItems,
    string? RetryOf,
    int? OnlyItemCount,
    MaintenanceActorDto StartedBy,
    DateTime StartedAt,
    DateTime UpdatedAt,
    DateTime? FinishedAt,
    DateTime? CancelRequestedAt)
{
    public static MaintenanceRunDto From(MaintenanceRunEntity run) => new(
        run.Id, "publishItemImages", run.DryRun, run.Status, run.Tenants, run.Scanned, run.Published, run.AlreadyPublic, run.Skipped,
        run.Hidden, run.RenditionsMade, run.Failed,
        run.SkipReasons.OrderByDescending(r => r.Value).ThenBy(r => r.Key, StringComparer.Ordinal).Select(r => new MaintenanceSkipReasonDto(r.Key, r.Value)).ToList(),
        run.FailedItems.Select(f => new MaintenanceFailedItemDto(f.TenantId, f.ItemId, f.Reason)).ToList(),
        run.RetryOf, run.OnlyItems?.Count, new MaintenanceActorDto(run.StartedById, run.StartedByEmail),
        run.StartedAt, run.UpdatedAt, run.FinishedAt, run.CancelRequestedAt);
}

public record MaintenanceRunsDto(IReadOnlyList<MaintenanceRunDto> Runs);

public enum MaintenanceStartOutcome { Started, Active, NothingToRetry, NotFound }

public record MaintenanceStartResult(MaintenanceStartOutcome Outcome, MaintenanceRunDto? Run);

public enum MaintenanceCancelOutcome { Cancelling, NotFound, Finished }

public record MaintenanceCancelResult(MaintenanceCancelOutcome Outcome, MaintenanceRunDto? Run);

/// <summary>Admin side of "Görselleri herkese açık konuma taşı": start (one active run), list, cancel, retry the failed pieces. Audited.</summary>
public interface IMaintenanceService
{
    Task<MaintenanceStartResult> StartPublishItemImagesAsync(AdminUserEntity actor, bool dryRun, string? ip, CancellationToken ct);
    Task<MaintenanceRunsDto> ListPublishItemImagesAsync(CancellationToken ct);
    Task<MaintenanceRunDto?> GetPublishItemImagesAsync(string runId, CancellationToken ct);
    Task<MaintenanceCancelResult> CancelPublishItemImagesAsync(AdminUserEntity actor, string runId, string? ip, CancellationToken ct);
    Task<MaintenanceStartResult> RetryFailedPublishItemImagesAsync(AdminUserEntity actor, string runId, string? ip, CancellationToken ct);
}

/// <summary>Message on the item processor queue: process the next batch of a run (Seq = the batch the run expects).</summary>
public sealed record PublishItemImagesBatchRequested(string MaintenanceRunId, int Seq);

/// <summary>Puts a batch message on the item processor queue (the worker that has SkiaSharp).</summary>
public interface IMaintenanceQueue
{
    Task EnqueueAsync(PublishItemImagesBatchRequested message, CancellationToken ct);
}

/// <summary>Worker side: one batch of a run (resumable, idempotent per piece, no AI).</summary>
public interface IPublishItemImagesJob
{
    /// <summary>Processes one batch and queues the next one; returns true when the run is finished (or the message was stale).</summary>
    Task<bool> RunBatchAsync(PublishItemImagesBatchRequested message, CancellationToken ct);
}
