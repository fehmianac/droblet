using Domain.Constant;
using Domain.Enum;

namespace Domain.Services;

/// <summary>A slot reference: exactly one of ItemId (own wardrobe) / ProductId (catalog — a missing piece).</summary>
public sealed record SlotRef(OutfitSlot Slot, string? ItemId = null, string? ProductId = null);

/// <summary>A slot reference resolved by the caller. Category null = the referenced piece does not exist (or is retired).</summary>
public sealed record SlotPiece(OutfitSlot Slot, string? ItemId, string? ProductId, ItemCategory? Category);

/// <summary>
/// Category → the outfit slots a piece of that category may fill; the first slot is its default one.
/// Built from Wardrobe:SlotMapping (config) on top of the approved built-in mapping:
///   Top → Top · Bottom → Bottom · Dress → Top · Outerwear → Outerwear · Shoes → Shoes · Bag, Accessory → BagAccessory
///   Beachwear → Top, Bottom · Skiwear → Top, Bottom, Outerwear
/// </summary>
public sealed class SlotMapping
{
    public static readonly SlotMapping Default = new(new Dictionary<ItemCategory, IReadOnlyList<OutfitSlot>>
    {
        [ItemCategory.Top] = [OutfitSlot.Top],
        [ItemCategory.Bottom] = [OutfitSlot.Bottom],
        [ItemCategory.Dress] = [OutfitSlot.Top],
        [ItemCategory.Outerwear] = [OutfitSlot.Outerwear],
        [ItemCategory.Shoes] = [OutfitSlot.Shoes],
        [ItemCategory.Bag] = [OutfitSlot.BagAccessory],
        [ItemCategory.Accessory] = [OutfitSlot.BagAccessory],
        [ItemCategory.Beachwear] = [OutfitSlot.Top, OutfitSlot.Bottom],
        [ItemCategory.Skiwear] = [OutfitSlot.Top, OutfitSlot.Bottom, OutfitSlot.Outerwear],
    });

    private readonly IReadOnlyDictionary<ItemCategory, IReadOnlyList<OutfitSlot>> _slots;

    private SlotMapping(IReadOnlyDictionary<ItemCategory, IReadOnlyList<OutfitSlot>> slots) => _slots = slots;

    /// <summary>
    /// Config entries replace the built-in entry of their category. An entry with an unknown category, or without a
    /// single known slot, is ignored (the built-in mapping stays) — a typo in config can never leave a category without a slot.
    /// </summary>
    public static SlotMapping From(IReadOnlyDictionary<string, List<string>>? configured)
    {
        if (configured is null || configured.Count == 0)
            return Default;

        var slots = Default._slots.ToDictionary(p => p.Key, p => p.Value);
        foreach (var (key, values) in configured)
        {
            if (ByName<ItemCategory>(key) is not { } category)
                continue;
            var parsed = (values ?? []).Select(ByName<OutfitSlot>).Where(s => s is not null).Select(s => s!.Value).Distinct().ToList();
            if (parsed.Count > 0)
                slots[category] = parsed;
        }
        return new SlotMapping(slots);
    }

    /// <summary>Names only ("Top", "top"): a number is not a valid config value even though Enum.Parse would accept it.</summary>
    private static T? ByName<T>(string? name) where T : struct, System.Enum
    {
        var wanted = name?.Trim();
        foreach (var value in System.Enum.GetValues<T>())
        {
            if (string.Equals(value.ToString(), wanted, StringComparison.OrdinalIgnoreCase))
                return value;
        }
        return null;
    }

    public IReadOnlyList<OutfitSlot> SlotsOf(ItemCategory category) => _slots.TryGetValue(category, out var slots) ? slots : [];

    public bool Accepts(OutfitSlot slot, ItemCategory category) => SlotsOf(category).Contains(slot);

    public OutfitSlot DefaultSlot(ItemCategory category) => SlotsOf(category) is { Count: > 0 } slots ? slots[0] : OutfitSlot.Top;
}

/// <summary>
/// The one rule set for looks — used by the Api (look CRUD, accept) and by the worker guards (StylistOutputGuard,
/// PackingRules). Five slots, one piece per slot; which category may fill which slot is <see cref="SlotMapping"/>
/// (Wardrobe:SlotMapping config, set once at start-up and on config reload). Built-in:
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

    private static volatile SlotMapping _mapping = SlotMapping.Default;

    public static SlotMapping Mapping => _mapping;

    /// <summary>Called by AddDrobletWardrobe with Wardrobe:SlotMapping (and again when the configuration reloads).</summary>
    public static void Configure(IReadOnlyDictionary<string, List<string>>? slotMapping) => _mapping = SlotMapping.From(slotMapping);

    public static bool Accepts(OutfitSlot slot, ItemCategory category) => _mapping.Accepts(slot, category);

    /// <summary>Where a category goes when a rule (not the user) builds the look.</summary>
    public static OutfitSlot DefaultSlot(ItemCategory category) => _mapping.DefaultSlot(category);

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
