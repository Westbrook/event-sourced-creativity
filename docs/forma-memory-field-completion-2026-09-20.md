# Inline saved Memory field completion

Implemented locally on the Memory branch; not deployed or enrolled.

The ordinary Document text editor now has an explicit **Check saved suggestion**
control. It retrieves one retained, already-paid suggestion for the exact current
project/document/block, field revision, text and language. It never sends a draft,
starts or resumes a task, purchases generation, or silently accepts text.

The native endpoint authorizes current access and action eligibility, replays the
retained result's Memory and source proofs, and serializes the field projection
synchronously with the final certified read. An exact text comparison also denies
a changed private field whose event revision did not advance. Only one bounded
recent completed task is considered; unavailable history is not widened silently.

The client uses a 16 KiB incremental UTF-8 response reader and 15-second operation
deadline. Field/source changes, IME composition, typing, blur, pagehide, withdrawal,
visibility loss, expiry and disconnection cancel and retire the private view.
Unsent normal drafts are retained. Focus never automatically reloads it. Escape
or Dismiss discards the suggestion; Enter/Tab do not implicitly accept it.

**Apply to document** uses the existing exact replacement approval transaction,
not text supplied by the browser. The canonical event refresh supplies the new
field and registers native Undo. Late completion cannot close another editor or
refocus after retirement. Reverting a locally typed draft to its original text
before applying is supported. Accepted text survives Memory withdrawal; private
support does not. Subsequent ordinary editing remains available.

## Verification

- 23 parser/response-reader checks, including stalled cancellation, byte overflow,
  malformed UTF-8, accessors, field/revision/language mismatch and expired leases.
- 12 native endpoint checks for personal/shared data: no turn or provider purchase,
  malformed/extra query fields, wrong target/language, changed revision or text,
  withdrawal, disabled Memory, viewer access and locked fields.
- 421 existing context-control host checks pass with this editor integration.
- Two actual whole-app synthetic browser journeys in English and Arabic at 320px:
  no initial request, IME, dirty drafts, literal rendering, dismissal, late blur,
  explicit canonical acceptance and toolbar Undo. Arabic layout inspected.
- The full focused Memory browser suite passes 18/18, including existing Assistant and Chat Studio privacy/acceptance journeys.
- TypeScript, scoped lint and production build pass; existing chunk warnings remain.

The larger 1,929-test native run passed for accepted edits and generic event-feed
privacy before this endpoint's final additions. It is not claimed as validation
of later source changes; those have the targeted checks above.

## Scope still assigned

This is the first real field-local consumer, not automatic new suggestion
generation. Independently authorized source reuse, complete creative-output/live
preview, evolving semantic profile consolidation, other native resource histories
and whole-invocation qualification remain in the completion matrix. Hosted
scheduler/provider qualification and deployment stay on their separate checklist.
