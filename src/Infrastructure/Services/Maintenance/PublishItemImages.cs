using Amazon.SQS;
using Amazon.SQS.Model;
using Domain.Entity;
using Domain.Entity.Base;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Infrastructure.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Maintenance;

public enum ItemMigrationResult { Published, AlreadyPublic, Hidden, Skipped, Failed }

/// <param name="Reason">Skipped: a <see cref="ItemImageMigrator.SkipReasons"/> code; Failed: copyFailed · conflict · error.</param>
public sealed record ItemMigrationOutcome(ItemMigrationResult Result, string? Reason = null, bool RenditionsMade = false);

/// <summary>
/// One piece of the "publish-item-images" migration (docs/images.md §8). No AI. Idempotent: a published piece whose public
/// copies exist (with thumbnails when renditions exist) is left alone.
///   1. missing private 256 / 768 px renditions are made (SkiaSharp, like the item worker);
///   2. the cleaned image is published (fresh random keys) when it is not, a public copy is missing, or it was published
///      before its renditions existed;
///   3. the keys are stored with a versioned write (Version + 1, UpdatedAt = now, so other devices sync the new URLs);
///      replaced public copies are deleted afterwards. Moderation-hidden pieces are never published.
/// </summary>
public sealed class ItemImageMigrator(
    IRepository repository,
    IObjectStorage storage,
    IImageThumbnailer thumbnailer,
    IItemImagePublisher publisher,
    TimeProvider time)
{
    private const long MaxImageBytes = 15 * 1024 * 1024;

    public static class SkipReasons
    {
        /// <summary>Library / catalog piece: its global image is already public.</summary>
        public const string LibraryOrCatalog = "libraryOrCatalog";
        /// <summary>Only an original (manual photo, cleanup pending or failed): it stays private.</summary>
        public const string OriginalOnly = "originalOnly";
        public const string NoImage = "noImage";
        /// <summary>The image key is not a cleaned .webp under the tenant's items/ folder.</summary>
        public const string NotOwnCleaned = "notOwnCleaned";
        public const string CleanedMissing = "cleanedMissing";
        /// <summary>Retry of a failed piece that was deleted meanwhile.</summary>
        public const string ItemDeleted = "itemDeleted";
    }

    public async Task<ItemMigrationOutcome> MigrateAsync(ItemEntity item, bool dryRun, CancellationToken ct)
    {
        if (item.ImageKey is not { } cleaned)
            return new(ItemMigrationResult.Skipped, item.OriginalImageKey is not null ? SkipReasons.OriginalOnly
                : item.GlobalImageKey is not null ? SkipReasons.LibraryOrCatalog : SkipReasons.NoImage);
        if (!cleaned.StartsWith(StorageKeys.ItemsPrefix(item.TenantId), StringComparison.Ordinal) || !cleaned.EndsWith(".webp", StringComparison.Ordinal))
            return new(ItemMigrationResult.Skipped, SkipReasons.NotOwnCleaned);
        if (item.IsModerationHidden())
            return new(ItemMigrationResult.Hidden);
        if (await storage.HeadAsync(cleaned, ct) is null)
            return new(ItemMigrationResult.Skipped, SkipReasons.CleanedMissing);

        // 1. Renditions.
        var made = false;
        var hasRenditions = true;
        foreach (var key in ItemImageRenditions.KeysOf(cleaned))
            if (await storage.HeadAsync(key, ct) is null)
                hasRenditions = false;
        if (!hasRenditions)
        {
            if (dryRun)
                made = hasRenditions = true; // "would make"
            else if (await storage.ReadAsync(cleaned, MaxImageBytes, ct) is { } data
                     && (await ItemImageRenditions.WriteAsync(storage, thumbnailer, cleaned, data, ct)).Count == ItemImageRenditions.Widths.Count)
                made = hasRenditions = true;
        }

        // 2. Publication.
        if (!await NeedsPublishAsync(item, hasRenditions, ct))
            return new(ItemMigrationResult.AlreadyPublic, RenditionsMade: made);
        if (dryRun)
            return new(ItemMigrationResult.Published, RenditionsMade: made);

        var image = await publisher.PublishAsync(item, ct);
        if (image is null)
            return new(ItemMigrationResult.Failed, "copyFailed", made);
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var previous = item.PublicImageKeys();
            var expected = item.Version;
            item.SetPublicImage(image);
            item.UpdatedAt = time.GetUtcNow().UtcDateTime;
            if (await repository.SaveIfVersionAsync(item, expected, ct))
            {
                await publisher.UnpublishAsync(item.TenantId, previous, ct);
                return new(ItemMigrationResult.Published, RenditionsMade: made);
            }
            var current = await repository.GetAsync<ItemEntity>(item.Pk, item.Sk, ct);
            if (current is null || current.ImageKey != item.ImageKey || current.IsModerationHidden())
            {
                await publisher.UnpublishAsync(item.TenantId, image.Keys, ct); // deleted, replaced or hidden meanwhile
                return current is null
                    ? new(ItemMigrationResult.Skipped, SkipReasons.ItemDeleted, made)
                    : new(ItemMigrationResult.AlreadyPublic, RenditionsMade: made);
            }
            item = current;
        }
        await publisher.UnpublishAsync(item.TenantId, image.Keys, ct);
        return new(ItemMigrationResult.Failed, "conflict", made);
    }

    private async Task<bool> NeedsPublishAsync(ItemEntity item, bool hasRenditions, CancellationToken ct)
    {
        if (item.PublicImageKey is not { } full || !StorageKeys.IsPublicItemKeyOf(full, item.TenantId))
            return true;
        if (hasRenditions && (item.PublicThumbKey is null || item.PublicMediumKey is null))
            return true; // published before its renditions existed
        foreach (var key in item.PublicImageKeys())
            if (await storage.HeadAsync(key, ct) is null)
                return true;
        return false;
    }
}

