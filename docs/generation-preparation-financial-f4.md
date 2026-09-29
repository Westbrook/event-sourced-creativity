# F4 — Disabled preparation financial integration

22 September 2026 · Base Production 519 (`fd714354d3b2f5a963ca6e104bc3ea0d69a7176d`) · Local only

F4 connects H4's original preparation identity and pending tables to the published F3 validator and reconciliation semantics. It removes the unconditional payer-unique dead end only after qualified settlement and retained usable content. No financial policy has been selected, no live authority exists, and neither pending schema is installed. This was an inactive integration gap, not a production outage. Published H4/F3/E3 and sealed F2 false/null evidence remain historical evidence.

## Billing producer feasibility — unresolved live binding

**No authorized producer of final, request-attributable incurred billing evidence was established.** This is a finding about the available contracts/evidence, not a claim that no such producer could exist. No live billing account or admin credential was accessed, and no authentic billing fixture was supplied.

| Available producer/evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| H4 transport response checkpoint | Original request ID, response ID/model, raw receipt hash, HTTP status and allowlisted usage before private custody | Incurred dollars, final billing, credential-to-account attribution or all infrastructure liability |
| Existing native provider financial checkpoint | Durable observer-reported fields pinned to a paid call, and original-only recovery | Independent authentication of provider billing; the generic field name `costMicrousd` is not F3 incurred-charge evidence |
| F3 append seam | Immutable original charge binding, cumulative chain/finality and idempotence | Truth of the caller's asserted bill; F3 explicitly delegates that to a trusted billing verifier |
| Current OpenAI Costs API documentation | Daily cost buckets, group/filter dimensions including project, line item and API key, amount/currency | The documented schema provides no original request ID or explicit request-level settlement-finality field |
| Current OpenAI Usage documentation | Aggregated token/request counts with project, user, API-key, model, batch and service-tier grouping | Verified incurred dollars or final request-level attribution |
| Current H5 coordination | Source/configuration and any actual operation remain unqualified; H5 owns a separate disabled freeze adapter | A real operation inventory, complete account/project/region/credential binding, request or paid grant |

