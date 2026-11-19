# Google Play Console — store listing (TR / EN)

Paste into **Play Console → Grow → Store presence → Main store listing** (default language Turkish – tr-TR,
translation English (United Kingdom) – en-GB; copy to en-US if offered there). Play forbids prices,
rankings, "best/#1" claims and calls to action like "download now" in the title and short description.
`[ASSUMPTION]` marks a value the owner has to confirm.

## App details

| Field | Value |
|---|---|
| App name (≤ 30) | **Droblet** (7) |
| Package | `com.alatech.droplet` |
| App category | Lifestyle |
| Tags | Fashion, Personal styling, Travel & local `[ASSUMPTION — pick from Play's tag list]` |
| Contact e-mail (required, public) | `[OWNER: support address — the same one as NEXT_PUBLIC_CONTACT_EMAIL on the site]` |
| Website | `https://droblet.alatech.co/` |
| Privacy policy | `https://droblet.alatech.co/privacy` (EN `https://droblet.alatech.co/en/privacy`) |
| Account deletion URL (Data safety) | `https://droblet.alatech.co/delete-account` (EN `/en/delete-account`) |
| Ads | **No** — the app shows no ads. Brand products in the shop are catalogue content, not ad SDK inventory. |
| In-app purchases | Yes — Droblet Üyelik (monthly / yearly subscriptions) and a 20 AI image pack |

## Türkçe (tr-TR)

**Kısa açıklama (≤ 80):** `Kıyafetlerini fotoğrafla; günün kombini, stilist ve bavul listesi hazır olsun.` (77)

**Tam açıklama (≤ 4000):** App Store açıklamasının aynısı ([app-store.md](app-store.md) › Türkçe › Açıklama), şu iki
değişiklikle:
- Abonelik paragrafında "Apple Kimliği hesabından" → "Google Play hesabından", "App Store hesap ayarlarından" →
  "Google Play › Ödemeler ve abonelikler bölümünden".
- Son satırdaki bağlantılar kalabilir (Play, açıklamadaki URL'lere izin verir).

**Sürüm notları (≤ 500):** `Droblet'in ilk sürümü. Gardırobunu ekle, günün kombinini al, bir sonraki seyahatin için bavulunu hazırla.`

## English (en-GB)

**Short description (≤ 80):** `Photograph your clothes; get daily outfits, a stylist and packing lists.` (72)

**Full description (≤ 4000):** the App Store description ([app-store.md](app-store.md) › English › Description) with:
- "charged to your Apple Account" → "charged to your Google Play account"; "in your App Store account settings" →
  "in Google Play › Payments & subscriptions".

**Release notes (≤ 500):** `The first release of Droblet. Add your wardrobe, get your outfit of the day and pack for your next trip.`

## Graphics

| Asset | Requirement | File |
|---|---|---|
| App icon | 512 × 512 PNG, 32-bit allowed, ≤ 1 MB; Play applies the mask | `graphics/play-icon-512.png` |
| Feature graphic | 1024 × 500 JPEG/PNG, no alpha | `graphics/feature-graphic-tr.jpg`, `graphics/feature-graphic-en.jpg` |
| Phone screenshots | 2–8, 16:9 or 9:16, each side 320–3840 px | `screenshots/play-phone/{tr,en}/` (1080 × 1920, 8 each) |
| 7" / 10" tablet screenshots | Only if the app is offered for tablets | not made — the app is phone-only `[ASSUMPTION: no tablet layout; set "Phone" only in device catalogue]` |

## Other Play Console declarations (Policy → App content)

| Declaration | Answer |
|---|---|
| Privacy policy | URL above |
| Ads | No ads |
| App access | Restricted: needs an account. Give the review credentials from [app-review-notes.md](app-review-notes.md) and the steps to reach member features. |
| Content rating (IARC) | See [age-rating.md](age-rating.md) |
| Target audience | 18 and over only (the app has an 18+ gate) — not designed for children; not in Designed for Families |
| News app | No |
| COVID-19 apps | No |
| Data safety | See [data-safety.md](data-safety.md) |
| Government app | No |
| Financial features | None |
| Health apps | No — height/weight/body type are styling inputs, not health features `[ASSUMPTION]` |
| Photo and video permissions | Photo picker (Android 13+ system picker) for clothes, body and face photos; no broad `READ_MEDIA_IMAGES` declaration needed if only the picker is used `[ASSUMPTION — check the merged AndroidManifest]` |
| Contacts permission | Optional "Find friends from contacts" — needs the prominent disclosure + consent screen the app already shows (contacts are hashed on the device, docs/privacy/contacts-matching.md) |
