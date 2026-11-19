# Droblet API — wardrobe, looks, plan, stylist, try-on, palette (E2–E7)

Contract for the mobile team. Everything here is implemented in `src/Api/Endpoints/V1/Tenant/*` and covered by `tests/ApiTests/WardrobeEndpointTests.cs` and `tests/ApiTests/IntegrationEndpointTests.cs`. Catalog, cart, social, settings, weather and admin are in [store-social-settings.md](store-social-settings.md); the full endpoint index is [README.md](README.md).

## 1. Conventions

| Topic | Rule |
|---|---|
| Auth | Every endpoint needs `Authorization: Bearer <accessToken>` (`TenantUserJwt`). The tenant always comes from the token, never from the body. |
| JSON | camelCase properties, camelCase enum strings (`"bagAccessory"`), integers are never accepted for enums. |
| Dates | Calendar days are the **user's local day** as `yyyy-MM-dd` (`date`, `startDate`, `lastWornAt`, `planDate`). Instants (`createdAt`, `occurredAt`, `packedAt`, `urlExpiresAt`) are UTC ISO-8601. The server never formats dates, numbers or currency. |
| Ids | Client-generated ids, `requestId` and `clientMutationId` are ULIDs (26 chars). |
| Idempotency | `clientMutationId` = one user action; `requestId` = one job. Sending the same one again returns the same result and changes nothing. |
| Versioned edits | `PUT` carries `baseVersion`. A stale version returns **409 with the current record as the body** (same shape as 200). `baseVersion: 0` creates where stated. |
| Errors | `application/problem+json` with a stable snake_case `code` (also in `title`). 400 = `validation_failed` with `errors: { "<field>": ["<code>"] }`. The API never returns a sentence — the client translates codes. |
| Long jobs | `202` + a job. Poll `GET v1/tenant/job/{id}` (`status`: `queued` \| `processing` \| `completed` \| `failed`; `failure`: `providerError` \| `timeout` \| `guardRejected` \| `sourceDeleted` \| `noFaceDetected`; `result`: the draft, shapes in §9). |
| Images | `imageUrl` values are short-lived presigned GETs (see `…ExpiresAt`); never cache them beyond that, never share them. |

### Language

The only prose the API returns is (a) AI-generated text and (b) reference names.

- AI text (look titles/notes, suitcase day labels, draft names) is generated in the user's language: profile `language` → `Accept-Language` (first supported language by q weight) → the default language. The supported languages and the default are config (`Localization:SupportedLanguages`, today `tr`, `en`; default `tr`) — the same list everywhere in the API. The profile language is set at registration from the phone's `Accept-Language` (unsupported → `tr`) and the app writes it again with `PUT v1/tenant/profile { "language", "baseVersion" }` whenever the app language changes. The language is stored with the result (`result.language`, `draft.language`); if it differs from the current UI language, start a new job instead of showing the stored text.
- Reference names (colours, season types, library pieces) are stored as `{ "tr": "…", "en": "…" }` and returned already resolved in a single `name` field, with a default-language (Turkish) fallback. A third language is config + data only.

### Shared error codes

| HTTP | code | Meaning / client action |
|---|---|---|
| 403 | `premium_required` | AI feature touched by a non-member → paywall (05) |
| 402 | `credits_exhausted` | No AI image credit left → **credit-pack sheet (05b)**, not the paywall |
| 402 | `item_recognition_limit_reached` | A non-member used every free AI garment recognition → paywall; adding the piece by hand stays possible (`manual: true`, §3) |
| 409 | `request_id_reused` | `requestId` already used for a different kind of job |
| 409 | `job_not_completed` | Accept called before the job finished |
| 404 | `job_not_found`, `suggestion_not_found` | |
| 409 | `suggestion_stale` | A piece of the draft was deleted (or the trip changed) since the draft was made |

### Enums

