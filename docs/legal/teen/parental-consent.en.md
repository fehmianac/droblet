# Parent notice and consent text (teen mode, ages 16–17)

> **DRAFT — NOT LEGALLY APPROVED. NOT PUBLISHED.** Hand-written draft for the `/en/parent-consent/` page and the parent
> e-mails; not live (the page is built only with `NEXT_PUBLIC_TEEN_PARENT_CONSENT=1`, `noindex`). Every
> `[LEGAL REVIEW: …]` note is a question for the lawyer (see `docs/legal/REVIEW.md` Q17–Q23). The Turkish text
> (`parental-consent.tr.md`) is the primary version for parents in Türkiye.
>
> **Text version: `2026-11-21`** (`Teen:ParentalConsentTextVersion`; any wording change needs a new version, earlier
> approvals stay linked to the version they approved) · Draft date: 21 November 2026 · Technical source:
> `docs/api/teen.md` §5

`{name}` is the first word of the teen's display name only.

---

## A. Page text

### Hello,

**{name}** has asked for your approval to use the Droblet app and gave this address as your e-mail address. Please read
the information below and decide. If you do not recognise this request, or {name} is not your child or ward, do nothing or
press **Decline**; the link stops working by itself after 7 days.

### What is Droblet?

Droblet is a wardrobe and style app: users record their clothes, build outfits (looks), plan what to wear day by day and
for trips, and get AI-assisted style suggestions. It is provided by **Droblet Ltd**, London, which is the **data
controller**. Users aged 16–17 use Droblet in **teen mode**, with the restrictions below. Under-16s cannot open an account.

**Data controller:** Droblet Ltd, [COMPANY ADDRESS], London, United Kingdom · Company no. [COMPANY NUMBER] ·
[CONTACT E-MAIL] · Representative in Türkiye: [TÜRKİYE REPRESENTATIVE]

### What does your approval switch on?

Even before you approve, {name} can build a wardrobe by hand or from the ready-made library and make looks and plans. Your
approval switches on:

- **Photos:** photographing and uploading clothes (the AI suggests type, colour and fabric and removes the background), a
  full-body and a face photo, a profile picture;
- **Colour palette:** choosing suitable colours from the skin, hair and eye colours in the face photo;
- **AI stylist:** outfit, weekly plan and packing suggestions — age- and school-appropriate, with no revealing pieces or
  suggestive wording.

### What is off in teen mode?

- **No social features:** no following, followers, people search, ratings, feed, share or invite links, finding friends
  from contacts, or username. {name} is **invisible** to other users and the closet is always **private**.
- **No shopping:** no store or brand links, cart, purchases or paid membership; teen mode is free.
- **No analytics or marketing:** product analytics (Firebase) does not run, usage events are not stored, no marketing
  notifications are sent.
- **Trying on an outfit from a photo of another person** is always off.
- **Virtual try-on ("See it on me")** is currently off; if it is switched on, it works only if you tick the **separate**
  box below and {name} also gives their own consent.

You **cannot see** {name}'s wardrobe, photos or activity; this approval is not a monitoring tool.
[LEGAL REVIEW: ICO Children's Code standard 11 (parental controls) — is telling the teen clearly that the parent does not
monitor enough?]

### What data is processed, by whom, and where?

| Data | Purpose | Who / where |
|---|---|---|
| {name}'s account, profile, style and body profile, wardrobe and planning data | Providing the app | Droblet Ltd; AWS, Frankfurt (Germany, `eu-central-1`) |
| {name}'s birth year (and month if needed) and age band | Applying teen-mode rules, working out the 18th birthday | Droblet Ltd; AWS (Germany) |
| {name}'s clothing, full-body and face photos, palette result, profile picture | Photo and AI features | Storage: AWS (Germany). Processing: **OpenAI (US)** as processor |
| {name}'s stylist requests (date, weather, occasion, clothing details; no name or e-mail) | Style suggestions | OpenAI (US) as processor |
| **Your e-mail address** | Only to send these approval e-mails | Droblet Ltd; delivery by **Twilio SendGrid** (US) [LEGAL REVIEW: use SendGrid EU data residency?] |
| Consent record: event (request, approval, decline, withdrawal…), time, SHA-256 hashes of your e-mail and IP address, text version, boxes ticked | Proving the consent | Droblet Ltd; AWS (Germany). The IP address itself is not stored. |

