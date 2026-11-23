using Domain.Enum;
using Domain.Services;
using Domain.Validation;

namespace Ops.Commands.BrandImport;

/// <summary>Who a product is for, as the site states it. Only Women and Men become catalog products (of that segment).</summary>
internal enum SourceGender { Unknown, Women, Men, Unisex, Kids }

/// <summary>A size of a product: its label ("38", "M", "std" for one-size) and whether it can be bought now.</summary>
internal sealed record SourceSize(string Label, bool InStock);

/// <summary>
/// A product URL found by <see cref="IBrandCatalogSource.DiscoverAsync"/>, before its page is fetched.
/// <paramref name="CategoryHint"/> is the brand's own category word (a URL slug, a collection handle …) that the
/// source's slug table turns into a catalog category; <paramref name="ModelCode"/> groups the colours of one model
/// (only one of them is fetched) and defaults to the code itself.
/// </summary>
internal sealed record SourceCandidate(string Url, string Code, string CategoryHint, string? NameHint, IReadOnlyList<string> Images, string? ModelCode = null)
{
    public string ModelCode { get; } = string.IsNullOrEmpty(ModelCode) ? Code : ModelCode;
}

/// <summary>
/// What one product page (or API response) says, in brand-neutral terms. Raw values: <see cref="SourceCatalogMapper"/>
/// decides what becomes a catalog product. Money is in major units (10990 = 10.990 TL).
/// </summary>
/// <param name="Code">The brand's product code; the catalog id is "{brandId}-{code}".</param>
/// <param name="Description">Plain text or HTML (tags are stripped).</param>
/// <param name="Material">A material / composition line, appended to the description.</param>
/// <param name="BrandName">The brand as the site states it (multi-brand stores sell other labels too); null = not stated.</param>
/// <param name="CategoryHint">The brand's category word; usually the candidate's.</param>
/// <param name="ColorNames">Colour names, most exact first: the first one the colour table knows wins ("Bordo" before its family "KIRMIZI").</param>
/// <param name="ListPrice">The struck-through price; a value above <paramref name="Price"/> marks a discount.</param>
/// <param name="ImageUrls">Raw image URLs; <see cref="IBrandCatalogSource.ImageUrl"/> turns each into the hot-link.</param>
/// <param name="Url">The canonical product URL: the buy link.</param>
internal sealed record SourceProduct(
    string Code,
    string Name,
    string? Description,
    string? Material,
    SourceGender Gender,
    string? BrandName,
    string? CategoryHint,
    IReadOnlyList<string> ColorNames,
    IReadOnlyList<SourceSize> Sizes,
    decimal? Price,
    decimal? ListPrice,
    string? Currency,
    IReadOnlyList<string> ImageUrls,
    string Url,
    bool InStock);

/// <summary>What discovery found. <paramref name="Summary"/> opens the run's first line ("Sitemap: 21430 products").</summary>
internal sealed record SourceDiscovery(IReadOnlyList<SourceCandidate> Candidates, string Summary, string? Error = null)
{
    public static SourceDiscovery Failed(string error) => new([], "", error);
}

/// <summary>
/// The only URLs a source may request: https, one of its hosts, no fragment, no query string unless the source says
/// so, and nothing under the path prefixes it denies — what its robots.txt disallows plus the account / basket /
/// search routes, written down per source. A prefix covers whole path segments: "/cart" denies /cart and /cart/…,
/// not /cartier; end it with "/" or write the longer prefix to deny more.
/// </summary>
internal sealed record SourceAccess(IReadOnlyList<string> Hosts, IReadOnlyList<string> DisallowedPathPrefixes, bool AllowQuery = false)
{
    public bool Allows(string? url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps
        && Hosts.Contains(uri.Host, StringComparer.Ordinal)
        && uri.Fragment.Length == 0 && (AllowQuery || uri.Query.Length == 0)
        && !DisallowedPathPrefixes.Any(prefix => Covers(prefix, uri.AbsolutePath));

    private static bool Covers(string prefix, string path) =>
        path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
        && (prefix.EndsWith('/') || path.Length == prefix.Length || path[prefix.Length] == '/');
}

/// <summary>
/// One brand's public catalog, as import-brand reads it. A new brand is one class (usually deriving from
/// <see cref="BrandCatalogSource"/>) plus one line in <see cref="BrandSources"/> — see README.md in this folder for the
/// rules every source follows. Everything else (pacing, caps, stop rules, candidate picking, mapping, upsert, report)
/// is shared.
/// </summary>
internal interface IBrandCatalogSource
{
    // ── identity ────────────────────────────────────────────────────────────────────────────────────────────────
    /// <summary>Catalog brand id and the prefix of every product id ("vakko" → "vakko-m406869593-0022").</summary>
    string BrandId { get; }
    string DisplayName { get; }
    string WebsiteUrl { get; }
    /// <summary>The segments this source can supply (women / men).</summary>
    IReadOnlyList<CatalogSegment> Segments { get; }
    PriceBand PriceBand { get; }

    // ── access ──────────────────────────────────────────────────────────────────────────────────────────────────
    SourceAccess Access { get; }
    /// <summary>Requests discovery may make before the first product page (a sitemap = 1, an index + two sitemaps = 3).</summary>
    int MaxDiscoveryRequests { get; }
    TimeSpan PageTimeout { get; }

