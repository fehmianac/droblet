using System.Text.Json.Nodes;
using Domain.Constant;
using Domain.Enum;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;

namespace DomainTests.Services;

internal static class Wardrobe
{
    public static CandidateItem Piece(string id, ItemCategory category, int wears = 0, params Season[] seasons) =>
        new(id, category, ["black"], null, seasons.Length == 0 ? [Season.Autumn] : seasons, wears);

    /// <summary>2 tops, 2 bottoms, 1 dress, 2 shoes, 1 coat, 1 bag.</summary>
    public static List<CandidateItem> Basic() =>
    [
        Piece("top1", ItemCategory.Top), Piece("top2", ItemCategory.Top, 3),
        Piece("bot1", ItemCategory.Bottom), Piece("bot2", ItemCategory.Bottom, 2),
        Piece("dress1", ItemCategory.Dress, 1),
        Piece("shoe1", ItemCategory.Shoes), Piece("shoe2", ItemCategory.Shoes, 5),
        Piece("coat1", ItemCategory.Outerwear),
        Piece("bag1", ItemCategory.Bag),
    ];

    public static ModelOutfit Outfit(string? top = "top1", string? bottom = "bot1", string? shoes = "shoe1", string? outer = null, string? bag = null,
        string? title = "Sakin Ofis", string? explanation = "Lacivert üst, açık alt.", params ModelMissing[] missing) =>
        new(title, explanation, new ModelSlots(top, bottom, outer, shoes, bag), missing);
}

public class StylistCandidateSelectorTests
{
    private static CandidateCriteria Criteria(Season season = Season.Autumn, Occasion? occasion = Occasion.Office, int? maxTemp = null,
        bool trip = false, int max = 60, string? pinned = null) =>
        new(new HashSet<Season> { season }, occasion, maxTemp, trip, max, 26, pinned);

    [Fact]
    public void Select_KeepsPiecesOfTheSeason()
    {
        var wardrobe = new[]
        {
            Wardrobe.Piece("summerTop", ItemCategory.Top, 0, Season.Summer),
            Wardrobe.Piece("autumnTop", ItemCategory.Top, 0, Season.Autumn),
            Wardrobe.Piece("allYearBottom", ItemCategory.Bottom, 0, Season.Spring, Season.Summer, Season.Autumn, Season.Winter),
        };

        var ids = StylistCandidateSelector.Select(wardrobe, Criteria()).Select(c => c.Id);

        Assert.Equal(["allYearBottom", "autumnTop"], ids);
    }

    [Fact]
    public void Select_SlotWithNoSeasonalPiece_KeepsAllOfThatSlot()
    {
        var wardrobe = new[] { Wardrobe.Piece("top", ItemCategory.Top), Wardrobe.Piece("sandals", ItemCategory.Shoes, 0, Season.Summer) };

        Assert.Contains(StylistCandidateSelector.Select(wardrobe, Criteria()), c => c.Id == "sandals");
    }

    [Fact]
    public void Select_HotDay_LeavesOuterwearOut()
    {
        var ids = StylistCandidateSelector.Select(Wardrobe.Basic(), Criteria(maxTemp: 30)).Select(c => c.Id).ToList();

        Assert.DoesNotContain("coat1", ids);
        Assert.Contains("coat1", StylistCandidateSelector.Select(Wardrobe.Basic(), Criteria(maxTemp: 18)).Select(c => c.Id));
    }

    [Theory]
    [InlineData(ItemCategory.Beachwear, Season.Summer, Occasion.Travel, false, true)]
    [InlineData(ItemCategory.Beachwear, Season.Summer, Occasion.Office, false, false)]
    [InlineData(ItemCategory.Beachwear, Season.Winter, Occasion.Travel, false, false)]
    [InlineData(ItemCategory.Beachwear, Season.Summer, Occasion.Office, true, true)] // packing for a summer trip
    [InlineData(ItemCategory.Skiwear, Season.Winter, Occasion.Sport, false, true)]
    [InlineData(ItemCategory.Skiwear, Season.Summer, Occasion.Sport, false, false)]
    [InlineData(ItemCategory.Skiwear, Season.Winter, Occasion.Wedding, false, false)]
    public void Select_SpecialtyWear_OnlyInSeasonAndContext(ItemCategory category, Season season, Occasion occasion, bool trip, bool expected)
    {
        var wardrobe = new[] { Wardrobe.Piece("special", category, 0, Season.Summer, Season.Winter) };

        Assert.Equal(expected, StylistCandidateSelector.Select(wardrobe, Criteria(season, occasion, trip: trip)).Count == 1);
    }

    [Fact]
    public void Select_Cap_TakesLeastWornRoundRobin_AndAlwaysKeepsThePinnedPiece()
    {
        var wardrobe = Enumerable.Range(0, 10).Select(i => Wardrobe.Piece($"top{i}", ItemCategory.Top, i))
            .Concat(Enumerable.Range(0, 10).Select(i => Wardrobe.Piece($"shoe{i}", ItemCategory.Shoes, i)));

        var ids = StylistCandidateSelector.Select(wardrobe, Criteria(max: 4, pinned: "top9")).Select(c => c.Id).ToList();

        Assert.Equal(4, ids.Count);
        Assert.Contains("top9", ids);
        Assert.Contains("top0", ids);
        Assert.Contains("shoe0", ids);
        Assert.DoesNotContain("shoe9", ids);
    }
}

public class StylistOutputGuardTests
{
    private static GuardContext Context(bool onlyMyWardrobe = true, string? pinned = null, IEnumerable<CandidateItem>? candidates = null,
        Dictionary<string, ItemCategory>? products = null) =>
        GuardContext.For(candidates ?? Wardrobe.Basic(), onlyMyWardrobe, pinned, 40, 280, products);

