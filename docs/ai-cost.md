# AI cost model

Measured 2026-11-19 on dev (`feat/ai-cost`). The goal: AI unit economics as cheap as possible, with no visible loss of quality.
Prices are OpenAI list prices in USD. ₺ figures use **USD/TRY 43 (assumption)**.

## 1. Prices (`Ai:Pricing`, SSM `worker/Ai/Pricing`)

The price list is configuration, not code. It never changes a request: it only turns the usage the API reports into an estimated cost.

| model | input $/1M | cached input | output | notes |
|---|---|---|---|---|
| `gpt-6-astra` (owner default, text + vision) | 10.00 | 1.00 | 50.00 | flex / batch 5 / 0.50 / 25 |
| `gpt-6.2-astra` | 8.00 | 0.40 | 40.00 | |
| `gpt-6.2-sol` / `gpt-6.1-sol` / `gpt-6-sol` | 2.00 | 0.10 / 0.10 / 0.20 | 10.00 | |
| `gpt-6.1-terra` | 1.00 | 0.05 | 5.00 | candidate for structured ops (see §4) |
| `gpt-6-luna` | 0.10 | 0.01 | 0.50 | |
| `gpt-5.6-sol` / `-terra` / `-luna` | 4 / 2 / 0.2 | 0.4 / 0.2 / 0.02 | 20 / 12 / 1.2 | |
| `gpt-5.4-mini`, `gpt-5-mini`, `gpt-5-nano` | 0.75 / 0.25 / 0.05 | 0.075 / 0.025 / 0.005 | 4.5 / 2 / 0.4 | |
| `gpt-image-2.5-sunburst` (owner default, images) | text 5.00, **image 8.00** | 1.25 / 2.00 | **image 30.00** | same rates as `gpt-image-2`, `-2.5-flare` |
| `gpt-image-1-mini` | text 2.00, image 2.50 | 0.20 / 0.25 | image 8.00 | |

- **Tier multipliers:** flex 0.5, batch 0.5, priority/fast 2.
- **Per-image fallback (assumption, third-party calculator figures):** used only when an image response has no usage. Low $0.006, medium $0.013, high $0.053 at 1024×1024.

**Sources:**
- OpenAI pricing: <https://developers.openai.com/api/docs/pricing>, fetched 2026-11-19.
- `gpt-image-2.5-sunburst` model page: <https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst>.
- Models available to the key: `ai-cost` lists them (`GET /v1/models`). Every model above is available.
- OpenAI publishes no per-image price for 2.5-sunburst ("the calculator does not estimate 2.5"). Image calls are therefore priced from the token usage the API returns, which is exact.

## 2. How cost is measured

- **Every call is priced.** `OpenAiProvider` prices each call with `AiCost.Estimate`, using the response's model and usage. Text input is split into uncached and cached tokens; output includes reasoning tokens. Image edits price text input, image input and image output tokens separately. The service-tier multiplier is applied.
- **Where the cost is recorded:**
  - The job's `aiCost` (and outfit-import photo `aiCost`): micro-USD per operation, `calls.{op}` and `total`.
  - The `Job timings … | ai calls …` log line: `imgin … tier … usd …`.
  - The EMF metrics `CostMicroUsd` and `ReasoningTokens` (namespace `Droblet/Ai`, dimensions Env × Job × Stage).
- **`ai-cost` Ops command** (`gh workflow run ops-dev.yml --ref <branch> -f command=ai-cost -f args="…"`):
  - `--usage-only --days N` prices every worker call of the last N days from the logs. It gives p50/p95 per job kind and per operation, plus the speculative-cleanup hit rate.
  - `--synthetic-only --text-variants … --image-variants …` runs the workers' prompts, schemas and guards on synthetic fixtures. The fixtures are a 40-piece wardrobe with real-length ids, plus the garment, flat-lay, face and body photos. It runs once per settings variant and rep, and records cost, tokens, latency and a quality check. Images are saved for review.
  - Text calls are capped at ≤ 120 per run and image calls at ≤ 30.
- **Variant syntax.** Variants are separated by `;` (no spaces). Example: `low:effort=low,compact=1,weekbatch=0,detail.photo_check=low,tier.item_match=flex`. Image variants look like `cl:quality=low,size=1024x1024,uses=cleanup`.

## 3. Baseline: real dev usage, last 30 days (425 worker runs)

