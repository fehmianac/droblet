using Domain.Entity;
using Domain.Enum;
using Domain.Validation;

namespace Domain.Domain;

// Admin responses: the request shape (see Domain.Validation inputs) plus server-kept fields.

public record AdminBrandDto(
    string Id, string Name, string? WebsiteUrl, string? LogoUrl, AffiliateSource Source, string? Network, string? CheckoutUrl,
    string? ClickIdParameter, int? CommissionRateBps, bool Retired, DateTime CreatedAt, DateTime UpdatedAt);

public record AdminProductDto(
    string Id, string BrandId, IReadOnlyDictionary<string, string> Name, IReadOnlyDictionary<string, string>? Description, ProductCategory Category, IReadOnlyList<string> Colors,
    IReadOnlyList<string> Sizes, long PriceMinor, string Currency, long? PreviousPriceMinor, DateTime? PriceChangedAt, PriceBand PriceBand,
    IReadOnlyList<string> Images, string? AffiliateUrl, AffiliateSource AffiliateSource, bool Retired, DateTime CreatedAt, DateTime UpdatedAt);

public record AdminProductWriteDto(AdminProductDto Product, bool Created, bool PriceDropped, int WatchersFlagged);

public record AdminEditDto(
    string Id, Segment Segment, string WeekStart, IReadOnlyDictionary<string, string> Title, IReadOnlyDictionary<string, string>? Subtitle, string? CoverImageUrl,
    IReadOnlyList<EditLookInput> Looks, string? SponsorBrandId, IReadOnlyDictionary<string, string>? SponsorName, bool Published, bool Retired, bool Sponsored,
    DateTime CreatedAt, DateTime UpdatedAt);

public record AdminCollectionDto(
    string Id, ContentCollectionKind Kind, IReadOnlyDictionary<string, string> Title, IReadOnlyDictionary<string, string>? Subtitle, string? ImageUrl, int SortOrder,
    IReadOnlyDictionary<string, string>? SponsorName, bool Retired, DateTime CreatedAt, DateTime UpdatedAt);

public record AdminCollectionLookDto(
    string Id, string CollectionId, IReadOnlyDictionary<string, string> Title, IReadOnlyDictionary<string, string>? Note, string? ImageUrl, IReadOnlyList<string> ProductIds, int SortOrder,
    bool Retired, DateTime CreatedAt, DateTime UpdatedAt);

public static class AdminDtoMapper
{
    public static AdminBrandDto ToAdminDto(this BrandEntity b) => new(
        b.Id, b.Name, b.WebsiteUrl, b.LogoUrl, b.Source, b.Network, b.CheckoutUrl, b.ClickIdParameter, b.CommissionRateBps, b.Retired, b.CreatedAt, b.UpdatedAt);

    public static AdminProductDto ToAdminDto(this CatalogProductEntity p) => new(
        p.Id, p.BrandId, p.Name, p.Description, p.Category, p.Colors, p.Sizes, p.PriceMinor, p.Currency, p.PreviousPriceMinor, p.PriceChangedAt,
        p.PriceBand, p.Images, p.AffiliateUrl, p.AffiliateSource, p.Retired, p.CreatedAt, p.UpdatedAt);

    public static AdminEditDto ToAdminDto(this WeeklyEditEntity e) => new(
        e.Id, e.Segment, e.WeekStart, e.Title, e.Subtitle, e.CoverImageUrl,
        e.Looks.OrderBy(l => l.Day).Select(l => new EditLookInput(l.Id, l.Day, l.Title, l.StyleNote, l.ImageUrl,
            l.Variants.Select(v => new EditLookVariantInput(v.PriceBand, v.ProductIds)).ToList())).ToList(),
        e.SponsorBrandId, e.SponsorName, e.Published, e.Retired, Services.WeeklyEditRules.IsSponsored(e), e.CreatedAt, e.UpdatedAt);

    public static AdminCollectionDto ToAdminDto(this ContentCollectionEntity c) => new(
        c.Id, c.Kind, c.Title, c.Subtitle, c.ImageUrl, c.SortOrder, c.SponsorName, c.Retired, c.CreatedAt, c.UpdatedAt);

    public static AdminCollectionLookDto ToAdminDto(this ContentLookEntity l) => new(
        l.Id, l.CollectionId, l.Title, l.Note, l.ImageUrl, l.ProductIds, l.SortOrder, l.Retired, l.CreatedAt, l.UpdatedAt);
}
