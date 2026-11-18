using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;

namespace Domain.Entity;

// Global data: written only by the admin API / seed tool. Text shown to users is stored per language (maps);
// read endpoints resolve it with IRequestLanguage, so a new language is data only — no partition per language.
// Ids are never reused; removed entries are `retired`.
public class BrandEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("name")] public string Name { get; set; } = null!;
    [JsonPropertyName("websiteUrl")] public string? WebsiteUrl { get; set; }
    [JsonPropertyName("logoUrl")] public string? LogoUrl { get; set; }
    [JsonPropertyName("source")] public AffiliateSource Source { get; set; }
    [JsonPropertyName("network")] public string? Network { get; set; }
    /// <summary>Affiliate landing used when a cart group has several products of the brand.</summary>
    [JsonPropertyName("checkoutUrl")] public string? CheckoutUrl { get; set; }
    /// <summary>Query parameter that carries click_id on this brand's / network's links (sub-id).</summary>
    [JsonPropertyName("clickIdParameter")] public string? ClickIdParameter { get; set; }
    /// <summary>Optional override of Affiliate:Brands config (basis points).</summary>
    [JsonPropertyName("commissionRateBps")] public int? CommissionRateBps { get; set; }
    [JsonPropertyName("retired")] public bool Retired { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk() => "brand";
    public static string GetSk(string brandId) => brandId;
}

public class CatalogProductEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("brandId")] public string BrandId { get; set; } = null!;
    /// <summary>Localized: { "tr": "…", "en": "…" }.</summary>
    [JsonPropertyName("name")] public Dictionary<string, string> Name { get; set; } = [];
    [JsonPropertyName("description")] public Dictionary<string, string>? Description { get; set; }
    [JsonPropertyName("category")] public ProductCategory Category { get; set; }
    [JsonPropertyName("colors")] public List<string> Colors { get; set; } = [];
    [JsonPropertyName("sizes")] public List<string> Sizes { get; set; } = [];
    [JsonPropertyName("priceMinor")] public long PriceMinor { get; set; }                 // kuruş
    [JsonPropertyName("currency")] public string Currency { get; set; } = "TRY";
    [JsonPropertyName("previousPriceMinor")] public long? PreviousPriceMinor { get; set; }
    [JsonPropertyName("priceChangedAt")] public DateTime? PriceChangedAt { get; set; }
    [JsonPropertyName("priceBand")] public PriceBand PriceBand { get; set; }
    [JsonPropertyName("images")] public List<string> Images { get; set; } = [];
    [JsonPropertyName("affiliateUrl")] public string? AffiliateUrl { get; set; }
    [JsonPropertyName("affiliateSource")] public AffiliateSource AffiliateSource { get; set; }
    [JsonPropertyName("retired")] public bool Retired { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk() => "catalog#product";
    public static string GetSk(string productId) => productId;
}

/// <summary>Reverse index product → watchers, so a price update can flag watch-list rows. Removed on account deletion.</summary>
public class ProductWatcherEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(ProductId);
    [JsonPropertyName("sk")] public string Sk => GetSk(WatcherTenantId);

    [JsonPropertyName("productId")] public string ProductId { get; set; } = null!;
    [JsonPropertyName("watcherTenantId")] public string WatcherTenantId { get; set; } = null!;

    public static string GetPk(string productId) => $"catalog#watcher#{productId}";
    public static string GetSk(string watcherTenantId) => watcherTenantId;
}

public class EditLookVariant
{
    [JsonPropertyName("priceBand")] public PriceBand PriceBand { get; set; }
    [JsonPropertyName("productIds")] public List<string> ProductIds { get; set; } = [];
}

public class EditLook
{
    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    /// <summary>1 (Monday) … 7 (Sunday).</summary>
    [JsonPropertyName("day")] public int Day { get; set; }
    [JsonPropertyName("title")] public Dictionary<string, string> Title { get; set; } = [];
    [JsonPropertyName("styleNote")] public Dictionary<string, string>? StyleNote { get; set; }
    [JsonPropertyName("imageUrl")] public string? ImageUrl { get; set; }
    [JsonPropertyName("variants")] public List<EditLookVariant> Variants { get; set; } = [];
}

/// <summary>"Haftanın edit'i": week, segment, 7 looks with price-band variants, optional sponsor.</summary>
public class WeeklyEditEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("segment")] public Segment Segment { get; set; }
    /// <summary>Monday of the week, yyyy-MM-dd (calendar day, no time).</summary>
    [JsonPropertyName("weekStart")] public string WeekStart { get; set; } = null!;
    [JsonPropertyName("title")] public Dictionary<string, string> Title { get; set; } = [];
    [JsonPropertyName("subtitle")] public Dictionary<string, string>? Subtitle { get; set; }
    [JsonPropertyName("coverImageUrl")] public string? CoverImageUrl { get; set; }
    [JsonPropertyName("looks")] public List<EditLook> Looks { get; set; } = [];
    [JsonPropertyName("sponsorBrandId")] public string? SponsorBrandId { get; set; }
    [JsonPropertyName("sponsorName")] public Dictionary<string, string>? SponsorName { get; set; }
    [JsonPropertyName("published")] public bool Published { get; set; }
    [JsonPropertyName("retired")] public bool Retired { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk() => "content#edit";
    public static string GetSk(string editId) => editId;
}

