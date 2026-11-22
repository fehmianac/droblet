# Droblet API — Store, Social, Settings, Analytics, Weather

Contract for the mobile app (E8 Keşfet/mağaza, E9 Sosyal, E11 Ayarlar, analytics events, weather) and the admin panel
(`v1/admin/*`). Base URL (dev): `https://b8lvaj4r5e.execute-api.eu-central-1.amazonaws.com/dev`.

Not in this document: wardrobe items, looks, today/plan/calendar, stylist/trips, try-on, palette, profile counters — see [wardrobe-looks-plan-stylist.md](wardrobe-looks-plan-stylist.md). Every endpoint is listed in [README.md](README.md).

## 1. Conventions

| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <accessToken>` on everything except the two postback routes and `GET v1/invite/{code}`. Missing/invalid token → `401` (empty body). |
| Admin | `v1/admin/*` needs an **admin panel** token (separate admin accounts, sign-in with password + e-mailed code) whose role holds the route's permission — see [admin.md](admin.md). An app token → `401`; missing permission → `403 forbidden`. The mobile app never calls these. |
| JSON | camelCase. Enums are camelCase strings (`highStreet`, `followersOnly`). Unknown enum value or malformed JSON → `400 validation_failed`. |
| Errors | ProblemDetails: `{ "type", "title", "status", "code" }` — `code` is the stable value to switch on. Validation: `400` with `code: "validation_failed"` and `errors: { "<field>": ["<code>"] }`. |
| No prose | The API never returns sentences of its own. Only stored content (product names, edit titles, city names…) is text; everything else is a code or enum the client translates. Push notifications are the one exception (§9). |
| Language | Stored content is resolved to one language per request: **profile `language`** → `Accept-Language` → `tr`. Missing translation → default language (`tr`). Supported languages come from config `Localization:SupportedLanguages` (`tr`, `en`); a new language is config + data. This one list is used by every language check in the API (profile validation, registration, AI text, password-reset e-mail). The profile language is **set at registration** (e-mail, Apple, Google) from the request's `Accept-Language` when it names a supported language, else `tr`. |
| Money | Integer minor units (`priceMinor`, kuruş) + ISO `currency` (`TRY`). No formatting server side. Totals are computed from the current catalog on every read. |
| Time | UTC ISO-8601 (`2026-11-18T09:00:00Z`). Calendar days are `yyyy-MM-dd` strings. |
| Privacy | A cross-user read that is not allowed returns `404` — indistinguishable from "does not exist". Never `403`. |
| Paging | `pageToken` is opaque; pass it back unchanged. `null` = last page. |
| Idempotency | Stated per endpoint. Replaying any `PUT`/`DELETE` here is safe. |

### Enums

| Enum | Values |
|---|---|
| `priceBand` | `highStreet`, `luxuryTouch` |
| `category` | `tshirt`, `shirt`, `blouse`, `knitwear`, `sweatshirt`, `jacket`, `coat`, `trousers`, `jeans`, `skirt`, `shorts`, `dress`, `shoes`, `bag`, `accessory`, `swimwear`, `skiwear`, `activewear` |
| `slot` (catalog products, `complete`) | `top`, `bottom`, `outerwear`, `shoes`, `bag`, `onePiece`, `accessory` |
| look piece `slot` (`SocialLookDto.pieces[].slot`) | the wardrobe `OutfitSlot`: `top`, `bottom`, `outerwear`, `shoes`, `bagAccessory` |
| wardrobe item `category` (match items, `people/{handle}/item`) | the wardrobe `ItemCategory`: `top`, `bottom`, `dress`, `outerwear`, `shoes`, `bag`, `accessory`, `beachwear`, `skiwear` |
| `source` (affiliate) | `network`, `direct` |
| `lookRef.kind` | `edit` (weekly edit look id), `collection` (creator / series look id), `user` (a user's look id) |
| conversion `status` | `pending`, `approved`, `rejected` |
| purchase prompt `status` | `none`, `pending`, `accepted`, `dismissed` |
| `closetVisibility` | `public`, `followersOnly` (default for new accounts, decision 7), `private` |
| `followState` | `none`, `requested` (pending, not following), `following` |
| share `channel` | `whatsapp`, `pinterest`, `link` |
| share `targetKind` | `app`, `profile`, `look`, `product`, `edit` |
| report `targetKind` | `profile`, `look`, `item` |
| report `reason` | `spam`, `inappropriate`, `harassment`, `impersonation`, `minorSafety`, `other` |
| report `status` | `open`, `resolved` |
| report `resolution` | `dismissed`, `contentRemoved`, `userWarned`, `userSuspended` |
| device `platform` | `ios`, `android` |
| weather `condition` | `clear`, `partlyCloudy`, `cloudy`, `fog`, `drizzle`, `rain`, `snow`, `showers`, `thunderstorm`, `unknown` |
| content collection `kind` | `creator`, `series` |
| `segment` | `women` · `men` (`teen` rejected, `segment_not_available`) — [G](segments.md) |
| `styleTags` | women: `minimal`, `classic`, `quietLuxury`, `street`, `boho`, `sporty`, `romantic`, `officeChic`, `colorful`, `vintage`; men: `minimal`, `classic`, `smartCasual`, `tailored`, `quietLuxury`, `street`, `sporty`, `vintage`, `colorful` ([G §2](segments.md)) |
| product / library `segment` | `women`, `men`, `unisex` ([G](segments.md)) |

### Shared shapes

```jsonc
// ProductDto — public product. The affiliate link is NOT here; it only comes from checkout.
{ "id": "hs-white-shirt", "brandId": "gap", "brandName": "Gap",
  "name": "Beyaz Poplin Gömlek", "description": "…",          // resolved language
  "category": "shirt", "slot": "top",
  "colors": ["white"], "sizes": ["XS","S","M","L"],            // sizes may be [] (bags, accessories)
  "priceMinor": 100000, "currency": "TRY",
  "previousPriceMinor": 120000,                                // only when the last price change was a drop, else null
  "priceBand": "highStreet", "images": ["https://…"],
  "available": true,                                           // false = retired ("stokta yok"); still resolvable
  "createdAt": "2026-11-18T09:00:00Z",
  "segment": "women" }                                         // women | men | unisex; lists show the user's segment + unisex (G §5)

// LookRef — where an add-to-cart / watch / checkout came from (optional everywhere)
{ "kind": "edit", "id": "edit-sample-2026-w47-d1" }   // kind edit | collection | user | feedPost (an Akış post: its "Satın al" clicks and conversions are attributed to it)

// LocalizedText (admin + seed only)
{ "tr": "Keten Gömlek", "en": "Linen Shirt" }                  // default language (tr) required where the text is required
```

## 2. Keşfet / content (screens 08, 20)

| Method | Path | Result |
|---|---|---|
| GET | `v1/content/edit/current` | `EditDto` — latest published edit of the user's segment whose week has started. `404 not_found` when none. |
| GET | `v1/content/edit/{id}` | `EditDto`. `404 not_found` (unknown, draft or retired). |
| GET | `v1/content/creator` | `ContentCollectionDto[]` — creator / influencer collections. **Empty until content is published** (A-7; placeholder names only). |
| GET | `v1/content/creator/{id}/look` | `ContentLookDto[]`. `404 not_found`. |
| GET | `v1/content/series-outfit` | `ContentCollectionDto[]` — "dizi outfitleri". Empty by default. |
| GET | `v1/content/series-outfit/{id}/look` | `ContentLookDto[]`. `404 not_found`. |

```jsonc
// EditDto
{ "id": "edit-sample-2026-w47", "title": "Sonbahar katmanları", "subtitle": "Yedi gün, yedi look.",
  "coverImageUrl": "https://…", "weekStart": "2026-11-16", "weekEnd": "2026-11-22", "segment": "women",
  "sponsored": false, "sponsorName": null,                    // sponsored=true → show the "Sponsorlu" label
  "looks": [
    { "id": "edit-sample-2026-w47-d1", "day": 1,              // 1 = Monday … 7 = Sunday; always 7 looks
      "title": "Ofis", "styleNote": "Net çizgiler, sakin renkler.", "imageUrl": "https://…",
      "variants": [                                           // 1–2 entries, one per price band
        { "priceBand": "highStreet",  "products": [ProductDto], "totalMinor": 400000, "currency": "TRY" },
        { "priceBand": "luxuryTouch", "products": [ProductDto], "totalMinor": 2000000, "currency": "TRY" } ] } ] }

// ContentCollectionDto
{ "id": "creator-1", "kind": "creator", "title": "Editör 1", "subtitle": null, "imageUrl": null, "sponsored": false, "sponsorName": null,
  "handle": "editor1" }   // the creator's Droblet @handle while an account holds it, else null → "Arkadaş bul" creator row opens v1/tenant/people/{handle}

// ContentLookDto
{ "id": "look-1", "collectionId": "creator-1", "title": "Hafta sonu", "note": null, "imageUrl": null,
  "products": [ProductDto], "totalMinor": 250000, "currency": "TRY" }
```

`totalMinor` counts available products only. "Hide what I already own" (screen 08, Sunum) is done on the client with the
wardrobe data or with the match endpoint below.

## 2b. Akış F1 — editor posts and stories (canvas 06″, decisions 16–19)

Akış is the app's first tab. F1 = **editor content only**, entered in the admin panel: posts by "Droblet Edit" or a
selected stylist (placeholder names only, A-7) and editor stories. Interactions: ♡ like (with count), save, "Üzerimde dene"
(try-on target `feedPost`, W §7), buy (each product opens the brand page through the existing checkout). **No comments
(ever), no share, no follow, no sponsored content (F3), no user looks (F2).** Teens: every route here is open (decision 17);
the app hides prices / buy for them (teen `commerce` restriction) — the server sends the same shape. Only the friends'
feed `GET v1/tenant/feed` is closed to teens (`social`); it is unchanged.

| Method | Path | Result |
|---|---|---|
| GET | `v1/content/feed?occasion=&pageToken=` | `{ "items": [FeedPostDto], "pageToken": "…"|null }`. Published, not retired, `publishAt` ≤ now, segment = the user's segment or none. Order: `publishAt` desc, then `sortOrder` asc (then id). Page size `ContentFeed:PageSize` (10). `occasion` (optional) = one or more comma-separated `Occasion` wire names; the app's tabs: Ofis = `office`, Hafta sonu = `weekend`, **Davet = `dinner,wedding`** (owner decision 2026-11-22). Any unknown part → `400 validation_failed`. The token is a position (a post retired meanwhile never shifts the next page); an unreadable token starts from the top. |
| GET | `v1/content/feed/story` | `FeedStoryDto[]` — published, not retired, inside `[publishAt, expiresAt)`, the user's segment or none. Order: `sortOrder` asc (editors pin), then `publishAt` desc. At most `ContentFeed:MaxStories` (20). |
| PUT | `v1/tenant/feed-post/{id}/like` | `{ "liked": true, "likeCount": 1284 }`. Idempotent. `404 not_found` when the post is unknown, a draft, scheduled or retired. |
| DELETE | `v1/tenant/feed-post/{id}/like` | `{ "liked": false, "likeCount": 1283 }`. Idempotent. Same `404`. |
| PUT | `v1/tenant/feed-post/{id}/save` | `204`. Idempotent (a repeat keeps the first save time). Same `404`. |
| DELETE | `v1/tenant/feed-post/{id}/save` | `204`, always (idempotent). |
| GET | `v1/tenant/feed-post/saved` | `FeedPostDto[]`, newest save first. Posts retired or unpublished since are left out. |

```jsonc
// FeedPostDto — text in the request language (profile → Accept-Language → default), like every content read
{ "id": "01J…",
  "author": { "kind": "edit", "name": "Droblet Edit", "handle": null, "imageUrl": null, "verified": true },  // kind edit | stylist; verified = true only for kind edit (Droblet Edit), never for stylists
  "occasion": "office", "publishedAt": "2026-11-22T07:00:00Z",          // publishedAt = the post's publishAt
  "title": "Ofiste bordo & camel", "note": "…" | null,
  "images": ["https://…"],                                              // 1–4
  "products": [ { /* ProductDto, every field */ "ownedSimilar": true } ],  // 0–8; retired products stay listed with available: false
  "buyableCount": 2,                                                     // products that are available and not ownedSimilar
  "likeCount": 1284, "liked": false, "saved": false }

