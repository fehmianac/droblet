using Domain.Enum;
using Ops.Commands.BrandImport;
using Ops.Commands.BrandImport.Sources;
using static OpsTests.BrandImport.SourceTestKit;

namespace OpsTests.BrandImport;

/// <summary>The Beymen source without the network: saved beymen.com pages and sitemaps (Fixtures/Beymen), a fake site, the real catalog service in memory.</summary>
public class BeymenSourceTests
{
    private static readonly BeymenSource Beymen = new();

    private const string SkirtUrl = "https://www.beymen.com/tr/p_beymen-club-kahverengi-anvelop-kapama-midi-etek_2079873";
    private const string KnitUrl = "https://www.beymen.com/tr/p_beymen-collection-siyah-kasmir-kazak_1521409";
    private const string AcademiaUrl = "https://www.beymen.com/tr/p_academia-lacivert-basic-kazak_1785973";

    private static SourceProduct Page(string fixture, string url) => Parse(Fixture("Beymen", fixture), url);

    private static SourceProduct Parse(string html, string url)
    {
        var product = Beymen.ParseProduct(html, BeymenSource.ParseUrl(url)!, out var error);
        Assert.Null(error);
        return product!;
    }

    // ── discovery ───────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void SitemapIndex_Real_PicksEightProductSitemapsSpreadOverAllOfThem()
    {
        var files = BeymenSource.PickSitemaps(Fixture("Beymen", "sitemap-index.xml"));

        Assert.Equal(new[] { 1, 5, 8, 12, 15, 19, 22, 26 }.Select(n => $"https://www.beymen.com/tr/product_{n}.xml"), files);
        Assert.Equal(1 + files.Count, Beymen.MaxDiscoveryRequests);
        // fewer files than asked for: all of them; other sitemaps and other hosts: never
        Assert.Equal(["https://www.beymen.com/tr/product_1.xml", "https://www.beymen.com/tr/product_2.xml"], BeymenSource.PickSitemaps(SitemapIndex(
            "https://www.beymen.com/tr/brand_1.xml", "https://www.beymen.com/tr/product_1.xml", "https://www.beymen.com/tr/product_2.xml",
            "https://evil.example/tr/product_3.xml", "https://www.beymen.com/en/product_1.xml")));
    }

    [Fact]
    public void Sitemap_RealExcerpt_KeepsTheOwnLabelsOnly()
    {
        var xml = Fixture("Beymen", "product-sitemap-excerpt.xml");
        foreach (var other in new[] { "p_beymen-reborn-", "p_network-", "p_divarese-", "p_beymen-home-", "p_beymen-hediye-", "p_polo-", "p_lacoste-" })
            Assert.Contains(other, xml);

        var entries = BeymenSource.ParseSitemap(xml);

        Assert.Equal(8, entries.Count);
        Assert.All(entries, e => Assert.Contains(BeymenSource.OwnSlugPrefixes, p => e.NameHint!.StartsWith(p, StringComparison.Ordinal)));
        var skirt = entries.Single(e => e.Url == SkirtUrl);
        Assert.Equal(("2079873", "etek"), (skirt.Code, skirt.CategoryHint));
        string Hint(string slugPart) => entries.Single(e => e.NameHint!.Contains(slugPart, StringComparison.Ordinal)).CategoryHint;
        Assert.Equal("kazak", Hint("siyah-kasmir-kazak"));
        Assert.Equal("pantolon", Hint("ekru-jean-pantolon"));
        Assert.Equal("elbise", Hint("etek-ucu-balon-mini-abiye-elbise"));   // "etek ucu" is the hem: the last word names the garment
        Assert.Equal("cantasi", Hint("alisveris-cantasi"));
        Assert.Equal("", Hint("kadin-corap"));                             // socks: never a candidate
    }

