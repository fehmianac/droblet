using Domain.Enum;

namespace Domain.Services.Styling;

public sealed record PackDayPlan(string Date, string? Label, Occasion? Occasion, IReadOnlyList<SlotRef> Slots);

public sealed record PackPlan(IReadOnlyList<string> ItemIds, IReadOnlyList<PackDayPlan> Days);

/// <param name="CabinMaxItems">Packing:CabinMaxItems. 0 = the cabin limit is not enforced.</param>
/// <param name="DayOccasions">
/// The occasion of each trip date (same order as Dates; CapsuleRules.DayOccasions). Given by the worker: the capsule
/// size bounds and the per-occasion look rule are then checked. Null (accepting a stored draft) = structural rules only.
/// </param>
/// <param name="LayerDates">Dates whose forecast asks for an outer layer (cold or wet). Null = weather is not checked.</param>
public sealed record PackingContext(
    IReadOnlyDictionary<string, CandidateItem> Candidates,
    IReadOnlyList<string> Dates,
    bool CabinOnly,
    int CabinMaxItems,
    IReadOnlyList<Occasion?>? DayOccasions = null,
    IReadOnlySet<string>? LayerDates = null)
{
    /// <summary>The piece limit that applies to this trip; null = none (not cabin-only, or the limit is 0).</summary>
    public int? CabinLimit => CabinOnly && CabinMaxItems > 0 ? CabinMaxItems : null;

    /// <summary>The occasion planned for a trip date; null when unknown.</summary>
    public Occasion? OccasionOn(string date)
    {
        var index = Dates.ToList().IndexOf(date);
        return DayOccasions is { } occasions && index >= 0 && index < occasions.Count ? occasions[index] : null;
    }
}

/// <summary>How many pieces of each kind a sensible capsule for the trip holds (CapsuleRules.Target).</summary>
public sealed record CapsuleTarget(int Tops, int Bottoms, int Shoes, int Outerwear, int Bags)
{
    public int Pieces => Tops + Bottoms + Shoes + Outerwear + Bags;
}

/// <summary>
/// Trip capsule sizing — deterministic: the same numbers are given to the model and used to build the rule-based list.
/// One look per trip date; dates take the trip types' occasions in turn (business → office, dinner → dinner,
/// sightseeing → travel; e.g. business + dinner over 3 days = office, dinner, office).
///  • Tops (or dresses), per occasion: dressy occasions (office, dinner, wedding) get a fresh top every day up to 3 days,
///    then one for every 1.5 days; casual occasions one for every 2 days. Occasions do not borrow each other's tops.
///  • Bottoms per dress level (dressy / casual): one for every 3 days of that level — bottoms are re-worn.
///  • Shoes: one pair per dress level, a second pair from 6 days on (at most 2).
///  • One outer layer when any day is cold or wet (worn on those days), one bag.
/// Example: 3 days business + dinner, one rainy day → 2 office tops + 1 dinner top + 1 bottom + 1 pair of shoes
/// + 1 coat + 1 bag = 7 pieces for 3 looks; the bottom, shoes and bag are worn every day.
/// Re-wear: on a multi-day trip every packed piece is worn and the pieces are worn at least <see cref="MinRewearRatio"/>
/// times on average; a piece may be worn once when it gives a day (an occasion) its own look.
/// </summary>
public static class CapsuleRules
{
    public const double MinRewearRatio = 1.5;
    /// <summary>A model list may exceed the target by this many pieces.</summary>
    public const int AboveTarget = 1;
    /// <summary>…and fall short of what the wardrobe can supply toward the target by this many.</summary>
    public const int BelowTarget = 2;

    public static bool IsDressy(Occasion? occasion) => occasion is Occasion.Office or Occasion.Dinner or Occasion.Wedding;

    public static bool IsOuter(ItemCategory category) => category is ItemCategory.Outerwear or ItemCategory.Skiwear;

    /// <summary>The occasion of every trip day: the trip types' occasions in turn; null (casual) when the trip has none.</summary>
    public static IReadOnlyList<Occasion?> DayOccasions(int days, IReadOnlyList<Occasion>? occasions) =>
        Enumerable.Range(0, Math.Max(0, days)).Select(d => occasions is { Count: > 0 } ? occasions[d % occasions.Count] : (Occasion?)null).ToList();

    public static int TopsFor(Occasion? occasion, int days) =>
        days <= 0 ? 0
        : IsDressy(occasion) ? (days <= 3 ? days : (int)Math.Ceiling(days / 1.5))
        : (int)Math.Ceiling(days / 2.0);

