using Domain.Enum;

namespace Domain.Services.Styling;

public sealed record PackDayPlan(string Date, string? Label, Occasion? Occasion, IReadOnlyList<SlotRef> Slots);

public sealed record PackPlan(IReadOnlyList<string> ItemIds, IReadOnlyList<PackDayPlan> Days);

/// <param name="CabinMaxItems">0 = not decided yet (owner decision) — the cabin limit is then not enforced.</param>
public sealed record PackingContext(
    IReadOnlyDictionary<string, CandidateItem> Candidates,
    IReadOnlyList<string> Dates,
    bool CabinOnly,
    int CabinMaxItems);

/// <summary>
/// Suitcase rules — the same class validates the model's list (worker) and the accepted draft (Api).
///  - every packed piece exists in the wardrobe (candidate list) and is packed once;
///  - every trip day has exactly one look, built only from packed pieces of the wardrobe (no catalog product), valid per OutfitSlotRules;
///  - EVERY PACKED PIECE IS WORN AT LEAST 2 TIMES across the daily looks ("Her parça en az 2 kez giyiliyor") —
///    hard-coded, not config. A 1-day trip cannot satisfy it, so there every packed piece must simply be worn (≥ 1)
///    and the "worn twice" claim is not made (EveryPieceWornTwice = false);
///  - cabin-only: the list never exceeds CabinMaxItems.
/// A list that fails is not repaired: RuleBasedPacking builds a greedy one instead.
/// </summary>
public static class PackingRules
{
    public const int MinWearsPerPiece = 2;

    public const string UnknownItem = "pack_unknown_item";
    public const string DuplicateItem = "pack_duplicate_item";
    public const string DayMissing = "pack_day_missing";
    public const string DayUnknown = "pack_day_unknown";
    public const string DayUsesUnpackedPiece = "pack_day_uses_unpacked_piece";
    public const string DayInvalidLook = "pack_day_invalid_look";
    public const string PieceWornOnce = "pack_piece_worn_once";
    public const string PieceUnused = "pack_piece_unused";
    public const string CabinLimit = "pack_cabin_limit";
    public const string Empty = "pack_empty";

    public static bool RequiresMinWears(int tripDays) => tripDays > 1;

    public static IReadOnlyDictionary<string, int> PlannedWears(PackPlan plan)
    {
        var wears = plan.ItemIds.Distinct(StringComparer.Ordinal).ToDictionary(id => id, _ => 0, StringComparer.Ordinal);
        foreach (var id in plan.Days.SelectMany(d => d.Slots).Select(s => s.ItemId))
        {
            if (id is not null && wears.TryGetValue(id, out var count))
                wears[id] = count + 1;
        }
        return wears;
    }

    public static bool EveryPieceWornTwice(PackPlan plan) =>
        plan.ItemIds.Count > 0 && PlannedWears(plan).Values.All(w => w >= MinWearsPerPiece);

    public static IReadOnlyList<string> Validate(PackPlan plan, PackingContext context)
    {
        var errors = new List<string>();
        void Add(string code)
        {
            if (!errors.Contains(code))
                errors.Add(code);
        }

        if (plan.ItemIds.Count == 0)
            Add(Empty);
        if (plan.ItemIds.Distinct(StringComparer.Ordinal).Count() != plan.ItemIds.Count)
            Add(DuplicateItem);
        if (plan.ItemIds.Any(id => !context.Candidates.ContainsKey(id)))
            Add(UnknownItem);

        var packed = plan.ItemIds.ToHashSet(StringComparer.Ordinal);
        foreach (var date in context.Dates)
        {
            if (plan.Days.Count(d => d.Date == date) != 1)
                Add(DayMissing);
        }
        if (plan.Days.Any(d => !context.Dates.Contains(d.Date)))
            Add(DayUnknown);

        foreach (var day in plan.Days)
        {
            if (day.Slots.Any(s => s.ItemId is null || !packed.Contains(s.ItemId)))
                Add(DayUsesUnpackedPiece);

            var pieces = day.Slots
                .Select(s => new SlotPiece(s.Slot, s.ItemId, s.ProductId,
                    s.ItemId is not null && context.Candidates.TryGetValue(s.ItemId, out var c) ? c.Category : null))
                .ToList();
            if (OutfitSlotRules.Validate(pieces).Count > 0)
                Add(DayInvalidLook);
        }

        var wears = PlannedWears(plan);
        if (RequiresMinWears(context.Dates.Count))
        {
            if (wears.Values.Any(w => w < MinWearsPerPiece))
                Add(PieceWornOnce);
        }
        else if (wears.Values.Any(w => w < 1))
        {
            Add(PieceUnused);
        }

        if (context is { CabinOnly: true, CabinMaxItems: > 0 } && plan.ItemIds.Count > context.CabinMaxItems)
            Add(CabinLimit);

        return errors;
    }

    /// <summary>Model output -> plan. null when the structure itself is unusable (no list or no days).</summary>
    public static PackPlan? FromModel(ModelPackOutput? output)
    {
        if (output?.ItemIds is not { Count: > 0 } ids || output.Days is not { Count: > 0 } days || days.Any(d => d.Date is null))
            return null;

        return new PackPlan(ids, days
            .Select(d => new PackDayPlan(
                d.Date!,
                string.IsNullOrWhiteSpace(d.Title) ? null : d.Title.Trim(),
                StylistOutputGuard.TryParseEnum<Occasion>(d.Occasion, out var occasion) ? occasion : null,
                d.Slots?.ToRefs() ?? []))
            .ToList());
    }

