# Outfit import — "Kombinlerini içe aktar"

The user picks outfit photos from the gallery (mirror selfies, old outfit photos). Per photo the server finds the pieces,
matches them against the wardrobe, de-duplicates the same new piece across photos and proposes **one look per photo**.
The user reviews and approves in bulk. Nothing becomes an item or a look before the commit, and only the **new pieces the
user keeps** get the (image-model) background removal.

Conventions as in [W §1](wardrobe-looks-plan-stylist.md): camelCase JSON, enum strings camelCase, ProblemDetails with a
stable snake_case `code`, `Authorization: Bearer <accessToken>`.

## 1. Flow

```
POST v1/tenant/outfit-import {requestId, count}          → session + one presigned POST per photo
  S3 POST (per photo, in the background, retried per file)
  POST v1/tenant/outfit-import/{id}/photos/{n}/uploaded   → photo queued (outfit-import queue)
     worker: A detect → B match → C de-duplicate → D look draft (per photo)
GET  v1/tenant/outfit-import/{id}                         → progress + look drafts (poll; inbox row when ready)
POST v1/tenant/outfit-import/{id}/commit {looks:[…]}      → items + looks; cleanup jobs for kept new pieces
DELETE v1/tenant/outfit-import/{id}                       → discard
```

The app compresses on the device before uploading (long edge ~1600 px, JPEG, re-encoded so EXIF / location never leave
the phone); the worker strips metadata again (`ImageMetadataStripper`) before anything is stored under the tenant prefix.

**Why upload confirmations instead of S3 events.** The photo bucket has no notification configuration today, and adding
one means a bucket ↔ queue policy dependency on a retained bucket shared by every flow (an SQS policy for `s3.amazonaws.com`
plus a `NotificationConfiguration` that CloudFormation replaces as a whole). The existing upload flows (item drafts,
photos, avatar) already confirm from the app and HEAD the object; the import does the same, per photo, which also lets the
worker start on photo 1 while photo 30 is still uploading.

## 2. Limits and allowance

* **Photos per import** — a plan limit from configuration: `Entitlements:Free:OutfitImportMaxPhotos` and
  `Entitlements:Premium:OutfitImportMaxPhotos` (SSM `/droblet/{stage}/{api|worker}/Entitlements`, default **30** for both;
  editable in the admin panel → Settings → Üyelik sınırları). The server enforces the caller's plan; the value is returned
  as `maxPhotos` by `POST outfit-import` and as `outfitImport.maxPhotos` by `GET v1/tenant/entitlement`. The app's picker and
  copy ("en fazla N fotoğraf") follow it — no number in the app.
* **AI recognitions (non-members)** — the same rule as single / bulk add ([W §3](wardrobe-looks-plan-stylist.md)): each
  photo uses one recognition (`Entitlements:Free:ItemRecognitionLimit`), reserved when the session is created, **counted when
  its detection completes**, given back when the photo fails or the session is discarded (photos never uploaded are given
  back on commit). A request above what is left gets fewer slots (`skipped`); nothing left → `402
  item_recognition_limit_reached`; limit 0 → `403 premium_required`. Members: unlimited. Matched pieces, the match calls and
  the commit use no recognition.

## 3. Endpoints

### POST `v1/tenant/outfit-import`

```json
{ "requestId": "01JD…(ULID)", "count": 12 }
```

`201` (new) / `200` (same requestId again — fresh slots for the photos not uploaded yet; presigned forms live
`OutfitImport:UploadUrlTtlSeconds`, default 15 min):

```json
{
  "session": { …OutfitImport (below)… },
  "uploads": [ { "index": 1, "url": "https://…s3…", "fields": { "key": "uploads/import/{tenant}/{session}/1", "Content-Type": "image/jpeg", … }, "expiresAt": "…", "maxBytes": 10485760 } ],
  "skipped": 0,
  "maxPhotos": 30,
  "itemRecognition": { "limit": 10, "used": 3, "remaining": 7 }
}
```

Errors: `400` (`request_id_invalid`, `count_out_of_range`: outside 1–100), `422 outfit_import_too_many_photos` (above the
plan limit), `402 item_recognition_limit_reached`, `403 premium_required`.

