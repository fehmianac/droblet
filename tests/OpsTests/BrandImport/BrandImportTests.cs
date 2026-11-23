using Domain.Enum;
using Domain.Services;
using Domain.Services.Admin;
using Domain.Validation;
using FluentValidation;
using Ops;
using Ops.Commands.BrandImport;
using Tests.Shared;

namespace OpsTests.BrandImport;

/// <summary>
/// The brand-independent pieces of import-brand, exercised with a made-up source (another brand, another page format,
/// two discovery requests, English names) so nothing here depends on Vakko. No network.
/// </summary>
public class BrandImportTests
{
    // ── a second source, as small as a real one would be ────────────────────────────────────────────────────────

    /// <summary>"Acme": an index page lists listing pages, a listing has "url|code|category|model" lines, a product page has "key=value" lines.</summary>
    private sealed class AcmeSource : BrandCatalogSource
    {
        public const string IndexUrl = "https://shop.acme.example/sitemap.txt";

        public override string BrandId => "acme";
        public override string DisplayName => "Acme";
        public override string WebsiteUrl => "https://shop.acme.example";
        public override IReadOnlyList<CatalogSegment> Segments { get; } = [CatalogSegment.Women, CatalogSegment.Men];
        public override PriceBand PriceBand => PriceBand.HighStreet;
        public override SourceAccess Access { get; } = new(["shop.acme.example"], ["/account", "/cart", "/search"]);
        public override int MaxDiscoveryRequests => 3;
        protected override IReadOnlyList<string> ImageHosts { get; } = ["img.acme.example"];
        public override bool TitleCaseNames => false;
        public override IReadOnlyDictionary<string, string> ExtraColors { get; } = new Dictionary<string, string> { ["midnight"] = "navy", ["blue"] = "sky-blue" };

        public override IReadOnlyList<(string Slug, ProductCategory Category)> CategorySlugs(CatalogSegment segment) =>
            segment == CatalogSegment.Men
                ? [("shirts", ProductCategory.Shirt), ("shoes", ProductCategory.Shoes)]
                : [("dresses", ProductCategory.Dress), ("party-dresses", ProductCategory.Dress), ("tops", ProductCategory.Blouse), ("shoes", ProductCategory.Shoes)];

        public override async Task<SourceDiscovery> DiscoverAsync(PoliteFetcher site, CatalogSegment segment, CancellationToken ct)
        {
            var index = await site.GetAsync(IndexUrl, TimeSpan.FromSeconds(5), ct);
            if (!index.Ok)
                return SourceDiscovery.Failed($"index: {index.Error}");
            var candidates = new List<SourceCandidate>();
            foreach (var listing in index.Body!.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var page = await site.GetAsync(listing, TimeSpan.FromSeconds(5), ct);
                if (!page.Ok)
                    return SourceDiscovery.Failed($"listing: {page.Error}");
                candidates.AddRange(page.Body!.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Select(line => line.Split('|'))
                    .Select(f => new SourceCandidate(f[0], f[1], f[2], null, [], f.Length > 3 ? f[3] : null)));
            }
            return new SourceDiscovery(candidates, $"Listings: {candidates.Count} products");
        }

        public override SourceProduct? ParseProduct(string body, SourceCandidate candidate, out string? error)
        {
            var fields = body.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(l => l.Split('=', 2)).Where(f => f.Length == 2).ToDictionary(f => f[0], f => f[1]);
            if (!fields.TryGetValue("name", out var name))
            {
                error = "no name";
                return null;
            }
            error = null;
            decimal? Money(string key) => fields.TryGetValue(key, out var v) ? decimal.Parse(v, System.Globalization.CultureInfo.InvariantCulture) : null;
            return new SourceProduct(
                candidate.Code, name, fields.GetValueOrDefault("description"), null,
                fields.GetValueOrDefault("gender") switch { "women" => SourceGender.Women, "men" => SourceGender.Men, _ => SourceGender.Unknown },
                fields.GetValueOrDefault("brand"), candidate.CategoryHint,
                fields.TryGetValue("color", out var color) ? [color] : [],
                (fields.GetValueOrDefault("sizes") ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(s => new SourceSize(s.TrimEnd('!'), !s.EndsWith('!'))).ToList(),
                Money("price"), Money("list"), fields.GetValueOrDefault("currency") ?? "TRY",
                (fields.GetValueOrDefault("images") ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries),
                candidate.Url, fields.GetValueOrDefault("stock") != "0");
        }
    }

