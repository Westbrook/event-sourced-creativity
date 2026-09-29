# Relationship privacy retirement — 2026-09-19

Status: local feature-branch implementation; migration packaged, not applied to
production. No activation or enrollment.

## Closed gap

Native Memory already records genuine relationship add/remove actions as
**document-level descriptive observations**. Migration0055 adds the missing
immediate privacy inverse: adding/replacing/removing that relationship, or
inserting/updating/deleting its resource custody, atomically withdraws retained
results that depend on its native events. The result body and manifest are
cleared and dependency rows are removed. If migration0054 is installed, the same
transaction converts the existing index intent to a terminal deletion intent.
A failed transaction rolls all of those changes back together.

Matching uses both owner stream and native relationship ID. Unrelated links and
same-ID resources owned by someone else do not retire a result. Recorded provider
usage is not refunded or mutated by privacy retirement.

## Migration boundary

`0055_memory_derivation_relation_lifecycle.sql` is four additive triggers. It
creates no data tables, copies no source bodies, backfills no rows, rewrites no
historical SQL and registers no schedule. Its exact schema profile is accepted
by both native derivation and guest isolation readers; partial or extra guards
still fail closed. It requires the native result schema. Source packaging is not
hosted qualification or permission to run the migration here.

## Remaining integration

This does not certify either endpoint's historical version, establish a reuse
edge, grant cross-document access or prove user preference. [Document-local relationship version capture](forma-memory-native-relationship-bindings-2026-09-19.md) is now implemented. Library/canvas/reuse evidence, nested scopes and automatic
consumers remain implementation work. The broader remaining work is tracked in
[the continuation](forma-memory-native-continuation-2026-09-18.md) and
[the Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).

## Verification

Synthetic native writer → reference delivery → mocked derivation → private
publication tests cover remove/replacement, resource insertion/update/deletion,
unrelated links, foreign owners and rollback. Isolated D1 verifies atomic result
retirement and the terminal deletion intent. Migration replay and guest schema
closure are tested separately. No real provider, production or user data is used.
