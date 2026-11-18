# Find friends from contacts — what happens to your address book

Input for the privacy policy (KVKK + UK GDPR). Owner decision 13 (2026-11-19): contact matching is in phase 1, with explicit
consent and hash matching; address-book data is not stored. Technical contract: [`docs/api/store-social-settings.md`](../api/store-social-settings.md) §6
"Find friends from contacts".

## In one paragraph (for the policy)

If you choose "Rehberden bul / Find from contacts", Droblet first explains what will happen and asks for your consent, and
only then asks your phone for permission to read your contacts. The app turns every e-mail address in your contacts into
a one-way code (a salted SHA-256 hash) **on your phone**. Only these codes are sent to Droblet — never names, phone numbers,
e-mail addresses or anything else from your address book. Droblet compares the codes with the same kind of code made from
its members' verified e-mail addresses and shows you the members it found, as far as their privacy settings allow. The
codes are used only for this one comparison and are not stored. You can withdraw permission at any time in your phone's
settings.

## What is processed

| Data | Where | Kept |
|---|---|---|
| Your contacts (names, numbers, e-mails, photos) | Read on your phone only, after consent and OS permission | Never leaves the phone; not cached by the app |
| E-mail addresses from your contacts | Normalised (trimmed, lower-case) and hashed on the phone | Not sent in readable form |
| Upload: pairs of a 3-character prefix of `SHA-256(address)` and `SHA-256(salt + ":email:" + SHA-256(address))` | Sent over HTTPS to the Droblet API | **Not stored, not logged.** Held in memory for the duration of the request only |
| Salt | Random 32 bytes created by the server for one request | Deleted when used; expires after 10 minutes |
| Members' verified e-mail addresses | Kept by Droblet as `SHA-256(address)` in the matching directory | Until the member deletes the account |
| Result | Profile cards (handle, name, style tags) of matched members the user may see | Shown in the app; not stored as a "contacts" list |
| Request count | A per-account counter for rate limiting (10 per day) | Expires after a day; contains no contact data |

Phone numbers are **not** used in phase 1: members have no phone number on file. The app does not read or hash them.

## Why the codes cannot be reused or reversed

- **Salted per request.** The salt is random, used once and deleted, so the same address produces a different code in every
  request; a code captured from one request is worthless in any other, and two uploads cannot be linked to each other.
- **Prefix only narrows the search.** The 3-character prefix (12 bits of the unsalted hash) puts each address in one of
  4,096 buckets so the server only compares a small group. 12 bits are far too few to identify an address.
- **Only verified addresses are matchable.** A member's address is in the directory only when Apple / Google verified it at
  sign-in or the member proved it by completing a password reset — someone cannot appear as "you" by registering with your
  address.

## Whom you can find

Matches follow the same rules as search: accounts that blocked you or that you blocked are never returned; private accounts
are returned only when you already have a relationship with them; your own account is never returned. Finding someone does
not follow them — following is a separate tap (and a request for followers-only / private accounts).

## Consent and control

- An in-app consent screen comes **before** the OS permission prompt; declining it means the OS prompt is never shown.
- The OS permission can be withdrawn at any time in the phone's settings; Droblet has nothing to delete because nothing was kept.
- Members can avoid being found by contacts by deleting their account (removes the directory entry) — a separate
  "do not match me" switch is a candidate for a later release.

## Legal basis (proposal for legal review)

Explicit consent (KVKK art. 5/1; UK GDPR art. 6(1)(a)) for the user who uploads. For the contacts themselves — who are not
asked — the data never leaves the device in readable form and nothing is stored; matched members are matched on data they
gave Droblet themselves, and only their public profile card is shown, subject to their visibility settings (legitimate
interest, UK GDPR art. 6(1)(f); to be confirmed by legal).