// FeedStoryDto
{ "id": "…", "author": { "name": "Droblet Edit", "imageUrl": null }, "imageUrl": "https://…", "headline": "Ofiste bordo & camel",
  "product": ProductDto | null, "publishedAt": "…" }
```

**`ownedSimilar`** ("benzeri gardırobunda var"). There is no server-side wardrobe ↔ product similarity yet (the edit
screen's "hide what I already own" is client-side and exact), so the rule is: the caller has an item added from this
product (`item.productId`), **or** an item of the same wardrobe category (`CatalogRules.ItemCategoryOf`) whose main
colour (first colour id) is one of the product's colours. Rule-based, free, no AI.

**Like count.** Kept in a counter row apart from the post (an admin edit never overwrites it), written in one
transaction with the user's like row (versioned, retried on a lost race — `ContentFeed:LikeRetries`, 8): concurrent
likes never lose a count, a repeat never counts twice. Account deletion takes the user's likes back off the counters
(likes and saves are tenant rows: deleted with the account and included in "Verilerimi indir").

## 3. Catalog (screens 21, 22)

| Method | Path | Result |
|---|---|---|
| GET | `v1/catalog/brand` | `[{ "id", "name", "logoUrl", "websiteUrl" }]` — active brands, by name. |
| GET | `v1/catalog/product` | `{ "items": [ProductDto], "pageToken": "…"|null, "count": 42 }` (`count` = total matches). |
| GET | `v1/catalog/product/{id}` | `ProductDto`. `404 product_not_found`. Retired products resolve with `available: false`. |
| GET | `v1/tenant/catalog/product/{id}/match` | `{ "productId", "compatibleCount": 3, "items": [{ "id","name","category","colors","imageUrl" }] }` — "Gardırobundaki N parçayla uyumlu". `404 product_not_found`. |
| POST | `v1/tenant/catalog/complete` | "Parçamı tamamla". Body `{ "itemIds": ["…"], "priceBand": "highStreet"?, "size": "M"? }` → `{ "slots": [{ "slot": "bottom", "products": [ProductDto] }] }` (≤ 6 per slot, only slots the selection leaves empty). |

Query of `GET v1/catalog/product` (all optional): `category`, `brand` (brand id), `color`, `size`, `priceBand`,
`q` (≤ 80 chars; matches name in any language, brand, category, colour; Turkish letters folded: `gomlek` = `gömlek`),
`sort` = `newest` (default) \| `priceAsc` \| `priceDesc`, `pageToken`, `limit` (default 24, max 60).
Invalid `category` / `priceBand` / `sort` → `400 validation_failed`.

Match and complete are **rule based** (different outfit slot + harmonising colours: either side neutral or a shared colour),
synchronous and free of credits. They read the caller's real wardrobe (`GET v1/tenant/item`): `items[].category` is the
wardrobe category (`top`, `bottom`, …), `itemIds` are wardrobe item ids, and `imageUrl` is the cleaned item image
(short-lived) or the public library / catalog image. A wardrobe piece fills the catalog slot of its category
(dress / beachwear → `onePiece`, skiwear → `outerwear`).

## 4. Cart, watch list, checkout (screens 22, 24, 24b; flow 5.5)

| Method | Path | Body | Result / errors |
|---|---|---|---|
| GET | `v1/tenant/cart` | — | `CartDto` |
| POST | `v1/tenant/cart/line` | `{ "lines": [{ "clientMutationId"?: ULID, "productId", "size"?, "look"?: LookRef }] }` (1–20) | `CartDto`. `404 product_not_found`, `422 product_retired`, `422 size_not_available`, `422 cart_full`. All or nothing. |
| DELETE | `v1/tenant/cart/line/{lineId}` | — | `204`. `404 not_found`. |
| POST | `v1/tenant/cart/checkout/{brandId}` | — | `CheckoutDto`. `422 cart_empty`, `404 brand_not_found`, `422 product_retired`, `422 affiliate_link_missing`. |
| POST | `v1/tenant/catalog/product/{id}/checkout` | `{ "look"?: LookRef }` or empty | `CheckoutDto`. `404 product_not_found`, `422 product_retired`, `422 affiliate_link_missing`. |
| GET | `v1/tenant/watch-list` | — | `WatchItemDto[]`, newest first |
| PUT | `v1/tenant/watch-list/{productId}` | `{ "size"?, "look"?: LookRef, "notify"?: bool }` or empty | `WatchItemDto`. `404 product_not_found`, `422 product_retired`, `422 watch_list_full`. New item: `notify` defaults to `true`. Already watched: only `notify` (and `size` / `look` when sent) change — the price reference is kept, an empty body changes nothing. |
| DELETE | `v1/tenant/watch-list/{productId}` | — | `204`. `404 not_found`. |
| GET | `v1/tenant/favorite/product` | — | `{ "productIds": ["hs-white-shirt"] }` — the hearts on product cards, newest first |
| PUT | `v1/tenant/favorite/product/{productId}` | — | `204`. `404 product_not_found`, `422 product_retired`, `422 favorite_list_full` (500). |
| DELETE | `v1/tenant/favorite/product/{productId}` | — | `204` (idempotent — also when it was not a favourite). |
| GET | `v1/tenant/purchase-prompt` | — | `PurchasePromptDto[]` — pending "Gardıroba ekleyelim mi?" |
| PUT | `v1/tenant/purchase-prompt/{id}` | `{ "accepted": true|false }` | `200 { "status": "accepted", "items": [{ "refId": productId, "outcome": "created", "code", "errors", "item": ItemDto }] }` — `status` is `accepted` or `dismissed`, `outcome` is `created` or `alreadyApplied` (`items` empty when dismissed). `404 not_found`. `403 premium_required` when the wardrobe refuses the add — the prompt stays pending. |

```jsonc
// CartDto
{ "groups": [
    { "brandId": "gap", "brandName": "Gap", "subtotalMinor": 350000,
      "lines": [ { "lineId": "01J…", "product": ProductDto, "size": "M", "look": LookRef|null, "addedAt": "…" } ] } ],
  "lineCount": 3, "totalMinor": 750000, "currency": "TRY" }

