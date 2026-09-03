# Bounded slideshow comparison harness

Implemented on the production179 / `7eb914d` base and locally verified on 2026-09-02. The CLI only prepares offline requests; paid execution requires a separately supplied one-shot transport, current authority checks and an explicit stage approval. Stage A has user approval up to $1.50; B–D remain separately gated. This implementation does not authorize a deployment or production-default change.

## Files and scope

- `worker/openai-adapter.ts`: an offline-only addition exposing an offline preparation seam. It captures the existing exact composition wire before a client request identity, pending receipt, callback or HTTP exists. The optional editor path validates an explicitly supplied complete candidate against the frozen source and directly prepares the existing `validation-repair` wire. It creates no fake prerequisite paid response. Normal production composition and automatic repair behavior is unchanged.
- `scripts/presentation-comparison.mjs`: a bounded module for frozen cases, independent bounded manifests, local file durability/claims, response accounting and a single injected one-shot transport. The CLI is offline-only and cannot load credentials or dispatch. Importing this module does not dispatch.
- `tests/presentation-comparison.test.mjs`:  offline tests with wholly synthetic transport, authority and receipts. No synthetic result is a native or paid artifact.

This is not a production workflow or new model default. Execution does not create Forma jobs/artifacts or modify source/audio/video. The direct comparison's charges and conservative claims must be included in the original $30 accounting, separately from application job history. No claim is that Settings automatically includes direct evaluation charges.

## What is prepared offline

A: four manual six-slide composition arms, Terra/Sol × medium/high; 6,500 output tokens per call, 64,000 complete-wire input allowance, $1.376 conservative summed maximum, $1.50 stage ceiling.

C: real managed E page 0 (slides 1–8 of 12) and M page 2 (slides 17–23 of 23), two models at one preselected common effort; 9,600/8,400 output caps, $1.536 maximum, $1.60 ceiling. Canonical-to-page-local anchors, real `combinedSceneSnapshot`, exact source fixture hashes and M's explicitly synthetic prior-page state are frozen. These are page comparisons, not full paid orchestration tests.

D: complete test-authored E/M candidates derived from the existing `faithfulSlides` recipe with full source quotations, attributions, notes, theme and citations. Both baseline candidates have zero local source/structure issues. Only `items.3.slide.visual.value` changes, duplicating its existing body at global slide 4/20. Exactly one genuine raw within-slide duplicate is detected; the source/count contract remains valid. The editor uses the real `validation-repair` phase, not a falsely labeled editorial-rewrite phase. The complete candidate is transmitted unchanged; if the adapter would redact/change it, preparation refuses it. Both medium and high prepared requests fit 64,000.

B: same four model/effort arms but requires a complete source-matching retained native candidate, preferably the existing retained one, otherwise the predeclared complete Terra-medium A result. No empty/truncated candidate, easiest-arm selection, synthetic substitution or extra prerequisite generation. The native source and candidate were not read by this subtask. B remains unavailable until root supplies and validates that binding.

All four stages are separate approvals; maximum 16 calls / $6.20 rounded total only if each is independently admitted. C/D require a common-effort selection receipt from the corresponding earlier native sweep; this is external operator evidence, not automatic model judgment. No automatic retries, nested repair, paid judge or fallback model.

## Native preparation input

