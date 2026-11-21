# Minors' data — KVKK / Turkish Civil Code / UK GDPR / Children's Code — analysis notes (teen mode, 16–17)

> **DRAFT ANALYSIS NOTES — NOT LEGAL ADVICE, NOT APPROVED, NOT PUBLISHED.** Written by Claude on 2026-11-21 for the
> lawyer, from `docs/api/teen.md` and the existing drafts. Article numbers were checked only against secondary sources
> unless stated; every point carries a `[HUKUK ONAYI: …]` / `[LEGAL REVIEW: …]` marker and maps to the questions in
> `docs/legal/REVIEW.md` §4 (Q17–Q23). Part 1 is in Turkish (Turkish law), Part 2 in English (UK/EU law).

## 0. Facts the analysis rests on (from `docs/api/teen.md`)

- Ages 16–17 only; under 16 refused and nothing stored. Self-declared birth year (+ month when ambiguous); only age band
  and birth year/month stored. No age verification.
- Before parental approval ("limited mode"): no photo uploads and no AI calls; manual wardrobe / library / looks / plans
  work. **So some personal data of the teen (account, wardrobe, e-mail) is processed before any parental consent**, on
  the teen's own contract/acceptance.
- Parent consent: e-mail link (SendGrid), signed token valid 7 days; three ticks (parent/guardian · read notice · agree to
  processing) + separate optional try-on tick; record = event, time, SHA-256(parent e-mail), SHA-256(IP), text version.
  Withdrawal any time → photo features off and personal photos deleted.
- Teen restrictions: no social, no commerce/affiliate, free tier only, no Firebase or first-party analytics, no marketing,
  age-appropriate stylist prompt, outfit-photo try-on off, virtual try-on gated (flag OFF + parent tick + teen consent).
- Personal photos deleted after 90 days' inactivity; at 18 → adult, parent e-mail deleted.
- Processors: AWS (eu-central-1), Twilio SendGrid (US), OpenAI (US). Controller Droblet Ltd (England & Wales), users
  mainly in Türkiye.

---

## Bölüm 1 — Türk hukuku (KVKK ve TMK)

### 1.1 KVKK'da yaş sınırı yok

6698 sayılı KVKK'da "dijital rıza yaşı" ya da reşit olmayanlara özgü bir hüküm **yoktur**. Açık rıza (m. 3/1-a: "belirli bir
konuya ilişkin, bilgilendirilmeye dayanan ve özgür iradeyle açıklanan rıza") için gereken ehliyet genel hükümlere, yani
Türk Medeni Kanunu'na göre belirlenir. 5395 sayılı Çocuk Koruma Kanunu m. 3 "çocuk"u 18 yaşını doldurmamış kişi olarak
tanımlar. [HUKUK ONAYI: Kurul'un reşit olmayanların açık rızasına ilişkin bir kararı ya da rehberi var mı? Biz
doğrulayamadık.]

### 1.2 TMK — ehliyet ve yasal temsil (madde numaraları doğrulanmalı)