// CheckoutDto — open `url` in the in-app browser
{ "clickId": "01J…", "url": "https://shop.example/p?utm=x&click_id=01J…", "source": "network",
  "brandId": "gap", "brandName": "Gap",
  "products": [ { "productId": "hs-white-shirt", "url": "https://…&click_id=01J…" } ] }

// WatchItemDto
{ "product": ProductDto, "size": "M", "look": null, "priceAtAddMinor": 300000, "currentPriceMinor": 240000,
  "priceDropped": true, "dropMinor": 60000, "addedAt": "…",
  "notify": true,                 // the bell on the row: price-drop push for this product (needs the priceDrop preference too)
  "origin": "user" }              // "user" = added by the user; "auto" = added after a brand visit without a purchase

// PurchasePromptDto
{ "id": "01J…", "brandId": "gap", "brandName": "Gap", "products": [ProductDto], "look": LookRef|null, "status": "pending", "receivedAt": "…" }
```

Rules the client can rely on:

- **Size**: a product with `sizes` needs one of them (case-insensitive); a product with `sizes: []` takes no size and the line shows `"ONE"`.
- **Re-adding** the same product + size keeps the existing line (same `lineId`) — safe to replay offline.
- **No price on the line**: subtotals follow the catalog. A retired product stays in the cart with `available: false` and adds nothing.
- **Checkout does not take payment** and does not empty the cart. It records a click (`click_id` → user, products, look, source) and returns the link. One product → that product's link; several products of a brand → the brand's landing link when the brand has one, else the first product's; `products[]` always lists per-product links. The query parameter name is per brand (default `click_id`).
- **Favourites** are only a list of product ids (no size, no price reference, no notification); read the products with
  `GET v1/catalog/product/{id}` or from the catalog page. `PUT` is idempotent: marking a favourite again changes nothing,
  and a product retired after it was favourited stays in the list (a retired product cannot be added: `422 product_retired`).
  Ids whose product no longer exists are left out. Account deletion removes the list.
- **Watch list** is separate from favourites. `priceDropped` compares the current price with the price when it was added; when an admin/feed lowers a price, every watcher is flagged server side and a `price_drop` push goes out (§9) when the user has `priceDrop` on **and** the item's bell (`notify`) is on.
- **Auto-add (decision 10).** Every checkout click (`…/checkout`) is remembered for `Catalog:WatchAutoAddHours` (48). When no
  conversion of that click arrives in time, its products are put on the watch list with `origin: "auto"` and `notify: false`
  (the bell is the user's choice). Skipped: products already watched, bought (a conversion of the click or of the product),
  already in the wardrobe, removed from the watch list by the user after the click, retired or unknown. Runs every 15 minutes
  (Notifier), so an item appears between 48 h and 48 h 15 min after the click. Removing an auto-added item is permanent for that click.
- **Purchase prompt**: created when a conversion postback arrives for the user's click. `PUT … { "accepted": true }` is the whole action: the **server** adds every purchased product to the wardrobe (`source: "purchase"`, same mapping as `POST v1/tenant/item/from-product`) and returns the created items. It is idempotent — answering twice, or retrying after a timeout, never adds a piece twice (`outcome: "alreadyApplied"`). The client must **not** also call `item/from-product` for these products.

## 5. Conversion postback (server to server — not for the app)

| Method | Path | Auth |
|---|---|---|
| POST | `v1/affiliate/postback/{source}` — `source` = `network` \| `direct` | Header `X-Droblet-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>` |
| GET | `v1/affiliate/postback/network?clickId=&orderId=&amountMinor=&currency=&status=&key=` | `key` = shared secret (for networks that can only call a URL) |

Body (POST): `{ "clickId": "01J…", "orderId": "ORD-1", "amountMinor": 250000, "currency": "TRY", "status": "pending" }`
(`currency` optional, only `TRY`; `orderId` ≤ 100 chars without spaces or `#`).

