# Droblet API — endpoint index

Every HTTP endpoint of the Api Lambda (`src/Api/Endpoints/V1`), with the contract document that describes it.

| Document | Scope |
|---|---|
| **W** — [wardrobe-looks-plan-stylist.md](wardrobe-looks-plan-stylist.md) | Wardrobe items, drafts and library; looks; today / plan / wear log; stylist and trips; try-on; palette; profile counters; AI recognition allowance; job result shapes |
| **S** — [store-social-settings.md](store-social-settings.md) | Keşfet content, catalog, cart, watch list, affiliate checkout and postback; feed, people, follow, block, report, rating, save; invite and share; settings, notifications, devices; analytics events; weather; admin content shapes (§11) |
| **A** — [admin.md](admin.md) | Admin panel: admin sign-in (password + e-mailed code), roles and permissions, admin users, audit log, dashboard, app users and moderation actions, library, catalog images, Parameter Store settings |
| **—** | Foundation endpoints (sign-in, profile basics, photos, style / body profile, purchases, jobs). No contract document yet: the request / response records sit next to each endpoint in `src/Api/Endpoints/V1/Auth` and `src/Api/Endpoints/V1/Tenant/{Profile,Photo,StyleProfile,BodyProfile,Entitlement}`; the one-line summary below is the endpoint's own (`WithSummary`). |

Shared conventions (both documents, §1): camelCase JSON and enum strings; `Authorization: Bearer <accessToken>`; errors are ProblemDetails with a stable snake_case `code`; calendar days are `yyyy-MM-dd`, instants UTC ISO-8601; the API returns codes, never sentences; text content is resolved to the request language (profile language → `Accept-Language` → `tr`, languages from `Localization:SupportedLanguages`).

**Auth** column: `user` = signed-in user (tenant from the token) · `admin:<permission>` = signed-in **admin panel** account (separate admin token, never an app token) whose role holds that permission ([A §2](admin.md)); `admin` = any signed-in admin · `anonymous` = no token (postbacks are authenticated by signature; admin sign-in routes are rate limited per IP).

188 endpoints.

## Auth and account (foundation)

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| POST | `v1/auth/apple` | anonymous | — | Sign in with Apple |
| POST | `v1/auth/google` | anonymous | — | Sign in with Google |
| POST | `v1/auth/login` | anonymous | — | Sign in with e-mail and password |
| POST | `v1/auth/logout` | user | — | Sign out |
| DELETE | `v1/auth/me` | user | — | Delete my account |
| POST | `v1/auth/password/forgot` | anonymous | — | Request a password reset e-mail |
| POST | `v1/auth/password/reset` | anonymous | — | Set a new password with a reset token |
| POST | `v1/auth/refresh` | anonymous | — | Rotate the refresh token |
| POST | `v1/auth/register` | anonymous | — | Register with e-mail and password |

