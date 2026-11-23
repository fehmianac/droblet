using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using Domain.Enum;
using Ops.Commands.BrandImport.Platforms;

namespace Ops.Commands.BrandImport.Sources;

/// <summary>
/// beymen.com — a department store; only Beymen's own labels are imported (Beymen Club, Beymen Collection, Academia:
/// the three seen in the sitemaps and on product pages on 2026-11-23). Everything else on the site is another brand: the designers, the sister brands Network and
/// Divarese, and "Beymen Reborn", the second-hand resale of designer pieces.
/// Discovery: the sitemap index, then <see cref="SitemapFiles"/> of its product sitemaps spread evenly over the list
/// (26 files of 10 000 URLs / ≈ 5.5 MB on 2026-11-23 — reading all of them for one run would be 140 MB). A product URL
/// is /tr/p_{brand}-{name}_{id}: the slug starts with the label, so only own-label URLs become candidates; it has no
/// category and often no gender, so the category word comes from the slug (<see cref="SourceCategories"/>) and, on the
/// page, from the product's category; the gender from the page.
/// Product page: server-rendered; the state is the object assigned to <c>BEYMEN.productMain</c> (name, label, colour,
/// price, struck-through price, gender, category, material, images, sold-out flag); JSON-LD <c>Product</c> adds the
/// description and the availability. The sizes are loaded by the page's script from /api — which robots.txt
/// disallows — so a product is imported WITHOUT a size list, and only when the page says it can be bought.
/// robots.txt (read 2026-11-23): /tr/p_… and the sitemaps are allowed; /product/, /api, /cart, /home, /error, the
/// SEO content pages and the sort / season / menu parameters are not. Images are hot-linked from cdn.beymen.com.
/// </summary>
internal sealed partial class BeymenSource : BrandCatalogSource
{
    public const string SitemapIndexUrl = "https://www.beymen.com/tr/sitemap.xml";
    public const string ImageHost = "cdn.beymen.com";
    /// <summary>Product sitemaps read by one run (plus the index: <see cref="MaxDiscoveryRequests"/>).</summary>
    public const int SitemapFiles = 8;
    public static readonly TimeSpan SitemapTimeout = TimeSpan.FromSeconds(120);

    /// <summary>The image CDN resizes on request (the page asks …/mnresize/505/704/…): the same shape, 800 wide (checked: 800×1114, ≈ 65 KB).</summary>
    public const int ImageWidth = 800;
    public const int ImageHeight = 1115;

    /// <summary>The own labels as the URL slug starts with them …</summary>
    public static readonly IReadOnlyList<string> OwnSlugPrefixes = ["beymen-club-", "beymen-collection-", "academia-"];

    /// <summary>… and as the page states them (folded).</summary>
    public static readonly IReadOnlySet<string> OwnLabels = new HashSet<string>(StringComparer.Ordinal) { "beymen club", "beymen collection", "academia" };

    public override string BrandId => "beymen";
    public override string DisplayName => "Beymen";
    public override string WebsiteUrl => "https://www.beymen.com";
    public override IReadOnlyList<CatalogSegment> Segments { get; } = [CatalogSegment.Women, CatalogSegment.Men];
    public override PriceBand PriceBand => PriceBand.LuxuryTouch;
    public override int MaxDiscoveryRequests => 1 + SitemapFiles;
    public override bool TitleCaseNames => false;   // "Kahverengi Anvelop Kapama Midi Etek"

    public override SourceAccess Access { get; } = new(
        Hosts: ["www.beymen.com"],
        DisallowedPathPrefixes:
        [
            "/tr/cart", "/en/cart", "/cart", "/tr/product", "/en/product", "/product", "/tr/error", "/en/error", "/error",
            "/tr/home", "/en/home", "/home", "/tr/api", "/en/api", "/api", "/tr/content", "/en/content", "/content",
            "/tr/search", "/en/search", "/search", "/tr/account", "/en/account", "/account", "/tr/login", "/en/login", "/login", "/tr/customer", "/customer",
        ])
    {
        DisallowedFragments = ["yil-sezon", "year-season", "siralama", "menu=evet", "menu=yes"],
    };

    protected override IReadOnlyList<string> ImageHosts { get; } = [ImageHost];

