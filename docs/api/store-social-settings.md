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

## 2b. Akış — editor posts, stories and users' shared looks (canvas 06″, decisions 16–21)

Akış is the app's first tab. **F1** = editor content, entered in the admin panel: posts by "Droblet Edit" or a selected
stylist (placeholder names only, A-7) and editor stories. **F2** (owner decision 21, 22 Nov 2026) = the looks users
share themselves ("Akışta paylaş"), mixed into the same list. Interactions: ♡ like (with count), save; on editor posts
also "Üzerimde dene" (try-on target `feedPost`, W §7) and buy (each product opens the brand page through the existing
checkout); on user posts "Benzerlerini gör", "Bunu gösterme" and "Şikâyet et". **No comments (ever), no sponsored content
(F3), no try-on and no buy on a user's look.** Teens: the reads and the like / save routes are open (decision 17) and
return **editor posts only**; the app hides prices / buy for them (teen `commerce` restriction). Sharing is closed to
teens (`social`), as is the friends' feed `GET v1/tenant/feed` (unchanged).

| Method | Path | Result |
|---|---|---|
| GET | `v1/content/feed?occasion=&pageToken=` | `{ "items": [FeedPostDto], "pageToken": "…"|null }` — editor posts with user looks mixed in (see **The mix**). Editor posts: published, not retired, `publishAt` ≤ now, segment = the user's segment or none; order `publishAt` desc, then `sortOrder` asc (then id). Page size `ContentFeed:PageSize` (10). `occasion` (optional) = one or more comma-separated `Occasion` wire names; the app's tabs: Ofis = `office`, Hafta sonu = `weekend`, **Davet = `dinner,wedding`** (owner decision 2026-11-22); it filters both kinds (a look without an occasion matches no tab). Any unknown part → `400 validation_failed`. The token is a position in both lists plus the place inside the pattern (an item removed or added meanwhile never shifts or repeats the next page); an unreadable token starts from the top. |
| GET | `v1/content/feed/story` | `FeedStoryDto[]` — published, not retired, inside `[publishAt, expiresAt)`, the user's segment or none. Order: `sortOrder` asc (editors pin), then `publishAt` desc. At most `ContentFeed:MaxStories` (20). |
| PUT | `v1/tenant/feed-post/{id}/like` | `{ "liked": true, "likeCount": 1284 }`. Idempotent. `404 not_found` when the post is unknown, a draft, scheduled or retired — or, for a user post, my own, of a blocked pair, taken off the feed by reports, or removed. |
| DELETE | `v1/tenant/feed-post/{id}/like` | `{ "liked": false, "likeCount": 1283 }`. Idempotent. Same `404`. |
| PUT | `v1/tenant/feed-post/{id}/save` | `204`. Idempotent (a repeat keeps the first save time). Same `404`. |
| DELETE | `v1/tenant/feed-post/{id}/save` | `204`, always (idempotent). |
| GET | `v1/tenant/feed-post/{id}` | Both kinds. `FeedPostDto` as I see the post on Akış (liked, saved, pieces, `canTryOn`) — for the detail screen opened from a link or after a restart, when no loaded feed page holds the post. `404 not_found`: unknown, retired, not live yet, or a shared look I may not see (or whose cover is not ready). |
| GET | `v1/tenant/feed-post/saved` | `FeedPostDto[]`, newest save first, both kinds. Posts retired, unpublished, un-shared, hidden or not visible to me right now are left out. |
| GET | `v1/tenant/feed-post/{id}/similar` | **User posts.** `ProductDto[]`, at most `ContentFeed:MaxSimilarProducts` (12) — see **Similar products**. `404 not_found` for an editor post or a user post I may not see. |
| PUT | `v1/tenant/feed-post/{id}/hide` | `204`. "Bunu gösterme": the feed never returns the post to me again. Idempotent; works on both kinds. `404` as for like. There is no un-hide. |
| POST | `v1/tenant/feed-post/{id}/report` | **User posts.** Body `{ "reason": ReportReason, "note"?: string ≤ 500 }` (`reason` = `spam` \| `inappropriate` \| `harassment` \| `impersonation` \| `minorSafety` \| `other`, the same values as the people report) → `201 { "reportId" }`. One report per user per post: a repeat answers `200` with the same id. The post is hidden for the reporter from then on (no separate hide needed). `404 not_found` (editor post, unknown, not visible), `422 cannot_target_self`, `429 too_many_attempts` (`Social:ReportsPerDay`, the budget shared with the people report), `400` (unknown reason, note too long). |
| POST | `v1/tenant/feed-post/{id}/look` | **Editor posts with pieces.** "Looklarıma ekle". Body `{ "mode": "inspiration" \| "pieces", "requestId": "<ulid>" }` → `201 LookDto` (the app's normal look shape, [W §4](wardrobe-looks-plan-stylist.md)); the same post in the same mode again → `200` with the look made then (while it exists). `404 not_found`, `422 look_not_savable`, `403 premium_required`, `409 look_id_taken`, `400`. See **Saving a post into my looks**. |
| PUT | `v1/tenant/look/{id}/feed-share` | `204`. Shares my look; published at once, no pre-approval; idempotent. `403 teen_restricted` (`feature: "social"`), `404 not_found`, `422 email_not_verified` \| `handle_required` \| `look_not_shareable`, `429 too_many_attempts` (only when `ContentFeed:MaxSharesPerDay` > 0). See **Sharing**. |
| DELETE | `v1/tenant/look/{id}/feed-share` | `204`, always (idempotent). The post goes with its likes, saves, hides and report pointers. |

```jsonc
// FeedPostDto — text in the request language (profile → Accept-Language → default), like every content read
{ "kind": "editor",                                                      // editor | user
  "id": "01J…",
  "author": { "kind": "edit", "name": "Droblet Edit", "handle": null, "imageUrl": null, "verified": true },  // kind edit | stylist | user; verified = true only for kind edit (Droblet Edit)
  "occasion": "office", "publishedAt": "2026-11-22T07:00:00Z",          // publishedAt = the post's publishAt; occasion null: see below
  "title": "Ofiste bordo & camel", "note": "…" | null,
  "images": ["https://…"],                                              // 1–4
  "products": [ { /* ProductDto, every field */ "ownedSimilar": true, "ownedItemId": "01J…" } ],  // 0–8; retired products stay listed with available: false
  "buyableCount": 2,                                                     // products that are available and not ownedSimilar
  "pieces": [ { "category": "outerwear", "subcategory": "blazer" | null, "imageUrl": "https://…/catalog/feed/{id}-p1.webp" } ],  // the pieces of images[0] (the strip under the post); [] when the post was not split
  "hasSimilar": false, "canTryOn": true,                                 // canTryOn: see "Editor post pieces" below (false = no "Üzerimde dene")
  "likeCount": 1284, "liked": false, "saved": false,
  "imagesExpireAt": null }

// FeedPostDto of a shared look (kind user)
{ "kind": "user",
  "id": "u_3f9c…",                                                       // opaque, stable for owner + look ("u_" + 26 hex); the same id on like / save / hide / report / similar
  "author": { "kind": "user", "name": "@elif_k", "handle": "elif_k", "imageUrl": "https://…" | null, "verified": false },  // imageUrl = the avatar, presigned, short-lived
  "occasion": "weekend" | null,                                          // the look's occasion; null when it has none
  "publishedAt": "2026-11-22T09:14:00Z",                                 // when it was shared
  "title": "Hafta sonu", "note": null,                                   // title = the look's name ("" when it has none)
  "images": ["https://…"],                                               // exactly one: the look's AI flat-lay cover (public CDN URL, or presigned)
  "products": [], "buyableCount": 0,
  "pieces": [ { "category": "top", "subcategory": "sweater" | null, "imageUrl": "https://…" | null } ],
  "hasSimilar": true, "canTryOn": false,
  "likeCount": 38, "liked": false, "saved": false,
  "imagesExpireAt": "2026-11-22T10:14:00Z" }                             // when a presigned images[0] stops working; null for a public URL

// FeedStoryDto
{ "id": "…", "author": { "name": "Droblet Edit", "imageUrl": null }, "imageUrl": "https://…", "headline": "Ofiste bordo & camel",
  "product": ProductDto | null, "publishedAt": "…" }
```

**Editor post pieces and `canTryOn`** (owner decision 2026-11-23). An editor post that is one photograph (no products)
is split by AI into its pieces (operator tool `split-feed-posts`: at most five, each with its own clean image in the
public catalog bucket): `pieces[]` has the same shape as on a user post (`category` = wardrobe `ItemCategory`,
`subcategory` or `null`, `imageUrl` always set, public, not expiring). A post that was not split, and the weekly-edit
fallback, send `pieces: []`. `canTryOn` = the post has an **available product**, **or** it has none but has `pieces` and
an image. In the second case `POST v1/tenant/tryon` with `{ "kind": "feedPost", "id": postId }` renders the **whole
outfit of the post's photograph** as a photo try-on (one credit, cached per photograph like any outfit photo; the answer
has no `pieces`); for a teen that case is `canTryOn: false` (a photo try-on is never for teens). A post with neither
products nor pieces still answers `422 tryon_target_empty`. The admin post (`AdminFeedPostDto`) shows a read-only
`pieceCount`; saving a post in the panel keeps its pieces while the first image stays and drops them when it changes.

