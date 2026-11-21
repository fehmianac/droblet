using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;

namespace DomainTests.Services;

/// <summary>Opening the app to men: per segment taxonomy, gap filling, menswear rules, catalog filtering, library seed.</summary>
public class SegmentTaxonomyTests
{
    [Fact]
    public void BodyTypes_Women_AreThePhase1List_Men_HaveTheirOwn()
    {
        Assert.Equal([BodyType.Hourglass, BodyType.Pear, BodyType.Apple, BodyType.Rectangle, BodyType.InvertedTriangle, BodyType.Unsure],
            SegmentTaxonomy.BodyTypes(Segment.Women));
        Assert.Equal([BodyType.Rectangle, BodyType.InvertedTriangle, BodyType.Triangle, BodyType.Oval, BodyType.Trapezoid, BodyType.Unsure],
            SegmentTaxonomy.BodyTypes(Segment.Men));
        Assert.False(SegmentTaxonomy.AllowsBodyType(Segment.Men, BodyType.Hourglass));
        Assert.False(SegmentTaxonomy.AllowsBodyType(Segment.Women, BodyType.Trapezoid));
        Assert.Equal("Inverted triangle (V shape)", SegmentTaxonomy.BodyTypeLabel(Segment.Men, BodyType.InvertedTriangle).En);
        Assert.Equal("Ters üçgen", SegmentTaxonomy.BodyTypeLabel(Segment.Women, BodyType.InvertedTriangle).Tr);
        Assert.Equal("Not sure", SegmentTaxonomy.BodyTypeLabel(Segment.Men, BodyType.Unsure).En);
    }

    [Fact]
    public void StyleTags_Women_AreThePhase1List_Men_DropTheWomensTags()
    {
        Assert.Equal(Enum.GetValues<StyleTag>().Except([StyleTag.SmartCasual, StyleTag.Tailored]), SegmentTaxonomy.StyleTags(Segment.Women));
        Assert.Contains(StyleTag.SmartCasual, SegmentTaxonomy.StyleTags(Segment.Men));
        Assert.Contains(StyleTag.Tailored, SegmentTaxonomy.StyleTags(Segment.Men));
        foreach (var womens in new[] { StyleTag.Romantic, StyleTag.Boho, StyleTag.OfficeChic })
            Assert.False(SegmentTaxonomy.AllowsStyleTag(Segment.Men, womens));
        Assert.True(SegmentTaxonomy.StyleTags(Segment.Men).Count >= 3);
    }

    [Fact]
    public void Subcategories_ArePerSegment_UniqueAndValid()
    {
        var ids = SubcategoryCatalog.All.Select(e => e.Id).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.All(ids, id => Assert.True(ItemRules.IsValidSubcategory(id), id));

        var men = SubcategoryCatalog.ForSegment(Segment.Men).Select(e => e.Id).ToList();
        var women = SubcategoryCatalog.ForSegment(Segment.Women).Select(e => e.Id).ToList();
        foreach (var id in new[] { "suit-jacket", "chinos", "polo", "oxford-shirt", "dress-shirt", "derbies", "loafers", "tie", "belt", "watch", "overshirt", "swim-shorts" })
            Assert.Contains(id, men);
        foreach (var id in new[] { "dress", "skirt", "heels", "blouse", "bikini", "handbag" })
            Assert.DoesNotContain(id, men);
        foreach (var id in new[] { "suit-jacket", "derbies", "bow-tie", "swim-shorts" })
            Assert.DoesNotContain(id, women);
        Assert.Contains("chinos", women);   // unisex
        // Every slot group stays fillable for men: top, bottom, outerwear, shoes, bag / accessory.
        foreach (var category in new[] { ItemCategory.Top, ItemCategory.Bottom, ItemCategory.Outerwear, ItemCategory.Shoes, ItemCategory.Bag, ItemCategory.Accessory })
            Assert.Contains(SubcategoryCatalog.ForSegment(Segment.Men), e => e.Category == category);
        Assert.Equal(ItemCategory.Outerwear, SubcategoryCatalog.CategoryOf("suit-jacket"));
        Assert.Equal(ItemCategory.Bottom, SubcategoryCatalog.CategoryOf("suit-trousers"));
        Assert.True(SubcategoryCatalog.IsJewellery("cufflinks"));
        // Detection and item writes accept any id: a man may own a dress.
        Assert.Equal("dress", SubcategoryCatalog.Normalize("dress", ItemCategory.Dress));
    }

