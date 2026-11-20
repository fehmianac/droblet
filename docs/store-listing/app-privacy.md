# App Store Connect — App Privacy ("nutrition label") answers

Derived from the actual data flows: the privacy notice draft (`docs/legal/{tr,en}/privacy.md`), the consent texts
(`docs/legal/*/consents.md`), `docs/legal/REVIEW.md`, `docs/api/*.md`, `docs/privacy/contacts-matching.md`,
`mobile/app.config.ts` / `mobile/package.json` (permissions and SDKs) and the backend providers in `src/`.
`.claude/team/SECURITY_ENGINEER.md` is partly outdated (SES, FCM-for-all, location); the code and the legal drafts win.

Apple's definitions: **collected** = transmitted off the device and kept longer than needed to serve the request;
**linked** = tied to the account; **tracking** = combined with other companies' data for ads or shared with data brokers.
Processors acting only for Droblet (AWS, OpenAI, SendGrid, Apple APNs, Google FCM, Google Analytics for Firebase, Open-Meteo,
Cloudflare) do not
make a type "shared" for tracking. `[ASSUMPTION]` = judgment call the owner / lawyer should confirm.

## Summary for the App Store page

- **Data Used to Track You:** none. No IDFA (AdSupport is not linked), no ATT prompt, no ad SDK, no data brokers. Firebase
  Analytics runs with ad-id / IDFV collection, ad storage, ad personalisation signals and ad-network registration off, and
  Google signals off — nothing is combined with other companies' data for advertising.
- **Data Linked to You:** Contact Info (name, e-mail), User Content (photos, other user content), Identifiers (user ID,
  device ID), Purchases, Location (coarse), Health & Fitness (weight, body measurements) `[ASSUMPTION]`, Usage Data
  (product interaction), Other Data, Diagnostics.
- **Data Not Linked to You:** none.

## Answers per data type

"Tracking" is **No** for every type.

