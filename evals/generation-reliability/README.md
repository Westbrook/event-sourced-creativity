# Frozen generation reliability experiments — Task B

Local, offline implementation based on review v2 / `1587f9067162e38ce437d9cf443faf5620b388ae`. This harness has **no live executor**, reads no credentials and imports no provider SDK. The only transport interface is bounded original-request status/result reconciliation. No generation submission method exists.

Run from this isolated checkout with Node 22.13+ (verified with Node 24):

```sh
node --experimental-strip-types scripts/run-generation-reliability-eval.mjs --check
node --experimental-strip-types scripts/run-generation-reliability-eval.mjs
node --experimental-strip-types --test tests/generation-reliability-eval.test.mjs tests/image-operation-capabilities.test.mjs
```

The second command deterministically regenerates checked-in synthetic `examples/*.json`. `--out=<directory>` selects another local output directory. Existing output files must match exactly; changed content requires a new output directory so earlier snapshots remain intact. Every other option, including `--live` and retry switches, fails closed. No `npm install` or provider credential is required for these commands.

## Evidence and identity

`core.mjs` keeps HIST, PROD and CTRL distinct. HIST preserves the Image 2 job/generation IDs, exact 5,596-character / 5,621-byte prompt digest, original model/high/1536x1024/no-reference/prose settings, retained context hash and aggregate accounting. The source-byte hash and original planner direction are unavailable in the supplied incident evidence; null is intentional. A retained context hash is not a newly computed source-byte hash. The $1 reservation is not a charge, and the $0.004946 aggregate settlement is not assigned to a particular stage.

The immutable incident and private prompt remain in the investigation evidence directory; no copy is added to Git, a public fixture, or the report. `verifyPrivateIncident` reads it only with caller-supplied authorization/owner scope/purpose and unexpired retention, rejects symlinks, verifies bytes/hash/length, and returns metadata only. The caller must obtain access from the existing authorization workflow; a boolean parameter is not a replacement for it. Original private evidence was verified in place on 2026-09-22 with zero provider calls.

PROD records reviewed configuration evidence, not a newly observed live result: shared low → Flare; Still finals → configured Sunburst; high Forma/Fal, native Output/Ideogram and strict high-quality Memory preview remain separate. Historical recovery keeps its original provider/request.

CTRL cases contain the frozen source, actual supplied direction, provider-facing prompt, ordered reference hashes/roles/provenance and effective configuration. Content-addressed baseline/case/cell/trial/manifest IDs change for changed content or configuration. Repetition IDs are prespecified. Prompt/model/reference/source changes require explicit new trials; they cannot reopen successful or uncertain purchases. Omitted versus explicit settings remain distinguishable by the F operation contract.

## Designs, not measured treatments

`examples/` contains E0a/E0b, E1–E16 (including every listed subfactor), C1–C10, a first-screen mock design, baseline evidence and a 50-case legacy-corpus inventory. The 41 study manifests contain **141 planned, 0 initiated, 0 dispatched, 0 completed, 0 blocked, 141 unexecuted** example trials. These alternative designs are not one proposed live campaign. Planned stage-call totals are per manifest; observed calls and cost are zero.

Compiler/semantic/checker examples are explicit **synthetic design placeholders**, not outputs of Tasks C/D/I/J/L and not demonstrations that a cleanup works. Each carries an actual-candidate-capture gate. Planner treatments rerun both workflow arms from the same frozen original input with one planner factor changed; `newDirection:null` means the future outcome is unknown. A captured direction is never silently replaced by a generic title-derived scene. E10a and C9 hold dated model IDs fixed across quality. E9a includes no-ref/each-ref/combined cells and the generations-to-edits route factor; E9b changes derivative pixels only; E9c changes role wording only. Mock reference digests are not provider-ready image assets.

`techniques.mjs` is the experimental replacement for the misleading `generation-readiness.ts` format study. It invokes the real representation builder with identical captured source, direction and references for prose/bullets/JSON/XML, with zero planner calls. Missing original direction, compaction, or a non-reproduced captured prompt stops the comparison. The existing product UI remains unchanged and its old comparison is **not admitted as isolated format evidence**. Do not claim that the historical original direction was reconstructed.

`capabilities.mjs` consumes F's experiment-only resolver, asserts the actual requested model and preserves route/runtime qualification issues. Direct Images versus Responses means **route plus orchestration**, including mainline/tool behavior and any revised prompt. Unsupported cells stay unavailable. No global environment mutation forces a candidate model. `capability-qualification.json` records these distinctions; capability validity does not qualify money or grant dispatch.

## Resume admission and accounting

