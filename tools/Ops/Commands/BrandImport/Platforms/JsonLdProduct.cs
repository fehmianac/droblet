using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Ops.Commands.BrandImport.Platforms;

/// <summary>
/// What a page's schema.org <c>Product</c> (JSON-LD) says, raw: the brand's source decides what it trusts (Gap's
/// "availability" is the colour's own stock, not its sizes'). <paramref name="Properties"/> are the
/// <c>additionalProperty</c> entries by folded name ("cinsiyet" → "kadin"); <paramref name="Breadcrumbs"/> the names of
/// the page's <c>BreadcrumbList</c>, when it has one.
/// </summary>
internal sealed record JsonLdProduct(
    string Name,
    string? Sku,
    string? ProductId,
    string? Description,
    string? Brand,
    string? Category,
    IReadOnlyList<string> Images,
    decimal? Price,
    string? Currency,
    string? Availability,
    string? Url,
    IReadOnlyDictionary<string, string> Properties,
    IReadOnlyList<string> Breadcrumbs)
{
    /// <summary>True / false as the offer states it (…/InStock, …/OutOfStock in any spelling); null when it says nothing usable.</summary>
    public bool? InStock => Availability?.TrimEnd('/') switch
    {
        null => null,
        var a when a.EndsWith("InStock", StringComparison.OrdinalIgnoreCase) || a.EndsWith("LimitedAvailability", StringComparison.OrdinalIgnoreCase)
                   || a.EndsWith("OnlineOnly", StringComparison.OrdinalIgnoreCase) => true,
        var a when a.EndsWith("OutOfStock", StringComparison.OrdinalIgnoreCase) || a.EndsWith("SoldOut", StringComparison.OrdinalIgnoreCase)
                   || a.EndsWith("Discontinued", StringComparison.OrdinalIgnoreCase) => false,
        _ => null,
    };

    public string? Property(string name) => Properties.GetValueOrDefault(SourceText.Fold(name));
}

/// <summary>
/// Parser shared by every site that describes its product in JSON-LD (gap.com.tr / Akinon, sarar.com / T-Soft,
/// beymen.com): all &lt;script type="application/ld+json"&gt; blocks are read; the product may be the document itself,
/// an array entry or a node of "@graph". Pure: html in, product (or the reason) out.
/// </summary>
internal static partial class JsonLdProductParser
{
    [GeneratedRegex("""<script\b[^>]*\btype\s*=\s*["']application/ld\+json["'][^>]*>(?<json>.*?)</script>""", RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex Script();

    public static JsonLdProduct? Parse(string? html, out string? error)
    {
        error = null;
        JsonLdProduct? product = null;
        var breadcrumbs = new List<string>();
        var scripts = 0;
        foreach (Match match in Script().Matches(html ?? ""))
        {
            scripts++;
            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(match.Groups["json"].Value, new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip });
            }
            catch (JsonException)
            {
                continue;   // one broken block does not hide the others
            }
            using (document)
            {
                foreach (var node in Nodes(document.RootElement))
                {
                    if (product is null && IsType(node, "Product"))
                        product = ToProduct(node);
                    else if (breadcrumbs.Count == 0 && IsType(node, "BreadcrumbList"))
                        breadcrumbs.AddRange(Breadcrumbs(node));
                }
            }
        }
        if (product is null)
        {
            error = scripts == 0 ? "no JSON-LD" : "no Product in JSON-LD";
            return null;
        }
        return product with { Breadcrumbs = breadcrumbs };
    }

