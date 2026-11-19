using System.Net;
using Domain.Entity;
using Domain.Enum;
using Domain.Events;
using Domain.Extensions;
using Domain.Manager;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Services;
using ItemProcessor.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Tests.Shared;

namespace ItemProcessorTests;

public class OutfitImportJobServiceTests
{
    private const string Tenant = "01JTENANT0000000000000000B";
    private const string SessionId = "01JSESSION000000000000000A";
    private static readonly PixelSize PhotoSize = new(1000, 1500);
    private static readonly Dictionary<string, double> Sure = new() { ["category"] = 0.95, ["colorIds"] = 0.9, ["fabric"] = 0.9, ["seasons"] = 0.9 };

    private static DetectedItem Piece(ItemCategoryHint category, string color, string? subcategory, double y, double confidence = 0.9, string? name = null) =>
        new(new GarmentSuggestion(category, [color], null, [Season.Spring], Sure, name ?? subcategory), new BoundingBox(0.1, y, 0.5, 0.2), subcategory, confidence);

    private static readonly DetectedItem Shirt = Piece(ItemCategoryHint.Top, "white", "shirt", 0.05, name: "Beyaz gömlek");
    private static readonly DetectedItem Jeans = Piece(ItemCategoryHint.Bottom, "navy", "jeans", 0.4, name: "Lacivert jean");
    private static readonly DetectedItem Sneakers = Piece(ItemCategoryHint.Shoes, "white", "sneakers", 0.75, name: "Beyaz spor ayakkabı");

    /// <summary>Detection per photo index; the match answer per call (null = "none of them").</summary>
    private sealed class FakeAi : IFastItemDetector, IItemMatcher
    {
        public Dictionary<int, IReadOnlyList<DetectedItem>> ByPhoto { get; } = [];
        public int Detections { get; private set; }
        public List<int> MatchCandidateCounts { get; } = [];
        public List<bool> FastFlags { get; } = [];
        public List<string?> Flows { get; } = [];
        public Func<IReadOnlyList<ImageInput>, ItemMatchResult> Answer { get; set; } = _ => new ItemMatchResult(null, 0.9);
        public Exception? DetectError { get; set; }
        public int? CurrentPhoto { get; set; }

        public Task<IReadOnlyList<DetectedItem>> DetectItemsAsync(ImageInput photo, string language, bool fast, CancellationToken ct)
        {
            Detections++;
            FastFlags.Add(fast);
            Flows.Add(Infrastructure.Ai.AiCallContext.Current);
            if (DetectError is { } error)
                throw error;
            return Task.FromResult(ByPhoto.TryGetValue(CurrentPhoto ?? 1, out var items) ? items : (IReadOnlyList<DetectedItem>)[]);
        }

        public Task<ItemMatchResult> MatchAsync(ImageInput crop, IReadOnlyList<ImageInput> candidates, string? pieceHint, bool fast, CancellationToken ct)
        {
            MatchCandidateCounts.Add(candidates.Count);
            return Task.FromResult(Answer(candidates));
        }
    }

    private sealed class FakeCropper : IImageCropper
    {
        private int _n;
        public PixelSize? Measure(ImageInput photo) => PhotoSize;
        public ImageInput? Crop(ImageInput photo, CropPlan plan) => new([0xFF, 0xD8, 0xFF, (byte)Interlocked.Increment(ref _n)], "image/jpeg");
    }

    private sealed class Events : IEventManager
    {
        public List<(IJobRequestedEvent Event, TimeSpan Delay)> Sent { get; } = [];
        public Task PublishAsync(IJobRequestedEvent jobEvent, CancellationToken ct = default) => PublishAsync(jobEvent, TimeSpan.Zero, ct);
        public Task PublishAsync(IJobRequestedEvent jobEvent, TimeSpan delay, CancellationToken ct = default)
        {
            Sent.Add((jobEvent, delay));
            return Task.CompletedTask;
        }
    }

    private sealed record Setup(WorkerTestHost Host, FakeAi Ai, Events Events);

    private static Setup Create(Dictionary<string, string?>? config = null)
    {
        var ai = new FakeAi();
        var events = new Events();
        var host = new WorkerTestHost(services =>
        {
            services.RemoveAll<IFastItemDetector>();
            services.RemoveAll<IItemMatcher>();
            services.AddSingleton<IFastItemDetector>(ai);
            services.AddSingleton<IItemMatcher>(ai);
            services.AddSingleton<IImageCropper>(new FakeCropper());
            services.RemoveAll<IEventManager>();
            services.AddSingleton<IEventManager>(events);
            services.TryAddSingleton<INotificationInbox, NotificationInboxService>();
            services.AddSingleton<IOutfitImportJobService, OutfitImportJobService>();
            if (config is not null)
                services.Configure<Domain.Options.OutfitImportOptions>(o =>
                {
                    if (config.TryGetValue("MaxInFlightPerTenant", out var cap)) o.MaxInFlightPerTenant = int.Parse(cap!);
                    if (config.TryGetValue("MaxBackoffs", out var max)) o.MaxBackoffs = int.Parse(max!);
                });
        });
        return new Setup(host, ai, events);
    }