Response `200 { "outcome": "recorded" | "updated" | "duplicate" }`. Idempotent by (`source`, `orderId`): the same
postback again is `duplicate`; a new `status` or `amountMinor` for the same order is `updated`.
Errors: `400 validation_failed`, `401 invalid_signature`, `404 click_not_found`, `404` (unknown source),
`503 provider_not_configured` (no secret configured — unsigned postbacks are never accepted).

Secrets: config `AffiliatePostback:NetworkSecret`, `AffiliatePostback:DirectSecret`, optional per brand
`AffiliatePostback:DirectBrandSecrets:{brandId}` (SSM SecureString `/droblet/{stage}/api/AffiliatePostback`).
Commission = `amountMinor × rate`; rate = brand `commissionRateBps` if set, else `Affiliate:Brands:{brandId}:CommissionRateBps`,
else `Affiliate:DefaultCommissionRateBps`.

## 6. Social (screens 25–27)

All reads go through `VisibilityPolicy`. What another user can see:

| Owner's closet | Profile card (search, profile, follow) | Looks / Dolap tabs, ratings, feed | Trips tab |
|---|---|---|---|
| `public` | everyone | everyone | owner only (A-6 open) |
| `followersOnly` (default) | everyone (`closetLocked: true` for non-followers) | approved followers | owner only |
| `private` | only accounts in a relationship (either side follows the other, or the owner asked to follow the viewer); strangers → `404` | nobody → `404` (not even approved followers) | owner only |
| blocked (either direction) | `404` everywhere | `404` | — |

Never visible to anyone else, in any setting: body/face photos, try-on images, palette, height/weight/size, plan,
wear log, cart, watch list, notification settings, e-mail.

| Method | Path | Body | Result / errors |
|---|---|---|---|
| GET | `v1/tenant/feed?pageToken=` | — | `{ "items": [SocialLookDto], "pageToken" }` — followed users' looks, newest first (20 per page) |
| GET | `v1/tenant/people?q=` | — | `PersonCardDto[]` — @handle prefix search, min 2 chars (leading `@` ignored), max 20 |
| GET | `v1/tenant/people/suggested` | — | `PersonCardDto[]` — "Sana benzeyen dolaplar": public profiles not followed yet, by `styleMatchPercent` desc |
| GET | `v1/tenant/people/{handle}` | — | `PersonProfileDto`. `404 not_found`. |
| GET | `v1/tenant/people/{handle}/look` | — | `SocialLookDto[]`. `404`. |
| GET | `v1/tenant/people/{handle}/item` | — | `[{ "id","name","category","colors","imageUrl" }]`. `404`. |
| GET | `v1/tenant/people/{handle}/trip` | — | `[{ "id","city","month": "2026-10" }]`. `404` for everyone but the owner. |
| PUT | `v1/tenant/people/{handle}/look/{lookId}/rating` | `{ "score": 1–5, "clientMutationId"?: ULID }` | `{ "average": 3.5, "count": 2, "myScore": 4 }`. `404`, `422 cannot_target_self`. |
| PUT | `v1/tenant/people/{handle}/look/{lookId}/save` | — | `204`. `404`, `422 cannot_target_self`. |
| DELETE | `v1/tenant/people/{handle}/look/{lookId}/save` | — | `204`. `404` (unknown handle). |
| GET | `v1/tenant/saved-look` | — | `SocialLookDto[]`, most recently saved first; looks no longer visible are omitted |
| POST | `v1/tenant/follow/{handle}` | — | `200 { "state": "following" \| "requested" }`. `404`, `422 cannot_target_self`, `422 follow_limit_reached` (500, follows + pending requests). **Decision 8:** a `public` account is followed at once; a `followersOnly` / `private` account gets a request. Idempotent. |
| DELETE | `v1/tenant/follow/{handle}` | — | `204`. Unfollows **and** withdraws a pending request. `404` (unknown handle). |
| GET | `v1/tenant/follow-request/incoming` | — | `FollowRequestDto[]` — requests to follow me, newest first |
| GET | `v1/tenant/follow-request/outgoing` | — | `FollowRequestDto[]` — my pending requests |
| POST | `v1/tenant/follow-request/{handle}/approve` | — | `204` — the requester becomes a follower. `404` when that account has no pending request. |
| POST | `v1/tenant/follow-request/{handle}/decline` | — | `204` — the requester is not told. `404` as above. |
| DELETE | `v1/tenant/follow-request/{handle}` | — | `204` — withdraw my request (idempotent). `404` unknown handle. |
| DELETE | `v1/tenant/follower/{handle}` | — | `204` — remove one of my followers (idempotent). `404` unknown handle. |
| POST | `v1/tenant/contacts/salt` | — | `{ "saltId", "salt", "prefixLength": 3, "maxHashes": 1000, "expiresAt" }` — single use, 10 minutes |
| POST | `v1/tenant/contacts/match` | `{ "saltId", "hashes": [{ "p", "h" }] }` (1–1000) | `{ "matches": PersonCardDto[] }`. `404 contact_salt_not_found`, `400 hashes_out_of_range` / `hash_invalid`, `429 too_many_attempts` (10 / day). See below. |
| GET | `v1/tenant/profile/handle/availability?handle=` | — | `{ "handle", "available", "code": null \| "handle_invalid" \| "handle_reserved" \| "handle_taken" }` — always 200; my own handle is available. The claim stays `PUT v1/tenant/profile/handle` (409 `handle_taken` if somebody was faster). |
| GET | `v1/tenant/follower` | — | `PersonCardDto[]` |
| GET | `v1/tenant/following` | — | `PersonCardDto[]` |
| PUT | `v1/tenant/block/{handle}` | — | `204`. `404`, `422 cannot_target_self`. Removes follows in both directions. |
| DELETE | `v1/tenant/block/{handle}` | — | `204`. `404`. Follows are not restored. |
| GET | `v1/tenant/block` | — | `PersonCardDto[]` (handle + name only) |
| POST | `v1/tenant/people/{handle}/report` | `{ "targetKind", "targetId"?, "reason", "note"? (≤ 500) }` — `targetId` required for `look` / `item` | `201 { "reportId" }`. `404`, `422 cannot_target_self`, `429 too_many_attempts` (20 / day). |

```jsonc
// PersonCardDto
{ "handle": "ayse", "displayName": "Ayşe", "styleTags": ["minimal","classic","boho"], "styleMatchPercent": 50,
  "isFollowing": false, "followsYou": true,
  "followState": "none",            // none | requested | following (isFollowing = following)
  "requestedYou": false }           // they asked to follow me → approve / decline

// FollowRequestDto
{ "person": PersonCardDto, "createdAt": "…" }

// PersonProfileDto
{ "handle": "ayse", "displayName": "Ayşe", "styleTags": [...], "styleMatchPercent": 50,
  "isSelf": false, "isFollowing": false, "followsYou": false,
  "closetVisibility": "followersOnly",
  "closetLocked": true,                         // true → show the "gizli dolap" state; look/item calls would 404
  "itemCount": null, "lookCount": null,         // null while locked — counts do not leak
  "followerCount": 12, "followingCount": 30,
  "followState": "requested", "requestedYou": false }

// SocialLookDto
{ "id": "01J…", "ownerHandle": "ayse", "ownerDisplayName": "Ayşe", "name": "Ofis", "occasion": "office", "createdAt": "…",
  "pieces": [ { "slot": "top", "itemId": "…", "productId": null, "name": "Beyaz gömlek", "imageUrl": "https://cdn.alatech.co/public/prod/items/…-768.webp (presigned until the CDN is set up)", "product": null },
              { "slot": "bagAccessory", "itemId": null, "productId": "lx-bag", "name": "Deri El Çantası", "imageUrl": "https://…", "product": ProductDto } ],
  "rating": { "average": 4.6, "count": 12, "myScore": 5 },   // average null when count = 0; one decimal
  "saved": false }
```

