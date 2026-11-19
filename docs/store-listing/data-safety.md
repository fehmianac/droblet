# Google Play Console — Data safety answers

Same sources as [app-privacy.md](app-privacy.md). Play's definitions: **collected** = sent off the device;
**shared** = transferred to a third party, *except* service providers processing for the developer, legal
requests, or a transfer the user initiates. Ephemeral processing (in memory, only to serve the request) may be
marked as not collected. `[ASSUMPTION]` = to confirm.

## Overview questions

| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by the app encrypted in transit? | **Yes** (TLS everywhere) |
| Do you provide a way for users to request that their data be deleted? | **Yes** — in the app (Gizlilik ve ayarlar › Hesabımı sil) and at `https://droblet.alatech.co/delete-account` |
| Account creation methods | Username/e-mail and password; Sign in with Google (and Apple on iOS) |
| Delete account URL | `https://droblet.alatech.co/delete-account` (EN `/en/delete-account`) |
| Independent security review (MASA) | No |
| Committed to Play Families Policy | Not applicable (18+) |

## Data types

"Shared" is **No** for every row: AWS, OpenAI, SendGrid, Google FCM, Open-Meteo and Cloudflare are service providers
under contract `[ASSUMPTION — OpenAI DPA still to be signed, REVIEW G10]`. The affiliate network receives only a click
ID, not user data. "Processed ephemerally" is No unless noted.

| Category › type | Collected | Required / optional | Purposes | Notes |
|---|---|---|---|---|
| Location › Approximate location | Yes | Optional | App functionality, Personalization | City chosen for weather; trip cities. No location permission. |
| Location › Precise location | No | | | |
| Personal info › Name | Yes | Required | App functionality, Account management | Display name, @handle |
| Personal info › Email address | Yes | Required | App functionality, Account management | Sign-in, password reset |
| Personal info › User IDs | Yes | Required | App functionality, Account management | Account ID, Google/Apple subject |
| Personal info › Address, Phone, Race/ethnicity, Political or religious beliefs, Sexual orientation | No | | | |
| Personal info › Other info | Yes | Required | App functionality | 18+ confirmation, consent records, language, time zone, closet visibility |
| Financial info › Purchase history | Yes | Optional | App functionality | Subscription/credit status, Play order IDs; brand orders reported back for a click ID (commission, "Add to wardrobe?") `[ASSUMPTION]` |
| Financial info › Payment info, Credit score, Other | No | | | Payment is handled by Google Play / the brand site |
| Health and fitness › Health info | Yes `[ASSUMPTION]` | Optional | App functionality, Personalization | Optional weight (explicit consent), height, size, body type — styling only, never sent to AI except body type/height/size on the face path |
| Health and fitness › Fitness info | No | | | |
| Messages (emails, SMS, other in-app messages) | No | | | No chat |
| Photos and videos › Photos | Yes | Optional | App functionality, Personalization | Clothing, full-body and face photos (explicit consents), AI try-on images, avatar; OpenAI processes them as a provider |
| Photos and videos › Videos | No | | | |
| Audio files | No | | | |
| Files and docs | No | | | |
| Calendar | No | | | The app's own outfit calendar is user content, not the device calendar |
| Contacts | Yes, **processed ephemerally** `[ASSUMPTION]` | Optional | App functionality | E-mail addresses hashed on the device (salted SHA-256); hashes matched in memory, not stored or logged. If you prefer the strict reading, declare Collected: Yes, not ephemeral. |
| App activity › App interactions | Yes | Required (automatic) | Analytics | First-party allow-listed events, pseudonymous actor hash, no third-party SDK |
| App activity › In-app search history | No | | | |
| App activity › Installed apps | No | | | |
| App activity › Other user-generated content | Yes | Optional | App functionality, Personalization | Wardrobe items, looks, trips, stylist requests, ratings, reports, cart, watchlist |
| App activity › Other actions | No | | | |
| Web browsing › Web browsing history | No | | | |
| App info and performance › Crash logs | No | | | No crash SDK |
| App info and performance › Diagnostics | Yes | Required (automatic) | App functionality (security / fraud prevention) | Server logs: IP, timings, errors |
| App info and performance › Other app performance data | No | | | |
| Device or other IDs | Yes | Optional | App functionality | App-generated device ID and FCM token (push); no advertising ID |

## Notes

- **Data deletion:** account deletion removes the data immediately; database backups roll off within 30 days; pseudonymous
  analytics events are kept 400 days (REVIEW G9 — say so in the privacy notice before launch or delete them with the account).
- **Advertising ID:** not used. Make sure the merged manifest has no `com.google.android.gms.permission.AD_ID`
  (add `tools:node="remove"` if a library brings it) and answer "No" in the Advertising ID declaration `[ASSUMPTION — check the release AAB]`.
- **Android permissions to justify:** CAMERA, POST_NOTIFICATIONS, READ_CONTACTS (optional, after the in-app consent).
