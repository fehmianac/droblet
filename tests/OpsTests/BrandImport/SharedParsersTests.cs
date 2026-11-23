using System.IO.Compression;
using System.Text;
using Domain.Enum;
using Ops.Commands.BrandImport;
using Ops.Commands.BrandImport.Platforms;

namespace OpsTests.BrandImport;

/// <summary>The pieces the sitemap-and-page sources share: the JSON-LD product parser, embedded JSON, category words, gzip bodies, wildcard robots rules.</summary>
public class SharedParsersTests
{
    private static string Page(params string[] jsonLd) => "<html><head>" + string.Concat(jsonLd.Select(j => $"<script type=\"application/ld+json\">{j}</script>")) + "</head><body></body></html>";

    // ── JSON-LD ─────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void JsonLd_PlainProduct_WithPriceSpecificationAndProperties()
    {
        var page = JsonLdProductParser.Parse(Page(
            """{"@context":"http://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"item":{"@id":"https://shop.example","name":"Anasayfa"}},{"@type":"ListItem","position":2,"name":"Kadın"}]}""",
            """
            {"@context":"https://schema.org/","@type":"Product","sku":"323359447​","name":"Kare Yaka Bluz &amp; Etek","image":["https://img.example/a.jpg","https://img.example/a.jpg","https://img.example/b.jpg"],
             "brand":{"@type":"Brand","name":"GAP"},
             "additionalProperty":[{"@type":"PropertyValue","name":"Renk","unitText":"Açık Mavi"},{"@type":"PropertyValue","name":"Cinsiyet","value":"kadin"}],
             "offers":{"@type":"Offer","url":"https://shop.example/p/1/","availability":"http://schema.org/OutofStock","priceSpecification":{"@type":"PriceSpecification","price":"899.99","priceCurrency":"TRY"}}}
            """), out var error);

        Assert.Null(error);
        Assert.Equal(("Kare Yaka Bluz & Etek", "323359447", "GAP"), (page!.Name, page.Sku, page.Brand));   // the zero-width space after the sku is dropped
        Assert.Equal((899.99m, "TRY", false), (page.Price, page.Currency, page.InStock));
        Assert.Equal(["https://img.example/a.jpg", "https://img.example/b.jpg"], page.Images);
        Assert.Equal(("Açık Mavi", "kadin"), (page.Property("Renk"), page.Property("cinsiyet")));
        Assert.Null(page.Property("Materyal"));
        Assert.Equal(["Anasayfa", "Kadın"], page.Breadcrumbs);
        Assert.Equal("https://shop.example/p/1/", page.Url);
    }

    [Fact]
    public void JsonLd_Graph_Array_OfferList_AndABrokenBlockBeforeIt()
    {
        var graph = JsonLdProductParser.Parse(Page(
            "{ not json",
            """{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Shop"},{"@type":["Product","Thing"],"name":"Palto","productID":"18987","category":"Erkek > Dış Giyim >Palto","brand":"INTERVIEW","image":"https://img.example/p.jpg","offers":[{"@type":"Offer"},{"@type":"Offer","price":13999.99,"priceCurrency":"TRY","availability":"https://schema.org/InStock"}]}]}"""), out _);

        Assert.Equal(("Palto", "18987", "Erkek > Dış Giyim >Palto", "INTERVIEW"), (graph!.Name, graph.ProductId, graph.Category, graph.Brand));
        Assert.Equal((13999.99m, "TRY", true), (graph.Price, graph.Currency, graph.InStock));
        Assert.Equal(["https://img.example/p.jpg"], graph.Images);

        var array = JsonLdProductParser.Parse(Page("""[{"@type":"WebSite","name":"x"},{"@type":"Product","name":"Etek","offers":{"lowPrice":"10","priceCurrency":"TRY","availability":"PreOrder"}}]"""), out _);

        Assert.Equal(("Etek", 10m), (array!.Name, array.Price));
        Assert.Null(array.InStock);                                        // neither in stock nor out of it: the source decides
    }

    [Fact]
    public void JsonLd_Missing_SaysWhy()
    {
        Assert.Null(JsonLdProductParser.Parse("<html></html>", out var none));
        Assert.Equal("no JSON-LD", none);
        Assert.Null(JsonLdProductParser.Parse(Page("""{"@type":"Organization","name":"Shop"}"""), out var other));
        Assert.Equal("no Product in JSON-LD", other);
        Assert.Null(JsonLdProductParser.Parse(null, out _));
    }

    [Fact]
    public void PageJson_ValueAfter_CutsOneValueOutOfAScript()
    {
        const string html = """<script>var a = 1; APP.product = {"id":7,"name":"Kazak","tags":{"price":"12.50","sold":false}}; APP.other = {"id":8};</script>""";

        using var document = PageJson.ValueAfter(html, "APP.product = ");

        var product = document!.RootElement;
        Assert.Equal(("7", "Kazak"), (product.Text("id"), product.Text("name")));
        Assert.Equal((12.50m, false), (product.Child("tags")!.Value.Number("price"), product.Child("tags")!.Value.Flag("sold")));
        Assert.Null(PageJson.ValueAfter(html, "APP.missing = "));
        Assert.Null(PageJson.ValueAfter("<script>APP.product = function() {};</script>", "APP.product = "));
        Assert.Null(PageJson.ValueAfter(null, "x"));
    }

