using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;

namespace DomainTests.Services;

public class ItemDetectionGuardTests
{
    private static readonly Dictionary<string, double> Sure = new() { ["category"] = 0.9, ["colorIds"] = 0.9, ["fabric"] = 0.9, ["seasons"] = 0.9 };

    private static DetectedItem Item(ItemCategoryHint? category, double x, double y, double w, double h, double confidence = 0.9, string? subcategory = null, bool wearable = true) =>
        new(new GarmentSuggestion(category, ["black"], null, [Season.Winter], Sure, "Parça"), new BoundingBox(x, y, w, h), subcategory, confidence, wearable);

    [Fact]
    public void Filter_KeepsEveryDistinctPiece_InReadingOrder()
    {
        var kept = ItemDetectionGuard.Filter(
        [
            Item(ItemCategoryHint.Shoes, 0.5, 0.8, 0.3, 0.15),
            Item(ItemCategoryHint.Top, 0.1, 0.05, 0.4, 0.3),
            Item(ItemCategoryHint.Accessory, 0.6, 0.1, 0.08, 0.06, subcategory: "necklace"),
        ], 12);

        Assert.Equal([ItemCategoryHint.Top, ItemCategoryHint.Accessory, ItemCategoryHint.Shoes], kept.Select(i => i.Garment.Category));
    }

    [Fact]
    public void Filter_DropsDuplicates_KeepingTheMoreConfidentBox()
    {
        var kept = ItemDetectionGuard.Filter(
        [
            Item(ItemCategoryHint.Top, 0.1, 0.1, 0.4, 0.4, confidence: 0.7),
            Item(ItemCategoryHint.Top, 0.11, 0.1, 0.4, 0.42, confidence: 0.95),                    // same top, IoU > 0.6
            Item(ItemCategoryHint.Bottom, 0.12, 0.12, 0.38, 0.38, confidence: 0.6),                // any category, IoU > 0.6
            Item(ItemCategoryHint.Accessory, 0.6, 0.6, 0.1, 0.1, subcategory: "ring"),
            Item(ItemCategoryHint.Accessory, 0.62, 0.62, 0.05, 0.05, subcategory: "ring", confidence: 0.5), // inside the first ring
        ], 12);

        Assert.Equal(2, kept.Count);
        Assert.Equal(0.95, kept.Single(i => i.Garment.Category == ItemCategoryHint.Top).Confidence);
        Assert.Single(kept, i => i.Subcategory == "ring");
    }

    [Fact]
    public void Filter_KeepsANecklaceLyingOnATop_DifferentCategoriesNeverMerge()
    {
        var kept = ItemDetectionGuard.Filter(
        [
            Item(ItemCategoryHint.Top, 0.1, 0.1, 0.6, 0.5),
            Item(ItemCategoryHint.Accessory, 0.3, 0.15, 0.15, 0.1, subcategory: "necklace"),
        ], 12);

        Assert.Equal(2, kept.Count);
    }

    [Theory]
    [InlineData(0.5, 0.5, 0.01, 0.3)]   // a sliver
    [InlineData(0.5, 0.5, 0.025, 0.025)] // below the minimum area
    [InlineData(0.5, 0.5, 0, 0.2)]      // no width
    [InlineData(0.5, 0.5, -0.2, 0.2)]   // negative
    [InlineData(1.2, 0.5, 0.2, 0.2)]    // wholly outside the photo
    [InlineData(double.NaN, 0.5, 0.2, 0.2)]
    public void Filter_DropsBoxesThatAreInvalidOrTooSmall(double x, double y, double w, double h) =>
        Assert.Empty(ItemDetectionGuard.Filter([Item(ItemCategoryHint.Accessory, x, y, w, h)], 12));

    [Fact]
    public void Filter_ClipsABoxReachingOutOfThePhoto()
    {
        var kept = Assert.Single(ItemDetectionGuard.Filter([Item(ItemCategoryHint.Bag, 0.8, -0.1, 0.4, 0.5)], 12));

        Assert.Equal(new BoundingBox(0.8, 0, 0.2, 0.4), kept.Box with { Width = Math.Round(kept.Box.Width, 9), Height = Math.Round(kept.Box.Height, 9) });
    }

