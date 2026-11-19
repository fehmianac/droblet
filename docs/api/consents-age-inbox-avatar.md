# C — Consents, age confirmation, notification inbox, profile picture

Contract of the endpoints added for the legal gaps of [docs/legal/REVIEW.md §5](../legal/REVIEW.md) (G1–G5) and the
parity screens (Bildirimler, edit profile). Conventions as in [store-social-settings.md §1](store-social-settings.md):
camelCase JSON and enum strings, ProblemDetails with a stable snake_case `code`, instants UTC ISO-8601.

## 1. Consent types and versions

| `type` | Legal text (landing `/consents`) | Needed by |
|---|---|---|
| `bodyPhotoAi` | Consent 1 — full-body photo and "See it on me" | body photo upload / activation, every try-on |
| `facePhotoPalette` | Consent 2 — face photo and colour palette | face photo upload / activation, palette analysis |
| `weight` | Consent 3 — weight | saving a body profile **with** `weightKg` (weight stays optional) |
| `contacts` | Consent 4 — finding friends from contacts | contact salt and match |
| `marketingNotifications` | Consent 5 — marketing notifications | switching on `weeklyEdit` / `priceDrop`; sending either push |
| `crossBorderTransfer` | Consent 6 — transfers abroad | together with `bodyPhotoAi` / `facePhotoPalette` / `facePhotoTryOn` (OpenAI, US, processes the photos) |
| `facePhotoTryOn` | Consent 7 — face photo and "See it on me" (new purpose, lawyer to approve) | try-on on the **face path**: no body photo, the face photo + body type + height / size build the figure |

- **Versions** come from configuration, `Consents:Versions:{type}` (Api and Notifier `appsettings.json`, overridable from
  Parameter Store); the default is `2026-11-19`, the date of the current drafts. Publishing a new text = bumping its version:
  every consent given on an older version stops being **valid**, the guards answer `403 consent_required` again and the app
  shows the new text just in time.
- A consent is **valid** when it is granted **and** its `version` equals the current version.
- Records are per user (personal tenant): a current row per type plus an **append-only audit log** (`ConsentHistoryEntity`,
  one row per grant / withdrawal with time, version, locale and source). Both are removed with the account
  (`DELETE v1/auth/me`) and included in the data export ([verification-export.md §2](verification-export.md)).

## 2. Endpoints

| Method | Path | Body | Result / errors |
|---|---|---|---|
| GET | `v1/tenant/consents` | — | `ConsentsDto` — always all seven types (enum order; `facePhotoTryOn` last) |
| PUT | `v1/tenant/consents` | `{ "consents": [ { "type", "granted", "version" } ], "source": "tryon", "locale": "tr" }` | `ConsentsDto`. `409 consent_version_outdated` when a grant names a version that is not current (nothing is written). `400`: `consents_required` (1–12), `consent_type_invalid`, `consent_version_required` (on a grant), `consent_source_invalid` (snake_case ≤ 40), `language_unsupported`. |
| GET | `v1/tenant/consents/history` | — | `{ "items": [ { "type", "granted", "version", "at", "locale", "source" } ] }`, newest first |

```jsonc
// ConsentsDto
{ "consents": [
  { "type": "bodyPhotoAi", "granted": true, "version": "2026-11-19", "currentVersion": "2026-11-19", "valid": true,
    "grantedAt": "2026-11-19T08:00:00Z", "withdrawnAt": null, "locale": "tr", "source": "tryon" },
  { "type": "weight", "granted": false, "version": null, "currentVersion": "2026-11-19", "valid": false,
    "grantedAt": null, "withdrawnAt": null, "locale": null, "source": null }
  // … all seven
] }
```

- `locale` defaults to the profile language. `source` says where the decision was made (`tryon`, `body_photo`,
  `face_photo`, `palette`, `weight`, `contacts`, `marketing_card`, `settings`, `onboarding`, …; the server writes
  `photo_deleted` itself).
- A decision equal to the current state is a no-op (no audit row). "Not now" on a never-given consent is not recorded —
  **except** with `source: "onboarding"`: the all-in-one consent step (onboarding, and once for existing accounts) sends a
  decision for every purpose, and an unticked box there is recorded as declined (`granted: false`, `version` set). The app
  shows that step while any record still has `version: null`.
- `grantedAt` keeps the last grant after a withdrawal, so the settings list can show both dates.
- **Side effects of a withdrawal**: `marketingNotifications` → `weeklyEdit` and `priceDrop` off and both send lists
  cleared; `weight` → the stored weight is cleared. Withdrawing a photo consent does **not** delete the photo by itself —
  the app offers the existing delete endpoints.
- **Deleting a photo counts as withdrawing its consent** (legal text, "withdrawing your consent"):
  `DELETE v1/tenant/photo/body/{id}` → `bodyPhotoAi`, `DELETE v1/tenant/photo/face/{id}` → `facePhotoPalette` and
  `facePhotoTryOn` (the face-path try-on images go too), `DELETE v1/tenant/photo` → all three (source `photo_deleted`).

### Enforcement

A gated endpoint answers before its handler runs:

```jsonc
// 403
{ "status": 403, "title": "consent_required", "code": "consent_required", "missing": ["bodyPhotoAi", "crossBorderTransfer"] }
```