    private static readonly AcmeSource Acme = new();

    private sealed class FakeSite : ISiteClient
    {
        public Dictionary<string, SourceResponse> Pages { get; } = new(StringComparer.Ordinal);
        public List<string> Requests { get; } = [];

        public Task<SourceResponse> GetAsync(string url, TimeSpan timeout, CancellationToken ct)
        {
            Requests.Add(url);
            return Task.FromResult(Pages.TryGetValue(url, out var page) ? page : new SourceResponse(404, null, "HTTP 404"));
        }
    }

    private static (PoliteFetcher Fetcher, FakeSite Site, List<TimeSpan> Pauses) Fetcher(int maxRequests = 100, int delayMs = 1500)
    {
        var site = new FakeSite();
        var pauses = new List<TimeSpan>();
        var fetcher = new PoliteFetcher(site, Acme.Access, TimeSpan.FromMilliseconds(delayMs), maxRequests, (delay, _) => { pauses.Add(delay); return Task.CompletedTask; });
        return (fetcher, site, pauses);
    }

    private static string Url(string path) => "https://shop.acme.example" + path;

    private static Task<SourceResponse> Get(PoliteFetcher fetcher, string path) => fetcher.GetAsync(Url(path), TimeSpan.FromSeconds(1), CancellationToken.None);

    // ── access rules ────────────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("https://shop.acme.example/dresses/red-dress-a1", true)]
    [InlineData("https://shop.acme.example/sitemap.txt", true)]
    [InlineData("https://shop.acme.example/cartier-watch-a2", true)]            // "/cart" covers whole segments only
    [InlineData("https://shop.acme.example/cart", false)]
    [InlineData("https://shop.acme.example/cart/items", false)]
    [InlineData("https://shop.acme.example/Account/orders", false)]             // paths are compared without case
    [InlineData("https://shop.acme.example/search", false)]
    [InlineData("https://shop.acme.example/dresses/red-dress-a1?size=m", false)] // no query strings: filters, searches, tracking
    [InlineData("https://shop.acme.example/dresses/red-dress-a1#reviews", false)]
    [InlineData("http://shop.acme.example/dresses/red-dress-a1", false)]
    [InlineData("https://api.acme.example/dresses/red-dress-a1", false)]
    [InlineData("https://shop.acme.example.evil.example/dresses/a1", false)]
    [InlineData("not a url", false)]
    [InlineData(null, false)]
    public void Access_OnlyPublicPagesOfTheSourcesHosts(string? url, bool allowed) => Assert.Equal(allowed, Acme.Access.Allows(url));

    [Fact]
    public void Access_AQueryStringIsAllowedOnlyWhenTheSourceSaysSo_AndASlashEndedPrefixCoversEverythingBelow()
    {
        var access = new SourceAccess(["shop.acme.example"], ["/api/"], AllowQuery: true);

        Assert.True(access.Allows("https://shop.acme.example/sitemap_products_1.xml?from=1&to=2"));
        Assert.False(access.Allows("https://shop.acme.example/api/products?page=2"));
        Assert.True(access.Allows("https://shop.acme.example/api"));   // "/api/" names what is below it
    }

    // ── the polite fetcher ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Fetcher_PausesBeforeEveryRequestButTheFirst()
    {
        var (fetcher, site, pauses) = Fetcher();
        site.Pages[Url("/a")] = site.Pages[Url("/b")] = site.Pages[Url("/c")] = new SourceResponse(200, "ok");

        await Get(fetcher, "/a");
        await Get(fetcher, "/b");
        await Get(fetcher, "/c");

        Assert.Equal(3, fetcher.Requests);
        Assert.Equal([TimeSpan.FromMilliseconds(1500), TimeSpan.FromMilliseconds(1500)], pauses);
        Assert.Null(fetcher.Stopped);
    }

    [Fact]
    public void Fetcher_RefusesADelayBelowOneSecond() =>
        Assert.Throws<ArgumentOutOfRangeException>(() => new PoliteFetcher(new FakeSite(), Acme.Access, TimeSpan.FromMilliseconds(999), 10));

    [Fact]
    public async Task Fetcher_NeverRequestsAUrlTheSourceDoesNotAllow()
    {
        var (fetcher, site, pauses) = Fetcher();

        var response = await Get(fetcher, "/account/orders");

        Assert.Equal((0, "url not allowed"), (response.Status, response.Error));
        Assert.Empty(site.Requests);
        Assert.Empty(pauses);
        Assert.Equal(0, fetcher.Requests);
    }