- **Rating**: one per user per look; a new score replaces the old one (count unchanged). Own looks cannot be rated.
- **Style match %**: Jaccard of the two users' style tags: 3 shared = 100, 2 = 50, 1 = 20, 0 = 0.
- **Look images** are item images, never try-on images. `pieces[].product` is set for catalog pieces → "Parçaları gör" can add to cart with `look: { "kind": "user", "id": lookId }`.
- **After a block** both users get `404` for each other everywhere (search, profile, tabs, follow, rating, report, feed, suggestions). Only the blocker sees the entry in `GET v1/tenant/block`.
- Looks, items and trips are the owner's real wardrobe data (the looks of `GET v1/tenant/look`, the items of `GET v1/tenant/item`), always behind the visibility table above. What a viewer gets is narrower than what the owner sees: a look lists only its existing pieces (a deleted item's slot is dropped); `imageUrl` is the cleaned (background-removed) item image at 768 px — a public CDN URL once published ([docs/images.md](../images.md)), presigned before — or the public library / catalog image — **never the original photo** (even when the owner chose "Orijinale dön") and never a try-on image, `null` when the piece only has an original; `pieces[].slot` is the wardrobe slot (`bagAccessory`, not `bag`).
- The trips tab lists finished trips only (end date before today) as city + month. It stays owner-only.
- The owner sees the same rating on her own looks: `GET v1/tenant/look` / `look/{id}` → `rating { average, count }` (other document).

- **Follow requests (decision 8).** A pending request is never "following": the closet stays locked, the feed and ratings
  stay closed, `followerCount` does not move. The two sides of a request see each other's card in the request lists even
  when it is private (handle, name, style tags only). Blocking removes pending requests in both directions; account
  deletion removes them on both sides. The owner gets a `follow_request` push when `followRequests` is on (§9).
  A request to an account that later turns `public` is settled by following again (immediate).

### Find friends from contacts (decision 13)

Raw contacts never leave the phone. Privacy description: [`docs/privacy/contacts-matching.md`](../privacy/contacts-matching.md).

1. `POST v1/tenant/contacts/salt` → a random 32-byte salt (base64url), single use, valid 10 minutes.
2. On the device, for every e-mail address: `id = trim(lowercase(address))`, `h0 = hex(SHA-256(id))`,
   `p = h0[0..3]`, `h = hex(SHA-256(salt + ":email:" + h0))` (lower-case hex). De-duplicate by `h0`.
3. `POST v1/tenant/contacts/match { saltId, hashes: [{ p, h }] }`: the server reads the directory bucket of each `p` (members'
   **verified** e-mails as `h0` — Apple / Google verified addresses and addresses proven by a password reset), salts them
   with the same salt and compares. Matches come back as `PersonCardDto[]` filtered exactly like search: no blocked
   accounts (either way), no private strangers, never yourself.

Nothing of the upload is written or logged; the salt is deleted when used, so an uploaded hash is useless outside that one
request. Phone numbers are not used in phase 1 (no member has one on file).

### Invite and share (flow 5.7)

| Method | Path | Body | Result / errors |
|---|---|---|---|
| GET | `v1/tenant/invite/link` | — | `{ "code": "ABCDEFGH", "url": "https://droblet.alatech.co/i/ABCDEFGH", "invitedCount": 1 }` |
| POST | `v1/tenant/share` | `{ "clientMutationId": ULID, "channel", "targetKind", "targetId"?, "ownerHandle"? }` — `targetId` required for `look`, `product`, `edit` | `{ "shareId", "inviteCode", "url", "channel" }` — share `url`. Idempotent by `clientMutationId`. |
| GET | `v1/invite/{code}` | — (anonymous) | `{ "code", "inviterFirstName": "Zeynep" }`. `404 invite_code_not_found`, `429 too_many_attempts`. |
| POST | `v1/tenant/invite/attribution` | `{ "code" }` | `204`. `404 invite_code_not_found`, `422 cannot_target_self`, `409 invite_already_attributed`, `422 invite_window_closed` (account older than 30 days). |

Share URL: `{base}/{code}` for `app`; otherwise `{base}/{code}?t={targetKind}&id={targetId}&u={ownerHandle}`.
Deferred deep link: the app keeps the code from the install / open link and calls `invite/attribution` once after
sign-up. The code is 8 characters, case-insensitive. Phase 1 gives no reward.

## 7. Settings (screen 29)

| Method | Path | Body | Result / errors |
|---|---|---|---|
| GET | `v1/tenant/settings` | — | `SettingsDto` — everything screen 29 needs |
| PUT | `v1/tenant/profile/visibility` | `{ "closetVisibility", "baseVersion" }` | `ProfileDto`. `409` + current `ProfileDto` when `baseVersion` is stale. Effective immediately. |
| GET | `v1/tenant/user/me/notifications` | — | `NotificationPrefsDto` (`version: 0` = never saved, all off). `weeklyEdit` / `priceDrop` are reported as effectively sent: on **and** a valid `marketingNotifications` consent ([C §2](consents-age-inbox-avatar.md)). |
| PUT | `v1/tenant/user/me/notifications` | `{ "morningOutfit", "morningOutfitLocalTime": "07:30", "weeklyEdit", "friendRatings", "priceDrop"?, "followRequests"?, "timeZone": "Europe/Istanbul", "baseVersion" }` — `priceDrop` / `followRequests` omitted = unchanged | `NotificationPrefsDto`. `409` + current prefs. `400`: `local_time_invalid` (HH:mm, quarter hours only), `time_zone_invalid` (IANA id). `403 consent_required` (`missing: ["marketingNotifications"]`) when `weeklyEdit` or `priceDrop` is `true` without the marketing consent. |
| PUT | `v1/tenant/user/me/device` | `{ "deviceId" (8–100 chars), "platform", "pushToken"?, "timeZone"? }` | `{ "deviceId", "platform", "pushEnabled", "updatedAt" }`. `422 device_limit_reached` (10). |
| DELETE | `v1/tenant/user/me/device/{deviceId}` | — | `204` (idempotent) |
| DELETE | `v1/tenant/photo/{kind}/{photoId}` | — | `204`. Deletes the active photo of one kind (`body` \| `face`; `photoId` = `GET v1/tenant/photo` → `body.id` / `face.id`) and what was made from it: **body** → the try-on images generated with that photo; **face** → the palette result. `404 not_found` when `photoId` is not the active photo of that kind (also after a replay — treat 404 as "already gone"). `DELETE v1/tenant/photo` (everything at once) is unchanged. |
| PUT | `v1/tenant/profile` *(existing)* | `{ "displayName"?, "language"?, "cityId"?, "baseVersion" }` | **Partial update**: an omitted / `null` field keeps its value, so the app sends only `{ "language", "baseVersion" }` when its language changes (extra fields such as `clientMutationId` are ignored). `cityId: ""` clears the city. `language` must be in the supported list → else `400 language_unsupported`; a blank `displayName` → `400 name_required`. `cityId` = id from `GET v1/weather/city`. `409` + current `ProfileDto` when `baseVersion` is stale. |

