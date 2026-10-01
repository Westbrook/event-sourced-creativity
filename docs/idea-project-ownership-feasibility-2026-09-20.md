# Project-owned ideas: feasibility assessment

2026-09-20 · Investigation only · Source revision `cb123538c8f38be6551565bac265ef9f9c0b36e6`

**Feasible, and a good fit for reuse within a project.** Existing idea identities and historical relationships can be preserved. The required change is to separate an idea from its use in a document; making `documentId` optional by itself would not enable multiple documents. This is a shared data-model change affecting Forma and Still, not merely a Library rename.

The recommendation is to keep each existing idea as its own project-owned entity, introduce explicit document memberships, and make future “Use in…” operations attach that entity within its project. Keep independent forks available. Do not automatically consolidate historical copies.

## Evidence and limits

The current implementation and a read-only local event database were examined. The local database contains 16,012 events across six streams, through September 3, 2026. Events were hydrated using the canonical private-payload serializer and replayed separately by stream with the current fold. No application events were appended or changed. A bounded 25-row live Sites database sample also confirmed legacy records that omit explicit project/document fields; that sample covers early history, not recent production activity.

**This is architectural feasibility plus a concrete historical-data audit, not a complete audit of today's production data.** The live database reader provides small unfiltered pages, so no production-wide counts or absence-of-conflicts claims are made.

Local findings:

- 606 `BlockCreated` events: 563 document-scoped, 39 library-scoped, four canvas-scoped. They resolve to 604 distinct stream/block identities; one identity has three creation events.
- 228 creation events omit `project_id`; 31 document-scoped creations also omit `document_id`. The canonical replay reconstructs their scope from historical state. A migration must preserve that inference rather than use today's selected project/document.
- All 604 distinct identities were recoverable in project projections when removal events were excluded for this diagnostic. This does not authorize restoring removed content; the diagnostic only checks historical attribution.
- 23 creation events carry copy/source-block lineage: 19 `copied_from_block_id`, four `source_block_id`. All referenced source blocks resolved in the same stream. Five pairs differ in current text; at least one copied target has a later edit. Text equality would not prove shared identity either.
- 141 relationship creation events include four `context_contains`, six `artifact_contains`, and 131 reference relationships. All endpoints resolved in the historical diagnostic.
- Three block IDs occur in more than one stream. Identity must retain owner/stream context; a migration must not treat a bare block ID as globally unique.

## What is already compatible

`CreativeBlock` already includes `projectId`, a single `documentId`, `canvasId`, and an exclusive document/library/canvas scope. Library ideas already have an empty document ID. The current `libraryBlocks` projection gathers the selected project's surviving document, library and canvas blocks. Project-level ownership is therefore partly present already.

Still's “Use in…” links existing ideas when source and destination are in the same document. Across documents it creates new IDs, copies the dependency graph, remaps group IDs and references, and records lineage. Its confirmation explicitly promises an independent copy. Another “Reuse idea” path and Forma's library-copy workflow also create blocks; all must follow the same new contract.

The proposed conceptual structure is:

| Record | Responsibility |
| --- | --- |
| Project-owned idea | Stable identity, shared content, history and provenance |
| Document membership/use | Document, idea, order, inclusion and any document-specific settings; optionally an adopted revision |
| Idea relationship | Shared intrinsic relationship, or explicitly scoped composition relationship |
| Generation/result | Original document and exact input snapshot/revisions used for that execution |

An idea may have zero, one or many document memberships. The project Ideas view lists ideas regardless of membership. Canvas placements are another form of use and should retain their existing identities and layout.

## Relationships endangered by a naive change

| Area | Existing dependency and required preservation |
| --- | --- |
| Document content and Library visibility | Both are derived from `scope` plus one `documentId`. Clearing those fields without membership-aware readers would make ideas disappear from documents. Conversely, promoting everything could resurface ideas hidden by document removal. |
| Per-document behavior | Position, weight, locks and properties live on the block. Sharing the block would share those values. Decide which are intrinsic and which belong to a use; do not let “disable here” become “disable everywhere” accidentally. |
| Compound ideas | Composition guards require compatible documents and forbid cycles and duplicate edges. Order, action participants, reference groups and nested dependencies are meaningful. Merely allowing cross-document endpoints does not define their document-specific meaning. |
| Generation and approvals | Document snapshots select by block document ID and retain source event references and versions. Membership and shared-content changes must invalidate affected future reviews/caches while preserving old submitted snapshots, jobs and results. |
| Removal, restoration and undo | `BlockRemoved` removes the entity; `DocumentRemoved` hides its scoped blocks. “Remove from this document” needs its own meaning. Undoing attachment must not delete the shared idea. Project-wide deletion needs an explicit policy for remaining uses. |
| Provenance and identity | Copy lineage, source documents, generated-output references, compilation versions and canvas placements point to existing IDs. Preserve IDs and origin records even when current membership changes. Origin document is not current ownership. |
| Permissions and custody | Project resource scopes already fit same-project sharing, but writes, media checks and authoring proofs also bind document/canvas scope. Cross-project reuse cannot become an unrestricted reference just because both documents are visible. |
| Protected block types | Still's editable-idea predicate excludes references, 3D, action and Output blocks, locks, governed context and rights-restricted content. The proposal needs an explicit scope; a generic conversion of every block bypasses meaningful distinctions. |
| Output requirements and governed packages | Output requirements have dedicated revision/authorization rules. Organization context packages have versioned document bindings and separate source/target identities. Share reusable intent without conflating document-specific plans, approvals or fulfillment. |
| Filing, routes and readers | Collection filing can be inherited through a block's document; current idea URLs include document IDs. Fast route reads, event allowlists, history summaries, permissions, counts and cached projections need membership-aware behavior. |

