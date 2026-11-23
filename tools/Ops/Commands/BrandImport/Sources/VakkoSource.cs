using System.Text.RegularExpressions;
using System.Xml;
using Domain.Enum;
using Ops.Commands.BrandImport.Platforms;

namespace Ops.Commands.BrandImport.Sources;

/// <summary>
/// vakko.com (SAP Commerce / Spartacus). Discovery: the public product sitemap, one request (≈ 35 MB, every product of
/// the site with its images). Product page: server-rendered, the app state in an ng-state script
/// (<see cref="SpartacusStateParser"/>) with price, list price, sizes with stock, gender and brand. robots.txt allows
/// product pages and the sitemap and disallows the account / basket / search / filter URLs: no URL with a query
/// string is ever requested, and the storefront's account / basket / search / API routes are denied by prefix as a
/// second net. Images are hot-linked from cdn.vakko.com, never copied.
/// </summary>
internal sealed partial class VakkoSource : BrandCatalogSource
{
    public const string SitemapUrl = "https://www.vakko.com/sitemap/Product.xml";
    public const string ImageHost = "cdn.vakko.com";
    public static readonly TimeSpan SitemapTimeout = TimeSpan.FromSeconds(120);   // ≈ 35 MB uncompressed

    /// <summary>
    /// Size asked from the image CDN (https://cdn.vakko.com/mnresize/{x}/{y}/…): ≈100 KB per image instead of ≈480 KB
    /// for the 2000×3000 of the sitemap.
    /// </summary>
    public const int ImageWidth = 800;
    public const int ImageHeight = 1200;

    public override string BrandId => "vakko";
    public override string DisplayName => "Vakko";
    public override string WebsiteUrl => "https://www.vakko.com";
    public override IReadOnlyList<CatalogSegment> Segments { get; } = [CatalogSegment.Women, CatalogSegment.Men];
    public override PriceBand PriceBand => PriceBand.LuxuryTouch;

    public override SourceAccess Access { get; } = new(
        Hosts: ["www.vakko.com"],
        DisallowedPathPrefixes: ["/my-account", "/login", "/logout", "/register", "/cart", "/checkout", "/search", "/wishlist", "/occ/"]);

    protected override IReadOnlyList<string> ImageHosts { get; } = [ImageHost];

    // ── discovery ───────────────────────────────────────────────────────────────────────────────────────────────

    [GeneratedRegex(@"^https://www\.vakko\.com/(?<category>[a-z0-9-]+)/(?<name>[a-z0-9-]+)-p-(?<code>[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)$")]
    private static partial Regex ProductUrl();

    /// <summary>/{category-slug}/{name-slug}-p-{CODE} → a candidate; anything else is not a product URL of the site.</summary>
    public static SourceCandidate? ParseUrl(string? url, IReadOnlyList<string>? images = null)
    {
        var match = ProductUrl().Match(url?.Trim() ?? "");
        if (!match.Success)
            return null;
        var code = match.Groups["code"].Value;
        // "M406937101-0041" → "M406937101": the colours of one model share it.
        var model = code.IndexOf('-', StringComparison.Ordinal) is var dash and > 0 ? code[..dash] : code;
        return new SourceCandidate(match.Value, code, match.Groups["category"].Value, match.Groups["name"].Value, images ?? [], model);
    }

    /// <summary>Product sitemap → candidates. Pure: anything that is not a vakko.com product URL is dropped.</summary>
    public static IReadOnlyList<SourceCandidate> ParseSitemap(string xml) =>
        SitemapXml.Parse(xml).Select(u => ParseUrl(u.Loc, u.Images)).OfType<SourceCandidate>().ToList();

    public override async Task<SourceDiscovery> DiscoverAsync(PoliteFetcher site, CatalogSegment segment, CancellationToken ct)
    {
        var sitemap = await site.GetAsync(SitemapUrl, SitemapTimeout, ct);
        if (!sitemap.Ok)
            return SourceDiscovery.Failed($"sitemap: {sitemap.Error ?? "empty"}");
        try
        {
            var candidates = ParseSitemap(sitemap.Body!);
            return new SourceDiscovery(candidates, $"Sitemap: {candidates.Count} products");
        }
        catch (XmlException ex)
        {
            return SourceDiscovery.Failed($"sitemap: not XML ({ex.Message})");
        }
    }

    // ── product page ────────────────────────────────────────────────────────────────────────────────────────────

    public override SourceProduct? ParseProduct(string body, SourceCandidate candidate, out string? error)
    {
        var page = SpartacusStateParser.Parse(body, candidate.Code, out error);
        return page is null ? null : ToSourceProduct(page, candidate);
    }

