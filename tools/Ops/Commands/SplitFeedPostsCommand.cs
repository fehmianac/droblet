using System.Net;
using Amazon.S3;
using Amazon.S3.Model;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Validation;
using Infrastructure.Ai;
using ItemProcessor.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Ops.Commands;

/// <summary>The public catalog image bucket as split-feed-posts uses it (S3 in the tool, a fake in the tests).</summary>
internal interface ICatalogImageStore
{
    /// <summary>https base URL of the bucket's objects (no trailing slash needed).</summary>
    string BaseUrl { get; }
    Task<byte[]?> ReadAsync(string key, long maxBytes, CancellationToken ct);
    /// <summary>Public object, Cache-Control "public, max-age=86400".</summary>
    Task PutAsync(string key, byte[] data, string contentType, CancellationToken ct);
}

internal sealed class S3CatalogImageStore(IAmazonS3 s3, string bucket, string baseUrl) : ICatalogImageStore
{
    public string BaseUrl { get; } = baseUrl;

    public async Task<byte[]?> ReadAsync(string key, long maxBytes, CancellationToken ct)
    {
        try
        {
            using var response = await s3.GetObjectAsync(bucket, key, ct);
            if (response.ContentLength > maxBytes)
                return null;
            using var buffer = new MemoryStream();
            await response.ResponseStream.CopyToAsync(buffer, ct);
            return buffer.Length > maxBytes ? null : buffer.ToArray();
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task PutAsync(string key, byte[] data, string contentType, CancellationToken ct)
    {
        using var stream = new MemoryStream(data);
        var put = new PutObjectRequest { BucketName = bucket, Key = key, InputStream = stream, ContentType = contentType };
        put.Headers.CacheControl = SplitFeedPostsPlan.CacheControl;
        await s3.PutObjectAsync(put, ct);
    }
}

/// <summary>The pure part of split-feed-posts (which posts, which keys, how many calls): unit-tested without AWS or AI.</summary>
internal static class SplitFeedPostsPlan
{
    public const int MaxPiecesPerPhoto = 5;
    public const string CacheControl = "public, max-age=86400";
    /// <summary>Longest side of a stored piece image (the strip under the post shows thumbnails).</summary>
    public const int PieceMaxSide = 768;
    /// <summary>This many posts failing in a row on the AI / network stops the run (a systemic failure must not walk through every post).</summary>
    public const int MaxConsecutiveFailures = 3;

    /// <summary>
    /// Editor posts that are only a photograph: no product ids, a first image, and — unless forced — not split yet.
    /// Retired posts are left alone. <paramref name="only"/> empty = every such post. Ordered by id (a stable run order).
    /// </summary>
    public static IReadOnlyList<FeedPostEntity> Candidates(IEnumerable<FeedPostEntity> posts, IReadOnlyCollection<string> only, bool force) =>
        posts.Where(p => !p.Retired && p.ProductIds.Count == 0 && !string.IsNullOrWhiteSpace(p.ImageUrls.FirstOrDefault())
                         && (force || p.Pieces.Count == 0) && (only.Count == 0 || only.Contains(p.Id)))
            .OrderBy(p => p.Id, StringComparer.Ordinal)
            .ToList();

    /// <summary>The object key of an image URL of the catalog bucket ("catalog/feed/x.jpg"); null for any other host or a URL with a query / odd path.</summary>
    public static string? KeyOf(string? url, string baseUrl)
    {
        if (!Uri.TryCreate(url?.Trim(), UriKind.Absolute, out var uri) || !Uri.TryCreate(baseUrl, UriKind.Absolute, out var root))
            return null;
        if (uri.Scheme != Uri.UriSchemeHttps || !string.Equals(uri.Host, root.Host, StringComparison.OrdinalIgnoreCase) || !string.IsNullOrEmpty(uri.Query))
            return null;
        var prefix = root.AbsolutePath.TrimEnd('/') + "/";
        var path = Uri.UnescapeDataString(uri.AbsolutePath);
        if (!path.StartsWith(prefix, StringComparison.Ordinal))
            return null;
        var key = path[prefix.Length..];
        return key.Length == 0 || key.Contains("..", StringComparison.Ordinal) ? null : key;
    }

    /// <summary>catalog/feed/{postId}-p{n}.{ext} — next to the post's own picture (catalog/feed/{postId}.jpg).</summary>
    public static string PieceKey(string postId, int number, string extension) => $"catalog/feed/{postId.ToLowerInvariant()}-p{number}.{extension}";

    public static string ExtensionOf(string contentType) => contentType switch
    {
        "image/webp" => "webp",
        "image/png" => "png",
        _ => "jpg",
    };

    /// <summary>The most AI calls a run over these posts can make: one detection and up to five cleanups per post.</summary>
    public static int WorstCaseCalls(int posts) => posts * (1 + MaxPiecesPerPhoto);
}

/// <summary>Counts the AI calls of one split-feed-posts run (detection = 1, every cleanup = 1) against the owner-approved cap.</summary>
internal sealed class AiCallBudget(int max)
{
    public int Max { get; } = Math.Clamp(max, 0, OpsArguments.MaxFeedSplitCalls);
    public int Used { get; private set; }
    public int Remaining => Max - Used;

    public bool TryTake()
    {
        if (Used >= Max)
            return false;
        Used++;
        return true;
    }
}

/// <summary>
/// split-feed-posts [--only id,id] [--max-calls N&lt;=260] [--dry-run] [--force]: the editor posts that are one photograph
/// (no products) get their pieces (owner decision 2026-11-23). Per post: the first image is read from the catalog bucket,
/// one multi-item detection (women, "tr") finds the pieces — at most five, cropped exactly like the item worker does —
/// and every crop gets the item pipeline's cleanup (one image call each). The cleaned images go to
/// catalog/feed/{postId}-p{n}.webp and the pieces are written onto the post (nothing else of it is touched).
/// Every AI call counts against --max-calls (hard ceiling 260): a post starts only with room for its detection and one
/// cleanup, and when the detected pieces do not fit in what is left the run stops — posts written before stay, the rest
/// wait for another run. Nothing is retried: a piece whose cleanup fails is left out, a post without any piece is
/// reported as failed. Dev only.
/// </summary>
internal sealed class SplitFeedPostsCommand(
    IRepository repository,
    IFeedService feed,
    IItemDetector detector,
    IItemImageCleanup cleanup,
    IImageCropper cropper,
    IImageThumbnailer thumbnailer,
    ICatalogImageStore store,
    double confidenceThreshold,
    long maxImageBytes,
    OpsOutput output)
{
    public sealed record Result(int Candidates, int Written, int Failed, int NotStarted, int AiCalls, bool CapReached);

    private sealed record Row(string PostId, int Pieces, int Calls, string Outcome);

    public static Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        // The provider the tool registers itself (OpsHost: the workers' class, error bodies copied to the output): the same
        // detection and cleanup calls, prompts and stage settings as the item worker.
        var provider = services.GetRequiredService<OpenAiProvider>();
        var command = new SplitFeedPostsCommand(
            services.GetRequiredService<IRepository>(),
            services.GetRequiredService<IFeedService>(),
            provider,
            provider,
            new SkiaImageCropper(),
            new SkiaImageThumbnailer(),
            new S3CatalogImageStore(services.GetRequiredService<IAmazonS3>(), OpsHost.CatalogBucket(args.Stage), OpsHost.CatalogBaseUrl(args.Stage)),
            services.GetRequiredService<IOptionsMonitor<AiOptions>>().CurrentValue.VisionConfidenceThreshold,
            services.GetRequiredService<IOptionsMonitor<PhotoOptions>>().CurrentValue.MaxUploadBytes,
            output);
        return command.ExecuteAsync(args.OnlyIds, args.FeedSplitCalls, args.DryRun, args.Force, ct);
    }

    public async Task<int> ExecuteAsync(IReadOnlyList<string> only, int maxCalls, bool dryRun, bool force, CancellationToken ct)
    {
        var result = await SplitAsync(only, maxCalls, dryRun, force, ct);
        return result.Failed == 0 ? 0 : 1;
    }

    public async Task<Result> SplitAsync(IReadOnlyList<string> only, int maxCalls, bool dryRun, bool force, CancellationToken ct)
    {
        var all = await repository.GetAllAsync<FeedPostEntity>(FeedPostEntity.GetPk(), ct);
        var posts = SplitFeedPostsPlan.Candidates(all, only, force);
        var budget = new AiCallBudget(maxCalls);
        var unknown = only.Where(id => all.All(p => p.Id != id)).ToList();
        if (unknown.Count > 0)
            output.Error($"--only: no such post: {string.Join(", ", unknown)}");
        output.Line($"{posts.Count} post(s) to split (of {all.Count}); cap {budget.Max} AI calls; worst case {SplitFeedPostsPlan.WorstCaseCalls(posts.Count)} calls.");

        if (dryRun)
        {
            output.Table(["post id", "image"], posts.Select(p => (IReadOnlyList<string>)[p.Id, p.ImageUrls[0]]));
            output.Summary($"### split-feed-posts (dry run)\n\n**{posts.Count}** post(s) would be split; no AI call made (worst case {SplitFeedPostsPlan.WorstCaseCalls(posts.Count)}, cap {budget.Max}).\n");
            return new Result(posts.Count, 0, 0, posts.Count, 0, false);
        }

        var rows = new List<Row>();
        int written = 0, failed = 0, consecutive = 0;
        var capReached = false;
        string? stopped = null;
        foreach (var post in posts)
        {
            // Room for the detection and at least one cleanup, or the post is not started at all.
            if (budget.Remaining < 2)
            {
                capReached = true;
                break;
            }
            var before = budget.Used;
            try
            {
                var (pieces, outcome, overCap) = await SplitOneAsync(post, budget, ct);
                rows.Add(new Row(post.Id, pieces, budget.Used - before, outcome));
                if (overCap)
                {
                    capReached = true;
                    break;
                }
                if (pieces > 0)
                    written++;
                else
                    failed++;
                consecutive = 0;
            }
            catch (Exception ex) when (ex is AiProviderException or HttpRequestException or AmazonS3Exception or TaskCanceledException && !ct.IsCancellationRequested)
            {
                // Never retried: reported, skipped. Calls already made stay counted.
                failed++;
                rows.Add(new Row(post.Id, 0, budget.Used - before, $"failed: {ex.GetType().Name}: {Short(ex.Message)}"));
                if (++consecutive >= SplitFeedPostsPlan.MaxConsecutiveFailures)
                {
                    stopped = $"{consecutive} posts failed in a row — run stopped";
                    break;
                }
            }
        }

        var notStarted = posts.Count - rows.Count(r => !r.Outcome.StartsWith("cap reached", StringComparison.Ordinal));
        output.Table(["post id", "pieces", "calls", "outcome"], rows.Select(r => (IReadOnlyList<string>)[r.PostId, r.Pieces.ToString(), r.Calls.ToString(), r.Outcome]));
        var note = (capReached ? $" Cap reached: {notStarted} post(s) left for another run." : "") + (stopped is null ? "" : $" {stopped}; {notStarted} post(s) left.");
        output.Line($"Total AI calls: {budget.Used} of {budget.Max}.{note}");
        output.Summary($"### split-feed-posts\n\n**{written}** of {posts.Count} post(s) split, {failed} failed. **Total AI calls: {budget.Used}** (cap {budget.Max}).{note}\n");
        return new Result(posts.Count, written, failed, notStarted, budget.Used, capReached);
    }

    /// <summary>One post. Pieces 0 = failed (or, with OverCap, stopped before any cleanup: nothing written).</summary>
    private async Task<(int Pieces, string Outcome, bool OverCap)> SplitOneAsync(FeedPostEntity post, AiCallBudget budget, CancellationToken ct)
    {
        var url = post.ImageUrls[0].Trim();
        if (SplitFeedPostsPlan.KeyOf(url, store.BaseUrl) is not { } key)
            return (0, "failed: the image is not in the catalog bucket", false);
        var raw = await store.ReadAsync(key, maxImageBytes, ct);
        var clean = raw is null ? null : ImageMetadataStripper.Strip(raw);
        if (clean is null)
            return (0, "failed: the image is missing, too large or not an image", false);
        var photo = new ImageInput(clean.Data, clean.ContentType);
        if (cropper.Measure(photo) is not { } size)
            return (0, "failed: the image cannot be decoded", false);

        budget.TryTake();
        var found = ItemDetectionGuard.Filter(await detector.DetectItemsAsync(photo, "tr", Segment.Women, ct), SplitFeedPostsPlan.MaxPiecesPerPhoto);
        var crops = new List<(ItemCategory Category, ItemCategoryHint? Hint, string? Subcategory, ImageInput Crop)>();
        foreach (var item in found)
        {
            if (ItemDetectionGuard.Fields(item, confidenceThreshold).Category is not { } category)
                continue;
            var subcategory = ItemDetectionGuard.Subcategory(item, category);
            if (cropper.Crop(photo, CropMath.Plan(item.Box, size, CropMath.IsSmall(item.Box, subcategory))) is { } crop)
                crops.Add((category, item.Garment.Category, subcategory, crop));
        }
        if (crops.Count == 0)
            return (0, "failed: no piece detected", false);
        if (crops.Count > budget.Remaining)
            return (0, $"cap reached: {crops.Count} piece(s) detected, {budget.Remaining} call(s) left — not written", true);

        var images = new List<(ItemCategory Category, string? Subcategory, byte[] Data, string ContentType)>();
        var dropped = 0;
        foreach (var (category, hint, subcategory, crop) in crops)
        {
            budget.TryTake();
            ImageInput cleaned;
            try
            {
                cleaned = await cleanup.CleanupItemAsync(crop, hint, subcategory, ct);
            }
            catch (Exception ex) when (ex is AiProviderException or HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                // Not retried: the piece is left out, the others are kept.
                dropped++;
                output.Error($"{post.Id}: cleanup of a {category} piece failed ({ex.GetType().Name}: {Short(ex.Message)})");
                continue;
            }
            var webp = thumbnailer.ToWebp(cleaned.Data, SplitFeedPostsPlan.PieceMaxSide);
            images.Add(webp is null ? (category, subcategory, cleaned.Data, cleaned.ContentType) : (category, subcategory, webp, "image/webp"));
        }
        if (images.Count == 0)
            throw new AiProviderException($"every cleanup failed ({dropped} piece(s))");

        var pieces = new List<FeedPostPiece>(images.Count);
        foreach (var (category, subcategory, data, contentType) in images)
        {
            var pieceKey = SplitFeedPostsPlan.PieceKey(post.Id, pieces.Count + 1, SplitFeedPostsPlan.ExtensionOf(contentType));
            await store.PutAsync(pieceKey, data, contentType, ct);
            pieces.Add(new FeedPostPiece { Category = category, Subcategory = subcategory, ImageUrl = $"{store.BaseUrl.TrimEnd('/')}/{pieceKey}", ColorId = PieceColorReader.Read(data) });
        }

        var write = await feed.SetPostPiecesAsync(post.Id, url, pieces, ct);
        if (write != FeedPiecesOutcome.Written)
            return (0, $"failed: not written ({write}: the post changed meanwhile)", false);
        return (pieces.Count, dropped == 0 ? "written" : $"written ({dropped} piece(s) left out: cleanup failed)", false);
    }

    private static string Short(string text) => text.Length > 200 ? text[..200] + "…" : text;
}

/// <summary>
/// color-feed-pieces [--only id,id] [--dry-run] [--force]: the pieces of editor posts get their colour (owner decision
/// 2026-11-23: a piece saved from a post must not be "other"). Every piece picture is read from the catalog bucket and
/// its reference colour is read from the pixels (DominantColor) — no AI call. Only pieces without a colour are read
/// unless --force. Nothing else of the post is touched. Dev only.
/// </summary>
internal static class ColorFeedPiecesCommand
{
    public static Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct) =>
        ColorAsync(
            services.GetRequiredService<IRepository>(),
            services.GetRequiredService<IFeedService>(),
            new S3CatalogImageStore(services.GetRequiredService<IAmazonS3>(), OpsHost.CatalogBucket(args.Stage), OpsHost.CatalogBaseUrl(args.Stage)),
            PieceColorReader.Read,
            services.GetRequiredService<IOptionsMonitor<PhotoOptions>>().CurrentValue.MaxUploadBytes,
            args.OnlyIds, args.DryRun, args.Force, output, ct);