Private JSON binding (preserve the exact snapshot property order when comparing Forma's `JSON.stringify(snapshot)` hash):

```js
{
  provenance: "authorized-private-native-source",
  actorId: "the current authenticated email or verified internal user ID",
  actorBindingKind: "authenticated-email", // or "internal-user-id"
  documentId, sourceRevision, sourceHash,
  snapshotDigest: digest(snapshot),
  authorityReceiptRef: "fresh source/custody verification reference",
  documentTitle: "One document. More ways to use it.",
  snapshot,
  options: {
    itemCount: 6, requestedSlideCount: 6,
    productionMode: "manual", presentationFidelity: "faithful",
    presentationStyle: null, // or omit when the original request had no forced style
    audience: "general", tone: "exact saved request text", locale: "en"
  }
}
```

`actorId` is only a frozen safety-identifier input here, not a claim that an email is Forma's internal actor ID. The authority reference is evidence provenance, not authentication. Root's live authority callback must verify current authenticated custody, source hash/revision and accounting. Preserve exact original options; do not add a style to improve an arm. Model-route overrides, flexible/changed counts, managed mode and callbacks are rejected.

From the exact tested and committed revision:

```js
const binding = JSON.parse(await readFile(PRIVATE_BINDING_PATH, "utf8"));
const native = bindNativeCase(binding, digest(binding));
const manifest = await prepareStage({
  stage: "A", cases: { N: native }, actorId: binding.actorId,
  codeRevision: EXACT_TESTED_COMMIT
});
await writePreparedStage(NEW_PRIVATE_PREPARATION_DIRECTORY, manifest);
```

This needs no API key. Do not use `loadFixtureCases().N` for a paid native run; admission expressly rejects that offline companion. Native sourceHash must equal the byte-derived snapshotDigest. All full snapshots/candidates/request/response files remain private with owner-only file permissions. Do not commit them or copy them into source fixtures.

## Execution contract

`runApprovedStage({manifest, approval, directory, transport, authorityStillCurrent, admitStage})` requires three explicit adapters; none has an unsafe default.

1. `admitStage = fileStageAdmitter(CANONICAL_PRIVATE_ACCOUNT_LEDGER_DIRECTORY)`. This namespace must be reused for all comparison runs, never recreated/switched to retry. It atomically locks admission, creates a fsynced one-use claim keyed by approval reference and reserves the whole stage ceiling against original exposure plus all prior claims. Unknown/malformed claims, concurrent lock, reused approval and exceeded $30 stop admission. Claims are never automatically released or netted against fresh charges; conservative double-counting is intentional. A stale lock or already consumed approval requires operator review, not deleting a file to make a run start.
2. `authorityStillCurrent(manifest, approval, gate)` is awaited for `before-admission`, `before-pending` and `before-dispatch`; the latter includes arm/client identities. Root can use a stdin acknowledgment barrier after genuinely refreshing UI custody/source and original ledger. Do not substitute an unconditional callback. Frozen input and deadline are rechecked after the awaited barrier and immediately before HTTP. False/throw/expired deadline after pending retains claim and hold, with no HTTP.
3. `transport` must be exactly one direct HTTP POST to the supplied fixed Responses endpoint with the frozen body and client request ID, using root's in-memory authorized credential. Set content-type, Authorization and X-Client-Request-Id; use an abort signal bounded by the approved deadline, disable redirects, and return `{status,httpRequestId,bodyText}` after reading the complete body. No SDK/client automatic retries, polling resubmission, provider fallback or regenerated identity. This subtask did not implement credential access or call this transport. A thrown/ambiguous transport permanently stops the run; IDs provide tracing, not idempotency.

Approval binds the manifest digest, exact stage/ceiling, explicit approval reference and deadline (at most 30 minutes), fresh original ledger (within five minutes at initial admission), all charged/unresolved/reserved exposure, actual application reservation floor and at least $10 contingency unless separately overridden. Fresh external authority checks must account for changes after initial admission. Old $1 holds are not released. Lower-priced observed calls do not automatically authorize more calls or later stages.

New run and canonical-ledger directory entries have their parent directories synced. Execution creates fsynced pending before transport. It freezes returned response bytes/HTTP metadata before any persistence await; retains complete raw body and transport metadata before parsing; writes the call's own immutable financial receipt before cap review or local quality validation; then writes the terminal before the next arm. Unknown model/tier, absent/malformed core usage or mismatched identity never becomes a zero cost. A known overrun keeps actual full usage/price and stops. Incomplete output stops for cap review with no retry. Exact source-authorized bookend pairs are reported separately from genuine raw duplicates. Local normalization, source checks and raw-copy findings are separate; none is native viewer/export acceptance.

## Verified offline

- 14/14 new harness tests pass, including true-but-expired awaited authority barrier → zero HTTP, retained pending/claim; mutable transport data cannot change persisted evidence; unknown calls cannot replay under a different run directory; known finance survives overrun and local decoder failure.
- 98/98 existing `presentation-provider`, `presentation-protected-messages`, and `presentation-outline-provider` tests pass, preserving ordinary adapter behavior.
- Offline CLI preparation succeeds with `paidOperations:0`, `providerRequestsSubmitted:0`, `nativeSourceBound:false`.
- Root integration verified 114/114 comparison/provider/fidelity/source/cost tests, plus full build/typecheck and changed-file lint. Independent review passed 18/18 tests after native-binding and directory-durability hardening.

One sample per arm is exploratory evidence, not p95, stable model superiority or authority to change production defaults. Native viewer/export inspection and actual paid cost results remain separate work.
