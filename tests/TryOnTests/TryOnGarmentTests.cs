using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Tests.Shared;
using TryOn.Services;

namespace TryOnTests;

public class TryOnGarmentTests
{
    private const string Tenant = "01JTENANT0000000000000000A";
    private const string Other = "01JTENANT0000000000000000B";

    private sealed class CapturingRenderer : ITryOnRenderer
    {
        public List<IReadOnlyList<ImageInput>> Garments { get; } = [];

        public Task<ImageInput> RenderAsync(ImageInput bodyPhoto, IReadOnlyList<ImageInput> garments, CancellationToken ct, string? quality = null)
        {
            Garments.Add(garments);
            return Task.FromResult(new ImageInput([7, 7, 7], "image/webp"));
        }

        public Task<ImageInput> RenderFromFaceAsync(ImageInput facePhoto, IReadOnlyList<ImageInput> garments, TryOnFigure figure, CancellationToken ct, string? quality = null) =>
            RenderAsync(facePhoto, garments, ct);
    }

    /// <summary>Global images (library / catalog): only https://catalog.test/… is "downloadable".</summary>
    private sealed class FakeGlobalImages : ICatalogProductLookup
    {
        public List<string?> Requested { get; } = [];

        public Task<ProductSnapshot?> GetAsync(string productId, CancellationToken ct) => Task.FromResult<ProductSnapshot?>(null);

        public Task<ImageInput?> ReadImageAsync(ProductSnapshot product, CancellationToken ct)
        {
            Requested.Add(product.ImageKey);
            return Task.FromResult(product.ImageKey?.StartsWith("https://catalog.test/", StringComparison.Ordinal) == true
                ? new ImageInput([5], "image/webp")
                : null);
        }
    }

    private static readonly FakeGlobalImages GlobalImages = new();

    private static async Task<(WorkerTestHost Host, CapturingRenderer Renderer, JobEntity Job, TryOnRequestedEvent Message)> ArrangeAsync(params OutfitPiece[] pieces)
    {
        var renderer = new CapturingRenderer();
        var host = new WorkerTestHost(services =>
        {
            services.AddSingleton<ITryOnJobService, TryOnJobService>();
            services.RemoveAll<ITryOnRenderer>();
            services.AddSingleton<ITryOnRenderer>(renderer);
            services.RemoveAll<ICatalogProductLookup>();
            services.AddSingleton<ICatalogProductLookup>(GlobalImages);
        });
        await host.MakePremiumAsync(Tenant);
        var body = await host.AddPhotoAsync(Tenant, PhotoKind.Body);
        var target = new TryOnTarget(TryOnTargetKind.Look, TryOnFingerprint.Of(pieces), 0);
        var key = CreditLedger.TryOnIdempotencyKey(body.Id, target.Kind, target.Id, target.Version);
        var job = await host.QueueJobAsync(Tenant, JobKind.TryOn, key);
        job.Input = StylingJson.Serialize(new TryOnJobInput(pieces));
        await host.Repository.SaveAsync(job);
        await host.Get<ICreditService>().ReserveAsync(Tenant, key, job.Id, default);
        return (host, renderer, job, new TryOnRequestedEvent(Tenant, job.Id, target, body.Id, key));
    }

    private static async Task AddItemAsync(WorkerTestHost host, string tenant, string id, byte marker)
    {
        var key = StorageKeys.ItemImage(tenant, id);
        await host.Storage.PutAsync(key, [marker], "image/webp", default);
        await host.Repository.SaveAsync(new ItemEntity { Id = id, TenantId = tenant, Category = ItemCategory.Top, ImageKey = key, Version = 1 });
    }

    [Fact]
    public async Task Process_SendsTheImagesOfTheOutfitsOwnPieces_AndCommitsTheCredit()
    {
        var (host, renderer, job, message) = await ArrangeAsync(new OutfitPiece("item1", null), new OutfitPiece("item2", null));
        await AddItemAsync(host, Tenant, "item1", 1);
        await AddItemAsync(host, Tenant, "item2", 2);

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        Assert.Equal([[1], [2]], Assert.Single(renderer.Garments).Select(g => g.Data));
        Assert.Equal(29, await host.RemainingCreditsAsync(Tenant));
    }

