# Memory schema repair after production 495

Status: **local qualification complete; hosted inspection and application pending**.
Memory activation, user enrollment, schedules and provider calls remain disabled.
This continues [MEM-060](backlog.md#mem-060--authorized-publication-and-hosted-migration-hold).

## Scope and controls

The fixed manifest is generated from the unchanged 31 journaled Memory migrations
following the pinned 41-migration production494 prefix. It contains361 explicit
objects across42 tables. Its identity is
`fd1752125f0e8818adc70a7805e74413c00d165adc898ccb2b2ad8ab25bd3ef9`.
Builds check the generated manifest against source; no SQL from a caller is accepted.

The administrator-only inspection/repair page is
`/api/portfolio/engineering/memory-schema-repair`. It uses the existing principal
administrator admission and requires both identity-management and engineering
 diagnostics capabilities. Project/impersonation contexts are refused. Inspection
reads schema metadata and aggregate emptiness checks only, without bootstrap,
retention, user-row export or provider activity.

Application additionally requires the deployment variable
`FORMA_MEMORY_SCHEMA_REPAIR_MANIFEST` to match the exact manifest, all Memory
activation switches to remain off, and a same-origin POST form with the inspection
proof. The transaction rechecks current administrator/pilot authority, schema
snapshot, database settings and existing new-table emptiness. Unknown objects,
incompatible declarations/parent columns, unexpected receipt hooks and populated
new Memory tables fail closed.

Before installation, a separate fixed batch creates a reserved probe table, inserts
one synthetic row, then deliberately violates its NOT NULL constraint. Only the
exact expected failure plus an unchanged catalog and absent probe table qualifies
rollback. No Memory/user table is touched by this rehearsal.

One D1 batch installs missing tables/indexes/triggers and replaces only exact known
historical trigger/index versions. It drops no user table, copies no user rows and
executes no application DML. A final exact-catalog and foreign-key assertion must
pass before the separate `__forma_memory_schema_repair_receipts` row is written.
The temporary assertion table is removed within that same batch. Any statement
failure rolls back the entire batch. Repeated successful requests are read-only.

Original SQL, the source journal and Sites/Drizzle applied-history receipts remain
unchanged. This repairs the resulting schema directly; it does not qualify or
rewrite the failing deployment migration executor. The **guarded packaging hold
must remain** so a later publication cannot blindly replay held migration files.

## Verification

- Isolated SQLite and actual local workerd D1: exact final schema, first install,
  partial0043/0044 installation, known0044/0051 trigger upgrades and repeat safety.
- Negative cases: unknown trigger/table/parent schema, populated tables, reserved
  guard, malicious receipt trigger, stale proof, concurrent schema changes,
  revoked authority and failure during or after the DDL batch.
- Actual Worker route: default-disabled writes, principal/capability restrictions,
  same-origin form checks, refusal while Memory is enabled, no inspection writes
  or retention, and successful administrator-form application.
- TypeScript, changed-file lint and integrated production build.

## Hosted procedure

1. Publish this route with the existing migration hold and Memory off. Inspect in
   an existing authorized administrator session. Do not forge identity headers.
2. If status is `ready`, enable only the exact repair-manifest variable in Sites
   and deploy the saved version. Reinspect; apply the explicit fixed repair form.
3. Verify `complete`, the361 objects/42 tables and the distinct repair receipt.
   Remove the repair-manifest variable and redeploy. Confirm repair is disabled
   and ordinary authorized application reads still work.
4. Record exact source, versions, deployments and the read-only postcheck here.
   Keep the failed495 history. Preserve audience and newer image-model settings.

A failed request is not permission for a blind retry. Inspect first: an uncertain
response can represent a committed repair. Unknown schema must be explained and
reviewed rather than added to an allowlist merely to pass a check.
