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
parsed and rehearsed in memory first. Unsupported data migrations or destructive
SQL require an explicit implementation and tests; their errors are not swallowed.
Statements follow Drizzle's statement breakpoints, so trigger bodies are kept
intact.

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
again. The runner does not rebuild tables, delete duplicate records, catch every
error as success, or manufacture successful receipts after a failed run.

## Sites deployment

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
