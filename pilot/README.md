# Still / Forma isolated GKE preparation

Local candidate on `codex/still-gke-pilot`, based on `ed16305a` / runtime `d190ed41`, retaining historical v550 `c28af5fe`. Starter pattern source: `7c0e4ca8`. Nothing is published or deployed. Production Sites and its native Memory schema are unchanged.

**A is a synthetic local visual preview. B is incomplete. C has a local pgvector mechanics proof.** These are separate review checkpoints; no user review/acceptance is inferred.

## Run the visual preview

From the repository root, Node 24.16.0 with the application's pinned pnpm dependencies installed:

```sh
npm ci --prefix pilot --ignore-scripts
node node_modules/vite/bin/vite.js build --config pilot/vite.config.ts
node --import tsx pilot/src/preview.mjs
```

Open `http://127.0.0.1:5207/still/action/new-project?progress-report` and the existing independent report at `http://127.0.0.1:4187/`. This uses actual Still source and its actual creation editor with native Worker domain handling and **disposable in-memory SQLite**, simulated identity, disabled providers and a process-level network refusal. No PostgreSQL identity or durability claim. Restart resets fixtures and invalidates saved synthetic draft URLs. The existing separate previews on 5174/5175 are not used or changed.

Use a title to create a Project/Document. For an Idea description, choose **Complete one Idea manually**, supply title/type, present then approve each review stage and approve final save. Provider organization is intentionally unavailable. A reload can recover the draft; the first manual-review transition was observed retaining disabled input controls until refresh and is recorded for further qualification.

## Local adapter checks

`pilot/package-lock.json` isolates pg, jose and GCS dependencies. Tests use fresh synthetic principals/records and no frozen qualification packets. Provide only isolated test database URLs:

```sh
PILOT_DATABASE_URL=postgresql://USER@127.0.0.1:55527/postgres \
PILOT_MEMORY_DATABASE_URL=postgresql://postgres@127.0.0.1:55528/postgres \
PILOT_PREVIEW_URL=http://127.0.0.1:5207 \
node --import tsx --test --test-concurrency=1 pilot/tests/*.test.mjs
```

Missing database URLs cause integration tests to skip; skipped tests are not evidence. The recorded local run used real PostgreSQL 17.9 and pgvector 0.8.2 in a pinned, disposable local container. JWT tests use local signing keys. Object tests inject a controlled test double: live GCS IAM, generations/soft-delete/retention and erasure are **not qualified**.

`src/repository.mjs` reuses native `compileCreationPlan`, `creationReviewHashes`, `authorityFromCreationProjection`, canonical event shapes and shared IDs. It proves atomic event/receipt/draft publication and concurrency fences in PostgreSQL, without a SQL string-rewriting D1 emulator. Its limited membership/consent scaffold is **not equivalent to the whole native authorization/custody model** and must remain outside hosted product use until ported.

`src/api.mjs` is a fail-closed signed-IAP host boundary: readiness is false and native application HTTP routes are unported. It does not silently route to production or run fixture handlers. `src/memory-service.mjs` provides private machine-authenticated upsert/query/delete mechanics; native intent reconciliation remains unavailable. `src/jobs.mjs cleanup` is a bounded internal CLI; `src/worker.mjs` repeats cleanup without browser sessions. Index execution/uncertain-attempt native integration remains outstanding. Leases, original reservation records and generation fences have local repository tests; real browser-independent hosted recovery is untested.

## Artifacts

- `docs/infrastructure-request.md`: exact real frontend routes, one shared resource set, proposed quota and unresolved owners/accounts/cost/expiry.
- `docs/qualification.md`: fixed gates, route exclusions, mandatory B/Forma journey, C contract and later-work inventory.
- `deploy/`: NGINX/containers, suspended/zero-replica Kubernetes proposal, batch RBAC and verification-only workflow. No WebTransport. These are **templates**, not an authorized runnable deployment packet: platform resources, immutable web/API digests and native B integration remain required.
- `evidence/receipt.json`: final local checks and limitations; raw `.log` files remain local and ignored.

Required B work remains in the active report denominator; it is not deferred into full Forma qualification. Infrastructure inputs are pending. The hosted sequence, real user journey, live storage, closed-tab wakes/redeploy, restore, rollback, cost receipts and A/B/C acceptance are not complete.

## Continue this local candidate

Workspace: `/private/tmp/still-gke-pilot`. Preserve the local branch before clearing temporary directories. The visual adapter and evidence viewer are independent of test database processes. Start the evidence viewer with `node pilot/src/evidence-server.mjs`; it serves only allowlisted documentation and metadata receipts at `http://127.0.0.1:5208/`. The canonical Progress Report remains separately owned on port 4187.

The synthetic PostgreSQL cluster is `pilot/.local/postgres`, initialized with local trust authentication, bound only to loopback port 55527. Start it with `/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D pilot/.local/postgres -l pilot/evidence/postgres.log -o '-h 127.0.0.1 -p 55527' start`. The disposable pgvector container is `still-pilot-memory-local`, bound only to loopback port 55528; restart it with `docker start still-pilot-memory-local`. These test services have been stopped after verification; do not reuse their authentication configuration in hosted environments.

The next implementation step is native session/creation and generic-event repository integration with the complete native role/custody/encryption model, followed by the required real Forma edit/conflict journey. Infrastructure authorization does not substitute for that missing code. Do not treat the API image's successful import check as application readiness.
