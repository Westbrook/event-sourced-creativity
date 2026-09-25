# Still / Forma R1 test release

The v3 candidate on `codex/still-gke-pilot` reuses the actual Still creation editor and Forma document interface over one PostgreSQL event store. **The native workflow is verified locally; no GKE release has been deployed.** The earlier A preview and local Memory mechanics proof are retained independently.

## Supported slice

- Verified, signed IAP identity mapped to fresh, explicitly admitted test principals; native consent and scoped role checks.
- Manual Project, Document and Idea creation, private autosaved drafts, native review/compiler, stable IDs and retry receipts.
- The same document and rich Idea body in Still and Forma; reference identities retained, stale edits rejected.
- Named Project sharing as viewer/editor, revocation, owner-only Idea/Project deletion, and a reference guard before deleting an Idea.
- Encrypted private event/draft/operation bodies, shared PostgreSQL transactions, persistent test PVC. A fresh root is required.

Paid models, uploads, public sharing, semantic search, Memory, Canvas, tools/admin, generated outputs and broader Forma actions are unavailable. A dedicated private bucket is an infrastructure allocation for the shared environment; R1 exposes no upload/object routes. R2 worker/indexing and R3 hosted Memory qualification follow R1. Existing Sites accounts/data and migration are excluded.

## Run the local native release

With pinned root dependencies and `npm ci --prefix pilot --ignore-scripts` installed:

```sh
PILOT_RELEASE=core node node_modules/vite/bin/vite.js build --config pilot/vite.config.ts
PILOT_DATABASE_URL=postgresql://USER@127.0.0.1:55527/postgres node --import tsx pilot/src/core-local.mjs
```

Open `http://127.0.0.1:5230/still?progress-report`. This separate, clearly labeled harness uses signed synthetic identities and persistent local PostgreSQL. It never qualifies live IAP. Its persisted encryption root is under ignored `pilot/.local`; deleting the root makes existing local content unreadable. The production API image explicitly excludes this harness and the SQLite preview.

Create a Project with a short title, create a Document, then add an Idea. Descriptions enter manual review directly. Supply its title/type, present and approve review stages, then approve final save. Open the document’s **Test release · access and navigation** controls to switch to Forma. Select the Idea, open its controls, edit and save. Switch back and reload to see the same data. The controls also offer named Project access and deletion. Document-only deletion is unavailable.

The existing 5207 disposable A preview remains separate. The report is independent at `http://127.0.0.1:4187/`.

## Verification and deployment

```sh
PILOT_DATABASE_URL=postgresql://USER@127.0.0.1:55527/postgres \
  node --import tsx --test --test-concurrency=1 pilot/tests/core-*.test.mjs \
  pilot/tests/identity.test.mjs pilot/tests/routes.test.mjs
```

A missing database URL skips the HTTP integration test and does not qualify it. The integration test drives native CreationController requests through signed synthetic IAP and real PostgreSQL, including reference review/refresh, two principals, conflicts, deletion and idempotency. Native browser evidence separately verifies actual Still creation → acknowledged Forma save → Still same-ID content and persistence through Node restart.

See `docs/operations-r1.md` for the deployment procedure and `docs/infrastructure-request.md` for exact external dependencies. `.github/workflows/still-core.yml` retains application checks and uses Reve’s GitHub OIDC → prototron deployment pattern, protected environment, serialized rollout and digest-pinned images. Deployment runs only on verified main with explicit enablement and validated target configuration. WebTransport and unqualified background/Memory stages are absent.

`deploy/render.mjs` generates runnable R1 workloads once actual target values are supplied. It includes a fresh 5Gi PostgreSQL PVC, password-authenticated bootstrap/runtime roles, schema initialization, web/API services and PostgreSQL network isolation. The legacy `deploy/workloads.yaml` and `deploy/verify.yml` are v2 references, not the R1 deployment entry points.

Receipts: `evidence/core-receipt.json` (R1), `evidence/receipt.json` (historical A/B/C local proofs). Raw logs are ignored. No user review or acceptance is inferred from tests.
