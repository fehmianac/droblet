# Teen mode — ages 16–17 with verified parental consent (T)

Owner decision (2026-11-21): 16–17 year olds may use Droblet in a **teen mode**, after a parent approves by e-mail.
Shared conventions: [README](README.md) (camelCase JSON and enum strings, ProblemDetails with a snake_case `code`).

> **Legal status: draft.** Every user-facing text of this feature (the parent page, the e-mails, the privacy section)
> is a draft marked `[HUKUK ONAYI]` and is **not** public: `Teen:Enabled` is `false` on prod and the landing page
> `/parent-consent/` is built only with `NEXT_PUBLIC_TEEN_PARENT_CONSENT=1` (§9).

## 1. Age band and clothing segment are separate

| Field | Values | What it decides |
|---|---|---|
| `ageBand` (user, mirrored on the tenant) | `adult` · `teen` | The rules: teen = the restrictions of §4 on top of everything else |
| `segment` (style profile, "reyon") | `women` · `men` | The content: body types, style tags, sub-types, library, AI wording ([G](segments.md)) |

A teen picks a reyon like anyone else (`PUT v1/tenant/style-profile`), so teens get women's or men's content with the
age rules on top.

**`Segment.Teen` is deprecated as a reyon.** It stays in the enum (and in `GET v1/config` → `segments.all`) for old
clients only; it is never open (`422 segment_not_available`) and the app must not show it as a chip. Code that used
`segment == teen` as "this is a teen" now reads `ageBand` (a stored `segment: teen`, which no account has, is still
treated as teen by the social rules).

## 2. Configuration (`Teen:*`)

SSM `api/Teen`, `worker/Teen`, `notifier/Teen` (same JSON). Admin panel → Ayarlar → **teen** edits every field
**except `TryOnEnabled`** (§6: changed only through `template.yaml`, i.e. a reviewed deploy).

| Key | dev | prod | Meaning |
|---|---|---|---|
| `Enabled` | `true` | `false` | 16–17 may sign up. Off: 16–17 gets `422 teen_not_available`; existing teen accounts keep working (limited by §4). |
| `TryOnEnabled` | `false` | `false` | **Coordinator safety condition**: default false on every stage until OpenAI's usage policy is confirmed and a lawyer approves. |
| `ConsentLinkDays` | 7 | 7 | Lifetime of the e-mailed approval link. |
| `ConsentRequestsPerDay` | 5 | 5 | Parent e-mails a teen may trigger per 24 h (send + resend); 1 per minute on top. |
| `ConsentRequestsPerParentPerDay` | 3 | 3 | E-mails one parent address may receive per 24 h (all teens). |
| `PhotoRetentionInactiveDays` | 90 | 90 | A teen's personal photos are deleted after this many days without activity (§7). |
| `LegacyAgeCheckbox` | `true` | `true` | Transition: an old client's `ageConfirmed: true` without `birthYear` still registers an adult. Switch off once the old app versions are gone. |
| `ParentConsentUrl` | `https://droblet.alatech.co/parent-consent/` | same | The page of the e-mailed link (trailing slash: S3 drops the query on the `/page` → `/page/` redirect). |
| `ParentalConsentTextVersion` | `2026-11-21` | same | Version of the parent-facing text; the page sends it back with the decision. |
| `Stylist.Enabled` | `true` | `true` | Approved teens get the limited free-tier stylist (§4.2). Off: `403 teen_stylist_unavailable`. |
| `Stylist.DailyLimit` | 3 | 3 | Outfit suggestion jobs per Europe/Istanbul day. `0` = off. |
| `Stylist.WeekPlanPerWeek` | 1 | 1 | Week plans per Istanbul week (Monday 00:00). `0` = off. |
| `Stylist.TripPackPerWeek` | 0 | 0 | AI trip packing per Istanbul week. `0` (default) = off for teens. |

`GET v1/config` (anonymous) gains:

```json
"teen": { "enabled": true, "minimumAge": 16, "adultAge": 18, "tryOnEnabled": false }
```

## 3. Age at sign-up

Birth **year** is collected instead of the 18+ box; the **month** only when the year alone cannot tell the band
(someone born in `now−16` may be 15 or 16; born in `now−18` may be 17 or 18). Nothing else about the date is stored.

### POST `v1/auth/register`

`{ "name", "email", "password", "birthYear": 2009, "birthMonth": 4 /* optional */, "ageConfirmed": true /* old clients */ }`

