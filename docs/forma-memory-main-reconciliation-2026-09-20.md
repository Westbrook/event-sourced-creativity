# Memory reconciliation with main — 2026-09-20

The Memory feature branch incorporates local `main` at
`58b0d153`. The earlier reconciliation below incorporated `80ed2618`. This is source integration, not a
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

## Subsequent Still history integration

The semantic-consumer checkpoint `f642ac62` is reconciled with local main
`58b0d153`, including the upstream Still history cache and next-best toolbar work.
Main's journal prefix 0–40 and snapshot 0040 remain exact. The 19 unpublished
Memory migrations follow at indexes 41–59; their snapshots include the Still
history table and have recomposed ancestry. The first 18 Memory timestamps now
follow main's `1789928794240` monotonically (`1789928794241`–`1789928794258`);
the last consumer migration already had a later timestamp. All SQL files remain
byte-unchanged. No live receipt ledger or database was modified.

Verification on the combined tree: 149 migration/Still tests and 38 native
semantic-consumer/D1/source tests pass, as do TypeScript and the production build.
The installed migrator upgrades a populated main prefix while preserving both
Still relay/history rows and original receipts. Tests distinguish the full
creative-question bank from the intentionally reduced toolbar questions and use
the actual Still session endpoint; production policy was not weakened.

This remains feature-branch source integration, not a push to main or production.
