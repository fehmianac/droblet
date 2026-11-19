using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;

namespace DomainTests.Services;

/// <summary>Owner decision 3: the deterministic gap filling of a thin wardrobe (library first, catalog for the rest).</summary>
public class GapFillTests
{
    private static readonly Season[] AllSeasons = [Season.Spring, Season.Summer, Season.Autumn, Season.Winter];

    private static LibraryItemEntity Lib(string id, ItemCategory category, string color = "black", int sort = 0, params Season[] seasons) => new()
    {
        Id = id, Name = new() { ["tr"] = id }, Category = category, ColorIds = [color], SortOrder = sort,
        Seasons = seasons.Length == 0 ? [.. AllSeasons] : [.. seasons],
    };

    private static CatalogProductEntity Product(string id, ProductCategory category, PriceBand band = PriceBand.HighStreet, string color = "black") => new()
    {
        Id = id, BrandId = "b", Name = new() { ["tr"] = id }, Category = category, Colors = [color], PriceBand = band, CreatedAt = DateTime.UnixEpoch,
    };

    private static CandidateItem Own(string id, ItemCategory category, string color = "black") => new(id, category, [color], null, AllSeasons);

    private static GapFillContext Context(IReadOnlyList<LibraryItemEntity> library, IReadOnlyList<CatalogProductEntity>? catalog = null,
        Season season = Season.Winter, int? maxTemp = null, bool outer = false, string[]? flattering = null, string[]? avoid = null,
        PriceBand? band = null, Occasion? occasion = null) =>
        new(library, catalog ?? [], new HashSet<Season> { season }, occasion, maxTemp, 26, false, outer,
            (flattering ?? []).ToHashSet(), (avoid ?? []).ToHashSet(), band);

    [Fact]
    public void Candidates_AreDeterministic_InSeasonFirst_ScoredThenSortOrder()
    {
        var library = new[]
        {
            Lib("lib-b", ItemCategory.Top, sort: 2), Lib("lib-a", ItemCategory.Top, sort: 1), Lib("lib-summer", ItemCategory.Top, "black", 0, Season.Summer),
        };

        var first = GapFill.Candidates([], Context(library));
        var second = GapFill.Candidates([], Context(library.Reverse().ToArray()));

        Assert.Equal(first.Select(c => c.Id), second.Select(c => c.Id));
        Assert.Equal(["lib:lib-a", "lib:lib-b"], first.Select(c => c.Id)); // the summer top is out of season in winter
    }

    [Fact]
    public void Candidates_ColourHarmony_And_Palette_DecideTheOrder()
    {
        var library = new[] { Lib("lib-red", ItemCategory.Bottom, "red"), Lib("lib-orange", ItemCategory.Bottom, "orange"), Lib("lib-navy", ItemCategory.Bottom, "navy") };
        var own = new[] { Own("t", ItemCategory.Top, "green") };

        // navy is neutral → harmonises with the green top; red is in the palette's avoid list.
        var picked = GapFill.Candidates(own, Context(library, avoid: ["red"], flattering: ["orange"]) with { PerSlot = 3 });

        Assert.Equal(["lib:lib-navy", "lib:lib-orange", "lib:lib-red"], picked.Where(p => p.Category == ItemCategory.Bottom).Select(p => p.Id));
    }

    [Fact]
    public void Candidates_KeepTheUsersOwnShoes_OuterAndBag_ButAddBaseVariety()
    {
        var library = new[] { Lib("lib-top", ItemCategory.Top), Lib("lib-shoes", ItemCategory.Shoes), Lib("lib-coat", ItemCategory.Outerwear) };
        var own = new[] { Own("t", ItemCategory.Top), Own("s", ItemCategory.Shoes), Own("c", ItemCategory.Outerwear) };

        var picked = GapFill.Candidates(own, Context(library));

        Assert.Equal(["lib:lib-top"], picked.Select(p => p.Id));
    }