| job kind | runs | cost p50 | cost p95 | mean |
|---|---|---|---|---|
| ItemProcess (detect + cleanup) | 89 | $0.0618 | $0.2122 | $0.0772 |
| ItemClean (selected piece) | 276 | $0.0112 | $0.0185 | $0.0101 |
| OutfitImport (per photo) | 5 | $0.0691 | $0.0949 | $0.0645 |
| StylistOutfit | 12 | $0.0361 | $0.0427 | $0.0324 |
| StylistWeek (WeekBatchDays 3 → 3–4 calls) | 8 | $0.1532 | $0.1949 | $0.1374 |
| StylistPack | 8 | $0.0502 | $0.0555 | $0.0367 |
| Palette | 8 | $0.0000 | $0.0440 | $0.0124 |
| TryOn (+ photo check on the first one) | 19 | $0.0878 | $0.2122 | $0.0920 |

| operation | model | avg in / cached / out / reasoning tokens | cost p50 | cost p95 |
|---|---|---|---|---|
| item_detection | gpt-6-astra | 2904 / 240 / 840 / 70 | **$0.0690** | $0.1088 |
| image_cleanup | gpt-image-2.5-sunburst, auto 1024×1536 | 991 / – / 200 | $0.0125 | $0.0190 |
| image_tryon | gpt-image-2.5-sunburst, auto 1024×1536 | 5489 / – / 760 | $0.0525 | $0.1066 |
| outfit | gpt-6-astra | 1227 / 0 / 462 / 0 | $0.0380 | $0.0427 |
| week_plan (per batch) | gpt-6-astra | 1044 / 0 / 501 / 22 | $0.0338 | $0.0420 |
| packing | gpt-6-astra | 1321 / 0 / 576 / 78 | $0.0510 | $0.0555 |
| photo_check | gpt-6-astra | 2301 / 171 / 58 | $0.0222 | $0.0474 |
| palette_season | gpt-6-astra | 2100 / 0 / 75 | $0.0182 | $0.0440 |
| item_match | gpt-6-astra | 674 / 0 / 76 | $0.0096 | $0.0151 |

**What the baseline shows:**
- **Item detection is the most expensive repeated call, not background removal.** At `auto` quality, cleanup costs about $0.0125 and is mostly input image tokens.
- Reasoning tokens are small everywhere. The money is in input tokens (vision) and output tokens (long ids, detection JSON).
- **Speculative cleanup** (`Ai:SpeculativeItemCleanup`, on via the worker appsettings): 30 of 89 item photos cancelled the speculative call. That is a hit rate of ≈ 66% and costs about +$0.0137 for every multi-piece photo (§5).

## 4. Changes, savings and evidence

Synthetic, uncached, 1 rep per variant unless noted. "Quality" is the guard or expected-answer check: stylist looks accepted by the guard, detection categories against the fixture, photo-check answers, palette season, match index.

