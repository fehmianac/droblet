using Domain.Enum;
using Ops.Commands.BrandImport;
using Ops.Commands.BrandImport.Sources;
using static OpsTests.BrandImport.SourceTestKit;

namespace OpsTests.BrandImport;

/// <summary>The Gap source without the network: saved gap.com.tr pages and sitemaps (Fixtures/Gap), a fake site, the real catalog service in memory.</summary>
public class GapSourceTests
{
    private static readonly GapSource Gap = new();

    private const string ShirtUrl = "https://gap.com.tr/oxford-boyfriend-gomlek-269247-acik-mavi/";
    private const string PoloUrl = "https://gap.com.tr/pique-polo-yaka-t-shirt-550531-lacivert-1/";
    private const string DressUrl = "https://gap.com.tr/keten-karisimi-shirred-maxi-elbise-877570-siyah/";
    private const string GirlsBlouseUrl = "https://gap.com.tr/smocked-kare-yaka-bluz-847106-acik-mavi-1/";
    private const string ProductSitemapUrl = "https://s3.eu-central-1.amazonaws.com/8f7eaa/sitemaps/sitemaps/sitemap-products-1.xml.gz";

    private static SourceProduct Page(string fixture, string url)
    {
        var product = Gap.ParseProduct(Fixture("Gap", fixture), GapSource.ParseUrl(url)!, out var error);
        Assert.Null(error);
        return product!;
    }

    // ── discovery ───────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void SitemapIndex_Real_NamesTheProductSitemapOfTheStoresBucketOnly()
    {
        Assert.Equal([ProductSitemapUrl], GapSource.ProductSitemaps(Fixture("Gap", "sitemap-index.xml")));
        Assert.Empty(GapSource.ProductSitemaps(SitemapIndex(
            "https://s3.eu-central-1.amazonaws.com/another-bucket/sitemaps/sitemap-products-1.xml.gz",
            "https://evil.example/8f7eaa/sitemaps/sitemap-products-1.xml.gz",
            "https://s3.eu-central-1.amazonaws.com/8f7eaa/sitemaps/sitemaps/sitemap-categories-1.xml.gz")));
    }

    [Fact]
    public void Sitemap_RealExcerpt_GivesCodeModelAndTheCategoryWordOfTheName()
    {
        var entries = GapSource.ParseSitemap(Fixture("Gap", "product-sitemap-excerpt.xml"));

        Assert.Equal(16, entries.Count);
        var shirt = entries.Single(e => e.Url == ShirtUrl);
        Assert.Equal(("269247-acik-mavi", "269247", "gomlek", "oxford-boyfriend-gomlek"), (shirt.Code, shirt.ModelCode, shirt.CategoryHint, shirt.NameHint));
        string Hint(string code) => entries.Single(e => e.Code == code).CategoryHint;
        Assert.Equal("tshirt", Hint("550531-lacivert-1"));                 // "…-polo-yaka-t-shirt"
        Assert.Equal("elbise", Hint("887425-lacivert"));                   // "…-t-shirt-elbise": the last word names the garment
        Assert.Equal("etek", Hint("878132-kirmizi-1"));                    // "…-sort-etek"
        Assert.Equal("pantolon", Hint("881231-mavi"));                     // "…-jean-pantolon" (the name makes it jeans later)
        Assert.Equal("ceket", Hint("890461-bej"));                         // "vintagesoft-1969-logo-spor-ceket": 1969 is not the style
        Assert.Equal("sort", Hint("866125-acik-mavi-13"));
        Assert.Equal("cantasi", Hint("12827"));                            // a five-digit style without a colour
        Assert.Equal("ayakkabi", Hint("1018-beyaz-5"));
        Assert.Equal("", Hint("884624-cok-renkli"));                       // boxers: never a candidate
        Assert.Equal("", Hint("886549-sari"));                             // "kids-…"
        // the colours of one style share the model: one of them is fetched
        Assert.Equal(2, entries.Count(e => e.ModelCode == "550531"));
    }

