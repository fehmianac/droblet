using System.Text.RegularExpressions;
using System.Xml;
using Domain.Enum;
using Domain.Validation;

namespace Ops.Commands;

/// <summary>One &lt;url&gt; of https://www.vakko.com/sitemap/Product.xml: /{category-slug}/{name-slug}-p-{CODE} and its images.</summary>
internal sealed record VakkoSitemapEntry(string Url, string CategorySlug, string NameSlug, string Code, IReadOnlyList<string> Images)
{
    /// <summary>"M406937101-0041" → "M406937101": the colours of one model share it.</summary>
    public string BaseCode => Code.IndexOf('-', StringComparison.Ordinal) is var dash and > 0 ? Code[..dash] : Code;
}

/// <summary>Product sitemap → entries. Pure (no network): anything that is not a vakko.com product URL is dropped.</summary>
internal static partial class VakkoSitemapParser
{
    public const string SitemapUrl = "https://www.vakko.com/sitemap/Product.xml";

    [GeneratedRegex(@"^https://www\.vakko\.com/(?<category>[a-z0-9-]+)/(?<name>[a-z0-9-]+)-p-(?<code>[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)$")]
    private static partial Regex ProductUrl();

    public static VakkoSitemapEntry? ParseUrl(string? url, IReadOnlyList<string>? images = null)
    {
        var match = ProductUrl().Match(url?.Trim() ?? "");
        return match.Success
            ? new VakkoSitemapEntry(match.Value, match.Groups["category"].Value, match.Groups["name"].Value, match.Groups["code"].Value, images ?? [])
            : null;
    }

    public static IReadOnlyList<VakkoSitemapEntry> Parse(string xml)
    {
        using var reader = new StringReader(xml);
        return Parse(reader);
    }

    public static IReadOnlyList<VakkoSitemapEntry> Parse(TextReader xml)
    {
        var entries = new List<VakkoSitemapEntry>();
        using var reader = XmlReader.Create(xml, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, IgnoreComments = true, IgnoreWhitespace = true });
        string? loc = null;
        var images = new List<string>();
        while (!reader.EOF)
        {
            if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "url")
            {
                loc = null;
                images = [];
            }
            else if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "loc")
            {
                var isImage = reader.NamespaceURI.Contains("sitemap-image", StringComparison.Ordinal);
                var text = reader.ReadElementContentAsString().Trim();   // moves past </loc>
                if (isImage)
                    images.Add(text);
                else
                    loc = text;
                continue;
            }
            else if (reader.NodeType == XmlNodeType.EndElement && reader.LocalName == "url")
            {
                if (ParseUrl(loc, images) is { } entry)
                    entries.Add(entry);
                loc = null;
            }
            reader.Read();
        }
        return entries;
    }
}

