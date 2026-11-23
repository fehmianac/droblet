using Ops.Commands.BrandImport.Sources;

namespace Ops.Commands.BrandImport;

/// <summary>A brand the owner asked for that has no source yet: what the 2026-11-23 survey found (README.md has the full table).</summary>
internal sealed record SurveyedBrand(string Id, string Name, string Site, string Segment, string Verdict);

/// <summary>
/// The registry: adding a brand = one <see cref="IBrandCatalogSource"/> class + one line in <see cref="All"/> (and
/// removing its line from <see cref="Surveyed"/>). import-brand --brand takes the ids of <see cref="All"/>.
/// </summary>
internal static class BrandSources
{
    public static readonly IReadOnlyList<IBrandCatalogSource> All =
    [
        new VakkoSource(),
    ];

    public static IBrandCatalogSource? Find(string? brandId) => All.FirstOrDefault(s => string.Equals(s.BrandId, brandId, StringComparison.Ordinal));

    /// <summary>import-brand --list shows these under the registered sources. Verdicts are the survey's, not a promise: no product page was fetched.</summary>
    public static readonly IReadOnlyList<SurveyedBrand> Surveyed =
    [
        new("zara", "Zara", "zara.com/tr", "women", "product sitemap readable (22 843 URLs); product page untested, Akamai in front"),
        new("mango", "Mango", "shop.mango.com/tr", "women", "blocked for automated access (HTTP 429, Vercel security checkpoint) — needs an official feed"),
        new("hm", "H&M", "www2.hm.com/tr_tr", "women", "blocked for automated access (HTTP 403, Akamai) — needs an official feed"),
        new("gap", "Gap", "gap.com.tr", "women", "product sitemap readable (2 332 URLs); product page untested — adapter looks feasible"),
        new("beymen", "Beymen", "beymen.com", "women, men", "product sitemaps readable (26 × 10 000 URLs, every label of the store); product page untested, Imperva in front"),
        new("bluemint", "Bluemint", "bluemint.com", "men", "Shopify; product sitemaps readable; robots.txt asks agents to use its UCP/MCP catalog endpoint — owner decision"),
        new("sarar", "Sarar", "sarar.com", "men", "T-Soft; product sitemap readable (5 822 URLs with an image); product page untested — adapter looks feasible"),
        new("kigili", "Kiğılı", "kigili.com", "men", "Shopify; product sitemaps readable; robots.txt asks agents to use its UCP/MCP catalog endpoint — owner decision"),
        new("longchamp", "Longchamp", "longchamp.com", "women", "no Turkish storefront among the sitemaps of robots.txt — no TRY price; needs an official feed or a Turkish retailer"),
        new("lululemon", "Lululemon", "shop.lululemon.com", "women", "blocked for automated access (HTTP 403, Akamai) — needs an official feed"),
        new("alo", "Alo", "aloyoga.com", "women", "Shopify, no Turkish storefront (no TRY price); robots.txt asks agents to use its UCP/MCP catalog endpoint"),
        new("ugg", "UGG", "ugg.com", "women", "blocked for automated access (HTTP 403, DataDome JavaScript challenge on the sitemap) — needs an official feed"),
        new("goldengoose", "Golden Goose", "goldengoose.com", "women", "product sitemap readable (14 741 URLs), Crawl-delay 10; no Turkish storefront (no TRY price); Akamai in front"),
        new("sephora", "Sephora", "sephora.com.tr", "women", "product sitemaps readable (3 × ≈5 000 URLs); product page untested; cosmetics — no catalog category"),
        new("legami", "Legami", "legami.com", "women", "product sitemap readable (2 951 URLs); no Turkish storefront (no TRY price); stationery — no catalog category"),
        new("popmart", "Pop Mart", "popmart.com", "women", "no sitemap (the URL returns the JavaScript app with a Turnstile challenge) — needs a headless browser or an official feed; toys — no catalog category"),
        new("stanley", "Stanley", "stanley1913.com", "women", "Shopify US (no TRY price); robots.txt says automated scraping is not permitted — needs an official feed; drinkware — no catalog category"),
    ];
}
