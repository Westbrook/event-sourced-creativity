# Original unresolved slideshow calls

This is an operator handoff, **not a settlement or authorization to retry**. The repair has not submitted another provider request or released either hold.

## Exact cases

Both jobs target document `bfd43f77-b57b-49a7-9291-705dec323ed5`, revision `rev-1v4zjth`, with six slides and recorded model `gpt-5.6-terra`.

| Job | Mode | Started (UTC) | Failed (UTC) | Recorded reservation |
| --- | --- | --- | --- | ---: |
| `01a0635c-684e-7d8d-85c3-c45a35d53879` | Manual | 2026-09-02 18:23:16.411 | 2026-09-02 18:24:33.921 | $1.00 executing |
| `01a06362-78a3-7034-9b25-c1b77508b441` | Presentation editorial team | 2026-09-02 18:29:53.782 | 2026-09-02 18:31:25.881 | $1.00 executing |

These timestamps and modes come from the supplied saved receipts, not inferred provider completion times. Both report attempt count 1. The elapsed durations do not establish a timeout.

The cited saved exports also retain these exact **application client traces** in `technical_error.requestId`:

| Original job | Exported client trace |
| --- | --- |
| `01a0635c-684e-7d8d-85c3-c45a35d53879` | `forma-slides-e562184e-bc6a-4615-8a58-8bb0fcbd4e89` |
| `01a06362-78a3-7034-9b25-c1b77508b441` | `forma-slides-9b2e9a19-8477-401d-8650-09df886e9ee5` |

Verify each against the original current checkpoint before escalating. These are not provider response IDs, proof of acceptance, or provider-supported idempotency keys. The saved exports do not bind them to a particular call phase. Both exports have empty `request_receipts`, `frozen_inputs`, and `failures`, and `private_input=null`; they contain no provider HTTP/response IDs or per-call usage/tariff evidence. The private-input flag alone does not distinguish unavailable, unauthorized, expired, or erased bytes. Review retained evidence only through its existing custody checks. These saved files therefore cannot settle the holds by themselves.

The old projections contradict themselves: `provider_request_status=submission_unknown` and no settled cost coexist with `provider_submission_uncertain=false`, `unresolved_provider_call_count=0`, and an asserted complete breakdown. Those zeros/flags are not proof that the pending repair was free, rejected, or completed. A retained initial response likewise cannot settle its subsequent repair.

Last observed total accounting was $9.405443 charged plus these $2 holds, or $11.405443 exposure under the original $30 total approval. Refresh the ledger before any action; do not grant a new $30 allowance.

## Fresh version 179 inspection

An authorized inspection from a fresh version 179 tab found additional retained evidence that the older saved exports above did not show. This was inspection only: no reconciliation or generation was run, and no hold was changed.

| Original job | Retained planner response ID | Additional exact trace |
| --- | --- | --- |
| `01a0635c-684e-7d8d-85c3-c45a35d53879` | `resp_0411cf166feaf2c7016a986997754087d29630eb42dfbd1818` | Request event `01a0635c-7399-7f73-96cc-816dcb4f92d3` |
| `01a06362-78a3-7034-9b25-c1b77508b441` | `resp_04ddb189e1d3d3e9016a986b246f0887d28455aad3b3e2ebe1` | Original client trace above still matches |

Both current receipts expose their retained frozen source/request under existing private custody checks and report `private_input_available=true`. Their source snapshot hash remains `eb7cce6143f1dcdacd2990c5bc8bacd5597dbce0bf927faa00e1fd322a86b2e4`. The response IDs above come from `artifact_checkpoint.planner_response_id`; the manual checkpoint reports `planner_input.validation.provider_call_count=1` and the managed checkpoint reports `planner_input.provider_request_count=1`. The manual checkpoint's plan is null.

The fresh projections report one known call, one unresolved call, `provider_submission_uncertain=true`, an executing $1 reservation for each job, and no settled amount. Neither inspected receipt provides the unresolved call's own usage, frozen tariff, or provider HTTP request ID; their failure lists are empty. Empty failures are not proof of rejection. These retained planner responses help correlate the initial calls but do not prove the later repairs completed or were rejected. The combined $2 remains unresolved.

The old export's missing private input is therefore an export/view limitation, not evidence that the original source was erased and later restored. Keep the older files unchanged as historical evidence; use the fresh authorized receipt and exact IDs when escalating. Do not infer completion, refund, zero usage, or permission to resend from improved visibility.

## Settled rejection is not unresolved spending

A fresh version 179 document view incorrectly places the fully settled rejected job `01a06354-3e5c-7f38-9046-ad08c98cab43` among unresolved-accounting next actions. The classifier interprets `provider_request_status: submitted` as a settlement verdict. The worker intentionally retains that status after provider contact when no artifact completion event exists, including a fully paid validation rejection.

The local follow-up changes only next-action classification: a submitted document Slides job with explicit settled status, a safe nonnegative measured cost, a safe positive call count, zero unresolved calls, false uncertainty and a complete breakdown becomes ordinary inspection. Missing, redacted or conflicting evidence stays unknown. Explicit submission uncertainty and active/unknown holds remain unresolved. The original reservation amount may remain in a settled receipt as admission history; it is not evidence of an active hold. This does not rewrite receipts, release reservations, retry work or create recovery permission.

Focused lifecycle/guidance verification passes 54/54, with build/typecheck/lint passing. A broader related run has 25 fixture failures; the same 25 reproduce in the two affected suites on a pristine `7eb914d` archive (seven stale format-count expectations and eighteen missing fixture `_retireRequestReview` methods). These are recorded separately, not represented as a green full suite. The classifier follow-up is not yet deployed and requires separate release inclusion approval.

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
