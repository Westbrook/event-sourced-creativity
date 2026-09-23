# Still image interruptions: root cause and repair plan

22 September 2026 · Investigation and proposed work · Source baseline `95b9e1ecee808fd67a6cc16273e1f630a2407794` · Production 528

The investigation is complete; the repairs below are proposed and have not been implemented or deployed. This work used production read-only evidence, source inspection and offline provider mocks. It did not start a new image generation, replay the failed request, change accounting, or activate infrastructure. Existing concurrent product edits were preserved.

## 1. Finding and confidence

**Still runs ordinary image generation inside a long-lived browser HTTP request. That is the principal architectural weakness. Streaming also has proven result-loss bugs: a complete image can arrive and then be discarded because the stream fails before closing.** Both need repair. Turning streaming off alone would leave the execution-lifetime and accounting/custody problems.

For **Fall days**, the correlated Worker invocation was canceled, and Still later classified the abandoned job as `provider_submission_uncertain`. A disconnected downstream connection is the strongest current explanation from that outcome. A second canceled status GET appears in the same log window, but the timestamp mapping does not establish simultaneous termination or a shared cause. We cannot identify the exact browser/proxy/network action, or establish whether the image stream reached headers, partial pixels, or completion. The implementation fails to retain those milestones reliably.

Cloudflare documents canceled invocations as associated with client disconnection; HTTP work may be canceled when that connection ends. Provider SSE happens inside this Worker, while the browser's `/run` request waits for one final JSON response. Partial images do not keep that browser response alive. See [Worker errors](https://developers.cloudflare.com/workers/observability/errors/) and [execution limits](https://developers.cloudflare.com/workers/platform/limits/).

| Finding | Confidence / qualification |
| --- | --- |
| Ordinary Still execution depends on foreground `/run` HTTP lifetime | Confirmed from client and server source |
| Correlated production invocation ended `canceled` after 36,495 ms of wall time | Confirmed log outcome; route ID redacted, correlated by document/referrer/time |
| A downstream disconnect caused this incident | Strongest explanation from canceled outcome; exact initiating action and shared cause unproven |
| Streaming can lose already-completed output | Reproduced locally; not proven to have happened in Fall days |
| Missing request ID proves the provider never responded | False: local reproduction shows known headers/ID can be lost |
| Configured 30-second browser timeout killed `/run` | Ruled out: that default applies to GET, not this POST |
| Provider refused the image or input moderation blocked it | No supporting evidence: preflight moderation passed; image verdict unknown |
| CPU time limit caused cancellation | Unsupported: recorded CPU was 3,193 ms; outcome was `canceled`, not CPU exhaustion |

The earlier incident note treated the Sites log timestamp as the cancellation time. That precision is not established. Sites exposes a generic timestamp, while Cloudflare's `EventTimestampMs` denotes event receipt. Do not derive exact execution start/end from it without the connector mapping. See [trace field definitions](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/workers_trace_events/).

## 2. Incident evidence

Attempt `01a0cb6e-4504-753a-899a-509d47fc1631`, document `67649a5b-480e-4027-8b81-f4f7cdb86430`, project `1e20815f-c572-45db-be6d-45fd839d555e`.

| Persisted observation, UTC | Meaning |
| --- | --- |
| 23:23:16.612 request; 23:23:17.419 start | Accepted local job |
| 23:23:26.920 planner response | Usable planner result and measured usage |
| 23:23:35.310 moderation response | Standalone preflight clear; not the image provider's verdict |
| 23:23:37.779 prepared image request | `gpt-image-2.5-sunburst`, 1536×1024, high, PNG, `stream:true`, `partial_images:1` |
| Log timestamp 23:23:50.546 | Correlated POST `/api/document-jobs/REDACTED/run`: `canceled`, wall 36,495 ms, CPU 3,193 ms |
| Log timestamp 23:23:50.642 | Status GET also `canceled`; timing does not establish simultaneous termination |
| 23:24:35.242 terminal job update | `provider_submission_uncertain`; no retained image response; final usage unknown |

Image client trace ID: `forma-image-371b38ee-71c2-44c2-b1f1-3f0375dc7078`. Correlated Worker request ID: `3c449fe61e8f6aa4b0a66014413908a1`.

The $1 is a retained allowance reservation, **not a verified image charge**. Measured planner usage and unknown image usage must remain distinguishable. The saved `not_dispatched` request observation was made before fetch; presenting it as the final dispatch state is a projection defect. The duplicate-purchase guard and conservative unresolved hold were appropriate given the missing evidence.

