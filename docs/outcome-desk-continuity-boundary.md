# Outcome Desk continuity and exact arrangement recovery

This is the current integrated Phase 7 source contract, including mounted and
fresh-host expired-review recovery. It is not phase acceptance, publication
or native/AT certification. The endpoint remains POST /api/canvas/arrangements;
the implementation reuses the existing controller, Store, modal and authoring
ledger, without a second queue, schema or paid prerequisite.

## Keep the original work and its owner

The controller binds continuations to request generation and authority scope
through preflight, response parsing, revalidation, refresh and error/finally.
An older request cannot clear a newer review, release its busy state or supply
its successful return value. Local validation deduplication belongs to the
specific preview, request generation and stamp.

Keep the original operation/project/board identity, exact previewId and
approvalHash, arrangementId and full validated receipt terms. Close preserves
the authored name and opaque URL handle; it does not cancel submitted work.
A completed free preview may remain recoverable after Close without reopening
or applying itself. Closing before preparation is dispatched prevents a
hidden new request. Opening/route stamps are not source revisions or events.

## Evidence decides the next action

| Current evidence | Permitted continuation | Not implied |
| --- | --- | --- |
| Exact live review | Apply only after current source, selection, rights and online checks; existing Cancel rules remain | Historical validation is not current Apply authority |
| Applying or unknown outcome | Explicit exact-original Check | Absence is not cancellation or a replacement grant |
| Exact known refusal of free preparation, followed by a new current Check | Explicit normal or inverse-specific Review of the same original request/current source | No new operation, normal-layout substitution for Undo, cancellation, automatic retry or Apply |
| Transport-owned confirmation non-approval before dispatch, followed by a new current Check | Explicit same-original normal or inverse Review, with separate Apply | This attempt was not sent; no server cancellation, unused-operation or replacement claim |
| Positive expired, still-retained original tuple | Explicit guarded resolution request | Expiry does not prove nothing committed |
| Original applied receipt | Recover that exact result and existing Undo/review path | A failed refresh cannot disprove completion |
| Exact verified dismissed outcome | A separately requested new Review, then separate Apply | No automatic new operation, preview or Apply |
| Missing, erased, inaccessible or malformed evidence alone | Keep the safe original handle unresolved | No reconstructed preview/hash or inferred unused request |

An authenticated live retrieve can still prove an identical previously
validated original review is not committed after the existing lease-recovery
boundary. This may release the submitted guard for human Cancel while current
source/selection checks keep Apply stale. Unknown handles require exact
validation; the blanket claim that every uncertain state is permanently
retrieve-only is not the implemented contract.

## Explicit expired-review protocol

The normal/default and live-read contracts are preserved. Only an explicit
recovery read adds includeDisposition:true to action=retrieve for the exact
original operation/project/board. Reading does not release an expired lease.

For a currently authorized, positively DB-expired but still-retained original,
HTTP409 canvas_arrangement_preview_expired may include a content-free
disposition: version=1, actorUserId, operationId, projectId, canvasId, previewId
and approvalHash, with providerCalls=0 and maximumMicrousd=0. It includes no
private name, frames, source content or generation input. The controller
validates this exact envelope and tuple against the current actor, known
receipt when present, original handle and captured recovery owner.

This enables only an explicit action=dismiss with the same operationId,
projectId, canvasId, previewId and approvalHash, plus onlyIfUnapplied:true.
The descriptor's version and actorUserId are not request fields. The server
rechecks authority, custody, retained
evidence, receipt and lease state. A live writer wins as applying; a committed
original wins as its receipt. Only an exact safe dismissed outcome finishes
the unresolved request. Any expired-lease fencing occurs in this explicit
server-adjudicated operation, never as a side effect of retrieval.

A lost resolution reply keeps the original handle and requires another exact
Check. A positive expired tuple is not a cancellation receipt, permission to
Apply, or proof derived from a missing/erased row. Do not weaken this boundary
to make a fresh review appear sooner.

## Canvas, modal and source continuity

### Known-refused or locally unsent free preparation

An initial or explicitly corrective normal or inverse preview can retain an
ephemeral preparation witness from its own actually dispatched exact
source-changed HTTP409 with zero provider calls and zero cost, or from the
existing transport's positive notice that its current confirmation was not
approved before dispatch. No preview, receipt or Apply has been observed for
that request. The witness binds the original choices, operation,
actor, board, source owner and inverse target when present. It is not persisted,
inferred from missing content or available to a new controller.