    [Fact]
    public async Task Process_PieceDeletedMeanwhile_SourceDeleted_Refunds_NothingRendered()
    {
        var (host, renderer, job, message) = await ArrangeAsync(new OutfitPiece("item1", null), new OutfitPiece("gone", null));
        await AddItemAsync(host, Tenant, "item1", 1);

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.SourceDeleted, (await host.JobAsync(job))!.Failure);
        Assert.Empty(renderer.Garments);
        Assert.Equal(30, await host.RemainingCreditsAsync(Tenant));
    }

    [Fact]
    public async Task Process_AnotherTenantsItemId_IsNeverRead()
    {
        var (host, renderer, job, message) = await ArrangeAsync(new OutfitPiece("theirs", null));
        await AddItemAsync(host, Other, "theirs", 9);

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.SourceDeleted, (await host.JobAsync(job))!.Failure);
        Assert.Empty(renderer.Garments);
    }

    [Fact]
    public async Task Process_CatalogProductWithoutReadableImage_SourceDeleted_Refunds()
    {
        var (host, _, job, message) = await ArrangeAsync(new OutfitPiece(null, "prd1"));

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.SourceDeleted, (await host.JobAsync(job))!.Failure);
        Assert.Equal(30, await host.RemainingCreditsAsync(Tenant));
    }

    [Fact]
    public async Task Process_LibraryPieceWithoutOwnPhoto_UsesItsGlobalHttpsImage()
    {
        var (host, renderer, job, message) = await ArrangeAsync(new OutfitPiece("own", null), new OutfitPiece("lib", null));
        await AddItemAsync(host, Tenant, "own", 1);
        await host.Repository.SaveAsync(new ItemEntity
        {
            Id = "lib", TenantId = Tenant, Category = ItemCategory.Bottom, Source = ItemSource.Library, LibraryItemId = "lib-blue-jeans",
            GlobalImageKey = "https://catalog.test/catalog/library/lib-blue-jeans.webp", Version = 1,
        });

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        Assert.Equal([[1], [5]], Assert.Single(renderer.Garments).Select(g => g.Data));
        Assert.Contains("https://catalog.test/catalog/library/lib-blue-jeans.webp", GlobalImages.Requested);
    }

    [Fact]
    public async Task Process_LibraryPieceWithOnlyAPlaceholderKey_SourceDeleted_Refunds()
    {
        var (host, renderer, job, message) = await ArrangeAsync(new OutfitPiece("lib", null));
        await host.Repository.SaveAsync(new ItemEntity
        {
            Id = "lib", TenantId = Tenant, Category = ItemCategory.Top, Source = ItemSource.Library, GlobalImageKey = "library/white-tshirt.webp", Version = 1,
        });

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.SourceDeleted, (await host.JobAsync(job))!.Failure);
        Assert.Empty(renderer.Garments);
        Assert.Equal(30, await host.RemainingCreditsAsync(Tenant));
    }

    [Fact]
    public async Task Process_LibraryPieceWithPlaceholderKey_UsesTheLibraryItemsCurrentImage()
    {
        var (host, renderer, job, message) = await ArrangeAsync(new OutfitPiece("lib", null));
        await host.Repository.SaveAsync(new LibraryItemEntity
        {
            Id = "lib-white-tshirt", Category = ItemCategory.Top, ImageKey = "https://catalog.test/catalog/library/lib-white-tshirt.webp?v=1",
        });
        await host.Repository.SaveAsync(new ItemEntity
        {
            Id = "lib", TenantId = Tenant, Category = ItemCategory.Top, Source = ItemSource.Library, LibraryItemId = "lib-white-tshirt",
            GlobalImageKey = "library/white-tshirt.webp", Version = 1,
        });

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        Assert.Equal([[5]], Assert.Single(renderer.Garments).Select(g => g.Data));
        Assert.Contains("https://catalog.test/catalog/library/lib-white-tshirt.webp?v=1", GlobalImages.Requested);
        // The worker never rewrites the user's piece (the ops migration does).
        var stored = await host.Repository.GetAsync<ItemEntity>(ItemEntity.GetPk(Tenant), ItemEntity.GetSk("lib"));
        Assert.Equal("library/white-tshirt.webp", stored!.GlobalImageKey);
    }

    [Fact]
    public async Task Process_LibraryPieceWhoseLibraryItemHasNoImageYet_SourceDeleted_Refunds()
    {
        var (host, renderer, job, message) = await ArrangeAsync(new OutfitPiece("lib", null));
        await host.Repository.SaveAsync(new LibraryItemEntity { Id = "lib-black-tshirt", Category = ItemCategory.Top, ImageKey = "library/black-tshirt.webp" });
        await host.Repository.SaveAsync(new ItemEntity
        {
            Id = "lib", TenantId = Tenant, Category = ItemCategory.Top, Source = ItemSource.Library, LibraryItemId = "lib-black-tshirt",
            GlobalImageKey = "library/black-tshirt.webp", Version = 1,
        });

        await host.Get<ITryOnJobService>().ProcessAsync(message, false, default);

        Assert.Equal(JobFailure.SourceDeleted, (await host.JobAsync(job))!.Failure);
        Assert.Empty(renderer.Garments);
        Assert.Equal(30, await host.RemainingCreditsAsync(Tenant));
    }
}
