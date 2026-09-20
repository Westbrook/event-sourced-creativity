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

## Continuation

Shared-project Undo of **block removal** exposed a separate native authoring gap:
the removed resource is absent from the current scope index, so the restoration
writer rejects it. Fixing that requires an exact historical, same-author restore
proof and atomic replay; it must not be solved by accepting arbitrary historical
pointers or by letting Memory repair the project index. This is native
implementation, tracked under resource/lifecycle coverage in the
[completion matrix](forma-memory-completion-matrix-2026-09-20.md).

The other native workstreams remain in scope. External hosting, scheduling,
provider qualification and rollout gates stay in the separate capability To Do.
