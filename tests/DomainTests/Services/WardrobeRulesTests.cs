using Domain.Constant;
using Domain.Enum;
using Domain.Services;
using Domain.Services.Ai;

namespace DomainTests.Services;

public class GarmentVisionGuardTests
{
    private static Dictionary<string, double> Confident(double value = 0.9) => new()
    {
        [GarmentVisionGuard.FieldCategory] = value,
        [GarmentVisionGuard.FieldColors] = value,
        [GarmentVisionGuard.FieldFabric] = value,
        [GarmentVisionGuard.FieldSeasons] = value,
    };

    [Fact]
    public void Apply_ConfidentKnownValues_KeepsEverything_NoFlags()
    {
        var fields = GarmentVisionGuard.Apply(
            new GarmentSuggestion(ItemCategoryHint.Outerwear, ["navy"], "wool", [Season.Autumn, Season.Winter], Confident(), "Lacivert blazer"), 0.7);

        Assert.Equal(ItemCategory.Outerwear, fields.Category);
        Assert.Equal(["navy"], fields.ColorIds);
        Assert.Equal("wool", fields.Fabric);
        Assert.Equal([Season.Autumn, Season.Winter], fields.Seasons);
        Assert.Equal("Lacivert blazer", fields.Name);
        Assert.Empty(fields.FlaggedFields);
        Assert.False(fields.NeedsReview);
    }

    [Fact]
    public void Apply_LowCategoryConfidence_KeepsValueButFlagsForReview()
    {
        var confidence = Confident();
        confidence[GarmentVisionGuard.FieldCategory] = 0.4;

        var fields = GarmentVisionGuard.Apply(new GarmentSuggestion(ItemCategoryHint.Top, ["white"], "cotton", [Season.Summer], confidence), 0.7);

        Assert.Equal(ItemCategory.Top, fields.Category);
        Assert.Contains(GarmentVisionGuard.FieldCategory, fields.FlaggedFields);
        Assert.True(fields.NeedsReview);
    }

    [Fact]
    public void Apply_ValuesOutsideVocabulary_AreDroppedAndFlagged_NeverGuessed()
    {
        var fields = GarmentVisionGuard.Apply(
            new GarmentSuggestion((ItemCategoryHint)99, ["navy", "unicorn"], "kevlar", [Season.Winter, (Season)(-1)], Confident()), 0.7);

        Assert.Null(fields.Category);
        Assert.Equal(["navy"], fields.ColorIds);
        Assert.Null(fields.Fabric);
        Assert.Equal([Season.Winter], fields.Seasons);
        Assert.Equal(
            [GarmentVisionGuard.FieldCategory, GarmentVisionGuard.FieldColors, GarmentVisionGuard.FieldFabric, GarmentVisionGuard.FieldSeasons],
            fields.FlaggedFields);
        Assert.True(fields.NeedsReview);
    }

    [Fact]
    public void Apply_MissingConfidence_IsTreatedAsLow()
    {
        var fields = GarmentVisionGuard.Apply(new GarmentSuggestion(ItemCategoryHint.Shoes, ["black"], null, [Season.Winter], new Dictionary<string, double>()), 0.7);

        Assert.True(fields.NeedsReview);
        Assert.Contains(GarmentVisionGuard.FieldColors, fields.FlaggedFields);
        Assert.DoesNotContain(GarmentVisionGuard.FieldFabric, fields.FlaggedFields); // nothing suggested, nothing to flag
    }

    [Fact]
    public void Apply_MoreThanOneGarment_FlagsCategory()
    {
        var fields = GarmentVisionGuard.Apply(new GarmentSuggestion(ItemCategoryHint.Top, ["black"], "cotton", [Season.Summer], Confident(), GarmentCount: 2), 0.7);

        Assert.True(fields.NeedsReview);
    }

    [Theory]
    [InlineData(true, 1, true)]
    [InlineData(false, 1, false)]
    [InlineData(true, 0, false)]
    public void HasGarment(bool isGarment, int count, bool expected) =>
        Assert.Equal(expected, GarmentVisionGuard.HasGarment(new GarmentSuggestion(null, [], null, [], new Dictionary<string, double>(), null, isGarment, count)));

