# Durable generation: implementation and activation handoff

This change builds a **disabled server execution foundation**. It does not turn current Sites HTTP requests into durable background jobs. No production schema, queue, scheduler, webhook, environment binding, provider credential, audience, or entrypoint was changed. No real provider call was made. The current user instruction is to build what can be built now and document later activation.

## Delivered code

| Contract | Implementation |
| --- | --- |
| Explicit Run commits work before acknowledgement | `prepareOutputDurableRun` participates in the existing Run transaction: native slot transition, Run event, outbox row, immutable ownership marker, and command receipt commit together. Authorization alone never enrolls or wakes. |
| Exact original identity | Immutable job/scope/slot/grant/actor/source/route/target/Run bindings. Enrollment checks private Run membership. Consumption checks the public Run identity and command receipt. No source bodies enter delivery messages. |
| Independent delivery | `createOutputDurableRuntime().consume({version:1,jobId})` and `.sweep()`; wake is advisory, bounded to one second, and lost wakes leave due rows. These are internal functions, not registered endpoints. |
| Fenced worker | D1 operations are enclosed by lease epoch/token/expiry assertions in the same transaction. Native authority/privacy checks remain layered above that fence. R2 operations check before and after and reuse existing custody receipts. Expired continuations cannot commit D1 changes. |
| Original paid work | The native adapter starts only an unattempted queued original with zero paid calls. Native intent and provider receipt persistence remain authoritative. Unknown acknowledgement becomes uncertainty with held exposure; it never causes a new POST. |
| Accepted-request recovery | Original FAL Image, Video, Audio and 3D recovery functions are composed behind current authority checks. Exact media-call identity is required. Accepted pending requests and bounded transient GET failures remain due. Successful genuine-admission FAL Image recovery is tested; other route-specific qualifications remain below. |
| Accounting | Reuses `reconcileKnownOutputProviderReceipts`, native call settlement and reservations. Ready requires completed job, succeeded slot, no unresolved call cost, settled cost and terminal token accounting (including the explicit zero-token released sentinel). |
| Safe interruption | Expired native attempts close with a compare-and-swap on the original checkpoint. Concurrent erasure cannot be overwritten. A previously committed completion with unfinished job bookkeeping becomes explicit reconciliation-required uncertainty, avoiding duplicate publication/usage. |
| Observation | Durable identity is returned in exact reads and compact feeds. Ordinary browser/server queue drivers and execution/recovery routes refuse marked jobs even when the runtime is removed. Notification ACK/dismiss remain available. |
| Reattachment | Host preserves only the original job/grant/slot/Run identity. Hide, online and BFCache return use GET; interrupted initial reads resume. Lost Run acknowledgements get up to two minutes of GET-only retries after acknowledgment loss or reconnect, bounded by job retention, including reads before commit and transient read failures. Paid latches are cleared. True authority/route retirement stays final. |

The schema lives only in `worker/output-durable-schema.ts`. It is intentionally absent from `db/schema.ts`, the migration journal, the Worker bootstrap and `.openai/hosting.json`. The constructor verifies exact table/index/trigger definitions; it cannot install them. A cold consumer initializes only the normal existing core/output schema before installing its execution fence.

## State and failure semantics

`queued → generating → retaining → ready` describes ordinary success. `awaiting_provider` is scheduled observation of an accepted original. `failed` means a known terminal failure with accounted reservations. `uncertain` is an operator reconciliation state and is not swept. `cancel_requested`/`cancelled` are reserved contract states; cancellation has no activated implementation. A cancellation-requested delivery cannot submit paid work and returns explicit uncertainty.

A thrown delivery leaves its lease to expire. Duplicate deliveries are harmless while that lease is current. Outbox ownership never permits adoption of already-started legacy jobs, sponsored jobs, shared-context jobs, replacements, or fictional principals. Missing schema, malformed delivery, unknown owner, weakened schema, identity drift, and expired leases fail closed.

A fixed lease defaults to 15 minutes (maximum 30). There is no lease heartbeat. Do not qualify a route whose full bounded execution cannot fit within a host's actual invocation and lease limits. R2 cannot be atomically rolled back with D1: a PUT accepted during lease loss may leave an orphan. Existing deterministic receipts and custody checks must be used for reconciliation; a generic retry is not safe.

Transient failures inside original-provider GET stages retry at 30 seconds, up to 20 consecutive read failures (healthy pending results reset the failure count). Each attempt repeats the existing authority/receipt proofs. Other recovery failures become uncertainty. Provider-specific error/backoff and rate-limit tuning require staging qualification; these defaults are conservative scaffolding, not a service-level guarantee.

## Activation sequence

