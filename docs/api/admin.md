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
| `ai.manage` | ✓ | | | `v1/admin/ai/…` (prompts, trials, model settings — §5b) |
| `ai.usage.view` | ✓ | | | `GET v1/admin/ai-usage/summary`, `GET v1/admin/user/{id}/ai-usage` (§5c). Every holder of `ai.manage` has it too. |
| `maintenance.manage` | ✓ | | | `v1/admin/maintenance/…` ("Bakım", §5d) |

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
`user.test_premium_revoke`, `user.credits_add`, `report.resolve`, `setting.update`, `ai.prompt.publish`,
`ai.prompt.rollback`, `ai.prompt.auto_fallback` (written by a worker, no admin), `ai.trial`, `ai.models.update`, `ai.limits.update`.

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
//   (AI model group only, §5b: model | choice | operationList; with "options" and "nullable")

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
| `ai` | `worker/Ai` | `Enabled` (bool, the kill switch). Models, effort, tier and image settings: group `aiModels` on **AI → Modeller** (§5b, `ai.manage`). |
| `notifications` | `api/Notifications` | `DefaultMorningLocal` (time), `DefaultTimeZone` (IANA), `MaxDevicesPerTenant` 1–50 |
| `notifierSchedule` | `notifier/Notifications` | `DefaultMorningLocal` (time), `DefaultWeeklyEditLocal` (weekdayTime), `DefaultFriendRatingsLocal` (time) |
| `authRateLimits` | `api/AuthRateLimits` | `LoginPerEmailPer15Minutes` 1–1000, `LoginPerIpPer15Minutes` 1–10000, `RegisterPerIpPerHour` 1–10000, `ForgotPerEmailPerHour` 1–100 |

## 5b. AI prompts and models (`ai.manage`)

The owner sees and edits every prompt the AI workers send and changes the AI models **without a deploy**. Each
stage has its own table and SSM path, so dev and prod overrides are separate.

### Prompt registry

Every prompt has a stable key (`PromptCatalog`, Infrastructure). The shipped text stays the **code default**
(`OpenAiPrompts` / `AiSchemas`, unchanged); a published override replaces it. 29 keys:

| Feature | Keys | Variables (required **bold**) |
|---|---|---|
| common | `common.language` — suffix of the stylist, garment and detection system prompts | **`languageName`**, `languageCode` |
| stylist | `stylist.outfit.instructions`, `stylist.week.instructions`, `stylist.pack.instructions` (system prompts); `stylist.compact_candidates` (appended before the language suffix when `Ai:CompactStylistPrompt` is on); `stylist.{outfit,week,pack}.schema` (view only) | — |
| wardrobe | `item.detect.instructions`, `item.detect.request`, `item.describe.instructions`, `item.describe.request`; `item.{detect,describe}.schema` | — |
| outfit_import | `item.match.instructions`, `item.match.request`; `item.match.schema` | request: **`candidates`**, `pieceHint` |
| palette | `palette.instructions`, `palette.request`; `palette.schema` | — |
| tryon | `photo_check.body.instructions`, `photo_check.face.instructions`, `photo_check.request`; `photo_check.schema`; `tryon.image.body`, `tryon.image.face` (image edit prompts) | body: **`garmentCount`**; face: **`garmentCount`**, **`bodyShape`**, `height`, `size` |
| cleanup | `cleanup.item.image`, `cleanup.item.jewellery.image`, `cleanup.garment.image` | item: **`piece`** |

Placeholders are `{{name}}`; rendering is one pass (a value is never expanded again). With no override the worker
sends the code default exactly as before (tests assert that the default template, rendered with the call's values,
is byte-identical to `OpenAiPrompts`).

**Validation on save (draft) and again on publish** — `400 validation_failed`:
`text`: `empty` | `too_long` (instructions 12 000, request 2 000, image 4 000, language suffix 500 chars) |
`malformed_placeholder` (`{{ x }}`, an unmatched `{{`) | `read_only` (schemas); `placeholders.{name}`: `missing` (a
required variable is absent) | `unknown` (not a variable of this prompt).