    [Fact]
    public void Apply_EveryCategoryHintMapsToAnItemCategory()
    {
        foreach (var hint in Enum.GetValues<ItemCategoryHint>())
            Assert.NotNull(GarmentVisionGuard.Apply(new GarmentSuggestion(hint, ["black"], null, [Season.Summer], Confident()), 0.5).Category);
    }
}

public class ItemRulesTests
{
    private static ItemFields Valid() => new("Blazer", ItemCategory.Outerwear, ["navy"], "wool", [Season.Autumn], "M", "Mango");

    [Fact]
    public void Validate_ValidFields_NoErrors() => Assert.Empty(ItemRules.Validate(Valid()));

    [Fact]
    public void Validate_OptionalFieldsMissing_StillValid() =>
        Assert.Empty(ItemRules.Validate(new ItemFields(null, ItemCategory.Bag, ["black"], null, [Season.Winter], null, null)));

    [Fact]
    public void Validate_NoSeason_SeasonRequired() =>
        Assert.Contains(ErrorCodes.SeasonRequired, ItemRules.Validate(Valid() with { Seasons = [] }));

    [Fact]
    public void Validate_NoCategory_CategoryRequired() =>
        Assert.Contains(ErrorCodes.CategoryRequired, ItemRules.Validate(Valid() with { Category = null }));

    [Fact]
    public void Validate_NoColour_ColorRequired() =>
        Assert.Contains(ErrorCodes.ColorRequired, ItemRules.Validate(Valid() with { ColorIds = null }));

    [Theory]
    [InlineData("unicorn")]
    [InlineData("navy,navy")]
    public void Validate_UnknownOrRepeatedColour_ColorUnknown(string csv) =>
        Assert.Contains(ErrorCodes.ColorUnknown, ItemRules.Validate(Valid() with { ColorIds = csv.Split(',') }));

    [Fact]
    public void Validate_UnknownFabric_FabricUnknown() =>
        Assert.Contains(ErrorCodes.FabricUnknown, ItemRules.Validate(Valid() with { Fabric = "kevlar" }));

    [Fact]
    public void Validate_TooLongName_ValidationFailed() =>
        Assert.Contains(ErrorCodes.ValidationFailed, ItemRules.Validate(Valid() with { Name = new string('a', ItemRules.MaxNameLength + 1) }));

    [Theory]
    [InlineData("blazer", true)]
    [InlineData("mini-skirt", true)]
    [InlineData("Blazer", false)]
    [InlineData("two words", false)]
    [InlineData("-dash", false)]
    public void Subcategory_IsALowerCaseKebabId(string value, bool valid) =>
        Assert.Equal(valid, !ItemRules.Validate(Valid() with { Subcategory = value }).Contains(ErrorCodes.SubcategoryInvalid));

    [Fact]
    public void FreeTextFabric_AndOtherColour_AreAccepted_WithinLimits()
    {
        Assert.Empty(ItemRules.Validate(Valid() with { ColorIds = ["other"], ColorHex = "#a1b2c3", Fabric = null, FabricText = "Tüvit" }));
        Assert.Contains(ErrorCodes.FabricTextTooLong, ItemRules.Validate(Valid() with { FabricText = new string('a', ItemRules.MaxFabricTextLength + 1) }));
        Assert.Contains(ErrorCodes.ColorHexInvalid, ItemRules.Validate(Valid() with { ColorHex = "#12345" }));
    }

    [Fact]
    public void ColorHex_IsKeptOnlyWithTheOtherColour_UpperCased()
    {
        Assert.Equal("#A1B2C3", ItemRules.NormalizeColorHex(["navy", "other"], " #a1b2c3 "));
        Assert.Null(ItemRules.NormalizeColorHex(["navy"], "#A1B2C3"));
        Assert.Null(ItemRules.NormalizeColorHex(["other"], " "));
    }
}

