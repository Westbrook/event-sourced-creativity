# Native Memory result storage and privacy inverses

Status: implemented on `codex/forma-memory-foundation`; **not deployed or activated**.
This completes a durable private-result lifecycle, not the entire Memory system.
The [continuation record](forma-memory-native-continuation-2026-09-18.md) retains
unfinished native work separately from external qualification and enrollment.

## Implemented

- Native provider receipts can publish a bounded result body, its complete input
  manifest and normalized dependency index in one atomic transaction. The same
  transaction rechecks every source, current consent/access, original lifetime,
  private job/finance linkage and accounted usage. Plain model JSON cannot publish.
- Each job/financial operation has one immutable result. Staging becomes active
  only with a complete inverse index. A lost or malformed acknowledgement remains
  uncertain; retrying a matching retained result is idempotent and never sends
  another provider request. Withdrawn results cannot be resurrected.
- Dependencies include **all** supplied originals, including uncited originals,
  typed event observations, native turn identities and paid task/consent/result/
  saved ancestry references. Source changes, deletion, replacement and identifier
  moves retire affected bodies and remove their indexes in the source transaction.
  Unrelated source changes do not erase another result. These conservative inverses
  also invalidate on no-op source updates; precision can be improved later without
  relaxing erasure guarantees.
- Reads first authenticate the native actor and current job/scope/purpose, before
  loading result bodies. Fresh native capture must exactly match the persisted
  manifest and complete inverse set. Retention is never renewed by a read. Copied
  handles, another actor, stale access and changed sources fail closed. Readers
  receive opaque short-lived evidence for use in a future consumer's own atomic
  answer publication, not permission to make another paid request.
- Authenticated owners can withdraw a single result even after losing source
  access. Its body, hashes and inverse index are removed; a job-lifetime tombstone
  prevents delayed republication. This is **not** cross-job lineage suppression.
- Existing personal erasure, purpose/grant withdrawal, organization deletion and
  job expiry include result descendants in their exact deletion receipts. The
  organization's legal hold still blocks the existing organization-erasure route.
  Private-result deletion does not refund or erase retained financial usage.
- Source-free expiry is bounded to 16 results per invocation and is connected to
  the existing native scheduled-event maintenance hook. Financial recovery still
  runs if another maintenance step fails. No hosted schedule was registered.
- Guest generated-result inventory understands this optional schema and refuses
  guest aliases in normalized keys or retained manifest identity leaves, including
  duplicate JSON keys. The schema and manifests do not grant guest custody.

Access changes are checked on every read. Immediate physical inverses in this
slice cover the indexed source tables; this does not claim every possible access
metadata transition physically erases a result at that instant. Remaining consumer
publication and index deletion paths must carry their own current proof.

## Migration and compatibility

`0047_memory_derivation_results.sql` adds two tables, three indexes and 34 guards/
source-inverse triggers: **39 schema-only statements**, no top-level data mutation.
The ORM snapshot is `0043_snapshot.json`, journal index 43; earlier snapshots and
migration bytes are preserved. The migration requires genuine predecessor tables,
including native assistant and consequential-execution tables. Timestamp-skipped
predecessors are an error, not permission to fabricate replacement tables.

The result schema is optional and exactly qualified. Partial/altered schema,
unknown inbound objects and missing privacy guards fail closed. The local runner
covers transactional dry-run rollback, idempotent repeat and foreign-key validity.
This additive candidate is unapplied in production. See [local migrations](local-migrations.md).

## Verification

Final local receipts: **255/255 native derivation/tenant tests**, **5/5 scheduled
maintenance checks** after the final cleanup refactor, **71/71 migration/history
checks**, **44/44 guest-isolation checks**, and **44/44 conversation migration
checks**. Typecheck, changed-source lint and production build pass; existing build
chunk-size warnings remain. Counts cover separate or overlapping focused runs and
are not a full-suite total. Detailed logs are retained in the Memory lane handoff.
Coverage includes
personal/shared SQLite and isolated workerd D1 publication/read/erasure, complete
nonempty candidates, lost acknowledgements, rollback and late-source races,
original retention, replacement and rekey inverses, paid ancestry, existing privacy
routes, legal hold, and guest isolation. All provider transports are mocked and
all data is synthetic; there are no real provider calls or charges.

This is not hosted scheduler/provider qualification or a clean full-repository-suite
claim. Eight previously reproduced Output whole-request budget failures remain
open and are not waived by these Memory checks.

## Still in scope

1. Cross-job corrections and lineage suppression, including privacy/expiry and
   future learning/recall enforcement. One-result withdrawal is not sufficient.
2. Bounded processing windows, completed semantic cursors, a durable paid worker
   consumer and index outbox/deletion acknowledgements. No automatic result
   processing is connected yet.
3. Guarded user-facing summary/profile/suggestion/autocomplete consumers, rolling
   history rebase, wider scopes/producers and minimized pipeline observability.

`processingImplemented:false` remains. External services, hosted qualification,
benchmark-based monthly cap acceptance and explicit individual consent are separate
[tracked gates](forma-memory-sites-capability-todo-2026-09-18.md), not substitutes
for the native implementation above. No UI, audience, provider credential, budget,
production setting or enrollment changed in this slice.
