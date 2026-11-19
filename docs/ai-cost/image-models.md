# Cheaper image models: background cleanup and try-on

This is measurement only, done on 2026-11-19 on branch `docs/image-models`. **Nothing is wired in:** no default changed and no dev/prod setting changed.

- **Today's setup** (see [ai-cost.md](../ai-cost.md)): `gpt-image-2.5-sunburst`.
  - Cleanup: about $0.011–0.014 per piece at `auto`.
  - Try-on: about $0.053 per image at `auto` (real p50), or $0.031 at `low`.
- **Prices** are list prices in USD.
- **Contact sheet:**
  - [image-models/index.html](image-models/index.html) is the HTML version. Open it locally, since it uses relative image paths.
  - [image-models/contact-sheet.jpg](image-models/contact-sheet.jpg) is a single overview image.
- **Raw outputs:** under [image-models/](image-models/).

## TL;DR

- **Cleanup: stay on OpenAI.** No candidate is cheaper and still produces our product shot (garment alone, sand `#E8E1D7` background, works on worn crops).
  - `gpt-image-1-mini` at low quality costs 55–60% less, but it drops the sand background, flattens colour and texture, and redraws details.
  - Dedicated background removers are either more expensive ($0.018–0.10) or only cut out the salient subject. A worn crop keeps the body.
  - The general edit models priced at ~$0.010–0.016 would save at most ≈ $0.003 per piece. For that we would need a new sub-processor and new consent.
- **Try-on: stay on OpenAI and apply the already-recommended `Ai:Image:TryOnQuality=low` ($0.031).**
  - `gpt-image-1-mini` is 35–63% cheaper but **changes the person's face** on both the body path and the face path, so it is rejected. It also rejects `input_fidelity` (HTTP 400).
  - Every external option that is cheaper than $0.031 has a privacy blocker for body and face photos:
    - BFL FLUX.2 klein (~$0.019) trains on inputs by default and has no DPA in its terms.
    - Kling (~$0.028), Seedream and Qwen are China-linked.
  - The dedicated try-on APIs (FASHN etc.) charge per garment, so they cost $0.15+ per outfit.
- **Free win, latency only:** `gpt-image-2.5-flare` has the same price per token and the same quality on every fixture, and was 10–55% faster (try-on 12 s vs 28 s at `auto`). Today one `Ai:ImageModel` serves both uses, so switching only one use would need a per-use model setting (small code change, §5). The owner decides.
- **Avoid 2.6 at `auto` for now.** The 2.6 models picked 3–7× more output tokens at `auto` (cleanup $0.029–0.040). They have a `complexity` parameter that we do not send.

## 1. Candidates

### 1.1 OpenAI: models available to the dev key

`ai-cost` / `ai-bench` list them via `GET /v1/models`, run 44584622704. The image models available are:
- `gpt-image-1-mini`
- `gpt-image-1.5`
- `gpt-image-2` (+ `-2026-04-21`)
- `gpt-image-2.5-flare` / `-sunburst` (+ `-2026-09-08`)
- `gpt-image-2.6-flare` / `-sunburst`

`gpt-image-1` is not available.

| model | text in | image in | cached image in | image out | Batch | notes |
|---|---|---|---|---|---|---|
| gpt-image-2.6-sunburst / -flare | 5.00 | 8.00 | 2.00 | 30.00 | 50% | new `complexity` low/medium/high (default high), no fee |
| gpt-image-2.5-sunburst (today) / -flare | 5.00 | 8.00 | 2.00 | 30.00 | 50% | sunburst "editing precision", flare "fast everyday" |
| gpt-image-2 | 5.00 | 8.00 | 2.00 | 30.00 | 50% | `input_fidelity` cannot be changed |
| gpt-image-1.5 | 5.00 | 8.00 | 2.00 | 32.00 | 50% | |
| gpt-image-1-mini | 2.00 | 2.50 | 0.25 | 8.00 | 50% | no `input_fidelity` (400 `invalid_input_fidelity_model`, measured) |