An in-app navigation does not explicitly abort `/run`; it uses client-side routing. User recollection of reload, close, network loss or navigation would help correlation, but no answer is required to fix the proven weaknesses. No exact user action is assumed.

## 3. Reproduced failure windows

| Boundary | Current behavior | Required behavior |
| --- | --- | --- |
| Completed SSE event, EOF withheld | Final pixels/usage stay in memory; operation waits | Validated terminal event completes response consumption; save original result without waiting for EOF |
| Completed event, then connection reset | Final image and usage evidence discarded; pending paid submission remains | Preserve the valid terminal result; trailing transport cannot regress it |
| HTTP 200 + `x-request-id`, then reset | Known ID/status disappear from retained evidence and error | Persist headers immediately; distinguish response observed from final received |
| Partial preview saved, progress DB write fails | Optional preview callback aborts consumption of final event | Ordinary preview failure degrades presentation; authority/lease/cancel failure remains a hard stop |
| Final result, finance checkpoint fails | Both streaming and JSON routes lose final custody | Independently preserve authorized original bytes and known financial facts; reconcile later |
| Pending submission + stale pre-fetch observation | Summary says `not_dispatched` while terminal status is uncertain | Derive dispatch monotonically from all durable facts; preserve historical observations unchanged |

The streaming rollout `c018b5b3` enabled an existing parser for ordinary high-quality generation. It widened exposure to parser weaknesses and added preview callbacks; it did not introduce the foreground execution design. Low-quality previews already used streaming.

Source anchors at the inspected baseline:

- `src/still/client.ts:31,506`: timeout behavior and detached client POST.
- `worker/document-jobs-api.ts:407,1934,1999,2032,2054,4060`: foreground route, heartbeat, unresolved hold, stale reconciliation and awaited runner.
- `src/model/document-jobs.ts:256`: 75-second lease, 15-second heartbeat, 45-second stale threshold. These preserve metadata; they do not extend Worker lifetime.
- `worker/openai-adapter.ts:470,498,519,529,543`: EOF loop, deferred evidence, headers gap, partial/final parsing, finance-before-custody gap.
- `worker/image-generation-preview.ts:12,34`: shared preview/final object key and uncaught progress failure.
- `src/model/generation-execution-evidence.ts:218` and `worker/provider-submission.ts:55`: stale derived dispatch state.
- `worker/events-api.ts:580`: final ordinary image storage occurs only after adapter return.
- `worker/document-jobs-api.ts:3765` and `src/still/generation-outcome.ts:12`: no ordinary OpenAI image original-result recovery.

## 4. Change packages and order

### A — Preserve evidence and make status truthful

Implement first, alongside B. Extend existing attempt/call evidence rather than creating a competing job system.

1. Persist monotonic milestones: dispatch intent, dispatch boundary, response headers, first event, partial received, validated final received, final custody, accounting settlement and publication. Link original attempt, call, client/provider request IDs, invocation, deployment and lease epoch. Store explicit invocation start/end where observable; an abrupt kill need not produce an end event.
2. Persist `x-request-id` and HTTP status as soon as headers arrive. Preserve them in later failures. A dispatch intent can precede actual fetch; it must conservatively mean uncertain once the unsafe boundary has been crossed, never falsely prove receipt.
3. Record elapsed stage time and safe failure/abort provenance. Distinguish observed user cancellation, lease loss, provider transport error and unknown invocation loss. Log event type/sequence and timing, not prompts, pixels, credentials or private reference contents.
4. Derive summary from the strongest durable evidence. A pending paid boundary overrides an earlier `not_dispatched` snapshot; final custody/settlement cannot regress because an old runner later fails. Add reconciliations without rewriting immutable history.
5. Ship the corresponding truthful copy and actions with this package; do not leave the user-facing repair until the infrastructure project finishes.

Primary files: provider-submission/evidence modules, OpenAI adapter, document jobs, generation outcome model/presenter. Exit: before-headers and after-headers failures produce different, consistent, testable outcomes on every surface.

### B — Preserve terminal images and isolate optional previews

