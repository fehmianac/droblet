# Brand importers (`import-brand`)

Dev-only operator command that puts a brand's public products into the app catalog, through the same admin services
as the admin panel. No AI call. Images are hot-linked from the brand's CDN, never copied.

```
dotnet run --project tools/Ops -- import-brand --stage dev --brand <id> --segment women|men [--max N] [--max-pages N] [--delay-ms N] [--dry-run]
dotnet run --project tools/Ops -- import-brand --stage dev --list
dotnet run --project tools/Ops -- import-vakko --stage dev [--segment women|men] [--max N] [--max-pages N] [--delay-ms N] [--dry-run]
```

| option | default | limit |
|---|---|---|
| `--max` (products kept) | 100 | 1–200 |
| `--max-pages` (product pages fetched) | 400 | 1–600 |
| `--delay-ms` (pause between two requests) | 1200 | 1000–10000 |

`import-vakko` is the alias of `import-brand --brand vakko` (women unless `--segment men`). `--list` prints the
registered sources and the surveyed brands that have no source yet; it touches neither the network nor AWS. Both
commands are refused on prod. In GitHub Actions: `ops-dev.yml`, `command=import-brand`, `args="--brand vakko --segment men --dry-run"`.

## Registered sources

| `--brand` | site | segments | product data comes from | sizes | notes |
|---|---|---|---|---|---|
| `vakko` | vakko.com (SAP Commerce) | women, men | the page's `ng-state` script | with stock | category = the URL's slug; the men's slug table was checked against the live sitemap on 2026-11-23 (see `VakkoSource.MenSlugs`); suits, tuxedos and ties are left out (no category) |
| `gap` | gap.com.tr (Akinon) | women, men | JSON-LD `Product` + the page's size elements, struck price and analytics block | with stock | no category or gender in the URL: category = the garment word of the name, gender from the page. The sitemap mixes women, men, children and babies and was last written in April 2026 — expect many "not women / not men" and "out of stock" rows; raise `--max-pages` |
| `sarar` | sarar.com (T-Soft) | men, women | JSON-LD `Product` (in `@graph`) + the page's variant links | with stock | women = the "Sarar Woman" line; home textiles, ties and suits are never candidates. robots.txt asks for a truthful user agent: this source identifies itself as an importer (`SararSource.UserAgent`), and leaves out the product URLs its wildcard rules cover (`*new`, `*brand`, `*stock`, `*price` …) |
| `beymen` | beymen.com | women, men | the `BEYMEN.productMain` state object + JSON-LD (description) | **none** | own labels only — Beymen Club, Beymen Collection, Academia — recognised by the URL slug and checked on the page; Network, Divarese, Beymen Reborn (resale) and every designer are "other brand". Per-size stock is loaded from `/api`, which robots.txt disallows, so products are imported without a size list. Discovery reads the index and 8 of the 26 product sitemaps (≈ 5.5 MB each), spread evenly |

