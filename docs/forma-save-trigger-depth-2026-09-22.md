# Save failures: trigger depth investigation

Bounded save recovery and qualification record. Live deployment and database
outcomes are maintained in the project's shared Progress Report. The original
investigation below is retained, followed by the repair and validation record.

## Observed failure

On September 22, production502 logs show POST `/api/events` returning500 at
14:59:54,15:00:40,15:01:13 and15:44:11 UTC. New-project page requests are among
these failures. `/api/document-jobs` and `/api/document-jobs/still-reconcile`
report `D1_ERROR: triggers nested too deep: SQLITE_ERROR`. Their stacks identify
`appendEvents` → `appendAuditEvent`, including failed-budget reconciliation.
This is shared event persistence, not just the Project form.

A fresh authenticated, read-only inspection of
`/api/portfolio/engineering/memory-schema-repair` reports the exact installed
manifest `fd1752125f0e8818adc70a7805e74413c00d165adc898ccb2b2ad8ab25bd3ef9`,
361 objects across42 tables, no missing objects, replacements or blockers,
and repair disabled. The inspection includes aggregate emptiness checks, so the
new Memory tables were empty. Installed database triggers still participate in
statement preparation even when Memory application features are disabled.

## Isolation evidence and limits

A disposable Miniflare D1 database was populated from the41-migration baseline,
bootstrapped through production `ensureSchema`, and repaired through the fixed
Memory repair implementation. Synthetic `ProjectCreated` writes persisted both
before and after repair on the current pinned local workerd. External requests
were forbidden. This local success does **not** reproduce the hosted failure.

Exporting only this disposable schema and preparing the same save with Python's
SQLite3.53.3 and controlled `SQLITE_LIMIT_TRIGGER_DEPTH` produced:

| Schema variant | Minimum passing trigger-depth allowance |
| --- | ---: |
| Full schema with new manifest triggers removed, in memory only | 3 |
| Full repaired schema | 17 |