**Saving a post into my looks** (owner decision 2026-11-23). `POST v1/tenant/feed-post/{id}/look` turns an editor post
that has `pieces` into a look of the member, in one of two ways. The bookmark (`…/save`) is unrelated and unchanged.
No AI model is called by this endpoint. `requestId` is a client ULID and becomes the new look's id (a retry of the same
request never creates twice). The look's `name` is the post's title in the request language (cut to 60), its
`occasion` the post's.

- `mode: "inspiration"` — "İlham olarak kaydet". The post's photograph (first image, read from the public catalog image
  bucket, metadata stripped) is copied under the member's prefix and becomes the look's cover (`coverImageUrl`). The
  look has **no pieces** (`slots: []`, `pieceCount: 0`) and `source: "inspiration"`; nothing is added to the wardrobe.
  It never gets an AI cover, can never be shared to Akış (`422 look_not_shareable`), is not part of what followers see
  of my looks, and is deleted like any look (its photograph goes with it). `PUT v1/tenant/look/{id}` accepts `slots: []`
  for it (name, occasion, favourite). `POST v1/tenant/tryon` with `{ "kind": "look", "id": lookId }` tries it on as its
  photograph (a photo try-on: one credit, the same image as the post's own photo try-on; never for a teen —
  `422 tryon_target_empty`); the week's batch try-on skips it. "Bunu giyiyorum" on it answers `422 wear_log_empty`.