| Endpoint | Required |
|---|---|
| `POST v1/tenant/photo/upload-url` · `PUT v1/tenant/photo/{kind}` | body: `bodyPhotoAi` + `crossBorderTransfer`; face: `facePhotoPalette` + `crossBorderTransfer` |
| `POST v1/tenant/tryon` · `POST v1/tenant/tryon/plan-week` | the path the render takes now: active body photo → `bodyPhotoAi` + `crossBorderTransfer`; face photo only → `facePhotoTryOn` + `crossBorderTransfer`; no photo → `bodyPhotoAi` + `crossBorderTransfer` |
| `POST v1/tenant/palette/analyze` | `facePhotoPalette` + `crossBorderTransfer` |
| `POST v1/tenant/contacts/salt` · `POST v1/tenant/contacts/match` | `contacts` |
| `PUT v1/tenant/body-profile` with `weightKg` ≠ null | `weight` |
| `PUT v1/tenant/user/me/notifications` with `weeklyEdit` or `priceDrop` = true | `marketingNotifications` |

The Notifier checks `marketingNotifications` again at send time, so a switch stored before consents existed (or left on
after a text change) sends nothing. Existing accounts without records see the all-in-one consent step once on next app
open; a guard still answers `403` (and the app opens its just-in-time sheet) when a needed consent was declined.
`GET v1/tenant/tryon` (cached image lookup) and quotes are not gated.

## 3. Age confirmation (18+)

| Method | Path | Body | Result / errors |
|---|---|---|---|
| POST | `v1/auth/register` *(changed)* | `{ "name", "email", "password", "ageConfirmed": true }` | `ageConfirmed` must be `true` → else `400` with code `age_confirmation_required` on `ageConfirmed`. The confirmation time is stored. |
| POST | `v1/tenant/profile/age-confirmation` | — | `ProfileDto`. One-time confirmation after the first Apple / Google sign-in; idempotent (the first time is kept). |

`ProfileDto` (`GET/PUT v1/tenant/profile` and the other profile endpoints) gains `ageConfirmedAt` (null = not confirmed)
and `moderation` (null, or `{ "hidden": true, "reason" }` while a moderator hides the profile's public fields — [S §11](store-social-settings.md)).
The app routes an unconfirmed account to the confirmation screen before anything else.

## 4. Notification inbox

| Method | Path | Body | Result / errors |
|---|---|---|---|
| GET | `v1/tenant/notification?limit=&pageToken=` | — | `{ "items": [ … ], "pageToken": "…" \| null, "unreadCount": 3 }`. `limit` 1–100 (default 30). Newest first; `pageToken` is an opaque cursor (new events never shift the next page). |
| POST | `v1/tenant/notification/read` | `{ "ids": ["01J…"] }` or `{ "ids": null }` (= all) | `{ "unreadCount": 0 }`. Idempotent; unknown ids are ignored. `400 ids_out_of_range` (1–100), `id_invalid`. |

```jsonc
{ "id": "01JD…", "type": "follow_request", "createdAt": "2026-11-19T09:15:00Z", "readAt": null, "data": { "handle": "ayse" } }
```

- `type` / `data` are the push codes of [S §9](store-social-settings.md): `morning_outfit` (`day`), `weekly_edit`
  (`editId`), `friend_ratings` (`day`), `price_drop` (`productId`), `follow_request` (`handle`), `data_export_ready`
  (`exportId`; written by the data export worker, never pushed — [V §2](verification-export.md)), `content_removed`
  (`targetKind`, `targetId`?, `reason`; written when a moderator removes the owner's look / item / profile fields, never
  pushed — [S §11](store-social-settings.md); TR "Paylaşımın topluluk kurallarına aykırı bulunduğu için kaldırıldı.", EN
  "Your post was removed because it was found to go against our community guidelines."). Ids only — the app writes the
  sentence; an app that does not know a type drops the row.
- Filled by the Notifier from the same events it pushes, once per event, with or without a device. `weekly_edit` and
  `price_drop` only with a valid marketing consent (and the switch on); `follow_request` and `friend_ratings` even when
  their push is off.
- Kept **90 days** (DynamoDB TTL; reads skip rows past it). Removed with the account; the follow-request row a deleted
  account left in someone's inbox is removed by the cross-tenant cleanup.

## 5. Profile picture

| Method | Path | Body | Result / errors |
|---|---|---|---|
| POST | `v1/tenant/profile/avatar/upload-url` | `{ "contentType": "image/jpeg" \| "image/png" }` | `{ "uploadId", "url", "fields", "expiresAt", "maxBytes" }` — presigned POST (fields first, then `file`), max 1 MB. `400 content_type_unsupported`. |
| PUT | `v1/tenant/profile/avatar` | `{ "uploadId", "clientMutationId" }` (ULIDs) | `ProfileDto` with `avatarUrl` + `avatarUrlExpiresAt`. `404 upload_not_found`; `422 upload_missing`, `photo_too_large`, `unsupported_image`, `avatar_too_large` (longest side > `Photos:AvatarMaxDimension`, 1024 px). Idempotent by `clientMutationId`. |
| DELETE | `v1/tenant/profile/avatar` | — | `204` (idempotent) |

- **The server does not resample** (no imaging library in the Lambdas): the app resizes to 512 × 512 JPEG before upload;
  the server checks magic bytes, size and the header dimensions and strips EXIF / XMP (location, device).
- **Kept apart from the body / face photos**: own upload slots (a photo upload id is `upload_not_found` here and vice
  versa), own row and own S3 prefix `tenant/{id}/avatar/`. "Delete my photos" does not touch it; it goes with the account.
- Visibility: own `ProfileDto.avatarUrl`; `PersonProfileDto.avatarUrl` (`GET v1/tenant/people/{handle}`) only when the viewer
  may see the closet (`closetLocked` false) — followers by default (decision 7), everyone for a public closet. URLs are
  presigned for `Photos:AvatarReadUrlTtlSeconds` (1 hour).
