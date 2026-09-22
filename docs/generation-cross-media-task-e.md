# Task E — cross-media outcome adoption and handoff

22 September 2026. Local implementation only, based on current main `2a0caa914a0c57002f9b69ff3b60cb3d6d8a687f`, reread before editing and before handoff. `faa8fb42` is the verified foundation release baseline, not current-main pinning. Published A (503), B/F (504), and K (509) were reused without cherry-picks or model migrations.

## Delivered changes

`worker/planner-response-outcome.ts` interprets received Responses envelopes using A's existing outcome types. Explicit refusal and `incomplete_details.reason=content_filter` outrank parseable partial text. Incomplete/non-completed responses and provider errors stop before schema repair. It does not infer safety from prose, model identity, usage absence or storage failure, accept artifacts, price usage, or grant authority. `providerModerationStage` remains unknown. A clean envelope leaves content unknown until the existing modality validator assesses it. Missing status remains compatible with legacy generic receipts; native completion requirements remain strict.

The coordinated `worker/openai-adapter.ts` integration checkpoints source-free financial completion before fallible document response retention. Native Storyboard and Video raw-envelope retention now follows that checkpoint when the complete envelope can be parsed. Malformed/partial raw envelopes still reach bounded private custody with their original unresolved purchase; no measured usage is fabricated from a prefix. Each private callback retains its own existing authority and lifetime checks. Failure prevents downstream work. Native Storyboard's raw-envelope SQL allows an already-settled original call while still requiring the exact owner, job, slot, request digest, current lease and unexpired job. Video already allowed that financial state.

The parser adds safe content/accounting observations to existing paid receipts, and A's full outcome to planner errors. It does **not** install A's full private `GenerationEvidenceObserver` across every route or claim that a received candidate is usable. The standalone Scene and private Memory custody implementations are unchanged.

H explicitly coordinated ownership of the narrow adapter hunks. No edits to `worker/document-jobs-api.ts`, A shared types, creative prompts, provider routing, retries, production settings or activation. No attached moderation gate was added; L can reuse `tests/planner-response-outcome-fixtures.mjs`.

## Per-modality adoption and gaps

| Boundary | Current route / existing foundation | Verified in E | Remaining adoption or modality-specific work |
| --- | --- | --- | --- |
| Shared image | Low quality selects OpenAI Flare; configured high quality OpenAI Sunburst; high quality Fal remains a distinct route. A already supplies stage evidence and strict standalone moderation. | Existing A evidence, request parity, Flare routing and provider-error suites pass. Usable-image/unknown-usage and storage-outcome distinction remain covered. | No new image efficacy claim or model migration. E's document parser is not installed in the separate creative-direction planner. |
| Story / narrative | Generic Responses planner; native narrative has its own exact model, completion, one-call and body contracts. | Generic refusal/incomplete matrix; native real-adapter metadata/usage/model tests; financial checkpoint before private candidate retention. | Native body quality/word exactness remains its own contract. Full raw-envelope evidence/custody binding for every generic story path remains incomplete. |
| Scene | Generic planner plus distinct opt-in native Scene adapter with bounded envelope, strict projection and usage contract. | Generic matrix; existing actual native Scene tests cover malformed/partial responses, unknown usage and retention failure. | Native Scene still attempts private retention before its financial observation and preserves finance on caught retention failure. Reordering that specialized path and adopting the common outcome projection need a separately qualified native change. Screenplay/layout/temporal fidelity is not image parity. |
| Slides | Existing refusal/filter/incomplete guard and presentation model/usage routes. | Common guard now precedes missing-usage checks and artifact repair; original presentation codes retained for refusal/token limit/incomplete. | Per-page/repair full raw envelope adoption and end-to-end native publication are not established by this suite. No prompt/schema/layout policy changed. |
| Shared storyboard | Shared low-quality newly purchased frames select Flare; existing historical accepted Fal requests retain original request/model identity. | Actual SQLite-backed job runner stops after one planner refusal with zero media purchases. Original Fal reconciliation still works with later refusal evidence and makes only GETs. Legacy receipt, pending-child no-replacement, routing/recovery tests pass. | This tests original reconciliation, not permission to buy remaining frames after a later refusal. No global recovery gate was added. Per-frame temporal/identity continuity needs its own evaluation. |
| Native Output storyboard | Separate high-quality Ideogram/Fal frame contract; bounded original planner and four-frame plan. | Native refusal/filter/incomplete matrix, malformed/oversized bytes, one-call limit, measured/unknown usage before raw-custody failure; real SQL rejects foreign owner/job/digest and expired job/lease even with settled accounting. | Full native final-dispatch journey is not claimed. One existing extracted-closure fixture fails on untouched main. Frame continuity and spatial consistency remain follow-ups. |
| Audio | Native Output Stable Audio route and generic narration/music selections remain distinct; existing original audio recovery. | Native and generic upstream stop matrix; existing dispatch/recovery lease fixtures, Fal status/result/download GET-only recovery, identity/redirect/unknown child guards. | No listening test, exact narration/transcript alignment, voice continuity, timing or waveform-quality claim. Native narration-provider end-to-end matrix remains separate from instrumental Audio fixtures. |
| Video | Native bounded single-clip planner and separate original Fal request/transfer contracts; generic planner route unchanged. | Native/generic refusal matrix; private custody failure retains measured/unknown cost; revocation before finance blocks writes and private custody, later revocation does not erase an earlier valid financial checkpoint. Existing original-read status/result/download tests pass. | No motion/temporal continuity, audio sync, shot fidelity or rendered-video quality comparison. Not all configured generic video providers exercised. |
| 3D | Dedicated Fal Rodin adapter; generic document planner rejects `model3d` before transport. | Existing queue acceptance/status/result/download, original ID, malformed result/file signature, redirect, source authority and storage recovery tests pass. No replacement purchase for uncertain children. | Rodin's retained price is explicitly a published-provider estimate, not measured charge. Geometry topology, dimensions, UV/material/texture intent require semantic/renderer validation. No image-parity claim. |
| Private Memory | High-quality configured OpenAI preview (Sunburst), strict bounded reader, unique keys, complete usage, owner-bound native custody; existing activation unchanged. | Existing strict moderation/private-image receipt fixtures pass: mandatory signal, duplicate keys/cardinality denied, absent usage cannot settle. Source audit confirms native handles, retention and private custody remain required. | Memory is not fully adopted to A's generic private observer. Its specialized private-image receipt precedes financial completion; E does not weaken or reorder that contract. Full Memory owner/retention execution journey and derivation outcome projection were not requalified. Caller booleans are never access authority. |