    public static int BottomsFor(int levelDays) => levelDays <= 0 ? 0 : (int)Math.Ceiling(levelDays / 3.0);

    public static CapsuleTarget Target(IReadOnlyList<Occasion?> dayOccasions, bool outerLayer)
    {
        var days = dayOccasions.Count;
        if (days == 0)
            return new CapsuleTarget(0, 0, 0, 0, 0);
        var tops = dayOccasions.GroupBy(o => o).Sum(g => TopsFor(g.Key, g.Count()));
        var levels = dayOccasions.GroupBy(IsDressy).ToList();
        var bottoms = levels.Sum(l => BottomsFor(l.Count()));
        var shoes = Math.Min(2, levels.Count + (days >= 6 ? 1 : 0));
        return new CapsuleTarget(tops, bottoms, shoes, outerLayer ? 1 : 0, 1);
    }

    /// <summary>Slot uses per packed piece over the whole trip (0 for an empty list).</summary>
    public static double RewearRatio(PackPlan plan)
    {
        var wears = PackingRules.PlannedWears(plan);
        return wears.Count == 0 ? 0 : wears.Values.Sum() / (double)wears.Count;
    }

    /// <summary>The target capped by what the wardrobe holds (separates first, dresses when there are no separates).</summary>
    public static int Achievable(CapsuleTarget target, IEnumerable<CandidateItem> candidates)
    {
        var list = candidates.ToList();
        int Count(Func<ItemCategory, bool> match) => list.Count(c => match(c.Category));
        var tops = Count(c => c == ItemCategory.Top);
        var bottoms = Count(c => c == ItemCategory.Bottom);
        var separates = tops > 0 && bottoms > 0;
        var bases = separates ? tops : Count(c => c == ItemCategory.Dress);
        return Math.Min(target.Tops, bases)
               + (separates ? Math.Min(target.Bottoms, bottoms) : 0)
               + Math.Min(target.Shoes, Count(c => c == ItemCategory.Shoes))
               + Math.Min(target.Outerwear, Count(IsOuter))
               + Math.Min(target.Bags, Count(c => c is ItemCategory.Bag or ItemCategory.Accessory));
    }

    /// <summary>The target of a packing context (outer layer when a day asks for one and the wardrobe has one); null without day occasions.</summary>
    public static CapsuleTarget? TargetFor(PackingContext context) =>
        context.DayOccasions is { Count: > 0 } occasions
            ? Target(occasions, context.LayerDates is { Count: > 0 } && context.Candidates.Values.Any(c => IsOuter(c.Category)))
            : null;

    /// <summary>Piece-count bounds for a model list; null when the context carries no day occasions.</summary>
    public static (int Min, int Max)? PieceRange(PackingContext context)
    {
        if (TargetFor(context) is not { } target)
            return null;
        var reachable = Math.Min(Achievable(target, context.Candidates.Values), context.CabinLimit ?? int.MaxValue);
        return (Math.Max(1, reachable - BelowTarget), target.Pieces + AboveTarget);
    }
}

/// <param name="Plan">The list within the cabin limit; null when it cannot be brought under the limit by dropping pieces.</param>
/// <param name="DroppedItemIds">Pieces that were taken out (empty = the list already fitted).</param>
public sealed record CabinTrim(PackPlan? Plan, IReadOnlyList<string> DroppedItemIds);

/// <summary>
/// Suitcase rules — the same class validates the model's list (worker) and the accepted draft (Api).
///  - every packed piece exists in the wardrobe (candidate list) and is packed once;
///  - every trip day has exactly one look, built only from packed pieces of the wardrobe (no catalog product), valid per OutfitSlotRules;
///  - every packed piece is worn; on a multi-day trip pieces are re-worn: slot uses ≥ CapsuleRules.MinRewearRatio × pieces
///    (hard-coded, not config). "Her parça en az 2 kez giyiliyor" is claimed only when it is true (EveryPieceWornTwice);
///  - with day occasions (worker): the list size stays within CapsuleRules.PieceRange, and when more than one top-slot
///    piece is packed, days of different occasions never get the identical look;
///  - with layer dates (worker): a packed outer layer is worn on every cold / wet day, and the wardrobe's outer layer is
///    packed for such a trip unless a cabin limit applies;
///  - cabin-only: the list never exceeds CabinMaxItems (every piece counts once, shoes and bags included; 0 = no limit).
/// A list that is only too long for the cabin is trimmed by rule (TrimToCabinLimit keeps the pieces used in the most
/// looks); any other failure is not repaired: RuleBasedPacking builds a greedy list instead.
/// </summary>
public static class PackingRules
{
    public const int MinWearsPerPiece = 2;