    [Theory]
    [InlineData(403)]
    [InlineData(429)]
    public async Task Fetcher_StopsForGood_WhenTheSiteRefuses(int status)
    {
        var (fetcher, site, _) = Fetcher();
        site.Pages[Url("/a")] = new SourceResponse(status, null, $"HTTP {status}");
        site.Pages[Url("/b")] = new SourceResponse(200, "ok");

        var refused = await Get(fetcher, "/a");
        var after = await Get(fetcher, "/b");

        Assert.Equal(status, refused.Status);
        Assert.Contains($"HTTP {status}", fetcher.Stopped);
        Assert.False(after.Ok);
        Assert.Equal([Url("/a")], site.Requests);   // nothing is requested after the refusal
    }

    [Fact]
    public async Task Fetcher_StopsAfterThreeFailuresInARow_ASuccessResetsTheCount()
    {
        var (fetcher, site, _) = Fetcher();
        site.Pages[Url("/ok")] = new SourceResponse(200, "ok");
        site.Pages[Url("/down")] = new SourceResponse(0, null, "timeout");

        await Get(fetcher, "/missing-1");
        await Get(fetcher, "/down");
        await Get(fetcher, "/ok");
        await Get(fetcher, "/missing-2");
        await Get(fetcher, "/missing-3");
        Assert.Null(fetcher.Stopped);

        await Get(fetcher, "/missing-4");

        Assert.Contains("3 failed requests", fetcher.Stopped);
        await Get(fetcher, "/ok");
        Assert.Equal(6, site.Requests.Count);
    }

    [Fact]
    public async Task Fetcher_HasAHardRequestCap()
    {
        var (fetcher, site, _) = Fetcher(maxRequests: 2);
        site.Pages[Url("/a")] = site.Pages[Url("/b")] = site.Pages[Url("/c")] = new SourceResponse(200, "ok");

        await Get(fetcher, "/a");
        await Get(fetcher, "/b");
        var third = await Get(fetcher, "/c");

        Assert.False(third.Ok);
        Assert.Equal(2, site.Requests.Count);
        Assert.Contains("request cap", fetcher.Stopped);
    }