public sealed class MaintenanceOptions
{
    public const string Section = "Maintenance";
    /// <summary>At most this many pieces per batch (one SQS message).</summary>
    public int BatchSize { get; set; } = 200;
    /// <summary>A batch stops early after this long, so it always ends well inside the worker's 120 s timeout.</summary>
    public int BatchSeconds { get; set; } = 60;
}

/// <summary>
/// <see cref="IPublishItemImagesJob"/>: one batch of a run. The run row's Seq makes a redelivered message a no-op; the
/// cursor (tenant, item — ordinal order) makes every batch resumable. Progress is merged with a version-checked write, so an
/// admin's cancel in between is never lost. A crash mid-batch replays it from the last cursor: the pieces are idempotent
/// (only the counters of that batch may count twice).
/// </summary>
public sealed class PublishItemImagesJob(
    IRepository repository,
    ItemImageMigrator migrator,
    IMaintenanceQueue queue,
    IOptionsMonitor<MaintenanceOptions> options,
    TimeProvider time,
    ILogger<PublishItemImagesJob> logger) : IPublishItemImagesJob
{
    private const int Retries = 5;

    private sealed class Progress
    {
        public int Tenants, Scanned, Published, AlreadyPublic, Hidden, RenditionsMade, Failed;
        public Dictionary<string, int> Skipped { get; } = new(StringComparer.Ordinal);
        public List<MaintenanceFailedItem> FailedItems { get; } = [];
        public string? CursorTenant, CursorItem;
        public int OnlyIndex;
        public bool Done;

        public void Count(ItemEntity item, ItemMigrationOutcome outcome)
        {
            Scanned++;
            if (outcome.RenditionsMade)
                RenditionsMade++;
            switch (outcome.Result)
            {
                case ItemMigrationResult.Published: Published++; break;
                case ItemMigrationResult.AlreadyPublic: AlreadyPublic++; break;
                case ItemMigrationResult.Hidden: Hidden++; break;
                case ItemMigrationResult.Skipped: Skipped[outcome.Reason!] = Skipped.GetValueOrDefault(outcome.Reason!) + 1; break;
                case ItemMigrationResult.Failed:
                    Failed++;
                    FailedItems.Add(new MaintenanceFailedItem { TenantId = item.TenantId, ItemId = item.Id, Reason = outcome.Reason ?? "error" });
                    break;
            }
        }
    }

    public async Task<bool> RunBatchAsync(PublishItemImagesBatchRequested message, CancellationToken ct)
    {
        var run = await GetAsync(message.MaintenanceRunId, ct);
        if (run is null || !run.IsActive || run.Seq != message.Seq)
            return true; // finished, unknown or a redelivered message of an earlier batch
        if (run.Status == MaintenanceRunStatus.Cancelling)
        {
            await SaveAsync(run, new Progress { CursorTenant = run.CursorTenant, CursorItem = run.CursorItem, OnlyIndex = run.OnlyIndex }, ct);
            return true;
        }

        var progress = new Progress { CursorTenant = run.CursorTenant, CursorItem = run.CursorItem, OnlyIndex = run.OnlyIndex };
        var settings = options.CurrentValue;
        var deadline = time.GetUtcNow().AddSeconds(Math.Max(1, settings.BatchSeconds));
        var max = Math.Max(1, settings.BatchSize);
        bool Full() => progress.Scanned >= max || time.GetUtcNow() >= deadline;

        if (run.OnlyItems is { } only)
        {
            while (progress.OnlyIndex < only.Count && !Full())
            {
                var target = only[progress.OnlyIndex];
                var item = await repository.GetAsync<ItemEntity>(ItemEntity.GetPk(target.TenantId), ItemEntity.GetSk(target.ItemId), ct);
                progress.Count(item ?? new ItemEntity { TenantId = target.TenantId, Id = target.ItemId },
                    item is null ? new(ItemMigrationResult.Skipped, ItemImageMigrator.SkipReasons.ItemDeleted) : await MigrateAsync(item, run.DryRun, ct));
                progress.OnlyIndex++;
            }
            progress.Done = progress.OnlyIndex >= only.Count;
        }
        else
        {
            await ScanAsync(run, progress, Full, ct);
        }

        var saved = await SaveAsync(run, progress, ct);
        if (saved.IsActive)
            await queue.EnqueueAsync(new PublishItemImagesBatchRequested(saved.Id, saved.Seq), ct);
        return !saved.IsActive;
    }

    private async Task ScanAsync(MaintenanceRunEntity run, Progress progress, Func<bool> full, CancellationToken ct)
    {
        // CursorItem null = CursorTenant is done; otherwise CursorTenant is in progress after CursorItem.
        var tenants = (await repository.GetAllAsync<TenantEntity>(TenantEntity.GetPk(), ct))
            .Select(t => t.Id)
            .Where(id => run.CursorTenant is null || string.CompareOrdinal(id, run.CursorTenant) > 0
                         || (run.CursorItem is not null && id == run.CursorTenant))
            .Order(StringComparer.Ordinal)
            .ToList();
        foreach (var tenantId in tenants)
        {
            var after = tenantId == run.CursorTenant ? run.CursorItem : null;
            var items = (await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct))
                .Where(i => after is null || string.CompareOrdinal(i.Id, after) > 0)
                .OrderBy(i => i.Id, StringComparer.Ordinal)
                .ToList();
            foreach (var item in items)
            {
                if (full())
                    return; // the cursor stays at the last piece done
                progress.Count(item, await MigrateAsync(item, run.DryRun, ct));
                progress.CursorTenant = tenantId;
                progress.CursorItem = item.Id;
            }
            progress.CursorTenant = tenantId;
            progress.CursorItem = null;
            progress.Tenants++;
        }
        progress.Done = true;
    }

    private async Task<ItemMigrationOutcome> MigrateAsync(ItemEntity item, bool dryRun, CancellationToken ct)
    {
        try
        {
            return await migrator.MigrateAsync(item, dryRun, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("publish-item-images: item {ItemId} of tenant {TenantId} failed ({Error})", item.Id, item.TenantId, ex.GetType().Name);
            return new(ItemMigrationResult.Failed, "error");
        }
    }

    /// <summary>Merges the batch into the current row (re-read on a conflict), advances Seq, finishes the run when done or cancelled.</summary>
    private async Task<MaintenanceRunEntity> SaveAsync(MaintenanceRunEntity run, Progress progress, CancellationToken ct)
    {
        for (var attempt = 0; attempt < Retries; attempt++)
        {
            var now = time.GetUtcNow().UtcDateTime;
            var expected = run.Version;
            run.Tenants += progress.Tenants;
            run.Scanned += progress.Scanned;
            run.Published += progress.Published;
            run.AlreadyPublic += progress.AlreadyPublic;
            run.Hidden += progress.Hidden;
            run.RenditionsMade += progress.RenditionsMade;
            run.Failed += progress.Failed;
            foreach (var (reason, count) in progress.Skipped)
                run.SkipReasons[reason] = run.SkipReasons.GetValueOrDefault(reason) + count;
            foreach (var failed in progress.FailedItems)
                if (run.FailedItems.Count < MaintenanceRunEntity.MaxFailedItems)
                    run.FailedItems.Add(failed);
            run.CursorTenant = progress.CursorTenant;
            run.CursorItem = progress.CursorItem;
            run.OnlyIndex = progress.OnlyIndex;
            run.Seq++;
            run.UpdatedAt = now;
            if (run.Status == MaintenanceRunStatus.Queued)
                run.Status = MaintenanceRunStatus.Running;
            if (run.Status == MaintenanceRunStatus.Cancelling || progress.Done)
            {
                run.Status = run.Status == MaintenanceRunStatus.Cancelling ? MaintenanceRunStatus.Cancelled : MaintenanceRunStatus.Completed;
                run.FinishedAt = now;
            }
            if (await repository.SaveIfVersionAsync(run, expected, ct))
            {
                if (!run.IsActive)
                    await ReleaseLockAsync(run, ct);
                return run;
            }
            run = await GetAsync(run.Id, ct) ?? throw new InvalidOperationException("Maintenance run disappeared.");
        }
        throw new InvalidOperationException($"Maintenance run {run.Id} could not be saved after retries.");
    }

    /// <summary>The last delivery of a batch failed: the run is marked failed and the lock released (a new run resumes nothing, but is idempotent).</summary>
    public async Task FailAsync(string runId, CancellationToken ct)
    {
        for (var attempt = 0; attempt < Retries; attempt++)
        {
            var run = await GetAsync(runId, ct);
            if (run is null || !run.IsActive)
                return;
            var expected = run.Version;
            run.Status = MaintenanceRunStatus.Failed;
            run.FinishedAt = run.UpdatedAt = time.GetUtcNow().UtcDateTime;
            if (await repository.SaveIfVersionAsync(run, expected, ct))
            {
                await ReleaseLockAsync(run, ct);
                return;
            }
        }
    }

    private async Task ReleaseLockAsync(MaintenanceRunEntity run, CancellationToken ct)
    {
        var current = await repository.GetAsync<MaintenanceLockEntity>(run.Pk, MaintenanceLockEntity.GetSk(), ct);
        if (current?.RunId == run.Id)
            await repository.DeleteAsync(run.Pk, MaintenanceLockEntity.GetSk(), ct);
    }

    private Task<MaintenanceRunEntity?> GetAsync(string runId, CancellationToken ct) =>
        repository.GetAsync<MaintenanceRunEntity>(MaintenanceRunEntity.GetPk(MaintenanceRunEntity.PublishItemImages), MaintenanceRunEntity.GetSk(runId), ct);
}