| Situation | Result |
|---|---|
| 18+ | `201` adult (as before; `ageConfirmedAt` is set) |
| 16–17, `Teen:Enabled` | `201` teen in `pendingParentalConsent` (§5) |
| 16–17, teen off | `422 teen_not_available` — nothing is stored |
| under 16 | `422 age_under_minimum` — nothing is stored |
| year ambiguous at 16 or 18 and no month | `422 birth_month_required` — ask the month, send again |
| `birthYear` in the future / more than 120 years ago, `birthMonth` not 1–12 | `400` with `birth_year_invalid` / `birth_month_invalid` |
| no `birthYear`, `ageConfirmed: true` | adult (transition, `Teen:LegacyAgeCheckbox`) |
| neither | `400 age_confirmation_required` (as before) |

Months count conservatively: with a month, the birthday counts as reached from the **first day of the next month**.

### POST `v1/tenant/profile/age-confirmation` — Apple / Google (the same age step)

Body `{ "birthYear", "birthMonth"? }`; an **empty body** is the old 18+ confirmation (transition). Same table as above,
except: **under 16 → the account that the provider sign-in just created is deleted** and the answer is
`422 age_under_minimum` with `accountDeleted: true` (the app signs out). The step happens once: when the age is already
set (`ageConfirmedAt` not null) the call returns the profile unchanged — the band cannot be changed afterwards.

### Profile

`GET v1/tenant/profile` and every profile answer gain `ageBand` (`adult` · `teen` · `null` = not given yet, Apple /
Google before the age step) and `teen` (the status object of §5, `null` for adults).

## 4. Teen rules (server-enforced)

Every rule is checked on the server; the app hides the UI too, but a call that gets through answers:

`403 teen_restricted` with `feature` = `social` · `commerce` · `outfitPhotoTryOn` · `marketing` · `closetVisibility` ·
`contacts` — for something a teen may never do.

`403 parental_consent_required` with `status` — for something that waits for the parent (limited mode, §5).

| Area | Rule | How |
|---|---|---|
| **Social** | No follow / follow requests, followers lists, people search and profiles, ratings, saves, reports of others, feed, share links, invite link / attribution, contact matching, @handle | Every route of these groups → `403 teen_restricted` (`social`); see the list in §4.1. Block (`PUT/DELETE/GET v1/tenant/block`) stays available. |
| | Closet forced private | Teen accounts are created `private`; `PUT v1/tenant/profile/visibility` with anything else → `403 teen_restricted` (`closetVisibility`). |
| | Invisible to others | The visibility policy hides a teen from every cross-tenant read (profile card, closet, looks, trips), from search, suggestions and follow-request lists, and the public index never lists one. |
| **Commerce** | No store / affiliate links, cart, checkout, favourites, watch list, purchases, paywall | Every route of these groups → `403 teen_restricted` (`commerce`). The stylist's gap filling picks from the ready library only (no catalog products). `GET v1/tenant/entitlement` answers the free tier with `paywallHidden: true`. Teens are **free tier**; a parent-bought premium is a later decision. The stylist is open to approved teens within the allowance of §4.2. |
| **Analytics** | No Firebase; first-party opt-out forced | The app must not initialise Firebase for a teen (`teen.restrictions` contains `firebaseAnalytics`). `POST v1/tenant/event` accepts the batch but stores nothing (`accepted: 0`, every event rejected `analytics_opted_out`); server-side events are not recorded either. |
| **Notifications** | Marketing off | `marketingNotifications` (and `contacts`) cannot be granted (`PUT v1/tenant/consents` → `403 teen_restricted` `marketing` / `contacts`); `weeklyEdit`, `priceDrop`, `friendRatings`, `followRequests` are stored and reported `false` whatever is sent; the Notifier skips teens for marketing pushes. The morning outfit (service) stays. |
| **AI stylist** | Age-appropriate | Prompt fragment `stylist.age.teen` (school- and age-appropriate, never suggestive) on every outfit / week / suitcase request; beachwear and other revealing pieces are left out of the candidates and the picks; suggestive wording in an answer fails the job (`guardRejected`). |
| **Try-on** | Only with all three conditions | §6 |
| **Outfit-photo try-on** | Off | A try-on whose target is a photo of another person (`target.kind` `photo` / `importPhoto`) → `403 teen_restricted` (`outfitPhotoTryOn`); the worker refuses it again. |
| **Retention** | Shorter | §7 |

### 4.1 Routes closed to teens