## Profile, photos, style, body (foundation + additions)

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/tenant/body-profile` | user | — | Get body profile |
| PUT | `v1/tenant/body-profile` | user | — | Create or update body profile |
| GET | `v1/tenant/photo` | user | — | Get my body and face photos |
| DELETE | `v1/tenant/photo` | user | — | Delete my photos and generated images |
| POST | `v1/tenant/photo/upload-url` | user | — | Get a presigned upload for a body/face photo |
| PUT | `v1/tenant/photo/{kind}` | user | — | Make an uploaded photo the active body/face photo |
| DELETE | `v1/tenant/photo/{kind}/{photoId}` | user | [S](store-social-settings.md) | Delete my body or face photo |
| GET | `v1/tenant/profile` | user | — | Get profile |
| PUT | `v1/tenant/profile` | user | [S](store-social-settings.md) | Update profile |
| PUT | `v1/tenant/profile/handle` | user | — | Claim or change @handle |
| GET | `v1/tenant/profile/stats` | user | [W](wardrobe-looks-plan-stylist.md) | Get my profile counters |
| PUT | `v1/tenant/profile/visibility` | user | [S](store-social-settings.md) | Change closet visibility |
| GET | `v1/tenant/style-profile` | user | — | Get style profile |
| PUT | `v1/tenant/style-profile` | user | — | Create or update style profile |

## Entitlement, purchases and jobs

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/tenant/entitlement` | user | [W](wardrobe-looks-plan-stylist.md) | Get tier and AI credits |
| POST | `v1/tenant/entitlement/purchase` | user | — | Verify a store purchase |
| POST | `v1/tenant/entitlement/restore` | user | — | Restore purchases |
| GET | `v1/tenant/job/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Get job status |

## Wardrobe: reference, library, items, drafts

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/tenant/item` | user | [W](wardrobe-looks-plan-stylist.md) | Get wardrobe items |
| GET | `v1/tenant/item-draft` | user | [W](wardrobe-looks-plan-stylist.md) | Get pending item drafts |
| POST | `v1/tenant/item-draft` | user | [W](wardrobe-looks-plan-stylist.md) | Start AI processing of uploaded garment photos |
| POST | `v1/tenant/item-draft/confirm` | user | [W](wardrobe-looks-plan-stylist.md) | Confirm drafts into wardrobe items |
| DELETE | `v1/tenant/item-draft/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Discard an item draft |
| POST | `v1/tenant/item-draft/{id}/retry` | user | [W](wardrobe-looks-plan-stylist.md) | Retry AI processing of a failed draft |
| POST | `v1/tenant/item/from-library` | user | [W](wardrobe-looks-plan-stylist.md) | Add pieces from the ready library |
| POST | `v1/tenant/item/from-product` | user | [W](wardrobe-looks-plan-stylist.md) | Add a catalog product to the wardrobe |
| POST | `v1/tenant/item/upload-url` | user | [W](wardrobe-looks-plan-stylist.md) | Get presigned uploads for garment photos |
| GET | `v1/tenant/item/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Get item detail |
| PUT | `v1/tenant/item/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Update item |
| DELETE | `v1/tenant/item/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Delete item |
| GET | `v1/tenant/library/item` | user | [W](wardrobe-looks-plan-stylist.md) | Get the ready-made library |
| GET | `v1/tenant/reference/wardrobe` | user | [W](wardrobe-looks-plan-stylist.md) | Get wardrobe vocabularies |

## Looks

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/tenant/look` | user | [W](wardrobe-looks-plan-stylist.md) | Get looks |
| POST | `v1/tenant/look` | user | [W](wardrobe-looks-plan-stylist.md) | Create look |
| GET | `v1/tenant/look/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Get look |
| PUT | `v1/tenant/look/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Update look |
| DELETE | `v1/tenant/look/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Delete look |

## Today, plan, wear log

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/tenant/plan-day` | user | [W](wardrobe-looks-plan-stylist.md) | Get plan days |
| PUT | `v1/tenant/plan-day/{date}` | user | [W](wardrobe-looks-plan-stylist.md) | Create or update a plan day |
| DELETE | `v1/tenant/plan-day/{date}` | user | [W](wardrobe-looks-plan-stylist.md) | Remove a plan day |
| GET | `v1/tenant/today` | user | [W](wardrobe-looks-plan-stylist.md) | Get the Today snapshot |
| GET | `v1/tenant/wear-log` | user | [W](wardrobe-looks-plan-stylist.md) | Get wear logs of a month |
| POST | `v1/tenant/wear-log` | user | [W](wardrobe-looks-plan-stylist.md) | Log what was worn (Bunu giyiyorum) |
| GET | `v1/tenant/wear-log/summary` | user | [W](wardrobe-looks-plan-stylist.md) | Get the month summary |
| DELETE | `v1/tenant/wear-log/{date}/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Undo a wear log |

