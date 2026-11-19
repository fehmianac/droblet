# V — E-mail verification and data export

Contract of e-mail verification after an e-mail sign-up and of "Verilerimi indir" (KVKK m.11 / GDPR art. 15 and 20).
Conventions as in [store-social-settings.md §1](store-social-settings.md): camelCase JSON and enum strings,
ProblemDetails with a stable snake_case `code`, instants UTC ISO-8601.

## 1. E-mail verification

- `POST v1/auth/register` sends one e-mail (Accept-Language, TR / EN) with a **6-digit code** and a **link**
  `App:EmailVerificationUrl?token=…` (default `https://droblet.alatech.co/verify-email`; the page opens the app at
  `droplet://verify-email?token=…` and can verify on the web too). Code and link are valid **24 hours**; a resend
  replaces both (older ones stop working). Only SHA-256 hashes are stored (`EmailVerificationEntity`,
  `EmailVerificationTokenEntity`); a failed send never fails the sign-up.
- **Nothing is blocked** for an unverified user. The app shows "E-postanı doğrula" (banner + profile card item).
  Password reset works regardless — and a completed reset counts as verification (the link reached the inbox).
- Apple / Google: an account is verified when the provider says the address is verified (new account, an e-mail
  account linked by that address, or a later sign-in with the same verified address). An account without an e-mail
  sign-in has nothing to verify (`emailVerified: true`).
- Verifying lists the address in the hashed contact directory (decision 13): contact matching only finds verified
  addresses.

| Method | Path | Auth | Body | Result / errors |
|---|---|---|---|---|
| POST | `v1/auth/email/verify` | anonymous (code: bearer token) | `{ "code": "123456" }` or `{ "token": "…" }` (exactly one) | `200 { "emailVerified": true }` (also when it already was). `400 invalid_verification_code` (wrong, older or unknown), `400 verification_expired`, `401` (code without a token), `429 too_many_attempts` (5 wrong codes lock that code — ask for a new one; or `AuthRateLimits:VerifyCodePerUserPerHour`, 20), `400 validation_failed` (`code_or_token_required`, `code_invalid`) |
| POST | `v1/auth/email/resend` | user | — | `202`. `409 email_already_verified`, `429 too_many_attempts` (one per 60 s — the app's countdown — and `AuthRateLimits:VerifyResendPerUserPerDay`, 5, per day) |

Profile (`GET v1/tenant/profile` and every profile response) gains `emailVerified` (bool) and `emailVerifiedAt`
(instant or null).

## 2. Data export ("Verilerimi indir")

`POST v1/tenant/export` stores a `DataExportEntity` (queued) and puts a message on `data-export-request`. The data
export worker (Notifier zip, function `notifier-data-export`, own IAM role: read `tenant/*`, write `exports/*`) builds
the ZIP and stores it at `exports/{tenantId}/{exportId}.zip` in the private photo bucket (bucket lifecycle: deleted
after **7 days**), then writes an inbox row `data_export_ready` (`data.exportId`) and e-mails a link
`{PUBLIC_API_BASE_URL}/v1/export/download?token=…` (a random token, only its hash is stored, valid with the file).

ZIP layout (`README.txt` explains it in the request language):

| Path | Content |
|---|---|
| `profile.json` | account (name, e-mail, created, verified, 18+ confirmation), sign-in methods, profile (handle, language, city, visibility) |
| `data/{kind}.json` | one array per stored record kind of the tenant (every partition of `DeletionPlan`): style / body profile, consents + history, items, drafts, looks, plan days, wear log, trips (+ items, days), stylist feedback, jobs, follows / followers / requests, ratings given / received, saved looks, shares, invites, blocks, reports, cart, watch list, favourites, notifications (prefs + inbox), devices (without push token), entitlement, store purchases, credit account / reservations / ledger, affiliate clicks / conversions, photos / try-on / palette / avatar records |
| `data/analytics-events.json` | the user's analytics events (pseudonymous actor) since sign-up, at most 400 days |
| `files/…` | the user's own files under `tenant/{id}/`: `body/`, `face/`, `tryon/`, `items/`, `avatar/` |

Left out: keys and storage internals (`pk`, `sk`, `ttl`, GSI keys), secrets and hashes (push token, contact salt,
password / code / token hashes, Apple refresh token, credit idempotency keys), idempotency receipts, pending upload
slots, notification de-duplication markers, earlier exports.

| Method | Path | Auth | Result / errors |
|---|---|---|---|
| POST | `v1/tenant/export` | user | `202 DataExportStateDto` (`export.status = queued`). `409 export_in_progress` (one active export, enforced by a conditional lock — also for simultaneous requests); `429 export_rate_limited` + `nextRequestAt` (one per 24 h; a failed export does not count) |
| GET | `v1/tenant/export` | user | `200 DataExportStateDto` |
| GET | `v1/export/download?token=…` | anonymous | `302` to a 10-minute presigned GET (`Content-Disposition: attachment; filename="droblet-verilerim-{date}.zip"`). `410 export_expired`, `404 not_found` |

```jsonc
// DataExportStateDto
{
  "export": {                       // null before the first request
    "id": "01JD…",
    "status": "ready",              // queued | processing | ready | failed | expired
    "createdAt": "2026-11-19T09:00:00Z",
    "completedAt": "2026-11-19T09:01:10Z",
    "expiresAt": "2026-11-26T09:01:10Z",
    "sizeBytes": 18234511,
    "fileCount": 214,
    "downloadUrl": "https://droblet-dev-photos.s3…",   // ready only; 10 minutes
    "downloadUrlExpiresAt": "2026-11-19T09:11:10Z"
  },
  "canRequest": false,
  "nextRequestAt": "2026-11-20T09:00:00Z"              // null when a request is allowed now (or one is running)
}
```

**One active export, also under concurrency.** Besides the export row, the request writes a per-tenant lock row
(`DataExportLockEntity`, pk `tenant#{id}#dataexportlock`, sk `active`, holds the export id) in the **same
transaction**, conditioned on the lock version it read (absent = `attribute_not_exists`). Two simultaneous `POST`s
both pass the "no active export / not too soon" checks on their snapshot, but only one transaction commits: the other
gets `409 export_in_progress` (no second ZIP, no second e-mail). The lock holds while its export is queued /
processing and alive — the same 1-hour abandonment rule as the row (`DataExportRules.IsActive`: an attempt not touched
for 1 h counts as failed). Once its export is ready, failed, abandoned or gone, the lock is released and the next
allowed request overwrites it (the worker does not touch it). TTL 30 days; removed with the account.

The export row is kept 30 days (TTL) so the app can say "expired"; it, the lock, the token pointer and the file are
removed with the account (`exports/{tenantId}/` is one of the account's S3 prefixes).
