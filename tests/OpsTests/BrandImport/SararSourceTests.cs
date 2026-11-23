using Domain.Enum;
using Ops.Commands.BrandImport;
using Ops.Commands.BrandImport.Sources;
using static OpsTests.BrandImport.SourceTestKit;

namespace OpsTests.BrandImport;

/// <summary>The Sarar source without the network: saved sarar.com pages and a sitemap excerpt (Fixtures/Sarar), a fake site, the real catalog service in memory.</summary>
public class SararSourceTests
{
    private static readonly SararSource Sarar = new();

    private const string ShirtUrl = "https://sarar.com/sosa-uzun-kol-beyaz-gomlek-18525";
    private const string DressUrl = "https://sarar.com/sarar-monets-elbise-18053";
    private const string CoatUrl = "https://sarar.com/sanchez-lacivert-palto-19087";

    private static SourceProduct Page(string fixture, string url)
    {
        var product = Sarar.ParseProduct(Fixture("Sarar", fixture), SararSource.ParseUrl(url)!, out var error);
        Assert.Null(error);
        return product!;
    }

    // ── discovery ───────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Sitemap_RealExcerpt_GivesSlugCodesImagesAndCategoryWords_WithoutWhatRobotsTxtDisallows()
    {
        var xml = Fixture("Sarar", "product-sitemap-excerpt.xml");
        Assert.Contains("https://sarar.com/new-soho-havlu", xml);          // "Disallow: *new": in the sitemap, not for us

        var entries = SararSource.ParseSitemap(xml);

        Assert.Equal(12, entries.Count);
        Assert.DoesNotContain(entries, e => e.Url.Contains("new", StringComparison.Ordinal));
        var shirt = entries.Single(e => e.Url == ShirtUrl);
        Assert.Equal(("sosa-uzun-kol-beyaz-gomlek-18525", "gomlek"), (shirt.Code, shirt.CategoryHint));
        Assert.All(shirt.Images, i => Assert.StartsWith("https://witcdn.sarar.com/", i));
        Assert.NotEmpty(shirt.Images);
        string Hint(string slug) => entries.Single(e => e.Code == slug).CategoryHint;
        Assert.Equal("palto", Hint("sanchez-lacivert-palto-19087"));
        Assert.Equal("elbise", Hint("sarar-monets-elbise-18053"));
        Assert.Equal("pantolon", Hint("forli-acik-gri-pantolon"));         // a slug without a number
        Assert.Equal("tisort", Hint("interview-polo-yaka-tisort-15916"));
        Assert.Equal("ayakkabi", Hint("sarar-microlight-erkek-klasik-siyah-ayakkabi-18429"));
        Assert.Equal("esofman", Hint("sarar-esofman-alti-16490"));
        Assert.Equal("", Hint("solo-tone-nevresim-takimi-19180"));         // home textiles
        Assert.Equal("", Hint("mor-renk-klasik-kravat-c90-18640"));        // ties: no category
        Assert.Equal("", Hint("amara-resta-takim-17305"));                 // suits: no category
    }

    [Theory]
    [InlineData("https://sarar.com/new-soho-havlu-50-90-7662")]            // robots.txt: *new
    [InlineData("https://sarar.com/newport-lacivert-gomlek-1")]
    [InlineData("https://sarar.com/stockholm-mont-2")]                     // *stock
    [InlineData("https://sarar.com/brandy-kahverengi-kemer-3")]            // *brand
    [InlineData("https://sarar.com/sepet")]
    [InlineData("https://sarar.com/sepet-canta-4")]                        // "Disallow: /sepet" is a plain prefix
    [InlineData("https://sarar.com/erkek/gomlek-modelleri")]               // a category page
    [InlineData("https://sarar.com/sosa-uzun-kol-beyaz-gomlek-18525?sort=1")]
    [InlineData("https://www.sarar.com/sosa-uzun-kol-beyaz-gomlek-18525")]
    [InlineData("https://evil.example/sosa-uzun-kol-beyaz-gomlek-18525")]
    [InlineData(null)]
    public void Url_DisallowedOrForeign_IsNotACandidate(string? url) => Assert.Null(SararSource.ParseUrl(url));

