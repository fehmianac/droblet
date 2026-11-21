# Segments — women and men (G)

Phase 1 was women only. This document is the contract for opening the app to **men**: which segments are open,
the per segment choices (body types, style tags, sub-types), how the library and the catalog follow the user's
segment, and what the AI does differently. Shared conventions: [README](README.md) (camelCase JSON and enum
strings, ProblemDetails with a snake_case `code`).

## 1. Segments and availability

`segment` (user): `women` · `men` · `teen`. Stored on the style profile (`PUT v1/tenant/style-profile`) and mirrored
on the tenant (discovery). An account that never chose one is **women** (every account from phase 1).

Which segments are open is configuration, not code: SSM `api/Segments` and `worker/Segments` (same value),
`{"Available":["women","men"]}`. **dev: women + men · prod: women only** until the owner switches it. **Teen is
never open** whatever the list says (a separate legal decision). A closed segment is shown as "Yakında" and
rejected with `422 segment_not_available`.

### GET `v1/config` (anonymous)

What the app needs to render the segment-dependent choices; no sign-in needed (onboarding). Names are in the
`Accept-Language` (tr fallback); the app may keep its own labels and use only the ids.

```json
{
  "segments": { "available": ["women", "men"], "all": ["women", "men", "teen"] },
  "bodyTypes": {
    "women": [{ "id": "hourglass", "name": "Kum saati" }, { "id": "pear", "name": "Armut" }, …],
    "men":   [{ "id": "rectangle", "name": "Dikdörtgen (düz)" }, { "id": "invertedTriangle", "name": "Ters üçgen (V)" }, …]
  },
  "styleTags": { "women": [{ "id": "minimal", "name": "Minimal" }, …], "men": [{ "id": "smartCasual", "name": "Smart casual" }, …] },
  "subcategories": {
    "women": [{ "id": "t-shirt", "category": "top", "name": "Tişört" }, …],
    "men":   [{ "id": "oxford-shirt", "category": "top", "name": "Oxford gömlek" }, …]
  }
}
```

The app should read `segments.available` for the Profil › Stil / onboarding chips instead of hard-coding "women only".

## 2. Style profile and body profile

**PUT `v1/tenant/style-profile`** `{ "segment", "styleTags": [3], "budget", "baseVersion" }`

- `segment` must be open (§1) → else `422 segment_not_available`.
- `styleTags`: exactly 3 distinct tags, **all offered for that segment** → else `400` with `style_tag_not_in_segment`.
- Changing the segment (Profil › Stil) re-filters the **library** and the **catalog** on the next read. The
  **wardrobe is never touched** (a man keeps his dress, a woman her derbies). A body type of the other segment
  (e.g. `hourglass` after switching to men) is **cleared** (`bodyType: null`): the app asks for it again before the
  next face try-on. Shared types (`rectangle`, `invertedTriangle`, `unsure`) are kept.