    [Fact]
    public void Accept_ValidOutfit_ReturnsDraftWithSlots()
    {
        var accepted = StylistOutputGuard.Accept(Wardrobe.Outfit(outer: "coat1", bag: "bag1"), Context(), 0);

        Assert.NotNull(accepted);
        Assert.Equal("model", accepted.Source);
        Assert.Equal("Sakin Ofis", accepted.Title);
        Assert.Equal(
            [new SlotRef(OutfitSlot.Top, "top1"), new SlotRef(OutfitSlot.Bottom, "bot1"), new SlotRef(OutfitSlot.Outerwear, "coat1"),
             new SlotRef(OutfitSlot.Shoes, "shoe1"), new SlotRef(OutfitSlot.BagAccessory, "bag1")],
            accepted.Slots);
    }

    [Fact]
    public void Accept_DressWithShoes_Valid() =>
        Assert.NotNull(StylistOutputGuard.Accept(Wardrobe.Outfit(top: "dress1", bottom: null), Context(), 0));

    [Fact]
    public void Violations_ItemIdOutsideTheCandidateList_UnknownItem_NeverAccepted()
    {
        var outfit = Wardrobe.Outfit(top: "someone-elses-top");

        Assert.Contains(StylistOutputGuard.UnknownItem, StylistOutputGuard.Violations(outfit, Context()));
        Assert.Null(StylistOutputGuard.Accept(outfit, Context(), 0));
    }

    [Fact]
    public void Violations_PieceInTheWrongSlot_SlotCategoryMismatch() =>
        Assert.Contains(ErrorCodes.SlotCategoryMismatch, StylistOutputGuard.Violations(Wardrobe.Outfit(top: "shoe2"), Context()));

    [Fact]
    public void Violations_DressWithBottom_DressClosesBottom() =>
        Assert.Contains(ErrorCodes.DressClosesBottom, StylistOutputGuard.Violations(Wardrobe.Outfit(top: "dress1"), Context()));

    [Theory]
    [InlineData(null, "bot1")]   // no top
    [InlineData("top1", null)]   // top without bottom
    public void Violations_NeitherTopAndBottomNorDress_IncompleteOutfit(string? top, string? bottom) =>
        Assert.Contains(StylistOutputGuard.IncompleteOutfit, StylistOutputGuard.Violations(Wardrobe.Outfit(top, bottom, bag: "bag1"), Context()));

    [Fact]
    public void Violations_NoShoesAlthoughWardrobeHasShoes_ShoesMissing_ButFineWithoutAnyShoes()
    {
        Assert.Contains(StylistOutputGuard.ShoesMissing, StylistOutputGuard.Violations(Wardrobe.Outfit(shoes: null), Context()));

        var shoeless = Wardrobe.Basic().Where(c => c.Category != ItemCategory.Shoes);
        Assert.Empty(StylistOutputGuard.Violations(Wardrobe.Outfit(shoes: null), Context(candidates: shoeless)));
    }

    [Fact]
    public void Violations_PinnedPieceNotUsed_PinnedMissing() =>
        Assert.Contains(StylistOutputGuard.PinnedMissing, StylistOutputGuard.Violations(Wardrobe.Outfit(), Context(pinned: "top2")));

    [Fact]
    public void Violations_OnlyMyWardrobe_AnyMissingPiece_WardrobeOnlyViolated() =>
        Assert.Contains(StylistOutputGuard.WardrobeOnlyViolated,
            StylistOutputGuard.Violations(Wardrobe.Outfit(missing: new ModelMissing("bagAccessory", "bag", null)), Context(onlyMyWardrobe: true)));

    [Fact]
    public void Accept_MissingPieceForAnEmptySlot_BecomesACatalogSlotPlaceholder()
    {
        var accepted = StylistOutputGuard.Accept(Wardrobe.Outfit(missing: new ModelMissing("bagAccessory", "bag", null)), Context(onlyMyWardrobe: false), 0);

        Assert.Equal([new MissingPiece(OutfitSlot.BagAccessory, ItemCategory.Bag, MissingPieceReason.Suggested)], accepted!.Missing);
    }

    [Fact]
    public void Accept_MissingPieceWithCandidateProduct_KeepsTheProductId()
    {
        var context = Context(onlyMyWardrobe: false, products: new() { ["prd1"] = ItemCategory.Bag });

        var accepted = StylistOutputGuard.Accept(Wardrobe.Outfit(missing: new ModelMissing("bagAccessory", null, "prd1")), context, 0);

        Assert.Equal(new MissingPiece(OutfitSlot.BagAccessory, ItemCategory.Bag, MissingPieceReason.Suggested, "prd1"), Assert.Single(accepted!.Missing));
    }

    [Theory]
    [InlineData("shoes", "shoes", null, StylistOutputGuard.InvalidMissingPiece)]        // slot is already filled
    [InlineData("bagAccessory", "shoes", null, StylistOutputGuard.InvalidMissingPiece)] // category does not fit the slot
    [InlineData("hat", null, null, StylistOutputGuard.InvalidMissingPiece)]
    [InlineData("bagAccessory", "bag", "not-in-catalog", StylistOutputGuard.UnknownProduct)]
    public void Violations_BadMissingPiece(string slot, string? category, string? productId, string expected) =>
        Assert.Contains(expected, StylistOutputGuard.Violations(Wardrobe.Outfit(missing: new ModelMissing(slot, category, productId)), Context(onlyMyWardrobe: false)));

    [Fact]
    public void Violations_TextLongerThanTheSurface_TextTooLong_NotTruncated()
    {
        Assert.Contains(StylistOutputGuard.TextTooLong, StylistOutputGuard.Violations(Wardrobe.Outfit(title: new string('a', 41)), Context()));
        Assert.Contains(StylistOutputGuard.TextTooLong, StylistOutputGuard.Violations(Wardrobe.Outfit(explanation: new string('a', 281)), Context()));
    }

    [Fact]
    public void AcceptDistinct_DropsInvalidAndRepeatedSuggestions()
    {
        var accepted = StylistOutputGuard.AcceptDistinct(
            [Wardrobe.Outfit(), Wardrobe.Outfit(), Wardrobe.Outfit(top: "ghost"), Wardrobe.Outfit(top: "top2", bottom: "bot2", shoes: "shoe2")], Context(), 3);

        Assert.Equal(2, accepted.Count);
        Assert.Equal([0, 1], accepted.Select(s => s.Index));
    }

