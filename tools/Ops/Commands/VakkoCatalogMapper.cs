using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Domain.Validation;

namespace Ops.Commands;

/// <summary>Why a fetched page did not become a catalog product.</summary>
internal enum VakkoSkip { NotWomen, OtherBrand, UnknownCategory, OutOfStock, NoPrice, NoImage }

/// <summary>
/// The admin input of one product plus the list price the site strikes through (null = not discounted). The admin
/// input has no "previous price" field — the catalog service derives it from a price change — so the command writes a
/// NEW discounted product twice (list price, then the real one): the service's own rule stores the previous price.
/// </summary>
internal sealed record VakkoMapped(ProductInput Input, long? StrikePriceMinor);

/// <summary>vakko.com product → the catalog's admin input (ProductInput / BrandInput). Pure.</summary>
internal static partial class VakkoCatalogMapper
{
    public const string BrandId = "vakko";
    public const string IdPrefix = "vakko-";
    public const string SiteUrl = "https://www.vakko.com";
    public const string ImageHost = "cdn.vakko.com";

    /// <summary>
    /// Size asked from the image CDN (https://cdn.vakko.com/mnresize/{x}/{y}/…): ≈100 KB per image instead of ≈480 KB
    /// for the 2000×3000 of the sitemap. Hot-linked, never copied.
    /// </summary>
    public const int ImageWidth = 800;
    public const int ImageHeight = 1200;
    public const int MaxImages = 8;
    public const int MaxColors = 3;
    private const int MaxNameLength = 160;
    private const int MaxDescriptionLength = 2000;

    /// <summary>
    /// Direct brand, no network. No checkout URL: a cart with several Vakko products opens the first product's page
    /// (AffiliateService); the click id goes out as ?click_id=… (Affiliate default) and the product page ignores it.
    /// </summary>
    public static BrandInput Brand { get; } = new(BrandId, "Vakko", SiteUrl, LogoUrl: null, AffiliateSource.Direct, Network: null, CheckoutUrl: null, ClickIdParameter: null, CommissionRateBps: null);

    public static string ProductId(string code) => IdPrefix + code.Trim().ToLowerInvariant();

    public static (VakkoMapped? Product, VakkoSkip? Skip) Map(VakkoSitemapEntry entry, VakkoProduct product)
    {
        if (!IsWomen(product))
            return (null, VakkoSkip.NotWomen);
        if (!IsOwnBrand(product.Brand))
            return (null, VakkoSkip.OtherBrand);
        if (CategoryOf(entry.CategorySlug, product.Name) is not { } category)
            return (null, VakkoSkip.UnknownCategory);
        if (!product.InStock)
            return (null, VakkoSkip.OutOfStock);
        if (PriceMinor(product.Price) is not { } price || !string.Equals(product.Currency, StoreDtoMapper.Currency, StringComparison.Ordinal))
            return (null, VakkoSkip.NoPrice);
        var images = Images(product.ImageTemplates.Count > 0 ? product.ImageTemplates : entry.Images);
        if (images.Count == 0)
            return (null, VakkoSkip.NoImage);

        var name = TitleCase(product.Name);
        var description = Description(product.DescriptionHtml, product.Material);
        var input = new ProductInput(
            ProductId(product.Code),
            BrandId,
            new Dictionary<string, string> { ["tr"] = name.Length > MaxNameLength ? name[..MaxNameLength].TrimEnd() : name },
            description is null ? null : new Dictionary<string, string> { ["tr"] = description },
            category,
            Colors(product.Style, product.Color),
            Sizes(product.Sizes),
            price,
            StoreDtoMapper.Currency,
            PriceBand.LuxuryTouch,
            images,
            entry.Url,                      // the buy link: "Satın al" opens it with the click id appended
            AffiliateSource.Direct,
            Retired: false,
            Segment: CatalogSegment.Women);
        var strike = PriceMinor(product.StrikePrice) is { } list && list > price ? list : (long?)null;
        return (new VakkoMapped(input, strike), null);
    }

