# Canvas sibling application

Canvas is a separately routed and separately bundled project application over the existing creative substrate. It does not fork projects, documents, blocks, references, outputs, collections, generation jobs, identities, or media. Canvas composes those sources into spatial investigations without presenting a document projection as a board.

## Current internal-review surface

- Named project boards with refresh-safe `/canvas/{id}/{slug}` routes and a fluid, zoomable virtual coordinate system. The DOM-sized surface never grows beyond the viewport: a logical camera pans without bounds, while only cards intersecting the viewport and an 800px overscan buffer are mounted. Authored coordinates stay small and portable while the interaction remains effectively infinite.
- Trackpad pinch gestures are captured by the spatial viewport and continuously zoom the board around the point beneath the user’s fingers; they never scale the application page. Ordinary two-finger wheel input continues to pan, and the existing keyboard and button controls retain their stepped, center-anchored zoom behavior.
- Focus mode is a refresh-safe `/canvas/{id}/{slug}/focus` path. It removes application chrome, preserves the active board view and URL-only lenses, keeps project safeguards visible, and exits through its explicit control or Escape when no dialog is open.
- URL-only sort, semantic-facet filters, and seeded-random lenses that append no events. View controls remain hidden until the amount and shape of content make them useful.
- Placement of project documents, reusable blocks, references, prior generations, combined contexts, and Canvas-native blocks.
- One primary Add action and a compact project-intent prompt. Sending clears the composer immediately while the asynchronous LLM fabric works over every document and reusable block in the active project. Completed suggestion sets accumulate as individually dismissible cards associated with the intent and durable job receipt that produced them; they never replace earlier unread suggestions, and every proposed action remains inert until the user selects it.
- Contextual heads-up actions appear beside the current selection. Compare exists only for two or more images; combining and document preparation operate on the exact selected set. Closing the heads-up display clears selection only, while destructive removal remains a separately labeled action.
- Selecting multiple ideas also reveals a contextual organization menu. A person can compact the selection into a grid, arrange it in a row or column, or group it by content type. Each arrangement is one synchronized, undoable action; it changes presentation coordinates only and never treats spatial placement as creative truth.
- Selecting one or more generation or reference images reveals contextual smaller/larger controls. Resizing preserves aspect ratio and visual center, uses the same per-property HLC geometry registers and action-grouped history as movement, and is therefore collaborative, offline-retryable, and undoable. Every resize carries one extractable presentation receipt with source provenance, before/after frames, relative area change, and selected-item context. The receipt explicitly classifies size as organizational evidence—not generation context—while naming influence, attention, and comparison priority as possible future interpretations rather than present facts.
- Canvas rendering is deliberately two-stroke. `Create document` first turns the selected realities into an editable document card without calling an image provider. `Render…` on that card then offers one draft, one full-quality image, a four-way draft fan, or a four-way full-quality fan. The card follows durable job progress and replaces its prepared state with the latest standalone or grouped result.
- `ContextSetFormalized` can be promoted back onto the board as a reusable composite context. Nested contexts expand to their cited sources during compilation rather than flattening provenance.
- Draw creates a project-scoped Sketch block before accepting strokes, so a gesture is immediately reusable in documents, other boards, and generation context.
- Authored blocks and reference-extraction receipts are projected into view-only subject, location, palette, mood, composition, material, and lighting facets. These probes rank and organize but never silently author context.
- All 21 block types, including Sketch, through the same taxonomy used elsewhere.
- Per-property HLC geometry registers, spec-owned mergeable text operations materialized through Yjs, advisory locks, and observed-remove sketch strokes.
- Board-scoped, action-grouped Undo and Redo controls compensate durable placement, movement, removal, document/block creation, membership, and stroke operations. Redo uses fresh operation identities so idempotency and observed-remove tombstones cannot swallow a replayed action.
- Direct manipulation never waits for the advisory-lock round trip. Every completed action first enters an action-sized IndexedDB write-ahead record, projects through the same event fold immediately, and then flushes in client order. The drag preview hands off to that optimistic projection without exposing the prior position.
- IndexedDB authoring queue capped at 10,000 operations or 50 MB, warning at 80%; generation remains online-only. Complete action batches carry a monotonic client action sequence and batch index, while `client_event_id` receipts make response-loss retries idempotent.
- Every Canvas render first appends or reuses an explicit single-document `ContextSetFormalized`. Spatial arrangement is carried as provenance and explicitly marked non-semantic; image work cannot start as a side effect of selection or document preparation.
- Ephemeral `BroadcastChannel` presence that cannot append or fetch durable events.
- Visible Canvas sessions refresh the authoritative server stream on a bounded interval, so remote durable edits appear without a page reload during internal review. Local writes use a single cross-tab Web Locks flusher and the `canvas_sync` admission path; unrelated stream-head movement can no longer force a person to repeat an edit.
- Project membership receipts for users and teams; server admission restricts membership changes to administrators during the internal review.
- Report space with proposal, vote, accept, reject, and restore semantics. Arranger outputs cannot mutate authored Canvas state.
- Operations sync inspector and Replay Laboratory coverage for shared sources, convergence, document-first rendering across all four render modes, report space, governance, lifecycle, and presence minimization.

## Deliberately blocked

Canvas availability is now decided by a server-owned governance projection rather than a client role check. Administrators retain internal-review access while a requirement is pending; eligible creator and viewer roles are admitted only after every requirement is approved. Trust & Safety ownership and counsel clearance were approved on 2026-08-20. The provider-independent `fal-ideogram-v4` adapter and capability receipt are implemented; its retained entitlement reference and passing 50-item paired evaluation remain the sole pilot-availability blocker. The existing runtime also still stores authenticated creative events on per-user streams; D-0042 describes the required coordinated migration to per-project sequencing before real multi-account collaboration. BroadcastChannel provides same-browser awareness for internal UI review, not cross-device realtime collaboration.

The following plan phases therefore remain target contracts, not completed claims: Durable Object project sequencing and identity-preserving migration; full partial-batch rebase frames; cross-device presence; settled-viewport telemetry and its consent/review/forget UI; the frozen 50-item image-adapter comparison and approval; wait composer; complete agent roster; seeding modes; JIT rank-only delivery; and conditional k-anonymous organization aggregates.

## Invariants enforced now

1. Canvas is a sibling app and cannot import another application entry.
2. Canvas-native blocks remain project Library content.
3. Position and inferred organization facets are separate projections; neither silently becomes a prompt.
4. Presence, cursor paths, pointer paths, raw keys, and raw input are rejected from Canvas durable payloads.
5. Canvas selections become documents before they can incur image cost. Generation cites that document’s named Canvas context set, recursively resolves copied or composite context, and reuses the durable document job infrastructure while the board card exposes both job progress and results.
6. Lenses remain in the URL and never enter the event stream.
7. Offline and high-latency changes use complete, ordered action batches; they remain visible optimistically, survive reload, and budget work fails closed while offline.
8. Member and agent actions remain attributable and reversible by forward events.
9. Image size on a board is durable presentation state and candidate evidence, never an implicit prompt weight or authored influence claim.
10. A Canvas edit is acknowledged by `client_event_id`; a lost response may retry but may never append the edit twice.

## Next executable gate

Run at least 50 frozen same-context cases through `openai-image-v5` and `fal-ideogram-v4-v1`. Record the Fal entitlement reference, adapter/model IDs, capability receipt, corpus version, and passing evaluation report in Operations → Canvas governance. The server opens pilot access only after that record is complete; removing any approval closes it again. The keymap fixture intentionally marks missing no-pointer paths so automation cannot confuse the current internal surface with C3 completion.
