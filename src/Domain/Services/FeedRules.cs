using System.Globalization;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Validation;

namespace Domain.Services;

/// <summary>Akış F1 visibility, order, paging and "you already own something similar" — pure, shared by the service and tests.</summary>
public static class FeedRules
{
    /// <summary>Published, not retired and its publish time has come.</summary>
    public static bool IsLive(FeedPostEntity post, DateTime nowUtc) => post is { Published: true, Retired: false } && post.PublishAt <= nowUtc;

    /// <summary>Published, not retired, inside its window [publishAt, expiresAt).</summary>
    public static bool IsActive(FeedStoryEntity story, DateTime nowUtc) =>
        story is { Published: true, Retired: false } && story.PublishAt <= nowUtc && (story.ExpiresAt is null || story.ExpiresAt > nowUtc);

    /// <summary>A post / story without a segment goes to everyone; otherwise only to users of that segment.</summary>
    public static bool Shows(Segment? contentSegment, Segment userSegment) => contentSegment is null || contentSegment == userSegment;

    /// <summary>Feed order: publishAt desc, then sortOrder asc, then id (stable).</summary>
    public static IOrderedEnumerable<FeedPostEntity> Order(IEnumerable<FeedPostEntity> posts) =>
        posts.OrderByDescending(p => p.PublishAt).ThenBy(p => p.SortOrder).ThenBy(p => p.Id, StringComparer.Ordinal);

    /// <summary>Story strip order: sortOrder asc (editors pin), then publishAt desc, then id.</summary>
    public static IOrderedEnumerable<FeedStoryEntity> Order(IEnumerable<FeedStoryEntity> stories) =>
        stories.OrderBy(s => s.SortOrder).ThenByDescending(s => s.PublishAt).ThenBy(s => s.Id, StringComparer.Ordinal);

    /// <summary>Opaque cursor of the last post of a page: "{publishAt ticks}|{sortOrder}|{id}".</summary>
    public static string Cursor(FeedPostEntity post) =>
        CatalogRules.EncodeToken(string.Create(CultureInfo.InvariantCulture, $"{post.PublishAt.Ticks}|{post.SortOrder}|{post.Id}"));

