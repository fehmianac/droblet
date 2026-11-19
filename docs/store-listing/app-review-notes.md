# App Review notes (App Store "App Review Information" / Play "App access")

`[OWNER]` fields must be filled before submitting. Keep the text in English — reviewers read English; the app follows
the device language (Turkish or English).

## Sign-in information

| Field | Value |
|---|---|
| Sign-in required | Yes |
| User name | `[OWNER: review@… — create a dedicated e-mail/password account on the production stack]` |
| Password | `[OWNER]` |
| Contact | `[OWNER: name, phone, e-mail of the person who answers App Review]` |

Prepare the account before submitting `[ASSUMPTION — recommended]`: 18+ confirmed, a handful of wardrobe items, one
full-body photo and a face photo with their consents, a city set, 2–3 looks, and one follower/following pair with a
second test account so the feed, report and block can be shown. Give it Premium via the admin panel's "TEST premium"
(`PUT v1/admin/user/{id}/test-premium`, 30–90 days) so the reviewer does not need to buy anything.

## Notes (paste into "Notes")

```
Droblet is a personal wardrobe and styling app for adults (18+). Sign in with the e-mail and password above
(Sign in with Apple and Google are also available).

THE ACCOUNT
The review account already has wardrobe pieces, a body and a face photo and Premium (granted from our admin panel),
so every feature can be tried without a purchase.

MEMBERSHIP / IN-APP PURCHASES
Subscriptions "Droblet Membership" (monthly / yearly, 1-week free trial) and the consumable "20 AI images" are sold
with StoreKit. To see the paywall: Profile tab > "Membership" (or any member feature from a free account); the credit
pack: Profile tab > AI images card > "Top up credits". Purchases work in the sandbox. Prices are read from the App Store.
[ONLY IF THE TEMPORARY SWITCH IS ON IN PRODUCTION — see below:] Until payments are enabled, a "Turn on for free for
now" link on the paywall and a "Temporary membership" card in Settings let a user enable Premium for free.

AI-GENERATED IMAGES
"See it on me" creates an image of the user wearing the outfit or product from their own photo (OpenAI image model,
processed for this account only, never shown to other users). Every AI image carries a permanent "ON YOU" label
(or "AI PREVIEW"); it cannot be hidden. Try it: Today > "Try it on me", or a product in the Style shop > "On me".
Body and face photos are used only after separate explicit consent screens.

USER-GENERATED CONTENT
Users can follow each other and rate (1–5 stars) the looks of people they follow. There is no chat or comments.
Report: open any user's profile > "..." > "Report" (reasons incl. harassment and minor safety).
Block: same menu > "Block"; unblock in Settings > Blocked accounts.
Reports go to our moderation queue and are reviewed within 24 hours; abusive accounts are suspended.

ACCOUNT DELETION
Profile > Privacy and settings > Delete my account (immediate). Photos can be deleted separately in the same screen.

SHOPPING
Brand products open on the brand's own website for checkout (physical goods; no payment is taken in the app).
```

## The temporary self-premium switch

- What it is: `POST/DELETE v1/tenant/entitlement/self-premium` grants Premium + 30 AI images for a month without a
  purchase (`docs/api/purchases-push.md` §3a). The app shows it only when `GET v1/tenant/entitlement` returns
  `selfServePremium.enabled = true`: as "Turn on for free for now" on the paywall, a "Temporary membership" card in
  Settings, and in the requirements sheet's membership step.
- Flag: `Entitlements:SelfServePremium:Enabled` (SSM `/droblet/{stage}/api/Entitlements` and `/worker/Entitlements`;
  admin panel › Settings › entitlements). Default **on in dev, off in prod** (`template.yaml`).
- **Recommendation: keep it OFF on the production stack the review build talks to, and delete the "ONLY IF …" paragraph
  from the notes.** A free "turn on Premium" button next to StoreKit products invites a 3.1.1 rejection (digital
  content unlocked without IAP) or a 2.1 "incomplete" remark. Use the admin "TEST premium" grant for the review account
  instead. `[ASSUMPTION — owner decision]`
- If the owner wants to submit before payments are live: submit with IAP disabled entirely is not an option for a
  subscription app; the only clean path is IAP products "Ready to Submit" with the build.

## Demo video (optional, recommended)

A 30–60 s screen recording of: sign in → Today → Try it on me (AI label visible) → Stylist → Report/Block on a profile.
App Store Connect accepts a link in the notes.

## Checklist before pressing Submit

- [ ] Support e-mail published (site footer `NEXT_PUBLIC_CONTACT_EMAIL`, store listing, legal texts' `[CONTACT E-MAIL]`).
- [ ] Legal pages out of "draft" (docs/legal/REVIEW.md) — Apple opens the privacy URL.
- [ ] Paywall shows the auto-renew disclosure and links to Terms + Privacy (+ Subscription Terms, gap G8).
- [ ] Sign in with Apple key in SSM (token revocation on account deletion, guideline 5.1.1(v)).
- [ ] Self-premium switch off in prod; review account has TEST premium.
- [ ] IAP products + subscription group submitted with the build, each with a review screenshot.
- [ ] Moderation can actually remove reported content (gap G7) `[ASSUMPTION]`.