/// <summary>Generic content collection: creator/influencer (A-7: placeholder names only) or "dizi outfitleri". Empty by default.</summary>
public class ContentCollectionEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(Kind);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("kind")] public ContentCollectionKind Kind { get; set; }
    [JsonPropertyName("title")] public Dictionary<string, string> Title { get; set; } = [];
    [JsonPropertyName("subtitle")] public Dictionary<string, string>? Subtitle { get; set; }
    [JsonPropertyName("imageUrl")] public string? ImageUrl { get; set; }
    [JsonPropertyName("sortOrder")] public int SortOrder { get; set; }
    [JsonPropertyName("sponsorName")] public Dictionary<string, string>? SponsorName { get; set; }
    [JsonPropertyName("retired")] public bool Retired { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk(ContentCollectionKind kind) => $"content#collection#{kind.ToString().ToLowerInvariant()}";
    public static string GetSk(string collectionId) => collectionId;
}

public class ContentLookEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(CollectionId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("collectionId")] public string CollectionId { get; set; } = null!;
    [JsonPropertyName("title")] public Dictionary<string, string> Title { get; set; } = [];
    [JsonPropertyName("note")] public Dictionary<string, string>? Note { get; set; }
    [JsonPropertyName("imageUrl")] public string? ImageUrl { get; set; }
    [JsonPropertyName("productIds")] public List<string> ProductIds { get; set; } = [];
    [JsonPropertyName("sortOrder")] public int SortOrder { get; set; }
    [JsonPropertyName("retired")] public bool Retired { get; set; }
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk(string collectionId) => $"content#collectionlook#{collectionId}";
    public static string GetSk(string lookId) => lookId;
}

// Tenant scoped ------------------------------------------------------------------------------------------------

/// <summary>No price is stored — totals are computed from the current catalog on read.</summary>
public class CartLineEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(BrandId, ProductId, Size);

    [JsonPropertyName("lineId")] public string LineId { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("brandId")] public string BrandId { get; set; } = null!;
    [JsonPropertyName("productId")] public string ProductId { get; set; } = null!;
    [JsonPropertyName("size")] public string Size { get; set; } = null!;
    [JsonPropertyName("lookKind")] public LookRefKind? LookKind { get; set; }
    [JsonPropertyName("lookId")] public string? LookId { get; set; }
    [JsonPropertyName("clientMutationId")] public string? ClientMutationId { get; set; }
    [JsonPropertyName("addedAt")] public DateTime AddedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#cart";
    public static string GetSk(string brandId, string productId, string size) => $"{brandId}#{productId}#{size}";
}

/// <summary>The heart on a product card. Separate from the watch list: no price reference, no notification.</summary>
public class FavoriteProductEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(ProductId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("productId")] public string ProductId { get; set; } = null!;
    [JsonPropertyName("addedAt")] public DateTime AddedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#favorite-product";
    public static string GetSk(string productId) => productId;
}

/// <summary>"İzleme listem": separate from favourites; a price drop sets the pending flag (notification later).</summary>
public class WatchItemEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(ProductId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("productId")] public string ProductId { get; set; } = null!;
    [JsonPropertyName("size")] public string? Size { get; set; }
    [JsonPropertyName("lookKind")] public LookRefKind? LookKind { get; set; }
    [JsonPropertyName("lookId")] public string? LookId { get; set; }
    [JsonPropertyName("priceAtAddMinor")] public long PriceAtAddMinor { get; set; }
    [JsonPropertyName("addedAt")] public DateTime AddedAt { get; set; }
    [JsonPropertyName("priceDropped")] public bool PriceDropped { get; set; }
    [JsonPropertyName("droppedToMinor")] public long? DroppedToMinor { get; set; }
    [JsonPropertyName("droppedAt")] public DateTime? DroppedAt { get; set; }
    /// <summary>True until the price-drop push has been sent.</summary>
    [JsonPropertyName("notifyPending")] public bool NotifyPending { get; set; }
    /// <summary>The bell on the row: price-drop push for this product. Null (rows written before the flag) = on.</summary>
    [JsonPropertyName("notify")] public bool? Notify { get; set; }
    [JsonPropertyName("origin")] public WatchOrigin Origin { get; set; }

    [JsonIgnore] public bool NotifyEnabled => Notify ?? true;

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#watch";
    public static string GetSk(string productId) => productId;
}
