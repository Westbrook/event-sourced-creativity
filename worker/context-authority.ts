import { foldCanvasEvents } from "../src/canvas/model.ts";
import { blockEffectFor, blockIntentFor } from "../src/model/block-types.ts";
import { combinedContextGroups, isContextCompositionRelation } from "../src/model/combined-context.ts";
import { isCharacterContext } from "../src/model/character-context.ts";
import { documentGenerationRevision } from "../src/model/document-jobs.ts";
import { foldEvents, type CreativeBlock, type CreativeEvent } from "../src/model/events.ts";
import { normalizeSpatialScope } from "../src/model/spatial-scope.ts";
import { assessCreativeContext } from "../src/model/context-health.ts";

type ContextRequest = {
  documentId: string;
  projectId?: string;
  canvasId?: string;
  contextSetId?: string;
  contextRootBlockId?:string;
  characterOutputKind?:"headshot"|"character_sheet";
  snapshot?: Record<string, unknown>;
  sourceBlockVersions?: Array<Record<string, unknown>>;
};

export class ContextIntegrityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ContextIntegrityError";
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const factFor = (block: CreativeBlock) => ({
  block_id: block.id,
  document_id: block.documentId,
  type: block.type,
  role: block.type,
  intent: blockIntentFor(block.type, block.properties),
  handle: block.handle,
  position: block.position,
  locked: block.locked,
  active: Number(block.properties.weight ?? .5) > 0,
  effect: blockEffectFor(block.type, block.properties),
  properties: { ...block.properties, spatial_scope: normalizeSpatialScope(block.properties.spatial_scope) },
  authority: block.properties.authority ?? "authored",
  source_event_refs: [...block.sourceEvents],
});

/**
 * Rebuild every provider-facing fact from the exact authorized event history.
 * Browser snapshots are selectors only; their text, rights, intent, relations,
 * and source versions can never override the durable project projection.
 */
