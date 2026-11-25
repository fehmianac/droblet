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

    // ── color-feed-pieces ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ColorPieces_ReadsOnlyPiecesWithoutAColour_DryRunWritesNothing_NothingElseOfThePostChanges_NoAi()
    {
        await PostAsync("edit-1", pieces: true);
        var done = await PostAsync("edit-2", pieces: true);
        done.Pieces[0].ColorId = "navy";
        await _host.Repository.SaveAsync(done);
        await PostAsync("edit-3", pieces: true);                                                // its piece picture is missing
        _store.Objects["catalog/feed/edit-1-p1.webp"] = ([1], "image/webp");
        _store.Objects["catalog/feed/edit-2-p1.webp"] = ([2], "image/webp");
        var feed = _host.Get<IFeedService>();
        var reads = new List<byte>();
        string? Read(byte[] image) { reads.Add(image[0]); return "olive"; }

        var dry = await ColorFeedPiecesCommand.ColorAsync(_host.Repository, feed, _store, Read, 1024, [], dryRun: true, force: false, new OpsOutput(_dir), default);
        Assert.Null((await GetAsync("edit-1"))!.Pieces[0].ColorId);
        var run = await ColorFeedPiecesCommand.ColorAsync(_host.Repository, feed, _store, Read, 1024, [], dryRun: false, force: false, new OpsOutput(_dir), default);

        Assert.Equal((0, 0), (dry, run));
        Assert.Equal([1, 1], reads);                                                            // never the one that has a colour
        var colored = (await GetAsync("edit-1"))!;
        Assert.Equal(("olive", ItemCategory.Top, 4, "Ofis edit-1"), (colored.Pieces[0].ColorId, colored.Pieces[0].Category, colored.SortOrder, colored.Title["tr"]));
        Assert.Equal("navy", (await GetAsync("edit-2"))!.Pieces[0].ColorId);
        Assert.Null((await GetAsync("edit-3"))!.Pieces[0].ColorId);                             // unreadable: left without
        Assert.Equal((0, 0), (_ai.Detections, _ai.Cleanups));
    }

    [Fact]
    public void PieceColorReader_ReadsARealPicture_AndRefusesBytesThatAreNotOne()
    {
        using var bitmap = new SkiaSharp.SKBitmap(40, 40);
        using (var canvas = new SkiaSharp.SKCanvas(bitmap))
        {
            canvas.Clear(SkiaSharp.SKColors.White);
            using var paint = new SkiaSharp.SKPaint { Color = new SkiaSharp.SKColor(0x1B, 0x2A, 0x49) };
            canvas.DrawRect(8, 8, 24, 24, paint);
        }
        using var png = bitmap.Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);

        Assert.Equal("navy", PieceColorReader.Read(png.ToArray()));
        Assert.Null(PieceColorReader.Read([1, 2, 3]));
        Assert.Null(PieceColorReader.Read([]));
    }

    // ── note-feed-posts ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Notes_WriteOnlyTheNote_DryRunWritesNothing_AMissingPostIsReported_TheCheckedInFileIsValid()
    {
        await PostAsync("edit-1", pieces: true);
        var feed = _host.Get<IFeedService>();
        FeedPostNote[] notes = [new("edit-1", " Saten babeti gri çorapla giy. ", "Wear satin flats with grey socks."), new("nope", "x", "y")];

        var dry = await NoteFeedPostsCommand.WriteAsync(feed, notes, dryRun: true, new OpsOutput(_dir), default);
        Assert.Null((await GetAsync("edit-1"))!.Note);
        var run = await NoteFeedPostsCommand.WriteAsync(feed, notes, dryRun: false, new OpsOutput(_dir), default);

        Assert.Equal((0, 1), (dry, run));                                                       // "nope" does not exist
        var post = (await GetAsync("edit-1"))!;
        Assert.Equal(("Saten babeti gri çorapla giy.", "Wear satin flats with grey socks."), (post.Note!["tr"], post.Note["en"]));
        Assert.Equal(("Ofis edit-1", 1, 4, true), (post.Title["tr"], post.Pieces.Count, post.SortOrder, post.Published));
        Assert.Null(await GetAsync("nope"));                                                    // never created

        Assert.Null(NoteFeedPostsCommand.Parse("not json"));
        Assert.Null(NoteFeedPostsCommand.Parse("[]"));
        Assert.Null(NoteFeedPostsCommand.Parse("""[{"id":"a","noteTr":"x","noteEn":"y"},{"id":"a","noteTr":"x","noteEn":"y"}]"""));
        Assert.Null(NoteFeedPostsCommand.Parse("""[{"id":"a","noteTr":" ","noteEn":"y"}]"""));
        var checkedIn = NoteFeedPostsCommand.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "ops-presets", "feed-notes-1123.json")));
        Assert.Equal(57, checkedIn!.Count);
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "ops-presets")))
            dir = dir.Parent;
        return dir!.FullName;
    }

    // ── seed-weekly-edit ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task SeedWeeklyEdit_SevenPhotoLooks_ThisWeek_Idempotent_NoAi()
    {
        static WeeklyEditDay Day(string id) => new(id, "Başlık " + id, "Title " + id, "Not " + id, "Note " + id);
        var days = Enumerable.Range(1, 7).Select(i => Day($"men-{i}")).ToList();
        foreach (var day in days)
        {
            var post = await PostAsync(day.Id);
            post.Segment = Segment.Men;
            await _host.Repository.SaveAsync(post);
        }
        var women = await PostAsync("women-1");
        women.Segment = Segment.Women;
        await _host.Repository.SaveAsync(women);
        var content = _host.Get<IContentService>();
        var wednesday = new DateOnly(2026, 11, 25);

        var dry = await SeedWeeklyEditCommand.SeedAsync(_host.Repository, content, Segment.Men, days, dryRun: true, wednesday, new OpsOutput(_dir), default);
        Assert.Empty(await content.ListEditsAsync(default));
        var first = await SeedWeeklyEditCommand.SeedAsync(_host.Repository, content, Segment.Men, days, dryRun: false, wednesday, new OpsOutput(_dir), default);
        var again = await SeedWeeklyEditCommand.SeedAsync(_host.Repository, content, Segment.Men, days, dryRun: false, wednesday, new OpsOutput(_dir), default);
        var wrongSegment = await SeedWeeklyEditCommand.SeedAsync(_host.Repository, content, Segment.Men, [.. days.Take(6), Day("women-1")], dryRun: false, wednesday, new OpsOutput(_dir), default);
        var missing = await SeedWeeklyEditCommand.SeedAsync(_host.Repository, content, Segment.Men, [.. days.Take(6), Day("nope")], dryRun: false, wednesday, new OpsOutput(_dir), default);

        Assert.Equal((0, 0, 0, 1, 1), (dry, first, again, wrongSegment, missing));
        var edit = Assert.Single(await content.ListEditsAsync(default));
        Assert.Equal(("edit-men-2026-11-23", Segment.Men, "2026-11-23", true), (edit.Id, edit.Segment, edit.WeekStart, edit.Published));
        Assert.Equal(Enumerable.Range(1, 7), edit.Looks.Select(l => l.Day));
        Assert.All(edit.Looks, l => Assert.Empty(l.Variants));
        Assert.Equal(("Başlık men-1", "Title men-1", "Not men-1", "Note men-1"), (edit.Looks[0].Title["tr"], edit.Looks[0].Title["en"], edit.Looks[0].StyleNote!["tr"], edit.Looks[0].StyleNote!["en"]));
        Assert.Equal(edit.Looks[0].ImageUrl, edit.CoverImageUrl);
        Assert.NotNull(edit.Looks[0].ImageUrl);
        Assert.Equal(edit.Id, WeeklyEditRules.PickCurrent([edit], wednesday, Segment.Men)?.Id);
        Assert.Null(WeeklyEditRules.PickCurrent([edit], wednesday, Segment.Women));
        Assert.Equal(new DateOnly(2026, 11, 23), SeedWeeklyEditCommand.WeekStartOf(new DateOnly(2026, 11, 29)));
        Assert.Equal(new DateOnly(2026, 11, 23), SeedWeeklyEditCommand.WeekStartOf(new DateOnly(2026, 11, 23)));
        Assert.Equal((0, 0), (_ai.Detections, _ai.Cleanups));
    }

    [Fact]
    public void SeedWeeklyEdit_File_SevenValidDays_Only()
    {
        var file = File.ReadAllText(Path.Combine(RepoRoot(), "ops-presets", "weekly-edit-men.json"));
        var days = SeedWeeklyEditCommand.Parse(file)!;
        Assert.Equal(7, days.Count);
        Assert.Null(SeedWeeklyEditCommand.Parse("[]"));
        Assert.Null(SeedWeeklyEditCommand.Parse("not json"));
        Assert.Null(SeedWeeklyEditCommand.Parse(System.Text.Json.JsonSerializer.Serialize(days.Take(6))));
        Assert.Null(SeedWeeklyEditCommand.Parse(System.Text.Json.JsonSerializer.Serialize(days.Select((d, i) => i == 0 ? d with { NoteTr = " " } : d))));
        Assert.Null(SeedWeeklyEditCommand.Parse(System.Text.Json.JsonSerializer.Serialize(days.Select(d => d with { Id = "same" }))));
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

    [Fact]
    public async Task SegmentPosts_UnsegmentedPostsAndStoriesGetTheSegment_OnlyTheSegmentChanges_OnlyIdsOverride_NoAi()
    {
        await PostAsync("edit-1", pieces: true);
        var men = await PostAsync("edit-men");
        men.Segment = Segment.Men;
        await _host.Repository.SaveAsync(men);
        await SeedFeedStoriesCommand.SeedAsync(_host.Repository, _host.Get<IFeedService>(), ["edit-1"], dryRun: false, Now, new OpsOutput(_dir), default);

        var dry = await SegmentFeedPostsCommand.WriteAsync(_host.Repository, Segment.Women, [], dryRun: true, new OpsOutput(_dir), default);
        Assert.Null((await GetAsync("edit-1"))!.Segment);
        var run = await SegmentFeedPostsCommand.WriteAsync(_host.Repository, Segment.Women, [], dryRun: false, new OpsOutput(_dir), default);
        var again = await SegmentFeedPostsCommand.WriteAsync(_host.Repository, Segment.Women, [], dryRun: false, new OpsOutput(_dir), default);

        Assert.Equal((0, 0, 0), (dry, run, again));
        var post = (await GetAsync("edit-1"))!;
        Assert.Equal((Segment.Women, 1, 4, "Ofis edit-1"), (post.Segment, post.Pieces.Count, post.SortOrder, post.Title["tr"]));
        Assert.Equal(Segment.Men, (await GetAsync("edit-men"))!.Segment);                       // already has one: left alone
        Assert.Equal(Segment.Women, Assert.Single(await _host.Repository.GetAllAsync<FeedStoryEntity>(FeedStoryEntity.GetPk())).Segment);

        await SegmentFeedPostsCommand.WriteAsync(_host.Repository, Segment.Men, ["edit-1"], dryRun: false, new OpsOutput(_dir), default);
        Assert.Equal(Segment.Men, (await GetAsync("edit-1"))!.Segment);                         // --only moves a chosen post
        Assert.Equal((0, 0), (_ai.Detections, _ai.Cleanups));
    }
}