    // ── discovery ───────────────────────────────────────────────────────────────────────────────────────────────

    [GeneratedRegex(@"^https://www\.beymen\.com/tr/p_(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)_(?<id>\d{1,9})$")]
    private static partial Regex ProductUrl();

    [GeneratedRegex(@"^https://www\.beymen\.com/tr/product_\d{1,3}\.xml$")]
    private static partial Regex ProductSitemapUrl();

    /// <summary>
    /// /tr/p_{slug}_{id} of an own label → a candidate (code = the id, category hint = the last garment word of the
    /// slug); null for every other label's product and for anything that is not a product URL.
    /// </summary>
    public static SourceCandidate? ParseUrl(string? url)
    {
        var match = ProductUrl().Match(url?.Trim() ?? "");
        if (!match.Success)
            return null;
        var slug = match.Groups["slug"].Value;
        if (!OwnSlugPrefixes.Any(p => slug.StartsWith(p, StringComparison.Ordinal)) || slug.Contains("yil-sezon", StringComparison.Ordinal))
            return null;
        return new SourceCandidate(match.Value, match.Groups["id"].Value, SourceCategories.Hint(slug) ?? "", slug, []);
    }

    public static IReadOnlyList<SourceCandidate> ParseSitemap(string xml) =>
        SitemapXml.Parse(xml).Select(u => ParseUrl(u.Loc)).OfType<SourceCandidate>().ToList();

