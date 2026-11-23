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

Vakko's men's slug table (`VakkoSource.MenSlugs`) was written from the notes of the women's run and has not met the
live sitemap yet: the first men's run should be `--dry-run`. Suits, tuxedos and ties are left out (the catalog has
no category for them).

## How it is built

```
BrandImport/
  BrandCatalogSource.cs    IBrandCatalogSource + BrandCatalogSource (defaults), SourceCandidate, SourceProduct, SourceAccess
  BrandSources.cs          the registry (All) and the surveyed brands without a source (Surveyed)
  PoliteFetcher.cs         the only way to the network: pacing, URL rules, request cap, stop rules
  SitemapXml.cs            sitemap → URLs + images, for any source that discovers through a sitemap
  CandidatePicker.cs       which candidates are fetched, in which order (round-robin over categories, deterministic)
  SourceCatalogMapper.cs   SourceProduct → ProductInput (id, category, sizes, price, images, previous price)
  SourceColors.cs          the shared Turkish / English colour dictionary
  SourceText.cs            Turkish-aware title casing, HTML → text, folding
  ImportBrandCommand.cs    the loop: discover → pick → fetch → parse → map → validate → upsert → report
  Platforms/               parsers shared by every site of one e-commerce platform (SpartacusState: SAP Commerce)
  Sources/                 one class per brand (VakkoSource)
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
  `Access.DisallowedPathPrefixes`; query strings are refused unless the source sets `AllowQuery` (filter, sort and
  search URLs are almost always disallowed and almost always carry one). A site whose robots.txt asks for a
  `Crawl-delay` gets at least that as `--delay-ms`.
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
agent `Mozilla/5.0`, two seconds apart, stopped at the first refusal. 42 requests in total. **No product page was
fetched for any brand** — the third request went to a product sitemap, because no product URL is known before it —
so "product page" below is what the platform is known to do, not something this survey saw. One product-page probe
per brand is the next step before any adapter is written.

| brand | site used | robots.txt for product pages | product sitemap | sitemap carries | product page | bot protection seen | affiliate / feed route | verdict |
|---|---|---|---|---|---|---|---|---|
| Zara (women) | zara.com/tr | allowed (`/tr/tr/…-p….html`); a few single products, `?`-parameters, search, cart and user paths disallowed | `sitemaps/sitemap-product-tr-tr.xml.gz`: 22 843 URLs (287 KB gzip) | URLs only | not fetched | Akamai | unknown | discovery works like Vakko; **product page unverified** (Akamai in front) — probe one page before deciding |
| Mango (women) | shop.mango.com | not readable | — | — | — | Vercel Security Checkpoint (HTTP 429 on robots.txt) | unknown | **blocked** for automated access → needs an official feed |
| H&M (women) | www2.hm.com | not readable | — | — | — | Akamai (HTTP 403 on robots.txt) | unknown | **blocked** for automated access → needs an official feed |
| Gap (women) | gap.com.tr | allowed; login, list, baskets, orders, account, users and sort / filter parameters disallowed | `sitemap-products-1.xml.gz` (on the store's S3 bucket): 2 332 URLs | URLs + lastmod | not fetched | none seen (nginx) | unknown | **adapter looks feasible like Vakko**; product page unverified |
| Beymen (women, men) | beymen.com/tr | allowed (`/tr/p_…`); `/product/`, `/api`, cart and sort parameters disallowed; AI crawlers explicitly allowed | 26 files `product_N.xml`, 10 000 URLs each (5.5 MB each) | URLs + lastmod; no category in the URL; every label of the department store (perfume, home …) | not fetched | Imperva (Incapsula cookie); the three requests passed | unknown | discovery works, but a category must come from the page or the category sitemap and the labels must be filtered; **product page unverified** |
| Bluemint (men) | bluemint.com | allowed (Shopify defaults: cart, checkout, account, sorted / filtered collections disallowed) | 5 files per language; the sampled one: 195 URLs | URL + lastmod + one image with title | not fetched (Shopify: JSON-LD `Product` and a public product JSON are standard) | Cloudflare | robots.txt points agents to the store's UCP/MCP catalog endpoint | technically feasible (one Shopify parser would serve four brands), **but the site asks agents to use its UCP/MCP endpoint — owner decision** |
| Sarar (men) | sarar.com | allowed; search, cart, member pages, `/srv/service/`, sort / filter parameters disallowed | `xml/sitemap/product.xml`: 5 822 URLs (2.3 MB) | URL + lastmod + one image with title; no category in the URL; home textiles included | not fetched (T-Soft) | none seen | unknown (robots.txt mentions `/llms.txt`) | **adapter looks feasible like Vakko**; category from the page; product page unverified |
| Kiğılı (men) | kigili.com | allowed (Shopify defaults + search, tags, filter parameters disallowed) | 42 files over two languages; the sampled one: 1 001 URLs | URL + lastmod + one image with title | not fetched (Shopify) | Cloudflare | robots.txt: "Agents should use UCP/MCP for catalog, cart, and checkout" | technically feasible (Shopify), **but the site asks agents to use its UCP/MCP endpoint — owner decision** |
| Longchamp (young women) | longchamp.com | allowed (search, filters, `Product-Variation` disallowed) | one index per country site — **none for Turkey** among the ≈50 listed | not fetched | not fetched (Salesforce Commerce) | Cloudflare | unknown | no Turkish storefront found → no TRY price → **needs an official feed** or a Turkish retailer's catalog |
| Lululemon (young women) | shop.lululemon.com | not readable | — | — | — | Akamai (HTTP 403 on robots.txt) | unknown | **blocked** for automated access → needs an official feed |
| Alo (young women) | aloyoga.com | allowed (Shopify defaults) | 1 290 product files over all locales; the sampled one: 982 URLs | URL + lastmod + one image with title | not fetched (Shopify) | Cloudflare | robots.txt points agents to the store's UCP/MCP catalog endpoint | no Turkish storefront found → no TRY price; the site asks agents to use UCP/MCP → **needs an official feed** / owner decision |
| UGG (young women) | ugg.com | allowed (search, cart, checkout, filter parameters disallowed) | `sitemap_index.xml` → HTTP 403 | — | — | DataDome JavaScript challenge behind Cloudflare | unknown | **blocked** for automated access → needs an official feed |
| Golden Goose (young women) | goldengoose.com/ww/en | allowed; login, cart, wishlist, search disallowed; **`Crawl-delay: 10`** | `sitemap-product_en_GH.xml`: 14 741 URLs (6.1 MB) | URLs + lastmod | not fetched (Salesforce Commerce) | Akamai + Cloudflare | unknown | no Turkish storefront among the sitemaps → no TRY price → **needs an official feed**; if ever crawled: 10 s between requests |
| Sephora (young women) | sephora.com.tr | allowed (`/p/…html`); `Product-Variation`, checkout, filter parameters, `/on/demandware.store/` disallowed | 3 files, the sampled one: 5 001 URLs (1.1 MB) | URLs + lastmod | not fetched (Salesforce Commerce) | Akamai + Cloudflare | robots.txt disallows `?awc=` (an Awin click parameter) — a hint, not a confirmation | discovery works like Vakko; product page unverified; **cosmetics have no catalog category** (below) |
| Legami (young women) | legami.com/en-gb | allowed; account, basket, checkout disallowed | one per country — none for Turkey; `sitemap-products_en_GB.xml`: 2 951 URLs with 16 142 images | URL + images with title | not fetched (Salesforce Commerce) | Cloudflare | unknown | no Turkish storefront → no TRY price → **needs an official feed**; stationery has no catalog category |
| Pop Mart (young women) | popmart.com | allowed (checkout, order, events disallowed) | none: `sitemap.xml` returns the JavaScript app's HTML shell | — | needs JavaScript (client-rendered app; Cloudflare Turnstile script on the page) | Cloudflare (+ Turnstile) | unknown | **needs a headless browser** — which the rules above rule out → needs an official feed; toys have no catalog category |
| Stanley (young women) | stanley1913.com | allowed by the rules (Shopify defaults), but the file's policy text says automated scraping is not permitted | 1 file: 292 URLs | URL + lastmod + one image with title | not fetched (Shopify) | Cloudflare | unknown | US store, no TRY price, and the site says no scraping → **needs an official feed** (or the Turkish distributor); drinkware has no catalog category |

Not checked, on purpose: Turkish distributors of Lululemon, UGG and Stanley (no site was given and none is named in
the pages read), and whether longchamp.com serves a `/tr` store outside its sitemap list.

### What that means

- **Like Vakko, after one product-page probe each:** Gap (gap.com.tr), Sarar, Sephora TR; Zara and Beymen if their
  pages answer a plain client (both sit behind bot protection); Bluemint and Kiğılı if the owner is comfortable
  reading product pages of a site that asks agents to use its catalog endpoint instead.
- **Blocked for automated access:** Mango, H&M, Lululemon, UGG, Pop Mart (no server-rendered catalog).
- **Official feed / other source needed:** Longchamp, Alo, Golden Goose, Legami, Stanley — no Turkish storefront
  was found, so there is no TRY price to import even where the pages are readable.
- None of the surveyed sites is known to run on Vakko's platform (SAP Commerce / Spartacus), so no second source
  was added. Four of them run on Shopify and five on Salesforce Commerce: a `Platforms/` parser for either would
  serve several brands at once.

## Not built, to decide first

**Non-clothing brands (Sephora, Legami, Pop Mart, Stanley).** `ProductCategory` has 18 values, all apparel, shoes,
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