```jsonc
// SettingsDto
{ "closetVisibility": "private", "language": "tr", "cityId": "745044",
  "city": { "id": "745044", "name": "İstanbul", "region": "İstanbul", "country": "Türkiye", "countryCode": "TR",
            "latitude": 41.01384, "longitude": 28.94966, "timeZone": "Europe/Istanbul" },   // null until the city was searched once
  "notifications": { "morningOutfit": true, "morningOutfitLocalTime": "07:30", "weeklyEdit": false, "friendRatings": false,
                     "priceDrop": false, "followRequests": false,
                     "timeZone": "Europe/Istanbul", "version": 1, "updatedAt": "…" },
  "devices": [ { "deviceId": "…", "platform": "ios", "pushEnabled": true, "updatedAt": "…" } ],
  "profileVersion": 3 }                                    // baseVersion for profile and visibility PUTs
```

- `morningOutfitLocalTime` is the user's **local** wall-clock time; with `timeZone` it stays correct across DST.
- The first device registration **with a push token** creates the preferences with **only `morningOutfit` on** (decision 9,
  amended by the legal review — REVIEW §5 G2: the weekly edit is a marketing message and needs consent 5, so it starts
  **off** until the user opts in); `weeklyEdit`, `friendRatings`, `priceDrop` and `followRequests` start off. Later
  registrations never change the user's choices. Push tokens are never returned.
- Withdrawing `marketingNotifications` (`PUT v1/tenant/consents`) switches `weeklyEdit` and `priceDrop` off and removes the
  user from both send lists.
- Sign-out (`POST v1/auth/logout` with `deviceId`) already removes the device.
- Account deletion (`DELETE v1/auth/me`) now also removes: follow edges on both sides, ratings given (averages are
  corrected) and received, saved looks in both directions, blocks, reports about the user (reports she filed stay
  without her), invite code and invite edges, watch-list index, discovery index, notification lists, and the user
  link on clicks and conversions (the revenue rows stay, anonymous); follow requests on both sides, queued pushes,
  watch-list auto-add candidates and the contact-matching directory rows.

## 8. Analytics events

`POST v1/tenant/event`

```jsonc
{ "platform": "ios" | "android", "appVersion": "1.0.0",
  "events": [ { "name": "paywall_viewed", "occurredAt": "2026-11-18T09:00:00Z", "props": { "source": "tryon", "count": 2 } } ] }   // 1–50 events
→ 200 { "accepted": 1, "rejected": [ { "index": 3, "code": "name_not_allowed" } ] }
```

`400 validation_failed` only for the batch itself (`events_invalid`: empty or more than 50). Individual bad events
never fail the batch; do not retry rejected events.

| Sent by the app | Recorded by the server (the app must **not** send these → `name_server_only`) |
|---|---|
| `signup_started`, `signup_completed`, `onboarding_style_completed`, `onboarding_body_completed`, `onboarding_photo_completed`, `onboarding_first_items_completed`, `first_item_added`, `first_look_created`, `paywall_viewed`, `subscribed`, `credit_spent`, `credits_exhausted`, `complete_look_clicked` | `add_to_cart` (cart line added), `brand_site_opened` (checkout), `conversion` (postback), `share` (`POST v1/tenant/share`), `invited_install` (invite attribution) |

- `occurredAt` optional (default: now); accepted from 7 days back to 10 minutes ahead.
- `props`: at most 8, keys from `step`, `source`, `screen`, `productId`, `brandId`, `lookId`, `lookKind`, `editId`,
  `channel`, `priceBand`, `plan`, `capability`, `category`, `count`, `creditsRemaining`. Values: string / integer / boolean,
  stored as text matching `[A-Za-z0-9._:-]{1,64}` — **no free text, no names, no e-mail**.
- Rejection codes: `name_required`, `name_not_allowed`, `name_server_only`, `occurred_at_out_of_range`, `too_many_props`,
  `prop_not_allowed`, `prop_value_invalid`.
- Storage: no tenant or user id — a one-way hash as the actor; rows expire after 400 days. Each event is written twice:
  the day row `analytics#{yyyy-MM-dd}` (funnel report) and a per-actor copy `analytics-actor#{hash}` / `{occurredAt ms}#{id}`.
  The hash can be recomputed from the account id, so the events are pseudonymous personal data: the copy lets
  "Verilerimi indir" include them with one Query and account deletion remove both rows. Events recorded before the copy
  existed (dev) are not backfilled and expire by TTL.

## 9. Push notifications

Sent by the Notifier per device token type: FCM HTTP v1 for `fcm` tokens (Android), APNs HTTP/2 for `apns` tokens (iOS) — [purchases-push.md §5](purchases-push.md). `data.type` tells the app where to go; title/body are
sentences in the recipient's profile language (`tr`, `en`; other languages fall back to `tr`).

| `data.type` | Extra `data` | When | Once per |
|---|---|---|---|
| `weekly_edit` | `editId` | Weekly; `weeklyEdit` on, a valid `marketingNotifications` consent, and an edit for the current week is published | edit |
| `friend_ratings` | `day` | Daily digest; `friendRatings` on and a look was rated today (no scores or names in the text) | day |
| `follow_request` | `handle` (the requester, for the deep link) | Within 15 minutes of a new request; `followRequests` on and the request still pending. The text names nobody | requester (14 days) |
| `price_drop` | `productId` | Within 15 minutes of a price drop on a watched product; `priceDrop` on, the item's `notify` bell on **and** a valid `marketingNotifications` consent | product (14 days) |
| `morning_outfit` | `day` | At `morningOutfitLocalTime`; `morningOutfit` on **and** a look that still exists is planned for the user's local day (`PUT v1/tenant/plan-day/{date}` with a `lookId`; an occasion alone does not count) | local day |

Every handled event is also written to the in-app inbox (`GET v1/tenant/notification`, [C §4](consents-age-inbox-avatar.md)),
with or without a registered device: `morning_outfit`, `weekly_edit` and `price_drop` under the same conditions as the push;
`follow_request` and `friend_ratings` even when their push is switched off.

## 10. Weather

| Method | Path | Result / errors |
|---|---|---|
| GET | `v1/weather?cityId=` or `?lat=&lon=` , optional `days=1–7` (default 7) | `WeatherForecast`. `400 validation_failed`, `404 city_not_found`, `503 weather_unavailable`. |
| GET | `v1/weather/city?q=` (2–60 chars) | `CityDto[]` (≤ 8), names in the request language. `400`, `503 weather_unavailable`. |

```jsonc
// WeatherForecast
{ "locationKey": "city:745044",                 // or "geo:41.0:29.0"
  "city": CityDto | null, "fetchedAt": "2026-11-18T09:00:00Z",
  "days": [ { "date": "2026-11-18", "minC": 8.0, "maxC": 15.3, "condition": "rain", "weatherCode": 61, "precipitationProbability": 70 } ] }
```

Location permission granted → send `lat`/`lon` (rounded to 0.1° on the server before use; never stored with the user).
Otherwise use the profile `cityId`. `days[0]` is today at that location. Forecasts come from a shared cache
(60 minutes); when the provider is down the last cached forecast is served.
The same forecast feeds `GET v1/tenant/today` (`weather`), trip days and the stylist / suitcase jobs (other document),
there as whole °C (`minTempC` / `maxTempC`) and `null` instead of a 503 when nothing is available.

