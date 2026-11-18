# Droblet — mobile

Expo SDK 58 · React Native 0.88 · expo-router (`src/app`) · strict TypeScript · NativeWind 4 · TanStack Query 5 (persisted cache + write queue) · i18next (TR default, EN).

## Run

```bash
cd mobile
npm install
cp .env.example .env.local      # set DROBLET_API_BASE_URL etc. (read by app.config.ts → expo-constants extra)
npx expo start                  # Expo Go runs everything except purchases and push (see below)
```

Checks: `npm run typecheck` · `npm run lint` · `npm test` · `npx expo-doctor`.

Without `DROBLET_API_BASE_URL`, API calls fail with the "configuration missing" error state; 06 Bugün,
04b and the paywall run on fixtures and work regardless.

## Purchases and push (development build)

`expo-iap` (StoreKit 2 / Play Billing) and `expo-notifications` are native modules: they need a development
build (`npx expo run:ios|android` or `eas build --profile development`), not Expo Go. Without a store (Expo
Go, web, Jest) the paywall shows the representative fixture prices and buying answers "store unavailable".

- **iOS simulator purchases** — `ios-storekit/Droblet.storekit` holds the three products (group "Droblet
  Üyelik", monthly + yearly with a 1-week free trial, 20-credit consumable). `npx expo prebuild -p ios`
  copies it into `ios/Droblet/` and sets it on the Droblet scheme (`plugins/withStoreKitConfig.js`; skipped on
  EAS and with `DROBLET_STOREKIT=0`). Open `ios/Droblet.xcworkspace` in Xcode and **Run from Xcode** (a StoreKit
  file only applies to Xcode launches). Transactions, refunds, renewals: Xcode → Debug → StoreKit → Manage
  Transactions. The server accepts these locally signed transactions only when the dev stage has
  `Store:XcodeTestRootCertificate` (Xcode → Editor → Save Public Certificate on the .storekit file; see
  `docs/store-setup.md` §6). Sandbox / TestFlight purchases need nothing extra.
- **Android purchases** — a build signed with the upload key, installed from a Play testing track, with a
  licence-tester account.
- **Push** — iOS gets the APNs token (no Firebase on iOS); Android needs `google-services.json`
  (`GOOGLE_SERVICES_JSON` file variable on EAS, or `GOOGLE_SERVICES_JSON=./google-services.json` locally).
  Permission is asked after onboarding and when a notification toggle is switched on.

## Layout

| Path | What |
|---|---|
| `src/app/` | Routes (all 30 screens of the map + auth extras). Guards in `_layout.tsx` (`Stack.Protected` with explicit `redirectTo`). |
| `src/theme/tokens.ts` | The only place with colour/type/spacing/radius values → `tailwind.config.ts`. Light palette only (dark later = add `palettes.dark`). |
| `src/components/ui/` | Design-system components (Button, Chip, SegmentedControl, ProductRow/Card, LookCard, EmptySlot, BottomActionBar, BottomSheet, Skeleton, OfflineBanner, AiBadge/AiImage, ScreenState, …). Showcase: `/dev/components` (dev builds, Profil tab). |
| `src/api/contracts.ts` | All request/response shapes — **provisional**, adjust here when the backend contract settles. |
| `src/api/client.ts` | Fetch wrapper: bearer token, single-flight refresh, 401 → refresh → retry once. |
| `src/auth/` | Secure-store session, onboarding progress, Apple nonce. |
| `src/sync/` | Per-user persisted QueryClient, registered mutation functions (queue survives restarts), conflicts (409/404), photo upload. |
| `src/api/contracts/` + `src/api/dataSource.ts` | Per-feature provisional contracts and **the** fixture ↔ API switch (`DATA_SOURCE`, every feature): one word per feature, or swap a single hook's `fromSource(...)` for its `api` argument. |
| `src/features/{store,social,account,credits}/` | Queries, queued mutations (registered via `sync/featureMutations.ts`), pure logic and feature components for Keşfet/mağaza/sepet (20–24b), sosyal (25–27), profil/ayarlar/palet (28–30) and the 05b credit sheet. |
| `src/analytics/` | `track(event, params)` — allow-listed events, batches of ≤ 50 through the persisted queue to `POST v1/tenant/event`. |
| `src/fixtures/` | Mock data behind hooks where no contract exists yet (Bugün, library, cart badge, **representative** store products — shown only when the store returns nothing). |
| `src/purchases/` | StoreKit 2 / Play Billing through `expo-iap` (`billing.ts`, the only file that touches it), product mapping (`products.ts`), the purchase state machine (`purchaseFlow.ts`: server confirms before the transaction is finished) and `PurchaseHost`. |
| `src/notify/push.ts`, `routes.ts` | Push permission, device token (APNs / FCM) registration, notification tap → screen. |
| `src/i18n/languages.ts` | **The** language registry (locale tag, own name, locale files). **Adding a language = its locale files (`<code>.json` + a copy of `features/tr/`) + one entry here** (plus `locales/ios/<code>.json` for native permission dialogs). Drives device-language detection, the language switch and its persistence (`preference.ts`; `features/account/LanguageSyncHost` writes every change to the profile, the device choice wins), Intl formatting, `Accept-Language` and the parity test (`languages.test.ts`: every locale file, missing/extra keys, empty strings, interpolation variables). |
| `src/i18n/features/<code>/<feature>.json` | Per-feature strings (own top-level keys, merged into the default namespace). |
| `src/lib/format.ts`, `upper.ts`, `trSuffix.ts` | **The** locale-aware helpers: money (`Money` = minor units + ISO currency → `formatMoney`, the only price path), percent, numbers, dates, relative time; `toDisplayUpper` for UI text (Turkish i → İ) and `toBrandUpper` for brand names (never Turkish casing: COMMUNITÉ); Turkish case suffixes for dynamic words. |
| `src/i18n/{tr,en}.json` | Every user-facing string. Upper-case labels are written upper-case here (`STİL PROFİLİ`) — never `uppercase`/`textTransform` (lint-enforced). |

## Rules enforced by ESLint

No `uppercase` class / `textTransform: 'uppercase'`, no hex colours outside `src/theme`, no `any`, no string literals in JSX (use translations).