## Stylist and trips

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| POST | `v1/tenant/stylist/outfit` | user | [W](wardrobe-looks-plan-stylist.md) | Ask the stylist for outfit suggestions |
| POST | `v1/tenant/stylist/suggestion/{jobId}/{index:int}/accept` | user | [W](wardrobe-looks-plan-stylist.md) | Accept a suggestion |
| POST | `v1/tenant/stylist/suggestion/{jobId}/{index:int}/dislike` | user | [W](wardrobe-looks-plan-stylist.md) | Dislike a suggestion |
| POST | `v1/tenant/stylist/week` | user | [W](wardrobe-looks-plan-stylist.md) | Plan my week |
| POST | `v1/tenant/stylist/week/{jobId}/accept` | user | [W](wardrobe-looks-plan-stylist.md) | Accept a week plan |
| GET | `v1/tenant/trip` | user | [W](wardrobe-looks-plan-stylist.md) | Get trips |
| POST | `v1/tenant/trip` | user | [W](wardrobe-looks-plan-stylist.md) | Create trip |
| GET | `v1/tenant/trip/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Get trip detail |
| PUT | `v1/tenant/trip/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Update trip |
| DELETE | `v1/tenant/trip/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Delete trip |
| POST | `v1/tenant/trip/{id}/archive` | user | [W](wardrobe-looks-plan-stylist.md) | Archive trip |
| DELETE | `v1/tenant/trip/{id}/archive` | user | [W](wardrobe-looks-plan-stylist.md) | Unarchive trip |
| PUT | `v1/tenant/trip/{id}/item/{itemId}` | user | [W](wardrobe-looks-plan-stylist.md) | Tick a piece on the packing checklist |
| POST | `v1/tenant/trip/{id}/pack` | user | [W](wardrobe-looks-plan-stylist.md) | Build the suitcase |
| POST | `v1/tenant/trip/{id}/pack/{jobId}/accept` | user | [W](wardrobe-looks-plan-stylist.md) | Accept the suitcase draft |

## Try-on

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/tenant/tryon` | user | [W](wardrobe-looks-plan-stylist.md) | Find an existing try-on image |
| POST | `v1/tenant/tryon` | user | [W](wardrobe-looks-plan-stylist.md) | See it on me |
| POST | `v1/tenant/tryon/plan-week` | user | [W](wardrobe-looks-plan-stylist.md) | Generate try-ons for the planned week |
| POST | `v1/tenant/tryon/plan-week/quote` | user | [W](wardrobe-looks-plan-stylist.md) | Quote the credits for a week of try-ons |
| GET | `v1/tenant/tryon/{id}` | user | [W](wardrobe-looks-plan-stylist.md) | Get a try-on image |

## Palette

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/tenant/palette` | user | [W](wardrobe-looks-plan-stylist.md) | Get my colour palette |
| DELETE | `v1/tenant/palette` | user | [W](wardrobe-looks-plan-stylist.md) | Delete my palette result |
| POST | `v1/tenant/palette/analyze` | user | [W](wardrobe-looks-plan-stylist.md) | Analyse my colour palette |
| GET | `v1/tenant/palette/mismatch` | user | [W](wardrobe-looks-plan-stylist.md) | Get wardrobe pieces that clash with my palette |
| GET | `v1/tenant/palette/products` | user | [W](wardrobe-looks-plan-stylist.md) | Catalog products that suit my palette |

## Content (Keşfet)

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/content/creator` | user | [S](store-social-settings.md) | Creator / influencer collections |
| GET | `v1/content/creator/{id}/look` | user | [S](store-social-settings.md) | Creator / influencer looks |
| GET | `v1/content/edit/current` | user | [S](store-social-settings.md) | Current weekly edit |
| GET | `v1/content/edit/{id}` | user | [S](store-social-settings.md) | Weekly edit by id |
| GET | `v1/content/series-outfit` | user | [S](store-social-settings.md) | Series outfit collections |
| GET | `v1/content/series-outfit/{id}/look` | user | [S](store-social-settings.md) | Series outfit looks |

## Catalog, wardrobe match

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/catalog/brand` | user | [S](store-social-settings.md) | Brands |
| GET | `v1/catalog/product` | user | [S](store-social-settings.md) | Products (paged) |
| GET | `v1/catalog/product/{id}` | user | [S](store-social-settings.md) | Product detail |
| POST | `v1/tenant/catalog/complete` | user | [S](store-social-settings.md) | Complete my piece(s) |
| POST | `v1/tenant/catalog/product/{id}/checkout` | user | [S](store-social-settings.md) | Open one product on the brand site |
| GET | `v1/tenant/catalog/product/{id}/match` | user | [S](store-social-settings.md) | Wardrobe pieces compatible with a product |

## Cart, watch list, favourites, purchase prompt

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/tenant/cart` | user | [S](store-social-settings.md) | Cart |
| POST | `v1/tenant/cart/checkout/{brandId}` | user | [S](store-social-settings.md) | Check out a brand group |
| POST | `v1/tenant/cart/line` | user | [S](store-social-settings.md) | Add cart lines |
| DELETE | `v1/tenant/cart/line/{lineId}` | user | [S](store-social-settings.md) | Remove a cart line |
| GET | `v1/tenant/favorite/product` | user | [S](store-social-settings.md) | Favourite products |
| PUT | `v1/tenant/favorite/product/{productId}` | user | [S](store-social-settings.md) | Favourite a product |
| DELETE | `v1/tenant/favorite/product/{productId}` | user | [S](store-social-settings.md) | Remove a favourite product |
| GET | `v1/tenant/purchase-prompt` | user | [S](store-social-settings.md) | Pending "add to wardrobe?" prompts |
| PUT | `v1/tenant/purchase-prompt/{id}` | user | [S](store-social-settings.md) | Answer a purchase prompt |
| GET | `v1/tenant/watch-list` | user | [S](store-social-settings.md) | Watch list |
| PUT | `v1/tenant/watch-list/{productId}` | user | [S](store-social-settings.md) | Watch a product |
| DELETE | `v1/tenant/watch-list/{productId}` | user | [S](store-social-settings.md) | Stop watching a product |

