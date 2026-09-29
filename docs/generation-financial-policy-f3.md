# F3 — Financial admission and completion decision packet

22 September 2026 · Local disabled implementation · No risk acceptance or live authority recorded

Two financial policies now have distinct code contracts. The original F2 result remains sealed, unavailable and false/null. A future server-owned grant can bind a separate policy to one exact operation. Neither a request flag nor a checkbox is authority. This work does not choose a policy, install a schema, publish a release or run a study.

| Question | Bounded-proof policy | Optional accepted-estimate policy |
| --- | --- | --- |
| What permits admission? | Reviewed evidence bounds the exact operation and its lifecycle, and the reservation covers that bound. | A reviewed estimate, its assumptions, a reservation and an explicit decision accepting unknown maximum exposure. |
| Is an estimate a maximum loss? | No. The bound needs independent evidence. | No. Maximum loss stays null; the contract rejects a finite maximum or claimed provider cap. |
| Must the provider guarantee a universal hard cap? | No. Evidence must substantiate the applicable scoped bound; no particular provider mechanism is mandated. | No. This mode expressly distinguishes the reservation from a provider cap. |
| What does a reservation do? | Holds account budget for the reviewed operation. | Holds account budget for the reviewed allowance; a single purchase may exceed it. |
| What happens after an uncertain submission or absent charge? | Keep the original hold. No replacement or next purchase. | The same. Accepting admission risk does not authorize buying while the original charge is unknown. |
| What happens on an overrun? | Preserve the whole charge and hold further purchases. | The same. No clamping or automatic extra authority. |
| Can known retention outlive operational completion? | Yes, with the explicit funded lifecycle policy below. | Yes, with that same policy. |

The unchanged default remains denial. There is no new enabled mode. The host accepts an optional server configuration `financialPolicies` plus `financialAccount`; admission additionally requires a matching immutable `generation_study_financial_grants` record. A self-sealed descriptor alone is not trusted. The old F2 path is retained for compatibility, including its false/null denial and original zero-residual completion rule; historical receipts are not silently opted into F3.

## Exact authority and implementation

`generation-financial-policy-v1` binds operation/plan IDs, image or preparation kind, complete request hash, prompt hash for image cells, source/direction hashes, runtime and inventory hashes, payer/account/region, cost basis, estimate amount/assumptions/evidence/expiry, operation and lifecycle reservation amounts, selected mode, explicit residual decision where applicable, lifecycle scope/owner/term, one in-flight operation, stop-before-next-stage/no retry, hold-on-overrun, and next-purchase eligibility only after settlement and funded lifecycle. Account identity comes from trusted server configuration, never the request. The future deployment must verify that this identity actually matches the selected credential and billing region; this task cannot establish that without real inputs/configuration.

The policy descriptor is content-addressed; the exact canonical JSON is bound in the server grant. Current principal, original H3 authority, private source/direction custody, mode, expiry and grant are rechecked before reservation and each provider stage. A transactional financial guard catches revocation at the reservation commit. A grant for another payer/operation/account/policy fails. Expiry cannot renew pricing evidence. Original provider intent remains irreversible, across grant/manifest changes and process restart.

Files:

- [Policy validation and server resolution](../evals/generation-reliability/native-host/financial-policy.mjs).
- [Host integration](../evals/generation-reliability/native-host/host.mjs), preserving actual access/retention checks and native budget helpers.
- [Reconciliation and server-only append seam](../evals/generation-reliability/native-host/financial-reconciliation.mjs).
- [Optional schema proposal](../db/generation-study.pending.sql), with exact [schema contract](../evals/generation-reliability/native-host/schema-contract.mjs). This is not registered in migrations or installed.
- [Host/DB financial tests](../tests/generation-financial-policy.test.mjs), using the extracted [native fixture](../tests/generation-study-fixture.mjs) and preserving the forty [H3 tests](../tests/generation-study-native.test.mjs).

No product runtime route imports this host. No paid-grant endpoint or invoice verifier is activated. `appendVerifiedReconciliation` is a server-internal seam, not a public ingestion API: only a trusted billing verifier may call it after establishing the classification, exact original provider request/receipt, liability scope and evidence. The host's public `reconcile` method accepts only the original IDs and reads server records; request-provided evidence/authorization is ignored. A production verifier and restricted write path remain deployment requirements. A hash proves content identity, not the truth of a bill.

