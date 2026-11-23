using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Domain.Services.Admin;
using Domain.Validation;
using FluentValidation;
using Ops;
using Ops.Commands;
using Tests.Shared;

namespace OpsTests;

/// <summary>import-vakko without the network: saved vakko.com pages (Fixtures/Vakko), a fake site, the real catalog service on the in-memory repository.</summary>
public class ImportVakkoTests
{
    private const string SkirtUrl = "https://www.vakko.com/etek/vizon-triko-midi-etek-p-M406869593-0022";
    private const string DressUrl = "https://www.vakko.com/elbise/bordo-mini-elbise-p-M401831942-0056";
    private const string TieUrl = "https://www.vakko.com/kravat/saks-micro-desenli-ipek-kravat-p-M405200025-0045-0004";

    private static string Fixture(string name) => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "Vakko", name));

    private static VakkoSitemapEntry Entry(string url) => VakkoSitemapParser.ParseUrl(url)!;

    private static VakkoProduct Page(string fixture, string code)
    {
        var product = VakkoPageParser.Parse(Fixture(fixture), code, out var error);
        Assert.Null(error);
        return product!;
    }

    private static VakkoProduct Product(
        string name = "SİYAH ELBİSE", string? gender = "Kadın", string? brand = "VAKKO", string? style = "Siyah", string? color = "SIYAH",
        decimal? price = 10990m, decimal? strike = null, string? currency = "TRY", bool inStock = true,
        IReadOnlyList<VakkoSize>? sizes = null, IReadOnlyList<string>? images = null, string? description = null, string? material = null,
        IReadOnlyList<string>? categories = null) =>
        new("M400000001-0002", name, description, material, brand, gender, categories ?? ["Kadın", "Giyim", "Elbise"], color, style, price, currency, strike, inStock,
            sizes ?? [new VakkoSize("36", true), new VakkoSize("38", false)],
            images ?? ["https://cdn.vakko.com/mnresize/{x}/{y}/8680000000001-01.jpg?v=1"]);

    // ── sitemap ─────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Sitemap_RealExcerpt_GivesUrlSlugCodeAndImages()
    {
        var entries = VakkoSitemapParser.Parse(Fixture("product-sitemap-excerpt.xml"));

        Assert.Equal(9, entries.Count);
        var skirt = entries.Single(e => e.Code == "M406869593-0022");
        Assert.Equal(SkirtUrl, skirt.Url);
        Assert.Equal("etek", skirt.CategorySlug);
        Assert.Equal("vizon-triko-midi-etek", skirt.NameSlug);
        Assert.Equal("M406869593", skirt.BaseCode);
        Assert.NotEmpty(skirt.Images);
        Assert.All(skirt.Images, i => Assert.StartsWith("https://cdn.vakko.com/mnresize/2000/3000/", i));
        // a three-part code keeps all its parts
        Assert.Contains(entries, e => e is { Code: "M405200025-0045-0004", CategorySlug: "kravat" });
    }

    [Fact]
    public void Sitemap_OtherUrls_AreDropped()
    {
        const string xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
              <url><loc>https://www.vakko.com/kadin-c-301</loc></url>
              <url><loc>https://evil.example/etek/etek-p-M1-0001</loc></url>
              <url><loc>https://www.vakko.com/etek/etek-p-M1-0001?query=x</loc></url>
              <url><loc> https://www.vakko.com/etek/mini-etek-p-M2-0002 </loc><image:image><image:loc>https://cdn.vakko.com/mnresize/2000/3000/1-01.jpg</image:loc></image:image></url>
            </urlset>
            """;

        var entry = Assert.Single(VakkoSitemapParser.Parse(xml));

        Assert.Equal(("https://www.vakko.com/etek/mini-etek-p-M2-0002", "M2-0002"), (entry.Url, entry.Code));
        Assert.Equal(["https://cdn.vakko.com/mnresize/2000/3000/1-01.jpg"], entry.Images);
    }

    // ── candidate picking ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Pick_SpreadsOverCategoriesAndSlugs_NewestFirst_OneColourPerModel_WhateverTheSitemapOrder()
    {
        string[] urls =
        [
            "https://www.vakko.com/elbise/a-p-M100-0001",
            "https://www.vakko.com/elbise/b-p-M300-0001",
            "https://www.vakko.com/elbise/c-p-M200-0001",
            "https://www.vakko.com/elbise/c-p-M200-0009",          // another colour of M200: only the highest code is fetched
            "https://www.vakko.com/elbise-tulum/d-p-M150-0001",    // second slug of the same category
            "https://www.vakko.com/etek/e-p-M120-0001",
            "https://www.vakko.com/el-cantasi/f-p-M110-0001",
            "https://www.vakko.com/kravat/g-p-M999-0001",          // men's slug: not a candidate
            "https://www.vakko.com/masa-tekstili/h-p-M998-0001",   // home: not a candidate
        ];
        var entries = urls.Select(Entry).ToList();

        var picked = VakkoCandidatePicker.Pick(entries, 100).Select(e => e.Code).ToList();
        var reversed = VakkoCandidatePicker.Pick(entries.AsEnumerable().Reverse(), 100).Select(e => e.Code).ToList();

        // round 1: skirt, dress (slug "elbise", newest), bag — in ProductCategory order (Skirt < Dress < Bag); then the dresses take turns by slug
        Assert.Equal(["M120-0001", "M300-0001", "M110-0001", "M150-0001", "M200-0009", "M100-0001"], picked);
        Assert.Equal(picked, reversed);
        Assert.Equal(["M120-0001", "M300-0001"], VakkoCandidatePicker.Pick(entries, 2).Select(e => e.Code));
    }

    [Fact]
    public void Pick_OnTheRealExcerpt_SkipsMenAndHomeSlugs()
    {
        var picked = VakkoCandidatePicker.Pick(VakkoSitemapParser.Parse(Fixture("product-sitemap-excerpt.xml")), 100);

        Assert.DoesNotContain(picked, e => e.CategorySlug is "kravat" or "masa-tekstili");
        Assert.Single(picked, e => e.BaseCode == "M406937101");   // the bag exists in two colours
        Assert.Equal(6, picked.Count);
    }

    [Theory]
    [InlineData("elbise", ProductCategory.Dress)]
    [InlineData("gomlek-bluz", ProductCategory.Blouse)]
    [InlineData("triko", ProductCategory.Knitwear)]
    [InlineData("topuklu-ayakkabi", ProductCategory.Shoes)]
    [InlineData("el-cantasi", ProductCategory.Bag)]
    [InlineData("palto-kaban", ProductCategory.Coat)]
    public void Slugs_MapToCatalogCategories(string slug, ProductCategory expected) => Assert.Equal(expected, VakkoCandidatePicker.CategoryOf(slug));

    [Theory]
    [InlineData("kravat")]
    [InlineData("giyim")]
    [InlineData("esarp")]
    [InlineData("dekoratif-obje")]
    public void Slugs_OutsideWomensApparelShoesBags_AreUnknown(string slug) => Assert.Null(VakkoCandidatePicker.CategoryOf(slug));

    // ── page parsing (real pages) ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Page_WomenInStockDiscounted_IsReadFromTheStateScript()
    {
        var product = Page("women-in-stock-discounted.html", "M406869593-0022");

        Assert.Equal("VİZON TRİKO MİDİ ETEK", product.Name);
        Assert.Equal("Kadın", product.Gender);
        Assert.Equal("VAKKO", product.Brand);
        Assert.Equal(["Kadın", "Giyim", "Etek"], product.CategoryNames);
        Assert.Equal(("BEJ", "Vizon"), (product.Color, product.Style));
        Assert.Equal((18165m, "TRY", 25950m), (product.Price, product.Currency, product.StrikePrice));
        Assert.True(product.InStock);
        Assert.Equal([new VakkoSize("36", true), new VakkoSize("38", true), new VakkoSize("40", false), new VakkoSize("42", false)], product.Sizes);
        Assert.Equal(7, product.ImageTemplates.Count);
        Assert.Equal("https://cdn.vakko.com/mnresize/{x}/{y}/8684653086356-20.jpg?v=1784633414304", product.ImageTemplates[0]);
        Assert.Null(product.DescriptionHtml);
        Assert.StartsWith("%77 Koyun Yünü", product.Material);
    }

    [Fact]
    public void Page_OutOfStock_HasNoPriceAndNoSizeInStock()
    {
        var product = Page("women-out-of-stock.html", "M401831942-0056");

        Assert.False(product.InStock);
        Assert.All(product.Sizes, s => Assert.False(s.InStock));
        Assert.Null(product.Price);
        Assert.Equal("SELF PORTRAIT", product.Brand);   // vakko.com sells other designers too
        Assert.Equal("Kadın", product.Gender);
        Assert.StartsWith("Bordo renkli", product.DescriptionHtml);
    }

    [Fact]
    public void Page_MenOneSize_KeepsGenderAndTheStdSize()
    {
        var product = Page("men-one-size.html", "M405200025-0045-0004");

        Assert.Equal("Erkek", product.Gender);
        Assert.Contains("Erkek", product.CategoryNames);
        Assert.Equal([new VakkoSize("std", true)], product.Sizes);
        Assert.True(product.InStock);
        Assert.Equal((2490m, 4450m), (product.Price, product.StrikePrice));
        Assert.Contains("<p>", product.DescriptionHtml);
    }

    [Fact]
    public void Page_ProblemsAreReported_NotThrown()
    {
        Assert.Null(VakkoPageParser.Parse("<html><body>Bakımdayız</body></html>", "M1-0001", out var noScript));
        Assert.Equal("no state script", noScript);

        Assert.Null(VakkoPageParser.Parse("""<script id="ng-state" type="application/json">{"cx-state":</script>""", "M1-0001", out var broken));
        Assert.Equal("state is not JSON", broken);

        Assert.Null(VakkoPageParser.Parse("""<script id="ng-state" type="application/json">{"cx-state":{"product":{"details":{"entities":{}}}}}</script>""", "M1-0001", out var empty));
        Assert.Equal("no product in state", empty);

        // a redirect to another product is not the product that was asked for
        Assert.Null(VakkoPageParser.Parse(Fixture("men-one-size.html"), "M406869593-0022", out var other));
        Assert.StartsWith("another product", other);
    }

    [Fact]
    public void Page_LegacyEscapedState_IsStillRead()
    {
        const string json = """{"cx-state":{"product":{"details":{"entities":{"M1-0001":{"details":{"value":{"code":"M1-0001","name":"ETEK","gender":"Kadın","price":{"currencyIso":"TRY","value":"1500.50"},"stock":{"stockLevelStatus":"inStock","stockLevel":3}}}}}}}}}""";
        var html = $"""<script id="serverApp-state" type="application/json">{json.Replace("\"", "&q;")}</script>""";

        var product = VakkoPageParser.Parse(html, "M1-0001", out var error);

        Assert.Null(error);
        Assert.Equal(("ETEK", 1500.50m, true), (product!.Name, product.Price, product.InStock));
        Assert.Empty(product.Sizes);
    }

    // ── mapping ─────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Map_RealWomenPage_BecomesAValidCatalogInput()
    {
        var (mapped, skip) = VakkoCatalogMapper.Map(Entry(SkirtUrl), Page("women-in-stock-discounted.html", "M406869593-0022"));

        Assert.Null(skip);
        var input = mapped!.Input;
        Assert.Equal("vakko-m406869593-0022", input.Id);
        Assert.True(StoreInputRules.IsId(input.Id));
        Assert.Equal("vakko", input.BrandId);
        Assert.Equal("Vizon Triko Midi Etek", input.Name!["tr"]);
        Assert.Equal("%77 Koyun Yünü, %15 Pamuk, %6 Polyamid, %2 Polyester", input.Description!["tr"]);
        Assert.Equal(ProductCategory.Skirt, input.Category);
        Assert.Equal(["taupe"], input.Colors);
        Assert.Equal(["36", "38"], input.Sizes);                      // 40 and 42 are sold out
        Assert.Equal((1816500L, "TRY"), (input.PriceMinor, input.Currency));
        Assert.Equal(2595000L, mapped.StrikePriceMinor);
        Assert.Equal(PriceBand.LuxuryTouch, input.PriceBand);
        Assert.Equal(7, input.Images!.Count);
        Assert.Equal("https://cdn.vakko.com/mnresize/800/1200/8684653086356-20.jpg?v=1784633414304", input.Images[0]);
        Assert.Equal(SkirtUrl, input.AffiliateUrl);
        Assert.Equal(AffiliateSource.Direct, input.AffiliateSource);
        Assert.Equal(CatalogSegment.Women, input.Segment);
        Assert.False(input.Retired);
    }

    [Fact]
    public void Map_SkipsMenOtherBrandsOutOfStockAndIncompleteProducts()
    {
        var dress = Entry("https://www.vakko.com/elbise/siyah-elbise-p-M400000001-0002");

        Assert.Equal(VakkoSkip.NotWomen, VakkoCatalogMapper.Map(Entry(TieUrl), Page("men-one-size.html", "M405200025-0045-0004")).Skip);
        Assert.Equal(VakkoSkip.OtherBrand, VakkoCatalogMapper.Map(Entry(DressUrl), Page("women-out-of-stock.html", "M401831942-0056")).Skip);
        Assert.Equal(VakkoSkip.NotWomen, VakkoCatalogMapper.Map(dress, Product(gender: "Unisex")).Skip);
        Assert.Equal(VakkoSkip.NotWomen, VakkoCatalogMapper.Map(dress, Product(gender: null, categories: ["Outlet", "Çocuk", "Kadın"])).Skip);
        Assert.Equal(VakkoSkip.UnknownCategory, VakkoCatalogMapper.Map(Entry("https://www.vakko.com/esarp/esarp-p-M400000001-0002"), Product()).Skip);
        Assert.Equal(VakkoSkip.OutOfStock, VakkoCatalogMapper.Map(dress, Product(inStock: false)).Skip);
        Assert.Equal(VakkoSkip.NoPrice, VakkoCatalogMapper.Map(dress, Product(price: null)).Skip);
        Assert.Equal(VakkoSkip.NoPrice, VakkoCatalogMapper.Map(dress, Product(currency: "EUR")).Skip);
        Assert.Equal(VakkoSkip.NoImage, VakkoCatalogMapper.Map(dress, Product(images: ["https://other.example/mnresize/{x}/{y}/1.jpg"])).Skip);

        // gender from the category path when the page has no gender; Vakko's own products may carry no brand at all
        Assert.Null(VakkoCatalogMapper.Map(dress, Product(gender: null, brand: null, categories: ["Outlet", "Kadın", "Elbise"])).Skip);
    }

    [Fact]
    public void Map_NotDiscounted_OneSize_SitemapImages()
    {
        var entry = VakkoSitemapParser.ParseUrl("https://www.vakko.com/el-cantasi/siyah-deri-canta-p-M400000001-0002",
            ["https://cdn.vakko.com/mnresize/2000/3000/8680000000001-01.jpg"])!;

        var mapped = VakkoCatalogMapper.Map(entry, Product(name: "SİYAH DERİ ÇANTA", strike: 10990m, sizes: [new VakkoSize("std", true)], images: [])).Product!;

        Assert.Null(mapped.StrikePriceMinor);                          // a strike price that is not higher is no discount
        Assert.Empty(mapped.Input.Sizes!);                             // one size: the app shows "Tek beden"
        Assert.Equal(ProductCategory.Bag, mapped.Input.Category);
        Assert.Equal(["https://cdn.vakko.com/mnresize/800/1200/8680000000001-01.jpg"], mapped.Input.Images);
        Assert.Null(mapped.Input.Description);
    }

    [Theory]
    [InlineData("gomlek-bluz", "MAVİ DEKOLTELİ GÖMLEK", ProductCategory.Shirt)]
    [InlineData("gomlek-bluz", "SİYAH O YAKA KISA KOLLU BLUZ", ProductCategory.Blouse)]
    [InlineData("gomlek", "EKRU SATEN BLUZ", ProductCategory.Blouse)]
    [InlineData("t-shirt-sweatshirt", "KAPÜŞONLU SWEATSHIRT", ProductCategory.Sweatshirt)]
    [InlineData("t-shirt-sweatshirt", "BASIC T-SHIRT", ProductCategory.Tshirt)]
    [InlineData("mont-kaban", "YÜN KABAN", ProductCategory.Coat)]
    [InlineData("mont-kaban", "ŞİŞME MONT", ProductCategory.Jacket)]
    [InlineData("pantolon-jean-pantolon", "MAVİ JEAN PANTOLON", ProductCategory.Jeans)]
    [InlineData("pantolon", "KETEN BERMUDA ŞORT", ProductCategory.Shorts)]
    [InlineData("pantolon", "LACİVERT STRAIGHT PANTOLON", ProductCategory.Trousers)]
    public void Category_IsCorrectedByTheName_WhereASlugHoldsTwoKinds(string slug, string name, ProductCategory expected) =>
        Assert.Equal(expected, VakkoCatalogMapper.CategoryOf(slug, name));

    [Theory]
    [InlineData("Bordo", "KIRMIZI", "burgundy")]          // the exact colour wins over its family
    [InlineData("Vizon", "BEJ", "taupe")]
    [InlineData("Saks-Gri", "MAVI", "cobalt,grey")]
    [InlineData("Koyu Yeşil", "YESIL", "forest-green")]
    [InlineData("Açık Mavi", "MAVI", "sky-blue")]
    [InlineData("Koyu Lacivert", "MAVI", "navy")]        // a modifier the table does not list: the colour word decides
    [InlineData("Çok Renkli", "KIRMIZI", "red")]         // unknown exact colour → the family
    [InlineData("Desenli", "KARISIK", "other")]          // unknown both → the catalog's "other"
    [InlineData(null, null, "other")]
    [InlineData("SİYAH/BEYAZ", null, "black,white")]
    [InlineData("Ekru", "BEYAZ", "ivory")]
    public void Colors_TurkishNamesBecomeCatalogColourIds(string? style, string? color, string expected) =>
        Assert.Equal(expected.Split(','), VakkoCatalogMapper.Colors(style, color));

    [Fact]
    public void Colors_EveryMappedIdIsACatalogColour() =>
        Assert.All(VakkoCatalogMapper.ColorIds.Values, id => Assert.True(ColorCatalog.IsKnown(id) && StoreInputRules.IsColor(id), id));

    [Fact]
    public void Sizes_OnlyInStock_Normalised_HalfSizesKept()
    {
        VakkoSize[] sizes = [new("36", true), new("37,5", true), new("38.5", true), new("xs", true), new("40", false), new("std", true), new("çok uzun bir beden adı", true), new("36", true)];

        Assert.Equal(["36", "37.5", "38.5", "XS"], VakkoCatalogMapper.Sizes(sizes));
    }

    [Theory]
    [InlineData("VİZON TRİKO MİDİ ETEK", "Vizon Triko Midi Etek")]
    [InlineData("SİYAH O YAKA KISA KOLLU BLUZ", "Siyah O Yaka Kısa Kollu Bluz")]
    [InlineData("IŞILTILI İPEK ŞAL", "Işıltılı İpek Şal")]
    [InlineData("SAKS MICRO DESENLİ İPEK KRAVAT", "Saks Micro Desenli İpek Kravat")]   // Latin word: not "Mıcro"
    [InlineData("LACİVERT SLIM FIT PANTOLON", "Lacivert Slim Fit Pantolon")]
    [InlineData("BASIC T-SHIRT", "Basic T-Shirt")]
    [InlineData("  ÇİFT   DÜĞMELİ   CEKET ", "Çift Düğmeli Ceket")]
    [InlineData("2Lİ ÇORAP SETİ %100 PAMUK", "2li Çorap Seti %100 Pamuk")]
    [InlineData("", "")]
    public void Name_TurkishTitleCase(string name, string expected) => Assert.Equal(expected, VakkoCatalogMapper.TitleCase(name));

    [Fact]
    public void Description_HtmlIsStripped_MaterialAppended_Trimmed()
    {
        Assert.Equal("Kravat Ölçüsü;\nEn : 9 cm\nBoy :150 cm\n%100 İpek",
            VakkoCatalogMapper.Description("<p>Kravat Ölçüsü;</p>\n<p>En : 9 cm<br>Boy :150 cm</p>", "%100 İpek"));
        Assert.Equal("A & B c", VakkoCatalogMapper.Description("<div>A &amp; B&nbsp;<b>c</b><script>x()</script></div>", null));
        Assert.Null(VakkoCatalogMapper.Description("  <p> </p> ", ""));
        Assert.Equal(2000, VakkoCatalogMapper.Description(new string('a', 5000), null)!.Length);
    }

    [Theory]
    [InlineData(10990, 1099000L)]
    [InlineData(1500.5, 150050L)]
    [InlineData(0, null)]
    [InlineData(-5, null)]
    public void Price_MajorUnitsBecomeMinorUnits(double price, long? expected) => Assert.Equal(expected, VakkoCatalogMapper.PriceMinor((decimal)price));

    [Fact]
    public void Images_OnlyTheVakkoCdnOverHttps_AtTheImportSize()
    {
        Assert.Equal("https://cdn.vakko.com/mnresize/800/1200/1-01.jpg?v=5", VakkoCatalogMapper.ImageUrl("https://cdn.vakko.com/mnresize/{x}/{y}/1-01.jpg?v=5"));
        Assert.Equal("https://cdn.vakko.com/mnresize/800/1200/1-01.jpg", VakkoCatalogMapper.ImageUrl("https://cdn.vakko.com/mnresize/2000/3000/1-01.jpg"));
        Assert.Null(VakkoCatalogMapper.ImageUrl("http://cdn.vakko.com/mnresize/{x}/{y}/1-01.jpg"));
        Assert.Null(VakkoCatalogMapper.ImageUrl("https://cdn.vakko.com/other/{x}/{y}/1-01.jpg"));
        Assert.Null(VakkoCatalogMapper.ImageUrl("https://cdn.vakko.com.evil.example/mnresize/{x}/{y}/1-01.jpg"));
        Assert.Equal(VakkoCatalogMapper.MaxImages, VakkoCatalogMapper.Images(Enumerable.Range(1, 20).Select(i => $"https://cdn.vakko.com/mnresize/{{x}}/{{y}}/{i}.jpg")).Count);
    }

    [Fact]
    public void Source_OnlyRequestsVakkoPagesWithoutAQuery()
    {
        Assert.True(HttpVakkoSource.IsAllowedUrl(VakkoSitemapParser.SitemapUrl));
        Assert.True(HttpVakkoSource.IsAllowedUrl(SkirtUrl));
        Assert.False(HttpVakkoSource.IsAllowedUrl(SkirtUrl + "?query=x"));               // robots.txt: no search / filter URLs
        Assert.False(HttpVakkoSource.IsAllowedUrl("http://www.vakko.com/etek/x-p-M1"));
        Assert.False(HttpVakkoSource.IsAllowedUrl("https://api.vakko.com/etek/x-p-M1"));
    }

    // ── arguments ───────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Arguments_Defaults_AndDevOnly()
    {
        var (args, error) = OpsArguments.Parse(["import-vakko", "--stage", "dev"]);

        Assert.Null(error);
        Assert.Equal((100, 400, 1200, false), (args!.VakkoMaxProducts, args.VakkoMaxPages, args.VakkoDelayMs, args.DryRun));
        Assert.Contains("refused on prod", OpsArguments.Parse(["import-vakko", "--stage", "prod", "--dry-run"]).Error);
        Assert.Contains(OpsArguments.ImportVakko, OpsArguments.DevOnly);
    }

    [Fact]
    public void Arguments_WithinTheLimits_AreTaken()
    {
        var (args, error) = OpsArguments.Parse(["import-vakko", "--stage", "dev", "--max", "200", "--max-pages", "600", "--delay-ms", "1000", "--dry-run"]);

        Assert.Null(error);
        Assert.Equal((200, 600, 1000, true), (args!.VakkoMaxProducts, args.VakkoMaxPages, args.VakkoDelayMs, args.DryRun));
    }

    [Theory]
    [InlineData("--max", "201")]
    [InlineData("--max", "0")]
    [InlineData("--max", "many")]
    [InlineData("--max-pages", "601")]
    [InlineData("--max-pages", "0")]
    [InlineData("--delay-ms", "999")]
    [InlineData("--delay-ms", "0")]
    [InlineData("--delay-ms", "60000")]
    [InlineData("--force")]
    [InlineData("--url", "https://example.com")]
    public void Arguments_OutsideTheLimits_AreRefused(params string[] rest)
    {
        var (args, error) = OpsArguments.Parse(["import-vakko", "--stage", "dev", .. rest]);

        Assert.Null(args);
        Assert.NotNull(error);
    }

    // ── the command, end to end with a fake site ────────────────────────────────────────────────────────────────

    private sealed class FakeSite : IVakkoSource
    {
        public Dictionary<string, VakkoResponse> Pages { get; } = new(StringComparer.Ordinal);
        public List<string> Requests { get; } = [];

        public Task<VakkoResponse> GetAsync(string url, TimeSpan timeout, CancellationToken ct)
        {
            Requests.Add(url);
            return Task.FromResult(Pages.TryGetValue(url, out var page) ? page : new VakkoResponse(404, null, "HTTP 404"));
        }
    }

    private sealed class Harness
    {
        public WorkerTestHost Host { get; } = new();
        public FakeSite Site { get; } = new();
        public List<TimeSpan> Pauses { get; } = [];
        public OpsOutput Output { get; } = new(Path.Combine(Path.GetTempPath(), "ops-import-vakko-test"));

        public Harness(params string[] urls)
        {
            var locs = string.Concat(urls.Select(u => $"<url><loc>{u}</loc></url>"));
            Site.Pages[VakkoSitemapParser.SitemapUrl] = new VakkoResponse(200, $"""<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{locs}</urlset>""");
        }

        public ICatalogService Catalog => Host.Get<ICatalogService>();

        public Task<(int Exit, ImportVakkoResult Result)> RunAsync(int max = 100, int maxPages = 400, bool dryRun = false) =>
            new ImportVakkoCommand(Site, Catalog, Host.Get<IValidator<ProductInput>>(), Host.Get<IValidator<BrandInput>>(), Host.Get<IAuditLog>(), Output,
                    (delay, _) => { Pauses.Add(delay); return Task.CompletedTask; })
                .RunAsync(new ImportVakkoSettings(max, maxPages, 1200, dryRun), CancellationToken.None);
    }

    private static Harness RealPages()
    {
        var harness = new Harness(SkirtUrl, DressUrl, TieUrl, "https://www.vakko.com/gomlek/beyaz-gomlek-p-M400000009-0001");
        harness.Site.Pages[SkirtUrl] = new VakkoResponse(200, Fixture("women-in-stock-discounted.html"));
        harness.Site.Pages[DressUrl] = new VakkoResponse(200, Fixture("women-out-of-stock.html"));
        harness.Site.Pages[TieUrl] = new VakkoResponse(200, Fixture("men-one-size.html"));
        return harness;
    }

    [Fact]
    public async Task Run_ImportsTheWomenProduct_ThroughTheCatalogService_AndIsIdempotent()
    {
        var harness = RealPages();

        var (exit, first) = await harness.RunAsync();

        Assert.Equal(0, exit);
        Assert.True(first.BrandCreated);
        Assert.Equal((1, 0, 0), (first.Imported, first.Updated, first.Unchanged));
        Assert.Equal(3, first.PagesFetched);                                    // the tie's slug is not a candidate: never fetched
        Assert.DoesNotContain(TieUrl, harness.Site.Requests);
        Assert.Equal(1, first.Skipped[VakkoSkip.OtherBrand]);
        Assert.Equal(1, first.FetchFailed);                                     // the shirt page is a 404
        Assert.Equal([TimeSpan.FromMilliseconds(1200), TimeSpan.FromMilliseconds(1200)], harness.Pauses);   // between requests, not before the first

        var brand = await harness.Catalog.GetBrandAsync("vakko", CancellationToken.None);
        Assert.Equal(("Vakko", "https://www.vakko.com", AffiliateSource.Direct), (brand!.Name, brand.WebsiteUrl, brand.Source));
        var product = await harness.Catalog.GetProductAsync("vakko-m406869593-0022", CancellationToken.None);
        Assert.Equal(1816500L, product!.PriceMinor);
        Assert.Equal(2595000L, product.PreviousPriceMinor);                     // the struck list price, stored by the catalog's own rule
        Assert.Equal(["36", "38"], product.Sizes);
        Assert.Equal(SkirtUrl, product.AffiliateUrl);
        Assert.Equal(CatalogSegment.Women, product.Segment);
        Assert.False(product.Retired);
        var audit = await harness.Host.Get<IAuditLog>().QueryAsync(new AuditQuery(OpsHost.ActorId, null, null, null, 20), CancellationToken.None);
        Assert.Equal(["brand.upsert", "product.upsert"], audit.Items.Select(a => a.Action).Order());

        var (_, second) = await harness.RunAsync();

        Assert.False(second.BrandCreated);
        Assert.Equal((0, 0, 1), (second.Imported, second.Updated, second.Unchanged));
        Assert.Equal(2, (await harness.Host.Get<IAuditLog>().QueryAsync(new AuditQuery(OpsHost.ActorId, null, null, null, 20), CancellationToken.None)).Items.Count);
    }

    [Fact]
    public async Task Run_Again_UpdatesPriceAndSizes_AndReportsEarlierImportsItDidNotTouch()
    {
        var harness = RealPages();
        await harness.RunAsync();
        // an earlier import that is no longer among the candidates
        var gone = (await harness.Catalog.GetProductAsync("vakko-m406869593-0022", CancellationToken.None))!;
        await harness.Catalog.UpsertProductAsync(new ProductInput("vakko-m300000000-0001", "vakko", gone.Name, null, gone.Category, gone.Colors, gone.Sizes, gone.PriceMinor, "TRY",
            gone.PriceBand, gone.Images, gone.AffiliateUrl, gone.AffiliateSource), CancellationToken.None);
        // the site now sells the skirt cheaper and size 38 sold out
        harness.Site.Pages[SkirtUrl] = new VakkoResponse(200, Fixture("women-in-stock-discounted.html")
            .Replace("\"value\":18165", "\"value\":15000")
            .Replace("\"stockLevel\":3,\"stockLevelStatus\":\"lowStock\"", "\"stockLevel\":0,\"stockLevelStatus\":\"outOfStock\""));

        var (exit, result) = await harness.RunAsync();

        Assert.Equal(0, exit);
        Assert.Equal((0, 1), (result.Imported, result.Updated));
        var product = await harness.Catalog.GetProductAsync("vakko-m406869593-0022", CancellationToken.None);
        Assert.Equal((1500000L, 1816500L), (product!.PriceMinor, product.PreviousPriceMinor));
        Assert.Equal(["36"], product.Sizes);
        Assert.Equal(["vakko-m300000000-0001 (not picked this run)"], result.NotTouched);
        Assert.False((await harness.Catalog.GetProductAsync("vakko-m300000000-0001", CancellationToken.None))!.Retired);
    }

    [Fact]
    public async Task Run_DryRun_FetchesAndReports_WritesNothing()
    {
        var harness = RealPages();

        var (exit, result) = await harness.RunAsync(dryRun: true);

        Assert.Equal(0, exit);
        Assert.Equal(1, result.Imported);
        Assert.True(result.BrandCreated);
        Assert.Null(await harness.Catalog.GetBrandAsync("vakko", CancellationToken.None));
        Assert.Empty(await harness.Catalog.GetProductsAsync(CancellationToken.None));
        Assert.Empty((await harness.Host.Get<IAuditLog>().QueryAsync(new AuditQuery(null, null, null, null, 20), CancellationToken.None)).Items);
    }

    [Fact]
    public async Task Run_StopsAtTheProductTarget_AndAtThePageBudget()
    {
        string[] urls = [.. Enumerable.Range(1, 6).Select(i => $"https://www.vakko.com/etek/etek-p-M40000000{i}-0001")];
        var page = Fixture("women-in-stock-discounted.html");
        Harness Build()
        {
            var harness = new Harness(urls);
            foreach (var (url, i) in urls.Select((u, i) => (u, i + 1)))
                harness.Site.Pages[url] = new VakkoResponse(200, page.Replace("M406869593-0022", $"M40000000{i}-0001"));
            return harness;
        }

        var target = Build();
        var (_, byTarget) = await target.RunAsync(max: 2);
        Assert.Equal((2, 2), (byTarget.Imported, byTarget.PagesFetched));

        var budget = Build();
        var (exit, byBudget) = await budget.RunAsync(max: 100, maxPages: 3);
        Assert.Equal(0, exit);
        Assert.Equal((3, 3, 3), (byBudget.Candidates, byBudget.PagesFetched, byBudget.Imported));
        Assert.Equal(4, budget.Site.Requests.Count);   // the sitemap + 3 pages
    }

    [Theory]
    [InlineData(403)]
    [InlineData(429)]
    public async Task Run_StopsAtOnce_WhenTheSiteRefuses(int status)
    {
        var harness = new Harness("https://www.vakko.com/etek/a-p-M400000001-0001", "https://www.vakko.com/etek/b-p-M400000002-0001");
        foreach (var url in harness.Site.Pages.Keys.Where(k => k != VakkoSitemapParser.SitemapUrl).ToList())
            harness.Site.Pages.Remove(url);
        harness.Site.Pages["https://www.vakko.com/etek/b-p-M400000002-0001"] = new VakkoResponse(status, null, $"HTTP {status}");

        var (exit, result) = await harness.RunAsync();

        Assert.Equal(1, exit);
        Assert.Equal(1, result.PagesFetched);
        Assert.Contains($"HTTP {status}", result.Stopped);
    }

    [Fact]
    public async Task Run_StopsAfterThreeFailedRequestsInARow()
    {
        var harness = new Harness([.. Enumerable.Range(1, 8).Select(i => $"https://www.vakko.com/etek/etek-p-M40000000{i}-0001")]);

        var (exit, result) = await harness.RunAsync();

        Assert.Equal(1, exit);
        Assert.Equal((3, 3), (result.PagesFetched, result.FetchFailed));
        Assert.Contains("3 failed requests", result.Stopped);
    }

    [Fact]
    public async Task Run_SitemapUnavailable_FetchesNothingElse()
    {
        var harness = new Harness();
        harness.Site.Pages[VakkoSitemapParser.SitemapUrl] = new VakkoResponse(503, null, "HTTP 503");

        var (exit, result) = await harness.RunAsync();

        Assert.Equal(1, exit);
        Assert.Equal(0, result.PagesFetched);
        Assert.Single(harness.Site.Requests);
    }
}
