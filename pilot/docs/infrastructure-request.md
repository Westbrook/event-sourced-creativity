# Still-led shared platform pilot — local request packet v3

Prepared locally; not submitted. Planning source: Reve starter `7c0e4ca8ac984c4368d27bb0801f085daa5aa58a`, companion infrastructure `d54c26b5`. Application continuation: `ed16305a`, runtime `d190ed41`; historical main/v550 `c28af5fe`. Existing isolated branch `codex/still-gke-pilot` is local and unmerged.

## Entry routes and shared resources

Proposed origin: `https://still-platform-pilot.p.reve-dev.com` (not reserved).

| Interface | Entry | Retained document |
| --- | --- | --- |
| Still | `/still` | `/still/project/:projectId/document/:documentId` |
| Forma | `/projects` | `/document/:documentId/:optional-slug` |

Forma addresses come from `src/model/routes.ts::withDocumentInRoute`; its real application entry is `index.html`. Still addresses come from `src/still/routes.ts`. IDs in both links identify the same canonical records. No per-interface database, data copy or synchronization service is proposed.

One Node API, one application PostgreSQL database, one private GCS bucket, one principal/account/workspace ownership model. Separate private Memory service with its own schema and database role. Still exact-shard retrieval is unchanged; Memory pgvector is not a replacement for it. Providers remain disabled.

## Platform allocation and owner response required

| Field | Concrete proposal / missing input |
| --- | --- |
| Repository / namespace | New `reve-ai/still-platform-pilot` / `still-platform-pilot`, subject to availability; neither created |
| Engineering, billing, operations, cleanup owners | **Awaiting named people**; asked in the current task |
| Two IAP accounts | **Awaiting exact independently authenticated accounts**; local signing keys are test-only |
| IAP audience | Return `/projects/PROJECT_NUMBER/global/backendServices/SERVICE_ID`; verify ES256 signature, issuer, audience, issued-at and expiry, then map stable subject to admitted app principal |
| Cloud account / billing | **Awaiting exact GCP project number, billing account and allocation attribution**; source references to `reve-prototyping` do not establish access |
| Database | Shared fresh PostgreSQL; local application tests use 17.9. Quote hosted supported version and durable configuration; return actual database/PVC identifiers |
| Memory | Pinned local image `pgvector/pgvector@sha256:feb68f4f15446397d8cac7f4fe48fe4586de83160d1fc48b46283312d1a33966` (0.8.2-pg17-bookworm). Hosted architecture/version approval still required. Three-dimensional development vectors qualify mechanics only |
| Private bucket | Return dedicated bucket ID/region, uniform private access, workload identity, generation preconditions, backup policy, object version/soft-delete retention. No production R2 credentials copied. Physical erasure within 15 minutes cannot pass while any retained generation/soft-delete policy prevents actual erasure |
| Identities / secrets | Distinct deploy, runtime, migration and Memory roles; exact scoped Workload Identity bindings. New encryption roots required before B; private application bodies at rest are not yet ported to native encryption custody |
| Jobs/RBAC | Minute cleanup CronJob, `Forbid`, 45s start deadline, 50s execution deadline, one retry, 10-object/job admission bounds; separate migration/restore Jobs. Companion `batch` Role/RoleBinding included. Scheduler suspended by default |
| Quotas (proposed ceiling) | CPU requests 750m / limits 3; memory requests 1536Mi / limits 4Gi; 10 pods; fixture PVC 5Gi; bucket 1GiB; artifact/log/backup quotas must also be returned. These are proposals, not configured cloud quotas |
| Cost | **No account-specific quote available.** Return all-in compute, DB/PVC, bucket/versioning, backup, network, Artifact Registry and logging quote, plus attribution. No numeric cost estimate invented |
| Budget / expiry | **Awaiting explicit total and ongoing infrastructure ceiling, expiry date/time and teardown owner.** Paid provider budget is zero; earlier $25/$5/$10 proposals do not transfer |
| Alerts | Return authorized destination/owner for five minutes of overdue due work or cleanup; none configured or sent |
| Backups | Return destination, encryption, retention and restore procedure. Rehearse restore with current withdrawal authority/tombstones applied before reads; database rollback alone cannot resurrect deleted content |
| CI activation | Protected environment, repository-specific GitHub OIDC, digest-pinned verified-main images, rollout lock. No deploy-enabled branch push. Template retains app checks; deliberately omits all WebTransport images, service, transport ticket and load-balancer steps |

## What is ready and what is still required

A runs locally using the actual frontend/editor, synthetic SQLite fixture, simulated principal and disabled providers. The PostgreSQL candidate reuses the native creation compiler, event shapes, authority projection and record IDs; SQL transaction/lease adapters are tested. Its workspace membership table is a bounded proof scaffold: full native project roles, permission epochs, custody and consent equivalence are **not qualified**, and it must not replace native authorization in a hosted pilot yet. The Node HTTP boundary deliberately returns unavailable for unported routes and is not deployment-ready.

Required implementation before functional deployment: native session and creation HTTP repository integration; canonical generic event edits for the actual Forma document interface; native membership/custody/encryption equivalence; index source/checkpoint/outbox adapter; GCS live contract tests; capped cleanup pagination and retention sweeps; complete worker recovery/uncertain-ledger port. These are outstanding B work, not deferred full-Forma work.

Required hosted evidence: actual commit and image digests; authenticated Still→Forma→Still edit, conflict recovery, second-principal sharing/revocation and search exclusion; source withdrawal and separate physical erasure; ten closed-tab wakes plus ten after redeploy; stopped-worker, missed-wake, overlap and late-write recovery; backup/restore and schema-compatible rollback; account-specific spend receipts. A, B and C remain separate review cards.

No request/issue/message has been sent, repository created, cloud resource provisioned, production data imported, paid provider called or deployment-enabled source pushed. This packet is ready for completing the named fields; it is **not an activation request with all fields resolved**.

Adapter references checked during implementation: [Google signed IAP assertions](https://docs.cloud.google.com/iap/docs/signed-headers-howto), [GCS request preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions), [pgvector extension source](https://github.com/pgvector/pgvector), and [Kubernetes CronJob execution semantics](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/). These explain adapter requirements; they are not evidence of this account's live access or pricing.
