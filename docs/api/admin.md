# Droblet API — Admin panel (`v1/admin/*`)

Contract of the admin panel at `https://droblet-admin.alatech.co` (owner decisions 1–5, README §13). The mobile app
never calls these routes. Content endpoints (brands, products, bulk, edits, collections, moderation, revenue, funnel)
keep the shapes of [store-social-settings.md §11](store-social-settings.md#11-admin-api-v1admin); only their
**authentication** changed (admin tokens, permission per route) — this document lists everything else.

## 1. Conventions

| Topic | Rule |
|---|---|
| Accounts | Admin users are **separate** from app accounts (own table rows, own password, own tokens). An app user is never an admin. |
| Auth | `Authorization: Bearer <adminAccessToken>`. Admin tokens are signed with a separate key (`AdminJwt:SecretKey`), issuer `droblet-admin`, audience `droblet-admin-panel`. A user (app) token on any admin route → `401`. An admin token on any app route → `401`. |
| Permission | Each route needs one permission (table §2). Signed in but missing it → `403` with `code: "forbidden"`. A disabled admin or a revoked session → `401`. |
| Rate limit | Every admin route: per admin (or per IP before sign-in) `AdminAuth:RequestsPerMinute` (default 600) → `429 too_many_requests`. Sign-in routes have tighter limits (§3). |
| CORS | `v1/admin/*` answers CORS only for `AdminAuth:AllowedOrigins` (`https://droblet-admin.alatech.co`; dev also `http://localhost:3000`). Other routes keep `Access-Control-Allow-Origin: *`. Bearer tokens only, no cookies → no CSRF surface. |
| Errors | ProblemDetails with a stable `code`; validation = `400 validation_failed` + `errors: { field: [code] }` (same as the app API). |
| Audit | Every admin **write** (any non-GET route, incl. sign-in events) appends an audit entry: who, action, target, before/after summary, IP, time. |
| Language | The panel sends `Accept-Language: tr|en`; e-mails (code, reset, invite) follow it. |

## 2. Roles and permissions (enforced on the server for every route)

| Permission | super_admin | content_editor | moderator | Routes |
|---|:-:|:-:|:-:|---|
| `dashboard.view` | ✓ | ✓ | ✓ | `GET v1/admin/dashboard` |
| `analytics.view` | ✓ | ✓ | | `GET v1/admin/report/revenue`, `GET v1/admin/report/funnel` |
| `catalog.manage` | ✓ | ✓ | | brands, products, `product/bulk` |
| `image.upload` | ✓ | ✓ | | `POST v1/admin/image/upload-url` |
| `content.manage` | ✓ | ✓ | | weekly edits, content collections + looks, ready-made library |
| `users.read` | ✓ | | ✓ | `GET v1/admin/user`, `GET v1/admin/user/{id}` |
| `users.suspend` | ✓ | | ✓ | `POST v1/admin/user/{id}/suspend`, `…/unsuspend` |
| `users.delete` | ✓ | | | `DELETE v1/admin/user/{id}` |
| `users.grant` | ✓ | | | test premium, add credits |
| `moderation.manage` | ✓ | | ✓ | `GET v1/admin/moderation/report`, `POST …/{id}/resolve`, `POST …/{id}/restore` |
| `settings.manage` | ✓ | | | `GET/PUT v1/admin/setting…` |
| `admins.manage` | ✓ | | | `v1/admin/admin-user…` |
| `audit.view` | ✓ | | | `GET v1/admin/audit` |

`GET v1/admin/auth/me` returns the caller's permissions; the panel hides what it cannot use, the server refuses it anyway.

## 3. Sign-in (`v1/admin/auth/*`)

Two steps: e-mail + password, then a 6-digit code sent by e-mail (SendGrid). Code: 10 min TTL, 5 wrong tries then
the challenge is gone, single use. Access token 15 min; refresh token 12 h, rotated on every refresh (reuse of a
rotated token revokes every session of that admin).

| Method | Path | Auth | Body | Result |
|---|---|---|---|---|
| POST | `v1/admin/auth/login` | anonymous | `{ "email", "password" }` | `200 { "challengeId", "expiresAt", "codeLength": 6 }` and the code is e-mailed. `503 email_unavailable` when the code e-mail cannot be sent. `401 invalid_credentials` (unknown e-mail, wrong password, disabled, no password set yet — all the same). `429 too_many_attempts` (per e-mail 10 / 15 min, per IP 50 / 15 min; the lockout counts every attempt, also correct ones). |
| POST | `v1/admin/auth/verify` | anonymous | `{ "challengeId", "code" }` | `200 AdminSession`. `401 invalid_code` (+ `attemptsLeft`), `401 challenge_expired` (unknown, expired, used, or 5 wrong tries), `429 too_many_attempts` (per IP). |
| POST | `v1/admin/auth/refresh` | anonymous | `{ "refreshToken" }` | `200 AdminSession`. `401 invalid_token`. |
| POST | `v1/admin/auth/logout` | admin | `{ "refreshToken"? }` | `204`. Deletes that refresh token. |
| POST | `v1/admin/auth/logout-all` | admin | — | `204`. Every session of the caller ends (refresh tokens and access tokens issued before now). |
| GET | `v1/admin/auth/me` | admin | — | `AdminMe` |
| PUT | `v1/admin/auth/password` | admin | `{ "currentPassword", "newPassword" }` | `204`; **every** session ends, this one included (sign in again). `400 validation_failed` (`password_too_short` < 10, `password_too_long` > 128, `password_too_weak`), `401 invalid_credentials`. |
| POST | `v1/admin/auth/password/forgot` | anonymous | `{ "email" }` | `202` always. If the admin exists, a link `https://droblet-admin.alatech.co/reset-password?token=…` (30 min, single use) is e-mailed. Also the **first set-password** path (§7). Per e-mail 3 / hour. |
| POST | `v1/admin/auth/password/reset` | anonymous | `{ "token", "newPassword" }` | `204`; every session of that admin ends. `400 invalid_token`, `400 validation_failed`. |

```jsonc
// AdminSession
{ "accessToken": "eyJ…", "accessTokenExpiresAt": "2026-11-19T10:15:00Z",
  "refreshToken": "…", "refreshTokenExpiresAt": "2026-11-19T22:00:00Z",
  "admin": AdminMe }

// AdminMe
{ "id": "01J…", "email": "owner@example.com", "name": "Owner", "role": "superAdmin",
  "permissions": ["dashboard.view", "analytics.view", "catalog.manage", "…"] }
```

Role values (JSON): `superAdmin`, `contentEditor`, `moderator`.

## 4. Admin users and audit (super admin)

| Method | Path | Body / query | Result |
|---|---|---|---|
| GET | `v1/admin/admin-user` | — | `AdminUserDto[]` (sorted by e-mail) |
| POST | `v1/admin/admin-user` | `{ "email", "name", "role" }` | `201 AdminUserDto`; an invitation e-mail with a set-password link (72 h) is sent. `409 email_taken` (case-insensitive). |
| PUT | `v1/admin/admin-user/{id}` | `{ "name", "role", "disabled" }` | `AdminUserDto`. `422 cannot_change_self` (own role / disable), `422 last_super_admin`, `404 not_found`. Disabling or a role change ends that admin's sessions. |
| POST | `v1/admin/admin-user/{id}/invite` | — | `202`; sends a new set-password link. |
| POST | `v1/admin/admin-user/{id}/revoke-sessions` | — | `204` |
| DELETE | `v1/admin/admin-user/{id}` | — | `204`. `422 cannot_change_self`, `422 last_super_admin`, `404 not_found`. |
| GET | `v1/admin/audit` | `adminId`, `action` (prefix), `targetType`, `pageToken`, `limit` (≤ 100, default 50) | `{ "items": [AuditEntryDto], "pageToken" }`, newest first. Filters apply within a page: a page can hold fewer items than `limit` while `pageToken` is not null. |

```jsonc
// AdminUserDto
{ "id": "01J…", "email": "editor@example.com", "name": "Editor", "role": "contentEditor", "disabled": false,
  "passwordSet": true, "lastLoginAt": "…"|null, "createdAt": "…", "updatedAt": "…" }

// AuditEntryDto — before/after are short JSON summaries of the changed record (never passwords, tokens or codes)
{ "id": "01J…", "at": "2026-11-19T09:00:00Z", "adminId": "01J…", "adminEmail": "owner@example.com",
  "action": "product.upsert", "targetType": "product", "targetId": "hs-white-shirt",
  "before": "{…}"|null, "after": "{…}"|null, "ip": "1.2.3.4"|null }
```

Actions: `auth.login`, `auth.login_failed`, `auth.logout`, `auth.logout_all`, `auth.password_changed`,
`auth.password_reset`, `admin.create`, `admin.update`, `admin.invite`, `admin.revoke_sessions`, `admin.delete`,
`brand.upsert`, `brand.retire`, `product.upsert`, `product.retire`, `product.bulk`, `image.upload_url`, `edit.upsert`,
`edit.retire`, `collection.upsert`, `collection.retire`, `collection_look.upsert`, `collection_look.retire`,
`library.upsert`, `library.retire`, `user.suspend`, `user.unsuspend`, `user.delete`, `user.test_premium_grant`,
`user.test_premium_revoke`, `user.credits_add`, `report.resolve`, `setting.update`.

## 5. Dashboard, users, library, images, settings

| Method | Path | Permission | Body / query | Result |
|---|---|---|---|---|
| GET | `v1/admin/dashboard` | `dashboard.view` | — | `DashboardDto` |
| GET | `v1/admin/user` | `users.read` | `q` (e-mail, `@handle` / handle, or part of the e-mail / name), `pageToken`, `limit` (≤ 100) | `{ "items": [AdminAppUserSummaryDto], "pageToken" }` — an exact e-mail or handle answers with that one user. |
| GET | `v1/admin/user/{id}` | `users.read` | — | `AdminAppUserDetailDto`. `404 not_found`. |
| POST | `v1/admin/user/{id}/suspend` | `users.suspend` | `{ "reason" (1–500) }` | `AdminAppUserDetailDto`. A suspended user cannot sign in or refresh (`403 account_suspended`); existing access tokens end within their 60 min life. |
| POST | `v1/admin/user/{id}/unsuspend` | `users.suspend` | — | `AdminAppUserDetailDto` |
| DELETE | `v1/admin/user/{id}` | `users.delete` | — | `204` (same deletion as "delete my account"). |
| PUT | `v1/admin/user/{id}/test-premium` | `users.grant` | `{ "days" (1–90), "note"? }` | `AdminAppUserDetailDto` — a **test** premium entitlement (source `admin`), replaces an earlier test grant. |
| DELETE | `v1/admin/user/{id}/test-premium` | `users.grant` | — | `AdminAppUserDetailDto` |
| POST | `v1/admin/user/{id}/credits` | `users.grant` | `{ "credits" (1–500), "note"? }` | `AdminAppUserDetailDto` — adds **test** pack credits. |
| GET | `v1/admin/library` | `content.manage` | — | `AdminLibraryItemDto[]` (retired included; until the first write the built-in seed is listed with `stored: false`) |
| PUT | `v1/admin/library/{id}` | `content.manage` | `{ "name": L, "category", "colorIds": [≥ 1], "fabric"?, "seasons": [≥ 1], "imageUrl"?, "sortOrder", "retired"? }` | `AdminLibraryItemDto`. Id `^lib-[a-z0-9-]{1,60}$`. Codes: `id_invalid`, `name_invalid`, `category_invalid`, `colors_invalid`, `fabric_invalid`, `seasons_invalid`, `image_url_invalid`. |
| DELETE | `v1/admin/library/{id}` | `content.manage` | — | `204` (retire). `404 not_found`. |
| POST | `v1/admin/image/upload-url` | `image.upload` | `{ "purpose": "product|brand|edit|collection|library", "contentType": "image/jpeg|image/png|image/webp" }` | `{ "url", "fields": {…}, "key", "publicUrl", "expiresAt", "maxBytes" }` — presigned POST to the public catalog image bucket (5 MB, 5 min). After the upload `publicUrl` is the https URL to store in `images[]` / `imageUrl`. |
| GET | `v1/admin/setting` | `settings.manage` | — | `SettingGroupDto[]` |
| PUT | `v1/admin/setting/{group}` | `settings.manage` | `{ "values": { "<field>": value } }` (only the listed fields; omitted = unchanged) | `SettingGroupDto`. `400 validation_failed` (`errors: { field: ["out_of_range"|"invalid"|"unknown_field"] }`), `404 not_found`, `503 settings_unavailable` (Parameter Store unreachable). Takes effect within 60 s (config reload). |
| GET | `v1/admin/report/revenue` | `analytics.view` | `from`, `to` | `RevenueReport` (+ `clicks`, `byDay`, `byNetwork`, see below) |
| GET | `v1/admin/report/funnel` | `analytics.view` | `from`, `to` | `FunnelReport` |

```jsonc
// DashboardDto
{ "users": { "total": 120, "last7Days": 14, "suspended": 1 },
  "catalog": { "brands": 12, "products": 340, "activeProducts": 320 },
  "content": { "edits": 4, "publishedEdits": 3, "collections": 6, "libraryItems": 40 },
  "moderation": { "openReports": 2 } }

// AdminAppUserSummaryDto
{ "id": "01J…", "tenantId": "01J…", "email": "a@b.c"|null, "displayName": "Ayşe"|null, "handle": "ayse"|null,
  "createdAt": "…", "suspended": false }

// AdminAppUserDetailDto — never body / face photos, try-on images or wardrobe images
{ "id", "tenantId", "email", "displayName", "handle", "createdAt", "language": "tr", "closetVisibility": "private",
  "providers": ["email", "apple"],
  "suspended": false, "suspendedAt": null, "suspendReason": null,
  "counts": { "items": 12, "looks": 3, "trips": 1, "followers": 4, "following": 2 },
  "entitlement": { "tier": "premium", "source": "store"|"admin"|null, "expiresAt": "…"|null,
                   "testPremiumExpiresAt": "…"|null },
  "credits": { "allowanceTotal": 30, "allowanceRemaining": 28, "packBalance": 20 },
  "itemRecognition": { "used": 3, "limit": 10, "unlimited": false },
  "devices": [ { "deviceId": "…", "platform": "ios", "updatedAt": "…", "pushEnabled": true } ] }

// AdminLibraryItemDto
{ "id": "lib-white-tshirt", "name": { "tr": "Beyaz tişört", "en": "White T-shirt" }, "category": "top",
  "colorIds": ["white"], "fabric": "cotton", "seasons": ["spring", "summer"], "imageUrl": "https://…"|null,
  "sortOrder": 10, "retired": false, "stored": true }

// SettingGroupDto — the panel renders the form from this; secrets are never part of any group
{ "group": "entitlements", "parameters": ["/droblet/dev/api/Entitlements", "/droblet/dev/worker/Entitlements"],
  "fields": [ { "key": "Free.ItemRecognitionLimit", "type": "int", "min": 0, "max": 1000, "value": 10 },
              { "key": "Premium.TryOnCreditsPerMonth", "type": "int", "min": 0, "max": 1000, "value": 30 } ] }
// field "type": int | bool | time ("HH:mm") | weekdayTime ("Mon 09:00") | timeZone (IANA id)

// RevenueReport additions
{ …, "clicks": 40,
  "byDay": [ { "day": "2026-11-18", "clicks": 3, "conversions": 1, "gmvMinor": 50000, "commissionMinor": 4000 } ],
  "byNetwork": [ { "key": "admitad" | "direct" | "network", "conversions": 2, "gmvMinor": …, "commissionMinor": … } ] }
```

Setting groups (only these parameters are writable; IAM allows `ssm:PutParameter` on exactly these ARNs):

| Group | Parameters | Fields |
|---|---|---|
| `entitlements` | `api/Entitlements`, `worker/Entitlements` (kept equal) | `Premium.TryOnCreditsPerMonth` 0–1000, `Free.ItemRecognitionLimit` 0–1000, `SelfServePremium.Enabled` bool (temporary self-serve premium in Ayarlar; dev on, prod off — [purchases-push.md §3a](purchases-push.md)) |
| `packing` | `api/Packing`, `worker/Packing` | `CabinMaxItems` 0–100, `MaxTripDays` 1–60 |
| `ai` | `worker/Ai` | `Enabled` (bool). Provider and model ids are shown read-only elsewhere — not editable here. |
| `notifications` | `api/Notifications` | `DefaultMorningLocal` (time), `DefaultTimeZone` (IANA), `MaxDevicesPerTenant` 1–50 |
| `notifierSchedule` | `notifier/Notifications` | `DefaultMorningLocal` (time), `DefaultWeeklyEditLocal` (weekdayTime), `DefaultFriendRatingsLocal` (time) |
| `authRateLimits` | `api/AuthRateLimits` | `LoginPerEmailPer15Minutes` 1–1000, `LoginPerIpPer15Minutes` 1–10000, `RegisterPerIpPerHour` 1–10000, `ForgotPerEmailPerHour` 1–100 |

## 6. CSV import and moderation actions

`POST v1/admin/product/bulk?dryRun=true` validates every row exactly like a real import and returns the same per-row
result (`created` / `updated` / `invalid` + field codes / `brand_not_found` / `duplicate_id`) **without writing** — the
panel's validation preview. The real import (no `dryRun`) is audited as `product.bulk`.


### Moderation

`POST v1/admin/moderation/report/{id}/resolve` (`moderation.manage`) keeps its body. The panel's three actions map to:
**Dismiss** → `dismissed`; **Resolve** → `contentRemoved` / `userWarned`; **Block** → `userSuspended`, which now also
suspends the reported account (same effect as `POST v1/admin/user/{id}/suspend`, reason = the report reason + note).

**`contentRemoved` removes the content** (App Store UGC rule), once per report — details in
[S §11](store-social-settings.md): the reported look / item disappears for everybody but its owner; a reported profile
keeps its handle but shows others no name, avatar or style tags. The owner keeps it (read-only `moderation` field) and
gets an inbox row `content_removed`. Audited as `report.resolve` + `report.contentRemove` (before / after = the target's
moderation state). A target that no longer exists still resolves (audit outcome `targetMissing`).

A resolved report cannot be reopened, so the undo is `POST v1/admin/moderation/report/{id}/restore`
(`moderation.manage`, no body): the content is visible again, the report keeps `status: resolved` and gains
`contentRestoredAt` / `contentRestoredByUserId`; audited as `report.contentRestore` (before / after). Idempotent; a later
resolve call never hides it again. `404 not_found`; `409 report_not_resolved` (still open), `409 report_not_content_removed`.
The panel lists resolved reports without actions, so it has no restore button yet — call the route directly.

## 7. First super admin (bootstrap)

No password is stored anywhere in the repo or the pipeline. `AdminAuth:BootstrapSuperAdminEmail`
(`fehmianac@gmail.com`, SSM String `api/AdminAuth`) is created as a super admin **without a password** the first time
the sign-in or forgot-password route is called and no bootstrap marker exists (idempotent; a marker row prevents a
second bootstrap even if that admin is later renamed). The owner opens the panel → "Set or forgot password" → enters
the e-mail → sets the password from the e-mailed link → signs in with password + code.

## 8. Configuration

| Section | Keys | Default |
|---|---|---|
| `AdminJwt` (SecureString `api/AdminJwt`, created by deploy-infra) | `SecretKey` (≥ 32 chars, must differ from `Jwt:SecretKey`), `Issuer`, `Audience`, `AccessTokenMinutes`, `RefreshTokenHours` | —, `droblet-admin`, `droblet-admin-panel`, 15, 12 |
| `AdminAuth` (String `api/AdminAuth`) | `PanelUrl`, `AllowedOrigins[]`, `BootstrapSuperAdminEmail`, `CodeTtlMinutes`, `CodeMaxAttempts`, `LoginPerEmailPer15Minutes`, `LoginPerIpPer15Minutes`, `VerifyPerIpPer15Minutes`, `ForgotPerEmailPerHour`, `RequestsPerMinute` | `https://droblet-admin.alatech.co`, panel origin, `fehmianac@gmail.com`, 10, 5, 10, 50, 50, 3, 600 |
| `CatalogImages` (env `CATALOG_IMAGE_BUCKET`, `CATALOG_IMAGE_BASE_URL`) | `Bucket`, `PublicBaseUrl`, `MaxUploadBytes`, `UploadUrlTtlSeconds` | stack bucket, its https URL, 5 MB, 300 |

The former `Admin` section (`Admin:UserIds`, `Admin:Emails`) and the `api/Admin` parameter are removed.
