# Durable generation: execution and recovery contract

Status: implementation prerequisite and bounded receipt-safety patch. The durable runner, outbox, browser reattachment and end-to-end durability are **not implemented**. This work starts from production 368, commit `f1c8c8164cd2714bdcd5025a8942dfa2fb2bba8a`, in branch `codex/durable-generation`. During implementation the release owner separately advanced the nonoverlapping taste/test-harness fixes to production 369 (`40e56a2a1d5031af1e7ab723309a4e0d7f2e698b`). This branch does not publish.

The September 16 follow-up is now explicitly requested work. Its earlier six-of-eight verification handoff has been superseded: the canonical progress report records all eight technical live journeys complete. Those historical acceptances do not establish browser-independent generation. The historical provider hold and manual reconciliation remain separate; this work performs no paid generation or financial data mutation.

## Delivery prerequisite

The installed Sites surface verifies persistent D1/R2 storage, but exposes no verified mechanism for durable delivery:

- `.openai/hosting.json` declares the existing project plus `DB` and `MEDIA`.
- The installed Sites storage contract documents logical D1/R2 provisioning and migrations. The hosting contract reserves actual Cloudflare resource wiring to Sites.
- `build/sites-vite-plugin.ts` packages hosting metadata and D1 migrations; it does not provision queues, workflows, Durable Objects, or cron.
- Available Sites tools manage sites, versions, environments, deployments and access. No exposed tool provisions these background resources. Private HTTP tunnels supply connectivity, not a durable owner.