The broader Forma Library also contains generated results, artifacts, families and a kept set. Turning its ideas section into the project's Ideas view is straightforward conceptually; removing the broader Library requires an explicit destination for those other functions.

## Decisions that matter most

**Live edits or adopted versions?** Editing one live shared idea can change every document using it. A useful distinction is “edit shared idea,” “change this use,” and “fork an independent idea.” Revision pinning can protect completed documents but introduces update notices and adoption state. Project ownership does not require every use to follow the latest version automatically.

**Where does composition belong?** A character's defining attributes may belong to the shared idea; its placement in a particular scene may belong to a document use. If one document can combine A into B and another B into A, decide whether that is an invalid global cycle or valid separate compositions. Attaching a parent also needs a defined policy for its children, reference dependencies and future additions. Deduplicate traversal so shared children are not counted twice in generation context.

**Does the same idea appear more than once in one document?** A unique document/idea membership suffices only if there is at most one use per document. Different roles, placements or settings require distinct use IDs. Existing composition edge uniqueness does not supply this automatically.

**What survives deletion?** Document removal should usually remove memberships while preserving an idea used elsewhere. Existing removed documents must not suddenly contribute visible ideas during migration. Erasure, retention and unavailable private/media content remain authoritative; project ownership cannot recreate missing bytes.

**What is the sharing boundary?** Same-project documents are the natural first scope. Cross-project use can remain an independent copy or an explicitly governed versioned import. Source authorship, tenant custody and project ownership are separate concepts.

## Hard, and in some cases impossible

- **Hard but tractable: preserve old behavior while changing future writes.** Introduce the entity/use distinction, replay legacy events under their original semantics, and update all consumers. Old clients must not interpret a per-document detach as a global remove. Coherent mixed-version rollout and rollback need explicit design.
- **Hard: migrate location-specific state and dependency graphs.** Today's block properties mix reusable meaning with local settings. There is no automatic universal rule for which property belongs where. Concurrent shared edits also require affected-use discovery and reliable stale-review detection.
- **Hard: maintain historical fidelity.** Existing event IDs, sequence, causation, compensations, snapshots and private-payload bindings should remain intact. Use a compatibility projection and/or explicit transition events instead of rewriting original history. Persistent projection/cache formats need versioning and invalidation.
- **Impossible to infer reliably: which historical copies were intended to stay synchronized.** Lineage says “derived from,” not “is the same mutable entity.” Divergent copies cannot all become one current value without choosing a winner, introducing variants, or preserving separate identities.
- **Impossible without additional state: both universal live sharing and independent local edits.** Those promises conflict unless local overrides, version pins or forks exist.
- **Impossible from metadata alone: recreate erased source bodies or missing media.** An event log may retain provenance after private content has been erased. This limits reconstruction independently of ownership.
- **Not losslessly reversible: collapse new multi-document usage back to today's single document field.** Rollback would need a compatibility layer or copies plus identity mappings.

## Reasons not to make the change

Independent copies may be the right product behavior when documents represent experiments, alternatives or approved deliverables. Shared mutation creates a wider effect from every edit and adds explanations, update controls and conflict decisions. Those costs could work against Still's minimal interface.

The migration also has a broad regression surface: both applications, backend guards, generators, private content, readers and operational caches depend on the current shape. Fewer duplicate blocks do not automatically mean faster startup or generation; membership expansion and invalidation add work. If reuse is uncommon, the engineering and interaction cost may exceed the benefit.

A smaller alternative is to make Library the project's Ideas view now, improve provenance and navigation, and retain independent copies. Project ownership, live linking, and historical deduplication are separate decisions; they do not have to ship together.

## Recommended boundary if this proceeds later

Preserve existing identities and copies. Derive each legacy idea's project and initial use from canonical ordered history, respecting removals and prior scopes. Add explicit memberships for future same-project use. Retain independent fork and cross-project copy semantics. Keep execution provenance document-bound and frozen at submission. Treat protected types and governed imports separately until their contracts are designed.

Before implementation, perform a coherent full production read audit covering implicit scopes, duplicate IDs, divergent copy lineage, removed entities, unresolved graph endpoints, missing private/media content, governed blocks and cross-project references. Then verify replay parity and the key scenarios: a shared edit affects only intended uses; detach/undo preserves other uses; deletion does not resurrect content; generation reviews invalidate correctly; historical outputs and permissions remain intact.

No product implementation, event migration or deployment was performed.

## Source evidence

- `src/model/events.ts:33`, `:324`, `:370`, `:631` — block model, creation/rehoming, collection membership and visible projections.
- `src/still/use-in.ts:31`, `:44`; `src/still/use-in-flow.ts:40` — linking versus complete independent copies and review wording.
- `src/still/app.ts:719`; `src/state/store.ts:5318` — other reuse/copy entry points.
- `src/model/combined-context.ts:145`; `src/still/composition.ts:6` — graph constraints and editable-idea exclusions.
- `src/still/context.ts:8`; `src/model/document-jobs.ts:238` — source snapshots and revision computation.
- `worker/context-authoring-authority.ts:20`; `worker/project-access.ts:1101`, `:1140` — scope, custody, references and authority.
- `worker/still-route-read.ts:6`; `src/still/routes.ts:95` — document-filtered reads and address validation.
- `worker/output-requirement-event-guards.ts:96`; `src/model/output-requirement-copy.ts:31` — special requirement semantics.
- `db/schema.ts:37`, `:189`, `:265`, `:322`, `:808` — erasable payloads, retention, governed versions, bindings and project scopes.
- `src/canvas/model.ts:294`; `src/components/forma-library.ts:770` — placements and broader Library content.
- `worker/event-read-primitives.ts:3` — canonical hydration of private event payloads.
