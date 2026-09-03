# Forma historical reservation follow-up — 2026-09-03 UTC

## Status

The two historical $1 slideshow reservations remain unresolved. No generation, generation retry, reservation release, or accounting override was performed in this follow-up. The native evidence-only reconciliation control was run once for each job; both returned **manual review required**, explicitly retaining the original request and budget hold.

The personal September ledger was inspected before and after these checks and remained $9.405443 settled plus $2 reserved. Stage A's separately measured usage is $0.425080; its previously authorized $1.50 claim remains the conservative allowance, not a second application reservation. Conservative task exposure is therefore **$12.905443 of the original $30 approval**. This follow-up added $0 in generation spend.

## Original records and correlation limits

| Job | Pending client request ID | Application execution window (2026-09-02, UTC) |
| --- | --- | --- |
| `01a0635c-684e-7d8d-85c3-c45a35d53879` | `forma-slides-e562184e-bc6a-4615-8a58-8bb0fcbd4e89` | 18:23:16.411–18:24:33.921 |
| `01a06362-78a3-7034-9b25-c1b77508b441` | `forma-slides-9b2e9a19-8477-401d-8650-09df886e9ee5` | 18:29:53.782–18:31:25.881 |

Fresh native receipts still showed `submission_unknown`, submission uncertainty, one known and one unresolved provider call, an executing $1 reservation, and no settled cost for each job. Those projected counts do not independently prove two requests reached the provider.

At the historical production-174 commit `2ebff51c9ae5cf70fe79e43a2841e24c09e05c34`, the adapter created a per-run client ID and supplied it through preflight to the Responses POST's `X-Client-Request-Id` header (`worker/openai-adapter.ts:1078–1092`). The application checkpointed the ID before dispatch (`worker/events-api.ts:1127`), then projected it into the technical error and exported receipt (`worker/document-jobs-api.ts:286–289`, `src/model/generation-inputs.ts:195`). These are intended provider-wire correlation IDs, **not proof that the requests arrived** and not idempotency keys.

**Correction to earlier phase language:** neither pending client ID is proven to be a repair request. A completed initial receipt can coexist with a stale pending marker if private receipt publication fails afterward (`openai-adapter.ts:1097–1106`, `events-api.ts:1072–1094`). Manual possibilities include the initial request with interrupted publication or a bounded repair. Managed possibilities also include a whole-work editorial rewrite (`managed-production.ts:667`). The historical exports do not bind client ID to initial/repair unit or exact response. Do not double-count the initial receipt as a separate unknown call without that binding.

The separate retained initial-response IDs are:

- Manual: `resp_0411cf166feaf2c7016a986997754087d29630eb42dfbd1818`
- Managed: `resp_04ddb189e1d3d3e9016a986b246f0887d28455aad3b3e2ebe1`

## Checks performed

1. **Native evidence-only reconciliation:** one `Check saved receipt · no generation` operation per exact original job, after inspecting its identity and technical details. Both returned operator/manual review required. No new generation was started; the final ledger was unchanged. This route can settle complete worker-owned evidence atomically, but did not find sufficient evidence here.
2. **Exact initial-response retrieval:** default-network attempts failed locally with `URLError`. A scoped network-approved attempt then made one official GET per initial response ID, with redirects and automatic retries disabled. Both returned HTTP 404 / `invalid_request_error`. The local existing API key's match to the original provider account/project was not independently established. Both historical and current builders use `store:false`. These 404s establish neither rejection nor zero usage, refund, or settlement.
3. **Lookup request IDs:** the new GETs produced `req_cc914b3efd2e4aac9bd6f49e2fe93b13` and `req_b76a16cec81645c78098c18e6efb3f4f`. They are retrieval-request IDs, **not original generation HTTP request IDs**. The local JSON receipts contain the exact retrieval timestamps and status codes.
4. **Publisher's read-only Sites logs:** a 450-minute errors query returned 20 events from 2026-09-03 01:12:06.182–01:38:20.037 UTC. The surrounding successful-event query returned 100 events from 01:32:06.235–01:40:49.544 UTC. Neither contained these job/client IDs or reached the original execution windows. The tool caps results at 100 and exposes no until/cursor/historical-version selector. No claim about a particular retention policy, original request absence, or billing follows from this result.
5. **Provider dashboard:** the existing browser session was logged out. The user was asked to sign in to the original account/project or supply attributable request logs. No new account/key or support case was created, and no source document or raw prompt was sent externally.

## Evidence required to close

Use the original provider account/project and client request IDs to establish whether/when each request arrived, its original HTTP and response IDs, terminal outcome, own attributable usage and billed amount, and whether another request followed the separately retained initial response. OpenAI documents logging supplied client request IDs on Responses and using them for support investigations. [Official request-ID documentation](https://developers.openai.com/api/reference/overview#debugging-requests).

The current app has no operator evidence-import surface. If external proof arrives, first review a narrowly scoped import bound to the original actor/project/job/call/reservation with idempotent reconciliation. Do not edit counters or receipt JSON, replay generation, release a hold on a 404, or attribute another call's usage to the unknown record.

The original task cannot be marked fully complete while these historical reservations remain unresolved. Exporter publication and QA can proceed independently within their approval boundary.

## Private local evidence

- `initial-response-get-results.json` — two locally blocked attempts, no successful provider contact established.
- `initial-response-get-network-approved.json` — two actual GET 404 results and new retrieval HTTP request IDs.
- This source-free summary and `provider-support-handoff.md` — no credentials, source text, speaker notes, or raw prompts.

No original evidence file was overwritten.