## Completion is four separate questions

1. **Provider settlement:** Is the original purchase attributable and its final incurred amount verified? A usage-based estimate cannot establish this. Partial verified assessments remain append-only but do not finalize the native reservation. Final cumulative incurred totals may exceed the first receipt; prior known amounts cannot decrease. A lost acknowledgement or crash between token and dollar settlement resumes the same reservations idempotently.
2. **Artifact usability:** Did the existing host retain the artifact? This is independent of billing. Financial settlement can be known while the artifact is unavailable; this first implementation conservatively keeps such operations on hold. A retained artifact is not evidence of visual fidelity.
3. **Lifecycle obligations:** Are remaining known retention/storage/deletion/reconciliation obligations explicitly scoped, funded, assigned and still within their term? Their amount is not rewritten as zero.
4. **Next-purchase eligibility:** Are the above conditions satisfied, with no provider/token/lifecycle overrun or genuine remaining uncertainty? Every later arm still needs its own exact financial authority.

The original `generation_study_charges` row cannot be updated or deleted. Its null or positive `residual_exposure_microusd` remains visible even after a later assessment permits completion. `generation_study_reconciliations` links each verified cumulative assessment to that original receipt hash, exact policy, prior event, sequence, authority version and private evidence reference. Events retain final/partial provider status, cumulative incurred cost/tokens, remaining uncertainty (including null), known lifecycle amount, liability owner, scope, term and evidence. Same-ID retries require byte-equivalent content; competing chain extensions and changed retries fail. This is not an amendment to the general application ledger.

### Funded lifecycle policy

At admission, the same native D1 batch creates the original operation, token reservation, operation-dollar reservation and a distinct dollar reservation for lifecycle costs. It either commits all of them or none. The lifecycle reservation remains **active in native account counters** after operational completion, including in its original accounting period. That money is not available for another operation. It is not treated as a paid charge and is never double-counted as incurred usage.

A later verified assessment may declare the original provider purchase settled, no remaining unknown liability, and a known lifecycle obligation covered by that dedicated reserve. Only then can the operation complete while retention remains ongoing. The reserve has an explicit scope (including original financial evidence retention), owner, evidence reference, amount limit and coverage-through date. The policy is inadequate if indefinite or mandatory retention is omitted; current real lifecycle evidence is still missing. Funded completion is therefore demonstrated only with offline fixtures here.

Ordinary cost/token inserts continue to see original-purchase holds. A separate payer-wide lifecycle view/trigger also blocks new reservations when an obligation becomes unknown, exceeds its policy/funding, has an invalid binding, or outlives its coverage. The host checks this condition again at stage admission. A completed operation is not a permanent exemption from later exposure. Existing unfunded original purchases, older-period unknown jobs and external reservations are preserved.

The lifecycle reserve can be settled only after append-only verified closure records zero remaining obligation and the actual incurred lifecycle amount. Deletion attempted is not deletion verified. Early release helpers are rejected. Lifecycle actuals exceeding the reservation are retained in full and keep the payer on hold. Closure and final original-charge amounts cannot later be rewritten; a later billing dispute/correction requires a separately designed append-only adjustment contract and stays blocked here. There is no automatic provision renewal, cleanup schedule, dispute resolver, or reserve release on timeout. Known funded retention no longer locks the entire payer indefinitely, but the allocated money remains held until verified closure.

## Decision and evidence still needed

**No selection is requested or recorded in this implementation kickoff.** The following must become concrete before a later user decision and exact paid-operation authorization:

