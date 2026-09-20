# Memory inspection after native field Undo

Implemented locally on the Memory feature branch; no migration, external service,
provider call, production deployment or real-user enrollment.

## Native behavior

Document inspection now recognizes a closed, same-author native field edit/Undo
pair. Text properties, chip fields, names, weights and lock state are supported.
Redo is a separate event and its reversal retains a separate pair. All source
IDs, original private bodies and custody proofs remain part of the certified
field version and final atomic replay. No undo is counted as independent
preference evidence, and no block text becomes a quotation.

The previous version does not remain valid merely because its change was undone:
a compensator outside that historical window still makes the old interpretation
unavailable. Missing/foreign targets, changed authors, wrong inverse values or
fields, multiple compensators, undo chains and erased private bodies fail closed.
The complete history retains the existing row/byte limits; nothing is silently
trimmed or reinterpreted as a fresh original.

## Verification

- 247 artifact/block/native privacy tests pass before the last two redo tests.
- Final 30 Undo/Redo, rejection and isolated D1 cases pass. D1 exercises personal
  and shared writer/capture paths and late erasure of the undo body's source.
- All 421 context-controls tests now pass. The finite Library navigation port
  was reconciled with the actual Store's standalone-experience guard; its modeled
  scope remains same-app Library navigation. No production guard was removed or
  replaced to make those tests pass.
- TypeScript, changed-file lint and production build pass. Existing chunk-size
  warnings remain.

## Guarded restoration of removed shared blocks

The separately reproduced shared-project restoration gap is now implemented.
Undo of block removal can use a bounded historical proof when the block is no
longer in the active resource index. It requires the latest retained removal by
that same author, one original Document declaration, unchanged project/document
custody and all retained native private field bodies. Rehomed or ambiguous
histories remain unavailable. Historical pointers do not grant current access.

The existing current author/document/project checks and owner-head CAS remain.
Exact history, custody and lifetime checks run before and after the atomic write;
a final receipt proves the new event, its private body, custody and stream head.
D1 event and custody change counts include triggers, so those covered writes use
the exact receipt instead of incorrectly requiring a change count of one.
Suppressed writes/custody, changed new bodies, late source erasure, permission or
head changes roll back or deny publication. Lost acknowledgements are uncertain;
repeating the same compensated restore cannot publish a second inverse.

The native proof is process-local, database/principal-bound and limited by both
wall and monotonic clocks. It cannot repair the project index or enroll Memory.
An ordinary authorized refresh rebuilds the index after restoration; old Memory
versions are not resurrected by Undo.

Final verification: **294/294** full artifact/block and project-schema/native D1
tests pass, including 16 restore-boundary checks and six D1 inspection histories.
The D1 cases include the actual removal-restore transaction, subsequent Memory
capture and erasure of the restored history. Thirteen surrounding shared-authoring
and semantic-consumer regressions pass. TypeScript, changed-file lint and the
production build pass with the existing chunk-size warnings.

## Remaining planned scope

This completes the specific field-Undo and removed-block restoration defects,
not all native Memory implementation. Assistant-assisted edits/outputs, exact-field
autocomplete, longer-term profile consolidation, broader Library/Canvas and
cross-owner resource scope coverage, downstream lifecycle integration and whole-
invocation capacity remain tracked in the
[completion matrix](forma-memory-completion-matrix-2026-09-20.md).
External hosting, scheduling, provider qualification and rollout gates remain in
the separate capability To Do. Nothing was deployed or enrolled by this change.