public class ItemDraftRulesTests
{
    [Theory]
    [InlineData(ItemDraftStatus.Ready, ItemDraftKind.Single, false, false, null)]
    [InlineData(ItemDraftStatus.Ready, ItemDraftKind.Piece, false, false, null)]
    [InlineData(ItemDraftStatus.Failed, ItemDraftKind.Single, false, false, null)] // filled by hand
    [InlineData(ItemDraftStatus.Ready, ItemDraftKind.Single, true, true, null)]
    [InlineData(ItemDraftStatus.Ready, ItemDraftKind.Single, true, false, ErrorCodes.DraftReviewRequired)] // "select all" skips it
    [InlineData(ItemDraftStatus.Uploaded, ItemDraftKind.Single, false, true, ErrorCodes.DraftNotReady)]
    [InlineData(ItemDraftStatus.Processing, ItemDraftKind.Single, false, true, ErrorCodes.DraftNotReady)]
    [InlineData(ItemDraftStatus.Ready, ItemDraftKind.Outfit, false, true, ErrorCodes.DraftIsOutfitSource)]
    public void CheckConfirm(ItemDraftStatus status, ItemDraftKind kind, bool needsReview, bool reviewed, string? expected) =>
        Assert.Equal(expected, ItemDraftRules.CheckConfirm(status, kind, needsReview, reviewed));

    [Fact]
    public void MaxBulk_Is30() => Assert.Equal(30, ItemDraftRules.MaxBulk);
}

public class OutfitSlotRulesTests
{
    private static SlotPiece Item(OutfitSlot slot, ItemCategory? category, string? id = null) => new(slot, id ?? $"item-{slot}", null, category);
    private static SlotPiece Product(OutfitSlot slot, ItemCategory? category, string? id = null) => new(slot, null, id ?? $"prd-{slot}", category);

    [Fact]
    public void Validate_TopBottomShoes_Valid() =>
        Assert.Empty(OutfitSlotRules.Validate([Item(OutfitSlot.Top, ItemCategory.Top), Item(OutfitSlot.Bottom, ItemCategory.Bottom), Item(OutfitSlot.Shoes, ItemCategory.Shoes)]));

    [Fact]
    public void Validate_WardrobeItemPlusCatalogProduct_Valid() =>
        Assert.Empty(OutfitSlotRules.Validate([Item(OutfitSlot.Top, ItemCategory.Top), Product(OutfitSlot.BagAccessory, ItemCategory.Bag)]));

    [Fact]
    public void Validate_OnePiece_LookMinPieces() =>
        Assert.Equal([ErrorCodes.LookMinPieces], OutfitSlotRules.Validate([Item(OutfitSlot.Top, ItemCategory.Top)]));

    [Fact]
    public void Validate_DressInTopWithShoes_Valid_ButWithBottom_DressClosesBottom()
    {
        Assert.Empty(OutfitSlotRules.Validate([Item(OutfitSlot.Top, ItemCategory.Dress), Item(OutfitSlot.Shoes, ItemCategory.Shoes)]));
        Assert.Contains(ErrorCodes.DressClosesBottom,
            OutfitSlotRules.Validate([Item(OutfitSlot.Top, ItemCategory.Dress), Item(OutfitSlot.Bottom, ItemCategory.Bottom)]));
    }

    [Fact]
    public void Validate_SameSlotTwice_SlotDuplicate() =>
        Assert.Contains(ErrorCodes.SlotDuplicate,
            OutfitSlotRules.Validate([Item(OutfitSlot.Top, ItemCategory.Top, "a"), Item(OutfitSlot.Top, ItemCategory.Top, "b")]));

    [Fact]
    public void Validate_SamePieceInTwoSlots_SlotPieceRepeated() =>
        Assert.Contains(ErrorCodes.SlotPieceRepeated,
            OutfitSlotRules.Validate([Item(OutfitSlot.Top, ItemCategory.Skiwear, "ski"), Item(OutfitSlot.Outerwear, ItemCategory.Skiwear, "ski")]));

