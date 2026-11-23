using Ops.Commands.BrandImport.Sources;

namespace Ops.Commands.BrandImport;

/// <summary>A brand the owner asked for that has no source: what the 2026-11-23 survey and product-page probes found (README.md has the full table).</summary>
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
        new GapSource(),
        new SararSource(),
        new BeymenSource(),
    ];

    public static IBrandCatalogSource? Find(string? brandId) => All.FirstOrDefault(s => string.Equals(s.BrandId, brandId, StringComparison.Ordinal));

    /// <summary>
    /// import-brand --list shows these under the registered sources. Zara's verdict is from a product-page probe, Bluemint's and
    /// Kiğılı's from reading their agent instructions and the endpoint's tool list; the others are the survey's
    /// (robots.txt and sitemaps only), not a promise.
    /// </summary>
    public static readonly IReadOnlyList<SurveyedBrand> Surveyed =
    [
        new("zara", "Zara", "zara.com/tr", "women, men", "blocked for automated access: the product sitemap is readable (22 843 URLs) but a product page answers a plain client with Akamai's JavaScript challenge (bm-verify interstitial) — needs an official feed"),
        new("mango", "Mango", "shop.mango.com/tr", "women", "blocked for automated access (HTTP 429, Vercel security checkpoint) — needs an official feed"),
        new("hm", "H&M", "www2.hm.com/tr_tr", "women", "blocked for automated access (HTTP 403, Akamai) — needs an official feed"),
        new("bluemint", "Bluemint", "bluemint.com", "men", "Shopify; owner chose the store's UCP/MCP catalog endpoint (/api/ucp/mcp, tool search_catalog) over crawling: it lists its tools to a plain client, but every tool call requires an agent profile URI and agents.md requires signed requests (Web Bot Auth) — no source until the owner publishes an agent identity"),
        new("kigili", "Kiğılı", "kigili.com", "men", "Shopify; owner chose the store's UCP/MCP catalog endpoint (/api/ucp/mcp, tool search_catalog) over crawling: it lists its tools to a plain client, but every tool call requires an agent profile URI and agents.md requires signed requests (Web Bot Auth) — no source until the owner publishes an agent identity"),
        new("longchamp", "Longchamp", "longchamp.com", "women", "no Turkish storefront among the sitemaps of robots.txt — no TRY price; needs an official feed or a Turkish retailer"),
        new("lululemon", "Lululemon", "shop.lululemon.com", "women", "blocked for automated access (HTTP 403, Akamai) — needs an official feed"),
        new("alo", "Alo", "aloyoga.com", "women", "Shopify, no Turkish storefront (no TRY price); robots.txt asks agents to use its UCP/MCP catalog endpoint"),
        new("ugg", "UGG", "ugg.com", "women", "blocked for automated access (HTTP 403, DataDome JavaScript challenge on the sitemap) — needs an official feed"),
        new("goldengoose", "Golden Goose", "goldengoose.com", "women", "product sitemap readable (14 741 URLs), Crawl-delay 10; no Turkish storefront (no TRY price); Akamai in front"),
        new("sephora", "Sephora", "sephora.com.tr", "women", "blocked for a client that says it is a bot (HTTP 403 from Akamai on robots.txt, 2026-11-23): product page unverified — needs the affiliate feed (Awin hint); cosmetics — no catalog category"),
        new("legami", "Legami", "legami.com", "women", "product sitemap readable (2 951 URLs); no Turkish storefront (no TRY price); stationery — no catalog category"),
        new("popmart", "Pop Mart", "popmart.com", "women", "no sitemap (the URL returns the JavaScript app with a Turnstile challenge) — needs a headless browser or an official feed; toys — no catalog category"),
        new("stanley", "Stanley", "stanley1913.com", "women", "Shopify US (no TRY price); robots.txt says automated scraping is not permitted — needs an official feed; drinkware — no catalog category"),
    ];
}