- **Units:** USD per 1M tokens.
- **Sources:** <https://developers.openai.com/api/docs/pricing>, <https://developers.openai.com/api/docs/models/gpt-image-2.6-flare> and <https://developers.openai.com/api/docs/guides/image-generation> (all fetched 2026-11-19). The guide also gives the per-image tables of the older models. For example, `gpt-image-1-mini` costs $0.006 / $0.015 / $0.052 at low / medium / high, 1024×1536.
- **Data handling** (<https://developers.openai.com/api/docs/guides/your-data>):
  - API data is not used for training.
  - Abuse-monitoring logs are kept up to 30 days.
  - Image generation is **Zero Data Retention-compatible** for 2.5-sunburst/flare, 2, 1.5 and 1-mini. The page lists no 2.6 models.
  - Flagged CSAM is kept for review even under ZDR.
  - US processing is covered by the existing consent (`docs/legal/*/consents.md` names OpenAI (US) and AWS (Germany)).
  - This also fills the `[OPENAI RETENTION]` placeholder in `docs/legal/en/privacy.md`: 30 days, or 0 with ZDR.

### 1.2 Other providers: general image-edit models

Desk research only: public pages, no accounts, no uploads. "n/p" means not published. The full source list is in §6.

| candidate | price / image at ~1024×1536 | latency | multi-garment / face path | data region, training, DPA | licence |
|---|---|---|---|---|---|
| Google Gemini **Nano Banana 2.1** (`gemini-nano-banana-2.1`) | $0.0336 at 1K (848×1264); $0.0504 at 2K; Batch half | n/p ("Flash speed") | 10 object + 4 character refs, so all garments in one pass; face path by prompt | paid tier: no training; abuse logs (55 d); "any country"; Vertex EU residency unclear for 3.x image models; Google processor DPA | outputs not claimed by Google; SynthID watermark |
| Nano Banana 2 Lite (`gemini-3.1-flash-lite-image`) | $0.0336 (1K); Batch $0.0168 | n/p ("fastest") | "not optimized for multiple reference inputs" | as above | as above |
| Gemini 2.5 Flash Image | $0.039; Batch $0.0195 | n/p | ≤ 3 refs recommended | as above; Vertex EU multi-region available; shuts down 2027-03-15 | as above |
| BFL **FLUX.2 [klein] 4B** | ≈ $0.016 (cleanup) / ≈ $0.019 (try-on, 4 refs) | "sub-second" | max 4 refs (person + 3 garments) | `api.eu.bfl.ai` EU endpoint; **terms §2(b): perpetual licence to inputs/outputs, "may use Inputs and Outputs to train"**, opt-out by e-mail; no DPA in terms | weights Apache-2.0; outputs owned |
| BFL FLUX.2 [pro] / Kontext pro | ≈ $0.06–0.135 / $0.04 | n/p | 8 refs / limited | as above | API commercial |
| fal **FLUX.2 Flash edit** | ≈ $0.013 ($0.005/MP) | n/p | multi-ref | fal: US; payloads kept 30–90 d unless `X-Fal-Store-IO: 0`; DPA linked; training n/p | fal partner terms |
| **Meta Muse Image** (edit) | $0.01 | n/p | 1–10 refs; fixed ~2.5 MP | n/p | n/p |
| **Microsoft MAI-Image-2.7-Flash** (preview) / MAI-Image-2.7 | ≈ $0.010 / ≈ $0.035 | n/p | n/p (2.7: Arena multi-image edit #3) | Microsoft Foundry; EU and terms n/p for the preview | n/p |
| ByteDance **Seedream 4.5 / 5.5** (BytePlus or fal) ⚠ | $0.04 / ≈ $0.044–0.068 (5.5 incl. $0.008 per input image, 3rd-party) | ~60 s (fal 4.5) | 10 refs | Malaysia / Indonesia / EU; no training without authorisation; flagged content kept 180 d in Malaysia; **ByteDance** | commercial |
| Kling Image 3.0 Omni ⚠ | ≈ $0.028 | n/p | ~10 refs (3rd-party) | Singapore; **Kuaishou (China) parent**; DPA / training n/p | n/p |
| Alibaba **Qwen-Image-Edit** ⚠ | $0.03–0.045 (fal $0.03/MP) | n/p | 1–3 images | Singapore excludes mainland; Frankfurt "Global" scope may run in mainland China | Apache-2.0 weights |

**Quality reference** (Arena image-edit leaderboards, 2026-11-16, <https://arena.ai/leaderboard/image-edit/multi-image-edit>):

| model | multi-image edit | single-image edit |
|---|---|---|
| GPT-Image-2.5 Sunburst | #1 (1527) | #1 (1519) |
| 2.5 Flare | #2 (1475) | |
| MAI-Image-2.7 | #3 (1458) | |
| Nano Banana 2.1 | #6 (1432) | #9 |
| Seedream 5.0 Pro | #8 (1412) | |

Artificial Analysis editing leaderboard (<https://artificialanalysis.ai/image/leaderboard/editing>):

| model | rank | Elo |
|---|---|---|
| MAI-Image-2.7-Flash | #7 | 1179 |
| Muse | #17 | 1129 |
| Nano Banana 2 Lite | #43 | 1052 |
| FLUX.2 klein 9B | #53 | 1013 |

### 1.3 Dedicated virtual try-on services

| candidate | price | latency | limits | data | licence |
|---|---|---|---|---|---|
| **FASHN** Try-On v1.6 | $0.075 per call, **one garment per call**, so $0.15–0.375 per outfit; minimum top-up $7.50 | 5–17 s | tops / bottoms / one-pieces; processed at 864×1296; Face-to-Model gives upper-body avatars only | no training unless you opt in; outputs deleted after 3 d (base64: 60 min); request records kept indefinitely (delete by e-mail); GCP "Global"; **DPA available** | commercial |
| FASHN Try-On Max / Agent Images | 1–5 credits ($0.075–0.375) per call | 10–55 s / ~40 s | Max: 1 product per call; Agent: up to 6 images, multi-garment not documented | as above | commercial |
| Kling Kolors Virtual Try-On | $0.07 per garment (fal) | n/p | 1 garment; **retired 2026-09-15**, fal marks it "no longer supported" | Singapore; China parent | – |
| BFL FLUX VTO (`flux-tools/vto-v1`, klein-based) | n/p (fal ≈ $0.0375 + $0.005/MP, 3rd-party) | "low latency" | 1 garment field; multi-garment only by pasting a 2×2 grid | BFL terms (trains on inputs) | API |
| fal image-apps-v2 virtual-try-on | $0.04 per garment | n/p | 1 garment | fal | n/p |
| Leffa / CatVTON / IDM-VTON | $0.10 / per GPU-second / – | – | 1 garment | – | IDM-VTON CC BY-NC-SA, CatVTON research-only: not usable commercially |

### 1.4 Dedicated background removal / product-shot services

| candidate | price / image | removes the body from a worn crop? | ghost mannequin / bg colour + shadow | data | notes |
|---|---|---|---|---|---|
| **Photoroom** Remove Background API | $0.02 | no (salient subject) | – | US only ("EU-only residency isn't available"); images discarded after the call; DPA Enterprise only; training stance contradictory (self-serve plans may train, opt-out) | free sandbox |
| **Photoroom** Image Editing API (Plus) | $0.10 (all options) | not documented (ghost mannequin removes a *mannequin*) | ghost mannequin (1K), hex bg `E8E1D7`, AI soft shadow | as above | 1,000 watermarked calls per month free in the sandbox |
| remove.bg (moving to Leonardo.Ai on 2026-12-01) | ≈ $0.10 (3rd-party) | no | bg_color + shadow, no ghost mannequin | n/p | 50 free calls per month |
| Clipdrop (Jasper) | sales-only | n/p | n/p | n/p | public pricing removed |
| Bria API | $0.018 (RMBG) – $0.03 (packshot) | prompt-guided, unclear | packshot + shadow, no ghost mannequin | n/p | 100 free calls; RMBG-2.0 weights CC BY-NC (API includes commercial licence) |
| Pixelcut | $0.05 cut-out / $0.10 background | no | generated bg | n/p | |
| Claid.ai | 2 credits (≈ $0.12–0.16, 3rd-party) | "AI fashion" on-model | AI bg | n/p | |
| Replicate rembg | ≈ $0.0044 | no | cut-out only | Replicate deletes I/O after 1 h | MIT; same limits as the ONNX option in [ai-cost.md §6](../ai-cost.md) |
| Runflow on-model removal | $0.30 | **yes** | ghost mannequin / flat lay | zero retention by default, EU residency option | 25× today's cost |

**Public demos needing no account** were described only and not used with our fixtures:
- Hugging Face Spaces for Kolors VTON, IDM-VTON, Leffa and BiRefNet.
- Arena blind battles.

All of these would mean uploading body photos to a third party.

## 2. Side-by-side measurement (OpenAI, dev key)

**How it was run:** `ai-cost --synthetic-only --image-only --max-calls 30 --image-variants …`, run [44585182785](https://github.com/fehmianac/droblet/actions/runs/44585182785).
- The prompts and request code are the workers' own (`OpenAiProvider.CleanupItemAsync`, `RenderAsync`, `RenderFromFaceAsync`).
- **Fixtures:** the synthetic sweater photo, the jeans crop of the flat lay (cut by the item worker's crop maths), the body photo, and the face photo (figure: pear, 165 cm, M). The sneakers and tote crops come from the same flat lay.
- **Volume:** 28 image calls, plus 2 rejected calls (`minihf`, 400). That is within the 30-call budget. One sample per cell, so read the costs at `auto` as indicative, not as p50.
- **Score (1–5):**
  - garment fidelity (colour, texture, details)
  - identity (same face)
  - head-to-feet framing
  - artefacts
  - for cleanup: the house product-shot look

### Cleanup

| model / quality | sweater: cost · out tok · s | jeans crop: cost · out tok · s | score | what we see |
|---|---|---|---|---|
| **2.5-sunburst auto (today)** | $0.0137 · 158 · 11.9 | $0.0166 · 343 · 17.1 | **5** | sand background, true navy, knit texture, jeans seams and wash kept |
| 2.5-flare auto | $0.0137 · 158 · 10.5 | $0.0166 · 343 · 11.7 | **5** | indistinguishable from today |
| 2.6-sunburst auto | $0.0288 · 664 · 11.5 | $0.0402 · 1132 · 16.7 | 5 | same look; auto chose 3–4× the output tokens |
| 2.6-flare auto | $0.0288 · 664 · 8.3 | $0.0402 · 1132 · 9.5 | 5 | same look, fastest |
| 1-mini auto | $0.0155 · 1584 · 17.9 | $0.0147 · 1584 · 18.0 | 2–3 | **white background** (ignores the sand colour), darker navy, texture lost |
| 1-mini low | $0.0061 · 408 · 11.2 | $0.0053 · 408 · 12.3 | 2 | white background, near-black sweater, jeans waistband redrawn, uniform wash |
| 1.5 auto | $0.0622 · 1872 · 14.6 | $0.0654 · 1938 · 16.8 | 2–3 | white background, purple shift, garment small in frame |

- Image input tokens are the same for every 2.x model (1024 sweater / 693 jeans), so **at the same quality all 2.x models cost the same**. The differences above come from the output size `auto` picked.
- `gpt-image-1.5` read the inputs at low fidelity (194 / 323 tokens) but output ~1900 tokens.

### Try-on

| model / quality | body + 2 (sweater, jeans) | body + 4 (+ sneakers, tote) | face + 3 | score | what we see |
|---|---|---|---|---|---|
| **2.5-sunburst auto (today)** | $0.0678 · 1372 tok · 28.0 s | $0.0807 · 27.3 s | $0.0341 · 158 tok · 13.1 s | **5** | same face, all pieces, head to feet |
| 2.5-sunburst **low** (from [ai-cost.md](../ai-cost.md) #6) | $0.031 (158 tok) | – | – | 5 | "face, garments and colours the same" |
| 2.5-flare auto | $0.0314 · 158 · 12.1 s | – | $0.0397 · 343 · 14.3 s | **5** | same face and fit as today |
| 2.6-sunburst auto | $0.0678 · 26.8 s | – | $0.0634 · 14.0 s | 4 | face path adds a white tee under the sweater |
| 2.6-flare auto | $0.0465 · 9.3 s | – | $0.0634 · 10.2 s | 5 | same face, fastest |
| 1-mini auto | $0.0210 · 19.0 s | $0.0222 · 17.9 s | $0.0204 · 16.6 s | **2** | **another woman's face** on both paths; darker sweater; extra white tee on the face path |
| 1-mini low | $0.0116 · 10.4 s | – | $0.0110 · 12.1 s | **1** | another face, different hair, teal-navy sweater |
| 1-mini low + `input_fidelity=high` | 400 `invalid_input_fidelity_model` | – | 400 | – | not supported on mini |

- The face crops are side by side in the last row of the [contact sheet](image-models/contact-sheet.jpg).
- Every model framed head to feet with shoes visible.
- With 4 garments, sunburst image input grows to 4853 tokens (+$0.013 vs 2 garments); mini's only to 3746. Mini cannot be given `input_fidelity=high` (400), so there is no setting that would make it keep the face.

## 3. Recommendation

### 3.1 Cleanup (today $0.0125 p50)

| candidate | cost / image | saving vs now | quality (1–5) | latency | privacy / KVKK fit | integration effort |
|---|---|---|---|---|---|---|
| **gpt-image-2.5-sunburst auto (stay)** | $0.0137–0.0166 (measured), $0.0125 p50 (real) | – | 5 | 12–17 s | ✅ existing consent, ZDR-eligible | none |
| gpt-image-2.5-flare auto | $0.0137–0.0166 | 0% | 5 | 10.5–11.7 s (−15 to −30%) | ✅ same | config: `Ai:ImageModel` (also moves try-on), or per-use model (§5, ~0.5 d) |
| gpt-image-2.6-sunburst / -flare auto | $0.029–0.040 | **−130 to −220% (dearer)** | 5 | 8–17 s | ✅ (ZDR list does not name 2.6 yet) | config; would need `complexity=low` (code) to retest |
| gpt-image-1-mini low | $0.005–0.006 | +55–60% | 2 | 11–12 s | ✅ | config + **own compositing** (transparent output + sand bg + shadow, ~1–2 d) to fix the background; texture loss remains |
| gpt-image-1.5 auto | $0.062–0.065 | −380% | 2–3 | 15–17 s | ✅ | config |
| Meta Muse Image / MAI-Image-2.7-Flash | ≈ $0.010 | ≈ +20% (−$0.003) | unmeasured (AA #17 / #7) | n/p | ❌ new sub-processor; data terms n/p | new provider class, ~2–3 d |
| fal FLUX.2 Flash edit / BFL klein 4B | ≈ $0.013 / ≈ $0.016 | ≈ 0% / −15% | unmeasured | klein "sub-second" | ❌ fal US + retention headers; BFL trains on inputs | ~2–3 d |
| Nano Banana 2 Lite / 2.1 | $0.0336 (Batch $0.0168) | −170% (Batch −35%) | unmeasured | n/p | ⚠ Google DPA, no training on paid tier; new consent | ~2–3 d (+ async poller for Batch) |
| Photoroom Plus (ghost mannequin, hex bg, shadow) | $0.10 | −700% | unmeasured; worn crops not documented | n/p | ⚠ US only, DPA Enterprise only | ~2 d |
| Photoroom / Bria / remove.bg cut-outs | $0.018–0.10 | −45 to −700% | cut-out only; keeps the body on worn crops | n/p | ⚠ / n/p | ~2 d + compositing |
| Replicate rembg | $0.0044 | +65% | cut-out only, no ghost mannequin | < 5 s | ⚠ US, 1 h deletion | ~2 d + compositing; the ONNX self-host in ai-cost.md §6 is cheaper still |

**Recommendation for cleanup: stay on `gpt-image-2.5-sunburst`.**
- **Optional:** run cleanup on `gpt-image-2.5-flare` for the shorter wait. Same cost, same look on both fixtures.
- **Not worth a new sub-processor:** the best possible external saving is about $0.003 per piece, roughly $0.03–0.13 per user per month.

### 3.2 Try-on (today $0.053 p50 at auto; $0.031 at low, already recommended)

| candidate | cost / image | saving vs now (auto → / low →) | quality (1–5) | latency | privacy / KVKK fit | integration effort |
|---|---|---|---|---|---|---|
| **gpt-image-2.5-sunburst low (recommended in ai-cost.md #6)** | $0.031 | −40% / – | 5 | ≈ 12–15 s | ✅ | config only: `Ai:Image:TryOnQuality=low` |
| gpt-image-2.5-flare (auto or low) | $0.031–0.040 measured; = sunburst at low | −25 to −40% / 0% | 5 | 12–14 s (vs 13–28 s) | ✅ | config `Ai:ImageModel`, or per-use model (§5) |
| gpt-image-2.6-flare / -sunburst auto | $0.047–0.068 | ≈ 0% / dearer | 4–5 | 9–27 s | ✅ (2.6 not yet on the ZDR list) | config |
| gpt-image-1-mini auto / low | $0.020–0.022 / $0.011–0.012 | −60% / −63% | **1–2 (identity lost)** | 10–19 s | ✅ | config: **rejected on quality** |
| FLUX.2 [klein] 4B (BFL) | ≈ $0.019 (max 3 garments) | −64% / −39% | unmeasured | "sub-second" | ❌ trains on inputs by default; no DPA in terms; EU endpoint exists | new provider ~3 d |
| Kling Image 3.0 Omni | ≈ $0.028 | −47% / −10% | unmeasured | n/p | ❌ China-linked parent, Singapore | ~3 d |
| Nano Banana 2.1 | $0.034 at 848×1264 + ≈ $0.01 inputs; $0.050 at 2K | +15% / −40% (dearer than low) | unmeasured (Arena #6) | n/p | ⚠ Google DPA, paid tier no training, new consent | ~3 d |
| MAI-Image-2.7 / -Flash | ≈ $0.035 / ≈ $0.010 | +34% / −68% (Flash) | unmeasured (2.7: Arena #3; Flash multi-ref n/p) | n/p | ⚠ preview, terms n/p | ~3 d |
| Seedream 4.5 / Qwen-Image-Edit | $0.03–0.07 | ≈ 0% / dearer | unmeasured | ~60 s | ❌ ByteDance / Alibaba | ~3 d |
| FASHN v1.6 | $0.15–0.375 per outfit (per garment) | dearer | unmeasured | 5–17 s per garment, chained | ✅-ish: DPA, no training, GCP global | ~3 d + chaining |

**Recommendation for try-on: stay on OpenAI.**
- Apply `TryOnQuality=low` ($0.031). This was already recommended and is the largest saving that needs no new vendor.
- Optionally move try-on to `gpt-image-2.5-flare`: same price at low, about 2× faster at `auto`.
- **The only external candidates worth a real A/B** are:
  - **MAI-Image-2.7-Flash** (≈ $0.010, if its multi-reference quality and EU terms hold up).
  - **Nano Banana 2.1**, as a quality reference. It is not cheaper.
- **Heavy-user impact:** the maximum realistic saving is about $0.02 per try-on, about $0.6 per month for a heavy user (30 try-ons). It is not large enough to justify the consent change before quality is proven.

## 4. What the owner must provide or decide

| option | keys / accounts | legal | decision |
|---|---|---|---|
| Try-on `low` (ai-cost.md #6) | – | – | set `"Image":{"TryOnQuality":"low"}` in `worker/Ai` (dev first) |
| Flare for both uses (latency) | – | – | set `ImageModel=gpt-image-2.5-flare` in `worker/Ai` on dev, eyeball for a week |
| Flare for one use only | – | – | approve the per-use model setting (§5) |
| OpenAI Zero Data Retention | request ZDR for the org from OpenAI (all our image models except 2.6 are eligible) | update `privacy.md` `[OPENAI RETENTION]`: 30 days, or 0 with ZDR | owner |
| Real A/B of external models | one **fal.ai** API key covers FLUX.2 klein/flash, Muse, Nano Banana, Seedream and Qwen (send `X-Fal-Store-IO: 0`); a **Gemini paid API key** (GCP billing project, or a Vertex project in an EU region); an **Azure Foundry** project for MAI-Image-2.7(-Flash); optional **FASHN** ($7.50 top-up), **Photoroom** sandbox key (free, watermarked), **Bria** (100 free calls), **BFL** key on `api.eu.bfl.ai` with a "Training Opt Out" e-mail sent first | synthetic fixtures only (as here), so no consent is needed for the A/B itself | owner creates the keys and puts them in SSM as SecureStrings, e.g. `/droblet/dev/worker/Ai/Providers/{name}/ApiKey` |
| Going live with any non-OpenAI provider | production key + DPA signed (Google processor terms, FASHN DPA, Photoroom Enterprise, Microsoft DPA) | **consent texts change.** `docs/legal/{tr,en}/consents.md` name "AWS (Germany) and OpenAI (US)" in each AI consent statement (body photo, face/palette, face try-on); a new processor and country must be added, KVKK aydınlatma metni + yurt dışı aktarım updated, and existing users **re-consent** before their photos go to the new processor | owner + legal review |
| Not acceptable without a contract change | BFL (terms grant training on inputs), BytePlus/Seedream, Kling, Alibaba (China-linked) | – | – |

## 5. Code it would take, behind config

**How pluggable is the abstraction today?** There is no `IImageProvider`. The workers depend on narrow capability interfaces in `src/Domain/Services/Ai/AiCapabilities.cs`:
- `IItemImageCleanup.CleanupItemAsync`: item worker and outfit import.
- `IImageCleanup.CleanupAsync`.
- `ITryOnRenderer.RenderAsync` / `RenderFromFaceAsync`: try-on worker.

`AddDrobletAi` (`src/Infrastructure/DependencyInjection.cs`) binds all of them to the single `OpenAiProvider` singleton. Swapping a provider is therefore a DI change. The workers do not change.

**Coupling that a new provider would have to repeat:**
- **Prompts** live in `OpenAiPrompts` (`TryOn`, `TryOnFromFace`, `CleanupItem`). They are plain text and can be reused.
- **Size/quality** come from `AiOptions.ImageFor(use)`.
- **Cost and telemetry** run through `OpenAiProvider.SendAsync` → `AiCost.Estimate` / `AiTelemetry`. A per-image provider needs a per-image price in `Ai:Pricing` (`AiModelPrice` is token-based today; add e.g. `PerImage`).

**Changes, smallest first:**

1. **Per-use OpenAI model** (no new vendor, ~0.5 day):
   - add `Ai:Image:CleanupModel` / `Ai:Image:TryOnModel`, falling back to `Ai:ImageModel`;
   - `EditImageAsync` picks the model from the `ImageUse` it already receives;
   - add a unit test.
2. **`complexity` for the 2.6 models** (~0.5 day, if 2.6 is wanted): add `Ai:Image:{Use}Complexity`, sent only when set; re-measure with `ai-cost`.
3. **A new provider per use** (~2–3 days each, plus legal):
   - **Config:** `Ai:Image:Provider:Cleanup` / `Ai:Image:Provider:TryOn` = `OpenAI` (default) | `Gemini` | `Fal` | …, plus `Ai:Providers:{name}:{ApiKey,BaseUrl,Model}`.
   - **Implementation:** a new `Infrastructure/Ai/{Name}ImageProvider : IItemImageCleanup, IImageCleanup, ITryOnRenderer`, reusing `OpenAiPrompts` and recording `AiTelemetry` / `AiCost` calls.
   - **Routing:** a `RoutingImageProvider` (same pattern as `RoutingPushProvider`) registered for the three interfaces. It reads `IOptionsMonitor<AiOptions>` per call, so the switch is live from SSM with no deploy, and it falls back to OpenAI if the provider is not configured.
   - **Tests:** DI tests for routing, payload tests per provider, and an `ai-cost` image-variant key `provider=…` to A/B it the same way as here.
4. Batch (Gemini/OpenAI 50% off) only fits cleanup after an outfit import. It needs an async submit/poll worker, already judged not worth it in ai-cost.md §5.

## 6. Measurement code added (Ops only)

Changes are in `tools/Ops/Commands/AiCostLog.cs` and `AiCostCommand.cs`. Measurement only; nothing in `src/` changed.
- **New image-variant key `imagemodel=`:** any OpenAI image model, applied to that variant's copy of the options.
- **New `uses=` tokens:**
  - `tryon4`: body + sweater, jeans, sneakers, tote.
  - `tryonface`: face path + 3 garments, figure pear/165/M.
  - The default stays `cleanup|tryon`.
- **Extra crops:** sneakers and tote crops are cut from the flat-lay detection the run already makes.
- **Pricing:** in-process list prices for `gpt-image-2.6-*` and `gpt-image-1.5`, used only when the stage's price list lacks them, so those variants are priced.

**Example run:**
```
gh workflow run ops-dev.yml --ref docs/image-models -f command=ai-cost \
  -f args="--synthetic-only --image-only --max-calls 30 --image-variants base:uses=cleanup|tryon|tryon4|tryonface;f25:imagemodel=gpt-image-2.5-flare,uses=cleanup|tryon|tryonface;minilow:imagemodel=gpt-image-1-mini,quality=low"
```

### Sources (fetched 2026-11-19)

**OpenAI:**
- <https://developers.openai.com/api/docs/pricing>
- <https://developers.openai.com/api/docs/guides/image-generation>
- <https://developers.openai.com/api/docs/models/gpt-image-2.6-flare>
- <https://developers.openai.com/api/docs/guides/your-data>

**Google:**
- <https://aistudio.google.com/docs/pricing>
- <https://aistudio.google.com/docs/image-generation>
- <https://aistudio.google.com/docs/terms>
- <https://aistudio.google.com/docs/usage-policies>
- <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-image>
- <https://cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency>

**BFL:**
- <https://bfl.ai/pricing>
- <https://bfl.ai/legal/eu-api-service-terms> (§2(b), revised 2026-08-26)
- <https://bfl.ai/legal/flux-api-service-terms>
- <https://bfl.ai/legal/privacy-policy>
- <https://docs.bfl.ai/flux_2/flux2_overview>
- <https://docs.bfl.ai/flux_tools/flux_vto.md>
- <https://help.bfl.ai/articles/9532536301-which-api-endpoint-should-i-use>
- <https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence>

**fal / Replicate:**
- <https://fal.ai/pricing>
- <https://fal.ai/docs/model-apis/data-retention>
- <https://fal.ai/privacy>
- <https://fal.ai/models/fal-ai/flux-2/edit/llms.txt>
- <https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit>
- <https://fal.ai/models/meta/muse-image/edit/llms.txt>
- <https://fal.ai/models/fal-ai/kling/v1-5/kolors-virtual-try-on>
- <https://fal.ai/models/fal-ai/image-apps-v2/virtual-try-on/llms.txt>
- <https://fal.ai/learn/tools/best-virtual-try-on-apis-2026>
- <https://replicate.com/docs/topics/predictions/data-retention>
- <https://replicate.com/cjwbw/rembg>

**FASHN:**
- <https://fashn.ai/pricing>
- <https://docs.fashn.ai/api-reference/tryon-v1-6>
- <https://docs.fashn.ai/api-reference/tryon-max>
- <https://docs.fashn.ai/api-reference/agent-images>
- <https://docs.fashn.ai/api-reference/face-to-model>
- <https://docs.fashn.ai/api-overview/data-retention-privacy>
- <https://fashn.ai/legal/subprocessors>

**Kling:**
- <https://kling.ai/document-api/pricing/base/image.md>
- <https://kling.ai/document-api/api/image/virtual-try-on.md>
- <https://kling.ai/docs/privacy-policy>

**ByteDance / Alibaba:**
- <https://docs.byteplus.com/docs/en/modelark/BytePlus_ModelArk_Data_Processing.md>
- <https://www.byteplus.com/product/Seedream>
- <https://docs.apiyi.com/en/api-capabilities/seedream-image/seedream-5-5-pricing> (3rd-party)
- <https://www.alibabacloud.com/help/en/model-studio/model-qwen-image-edit>
- <https://www.alibabacloud.com/help/en/model-studio/germany-frankfurt-global>
- <https://huggingface.co/Qwen/Qwen-Image-Edit-2511>

**Meta / Microsoft:**
- <https://dev.meta.ai/models/muse-image/>
- <https://scalevise.com/resources/microsoft-mai-image-2-7-flash-canvas-platform-rollout/> (3rd-party)
- <https://vercel.com/ai-gateway/models/mai-image-2.7-flash>

**Background removal:**
- <https://www.photoroom.com/api/pricing>
- <https://docs.photoroom.com/image-editing-api-plus-plan/ghost-mannequin>
- <https://docs.photoroom.com/image-editing-api-plus-plan/ai-shadows>
- <https://www.photoroom.com/platform/security>
- <https://www.remove.bg/api>
- <https://www.photoroom.com/blog/remove-bg-api-cost-leonardo-ai-vs-photoroom> (3rd-party price)
- <https://bria.ai/pricing>
- <https://huggingface.co/briaai/RMBG-2.0>
- <https://www.pixelcut.ai/api>
- <https://claid.ai/api-pricing>
- <https://www.runflow.io/api/on-model-removal>
- <https://usagepricing.com/blueprint/activity/clipdrop-2026-06-04-api-pricing-delisted>

**Leaderboards:**
- <https://arena.ai/leaderboard/image-edit/multi-image-edit>
- <https://arena.ai/leaderboard/image-edit>
- <https://artificialanalysis.ai/image/leaderboard/editing>
