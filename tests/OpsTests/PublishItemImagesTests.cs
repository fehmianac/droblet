using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Domain.Services.Admin;
using Infrastructure.Services.Admin;
using Infrastructure.Services.Maintenance;
using Infrastructure.Storage;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using Ops;
using Ops.Commands;
using Tests.Shared;

namespace OpsTests;

/// <summary>publish-item-images as a thin wrapper over the admin "Bakım" job (the job itself: InfrastructureTests.PublishItemImagesJobTests).</summary>
public class PublishItemImagesTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("ops-publish-test-").FullName;
    private readonly InMemoryRepository _repository = new();
    private readonly FakeObjectStorage _storage = new();
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 11, 20, 9, 0, 0, TimeSpan.Zero));

    public void Dispose()
    {
        Directory.Delete(_dir, recursive: true);
        GC.SuppressFinalize(this);
    }

    private sealed class Monitor<T>(T value) : IOptionsMonitor<T>
    {
        public T CurrentValue => value;
        public T Get(string? name) => value;
        public IDisposable? OnChange(Action<T, string?> listener) => null;
    }

    private (MaintenanceService Service, PublishItemImagesJob Job, PublishItemImagesCommand.InlineQueue Queue) Inline(int batchSize = 1)
    {
        var queue = new PublishItemImagesCommand.InlineQueue();
        var publisher = new ItemImagePublisher(_storage, new FakeCdnCache(), NullLogger<ItemImagePublisher>.Instance);
        var service = new MaintenanceService(_repository, queue, new AuditLog(_repository, _time, NullLogger<AuditLog>.Instance), _time, NullLogger<MaintenanceService>.Instance);
        var job = new PublishItemImagesJob(_repository, new ItemImageMigrator(_repository, _storage, new FakeThumbnailer(), publisher, _time), queue,
            new Monitor<MaintenanceOptions>(new MaintenanceOptions { BatchSize = batchSize }), _time, NullLogger<PublishItemImagesJob>.Instance);
        return (service, job, queue);
    }

    private async Task ArrangeAsync()
    {
        await _repository.SaveAsync(new TenantEntity { Id = "t1", OwnerUserId = "u", Version = 1 });
        foreach (var id in new[] { "a", "b" })
        {
            var key = StorageKeys.ItemImage("t1", "d-" + id);
            await _storage.PutAsync(key, [1, 2], "image/webp", default);
            await _repository.SaveAsync(new ItemEntity { Id = id, TenantId = "t1", Category = ItemCategory.Top, Source = ItemSource.Photo, ImageKey = key, Version = 1 });
        }
    }

    [Fact]
    public async Task Inline_StartsTheSameRun_ProcessesEveryBatch_AndReportsIt()
    {
        await ArrangeAsync();
        var (service, job, queue) = Inline();

        var exit = await PublishItemImagesCommand.RunAsync(service, job, queue, dryRun: false, wait: false, "dev", new OpsOutput(_dir), default);

        Assert.Equal(0, exit);
        var run = Assert.Single((await service.ListPublishItemImagesAsync(default)).Runs);   // the run the admin panel lists
        Assert.Equal((MaintenanceRunStatus.Completed, 2, 2), (run.Status, run.Scanned, run.Published));
        Assert.Equal(OpsHost.ActorId, run.StartedBy.Id);
        Assert.Contains(await _repository.GetAllAsync<AdminAuditEntity>(AdminAuditEntity.GetPk()), e => e.Action == "maintenance.publish_item_images.start" && e.AdminId == OpsHost.ActorId);
    }

    [Fact]
    public async Task Refused_WhenARunIsActive_ExitOne()
    {
        await ArrangeAsync();
        var (service, _, _) = Inline();
        await service.StartPublishItemImagesAsync(new AdminUserEntity { Id = "adm", Email = "a@b.c" }, false, null, default);

        Assert.Equal(1, await PublishItemImagesCommand.RunAsync(service, null, null, dryRun: true, wait: false, "dev", new OpsOutput(_dir), default));
    }

    [Fact]
    public async Task Queued_WithoutWait_ReturnsAtOnce_TheWorkerDoesTheRest()
    {
        await ArrangeAsync();
        var (service, _, queue) = Inline();

        Assert.Equal(0, await PublishItemImagesCommand.RunAsync(service, null, null, dryRun: true, wait: false, "dev", new OpsOutput(_dir), default));
        Assert.NotNull(queue.Next);
        Assert.Equal(MaintenanceRunStatus.Queued, Assert.Single((await service.ListPublishItemImagesAsync(default)).Runs).Status);
    }

    [Theory]
    [InlineData("prod")]
    [InlineData("dev")]
    public void Arguments_AllowedOnEveryStage(string stage)
    {
        var (parsed, error) = OpsArguments.Parse(["publish-item-images", "--stage", stage, "--dry-run", "--wait"]);

        Assert.Null(error);
        Assert.True(parsed!.DryRun && parsed.Flag("wait"));
        Assert.Null(OpsArguments.Parse(["publish-item-images", "--stage", stage, "--inline"]).Error);
        Assert.NotNull(OpsArguments.Parse(["publish-item-images", "--stage", stage, "--wait", "--inline"]).Error);
        Assert.Equal($"droblet-{stage}-item-process-request", PublishItemImagesCommand.QueueName(stage));
    }
}