Photos are stripped of location and device data, stored encrypted and never shown to other users or to support or
moderation staff in any setting. Under OpenAI's API terms data sent through the API is not used to train models; it may be
retained for [OPENAI RETENTION] for abuse monitoring. No identification or face recognition takes place.

Data is transferred outside Türkiye (to the UK, Germany and the US); transfer mechanism: [TRANSFER MECHANISM].
[LEGAL REVIEW: transfer of a minor's data to the US under KVKK art. 9 and UK GDPR]

### How long is data kept?

- {name}'s personal photos (body, face, try-on images, palette result): deleted automatically after 90 days without any
  sign-in; deleted at once if you withdraw; {name} can delete them at any time.
- Your e-mail address: deleted when {name} turns 18 or the account is deleted.
- Consent record: while the account exists. [LEGAL REVIEW: minimal consent record after account deletion]
- Other data: as set out in the Droblet Privacy Policy and KVKK Information Notice.

### Withdrawing your approval

After you approve we send you a **confirmation e-mail**; its link lets you withdraw **at any time** until {name} turns 18.
If you withdraw:

- the photo and AI features switch off;
- {name}'s **full-body and face photos, all try-on images, palette result and profile picture are deleted**; garment images,
  looks and plans stay;
- {name} is told in the app.

Withdrawal does not affect the lawfulness of processing before it. {name} can delete the account at any time.

### Your rights

For the rights under KVKK art. 11 and UK GDPR (information, correction, deletion, objection, etc.) write to
[CONTACT E-MAIL]. Details: Droblet Privacy Policy, KVKK Information Notice and the section for teen users.
[LEGAL REVIEW: how to verify requests made as legal representative]

---

## B. Confirmation boxes

To approve, **all three** boxes must be ticked (none is pre-ticked). The try-on box is **separate** and optional and is
shown only when the feature is on.

1. ☐ **I am {name}'s parent or legal guardian.**
2. ☐ **I have read the notice above.**
3. ☐ **I agree to {name}'s personal data being processed as described above, including AI processing of their photos and
   the transfer for that purpose to OpenAI (US).**

Separate and optional (shown only when virtual try-on is on):

4. ☐ **I also agree to images being generated from {name}'s full-body or face photo that show them wearing clothes ("See
   it on me"). Images are fully clothed, in a neutral pose and true to their real age, and are visible only to {name}.**

Buttons: **Approve** · **Decline**

[LEGAL REVIEW: (a) does box 2 conflict with the KVKK Information Notice Communiqué rule that notice and explicit consent
must not be bundled; (b) box 3 combines several purposes (AI processing + transfer abroad) — split it?; (c) does the
parent's approval replace the teen's own explicit consent or add to it? (REVIEW Q17)]

After approval: "Thank you. Your approval has been recorded. We have e-mailed you a link you can use to withdraw it."
After decline: "Your decision has been recorded. Photo and AI features stay off on {name}'s account."
After withdrawal: "Your approval has been withdrawn. {name}'s personal photos have been deleted and the photo features
switched off."

---

## C. E-mail texts (short)

### C1. Request e-mail

**Subject:** {name} is asking for your approval for Droblet

Hello,

{name} would like to use Droblet, a wardrobe and style app, and is asking for your approval. On Droblet, 16–17 year-olds
use a **teen mode** with no social features, shopping or ads. Photo and AI features (including sending photos to OpenAI,
US) switch on only with your approval.

To read what is processed and decide: **[Read and decide]** ({ParentConsentUrl}?token=…)

The link is valid for **7 days**. If you do not recognise this request you can ignore this e-mail; we do not use your
address for anything else.

Droblet Ltd, London · [CONTACT E-MAIL]

### C2. Approval confirmation e-mail (with withdrawal link)

**Subject:** Your approval has been recorded — Droblet

Hello,

We recorded your approval for {name}'s Droblet account on {date} (text version 2026-11-21). Virtual try-on:
{allowed / not allowed}.

You can withdraw your approval **at any time**: **[Withdraw my approval]** ({ParentConsentUrl}?token=…)
If you withdraw, the photo features switch off and {name}'s personal photos (body, face, try-on images, palette result,
profile picture) are deleted. This link works until {name} turns 18 — please keep this e-mail.

If you did not give this approval, contact us at once: [CONTACT E-MAIL].

Droblet Ltd, London · [CONTACT E-MAIL]

[LEGAL REVIEW: the confirmation e-mail mirrors COPPA's "e-mail plus" method; is it sufficient on its own? (REVIEW Q19)]
