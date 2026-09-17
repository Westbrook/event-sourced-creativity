# Dormant Scene V6 policy and approval metadata

This increment reserves protocol version 6, family `canonical-scene-screenplay@1`, as an explicit review contract. It adds a dedicated policy reader, envelope compiler and Scene-only approved-campaign reader. It does not add Scene to the common sponsor policy/envelope unions, `readSponsorPolicy`, `compileSponsorEnvelope`, native admission, execution or Events dispatch. The actual generic admission entry rejects V6 before native database work. No route, initializer, environment switch, issuer or campaign enrollment is activated.

The source base is `c4c6a8937eace8e442bb317dd5ce2ac4a5abfff7`, composed from accepted Slides B `fea8cc16929c3b9c8abdc6d77b7e7879e9cb3eb3` and accepted Scene leaf/cancellation `d23e46244f4df6880e7cf419248e5277f55e9fd2` / `a7b7d1d3a17c054a9a1c63b439304d47d3195393`. Only `experience-sponsor-policy.ts` and `experience-sponsor-approval.ts` are existing production-file changes. Accepted native Scene evidence and ordinary Image, guest, Story and Slides runtime paths are preserved.

## Review data contract

`readSponsorScenePolicy` accepts one closed native Scene campaign template, canonical principal audience, explicit payer, finite campaign/resource limits and exact approval digest. `compileSponsorSceneEnvelope` additionally checks exact family/template, one planning call, no parsing/render/repair calls, no reference assets, actor-owned Document, separate actor and payer, source/rights/input digests, finite source revision and policy/resource lifetime. Native Scene bounds remain one Terra planning call, maximum 125,000 input and 3,000 output tokens, 128,000 total, and 1,000,000 microusd. The existing Scene template contract remains the source of exact route, model, pricing and policy values.

Dedicated policy/envelope inputs and V6 approval proposals use the accepted bounded own-data Scene snapshot before validation. Accessors, hidden fields and malformed structures refuse; subsequent validation, copying and hashing read only that capture. The immutable results are review data. Source/route/settings digests supplied to these pure functions are not genuine native proof, consent, publication authority or spending authority.

`compileSponsorApprovalProposal` explicitly accepts a V6 candidate for the existing payer-reviewed approval format. An internal payer-authenticated `approveSponsorCampaign` invocation still requires the exact reviewed terms digest and `APPROVE_SPONSOR_CAMPAIGN` confirmation. Tests invoke this only on disposable SQLite. This does not mean any real campaign was approved, or that approval metadata can activate an issuer.

## Scene-only approval reader

`loadApprovedSponsorSceneCampaign` captures the original Request, signal, URL/method/headers, env/DB identities and relevant configuration. It refuses cancellation before its first read and rechecks currentness after its owned awaits. It captures the actor's original 13-field native SQL row before native authentication, joins the actual authenticated principal and authorization snapshot to that original capture, and rechecks the same row in the final SQL proof. The in-memory join prevents changed-and-restored rows from leaving a different native actor in the result.

V6 payer approval captures the same 13 fields: the legacy 10 principal/access fields plus email, display name and consent timestamp. Existing versions continue using their original 10-field snapshots and predicate SQL. The Scene reader verifies current explicit payer approval, eligible actor/issuer, both current principals, active campaign, lifetime and pilot exclusion. Campaign JSON is bounded to 131,072 database bytes. Final proof uses the existing SELECT-only `outputProofReadStatements`, never the temporary INSERT/DELETE assertion helper used by older loaders. It checks dense own-data successful results and rechecks lifetime and request state before returning frozen data.

Positive qualification observes seven SELECT statements, maximum eight bindings, expression depth 100, function arguments 32, parameters 100 and SQL bytes 100,000. Rows, schema and `total_changes()` are identical before and after the reader. No grant, consumption, resource receipt, token hold or cost reservation is produced. The metadata assertions are ordinary inert data, not sealed native/runtime capabilities.

## Verification and preserved failures

The focused synthetic test file covers closed grammar and bounded immutable capture, pure proposal mutation, actual generic V6 refusal, disposable explicit payer approval/replay, Scene-only read success, disabled/revoked/expired/ineligible campaigns, actor and payer changes, final read cancellation/DB/header changes, malformed read responses, pre-abort refusal and actor-row changed-and-restored consistency. Independent pre-edit fixtures verify canonical policy/envelope bytes and digests for V1, V2, V4 and V5, approval bytes/digests for V2/V4/V5, and original V1 approval refusal. These fixtures were captured from the exact composed base, not regenerated from the changed code.

Independent review identified and preserved three initial failures: a native principal could differ from a changed-and-restored original row; and repeated Proxy property reads could change dedicated V6 values between validation and canonicalization, including actor/issuer lists in the explicit approval proposal. This successor joins original/native actor data and snapshots dedicated inputs before validation. Original logs/source pins remain in the handoff packet. These findings concerned inert metadata consistency, not demonstrated spending or read authority.

The accepted Scene leaf's 38 author plus 32 independent cases and 11 cancellation successor groups are reused, not rerun. No live provider journey, output generation, private-asset download, real approval, schema installation, permission expansion or financial mutation was performed. App-recorded monetary bounds are policy data, not provider invoices.

## Remaining integration

The separate native handoff proposal specifies distinct genuine admission, original Run and current dispatch proofs and a separate creative-actor/payer paid-claim adapter. That proposal still needs explicit scope review and implementation. This increment neither forges native WeakMap proofs nor recaptures source versions after failure. Broader server-owned generation remains deferred.

The existing native resolver's Scene asset/package refusal is accepted safe behavior, not a mandatory adoption gap. Actual retained Scene job, history, intake, Events and output-state aliases remain future integration work. No read-hook denial supplies authority to open them. This contract is not whole-plan completion, a live sponsor result or publication evidence.
