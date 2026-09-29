# Outcome recipes and the optional Outcome Desk

This document describes the integrated Phase 7 source implementation. The
existing Canvas hosts the optional Desk and protected arrangement review.
Implementation is not phase acceptance, publication, native-browser or
assistive-technology certification. The phase's complete regression,
independent review and release gates remain separate.

## Existing context and Output authority

The three recipes are guidance over existing context editors,
CreativeNextPorts, recommendProductionWorkflow, supported formats and slide
styles. Selecting a recipe does not configure a ProductionWorkflow, emit
DocumentProductionWorkflowConfigured, change requestedMedium, create decisions
or semantic groups, bind source membership, select dependencies, approve work
or call a provider. Authored changes still require their existing exact human
confirmation.

The Desk projects one explicitly selected document's authorized
CreativeWorkspaceFacts and canonical CreativeDocument. Rows retain their
original document/output/artifact/job objects by reference; there is no second
canonical model, media cache or copied result. Approval and delivery remain
with their existing executors. Payment is not delivery; a failed zero-clip
video stays failed, and an ordered scene reel is not an assembled film.

OutcomeDeskAction adapts the existing exact review/delivery target, not a new
permission registry. available() and fresh current() facts check actor,
project, board, document, source, revision, review and delivery authority at
activation. followOutcomeDeskAction opens the existing executor, which keeps
its own checks. Navigation cannot generate, mutate source or approve. The
resolver retains one primary action, at most two alternatives, dismissed
suggestions in Other ways and access to the full authorized registry.

## Views, menus and unfinished work

The existing Canvas route accepts optional posture=outcomes, recipe and outcome
queries. Invalid, removed or unauthorized selections do not select a
substitute. Switching views preserves board/path identity, existing view and
focus suffix, query preferences, hash and unfinished authoring work. The
authoring subtree stays mounted, hidden and inert while the Desk is shown.
Display order is an ID-only permutation, not a canonical or semantic edit.

Overlay menus use native popover and declarative popovertarget controls;
details/summary is reserved for inline disclosure, not overlay menus. Native
links preserve modified clicks. Ordinary navigation and return focus remain
owned by the current instance/opening, scope and route. A unique instanceId
and real canvasReturnFocusId identify the invoker.

## Faithful, free arrangement preview

src/canvas/outcome-arrangements.ts supplies deterministic manifests and
SHA-256 revision helpers shared with the atomic Worker. Both sides use the
same authorized project projection. Canonical IDs, authored source properties,
typed relationships, current artifact content and explicit context membership
are included; top-level view sequences, provider receipts, image prompts and
private input references are excluded. This is freshness evidence, not a
generation manifest or permission to reuse pixels.

Layout revision covers the board and every projected item; source revision
covers the exact selected sources and their explicit graph. Selection is a
sorted set of 2–100 canonical item IDs, never inferred semantic membership.
Geometry bounds remain: absolute x/y at most 1,000,000; width 120–8,192;
height 90–8,192; absolute rotation at most 360,000; z at most 128 characters.
Existing geometry is not clamped. Explicit z is preserved; legacy z derived
from view sequence can produce different hashes across folds and fails
closed rather than being guessed.

Names are trimmed, then limited to 1–80 Unicode code points. Remaining Cc
control characters are rejected. Names are not NFC-normalized or counted as
grapheme clusters; astral characters count once and combining marks separately.

previewOutcomeArrangement creates a local draft without durable authority.
The actor-bound server derives arrangementId. Submit only draft.request:

- operationId, projectId, canvasId, recipeId, name, selectedItemIds;
- expectedLayoutRevision and expectedSourceRevision.

The exact preview adds previewId, approvalHash, arrangementId, expiresAt,
before/after frames, maximumEvents=201, providerCalls=0, maximumMicrousd=0 and
changesSemantics=false. acceptOutcomeArrangementPreview validates it against
the current draft. A client object never substitutes for the retained server
preview.

Only deliberate confirmation calls prepareOutcomeArrangement with the exact
operationId, previewId, approvalHash and confirmed=true. The integrated host
uses the verified atomic transport; the shared helper remains disabled when
that transport is unavailable. No appendBatch, offline queue, chunking,
automatic rebase, optimistic movement or partial-success claim is permitted.

The server rechecks authority, selection, revisions, locks and expiry before
one all-or-none CanvasArrangementCreated plus CanvasRegisterSet position
change. Dimensions, rotation, z, source content, IDs, typed relations,
approval and provenance remain unchanged.

## Recovery, Undo and evidence limits

Close after submission retains the original operation; it does not cancel.
Unknown outcomes require exact recovery. A positive expired-review disposition
can enable an explicit guarded resolution request, never automatic Apply or
replacement. Missing or erased evidence remains unknown. The precise opt-in
read and resolution protocol is documented in
[outcome-desk-continuity-boundary.md](outcome-desk-continuity-boundary.md).

Undo uses the original canonical previous_frames, applied frames and source
identities through a separate free undo-preview and explicit atomic inverse.
Current geometry/source must still match. Generic Undo intercepts protected
groups instead of replaying individual coordinates over newer work; ordinary
Undo/Redo remains unchanged.

renderOutcomeDesk and renderOutcomeArrangementReview reuse Lit templates,
choice cards, native controls and shared tokens, without a new custom element
or public CEM contract. The existing modal foundation supplies heading,
dismissal, focus trap and return focus. Read-only inspection is not authoring
authority. EN/FR/AR/JA, bidi isolation, logical CSS, 44px targets, visible focus,
local table scrolling, forced colors and reduced motion are source contracts.

Source and isolated fixtures do not prove physical keyboard/RTL/zoom or AT,
live two-user collaboration, provider success, delivered media, ROI or
production readiness. Hosting migration procedure and actual production
schema/history remain release gates. Arrangement's zero-provider/zero-cost
contract does not settle other jobs, release uncertain holds or change the
existing media budget.