    [Theory]
    [InlineData("https://gap.com.tr/")]
    [InlineData("https://gap.com.tr/kadin-elbise/")]                                          // a category page: no style number
    [InlineData("https://gap.com.tr/oxford-boyfriend-gomlek-269247-acik-mavi")]               // no trailing slash: not the sitemap's form
    [InlineData("https://gap.com.tr/oxford-boyfriend-gomlek-269247-acik-mavi/?sorter=price")]
    [InlineData("https://evil.example/oxford-boyfriend-gomlek-269247-acik-mavi/")]
    [InlineData("https://gap.com.tr/product/364798/")]
    [InlineData(null)]
    public void Url_AnythingElse_IsNotAProduct(string? url) => Assert.Null(GapSource.ParseUrl(url));

    [Fact]
    public void Pick_Women_TakesWomensWordsOnly_OneColourPerStyle()
    {
        var entries = GapSource.ParseSitemap(Fixture("Gap", "product-sitemap-excerpt.xml"));

        var women = CandidatePicker.Pick(Gap, CatalogSegment.Women, entries, 100);
        var men = CandidatePicker.Pick(Gap, CatalogSegment.Men, entries, 100);

        Assert.Contains(women, c => c.CategoryHint == "elbise");
        Assert.DoesNotContain(men, c => c.CategoryHint is "elbise" or "etek" or "bluz");
        Assert.DoesNotContain(women.Concat(men), c => c.CategoryHint.Length == 0);
        Assert.Single(men, c => c.ModelCode == "550531");
    }

    // ── product pages ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Page_WomenInStock_SizesWithStock_NoDiscount()
    {
        var page = Page("women-in-stock.html", ShirtUrl);

        Assert.Equal(("269247-acik-mavi", "Oxford Boyfriend Gömlek", SourceGender.Women, "GAP"), (page.Code, page.Name, page.Gender, page.BrandName));
        Assert.Equal((2999.95m, "TRY", true), (page.Price, page.Currency, page.InStock));
        Assert.Null(page.ListPrice);
        Assert.Equal(["XS", "S", "M", "L", "XL"], page.Sizes.Where(s => s.InStock).Select(s => s.Label));
        Assert.Contains(page.Sizes, s => s is { Label: "XXL", InStock: false });
        Assert.Equal("Açık Mavi", page.ColorNames[0]);
        Assert.StartsWith("Özel olarak Factory Stores için tasarlanmış", page.Description);
        Assert.NotEmpty(page.ImageUrls);
        Assert.Equal(ShirtUrl, page.Url);

        var (mapped, skip) = SourceCatalogMapper.Map(Gap, CatalogSegment.Women, page);

        Assert.Null(skip);
        var input = mapped!.Input;
        Assert.Equal(("gap-269247-acik-mavi", "gap", ProductCategory.Shirt, 299995L, PriceBand.HighStreet), (input.Id, input.BrandId, input.Category, input.PriceMinor, input.PriceBand));
        Assert.Equal("Oxford Boyfriend Gömlek", input.Name!["tr"]);
        Assert.Equal(["sky-blue"], input.Colors);
        Assert.Equal(["XS", "S", "M", "L", "XL"], input.Sizes);            // the out-of-stock XXL and the junk variant are left out
        Assert.Null(mapped.StrikePriceMinor);
        Assert.All(input.Images!, i => Assert.Matches(@"^https://8f7eaa-gap\.akinoncloudcdn\.com/products/.+_size780x1186_cropCenter\.jpg$", i));
        Assert.Equal(ImportSkip.OtherSegment, SourceCatalogMapper.Map(Gap, CatalogSegment.Men, page).Skip);
    }

