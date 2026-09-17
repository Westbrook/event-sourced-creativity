# Native Stable Audio source proof (dormant)

This increment supplies current native source and original recipe evidence for a future MP3-to-WAV sharing branch. It does not activate that branch, read media, create a share, alter a financial hold, or provide publication authority. Existing WAV/MP4/GLB exact-byte sharing and all existing source files are unchanged.

The implementation is `worker/native-stable-audio-share-proof.ts`. It is intended to sit alongside the already reviewed dormant `selected-output-share-mp3-projection.ts`, after current hosted identity has been established and before bounded native byte custody and complete sharing authority are composed.

## Contract

- `readNativeStableAudioRecipeProof(env, identity, selection, signal)` rereads the native current selection, content, receipt, edit, original completed job, execution ledger, and actual completion input. Its result is an opaque, frozen, process-local WeakMap identity. JSON, copies, proxies, foreign environments and caller SQL cannot create it.
- The closed selection names `output: "audio"`, the current Document/artifact/revision/content hash, source media hash, `sourceProfile: "forma.audio.instrumental-20.mp3@1"`, and `projectionPolicy: "selected-output-share-stable-mp3-pcm16-v1"`.
- `nativeStableAudioRecipeSnapshot` exposes a frozen trusted internal snapshot. It includes the private native URL and authorization snapshot and must never be serialized to a requester. It is not proof that the URL's bytes have been read or hashed.
- `nativeStableAudioRecipeAssertions` returns three complete server-authored queries: current native authorization/events/content/receipts, exact original input/current access, and exact original job/recipe/calls/storage acknowledgement. Every one must be included in the eventual caller's **same final SQL statement** alongside the complete sharing custody/authority/schema/candidate/live-share predicates.
- `assertNativeStableAudioRecipeCurrent` executes the complete current source proof. The consumer must still enforce byte ownership, public candidate identity, operation lifetime and final synchronous byte checks after awaited work.

The original source must be the actual current native MP3. A text edit preserving that media or an explicit current restore to it can qualify. A current authored WAV cannot fall back to the older MP3. This is a separate source/projection branch; it must not relax the existing exact-byte equality policy.

## Genuine original evidence

The helper reuses the actual `captureExperienceAudioEvidence`, `readOutputAudioPayload`, `verifyOutputAudioCalls`, `parseAudioMiniAppCostPreview` and `verifyExperienceAudioInput` grammar. It does not substitute the Document-only input guard for the Outputs producer format or reproduce the whole execution engine.

It binds the exact `forma.audio.instrumental-20@1` contract, fal `fal-ai/stable-audio-3/medium/text-to-audio`, original personal execution slot/grant/plan/preflight, original provider identifiers, planner response, and two original settled calls (three when planner repair was required). The app-recorded used costs and tokens must fit the original slot/grant caps. Those ledger amounts are not provider invoices. The original consent must have confirmed both generation and provider transfer. Reading that historical evidence grants no new transfer permission or purchase.

The retained input is the completion receipt's `input_ref`; admission's generation-receipt input is deliberately different in the fixture. The input's original normalized snapshot, standing constraints, source block versions, render receipt, calls and output request must match the job and completion evidence. This increment accepts the normal `server:document-job:render_document` producer. A recovered-job envelope without that original snapshot needs separate evidence and is deliberately unsupported here.

A completed original quote may now be expired. It remains historical evidence of the original paid invocation. Current source/input/job retention, native principal policy and operation deadlines govern this proof's present use. The eventual full sharing authority must additionally enforce its current admission and terms deadline.

## Bounds and final SQL

The whole helper has a 30-second wall and monotonic deadline and a real AbortSignal. Every database await races abort/deadline and checks affinity/lifetime before and after it. This stops late results from advancing but cannot cancel already dispatched D1 work. The completed source proof also contains the operation's wall deadline in its final SQL.

The input ceiling is 1,048,576 bytes, with the reused personal-content guard enforcing the stricter 1,000,000-byte limit. Each job request/result is limited to 131,072 bytes; the captured job/ledger witness is limited to 1,048,576 bytes; at most three calls qualify. The existing native readers retain their own bounds. Scalar vectors used for query packing are limited to 16,384 bytes. These are per-operation bounds, not an aggregate concurrency, CPU or query-scan guarantee.

The private SQL tokenizer only receives three fixed internal query templates and captured scalar values. Original authorization/events/source/receipt/input/witness strings remain separate unchanged binds with exact byte predicates. Packing removes an independently demonstrated D1 parameter overflow without discarding proof predicates.

**Required integration shape:** pass every complete proof leaf through `selectedShareProofStatement(allQueries, "balanced")`. Do not append another helper conjunction outside the existing outer predicate tree. The latter exploratory shape exceeded D1's expression depth for edited final reads.

