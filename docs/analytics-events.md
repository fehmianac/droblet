# Analytics — events, sinks and privacy settings

Droblet has **two analytics sinks behind one entry point**, `track(name, params)` in
`mobile/src/analytics/track.ts`:

| Sink | What | When it receives events | Covered by |
|---|---|---|---|
| **First-party** | Batches to `POST v1/tenant/event` → DynamoDB (`AnalyticsRules`, actor hash, per-actor copy for export / deletion, 400-day TTL) | Always (signed in; events before sign-in wait in memory). Only the server allow-list is stored (`mobile/src/api/wire/analytics.ts`). | Privacy notice §9 (unchanged behaviour) |
| **Firebase Analytics (GA4)** | Google Analytics for Firebase, project `drob-bce7f` | Only while **Ayarlar › Gizlilik › "Ürün analitiği"** is on (default on, legitimate interest), and only in a build that has the Firebase config file. Never from Jest or fixture builds. | Privacy notice §9 "Kullanım olayları ve ürün analitiği", KVKK, cookie notice §4 — **lawyer review: REVIEW.md Q16** |

The GA4 mapping (names, allowed params, value sanitising) lives in `mobile/src/analytics/firebaseEvents.ts`; keep this
page and that file in step (the jest test `firebase.test.ts` checks the naming rules and that every app event has a rule).

## SDK choice

- **`@react-native-firebase/app` + `@react-native-firebase/analytics` 27.1** with their Expo config plugins. Works with
  Expo SDK 58 / RN 0.88, the New Architecture (TurboModules) and the React Compiler (no hooks from the library; we call
  the modular API from plain functions).
- **iOS needs `useFrameworks: "dynamic"`** (`expo-build-properties`): RNFB 27 ships Firebase iOS SDK 13 through Swift
  Package Manager only, and its `pod install` refuses static linkage. Verified: `pod install` and a simulator
  `xcodebuild` of a prebuilt copy succeed; RNFB resolves `FirebaseAnalyticsCore` (no IDFA).
- Alternatives rejected: the Firebase JS SDK's analytics needs a browser (`document`, cookies) and does not run in React
  Native; sending GA4 Measurement Protocol hits from the app would need the API secret in the app and loses sessions,
  screen views and device data, and Google does not recommend it for client apps.
- One config plugin, `mobile/plugins/withFirebaseAnalytics.js`, applies RNFB's plugins **per platform, only when that
  platform's config file is set** (they throw without it — a build without the file still works, just without
  Firebase; the JS sink is then a no-op because there is no default Firebase app).

### Config files

| Platform | Secret | Prebuild | `app.config.ts` |
|---|---|---|---|
| Android | `GOOGLE_SERVICES_JSON` | written to `$RUNNER_TEMP/google-services.json`, package checked = `com.alatech.droplet` | `android.googleServicesFile` ← `GOOGLE_SERVICES_JSON` (path) |
| iOS | `GOOGLE_SERVICE_INFO_PLIST` | written to `$RUNNER_TEMP/GoogleService-Info.plist`, `BUNDLE_ID` checked = `com.alatech.droplet` | `ios.googleServicesFile` ← `GOOGLE_SERVICE_INFO_PLIST` (path) |

Both files are git-ignored. Locally: `GOOGLE_SERVICE_INFO_PLIST=./GoogleService-Info.plist GOOGLE_SERVICES_JSON=./google-services.json npx expo prebuild`.
The plist's `IS_ANALYTICS_ENABLED = false` is a legacy key; collection is decided by the Info.plist keys below and the
runtime switch.

## Privacy settings (native)