### POST `v1/tenant/outfit-import/{id}/photos/{index}/uploaded`

No body. The object must exist (`422 upload_missing`). Queues the photo once — a repeated call answers the session and
queues nothing. `404 outfit_import_not_found` / `outfit_import_photo_not_found`, `409 outfit_import_committed`. Answers the
session (`OutfitImport`).

### GET `v1/tenant/outfit-import/{id}` · GET `v1/tenant/outfit-import`

One session / the open (not committed, not expired) sessions, newest first — so the app can resume an import the user left.

```json
{
  "id": "01JD…",
  "status": "processing",               // uploading · processing · ready · failed · committed
  "count": 12, "requested": 12,
  "counters": { "uploaded": 12, "detected": 9, "matched": 7, "ready": 7, "failed": 1 },
  "photos": [
    {
      "index": 1, "status": "ready",      // pending · uploaded · detected · ready · failed
      "failure": null,                     // guardRejected (no piece found) · sourceDeleted · providerError
      "imageUrl": "https://…(the photo, presigned)",
      "lookId": "01JD…",                   // id of the look the commit creates
      "pieces": [
        { "ref": "1-1", "kind": "match", "itemId": "01J…", "pieceId": null, "name": "Siyah blazer", "category": "outerwear",
          "subcategory": "blazer", "colorIds": ["black"], "slot": "outerwear", "imageUrl": "…(the wardrobe item)", "matchConfidence": 0.92, "alsoIn": [] },
        { "ref": "1-2", "kind": "new", "itemId": null, "pieceId": "01J…", "name": "Beyaz gömlek", "category": "top",
          "subcategory": "shirt", "colorIds": ["white"], "slot": "top", "imageUrl": "…(the crop)", "matchConfidence": null, "alsoIn": [4, 7] }
      ]
    }
  ],
  "newPieceCount": 14, "matchedPieceCount": 9,
  "createdAt": "…", "expiresAt": "…(createdAt + 7 days)", "imageUrlExpiresAt": "…",
  "result": null                           // the commit result once committed
}
```

* `kind: "match"` = **"Gardırobunda var"** (an existing item). `kind: "new"` = **"Yeni"**: `pieceId` is the same in every
  photo that shows that piece (`alsoIn` lists the others) — it is created **once**, and its id becomes the item id.
* `slot` = the piece's place in the look (one piece per slot; a dress takes `top` and closes `bottom`). `null` = an extra
  piece (a second bag, a ring next to a watch): saved as an item when kept, not part of the look.
* Polling: the counters change as photos finish; when every uploaded photo is done an inbox row `outfit_import_ready`
  (`data: { sessionId, lookCount }`) is written ([C](consents-age-inbox-avatar.md) inbox; no push — on-demand push is not
  wired outside the Notifier). The session stays available until `expiresAt`.

### POST `v1/tenant/outfit-import/{id}/commit`

```json
{ "looks": [ { "photoIndex": 2, "keep": false },
             { "photoIndex": 3, "keep": true, "pieces": [ { "ref": "3-4", "keep": false } ] } ] }
```

A photo or piece **left out is kept** — `{ "looks": [] }` approves everything ("Tümünü onayla"). Only `ready` photos give
looks; failed and never-uploaded photos are dropped.

1. Every new piece kept in at least one kept look becomes a wardrobe item through the normal item creation (entitlement
   check, receipt per piece `oi-{session}-{pieceId}`, the same validation; image = the crop until cleaned).
2. One `itemClean` job per **created** item (background removal; the cleaned image replaces the crop on the item, the
   crop stays as "Orijinale dön"). Matched pieces and dropped pieces cost nothing.
3. One look per kept photo: its kept pieces that exist as items, one per slot, `source: "import"`, the photo as its cover
   (`LookDto.coverImageUrl`). Fewer than two pieces → that look is skipped (`look_min_pieces`); the items stay.

`200`:

```json
{
  "looks": [ { "photoIndex": 1, "outcome": "created", "code": null, "lookId": "01JD…" },
             { "photoIndex": 2, "outcome": "skipped", "code": "not_kept", "lookId": null } ],
  "items": [ { "pieceId": "01J…", "outcome": "created", "code": null, "itemId": "01J…" } ],
  "createdLookCount": 5, "createdItemCount": 9, "cleanupJobCount": 9
}
```

