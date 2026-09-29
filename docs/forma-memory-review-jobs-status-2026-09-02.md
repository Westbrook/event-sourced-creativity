# Forma memory: durable review jobs

**Status:** Implemented and verified locally on `codex/forma-memory-foundation`, after persistence commit `c56f870`. **No UI edits, live ingestion, assistant-context change, active migration or deployment.** This completes another backend slice of the [memory plan](forma-scope-aware-memory-plan-2026-09-02.md), not the full personal-profile or semantic-recall product.

## What changed

| Area | Implemented | Boundary |
|---|---|---|
| Durable admission | Actor/custodian/document/recipe-qualified schedules and exact saved review plans; one active job and one local-night admission slot. New work requires eligible human activity during 01:00–05:00 in the registered IANA zone, with a minimum 20-hour separation. Invalid zones resolve to UTC. | A trusted backend registers scopes. Registration does not create consent. No real user has been enrolled and no UI setting was added. |
| Recovery and concurrency | Opaque, attempt-fenced leases; bounded renewal; persisted attempt limits; bounded exponential retry; expired-lease reclaim; metadata-only completion reconciliation. Pausing cancels active leases; a later night may resume a schedule-cancelled unchanged plan without resetting attempts. | Default lease/retry: 60 seconds; default maximum attempts: three, capped at five. Failed plans do not silently receive a new attempt budget. |
| Exact source range | Both source and store captures accept a server-owned saved cutoff, cloned before awaits. Retries revalidate current authority and content but never absorb later appended events into an old plan. | Canonical owner-stream sequences remain mandatory. Missing, extra, fractional, future or rewound cutoffs fail closed. |
| Atomic completion | Private bodies, dependencies, observations, coverage, index intents, review receipt, watermarks and job completion commit together. Database-time lease expiry is checked through the final generation compare-and-swap. | A worker that loses its lease cannot publish. Lease renewal does not change memory generations or stale its own evidence. |
| Recurrent derivation | Delta episodes, descriptive workflow snapshots and rolling extractive conversation segments have content-addressed IDs. Existing snapshots are not rewritten merely because another night passed. Summaries leave the newest two messages as a raw tail and obey both the 16-message and 8,192-byte segment bounds. | Provider-free baseline, not semantic summarization, vector clustering, inferred preferences or accepted-decision extraction. Coverage still reports omissions when recall budgets cannot fit the history. |
| Independent cleanup | Every due registered scope is swept before any review work. Pausing learning retains cleanup discovery. Metadata-only erasure remains committed when a pending source defers deeper checks. A receipt/schedule race in one scope cannot stop later scopes' cleanup. | Needs an actual invocation. Default maintenance interval: one hour; deferred phases use the retry interval. No unattended hosted timer is installed. |
| Run receipts | Actual manual or synthetic-scheduled invocations record status and safe aggregate counts. Completion is confirmed transactionally; interrupted runs are not fabricated as successful. | Keeps the newest 128 terminal receipts; interrupted running receipts remain identifiable. Abandoned-run reconciliation and production-scale history retention are later work. |

The [job runner](../worker/memory-review-jobs.ts) has no HTTP entry point or live caller. Its [derivation recipe](../worker/memory-review-recipe.ts) uses the existing source/store authority and privacy boundaries. New [SQL migration 0002](../db/memory-shadow/0002_review_jobs.sql) is isolated from the application migration journal and has its own synthetic-only schema marker. Original migration 0001 is unchanged. Neither adapter nor runner implicitly migrates a database.

## Verified behavior

**189 tests passed, none failed or skipped:** the previous 150 plus 36 job tests and three saved-cutoff regressions. Full TypeScript checking, scoped ESLint and the complete local build passed. The build retains existing large-chunk and mixed static/dynamic-import warnings in unchanged application code.

The tests include genuine process exits after admission, claim and commit-before-acknowledgement; competing admissions/claims; stale workers; publication rollback at job completion, watermark and final generation writes; database-clock expiry at four transaction stages; daylight-saving repetition; schedule pause/resume; source/authority withdrawal; forgetting during derivation; actor/custodian isolation; and Unicode-heavy conversation recurrence. The active-job lookup was checked with SQLite `EXPLAIN QUERY PLAN` and uses its partial unique index.

Publication reserves a shared **256-record ceiling** for up to 128 episode candidates, 42 independent workflow groups and 32 conversation segments; the 1,024-row partition bounds still apply. A regression exercises all 128 supported independent edits plus their workflow record without silently dropping derived artifacts or consuming futile retries.

The [repeatable evaluator](../scripts/evaluate-memory-review-jobs.mjs) uses its own temporary SQLite file and a separate process with an empty environment. It accepts no database paths, live-data or provider options. Its [checked report](forma-memory-review-jobs-evaluation-2026-09-02.json) demonstrates:

- A job admitted through event 9 is claimed, recovered after lease expiry during daytime, and completed in a process that exits before acknowledging the commit. Eight memory records survive reopening; the later event is not folded into the old watermark.
- The next night processes through event 12, producing 12 total records and eight persisted interaction observations while leaving earlier snapshots unchanged. The unchanged following night produces no review.
- Four summarized messages plus two recent messages give continuous coverage for the fixture. Consumption represents four block-edit outcomes and four document encounter/request outcomes.
- Pausing reviews and disabling enrollment still allows daytime cleanup to erase all 12 current private bodies and pending upsert intents without reading private source prose.
- Three actual test invocations have truthful receipts. **Zero remote database calls, provider calls or UI changes.**

