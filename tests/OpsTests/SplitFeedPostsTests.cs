using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Domain.Services.Ai;
using Microsoft.Extensions.DependencyInjection;
using Ops;
using Ops.Commands;
using Tests.Shared;

namespace OpsTests;

/// <summary>split-feed-posts and seed-feed-stories with fakes only: no AWS, no AI call.</summary>
public class SplitFeedPostsTests : IDisposable
{
    private const string BaseUrl = "https://droblet-dev-catalog-images.s3.eu-central-1.amazonaws.com";
    private static readonly DateTime Now = WorkerTestHost.Now;
    private readonly string _dir = Directory.CreateTempSubdirectory("ops-split-test-").FullName;
    private readonly WorkerTestHost _host = new(s => s.AddSingleton<Domain.Manager.IEventManager>(new NoEvents()));   // nothing here publishes; no SQS client
    private readonly FakeStore _store = new();
    private readonly FakeAi _ai = new();

    public void Dispose()
    {
        Directory.Delete(_dir, recursive: true);
        GC.SuppressFinalize(this);
    }

    private sealed class NoEvents : Domain.Manager.IEventManager
    {
        public Task PublishAsync(Domain.Events.IJobRequestedEvent jobEvent, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class FakeStore : ICatalogImageStore
    {
        public string BaseUrl => SplitFeedPostsTests.BaseUrl;
        public Dictionary<string, (byte[] Data, string ContentType)> Objects { get; } = new(StringComparer.Ordinal);
        public Task<byte[]?> ReadAsync(string key, long maxBytes, CancellationToken ct) => Task.FromResult(Objects.TryGetValue(key, out var o) ? o.Data : null);
        public Task PutAsync(string key, byte[] data, string contentType, CancellationToken ct)
        {
            Objects[key] = (data, contentType);
            return Task.CompletedTask;
        }
    }

    /// <summary>Detector + cleanup + cropper + thumbnailer: counts every "AI" call; nothing leaves the process.</summary>
    private sealed class FakeAi : IItemDetector, IItemImageCleanup, IImageCropper, IImageThumbnailer
    {
        public int Detections { get; private set; }
        public int Cleanups { get; private set; }
        public int PiecesPerPhoto { get; set; } = 3;
        public Func<int, bool> FailCleanup { get; set; } = _ => false;
        public bool FailDetection { get; set; }
        public List<(ItemCategoryHint? Category, string? Subcategory)> Cleaned { get; } = [];

        public Task<IReadOnlyList<DetectedItem>> DetectItemsAsync(ImageInput photo, string language, CancellationToken ct) => throw new InvalidOperationException("segment overload expected");

        public Task<IReadOnlyList<DetectedItem>> DetectItemsAsync(ImageInput photo, string language, Segment segment, CancellationToken ct)
        {
            Assert.Equal(("tr", Segment.Women), (language, segment));
            Detections++;
            if (FailDetection)
                throw new HttpRequestException("503");
            var categories = new[] { ItemCategoryHint.Top, ItemCategoryHint.Bottom, ItemCategoryHint.Shoes, ItemCategoryHint.Bag, ItemCategoryHint.Outerwear, ItemCategoryHint.Accessory, ItemCategoryHint.Dress };
            var confidence = new Dictionary<string, double> { ["category"] = 0.95, ["colors"] = 0.9, ["fabric"] = 0.9, ["seasons"] = 0.9 };
            IReadOnlyList<DetectedItem> items = Enumerable.Range(0, PiecesPerPhoto)
                .Select(i => new DetectedItem(new GarmentSuggestion(categories[i], ["black"], "cotton", [Season.Autumn], confidence),
                    new BoundingBox(0.05 + 0.13 * i, 0.05, 0.1, 0.5), null, 0.9 - 0.01 * i))
                .ToList();
            return Task.FromResult(items);
        }

        public Task<ImageInput> CleanupItemAsync(ImageInput crop, ItemCategoryHint? category, string? subcategory, CancellationToken ct)
        {
            Cleanups++;
            if (FailCleanup(Cleanups))
                throw new AiProviderException("refused");
            Cleaned.Add((category, subcategory));
            return Task.FromResult(new ImageInput([9, 9, 9, (byte)Cleanups], "image/png"));
        }

        public PixelSize? Measure(ImageInput photo) => new PixelSize(1000, 1500);
        public ImageInput? Crop(ImageInput photo, CropPlan plan) => new([1, 2, 3], "image/jpeg");
        public byte[]? ToWebp(byte[] image, int maxSide) => [.. "WEBP"u8, .. image];
    }

    private SplitFeedPostsCommand Command() => new(_host.Repository, _host.Get<IFeedService>(), _ai, _ai, _ai, _ai, _store, 0.7, 10 * 1024 * 1024, new OpsOutput(_dir));

    private async Task<FeedPostEntity> PostAsync(string id, string[]? productIds = null, bool pieces = false, bool retired = false, bool image = true)
    {
        var post = new FeedPostEntity
        {
            Id = id, Author = new FeedAuthor { Kind = FeedAuthorKind.Edit, Name = new() { ["tr"] = "Droblet Edit" } }, Occasion = Occasion.Office,
            Title = new() { ["tr"] = "Ofis " + id, ["en"] = "Office " + id }, ImageUrls = [$"{BaseUrl}/catalog/feed/{id}.jpg"], ProductIds = [.. productIds ?? []],
            Pieces = pieces ? [new FeedPostPiece { Category = ItemCategory.Top, ImageUrl = $"{BaseUrl}/catalog/feed/{id}-p1.webp" }] : [],
            PublishAt = Now.AddHours(-1), SortOrder = 4, Published = !retired, Retired = retired, CreatedAt = Now.AddDays(-1), UpdatedAt = Now.AddDays(-1),
        };
        await _host.Repository.SaveAsync(post);
        if (image)
            _store.Objects[$"catalog/feed/{id}.jpg"] = (TestImages.JpegWithExif(), "image/jpeg");
        return post;
    }

    private Task<FeedPostEntity?> GetAsync(string id) => _host.Repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(id));

