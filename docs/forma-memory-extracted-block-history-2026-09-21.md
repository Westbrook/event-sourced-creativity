# Memory extraction and focal-point field history — 2026-09-21

Status: implemented and verified locally. No deployment, migration, provider
call, scheduler registration or user enrollment.

## Actual application integration

Explicit image-reference extraction now resolves its current canonical reference
block and writes its project/document/placement to each extraction and focal-point
event. A missing, mismatched or locked source is rejected; request metadata cannot
supply another document's custody. Library/Canvas extraction retains its actual
placement rather than being relabeled as a document source.

Document block inspection now includes focal-point changes in its complete field
history. Strict shared-project classification admits only a matching reference,
block, target and document in the project. Specialist state and mutation readers,
plus exact block-removal Undo, retain these field-changing events too.

The existing actual editor sends those source IDs without extracted prose or
focal metadata. A pending inspection is cancelled if the focal field changes.
The capture is an inspector opening, not comprehension or an independent stated
preference. Erased field history cannot certify a restored block.

## Evidence

- Full native resource suite: **271/271 pass**, including genuine personal/shared
  extraction jobs, inspector publication, Memory capture, removal/Undo, missing
  focal-field rejection and erased focal-source rejection.
- Actual Document controls: **6/6 pass**, including two new extraction/focal cases.
- Native specialist/source/actual D1 regression: **34/34 pass**.
- Existing shared Canvas extraction and governed-source regression: **2/2 pass**.
- Conversation-context model: **19/19 pass**.
- TypeScript, changed-source lint and production build pass; existing chunk-size
  warnings remain. No visual layout changed.

This supports canonically scoped document reference histories. Unqualified legacy
histories and Library/Canvas Memory enrollment are not silently broadened by it.
The remaining native resource identities, consumers and qualification stay in the
[completion matrix](forma-memory-completion-matrix-2026-09-20.md).