    [Fact]
    public void AcceptWeek_OneLookPerRequestedDate_RejectsARepeatOfThePreviousDay()
    {
        var slots = new ModelSlots("top1", "bot1", null, "shoe1", null);
        var output = new ModelWeekOutput(
        [
            new ModelDay("2026-11-16", "Pzt", null, "office", slots),
            new ModelDay("2026-11-17", "Sal", null, "office", slots), // same look as yesterday
            new ModelDay("2026-11-18", "Çar", null, "office", new ModelSlots("ghost", "bot1", null, "shoe1", null)),
            new ModelDay("2026-12-25", "Başka hafta", null, null, slots),
        ], null);

        var accepted = StylistOutputGuard.AcceptWeek(output, ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"], Context());

        Assert.Equal(["2026-11-16"], accepted.Keys);
    }

    [Theory]
    [InlineData("Bu kesim seni daha zayıf gösterir.", true)]
    [InlineData("Biraz kilo verince daha iyi durur.", true)]
    [InlineData("A slimming silhouette that hides your belly.", true)]
    [InlineData("Lacivert blazer, krem pantolonla sakin bir ofis günü.", false)]
    [InlineData("Lightweight knit with slim-fit trousers.", false)]
    [InlineData("Kilim desenli çanta günü tamamlıyor.", false)]
    public void ViolatesContentPolicy_BodyAndWeightTalk(string text, bool expected) =>
        Assert.Equal(expected, StylistOutputGuard.ViolatesContentPolicy([null, text]));
}

public class RuleBasedOutfitTests
{
    [Fact]
    public void Build_ThreeDifferentValidOutfits_LeastWornFirst()
    {
        var outfits = RuleBasedOutfit.Build(Wardrobe.Basic(), 3);
        var context = GuardContext.For(Wardrobe.Basic(), true);

        Assert.Equal(3, outfits.Count);
        Assert.Equal(3, outfits.Select(o => StylistOutputGuard.Signature(o.Slots)).Distinct().Count());
        Assert.All(outfits, o => Assert.Equal("rule", o.Source));
        Assert.All(outfits, o => Assert.Null(o.Title)); // no text is invented
        Assert.Contains(new SlotRef(OutfitSlot.Top, "top1"), outfits[0].Slots);
        // Every rule-based outfit passes the same guard the model has to pass.
        Assert.All(outfits, o => Assert.Empty(OutfitSlotRules.Validate(
            o.Slots.Select(s => new SlotPiece(s.Slot, s.ItemId, null, context.Candidates[s.ItemId!].Category)).ToList())));
    }

    [Fact]
    public void Build_PinnedPiece_IsInEveryOutfit()
    {
        var outfits = RuleBasedOutfit.Build(Wardrobe.Basic(), 3, new RuleOutfitOptions("bot2"));

        Assert.NotEmpty(outfits);
        Assert.All(outfits, o => Assert.Contains(new SlotRef(OutfitSlot.Bottom, "bot2"), o.Slots));
    }

    [Fact]
    public void Build_OuterLayerOnlyWhenAskedFor()
    {
        Assert.DoesNotContain(RuleBasedOutfit.Build(Wardrobe.Basic(), 1)[0].Slots, s => s.Slot == OutfitSlot.Outerwear);
        Assert.Contains(RuleBasedOutfit.Build(Wardrobe.Basic(), 1, new RuleOutfitOptions(WithOuterwear: true))[0].Slots, s => s.Slot == OutfitSlot.Outerwear);
    }

    [Fact]
    public void Build_WardrobeThatCannotDress_ReturnsNothing()
    {
        Assert.Empty(RuleBasedOutfit.Build([], 3));
        Assert.Empty(RuleBasedOutfit.Build([Wardrobe.Piece("top1", ItemCategory.Top), Wardrobe.Piece("shoe1", ItemCategory.Shoes)], 3)); // top without bottom
        Assert.Empty(RuleBasedOutfit.Build([Wardrobe.Piece("dress1", ItemCategory.Dress)], 3)); // one piece is not a look
    }

    [Fact]
    public void Build_NoShoes_NotWardrobeOnly_AddsAShoePlaceholder()
    {
        var shoeless = Wardrobe.Basic().Where(c => c.Category != ItemCategory.Shoes).ToList();

        var open = RuleBasedOutfit.Build(shoeless, 1, new RuleOutfitOptions(OnlyMyWardrobe: false))[0];
        var closed = RuleBasedOutfit.Build(shoeless, 1)[0];

        Assert.Equal([new MissingPiece(OutfitSlot.Shoes, ItemCategory.Shoes, MissingPieceReason.EmptySlot)], open.Missing);
        Assert.Empty(closed.Missing);
    }

    [Fact]
    public void Build_ExcludedSignature_IsSkipped()
    {
        var first = RuleBasedOutfit.Build(Wardrobe.Basic(), 1)[0];

        var next = RuleBasedOutfit.Build(Wardrobe.Basic(), 1, new RuleOutfitOptions(ExcludeSignatures: new HashSet<string> { StylistOutputGuard.Signature(first.Slots) }))[0];

        Assert.NotEqual(StylistOutputGuard.Signature(first.Slots), StylistOutputGuard.Signature(next.Slots));
    }
}

public class PackingRulesTests
{
    private static readonly string[] ThreeDays = ["2026-12-01", "2026-12-02", "2026-12-03"];

    private static PackingContext Context(IReadOnlyList<string>? dates = null, bool cabinOnly = false, int cabinMax = 0, IEnumerable<CandidateItem>? wardrobe = null) =>
        new((wardrobe ?? Wardrobe.Basic()).ToDictionary(c => c.Id), dates ?? ThreeDays, cabinOnly, cabinMax);

    private static PackDayPlan Day(string date, params (OutfitSlot Slot, string Id)[] slots) =>
        new(date, null, null, slots.Select(s => new SlotRef(s.Slot, s.Id)).ToList());

    private static PackPlan ValidPlan() => new(["top1", "bot1", "shoe1"],
        ThreeDays.Select(d => Day(d, (OutfitSlot.Top, "top1"), (OutfitSlot.Bottom, "bot1"), (OutfitSlot.Shoes, "shoe1"))).ToList());