    /// <summary>The document, the entries of an array and the nodes of "@graph".</summary>
    private static IEnumerable<JsonElement> Nodes(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in root.EnumerateArray().SelectMany(Nodes))
                yield return entry;
            yield break;
        }
        if (root.ValueKind != JsonValueKind.Object)
            yield break;
        yield return root;
        foreach (var node in root.Items("@graph").SelectMany(Nodes))
            yield return node;
    }

    private static bool IsType(JsonElement node, string type) =>
        node.Text("@type") is { } one ? one.Equals(type, StringComparison.OrdinalIgnoreCase)
            : node.Items("@type").Any(t => t.ValueKind == JsonValueKind.String && string.Equals(t.GetString(), type, StringComparison.OrdinalIgnoreCase));

    private static JsonLdProduct? ToProduct(JsonElement node)
    {
        if (node.Text("name") is not { } name)
            return null;
        // "offers" is an Offer, an AggregateOffer or a list of offers: the first one with a price is the page's.
        var offers = node.Child("offers") is { } single ? [single] : node.Items("offers").ToList();
        var offer = offers.Cast<JsonElement?>().FirstOrDefault(o => PriceOf(o!.Value) is not null) ?? offers.Cast<JsonElement?>().FirstOrDefault();
        var properties = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var property in node.Items("additionalProperty"))
        {
            if (property.Text("name") is { } key && (property.Text("value") ?? property.Text("unitText")) is { } value)
                properties.TryAdd(SourceText.Fold(key), value);
        }
        return new JsonLdProduct(
            name,
            Clean(node.Text("sku")),
            Clean(node.Text("productID")),
            node.Text("description"),
            node.Child("brand") is { } brand ? brand.Text("name") : node.Text("brand"),
            node.Text("category"),
            Images(node),
            offer is { } o ? PriceOf(o) : null,
            offer is { } c ? c.Text("priceCurrency") ?? (c.Child("priceSpecification") is { } spec ? spec.Text("priceCurrency") : null) : null,
            offer is { } a ? a.Text("availability") : null,
            offer is { } u ? u.Text("url") : node.Text("url"),
            properties,
            []);
    }

    private static decimal? PriceOf(JsonElement offer) =>
        offer.Number("price") ?? (offer.Child("priceSpecification") is { } spec ? spec.Number("price") : null) ?? offer.Number("lowPrice");

    private static List<string> Images(JsonElement node)
    {
        var images = new List<string>();
        if (node.Text("image") is { } one)
            images.Add(one);
        foreach (var image in node.Items("image"))
        {
            if (image.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(image.GetString()))
                images.Add(image.GetString()!.Trim());
            else if (image.Text("url") is { } url)
                images.Add(url);
        }
        if (images.Count == 0 && node.Child("image") is { } single && single.Text("url") is { } only)
            images.Add(only);
        return images.Distinct(StringComparer.Ordinal).ToList();
    }

    private static IEnumerable<string> Breadcrumbs(JsonElement list) =>
        list.Items("itemListElement")
            .Select(e => e.Text("name") ?? (e.Child("item") is { } item ? item.Text("name") : null))
            .OfType<string>();

    /// <summary>Gap ends its sku with a zero-width space: format characters are dropped.</summary>
    private static string? Clean(string? value)
    {
        if (value is null)
            return null;
        var text = new string(value.Where(ch => char.GetUnicodeCategory(ch) != UnicodeCategory.Format).ToArray()).Trim();
        return text.Length == 0 ? null : text;
    }
}

/// <summary>Reading JSON a page embeds (JSON-LD, state scripts): tolerant accessors, and one value cut out of a script.</summary>
internal static class PageJson
{
    /// <summary>
    /// The JSON value that follows <paramref name="marker"/> in the page ("BEYMEN.productMain = " → the object), whatever
    /// comes after it; null when the marker is missing or no JSON value follows. The caller disposes the document.
    /// </summary>
    public static JsonDocument? ValueAfter(string? html, string marker)
    {
        var start = html?.IndexOf(marker, StringComparison.Ordinal) ?? -1;
        if (start < 0)
            return null;
        start += marker.Length;
        var end = html!.IndexOf("</script", start, StringComparison.OrdinalIgnoreCase);
        var bytes = Encoding.UTF8.GetBytes(end < 0 ? html[start..] : html[start..end]);
        try
        {
            var reader = new Utf8JsonReader(bytes, new JsonReaderOptions { AllowTrailingCommas = true });
            return JsonDocument.TryParseValue(ref reader, out var document) ? document : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static JsonElement? Child(this JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object ? value : null;

    public static IEnumerable<JsonElement> Items(this JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array ? value.EnumerateArray() : [];

    /// <summary>A non-empty string (HTML entities decoded, trimmed); a number as its text.</summary>
    public static string? Text(this JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
            return null;
        var text = value.ValueKind switch
        {
            JsonValueKind.String => WebUtility.HtmlDecode(value.GetString())?.Trim(),
            JsonValueKind.Number => value.GetRawText(),
            _ => null,
        };
        return string.IsNullOrEmpty(text) ? null : text;
    }

    /// <summary>A number, or a string that holds one in invariant form ("12950.00").</summary>
    public static decimal? Number(this JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
            return null;
        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDecimal(out var number) => number,
            JsonValueKind.String when decimal.TryParse(value.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var number) => number,
            _ => null,
        };
    }

    public static bool? Flag(this JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value)
            ? value.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => null }
            : null;
}
