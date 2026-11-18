using System.Globalization;
using System.Text;
using Domain.Entity;
using Domain.Enum;

namespace Domain.Services;

public enum ProductSort { Newest, PriceAsc, PriceDesc }

public sealed record CatalogQuery(
    ProductCategory? Category = null,
    string? BrandId = null,
    string? Color = null,
    string? Size = null,
    string? Text = null,
    PriceBand? PriceBand = null,
    ProductSort Sort = ProductSort.Newest);

public sealed record CatalogPage(IReadOnlyList<CatalogProductEntity> Items, string? PageToken, int Total);

/// <summary>
/// Catalog listing rules (screen 21). The catalog is small and admin managed (README §9.1), so filtering, the default
/// "newest" sort and cursor paging run over the cached product list — no search engine, no GSI.
/// </summary>
public static class CatalogRules
{
    public static ProductSlot SlotOf(ProductCategory category) => category switch
    {
        ProductCategory.Tshirt or ProductCategory.Shirt or ProductCategory.Blouse or ProductCategory.Knitwear
            or ProductCategory.Sweatshirt or ProductCategory.Activewear => ProductSlot.Top,
        ProductCategory.Trousers or ProductCategory.Jeans or ProductCategory.Skirt or ProductCategory.Shorts => ProductSlot.Bottom,
        ProductCategory.Jacket or ProductCategory.Coat or ProductCategory.Skiwear => ProductSlot.Outerwear,
        ProductCategory.Dress or ProductCategory.Swimwear => ProductSlot.OnePiece,
        ProductCategory.Shoes => ProductSlot.Shoes,
        ProductCategory.Bag => ProductSlot.Bag,
        _ => ProductSlot.Accessory,
    };

