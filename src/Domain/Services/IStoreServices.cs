using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Validation;

namespace Domain.Services;

public enum CatalogWriteOutcome { Created, Updated, BrandNotFound, NotFound, ProductNotFound }

public sealed record ProductWriteResult(CatalogWriteOutcome Outcome, CatalogProductEntity? Product = null, bool PriceDropped = false, int WatchersFlagged = 0);

public sealed record BulkRowResult(int Index, string? Id, string Outcome, IReadOnlyDictionary<string, string[]>? Errors = null);

public sealed record BulkUpsertResult(int Created, int Updated, int Failed, IReadOnlyList<BulkRowResult> Rows);

/// <summary>Global catalog: brands and products. Reads are served from a short-lived in-process cache.</summary>
public interface ICatalogService
{
    Task<IReadOnlyList<BrandEntity>> GetBrandsAsync(CancellationToken ct);
    Task<BrandEntity?> GetBrandAsync(string brandId, CancellationToken ct);
    /// <summary>Every product, retired included (cached).</summary>
    Task<IReadOnlyList<CatalogProductEntity>> GetProductsAsync(CancellationToken ct);
    Task<CatalogProductEntity?> GetProductAsync(string productId, CancellationToken ct);
    Task<IReadOnlyDictionary<string, string>> GetBrandNamesAsync(CancellationToken ct);
    /// <summary>Maps the given ids to public DTOs (unknown ids are skipped, retired ones are flagged unavailable).</summary>
    Task<IReadOnlyList<ProductDto>> ToDtosAsync(IEnumerable<string> productIds, CancellationToken ct);
    Task<ProductDto> ToDtoAsync(CatalogProductEntity product, CancellationToken ct);

    // Admin / seed
    Task<(CatalogWriteOutcome Outcome, BrandEntity Brand)> UpsertBrandAsync(BrandInput input, CancellationToken ct);
    Task<bool> RetireBrandAsync(string brandId, CancellationToken ct);
    Task<ProductWriteResult> UpsertProductAsync(ProductInput input, CancellationToken ct);
    Task<bool> RetireProductAsync(string productId, CancellationToken ct);
    /// <summary>dryRun = validate every row and report the outcomes without writing (admin CSV preview).</summary>
    Task<BulkUpsertResult> BulkUpsertProductsAsync(IReadOnlyList<ProductInput> inputs, CancellationToken ct, bool dryRun = false);
    void InvalidateCache();
}

/// <summary>Weekly edit and generic content collections (creator looks, "dizi outfitleri"). Text resolves to the request language.</summary>
public interface IContentService
{
    Task<EditDto?> GetCurrentEditAsync(Segment segment, CancellationToken ct);
    Task<EditDto?> GetEditAsync(string editId, CancellationToken ct);
    Task<IReadOnlyList<ContentCollectionDto>> GetCollectionsAsync(ContentCollectionKind kind, CancellationToken ct);
    /// <summary>Null when the collection does not exist (or is retired).</summary>
    Task<IReadOnlyList<ContentLookDto>?> GetCollectionLooksAsync(ContentCollectionKind kind, string collectionId, CancellationToken ct);

    // Admin / seed
    Task<IReadOnlyList<WeeklyEditEntity>> ListEditsAsync(CancellationToken ct);
    Task<(CatalogWriteOutcome Outcome, WeeklyEditEntity? Edit, IReadOnlyList<string> MissingProductIds)> UpsertEditAsync(WeeklyEditInput input, CancellationToken ct);
    Task<bool> RetireEditAsync(string editId, CancellationToken ct);
    Task<IReadOnlyList<ContentCollectionEntity>> ListCollectionsAsync(ContentCollectionKind kind, CancellationToken ct);
    Task<(CatalogWriteOutcome Outcome, ContentCollectionEntity Collection)> UpsertCollectionAsync(ContentCollectionInput input, CancellationToken ct);
    Task<bool> RetireCollectionAsync(ContentCollectionKind kind, string collectionId, CancellationToken ct);
    Task<IReadOnlyList<ContentLookEntity>> ListCollectionLooksAsync(string collectionId, CancellationToken ct);
    Task<(CatalogWriteOutcome Outcome, ContentLookEntity? Look, IReadOnlyList<string> MissingProductIds)> UpsertCollectionLookAsync(
        ContentCollectionKind kind, string collectionId, ContentLookInput input, CancellationToken ct);
    Task<bool> RetireCollectionLookAsync(string collectionId, string lookId, CancellationToken ct);
}

