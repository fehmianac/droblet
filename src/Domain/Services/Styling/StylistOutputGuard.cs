using System.Text.RegularExpressions;
using Domain.Enum;

namespace Domain.Services.Styling;

public sealed record GuardContext(
    IReadOnlyDictionary<string, CandidateItem> Candidates,
    IReadOnlyDictionary<string, ItemCategory> ProductCandidates,
    bool OnlyMyWardrobe,
    string? PinnedItemId,
    int MaxTitleLength,
    int MaxExplanationLength)
{
    public static GuardContext For(IEnumerable<CandidateItem> candidates, bool onlyMyWardrobe, string? pinnedItemId = null,
        int maxTitleLength = 40, int maxExplanationLength = 280, IReadOnlyDictionary<string, ItemCategory>? products = null) =>
        new(candidates.ToDictionary(c => c.Id, StringComparer.Ordinal), products ?? new Dictionary<string, ItemCategory>(),
            onlyMyWardrobe, pinnedItemId, maxTitleLength, maxExplanationLength);
}

/// <summary>
/// "Model önerir, sunucu karar verir." A model suggestion is accepted whole or not at all — it is never repaired:
///  - every item id is in the candidate list given to the model (so: exists, not deleted, the caller's own tenant);
///  - every product id is in the catalog candidate list; with onlyMyWardrobe there is no missing piece at all;
///  - the slots pass OutfitSlotRules (one piece per slot, category fits, dress closes bottom, ≥ 2 pieces);
///  - it is wearable: a top with a bottom, or a dress; shoes whenever the candidates contain shoes;
///  - a pinned piece is part of it; a missing piece names an empty slot and a category that fits it;
///  - title / explanation fit the surface.
/// Rejected suggestions are replaced by the rule-based fallback (RuleBasedOutfit).
/// Text that comments on body or weight fails the whole job with GuardRejected (ViolatesContentPolicy).
/// </summary>
public static partial class StylistOutputGuard
{
    public const string UnknownItem = "unknown_item";
    public const string UnknownProduct = "unknown_product";
    public const string WardrobeOnlyViolated = "wardrobe_only_violated";
    public const string IncompleteOutfit = "incomplete_outfit";
    public const string ShoesMissing = "shoes_missing";
    public const string PinnedMissing = "pinned_missing";
    public const string TextTooLong = "text_too_long";
    public const string InvalidMissingPiece = "invalid_missing_piece";
    public const string RepeatedLook = "repeated_look";

    public const string SourceModel = "model";
    public const string SourceRule = "rule";

    public static IReadOnlyList<string> Violations(ModelOutfit outfit, GuardContext context)
    {
        var errors = new List<string>();
        void Add(string code)
        {
            if (!errors.Contains(code))
                errors.Add(code);
        }

        var refs = outfit.Slots?.ToRefs() ?? [];
        var pieces = refs
            .Select(r => new SlotPiece(r.Slot, r.ItemId, null, context.Candidates.TryGetValue(r.ItemId!, out var c) ? c.Category : null))
            .ToList();

        if (pieces.Any(p => p.Category is null))
            Add(UnknownItem);
        foreach (var code in OutfitSlotRules.Validate(pieces))
            Add(code);

        var top = pieces.FirstOrDefault(p => p.Slot == OutfitSlot.Top);
        if (top is null || (top.Category == ItemCategory.Top && pieces.All(p => p.Slot != OutfitSlot.Bottom)))
            Add(IncompleteOutfit);

        if (context.Candidates.Values.Any(c => c.Category == ItemCategory.Shoes) && pieces.All(p => p.Slot != OutfitSlot.Shoes))
            Add(ShoesMissing);

        if (context.PinnedItemId is { } pinned && context.Candidates.ContainsKey(pinned) && refs.All(r => r.ItemId != pinned))
            Add(PinnedMissing);

        var missing = outfit.Missing ?? [];
        if (context.OnlyMyWardrobe && missing.Count > 0)
            Add(WardrobeOnlyViolated);
        foreach (var piece in missing)
        {
            if (ParseMissing(piece, refs, context, out var code) is null)
                Add(code!);
        }

        if ((outfit.Title?.Trim().Length ?? 0) > context.MaxTitleLength || (outfit.Explanation?.Trim().Length ?? 0) > context.MaxExplanationLength)
            Add(TextTooLong);

        return errors;
    }