The local notice is emitted only after current authorization and request checks
and before fetch or a dispatch notification. A pending unrelated confirmation
can also produce non-approval; the UI does not claim that a person necessarily
pressed Cancel. The existing local409 body is unchanged. Error text, any other
409, a missing callback or a missing row is not positive non-dispatch evidence.
The notice describes this attempt, not global absence or server cancellation.
Only the fresh Check-owned view exposes its localized explanation and Review.

A separate current Check may qualify the existing normal form or a specifically
identified inverse-review action. The user must explicitly review the same
recipe, name, selected cards and original inverse target; source/layout revisions
and positions are recomputed through the existing normal or inverse builder.
Undo never becomes a normal arrangement. Every Check owns a separate ephemeral
read-qualified request view; an earlier rendered action cannot borrow a later
Check's permission, consume its qualification or create another request.
The old witness is consumed before that request. Only another exact owned
source-change refusal or positive local confirmation non-approval can create
a new attempt-specific witness; response loss, malformed replies and failed
reads cannot renew it. Apply remains a
separate confirmation of the actual returned preview.

Close/reopen may preserve historical refusal in the same controller, including
an exact reply arriving after Close. Only the existing transport's actual
dispatch notification can end the opening gate; confirmation waits remain
current-owned. A late refusal does not reopen the dialog or retain an active
Check/submit capability. A new current Check is required.

Same-board Desk posture and validated presentation-only reference navigation
may preserve that history without changing its original work. Nonpresentation
route changes, source authority loss, source retirement, actor/scope change or
a fresh controller invalidate it; restoring access does not revive it. Benign
refresh of the same source may preserve it. Saved, live and applied originals
remain authoritative; uncertain or erased original content is not declared
cancelled or unused.

Prospective actor/operation-derived private-preview IDs use insert-only storage
so a retained erased row cannot be overwritten by a corrected preview.
Identity-bound admission must insert once or fail inside the existing batch,
before dependent custody, retention, cleanup or publication writes. A denied
attempt cannot attach selected-project metadata to a personal original. This
uses existing constraints, not a new schema or an absence-based permission.
Ordinary random-ID storage is unchanged. Legacy
retained previews remain recoverable; already-erased random legacy IDs remain
unmappable. This does not change the default retrieve contract or shared Apply.

Each opening owns Close, backdrop/Escape, fields, selects, submit, review
callbacks and asynchronous cancellation. Old A cannot close or act on B,
including a reused dialog node. Recovery captures the exact source owner,
opening, route/posture, scope and current arrangement stamp. Its per-read Store
subscription retires stale ownership before a later render can revive it.

For recovery-owned requests, FormaStore.canvasArrangementRequest carries
currentness into guardedFetch through any confirmation-modal wait, then
rechecks it after transport and
JSON. Closing, reopening, navigating away/back or withdrawing/restoring source
does not revive the earlier captured request. Current normal focus and
dismissal remain supported; overlays use native popover/popovertarget, with
details/summary only for inline disclosures.

Undo begins only after queued ordinary edits settle and its exact opening,
scope, route, selection, source stamp and canonical original still match.
The protected previous_frames/geometry model and atomic inverse guards remain;
ordinary Undo/Redo is unchanged.

## Historical evidence and remaining gates

The earlier continuity R3 artifact touched only controller/Canvas boundaries.
Its statements that Store/backend wiring was still absent or that all
uncertainty was retrieve-only describe that earlier preparation, not this
integrated recovery protocol. Original recipes and Output/source rules remain
preserved. Narrow test-locator
and future-Check continuation oracle updates are explicit in the phase evidence;
they do not remove current-authority, unknown-outcome or separate-Apply checks.

Current tests combine actual connected Shell/Canvas/Store and routed Worker
code with isolated RAM SQLite and named transport, clock and native-control
ports. These are not physical browser, keyboard/AT, second-user, production,
recipient-delivery, media-quality or ROI proof. Formal phase review, complete
regression and native checks remain separate; hosting migration procedure and
actual production schema/history still gate publication. Recovery does not
call a provider, settle another job, reset budgets or release uncertain holds.