    private static async Task<OutfitImportSessionEntity> SessionAsync(WorkerTestHost host, int photos, bool reserve = true)
    {
        var session = new OutfitImportSessionEntity
        {
            Id = SessionId, TenantId = Tenant, Status = OutfitImportStatus.Open, Count = photos, Requested = photos, Language = "tr",
            CreatedAt = WorkerTestHost.Now, UpdatedAt = WorkerTestHost.Now,
        };
        await host.Repository.SaveIfVersionAsync(session, 0);
        for (var i = 1; i <= photos; i++)
        {
            var photo = new OutfitImportPhotoEntity
            {
                TenantId = Tenant, SessionId = SessionId, Index = i, Status = OutfitImportPhotoStatus.Uploaded, UploadKey = StorageKeys.ImportUpload(Tenant, SessionId, i),
                LookId = Ulid.Deterministic(WorkerTestHost.Now, $"{SessionId}:look:{i}"), CreatedAt = WorkerTestHost.Now, UpdatedAt = WorkerTestHost.Now,
            };
            await host.Repository.SaveIfVersionAsync(photo, 0);
            await host.Storage.PutAsync(photo.UploadKey, TestImages.JpegWithExif(), "image/jpeg", default);
        }
        if (reserve)
            await host.Get<IItemRecognitionQuotaService>().ReserveAsync(Tenant, Enumerable.Range(1, photos).Select(i => OutfitImportPhotoEntity.RecognitionKey(SessionId, i)).ToList(), default);
        return session;
    }

    private static async Task RunAsync(Setup s, int index, int attempt = 0, bool lastAttempt = false)
    {
        s.Ai.CurrentPhoto = index;
        await s.Host.Get<IOutfitImportJobService>().ProcessAsync(new OutfitImportPhotoRequestedEvent(Tenant, SessionId, index, attempt), lastAttempt, default);
    }

    private static Task<OutfitImportPhotoEntity?> PhotoAsync(WorkerTestHost host, int index) =>
        host.Repository.GetAsync<OutfitImportPhotoEntity>(OutfitImportPhotoEntity.GetPk(Tenant), OutfitImportPhotoEntity.GetSk(SessionId, index));

    private static Task<OutfitImportSessionEntity?> StoredSessionAsync(WorkerTestHost host) =>
        host.Repository.GetAsync<OutfitImportSessionEntity>(OutfitImportSessionEntity.GetPk(Tenant), OutfitImportSessionEntity.GetSk(SessionId));

    private static async Task<List<OutfitImportPieceEntity>> PiecesAsync(WorkerTestHost host) =>
        await host.Repository.GetAllAsync<OutfitImportPieceEntity>(OutfitImportPieceEntity.GetPk(Tenant));

    private static async Task<ItemEntity> WardrobeItemAsync(WorkerTestHost host, ItemCategory category, string color, string? subcategory)
    {
        var item = new ItemEntity
        {
            Id = Ulid.New(), TenantId = Tenant, Category = category, Subcategory = subcategory, ColorIds = [color], Seasons = [Season.Spring],
            Source = ItemSource.Photo, ImageKey = StorageKeys.ItemImage(Tenant, Ulid.New()), CreatedAt = WorkerTestHost.Now, UpdatedAt = WorkerTestHost.Now,
        };
        await host.Storage.PutAsync(item.ImageKey!, [0xFF, 0xD8, 0x01], "image/webp", default);
        await host.Repository.SaveIfVersionAsync(item, 0);
        return item;
    }

