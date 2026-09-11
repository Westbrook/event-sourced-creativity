# One-case managed-video accounting reconciliation

This is an explicitly authorized historical accounting exception, not a generic price override, refund, budget reset or provider retry. The existing Slides unknown-outcome hold-release operation is unchanged.

## Authority and treatment

The current existing principal administrator must own the exact personal job and both reservations. No project context, impersonation, pilot reservation, Output slot, consequential step or earlier disposition is admitted. No global flag or audience change enables broader accounting operations.

The immutable `VIDEO_TREATMENT` definition binds the original failed job, attempt, document, original August period, three call identities, scene, provider models, screenshot digest and byte length, authorization text and report708 reference. It fixes preparation at98,484microUSD and15,580tokens, video at operator-adjudicated zero, and unused capacity at19,545,516microUSD and136,420tokens. It does not claim independently provider-verified billing.

The original provider receipt, null provider billing field, failed job and retained source/media are not rewritten. The screenshot's two-decimal display remains evidence for a human-authorized decision, not a provider's exact zero-cost API receipt.

## Operation

Open the exact failed attempt in Activity → Inspect request and receipt → Inspect accounting → Review authorized correction. The separate correction section identifies the accounting decision and its consequences. Review the preview and acknowledge the exact treatment before Apply authorized correction.

GET `/api/admin/managed-video-reconciliation?jobId=…` is SELECT-only. It returns either a fresh one-case preview or the existing operation's verification. POST accepts only treatment ID/hash, current snapshot/evidence hashes and the explicit acknowledgement. All amounts and identities are server-owned. GET with the exact `treatmentId` separately verifies the persisted operation.

The caller and API must preserve the same current owner and authority snapshot before and after asynchronous work. The API rejects non-same-origin, oversized, malformed and extra-field requests. All route outcomes are exempt from retention scheduling. Inspection and failure paths neither bootstrap identity/schema nor call providers.

## Atomic correction

One D1 batch asserts exact installed schema/guards, authority/admission, immutable job/evidence, collection membership, ledgers and all four original-period counters. It subtracts the FULL original reserved amounts (152000tokens/19644000microUSD) and adds only actual preparation usage (15580tokens/98484microUSD) to both user and Forma-workspace counters. Hard limits, other reservations, other periods and `allow_user_overage` remain unchanged. Both reservations become settled.

The same transaction appends three separately attributed GenerationUsageRecorded events plus BudgetReleased and one immutable reconciliation record. Each write requires direct SQL `changes()=1`; post-state proofs execute before commit. No clamping hides inconsistent counters. The record and referenced reservations reject updates, deletes and replacement inserts.

The new migration0037 is schema-only. Its generated Drizzle metadata has journal index33 and snapshot0033; the SQL filename advances beyond the already shipped0036. No applied migration was edited. Runtime initialization is forbidden.

The initial transaction contains89 prepared statements before surrounding reads. Individual queries are below100 bound parameters and100KB. Cloudflare documents1000queries/invocation on Workers Paid and50 on Free; the synthetic adapter does not establish a hosted plan or D1 transport limit. A limit error must leave the batch atomic and lead to same-operation verification, never split financial writes or infer success.

## Replay and verification

Use the same immutable operation ID. An exact command replay reads the existing record; a changed command or competing reservation disposition conflicts. A missing or interrupted POST response is uncertain, not evidence of rollback. The client consumes the command before dispatch and never automatically resubmits; verify the original operation.

Verification checks record/treatment/command hashes, original-period conservation, exact reservation-after state and four event payloads, then reacquires current original-job/provider evidence and supported prior-usage membership. `transactionVerified` is distinct from current `verified`. Later counter activity or changed evidence requires review; it never causes another adjustment. Current verification requires the retained job to remain available and unexpired; a future historical-only verification path is not claimed.

## Qualification

Dedicated tests use in-memory SQLite, the actual reconciliation migration and event-stage trigger, reduced supporting schema and actual application functions. They cover success, all11write failure points/rollback, repeated commands, lost acknowledgement, prior-use/counter/authority/Output-slot races, exact scene/model, immutable-row attacks, malformed before-counters and HTTP boundaries. Controller tests cover explicit dispatch, independent GET verification, malformed/contradictory identities, stale ownership and persistent uncertainty. The existing read-only inspection tests remain separate.

Synthetic tests are not proof of production billing or a live adjustment. Only the actual authorized apply and separate persisted-record verification can close the accounting item. Do not retry the failed generation, issue a refund, widen access or reset September under this authority.
