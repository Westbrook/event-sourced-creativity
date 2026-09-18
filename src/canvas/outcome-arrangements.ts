import { organizeCanvasItems, type CanvasArrangementFrame, type CanvasItem, type CanvasProjection } from "./model.ts";
import type { CreativeEvent, CreativeProjection } from "../model/events.ts";
import { outcomeRecipe, type OutcomeRecipeId } from "../model/outcome-recipes.ts";

export type OutcomeArrangementIssue =
  | "unavailable" | "selection" | "locked" | "geometry" | "name" | "identity"
  | "changed" | "confirmation" | "already-recorded" | "atomic-unavailable" | "atomic-limit" | "expired";
export type OutcomeArrangementResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: OutcomeArrangementIssue };
const fail = (issue: OutcomeArrangementIssue): OutcomeArrangementResult<never> => ({ ok: false, issue });
const compareId = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const safeId = (id: string) => typeof id === "string" && id.length > 0 && id.length <= 256
  && Array.from(id).every((character) => { const code = character.charCodeAt(0); return code > 0x1f && code !== 0x7f; });
const stableIds = (ids: readonly string[]) => [...new Set(ids)].sort(compareId);
const frame = (item: Pick<CanvasItem, "id" | "x" | "y" | "w" | "h">): CanvasArrangementFrame =>
  ({ itemId: item.id, x: item.x, y: item.y, w: item.w, h: item.h });
const validGeometry = (item: Pick<CanvasItem, "x" | "y" | "w" | "h" | "rot">) =>
  [item.x, item.y, item.w, item.h, item.rot].every(Number.isFinite)
  && Math.abs(item.x) <= 1_000_000 && Math.abs(item.y) <= 1_000_000 && Math.abs(item.rot) <= 360_000
  && item.w >= 120 && item.h >= 90 && item.w <= 8192 && item.h <= 8192;
function uniqueIndex<T extends { id: string }>(values: readonly T[]): Map<string, T | null> {
  const index = new Map<string, T | null>();
  for (const value of values) index.set(value.id, index.has(value.id) ? null : value);
  return index;
}

/** Selection is a set; order is display state, never narrative/source membership. */
export function outcomeArrangementSelectionIds(ids: readonly string[]): readonly string[] | null {
  if (ids.length < 2 || ids.length > 100 || ids.some((id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9:_-]{0,119}$/iu.test(id)) || new Set(ids).size !== ids.length) return null;
  return [...ids].sort(compareId);
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : canonicalValue(item));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareId(left, right)).map(([key, item]) => [key, canonicalValue(item)]));
  }
  throw new Error("outcome_arrangement_manifest_invalid");
}
const canonicalJson = (value: unknown) => JSON.stringify(canonicalValue(value));

/**
 * Guard manifests, NOT generation inputs. Both client and worker use the same
 * authorized project projection. No sequence/createdSequence/asOfSequence,
 * private prompts, inputRef, provider receipts or generated-source substitution.
 * Authored properties, typed relationships and ordered context members survive.
 */
