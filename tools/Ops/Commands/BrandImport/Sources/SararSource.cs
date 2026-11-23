using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;
using System.Xml;
using Domain.Enum;
using Ops.Commands.BrandImport.Platforms;

namespace Ops.Commands.BrandImport.Sources;

/// <summary>
/// sarar.com (T-Soft). Discovery: the public product sitemap, one request (5 822 URLs with one image each on
/// 2026-11-23; menswear, the "Sarar Woman" line and home textiles together). A product URL is /{slug} with neither a
/// category nor a gender: the category word comes from the slug (<see cref="SourceCategories"/>) and, on the page,
/// from the JSON-LD category path ("Erkek &gt; Gömlek &gt; Pamuklu Gömlek"), whose first part is the gender.
/// Product page: server-rendered. JSON-LD <c>Product</c> (in "@graph") gives name, price (TRY), availability, brand
/// and images; the sizes with their stock are the page's variant links (data-group-id="2", data-instock) of this
/// product — the "similar products" strip carries the same markup for other products and is ignored by product id.
/// robots.txt (read 2026-11-23): product pages and the sitemap are allowed; the search, basket, member and service
/// (/srv/service/) routes are not, and neither is any URL that contains "arama", "price", "type1", "type2",
/// "brand", "stock", "new" or "discounted" — such product URLs are left out. The file also asks automated clients
/// for "a truthful User-Agent": this source says it is an importer instead of sending the tool's plain browser
/// string. Images are hot-linked from witcdn.sarar.com.
/// </summary>
internal sealed partial class SararSource : BrandCatalogSource
{
    public const string SitemapUrl = "https://www.sarar.com/xml/sitemap/product.xml";
    public const string ImageHost = "witcdn.sarar.com";
    /// <summary>What sarar.com's robots.txt asks for: no browser disguise, no project or contact detail either.</summary>
    public const string UserAgent = "catalog-import-bot/1.0 (automated product importer)";

    /// <summary>robots.txt "Disallow: /x" lines: plain prefixes of the path (they also cover /x-anything).</summary>
    public static readonly IReadOnlyList<string> RobotsPrefixes =
    [
        "/AsiriYogunluk.php", "/ajax.php", "/Cache/GelismisVitrin/", "/uye-kayit", "/uye-girisi-sayfasi", "/sepet", "/musteri-hizmetleri",
        "/teslimat-kosullari", "/uyelik-sozlesmesi", "/satis-sozlesmesi", "/garanti-ve-iade-kosullari", "/gizlilik-ve-guvenlik", "/SecCode.php", "/srv/",
    ];

    /// <summary>robots.txt "Disallow: *x" lines: anywhere in the URL.</summary>
    public static readonly IReadOnlyList<string> RobotsFragments = ["arama", "price", "type1", "type2", "brand", "stock", "new", "discounted", "/srv/service/"];

    public override string BrandId => "sarar";
    public override string DisplayName => "Sarar";
    public override string WebsiteUrl => "https://sarar.com";
    public override IReadOnlyList<CatalogSegment> Segments { get; } = [CatalogSegment.Men, CatalogSegment.Women];
    public override PriceBand PriceBand => PriceBand.HighStreet;
    public override bool TitleCaseNames => false;   // "Sosa Uzun Kol Beyaz Gömlek"

    public override SourceAccess Access { get; } = new(Hosts: ["sarar.com", "www.sarar.com"], DisallowedPathPrefixes: RobotsPrefixes)
    {
        DisallowedFragments = RobotsFragments,
        UserAgent = UserAgent,
    };

    protected override IReadOnlyList<string> ImageHosts { get; } = [ImageHost];

    // ── discovery ───────────────────────────────────────────────────────────────────────────────────────────────

    [GeneratedRegex(@"^https://sarar\.com/(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)$")]
    private static partial Regex ProductUrl();

