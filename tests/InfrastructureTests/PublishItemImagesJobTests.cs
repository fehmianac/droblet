using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Domain.Services.Admin;
using Infrastructure.Services.Admin;
using Infrastructure.Services.Maintenance;
using Infrastructure.Storage;
using Microsoft.Extensions.Logging.Abstractions;
using Tests.Shared;
using Skip = Infrastructure.Services.Maintenance.ItemImageMigrator.SkipReasons;

namespace InfrastructureTests;

/// <summary>Admin "Bakım" › publish-item-images (docs/images.md §8): batches, resume, cancel, idempotency, retry, audit.</summary>
public class PublishItemImagesJobTests
{
    private static readonly AdminUserEntity Admin = new() { Id = "adm-1", Email = "owner@droblet.test", Name = "Owner", Role = AdminRole.SuperAdmin };

    private readonly InMemoryRepository _repository = new();
    private readonly FakeObjectStorage _storage = new();
    private readonly FakeCdnCache _cdn = new();
    private readonly FakeThumbnailer _thumbnailer = new();
    private readonly RecordingMaintenanceQueue _queue = new();
    private readonly Microsoft.Extensions.Time.Testing.FakeTimeProvider _time = Fixtures.Clock();
    private readonly MaintenanceOptions _options = new() { BatchSize = 200, BatchSeconds = 60 };

    private ItemImagePublisher Publisher() => new(_storage, _cdn, NullLogger<ItemImagePublisher>.Instance);

    private MaintenanceService Service() => new(_repository, _queue, new AuditLog(_repository, _time, NullLogger<AuditLog>.Instance), _time,
        NullLogger<MaintenanceService>.Instance);

    private PublishItemImagesJob Job() => new(_repository, new ItemImageMigrator(_repository, _storage, _thumbnailer, Publisher(), _time), _queue,
        Fixtures.Monitor(_options), _time, NullLogger<PublishItemImagesJob>.Instance);

    private Task<ItemEntity?> GetAsync(string tenant, string id) => _repository.GetAsync<ItemEntity>(ItemEntity.GetPk(tenant), ItemEntity.GetSk(id));

    private async Task<ItemEntity> CleanedAsync(string tenant, string id, bool renditions = false, bool hidden = false)
    {
        var key = StorageKeys.ItemImage(tenant, "d-" + id);
        await _storage.PutAsync(key, [1, 2, 3], "image/webp", default);
        if (renditions)
            foreach (var r in ItemImageRenditions.KeysOf(key))
                await _storage.PutAsync(r, [9], "image/webp", default);
        var item = new ItemEntity
        {
            Id = id, TenantId = tenant, Category = ItemCategory.Top, Source = ItemSource.Photo, ImageKey = key,
            OriginalImageKey = StorageKeys.ItemOriginal(tenant, "d-" + id, "jpg"), Version = 3,
            ModerationHiddenAt = hidden ? Fixtures.Now : null,
        };
        await _repository.SaveAsync(item);
        return item;
    }

    /// <summary>t1: single photo (no renditions yet), multi-item piece (renditions), hidden, library. t2: import pending, import cleaned, missing image.</summary>
    private async Task ArrangeAsync()
    {
        foreach (var tenant in new[] { "t1", "t2" })
            await _repository.SaveAsync(new TenantEntity { Id = tenant, OwnerUserId = "u-" + tenant, Version = 1 });
        await CleanedAsync("t1", "a");
        await CleanedAsync("t1", "b", renditions: true);
        await CleanedAsync("t1", "h", hidden: true);
        await _repository.SaveAsync(new ItemEntity { Id = "l", TenantId = "t1", Source = ItemSource.Library, GlobalImageKey = "library/x.webp", Version = 1 });
        await _repository.SaveAsync(new ItemEntity
        {
            Id = "o", TenantId = "t2", Source = ItemSource.Photo, Version = 1, UseOriginalImage = true, OriginalImageKey = StorageKeys.ImportCrop("t2", "s", 1, 1),
        });
        await CleanedAsync("t2", "c");
        await _repository.SaveAsync(new ItemEntity { Id = "m", TenantId = "t2", Source = ItemSource.Photo, ImageKey = StorageKeys.ItemImage("t2", "gone"), Version = 1 });
    }

    /// <summary>Plays the queue like the worker: one message at a time until none is left.</summary>
    private async Task<MaintenanceRunDto> DrainAsync(string runId)
    {
        while (_queue.Pending.TryDequeue(out var message))
            await Job().RunBatchAsync(message, default);
        return (await Service().GetPublishItemImagesAsync(runId, default))!;
    }

    private async Task<MaintenanceRunDto> StartAsync(bool dryRun = false)
    {
        var started = await Service().StartPublishItemImagesAsync(Admin, dryRun, "10.0.0.1", default);
        Assert.Equal(MaintenanceStartOutcome.Started, started.Outcome);
        return started.Run!;
    }