    [Theory]
    [InlineData(ShirtUrl, true)]
    [InlineData(SararSource.SitemapUrl, true)]
    [InlineData("https://sarar.com/new-soho-havlu-50-90-7662", false)]
    [InlineData("https://sarar.com/srv/service/content-v5/sub-folder/3/1004/comments", false)]
    [InlineData("https://sarar.com/sepet", false)]
    [InlineData("https://sarar.com/uye-girisi-sayfasi", false)]
    [InlineData("https://sarar.com/ajax.php", false)]
    [InlineData("https://sarar.com/arama", false)]
    [InlineData("https://sarar.com/erkek/gomlek-modelleri?sort=1", false)]
    public void Access_FollowsRobotsTxt_AndSaysWhatItIs(string url, bool allowed)
    {
        Assert.Equal(allowed, Sarar.Access.Allows(url));
        Assert.DoesNotContain("Mozilla", Sarar.Access.UserAgent);          // robots.txt asks agents for a truthful user agent
        Assert.Contains("bot", Sarar.Access.UserAgent);
    }

    // ── product pages ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Page_MenShirt_OnlyItsOwnSizes_NotTheSimilarProducts()
    {
        var html = Fixture("Sarar", "men-shirt-in-stock.html");
        Assert.Contains("data-pid=\"20271\"", html);                       // a "similar products" card with sizes of its own (M, L, XL in stock)

        var page = Page("men-shirt-in-stock.html", ShirtUrl);

        Assert.Equal(("sosa-uzun-kol-beyaz-gomlek-18525", "Sosa Uzun Kol Beyaz Gömlek", SourceGender.Men, "INTERVIEW"), (page.Code, page.Name, page.Gender, page.BrandName));
        Assert.Equal((4499.99m, "TRY", true, "gomlek"), (page.Price, page.Currency, page.InStock, page.CategoryHint));
        Assert.Null(page.ListPrice);
        Assert.Equal(["XS", "S", "M", "L", "XL", "XXL", "3XL"], page.Sizes.Select(s => s.Label));
        Assert.Equal(["S"], page.Sizes.Where(s => s.InStock).Select(s => s.Label));
        Assert.Equal(["BEYAZ"], page.ColorNames);
        Assert.Equal("%55 pamuk %45 poliester", page.Material);
        Assert.Contains("klasik kesimi", page.Description);

        var (mapped, skip) = SourceCatalogMapper.Map(Sarar, CatalogSegment.Men, page);

        Assert.Null(skip);
        var input = mapped!.Input;
        Assert.Equal(("sarar-sosa-uzun-kol-beyaz-gomlek-18525", ProductCategory.Shirt, 449999L), (input.Id, input.Category, input.PriceMinor));
        Assert.Equal(["white"], input.Colors);
        Assert.Equal(["S"], input.Sizes);
        Assert.Null(mapped.StrikePriceMinor);
        Assert.Equal(2, input.Images!.Count);
        Assert.All(input.Images!, i => Assert.Matches(@"^https://witcdn\.sarar\.com/.+-B\.jpg$", i));
        Assert.DoesNotContain("<", input.Description!["tr"]);
        Assert.Equal(ImportSkip.OtherSegment, SourceCatalogMapper.Map(Sarar, CatalogSegment.Women, page).Skip);
    }

    [Fact]
    public void Page_WomenDress_IsTheSararWomanLine()
    {
        var page = Page("women-dress-in-stock.html", DressUrl);

        Assert.Equal(("Monets Gri Elbise", SourceGender.Women, "SARAR WOMAN", "elbise"), (page.Name, page.Gender, page.BrandName, page.CategoryHint));
        Assert.Equal(["36", "40"], page.Sizes.Where(s => s.InStock).Select(s => s.Label));

        var (mapped, _) = SourceCatalogMapper.Map(Sarar, CatalogSegment.Women, page);

        Assert.Equal((ProductCategory.Dress, 939999L), (mapped!.Input.Category, mapped.Input.PriceMinor));
        Assert.Equal(["grey"], mapped.Input.Colors);                       // "GRİ"
        Assert.Equal(["36", "40"], mapped.Input.Sizes);
    }