| # | change (config) | saves | quality evidence | dev | prod |
|---|---|---|---|---|---|
| 1 | **Compact stylist prompt** — `Ai:CompactStylistPrompt=true`. Aliases `i1…` and one descriptor string per piece instead of JSON with 26-char ULIDs; nulls dropped. Ids are mapped back before the guard. | outfit −40%, pack −55%, week −43% (with effort low) | outfit 3/3 accepted (base 3/3), pack valid (base valid), week 7/7 accepted, 1 repeat (base 2). Titles equivalent: "Deve Tüyü ve Kahverengi / Siyah ve Lacivert Dengesi / Kahverengi ve Krem Uyumu". | recommend (worker/Ai) | recommend |
| 2 | **Reasoning effort low** — `Ai:ReasoningEffort:Default=low` | outfit −10%, week −23%, pack −4%; ≈ 0 on vision ops | identical guard results and detection answers; latency −30% | recommend (worker/Ai) | recommend |
| 3 | **Week in one call** — `Stylist:WeekBatchDays=0` | week −35% (3 calls → 1) | 7/7 accepted, **0** repeated looks (3 batches: 1–2); about +3 s (9.3 s vs 6.4 s) | **on** (template) | owner (latency) |
| 4 | **Vision detail low** for photo check and palette — `Ai:VisionDetail:photo_check=low`, `palette_season=low` | photo check −73% (2030 → 398 input tokens), palette −53% | photo check: identical answers on face and body. Palette: same season (deep-autumn), confidence 0.68 vs 0.76. **Item detection stays high** (jewellery). `item_match` thumbnails are already small, so low detail saves nothing. | recommend (worker/Ai) | photo check: recommend; palette: after more samples |
| 5 | **Flex tier for the background outfit import** — `Ai:ServiceTiers:outfit_import=flex` | −50% on import detection and match | same model, identical answers; latency 5.1 s (non-flex runs of the same call: 7.8–11.4 s; no penalty seen, 1 sample). A flex 429 falls into the import's rate-limit back-off. | recommend (worker/Ai) | recommend |
| 6 | **Try-on image quality low** — `Ai:Image:TryOnQuality=low` | −15% vs medium; −40% on real p50 vs `auto` (auto produced 343–1372 output tokens = $0.037–0.068; low is a flat 158 = $0.031) | side by side: [base 1](ai-cost/tryon-base-1.jpg), [base 2](ai-cost/tryon-base-2.jpg), [low](ai-cost/tryon-tl-1.jpg), [medium](ai-cost/tryon-tm-1.jpg), input [body](ai-cost/input-body.jpg). The face, garments and colours are the same; medium shows slightly crisper knit texture. | recommend (worker/Ai) | owner to eyeball |
| 7 | Cleanup at a smaller size / low quality — **rejected** | −0% (1024×1024 low = 196 output tokens, *more* than auto at 1024×1536 = 158) | [sweater base](ai-cost/cleanup-sweater-base-1.jpg) vs [1024 low](ai-cost/cleanup-sweater-cl1k-1.jpg); [jeans base](ai-cost/cleanup-jeans-base-1.jpg) vs [1024 low](ai-cost/cleanup-jeans-cl1k-1.jpg). Cost is input-dominated (≈ 700–1000 image input tokens). | keep current | keep current |
| 8 | **Daily caps** for AI without credits — SSM `api/AiLimits` (stylist 40/day, recognitions 150/day, palette 5/day, 20 AI starts/min; 429 `ai_limit_reached`) | bounds the worst case (a scripted account) | API test: replay not counted, 3rd stylist start → 429 | **on** (template) | owner (suggested: stylist 15–20/day) |
| 9 | **Structured ops on `gpt-6.1-terra`** — `Ai:FastTextModel=gpt-6.1-terra`, `Ai:FastTextOperations=item_detection,photo_check,item_match,palette_season` | −90% on those ops; item photo −61%, outfit import −78% | all 7 checks identical to astra: same 5 flat-lay pieces incl. the necklace, same photo-check answers, same palette season (conf 0.61), correct matches | **asked the coordinator; not wired** | owner |
| — | `gpt-6-luna` (−99%) / `gpt-6.2-astra` (−8% stylist) / terra for the stylist (−90%, taste) | | luna identical except one stray colour (`denim+cobalt`); terra and luna stylist looks pass the guard but titles differ in taste | not proposed now | owner |

### Prompt texts changed (for the prompt registry, `feat/ai-admin`)

- `src/Infrastructure/Ai/OpenAiProvider.cs` → `OpenAiPrompts.Stylist(kind, language, compactCandidates)`:
  - New constant `OpenAiPrompts.CompactCandidates`. It is appended to the outfit / week / pack system prompt **only when** `Ai:CompactStylistPrompt` is on: *" Each candidate is one string 'id|category|colorIds|fabric|seasons' (lists comma-separated, - = unknown); slots, itemIds, pinnedItemId and avoidCombinations use only the id part (e.g. i7)."*
  - No other prompt text changed.
- The stylist **user message** (not a prompt text) is now built by `Domain/Services/Styling/StylistPrompts` + `CandidateAliases`. It is byte-identical to before when the flag is off (unit-tested).

## 5. Fewer calls

