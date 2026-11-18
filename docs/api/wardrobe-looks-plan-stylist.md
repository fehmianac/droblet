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
| `ItemSource` | `photo`, `library`, `purchase` |
| `ItemListingStatus` | `none` (phase 1 always), `forSale`, `forRent`, `sold`, `rented` (reserved for phase 2) |
| `ItemDraftStatus` | `uploaded`, `processing`, `ready`, `failed` |
| `ItemDraftKind` | `single`, `outfit` (source photo of a split), `piece` (cut out of an outfit photo) |
| `ItemCreateOutcome` | `created`, `alreadyApplied`, `rejected` |
| `OutfitSlot` | `top`, `bottom`, `outerwear`, `shoes`, `bagAccessory` |
| `Occasion` | `office`, `dinner`, `weekend`, `wedding`, `travel`, `sport` |
| `LookSource` | `user`, `stylist`, `edit`, `builder` (`stylist` is set only by the accept endpoints) |
| `TripType` | `business`, `dinner`, `sightseeing` |
| `TripStatus` | `upcoming`, `active`, `past` |
| `WeatherCondition` | `clear`, `partlyCloudy`, `cloudy`, `fog`, `drizzle`, `rain`, `snow`, `showers`, `thunderstorm`, `unknown` (one enum for the whole API — same as `GET v1/weather`) |
| `DislikeReason` | `notMyStyle`, `wrongOccasion`, `wrongWeather`, `colorMismatch`, `wornTooOften`, `other` |
| `MissingPieceReason` | `emptySlot`, `rain`, `cold`, `noShoes`, `suggested` |
| `TryOnTargetKind` | `item`, `look`, `product`, `editLook`, `suggestion` |
| `StartStatus` | `cached`, `queued` |

