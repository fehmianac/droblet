# App screenshots for the landing page

`public/screens/{tr,en}/*.webp` are real screenshots of the app, taken from a **showcase build**: every
feature reads the app's typed fixtures (`EXPO_PUBLIC_DROBLET_FIXTURES=1`, see `mobile/src/api/dataSource.ts`),
so the screens show rich, realistic content without a backend. Signing in is the one thing fixtures do not
cover; the build is pointed at `mock-auth.mjs`, a small local server that answers sign-in, the profile, the
style / body profile (complete, so no "Profilini tamamla" card) and the entitlement (a member with 24 of 30 AI images
left, shown on Profil — the fixtures' credit balance matches it). In English the fixtures' own text (items, looks,
weekly edit, stylist, trips) is English too (`mobile/src/fixtures/showcase.ts`). No account
is created anywhere. The paywall is not used: its prices are placeholder data and the site says the price is
shown in the store.

| File | Screen (canvas board) | App link |
|---|---|---|
| `welcome` | 01 Hoş geldin | first screen after the splash |
| `today` | 06 Bugün | tab after sign-in |
| `wardrobe` | 10 Gardırop › Parçalar | `droplet://wardrobe` |
| `looks` | 14 Looklar | `droplet://wardrobe/looks` |
| `stylist` | 16 Stilist | `droplet://stylist` |
| `suggestion` | 17 Kombin önerisi | `stylist-submit` on 16 |
| `trip` | 19 Bavul detayı | `droplet://trip/trip_londra` |
| `palette` | 30 Renk paletim | `droplet://palette` |
| `shop` | 21 Stil mağazası | `droplet://shop` |
| `product` | 22 Ürün | `droplet://shop/product/prod_001` |
| `friends` | 25 Arkadaş akışı | `droplet://friends/feed` |
| `profile` | 28 Profil | `droplet://profile` |

The list the page uses is `src/lib/screens.ts`; `npm run check` fails when a referenced file is missing in
either language, when the two sets differ, when a language's set is over 2.5 MB or the hero image over 400 KB.

## Men's showcase account (canvas 17)

`mock-auth.mjs` also serves `GET v1/config` (open segments) and two more accounts: an e-mail starting with `emre`
signs in as **Emre** (men; the showcase build switches its fixtures to his wardrobe, looks, Bugün, weekly edit,
library and profile, and leaves his body type unset so Profil › "Profilini tamamla" opens the men's 11e step), and
"Kayıt ol" is a brand-new account with both segments open (03a Reyon → 03 → 04). Damla keeps women only, so the
landing captures above do not change. Flows: `men.yaml` (Bugün, Gardırop, 12b, Profil, Stil profili + segment
confirmation, 11e) and `men-onboarding.yaml` (03a, 03, 04); neither starts an AI step.

## Refresh

Use a separate checkout of the branch whose UI should be shown (do not build from your working copy):

```bash
git worktree add --detach ../capture <branch-or-commit>
cp mobile/.env.local ../capture/mobile/   # optional: only the non-API values are used
landing/scripts/capture/capture-screens.sh ../capture/mobile <simulator-udid> --build
git worktree remove ../capture
```

The script

1. builds and installs the Release showcase build (`--build`; leave it out when the app is already installed):
   `EXPO_PUBLIC_DROBLET_FIXTURES=1 DROBLET_API_BASE_URL=http://127.0.0.1:4010 npx expo run:ios --configuration Release --device <udid> --no-bundler`;
2. overrides the status bar (9:41, full battery not charging, 4 bars, Wi-Fi);
3. starts `mock-auth.mjs` on port 4010;
4. runs `screens.yaml` with Maestro once in Turkish (`AppleLanguages (tr)`, `tr_TR`) and once in English
   (`(en)`, `en_GB`): sign in, then one app link per screen (`open.yaml` confirms the "Open in Droblet?" prompt);
5. scales every capture to 1290 px tall (`sips`) and writes WebP at quality 90 (`cwebp`) into
   `public/screens/{tr,en}/`. With `CAPTURE_RAW_DIR=<dir>` it also keeps the full-size PNGs as `<dir>/{tr,en}/<name>.png`
   — the input of the store listing screenshots (`docs/store-listing/frames/render.sh`).

**Without a native build** (low disk space, or a Release simulator build of the same commit already exists in
DerivedData — the 2026-11-19 set was made this way): copy that `Droblet.app`, replace its JavaScript with a
showcase bundle and point it at the mock, then run the script without `--build`:

```bash
cd <capture>/mobile
EXPO_PUBLIC_DROBLET_FIXTURES=1 DROBLET_API_BASE_URL=http://127.0.0.1:4010 npx expo export:embed --platform ios \
  --dev false --minify true --entry-file node_modules/expo-router/entry.js --bundle-output /tmp/main.js --assets-dest Droblet.app
node_modules/hermes-compiler/hermesc/osx-bin/hermesc -emit-binary -O -w -out Droblet.app/main.jsbundle /tmp/main.js
# Droblet.app/EXConstants.bundle/app.config: set extra.apiBaseUrl to "http://127.0.0.1:4010"
codesign -f -s - --deep Droblet.app && xcrun simctl install <udid> Droblet.app
```

The native code must come from the same `package-lock.json` as the bundle.

Use the iPhone 17 Pro Max simulator (1320 × 2868 captures → 593 × 1290). A different device changes the
aspect ratio: update `screenSize` in `src/lib/screens.ts` to the new pixel size.

**Look at every image before committing** — no empty image boxes, loading skeletons, error or offline
states, debug UI or system prompts. Screens are content-heavy: if the fixtures change, re-check that the
hero chips on the landing page ("14° İstanbul", "Eksik parça", "Senin üzerinde") still match what the app shows.

## Open Graph image

`public/og.png` (1200 × 630) is rendered from `og.html` with headless Chrome after the screenshots exist:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1200,630 --screenshot=landing/public/og.png "file://$PWD/landing/scripts/capture/og.html"
```