    public static async Task<int> ColorAsync(IRepository repository, IFeedService feed, ICatalogImageStore store, Func<byte[], string?> read, long maxBytes,
        IReadOnlyList<string> only, bool dryRun, bool force, OpsOutput output, CancellationToken ct)
    {
        var posts = (await repository.GetAllAsync<FeedPostEntity>(FeedPostEntity.GetPk(), ct))
            .Where(p => !p.Retired && p.Pieces.Count > 0 && (only.Count == 0 || only.Contains(p.Id)) && (force || p.Pieces.Any(x => x.ColorId is null)))
            .OrderBy(p => p.Id, StringComparer.Ordinal)
            .ToList();
        var rows = new List<IReadOnlyList<string>>();
        int colored = 0, unread = 0, failed = 0;
        foreach (var post in posts)
        {
            var pieces = new List<FeedPostPiece>(post.Pieces.Count);
            foreach (var piece in post.Pieces)
            {
                var color = piece.ColorId;
                if (color is null || force)
                {
                    var raw = SplitFeedPostsPlan.KeyOf(piece.ImageUrl, store.BaseUrl) is { } key ? await store.ReadAsync(key, maxBytes, ct) : null;
                    color = raw is null ? null : read(raw);
                    if (color is null)
                        unread++;
                    else
                        colored++;
                }
                pieces.Add(new FeedPostPiece { Category = piece.Category, Subcategory = piece.Subcategory, ImageUrl = piece.ImageUrl, ColorId = color ?? piece.ColorId });
            }
            var outcome = "would be written";
            if (!dryRun)
            {
                var write = await feed.SetPostPiecesAsync(post.Id, post.ImageUrls[0], pieces, ct);
                outcome = write.ToString();
                if (write != FeedPiecesOutcome.Written)
                    failed++;
            }
            rows.Add([post.Id, post.Title.GetValueOrDefault("tr") ?? "", post.Occasion.ToString(), string.Join(", ", pieces.Select(p => $"{p.Subcategory ?? p.Category.ToString()}: {p.ColorId ?? "—"}")), outcome]);
        }
        output.Table(["post id", "title", "occasion", "pieces", "outcome"], rows);
        output.Summary($"### color-feed-pieces{(dryRun ? " (dry run)" : "")}\n\n**{colored}** piece colour(s) read in {posts.Count} post(s); {unread} picture(s) unreadable; {failed} post(s) not written. No AI call.\n");
        return failed == 0 ? 0 : 1;
    }
}