## Affiliate postback (server to server)

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/affiliate/postback/network` | anonymous | [S](store-social-settings.md) | Conversion postback (network, GET variant) |
| POST | `v1/affiliate/postback/{source}` | anonymous | [S](store-social-settings.md) | Conversion postback (network or direct brand) |

## Social: feed, people, follow, block

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/tenant/block` | user | [S](store-social-settings.md) | Blocked accounts |
| PUT | `v1/tenant/block/{handle}` | user | [S](store-social-settings.md) | Block |
| DELETE | `v1/tenant/block/{handle}` | user | [S](store-social-settings.md) | Unblock |
| GET | `v1/tenant/feed` | user | [S](store-social-settings.md) | Friends feed |
| POST | `v1/tenant/follow/{handle}` | user | [S](store-social-settings.md) | Follow |
| DELETE | `v1/tenant/follow/{handle}` | user | [S](store-social-settings.md) | Unfollow |
| GET | `v1/tenant/follower` | user | [S](store-social-settings.md) | My followers |
| GET | `v1/tenant/following` | user | [S](store-social-settings.md) | Accounts I follow |
| GET | `v1/tenant/people` | user | [S](store-social-settings.md) | Search people by @handle |
| GET | `v1/tenant/people/suggested` | user | [S](store-social-settings.md) | Closets like yours |
| GET | `v1/tenant/people/{handle}` | user | [S](store-social-settings.md) | Person profile |
| GET | `v1/tenant/people/{handle}/item` | user | [S](store-social-settings.md) | Person: Closet tab ("Dolabını keşfet") |
| GET | `v1/tenant/people/{handle}/look` | user | [S](store-social-settings.md) | Person: Looks tab |
| PUT | `v1/tenant/people/{handle}/look/{lookId}/rating` | user | [S](store-social-settings.md) | Rate a look (1–5) |
| PUT | `v1/tenant/people/{handle}/look/{lookId}/save` | user | [S](store-social-settings.md) | Save a look |
| DELETE | `v1/tenant/people/{handle}/look/{lookId}/save` | user | [S](store-social-settings.md) | Remove a saved look |
| POST | `v1/tenant/people/{handle}/report` | user | [S](store-social-settings.md) | Report a person or their content |
| GET | `v1/tenant/people/{handle}/trip` | user | [S](store-social-settings.md) | Person: Trips tab |
| GET | `v1/tenant/saved-look` | user | [S](store-social-settings.md) | Saved looks |

## Invite and share

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/invite/{code}` | anonymous | [S](store-social-settings.md) | Resolve an invite code |
| POST | `v1/tenant/invite/attribution` | user | [S](store-social-settings.md) | Attribute my install to an invite code |
| GET | `v1/tenant/invite/link` | user | [S](store-social-settings.md) | My invite link |
| POST | `v1/tenant/share` | user | [S](store-social-settings.md) | Record a share and get the link |

## Settings, notifications, devices, analytics

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| POST | `v1/tenant/event` | user | [S](store-social-settings.md) | Analytics events (batch) |
| GET | `v1/tenant/settings` | user | [S](store-social-settings.md) | Settings (screen 29) in one call |
| PUT | `v1/tenant/user/me/device` | user | [S](store-social-settings.md) | Register / refresh a device |
| DELETE | `v1/tenant/user/me/device/{deviceId}` | user | [S](store-social-settings.md) | Remove a device |
| GET | `v1/tenant/user/me/notifications` | user | [S](store-social-settings.md) | Notification preferences |
| PUT | `v1/tenant/user/me/notifications` | user | [S](store-social-settings.md) | Update notification preferences |

## Weather

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/weather` | user | [S](store-social-settings.md) | Weather forecast |
| GET | `v1/weather/city` | user | [S](store-social-settings.md) | City autocomplete |