| idea | decision |
|---|---|
| Same-day cache of outfit suggestions (same wardrobe + weather + occasion) | **Rejected.** Every outfit job is an explicit "Başka öneri" / "Kombin öner" tap with a new `requestId`; replaying the day's answer would show the user the same looks they asked to replace. Retries of the same request are already deduped by `requestId`. |
| Dedupe identical requests in flight | Already handled: the `requestId` is the job id, and the app disables the button while a start is pending. |
| Palette cache per face photo, try-on result cache | Already in place. |
| Skip the photo check for a photo already checked | Already in place (`PhotoEntity.InspectedAt`). Re-uploading the same bytes as a new photo is rare and costs $0.006 after change 4. |
| Speculative cleanup (`Ai:SpeculativeItemCleanup`) | Hit rate ≈ 66% on dev. Cost: +$0.0137 on every multi-piece photo, ≈ +$0.005 per item photo on average (≈ 5–10% of the item flow after change 9). It saves one image round trip (≈ 10 s) on single-piece photos. **Keep on** while the wait matters; turn off (worker/Ai `SpeculativeItemCleanup=false`) if cost wins. |
| Rule-based outfits where AI adds little | Already: a wardrobe that cannot dress a day is answered without a model call (GapFill), and so is a failed guard. |
| Batch API for background work | Text in the outfit import is covered by flex (same −50%, synchronous, no poller). Image cleanup after an import commit could use the Batch API (image output $15 instead of $30 per 1M), but needs an async submit/poll worker. That saves ≈ $0.004 per piece: not worth it yet. |
| `max_output_tokens` caps | `Ai:MaxOutputTokens:{op}` exists, unset by default. Answers are short (≤ 900 tokens), so a cap protects only against runaway answers and saves nothing on normal calls. |
| Cached prefix ≥ 1024 tokens | The system prompt + schema are below 1024 tokens for most operations, so cross-user hits are rare. Within a user, repeated calls do hit the cache (seen in the synthetic runs: 1024–2432 cached tokens). `Ai:PromptCacheKey` can stay as is; padding prompts to 1024 would cost more than it saves at current traffic. |

## 6. Background removal: decision

**Keep the generative cleanup. Do not adopt on-device or ONNX segmentation now.**

**Cost.** At the current `auto` quality the cleanup is $0.011–0.014 per piece, about 1/5 of a detection call today. The whole cleanup bill of a heavy user is ≈ $0.9/month.

**What the cleanup actually does.** It is not just background removal. It produces the house product shot: the piece alone, centred, ghost-mannequin or flat, on the sand `#E8E1D7` background with a soft shadow. It also removes hands, bodies and other clothes from crops of worn outfits (outfit import, multi-item photos).

**iOS Vision `VNGenerateForegroundInstanceMaskRequest` (iOS 17+, free on device):**
- It masks the *salient subject*. On a worn outfit that is the whole person, not the garment. It only works for flat-lay or hanging single pieces.
- It needs a native Expo module (Swift) plus an Android equivalent (ML Kit Subject Segmentation, also native). The app has no such module, so this is not native-module-free.
- The result would also need compositing (background, shadow, centring) to match the library's look.

**ONNX on Lambda (rembg-style: U²-Net / IS-Net, Apache-2.0; BiRefNet, MIT):**
- About $0.0002 per image (3 GB × ~3 s).
- Adds a 40–180 MB model and the ONNX runtime to the item-processor (S3 download at init, cold start +2–5 s).
- It has the same limits: no garment-vs-person separation (u2net_cloth_seg only knows upper/lower/full) and no product-shot styling.

**Hybrid option.** Route on-device first for a single flat piece with a clean mask; otherwise call the server. Expected saving: ≈ $0.012 × the share of flat single-piece photos (~50%), i.e. ≈ $0.006 per item photo, about $0.1–0.3 per user per month. That does not pay for a native module on two platforms plus a visible change of the product-shot style.

**Revisit if** the image price rises or `auto` starts producing high-token cleanups (watch `CostMicroUsd` on `ai.image_cleanup`). The native work would be a small Expo module wrapping `VNGenerateForegroundInstanceMaskRequest` (iOS) and ML Kit Subject Segmentation (Android), returning a PNG with alpha. The server would then accept an already-cut image and only composite it.

## 7. Cost per flow and per user

Per-flow USD, synthetic p50. "Settings" = changes 1–6 and 8 (tuning of the current models). "+ terra" = change 9 as well (pending approval).

