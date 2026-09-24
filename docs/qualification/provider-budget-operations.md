# Qualification provider budget: implemented, not activated

The optional `STILL_CREATION_QUALIFICATION_RUN_ID` selects a durable admission run in the isolated target's D1. When unset, ordinary behavior is unchanged and this schema is never queried or installed. When set—even to an empty value—missing/expired/unapproved admission fails before provider fetch. Install the unjournaled `drizzle/candidates/still_creation_qualification_budget.sql` only through the reviewed target manifest. No production migration, provider credential, spending approval or activation is supplied by this implementation.

Every same-Worker creation embedding (maintenance and query), organizer including extraction, Jev rerank and split assessment reserves one attempt before its actual HTTP dispatch. A single atomic INSERT checks the exact installed counter trigger, run expiry, model, per-call serialized UTF-8 bytes/output ceiling, and every applicable full/canary aggregate/provider limit. The trigger consumes those limits in the same transaction. Partial installation or a different/no-op trigger fails closed. No full-run or canary reset happens when moving from canary to full: canary consumption remains in full lifetime totals. Limits cannot exceed $25 full / $5 canary, and must be set **lower** to the actual authorized provider allocation after hosting/scheduler costs are allocated separately.

Attempts contain only random attempt ID, run/provider/model/phase, integer reserved units/cost and timestamp. No request content, credentials or responses are stored. A timeout, provider rejection, malformed response, process crash, lost D1 result, or cancellation after admission consumes the reservation permanently. No automatic reconciliation/refund exists. A response receipt is not needed to spend the reservation. Stop the run with `authorized=0`; preserve ledger evidence. Do not delete/recreate rows or reset counters to retry. Admission cannot revoke an already in-flight request, which remains fully reserved. The run has one fixed start/expiry and a maximum 48-hour lifetime; extending it requires a separately reviewed authorization, not automatic renewal.

Legacy remote Fetcher inference is rejected under this flag because its internal provider fan-out cannot be metered here. Identity-only delete remains available, as does native cleanup after expiry/exhaustion/feature-off. This guard does not enroll a custody or authorize source disclosure; existing custody and policy checks still apply. It does not cap unrelated application providers, Sites/D1/R2/logs or scheduler charges. Isolated deployment and separately enforced hosting allocations remain required.

## Exact synthetic setup example (not live permission)

The following is a disposable local example, deliberately `authorized=0`, with two aggregate calls and a one-dollar provider cap. Hashes are dummy proof placeholders, not signed authorization. Actual operator setup must use final target/source/configuration/fixture/authorization/pricing artifact hashes, the approved start/expiry, exact account models and reviewed allocation table. Install all four limits for each provider used in canary (full aggregate + full provider + canary aggregate + canary provider). Missing rows fail closed. Full phase requires the two full rows. Use the same run ID for search capture, background maintenance and organization: the client capture ledger is an additional narrower guard, not an independent spend pool.

```sql
INSERT INTO creation_qualification_runs
(run_id,authorized,phase,starts_at,expires_at,authorization_sha256,pricing_sha256)
VALUES ('synthetic-example-only',0,'canary',unixepoch(),unixepoch()+3600,
        '0000000000000000000000000000000000000000000000000000000000000000',
        '0000000000000000000000000000000000000000000000000000000000000000');

INSERT INTO creation_qualification_limits
(run_id,scope,provider,model,max_calls,max_input_units,max_output_tokens,
 max_nano_usd,max_input_bytes_per_call,max_output_tokens_per_call,
 input_units_per_byte,input_nano_usd_per_unit,output_nano_usd_per_token)
SELECT 'synthetic-example-only',scope,provider,model,2,48000,0,
       1000000000,24000,0,1,20,0
FROM (SELECT 'full' scope UNION ALL SELECT 'canary')
CROSS JOIN (SELECT '*' provider,'*' model UNION ALL
            SELECT 'openai:embeddings','text-embedding-3-small');
```

`max_nano_usd` is integer nano-USD: one dollar is 1,000,000,000. OpenAI example rates are embedding20, organizer input400/output1600 nano-USD per token; Jev public scenario is input42/output0, **not an account-rate attestation**. `input_units_per_byte` must be a verified conservative integer bound for the account's billable units, minimum1. OpenAI input reserves full serialized UTF-8 bytes including organizer instructions/schema; output reserves the complete 16,384-token request ceiling. Jev billable-unit conversion and applicable rates must be established before authorization; do not populate assumed live values.

Per-call limits inspect serialized JSON, so a 24,000-byte raw embedding batch may exceed a 24,000-byte serialized cap (escaping/envelope). Such a request is held before fetch, never truncated. Freeze feasible limits and sufficient aggregate input allowance from exact dry-run payloads before live approval. Rates, models and per-call limits in matching full/canary provider rows must agree. No hidden retry is exempt.

Before any live dispatch, verify the target D1 supports the INSERT/RETURNING/trigger/schema-witness behavior in the compiled Worker, run overlapping canary admissions through the actual hosted binding, prove attempted exhaustion/expiry/partial migration prevents paid calls, verify provider invoices/receipts against conservative reservations, then retain the run rows with the capture. Local SQLite regression proof is not hosted billing enforcement qualification. No hosted scheduling, live model quality, performance, retention or cost has been verified by these tests.

Local regression command:

```sh
node --import tsx --test tests/creation-qualification-budget.test.mjs tests/creation-interpret.test.mjs tests/creation-search.test.mjs
```