`mobile/firebase.json` is the source; the plugin writes the same values into Info.plist and AndroidManifest.xml
(Android with `tools:replace`, so they win over RNFB's library manifest), and RNFB re-applies `firebase.json` at build time.

| Setting | iOS Info.plist | Android meta-data | Value | Why |
|---|---|---|---|---|
| Collection at start | `FIREBASE_ANALYTICS_COLLECTION_ENABLED` | `firebase_analytics_collection_enabled` | **false** | Nothing (not even `first_open`) is sent until JS has read the user's choice and calls `setAnalyticsCollectionEnabled(true)`. Opt-out is also persisted natively. |
| Advertising id | `GOOGLE_ANALYTICS_ADID_COLLECTION_ENABLED` | `google_analytics_adid_collection_enabled` | **false** | No IDFA / AAID. iOS also does **not link IdentitySupport / AdSupport** (`$RNFirebaseAnalyticsWithoutAdIdSupport = true` → `FirebaseAnalyticsCore`), Android removes the `AD_ID` permission (`blockedPermissions`). So no ATT prompt and "No" in Play's Advertising ID declaration. |
| IDFV (iOS vendor id) | `GOOGLE_ANALYTICS_IDFV_COLLECTION_ENABLED` | — | **false** | Not needed: GA4 uses its own app instance id. Off = one identifier less, simpler App Privacy answer. |
| SSAID (Android id) | — | `google_analytics_ssaid_collection_enabled` | **false** | Same reasoning as IDFV. |
| Ad personalisation signals | `GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS` | `google_analytics_default_allow_ad_personalization_signals` | **false** | No ads. |
| Ad storage / ad user data (Consent Mode) | `GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_STORAGE`, `…_AD_USER_DATA` | `google_analytics_default_allow_ad_storage`, `…_ad_user_data` | **false** | No ads. |
| Analytics storage | `GOOGLE_ANALYTICS_DEFAULT_ALLOW_ANALYTICS_STORAGE` | `google_analytics_default_allow_analytics_storage` | true | Needed for analytics itself (still gated by the collection switch). |
| Ad network registration (SKAdNetwork) | `GOOGLE_ANALYTICS_REGISTRATION_WITH_AD_NETWORK_ENABLED` | — | **false** | No ads. |
| Automatic screen reporting | `FirebaseAutomaticScreenReportingEnabled` | `google_analytics_automatic_screen_reporting_enabled` | **false** | Native view-controller names are meaningless in RN; we log `screen_view` with the route pattern. |

GA4 anonymises IP addresses by default (no IP is logged or stored; country / city is derived and the IP discarded).

**Console settings (not code — the coordinator sets them):** Admin › Data retention › Event data **14 months**,
"Reset on new activity" **off**; Admin › Data collection › **Google signals off**; Account › Data sharing settings
**all off**; accept the **Google Ads Data Processing Terms**; do not link Google Ads / AdMob.

## The toggle and the gate

- `mobile/src/analytics/preference.ts`: `"Ürün analitiği"` choice, default **on**, stored on the phone
  (`AsyncStorage` key `droblet.productAnalytics`, kept across sign-outs, like the app language), applied at every start
  (`restoreProductAnalytics()` in the root layout) → `setAnalyticsCollectionEnabled(on)`. There is no server-side
  settings sync for it (no generic settings endpoint exists); the choice governs the SDK on that phone.
- `mobile/src/analytics/firebase.ts`: events tracked before the choice is read wait (≤ 50) and are sent or dropped;
  the user id and user properties are set only while collecting and cleared on sign-out.
- UI: `ProductAnalyticsCard` in Ayarlar › Gizlilik (canvas **29d Gizlilik ve ayarlar · tüm ekran**): title, one-line
  explanation, check box, "Gizlilik bildirimi" link. Turning it off logs `consent_updated` to the first-party sink only.
- **No events** from Jest (`JEST_WORKER_ID`) or fixture / showcase builds (`EXPO_PUBLIC_DROBLET_FIXTURES=1`).

## Never personal data

- Each event has an allow-list of params; everything else is dropped.
- String values must match `^[A-Za-z0-9._:-]{1,100}$` — no spaces, `@` or `/`, so free text, e-mail addresses, names
  and URLs cannot pass. The jest test pushes e-mail, URL and free-text values through every event and fails if any
  reaches Firebase.
- No item / look names, photo URLs, search text, stylist prompts, report notes. Catalogue product and brand ids are
  allowed (they identify a shop product, not a person); the user's own item / look ids are not sent.
- **User id** = the existing actor hash: first 32 hex chars of `SHA-256("droblet-analytics:" + tenantId)`, identical to
  `AnalyticsRules.Actor` on the server (`mobile/src/analytics/actor.ts`; the session now keeps `tenantId`).

## Debugging

- **iOS DebugView:** add `-FIRDebugEnabled` to the scheme's *Arguments Passed On Launch* (Xcode › Product › Scheme ›
  Edit Scheme › Run), run a development build; remove it again with `-FIRDebugDisabled`. Events appear in Firebase
  console › DebugView within seconds.
- **Android DebugView:** `adb shell setprop debug.firebase.analytics.app com.alatech.droplet` (off:
  `adb shell setprop debug.firebase.analytics.app .none.`). Verbose log: `adb shell setprop log.tag.FA VERBOSE`.
- The toggle must be on, and the build must contain the config file (prebuild with the env variables above).

## Naming rules (GA4)

snake_case, event names ≤ 40 chars, ≤ 25 params per event, param names ≤ 40 chars, string values ≤ 100 chars, user
property names ≤ 24 chars and values ≤ 36 chars; reserved event names (`first_open`, `session_start`, `in_app_purchase`,
`app_remove`, …) and the prefixes `firebase_`, `google_`, `ga_` are never used. `screen_view` is logged on purpose (the
documented manual screen tracking).

## Event table

"FP" = also stored by the first-party pipeline (server allow-list); the other app events reach Firebase only.