| Enum | Values |
|---|---|
| `ItemCategory` | `top`, `bottom`, `dress`, `outerwear`, `shoes`, `bag`, `accessory`, `beachwear`, `skiwear` |
| `Season` | `spring`, `summer`, `autumn`, `winter` |
| `ItemSource` | `photo`, `library`, `purchase`, `manual` (typed in without a photo) |
| `ItemListingStatus` | `none` (phase 1 always), `forSale`, `forRent`, `sold`, `rented` (reserved for phase 2) |
| `ItemDraftStatus` | `uploaded`, `processing`, `ready`, `failed`, `detected` (a piece of a draft group waiting for the user's selection; its image is the plain crop) |
| `ItemDraftKind` | `single` (one piece found, or a manual entry), `outfit` (the photo of a **draft group**: two or more pieces were found in it), `piece` (one piece of a group, `parentDraftId` = `groupId` = the group photo) |
| Sub-type ids (`subcategory`) the AI suggests | tops `t-shirt` `shirt` `blouse` `sweater` `cardigan` `hoodie` `tank-top` `top` · bottoms `jeans` `trousers` `skirt` `shorts` `leggings` · `dress` `jumpsuit` · outerwear `blazer` `jacket` `coat` `trench-coat` `puffer` `vest` · shoes `sneakers` `boots` `ankle-boots` `heels` `flats` `sandals` `loafers` · bags `handbag` `tote` `shoulder-bag` `crossbody` `clutch` `backpack` · accessories `belt` `hat` `cap` `beanie` `scarf` `sunglasses` `glasses` `watch` `gloves` `tie` `hair-accessory` · jewellery (category `accessory`) `ring` `necklace` `earrings` `bracelet` `brooch` `anklet` · beachwear `bikini` `swimsuit` `kaftan` · skiwear `ski-jacket` `ski-pants` (`SubcategoryCatalog`; the form still accepts any valid id) |
| `ItemCreateOutcome` | `created`, `alreadyApplied`, `rejected` |
| `OutfitSlot` | `top`, `bottom`, `outerwear`, `shoes`, `bagAccessory` |
| `Occasion` | `office`, `dinner`, `weekend`, `wedding`, `travel`, `sport` — there is no separate `evening`: the design's short label "Akşam" (Looklar filter, look tags) and "Akşam yemeği" (Stilist chips, week summary) are the same occasion and never appear side by side, so the app maps its `evening` key to `dinner` (`mobile/src/api/wire/wardrobe.ts`, tested) |
| `LookSource` | `user`, `stylist`, `edit`, `builder` (`stylist` is set only by the accept endpoints) |
| `TripType` | `business`, `dinner`, `sightseeing` |
| `TripStatus` | `upcoming`, `active`, `past` |
| `WeatherCondition` | `clear`, `partlyCloudy`, `cloudy`, `fog`, `drizzle`, `rain`, `snow`, `showers`, `thunderstorm`, `unknown` (one enum for the whole API — same as `GET v1/weather`) |
| `DislikeReason` | `notMyStyle`, `wrongOccasion`, `wrongWeather`, `colorMismatch`, `wornTooOften`, `other` |
| `MissingPieceReason` | `emptySlot`, `rain`, `cold`, `noShoes`, `suggested` |
| `BodyType` | `hourglass`, `pear`, `apple`, `rectangle`, `invertedTriangle`, `unsure` (body profile; face try-on path) |
| `TryOnSource` | `body`, `face` |
| `JobFailure` (added) | `photoUnsuitable` |
| `TryOnTargetKind` | `item`, `look`, `product`, `editLook`, `suggestion`, `tripDay` |
| `StartStatus` | `cached`, `queued` |

Colour ids, fabric ids and season type ids are fixed kebab-case strings; get them from `GET v1/tenant/reference/wardrobe`. The colour list ends with `other` ("Diğer" / "Other", family `other`): a colour outside the list, optionally with the user's own `colorHex` on the item.

---

## 2. Reference data

### GET `v1/tenant/reference/wardrobe?language=`
`language` optional (`tr` \| `en`; falls back to `Accept-Language`, then `tr`).

```json
{
  "colors": [{ "id": "navy", "family": "blue", "hex": "#1B2A49", "name": "Lacivert" }],
  "fabrics": ["cotton", "linen", "wool"],
  "categories": ["top", "bottom", "dress", "outerwear", "shoes", "bag", "accessory", "beachwear", "skiwear"],
  "seasons": ["spring", "summer", "autumn", "winter"],
  "occasions": ["office", "dinner", "weekend", "wedding", "travel", "sport"],
  "tripTypes": ["business", "dinner", "sightseeing"],
  "slots": [{ "slot": "top", "categories": ["top", "dress", "beachwear", "skiwear"] }],
  "seasonTypes": [{ "id": "warm-autumn", "name": "Sıcak Sonbahar", "flatteringColorIds": ["camel"], "avoidColorIds": ["black"] }],
  "lookMinPieces": 2,
  "maxBulkItems": 30,
  "language": "tr"
}
```

### GET `v1/tenant/library/item`
Ready-made library (screens 04b, 12b). Names in the profile language.

```json
[{ "id": "lib-white-tshirt", "name": "Beyaz tişört", "category": "top", "colorIds": ["white"], "fabric": "cotton", "seasons": ["spring", "summer", "autumn"], "imageUrl": null }]
```
`imageUrl` is null until `Wardrobe:PublicAssetBaseUrl` is configured (global asset bucket/CDN).

`reference.slots` reflects the category → slot mapping in config (`Wardrobe:SlotMapping`; default: beachwear → top/bottom, skiwear → top/bottom/outerwear). Always read it from here instead of hard-coding it.

---

## 3. E2 — Wardrobe

### ItemDto
```json
{
  "id": "01J…", "name": "Lacivert blazer", "category": "outerwear", "subcategory": "blazer",
  "colorIds": ["navy"], "colorHex": null, "fabric": "wool", "fabricText": null,
  "seasons": ["autumn", "winter"], "size": "M", "brand": "Mango",
  "source": "photo", "productId": null, "libraryItemId": null,
  "imageUrl": "https://…", "imageUrlExpiresAt": "2026-11-18T09:05:00Z",
  "hasOriginalImage": true, "useOriginalImage": false,
  "wearCount": 3, "lastWornAt": "2026-11-17", "listingStatus": "none",
  "createdAt": "…", "updatedAt": "…", "version": 2
}
```
`colorIds[0]` is the main colour. `wearCount` / `lastWornAt` are server-computed from wear logs and cannot be written.
Form fields that are kept as entered: `subcategory` (free sub-type id from the form, lower-case words joined by `-`,
≤ 40 chars, e.g. `blazer`, `mini-skirt` — the `category` still drives outfit slots), `fabricText` (free-text fabric
≤ 60 chars when it is none of the fabric ids; `fabric` stays the id or `null`), `colorHex` (`#RRGGBB`, upper-cased,
kept only when `colorIds` contains `other`; otherwise stored as `null`). `imageUrl` is `null` for a piece without a
photo (`source: "manual"`) — show the category glyph.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `v1/tenant/item` | — | `ItemDto[]`, newest first (filter/sort on device) |
| GET | `v1/tenant/item/{id}` | — | `{ "item": ItemDto, "looks": LookDto[] }` · 404 |
| PUT | `v1/tenant/item/{id}` | below | `ItemDto` · 400 · 404 · 409 (current `ItemDto`) |
| DELETE | `v1/tenant/item/{id}` | — | 204 · 404. Looks keep the slot and return it with `unavailable: true` |

PUT body (all user fields are replaced):
```json
{ "name": "Krem kazak", "category": "top", "subcategory": "sweater", "colorIds": ["cream"], "colorHex": null, "fabric": "knit", "fabricText": null,
  "seasons": ["winter"], "size": "M", "brand": null, "useOriginalImage": false, "baseVersion": 1 }
```
Validation codes (400 `errors`): `category_required`, `color_required`, `color_unknown` (unknown id, duplicate, more than 5), `fabric_unknown`, `season_required` (**at least one season**), `subcategory_invalid`, `fabric_text_too_long`, `color_hex_invalid`, `base_version_invalid`. Limits: name 80, brand 60, size 12 chars. `useOriginalImage: true` = "Orijinale dön".

### Photo upload → draft → confirm

1. **POST `v1/tenant/item/upload-url`** `{ "count": 1, "contentType": "image/jpeg" }` (`count` 1–30; `image/jpeg` \| `image/png`)
   → `{ "uploads": [{ "uploadId": "01J…", "url": "https://…", "fields": { "key": "…", "Content-Type": "image/jpeg", "…": "…" }, "expiresAt": "…", "maxBytes": 10485760 }] }`
   Upload each photo as multipart form POST to `url`: all `fields` first, then `file` (same pattern as profile photos).
   400 codes: `count_out_of_range`, `content_type_required`, `content_type_unsupported`.

2. **POST `v1/tenant/item-draft`** `{ "requestId": "01J…", "uploadIds": ["01J…"], "splitOutfit": false, "manual": false }` → **202**
   ```json
   { "drafts": [ItemDraftDto], "jobs": [JobDto], "skippedCount": 0, "skippedUploadIds": [],
     "itemRecognition": { "limit": 10, "used": 3, "remaining": 7 } }
   ```
   **AI recognition allowance (non-members).** A non-member has a lifetime number of AI recognitions (`Entitlements:Free:ItemRecognitionLimit`, default 10; `GET v1/tenant/entitlement` → `itemRecognition`). Every photo of a single, bulk or split request uses one **when its job completes**; a job that fails (`providerError`, `guardRejected`, `sourceDeleted`, …) uses none. A bulk request above what is left processes the first photos and returns the rest in `skippedCount` / `skippedUploadIds` (those uploads are untouched). Nothing left → **402 `item_recognition_limit_reached`** (show the paywall); limit configured as 0 → **403 `premium_required`** (kept as documented; the app treats both as the paywall, and `GET v1/tenant/entitlement` reports a 0 limit exactly like an exhausted one: `{ "limit": 0, "used": 0, "remaining": 0 }`). The free limit is 10 (`Entitlements:Free:ItemRecognitionLimit` in `api/Entitlements` and `worker/Entitlements`). Members: unlimited (`limit` / `remaining` are `null`).
   **Manual entry.** `"manual": true` uses no AI and no allowance: each photo becomes a draft that is immediately `ready`, without suggestions and without a job (`jobId: null`); the user fills the form and confirms it as usual. Use it after a 402, or for the skipped uploads.
   One draft (id = `uploadId`) and one job per photo; with a single photo the job id is `requestId`.
   **Multi-item detection (every AI photo, single and bulk).** One vision call per photo lists every wearable piece in it —
   garments, shoes, bags, belts, hats, scarves, sunglasses, watches and jewellery (rings, necklaces, earrings, bracelets) — with
   category, sub-type, colours, material, seasons, a name in the user's language, a confidence and a normalised box. The server
   drops non-wearables (people, faces, body parts are never pieces), boxes that are invalid or smaller than 2 % of a side,
   duplicates of a kept piece, and keeps at most `Wardrobe:MaxDetectedItems` (12), numbered in reading order. Then:
   - **nothing found** → the draft is `failed` with `failure: "guardRejected"` ("Bu fotoğrafta parça bulamadık": retry or manual entry; no recognition used);
   - **one piece** → as before: the draft stays `kind: "single"`, its crop (the whole photo when the piece fills it) gets its background removed, it is `ready` with the suggestion → the review form;
   - **two or more** → the draft becomes a **draft group** (`kind: "outfit"`, `status: "ready"`, `itemCount`, `photoWidth` / `photoHeight`) and each piece a draft
     `{ kind: "piece", status: "detected", groupId, parentDraftId, index, box, confidence, subcategory, … }` whose `imageUrl` is the plain crop of the EXIF-stripped photo
     (padded; jewellery and other small pieces get a wide, upscaled crop). **No image-model call happens before the user selects** (step 3b).
   Cost per photo: 1 vision call + 1 image edit per piece the user keeps. The recognition allowance counts **one per photo**, never per piece.
   `splitOutfit` is legacy and ignored (every photo runs the same detection).
   Errors: 404 `upload_not_found` · 422 `upload_missing` (nothing was uploaded to that slot) · 402 `item_recognition_limit_reached` · 403 `premium_required` · 400 `request_id_invalid`, `upload_ids_out_of_range`, `upload_id_invalid`.

3. **GET `v1/tenant/item-draft`**
   ```json
   {
     "drafts": [{
       "id": "01J…", "kind": "single", "status": "ready", "jobId": "01J…", "parentDraftId": null,
       "imageUrl": "https://… (cleaned, or the original while processing/failed)", "originalImageUrl": "https://…", "imageUrlExpiresAt": "…",
       "name": "Lacivert blazer", "category": "outerwear", "colorIds": ["navy"], "fabric": "wool", "seasons": ["autumn"],
       "flaggedFields": ["category"], "needsReview": true, "language": "tr", "createdAt": "…"
     }],
     "total": 12, "processed": 8
   }
   ```
   Multi-item fields (absent / null otherwise): `subcategory`, `groupId`, `box` `{ "x", "y", "width", "height" }` (0–1, top-left + size, on the group photo),
   `index` (1-based), `confidence` (0–1; below 0.7 the piece is also `needsReview`), `selected`, `itemCount` / `photoWidth` / `photoHeight` (group only), `failure`.
   A group photo is listed only while some of its pieces are still `detected` (the chooser draws their boxes on it); afterwards only its kept pieces are.
   `total` / `processed` = the progress card. `flaggedFields` ⊆ `category`, `colorIds`, `fabric`, `seasons` (low confidence or a value the server dropped). `needsReview: true` = "Kategoriyi kontrol et": show the checkbox **unticked**; "select all" must skip it. A `failed` draft still has the original photo and can be confirmed by filling the form by hand. Unconfirmed drafts expire after 7 days.

3b. **POST `v1/tenant/item-draft/{groupId}/select`** — "N parçayı ekle" in the chooser
   ```json
   { "draftIds": ["01J…", "01J…"],
     "edits": [{ "draftId": "01J…", "name": "Altın kolye", "category": "accessory", "subcategory": "necklace", "colorIds": ["beige"], "fabric": null, "seasons": ["spring","summer","autumn","winter"] }] }
   ```
   → **202** (same body as step 2: the kept pieces, now `processing` with `selected: true`, and one job each of kind `itemClean`).
   Each kept piece gets its background removed from its crop (sand product background); it then turns `ready` (cleaned image) or `failed`
   (the crop stays its photo: it can still be confirmed, or retried with `…/{id}/retry`, again without using a recognition). Every other
   `detected` piece of the group is **discarded** with its crop. `draftIds: []` discards them all. `edits` (optional) = values the user typed
   in the form before selecting; valid values replace the suggestion and the piece counts as reviewed. Idempotent (a replay queues nothing new).
   A `detected` piece is never confirmed directly (`draft_not_ready`); deleting the group photo also deletes its `detected` pieces.
   Errors: 404 `draft_not_found` · 409 `draft_not_group` (not a ready group) · 422 `draft_not_in_group` · 400 `draft_ids_required`, `draft_ids_out_of_range`, `draft_id_invalid` · 403 `premium_required`.

4. **POST `v1/tenant/item-draft/confirm`** (1–30 rows, each with the user's final values — the server never copies AI values on its own)
   ```json
   { "items": [{ "draftId": "01J…", "clientMutationId": "01J…", "reviewed": true, "name": "Lacivert blazer", "category": "outerwear",
       "colorIds": ["navy"], "fabric": "wool", "seasons": ["autumn", "winter"], "size": "M", "brand": "Mango", "useOriginalImage": false, "itemId": null,
       "subcategory": "blazer", "fabricText": null, "colorHex": null }] }
   ```
   → 200
   ```json
   { "results": [{ "refId": "<draftId>", "outcome": "created", "code": null, "errors": null, "item": ItemDto }], "createdCount": 1 }
   ```
   The new item id is `itemId ?? clientMutationId`. Per-row `code` when `outcome: "rejected"`: `draft_not_found`, `draft_not_ready`, `draft_review_required` (flagged draft sent with `reviewed: false`), `draft_is_outfit_source`, `validation_failed` (+ `errors`: the item codes above), `item_id_taken`.
   400 (whole request): `items_out_of_range`, `draft_duplicate`, `client_mutation_id_duplicate`, `draft_id_invalid`, `client_mutation_id_invalid`.

   **Retry — POST `v1/tenant/item-draft/{id}/retry`** (no body) → **202**, same body as step 2 with one draft and one job.
   "Tekrar dene" on a `failed` draft: a new job runs on the photo the draft already has — nothing is uploaded again (the
   temporary upload expires after a day; the server restores it from the original kept with the draft). The draft keeps its
   id, goes back to `uploaded` with the new `jobId`, and its earlier suggestions are cleared. An outfit source (`kind:
   "outfit"`) is split again. The recognition allowance applies as for a new photo: the failed job used none, the retry
   reserves one — 402 `item_recognition_limit_reached` when nothing is left, 403 `premium_required` when the limit is 0.
   A failed `piece` (its background removal failed after it was selected) is retried as an `itemClean` job — no recognition is used.
   Errors: 404 `draft_not_found` · 409 `draft_not_failed` (the draft is not `failed`, or is a piece that was never selected) · 422 `upload_missing`
   (neither the upload nor the original photo exists any more) · 402 · 403.

5. **DELETE `v1/tenant/item-draft/{id}`** → 204 · 404. Deleting a draft that is still being processed is final: the worker never writes it back, removes the images it produced and ends the job as `failed` / `sourceDeleted` (no allowance used).

### Without a photo

- **POST `v1/tenant/item`** — "Fotoğrafsız ekle": a piece typed in by hand (no photo, no AI, no recognition allowance).
  ```json
  { "clientMutationId": "01J…", "itemId": null, "name": "Ekose ceket", "category": "outerwear", "subcategory": "blazer",
    "colorIds": ["other"], "colorHex": "#A1B2C3", "fabric": null, "fabricText": "Yün karışımlı tüvit",
    "seasons": ["autumn"], "size": "38", "brand": null }
  ```
  → **201** `{ "refId": "<clientMutationId>", "outcome": "created", "code": null, "errors": null, "item": ItemDto }` ·
  **200** with `outcome: "alreadyApplied"` on a replay of the same `clientMutationId` (never a second item).
  Category, at least one colour and at least one season are required; 400 carries the item codes above plus
  `client_mutation_id_invalid`, `item_id_invalid`. The item has `source: "manual"` and `imageUrl: null`. A photo can be
  added later only by adding the piece again with a photo (no image attach endpoint in phase 1).
- **POST `v1/tenant/item/from-library`** `{ "items": [{ "clientMutationId": "01J…", "libraryItemId": "lib-white-tshirt", "size": "S" }] }` (1–30)
  → same `results` shape (`refId` = `libraryItemId`); rejected code `library_item_not_found`. Items get `source: "library"`.
- **POST `v1/tenant/item/from-product`** `{ "clientMutationId": "01J…", "productId": "prd…", "size": "M" }`
  → 201 (created) / 200 (replay) with one result row `{ refId, outcome, code, errors, item }`; items get `source: "purchase"`. 404 `product_not_found` (unknown or retired).
  The product comes from the real catalog (`GET v1/catalog/product/{id}`): the item takes the product name in the user's language, the brand name, the product's first image as `imageUrl` (a public catalog URL, no expiry) and the wardrobe category of the catalog category (`tshirt`/`shirt`/`blouse`/`knitwear`/`sweatshirt`/`activewear` → `top`; `trousers`/`jeans`/`skirt`/`shorts` → `bottom`; `jacket`/`coat` → `outerwear`; `dress` → `dress`; `swimwear` → `beachwear`; `skiwear`, `shoes`, `bag`, `accessory` unchanged). Catalog colours that are not wardrobe colour ids are dropped; seasons default to all four. "Gardıroba ekle" on the product screen is this call; accepting a purchase prompt (`PUT v1/tenant/purchase-prompt/{id}`, other document) adds the pieces server-side with the same rules.

---

## 4. E3 — Looks

### LookDto
```json
{
  "id": "01J…", "name": "Ofis", "occasion": "office",
  "slots": [
    { "slot": "top", "itemId": "01J…", "productId": null, "missing": false, "unavailable": false },
    { "slot": "bagAccessory", "itemId": null, "productId": "prd…", "missing": true, "unavailable": false }
  ],
  "pieceCount": 2, "hasMissingPieces": true, "favorite": false, "source": "user",
  "createdAt": "…", "updatedAt": "…", "version": 1,
  "rating": { "average": 4.5, "count": 2 }
}
```
`rating` = what friends gave this look (`PUT v1/tenant/people/{handle}/look/{lookId}/rating`): average with one decimal and the number of ratings. It is filled by `GET v1/tenant/look` and `GET v1/tenant/look/{id}`; it is `null` while nobody rated the look and wherever a `LookDto` is embedded in another response (plan day, today, item detail, accept results). Deleting a look deletes its rating summary.
`missing: true` = the slot is a catalog product the user does not own ("Eksik parça" → "Look'u tamamla"). `unavailable: true` = the wardrobe item was deleted.

Slot rules (server-enforced, also in `reference.slots`): one piece per slot; each slot is **either** `itemId` (own wardrobe) **or** `productId` (catalog); the category must fit the slot; a **dress goes in `top` and closes `bottom`**; **at least 2 pieces**; the same piece cannot fill two slots.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `v1/tenant/look` | — | `LookDto[]`, newest first |
| GET | `v1/tenant/look/{id}` | — | `LookDto` · 404 |
| POST | `v1/tenant/look` | `{ "id": "01J…", "name": "Ofis", "occasion": "office", "slots": [{ "slot": "top", "itemId": "…" }, { "slot": "bagAccessory", "productId": "…" }], "favorite": false, "source": "builder" }` | 201 `LookDto` · 200 (same id sent again) · 400 · 422 |
| PUT | `v1/tenant/look/{id}` | `{ "name", "occasion", "slots", "favorite", "baseVersion" }` | `LookDto` · 404 · 409 (current) · 422 |
| DELETE | `v1/tenant/look/{id}` | — | 204 · 404 |

422 codes: `look_min_pieces`, `slot_duplicate`, `slot_source_invalid`, `slot_category_mismatch`, `slot_item_not_found` (also another user's item), `slot_product_not_found` (unknown or retired), `slot_piece_repeated`, `dress_closes_bottom`.
400 codes: `id_invalid`, `name_too_long` (60), `slots_required`, `slots_out_of_range`, `slot_invalid`, `base_version_invalid`.

---

## 5. E4 — Today, plan, calendar

### GET `v1/tenant/today?date=yyyy-MM-dd&latitude=&longitude=`
`date` required (the device's local day). Coordinates only when location permission is granted; otherwise the profile city is used.

```json
{
  "date": "2026-11-18", "season": "autumn",
  "weather": { "date": "2026-11-18", "minTempC": 8, "maxTempC": 14, "condition": "rain", "precipitationChance": 70 },
  "occasion": "office",
  "plan": { "date": "2026-11-18", "occasion": "office", "lookId": "01J…", "look": LookDto, "worn": false, "version": 1, "updatedAt": "…" },
  "look": LookDto,
  "hasMissingPieces": true,
  "missingPieces": [{ "slot": "shoes", "itemId": null, "productId": "prd…", "missing": true, "unavailable": false }],
  "worn": false,
  "week": [{ "date": "2026-11-18", "hasPlan": true, "worn": false }]
}
```
`weather` comes from the weather provider (Open-Meteo, shared 60-minute cache): the coordinates when both are sent, otherwise the profile city (`cityId` from `GET v1/weather/city`). Temperatures are whole °C. It is **null** when neither is known, when the provider is unavailable and nothing is cached, or when `date` is outside the provider's 16-day forecast horizon. Trip days (`TripDetailDto.days[].weather`) follow the same rule with the trip's `cityId`. `plan`/`look` null = "Bugün için plan yok". `week` = 7 days starting at `date`. 400 `validation_failed` for a bad date.

### Plan days
| Method | Path | Request | Response |
|---|---|---|---|
| GET | `v1/tenant/plan-day?from=&to=` | inclusive, ≤ 62 days | `PlanDayDto[]` · 400 |
| PUT | `v1/tenant/plan-day/{date}` | `{ "occasion": "office", "lookId": "01J…", "baseVersion": 0 }` (both nullable) | `PlanDayDto` · 404 · 409 (current) · 422 `look_not_found` |
| DELETE | `v1/tenant/plan-day/{date}` | — | 204 · 404 |

### Wear log — "Bunu giyiyorum"
**POST `v1/tenant/wear-log`** — exactly one of `lookId` / `itemIds` (≤ 10)
```json
{ "clientMutationId": "01J…", "date": "2026-11-18", "occurredAt": "2026-11-18T07:42:00Z", "lookId": "01J…" }
```
→ 200
```json
{ "log": { "id": "<clientMutationId>", "date": "2026-11-18", "lookId": "01J…", "itemIds": ["…"], "occurredAt": "…" },
  "items": [{ "itemId": "…", "wearCount": 4, "lastWornAt": "2026-11-18" }] }
```
The wear count of a piece goes up **once per calendar day**, however many logs mention it. A replay returns the same log. 404 on replay = the log was undone meanwhile.
Errors: 422 `look_not_found`, `item_not_found`, `wear_log_empty` · 400 `date_invalid`, `occurred_at_out_of_range` (future > 5 min or older than 30 days), `look_or_items_required`, `item_ids_invalid`.

| Method | Path | Response |
|---|---|---|
| DELETE | `v1/tenant/wear-log/{date}/{id}` | 204 (counts are given back) · 404 |
| GET | `v1/tenant/wear-log?month=yyyy-MM` | `WearLogDto[]` |
| GET | `v1/tenant/wear-log/summary?month=yyyy-MM` | `{ "month": "2026-11", "loggedDays": 10, "totalWears": 31, "mostWorn": [{ "itemId": "…", "days": 6, "item": ItemDto }] }` (top 5) |

---

## 6. E5 — Stylist and trips

Text stylist jobs cost **no credit**; they need the membership (403 `premium_required`).

### POST `v1/tenant/stylist/outfit` → 202 `JobDto`
```json
{ "requestId": "01J…", "date": "2026-11-18", "occasion": "dinner", "freeText": "akşam iş yemeği, yağmurlu",
  "onlyMyWardrobe": true, "pinnedItemId": null, "cityId": null, "latitude": null, "longitude": null }
```
Only `requestId` and `date` are required. `freeText` ≤ 200 chars. `pinnedItemId` = "Bununla kombin yap". `onlyMyWardrobe: false` allows missing-piece placeholders. A thin wardrobe never ends in a refusal: see **gap filling** in §9.
Errors: 403 · 409 `request_id_reused` · 422 `item_not_found` (pinned) · 400 `request_id_invalid`, `date_invalid`, `free_text_too_long`, `pinned_item_id_invalid`, `latitude_invalid`, `longitude_invalid`.
Result: `OutfitResult` (§9).

### POST `v1/tenant/stylist/suggestion/{jobId}/{index}/accept`
```json
{ "clientMutationId": "01J…", "lookId": null, "name": null, "planDate": "2026-11-18", "favorite": false }
```
→ 200 `{ "look": LookDto, "planDay": PlanDayDto | null }`. Creates the look (`source: "stylist"`, id = `lookId ?? clientMutationId`, name = `name ?? title`) and, with `planDate`, plans it ("Takvime ekle"). Without `planDate` it only saves to the lookbook (heart). Missing pieces that carry a `productId` become product slots; a picked library piece (`libraryItemId`) joins the look as the user's own item once it has been added to the wardrobe (`POST v1/tenant/item/from-library` — the app adds it before saving), otherwise it is left out. **Nothing is written before this call.**
Errors: 404 `job_not_found` / `suggestion_not_found` · 409 `job_not_completed` / `suggestion_stale` / `look_id_taken`.

### POST `v1/tenant/stylist/suggestion/{jobId}/{index}/dislike`
`{ "reason": "notMyStyle" }` → 204. The combination is sent to later stylist jobs as "avoid".

### POST `v1/tenant/stylist/week` → 202 `JobDto`
```json
{ "requestId": "01J…", "weekStart": "2026-11-16", "days": [{ "date": "2026-11-16", "occasion": "office" }], "onlyMyWardrobe": true }
```
Plans the 7 days from `weekStart`. `days` is optional; a day without an occasion takes the one already planned. Result: `WeekResult` (§9). 400 `week_start_invalid`, `days_invalid`.

### POST `v1/tenant/stylist/week/{jobId}/accept`
`{ "clientMutationId": "01J…", "dates": null }` (`dates` = subset to accept; null = every drafted day) → 200 `{ "days": PlanDayDto[] }` (each with its new look).

### Trips

`TripDto`
```json
{ "id": "01J…", "cityId": "paris", "cityName": "Paris", "startDate": "2027-03-01", "endDate": "2027-03-03",
  "tripTypes": ["business", "dinner"], "cabinOnly": true,
  "status": "upcoming", "archived": false, "archivedAt": null,
  "dayCount": 3, "itemCount": 5, "packedCount": 2, "everyPieceWornTwice": true,
  "missing": [{ "slot": "outerwear", "category": "outerwear", "reason": "rain", "productId": null }],
  "createdAt": "…", "updatedAt": "…", "version": 2 }
```
`archived` = archived by the user **or** already over. `packedCount / itemCount` = the preparation ring. Show "Her parça en az 2 kez giyiliyor" **only when `everyPieceWornTwice` is true** (never on a 1-day trip). `missing` = pieces the wardrobe cannot cover; since the gap filling each names a concrete pick when there is one — `libraryItemId` (ready library, "Önerilen · Kütüphane" → "Gardıroba ekle") or `productId` (shop, "Önerilen · Mağaza" → "Gör"); both null = nothing suitable to pick.

`TripDetailDto`
```json
{ "trip": TripDto,
  "items": [{ "itemId": "…", "plannedWears": 3, "packed": true, "packedAt": "…", "unavailable": false }],
  "days": [{ "date": "2027-03-01", "label": "Uçuş + akşam yemeği", "occasion": "dinner", "slots": [LookSlotDto], "weather": WeatherDto | null }],
  "forecast": { "status": "available", "days": [WeatherDto], "horizonEnd": "2027-03-04" } }
```
`days` = the accepted plan (empty until a packing draft is accepted). `forecast` = the daily forecast of **every** trip day, packed or not, from the provider's 16-day horizon (today included). `status`: `available` (all days known) · `partial` (some days; the rest is past the horizon or over) · `beyondRange` (the trip starts after `horizonEnd` → show a quiet "forecast not available yet") · `past` · `unavailable` (provider down, nothing cached → retry later) · `noLocation` (the city could not be resolved).

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `v1/tenant/trip` | — | `TripDto[]` (by start date, newest first) |
| GET | `v1/tenant/trip/{id}` | — | `TripDetailDto` · 404 |
| POST | `v1/tenant/trip` | `{ "id", "cityId", "cityName", "startDate", "endDate", "tripTypes", "cabinOnly" }` | 201 `TripDto` · 200 (same id again) · 400 · 422 `trip_city_not_found` · 503 `weather_unavailable` |
| PUT | `v1/tenant/trip/{id}` | same fields + `baseVersion` (no `id`) | `TripDto` · 404 · 409 (current) · 422 · 503 |
| DELETE | `v1/tenant/trip/{id}` | — | 204 · 404 |
| POST | `v1/tenant/trip/{id}/archive` | — | `TripDto` · 404 |
| DELETE | `v1/tenant/trip/{id}/archive` | — | `TripDto` (unarchived) · 404 |
| POST | `v1/tenant/trip/{id}/pack` | `{ "requestId": "01J…" }` | 202 `JobDto` (result `PackResult`, §9) · 403 · 404 `trip_not_found` · 409 |
| POST | `v1/tenant/trip/{id}/pack/{jobId}/accept` | `{ "clientMutationId": "01J…" }` | `TripDetailDto` · 404 · 409 `job_not_completed` / `suggestion_stale` |
| PUT | `v1/tenant/trip/{id}/item/{itemId}` | `{ "packed": true, "clientMutationId": "01J…", "occurredAt": "…" }` | `TripItemDto` · 404 |

`cityId` is the id of a `GET v1/weather/city` result (stored as sent). A trip sent with only `cityName` (typed city, older client) is geocoded on the server and stored with the first match's id and name; no match → 422 `trip_city_not_found`, geocoder down → 503 `weather_unavailable` (a trip is never stored without a location).
Trip 400 codes: `id_invalid`, `city_required` (neither `cityId` nor `cityName`), `city_id_invalid`, `city_name_too_long`, `start_date_invalid`, `end_date_invalid`, `date_range_invalid` (end before start, or longer than 21 days), `trip_types_invalid`.
Packing rules (enforced in the job and again at accept): only pieces of the wardrobe; one look per trip day built only from packed pieces; every packed piece is worn; on a multi-day trip pieces are **re-worn** — slot uses ≥ 1.5 × packed pieces (`everyPieceWornTwice` is true only when every piece really is worn at least twice).

**Trip capsule** (`CapsuleRules`, checked in the job; the model is given the same numbers): trip days take the trip types' occasions in turn (business → `office`, dinner → `dinner`, sightseeing → `travel`; e.g. 3 days business + dinner = office, dinner, office) and every day's look is for its occasion. Size: dressy occasions (office, dinner, wedding) get a fresh top each day up to 3 days, then one per 1.5 days; casual ones a top per 2 days; one bottom per 3 days of each dress level (dressy / casual); one pair of shoes per dress level (+1 from 6 days, max 2); one outer layer when a day is cold or wet — worn on those days — and one bag. A stylist list must stay within [what the wardrobe can supply − 2, target + 1] pieces, give days of different occasions different looks (when it packs more than one top) and wear the packed outer layer on every cold / wet day; otherwise the rule-built capsule is used. Example: 3 days business + dinner with one rainy day → 2 office tops + 1 dinner top + 1 bottom + 1 pair of shoes + 1 coat + 1 bag = **7 pieces**, bottom, shoes and bag worn all 3 days. A thin wardrobe falls back to the minimal list (every piece worn twice).
**Cabin-only limit**: a `cabinOnly` trip never packs more than `Packing:CabinMaxItems` pieces (default **12**; every piece counts once, shoes and bags included; `0` = not enforced). The stylist is asked for at most that many; a list that is only too long is trimmed by rule — every slot keeps its most-used piece, then the pieces used in the most looks stay, and the dropped pieces are replaced in their looks — and the result says so (`cabinLimit`, `cabinTrimmed`, `droppedItemIds`, §9). The limit is checked again at accept (the trip or the limit may have changed since the draft): a list above it is refused with 409 `suggestion_stale`. Ticking is idempotent and offline-safe: a late older event never overrides a newer mark. Pieces already ticked stay ticked when a new list is accepted.

---

## 7. E6 — "Üzerimde gör" (try-on)

One generated image = 1 credit. The credit is reserved when the job is queued, kept on success and **refunded automatically when the job fails** ("Şu an oluşturamadık. Kredin iade edildi."). The same outfit with the same body photo is never rendered or charged twice — an outfit is identified by its set of pieces, so a suggestion, the look saved from it and the same look on another day share one image.

**Path** (canvas 11, owner decision 4). The active **body photo** is always preferred. Without one, the **face path** renders
from the active **face photo** together with the body profile's `bodyType` (null counts as `unsure`), `heightCm` and `size`:
the image model is asked for the same adult, identity unchanged, fully clothed, in a neutral pose. The face path needs
`facePhotoTryOn` + `crossBorderTransfer` (C §2) and is cached like any try-on; its cache subject is the face photo **plus**
body type, height and size, so changing one of them makes a new image. `TryOnImageDto.source` = `body` | `face` — for
`face` the app says "Senin yüzün ve seçtiğin vücut tipiyle oluşturuldu" and offers "Daha gerçekçi sonuç için boy
fotoğrafı ekle". With neither photo: 422 `body_photo_required`.

**Photo check.** Before a photo's first render the worker checks it (vision model, no identification): body photo — exactly
one person, head to feet in frame; face photo — exactly one clearly visible face; both — not too dark, not blurry. A
rejected photo fails the job with `photoUnsuitable` (credit refunded), the job `result` is
`{ "photoIssue": "notFullBody" | "tooDark" | "multiplePeople" | "blurry" | "noFace", "photoKind": "body" | "face" }` and the
photo is **removed** (the app asks for another one with tips). A person who appears to be under 18 → `guardRejected`. A
photo that passed is not checked again.

### POST `v1/tenant/tryon`
```json
{ "requestId": "01J…", "target": { "kind": "look", "id": "01J…", "index": null } }
```
`target.id`: item id · look id · product id (catalog) · edit look id · for `suggestion` the **stylist job id** with `index` · for `tripDay` `"{tripId}/{yyyy-MM-dd}"` (the look of that trip day, `TripDetailDto.days[]`; its existing pieces are the outfit, so the same pieces as a look or suggestion share one cached image and one credit; an unknown trip or day → 404 `target_not_found`, a day whose pieces are all gone → 422 `tryon_target_empty`).
`editLook` ids: a weekly-edit look id (`EditDto.looks[].id`) renders its first price-band variant; `"{lookId}@{priceBand}"` (e.g. `edit-2026-w47-d1@luxuryTouch`) renders that variant; `"{collectionId}/{lookId}"` renders a creator / series collection look. Only published, non-retired content resolves. Product garments are rendered from the product's first catalog image.

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "status": "cached", "image": { "id", "url", "urlExpiresAt", "createdAt", "source" }, "job": null }` | Image already exists — no credit |
| 202 | `{ "status": "queued", "image": null, "job": JobDto }` | Job running (1 credit reserved, or an already running job for the same outfit — no second credit). Poll the job; its `result` is `{ "tryOnImageId": "…" }`, then `GET v1/tenant/tryon/{id}` |
| 402 | `credits_exhausted` | Open the credit-pack sheet; show the piece collage |
| 403 | `premium_required` | Paywall |
| 404 | `target_not_found` | Unknown target (also: someone else's look/item, retired product) |
| 422 | `body_photo_required` | Neither a body nor a face photo → the requirements sheet (body photo, or face photo + body type) |
| 403 | `consent_required` + `missing` | The consents of the path (body: `bodyPhotoAi` + `crossBorderTransfer`; face: `facePhotoTryOn` + `crossBorderTransfer`) |
| 422 | `tryon_target_empty` | Every piece of the look is gone |
| 409 | `request_id_reused` | |
| 400 | `request_id_invalid`, `target_required`, `target_kind_invalid`, `target_id_invalid`, `target_index_invalid` | |

Job failures: `sourceDeleted` (the body / face photo or a piece was deleted meanwhile — or a product has no downloadable image: not https, not an image, larger than `Catalog:MaxImageBytes`, or its host is not in `Catalog:ImageHosts` when that list is set), `photoUnsuitable` (photo check, see above), `providerError`, `guardRejected`. In every case the credit is refunded. A `suggestion` target also renders the library pieces the stylist picked (owned copy once added, else the library image).

| Method | Path | Response |
|---|---|---|
| GET | `v1/tenant/tryon?kind=&id=&index=` | `TryOnImageDto` for that target on the current path (body photo, or face photo + figure), generating nothing · 404 when there is none · 400 |
| GET | `v1/tenant/tryon/{id}` | `TryOnImageDto` (fresh presigned URL) · 404 (also for anyone but the owner) |

### Batch — the planned week (screen 07 → 07b)

1. **POST `v1/tenant/tryon/plan-week/quote`** `{ "weekStart": "2026-11-16" }` → 200, charges nothing
   ```json
   { "weekStart": "2026-11-16", "requiredCredits": 2, "cachedCount": 1, "remainingCredits": 12, "sufficient": true,
     "items": [{ "date": "2026-11-16", "lookId": "01J…", "cached": false, "tryOnImageId": null }] }
   ```
   Show "`requiredCredits` kredi harcanacak". Days without a look are not listed. 422 `body_photo_required`.
2. **POST `v1/tenant/tryon/plan-week`** `{ "requestId": "01J…", "weekStart": "2026-11-16", "expectedCredits": 2 }` → 202
   ```json
   { "chargedCredits": 2, "items": [{ "date": "2026-11-16", "lookId": "01J…", "status": "queued", "image": null, "job": JobDto }] }
   ```
   `expectedCredits` must be the number the user confirmed: 409 `credit_quote_changed` otherwise (re-quote). All or nothing: 402 `credits_exhausted` / 403 `premium_required` charge nothing.

---

## 8. E7 — Colour palette

### POST `v1/tenant/palette/analyze` `{ "requestId": "01J…" }`
| Status | Body |
|---|---|
| 202 | `{ "status": "queued", "palette": null, "job": JobDto }` — job result `{ "seasonTypeId": "warm-autumn", "lowConfidence": false }` |
| 200 | `{ "status": "cached", "palette": PaletteDto, "job": null }` — the current face photo was already analysed |
| 422 | `face_photo_required` (screen "PaletBos") |
| 403 | `premium_required` |

Job failures: `noFaceDetected` (no / several faces, or the photo is unsuitable → ask for a new photo), `guardRejected`, `providerError`, `sourceDeleted`. Palette analysis costs no image credit.

### GET `v1/tenant/palette` → `PaletteDto` · 404 `palette_not_found`
```json
{
  "seasonTypeId": "warm-autumn", "seasonName": "Sıcak Sonbahar",
  "flattering": [{ "id": "camel", "family": "brown", "hex": "#C19A6B", "name": "Camel" }],
  "avoid": [{ "id": "black", "family": "black", "hex": "#1C1A17", "name": "Siyah" }],
  "lowConfidence": false, "sourcePhotoActive": true, "analyzedAt": "…",
  "compatibility": { "percent": 67, "totalCount": 3, "compatibleCount": 1, "neutralCount": 1, "incompatibleCount": 1,
                     "unmatchedCount": 0, "neutralsCountAsCompatible": true }
}
```
`compatibility` is rule-based and computed on every read: a piece is judged by its main colour — in `avoid` → incompatible, in `flattering` → compatible, otherwise neutral. `percent = round(100 × (compatible + neutral) / total)`, so the percentage and the incompatible list always add up to the whole wardrobe; `percent` is null for an empty wardrobe. Both parts of the rule are config (`Palette`): `NeutralsCountAsCompatible` (default `true`, approved; `false` → `percent = compatible / total`) and `NeutralColorIds` (default empty = every colour outside the season's two lists is neutral; when set, a colour in none of the three lists is counted in `unmatchedCount`: in the total, neither compatible nor in the mismatch list). `lowConfidence: true` → suggest retaking the photo. `sourcePhotoActive: false` → the face photo was replaced since; offer a new analysis.

| Method | Path | Response |
|---|---|---|
| GET | `v1/tenant/palette/mismatch` | `{ "items": ItemDto[] }` ("Uyumsuz parçaları gör") · 404 `palette_not_found` |
| GET | `v1/tenant/palette/products?category=&priceBand=&sort=&pageToken=&limit=` | "Paletime uygun ürünler": `{ "items": [ProductDto], "pageToken", "count" }` — the catalog (same shape, filters and paging as `GET v1/catalog/product`) restricted to products that carry at least one of my `flattering` colours and whose main (first) colour is not in `avoid`. Rule based, no AI, no credit. · 404 `palette_not_found` · 400 for an unknown `category` / `priceBand` / `sort` |
| DELETE | `v1/tenant/palette` | 204 |

---

## 9. Job result shapes (`GET v1/tenant/job/{id}` → `result`)

All are **drafts**: nothing is in the wardrobe, lookbook, plan or trip until the matching accept/confirm endpoint is called.

**`itemProcess`** one piece: `{ "draftId": "…", "itemCount": 1, "needsReview": false, "flaggedFields": [] }` · several: `{ "draftId": "…", "groupId": "…", "itemCount": 5, "pieceDraftIds": ["…"] }` · **`itemClean`** `{ "draftId": "…" }` (background removal of a selected piece) · `itemSplit` (legacy) `{ "draftId": "…", "pieceDraftIds": ["…"] }` — then read `GET v1/tenant/item-draft`.

**`stylistOutfit`** — `OutfitResult`
```json
{ "date": "2026-11-18", "occasion": "dinner", "onlyMyWardrobe": true, "refusal": null, "language": "tr",
  "suggestions": [{
    "index": 0, "title": "Gece Laciverti", "explanation": "Lacivert üst, açık alt. Yağmura uygun.", "source": "model",
    "slots": [{ "slot": "top", "itemId": "01J…", "productId": null }],
    "missing": [{ "slot": "bagAccessory", "category": "bag", "reason": "suggested", "productId": null }]
  }] }
```
Up to 3 suggestions. `source: "rule"` = rule-based fallback: `title` and `explanation` are **null** — show the app's own neutral text. Piece names and images come from the client's own item cache by `itemId`. `refusal`: `out_of_scope` (`suggestions` empty); `insufficient_wardrobe` is **internal only** now (answered only when even the library and the catalog are empty).

**Gap filling** (owner decision 3, `GapFill`, deterministic): when the wardrobe cannot dress the day, dresses it only once or
twice, or has no shoes, Droblet picks the missing pieces itself and still returns complete outfits (a top + bottom or a
dress, shoes, and an outer layer when the weather asks). Picks come from the **ready library** first — per slot the best
in-season pieces by colour harmony with the user's pieces, palette (flattering / avoid) and occasion; the user's own outer
layer, shoes and bag are kept — and from the **catalog** only for a slot the library cannot fill (same harmony, the user's
budget band). The user's pieces stay in `slots`; every pick is in `missing` with `reason: "suggested"` and
`libraryItemId` (free → "Önerilen · Kütüphane", one tap "Gardıroba ekle") or `productId` ("Önerilen · Mağaza" → "Gör").
`slots` may then hold 0–1 pieces. This also happens with `onlyMyWardrobe: true` (week plans and trips always). The
result's `gapFilled: true` says some suggestion carries picks → the soft banner "Önerilerin bir kısmı senin gardırobundan
değil — eklemek ister misin?".

**`stylistWeek`** — `WeekResult`
```json
{ "weekStart": "2026-11-16", "refusal": null, "language": "tr",
  "days": [{ "date": "2026-11-16", "occasion": "office", "outfit": { "index": 0, "title": "…", "explanation": "…", "source": "model", "slots": [], "missing": [] } }],
  "gapFilled": false }
```
A day the wardrobe cannot dress is dressed with picks (gap filling, see `OutfitResult`); `outfit` is null only when nothing can be picked either.

**`stylistPack`** — `PackResult`
```json
{ "tripId": "01J…", "cabinOnly": true, "everyPieceWornTwice": true, "source": "model", "refusal": null, "language": "tr",
  "items": [{ "itemId": "…", "plannedWears": 2 }],
  "days": [{ "date": "2027-03-01", "label": "Uçuş + akşam yemeği", "occasion": "dinner", "slots": [{ "slot": "top", "itemId": "…", "productId": null }] }],
  "missing": [{ "slot": "outerwear", "category": "outerwear", "reason": "rain", "productId": null }],
  "cabinLimit": 12, "cabinTrimmed": false, "droppedItemIds": [], "gapFilled": false }
```
`missing[]`: `{ "slot", "category", "reason", "productId", "libraryItemId" }` — a generic placeholder (`noShoes`, `rain`,
`cold`) names a concrete library / shop pick when there is one. A wardrobe that cannot dress the trip is packed with picks:
they are listed in `missing` only (never in `items` or the day `slots`), `gapFilled: true`.
`cabinLimit` = the piece limit applied to this cabin-only trip (`null` for a normal trip or when the limit is 0). `cabinTrimmed: true` = pieces were left out to stay within it; `droppedItemIds` lists the pieces a rule removed from the stylist's list (empty when the shorter list was built from scratch by the rule-based fallback, `source: "rule"`).

**`tryOn`** `{ "tryOnImageId": "…" }` (failed with `photoUnsuitable`: `{ "photoIssue", "photoKind" }`) · **`palette`** `{ "seasonTypeId": "…", "lowConfidence": false }`

---

## 10. Profile counters and entitlement

| Method | Path | Response |
|---|---|---|
| GET | `v1/tenant/profile/stats` | Screen 28 counters of the signed-in account: `{ "itemCount": 42, "lookCount": 9, "tripCount": 2, "followerCount": 12, "followingCount": 30 }` |
| GET | `v1/tenant/entitlement` | Tier and AI credits, plus `"itemRecognition": { "limit": 10, "used": 3, "remaining": 7 }` — the AI garment recognition allowance (§3). `limit` / `remaining` are `null` for members (unlimited); `used` = completed + in progress. `limit: 0` = the feature is members-only. |

## 11. Not in this document

[store-social-settings.md](store-social-settings.md): catalog and shop, cart, watch list, affiliate checkout, weekly edit and content, feed / people / follow / rating / save / block / report, invite and share, settings, notifications and devices, analytics events, weather endpoints, the admin API, and `POST v1/tenant/catalog/complete` ("Parçamı tamamla"). Sign-in, profile photos, body and style profile, purchases and `GET v1/tenant/job/{id}` are foundation endpoints without a contract document. Every endpoint is listed in [README.md](README.md).
