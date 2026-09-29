# Independently authorized cross-owner project nesting

## Native implementation

Additive migration0066 introduces explicit organization containment edges keyed
by **owner and project**, with no backfill, enrollment, inherited membership or
publication. The existing Project hierarchy control requests the new versioned
view and presents owner-qualified choices. Personal projects and installations
without the extension keep their old contract; an extended organization requires
the versioned view rather than falsely presenting a cross-owner child as a root.

The child owner must have current authoring permission. Every candidate parent
requires separate current read and authoring permission in the same organization.
An editor of another owner's project cannot reparent it. Inaccessible ancestors
are not disclosed, and no path crosses an unreadable intermediate node.

A bounded combined forest includes at most eight owners,256 projects and16 levels.
All owner inventories, declaration identities, custody, edges, source schema and
current principal records are replayed in the native transaction. Exact revision
comparison prevents stale moves. Combined depth and cycles are also rejected by
SQLite triggers, including cycles across old same-owner and new cross-owner edges.
Edges are removed on affected custody/migration/declaration changes. They do not
return when custody is later restored.

Native edge selection is capped before hydration at257 rows and256KiB. Each
owner's existing declaration reader retains its256-project/1MiB bound. Mutations
use strict4KiB control parsing. Wall and monotonic clocks, current grant expiry,
context-session expiry and the original30-second deadline bound disclosure and
writes. An uncertain write requires explicit refresh, never automatic replay.

## Memory integration

Only separately explicit **organization recall** may traverse another owner's
nesting. Existing document, project, project-tree and partition consent never
silently broaden. Eligible nested sources receive project-tree relevance while
retaining independently proved source and target custody, current permissions and
owner-qualified identity. The combined graph revision is bound into saved context
and the real specialist provider request.

Changing or deleting a structural edge permanently dismisses affected saved
cross-scope contexts and retires their private descendant copies. Deliberately
authored work and independently retained financial receipts survive. All relevant
same-owner structural mutations also retire the organization-level graph use.
Neither an edge nor a copied ID is authority to consume private Memory.

## Verification

- 80 integrated native recall/context/publication/nesting checks pass.
- 58 hierarchy and recall model/client checks pass.
- 14 actual built Chromium checks pass, including English desktop and Arabic320px
 owner-qualified moves. The Arabic layout was visually inspected.
- Additive0066 preserves retained rows, passes foreign-key checks and reruns exactly.
- Actual isolated D1 verifies the nested source in the approved assistant prompt,
 one synthetic provider response, and retirement of all private result copies when
 the edge is removed. Usage remains recorded.
- 18 final focused native schema/capacity/expiry/consumer cases and752 existing
 control/client regressions pass. Types, scoped lint and the production build pass.

The initial legacy browser failure was an assertion race: it tested expiry before
the move response was acknowledged. The test now awaits the actual saved status;
an in-flight interruption correctly remains an uncertain mutation.

These are synthetic local source checks, not hosted capacity, real-provider,
production migration, deployment or enrollment qualification. The remaining native
work stays in the [completion matrix](forma-memory-completion-matrix-2026-09-20.md).
