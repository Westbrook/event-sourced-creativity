# Dormant Audio V8 policy and payer review

This increment adds a closed V8 policy/envelope and a separately authenticated payer-review path. It does not enable a campaign, register a route, grant Audio intake or passive reads, run a provider, or establish production acceptance. The default sponsor policy remains disabled. Native admission, Run, dispatch and original accounting use separately owned opaque proofs; compiled JSON and matching hashes cannot replace those proofs.

Source base: `c304af00b0ddcd9ba307d63463cceaaf651293ca`. Reserved preimages are `worker/experience-sponsor-policy.ts` SHA-256 `8c7e59874ae970ab3afbe6db9d17731e966458cd193ef7b1e5338145ef0cee0a` and `worker/experience-sponsor-approval.ts` SHA-256 `7941aef9fb6044d92678bcb2122ce951e16f4ffa2731dea4429a2d92c21e907b`.

## Policy and envelope

`SponsorPolicyV8` uses `canonical-instrumental-cue@1` and the accepted native Audio template: one instrumental track, a requested twenty-second duration, one initial planning call, at most one bounded repair, one Stable Audio render, and 128,000 shared tokens. The existing native pricing functions supply the reviewed ceilings; they are application estimates, not provider invoices. Source files transferred remains zero. The template fixes MP3, the safety checker and the no-vocals negative prompt.

`readSponsorAudioPolicy` and `compileSponsorAudioEnvelope` are the dedicated pure entry points. Existing generic readers dispatch only explicit V8 data to them. V1/V2 Image, V4 Story, V5 Slides and V6 Scene grammars retain their existing validation; this work does not reinterpret the guest V3 lane. Resource policy V1 is required and supplies no Audio draft-storage, media-download or passive-read allowance.

The V8 envelope additionally retains four immutable identity fields:

- `audioActorRequestDigest`: the digest of the actor's actual supplied authorization request.
- `audioSponsorReviewDigest`: the digest of the separately verified terms displayed to that actor.
- `originalRequestId`: the native `audio-` request identity.
- `originalExpiresAtMs`: the native original deadline.

Both new digests use the `sha256:` prefix. The envelope permits no reference assets, a distinct payer is required, and creative ownership remains with the canonical actor. Its expiry cannot outlive the policy, resource limits, grant lifetime or original Audio deadline. Compilation never consults the current clock or changes the deadline: historical original identity must remain reconstructable after cost was incurred. Actual native preparation must derive and match the original request and deadline; accepting a syntactically valid value is not source proof or renewed permission.

Audio metadata is captured through bounded own-data descriptors before asynchronous hashing. Accessors, sparse arrays, unexpected prototypes, symbols, hidden properties, cycles and unsupported JSON values are refused. Returned policies, envelopes and nested review fields are owned immutable copies.

## Payer approval and current metadata

`compileSponsorApprovalProposal` recognizes a dedicated V8 proposal with eligible actor and issuer lists. The actual `approveSponsorCampaign` branch requires the payer's authenticated principal, exact reviewed terms digest and explicit approval command. It retains the complete thirteen-field principal snapshot, including email, display name and consent time. The original Request, signal, database and relevant authentication configuration remain captured across every owned asynchronous boundary. Payer identity cannot be selected through the actor's review metadata.

The initial approval uses the existing atomic campaign/resource/approval transaction and repeats the SQL expiry proof after its inserts and final authority proof. Expiry within that batch rolls back the new records. Exact replay uses read-only proofs against the original immutable command and approval; it does not mint another grant or reset counters. Changed authority before dispatch prevents the transaction. A committed approval followed by a lost acknowledgement remains recorded; this path never automatically retries, revokes, refunds or erases it.

`loadApprovedSponsorAudioCampaign` is a dedicated SELECT-only metadata reader. It independently authenticates the actor, proves exact current payer approval and eligibility, and retains the disabled/revoked/expired campaign denials. Its policy JSON and digest are captured before hashing, and final proof statements use the captured database and original metadata strings. Batch receipts and proof rows require plain own-data records and exact own indices; sparse results, accessors, inherited errors and overridden array methods cannot replace a successful proof.

## Verification boundary

The eight focused V8 policy tests check closed policy/envelope grammar, exact native call and transfer limits, every new original identity field's digest binding, foreign custody, deadline bounds, unsafe object shapes, caller mutation during hashing, and exact prior V1/V2/V4/V5 canonical goldens. They perform no provider or database work. An AST source comparison also proves all seven existing recipe/Story/Slides/Scene validation and compilation functions byte-identical to the pinned base. Three selected existing tests pass for V6 canonical compilation, authentic payer approval/replay, and earlier approval goldens.

The 54 focused payer-approval and current-loader tests pass using actual native functions with disposable synthetic SQLite. They cover authenticated principal changes, pre-abort and later cancellation, request/configuration/database mutation, exact read-only replay, resource hashes, malformed proof receipts, captured metadata and deterministic expiry during the approval transaction. The query capture retains 36 executed fixture queries and 17 distinct strict SQL shapes, with a maximum of 11 bindings and 17,109 UTF-8 SQL bytes. Separate EXPLAIN compilation limits expression depth to 100, function arguments to 32, parameters to 100 and SQL bytes to 100,000. This is not actual workerd/D1 execution. Scoped policy and approval lint passes. Independent bounded source/evidence reviews report no remaining actionable findings at the frozen source hashes.

Historical failures are preserved under `/private/tmp/forma-audio-v8-approval-*`: the initial fixture hash-count error; malformed receipt and error-descriptor refusals; captured-database and campaign-metadata regressions; and the closing transaction-deadline regression. The final 54/54 log is `/private/tmp/forma-audio-v8-approval-final-green.log`; the eight-test policy log is `/private/tmp/forma-audio-v8-policy-final.log`. Independent review receipts are `/private/tmp/forma-audio-v8-policy-independent-review.md` and `/private/tmp/forma-audio-v8-approval-independent-review.md`.

Integrated native workerd/D1 verification and the composed typecheck belong to the integration owner. Publication and public sponsored Audio acceptance remain outside this policy note. No pure compiler result, fixture principal, zero actor charge or recorded application amount is evidence of real user approval or a provider invoice.