| Apple data type | Collected | Linked | Purposes (Apple's list) | What, and notes |
|---|---|---|---|---|
| Contact Info › Name | Yes | Yes | App Functionality | Display name and @handle (shown to other users on the profile card); the name Apple/Google pass at sign-in. |
| Contact Info › Email Address | Yes | Yes | App Functionality | Sign-in, password reset (sent through SendGrid). May be an Apple private relay address. Never shown to other users. |
| Contact Info › Phone, Physical Address, Other | No | — | — | |
| Health & Fitness › Health | Yes `[ASSUMPTION]` | Yes | App Functionality | Optional weight (separate explicit consent 3), height, size and self-chosen body type. Styling inputs only; height and weight are never sent to the AI. Declaring them is the conservative choice — the legal drafts call weight "possibly health-related". |
| Health & Fitness › Fitness | No | — | — | |
| Financial Info | No | — | — | No card or bank data: payments are made in the App Store; brand purchases happen on the brand's site. |
| Location › Precise | No | — | — | The app has no location permission. |
| Location › Coarse | Yes | Yes | App Functionality, Product Personalization, Analytics | The city the user picks for weather (stored in the profile; trip cities). Open-Meteo receives only the city's coordinates, without identity. Google Analytics for Firebase derives an approximate location (country / city) from the IP address for reports; the IP itself is not stored by GA4. |
| Sensitive Info | No `[ASSUMPTION]` | — | — | Face and body photos are declared under Photos. No face recognition, biometric template or identification is done (privacy notice §4). If counsel classifies the face photo as biometric (open question Q1), add Sensitive Info › App Functionality. |
| Contacts | No `[ASSUMPTION]` | — | — | "Find friends from contacts" hashes e-mail addresses on the phone (salted SHA-256, salt valid ≤ 10 min); hashes are matched and discarded, never stored or logged. Apple counts data as collected only if kept longer than needed for the request. If the owner prefers the conservative answer: Contacts › App Functionality, Linked: No. |
| User Content › Emails or Text Messages | No | — | — | No chat or messages. |
| User Content › Photos or Videos | Yes | Yes | App Functionality, Product Personalization | Clothing photos (and background-removed item images), optional full-body and face photos (explicit consents), AI "See it on me" images, profile picture. Clothing, body and face photos are processed by OpenAI (US) as a processor. Body/face photos and AI images are never shown to other users. |
| User Content › Audio | No | — | — | Camera is used without the microphone. |
| User Content › Gameplay Content | No | — | — | |
| User Content › Customer Support | No `[ASSUMPTION]` | — | — | Support runs by e-mail outside the app. |
| User Content › Other User Content | Yes | Yes | App Functionality, Product Personalization | Wardrobe items, looks, calendar and wear log, trips, stylist requests (≤ 200 characters, sent to OpenAI without name/e-mail), ratings of friends' looks, saved looks, reports (≤ 500 characters), cart, watchlist. |
| Browsing History | No | — | — | Brand pages open in the in-app browser; Droblet does not record browsing. |
| Search History | No | — | — | |
| Identifiers › User ID | Yes | Yes | App Functionality | Account ID (also bound to purchases as `appAccountToken`), Apple / Google account subject. |
| Identifiers › Device ID | Yes | Yes | App Functionality, Analytics | An app-generated device ID and the push token (APNs), only when notifications are allowed. Firebase's app instance id (Analytics; reset on reinstall). Not the IDFA, and IDFV collection is switched off (`GOOGLE_ANALYTICS_IDFV_COLLECTION_ENABLED = false`). |
| Purchases › Purchase History | Yes | Yes | App Functionality | Subscription status, store transaction IDs, AI credit balance. Brand purchases: when the user taps "buy", a click ID ties the order the brand reports (order ID, amount, status) to the account for commission and the "Add to wardrobe?" prompt `[ASSUMPTION — declared here, not as tracking: the click ID is first-party and only the click ID goes to the affiliate network]`. |
| Usage Data › Product Interaction | Yes | **Yes** | Analytics | Two sinks, both product analytics only ([analytics-events.md](../analytics-events.md)): first-party events from an allow-list (sign-up completed, paywall viewed, credit spent …) and **Google Analytics for Firebase** (screen views by route pattern, the same events in GA4 names, coarse user properties). No free text, e-mail, names, photo URLs or item names. **Linked: Yes** because both use the actor hash `SHA-256("droblet-analytics:" + tenantId)` as the user id, which Droblet can recompute from the account (the first-party events are exported and deleted with the account, G9) — pseudonymous, but linkable by Apple's definition. Not used for tracking. Firebase can be switched off in Ayarlar › Gizlilik › "Ürün analitiği" (on by default, legitimate interest). |
| Usage Data › Advertising Data | No | — | — | No ads. |
| Usage Data › Other Usage Data | No | — | — | |
| Diagnostics › Crash Data | No | — | — | No crash-reporting SDK (Crashlytics is not installed). |
| Diagnostics › Performance Data | No | — | — | |
| Diagnostics › Other Diagnostic Data | Yes | Yes | App Functionality (security, fraud prevention) | Server logs: IP address, request times, errors, sign-in attempt counters; no e-mail, password, photos or prompts in logs. Retention 400 days in production (privacy notice still says `[LOG RETENTION]`). |
| Surroundings, Body (Hands/Head) | No | — | — | |
| Other Data | Yes | Yes | App Functionality | 18+ confirmation time, consent records, language, time zone, notification preferences, closet visibility. |

## Notes the reviewer may ask about

- **Optional vs required:** only e-mail (or an Apple/Google account), the handle/display name and the 18+ confirmation are
  required. Photos, body data, city, contacts and push are optional and each has its own consent or permission.
- **Deletion:** in the app, Profil › Gizlilik ve ayarlar › Hesabımı sil (immediate; backups age out within 30 days) and
  "Fotoğraflarımı ve üretilen görselleri sil"; on the web at `https://droblet.alatech.co/delete-account`.
- **Encryption:** TLS for all traffic; database and photo storage encrypted at rest (AWS eu-central-1).
- **Third countries:** OpenAI, SendGrid, Google (FCM, Firebase Analytics) (US) — disclosed in the privacy notice.
- **Firebase Analytics:** Info.plist keys `FIREBASE_ANALYTICS_COLLECTION_ENABLED = false` (the app enables it at runtime
  only while the user's choice is on), `GOOGLE_ANALYTICS_ADID_COLLECTION_ENABLED = false`, `GOOGLE_ANALYTICS_IDFV_COLLECTION_ENABLED = false`,
  `GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS = false`, ad storage / ad user data off; the IdentitySupport
  (AdSupport) framework is not linked (`$RNFirebaseAnalyticsWithoutAdIdSupport`). Firebase's own privacy manifest ships
  with the SDK and is aggregated into the app's `PrivacyInfo.xcprivacy`.

## Open items that can change these answers

Biometric classification of face photos (Q1/Q1a), OpenAI retention/DPA (G10, Q3), Firebase Analytics basis, PECR and
retention (Q16), weight/body type as health data. Re-check this page when `docs/legal/REVIEW.md` closes them.