These are local SQLite/D1-compatible harness results, not a deployed D1 transaction, semantic-quality or no-traffic scheduler test. The [verification receipt](forma-memory-review-jobs-verification-2026-09-02.json) records commands, source hashes and release boundaries. Earlier foundation/persistence receipts remain historical evidence for their commits.

## Release coordination and exact integration scope

The user authorized backend commits and publication to already-authorized users. The **Assemble Forma specialist team** task confirmed an active release/evidence freeze while its native keyboard/zoom acceptance work remains open. Its reported publisher baseline is `be824decbb60450db3a17b250f49cdd8d880b975`, production **version 173**, deployed `2026-09-02T10:23:51.069295Z`. Read-only Site metadata independently matched that version. Site access was not changed.

This branch's application base is older: `8d4431c05ee63afa948ed27d8a5734ebeb8bf1d3`. **Do not deploy or merge the branch wholesale over the specialist baseline.** Six relevant shared files changed between those application baselines: `db/schema.ts`, `worker/events-api.ts`, `worker/index.ts`, `worker/pilot-policy.ts`, `worker/project-access.ts`, and `worker/runtime.ts`. None is modified by this slice. The imported event model, privacy split helper and SQLite test harness are unchanged between those baselines. Compilation was checked here, not falsely claimed against the specialist's uncommitted checkout.

| Third-slice files | Purpose |
|---|---|
| `worker/memory-review-jobs.ts`, `worker/memory-review-recipe.ts`, `db/memory-shadow/0002_review_jobs.sql` | New disconnected orchestration and synthetic job schema. |
| `worker/memory-source-adapter.ts`, `worker/memory-store.ts`, `worker/memory-sql.ts` | Saved-cutoff capture, trusted transaction coordination, cloned body-free derivation metadata and canonical serialization. |
| `src/model/memory-conversation.ts` | Export the existing extractive renderer's byte count for safe chunking; no rendering/UI change. |
| `tests/helpers/memory-persistence.mjs`, `tests/memory-source-adapter.test.mjs`, `tests/memory-review-jobs.test.mjs` | Explicit isolated job installer and recovery/privacy regressions. |
| `scripts/evaluate-memory-review-jobs.mjs` and memory documents/reports | Reproducible synthetic evidence and handoff. |

No changes were made to the specialist checkout, main-worktree user changes, active application schema/journal, authentication, privacy endpoints, event ingestion, scheduled entry point, package/dependency/hosting configuration, browser components, styles or live assistant context. No remote push or deployment was made. A coordinated narrow integration of the isolated memory commits can be evaluated after the release freeze; the existing publisher should own shared schema/runtime changes and deployment.

## Next backend gates

1. **Agree on the accepted specialist baseline.** Integrate and rerun checks there after the freeze; keep real processing off during this source-only step.
2. **Prove live authority and explicit memory enrollment.** Start with one selected organization/project/document and actor-private memory. Bind the real authenticated principal, current project-resource access and new learn/recall enrollment receipts. Existing application consent/cohort access is not memory consent. Native permission fingerprints need a lossless versioned mapping to memory fences, not truncation or timestamp substitution. Do not reuse saved HTTP principals for background work.
3. **Integrate deletion, migration and scale before retaining real data.** Wire native privacy/organization deletion into memory cleanup; prove backup/restore and eventual index erasure. Expand the current fail-closed limits—32 registered scopes, eight owner streams, 512 scanned rows, 128 eligible sources, and 1,024 source/observation/record metadata rows per actor/custodian partition. Prove deployment-database transaction/query limits and pagination. Current synthetic mode must never be relabeled as a real-user rollout.
4. **Configure and witness scheduling.** Use a supported authenticated background trigger and observe an invocation without site traffic. Explicit fixture calls are not proof of hosted nightly delivery. Then evaluate semantic profiles/embeddings, cost budgets and scoped recall quality before changing any serving path. The recorded Postgres/pgvector direction is unchanged.

Suggestions, autocomplete and new UI controls remain later, separately enabled work.

## Reproduce locally

Use the existing Node 24 dependency setup in this worktree; do not run dependency installation or pnpm reconciliation against its reused dependency symlink.

```sh
node --experimental-strip-types scripts/evaluate-memory-review-jobs.mjs
node --experimental-strip-types --test tests/scoped-memory.test.mjs tests/memory-observations.test.mjs tests/memory-conversation.test.mjs tests/memory-shadow.test.mjs tests/memory-source-adapter.test.mjs tests/memory-persistence.test.mjs tests/memory-review-jobs.test.mjs tests/conversation-context.test.mjs tests/taste.test.mjs tests/attention.test.mjs tests/brief.test.mjs tests/indexing.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js worker/memory-sql.ts worker/memory-source-adapter.ts worker/memory-store.ts worker/memory-review-jobs.ts worker/memory-review-recipe.ts src/model/memory-conversation.ts tests/helpers/memory-persistence.mjs tests/memory-review-jobs.test.mjs tests/memory-source-adapter.test.mjs scripts/evaluate-memory-review-jobs.mjs
node --run build
```
