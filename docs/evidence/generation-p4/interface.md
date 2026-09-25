# Exact operation interface

```ts
import {createAuthoringStudyApproval} from './worker/authoring-commits.ts';
const handle = createAuthoringStudyApproval({proposals: serverOwnedProposals});
const response = await handle(actualAuthenticatedRequest, env);
```

This optional callable entry is not registered in `worker/index.ts`. The existing authenticated request boundary requires an HTTPS configured origin, a same-origin POST and a current eligible personal administrator from the trusted edge. Body size is limited to 2 KiB. Extra body keys are rejected. Both switches default off.

Preview and status:

```json
{"action":"preview","proposalId":"<64-lowercase-hex opaque ID>"}
{"action":"status","proposalId":"<same opaque ID>"}
```

Preview returns `{status:"review",display,displayHash,previewId,committable,newPurchases:0}`. Complete terms include the exact JSON source/direction bytes, declared agent authorship, protocol, full sealed plan, source/runtime/candidate/configuration/inventory/operation identities, principal, the derived approval inventory (private preview/evidence/copies and durable metadata), all typed private financial terms and proposed F3 policies. Missing evidence returns `committable:false`, `previewId:null`, and issues; it cannot commit. Preview retention is private and expires with the proposal.

Commit accepts only:

```json
{
  "action":"commit",
  "proposalId":"<opaque server proposal>",
  "previewId":"<retained preview>",
  "displayHash":"<entire exact display digest>",
  "intentId":"<server-owned immutable intent>",
  "decision":"APPROVE_STUDY_ACCEPT_UNKNOWN_EXPOSURE"
}
```

If both arms use bounded proof, the decision is `APPROVE_STUDY_BOUNDED_PROOF`. Any accepted-estimate arm requires the unknown-exposure command. These commands in `complete-chain.json` are **simulated fixture decisions**, never the user's financial consent.

Successful commit returns `{status:"committed",reused:boolean,receipt,newPurchases:0}`. Its source-free receipt contains `operation`, `version`, `classification`, `previewId`, `proposalId`, `intentId`, `displayHash`, `configurationHash`, `principalHash`, `planId`, `grantId`, `reviewId`, two `operationIds`, two `financialPolicyIds`, `expiresAt` and `newPurchases:0`. `status` returns the original receipt after current authorization, or `not-committed`, `unavailable` or denial; it cannot restore revoked authority. Lost acknowledgement has identical recovery semantics.

`db/authoring-study-approval.pending.sql` adds three optional tables and immutable/revocation triggers under `authoring_study_*`. It does not modify the exact P2 `generation_study_*` schema. The receipt is unique by preview, proposal, intent, grant, review and per-arm operation IDs. The side-effect transaction and final assertions are in `worker/authoring-study-approval.ts`; typed trusted evidence and operation types are in `worker/authoring-study-types.ts`. Server configuration, verified evidence metadata and their private contents must exist before the handler can approve. It creates none of those authorities itself.

The typed records share version, classification, kind, exact scope digest and full private terms. Fields cover: account/region/credential binding and optional project-header binding; reviewed estimate and expiry; liability owner/mode; settlement verifier/method/retention; lifecycle owner/reserve/funding identity/through date; deletion operator/method/through date; and optional substantive bound maximum/method/proof identity. Server owners are responsible for authentic evidence issuance. A self-sealed record or raw HTTP row JSON is not an approval.

The local demo's mock trusted edge and evidence records are intentionally synthetic. Its only HTTP actions reset a disposable case or call preview/commit/status. There is no HTTP provider-execution action, credential input, real target installer or generic grant factory.
