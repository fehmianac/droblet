using Domain.Entity;
using Domain.Enum;

namespace Domain.Services;

// ── Seam to the wardrobe/look slice (E2–E5, built in a parallel branch) ─────────────────────────────────────────
// Store and social code never read item/look/trip entities directly: they ask IClosetReader. The default
// registration (EmptyClosetReader) returns nothing; the wardrobe engineer registers the real implementation.

public sealed record ClosetItem(string Id, string Name, ProductCategory Category, IReadOnlyList<string> Colors, string? ImageUrl = null);

public sealed record ClosetLookPiece(ProductSlot Slot, string? ItemId, string? ProductId, string? Name = null, string? ImageUrl = null);

public sealed record ClosetLook(string Id, string Name, string? Occasion, DateTime CreatedAt, IReadOnlyList<ClosetLookPiece> Pieces);

/// <summary>A completed trip as others may see it: city and month only (never dates or packing lists).</summary>
public sealed record ClosetTrip(string Id, string City, string Month);

public interface IClosetReader
{
    /// <summary>Confirmed wardrobe items. ImageUrl must be the processed (background-removed) image, never the raw upload.</summary>
    Task<IReadOnlyList<ClosetItem>> GetItemsAsync(string tenantId, CancellationToken ct);
    /// <summary>Looks, newest first. Piece images are item images — never a try-on image.</summary>
    Task<IReadOnlyList<ClosetLook>> GetLooksAsync(string tenantId, CancellationToken ct);
    Task<ClosetLook?> GetLookAsync(string tenantId, string lookId, CancellationToken ct);
    Task<IReadOnlyList<ClosetTrip>> GetCompletedTripsAsync(string tenantId, CancellationToken ct);
}

public sealed class EmptyClosetReader : IClosetReader
{
    public Task<IReadOnlyList<ClosetItem>> GetItemsAsync(string tenantId, CancellationToken ct) => Task.FromResult<IReadOnlyList<ClosetItem>>([]);
    public Task<IReadOnlyList<ClosetLook>> GetLooksAsync(string tenantId, CancellationToken ct) => Task.FromResult<IReadOnlyList<ClosetLook>>([]);
    public Task<ClosetLook?> GetLookAsync(string tenantId, string lookId, CancellationToken ct) => Task.FromResult<ClosetLook?>(null);
    public Task<IReadOnlyList<ClosetTrip>> GetCompletedTripsAsync(string tenantId, CancellationToken ct) => Task.FromResult<IReadOnlyList<ClosetTrip>>([]);
}

public sealed record WardrobeMatchResult(IReadOnlyList<ClosetItem> CompatibleItems);

public sealed record CompleteLookSuggestion(ProductSlot Slot, IReadOnlyList<CatalogProductEntity> Products);

/// <summary>
/// "Gardırobundaki N parçayla uyumlu" and "Parçamı tamamla". The default is rule based (category + colour);
/// the wardrobe/AI slice may replace it (e.g. with the Stylist "complete" job).
/// </summary>
public interface IWardrobeMatcher
{
    Task<WardrobeMatchResult> MatchProductAsync(string tenantId, CatalogProductEntity product, CancellationToken ct);

    /// <summary>Products for the slots the selected wardrobe pieces leave empty.</summary>
    Task<IReadOnlyList<CompleteLookSuggestion>> CompleteAsync(
        string tenantId, IReadOnlyCollection<string> itemIds, IReadOnlyList<CatalogProductEntity> candidates,
        PriceBand? priceBand, string? size, int perSlot, CancellationToken ct);
}

public sealed class RuleBasedWardrobeMatcher(IClosetReader closet) : IWardrobeMatcher
{
    public async Task<WardrobeMatchResult> MatchProductAsync(string tenantId, CatalogProductEntity product, CancellationToken ct)
    {
        var items = await closet.GetItemsAsync(tenantId, ct);
        return new WardrobeMatchResult(WardrobeMatchRules.CompatibleItems(product, items));
    }

    public async Task<IReadOnlyList<CompleteLookSuggestion>> CompleteAsync(
        string tenantId, IReadOnlyCollection<string> itemIds, IReadOnlyList<CatalogProductEntity> candidates,
        PriceBand? priceBand, string? size, int perSlot, CancellationToken ct)
    {
        var items = await closet.GetItemsAsync(tenantId, ct);
        var selected = itemIds.Count == 0 ? items : items.Where(i => itemIds.Contains(i.Id)).ToList();
        return WardrobeMatchRules.Complete(selected, candidates, priceBand, size, perSlot);
    }
}

