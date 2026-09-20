# Memory reconciliation with main — 2026-09-20

The Memory feature branch incorporates local `main` at
`80ed2618ac57fee8f77aef316dacd478308ac72f`. This is source integration, not a
production deployment or completion of the remaining Memory plan.

## Migration history

Main added `0043_still_panel_relay` at journal index 39 while the unpublished
Memory continuation also started at index 39. The merged journal preserves main's
entries 0–39 and its exact snapshot 0039. Memory's 18 entries now follow at indexes
40–57, with recomposed snapshot ancestry that includes both Still relay tables.

**All SQL files and their bytes are unchanged.** Both original `0043_*` filenames
remain; journal order, not numeric filename prefix, governs the installed Drizzle
loader. The first unpublished Memory entry's timestamp moved from 1789756133235 to
1789761110512, immediately after the upstream timestamp 1789761110511. Otherwise a
real timestamp-based upgrade from main would skip Memory purpose grants. Later
Memory timestamps remain unchanged. This is not an invented hosted receipt.

Historical Memory notes referring to snapshot 0039–0056 describe the pre-merge
branch. Their corresponding current snapshots are 0040–0057; SQL filenames and
native schema profiles are unchanged. Do not repair or rewrite a live receipt
ledger from these source files. A database that previously applied this private
branch needs its actual history reviewed before an upgrade; no live DB was opened
or changed by this reconciliation.

## Verification

92 existing/extended migration checks pass, including an upgrade from a populated
Still prefix through the **installed Drizzle SQLite migrator**, preservation of
relay rows and existing receipts, fresh replay, repeat application, schema/ORM
agreement, complete snapshot ancestry and foreign-key checks. This remains local
SQLite evidence, not qualification of a hosted migration executor.

Both Worker route sets and scheduled code hooks are retained. Main's dependency
lockfile is preserved; local dependencies are installed with lifecycle scripts
disabled for verification. The merged tree passes 94 native Memory checks,
1,160 focused Memory/Still/serializer unit checks, 12 synthetic English/Arabic
browser checks, TypeScript, changed-file ESLint and the production build (existing
large-chunk warnings remain). Serializer fixtures now use actual new dependencies;
Still fixtures exercise both certified cache reuse and unqualified fresh rebuilding.
No production behavior was weakened to accommodate these fixtures.

The [full remaining implementation](forma-memory-native-continuation-2026-09-18.md#remaining-native-implementation--still-in-scope)
and [external/operational checklist](forma-memory-sites-capability-todo-2026-09-18.md#capabilities-not-available-directly-through-the-inspected-sites-tools)
remain open. No enrollment, service provisioning, remote push or deployment is
implied by this merge.

The broader follow-up also found and fixed independent maintenance ordering:
Still/general-retention failure no longer skips Memory privacy/accounting work.
[Native consumer and scheduled integration](forma-memory-native-consumer-source-2026-09-20.md)
records the regression and its focused scheduled-entry checks.

The synthetic D1 snapshot helper now preserves native AUTOINCREMENT sequence
state, including deleted high-water marks introduced by the actual Still schema.
This is local test infrastructure only, not a live database migration/repair.