    [Fact]
    public void Page_MenCoat_DropSizesBecomePlainSizes_AndAnEqualStruckPriceIsNoDiscount()
    {
        var page = Page("men-coat-in-stock.html", CoatUrl);

        Assert.Equal((SourceGender.Men, "palto", 13999.99m, 13999.99m), (page.Gender, page.CategoryHint, page.Price, page.ListPrice));
        Assert.Equal(["46", "48", "50", "52"], page.Sizes.Where(s => s.InStock).Select(s => s.Label));   // "6 DROP 46" …

        var (mapped, _) = SourceCatalogMapper.Map(Sarar, CatalogSegment.Men, page);

        Assert.Equal(ProductCategory.Coat, mapped!.Input.Category);
        Assert.Null(mapped.StrikePriceMinor);
        Assert.Equal(["navy"], mapped.Input.Colors);
    }

    [Fact]
    public void Page_Discounted_SoldOut_OtherLabel_HomeTextile()
    {
        var shirt = Fixture("Sarar", "men-shirt-in-stock.html");
        var entry = SararSource.ParseUrl(ShirtUrl)!;

        // the struck-through price of the product's own price block (the markup of the coat page, with a higher price)
        var discounted = shirt.Replace("<div class=\"product-current-price\"", "<div class=\"text-delete product-discounted-price\" data-old=\"0\"><span class=\"product-price-not-discounted\">5.999,99</span> TL</div><div class=\"product-current-price\"", StringComparison.Ordinal);
        var (mapped, _) = SourceCatalogMapper.Map(Sarar, CatalogSegment.Men, Sarar.ParseProduct(discounted, entry, out _)!);
        Assert.Equal((449999L, 599999L), (mapped!.Input.PriceMinor, mapped.StrikePriceMinor));

        // no size can be bought
        var soldOut = Sarar.ParseProduct(shirt.Replace("data-instock=\"1\"", "data-instock=\"0\"", StringComparison.Ordinal), entry, out _)!;
        Assert.False(soldOut.InStock);
        Assert.Equal(ImportSkip.OutOfStock, SourceCatalogMapper.Map(Sarar, CatalogSegment.Men, soldOut).Skip);

        // a label that is not one of the company's
        var other = Sarar.ParseProduct(shirt.Replace("\"brand\":{\"@type\":\"Brand\",\"name\":\"INTERVIEW\"}", "\"brand\":{\"@type\":\"Brand\",\"name\":\"ACME\"}", StringComparison.Ordinal), entry, out _)!;
        Assert.Equal(ImportSkip.OtherBrand, SourceCatalogMapper.Map(Sarar, CatalogSegment.Men, other).Skip);

        // a page whose category path is neither men's nor women's: no gender, never imported
        var home = Sarar.ParseProduct(shirt.Replace("\"category\":\"Erkek \\u003E Gömlek \\u003EPamuklu Gömlek\"", "\"category\":\"Ev \\u003E Nevresim\"", StringComparison.Ordinal), entry, out _)!;
        Assert.Equal(SourceGender.Unknown, home.Gender);
        Assert.Equal(ImportSkip.OtherSegment, SourceCatalogMapper.Map(Sarar, CatalogSegment.Men, home).Skip);
    }

    [Theory]
    [InlineData("Erkek > Gömlek >Pamuklu Gömlek", "INTERVIEW", "Men")]
    [InlineData("Kadın > Elbise >Klasik Düz Elbise", "SARAR WOMAN", "Women")]
    [InlineData(null, "SARAR WOMAN", "Women")]
    [InlineData(null, "SARAR", "Unknown")]
    [InlineData("Ev > Nevresim", "SARAR HOME", "Unknown")]
    [InlineData("Çocuk > Gömlek", "SARAR", "Kids")]
    public void Gender_IsTheFirstPartOfTheCategoryPath(string? path, string brand, string expected) => Assert.Equal(expected, SararSource.GenderOf(path, brand).ToString());

