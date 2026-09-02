# Original unresolved slideshow calls

This is an operator handoff, **not a settlement or authorization to retry**. The repair has not submitted another provider request or released either hold.

## Exact cases

Both jobs target document `bfd43f77-b57b-49a7-9291-705dec323ed5`, revision `rev-1v4zjth`, with six slides and recorded model `gpt-5.6-terra`.

| Job | Mode | Started (UTC) | Failed (UTC) | Recorded reservation |
| --- | --- | --- | --- | ---: |
| `01a0635c-684e-7d8d-85c3-c45a35d53879` | Manual | 2026-09-02 18:23:16.411 | 2026-09-02 18:24:33.921 | $1.00 executing |
| `01a06362-78a3-7034-9b25-c1b77508b441` | Presentation editorial team | 2026-09-02 18:29:53.782 | 2026-09-02 18:31:25.881 | $1.00 executing |

These timestamps and modes come from the supplied saved receipts, not inferred provider completion times. Both report attempt count 1. The elapsed durations do not establish a timeout.

The old projections contradict themselves: `provider_request_status=submission_unknown` and no settled cost coexist with `provider_submission_uncertain=false`, `unresolved_provider_call_count=0`, and an asserted complete breakdown. Those zeros/flags are not proof that the pending repair was free, rejected, or completed. A retained initial response likewise cannot settle its subsequent repair.

Last observed total accounting was $9.405443 charged plus these $2 holds, or $11.405443 exposure under the original $30 total approval. Refresh the ledger before any action; do not grant a new $30 allowance.

## Safe inspection and escalation

1. Under the original current actor/project authority, select the exact job in Activity. Review its private retained candidates and Inspect inputs. Preserve the original receipts and failures; do not select retry or new generation.
2. After the approved repair deployment, use **Check saved receipt · no generation** for the selected job. The legacy reconciliation branch makes no provider request. Complete, exact, immutable per-call evidence may settle the matching original reservations atomically; insufficient evidence returns `operator_required`, zero submitted requests, and retained holds.
3. For each unresolved call, collect only existing evidence: its client request ID and phase, requested model, request digest, submitted/received timestamps, provider HTTP request ID and response ID if retained, terminal status, own usage, and frozen tariff. Keep initial and repair identities separate. Do not invent an ID from the job ID or assume client IDs provide provider-supported idempotency.
4. Ask the configured provider account/project operator or provider support to correlate that exact request against retained request/billing logs. Supply the time windows above and existing trace IDs through the provider's authorized support channel. Avoid exporting the source document or raw prompts unless specifically necessary and authorized. An aggregate daily usage total alone cannot attribute usage to either pending repair.
5. Require attributable terminal completion/rejection and usage evidence before changing accounting. Preserve unknown status if the provider cannot establish the outcome. Do not fabricate zero usage, release either hold, resend the request, or switch models to test whether it succeeds.

The local reconciliation route only consumes evidence already retained by the application. It does not fabricate an external lookup or expose an operator override. If verified provider evidence must be imported, first review a narrowly scoped evidence-import procedure bound to the original call and reservation; do not directly rewrite historical receipts or counters. This remains an explicit unresolved dependency, not a claimed implemented import feature.

## Closure criteria

- Each paid call has attributable terminal evidence and its own usage/cost; no unresolved call is concealed by an initial response.
- Original token/cost reservations, usage counters, audit events and receipt projections agree, including after reload or repeated reconciliation.
- No duplicate provider request, source edit, podcast/video rerender, or automatic draft promotion occurred.
- If those facts cannot be established, retain the holds and report the case as unresolved. Completing a separate native slideshow does not resolve these two historical calls.

Source evidence: the user-supplied `slides-uncertain-receipt.json` and `slides-structured-uncertain-receipt.json` in `/private/tmp/forma-benefits-bfd43f77/`. Relevant sanitized facts are preserved here because that temporary evidence directory may disappear.