The full schema reproduces the exact `triggers nested too deep` error at limits
through16 with no user rows. This demonstrates increased trigger compilation
depth, not a proven runtime infinite loop. SQLite also checks trigger depth while
compiling chained trigger programs; see its [trigger implementation](https://chromium.googlesource.com/external/github.com/sqlite/sqlite/+/684763d832b2d986f66bc1ba9e6d2268a09461fa/src/trigger.c).
The active hosted engine version, configured depth ceiling and complete unrelated
trigger catalog were not exposed by the available read-only connector. Therefore
17 is a measured local requirement, **not** a claim about the hosted limit.

The likely regression is the Memory schema installation in production500. It
adds source-invalidation triggers to ordinary event and private-payload tables,
which reach further Memory retirement/consumer/resource triggers. The rollout
verified installation, rollback and read availability, but its recorded checks
did not verify ordinary hosted writes after installation.

## Repair direction

Reduce nested trigger compilation across the source-invalidation graph while
preserving its privacy/integrity guarantees and atomic event/private-payload
writes. Add full-schema save coverage for Projects, Documents, Ideas and audit
streams at the hosted depth constraint. Qualify the exact trigger migration and
then verify hosted writes. Merely disabling the Memory feature flag, retrying
saves, or redeploying an older app does not remove the installed trigger graph.
Do not broadly drop privacy triggers or erase data as a workaround.

Initial investigation conclusion: the failure layer and a strong schema-depth
explanation were established; hosted constraint parity remained unconfirmed. The
subsequent bounded recovery is described below.

## Reproduce locally

From the repository, with loopback permission and current Node/Python:

```sh
node --experimental-strip-types work/db-save-depth/reproduce.mjs
python3 work/db-save-depth/measure-depth.py
```

The retained diagnostic scripts use disposable in-memory databases and export
only synthetic schema to `work/db-save-depth/schema.json`. They do not access
production or call providers.

## Save recovery implementation

The repair is a bounded isolation of the **inactive, empty** new Memory subsystem,
not a redesign or qualification of its active lifecycle graph. Existing Memory
activation remains off. Its40 new Memory tables receive permanent BEFORE INSERT
barriers before the250 exact manifest Memory triggers are disconnected. All user
tables, rows, baseline privacy/append-only triggers, original migration receipts,
and the20 containment/nesting triggers remain unchanged. The two containment
schema tables are not write-blocked.

The fixed principal-administrator endpoint is
`/api/portfolio/engineering/event-save-repair`. GET inspects only schema, empty
table witnesses and EXPLAIN of the normal event-stage save. POST requires a
same-origin form, current dual administrator capabilities, disabled Memory
switches and a proof of the exact catalog. It refuses populated, unknown, partial,
stale, or concurrently changed schemas. It takes no caller SQL or record data.

Before repair it proves rollback with an intentionally failed synthetic metadata
transaction. A single guarded D1 batch installs barriers, drops only the exact
known250 triggers, records a separate receipt, checks the entire expected catalog
and foreign keys, and compiles an ordinary zero-row save before committing. Any
failure rolls back the batch. It then inserts four synthetic Project, Document,
Idea and audit event envelopes plus private bodies in a separate deliberately
failed transaction. It verifies those rows existed before failure and that all
records and the probe table disappeared afterward. No provider is involved.

A completed inspection certifies the barriers and empty Memory tables. Memory
readiness checks reject this intentional isolated schema even if feature flags
are later enabled. The old installer cannot reconnect it because it rejects the
new guards. Restoring Memory requires a separately qualified migration with a
bounded lifecycle graph; reactivation is outside the save recovery scope.

Qualification:13 dedicated tests pass, including actual local workerd D1 atomic
rollback, all40 barriers, original-row preservation, unknown/populated/stale
refusals and late failures.25 Worker/admin tests pass, including read-only GET,
authority checks, activation refusal and synthetic-save rollback.15 original
schema-repair tests remain passing. TypeScript and whitespace checks pass.
Reference SQLite3.53.3 rejects the original full schema at depth3 and persists
the repaired Project event and private payload at the same limit.

Run the durable checks with:

```sh
node --experimental-strip-types --test tests/event-save-repair.test.mjs tests/memory-schema-repair.test.mjs
node --import tsx --test tests/output-schema-preflight.test.mjs
node node_modules/typescript/bin/tsc --noEmit
```

The authenticated maintenance batches also compile under SQLite's expression
depth limit100. The regression test captures the actual administrator authority
and all314 batch statements, including the post-repair save probes. It failed
against the original combined precondition and passes after splitting independent
assertions into separate statements in the same atomic transaction. No authority,
schema, emptiness or rollback check was removed.

The guarded deployment packaging hold remains mandatory: the generic Sites
packager copies the entire historical migration directory and must not be sent
to deployment. Use `scripts/package-disabled-memory-release.mjs` against the
build's verified41-migration artifact. No historical migration was rewritten.

## Release checkpoint

The user explicitly authorized merging main, deploying Production and applying
the guarded repair. Production505 and506 preserved the workspace audience and
environment revision16. Inspection confirmed the original trigger-depth failure.
The first application rolled back because its combined precondition exceeded
hosted D1's expression depth100; an authenticated diagnostic page exposed the
failure. The expression qualification and atomic assertion split above address
that separate hosted constraint. Hosted before/after
compilation and four rolled-back saves remain required before claiming recovery.

## Follow-up: reloaded creation form recovery

The trigger failure could leave a tab-local Still write journal. That journal
stores only a correlation ID, receipt hashes and a request signature, not the
Project name. After reload the draft was empty, but the journal disabled its
field. The Check save button then ran draft validation first and demanded a name
in the disabled field. The same durable marker also caused an unnecessary reload
warning even when no draft text or active submission remained.

Draft fields now remain editable while the earlier save is unconfirmed. Receipt
checking bypasses form validation and never submits the corrected draft or repeats
the old request. If no matching receipt is found, the form offers Save draft with
an explicit duplication warning. There is no Start new draft or unlock step.

Save draft validates the current input before changing recovery metadata, checks
the original request again, and submits the edited draft only if the outcome is
still unknown. If a late matching receipt appears, it reports the confirmation
without a new submission and preserves the corrected draft for review. Offline
checks and workspace changes retain the original journal. A new save uses fresh
creation IDs; it does not mutate or cancel the earlier server request.

Actual in-flight work and changed drafts retain their navigation warning. A
persisted recovery marker alone no longer blocks reload or browsing saved work.
Personal/shared Worker integration tests cover reload, lost/late receipts, no
repeated POST, explicit new submission, offline checks and scope fencing. The
headless browser regression verifies immediate editing, independent Check save,
empty-input validation without retiring the journal, saving the corrected name,
and no new submission after a late confirmation.