/// <summary>
/// seed-feed-stories --ids a,b,c: Akış editor stories from existing editor posts, through the admin feed service. Story
/// "story-{postId}": "Droblet Edit", the post's first image, its title as the headline, no product, published now, gone in
/// seven days. Idempotent (the same id is written again, with a fresh week). Dev only; no AI call.
/// </summary>
internal static class SeedFeedStoriesCommand
{
    public const int Days = 7;

    public static string StoryId(string postId) => "story-" + postId.ToLowerInvariant();

    /// <summary>The story of a post; null when the post has no image or no title.</summary>
    public static FeedStoryInput? StoryOf(FeedPostEntity post, DateTime nowUtc)
    {
        var image = post.ImageUrls.FirstOrDefault()?.Trim();
        var titles = post.Title.Where(t => !string.IsNullOrWhiteSpace(t.Value)).ToDictionary(t => t.Key, t => t.Value.Trim());
        if (string.IsNullOrEmpty(image) || titles.Count == 0)
            return null;
        // Both languages, like the posts of seed-feed-posts: a missing one takes the other's text.
        var fallback = titles.GetValueOrDefault("tr") ?? titles.Values.First();
        var headline = new Dictionary<string, string> { ["tr"] = titles.GetValueOrDefault("tr") ?? fallback, ["en"] = titles.GetValueOrDefault("en") ?? fallback };
        return new FeedStoryInput(
            StoryId(post.Id), post.Segment,
            new FeedStoryAuthorInput(new Dictionary<string, string> { ["tr"] = "Droblet Edit", ["en"] = "Droblet Edit" }, null),
            image, headline, null, nowUtc, nowUtc.AddDays(Days), 0, Published: true);
    }

