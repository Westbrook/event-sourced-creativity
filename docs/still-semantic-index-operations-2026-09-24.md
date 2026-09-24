# Still semantic index — operations and qualification

Current qualification checkpoint: runtime `3786dc53` on `codex/still-hosted-qualification`, unpublished; production/main remains v550 / `c28af5fe`, flags disabled. **NO-GO:** final local healthy edits at 1k/10k take 6m/38m (limit 5m), default 10k renewal takes 794m (limit 720m), and one-day 10k has zero current coverage at its 144m deadline. Batching, routing, authority, retention and scheduling repairs are implemented; bounded incremental edit/renewal work remains. See [current release decision](qualification/release-decision.md), [verification ledger](qualification/verification-2026-09-24.md), [measured lifecycle evidence](qualification/throughput-2026-09-24.md) and [operator runbook](qualification/operating-runbook.md). Hosted scheduling/schema/isolation, live quality/performance/retention and human fidelity/accessibility remain unqualified. Earlier counts below describe their dated checkpoints.

Status: published disabled implementation v550 / `c28af5fea0fc3ec2b37b878a544ec59c52a64daf`; local qualification checkpoint complete with failed engineering gates and unavailable hosted evidence. Production remains disabled. No live model call, new service, scheduler, production schema change or activation is authorized by this runbook. Current gate decisions and exact local candidate receipts are maintained in [release decision](qualification/release-decision.md).

## Deployment-compatible configuration

The production reference is Site `appgprj_6a7a020e334881919ed8aea0363cb98f`, its Worker, D1 `DB`, and private R2 `MEDIA`. Hosted qualification requires independently isolated physical resources, secrets and schedules; production storage must not be reused for fixtures. Existing OpenAI and Jev credential presence was recorded in the prior implementation without logging or live use; reuse for a new target still requires the exact credential decision.

| Control | Meaning | Production during this task |
| --- | --- | --- |
| `STILL_UNIFIED_CREATION_ENABLED` | User-facing creation rollout | unset/disabled |
| `STILL_CREATION_INDEX_ENABLED=true` | New indexing/search inference admission | unset/disabled |
| `STILL_CREATION_PROVIDER_CUSTODIES` | Exact JSON custody allowlist; no wildcard | not changed |
| `creation_index_enrollments` | Authoritative per-custody enabled flag, policy epoch, expiry, daily token limit | candidate schema; not installed |
| `OPENAI_API_KEY`, optional `OPENAI_PROJECT` | Embedding/organizer HTTP credentials | existing; no live use |
| `STILL_CREATION_ORGANIZER_MODEL` | Explicit qualified Responses model | `gpt-4.1-mini-2025-04-14` proposed for qualification only; not activated |
| `JEV_API_KEY`, `STILL_CREATION_JEV_ENABLED=true` | Grounded identity assessment | not activated |
| `STILL_CREATION_DEPLOYMENT_ID` | Content-free run receipt identity | qualification must set exact deployment |

The native default is the pinned 512-dimension OpenAI representation; do not set a different search model or mix model spaces. The optional old Fetcher adapter remains a compatibility path, not a deployment prerequisite. Model/representation replacement requires a shadow build, quality evidence and explicit pointer cutover design; the pinned v1 does not silently activate an unqualified model.

## Actual scheduling gate

The installed Sites tools/docs and fresh site metadata did not establish a callable persistent schedule-creation operation. There is no verified schedule identity or repeated hosted run receipt. Native `scheduled()` plus deterministic invocation is only implemented code.

Required platform primitive: either a supported Sites persistent trigger for this existing Worker, or documented machine-authenticated ingress through the Site's workspace access layer, usable by a named managed scheduler. No such fallback ingress was established. Do not invent manifest fields, create a public maintenance route, use browser credentials/shared-token bypass, loosen audience, create another compute Worker, or substitute a desktop heartbeat.

Once the supported mechanism and authorization exist: configure once per minute; record schedule, deployment and environment identities; close app tabs; witness at least ten consecutive actual durable wakes; redeploy and witness again; inject overlap, missed wakes and backlog; verify machine authentication/replay rejection if ingress is used. A supported external monitor must alert after five minutes without a successful wake while work is due. Alert destination and authorization remain to be supplied; no message or monitor was created here.

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

The concrete request is [authorization-request.md](qualification/authorization-request.md), with exact resource/isolation fields, source-only schema hashes, fixture provenance, credential choice, model proposal, costs, expiry, ownership and cleanup gates. Proposed US$25 total / US$5 canary are unapproved maxima. The [itemized estimate](qualification/cost-estimate.json) does not claim a known all-in price or an implemented shared monetary cap. Obtain exact target/schema/provider authorization and accounting before live work. A supported manual hosted canary may proceed independently of unresolved scheduling only when its own dependencies are authorized; it never closes the autonomous-delivery gate.

Use the [current operational runbook](qualification/operating-runbook.md) for installation, canary/full evaluation, monitoring, recovery, cleanup and the unapproved 24-hour single-custody pilot proposal. The [release ledger](qualification/release-decision.md) retains all hosted/human gates. No alerts, messages or future automation have been created.

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

The current offline scorer and capture harness use a hash-bound frozen packet with at least 60 unique queries: at least 40 positives and 20 no-match negatives. Separate producer/reviewer receipts bind corpus, query, label and per-query adjudication bytes. Independently authored agent labels are preparation evidence; they do not replace human organizer fidelity review. The packet must be frozen before models run and replaced if consumed for tuning. A separate development manifest supplies canary inputs.

Capture each permitted partition's semantic top 20, one global pre-hydration shortlist of at most 24, final three, coverage, failures/timeouts, custody disclosures, exact source/model/deployment versions, stage timings and actual runtime/usage receipts. An empty partial or timed-out result cannot qualify as no-match. Failed requests remain in relevance denominators. Repeated latency samples are separate from the unique relevance cases; require at least 30 cold/warm/concurrent observations for each 1k/10k corpus and real cold-start/runtime provenance.

The capture CLI requires explicit approved target/isolation/capability/adapter hashes, expiry and durable per-request reservations. It supplies no public route or host transport adapter. Use the optional [shared lifetime/canary provider guard](qualification/provider-budget-operations.md) across capture, maintenance, organizer and Jev. It is locally tested and fails closed on incomplete installation; actual hosted D1/account billing qualification and separate hosting allocations remain required. Use the current capture contract and CLI usage alongside [frozen fixture provenance](qualification/fixtures-frozen-2026-09-24.md). Scoring never authorizes activation. Live relevance, hosted performance/retention and human review remain open.