## Admin API

Admin panel at `https://droblet-admin.alatech.co` ([admin.md](admin.md)). Admin routes answer CORS only for the panel origin.

| Method | Path | Auth | Doc | What |
|---|---|---|---|---|
| GET | `v1/admin/brand` | admin:catalog.manage | [S](store-social-settings.md) | Brands (admin) |
| PUT | `v1/admin/brand/{id}` | admin:catalog.manage | [S](store-social-settings.md) | Create or update a brand |
| DELETE | `v1/admin/brand/{id}` | admin:catalog.manage | [S](store-social-settings.md) | Retire a brand |
| GET | `v1/admin/collection/{kind}` | admin:content.manage | [S](store-social-settings.md) | Content collections (admin) |
| PUT | `v1/admin/collection/{kind}/{id}` | admin:content.manage | [S](store-social-settings.md) | Create or update a content collection |
| DELETE | `v1/admin/collection/{kind}/{id}` | admin:content.manage | [S](store-social-settings.md) | Retire a content collection |
| GET | `v1/admin/collection/{kind}/{id}/look` | admin:content.manage | [S](store-social-settings.md) | Looks of a content collection (admin) |
| PUT | `v1/admin/collection/{kind}/{id}/look/{lookId}` | admin:content.manage | [S](store-social-settings.md) | Create or update a collection look |
| DELETE | `v1/admin/collection/{kind}/{id}/look/{lookId}` | admin:content.manage | [S](store-social-settings.md) | Retire a collection look |
| GET | `v1/admin/edit` | admin:content.manage | [S](store-social-settings.md) | Weekly edits (admin) |
| PUT | `v1/admin/edit/{id}` | admin:content.manage | [S](store-social-settings.md) | Create or update a weekly edit |
| DELETE | `v1/admin/edit/{id}` | admin:content.manage | [S](store-social-settings.md) | Retire a weekly edit |
| GET | `v1/admin/moderation/report` | admin:moderation.manage | [S](store-social-settings.md) | Moderation queue |
| POST | `v1/admin/moderation/report/{id}/resolve` | admin:moderation.manage | [S](store-social-settings.md) | Resolve a report |
| GET | `v1/admin/product` | admin:catalog.manage | [S](store-social-settings.md) | Products (admin, paged) |
| POST | `v1/admin/product/bulk` | admin:catalog.manage | [S](store-social-settings.md) | Bulk upsert products (feeds) |
| GET | `v1/admin/product/{id}` | admin:catalog.manage | [S](store-social-settings.md) | Product (admin) |
| PUT | `v1/admin/product/{id}` | admin:catalog.manage | [S](store-social-settings.md) | Create or update a product |
| DELETE | `v1/admin/product/{id}` | admin:catalog.manage | [S](store-social-settings.md) | Retire a product |
| GET | `v1/admin/report/funnel` | admin:analytics.view | [S](store-social-settings.md) | Funnel report |
| GET | `v1/admin/report/revenue` | admin:analytics.view | [S](store-social-settings.md) | Conversion / revenue report |
| POST | `v1/admin/auth/login` | anonymous | [A](admin.md) | Admin sign-in, step 1: e-mail + password |
| POST | `v1/admin/auth/verify` | anonymous | [A](admin.md) | Admin sign-in, step 2: the e-mailed code |
| POST | `v1/admin/auth/refresh` | anonymous | [A](admin.md) | Rotate the admin refresh token |
| POST | `v1/admin/auth/logout` | admin | [A](admin.md) | Sign out of this session |
| POST | `v1/admin/auth/logout-all` | admin | [A](admin.md) | Sign out of every session |
| GET | `v1/admin/auth/me` | admin | [A](admin.md) | The signed-in admin and their permissions |
| PUT | `v1/admin/auth/password` | admin | [A](admin.md) | Change my admin password |
| POST | `v1/admin/auth/password/forgot` | anonymous | [A](admin.md) | E-mail a set / reset password link |
| POST | `v1/admin/auth/password/reset` | anonymous | [A](admin.md) | Set a new admin password with the e-mailed token |
| GET | `v1/admin/admin-user` | admin:admins.manage | [A](admin.md) | Admin users |
| POST | `v1/admin/admin-user` | admin:admins.manage | [A](admin.md) | Invite an admin user |
| PUT | `v1/admin/admin-user/{id}` | admin:admins.manage | [A](admin.md) | Change name, role or disabled |
| POST | `v1/admin/admin-user/{id}/invite` | admin:admins.manage | [A](admin.md) | Resend the set-password e-mail |
| POST | `v1/admin/admin-user/{id}/revoke-sessions` | admin:admins.manage | [A](admin.md) | End every session of an admin |
| DELETE | `v1/admin/admin-user/{id}` | admin:admins.manage | [A](admin.md) | Delete an admin user |
| GET | `v1/admin/audit` | admin:audit.view | [A](admin.md) | Audit log of admin writes |
| GET | `v1/admin/dashboard` | admin:dashboard.view | [A](admin.md) | Dashboard counters |
| GET | `v1/admin/user` | admin:users.read | [A](admin.md) | Search app users |
| GET | `v1/admin/user/{id}` | admin:users.read | [A](admin.md) | App user detail |
| POST | `v1/admin/user/{id}/suspend` | admin:users.suspend | [A](admin.md) | Suspend an app user |
| POST | `v1/admin/user/{id}/unsuspend` | admin:users.suspend | [A](admin.md) | Lift a suspension |
| DELETE | `v1/admin/user/{id}` | admin:users.delete | [A](admin.md) | Delete an app account |
| PUT | `v1/admin/user/{id}/test-premium` | admin:users.grant | [A](admin.md) | Grant TEST premium |
| DELETE | `v1/admin/user/{id}/test-premium` | admin:users.grant | [A](admin.md) | Revoke TEST premium |
| POST | `v1/admin/user/{id}/credits` | admin:users.grant | [A](admin.md) | Add TEST credits |
| GET | `v1/admin/library` | admin:content.manage | [A](admin.md) | Ready-made library items (admin) |
| PUT | `v1/admin/library/{id}` | admin:content.manage | [A](admin.md) | Create or update a library item |
| DELETE | `v1/admin/library/{id}` | admin:content.manage | [A](admin.md) | Retire a library item |
| POST | `v1/admin/image/upload-url` | admin:image.upload | [A](admin.md) | Presigned upload for a catalog / content image |
| GET | `v1/admin/setting` | admin:settings.manage | [A](admin.md) | Owner-editable Parameter Store settings |
| PUT | `v1/admin/setting/{group}` | admin:settings.manage | [A](admin.md) | Update a settings group |

