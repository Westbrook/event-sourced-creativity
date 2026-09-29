# Still image interruption repairs

Implemented from the [approved investigation](still-image-interruption-plan-2026-09-22.md). Publication of the application repairs is authorized; the release receipt is maintained in the independent project progress report. The queue companion remains disabled pending hosted qualification. No image provider request, historical replay, infrastructure activation, or allowance release was performed during implementation.

## Changes

- The Images SSE reader stops at the supported final event and cancels the reader without waiting for EOF. A later reset, malformed trailer or duplicate terminal cannot discard or replace the first final. UTF-8/CRLF splitting, incomplete EOF, invalid terminal dimensions/format, 64 MiB transport size, five-minute idle and ten-minute total response limits are handled explicitly. JSON bodies use the same transport bounds. These are application bounds, not a claim about provider cancellation.
- Response headers and the provider request ID are checkpointed before reading the body. Later failures retain the known response identity. Stronger paid-call observations override an earlier `not_dispatched` snapshot without rewriting history. New ordinary attempts retain an invocation identifier, execution owner and lease epoch; missing historical milestones remain unknown.
- Optional preview storage/progress waits are limited to 500 ms. Ordinary preview faults do not abort final consumption. Explicit cancellation and ownership failures still stop work. A separate partial-image key prevents a delayed preview from replacing the final.
- Ordinary high-quality OpenAI image jobs retain a private original-result journal bound to the attempt, correlation, client/provider request identity, final media hash, original plan/prompt and usage. Final custody and financial observations are both attempted when either fails. Known spend is not discarded when saving fails; missing usage is not treated as zero. Private Memory and native Output retain their existing specialized custody contracts.
- `POST /api/document-jobs/:id/recover` can settle and publish the **original** certified image with zero new provider calls. It checks current actor/project authority, consent, document lifecycle, private retention, the exact job snapshot and the media hash. Recovery uses the original reservations and existing financial reconciliation/disposition guards. It is idempotent; concurrent writers are fenced. Shared-project synchronization preserves the actor-private prompt/plan attached to a valid journal until publication.
- The UI says **Generation was interrupted** for an unknown outcome, distinguishes an allowance hold from a confirmed charge, and explains what refreshing saved status does. Recovery is offered for a server-recorded, unexpired original journal; the endpoint rechecks actual media and authority. Support summaries include bounded trace IDs and the last recorded stage without prompts or pixels. Recovery reopens the original completion notice; no external notification is sent.

## Independent execution: implemented, disabled

The optional companion Worker lives in `workers/ordinary-image-queue/`. The main application owns all existing authorization, source, payment, D1 and R2 operations. The companion has only an application service binding, a queue binding and an HMAC secret; it receives job IDs, not prompts, provider credentials or media.

An enrolled Still generation inserts its job, server-owned execution marker and one outbox row in the admission transaction. Admission returns the saved identity. Browsers observe these jobs and cannot run them, including when the rollout flag is turned off. Ownership markers and outbox rows must survive rollback; they are not fallback switches.

The companion's cron reads due outbox identities and sends wakeups. A failed queue send does not dequeue anything. Its queue consumer awaits the application's authenticated runner independently of the initiating browser. A duplicate delivery observes a live lease or completed result. An expired attempted invocation can be stopped and reconciled, but cannot enter a second paid generation. Original local recovery has at most three automatic checks, separated by at least a minute; an unresolved attempt moves to operator resolution. Closed deliveries remain closed.

Ingress uses a timestamped HMAC over method, path and bounded body. Invalid, modified or older-than-60-second requests fail closed. Replays within that window are harmless delivery duplicates, not new admissions. Public ingress on the companion returns 404. The application endpoint rejects client-selected enrollment and forged claims.

### Activation gate

The existing `.openai/hosting.json` exposes DB and MEDIA only. Available Sites tools do not establish a provisionable queue, cron or cross-service binding. The companion configuration is an **example**, not a deployed resource. Nothing has been enabled in production.

Before activation, the host owner must qualify the actual application service target and independent scheduler. If Sites cannot expose that target, use a supported host integration; do not substitute an ordinary detached HTTP request or `waitUntil`.