    [Fact]
    public void Filter_NeverReturnsBodyParts_OrPiecesTheModelItselfDoesNotBelieve()
    {
        var kept = ItemDetectionGuard.Filter(
        [
            Item(null, 0.3, 0.0, 0.3, 0.2, wearable: false),               // a face
            Item(ItemCategoryHint.Accessory, 0.1, 0.6, 0.2, 0.2, wearable: false), // a hand
            Item(ItemCategoryHint.Top, 0.2, 0.2, 0.4, 0.4, confidence: 0.1),
            new(new GarmentSuggestion(ItemCategoryHint.Top, [], null, [], Sure, null, IsGarment: false), new BoundingBox(0.5, 0.5, 0.3, 0.3), null, 0.9),
        ], 12);

        Assert.Empty(kept);
    }

    [Fact]
    public void Filter_CapsTheList_KeepingTheMostConfidentPieces()
    {
        var items = Enumerable.Range(0, 20)
            .Select(i => Item(ItemCategoryHint.Accessory, 0.045 * i, 0.5, 0.04, 0.05, confidence: 0.3 + i * 0.03, subcategory: "ring"))
            .ToList();

        var kept = ItemDetectionGuard.Filter(items, 12);

        Assert.Equal(12, kept.Count);
        Assert.True(kept.Min(i => i.Confidence) >= 0.3 + 8 * 0.03 - 1e-9);
        Assert.Single(ItemDetectionGuard.Filter(items, 0)); // a broken cap still keeps one
    }

    [Fact]
    public void Fields_LowBoxConfidence_FlagsTheCategoryForReview()
    {
        var fields = ItemDetectionGuard.Fields(Item(ItemCategoryHint.Accessory, 0.1, 0.1, 0.1, 0.1, confidence: 0.5, subcategory: "necklace"), 0.7);
        Assert.True(fields.NeedsReview);
        Assert.Contains(GarmentVisionGuard.FieldCategory, fields.FlaggedFields);

        Assert.False(ItemDetectionGuard.Fields(Item(ItemCategoryHint.Accessory, 0.1, 0.1, 0.1, 0.1, confidence: 0.9), 0.7).NeedsReview);
    }

    [Fact]
    public void Subcategory_MustBelongToTheCategory()
    {
        Assert.Equal("necklace", SubcategoryCatalog.Normalize("necklace", ItemCategory.Accessory));
        Assert.Null(SubcategoryCatalog.Normalize("necklace", ItemCategory.Shoes));
        Assert.Null(SubcategoryCatalog.Normalize("unicorn", ItemCategory.Accessory));
        Assert.True(SubcategoryCatalog.IsJewellery("earrings"));
        Assert.False(SubcategoryCatalog.IsJewellery("belt"));
        Assert.All(SubcategoryCatalog.Ids, id => Assert.True(ItemRules.IsValidSubcategory(id), id));
        foreach (var jewel in new[] { "ring", "necklace", "earrings", "bracelet" })
            Assert.Equal(ItemCategory.Accessory, SubcategoryCatalog.CategoryOf(jewel));
    }

    [Fact]
    public void DetectionSchema_OffersTheSubcategoriesAndABox()
    {
        var item = AiSchemas.ItemDetectionSchema()["properties"]!["items"]!["items"]!["properties"]!;
        var subcategories = item["subcategory"]!["enum"]!.AsArray().Select(v => v?.GetValue<string>()).ToList();

        Assert.Contains("necklace", subcategories);
        Assert.Contains(null, subcategories);
        Assert.Equal(["left", "top", "right", "bottom"], item["box"]!["required"]!.AsArray().Select(v => v!.GetValue<string>()));
    }
}

public class CropMathTests
{
    private static readonly PixelSize Photo = new(1000, 1500);

    [Fact]
    public void Plan_PadsAGarmentALittle_AndKeepsItsScale()
    {
        var plan = CropMath.Plan(new BoundingBox(0.2, 0.2, 0.6, 0.4), Photo, small: false);

        // Box 600 × 600 px at (200, 300); padding 8 % of 600 = 48 px on every side.
        Assert.Equal(new CropPlan(152, 252, 696, 696, 696, 696), plan);
    }

