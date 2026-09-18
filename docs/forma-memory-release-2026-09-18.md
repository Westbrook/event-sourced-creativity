# Memory completion and release status

Updated **2026-09-18**. Tracks [MEM-001 and MEM-002](backlog.md#memory).

**The complete scope-aware Memory plan is not implemented.** This release delivers
the verified implementation accumulated on the Memory branch with learning,
enrollment, scheduling and the synthetic benchmark still disabled. Publication
must not be described as completing the semantic/profile/nested-scope system.

## Current release

The candidate includes current `main` at `e26f608` (Still attention, decision
caching and generation-risk acknowledgment retained), the [native producers](forma-memory-native-producers-2026-09-18.md)
and the prior explicit-recall/benchmark-accounting integration. Production status
will be recorded after the actual deployment succeeds, not inferred from a merge.
The existing authorized audience is preserved; no external visitor is added.

An additional release review found and fixed two implementation gaps:

- Guest-output custody now recognizes only the **complete, exact 36-object**
  benchmark schema, including its eight shared-budget triggers. Partial, altered
  and unknown schema families refuse. Guest identities and original token/cost
  reservation links still block unrelated-custody claims; sharing a real payer
  alone does not.
- The benchmark itself verifies that exact financial schema before admission and
  binds its snapshot into reservation, dispatch-claim and settlement transactions. Unknown external
  dependencies and schema changes invalidate the proof. This does not create
  qualification, authorize spending, or change uncertain-charge recovery.

Disabled spending/approval routes still perform no authority/database reads.
Explicitly authorized recovery remains available with spending off; verified
provider-usage receipts are retained even after authority expires or is revoked.
The existing OpenAI secret configuration is retained, not copied, revealed or
exercised.

## Verification

The September 18 release delta passed 571 focused tests: benchmark (410),
guest inventory (99), native Memory routes (37), and current-main Still/share
routes (25). TypeScript, changed-file ESLint, element/localization generation and
the production Vite build also passed. Independent schema/privacy review found no
remaining blocker in this delta. After merging the intervening main updates, the
complete npm production build and TypeScript passed again, alongside 73 direct
Memory/Still checks and all 62 native Memory/Still/share built-route checks.
Provider transports in these checks were fake;
these results do not qualify hosted execution or real-provider privacy/cost.

This is not a claim that the entire repository suite is green: the earlier broad
baseline recorded ten test failures and thirteen lint findings outside this delta.

## Implementation To Do

These remain code work, not merely rollout approvals. They are retained in the
denominator of the original plan and in the [detailed implementation table](forma-memory-implementation-2026-09-17.md#remaining-source-work).

| Order | Unfinished implementation | Completion evidence |
| --- | --- | --- |
| 1 | Canonical native nested-project containment/reparenting, ancestry invalidation and page/block/artifact scope identities | Real native producers, independent access checks, cycle/reparent/isolation tests |
| 2 | Broader finalized assistant-turn coverage, longer-history window/rebase, governed/historical artifact evidence, genuine block-inspection capture and consumption v2 | Grounded source/lifetime/replay proofs and negotiated client/inspector integration; no unsupported completeness claims |
| 3 | Purpose/provider/model/budget grants; native changed-scope manifests, leased jobs, accounting and withdrawal lifecycle | Real caller admission, atomic publication/watermarks, original provider receipts and revoke/erase/recovery tests |
| 4 | Grounded rolling semantic summaries and evolving inferred profile facets | Supporting/counterevidence, coverage/contradiction handling, correction/suppression and conservative scope generalization |
| 5 | Production semantic embeddings/index outbox, readiness, hybrid retrieval and deletion/reindex recovery | Qualified provider plus PostgreSQL/pgvector service binding, partitioned retrieval and final native source checks |
| 6 | Learned nightly suggestions/autocomplete and cross-surface controls | Native exposure/accept/reject/undo lineage, quality/rate limits and actual editor/Canvas/Library/Re-entry consumers |
| 7 | Native quality baseline and operations tooling | Source-free freshness/index/cost/privacy metrics, accounting reconciliation and deletion/restore drills |
| 8 | Release migration integration for the three pending Memory candidates | Append-only migration assignment, ORM/snapshot consistency, exact-schema preservation, supported local migration tooling and qualified hosted execution |

The shadow index/outbox, synthetic benchmark and reference ledger are not substitutes
for these pipelines. Source capture currently stops at 12 complete queued Chat
Studio pairs over two proof frames; it is not a rolling semantic summary.

## External dependencies and retained decisions

The recorded production direction remains PostgreSQL/pgvector with a
Sites-compatible HTTP connection. No such connection is configured in the inspected
Sites environment. Its service selection/provisioning is unresolved; D1 is not
silently substituted as the vector service. Model/dimensions, measured caps and
broadened retention/sharing policies remain qualification/rollout dependencies.

Already accepted: keep Memory with Forma data; reuse the existing OpenAI credential;
charge AI allowance for now; use a benchmark to set the monthly cap. The retained
**$10 one-time synthetic benchmark ceiling is not a monthly cap**. No provider
spending or new user consent is inferred from publishing.

## Schema and activation boundary

`db/memory-benchmark.pending.sql`, `db/memory-benchmark-native.pending.sql` and
`db/memory-conversation-capture.pending.sql` remain **unassigned and unapplied**.
The current release intentionally packages only the unchanged historical migration
set. Automatic reference-only capture requires the evolved conversation schema;
the benchmark requires both of its schemas and genuine qualification.

Prepare the additive benchmark schema with its exact triggers, one statement per
breakpoint and matching ORM/journal/snapshot metadata. Prepare the conversation
candidate separately: it needs all 30 statements in one atomic batch/transaction,
plus exact supported migration-tool handling. Do not weaken its assertions or run
statements independently. Deploy compatible readers before installation, and do
not automatically downgrade after zero-annotation rows exist.

Hosted scheduling, provider/host privacy qualification, benchmark measurement,
browser/human acceptance and each user's affirmative enrollment remain in the
[non-implementation checklist](forma-memory-nonimplementation-work-2026-09-17.md).
Memory flags, scheduler registration and enrollment remain unchanged/off.