    [Theory]
    [InlineData("SARAR", true)]
    [InlineData("SARAR WOMAN", true)]
    [InlineData("INTERVIEW", true)]
    [InlineData(null, true)]
    [InlineData("ACME", false)]
    public void OwnBrand_IsOneOfTheCompanysLabels(string? brand, bool own) => Assert.Equal(own, Sarar.IsOwnBrand(brand));

    [Theory]
    [InlineData("https://witcdn.sarar.com/sosa-18525-pamuklu-gomlek-interview-51691-18-O.jpg", "https://witcdn.sarar.com/sosa-18525-pamuklu-gomlek-interview-51691-18-B.jpg")]
    [InlineData("https://witcdn.sarar.com/sarar-bej-gomlek-5677-35811-56-K.jpg", "https://witcdn.sarar.com/sarar-bej-gomlek-5677-35811-56-B.jpg")]
    [InlineData("//witcdn.sarar.com/a-1-2-B.jpg", "https://witcdn.sarar.com/a-1-2-B.jpg")]
    [InlineData("https://witcdn.sarar.com/Data/EditorFiles/Sarar-Loading-02-new.gif", null)]
    [InlineData("https://evil.example/a-1-2-O.jpg", null)]
    [InlineData(null, null)]
    public void Image_IsTheLargeVariantOfTheBrandsOwnHost(string? raw, string? expected) => Assert.Equal(expected, Sarar.ImageUrl(raw));

    [Fact]
    public void Page_OfAnotherProduct_IsAParseError()
    {
        Assert.Null(Sarar.ParseProduct(Fixture("Sarar", "men-shirt-in-stock.html"), SararSource.ParseUrl(CoatUrl)!, out var error));
        Assert.Equal("another product", error);
    }

    // ── the command ─────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Run_Men_ImportsShirtAndCoat_Women_TheDress()
    {
        var harness = new Harness(Sarar);
        harness.Site.Add(SararSource.SitemapUrl, Fixture("Sarar", "product-sitemap-excerpt.xml"));
        harness.Site.Add(ShirtUrl, Fixture("Sarar", "men-shirt-in-stock.html"));
        harness.Site.Add(CoatUrl, Fixture("Sarar", "men-coat-in-stock.html"));
        harness.Site.Add(DressUrl, Fixture("Sarar", "women-dress-in-stock.html"));

        var (exit, men) = await harness.RunAsync(CatalogSegment.Men, max: 2);

        Assert.Equal(0, exit);
        Assert.Equal(2, men.Imported);
        Assert.DoesNotContain(harness.Site.Requests, r => r.Contains("nevresim", StringComparison.Ordinal) || r.Contains("kravat", StringComparison.Ordinal) || r.Contains("new", StringComparison.Ordinal));
        Assert.DoesNotContain(DressUrl, harness.Site.Requests);            // "elbise" is not a men's word
        var coat = await harness.Catalog.GetProductAsync("sarar-sanchez-lacivert-palto-19087", CancellationToken.None);
        Assert.Equal((ProductCategory.Coat, 1399999L, CatalogSegment.Men, CoatUrl), (coat!.Category, coat.PriceMinor, coat.Segment, coat.AffiliateUrl));
        Assert.Equal(["46", "48", "50", "52"], coat.Sizes);
        Assert.Null(coat.PreviousPriceMinor);

        var (_, women) = await harness.RunAsync(CatalogSegment.Women, max: 1);

        Assert.Equal(1, women.Imported);
        Assert.Equal(CatalogSegment.Women, (await harness.Catalog.GetProductAsync("sarar-sarar-monets-elbise-18053", CancellationToken.None))!.Segment);
    }
}
