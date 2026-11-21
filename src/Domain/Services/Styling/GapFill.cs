using Domain.Entity;
using Domain.Enum;
using Domain.Services.Ai;

namespace Domain.Services.Styling;

/// <summary>What the gap filling may pick from and what it has to respect (owner decision 3).</summary>
/// <param name="Library">The ready-made library (free; "Önerilen · Kütüphane").</param>
/// <param name="Catalog">Shop products, used only for a slot the wardrobe and the library cannot fill ("Önerilen · Mağaza").</param>
/// <param name="PriceBand">The user's budget band for catalog picks (null = mixed / unknown: any band).</param>
/// <param name="PerSlot">How many library pieces per slot group become candidates (variety between suggestions).</param>
/// <param name="Segment">The user's segment: only library pieces and products of that segment (or unisex) are picked; a man never gets a dress picked.</param>
public sealed record GapFillContext(
    IReadOnlyList<LibraryItemEntity> Library,
    IReadOnlyList<CatalogProductEntity> Catalog,
    IReadOnlySet<Season> Seasons,
    Occasion? Occasion,
    int? MaxTempC,
    int HotFromC,
    bool IsTrip,
    bool WantsOuterLayer,
    IReadOnlySet<string> Flattering,
    IReadOnlySet<string> Avoid,
    PriceBand? PriceBand,
    int PerSlot = 3,
    Segment Segment = Segment.Women,
    bool Teen = false);

/// <summary>
/// "Parça yetersiz" is no longer a dead end (owner decision 3): when the wardrobe is too thin, Droblet picks the missing
/// pieces itself. Deterministic, no AI:
///  1. Ready-library pieces become extra candidates — per slot group the best <see cref="GapFillContext.PerSlot"/> by
///     season (in season first; out-of-season only when none is), colour harmony with every piece the user owns
///     (WardrobeMatchRules), palette (flattering +, avoid −), occasion (a dress for dinner / wedding), then sort order.
///     Beachwear / skiwear follow the candidate rules; outerwear is left out on a hot day.
///  2. Only for a slot group that neither the wardrobe nor the library can fill: catalog products of that slot that
///     harmonise with the user's pieces, in the user's budget band, newest first.
///  3. The user's own pieces always come first (they are the least "worn" candidates); the rule-based outfit builder then
///     dresses the day, and every picked piece is moved from `slots` to `missing` with its libraryItemId / productId —
///     the user's pieces stay in `slots`, so a suggestion never claims a piece the user does not own.
/// </summary>
public static class GapFill
{
    public const string LibraryPrefix = "lib:";
    public const string ProductPrefix = "prd:";

    /// <summary>Large enough that every own piece (real wear counts) sorts before every picked one.</summary>
    private const int PickedWearBase = 1_000_000;

    public static bool IsPicked(string? id) =>
        id is not null && (id.StartsWith(LibraryPrefix, StringComparison.Ordinal) || id.StartsWith(ProductPrefix, StringComparison.Ordinal));