    [Fact]
    public void Validate_CategoryDoesNotFitSlot_SlotCategoryMismatch() =>
        Assert.Contains(ErrorCodes.SlotCategoryMismatch,
            OutfitSlotRules.Validate([Item(OutfitSlot.Top, ItemCategory.Shoes), Item(OutfitSlot.Bottom, ItemCategory.Bottom)]));

    [Fact]
    public void Validate_UnresolvedItemOrProduct_NotFoundCodes()
    {
        var errors = OutfitSlotRules.Validate([Item(OutfitSlot.Top, null), Product(OutfitSlot.Shoes, null)]);

        Assert.Contains(ErrorCodes.SlotItemNotFound, errors);
        Assert.Contains(ErrorCodes.SlotProductNotFound, errors);
    }

    [Fact]
    public void Validate_BothOrNeitherSource_SlotSourceInvalid()
    {
        Assert.Contains(ErrorCodes.SlotSourceInvalid, OutfitSlotRules.Validate(
            [new SlotPiece(OutfitSlot.Top, "i1", "p1", ItemCategory.Top), Item(OutfitSlot.Bottom, ItemCategory.Bottom)]));
        Assert.Contains(ErrorCodes.SlotSourceInvalid, OutfitSlotRules.Validate(
            [new SlotPiece(OutfitSlot.Top, null, null, null), Item(OutfitSlot.Bottom, ItemCategory.Bottom)]));
    }

    [Theory]
    [InlineData(OutfitSlot.Top, "Top,Dress,Beachwear,Skiwear")]
    [InlineData(OutfitSlot.Bottom, "Bottom,Beachwear,Skiwear")]
    [InlineData(OutfitSlot.Outerwear, "Outerwear,Skiwear")]
    [InlineData(OutfitSlot.Shoes, "Shoes")]
    [InlineData(OutfitSlot.BagAccessory, "Bag,Accessory")]
    public void Accepts_Matrix(OutfitSlot slot, string csv)
    {
        var accepted = Enum.GetValues<ItemCategory>().Where(c => OutfitSlotRules.Accepts(slot, c)).Select(c => c.ToString());
        Assert.Equal(csv.Split(','), accepted);
    }

    [Fact]
    public void DefaultSlot_AlwaysAcceptsItsCategory()
    {
        foreach (var category in Enum.GetValues<ItemCategory>())
            Assert.True(OutfitSlotRules.Accepts(OutfitSlotRules.DefaultSlot(category), category));
    }
}

public class WearStatsRulesTests
{
    [Fact]
    public void NewlyCounted_SamePieceSameDay_CountsOnce()
    {
        var newly = WearStatsRules.NewlyCounted(["a", "b", "b"], [new WearEvent("2026-11-18", ["a", "x"])]);

        Assert.Equal(["b"], newly);
    }

    [Fact]
    public void Recompute_CountsDistinctDays_AndLatestDay()
    {
        WearEvent[] logs =
        [
            new("2026-11-10", ["a"]),
            new("2026-11-18", ["a", "b"]),
            new("2026-11-18", ["a"]), // same day twice: still one
            new("2026-11-12", ["b"]),
        ];

        Assert.Equal(new ItemWearStats(2, "2026-11-18"), WearStatsRules.Recompute("a", logs));
        Assert.Equal(new ItemWearStats(0, null), WearStatsRules.Recompute("never", logs));
    }

    [Fact]
    public void Recompute_AfterRemovingALog_GivesTheCountBack()
    {
        WearEvent[] logs = [new("2026-11-10", ["a"]), new("2026-11-18", ["a"])];

        Assert.Equal(new ItemWearStats(1, "2026-11-10"), WearStatsRules.Recompute("a", logs.Take(1)));
    }

    [Theory]
    [InlineData(null, "2026-11-18", "2026-11-18")]
    [InlineData("2026-11-10", "2026-11-18", "2026-11-18")]
    [InlineData("2026-11-20", "2026-11-18", "2026-11-20")] // a late offline log never rewinds
    public void LaterDay(string? current, string date, string expected) => Assert.Equal(expected, WearStatsRules.LaterDay(current, date));