Cloudflare platform capabilities alone are insufficient evidence of Sites support. [Queues need producer/consumer configuration](https://developers.cloudflare.com/queues/configuration/configure-queues/), [Durable Objects need declared storage namespaces](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), and [cron needs configured triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/). [A request's `waitUntil` work is limited after disconnect](https://developers.cloudflare.com/workers/runtime-apis/context/); it is not this design's delivery guarantee.

Required decision: either obtain a documented Sites-supported durable primitive, or permit a companion service. A companion Cloudflare Worker/Workflow is the recommended candidate to investigate, not a verified or provisioned deployment. Its durable delivery, credentials, retry contract and authenticated ingress into this private Site must all be verified. Do not reuse a browser session or short-lived interactive bypass token as a workload credential, expose the Site publicly, invent manifest keys, or accept queued work without a configured delivery owner.

## Existing boundaries to preserve

| Boundary | Existing source | Integration requirement |
| --- | --- | --- |
| Authorization, grants, slots, reservations and native jobs | `worker/output-requirements-api.ts`, `authorizeGrant`; `worker/output-document-execution.ts`, `prepareAdmission` | Keep the existing atomic admission and immutable source, actor, recipient and cost bindings. Authorization alone does not request execution. |
| Explicit Run | `worker/output-requirements-api.ts`, `runGrant` and `resumeRecordedOutputRun` | Activate/insert the unique outbox row in the same command transaction that queues its slot. Identical replay refers to that row. Return the existing job identity promptly. |
| Foreground experience dispatch | `worker/experience-output-dispatch.ts`, `withExperienceOutputDispatch` | Replace the awaited runner only when a durable delivery implementation is available. |
| General output dispatch | `worker/output-document-execution.ts`, bridge `dispatch` | Replace browser-driven wakeup with the same outbox mechanism. |
| Current server principal | `worker/document-jobs-api.ts`, `documentJobPrincipal` | Reconstruct current authorization from server records; do not serialize a browser principal as continuing permission. |
| Paid-call intent | `worker/output-requirements-ledger.ts`, `claimOutputProviderCall` | Reuse its unique logical call and pending-before-fetch record. It consumes call authority even if the external outcome is unknown. |
| Financial settlement | `settleOutputProviderCall`; `settleDocumentGenerationBudgets`; `reconcileKnownOutputProviderReceipts` | Keep actual provider cost, admission allowance, and uncertain exposure distinct. |
| Media custody/publication | `output_native_storage_writes`, recovery modules, native publication sidecars | Preserve deterministic media identity, validation, source custody and idempotent event publication. |

## Persistent state machine

Reuse existing job, slot, grant, reservation, provider-call and media records. A future migration adds only durable dispatch/lease metadata and deduplicated delivery evidence; it must not create a competing billing ledger.

| Execution state | Durable evidence | Allowed next action |
| --- | --- | --- |
| admitted | Existing authorization, reservation, job and inactive dispatch identity | Wait for explicit Run or authorized expiry/cancel. No paid call. |
| queued | Explicit Run event and active outbox row committed together | Acquire a fenced lease and recheck current execution authority. |
| generating | Current lease plus the existing logical paid-call intent | Dispatch that previously unconsumed logical call once; persist the accepted ID/raw response. |
| uncertain | Paid-call intent exists without enough evidence of acceptance, or an unrecoverable interrupted stage | Retain exposure and audit history. Reconcile known evidence/operator disposition. No automatic paid resubmission. |
| awaiting provider | Exact accepted request ID, route and response custody | Authenticated webhook or scheduled read of that same request. No new provider generation. |
| retaining | Completed provider evidence; validation/media custody not yet fully published | Repeat idempotent byte retention/validation/publication with current storage authority. |
| ready | Validated retained output, publication event and canonical receipt | Authorized observation, playback/view, save/reopen/download. |
| failed | Definitive failure evidence and accounting disposition | Observe or explicitly authorize a separate permitted attempt. Uncertain exposure must remain visible. |
| cancel requested / canceled | Explicit authorized stop command and its actual outcome | Never infer cancellation or refunded cost from a disconnected browser. |

These are projected execution phases, not wholesale replacements for every legacy job/slot status. A failed HTTP operation can coexist with an accepted provider request. A grant's paid-dispatch deadline can expire while observing/reconciling that request remains allowed. Ready requires retained validated output, not an HTTP 200 or provider completion alone.

### Outbox and lease requirements

- Bind one dispatch row to the existing scope, grant, slot, job and explicit Run command. Preserve source/target/route digests and original actor/recipient identities; refer to existing private custody rather than copying source into queue messages.
- Record dispatch intent transactionally before sending a delivery notification. The durable runtime must rediscover committed, undelivered rows after a lost send/acknowledgment; an HTTP wakeup alone cannot meet this requirement.
- Acquire a monotonically increasing lease epoch plus a random owner token using a conditional database update. Store expiry and next-observation time. A delivery message carries identity and epoch, never authority.
- Include lease assertions in the same transaction as claims, progress, provider receipt writes, media custody, publication and terminal outcome. Check again immediately before an external dispatch. Stale holders may not mutate successor state.
- A crash after paid intent but before accepted-ID persistence is uncertain. A lease expiring does not make the external POST safe to repeat. No provider idempotency contract has been verified here.
- Bound retries of database operations and accepted-request reads separately from new paid attempts. Deduplicate deliveries and authenticated provider events, and reject state regressions.

## Recovery lanes

Video, Audio, FAL Image and original 3D have accepted-request-only recovery in `output-video-recovery.ts`, `output-audio-recovery.ts`, `output-fal-recovery.ts`, and `output-model3d-recovery.ts`. Their existing authority resolvers and token leases pin exact original requests and separate recovery from fresh paid consent. Preserve those checks and add the outer durable fence; do not call generic `runDocumentJob` again for an already consumed attempt.

The permitted 3D replacement path has additional actual-caller requirements. Do not manufacture an authenticated request to bypass them. Storyboard explicitly lacks `recover-result`; Slides, narrative and Scene cannot be assigned a generic accepted-ID recovery path. Each needs proven retained-result continuation or truthful uncertainty at unsupported interruption boundaries.

Webhooks require verified signature/key/expiry semantics and exact provider-request ownership. No webhook authenticity or public reachability contract was verified in this work. A durable polling implementation can avoid webhooks if it supplies the same exact-request and delivery guarantees.

## Browser observation contract

- Reload/navigation/reconnect use the durable server job identity. Visibility changes suspend transport/rendering; they do not cancel generation or authorize retries.
- `forma-experience-host.ts` currently stops reads when hidden, permanently retires on `pagehide`, and has no matching visible/pageshow reattachment. Add guarded read-only reattachment with fresh source/read authority, including BFCache handling.
- `src/state/store.ts` currently calls `#driveDocumentJobs` after passive list refresh and POSTs Run for eligible `outputs` jobs. Add server execution-owner metadata and exclude durable jobs from this legacy driver and automatic presentation recovery.
- Ordinary document-job GET also repairs/fails stale jobs and may wake the legacy queue. Exclude durable-owned rows there. `inspectOutputNativeJob` and `GET :id?inspection=1` provide an existing observational read boundary.
- Keep retaining/committing phases observable. Preserve uncertainty rather than overwriting it with generic failure. Separate permission to view/reconcile an accepted request from permission to start a paid call, while retaining source and recipient custody checks.
- Authorize, Run, Retry and Stop remain explicit operations with their own live permission. A lost POST acknowledgment causes an exact original-job read, never automatic paid submission.

## Bounded implementation in this branch

The receipt-safety prerequisite is independent of the unselected runner:

1. Provider settlement preserves a known accepted request ID when later observations omit it and rejects conflicting IDs or accepted-to-rejected regressions.
2. The native observer normally commits its monotonic financial JSON checkpoint, provider-call settlement and overage projection together. Duplicate terminal observations require matching per-call evidence and do not overwrite later display summaries.
3. An existing recovery safeguard remains: if a non-conflict persistence fault prevents that combined commit, a separately guarded, monotonic source-free financial witness may be retained for existing maintenance reconciliation. This is explicitly not successful settlement. If that write also fails, the pending call and its uncertain exposure remain. No new provider call is permitted.
4. In-memory observation and token totals update only after successful persistence and preserve previously known evidence when duplicate callbacks omit fields.

This patch does not add an outbox/consumer, alter browser generation lifetime, grant new execution authority, migrate production schema or resolve historical uncertain charges.

## Verification and operational acceptance

Local checks use real SQLite transactions and mocked provider responses. They verify ID pinning, competing receipts, atomic rollback on failed/suppressed checkpoint writes, exact replay after lost acknowledgment, immutable terminal usage, source-free accounting after consent loss and existing maintenance convergence without another provider request.

The full durable acceptance gates remain required:

- Close/hide the initiating browser and reopen the same job on another authorized device; one paid submission completes independently.
- Crash before dispatch, between dispatch and accepted-ID persistence, after accepted-ID persistence, after media retention and before settlement. Resume only safe internal steps, otherwise expose uncertainty.
- Duplicate/out-of-order deliveries and webhook events do not duplicate media, published results or charges.
- Expired consent, revoked access, changed source, exhausted allowance, storage faults and provider timeouts retain exact authority boundaries and audit history.
- Exercise actual playback/viewing, save, reopen and downloaded bytes. Existing historical live journeys and source tests do not satisfy these new runtime gates.
- Alert on overdue outbox delivery, expired active leases, accepted requests past the observation deadline, checkpoint/ledger disagreement, failed retention and unsettled exposure. Operator reconciliation uses exact job/slot/call identities and records its disposition; it never silently creates a replacement attempt.

No automatic monitor, external service or deployment is created by this document. Canonical integration and publication remain with the existing Forma release owner.