    /// <summary>The accepted draft, or null when any rule is violated.</summary>
    public static SuggestedOutfit? Accept(ModelOutfit outfit, GuardContext context, int index)
    {
        if (Violations(outfit, context).Count > 0)
            return null;

        var refs = outfit.Slots!.ToRefs();
        var missing = (outfit.Missing ?? []).Select(m => ParseMissing(m, refs, context, out _)!).ToList();
        return new SuggestedOutfit(index, Clean(outfit.Title), Clean(outfit.Explanation), SourceModel, refs, missing);
    }

    /// <summary>Accepted, pairwise different suggestions in model order (indexes are assigned by the caller).</summary>
    public static IReadOnlyList<SuggestedOutfit> AcceptDistinct(IEnumerable<ModelOutfit>? outfits, GuardContext context, int max)
    {
        var accepted = new List<SuggestedOutfit>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var outfit in outfits ?? [])
        {
            if (accepted.Count >= max)
                break;
            if (Accept(outfit, context, accepted.Count) is { } ok && seen.Add(Signature(ok.Slots)))
                accepted.Add(ok);
        }
        return accepted;
    }

    /// <summary>
    /// Week plan: one accepted look per requested date (the first model day for that date); a day repeating the
    /// previous day's look is rejected. Dates without an accepted look are simply absent (the caller falls back).
    /// </summary>
    public static IReadOnlyDictionary<string, SuggestedOutfit> AcceptWeek(ModelWeekOutput? output, IReadOnlyList<string> dates, GuardContext context)
    {
        var accepted = new Dictionary<string, SuggestedOutfit>(StringComparer.Ordinal);
        string? previous = null;
        for (var i = 0; i < dates.Count; i++)
        {
            var day = output?.Days?.FirstOrDefault(d => d.Date == dates[i]);
            var outfit = day is null ? null : Accept(new ModelOutfit(day.Title, day.Explanation, day.Slots, null), context, i);
            var signature = outfit is null ? null : Signature(outfit.Slots);
            if (outfit is not null && signature != previous)
                accepted[dates[i]] = outfit;
            else
                signature = null;
            previous = signature;
        }
        return accepted;
    }

    public static string Signature(IEnumerable<SlotRef> slots) =>
        string.Join('|', slots.Select(s => s.ItemId ?? $"p:{s.ProductId}").Order(StringComparer.Ordinal));

    /// <summary>Health / body commentary ("kilo ver", "zayıf gösterir", "slimming"…) is never shown: the job is rejected.</summary>
    public static bool ViolatesContentPolicy(IEnumerable<string?> texts) =>
        texts.Any(t => !string.IsNullOrWhiteSpace(t) && BodyTalk().IsMatch(t));

    /// <summary>
    /// Teen accounts (docs/api/teen.md §4): body talk, and also suggestive / revealing wording ("seksi", "dekolte", "sexy",
    /// "revealing"…), fails the job.
    /// </summary>
    public static bool ViolatesContentPolicy(IEnumerable<string?> texts, bool teen)
    {
        var list = texts.ToList();
        return ViolatesContentPolicy(list) || (teen && list.Any(t => !string.IsNullOrWhiteSpace(t) && SuggestiveTalk().IsMatch(t)));
    }

    [GeneratedRegex(
        @"(?<![\p{L}])(seksi\w*|çekici\w*|cezbedici\w*|ba[şs]tan [çc][ıi]kar\w*|dekolte\w*|g[öo]ğ[üu]s\w*|transparan\w*|i[çc] g[öo]steren|sexy|sultry|seductive|revealing|cleavage|plunging|sheer|lingerie|provocative|flirty|hot look)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SuggestiveTalk();

    public static IEnumerable<string?> Texts(ModelOutfitOutput? output) =>
        (output?.Suggestions ?? []).SelectMany(s => new[] { s.Title, s.Explanation });

    public static IEnumerable<string?> Texts(IEnumerable<ModelDay>? days) =>
        (days ?? []).SelectMany(d => new[] { d.Title, d.Explanation });

    private static MissingPiece? ParseMissing(ModelMissing piece, IReadOnlyList<SlotRef> filled, GuardContext context, out string? error)
    {
        error = InvalidMissingPiece;
        if (!TryParseEnum<OutfitSlot>(piece.Slot, out var slot) || filled.Any(r => r.Slot == slot))
            return null;

        ItemCategory? category = null;
        if (!string.IsNullOrWhiteSpace(piece.Category))
        {
            if (!TryParseEnum<ItemCategory>(piece.Category, out var parsed) || !OutfitSlotRules.Accepts(slot, parsed))
                return null;
            category = parsed;
        }

        var productId = string.IsNullOrWhiteSpace(piece.ProductId) ? null : piece.ProductId;
        if (productId is not null)
        {
            if (!context.ProductCandidates.TryGetValue(productId, out var productCategory))
            {
                error = UnknownProduct;
                return null;
            }
            if (!OutfitSlotRules.Accepts(slot, productCategory))
                return null;
            category ??= productCategory;
        }

        error = null;
        return new MissingPiece(slot, category, MissingPieceReason.Suggested, productId);
    }

    internal static bool TryParseEnum<T>(string? value, out T result) where T : struct, System.Enum
    {
        result = default;
        return !string.IsNullOrWhiteSpace(value)
               && !char.IsDigit(value[0]) && value[0] != '-'
               && System.Enum.TryParse(value, ignoreCase: true, out result)
               && System.Enum.IsDefined(result);
    }

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    [GeneratedRegex(
        @"(?<![\p{L}])(kilo(n|su|lu|ya|yu|dan|lar\w*)?\b|zay[ıi]f\w*|[şs]i[şs]man\w*|incelt\w*|ince g[öo]ster\w*|toplu g[öo]ster\w*|g[öo]be[ğg]\w*|basen\w*|diyet\w*|weight|slimming|slimmer|skinnier|thinner|fat(ter|test)?\b|chubby|overweight|diet\w*|tummy|belly)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex BodyTalk();
}

/// <param name="Segment">Menswear rules for men (see <see cref="RuleBasedOutfit"/>); women keep the phase 1 rules exactly.</param>
/// <param name="Occasion">The day's occasion (men: a tailored outer layer for office, dinner and wedding).</param>
public sealed record RuleOutfitOptions(
    string? PinnedItemId = null,
    bool WithOuterwear = false,
    bool OnlyMyWardrobe = true,
    int Offset = 0,
    IReadOnlySet<string>? ExcludeSignatures = null,
    Segment Segment = Segment.Women,
    Occasion? Occasion = null);

/// <summary>
/// Rule-based fallback so the user always sees a result when the model's suggestion fails the guard.
/// Deterministic: least-worn pieces first; top + bottom pairs alternate with dresses; shoes, an outer layer (when the
/// weather asks for one) and a bag/accessory rotate. No title or explanation is invented — the client shows its own text.
/// Men: top + bottom pairs first — an owned dress only when no pair can be made (never alternated in); for office, dinner
/// and wedding the outer layer (blazer / suit jacket) is added when there is one, whatever the weather.
/// </summary>
public static class RuleBasedOutfit
{
    public static IReadOnlyList<SuggestedOutfit> Build(IEnumerable<CandidateItem> candidates, int count, RuleOutfitOptions? options = null)
    {
        options ??= new RuleOutfitOptions();
        var ordered = StylistCandidateSelector.LeastWornFirst(candidates).ToList();
        List<CandidateItem> Of(params ItemCategory[] categories) => ordered.Where(c => categories.Contains(c.Category)).ToList();

        var tops = Of(ItemCategory.Top);
        var bottoms = Of(ItemCategory.Bottom);
        var dresses = Of(ItemCategory.Dress);
        var shoes = Of(ItemCategory.Shoes);
        var outerwear = Of(ItemCategory.Outerwear);
        var bags = Of(ItemCategory.Bag, ItemCategory.Accessory);
        var pinned = options.PinnedItemId is null ? null : ordered.FirstOrDefault(c => c.Id == options.PinnedItemId);

        CandidateItem? Pick(List<CandidateItem> list, int i) =>
            list.Count == 0 ? null : pinned is not null && list.Contains(pinned) ? pinned : list[i % list.Count];

        var pairs = new List<(CandidateItem Top, CandidateItem? Bottom)>();
        if (tops.Count > 0 && bottoms.Count > 0 && pinned?.Category != ItemCategory.Dress)
        {
            var pairCount = pinned?.Category == ItemCategory.Top ? bottoms.Count
                : pinned?.Category == ItemCategory.Bottom ? tops.Count
                : Math.Max(tops.Count, bottoms.Count);
            for (var k = 0; k < pairCount; k++)
                pairs.Add((Pick(tops, k)!, Pick(bottoms, k)));
        }

        List<(CandidateItem Top, CandidateItem? Bottom)> dressBases = pinned?.Category switch
        {
            ItemCategory.Dress => [(pinned, null)],
            ItemCategory.Top or ItemCategory.Bottom => [],
            _ => dresses.Select(d => (d, (CandidateItem?)null)).ToList(),
        };

        var menswear = options.Segment == Segment.Men;
        if (menswear && pairs.Count > 0 && pinned?.Category != ItemCategory.Dress)
            dressBases = [];
        var withOuterwear = options.WithOuterwear
                            || menswear && options.Occasion is Occasion.Office or Occasion.Dinner or Occasion.Wedding;

        var bases = new List<(CandidateItem Top, CandidateItem? Bottom)>();
        for (var k = 0; k < Math.Max(pairs.Count, dressBases.Count); k++)
        {
            if (k < pairs.Count) bases.Add(pairs[k]);
            if (k < dressBases.Count) bases.Add(dressBases[k]);
        }

        var result = new List<SuggestedOutfit>();
        var seen = new HashSet<string>(options.ExcludeSignatures ?? new HashSet<string>(), StringComparer.Ordinal);
        for (var step = 0; step < bases.Count && result.Count < count; step++)
        {
            var i = step + options.Offset;
            var (top, bottom) = bases[i % bases.Count];
            var slots = new List<SlotRef> { new(OutfitSlot.Top, top.Id) };
            if (bottom is not null) slots.Add(new SlotRef(OutfitSlot.Bottom, bottom.Id));
            if (withOuterwear && Pick(outerwear, i) is { } outer) slots.Add(new SlotRef(OutfitSlot.Outerwear, outer.Id));
            if (Pick(shoes, i) is { } shoe) slots.Add(new SlotRef(OutfitSlot.Shoes, shoe.Id));
            if (Pick(bags, i) is { } bag) slots.Add(new SlotRef(OutfitSlot.BagAccessory, bag.Id));

            if (slots.Count < OutfitSlotRules.MinPieces || !seen.Add(StylistOutputGuard.Signature(slots)))
                continue;

            IReadOnlyList<MissingPiece> missing = !options.OnlyMyWardrobe && shoes.Count == 0
                ? [new MissingPiece(OutfitSlot.Shoes, ItemCategory.Shoes, MissingPieceReason.EmptySlot)]
                : [];
            result.Add(new SuggestedOutfit(result.Count, null, null, StylistOutputGuard.SourceRule, slots, missing));
        }

        return result;
    }
}
