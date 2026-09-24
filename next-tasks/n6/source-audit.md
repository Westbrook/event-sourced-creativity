# N6 authoritative source dependency audit

Audited the exact N5 candidate `1091e3ef` in `/private/tmp/forma-n6-inspector` and the N5 prospective contract. No live provider, production read, expired N4 reconstruction, publication, policy change, or original-checkout mutation was performed by this audit.

## Decision

The existing authoritative source resolver cannot supply the proposed complete prospective authority/input witness. Its projection is authoritative for generation input construction; it is not an independently requalifiable disclosure authority. Implementing a successful raw inspector by hashing selected `source_event_refs`, checking only current fields, or combining those with the preflight mutation high-water mark would weaken N5's minimum contract.

Exact missing dependency: **a resolver-owned, bounded personal Still source-authority receipt and its read-only requalification contract**, emitted during the existing authorized preflight and bound to the exact complete snapshot. It must carry a complete semantic dependency census, original event/envelope/private-body identities, scope/provenance exclusions, and lifetimes. That contract is absent. A truthful implementation can report `source-authority-contract-unimplemented`; it cannot claim a successful body inspection yet.

## Existing contracts and their limits

| Existing contract | Reusable guarantee | N6 gap |
| --- | --- | --- |
| `worker/generation-readiness.ts:298`, `imageReadinessSource` at line 190 | Ordinary preflight uses existing authorized events and `authoritativeCreativeContext`; generated snapshot/revision are not replaced by browser text. | No complete authority receipt is requested or returned. Cache return can precede this resolver using only selected mutation-head equality (lines 288–294). |
| `worker/context-authority.ts:59`, `createAuthoritativeCreativeContextFold` at line 69 | Canonical generation folds, source versions, selected document/project and snapshot. Fold explicitly states it does not establish authority or freshness (lines 65–68). | Return value (lines 270–275) contains projection, snapshot, versions, revision only. No custody receipt, dependency completeness proof, original project/document incarnation proof, or read requalification capability. |
| `worker/runtime.ts:940`, `readWorkspaceEvents` at line 960 | Paged projection-relevant workspace history; optional server-owned `EventReadProof` can check assertions with each hydrated page. | Ordinary preflight does not supply a proof. A hydrated event array cannot prove raw private ownership/scope, complete retained custody, stable source identity across page reads, or missing bodies. |
| `worker/event-read-primitives.ts:8` | Serializes durable event fields and uses Memory routing behavior. | Drops private sidecar custody metadata; when private body is unavailable, falls back to the public operational envelope. A successfully folded snapshot therefore does not itself certify complete original private source. |
| `src/model/events.ts:247` and `worker/context-authority.ts:98` | Canonical semantics for project/document membership, attachments, relationships, copied/extracted facts, excluded Output blocks and snapshots. | Current `sourceEvents` arrays are projection provenance, not an attestation that all scope-defining and negative dependencies have been included. Project origin is a concrete missing dependency in a selected-ref collection. |
| `src/model/context-health.ts:112`; `worker/output-disclosure-proof.ts:88` | Existing generation rights and active-source deadlines. | They deliberately inspect active facts. Whole-snapshot moderation also serializes inactive facts. Current properties can omit a prior lifetime after an edit. No complete original/current disclosure lifecycle receipt results. |
| `src/model/taste.ts:54` | Canonical standing-constraints reducer. | Separate from `authoritativeCreativeContext`. Ordinary Still source-advisory currently sends the resolver snapshot unchanged; prompt-technique comparison explicitly appends constraints. Do not invent a standing-constraints transmission claim; the complete receipt must certify the selected route's actual census and exclusions. |
| `src/model/memory-authorship.ts` | Accepted Memory assistance is negatively attributed and survives later edits and deliberately authored copies. | Marker absence on an arbitrary selected event is insufficient to attest complete exclusions. N6 must consume the canonical complete provenance/custody result. |
| `worker/advisory-moderation-evidence.ts:36` | Bounded private body references, exact original envelope digest, personal document/project and native Memory body exclusion. | It explicitly says it is never a source-history proof. It cannot fill the resolver gap. |
| `worker/generation-current-source-read.ts`; `worker/generation-current-source-proof.ts:19` | Existing diagnostic conservatively checks complete stream custody, current incarnation and retained producer evidence. | It is a standalone administrator observation, not an ordinary preflight receipt. Its full-stream allowlist rejects `GenerationPreflightRequested` and `GenerationPreflightCompleted`; it also rejects preferences and unsupported lifecycle transitions. Dropping those events to make it pass would be a new hand-selected evidence filter. |

These are scope differences, not claims that the existing generation resolver or admitted-job reader violates its own contract.

## Executable counterexamples

`tests/n6-source-authority-dependency.test.mjs` uses actual source functions with synthetic inputs, not source-text matching. Nine passing tests establish:

1. Changed private sidecar owner, scope and binding metadata disappear before resolver identity is computed.
2. Changed event stream/actor can produce the same source snapshot/revision; digest is not authorization.
3. Missing/redacted sidecar fallback can still produce a snapshot and source reference with private text absent.
4. Removing the project origin leaves identical snapshot/revision while the separate incarnation checker refuses; selected refs omit that origin.
5. Standing constraints change in their separate reducer without changing this resolver's snapshot/revision.
6. An inactive expired fact remains serialized in the snapshot although active generation-rights validation rejects the same active fact.
7. Clearing a rights deadline removes it from current properties while the history and original source refs remain.
8. Accepted Memory assistance remains attributed through later edits and copied authored work.
9. The diagnostic full-stream lifecycle proof refuses ordinary preflight telemetry that does not change the canonical generation snapshot.

Command: `node --experimental-transform-types --test tests/n6-source-authority-dependency.test.mjs` — 9 passed. Strip-only Node mode fails on an existing imported TypeScript parameter property; transform mode is required without the repository's usual `tsx` runner. These tests demonstrate the missing dependency. They do not qualify a new route, classifier, historical observation, or a successful raw disclosure.

## Smallest bounded design

1. Extend the **existing canonical reader/resolver boundary**, prospectively and optionally, with one versioned Still-only receipt. Keep current generation return values, moderation input/wire and authorization behavior unchanged. Its observational result is `complete` or an explicit unavailable reason; failure cannot propagate into moderation/admission.
2. The canonical reader must preserve custody/identity evidence before `serializeEvent` discards it, using the existing per-page proof mechanism and a final read-only proof. The canonical folds must identify the complete dependencies they actually consume for selected project/document membership, facts, relationships, attachment/inheritance state, route-relevant constraints and exclusions. This needs owned reducer semantics, not a parallel event-type allowlist in the inspector. Any unknown effect, missing source, unsupported provenance or incomplete census refuses.
3. Initial receipt supports only personal manual Still `generate`, no preview source, character/Canvas scope, references/3D, rights-bearing/derived/Memory inputs, governed/sponsor/workflow/native/durable-slot context. Require the entire exact snapshot under 28,000 JS code units and at most 128 complete dependencies; unsupported source or capacity remains unavailable. The bound applies to the proven census, never a truncated list.
4. The receipt binds owner/stream/project/document/revision/source digest, original preflight/request, original source events and exact public/private hashes, original lifecycle deadlines, and a versioned exact positional input manifest produced during the existing moderation input construction. It must attest the absence of excluded context through the authoritative contracts; checking for a few absent snapshot fields is insufficient.
5. Persist only a complete prospective receipt during the authorized operation. Adopted cache rows point to the original receipt and original request/response pair; adoption cannot extend deadlines or mint authority. No backfill. Missing/expired legacy receipt is metadata-only unavailable.
6. After that contract exists, the separate GET can derive at most the two owned moderation refs and reuse `qualifyAdvisoryCapture` plus private-custody guards. Final qualification must prove principal/database/census/scope/rights/exclusions/original rows/exact body bytes unchanged and enforce the minimum original+selected preflight, source/witness and both immutable private deadlines. Invalid provider bodies retain raw bytes only after authority passes and association is unknown; never infer categories.

Do not create a generic evidence framework, expand the admitted-job reader, add a fake GenerationRequested/job sequence, or repair historical events to bridge this gap. A subsequent implementation should qualify this one receipt contract first, then the source/rebuilt Worker GET matrices and synthetic browser disclosure/acknowledgement flow.


---

# N6 independent custody audit

Audited checkout: `/private/tmp/forma-n6-inspector`, N5 candidate `1091e3ef`.
Read N5 prospective contract. This audit performs no provider calls or historical data reads.

## Decision

Agree with a committed dependency/test/documentation candidate. Do not enable an inspector route or label a synthetic unavailable page as implementation. Existing contracts do not furnish N6's resolver-owned, complete prospective source authority census. The user explicitly permits identifying this missing dependency and its smallest bounded design. The inspector, witness capture, disclosure UI, route success cases, and their qualification matrix must remain marked **unimplemented**.

## Why the gate is unmet

- `worker/context-authority.ts:59` derives the authoritative snapshot from events supplied by its caller. It returns snapshot/source versions/document revision, not a proof that retained source history, rights, scope and lifecycles are completely enumerated. The streaming fold explicitly says it does not establish authority or freshness (`:65–68`).
- Ordinary preflight uses `readWorkspaceEvents` and `imageReadinessSource` (`worker/generation-readiness.ts:190–191,298`). `readWorkspaceEvents` loads the workspace event profile (`worker/runtime.ts:960–962`); this is not a prospective private-custody census or persisted authority witness. Its context mutation high-water mark only supports cache validity.
- `continueOutputTrustedContext` adds useful current scope/source guards (`worker/output-trusted-context.ts:137–162`), but `captureOutputPrivateSources` derives selected identifiers from current projection sourceEvents and pinned outputs (`worker/output-disclosure-proof.ts:26–31`). It does not attest that those references are a complete census of all source-affecting events/lifecycles, and has no origin/adopter preflight witness.
- `generation-current-source-read.ts` is a separately bounded current administrator diagnostic with a complete-stream census. Its `proveCurrentIncarnation` intentionally rejects every unknown event type (`worker/generation-current-source-proof.ts:12–25`), and its reader requires every event actor be the user (`generation-current-source-read.ts:107`). The normal `GenerationPreflightRequested`/`Completed` worker events are outside that contract. Reusing it after filtering those or other events away would weaken its complete-stream claim; broadening it is separate resolver design, not an existing complete witness.
- `qualifyAdvisoryCapture` documents itself as “never a source-history proof” (`worker/advisory-moderation-evidence.ts:36`). Retained capture hashes do not close this gap.

