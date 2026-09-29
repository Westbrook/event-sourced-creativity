# Memory completion and release status

Updated **2026-09-18**. Tracks [MEM-001 and MEM-002](backlog.md#memory).

**The complete scope-aware Memory plan is not implemented.** This release delivers
the verified implementation accumulated on the Memory branch with learning,
enrollment, scheduling and the synthetic benchmark still disabled. Publication
must not be described as completing the semantic/profile/nested-scope system.

## Current release: Sites-native continuation

**Published to production as version 435 on 2026-09-18 at 16:48:05 UTC**, from
remote/local main `e068acad974617801ac59cf58a6b5611c8273a04`.
The [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md)
records the delivered metadata checkpoint, source-free processing status, scoped
privacy invalidation and no-target migration qualification tooling. This is not
semantic processing or a reliable derivation/index queue.

| Receipt | Verified value |
| --- | --- |
| Saved version | `appgprj_6a7a020e334881919ed8aea0363cb98f~appgver_28615b1a116c81918fe32aa2acd5e9fe` (435) |
| Deployment | `appgdep_6aad6b34547481918fc8df4274fa0af7` — `succeeded` |
| Source | `e068acad974617801ac59cf58a6b5611c8273a04` |
| Environment / audience | Environment revision 13; `workspace_all`, access revision 7, zero external visitors; unchanged |
| Packaged migration | Additive `0042_memory_live_change_checkpoints.sql`; five explicit objects, regenerated snapshot/journal |
| Archive | 623 files; server-recorded SHA-256 `ecb62c31f59315ab95f2d19ef97566b352364b6cffdf201965433c417b6fc905` |
| Prior production preserved | Jev refresh repair 434 (`475f0b0`), safety/Still 433 (`91c06d9`), inline recovery 432 |

Verification: 79 selected privacy/runtime tests (including all 18 checkpoint
checks), 100 closed-guest inventory tests, 47 migration/tooling tests and 44
SQLite/local-D1 capture/rollback tests passed. After the final Jev integration,
53 selected native routes, 28 direct Still/safety/refresh tests, the 47 migration
checks, 44 SQLite/local-D1 tests and exact guest-checkpoint schema test passed
again. TypeScript, changed-file lint and production build passed. These are
focused checks, not a whole-repository green claim or hosted qualification.
The independent-cleanup test confirms a checkpoint failure does not skip profile
privacy maintenance. No test made a real provider call.

The unpublished Memory migration was regenerated as 0042 after the already applied
`0041_still_decision_cache.sql`; that migration and its 0037 snapshot remain unchanged.
The installed Sites packaging helper disappeared during the run, so the validated
Worker `dist/` output was archived using the same build-output-only command confirmed
by the production owner; no source, pending SQL, dependencies or credentials were
packaged. Native save/deploy returned success. No production rollback drill is claimed.

The three pending Memory candidates remain unassigned/unapplied; learning flags,
enrollment, scheduling, billing authority and provider secrets were not changed.
The post-publication receipt update is documentation only. Remaining native code
and external capabilities are separately tracked; the original plan stays open.

## Earlier release: production 426

**Published to production as version 426 on 2026-09-18 at 12:50:59 UTC.**
The verified implementation was fast-forwarded to the Sites source repository's
`main` at `d8acb72eed4cfaf4028b749ae6ca29ba264f73c2` before publication.
It includes main's `e26f608` (Still attention, decision caching and generation-risk
acknowledgment retained), the [native producers](forma-memory-native-producers-2026-09-18.md)
and prior explicit-recall/benchmark-accounting integration. This receipt is a
post-publication documentation-only follow-up; it does not change the deployed
runtime. The production owner's unrelated dirty local checkout was left untouched.

| Receipt | Verified value |
| --- | --- |
| Site | [Forma Creative Studio](https://forma-creative-studio.reve-ai-0869.chatgpt.site) |
| Saved version | `appgprj_6a7a020e334881919ed8aea0363cb98f~appgver_d417441d1c6c8191a3b84d4faf232040` (426) |
| Deployment | `appgdep_6aad33a44d248191bcb4da8572a0c46e` — `succeeded` |
| Environment | Revision 13, unchanged; Memory flags remain unconfigured/default-off |
| Audience | `workspace_all`, access revision 7, zero external visitors; unchanged |
| Archive | 619 files; server-recorded SHA-256 `caad2b8e83e259ffd7baa51e671cb8218bef1d6a3dee4c036552894270c04217` |
| Migrations | Existing 74 historical SQL/metadata files only; no pending Memory SQL packaged or applied |
| Prior production | Version 425 at `e26f608f058b892027b29e9bc4c3ee82343c4895`; no rollback drill is claimed |

The active publisher was notified before and after publication. Message delivery
is not a claim of accepted future operations ownership or human review.
No external visitor, enrollment, schedule, paid provider call or activation was
added by this release.

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
The earlier 426 release packaged only unchanged historical migrations. The current 435
continuation adds 0042 after the preserved Jev 0041 migration, without any pending SQL. Automatic reference-only capture requires the evolved conversation schema;
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
