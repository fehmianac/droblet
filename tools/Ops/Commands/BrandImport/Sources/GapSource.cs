using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using Domain.Enum;
using Ops.Commands.BrandImport.Platforms;

namespace Ops.Commands.BrandImport.Sources;

/// <summary>
/// gap.com.tr (Akinon). Discovery: the sitemap index of robots.txt, then the product sitemap(s) it names on the
/// store's bucket (2 332 URLs on 2026-11-23; the file was last written in April 2026, so many of its products are out
/// of season). A product URL is /{name}-{style}-{colour}/ and carries neither a category nor a gender: the category
/// word comes from the name (<see cref="SourceCategories"/>), the gender from the page — the sitemap mixes women, men,
/// children and babies, so a run fetches pages it then skips.
/// Product page: server-rendered. JSON-LD <c>Product</c> gives name, price (TRY), images, colour, material and gender
/// ("Cinsiyet"); the sizes with their stock are &lt;pz-variant-option value stock&gt; elements; the struck-through price
/// is the "price -retail" element; the description sits in the page's analytics block. The JSON-LD "availability" is
/// the colour's own stock and says OutOfStock for a product whose sizes can be bought — the sizes decide.
/// robots.txt disallows /login /list /baskets /orders /account /users and the sort / filter / search parameters; no
/// URL with a query string is requested. Images are hot-linked from the store's Akinon CDN.
/// </summary>
internal sealed partial class GapSource : BrandCatalogSource
{
    public const string SitemapIndexUrl = "https://gap.com.tr/sitemap.xml";
    public const string SitemapHost = "s3.eu-central-1.amazonaws.com";
    /// <summary>The store's own folder on the bucket host: nothing else of that host is ever requested.</summary>
    public const string SitemapPrefix = "https://s3.eu-central-1.amazonaws.com/8f7eaa/sitemaps/";
    public const string ImageHost = "8f7eaa-gap.akinoncloudcdn.com";
    /// <summary>The size the product page itself asks for its zoomable picture (…_size780x1186_cropCenter.jpg).</summary>
    public const string ImageSize = "_size780x1186_cropCenter";
    public const int MaxProductSitemaps = 3;

    public override string BrandId => "gap";
    public override string DisplayName => "Gap";
    public override string WebsiteUrl => "https://gap.com.tr";
    public override IReadOnlyList<CatalogSegment> Segments { get; } = [CatalogSegment.Women, CatalogSegment.Men];
    public override PriceBand PriceBand => PriceBand.HighStreet;
    public override int MaxDiscoveryRequests => 1 + MaxProductSitemaps;
    public override bool TitleCaseNames => false;   // "Oxford Boyfriend Gömlek"

    public override SourceAccess Access { get; } = new(
        Hosts: ["gap.com.tr", SitemapHost],
        DisallowedPathPrefixes: ["/login", "/list", "/baskets", "/orders", "/account", "/users", "/product", "/search", "/address", "/favourite-products"])
    {
        DisallowedFragments = ["sorter", "search_text", "attributes_integration_filter_color", "attributes_filter_size", "integration_size", "category_ids"],
    };

    protected override IReadOnlyList<string> ImageHosts { get; } = [ImageHost];

    // ── discovery ───────────────────────────────────────────────────────────────────────────────────────────────

    [GeneratedRegex(@"^https://gap\.com\.tr/(?<name>[a-z0-9]+(?:-[a-z0-9]+)*)-(?<style>\d{4,6})(?:-(?<colour>[a-z]+(?:-[a-z]+)*(?:-\d{1,3})?))?/$")]
    private static partial Regex ProductUrl();

    /// <summary>
    /// /{name}-{style}[-{colour}[-{n}]]/ → a candidate: code "{style}-{colour}-{n}" (one per colour page), model = the
    /// style, category hint = the last garment word of the name. Anything else is not a product URL of the site.
    /// </summary>
    public static SourceCandidate? ParseUrl(string? url)
    {
        var match = ProductUrl().Match(url?.Trim() ?? "");
        if (!match.Success)
            return null;
        var (name, style, colour) = (match.Groups["name"].Value, match.Groups["style"].Value, match.Groups["colour"].Value);
        return new SourceCandidate(match.Value, colour.Length == 0 ? style : $"{style}-{colour}", SourceCategories.Hint(name) ?? "", name, [], style);
    }