## 11. Admin API (`v1/admin/*`)

Text fields marked **L** are `LocalizedText` maps. Every `PUT` is an upsert by the id in the route. Nothing is ever
deleted: `DELETE` retires (ids are never reused). Ids: `^[a-z0-9][a-z0-9-]{1,62}$`.

| Method | Path | Body / query | Result / errors |
|---|---|---|---|
| GET | `v1/admin/brand` | — | `AdminBrandDto[]` (retired included) |
| PUT | `v1/admin/brand/{id}` | `{ "name", "websiteUrl"?, "logoUrl"?, "source", "network"?, "checkoutUrl"?, "clickIdParameter"?, "commissionRateBps"? (0–5000), "retired"? }` | `AdminBrandDto` = body + `id`, `createdAt`, `updatedAt` |
| DELETE | `v1/admin/brand/{id}` | — | `204`. `404 brand_not_found`. |
| GET | `v1/admin/product` | `brand`, `q`, `includeRetired` (default true), `segment` (`women` · `men` · `unisex`), `pageToken`, `limit` (≤ 200) | `{ "items": [AdminProductDto], "pageToken", "count" }` |
| GET | `v1/admin/product/{id}` | — | `AdminProductDto`. `404 product_not_found`. |
| PUT | `v1/admin/product/{id}` | `{ "brandId", "name": L, "description"?: L, "category", "colors"?: [slug ≤ 8], "sizes"?: [≤ 30], "priceMinor" (> 0), "currency"?: "TRY", "priceBand", "images"?: [https ≤ 12], "affiliateUrl"? (https), "affiliateSource"?, "retired"?, "segment"? (women · men · unisex; omitted = unchanged on update, women on create; `segment_invalid`) }` | `{ "product": AdminProductDto, "created": bool, "priceDropped": bool, "watchersFlagged": 0 }`. `422 brand_not_found`. |
| DELETE | `v1/admin/product/{id}` | — | `204`. `404 product_not_found`. |
| POST | `v1/admin/product/bulk` | `{ "products": [ { "id", …same as PUT } ] }` (1–200) | `{ "created", "updated", "failed", "rows": [{ "index", "id", "outcome": "created"|"updated"|"invalid"|"brand_not_found"|"duplicate_id", "errors"?: { field: [code] } }] }`. Valid rows are written even when others fail. |
| GET | `v1/admin/edit` | — | `AdminEditDto[]`, newest week first (drafts and retired included) |
| PUT | `v1/admin/edit/{id}` | `{ "segment": "women", "weekStart" (a Monday), "title": L, "subtitle"?: L, "coverImageUrl"?, "looks": [{ "id"?, "day": 1–7, "title": L, "styleNote"?: L, "imageUrl"?, "variants": [{ "priceBand", "productIds": [1–10] }] }], "sponsorBrandId"?, "sponsorName"?: L, "published", "retired"? }` | `AdminEditDto`. `422 product_not_found` + `productIds: [...]`. |
| DELETE | `v1/admin/edit/{id}` | — | `204`. `404 not_found`. |
| GET | `v1/admin/feed-post` | — | `AdminFeedPostDto[]` (drafts, scheduled, retired included; feed order) |
| PUT | `v1/admin/feed-post/{id}` | `{ "segment": "women"|"men"|null, "author": { "kind": "edit"|"stylist", "name": L (≤ 60), "handle"?, "imageUrl"? }, "occasion", "title": L (≤ 120), "note"?: L (≤ 600), "imageUrls": [https, 1–4], "productIds"?: [0–8, distinct], "publishAt" (UTC), "sortOrder" (0–100000), "published", "retired"? }` | `AdminFeedPostDto` = body + `likeCount`, `createdAt`, `updatedAt`. Id: a content id or a ULID (the panel generates ULIDs). `422 product_not_found` + `productIds`. Codes: `id_invalid`, `segment_invalid`, `author_required`, `author.kind` `author_kind_invalid`, `author.name` `author_name_invalid`, `author.handle` `author_handle_invalid`, `author.imageUrl` `author_image_url_invalid`, `occasion_invalid`, `title_invalid`, `note_invalid`, `image_urls_invalid`, `product_ids_invalid`, `publish_at_invalid`, `sort_order_invalid`. |
| DELETE | `v1/admin/feed-post/{id}` | — | `204` (unpublished + retired). `404 not_found`. |
| GET | `v1/admin/feed-story` | — | `AdminFeedStoryDto[]`, newest `publishAt` first |
| PUT | `v1/admin/feed-story/{id}` | `{ "segment"?, "author": { "name": L, "imageUrl"? }, "imageUrl" (https, required), "headline": L (≤ 120), "productId"?, "publishAt", "expiresAt"? (> publishAt), "sortOrder", "published", "retired"? }` | `AdminFeedStoryDto`. `422 product_not_found`. Codes: `image_url_invalid`, `headline_invalid`, `product_id_invalid`, `expires_at_invalid` + the post codes above. |
| DELETE | `v1/admin/feed-story/{id}` | — | `204`. `404 not_found`. |
| GET | `v1/admin/collection/{kind}` | — | `AdminCollectionDto[]` |
| PUT | `v1/admin/collection/{kind}/{id}` | `{ "title": L, "subtitle"?: L, "imageUrl"?, "sortOrder", "sponsorName"?: L, "handle"?: "@editor1", "retired"? }` | `AdminCollectionDto` (with `handle`). `handle` is stored normalised (no `@`, lower case); `400 handle_invalid` when it is not a valid handle format. |
| DELETE | `v1/admin/collection/{kind}/{id}` | — | `204`. `404`. |
| GET | `v1/admin/collection/{kind}/{id}/look` | — | `AdminCollectionLookDto[]` |
| PUT | `v1/admin/collection/{kind}/{id}/look/{lookId}` | `{ "title": L, "note"?: L, "imageUrl"?, "productIds"?: [≤ 10], "sortOrder", "retired"? }` | `AdminCollectionLookDto`. `404 not_found` (collection), `422 product_not_found`. |
| DELETE | `v1/admin/collection/{kind}/{id}/look/{lookId}` | — | `204`. `404`. |
| GET | `v1/admin/report/revenue` | `from`, `to` (`yyyy-MM-dd` UTC, inclusive; default last 30 days; max 366) | `RevenueReport` (+ `clicks`, `byDay`, `byNetwork` — [admin.md §5](admin.md)) |
| GET | `v1/admin/report/funnel` | `from`, `to` (default last 30 days; max 92) | `FunnelReport` |
| GET | `v1/admin/moderation/report` | `status` (`open` default), `pageToken`, `limit` | `{ "items": [ModerationReportDto], "pageToken" }`, newest first |
| POST | `v1/admin/moderation/report/{id}/resolve` | `{ "resolution", "note"? (≤ 500) }` | `ModerationReportDto`. `404 not_found`. An already resolved report is returned unchanged. `contentRemoved` hides the target (below). |
| POST | `v1/admin/moderation/report/{id}/restore` | — | `ModerationReportDto` with `contentRestoredAt`. Undo of `contentRemoved`; idempotent. `404 not_found`, `409 report_not_resolved` / `report_not_content_removed`. |

Weekly edit rules: `published: true` requires exactly 7 looks with days 1–7; a draft may have fewer. Each look has
1–2 variants with distinct price bands. A look without `id` gets `{editId}-d{day}`. Validation codes include
`week_start_invalid`, `looks_must_be_seven`, `look_day_duplicate`, `look_variants_invalid`, `title_invalid`,
`segment_not_available`, `name_invalid`, `price_invalid`, `colors_invalid`, `sizes_invalid`, `images_invalid`,
`affiliate_url_invalid`, `id_invalid`.

