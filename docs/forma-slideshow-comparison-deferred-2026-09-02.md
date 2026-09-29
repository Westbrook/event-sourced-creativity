# Deferred composition and editorial-repair comparison

Prepared 2026-09-02. **Research plan only: no provider calls or production changes.** Stages B–D below are separately gated and deferred. The four first-pass calls in Stage A do not cover repair quality or representative-case generalization.

Existing proposals:

- First stage: [four-arm composition proposal](forma-slideshow-comparison-proposal-2026-09-02.md) — four manual composition arms, $1.50 rounded ceiling.
- The earlier 23-call / $14.18 study used a different 25,000-output-token cap. It is **superseded for immediate admission**, not an additional approved allowance.

## Fixed cases

Freeze the final tested code revision, adapter/validator version, complete source and request settings, instructions, schema, page scope, and wire input before admitting any stage. The native source must remain the exact authorized six-slide document, not a fixture substituted for it.

| Case | Exact input | Fixed extent and purpose | Output cap per call |
| --- | --- | --- | ---: |
| N | Authorized private snapshot of **One document. More ways to use it.**, reused from Stage A | Complete manual six-slide document; exact source-authored bookends, present capabilities versus future possibilities, genuine visible redundancy | 6,500 |
| E | `tests/fixtures/presentation-executive-source.json`, its `snapshot` | Managed page 0 of 2: global slides 1–8 of the authored 12-slide outline; score precision, attributed quotations, source/chapter grounding | 9,600 |
| M | `tests/fixtures/presentation-managed-23.json`, its `snapshot` | Managed page 2 of 3: global slides 17–23; source/chapter isolation, locked theme, prior-copy continuity, complete global closing | 8,400 |

E and M are **page-level** comparisons, not paid tests of full 12-/23-slide orchestration. Existing mocked tests retain that separate orchestration coverage. Use the real managed source/page builders and preserve canonical-to-page-local passage identity. Do not discard unrelated mandatory evidence merely to fit a page. Use faithful, field-notes settings consistently, unless the frozen fixture's authored requirements prescribe otherwise.

For M, prepare once an offline synthetic prior-pages state from the same fixture. Freeze its locked presentation, prior visible copy, prior summary and prior ending. No preceding paid pages are included in this plan. Label that state synthetic, not previously generated native output. Both compared models receive its identical bytes.

The caps above preserve the current adapter rule for managed pages: `max(6500, min(12000, itemCount * 1200))`. A six-slide managed page would instead use 7,200, but N is manual and remains at 6,500. Do not silently set every fixture to the six-slide cap or to 25,000.

### Source-file identity at preparation

| Fixture | SHA-256 of exact file bytes |
| --- | --- |
| `tests/fixtures/presentation-executive-source.json` | `fae4a897a4bbafa9374acbad6ff23332668f4eb5da9e25b90eda2e144396d16c` |
| `tests/fixtures/presentation-managed-23.json` | `ddbc1e855213825133b5ed2afb7281c748f74094b0b15bf581cacb19d40f3a56` |
| `tests/fixtures/presentation-forma-benefits-source.json` | `e639c44f69c712e161a30dbeb8bbbd83a2fa1da1287cd4244a0caf6c41fade19` |

The benefits fixture is an **offline companion**, not proof of a recovered native deck. Its `sourceSnapshot`, `syntheticOutput` and `observedRepairCopy` support the existing exact-bookend/three-genuine-duplicate regression cases in `tests/presentation-protected-messages.test.mjs`. Preserve that distinction in evaluation reports.

## Fixed editorial inputs

An editorial arm gets exactly one complete rewrite request against the same source, candidate, issue list and editorial brief as its peers. It does not first buy its own composition. Use the slideshow editorial route; label the actual phase (`validation-repair` or `editorial-rewrite`) honestly and keep it identical across each case's arms. No nested validation repair is included.

- **N:** Before Stage B, bind one complete, source-matching retained candidate and its exact local validation/editorial issues. Prefer an already retained candidate from this exact source; otherwise use the complete Terra-medium Stage A response by a predeclared rule, not whichever arm is easiest to repair. Do not substitute empty/truncated output or mismatched old source. The editorial task preserves both exact bookends while removing genuine within-slide repetition and making the approved progression readable. If a safe complete candidate cannot be bound, Stage B stays deferred; it does not acquire an extra composition call.
- **E and M:** Prepare deterministic source-faithful candidates offline using the existing `faithfulSlides` recipe in `tests/presentation-source.test.mjs` and the real page-source mapping. Include the exact source facts, quotation text and attributions. Freeze a complete schema-valid envelope and locked presentation. For a controlled editorial defect, duplicate the already visible body of global slide 4 (E) or global slide 20 (M) into that slide's `visual.value`, keeping every other field unchanged. Validate locally that this introduces the intended genuine redundant-copy issue without corrupting source numbers, quotation text, citation authority or page count. If it does not, stop preparation and revise the test case before any admission; do not silently adjust it between arms.