/// <summary>
/// Which sitemap entries get their page fetched, and in which order. Pure and deterministic: the same sitemap gives
/// the same list. Women's apparel, shoes and bags only (unknown slugs are skipped); one colour per model; categories
/// take turns (and, inside a category, its slugs take turns) so a run is not 100 dresses; newest model codes first.
/// </summary>
internal static class VakkoCandidatePicker
{
    /// <summary>
    /// Category slugs of the real sitemap (2026-11-23) → catalog category. Order matters inside a category: slugs
    /// that hold women's products only come first. Several slugs are shared with men (pantolon, triko, gomlek, ceket,
    /// t-shirt, mont, sneaker, bot, canta …): the page decides. Left out on purpose: men-only slugs (kravat, takim-elbise,
    /// smokin, loafer-mokasen, klasik-ayakkabi), accessories, home, and the catch-alls "giyim" / "ayakkabi-canta".
    /// </summary>
    public static readonly IReadOnlyList<(string Slug, ProductCategory Category)> Slugs =
    [
        ("elbise", ProductCategory.Dress), ("elbise-tulum", ProductCategory.Dress), ("kokteyl-elbise", ProductCategory.Dress), ("tulum", ProductCategory.Dress),
        ("bluz", ProductCategory.Blouse), ("gomlek-bluz", ProductCategory.Blouse),
        ("gomlek", ProductCategory.Shirt),
        ("triko", ProductCategory.Knitwear),
        ("t-shirt", ProductCategory.Tshirt), ("t-shirt-sweatshirt", ProductCategory.Tshirt),
        ("sweatshirt", ProductCategory.Sweatshirt),
        ("ceket", ProductCategory.Jacket), ("yelek", ProductCategory.Jacket), ("mont", ProductCategory.Jacket), ("mont-kaban", ProductCategory.Jacket),
        ("palto-kaban", ProductCategory.Coat), ("palto", ProductCategory.Coat), ("kaban", ProductCategory.Coat), ("trenckot", ProductCategory.Coat),
        ("pardosu", ProductCategory.Coat), ("kurk", ProductCategory.Coat),
        ("pantolon-jean-pantolon", ProductCategory.Trousers), ("pantolon", ProductCategory.Trousers),
        ("jean-pantolon", ProductCategory.Jeans),
        ("etek", ProductCategory.Skirt),
        ("bermuda-sort", ProductCategory.Shorts),
        ("topuklu-ayakkabi", ProductCategory.Shoes), ("loafer-babet", ProductCategory.Shoes), ("sandalet-terlik", ProductCategory.Shoes),
        ("cizme", ProductCategory.Shoes), ("bot", ProductCategory.Shoes), ("sneaker", ProductCategory.Shoes), ("ayakkabi", ProductCategory.Shoes),
        ("spor-ayakkabi", ProductCategory.Shoes), ("espadril", ProductCategory.Shoes),
        ("el-cantasi", ProductCategory.Bag), ("omuz-cantasi", ProductCategory.Bag), ("abiye-canta", ProductCategory.Bag), ("canta", ProductCategory.Bag),
        ("portfoy", ProductCategory.Bag), ("portfoy-canta", ProductCategory.Bag), ("sirt-cantasi", ProductCategory.Bag),
        ("mayo-bikini", ProductCategory.Swimwear), ("bikini-takim", ProductCategory.Swimwear), ("mayo", ProductCategory.Swimwear),
    ];

    private static readonly Dictionary<string, (int Order, ProductCategory Category)> BySlug =
        Slugs.Select((s, i) => (s.Slug, i, s.Category)).ToDictionary(s => s.Slug, s => (s.i, s.Category), StringComparer.Ordinal);

    public static ProductCategory? CategoryOf(string slug) => BySlug.TryGetValue(slug, out var known) ? known.Category : null;

    public static IReadOnlyList<VakkoSitemapEntry> Pick(IEnumerable<VakkoSitemapEntry> entries, int limit)
    {
        // One entry per model: the highest code (ordinal) of its colours, whatever the sitemap order is.
        var models = entries
            .Where(e => BySlug.ContainsKey(e.CategorySlug) && StoreInputRules.IsId(VakkoCatalogMapper.ProductId(e.Code)))
            .GroupBy(e => e.BaseCode, StringComparer.Ordinal)
            .Select(g => g.OrderByDescending(e => e.Code, StringComparer.Ordinal).ThenBy(e => e.Url, StringComparer.Ordinal).First());

        // category (enum order) → its slugs (list order) → newest code first
        var categories = models
            .GroupBy(e => BySlug[e.CategorySlug].Category)
            .OrderBy(g => g.Key)
            .Select(category => RoundRobin(category
                .GroupBy(e => e.CategorySlug, StringComparer.Ordinal)
                .OrderBy(g => BySlug[g.Key].Order)
                .Select(slug => slug.OrderByDescending(e => e.Code, StringComparer.Ordinal).ToList())
                .ToList()))
            .ToList();
        return RoundRobin(categories).Take(Math.Max(0, limit)).ToList();
    }

    private static List<T> RoundRobin<T>(IReadOnlyList<List<T>> queues)
    {
        var total = queues.Sum(q => q.Count);
        var result = new List<T>(total);
        for (var round = 0; result.Count < total; round++)
        {
            foreach (var queue in queues)
            {
                if (round < queue.Count)
                    result.Add(queue[round]);
            }
        }
        return result;
    }
}