    [Fact]
    public void Validate_EveryPieceWornAtLeastTwice_Valid()
    {
        Assert.Empty(PackingRules.Validate(ValidPlan(), Context()));
        Assert.True(PackingRules.EveryPieceWornTwice(ValidPlan()));
        Assert.Equal(3, PackingRules.PlannedWears(ValidPlan())["top1"]);
    }

    [Fact]
    public void Validate_PieceWornOnlyOnce_OnAMultiDayTrip_Rejected()
    {
        var plan = ValidPlan();
        plan = plan with
        {
            ItemIds = [.. plan.ItemIds, "top2"],
            Days = [Day(ThreeDays[0], (OutfitSlot.Top, "top2"), (OutfitSlot.Bottom, "bot1"), (OutfitSlot.Shoes, "shoe1")), plan.Days[1], plan.Days[2]],
        };

        Assert.Contains(PackingRules.PieceWornOnce, PackingRules.Validate(plan, Context()));
        Assert.False(PackingRules.EveryPieceWornTwice(plan));
    }

    [Fact]
    public void Validate_PackedButNeverWorn_Rejected()
    {
        var plan = ValidPlan() with { ItemIds = ["top1", "bot1", "shoe1", "bag1"] };

        Assert.Contains(PackingRules.PieceWornOnce, PackingRules.Validate(plan, Context()));
    }

    [Fact]
    public void Validate_OneDayTrip_WornOnceIsEnough_ButTheTwiceClaimIsNotMade()
    {
        var oneDay = new[] { "2026-12-01" };
        var plan = new PackPlan(["top1", "bot1", "shoe1"], [Day(oneDay[0], (OutfitSlot.Top, "top1"), (OutfitSlot.Bottom, "bot1"), (OutfitSlot.Shoes, "shoe1"))]);

        Assert.Empty(PackingRules.Validate(plan, Context(oneDay)));
        Assert.False(PackingRules.EveryPieceWornTwice(plan));
        Assert.False(PackingRules.RequiresMinWears(1));
        Assert.True(PackingRules.RequiresMinWears(2));
        Assert.Equal(2, PackingRules.MinWearsPerPiece);

        var withUnused = plan with { ItemIds = ["top1", "bot1", "shoe1", "bag1"] };
        Assert.Contains(PackingRules.PieceUnused, PackingRules.Validate(withUnused, Context(oneDay)));
    }

    [Fact]
    public void Validate_ItemNotInWardrobe_Rejected()
    {
        var plan = new PackPlan(["ghost", "bot1"], ThreeDays.Select(d => Day(d, (OutfitSlot.Top, "ghost"), (OutfitSlot.Bottom, "bot1"))).ToList());

        var errors = PackingRules.Validate(plan, Context());

        Assert.Contains(PackingRules.UnknownItem, errors);
        Assert.Contains(PackingRules.DayInvalidLook, errors);
    }

    [Fact]
    public void Validate_DayMissing_DayOutsideTrip_DuplicateItem_Empty()
    {
        var plan = ValidPlan();

        Assert.Contains(PackingRules.DayMissing, PackingRules.Validate(plan with { Days = plan.Days.Take(2).ToList() }, Context()));
        Assert.Contains(PackingRules.DayUnknown, PackingRules.Validate(plan with { Days = [.. plan.Days, plan.Days[0] with { Date = "2027-01-01" }] }, Context()));
        Assert.Contains(PackingRules.DuplicateItem, PackingRules.Validate(plan with { ItemIds = [.. plan.ItemIds, "top1"] }, Context()));
        Assert.Contains(PackingRules.Empty, PackingRules.Validate(new PackPlan([], []), Context()));
    }

    [Fact]
    public void Validate_DayLookUsesAPieceThatIsNotPacked_OrACatalogProduct_Rejected()
    {
        var plan = ValidPlan();
        var unpacked = plan with { Days = [Day(ThreeDays[0], (OutfitSlot.Top, "top2"), (OutfitSlot.Bottom, "bot1"), (OutfitSlot.Shoes, "shoe1")), plan.Days[1], plan.Days[2]] };
        var product = plan with { Days = [plan.Days[0] with { Slots = [.. plan.Days[0].Slots, new SlotRef(OutfitSlot.BagAccessory, ProductId: "prd1")] }, plan.Days[1], plan.Days[2]] };

        Assert.Contains(PackingRules.DayUsesUnpackedPiece, PackingRules.Validate(unpacked, Context()));
        Assert.Contains(PackingRules.DayUsesUnpackedPiece, PackingRules.Validate(product, Context()));
    }

    [Fact]
    public void Validate_DayLookBreaksSlotRules_Rejected()
    {
        var plan = new PackPlan(["top1", "shoe1"], ThreeDays.Select(d => Day(d, (OutfitSlot.Bottom, "top1"), (OutfitSlot.Shoes, "shoe1"))).ToList());

        Assert.Contains(PackingRules.DayInvalidLook, PackingRules.Validate(plan, Context()));
    }

    [Fact]
    public void Validate_CabinOnly_ListLongerThanTheLimit_Rejected_UnlessLimitUndecided()
    {
        Assert.Contains(PackingRules.CabinLimit, PackingRules.Validate(ValidPlan(), Context(cabinOnly: true, cabinMax: 2)));
        Assert.Empty(PackingRules.Validate(ValidPlan(), Context(cabinOnly: true, cabinMax: 3)));
        Assert.Empty(PackingRules.Validate(ValidPlan(), Context(cabinOnly: true, cabinMax: 0)));  // 0 = owner has not decided
        Assert.Empty(PackingRules.Validate(ValidPlan(), Context(cabinOnly: false, cabinMax: 2))); // not a cabin trip
    }

