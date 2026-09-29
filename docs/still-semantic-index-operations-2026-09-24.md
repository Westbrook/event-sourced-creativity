# Still semantic index — operations and qualification

Status: local implementation under verification. Production remains disabled. No live model call, new service, scheduler, production schema change or activation is authorized by this runbook.

## Deployment-compatible configuration

Reuse the existing Site `appgprj_6a7a020e334881919ed8aea0363cb98f`, Worker, D1 `DB`, and private R2 `MEDIA`. Existing OpenAI and Jev credentials were observed by presence only; they were not read into logs or used for this implementation's tests.

| Control | Meaning | Production during this task |
| --- | --- | --- |
| `STILL_UNIFIED_CREATION_ENABLED` | User-facing creation rollout | unset/disabled |
| `STILL_CREATION_INDEX_ENABLED=true` | New indexing/search inference admission | unset/disabled |
| `STILL_CREATION_PROVIDER_CUSTODIES` | Exact JSON custody allowlist; no wildcard | not changed |
| `creation_index_enrollments` | Authoritative per-custody enabled flag, policy epoch, expiry, daily token limit | candidate schema; not installed |
| `OPENAI_API_KEY`, optional `OPENAI_PROJECT` | Embedding/organizer HTTP credentials | existing; no live use |
| `STILL_CREATION_ORGANIZER_MODEL` | Explicit qualified Responses model | not selected/activated |
| `JEV_API_KEY`, `STILL_CREATION_JEV_ENABLED=true` | Grounded identity assessment | not activated |
| `STILL_CREATION_DEPLOYMENT_ID` | Content-free run receipt identity | qualification must set exact deployment |

The native default is the pinned 512-dimension OpenAI representation; do not set a different search model or mix model spaces. The optional old Fetcher adapter remains a compatibility path, not a deployment prerequisite. Model/representation replacement requires a shadow build, quality evidence and explicit pointer cutover design; the pinned v1 does not silently activate an unqualified model.

## Actual scheduling gate

The installed Sites tools/docs and fresh site metadata did not establish a callable persistent schedule-creation operation. There is no verified schedule identity or repeated hosted run receipt. Native `scheduled()` plus deterministic invocation is only implemented code.

Required platform primitive: either a supported Sites persistent trigger for this existing Worker, or documented machine-authenticated ingress through the Site's workspace access layer, usable by a named managed scheduler. No such fallback ingress was established. Do not invent manifest fields, create a public maintenance route, use browser credentials/shared-token bypass, loosen audience, create another compute Worker, or substitute a desktop heartbeat.

Once the supported mechanism and authorization exist: configure once per minute; record schedule, deployment and environment identities; close app tabs; witness multiple durable runs; redeploy and witness again; inject overlap, missed wakes and backlog; verify machine authentication/replay rejection if ingress is used. A supported external monitor must alert after five minutes without a successful wake while work is due. Alert destination and authorization remain to be supplied; no message or monitor was created here.

## Operator procedures

1. Reconcile production migration history from an authoritative ledger/export and schema inventory. Rehearse the existing creation candidates plus the new additive candidate on a disposable copy. Compare canonical events and private authored content before/after. Do not blindly journal 0074/0075 or apply the new SQL to production.
2. On the authorized qualification environment, install the exact reviewed schema; add an expiring D1 enrollment for only the test custody with a bounded daily token allowance; set the matching environment allowlist. Set deployment identity. Keep production flags off.
3. Invoke the internal runner through the supported hosted trigger. Inspect `creation_index_runs`, `creation_index_work`, `creation_index_attempts`, and `creationMaintenanceStatus`. Receipts contain no creative bodies. Retain failed/uncertain provider reservations; a timeout is not proof of zero billing.
4. For credential/policy/schema failures, correct the named condition first. For exhausted daily allowance, wait for the UTC day reset or obtain permission to raise it. Resume only the affected partition using `resumeCreationIndexPartition` in an authorized administrative execution context. It increments the generation, clearing unsafe partial progress. No public resume endpoint is supplied.
5. For expired checkpoints, source-capacity holds or missing objects, inspect the held error. Rebuild the affected partition after addressing capacity/retention; never drop content or silently skip remaining passages to clear the error. Capacity above the current bounds remains partial.
6. Withdraw inference by disabling/revoking the D1 enrollment first, then removing environment admission. The database update invalidates generations immediately across old/new deployments. Removing an environment variable alone is not the authoritative cross-deployment revocation procedure.
7. Keep the Worker cleanup path, DB schema and R2 access available through UI rollback. Deletion continues without inference credentials. Verify all retired/old/staged objects and private derived records are gone, reconcile late/orphan keys, and record deletion receipts. `write_until` prevents early terminal receipts while an upload may still arrive. Shared shards are denied/deleted; eligible neighbors rebuild.
8. For rollback, disable UI and indexing inference, preserve cleanup and authored history, and restore the last verified disabled application artifact only if it retains the needed cleanup handler or an authorized cleanup-only successor is deployed. Do not drop authored history or index cleanup metadata as a rollback shortcut.

