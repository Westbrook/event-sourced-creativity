# Native project containment — 2026-09-19

Status: implemented on the local Memory branch. Not merged, deployed, migrated,
qualified on hosted infrastructure, or activated for real users.

## Delivered

Projects now have a native containment store and explicit hierarchy control. An
owner can nest, reparent, or detach projects in the same personal/organization
custody partition. Both endpoints must belong to the same owner; this does not
transfer ownership. The graph admits at most 256 declared projects per owner and
16 project levels. Validation checks the whole forest, including descendant depth
when moving a subtree. It rejects duplicate/missing declarations, cycles,
compensated declarations, ambiguous custody and cross-organization placement.

`GET /api/projects/containment?projectId=…` returns only independently readable
ancestors. A missing ancestor grant stops the path before disclosing its ID;
access to a child never grants access to its parent or vice versa. Shared readers
cannot edit containment. Candidate parents require the owner's independent
read/author authority. An opaque selected-project context cannot be used for a
different child project. Containment is not Memory enrollment or permission.

`PATCH /api/projects/containment` requires the exact native revision from a fresh
read. The transaction rechecks the principal, configured pilot entry, selected
session, exact schema, full bounded declaration/custody/edge snapshot and deadline.
It applies the move and verifies the resulting revision. A stale edit cannot
silently overwrite another move. Missing or malformed delivery acknowledgements
are uncertain, not a retry authorization. SQL triggers independently reject
cycles/depth overflow, invalid declarations, compensation and mismatched custody.

The additive `0058_project_containment.sql` migration has a generated Drizzle
snapshot and exact optional-schema fingerprint. It performs no data backfill,
activation, runtime DDL or existing migration rewrite. Organization-project custody
changes detach affected links; unrelated metadata updates do not. Declaration
compensation retires links. Native declaration/user/organization foreign keys and
organization-project deletion handle removal without deleting unrelated structures.
The guest-result schema inventory recognizes only this exact optional schema.

The Projects control is localized in English, French, Arabic and Japanese. It
loads only on explicit opening/refresh, explains the absence of access/consent
inheritance, and requires an explicit save. Its 30-second display/request lifetime
uses wall and monotonic clocks. Route, authorization, source retirement, visibility
and disconnect clear its private view and abort pending work. An unconfirmed move
requires a fresh read; it is never automatically resubmitted. No request reaches a
provider and no Memory flags or grants change.

## Verification

- 126 selected hierarchy/client/model/retirement checks and 219 existing native
  artifact/block/rename checks pass. Native HTTP tests cover personal/governed
  reparenting, detach, cycles, stale
  revisions, compensation, custody changes, tenant removal, altered schemas,
  duplicate/oversized/cross-origin commands and lost acknowledgements.
- A child-only collaborator cannot discover a parent. An independent parent grant
  permits the path; revoking it hides the parent again without changing the child.
- Native SQL compiles with D1's expression-depth 100, function-argument 32,
  parameter 100 and statement-byte 100,000 limits. The measured whole GET uses
  **14 statements**; PATCH uses **17**, including repeated final checks. This is
  local SQLite limit verification, not hosted capacity qualification.
- Four whole-app synthetic browser checks pass: explicit move/detach and uncertain
  delivery recovery in desktop English and 320px Arabic. Both screenshots were
  visually inspected. No real account, database or provider was used in the browser.
- Three selected guest inventory checks accept the exact optional schema and reject
  drift. Typecheck, scoped lint, localization, custom-element manifests and the
  production build are checked separately. Existing chunk-size warnings remain.

Evidence is retained locally in `.wrangler/memory-containment-*.log` and
`.wrangler/memory-containment-{en,ar}.png`; release qualification is not implied.

## Remaining integration — not completed by this feature

This is real native project containment, not yet ancestry-backed semantic recall.
Existing document-local Memory identities/results retain their v1 contract and
`projectAncestry: unresolved`; they do not silently acquire parent authority.
A future cross-scope consumer must capture and replay the native forest witness,
independently prove every source's access and Memory consent, persist its original
scope provenance, and retire ancestry-dependent results/index entries after moves.
The `readNativeProjectContainment` server helper exposes replayable guards for that
integration; its IDs alone are never an access proof.

Cross-owner nesting, broader page/library/canvas identities, long-term and
cross-document semantic reconciliation, durable assistant/autocomplete provenance,
and whole-system privacy qualification remain implementation work in the original
plan. They are not external-service prerequisites and are not marked complete.
Hosted adapters/scheduling/provider qualification, benchmark cap and explicit user
enrollment remain separate operational gates. See the current
[native continuation](forma-memory-native-continuation-2026-09-18.md) and
[Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).

## Subsequent integration

[Native cross-scope recall](forma-memory-cross-scope-recall-2026-09-19.md) now consumes this hierarchy with separate source-side consent and independent source/target access. These bounded views do not confer durable publication authority or erase independently valid document-local results when projects move.
