# Purchases, store notifications, push and Apple token revocation (P)

Contract for E10 (Droblet Üyelik + ek kredi paketi) and the push / account-deletion pieces that ship with it.
Conventions as in [store-social-settings.md](store-social-settings.md) §1. Owner setup (App Store Connect, Play Console,
Firebase / APNs, SSM): [../store-setup.md](../store-setup.md).

Decisions (README §9–§13): no RevenueCat or other hosted purchase service; StoreKit 2 / Google Play Billing are used
directly through the open-source `expo-iap` module and every purchase is verified **on the server**. Prices and the
free-trial length come from the store; the server stores none. Premium = 30 AI images per subscription month
(`Entitlements:Premium:TryOnCreditsPerMonth`); the consumable `com.alatech.droplet.credits.20` adds 20 pack credits
(`Store:CreditPacks`).

## 1. Products

| Product id | Kind | Grants |
|---|---|---|
| `com.alatech.droplet.premium.monthly` | auto-renewable subscription (group "Droblet Üyelik") | Premium while the store says access is on |
| `com.alatech.droplet.premium.yearly` | auto-renewable subscription (same group) | Premium |
| `com.alatech.droplet.credits.20` | consumable | +20 pack credits, once per store transaction |

Store account token: the app passes `appAccountToken` (iOS) / `obfuscatedAccountId` (Android) =
`GET v1/tenant/entitlement` → `storeAccountToken` — the tenant id (a ULID, 128 bits) written as a UUID. A purchase whose
token names another account is refused (409); a notification without an index entry is routed to the tenant in its token.

## 2. `POST v1/tenant/entitlement/purchase`

```json
{ "platform": "apple", "productId": "com.alatech.droplet.premium.yearly",
  "transactionId": "2000000812345678", "signedTransaction": "<StoreKit 2 JWS>" }
{ "platform": "google", "productId": "com.alatech.droplet.credits.20", "transactionId": "<purchaseToken>" }
```

* **Apple** — `signedTransaction` (`Transaction.jwsRepresentation`, `purchase.purchaseToken` in expo-iap) is verified
  locally: header `alg = ES256`, `x5c` chain built to the embedded **Apple Root CA - G3** (SHA-256 pinned), Apple marker
  OIDs on leaf (1.2.840.113635.100.6.11.1) and intermediate (1.2.840.113635.100.6.2.1), chain evaluated at the payload's
  `signedDate`, ES256 signature with the leaf key. Then `bundleId = com.alatech.droplet`, `productId` = the request's,
  `environment` ∈ Production / Sandbox (`Store:AcceptSandbox`, default true — App Review buys in sandbox) / Xcode (only
  with `Store:XcodeTestRootCertificate`). No secret is needed for this path. When the App Store Server API key is
  configured the subscription's **current** state (renewal info: grace period, billing retry) is read from
  `GET /inApps/v1/subscriptions/{originalTransactionId}`; a bare `transactionId` (no JWS) is resolved through
  `GET /inApps/v1/transactions/{id}` — without the key that is 501.