export function outcomeArrangementManifests(
  projection: CreativeProjection, canvas: CanvasProjection, selectedItemIds: readonly string[],
): OutcomeArrangementResult<{ layout: unknown; sources: unknown }> {
  const ids = outcomeArrangementSelectionIds(selectedItemIds);
  if (!ids) return fail("selection");
  if (!canvas.projectId || projection.projectId !== canvas.projectId || !canvas.selectedCanvasId) return fail("unavailable");
  const boards = canvas.canvases.filter((board) => board.id === canvas.selectedCanvasId && board.projectId === canvas.projectId && !board.removed);
  if (boards.length !== 1) return fail("unavailable");
  const board = boards[0]!;
  const boardItems = canvas.items.filter((item) => item.canvasId === board.id && item.projectId === board.projectId);
  const itemIndex = uniqueIndex(boardItems);
  if (itemIndex.size !== boardItems.length || boardItems.some((item) => !validGeometry(item) || typeof item.z !== "string" || item.z.length > 128)) return fail("geometry");
  const chosen = ids.map((id) => itemIndex.get(id));
  if (chosen.some((item) => !item || item.removed || !item.visible)) return fail("selection");
  const documentIndex = uniqueIndex(projection.documents.filter((document) => document.projectId === board.projectId));
  const blockIndex = uniqueIndex(projection.libraryBlocks.filter((block) => block.projectId === board.projectId));
  const outputIndex = uniqueIndex(projection.libraryOutputs);
  const artifactIndex = uniqueIndex(projection.libraryArtifacts);
  const contextIndex = uniqueIndex(canvas.contextSets.filter((context) => context.projectId === board.projectId));
  const relations = projection.libraryBlockRelations.filter((relation) => relation.projectId === board.projectId && !relation.removed);
  if (uniqueIndex(relations).size !== relations.length) return fail("selection");
  const linked = new Map<string, typeof relations>();
  for (const relation of relations) {
    for (const id of new Set([relation.fromBlockId, relation.toBlockId])) linked.set(id, [...(linked.get(id) ?? []), relation]);
  }
  const records = new Map<string, unknown>(), completeDocuments = new Set<string>();
  const addDocumentIdentity = (id: string) => {
    const document = documentIndex.get(id);
    if (!document || document.removed) return false;
    records.set("document:" + id, { kind: "document", id: document.id, projectId: document.projectId,
      title: document.title, handle: document.handle, sourceEvents: stableIds(document.sourceEvents) });
    return true;
  };
  const addBlock = (id: string): boolean => {
    if (records.has("block:" + id)) return true;
    const block = blockIndex.get(id);
    if (!block || block.removed || block.documentId && !addDocumentIdentity(block.documentId)) return false;
    records.set("block:" + id, { kind: "block", id: block.id, projectId: block.projectId, documentId: block.documentId,
      canvasId: block.canvasId, scope: block.scope, type: block.type, handle: block.handle, position: block.position,
      locked: block.locked, properties: block.properties, sourceEvents: stableIds(block.sourceEvents) });
    for (const relation of linked.get(id) ?? []) {
      records.set("relation:" + relation.id, { kind: "relation", id: relation.id, projectId: relation.projectId,
        documentId: relation.documentId, fromBlockId: relation.fromBlockId, toBlockId: relation.toBlockId,
        relationKind: relation.kind, properties: relation.properties, sourceEvents: stableIds(relation.sourceEvents) });
      if (!addBlock(relation.fromBlockId) || !addBlock(relation.toBlockId)) return false;
    }
    return true;
  };
  const addDocument = (id: string): boolean => {
    if (completeDocuments.has(id)) return true;
    if (!addDocumentIdentity(id)) return false;
    completeDocuments.add(id);
    for (const block of projection.libraryBlocks) {
      if (block.projectId === board.projectId && block.documentId === id && !block.removed && !addBlock(block.id)) return false;
    }
    return true;
  };
  const addOutput = (id: string): boolean => {
    if (records.has("output:" + id)) return true;
    const output = outputIndex.get(id);
    if (!output || output.discarded || !addDocument(output.documentId)) return false;
    records.set("output:" + id, { kind: "output", id: output.id, documentId: output.documentId,
      canvasId: output.canvasId, contextSetId: output.contextSetId, generationId: output.generationId,
      title: output.title, mediaUrl: output.mediaUrl, mediaType: output.mediaType, width: output.width, height: output.height,
      quality: output.quality, purpose: output.purpose, sourceEventId: output.sourceEventId,
      promotedFromId: output.promotedFromId, promotedFromEventId: output.promotedFromEventId });
    return true;
  };
  const addArtifact = (id: string): boolean => {
    if (records.has("artifact:" + id)) return true;
    const artifact = artifactIndex.get(id);
    if (!artifact || !addDocument(artifact.documentId)) return false;
    records.set("artifact:" + id, { kind: "artifact", id: artifact.id, documentId: artifact.documentId,
      format: artifact.kind, title: artifact.title, summary: artifact.summary, contentRef: artifact.contentRef,
      items: artifact.items.map((item) => ({ id: item.id, title: item.title, body: item.body, notes: item.notes,
        contextGroupIds: item.contextGroupIds, sceneId: item.sceneId, narrativeOrder: item.narrativeOrder,
        generationOrder: item.generationOrder, durationSeconds: item.durationSeconds, mediaUrl: item.mediaUrl,
        mediaType: item.mediaType, width: item.width, height: item.height, slide: item.slide })),
      itemCount: artifact.itemCount, mediaUrl: artifact.mediaUrl, mediaType: artifact.mediaType,
      presentation: artifact.presentation, sourceEventId: artifact.sourceEventId });
    return true;
  };
  const addContext = (id: string): boolean => {
    if (records.has("context:" + id)) return true;
    const context = contextIndex.get(id);
    if (!context) return false;
    records.set("context:" + id, { kind: "context", id: context.id, canvasId: context.canvasId,
      name: context.name, role: context.role, target: context.target, application: context.application,
      relativity: context.relativity, itemIds: context.itemIds, blockIds: context.blockIds,
      documentIds: context.documentIds, outputIds: context.outputIds, sourceEventId: context.sourceEventId });
    for (const blockId of context.blockIds) if (!addBlock(blockId)) return false;
    for (const documentId of context.documentIds) if (!addDocument(documentId)) return false;
    for (const outputId of context.outputIds) if (!addOutput(outputId)) return false;
    for (const itemId of context.itemIds) {
      const member = itemIndex.get(itemId);
      if (!member || !addSource(member)) return false;
    }
    return true;
  };
  const addSource = (item: CanvasItem): boolean => {
    // Canvas text/sketch projections do not append their edits to item.sourceEvents.
    // Guard their actual retained body/strokes separately from nonsemantic geometry.
    records.set("canvas-source:" + item.id, { kind: "canvas-source", itemId: item.id,
      sourceKind: item.sourceKind, sourceId: item.sourceId, title: item.title, body: item.body,
      blockType: item.blockType, strokes: item.strokes });
    if (item.sourceKind === "document") return addDocument(item.sourceId);
    if (item.sourceKind === "output") return addOutput(item.sourceId);
    if (item.sourceKind === "artifact") return addArtifact(item.sourceId);
    if (item.sourceKind === "context") return addContext(item.sourceId);
    return addBlock(item.sourceId);
  };
  try {
    for (const item of chosen) if (!addSource(item!)) return fail("selection");
    const layout = canonicalValue({
      version: 1, projectId: board.projectId, canvasId: board.id,
      board: { name: board.name, slug: board.slug, sourceEvents: stableIds(board.sourceEvents) },
      items: [...boardItems].sort((left, right) => compareId(left.id, right.id)).map((item) => ({
        id: item.id, sourceKind: item.sourceKind, sourceId: item.sourceId, x: item.x, y: item.y, w: item.w, h: item.h,
        rot: item.rot, z: item.z, visible: item.visible, removed: item.removed, sourceEvents: stableIds(item.sourceEvents),
      })),
    });
    const sources = canonicalValue({ version: 1, projectId: board.projectId, selectedItemIds: ids,
      records: [...records].sort(([left], [right]) => compareId(left, right)).map(([, value]) => value) });
    return { ok: true, value: { layout, sources } };
  } catch { return fail("selection"); }
}

