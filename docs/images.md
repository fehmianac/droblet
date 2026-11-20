# Images: what is public, what is private, and how they are served

Status: built 2026-11-20 (branch `feat/public-item-images`). Owner decisions: only the **cleaned piece images** become
public; **one bucket** (the existing photo bucket) holds public and private images.

## 1. Why

Wardrobe piece images used to be presigned S3 GETs valid for 5 minutes. The signature changed on every list fetch, so
the app's image cache (expo-image, keyed by URL) missed every time, cached lists broke after 5 minutes, and every tile
downloaded the full-size image. Slow, and needless S3 GET / egress cost.

## 2. Public vs private

| Image | Where | How it is served |
|---|---|---|
| Cleaned piece image (AI background removal, no person) — full, 768 px, 256 px | `public/items/{tenantHash}/{itemId}-{version}-{full\|768\|256}.webp` (copy) + `tenant/{id}/items/{draftId}.webp`, `…-768.webp`, `…-256.webp` (private source) | **Public** via Cloudflare `https://cdn.droblet.alatech.co/<key>`, `Cache-Control: public, max-age=86400` |
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
  Resource: !Sub '${PhotoBucket.Arn}/public/items/*'
  Condition: { IpAddress: { aws:SourceIp: [Cloudflare IPv4 ranges] } }