    [Fact]
    public void FromModel_MapsListDaysLabelAndOccasion_NullWhenUnusable()
    {
        var plan = PackingRules.FromModel(new ModelPackOutput(["top1", "bot1"],
            [new ModelDay("2026-12-01", " Uçuş + akşam yemeği ", null, "dinner", new ModelSlots("top1", "bot1", null, null, null))], null));

        Assert.Equal(["top1", "bot1"], plan!.ItemIds);
        Assert.Equal("Uçuş + akşam yemeği", plan.Days[0].Label);
        Assert.Equal(Occasion.Dinner, plan.Days[0].Occasion);
        Assert.Null(PackingRules.FromModel(null));
        Assert.Null(PackingRules.FromModel(new ModelPackOutput([], [], null)));
        Assert.Null(PackingRules.FromModel(new ModelPackOutput(["top1"], [new ModelDay(null, null, null, null, null)], null)));
    }

    [Fact]
    public void MissingPieces_AreCatalogSlotPlaceholders_FromRulesOnly()
    {
        var noShoesNoCoat = Wardrobe.Basic().Where(c => c.Category is not (ItemCategory.Shoes or ItemCategory.Outerwear)).ToList();
        DailyForecast[] rainy = [new("2026-12-01", 8, 14, WeatherCondition.Rain)];
        DailyForecast[] cold = [new("2026-12-01", 2, 9, WeatherCondition.Clear)];
        DailyForecast[] mild = [new("2026-12-01", 15, 22, WeatherCondition.Clear)];

        Assert.Equal(
            [new MissingPiece(OutfitSlot.Shoes, ItemCategory.Shoes, MissingPieceReason.NoShoes), new MissingPiece(OutfitSlot.Outerwear, ItemCategory.Outerwear, MissingPieceReason.Rain)],
            PackingRules.MissingPieces(noShoesNoCoat, rainy, 12));
        Assert.Contains(new MissingPiece(OutfitSlot.Outerwear, ItemCategory.Outerwear, MissingPieceReason.Cold), PackingRules.MissingPieces(noShoesNoCoat, cold, 12));
        Assert.DoesNotContain(PackingRules.MissingPieces(noShoesNoCoat, mild, 12), m => m.Slot == OutfitSlot.Outerwear);
        Assert.Empty(PackingRules.MissingPieces(Wardrobe.Basic(), rainy, 12));
        Assert.All(PackingRules.MissingPieces(noShoesNoCoat, rainy, 12), m => Assert.Null(m.ProductId));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(5)]
    [InlineData(7)]
    [InlineData(10)]
    public void RuleBasedPacking_AlwaysPassesPackingRules_AndWearsEveryPieceTwiceOnMultiDayTrips(int days)
    {
        var dates = CalendarDay.Range(new DateOnly(2026, 12, 1), new DateOnly(2026, 12, 1).AddDays(days - 1));
        var wardrobe = Wardrobe.Basic()
            .Concat(Enumerable.Range(3, 4).Select(i => Wardrobe.Piece($"top{i}", ItemCategory.Top)))
            .Concat(Enumerable.Range(3, 3).Select(i => Wardrobe.Piece($"bot{i}", ItemCategory.Bottom)));
        var context = Context(dates, wardrobe: wardrobe);

        var plan = RuleBasedPacking.Build(context, withOuterwear: true, [Occasion.Office, Occasion.Dinner]);

        Assert.NotNull(plan);
        Assert.Empty(PackingRules.Validate(plan, context));
        Assert.Equal(days, plan.Days.Count);
        Assert.Equal(days > 1, PackingRules.EveryPieceWornTwice(plan));
        Assert.Contains("coat1", plan.ItemIds);
        Assert.Equal(Occasion.Office, plan.Days[0].Occasion);
    }

    [Fact]
    public void RuleBasedPacking_CabinOnly_StaysWithinTheLimit()
    {
        var dates = CalendarDay.Range(new DateOnly(2026, 12, 1), new DateOnly(2026, 12, 8));
        var context = Context(dates, cabinOnly: true, cabinMax: 4);

        var plan = RuleBasedPacking.Build(context, withOuterwear: true);

        Assert.NotNull(plan);
        Assert.True(plan.ItemIds.Count <= 4);
        Assert.Empty(PackingRules.Validate(plan, context));
    }

    [Fact]
    public void RuleBasedPacking_DressesWhenThereAreNoSeparates_NullWhenNothingToWear()
    {
        var dresses = new[] { Wardrobe.Piece("dress1", ItemCategory.Dress), Wardrobe.Piece("shoe1", ItemCategory.Shoes) };

        var plan = RuleBasedPacking.Build(Context(wardrobe: dresses), false);

        Assert.Equal(["dress1", "shoe1"], plan!.ItemIds);
        Assert.Null(RuleBasedPacking.Build(Context(wardrobe: [Wardrobe.Piece("shoe1", ItemCategory.Shoes)]), false));
        Assert.Null(RuleBasedPacking.Build(Context(wardrobe: [Wardrobe.Piece("dress1", ItemCategory.Dress)]), false));
    }

    [Theory]
    [InlineData(TripType.Business, Occasion.Office)]
    [InlineData(TripType.Dinner, Occasion.Dinner)]
    [InlineData(TripType.Sightseeing, Occasion.Travel)]
    public void OccasionFor(TripType type, Occasion expected) => Assert.Equal(expected, PackingRules.OccasionFor(type));
}

public class AiSchemasTests
{
    private static void AssertStrict(JsonNode? node)
    {
        if (node is JsonObject obj)
        {
            if (obj["type"] is JsonValue type && type.GetValue<string>() == "object")
            {
                var properties = obj["properties"]!.AsObject().Select(p => p.Key).ToList();
                Assert.Equal(properties, obj["required"]!.AsArray().Select(r => r!.GetValue<string>()));
                Assert.False(obj["additionalProperties"]!.GetValue<bool>());
            }
            foreach (var child in obj)
                AssertStrict(child.Value);
        }
        else if (node is JsonArray array)
        {
            foreach (var child in array)
                AssertStrict(child);
        }
    }

    [Fact]
    public void EverySchema_IsStrict_AllPropertiesRequired_NoAdditionalProperties()
    {
        foreach (var schema in new[] { AiSchemas.OutfitSchema(), AiSchemas.WeekSchema(), AiSchemas.PackSchema(), AiSchemas.GarmentSchema(), AiSchemas.OutfitPiecesSchema(), AiSchemas.PaletteSchema() })
            AssertStrict(schema);
    }

