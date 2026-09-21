# Independently authorized reuse discovery — 2026-09-21

## Native implementation

The actual Memory recall control now offers explicit discovery of source documents
for certified, approved block copies. It uses the newest retained target window;
it never silently substitutes an older result when that window is withdrawn.
The target result and its native authoring receipt/footprint are revalidated.
The source must be separately enrolled, currently accessible, and inside its own
explicit recall boundary. A copied-from pointer alone grants nothing.

Before any original block history is hydrated, native public placement and resource
custody identify the independently authorized source document. Exact original
history, live placement, copy approval, source/target consent and current access
are replayed before disclosure. Catalogs contain no copied prose, original block
IDs or private approval handles. All reads are bounded: at most 16 distinct source
block IDs and eight candidate source documents, in addition to existing native
history and byte limits. Ordinary unfiltered recall keeps its existing limits.

The selected source's preview uses its own qualified purpose grant and original
backing, not the copied prose. An explicit **Keep for assistant** action saves the
original through existing native context consent and source-retirement machinery.
That action is offered only for the current document. Discovery never purchases
work, automatically enrolls a source, increases its relevance weight, or turns
copying into independent preference evidence. Saving an original is a separate
source choice, not ongoing permission inferred from the copy relationship.

The UI includes English, French, Arabic and Japanese copy, clears private discovery
and previews on blur/expiry/privacy changes, and aborts stale requests. Connecting
the actual acceptance control exposed and fixed its existing first-mount defect:
candidate controls now render without waiting for an unrelated screen update.

## Verification

- 20 focused native checks pass: personal/shared discovery, independent original
  purpose consent, preview, saved-context acceptance and withdrawal; actual
  isolated workerd/D1; denied source custody, missing consent, foreign owner,
  removed block, erased approval and final-read races/receipt faults.
- 96 adjacent model/client/component checks pass.
- 12 full-app synthetic browser journeys pass, including ordinary and reuse
  discovery, explicit acceptance, lost boundary acknowledgement, expiry and blur
  in English and narrow-screen Arabic. No horizontal overflow or script execution.
- Types, changed-file lint and production build pass (existing chunk warnings).
- The final expanded native reuse, scope, retained-context and D1 regression
  passes 93/93. Counts above overlap rather than add. The unchanged runtime-test
  lint baseline remains 16 findings; no new findings.

## Scope and continuation

This connects the existing native approved-context-copy path to independent source
recall and the real assistant-context consumer. It does not grant cross-owner
copy provenance, trace arbitrary pointer chains, infer original access from document
duplication, or enroll Library/Canvas as Documents. Those broader resource/history
integrations remain in the [completion matrix](forma-memory-completion-matrix-2026-09-20.md).
The newest bounded window is not complete lifetime reuse history. Provider/index
qualification, scheduling and production rollout remain separate tracked gates.
No migration, production publication, real-user enrollment or real provider call.