    [Fact]
    public void Summarize_LoggedDaysAndMostWorn()
    {
        var summary = WearStatsRules.Summarize(
        [
            new WearEvent("2026-11-01", ["a", "b"]),
            new WearEvent("2026-11-01", ["a"]),
            new WearEvent("2026-11-02", ["a", "c"]),
            new WearEvent("2026-11-03", ["b"]),
        ]);

        Assert.Equal(3, summary.LoggedDays);
        Assert.Equal(5, summary.TotalWears);
        Assert.Equal([new MostWornItem("a", 2), new MostWornItem("b", 2), new MostWornItem("c", 1)], summary.MostWorn);
    }
}

public class PaletteRulesTests
{
    private static readonly SeasonTypeDefinition WarmAutumn = SeasonTypeCatalog.Find("warm-autumn")!;

    [Fact]
    public void Evaluate_PercentCountsEverythingThatDoesNotClash()
    {
        var result = PaletteCompatibilityRules.Evaluate(
            [("i1", "camel"), ("i2", "rust"), ("i3", "navy"), ("i4", "black"), ("i5", "icy-blue"), ("i6", null), ("i7", "not-a-colour")],
            WarmAutumn.FlatteringColorIds, WarmAutumn.AvoidColorIds);

        Assert.Equal(5, result.TotalCount);       // pieces without a known colour are skipped
        Assert.Equal(2, result.CompatibleCount);  // camel, rust
        Assert.Equal(1, result.NeutralCount);     // navy
        Assert.Equal(2, result.IncompatibleCount);
        Assert.Equal(["i4", "i5"], result.IncompatibleItemIds);
        Assert.Equal(60, result.Percent);
    }

    [Fact]
    public void Evaluate_EmptyWardrobe_NoPercent() =>
        Assert.Null(PaletteCompatibilityRules.Evaluate([], WarmAutumn.FlatteringColorIds, WarmAutumn.AvoidColorIds).Percent);

    [Fact]
    public void Evaluate_RoundsHalfAwayFromZero()
    {
        // 7 of 8 compatible = 87.5 -> 88
        var items = Enumerable.Range(0, 7).Select(i => ($"ok{i}", (string?)"camel")).Append(("bad", "black"));
        Assert.Equal(88, PaletteCompatibilityRules.Evaluate(items, WarmAutumn.FlatteringColorIds, WarmAutumn.AvoidColorIds).Percent);
    }

    [Theory]
    [InlineData("camel", PaletteMatch.Compatible)]
    [InlineData("black", PaletteMatch.Incompatible)]
    [InlineData("navy", PaletteMatch.Neutral)]
    [InlineData(null, PaletteMatch.Neutral)]
    public void Classify(string? color, PaletteMatch expected) =>
        Assert.Equal(expected, PaletteCompatibilityRules.Classify(color, WarmAutumn.FlatteringColorIds, WarmAutumn.AvoidColorIds));

    [Fact]
    public void Guard_OneFaceKnownSeason_Accepted_ColoursComeFromTheTable()
    {
        var result = PaletteOutputGuard.Evaluate(new PaletteAnalysis("warm-autumn", [], [], 1, 0.9), 0.6);

        Assert.Equal(PaletteGuardOutcome.Accepted, result.Outcome);
        Assert.Same(WarmAutumn, result.SeasonType);
        Assert.False(result.LowConfidence);
    }

    [Fact]
    public void Guard_LowConfidence_IsMarkedNeverRaised() =>
        Assert.True(PaletteOutputGuard.Evaluate(new PaletteAnalysis("warm-autumn", [], [], 1, 0.3), 0.6).LowConfidence);

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    public void Guard_NotExactlyOneFace_NoFace(int faces) =>
        Assert.Equal(PaletteGuardOutcome.NoFace, PaletteOutputGuard.Evaluate(new PaletteAnalysis("warm-autumn", [], [], faces), 0.6).Outcome);