| flow | before | settings | + terra | saving |
|---|---|---|---|---|
| outfit (3 looks) | $0.0509 | $0.0273 | $0.0273 | 46% |
| week plan | $0.1498 | $0.0435 | $0.0435 | 71% |
| trip pack | $0.0691 | $0.0303 | $0.0303 | 56% |
| item photo (1 piece) | $0.0425 | $0.0425 | $0.0166 | 0% / 61% |
| item photo (3 of 5 kept, + wasted speculation) | $0.1037 | $0.1037 | $0.0524 | 0% / 49% |
| outfit import photo (detect + 3 match + 2 cleanups) | $0.1222 | $0.0721 | $0.0270 | 41% / 78% |
| palette | $0.0176 | $0.0082 | $0.0008 | 53% / 95% |
| try-on | $0.0525 | $0.0314 | $0.0314 | 40% |
| first try-on (+ photo check) | $0.0747 | $0.0373 | $0.0320 | 50% / 57% |

**Monthly usage assumptions:**

| profile | outfit | week | pack | item (1 piece) | item (multi) | import photos | palette | try-ons |
|---|---|---|---|---|---|---|---|---|
| free (lifetime 10 recognitions, one-off) | – | – | – | 8 | 2 | – | – | – |
| light premium | 8 | 1 | – | 8 | 1 | – | – | 5 |
| typical premium | 30 | 4 | 1 | 15 | 4 | 5 | – | 15 |
| heavy premium | 120 | 8 | 3 | 40 | 10 | 30 | 1 | 30 (all credits) |
| typical, onboarding month | 30 | 4 | – | 40 | 10 | 30 | 1 | 15 |

**Net revenue.** The monthly plan is ₺199.99 incl. 20% VAT, minus a 15% store fee = **₺141.66 net**. The yearly plan is ₺1,499.99, which is ₺88.54 net per month.

| profile | before $/mo (₺) | settings (₺) | + terra (₺) | AI cost as share of net monthly: before → settings → terra | share of the yearly plan |
|---|---|---|---|---|---|
| free (one-off) | $0.55 (₺24) | $0.55 (₺24) | $0.24 (₺10) | – | – |
| light premium | $1.29 (₺55) | $0.87 (₺37) | $0.60 (₺26) | 39% → 26% → 18% | 62% → 42% → 29% |
| typical premium | $4.67 (₺201) | $2.91 (₺125) | $2.09 (₺90) | **142% → 88% → 63%** | 227% → 142% → 101% |
| heavy premium | $15.53 (₺668) | $9.57 (₺412) | $6.66 (₺286) | 472% → 291% → 202% | 754% → 465% → 323% |
| typical, onboarding month | $9.36 (₺402) | $6.38 (₺274) | $3.46 (₺149) | 284% → 194% → 105% | 454% → 310% → 168% |

### Margin

- **Before:** a typical premium user cost more in AI than the subscription earned.
- **With the settings-only changes:** the AI share of net revenue is 88% (monthly plan) for a typical user.
- **With terra for the structured ops:** 63%.

The remaining cost is dominated by:
1. **Outfit requests** — unlimited and free of credits: 30 × $0.027 = $0.82 for a typical user, $3.3 for a heavy one.
2. **Try-ons** — credit-capped: 30 × $0.031 = $0.94.
3. **Item and import photos** in the first month.

### Levers left for the owner (pricing and product, not engineering)

1. **A stylist cap.** For example, `AiLimits:StylistJobsPerDay` = 10–15. That bounds the heavy profile at ≈ $8–12 → $4–6.
2. **Terra for the stylist** (−90% on the largest line). Owner taste review of the looks needed.
3. **Fewer try-on credits** on the yearly plan, or a credit price that covers $0.031 per image (₺1.4).
4. **Watch the FX rate.** USD/TRY drift moves every number here one to one.

## 8. Configuration

- **Template (SSM):**
  - `worker/Ai/Pricing` — both stages; accounting only.
  - `api/AiLimits` — on in dev, 0 (off) on prod.
  - `api/Stylist` and `worker/Stylist` — `WeekBatchDays:0` on dev; prod unchanged.
- **Owner-managed `worker/Ai` JSON.** Recommended dev value, settings only:

```json
{"Enabled":true,"Provider":"OpenAI","TextModel":"gpt-6-astra","ImageModel":"gpt-image-2.5-sunburst",
 "ReasoningEffort":{"Default":"low"},"CompactStylistPrompt":true,
 "VisionDetail":{"photo_check":"low","palette_season":"low"},
 "ServiceTiers":{"outfit_import":"flex"},
 "Image":{"TryOnQuality":"low"}}
```

  If terra is approved, add: `"FastTextModel":"gpt-6.1-terra","FastTextOperations":"item_detection,photo_check,item_match,palette_season"`.