    /// <summary>Nothing the import writes differs from what is stored: a re-run leaves the product (and the audit log) alone.</summary>
    public static bool SameAsStored(CatalogProductEntity stored, ProductInput input) =>
        !stored.Retired
        && stored.BrandId == input.BrandId
        && stored.Category == input.Category
        && stored.PriceMinor == input.PriceMinor
        && stored.PriceBand == input.PriceBand
        && stored.Segment == input.Segment
        && stored.AffiliateUrl == input.AffiliateUrl
        && stored.AffiliateSource == input.AffiliateSource
        && SameText(stored.Name, input.Name)
        && SameText(stored.Description, input.Description)
        && stored.Colors.SequenceEqual((input.Colors ?? []).Select(CatalogRules.NormalizeColor).Distinct(), StringComparer.Ordinal)
        && stored.Sizes.SequenceEqual((input.Sizes ?? []).Select(CatalogRules.NormalizeSize).Distinct(), StringComparer.Ordinal)
        && stored.Images.SequenceEqual(input.Images ?? [], StringComparer.Ordinal);

    private static bool SameText(IReadOnlyDictionary<string, string>? stored, IReadOnlyDictionary<string, string>? input)
    {
        var a = LocalizedText.Normalize(stored);
        var b = LocalizedText.Normalize(input);
        return a.Count == b.Count && a.All(p => b.TryGetValue(p.Key, out var value) && value == p.Value);
    }

    // ── gender / brand ──────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The page's "gender" (Kadın | Erkek | Unisex | …); without it, the category path (… › Kadın › …).</summary>
    public static bool IsWomen(VakkoProduct product)
    {
        if (!string.IsNullOrWhiteSpace(product.Gender))
            return Fold(product.Gender) == "kadin";
        var path = product.CategoryNames.Select(Fold).ToList();
        return path.Contains("kadin") && !path.Contains("erkek") && !path.Any(c => c.Contains("cocuk", StringComparison.Ordinal) || c.Contains("bebek", StringComparison.Ordinal));
    }

    /// <summary>vakko.com also sells other designers (brand "ORCIANI", "SELF PORTRAIT" …); its own products say VAKKO or nothing.</summary>
    public static bool IsOwnBrand(string? brand) => string.IsNullOrWhiteSpace(brand) || Fold(brand).StartsWith("vakko", StringComparison.Ordinal);

    // ── category ────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The slug's category, corrected by the product name where a slug holds two kinds (gomlek-bluz, t-shirt-sweatshirt, mont-kaban …).</summary>
    public static ProductCategory? CategoryOf(string categorySlug, string? name)
    {
        if (VakkoCandidatePicker.CategoryOf(categorySlug) is not { } category)
            return null;
        var words = Fold(name).Split([' ', '-', '/', ','], StringSplitOptions.RemoveEmptyEntries);
        bool Has(params string[] any) => words.Any(w => any.Any(a => w.StartsWith(a, StringComparison.Ordinal)));
        return category switch
        {
            ProductCategory.Blouse when Has("gomlek") && !Has("bluz") => ProductCategory.Shirt,
            ProductCategory.Shirt when Has("bluz") && !Has("gomlek") => ProductCategory.Blouse,
            ProductCategory.Tshirt when Has("sweat") => ProductCategory.Sweatshirt,
            ProductCategory.Jacket when Has("kaban", "palto", "trenckot", "pardosu") => ProductCategory.Coat,
            ProductCategory.Trousers when Has("jean") => ProductCategory.Jeans,
            ProductCategory.Trousers when Has("sort", "bermuda") => ProductCategory.Shorts,
            _ => category,
        };
    }