Colour ids, fabric ids and season type ids are fixed kebab-case strings; get them from `GET v1/tenant/reference/wardrobe`.

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
  "id": "01J…", "name": "Lacivert blazer", "category": "outerwear", "colorIds": ["navy"], "fabric": "wool",
  "seasons": ["autumn", "winter"], "size": "M", "brand": "Mango",
  "source": "photo", "productId": null, "libraryItemId": null,
  "imageUrl": "https://…", "imageUrlExpiresAt": "2026-11-18T09:05:00Z",
  "hasOriginalImage": true, "useOriginalImage": false,
  "wearCount": 3, "lastWornAt": "2026-11-17", "listingStatus": "none",
  "createdAt": "…", "updatedAt": "…", "version": 2
}
```
`colorIds[0]` is the main colour. `wearCount` / `lastWornAt` are server-computed from wear logs and cannot be written.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `v1/tenant/item` | — | `ItemDto[]`, newest first (filter/sort on device) |
| GET | `v1/tenant/item/{id}` | — | `{ "item": ItemDto, "looks": LookDto[] }` · 404 |
| PUT | `v1/tenant/item/{id}` | below | `ItemDto` · 400 · 404 · 409 (current `ItemDto`) |
| DELETE | `v1/tenant/item/{id}` | — | 204 · 404. Looks keep the slot and return it with `unavailable: true` |

PUT body (all user fields are replaced):
```json
{ "name": "Krem kazak", "category": "top", "colorIds": ["cream"], "fabric": "knit", "seasons": ["winter"], "size": "M", "brand": null, "useOriginalImage": false, "baseVersion": 1 }
```
Validation codes (400 `errors`): `category_required`, `color_required`, `color_unknown` (unknown id, duplicate, more than 5), `fabric_unknown`, `season_required` (**at least one season**), `base_version_invalid`. Limits: name 80, brand 60, size 12 chars. `useOriginalImage: true` = "Orijinale dön".

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
   **AI recognition allowance (non-members).** A non-member has a lifetime number of AI recognitions (`Entitlements:Free:ItemRecognitionLimit`, default 10; `GET v1/tenant/entitlement` → `itemRecognition`). Every photo of a single, bulk or split request uses one **when its job completes**; a job that fails (`providerError`, `guardRejected`, `sourceDeleted`, …) uses none. A bulk request above what is left processes the first photos and returns the rest in `skippedCount` / `skippedUploadIds` (those uploads are untouched). Nothing left → **402 `item_recognition_limit_reached`** (show the paywall); limit configured as 0 → **403 `premium_required`**. Members: unlimited (`limit` / `remaining` are `null`).
   **Manual entry.** `"manual": true` uses no AI and no allowance: each photo becomes a draft that is immediately `ready`, without suggestions and without a job (`jobId: null`); the user fills the form and confirms it as usual. Use it after a 402, or for the skipped uploads.
   One draft (id = `uploadId`) and one job per photo; with a single photo the job id is `requestId`. `splitOutfit: true` = "Kombin fotoğrafından parçaları ayır": each photo is an outfit, its pieces come back as separate drafts (`kind: "piece"`, `parentDraftId`), at most 6 per photo.
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
   `total` / `processed` = the progress card. `flaggedFields` ⊆ `category`, `colorIds`, `fabric`, `seasons` (low confidence or a value the server dropped). `needsReview: true` = "Kategoriyi kontrol et": show the checkbox **unticked**; "select all" must skip it. A `failed` draft still has the original photo and can be confirmed by filling the form by hand. Unconfirmed drafts expire after 7 days.

4. **POST `v1/tenant/item-draft/confirm`** (1–30 rows, each with the user's final values — the server never copies AI values on its own)
   ```json
   { "items": [{ "draftId": "01J…", "clientMutationId": "01J…", "reviewed": true, "name": "Lacivert blazer", "category": "outerwear",
       "colorIds": ["navy"], "fabric": "wool", "seasons": ["autumn", "winter"], "size": "M", "brand": "Mango", "useOriginalImage": false, "itemId": null }] }
   ```
   → 200
   ```json
   { "results": [{ "refId": "<draftId>", "outcome": "created", "code": null, "errors": null, "item": ItemDto }], "createdCount": 1 }
   ```
   The new item id is `itemId ?? clientMutationId`. Per-row `code` when `outcome: "rejected"`: `draft_not_found`, `draft_not_ready`, `draft_review_required` (flagged draft sent with `reviewed: false`), `draft_is_outfit_source`, `validation_failed` (+ `errors`: the item codes above), `item_id_taken`.
   400 (whole request): `items_out_of_range`, `draft_duplicate`, `client_mutation_id_duplicate`, `draft_id_invalid`, `client_mutation_id_invalid`.

5. **DELETE `v1/tenant/item-draft/{id}`** → 204 · 404. Deleting a draft that is still being processed is final: the worker never writes it back, removes the images it produced and ends the job as `failed` / `sourceDeleted` (no allowance used).

### Without a photo

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
`weather` comes from the weather provider (Open-Meteo, shared 60-minute cache): the coordinates when both are sent, otherwise the profile city (`cityId` from `GET v1/weather/city`). Temperatures are whole °C. It is **null** when neither is known, when the provider is unavailable and nothing is cached, or when `date` is outside the 7-day forecast. Trip days (`TripDetailDto.days[].weather`) follow the same rule with the trip's `cityId`. `plan`/`look` null = "Bugün için plan yok". `week` = 7 days starting at `date`. 400 `validation_failed` for a bad date.

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
Only `requestId` and `date` are required. `freeText` ≤ 200 chars. `pinnedItemId` = "Bununla kombin yap". `onlyMyWardrobe: false` allows missing-piece placeholders.
Errors: 403 · 409 `request_id_reused` · 422 `item_not_found` (pinned) · 400 `request_id_invalid`, `date_invalid`, `free_text_too_long`, `pinned_item_id_invalid`, `latitude_invalid`, `longitude_invalid`.
Result: `OutfitResult` (§9).

### POST `v1/tenant/stylist/suggestion/{jobId}/{index}/accept`
```json
{ "clientMutationId": "01J…", "lookId": null, "name": null, "planDate": "2026-11-18", "favorite": false }
```
→ 200 `{ "look": LookDto, "planDay": PlanDayDto | null }`. Creates the look (`source: "stylist"`, id = `lookId ?? clientMutationId`, name = `name ?? title`) and, with `planDate`, plans it ("Takvime ekle"). Without `planDate` it only saves to the lookbook (heart). Missing pieces that carry a `productId` become product slots. **Nothing is written before this call.**
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
`archived` = archived by the user **or** already over. `packedCount / itemCount` = the preparation ring. Show "Her parça en az 2 kez giyiliyor" **only when `everyPieceWornTwice` is true** (never on a 1-day trip). `missing` = pieces the wardrobe cannot cover, as catalog slot placeholders (`productId` null until the catalog matches one → "Eksikleri tamamla").

`TripDetailDto`
```json
{ "trip": TripDto,
  "items": [{ "itemId": "…", "plannedWears": 3, "packed": true, "packedAt": "…", "unavailable": false }],
  "days": [{ "date": "2027-03-01", "label": "Uçuş + akşam yemeği", "occasion": "dinner", "slots": [LookSlotDto], "weather": WeatherDto | null }] }