    // ── Stages ───────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task OnePhoto_EmptyWardrobe_DetectsCropsAndDraftsALook_WithoutAMatchCall()
    {
        var s = Create();
        await SessionAsync(s.Host, 1);
        s.Ai.ByPhoto[1] = [Shirt, Jeans, Sneakers];

        await RunAsync(s, 1);

        var photo = (await PhotoAsync(s.Host, 1))!;
        Assert.Equal(OutfitImportPhotoStatus.Ready, photo.Status);
        Assert.Equal(["1-1", "1-2", "1-3"], photo.Pieces.Select(p => p.Ref));
        Assert.All(photo.Pieces, p => Assert.True(s.Host.Storage.Objects.ContainsKey(p.CropKey!)));
        Assert.Equal([OutfitSlot.Top, OutfitSlot.Bottom, OutfitSlot.Shoes], photo.Pieces.Select(p => p.Slot!.Value));
        Assert.All(photo.Pieces, p => Assert.Null(p.MatchItemId));
        Assert.Equal(3, (await PiecesAsync(s.Host)).Count);
        Assert.Empty(s.Ai.MatchCandidateCounts);   // nothing similar in the wardrobe: no match call
        Assert.Equal([true], s.Ai.FastFlags);        // detection asks for the fast model
        Assert.Equal(["outfit_import"], s.Ai.Flows);  // …inside the outfit-import flow (Ai:ServiceTiers:outfit_import)
        Assert.Null(Infrastructure.Ai.AiCallContext.Current);
        // The stripped photo is kept under the tenant prefix; the EXIF never reaches it.
        var stored = s.Host.Storage.Objects[photo.PhotoKey!].Data;
        Assert.StartsWith(StorageKeys.ImportPrefix(Tenant, SessionId), photo.PhotoKey);
        Assert.DoesNotContain("GPS", System.Text.Encoding.ASCII.GetString(stored));

        var session = (await StoredSessionAsync(s.Host))!;
        Assert.Equal((1, 1, 1, 0), (session.Detected, session.Matched, session.Ready, session.Failed));
        // The detection used the photo's recognition (free user): committed, nothing pending.
        var usage = await s.Host.Repository.GetAsync<ItemRecognitionUsageEntity>(ItemRecognitionUsageEntity.GetPk(Tenant), ItemRecognitionUsageEntity.GetSk());
        Assert.Equal((1, 0), (usage!.Used, usage.Pending.Count));
        // Ready for review: one inbox row.
        var inbox = await s.Host.Repository.GetAllAsync<NotificationInboxEntity>(NotificationInboxEntity.GetPk(Tenant));
        Assert.Equal(NotificationType.OutfitImportReady, Assert.Single(inbox).Type);
    }

    [Fact]
    public async Task Match_UsesTheShortlist_AndTagsTheWardrobeItem()
    {
        var s = Create();
        var blackShirt = await WardrobeItemAsync(s.Host, ItemCategory.Top, "black", "shirt");
        var whiteShirt = await WardrobeItemAsync(s.Host, ItemCategory.Top, "white", "shirt");
        await WardrobeItemAsync(s.Host, ItemCategory.Top, "white", "t-shirt");     // other sub-type: never shown
        await WardrobeItemAsync(s.Host, ItemCategory.Bottom, "white", "skirt");    // other category: never shown
        await SessionAsync(s.Host, 1);
        s.Ai.ByPhoto[1] = [Shirt];
        s.Ai.Answer = candidates => new ItemMatchResult(0, 0.93); // the first candidate (best colour agreement)

        await RunAsync(s, 1);

        var piece = Assert.Single((await PhotoAsync(s.Host, 1))!.Pieces);
        Assert.Equal(whiteShirt.Id, piece.MatchItemId);
        Assert.Equal(0.93, piece.MatchConfidence);
        Assert.Null(piece.PieceId);
        Assert.Equal([1], s.Ai.MatchCandidateCounts);   // the black shirt has no colour in common: ruled out too
        Assert.Empty(await PiecesAsync(s.Host));
        Assert.NotEqual(blackShirt.Id, piece.MatchItemId);
    }

    [Fact]
    public async Task Match_BelowTheThreshold_IsANewPiece()
    {
        var s = Create();
        await WardrobeItemAsync(s.Host, ItemCategory.Top, "white", "shirt");
        await SessionAsync(s.Host, 1);
        s.Ai.ByPhoto[1] = [Shirt];
        s.Ai.Answer = _ => new ItemMatchResult(0, 0.5);

        await RunAsync(s, 1);

        var piece = Assert.Single((await PhotoAsync(s.Host, 1))!.Pieces);
        Assert.Null(piece.MatchItemId);
        Assert.NotNull(piece.PieceId);
    }

