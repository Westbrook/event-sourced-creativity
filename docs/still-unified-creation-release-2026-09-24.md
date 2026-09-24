> September 24 semantic-index continuation: mandatory private Fetcher/Workers AI/Vectorize requirements below are superseded by the same-Worker HTTP/D1/private-R2 implementation. See [semantic implementation and gates](still-semantic-index-2026-09-24.md) and [operations](still-semantic-index-operations-2026-09-24.md). All other qualification, migration, archive, rollback and activation gates remain open as recorded.

# Still unified creation — disabled release candidate

This is an implementation and qualification package, **not activation approval or release readiness**. Production unified creation remains disabled. No provider provisioning, paid inference, production migration application, automatic generation or Memory feature work is included.

## Source and publication lineage

Fresh native Sites lookup and authenticated source fetch established v546 / `e56390576d8fe878c066a0faeaecfefd3062bc91` as the published baseline. This preserves N6/N7 and supersedes the original local main at `d8255c6d`. Work is isolated on `codex/still-creation-completion`; unrelated original-worktree files remain untouched. Source is built and packaged only after scoped commits and verification. The publication receipt is recorded separately in the Progress Report, because its version/deployment identity exists only after this source commit is saved.

Implementation commits so far: `e184957a` recovery; `8a93fa0d` correction/identity workflows; `8c29e42e` retrieval/index lifecycle. The interaction and qualification commits follow these in the branch log.

## Concrete runtime prerequisite

The app requires **Fetcher service bindings**, `STILL_CREATION_SEARCH` and `STILL_CREATION_ORGANIZER`, to the private provider Worker. Strings with those names in Sites environment variables are insufficient. The available Sites manifest/tool surface exposes logical D1/R2 and runtime string/secret configuration; no supported arbitrary Worker service-binding or provider-resource provisioning operation was available in this task. Resolve this deployment capability with the hosting owner before authorizing infrastructure changes. Do not replace it with public URLs or expose provider endpoints as a workaround.

Provider source and private/default-disabled example: `workers/creation-provider/index.ts` and `wrangler.example.jsonc`. Required resources: D1 `STATE`, Workers AI `AI`, 1,024-dimensional cosine Vectorize `VECTORS` with string metadata index `sourceKey`; matching representation/organizer model versions; matching provider-token secrets (at least 24 characters); exact app and provider custody allowlists. No wildcard custody. Keep `CREATION_PROVIDER_ENABLED=false` and `STILL_UNIFIED_CREATION_ENABLED` absent/false throughout setup. The main Worker and provider have scheduled handlers, but actual scheduler configuration/delivery and physical vector erasure must be witnessed in the qualification environment. No schedule was created here.

## Candidate migration integration and rollback

The current source migration journal ends at `0073_memory_authored_images`; its indices run through 71. Creation schemas remain `drizzle/candidates/0074_still_creation.sql` and `0075_still_creation_search.sql`, outside the journal. The current release policy deliberately packages 41 older migrations, so this publication cannot apply the creation candidates. `tests/creation-release-candidates.test.mjs` applies both candidates twice to a disposable current application fixture, compares canonical and private event rows byte-for-byte, and verifies the held release policy. Search schema repair replaces old triggers as well as creating the new tables.

For an authorized qualification deployment: first reconcile the actual D1 migration inventory and latest source journal; snapshot/backup the target; assign the next valid ordered journal entries rather than blindly copying candidate numbers; apply to a disposable copy of the real inventory; compare event/receipt/private-content counts and hashes; execute creation and existing-route smoke tests; only then seek the separately authorized production migration step. These checks do not authorize that step.

Rollback first disables the authoritative app capability and provider admission. `/api/session?profile=still` then returns `creation.enabled=false`, the dedicated routes return 404, and ordinary navigation uses the existing creation flows. Keep additive tables/receipts and authored history; do not drop them to roll back code. Redeploy the recorded prior known-good archive if needed. Qualify resumed retained drafts/operations after re-enabling in the same test environment. Local flag rollback is tested; deployed rollback is still open.

## Qualification matrix and next actions

| Gate | Available evidence | Remaining action before activation |
| --- | --- | --- |
| Correctness/recovery | Actual local controller/Worker/SQLite workflows include review, compile, commit, reload and rejected races; 512/513 boundary preserved | Repeat receipt-loss, process interruption, discard race and two-tab recovery on deployed D1 |
| Fidelity | Deterministic identity/correction/evidence validation and injected-organizer corpus | Run pinned live organizer on held-out long/multilingual corpus; human-adjudicate no invention, omission or altered qualification, split usefulness and accepted correction preservation |
| Relevance/coverage | 21+ Project permutations, canonical eligibility, degraded states, staged scheduled continuation, renewal/deletion tested locally | Measure live hybrid relevance/coverage and custody isolation with independently labeled held-out cases |
| Performance | Actual local lexical D1-compatible SQLite lookup at 1,000/10,000 Ideas; query-only p95 below 1 ms in this run | Measure end-to-end debounce-to-visible p50/p95, first-build cost, sustained queue delay and D1 budgets at both sizes with live embeddings/reranking; compare plan budgets |
| Retention | Local publication guards, expiry denial, renewal, tombstones and scheduled sweeps | Witness asynchronous physical vector deletion, crash-created remote orphan cleanup, namespace erasure and scheduler execution |
| Accessibility | Three-engine keyboard, IME, named modal/focus preservation, mobile reachability, RTL/help and review checks | Complete actual screen-reader journeys and human language/fidelity review; automated browser assertions do not substitute |
| Rollout | Server-authoritative capability, normal-route UI and default-off dedicated routes tested locally | Verify bindings, target schema, disabled deployed smoke, then controlled enable/rollback in an authorized qualification environment |
| Observability | Count-only search coverage, maintenance queue age, interpretation status and validation issue counts | Observe deployed event delivery and useful alert thresholds; confirm logs contain no creative text |

Next concrete decision: approve a hosting-supported private Fetcher-binding path and a bounded qualification environment/budget. Provisioning, live-provider calls, production migrations and activation remain separate authorization gates. Until qualified, keep unified creation disabled.

## Evidence interpretation

See `still-unified-creation-completion-2026-09-24.md` for finding-to-fix mapping and `still-unified-creation-verification-2026-09-23.md` for the accumulated ledger. Durable final logs are under `docs/evidence/still-creation-completion-2026-09-24`. Browser tests execute real UI/controller/Worker against disposable SQLite with providers unset; corpus/provider tests inject inference and vector transport. Neither is a live-model claim. Only the scoped checks described in the ledger were run, not the entire repository test suite.

## Archive qualification incident

The generic Sites packaging helper recopies the source `drizzle` tree over the build's held migration set. Archive inspection caught this before deployment: saved v547 (`4c1dcc58`) contains unqualified candidates and **must never be deployed**. Saving another archive for that same source SHA returns the original immutable saved version, so release requires a new source commit and a newly saved version.

Use the repository's existing `scripts/package-disabled-memory-release.mjs` after restoring `dist/.openai/drizzle` with `copyReleaseMigrations`. Keep that verified archive separate from the generic helper's archive. Before native save, inspect the tar itself: exactly 41 SQL files plus the exact policy journal, every policy hash matching, zero candidate files, and Worker bytes matching the tested build. Save the separately verified archive; reject any native archive receipt whose digest differs. This does not change source candidate migrations or authorize their production application.
