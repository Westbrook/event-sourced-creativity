# Audited release of unresolved internal holds

This is an administrative capacity decision, **not provider settlement, a refund, or proof of a zero-cost request**. It does not send a provider request, repair a presentation, or change stored provider receipts. Deployment and execution require their own approval; implementing this code authorizes neither.

## Supported scope

One exact failed/canceled personal slideshow attempt per decision, signed-in principal administrator acting on their own account. Requires an active token reservation, an executing dollar reservation, zero used amounts on both, exact matching `BudgetReserved` evidence, and an unknown provider outcome. Project, pilot, consequential-execution and Output-slot bindings are rejected. An active impersonation or selected project context is rejected. Amounts and the immutable accounting month come from retained rows, never from a supplied dollar amount.

Both user/global dollar and token counters change in one D1 transaction with exact-state assertions, both reservation transitions, one append-only decision and one append-only event. A stale preview, authority change, missing counter or any partial write aborts the whole transaction. Reserved amounts are retained in the reservation records; only their status becomes `administratively_released`. Used spending/tokens and the job's request/result JSON remain unchanged.

## Installation and preflight — no adjustment

1. The Site owner integrates the reviewed commit into the current source, resolves competing migrations and runs the build/typecheck/regression suite. Do not overwrite another checkout's uncommitted work.
2. Keep `FORMA_HOLD_DISPOSITION_ENABLED` **unset**. Apply `db/operations/budget-hold-dispositions.sql` through the existing privileged database migration procedure. This idempotent operation creates only the audit table and its immutable guards. Runtime initialization includes identical definitions as a fallback, but the new read-only endpoints never initialize schema.
3. The Drizzle declaration describes columns and uniqueness; a generated table-only migration is insufficient. The shipped operation file is required for the triggers. Preview, apply and verification check the installed SQL definitions; missing or differently defined guards fail closed. Do not weaken this check to get a release through.
4. With the intended production account, request a preview. Its `schemaVerified` must be true and `applyEnabled` must be false. Retain the exact response privately. No source text or speaker notes are returned.

Endpoint: `/api/admin/budget-hold-dispositions`. POST requires JSON and the exact same Origin as Forma. Authentication uses the hosting platform's existing trusted identity; clients cannot choose the operator. Never manufacture identity headers or paste credentials into a request body. GET and preview perform only SELECTs, including authentication, and do not schedule retention/background work. An uninitialized schema returns a closed failure rather than changing state.

Preview body:

```json
{"action":"preview","jobId":"EXACT_RETAINED_JOB_ID"}
```

Review the owner, stream, document, attempt correlation, both reservation IDs, original month, token/dollar release amounts, counters, zero used-counter deltas and `previewSha256`. The preview hash is a state binding, **not approval**. Check the external evidence digest separately. Do not put source content or credentials in approval/support references or rationale.

## Separately approved execution

Obtain approval for those exact jobs and bounded total adjustment. Then the Site owner may temporarily enable `FORMA_HOLD_DISPOSITION_ENABLED=true`. This switch grants no generation authority and does not bypass administrator checks.

Use a stable unique `dispositionId` and preserve the exact command before submitting. The following is a shape reference, not an executable approval:

```json
{
  "action":"apply",
  "command":{
    "dispositionId":"UNIQUE_STABLE_DECISION_ID",
    "jobId":"EXACT_RETAINED_JOB_ID",
    "previewSha256":"64_LOWERCASE_HEX_FROM_FRESH_PREVIEW",
    "approvalRef":"REFERENCE_TO_ACTUAL_APPROVAL",
    "supportRef":"REFERENCE_TO_RETAINED_SUPPORT_RESPONSE",
    "reason":"Administrative release of internal capacity; provider billing remains unknown.",
    "evidenceSha256":"64_LOWERCASE_HEX_OF_RETAINED_EVIDENCE",
    "acknowledgement":"Release internal holds; provider billing remains unknown"
  }
}
```

Process jobs serially. After the first release, obtain and review the second preview again: shared counters changed, so its old hash is intentionally stale. Do not widen the approved amount/scope. On an ambiguous submission, stop and GET the same decision ID; do not create a new ID or launch generation. Exact duplicate commands are idempotent; altered duplicates conflict. A lost acknowledgment is recognized only from the exact durable command record.

Disable the flag after the approved adjustments. Keep the immutable table/guards in place even if application code is rolled back. Never undo this operation by deleting its audit, reopening a reservation or editing counters manually.

## Independent follow-up

GET `/api/admin/budget-hold-dispositions?dispositionId=EXACT_DECISION_ID` in a separate request. Persist the response and compare its `recordSha256` with the apply receipt.

- `transactionVerified` checks the original recorded deltas, exact reservations, immutable decision/event agreement and installed guards.
- `verified` additionally requires unchanged live job/attempt binding and provider evidence, no new financial audit for the attempt, consistent current reserved projections and unchanged settled counters.
- Unrelated later reservations may change current reserved totals. Any changed settled counter requires review—even legitimate later usage. This pass does not attribute such a change. Do not interpret `transactionVerified:true` alone as a clean live follow-up.
- `requiresReview` names any failed checks. Missing/changed evidence, counter drift or later provider evidence stops completion. Historical provider billing remains unknown even when every check passes.

The endpoint remains readable with the apply flag disabled. The stored receipt contains hashes of retained request/result bytes, not a second immutable copy of document content. Authenticated operator references/rationale remain private in the decision table; the ordinary event exposes only decision ID, digest and unknown-outcome classification.

If exact provider billing arrives later, preserve the original unknown receipt and administrative decision. Ordinary reconciliation, retry, cleanup and settlement must not reopen or debit the disposed reservation. Any later charge needs a **separate reviewed correction linked to this decision**, not a fabricated original settlement. That correction workflow is outside this capacity-release operation.

## Local verification

```sh
npm run typecheck
npm run build
node --experimental-strip-types --test tests/document-reservation-recovery.test.mjs tests/cost-budget-ledger.test.mjs tests/outcome-telemetry.test.mjs tests/presentation-private-receipts.test.mjs
```

Tests use synthetic SQLite fixtures and fake provider boundaries, not production records or paid calls. Native PDF/PPTX acceptance and administrator visibility of an existing stored response remain separate work.