export function authoritativeCreativeContext(events: CreativeEvent[], request: ContextRequest) {
  const projection = foldEvents(events, Number.POSITIVE_INFINITY, request.documentId, request.projectId ?? "");
  const document = projection.documents.find((candidate) =>
    candidate.id === request.documentId && (!request.projectId || candidate.projectId === request.projectId),
  );
  if (!document) throw new ContextIntegrityError("document_not_found", "The selected document is not available in this project.");

  const supplied = record(request.snapshot);
  const suppliedCanvas = record(supplied.canvas);
  const suppliedScope=record(supplied.context_scope);
  const canvasId = String(request.canvasId ?? suppliedCanvas.canvas_id ?? "");
  const contextSetId = String(request.contextSetId ?? suppliedCanvas.context_set_id ?? "");
  const rootBlockId=String(request.contextRootBlockId??suppliedScope.root_block_id??"");
  if (Boolean(canvasId) !== Boolean(contextSetId)) {
    throw new ContextIntegrityError("canvas_context_required", "A board generation must identify its approved board and context together.");
  }
  if(rootBlockId&&canvasId)throw new ContextIntegrityError("context_scope_conflict","Choose either a board context or one character context, not both.");

  let blocks = projection.blocks;
  let selectedItemIds = new Set<string>();
  let canvasSnapshot: Record<string, unknown> | undefined;

  if (canvasId && contextSetId) {
    const canvas = foldCanvasEvents(events, document.projectId, canvasId);
    const contextSet = canvas.contextSets.find((candidate) =>
      candidate.id === contextSetId && candidate.canvasId === canvasId && candidate.projectId === document.projectId,
    );
    if (!contextSet) throw new ContextIntegrityError("canvas_context_not_authorized", "The requested board context was not formally approved in this project.");

    selectedItemIds = new Set(contextSet.itemIds);
    const visited = new Set<string>();
    const expand = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const nested = canvas.contextSets.find((candidate) => candidate.id === id && candidate.canvasId === canvasId);
      if (!nested) return;
      for (const itemId of nested.itemIds) {
        selectedItemIds.add(itemId);
        const item = canvas.items.find((candidate) => candidate.id === itemId);
        if (item?.sourceKind === "context") expand(item.sourceId);
      }
    };
    expand(contextSet.id);

    const selectedItems = canvas.items.filter((item) => selectedItemIds.has(item.id));
    const selectedDocuments = new Set([
      ...contextSet.documentIds,
      ...selectedItems.filter((item) => item.sourceKind === "document").map((item) => item.sourceId),
    ]);
    const selectedSources = new Set(selectedItems.map((item) => item.sourceId));
    const selectedBlocks = new Set(contextSet.blockIds);
    for (const nestedId of visited) {
      const nested = canvas.contextSets.find((candidate) => candidate.id === nestedId);
      for (const blockId of nested?.blockIds ?? []) selectedBlocks.add(blockId);
      for (const documentId of nested?.documentIds ?? []) selectedDocuments.add(documentId);
    }
    for (const block of projection.libraryBlocks) {
      if (selectedDocuments.has(block.documentId)
        || selectedSources.has(block.id)
        || selectedSources.has(String(block.properties.source_output_id ?? block.properties.source_artifact_id ?? ""))) {
        selectedBlocks.add(block.id);
      }
    }
    let expanded=true;
    while(expanded){expanded=false;for(const relation of projection.libraryBlockRelations)if((relation.kind==="artifact_contains"||isContextCompositionRelation(relation.kind))&&selectedBlocks.has(relation.fromBlockId)&&!selectedBlocks.has(relation.toBlockId)){selectedBlocks.add(relation.toBlockId);expanded=true;}}
    // A prohibited document decision remains binding even when a visual board
    // selection omitted it; browser selection cannot erase a safety boundary.
    for (const block of projection.blocks) {
      if (block.type === "exclusion" || blockIntentFor(block.type, block.properties) === "prohibit") selectedBlocks.add(block.id);
    }
    blocks = projection.libraryBlocks.filter((block) => selectedBlocks.has(block.id));
    canvasSnapshot = {
      canvas_id: canvasId,
      context_set_id: contextSetId,
      item_ids: [...selectedItemIds],
      formalized_as_of_sequence: contextSet.asOfSequence,
      spatial_arrangement_is_semantic: false,
      arrangement_is_context: false,
      provenance_frames: selectedItems.map((item) => ({
        item_id: item.id,
        source_kind: item.sourceKind,
        source_id: item.sourceId,
        frame: { x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rot, z: item.z },
      })),
    };
  }

  if(rootBlockId){
    const root=projection.blocks.find((block)=>block.id===rootBlockId&&block.documentId===document.id);
    if(!root||!isCharacterContext(root.type,root.properties))throw new ContextIntegrityError("character_context_not_authorized","The selected character does not belong to the authorized document.");
    const selected=new Set([root.id]),pending=[root.id];
    while(pending.length){
      const current=pending.pop()!;
      for(const relation of projection.blockRelations){
        if(!isContextCompositionRelation(relation.kind)||relation.fromBlockId!==current||selected.has(relation.toBlockId))continue;
        selected.add(relation.toBlockId);pending.push(relation.toBlockId);
      }
    }
    // Narrowing a portrait may never remove an authored document-wide safety boundary.
    for(const block of projection.blocks)if(block.type==="exclusion"||blockIntentFor(block.type,block.properties)==="prohibit")selected.add(block.id);
    blocks=projection.blocks.filter((block)=>selected.has(block.id));
  }

  const blockIds = new Set(blocks.map((block) => block.id));
  const claimedFacts = Array.isArray(supplied.facts) ? supplied.facts.map(record) : [];
  for (const claimed of claimedFacts) {
    const blockId = String(claimed.block_id ?? "");
    const actual = blocks.find((block) => block.id === blockId);
    if (!blockId || !actual || !blockIds.has(blockId)) {
      throw new ContextIntegrityError("context_block_not_authorized", "The supplied context contains a block outside the approved document or board context.");
    }
    if (claimed.document_id && String(claimed.document_id) !== actual.documentId || claimed.type && String(claimed.type) !== actual.type) {
      throw new ContextIntegrityError("context_source_not_authorized", "The supplied source is not authorized for the selected project and document.");
    }
    const properties = record(claimed.properties);
    for (const key of ["media_url", "reference_id", "pixel_reference_mode", "source_evidence_hash", "source_content_hash", "source_mime_type", "media_type", "rights_class", "inform_generation", "include_in_output", "allow_provider_audio_transfer", "duration_seconds", "audio_role"] as const) {
      if (properties[key] !== undefined && JSON.stringify(properties[key]) !== JSON.stringify(actual.properties[key])) {
        throw new ContextIntegrityError("context_source_not_authorized", "The supplied source or media is not authorized for the selected project.");
      }
    }
  }

  const facts = blocks.map(factFor).map((fact) => canvasSnapshot
    ? { ...fact, canvas_id: canvasId, context_set_id: contextSetId }
    : fact);
  const relations = (canvasSnapshot ? projection.libraryBlockRelations : projection.blockRelations)
    .filter((relation) => blockIds.has(relation.fromBlockId) && blockIds.has(relation.toBlockId))
    .map((relation) => ({
      relation_id: relation.id,
      from_block_id: relation.fromBlockId,
      to_block_id: relation.toBlockId,
      kind: relation.kind,
      properties: relation.properties,
      source_event_refs: [...relation.sourceEvents],
    }));
  const approvedOutputIds = new Set(projection.libraryOutputs.map((output) => output.id));
  const requestedPins = Array.isArray(supplied.pins) ? supplied.pins.map(String) : [];
  const pins = canvasSnapshot
    ? requestedPins.filter((id) => approvedOutputIds.has(id))
    : projection.outputs.filter((output) => output.pinned).map((output) => output.id);
  const characterOutputKind=request.characterOutputKind??(suppliedScope.output_kind==="character_sheet"?"character_sheet":"headshot");
  const snapshot = {
    facts,
    relationships: relations,
    context_groups: combinedContextGroups({ facts,relationships:relations }),
    pins,
    ...(canvasSnapshot ? { canvas: canvasSnapshot } : {}),
    ...(rootBlockId?{context_scope:{kind:"character",root_block_id:rootBlockId,output_kind:characterOutputKind},character_study:{format:characterOutputKind,instruction:characterOutputKind==="character_sheet"?"Create one cohesive character sheet showing multiple consistent views of exactly this authored character.":"Create one shoulder-up headshot of exactly this authored character; preserve every specified facial and identity detail."}}:{}),
    tail: [],
  };
  const sourceBlockVersions = blocks.map((block) => ({ block_id: block.id, version: block.sourceEvents.length }));
  const claimedVersions = Array.isArray(request.sourceBlockVersions) ? request.sourceBlockVersions : [];
  for (const claimed of claimedVersions) {
    const actual = sourceBlockVersions.find((version) => version.block_id === String(claimed.block_id ?? ""));
    if (!actual || Number(claimed.version ?? actual.version) !== actual.version) {
      throw new ContextIntegrityError("context_source_version_mismatch", "The supplied source revision no longer matches the approved project context.");
    }
  }

  const governance=assessCreativeContext({blocks},events);
  const blocking=governance.issues.filter((issue)=>issue.severity==="blocking");
  if(blocking.length){
    const issue=blocking[0]!;
    throw new ContextIntegrityError(issue.id.startsWith("source-rights-")?"context_source_rights_required":issue.id.startsWith("source-expired-")?"context_source_rights_expired":"context_decisions_contradict",`${issue.label}: ${issue.detail}`);
  }

  return {
    projection,
    snapshot,
    sourceBlockVersions,
    documentRevision: documentGenerationRevision({ snapshot, sourceBlockVersions, documentId: document.id }),
  };
}
