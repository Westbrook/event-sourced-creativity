# Exact schema coexistence; no migration proposed

Local inventory rechecked against the actual release code: **72 source SQL files and72 journal entries;41 packaged baseline migrations;31 held**. “41 held” in the continuation describes the wrong side of that split. The policy and every source migration match retained R1 hashes; none was renamed, rewritten, promoted or executed on a hosted database. [Exact file lists and checks](schema-coexistence.json).

[`releaseMigrationPolicy`](../../../../build/release-migrations.ts) checks immutable baseline commit/version, source journal SHA256, exact prefix journal entries and each baseline file hash. The build copies only that41-file release set. Both current `dist/.openai/drizzle` and final archive manifest are checked against it. The three optional P2/P4 SQL inputs remain outside the release journal/artifact. All31 held files remain in source. The private synthetic schema closure and `__drizzle_migrations` pin are not part of this app release.

Two independent disposable SQLite reconstructions use unmodified files:

| Local scenario | SQL-defined objects before | With existing R1 final P2/P4 additive candidate | Existing definitions changed |
|---|---:|---:|---:|
| Packaged41 |383|432|0|
| All source72 (test-only) |744|793|0|

The49 optional definitions are reviewed for coexistence only; **this proposal does not install them**. Current native applied history and actual catalogs remain unknown. Local DDL execution is not a test of native migration machinery. The first compiled-fixture setup attempt correctly failed the existing model3d migration's settings guard because Python defaults foreign keys off. The local harness was corrected to set `PRAGMA foreign_keys=ON`; no migration or runtime guard was changed.

The preflight reads `sqlite_schema` with fixed ordering and bounded output. It emits type/name/table and SHA256 of the JSON string encoding of the **unchanged raw SQL**, matching `consentHash`, not a whitespace-normalized definition. SQL-NULL autoindexes are implicit in captured table primary-key/unique DDL; the receipt explicitly concerns all SQL-defined objects. Every explicit index/trigger/view is included. Unsafe/unbounded names are hashed before output. No real row/body/source/SQL dump is returned.

The four retained local catalogs support exact offline missing/extra/changed hash comparison using [the comparator](../../../../scripts/compare-generation-p5-qualification.mjs). No extra platform object is discarded automatically. In the compiled local test, platform bookkeeping is reported as an extra; that is **not** a hosted finding or an accepted global pin. Raw SQL differences cannot be reconstructed from a hash: an unexplained mismatch is a refusal and a separate exact read-only diagnostic proposal, not permission to normalize semantics away.

Native applied history remains a distinct condition. `__appgarden_migrations` is inspected only through fixed column/name queries when the expected name/id column contract is present; output explicitly says names-only and `runnerExecutionCertified:false`. Unknown runners are unavailable, not guessed. A current source/saved archive/terminal native deployment chain and the platform's migration-before-deployment contract can support unchanged baseline provenance; name records alone cannot authenticate migration bytes. If those receipts cannot establish that publishing this exact baseline introduces **zero** schema changes, do not publish merely to discover the answer. Seek the smallest supported read of the existing migration-name table or deployment archive/history under an exact later read scope; no arbitrary SQL or physical IDs. This limitation is explicit, not an invitation to install optional49 or held31.

The read route passes on the smaller41 baseline without optional study schema and reports its missing dependencies as unavailable. It does not require a fabricated complete production catalog to run. The source and optional exact P2/P4 guards, columns, constraints, indexes and triggers remain intact; no equality weakening or catalog aliasing is introduced.
