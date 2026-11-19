# Droblet legal texts — review checklist (owner → lawyer)

Status: **comprehensive drafts, not approved**. Written by Claude on 2026-11-19 from the product handoff, the team guides,
the API contracts and the code (owner decision 18: Claude drafts → owner reviews → lawyer approves). Nothing here is
legal advice; every `[HUKUK ONAYI: …]` / `[LEGAL REVIEW: …]` marker in the texts is a question for the lawyer, and every
other `[…]` is a fact the owner still has to supply.

## 1. What exists and where

| Document | TR | EN | Site (TR · EN) |
|---|---|---|---|
| Kullanım Koşulları / Terms of Use | [tr/terms.md](tr/terms.md) | [en/terms.md](en/terms.md) | `/terms/` · `/en/terms/` |
| Gizlilik Politikası / Privacy Policy (UK GDPR style) | [tr/privacy.md](tr/privacy.md) | [en/privacy.md](en/privacy.md) | `/privacy/` · `/en/privacy/` |
| KVKK Aydınlatma Metni (TR original, EN courtesy translation) | [tr/kvkk.md](tr/kvkk.md) | [en/kvkk.md](en/kvkk.md) | `/kvkk/` · `/en/kvkk/` |
| Açık Rıza Metinleri / Consent Texts (6 separate short texts) | [tr/consents.md](tr/consents.md) | [en/consents.md](en/consents.md) | `/consents/` · `/en/consents/` |
| Abonelik Koşulları / Subscription Terms | [tr/subscription-terms.md](tr/subscription-terms.md) | [en/subscription-terms.md](en/subscription-terms.md) | `/subscription-terms/` · `/en/subscription-terms/` |
| Çerez Bildirimi / Cookie Notice | [tr/cookies.md](tr/cookies.md) | [en/cookies.md](en/cookies.md) | `/cookies/` · `/en/cookies/` |
| Topluluk Kuralları / Community Guidelines | [tr/community-guidelines.md](tr/community-guidelines.md) | [en/community-guidelines.md](en/community-guidelines.md) | `/community-guidelines/` · `/en/community-guidelines/` |

**Source of truth is the site dictionary**, `landing/content/{tr,en}.json` → `legal`. The Markdown files are generated
from it (`cd landing && npm run legal:md`) and `npm run check` fails when they drift. Mark up the Markdown (or a Word copy)
freely; the accepted wording is then typed into the dictionary and the Markdown regenerated. Paragraphs starting with
`- ` render as list items. Each page shows a summary box ("KISACA" / "IN SHORT"), the draft banner, and is `noindex`.

The consent texts are written so the app can show each one on its own screen (purpose · data · who/where · how long ·
if you say no · the statement to tick). They are deliberately **separate** from the KVKK notice (KVKK Aydınlatma
Tebliği: information and consent must not be bundled).

## 2. Placeholders the owner must fill (17)

Same placeholder in both languages; the EN spelling is in brackets. Count = occurrences per language.