| App event (`track`) | GA4 event | Fires when | GA4 params | FP |
|---|---|---|---|---|
| `signup_step` step=`welcome` | `tutorial_begin` | Onboarding 01 "Başla" | — | ✓ `signup_started` |
| `signup_step` step=`account_created` | `sign_up` | A new account is created (e-mail, Apple, Google) | `method` email \| apple \| google | ✓ `signup_completed` |
| `login` | `login` | A returning user signs in | `method` email \| apple \| google | — |
| `signup_step` step=`consents` / `style_profile` / `body_profile` / `first_items` | `onboarding_step` | Each onboarding step is passed | `step`, `count`, `skipped`, `body_photos`, `face_photo` | ✓ (style / body / first items) |
| `signup_step` step=`done` | `tutorial_complete` | Onboarding finished (paywall closed from onboarding) | — | — |
| `paywall_viewed` | `paywall_view` | 05 paywall opens | `source` (where it was opened from) | ✓ |
| `credit_pack_view` | `credit_pack_view` | 05b extra-credit sheet opens | `reason` exhausted \| topUp | — |
| `begin_checkout` | `begin_checkout` | The store purchase sheet opens | `item_id` (store product id), `item_category` subscription \| credit_pack, `checkout`=store | — |
| `purchase` | `purchase` | The server confirmed a store purchase | `item_id`, `item_category` subscription \| credit_pack | — (`subscribed` is FP) |
| `subscribed` | — (not sent; `purchase` covers it) | Paywall purchase succeeded | — | ✓ |
| `credits_exhausted` | `credits_exhausted` | An AI action is refused for lack of credits | `feature` | ✓ |
| `credit_spent` | `credit_spent` | (declared; not tracked by the app yet) | `feature`, `count` | ✓ |
| `tryon_start` | `tryon_start` | "Üzerimde gör" accepted by the server | `path` body \| face, `cached` true \| false, `credit_cost` (0 when cached), `target` item \| look \| product \| edit-look \| suggestion \| plan-day \| trip-day | — |
| `tryon_complete` | `tryon_complete` | The try-on job finished (or the image already existed) | `path`, `cached`, `credit_cost`, `target` | — |
| `tryon_failed` | `tryon_failed` | The try-on job failed | `path`, `error_code`, `credit_refunded`, `target` | — |
| `outfit_suggested` | `outfit_suggested` | A stylist job delivered suggestions | `source` stylist \| complete, `count` | — |
| `week_planned` | `week_planned` | "Haftamı planla" delivered a proposal | `count` (days) | — |
| `trip_packed` | `trip_packed` | The trip packing job delivered a list | `count` (items) | — |
| `item_added` | `item_added` | Pieces saved to the wardrobe | `source` photo \| manual \| library \| bulk \| import, `count` | — |
| `first_item_added` | `first_item_added` | (declared; not tracked by the app yet) | `source` | ✓ |
| `outfit_import_commit` | `outfit_import_commit` | Outfit-photo import confirmed | `looks`, `items` (counts) | — |
| `look_saved` | `look_saved` | A look is saved (editor, or a stylist suggestion hearted) | `source` editor \| stylist | — |
| `first_look_created` | `first_look_created` | First look made in the builder | `source` | ✓ |
| `calendar_added` | `calendar_added` | A stylist suggestion put on the calendar | `source` stylist | — |
| `complete_look_clicked` | `select_content` | "Kombini tamamla" from a look | `content_type`=complete_look, `source` | ✓ |
| `view_item` | `view_item` | Catalogue product detail opens | `item_id`, `item_brand` | — |
| `cart_added` | `add_to_cart` | Product(s) added to the cart | `item_id`, `item_brand`, `source` | server-recorded |
| `brand_checkout_opened` | `begin_checkout` | "[Marka]'da öde" opens the brand site | `item_brand`, `count` (lines), `checkout`=brand_site | server-recorded |
| `search` | `search` | A shop search ran (debounced) | `surface`=shop — **never the search text** (`search_term` is not sent) | — |
| `look_shared` | `share` | A look / invite link is shared | `method` (channel), `content_type` (kind) | server-recorded |
| `invite_install` | `invite_install` | The app was opened from an invite link | `method` (via) | server-recorded |
| `consent_updated` | `consent_updated` | An explicit consent is granted / withdrawn, or "Ürün analitiği" switched | `consent_type`, `granted`, `source` | — |
| (route change) | `screen_view` | Every expo-router navigation | `screen_name` = `screen_class` = route pattern without groups, e.g. `wardrobe`, `item/[id]`, `shop/product/[id]`, `index` | — |

Try-on outcomes, stylist, week and trip events are reported by the single job poller (`mobile/src/api/jobs.ts` →
`analytics/jobEvents.ts`), once per job however many screens poll it. The week try-on batch reports outcomes without a
start event (path unknown). The outfit-photo try-on (parallel work) will add `path`=photo when it lands.

## User properties

| Property | Values | Source (cached data only, never an extra request) |
|---|---|---|
| `plan` | free \| premium | entitlement (`tier`) |
| `app_language` | tr \| en | app language |
| `onboarding_done` | true \| false | onboarding status |
| `has_body_photo` | true \| false | my photos |
| `has_face_photo` | true \| false | my photos |
| `wardrobe_size_bucket` | 0 \| 1-9 \| 10-29 \| 30-99 \| 100_plus | profile stats `itemCount` |

## Retention

- First-party events: 400 days or account deletion (unchanged).
- GA4: **14 months** event-level (console setting above), then deleted by Google; aggregated reports are anonymous.
  After account deletion the actor hash can no longer be linked to anyone (the tenant id is gone). A GA4 user-deletion
  request on account deletion is open for the lawyer (REVIEW Q16.6, G12).
