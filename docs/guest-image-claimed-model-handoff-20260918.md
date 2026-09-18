# Guest Image claimed-result pure model handoff

This isolated slice implements the accepted canonical presentation contract on R3 `f579600ad1f84907b47cc94a1483b6585040e9dd`, branch `codex/guest-image-claimed-model-20260918`. It does not emit claim events or enable claim, read, editing, provider, or publication routes.

## Exact allocation

Six paths only:

- `src/model/guest-image-result-presentation.ts`
- `src/model/events.ts`
- `src/model/event-profiles.ts`
- `src/model/output-naming.ts`
- `tests/guest-image-result-presentation.test.mjs`
- This handoff document.

The accepted design is `/Users/westbrook/.codex/visualizations/2026/09/17/01a0acf8-4b13-75c0-b520-b444b077515e/guest-image-result-canonical-projection-20260918/ROOT-source-contract-acceptance.json` (SHA-256 `fe2a9136e0c439707805cdc438109ac46e6fdcd341036e01206f9d3b6436e968`). Implementation evidence and final commit/source pins are under the sibling `guest-image-claimed-model-evidence-20260918` directory. The root task owns the canonical progress report and release coordination.

## Implemented behavior

`parseGuestImageResultClaimEvent(unknown)` returns a detached, recursively frozen exact canonical event or `null`. `parseGuestImageResultClaimEventOrigin(unknown)` does the same for the seven-field stable origin. The parser requires the exact 29-field payload and full existing CreativeEvent header, fixed v1 model/provider cohort, canonical owner/custody/output media tuple, separate canonical planner/prompt copy IDs, bounded dimensions/bytes/latency/source versions, matching origin IDs and publication-time ordering. Historical expiry is not tested against the present clock. It rejects hidden fields, extra fields, accessors, hooks, cycles/aliases, sparse arrays and malformed shapes without reading accessor values. Original title code units, including JSON-escaped lone surrogates, are preserved; owner identifiers remain well formed. The event carries no whole-lineage digest or completed-custody review.

The CreativeOutput projection retains original Project/Document/output/generation identity, exact title, original creation time, model/planner/provider/technique/latency and original image dimensions. Its sourceEventId and sequence identify the canonical claim event; contentRef/promptRef identify the canonical copies. Only `claimedOrigin` is added to CreativeOutput. Initial flags remain false; later ordinary flag and authored rename events keep their existing behavior. No native completion, compiler event, job, grant, cost or output_results row is fabricated.

The shared presentation-origin index refuses claim-involved output, generation and canonical creation-event collisions in both orders, including malformed/redacted duplicates and legacy JSON String-coercion aliases. The fold registers an actual resolved legacy native identity before writing it, removes invalidated rows before later native variant allocation, and includes all new index state in retained-state accounting. Ordinary native/native replacement behavior remains intact. Both Library and Project-card calculations require a real nonremoved Document in the claim's Project; a later rehome cannot use the legacy absent-Document fallback.

Project bootstrap includes GuestImageResultClaimed. Naming counts one qualified canonical creation, preserves historical discarded takes, excludes known rejected stale peers/candidates from counts and shared qualifiers, and preserves one safe presentation per explicitly requested row. Its Document defaults match the fold. A claimed image never reads a generated title through the ordinary generic retained-content map.

## Context provenance and remaining consumers

`source_block_versions` remains the ordered historical list on the parsed canonical event. A version is the original block.sourceEvents.length count, not a stream position and not a current revision. One-for-one canonical adoption preserves that count at a nonzero destination head. Canonical block sourceEvents and the output sourceEventId retain canonical event identities. No copied ContextCompiled or relabeled compiler snapshot is introduced. Later block edits change current counts without changing claim history or silently making the result unreadable.

The bounded next consumers remain explicit:

1. Atomic producer/current completed-custody reader: bind exact source values, original rights digest, five copied bodies/native receipts, mapped prefix/SAVE provenance, complete lineage and current personal authority. The pure parser cannot establish any of those facts or grant access. The producer must use the accepted deterministic field order and actual envelope bytes when hashing, not assume that successful parsing constitutes a proof.
2. Dedicated current planner/prompt/media reads and Store dispatch: prevent generic cache/private-content fallback and carry a fresh exact completed review where required.
3. Claimed Image revision parser/editor/replay/download and host reopening: use the separate versioned claimed branches from the accepted contract. The existing GeneratedImageEdited native projector remains strict; this slice does not enable claimed edits, and incompatible targeted edits leave media unavailable.
4. Library Context-link rendering and Inspect inputs: resolve the canonical claim through output.sourceEventId, use its exact historical block IDs/counts, and avoid the native ContextCompiled/handle fallback. These components are outside this allocation.
5. Explicit local compositor adoption and its narrow rights/provider-context exclusions remain in their separate accepted allocation. Whole-project archive, indexing and broader Memory are separate unoffered extensions.

## Verification and limitations

Only the new actual-module synthetic suite and relevant static checks are used. The evidence receipt records exact final counts, commands, source hashes, independent source review and commit. The tests exercise pure models, including a complete presentation-positive fixture, nonzero-head context counts, cold Project bootstrap, original metadata, malformed inputs, both replay orders, naming fallbacks and retained-state capacity. They do not qualify a real whole-graph claim transaction or the source authority behind a synthetically valid event.

No accepted unrelated suite or live-provider journey was repeated. No provider calls, database/R2 operations, financial hold changes, data-sharing changes, main merge or publication occurred. Nested macOS sandbox-exec was unavailable (`sandbox_apply: Operation not permitted`); that pre-execution failure is preserved. Successful recorded checks use the existing tool sandbox, an empty environment, Node read-only filesystem permissions, no child/addon/worker permissions and an explicit network guard. The initial 83-test exploratory pure-model run preceded that additional Node guard and is not presented as a contained qualification run.

Independent review findings remain in review01; corrected source acceptance is recorded separately rather than overwriting the historical review. The final qualification receipt is the authoritative result for this isolated slice, not proof that the whole original plan is complete or ready for activation.
