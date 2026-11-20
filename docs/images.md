# Images: what is public, what is private, and how they are served

Status: built 2026-11-20 (branch `feat/public-item-images`). Owner decisions: only the **cleaned piece images** become
public; **one bucket** (the existing photo bucket) holds public and private images; the CDN hostname is
**`cdn.alatech.co`** for both stages (configuration, can change); the migration runs from the admin panel.

## 1. Why

Wardrobe piece images used to be presigned S3 GETs valid for 5 minutes. The signature changed on every list fetch, so
the app's image cache (expo-image, keyed by URL) missed every time, cached lists broke after 5 minutes, and every tile
downloaded the full-size image. Slow, and needless S3 GET / egress cost.

## 2. Public vs private

| Image | Where | How it is served |
|---|---|---|
| Cleaned piece image (AI background removal, no person) — full, 768 px, 256 px | `public/{stage}/items/{tenantHash}/{itemId}-{version}-{full\|768\|256}.webp` (copy) + `tenant/{id}/items/{draftId}.webp`, `…-768.webp`, `…-256.webp` (private source) | **Public** via Cloudflare `https://cdn.alatech.co/<key>`, `Cache-Control: public, max-age=86400` |
| Original piece photo (EXIF stripped), multi-item crops, outfit-import crops | `tenant/{id}/items/…-original.*`, `tenant/{id}/import/…` | Private, presigned GET (1 h) |
| Look cover photos (outfit-import originals) | `tenant/{id}/import/…` | Private, presigned GET (1 h) |
| Body / face photos | `tenant/{id}/body/`, `tenant/{id}/face/` | Private, presigned GET (1 h) |
| Try-on images | `tenant/{id}/tryon/` | Private, presigned GET (1 h) |
| Avatar | `tenant/{id}/avatar/` | Unchanged: private, presigned GET (`AvatarReadUrlTtlSeconds`, 1 h) |
| Draft images (before confirm) | `tenant/{id}/items/` | Private: a draft is never published |
| Data export ZIPs, uploads | `exports/`, `uploads/` | Private |
| Library / catalog images | catalog image bucket | Public (unchanged, `Wardrobe:PublicAssetBaseUrl`) |

A piece is published only while it has a cleaned image of its own and is **not** moderation-hidden. When the owner
chose "Orijinale dön", the owner's app shows the presigned original; other people still see only the cleaned image
(`IItemImageUrls.GetForOthersAsync` never returns the original).

## 3. Keys

`StorageKeys.PublicItemImage(tenantId, itemId, version, size)`:

