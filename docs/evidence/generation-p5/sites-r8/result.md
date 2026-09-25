# P5 R8 — local diagnosis complete; bounded diagnostic ready for review

Both packaged migrations reconstruct all 172 sealed objects exactly:52 tables,62 indexes,57 triggers,one view. All 19 sealed source files match the retained source archive and native commit1565d8ac; all 9 deployed-archive payloads match, including the admitted decompressed tar hash. There is no retained-evidence proof of a missing migration or changed application DDL.

The original local Miniflare harness applied SQL statements directly. Running the installed Drizzle 0.45.2 D1 migrator against those exact files creates `__drizzle_migrations`, which the existing Start guard does not exclude. The focused run reproduces `schema_mismatch`, zero Start writes and no run. All172 expected definitions remain identical. This is a concrete local bookkeeping hypothesis, **not identification of the native Sites mechanism or hosted cause**.

A second local experiment changes whitespace inside column definitions. It leaves PRAGMA column/foreign-key/index structure unchanged but changes 23 raw definitions. SQLite itself removes the tested extra spacing after CREATE TABLE, producing no difference there. [Raw differences](local-catalog-diagnosis.json) are preserved before any proposal to normalize. The candidate does not normalize or weaken equality. Meaningful SQL differences in constraints, nullability, unique indexes and trigger bodies remain detectable.

The retained overview's50 names match exactly the first 50 of 52 expected tables. `project_resource_scopes` and `users` are merely unlisted. The retained overview contract has no pagination/limit input or next-cursor output; its returned projection claimed 0 omitted. That contract does not establish a hard 50 backend cap or absence of those tables. No guessed follow-on call was made.

## Supported diagnostic and validation

The current tool inventory exposes no Sites connector. Restored Sites 0.1.71 guidance supports native deployment and schema-only immutable migrations but exposes no full-catalog export in the retained native contract. It would be incorrect to direct the owner to an unmanaged database console. The smallest platform alternative is a supported owner-only, bounded read of `sqlite_schema` definitions (type,name,tbl_name,sql), with completeness/bounds metadata and no user rows or writes. No platform request was sent.

The local candidate implements that read through one owner-only action, retaining original authentication/origin/body checks and all Start behavior. It branches before every application/run row read. One fixed query returns exact definitions, including named bookkeeping definitions for offline comparison. It is bounded in SQL and at the complete-response boundary. Caller SQL/pagination, malformed identity/origin/headers and oversized requests are refused.

**21 focused checks passed** in compiled workerd/D1. They cover exact raw catalog, actual local Drizzle migration, original refusal preservation, authorization/input failures, absence of hidden run/user-row reads, sentinel-row/N10H preservation, byte/row/SQL bounds, and raw semantic differences. Zero outbound attempts. Prior 29 lifecycle checks and 266 tests were not rerun. Source archive reconstruction, exact deployed-source binding and package comparison are separate checks.

The unchanged Sites packager produced a nine-file archive after disabling macOS AppleDouble metadata via COPYFILE_DISABLE=1. Only the Worker payload differs from the admitted version 2 archive. The final compiled Worker hash equals the tested Worker hash. Local packaging is not native archive admission.

[Review the exact changed action](decision.md), [Worker diff](worker.diff), [new diagnostic module](catalog.mjs), [checks](diagnostic-validation.json), and [immutable envelope](release-envelope.json). No hosted call was issued; ledger remains9 charged / 28 unused. Existing approvals are preserved, not repeated. P5 remains open.