    private Task<MaintenanceLockEntity?> LockAsync() =>
        _repository.GetAsync<MaintenanceLockEntity>(MaintenanceRunEntity.GetPk(MaintenanceRunEntity.PublishItemImages), MaintenanceLockEntity.GetSk());

    [Fact]
    public async Task Run_InSmallBatches_PublishesCleanedImages_SkipsWithReasons_AndCompletes()
    {
        await ArrangeAsync();
        _options.BatchSize = 2;

        var run = await DrainAsync((await StartAsync()).Id);

        Assert.Equal(MaintenanceRunStatus.Completed, run.Status);
        Assert.Equal((2, 7, 3, 0, 1, 2, 0), (run.Tenants, run.Scanned, run.Published, run.AlreadyPublic, run.Hidden, run.RenditionsMade, run.Failed));
        Assert.Equal([new(Skip.CleanedMissing, 1), new(Skip.LibraryOrCatalog, 1), new(Skip.OriginalOnly, 1)], run.SkipReasons.OrderBy(s => s.Reason).ToList());
        Assert.Equal(3, run.Skipped);
        Assert.True(_queue.Sent.Count >= 4);                                       // 7 pieces / 2 per batch, plus the last one
        Assert.Equal(Enumerable.Range(0, _queue.Sent.Count), _queue.Sent.Select(m => m.Seq));
        Assert.NotNull(run.FinishedAt);
        Assert.Null(await LockAsync());

        var a = (await GetAsync("t1", "a"))!;
        Assert.Equal(4, a.Version);
        Assert.All(new[] { a.PublicImageKey, a.PublicMediumKey, a.PublicThumbKey }, k => Assert.True(_storage.Objects.ContainsKey(k!)));
        Assert.Null((await GetAsync("t1", "h"))!.PublicImageKey);
        Assert.Null((await GetAsync("t2", "o"))!.PublicImageKey);
        Assert.Equal(9, _storage.Objects.Keys.Count(k => k.StartsWith(StorageKeys.PublicItemsPrefix, StringComparison.Ordinal)));
        Assert.DoesNotContain(_storage.Objects.Keys, k => k.StartsWith("public/", StringComparison.Ordinal) && !k.StartsWith(StorageKeys.PublicItemsPrefix, StringComparison.Ordinal));
    }

    [Fact]
    public async Task SecondRun_IsIdempotent_NothingChanges()
    {
        await ArrangeAsync();
        await DrainAsync((await StartAsync()).Id);
        var objects = _storage.Objects.Keys.Order(StringComparer.Ordinal).ToList();

        var second = await DrainAsync((await StartAsync()).Id);

        Assert.Equal((0, 3, 0), (second.Published, second.AlreadyPublic, second.RenditionsMade));
        Assert.Equal(objects, _storage.Objects.Keys.Order(StringComparer.Ordinal).ToList());
        Assert.Equal(4, (await GetAsync("t1", "a"))!.Version);
    }

    [Fact]
    public async Task DryRun_CountsButWritesNothing()
    {
        await ArrangeAsync();
        var objects = _storage.Objects.Keys.Order(StringComparer.Ordinal).ToList();

        var run = await DrainAsync((await StartAsync(dryRun: true)).Id);

        Assert.True(run.DryRun);
        Assert.Equal((3, 2), (run.Published, run.RenditionsMade));
        Assert.Equal(objects, _storage.Objects.Keys.Order(StringComparer.Ordinal).ToList());
        Assert.Equal(3, (await GetAsync("t1", "a"))!.Version);
    }

    [Fact]
    public async Task RedeliveredMessage_IsANoOp_AndAResumedBatchContinuesFromTheCursor()
    {
        await ArrangeAsync();
        _options.BatchSize = 3;
        var run = await StartAsync();
        var first = _queue.Pending.Dequeue();
        await Job().RunBatchAsync(first, default);
        var afterFirst = (await Service().GetPublishItemImagesAsync(run.Id, default))!;

        await Job().RunBatchAsync(first, default);                               // SQS redelivers batch 0

        var again = (await Service().GetPublishItemImagesAsync(run.Id, default))!;
        Assert.Equal(3, afterFirst.Scanned);
        Assert.Equal(afterFirst.Scanned, again.Scanned);
        Assert.Single(_queue.Pending);                                           // only batch 1 is queued
        var done = await DrainAsync(run.Id);
        Assert.Equal((7, 3), (done.Scanned, done.Published));                    // every piece exactly once
    }