    public static IReadOnlyList<SourceCandidate> ParseSitemap(string xml) =>
        SitemapXml.Parse(xml).Select(u => ParseUrl(u.Loc)).OfType<SourceCandidate>().ToList();

    /// <summary>The product sitemaps of the index: only files of the store's own bucket folder.</summary>
    public static IReadOnlyList<string> ProductSitemaps(string indexXml) =>
        SitemapXml.ParseIndex(indexXml)
            .Where(u => u.StartsWith(SitemapPrefix, StringComparison.Ordinal) && u.Contains("/sitemap-products-", StringComparison.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .Take(MaxProductSitemaps)
            .ToList();

    public override async Task<SourceDiscovery> DiscoverAsync(PoliteFetcher site, CatalogSegment segment, CancellationToken ct)
    {
        var index = await site.GetAsync(SitemapIndexUrl, PageTimeout, ct);
        if (!index.Ok)
            return SourceDiscovery.Failed($"sitemap index: {index.Error ?? "empty"}");
        try
        {
            var files = ProductSitemaps(index.Body!);
            if (files.Count == 0)
                return SourceDiscovery.Failed("sitemap index: no product sitemap");
            var candidates = new List<SourceCandidate>();
            foreach (var file in files)
            {
                var sitemap = await site.GetAsync(file, TimeSpan.FromSeconds(60), ct);
                if (!sitemap.Ok)
                    return SourceDiscovery.Failed($"product sitemap: {sitemap.Error ?? "empty"}");
                candidates.AddRange(ParseSitemap(sitemap.Body!));
            }
            return new SourceDiscovery(candidates, $"Sitemap: {candidates.Count} products ({files.Count} file(s), every department)");
        }
        catch (XmlException ex)
        {
            return SourceDiscovery.Failed($"sitemap: not XML ({ex.Message})");
        }
    }

    // ── product page ────────────────────────────────────────────────────────────────────────────────────────────

    [GeneratedRegex(@"<pz-variant\b[^>]*\buse-size\b[^>]*>(?<options>.*?)</pz-variant>", RegexOptions.Singleline)]
    private static partial Regex SizeVariant();

    [GeneratedRegex(@"<pz-variant-option\b(?<attributes>[^>]*)>", RegexOptions.Singleline)]
    private static partial Regex VariantOption();

    [GeneratedRegex(@"\b(?<name>[a-z-]+)\s*=\s*""(?<value>[^""]*)""", RegexOptions.Singleline)]
    private static partial Regex Attribute();

    [GeneratedRegex("""<div class="price -retail[^"]*">\s*<pz-price>\s*(?<price>[0-9]+(?:\.[0-9]+)?)\s*</pz-price>""")]
    private static partial Regex RetailPrice();

    [GeneratedRegex("""class="analytics-data"[^>]*>(?<block>.*?)</div>""", RegexOptions.Singleline)]
    private static partial Regex AnalyticsBlock();

    public override SourceProduct? ParseProduct(string body, SourceCandidate candidate, out string? error)
    {
        var page = JsonLdProductParser.Parse(body, out error);
        if (page is null)
            return null;
        // The page of another product (a redirect to a category, a replaced URL) must not be imported under this code.
        if (page.Url is { } url && ParseUrl(url) is { } shown && !string.Equals(shown.ModelCode, candidate.ModelCode, StringComparison.Ordinal))
        {
            error = $"another product ({shown.Code})";
            return null;
        }

        // The page has several analytics blocks (identify, pageViewed …): the product's is the "productViewed" one.
        var analytics = AnalyticsBlock().Matches(body).Select(m => m.Groups["block"].Value).FirstOrDefault(b => b.Contains("productViewed", StringComparison.Ordinal)) ?? "";
        var sizes = Sizes(body);
        var list = RetailPrice().Match(body) is { Success: true } retail && decimal.TryParse(retail.Groups["price"].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var value)
            ? value
            : (decimal?)null;
        return new SourceProduct(
            candidate.Code,
            page.Name,
            Field(analytics, "dimension20"),
            page.Property("Materyal"),
            GenderOf(page.Property("Cinsiyet") ?? Field(analytics, "gender")),
            page.Brand,
            SourceCategories.Hint(page.Name) ?? candidate.CategoryHint,
            new[] { page.Property("Renk"), Field(analytics, "item_variant") }.OfType<string>().ToList(),
            sizes,
            page.Price,
            list,
            page.Currency,
            page.Images,
            candidate.Url,
            // The JSON-LD availability is the colour's own stock ("OutofStock" while its sizes sell): the sizes decide.
            sizes.Count > 0 ? sizes.Any(s => s.InStock) : page.InStock == true);
    }

    /// <summary>The first &lt;pz-variant use-size&gt; block (the page repeats it for the mobile layout): one entry per size, in stock when stock &gt; 0.</summary>
    public static IReadOnlyList<SourceSize> Sizes(string html)
    {
        var sizes = new List<SourceSize>();
        var block = SizeVariant().Match(html ?? "");
        if (!block.Success)
            return sizes;
        foreach (Match option in VariantOption().Matches(block.Groups["options"].Value))
        {
            var attributes = option.Groups["attributes"].Value;
            var values = Attribute().Matches(attributes).ToDictionary(a => a.Groups["name"].Value, a => WebUtility.HtmlDecode(a.Groups["value"].Value).Trim(), StringComparer.Ordinal);
            var label = values.GetValueOrDefault("label") is { Length: > 0 } text ? text : values.GetValueOrDefault("value");
            if (string.IsNullOrEmpty(label) || sizes.Any(s => s.Label == label))
                continue;
            var stock = int.TryParse(values.GetValueOrDefault("stock"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var count) ? count : 0;
            sizes.Add(new SourceSize(label, stock > 0 && !attributes.Contains("outoffstock", StringComparison.OrdinalIgnoreCase)));
        }
        return sizes;
    }

    /// <summary>One string field of the analytics block ("gender": "Kadın"), JSON-unescaped and HTML-decoded; null when missing or empty.</summary>
    private static string? Field(string analytics, string name)
    {
        var match = Regex.Match(analytics, "\"" + Regex.Escape(name) + "\"\\s*:\\s*(?<value>\"(?:[^\"\\\\]|\\\\.)*\")", RegexOptions.Singleline);
        if (!match.Success)
            return null;
        try
        {
            var text = WebUtility.HtmlDecode(JsonSerializer.Deserialize<string>(match.Groups["value"].Value))?.Trim();
            return string.IsNullOrEmpty(text) ? null : text;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>"kadin" | "erkek" | "kiz_cocuk" | "erkek_cocuk" | "Kız Çocuk" | "bebek" … — anything about children first.</summary>
    public static SourceGender GenderOf(string? gender)
    {
        var text = SourceText.Fold(gender).Replace('_', ' ');
        if (text.Length == 0)
            return SourceGender.Unknown;
        if (text.Contains("cocuk", StringComparison.Ordinal) || text.Contains("bebek", StringComparison.Ordinal) || text.Contains("baby", StringComparison.Ordinal)
            || text.Contains("kids", StringComparison.Ordinal) || text.Contains("toddler", StringComparison.Ordinal))
            return SourceGender.Kids;
        return text switch
        {
            "kadin" or "women" or "womens" => SourceGender.Women,
            "erkek" or "men" or "mens" => SourceGender.Men,
            "unisex" => SourceGender.Unisex,
            _ => SourceGender.Unknown,
        };
    }

    // ── categories / images ─────────────────────────────────────────────────────────────────────────────────────

    public override IReadOnlyList<(string Slug, ProductCategory Category)> CategorySlugs(CatalogSegment segment) => SourceCategories.For(segment);

    [GeneratedRegex(@"(?:_size\d+x\d+(?:_crop[A-Za-z]+)?)?\.(?<extension>jpe?g|png|webp)$", RegexOptions.IgnoreCase)]
    private static partial Regex ImageTail();

    /// <summary>"…/dd0504fb.jpg" (JSON-LD, the original) or "…_size448x640_cropCenter.jpg" → the hot-link at the page's own display size.</summary>
    public override string? ImageUrl(string? raw)
    {
        var url = raw?.Trim() ?? "";
        var query = url.IndexOf('?', StringComparison.Ordinal);
        if (query >= 0)
            url = url[..query];
        return ImageTail().IsMatch(url) ? base.ImageUrl(ImageTail().Replace(url, m => $"{ImageSize}.{m.Groups["extension"].Value}", 1)) : null;
    }
}