| # | Placeholder | Where | Count | Notes / proposal |
|---|---|---|---|---|
| 1 | `[İLETİŞİM E-POSTASI]` (`[CONTACT E-MAIL]`) | every page | 21 | One monitored address for privacy, KVKK and support (e.g. `privacy@…` / `destek@…`). Also set `NEXT_PUBLIC_CONTACT_EMAIL` so the footer shows it. App Store 1.2 needs a published contact. |
| 2 | `[ŞİRKET ADRESİ]` (`[COMPANY ADDRESS]`) | every page (controller line), terms, privacy, kvkk | 8 | Registered office of Droblet Ltd. |
| 3 | `[ŞİRKET NUMARASI]` (`[COMPANY NUMBER]`) | every page, terms, privacy, kvkk | 4 | Companies House number. Draft assumes England and Wales registration — confirm. |
| 4 | `[YÜRÜRLÜK TARİHİ]` (`[EFFECTIVE DATE]`) | every page (version line) | 1 | Set when approved. |
| 5 | `[TÜRKİYE TEMSİLCİSİ]` (`[TÜRKİYE REPRESENTATIVE]`) | privacy, kvkk | 3 | KVKK data controller representative for a foreign controller (see Q7). |
| 6 | `[VERBİS KAYIT DURUMU]` (`[VERBIS REGISTRATION STATUS]`) | kvkk | 1 | Registration number/date, or the exemption relied on (see Q7). |
| 7 | `[KEP ADRESİ]` (`[KEP ADDRESS]`) | kvkk | 2 | Registered e-mail for KVKK applications; usually via the Turkish representative. Delete the sentence if none. |
| 8 | `[ICO KAYIT NUMARASI]` (`[ICO REGISTRATION NUMBER]`) | privacy | 1 | UK data protection fee registration (ZA…). |
| 9 | `[YURT DIŞI AKTARIM MEKANİZMASI]` (`[TRANSFER MECHANISM]`) | privacy, kvkk | 2 | See Q3. |
| 10 | `[OPENAI SAKLAMA SÜRESİ]` (`[OPENAI RETENTION]`) | privacy | 1 | From OpenAI's DPA / account settings (standard API abuse-monitoring retention, or zero data retention if granted). The code does not set any `store`/retention option on its calls — confirm the account-level setting. |
| 11 | `[LOG SAKLAMA SÜRESİ]` (`[LOG RETENTION]`) | privacy, kvkk | 2 | **No CloudWatch log retention is set in `template.yaml`** → logs are kept forever by default. Decide (proposal: 30–90 days) and set `RetentionInDays` on every log group. |
| 12 | `[ŞİKAYET KAYDI SAKLAMA SÜRESİ]` (`[REPORT RETENTION]`) | privacy, kvkk | 2 | `ReportEntity` has **no TTL** → kept until the reported account is deleted. Proposal: resolved reports 12 months, longer only for suspensions/legal holds. |
| 13 | `[AFFILIATE KAYIT SAKLAMA SÜRESİ]` (`[AFFILIATE RECORD RETENTION]`) | privacy, kvkk | 2 | Click/conversion entities have **no TTL**; the user link is removed on account deletion. Proposal: user link 13 months, anonymous revenue rows as long as accounting needs (UK: 6 years). |
| 14 | `[MODERASYON YANIT SÜRESİ]` (`[MODERATION RESPONSE TIME]`) | community guidelines | 2 | Apple expects reports to be acted on "in a timely manner"; proposal **24 hours**. Must be staffed. |
| 15 | `[DEĞİŞİKLİK BİLDİRİM SÜRESİ]` (`[CHANGE NOTICE PERIOD]`) | terms, subscription terms | 2 | Proposal 30 days. |
| 16 | `[UYGULANACAK HUKUK VE YETKİLİ MAHKEME]` (`[GOVERNING LAW AND COURTS]`) | terms | 1 | See Q10. |
| 17 | `[CLOUDFLARE ÇEREZLERİ]` (`[CLOUDFLARE COOKIES]`) | cookies | 2 | Check the zone: Bot Fight Mode / Bot Management sets `__cf_bm` (30 min); challenges set `cf_clearance`. List what is actually set, or write "none". |

Lawyer markers: 18 distinct `[HUKUK ONAYI: …]` / `[LEGAL REVIEW: …]` notes (they map to the questions in §4). All
placeholders and markers must be gone before the banner is removed — a quick `grep -o '\[[^]]*\]' landing/content/*.json`
shows what is left.

## 3. Assumptions made while drafting (owner to confirm)

Facts taken from the handoff and code — confirm or correct:

1. **Controller** is Droblet Ltd, London, registered in England and Wales; no other group company processes data.
2. **18+ only** in phase 1 (women). There is currently **no age confirmation in sign-up** (no birth date, no checkbox); the terms say "by creating an account you confirm you are over 18" — see gap G3.
3. **AI provider is OpenAI only** (text `gpt-6-astra`, image `gpt-image-2.5-sunburst`, garment vision, background removal). Calls only from the server; height and weight never sent; prompts tell the model not to identify/describe the person or comment on body/health. No other AI vendor (the brief's Gemini was replaced).
4. **Hosting** AWS eu-central-1 (DynamoDB, S3, Lambda, SQS); photo bucket private, SSE, TLS-only, **versioning off**, raw uploads expire after 1 day; DynamoDB PITR **30 days on prod** (none on dev) → the "out of backups within 30 days" promise.
5. **E-mail**: SendGrid sends only password reset e-mails to app users (admin codes go to staff only). No marketing e-mail, no SMS.
6. **Push**: APNs directly for iOS, FCM for Android. Default on after the first device registration: morning outfit + weekly edit; off: friend ratings, price drop, follow requests (decision 9).
7. **Weather**: Open-Meteo, city chosen in the profile; the app does not request device location (the API accepts coordinates, rounded to 0.1°, but the app does not send them). No user identifier goes to Open-Meteo.
8. **Affiliate**: Admitad, Gelir Ortakları (ReklamAction — assumed a Turkish company) and direct brand deals; only a `click_id` goes out; postbacks return order id, amount, currency, status; commission 7–12 %; 48 h auto-add to watch list.
9. **Analytics**: own pipeline only, actor = one-way hash, no free text, 400-day TTL; rows are **not** deleted on account deletion (treated as pseudonymous).
10. **Contacts matching**: as in `docs/privacy/contacts-matching.md` (salted hashes, nothing stored, 10/day, e-mail only).
11. **Social**: visibility default "Followers only"; ratings anonymous to the owner; report reasons spam / inappropriate / harassment / impersonation / minor safety / other, note ≤ 500 chars, 20 reports/day; outcomes dismissed / content removed / user warned / user suspended. No comments or DMs.
12. **Subscriptions**: monthly + yearly in group "Droblet Üyelik", store-configured free trial (currently 1 week), 30 AI images per subscription month, non-rollover, consumable 20-credit pack usable only while premium (try-on requires premium), refunded pack credits removed, data kept after expiry, free tier = 10 AI recognitions. Prices are never in the texts — "shown in the store".
13. **Website**: sets no cookies, no web storage, no analytics, self-hosted fonts (verified in `landing/src`); the delete-account token is held in React state only.
14. "We do not use your content to train AI models" and "we do not sell your data" are written as Droblet promises — true for the current code; keep them only if the business is happy to be bound.
15. "Moderators cannot see body/face photos or generated images" — true for the admin API (`AdminAppUserDetailDto` excludes them).

## 4. Questions for the lawyer

### Q1. Face photo — biometric data?
We **do not** identify, verify or recognise anyone and extract/store **no template**; the face photo is sent to OpenAI only to pick a colour season; the prompt forbids identifying or describing the person. Under UK GDPR art. 4(14) / recital 51 a photo is biometric data only when processed "through specific technical processing allowing or confirming unique identification"; the KVKK Board's guidance is similar. The drafts state: *we consider this not biometric processing, but we ask for explicit consent anyway.* Please confirm (a) the wording, (b) whether the try-on output — which reproduces the face — changes the analysis, (c) whether OpenAI's processing of the face (any internal face detection, `facesDetected` count) matters.

### Q1a. New purpose — face photo used to build the try-on figure (consent 7, `facePhotoTryOn`) — added 2026-11-19
Owner decision (canvas 11): when a user has no full-body photo, "Üzerimde gör" can build a figure from the **face photo** +
a chosen **body type** (hourglass, pear, apple, rectangle, inverted triangle, unsure) + height and size. This is a new
purpose for the face photo, so it has its **own** explicit consent (consent 7, `/consents` §7, TR + EN, version
`2026-11-19`), separate from the palette consent (2); it is sent together with consent 6 (OpenAI, US). Privacy §3–5, KVKK
§2–3 and Terms §2 were updated to name the purpose. The image model is told to keep the same adult with the identity
unchanged, fully clothed; a server-side photo check rejects photos with no / several faces and photos that appear to show
a minor. Deleting the face photo withdraws consents 2 and 7 and removes the face-path images. Please approve (a) the text
of consent 7, (b) whether generating a full-body image from a face (a synthetic likeness) changes the Q1 biometric
analysis, (c) whether body type counts as special-category / health-related data (we think not: self-chosen silhouette,
no measurement, never sent with weight).

### Q1b. All consents on one onboarding screen with "Tümünü kabul et" — added 2026-11-19
Owner decision: the seven consents are presented together once, in onboarding (existing accounts: once on next app open),
each with its **own unticked box**, a one-line summary and "Metnin tamamı"; a primary "Tümünü kabul et" button ticks every
box and continues, "Seçtiklerimle devam et" saves a partial choice (unticked boxes are recorded as declined, source
`onboarding`). Just-in-time sheets remain only when a needed consent was declined; Ayarlar › Gizlilik keeps withdrawal.
We believe per-purpose boxes keep each consent specific; please confirm that an "accept all" button on that screen is
acceptable under KVKK (Board guidance on bundled consent) and UK GDPR art. 7 / ICO guidance, and whether the button must be
visually equal to the partial option. `/consents` intro, summary and §0 were updated to describe this.

### Q2. Lawful basis per processing (explicit consent vs contract vs legitimate interest)
Proposed matrix (privacy §5, KVKK §4):

| Processing | UK GDPR | KVKK |
|---|---|---|
| Account, wardrobe, looks, plans, trips, social, shop | contract 6(1)(b) | 5/2-c |
| Body photo → try-on; face photo → palette | explicit consent 6(1)(a) (+9(2)(a) if special) | açık rıza 5/1 (+6 if special) |
| Weight (optional) | explicit consent | açık rıza — is weight "sağlık verisi"? |
| Height, size | contract | 5/2-c |
| AI item recognition / background removal / stylist text | contract | 5/2-c — is sending item photos to OpenAI abroad still "contract" under KVKK, given the transfer rules (Q3)? |
| Contacts matching (uploader / the contacts) | consent / legitimate interest | açık rıza / meşru menfaat |
| Affiliate click ↔ order matching, auto watch-list add | legitimate interest | 5/2-f |
| Own analytics (hashed actor) | legitimate interest | 5/2-f — or anonymous data outside KVKK? |
| Security, rate limits, moderation | legitimate interest / legal obligation | 5/2-f, 5/2-ç |
| Weekly edit, price-drop pushes | consent | açık rıza + 6563 (Q8) |

Also: a **DPIA** is very likely required under UK GDPR art. 35 (body and face images + AI + new technology) — should one be written before launch?

### Q3. Cross-border transfers
Data leaves Türkiye to the UK (controller), Germany (AWS) and the US (OpenAI, Twilio SendGrid, Google/Firebase, Apple, Cloudflare); Admitad and Open-Meteo countries to be confirmed.
- **KVKK art. 9 (as amended by Law 7499, in force 1 June 2024)**: no adequacy decisions exist; appropriate safeguards = Board standard contracts notified to the Authority within 5 business days, BCRs, or undertakings; explicit consent is now only for *incidental* transfers. Which module applies to each vendor (controller→processor), who signs (Droblet Ltd as a foreign controller), and do we notify? The drafted "Consent 6" is written as a fallback for incidental transfers only — keep, reword or delete?
- **UK GDPR**: UK→EU via adequacy regulations; UK→US via the UK–US data bridge (is each vendor certified?) or IDTA / UK Addendum. Fill `[TRANSFER MECHANISM]`.
- Should SendGrid use its EU data residency (`Email:BaseUrl = https://api.eu.sendgrid.com`, supported in code) to reduce US transfers?
- OpenAI: contracting entity (OpenAI Ireland Ltd for UK/EEA?), DPA signed?, zero data retention for image endpoints?

### Q4. Is Droblet Ltd's own processing "abroad"?
Droblet is a UK company serving Turkish users. Does KVKK treat the collection by Droblet Ltd itself as a transfer abroad, and what does that mean for VERBİS and the representative (Q7)?

### Q5. Retention periods
Approve the periods in privacy §13 (most come from code TTLs) and fill the four open ones (logs, reports, affiliate, OpenAI). Under KVKK a **"kişisel veri saklama ve imha politikası"** is required when VERBİS registration is required — needed? Retention of consent records (drafted: until account deletion). Should analytics rows (hashed actor) be deleted on account deletion rather than kept 400 days?

### Q6. Minors
Phase 1 is 18+, enforced only by a statement in the terms. Is a self-declaration at sign-up (checkbox or birth date) needed for KVKK/UK GDPR and the store age rating? The planned 13–18 segment (phase 1b, parent account) will need parental consent (UK GDPR art. 8: 13; KVKK: parent/guardian consent for minors' explicit consent), the UK Age Appropriate Design Code, and a fresh review of photo/AI/social features for teens — out of scope for these drafts.

### Q7. VERBİS and Türkiye representative
Foreign controllers processing data of people in Türkiye must register in VERBİS (no small-business exemption for foreign controllers) and appoint a representative (legal entity resident in Türkiye or Turkish-citizen individual). Confirm and fill placeholders 5–7.

### Q8. Marketing notifications
- Weekly edit and price-drop pushes contain products and offers. Are push notifications "ticari elektronik ileti" under Law 6563 / the e-commerce regulation (consent, İYS registration as service provider)? Under UK PECR push is not "electronic mail", but UK GDPR consent/legitimate interest still applies.
- **Conflict**: decision 9 turns the weekly edit **on by default** once push is allowed; the drafts promise a separate consent. Either change the default (off until Consent 5) or reword. See gap G2.

### Q9. Consumer law — withdrawal and subscriptions
- **Türkiye**: Mesafeli Sözleşmeler Yönetmeliği art. 15/1-ğ exemption for instantly performed electronic services / instantly delivered intangible goods — does it cover the subscription (a continuing service) and the credit packs? Is the trader Droblet or Apple/Google (merchant of record)? Pre-contractual information duties (Ön Bilgilendirme Formu) when the store sells? Tüketici Hakem Heyeti thresholds wording.
- **UK**: CCRs 2013 reg. 36/37 (digital content: express request + acknowledgement; services: proportionate payment) — the store purchase flow does not capture our own acknowledgement; is the store's flow enough? **DMCC Act 2024 Part 4 Chapter 2 subscription contract rules** (pre-contract information, reminder notices before trial ends/renewal, easy exit, cooling-off on renewal of long contracts) — commencement date and what Droblet must add on top of Apple/Google.
- Pack credits usable only while subscribed, and not expiring: acceptable as disclosed? Must this be shown on the pack purchase sheet?
- Liability cap (12 months' fees) and "as is" — enforceable against consumers in TR (TBK 115, TKHK unfair terms) and UK (CRA 2015 Part 2)?

### Q10. Governing law and jurisdiction
Options: English law with mandatory consumer protections preserved (drafted shape), or Turkish law for Turkish users. Which, and which courts? Do we need an ODR/ADR statement?

### Q11. Affiliate disclosure
Terms §9, privacy §8 and the summary disclose commission ("does not change your price") and a "Sponsored" label. Is that enough under Turkish advertising rules (Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği, Reklam Kurulu influencer guidance) and UK CAP Code / CMA guidance? Should affiliate links carry a visible marker in the shop UI itself?

### Q12. Intellectual property and AI output
Who owns try-on images and AI text (drafted: yours; licence to us only to run the service)? Brand product images used in try-on and the catalogue — licence from brands/networks? Library images generated with GPT Image — any disclosure needed? Labelling of AI-generated images ("Senin üzerinde" label) — enough?

### Q13. UK Online Safety Act 2023 / Turkish Law 5651
Droblet is a user-to-user service (profiles, item images, looks, ratings visible to others). If it has UK users, OSA duties may apply (illegal content risk assessment, children's access assessment, reporting and complaints). In Türkiye, Law 5651 obligations for social network providers start at 1 million daily accesses. Confirm what applies at launch.

### Q14. App Store / Google Play policy items
- **Apple 5.1.1(v)** in-app account deletion: done (app + web), Apple token revocation implemented (needs the `.p8` key, store-setup §2.1).
- **Apple 1.2 UGC**: report, block, published contact, timely action — drafted; also "a method for filtering objectionable material" — is relying on reports + garment-only AI classification enough? (gap G7)
- **Apple 3.1.2** auto-renewing subscriptions: paywall must show title, length, price, per-unit price where relevant, and **functional links to Terms of Use (EULA) and Privacy Policy** in the app and in App Store Connect metadata. Decide: custom EULA (the Terms, with the Apple-required clauses in §18) or Apple's standard EULA.
- **Apple 5.1.2(vi)/5.1.1**: photos and face data — App Privacy "nutrition label" must match privacy §3 (contact info, user content incl. photos, identifiers, purchases, usage data; "not used for tracking").
- **Google Play**: Data safety form consistent with the policy; account deletion URL `https://droblet.alatech.co/delete-account/`; UGC policy (moderation, reporting, blocking, terms acceptance before posting); Families policy not applicable at 18+.
- Age rating questionnaires (IARC / Apple) with UGC = yes.

### Q15. Other points to confirm
- England and Wales registration; DPO not appointed (we think not mandatory — confirm).
- Open-Meteo: its free API is licensed for **non-commercial** use; a commercial plan or another provider is needed before launch (owner decision 6 already says "decide again before launch").
- KVKK Cookie Guidelines: Cloudflare security cookies as strictly necessary — fine?

## 5. Gaps between the texts and the product (engineering / product backlog)

The texts describe the intended behaviour; these items are not (fully) built yet. Either build them before launch or
change the text.

| # | Gap | Text that depends on it |
|---|---|---|
| G1 | ~~No consent screens~~ **Implemented (2026-11-19):** just-in-time consent screens with the exact texts of `/consents` (TR + EN) before the first body photo / try-on (consent 1 + 6), face photo / palette (2 + 6), weight (3), contacts (4, mapped onto the existing screen) and the weekly-edit / price-drop opt-in (5); the server answers `403 consent_required` without them (docs/api/consents-age-inbox-avatar.md). Open: consent 6 is asked only with the photo features — garment recognition and the stylist also call OpenAI (US) without it; decide whether they need it too (Q3). | Consents 1, 2, 3, 5; privacy §4–5; KVKK §4 |
| G1a | **Implemented (2026-11-19):** the all-in-one onboarding consent step (Q1b) and consent 7 `facePhotoTryOn` (Q1a); the try-on endpoints ask for the consents of the path actually used (body photo → 1 + 6, face photo only → 7 + 6). Texts pending lawyer approval. | Consents intro, §0, §7; privacy §3–5; KVKK §2–3; terms §2 |
| G2 | ~~Weekly edit push defaults on~~ **Implemented:** the weekly edit (and price drops) start **off** and need Consent 5; one opt-in card after onboarding and in Bildirimler; the Notifier re-checks the consent before sending. The morning outfit reminder stays a service notification (default on). | Consent 5; privacy §16 |
| G3 | ~~No age confirmation~~ **Implemented:** required "18 yaşından büyüğüm / I am 18 or older" box on e-mail sign-up and a one-time confirmation after the first Apple / Google sign-in, stored as `ageConfirmedAt`; unconfirmed accounts see the confirmation before anything else. Self-declaration only (no age verification) — confirm with Q6. | Terms §3; privacy §17 |
| G4 | ~~No server-side consent record~~ **Implemented:** per-user records `{ type, granted, version, grantedAt, withdrawnAt, locale, source }` plus an append-only audit log; text versions come from config (`Consents:Versions`), a new version re-prompts. Kept until account deletion (deleted with the account). ~~No data-export (portability) endpoint~~ **Implemented (2026-11-19):** Ayarlar › Gizlilik › "Verilerimi indir" (`POST/GET v1/tenant/export`, docs/api/verification-export.md §2) builds a ZIP with every stored record of the account as JSON (consents and their audit log included) plus the user's own photos and generated images; the link arrives by e-mail and in Bildirimler and works for 7 days; one active export, one per day. Privacy §13 / §15 and KVKK §7 / §9 describe it (how to request, format, time). | Consents §1; privacy §15; KVKK §9 |
| G5 | **Mostly implemented:** Ayarlar › Gizlilik lists every consent with on/off and its date; withdrawing a photo consent offers to delete the photo and generated images; withdrawing weight clears it; withdrawing marketing switches those pushes off; deleting a photo counts as withdrawal (as the text says). Still open: a "do not match me" switch for contact matching (others can still find the user by e-mail hash). | Consents §8; privacy §7 |
| G6 | ~~No retention~~ **Implemented defaults** (lawyer to confirm): Lambda log retention, TTLs on resolved reports and unconverted affiliate clicks — see §5a. Conversions / revenue ledger still have no period. | Privacy §13; KVKK §7 |
| G7 | No automated objectionable-content filter on item photos beyond AI garment detection; "content removed" is a recorded resolution — confirm the admin action really removes/hides the item or look. | Community guidelines §8; Apple 1.2 |
| G8 | Paywall: check the subscription terms link and the 24-hour auto-renew disclosure; mobile `LegalLinks` currently links Terms and Privacy only. | Subscription terms |
| G9 | Analytics rows survive account deletion (hashed actor). | Privacy §9, §14 |
| G10 | OpenAI data retention / ZDR not configured in code; confirm at account level. | Privacy §6 |
| G11 | Footer contact link appears only when `NEXT_PUBLIC_CONTACT_EMAIL` is set. | All pages |
| G12 | ~~Unverified e-mail sign-ups could be matched by contacts~~ **Implemented (2026-11-19):** e-mail sign-ups get a 6-digit code + link (24 h); only a verified address (code / link, a completed password reset, or Apple / Google saying it is verified) enters the contact-matching directory. Unverified accounts can use the app; nothing else is blocked. | Privacy §7; consents §4 |

## 5a. Retention — implemented defaults, lawyer to confirm

Every period below is what the code and `template.yaml` do **today** (2026-11-19). They are engineering defaults chosen to
close G6, not legal decisions: the lawyer confirms or changes each one (Q5), and privacy §13 / KVKK §7 must then match
this table. "Account deletion" = `DELETE v1/auth/me`, which removes every tenant partition and S3 prefix immediately,
whatever the period.

| Data | Period | Where it is enforced |
|---|---|---|
| **Lambda logs** (every function: Api, ItemProcessor, Stylist, TryOn, Palette, four Notifier jobs) | **90 days on dev, 400 days on prod** (stack parameter `LogRetentionDays`, 0 = these defaults) | `template.yaml` → one `AWS::Logs::LogGroup` per function (`/droblet/{stage}/lambda/{fn}`) with `RetentionInDays`, wired through `LoggingConfig`. The old auto-created `/aws/lambda/droblet-{stage}-{fn}` groups keep their history without retention until deleted by hand after the deploy (see the template comment). Logs never contain prompts, photos, image URLs or e-mail addresses. |
| **Reports** (moderation record + the reporter's and the reported person's pointers) | Open: until resolved. Resolved: **2 years after resolution** | DynamoDB TTL `ReportRetention` (`ReportEntity`, `ReportFiledEntity`, `ReportReceivedEntity`), set on resolve. Reports about a deleted account are removed with it; a deleted reporter is removed from the report. |
| **Affiliate clicks not linked to a conversion** (the user's click row + the global click index) | **13 months after the click** | DynamoDB TTL `AffiliateClickRetention`; a conversion postback removes the TTL from both rows. |
| Affiliate conversions and the revenue ledger | No period (financial / commission records; the ledger loses the person on account deletion) | — · *lawyer: tax / commercial retention period?* |
| Anonymous click ledger (brand, source, network, click id; no user id) | No period (revenue report) | — · *after 13 months the click id no longer resolves to a person* |
| Analytics events (salted hash of the account, allow-listed properties) | 400 days | DynamoDB TTL (`AnalyticsEventEntity`); survive account deletion (G9) |
| AI jobs (inputs / results of stylist, try-on, palette, item jobs) | 7 days | DynamoDB TTL (`JobEntity`, `ItemDraftEntity`) |
| Credit reservations and ledger entries | 400 days | DynamoDB TTL |
| Stylist "Beğenmedim" feedback | 400 days | DynamoDB TTL |
| In-app notification inbox (Bildirimler: ids only — day, edit id, product id, requester handle) | 90 days | DynamoDB TTL (`NotificationInboxEntity`); a deleted account's follow-request row is removed from the other person's inbox |
| Consent records and their audit log (type, granted / withdrawn, text version, time, locale, source) | until account deletion (legal text: consents §1) | account deletion · *lawyer: keep a minimal proof after deletion?* |
| Data export ZIP ("Verilerimi indir") | **7 days** (the request row 30 days) | S3 lifecycle rule `expire-data-exports` on `exports/` of the photo bucket; DynamoDB TTL (`DataExportEntity`, `DataExportTokenEntity`); removed with the account |
| E-mail verification code / link (hashes only) | 24 hours | DynamoDB TTL (`EmailVerificationEntity`, `EmailVerificationTokenEntity`); removed with the account |
| Push send receipts | 14 days | DynamoDB TTL (`NotificationSentEntity`); queued events 3 days, rating digest markers 3 days |
| Offline-sync mutation receipts | 30 days | DynamoDB TTL |
| Uploads not yet confirmed (photos, garment photos) | 1 day | S3 lifecycle `uploads/tmp/` + DynamoDB TTL on the upload slots |
| Contact-matching salt | ≤ 10 minutes, deleted on use; hashes never stored | DynamoDB TTL (`ContactSaltEntity`) |
| Watch-list auto-add candidates / "removed by me" markers | due date + 7 days / 30 days | DynamoDB TTL |
| App Store / Play notification receipts | 90 days | DynamoDB TTL |
| Refresh tokens, password-reset tokens, admin sign-in codes / tokens | until they expire (admin codes + 1 day) | DynamoDB TTL |
| Weather cache | short-lived cache | DynamoDB TTL |
| Account data, wardrobe, looks, photos, generated images, profile picture, 18+ confirmation time | until the user deletes them or the account | account deletion |

Rows written before these TTLs existed (dev data only; prod has no users yet) keep no expiry; nothing back-fills them.

## 6. Going live (after approval)

1. Replace every placeholder and lawyer marker in `landing/content/{tr,en}.json` → `legal`; `npm run legal:md`.
2. Remove the draft banner (`legal.draftBadge/draftTitle/draftBody` and the `<aside>` in `src/components/LegalPage.tsx`), set `index: true` in `legalMetadata`, add the seven legal routes to `src/app/sitemap.ts`, and relax the draft/noindex assertions in `scripts/check.mjs`.
3. Set `version` to the approved version and effective date; keep old versions (git tag) — consent records refer to text versions.
4. Put the URLs into App Store Connect (Privacy Policy URL, EULA/Terms), Play Console (privacy policy, account deletion URL), and the app (`legalUrls()` in mobile).
5. Close gaps G1–G11 or align the texts.