    [Fact]
    public void Config_ListsBothSegments_InTheRequestLanguage()
    {
        var config = AppConfigDto.Build(new SegmentOptions { Available = ["women", "men"] }, "en", v => char.ToLowerInvariant(v.ToString()[0]) + v.ToString()[1..]);

        Assert.Equal([Segment.Women, Segment.Men], config.Segments.Available);
        Assert.Equal(["women", "men"], config.BodyTypes.Keys);
        Assert.Contains(config.BodyTypes["men"], c => c is { Id: "trapezoid", Name: "Trapezoid (athletic)" });
        Assert.Contains(config.Subcategories["men"], s => s is { Id: "suit-jacket", Category: ItemCategory.Outerwear, Name: "Suit jacket" });
        Assert.Contains(config.StyleTags["women"], c => c.Id == "officeChic");
    }

    [Fact]
    public void FaceSubjectKey_WomenUnchanged_MenGetTheirOwnKey()
    {
        Assert.Equal("face-f1-rectangle-170-m", TryOnRules.FaceSubjectKey("f1", BodyType.Rectangle, 170, ClothingSize.M));
        Assert.Equal("face-f1-rectangle-170-m", TryOnRules.FaceSubjectKey("f1", BodyType.Rectangle, 170, ClothingSize.M, Segment.Women));
        Assert.Equal("face-f1-rectangle-170-m-men", TryOnRules.FaceSubjectKey("f1", BodyType.Rectangle, 170, ClothingSize.M, Segment.Men));
    }
}

public class MenGapFillTests
{
    private static readonly Season[] AllSeasons = [Season.Spring, Season.Summer, Season.Autumn, Season.Winter];

    private static LibraryItemEntity Lib(string id, ItemCategory category, CatalogSegment segment, int sort = 0) => new()
    {
        Id = id, Name = new() { ["tr"] = id }, Category = category, ColorIds = ["navy"], SortOrder = sort, Seasons = [.. AllSeasons], Segment = segment,
    };

    private static CatalogProductEntity Product(string id, ProductCategory category, CatalogSegment segment) => new()
    {
        Id = id, BrandId = "b", Name = new() { ["tr"] = id }, Category = category, Colors = ["navy"], PriceBand = PriceBand.HighStreet, CreatedAt = DateTime.UnixEpoch, Segment = segment,
    };

    private static GapFillContext Context(IReadOnlyList<LibraryItemEntity> library, IReadOnlyList<CatalogProductEntity> catalog, Segment segment, Occasion? occasion = null) =>
        new(library, catalog, new HashSet<Season> { Season.Autumn }, occasion, null, 26, false, false, new HashSet<string>(), new HashSet<string>(), null, Segment: segment);

    private static readonly LibraryItemEntity[] Library =
    [
        Lib("lib-w-top", ItemCategory.Top, CatalogSegment.Women), Lib("lib-w-dress", ItemCategory.Dress, CatalogSegment.Women),
        Lib("lib-m-top", ItemCategory.Top, CatalogSegment.Men), Lib("lib-m-chinos", ItemCategory.Bottom, CatalogSegment.Men),
        Lib("lib-u-sneakers", ItemCategory.Shoes, CatalogSegment.Unisex), Lib("lib-w-heels", ItemCategory.Shoes, CatalogSegment.Women),
    ];