| Hüküm | İçerik (özet) | Teen modu için anlamı |
|---|---|---|
| TMK m. 11 | Erginlik 18 yaşın doldurulmasıyla başlar. | 16–17 yaş küçüktür. |
| TMK m. 13 | Ayırt etme gücü: yaşının küçüklüğü vb. nedenlerle akla uygun davranma yeteneğinden yoksun olmayan herkes ayırt etme gücüne sahiptir. | 16–17 yaşındaki bir kişinin, kural olarak, kendi verisi konusunda ayırt etme gücüne sahip olduğu varsayılabilir. |
| TMK m. 16/1 | Ayırt etme gücüne sahip küçükler, yasal temsilcilerinin rızası olmadıkça kendi işlemleriyle borç altına giremezler (sınırlı ehliyetsizler). | Kullanım Koşulları'nın kabulü bir sözleşmedir: ücretsiz olsa da gence yükümlülük getiriyorsa yasal temsilci rızası gerekebilir. **Mevcut ebeveyn metni yalnızca veri işlemeyi kapsar, sözleşmeyi değil.** |
| TMK m. 16/2 | Karşılıksız kazanmada ve **kişiye sıkı sıkıya bağlı hakları kullanmada** yasal temsilcinin rızası gerekmez. | Öğretide kişisel verilere ilişkin açık rızanın kişiye sıkı sıkıya bağlı bir hak olduğu, dolayısıyla ayırt etme gücüne sahip küçüğün **kendi rızasını kendisinin verebileceği** görüşü var; karşı görüşler de var (ör. m. 16/1'in yalnızca borçlandırıcı işlemleri kapsamadığı). |
| TMK m. 24 | Kişilik hakkına saldırı, rıza (ya da üstün özel/kamusal yarar, kanun) ile hukuka uygun hâle gelir. | Fotoğraf (görüntü hakkı) kişilik hakkıdır; rızayı kimin vereceği yine m. 16/2 tartışmasına bağlanır. |
| TMK m. 335 vd., **m. 342** | Velayet; ana ve baba, velayet çerçevesinde üçüncü kişilere karşı çocuğun yasal temsilcisidir (m. 342 — "temsil yetkisi"). | Ebeveyn onayının hukuki dayanağı. Velayet ortak ise **tek ebeveynin onayı** yeterli mi; boşanmış ebeveynlerde velayet sahibi olmayanın onayı geçerli mi? |

[HUKUK ONAYI: Madde numaraları (m. 11, 13, 16, 24, 335, 342) yalnızca ikincil kaynaklarla kontrol edildi; resmî metinden
doğrulanmalı. Kaynak olarak bakılanlar: av-saimincekas.com TMK m. 16 sayfası, acikders.ankara.edu.tr "Sınırlı
ehliyetsizler" ders notu, Lexpera derleme makaleleri.]

**Önerilen yaklaşım (taslağın varsaydığı):** "çift anahtar" — gencin kendi açık rızası (ayırt etme gücü, m. 16/2) **ve**
ebeveynin onayı (m. 16/1, m. 342; sözleşme ve ihtiyat). Bu nedenle deneme özelliğinde hem ebeveyn kutusu hem gencin kendi
`teenTryOn` rızası aranıyor. Mevcut fotoğraf rızaları (1, 2, 6, 7) genç tarafından da verilmeye devam ediyor.
[HUKUK ONAYI: (a) çift anahtar yaklaşımı doğru mu, yoksa yalnızca biri yeterli/gerekli mi; (b) ebeveyn onayı Kullanım
Koşulları'nın kabulünü de kapsamalı mı (ebeveyn metnine bir "Kullanım Koşulları'nı {ad} adına kabul ediyorum" kutusu
eklenmeli mi); (c) onaydan önceki "sınırlı mod"da (hesap, e-posta, gardırop) işleme için dayanak m. 5/2-c (sözleşme) mi
— sözleşmenin kendisi ebeveyn onayına tabiyse bu dayanak geçerli mi?] (REVIEW Q17)

### 1.3 Özel nitelikli veri — fotoğraf ve biyometri

- KVKK m. 6 biyometrik ve genetik veriyi özel nitelikli sayar. Fotoğraf **kendiliğinden** biyometrik veri değildir; ancak
  kişiyi benzersiz biçimde tanımlamaya yönelik özel teknik işlemeye tabi tutulursa biyometrik olur (Kurul ve GDPR m. 4(14)
  ile uyumlu yaklaşım). Droblet yüz şablonu çıkarmaz, tanıma yapmaz (bkz. REVIEW Q1, Q1a).
- 7499 sayılı Kanunla (1 Haziran 2024) m. 6'daki işleme şartları genişletildi; açık rıza hâlâ bir şart. Çocuk için özel
  nitelikli veri söz konusuysa açık rızayı kimin vereceği yukarıdaki tartışmanın aynısıdır, ama ihtiyat gereği **ebeveyn +
  genç** önerilir.
- Kilo (isteğe bağlı) için sağlık verisi tartışması (REVIEW Q2) gençlerde daha hassas: [HUKUK ONAYI: genç modunda kilo alanı
  tamamen kapatılmalı mı? `docs/api/teen.md` böyle bir kural içermiyor.]

[HUKUK ONAYI: reşit olmayanın yüz/boy fotoğrafının yapay zekâ ile işlenmesi biyometrik değerlendirmeyi (Q1) değiştirir mi?]

### 1.4 E-postayla ebeveyn onayının ispatı

KVKK'da açık rızanın ispat yükü veri sorumlusundadır; biçim şartı yoktur (elektronik ortamda alınabilir). Ancak e-posta
yöntemi, e-postayı alanın gerçekten ebeveyn olduğunu **kanıtlamaz** (genç kendi ikinci adresini yazabilir). Ek önlemler ve
alternatifler REVIEW Q19'da. [HUKUK ONAYI: e-posta + üç kutu + teyit e-postası + karma kayıt ispat için yeterli mi?]

### 1.5 Yurt dışı aktarım

KVKK m. 9'da (7499 ile değişik) reşit olmayanlara özgü bir kural yok; standart sözleşme + 5 iş günü içinde Kurul'a bildirim
(bkz. REVIEW Q3). Arızi aktarım için açık rıza istisnası reşit olmayanlarda daha da tartışmalı. [HUKUK ONAYI: OpenAI ve
SendGrid için standart sözleşme imzalanmadan teen modunda fotoğraf özellikleri açılmamalı mı?]

### 1.6 Diğer

- Aydınlatma (m. 10) gence ve ebeveyne ayrı ayrı, anlayacakları dilde: `privacy-teen.tr.md` ve `parental-consent.tr.md`.
- 6563 / İYS: gençlere pazarlama bildirimi tamamen kapalı — risk düşük.
- Silme ve imha: 90 günlük hareketsizlik silmesi ve geri almada silme, Saklama ve İmha Politikası'na (gerekiyorsa) eklenmeli.

---

## Part 2 — UK GDPR / EU GDPR / ICO Children's Code

### 2.1 Art. 8 ("GDPR-K") does not require parental consent at 16–17

- **UK GDPR art. 8 + Data Protection Act 2018 s. 9**: where consent is the lawful basis for an information society service
  offered directly to a child, the age at which the child can consent alone is **13**. A 16–17 year-old can therefore give
  valid consent themselves under UK law; parental consent is **not** required by art. 8.
- **EU GDPR art. 8**: default 16, member states may lower to 13. Users aged 16–17 are at or above the highest threshold.
  The EU GDPR applies only through art. 3(2) (offering services to people in the EU); not the target market.
- "GDPR-K" is an informal label for these child provisions (art. 8, recital 38, recital 58, recital 71, art. 17(1)(f)
  and recital 65); there is no separate instrument.
- Consequence: the parent's approval is driven by **Turkish law** (Part 1) and prudence, not by UK GDPR. The UK texts
  should not say the parent's consent is "required by law" in the UK.
  [LEGAL REVIEW: confirm; and whether, under UK law, presenting parental approval as a gate is consistent with the
  teen's own rights (Children's Code standard 1, best interests; standard 11).]
