# Dormant genuine-guest Image confirmation and preflight

This increment follows accepted first SAVE `a2745c253587fff9715335c6ce22bcc8ebab845b`. It implements the reviewed confirmation/preflight design and its explicit charged-claim addendum. No route, UI, schema initializer, campaign, guest policy, provider request or paid authorization is enabled.

`prepareGuestImageConfirmation` derives a bounded review from the real guest-owned native source and exact original SAVE. `confirmGuestImageRequirement` requires a fresh deliberate action with that exact review digest. `preflightGuestImage` reserves one finite preparation operation and constructs one initial unpaid native quote. `readGuestImagePreflight` returns only the original retained quote, or null for a proven unclaimed confirmed state. A charged claim with no original quote is unknown.

The actor remains the original bare `guest:<uuid>`. No `PilotUser`, canonical `OutputTrustedContext`, user row, account scope, spending permission or fake principal is created. Both existing guest proof purposes, source policy, session, source/private retention, native Memory exclusion, no prior claim lease and current payer approval remain required. Request, environment and database identity are captured and rechecked after awaits and at transactional/final disclosure boundaries.

## Exact native states

| State | Exact additional footprint after the original source at N |
| --- | --- |
| Saved N+1 | Original private SAVE event, native save command and its text-intake resource receipt. |
| Confirmed N+2 | One `OutputPlanConfirmed`, private native confirmed plan and deliberate-review envelope, native command, plan revision and one target; one immutable guest driver intent and a distinct confirmed-source text-intake receipt. |
| Claimed N+2 | Confirmed state plus exactly one immutable preflight driver stage and one preflight resource receipt. No quote exists. |
| Quoted N+3 | Claimed state plus one `OutputPlanPreflighted`, unchanged native `OutputPreflight`, native command and preflight row. Private metadata retains the actual transport descriptor captured when the quote was constructed. |

Partial, foreign, duplicate and unsupported tails fail closed. Every allowed row is independently matched to exact event/private bytes and deterministic bindings; matching an allowed key alone supplies no authority. There are no grants, authorization/run stages, consumptions, financial holds, jobs, provider calls, assets or results in these states.

The native plan uses revision 1, resolver `output-plan-v1`, source head N+1, fixed empty confirmation options and the real one-target Image recipe. The target object retains ordinal 1; the native target sidecar retains ordinal 0. Existing interpreted origins remain unchanged. The review binds the full native requirement, exact SAVE identity, source and requirements digests, campaign/session/source/release identities, compiled plan and target contract digest.

## Replay and consumption

Confirmation inserts its event, native sidecars, driver intent and distinct finite source-work receipt atomically. Replays return that exact original; they do not construct a second plan or resource receipt.

Preflight first atomically inserts its resource receipt and immutable stage. Only the original local request receiving a complete dense successful acknowledgement with the exact insert effects owns one construction. It consumes that permission before invoking the native quote helper. Reading durable stage metadata never recreates permission. Lost, sparse, false or failed reservation acknowledgements cannot initiate quote work; a retry may disclose only a fully proven original N+3 quote.

If quote construction or commitment fails after reservation, the claim remains charged and unknown. There is no refund, retry, renewal, new stage key or reconstructed execution permission. Lost quote acknowledgements may recover only the fully retained original quote. Configuration changes do not refresh stored quotes; their original native terms and actual non-secret transport evidence remain unchanged. Expired quotes can be read while source and authority are still current, with generation unavailable; this is no renewal or later spending authority.

The three preparation receipts are distinct: first SAVE text-intake, confirmed-source text-intake and preflight. Confirmed-source and quote operations meter the actual UTF-8 canonical native snapshot. Limits come only from the approved stored resource policy. These are application preparation counts and input bytes, not financial holds, provider usage, invoices, per-request rate limits or anonymous ingress protection.

## Correspondence and compatibility

The original first-SAVE witness is unchanged and remains strict at N+1. The new finite-stage witness repeats its qualified immutable-prefix, custody, schema and exclusion readers. Tests pin the accepted original witness SHA-256 `8893aee29f7658f011acb4961ad899f8c69823f6f8fe5389bfabc5030f9f4b71` and compare their AST correspondence. The explicit differences are a required complete dormant driver schema, removal of an unreachable empty-state validation branch, a separate four-state closure, and JSON row-object chunking for native plan sidecars within D1 function-argument limits. No existing assertion is rewritten to accept a tail.

The ordinary-file changes are the type of `preflightOutputImageSlidesTarget` and its two target-only helpers, and an export on the existing pure `providerInputInstructions` function. Its name, input, body and native call sites remain unchanged. Emitted runtime is identical after accounting for that single added export. Genuine native Image and Slides fixtures verify structurally compatible callers and exact offer parity. Canonical authorization guards and runtime behavior are unchanged.

Independent review reproduced a replay defect in the initial candidate: a coherently rehashed retained quote could substitute its creative target instructions. The repair compares retained instructions with that shared native pure formatter applied to the exact confirmed target. It does not rebuild the quote or consult current provider configuration. The original failing reproduction and passing repair are preserved in the review packet.

## Activation dependencies

This increment is dormant source code. Activation still requires separately approved actual policy/resource values and installation, deliberate guest review/authorization UI, ingress and read controls, complete private-tail retirement, and claim/adoption handling for the exact supported tail. The first-SAVE lease/retirement owner is qualifying N+1 separately; that retirement must continue refusing N+2/N+3 until an explicit extension is reviewed. Context-only custody claim is not context-plus-output/result adoption.

The original V1 intake-read schema qualifier is retained pending the separately coordinated, reviewed V1/V2 compatibility successor; this increment does not independently relax that family. No whole original-plan completion, real guest launch, paid-run acceptance, eight-journey repetition or requirement for the deferred server-owned generation architecture is inferred.

Validation passed 55 native confirmation tests, 65 native preflight tests, six native Image/Slides shape and type checks, and nine actual local workerd D1 cases. The maximum supported source fixture uses all eight currently reachable Image source events, 600 Chinese subject characters (1,800 UTF-8 bytes) and a 7,685-byte canonical source snapshot. Across absent/complete Memory and complete optional sponsor families, the largest qualified query used 88 bindings and 48,924 SQL bytes.

Application functions run in Node against actual local Miniflare/workerd D1. The pinned local engine enforces depth100, 100 parameters and 100,000 SQL bytes, but accepts a 34-argument JSON function; the separately applied approved compiler gate enforces deployment arity32 on every exact application SQL statement in the maximum fixtures. Test-table verification scans are excluded from that gate. Final harness assertions are recorded outside application rejection paths, and an explicit quote-entry counter proves a lost reservation acknowledgement performs no reconstruction. This is local D1 evidence, not a production database or provider journey.

Full types, scoped lint, CEM/localization and Vite build passed; the build retains its existing large-chunk warning. Validation and independent review are sealed separately in the existing progress report's `guest-image-confirm-preflight-evidence` packet. Historical failures remain there with their classifications, including sandbox loopback startup failures, the wrong initial local-arity assertion, test-harness strengthening and the repaired quote-instruction defect.