    // ── category words ──────────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("keten-karisimi-shirred-maxi-elbise", "elbise")]
    [InlineData("Pique Polo Yaka T-Shirt", "tshirt")]
    [InlineData("relaxed-stripe-mini-t-shirt-elbise", "elbise")]
    [InlineData("Low Rise Stride Wide-Leg Jean Pantolon", "pantolon")]
    [InlineData("islemeli-paperbag-mom-jean-sort", "sort")]
    [InlineData("Erkek > Dış Giyim >Palto", "palto")]
    [InlineData("Outlet / Giyim / Triko & Kazak", "kazak")]
    [InlineData("Kadın / Giyim / Etek", "etek")]
    [InlineData("Sırt Çantası", "cantasi")]
    [InlineData("Tişört", "tisort")]
    [InlineData("celik-kol-dugmesi-48", null)]
    [InlineData("organik-stretch-pamuk-boxer-5-li", null)]
    [InlineData("kids-katmanli-etek", null)]                               // children's lines
    [InlineData("Kız Çocuk Elbise", null)]
    [InlineData("deri-canta-aksesuari", null)]
    [InlineData("slim-fit-takim-elbise", null)]                            // "takım elbise" is a suit, not a dress
    [InlineData("", null)]
    [InlineData(null, null)]
    public void Hint_IsTheLastGarmentWord_UnlessAStopWordIsThere(string? text, string? expected) => Assert.Equal(expected, SourceCategories.Hint(text));

    [Fact]
    public void Hint_ThePageCategoryWins_AStopWordThereEndsIt()
    {
        Assert.Equal("kazak", SourceCategories.HintOf("Triko & Kazak", "gomlek"));
        Assert.Equal("gomlek", SourceCategories.HintOf("Yeni Sezon", "gomlek"));       // no category word on the page: the URL's stands
        Assert.Equal("gomlek", SourceCategories.HintOf(null, "gomlek"));
        Assert.Null(SourceCategories.HintOf("Erkek > Takım Elbise", "gomlek"));
        Assert.Equal("", SourceCategories.HintOf("Yeni Sezon", ""));                    // no word anywhere: no category, skipped by the mapper
    }

    [Fact]
    public void Words_EveryWordHasACategoryInItsSegment_AndMenHaveNoDresses()
    {
        Assert.Equal(SourceCategories.Women.Count, SourceCategories.Women.Select(w => w.Slug).Distinct().Count());
        Assert.Equal(SourceCategories.Men.Count, SourceCategories.Men.Select(w => w.Slug).Distinct().Count());
        Assert.DoesNotContain(SourceCategories.Men, w => w.Category is ProductCategory.Dress or ProductCategory.Skirt or ProductCategory.Blouse);
        Assert.All(SourceCategories.Women.Concat(SourceCategories.Men), w => Assert.Equal(w.Slug, SourceCategories.Hint(w.Slug)));
        Assert.DoesNotContain(SourceCategories.Women.Concat(SourceCategories.Men), w => SourceCategories.StopWords.Contains(w.Slug));
    }

    // ── fetching ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Body_AGzipFileIsUnpacked_PlainTextIsLeftAlone()
    {
        const string xml = """<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>https://shop.example/gömlek-1</loc></url></urlset>""";
        using var packed = new MemoryStream();
        using (var gzip = new GZipStream(packed, CompressionLevel.Fastest, leaveOpen: true))
            gzip.Write(Encoding.UTF8.GetBytes(xml));

        Assert.Equal(xml, HttpSiteClient.Text(packed.ToArray()));
        Assert.Equal(xml, HttpSiteClient.Text(Encoding.UTF8.GetBytes(xml)));
        Assert.Equal(xml, HttpSiteClient.Text([0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes(xml)]));   // a byte order mark is not content
        Assert.Equal("", HttpSiteClient.Text([]));
        Assert.Throws<InvalidDataException>(() => HttpSiteClient.Text([0x1F, 0x8B, 0x08, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF]));   // a gzip header, then no deflate data
    }

    [Fact]
    public void Access_WildcardRulesOfRobotsTxt_RefuseAUrlThatContainsThem_AnyCase()
    {
        var access = new SourceAccess(["shop.example"], ["/cart"], AllowQuery: true) { DisallowedFragments = ["price", "?sort"] };

        Assert.True(access.Allows("https://shop.example/blue-shirt-1"));
        Assert.False(access.Allows("https://shop.example/half-Price-shirt-2"));
        Assert.False(access.Allows("https://shop.example/shirts?sort=new"));
        Assert.True(access.Allows("https://shop.example/shirts?page=2"));
        Assert.Equal("Mozilla/5.0", access.UserAgent);
        Assert.Equal("shop-bot/1.0", (access with { UserAgent = "shop-bot/1.0" }).UserAgent);
    }

    [Fact]
    public void SitemapIndex_GivesTheSitemapsItNames_AUrlSetHasNone()
    {
        const string index = """
            <?xml version="1.0" encoding="UTF-8"?>
            <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <sitemap><loc>https://shop.example/product_1.xml</loc><lastmod>2026-11-23</lastmod></sitemap>
              <sitemap><loc> https://shop.example/product_2.xml </loc></sitemap>
            </sitemapindex>
            """;

        Assert.Equal(["https://shop.example/product_1.xml", "https://shop.example/product_2.xml"], SitemapXml.ParseIndex(index));
        Assert.Empty(SitemapXml.ParseIndex("""<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://shop.example/a</loc></url></urlset>"""));
        Assert.Empty(SitemapXml.Parse(index));
    }
}
