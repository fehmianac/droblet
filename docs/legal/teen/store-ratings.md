# Store age ratings and audience — what changes with teen mode (16–17)

> **DRAFT NOTES — NOT APPROVED, NOT SUBMITTED.** Written 2026-11-21 for the owner and the lawyer. Do **not** change App
> Store Connect or Play Console until the lawyer has answered REVIEW Q20–Q21 and `Teen:Enabled` is about to be switched on
> in prod. The current, submitted answers are in [`docs/store-listing/age-rating.md`](../../store-listing/age-rating.md)
> (18+). All web sources below were fetched on 2026-11-21.

## 1. Summary

| | Today | With teen mode |
|---|---|---|
| App Store age rating | 18+ (chosen; app gates at 18) | **16+** (computed from the answers below; matches the app's own minimum age) |
| Google Play target audience | 18 and over | **16–17 and 18 and over** (no group under 16) |
| Google Play Families policy | not applicable | **likely still not applicable** (no "children" group selected) — flag, see §3 |
| IARC content rating | unchanged | content answers unchanged; target audience is a separate declaration |

The rating can only be lowered when the app's own gate allows 16–17 in that market. While `Teen:Enabled` is `false`
on prod, keep **18+**.

## 2. Apple App Store

**Rating scale.** Apple's 2025 update replaced 12+ and 17+ with **13+, 16+ and 18+** (alongside 4+ and 9+); developers had
to answer the new questionnaire by 31 January 2026.
- https://developer.apple.com/news/upcoming-requirements?id=07242025a ("Age Rating Updates")
- https://developer.apple.com/news/?id=ks775ehf ("Updated age ratings in App Store Connect")
- https://developer.apple.com/help/app-store-connect/reference/age-ratings (tier definitions and questionnaire items)

From the App Store Connect reference (paraphrased from the fetched page): **16+** covers "unrestricted web access", "frequent
medical or treatment information" and "frequent mature or suggestive themes"; **13+** covers "social media" among others;
user-generated content, messaging, advertising, parental controls and age assurance alone map to **4+**; **18+** covers
dating, gambling, frequent sexual content etc. A developer may choose a higher rating than the computed one.

**Questionnaire answers likely affected** (the questionnaire describes the *app*, not one user group, so adult features
still count):

| Item | Answer with teen mode | Effect |
|---|---|---|
| Unrestricted Web Access | **Yes** (unchanged) — the in-app browser (`expo-web-browser`) opens brand checkout pages for adults and legal pages for everyone, with free navigation | → **16+**. If the browser were locked to fixed domains this could be "No" (→ 13+ because of social media). |
| Social Media | **Yes** for adults (follow, feed, ratings) — teens are blocked server-side | → 13+ floor |
| Social Media Disabled for Users Under 13 | Not the relevant age (teens 16–17 have no social access at all); answering needs the Declared Age Range API "at a minimum" per Apple's text | Leave unanswered / No `[LEGAL REVIEW]` |
| User-Generated Content | Yes (adults) | 4+ |
| Messaging and Chat | No | — |
| Advertising | No (affiliate shop is adult-only; teens see no store links) | — |
| Age Assurance | **Changes**: birth-year self-declaration + parental e-mail consent. Apple defines it as a "Mechanism to confirm an individual's age meets the age requirement" — self-declaration is arguably not "confirmation" | answer `[LEGAL REVIEW]` |
| Parental Controls | Probably **No** — the parent approves/withdraws but cannot monitor, manage or restrict content (Apple: "Settings or tools that allow parents/guardians to monitor, manage, or restrict…") | — |
| Mature or Suggestive Themes | None / at most infrequent — try-on renders are fully clothed; adult beachwear try-on exists | 9+ at most |
| Health or Wellness Topics | Body type / weight inputs; no advice | none or 9+ |
| Made for Kids | No | — |
| **Age rating override** | Not needed if the computed result is 16+; otherwise choose 16+ | 16+ |

Guideline 1.2 (UGC) safeguards stay as in `age-rating.md`; with minors on the platform Apple reviewers look harder at
report handling — the admin queue now prioritises reports involving teens (`involvesTeen`, `docs/api/teen.md` §10).

**Declared Age Range API (iOS 26+).** Lets an app ask for the user's age range, as shared by the person or their family
organiser; responses come with a source (self-declared, guardian-declared, confirmed). Apple's age-assurance Q&A says that
"In regions where legally required, you need to check the age of the people using your app with the Declared Age Range
API", even for 18+ apps, and that PermissionKit can request parental permission for "significant updates". The page does
not name the regions.
- https://developer.apple.com/documentation/declaredagerange
- https://developer.apple.com/support/age-assurance
Recommendation: not required for Türkiye as far as we could verify (**not verified**); consider using it as an extra
signal at sign-up on iOS (a guardian-declared range under 16 → refuse). `[LEGAL REVIEW: does any market Droblet ships to
(Türkiye, UK, others in the store territory list) legally require it? US state app-store laws (e.g. Texas, Utah) were not
verified.]` The store territory list should exclude regions with obligations Droblet does not implement.

## 3. Google Play

**Target audience and content** (Play Console › Policy › App content):
https://support.google.com/googleplay/android-developer/answer/9867159 ("Manage target audience and app content settings").
Select **16–17** and **18 and over**. Per that page: "Any apps that include children in their target audience must comply
with Google Play's Families Policy Requirements"; for the 16–17 group: "Note that this age group may be considered to
include children in some locales"; and "if your app targets any users who are under the age of 21, you must consider if
they would be considered children under their local laws. Apps that target children must comply with Google Play Families
Policy requirements." The page describes "Restrict Minor Access" for apps "only suitable or designed for an adult
audience" — it must be **turned off** if it is on today.

**Families policy:** https://support.google.com/googleplay/android-developer/answer/9893335 ("Google Play Families
Policies"): "If one of the target audiences for your app is children, you must comply with the following requirements."
The page does not fix an age: "The word "children" can mean different things in different locales and in different
contexts." **This is a real open point:** under Turkish law (and UK law) a 16–17 year-old is a child (under 18), and
Play's own text ties "children" to local law. Our working assumption (from how the Play Console behaves, **not verified
in a written policy**) is that the Families requirements are triggered by selecting an under-13 group, so with 16–17 +
18+ only Droblet would not be in the Families program; "Teacher Approved" is irrelevant either way. The Families page's
social-app rule ("All social apps that include children in their target audience must provide an in-app reminder to be
safe online…") would be cheap to satisfy even if it applied (teens have no social features). `[LEGAL REVIEW: does
Families apply to a 16–17 target audience for Türkiye? If yes, the main extra obligations are the ads SDK rules (none
used), data-handling rules for children and no transmission of device identifiers from children — Firebase is already
off for teens.]`

**IARC questionnaire:** content answers unchanged (see `age-rating.md`). The rating outcome is likely unchanged.

**Data safety form:** add "age range" (birth year/month) under Personal info › Other, and the parent's e-mail address
(collected from the teen for the consent flow) `[owner: add to docs/store-listing/data-safety.md and app-privacy.md when
the feature launches]`.

**Play Age Signals API (beta):** returns an age range (default ranges 0–12, 13–15, 16–17, 18+) and a user status
(verified, declared, supervised, unknown) only where Play is legally required to provide it; usage terms: "You may only
use information from the Play Age Signals API to provide age-appropriate content and experiences in compliance with laws.
You may not use the Play Age Signals API for any other purpose including, but not limited to, advertising, marketing, user
profiling, or analytics." Google announced on 29 July 2026 that it is expanding the API to all Play developers globally.
- https://developer.android.com/google/play/age-signals/overview
- https://developer.android.com/google/play/age-signals/use-age-signals-api
- https://android-developers.googleblog.com/2026/07/google-play-age-signals-api-safer-experiences.html
Recommendation: same as Apple — optional extra signal at sign-up; not known to be required for Türkiye (**not verified**).

## 4. Owner checklist when teen mode goes live

1. Lawyer approves REVIEW Q17–Q23; drafts in this folder are moved into `landing/content/{tr,en}.json` and the generated
   pages.
2. `Teen:Enabled = true` on prod, then App Store rating → 16+, Play target audience → 16–17 + 18+ (same day).
3. Update `docs/store-listing/age-rating.md`, `app-privacy.md`, `data-safety.md`, review notes (explain teen mode and give
   the reviewer a teen demo account with a pre-approved parent).
4. Terms of Use: "18 or over" wording → "16 or over, with parental approval for 16–17".
