# Guest Image historical stages and unclaimed private-tail retirement

This dormant slice adds a distinct historical inventory for an original guest Image after confirmation. It also retires the original unclaimed SAVE, confirmation and optional quote private bodies once the original guest source is due. It does not activate guest routes, transfer a quote, claim a Document, purchase another operation or generate an output.

The base is R9 `c304af00b0ddcd9ba307d63463cceaaf651293ca`, containing main `5bb107929e0d607676ce6029ffd50b156176fe18`. The strict N+1 inventory, claimant, lease and claimed-output retirement remain unchanged. The existing N+1 unclaimed retirement delegates its source/SAVE collection to a shared helper while retaining its own closure and mutation. The live confirmation/preflight witness delegates only pure value construction and validation; its request, payer, captured clock and state-transition authority remain with the live caller.

## Retained inventory

`inspectGuestImageStageInventory(request, env, { proof })` requires both genuine original guest proof purposes, intact retained source/SAVE/stage bodies and the original future source deadline. It accepts exactly:

| State | Original graph | Resource history |
| --- | --- | --- |
| `confirmed` | N source events, SAVE at N+1, confirmation at N+2, two commands, one plan/target and driver intent | Distinct SAVE and confirmation text-intake receipts |
| `preflight-claimed-unknown` | Confirmed graph plus the original driver preflight reservation; no quote event/command/index | The two text receipts plus one preflight-construction receipt |
| `quoted` | Reserved graph plus the original quote at N+3, its command and preflight index | The same three receipts |

The inventory has its own opaque identity, immutable review manifest and exact SQL graph proof. It cannot be passed to the strict N+1 claimant or a live execution function. The public summary contains IDs, heads, historical state, source expiry and manifest digest. An internal DB-bound accessor retains the private evidence for a future separately qualified custody writer.

The recorded payer/approval and finite resource receipts remain original history. Production approval revocation and current provider configuration do not rewrite that history. A quote may already be expired while its body remains valid historical evidence. It is never returned as current claimant authority. Any future canonical Create requires deliberate reconfirmation and a matching native preflight under actual canonical authority and terms.

## Due original-tail retirement

`retireExpiredUnclaimedGuestImageStages(env, { sessionId })` accepts no caller-selected body IDs, deadline or SQL. Due means `experience_guest_sources.expires_at`, independently checked in the atomic write proof. It updates only `event_private_payloads.private_json` and `redacted_at` for the original SAVE/confirmation/quote event IDs. Original source rows and prefix bodies, public events, commands, plan/target/preflight indexes, driver/resource receipts, payer approval and counters remain intact.

Cleanup works with a retained source plan or exact original source tombstones. Where retained committed bytes exist, they are checked. Once erased, those bytes remain unknown; native immutable associations permit only due erasure, never recovered content. Existing canonical empty tombstones retain their timestamps. New redactions use the DB clock after the original deadline. Atomic before/after proofs and one final read resolve lost acknowledgement without a second mutation.

Any claim lease, completed custody mapping, unsupported output/result/provider history, Project/sharing association or native Memory provenance closes this unclaimed scope by refusal. The separate completed-claim cleanup path is unchanged. Extra, missing, malformed or oversized stage rows never count as an empty stage. Whole supported native V1 or V2 schema families are qualified independently; no schema is installed by these functions.

The live writer's request-local clock plus grant-lifetime ceiling was not independently persisted. Historical checks use the recorded policy/resource/session/source bounds, original timestamps and native quote duration. They do not manufacture that old clock. The extracted live code continues to enforce its actual captured ceiling.

## Scope and next stage

This slice does not add a private-content kind or modify generic content hydration. A future historical-copy kind needs an explicit exclusion from ordinary `loadPrivateContent(..., 'all')`, which admits new kinds unless excluded. Its dedicated reader must join the immutable stage mapping, exact current canonical custody, private body identity/digest and native expiry after the final await. Canonical history copying, stage claim mapping/lease and completed-claim tail cleanup require that separate implementation and review.

The original guest source expiry, original quote expiry and future canonical copy retention are distinct. An unknown charged construction remains unknown. Resource operations/bytes and quoted application maxima are not provider invoices or evidence that paid generation occurred. No generated-result custody or whole-original-plan completion is implied.

Focused qualification and immutable source/test/evidence pins are retained in the independent project report workspace under `guest-stage-history-evidence`. The established deployment owner controls main/publication; source acceptance here does not imply deployment.