/// <summary>
/// Deterministic colour + category rule (no AI):
/// • two pieces are compatible when they fill different outfit slots and their colours harmonise;
/// • colours harmonise when either side has a neutral, or they share a colour;
/// • a one-piece (dress) never combines with a top or a bottom.
/// </summary>
public static class WardrobeMatchRules
{
    public static readonly IReadOnlySet<string> Neutrals = new HashSet<string>(StringComparer.Ordinal)
    {
        "black", "white", "grey", "gray", "beige", "cream", "ecru", "navy", "camel", "brown", "denim", "khaki", "taupe",
    };

    /// <summary>Slots a complete outfit needs (screen 23's five slots; a one-piece replaces top + bottom).</summary>
    public static readonly IReadOnlyList<ProductSlot> OutfitSlots =
        [ProductSlot.Top, ProductSlot.Bottom, ProductSlot.Outerwear, ProductSlot.Shoes, ProductSlot.Bag];

    public static bool ColorsHarmonise(IReadOnlyCollection<string> a, IReadOnlyCollection<string> b)
    {
        if (a.Count == 0 || b.Count == 0)
            return true; // unknown colour never blocks a suggestion
        var left = a.Select(CatalogRules.NormalizeColor).ToHashSet(StringComparer.Ordinal);
        var right = b.Select(CatalogRules.NormalizeColor).ToHashSet(StringComparer.Ordinal);
        return left.Overlaps(Neutrals) || right.Overlaps(Neutrals) || left.Overlaps(right);
    }

    public static bool SlotsCombine(ProductSlot a, ProductSlot b)
    {
        if (a == b)
            return false;
        var pair = (a, b);
        return pair is not ((ProductSlot.OnePiece, ProductSlot.Top) or (ProductSlot.OnePiece, ProductSlot.Bottom)
            or (ProductSlot.Top, ProductSlot.OnePiece) or (ProductSlot.Bottom, ProductSlot.OnePiece));
    }

    public static bool IsCompatible(CatalogProductEntity product, ClosetItem item) =>
        SlotsCombine(CatalogRules.SlotOf(product.Category), CatalogRules.SlotOf(item.Category))
        && ColorsHarmonise(product.Colors, item.Colors);

    public static IReadOnlyList<ClosetItem> CompatibleItems(CatalogProductEntity product, IEnumerable<ClosetItem> items) =>
        items.Where(i => IsCompatible(product, i)).ToList();

    public static IReadOnlyList<ProductSlot> MissingSlots(IReadOnlyCollection<ClosetItem> selected)
    {
        var filled = selected.Select(i => CatalogRules.SlotOf(i.Category)).ToHashSet();
        if (filled.Contains(ProductSlot.OnePiece))
        {
            filled.Add(ProductSlot.Top);
            filled.Add(ProductSlot.Bottom);
        }
        return OutfitSlots.Where(s => !filled.Contains(s)).ToList();
    }

    /// <summary>
    /// For every slot the selection leaves empty: products of that slot that harmonise with every selected piece,
    /// in the user's size and price band when given, newest first.
    /// </summary>
    public static IReadOnlyList<CompleteLookSuggestion> Complete(
        IReadOnlyCollection<ClosetItem> selected, IReadOnlyList<CatalogProductEntity> candidates,
        PriceBand? priceBand, string? size, int perSlot)
    {
        var normalizedSize = string.IsNullOrWhiteSpace(size) ? null : CatalogRules.NormalizeSize(size);
        var result = new List<CompleteLookSuggestion>();
        foreach (var slot in MissingSlots(selected))
        {
            var products = candidates
                .Where(p => !p.Retired && CatalogRules.SlotOf(p.Category) == slot)
                .Where(p => priceBand is null || p.PriceBand == priceBand)
                .Where(p => normalizedSize is null || p.Sizes.Count == 0 || p.Sizes.Contains(normalizedSize) || slot is ProductSlot.Bag or ProductSlot.Shoes)
                .Where(p => selected.All(i => ColorsHarmonise(p.Colors, i.Colors)))
                .OrderByDescending(p => p.CreatedAt).ThenBy(p => p.Id, StringComparer.Ordinal)
                .Take(perSlot)
                .ToList();
            if (products.Count > 0)
                result.Add(new CompleteLookSuggestion(slot, products));
        }
        return result;
    }
}

/// <summary>
/// "Sana benzeyen dolaplar" (screen 27): style match % from the style tags both users picked (exactly 3 each).
/// Jaccard similarity, rounded: 3 shared = 100, 2 = 50, 1 = 20, 0 = 0. Deterministic and symmetric.
/// </summary>
public static class StyleMatchRules
{
    public static int Percent(IReadOnlyCollection<StyleTag>? a, IReadOnlyCollection<StyleTag>? b)
    {
        if (a is null || b is null || a.Count == 0 || b.Count == 0)
            return 0;
        var left = a.ToHashSet();
        var right = b.ToHashSet();
        var shared = left.Count(right.Contains);
        var union = left.Count + right.Count - shared;
        return (int)Math.Round(100.0 * shared / union, MidpointRounding.AwayFromZero);
    }
}