    // ── reading ─────────────────────────────────────────────────────────────────────────────────────────────────
    /// <summary>Candidate product URLs with a category hint — from a sitemap, a category listing, a JSON endpoint: whatever the brand offers publicly.</summary>
    Task<SourceDiscovery> DiscoverAsync(PoliteFetcher site, CatalogSegment segment, CancellationToken ct);

    /// <summary>Page / response body → product, or null and the reason. Pure: never throws for a bad page, never fetches.</summary>
    SourceProduct? ParseProduct(string body, SourceCandidate candidate, out string? error);

    // ── the brand's own tables ──────────────────────────────────────────────────────────────────────────────────
    /// <summary>The brand's category words → catalog categories, for one segment. Order matters inside a category (the picker takes the slugs in turn).</summary>
    IReadOnlyList<(string Slug, ProductCategory Category)> CategorySlugs(CatalogSegment segment);

    /// <summary>The category of a product: the hint's entry in <see cref="CategorySlugs"/>, corrected by the product name where a slug holds two kinds.</summary>
    ProductCategory? CategoryOf(CatalogSegment segment, string? categoryHint, string? name);

    /// <summary>Colour names only this brand uses (folded: lower case, Turkish letters as ASCII) → catalog colour ids. Looked up before <see cref="SourceColors.Shared"/>.</summary>
    IReadOnlyDictionary<string, string> ExtraColors { get; }

    /// <summary>False for another label sold on the brand's site.</summary>
    bool IsOwnBrand(string? brandName);

    /// <summary>A raw image URL → the hot-link the catalog stores (https, the brand's image host, a sane size); null = not usable.</summary>
    string? ImageUrl(string? raw);

    /// <summary>True when the site writes names in capitals ("VİZON TRİKO MİDİ ETEK") and they are title-cased for the app.</summary>
    bool TitleCaseNames { get; }
}

/// <summary>The defaults most sources share; a brand overrides what differs.</summary>
internal abstract class BrandCatalogSource : IBrandCatalogSource
{
    public abstract string BrandId { get; }
    public abstract string DisplayName { get; }
    public abstract string WebsiteUrl { get; }
    public abstract IReadOnlyList<CatalogSegment> Segments { get; }
    public abstract PriceBand PriceBand { get; }
    public abstract SourceAccess Access { get; }
    public virtual int MaxDiscoveryRequests => 1;
    public virtual TimeSpan PageTimeout => TimeSpan.FromSeconds(20);

    /// <summary>Hosts images may be hot-linked from (the default <see cref="ImageUrl"/>).</summary>
    protected abstract IReadOnlyList<string> ImageHosts { get; }

    public abstract Task<SourceDiscovery> DiscoverAsync(PoliteFetcher site, CatalogSegment segment, CancellationToken ct);
    public abstract SourceProduct? ParseProduct(string body, SourceCandidate candidate, out string? error);
    public abstract IReadOnlyList<(string Slug, ProductCategory Category)> CategorySlugs(CatalogSegment segment);

    public virtual ProductCategory? CategoryOf(CatalogSegment segment, string? categoryHint, string? name)
    {
        foreach (var (slug, category) in CategorySlugs(segment))
        {
            if (string.Equals(slug, categoryHint, StringComparison.Ordinal))
                return SourceCatalogMapper.RefineCategory(category, name);
        }
        return null;
    }

    public virtual IReadOnlyDictionary<string, string> ExtraColors { get; } = new Dictionary<string, string>();

    public virtual bool IsOwnBrand(string? brandName) =>
        string.IsNullOrWhiteSpace(brandName) || SourceText.Fold(brandName).StartsWith(SourceText.Fold(DisplayName), StringComparison.Ordinal);

    public virtual string? ImageUrl(string? raw)
    {
        var url = raw?.Trim();
        return !string.IsNullOrEmpty(url) && url.Length <= 2000
               && Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps
               && ImageHosts.Contains(uri.Host, StringComparer.OrdinalIgnoreCase)
            ? url
            : null;
    }

    public virtual bool TitleCaseNames => true;
}

/// <summary>What every source needs from the catalog side, in one place.</summary>
internal static class BrandSourceExtensions
{
    public static string IdPrefix(this IBrandCatalogSource source) => source.BrandId + "-";

    public static string ProductId(this IBrandCatalogSource source, string code) => source.IdPrefix() + code.Trim().ToLowerInvariant();

    /// <summary>
    /// Direct brand, no network. No checkout URL: a cart with several products of the brand opens the first product's
    /// page (AffiliateService); the click id goes out as ?click_id=… (Affiliate default) and the product page ignores it.
    /// </summary>
    public static BrandInput BrandInput(this IBrandCatalogSource source) =>
        new(source.BrandId, source.DisplayName, source.WebsiteUrl, LogoUrl: null, AffiliateSource.Direct, Network: null, CheckoutUrl: null, ClickIdParameter: null, CommissionRateBps: null);

    public static bool Supplies(this IBrandCatalogSource source, CatalogSegment segment) => source.Segments.Contains(segment);

    public static SourceGender Gender(this CatalogSegment segment) => segment == CatalogSegment.Men ? SourceGender.Men : SourceGender.Women;

    public static string Word(this CatalogSegment segment) => segment == CatalogSegment.Men ? "men" : "women";
}