    /// <summary>Lower-case, Turkish letters folded to ASCII, so "Gömlek", "gomlek" and "GÖMLEK" match.</summary>
    public static string NormalizeText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "";
        var builder = new StringBuilder(value.Length);
        foreach (var c in value.Trim())
        {
            builder.Append(c switch
            {
                'ı' or 'İ' or 'I' => 'i',
                'ş' or 'Ş' => 's',
                'ğ' or 'Ğ' => 'g',
                'ü' or 'Ü' => 'u',
                'ö' or 'Ö' => 'o',
                'ç' or 'Ç' => 'c',
                _ => char.ToLowerInvariant(c),
            });
        }
        return builder.ToString();
    }

    public static string NormalizeColor(string color) => color.Trim().ToLowerInvariant();

    public static string NormalizeSize(string size) => size.Trim().ToUpperInvariant();

    public static bool Matches(CatalogProductEntity product, CatalogQuery query, IReadOnlyDictionary<string, string>? brandNames = null)
    {
        if (product.Retired)
            return false;
        if (query.Category is { } category && product.Category != category)
            return false;
        if (query.BrandId is { Length: > 0 } brand && !string.Equals(product.BrandId, brand, StringComparison.OrdinalIgnoreCase))
            return false;
        if (query.PriceBand is { } band && product.PriceBand != band)
            return false;
        if (query.Color is { Length: > 0 } color && !product.Colors.Contains(NormalizeColor(color)))
            return false;
        if (query.Size is { Length: > 0 } size && !product.Sizes.Contains(NormalizeSize(size)))
            return false;

        var text = NormalizeText(query.Text);
        if (text.Length == 0)
            return true;

        var brandName = brandNames is not null && brandNames.TryGetValue(product.BrandId, out var name) ? name : product.BrandId;
        // Every stored language is searched, so "elbise" and "dress" both find the product whatever the UI language.
        var haystack = NormalizeText($"{string.Join(' ', product.Name.Values)} {brandName} {product.Category} {string.Join(' ', product.Colors)}");
        return text.Split(' ', StringSplitOptions.RemoveEmptyEntries).All(term => haystack.Contains(term, StringComparison.Ordinal));
    }

    public static IReadOnlyList<CatalogProductEntity> Sort(IEnumerable<CatalogProductEntity> products, ProductSort sort) => sort switch
    {
        ProductSort.PriceAsc => products.OrderBy(p => p.PriceMinor).ThenBy(p => p.Id, StringComparer.Ordinal).ToList(),
        ProductSort.PriceDesc => products.OrderByDescending(p => p.PriceMinor).ThenBy(p => p.Id, StringComparer.Ordinal).ToList(),
        _ => products.OrderByDescending(p => p.CreatedAt).ThenBy(p => p.Id, StringComparer.Ordinal).ToList(),
    };

    /// <summary>
    /// Cursor = id of the last item of the previous page (opaque to the client). Stable while the list changes:
    /// if that product disappeared the page restarts from the top instead of skipping items.
    /// </summary>
    public static CatalogPage Page(IReadOnlyList<CatalogProductEntity> sorted, string? pageToken, int pageSize)
    {
        var start = 0;
        if (DecodeToken(pageToken) is { } lastId)
        {
            var index = -1;
            for (var i = 0; i < sorted.Count; i++)
            {
                if (sorted[i].Id == lastId) { index = i; break; }
            }
            start = index + 1;
        }

        var items = sorted.Skip(start).Take(pageSize).ToList();
        var next = start + items.Count < sorted.Count && items.Count > 0 ? EncodeToken(items[^1].Id) : null;
        return new CatalogPage(items, next, sorted.Count);
    }

    public static CatalogPage Query(IEnumerable<CatalogProductEntity> products, CatalogQuery query, string? pageToken, int pageSize,
        IReadOnlyDictionary<string, string>? brandNames = null) =>
        Page(Sort(products.Where(p => Matches(p, query, brandNames)), query.Sort), pageToken, pageSize);

    public static string EncodeToken(string value) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(value)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string? DecodeToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 400)
            return null;
        try
        {
            var padded = token.Replace('-', '+').Replace('_', '/');
            padded = padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '=');
            return Encoding.UTF8.GetString(Convert.FromBase64String(padded));
        }
        catch (FormatException)
        {
            return null;
        }
    }

    /// <summary>True when the price went down — the only change that flags watch-list rows.</summary>
    public static bool IsPriceDrop(long previousMinor, long currentMinor) => currentMinor > 0 && currentMinor < previousMinor;
}

/// <summary>Weekly edit rules: a week starts on Monday; the current edit is the latest published one that has started.</summary>
public static class WeeklyEditRules
{
    public const int LooksPerEdit = 7;
    private const string DayFormat = "yyyy-MM-dd";

    public static bool TryParseDay(string? value, out DateOnly day) =>
        DateOnly.TryParseExact(value, DayFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out day);

    public static string Format(DateOnly day) => day.ToString(DayFormat, CultureInfo.InvariantCulture);

    public static DateOnly WeekStartOf(DateOnly day) => day.AddDays(-(((int)day.DayOfWeek + 6) % 7));

    public static bool IsWeekStart(string? value) => TryParseDay(value, out var day) && day.DayOfWeek == DayOfWeek.Monday;

    public static WeeklyEditEntity? PickCurrent(IEnumerable<WeeklyEditEntity> edits, DateOnly today, Segment segment)
    {
        var limit = Format(today);
        return edits
            .Where(e => e is { Published: true, Retired: false } && e.Segment == segment
                        && string.CompareOrdinal(e.WeekStart, limit) <= 0)
            .OrderByDescending(e => e.WeekStart, StringComparer.Ordinal)
            .ThenByDescending(e => e.UpdatedAt)
            .FirstOrDefault();
    }

    /// <summary>Brief §4.5: sponsored edits / showcases carry the "Sponsorlu" label.</summary>
    public static bool IsSponsored(WeeklyEditEntity edit) =>
        !string.IsNullOrWhiteSpace(edit.SponsorBrandId) || edit.SponsorName is { Count: > 0 };
}