- `social`: `v1/tenant/follow/*`, `v1/tenant/follower*`, `v1/tenant/following`, `v1/tenant/follow-request/*`,
  `v1/tenant/people*`, `v1/tenant/feed`, `v1/tenant/saved-look`, `v1/tenant/share`, `v1/tenant/invite/*`,
  `v1/tenant/contacts/*`, `PUT v1/tenant/profile/handle`, `GET v1/tenant/profile/handle/availability`.
- `commerce`: `v1/tenant/cart*`, `v1/tenant/catalog/*` (match, complete, checkout), `v1/tenant/favorite/*`,
  `v1/tenant/watch-list*`, `v1/tenant/purchase-prompt*`, `v1/tenant/palette/products`,
  `POST v1/tenant/entitlement/{purchase,restore,self-premium}`, `DELETE v1/tenant/entitlement/self-premium`.
- **Limited mode** (`parental_consent_required` until the parent approved): `v1/tenant/photo/upload-url`,
  `PUT v1/tenant/photo/{kind}`, `v1/tenant/palette/analyze`, `v1/tenant/tryon*` (POST), `v1/tenant/stylist/*` (POST),
  `v1/tenant/trip/{id}/pack*`, `v1/tenant/item/upload-url`, `POST v1/tenant/item-draft*`, `POST v1/tenant/outfit-import*`,
  `v1/tenant/profile/avatar*` (upload / set). Reading, deleting and everything without a photo or AI (wardrobe from the
  library or by hand, looks, plan, wear log, trips without packing) works.

### 4.2 Limited stylist for approved teens (`Teen:Stylist`)

Owner decision (2026-11-21): the stylist is a member feature, but an **approved** teen (status `active`) on the free
tier gets a limited stylist instead of the paywall. The decision is `EntitlementPolicy.CheckTeenStylist`:

| Situation | Answer |
|---|---|
| Teen with premium (admin test grant) | The normal member check — no allowance |
| Consent not `active` | `403 parental_consent_required` (`status`) — unchanged, limited mode |
| `Stylist.Enabled` false, or the kind's limit is `0` | `403 teen_stylist_unavailable` |
| Allowance used up — outfit | `429 teen_stylist_daily_limit` with `resetsAt` (next 00:00 Europe/Istanbul, UTC) |
| Allowance used up — week plan / trip packing | `429 teen_stylist_weekly_limit` with `resetsAt` (next Monday 00:00 Istanbul, UTC) |
| Otherwise | `202` job, one slot reserved |
| Adult free / adult member | Unchanged: `403 premium_required` / allowed |

```json
{ "status": 429, "code": "teen_stylist_daily_limit", "resetsAt": "2026-11-21T21:00:00Z" }
```

Kinds: `POST v1/tenant/stylist/outfit` → daily outfit allowance, `POST v1/tenant/stylist/week` → week plan allowance,
`POST v1/tenant/trip/{id}/pack` → trip packing allowance. Accepting a suggestion, disliking it and the try-on of a
suggestion do not use the allowance (try-on has its own rules, §6).

**Counting.** One row per tenant (`TeenStylistUsageEntity`) written only with a version condition (DynamoDB
conditional write), so two concurrent starts can never both take the last slot. A start **reserves** a slot for the job
(the request id; a retried request keeps its one slot), the worker **commits** it when the job completes and
**releases** it when the job fails — a failed job (provider error, guard rejection, timeout) never uses an allowance. A
slot neither committed nor released within 24 h (a job lost in the DLQ) stops counting. A completed job counts in the
day / week it was started in. The prompt rules (`stylist.age.teen`), the revealing-item filter and library-only gap
filling apply as before.

