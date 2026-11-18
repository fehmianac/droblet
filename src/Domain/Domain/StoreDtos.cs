using Domain.Entity;
using Domain.Enum;
using Domain.Services;

namespace Domain.Domain;

public record BrandDto(string Id, string Name, string? LogoUrl, string? WebsiteUrl);

/// <summary>Public product shape. The affiliate link is never here — it is only returned by checkout, with a click id.</summary>
public record ProductDto(
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
    DateTime CreatedAt);

public record LookRefDto(LookRefKind Kind, string Id);

public record EditVariantDto(PriceBand PriceBand, IReadOnlyList<ProductDto> Products, long TotalMinor, string Currency);

public record EditLookDto(string Id, int Day, string Title, string? StyleNote, string? ImageUrl, IReadOnlyList<EditVariantDto> Variants);

public record EditDto(
    string Id,
    string Title,
    string? Subtitle,
    string? CoverImageUrl,
    string WeekStart,
    string WeekEnd,
    Segment Segment,
    bool Sponsored,
    string? SponsorName,
    IReadOnlyList<EditLookDto> Looks);

public record ContentCollectionDto(string Id, ContentCollectionKind Kind, string Title, string? Subtitle, string? ImageUrl, bool Sponsored, string? SponsorName);

public record ContentLookDto(string Id, string CollectionId, string Title, string? Note, string? ImageUrl, IReadOnlyList<ProductDto> Products, long TotalMinor, string Currency);

public record ClosetItemDto(string Id, string Name, ItemCategory Category, IReadOnlyList<string> Colors, string? ImageUrl);

public record ProductMatchDto(string ProductId, int CompatibleCount, IReadOnlyList<ClosetItemDto> Items);

public record CompleteSlotDto(ProductSlot Slot, IReadOnlyList<ProductDto> Products);

public record CompleteLookDto(IReadOnlyList<CompleteSlotDto> Slots);

public record CartLineDto(string LineId, ProductDto Product, string Size, LookRefDto? Look, DateTime AddedAt);

public record CartGroupDto(string BrandId, string BrandName, IReadOnlyList<CartLineDto> Lines, long SubtotalMinor);

public record CartDto(IReadOnlyList<CartGroupDto> Groups, int LineCount, long TotalMinor, string Currency);

public record WatchItemDto(
    ProductDto Product,
    string? Size,
    LookRefDto? Look,
    long PriceAtAddMinor,
    long CurrentPriceMinor,
    bool PriceDropped,
    long DropMinor,
    DateTime AddedAt);

public record CheckoutProductDto(string ProductId, string Url);

public record CheckoutDto(string ClickId, string Url, AffiliateSource Source, string BrandId, string BrandName, IReadOnlyList<CheckoutProductDto> Products);

public record PurchasePromptDto(string Id, string BrandId, string BrandName, IReadOnlyList<ProductDto> Products, LookRefDto? Look, WardrobePromptStatus Status, DateTime ReceivedAt);

public static class StoreDtoMapper
{
    public const string Currency = "TRY";

    public static BrandDto ToDto(this BrandEntity brand) => new(brand.Id, brand.Name, brand.LogoUrl, brand.WebsiteUrl);

    /// <summary>Name and description are resolved to one language (requested → default → any).</summary>
    public static ProductDto ToDto(this CatalogProductEntity p, string? brandName, string language, string defaultLanguage) => new(
        p.Id, p.BrandId, brandName ?? p.BrandId,
        LocalizedText.Resolve(p.Name, language, defaultLanguage) ?? "",
        LocalizedText.Resolve(p.Description, language, defaultLanguage),
        p.Category, CatalogRules.SlotOf(p.Category),
        p.Colors, p.Sizes, p.PriceMinor, p.Currency,
        p.PreviousPriceMinor is { } previous && previous > p.PriceMinor ? previous : null,
        p.PriceBand, p.Images, !p.Retired, p.CreatedAt);

    public static ClosetItemDto ToDto(this ClosetItem item) => new(item.Id, item.Name, item.Category, item.Colors, item.ImageUrl);

    public static LookRefDto? ToLookRef(LookRefKind? kind, string? id) => kind is { } k && !string.IsNullOrEmpty(id) ? new LookRefDto(k, id) : null;

    /// <summary>Totals come from the current catalog; retired products are listed ("stokta yok") but add nothing.</summary>
    public static long Total(IEnumerable<ProductDto> products) => products.Where(p => p.Available).Sum(p => p.PriceMinor);
}
