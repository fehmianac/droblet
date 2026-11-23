using Domain.Entity;
using Domain.Enum;
using Domain.Validation;

namespace Domain.Domain;

// Akış F1 wire shapes (docs/api/store-social-settings.md §2b). Text is resolved to the request language.

/// <param name="Verified">Only Droblet's own content (kind edit) carries the verified badge; selected stylists do not (owner decision 2026-11-22).</param>
public record FeedAuthorDto(FeedAuthorKind Kind, string Name, string? Handle, string? ImageUrl, bool Verified);

/// <summary>
/// ProductDto plus <c>ownedSimilar</c>: the caller's wardrobe already has this product or a similar piece, and
/// <c>ownedItemId</c>: that wardrobe item (FeedRules.OwnedItem; null when ownedSimilar is false) — "Kendi parçalarımla kur".
/// </summary>
public record FeedProductDto(
    string Id,
    string BrandId,
    string BrandName,
    string Name,
    string? Description,
    ProductCategory Category,
    ProductSlot Slot,
    IReadOnlyList<string> Colors,
    IReadOnlyList<string> Sizes,
    long PriceMinor,
    string Currency,
    long? PreviousPriceMinor,
    PriceBand PriceBand,
    IReadOnlyList<string> Images,
    bool Available,
    DateTime CreatedAt,
    CatalogSegment Segment,
    bool OwnedSimilar,
    string? OwnedItemId = null)
    : ProductDto(Id, BrandId, BrandName, Name, Description, Category, Slot, Colors, Sizes, PriceMinor, Currency, PreviousPriceMinor, PriceBand, Images,
        Available, CreatedAt, Segment)
{
    public static FeedProductDto From(ProductDto p, bool ownedSimilar, string? ownedItemId = null) => new(
        p.Id, p.BrandId, p.BrandName, p.Name, p.Description, p.Category, p.Slot, p.Colors, p.Sizes, p.PriceMinor, p.Currency, p.PreviousPriceMinor,
        p.PriceBand, p.Images, p.Available, p.CreatedAt, p.Segment, ownedSimilar, ownedSimilar ? ownedItemId : null);
}

/// <summary>A piece of a shared look as others see it: the kind and the cleaned image only (never the original photo, name or id).</summary>
/// <param name="Subcategory">The item's sub-type id when it has one ("sweater"), so the app can label the piece more precisely than its category; null otherwise (and for catalog pieces).</param>
public record FeedPieceDto(ItemCategory Category, string? ImageUrl, string? Subcategory = null);

/// <summary>
/// One Akış item. kind editor = admin content (also the weekly-edit fallback); kind user = a look shared by its owner
/// (Akış F2): author = @handle + avatar, images = the look's AI flat-lay cover (presigned), products empty, pieces filled.
/// </summary>
/// <param name="Occasion">Null when a shared look (or a fallback edit look) has no occasion; such items match no occasion filter.</param>
/// <param name="BuyableCount">Products that are available and not ownedSimilar.</param>
/// <param name="ImagesExpireAt">User posts: when a presigned cover URL stops working (re-read the feed); null for editor posts and for a public cover URL (decision 22), which does not expire.</param>
public record FeedPostDto(
    FeedPostKind Kind,
    string Id,
    FeedAuthorDto Author,
    Occasion? Occasion,
    DateTime PublishedAt,
    string Title,
    string? Note,
    IReadOnlyList<string> Images,
    IReadOnlyList<FeedProductDto> Products,
    int BuyableCount,
    IReadOnlyList<FeedPieceDto> Pieces,
    bool HasSimilar,
    bool CanTryOn,
    long LikeCount,
    bool Liked,
    bool Saved,
    DateTime? ImagesExpireAt = null);

/// <summary>LookDto.feedStats of a shared look (owner only).</summary>
public record FeedStatsDto(long LikeCount, long SaveCount);

public record FeedStoryAuthorDto(string Name, string? ImageUrl);

public record FeedStoryDto(string Id, FeedStoryAuthorDto Author, string ImageUrl, string Headline, ProductDto? Product, DateTime PublishedAt);

/// <summary>PUT / DELETE v1/tenant/feed-post/{id}/like.</summary>
public record FeedLikeDto(bool Liked, long LikeCount);

// Admin -------------------------------------------------------------------------------------------------------

public record AdminFeedPostDto(
    string Id, Segment? Segment, FeedAuthorInput Author, Occasion Occasion, IReadOnlyDictionary<string, string> Title, IReadOnlyDictionary<string, string>? Note,
    IReadOnlyList<string> ImageUrls, IReadOnlyList<string> ProductIds, DateTime PublishAt, int SortOrder, bool Published, bool Retired, long LikeCount,
    DateTime CreatedAt, DateTime UpdatedAt);

public record AdminFeedStoryDto(
    string Id, Segment? Segment, FeedStoryAuthorInput Author, string ImageUrl, IReadOnlyDictionary<string, string> Headline, string? ProductId,
    DateTime PublishAt, DateTime? ExpiresAt, int SortOrder, bool Published, bool Retired, DateTime CreatedAt, DateTime UpdatedAt);

public static class FeedDtoMapper
{
    public static AdminFeedPostDto ToAdminDto(this FeedPostEntity p, long likeCount) => new(
        p.Id, p.Segment, new FeedAuthorInput(p.Author.Kind, p.Author.Name, p.Author.Handle, p.Author.ImageUrl), p.Occasion, p.Title, p.Note,
        p.ImageUrls, p.ProductIds, p.PublishAt, p.SortOrder, p.Published, p.Retired, likeCount, p.CreatedAt, p.UpdatedAt);

    public static AdminFeedStoryDto ToAdminDto(this FeedStoryEntity s) => new(
        s.Id, s.Segment, new FeedStoryAuthorInput(s.Author.Name, s.Author.ImageUrl), s.ImageUrl, s.Headline, s.ProductId, s.PublishAt, s.ExpiresAt,
        s.SortOrder, s.Published, s.Retired, s.CreatedAt, s.UpdatedAt);
}

/// <summary>A report of a shared look as the admin list shows it.</summary>
public record AdminFeedReportDto(string Id, ReportStatus Status, ReportReason Reason, string? Note, string? ReporterTenantId, string? ReporterHandle, DateTime CreatedAt);

public record AdminFeedReasonCountDto(ReportReason Reason, int Count);

/// <summary>
/// GET v1/admin/feed-user-post: a shared look that was reported or auto-hidden. status = reported (still in the feed) |
/// autoHidden (taken off the feed by ContentFeed:ReportsToAutoHide distinct reporters). reporterCount = distinct reporters
/// of the open reports; reasons / reports = those open reports.
/// </summary>
public record AdminFeedUserPostDto(
    string Id, string OwnerTenantId, string? OwnerHandle, string LookId, string? LookName, Occasion? Occasion, string? ImageUrl, DateTime SharedAt,
    string Status, int ReporterCount, IReadOnlyList<AdminFeedReasonCountDto> Reasons, IReadOnlyList<AdminFeedReportDto> Reports,
    DateTime? HiddenAt, DateTime? RestoredAt, long LikeCount, bool InvolvesTeen);