    [Fact]
    public void Schemas_AreGeneratedFromTheFixedVocabularies()
    {
        var garment = AiSchemas.GarmentSchema()["properties"]!["garment"]!["properties"]!;
        var categories = garment["category"]!["enum"]!.AsArray().Select(v => v?.GetValue<string>()).ToList();
        var colors = garment["colorIds"]!["items"]!["enum"]!.AsArray().Select(v => v!.GetValue<string>()).ToList();
        var seasons = AiSchemas.PaletteSchema()["properties"]!["seasonTypeId"]!["enum"]!.AsArray().Select(v => v?.GetValue<string>()).ToList();

        Assert.Equal(["top", "bottom", "dress", "outerwear", "shoes", "bag", "accessory", "beachwear", "skiwear", null], categories);
        Assert.Equal(ColorCatalog.Ids, colors);
        Assert.Equal(SeasonTypeCatalog.Ids.Append(null), seasons);
    }

    [Fact]
    public void ModelOutput_RoundTripsThroughTheOutfitSchemaShape()
    {
        const string json = """
            {"suggestions":[{"title":"Gece Laciverti","explanation":"Kısa not.","slots":{"top":"top1","bottom":"bot1","outerwear":null,"shoes":"shoe1","bagAccessory":null},
              "missing":[{"slot":"bagAccessory","category":"bag","productId":null}]}],"refusal":null}
            """;

        var output = StylingJson.TryDeserialize<ModelOutfitOutput>(json);

        Assert.Equal("top1", output!.Suggestions![0].Slots!.Top);
        Assert.Equal("bagAccessory", output.Suggestions[0].Missing![0].Slot);
        Assert.Null(StylingJson.TryDeserialize<ModelOutfitOutput>("{not json"));
        Assert.Null(StylingJson.TryDeserialize<ModelOutfitOutput>(null));
    }

    [Fact]
    public void Results_SerializeWithCamelCaseEnums_AndCarryTheirLanguage()
    {
        var json = StylingJson.Serialize(new OutfitResult("2026-11-18", Occasion.Office, true, null,
            [new SuggestedOutfit(0, "Sakin", null, "model", [new SlotRef(OutfitSlot.BagAccessory, "bag1")], [])], "en"));

        Assert.Contains("\"occasion\":\"office\"", json);
        Assert.Contains("\"slot\":\"bagAccessory\"", json);
        Assert.Contains("\"language\":\"en\"", json);
        Assert.Equal("en", StylingJson.TryDeserialize<OutfitResult>(json)!.Language);
    }

    [Theory]
    [InlineData(JobKind.StylistOutfit, "outfit")]
    [InlineData(JobKind.StylistWeek, "week_plan")]
    [InlineData(JobKind.StylistPack, "packing")]
    public void NameFor(JobKind kind, string expected) => Assert.Equal(expected, AiSchemas.NameFor(kind));
}

/// <summary>Owner decision 2026-11-18: the cabin-only limit is enforced (Packing:CabinMaxItems, default 12, 0 = off).</summary>
public class CabinLimitTests
{
    private static readonly string[] FourDays = ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"];

    private static PackingContext Context(IReadOnlyList<string> dates, int cabinMax, bool cabinOnly = true) =>
        new(Wardrobe.Basic().ToDictionary(c => c.Id), dates, cabinOnly, cabinMax);

    private static PackDayPlan Day(string date, params (OutfitSlot Slot, string Id)[] slots) =>
        new(date, null, null, slots.Select(s => new SlotRef(s.Slot, s.Id)).ToList());

    /// <summary>6 pieces over 4 days: two tops and two bottoms alternate (2 wears each), shoes and bag every day (4 wears).</summary>
    private static PackPlan SixPieces() => new(["top1", "top2", "bot1", "bot2", "shoe1", "bag1"], FourDays.Select((d, i) => Day(d,
        (OutfitSlot.Top, i % 2 == 0 ? "top1" : "top2"), (OutfitSlot.Bottom, i % 2 == 0 ? "bot1" : "bot2"), (OutfitSlot.Shoes, "shoe1"), (OutfitSlot.BagAccessory, "bag1"))).ToList());

    [Fact]
    public void Default_Is12_AndEveryPieceCountsOnce()
    {
        Assert.Equal(12, new Domain.Options.PackingOptions().CabinMaxItems);
        Assert.Equal(6, Context(FourDays, 6).CabinLimit);
        Assert.Null(Context(FourDays, 6, cabinOnly: false).CabinLimit);
        Assert.Null(Context(FourDays, 0).CabinLimit);
    }

    [Fact]
    public void AtTheLimit_IsValid_AndNothingIsDropped()
    {
        var context = Context(FourDays, 6); // shoes and bag count: 2 tops + 2 bottoms + shoes + bag = 6

        var trim = PackingRules.TrimToCabinLimit(SixPieces(), context);

        Assert.Empty(PackingRules.Validate(SixPieces(), context));
        Assert.Equal(SixPieces().ItemIds, trim.Plan!.ItemIds);
        Assert.Empty(trim.DroppedItemIds);
    }

    [Fact]
    public void OneOverTheLimit_IsRejectedByValidate()
    {
        Assert.Contains(PackingRules.CabinLimit, PackingRules.Validate(SixPieces(), Context(FourDays, 5)));
    }

    [Fact]
    public void OverTheLimit_IsTrimmed_KeepingEverySlot_AndThePiecesUsedInTheMostLooks()
    {
        var context = Context(FourDays, 4);

        var trim = PackingRules.TrimToCabinLimit(SixPieces(), context);

        Assert.NotNull(trim.Plan);
        Assert.Equal(["top1", "bot1", "shoe1", "bag1"], trim.Plan.ItemIds);       // one per slot; shoes and bag were the most worn
        Assert.Equal(["top2", "bot2"], trim.DroppedItemIds);
        Assert.Empty(PackingRules.Validate(trim.Plan, context));
        Assert.All(trim.Plan.Days, d => Assert.Equal(["top1", "bot1", "shoe1", "bag1"], d.Slots.Select(s => s.ItemId)));   // dropped pieces were replaced in their looks
        Assert.True(PackingRules.EveryPieceWornTwice(trim.Plan));
    }