- `mode: "pieces"` — "Parçalarıyla kaydet". Every piece becomes a wardrobe item: its clean picture is copied into the
  member's storage as the item's image and published like a confirmed item's (no background removal, no recognition; the
  256 / 768 px renditions are added later by `publish-item-images`, until then the full piece picture — at most 768 px —
  is served), `category` / `subcategory` from the piece, `name` = the sub-type's label in the request language (else the
  category's), `colorIds` = the colour read from the piece's picture (`FeedPostPiece.colorId`, set by the operator tools from the pixels — no AI; `["other"]` when not read), every season, no size / brand / fabric, `source: "photo"`. The item's id is a function of the member, the post and the piece: saving the same post again (after deleting the look, say) reuses the pieces already in the wardrobe instead of adding them twice, and brings back one the member deleted. Then a normal own look
  (`source: "user"`) is made of them, one piece per slot by the slot mapping (the first piece keeps a contested slot; a
  dress closes the bottom; a piece without a slot is still added to the wardrobe). Its AI cover is requested like any
  saved look's, and it can be planned, tried on, edited and shared like any look.

Errors: `404 not_found` — unknown, draft, scheduled or retired post, the weekly-edit fallback, a user post (`u_…`).
`422 look_not_savable` — the post has no pieces; `inspiration`: no photograph that can be read; `pieces`: fewer than two
pieces that take a look slot (a look's minimum), counting only pieces whose picture can be read. `403 premium_required`
— the wardrobe-item entitlement (the gate of every way of adding a piece; open on every plan today). `409 look_id_taken`
— `requestId` is the id of another look. `400` — `mode_required` / `mode_invalid`, `request_id_invalid`. Teens: open,
both modes (editor content, like the rest of these routes).

**Deviations from the first F2 sketch (mobile: please note).** `occasion` is **nullable** (a shared look may have none;
the weekly-edit fallback never has one). `imagesExpireAt` is an added field (user posts). `pieces[].subcategory` is added.
Nothing else differs.

**`ownedSimilar` / `ownedItemId`** ("benzeri gardırobunda var", "Kendi parçalarımla kur"). There is no server-side
wardrobe ↔ product similarity yet (the edit screen's "hide what I already own" is client-side and exact), so the rule
is: the caller has an item added from this product (`item.productId`), **or** an item of the same wardrobe category
(`CatalogRules.ItemCategoryOf`) whose main colour (first colour id) is one of the product's colours. `ownedItemId` =
that wardrobe item: the one added from the product when there is one, else the category + main-colour match —
deterministic, the newest item first (`createdAt` desc, then id desc). `null` when `ownedSimilar` is false. The app opens
the look builder pre-filled with these item ids. Rule-based, free, no AI.

**Like count.** Kept in a counter row apart from the post (an admin edit never overwrites it), written in one
transaction with the user's like row (versioned, retried on a lost race — `ContentFeed:LikeRetries`, 8): concurrent
likes never lose a count, a repeat never counts twice. Account deletion takes the user's likes back off the counters
(likes and saves are tenant rows: deleted with the account and included in "Verilerimi indir").

### Akış F2 — users' shared looks (owner decision 21)

**Sharing** (`PUT v1/tenant/look/{id}/feed-share`). Who: an **adult** account with a **verified e-mail** and a
**@handle**; no membership needed; teens never (`403 teen_restricted`, feature `social` — the route is in the teen route
table). Guards, in this order: `404` (not my look) → already shared → `204` → `422 email_not_verified` (the profile's
`emailVerified`; an Apple / Google-only account has nothing to verify and passes) → `422 handle_required` (claim one with
`PUT v1/tenant/profile/handle` first) → `422 look_not_shareable` (an **imported** look — `LookDto.source = "import"`:
its cover is the user's own photo — or a look a moderator removed) → `429 too_many_attempts` (`ContentFeed:MaxSharesPerDay`;
`0` = no limit, the default). Sharing is independent of the closet visibility (a private closet may share a look).
`LookDto` (owner) carries `sharedToFeed` and, when shared, `feedStats { likeCount, saveCount }` (W §3).

**What is shared.** The look's **AI flat-lay cover** (decision 20), its name, occasion and pieces, the owner's @handle
and avatar. **Never** a try-on image, a body / face photo or an original item photo (the try-on image share of decision 20
is a later step). `images[0]` is the cover's **public address** while the post is on the feed (owner decision 22,
[docs/images.md](../images.md)): a CDN URL that does not expire (`imagesExpireAt: null`) once `Photos:PublicUrlsEnabled`
is on; the URL changes when the cover does. Until the CDN is switched on — or if the public copy could not be made — it
is a **presigned GET** valid `Photos:ReadUrlTtlSeconds` (3600 s) and `imagesExpireAt` says until when; re-read the feed
(or the saved list) for a fresh URL. The public copy is deleted on un-share, deletion, the automatic hide and an admin
removal. A shared look whose cover is **not ready for its current pieces** (still rendering,
failed, or the pieces just changed) is **not listed** until it is; sharing asks for the cover by the same rule as a save
when the look never had one (`LookCoverRules.NeedsRequest`). `pieces` = kind + cleaned image only (`category` is the
wardrobe category; `subcategory` the item's sub-type id when it has one; the image is the cleaned item image as in
`SocialLookDto`, or the catalog image for a catalog piece) — no item id, no name; a piece a moderator removed or the owner
deleted is left out.

**The mix.** At most **one of every `ContentFeed:UserPostEvery` (3) items** is a user look: two editor posts, then one
user look, and so on. A user look never appears without the editor posts before it, so user looks beyond what the editor
posts carry are not shown (no editor posts → no user looks); editor posts carry on when user looks run out. Among user
looks: first those of people the viewer **follows**, then by **style match** (the existing `styleMatchPercent`), then the
newest share. A viewer never gets: their **own** looks, looks of a **blocked pair** (either direction), posts they **hid**
or **reported**, posts taken off by reports, looks a moderator removed, looks of an owner who is a teen or has no handle
any more, or anything at all when the viewer is a **teen**. Candidates are the newest `ContentFeed:UserCandidateLimit`
(300) shares, ranked on the read (phase-1 scale).

**Similar products** (`GET …/similar`, and `hasSimilar`). The rule behind `ownedSimilar`, turned around: for each piece
of the look, the catalog products of the viewer's segment of the **same wardrobe category** whose colours include the
piece's **main colour**; a catalog piece of the look is itself the first product of its piece. Not retired; one piece
after the other (round-robin, so every piece is represented), each piece's products newest first; no product twice; at
most 12. `hasSimilar` = this list is not empty. Rule-based, free, no AI.

**Reports and moderation.** A report is an ordinary moderation report of the look (`targetKind: look`, `targetId` = the
look id — it also shows in `GET v1/admin/moderation/report`). When the look's **open** reports come from
`ContentFeed:ReportsToAutoHide` (**3**) **distinct reporters**, the post leaves the feed automatically (likes and saves on
it answer `404`; the owner still sees `sharedToFeed: true` and is not notified) and waits in the admin list
(`GET v1/admin/feed-user-post`, §11). The admin either **restores** it (the open reports are resolved `dismissed`; the
count starts again from zero) or **removes** it — the existing look moderation: the reports are resolved
`contentRemoved`, the look is hidden from everyone but its owner, who sees it with `moderation { hidden, reason }`
(canvas 28e) and gets the `content_removed` inbox row; the report's `POST …/restore` undoes it and the look is back in
the feed. Un-sharing does not clear open reports: a look that is shared again is counted against them (and is hidden
from the start when they already reach the limit).

**Likes digest.** A like on a shared look writes a marker for the owner's daily digest (§9, `feed_likes_digest`).

**Removal.** Un-share, deleting the look and deleting the account remove the post, its counters and every like, save,
hide and report pointer other people left on it (found through the post's reaction index); a leaving liker's likes and
saves come off the counters. The moderation reports themselves follow the report retention (§6). `FeedShare`, `FeedHide`
and `FeedReport` rows are tenant rows: in `DeletionPlan` and in "Verilerimi indir".

**Weekly-edit fallback** (owner's ask, 22 Nov 2026). When the viewer's segment has **no live editor post at all**, the
feed shows the looks of the **currently published weekly edit** of that segment as editor posts instead: `kind: editor`,
author Droblet Edit (verified), `id` = `"e_" + editLookId`, `title` / `note` = the look's title / style note, `images` =
the look image (a look without an image is left out), `products` = the look's **first variant by price band** (the one
try-on target `editLook` picks), Monday first, `occasion: null` (so an occasion tab stays empty). User looks mix in as
with real editor posts. **Like, save, hide and try-on work with that id** (try-on target `feedPost`; the id resolves to
a look of any published, not retired edit, so a like or a save keeps working after the week turns); the first live
editor post ends the fallback. Nothing is stored: the posts are mapped on the read.

**Ids.** Editor post = a slug or a ULID; user post = `u_…`; fallback = `e_…`. The underscore cannot occur in an editor
post id, so the kinds never collide.

## 3. Catalog (screens 21, 22)

| Method | Path | Result |
|---|---|---|
| GET | `v1/catalog/brand` | `[{ "id", "name", "logoUrl", "websiteUrl" }]` — active brands, by name. |
| GET | `v1/catalog/color` | `[{ "id", "name", "hex", "count" }]` — the colours live products of the user's segment come in, most products first; `name` in the request language. The colour filter is built from this list (`other` is never in it). |
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
| PUT | `v1/tenant/user/me/notifications` | `{ "morningOutfit", "morningOutfitLocalTime": "07:30", "weeklyEdit", "friendRatings", "priceDrop"?, "followRequests"?, "feedLikesDigest"?, "timeZone": "Europe/Istanbul", "baseVersion" }` — `priceDrop` / `followRequests` / `feedLikesDigest` omitted = unchanged | `NotificationPrefsDto`. `409` + current prefs. `400`: `local_time_invalid` (HH:mm, quarter hours only), `time_zone_invalid` (IANA id). `403 consent_required` (`missing: ["marketingNotifications"]`) when `weeklyEdit` or `priceDrop` is `true` without the marketing consent. |
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
                     "priceDrop": false, "followRequests": false, "feedLikesDigest": true,
                     "timeZone": "Europe/Istanbul", "version": 1, "updatedAt": "…" },
  "devices": [ { "deviceId": "…", "platform": "ios", "pushEnabled": true, "updatedAt": "…" } ],
  "profileVersion": 3 }                                    // baseVersion for profile and visibility PUTs