## Proposed qualification authorization package

Before any paid or hosted mutation, resolve the actual scheduling primitive and exact qualification environment. Then approve a bounded run using only synthetic/explicitly consented test content, existing named credentials, an explicit maximum provider allowance and exact additive schema manifest. No provisioning or production migration is implied. The embedding arithmetic at the currently documented $0.02/million tokens makes five million input tokens approximately $0.10 for embeddings alone; this excludes queries, edits, Jev, organizer, D1/R2 and retries. Confirm current prices and a concrete total cap before live execution. [OpenAI model pricing](https://developers.openai.com/api/docs/models/text-embedding-3-small)

Evidence required before activation: hosted trigger/redeploy/tab-closed receipts; primary consistency and mutation races; private R2 generic-route denial; verified physical retention and orphan recovery; measured cold/warm/concurrent 1k/10k search <=2s p95 after debounce; actual resource/cost/queue throughput; independent 50-query relevance labels and results; 30-case organization fidelity; browser/accessibility/human checks; exact schema rehearsal, archive and rollback; explicit activation authorization.

## Reproduction and held-out evidence format

From the repository root:

```sh
node --import tsx --test tests/creation-*.test.mjs tests/still-creation*.test.mjs tests/streamed-event-folds.test.mjs
npm run typecheck
npm run build
CREATION_TEST_BROWSER=chromium node --import tsx --test tests/browser/still-unified-creation.test.mjs tests/browser/still-creation-help.test.mjs
node --import tsx --test tests/browser/still-index-workerd.test.mjs
STILL_INDEX_CAPACITY_OUTPUT=/private/tmp/still-index-evidence node --import tsx --test tests/creation-index-capacity.test.mjs
node --experimental-strip-types scripts/package-disabled-memory-release.mjs /absolute/new-disabled-archive.tar
```

Repeat browser checks for Firefox/WebKit using their installed matching Playwright package. This machine used `CREATION_PLAYWRIGHT_MODULE=file:///Users/westbrook/Documents/repos/design-system/node_modules/@playwright/test/index.mjs` for those engines. Local workerd deliberately omits an unrelated panel table to exercise failure isolation; its aggregate scheduled `exception` is expected, while two creation cleanup receipts and erasures must pass. No network provider credentials are supplied to workerd.

The offline scorer `scripts/score-still-search-qualification.mjs` accepts one JSON file. It never calls providers and never authorizes activation. Before live evaluation, an independent reviewer must freeze >=50 held-out labels, including positive and no-match cases, with opaque exact custody/Project/kind/source identities. Include zero-overlap paraphrases, specific parts/containers, duplicate names, long/multilingual text, later Projects, and permission boundaries. Do not derive labels from the model's answers.

Run-level fields: `kind` (`live-hosted` only for actual hosted/live execution), `deployment`, `representation`, `independentLabeler`, `labelsFrozenAt`, `runStartedAt`, and `cases`. Each case requires `id`, `classification` (`positive` or `no-match`), `intended` identities (empty for negatives), complete `allowed` identity allowlist for the test custody, `semanticTop20`, `finalTop3`, measured `elapsedAfterDebounceMs`, and named `cohort` (corpus size/cold/warm/concurrency). Capture candidates before Jev as well as final results. Keep labels/data in the approved qualification custody, not public logs.

```sh
node scripts/score-still-search-qualification.mjs /absolute/frozen-labels-and-observed-run.json
```

It reports positive/negative denominators separately, top-three accuracy, pre-rerank recall, no-match false positives, authorization leaks, and cohort p50/p95. Missing independent/live evidence cannot pass its relevance gate even with perfect injected metrics. The scorer does not establish labeler independence by itself, complete capacity cohorts, provider retention, backend resource accounting, the organizer gate, or activation authorization; reviewers must inspect that evidence separately. **No independently labeled or live run was performed in this implementation.**