First run of each: `--dry-run --max 10`, read the table, then without. The hot-link sizes were checked with one image
request each: Gap 780×1186 (the size the page itself uses, ≈ 130 KB), Beymen 800×1114 (`mnresize/800/1115`, ≈ 65 KB),
Sarar 1200×1800 (`-B.jpg`, the page's zoom image, ≈ 330 KB — T-Soft has no size between it and the 450 px one).

## How it is built

```
BrandImport/
  BrandCatalogSource.cs    IBrandCatalogSource + BrandCatalogSource (defaults), SourceCandidate, SourceProduct, SourceAccess
  BrandSources.cs          the registry (All) and the surveyed brands without a source (Surveyed)
  PoliteFetcher.cs         the only way to the network: pacing, URL rules, request cap, stop rules
  SitemapXml.cs            sitemap → URLs + images, sitemap index → sitemaps, for any source that discovers through a sitemap
  SourceCategories.cs      category words for sites whose URL has no category ("…-maxi-elbise" → elbise → Dress)
  CandidatePicker.cs       which candidates are fetched, in which order (round-robin over categories, deterministic)
  SourceCatalogMapper.cs   SourceProduct → ProductInput (id, category, sizes, price, images, previous price)
  SourceColors.cs          the shared Turkish / English colour dictionary
  SourceText.cs            Turkish-aware title casing, HTML → text, folding
  ImportBrandCommand.cs    the loop: discover → pick → fetch → parse → map → validate → upsert → report
  Platforms/               parsers shared by several sites (SpartacusState: SAP Commerce; JsonLdProduct: schema.org Product + embedded JSON)
  Sources/                 one class per brand (VakkoSource, GapSource, SararSource, BeymenSource)
```

A source only answers brand questions: *where are the products* (`DiscoverAsync`), *what does this page say*
(`ParseProduct` → `SourceProduct`), *what do your category words and colour names mean* (`CategorySlugs`,
`ExtraColors`), *which image URL may be hot-linked* (`ImageUrl`), *is this your own label* (`IsOwnBrand`). Everything
else is shared and behaves the same for every brand:

- catalog id `"{brandId}-{code}"` (lower case); a product whose gender is not the run's segment is skipped;
- the name is title-cased with Turkish rules when the source says its site writes in capitals (`TitleCaseNames`);
- colours: the source's `ExtraColors` first, then the shared dictionary; unknown → `other`; at most 3;
- sizes: only the ones in stock, normalised; a one-size label gives no size list;
- price in minor units, TRY only (anything else is skipped as "no price in TRY");
- a new product sold below its list price is written twice (list price, then the real one) so the catalog's own rule
  stores the previous price; a re-run updates what changed and leaves the rest alone; nothing is ever retired.

## Adding a brand

1. **Survey first** (see the rules below): robots.txt, the sitemap it names, one product page. Write down what
   robots.txt disallows.
2. **One class** in `Sources/`, deriving from `BrandCatalogSource`: identity, `Segments`, `PriceBand`, `Access`
   (hosts + the denied path prefixes), `ImageHosts`, `DiscoverAsync`, `ParseProduct`, `CategorySlugs` per segment.
   If the page has a JSON-LD `Product`, start from `JsonLdProductParser` and check every field against the page (Gap's
   "availability" is not the sizes' stock); if the URL has no category, use the words of `SourceCategories`.
   If the site runs on a platform that already has a parser in `Platforms/`, use it; if the platform is new and
   other brands share it (Shopify, Salesforce Commerce …), put the parser in `Platforms/` so the next brand is a
   table and a URL pattern.
3. **One line** in `BrandSources.All` (and remove the brand from `BrandSources.Surveyed`).
4. **Fixtures** under `tests/OpsTests/Fixtures/<Brand>/`: real pages, trimmed (an in-stock discounted product, an
   out-of-stock one, one of the other gender) and an excerpt of the sitemap / listing.
5. **Tests** in `tests/OpsTests/BrandImport/<Brand>SourceTests.cs`: discovery parsing, page parsing, mapping, one
   end-to-end run with a fake `ISiteClient`. `BrandImportTests.Registry_EverySourceIsWellFormed` checks the rest. No
   test touches the network.
6. First real run with `--dry-run --max 10`, read the table, then without.

## Rules every source follows

These are not conventions: the fetcher and the argument parser enforce what they can, the rest is on the author.

- **Public pages only.** Plain GET requests of pages any visitor sees. Never sign in, never send credentials or
  session cookies of an account, never call the endpoints behind the account, the basket, the checkout or the search.
- **robots.txt is respected.** Every `Disallow` that could match a URL the source builds goes into
  `Access.DisallowedPathPrefixes`, every wildcard rule (`Disallow: *price`) into `Access.DisallowedFragments`; query
  strings are refused unless the source sets `AllowQuery` (filter, sort and search URLs are almost always disallowed
  and almost always carry one). A site whose robots.txt asks for a `Crawl-delay` gets at least that as `--delay-ms`;
  one that asks automated clients to identify themselves gets an honest `Access.UserAgent` instead of the tool's
  plain `Mozilla/5.0`. Data the page loads from a disallowed endpoint (Beymen's size stock) is done without.
- **At least one second between two requests**, sequential, one connection (`PoliteFetcher.MinDelay`; `--delay-ms`
  cannot go below 1000). The pause is taken before every request but the first — discovery included.
- **Hard caps.** `--max-pages` ≤ 600 pages and `--max` ≤ 200 products per run; discovery may use at most the source's
  `MaxDiscoveryRequests`. The fetcher refuses the request after the cap.
- **Stop on refusal.** HTTP 403 or 429 stops the run at once and nothing more is requested; so do three failed
  requests in a row, and ten unreadable pages in a row (the page format changed). Never retry, never rotate user
  agents or addresses, never work around a captcha or a JavaScript challenge: a site that blocks the tool is asked
  for a feed instead.
- **A site's written wishes count.** If robots.txt or the terms say automated collection is not wanted, or point to
  an official route (a product feed, an affiliate network, a catalog API), that route is the one to use — record it
  in the survey table and take it to the owner.
- **Hot-link, do not copy** images, at a modest size, from the brand's own image host only.
- **Dev only.** The commands are refused on prod; a prod catalog import is an owner decision.

## Survey of the requested brands (2026-11-23)

Read-only: at most three plain GETs per brand (robots.txt, the sitemap index it names, one product sitemap), user
agent `Mozilla/5.0`, two seconds apart, stopped at the first refusal. 42 requests in total. No product page was
fetched in the survey. After the owner's approval (2026-11-23) the product pages of Gap, Sarar, Zara and Beymen were
probed (at most 12 requests per brand, 28 in total, plus 9 to vakko.com for the men's slugs): Gap, Sarar and Beymen
have a source now, Zara is blocked. For every other brand "product page" below is still what the platform is known to
do, not something seen.

| brand | site used | robots.txt for product pages | product sitemap | sitemap carries | product page | bot protection seen | affiliate / feed route | verdict |
|---|---|---|---|---|---|---|---|---|
| Zara (women, men) | zara.com/tr | allowed (`/tr/tr/…-p….html`); a few single products, `?`-parameters, search, cart, user and `*/availability` paths disallowed | `sitemaps/sitemap-product-tr-tr.xml.gz`: 22 843 URLs (287 KB gzip), no category or gender in the URL | URLs only | **probed 2026-11-23: HTTP 200 with a 2 KB Akamai interstitial** (`bm-verify` meta refresh + a script that posts to `/_sec/verify`) instead of the product | Akamai Bot Manager JavaScript challenge | unknown | **blocked** for automated access (the sitemap is readable, the product page is not) → needs an official feed |
| Mango (women) | shop.mango.com | not readable | — | — | — | Vercel Security Checkpoint (HTTP 429 on robots.txt) | unknown | **blocked** for automated access → needs an official feed |
| H&M (women) | www2.hm.com | not readable | — | — | — | Akamai (HTTP 403 on robots.txt) | unknown | **blocked** for automated access → needs an official feed |
| Gap (women, men) | gap.com.tr | allowed; login, list, baskets, orders, account, users and sort / filter parameters disallowed | `sitemap-products-1.xml.gz` (on the store's S3 bucket): 2 332 URLs, last written 2026-04-28 | URLs + lastmod | server-rendered (Akinon): JSON-LD `Product`, sizes with stock, struck price | none seen (nginx) | unknown | **source built** (`--brand gap`) |
| Beymen (women, men) | beymen.com/tr | allowed (`/tr/p_…`); `/product/`, `/api`, cart and sort parameters disallowed; AI crawlers explicitly allowed | 26 files `product_N.xml`, 10 000 URLs each (5.5 MB each) | URLs + lastmod; the slug starts with the label; no category; every label of the department store (perfume, home …) | server-rendered: `BEYMEN.productMain` state + JSON-LD; **no per-size stock** (loaded from the disallowed `/api`) | Imperva (Incapsula cookie); all 8 requests passed | unknown | **source built** (`--brand beymen`), own labels only, no size list |
| Bluemint (men) | bluemint.com | allowed (Shopify defaults: cart, checkout, account, sorted / filtered collections disallowed) | 5 files per language; the sampled one: 195 URLs | URL + lastmod + one image with title | not fetched (Shopify: JSON-LD `Product` and a public product JSON are standard) | Cloudflare | robots.txt and `/agents.md` point agents to `https://www.bluemint.com/api/ucp/mcp` (UCP over MCP, JSON-RPC by POST); read 2026-11-23 | **no source yet — needs an agent identity** (owner chose the UCP/MCP endpoint on 2026-11-23; see "Bluemint and Kiğılı" below) |
| Sarar (men, women) | sarar.com | allowed; search, cart, member pages, `/srv/service/`, sort / filter parameters and any URL containing `new`, `brand`, `stock`, `price`, `type1`, `type2`, `discounted`, `arama` disallowed; asks agents for a truthful user agent | `xml/sitemap/product.xml`: 5 822 URLs (2.3 MB) | URL + lastmod + one image with title; no category in the URL; home textiles included | server-rendered (T-Soft): JSON-LD `Product` with the category path, variant links with stock | none seen | unknown (`/llms.txt` is an empty stub) | **source built** (`--brand sarar`) |
| Kiğılı (men) | kigili.com | allowed (Shopify defaults + search, tags, filter parameters disallowed) | 42 files over two languages; the sampled one: 1 001 URLs | URL + lastmod + one image with title | not fetched (Shopify) | Cloudflare | robots.txt: "Agents should use UCP/MCP for catalog, cart, and checkout"; `/agents.md` names `https://www.kigili.com/api/ucp/mcp`; read 2026-11-23 | **no source yet — needs an agent identity** (owner chose the UCP/MCP endpoint on 2026-11-23; see "Bluemint and Kiğılı" below) |
| Longchamp (young women) | longchamp.com | allowed (search, filters, `Product-Variation` disallowed) | one index per country site — **none for Turkey** among the ≈50 listed | not fetched | not fetched (Salesforce Commerce) | Cloudflare | unknown | no Turkish storefront found → no TRY price → **needs an official feed** or a Turkish retailer's catalog |
| Lululemon (young women) | shop.lululemon.com | not readable | — | — | — | Akamai (HTTP 403 on robots.txt) | unknown | **blocked** for automated access → needs an official feed |
| Alo (young women) | aloyoga.com | allowed (Shopify defaults) | 1 290 product files over all locales; the sampled one: 982 URLs | URL + lastmod + one image with title | not fetched (Shopify) | Cloudflare | robots.txt points agents to the store's UCP/MCP catalog endpoint | no Turkish storefront found → no TRY price; the site asks agents to use UCP/MCP → **needs an official feed** / owner decision |
| UGG (young women) | ugg.com | allowed (search, cart, checkout, filter parameters disallowed) | `sitemap_index.xml` → HTTP 403 | — | — | DataDome JavaScript challenge behind Cloudflare | unknown | **blocked** for automated access → needs an official feed |
| Golden Goose (young women) | goldengoose.com/ww/en | allowed; login, cart, wishlist, search disallowed; **`Crawl-delay: 10`** | `sitemap-product_en_GH.xml`: 14 741 URLs (6.1 MB) | URLs + lastmod | not fetched (Salesforce Commerce) | Akamai + Cloudflare | unknown | no Turkish storefront among the sitemaps → no TRY price → **needs an official feed**; if ever crawled: 10 s between requests |
| Sephora (young women) | sephora.com.tr | allowed (`/p/…html`); `Product-Variation`, checkout, filter parameters, `/on/demandware.store/` disallowed | 3 files, the sampled one: 5 001 URLs (1.1 MB) | URLs + lastmod | **not verified**: the 2026-11-23 probe with a truthful user agent (`catalog-import-bot/1.0 …`) got HTTP 403 "Access Denied" from Akamai on robots.txt itself and stopped there — one request, no sitemap, no product page (the survey's `Mozilla/5.0` had been let through) | Akamai (refuses a self-declared bot) + Cloudflare | robots.txt disallows `?awc=` (an Awin click parameter) — a hint, not a confirmation | **blocked for a client that says what it is** → the affiliate network's product feed is the route to ask for; **cosmetics have no catalog category** (below) |
| Legami (young women) | legami.com/en-gb | allowed; account, basket, checkout disallowed | one per country — none for Turkey; `sitemap-products_en_GB.xml`: 2 951 URLs with 16 142 images | URL + images with title | not fetched (Salesforce Commerce) | Cloudflare | unknown | no Turkish storefront → no TRY price → **needs an official feed**; stationery has no catalog category |
| Pop Mart (young women) | popmart.com | allowed (checkout, order, events disallowed) | none: `sitemap.xml` returns the JavaScript app's HTML shell | — | needs JavaScript (client-rendered app; Cloudflare Turnstile script on the page) | Cloudflare (+ Turnstile) | unknown | **needs a headless browser** — which the rules above rule out → needs an official feed; toys have no catalog category |
| Stanley (young women) | stanley1913.com | allowed by the rules (Shopify defaults), but the file's policy text says automated scraping is not permitted | 1 file: 292 URLs | URL + lastmod + one image with title | not fetched (Shopify) | Cloudflare | unknown | US store, no TRY price, and the site says no scraping → **needs an official feed** (or the Turkish distributor); drinkware has no catalog category |

Not checked, on purpose: Turkish distributors of Lululemon, UGG and Stanley (no site was given and none is named in
the pages read), and whether longchamp.com serves a `/tr` store outside its sitemap list.

### What that means

- **Built:** Gap (gap.com.tr), Sarar, Beymen (own labels) — see "Registered sources" above.
- **Waiting for an agent identity:** Bluemint and Kiğılı — the owner chose their UCP/MCP catalog endpoint, which
  wants a published agent profile and signed requests (below).
- **Blocked for automated access:** Zara (JavaScript challenge on the product page), Mango, H&M, Lululemon, UGG,
  Pop Mart (no server-rendered catalog), and Sephora TR for a client that identifies itself as a bot (HTTP 403 on
  robots.txt with the importer's truthful user agent; no catalog category either, below).
- **Official feed / other source needed:** Longchamp, Alo, Golden Goose, Legami, Stanley — no Turkish storefront
  was found, so there is no TRY price to import even where the pages are readable.
- None of the surveyed sites runs on Vakko's platform (SAP Commerce / Spartacus). Gap, Sarar and Beymen all describe
  the product in JSON-LD: `Platforms/JsonLdProduct.cs` is shared by the three. Four of the remaining sites run on
  Shopify and five on Salesforce Commerce: a `Platforms/` parser for either would serve several brands at once (for
  Shopify that parser reads the UCP/MCP catalog responses, not pages).

### Bluemint and Kiğılı: the UCP/MCP endpoint (read 2026-11-23)

The owner decided on 2026-11-23 to import both through the catalog endpoint their robots.txt names, not by reading
product pages. Four requests per store, user agent `catalog-import-bot/1.0 (automated product importer)`, at least
1.5 s apart: `robots.txt`, `/agents.md`, `/.well-known/ucp`, and one `tools/list` call. No tool was called and no
product was read.

- **What it is.** Shopify's implementation of the Universal Commerce Protocol (version `2026-08-25`), served as MCP:
  JSON-RPC 2.0 by `POST` to `https://www.{bluemint|kigili}.com/api/ucp/mcp` (the profile at `/.well-known/ucp` names
  the same path on `bluemint-online.myshopify.com` / `kigili-turkiye.myshopify.com`). `tools/list` answered a plain
  client with HTTP 200 and 14 tools, identical on both stores; the catalog ones are `search_catalog` (query and / or
  filters, `pagination.cursor` + `limit`, `filters.available` true by default, buyer `context` with country,
  language and currency), `lookup_catalog` (at most 10 ids) and `get_product`.
- **What a product carries** (the tools' output schema; not seen with real data): id (`gid://shopify/Product/…`),
  handle, title, description HTML, `url`, price and list price as ranges and per variant (minor units + currency),
  options with `available` per value (sizes, colours), variants with sku and availability, media URLs, categories
  (taxonomy), tags, collections. Everything a source needs, including the struck price and per-size stock.
- **Why there is no source yet.** Every tool's input schema requires `meta.ucp-agent.profile`: the URI of the
  calling agent's own UCP profile. `/agents.md` adds that agents "must identify their requests as agent-initiated"
  and that server-to-server requests "must use Web Bot Auth" (signed HTTP requests, with the agent's public keys
  published). The importer has neither a profile nor signing keys, and inventing a profile URI would be a false
  identity — the opposite of what the site asks. Whether the endpoint refuses a call without them was **not**
  tested, on purpose.
- **Also stated:** `Terms of Service: https://www.shopify.com/legal/terms` (not read), back off on 429 and respect
  `Retry-After`, checkout only with the buyer's approval. `/agents.md` allows reading public product pages for
  "additional context" under the same identification rule — the owner's decision excludes that route anyway.
- **What it takes to build it:** (1) the owner publishes an agent profile at a URL of ours and decides whether to
  set up Web Bot Auth keys (both make the project visible to the stores); (2) one probe of `search_catalog` with
  that identity, to see real rows — how gender shows (tags, collections or category), whether TRY is returned for
  `address_country: TR`, the image URL's size parameter; (3) then: `PoliteFetcher` gets a paced, capped `POST`
  (today it only does GET), one shared `Platforms/` client-parser for Shopify UCP, and two small sources.

### Decisions the new sources leave to the owner

- **Network and Divarese** are Beymen Group brands sold on beymen.com; they are not Beymen labels and are skipped
  ("other brand"). Adding them is one prefix and one label each in `BeymenSource` — under the brand "Beymen" or as
  brands of their own is the question.
- **Beymen sizes.** The page names the size run in its analytics data (`"sizes":"{34,36,38}"`) without saying which
  are in stock; the importer writes no size list rather than a possibly wrong one.
- **Sarar's price band** is `HighStreet` and Beymen's `LuxuryTouch` (the catalog has two bands): a one-word change in
  the source if the owner sees them differently.
- **Zara** needs an official feed or an affiliate network: the tool never works around a challenge.

## Not built, to decide first

**Non-clothing brands (Sephora, Legami, Pop Mart, Stanley).** (Sephora TR's product page could not be verified on
2026-11-23: see its survey row.) `ProductCategory` has 18 values, all apparel, shoes,
bags and accessories, and is used as a closed list everywhere: `CatalogRules.SlotOf` / `ItemCategoryOf` (a category
it does not know becomes a *top* when a product enters a wardrobe or a look), the "complete the look" and similar
rules, the store filters of the API, the admin product form, and in the app the category list, the store chips, the
outfit-builder slot tables and the translations. Importing these brands needs, at least: new enum values (appended;
the names are on the wire), a rule that keeps them out of every outfit / wardrobe / stylist path, new category names
and chips in the app and the admin, and a decision about older app versions that do not know the new values.

**"Aimed at young women".** A catalog product has a segment (women / men / unisex) and a price band; neither it
nor the brand has a tag, an audience or an age field. The smallest addition that fits "these brands are shown in the
women's segment": one optional field on the *brand* (for example `audience: "young"`), set once per brand in the
admin, returned with the brand — products inherit it and the importers need no change. A per-product list of tags
is the larger alternative if single products of a brand should be marked.