/// <summary>Admin side (<see cref="IMaintenanceService"/>). Every write is audited (maintenance.*).</summary>
public sealed class MaintenanceService(
    IRepository repository,
    IMaintenanceQueue queue,
    IAuditLog audit,
    TimeProvider time,
    ILogger<MaintenanceService> logger) : IMaintenanceService
{
    private const int ListLimit = 20;
    private static readonly string Pk = MaintenanceRunEntity.GetPk(MaintenanceRunEntity.PublishItemImages);

    public Task<MaintenanceStartResult> StartPublishItemImagesAsync(AdminUserEntity actor, bool dryRun, string? ip, CancellationToken ct) =>
        StartAsync(actor, dryRun, null, null, ip, ct);

    public async Task<MaintenanceRunsDto> ListPublishItemImagesAsync(CancellationToken ct)
    {
        var runs = await repository.GetAllAsync<MaintenanceRunEntity>(Pk, "run#", SkOperator.BeginsWith, ct);
        return new MaintenanceRunsDto(runs.OrderByDescending(r => r.Id, StringComparer.Ordinal).Take(ListLimit).Select(MaintenanceRunDto.From).ToList());
    }

    public async Task<MaintenanceRunDto?> GetPublishItemImagesAsync(string runId, CancellationToken ct) =>
        await GetAsync(runId, ct) is { } run ? MaintenanceRunDto.From(run) : null;

    public async Task<MaintenanceCancelResult> CancelPublishItemImagesAsync(AdminUserEntity actor, string runId, string? ip, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var run = await GetAsync(runId, ct);
            if (run is null)
                return new(MaintenanceCancelOutcome.NotFound, null);
            if (!run.IsActive)
                return new(MaintenanceCancelOutcome.Finished, MaintenanceRunDto.From(run));
            if (run.Status == MaintenanceRunStatus.Cancelling)
                return new(MaintenanceCancelOutcome.Cancelling, MaintenanceRunDto.From(run));
            var expected = run.Version;
            var now = time.GetUtcNow().UtcDateTime;
            run.Status = MaintenanceRunStatus.Cancelling;
            run.CancelRequestedAt = run.UpdatedAt = now;
            if (await repository.SaveIfVersionAsync(run, expected, ct))
            {
                await audit.WriteAsync(actor, "maintenance.publish_item_images.cancel", "maintenance_run", run.Id, null, new { status = "cancelling" }, ip, ct);
                return new(MaintenanceCancelOutcome.Cancelling, MaintenanceRunDto.From(run));
            }
        }
        throw new InvalidOperationException($"Maintenance run {runId} could not be cancelled after retries.");
    }

    public async Task<MaintenanceStartResult> RetryFailedPublishItemImagesAsync(AdminUserEntity actor, string runId, string? ip, CancellationToken ct)
    {
        var run = await GetAsync(runId, ct);
        if (run is null)
            return new(MaintenanceStartOutcome.NotFound, null);
        if (run.FailedItems.Count == 0)
            return new(MaintenanceStartOutcome.NothingToRetry, MaintenanceRunDto.From(run));
        var only = run.FailedItems.Select(f => new MaintenanceItemRef { TenantId = f.TenantId, ItemId = f.ItemId }).ToList();
        return await StartAsync(actor, run.DryRun, run.Id, only, ip, ct);
    }

    private async Task<MaintenanceStartResult> StartAsync(AdminUserEntity actor, bool dryRun, string? retryOf, List<MaintenanceItemRef>? only, string? ip, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var run = new MaintenanceRunEntity
        {
            Id = Ulid.New(now), DryRun = dryRun, Status = MaintenanceRunStatus.Queued, RetryOf = retryOf, OnlyItems = only,
            StartedById = actor.Id, StartedByEmail = actor.Email, StartedAt = now, UpdatedAt = now, Version = 1,
        };
        var created = await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Create(new MaintenanceLockEntity { RunId = run.Id, CreatedAt = now }),
            TransactWriteOperation.Create(run),
        ], ct);
        if (!created.Applied)
        {
            var active = await repository.GetAsync<MaintenanceLockEntity>(Pk, MaintenanceLockEntity.GetSk(), ct);
            var current = active is null ? null : await GetAsync(active.RunId, ct);
            return new(MaintenanceStartOutcome.Active, current is null ? null : MaintenanceRunDto.From(current));
        }

        try
        {
            await queue.EnqueueAsync(new PublishItemImagesBatchRequested(run.Id, run.Seq), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "publish-item-images run {RunId} could not be queued", run.Id);
            run.Status = MaintenanceRunStatus.Failed;
            run.FinishedAt = now;
            await repository.SaveIfVersionAsync(run, 1, ct);
            await repository.DeleteAsync(Pk, MaintenanceLockEntity.GetSk(), ct);
            throw;
        }

        await audit.WriteAsync(actor, retryOf is null ? "maintenance.publish_item_images.start" : "maintenance.publish_item_images.retry_failed",
            "maintenance_run", run.Id, null, new { dryRun, retryOf, items = only?.Count }, ip, ct);
        return new(MaintenanceStartOutcome.Started, MaintenanceRunDto.From(run));
    }

    private Task<MaintenanceRunEntity?> GetAsync(string runId, CancellationToken ct) =>
        string.IsNullOrWhiteSpace(runId) || runId.Length > 64
            ? Task.FromResult<MaintenanceRunEntity?>(null)
            : repository.GetAsync<MaintenanceRunEntity>(Pk, MaintenanceRunEntity.GetSk(runId), ct);
}

/// <summary>Batches go to the item processor queue (the worker with SkiaSharp); the worker routes them by their shape.</summary>
public sealed class SqsMaintenanceQueue(IAmazonSQS sqs, IOptionsMonitor<QueueOptions> queues) : IMaintenanceQueue
{
    public async Task EnqueueAsync(PublishItemImagesBatchRequested message, CancellationToken ct)
    {
        var url = queues.CurrentValue.ItemProcessRequest ?? throw new InvalidOperationException("No item processor queue configured (ITEM_PROCESS_REQUEST_QUEUE_URL).");
        await sqs.SendMessageAsync(new SendMessageRequest { QueueUrl = url, MessageBody = MessageSerializer.Serialize(message) }, ct);
    }

    /// <summary>True for a batch message (the item processor queue also carries ItemProcessRequestedEvent).</summary>
    public static bool IsBatchMessage(string body) =>
        body.Contains("\"maintenanceRunId\"", StringComparison.Ordinal);
}