The teen status (`GET v1/tenant/teen`, the profile's `teen`) carries the allowance:

```json
"stylist": {
  "enabled": true,
  "dailyLimit": 3, "usedToday": 1, "remainingToday": 2, "resetsAt": "2026-11-21T21:00:00Z",
  "weekPlanLimit": 1, "weekPlanUsed": 0, "weekPlanRemaining": 1, "weekResetsAt": "2026-11-22T21:00:00Z",
  "tripPackLimit": 0, "tripPackUsed": 0, "tripPackRemaining": 0
}
```

`used*` include jobs still running. `remaining*` is `0` when `enabled` is false. The app shows "Genç hesaplarda şimdilik
açık değil" only for `enabled: false` / a `0` limit (or `teen_stylist_unavailable`), never a paywall.

## 5. Verified parental consent (VPC)

### Status

`teen.status`: `pendingParentalConsent` (no approval yet) → `active` (approved) · `declined` · `withdrawn`. Only
`active` lifts limited mode. A declined or withdrawn teen may send a new request (maybe to the other parent), within
the rate limits.

```json
"teen": {
  "status": "pendingParentalConsent",
  "request": { "state": "sent", "parentEmailMasked": "a***@g***.com", "sentAt": "…", "expiresAt": "…", "resendAvailableAt": "…" },
  "approvedAt": null,
  "parentAllowedTryOn": false,
  "ownTryOnConsent": false,
  "tryOn": { "available": false, "reason": "feature_off" },
  "adultFrom": "2027-05-01",
  "restrictions": ["social", "commerce", "paywall", "firebaseAnalytics", "firstPartyAnalytics", "marketingNotifications", "outfitPhotoTryOn"],
  "stylist": { "enabled": true, "dailyLimit": 3, "usedToday": 0, "remainingToday": 3, "resetsAt": "…", "weekPlanLimit": 1, "weekPlanUsed": 0, "weekPlanRemaining": 1, "weekResetsAt": "…", "tripPackLimit": 0, "tripPackUsed": 0, "tripPackRemaining": 0 }
}
```

`request.state`: `none` (never sent) · `sent` · `expired` (7 days passed, not decided). `tryOn.reason` (null when
available): `feature_off` · `consent_not_active` · `parent_not_allowed` · `own_consent_missing`. `adultFrom`: the day
the account becomes adult (§8).

### Teen side (signed in, teen accounts only — an adult gets `409 not_a_teen_account`)

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `v1/tenant/teen` | — | `200 { ageBand, teen }` (adults: `teen: null`) |
| POST | `v1/tenant/teen/parental-consent` | `{ "parentEmail" }` | `202 { ageBand, teen }`. Sends the e-mail (profile language, TR/EN), replaces an open request (its link stops working). `400 parent_email_invalid` / `parent_email_same_as_teen`; `409 parental_consent_already_given` when active; `429 too_many_attempts` (1/min, `ConsentRequestsPerDay`, `ConsentRequestsPerParentPerDay`). |
| POST | `v1/tenant/teen/parental-consent/resend` | — | Same e-mail again to the stored address, with a fresh 7-day link. `409 parental_consent_not_requested` when nothing was sent. |

The teen's **own** try-on consent is the consent type `teenTryOn` (versioned, audit log) through
`PUT v1/tenant/consents` (`{ "type": "teenTryOn", "granted": true, "version": "<current>" }`). It is listed by
`GET v1/tenant/consents` only for teen accounts; an adult granting it gets `403 teen_restricted`.

### Parent side (anonymous; the token is the credential; 60 calls / hour / IP)

The e-mail links to `{ParentConsentUrl}?token=…` (`/parent-consent/?token=…`). The page explains what Droblet is, what
is processed and what the teen can and cannot do, then:

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `v1/parent-consent?token=…` | — | `200 { kind, status, teenName, language, expiresAt, textVersion, tryOnOffered, parentAllowedTryOn, decidedAt }` |
| POST | `v1/parent-consent/decision` | `{ token, approve, textVersion, confirmParent, confirmNotice, confirmProcessing, allowTryOn }` | `200` same shape |
| POST | `v1/parent-consent/withdraw` | `{ token }` | `200` same shape, `status: withdrawn` |

- `kind`: `request` (the 7-day approval link) · `manage` (the withdrawal link of the confirmation e-mail, valid until the
  teen turns 18). `status`: `pending` · `approved` · `declined` · `withdrawn` · `ended` (the teen turned 18).
- `teenName`: the first word of the display name only. `tryOnOffered`: the try-on checkbox is shown only when
  `Teen:TryOnEnabled` (otherwise `allowTryOn` is ignored and stored `false`).
- **Approve** needs the three explicit boxes `confirmParent` ("I am the parent or legal guardian"), `confirmNotice`
  ("I have read the notice"), `confirmProcessing` ("I agree to the processing described") all `true`
  (`400 parental_consent_confirmations_required`) and the current `textVersion` (`409 consent_version_outdated`).
  `allowTryOn` is a **separate** box. **Decline** needs nothing but the token.
- One decision per request: a second one → `409 parental_consent_already_decided`. Unknown token →
  `404 parental_consent_link_invalid`; expired → `410 parental_consent_link_expired` (the teen can resend).
- Recorded for every event (history, admin): what (`requested`, `resent`, `approved`, `declined`, `withdrawn`,
  `expired`, `ended`), when, a SHA-256 of the parent e-mail, a SHA-256 of the IP (never the IP), the text version, the
  try-on box, the three confirmations. The parent address itself is kept only to send the e-mails and is removed when
  the teen turns 18 or the account is deleted.
- After an approval the parent gets a confirmation e-mail with the **withdrawal link** (`kind: manage`), and the teen an
  in-app notification.
- **Withdraw** (any time until 18): status `withdrawn`, photo features off (limited mode again), and the teen's
  personal photos are **deleted**: body and face photos, every try-on image, the palette result, the profile picture.
  Wardrobe item images (garments) stay. The teen gets an in-app notification.

## 6. Try-on for teens

Allowed only when **all three** hold, checked on the API (`POST v1/tenant/tryon*` → `403 teen_try_on_not_available`
with `reason`) and again by the worker before the image call:

1. `Teen:TryOnEnabled` is `true` (**false on every stage**, see §2);
2. the parent approved **with** the try-on box (status `active`, `parentAllowedTryOn`);
3. the teen's own `teenTryOn` consent is valid (plus the usual photo consents).

For such an account only, the photo check's `appearsMinor` rejection is relaxed (body / face photo of the teen
themself). Every teen render carries the extra prompt guard `tryon.guard.teen` (fully clothed, neutral standing pose,
no body comments, school-appropriate, the person's real age kept). The outfit-photo try-on stays off (§4).

## 7. Retention

The daily Notifier run (`notifier-lifecycle`, 03:00 UTC) deletes a teen's personal photos (body / face photos, try-on
images, palette result) when the account has been inactive for `Teen:PhotoRetentionInactiveDays` (90). Activity =
sign-in or token refresh. The same run closes expired requests (history `expired`).