    [Fact]
    public async Task Dedupe_TheSameNewPieceInTwoPhotos_IsOneSessionPiece()
    {
        var s = Create();
        await SessionAsync(s.Host, 2);
        s.Ai.ByPhoto[1] = [Shirt, Jeans];
        s.Ai.ByPhoto[2] = [Shirt, Sneakers];
        s.Ai.Answer = _ => new ItemMatchResult(0, 0.9); // photo 2's shirt = photo 1's shirt

        await RunAsync(s, 1);
        await RunAsync(s, 2);

        var first = (await PhotoAsync(s.Host, 1))!;
        var second = (await PhotoAsync(s.Host, 2))!;
        Assert.Equal(first.Pieces[0].PieceId, second.Pieces[0].PieceId);
        var pieces = await PiecesAsync(s.Host);
        Assert.Equal(3, pieces.Count);   // shirt, jeans, sneakers — the shirt once
        Assert.Equal([1, 2], pieces.Single(p => p.Id == first.Pieces[0].PieceId).SeenIn);
        Assert.Equal([1], s.Ai.MatchCandidateCounts); // only the second shirt had a candidate (jeans ≠ shoes category)
        // Both photos done: the session is ready, notified once.
        Assert.Single(await s.Host.Repository.GetAllAsync<NotificationInboxEntity>(NotificationInboxEntity.GetPk(Tenant)));
    }

    [Fact]
    public async Task Dress_TakesTheTopSlot_AndClosesTheBottom()
    {
        var s = Create();
        await SessionAsync(s.Host, 1);
        s.Ai.ByPhoto[1] = [Piece(ItemCategoryHint.Dress, "red", "dress", 0.1), Jeans, Piece(ItemCategoryHint.Bag, "black", "tote", 0.5), Piece(ItemCategoryHint.Accessory, "beige", "belt", 0.3, 0.6)];

        await RunAsync(s, 1);

        var slots = (await PhotoAsync(s.Host, 1))!.Pieces.ToDictionary(p => p.Subcategory!, p => p.Slot);
        Assert.Equal(OutfitSlot.Top, slots["dress"]);
        Assert.Null(slots["jeans"]);                  // a dress closes the bottom slot
        Assert.Equal(OutfitSlot.BagAccessory, slots["tote"]);
        Assert.Null(slots["belt"]);                   // one piece per slot: the more confident bag wins
    }

    // ── Idempotency, fairness, failures ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DuplicateDelivery_RunsNothingTwice()
    {
        var s = Create();
        await SessionAsync(s.Host, 1);
        s.Ai.ByPhoto[1] = [Shirt];

        await RunAsync(s, 1);
        await RunAsync(s, 1);

        Assert.Equal(1, s.Ai.Detections);
        Assert.Equal(1, (await StoredSessionAsync(s.Host))!.Ready);
    }

    [Fact]
    public async Task Fairness_ATenantAtItsCap_IsPutBackOnTheQueueWithADelay()
    {
        var s = Create(new() { ["MaxInFlightPerTenant"] = "1" });
        await SessionAsync(s.Host, 2);
        s.Ai.ByPhoto[2] = [Shirt];
        // Photo 1 holds the tenant's only slot.
        await s.Host.Repository.SaveIfVersionAsync(new OutfitImportLeaseEntity
        {
            TenantId = Tenant, Name = OutfitImportLeaseEntity.InFlight, UpdatedAt = WorkerTestHost.Now,
            Leases = [new OutfitImportLease { Holder = $"{SessionId}#1", Until = WorkerTestHost.Now.AddMinutes(2) }],
        }, 0);

        await RunAsync(s, 2);

        Assert.Equal(0, s.Ai.Detections);
        var (sent, delay) = Assert.Single(s.Events.Sent);
        Assert.Equal(new OutfitImportPhotoRequestedEvent(Tenant, SessionId, 2, 1), sent);
        Assert.True(delay >= TimeSpan.FromSeconds(8));
        Assert.Equal(OutfitImportPhotoStatus.Uploaded, (await PhotoAsync(s.Host, 2))!.Status);

        // An expired lease (a crashed run) no longer counts.
        s.Host.Clock.Advance(TimeSpan.FromMinutes(3));
        await RunAsync(s, 2, attempt: 1);
        Assert.Equal(OutfitImportPhotoStatus.Ready, (await PhotoAsync(s.Host, 2))!.Status);
        var lease = await s.Host.Repository.GetAsync<OutfitImportLeaseEntity>(OutfitImportLeaseEntity.GetPk(Tenant), OutfitImportLeaseEntity.InFlight);
        Assert.Empty(OutfitImportRules.Live(lease!.Leases, s.Host.Clock.GetUtcNow().UtcDateTime));   // released after the run
    }