`409 outfit_import_not_ready` while photos are still processed (or none is ready); `422 outfit_import_unknown_ref` for a
ref / photo that is not in the session. A committed session answers its stored result (idempotent replay). After the
commit only what the new items and looks use is kept (their crops and covers); the rest of the session's images and the
originals are deleted.

### DELETE `v1/tenant/outfit-import/{id}`

`204`. The session, its photos and pieces go; recognitions of photos not processed yet are given back. Before a commit all
of the session's images go; after it only the originals (crops / covers in use stay with the items and looks). `404`.

## 4. Processing (worker `droblet-{stage}-outfit-import`)

Queue `droblet-{stage}-outfit-import-request` (+ DLQ, maxReceiveCount 3, alarm `…-outfit-import-dlq`), SQS
`MaximumConcurrency` = template parameter `OutfitImportMaxConcurrency` (default 3). One message per photo; every stage
writes the photo row with a version check, so a duplicate delivery never runs a stage twice (idempotent per session +
photo index).

| Stage | What | Model calls |
|---|---|---|
| A detect | EXIF-stripped copy under `tenant/{id}/import/{session}/{n}.jpg`; the multi-item detection (`item_detection`; `Ai:FastTextModel` when set and `OutfitImport:UseFastTextModel`); each piece cropped (`…/{n}-{k}.jpg`) | 1 vision |
| B match | per piece: shortlist by category, sub-type and colours (`OutfitImportRules.Shortlist`), then one call comparing the crop with up to K (`OutfitImport:MatchCandidates`, 6) thumbnails (`item_match`) → item or new | 0–1 per piece (0 when nothing in the wardrobe / session is similar) |
| C de-duplicate | the shortlist also holds the session's new pieces from earlier photos, so the same call decides "same piece as photo 3"; B + C run one photo at a time per session (match lease) | — (part of B) |
| D look draft | one piece per slot (`OutfitImportRules.AssignSlots`) | — |

**Fairness and limits.** At most `OutfitImport:MaxInFlightPerTenant` (3) photos of one tenant are processed at once
(DynamoDB lease row `tenant#{id}#outfitimportlease / inflight`, expired leases do not count); a photo over the cap goes back
on the queue with a delay (`BusyDelaySeconds`), so one user's 30 photos never take every worker. OpenAI `429` (rate limit)
→ the photo is re-sent with an exponential delay (`BackoffBaseSeconds` × 2ⁿ up to `MaxBackoffSeconds`, at most
`MaxBackoffs` times); a billing 429 (`insufficient_quota` …) fails the photo at once and gives its recognition back.

**Observability.** Stage timings per photo (`stage_detect`, `stage_match`, `crop`, `ai.item_detection`,
`ai.item_match`, `db`, `s3_get`, `s3_put`, `queue_wait`, `busy_tenant`, `busy_session`, `backoff_429`, `match_calls`) go
to the structured "Job timings" log line and EMF (`Droblet/Ai`, job kind `OutfitImport`), and onto the photo row.

## 5. Cost per photo

| Call | Count |
|---|---|
| detection (vision, high detail) | 1 |
| match (vision; crop + ≤6 thumbnails at ≤512 px) | 0 … pieces with a similar candidate (typically 0 for a new user, 2–4 later) |
| background removal (image model) | 0 at import; 1 per **new piece kept**, at commit |

## 6. Lifecycle and privacy

* Originals `uploads/import/{tenant}/{session}/{n}` expire after **7 days** (bucket rule `expire-outfit-import-uploads`) and
  are deleted on commit / discard. Sessions, photos and pieces carry a 7-day TTL.
* Account deletion: the four partitions are in `DeletionPlan.TenantScopedEntityTypes`; `uploads/import/{tenant}/` is in
  `DeletionPlan.AccountS3Prefixes`; the worker output sits under `tenant/{id}/`.
* Data export: committed looks and items are exported as today; sessions are working state and are not exported.
* Image keys and URLs are never logged; no person is described (the prompts forbid it).
