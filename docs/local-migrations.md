# Repeatable local migrations

The local migration runner makes execution of the existing `drizzle/` journal
safe to repeat on a compatible local SQLite database. Historical SQL files,
snapshots, filenames, hashes, and journal timestamps are preserved.

## Run

Use the repository's supported Node version (22.13 or newer). Choose the local
SQLite file explicitly. If a development server uses that file, stop it before
the migration so it cannot race schema changes or cache an older schema.

```sh
# Preview the migration; all attempted changes are rolled back.
pnpm db:migrate:local --database ./local.sqlite

# Apply to that local database. This command is safe to repeat.
pnpm db:migrate:local --database ./local.sqlite --apply

# Select another local migration directory when needed.
pnpm db:migrate:local --database ./local.sqlite --migrations ./drizzle --apply
```

A preview of a missing database uses memory and does not create the requested
file. A preview of an existing database executes within a transaction and rolls
back; it can temporarily take a SQLite write lock. `--apply` creates a missing
database file. Output is a JSON report of migration dispositions and statement
counts, without application records.

## Replay and verification

SQLite supports `CREATE … IF NOT EXISTS`, but does not support
`ALTER TABLE … ADD COLUMN IF NOT EXISTS`. In particular, assistant migration
`0021_assistant_specialist_consent` adds `result_json` and `request_json` and
creates a partial unique index. Its raw SQL still requires one-time execution.

The runner examines the database before each supported operation. It creates
missing objects and adds missing columns. It skips existing objects only after
checking their expected structure. Later journaled column additions are taken
into account when checking an earlier table declaration. Column types,
nullability, defaults, keys, checks, foreign keys, indexes, and triggers are
validated conservatively. Unexpected definitions fail rather than being
silently accepted because an object has the right name.

For example, existing nullable `TEXT` consent columns can be retained with their
values and rowids. An existing `BLOB` column under the same name is rejected. The
consent index must have the expected uniqueness, column order, and predicate;
duplicate existing data that prevents its creation causes a failure.

The supported migration shapes are additive `CREATE TABLE`, `CREATE INDEX`,
`CREATE TRIGGER`, `ALTER TABLE … ADD COLUMN`, and `PRAGMA optimize`. Optimization
pragmas are skipped as advisory maintenance rather than schema changes. The SQL is
parsed and rehearsed in memory first. Apart from the exact 3D migration described
below, data migrations and destructive SQL require an explicit implementation
and tests; their errors are not swallowed.
Statements follow Drizzle's statement breakpoints, so trigger bodies are kept
intact.

### Reviewed 3D schema upgrade

The runner has a dedicated handler for `0022_output_model3d`, with journal
timestamp `1788192000000` and exact SQL SHA-256
`393bf222f1aa1210d679af3d588ffdf0e989cc6b9bd4db02eeef78cfb9907206`.
A renamed copy, changed SQL, changed
timestamp, or a different destructive migration is rejected.

This handler adds `model3d` to two Output media-kind checks and raises the
storage-write size limit from 24,000,000 to 67,108,864 bytes. It recognizes a
coherent legacy schema or a fully upgraded schema. Mixed states, an old schema
behind an upgrade receipt, and leftover staging objects are rejected. A fully
upgraded database without a local receipt is verified without replaying the
rebuild. New receipts record all 33 statements as executed or all 33 as skipped.

The earlier unpublished 19-statement source had SHA-256
`e857a9750002d068c76651768835d5cc4b93ec484a657fc0bc58fe52e69dd291`.
An existing local receipt for that exact hash, timestamp and complete 19-statement
disposition is accepted only when the current guarded schema passes validation.
The runner reports `verified-legacy-source` with both hashes and preserves the
original receipt's date, rowid, hash and counts. This is verification of the
existing schema, not a claim that the new SQL was applied. Mixed counts, an old
schema behind a receipt, or any other source identity fail unchanged.

The raw migration and Worker bootstrap share the same generated SQL. Both the
upgrade and already-current paths use a fresh, main-qualified NOT NULL proof
table, exact known declarations and indexes, a complete inbound foreign-key
catalog and full foreign-key checks. Unexpected columns, triggers, dependencies,
TEMP objects or reserved staging names require review before the rebuild. Each
copy compares rowids, SQLite value types and values in both directions before
the original table is dropped. Run the whole array in one transaction; local
SQLite qualification alone does not establish the hosted executor's atomicity.