    [Fact]
    public void Candidates_HotDayDropsOuterwear_AndBeachwearOnlyInSummer()
    {
        var library = new[] { Lib("lib-coat", ItemCategory.Outerwear), Lib("lib-swim", ItemCategory.Beachwear) };

        Assert.DoesNotContain(GapFill.Candidates([], Context(library, season: Season.Summer, maxTemp: 30)), p => p.Category == ItemCategory.Outerwear);
        Assert.DoesNotContain(GapFill.Candidates([], Context(library, season: Season.Winter)), p => p.Category == ItemCategory.Beachwear);
        Assert.Contains(GapFill.Candidates([], Context(library, season: Season.Summer)), p => p.Category == ItemCategory.Beachwear);
    }

    [Fact]
    public void Candidates_CatalogOnlyForASlotTheLibraryCannotFill_InTheBudgetBand_HarmonisingWithOwnPieces()
    {
        var library = new[] { Lib("lib-top", ItemCategory.Top), Lib("lib-trousers", ItemCategory.Bottom) };
        var catalog = new[]
        {
            Product("p-tee", ProductCategory.Tshirt), Product("p-lux", ProductCategory.Shoes, PriceBand.LuxuryTouch),
            Product("p-red", ProductCategory.Shoes, color: "red"), Product("p-ok", ProductCategory.Shoes),
        };
        var own = new[] { Own("t", ItemCategory.Top, "green") };

        var picked = GapFill.Candidates(own, Context(library, catalog, band: PriceBand.HighStreet));

        Assert.DoesNotContain(picked, p => p.Id == "prd:p-tee");          // the library already has tops
        Assert.Contains(picked, p => p.Id == "prd:p-ok");
        Assert.DoesNotContain(picked, p => p.Id == "prd:p-lux");          // budget band
        Assert.DoesNotContain(picked, p => p.Id == "prd:p-red");          // red does not go with green (neither is neutral)
    }

    [Fact]
    public void Outfits_ThinWardrobe_OwnPiecesInSlots_PicksInMissing_Complete()
    {
        var library = new[] { Lib("lib-trousers", ItemCategory.Bottom), Lib("lib-jeans", ItemCategory.Bottom, "denim"), Lib("lib-sneakers", ItemCategory.Shoes, "white") };
        var own = new[] { Own("t", ItemCategory.Top) };

        var outfits = GapFill.Outfits(own, Context(library), 2, new RuleOutfitOptions());

        Assert.Equal(2, outfits.Count);
        Assert.All(outfits, o =>
        {
            Assert.Equal([new SlotRef(OutfitSlot.Top, "t")], o.Slots);
            Assert.Contains(o.Missing, m => m.Slot == OutfitSlot.Bottom && m.LibraryItemId is not null);
            Assert.Contains(o.Missing, m => m is { Slot: OutfitSlot.Shoes, LibraryItemId: "lib-sneakers" });
            Assert.All(o.Missing, m => Assert.Equal(MissingPieceReason.Suggested, m.Reason));
        });
        Assert.NotEqual(GapFill.Signature(outfits[0]), GapFill.Signature(outfits[1]));
        Assert.Equal(GapFill.Outfits(own, Context(library), 2, new RuleOutfitOptions()).Select(GapFill.Signature), outfits.Select(GapFill.Signature));
    }

    [Fact]
    public void Outfits_NothingToPick_Empty()
    {
        Assert.Empty(GapFill.Outfits([Own("t", ItemCategory.Top)], Context([]), 3, new RuleOutfitOptions()));
    }

