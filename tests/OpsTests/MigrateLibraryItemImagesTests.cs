using Domain.Entity;
using Domain.Enum;
using Microsoft.Extensions.Time.Testing;
using Ops;
using Ops.Commands;
using Tests.Shared;

namespace OpsTests;

public class MigrateLibraryItemImagesTests : IDisposable
{
    private const string Image = "https://catalog.test/catalog/library/lib-white-tshirt.webp?v=20261119";
    private readonly string _dir = Directory.CreateTempSubdirectory("ops-migrate-test-").FullName;
    private readonly InMemoryRepository _repository = new();
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 11, 19, 9, 0, 0, TimeSpan.Zero));

    public void Dispose()
    {
        Directory.Delete(_dir, recursive: true);
        GC.SuppressFinalize(this);
    }

    private OpsOutput Output() => new(_dir);

    private async Task ArrangeAsync()
    {
        await _repository.SaveAsync(new LibraryItemEntity { Id = "lib-white-tshirt", Category = ItemCategory.Top, ImageKey = Image });
        await _repository.SaveAsync(new LibraryItemEntity { Id = "lib-black-tshirt", Category = ItemCategory.Top, ImageKey = "library/black-tshirt.webp" });
        foreach (var tenant in new[] { "t1", "t2" })
            await _repository.SaveAsync(new TenantEntity { Id = tenant, OwnerUserId = "u-" + tenant, Version = 1 });

        // t1: a stale library piece, a piece of a library item without image, an own photo piece.
        await _repository.SaveAsync(Item("t1", "a", "lib-white-tshirt", "library/white-tshirt.webp"));
        await _repository.SaveAsync(Item("t1", "b", "lib-black-tshirt", "library/black-tshirt.webp"));
        await _repository.SaveAsync(new ItemEntity { Id = "c", TenantId = "t1", Category = ItemCategory.Top, Source = ItemSource.Photo, ImageKey = "tenant/t1/items/c.webp", Version = 2 });
        // t2: already correct, and one with no key at all.
        await _repository.SaveAsync(Item("t2", "d", "lib-white-tshirt", Image));
        await _repository.SaveAsync(Item("t2", "e", "lib-white-tshirt", null));
    }

    private static ItemEntity Item(string tenant, string id, string libraryId, string? key) => new()
    {
        Id = id, TenantId = tenant, Category = ItemCategory.Top, Source = ItemSource.Library, LibraryItemId = libraryId,
        GlobalImageKey = key, Version = 3, UpdatedAt = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    private Task<ItemEntity?> GetAsync(string tenant, string id) => _repository.GetAsync<ItemEntity>(ItemEntity.GetPk(tenant), ItemEntity.GetSk(id));

    [Fact]
    public async Task Migrate_RewritesStalePieces_BumpsVersion_LeavesOthersAlone()
    {
        await ArrangeAsync();

        var result = await MigrateLibraryItemImagesCommand.MigrateAsync(_repository, _time, dryRun: false, Output(), default);

        Assert.Equal(new MigrateLibraryItemImagesCommand.Result(Tenants: 2, Items: 4, Updated: 2, AlreadyCorrect: 1, NoImageYet: 1, Conflicts: 0), result);
        var a = await GetAsync("t1", "a");
        Assert.Equal(Image, a!.GlobalImageKey);
        Assert.Equal(4, a.Version);
        Assert.Equal(_time.GetUtcNow().UtcDateTime, a.UpdatedAt);
        Assert.Equal(Image, (await GetAsync("t2", "e"))!.GlobalImageKey);
        Assert.Equal("library/black-tshirt.webp", (await GetAsync("t1", "b"))!.GlobalImageKey);
        Assert.Equal(3, (await GetAsync("t2", "d"))!.Version);
        Assert.Equal(2, (await GetAsync("t1", "c"))!.Version);
    }

    [Fact]
    public async Task Migrate_SecondRun_ChangesNothing()
    {
        await ArrangeAsync();
        await MigrateLibraryItemImagesCommand.MigrateAsync(_repository, _time, dryRun: false, Output(), default);
        var versions = new[] { ("t1", "a"), ("t1", "b"), ("t1", "c"), ("t2", "d"), ("t2", "e") }
            .Select(k => GetAsync(k.Item1, k.Item2).Result!.Version).ToList();

        _time.Advance(TimeSpan.FromHours(1));
        var second = await MigrateLibraryItemImagesCommand.MigrateAsync(_repository, _time, dryRun: false, Output(), default);

        Assert.Equal(0, second.Updated);
        Assert.Equal(3, second.AlreadyCorrect);
        Assert.Equal(versions, new[] { ("t1", "a"), ("t1", "b"), ("t1", "c"), ("t2", "d"), ("t2", "e") }
            .Select(k => GetAsync(k.Item1, k.Item2).Result!.Version).ToList());
    }

    [Fact]
    public async Task Migrate_DryRun_WritesNothing()
    {
        await ArrangeAsync();

        var result = await MigrateLibraryItemImagesCommand.MigrateAsync(_repository, _time, dryRun: true, Output(), default);

        Assert.Equal(2, result.Updated);
        Assert.Equal("library/white-tshirt.webp", (await GetAsync("t1", "a"))!.GlobalImageKey);
        Assert.Equal(3, (await GetAsync("t1", "a"))!.Version);
    }

    [Theory]
    [InlineData("dev")]
    [InlineData("prod")]
    public void Arguments_AcceptTheCommandWithDryRun(string stage)
    {
        var (args, error) = OpsArguments.Parse(["migrate-library-item-images", "--stage", stage, "--dry-run"]);

        Assert.Null(error);
        Assert.True(args!.DryRun);
    }
}