* **Google** — `purchases.subscriptionsv2.get` / `purchases.products.get` with the service account; the server then
  acknowledges the subscription / **consumes** the consumable (the app's own finish call is best-effort).
* Idempotent: key = Apple `originalTransactionId` (subscription) / `transactionId` (consumable), Google SHA-256 of the
  purchase token. A consumable adds its credits once (`StorePurchaseEntity.creditsGranted`), however often it is posted.
* First verified claim owns the purchase (`StorePurchaseIndexEntity`); a purchase owned by a deleted account is released.

| Status | Body / code | App |
|---|---|---|
| 200 | `EntitlementDto` (as `GET v1/tenant/entitlement`) | finish the store transaction, show the new tier / credits |
| 202 | `{ "code": "purchase_pending" }` | Android pending / Ask to Buy — keep the transaction, wait |
| 409 | `purchase_owned_by_another_account` | "Bu satın alma başka bir Droblet hesabına bağlı" — finish nothing |
| 422 | `purchase_invalid` · `product_unknown` | error state, retry offered |
| 501 | `purchase_verification_unavailable` | that store is not configured yet — transaction kept for later |

## 3. `POST v1/tenant/entitlement/restore`

```json
{ "platform": "apple", "purchases": [ { "productId": "…", "transactionId": "…", "signedTransaction": "<JWS>" } ] }
```

`purchases` = what the store still holds on the device (`getAvailablePurchases`; may be empty, max 50). Each is applied
like §2; then every subscription this account already owns is re-read from the store server API (when configured).
200 → `{ "entitlement": EntitlementDto, "restored": 1, "ownedByAnotherAccount": 0 }`. 501 only when nothing could be read.

## 4. Store server notifications (anonymous, server to server)

### `POST v1/store/apple/notifications` — App Store Server Notifications v2

Body `{ "signedPayload": "<JWS>" }`, verified exactly like §2 (same chain, same checks on `data.bundleId`,
`data.environment`, and `data.appAppleId` for production when `Store:AppAppleId` is set). Deduplicated by
`notificationUUID` (90-day receipt). 200 = handled (also for an unknown account), 400 `invalid_notification` = refused.

| notificationType (subtype) | Effect |
|---|---|
| SUBSCRIBED, DID_RENEW, OFFER_REDEEMED, RENEWAL_EXTENDED, REFUND_REVERSED, DID_CHANGE_RENEWAL_STATUS | apply the signed transaction: access until `expiresDate` |
| DID_CHANGE_RENEWAL_PREF (UPGRADE / DOWNGRADE) | same chain, product changes (upgrade now, downgrade at renewal) |
| DID_FAIL_TO_RENEW (GRACE_PERIOD) | access until `gracePeriodExpiresDate` (state `gracePeriod`) |
| DID_FAIL_TO_RENEW, GRACE_PERIOD_EXPIRED, EXPIRED | no access (state `billingRetry` / `expired`); data is kept |
| REFUND, REVOKE | subscription: access ends at `revocationDate`; consumable: the pack's credits are removed from what is left, never below zero, once |
| ONE_TIME_CHARGE | consumable bought but never posted by the app: granted to the account in `appAccountToken` |
| TEST, CONSUMPTION_REQUEST, REFUND_DECLINED, PRICE_INCREASE, RENEWAL_EXTENSION (SUMMARY) | acknowledged, no change |

An event older than the newest one applied (`signedDate` < `EntitlementEntity.lastEventAt`) never rolls state back.
The monthly AI allowance keeps following the subscription month (`periodAnchor` = original purchase).

### `POST v1/store/google/notifications` — Play RTDN through a Pub/Sub push subscription

Envelope `{ "message": { "data": "<base64 RTDN>", "messageId": "…" }, "subscription": "…" }` with
`Authorization: Bearer <Google OIDC token>`; the token must be signed by Google, `aud = Store:GooglePubSubAudience`,
`email = Store:GooglePubSubServiceAccount`, `email_verified = true`. `packageName` must be `com.alatech.droplet`.
Deduplicated by `messageId`. 204 handled · 400 invalid · 401 `invalid_push_token` · 503 `provider_not_configured`
(Pub/Sub redelivers until the Play API can be read).

* `subscriptionNotification` (any type) → the subscription is re-read (`subscriptionsv2.get`) and applied:
  ACTIVE / CANCELED-before-expiry → access, IN_GRACE_PERIOD → access, ON_HOLD / PAUSED / EXPIRED → no access, PENDING →
  nothing. Type 12 (REVOKED) ends access at once. A new token with `linkedPurchaseToken` (upgrade / downgrade) replaces
  the old entitlement and keeps its credit month.
* `oneTimeProductNotification` → `products.get`, granted once (and consumed) when purchased.
* `voidedPurchaseNotification` → refund / chargeback: subscription access ends; consumable credits removed as above.
* `testNotification` → ignored.

## 5. Devices and push (`PUT v1/tenant/user/me/device`)

Adds `pushTokenType`: `fcm` (Android FCM registration token) | `apns` (iOS APNs device token, hex). Omitted → inferred
(iOS + hex = apns, otherwise fcm). The Notifier sends `apns` tokens through **APNs HTTP/2** (token auth, `.p8` key in SSM
`notifier/Push/ApnsKey`, production host first, sandbox on `BadDeviceToken`) and `fcm` tokens through **FCM HTTP v1**.
Either channel is off (`NotConfigured`) while its SSM secret is `CHANGE_ME`. `UNREGISTERED` / 410 tokens are deleted.

Notification `data` (all strings) — the app's tap handler routes on `type`:

| type | extra keys | Screen |
|---|---|---|
| `morning_outfit` | `day` | 06 Bugün (`/`) |
| `weekly_edit` | `editId` | 08 Haftanın edit'i (`/edit/{editId}`) |
| `friend_ratings` / `friend_rating` | `lookId` (optional) | the look (`/look/{lookId}`), else my looks (`/wardrobe/looks`) |
| `follow_request` | `handle` | follow requests (`/friends/requests`) |
| `price_drop` | `productId` | 22 Ürün (`/shop/product/{productId}`), else the watch list |

## 6. Sign in with Apple — token revocation

`POST v1/auth/apple` accepts `authorizationCode` (from the same native sheet). After a successful sign-in the server
exchanges it at `https://appleid.apple.com/auth/token` (client secret = ES256 JWT: `iss` = team `4LB4RD97A9`,
`sub` = `com.alatech.droplet`, `aud` = `https://appleid.apple.com`, `kid` = `AppleAuth:KeyId`, key = SSM
`api/AppleAuth/PrivateKey`) and stores the refresh token AES-256-GCM encrypted on the Apple identity
(`api/AppleAuth/TokenEncryptionKey`). `DELETE v1/auth/me` posts it to `https://appleid.apple.com/auth/revoke`
(`token_type_hint = refresh_token`) before deleting the account. While the key is `CHANGE_ME` both steps are skipped
(logged) and sign-in / deletion work as before.
