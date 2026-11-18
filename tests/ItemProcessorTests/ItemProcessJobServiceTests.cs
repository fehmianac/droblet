using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Services;
using Domain.Services.Ai;
using ItemProcessor.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Tests.Shared;

namespace ItemProcessorTests;

public class ItemProcessJobServiceTests
{
    private const string Tenant = "01JTENANT0000000000000000A";
    private const string DraftId = "01JDRAFT00000000000000000A";

    private static readonly Dictionary<string, double> Sure = new() { ["category"] = 0.95, ["colorIds"] = 0.9, ["fabric"] = 0.9, ["seasons"] = 0.9 };

    private sealed class FakeAi(GarmentSuggestion? suggestion = null, IReadOnlyList<GarmentSuggestion>? pieces = null) : IImageCleanup, IGarmentVision, IOutfitSplitter
    {
        public List<string> Languages { get; } = [];

        public Task<ImageInput> CleanupAsync(ImageInput garmentPhoto, CancellationToken ct) => Task.FromResult(new ImageInput([1, 2, 3], "image/webp"));

        public Task<GarmentSuggestion> DescribeAsync(ImageInput garmentImage, string language, CancellationToken ct)
        {
            Languages.Add(language);
            return Task.FromResult(suggestion!);
        }

        public Task<IReadOnlyList<GarmentSuggestion>> DetectPiecesAsync(ImageInput outfitPhoto, string language, CancellationToken ct)
        {
            Languages.Add(language);
            return Task.FromResult(pieces ?? []);
        }

        public Task<ImageInput> ExtractPieceAsync(ImageInput outfitPhoto, GarmentSuggestion piece, CancellationToken ct) =>
            Task.FromResult(new ImageInput([9, 9], "image/webp"));
    }

    private static WorkerTestHost Host(FakeAi? ai = null) => new(services =>
    {
        services.AddSingleton<IItemProcessJobService, ItemProcessJobService>();
        if (ai is null)
            return;
        services.RemoveAll<IImageCleanup>();
        services.RemoveAll<IGarmentVision>();
        services.RemoveAll<IOutfitSplitter>();
        services.AddSingleton<IImageCleanup>(ai);
        services.AddSingleton<IGarmentVision>(ai);
        services.AddSingleton<IOutfitSplitter>(ai);
    });

    private static async Task<(JobEntity Job, ItemDraftEntity Draft)> ArrangeAsync(WorkerTestHost host, bool upload = true, bool split = false, string? language = "tr")
    {
        var job = await host.QueueJobAsync(Tenant, split ? JobKind.ItemSplit : JobKind.ItemProcess);
        var draft = new ItemDraftEntity
        {
            Id = DraftId, TenantId = Tenant, Kind = split ? ItemDraftKind.Outfit : ItemDraftKind.Single, Status = ItemDraftStatus.Uploaded,
            JobId = job.Id, Language = language, CreatedAt = WorkerTestHost.Now, UpdatedAt = WorkerTestHost.Now,
        };
        await host.Repository.SaveAsync(draft);
        if (upload)
            await host.Storage.PutAsync(StorageKeys.Upload(Tenant, DraftId), TestImages.JpegWithExif(), "image/jpeg", default);
        return (job, draft);
    }