    /// <summary>Which slots keep their piece first when a cabin list has to shrink.</summary>
    private static readonly OutfitSlot[] CabinSlotPriority = [OutfitSlot.Top, OutfitSlot.Bottom, OutfitSlot.Shoes, OutfitSlot.Outerwear, OutfitSlot.BagAccessory];

    public const string UnknownItem = "pack_unknown_item";
    public const string DuplicateItem = "pack_duplicate_item";
    public const string DayMissing = "pack_day_missing";
    public const string DayUnknown = "pack_day_unknown";
    public const string DayUsesUnpackedPiece = "pack_day_uses_unpacked_piece";
    public const string DayInvalidLook = "pack_day_invalid_look";
    public const string TooLittleRewear = "pack_too_little_rewear";
    public const string PieceUnused = "pack_piece_unused";
    public const string TooManyPieces = "pack_too_many_pieces";
    public const string TooFewPieces = "pack_too_few_pieces";
    public const string OccasionLookRepeated = "pack_occasion_look_repeated";
    public const string WeatherLayerMissing = "pack_weather_layer_missing";
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
        if (wears.Values.Any(w => w < 1))
            Add(PieceUnused);
        if (RequiresMinWears(context.Dates.Count) && wears.Count > 0 && CapsuleRules.RewearRatio(plan) < CapsuleRules.MinRewearRatio)
            Add(TooLittleRewear);

        var count = plan.ItemIds.Distinct(StringComparer.Ordinal).Count();
        if (context.CabinLimit is { } limit && count > limit)
            Add(CabinLimit);

        if (CapsuleRules.PieceRange(context) is { } range)
        {
            if (count > range.Max)
                Add(TooManyPieces);
            else if (count < range.Min)
                Add(TooFewPieces);
            if (RepeatsALookAcrossOccasions(plan, context))
                Add(OccasionLookRepeated);
        }

        if (context.LayerDates is { Count: > 0 } layerDates && MissesWeatherLayer(plan, context, layerDates))
            Add(WeatherLayerMissing);

