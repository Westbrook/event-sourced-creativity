# Native Memory index lifecycle

## Implemented locally

Migration0054 adds an empty, source-free index-intent journal and closed lifecycle
triggers. It is additive and schema-only, with no production application or data
backfill. Publishing a new retained native result records its upsert intent in the
same transaction. Withdrawal, expiry and job/grant erasure convert that intent to
a terminal deletion before the transaction commits.

The journal contains only the opaque result/job key, operation, generation,
transition time and (for an upsert) the **original** expiry ceiling. It contains no
actor or scope labels, source IDs, prose, embeddings or content digests. These keys
are technical metadata, not a claim of anonymization. Delete tombstones survive
source and grant erasure; they have no FK that could silently erase an unfulfilled
remote deletion obligation. Neither replacement inserts nor stale generation-1
work can resurrect a generation-2 tombstone.

Native preparation accepts only a fresh, privately issued result-read capability.
It carries the exact original/access/dependency/schema assertions and the current
intent into final consumer proof. A copied handle, saved JSON, old source receipt,
or queue entry is not authority. Preparation does not buy embeddings or dispatch
remote work. For results retained before the migration, explicit fresh preparation
may register the missing intent; the migration itself never scans private bodies.

Internal worker helpers provide bounded keyset deletion pages and source-free
queue counts. An unexpired queued result is **not** described as source-fresh or
indexed. All helpers report the external index as `unqualified`; they are not
public endpoints. Native result withdrawal, correction and grant/job cleanup
count the journal's exact additional mutation for both SQLite and D1 receipts.

## Verification

Isolated native tests cover atomic publication, original-backed preparation,
forged/environment-swapped capabilities, erasure with retained accounting,
terminal tombstones, recursive-trigger-independent replacement refusal, source
change, correction/release, expiry, transaction rollback, lost acknowledgements,
schema changes and fresh-only pre-migration registration. Real D1 exercises
personal/shared erasure and counted correction. No external requests are made.

Final validation: **399 affected native runtime tests** and **225 migration/guest
schema tests** passed. Typecheck, changed-file lint and production build passed
(the existing large-chunk warning remains).

The migration reconciler and guest schema inventory include the exact new profile;
missing or unqualified inbound triggers remain fail-closed. Final check counts and
receipts are recorded in the continuation handoff.

## What this does not claim

There is still no remote vector index, embedding purchase, indexed-success receipt,
or remote deletion acknowledgement. The configured PostgreSQL/pgvector HTTP service
must enforce generation fencing and expiry, and its native adapter must validate
current consent, source proof, embedding qualification, spend admission and exact
remote receipts. Only after that qualification can deletion acknowledgement and
bounded tombstone compaction be safely enabled. These remain explicit gates in the
[capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).

A local delete intent does not prove remote deletion. A local queue does not grant
permission to send user data to a new service. No enrollment, configuration,
schedule, provider traffic, migration application, merge or deployment occurred.
