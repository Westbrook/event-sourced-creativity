# Schema qualification — source preparation completed, hosted compatibility unknown

The fresh [native read-only inventory attempt](hosting-baseline-receipt.json) did not expose the applied-migration ledger or full schema definitions. No production authored/private rows were read, no migrations were applied, and no backup or restore operation was invoked. v550 success is not proof of the database's applied history. A prior failed deployment could have applied schema before failing its Worker upload.

## Exact candidate identity and dependencies

[The generated manifest](schema-candidate-manifest.json) hashes each source file and every ordered SQL statement. Its orders 1–4 are **dependency order, not deployment journal numbers**. Target Site/physical D1 IDs and host journal sequence remain null until reconciled. The manifest is deliberately marked source-only, unauthorized and non-deployable.

1. Creation drafts/operations candidate depends on the existing private-content and canonical authoring infrastructure.
2. Search candidate depends on (1), `events`, `event_private_payloads`, `project_event_scopes`, `project_resource_scopes` and their exact current column definitions. It adds protected snapshot pointers/heads and replaces creation-search and snapshot-purge triggers; it does not rewrite authored rows.
3. Semantic index candidate depends on (2), users and current organization/project membership, migration, capability, security, identity and retention-policy tables. Its custody invalidation triggers require all referenced source columns. The authority resolver also depends on the corresponding existing access schema.
4. The isolated qualification budget candidate depends on reconciled D1 capability and explicit qualification authorization. It adds only three reservation tables and their accounting trigger, installs no admission rows, and is not a production activation requirement. It remains outside the disabled 41-migration archive. Its missing-trigger dispatch rejection is covered separately by the provider-budget suite; this rehearsal verifies partial trigger installation recovers.

The source journal ends at `0073_memory_authored_images`; that is a source fact only. The approved disabled archive policy still contains exactly 41 migrations. This task does not journal 0074/0075 or the semantic candidate, and does not modify the held policy. **Never deploy v547.**

## Local rehearsal evidence

`scripts/still-qualification-schema.mjs` has no network, hosted migration executor or journal writer. The test uses the actual current Worker/application fixture with synthetic personal/shared authored events and private content, then runs the exact candidate statement bytes. [The receipt](schema-synthetic-rehearsal.json) records source manifest hash, full-schema fingerprints and six authored/receipt/scope-table counts plus SHA-256 digests before and after.

The suite installs twice and simulates a host failure after a committed statement prefix: early first table, first-candidate boundary, search trigger replacement, partial semantic tables/triggers, and just before final trigger completion. Each prefix is replayed using the whole exact idempotent manifest. All recovered schemas must equal the clean installation schema. Tests additionally verify invalid draft/enrollment/fence rejection, custody-enrollment invalidation creating durable work, ordinary session/event routes, disabled creation routes, zero initial enrollment, statement-tamper rejection and the 41-migration hold.

Final local result for the incremental/renewal working-tree candidates based on `2d8d3a3849a02ad63bf8a1ce9ba6f3bfadbb2600`: **14/14 combined schema tests passed** (12 hosted-preparation tests plus two existing candidate/migration regressions), with 166 ordered statements (6/61/95/4), 109 added schema objects and six partial-prefix recovery points (1/6/20/71/161/165), including budget tables installed before the accounting trigger. Generated search and semantic SQL exactly match their runtime schema definitions. [The latest validation log](schema-withdrawal-validation.log) records the scoped result; ESLint and diff checks also passed.

The semantic candidate includes indexed private-content cleanup, routing, owner withdrawal overlays, metadata-only projection skeletons and unfinished-operation invalidation triggers. The search candidate adds retained snapshot pointers/heads and purge triggers. The new `suspended` object state requires no column alteration because the existing state column is unconstrained text. A migration regression verifies active objects suspend only when a retained snapshot exists, receive a maximum 300-second deletion deadline, and retire without extending that deadline when the snapshot is purged. Repeated ordinary invalidations preserve an earlier pending erasure deadline. These are local SQL results, not a hosted deletion-time guarantee.

Compatibility review found that modified enrollment/policy/owner triggers initially used `CREATE TRIGGER IF NOT EXISTS`, which would retain older definitions without snapshot purges on repeat installation. The candidate now explicitly drops and recreates those triggers. A regression reinstalls earlier no-purge definitions, reapplies the candidate, and verifies exact replacement plus removal of retained snapshot heads/pointers on enrollment revocation. The generation-equality check also caught a transient source/candidate mismatch during concurrent generation; [that failed run](schema-incremental-generation-failure.log) is retained. Final source and candidate definitions match.