    [Fact]
    public void WithShoes_AddsAPickedPair_OnlyWhenTheLookHasNone_AndReplacesABarePlaceholder()
    {
        var picked = GapFill.Candidates([], Context([Lib("lib-boots", ItemCategory.Shoes)]));
        var bare = new SuggestedOutfit(0, null, null, "rule", [new SlotRef(OutfitSlot.Top, "t"), new SlotRef(OutfitSlot.Bottom, "b")],
            [new MissingPiece(OutfitSlot.Shoes, ItemCategory.Shoes, MissingPieceReason.EmptySlot)]);
        var shod = bare with { Slots = [.. bare.Slots, new SlotRef(OutfitSlot.Shoes, "s")], Missing = [] };

        Assert.Equal([new MissingPiece(OutfitSlot.Shoes, ItemCategory.Shoes, MissingPieceReason.Suggested, null, "lib-boots")], GapFill.WithShoes(bare, picked, 0).Missing);
        Assert.Same(shod, GapFill.WithShoes(shod, picked, 0));
    }

    [Fact]
    public void Concrete_KeepsTheReason_AndNamesAPieceOfThatCategory()
    {
        var picked = GapFill.Candidates([], Context([Lib("lib-coat", ItemCategory.Outerwear)], outer: true));

        var piece = GapFill.Concrete(new MissingPiece(OutfitSlot.Outerwear, ItemCategory.Outerwear, MissingPieceReason.Rain), picked);

        Assert.Equal(new MissingPiece(OutfitSlot.Outerwear, ItemCategory.Outerwear, MissingPieceReason.Rain, null, "lib-coat"), piece);
    }
}

/// <summary>Owner decision 4: the try-on path and its consents.</summary>
public class TryOnRulesTests
{
    [Fact]
    public void Path_BodyPhotoPreferred_FaceOnlyWithoutIt()
    {
        Assert.Equal(TryOnSource.Body, TryOnRules.PathFor(true, true));
        Assert.Equal(TryOnSource.Face, TryOnRules.PathFor(false, true));
        Assert.Null(TryOnRules.PathFor(false, false));
    }

    [Fact]
    public void Consents_PerPath()
    {
        Assert.Equal([ConsentType.FacePhotoTryOn, ConsentType.CrossBorderTransfer], TryOnRules.ConsentsFor(TryOnSource.Face));
        Assert.Equal([ConsentType.BodyPhotoAi, ConsentType.CrossBorderTransfer], TryOnRules.ConsentsFor(TryOnSource.Body));
        Assert.Equal([ConsentType.BodyPhotoAi, ConsentType.CrossBorderTransfer], TryOnRules.ConsentsFor(null));
    }

    [Fact]
    public void FaceSubjectKey_ChangesWithTheFigure_NoHash_UnsureByDefault()
    {
        var key = TryOnRules.FaceSubjectKey("01JFACE", BodyType.InvertedTriangle, 168, ClothingSize.XL);

        Assert.Equal("face-01jface-invertedtriangle-168-xl", key);
        Assert.DoesNotContain('#', key);
        Assert.NotEqual(key, TryOnRules.FaceSubjectKey("01JFACE", BodyType.Pear, 168, ClothingSize.XL));
        Assert.Equal(TryOnRules.FaceSubjectKey("01JFACE", BodyType.Unsure, null, null), TryOnRules.FaceSubjectKey("01JFACE", null, null, null));
    }

    [Fact]
    public void BodyPhotoIssues_InTheOrderTheUserCanFixThem()
    {
        Assert.Equal(PhotoIssue.MultiplePeople, TryOnRules.IssueOf(PhotoKind.Body, new PhotoInspection(2, false, true, true, true, false)));
        Assert.Equal(PhotoIssue.NotFullBody, TryOnRules.IssueOf(PhotoKind.Body, new PhotoInspection(0, false, false, false, false, false)));
        Assert.Equal(PhotoIssue.TooDark, TryOnRules.IssueOf(PhotoKind.Body, new PhotoInspection(1, true, true, true, true, false)));
        Assert.Equal(PhotoIssue.Blurry, TryOnRules.IssueOf(PhotoKind.Body, new PhotoInspection(1, true, true, false, true, false)));
        Assert.Null(TryOnRules.IssueOf(PhotoKind.Body, new PhotoInspection(1, true, false, false, false, false)));
    }
}