## Actually reusable contracts

| Contract | Existing source | Reuse and remaining route gap |
|---|---|---|
| Hosted personal identity | `worker/native-retained-text-custody.ts:27` | Rejects project-context and impersonation cookies. No localhost account provisioning. |
| Read-only canonical principal/consent | `worker/native-retained-text-custody.ts:212` | Creator/admin, current policy consent, identity policy validation, bounded `auth_json`. Must capture and requalify exact principal and DB for N6. |
| Personal raw capture | `worker/advisory-moderation-evidence.ts:21` | Observes original request/response envelopes, max 500,000 UTF-8 bytes each, owner/stream/origin bindings, original envelope digest and storage expiry. No complete source witness. |
| Capture link qualification | `worker/advisory-moderation-evidence.ts:38` | At most two server-owned refs; hashes, owner, private retention, redaction, personal scope, native Memory exclusion; rereads bytes and checks DB identity. Does not read or keep origin/selected preflight rows live; does not validate operation-body hash or input/result association. |
| Observational failure isolation | `worker/openai-moderation.ts:82` | `moderateGenerationSnapshot` isolates observer errors from original dispatch/verdict; N6 capture must preserve this and exact request bytes/call count. |
| Exact input construction | `src/model/source-advisory.ts:20` | Snapshot input plus first 24 nonempty fact projections, 28,000/6,000 UTF-16 bounds, exact index/sourceIndex/blockId/truncation. Add prospective per-input digest through this existing construction, without reimplementing its wire. |
| Result validation | `worker/moderation-response-validation.ts:3` and unique-key parser in `worker/openai-moderation.ts:47` | Exact cardinality and boolean categories/valid scores. Missing identity fields stay unknown. Malformed results never become clear. Association remains positional and cannot detect a valid reordered provider response. |
| Read-only router precedent | `worker/index.ts:134–136,399` | A new path must route before mutating/auth-initializing handlers **and** skip post-response retention scheduling. Merely placing it before `handleGenerationReadiness` is insufficient. |
| Synthetic read-only tests | `tests/generation-current-source.test.mjs` | Source/rebuilt Worker fixtures, strict provider/media/background sentinels, SQLite total_changes and injected principal/DB/content races. Existing tests qualify only their named contracts. |

## Origin/adopter and disclosure hazards

- `generation_preflights` is upserted by `(owner_id,request_key)` (`generation-readiness.ts:377`): replacement can delete the original preflight identity even while private bodies remain. That must make N6 unavailable, never mint origin authority from an adopted row.
- Full-cache and previous-safety reuse preserve the prior capture; `adoptedBy` changes only to the selected preflight (`generation-readiness.ts:277–284,355–362`). Original envelope binding must remain the original, and original + selected row deadlines must both be checked.
- `qualifyAdvisoryCapture` can currently qualify live private records for an expired original preflight because it is a link/custody helper; an N6 reader must not treat its retained result as access authorization.
- Envelope digest is distinct from `operation.requestSha256`/`responseSha256`. A reader must qualify both exact envelopes and exact raw body strings, same evidence ID, phase and identity association, and the prospective input manifest.
- Requested model, returned model, header request ID and body response ID are separate observations. Current validation does not require nonempty response identity; do not fill missing values from the request.
- Invalid/cardinality-mismatched provider bodies may remain privately retained under valid capture; their classified results must be unknown. Missing/incomplete bodies must be unavailable. Neither case authorizes replacement calls.
- No served report should receive private raw source, body, project or document values. Review fixtures must be unmistakably synthetic and cannot certify historical evidence or classifier quality.

## Smallest bounded dependency

Extend the *existing ordinary Still authoritative source resolution* to return a versioned complete witness for the exact manual text-only subset, authored during its authorized preflight and requalifiable later. It must enumerate all relevant document/project/fact/constraint/attachment/accepted-input dependencies and lifecycle/scope/rights, identify unsupported or unknown effects, and carry exact origin owner/stream/project/document/revision/source bindings and immutable effective deadlines. Bound complete snapshot to 28,000 UTF-16 characters and dependencies to 128; references/3D, derived/rights-bearing/Memory/governed/sponsor/workflow/native context remain unavailable. The resolver must itself establish completeness, not accept a caller's list or rely on current sourceEvent references. No historical repair/backfill.

Only after that dependency is implemented and qualified should observational persistence, strict GET selection, two-body read/verification, race checks and compact inert disclosure be implemented. N5 reporting release remains independent. Current N6 disposition: **not release ready; complete resolver-owned prospective authority witness absent**.