    [Fact]
    public void OverTheLimit_WithRoomLeft_TheMostWornExtraPieceStays()
    {
        // top1 is worn on three days, top2 (listed first) on one.
        var plan = new PackPlan(["top2", "top1", "bot1", "shoe1", "bag1", "coat1"],
        [
            Day(FourDays[0], (OutfitSlot.Top, "top1"), (OutfitSlot.Bottom, "bot1"), (OutfitSlot.Shoes, "shoe1"), (OutfitSlot.BagAccessory, "bag1"), (OutfitSlot.Outerwear, "coat1")),
            Day(FourDays[1], (OutfitSlot.Top, "top1"), (OutfitSlot.Bottom, "bot1"), (OutfitSlot.Shoes, "shoe1"), (OutfitSlot.BagAccessory, "bag1"), (OutfitSlot.Outerwear, "coat1")),
            Day(FourDays[2], (OutfitSlot.Top, "top1"), (OutfitSlot.Bottom, "bot1"), (OutfitSlot.Shoes, "shoe1"), (OutfitSlot.BagAccessory, "bag1")),
            Day(FourDays[3], (OutfitSlot.Top, "top2"), (OutfitSlot.Bottom, "bot1"), (OutfitSlot.Shoes, "shoe1"), (OutfitSlot.BagAccessory, "bag1")),
        ]);
        var context = Context(FourDays, 5);

        var trim = PackingRules.TrimToCabinLimit(plan, context);

        // Five slots are in use and five places exist: each slot keeps its most worn piece; the less worn top goes
        // and the top worn in the most looks takes its day.
        Assert.Equal(["top2"], trim.DroppedItemIds);
        Assert.Equal(["top1", "bot1", "shoe1", "bag1", "coat1"], trim.Plan!.ItemIds);
        Assert.Empty(PackingRules.Validate(trim.Plan, context));
        Assert.Equal("top1", trim.Plan.Days[3].Slots.Single(s => s.Slot == OutfitSlot.Top).ItemId);
    }

    [Fact]
    public void ZeroLimit_MeansUnlimited_AndSoDoesANonCabinTrip()
    {
        foreach (var context in new[] { Context(FourDays, 0), Context(FourDays, 2, cabinOnly: false) })
        {
            var trim = PackingRules.TrimToCabinLimit(SixPieces(), context);

            Assert.Empty(PackingRules.Validate(SixPieces(), context));
            Assert.Equal(6, trim.Plan!.ItemIds.Count);
            Assert.Empty(trim.DroppedItemIds);
        }
    }

    [Fact]
    public void OneDayTrip_IsTrimmedToo_PiecesNeedOnlyOneWear()
    {
        string[] oneDay = ["2026-12-01"];
        var plan = new PackPlan(["top1", "bot1", "coat1", "shoe1", "bag1"],
            [Day(oneDay[0], (OutfitSlot.Top, "top1"), (OutfitSlot.Bottom, "bot1"), (OutfitSlot.Outerwear, "coat1"), (OutfitSlot.Shoes, "shoe1"), (OutfitSlot.BagAccessory, "bag1"))]);

        var atLimit = PackingRules.TrimToCabinLimit(plan, Context(oneDay, 5));
        var trimmed = PackingRules.TrimToCabinLimit(plan, Context(oneDay, 3));
        var impossible = PackingRules.TrimToCabinLimit(plan, Context(oneDay, 1));   // a look needs two pieces

        Assert.Empty(atLimit.DroppedItemIds);
        Assert.Equal(["top1", "bot1", "shoe1"], trimmed.Plan!.ItemIds);            // slot priority: top, bottom, shoes
        Assert.Equal(["coat1", "bag1"], trimmed.DroppedItemIds);
        Assert.Empty(PackingRules.Validate(trimmed.Plan, Context(oneDay, 3)));
        Assert.False(PackingRules.EveryPieceWornTwice(trimmed.Plan));
        Assert.Null(impossible.Plan);
        Assert.Equal(4, impossible.DroppedItemIds.Count);
    }

    [Theory]
    [InlineData(1, 2)]
    [InlineData(1, 12)]
    [InlineData(4, 3)]
    [InlineData(8, 4)]
    [InlineData(8, 12)]
    public void RuleBasedList_NeverExceedsTheLimit(int days, int limit)
    {
        var dates = CalendarDay.Range(new DateOnly(2026, 12, 1), new DateOnly(2026, 12, 1).AddDays(days - 1));
        var context = Context(dates, limit);

        var plan = RuleBasedPacking.Build(context, withOuterwear: true);

        Assert.NotNull(plan);
        Assert.True(plan.ItemIds.Distinct().Count() <= limit);
        Assert.Empty(PackingRules.Validate(plan, context));
    }

    [Fact]
    public void RuleBasedList_WithoutALimit_PacksMore()
    {
        var dates = CalendarDay.Range(new DateOnly(2026, 12, 1), new DateOnly(2026, 12, 8));

        var limited = RuleBasedPacking.Build(Context(dates, 3), withOuterwear: true)!;
        var unlimited = RuleBasedPacking.Build(Context(dates, 0), withOuterwear: true)!;

        Assert.True(limited.ItemIds.Count <= 3);
        Assert.True(unlimited.ItemIds.Count > limited.ItemIds.Count);
    }
}

public class PaletteRuleSettingsTests
{
    private static readonly string[] Flattering = ["navy", "white"];
    private static readonly string[] Avoid = ["orange"];

    private static (string, string?)[] Wardrobe => [("a", "navy"), ("b", "orange"), ("c", "black"), ("d", "sage"), ("e", "white")];

    private static PaletteRuleSettings Settings(bool neutralsCount = true, params string[] neutrals) =>
        PaletteRuleSettings.From(new Domain.Options.PaletteOptions { NeutralsCountAsCompatible = neutralsCount, NeutralColorIds = neutrals.ToList() });