    // ── Planning ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Candidates_AreProductlessPostsWithAnImage_NotSplitYet_UnlessForced()
    {
        var all = new[]
        {
            await PostAsync("edit-1123-02"), await PostAsync("edit-1123-01"), await PostAsync("with-products", ["p1"]),
            await PostAsync("split-already", pieces: true), await PostAsync("retired", retired: true),
        };
        var noImage = await PostAsync("no-image");
        noImage.ImageUrls = [];

        Assert.Equal(["edit-1123-01", "edit-1123-02"], SplitFeedPostsPlan.Candidates([.. all, noImage], [], force: false).Select(p => p.Id));
        Assert.Equal(["edit-1123-01", "edit-1123-02", "split-already"], SplitFeedPostsPlan.Candidates(all, [], force: true).Select(p => p.Id));
        Assert.Equal(["edit-1123-02"], SplitFeedPostsPlan.Candidates(all, ["edit-1123-02", "with-products"], force: false).Select(p => p.Id));
    }

    [Fact]
    public void KeyOf_OnlyUrlsOfTheCatalogBucket_PieceKeyNextToThePicture()
    {
        Assert.Equal("catalog/feed/edit-1123-01.jpg", SplitFeedPostsPlan.KeyOf($"{BaseUrl}/catalog/feed/edit-1123-01.jpg", BaseUrl));
        Assert.Null(SplitFeedPostsPlan.KeyOf("https://img.example/catalog/feed/edit-1123-01.jpg", BaseUrl));
        Assert.Null(SplitFeedPostsPlan.KeyOf($"{BaseUrl.Replace("https", "http", StringComparison.Ordinal)}/catalog/feed/a.jpg", BaseUrl));
        Assert.Null(SplitFeedPostsPlan.KeyOf($"{BaseUrl}/catalog/feed/a.jpg?x=1", BaseUrl));
        Assert.Null(SplitFeedPostsPlan.KeyOf($"{BaseUrl}/", BaseUrl));
        Assert.Null(SplitFeedPostsPlan.KeyOf(null, BaseUrl));
        Assert.Equal("catalog/feed/edit-1123-01-p2.webp", SplitFeedPostsPlan.PieceKey("edit-1123-01", 2, SplitFeedPostsPlan.ExtensionOf("image/webp")));
        Assert.Equal(("png", "jpg"), (SplitFeedPostsPlan.ExtensionOf("image/png"), SplitFeedPostsPlan.ExtensionOf("image/jpeg")));
        Assert.Equal(342, SplitFeedPostsPlan.WorstCaseCalls(57));
    }