    /// <summary>Library (then catalog) candidates for the slot groups of <paramref name="own"/>; ids carry the lib: / prd: prefix.</summary>
    public static IReadOnlyList<CandidateItem> Candidates(IReadOnlyList<CandidateItem> own, GapFillContext context)
    {
        var picked = new List<CandidateItem>();
        // The user's own outer layer, shoes and bag are kept; only the base (top / bottom) also gets library variety, so
        // a wardrobe that dresses the day just once or twice still yields different looks.
        var ownGroups = own.Select(c => OutfitSlotRules.DefaultSlot(c.Category)).ToHashSet();
        var library = context.Library
            .Where(l => !l.Retired && SegmentPolicy.Shows(l.Segment, context.Segment) && Allowed(l.Category, context))
            .Select(l => (Item: l, Group: OutfitSlotRules.DefaultSlot(l.Category)))
            .Where(x => x.Group is OutfitSlot.Top or OutfitSlot.Bottom || !ownGroups.Contains(x.Group))
            .GroupBy(x => x.Group);

        foreach (var group in library)
        {
            var inSeason = group.Where(x => x.Item.Seasons.Any(context.Seasons.Contains)).ToList();
            var pool = inSeason.Count > 0 ? inSeason : group.ToList();
            var best = pool
                .OrderByDescending(x => Score(x.Item.Category, x.Item.ColorIds, own, context))
                .ThenBy(x => x.Item.SortOrder)
                .ThenBy(x => x.Item.Id, StringComparer.Ordinal)
                .Take(Math.Max(1, context.PerSlot))
                .Select((x, rank) => new CandidateItem(LibraryPrefix + x.Item.Id, x.Item.Category, x.Item.ColorIds, x.Item.Fabric, x.Item.Seasons,
                    PickedWearBase + rank));
            picked.AddRange(best);
        }

        // Catalog only where the wardrobe and the library leave a slot group the outfit needs empty.
        var filled = own.Concat(picked).Select(c => OutfitSlotRules.DefaultSlot(c.Category)).ToHashSet();
        foreach (var slot in NeededSlots(context).Where(s => !filled.Contains(s)))
        {
            var products = context.Catalog
                .Where(p => !p.Retired && SegmentPolicy.Shows(p.Segment, context.Segment) && (context.PriceBand is null || p.PriceBand == context.PriceBand))
                .Select(p => (Product: p, Category: CatalogRules.ItemCategoryOf(p.Category)))
                .Where(x => OutfitSlotRules.DefaultSlot(x.Category) == slot && Allowed(x.Category, context))
                .Where(x => own.All(o => WardrobeMatchRules.ColorsHarmonise(x.Product.Colors, o.ColorIds)))
                .OrderByDescending(x => Score(x.Category, x.Product.Colors, own, context))
                .ThenByDescending(x => x.Product.CreatedAt)
                .ThenBy(x => x.Product.Id, StringComparer.Ordinal)
                .Take(Math.Max(1, context.PerSlot))
                .Select((x, rank) => new CandidateItem(ProductPrefix + x.Product.Id, x.Category,
                    x.Product.Colors.Select(CatalogRules.NormalizeColor).ToList(), null, [.. context.Seasons], PickedWearBase * 2 + rank));
            picked.AddRange(products);
        }

        return picked;
    }

    /// <summary>
    /// Up to <paramref name="count"/> complete outfits from the user's pieces plus picked ones (rule-based, deterministic),
    /// each with its picked pieces in `missing`. Empty only when even the library and the catalog cannot dress the day.
    /// </summary>
    public static IReadOnlyList<SuggestedOutfit> Outfits(IReadOnlyList<CandidateItem> own, GapFillContext context, int count, RuleOutfitOptions options)
    {
        var picked = Candidates(own, context);
        var all = own.Concat(picked).ToList();
        var built = RuleBasedOutfit.Build(all, count, options with { OnlyMyWardrobe = true, WithOuterwear = options.WithOuterwear || context.WantsOuterLayer });
        return built.Select(o => ToMissing(o, picked)).ToList();
    }

    /// <summary>Moves picked pieces from `slots` to `missing` (libraryItemId / productId); the user's pieces stay.</summary>
    public static SuggestedOutfit ToMissing(SuggestedOutfit outfit, IReadOnlyList<CandidateItem> picked)
    {
        var byId = picked.ToDictionary(p => p.Id, StringComparer.Ordinal);
        var missing = outfit.Missing.Where(m => m.ProductId is not null || m.LibraryItemId is not null).ToList();
        var slots = new List<SlotRef>();
        foreach (var slot in outfit.Slots)
        {
            if (slot.ItemId is { } id && byId.TryGetValue(id, out var piece))
                missing.Add(Missing(slot.Slot, piece));
            else
                slots.Add(slot);
        }
        return outfit with { Slots = slots, Missing = missing };
    }

    /// <summary>
    /// Shoes for an outfit of a wardrobe without shoes (the guard accepts an outfit without them then): the
    /// <paramref name="index"/>-th picked pair, replacing a bare "shoes missing" placeholder. Unchanged when the outfit already
    /// has shoes or nothing can be picked.
    /// </summary>
    public static SuggestedOutfit WithShoes(SuggestedOutfit outfit, IReadOnlyList<CandidateItem> picked, int index)
    {
        if (outfit.Slots.Any(s => s.Slot == OutfitSlot.Shoes) || outfit.Missing.Any(m => m.Slot == OutfitSlot.Shoes && (m.ProductId ?? m.LibraryItemId) is not null))
            return outfit;
        var shoes = picked.Where(p => p.Category == ItemCategory.Shoes).ToList();
        if (shoes.Count == 0)
            return outfit;
        var missing = outfit.Missing.Where(m => m.Slot != OutfitSlot.Shoes).Append(Missing(OutfitSlot.Shoes, shoes[index % shoes.Count])).ToList();
        return outfit with { Missing = missing };
    }