**PUT `v1/tenant/body-profile`** — `bodyType` per segment (the segment is the style profile's):

| Segment | `bodyType` values |
|---|---|
| women | `hourglass` · `pear` · `apple` · `rectangle` · `invertedTriangle` · `unsure` (phase 1, unchanged) |
| men | `rectangle` · `invertedTriangle` (V shape) · `triangle` (wider hips / waist) · `oval` (round midsection) · `trapezoid` (athletic) · `unsure` |

Another segment's value → `400` with `body_type_not_in_segment`. New enum values: `triangle`, `oval`, `trapezoid`.

### Style tags

| Segment | Tags |
|---|---|
| women | `minimal` · `classic` · `quietLuxury` · `street` · `boho` · `sporty` · `romantic` · `officeChic` · `colorful` · `vintage` (phase 1, unchanged) |
| men | `minimal` · `classic` · `smartCasual` · `tailored` · `quietLuxury` · `street` · `sporty` · `vintage` · `colorful` |

New enum values: `smartCasual`, `tailored` (men only for now).

## 3. Taxonomy: categories, sub-types, slots

Categories and outfit slots are **unchanged** for both segments: `top` · `bottom` · `dress` · `outerwear` · `shoes`
· `bag` · `accessory` · `beachwear` · `skiwear`, and the five slots top / bottom / outerwear / shoes / bagAccessory
(`dress` fills `top`). Dresses are women's pieces in the pickers, but a man **may own** one: item writes, looks and
the stylist accept any category for anyone.

Sub-types (`subcategory`, the "Tür" field) are per segment **in the pickers only** (`GET v1/config`); detection and
item writes accept every id. New ids (TR / EN names in `v1/config`):

| Category | New ids (segment) |
|---|---|
| top | `polo` (unisex) · `oxford-shirt` (men) · `dress-shirt` (men) · `henley` (men) · `sweatshirt` (unisex) · `turtleneck` (unisex) · `quarter-zip` (men) |
| bottom | `chinos` (unisex) · `suit-trousers` (men) · `cargo-trousers` (unisex) · `joggers` (unisex) |
| outerwear | `suit-jacket` (men) · `overshirt` (unisex) · `bomber` (unisex) · `leather-jacket` (unisex) · `parka` (unisex) · `waistcoat` (men) |
| shoes | `derbies` (men) · `oxford-shoes` (men) · `chelsea-boots` (unisex) · `boat-shoes` (men) |
| bag | `briefcase` (unisex) · `messenger-bag` (unisex) |
| accessory | `bow-tie` (men) · `pocket-square` (men) · `cufflinks` (men, jewellery crop) · `suspenders` (men) |
| beachwear | `swim-shorts` (men) |

Women-only ids (hidden from men's pickers): `blouse`, `top`, `skirt`, `leggings`, `dress`, `jumpsuit`, `heels`,
`flats`, `handbag`, `shoulder-bag`, `clutch`, `hair-accessory`, `earrings`, `brooch`, `anklet`, `bikini`,
`swimsuit`, `kaftan`. Everything else is unisex (e.g. `t-shirt`, `shirt`, `jeans`, `blazer`, `loafers`, `tie`,
`watch`, `belt`).

## 4. Library (ready-made pieces)

`LibraryItemDto` gets **`segment`** (`women` · `men` · `unisex`). **GET `v1/tenant/library/item`** returns only the
user's segment plus `unisex` pieces. Adding by id (`POST v1/tenant/item/from-library`) stays open for any piece.

Men's starter set: 27 pieces, ids `lib-men-*` (shirts, polo, knitwear, chinos, jeans, tailored trousers, suit
jacket, overshirt, bomber, coat, puffer, sneakers, loafers, derbies, Chelsea boots, backpack, belt, watch, tie,
swim shorts). **They have no image yet: `imageUrl: null` → show the garment placeholder.** Images come later with
the owner-approved Ops run (`generate-library-images --only …`).

Library pieces from before the launch are `women`.

## 5. Catalog

`ProductDto` gets **`segment`** (`women` · `men` · `unisex`). The user's lists show their segment plus `unisex`:
`GET v1/catalog/product`, `GET v1/tenant/palette/products`, `POST v1/tenant/catalog/complete`, and the stylist's
gap filling. A product by id (`GET v1/catalog/product/{id}`, cart, saved looks) is never hidden. Products from
before the launch are `women`.

**Weekly edit** (`GET v1/content/edit/current`): already per segment (the user's segment); edits may now be
authored for `women` or `men` (`teen` → `segment_not_available`). The weekly-edit push goes to each subscriber with
the edit of their segment.

## 6. Admin

- **Library** `PUT v1/admin/library/{id}`: optional `segment` (omitted = `women`); `AdminLibraryItemDto` gets
  `segment` and `needsImage` (no https image stored yet). Invalid → `segment_invalid`. Seed pieces added after the
  partition was first written (the men's set) are listed from the seed (`stored: false`) until first edited.
- **Products** `PUT v1/admin/product/{id}`, `POST v1/admin/product/bulk` (CSV import): optional `segment` —
  omitted keeps the stored value on an update, `women` on create; invalid → `segment_invalid`. `AdminProductDto`
  gets `segment`. `GET v1/admin/product?segment=women|men|unisex` filters on exactly that value.
- **Prompts** (AI › Promptlar): two new editable keys, see §7.

## 7. AI (prompt keys)

Women's requests are **byte-identical** to phase 1. Men's requests differ only as below.

| Key | Kind | When |
|---|---|---|
| `stylist.segment.men` (new) | system suffix | Appended after `stylist.{outfit,week,pack}.instructions` for a man: menswear bases, outer layers, formal occasions, calm colours; a dress / skirt only when owned, never as a missing piece. Dry-run: runs as a man's outfit request. |
| `item.detect.segment.men` (new) | system suffix | Appended after `item.detect.instructions` for a man's photo: prefer menswear sub-types (`suit-jacket`, `chinos`, `derbies` …). Dry-run: a man's detection. |
| `tryon.image.face`, `tryon.image.photo.face` | image prompt | New optional variable `{{personNoun}}`: `person` / `user` for women (the phase 1 text), `man` for men. `{{bodyShape}}` uses the men's build wording for men; a body type of the other segment reads as "not sure". Overrides published before the launch stay valid (the variable is optional). |
| detection schema | view only | Its `subcategory` enum now includes the new ids. |

Body / photo try-on, photo check, outfit-photo check and palette prompts were already neutral ("the person"); they
are unchanged. The face-path try-on cache key gets a `-men` suffix for men (a woman's keys are unchanged).

## 8. Migration

- Existing users stay **women** (no style profile segment = women; nothing is rewritten).
- Existing library pieces and products read as `women` (the field is absent on stored rows).
- The men's library set is served from the embedded seed on stages whose library partition was already written.
