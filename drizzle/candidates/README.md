# Still unified creation candidate migrations

These additive schemas support the local v19 implementation and disposable SQLite tests. They are intentionally outside the release migration journal and do not change the held deployed baseline.

- `0074_still_creation.sql`: private drafts, retained execution and atomic commit receipts.
- `0075_still_creation_search.sql`: scoped search manifests, protected source pointers, lexical postings and resumable indexing.

The default-off creation routes ensure the equivalent schemas for local feature testing. Before any rollout, qualify the target database and provider/index configuration, review these candidates against the then-current migration sequence, and integrate them through the approved migration release process. File numbers here are prospective, not evidence of application to a database.
