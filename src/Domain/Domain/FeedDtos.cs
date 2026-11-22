using Domain.Entity;
using Domain.Enum;
using Domain.Validation;

namespace Domain.Domain;

// Akış F1 wire shapes (docs/api/store-social-settings.md §2b). Text is resolved to the request language.

/// <param name="Verified">Only Droblet's own content (kind edit) carries the verified badge; selected stylists do not (owner decision 2026-11-22).</param>
public record FeedAuthorDto(FeedAuthorKind Kind, string Name, string? Handle, string? ImageUrl, bool Verified);

/// <summary>ProductDto plus <c>ownedSimilar</c>: the caller's wardrobe already has this product or a similar piece (FeedRules.OwnsSimilar).</summary>
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
    bool OwnedSimilar)
    : ProductDto(Id, BrandId, BrandName, Name, Description, Category, Slot, Colors, Sizes, PriceMinor, Currency, PreviousPriceMinor, PriceBand, Images,
        Available, CreatedAt, Segment)
{
    public static FeedProductDto From(ProductDto p, bool ownedSimilar) => new(
        p.Id, p.BrandId, p.BrandName, p.Name, p.Description, p.Category, p.Slot, p.Colors, p.Sizes, p.PriceMinor, p.Currency, p.PreviousPriceMinor,
        p.PriceBand, p.Images, p.Available, p.CreatedAt, p.Segment, ownedSimilar);
}

/// <param name="BuyableCount">Products that are available and not ownedSimilar.</param>
public record FeedPostDto(
    string Id,
    FeedAuthorDto Author,
    Occasion Occasion,
    DateTime PublishedAt,
    string Title,
    string? Note,
    IReadOnlyList<string> Images,
    IReadOnlyList<FeedProductDto> Products,
    int BuyableCount,
    long LikeCount,
    bool Liked,
    bool Saved);

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