```

- `BlockPublicAcls` / `IgnorePublicAcls` stay on and `ObjectOwnership: BucketOwnerEnforced` (no ACL can ever open an
  object). `BlockPublicPolicy` / `RestrictPublicBuckets` had to be turned off, otherwise S3 ignores the statement.
- No `ListBucket` for anyone public. The HTTPS-only deny still covers the whole bucket.
- No private prefix can match: every private key starts with `tenant/`, `uploads/` or `exports/`.
  `TemplateConfigTests.PhotoBucket_PublicGrant_…` pins the statement (single public Allow, GetObject only, exactly
  `public/items/*`, Cloudflare condition) and checks every private prefix `StorageKeys` builds lies outside it.
- Encryption (SSE-S3), CORS and the abort-multipart lifecycle rule apply to the public prefix as to the rest; no
  expiry rule names `public/`.
- IAM: the Api role may Put / Get / Delete / List `public/items/*` (publish on confirm, presigned fallback, delete,
  account deletion); the item processor may Put / Delete there and Get its `tenant/*/items/*` copy source. No other role
  touches `public/`.

**Trade-off.** One bucket is simpler: one set of lifecycle / encryption / deletion code paths, server-side copies within
the bucket, one place for account deletion. The cost is a public statement on the bucket that also holds body and face
photos: a mistake in that statement, or a future private prefix created under `public/items/`, would expose private data.
A separate bucket would have made such a mistake impossible by construction. Mitigations: the statement names only
`public/items/*`, `StorageKeys` is the only key builder, and the template test fails the build when the grant widens or a
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

1. Published, not hidden, original not chosen, `Photos:PublicBaseUrl` set → public URLs, `imageUrlExpiresAt: null`.
2. Published but `Photos:PublicBaseUrl` not set (empty / `CHANGE_ME`) → the **same public objects, presigned** (fallback
   until the Cloudflare record exists — nothing breaks).
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
- **Account deletion**: `DeletionPlan.AccountS3Prefixes` includes `public/items/{tenantHash}/`; its keys are listed,
  the prefix is deleted, the URLs purged. An AccessDenied (template not deployed yet) is skipped: nothing can be there.
- **Moderation** (`contentRemoved`): hiding an item clears its public keys in the same versioned write and deletes +
  purges the objects, so the URL stops working for everyone; the owner keeps the presigned private image. **Restore**
  publishes a fresh copy under new keys.
- **CDN purge**: `CloudflareCdnCache` posts "purge files by URL" (≤ 30 per call) when SSM `api/Cloudflare/ZoneId` and
  `api/Cloudflare/ApiToken` are set (`CHANGE_ME` = skip). Without a token a deleted image may be served from an edge
  cache for at most `max-age=86400` (1 day); the S3 object itself is gone at once.

## 8. Migration — `publish-item-images`

No AI call; idempotent; resumable; allowed on dev and prod (`tools/Ops/Commands/PublishItemImagesCommand.cs`).

- Scans **every** tenant (paginated) and every piece — single photos, multi-item pieces and outfit-import pieces all keep
  their cleaned image at `tenant/{id}/items/*.webp`.
- Makes missing 256 / 768 px renditions (SkiaSharp, same as the worker), publishes when the piece is not published, a
  public copy is missing, or it was published before its renditions existed; stores the keys with a versioned write
  (Version + 1, `UpdatedAt` = now, so other devices sync); deletes replaced copies.
- Never publishes moderation-hidden pieces.
- Reports: tenants, items scanned, published, already public, skipped (with reasons: library / catalog piece, no cleaned
  image — manual photo / cleanup pending or failed, key outside the tenant's folder, cleaned image missing in S3; these
  keep the presigned fallback), hidden, renditions made, failed. Exit code 1 when anything failed.
- `--dry-run` only counts. A checkpoint line is printed after each tenant; `--after-tenant <id>` resumes after it (a
  re-run from the start is also safe, only slower).

```bash
# dev
gh workflow run ops-dev.yml --ref <branch> -f command=publish-item-images -f args="--dry-run"
gh workflow run ops-dev.yml --ref <branch> -f command=publish-item-images
# prod (deploy keys of prod, same tool)
dotnet run --project tools/Ops -c Release -- publish-item-images --stage prod --dry-run
dotnet run --project tools/Ops -c Release -- publish-item-images --stage prod
```

## 9. Deploy order (per stage)

1. **Infra** (`template.yaml` via an infra tag from main → `deploy-infra.yml`): bucket policy + public access block, IAM
   for `public/items/*`, `ReadUrlTtlSeconds` 3600, new SSM parameters `api/Photos/PublicBaseUrl`,
   `api/Cloudflare/ZoneId`, `api/Cloudflare/ApiToken` (created as `CHANGE_ME`).
2. **Lambdas** (`deploy-lambdas.yml`). Code deployed before the infra is safe: publication fails quietly
   (AccessDenied) and everything stays presigned.
3. **Migration** `publish-item-images` (dry run first). From now on new pieces are published on confirm.
4. **App** release (uses `thumbUrl` / `mediumUrl` / `imageCacheKey`; older apps keep working with `imageUrl`).
5. **Cloudflare** (§10), then set `api/Photos/PublicBaseUrl` = `https://cdn.droblet.alatech.co`. The Api reads SSM at
   cold start: new URLs appear as Lambdas recycle (or redeploy to switch at once). Optional: the purge token.

## 10. Owner steps in Cloudflare

1. **DNS**: `CNAME cdn` → `droblet-<stage>-photos.s3.eu-central-1.amazonaws.com` (stack output `PhotoBucketOriginHost`),
   **Proxied** (orange cloud). Prod and dev need separate hostnames (e.g. `cdn` for prod, `cdn-dev` for dev).
2. **Origin rule** (Rules → Origin Rules) for `cdn.droblet.alatech.co`: *Host header* override and *SNI* override →
   `droblet-<stage>-photos.s3.eu-central-1.amazonaws.com`. The bucket is not a website bucket; the S3 REST endpoint
   answers only to its own host name. If the plan does not offer the Host-header override, use a tiny Cloudflare Worker
   on the route that fetches `https://<bucket host>/<path>` instead.
3. **SSL/TLS**: *Full (strict)* (S3 presents a valid certificate for the bucket host; the bucket denies plain HTTP).
4. **Cache rule** for `cdn.droblet.alatech.co/public/items/*`: eligible for cache, *Edge TTL: respect origin*
   (`max-age=86400`), browser TTL respect origin, cache key without query string. Allow only `GET`/`HEAD`.
   Optionally block every path not under `/public/items/` (S3 answers 403 there anyway).
5. **Optional purge token**: My Profile → API Tokens → Create → *Zone → Cache Purge → Purge* for `alatech.co` only.
   Put it in SSM `/droblet/<stage>/api/Cloudflare/ApiToken` and the zone id in `/droblet/<stage>/api/Cloudflare/ZoneId`.
6. If Cloudflare's IP list changes, update `template.yaml` (`PublicItemImagesFromCloudflare`) and `infra/landing.yaml`.

## 11. Legal

Privacy policy (TR + EN, "What other users can see" + "Security"): cleaned piece images are stored at unguessable public
addresses even for a private closet; originals, look covers, body / face photos and try-ons stay private. Marked for
the lawyer: `docs/legal/REVIEW.md` Q1c.
