using Domain.Constant;
using Domain.Enum;

namespace Domain.Services;

/// <summary>A slot reference: exactly one of ItemId (own wardrobe) / ProductId (catalog — a missing piece).</summary>
public sealed record SlotRef(OutfitSlot Slot, string? ItemId = null, string? ProductId = null);

/// <summary>A slot reference resolved by the caller. Category null = the referenced piece does not exist (or is retired).</summary>
public sealed record SlotPiece(OutfitSlot Slot, string? ItemId, string? ProductId, ItemCategory? Category);

/// <summary>
/// The one rule set for looks — used by the Api (look CRUD, accept) and by the worker guards (StylistOutputGuard,
/// PackingRules). Five slots, one piece per slot:
///   Top          ← Top, Dress, Beachwear, Skiwear
///   Bottom       ← Bottom, Beachwear, Skiwear
///   Outerwear    ← Outerwear, Skiwear
///   Shoes        ← Shoes
///   BagAccessory ← Bag, Accessory
/// A Dress sits in the Top slot and closes the Bottom slot. A slot source is the tenant's own Item or a catalog
/// product, never another tenant's piece (the caller resolves ids inside the caller's tenant only).
/// A look needs at least 2 pieces (brief §4.3 / screen 15).
/// </summary>
public static class OutfitSlotRules
{
    public const int MinPieces = 2;

    public static readonly IReadOnlyList<OutfitSlot> Slots = System.Enum.GetValues<OutfitSlot>();

    public static bool Accepts(OutfitSlot slot, ItemCategory category) => slot switch
    {
        OutfitSlot.Top => category is ItemCategory.Top or ItemCategory.Dress or ItemCategory.Beachwear or ItemCategory.Skiwear,
        OutfitSlot.Bottom => category is ItemCategory.Bottom or ItemCategory.Beachwear or ItemCategory.Skiwear,
        OutfitSlot.Outerwear => category is ItemCategory.Outerwear or ItemCategory.Skiwear,
        OutfitSlot.Shoes => category is ItemCategory.Shoes,
        OutfitSlot.BagAccessory => category is ItemCategory.Bag or ItemCategory.Accessory,
        _ => false,
    };

    /// <summary>Where a category goes when a rule (not the user) builds the look.</summary>
    public static OutfitSlot DefaultSlot(ItemCategory category) => category switch
    {
        ItemCategory.Bottom => OutfitSlot.Bottom,
        ItemCategory.Outerwear => OutfitSlot.Outerwear,
        ItemCategory.Shoes => OutfitSlot.Shoes,
        ItemCategory.Bag or ItemCategory.Accessory => OutfitSlot.BagAccessory,
        _ => OutfitSlot.Top,
    };

    /// <summary>Stable error codes; empty = valid.</summary>
    public static IReadOnlyList<string> Validate(IReadOnlyList<SlotPiece> pieces, int minPieces = MinPieces)
    {
        var errors = new List<string>();
        void Add(string code)
        {
            if (!errors.Contains(code))
                errors.Add(code);
        }

        if (pieces.Any(p => !System.Enum.IsDefined(p.Slot)) || pieces.Select(p => p.Slot).Distinct().Count() != pieces.Count)
            Add(ErrorCodes.SlotDuplicate);

        foreach (var piece in pieces)
        {
            var hasItem = !string.IsNullOrEmpty(piece.ItemId);
            var hasProduct = !string.IsNullOrEmpty(piece.ProductId);
            if (hasItem == hasProduct)
            {
                Add(ErrorCodes.SlotSourceInvalid);
                continue;
            }

            if (piece.Category is not { } category)
                Add(hasItem ? ErrorCodes.SlotItemNotFound : ErrorCodes.SlotProductNotFound);
            else if (System.Enum.IsDefined(piece.Slot) && !Accepts(piece.Slot, category))
                Add(ErrorCodes.SlotCategoryMismatch);
        }

        var ids = pieces.Select(p => p.ItemId is { Length: > 0 } item ? $"i:{item}" : $"p:{p.ProductId}").ToList();
        if (ids.Distinct().Count() != ids.Count)
            Add(ErrorCodes.SlotPieceRepeated);

        if (pieces.Any(p => p is { Slot: OutfitSlot.Top, Category: ItemCategory.Dress }) && pieces.Any(p => p.Slot == OutfitSlot.Bottom))
            Add(ErrorCodes.DressClosesBottom);

        if (pieces.Count < minPieces)
            Add(ErrorCodes.LookMinPieces);

        return errors;
    }
}