1. **Qualify a real independent runtime.** The tools inspected in this session did not establish a Sites-owned queue, workflow, scheduled trigger or equivalent durable execution primitive. D1/R2 persistence alone does not supply delivery. Obtain a supported platform contract or an explicitly approved companion service. Never substitute `waitUntil`, an open browser, or recurring Codex work for application durability.
2. **Choose a narrow rollout.** Start with actor-paid personal originals for routes actually qualified end-to-end. The native factory is not an all-output qualification certificate. Keep shared projects, sponsors, replacements, reference-image 3D and other unqualified routes out of runtime construction/enrollment until their exact authority and recovery contracts pass. Pass an explicit `enrollMedia` allowlist only for qualified media/provider routes; omitted or empty policy is drain-only and refuses new Run enrollment. Provider/model/route configuration and existing route digests must also match the qualified release.
3. **Promote the schema through the normal migration process.** Review the candidate SQL, add the matching typed schema and migration with the repository's migration tooling, test on an isolated database, then install on the intended environment. The constructor compares exact schema definitions. Do not add this table opportunistically from request handling. See `activation-candidates/output-durable.sql`.
4. **Implement host-owned delivery ports.** Provide at-least-once delivery and an independently scheduled sweep over committed due rows. The sweep is required even if queue enqueue normally succeeds. Persist only `{version:1,jobId}` in delivery payloads. The host must await/ack the actual consume result, retry thrown invocations with bounded backoff, and monitor rows that remain due after lost acknowledgements. Treat `busy`/`not_due` as advisory results; the sweep still guarantees later examination.
5. **Compose the existing HTTP Run handler with `runtime.env`.** Only the verified server factory may mint enrollment capability. Keep ordinary request authentication, principal resolution, consent, provider-transfer approval, source/route proofs and admission allowance checks. Supply the same server-created runtime instance environment through the trusted Run call chain; a copied environment deliberately has no capability.
6. **Keep execution inaccessible to browsers.** Prefer native service bindings/triggers. If a companion service requires HTTP, design and test service authentication, audience, replay protection and exact message validation first. A Sites interactive identity header/cookie is not a worker credential. No public driver endpoint, header bypass, CORS shortcut or shared secret in a URL is provided here.
7. **Qualify production-like D1/R2 behavior.** Verify batch atomicity, transactional assertion failure, statement/binding limits, concurrent lease claims, invocation deadlines, clock skew, dead-letter handling and storage acknowledgement loss. The local SQLite adapter is not hosted D1 concurrency evidence.
8. **Canary with explicit spend/transfer approval.** Use a small, fixed route and allowance. Close the initiating browser before completion, kill workers at the boundaries below, reopen on another authorized device, inspect retained media and download exact bytes. Compare invoice evidence, call exposure and Forma allowance independently. Keep historical uncertain attempts.
9. **Activate incrementally through the established publisher.** This task does not own main pushes or production deployment. Preserve current audience/environment and existing unrelated sponsor work. Record exact source, schema, runtime, trigger and verification versions.

Composition outline (a contract, not a deployable host entrypoint):

```ts
// Only after schema installation, route gating and host qualification:
const runtime = await createNativeOutputDurableRuntime(env, delivery => durableQueue.send(delivery), { enrollMedia: ["slides"] });
// Authenticated, qualified HTTP Run path: existing handler receives runtime.env.
// Independent queue handler: await runtime.consume(validatedMessage).
// Independent scheduled handler: await runtime.sweep(25).
```

Queue bindings, scheduler configuration and service authentication are intentionally unspecified until the selected platform is verified. Provider webhooks are also unimplemented: add signature verification, timestamp/replay checks and exact accepted-request ownership before allowing any webhook to wake a job. Webhook bodies must never authorize a new paid call.

## Remaining acceptance work

| Area | Remaining work and current safe behavior |
| --- | --- |
| Completion committed before job finalization | Implement a dedicated exact completion/media-custody reconciliation path; currently records `output_durable_completion_reconciliation_required`, without duplicate media or usage. |
| Other native output routes | Genuine admission → consumer → retained bytes qualification for Short story, Scene, Storyboard, Audio, Video and text-only 3D, including their interrupted planner/media/storage boundaries. Existing lower-level tests are not whole-runtime acceptance. |
| Planner response / storage interruption | Add qualified original-response adoption and storage cleanup/reconciliation for every route. Unsupported intermediate states preserve evidence and stop in uncertainty. No rerun to fill a missing stage. |
| Authority after source deletion | Financial receipt reconciliation must be qualified independently of private result recovery, including revoked consent and erased private content. Never restore private fields from a stale snapshot. |
| Cancellation | Implement a durable stop command, downstream cancellation contract and accounting semantics, with separate authority. Browser disconnect is not cancellation. Current durable UI does not offer ordinary Stop/Retry. |
| Operations | Add source-free metrics/alerts for oldest due row, expired leases, failed hints, repeated GET faults, unresolved exposure, uncertainty reasons and orphan custody receipts. Provide an audited operator reconciliation tool; do not edit provider IDs, grants or ownership markers manually. |
| Browser/device | Actual supported browser hide/close/reload/offline/BFCache and cross-device tests, accessible phase announcements and retained media playback/download. Deterministic method tests are not physical-browser evidence. |
| Schema retention | Establish outbox/command receipt retention aligned with job/accounting history; validate erasure and backup/restore. The outbox contains identifiers/digests, not source or media bodies. |

## Rollback and safe pause

Stop **new enrollment** by using `enrollMedia: []` (drain-only), while retaining the schema, ownership markers, consumer and sweep for already enrolled jobs. Removing the runtime must never transfer those jobs to browser execution. A hard consumer pause preserves rows/holds; it does not mark work failed, refunded or cancelled. Never clear `request_json.outputDurable`, drop the schema, reset `attempt_count`, replace accepted provider IDs, or requeue uncertain paid work to restore service.

If a lease or storage write is ambiguous, inspect the original event/call/reservation/custody records. Known financial receipts may be reconciled once; unknown cost remains exposure. Resume only the exact accepted request with current authority. New paid work always requires new explicit authorization through the existing product contract.

## Verification

See `durable-generation-verification-2026-09-17.md` for exact selected commands and results. All provider transports in this branch's tests are synthetic, with inert credentials and real local SQLite transactions. No new live journey, hosted concurrency, provider invoice, deployment or durable platform acceptance is claimed.
