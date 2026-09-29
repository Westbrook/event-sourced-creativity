# Governed artifact consumption

Local feature-branch implementation, 2026-09-19. No production migration, deployment,
configuration change, provider call, spending, schedule registration or enrollment.

## Native behavior

- The actual Document and Canvas artifact viewers can report an exact retained
  opening in a selected organization project. Instrumentation must be enabled;
  route, source ownership, authorization, revision, visible dialog and body hash
  must still match. Opening is not proof of reading, attention or preference.
- A separate read-authorized `/api/events/hot` writer checks the current principal,
  selected context, project access, exact native source envelopes and collaborative
  document/artifact/content custody. It does not use the generic project authoring
  path, repair a stale project index, or authorize companion mutations.
- The event, erasable private envelope, project event scope and both sequence
  frontiers commit atomically. Exact post-write proofs detect suppressed writes.
  Lost/truncated acknowledgments never rebase or retry. D1 trigger-inclusive change
  counts are accepted only alongside those exact native proofs; the existing
  personal writer uses the same acknowledgment correction.
- Shared and unselected owner event feeds redact another actor's view target,
  observation type, actor, client and correlation. Native internal source reads
  still support certified evidence; learning selects only the enrolled actor's
  own genuine observations. This is not a claim of encrypted tenant custody.
- Scheduled publication and derivation capture accept original-backed governed
  observations and retain supporting event/content privacy inverses. Artifact prose
  is not sent as an original quotation, and a click alone creates no eligible human
  original. Historical views require the retained original native receipt, exact
  old bytes and current access; expiry cannot be renewed by extending source storage.
- The opt-in inspector now explicitly requests `memory-consumption-episodes-v4`.
  v1 navigation, v2 current personal views and v3 historical personal views keep
  their original negotiated contracts. Unknown/mismatched versions fail closed.

No new schema objects are required. Existing native source/lifecycle migrations
remain required for derivation. Forget removes memory references under the existing
scope contract; organizational event custody, legal holds and backup/device erasure
are not silently redefined by this change.

## Verification

- 157 artifact/actual-viewer tests passed, including isolated D1 personal and shared
  writes, delayed historical delivery, suppression/rollback, uncertain ACKs,
  member-versus-owner presentation and subsequent project synchronization.
- Seven additional governed inspector final-replay fault cases passed.
- Four-source whole-HTTP inspector checks passed at 28 personal / 40 governed D1
  calls, below the conservative 50-call gate. This is not hosted quota qualification
  or the remaining artifact-heavy rolling derivation qualification.
- 409 native derivation/reuse runtime regressions passed.
- 624 strict client and component tests passed.
- English and Arabic synthetic browser checks passed; final captured inspector
  frames were reviewed. No real user settings or production browser tab was touched.
- Typecheck, changed-file lint and production build passed.
  Existing build chunk-size warnings remain.

Broader resource identities, genuine block inspection, original cross-document
source recall, longer-term reconciliation, automatic consumers and complete
artifact-heavy rolling request-budget qualification remain in the original plan.