    [Fact]
    public void Guard_Refusal_PhotoUnsuitable() =>
        Assert.Equal(PaletteGuardOutcome.PhotoUnsuitable,
            PaletteOutputGuard.Evaluate(new PaletteAnalysis("", [], [], 1, 0, "photo_unsuitable"), 0.6).Outcome);

    [Theory]
    [InlineData("sunny-monsoon")]
    [InlineData("")]
    public void Guard_SeasonOutsideTheTable_Rejected(string season) =>
        Assert.Equal(PaletteGuardOutcome.Rejected, PaletteOutputGuard.Evaluate(new PaletteAnalysis(season, [], [], 1), 0.6).Outcome);

    [Fact]
    public void Guard_ContradictingColourLists_Rejected() =>
        Assert.Equal(PaletteGuardOutcome.Rejected, PaletteOutputGuard.Evaluate(new PaletteAnalysis("warm-autumn", ["rust"], ["rust"], 1), 0.6).Outcome);
}

public class ReferenceCatalogTests
{
    [Fact]
    public void SeasonTypes_UseOnlyKnownColours_AndListsNeverIntersect()
    {
        Assert.Equal(12, SeasonTypeCatalog.All.Count);
        foreach (var season in SeasonTypeCatalog.All)
        {
            Assert.All(season.FlatteringColorIds.Concat(season.AvoidColorIds), id => Assert.True(ColorCatalog.IsKnown(id), $"{season.Id}: {id}"));
            Assert.Empty(season.FlatteringColorIds.Intersect(season.AvoidColorIds));
            Assert.NotEmpty(season.FlatteringColorIds);
            Assert.NotEmpty(season.AvoidColorIds);
        }
    }

    [Fact]
    public void Ids_AreUniqueKebabCase()
    {
        Assert.Equal(ColorCatalog.Ids.Count, ColorCatalog.Ids.Distinct().Count());
        Assert.Equal(FabricCatalog.Ids.Count, FabricCatalog.Ids.Distinct().Count());
        Assert.All(ColorCatalog.Ids.Concat(FabricCatalog.Ids).Concat(SeasonTypeCatalog.Ids), id => Assert.Matches("^[a-z]+(-[a-z]+)*$", id));
    }

    [Fact]
    public void ReferenceNames_AreLanguageMaps_WithEverySupportedLanguage()
    {
        var maps = ColorCatalog.All.Select(c => c.Name).Concat(SeasonTypeCatalog.All.Select(s => s.Name));
        Assert.All(maps, names => Assert.All(LanguagePolicy.BuiltIn.Supported, language => Assert.False(string.IsNullOrWhiteSpace(names[language]))));
    }

    [Theory]
    [InlineData("en", "Navy")]
    [InlineData("en-GB,en;q=0.9", "Navy")]
    [InlineData("tr", "Lacivert")]
    [InlineData("de", "Lacivert")] // unsupported -> Turkish fallback
    [InlineData(null, "Lacivert")]
    public void Resolve_PicksTheLanguage_WithTurkishFallback(string? language, string expected) =>
        Assert.Equal(expected, Localized.Resolve(ColorCatalog.Find("navy")!.Name, language));

    [Fact]
    public void Resolve_ThirdLanguageIsDataOnly()
    {
        var names = new Dictionary<string, string> { ["tr"] = "Lacivert", ["en"] = "Navy", ["de"] = "Marineblau" };

        Assert.Equal("Lacivert", Localized.Resolve(names, "de")); // not yet in Supported
        Assert.Equal("Lacivert", Localized.Resolve(new Dictionary<string, string> { ["tr"] = "Lacivert" }, "en")); // missing translation
    }

    [Theory]
    [InlineData("en", "tr", "en")]      // profile wins
    [InlineData(null, "en-US", "en")]   // then Accept-Language
    [InlineData("de", "en", "en")]      // unsupported profile language falls through
    [InlineData(null, null, "tr")]
    [InlineData("xx", "yy", "tr")]
    public void Language_ProfileThenRequestThenTurkish(string? profile, string? request, string expected) =>
        Assert.Equal(expected, Localized.Language(profile, request));
}