    /// <summary>
    /// The product sitemaps of the index, <paramref name="count"/> of them spread evenly from the first to the last
    /// (26 files, 8 asked → 1, 5, 8, 12, 15, 19, 22, 26): deterministic, and no part of the store's id range is left out.
    /// </summary>
    public static IReadOnlyList<string> PickSitemaps(string indexXml, int count = SitemapFiles)
    {
        var files = SitemapXml.ParseIndex(indexXml).Where(u => ProductSitemapUrl().IsMatch(u)).Distinct(StringComparer.Ordinal).ToList();
        if (files.Count <= count)
            return files;
        return Enumerable.Range(0, count)
            .Select(i => files[(int)Math.Round(i * (files.Count - 1) / (double)(count - 1), MidpointRounding.AwayFromZero)])
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    public override async Task<SourceDiscovery> DiscoverAsync(PoliteFetcher site, CatalogSegment segment, CancellationToken ct)
    {
        var index = await site.GetAsync(SitemapIndexUrl, PageTimeout, ct);
        if (!index.Ok)
            return SourceDiscovery.Failed($"sitemap index: {index.Error ?? "empty"}");
        IReadOnlyList<string> files;
        try
        {
            files = PickSitemaps(index.Body!);
        }
        catch (XmlException ex)
        {
            return SourceDiscovery.Failed($"sitemap index: not XML ({ex.Message})");
        }
        if (files.Count == 0)
            return SourceDiscovery.Failed("sitemap index: no product sitemap");

        var candidates = new Dictionary<string, SourceCandidate>(StringComparer.Ordinal);
        var (read, urls) = (0, 0);
        foreach (var file in files)
        {
            var sitemap = await site.GetAsync(file, SitemapTimeout, ct);
            if (site.Stopped is not null)
                return SourceDiscovery.Failed($"product sitemap: {site.Stopped}");
            if (!sitemap.Ok)
                continue;   // one unreadable file is not the end of the run; three in a row stop the fetcher
            try
            {
                var entries = SitemapXml.Parse(sitemap.Body!);
                urls += entries.Count;
                foreach (var candidate in entries.Select(e => ParseUrl(e.Loc)).OfType<SourceCandidate>())
                    candidates.TryAdd(candidate.Code, candidate);
                read++;
            }
            catch (XmlException)
            {
            }
        }
        return read == 0
            ? SourceDiscovery.Failed("product sitemaps: none readable")
            : new SourceDiscovery(candidates.Values.ToList(), $"Sitemaps: {read} of {files.Count} read, {urls} products of every label, {candidates.Count} of Beymen's own labels");
    }

    // ── product page ────────────────────────────────────────────────────────────────────────────────────────────

    public const string StateMarker = "BEYMEN.productMain = ";

    public override SourceProduct? ParseProduct(string body, SourceCandidate candidate, out string? error)
    {
        error = null;
        using var state = PageJson.ValueAfter(body, StateMarker);
        if (state is null || state.RootElement.ValueKind != JsonValueKind.Object)
        {
            error = "no product state";
            return null;
        }
        var product = state.RootElement;
        var id = product.Text("productId");
        var name = product.Text("displayName");
        if (id is null || name is null)
        {
            error = "product without id or name";
            return null;
        }
        if (!string.Equals(id, candidate.Code, StringComparison.Ordinal))
        {
            error = $"another product ({id})";
            return null;
        }

        var tags = product.Child("tagParams") ?? default;
        var jsonLd = JsonLdProductParser.Parse(body, out _);   // optional: the description and a second word on the stock
        var price = product.Number("actualPrice") ?? tags.Number("salePrice") ?? jsonLd?.Price;
        var images = (product.Child("images") ?? default).Items("default").Where(i => i.ValueKind == JsonValueKind.String).Select(i => i.GetString()!).ToList();
        // A resale piece ("Beymen Reborn") is a designer's product, whatever label the page files it under.
        var brand = product.Flag("isPreOwned") == true ? "Beymen Reborn" : product.Text("brandName") ?? tags.Text("brand") ?? jsonLd?.Brand;
        var soldOut = product.Flag("isStockOutProduct") == true
                      || tags.Text("productStatus") is { } status && !status.Equals("in_stock", StringComparison.OrdinalIgnoreCase)
                      || jsonLd?.InStock == false;
        return new SourceProduct(
            id,
            name,
            jsonLd?.Description,
            tags.Text("component"),
            GenderOf(tags.Text("gender") ?? tags.Text("breadCrumbFirstCategory")),
            brand,
            SourceCategories.HintOf(tags.Text("category") ?? tags.Text("breadcrumbCategory"), candidate.CategoryHint),
            new[] { product.Text("colorName"), tags.Text("color") }.OfType<string>().ToList(),
            [],   // per-size stock is behind /api (disallowed): no size list
            price,
            tags.Number("productFirstPrice") ?? tags.Number("originalPrice"),
            tags.Text("currency") ?? jsonLd?.Currency,
            images.Count > 0 ? images : jsonLd?.Images ?? [],
            candidate.Url,
            !soldOut && (product.Flag("isStockOutProduct") == false || jsonLd?.InStock == true));
    }

    /// <summary>"Kadın" | "Erkek" | "Unisex" | "Kız Çocuk" | "Erkek Çocuk" | "Bebek" … — anything about children first.</summary>
    public static SourceGender GenderOf(string? gender)
    {
        var text = SourceText.Fold(gender);
        if (text.Contains("cocuk", StringComparison.Ordinal) || text.Contains("bebek", StringComparison.Ordinal))
            return SourceGender.Kids;
        return text switch
        {
            "kadin" => SourceGender.Women,
            "erkek" => SourceGender.Men,
            "unisex" => SourceGender.Unisex,
            _ => SourceGender.Unknown,
        };
    }

    // ── the brand's tables ──────────────────────────────────────────────────────────────────────────────────────

    public override IReadOnlyList<(string Slug, ProductCategory Category)> CategorySlugs(CatalogSegment segment) => SourceCategories.For(segment);

    /// <summary>A department store: a product without a stated label is NOT assumed to be Beymen's.</summary>
    public override bool IsOwnBrand(string? brandName) => OwnLabels.Contains(SourceText.Fold(brandName));

    [GeneratedRegex(@"^https://cdn\.beymen\.com/(?:mnresize/\d+/\d+/)?(?<path>productimages/[^?#\s]+)$", RegexOptions.IgnoreCase)]
    private static partial Regex ImagePath();

    /// <summary>"https://cdn.beymen.com/productimages/x.jpg" (the original) or "…/mnresize/505/704/productimages/x.jpg" → the hot-link at the import's size.</summary>
    public override string? ImageUrl(string? raw)
    {
        var url = raw?.Trim() ?? "";
        if (url.StartsWith("//", StringComparison.Ordinal))
            url = "https:" + url;
        return ImagePath().Match(url) is { Success: true } match
            ? base.ImageUrl($"https://{ImageHost}/mnresize/{ImageWidth}/{ImageHeight}/{match.Groups["path"].Value}")
            : null;
    }
}