Official sources inspected on 22 September: [Costs reference](https://developers.openai.com/api/reference/python/resources/admin/subresources/organization/subresources/usage/methods/costs), [Usage reference](https://developers.openai.com/api/reference/python/resources/admin/subresources/organization/subresources/usage/methods/completions). **Inference from those schemas:** aggregate rows alone cannot prove this original request's final liability. No invoice guarantee, attribution by subtraction, or zero-charge refusal/timeout is assumed. Public infrastructure price tables similarly do not establish the selected Sites account's attributable bill.

The missing binding is an authenticated billing producer/version and private evidence linking the immutable original operation/request/response receipt to the resolved payer, credential account, project header (including an explicitly verified null), region, cumulative incurred dollars and tokens, completeness/finality, and remaining uncertainty. Lifecycle evidence separately needs actual obligation scope, owner, funded term/amount, mandatory financial retention and verified closure/actual expense. Account selection and billing attribution are different facts.

`createPreparationFinancialWriter` is an implementable server-internal seam with **no default verifier**. Construction requires `verifyEvidence`; each append supplies the original binding and exact record hash, and accepts only independently verified incurred classification. Production must restrict construction and all three financial-table writes to that trusted server principal; there is no HTTP/UI ingestion route, installer, executable CLI or grant API. The public host `reconcile` reads stored records and ignores request-supplied evidence. A callback returning true, a content hash, a successful custody write or a synthetic fixture is not proof of authentic billing. Repository tests explicitly inject a synthetic verifier.

If the real producer cannot establish request-level attribution/finality, keep the original purchase and payer held. The existing accepted-estimate policy accepts uncertain maximum **at admission**, not unknown-charge settlement. Changing that rule needs a separate explicit policy design, tests and decision evidence; F4 does not implement or accept it.

## Narrow implementation

- H4's native admission batch creates token, operation-dollar and distinct lifecycle-dollar reservations together. Failed admission rolls back all three and operation state. Native user/workspace counters and no-overage behavior remain authoritative.
- Preparation has an immutable original charge row and an append-only cumulative reconciliation/provision chain. The F3 functions use an allowlisted `preparation` binding; there is no second policy validator or new general ledger. Partial amounts, original null/positive residuals and full overruns remain visible.
- Idempotent native token/dollar settlement resumes the same IDs after partial completion, process restart or lost acknowledgement. Final original uncertainty must be exactly zero before either preparation reservation can settle. Original operation identity cannot be repeated after completion, under a new grant, or after expiry.
- A known funded lifecycle reserve remains active and counted in its original native budget period after operational completion. It is reserved budget, not incurred usage. Expiry, new uncertainty, overrun or invalid obligation binding blocks new token and dollar reservations. Lifecycle closure requires its own verified zero-remaining-obligation evidence and actual expense; cleanup attempted and elapsed time never release it.
- The image and preparation hosts share the existing external-purchase inventory. The image host qualifies the exact optional preparation schema when present; absence remains compatible with published image-only fixtures. Qualified completed lifecycle reserves are the only excluded active cost reserves. Pending originals and external paid calls still block both directions.
- Private content access, personal-administrator/pilot exclusions, Memory boundary, original-only bounded recovery and production routing remain unchanged. Usability/direction hashes come from the existing bounded parser, independently of financial settlement. Reconciliation checks current custody metadata and authorization without adding unbounded raw-response reads; actual recovery retains its two original-read slots and verifies bytes.

Files: [adapter](../evals/generation-reliability/preparation/financial-adapter.mjs), [preparation host](../evals/generation-reliability/preparation/native-host.mjs), [pending schema](../db/generation-preparation.pending.sql), [shared F3 semantics](../evals/generation-reliability/native-host/financial-reconciliation.mjs), [cross-host guard](../evals/generation-reliability/preparation/external-guard.mjs), [tests](../tests/generation-preparation-financial.test.mjs).

## State and next-purchase decisions

| Original billing | Content / direction | Lifecycle | Financial transition | Next distinct purchase |
| --- | --- | --- | --- | --- |
| Unknown or partial | Usable; human review pending or approved | Fully funded | Preserve original token/dollar holds | Denied |
| Final verified, no original uncertainty | Unavailable, expired or access lost | Funded | Settle same original IDs; preserve receipt | Denied: unchanged conservative artifact-dependent policy |
| Final verified, no original uncertainty | Retained usable, direction digest present; human review pending | Known, funded, unexpired | Settle purchase; lifecycle reserve remains active | Financially eligible only with separate exact grant; human fidelity gates still prevent treating direction as approved or advancing the real image study |
| Final verified | Retained usable | Unfunded, overrun, expired or uncertain | Record full incurred amount; retain exposure | Denied |
| Final verified | Retained usable | Verified closed with actual expense within provision | Settle lifecycle exactly once | Eligible subject to separate authority; original preparation can never repeat |

Financial settlement, content classification, retained direction and human review are separate reported facts. `humanReviewed:false` never changes as a side effect of financial completion. This task adds no human-approval writer. Allowing a next purchase despite unavailable original content would be a separately reviewed refinement; no such refinement or decision was made.

## H5 inventory and future decision packet

H5 owns actual source/configuration capture and the concrete future proposal. F4 is sole owner of preparation host/schema and financial tests; E4 owns separate baseline triage. Their readiness status was coordinated without external messages. Required inventory remains one planner POST, zero moderation/image/checker/evaluator/retry/repair/provider retrieval, one private source/request/raw-response copy each, two bounded original recovery reads, and one cleanup attempt. H5 subsequently identified **two additional private acquisition rows (source and producer receipt), each bounded to 1 MiB**, before H4's three copies. Their lifetime is the minimum of native retention, 30 days and all fact deadlines, including inactive facts. H5 has no deletion/cleanup adapter: expiry prevents reads but does not prove deletion or eliminate storage liability. Its eligibility reads are additional DB reads, separate from H4's recovery slots. These are an explicit unresolved combined-inventory binding gate; the H4 static inventory and synthetic F4 grants do not cover or price them by implication.

Add original financial receipt, append-only assessments and lifecycle evidence retention, native accounting and authorization queries, reconciliation compute/read/storage, and mandatory retention/deletion obligations to the exact future financial inventory. Row counts are not billed scanned-row quantities; neither infrastructure maximum nor ongoing liability is fabricated as zero.

Future gates, all still open: eligible exact source and effective configuration; current selected account terms and complete inventory; authentic original billing producer and lifecycle verifier; reviewed estimate or bounded proof with separate policy decision; exact one-operation grant; separately reviewed schema installation/release/activation and source-bound envelope. No completed release needs repeating. One later authorized planner result still stops for original reconciliation and human source-fidelity review before C/image-study work. See the [F4 cross-media ledger](generation-cross-media-transfer-f4.md).

## Verification and handoff

All amounts, acceptance records and bills in tests are **synthetic**. They qualify disabled control flow using disposable SQLite and real native D1 adapter statements, not real provider billing or deployed distributed behavior. No live operation was attempted. [Verification receipt](evidence/generation-f4/verification.json) records final checks and file hashes; [raw test output](evidence/generation-f4/offline-tests.txt) retains the results.

Canonical [progress report](http://127.0.0.1:4187/) has only F4-owned additions/updates through its atomic helper. Prior review acknowledgements and other owners' entries are preserved. Next action is to review the disabled integration and resolve the actual evidence-producer/account/lifecycle gates with H5; do not infer policy acceptance, installation or paid authority from tests or report review.