public class CalendarAndFingerprintTests
{
    [Theory]
    [InlineData("2026-03-01", Season.Spring)]
    [InlineData("2026-07-15", Season.Summer)]
    [InlineData("2026-11-18", Season.Autumn)]
    [InlineData("2026-12-01", Season.Winter)]
    [InlineData("2026-02-28", Season.Winter)]
    public void SeasonRules_For(string date, Season expected) => Assert.Equal(expected, SeasonRules.For(CalendarDay.Parse(date)));

    [Theory]
    [InlineData("2026-11-18", true)]
    [InlineData("2026-13-01", false)]
    [InlineData("18.11.2026", false)]
    [InlineData("2026-11-18T10:00:00Z", false)]
    [InlineData(null, false)]
    public void CalendarDay_IsValid(string? value, bool expected) => Assert.Equal(expected, CalendarDay.IsValid(value));

    [Fact]
    public void CalendarDay_Range_IsInclusive() =>
        Assert.Equal(["2026-11-29", "2026-11-30", "2026-12-01"], CalendarDay.Range(new DateOnly(2026, 11, 29), new DateOnly(2026, 12, 1)));

    [Fact]
    public void TryOnFingerprint_SamePiecesAnyOrder_SameKey_DifferentPieces_DifferentKey()
    {
        var a = TryOnFingerprint.Of([new OutfitPiece("i1", null), new OutfitPiece(null, "p1"), new OutfitPiece("i2", null)]);
        var b = TryOnFingerprint.Of([new OutfitPiece("i2", null), new OutfitPiece("i1", null), new OutfitPiece(null, "p1"), new OutfitPiece("i1", null)]);
        var c = TryOnFingerprint.Of([new OutfitPiece("i1", null), new OutfitPiece("i2", null)]);
        var itemVsProduct = TryOnFingerprint.Of([new OutfitPiece(null, "i1"), new OutfitPiece("p1", null), new OutfitPiece("i2", null)]);

        Assert.Equal(a, b);
        Assert.NotEqual(a, c);
        Assert.NotEqual(a, itemVsProduct);
        Assert.Equal(32, a.Length);
    }
}

public class LibrarySeedTests
{
    private const string Valid = """
        { "version": 1, "items": [
          { "id": "lib-white-tshirt", "name": { "tr": "Beyaz tişört", "en": "White T-shirt" }, "category": "top", "colorIds": ["white"], "fabric": "cotton", "seasons": ["summer"], "imageKey": "library/a.webp", "sortOrder": 1 },
          { "id": "lib-navy-blazer", "name": { "tr": "Lacivert blazer" }, "category": "outerwear", "colorIds": ["navy"], "seasons": ["autumn", "winter"] }
        ] }
        """;

    [Fact]
    public void Parse_ValidFile_ReturnsEntities_WithLocalizedNames()
    {
        var result = LibrarySeed.Parse(Valid);

        Assert.True(result.IsValid, string.Join("; ", result.Errors));
        Assert.Equal(2, result.Items.Count);
        Assert.Equal("White T-shirt", Localized.Resolve(result.Items[0].Name, "en"));
        Assert.Equal("Lacivert blazer", Localized.Resolve(result.Items[1].Name, "en")); // no English yet: Turkish fallback
        Assert.Equal(ItemCategory.Outerwear, result.Items[1].Category);
    }