**Response schemas are view only.** They are generated from the fixed vocabularies (colours, fabrics, categories,
sub-types, season types) and must stay identical to the DTO the code deserializes and the guards check; a hand edit
could only break parsing or drift from the catalogs. Behaviour is tuned through the instructions; a schema change
is a code change.

**Prompt caching.** OpenAI reuses cached input tokens for an identical request prefix: system prompt (instructions +
language suffix), then the user text, then the images. The system prompts have no per-request variables. The
detail's `warnings` contains `cache_prefix_shorter` when a draft moves a variable above static text that precedes it
in the code default (fewer cached tokens per request); the editor shows it live. It never blocks a save.

**Storage** (single table): live version `pk ai#prompt, sk {key}` (`publishedVersion`, `text` — null = code default,
`publishedBy/At`, `note`, `fallback`); history `pk ai#prompt#{key}, sk v#000001…` (immutable: `publish`,
`rollback`, `auto_fallback`, author, time, note, `sourceVersion`); one draft per key `pk ai#promptdraft, sk {key}`.
Publish / rollback write the live row (optimistic version) and the history entry in one transaction.

**How workers read it.** Every worker Lambda reads the whole `ai#prompt` partition in one Query, keeps it in memory
for `Ai:Prompts:CacheSeconds` (60) and shares one refresh between concurrent calls. **A publish or rollback is live
within about 60 s** (plus a job already running). If the read fails (throttling, permissions, network) the code
defaults are used and the store is asked again after 15 s — the store can never stop a job. An override that no
longer validates against the build (e.g. a placeholder renamed in code) is ignored the same way.

### Runtime safety (automatic fallback)

A call that used an override and got an unusable answer — invalid JSON / not the DTO (stylist answers are checked
against `ModelOutfitOutput` / `ModelWeekOutput` / `ModelPackOutput`), a refusal, or a cut-off answer — is counted per
key and version (`pk ai#promptfail`, fixed window). At `Ai:Prompts:FailureThreshold` (5) failures within
`Ai:Prompts:FailureWindowMinutes` (10) the worker switches the key back to the entry that was live before (the
previous version, or the code default), as a new history entry `auto_fallback`, only if the failed version is still
live; writes the audit entry `ai.prompt.auto_fallback` (no admin, before / after) and sets `fallback` on the live row.
The panel shows a banner until it is acknowledged. The job itself behaves exactly as before (the stylist falls back
to its rules, other jobs fail with `ProviderError`). Dry-runs never count. Image prompts are not counted (an image
answer has nothing to parse). `FailureThreshold = 0` turns the switch off.