| Required item | Preparation operation (H4 owner) | Later image arms (H4/C/F2 with F3 owner) |
| --- | --- | --- |
| Complete current source and custody | Obtain exact source through its trusted owner path, preserve personal-admin/Memory/project exclusions. | Use actual eligible source and reviewed real direction; synthetic C is insufficient. |
| Exact request/stage inventory | Freeze current planner model/schema/request, max output, one POST, zero retries/image/evaluator. | New genuine C capture; exact before/after bytes and direct-image requests; one moderation + one image call per arm. |
| Account and cost basis | Resolve payer, credential binding, account/project/region and applicable pricing. | Refresh actual-byte estimates and account applicability for each arm. No old worksheet number is fresh pricing evidence. |
| Bound or accepted estimate | Supply bound evidence, or present exact estimate assumptions and unknown maximum for a separate explicit decision. | Independently choose and bind the applicable policy for each exact image operation. No inheritance from planner or publication. |
| Charge evidence | Establish authentic billing/receipt attribution; usage arithmetic stays an estimate. | Verify original request identity and actual incurred charges, including refusal/timeout outcomes. |
| Lifecycle | Inventory retention of source/request/response/financial evidence, storage, deletion, read/egress/compute work; name liability owner and funded term/limits. | Qualify artifact and evidence obligations including mandatory financial retention, not just the 30-day private artifact TTL. |
| Native integration | H4 uses the pure validator with its separate optional tables; preparation completion adapter remains closed. | F3 host/DB completion path is mocked and local; deployment requires a new source-bound envelope and actual authority. |

A later authorization packet must identify the chosen mode, exact operation IDs/bytes/stages/call count, relevant evidence versions, reservation split, explicit risk decision (if selected), expiry, stop/overrun/reconciliation terms and lifecycle owner. After the choice, schema installation, release, real grants and activation remain separate future scope. No acceptance is inferred from this document, report review, earlier publication or a passed test.

## Transfer ledger and limits

| Transfer | Named owner | Applicability | Test / evidence | Outcome metric | Status |
| --- | --- | --- | --- | --- | --- |
| Image native host admission/completion | F3 — Fix financial admission policy | Exact disabled direct-image cell and personal-admin authority | [F3 host tests](../tests/generation-financial-policy.test.mjs), [verification](evidence/generation-f3/verification.json) | Zero unauthorized/replacement mock submissions; null/positive receipt preserved; funded completion; unclamped overruns | Implemented locally, inactive |
| Preparation policy validator | H4 — Continue H provenance analysis, coordinated with F3 | Separate planner operation, source/request/config/inventory, separate grant | Pure preparation policy test; H4 separate [preparation modules](../evals/generation-reliability/preparation/) | Wrong operation/inventory rejected; no image authority reuse | Validator transfer implemented; native preparation completion/provision transfer pending |
| Ordinary payer reservations | F3 | Existing native cost/token reservation inserts in the same DB | Real native helper tests for original/lifecycle holds and funded eligibility | Unknown original cannot release; known funded lifecycle retains allocated funds | Mocked integration verified; schema uninstalled |
| Audio/video/3D/presentation/Storyboard | F3 contract owner; E3 — Continue E2/H baseline verification for cross-media coordination | Identity/reservation/reconciliation concepts only | No media-specific consumption, billing or fidelity study in F3 | Modality-specific costs, charge completeness and quality remain unmeasured | Pending separate modality qualification; image findings do not establish quality |
| Private Memory and administrator Replay | F3 boundary preservation; existing native owners retain authority | No activation or relaxed access/admission | Unchanged product imports/routing and old F2 denial tests | Zero activation; no replacement or broader private access | Existing restrictions preserved |

## Verification and handoff

All numbers in the F3 tests are explicitly offline fixture units, not current rates, estimates for the user's document, incurred live charges, or actual user acceptance. No provider credential was used, no provider inference occurred, and no production database was opened. The SQL runs against disposable in-memory SQLite through real native D1 adapter statements; this does not certify deployed distributed behavior or billing truth.

Run: `node --experimental-transform-types --test tests/generation-financial-policy.test.mjs tests/generation-study-native.test.mjs tests/sunburst-financial.test.mjs tests/image-financial-qualification.test.mjs`. Check the optional schema with `node evals/generation-reliability/native-host/check-schema.mjs`. Exact counts and source hashes are in [verification.json](evidence/generation-f3/verification.json); [test output](evidence/generation-f3/offline-tests.txt) is retained.

Base reread before edits: `882729f176a2f66ec7e10aeb90765ab89d3f6870`. H3 continuation delegated financial host/schema ownership to this task and kept its preparation schema separate. H4 and E3 are concurrently editing their own files in this shared workspace; this packet does not publish or claim completion of their work. Published H2/E2/H3 and F2 artifacts are not rewritten. Their source-bound envelopes remain historical; this new local implementation requires a new combined envelope before any eventual installation/release. The [canonical progress report](http://127.0.0.1:4187) keeps a separate F3 handoff and unacknowledged review card.