    /// <summary>A generic placeholder (no shoes, rain, cold) gets a concrete pick of its category when there is one.</summary>
    public static MissingPiece Concrete(MissingPiece piece, IReadOnlyList<CandidateItem> picked)
    {
        if (piece.ProductId is not null || piece.LibraryItemId is not null)
            return piece;
        var match = picked.FirstOrDefault(p => piece.Category is { } category ? p.Category == category : OutfitSlotRules.DefaultSlot(p.Category) == piece.Slot);
        return match is null ? piece : Missing(piece.Slot, match) with { Reason = piece.Reason };
    }

    /// <summary>Identity of a suggestion including its picked pieces (two fills with different picks are different looks).</summary>
    public static string Signature(SuggestedOutfit outfit) =>
        string.Join('|', outfit.Slots.Select(s => s.ItemId ?? $"p:{s.ProductId}")
            .Concat(outfit.Missing.Select(m => m.LibraryItemId is { } l ? $"l:{l}" : m.ProductId is { } p ? $"p:{p}" : $"m:{m.Slot}"))
            .Order(StringComparer.Ordinal));

    /// <summary>The rule builder's signature of a filled outfit (picked pieces under their lib: / prd: ids) — for ExcludeSignatures.</summary>
    public static string RawSignature(SuggestedOutfit outfit) =>
        StylistOutputGuard.Signature(outfit.Slots.Concat(outfit.Missing
            .Where(m => m.LibraryItemId is not null || m.ProductId is not null)
            .Select(m => new SlotRef(m.Slot, m.LibraryItemId is { } l ? LibraryPrefix + l : ProductPrefix + m.ProductId))));

    public static bool HasPicks(SuggestedOutfit? outfit) =>
        outfit is not null && outfit.Missing.Any(m => m.LibraryItemId is not null || m.ProductId is not null);

    public static MissingPiece Missing(OutfitSlot slot, CandidateItem piece) =>
        piece.Id.StartsWith(LibraryPrefix, StringComparison.Ordinal)
            ? new MissingPiece(slot, piece.Category, MissingPieceReason.Suggested, null, piece.Id[LibraryPrefix.Length..])
            : new MissingPiece(slot, piece.Category, MissingPieceReason.Suggested, piece.Id[ProductPrefix.Length..]);

    /// <summary>Slot groups a complete outfit needs: a base (top + bottom, or a dress in the top group) and shoes; the outer layer when the weather asks.</summary>
    private static IEnumerable<OutfitSlot> NeededSlots(GapFillContext context)
    {
        yield return OutfitSlot.Top;
        yield return OutfitSlot.Bottom;
        yield return OutfitSlot.Shoes;
        if (context.WantsOuterLayer)
            yield return OutfitSlot.Outerwear;
    }

    private static bool Allowed(ItemCategory category, GapFillContext context)
    {
        if (category == ItemCategory.Outerwear && context.MaxTempC is { } max && max >= context.HotFromC)
            return false;
        // Menswear: a dress is only ever worn when the user owns one — never picked for him.
        if (category == ItemCategory.Dress && context.Segment == Segment.Men)
            return false;
        return category switch
        {
            ItemCategory.Beachwear => context.Seasons.Contains(Season.Summer) && (context.IsTrip || context.Occasion is null or Occasion.Travel or Occasion.Weekend),
            ItemCategory.Skiwear => context.Seasons.Contains(Season.Winter) && (context.IsTrip || context.Occasion is null or Occasion.Travel or Occasion.Sport),
            _ => true,
        };
    }

    private static int Score(ItemCategory category, IReadOnlyCollection<string> colors, IReadOnlyList<CandidateItem> own, GapFillContext context)
    {
        var score = 0;
        if (own.Count == 0 || own.All(o => WardrobeMatchRules.ColorsHarmonise(colors, o.ColorIds)))
            score += 3;
        var normalized = colors.Select(CatalogRules.NormalizeColor).ToList();
        if (normalized.Any(context.Flattering.Contains))
            score += 2;
        if (normalized.Any(context.Avoid.Contains))
            score -= 3;
        if (category == ItemCategory.Dress && context.Segment != Segment.Men && context.Occasion is Occasion.Dinner or Occasion.Wedding)
            score += 1;
        // Menswear: a tailored outer layer (blazer / suit jacket) finishes office, dinner and wedding looks.
        if (category == ItemCategory.Outerwear && context.Segment == Segment.Men && context.Occasion is Occasion.Office or Occasion.Dinner or Occasion.Wedding)
            score += 1;
        return score;
    }
}
