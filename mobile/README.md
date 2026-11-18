# Droblet — mobile

Expo SDK 58 · React Native 0.88 · expo-router (`src/app`) · strict TypeScript · NativeWind 4 · TanStack Query 5 (persisted cache + write queue) · i18next (TR default, EN).

## Run

```bash
cd mobile
npm install
cp .env.example .env.local      # set DROBLET_API_BASE_URL etc. (read by app.config.ts → expo-constants extra)
npx expo start                  # Expo Go works for this slice (only Expo SDK modules are used)
```

Checks: `npm run typecheck` · `npm run lint` · `npm test` · `npx expo-doctor`.

Without `DROBLET_API_BASE_URL`, API calls fail with the "configuration missing" error state; 06 Bugün,
04b and the paywall run on fixtures and work regardless.

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
| `src/fixtures/` | Mock data behind hooks where no contract exists yet (Bugün, library, cart badge, **placeholder** store products). |
| `src/i18n/languages.ts` | Language registry. **Adding a language = one locale file + one entry here** (plus `locales/ios/<code>.json` for native permission dialogs). Drives detection, Intl formatting (`src/lib/format.ts`), `Accept-Language` and the key-parity test. |
| `src/i18n/features/*.{tr,en}.json` | Per-feature strings (own top-level keys, merged into the default namespace). |
| `src/i18n/{tr,en}.json` | Every user-facing string. Upper-case labels are written upper-case here (`STİL PROFİLİ`) — never `uppercase`/`textTransform` (lint-enforced). |

## Rules enforced by ESLint

No `uppercase` class / `textTransform: 'uppercase'`, no hex colours outside `src/theme`, no `any`, no string literals in JSX (use translations).
