# Droblet — public website (`landing/`)

Next.js 15 (App Router) exported as static files (`output: "export"` → `out/`), served from an S3 website
bucket behind Cloudflare. Nothing runs at request time: no server, no route handlers, no rewrites of our own.

```bash
cd landing
npm install
npm run dev          # http://localhost:3000
npm run build        # static export to out/
npm run check        # run after build — reads content/ and out/
npm run lint
npm run typecheck
```

## Pages

Turkish is the default language at the root; English lives under `/en/`. Every page exists in both.

| Route (TR · EN) | What |
|---|---|
| `/` · `/en/` | Landing page — canvas `Landing` / `LandingMobil` |
| `/terms/`, `/privacy/`, `/kvkk/`, `/consents/`, `/subscription-terms/`, `/cookies/`, `/community-guidelines/` (and `/en/…`) | Legal pages — **comprehensive drafts pending legal review**, `noindex` |
| `/delete-account/` | Web account deletion (store requirement) |
| `/reset-password/?token=…` | Password reset fallback: "Uygulamada aç" + web form |
| `/invite/?c=CODE` | Friend invite fallback |
| `/l/?id=ID` | Shared look fallback |
| `404.html` | Bucket error document (both languages on one page) |
| `robots.txt`, `sitemap.xml`, `og.png` | SEO |
| `.well-known/apple-app-site-association`, `.well-known/assetlinks.json` | Universal links / app links |

## Environment variables

All are read at build time (`src/lib/site.ts`). An empty value is a supported state. See `.env.example`.

| Variable | Used for | When empty |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | canonical, hreflang, sitemap, Open Graph | falls back to `https://droblet.alatech.co` |
| `NEXT_PUBLIC_API_BASE_URL` | `/delete-account`, `/reset-password`, invite preview | those pages show "Şu an kullanılamıyor" instead of a form; the build still passes |
| `NEXT_PUBLIC_APP_STORE_URL` | App Store buttons | button is a disabled "App Store · Yakında" pill |
| `NEXT_PUBLIC_PLAY_STORE_URL` | Google Play buttons | button is a disabled "Google Play · Yakında" pill |
| `NEXT_PUBLIC_CONTACT_EMAIL` | footer "İletişim" (`mailto:`) | the link is not rendered |

The deploy workflow currently passes only `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_API_BASE_URL`. Until it also
passes the two store URLs (and the contact e-mail), production shows the "Yakında" state and no contact link.

## Content and languages

Every string is in `content/{locale}.json`; components contain no copy. `content/tr.json` is the reference
shape. `npm run typecheck` (the dictionaries share one type) and `npm run check` (deep key, list-length and
placeholder comparison) both fail when a language is missing a key.

**Upper-case labels are typed upper-case in the dictionary** (`"KİŞİSEL GARDIROP"`, Turkish `İ` included).
`text-transform: uppercase` and Tailwind's `uppercase` class are forbidden; `npm run check` fails the build if
either appears in the output.

Adding a language (example: `de`):

1. `content/de.json` — copy `content/tr.json` and translate.
2. One entry in the `registry` in `src/lib/i18n.ts`.
3. `node scripts/make-routes.mjs de` — writes the thin route files under `src/app/de/` (each one only names the
   locale; a static export needs a file per route). Header, footer switch, hreflang, sitemap and the check
   script pick the new language up from the registry and the `content/` folder.

## Design

Tokens are in `src/app/globals.css` (`@theme`): ink `#1C1A17`, cream `#F4F1EC`, paper `#FBF9F5`, accent
`#6E5640`, muted `#665F56`, line `#DCD4C9`, sand `#E8E1D7`, danger `#9A3B2E`. Cormorant Garamond 500/600 and
Jost 400/500 are downloaded by `next/font` at build time and served from `/_next/static` — the browser makes no
request to Google. The logo (direction A) is copied from `mobile/assets/brand/` (`src/app/icon.svg`,
`public/brand/icon.svg`, inline paths in `src/components/Logo.tsx`). The canvas' image placeholders are replaced
by **real app screenshots** (`public/screens/{tr,en}/*.webp`, each page shows its own language) in a CSS iPhone
frame (`src/components/PhoneFrame.tsx`); there are no stock photos, statistics, testimonials or real people's
names. How to regenerate the screenshots and `og.png`: [`scripts/capture/README.md`](scripts/capture/README.md).
Scroll-in motion (`RevealOnScroll`, opacity/transform only) is off under `prefers-reduced-motion` and leaves the
page fully visible without JavaScript. Images are plain `<img>` with `width`/`height` (no `next/image` loader in
a static export); only the hero image loads eagerly.

## Legal pages are drafts

`/terms`, `/privacy`, `/kvkk`, `/consents`, `/subscription-terms`, `/cookies` and `/community-guidelines` hold
comprehensive drafts (TR + EN; KVKK is Turkish with an English courtesy translation). They carry a
"Taslak — hukuk onayı bekliyor" banner, a summary box, are `noindex` and are left out of the sitemap. Facts that are
not decided yet are `[PLACEHOLDERS]`; questions for the lawyer are `[HUKUK ONAYI: …]` / `[LEGAL REVIEW: …]`.
Review checklist: [`docs/legal/REVIEW.md`](../docs/legal/REVIEW.md).