```

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `v1/tenant/trip` | — | `TripDto[]` (by start date, newest first) |
| GET | `v1/tenant/trip/{id}` | — | `TripDetailDto` · 404 |
| POST | `v1/tenant/trip` | `{ "id", "cityId", "cityName", "startDate", "endDate", "tripTypes", "cabinOnly" }` | 201 `TripDto` · 200 (same id again) · 400 |
| PUT | `v1/tenant/trip/{id}` | same fields + `baseVersion` (no `id`) | `TripDto` · 404 · 409 (current) |
| DELETE | `v1/tenant/trip/{id}` | — | 204 · 404 |
| POST | `v1/tenant/trip/{id}/archive` | — | `TripDto` · 404 |
| DELETE | `v1/tenant/trip/{id}/archive` | — | `TripDto` (unarchived) · 404 |
| POST | `v1/tenant/trip/{id}/pack` | `{ "requestId": "01J…" }` | 202 `JobDto` (result `PackResult`, §9) · 403 · 404 `trip_not_found` · 409 |
| POST | `v1/tenant/trip/{id}/pack/{jobId}/accept` | `{ "clientMutationId": "01J…" }` | `TripDetailDto` · 404 · 409 `job_not_completed` / `suggestion_stale` |
| PUT | `v1/tenant/trip/{id}/item/{itemId}` | `{ "packed": true, "clientMutationId": "01J…", "occurredAt": "…" }` | `TripItemDto` · 404 |

Trip 400 codes: `id_invalid`, `city_id_invalid`, `city_name_too_long`, `start_date_invalid`, `end_date_invalid`, `date_range_invalid` (end before start, or longer than 21 days), `trip_types_invalid`.
Packing rules (enforced in the job and again at accept): only pieces of the wardrobe; one look per trip day built only from packed pieces; **every packed piece is worn at least twice** (on a 1-day trip: at least once).
**Cabin-only limit**: a `cabinOnly` trip never packs more than `Packing:CabinMaxItems` pieces (default **12**; every piece counts once, shoes and bags included; `0` = not enforced). The stylist is asked for at most that many; a list that is only too long is trimmed by rule — every slot keeps its most-used piece, then the pieces used in the most looks stay, and the dropped pieces are replaced in their looks — and the result says so (`cabinLimit`, `cabinTrimmed`, `droppedItemIds`, §9). The limit is checked again at accept (the trip or the limit may have changed since the draft): a list above it is refused with 409 `suggestion_stale`. Ticking is idempotent and offline-safe: a late older event never overrides a newer mark. Pieces already ticked stay ticked when a new list is accepted.

---

## 7. E6 — "Üzerimde gör" (try-on)

One generated image = 1 credit. The credit is reserved when the job is queued, kept on success and **refunded automatically when the job fails** ("Şu an oluşturamadık. Kredin iade edildi."). The same outfit with the same body photo is never rendered or charged twice — an outfit is identified by its set of pieces, so a suggestion, the look saved from it and the same look on another day share one image.

### POST `v1/tenant/tryon`
```json
{ "requestId": "01J…", "target": { "kind": "look", "id": "01J…", "index": null } }
```
`target.id`: item id · look id · product id (catalog) · edit look id · for `suggestion` the **stylist job id** with `index`.
`editLook` ids: a weekly-edit look id (`EditDto.looks[].id`) renders its first price-band variant; `"{lookId}@{priceBand}"` (e.g. `edit-2026-w47-d1@luxuryTouch`) renders that variant; `"{collectionId}/{lookId}"` renders a creator / series collection look. Only published, non-retired content resolves. Product garments are rendered from the product's first catalog image.

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "status": "cached", "image": { "id", "url", "urlExpiresAt", "createdAt" }, "job": null }` | Image already exists — no credit |
| 202 | `{ "status": "queued", "image": null, "job": JobDto }` | Job running (1 credit reserved, or an already running job for the same outfit — no second credit). Poll the job; its `result` is `{ "tryOnImageId": "…" }`, then `GET v1/tenant/tryon/{id}` |
| 402 | `credits_exhausted` | Open the credit-pack sheet; show the piece collage |
| 403 | `premium_required` | Paywall |
| 404 | `target_not_found` | Unknown target (also: someone else's look/item, retired product) |
| 422 | `body_photo_required` | No body photo → "Profil fotoğrafını tamamla" |
| 422 | `tryon_target_empty` | Every piece of the look is gone |
| 409 | `request_id_reused` | |
| 400 | `request_id_invalid`, `target_required`, `target_kind_invalid`, `target_id_invalid`, `target_index_invalid` | |

Job failures: `sourceDeleted` (body photo or a piece was deleted meanwhile — or a product has no downloadable image: not https, not an image, larger than `Catalog:MaxImageBytes`, or its host is not in `Catalog:ImageHosts` when that list is set), `providerError`, `guardRejected`. In every case the credit is refunded.

| Method | Path | Response |
|---|---|---|
| GET | `v1/tenant/tryon?kind=&id=&index=` | `TryOnImageDto` for that target with the current body photo, generating nothing · 404 when there is none · 400 |
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

**`itemProcess`** `{ "draftId": "…", "needsReview": false, "flaggedFields": [] }` · **`itemSplit`** `{ "draftId": "…", "pieceDraftIds": ["…"] }` — then read `GET v1/tenant/item-draft`.

**`stylistOutfit`** — `OutfitResult`
```json
{ "date": "2026-11-18", "occasion": "dinner", "onlyMyWardrobe": true, "refusal": null, "language": "tr",
  "suggestions": [{
    "index": 0, "title": "Gece Laciverti", "explanation": "Lacivert üst, açık alt. Yağmura uygun.", "source": "model",
    "slots": [{ "slot": "top", "itemId": "01J…", "productId": null }],
    "missing": [{ "slot": "bagAccessory", "category": "bag", "reason": "suggested", "productId": null }]
  }] }
```
Up to 3 suggestions. `source: "rule"` = rule-based fallback: `title` and `explanation` are **null** — show the app's own neutral text. Piece names and images come from the client's own item cache by `itemId`. `refusal`: `insufficient_wardrobe` (the wardrobe cannot dress the day → "ilk parçalarını ekle") or `out_of_scope`; `suggestions` is then empty. `missing` is always empty when `onlyMyWardrobe` is true.

**`stylistWeek`** — `WeekResult`
```json
{ "weekStart": "2026-11-16", "refusal": null, "language": "tr",
  "days": [{ "date": "2026-11-16", "occasion": "office", "outfit": { "index": 0, "title": "…", "explanation": "…", "source": "model", "slots": [], "missing": [] } }] }
```
`outfit` can be null for a day that could not be dressed.

**`stylistPack`** — `PackResult`
```json
{ "tripId": "01J…", "cabinOnly": true, "everyPieceWornTwice": true, "source": "model", "refusal": null, "language": "tr",
  "items": [{ "itemId": "…", "plannedWears": 2 }],
  "days": [{ "date": "2027-03-01", "label": "Uçuş + akşam yemeği", "occasion": "dinner", "slots": [{ "slot": "top", "itemId": "…", "productId": null }] }],
  "missing": [{ "slot": "outerwear", "category": "outerwear", "reason": "rain", "productId": null }],
  "cabinLimit": 12, "cabinTrimmed": false, "droppedItemIds": [] }
```
`cabinLimit` = the piece limit applied to this cabin-only trip (`null` for a normal trip or when the limit is 0). `cabinTrimmed: true` = pieces were left out to stay within it; `droppedItemIds` lists the pieces a rule removed from the stylist's list (empty when the shorter list was built from scratch by the rule-based fallback, `source: "rule"`).

**`tryOn`** `{ "tryOnImageId": "…" }` · **`palette`** `{ "seasonTypeId": "…", "lowConfidence": false }`

---

## 10. Profile counters and entitlement

| Method | Path | Response |
|---|---|---|
| GET | `v1/tenant/profile/stats` | Screen 28 counters of the signed-in account: `{ "itemCount": 42, "lookCount": 9, "tripCount": 2, "followerCount": 12, "followingCount": 30 }` |
| GET | `v1/tenant/entitlement` | Tier and AI credits, plus `"itemRecognition": { "limit": 10, "used": 3, "remaining": 7 }` — the AI garment recognition allowance (§3). `limit` / `remaining` are `null` for members (unlimited); `used` = completed + in progress. `limit: 0` = the feature is members-only. |

## 11. Not in this document

[store-social-settings.md](store-social-settings.md): catalog and shop, cart, watch list, affiliate checkout, weekly edit and content, feed / people / follow / rating / save / block / report, invite and share, settings, notifications and devices, analytics events, weather endpoints, the admin API, and `POST v1/tenant/catalog/complete` ("Parçamı tamamla"). Sign-in, profile photos, body and style profile, purchases and `GET v1/tenant/job/{id}` are foundation endpoints without a contract document. Every endpoint is listed in [README.md](README.md).