`reuse.mjs` independently guarantees completed evidence → zero provider calls; mismatched/corrupt completion → hold, not purchase. Accepted/submitted/uncertain requests can make at most one status and one result read against the original provider/request per reconciliation invocation. Unknown original identity holds. No implicit retries occur after failure, mismatch, expiry or timeout. K owns the legacy runner; this module does not execute it. B consumes K's synthetic legacy uncertainty shapes, including failed wrappers around accepted requests, nested child submissions and missing original identities. Missing or ambiguous original identities hold without status calls.

`results.mjs` requires prespecified trial IDs, one record per initiated trial, complete stage call inventories and operation-level cost identities. Missing receipts become explicit unknown exposure. All planner/media/moderation/checker/evaluator/render/storage/reconciliation costs count, including failed calls. Duplicate operation receipts are counted once; conflicting receipts fail. Cached-input discounts and delivered-partial fees belong in the original operation's qualified cost, never an extra duplicate row.

Acceptance = first-attempt usable outputs / prespecified initiated trials, including local preflight blocks, refusals, no-tool output, transport failures and unavailable/unusable artifacts. Unexecuted trials after a stop do not enter the observed denominator. Content with missing billing can still be usable while financial exposure remains unknown. Exact manifest dimensions/format are checked; square output is not assumed. Unjudged completions stay explicit and do not count as usable.

Blinded review packets contain original requirements and opaque artifact tokens, without model/provider/arm labels. Keep the separate key and authorization-bound artifact delivery private. Score literary identity, adult subject, era, scene/spatial relations, palette, exact text, reference roles and prohibited additions where applicable. Every critical authored requirement must score at least 3/4; reviewers evaluate fidelity, not similarity to the ChatGPT image. Literal coverage is a necessary offline check, not proof of visual semantics. Automated judging remains supplemental and its calls/costs count.

Case-level paired rates cluster repetitions into cases. A deterministic whole-case bootstrap is descriptive of the observed convenience corpus only; fewer than ten paired cases is labeled exploratory. Repeated outputs of one case never become independent product-wide evidence. Null latency remains unknown; p95 is withheld below 20 observed timings. The first contrast is summarized explicitly, and factorial interactions need separate prespecified analysis. Held-out cases and agreed fidelity/cost/latency tradeoffs are needed before adoption.

`runMockTrials` accepts fixture data only. It stops new initiation on unsafe output, critical intent loss, unknown exposure, the mock budget boundary, access failure or invalidating infrastructure failure. It retains partial results and unexecuted counts; it never replaces a failed trial.

## Proposed first screen and spending boundary

Proposal: six cases × three planned repetitions × two arms = **36 image attempts**, 36 single-text preflights and at most 36 automated evaluator calls; **0 planner calls** when using genuinely captured frozen directions. Interleave arms in each case/repetition block. The initial question is original versus one provenance-cleanup candidate, with fixed model/quality/size/route/references. The six strata are the private incident, neutral adult portrait, richer literary portrait, spatial nonportrait, exact typography and negative constraints.

The checked-in first-screen manifest uses a clearly labeled synthetic incident equivalent; it is a mock harness artifact. A live proposal must admit the actual private case through authorization/retention, capture its source/direction (or explicitly declare a new control with its own identity), replace the placeholder compiler output, and produce a **new reviewed manifest ID**. Do not substitute the equivalent and claim incident coverage.

Proposed discussion ceiling: **$25 USD total**: $18 media, $3 evaluators, $1 preflight/checks, $1 preparation/planner contingency, $2 render/storage/reconciliation contingency. This is an unaccepted allocation proposal, **not a price estimate, spending authorization or provider-enforced cap**. No estimate currently bounds the complete study; manifest `maximumCostMicrousd:null`, authorized spend **$0**. If F cannot qualify per-operation consumption within this proposal, reduce the study or bring back a separately bounded qualification protocol. Do not borrow Image 2 token assumptions. Any added planner/checker call changes the manifest and its budget.

Future live work requires the exact private cases/arms/settings/request count and maximum exposure to be reviewable, explicit user spending authorization, the existing credential/consent/budget/paid-call checkpoint workflow, A receipts, F capability and consumption qualification, and the already-passing no-replacement-purchase gate. Reserve atomically before dispatch, cap concurrency at one, and halt new dispatch on unknown exposure; bounded original-request reconciliation remains separate. The present runner cannot execute that workflow. Replay stays closed for unqualified 2.5 fixtures.

## Cross-media handoff

E12/C8 are contract adoption groups, not pooled image experiments. Stories/slides need factual and exact-text coverage; audio needs intelligibility, verbatim speech and voice rights; video needs temporal/identity continuity and per-child purchases; 3D needs geometry/material/scale/topology checks. Flare continuity anchors and storyboard studies require image fidelity gates and separate downstream video budgets. Generated reference provenance does not establish fictional identity. Preserve private Memory's existing bounded receipt, moderation and retention protections. No cross-media adapter is changed or claimed qualified here.