    /// <summary>The platform's raw product → the neutral one. "style" is the exact colour ("Bordo"), "color" its family ("KIRMIZI").</summary>
    public static SourceProduct ToSourceProduct(SpartacusProduct page, SourceCandidate candidate) => new(
        page.Code,
        page.Name,
        page.DescriptionHtml,
        page.Material,
        GenderOf(page.Gender, page.CategoryNames),
        page.Brand,
        candidate.CategoryHint,
        new[] { page.Style, page.Color }.OfType<string>().ToList(),
        page.Sizes,
        page.Price,
        page.StrikePrice,
        page.Currency,
        page.ImageTemplates.Count > 0 ? page.ImageTemplates : candidate.Images,
        candidate.Url,
        page.InStock);

    /// <summary>The page's "gender" (Kadın | Erkek | Unisex | …); without it, the category path (… › Kadın › …).</summary>
    public static SourceGender GenderOf(string? gender, IReadOnlyList<string> categoryNames)
    {
        if (!string.IsNullOrWhiteSpace(gender))
        {
            return SourceText.Fold(gender) switch
            {
                "kadin" => SourceGender.Women,
                "erkek" => SourceGender.Men,
                "unisex" => SourceGender.Unisex,
                var other when other.Contains("cocuk", StringComparison.Ordinal) || other.Contains("bebek", StringComparison.Ordinal) => SourceGender.Kids,
                _ => SourceGender.Unknown,
            };
        }
        var path = categoryNames.Select(SourceText.Fold).ToList();
        if (path.Any(c => c.Contains("cocuk", StringComparison.Ordinal) || c.Contains("bebek", StringComparison.Ordinal)))
            return SourceGender.Kids;
        var (women, men) = (path.Contains("kadin"), path.Contains("erkek"));
        return (women, men) switch
        {
            (true, false) => SourceGender.Women,
            (false, true) => SourceGender.Men,
            (true, true) => SourceGender.Unisex,
            _ => SourceGender.Unknown,
        };
    }

    // ── categories ──────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Category slugs of the real sitemap (2026-11-23) → catalog category. Order matters inside a category: slugs
    /// that hold women's products only come first. Several slugs are shared with men (pantolon, triko, gomlek, ceket,
    /// t-shirt, mont, sneaker, bot, canta …): the page's gender decides. "yagmurluk" and "bel-cantasi" were added after a
    /// product page of each showed a women's product. Left out on purpose: accessories, home, and the catch-alls
    /// "giyim" / "ayakkabi-canta".
    /// </summary>
    public static readonly IReadOnlyList<(string Slug, ProductCategory Category)> WomenSlugs =
    [
        ("elbise", ProductCategory.Dress), ("elbise-tulum", ProductCategory.Dress), ("kokteyl-elbise", ProductCategory.Dress), ("tulum", ProductCategory.Dress),
        ("bluz", ProductCategory.Blouse), ("gomlek-bluz", ProductCategory.Blouse),
        ("gomlek", ProductCategory.Shirt),
        ("triko", ProductCategory.Knitwear),
        ("t-shirt", ProductCategory.Tshirt), ("t-shirt-sweatshirt", ProductCategory.Tshirt),
        ("sweatshirt", ProductCategory.Sweatshirt),
        ("ceket", ProductCategory.Jacket), ("yelek", ProductCategory.Jacket), ("mont", ProductCategory.Jacket), ("mont-kaban", ProductCategory.Jacket),
        ("palto-kaban", ProductCategory.Coat), ("palto", ProductCategory.Coat), ("kaban", ProductCategory.Coat), ("trenckot", ProductCategory.Coat),
        ("pardosu", ProductCategory.Coat), ("kurk", ProductCategory.Coat), ("yagmurluk", ProductCategory.Coat),
        ("pantolon-jean-pantolon", ProductCategory.Trousers), ("pantolon", ProductCategory.Trousers),
        ("jean-pantolon", ProductCategory.Jeans),
        ("etek", ProductCategory.Skirt),
        ("bermuda-sort", ProductCategory.Shorts),
        ("topuklu-ayakkabi", ProductCategory.Shoes), ("loafer-babet", ProductCategory.Shoes), ("sandalet-terlik", ProductCategory.Shoes),
        ("cizme", ProductCategory.Shoes), ("bot", ProductCategory.Shoes), ("sneaker", ProductCategory.Shoes), ("ayakkabi", ProductCategory.Shoes),
        ("spor-ayakkabi", ProductCategory.Shoes), ("espadril", ProductCategory.Shoes),
        ("el-cantasi", ProductCategory.Bag), ("omuz-cantasi", ProductCategory.Bag), ("abiye-canta", ProductCategory.Bag), ("canta", ProductCategory.Bag),
        ("portfoy", ProductCategory.Bag), ("portfoy-canta", ProductCategory.Bag), ("sirt-cantasi", ProductCategory.Bag), ("bel-cantasi", ProductCategory.Bag),
        ("mayo-bikini", ProductCategory.Swimwear), ("bikini-takim", ProductCategory.Swimwear), ("mayo", ProductCategory.Swimwear),
    ];