### Routes

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `v1/admin/ai/prompt` | — | `{ "items": [AiPromptSummaryDto] }` |
| GET | `v1/admin/ai/prompt/{key}` | — | `AiPromptDetailDto`. `404 not_found` |
| PUT | `v1/admin/ai/prompt/{key}/draft` | `{ "text" }` | `AiPromptDetailDto` (with `warnings`). `400` as above |
| DELETE | `v1/admin/ai/prompt/{key}/draft` | — | `AiPromptDetailDto` |
| POST | `v1/admin/ai/prompt/{key}/publish` | `{ "note"? (≤ 500), "expectedVersion"? }` | `AiPromptDetailDto`. `409 no_draft`, `409 version_conflict` (`expectedVersion` ≠ the live version), `409 already_live`. Audited `ai.prompt.publish` (before / after: version + text) |
| POST | `v1/admin/ai/prompt/{key}/rollback` | `{ "version" (0 = code default), "note"? }` | `AiPromptDetailDto` — a new history entry with that text. `404 version_not_found`, `409 already_live`. Audited `ai.prompt.rollback` |
| POST | `v1/admin/ai/prompt/{key}/acknowledge` | — | `AiPromptDetailDto` — hides the fallback banner. `404` without a fallback |
| POST | `v1/admin/ai/trial` | `AiTrialRequest` | `202 AiTrialDto` (queued) or `200` (image prompt preview). `400`, `404`, `429 too_many_requests` (30 trials per admin per hour). Audited `ai.trial` |
| GET | `v1/admin/ai/trial/{id}` | — | `AiTrialDto` (poll every 2 s until `succeeded` / `failed`) |
| GET | `v1/admin/ai/model` | — | `AiModelSettingsDto` |
| PUT | `v1/admin/ai/limits` | `{ "values": { "<field>": int } }` | `SettingGroupDto` of `aiLimits` (`api/AiLimits`: `StylistJobsPerDay`, `ItemRecognitionsPerDay` 0–10 000, `PaletteAnalysesPerDay`, `AiStartsPerMinute` 0–1000; 0 = no cap). Audited `ai.limits.update`. Template: `ssm:PutParameter` on `api/AiLimits` |
| PUT | `v1/admin/ai/model` | `{ "values": { "<field>": value \| null } }` | `SettingGroupDto`. `400` (`invalid`, `out_of_range`, `unknown_field`, `models_unknown`, `not_available`), `503 settings_unavailable`. Audited `ai.models.update` (before / after of the changed keys) |

```jsonc
// AiPromptSummaryDto
{ "key": "stylist.outfit.instructions", "feature": "stylist", "operation": "outfit",
  "kind": "instructions"|"fragment"|"request"|"image"|"schema", "position": "system"|"system_suffix"|"user"|"image_prompt"|"response_format",
  "description": "…", "editable": true, "publishedVersion": 3, "overridden": true, "publishedBy": "owner@…", "publishedAt": "…",
  "hasDraft": false, "draftUpdatedBy": null, "draftUpdatedAt": null,
  "fallback": { "at": "…", "fromVersion": 3, "toVersion": 4, "failures": 5, "reason": "invalid_output", "acknowledged": false } | null }

// AiPromptDetailDto
{ "summary": AiPromptSummaryDto, "defaultText": "…", "publishedText": "…"|null, "draftText": "…"|null, "draftBaseVersion": 3|null,
  "variables": [ { "name": "garmentCount", "required": true, "description": "…", "sample": "2" } ],
  "maxLength": 12000|null, "defaultStaticPrefix": 1830, "trialMode": "chat"|"preview"|"none", "imagesRequired": 0|1|2,
  "sampleInput": "{…}"|null, "schema": "{…}"|null, "warnings": ["cache_prefix_shorter"],
  "history": [ { "version": 4, "action": "publish"|"rollback"|"auto_fallback", "text": "…"|null, "sourceVersion": 1|null,
                 "author": "owner@…"|null, "at": "…", "note": "…"|null, "live": true } ] }

// AiTrialRequest
{ "type": "prompt", "key": "stylist.outfit.instructions", "text"?: "…" /* default: the saved draft */,
  "input"?: "{…}" /* stylist keys: the user message; default sampleInput */,
  "imageUrls"?: ["https://<catalog image host>/catalog/…"] /* vision keys: imagesRequired (match: crop, then candidates), ≤ 6 */ }
{ "type": "model", "model": "gpt-5-mini", "modelKind": "text"|"image", "effort"?: "minimal", "serviceTier"?: "flex" }
{ "type": "models" }

// AiTrialDto
{ "id", "type", "status": "queued"|"running"|"succeeded"|"failed", "createdAt", "finishedAt", "key", "model", "effort",
  "output": "raw model answer (≤ 20 000 chars)", "parsed": true|false|null, "parseError": "…"|null, "error": "OpenAI outfit returned 404 (model_not_found)"|null,
  "latencyMs": 1830, "usedModel": "gpt-…", "inputTokens", "cachedTokens", "outputTokens", "systemPrompt", "userPrompt" }

// AiModelSettingsDto
{ "settings": SettingGroupDto /* group aiModels, parameter worker/Ai */, "availableModels": ["gpt-…"], "modelsFetchedAt": "…"|null, "reloadSeconds": 60,
  "limits": SettingGroupDto /* group aiLimits, api/AiLimits */, "pricing": "{…}"|null /* worker/Ai/Pricing, read only (template: ssm:GetParameter) */ }
```