    [Fact]
    public async Task Cancel_StopsAtTheNextBatch_ReleasesTheLock_AndIsAudited()
    {
        await ArrangeAsync();
        _options.BatchSize = 2;
        var run = await StartAsync();
        await Job().RunBatchAsync(_queue.Pending.Dequeue(), default);

        var cancel = await Service().CancelPublishItemImagesAsync(Admin, run.Id, null, default);
        Assert.Equal((MaintenanceCancelOutcome.Cancelling, MaintenanceRunStatus.Cancelling), (cancel.Outcome, cancel.Run!.Status));
        var stopped = await DrainAsync(run.Id);

        Assert.Equal(MaintenanceRunStatus.Cancelled, stopped.Status);
        Assert.Equal(2, stopped.Scanned);
        Assert.Null(await LockAsync());
        Assert.Equal(MaintenanceCancelOutcome.Finished, (await Service().CancelPublishItemImagesAsync(Admin, run.Id, null, default)).Outcome);
        Assert.Equal(MaintenanceCancelOutcome.NotFound, (await Service().CancelPublishItemImagesAsync(Admin, "nope", null, default)).Outcome);
        var audit = await _repository.GetAllAsync<AdminAuditEntity>(AdminAuditEntity.GetPk());
        Assert.Contains(audit, e => e.Action == "maintenance.publish_item_images.start" && e.TargetId == run.Id && e.AdminId == Admin.Id);
        Assert.Contains(audit, e => e.Action == "maintenance.publish_item_images.cancel" && e.TargetId == run.Id);
        // A new run can start, and finishes the work idempotently.
        var rest = await DrainAsync((await StartAsync()).Id);
        Assert.Equal(3, rest.Published + rest.AlreadyPublic);
    }

    [Fact]
    public async Task OneActiveRunAtATime()
    {
        await ArrangeAsync();
        var first = await StartAsync();

        var second = await Service().StartPublishItemImagesAsync(Admin, dryRun: false, null, default);

        Assert.Equal(MaintenanceStartOutcome.Active, second.Outcome);
        Assert.Equal(first.Id, second.Run!.Id);
        Assert.Single((await Service().ListPublishItemImagesAsync(default)).Runs);
    }

    [Fact]
    public async Task FailedPieces_AreListed_AndRetryFailedProcessesOnlyThem()
    {
        await ArrangeAsync();
        _storage.FailCopyTo = k => k.Contains("/c-", StringComparison.Ordinal);   // t2/c cannot be copied
        var run = await DrainAsync((await StartAsync()).Id);
        Assert.Equal(1, run.Failed);
        Assert.Equal(new MaintenanceFailedItemDto("t2", "c", "copyFailed"), Assert.Single(run.FailedItems));

        _storage.FailCopyTo = null;
        var retry = await Service().RetryFailedPublishItemImagesAsync(Admin, run.Id, null, default);
        Assert.Equal(MaintenanceStartOutcome.Started, retry.Outcome);
        Assert.Equal((run.Id, 1), (retry.Run!.RetryOf, retry.Run.OnlyItemCount));
        var retried = await DrainAsync(retry.Run.Id);

        Assert.Equal((1, 1, 0), (retried.Scanned, retried.Published, retried.Failed));
        Assert.NotNull((await GetAsync("t2", "c"))!.PublicImageKey);
        Assert.Equal(MaintenanceStartOutcome.NothingToRetry, (await Service().RetryFailedPublishItemImagesAsync(Admin, retried.Id, null, default)).Outcome);
        Assert.Equal(MaintenanceStartOutcome.NotFound, (await Service().RetryFailedPublishItemImagesAsync(Admin, "nope", null, default)).Outcome);
        Assert.Contains(await _repository.GetAllAsync<AdminAuditEntity>(AdminAuditEntity.GetPk()), e => e.Action == "maintenance.publish_item_images.retry_failed");
    }

    [Fact]
    public async Task LastDeliveryFailure_MarksTheRunFailed_AndReleasesTheLock()
    {
        await ArrangeAsync();
        var run = await StartAsync();

        await Job().FailAsync(run.Id, default);

        Assert.Equal(MaintenanceRunStatus.Failed, (await Service().GetPublishItemImagesAsync(run.Id, default))!.Status);
        Assert.Null(await LockAsync());
        Assert.True(await Job().RunBatchAsync(_queue.Pending.Dequeue(), default));  // its queued batch is then a no-op
    }

    [Fact]
    public void BatchMessages_AreRecognisedOnTheSharedQueue()
    {
        Assert.True(SqsMaintenanceQueue.IsBatchMessage(Infrastructure.Serialization.MessageSerializer.Serialize(new PublishItemImagesBatchRequested("r", 0))));
        Assert.False(SqsMaintenanceQueue.IsBatchMessage(Infrastructure.Serialization.MessageSerializer.Serialize(
            new Domain.Events.ItemProcessRequestedEvent("t", "j", "d"))));
    }
}