    /// <summary>
    /// Men: the men-only slugs first (loafer-mokasen, klasik-ayakkabi, terlik, evrak-cantasi, erkek), then the ones
    /// shared with women — the page's gender decides. Checked against the live sitemap on 2026-11-23 (21 924 product
    /// URLs, 181 slugs): every slug below is in it, and one product page of each doubtful slug was read — loafer-mokasen,
    /// klasik-ayakkabi, terlik, evrak-cantasi and "erkek" (two leather bags filed under the department's own slug) are
    /// men's; "mayo" holds men's swim shorts and women's swimsuits. Left out on purpose: suits and tuxedos
    /// (takim-elbise, smokin: the catalog has no suit category), ties and other accessories (kravat, papyon, kemer,
    /// cuzdan, kol-dugmesi …), home, and the catch-alls "giyim" / "ayakkabi-canta".
    /// </summary>
    public static readonly IReadOnlyList<(string Slug, ProductCategory Category)> MenSlugs =
    [
        ("gomlek", ProductCategory.Shirt),
        ("triko", ProductCategory.Knitwear),
        ("t-shirt", ProductCategory.Tshirt), ("t-shirt-sweatshirt", ProductCategory.Tshirt),
        ("sweatshirt", ProductCategory.Sweatshirt),
        ("ceket", ProductCategory.Jacket), ("yelek", ProductCategory.Jacket), ("mont", ProductCategory.Jacket), ("mont-kaban", ProductCategory.Jacket),
        ("palto-kaban", ProductCategory.Coat), ("palto", ProductCategory.Coat), ("kaban", ProductCategory.Coat), ("trenckot", ProductCategory.Coat),
        ("pardosu", ProductCategory.Coat), ("yagmurluk", ProductCategory.Coat),
        ("pantolon-jean-pantolon", ProductCategory.Trousers), ("pantolon", ProductCategory.Trousers),
        ("jean-pantolon", ProductCategory.Jeans),
        ("bermuda-sort", ProductCategory.Shorts),
        ("loafer-mokasen", ProductCategory.Shoes), ("klasik-ayakkabi", ProductCategory.Shoes), ("terlik", ProductCategory.Shoes), ("sneaker", ProductCategory.Shoes),
        ("bot", ProductCategory.Shoes), ("ayakkabi", ProductCategory.Shoes), ("spor-ayakkabi", ProductCategory.Shoes), ("sandalet-terlik", ProductCategory.Shoes),
        ("espadril", ProductCategory.Shoes),
        ("evrak-cantasi", ProductCategory.Bag), ("erkek", ProductCategory.Bag), ("postaci-cantasi", ProductCategory.Bag), ("canta", ProductCategory.Bag),
        ("sirt-cantasi", ProductCategory.Bag), ("portfoy-canta", ProductCategory.Bag), ("bel-cantasi", ProductCategory.Bag),
        ("mayo", ProductCategory.Swimwear),
    ];

    public override IReadOnlyList<(string Slug, ProductCategory Category)> CategorySlugs(CatalogSegment segment) =>
        segment == CatalogSegment.Men ? MenSlugs : WomenSlugs;

    // ── images ──────────────────────────────────────────────────────────────────────────────────────────────────

    [GeneratedRegex(@"/mnresize/(\{x\}|\d+)/(\{y\}|\d+)/")]
    private static partial Regex ResizeSegment();

    /// <summary>".../mnresize/{x}/{y}/868….jpg?v=…" (page) or ".../mnresize/2000/3000/…" (sitemap) → the hot-link at the import's size.</summary>
    public override string? ImageUrl(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;
        var url = ResizeSegment().Replace(raw.Trim(), $"/mnresize/{ImageWidth}/{ImageHeight}/", 1);
        return url.Contains('{', StringComparison.Ordinal) ? null : base.ImageUrl(url);
    }
}