**Trials ("Dene" / "Test")** run in the **Stylist worker** (it holds the provider key; the Api never reads it): the
Api stores the trial (`pk ai#trial`, 7 days) and puts `{ kind: "AiTrial", jobId }` on the stylist queue. A trial runs
at most once (an SQS redelivery finds it claimed — a retry never costs a second call).
- `prompt`, `trialMode: chat`: the draft is used for **exactly one call** through the production code path (other keys
  keep their published text), with the built-in synthetic sample (stylist) or the given images (vision keys; only
  https URLs on the catalog image host, uploaded with `POST v1/admin/image/upload-url`). Result: the raw answer, the
  system / user text sent, whether it parses into the DTO the code reads, model, latency, tokens.
- `prompt`, `trialMode: preview` (image prompts `tryon.*`, `cleanup.*`): rendered with the sample values only, no call —
  an image call costs far more and its output would need storage; check a published image prompt with a real
  try-on / cleanup on dev.
- `model`, text: one tiny structured chat call (`{"ok": true}`, a few tokens) with the model, effort and tier; image:
  an access check only (`GET /v1/models/{id}`), no image is generated.
- `models`: `GET /v1/models` → the model allow-list (`pk ai#models`; embedding / audio ids left out).

### Model settings

`GET / PUT v1/admin/ai/model` edit the settings group `aiModels` = SSM String `/droblet/{stage}/worker/Ai` (the JSON
the workers bind to `AiOptions`; the API key is the separate SecureString `worker/Ai/ApiKey` and never part of it).
The group is not on `v1/admin/setting` (that page keeps `ai.Enabled`, the kill switch). `ssm:PutParameter` on
`worker/Ai` was already granted to the Api — no template change. Field types: `model` (an id in the allow-list —
`models_unknown` until a `models` trial has run, `not_available` when the key cannot use it), `choice` (`options`),
`operationList` (comma-separated `options`), `bool`, `int`. `null` removes an optional key (the code default applies).

| Field | Values |
|---|---|
| `TextModel`, `ImageModel` | model |
| `FastTextModel` (optional), `FastTextOperations` | model; subset of `outfit, week_plan, packing, garment_draft, item_detection, item_match, palette_season, photo_check` |
| `ReasoningEffort.Default`, `ReasoningEffort.{operation}` (each of the 8 operations) | `none, minimal, low, medium, high, xhigh` (optional) |
| `ServiceTier`; `ServiceTiers.{operation}`, `ServiceTiers.outfit_import` (the background import flow) | `auto, default, flex, priority` (optional) |
| `VisionDetail.{operation}` (operations that send images) | `low, high, auto` (optional) |
| `MaxOutputTokens.Default`, `MaxOutputTokens.{operation}` | 256–64 000 (optional) |
| `CompactStylistPrompt` (bool) | |
| `PromptCacheKey` (bool), `TimeoutSeconds` 10–110 | |
| `ImageSize`; `Image.Size`, `Image.TryOnSize`, `Image.CleanupSize` | `1024x1024, 1024x1536, 1536x1024, auto` (the `Image.*` ones optional) |
| `Image.Quality`, `Image.TryOnQuality`, `Image.CleanupQuality`, `Image.PreviewQuality` | `low, medium, high, auto` (optional) |
| `Image.TryOnInputFidelity` (`high, low`, optional), `Image.TryOnPreview` (bool) | |
| `Prompts.Enabled` (bool — off = every prompt is the code default), `Prompts.CacheSeconds` 10–600, `Prompts.FailureThreshold` 0–100, `Prompts.FailureWindowMinutes` 1–120 | |