```

- `morningOutfitLocalTime` is the user's **local** wall-clock time; with `timeZone` it stays correct across DST.
- The first device registration **with a push token** creates the preferences with **only `morningOutfit` on** (decision 9,
  amended by the legal review — REVIEW §5 G2: the weekly edit is a marketing message and needs consent 5, so it starts
  **off** until the user opts in); `weeklyEdit`, `friendRatings`, `priceDrop` and `followRequests` start off. `feedLikesDigest` (Akış F2: one push a day about the likes on the looks I shared) is **on by default** — unset reads as `true`, also with `version: 0`; a teen always reads `false`. Later
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
| `feed_likes_digest` | `day`, `count` (the number of likes in the digest = distinct people) | Daily, with the evening digest (16:00 UTC): the looks I shared (Akış F2) were liked in the 24 hours before the run; `feedLikesDigest` on (**the default**). Title "Looklarını {count} kişi beğendi". An un-like of the same day does not count. Never to a teen | day |
| `morning_outfit` | `day` | At `morningOutfitLocalTime`; `morningOutfit` on **and** a look that still exists is planned for the user's local day (`PUT v1/tenant/plan-day/{date}` with a `lookId`; an occasion alone does not count) | local day |

Every handled event is also written to the in-app inbox (`GET v1/tenant/notification`, [C §4](consents-age-inbox-avatar.md)),
with or without a registered device: `morning_outfit`, `weekly_edit` and `price_drop` under the same conditions as the push;
`follow_request`, `friend_ratings` and `feed_likes_digest` (data `day`, `count`) even when their push is switched off.

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
| GET | `v1/admin/feed-user-post` | — | `AdminFeedUserPostDto[]` — shared looks (Akış F2, §2b) with an open report, or taken off the feed by `ContentFeed:ReportsToAutoHide` distinct reporters. Teen-involved first, then auto-hidden, most reported, newest. |
| POST | `v1/admin/feed-user-post/{id}/restore` | `{ "note"? (≤ 500) }` (body optional) | `204`. Back in the feed; the look's open reports are resolved `dismissed` (the note kept on them), so the count starts from zero. Idempotent. `404 not_found`. Audit `feed_user_post.restore`. |
| POST | `v1/admin/feed-user-post/{id}/remove` | `{ "note"? (≤ 500) }` (body optional) | `200 { "reportId" }`. The existing look moderation: the open reports are resolved `contentRemoved` and the look is hidden from everyone but its owner (inbox `content_removed`); `reportId` = the report the removal is recorded on — its `…/moderation/report/{reportId}/restore` undoes it. `404 not_found`, `409 feed_post_not_reported` (no open report). Audit `feed_user_post.remove`. |
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

// AdminFeedUserPostDto (moderation.manage)
{ "id": "u_3f9c…", "ownerTenantId": "…", "ownerHandle": "elif_k", "lookId": "01J…", "lookName": "Hafta sonu", "occasion": "weekend" | null,
  "imageUrl": "https://…" | null,            // the cover the feed showed, presigned, short-lived
  "sharedAt": "…", "status": "reported" | "autoHidden", "reporterCount": 3,
  "reasons": [ { "reason": "spam", "count": 2 } ],
  "reports": [ { "id", "status": "open", "reason", "note", "reporterTenantId", "reporterHandle", "createdAt" } ],   // the look's open reports
  "hiddenAt": "…" | null, "restoredAt": "…" | null, "likeCount": 12, "involvesTeen": false }

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
| `ContentFeed` | `PageSize`, `MaxStories`, `LikeRetries` (Akış F1, §2b); F2: `MaxSharesPerDay` (looks one account may share per day, `0` = unlimited), `UserPostEvery` (one user look per N items), `UserCandidateLimit`, `ReportsToAutoHide` (distinct reporters), `MaxSimilarProducts` | 10, 20, 8; 0, 3, 300, 3, 12 — SSM `/droblet/{stage}/api/ContentFeed` (template.yaml `SsmApiContentFeed`), re-read every 60 s |
| `Weather` | `Provider`, `CacheMinutes`, `ForecastBaseUrl`, `GeocodingBaseUrl`, `TimeoutSeconds` | `OpenMeteo`, 60 |
| `Notifications` | `DefaultMorningLocal`, `DefaultTimeZone`, `MaxDevicesPerTenant` | `07:30`, `Europe/Istanbul`, 10 |
| `/droblet/{stage}/notifier/Push/ServiceAccountJson` (SecureString) | the Firebase service-account JSON file as downloaded (`project_id`, `client_email`, `private_key`) | `CHANGE_ME` or empty → push disabled |

`template.yaml` creates the non-secret sections (`Localization`, `AdminAuth`, `Catalog`, `Social`, `Weather`, `Notifications`,
`Affiliate`, plus `Wardrobe`, `Stylist`, `Packing`, `Palette`, `Entitlements`) as SSM String parameters with these defaults —
for the Api and, where a worker applies the same rule, under `/worker/` (and `Localization` under `/notifier/`).
Secrets are created by `deploy-infra` with the placeholder `CHANGE_ME`, which the code treats as **not configured**
(no e-mail, no push, no AI call, no Apple key, no store notification key). `AffiliatePostback` is created by hand; a
missing or `CHANGE_ME` secret refuses every postback (503).
