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
    private static readonly PixelSize PhotoSize = new(1000, 1500);

    private static readonly Dictionary<string, double> Sure = new() { ["category"] = 0.95, ["colorIds"] = 0.9, ["fabric"] = 0.9, ["seasons"] = 0.9 };

    private static DetectedItem Item(ItemCategoryHint category, string color, BoundingBox box, string? subcategory = null, double confidence = 0.9,
        string? name = "Parça", bool wearable = true, Dictionary<string, double>? fields = null, string? fabric = "cotton") =>
        new(new GarmentSuggestion(category, [color], fabric, [Season.Spring, Season.Summer], fields ?? Sure, name), box, subcategory, confidence, wearable);

    /// <summary>The 5-piece synthetic flat-lay of the ops smoke test: top, trousers, shoes, bag and a necklace.</summary>
    private static readonly DetectedItem[] FlatLay =
    [
        Item(ItemCategoryHint.Top, "white", new BoundingBox(0.05, 0.05, 0.45, 0.35), "t-shirt", name: "Beyaz tişört"),
        Item(ItemCategoryHint.Bottom, "navy", new BoundingBox(0.1, 0.45, 0.35, 0.5), "jeans", name: "Lacivert jean"),
        Item(ItemCategoryHint.Shoes, "white", new BoundingBox(0.55, 0.75, 0.35, 0.18), "sneakers", name: "Beyaz spor ayakkabı"),
        Item(ItemCategoryHint.Bag, "black", new BoundingBox(0.6, 0.4, 0.3, 0.25), "tote", name: "Siyah çanta", fabric: "leather"),
        Item(ItemCategoryHint.Accessory, "beige", new BoundingBox(0.62, 0.08, 0.1, 0.08), "necklace", confidence: 0.55, name: "Altın kolye", fabric: null),
    ];

    private sealed class FakeAi(IReadOnlyList<DetectedItem>? items = null) : IItemDetector, IItemImageCleanup
    {
        public List<string> Languages { get; } = [];
        /// <summary>Image-model calls (background removal) — the cost the selection step saves.</summary>
        public List<(ImageInput Input, ItemCategoryHint? Category, string? Subcategory)> Cleanups { get; } = [];
        public Func<Task>? DuringDetect { get; set; }
        public Func<Task>? DuringCleanup { get; set; }

        public async Task<IReadOnlyList<DetectedItem>> DetectItemsAsync(ImageInput photo, string language, CancellationToken ct)
        {
            Languages.Add(language);
            if (DuringDetect is not null)
                await DuringDetect();
            return items ?? [];
        }

        public async Task<ImageInput> CleanupItemAsync(ImageInput crop, ItemCategoryHint? category, string? subcategory, CancellationToken ct)
        {
            Cleanups.Add((crop, category, subcategory));
            if (DuringCleanup is not null)
                await DuringCleanup();
            return new ImageInput([1, 2, 3], "image/webp");
        }
    }

    /// <summary>Records every crop; returns a small fake JPEG whose bytes name the plan.</summary>
    private sealed class FakeCropper : IImageCropper
    {
        public List<CropPlan> Plans { get; } = [];
        public PixelSize? Measure(ImageInput photo) => PhotoSize;

        public ImageInput? Crop(ImageInput photo, CropPlan plan)
        {
            Plans.Add(plan);
            return new ImageInput([0xFF, 0xD8, 0xFF, (byte)Plans.Count], "image/jpeg");
        }
    }

    private static WorkerTestHost Host(FakeAi? ai = null, FakeCropper? cropper = null) => new(services =>
    {
        services.AddSingleton<IItemProcessJobService, ItemProcessJobService>();
        services.AddSingleton<IImageCropper>(cropper ?? new FakeCropper());
        if (ai is null)
            return;
        services.RemoveAll<IItemDetector>();
        services.RemoveAll<IItemImageCleanup>();
        services.AddSingleton<IItemDetector>(ai);
        services.AddSingleton<IItemImageCleanup>(ai);
    });

    private static async Task<(JobEntity Job, ItemDraftEntity Draft)> ArrangeAsync(WorkerTestHost host, bool upload = true, string? language = "tr")
    {
        var job = await host.QueueJobAsync(Tenant, JobKind.ItemProcess);
        var draft = new ItemDraftEntity
        {
            Id = DraftId, TenantId = Tenant, Kind = ItemDraftKind.Single, Status = ItemDraftStatus.Uploaded,
            JobId = job.Id, Language = language, CreatedAt = WorkerTestHost.Now, UpdatedAt = WorkerTestHost.Now,
        };
        await host.Repository.SaveAsync(draft);
        if (upload)
            await host.Storage.PutAsync(StorageKeys.Upload(Tenant, DraftId), TestImages.JpegWithExif(), "image/jpeg", default);
        return (job, draft);
    }

    private static Task<ItemDraftEntity?> DraftAsync(WorkerTestHost host, string id = DraftId) =>
        host.Repository.GetAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(Tenant), ItemDraftEntity.GetSk(id));

    private static async Task<List<ItemDraftEntity>> PiecesAsync(WorkerTestHost host) =>
        (await host.Repository.GetAllAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(Tenant))).Where(d => d.Kind == ItemDraftKind.Piece).OrderBy(d => d.Index).ToList();

    private static Task ProcessAsync(WorkerTestHost host, JobEntity job, string draftId = DraftId, bool clean = false, bool lastAttempt = false) =>
        host.Get<IItemProcessJobService>().ProcessAsync(new ItemProcessRequestedEvent(Tenant, job.Id, draftId, Clean: clean), lastAttempt, default);

    // ── Basics ───────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Process_WhenOriginalMissing_SourceDeleted_DraftFailed()
    {
        var host = Host();
        var (job, _) = await ArrangeAsync(host, upload: false);

        await ProcessAsync(host, job);

        Assert.Equal(JobFailure.SourceDeleted, (await host.JobAsync(job))!.Failure);
        Assert.Equal(ItemDraftStatus.Failed, (await DraftAsync(host))!.Status);
    }

    [Fact]
    public async Task Process_WhenProviderNotConfigured_ProviderError_KeepsOnlyTheStrippedOriginalForManualFill()
    {
        var host = Host();
        var (job, _) = await ArrangeAsync(host);

        await ProcessAsync(host, job);

        Assert.Equal(JobFailure.ProviderError, (await host.JobAsync(job))!.Failure);
        var draft = await DraftAsync(host);
        Assert.Equal((ItemDraftStatus.Failed, JobFailure.ProviderError), (draft!.Status, draft.Failure));
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

        await ProcessAsync(host, job);

        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
    }

    // ── One piece found: the single-item behaviour (straight to the review form) ──────────────────────────────

    [Fact]
    public async Task Process_OnePieceFillingThePhoto_ReadySingleDraft_CleanedFromTheWholePhoto_NoItemWritten()
    {
        var ai = new FakeAi([Item(ItemCategoryHint.Outerwear, "navy", new BoundingBox(0.05, 0.05, 0.9, 0.9), "blazer", name: "Navy blazer", fabric: "wool")]);
        var cropper = new FakeCropper();
        var host = Host(ai, cropper);
        var (job, _) = await ArrangeAsync(host, language: "en");

        await ProcessAsync(host, job);

        var draft = await DraftAsync(host);
        Assert.Equal(JobStatus.Completed, (await host.JobAsync(job))!.Status);
        Assert.Equal((ItemDraftKind.Single, ItemDraftStatus.Ready, 1), (draft!.Kind, draft.Status, draft.ItemCount));
        Assert.Equal(ItemCategory.Outerwear, draft.Category);
        Assert.Equal("blazer", draft.Subcategory);
        Assert.Equal(["navy"], draft.ColorIds);
        Assert.Equal("wool", draft.Fabric);
        Assert.False(draft.NeedsReview);
        Assert.Equal("Navy blazer", draft.Name);
        Assert.Equal("en", draft.Language);                 // the language the name was written in is stored with it
        Assert.Equal(["en"], ai.Languages);                 // and was passed to the prompt
        Assert.Equal(new BoundingBox(0.05, 0.05, 0.9, 0.9), draft.Box);
        Assert.Equal((1000, 1500), (draft.PhotoWidth!.Value, draft.PhotoHeight!.Value));
        Assert.Single(ai.Cleanups);                         // one image-model call
        Assert.Empty(cropper.Plans);                        // the piece fills the photo: no crop
        Assert.StartsWith($"tenant/{Tenant}/items/", draft.ProcessedKey);
        Assert.True(host.Storage.Objects.ContainsKey(draft.ProcessedKey!));
        Assert.Empty(await PiecesAsync(host));
        Assert.Empty(await host.Repository.GetKeysAsync(ItemEntity.GetPk(Tenant))); // drafts become items only on confirm
    }

    [Fact]
    public async Task Process_OneRingInABigPhoto_IsCroppedWideAndUpscaled_BeforeTheBackgroundIsRemoved()
    {
        var ai = new FakeAi([Item(ItemCategoryHint.Accessory, "beige", new BoundingBox(0.45, 0.45, 0.05, 0.04), "ring", fabric: null)]);
        var cropper = new FakeCropper();
        var host = Host(ai, cropper);
        var (job, _) = await ArrangeAsync(host);

        await ProcessAsync(host, job);

        var plan = Assert.Single(cropper.Plans);
        Assert.True(plan.Width > 0.05 * PhotoSize.Width * 1.5);     // padded well beyond the box
        Assert.True(Math.Max(plan.OutputWidth, plan.OutputHeight) >= CropMath.SmallMinOutput || plan.OutputWidth >= plan.Width * CropMath.MaxUpscale - 1);
        var cleanup = Assert.Single(ai.Cleanups);
        Assert.Equal("ring", cleanup.Subcategory);
        Assert.Equal(0xFF, cleanup.Input.Data[0]);                  // the crop, not the photo, went to the image model
        Assert.Equal("ring", (await DraftAsync(host))!.Subcategory);
    }

    [Fact]
    public async Task Process_LowConfidenceCategory_DraftNeedsReview()
    {
        var unsure = new Dictionary<string, double>(Sure) { ["category"] = 0.3 };
        var host = Host(new FakeAi([Item(ItemCategoryHint.Top, "white", new BoundingBox(0, 0, 1, 1), fields: unsure, fabric: "kevlar")]));
        var (job, _) = await ArrangeAsync(host);

        await ProcessAsync(host, job);

        var draft = await DraftAsync(host);
        Assert.True(draft!.NeedsReview);
        Assert.Null(draft.Fabric);
        Assert.Equal(["category", "fabric"], draft.FlaggedFields);
    }

    [Fact]
    public async Task Process_NothingWearableInPhoto_GuardRejected_DraftFailedAsEmpty_NoImageCall()
    {
        var ai = new FakeAi([Item(ItemCategoryHint.Top, "white", new BoundingBox(0.2, 0.1, 0.5, 0.6), wearable: false)]); // a person, not a piece
        var host = Host(ai);
        var (job, _) = await ArrangeAsync(host);

        await ProcessAsync(host, job);

        Assert.Equal(JobFailure.GuardRejected, (await host.JobAsync(job))!.Failure);
        var draft = await DraftAsync(host);
        Assert.Equal((ItemDraftStatus.Failed, JobFailure.GuardRejected), (draft!.Status, draft.Failure));
        Assert.Empty(ai.Cleanups);
    }

    // ── Several pieces: a draft group, no image-model call before the user selects ─────────────────────────────

    [Fact]
    public async Task Process_FivePieceFlatLay_BecomesADraftGroup_WithOneDetectedDraftPerPiece_AndNoImageModelCall()
    {
        var ai = new FakeAi(FlatLay);
        var cropper = new FakeCropper();
        var host = Host(ai, cropper);
        var (job, _) = await ArrangeAsync(host);

        await ProcessAsync(host, job);

        var stored = await host.JobAsync(job);
        Assert.Equal(JobStatus.Completed, stored!.Status);
        Assert.Contains("\"itemCount\":5", stored.Result);
        var source = await DraftAsync(host);
        Assert.Equal((ItemDraftKind.Outfit, ItemDraftStatus.Ready, 5), (source!.Kind, source.Status, source.ItemCount));
        Assert.Null(source.ProcessedKey);

        var pieces = await PiecesAsync(host);
        Assert.Equal(5, pieces.Count);
        Assert.Empty(ai.Cleanups);                                   // unselected pieces cost nothing
        Assert.Equal(5, cropper.Plans.Count);
        Assert.All(pieces, p => Assert.Equal((ItemDraftStatus.Detected, DraftId), (p.Status, p.ParentDraftId)));
        Assert.All(pieces, p => Assert.True(host.Storage.Objects.ContainsKey(p.OriginalKey!)));   // the plain crop
        Assert.All(pieces, p => Assert.Null(p.ProcessedKey));
        Assert.All(pieces, p => Assert.NotNull(p.Box));
        Assert.Equal([1, 2, 3, 4, 5], pieces.Select(p => p.Index!.Value));
        // Reading order: top to bottom.
        Assert.Equal(["t-shirt", "necklace", "tote", "jeans", "sneakers"], pieces.Select(p => p.Subcategory));
        var necklace = pieces.Single(p => p.Subcategory == "necklace");
        Assert.Equal(ItemCategory.Accessory, necklace.Category);
        Assert.True(necklace.NeedsReview);                           // confidence 0.55 < 0.7: "Kontrol et"
        Assert.Contains("category", necklace.FlaggedFields);
        Assert.False(pieces.Single(p => p.Subcategory == "jeans").NeedsReview);
        Assert.Empty(await host.Repository.GetKeysAsync(ItemEntity.GetPk(Tenant)));
    }

    [Fact]
    public async Task Process_RecognitionAllowance_IsOnePerPhoto_NotPerPiece_AndCleanupsUseNone()
    {
        var host = Host(new FakeAi(FlatLay));
        var (job, _) = await ArrangeAsync(host);
        var quota = host.Get<IItemRecognitionQuotaService>();
        Assert.Equal(1, (await quota.ReserveAsync(Tenant, [job.Id], default)).Granted);

        await ProcessAsync(host, job);
        Assert.Equal(1, (await quota.GetAsync(Tenant, default)).Used);

        // The user keeps two pieces: two background removals, still one recognition.
        foreach (var piece in (await PiecesAsync(host)).Take(2))
        {
            var clean = await host.QueueJobAsync(Tenant, JobKind.ItemClean);
            piece.Selected = true;
            piece.Status = ItemDraftStatus.Processing;
            await host.Repository.SaveAsync(piece);
            await ProcessAsync(host, clean, piece.Id, clean: true);
            Assert.Equal(JobStatus.Completed, (await host.JobAsync(clean))!.Status);
        }
        Assert.Equal(1, (await quota.GetAsync(Tenant, default)).Used);
    }

    [Fact]
    public async Task Process_DuplicatesTinyBoxesAndBodyParts_AreDropped_AndTheListIsCapped()
    {
        var items = new List<DetectedItem>
        {
            Item(ItemCategoryHint.Top, "white", new BoundingBox(0.1, 0.1, 0.4, 0.4), confidence: 0.95),
            Item(ItemCategoryHint.Top, "white", new BoundingBox(0.12, 0.11, 0.4, 0.4), confidence: 0.8),   // the same top again
            Item(ItemCategoryHint.Accessory, "beige", new BoundingBox(0.5, 0.5, 0.005, 0.005)),           // a speck
            Item(ItemCategoryHint.Accessory, "beige", new BoundingBox(0.7, 0.7, 0.1, 0.1), wearable: false), // a hand
        };
        for (var i = 0; i < 20; i++)
            items.Add(Item(ItemCategoryHint.Accessory, "black", new BoundingBox(0.04 * i, 0.9, 0.035, 0.05), "ring", confidence: 0.5 + i * 0.01));
        var host = Host(new FakeAi(items));
        var (job, _) = await ArrangeAsync(host);

        await ProcessAsync(host, job);

        var pieces = await PiecesAsync(host);
        Assert.Equal(12, pieces.Count);                                         // Wardrobe:MaxDetectedItems
        Assert.Single(pieces, p => p.Category == ItemCategory.Top);
        Assert.DoesNotContain(pieces, p => p.Box!.Width < ItemDetectionGuard.MinSide);
    }

    [Fact]
    public async Task Clean_SelectedPiece_GetsItsBackgroundRemoved_FromItsCrop()
    {
        var ai = new FakeAi(FlatLay);
        var host = Host(ai);
        var (job, _) = await ArrangeAsync(host);
        await ProcessAsync(host, job);
        var necklace = (await PiecesAsync(host)).Single(p => p.Subcategory == "necklace");
        necklace.Selected = true;
        necklace.Status = ItemDraftStatus.Processing;
        await host.Repository.SaveAsync(necklace);
        var clean = await host.QueueJobAsync(Tenant, JobKind.ItemClean);

        await ProcessAsync(host, clean, necklace.Id, clean: true);

        var cleaned = await DraftAsync(host, necklace.Id);
        Assert.Equal(ItemDraftStatus.Ready, cleaned!.Status);
        Assert.True(host.Storage.Objects.ContainsKey(cleaned.ProcessedKey!));
        Assert.Equal(necklace.OriginalKey, cleaned.OriginalKey);
        var call = Assert.Single(ai.Cleanups);
        Assert.Equal((ItemCategoryHint.Accessory, "necklace"), (call.Category, call.Subcategory));
        Assert.Equal(host.Storage.Objects[necklace.OriginalKey!].Data, call.Input.Data);
    }

    [Fact]
    public async Task Clean_ProviderFails_PieceFailed_ButKeepsItsCropForAManualSave()
    {
        var ai = new FakeAi(FlatLay);
        var host = Host(ai);
        var (job, _) = await ArrangeAsync(host);
        await ProcessAsync(host, job);
        var piece = (await PiecesAsync(host))[0];
        piece.Selected = true;
        piece.Status = ItemDraftStatus.Processing;
        await host.Repository.SaveAsync(piece);
        ai.DuringCleanup = () => throw new AiProviderException("provider down");
        var clean = await host.QueueJobAsync(Tenant, JobKind.ItemClean);

        await ProcessAsync(host, clean, piece.Id, clean: true, lastAttempt: true);

        var failed = await DraftAsync(host, piece.Id);
        Assert.Equal((ItemDraftStatus.Failed, JobFailure.ProviderError), (failed!.Status, failed.Failure));
        Assert.True(host.Storage.Objects.ContainsKey(failed.OriginalKey!));
        Assert.Equal(JobFailure.ProviderError, (await host.JobAsync(clean))!.Failure);
    }

    [Fact]
    public void Events_CleanIsAnItemCleanJob_OnTheItemProcessorQueue()
    {
        var queues = new Domain.Options.QueueOptions { ItemProcessRequest = "item-queue", StylistRequest = "stylist-queue" };

        Assert.Equal(JobKind.ItemClean, new ItemProcessRequestedEvent(Tenant, "j", "d", Clean: true).Kind);
        Assert.Equal(JobKind.ItemProcess, new ItemProcessRequestedEvent(Tenant, "j", "d").Kind);
        Assert.Equal("item-queue", queues.UrlFor(JobKind.ItemClean));
        Assert.Equal("item-queue", queues.UrlFor(JobKind.ItemSplit));
    }

    // ── The user deletes the draft while the worker is busy: the worker must never bring it back ────────────────

    /// <summary>What DELETE v1/tenant/item-draft/{id} does: the draft row and every object it knows about.</summary>
    private static async Task UserDeletesDraftAsync(WorkerTestHost host)
    {
        var draft = await DraftAsync(host);
        foreach (var key in new[] { draft?.OriginalKey, draft?.ProcessedKey, StorageKeys.Upload(Tenant, DraftId) })
        {
            if (key is not null)
                await host.Storage.DeleteAsync(key, default);
        }
        await host.Repository.DeleteAsync(ItemDraftEntity.GetPk(Tenant), ItemDraftEntity.GetSk(DraftId));
    }

    private static async Task AssertNothingLeftAsync(WorkerTestHost host, JobEntity job)
    {
        Assert.Empty(await host.Repository.GetAllAsync<ItemDraftEntity>(ItemDraftEntity.GetPk(Tenant)));
        Assert.DoesNotContain(host.Storage.Objects.Keys, k => k.StartsWith(StorageKeys.TenantRoot(Tenant), StringComparison.Ordinal));
        var stored = await host.Repository.GetAsync<JobEntity>(JobEntity.GetPk(Tenant), JobEntity.GetSk(job.Id));
        Assert.Equal((JobStatus.Failed, JobFailure.SourceDeleted), (stored!.Status, stored.Failure));
    }

    [Fact]
    public async Task Process_DraftDeletedBeforeTheWorkerStarts_NoAiCall_NothingWritten()
    {
        var ai = new FakeAi(FlatLay);
        var host = Host(ai);
        var (job, _) = await ArrangeAsync(host);
        await host.Repository.DeleteAsync(ItemDraftEntity.GetPk(Tenant), ItemDraftEntity.GetSk(DraftId));

        await ProcessAsync(host, job, lastAttempt: true);

        Assert.Empty(ai.Cleanups);
        Assert.Empty(ai.Languages);
        await host.Storage.DeleteAsync(StorageKeys.Upload(Tenant, DraftId), default);
        await AssertNothingLeftAsync(host, job);
    }

    [Fact]
    public async Task Process_DraftDeletedWhileTheAiRuns_IsNotSavedAgain_AndItsImagesAreRemoved()
    {
        var ai = new FakeAi([Item(ItemCategoryHint.Top, "white", new BoundingBox(0, 0, 1, 1))]);
        var host = Host(ai);
        var (job, _) = await ArrangeAsync(host);
        ai.DuringCleanup = () => UserDeletesDraftAsync(host);

        await ProcessAsync(host, job, lastAttempt: true);

        Assert.Single(ai.Cleanups);
        await AssertNothingLeftAsync(host, job);
    }

    [Fact]
    public async Task Process_DraftDeletedWhileTheAiFails_StaysDeleted()
    {
        var ai = new FakeAi([Item(ItemCategoryHint.Top, "white", new BoundingBox(0, 0, 1, 1))]);
        var host = Host(ai);
        var (job, _) = await ArrangeAsync(host);
        ai.DuringCleanup = async () =>
        {
            await UserDeletesDraftAsync(host);
            throw new AiProviderException("provider down");
        };

        await ProcessAsync(host, job, lastAttempt: true);

        Assert.Null(await DraftAsync(host)); // the Failed status write is conditional too
        var stored = await host.Repository.GetAsync<JobEntity>(JobEntity.GetPk(Tenant), JobEntity.GetSk(job.Id));
        Assert.Equal(JobStatus.Failed, stored!.Status);
    }

    [Fact]
    public async Task Group_PhotoDeletedWhileThePiecesAreCut_LeavesNoPieceDrafts()
    {
        var ai = new FakeAi(FlatLay);
        var host = Host(ai);
        var (job, _) = await ArrangeAsync(host);
        ai.DuringDetect = () => UserDeletesDraftAsync(host);

        await ProcessAsync(host, job, lastAttempt: true);

        Assert.Empty(ai.Cleanups);
        await AssertNothingLeftAsync(host, job);
    }
}
