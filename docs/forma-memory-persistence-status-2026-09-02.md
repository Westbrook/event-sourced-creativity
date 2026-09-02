# Forma memory: isolated persistence slice

**Historical slice:** This report and its verification/evaluation receipts describe commit `c56f870`. See the [third-slice status](forma-memory-review-jobs-status-2026-09-02.md) for the subsequently implemented durable review jobs. The original receipts are retained unchanged, not relabeled as evidence for newer source files.

**Status:** Implemented and verified locally on `codex/forma-memory-foundation`, following foundation commit `6570a78`. **Still off: no live collection, assistant integration, UI change, shared migration or deployment.** This is the next backend slice of the [scope-aware memory plan](forma-scope-aware-memory-plan-2026-09-02.md), not the completed memory product.

## What now works

| Area | Implemented | Boundary |
|---|---|---|
| Durable storage | Actor/custodian-qualified metadata, separately erasable private bodies, canonical source receipts, flattened dependencies, normalized observations, conversation coverage, suppression tombstones, per-scope/recipe/stream watermarks and committed review receipts. | [Isolated SQL migration](../db/memory-shadow/0001_shadow_memory.sql) is outside the active migration journal. Only the explicit test installer initializes it. |
| Source reading | A bounded, read-only [source adapter](../worker/memory-source-adapter.ts) reads canonical owner-stream events, not presentation-local project cursors. It binds private envelopes, final conversation content, source versions, custody, retention and provenance to current server-owned guards. | The authority interface is in-process trusted server code. **Only a synthetic resolver exists.** No HTTP endpoint accepts client receipts as authority, and no live request imports the adapter. |
| Atomic publication | The [store](../worker/memory-store.ts) commits bodies, dependencies, observations, coverage, index intents, review receipt and captured cutoffs together. Exact retries and concurrent identical reviews reconcile without duplicate records. | Durable receipts prove completed reviews; durable pre-work admission, leases and scheduling are not implemented. |
| Conversation and consumption | Extractive summary coverage and event-derived document/block consumption survive a process restart. Stored data is revalidated against canonical sources before recall. | No semantic model, new browser tracking or inference that page activity means comprehension. Legacy conversation paths without authoritative finalized-turn receipts fail closed. |
| Forgetting and retention | Forgetting removes dependent current bodies/coverage, retains body-free suppression and blocks known copied lineage. Expiry, policy changes, source redaction, moved scopes and attention withdrawal invalidate derivatives. | This erases current memory rows, not original Forma chats/events or historical database backups. There is no external index consumer yet. |

The only modification to an earlier implementation module is the observation normalizer's explicit learning-versus-recall purpose and exported event-action lookup. Shared assistant, event, access, privacy, runtime, UI, package and hosting files are unchanged.

## Important boundaries

**Learning and recall are independent.** Publication requires a learning-authorized capture; reads require recall authorization. Pausing learning does not erase otherwise authorized recall. Learn-only consolidation may remain stored, but cannot be served. Maintenance retains data only while at least one supported purpose remains authorized and all relevant retention/dependency rules hold; when necessary it checks both purpose-specific source snapshots.

**Time is checked inside the publication transaction.** Enrollment, relevant grants, source expiry/age, observation expiry and record expiry bound a database-clock predicate. It is checked before/after writes and on the final generation compare-and-swap. Expiration before that final write rolls back progress and memory together. Expiration after a committed transaction is handled by read-time filtering and cleanup, not reported as an uncommitted operation. Test clocks run inside SQLite; a timestamp captured before an asynchronous database call is not used as transaction time. Deletion is not blocked by an expired publication deadline.

**Cleanup does not wait for new human activity or a finished chat.** `maintain()` first applies known negative policy, expiry, attention opt-out/cutoff and suppression facts using metadata only. It then revalidates source-dependent state. If a pending/inconsistent source prevents that second phase, the result explicitly reports `sourceReview: "deferred"`; completed erasures remain committed. A caller must retry deferred source review. No background runner is installed by this slice.

**Every stored conversation summary requires a validated coverage segment.** Removing the segment cannot bypass extractive-body/source checks. Final specialist content must have its own event receipt and verified commit; an overwritten interim answer cannot acquire the final answer's text under its older source identity.

**Stored source mirrors never grant access.** Reads rehydrate current authority and source evidence, qualify body selection by actor and custodian, then recheck time after awaited reads. Source/policy SQL guards and partition generations reject stale commits. Metadata can independently prove that something must be removed; it cannot prove current permission to show private content.

## Checked results

The [repeatable persistence evaluator](../scripts/evaluate-memory-persistence.mjs) accepts no paths, live-input or provider options. It creates its own temporary SQLite database, runs a credential-free child process, emits only synthetic counts/metadata, and removes the temporary database afterward. Its [checked report](forma-memory-persistence-evaluation-2026-09-02.json) records:

