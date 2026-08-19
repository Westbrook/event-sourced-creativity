# Canvas sibling application

Canvas is a separately routed and separately bundled application over the existing creative substrate. It does not fork projects, documents, blocks, references, outputs, collections, generation jobs, identities, or media. Canvas adds spatial placements and collaboration operations around those durable sources.

## Current internal-review surface

- Named project canvases with refresh-safe `/canvas/{id}/{slug}` routes and path-based List, Compare, and Folder views.
- URL-only sort, filter, and seeded-random lenses that append no events.
- Placement of project documents, reusable blocks, references, prior generations, and Canvas-native blocks.
- All 21 block types, including Sketch, through the same taxonomy used elsewhere.
- Per-property HLC geometry registers, spec-owned mergeable text operations materialized through Yjs, advisory locks, and observed-remove sketch strokes.
- IndexedDB authoring queue capped at 10,000 operations or 50 MB, warning at 80%; generation remains online-only.
- Explicit `ContextSetFormalized` before Canvas work can compile or generate. Spatial arrangement is carried as provenance and explicitly marked non-semantic.
- Ephemeral `BroadcastChannel` presence that cannot append or fetch durable events.
- Visible Canvas sessions refresh the authoritative server stream on a bounded interval, so remote durable edits appear without a page reload during internal review.
- Project membership receipts for users and teams; server admission restricts membership changes to administrators during the internal review.
- Report space with proposal, vote, accept, reject, and restore semantics. Arranger outputs cannot mutate authored Canvas state.
- Operations sync inspector and Replay Laboratory coverage for shared sources, convergence, formalization, report space, governance, lifecycle, and presence minimization.

## Deliberately blocked

This surface is visible only to build-team administrators. D-0053 records the blocking gate: a named Trust and Safety owner and counsel approval are absent. The existing runtime also still stores authenticated creative events on per-user streams; D-0042 describes the required coordinated migration to per-project sequencing before real multi-account collaboration. BroadcastChannel provides same-browser awareness for internal UI review, not cross-device realtime collaboration.

The following plan phases therefore remain target contracts, not completed claims: Durable Object project sequencing and identity-preserving migration; full partial-batch rebase frames; cross-device presence; settled-viewport telemetry and its consent/review/forget UI; the second image adapter and frozen 50-item comparison corpus; wait composer; complete agent roster; seeding modes; JIT rank-only delivery; and conditional k-anonymous organization aggregates.

## Invariants enforced now

1. Canvas is a sibling app and cannot import another application entry.
2. Canvas-native blocks remain project Library content.
3. Position is a separate projection; arrangement does not silently become a prompt.
4. Presence, cursor paths, pointer paths, raw keys, and raw input are rejected from Canvas durable payloads.
5. Generation cites a named Canvas context set and reuses the durable document job infrastructure.
6. Lenses remain in the URL and never enter the event stream.
7. Offline changes use complete event inputs and budget work fails closed while offline.
8. Member and agent actions remain attributable and reversible by forward events.

## Next executable gate

Assign the Trust and Safety owner, transmit the questions in `docs/consent/canvas-pilot.md` to counsel, record the findings, and only then activate the project-stream migration and full convergence program. The keymap fixture intentionally marks missing no-pointer paths so automation cannot confuse the current internal surface with C3 completion.