    [Fact]
    public void Plan_PadsJewelleryWide_AndUpscalesItToAUsableSize()
    {
        var plan = CropMath.Plan(new BoundingBox(0.5, 0.5, 0.05, 0.02), Photo, small: true);

        // Box 50 × 30 px; padding max(24, 35 % of 50) = 24 → 98 × 78; upscaled ×4 (capped) towards 1024.
        Assert.Equal((476, 726, 98, 78), (plan.X, plan.Y, plan.Width, plan.Height));
        Assert.Equal((392, 312), (plan.OutputWidth, plan.OutputHeight));
    }

    [Fact]
    public void Plan_StaysInsideThePhoto_AtTheEdges()
    {
        var plan = CropMath.Plan(new BoundingBox(0.9, 0.95, 0.1, 0.05), Photo, small: false);

        Assert.True(plan.X >= 0 && plan.Y >= 0);
        Assert.Equal(Photo.Width, plan.X + plan.Width);
        Assert.Equal(Photo.Height, plan.Y + plan.Height);
    }

    [Fact]
    public void Plan_ShrinksAHugeCrop_ToTheMaximumOutput()
    {
        var plan = CropMath.Plan(new BoundingBox(0, 0, 1, 1), new PixelSize(4000, 3000), small: false);

        Assert.Equal((0, 0, 4000, 3000), (plan.X, plan.Y, plan.Width, plan.Height));
        Assert.Equal((CropMath.MaxOutput, 1152), (plan.OutputWidth, plan.OutputHeight));
    }

    [Fact]
    public void Plan_GrowsATinyBox_ToTheMinimumCropSide()
    {
        var plan = CropMath.Plan(new BoundingBox(0.5, 0.5, 0.001, 0.001), Photo, small: false);

        Assert.True(plan.Width >= CropMath.MinCropSidePx && plan.Height >= CropMath.MinCropSidePx);
    }

    [Fact]
    public void SmallPieces_AreJewelleryOrSmallBoxes_AndBigPiecesUseTheWholePhoto()
    {
        Assert.True(CropMath.IsSmall(new BoundingBox(0, 0, 0.5, 0.5), "ring"));
        Assert.True(CropMath.IsSmall(new BoundingBox(0, 0, 0.1, 0.1), null));
        Assert.False(CropMath.IsSmall(new BoundingBox(0, 0, 0.4, 0.5), "belt"));
        Assert.True(CropMath.UseWholePhoto(new BoundingBox(0, 0, 0.9, 0.8)));
        Assert.False(CropMath.UseWholePhoto(new BoundingBox(0, 0, 0.5, 0.5)));
    }
}

public class DetectedDraftRulesTests
{
    [Fact]
    public void Confirm_ADetectedPiece_IsNotReady_UntilItWasSelectedAndCleaned()
    {
        Assert.Equal("draft_not_ready", ItemDraftRules.CheckConfirm(ItemDraftStatus.Detected, ItemDraftKind.Piece, false, true));
        Assert.Null(ItemDraftRules.CheckConfirm(ItemDraftStatus.Ready, ItemDraftKind.Piece, false, true));
        Assert.Null(ItemDraftRules.CheckConfirm(ItemDraftStatus.Failed, ItemDraftKind.Piece, false, true)); // the crop is still a usable photo
        Assert.Equal("draft_is_outfit_source", ItemDraftRules.CheckConfirm(ItemDraftStatus.Ready, ItemDraftKind.Outfit, false, true));
    }

    [Fact]
    public void ApplyEdit_TakesOnlyValidValues_AndMarksThePieceReviewed()
    {
        var draft = new ItemDraftEntity
        {
            Id = "d", TenantId = "t", Name = "Kolye", Category = ItemCategory.Accessory, Subcategory = "necklace", ColorIds = ["beige"],
            Seasons = [Season.Summer], FlaggedFields = ["category"], NeedsReview = true,
        };

        ItemDraftRules.ApplyEdit(draft, new DetectedPieceEdit("d", "  Altın kolye ", ItemCategory.Accessory, "Kolye!", ["unicorn"], "silk", [Season.Spring, Season.Spring]));

        Assert.Equal("Altın kolye", draft.Name);
        Assert.Equal("necklace", draft.Subcategory);   // invalid sub-type id ignored
        Assert.Equal(["beige"], draft.ColorIds);        // unknown colour ignored
        Assert.Equal("silk", draft.Fabric);
        Assert.Equal([Season.Spring], draft.Seasons);
        Assert.False(draft.NeedsReview);
        Assert.Empty(draft.FlaggedFields);
    }
}