The same statement array is exercised against the pinned local workerd D1
binding. Fixed catalog rows use `VALUES` to stay within D1's five-term compound
SELECT limit. Foreign-key inspection visits every table declaration containing
the mandatory `REFERENCES` keyword, without excluding any table-name prefix.
This avoids inspecting protected engine tables that cannot declare an inbound
key. D1's authorizer prohibits `writable_schema` reads and writes; the local
SQLite runner separately requires that flag to be off.

The rebuild stays inside the same transaction as all other migrations and
receipt writes. Foreign keys and CHECK constraints must remain enabled; schema
writing, legacy rename behavior, and pre-existing deferral must be off. Before
any DROP, the runner checks table contracts, attached objects, every inbound
foreign key, and the reserved assertion token. Unknown dependencies and foreign
key delete actions are rejected. It verifies original rowids and typed values
in each temporary copy before dropping its source, verifies the retained Output
graph afterward, and checks all foreign keys before clearing deferral.

Later unrelated additive migrations retain the usual behavior. Later changes
to these tables, their guarded dependencies, or their attached objects need a
separately reviewed handler. Unknown triggers and indexes are never discarded
as part of an otherwise successful upgrade.

Generated columns, double-quoted defaults, `ON CONFLICT`, and foreign-key
`DEFERRABLE`/`INITIALLY` schema clauses are outside the supported comparison
rules and are rejected, including explicit immediate or NOT DEFERRABLE forms.
The foreign-key metadata does not bind deferral timing to individual keys.
Recognition is deliberately conservative: unquoted deferral keywords in the
table-definition scan are unsupported even when used as bare identifiers; quote
those names instead. Quoted identifiers, literal values and comments are not
deferral clauses. Existing
connections containing temporary schema objects are also rejected, so temporary
triggers cannot interfere with migration receipt writes. The CLI opens a fresh
connection.

## History

Migrations follow the journal's order, not filename sorting or a highest-applied
timestamp. Each migration is tracked by its tag and exact SQL hash in the
separate `__forma_local_migrations` table:

- `applied`: the runner executed missing schema operations.
- `verified-existing`: every required effect was already present and verified.
- `already-applied` in the report: an existing local receipt matched and the
  schema was checked again.

These are local execution and verification receipts. They do not assert that
the original SQL previously ran. Existing Drizzle or Sites migration history is
left unchanged. A changed hash for a locally recorded tag is rejected. Missing
or incompatible schema behind an existing local receipt is also rejected.

This handles a merged journal where a newer migration is recorded elsewhere
while an earlier schema addition is still missing: all journal entries are
examined instead of filtering by the newest recorded timestamp.

## Failure and retry

Inspection, changes, final verification, and new receipts run in one
`BEGIN IMMEDIATE` transaction. Any error rolls back that entire attempt. Existing
rows, rowids, and previously committed receipts remain intact. A previously
missing file created by `--apply` can remain as an empty database after failure.

Correct the reported incompatibility or data issue, then run the same command
again. Outside the exact reviewed 3D upgrade, the runner does not rebuild tables.
It never deletes duplicate records, treats arbitrary errors as success, or
manufactures successful receipts after a failed run.

## Sites deployment

### Memory cap seed exception

Migration0045 has one exact hash- and timestamp-pinned data statement: it seeds
the minimum accepted Memory cap for each original payer/consent month, including
revoked grants. This runs in the same transaction as schema and receipt creation.
Existing cap installations are verified, never reseeded: missing or weakened
floors fail with `migration_finance_backfill_unverified`. Smaller retained caps
and caps whose private grants have been erased remain untouched. Dry runs roll
back the cap seed too. Other data-changing SQL is still unsupported.

This is local migration qualification only, not a hosted execution certificate.

### Hosted execution

This command operates on a local SQLite file. It neither connects to production
nor changes how Sites deploys migrations. The Sites build still packages the
original migration SQL. Replaying the raw `0021` SQL through a different runner
can still raise a duplicate-column error.

Sites would need equivalent schema checks or reliable applied-migration tracking
to provide the same replay behavior. Local tests do not establish Sites'
transaction boundaries, migration ordering, or production schema state.

## Verification

```sh
node --test tests/local-migrations.test.mjs
```

Coverage includes the actual migration journal, repeated runs, legacy and
partially upgraded assistant tables, existing values and rowids, append-only
triggers, incompatible definitions, duplicate-data failures, rollback, history
gaps, hash changes, and the CLI's preview and apply modes.