    [Theory]
    [InlineData("https://www.beymen.com/tr/p_beymen-reborn-gucci-kadin-sneakers-37tr_2133463")]   // resale of designer pieces
    [InlineData("https://www.beymen.com/tr/p_network-lacivert-triko-yelek_1798369")]              // a sister brand, not a Beymen label
    [InlineData("https://www.beymen.com/tr/p_polo-ralph-lauren-gomlek_1")]
    [InlineData("https://www.beymen.com/tr/p_beymen-home-pudra-logo-nakisli-yuz-havlusu_1833526")]
    [InlineData("https://www.beymen.com/en/p_beymen-club-brown-skirt_2079873")]
    [InlineData("https://www.beymen.com/tr/product/2079873")]
    [InlineData("https://www.beymen.com/tr/p_beymen-club-etek_2079873?siralama=1")]
    [InlineData("https://evil.example/tr/p_beymen-club-etek_2079873")]
    [InlineData(null)]
    public void Url_OfAnotherLabelOrShape_IsNotACandidate(string? url) => Assert.Null(BeymenSource.ParseUrl(url));

    [Theory]
    [InlineData(SkirtUrl, true)]
    [InlineData(BeymenSource.SitemapIndexUrl, true)]
    [InlineData("https://www.beymen.com/tr/product_13.xml", true)]         // the product sitemap, not the disallowed /tr/product/
    [InlineData("https://www.beymen.com/tr/product/2079873", false)]
    [InlineData("https://www.beymen.com/api/product/getonecard", false)]
    [InlineData("https://www.beymen.com/tr/api/product/sizes", false)]
    [InlineData("https://www.beymen.com/tr/cart", false)]
    [InlineData("https://www.beymen.com/tr/content/seo-footer", false)]
    [InlineData("https://www.beymen.com/tr/kadin-etek-2025-yil-sezon-10038", false)]
    [InlineData("https://www.beymen.com/tr/kadin-10006?siralama=akilli-siralama", false)]
    public void Access_FollowsRobotsTxt(string url, bool allowed) => Assert.Equal(allowed, Beymen.Access.Allows(url));

    // ── product pages ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Page_WomenSkirt_InStock_ImportedWithoutASizeList()
    {
        var page = Page("women-skirt-in-stock.html", SkirtUrl);

        Assert.Equal(("2079873", "Kahverengi Anvelop Kapama Midi Etek", SourceGender.Women, "Beymen Club"), (page.Code, page.Name, page.Gender, page.BrandName));
        Assert.Equal((12950m, 12950m, "TRY", true, "etek"), (page.Price, page.ListPrice, page.Currency, page.InStock, page.CategoryHint));
        Assert.Empty(page.Sizes);                                          // per-size stock is behind /api, which robots.txt disallows
        Assert.Equal("Kahverengi", page.ColorNames[0]);
        Assert.Equal("%63 Poliester,%34 Viskoz,%3 Elastan", page.Material);
        Assert.StartsWith("Yüksek bel, anvelop kapama", page.Description);
        Assert.Equal(6, page.ImageUrls.Count);

        var (mapped, skip) = SourceCatalogMapper.Map(Beymen, CatalogSegment.Women, page);

        Assert.Null(skip);
        var input = mapped!.Input;
        Assert.Equal(("beymen-2079873", "beymen", ProductCategory.Skirt, 1295000L, PriceBand.LuxuryTouch), (input.Id, input.BrandId, input.Category, input.PriceMinor, input.PriceBand));
        Assert.Equal(["brown"], input.Colors);
        Assert.Empty(input.Sizes!);
        Assert.Null(mapped.StrikePriceMinor);                              // the "first price" equals the price: no discount
        Assert.Equal("https://cdn.beymen.com/mnresize/800/1115/productimages/eakaataj.2va_IMG_01_8684786456897.jpg", input.Images![0]);
        Assert.Equal(SkirtUrl, input.AffiliateUrl);
        Assert.Equal(ImportSkip.OtherSegment, SourceCatalogMapper.Map(Beymen, CatalogSegment.Men, page).Skip);
    }

    [Fact]
    public void Page_MenDiscounted_BeymenCollectionAndAcademia()
    {
        var knit = Page("men-knit-discounted.html", KnitUrl);

        Assert.Equal(("Siyah Kaşmir Kazak", SourceGender.Men, "Beymen Collection", "kazak"), (knit.Name, knit.Gender, knit.BrandName, knit.CategoryHint));   // "Triko & Kazak"
        Assert.Equal((9395m, 16950m, true), (knit.Price, knit.ListPrice, knit.InStock));
        var (mapped, _) = SourceCatalogMapper.Map(Beymen, CatalogSegment.Men, knit);
        Assert.Equal((ProductCategory.Knitwear, 939500L, 1695000L), (mapped!.Input.Category, mapped.Input.PriceMinor, mapped.StrikePriceMinor));
        Assert.Equal(["black"], mapped.Input.Colors);

        var academia = Page("men-academia-discounted.html", AcademiaUrl);

        Assert.Equal(("Academia", SourceGender.Men, 4149m, 11950m), (academia.BrandName, academia.Gender, academia.Price, academia.ListPrice));
        Assert.Equal(["navy"], SourceCatalogMapper.Map(Beymen, CatalogSegment.Men, academia).Product!.Input.Colors);
    }