- `stage` (`dev` / `prod`, from the Lambda's `STAGE`) comes first: `public/{stage}/items/…`, so one CDN hostname can route
  each stage to its own bucket by path (§10), and the bucket policy of each stage names only its own prefix.
- `tenantHash` = first 128 bits of SHA-256(`"droblet/public-items/" + tenantId`), hex. The tenant id never appears in a URL;
  account deletion recomputes the folder and deletes it.
- `version` = 128 random bits (`RandomNumberGenerator`) per publication. Keys cannot be guessed or enumerated
  (the bucket policy grants no `ListBucket`), and a replaced / republished image always gets a new key, so no cache can
  serve the old one.
- The item id is in clear (a ULID: it reveals the creation time only, and keeps a key traceable for support).

## 4. Storage design — one bucket (owner decision)

The photo bucket stays private except for **one** bucket-policy statement:

```yaml
- Sid: PublicItemImagesFromCloudflare
  Effect: Allow
  Principal: '*'
  Action: s3:GetObject
  Resource: !Sub '${PhotoBucket.Arn}/public/${Stage}/items/*'
  Condition: { IpAddress: { aws:SourceIp: [Cloudflare IPv4 ranges] } }
```

- `BlockPublicAcls` / `IgnorePublicAcls` stay on and `ObjectOwnership: BucketOwnerEnforced` (no ACL can ever open an
  object). `BlockPublicPolicy` / `RestrictPublicBuckets` had to be turned off, otherwise S3 ignores the statement.
- No `ListBucket` for anyone public. The HTTPS-only deny still covers the whole bucket.
- No private prefix can match: every private key starts with `tenant/`, `uploads/` or `exports/`.
  `TemplateConfigTests.PhotoBucket_PublicGrant_…` pins the statement (single public Allow, GetObject only, exactly
  `public/{stage}/items/*`, Cloudflare condition) and checks every private prefix `StorageKeys` builds lies outside it.
- Encryption (SSE-S3), CORS and the abort-multipart lifecycle rule apply to the public prefix as to the rest; no
  expiry rule names `public/`.
- IAM: the Api role may Put / Get / Delete / List `public/{stage}/items/*` (publish on confirm, presigned fallback, delete,
  account deletion); the item processor may Put / Delete there and Get its `tenant/*/items/*` copy source. No other role
  touches `public/`.

**Trade-off.** One bucket is simpler: one set of lifecycle / encryption / deletion code paths, server-side copies within
the bucket, one place for account deletion. The cost is a public statement on the bucket that also holds body and face
photos: a mistake in that statement, or a future private prefix created under `public/{stage}/items/`, would expose private data.
A separate bucket would have made such a mistake impossible by construction. Mitigations: the statement names only
`public/{stage}/items/*`, `StorageKeys` is the only key builder, and the template test fails the build when the grant widens or a
private prefix moves under `public/`. Anyone sending requests from Cloudflare IPs (e.g. a Cloudflare Worker) could reach
S3 directly, but still needs the unguessable key. Optional hardening: a Cloudflare transform rule adding a secret
`Referer` header plus an `aws:Referer` condition.

## 5. Write paths

| Where the cleaned image is written | Renditions | Publication |
|---|---|---|
| Item worker, single piece (`SingleAsync`) and selected multi-item piece (`CleanAsync`) | 256 / 768 px WebP next to the cleaned image (SkiaSharp, `SkiaImageThumbnailer`, no AI) | On **draft confirm** (`WardrobeService.ConfirmDraftAsync`): `IItemImagePublisher.PublishAsync` copies the cleaned image and its renditions to fresh public keys, stored on `ItemEntity.PublicImageKey/PublicMediumKey/PublicThumbKey`. A replayed or rejected create removes the copies. |
| Item worker, outfit-import piece (`CleanItemAsync`) | same | Published by the worker in the same versioned write that sets `ImageKey`; old public keys are deleted after the write. |
| Manual photo (no AI) | — | Nothing: there is no cleaned image, the original stays private. |

Publication is best effort: a failed copy (e.g. AccessDenied before the template is deployed) leaves the piece
unpublished; it keeps the presigned private image and `publish-item-images` publishes it later.

## 6. URLs for the app (`IItemImageUrls`)

`ItemDto`: `imageUrl` (full, viewer), `mediumUrl` (768, item detail), `thumbUrl` (256, lists / grids / tiles),
`imageUrlExpiresAt`, `imageCacheKey`.

1. Published, not hidden, original not chosen, `Photos:PublicUrlsEnabled` = true → public URLs on
   `Photos:PublicBaseUrl` (`https://cdn.alatech.co`), `imageUrlExpiresAt: null`.
2. Published but public URLs switched off (`api/Photos/PublicUrlsEnabled` false — the default until the Cloudflare
   record is live) → the **same public objects, presigned** (fallback; nothing breaks).
3. Not published / original chosen / hidden (owner) → the private image presigned for all three sizes.
4. Library / catalog piece → its public global image.

`imageCacheKey` = `item-{itemId}-{8 bytes of SHA-256(shown key)}`: the same between fetches and between the fallback and
the CDN, different when the image changes. The app uses it (with a size suffix) as expo-image `cacheKey` /
`recyclingKey`. Social closet / look pieces get the cleaned 768 px image; outfit-import match pieces the 256 px one.

Private images keep presigned URLs, now valid **1 hour** (`Photos:ReadUrlTtlSeconds` 300 → 3600). Justification: the
app caches them by a stable id-based key (`tryon:{id}`, `photo:{id}`, `look-cover:{lookId}`) and refreshes an expired
URL once on a load error everywhere, so a longer link mostly saves refetches; a presigned link is still a bearer token,
so it stays short (1 h, not days) and is never logged.

## 7. Deletion and moderation

- **Item delete**: cleaned image, renditions and original are deleted; public copies are deleted and purged.
- **Image replaced** (outfit-import cleanup): new public keys; the old public copies are deleted and purged.
- **Draft discard**: the cleaned image and its renditions go (drafts are never public).
- **Account deletion**: `DeletionPlan.AccountS3Prefixes` includes `public/{stage}/items/{tenantHash}/`; its keys are listed,
  the prefix is deleted, the URLs purged. An AccessDenied (template not deployed yet) is skipped: nothing can be there.
- **Moderation** (`contentRemoved`): hiding an item clears its public keys in the same versioned write and deletes +
  purges the objects, so the URL stops working for everyone; the owner keeps the presigned private image. **Restore**
  publishes a fresh copy under new keys.
- **CDN purge**: `CloudflareCdnCache` posts "purge files by URL" (≤ 30 per call) when SSM `api/Cloudflare/ZoneId` and
  `api/Cloudflare/ApiToken` are set (`CHANGE_ME` = skip). Without a token a deleted image may be served from an edge
  cache for at most `max-age=86400` (1 day); the S3 object itself is gone at once.

## 8. Migration — admin "Bakım" job `publish-item-images`

Existing pieces are migrated by a background job, started from the **admin panel** (Bakım › "Görselleri herkese açık
konuma taşı", permission `maintenance.manage`, super admin) or by the Ops command (same job). No AI; idempotent per
piece; allowed on dev and prod. Code: `src/Infrastructure/Services/Maintenance/PublishItemImages.cs`.

- **Run row** (`MaintenanceRunEntity`, global partition `maintenance#publish-item-images`): status (queued → running →
  completed / cancelled / failed, `cancelling` in between), counters (tenants, scanned, published, already public,
  skipped by reason, hidden, renditions made, failed + up to 100 failed pieces), who started it and when. A lock row
  (`active`, created conditionally with the run) allows **one active run at a time** (409 `maintenance_run_active`).
- **Batches**: the Api queues `{ maintenanceRunId, seq }` on the **item processor queue** (that worker has SkiaSharp).
  The worker processes ≤ `Maintenance:BatchSize` (200) pieces or `Maintenance:BatchSeconds` (60 s) — well inside its
  120 s timeout — merges the counters into the run with a version-checked write, advances the cursor (tenant id, item id;
  ordinal order — every tenant and every piece, paginated) and `seq`, and queues the next batch. A redelivered message
  (old `seq`) is a no-op; a crashed batch is replayed from the last cursor (pieces are idempotent; only that batch's
  counters can count twice). The last failed delivery marks the run `failed` and releases the lock.
- **Per piece** (`ItemImageMigrator`): skip with a reason when there is no cleaned image (`originalOnly` — manual photo,
  cleanup pending or failed; `libraryOrCatalog`; `noImage`; `notOwnCleaned`; `cleanedMissing`; `itemDeleted` on a retry)
  — these keep the presigned fallback; never publish moderation-hidden pieces (`hidden`); make missing 256 / 768 px
  renditions; publish when not published, a public copy is missing, or it was published before its renditions existed;
  store the keys with a versioned write (Version + 1, `UpdatedAt` = now, so other devices sync); delete replaced copies.
- **Dry run** counts only ("would publish / would make"). **Cancel** stops after the current batch. **Retry failed**
  starts a new run over the failed pieces of a run. Start / cancel / retry are audited (`maintenance.publish_item_images.*`).
- Single photos, multi-item pieces and outfit-import pieces are all covered: they all keep their cleaned image at
  `tenant/{id}/items/*.webp`.

Ops command (thin wrapper; the run appears in the admin panel, audited as `ops:github-actions`):

```bash
# dev (GitHub Actions)
gh workflow run ops-dev.yml --ref <branch> -f command=publish-item-images -f args="--dry-run --wait"
gh workflow run ops-dev.yml --ref <branch> -f command=publish-item-images -f args="--wait"
# prod (prod deploy keys, same tool): queue the run on the worker and wait for it
dotnet run --project tools/Ops -c Release -- publish-item-images --stage prod --dry-run --wait
dotnet run --project tools/Ops -c Release -- publish-item-images --stage prod --wait
# --inline runs the batches in the Ops process (same job code, no queue) — e.g. before the worker has the code
```

## 9. Deploy order (per stage: dev, then prod)

1. **Infra** (`template.yaml` via an infra tag from main → `deploy-infra.yml`):
   - photo bucket policy `PublicItemImagesFromCloudflare` on `public/${Stage}/items/*` and the relaxed policy-level
     public access block (ACLs stay blocked);
   - IAM: Api role Put / Get / Delete / List on `public/${Stage}/items/*`; item processor role Get on
     `tenant/*/items/*`, Put / Delete on `public/${Stage}/items/*`, `sqs:SendMessage` on its own queue;
   - item processor env `ITEM_PROCESS_REQUEST_QUEUE_URL`;
   - `api/Photos`: `ReadUrlTtlSeconds` 3600, `PublicBaseUrl` `https://cdn.alatech.co`;
   - deploy-infra creates `api/Photos/PublicUrlsEnabled` = `false`, `api/Cloudflare/ZoneId` and
     `api/Cloudflare/ApiToken` = `CHANGE_ME`.
2. **Lambdas** (`deploy-lambdas.yml`). Code deployed before the infra is safe: publication fails quietly (AccessDenied),
   everything stays presigned, and a maintenance run cannot re-queue its batches (start it after the infra).
3. **Admin panel** (`deploy-admin.yml`) for the Bakım page.
4. **Migration**: Bakım › dry run, then start (or the Ops command above). From now on new pieces are published on confirm.
5. **App** release (uses `thumbUrl` / `mediumUrl` / `imageCacheKey`; older apps keep working with `imageUrl`).
6. **Cloudflare** (§10). When `https://cdn.alatech.co/public/<stage>/items/…` serves an image, set
   `/droblet/<stage>/api/Photos/PublicUrlsEnabled` = `true` (until then the app keeps the presigned fallback). The Api
   reads SSM at cold start: CDN URLs appear as Lambdas recycle (redeploy to switch at once). Optional: the purge token.

## 10. Owner steps in Cloudflare (`cdn.alatech.co`, both stages)

One hostname serves both stages because the **stage is part of the object key**: the URL path equals the S3 key
(`/public/dev/items/…` lives in `droblet-dev-photos`, `/public/prod/items/…` in `droblet-prod-photos`), so two origin
rules pick the bucket by path — no URL rewrite needed.

1. **DNS**: `CNAME cdn` (zone `alatech.co`) → `droblet-prod-photos.s3.eu-central-1.amazonaws.com`, **Proxied** (orange
   cloud). The target only matters as the default; the origin rules below decide per path.
2. **Origin rules** (Rules → Origin Rules), one per stage:
   - *When* hostname equals `cdn.alatech.co` **and** URI path starts with `/public/prod/` → *Host header* override and
     *SNI* override = `droblet-prod-photos.s3.eu-central-1.amazonaws.com`, DNS record override = same host.
   - Same with `/public/dev/` → `droblet-dev-photos.s3.eu-central-1.amazonaws.com`.
   (Stack output `PhotoBucketOriginHost` prints each host.) S3's REST endpoint answers only to its own bucket host, so
   the Host header must be rewritten. If the plan lacks Host-header override, a small Cloudflare Worker on
   `cdn.alatech.co/public/*` that fetches `https://<bucket host><path>` by the same prefix does the same.
3. **SSL/TLS**: *Full (strict)* (S3 presents a valid certificate for the bucket host; the bucket denies plain HTTP).
4. **Cache rule** for `cdn.alatech.co/public/*`: eligible for cache, *Edge TTL: respect origin* (`max-age=86400`),
   browser TTL respect origin, ignore query string. Allow `GET` / `HEAD` only. Optionally block every other path
   (S3 answers 403 there anyway).
5. **Optional purge token**: My Profile → API Tokens → Create → *Zone → Cache Purge → Purge* for `alatech.co` only.
   SSM `/droblet/<stage>/api/Cloudflare/ApiToken` and the zone id in `/droblet/<stage>/api/Cloudflare/ZoneId`.
6. Then switch `api/Photos/PublicUrlsEnabled` to `true` (§9.6). The domain stays configuration (`api/Photos`
   `PublicBaseUrl` in `template.yaml`) and can change later; keys do not depend on it.
7. If Cloudflare's IP list changes, update `template.yaml` (`PublicItemImagesFromCloudflare`) and `infra/landing.yaml`.

## 11. Legal

Privacy policy (TR + EN, "What other users can see" + "Security"): cleaned piece images are stored at unguessable public
addresses even for a private closet; originals, look covers, body / face photos and try-ons stay private. Marked for
the lawyer: `docs/legal/REVIEW.md` Q1c.