## 8. Turning 18

The age is re-evaluated on every request (a teen whose `adultFrom` has passed is treated as an adult at once) and the
daily run converts the account: `ageBand: adult`, parental links end (history `ended`, the parent address is removed),
the teen state is kept only as history, and the user gets an in-app notification (`teenBecameAdult`). Nothing else
changes: the closet stays private and marketing stays off until the user switches them on.

## 9. Landing page (draft flag)

`/parent-consent/?token=…` and `/en/parent-consent/?token=…` (trailing slash). Built with the form only when
`NEXT_PUBLIC_TEEN_PARENT_CONSENT=1`; otherwise the page says the link is not available yet. Not linked from anywhere,
not in the sitemap, `noindex`.

## 10. Admin

- `GET v1/admin/user` items: `ageBand` (teen badge). `GET v1/admin/user/{id}`: `ageBand` and `teen` =
  `{ status, parentEmailMasked, requestSentAt, requestExpiresAt, approvedAt, parentAllowedTryOn, ownTryOnConsent, adultFrom, photosPurgedAt, history: [{ at, event, textVersion, tryOnAllowed, ipHash }] }`
  (`ipHash` shortened to 12 hex characters).
- Moderation: `GET v1/admin/moderation/report` items carry `involvesTeen` and `priority` (`high` when the reporter or
  the target is a teen, else `normal`); high-priority reports come first in every page.
- Ayarlar → group **teen** (`api/Teen`, `worker/Teen`, `notifier/Teen`): `Enabled`, `ConsentLinkDays`,
  `ConsentRequestsPerDay`, `ConsentRequestsPerParentPerDay`, `PhotoRetentionInactiveDays`, `LegacyAgeCheckbox`,
  `Stylist.Enabled`, `Stylist.DailyLimit`, `Stylist.WeekPlanPerWeek`, `Stylist.TripPackPerWeek`.

## 11. New error codes

`birth_year_invalid` · `birth_month_invalid` · `birth_month_required` · `age_under_minimum` · `teen_not_available` ·
`teen_restricted` · `parental_consent_required` · `teen_try_on_not_available` · `not_a_teen_account` ·
`parent_email_invalid` · `parent_email_same_as_teen` · `parental_consent_already_given` ·
`parental_consent_not_requested` · `parental_consent_link_invalid` · `parental_consent_link_expired` ·
`parental_consent_already_decided` · `parental_consent_confirmations_required` · `consent_version_outdated` ·
`teen_stylist_daily_limit` · `teen_stylist_weekly_limit` · `teen_stylist_unavailable`.