    [Fact]
    public void Arguments_CapIs260_DevOnly_IdsChecked()
    {
        static (OpsArguments? Args, string? Error) Parse(params string[] args) => OpsArguments.Parse(args);

        Assert.Equal(260, Parse("split-feed-posts", "--stage", "dev").Args!.FeedSplitCalls);
        var limited = Parse("split-feed-posts", "--stage", "dev", "--only", "edit-1123-01,edit-1123-02", "--max-calls", "12", "--dry-run", "--force").Args!;
        Assert.Equal((12, true, true), (limited.FeedSplitCalls, limited.DryRun, limited.Force));
        Assert.Equal(["edit-1123-01", "edit-1123-02"], limited.OnlyIds);
        Assert.Contains("0–260", Parse("split-feed-posts", "--stage", "dev", "--max-calls", "261").Error);
        Assert.Contains("not a post id", Parse("split-feed-posts", "--stage", "dev", "--only", "Bad Id").Error);
        Assert.Contains("refused on prod", Parse("split-feed-posts", "--stage", "prod").Error);
        Assert.Equal(260, new AiCallBudget(1000).Max);

        Assert.Equal(["edit-1123-01", "edit-1123-02"], Parse("seed-feed-stories", "--stage", "dev", "--ids", "edit-1123-01, edit-1123-02").Args!.Ids);
        Assert.Contains("--ids is required", Parse("seed-feed-stories", "--stage", "dev").Error);
        Assert.Contains("not a post id", Parse("seed-feed-stories", "--stage", "dev", "--ids", "ok-id,Bad Id").Error);
        Assert.Contains("refused on prod", Parse("seed-feed-stories", "--stage", "prod", "--ids", "a1").Error);
    }

    // ── The run ─────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Split_WritesThePiecesAndTheirImages_TouchesNothingElse_CountsEveryCall()
    {
        var before = await PostAsync("edit-1123-01");
        await PostAsync("with-products", ["p1"]);

        var result = await Command().SplitAsync([], 260, dryRun: false, force: false, default);

        Assert.Equal(new SplitFeedPostsCommand.Result(Candidates: 1, Written: 1, Failed: 0, NotStarted: 0, AiCalls: 4, CapReached: false), result);
        Assert.Equal((1, 3), (_ai.Detections, _ai.Cleanups));
        var post = (await GetAsync("edit-1123-01"))!;
        Assert.Equal([ItemCategory.Top, ItemCategory.Bottom, ItemCategory.Shoes], post.Pieces.Select(p => p.Category));
        Assert.Equal($"{BaseUrl}/catalog/feed/edit-1123-01-p1.webp", post.Pieces[0].ImageUrl);
        Assert.Equal("image/webp", _store.Objects["catalog/feed/edit-1123-01-p3.webp"].ContentType);
        Assert.Equal((before.UpdatedAt, before.SortOrder, before.Title["tr"], before.ImageUrls[0]), (post.UpdatedAt, post.SortOrder, post.Title["tr"], post.ImageUrls[0]));
        Assert.Empty((await GetAsync("with-products"))!.Pieces);

        // Again: nothing left to do, no call.
        var again = await Command().SplitAsync([], 260, dryRun: false, force: false, default);
        Assert.Equal((0, 0), (again.Candidates, again.AiCalls));
        Assert.Equal(1, _ai.Detections);
    }

    [Fact]
    public async Task Split_KeepsAtMostFivePieces_DryRunCallsNothing()
    {
        await PostAsync("edit-1123-01");
        _ai.PiecesPerPhoto = 7;

        var dry = await Command().SplitAsync([], 260, dryRun: true, force: false, default);
        var result = await Command().SplitAsync([], 260, dryRun: false, force: false, default);

        Assert.Equal((1, 0, 1), (dry.Candidates, dry.AiCalls, dry.NotStarted));
        Assert.Equal(6, result.AiCalls);                                      // 1 detection + 5 cleanups
        Assert.Equal(5, (await GetAsync("edit-1123-01"))!.Pieces.Count);
    }

    [Fact]
    public async Task Split_StopsAtTheCap_PostsAlreadyWrittenStay_NoPartialPost()
    {
        foreach (var id in new[] { "edit-1123-01", "edit-1123-02", "edit-1123-03" })
            await PostAsync(id);

        // 4 calls per post: the second post's detection fits (5), its three cleanups do not (6 left: 1) → stop.
        var result = await Command().SplitAsync([], 6, dryRun: false, force: false, default);

        Assert.Equal(new SplitFeedPostsCommand.Result(Candidates: 3, Written: 1, Failed: 0, NotStarted: 2, AiCalls: 5, CapReached: true), result);
        Assert.Equal(3, (await GetAsync("edit-1123-01"))!.Pieces.Count);
        Assert.Empty((await GetAsync("edit-1123-02"))!.Pieces);
        Assert.Empty((await GetAsync("edit-1123-03"))!.Pieces);
        Assert.Equal(3, _ai.Cleanups);

        // A post is not even started without room for its detection and one cleanup.
        var none = await Command().SplitAsync([], 1, dryRun: false, force: false, default);
        Assert.Equal((0, true), (none.AiCalls, none.CapReached));
    }