Record hashes of each complete candidate, issue list, editorial brief, page/prior context and final serialized request. The candidate payloads have **not yet been materialized or assigned invented hashes by this note**. Those bindings and offline checks are required before paid admission. Dedicated editor evaluation must not fabricate a prior paid composition receipt or reuse an old request identity. If the available execution authority cannot admit a single editor-only evaluation call honestly, leave the stage deferred.

## Separately gated matrix

All calls: at most **64,000 input tokens** under the conservative complete-wire bound, standard service tier, explicit cache mode with no breakpoints, one sample per arm, serial dispatch, and no automatic second request. Construct the entire request including instructions, source, schema, previous candidate and issue list before checking the bound; reject oversize input rather than clipping evidence. Freeze a comparison digest excluding only model and requested effort, plus a full digest for every arm.

| Stage | Work and arms | Maximum calls | Conservative tariff sum | Rounded stage ceiling |
| --- | --- | ---: | ---: | ---: |
| A — existing first stage | N composition: Terra medium/high, Sol medium/high | 4 | $1.376 | $1.50 |
| B — deferred editor sweep | N fixed-input editor: Terra medium/high, Sol medium/high | 4 additional | $1.376 | $1.50 additional |
| C — deferred representative composition | E and M: Terra and Sol at one common composition effort selected before this stage | 4 additional | $1.536 | $1.60 additional |
| D — deferred representative editor | E and M: Terra and Sol at one common editorial effort selected before this stage; fixed candidates above | 4 additional | $1.536 | $1.60 additional |
| Maximum if all stages are independently admitted | 8 Terra and 8 Sol calls; no hidden prerequisite generation | **16** | **$5.824** | **$6.20** |

Stages C and D deliberately compare **two arms**, not all four. Select the common effort for each workflow using its earlier native-case sweep: choose medium if both models clear the source/accounting/quality gates there; otherwise choose high only if both high arms do. If neither common effort qualifies, stop that workflow's representative stage. Composition and editor effort may differ. Freeze the choice before seeing representative outputs. This is exploratory, selected-arm evidence; do not claim a complete four-arm representative sweep.

Conservative per-call maxima retain the helper's all-input-cache-write bound even though explicit no-breakpoint requests disable caching:

| Output cap | Terra maximum | Sol maximum |
| ---: | ---: | ---: |
| 6,500 | $0.2380 | $0.4500 |
| 9,600 | $0.2752 | $0.5120 |
| 8,400 | $0.2608 | $0.4880 |

Prices are frozen from the current `openai-text-2026-09-02` standard short-context helper. Output includes reasoning, not only visible JSON. If the tariff, route, source, schema, effort or cap changes, require a new manifest and budget calculation. A larger-cap experiment is excluded from all ceilings above.

## Original-budget gate and stop rules

The **additional B–D ceiling is $4.70**, not $14.18. Using only the old $11.405443 charged-plus-unresolved exposure as an illustration, A–D's $6.20 ceiling would leave **$12.394557 under the original $30**. This is not a fresh balance and does not resolve either old $1 hold. Refresh charges, unresolved calls and outstanding reservations before each stage; if Stage A is already recorded, do not add its ceiling again to the same exposure.

Native completion takes priority over these deferred stages. Preserve at least $10 of the refreshed remaining allowance for that delivery/contingency until it is completed or a separate explicit budget decision changes that guardband. Account for actual application reservation floors: if they exceed these mathematical sums, re-bound or omit a whole stage before admission; do not bypass the floor or release unrelated holds. Unspent allowance does not automatically authorize a later stage or repeated samples.

Stop the stage on ambiguous submission, identity mismatch, incomplete/malformed usage, contradictory cache/tier evidence, failed durable response capture, changed authorization, or the approved deadline. Keep unresolved allowance and do not resend. Pause on output-limit truncation to review the cap separately. No extra repair, paid judge, external research, image generation, source edit, native-output overwrite, podcast rerender or video rerender is included.

Report composition validity separately from editorial improvement. Retain exact request/response identities, per-call model/effort/tariff/caps, raw-response references, usage and cache derivations, source/quote/count failures, genuine duplicate pairs, and native-viewer/export inspection. Sum frozen per-call charges rather than repricing under the final model. Measure dispatch-to-response, durable-capture and local validation/rendering separately. One observation per arm is not p95, stable quality superiority, or production-default approval.
