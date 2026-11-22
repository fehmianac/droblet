using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Validation;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Store;

/// <summary>
/// Akış F1 (decisions 16–19): editor posts and stories, likes and saves. The post / story partitions are small and
/// admin-managed, so they are read whole and filtered in memory (same as the weekly edits); product rows resolve from the
/// cached catalog on read. No comments, no shares, no follows — by decision, not by omission.
/// </summary>
public sealed class FeedService(
    IRepository repository,
    ICatalogService catalog,
    IRequestLanguage requestLanguage,
    IOptionsMonitor<ContentFeedOptions> options,
    TimeProvider timeProvider) : IFeedService
{
    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    // ── App ─────────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<PagedDto<FeedPostDto>> GetFeedAsync(string tenantId, IReadOnlySet<Occasion>? occasions, string? pageToken, CancellationToken ct)
    {
        var now = Now;
        var segment = await SegmentAsync(tenantId, ct);
        var ordered = FeedRules.Order((await AllPostsAsync(ct))
                .Where(p => FeedRules.IsLive(p, now) && FeedRules.Shows(p.Segment, segment) && (occasions is null || occasions.Contains(p.Occasion))))
            .ToList();
        var (page, next) = FeedRules.Page(ordered, pageToken, options.CurrentValue.PageSize);
        return new PagedDto<FeedPostDto>(await ToDtosAsync(tenantId, page, ct), next);
    }

    public async Task<IReadOnlyList<FeedStoryDto>> GetStoriesAsync(string tenantId, CancellationToken ct)
    {
        var now = Now;
        var segment = await SegmentAsync(tenantId, ct);
        var stories = FeedRules.Order((await repository.GetAllAsync<FeedStoryEntity>(FeedStoryEntity.GetPk(), ct))
                .Where(s => FeedRules.IsActive(s, now) && FeedRules.Shows(s.Segment, segment)))
            .Take(Math.Max(1, options.CurrentValue.MaxStories))
            .ToList();

        var language = await requestLanguage.GetAsync(ct);
        var products = (await catalog.ToDtosAsync(stories.Select(s => s.ProductId).OfType<string>().Distinct(), ct)).ToDictionary(p => p.Id);
        return stories.Select(s => new FeedStoryDto(
            s.Id,
            new FeedStoryAuthorDto(Text(s.Author.Name, language) ?? "", s.Author.ImageUrl),
            s.ImageUrl,
            Text(s.Headline, language) ?? "",
            s.ProductId is not null && products.TryGetValue(s.ProductId, out var product) ? product : null,
            s.PublishAt)).ToList();
    }

    public async Task<FeedLikeDto?> LikeAsync(string tenantId, string postId, CancellationToken ct)
    {
        if (await LivePostAsync(postId, ct) is null)
            return null;
        var count = await FeedLikeCounter.LikeAsync(repository, tenantId, postId, Now, options.CurrentValue.LikeRetries, ct);
        return new FeedLikeDto(true, count);
    }

    public async Task<FeedLikeDto?> UnlikeAsync(string tenantId, string postId, CancellationToken ct)
    {
        if (await LivePostAsync(postId, ct) is null)
            return null;
        var count = await FeedLikeCounter.UnlikeAsync(repository, tenantId, postId, Now, options.CurrentValue.LikeRetries, ct);
        return new FeedLikeDto(false, count);
    }

    public async Task<FeedWriteOutcome> SaveAsync(string tenantId, string postId, CancellationToken ct)
    {
        if (await LivePostAsync(postId, ct) is null)
            return FeedWriteOutcome.NotFound;
        // Idempotent: saving again keeps the first savedAt (the list order does not jump).
        if (await repository.GetAsync<FeedSaveEntity>(FeedSaveEntity.GetPk(tenantId), FeedSaveEntity.GetSk(postId), ct) is null)
            await repository.SaveAsync(new FeedSaveEntity { TenantId = tenantId, PostId = postId, SavedAt = Now }, ct);
        return FeedWriteOutcome.Ok;
    }

    public Task UnsaveAsync(string tenantId, string postId, CancellationToken ct) =>
        repository.DeleteAsync(FeedSaveEntity.GetPk(tenantId), FeedSaveEntity.GetSk(postId), ct);

    public async Task<IReadOnlyList<FeedPostDto>> GetSavedAsync(string tenantId, CancellationToken ct)
    {
        var now = Now;
        var saves = (await repository.GetAllAsync<FeedSaveEntity>(FeedSaveEntity.GetPk(tenantId), ct))
            .OrderByDescending(s => s.SavedAt).ThenByDescending(s => s.PostId, StringComparer.Ordinal).ToList();
        if (saves.Count == 0)
            return [];
        var posts = (await AllPostsAsync(ct)).ToDictionary(p => p.Id, StringComparer.Ordinal);
        var live = saves.Select(s => posts.GetValueOrDefault(s.PostId)).OfType<FeedPostEntity>().Where(p => FeedRules.IsLive(p, now)).ToList();
        return await ToDtosAsync(tenantId, live, ct);
    }

    private async Task<IReadOnlyList<FeedPostDto>> ToDtosAsync(string tenantId, IReadOnlyList<FeedPostEntity> posts, CancellationToken ct)
    {
        if (posts.Count == 0)
            return [];

        var language = await requestLanguage.GetAsync(ct);
        var ids = posts.Select(p => p.Id).ToList();
        var stats = (await repository.BatchGetAsync(ids.Select(id => new FeedPostStatsEntity { PostId = id }).ToList(), ct)).ToDictionary(s => s.PostId);
        var liked = (await repository.BatchGetAsync(ids.Select(id => new FeedLikeEntity { TenantId = tenantId, PostId = id }).ToList(), ct))
            .Select(l => l.PostId).ToHashSet(StringComparer.Ordinal);
        var saved = (await repository.BatchGetAsync(ids.Select(id => new FeedSaveEntity { TenantId = tenantId, PostId = id }).ToList(), ct))
            .Select(s => s.PostId).ToHashSet(StringComparer.Ordinal);
        var wardrobe = posts.Any(p => p.ProductIds.Count > 0)
            ? await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenantId), ct)
            : [];

        var result = new List<FeedPostDto>(posts.Count);
        foreach (var post in posts)
        {
            var products = (await catalog.ToDtosAsync(post.ProductIds, ct))
                .Select(p => FeedProductDto.From(p, FeedRules.OwnsSimilar(p, wardrobe)))
                .ToList();
            result.Add(new FeedPostDto(
                post.Id,
                new FeedAuthorDto(post.Author.Kind, Text(post.Author.Name, language) ?? "", post.Author.Handle, post.Author.ImageUrl, Verified: post.Author.Kind == FeedAuthorKind.Edit),
                post.Occasion,
                post.PublishAt,
                Text(post.Title, language) ?? "",
                Text(post.Note, language),
                post.ImageUrls,
                products,
                FeedRules.BuyableCount(products),
                stats.TryGetValue(post.Id, out var s) ? Math.Max(0, s.LikeCount) : 0,
                liked.Contains(post.Id),
                saved.Contains(post.Id)));
        }
        return result;
    }

    private async Task<Segment> SegmentAsync(string tenantId, CancellationToken ct) =>
        (await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct))?.Segment ?? Segment.Women;

    private async Task<FeedPostEntity?> LivePostAsync(string postId, CancellationToken ct)
    {
        if (!FeedInputRules.IsId(postId))
            return null;
        var post = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(postId), ct);
        return post is not null && FeedRules.IsLive(post, Now) ? post : null;
    }

    private Task<List<FeedPostEntity>> AllPostsAsync(CancellationToken ct) => repository.GetAllAsync<FeedPostEntity>(FeedPostEntity.GetPk(), ct);

    private string? Text(IReadOnlyDictionary<string, string>? text, string language) => LocalizedText.Resolve(text, language, requestLanguage.Default);

    // ── Admin / seed ────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<AdminFeedPostDto>> ListPostsAsync(CancellationToken ct)
    {
        var posts = FeedRules.Order(await AllPostsAsync(ct)).ToList();
        var stats = (await repository.GetAllAsync<FeedPostStatsEntity>(FeedPostStatsEntity.GetPk(), ct)).ToDictionary(s => s.PostId);
        return posts.Select(p => p.ToAdminDto(stats.TryGetValue(p.Id, out var s) ? Math.Max(0, s.LikeCount) : 0)).ToList();
    }

    public async Task<AdminFeedPostDto?> GetPostAsync(string postId, CancellationToken ct)
    {
        var post = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(postId), ct);
        return post is null ? null : post.ToAdminDto(await LikeCountAsync(postId, ct));
    }

    public async Task<(CatalogWriteOutcome Outcome, AdminFeedPostDto? Post, IReadOnlyList<string> MissingProductIds)> UpsertPostAsync(FeedPostInput input, CancellationToken ct)
    {
        var productIds = (input.ProductIds ?? []).ToList();
        var missing = await MissingProductsAsync(productIds, ct);
        if (missing.Count > 0)
            return (CatalogWriteOutcome.ProductNotFound, null, missing);

        var now = Now;
        var existing = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(input.Id), ct);
        var author = input.Author!;
        var post = new FeedPostEntity
        {
            Id = input.Id,
            Segment = input.Segment,
            Author = new FeedAuthor
            {
                Kind = author.Kind,
                Name = LocalizedText.Normalize(author.Name),
                Handle = string.IsNullOrWhiteSpace(author.Handle) ? null : HandleRules.Normalize(author.Handle),
                ImageUrl = NullIfEmpty(author.ImageUrl),
            },
            Occasion = input.Occasion,
            Title = LocalizedText.Normalize(input.Title),
            Note = LocalizedText.NormalizeOptional(input.Note),
            ImageUrls = (input.ImageUrls ?? []).Select(u => u.Trim()).ToList(),
            ProductIds = productIds,
            PublishAt = FeedRules.Utc(input.PublishAt),
            SortOrder = input.SortOrder,
            Published = input.Published && !input.Retired,
            Retired = input.Retired,
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now,
        };
        await repository.SaveAsync(post, ct);
        return (existing is null ? CatalogWriteOutcome.Created : CatalogWriteOutcome.Updated, post.ToAdminDto(await LikeCountAsync(post.Id, ct)), []);
    }

    public async Task<bool> RetirePostAsync(string postId, CancellationToken ct)
    {
        var post = await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(postId), ct);
        if (post is null)
            return false;
        post.Retired = true;
        post.Published = false;
        post.UpdatedAt = Now;
        await repository.SaveAsync(post, ct);
        return true;
    }

    public async Task<IReadOnlyList<AdminFeedStoryDto>> ListStoriesAsync(CancellationToken ct) =>
        (await repository.GetAllAsync<FeedStoryEntity>(FeedStoryEntity.GetPk(), ct))
            .OrderByDescending(s => s.PublishAt).ThenBy(s => s.SortOrder).ThenBy(s => s.Id, StringComparer.Ordinal)
            .Select(s => s.ToAdminDto()).ToList();

    public async Task<(CatalogWriteOutcome Outcome, AdminFeedStoryDto? Story, IReadOnlyList<string> MissingProductIds)> UpsertStoryAsync(FeedStoryInput input, CancellationToken ct)
    {
        var productId = NullIfEmpty(input.ProductId);
        var missing = await MissingProductsAsync(productId is null ? [] : [productId], ct);
        if (missing.Count > 0)
            return (CatalogWriteOutcome.ProductNotFound, null, missing);

        var now = Now;
        var existing = await repository.GetAsync<FeedStoryEntity>(FeedStoryEntity.GetPk(), FeedStoryEntity.GetSk(input.Id), ct);
        var story = new FeedStoryEntity
        {
            Id = input.Id,
            Segment = input.Segment,
            Author = new FeedStoryAuthor { Name = LocalizedText.Normalize(input.Author!.Name), ImageUrl = NullIfEmpty(input.Author.ImageUrl) },
            ImageUrl = input.ImageUrl!.Trim(),
            Headline = LocalizedText.Normalize(input.Headline),
            ProductId = productId,
            PublishAt = FeedRules.Utc(input.PublishAt),
            ExpiresAt = input.ExpiresAt is { } expires ? FeedRules.Utc(expires) : null,
            SortOrder = input.SortOrder,
            Published = input.Published && !input.Retired,
            Retired = input.Retired,
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now,
        };
        await repository.SaveAsync(story, ct);
        return (existing is null ? CatalogWriteOutcome.Created : CatalogWriteOutcome.Updated, story.ToAdminDto(), []);
    }

    public async Task<bool> RetireStoryAsync(string storyId, CancellationToken ct)
    {
        var story = await repository.GetAsync<FeedStoryEntity>(FeedStoryEntity.GetPk(), FeedStoryEntity.GetSk(storyId), ct);
        if (story is null)
            return false;
        story.Retired = true;
        story.Published = false;
        story.UpdatedAt = Now;
        await repository.SaveAsync(story, ct);
        return true;
    }

    private async Task<long> LikeCountAsync(string postId, CancellationToken ct) =>
        Math.Max(0, (await repository.GetAsync<FeedPostStatsEntity>(FeedPostStatsEntity.GetPk(), FeedPostStatsEntity.GetSk(postId), ct))?.LikeCount ?? 0);

    private async Task<List<string>> MissingProductsAsync(IEnumerable<string> productIds, CancellationToken ct)
    {
        var missing = new List<string>();
        foreach (var id in productIds.Distinct())
        {
            if (await catalog.GetProductAsync(id, ct) is null)
                missing.Add(id);
        }
        return missing;
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

/// <summary>
/// The like ↔ counter pair, written together in one transaction: the tenant's FeedLike row (created / deleted with a
/// condition) and the post's versioned stats row. A lost race retries with fresh reads, so concurrent likes never lose a
/// count and a repeated like / unlike never counts twice. Shared with account deletion (ICrossTenantCleanup).
/// </summary>
public static class FeedLikeCounter
{
    public static async Task<long> LikeAsync(IRepository repository, string tenantId, string postId, DateTime now, int retries, CancellationToken ct)
    {
        for (var attempt = 0; attempt < Math.Max(1, retries); attempt++)
        {
            var stats = await StatsAsync(repository, postId, ct);
            if (await repository.GetAsync<FeedLikeEntity>(FeedLikeEntity.GetPk(tenantId), FeedLikeEntity.GetSk(postId), ct) is not null)
                return Math.Max(0, stats.LikeCount);

            stats.LikeCount = Math.Max(0, stats.LikeCount) + 1;
            stats.UpdatedAt = now;
            var result = await repository.TransactWriteAsync(
            [
                TransactWriteOperation.PutVersioned(stats),
                TransactWriteOperation.Create(new FeedLikeEntity { TenantId = tenantId, PostId = postId, LikedAt = now }),
            ], ct);
            if (result.Applied)
                return stats.LikeCount;
        }
        throw new InvalidOperationException("Feed like counter could not be updated after retries.");
    }

    public static async Task<long> UnlikeAsync(IRepository repository, string tenantId, string postId, DateTime now, int retries, CancellationToken ct)
    {
        for (var attempt = 0; attempt < Math.Max(1, retries); attempt++)
        {
            var stats = await StatsAsync(repository, postId, ct);
            if (await repository.GetAsync<FeedLikeEntity>(FeedLikeEntity.GetPk(tenantId), FeedLikeEntity.GetSk(postId), ct) is null)
                return Math.Max(0, stats.LikeCount);

            stats.LikeCount = Math.Max(0, stats.LikeCount - 1);
            stats.UpdatedAt = now;
            var result = await repository.TransactWriteAsync(
            [
                TransactWriteOperation.PutVersioned(stats),
                TransactWriteOperation.DeleteExisting(FeedLikeEntity.GetPk(tenantId), FeedLikeEntity.GetSk(postId)),
            ], ct);
            if (result.Applied)
                return stats.LikeCount;
        }
        throw new InvalidOperationException("Feed like counter could not be updated after retries.");
    }

    private static async Task<FeedPostStatsEntity> StatsAsync(IRepository repository, string postId, CancellationToken ct) =>
        await repository.GetAsync<FeedPostStatsEntity>(FeedPostStatsEntity.GetPk(), FeedPostStatsEntity.GetSk(postId), ct)
        ?? new FeedPostStatsEntity { PostId = postId };
}