## Interpretation and authority

Model aliases and returned identities are separate observations. The new parser has no expected-model argument and cannot invent a refusal from a mismatch. Existing native exact-model/pricing gates may leave an operation unpriced or unavailable; resolving a documented alias requires separate evidence and an explicit contract change, not a safety label or assumed pinned snapshot.

A refusal is evidence about that operation. It blocks new work downstream of that planner. It does not erase an earlier accepted child's identity, measured cost or unknown exposure, nor prohibit authorized reconciliation of that existing purchase. The new guard is confined to the just-returned planner path. Original children use the existing recovery mechanisms unchanged.

No private incident/source content was retrieved for this task. All new envelopes are synthetic. Existing route tests use owner-scoped in-memory SQLite and current retention checks; no caller-supplied `authorized` boolean, hash or parser result is treated as access authority. Financial observations contain no raw prompt/envelope. Historical receipts and original evidence were not rewritten.

Official envelope basis: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), fetched 22 September 2026, documents refusal handling and incomplete responses caused by output limits/content filtering. Exact structured signals are recognized; arbitrary message wording is not.

## Verification and exact limits

Final combined offline suite: **451 passed, 2 failed** across 453 tests. Both failures reproduce unchanged on main `2a0caa91`:

- `tests/output-narrative-custody.test.mjs`: extracted event seam references missing `nativeStoryboard`.
- `tests/output-storyboard-fal.test.mjs`: extracted dispatch seam references missing `outputJobIsDurable`.

These two tests are not counted as verified coverage. No full repository suite, production build/deployment or live provider trial was performed. Full TypeScript and changed-file ESLint pass; `git diff --check` passes. The two stale extracted narrative-adapter tests directly affected by this work were replaced with actual adapter execution; unrelated custody extraction failures remain documented.

The new parity fixture imports the audited `2a0caa91` adapter and compares first outgoing request bodies for story, scene, slides, storyboard, audio and video under intercepted fetch. The transport/retry function is byte-identical. Native Storyboard/Video tests also compare dispatch bytes to their original offline preparation. Random trace IDs are not idempotency guarantees; no alias-to-snapshot equivalence is asserted.

Reproduce the focused changed behavior with:

```sh
FORMA_SOURCE_ROOT=$PWD node --import tsx --test \
  tests/planner-response-outcome.test.mjs tests/cross-media-planner-outcome.test.mjs \
  tests/cross-media-request-parity.test.mjs tests/output-narrative-request.test.mjs \
  tests/output-storyboard-planner.test.mjs tests/output-video-planner.test.mjs \
  tests/storyboard-reconcile-provider-route.test.mjs
```

The full file list and recorded counts are in `docs/fixtures/cross-media-task-e-verification.json`. All provider requests are intercepted; credentials are unusable fixture strings. No live key, paid call, trial, credential provisioning, infrastructure or support message was needed.

## H handoff

Branch: `codex/forma-e-cross-media-outcomes`. Workspace: `/private/tmp/forma-e-cross-media-outcomes`. Integrate the focused E commit independently when appropriate; this is not a prerequisite for H's first C image study. H owns the global report and integration. E appends only `generationTaskE` and E task/card evidence through the atomic report helper.

Follow-ups are proposals, not tested results: native Scene/Memory financial-before-custody qualification; full cross-media raw-envelope observer bindings; fix the two existing extraction fixtures and exercise complete native final-dispatch journeys; narration exactness, temporal continuity and geometry/material validation. Optional attached moderation remains L-owned and inactive here. Any live execution/deployment requires separate authorization.