    /// <summary>
    /// One page of an already ordered list after <paramref name="pageToken"/>. The cursor is a position, not an index, so a
    /// post retired or added meanwhile never shifts the next page. An unreadable token starts from the top.
    /// </summary>
    public static (IReadOnlyList<FeedPostEntity> Page, string? Next) Page(IReadOnlyList<FeedPostEntity> ordered, string? pageToken, int pageSize)
    {
        var start = 0;
        if (CatalogRules.DecodeToken(pageToken)?.Split('|', 3) is [var ticksText, var sortText, var id]
            && long.TryParse(ticksText, NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
            && int.TryParse(sortText, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var sort))
        {
            start = ordered.Count;
            for (var i = 0; i < ordered.Count; i++)
            {
                if (IsAfter(ordered[i], ticks, sort, id))
                {
                    start = i;
                    break;
                }
            }
        }

        var size = Math.Max(1, pageSize);
        var page = ordered.Skip(start).Take(size).ToList();
        var next = page.Count > 0 && start + page.Count < ordered.Count ? Cursor(page[^1]) : null;
        return (page, next);
    }

    private static bool IsAfter(FeedPostEntity post, long ticks, int sortOrder, string id)
    {
        if (post.PublishAt.Ticks != ticks)
            return post.PublishAt.Ticks < ticks;
        if (post.SortOrder != sortOrder)
            return post.SortOrder > sortOrder;
        return string.CompareOrdinal(post.Id, id) > 0;
    }

    /// <summary>
    /// "Benzeri gardırobunda var". There is no server-side wardrobe ↔ product similarity yet (the edit screen's "hide what I
    /// own" is client-side and exact: an item added from that product), so: the same product (item.productId), or a piece of
    /// the same wardrobe category whose main colour is one of the product's colours.
    /// </summary>
    public static bool OwnsSimilar(ProductDto product, IReadOnlyList<ItemEntity> wardrobe)
    {
        var category = CatalogRules.ItemCategoryOf(product.Category);
        var colors = product.Colors.Select(CatalogRules.NormalizeColor).ToHashSet(StringComparer.Ordinal);
        return wardrobe.Any(item =>
            string.Equals(item.ProductId, product.Id, StringComparison.Ordinal)
            || (item.Category == category && item.ColorIds.Count > 0 && colors.Contains(CatalogRules.NormalizeColor(item.ColorIds[0]))));
    }

    /// <summary>Available and not owned (the buy button counts these).</summary>
    public static int BuyableCount(IEnumerable<FeedProductDto> products) => products.Count(p => p is { Available: true, OwnedSimilar: false });

    /// <summary>
    /// The occasion filter of GET v1/content/feed: one or more comma-separated wire names of Occasion (the app's "Davet" tab
    /// sends "dinner,wedding", owner decision 2026-11-22). Empty = no filter (null). False = any part unparsable.
    /// </summary>
    public static bool TryParseOccasions(string? value, out IReadOnlySet<Occasion>? occasions)
    {
        occasions = null;
        if (string.IsNullOrWhiteSpace(value))
            return true;
        var set = new HashSet<Occasion>();
        foreach (var part in value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (int.TryParse(part, out _) || !System.Enum.TryParse<Occasion>(part, ignoreCase: true, out var parsed) || !System.Enum.IsDefined(parsed))
                return false;
            set.Add(parsed);
        }
        if (set.Count == 0)
            return false;
        occasions = set;
        return true;
    }

    /// <summary>Stored times are UTC; an unspecified kind from a body is read as UTC.</summary>
    public static DateTime Utc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };
}

public enum FeedWriteOutcome { Ok, NotFound }

/// <summary>Akış F1: editor posts and stories (app reads, likes, saves) and their admin CRUD.</summary>
public interface IFeedService
{
    Task<PagedDto<FeedPostDto>> GetFeedAsync(string tenantId, IReadOnlySet<Occasion>? occasions, string? pageToken, CancellationToken ct);
    Task<IReadOnlyList<FeedStoryDto>> GetStoriesAsync(string tenantId, CancellationToken ct);
    /// <summary>Null = no such live post (unknown, draft, scheduled or retired).</summary>
    Task<FeedLikeDto?> LikeAsync(string tenantId, string postId, CancellationToken ct);
    Task<FeedLikeDto?> UnlikeAsync(string tenantId, string postId, CancellationToken ct);
    Task<FeedWriteOutcome> SaveAsync(string tenantId, string postId, CancellationToken ct);
    Task UnsaveAsync(string tenantId, string postId, CancellationToken ct);
    Task<IReadOnlyList<FeedPostDto>> GetSavedAsync(string tenantId, CancellationToken ct);

    // Admin / seed
    Task<IReadOnlyList<AdminFeedPostDto>> ListPostsAsync(CancellationToken ct);
    Task<AdminFeedPostDto?> GetPostAsync(string postId, CancellationToken ct);
    Task<(CatalogWriteOutcome Outcome, AdminFeedPostDto? Post, IReadOnlyList<string> MissingProductIds)> UpsertPostAsync(FeedPostInput input, CancellationToken ct);
    Task<bool> RetirePostAsync(string postId, CancellationToken ct);
    Task<IReadOnlyList<AdminFeedStoryDto>> ListStoriesAsync(CancellationToken ct);
    Task<(CatalogWriteOutcome Outcome, AdminFeedStoryDto? Story, IReadOnlyList<string> MissingProductIds)> UpsertStoryAsync(FeedStoryInput input, CancellationToken ct);
    Task<bool> RetireStoryAsync(string storyId, CancellationToken ct);
}
