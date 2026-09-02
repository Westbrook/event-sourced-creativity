# Forma memory: first isolated implementation

**Status:** First offline foundation implemented; no live memory collection, serving, scheduling, migration or deployment enabled.

This implements the safe starting portion of the [scope-aware memory plan](forma-scope-aware-memory-plan-2026-09-02.md). It is **not** completion of that plan or a production memory service.

## Isolation from the specialist team

- Branch: `codex/forma-memory-foundation`, based on `main` at `8d4431c`.
- Working directory: `/Users/westbrook/.codex/visualizations/2026/09/02/01a061f1-72f8-7d73-b47f-d7cd7f2d171e/forma-memory-foundation`.
- The active **Assemble Forma specialist team** task uses another worktree and the `codex/forma-durable-production` branch. Its checkout, servers, tests and data were not modified.
- Product changes in this slice are new files only. Existing components, styles, navigation, state store, assistant APIs, event APIs, schema, migrations, package/lock files and hosting configuration are unchanged.
- No live events or private conversations were read for the implementation/evaluator. No database, provider, vector service or hosted Site was contacted. No credentials or `.env` files were copied into the worktree.
- Existing installed dependencies are reused through an ignored `node_modules` symlink. Build output and Wrangler state remain local to this worktree; no development server or browser session was started. Package files were not changed and dependencies were not reinstalled.

**Do not deploy or wire these modules into shared request paths during the specialist team's current review.** Separate source directories do not isolate the shared hosted Site.

## What is implemented

| Module | Implemented behavior | Deliberate boundary |
|---|---|---|
| [Scoped memory contracts](../src/model/scoped-memory.ts) | Custodian-qualified resource identity; bounded acyclic ancestry, including project-in-project; explicit source and target grants; typed historical/inferred records; source hashes/versions; source-bound expiry; policy/access/erasure/ancestry fences; forgetting/suppression; local/project/broad relevance classes. | These consume server-resolved authorization facts. They do not authenticate callers, create real projects, infer grants from nesting, publish shared profiles, or authorize cross-custodian transfer. |
| [Interaction projections](../src/model/memory-observations.ts) | Normalize finalized existing events, including private chat activity and non-chat work; distinguish views, edits, comparisons, commitments, requests and deferrals; retain assisted/copied/synthetic provenance; coalesce outcomes; per-resource-revision consumption; conservative descriptive workflow repetition. | No new browser capture. No raw prose, URLs, keystrokes or pointer paths in observations. Repetition is not inferred aesthetic preference, comprehension or calibrated intent. |
| [Conversation continuity](../src/model/memory-conversation.ts) | Source-grounded extractive segments; exact finalized-turn prefix plus uncovered recent tail; explicit omitted coverage; source-hash and body verification; pending/superseded exclusion; asynchronous mutation/revocation guards. | Deterministic extractive baseline, not a semantic model summary. Assistant proposals are not promoted to accepted decisions. The first contract rejects mixed raw conversation streams rather than inventing a global sequence. |
| [Shadow context and review contracts](../worker/memory-shadow.ts) | Default-off, synthetic-only shadow preview; original context returned unchanged; lexical recall after eligibility filtering; whole-envelope UTF-8 budget checks; local-first ranking; broad evidence capped at 10% of the optional byte allowance; per-stream review inventories, stable job identity and modeled publication guards. | No serving mode or environment flag can activate production. No database, queue, lease, scheduler, provider, embeddings or persistence are implemented here. |
| [Offline evaluator](../scripts/evaluate-memory-shadow.mjs) | Runs a bundled synthetic end-to-end scenario: actions/private chat → observations → consumption/workflow records → extractive summary → scoped shadow recall → forgetting and repeat-review checks. | Accepts no live-input or provider options; network fetches throw. Outputs a local evaluation report, not real account memory. |

### Privacy and evidence details

Source and destination scopes need explicit current grants for the requested purpose. Reading does not imply learning consent. Mixed shared/private evidence stays private to the actor, and all cross-custodian reuse is denied in this initial slice.

The source adapter must resolve canonical source identity, resource revision, actor ownership, authenticated conversation speaker, origin and lineage, then use the normalized observation's `evidenceSource` for derived records. Speaker and content origin are different: a user can submit assisted text, but an assistant message cannot be relabeled as a user statement. A legacy `actor: "user"` field or a client-supplied target is not proof. User acceptance of an assistant suggestion counts as human activity but not independent preference support. Unknown lineage cannot increase independent support.

Every source dependency must remain available, current, authorized and within its retention window. A proposed 90-day policy cannot extend an existing 30-day source. Rewriting a record does not renew expiry or last independent evidence. Held-only, redacted, erased and revoked sources are ineligible.

Forgetting returns a body-free tombstone and a suppression contract. Claim suppression applies at its scoped use/source boundary; known forgotten source lineage is conservatively excluded across that actor's custodian, including copied descendants and broader summaries. Explicit suppression revocation is distinct from new evidence. **The future storage adapter must persist these atomically; no real account deletion is claimed here.**

Attention remains separately authorized and off without a valid grant. It is capped by the existing 14-day use window and rechecked against current per-stream forgetting cutoffs. `coVisiblePageActiveMs` describes page activity while a resource was visible, not time spent reading that resource; it must not be summed across resources as consumption time.