## Where the two halves meet

| Seam | Behaviour | Documented in |
|---|---|---|
| Weather | `GET v1/tenant/today`, trip days and stylist / suitcase jobs read the Open-Meteo forecast through the shared cache; one `WeatherCondition` enum for the whole API | W §5, S §10 |
| Other people's closets | Feed, `people/{handle}/look`, `/item`, `/trip`, rating and save read the owner's real looks, items and trips, always behind `VisibilityPolicy` and block rules; trips stay owner-only; only cleaned item images are exposed | S §6 |
| Wardrobe match / "Parçamı tamamla" | Run on the caller's real wardrobe items | S §3 |
| Catalog products in the wardrobe | `POST v1/tenant/item/from-product` reads the real catalog; accepting a purchase prompt adds the purchased products server-side | W §3, S §4 |
| Try-on of catalog products and edit looks | `product` and `editLook` targets resolve against the catalog and the weekly edit / collections | W §7 |
| Look ratings | Friends rate through `people/{handle}/look/{lookId}/rating`; the owner sees `rating { average, count }` on `GET v1/tenant/look` | W §4, S §6 |
| Palette → shop | `GET v1/tenant/palette/products` = the catalog filtered by the palette colours | W §8 |
| Morning reminder | The `morning_outfit` push is sent when a look is planned for the user's local day | S §9 |
| Account deletion | `DELETE v1/auth/me` removes every tenant partition of both halves and every cross-tenant trace | S §7 |
| Language | One supported-language list (`Localization` config); the profile language is set at registration from `Accept-Language` and changed with a partial `PUT v1/tenant/profile` | W §1, S §1, S §7 |