        return errors;
    }

    /// <summary>Per-occasion looks: two days of different occasions wearing exactly the same pieces (when the list has a choice of tops).</summary>
    private static bool RepeatsALookAcrossOccasions(PackPlan plan, PackingContext context)
    {
        var topPieces = plan.ItemIds.Count(id => context.Candidates.TryGetValue(id, out var c) && OutfitSlotRules.Accepts(OutfitSlot.Top, c.Category));
        if (topPieces < 2)
            return false;
        var looks = plan.Days
            .Select(d => (Occasion: context.OccasionOn(d.Date),
                Signature: string.Join(',', d.Slots.Select(s => s.ItemId ?? "").OrderBy(id => id, StringComparer.Ordinal))))
            .ToList();
        return looks.Any(a => looks.Any(b => a.Occasion != b.Occasion && a.Signature == b.Signature));
    }

    /// <summary>A packed outer layer missing on a cold / wet day, or the wardrobe's outer layer left at home without a cabin limit.</summary>
    private static bool MissesWeatherLayer(PackPlan plan, PackingContext context, IReadOnlySet<string> layerDates)
    {
        var packedOuter = plan.ItemIds
            .Where(id => context.Candidates.TryGetValue(id, out var c) && CapsuleRules.IsOuter(c.Category))
            .ToHashSet(StringComparer.Ordinal);
        if (packedOuter.Count == 0)
            return context.CabinLimit is null && context.Candidates.Values.Any(c => CapsuleRules.IsOuter(c.Category));
        return plan.Days.Where(d => layerDates.Contains(d.Date))
            .Any(d => !d.Slots.Any(s => s.ItemId is not null && packedOuter.Contains(s.ItemId)));
    }

    /// <summary>
    /// Brings a list that is too long for a cabin bag under the limit, by rule (never by the model):
    /// first the most used piece of every slot the looks use stays (top, bottom, shoes, outer layer, bag — so no look
    /// loses a whole slot while there is room), then the remaining places go to the pieces used in the most daily
    /// looks (ties: the order of the list). Every dropped piece is replaced in its looks by the most used kept piece
    /// that fits the same slot, or the slot is left empty.
    /// The result is only returned when it still passes Validate — otherwise Plan is null and the caller falls back to
    /// RuleBasedPacking. A list within the limit (or a trip without one) comes back unchanged.
    /// </summary>
    public static CabinTrim TrimToCabinLimit(PackPlan plan, PackingContext context)
    {
        var ids = plan.ItemIds.Distinct(StringComparer.Ordinal).ToList();
        if (context.CabinLimit is not { } limit || ids.Count <= limit)
            return new CabinTrim(plan, []);

        var wears = PlannedWears(plan);
        var ranked = ids
            .Select((id, index) => (Id: id, Index: index, Wears: wears.GetValueOrDefault(id)))
            .OrderByDescending(p => p.Wears).ThenBy(p => p.Index)
            .Select(p => p.Id)
            .ToList();
        // The slot a piece is (mostly) worn in.
        var slotOf = plan.Days.SelectMany(d => d.Slots).Where(s => s.ItemId is not null)
            .GroupBy(s => s.ItemId!, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.GroupBy(s => s.Slot).OrderByDescending(x => x.Count()).First().Key, StringComparer.Ordinal);

        var keptSet = new HashSet<string>(StringComparer.Ordinal);
        foreach (var slot in CabinSlotPriority)
        {
            if (keptSet.Count < limit && ranked.FirstOrDefault(id => slotOf.TryGetValue(id, out var s) && s == slot) is { } best)
                keptSet.Add(best);
        }
        foreach (var id in ranked)
        {
            if (keptSet.Count >= limit)
                break;
            keptSet.Add(id);
        }
        var kept = ids.Where(keptSet.Contains).ToList();
        var dropped = ids.Where(id => !keptSet.Contains(id)).ToList();

        var days = new List<PackDayPlan>(plan.Days.Count);
        foreach (var day in plan.Days)
        {
            var used = day.Slots.Where(s => s.ItemId is not null && keptSet.Contains(s.ItemId)).Select(s => s.ItemId!).ToHashSet(StringComparer.Ordinal);
            var slots = new List<SlotRef>(day.Slots.Count);
            foreach (var slot in day.Slots)
            {
                if (slot.ItemId is not null && keptSet.Contains(slot.ItemId))
                {
                    slots.Add(slot);
                    continue;
                }

                // Most used kept piece that may sit in this slot and is not already in this look.
                var replacement = kept
                    .Where(id => !used.Contains(id) && context.Candidates.TryGetValue(id, out var c) && OutfitSlotRules.Accepts(slot.Slot, c.Category))
                    .OrderByDescending(id => wears.GetValueOrDefault(id))
                    .FirstOrDefault();
                if (replacement is null)
                    continue;
                used.Add(replacement);
                slots.Add(new SlotRef(slot.Slot, replacement));
            }
            days.Add(day with { Slots = slots });
        }

        var trimmed = new PackPlan(kept, days);
        return new CabinTrim(Validate(trimmed, context).Count == 0 ? trimmed : null, dropped);
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
            if (days.Any(d => WeatherRules.IsWet(d.Condition)))
                missing.Add(new MissingPiece(OutfitSlot.Outerwear, ItemCategory.Outerwear, MissingPieceReason.Rain));
            else if (days.Any(d => d.MinC < coldBelowC))
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
/// Rule-based suitcase, used when the model's list fails PackingRules. First the capsule of CapsuleRules: tops per
/// occasion, bottoms and shoes per dress level, an outer layer worn on the cold / wet days, one bag — least-worn pieces
/// first, rotated over the days so bottoms, shoes and the bag are re-worn. Cabin-only (PackingContext.CabinLimit)
/// shrinks tops, then bottoms, then drops the bag, the outer layer and the second pair of shoes, lets occasions share
/// their tops and bottoms and — for a very small limit — drops the shoes. When the capsule does not pass PackingRules
/// (a thin wardrobe) the minimal list is used instead: ⌊n/2⌋ tops (or dresses) and ⌊n/3⌋ bottoms rotated so every
/// piece is worn at least twice on a multi-day trip. Returns null when the wardrobe cannot dress a single day.
/// </summary>
public static class RuleBasedPacking
{
    public static PackPlan? Build(PackingContext context, bool withOuterwear, IReadOnlyList<Occasion>? occasions = null)
    {
        var days = context.Dates.Count;
        if (days == 0)
            return null;

        var dayOccasions = context.DayOccasions is { } given && given.Count == days ? given : CapsuleRules.DayOccasions(days, occasions);
        IReadOnlySet<string> layerDays = context.LayerDates
            ?? (withOuterwear ? context.Dates.ToHashSet(StringComparer.Ordinal) : new HashSet<string>(StringComparer.Ordinal));

        if (Capsule(context, dayOccasions, layerDays) is { } capsule && PackingRules.Validate(capsule, context).Count == 0)
            return capsule;
        // The minimal list is judged on the structural rules only (it is deliberately smaller than the capsule).
        return Minimal(context, withOuterwear || layerDays.Count > 0, dayOccasions) is { } minimal
               && PackingRules.Validate(minimal, context with { DayOccasions = null }).Count == 0
            ? minimal
            : null;
    }

    private static PackPlan? Capsule(PackingContext context, IReadOnlyList<Occasion?> dayOccasions, IReadOnlySet<string> layerDays)
    {
        var ordered = StylistCandidateSelector.LeastWornFirst(context.Candidates.Values).ToList();
        List<CandidateItem> Of(Func<ItemCategory, bool> match) => ordered.Where(c => match(c.Category)).ToList();

        var tops = Of(c => c == ItemCategory.Top);
        var bottoms = Of(c => c == ItemCategory.Bottom);
        var separates = tops.Count > 0 && bottoms.Count > 0;
        var bases = separates ? tops : Of(c => c == ItemCategory.Dress);
        if (bases.Count == 0)
            return null;
        var shoes = Of(c => c == ItemCategory.Shoes);
        var outers = Of(CapsuleRules.IsOuter);
        var bags = Of(c => c is ItemCategory.Bag or ItemCategory.Accessory);

        var dates = context.Dates;
        var target = CapsuleRules.Target(dayOccasions, layerDays.Count > 0 && outers.Count > 0);

        // Groups in order of first appearance: occasions (tops) and dress levels (bottoms, shoes).
        var groups = dayOccasions.Distinct().ToList();
        var levels = dayOccasions.Select(CapsuleRules.IsDressy).Distinct().ToList();
        var topCounts = groups.Select(g => CapsuleRules.TopsFor(g, dayOccasions.Count(o => o == g))).ToArray();
        var bottomCounts = levels.Select(l => separates ? CapsuleRules.BottomsFor(dayOccasions.Count(o => CapsuleRules.IsDressy(o) == l)) : 0).ToArray();
        var shoeCount = target.Shoes;
        var outerCount = target.Outerwear;
        var bagCount = target.Bags;

        int Distinct() => Math.Min(topCounts.Sum(), bases.Count) + Math.Min(bottomCounts.Sum(), bottoms.Count)
                          + Math.Min(shoeCount, shoes.Count) + Math.Min(outerCount, outers.Count) + Math.Min(bagCount, bags.Count);

        if (context.CabinLimit is { } limit)
        {
            while (Distinct() > limit)
            {
                if (DecrementLargest(topCounts)) continue;
                if (DecrementLargest(bottomCounts)) continue;
                if (bagCount > 0) { bagCount = 0; continue; }
                if (outerCount > 0) { outerCount = 0; continue; }
                if (shoeCount > 1) { shoeCount--; continue; }
                if (ShareLast(topCounts)) continue;
                if (ShareLast(bottomCounts)) continue;
                if (shoeCount > 0) { shoeCount = 0; continue; }
                return null;
            }
        }

        // A wardrobe with fewer pieces than the target: every occasion still gets its own top while there are enough.
        while (topCounts.Sum() > bases.Count && DecrementLargest(topCounts)) { }
        while (bottomCounts.Sum() > bottoms.Count && DecrementLargest(bottomCounts)) { }

        var topsByGroup = Allocate(bases, topCounts);
        var bottomsByLevel = separates ? Allocate(bottoms, bottomCounts) : levels.Select(_ => new List<CandidateItem>()).ToList();
        var shoeList = shoes.Take(shoeCount).ToList();
        var shoesByLevel = levels.Select((_, j) => ShoesFor(shoeList, j, levels.Count)).ToList();
        var outer = outers.Take(outerCount).FirstOrDefault();
        var bag = bags.Take(bagCount).FirstOrDefault();

        var topTurn = new int[groups.Count];
        var bottomTurn = new int[levels.Count];
        var shoeTurn = new int[levels.Count];
        var dayPlans = new List<PackDayPlan>(dates.Count);
        for (var d = 0; d < dates.Count; d++)
        {
            var g = groups.IndexOf(dayOccasions[d]);
            var l = levels.IndexOf(CapsuleRules.IsDressy(dayOccasions[d]));
            var slots = new List<SlotRef> { new(OutfitSlot.Top, Next(topsByGroup[g], ref topTurn[g]).Id) };
            if (bottomsByLevel[l].Count > 0) slots.Add(new SlotRef(OutfitSlot.Bottom, Next(bottomsByLevel[l], ref bottomTurn[l]).Id));
            if (outer is not null && layerDays.Contains(dates[d])) slots.Add(new SlotRef(OutfitSlot.Outerwear, outer.Id));
            if (shoesByLevel[l].Count > 0) slots.Add(new SlotRef(OutfitSlot.Shoes, Next(shoesByLevel[l], ref shoeTurn[l]).Id));
            if (bag is not null) slots.Add(new SlotRef(OutfitSlot.BagAccessory, bag.Id));
            if (slots.Count < OutfitSlotRules.MinPieces)
                return null;
            dayPlans.Add(new PackDayPlan(dates[d], null, dayOccasions[d], slots));
        }

        var itemIds = dayPlans.SelectMany(p => p.Slots).Select(s => s.ItemId!).Distinct(StringComparer.Ordinal).ToList();
        return new PackPlan(itemIds, dayPlans);
    }

    private static CandidateItem Next(List<CandidateItem> pieces, ref int turn) => pieces[turn++ % pieces.Count];

    /// <summary>Shoes round-robin over the dress levels; a level left without a pair shares one.</summary>
    private static List<CandidateItem> ShoesFor(List<CandidateItem> shoes, int level, int levels)
    {
        if (shoes.Count == 0)
            return [];
        var own = shoes.Where((_, i) => i % levels == level).ToList();
        return own.Count > 0 ? own : [shoes[level % shoes.Count]];
    }

    /// <summary>Consecutive slices of the ordered list per group; a group with 0 shares the first group's slice.</summary>
    private static List<List<CandidateItem>> Allocate(List<CandidateItem> pieces, int[] counts)
    {
        var result = new List<List<CandidateItem>>(counts.Length);
        var next = 0;
        foreach (var count in counts)
        {
            result.Add(Enumerable.Range(0, count).Select(i => pieces[(next + i) % pieces.Count]).Distinct().ToList());
            next += count;
        }
        var shared = result.FirstOrDefault(r => r.Count > 0) ?? [pieces[0]];
        for (var i = 0; i < result.Count; i++)
        {
            if (result[i].Count == 0)
                result[i] = shared;
        }
        return result;
    }

    private static bool DecrementLargest(int[] counts)
    {
        var max = counts.Length == 0 ? 0 : counts.Max();
        if (max <= 1)
            return false;
        counts[Array.IndexOf(counts, max)]--;
        return true;
    }

    /// <summary>The last group that still has its own pieces shares the first group's instead.</summary>
    private static bool ShareLast(int[] counts)
    {
        if (counts.Count(c => c > 0) <= 1)
            return false;
        counts[Array.FindLastIndex(counts, c => c > 0)] = 0;
        return true;
    }

    /// <summary>The smallest list that wears every piece at least twice on a multi-day trip.</summary>
    private static PackPlan? Minimal(PackingContext context, bool withOuterwear, IReadOnlyList<Occasion?> dayOccasions)
    {
        var days = context.Dates.Count;
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
        var outer = withOuterwear ? Of(ItemCategory.Outerwear, ItemCategory.Skiwear).Take(1).ToList() : [];
        var bags = Of(ItemCategory.Bag, ItemCategory.Accessory).Take(1).ToList();

        if (context.CabinLimit is { } limit)
        {
            int Total() => baseCount + bottomCount + shoes.Count + outer.Count + bags.Count;
            while (Total() > limit && baseCount > 1) baseCount--;
            while (Total() > limit && bottomCount > 1) bottomCount--;
            if (Total() > limit) bags.Clear();
            if (Total() > limit) outer.Clear();
            if (Total() > limit && shoes.Count > 1) shoes.RemoveAt(1);
            if (Total() > limit) shoes.Clear();   // a very small limit: the look itself (top + bottom, or a dress) comes first
            if (Total() > limit)
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
            dayPlans.Add(new PackDayPlan(context.Dates[d], null, dayOccasions[d], slots));
        }

        var itemIds = dayPlans.SelectMany(p => p.Slots).Select(s => s.ItemId!).Distinct(StringComparer.Ordinal).ToList();
        return new PackPlan(itemIds, dayPlans);
    }
}
