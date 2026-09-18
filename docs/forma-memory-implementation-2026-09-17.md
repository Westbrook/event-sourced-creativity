# Forma Memory implementation reconciliation

Updated **2026-09-17**. Scope: `codex/forma-memory-foundation`, synchronized with
local `main` at `2face013e96a9796302ba9a5f44bef16706a1f79` by merge `c2ee60e`.
There is no configured Git remote in this checkout. The merge retained the newer
main versions of both conflicted Memory model files; its tree matched main.
It did not modify the main checkout or its unrelated proposal documents.

## Current continuation

- Connect Chat Studio's explicit document-memory request to the existing native
  claim, candidate, publication and certified-read path. Keep ordinary chat and
  paid work separate, require current enrollment/authority, and recover the same
  request manually after uncertain acknowledgements.
- Render recalled text only in an owned, short-lived view. Never insert it into
  generic chat history/content or renew it through polling or a render. A manual
  authenticated read may acquire a fresh lease after current authority checks.
- Bind personal artifact-view evidence to the exact revision and content hash.
  Intent completion must apply those checks to artifact-derived object IDs too;
  ordinary generated-image object behavior remains compatible.
- Connect the existing extractive nightly source runner to the native Worker
  scheduled event. Keep its scheduling flag, actor allowlist and background
  enrollment gates intact; no schedule or flag is registered/enabled here.
- Reconcile the retained synthetic benchmark runner with native account and
  allowance ledgers. Keep the candidate default-disabled and qualification-bound;
  unknown spend must remain held. No provider calls, real enrollment or scheduler
  activation are part of this continuation.

The native benchmark routes and independent synthetic-payload cleanup are mounted in source; no optional benchmark schema is installed by a request. The two SQL files remain explicit activation candidates, not assigned or applied production migrations. See [the benchmark contract](forma-memory-benchmark-2026-09-17.md).

## Remaining source work

These are **implementation dependencies**, not approvals or scheduling chores.
The original [scope-aware plan](forma-scope-aware-memory-plan-2026-09-02.md) is
larger than the already-published extractive Memory foundation.

| Area | Current boundary | Remaining implementation / dependency |
| --- | --- | --- |
| Structured conversation summaries | Durable structured-ledger storage and certified consumers exist; the declared ledger does not claim semantic completeness. | A genuine finalized-turn producer, grounded segment summarization/rebase, coverage and contradiction handling, and a native budgeted derivation pipeline. Test-only ledger writes do not complete this feature. |
| Evolving profile | The live document profile represents explicit palette choices; it is not a general inferred profile. | Purpose-authorized inferred facets, supporting/contradicting evidence, correction/suppression, contextual differentiation and conservative generalization. Depend on qualified derivation and accepted scope/retention policy. |
| Semantic recall/index lifecycle | Current recall is extractive and the deterministic hash embedding is a test-oriented representation, not a production semantic embedding. | Approved provider adapter in the live pipeline, chosen durable vector-store binding, partitioned hybrid retrieval, transactional outbox consumption, index readiness, invalidation/deletion acknowledgements and recovery. A synthetic benchmark adapter alone does not supply these. |
| Nested projects and wider zoom | The synthetic scope model supports ancestry; native project ownership does not yet provide the required parent/reparent contract. | Native acyclic containment, bounded ancestry, canonical subresource identity, reparent invalidation and separate access-versus-relevance rules before hierarchical inference/recall. |
| Rich consumption | Native rolling Memory episodes cover navigation. Exact artifact review now improves intent evidence but does not itself expand Memory's consumption contract. Actual artifact-view capture also lacks a project binding required by the current private Memory source envelope. | Bind capture to the same authorized project/document snapshot and validate native revision/hash receipts at append; bind current retained artifact/body/custody/lifetime; version and negotiate the projection/client contract before adding artifact/block inspection, comparison or reuse episodes. An event reference alone is not underlying source authority. |
| Learned suggestions/autocomplete | Existing intent/Re-entry features do not establish the new nightly learned-pattern pipeline. | Qualified changed-scope derivation, exposure/accept/reject feedback, lineage deduplication, rate/quality controls and native consumers. Do not translate clicks into aesthetic preference or comprehension. |
| Benchmark extension | The isolated synthetic runner now has native self-payer accounting; it does not constitute a paired native Forma quality baseline or real-user Memory billing. | Add any approved wider payer scope and genuine native-baseline comparison. Reconcile claimed operations with missing usage only from a qualified original provider receipt; do not infer zero cost from missing content. |
| Analytics and operations | Existing coarse analytics are separate from private Memory bodies. | Reconcile the final learned pipelines with minimized purpose-specific metrics and privacy-safe observability; implement any missing operator tooling once concrete runtime/provider contracts are selected. |

The [non-implementation checklist](forma-memory-nonimplementation-work-2026-09-17.md)
is deliberately separate. No release, benchmark measurement, monthly-cap choice,
real-user activation, supported hosted scheduling or whole-plan completion is
asserted by this source reconciliation.

## Verification

Using Node 24.16.0 and the existing installed dependencies in an isolated worktree:

| Check | Result |
| --- | --- |
| Explicit Chat Studio backend + adjacent native publication/read tests | 25 passed |
| Memory client, actual Chat component, exact artifact/intent and ordinary job-store regressions | 161 passed |
| Actual Worker routing, scheduled privacy and scheduling-admission/activity integration | 3 passed |
| Benchmark corpus, provider contract, one-shot ledger, runner, projection and native accounting | 403 passed, including 25 native accounting/recovery cases |
| Full TypeScript | Passed after final delta |
| Production build and localization audit | Passed after final delta. Existing large-chunk warning retained. |
| Broad assistant runtime (pre-final-delta snapshot) | 951 tests: 941 passed, 10 failed. All 10 failures reproduce with identical normalized signatures on exact merge baseline `c2ee60e`. |
| Ordinary document-jobs + native-image-store suites | 37 tests: 35 passed, 2 failed. Both static source-assertion failures also reproduce on `c2ee60e`. |
| Touched-source lint | Only 13 pre-existing unnecessary-escape errors in `tests/assistant-runtime.test.mjs`; identical locations/messages on `c2ee60e`. All other linted changed source/tests passed. |

The isolated baseline comparison ran 966 tests with 954 passing and the same 12
failures. The broad failures are not claimed fixed; no new failure name or
normalized failure signature appeared in that comparison. Independent review
caught and verified corrections to the object-ID stale-review bypass, passive
Memory job execution/acknowledgement, recall prompts leaking into ordinary chat,
D1 prepared-statement wrapping, and immutable accounting replacement guards.

Tests use synthetic SQLite/native account fixtures, in-process fake providers,
and finite actual-component/Store transports. These are not real-browser,
assistive-technology, hosted-runtime or live-provider acceptance receipts.