    [Fact]
    public void Library_PicksOnlyTheUsersSegmentAndUnisex()
    {
        var men = GapFill.Candidates([], Context(Library, [], Segment.Men)).Select(c => c.Id).ToList();
        var women = GapFill.Candidates([], Context(Library, [], Segment.Women)).Select(c => c.Id).ToList();

        Assert.Equal(["lib:lib-m-chinos", "lib:lib-m-top", "lib:lib-u-sneakers"], men.Order());
        Assert.DoesNotContain(women, id => id.StartsWith("lib:lib-m-", StringComparison.Ordinal));
        Assert.Contains("lib:lib-w-dress", women);
        Assert.Contains("lib:lib-u-sneakers", women);
    }

    [Fact]
    public void Catalog_IsFilteredBySegment_UnisexForBoth_AndNoDressIsEverPickedForAMan()
    {
        var catalog = new[]
        {
            Product("w-jeans", ProductCategory.Jeans, CatalogSegment.Women), Product("m-jeans", ProductCategory.Jeans, CatalogSegment.Men),
            Product("u-dress", ProductCategory.Dress, CatalogSegment.Unisex), Product("u-shoes", ProductCategory.Shoes, CatalogSegment.Unisex),
        };

        var men = GapFill.Candidates([], Context([], catalog, Segment.Men)).Select(c => c.Id).ToList();
        var women = GapFill.Candidates([], Context([], catalog, Segment.Women)).Select(c => c.Id).ToList();

        Assert.Contains("prd:m-jeans", men);
        Assert.Contains("prd:u-shoes", men);
        Assert.DoesNotContain("prd:w-jeans", men);
        Assert.DoesNotContain("prd:u-dress", men);
        Assert.Contains("prd:w-jeans", women);
        Assert.DoesNotContain("prd:m-jeans", women);
    }

    [Fact]
    public void Outfits_ForAThinMensWardrobe_AreMenswear()
    {
        var own = new[] { new CandidateItem("t1", ItemCategory.Top, ["white"], null, AllSeasons) };

        var outfits = GapFill.Outfits(own, Context(Library, [], Segment.Men), 2, new RuleOutfitOptions(Segment: Segment.Men));

        Assert.NotEmpty(outfits);
        Assert.All(outfits, o => Assert.All(o.Missing, m => Assert.NotEqual(ItemCategory.Dress, m.Category)));
        Assert.All(outfits, o => Assert.DoesNotContain(o.Missing, m => m.LibraryItemId is "lib-w-dress" or "lib-w-heels" or "lib-w-top"));
    }
}

public class MenswearRuleTests
{
    private static readonly Season[] AllSeasons = [Season.Spring, Season.Summer, Season.Autumn, Season.Winter];
    private static CandidateItem C(string id, ItemCategory category) => new(id, category, ["navy"], null, AllSeasons);

    private static readonly CandidateItem[] Wardrobe =
    [
        C("top", ItemCategory.Top), C("chinos", ItemCategory.Bottom), C("dress", ItemCategory.Dress), C("blazer", ItemCategory.Outerwear), C("derbies", ItemCategory.Shoes),
    ];

    [Fact]
    public void Men_PairsFirst_AnOwnedDressOnlyWithoutAPair()
    {
        var men = RuleBasedOutfit.Build(Wardrobe, 3, new RuleOutfitOptions(Segment: Segment.Men));
        var women = RuleBasedOutfit.Build(Wardrobe, 3, new RuleOutfitOptions());

        Assert.DoesNotContain(men, o => o.Slots.Any(s => s.ItemId == "dress"));
        Assert.Contains(women, o => o.Slots.Any(s => s.ItemId == "dress"));   // women: phase 1 rules unchanged

        var onlyDress = RuleBasedOutfit.Build([C("dress", ItemCategory.Dress), C("derbies", ItemCategory.Shoes)], 1, new RuleOutfitOptions(Segment: Segment.Men));
        Assert.Contains(Assert.Single(onlyDress).Slots, s => s.ItemId == "dress");   // owned and nothing else: still dressed
    }

