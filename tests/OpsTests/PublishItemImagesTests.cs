using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Infrastructure.Storage;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Ops;
using Ops.Commands;
using Tests.Shared;
using Skip = Ops.Commands.PublishItemImagesCommand.SkipReason;

namespace OpsTests;

public class PublishItemImagesTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("ops-publish-test-").FullName;
    private readonly InMemoryRepository _repository = new();
    private readonly FakeObjectStorage _storage = new();
    private readonly FakeCdnCache _cdn = new();
    private readonly FakeThumbnailer _thumbnailer = new();
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 11, 20, 9, 0, 0, TimeSpan.Zero));

    public void Dispose()
    {
        Directory.Delete(_dir, recursive: true);
        GC.SuppressFinalize(this);
    }

    private ItemImagePublisher Publisher() => new(_storage, _cdn, NullLogger<ItemImagePublisher>.Instance);

    private Task<PublishItemImagesCommand.Result> RunAsync(bool dryRun = false, string? after = null) =>
        PublishItemImagesCommand.PublishAsync(_repository, _storage, _thumbnailer, Publisher(), _time, dryRun, after, new OpsOutput(_dir), default);

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
            ModerationHiddenAt = hidden ? new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc) : null,
        };
        await _repository.SaveAsync(item);
        return item;
    }

    private async Task ArrangeAsync()
    {
        foreach (var tenant in new[] { "t1", "t2" })
            await _repository.SaveAsync(new TenantEntity { Id = tenant, OwnerUserId = "u-" + tenant, Version = 1 });
        await CleanedAsync("t1", "a");                                  // single photo, cleaned before renditions existed
        await CleanedAsync("t1", "b", renditions: true);                // multi-item piece with renditions
        await CleanedAsync("t1", "h", hidden: true);                    // moderation-hidden: never public
        await _repository.SaveAsync(new ItemEntity { Id = "l", TenantId = "t1", Source = ItemSource.Library, GlobalImageKey = "library/x.webp", Version = 1 });
        await _repository.SaveAsync(new ItemEntity
        {
            Id = "o", TenantId = "t2", Source = ItemSource.Photo, Version = 1, UseOriginalImage = true,  // outfit-import piece, cleanup pending
            OriginalImageKey = StorageKeys.ImportCrop("t2", "s", 1, 1),
        });
        await CleanedAsync("t2", "c");                                  // outfit-import piece with its cleaned image
        await _repository.SaveAsync(new ItemEntity { Id = "m", TenantId = "t2", Source = ItemSource.Photo, ImageKey = StorageKeys.ItemImage("t2", "gone"), Version = 1 });
    }

    [Fact]
    public async Task Publish_AllTenants_MakesRenditions_PublishesCleaned_SkipsWithReasons_BumpsVersion()
    {
        await ArrangeAsync();

        var result = await RunAsync();

        Assert.Equal((2, 7, 3, 0, 1, 0, 2), (result.Tenants, result.Scanned, result.Published, result.AlreadyPublic, result.Hidden, result.Failed, result.RenditionsMade));
        Assert.Equal(new Dictionary<string, int> { [Skip.LibraryOrCatalog] = 1, [Skip.OriginalOnly] = 1, [Skip.CleanedMissing] = 1 }, result.Skipped);
        Assert.Equal("t2", result.Checkpoint);

        var a = (await GetAsync("t1", "a"))!;
        Assert.Equal(4, a.Version);
        Assert.Equal(_time.GetUtcNow().UtcDateTime, a.UpdatedAt);
        Assert.All(new[] { a.PublicImageKey, a.PublicMediumKey, a.PublicThumbKey }, k => Assert.True(_storage.Objects.ContainsKey(k!)));
        Assert.All(ItemImageRenditions.KeysOf(a.ImageKey!), k => Assert.True(_storage.Objects.ContainsKey(k)));
        Assert.Equal("webp-256"u8.ToArray(), _storage.Objects[a.PublicThumbKey!].Data);
        Assert.Null((await GetAsync("t1", "h"))!.PublicImageKey);
        Assert.Null((await GetAsync("t2", "o"))!.PublicImageKey);
        Assert.Equal(1, (await GetAsync("t1", "l"))!.Version);
        // Only cleaned images went public: no original, crop or anything outside public/items/.
        Assert.All(_storage.Objects.Keys.Where(k => k.StartsWith("public/", StringComparison.Ordinal)), k => Assert.StartsWith("public/items/", k));
        Assert.Equal(9, _storage.Objects.Keys.Count(k => k.StartsWith("public/", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task Publish_SecondRun_ChangesNothing()
    {
        await ArrangeAsync();
        await RunAsync();
        var before = _storage.Objects.Keys.Order(StringComparer.Ordinal).ToList();
        var version = (await GetAsync("t1", "a"))!.Version;

        var second = await RunAsync();

        Assert.Equal((0, 3, 0), (second.Published, second.AlreadyPublic, second.RenditionsMade));
        Assert.Equal(before, _storage.Objects.Keys.Order(StringComparer.Ordinal).ToList());
        Assert.Equal(version, (await GetAsync("t1", "a"))!.Version);
    }

    [Fact]
    public async Task Publish_DryRun_CountsButWritesNothing()
    {
        await ArrangeAsync();
        var before = _storage.Objects.Keys.Order(StringComparer.Ordinal).ToList();

        var result = await RunAsync(dryRun: true);

        Assert.Equal((3, 2), (result.Published, result.RenditionsMade));
        Assert.Equal(before, _storage.Objects.Keys.Order(StringComparer.Ordinal).ToList());
        Assert.Equal(3, (await GetAsync("t1", "a"))!.Version);
    }

    [Fact]
    public async Task Publish_ResumesAfterTheCheckpoint()
    {
        await ArrangeAsync();

        var result = await RunAsync(after: "t1");

        Assert.Equal((1, 1), (result.Tenants, result.Published));
        Assert.Null((await GetAsync("t1", "a"))!.PublicImageKey);
        Assert.NotNull((await GetAsync("t2", "c"))!.PublicImageKey);
    }

    [Fact]
    public async Task Publish_RepublishesWhenThePublicCopyIsGone_OrHadNoThumbnails_AndDeletesTheOldCopy()
    {
        await _repository.SaveAsync(new TenantEntity { Id = "t1", OwnerUserId = "u", Version = 1 });
        var item = await CleanedAsync("t1", "a");
        var old = (await Publisher().PublishAsync(item, default))!;  // published before renditions existed: full only
        item.SetPublicImage(old);
        await _repository.SaveAsync(item);

        var result = await RunAsync();
        var stored = (await GetAsync("t1", "a"))!;

        Assert.Equal(1, result.Published);
        Assert.NotEqual(old.FullKey, stored.PublicImageKey);
        Assert.NotNull(stored.PublicThumbKey);
        Assert.False(_storage.Objects.ContainsKey(old.FullKey));
        Assert.Contains(old.FullKey, _cdn.Purged);
    }

    [Fact]
    public async Task Publish_CopyFailure_IsReportedAsFailed_ExitCodeOne()
    {
        await _repository.SaveAsync(new TenantEntity { Id = "t1", OwnerUserId = "u", Version = 1 });
        await CleanedAsync("t1", "a", renditions: true);
        _storage.FailCopyTo = _ => true;

        var exit = await PublishItemImagesCommand.RunAsync(_repository, _storage, _thumbnailer, Publisher(), _time,
            OpsArguments.Parse(["publish-item-images", "--stage", "dev"]).Arguments!, new OpsOutput(_dir), default);

        Assert.Equal(1, exit);
        Assert.Null((await GetAsync("t1", "a"))!.PublicImageKey);
    }

    [Theory]
    [InlineData("prod")]
    [InlineData("dev")]
    public void Arguments_AllowedOnEveryStage_WithDryRunAndCheckpoint(string stage)
    {
        var (parsed, error) = OpsArguments.Parse(["publish-item-images", "--stage", stage, "--dry-run", "--after-tenant", "01JTENANT0000000000000000A"]);

        Assert.Null(error);
        Assert.True(parsed!.DryRun);
        Assert.Equal("01JTENANT0000000000000000A", parsed.Option("after-tenant"));
        Assert.NotNull(OpsArguments.Parse(["publish-item-images", "--stage", stage, "--after-tenant", "../x"]).Error);
    }
}