    // ── colours ─────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Turkish colour names of the site (folded to ASCII lower case) → catalog colour ids (Domain ColorCatalog).</summary>
    public static readonly IReadOnlyDictionary<string, string> ColorIds = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["siyah"] = "black",
        ["antrasit"] = "charcoal", ["fume"] = "charcoal", ["koyu gri"] = "charcoal",
        ["gri"] = "grey", ["acik gri"] = "grey",
        ["gumus"] = "silver", ["silver"] = "silver",
        ["beyaz"] = "white", ["optik beyaz"] = "white",
        ["ekru"] = "ivory", ["fildisi"] = "ivory", ["kirik beyaz"] = "ivory",
        ["krem"] = "cream",
        ["bej"] = "beige", ["tas"] = "beige", ["kum"] = "beige", ["naturel"] = "beige",
        ["vizon"] = "taupe",
        ["camel"] = "camel", ["taba"] = "camel", ["karamel"] = "camel",
        ["kahve"] = "brown", ["kahverengi"] = "brown",
        ["cikolata"] = "chocolate", ["aci kahve"] = "chocolate", ["koyu kahve"] = "chocolate",
        ["kirmizi"] = "red",
        ["bordo"] = "burgundy",
        ["kiremit"] = "rust", ["tarcin"] = "rust",
        ["terrakota"] = "terracotta",
        ["turuncu"] = "orange", ["oranj"] = "orange",
        ["mercan"] = "coral", ["somon"] = "coral",
        ["seftali"] = "peach",
        ["hardal"] = "mustard",
        ["sari"] = "yellow",
        ["altin"] = "gold", ["dore"] = "gold", ["gold"] = "gold",
        ["pudra"] = "blush",
        ["pembe"] = "pink",
        ["fusya"] = "fuchsia",
        ["lavanta"] = "lavender",
        ["lila"] = "lilac",
        ["mor"] = "purple",
        ["murdum"] = "plum",
        ["buz mavisi"] = "icy-blue",
        ["bebek mavisi"] = "sky-blue", ["acik mavi"] = "sky-blue",
        ["indigo"] = "denim", ["kot"] = "denim", ["denim"] = "denim",
        ["mavi"] = "cobalt", ["saks"] = "cobalt",
        ["lacivert"] = "navy", ["koyu mavi"] = "navy",
        ["turkuaz"] = "turquoise",
        ["petrol"] = "teal",
        ["mint"] = "mint", ["su yesili"] = "mint",
        ["adacayi"] = "sage",
        ["haki"] = "khaki",
        ["zeytin"] = "olive",
        ["yesil"] = "emerald", ["zumrut"] = "emerald",
        ["nefti"] = "forest-green", ["koyu yesil"] = "forest-green",
    };

    /// <summary>
    /// "style" is the exact colour of the page ("Bordo", "Saks-Gri"), "color" its family ("KIRMIZI"): the style wins,
    /// the family is the fallback, and a colour the catalog does not know becomes "other".
    /// </summary>
    public static IReadOnlyList<string> Colors(string? style, string? color)
    {
        var ids = Lookup(style);
        if (ids.Count == 0)
            ids = Lookup(color);
        return ids.Count == 0 ? [ColorCatalog.OtherId] : ids;
    }

    private static List<string> Lookup(string? text)
    {
        var ids = new List<string>();
        foreach (var part in Fold(text).Split(['-', '/', ',', '&', '+'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!ColorIds.TryGetValue(part, out var id))
                id = part.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(w => ColorIds.GetValueOrDefault(w)).FirstOrDefault(w => w is not null);
            if (id is not null && !ids.Contains(id) && ids.Count < MaxColors)
                ids.Add(id);
        }
        return ids;
    }

    // ── sizes / price / images ──────────────────────────────────────────────────────────────────────────────────

    private static readonly HashSet<string> OneSizeLabels = new(StringComparer.Ordinal) { "std", "standart", "tek beden", "tek ebat", "one size" };

    /// <summary>The sizes in stock, as the catalog stores them. One-size products ("std") have no size list.</summary>
    public static IReadOnlyList<string> Sizes(IReadOnlyList<VakkoSize> sizes) => sizes
        .Where(s => s.InStock && !OneSizeLabels.Contains(Fold(s.Label)))
        .Select(s => s.Label.Trim().Replace(',', '.'))
        .Where(StoreInputRules.IsSize)
        .Select(CatalogRules.NormalizeSize)
        .Distinct(StringComparer.Ordinal)
        .Take(30)
        .ToList();

    /// <summary>10990 (TRY) → 1099000 kuruş; null for a missing or non-positive price.</summary>
    public static long? PriceMinor(decimal? price) =>
        price is { } value && value > 0 && value <= StoreInputRules.MaxPriceMinor / 100 ? (long)Math.Round(value * 100m, MidpointRounding.AwayFromZero) : null;

    [GeneratedRegex(@"/mnresize/(\{x\}|\d+)/(\{y\}|\d+)/")]
    private static partial Regex ResizeSegment();

    /// <summary>".../mnresize/{x}/{y}/868….jpg?v=…" (page) or ".../mnresize/2000/3000/…" (sitemap) → the hot-link at the import's size.</summary>
    public static string? ImageUrl(string? template)
    {
        if (string.IsNullOrWhiteSpace(template))
            return null;
        var url = ResizeSegment().Replace(template.Trim(), $"/mnresize/{ImageWidth}/{ImageHeight}/", 1);
        return url.Length <= 2000 && !url.Contains('{', StringComparison.Ordinal)
               && Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps
               && string.Equals(uri.Host, ImageHost, StringComparison.OrdinalIgnoreCase)
            ? url
            : null;
    }

    public static IReadOnlyList<string> Images(IEnumerable<string> templates) =>
        templates.Select(ImageUrl).OfType<string>().Distinct(StringComparer.Ordinal).Take(MaxImages).ToList();

    // ── text ────────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Words that stay Latin in a Turkish upper-case name ("MICRO" is not "Mıcro").</summary>
    private static readonly HashSet<string> LatinWords = new(StringComparer.Ordinal)
    {
        "micro", "mini", "midi", "maxi", "slim", "fit", "skinny", "straight", "regular", "oversize", "relaxed", "wide", "high", "rise",
        "shirt", "sweatshirt", "bikini", "denim", "vintage", "limited", "edition", "exclusive", "print", "basic", "twill", "design",
        "city", "icon", "iconic", "signature", "satin", "silk", "linen", "pin", "stripe", "initials", "trim",
    };

    /// <summary>"VİZON TRİKO MİDİ ETEK" → "Vizon Triko Midi Etek" with Turkish casing (I → ı, İ → i; i → İ, ı → I), independent of the machine's culture.</summary>
    public static string TitleCase(string? name)
    {
        var text = WhiteSpace().Replace(name ?? "", " ").Trim();
        var builder = new StringBuilder(text.Length);
        var start = 0;
        while (start < text.Length)
        {
            if (!char.IsLetter(text[start]))
            {
                builder.Append(text[start++]);
                continue;
            }
            var end = start;
            while (end < text.Length && (char.IsLetter(text[end]) || text[end] == '\''))
                end++;
            var word = text[start..end];
            var latin = LatinWords.Contains(string.Concat(word.Select(LowerLatin)));
            // A letter right after a digit continues it ("2li", "100cm"): no capital.
            var capital = start == 0 || !char.IsDigit(text[start - 1]);
            for (var i = 0; i < word.Length; i++)
            {
                var lower = latin ? LowerLatin(word[i]) : LowerTr(word[i]);
                builder.Append(i == 0 && capital ? (latin ? char.ToUpperInvariant(lower) : UpperTr(lower)) : lower);
            }
            start = end;
        }
        return builder.ToString();
    }

    private static char LowerTr(char c) => c switch { 'I' => 'ı', 'İ' => 'i', _ => char.ToLowerInvariant(c) };

    private static char LowerLatin(char c) => c is 'I' or 'İ' ? 'i' : char.ToLowerInvariant(c);

    private static char UpperTr(char c) => c switch { 'i' => 'İ', 'ı' => 'I', _ => char.ToUpperInvariant(c) };

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhiteSpace();

    [GeneratedRegex(@"<\s*(br|/p|/div|/li|/h[1-6]|/tr)\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex LineBreakTag();

    [GeneratedRegex(@"<(script|style)\b.*?</\1\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex CodeBlock();

    [GeneratedRegex("<[^>]*>")]
    private static partial Regex Tag();

    /// <summary>HTML → plain lines (tags dropped, entities decoded, blank lines removed).</summary>
    public static string StripHtml(string? html)
    {
        if (string.IsNullOrWhiteSpace(html))
            return "";
        var text = CodeBlock().Replace(html, " ");
        text = LineBreakTag().Replace(text, "\n");
        text = WebUtility.HtmlDecode(Tag().Replace(text, " ")).Replace(' ', ' ');
        var lines = text.Split('\n').Select(l => WhiteSpace().Replace(l, " ").Trim()).Where(l => l.Length > 0);
        return string.Join('\n', lines);
    }

    /// <summary>The page's description (often empty) followed by its material line ("%100 Pamuk"); null when both are empty.</summary>
    public static string? Description(string? descriptionHtml, string? material)
    {
        var parts = new[] { StripHtml(descriptionHtml), StripHtml(material) }.Where(p => p.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        if (parts.Count == 0)
            return null;
        var text = string.Join('\n', parts);
        return text.Length > MaxDescriptionLength ? text[..(MaxDescriptionLength - 1)].TrimEnd() + "…" : text;
    }

    private static string Fold(string? value) => WhiteSpace().Replace(CatalogRules.NormalizeText(value), " ");
}