A product write with a **lower** price sets `priceDropped` and flags the watch-list rows of that product.
The catalog is cached per Lambda instance for 60 seconds: a change is visible everywhere within a minute.

```jsonc
// RevenueReport — rejected conversions are counted in "rejected" and add no money
{ "from": "2026-10-20", "to": "2026-11-18", "currency": "TRY",
  "conversions": 3, "gmvMinor": 180000, "commissionMinor": 17100,
  "pending": 1, "approved": 2, "rejected": 1,
  "byBrand":  [ { "key": "vakko", "conversions": 2, "gmvMinor": 150000, "commissionMinor": 15000 } ],
  "byLook":   [ { "key": "edit:e1" | "collection:…" | "user:…" | "none", "conversions": 2, "gmvMinor": 150000, "commissionMinor": 15000 } ],
  "bySource": [ { "key": "direct", … }, { "key": "network", … } ] }

// FunnelReport — steps in the order of §8 (client + server events)
{ "from": "…", "to": "…", "totalEvents": 10, "totalActors": 4,
  "steps": [ { "name": "signup_started", "events": 4, "actors": 4, "rateFromPrevious": null, "rateFromFirst": null },
             { "name": "signup_completed", "events": 2, "actors": 2, "rateFromPrevious": 0.5, "rateFromFirst": 0.5 } ] }

// ModerationReportDto
{ "id": "01J…", "status": "open", "reporterTenantId": "…"|null, "reporterHandle": "…"|null, "targetTenantId": "…", "targetHandle": "…",
  "targetKind": "look", "targetId": "…", "reason": "inappropriate", "note": "…", "createdAt": "…",
  "resolution": null, "resolutionNote": null, "resolvedByUserId": null, "resolvedAt": null,
  "contentRemovedAt": null,        // contentRemoved: when the target was hidden (once per report; also set when the target was already gone)
  "contentRestoredAt": null, "contentRestoredByUserId": null }   // POST …/restore
```

**Removed content (`contentRemoved`).** The target row gets a moderation flag (`moderationHiddenAt`, `moderationReportId`,
`moderationReason`); nothing is deleted, nothing is cached.

| Target | Everybody but the owner | The owner |
|---|---|---|
| `look` | gone from `people/{handle}/look`, `lookCount`, the feed (every page), `saved-look` (the saved row is kept so a restore brings it back); rating / save → `404` | still in `GET v1/tenant/look`, `look/{id}`, plan / today, her own `people/{handle}/look`; `LookDto.moderation = { "hidden": true, "reason": "inappropriate" }` |
| `item` | gone from `people/{handle}/item`, `itemCount`, and as a piece from every look shown to others (the look itself stays) | still in `GET v1/tenant/item`, `item/{id}`; `ItemDto.moderation` as above |
| `profile` | handle only: `displayName: null` (the app shows `@handle`), `avatarUrl: null`, `styleTags: []` on the profile, every `PersonCardDto` (search, suggested, followers, following, requests, contacts, blocked), `SocialLookDto.ownerDisplayName`, and `inviterFirstName: null` on `GET v1/invite/{code}`. The handle stays reserved. | `ProfileDto.moderation` as above; her own fields unchanged |

Owner edits (`PUT look / item / profile`) never clear the flag; only `POST …/restore` does. The owner gets one inbox row
`content_removed` (`data`: `targetKind`, `targetId` for look / item, `reason`) — never pushed. Shares of removed content
lead nowhere: share links open the app, whose reads above already leave it out.

### Seeding

`seed/catalog/brands.json`, `seed/catalog/products.json`, `seed/content/weekly-edits.json`, `seed/content/feed.json`
(Akış posts + stories, same shapes as the admin `PUT` bodies) hold **placeholder** data
(tr + en text, no real prices or links).

```bash
dotnet run --project tools/Seed -- validate             # schema, duplicate ids, references, a translation per supported language
TABLE_NAME=droblet-dev-table dotnet run --project tools/Seed -- apply     # writes through the same services as the admin API
```

`products.json` has the body shape of `POST v1/admin/product/bulk` and can be posted as is.

## 12. Configuration added

| Section (SSM `/droblet/{stage}/api/<Section>`) | Keys | Default |
|---|---|---|
| `AdminAuth`, `AdminJwt` (SecureString) | see [admin.md §8](admin.md#8-configuration) — replaced the former `Admin:UserIds` / `Admin:Emails` list | — |
| `AffiliatePostback` (SecureString) | `NetworkSecret`, `DirectSecret`, `DirectBrandSecrets{}`, `DefaultClickIdParameter` | no secrets → postbacks answer 503 |
| `Localization` | `SupportedLanguages[]`, `DefaultLanguage` | `tr`, `en` / `tr` |
| `Catalog` | `PageSize`, `MaxPageSize`, `CacheSeconds`, `MaxCartLines`, `MaxWatchItems`, `MaxFavoriteProducts` (code default 500; not in the SSM default yet), `BulkUpsertMax`, `ImageHosts[]` (hosts product images may be downloaded from for try-on; empty = any https host), `MaxImageBytes`, `WatchAutoAddHours` (decision 10; 0 = off) | 24, 60, 60, 100, 200, 200, empty, 10 MB, 48 |
| `Social` | `MaxFollowing`, `FeedPageSize`, `SuggestedPageSize`, `SuggestedCandidateLimit`, `SearchPageSize`, `InviteUrl`, `InviteAttributionWindowDays`, `ReportsPerDay`, `InviteResolvePerIpPerHour`, `ContactMatchesPerDay`, `ContactMatchMaxHashes` | 500, 20, 20, 100, 20, `https://droblet.alatech.co/i`, 30, 20, 60, 10, 1000 |
| `ContentFeed` | `PageSize`, `MaxStories`, `LikeRetries` (Akış F1, §2b) | 10, 20, 8 — SSM `/droblet/{stage}/api/ContentFeed` (template.yaml `SsmApiContentFeed`), re-read every 60 s |
| `Weather` | `Provider`, `CacheMinutes`, `ForecastBaseUrl`, `GeocodingBaseUrl`, `TimeoutSeconds` | `OpenMeteo`, 60 |
| `Notifications` | `DefaultMorningLocal`, `DefaultTimeZone`, `MaxDevicesPerTenant` | `07:30`, `Europe/Istanbul`, 10 |
| `/droblet/{stage}/notifier/Push/ServiceAccountJson` (SecureString) | the Firebase service-account JSON file as downloaded (`project_id`, `client_email`, `private_key`) | `CHANGE_ME` or empty → push disabled |

`template.yaml` creates the non-secret sections (`Localization`, `AdminAuth`, `Catalog`, `Social`, `Weather`, `Notifications`,
`Affiliate`, plus `Wardrobe`, `Stylist`, `Packing`, `Palette`, `Entitlements`) as SSM String parameters with these defaults —
for the Api and, where a worker applies the same rule, under `/worker/` (and `Localization` under `/notifier/`).
Secrets are created by `deploy-infra` with the placeholder `CHANGE_ME`, which the code treats as **not configured**
(no e-mail, no push, no AI call, no Apple key, no store notification key). `AffiliatePostback` is created by hand; a
missing or `CHANGE_ME` secret refuses every postback (503).