    [Fact]
    public void Page_OtherLabel_Resale_SoldOut_ChildrenAndUnstatedGender_AreSkipped()
    {
        var skirt = Fixture("Beymen", "women-skirt-in-stock.html");
        ImportSkip? Skip(string html) => SourceCatalogMapper.Map(Beymen, CatalogSegment.Women, Parse(html, SkirtUrl)).Skip;

        // a designer or a sister brand on the same site
        Assert.Equal(ImportSkip.OtherBrand, Skip(skirt.Replace("\"brandName\":\"Beymen Club\"", "\"brandName\":\"Network\"", StringComparison.Ordinal)));
        Assert.Equal(ImportSkip.OtherBrand, Skip(skirt.Replace("\"brandName\":\"Beymen Club\"", "\"brandName\":\"Polo Ralph Lauren\"", StringComparison.Ordinal)));
        // a second-hand piece is not a Beymen product whatever label it is filed under
        Assert.Equal(ImportSkip.OtherBrand, Skip(skirt.Replace("\"isPreOwned\":false", "\"isPreOwned\":true", StringComparison.Ordinal)));
        // sold out
        Assert.Equal(ImportSkip.OutOfStock, Skip(skirt.Replace("\"isStockOutProduct\":false", "\"isStockOutProduct\":true", StringComparison.Ordinal)));
        Assert.Equal(ImportSkip.OutOfStock, Skip(skirt.Replace("\"productStatus\":\"in_stock\"", "\"productStatus\":\"out_of_stock\"", StringComparison.Ordinal)));
        // children's wear, and a page that does not say who the product is for
        Assert.Equal(ImportSkip.OtherSegment, Skip(skirt.Replace("\"gender\":\"Kadın\"", "\"gender\":\"Kız Çocuk\"", StringComparison.Ordinal)));
        Assert.Equal(ImportSkip.OtherSegment, Skip(skirt.Replace("\"gender\":\"Kadın\"", "\"gender\":\"\"", StringComparison.Ordinal).Replace("\"breadCrumbFirstCategory\":\"Kadın \"", "\"breadCrumbFirstCategory\":\"Outlet\"", StringComparison.Ordinal)));
        // the page's category wins over the URL's word; a category the catalog has no place for is skipped
        Assert.Equal(ImportSkip.UnknownCategory, Skip(skirt.Replace("\"category\":\"Etek\"", "\"category\":\"Çorap\"", StringComparison.Ordinal)));
    }

    [Theory]
    [InlineData("Beymen Club", true)]
    [InlineData("BEYMEN COLLECTION", true)]
    [InlineData("Academia", true)]
    [InlineData("Beymen Reborn", false)]
    [InlineData("Beymen Home", false)]
    [InlineData("Network", false)]
    [InlineData("Gucci", false)]
    [InlineData("", false)]
    [InlineData(null, false)]                                              // a department store: no label, not ours
    public void OwnBrand_IsOneOfTheThreeLabels(string? brand, bool own) => Assert.Equal(own, Beymen.IsOwnBrand(brand));

    [Fact]
    public void Page_OfAnotherProduct_OrWithoutTheState_IsAParseError()
    {
        Assert.Null(Beymen.ParseProduct(Fixture("Beymen", "women-skirt-in-stock.html"), BeymenSource.ParseUrl(KnitUrl)!, out var other));
        Assert.Equal("another product (2079873)", other);
        Assert.Null(Beymen.ParseProduct("<html><body><script>var x = 1;</script></body></html>", BeymenSource.ParseUrl(KnitUrl)!, out var none));
        Assert.Equal("no product state", none);
    }