    [Fact]
    public void Page_MenDiscounted_TheSizesDecideTheStock_NotTheJsonLdAvailability()
    {
        var html = Fixture("Gap", "men-in-stock-discounted.html");
        Assert.Contains("schema.org/OutofStock", html);                    // what the page says about the colour itself

        var page = Page("men-in-stock-discounted.html", PoloUrl);

        Assert.Equal(("Pique Polo Yaka T-Shirt", SourceGender.Men, true), (page.Name, page.Gender, page.InStock));
        Assert.Equal((1099.99m, 1999.95m), (page.Price, page.ListPrice));
        Assert.Equal(["XS", "S", "M", "L", "XXL"], page.Sizes.Where(s => s.InStock).Select(s => s.Label));
        Assert.Equal("%98 Pamuk, %2 Elastan.", page.Material);
        Assert.StartsWith("<p>Erkekler için tasarlanmış bu polo", page.Description);

        var (mapped, _) = SourceCatalogMapper.Map(Gap, CatalogSegment.Men, page);

        Assert.Equal((ProductCategory.Tshirt, 109999L, 199995L), (mapped!.Input.Category, mapped.Input.PriceMinor, mapped.StrikePriceMinor));
        Assert.Equal(["navy"], mapped.Input.Colors);
        Assert.StartsWith("Erkekler için tasarlanmış bu polo", mapped.Input.Description!["tr"]);
        Assert.EndsWith("%98 Pamuk, %2 Elastan.", mapped.Input.Description!["tr"]);
    }

    [Fact]
    public void Page_OutOfStock_AndChildren_AreSkipped()
    {
        var dress = Page("women-out-of-stock.html", DressUrl);

        Assert.Equal((SourceGender.Women, false, 3799.99m, 5999.95m), (dress.Gender, dress.InStock, dress.Price, dress.ListPrice));
        Assert.Empty(dress.Sizes);
        Assert.Equal(ImportSkip.OutOfStock, SourceCatalogMapper.Map(Gap, CatalogSegment.Women, dress).Skip);

        var girls = Page("kids-out-of-stock.html", GirlsBlouseUrl);

        Assert.Equal(SourceGender.Kids, girls.Gender);                     // "Cinsiyet": "kiz_cocuk"
        Assert.Equal(ImportSkip.OtherSegment, SourceCatalogMapper.Map(Gap, CatalogSegment.Women, girls).Skip);
    }

    [Theory]
    [InlineData("kadin", "Women")]
    [InlineData("Kadın", "Women")]
    [InlineData("erkek", "Men")]
    [InlineData("kiz_cocuk", "Kids")]
    [InlineData("erkek_cocuk", "Kids")]
    [InlineData("Erkek Bebek", "Kids")]
    [InlineData("unisex", "Unisex")]
    [InlineData("", "Unknown")]
    [InlineData(null, "Unknown")]
    public void Gender_ChildrenFirst_UnknownWhenNotStated(string? text, string expected) => Assert.Equal(expected, GapSource.GenderOf(text).ToString());

    [Fact]
    public void Page_OfAnotherProduct_OrWithoutJsonLd_IsAParseError()
    {
        Assert.Null(Gap.ParseProduct(Fixture("Gap", "women-in-stock.html"), GapSource.ParseUrl(PoloUrl)!, out var other));
        Assert.StartsWith("another product", other);
        Assert.Null(Gap.ParseProduct("<html><body>Bakımdayız</body></html>", GapSource.ParseUrl(PoloUrl)!, out var none));
        Assert.Equal("no JSON-LD", none);
    }

    [Theory]
    [InlineData("https://8f7eaa-gap.akinoncloudcdn.com/products/2025/06/16/243859/a.jpg", "https://8f7eaa-gap.akinoncloudcdn.com/products/2025/06/16/243859/a_size780x1186_cropCenter.jpg")]
    [InlineData("https://8f7eaa-gap.akinoncloudcdn.com/products/2025/06/16/243859/a_size448x640_cropCenter.jpg", "https://8f7eaa-gap.akinoncloudcdn.com/products/2025/06/16/243859/a_size780x1186_cropCenter.jpg")]
    [InlineData("https://evil.example/products/a.jpg", null)]
    [InlineData("http://8f7eaa-gap.akinoncloudcdn.com/products/a.jpg", null)]
    [InlineData("https://8f7eaa-gap.akinoncloudcdn.com/products/a.svg", null)]
    [InlineData(null, null)]
    public void Image_IsHotLinkedAtThePagesOwnSize(string? raw, string? expected) => Assert.Equal(expected, Gap.ImageUrl(raw));