    [Fact]
    public void Defaults_AreTheApprovedRule_NeutralsCountAsCompatible()
    {
        var options = new Domain.Options.PaletteOptions();
        var byDefault = PaletteCompatibilityRules.Evaluate(Wardrobe, Flattering, Avoid);
        var explicitDefault = PaletteCompatibilityRules.Evaluate(Wardrobe, Flattering, Avoid, PaletteRuleSettings.From(options));

        Assert.True(options.NeutralsCountAsCompatible);
        Assert.Empty(options.NeutralColorIds);
        Assert.Equal((80, 5, 2, 2, 1, 0), (byDefault.Percent, byDefault.TotalCount, byDefault.CompatibleCount, byDefault.NeutralCount, byDefault.IncompatibleCount, byDefault.UnmatchedCount));
        Assert.Equal(byDefault.Percent, explicitDefault.Percent);
        Assert.Equal(["b"], byDefault.IncompatibleItemIds);
    }

    [Fact]
    public void NeutralsNotCounted_OnlyFlatteringTonesMakeThePercentage()
    {
        var result = PaletteCompatibilityRules.Evaluate(Wardrobe, Flattering, Avoid, Settings(neutralsCount: false));

        Assert.Equal((40, 2, 2), (result.Percent, result.CompatibleCount, result.NeutralCount));
        Assert.Equal(["b"], result.IncompatibleItemIds); // the "incompatible pieces" list never changes
    }

    [Fact]
    public void ConfiguredNeutralList_OtherColoursAreUnmatched_NotCompatibleAndNotIncompatible()
    {
        var result = PaletteCompatibilityRules.Evaluate(Wardrobe, Flattering, Avoid, Settings(true, "black", "grey", "Not-A-Colour"));

        Assert.Equal((60, 5, 2, 1, 1, 1), (result.Percent, result.TotalCount, result.CompatibleCount, result.NeutralCount, result.IncompatibleCount, result.UnmatchedCount));
        Assert.Equal(PaletteMatch.Unmatched, PaletteCompatibilityRules.Classify("sage", Flattering, Avoid, Settings(true, "black")));
        Assert.Equal(PaletteMatch.Neutral, PaletteCompatibilityRules.Classify("black", Flattering, Avoid, Settings(true, "black")));
    }

    [Fact]
    public void TheSeasonsOwnLists_WinOverTheNeutralList()
    {
        var settings = Settings(true, "orange", "navy");

        Assert.Equal(PaletteMatch.Incompatible, PaletteCompatibilityRules.Classify("orange", Flattering, Avoid, settings));
        Assert.Equal(PaletteMatch.Compatible, PaletteCompatibilityRules.Classify("navy", Flattering, Avoid, settings));
    }
}

public class SlotMappingTests
{
    [Fact]
    public void Default_IsTheApprovedMapping()
    {
        var mapping = SlotMapping.Default;

        Assert.Equal([OutfitSlot.Top, OutfitSlot.Bottom], mapping.SlotsOf(ItemCategory.Beachwear));
        Assert.Equal([OutfitSlot.Top, OutfitSlot.Bottom, OutfitSlot.Outerwear], mapping.SlotsOf(ItemCategory.Skiwear));
        Assert.Equal([OutfitSlot.Top], mapping.SlotsOf(ItemCategory.Dress));
        Assert.Equal([OutfitSlot.BagAccessory], mapping.SlotsOf(ItemCategory.Accessory));
        Assert.Same(SlotMapping.Default, SlotMapping.From(null));
        Assert.Same(SlotMapping.Default, SlotMapping.From(new Dictionary<string, List<string>>()));
        foreach (var category in Enum.GetValues<ItemCategory>())
        {
            Assert.NotEmpty(mapping.SlotsOf(category));
            Assert.True(mapping.Accepts(mapping.DefaultSlot(category), category));
        }
    }

    [Fact]
    public void Config_ReplacesOnlyTheListedCategories()
    {
        var mapping = SlotMapping.From(new Dictionary<string, List<string>>
        {
            ["beachwear"] = ["Top"],                              // case-insensitive
            ["Skiwear"] = ["outerwear", "Top", "outerwear"],     // order = default slot first; duplicates dropped
        });

        Assert.Equal([OutfitSlot.Top], mapping.SlotsOf(ItemCategory.Beachwear));
        Assert.False(mapping.Accepts(OutfitSlot.Bottom, ItemCategory.Beachwear));
        Assert.Equal([OutfitSlot.Outerwear, OutfitSlot.Top], mapping.SlotsOf(ItemCategory.Skiwear));
        Assert.Equal(OutfitSlot.Outerwear, mapping.DefaultSlot(ItemCategory.Skiwear));
        Assert.Equal([OutfitSlot.Shoes], mapping.SlotsOf(ItemCategory.Shoes));   // untouched
        Assert.True(SlotMapping.Default.Accepts(OutfitSlot.Bottom, ItemCategory.Beachwear)); // the default object is never mutated
    }

    [Fact]
    public void ATypoInConfig_NeverLeavesACategoryWithoutASlot()
    {
        var mapping = SlotMapping.From(new Dictionary<string, List<string>>
        {
            ["Swimwear"] = ["Top"],            // unknown category
            ["Beachwear"] = ["Torso", ""],     // no known slot
            ["Skiwear"] = [],
            ["7"] = ["Top"],
        });

        Assert.Equal(SlotMapping.Default.SlotsOf(ItemCategory.Beachwear), mapping.SlotsOf(ItemCategory.Beachwear));
        Assert.Equal(SlotMapping.Default.SlotsOf(ItemCategory.Skiwear), mapping.SlotsOf(ItemCategory.Skiwear));
    }

    [Fact]
    public void OutfitSlotRules_UseTheConfiguredMapping_DefaultUntilConfigured()
    {
        Assert.True(OutfitSlotRules.Accepts(OutfitSlot.Outerwear, ItemCategory.Skiwear));
        Assert.True(OutfitSlotRules.Accepts(OutfitSlot.Bottom, ItemCategory.Beachwear));
        Assert.Equal(OutfitSlot.Top, OutfitSlotRules.DefaultSlot(ItemCategory.Beachwear));
        Assert.Equal(SlotMapping.Default.SlotsOf(ItemCategory.Skiwear), OutfitSlotRules.Mapping.SlotsOf(ItemCategory.Skiwear));
    }
}