    [Theory]
    [InlineData("https://cdn.beymen.com/productimages/eakaataj.2va_IMG_01_8684786456897.jpg", "https://cdn.beymen.com/mnresize/800/1115/productimages/eakaataj.2va_IMG_01_8684786456897.jpg")]
    [InlineData("https://cdn.beymen.com/mnresize/505/704/productimages/a_IMG_01_1.jpg", "https://cdn.beymen.com/mnresize/800/1115/productimages/a_IMG_01_1.jpg")]
    [InlineData("https://cdn.beymen.com/assets/desktop/img/logo.svg", null)]
    [InlineData("https://evil.example/productimages/a.jpg", null)]
    [InlineData(null, null)]
    public void Image_IsHotLinkedAtTheImportsSize(string? raw, string? expected) => Assert.Equal(expected, Beymen.ImageUrl(raw));

    // ── the command ─────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Run_ReadsTheIndexAndEightSitemaps_ImportsOwnLabelsOfTheSegmentOnly()
    {
        var harness = new Harness(Beymen);
        harness.Site.Add(BeymenSource.SitemapIndexUrl, Fixture("Beymen", "sitemap-index.xml"));
        foreach (var file in BeymenSource.PickSitemaps(Fixture("Beymen", "sitemap-index.xml")))
            harness.Site.Add(file, Sitemap());
        harness.Site.Add("https://www.beymen.com/tr/product_12.xml", Sitemap(SkirtUrl, KnitUrl, "https://www.beymen.com/tr/p_polo-ralph-lauren-lacivert-gomlek_1700001"));
        harness.Site.Add("https://www.beymen.com/tr/product_26.xml", Sitemap(AcademiaUrl, SkirtUrl, "https://www.beymen.com/tr/p_beymen-reborn-gucci-kadin-sneakers-37tr_2133463"));
        harness.Site.Add(SkirtUrl, Fixture("Beymen", "women-skirt-in-stock.html"));
        harness.Site.Add(KnitUrl, Fixture("Beymen", "men-knit-discounted.html"));
        harness.Site.Add(AcademiaUrl, Fixture("Beymen", "men-academia-discounted.html"));

        var (exit, women) = await harness.RunAsync(CatalogSegment.Women);

        Assert.Equal(0, exit);
        Assert.Equal(9, harness.Site.Requests.Count(r => r.EndsWith(".xml", StringComparison.Ordinal)));
        Assert.DoesNotContain(harness.Site.Requests, r => r.Contains("polo-ralph-lauren", StringComparison.Ordinal) || r.Contains("reborn", StringComparison.Ordinal));
        Assert.Equal((3, 3, 1), (women.Candidates, women.PagesFetched, women.Imported));   // "kazak" is a women's word too: the two men's knits are fetched and skipped
        Assert.Equal(2, women.Skipped[ImportSkip.OtherSegment]);
        var skirt = await harness.Catalog.GetProductAsync("beymen-2079873", CancellationToken.None);
        Assert.Equal((ProductCategory.Skirt, 1295000L, CatalogSegment.Women), (skirt!.Category, skirt.PriceMinor, skirt.Segment));
        Assert.Empty(skirt.Sizes);
        Assert.Equal("Beymen", (await harness.Catalog.GetBrandAsync("beymen", CancellationToken.None))!.Name);

        var (_, men) = await harness.RunAsync(CatalogSegment.Men);

        Assert.Equal((2, 2), (men.PagesFetched, men.Imported));            // the skirt's word is not a men's word: never fetched
        var knit = await harness.Catalog.GetProductAsync("beymen-1521409", CancellationToken.None);
        Assert.Equal((939500L, 1695000L, CatalogSegment.Men), (knit!.PriceMinor, knit.PreviousPriceMinor, knit.Segment));
    }

    [Fact]
    public async Task Run_StopsAtOnce_WhenASitemapIsRefused()
    {
        var harness = new Harness(Beymen);
        harness.Site.Add(BeymenSource.SitemapIndexUrl, Fixture("Beymen", "sitemap-index.xml"));
        harness.Site.Pages["https://www.beymen.com/tr/product_1.xml"] = new SourceResponse(403, null, "HTTP 403");

        var (exit, result) = await harness.RunAsync(CatalogSegment.Women);

        Assert.Equal(1, exit);
        Assert.Equal(0, result.PagesFetched);
        Assert.Equal(2, harness.Site.Requests.Count);                      // the index and the refused file: nothing after it
    }
}