    [Fact]
    public async Task Split_FailedPostIsReportedAndSkipped_NeverRetried_AFailedCleanupOnlyDropsItsPiece()
    {
        await PostAsync("edit-1123-01", image: false);          // picture missing in the bucket: no AI call at all
        await PostAsync("edit-1123-02");
        await PostAsync("edit-1123-03");
        _ai.FailCleanup = call => call == 2;                    // the second piece of the first photographed post

        var result = await Command().SplitAsync([], 260, dryRun: false, force: false, default);

        Assert.Equal(new SplitFeedPostsCommand.Result(Candidates: 3, Written: 2, Failed: 1, NotStarted: 0, AiCalls: 8, CapReached: false), result);
        Assert.Equal([ItemCategory.Top, ItemCategory.Shoes], (await GetAsync("edit-1123-02"))!.Pieces.Select(p => p.Category));   // the failed piece left out
        Assert.Equal(["catalog/feed/edit-1123-02-p1.webp", "catalog/feed/edit-1123-02-p2.webp"],
            _store.Objects.Keys.Where(k => k.StartsWith("catalog/feed/edit-1123-02-p", StringComparison.Ordinal)).Order());
        Assert.Equal(3, (await GetAsync("edit-1123-03"))!.Pieces.Count);
        Assert.Equal((2, 6), (_ai.Detections, _ai.Cleanups));   // one call per piece: nothing was tried twice
    }

    [Fact]
    public async Task Split_ThreeFailuresInARow_StopTheRun()
    {
        foreach (var n in Enumerable.Range(1, 5))
            await PostAsync($"edit-1123-0{n}");
        _ai.FailDetection = true;

        var result = await Command().SplitAsync([], 260, dryRun: false, force: false, default);

        Assert.Equal((3, 3, 2), (result.Failed, result.AiCalls, result.NotStarted));
        Assert.Equal(3, _ai.Detections);
    }

    // ── seed-feed-stories ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task SeedStories_FromEditorPosts_SevenDays_Idempotent_NoAi()
    {
        var post = await PostAsync("edit-1123-01");
        await PostAsync("gone", retired: true);
        var feed = _host.Get<IFeedService>();

        var dry = await SeedFeedStoriesCommand.SeedAsync(_host.Repository, feed, ["edit-1123-01"], dryRun: true, Now, new OpsOutput(_dir), default);
        Assert.Empty(await _host.Repository.GetAllAsync<FeedStoryEntity>(FeedStoryEntity.GetPk()));
        var first = await SeedFeedStoriesCommand.SeedAsync(_host.Repository, feed, ["edit-1123-01"], dryRun: false, Now, new OpsOutput(_dir), default);
        var again = await SeedFeedStoriesCommand.SeedAsync(_host.Repository, feed, ["edit-1123-01"], dryRun: false, Now.AddHours(1), new OpsOutput(_dir), default);
        var missing = await SeedFeedStoriesCommand.SeedAsync(_host.Repository, feed, ["gone", "nope"], dryRun: false, Now, new OpsOutput(_dir), default);

        Assert.Equal((0, 0, 0, 1), (dry, first, again, missing));
        var story = Assert.Single(await _host.Repository.GetAllAsync<FeedStoryEntity>(FeedStoryEntity.GetPk()));
        Assert.Equal(("story-edit-1123-01", post.ImageUrls[0], "Ofis edit-1123-01", "Office edit-1123-01"), (story.Id, story.ImageUrl, story.Headline["tr"], story.Headline["en"]));
        Assert.Equal(("Droblet Edit", "Droblet Edit"), (story.Author.Name["tr"], story.Author.Name["en"]));
        Assert.Null(story.ProductId);
        Assert.True(story.Published);
        Assert.Equal((Now.AddHours(1), Now.AddHours(1).AddDays(7)), (story.PublishAt, story.ExpiresAt));
        Assert.True(FeedRules.IsActive(story, Now.AddHours(2)));
        Assert.Equal((0, 0), (_ai.Detections, _ai.Cleanups));
    }
}