### Review and context boundaries

New synthetic review admission requires qualifying human activity and a complete, frozen interval from the future authoritative source adapter. The contract cannot prove that an adapter fetched a complete ledger: live pagination/snapshot completeness must be tested at integration. Missing or mismatched inventory is rejected.

The initial quiet-window contract uses 01:00–05:00 in the supplied IANA time zone, with an explicit UTC fallback for invalid zones. Job identity includes actor, custodian, scope, recipe, epochs, per-stream cursors and exact source receipts—not the calendar date. An admitted retry can resume outside that window. The same unchanged history creates no new review. Actual scheduling, one-review-per-night throttling, jitter, durable leases, cost reservations and maintenance remain future work.

`publishMemoryReview` is a **pure publication-guard simulation**, not a database commit. It rechecks live inputs after asynchronous hashing, rejects source dependencies outside the frozen snapshot, and returns only the captured cutoff. The future adapter must atomically persist memory/dependencies, index outbox and watermark under the same fences. Privacy maintenance must run independently of the human-activity/night-window gate.

`assembleMemoryShadow` always returns the existing context as `context`. Its separate `preview` is synthetic evaluation output only. Mandatory instructions, capabilities and current context are never truncated to fit memory. The full serialized preview, including JSON escaping, stays within the existing 16,384-byte ceiling. Private record/source IDs remain outside the provider-shaped preview in a separate local references map.

## Run locally

From this worktree, with the existing Node 24 runtime. Use Node's script runner to avoid pnpm's automatic dependency reconciliation on the reused dependency symlink; no install or dependency purge is needed:

```sh
node --experimental-strip-types scripts/evaluate-memory-shadow.mjs
node --experimental-strip-types --test tests/scoped-memory.test.mjs tests/memory-observations.test.mjs tests/memory-conversation.test.mjs tests/memory-shadow.test.mjs tests/conversation-context.test.mjs tests/taste.test.mjs tests/attention.test.mjs tests/brief.test.mjs tests/indexing.test.mjs
node --run typecheck
node --run build
```

The [checked synthetic report](forma-memory-shadow-evaluation-2026-09-02.json) records 10 qualifying interactions (8 non-chat, 2 private-chat), three independent edit episodes, exact two-turn-summary/two-turn-recent coverage, no new review on replay, unchanged current context, and exclusion of forgotten lineage. These are fixture results, not observed production metrics or semantic-quality measurements.

## Verification

- Focused suite: 95 passing tests (54 new, 41 existing) across the new contracts and existing conversation-context, taste, attention, brief and indexing suites; no skipped tests. The end-to-end evaluator is also tested without inherited environment credentials.
- Full repository TypeScript checking, scoped ESLint and the complete local build passed. The build retains non-blocking chunk-size and mixed static/dynamic import warnings in unchanged application code.
- Git/source audit: no existing tracked files changed; the new modules are imported only by one another and their explicit evaluator/tests, not by live request or UI paths. See the [validation receipt](forma-memory-foundation-verification-2026-09-02.json) for source hashes and checks.
- The evaluator makes zero provider calls and zero database writes. The shadow preview is deliberately lexical, and the summary deliberately extractive; passing it does not prove multilingual semantic recall or nuanced intent/profile quality.
- No browser/visual QA was performed because the task is backend-only, additive and disconnected from the UI.

## Next integration checkpoint—coordinate before enabling

1. Agree on an accepted specialist-team baseline and ownership of shared files. Do not merge or deploy over their in-progress source/evidence baseline.
2. Repair the previously identified structured-fact extraction in existing `taste.ts` and establish semantic/summary gold fixtures before any production inferred-profile comparison. This slice does not modify the old taste path.
3. Add a **server-owned source adapter** to hydrate authorized final conversation and interaction evidence, resolve real scope ancestry/resource versions and grants, prove complete per-stream intervals, and propagate suggestion/copy lineage. No client receipt is authoritative.
4. Add durable D1 metadata/private-body/dependency storage and an isolated test database, then transactional idempotency, suppression, cleanup and index-outbox integration. This requires coordinated schema/runtime/privacy changes and tested migrations; none exist in this slice.
5. Define explicit background-processing enrollment, retention and cost budgets. Select/evaluate a semantic embedding/summary implementation and a Sites-compatible index service while preserving the planned Postgres/pgvector production direction. Do not reuse synthetic fixtures as real user memory.
6. Prove real no-visitor scheduling, retries, revocation/expiry/forgetting and restore/reindex behavior in isolation. Expiry and privacy maintenance must work without new human activity.
7. Only after those gates, add a disabled-by-default live shadow path. Later integrate eligible memory after authoritative private hydration and before provider serialization, keeping response shapes and UI unchanged. Coordinate edits to `worker/assistant-api.ts`, `worker/events-api.ts`, provider, access, runtime, state and privacy contracts.

The second rollout step—better answers in existing interfaces—is **prepared by an additive adapter only**, not activated. New UI controls/autocomplete, broad transferable personal knowledge and organization-shared profile publication remain separate releases.
