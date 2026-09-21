# Memory-assisted creative block previews — 2026-09-21

## Implemented

Document Assistant and the embedded Chat Studio now retain safe `context.create`
proposals from an explicitly approved Memory-assisted specialist response. They
appear as private, localized previews; they are not ordinary action proposals,
authored events, or an automatic image-generation request.

The user can explicitly add one exact reviewed proposal to the document. The
approval binds its text, kind, intent, execution, original turn, language, source
hash and destination. The browser sends identifiers and the approval hash, never
replacement prose or an unsent draft. Native publication rechecks current source,
Memory retention, private custody, rights and authoring access in the same atomic
transaction as the event and its unique receipt. Source changes invalidate the
remaining preview; an old review cannot silently approve a newer proposal.

Authored blocks retain `memory_authored_version: 1`. Withdrawing Memory removes
the private preview and its supporting inference, not the deliberately authored
block. Later creative Chat prompts and descendants preserve this negative
attribution; they cannot turn generated suggestions into independent preference
evidence. Reopening or accepting a paid result does not purchase it again.

Uploaded references, 3D/audio transfer, Output requirement contracts and protected
constraints keep their existing dedicated review flows. Field-local generation
cannot create unrelated blocks. Preview/image generation and publication beyond
the document retain their separate approvals.

## Native history integration

Accepted creations join the existing Undo stack. Shared-project Redo now restores
the exact same-author removal instead of attempting to create a duplicate ID.
The native history reader supports the bounded, linear
`Created → Removed → Restored` compensation chain, including another Undo/Redo.
It still rejects branching, foreign authors, non-lifecycle compensation, erased
sources and changes during the restore transaction. No resource scope is repaired
or invented by Memory. Both private and shared inspections retain the original
creation and its exact lifecycle history.

## Verification

- 42 native assistant checks pass, including real local D1 personal/shared
  creation, duplicate/race refusals, withdrawal, restoration and downstream Chat.
- 105 focused model/Assistant/Chat control checks pass; all four locales are covered.
- 24 rebuilt-app browser journeys pass: existing text edits and new creations,
  Document and Chat Studio, English and 320px Arabic, expiry, blur and acceptance.
- 4 focused Store Undo/Redo checks pass. The broader model/artifact/Store run is
  339/340: its one navigation-history failure is reproduced with the unchanged
  pre-change Store and test file.
- Broader Assistant panel checks retain the baseline failure set: 55 failures on
  the final run, all within the 56 failures reproduced with the pre-change panel.
  These are not claimed fixed or waived by the Memory checks.
- TypeScript and changed-file lint pass. `assistant-api.ts` retains its same 28
  baseline diagnostics; the native runtime test retains its same 16 diagnostics.
  The production build passes with its existing large-chunk warnings.
- A full native runtime run is in progress and is not yet claimed as passed.

All provider transports and data used here are synthetic. No migration, provider
spend, real-user enrollment, push, deployment or hosted schedule was performed.

## Remaining scope

This completes the reviewed creation-to-authored-block path. It does **not** close
private-semantic image/output generation, independently authorized source reuse,
Library/Canvas enrollment, cross-scope profile promotion or the full integrated
qualification work. Those remain assigned in the
[completion matrix](forma-memory-completion-matrix-2026-09-20.md), separately from
[external capability/rollout work](forma-memory-sites-capability-todo-2026-09-18.md).
