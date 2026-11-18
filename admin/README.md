# Droblet admin panel

`https://droblet-admin.alatech.co` — the web panel for admins (owner decisions 1–5, `.claude/_handoff/droblet-handoff/README.md` §13).
Next.js 15 App Router, `output: "export"` (static files only), TypeScript strict, Tailwind v4. It talks only to the
admin API (`v1/admin/*`, contract: [`docs/api/admin.md`](../docs/api/admin.md)); every permission is enforced by the
server, the panel only hides what the signed-in role cannot use.

| Section | Pages |
|---|---|
| Overview | Dashboard (KPI tiles, daily clicks / conversions, top brands, funnel) |
| Catalog | Brands, products (search, brand filter, paging, bulk retire, product page with TR/EN tabs and image upload), CSV import (server dry-run preview → import → error report) |
| Content | Weekly edits (7 days, 1–2 price-band variants, sponsor), collections + their looks, ready-made library |
| Users & moderation | User search, user detail (counts, membership, credits, devices — never photos), suspend / delete, **TEST grants** (premium, credits), reports queue (dismiss / resolve / block) |
| Reports | Revenue (clicks, conversions, commission by brand / network / source / look / day, CSV export), funnel |
| System | App settings (owner-editable Parameter Store values; secrets are never shown), admin users, audit log, my account |

## Local development

```bash
cd admin
npm ci
npm run mock-api                                   # terminal 1: fake admin API on http://localhost:4010
NEXT_PUBLIC_API_BASE_URL=http://localhost:4010 npm run dev   # terminal 2: http://localhost:3000
```

`scripts/mock-api.mjs` is a dependency-free Node server with fake data for every route in `docs/api/admin.md`
(sign in with any e-mail and password, the code is `123456`; `MOCK_ROLE=contentEditor` or `moderator` shows the
panel as that role). It exists for UI work and screenshots only and is never deployed.

Against the real dev API: `NEXT_PUBLIC_API_BASE_URL=https://<api-id>.execute-api.eu-central-1.amazonaws.com npm run dev`
— the API must list `http://localhost:3000` in `AdminAuth:AllowedOrigins` (dev stage default).

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Static export to `out/` (`NEXT_PUBLIC_API_BASE_URL` is inlined at build time) |
| `npm run check` | After a build: every page exported in every language + root redirects + `404.html`, dictionary key / placeholder parity, no CSS upper-casing (`text-transform: uppercase` or the `uppercase` class) in sources or built CSS, no secret-looking strings, `noindex` meta |
| `npm run lint` | ESLint (next/core-web-vitals + typescript, no inline styles, no `any`) |
| `npm run typecheck` | `tsc --noEmit` |

## Languages

One dictionary per language: `src/i18n/tr.ts`, `src/i18n/en.ts` (typed against `en`); the registry is
`src/i18n/index.ts`. **A third language = one dictionary file + one line in the registry** (+ its locale tag);
the build then exports a third page tree and the language menus list it. Every UI string, including aria labels and
API error codes, comes from the dictionary. Upper-case labels are written upper-case in the dictionary (Turkish
`İ`), never with CSS.

URLs carry the language: `/tr/…`, `/en/…`. `/` and `/reset-password?token=…` (the link in e-mails) forward on the
client to the saved language, else the browser language, else Turkish. Record ids are query strings
(`/tr/users/detail/?id=…`) because a static export has no server routes.

## Security notes

- **Tokens.** The access token (15 min) lives only in memory. The refresh token (12 h, rotated on every use, reuse
  revokes the whole session family) is kept in `sessionStorage` so a page reload does not force a new sign-in with an
  e-mail code. Trade-off: `sessionStorage` is readable by script on this origin, so an XSS bug could steal a refresh
  token; `localStorage` would also survive closing the tab, and an `HttpOnly` cookie would need the API on the same
  site plus CSRF protection. We accept `sessionStorage` because the panel has no third-party scripts, renders no
  HTML from the API, the token dies with the tab, rotation detects replay, and "sign out all sessions" revokes
  everything server-side. Bearer tokens (no cookies) mean there is no CSRF surface.
- **Idle logout.** 30 minutes without mouse / keyboard / scroll / touch activity signs the admin out (also across a
  reload: the last-activity time is in `sessionStorage`).
- **Sign-out.** User menu → "Sign out" (this session) or "Sign out all sessions" (every device). Changing the
  password ends every session, this one included.
- **CSP.** S3 website hosting cannot set response headers. Add them in Cloudflare (Rules → Transform Rules →
  Modify Response Header) for `droblet-admin.alatech.co`:
  `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://*.execute-api.eu-central-1.amazonaws.com https://*.amazonaws.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  (`unsafe-inline` is needed by the Next.js static export's inline bootstrap script; `connect-src` covers the API and
  the presigned S3 image upload), plus `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`. The pages already carry `<meta name="robots" content="noindex, nofollow">` and
  `<meta name="referrer" content="no-referrer">`; the reset page also removes the token from the address bar after
  reading it.
- Never commit secrets here: the build has exactly one input, the public API URL.

## First super admin

No password exists anywhere in the repo or pipeline (`docs/api/admin.md` §7). The owner (`fehmianac@gmail.com`) opens
`https://droblet-admin.alatech.co` → **Set or forgot password** → enters the e-mail → opens the link from the e-mail
(`/reset-password?token=…`, 30 minutes, single use) → chooses a password (10–128 characters, a letter and a digit) →
signs in with e-mail + password + the 6-digit code from the second e-mail. Further admins are invited from
**Admin users**; they receive a set-password link the same way.

## Deploy

`.github/workflows/deploy-admin.yml` runs on every push to `main` that touches `admin/**`, `infra/admin.yaml` or the
workflow, and by hand (Actions → Deploy admin → Run workflow; `restrict_to_cloudflare=false` lets you check the S3
website URL directly before DNS exists):

1. typecheck, lint, build (with `NEXT_PUBLIC_API_BASE_URL` = repository variable **`API_BASE_URL`**), `npm run check`;
2. deploys the bucket stack `droblet-admin` (`infra/admin.yaml`: S3 website bucket named `droblet-admin.alatech.co`,
   readable only from Cloudflare IPs);
3. syncs `out/` (hashed `_next/*` immutable for a year, everything else `no-cache`).

Needs the repository secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (same as the other deploys) and the
variable `API_BASE_URL` (the API Gateway URL of the stage the panel should manage).

## Cloudflare (owner, once)

In the `alatech.co` zone:

1. **DNS → Add record:** type `CNAME`, name `droblet-admin`, target
   `droblet-admin.alatech.co.s3-website.eu-central-1.amazonaws.com`, **Proxied** (orange cloud). The bucket only
   answers Cloudflare's IP ranges, so a grey-cloud record would get `403`.
2. **SSL/TLS → Configuration Rules (or a Page Rule):** for hostname `droblet-admin.alatech.co` set **SSL mode =
   Flexible** — the S3 website endpoint speaks HTTP only; the browser ↔ Cloudflare leg stays HTTPS.
3. **SSL/TLS → Edge Certificates:** **Always Use HTTPS** on (or a redirect rule for this host).
4. Optional: the response headers from "Security notes" above (Transform Rule).
5. Optional, recommended: **Zero Trust → Access → Applications**: a self-hosted application for
   `droblet-admin.alatech.co` with an e-mail allow-list (one-time PIN). It adds a second gate in front of the
   panel's own sign-in; the API itself stays reachable for the app, so this does not affect anything else.

Then run **Deploy admin** once (if no push has triggered it yet) and open `https://droblet-admin.alatech.co`.