The text lives in `legal.docs.*` of both dictionaries (a paragraph starting with `- ` renders as a list item).
`npm run legal:md` writes the same text as Markdown to `docs/legal/{tr,en}/` for review; `npm run check` fails if the
Markdown is out of date. When the reviewed text is approved: replace the placeholders, remove the banner, set
`index: true` in `legalMetadata` (`src/components/LegalPage.tsx`), add the routes to `src/app/sitemap.ts`, and relax
the draft / `noindex` assertions in `scripts/check.mjs` (steps in `docs/legal/REVIEW.md` §6).

## Account deletion (`/delete-account`)

`POST {API}/v1/auth/login` (e-mail + password) → type `SİL` / `DELETE` → `DELETE {API}/v1/auth/me` with the
bearer token → success. The token is kept in React state only (no cookie, no web storage). ProblemDetails
`code` values are mapped to sentences in `deleteAccount.errors` (`invalid_credentials`, `too_many_attempts`,
validation, expired session, network). Apple/Google-only accounts are told to delete from the app
(Profil › Ayarlar › Hesabımı sil).

## Deep-link fallbacks

A static bucket cannot serve `/invite/{code}`: there is no such file. So each fallback is **one** file and the
parameter is read in the browser (`src/lib/links.ts`):

- canonical web form, works on plain S3: `/invite/?c=CODE`, `/l/?id=ID`, `/reset-password/?token=TOKEN`;
- shared form: `/invite/CODE`, `/l/ID` — needs the Cloudflare rewrite below; the page then reads the value
  from `location.pathname`.

Each page offers "Uygulamada aç" (`droplet://invite/CODE`, `droplet://l/ID?invite=…`,
`droplet://reset-password?token=…`) and the store buttons, and stores nothing. The invite page asks the
anonymous `GET {API}/v1/invite/{code}` for the inviter's first name; an unknown code drops the "invited"
wording and keeps the store buttons. The look itself is never fetched or shown on the web. A visitor whose
browser language is another registered language is moved to that language's copy with the same parameters.

## Cloudflare — rules the owner must add

S3 website hosting can neither rewrite paths nor set security headers; both are Cloudflare rules on the zone.

### 1. Transform Rules → Rewrite URL (two rules)

Invite and look codes never contain a dot, so "no dot in the path" keeps assets and `index.html` untouched.

| Rule | When incoming requests match (expression) | Then: Rewrite path → Static | Query |
|---|---|---|---|
| Invite fallback | `starts_with(http.request.uri.path, "/invite/") and http.request.uri.path ne "/invite/" and not http.request.uri.path contains "."` | `/invite/index.html` | Preserve |
| Look fallback | `starts_with(http.request.uri.path, "/l/") and http.request.uri.path ne "/l/" and not http.request.uri.path contains "."` | `/l/index.html` | Preserve |

These are rewrites, not redirects: the address bar keeps `/invite/CODE`, which is what the page and the
universal-link association need. `/reset-password` needs no rule (its token is a query parameter).

### 2. Transform Rules → Modify Response Header (one rule, all requests)

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' <API origin>; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` |

`<API origin>` is the value of `NEXT_PUBLIC_API_BASE_URL`. `'unsafe-inline'` for scripts is required by the
static export (Next inlines its bootstrap data); there are no third-party scripts.

### 3. `.well-known`

The deploy workflow uploads both files as `application/json`. Cloudflare must serve them as-is: no redirect,
no HTML challenge, no "Always Online" page on `/.well-known/*` (Apple and Google fetch them without cookies).

## To-do for the owner

- [ ] **`public/.well-known/assetlinks.json`**: replace `"REPLACE_WITH_UPLOAD_KEY_SHA256"` with the SHA-256
      fingerprint of the Android signing certificate (Play Console → App integrity → App signing; add the
      upload key's fingerprint too if builds are installed outside Play). Until then Android app links do not
      verify; `npm run check` prints a warning.
- [ ] **API CORS preflight**: on 2026-11-18 the dev API answered `OPTIONS /v1/auth/login`, `/v1/auth/me` and
      `/v1/auth/password/reset` with **405**. Browsers refuse a preflight that is not 2xx, so account
      deletion and the web password form show the "connection" error until the API answers preflight
      requests (backend/infra change, outside this package). The invite preview is a simple `GET` and works.
- [ ] Add `NEXT_PUBLIC_APP_STORE_URL`, `NEXT_PUBLIC_PLAY_STORE_URL` and `NEXT_PUBLIC_CONTACT_EMAIL` to the
      deploy workflow once the listings and the address exist.
- [ ] Legal review of the drafts and the placeholders (see `docs/legal/REVIEW.md`).
- [ ] The two Cloudflare rewrite rules and the response-header rule above.
- [ ] Official App Store / Google Play badges, if wanted, come from the stores' own kits; the buttons here
      are generic styled links on purpose.

## Project rules enforced by `npm run check`

- `out/index.html`, `out/en/index.html`, every legal page, `/delete-account`, `/reset-password`, `/invite`,
  `/l` exist in every language with the right `<html lang>`, hreflang alternates, a title and a description;
- legal drafts carry the draft banner, the summary box and `noindex`, and every page's footer links to them;
- `docs/legal/{tr,en}/*.md` match the dictionaries (`npm run legal:md`);
- `out/404.html`, `robots.txt`, `sitemap.xml`, `og.png` exist;
- both `.well-known` files exist, parse as JSON, and list the expected app and paths;
- no `text-transform: uppercase` / `uppercase` class in the output; no runtime Google Fonts request;
- every internal link points at a file the bucket can serve;
- dictionaries have identical keys, list lengths and placeholders.
- every screenshot the landing page references exists for every language, both languages have the same set,
  each set stays under 2.5 MB and the hero image under 400 KB; every `<img>` has alt text and width/height.