1. Treat the documented, validated completed SSE event as terminal. Validate/decode final payload under explicit size/type limits; stop consuming and clean up the reader. Bare EOF, `[DONE]`, or a partial image is not a completed image. Completed events contain final image data and usage: [Images API reference](https://developers.openai.com/api/reference/resources/images).
2. Introduce an original-response journal/manifest, bound to original attempt/call, owner/scope, request IDs, content hash and terminal event. Retain authorized final bytes and exact usage before fragile downstream publication steps. Existing stripped response evidence is insufficient for restoring pixels.
3. Treat custody and accounting as complementary durable writes, not an impossible D1/R2 atomic transaction. Journal failure must still attempt recording known source-free usage. Finance failure must still attempt authorized original-result custody. Persist each outcome and allow idempotent completion of missing internal steps. Do not swallow finance failure or invent zero usage.
4. Publication remains subject to current access, retention and existing billing rules. Saving a response privately does not authorize exposing it or bypass a hold. A journal supports retrying settlement/storage/publication; it never authorizes another provider generation.
5. Bound and decouple optional preview writes from final response consumption. Catch transient optional storage/progress errors while preserving explicit cancellation, lost lease and authority checks. Give previews separate staging keys or equivalent fencing so a delayed preview can never replace a final image. Correct the inaccurate existing “already in custody” comment.
6. Apply the same custody/accounting contract to JSON image responses. Audit shared consumers, including edits, low-quality previews and private Memory receipts, without broadening private retention.

Exit: received final output survives trailing resets and independent accounting/storage failures wherever one durable custody path succeeds. A hard crash before any durable write remains an explicitly tested uncertainty window.

### C — Give ordinary Still generation an independent execution owner

Begin host qualification in parallel with A/B. Production activation depends on proving the actual hosting primitive and ordinary Still integration.

1. Qualify a Sites-supported durable queue/workflow/trigger with documented delivery, maximum execution duration, retries and independent sweeping. Current project bindings expose DB/MEDIA; current tools do not establish queue/workflow availability. If unavailable, prepare one concrete companion Worker/Workflow option with authenticated ingress, least-privilege storage access, costs and operational ownership before an infrastructure decision.
2. Reuse `worker/output-durable-runtime.ts`, outbox/lease/fencing concepts and [existing activation plan](durable-generation-activation-2026-09-17.md). This code is dormant and binds native Output slots/grants. Ordinary Still needs an explicit admission adapter; flipping `outputDurable` is insufficient.
3. Atomically admit the ordinary job and one durable outbox identity using the current source, revision, authorization and allowance contract. Return 202/job identity promptly. The independent consumer executes; the browser observes and reattaches. Admission replay returns the same job identity.
4. A separate sweep must recover lost queue wakeups. At-least-once delivery must not produce a second paid submission. Preserve consumed-call markers, lease epochs, CAS and late-result fencing through duplicate delivery, process loss, cancellation and retries.
5. Do not use `waitUntil`, fetch keepalive, longer browser timeouts or an open tab as durability. Cloudflare's post-response/disconnect `waitUntil` extension is bounded; it is not an independent reliable job owner. See [limits](https://developers.cloudflare.com/workers/platform/limits/).

Exit: a hosted synthetic image job continues with its initiating browser connection closed, and another browser can observe the original completion with exactly one provider submission. Existing native FAL recovery tests do not meet this gate for OpenAI Images.

### D — Recover original work and resolve uncertainty

1. Add ordinary image reconciliation from certified original journals, final manifests, events and usage receipts. Restore missing settlement/publication idempotently with zero new generation POSTs. Never adopt a partial object merely because the media key exists.
2. Use provider lookup only when supported for the exact endpoint/request. Current direct Images documentation exposes no retrieve-by-client-request-ID operation. `X-Client-Request-Id` helps provider support trace an uncertain request; it is not documented idempotency or result recovery. See [request tracing](https://developers.openai.com/api/reference/overview).
3. Evaluate a provider background/pollable route only as a separately qualified option. Responses background supports retrieval by response ID, but image model/tool compatibility, storage/retention, privacy, failure semantics, pricing and output parity must be established. It is not a drop-in retry for the lost direct Images request. See [background mode](https://developers.openai.com/api/docs/guides/background).
4. Maintain bounded reconciliation policy: supported read attempts, elapsed deadline, last/next check, owner and terminal reason. After the deadline, show `resolution required` or `original result unavailable` as justified; do not poll forever or infer a refund. Initial deadlines must follow measured provider/host limits and be tested with a fake clock.
5. Provide an audited operator path and sanitized support summary. Reuse existing financial disposition controls; record evidence, actor, reason, hold decision and any later usage correction. Administrative allowance release is distinct from provider non-billing/refund. A replacement is a separately authorized new attempt, linked to the original, with disclosed duplicate exposure when still unknown.

Exit: each interrupted state either recovers the original result without purchase, reaches a supported provider lookup, or gives an honest, actionable resolution path. No promise that every lost direct Images result is recoverable.

## 5. Status and user communication contract

Keep execution, provider progress, content custody and accounting as separate facts. Derive one clear status and server-certified allowed actions. “Failed” must not conceal “provider outcome unknown.” Proposed wording below is conditional on evidence, not a claim about new capabilities already shipped.

| Known state | User-facing message and action | Financial/recovery rule |
| --- | --- | --- |
| Durable runner active | “Your image is generating. You can leave this page.” | Only after C is qualified; returning attaches to same job |
| Proven stopped before image dispatch | “Generation stopped before the image request was sent.” Review/restart | Settle known planning; release only proven unused image allowance |
| Sending interrupted; no response proof | “Generation was interrupted. We couldn't confirm whether the image service completed your request.” View resolution details | Show reserved amount and final cost unknown; no automatic replacement |
| Headers or partial observed, no final | “The image service responded, but Still did not receive a complete image.” | Preserve provider ID; final result/cost remain unknown; supported lookup or resolution path |
| Valid final journaled; publication incomplete | “Your image was generated. Still is finishing saving it.” Restore saved result when eligible | Resume original local work; no new generation charge |
| Final image saved, usage unresolved | “Your image was saved. Final usage is still being verified.” | Expose result subject to existing rules; keep unknown usage distinct from zero |
| Measured completion, pixels lost | “The image service completed the request, but Still couldn't save the image.” | Show verified cost; original lookup if supported, otherwise support resolution |
| Saved and committed; display fetch failed | “Your image was saved. Reload the result.” | Reload existing media; never regenerate |
| Actual preflight stop/provider refusal | Explain the observed stage and reason | Preserve current consent/revision flow; never invent refusal from missing output |
| Explicit cancel after dispatch | “Stopped waiting. The image service's completion is still unconfirmed.” | Do not claim provider cancellation without acknowledgment |

For the evidence currently available for Fall days, the desired summary is:

> Generation was interrupted. We couldn't confirm whether the image service completed your request. Your $1 allowance reservation is still held; final image usage is unknown. No replacement request was sent.

Details should show the attempt reference, last known stage, last resolution check and a working next action. “Refresh saved status” must remain a read of saved state. “Recover original” appears only when the server certifies original-result recovery. Offer a copyable support summary for an unretrievable original; do not imply that opening support has already resolved it.

Use the same status projection on attempt detail, inspection, result lists, toolbar and in-app notifications. Notify once on meaningful recovery/completion/resolution changes, preserve dismissal behavior, and provide accessible live announcements without repeating every poll. A notification should link to the original attempt and explain whether original work was recovered. No external messaging or scheduled automation is part of this investigation.

## 6. Tests and release gates

Every fault test must assert original call identity, paid POST count, durable milestones, artifact hash/validity, hold/settlement facts, final status and allowed actions. “Did not throw” is insufficient. Unit mocks establish control flow; compiled Worker/D1/R2 integration and real hosted disconnects establish the operational contract.

| Layer / fault group | Required checks |
| --- | --- |
| SSE completion | Final then open stream, reset, malformed trailer, duplicate terminal: preserve one result/receipt, no extra POST, no downgrade |
| Incomplete/protocol | Headers only, partial only, empty body, EOF/DONE without final, explicit error, invalid payload, split CRLF/UTF-8 frames, size limits: accurate phase, finite timeout, never partial-as-final |
| Header evidence | Persist failure before/after headers; retain known ID/status even when body fails; injection of evidence-write failure leaves explicit uncertainty |
| Preview | R2, scope, DB progress failures and indefinitely slow callbacks: presentation degrades; final reader progresses; revoked authority/lease still stops publication; late preview cannot overwrite final |
| Final custody / accounting | Kill or fault before/after final decode, object write, manifest, DB receipt, settlement, event, job completion; exercise failure before and after actual commit; retry original only |
| Missing usage | Valid pixels with absent/invalid usage; known planner plus unknown image; late exact usage; duplicate settlement; admin release followed by late evidence |
| Admission / delivery | Lost 202 response, duplicate admission, outbox/wakeup loss, redelivery, queue crash, expired lease, competing sweep: same job and at most one paid dispatch |
| Fencing / races | Heartbeat versus stale detector, late final versus terminal status, old owner versus new owner, explicit cancellation versus completion: no unauthorized mutation or regression |
| Recovery | Repeated/concurrent reconcile, original orphan manifest adoption, mismatched hashes/IDs, partial-only objects, deleted document, revoked access, private retention expiry: correct original custody and no leakage |
| Browser lifetime | SPA navigation, reload, tab close, hidden/background, offline and dropped TCP; reconnect from another browser; stream/nonstream matched latency control; provider socket failure tested separately |
| UI | Table-driven state/copy/actions across detail, lists, toolbar and notice; hold versus charge; preserved dismissal; one recovery notice; keyboard/live region/mobile; no false refusal/cancel/refund |
| Shared consumers | High/low quality generation, edits, zero/one partial and fallback/no-partial path, private image receipt route; nearby non-image durable/accounting invariants remain intact |

Recommended test additions: extend `tests/image-generation-progress.test.mjs`, `tests/image-generation-preview-job.test.mjs`, `tests/generation-outcome-evidence.test.mjs` and `tests/still-stale-generation-status.test.mjs`; add focused journal/reconciliation integration tests and an ordinary Still hosted disconnect harness. Reuse existing durable/client tests, but do not relabel FAL acceptance tests as OpenAI recovery tests.

**Release sequence:**

1. Land A/B with offline regressions, typecheck, targeted lint and production build against the exact release tree. Keep truth/custody repairs independently releasable from C. No automatic change from streamed to nonstreamed submission after a call has been dispatched.
2. Qualify C/D with a synthetic hosted provider and real runtime/storage, browser connection closure and process/crash injection. Prove independent sweeping, finite uncertainty resolution and zero replacement purchases. This work requires the chosen host and bindings; current local tests do not supply that evidence.
3. Only with separate authorization for infrastructure activation and any provider spend, run a small controlled real-provider canary for generation/edit routes. Compare stream/nonstream under matched inputs/settings/latency where feasible; close/reopen the browser, verify downloaded image bytes and settle exact receipts. Do not use the failed attempt as an automatic replay.
4. Gradually enroll ordinary images. Track stuck/uncertain rate by last milestone, known-final-but-unpublished count, journal failures, settlement backlog, sweep lag, duplicate suppression and original recovery rate. Every unknown must have a resolution owner and deadline; zero duplicate paid dispatch is a release invariant.
5. Roll back by stopping new durable admissions while draining/reconciling accepted jobs with their existing owner/manifest. Never fall back to browser `/run` or fresh Images POST for an accepted/uncertain durable job. Feature gates must not strand existing work.

Sign-off evidence: exact source/build/deploy identity; host binding qualification; one original result and one settlement under each recoverable failure; truthful uncertainty for unrecoverable gaps; no false success/refusal/refund; no private data exposure; no indefinitely active work without owner/deadline. System failures cannot be eliminated absolutely; this plan removes avoidable losses and makes the remaining cases bounded, recoverable where possible and accurately explained.

## 7. Verification performed for this plan

- **30/30 existing image tests passed:** `node --import tsx --test tests/image-generation-progress.test.mjs tests/image-generation-preview-job.test.mjs tests/image-generation.test.mjs`.
- **53/53 existing job/durable tests passed:** `node --import tsx --test tests/output-durable-generation.test.mjs tests/output-durable-client.test.mjs tests/document-jobs.test.mjs`.
- **Seven isolated fault scenarios asserted current behavior:** success control, final with withheld EOF, final then reset, headers then reset, preview-progress failure, streaming finance failure and nonstreaming finance failure. All fetches were mocked; exactly one synthetic image POST per case. Synthetic payloads prove transport/control flow, not valid rendered-media custody. These are bug-characterization assertions, not passing tests of a repair.
- Disposable actual-source client test confirmed no timeout/AbortSignal on POST `/run`, versus the GET 30-second timeout. Separate model reproduction confirmed stale `not_dispatched` projection.

The fault harness and raw results, plus three independent source audits, accompany the [local review packet](http://127.0.0.1:4193/interruptions/). Review checkpoints and feedback remain in the existing [Progress Report](http://127.0.0.1:4187/).

## 8. Concrete continuation

Recommended first implementation: A/B as a narrow image reliability repair, while a separate bounded host qualification completes C's infrastructure choice. Then integrate ordinary Still admission, original-image reconciliation and hosted acceptance. Do not activate the dormant native Output path without adapting its authorization contract.

The historical incident remains unresolved at the provider boundary: acceptance, image completion and final image usage are unknown. A provider-side trace using the preserved client request ID may narrow that; this investigation did not contact support or assume retrieval is available. Review of this plan does not itself authorize publishing, provider spend or release of the outstanding reservation.
