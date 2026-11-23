using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Domain.Validation;

namespace Ops.Commands.BrandImport;

/// <summary>Why a fetched page did not become a catalog product.</summary>
internal enum ImportSkip { OtherSegment, OtherBrand, UnknownCategory, OutOfStock, NoPrice, NoImage }

/// <summary>
/// The admin input of one product plus the list price the site strikes through (null = not discounted). The admin
/// input has no "previous price" field — the catalog service derives it from a price change — so the command writes a
/// NEW discounted product twice (list price, then the real one): the service's own rule stores the previous price.
/// </summary>
internal sealed record MappedProduct(ProductInput Input, long? StrikePriceMinor);

/// <summary>A source's product → the catalog's admin input (ProductInput). Pure and brand-independent: what differs per brand comes from the source.</summary>
internal static class SourceCatalogMapper
{
    public const int MaxImages = 8;
    public const int MaxSizes = 30;

    public static (MappedProduct? Product, ImportSkip? Skip) Map(IBrandCatalogSource source, CatalogSegment segment, SourceProduct product)
    {
        if (product.Gender != segment.Gender())
            return (null, ImportSkip.OtherSegment);
        if (!source.IsOwnBrand(product.BrandName))
            return (null, ImportSkip.OtherBrand);
        if (source.CategoryOf(segment, product.CategoryHint, product.Name) is not { } category)
            return (null, ImportSkip.UnknownCategory);
        if (!product.InStock)
            return (null, ImportSkip.OutOfStock);
        if (PriceMinor(product.Price) is not { } price || !string.Equals(product.Currency, StoreDtoMapper.Currency, StringComparison.Ordinal))
            return (null, ImportSkip.NoPrice);
        var images = Images(source, product.ImageUrls);
        if (images.Count == 0)
            return (null, ImportSkip.NoImage);

        var description = SourceText.Description(product.Description, product.Material);
        var input = new ProductInput(
            source.ProductId(product.Code),
            source.BrandId,
            new Dictionary<string, string> { ["tr"] = SourceText.DisplayName(product.Name, source.TitleCaseNames) },
            description is null ? null : new Dictionary<string, string> { ["tr"] = description },
            category,
            SourceColors.Normalize(product.ColorNames, source.ExtraColors),
            Sizes(product.Sizes),
            price,
            StoreDtoMapper.Currency,
            source.PriceBand,
            images,
            product.Url,                    // the buy link: "Satın al" opens it with the click id appended
            AffiliateSource.Direct,
            Retired: false,
            Segment: segment,
            SizesOnBrandSite: source.SizesOnBrandSite && product.Sizes.Count == 0);
        var strike = PriceMinor(product.ListPrice) is { } list && list > price ? list : (long?)null;
        return (new MappedProduct(input, strike), null);
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
        && stored.Images.SequenceEqual(input.Images ?? [], StringComparer.Ordinal)
        && stored.SizesOnBrandSite == (input.SizesOnBrandSite ?? stored.SizesOnBrandSite);

    private static bool SameText(IReadOnlyDictionary<string, string>? stored, IReadOnlyDictionary<string, string>? input)
    {
        var a = LocalizedText.Normalize(stored);
        var b = LocalizedText.Normalize(input);
        return a.Count == b.Count && a.All(p => b.TryGetValue(p.Key, out var value) && value == p.Value);
    }

    // ── category ────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// A slug's category, corrected by the product name where one slug holds two kinds (gomlek-bluz,
    /// t-shirt-sweatshirt, mont-kaban …). Turkish and English words; a name without such a word keeps the category.
    /// </summary>
    public static ProductCategory RefineCategory(ProductCategory category, string? name)
    {
        var words = SourceText.Fold(name).Split([' ', '-', '/', ','], StringSplitOptions.RemoveEmptyEntries);
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

    // ── sizes / price / images ──────────────────────────────────────────────────────────────────────────────────

    private static readonly HashSet<string> OneSizeLabels = new(StringComparer.Ordinal) { "std", "standart", "tek beden", "tek ebat", "one size", "onesize", "os" };

    /// <summary>The sizes in stock, as the catalog stores them. One-size products ("std") have no size list.</summary>
    public static IReadOnlyList<string> Sizes(IReadOnlyList<SourceSize> sizes) => sizes
        .Where(s => s.InStock && !OneSizeLabels.Contains(SourceText.Fold(s.Label)))
        .Select(s => s.Label.Trim().Replace(',', '.'))
        .Where(StoreInputRules.IsSize)
        .Select(CatalogRules.NormalizeSize)
        .Distinct(StringComparer.Ordinal)
        .Take(MaxSizes)
        .ToList();

    /// <summary>10990 (TRY) → 1099000 kuruş; null for a missing or non-positive price.</summary>
    public static long? PriceMinor(decimal? price) =>
        price is { } value && value > 0 && value <= StoreInputRules.MaxPriceMinor / 100 ? (long)Math.Round(value * 100m, MidpointRounding.AwayFromZero) : null;

    /// <summary>The source's hot-links of the raw image URLs: unusable ones dropped, no duplicates, at most <see cref="MaxImages"/>.</summary>
    public static IReadOnlyList<string> Images(IBrandCatalogSource source, IEnumerable<string> raw) =>
        raw.Select(source.ImageUrl).OfType<string>().Distinct(StringComparer.Ordinal).Take(MaxImages).ToList();
}
