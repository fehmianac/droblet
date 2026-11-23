using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Ops.Commands.BrandImport.Platforms;

/// <summary>
/// What a SAP Commerce / Spartacus product page says about the product (raw values of the platform; the brand's source
/// turns them into a <see cref="SourceProduct"/>).
/// </summary>
internal sealed record SpartacusProduct(
    string Code,
    string Name,
    string? DescriptionHtml,
    string? Material,
    string? Brand,
    string? Gender,
    IReadOnlyList<string> CategoryNames,
    string? Color,
    string? Style,
    decimal? Price,
    string? Currency,
    decimal? StrikePrice,
    bool InStock,
    IReadOnlyList<SourceSize> Sizes,
    IReadOnlyList<string> ImageTemplates);

/// <summary>
/// Platform parser shared by every SAP Commerce / Spartacus storefront (vakko.com today). The product page is
/// server-rendered (Angular / SAP Spartacus) and carries the app state as JSON in
/// &lt;script id="ng-state" type="application/json"&gt;: cx-state › product › details › entities › {CODE} › details › value.
/// Pure: html in, product (or the reason it could not be read) out.
/// </summary>
internal static partial class SpartacusStateParser
{
    [GeneratedRegex("""<script\b[^>]*\bid=["'][^"']*state[^"']*["'][^>]*>(?<json>.*?)</script>""", RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex StateScript();

    private static readonly string[] Scopes = ["details", "variants", "list"];

    public static SpartacusProduct? Parse(string html, string? expectedCode, out string? error)
    {
        error = null;
        var match = StateScript().Match(html ?? "");
        if (!match.Success)
        {
            error = "no state script";
            return null;
        }

        JsonDocument? document = null;
        try
        {
            document = ParseState(match.Groups["json"].Value);
            if (document is null)
            {
                error = "state is not JSON";
                return null;
            }
            if (FindProduct(document.RootElement, expectedCode) is not { } product)
            {
                error = "no product in state";
                return null;
            }
            var code = Text(product, "code");
            var name = Text(product, "name");
            if (code is null || name is null)
            {
                error = "product without code or name";
                return null;
            }
            if (expectedCode is not null && !string.Equals(code, expectedCode, StringComparison.OrdinalIgnoreCase))
            {
                error = $"another product ({code})";
                return null;
            }

            var sizes = Sizes(product);
            return new SpartacusProduct(
                code, name,
                Text(product, "description"),
                Text(product, "textComponent"),
                (Object(product, "brandInfo") is { } brand ? Text(brand, "name") : null) ?? Text(product, "brand"),
                Text(product, "gender"),
                Array(product, "categories").Select(c => Text(c, "name")).OfType<string>().ToList(),
                Text(product, "color"),
                Text(product, "style"),
                Object(product, "price") is { } price ? Number(price, "value") : null,
                Object(product, "price") is { } money ? Text(money, "currencyIso") : null,
                Object(product, "firstStrikePrice") is { } strike ? Number(strike, "value") : null,
                sizes.Count > 0 ? sizes.Any(s => s.InStock) : Object(product, "stock") is { } stock && IsInStock(stock),
                sizes,
                Images(product));
        }
        finally
        {
            document?.Dispose();
        }
    }

    private static JsonDocument? ParseState(string raw)
    {
        // Today the script is plain JSON ("<" and "/" as <, /). Older Angular transfer state escaped it as
        // &q; &a; &s; &l; &g; — and a proxy may HTML-escape it: both are tried before giving up.
        foreach (var candidate in new[] { raw, AngularUnescape(raw), WebUtility.HtmlDecode(raw) })
        {
            try
            {
                return JsonDocument.Parse(candidate);
            }
            catch (JsonException)
            {
            }
        }
        return null;
    }

    private static string AngularUnescape(string raw) => raw
        .Replace("&q;", "\"", StringComparison.Ordinal).Replace("&s;", "'", StringComparison.Ordinal)
        .Replace("&l;", "<", StringComparison.Ordinal).Replace("&g;", ">", StringComparison.Ordinal)
        .Replace("&a;", "&", StringComparison.Ordinal);

    private static JsonElement? FindProduct(JsonElement root, string? expectedCode)
    {
        if (Object(root, "cx-state") is not { } state || Object(state, "product") is not { } products
            || Object(products, "details") is not { } details || Object(details, "entities") is not { } entities)
            return null;

        var candidates = entities.EnumerateObject()
            .OrderByDescending(e => expectedCode is not null && string.Equals(e.Name, expectedCode, StringComparison.OrdinalIgnoreCase))
            .Select(e => e.Value);
        foreach (var entity in candidates)
        {
            if (entity.ValueKind != JsonValueKind.Object)
                continue;
            var scopes = Scopes.Select(s => Object(entity, s)).Concat(entity.EnumerateObject().Select(p => (JsonElement?)p.Value));
            foreach (var scope in scopes)
            {
                if (scope is { ValueKind: JsonValueKind.Object } s && Object(s, "value") is { } value && Text(value, "code") is not null)
                    return value;
            }
        }
        return null;
    }

    private static List<SourceSize> Sizes(JsonElement product)
    {
        var sizes = new List<SourceSize>();
        foreach (var option in Array(product, "variantOptions"))
        {
            var label = Array(option, "variantOptionQualifiers").Select(q => Text(q, "value")).FirstOrDefault(v => v is not null);
            if (label is null)
                continue;
            var active = !option.TryGetProperty("isActive", out var flag) || flag.ValueKind != JsonValueKind.False;
            sizes.Add(new SourceSize(label, active && Object(option, "stock") is { } stock && IsInStock(stock)));
        }
        return sizes;
    }

    /// <summary>stockLevelStatus inStock | lowStock, and not a level of 0.</summary>
    private static bool IsInStock(JsonElement stock)
    {
        var status = Text(stock, "stockLevelStatus");
        if (status is null || status.Equals("outOfStock", StringComparison.OrdinalIgnoreCase))
            return false;
        return Number(stock, "stockLevel") is not <= 0;
    }

    private static List<string> Images(JsonElement product)
    {
        var urls = Array(product, "galleryImages").Where(i => i.ValueKind == JsonValueKind.String).Select(i => i.GetString()!).ToList();
        if (urls.Count == 0 && Object(product, "images") is { } images)
        {
            urls.AddRange(Array(images, "GALLERY").Select(g => Object(g, "product") is { } p ? Text(p, "url") : null).OfType<string>());
            if (urls.Count == 0 && Object(images, "PRIMARY") is { } primary && Object(primary, "product") is { } first && Text(first, "url") is { } url)
                urls.Add(url);
        }
        return urls.Where(u => !string.IsNullOrWhiteSpace(u)).Distinct(StringComparer.Ordinal).ToList();
    }

    private static JsonElement? Object(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object ? value : null;

    private static IEnumerable<JsonElement> Array(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array ? value.EnumerateArray() : [];

    private static string? Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
        && value.GetString() is { } text && !string.IsNullOrWhiteSpace(text) ? text.Trim() : null;

    private static decimal? Number(JsonElement element, string name)
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
}