    // ── sitemap xml ─────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Sitemap_GivesEveryUrlWithItsImages_WhateverTheBrand()
    {
        const string xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
              <url><loc> https://shop.acme.example/products/red-dress </loc><lastmod>2026-11-01</lastmod>
                <image:image><image:loc>https://img.acme.example/1.jpg</image:loc><image:title>Red</image:title></image:image>
                <image:image><image:loc>https://img.acme.example/2.jpg</image:loc></image:image></url>
              <url><loc>https://shop.acme.example/products/blue-shirt</loc></url>
              <url><lastmod>2026-11-01</lastmod></url>
            </urlset>
            """;

        var urls = SitemapXml.Parse(xml);

        Assert.Equal(["https://shop.acme.example/products/red-dress", "https://shop.acme.example/products/blue-shirt"], urls.Select(u => u.Loc));
        Assert.Equal(["https://img.acme.example/1.jpg", "https://img.acme.example/2.jpg"], urls[0].Images);
        Assert.Empty(urls[1].Images);
        Assert.Throws<System.Xml.XmlException>(() => SitemapXml.Parse("<html><body>Bakımdayız"));
    }

    // ── candidate picking ───────────────────────────────────────────────────────────────────────────────────────

    private static SourceCandidate Candidate(string category, string code, string? model = null) => new(Url($"/{category}/{code.ToLowerInvariant()}"), code, category, null, [], model);

    [Fact]
    public void Pick_RoundRobinAcrossCategoriesAndSlugs_OneColourPerModel_Deterministic()
    {
        SourceCandidate[] found =
        [
            Candidate("dresses", "D1"), Candidate("dresses", "D3"), Candidate("dresses", "D2-RED", "D2"), Candidate("dresses", "D2-BLUE", "D2"),
            Candidate("party-dresses", "P1"),
            Candidate("tops", "T1"), Candidate("tops", "T2"),
            Candidate("shoes", "S1"),
            Candidate("homeware", "H1"),                       // not in the slug table: never fetched
            Candidate("tops", "has spaces"),                   // would not be a catalog id
        ];

        var women = CandidatePicker.Pick(Acme, CatalogSegment.Women, found, 100).Select(c => c.Code).ToList();

        // round 1 in ProductCategory order: Blouse (tops), Dress, Shoes; then the two dress slugs take turns, newest code first
        Assert.Equal(["T2", "D3", "S1", "T1", "P1", "D2-RED", "D1"], women);
        Assert.Equal(women, CandidatePicker.Pick(Acme, CatalogSegment.Women, found.AsEnumerable().Reverse(), 100).Select(c => c.Code));
        Assert.Equal(["T2", "D3"], CandidatePicker.Pick(Acme, CatalogSegment.Women, found, 2).Select(c => c.Code));
        Assert.Empty(CandidatePicker.Pick(Acme, CatalogSegment.Women, found, 0));
    }

    [Fact]
    public void Pick_UsesTheSegmentsOwnSlugTable()
    {
        SourceCandidate[] found = [Candidate("dresses", "D1"), Candidate("shirts", "M1"), Candidate("shoes", "S1")];

        Assert.Equal(["M1", "S1"], CandidatePicker.Pick(Acme, CatalogSegment.Men, found, 100).Select(c => c.Code));
        Assert.Equal(["D1", "S1"], CandidatePicker.Pick(Acme, CatalogSegment.Women, found, 100).Select(c => c.Code));
    }

    // ── mapping ─────────────────────────────────────────────────────────────────────────────────────────────────

    private static SourceProduct Product(
        string code = "A-100", string name = "Midnight wrap dress", SourceGender gender = SourceGender.Women, string? brand = null, string? category = "dresses",
        IReadOnlyList<string>? colors = null, IReadOnlyList<SourceSize>? sizes = null, decimal? price = 1999.90m, decimal? list = null, string? currency = "TRY",
        IReadOnlyList<string>? images = null, bool inStock = true, string? description = "<p>Wrap dress.</p>", string? material = "100% viscose") =>
        new(code, name, description, material, gender, brand, category, colors ?? ["Midnight"], sizes ?? [new SourceSize("S", true), new SourceSize("M", false)],
            price, list, currency, images ?? ["https://img.acme.example/a-100-1.jpg"], Url("/dresses/a-100"), inStock);

    [Fact]
    public void Map_AnySource_BecomesAValidCatalogInput()
    {
        var (mapped, skip) = SourceCatalogMapper.Map(Acme, CatalogSegment.Women, Product(list: 2499m));

        Assert.Null(skip);
        var input = mapped!.Input;
        Assert.Equal("acme-a-100", input.Id);                                   // "{brandId}-{code}", lower case
        Assert.True(StoreInputRules.IsId(input.Id));
        Assert.Equal("acme", input.BrandId);
        Assert.Equal("Midnight wrap dress", input.Name!["tr"]);                 // this source does not shout: no title casing
        Assert.Equal("Wrap dress.\n100% viscose", input.Description!["tr"]);
        Assert.Equal(ProductCategory.Dress, input.Category);
        Assert.Equal(["navy"], input.Colors);                                   // the source's own colour word
        Assert.Equal(["S"], input.Sizes);
        Assert.Equal((199990L, "TRY", PriceBand.HighStreet), (input.PriceMinor, input.Currency, input.PriceBand));
        Assert.Equal(249900L, mapped.StrikePriceMinor);
        Assert.Equal(["https://img.acme.example/a-100-1.jpg"], input.Images);
        Assert.Equal(Url("/dresses/a-100"), input.AffiliateUrl);
        Assert.Equal((AffiliateSource.Direct, CatalogSegment.Women, false), (input.AffiliateSource, input.Segment, input.Retired));
    }

    [Fact]
    public void Map_SkipsWhatDoesNotBelongInTheSegmentOrTheCatalog()
    {
        ImportSkip? Skip(SourceProduct product, CatalogSegment segment = CatalogSegment.Women) => SourceCatalogMapper.Map(Acme, segment, product).Skip;

        Assert.Equal(ImportSkip.OtherSegment, Skip(Product(gender: SourceGender.Men)));
        Assert.Equal(ImportSkip.OtherSegment, Skip(Product(gender: SourceGender.Unisex)));
        Assert.Equal(ImportSkip.OtherSegment, Skip(Product(gender: SourceGender.Kids)));
        Assert.Equal(ImportSkip.OtherSegment, Skip(Product(gender: SourceGender.Unknown)));
        Assert.Equal(ImportSkip.OtherSegment, Skip(Product(category: "shirts"), CatalogSegment.Men));   // a women's product in a men's run
        Assert.Equal(ImportSkip.OtherBrand, Skip(Product(brand: "Other Label")));
        Assert.Null(Skip(Product(brand: "ACME Studio")));
        Assert.Equal(ImportSkip.UnknownCategory, Skip(Product(category: "homeware")));
        Assert.Equal(ImportSkip.UnknownCategory, Skip(Product(category: null)));
        Assert.Equal(ImportSkip.UnknownCategory, Skip(Product(gender: SourceGender.Men), CatalogSegment.Men));   // "dresses" is not a men's slug
        Assert.Equal(ImportSkip.OutOfStock, Skip(Product(inStock: false)));
        Assert.Equal(ImportSkip.NoPrice, Skip(Product(price: null)));
        Assert.Equal(ImportSkip.NoPrice, Skip(Product(currency: "USD")));       // the catalog is in TRY
        Assert.Equal(ImportSkip.NoImage, Skip(Product(images: ["https://elsewhere.example/1.jpg", "http://img.acme.example/1.jpg"])));
    }

    [Fact]
    public void Map_MenSegment_IsStoredAsMen()
    {
        var mapped = SourceCatalogMapper.Map(Acme, CatalogSegment.Men, Product(gender: SourceGender.Men, category: "shirts", list: 1999.90m)).Product!;

        Assert.Equal((CatalogSegment.Men, ProductCategory.Shirt), (mapped.Input.Segment, mapped.Input.Category));
        Assert.Null(mapped.StrikePriceMinor);   // a list price that is not higher is no discount
    }

    [Theory]
    [InlineData("Black", "black")]
    [InlineData("Off White", "ivory")]
    [InlineData("Navy / White", "navy,white")]
    [InlineData("Dark Green", "forest-green")]
    [InlineData("Light Blue", "sky-blue")]
    [InlineData("Heather Grey", "grey")]                 // a word the table does not list: the colour word decides
    [InlineData("Lacivert", "navy")]                     // Turkish and English share one table
    [InlineData("Açık Gri", "grey")]
    [InlineData("Sunset", "other")]
    public void Colors_SharedTurkishEnglishDictionary(string name, string expected) =>
        Assert.Equal(expected.Split(','), SourceColors.Normalize([name]));

    [Fact]
    public void Colors_ASourceExtendsAndOverridesTheSharedDictionary()
    {
        Assert.Equal(["other"], SourceColors.Normalize(["Midnight"]));
        Assert.Equal(["navy"], SourceColors.Normalize(["Midnight"], Acme.ExtraColors));
        Assert.Equal(["cobalt"], SourceColors.Normalize(["Blue"]));
        Assert.Equal(["sky-blue"], SourceColors.Normalize(["Blue"], Acme.ExtraColors));
        Assert.Equal(["black"], SourceColors.Normalize(["Unknown shade", "Black"], Acme.ExtraColors));   // the first name that resolves wins
        Assert.Equal(SourceColors.MaxColors, SourceColors.Normalize(["black/white/red/navy/pink"]).Count);
    }

    [Fact]
    public void Colors_EverySharedIdIsACatalogColour_AndEveryKeyIsFolded() =>
        Assert.All(SourceColors.Shared, pair =>
        {
            Assert.True(ColorCatalog.IsKnown(pair.Value) && StoreInputRules.IsColor(pair.Value), pair.Value);
            Assert.Equal(SourceText.Fold(pair.Key), pair.Key);
        });

    [Fact]
    public void Name_IsTitleCasedOnlyWhenTheSourceAsks_AndAlwaysTrimmedToTheLimit()
    {
        Assert.Equal("Işıltılı İpek Şal", SourceText.DisplayName("IŞILTILI  İPEK ŞAL", titleCase: true));
        Assert.Equal("Scuba Oversized 1/2 Zip", SourceText.DisplayName(" Scuba  Oversized 1/2 Zip ", titleCase: false));
        Assert.Equal(SourceText.MaxNameLength, SourceText.DisplayName(new string('a', 500), titleCase: false).Length);
    }

    [Theory]
    [InlineData(ProductCategory.Tshirt, "Kapüşonlu Sweatshirt", ProductCategory.Sweatshirt)]
    [InlineData(ProductCategory.Jacket, "Yün Kaban", ProductCategory.Coat)]
    [InlineData(ProductCategory.Trousers, "Straight Jean", ProductCategory.Jeans)]
    [InlineData(ProductCategory.Dress, "Jean Elbise", ProductCategory.Dress)]
    [InlineData(ProductCategory.Shoes, null, ProductCategory.Shoes)]
    public void Category_IsRefinedByTheName(ProductCategory category, string? name, ProductCategory expected) =>
        Assert.Equal(expected, SourceCatalogMapper.RefineCategory(category, name));

    [Fact]
    public void Sizes_OneSizeLabelsOfAnyLanguage_GiveNoSizeList() =>
        Assert.Empty(SourceCatalogMapper.Sizes([new("One Size", true), new("OS", true), new("Tek Beden", true), new("STD", true)]));

    // ── the command with the second source ──────────────────────────────────────────────────────────────────────

    private sealed class Harness
    {
        public WorkerTestHost Host { get; } = new();
        public FakeSite Site { get; } = new();
        public List<TimeSpan> Pauses { get; } = [];
        public OpsOutput Output { get; } = new(Path.Combine(Path.GetTempPath(), "ops-import-brand-test-" + Guid.NewGuid().ToString("N")));

        public ICatalogService Catalog => Host.Get<ICatalogService>();

        public Task<(int Exit, ImportBrandResult Result)> RunAsync(CatalogSegment segment = CatalogSegment.Women, int max = 100, int maxPages = 400, bool dryRun = false) =>
            new ImportBrandCommand(Acme, Site, Catalog, Host.Get<IValidator<ProductInput>>(), Host.Get<IValidator<BrandInput>>(), Host.Get<IAuditLog>(), Output,
                    (delay, _) => { Pauses.Add(delay); return Task.CompletedTask; })
                .RunAsync(new ImportBrandSettings(segment, max, maxPages, 2000, dryRun), CancellationToken.None);

        public string Summary()
        {
            Output.Flush();
            return File.ReadAllText(Path.Combine(Output.Directory, "summary.md"));
        }
    }

    private static Harness AcmeShop()
    {
        var harness = new Harness();
        var pages = harness.Site.Pages;
        pages[AcmeSource.IndexUrl] = new SourceResponse(200, Url("/list-1") + "\n" + Url("/list-2"));
        pages[Url("/list-1")] = new SourceResponse(200, $"{Url("/dresses/a-100")}|A-100|dresses\n{Url("/shirts/m-200")}|M-200|shirts");
        pages[Url("/list-2")] = new SourceResponse(200, $"{Url("/shoes/s-300")}|S-300|shoes\n{Url("/homeware/h-400")}|H-400|homeware");
        pages[Url("/dresses/a-100")] = new SourceResponse(200, "name=Midnight wrap dress\ngender=women\ncolor=Midnight\nsizes=S,M!\nprice=1999.90\nlist=2499\nimages=https://img.acme.example/a-100-1.jpg");
        pages[Url("/shirts/m-200")] = new SourceResponse(200, "name=Oxford shirt\ngender=men\ncolor=White\nsizes=M,L\nprice=1499\nimages=https://img.acme.example/m-200-1.jpg");
        pages[Url("/shoes/s-300")] = new SourceResponse(200, "name=Leather sneaker\ngender=men\ncolor=Black\nsizes=42,43\nprice=3999\nimages=https://img.acme.example/s-300-1.jpg");
        return harness;
    }

    [Fact]
    public async Task Run_ASecondSource_ImportsThroughTheSameLoop()
    {
        var harness = AcmeShop();

        var (exit, result) = await harness.RunAsync();

        Assert.Equal(0, exit);
        Assert.True(result.BrandCreated);
        Assert.Equal((2, 2, 1), (result.Candidates, result.PagesFetched, result.Imported));       // the dress and the shoe; shirts and homeware are not women's slugs
        Assert.Equal(1, result.Skipped[ImportSkip.OtherSegment]);                                  // the sneaker is a men's product
        Assert.Equal(5, harness.Site.Requests.Count);                                              // index + 2 listings + 2 pages
        Assert.Equal(Enumerable.Repeat(TimeSpan.FromSeconds(2), 4), harness.Pauses);               // every request but the first is spaced
        var brand = await harness.Catalog.GetBrandAsync("acme", CancellationToken.None);
        Assert.Equal(("Acme", "https://shop.acme.example", AffiliateSource.Direct), (brand!.Name, brand.WebsiteUrl, brand.Source));
        var dress = await harness.Catalog.GetProductAsync("acme-a-100", CancellationToken.None);
        Assert.Equal((199990L, 249900L, CatalogSegment.Women), (dress!.PriceMinor, dress.PreviousPriceMinor, dress.Segment));
        Assert.Contains("### import-brand acme women", harness.Summary());
    }

    [Fact]
    public async Task Run_MenAfterWomen_KeepsTheSegmentsApart()
    {
        var harness = AcmeShop();
        await harness.RunAsync();

        var (exit, men) = await harness.RunAsync(CatalogSegment.Men);

        Assert.Equal(0, exit);
        Assert.False(men.BrandCreated);                                          // the brand exists since the women's run
        Assert.Equal(2, men.Imported);
        Assert.Empty(men.NotTouched);                                            // the women's dress is not this run's business
        Assert.Equal(CatalogSegment.Men, (await harness.Catalog.GetProductAsync("acme-m-200", CancellationToken.None))!.Segment);
        Assert.Equal(["acme-a-100", "acme-m-200", "acme-s-300"], (await harness.Catalog.GetProductsAsync(CancellationToken.None)).Select(p => p.Id).Order());

        var (_, again) = await harness.RunAsync(CatalogSegment.Men);
        Assert.Equal((0, 0, 2), (again.Imported, again.Updated, again.Unchanged));
    }

    [Fact]
    public async Task Run_DiscoveryRefused_StopsBeforeAnyProductPage()
    {
        var harness = AcmeShop();
        harness.Site.Pages[Url("/list-1")] = new SourceResponse(429, null, "HTTP 429");

        var (exit, result) = await harness.RunAsync();

        Assert.Equal(1, exit);
        Assert.Equal(0, result.PagesFetched);
        Assert.Equal([AcmeSource.IndexUrl, Url("/list-1")], harness.Site.Requests);   // not even the second listing
        Assert.Empty(await harness.Catalog.GetProductsAsync(CancellationToken.None));
        Assert.Null(await harness.Catalog.GetBrandAsync("acme", CancellationToken.None));
        Assert.Contains("Discovery failed", harness.Summary());
    }

    [Fact]
    public async Task Run_UnreadablePages_AreReported_AndTenInARowStopTheRun()
    {
        var harness = new Harness();
        var lines = Enumerable.Range(1, 15).Select(i => $"{Url($"/dresses/d-{i:000}")}|D-{i:000}|dresses").ToList();
        harness.Site.Pages[AcmeSource.IndexUrl] = new SourceResponse(200, Url("/list-1"));
        harness.Site.Pages[Url("/list-1")] = new SourceResponse(200, string.Join('\n', lines));
        foreach (var i in Enumerable.Range(1, 15))
            harness.Site.Pages[Url($"/dresses/d-{i:000}")] = new SourceResponse(200, "<html>new layout</html>");

        var (exit, result) = await harness.RunAsync();

        Assert.Equal(1, exit);
        Assert.Equal((10, 10, 0), (result.PagesFetched, result.ParseErrors, result.Kept));
        Assert.Contains("unreadable pages", result.Stopped);
    }

    // ── registry, --list, arguments ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registry_EverySourceIsWellFormed()
    {
        Assert.NotEmpty(BrandSources.All);
        Assert.Equal(BrandSources.All.Count, BrandSources.All.Select(s => s.BrandId).Distinct().Count());
        Assert.All(BrandSources.All, source =>
        {
            Assert.True(StoreInputRules.IsId(source.BrandId), source.BrandId);
            Assert.Same(source, BrandSources.Find(source.BrandId));
            Assert.NotEmpty(source.Segments);
            Assert.All(source.Segments, segment => Assert.True(segment is CatalogSegment.Women or CatalogSegment.Men));
            Assert.All(source.Segments, segment => Assert.NotEmpty(source.CategorySlugs(segment)));
            Assert.All(source.Segments, segment => Assert.Equal(source.CategorySlugs(segment).Count, source.CategorySlugs(segment).Select(s => s.Slug).Distinct().Count()));
            Assert.True(source.Access.Allows(source.WebsiteUrl + "/"), source.WebsiteUrl);
            Assert.NotEmpty(source.Access.DisallowedPathPrefixes);
            Assert.InRange(source.MaxDiscoveryRequests, 1, 10);
            Assert.All(source.ExtraColors, pair => Assert.True(ColorCatalog.IsKnown(pair.Value), pair.Value));
            Assert.DoesNotContain(BrandSources.Surveyed, b => b.Id == source.BrandId);   // a brand is either built or on the survey list
        });
        Assert.Equal(["vakko", "gap", "sarar", "beymen"], BrandSources.All.Select(s => s.BrandId));
        Assert.Null(BrandSources.Find("zara"));                                 // blocked: surveyed, no source
        Assert.Null(BrandSources.Find(null));
        Assert.Equal(BrandSources.Surveyed.Count, BrandSources.Surveyed.Select(b => b.Id).Distinct().Count());
    }

    [Fact]
    public void List_PrintsTheSourcesAndTheSurveyedBrands_WithoutTheNetwork()
    {
        var output = new OpsOutput(Path.Combine(Path.GetTempPath(), "ops-import-brand-list-" + Guid.NewGuid().ToString("N")));

        Assert.Equal(0, ImportBrandCommand.List(output));

        output.Flush();
        var summary = File.ReadAllText(Path.Combine(output.Directory, "summary.md"));
        Assert.Contains("| vakko | Vakko | https://www.vakko.com | women, men | ready | --brand vakko |", summary);
        Assert.Contains("| zara | Zara | zara.com/tr | women, men | no source | blocked for automated access", summary);
        Assert.Contains("| gap | Gap | https://gap.com.tr | women, men | ready | --brand gap |", summary);
        Assert.Contains("| sarar | Sarar | https://sarar.com | men, women | ready | --brand sarar |", summary);
        Assert.Contains("| beymen | Beymen | https://www.beymen.com | women, men | ready | --brand beymen |", summary);
    }

    [Fact]
    public void Arguments_ImportBrand_NeedsARegisteredBrandAndASegment()
    {
        var (args, error) = OpsArguments.Parse(["import-brand", "--stage", "dev", "--brand", "Vakko", "--segment", "men", "--max", "50", "--dry-run"]);

        Assert.Null(error);
        Assert.Equal(("vakko", CatalogSegment.Men, 50, 400, 1200, true), (args!.ImportBrandId, args.ImportSegment, args.ImportMaxProducts, args.ImportMaxPages, args.ImportDelayMs, args.DryRun));
        Assert.Contains(OpsArguments.ImportBrand, OpsArguments.DevOnly);
        Assert.Contains("refused on prod", OpsArguments.Parse(["import-brand", "--stage", "prod", "--brand", "vakko", "--segment", "women"]).Error);
    }

    [Theory]
    [InlineData("--segment", "women")]                                   // no brand
    [InlineData("--brand", "vakko")]                                     // no segment
    [InlineData("--brand", "zara", "--segment", "women")]                // surveyed, not built
    [InlineData("--brand", "vakko", "--segment", "kids")]
    [InlineData("--brand", "vakko", "--segment", "unisex")]
    [InlineData("--brand", "vakko", "--segment", "women", "--max", "201")]
    [InlineData("--brand", "vakko", "--segment", "women", "--max-pages", "601")]
    [InlineData("--brand", "vakko", "--segment", "women", "--delay-ms", "999")]
    [InlineData("--brand", "vakko", "--segment", "women", "--url", "https://example.com")]
    [InlineData("--list", "--brand", "vakko")]
    [InlineData("--list", "--dry-run")]
    public void Arguments_ImportBrand_RefusesTheRest(params string[] rest)
    {
        var (args, error) = OpsArguments.Parse(["import-brand", "--stage", "dev", .. rest]);

        Assert.Null(args);
        Assert.NotNull(error);
    }

    [Fact]
    public void Arguments_List_NeedsNothingElse_AndTheAliasTakesASegment()
    {
        Assert.True(OpsArguments.Parse(["import-brand", "--stage", "dev", "--list"]).Arguments!.Flag("list"));

        var (men, error) = OpsArguments.Parse(["import-vakko", "--stage", "dev", "--segment", "men"]);
        Assert.Null(error);
        Assert.Equal(("vakko", CatalogSegment.Men), (men!.ImportBrandId, men.ImportSegment));
        Assert.Equal(CatalogSegment.Women, OpsArguments.Parse(["import-vakko", "--stage", "dev"]).Arguments!.ImportSegment);
        Assert.NotNull(OpsArguments.Parse(["import-vakko", "--stage", "dev", "--segment", "kids"]).Error);
        Assert.NotNull(OpsArguments.Parse(["import-vakko", "--stage", "dev", "--brand", "vakko"]).Error);
        Assert.NotNull(OpsArguments.Parse(["import-vakko", "--stage", "dev", "--list"]).Error);
    }
}
