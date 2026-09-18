# Memory: Sites implementation and external capability To Do

Updated 2026-09-18. Part of [MEM-002](backlog.md#memory), not a new or reduced plan.
The [full implementation reconciliation](forma-memory-implementation-2026-09-17.md#remaining-source-work)
and [operational gates](forma-memory-nonimplementation-work-2026-09-17.md) remain open.

## Implemented in this continuation

- Additive D1 change checkpoints, written atomically with each enrolled scope's
  native source references and cursor. One coalesced row per enrollment contains
  bounds, counts, times and a random generation; no source text, event IDs or
  vector data. Counts mean observed references, not comprehension or current evidence.
- Actor-owned `/api/memory/processing` status, with current native access and exact
  schema/enrollment guards. It explicitly reports semantic processing as unimplemented.
- Checkpoint invalidation for source and enrollment changes; explicit scoped
  Forget/erasure integration, schema-race rejection and bounded physical expiry.
  Expiry runs independently of learning admission when a scheduled invocation occurs;
  a missing scheduler is still a missing cleanup delivery guarantee.
- Closed guest-custody schema compatibility for the exact new migration only.
- `scripts/qualify-memory-migrations.mjs`: a no-target, no-apply command checking
  the three hash-pinned pending candidates in disposable SQLite. It validates
  additive source chunks and the atomic conversation schema change, then rolls back.
  It does not qualify hosted execution, install candidates, or enable provider work.
- ORM conversation constraints corrected to the actually deployed minimum of one
  annotation. Zero-annotation reference capture remains gated by its separate pending
  30-statement rebuild; historical migration SQL was not rewritten.

**Checkpoint limits:** these are disposable hints, not a reliable derivation or
index-deletion queue. Invalidating a hint can discard its dirty range. A semantic
worker must independently reread native custody, source lifetime, source exclusions
and purpose/budget authority. No semantic summary, inferred profile, learned
suggestion or vector index is created by this change.

## Merge-ready continuation (not published)

The branch is based on local main `7d74584bb72a1ed3cbab25ee64071994f8976d2f`.
This continuation does not change production configuration or enroll anyone.
The [native continuation record](forma-memory-native-continuation-2026-09-18.md)
tracks the subsequent 64-pair bounded capture, saved-answer compatibility, shared
Forget retirement fix and unverified derivation-parser component. The subsequent [purpose-control slice](forma-memory-purpose-controls-2026-09-18.md)
adds qualified separate consent and privacy controls. [Durable reference delivery](forma-memory-reference-delivery-2026-09-18.md)
now adds consent-specific queue registration, catch-up and privacy-safe retention;
[native admission](forma-memory-native-admission-2026-09-18.md) adds exact single-consumer
reference leases and protected budget primitives; [full original source capture](forma-memory-native-source-capture-2026-09-18.md) adds exact original evidence, typed observations and bounded privacy-safe replay. These slices do not complete
the open native pipeline table below. The [finance foundation](forma-memory-finance-foundation-2026-09-18.md)
adds retained cap floors and protected original accounting. The subsequent
[financial execution slice](forma-memory-financial-execution-2026-09-18.md) implements
source-bound admission, one-shot provider transport, original-ledger recovery,
organization deletion and localized cap/privacy controls with isolated tests.
Durable semantic publication, worker integration, broader scopes/producers and
full integration remain implementation work, not external-service gates.

- Canvas now records a personal artifact view only after the actual viewer opens,
  hashing the exact retained bytes and rechecking route, revision, custody and visibility.
- Canonical actor-private document/project identities and native declaration/lifecycle/
  custody proofs are shared by native recall, source selection and palette inspection.
  Project ancestry remains explicitly unresolved; identity is not an access grant.
- Negotiated consumption v2 joins genuine navigation and retained **current personal**
  artifact-view receipts in the opt-in inspector, with its own source ordinal map.
  Scheduled source publication preserves original lifetime ceilings, resumes bounded
  pages, and rolls back the cursor if source writes are unacknowledged.
- Exact native body/revision and final privacy replay reject changes to access,
  enrollment, custody, source content and compensation. These observations mean only
  that a viewer opened; they do not measure attention, reading or preference.
- Artifact observations remain excluded from assistant answer origins and exports.
  Historical and governed artifact evidence, genuine block inspection, longer rolling
  conversation capture, and durable inferred-output inverses remain implementation work.

Verification: 625 focused artifact/client/UI checks and 51 focused native runtime
checks passed; typecheck and production build passed. These are local tests, not
hosted provider, browser, scheduling or real-user qualification.

## Sites-native code still to implement

These are not external-service blockers and must not be moved into a rollout-only list.

| Work | Concrete next step | Completion evidence |
| --- | --- | --- |
| Purpose grants / native accounting integration | Consent, source-bound native holds, payer-month caps, one-shot transport, settlement/recovery and manual UI are implemented; connect them to durable semantic processing | Real admission/accounting/recovery and privacy tests, no automatic enrollment |
| Reliable changed-scope delivery | Reference jobs, leases and [bounded recovery](forma-memory-native-recovery-2026-09-18.md) are implemented. Complete processing windows, durable semantic results, completed cursors and index outbox acknowledgements | Cursor/publication atomicity, replay, backpressure, source invalidation and deletion acknowledgements |
| Wider scope identities | Implement canonical nested-project and page/block/artifact identities, bounded ancestry and reparent invalidation | Cycle, move, isolation and independent access-versus-relevance tests |
| Broader source and consumption coverage | Extend original assistant capture, longer-history rebase and genuine inspection/reuse evidence | Exact source/body/lifetime/custody proofs; do not infer preference or comprehension from a click |
| Semantic/profile and suggestion callers | Citation parsing, provider adapter and [fresh read-only evidence](forma-memory-native-read-evidence-2026-09-18.md) are implemented; persist complete dependencies, corrections/suppression and publish guarded scoped suggestions | Local adapter tests can proceed before external qualification; actual provider/index integration stays gated |
| Runtime observability | Add purpose-minimized derivation/index freshness, accounting and deletion status as those pipelines become real | Native measurements and failure drills; no text/vector payloads in general analytics |
| Pending migration integration | Assign candidates only after review, matching ORM/snapshot generation and qualified execution path | Append-only history, full rollback/row preservation and exact reader compatibility |

## Capabilities not available directly through the inspected Sites tools

Tool availability is evidence about this environment, not a claim that Sites can
never support these services. Sites currently provides D1/R2 and Worker-compatible
application code. The tool inspection exposed no scheduler registration, managed
PostgreSQL/vector provisioning, queue/workflow provisioning or hosted atomic SQL
executor for the pending rebuild. `get_site` can describe automations when available;
its omission here is not proof that no schedules exist.

| External / unqualified work | Tracked next action | Gate / owner |
| --- | --- | --- |
| PostgreSQL/pgvector service | Select/provision the retained PostgreSQL direction, with an authenticated Sites-compatible HTTP adapter, scoped partitions and deletion/reindex contract | Service owner unassigned; keep vectors with Forma user data; do not silently substitute D1 |
| Hosted invocation registration | User is arranging scheduling; identify supported Sites scheduling or an approved external scheduler and authenticated delivery | Isolated capacity, duplicates/missed runs, concurrency, timezone, recovery and no-visitor privacy cleanup qualification before enrollment |
| Durable external delivery, if required | Determine whether existing D1 leases suffice at measured load; otherwise qualify a queue/workflow adapter | No unrequested service provisioning or spend; preserve original IDs and uncertain outcomes |
| Hosted conversation rebuild | Qualify an executor that applies all 30 candidate statements in one atomic transaction/batch and preserves exact rows/schema | Local SQLite/workerd success does not qualify the hosted tool; never execute chunks as independent commits |
| Provider/model qualification | Verify access, current pricing, retention/residency and original usage receipts for the existing approved credential | No key rotation/re-request or synthetic approval records; real provider calls remain gated |
| Benchmark and monthly cap | Run the approved isolated experiment only after native/provider qualification; use measured usefulness and cost | AI allowance for now; one-time $10 ceiling is not the monthly cap; user approves measured cap |
| Operations and user acceptance | Name an operations owner, qualify restore/erase and browser/device behavior, then collect each user's affirmative enrollment | No real-user enrollment inferred from publication or site use |

## Release boundary and verification

New additive migration: `0042_memory_live_change_checkpoints.sql` (five explicit
schema objects). The three `db/*.pending.sql` candidates remain unchanged,
unassigned and unapplied. Runtime flags, audience, enrollment, provider credentials,
scheduler registration and billing authority are unchanged.

The release receipt and final test results are recorded in the
[release status](forma-memory-release-2026-09-18.md). This checklist does not itself
schedule work, provision a service or establish human review.