    /// <summary>
    /// /{slug} → a candidate whose code is the slug (the number many slugs end with is not the product's id); null for
    /// anything else and for a URL robots.txt disallows.
    /// </summary>
    public static SourceCandidate? ParseUrl(string? url, IReadOnlyList<string>? images = null)
    {
        var match = ProductUrl().Match(url?.Trim() ?? "");
        if (!match.Success)
            return null;
        var path = "/" + match.Groups["slug"].Value;
        if (RobotsPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase)) || RobotsFragments.Any(f => path.Contains(f, StringComparison.OrdinalIgnoreCase)))
            return null;
        var slug = match.Groups["slug"].Value;
        return new SourceCandidate(match.Value, slug, SourceCategories.Hint(slug) ?? "", slug, images ?? []);
    }

    public static IReadOnlyList<SourceCandidate> ParseSitemap(string xml) =>
        SitemapXml.Parse(xml).Select(u => ParseUrl(u.Loc, u.Images)).OfType<SourceCandidate>().ToList();

    public override async Task<SourceDiscovery> DiscoverAsync(PoliteFetcher site, CatalogSegment segment, CancellationToken ct)
    {
        var sitemap = await site.GetAsync(SitemapUrl, TimeSpan.FromSeconds(60), ct);
        if (!sitemap.Ok)
            return SourceDiscovery.Failed($"sitemap: {sitemap.Error ?? "empty"}");
        try
        {
            var candidates = ParseSitemap(sitemap.Body!);
            return new SourceDiscovery(candidates, $"Sitemap: {candidates.Count} products (clothing and home together)");
        }
        catch (XmlException ex)
        {
            return SourceDiscovery.Failed($"sitemap: not XML ({ex.Message})");
        }
    }

    // ── product page ────────────────────────────────────────────────────────────────────────────────────────────

    [GeneratedRegex(@"<a\b(?<attributes>[^>]*\bdata-toggle=""variant""[^>]*)>", RegexOptions.Singleline)]
    private static partial Regex VariantLink();

    [GeneratedRegex(@"\bdata-(?<name>[a-z-]+)\s*=\s*""(?<value>[^""]*)""", RegexOptions.Singleline)]
    private static partial Regex DataAttribute();

    [GeneratedRegex(@"class=""product-price-not-discounted"">\s*(?<price>[0-9.]+(?:,[0-9]+)?)\s*<")]
    private static partial Regex ListPrice();

    [GeneratedRegex(@"<div id=""product-fullbody""[^>]*>(?<html>.*?)</div>", RegexOptions.Singleline)]
    private static partial Regex FullBody();

    [GeneratedRegex(@"<strong>\s*Karışım:\s*</strong>\s*(?<text>[^<]+)")]
    private static partial Regex Blend();

    [GeneratedRegex(@"^\d+\s+DROP\s+(?<size>\S+)$", RegexOptions.IgnoreCase)]
    private static partial Regex DropSize();

    public override SourceProduct? ParseProduct(string body, SourceCandidate candidate, out string? error)
    {
        var page = JsonLdProductParser.Parse(body, out error);
        if (page is null)
            return null;
        if (page.Url is { } url && !string.Equals(url.TrimEnd('/'), candidate.Url, StringComparison.OrdinalIgnoreCase))
        {
            error = "another product";
            return null;
        }

        var (colours, sizes) = Variants(body, page.ProductId);
        var price = page.Price;
        var list = StruckPrice(body);
        return new SourceProduct(
            candidate.Code,
            page.Name,
            FullBody().Match(body) is { Success: true } text ? text.Groups["html"].Value : page.Description,
            Blend().Match(body) is { Success: true } blend ? WebUtility.HtmlDecode(blend.Groups["text"].Value).Trim() : null,
            GenderOf(page.Category, page.Brand),
            page.Brand,
            SourceCategories.HintOf(page.Category, candidate.CategoryHint),
            colours,
            sizes,
            price,
            list,
            page.Currency,
            page.Images.Count > 0 ? page.Images : candidate.Images,
            candidate.Url,
            sizes.Count > 0 ? sizes.Any(s => s.InStock) : page.InStock == true);
    }

    /// <summary>
    /// The price the page strikes through ("13.999,99"), read from the product's own price block only — the first
    /// "price-wrapper" of the page, up to its current price; the cards of other products further down have theirs.
    /// </summary>
    public static decimal? StruckPrice(string html)
    {
        var start = html?.IndexOf("class=\"price-wrapper\"", StringComparison.Ordinal) ?? -1;
        if (start < 0)
            return null;
        var end = html!.IndexOf("product-current-price", start, StringComparison.Ordinal);
        var block = html[start..(end < 0 ? Math.Min(html.Length, start + 800) : end)];
        return ListPrice().Match(block) is { Success: true } struck
               // "13.999,99": Turkish grouping and decimal marks, read without depending on the machine's culture data
               && decimal.TryParse(struck.Groups["price"].Value.Replace(".", "", StringComparison.Ordinal).Replace(',', '.'), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var value)
            ? value
            : null;
    }

    /// <summary>
    /// The variant links of THIS product (data-pid = the JSON-LD productID; other products' links in the "similar
    /// products" strip are dropped): group 1 = the colour, group 2 = the sizes, in stock when data-instock="1" (the main
    /// product's attribute) or, without it, when data-stock &gt; 0.
    /// </summary>
    public static (IReadOnlyList<string> Colours, IReadOnlyList<SourceSize> Sizes) Variants(string html, string? productId)
    {
        var colours = new List<string>();
        var sizes = new List<SourceSize>();
        foreach (Match link in VariantLink().Matches(html ?? ""))
        {
            var data = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (Match attribute in DataAttribute().Matches(link.Groups["attributes"].Value))
                data.TryAdd(attribute.Groups["name"].Value, WebUtility.HtmlDecode(attribute.Groups["value"].Value).Trim());
            if (productId is null || data.GetValueOrDefault("pid") != productId || data.GetValueOrDefault("type") is not { Length: > 0 } label)
                continue;
            if (data.GetValueOrDefault("group-id") == "1")
            {
                if (!colours.Contains(label))
                    colours.Add(label);
                continue;
            }
            if (data.GetValueOrDefault("group-id") != "2" || sizes.Any(s => s.Label == SizeLabel(label)))
                continue;
            var inStock = data.TryGetValue("instock", out var flag)
                ? flag == "1"
                : int.TryParse(data.GetValueOrDefault("stock"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var count) && count > 0;
            sizes.Add(new SourceSize(SizeLabel(label), inStock));
        }
        return (colours, sizes);
    }

    /// <summary>Jackets and coats are sized "6 DROP 48" (the drop, then the size): the size is what the catalog keeps.</summary>
    public static string SizeLabel(string label) => DropSize().Match(label.Trim()) is { Success: true } drop ? drop.Groups["size"].Value : label.Trim();

    /// <summary>The first part of the category path ("Erkek &gt; …", "Kadın &gt; …"); without one, the "Sarar Woman" label. Children's and home paths are neither.</summary>
    public static SourceGender GenderOf(string? categoryPath, string? brand)
    {
        var first = SourceText.Fold((categoryPath ?? "").Split('>')[0]);
        if (first.Contains("cocuk", StringComparison.Ordinal))
            return SourceGender.Kids;
        return first switch
        {
            "erkek" => SourceGender.Men,
            "kadin" => SourceGender.Women,
            "" when SourceText.Fold(brand).Contains("woman", StringComparison.Ordinal) => SourceGender.Women,
            _ => SourceGender.Unknown,
        };
    }

    // ── the brand's tables ──────────────────────────────────────────────────────────────────────────────────────

    public override IReadOnlyList<(string Slug, ProductCategory Category)> CategorySlugs(CatalogSegment segment) => SourceCategories.For(segment);

    /// <summary>The labels seen on sarar.com (2026-11-23): Sarar, Sarar Woman, Interview — all the company's own. Any other label is skipped until it is looked at.</summary>
    public override bool IsOwnBrand(string? brandName)
    {
        var brand = SourceText.Fold(brandName);
        return brand.Length == 0 || brand.StartsWith("sarar", StringComparison.Ordinal) || brand == "interview";
    }

    [GeneratedRegex(@"-[KOB]\.(?<extension>jpe?g|png|webp)$", RegexOptions.IgnoreCase)]
    private static partial Regex ImageTail();

    /// <summary>T-Soft image names end with the size: -K (small, the sitemap's), -O (medium, ≈ 450 px, JSON-LD's), -B (large, 1200×1800, the page's zoom) → the large one.</summary>
    public override string? ImageUrl(string? raw)
    {
        var url = raw?.Trim() ?? "";
        if (url.StartsWith("//", StringComparison.Ordinal))
            url = "https:" + url;
        return ImageTail().IsMatch(url) ? base.ImageUrl(ImageTail().Replace(url, m => $"-B.{m.Groups["extension"].Value}", 1)) : null;
    }
}
