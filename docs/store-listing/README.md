# Store listing kit — App Store and Google Play

Everything needed to fill in the two store consoles for Droblet's first release, in Turkish and English.
Values marked `[ASSUMPTION]` or `[OWNER]` must be confirmed or filled by the owner; nothing here has been entered in a console.

| File | What |
|---|---|
| [app-store.md](app-store.md) | App Store Connect: name, subtitle, promotional text, keywords, description, what's new, URLs, categories |
| [google-play.md](google-play.md) | Play Console: title, short/full description, release notes, graphics, App content declarations |
| [app-privacy.md](app-privacy.md) | App Store "App Privacy" (nutrition label) answers per data type |
| [data-safety.md](data-safety.md) | Google Play "Data safety" answers |
| [age-rating.md](age-rating.md) | App Store age rating questionnaire and the Play IARC questionnaire (18+) |
| [app-review-notes.md](app-review-notes.md) | Review account, notes for the reviewer (premium, AI labels, report/block), submit checklist |
| `screenshots/appstore-6.9/{tr,en}/` | 8 × 1320 × 2868 JPEG (iPhone 6.9") |
| `screenshots/appstore-6.5/{tr,en}/` | 8 × 1284 × 2778 JPEG (iPhone 6.5") |
| `screenshots/play-phone/{tr,en}/` | 8 × 1080 × 1920 JPEG (Play phone) |
| `graphics/app-icon-1024.png` | App Store icon, 1024 × 1024, opaque (logo direction B) |
| `graphics/play-icon-512.png` | Play icon, 512 × 512 |
| `graphics/feature-graphic-{tr,en}.jpg` | Play feature graphic, 1024 × 500 |
| `frames/` | HTML templates + `render.sh` that produce the images above |

## URLs (droblet.alatech.co)

| Use | TR | EN |
|---|---|---|
| Marketing / support | `/` | `/en` |
| Privacy policy | `/privacy` | `/en/privacy` |
| Terms of use (EULA) | `/terms` | `/en/terms` |
| Subscription terms | `/subscription-terms` | `/en/subscription-terms` |
| Account deletion (Play) | `/delete-account` | `/en/delete-account` |

There is no `/support` page yet and the site shows the contact e-mail only when `NEXT_PUBLIC_CONTACT_EMAIL` is set —
both stores require a reachable support contact `[OWNER]`.

## Regenerating the screenshots

The screenshots are the same captures as the landing page (`landing/public/screens/`), from the showcase build with
fixture data (consistent across screens, localized in English).

```bash
# 1. Capture (see landing/scripts/capture/README.md); keep the full-size PNGs:
CAPTURE_RAW_DIR=/tmp/droblet-raw landing/scripts/capture/capture-screens.sh <capture>/mobile <iphone-17-pro-max-udid>
# 2. Frame them with captions, render the feature graphic and icons:
docs/store-listing/frames/render.sh /tmp/droblet-raw
```

Captions live in `frames/render.sh` (order, eyebrow and one short line per language). Look at every image before
uploading: no empty boxes, loading or error states, debug UI.

## Main assumptions (details in each file)

- Name "Droblet" is available in both stores; fallbacks given.
- Category Lifestyle (+ Shopping on iOS).
- 18+ rating because the app gates users at 18 and has UGC + an in-app browser.
- Data types follow the legal drafts (still "pending legal review"): body/face photos are declared as Photos, not
  biometric; weight/body data declared as Health (conservative); contacts matching treated as ephemeral (not collected);
  first-party analytics treated as not linked (pseudonymous hash). Each is flagged where it appears.
- The temporary self-premium switch stays off in production during review; the review account gets admin TEST premium.