    [Theory]
    [InlineData("\"lib-white-tshirt\", \"name\": { \"tr\": \"Beyaz tişört\", \"en\": \"White T-shirt\" }", "\"lib-navy-blazer\", \"name\": { \"tr\": \"x\" }")] // duplicate id
    [InlineData("\"lib-white-tshirt\"", "\"White_Tshirt\"")]
    [InlineData("\"colorIds\": [\"white\"]", "\"colorIds\": [\"unicorn\"]")]
    [InlineData("\"fabric\": \"cotton\"", "\"fabric\": \"kevlar\"")]
    [InlineData("\"seasons\": [\"summer\"]", "\"seasons\": []")]
    [InlineData("{ \"tr\": \"Lacivert blazer\" }", "{ \"en\": \"Navy blazer\" }")] // tr is the mandatory fallback
    [InlineData("\"version\": 1", "\"version\": 2")]
    public void Parse_InvalidFile_ReportsErrors(string find, string replace)
    {
        var json = find.StartsWith("\"lib-white-tshirt\", \"name\"", StringComparison.Ordinal)
            ? Valid.Replace("\"lib-navy-blazer\", \"name\": { \"tr\": \"Lacivert blazer\" }", "\"lib-white-tshirt\", \"name\": { \"tr\": \"x\" }")
            : Valid.Replace(find, replace);

        Assert.False(LibrarySeed.Parse(json).IsValid);
    }

    [Fact]
    public void Parse_NotJson_ReportsError() => Assert.False(LibrarySeed.Parse("nope").IsValid);
}

public class LanguagePolicyTests
{
    private static LanguagePolicy Policy(string? defaultLanguage = "tr", params string[] supported) =>
        LanguagePolicy.From(new Domain.Options.LocalizationOptions { SupportedLanguages = supported.ToList(), DefaultLanguage = defaultLanguage! });

    [Fact]
    public void EmptyConfig_IsTurkishAndEnglish_DefaultTurkish()
    {
        var policy = LanguagePolicy.From(new Domain.Options.LocalizationOptions());
        Assert.Equal(["tr", "en"], policy.Supported.ToArray());
        Assert.Equal("tr", policy.Default);
        Assert.Equal(policy.Supported, LanguagePolicy.BuiltIn.Supported);
    }

    [Fact]
    public void ConfigIsTheOnlyLanguageList_AThirdLanguageIsConfigOnly()
    {
        var policy = Policy("tr", "tr", "EN ", "de", "de");

        Assert.Equal(["tr", "en", "de"], policy.Supported.ToArray());
        Assert.Equal("de", policy.Normalize("de-AT"));
        Assert.Equal("de", policy.Language(null, "de-DE,de;q=0.9,en;q=0.8"));
        Assert.Null(LanguagePolicy.BuiltIn.Normalize("de"));
        Assert.Equal("tr", LanguagePolicy.BuiltIn.Language(null, "de-DE,de;q=0.9"));
    }

    [Fact]
    public void DefaultLanguage_IsAlwaysSupported_AndIsTheFallback()
    {
        var policy = Policy("en", "tr");

        Assert.Equal(["en", "tr"], policy.Supported.ToArray());
        Assert.Equal("en", policy.Default);
        Assert.Equal("en", policy.Language("fr", "es-ES"));
        Assert.Equal("tr", Policy("", "tr", "en").Default); // blank default = first supported
    }

    [Theory]
    [InlineData("en", null, "en")]                          // profile wins
    [InlineData("en", "tr-TR", "en")]
    [InlineData(null, "en-US,en;q=0.9,tr;q=0.8", "en")]     // then Accept-Language by weight
    [InlineData(null, "fr-FR,tr;q=0.5,en;q=0.9", "en")]
    [InlineData("xx", "tr", "tr")]                          // unsupported profile value is ignored
    [InlineData(null, "fr-FR", "tr")]                       // nothing supported → default
    [InlineData(null, null, "tr")]
    [InlineData(null, "", "tr")]
    public void Language_ProfileThenAcceptLanguageThenDefault(string? profile, string? acceptLanguage, string expected) =>
        Assert.Equal(expected, LanguagePolicy.BuiltIn.Language(profile, acceptLanguage));

    [Fact]
    public void LocalizationOptions_UseTheSamePolicy()
    {
        var options = new Domain.Options.LocalizationOptions { SupportedLanguages = ["EN", "tr", "de"], DefaultLanguage = "tr" };

        Assert.Equal(["en", "tr", "de"], options.Languages.ToArray());
        Assert.True(options.IsSupported("de"));
        Assert.False(options.IsSupported("fr"));
        Assert.False(options.IsSupported(null));
    }
}
