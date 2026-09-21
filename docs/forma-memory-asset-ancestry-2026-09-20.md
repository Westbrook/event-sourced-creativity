# Memory resource ancestry — 2026-09-20

## Implemented on the Memory branch

Migration **0064** adds resource-specific negative provenance for disposable private Memory
content and explicitly marked private assistant-event bodies. It is additive, contains 24 schema objects,
and does not backfill authority, enroll users, enable Apply, or register a
scheduler. No production migration has been applied.

- Existing consent-bound assistant publication automatically registers its
  consent, provider response and canonical result. The old role-specific registry
  remains authoritative; existing installations without 0064 remain supported.
- Edges retain source/target identities, custody, expiry and permanent retirement
  markers, not copied text. Registration requires a live native parent and an
  existing same-owner target in an allowed private processing/reply class. Authored
  document artifacts and ordinary authoring events cannot be registered. Edges
  do not grant access or authorize a write.
- Once a private Memory assistant event is registered, explicitly linked private
  follow-ups inherit ancestry in the actual event staging transaction. A rejected
  inheritance rolls back the event and private body. Ordinary authoring is not
  enrolled in disposable Memory retention, even if it references such an event.
- Erasing a source retires descendants and erases their private bodies. Erasing
  one child does not erase an unrelated sibling, its parent, or other document
  work. Retirement works with SQLite recursive triggers both enabled and disabled.
- Erased resources cannot be resurrected by retyping, replacement, reinsertion,
  changing their identifiers, restoring old private bodies, or deleting ancestry.
  Existing public-event append-only rules are preserved; private-body erasure
  and deletion remain supported.
- Private-content expiry is clamped to ancestry. The existing source-free Memory
  maintenance hook also retires expired descendants; it never purchases work.
- Generic private-content hydration excludes these resources even after erasure.
  Explicit semantic follow-up retains its independently checked parent exception.
  A shared-project regression exposed excessive D1 parameters; combining the
  negative registries preserves the original single parent-list binding.
- Registration is bounded to 16 direct parents, 64 ancestor nodes and 256 resource
  nodes per consumer root. A resource's ancestry cannot be expanded after it has
  descendants. Capacity failures cannot leave a partially written inherited private event.

The Drizzle schema/snapshot/journal, strict native schema fingerprints and
migration reconciliation tests include this addition. Unrecognized, partial or
modified schema fails closed.

## Verification

Verified: **79** focused runtime/privacy checks (including local D1), **100**
migration/schema checks, TypeScript and scoped ESLint. Receipts are recorded in
the independent continuation handoff. Tests cover native quote/result publication, shared/personal semantic
follow-up, diamond dependencies, private-event inheritance, authored-work preservation, scope mismatch, cycles,
ancestor/fan-out limits, expiry, schema drift, permanent tombstones and a real
local D1 event-write/withdrawal path. Provider responses and data are synthetic;
D1 outbound networking is denied. Trigger CPU/latency and hosted capacity still
need their own qualification; binding-call counts alone cannot certify them.

## Integration work still assigned to this task

This ledger is a prerequisite, not permission to expose an unsafe Apply button.
The root accepted-edit publication transaction and its current-field proof still
need to be connected. Accepted authored work needs **separate non-destructive
provenance**, not enrollment in this disposable-body registry. The original plan
requires Memory disable/rollback to preserve authored work. Before enabling Apply,
finish that distinction, explicit scope/publication review, browser invalidation
for private previews, independently authorized reuse/cross-owner custody, and
registration for private output/index consumers. Private Memory event readers
also need expiry checks before that event-publication integration is enabled. Those consumers must publish
bodies and ancestry in one guarded transaction; a standalone edge insertion is
not an authoring API. No claim is made that every output or copied field is
already covered.

Continue the [native completion matrix](forma-memory-completion-matrix-2026-09-20.md),
including autocomplete, evolving-profile consolidation, Library/Canvas coverage
and integrated qualification. These are implementation tasks, not external-only
To Dos. Hosted services, owner rollout and user enrollment remain separately
tracked in the [Sites capability checklist](forma-memory-sites-capability-todo-2026-09-18.md).