    [Fact]
    public async Task SessionMatchStep_IsOnePhotoAtATime()
    {
        var s = Create();
        await SessionAsync(s.Host, 2);
        s.Ai.ByPhoto[2] = [Shirt];
        await s.Host.Repository.SaveIfVersionAsync(new OutfitImportLeaseEntity
        {
            TenantId = Tenant, Name = OutfitImportLeaseEntity.MatchLock(SessionId), UpdatedAt = WorkerTestHost.Now,
            Leases = [new OutfitImportLease { Holder = $"{SessionId}#1", Until = WorkerTestHost.Now.AddMinutes(2) }],
        }, 0);

        await RunAsync(s, 2);

        // Detected in parallel, then back on the queue for the match step.
        Assert.Equal(OutfitImportPhotoStatus.Detected, (await PhotoAsync(s.Host, 2))!.Status);
        Assert.Single(s.Events.Sent);
        await s.Host.Repository.DeleteAsync(OutfitImportLeaseEntity.GetPk(Tenant), OutfitImportLeaseEntity.MatchLock(SessionId));
        await RunAsync(s, 2, attempt: 1);
        Assert.Equal(OutfitImportPhotoStatus.Ready, (await PhotoAsync(s.Host, 2))!.Status);
        Assert.Equal(1, s.Ai.Detections);   // stage A is not run again
    }

    [Fact]
    public async Task RateLimit429_BacksOffExponentially_ThenFailsAndGivesTheRecognitionBack()
    {
        var s = Create(new() { ["MaxBackoffs"] = "2" });
        await SessionAsync(s.Host, 1);
        s.Ai.DetectError = new HttpRequestException("429", null, HttpStatusCode.TooManyRequests);

        await RunAsync(s, 1);
        await RunAsync(s, 1, attempt: 1);
        await RunAsync(s, 1, attempt: 2);

        Assert.Equal([TimeSpan.FromSeconds(20), TimeSpan.FromSeconds(40)], s.Events.Sent.Select(e => e.Delay));
        var photo = (await PhotoAsync(s.Host, 1))!;
        Assert.Equal((OutfitImportPhotoStatus.Failed, JobFailure.ProviderError), (photo.Status, photo.Failure));
        var usage = await s.Host.Repository.GetAsync<ItemRecognitionUsageEntity>(ItemRecognitionUsageEntity.GetPk(Tenant), ItemRecognitionUsageEntity.GetSk());
        Assert.Equal((0, 0), (usage!.Used, usage.Pending.Count));
        Assert.Equal(1, (await StoredSessionAsync(s.Host))!.Failed);
        // Nothing was ready: no "ready for review" row.
        Assert.Empty(await s.Host.Repository.GetAllAsync<NotificationInboxEntity>(NotificationInboxEntity.GetPk(Tenant)));
    }

    [Fact]
    public async Task BillingError_FailsAtOnce_NoRetry()
    {
        var s = Create();
        await SessionAsync(s.Host, 1);
        s.Ai.DetectError = new AiProviderException("OpenAI item_detection returned 429 (insufficient_quota).");

        await RunAsync(s, 1);

        Assert.Equal(OutfitImportPhotoStatus.Failed, (await PhotoAsync(s.Host, 1))!.Status);
        Assert.Empty(s.Events.Sent);
    }

    [Fact]
    public async Task ATransientError_IsRetriedBySqs_UntilTheLastAttempt()
    {
        var s = Create();
        await SessionAsync(s.Host, 1);
        s.Ai.DetectError = new HttpRequestException("503", null, HttpStatusCode.ServiceUnavailable);

        await Assert.ThrowsAsync<HttpRequestException>(() => RunAsync(s, 1));
        Assert.Equal(OutfitImportPhotoStatus.Uploaded, (await PhotoAsync(s.Host, 1))!.Status);

        await RunAsync(s, 1, lastAttempt: true);
        Assert.Equal(OutfitImportPhotoStatus.Failed, (await PhotoAsync(s.Host, 1))!.Status);
    }

    [Fact]
    public async Task NoPieceFound_GuardRejected()
    {
        var s = Create();
        await SessionAsync(s.Host, 1);

        await RunAsync(s, 1);

        var photo = (await PhotoAsync(s.Host, 1))!;
        Assert.Equal((OutfitImportPhotoStatus.Failed, JobFailure.GuardRejected), (photo.Status, photo.Failure));
    }

    [Fact]
    public async Task DiscardedSession_IsSkipped()
    {
        var s = Create();
        await SessionAsync(s.Host, 1);
        await s.Host.Repository.DeleteAsync(OutfitImportSessionEntity.GetPk(Tenant), OutfitImportSessionEntity.GetSk(SessionId));

        await RunAsync(s, 1);

        Assert.Equal(0, s.Ai.Detections);
    }
}
