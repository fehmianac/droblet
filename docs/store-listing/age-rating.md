# Age rating — App Store questionnaire and Google Play (IARC)

**Recommendation: App Store 18+ (17+ on the older scale) / IARC 18 or the highest tier the answers give, and
Play target audience "18 and over".** Reason: the app itself requires users to be 18 or over (18+ confirmation at
sign-up, `docs/api/consents-age-inbox-avatar.md` §3; the terms say 18+), it has user-generated content with user
interaction (follow, public profiles, rating other people's looks), and an in-app browser that opens third-party
brand websites. Nothing in the content is mature by itself — the rating follows the audience decision, not the
content. If the owner wants a 13+/16+ listing later (a 13–18 segment is planned), the 18+ gate must change first;
lower ratings would also bring Apple's 1.2 UGC rules for minors and Play's Families rules into play.

`[ASSUMPTION]` Apple's 2025 rating scale (4+, 9+, 13+, 16+, 18+) is in effect in App Store Connect; on the old
scale the same answers give 17+.

## App Store Connect › App Information › Age Rating

| Question | Answer |
|---|---|
| Cartoon or fantasy violence | None |
| Realistic violence | None |
| Prolonged graphic or sadistic realistic violence | None |
| Profanity or crude humor | None |
| Mature or suggestive themes | None |
| Horror / fear themes | None |
| Medical or treatment information | None |
| Alcohol, tobacco or drug use or references | None |
| Simulated gambling | None |
| Sexual content or nudity | None — photos with no person, several people or nudity-like content are rejected server-side for body photos; clothing photos only `[ASSUMPTION: no nudity filter beyond the garment/person checks]` |
| Graphic sexual content and nudity | None |
| Contests | None |
| **Unrestricted web access** | **Yes** — brand checkout pages and legal pages open in the in-app browser (`expo-web-browser`) with free navigation `[ASSUMPTION: answer "No" only if the browser is locked to the brand domain]` |
| **User-generated content** | **Yes** — public/followers-only profiles, wardrobe items and looks visible to others, star ratings. No chat, no comments. |
| Messaging and chat | No |
| Advertising | No (no ad SDK; affiliate brand products are shop content, labelled "Sponsored" where paid) |
| Age assurance / parental controls | No age verification; self-declared 18+ confirmation |
| In-app purchases | Yes (subscriptions, consumable credit pack) |
| Made for Kids | No |
| **Age rating override** | Choose **18+** (the app's own minimum age) |

UGC safeguards the reviewer will look for (guideline 1.2), all present in the app:
- a way to report users/content — profile ⋯ › Şikayet et (spam, inappropriate, harassment, impersonation, minor safety, other);
- a way to block abusive users — profile ⋯ › Engelle; unblock in Ayarlar › Engellenenler;
- published contact information — `[OWNER: support e-mail must be published on the site and in the store listing]`;
- acting on reports within 24 hours — admin moderation queue (`docs/api/admin.md` §6) `[ASSUMPTION: 24 h commitment
  is the proposed value in docs/legal/REVIEW.md; note that "content removed" is only recorded today (gap G7) — the
  owner should be able to remove reported looks/items before review]`;
- a filter for objectionable material — server checks on uploaded photos (garment detection, person/age checks).
  Accepted by Apple in practice for clothing apps, but it is the weakest point `[ASSUMPTION]`.

## Google Play › Content rating (IARC questionnaire)

Category: **Reference, News, or Educational? No → "Social networking, forums, blogs and UGC" is not the main
purpose → choose "All other app types"** `[ASSUMPTION — if IARC routes UGC apps to the social category, answer the same way]`.

| Question | Answer |
|---|---|
| Violence, fear, sexuality, language, controlled substances, gambling, crude humour | No |
| Does the app allow users to interact or exchange content? | **Yes** (follow, view and rate looks) |
| Can users communicate with each other (chat/messages)? | No |
| Does the app share the user's current physical location with other users? | No |
| Does the app allow users to purchase digital goods? | Yes |
| Does the app contain or promote unrestricted internet access? | Yes (in-app browser to brand sites) |
| Is the app a web browser or search engine? | No |
| Does it contain news? | No |

Then **Policy › Target audience and content**: age groups **18 and over** only; "Appeals to children": No.
