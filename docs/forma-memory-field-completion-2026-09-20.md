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

## Bounded history and final delivery — 2026-09-21

The actual inline suggestion endpoint now searches the existing eight-task
inventory in recency order, independently certifying each retained candidate.
A later ordinary answer no longer hides an older exact-current field suggestion.
The search stays within the current actor, scope, document and language; current
field revision/text, original consent and source ancestry are still required. It
never creates a turn, quote, provider call or enrollment. Expired, erased or
withdrawn history cannot supply a fallback. Acceptance keeps its separate exact
whole-source transaction and explicit publication approval.

Final delivery now rechecks the original monotonic lease after response
serialization, both for task/inline reviews and specialist quote/retrieval. The
feed drops expired review bytes and rebuilds its response; a private protocol
response that expires during construction returns a private, no-store error.
This fixes reproduced final-serialization leaks, not just a UI timer.

Verification:20 focused runtime checks pass, including four personal/shared
SQLite/real isolated D1 older-suggestion/withdrawal journeys and four reproduced
final-delivery expiry cases. A137-check neighboring native regression passes
before the final quote/retrieve wrapper; those wrappers have the focused final
checks. TypeScript and production build pass, with existing chunk warnings.
The earlier full1,981/1,981 runtime run is at extraction commitcf0b3b10, not
misrepresented as a full-suite run of these later changes.

This closes bounded saved-field-history selection and final private delivery
expiry. New automatically generated field suggestions, broader resources and
the remaining native completion matrix are still assigned for implementation.

## Fresh field generation — 2026-09-21

The editor now also opens [fresh exact-field generation review](forma-memory-fresh-field-generation-2026-09-21.md).
The earlier saved-read-only description applies to **Check saved suggestion**;
**Review new suggestion** creates a free exact-field request and cost preview,
with separate explicit generation and publication approvals. It never submits
unsaved draft text or silently purchases generation.