- Lawful basis stays as for adults (contract for the core service; explicit consent for photo/AI processing, art. 6(1)(a)
  / 9(2)(a) where needed). Recital 38: children merit specific protection. Art. 12(1) / recital 58: information in clear
  and plain language a child can understand → the plain-language teen section.

### 2.2 ICO Age Appropriate Design Code (Children's Code)

Applies to UK-established information society services likely to be accessed by under-18s (and to non-UK services
targeting UK children). Droblet Ltd is UK-established, so the Code likely applies **even though users are mainly in
Türkiye**. [LEGAL REVIEW: territorial scope of the Code / DPA 2018 s. 123 for a UK controller whose child users are
outside the UK.] Source page (could not be fetched on 2026-11-21, HTTP 403; list below is from prior knowledge, **not
re-verified**):
https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/

| # | Standard | Teen mode today | Gap / question |
|---|---|---|---|
| 1 | Best interests of the child | Restrictions designed around safety | Document the assessment in the DPIA |
| 2 | DPIA | **None written** | Write one before launch (§2.4) |
| 3 | Age-appropriate application | Self-declared birth year; one teen tier for 16–17 | Self-declaration enough given photo/AI risk? Annex B treats 16–17 as "approaching adulthood" |
| 4 | Transparency | Plain-language teen section, parent page | Lawyer review of wording; in-app "bite-sized" notices at photo upload |
| 5 | Detrimental use of data | No marketing, no commerce, no body comments, age-appropriate stylist | Streaks / nudges? none known |
| 6 | Policies and community standards | Community guidelines (adult) | Add teen-specific lines? |
| 7 | Default settings (high privacy) | Closet forced private, invisible, analytics off | OK; at 18 nothing switches on — good |
| 8 | Data minimisation | Birth year/month only; no analytics | Weight field not excluded for teens by the contract (see 1.3) |
| 9 | Data sharing | None beyond processors | OK |
| 10 | Geolocation | City only, no device location | OK |
| 11 | Parental controls | Parent approves/withdraws, **no monitoring** | Tell the teen what the parent can/cannot see — done in drafts |
| 12 | Profiling | Stylist personalisation (core service); no ad profiling | Is style personalisation "profiling" needing off-by-default? Likely core-service exception |
| 13 | Nudge techniques | "Accept all" consent button exists for adults (Q1b) | Do **not** use "Tümünü kabul et" for teens? |
| 14 | Connected toys and devices | n/a | — |
| 15 | Online tools | Rights in-app (delete photos/account, export) | Teen can delete without parent — keep |