    [Theory]
    [InlineData("https://gap.com.tr/oxford-boyfriend-gomlek-269247-acik-mavi/", true)]
    [InlineData("https://gap.com.tr/sitemap.xml", true)]
    [InlineData(ProductSitemapUrl, true)]
    [InlineData("https://gap.com.tr/baskets/basket/", false)]
    [InlineData("https://gap.com.tr/users/auth/", false)]
    [InlineData("https://gap.com.tr/list/", false)]
    [InlineData("https://gap.com.tr/product/364798/", false)]
    [InlineData("https://gap.com.tr/kadin/?sorter=price", false)]
    [InlineData("https://www.gap.com/browse/product.do", false)]
    public void Access_FollowsRobotsTxt(string url, bool allowed) => Assert.Equal(allowed, Gap.Access.Allows(url));

    // ── the command ─────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Run_Women_ReadsTheIndexThenTheSitemap_ImportsTheShirt_SkipsTheRest()
    {
        var harness = new Harness(Gap);
        harness.Site.Add(GapSource.SitemapIndexUrl, Fixture("Gap", "sitemap-index.xml"));
        harness.Site.Add(ProductSitemapUrl, Sitemap(ShirtUrl, DressUrl, GirlsBlouseUrl, PoloUrl, "https://gap.com.tr/gap-logo-boxer-seti-3-lu-701135-siyah/"));
        harness.Site.Add(ShirtUrl, Fixture("Gap", "women-in-stock.html"));
        harness.Site.Add(DressUrl, Fixture("Gap", "women-out-of-stock.html"));
        harness.Site.Add(GirlsBlouseUrl, Fixture("Gap", "kids-out-of-stock.html"));
        harness.Site.Add(PoloUrl, Fixture("Gap", "men-in-stock-discounted.html"));

        var (exit, women) = await harness.RunAsync(CatalogSegment.Women);

        Assert.Equal(0, exit);
        Assert.Equal([GapSource.SitemapIndexUrl, ProductSitemapUrl], harness.Site.Requests.Take(2));
        Assert.Equal((4, 1), (women.PagesFetched, women.Imported));        // the boxers are never fetched; the polo's word is unisex, its page says men
        Assert.Equal(2, women.Skipped[ImportSkip.OtherSegment]);
        Assert.Equal(1, women.Skipped[ImportSkip.OutOfStock]);
        var shirt = await harness.Catalog.GetProductAsync("gap-269247-acik-mavi", CancellationToken.None);
        Assert.Equal((ProductCategory.Shirt, CatalogSegment.Women, ShirtUrl), (shirt!.Category, shirt.Segment, shirt.AffiliateUrl));

        var (_, men) = await harness.RunAsync(CatalogSegment.Men);

        Assert.Equal(1, men.Imported);
        var polo = await harness.Catalog.GetProductAsync("gap-550531-lacivert-1", CancellationToken.None);
        Assert.Equal((109999L, 199995L, CatalogSegment.Men), (polo!.PriceMinor, polo.PreviousPriceMinor, polo.Segment));
        Assert.Equal("Gap", (await harness.Catalog.GetBrandAsync("gap", CancellationToken.None))!.Name);
    }

    [Fact]
    public async Task Run_WithoutAProductSitemap_FailsBeforeAnyProductPage()
    {
        var harness = new Harness(Gap);
        harness.Site.Add(GapSource.SitemapIndexUrl, SitemapIndex("https://s3.eu-central-1.amazonaws.com/8f7eaa/sitemaps/sitemaps/sitemap-categories-1.xml.gz"));

        var (exit, result) = await harness.RunAsync(CatalogSegment.Women);

        Assert.Equal(1, exit);
        Assert.Equal(0, result.PagesFetched);
        Assert.Single(harness.Site.Requests);
    }
}