**Change delay:** every Lambda re-reads its SSM path every 60 s (`SsmConfigurationExtensions`, `ReloadAfter`). The
reload runs when a warm instance is invoked after the interval, so a model change applies **within about 60 s**; an
instance that sat idle may finish one more job with the old value; a cold start reads the new value at once. More
per-operation knobs (e.g. `ServiceTiers.{op}`, `VisionDetail.{op}`, `MaxOutputTokens.{op}`) are added as one
`SettingsCatalog.PerOperation(…)` line each.

## 5c. AI usage and cost (`ai.usage.view`)

Where each user spends AI money, and the overall AI cost board (**AI › Maliyet**, user detail tab **AI kullanımı**).
All money is the **estimated** cost from `worker/Ai/Pricing` (docs/ai-cost.md), in integer micro-USD (`1_000_000` = $1);
the provider's invoice stays the truth. Nothing here holds a prompt, an answer or an image — numbers only.

### Counters (written by the workers)

When an AI job finishes — completed, failed or failed with its credit refunded — `JobLifecycle` adds its provider calls
(from the run's telemetry) to the counters **once per job id**: a marker row is created in the same DynamoDB transaction
(`attribute_not_exists`), so an SQS redelivery or a backfill replay adds nothing. The outfit import counts per photo (the
detect stage and the end of the photo, markers `oi#{session}#{index}#detect|done`); admin trials (`AiTrialRunner`) count
under the separate `admin` tenant (`trial#{id}`), never per user, never in a plan or the day index.

| Partition / sort key | What | Retention |
|---|---|---|
| `tenant#{id}#aiusage` / `d#yyyy-MM-dd`, `m#yyyy-MM` | one user's day and month | day 400 days, month 3 years |
| `ai#usage#all` / `d#…`, `m#…` | everything (users + admin trials) | same |
| `ai#usage#plan#{free\|premium}` / `d#…`, `m#…` | per plan (the user's tier when the job finished) | same |
| `ai#usage#admin` / `d#…`, `m#…` | admin trials | same |
| `ai#usage#day#{yyyy-MM-dd}` / `{tenantId}` | day index: `cost`, `calls`, `plan` (top users, active users, anomalies) | 400 days |
| `tenant#{id}#aiusagemark` / `{marker}` | once-per-job marker | 8 days |

Counter attributes (atomic `ADD`): `jobs`, `completed`, `failed` (every failed job, refunds included), `refunded`,
`calls`, `callErrors`, `in` / `out` / `cached` / `reasoning` (tokens), `images` (image outputs), `cost` (micro-USD); per
operation `op|{operation}|{metric}` and per model `model|{model}|{metric}`. Operations: `stylist_outfit`, `stylist_week`,
`stylist_pack`, `item_detection`, `cleanup`, `multi_item` (a piece picked from a multi-item photo), `import_detect`,
`import_match`, `import_cleanup`, `palette`, `photo_check`, `tryon`, `admin_trial`, `other`.

**Privacy.** The per-user rows are personal data about the account (like the usage events): they are **deleted with the
account** (DeletionPlan; the day-index rows are found through the user's day rows) and **included in “Download my data”**
as `data/ai-usage.json` (period, calls, tokens, images, estimated cost per operation and model). The markers are internal
bookkeeping and are not exported. The global, plan and admin rows hold no user id and stay after a deletion.

**Backfill.** `gh workflow run ops-dev.yml -f command=ai-usage-backfill -f args="--days 7"` replays the finished jobs and
outfit import photos still in the table (7 days) from their stored `aiCost` — no AI call, idempotent (the live markers),
allowed on prod. Jobs from before the counters have no token counts and a model only when they used exactly one.

### Routes

| Method | Path | Permission | Query | Result |
|---|---|---|---|---|
| GET | `v1/admin/user/{id}/ai-usage` | `ai.usage.view` | `from`, `to` (yyyy-MM-dd, UTC, inclusive; default the last 30 days; at most `AiUsage:MaxRangeDays` = 92) | `AdminUserAiUsageDto`. `404 not_found`, `400 validation_failed`. **Audited** as `user.ai_usage_view` (target the user, after = the range). |
| GET | `v1/admin/ai-usage/summary` | `ai.usage.view` | `from`, `to` (same rules) | `AdminAiUsageSummaryDto` |

```jsonc
// AiUsageTotalsDto
{ "jobs": 12, "completed": 11, "failed": 1, "refunded": 1, "calls": 19, "callErrors": 0,
  "inputTokens": 40210, "outputTokens": 9120, "cachedTokens": 1200, "images": 6, "costMicroUsd": 412000 }

// AdminUserAiUsageDto
{ "userId", "tenantId", "from": "2026-10-22", "to": "2026-11-20", "plan": "free"|"premium",
  "credits": { "allowanceTotal": 30, "allowanceRemaining": 28, "packBalance": 0 },
  "totals": AiUsageTotalsDto,
  "operations": [ { "operation": "tryon", "jobs", "failed", "calls", "inputTokens", "outputTokens", "cachedTokens", "images", "costMicroUsd" } ],
  "models": [ { "model": "gpt-image-2.5-sunburst", "calls", "inputTokens", "outputTokens", "cachedTokens", "images", "costMicroUsd" } ],
  "days":   [ { "period": "2026-11-20", "totals": AiUsageTotalsDto, "operations": […] } ],   // days with usage only
  "months": [ { "period": "2026-11", "totals": …, "operations": […] } ],                      // every month the range touches
  "recentJobs": [ { "id", "kind": "tryOn", "outcome": "completed"|"failed"|"refunded"|"running", "failure": null,
                    "models": ["gpt-image-2.5-sunburst"], "durationMs": 14200, "costMicroUsd": 31000,
                    "creditsCharged": 1, "creditsRefunded": 0, "createdAt", "updatedAt" } ],          // job table, last 7 days, ≤ 50
  "rates": { "usdTry": 43, "netMonthlyPlanTry": 141.66, "netYearlyPlanPerMonthTry": 88.54 } }

// AdminAiUsageSummaryDto
{ "from", "to", "totals": AiUsageTotalsDto, "admin": AiUsageTotalsDto,          // admin = the admin trials (inside totals)
  "days": [ { "day": "2026-11-20", "costMicroUsd", "calls", "jobs", "failed" } ],   // every day of the range
  "operations": […], "models": […],
  "plans": [ { "plan": "premium", "activeUsers": 14, "totals": …, "costPerActiveUserMicroUsd": 2090000,
               "costPerActiveUserPer30DaysMicroUsd": 2090000, "shareOfMonthlyNet": 0.6344, "shareOfYearlyNet": 1.015 } ],
  "topUsers": [ { "tenantId", "userId", "email": "a***@g***.com", "handle": "ay***", "plan", "costMicroUsd", "calls", "activeDays" } ],
  "anomalies": [ { "day", "tenantId", "userId", "email", "handle", "plan", "costMicroUsd", "medianMicroUsd": 100000,
                   "multiple": 12.0, "reasons": ["median", "absolute"] } ],
  "rates": { … }, "thresholds": { "medianMultiplier": 5, "minHistoryDays": 3, "minDayUsd": 0.10, "absoluteDayUsd": 2 } }
```

- **Active users** of a plan: users with at least one AI call in the range while on that plan (day index).
- **Margin per plan:** cost per active user, scaled to 30 days (`× 30 / range days`), × `UsdTryRate`, divided by the net
  monthly price of the monthly plan (`NetMonthlyPlanTry`) and of the yearly plan per month (`NetYearlyPlanPerMonthTry`).
  Premium only; free earns nothing (`null`).
- **Top users:** by cost in the range (`AiUsage:TopUsers`, default 20). E-mail and handle are **masked** (first letter of
  the e-mail and its domain, the TLD; first two letters of the handle); the full identity is on the user detail
  (`users.read`), which the row links to by `userId`.
- **Anomalies:** a user's day is flagged `median` when it is above `AnomalyMedianMultiplier` × the median of that user's
  previous 30 days with usage (needs `AnomalyMinHistoryDays` such days and a day of at least `AnomalyMinDayUsd`), and
  `absolute` when it is above `AnomalyAbsoluteDayUsd`. At most 100, most expensive first.

Configuration — SSM String `api/AiUsage` (same on both stages): `UsdTryRate` 43, `NetMonthlyPlanTry` 141.66,
`NetYearlyPlanPerMonthTry` 88.54 (docs/ai-cost.md §7), `AnomalyMedianMultiplier` 5, `AnomalyMinHistoryDays` 3,
`AnomalyMinDayUsd` 0.10, `AnomalyAbsoluteDayUsd` 2, `TopUsers` 20, `MaxRangeDays` 92.

## 5d. Maintenance — "Bakım" (`maintenance.manage`)

"Görselleri herkese açık konuma taşı": copies existing cleaned piece images and their 256 / 768 px thumbnails to the
public location (docs/images.md §8). No AI; idempotent per piece; processed by the item processor worker in resumable
batches (≤ `Maintenance:BatchSize` pieces / `Maintenance:BatchSeconds` per SQS message, cursor + sequence on the run
row). One active run at a time. Every start / cancel / retry is audited (`maintenance.publish_item_images.start`,
`.cancel`, `.retry_failed`, target `maintenance_run`).

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `v1/admin/maintenance/publish-item-images` | `{ "dryRun": true }` | `202 MaintenanceRunDto` · `409 maintenance_run_active` |
| GET | `v1/admin/maintenance/publish-item-images` | — | `{ "runs": MaintenanceRunDto[] }` (newest first, ≤ 20) |
| GET | `v1/admin/maintenance/publish-item-images/{runId}` | — | `MaintenanceRunDto` · 404 — poll every ~3 s while active |
| POST | `v1/admin/maintenance/publish-item-images/{runId}/cancel` | — | `MaintenanceRunDto` (`cancelling`, then `cancelled` after the current batch) · 404 · `409 maintenance_run_finished` |
| POST | `v1/admin/maintenance/publish-item-images/{runId}/retry-failed` | — | `202 MaintenanceRunDto` (`retryOf`, `onlyItemCount`) · 404 · `409 maintenance_run_active` · `422 nothing_to_retry` |

```json
MaintenanceRunDto {
  "id": "01J…", "kind": "publishItemImages", "dryRun": false,
  "status": "queued | running | cancelling | completed | cancelled | failed",
  "tenants": 12, "scanned": 840, "published": 610, "alreadyPublic": 0, "skipped": 220, "hidden": 2,
  "renditionsMade": 610, "failed": 8,
  "skipReasons": [{ "reason": "originalOnly | libraryOrCatalog | noImage | notOwnCleaned | cleanedMissing | itemDeleted", "count": 120 }],
  "failedItems": [{ "tenantId": "…", "itemId": "…", "reason": "copyFailed | conflict | error" }],   // ≤ 100
  "retryOf": null, "onlyItemCount": null,
  "startedBy": { "id": "…", "email": "…" }, "startedAt": "…", "updatedAt": "…", "finishedAt": null, "cancelRequestedAt": null
}
```
In a dry run `published` / `renditionsMade` mean "would publish" / "would make". Skipped pieces keep the presigned
fallback. The Ops command `publish-item-images` starts the same run (docs/images.md §8).

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
The panel's Resolved tab shows "Content removed · {date}" (or "Restored · {date} · {admin}") on such a report and an
"Undo removal" button with a confirm dialog; the 409 codes have their own messages.

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