Final manifest identity is `19abc30864503bf1e5dd49f4b34b351acd543a2dc2fff000413b0726956d66d1`; final synthetic schema fingerprint is `62822eb59eb81f4b2eda8158dce6d723d8664acf240f1730514b97ed64574f3f`. The latest search candidate scopes foreign-Project `BlockRemoved` snapshot purges using exact source identities. Its private-sidecar insertion trigger rejects conflicting block, Project or owner claims by conservatively purging retained snapshots for the claimed owners; incremental reuse separately requires private-evidence agreement. The generated-SQL and repeat/recovery checks cover those exact candidate bytes. Regenerate these identities if source SQL changes.

Historical incremental checkpoint: manifest `9d31bc54bcc016b0303b57d14a4533c02f9f52abe0eb6b321c63c12799c99c01`, schema `915e75f21093c5afc87a6f96b1017d75fee5efdcdb42ea5d0f57e3ea2ec91620`, 14/14 local checks. Its [passing validation log](schema-incremental-validation.log) remains retained; the current manifest/receipt above supersede that candidate identity.

An intermediate regeneration removed statement separators, causing two rehearsal failures because a whole semantic file appeared as one statement. [The failed test log](schema-rehearsal-separator-failure.log) is retained. Restoring source statement boundaries fixed the harness evidence; no deployment occurred. The final tests use exact per-statement candidate bytes.

This is **local Node SQLite and current synthetic application schema**, not schema equivalence with production, native hosted D1 execution, host migration transactional semantics, live isolation or a hosted restore demonstration. The local committed-prefix model intentionally assumes weaker per-statement persistence so recovery cannot depend on whole-file atomicity. Existing incompatible table definitions are not repaired by `CREATE TABLE IF NOT EXISTS`; compare all definitions first and design a separately reviewed forward migration on mismatch.

Reproduce after any candidate change:

```sh
node scripts/still-qualification-schema.mjs > docs/qualification/schema-candidate-manifest.json
STILL_SCHEMA_REHEARSAL_OUTPUT=docs/qualification/schema-synthetic-rehearsal.json node --import tsx --test tests/creation-hosted-schema.test.mjs
```

Record the test exit status separately; receipt output by itself is not a pass certificate.

## Host-owned inventory and target manifest procedure

The Sites hosting/database owner must provide a supported **read-only export** containing physical database ID, Site ID, capture timestamp, full schema objects (type/name/table/CREATE SQL), and the complete actual applied-migration ledger (host-defined name, ordered entries, hashes, timestamps and failed/partial state). Include the supported read operation and evidence that the export is exhaustive. Exclude authored table rows. Request the exact ledger name from the owner; do not infer it from a framework convention or probe guessed names.

After receipt:

1. Hash and retain that inventory privately with provenance. Reconcile source journal, held archive and actual ledger; identify already applied candidates or drift without altering ledger history. Map candidate hashes to applied entries; the same name with different content is a stop condition.
2. Recreate the full exported schema in a disposable database with synthetic rows only. Verify required columns, constraints, indexes and triggers. Resolve each difference through an explicit additive/forward-repair migration. Do not run a complete source migration journal against production to make it look like the fixture.
3. Assign actual next valid host journal identifiers only after that reconciliation. Produce a replacement target-specific manifest including Site/DB IDs, ordered migration identifiers, byte hashes, predecessor/ledger hashes and the exact supported execution method. Review this manifest separately; source candidate numbering grants no authority.
4. Rehearse clean, repeat and every relevant partial-failure boundary on the schema-equivalent disposable database. Compare canonical/private authored hashes, schema, source triggers and existing-route behavior. Run the native hosted D1 rehearsal in the isolated qualification environment when authorized.
5. Capture the host-supported backup/checkpoint identity and restore verification **before mutation**. An unverified command, local dump or assumed Cloudflare account access is insufficient. Do not begin live schema changes without a supported backup/forward-repair plan and named operator.

## Partial failure and rollback

Keep creation and indexing admission disabled while installing or recovering schema. First inspect the authoritative applied ledger and current CREATE definitions after failure. If definitions match a committed prefix of this exact manifest, use the host's supported retry/forward-repair mechanism to apply missing operations and reconcile its ledger. Do not hand-edit ledger rows, replay unrelated migrations, or call runtime schema repair a successful hosted migration. If any existing object conflicts, stop that recovery path and review a new explicit forward repair.

UI rollback disables authoritative D1 enrollment before environment inference admission. Keep cleanup-capable Worker code, metadata and R2 binding until outstanding staged/retired/orphan objects and private derived bodies have physical deletion receipts. Do not restore a pre-index Worker that loses cleanup, drop index metadata early, or delete the qualification Site before late-write reconciliation finishes. The actual hosting owner must supply the supported snapshot/restore/cancel operations; none were available in the inspected tool surface.

A schema-enabled qualification archive requires its own reviewed target journal. Inspect the actual tar, all included SQL hashes, journal and Worker bytes. The existing safe disabled packager continues to emit the held 41 entries; the generic Sites packager must not silently replace that with every source candidate. No schema-enabled archive is approved or produced by this manifest generator.
