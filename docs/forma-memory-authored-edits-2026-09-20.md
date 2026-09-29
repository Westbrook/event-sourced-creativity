# Explicit Memory-assisted authoring — 2026-09-20

## Native behavior

Document Assistant and embedded Chat Studio can explicitly apply one retained,
reviewed Memory text suggestion to its exact original field. The existing
Assistant action enrollment and author permissions remain required. This is a
separate approval from the paid specialist request: the disclosure says the
replacement becomes document content visible to authorized collaborators.

The browser approves a hash of the execution, source, language, block, field,
revision, original excerpt and exact displayed replacement. It sends identifiers
and that hash, never an unsent draft or browser-supplied replacement. A changed
review cannot inherit an old click. Acceptance neither calls a provider nor
reserves budget, and an uncertain response is not automatically retried.

The native endpoint reads the canonical retained response, revalidates the exact
current source and field, access, protection, rights deadlines and Memory
ancestry, and replays those proofs in the authoring transaction. An immutable
per-execution/per-block receipt prevents repeat publication. Private-field
changes without a stream-head change are checked through the existing exact
native authoring witness.

## Authored work is not disposable Memory

The accepted `BlockPropertyEdited` event is ordinary authored work, not a member
of the private-materialization erasure graph. Withdrawal erases the private
inference, not the accepted text. Undo/Redo use the ordinary native authoring
path, including after Memory withdrawal. A refreshed canonical receipt places
server acceptance above earlier in-session edits in Undo history; a receipt
pointer cannot inject text or restore a private preview.

Shared event reads omit private Chat pointers. Undo registration therefore uses
the canonical event identity, principal, execution receipt, resource and latest
field state rather than requiring that private pointer to be disclosed.

Native D1 can include trigger writes in `meta.changes`. Ordinary shared authoring
now verifies exact event/private-body/custody/head rows in its transaction rather
than rejecting a committed field edit because its trigger-inclusive count is
larger than one. Other sidecar checks and authorization guards remain intact.

## Non-independent provenance

A permanent `memory_authored_version: 1` marker on the initial event survives
private Memory retirement. Both bounded and complete native assistant context
builders consult authorized block history, not mutable block properties.
Subsequent provider snapshots label that authored context as
`accepted-memory-assisted`, with `independent_evidence: false`. Later human edits,
Undo or Redo do not turn that history into independent evidence of a preference.
The provider sees no execution, Chat, or root event identifiers. The field remains
normally editable; the marker is not an access grant or an erasure instruction.

This is direct block-history coverage. Independently authorized cross-resource
reuse, finished output integration and exact-field autocomplete remain in the
[completion matrix](forma-memory-completion-matrix-2026-09-20.md); this checkpoint
does not claim those integrations are complete.

## Verification and rollout

Synthetic local evidence in progress:

- 18 native personal/shared acceptance and privacy-race tests, including actual
  local D1 and Undo after withdrawal.
- 2 complete Store Undo/Redo histories, personal and shared.
- 346 Assistant host/proposal tests; 28 focused Memory control tests.
- 16 built-app browser journeys (English and narrow Arabic, Document and Chat,
  blur, expiry and explicit Apply); screenshots inspected.
- 136 context/provider tests including later-edit/Undo/Redo negative provenance.
- Native shared-authoring regression: 100/103 pass. The three failures reproduce
  unchanged at the pre-slice HEAD (two stale output-authoring assertions and a
  media-type error-copy expectation).
- Broader panel baseline: 55 failures reproduce at the pre-slice HEAD. One
  preexisting navigation-history fixture failure also reproduces there. These
  are not represented as a clean whole-repository suite.

The full native suite, final source checks and additional native prompt ancestry
checks are recorded in the continuing independent report as they finish.
No migration, main push, deployment, real provider call, scheduling registration
or enrollment occurred. External qualification and rollout remain in the
[non-implementation checklist](forma-memory-nonimplementation-work-2026-09-17.md).

Final native regression for this slice: **1,929/1,929 passed**, including personal/shared generic private-event read checks. The separate inline-field endpoint and editor were added afterward and have their own [verification checkpoint](forma-memory-field-completion-2026-09-20.md).