public sealed record CartLineInput(string? ClientMutationId, string ProductId, string? Size, LookRefDto? Look);

public enum CartOutcome { Ok, ProductNotFound, ProductRetired, SizeNotAvailable, CartFull, WatchListFull, FavoriteListFull, NotFound }

public sealed record CartResult(CartOutcome Outcome, CartDto? Cart = null, int? FailedIndex = null);

public interface ICartService
{
    Task<CartDto> GetAsync(string tenantId, CancellationToken ct);
    /// <summary>All-or-nothing: the first invalid line rejects the request. Re-adding the same product + size is a no-op.</summary>
    Task<CartResult> AddLinesAsync(string tenantId, IReadOnlyList<CartLineInput> lines, CancellationToken ct);
    Task<bool> RemoveLineAsync(string tenantId, string lineId, CancellationToken ct);

    Task<IReadOnlyList<WatchItemDto>> GetWatchListAsync(string tenantId, CancellationToken ct);
    Task<(CartOutcome Outcome, WatchItemDto? Item)> WatchAsync(string tenantId, string productId, string? size, LookRefDto? look, CancellationToken ct);
    Task<bool> UnwatchAsync(string tenantId, string productId, CancellationToken ct);

    /// <summary>Favourite product ids, newest first. Ids of products that no longer resolve are left out.</summary>
    Task<FavoriteProductsDto> GetFavoriteProductsAsync(string tenantId, CancellationToken ct);
    /// <summary>Idempotent: an existing favourite stays as it is (also for a product retired since).</summary>
    Task<CartOutcome> AddFavoriteProductAsync(string tenantId, string productId, CancellationToken ct);
    /// <summary>Idempotent: removing a product that is not a favourite succeeds.</summary>
    Task RemoveFavoriteProductAsync(string tenantId, string productId, CancellationToken ct);
}

public enum CheckoutOutcome { Ok, CartEmpty, BrandNotFound, ProductNotFound, ProductRetired, AffiliateLinkMissing }

public sealed record CheckoutResult(CheckoutOutcome Outcome, CheckoutDto? Checkout = null);

public sealed record PostbackInput(string ClickId, string OrderId, long AmountMinor, string? Currency, AffiliateConversionStatus Status);

public sealed record PurchasePromptAnswer(WardrobePromptStatus Status, IReadOnlyList<ItemCreateResultDto> Items);

public enum PostbackOutcome { Recorded, Updated, Duplicate, ClickNotFound }

public interface IAffiliateService
{
    /// <summary>"[Marka]'da öde": one click for the brand's cart lines; payment happens on the brand's site.</summary>
    Task<CheckoutResult> CheckoutBrandAsync(string tenantId, string brandId, CancellationToken ct);
    Task<CheckoutResult> CheckoutProductAsync(string tenantId, string productId, LookRefDto? look, CancellationToken ct);

    /// <summary>The brand a click belongs to (to pick the direct-deal secret before the signature is verified).</summary>
    Task<string?> BrandOfClickAsync(string clickId, CancellationToken ct);
    /// <summary>Idempotent by (source, order id). A repeat with a new status or amount updates the same record.</summary>
    Task<PostbackOutcome> RecordConversionAsync(AffiliateSource source, PostbackInput input, CancellationToken ct);

    Task<IReadOnlyList<PurchasePromptDto>> GetPurchasePromptsAsync(string tenantId, CancellationToken ct);
    /// <summary>
    /// accepted = true adds the purchased products to the wardrobe (source = purchase; idempotent per prompt + product)
    /// and returns one result per product. Null = unknown prompt. A refused add (wardrobe limit) leaves the prompt pending.
    /// </summary>
    Task<PurchasePromptAnswer?> AnswerPurchasePromptAsync(string tenantId, string promptId, bool accepted, CancellationToken ct);

    Task<RevenueReport> GetRevenueReportAsync(DateOnly from, DateOnly to, CancellationToken ct);
}