    [Theory]
    [InlineData(Occasion.Office, true)]
    [InlineData(Occasion.Wedding, true)]
    [InlineData(Occasion.Dinner, true)]
    [InlineData(Occasion.Weekend, false)]
    public void Men_FormalOccasions_GetTheTailoredOuterLayer(Occasion occasion, bool withBlazer)
    {
        var outfit = RuleBasedOutfit.Build(Wardrobe, 1, new RuleOutfitOptions(Segment: Segment.Men, Occasion: occasion)).Single();
        var women = RuleBasedOutfit.Build(Wardrobe, 1, new RuleOutfitOptions(Occasion: occasion)).Single();

        Assert.Equal(withBlazer, outfit.Slots.Any(s => s.ItemId == "blazer"));
        Assert.DoesNotContain(women.Slots, s => s.Slot == OutfitSlot.Outerwear);   // women: only the weather adds it
    }
}

public class SegmentCatalogTests
{
    private static CatalogProductEntity P(string id, CatalogSegment segment) => new()
    {
        Id = id, BrandId = "b", Name = new() { ["tr"] = id }, Category = ProductCategory.Shirt, Colors = ["white"], PriceBand = PriceBand.HighStreet, Segment = segment,
        CreatedAt = DateTime.UnixEpoch,
    };

    [Fact]
    public void Query_FiltersByTheUsersSegment_UnisexForBoth_NullForAll()
    {
        var products = new[] { P("w", CatalogSegment.Women), P("m", CatalogSegment.Men), P("u", CatalogSegment.Unisex) };

        Assert.Equal(["m", "u"], CatalogRules.Query(products, new CatalogQuery(Segment: Segment.Men), null, 10).Items.Select(p => p.Id).Order());
        Assert.Equal(["u", "w"], CatalogRules.Query(products, new CatalogQuery(Segment: Segment.Women), null, 10).Items.Select(p => p.Id).Order());
        Assert.Equal(3, CatalogRules.Query(products, new CatalogQuery(), null, 10).Total);
        Assert.Equal(["m", "u"], CatalogRules.ForSegment(products, Segment.Men).Select(p => p.Id).Order());
    }
}

public class MenLibrarySeedTests
{
    private static string SeedFile()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "seed", "library", "items.json")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        return File.ReadAllText(Path.Combine(directory.FullName, "seed", "library", "items.json"));
    }

    [Fact]
    public void Seed_HasAMensStarterSet_WithoutImages_CoveringEverySlot_AndWomenStayWomen()
    {
        var result = LibrarySeed.Parse(SeedFile());
        Assert.True(result.IsValid, string.Join("; ", result.Errors));

        var men = result.Items.Where(i => i.Segment == CatalogSegment.Men).ToList();
        Assert.InRange(men.Count, 25, 30);
        Assert.All(men, i => Assert.StartsWith("lib-men-", i.Id));
        Assert.All(men, i => Assert.True(LibraryItemImageRules.NeedsImage(i), i.Id));   // placeholder until the owner approves the image calls
        Assert.All(men, i => Assert.True(i.Name.ContainsKey("tr") && i.Name.ContainsKey("en"), i.Id));
        Assert.DoesNotContain(men, i => i.Category == ItemCategory.Dress);
        foreach (var category in new[] { ItemCategory.Top, ItemCategory.Bottom, ItemCategory.Outerwear, ItemCategory.Shoes, ItemCategory.Accessory })
            Assert.Contains(men, i => i.Category == category);
        // Every piece from before the men launch keeps reading as women (no segment field = women).
        Assert.All(result.Items.Where(i => !i.Id.StartsWith("lib-men-", StringComparison.Ordinal)), i => Assert.Equal(CatalogSegment.Women, i.Segment));
    }

    [Fact]
    public void Seed_RejectsAnUnknownSegment()
    {
        const string json = """{ "version": 1, "items": [ { "id": "lib-x", "name": { "tr": "X" }, "category": "top", "colorIds": ["black"], "seasons": ["winter"], "segment": "kids" } ] }""";
        Assert.False(LibrarySeed.Parse(json).IsValid);
    }
}