1. Install the optional `db/operations/ordinary-image-queue.sql` migration in the selected nonproduction environment. No historical jobs are enrolled.
2. Provision the two queues (work and dead-letter), companion service binding and minute cron using `wrangler.example.jsonc` with a real target. Set matching secrets through host secret storage. Do not put them in checked-in configuration.
3. Run the synthetic hosted acceptance matrix below with provider calls intercepted by the test deployment. Only then set `FORMA_ORDINARY_IMAGE_QUEUE_QUALIFIED=v1` and an explicit comma-separated actor allowlist in `FORMA_ORDINARY_IMAGE_QUEUE_USERS`. The main app secret is `FORMA_ORDINARY_IMAGE_QUEUE_SECRET`; the companion secret is `IMAGE_QUEUE_SECRET`. An allowlist change affects admission, not ownership of previously admitted work.
4. For rollback, stop new enrollment and retain the consumer to drain/reconcile admitted jobs. If the consumer must stop, existing jobs remain independently owned and need resolution; browsers never inherit them.
5. A real-provider canary and production deployment remain separate release actions. Never replay Fall days as a canary.

Cloudflare documents [at-least-once queue delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) and a [15-minute consumer wall-time limit](https://developers.cloudflare.com/queues/platform/limits/). Those facts motivate duplicate suppression and finite invocation handling; they do not certify this Sites-to-companion deployment. Operating costs include queue writes/reads/deletes, retries, Worker invocations/CPU, cron sweeps and existing D1/R2 work. Confirm account pricing and expected volume before activation; no infrastructure was purchased.

### Hosted acceptance matrix still required

| Fault | Required evidence |
| --- | --- |
| Close the initiating browser after 202; observe from another browser | Same job, one original image POST, valid downloaded bytes, exact settlement |
| Lose the 202 response or queue wakeup | Same admission/outbox identity; independent sweep resumes it |
| Kill the consumer before dispatch, after headers, after final storage and after publication | Never replay an uncertain paid call; recover a valid original or explain unresolved outcome |
| Deliver twice; race sweep with live heartbeat | One paid call, one completion and one financial total |
| Disable rollout with pending jobs | No browser fallback or marker erasure |
| Revoke access, expire retention or remove the document during recovery | No private publication; source-free known financial facts remain |
| Exhaust automatic recovery checks | Bounded resolution state and actionable support summary, no invented refund |

## Validation

Local tests use mocked providers with the real application router and SQLite-backed D1/R2 fixtures. Journal recovery tests verify the hash and download bytes of a valid PNG. The companion is exercised with the real signed ingress and a fake service binding, including failed wakeup sends, duplicate delivery, unknown provider outcomes, forged ingress, missing migration rollback and disabled-rollout fencing.

Validation passed: **341 targeted tests**, application and companion TypeScript checks, targeted ESLint, production build and companion Wrangler dry-run. The build reports its existing large-chunk warning. The exact source hashes and logs are linked from the local implementation review. Local mocks prove the implemented boundaries; they are not proof of a production browser-disconnect outcome.

## Remaining limits

- The original Fall days provider outcome remains unknown. There is no retained original image journal from that historical execution, and no documented direct Images lookup by client trace ID was introduced.
- Recovery requires an intact original journal, authorized private references, final bytes and verifiable usage. A raw orphan R2 object is deliberately not adopted as an original result. Loss before the journal checkpoint, simultaneous storage failures, missing usage or provider completion after an invocation disappears can still require operator resolution. This change does not promise every interruption is recoverable.
- Current application and organization retention still apply. No journal extends a source's retention or restores revoked access. No administrative release is interpreted as a provider refund, and later evidence after such a release requires the existing reviewed correction path.
- Low-quality previews and native Output/Memory routes share the repaired parser where applicable, but only ordinary high-quality job generation uses this new original-result recovery endpoint. No broad migration of other execution or privacy contracts was made.
- Deployment identifiers and exact abrupt-termination timestamps are not fabricated. New invocation IDs and durable response milestones improve correlation; production host logs are still required to establish the actual termination mechanism.