/** Web Crypto only: deterministic SHA-256, no storage, time, network or provider. */
export async function outcomeArrangementRevisions(
  projection: CreativeProjection, canvas: CanvasProjection, selectedItemIds: readonly string[],
): Promise<OutcomeArrangementResult<{ layoutRevision: string; sourceRevision: string }>> {
  const manifests = outcomeArrangementManifests(projection, canvas, selectedItemIds);
  if (!manifests.ok) return manifests;
  const digest = async (value: unknown) => {
    const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
    return "sha256:" + [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const [layoutRevision, sourceRevision] = await Promise.all([digest(manifests.value.layout), digest(manifests.value.sources)]);
  return { ok: true, value: { layoutRevision, sourceRevision } };
}

export type OutcomeArrangementContext = {
  readonly canvas: CanvasProjection; readonly authorityKey: string; readonly actorId: string; readonly siteId: string;
  readonly canRead: boolean; readonly canArrange: boolean; readonly atomicTransportAvailable: boolean;
  readonly layoutRevision: string; readonly sourceRevision: string; readonly selectedItemIds: readonly string[];
  /** Authorized canonical events, required only when reviewing grouped Undo. */
  readonly events?: readonly CreativeEvent[];
};
export type OutcomeArrangementPreviewRequest = {
  readonly operationId: string; readonly projectId: string; readonly canvasId: string;
  readonly recipeId: OutcomeRecipeId; readonly name: string; readonly selectedItemIds: readonly string[];
  readonly expectedLayoutRevision: string; readonly expectedSourceRevision: string;
  readonly undoOperationId?: string;
};
export type OutcomeArrangementDraft = {
  readonly request: OutcomeArrangementPreviewRequest; readonly authorityKey: string; readonly actorId: string;
  readonly before: readonly CanvasArrangementFrame[]; readonly after: readonly CanvasArrangementFrame[];
};
export type OutcomeArrangementPreview = OutcomeArrangementPreviewRequest & {
  readonly previewId: string; readonly approvalHash: string; readonly arrangementId: string; readonly expiresAt: string;
  readonly before: readonly CanvasArrangementFrame[]; readonly after: readonly CanvasArrangementFrame[];
  readonly maximumEvents: number; readonly providerCalls: 0; readonly maximumMicrousd: 0; readonly changesSemantics: false;
};
export type OutcomeArrangementReview = { readonly draft: OutcomeArrangementDraft; readonly preview: OutcomeArrangementPreview };
export type OutcomeArrangementApplyRequest = OutcomeArrangementPreviewRequest & {
  readonly previewId: string; readonly approvalHash: string; readonly confirmed: true;
};
const revisionPattern = /^sha256:[0-9a-f]{64}$/u;
const requestIdentity = (value: string) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/u.test(value);
const freezeFrames = (frames: readonly CanvasArrangementFrame[]) => Object.freeze(frames.map((value) => Object.freeze({ ...value })));

/** Optional local preview, never a server receipt and never an apply request. */
export function previewOutcomeArrangement(current: OutcomeArrangementContext, choice: {
  readonly recipeId: OutcomeRecipeId; readonly name: string; readonly operationId: string;
}): OutcomeArrangementResult<OutcomeArrangementDraft> {
  const recipe = outcomeRecipe(choice.recipeId), ids = outcomeArrangementSelectionIds(current.selectedItemIds);
  if (!recipe || !requestIdentity(choice.operationId)) return fail("identity");
  const name = choice.name.trim();
  if (!name || Array.from(name).length > 80 || /\p{Cc}/u.test(name)) return fail("name");
  const canvas = current.canvas;
  if (!current.canRead || !current.authorityKey || !current.actorId || !current.siteId
    || !revisionPattern.test(current.layoutRevision) || !revisionPattern.test(current.sourceRevision)
    || !canvas.projectId || !canvas.selectedCanvasId
    || !canvas.canvases.some((board) => board.id === canvas.selectedCanvasId && board.projectId === canvas.projectId && !board.removed)) return fail("unavailable");
  if (!ids) return fail("selection");
  const items: CanvasItem[] = [];
  for (const id of ids) {
    const matches = canvas.items.filter((item) => item.id === id);
    if (matches.length !== 1) return fail("selection");
    const item = matches[0]!;
    if (item.canvasId !== canvas.selectedCanvasId || item.projectId !== canvas.projectId || item.removed || !item.visible) return fail("selection");
    if (item.lockedBy && item.lockedBy !== current.siteId) return fail("locked");
    if (!validGeometry(item) || typeof item.z !== "string" || item.z.length > 128) return fail("geometry");
    items.push(item);
  }
  const positions = organizeCanvasItems(items, recipe.arrangement), before = items.map(frame);
  const after = items.map((item) => ({ ...frame(item), ...positions.get(item.id)! }));
  if (after.some((item) => !validGeometry({ ...item, rot: 0 }))) return fail("geometry");
  return { ok: true, value: Object.freeze({
    request: Object.freeze({ operationId: choice.operationId, projectId: canvas.projectId, canvasId: canvas.selectedCanvasId,
      recipeId: recipe.id, name, selectedItemIds: Object.freeze([...ids]),
      expectedLayoutRevision: current.layoutRevision, expectedSourceRevision: current.sourceRevision }),
    authorityKey: current.authorityKey, actorId: current.actorId, before: freezeFrames(before), after: freezeFrames(after),
  }) };
}

/** A protected group must never become generic per-event/offline Undo writes. */
export function isProtectedOutcomeArrangementEvent(event: CreativeEvent, actorId?: string): boolean {
  return event.payload.source_surface === "canvas-outcome-arrangement"
    && (!actorId || event.actor === "user:" + actorId && event.payload.history_owner_id === actorId);
}

/** Derive completed Undo groups from the existing canonical event ledger only. */
export function outcomeArrangementUndoneActions(events: readonly CreativeEvent[], canvasId: string, actorId: string): ReadonlySet<string> {
  const groups = events.filter((event) => event.type === "CanvasArrangementCreated"
    && isProtectedOutcomeArrangementEvent(event, actorId) && event.payload.canvas_id === canvasId);
  const byId = new Map(groups.map((event) => [String(event.payload.arrangement_id), event]));
  const undone = new Set<string>();
  for (const event of groups) {
    const original = byId.get(String(event.payload.undo_of_arrangement_id ?? ""));
    if (!original || original.sequence >= event.sequence) continue;
    undone.add(String(original.payload.history_action_id));
    undone.add(String(event.payload.history_action_id));
  }
  return undone;
}

/** The inverse must come from the original canonical group, never client-invented positions. */
export function previewOutcomeArrangementUndo(current: OutcomeArrangementContext, choice: {
  readonly recipeId: OutcomeRecipeId; readonly name: string; readonly operationId: string; readonly undoOperationId: string;
}): OutcomeArrangementResult<OutcomeArrangementDraft> {
  if (!requestIdentity(choice.undoOperationId) || choice.undoOperationId === choice.operationId) return fail("identity");
  const ordinary = previewOutcomeArrangement(current, choice);
  if (!ordinary.ok) return ordinary;
  const originals = (current.events ?? []).filter((event) => event.type === "CanvasArrangementCreated"
    && isProtectedOutcomeArrangementEvent(event, current.actorId)
    && event.payload.project_id === current.canvas.projectId && event.payload.canvas_id === current.canvas.selectedCanvasId
    && event.payload.history_action_id === choice.undoOperationId && event.payload.organization_action_id === choice.undoOperationId);
  if (originals.length !== 1) return fail("unavailable");
  const original = originals[0]!, payload = original.payload, ids = ordinary.value.request.selectedItemIds;
  if (payload.recipe_id !== choice.recipeId || canonicalJson(payload.item_ids) !== canonicalJson(ids)
    || !Array.isArray(payload.previous_frames) || !Array.isArray(payload.frames) || !Array.isArray(payload.source_items)
    || payload.previous_frames.length !== ids.length || payload.frames.length !== ids.length || payload.source_items.length !== ids.length) return fail("changed");
  const previous = payload.previous_frames as Record<string, unknown>[], applied = payload.frames as Record<string, unknown>[];
  const sources = payload.source_items as Record<string, unknown>[], after: CanvasArrangementFrame[] = [];
  for (let index = 0; index < ids.length; index++) {
    const item = current.canvas.items.find((candidate) => candidate.id === ids[index])!;
    const before = previous[index], expected = applied[index], source = sources[index];
    if (!before || !expected || !source || before.item_id !== item.id || expected.item_id !== item.id || source.item_id !== item.id
      || source.source_kind !== item.sourceKind || source.source_id !== item.sourceId || source.rot !== item.rot || source.z !== item.z
      || expected.x !== item.x || expected.y !== item.y || expected.w !== item.w || expected.h !== item.h
      || before.w !== item.w || before.h !== item.h
      || !validGeometry({ x: before.x as number, y: before.y as number, w: before.w as number, h: before.h as number, rot: item.rot })) return fail("changed");
    after.push({ itemId: item.id, x: before.x as number, y: before.y as number, w: item.w, h: item.h });
  }
  return { ok: true, value: Object.freeze({ ...ordinary.value,
    request: Object.freeze({ ...ordinary.value.request, undoOperationId: choice.undoOperationId }), after: freezeFrames(after) }) };
}

function currentDraft(draft: OutcomeArrangementDraft, current: OutcomeArrangementContext) {
  if (draft.authorityKey !== current.authorityKey || draft.actorId !== current.actorId) return fail("changed");
  const fresh = draft.request.undoOperationId
    ? previewOutcomeArrangementUndo(current, { ...draft.request, undoOperationId: draft.request.undoOperationId })
    : previewOutcomeArrangement(current, draft.request);
  if (!fresh.ok) return fresh;
  if (canonicalJson(fresh.value.request) !== canonicalJson(draft.request)
    || canonicalJson(fresh.value.before) !== canonicalJson(draft.before)
    || canonicalJson(fresh.value.after) !== canonicalJson(draft.after)) return fail("changed");
  return fresh;
}
/** Validate the free server reply before showing its exact confirmation. */
export function acceptOutcomeArrangementPreview(
  draft: OutcomeArrangementDraft, current: OutcomeArrangementContext, preview: OutcomeArrangementPreview, nowMs: number,
): OutcomeArrangementResult<OutcomeArrangementReview> {
  try {
  const fresh = currentDraft(draft, current);
  if (!fresh.ok) return fresh;
  const { operationId, projectId, canvasId, recipeId, name, selectedItemIds, expectedLayoutRevision, expectedSourceRevision, undoOperationId } = preview;
  const request = { operationId, projectId, canvasId, recipeId, name, selectedItemIds, expectedLayoutRevision, expectedSourceRevision, undoOperationId };
  if (canonicalJson(request) !== canonicalJson(draft.request) || canonicalJson(preview.before) !== canonicalJson(draft.before)
    || canonicalJson(preview.after) !== canonicalJson(draft.after) || !safeId(preview.previewId) || !safeId(preview.approvalHash)
    || !safeId(preview.arrangementId) || preview.providerCalls !== 0 || preview.maximumMicrousd !== 0
    || preview.changesSemantics !== false || preview.maximumEvents !== 201) return fail("changed");
  const expires = Date.parse(preview.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expires) || expires <= nowMs) return fail("expired");
  return { ok: true, value: Object.freeze({ draft,
    preview: Object.freeze({ ...preview, selectedItemIds: Object.freeze([...preview.selectedItemIds]),
      before: freezeFrames(preview.before), after: freezeFrames(preview.after) }) }) };
  } catch { return fail("changed"); }
}

/**
 * Only a human click passes confirmed:true. No events/clocks from this layer are
 * trusted or dispatched. The server binds the exact receipt, current permissions,
 * sources and layout, builds its own events, and commits all positions or none.
 * Retain operationId after submission/response loss; retrieve, never auto-replace.
 */
export function prepareOutcomeArrangement(
  review: OutcomeArrangementReview, current: OutcomeArrangementContext,
  confirmation: { readonly operationId: string; readonly previewId: string; readonly approvalHash: string; readonly confirmed: true } | null,
  nowMs: number,
): OutcomeArrangementResult<OutcomeArrangementApplyRequest> {
  if (!confirmation || confirmation.confirmed !== true || confirmation.operationId !== review.preview.operationId
    || confirmation.previewId !== review.preview.previewId || confirmation.approvalHash !== review.preview.approvalHash) return fail("confirmation");
  if (!current.canArrange) return fail("unavailable");
  if (!current.atomicTransportAvailable) return fail("atomic-unavailable");
  const checked = acceptOutcomeArrangementPreview(review.draft, current, review.preview, nowMs);
  if (!checked.ok) return checked;
  return { ok: true, value: { ...review.draft.request, previewId: review.preview.previewId, approvalHash: review.preview.approvalHash, confirmed: true } };
}
