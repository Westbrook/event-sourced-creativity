# Qualification contract

## A — local appearance and routing

Actual Still editor + explicit synthetic adapter. Local default is loopback only; it cannot be bound publicly by setting a gateway boolean. Disposable SQLite does not qualify PostgreSQL. Native manual organization fallback is used while providers are disabled. Report→app links retain `?progress-report`; unflagged Still keeps its ordinary UI. A user opening the preview is not acceptance.

Supported A pages: native Still projects, project documents, Project Ideas, selected Ideas, new Project, new Document and Add Idea; page navigation accepted by the native route parser. Forma `/projects` and ordinary `/document/:id/:slug?` entry assets are built from the real app. API availability is a strict explicit allowlist in `src/routes.mjs`. GET session/events/jobs/history, Still decision, native creation draft operations. Generic Forma event mutations and its wider bootstrap/dependencies are not yet exposed. Unknown APIs/assets/pages return genuine errors; nothing proxies Sites.

Unavailable: generation/create/results/artifacts; media uploads/serving; detached/shared panels; public shares; authenticated real-account sessions; full project sharing APIs; Memory product UI; Canvas; library/tools; administration/operations; billing, providers and paid inference. Some native controls still advertise unavailable actions; this is a preview limitation, not supported behavior.

## B — required shared functional journey

1. Verify real IAP principal A and affirmative consent; map stable IDs to native account/workspace roles.
2. Create one synthetic Project/Document with a rich Idea/reference through Still. Persist native review/receipt/draft semantics atomically; store private content through qualified object/encryption adapters.
3. Open that exact ID via the actual Forma document route. Edit shared content. Reload Still: verify common account/workspace/Project/Document/Idea/media/Memory IDs, changed revision, rich content and references.
4. Concurrent edit with stale expected version must return native conflict and preserve both drafts. No last-writer-wins fallback. SQL proof uses a workspace revision fence; complete native per-record conflict equivalence remains required.
5. Principal B authenticates independently; verify intended shared read/write, revoke, then both interfaces deny reads/writes and supported search/recall excludes the source. Refresh both views.
6. Withdraw/delete using native control; verify immediate serving/recall denial and physical absence independently, including versions, late puts, private bodies, draft residues, vector shards and backups/restore policy.
7. Close every app tab. At least ten real job wakes, another ten after redeploy. Exercise overlap/missed wake/stopped worker, original uncertain attempt reconciliation without new billing, generation fences and cleanup with inference disabled.
8. Save metadata-only receipts: principal/resource IDs, versions, source commit, image digests, route URLs, job/operation IDs, timestamps, statuses, hashes, provider representation and cost totals. Never save private creative bodies, credentials or JWTs.

Local PostgreSQL test receipts **are not** this UI journey. Neither local signing keys nor direct repository calls demonstrate two real IAP users. `api.mjs` fails readiness until the native HTTP port is implemented.

## C — separate Memory foundation

`memory-pg-v1`: authenticated internal POST `/v1/upsert`, `/v1/query`, `/v1/delete`. A Google machine token's issuer, signature, audience, expiry and allowlisted stable subject are checked before the repository. Partition membership is current server data, not a claimed email/header. All queries filter partition, current source generation and partition generation. Source tombstones fence stale upserts. Cache restore reconciles against current authority before restoring vectors. `/v1/reconcile` is unavailable until native intent integration exists; restore is a bounded operator repository proof, not a web route.

Local proof uses pgvector 0.8.2, synthetic three-dimensional vectors and separate custody partitions. Exact hybrid query mechanics, replacement, exclusion, deletion absence and stale restore rejection are tested. This is no semantic-quality or scale claim. Hosted proof still needs separate role/IAM, native authority intents, tombstone-preserving disaster restore, compaction, genuine candidate comparison, operational ownership and approved enrollment. Completed native Memory work and production500 schema repair are untouched.

## Fixed final gates

- Backfill ≤24h; healthy edit ≤5m; physical erasure ≤15m.
- Renewal ≤12h and each actual expiry; no coverage gap.
- Hosted search p95 ≤2s after debounce at both 1k and 10k Ideas; measure cold/warm/concurrent separately.
- Frozen 40-positive/20-negative relevance packet and organizer cases reserved for final qualification, not development/tuning. Replace any packet consumed for tuning.
- ≥90% top-three relevance; ≤10% false positives; ≥95% per-partition recall@20; zero forbidden disclosure. Failures/partial results remain in denominators.
- Human fidelity, accessibility and explicit checkpoint review are independent of automated pass.

## Later work (outside required pilot)

Full Forma route/tool/admin/media/Canvas qualification; customer/public-share access design; all feature parity; production data inventory and custody; Sites account continuity; migration rehearsal/backfill/cutover, reconciliation and rollback; production secrets and resource provisioning; real-provider usefulness/cost evaluations and broader enrollment. Do not use this list to defer the required bounded Forma journey above.