- Nine canonical event rows scanned, including the trailing non-learning event; eight eligible sources and six normalized interactions, **four of them non-chat**.
- Eight restored memory records, unchanged consumption, one committed review and an idempotent replay in a **separate process**. Unchanged history produces no new review.
- Two summarized turns plus two recent turns, with continuous coverage. Scoped lexical recall returns four references while leaving the original context unchanged.
- Forgetting removes four dependent records; suppression survives reopening and excludes a copied descendant. Subsequent opt-out removes the remaining four bodies without reading private source prose.
- Local memory writes exercised; **zero provider calls and zero remote database calls**.

These are fixture results, not production usage or semantic-quality measurements.

### Verification

- **150 tests passed, zero failed/skipped:** 55 new source/persistence tests plus the previous 95 memory/context/taste/attention/brief/indexing tests.
- Fault injection covers migration rollback, partial publication, erasure rollback, lost acknowledgement, concurrent identical reviews, changing permissions/content and expiry at batch entry, during body writes and immediately before the final generation write.
- A separate test actually exits a process after commit but before acknowledgement; reopening and replay preserve one committed review.
- Identical actor/resource/record IDs across custodians and identical record IDs across actors cannot cross-read or cross-forget. Revoked/expired/forgotten attention is swept even while a chat is pending. Learn-only retention and recall-only use are tested independently.
- Full repository TypeScript checking, scoped ESLint and the complete local build passed. The build retains non-blocking chunk-size and mixed static/dynamic import warnings in unchanged application code.
- Source/import audit found no live callers. Main-worktree changes were not touched. The [verification receipt](forma-memory-persistence-verification-2026-09-02.json) records the checked source hashes and limits of the evidence.

This verifies **local SQLite through the repository's D1-compatible transaction harness**, not a deployed Cloudflare D1 database. No browser/visual test was performed: there are no UI edits or activated UI behavior.

## Run locally

From this isolated worktree with its existing Node 24 dependencies:

```sh
node --experimental-strip-types scripts/evaluate-memory-persistence.mjs
node --experimental-strip-types --test tests/scoped-memory.test.mjs tests/memory-observations.test.mjs tests/memory-conversation.test.mjs tests/memory-shadow.test.mjs tests/memory-source-adapter.test.mjs tests/memory-persistence.test.mjs tests/conversation-context.test.mjs tests/taste.test.mjs tests/attention.test.mjs tests/brief.test.mjs tests/indexing.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node --run build
```

Do not install dependencies or run pnpm reconciliation against the reused dependency symlink. No provider credentials or live database are needed for these checks.

## Deliberate limits and next gates

The adapter currently supports a document with descendant scopes, up to eight canonical owner streams, 512 scanned rows total and 128 eligible sources. The store refuses to exceed 1,024 lifetime source/observation/record metadata rows per actor/custodian partition. These are **small fail-closed evaluation bounds**, not a scalable history service. Conversation finalization supports at most one specialist task per turn. Pending, unverifiable or unsupported histories are not silently declared complete.

The index outbox contains IDs, versions, operation and generation only; it does not contain summary prose or send anything to a vector service. There is no encryption/key-management implementation, backup-restore protocol, external index deletion acknowledgement or physical erasure guarantee. Source tombstones and dependency metadata remain so replay cannot resurrect forgotten lineage. A future restore must preserve privacy generations/suppression state before serving or reindexing.

1. **Coordinate a specialist-team checkpoint before shared integration.** The **Assemble Forma specialist team** task has a separate source/evidence baseline. Do not merge, migrate or deploy over its active work. This worktree remains `/Users/westbrook/.codex/visualizations/2026/09/02/01a061f1-72f8-7d73-b47f-d7cd7f2d171e/forma-memory-foundation`; separate worktrees do not isolate the shared hosted Site or provider budget.
2. Implement the real server-owned authority/lineage resolver and migration/retention integration on the accepted baseline. Prove source pagination, supported conversation finalization, D1 transaction/query limits and backup/restore behavior against an isolated service database. Expand source adapters beyond documents without weakening scope/custody rules.
3. Add durable changed-scope job admission, leases, retries, nightly throttling and explicit enrollment/cost budgets. Schedule privacy maintenance independently of user activity, including retries of deferred source review.
4. Establish semantic-summary/recall gold fixtures and fix the previously identified structured-fact extraction issue in the old taste path before inferred-profile comparisons. Select/evaluate embeddings and index storage without silently changing the recorded Postgres/pgvector direction.
5. Only then enable an enrolled, disabled-by-default live shadow pilot. Keep existing context and response shapes unchanged; measure quality, latency, cost, isolation and deletion before using memory in assistant responses. Autocomplete, new controls and shared-profile publication remain later releases.

The [first-slice status and receipt](forma-memory-foundation-status-2026-09-02.md) remain historical evidence for `6570a78`; their earlier “no persistence” statements are not the current status of this second slice.