[LEGAL REVIEW: each row; in particular 3, 12 and 13.]

### 2.3 Cross-border transfers of minors' data

No special transfer rule for children in UK GDPR; the general regime applies (UK–EU adequacy for AWS Frankfurt; UK–US data
bridge or IDTA/Addendum for OpenAI and SendGrid). OpenAI's own developer guidance says to implement **zero data retention**
before processing personal data of children under 13 "or the applicable age of digital consent"
(https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance, fetched 2026-11-21). 16–17 is above the
UK age (13); Türkiye has no statutory digital-consent age, so whether this applies is unclear.
[LEGAL REVIEW / owner: request ZDR for the image endpoints anyway for teen traffic? See REVIEW Q18.]

### 2.4 DPIA — recommended (very likely mandatory)

Art. 35 UK GDPR; the ICO's list of processing likely to result in high risk includes processing children's data / targeting
children and innovative technology (from prior knowledge, not re-verified on 2026-11-21); the Children's Code standard 2 expects a DPIA for any ISS likely to be accessed by
children. Droblet teen mode combines: minors · face and body images · generative AI (image editing) · transfer to the US ·
a user-to-user service (for adults). **Recommendation: write a DPIA before `Teen:Enabled` is switched on in prod**, covering
at least: age assurance accuracy, parental-consent spoofing, image misuse (sexualisation, deepfake), OpenAI retention and
abuse monitoring, the outfit-photo path (off), moderation of reports involving teens (`involvesTeen`, high priority),
breach impact, 90-day deletion. Consult the ICO under art. 36 if high residual risk remains.
[LEGAL REVIEW: confirm DPIA is mandatory; KVKK has no DPIA duty but the same document can serve as the KVKK risk analysis.]

### 2.5 Other UK regimes to check

- **Online Safety Act 2023**: by admitting 16–17 year-olds, children are now *users*; the children's access assessment
  outcome changes and child-safety duties may apply to the user-to-user parts, even though teens cannot use them.
  [LEGAL REVIEW: tie to REVIEW Q13.]
- **COPPA (US)**: not applicable (no US children under 13 targeted); used only as a benchmark for VPC methods (REVIEW Q19).