Independent qualification captured actual existing sharing lifecycle statements and these actual helper queries for ordinary/configured-pilot identities, original/text-edited selections, and prepare write/final prepared read/commit write/final recipient read. All 16 balanced structural statements pass both the strict compiler limits (100 parameters, expression depth 100, 32 function arguments, 100,000 SQL bytes) and actual local workerd D1 `EXPLAIN`. Maximum: 82 bindings and 66,059 SQL bytes. These are deliberately different synthetic donor identities: this proves SQL structure, not a functioning MP3 lifecycle.

The independent review's frozen helper hash is `807cf0666530c28b417f92b6b8e7fa7dc7cc281abf8f648a05dc3d6ceb963414`; its review receipt hash is `634fedb8359a82aa825883a955e56a3a427f3c47926b34678eb5044b500ddeeb`.

## Focused verification and preserved failures

The synthetic fixture uses the canonical schema and real pure contract/receipt/event builders. It has no media bytes or objects. Fixture storage and asset operations throw, the database read wrapper is query-only, and network use is trapped in the relevant tests. Tests cover original/repair invocation, current text edit/restore, WAV fallback refusal, source/input/job/provider/terms mutation before and during final SQL, opaque affinity, forged signals, wall/monotonic and retention expiry, oversized input/job rejection, abort/late completion and the real stalled 30-second deadline. A focused test executes the actual helper against local workerd D1 and confirms a later input-byte mutation invalidates it; the caller is Node, so this is not Worker-bundle or HTTP-route acceptance.

Qualification history remains in the evidence packet:

- Before scalar packing, the configured-pilot text-edit commit would need 122 bindings; actual workerd rejected it. Packing and balanced composition repair that integration limit.
- An exploratory append-tree composition exceeded expression depth 100. The required complete-leaf balanced composition passes.
- A review-only flattened-query experiment was not adopted and is not required by the accepted contract.
- Initial fixture validation rejected a column-name regex that excluded digits in `sha256`; this was repaired before fixture acceptance.
- Initial helper code passed its full eight-field branch selection to the existing closed four-field native projector; that was corrected before source freeze.
- The first supplementary local workerd attempt in the normal sandbox stalled and was interrupted; the approved local-only retry passed. These are qualification failures, not new real-provider journey failures.

## Next integration reservation

After the root's recovery and publisher increments are sealed, request these exact existing paths together:

1. `src/model/selected-output-share-media.ts`: closed separate native MP3 source/public projection branch, preserving exact-byte WAV/MP4/GLB equality.
2. `src/model/selected-output-share.ts`: carry explicit source/public policy and identity in the existing closed candidate model.
3. `worker/native-retained-media-bytes.ts`: bounded owned current source bytes plus trusted projector, exact source hash and native recipe sample count (`sampleRate * 20`); preserve existing exact-byte attachment behavior.
4. `worker/selected-output-share-lifecycle.ts`: compose source recipe, native bytes, current authority and every final proof leaf; maintain exact candidate/public identity and revalidation after awaits.
5. `worker/selected-output-share-api.ts`: separately authenticated, purpose-bound prepared-candidate file read, recomputing the exact candidate with creation disabled.

`native-retained-media-custody.ts` and `selected-output-share-authority.ts` remain owned by the recovery integrator until explicitly released. Publisher UI paths are owned by their existing owner; no recipient UI change is included.

The composed caller must preserve the accepted byte/projection envelope: at most 1,000,000 source bytes, at most 20 seconds and 48 kHz mono/stereo, public PCM16 WAV at most 3,840,044 bytes, and the pinned decoder's fixed 16,973,824-byte memory. The exact recipe additionally requires `sampleCount === sampleRate * 20`; a merely shorter accepted MP3 is insufficient. Retain the whole-file operation's 30-second deadline and the decoder's stricter five-second cooperative deadline, finite ABI bounds and single-isolate decoder lease with no waiting queue. A fresh helper invocation must not extend the caller's existing deadline. Compose abort, retention and current authority deadlines, and check source proof access again after projection and final SQL. The final branch still needs aggregate buffer/concurrency accounting and cleanup/late-result tests; these individual bounds alone do not claim a total memory ceiling.

The future private `GET /api/selected-output-shares/:candidateId/file` must retain the previously reviewed design: candidate ID is a selector, never a bearer credential; actual hosted owner identity and an unissued/unrevoked/unminimized live exact candidate row are required; `Sec-Fetch-Site` must be `same-origin` with matching Origin if present; absent/none/same-site/cross-site are refused. It remains closed with creation disabled. The client port is purpose-bound to prepared candidate and projection identity, separate from the trusted current-source URL reader. It returns an owned copy of the deterministically recomputed public WAV only after complete final SQL and synchronous byte proof. No source MP3 response, client PCM authority, public token or persisted candidate file is introduced.

Final acceptance still requires single-donor native MP3 custody/projection/lifecycle/preview tests and qualification of the exact future frozen Worker artifact. None of those routes, authority changes, retained writes, public writes, provider calls, main merges or publications are performed by this new-only helper increment.