    /// <summary>
    /// "Eksik parça tespiti": what the wardrobe cannot cover for this trip, as catalog slot placeholders
    /// (productId is filled later by the catalog side — "Eksikleri tamamla"). Rule-based, never from the model.
    /// </summary>
    public static IReadOnlyList<MissingPiece> MissingPieces(IEnumerable<CandidateItem> wardrobe, IEnumerable<DailyForecast> forecast, int coldBelowC)
    {
        var categories = wardrobe.Select(i => i.Category).ToHashSet();
        var days = forecast.ToList();
        var missing = new List<MissingPiece>();

        if (!categories.Contains(ItemCategory.Shoes))
            missing.Add(new MissingPiece(OutfitSlot.Shoes, ItemCategory.Shoes, MissingPieceReason.NoShoes));

        if (!categories.Contains(ItemCategory.Outerwear))
        {
            if (days.Any(d => d.Condition is WeatherCondition.Rain or WeatherCondition.Storm or WeatherCondition.Snow))
                missing.Add(new MissingPiece(OutfitSlot.Outerwear, ItemCategory.Outerwear, MissingPieceReason.Rain));
            else if (days.Any(d => d.MinTempC < coldBelowC))
                missing.Add(new MissingPiece(OutfitSlot.Outerwear, ItemCategory.Outerwear, MissingPieceReason.Cold));
        }

        return missing;
    }

    public static Occasion OccasionFor(TripType type) => type switch
    {
        TripType.Business => Occasion.Office,
        TripType.Dinner => Occasion.Dinner,
        _ => Occasion.Travel,
    };
}

/// <summary>
/// Greedy rule-based suitcase used when the model's list fails PackingRules. With n days it packs
/// ⌊n/2⌋ tops (or dresses) and ⌊n/3⌋ bottoms — at least one of each — one pair of shoes (two from 6 days on),
/// one outer layer when the weather asks for it and one bag, then rotates them over the days, so every piece is worn
/// at least twice whenever the trip has 2+ days. Cabin-only shrinks tops, then bottoms, then drops bag and outer layer.
/// Returns null when the wardrobe cannot dress a single day (fewer than 2 usable pieces).
/// </summary>
public static class RuleBasedPacking
{
    public static PackPlan? Build(PackingContext context, bool withOuterwear, IReadOnlyList<Occasion>? occasions = null)
    {
        var days = context.Dates.Count;
        if (days == 0)
            return null;

        var ordered = StylistCandidateSelector.LeastWornFirst(context.Candidates.Values).ToList();
        List<CandidateItem> Of(params ItemCategory[] categories) => ordered.Where(c => categories.Contains(c.Category)).ToList();

        var tops = Of(ItemCategory.Top);
        var bottoms = Of(ItemCategory.Bottom);
        var useSeparates = tops.Count > 0 && bottoms.Count > 0;
        var bases = useSeparates ? tops : Of(ItemCategory.Dress);
        if (bases.Count == 0)
            return null;

        var baseCount = Math.Min(bases.Count, Math.Max(1, days / 2));
        var bottomCount = useSeparates ? Math.Min(bottoms.Count, Math.Max(1, days / 3)) : 0;
        var shoes = Of(ItemCategory.Shoes).Take(days >= 6 ? 2 : 1).ToList();
        var outer = withOuterwear ? Of(ItemCategory.Outerwear).Take(1).ToList() : [];
        var bags = Of(ItemCategory.Bag, ItemCategory.Accessory).Take(1).ToList();

        if (context is { CabinOnly: true, CabinMaxItems: > 0 })
        {
            int Total() => baseCount + bottomCount + shoes.Count + outer.Count + bags.Count;
            while (Total() > context.CabinMaxItems && baseCount > 1) baseCount--;
            while (Total() > context.CabinMaxItems && bottomCount > 1) bottomCount--;
            if (Total() > context.CabinMaxItems) bags.Clear();
            if (Total() > context.CabinMaxItems) outer.Clear();
            if (Total() > context.CabinMaxItems && shoes.Count > 1) shoes.RemoveAt(1);
            if (Total() > context.CabinMaxItems)
                return null;
        }

        var dayPlans = new List<PackDayPlan>();
        for (var d = 0; d < days; d++)
        {
            var slots = new List<SlotRef> { new(OutfitSlot.Top, bases[d % baseCount].Id) };
            if (bottomCount > 0) slots.Add(new SlotRef(OutfitSlot.Bottom, bottoms[d % bottomCount].Id));
            if (outer.Count > 0) slots.Add(new SlotRef(OutfitSlot.Outerwear, outer[0].Id));
            if (shoes.Count > 0) slots.Add(new SlotRef(OutfitSlot.Shoes, shoes[d % shoes.Count].Id));
            if (bags.Count > 0) slots.Add(new SlotRef(OutfitSlot.BagAccessory, bags[0].Id));
            if (slots.Count < OutfitSlotRules.MinPieces)
                return null;

            Occasion? occasion = occasions is { Count: > 0 } ? occasions[d % occasions.Count] : null;
            dayPlans.Add(new PackDayPlan(context.Dates[d], null, occasion, slots));
        }

        var itemIds = dayPlans.SelectMany(p => p.Slots).Select(s => s.ItemId!).Distinct(StringComparer.Ordinal).ToList();
        var plan = new PackPlan(itemIds, dayPlans);
        return PackingRules.Validate(plan, context).Count == 0 ? plan : null;
    }
}