    public static Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct) =>
        SeedAsync(services.GetRequiredService<IRepository>(), services.GetRequiredService<IFeedService>(), args.Ids, args.DryRun, DateTime.UtcNow, output, ct);

    public static async Task<int> SeedAsync(IRepository repository, IFeedService feed, IReadOnlyList<string> ids, bool dryRun, DateTime nowUtc, OpsOutput output, CancellationToken ct)
    {
        var rows = new List<IReadOnlyList<string>>();
        var failed = 0;
        foreach (var id in ids)
        {
            var post = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(id), ct);
            var story = post is null || post.Retired ? null : StoryOf(post, nowUtc);
            if (story is null)
            {
                failed++;
                rows.Add([id, StoryId(id), post is null ? "post not found" : "post retired, or without image / title"]);
                continue;
            }
            if (dryRun)
            {
                rows.Add([id, story.Id, "would be written"]);
                continue;
            }
            var (outcome, _, _) = await feed.UpsertStoryAsync(story, ct);
            if (outcome is not (CatalogWriteOutcome.Created or CatalogWriteOutcome.Updated))
                failed++;
            rows.Add([id, story.Id, outcome.ToString()]);
        }
        output.Table(["post id", "story id", "outcome"], rows);
        output.Summary($"### seed-feed-stories{(dryRun ? " (dry run)" : "")}\n\n**{ids.Count - failed}** of {ids.Count} stories {(dryRun ? "would be written" : "written")} (visible for {Days} days).\n");
        return failed == 0 ? 0 : 1;
    }
}