    private static Task<ItemDraftEntity?> DraftAsync(WorkerTestHost host, string id = DraftId) =>
        host.Repository.GetAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(Tenant), ItemDraftEntity.GetSk(id));

    [Fact]
    public async Task Process_WhenOriginalMissing_SourceDeleted_DraftFailed()
    {
        var host = Host();
        var (job, _) = await ArrangeAsync(host, upload: false);

        await host.Get<IItemProcessJobService>().ProcessAsync(new ItemProcessRequestedEvent(Tenant, job.Id, DraftId), false, default);

        Assert.Equal(JobFailure.SourceDeleted, (await host.JobAsync(job))!.Failure);
        Assert.Equal(ItemDraftStatus.Failed, (await DraftAsync(host))!.Status);
    }

    [Fact]
    public async Task Process_WhenProviderNotConfigured_ProviderError_KeepsOnlyTheStrippedOriginalForManualFill()
    {
        var host = Host();
        var (job, _) = await ArrangeAsync(host);

        await host.Get<IItemProcessJobService>().ProcessAsync(new ItemProcessRequestedEvent(Tenant, job.Id, DraftId), false, default);

        Assert.Equal(JobFailure.ProviderError, (await host.JobAsync(job))!.Failure);
        var draft = await DraftAsync(host);
        Assert.Equal(ItemDraftStatus.Failed, draft!.Status);
        Assert.Null(draft.ProcessedKey);
        Assert.Null(draft.Category);

        var itemKeys = host.Storage.Objects.Keys.Where(k => k.StartsWith(StorageKeys.ItemsPrefix(Tenant), StringComparison.Ordinal)).ToList();
        Assert.Equal([draft.OriginalKey!], itemKeys);
        Assert.False(TestImages.Contains(host.Storage.Objects[draft.OriginalKey!].Data, TestImages.ExifGps)); // EXIF never reaches the tenant prefix
        Assert.Empty(await host.Repository.GetKeysAsync(ItemEntity.GetPk(Tenant)));
    }

    [Fact]
    public async Task Process_WhenJobAlreadyFinished_DoesNothing()
    {
        var host = Host();
        var job = await host.QueueJobAsync(Tenant, JobKind.ItemProcess);
        job.Status = JobStatus.Completed;
        await host.Repository.SaveAsync(job);

        await host.Get<IItemProcessJobService>().ProcessAsync(new ItemProcessRequestedEvent(Tenant, job.Id, DraftId), false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
    }

    [Fact]
    public async Task Process_ConfidentSuggestion_DraftReadyWithSuggestions_ButNoItemIsWritten()
    {
        var ai = new FakeAi(new GarmentSuggestion(ItemCategoryHint.Outerwear, ["navy"], "wool", [Season.Autumn, Season.Winter], Sure, "Navy blazer"));
        var host = Host(ai);
        var (job, _) = await ArrangeAsync(host, language: "en");

        await host.Get<IItemProcessJobService>().ProcessAsync(new ItemProcessRequestedEvent(Tenant, job.Id, DraftId), false, default);

        var draft = await DraftAsync(host);
        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        Assert.Equal(ItemDraftStatus.Ready, draft!.Status);
        Assert.Equal(ItemCategory.Outerwear, draft.Category);
        Assert.Equal(["navy"], draft.ColorIds);
        Assert.Equal("wool", draft.Fabric);
        Assert.False(draft.NeedsReview);
        Assert.Equal("Navy blazer", draft.Name);
        Assert.Equal("en", draft.Language);                 // the language the name was written in is stored with it
        Assert.Equal(["en"], ai.Languages);                 // and was passed to the prompt
        Assert.StartsWith($"tenant/{Tenant}/items/", draft.ProcessedKey);
        Assert.True(host.Storage.Objects.ContainsKey(draft.ProcessedKey!));
        Assert.Empty(await host.Repository.GetKeysAsync(ItemEntity.GetPk(Tenant))); // drafts become items only on confirm
    }

    [Fact]
    public async Task Process_LowConfidenceCategory_DraftNeedsReview()
    {
        var unsure = new Dictionary<string, double>(Sure) { ["category"] = 0.3 };
        var host = Host(new FakeAi(new GarmentSuggestion(ItemCategoryHint.Top, ["white", "unicorn"], "kevlar", [Season.Summer], unsure)));
        var (job, _) = await ArrangeAsync(host);

        await host.Get<IItemProcessJobService>().ProcessAsync(new ItemProcessRequestedEvent(Tenant, job.Id, DraftId), false, default);

        var draft = await DraftAsync(host);
        Assert.True(draft!.NeedsReview);
        Assert.Equal(["white"], draft.ColorIds);
        Assert.Null(draft.Fabric);
        Assert.Equal(["category", "colorIds", "fabric"], draft.FlaggedFields);
    }

    [Fact]
    public async Task Process_NoGarmentInPhoto_GuardRejected_DraftFailed()
    {
        var host = Host(new FakeAi(new GarmentSuggestion(null, [], null, [], new Dictionary<string, double>(), null, IsGarment: false, GarmentCount: 0)));
        var (job, _) = await ArrangeAsync(host);

        await host.Get<IItemProcessJobService>().ProcessAsync(new ItemProcessRequestedEvent(Tenant, job.Id, DraftId), false, default);

        Assert.Equal(JobFailure.GuardRejected, (await host.JobAsync(job))!.Failure);
        Assert.Equal(ItemDraftStatus.Failed, (await DraftAsync(host))!.Status);
    }

    [Fact]
    public async Task Process_SplitOutfit_CreatesOneReadyDraftPerPiece_AndConsumesTheSource()
    {
        var pieces = new[]
        {
            new GarmentSuggestion(ItemCategoryHint.Top, ["white"], "cotton", [Season.Spring], Sure, "Beyaz gömlek"),
            new GarmentSuggestion(ItemCategoryHint.Shoes, ["black"], null, [Season.Autumn], new Dictionary<string, double>(Sure) { ["category"] = 0.2 }),
        };
        var host = Host(new FakeAi(pieces: pieces));
        var (job, _) = await ArrangeAsync(host, split: true);

        await host.Get<IItemProcessJobService>().ProcessAsync(new ItemProcessRequestedEvent(Tenant, job.Id, DraftId, Split: true), false, default);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        var drafts = await host.Repository.GetAllAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(Tenant));
        var source = drafts.Single(d => d.Kind == ItemDraftKind.Outfit);
        var cut = drafts.Where(d => d.Kind == ItemDraftKind.Piece).OrderBy(d => d.Category).ToList();
        Assert.Equal(ItemDraftStatus.Ready, source.Status);
        Assert.Equal([ItemCategory.Top, ItemCategory.Shoes], cut.Select(d => d.Category!.Value));
        Assert.All(cut, d => Assert.Equal(DraftId, d.ParentDraftId));
        Assert.All(cut, d => Assert.True(host.Storage.Objects.ContainsKey(d.ProcessedKey!)));
        Assert.False(cut[0].NeedsReview);
        Assert.True(cut[1].NeedsReview);
        Assert.Empty(await host.Repository.GetKeysAsync(ItemEntity.GetPk(Tenant)));
    }

    [Fact]
    public async Task Process_SplitOutfit_NoPieces_GuardRejected()
    {
        var host = Host(new FakeAi(pieces: []));
        var (job, _) = await ArrangeAsync(host, split: true);

        await host.Get<IItemProcessJobService>().ProcessAsync(new ItemProcessRequestedEvent(Tenant, job.Id, DraftId, Split: true), false, default);

        Assert.Equal(JobFailure.GuardRejected, (await host.JobAsync(job))!.Failure);
    }

    [Fact]
    public void SplitEvent_IsAnItemSplitJob_OnTheItemProcessorQueue()
    {
        var queues = new Domain.Options.QueueOptions { ItemProcessRequest = "item-queue", StylistRequest = "stylist-queue" };

        Assert.Equal(JobKind.ItemSplit, new ItemProcessRequestedEvent(Tenant, "j", "d", Split: true).Kind);
        Assert.Equal(JobKind.ItemProcess, new ItemProcessRequestedEvent(Tenant, "j", "d").Kind);
        Assert.Equal("item-queue", queues.UrlFor(JobKind.ItemSplit));
    }
}
