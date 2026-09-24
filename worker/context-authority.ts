import { ideaDependencies, genericIdeaRelationships, isSemanticIdeaRelation, validateIdeaDependencyGraph } from '../src/model/project-ideas.ts';
import {isMemoryAuthoredEvent,memoryAuthoredEventIds,memoryAuthoredAttribution} from '../src/model/memory-authorship.ts';
import {measureRetainedState,combineRetainedStateMeasurements,RETAINED_STATE_LIMITS} from '../src/model/retained-state.ts';
import { isOutputContextBlock } from "../src/model/output-source-policy.ts";
import { createCanvasEventFold, foldCanvasEvents, type CanvasProjection } from "../src/canvas/model.ts";
import { blockEffectFor, blockIntentFor } from "../src/model/block-types.ts";
import { combinedContextGroups, isContextCompositionRelation } from "../src/model/combined-context.ts";
import { isCharacterContext } from "../src/model/character-context.ts";
import { documentGenerationRevision } from "../src/model/document-jobs.ts";
import { createCreativeEventFold, foldEvents, type CreativeBlock, type CreativeEvent, type CreativeProjection } from "../src/model/events.ts";
import { normalizeSpatialScope } from "../src/model/spatial-scope.ts";
import { assessCreativeContextFromRights, createContextRightsFold, type ContextRightsReceipts } from "../src/model/context-health.ts";

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

const factFor = (block: CreativeBlock, memoryAuthored:ReadonlySet<string>) => ({
  ...(block.sourceEvents.some(id=>memoryAuthored.has(id))?memoryAuthoredAttribution:{}),
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
  const rights=createContextRightsFold();for(const event of events)rights.accept(event);
  return contextFromCompleteProjection(projection,request,rights.finish(),(projectId,canvasId)=>foldCanvasEvents(events,projectId,canvasId),memoryAuthoredEventIds(events));
}

/** The caller supplies the already-resolved project, including for Canvas's
 * legacy omitted-project fallback. Feed every original-version event in order;
 * never finish at a page boundary.
 * This consumer does not establish authority or source freshness by itself. */
export function createAuthoritativeCreativeContextFold(request:ContextRequest&{projectId:string}){
  if(typeof request.projectId!=="string"||!request.projectId)throw new ContextIntegrityError('context_project_required','Resolve the authorized document project before reading its context.');
  const selected=structuredClone(request);
  const suppliedCanvas=record(record(selected.snapshot).canvas);
  const canvasId=String(selected.canvasId??suppliedCanvas.canvas_id??"");
  const creative=createCreativeEventFold(Infinity,selected.documentId,selected.projectId??"");
  const canvas=canvasId?createCanvasEventFold(selected.projectId??"",canvasId):null;
  const rights=createContextRightsFold(),memoryAuthored=new Set<string>();let finished=false;
  return {
    accept(event:CreativeEvent){
      if(finished)throw new Error('authoritative_context_fold_already_finished');
      const accepted=creative.accept(event)&&(canvas?.accept(event)??true)&&rights.accept(event);
      if(accepted&&isMemoryAuthoredEvent(event))memoryAuthored.add(event.eventId);return accepted;
    },
    finish(){
      if(finished)throw new Error('authoritative_context_fold_already_finished');finished=true;
      const projection=creative.finish(),receipts=rights.finish();
      return contextFromCompleteProjection(projection,selected,receipts,()=>{
        if(!canvas)throw new ContextIntegrityError('canvas_context_not_authorized','The requested board context is not available.');
        return canvas.finish();
      },memoryAuthored);
    },
    measureRetainedState:(limits=RETAINED_STATE_LIMITS)=>combineRetainedStateMeasurements([
      measureRetainedState(selected,limits),measureRetainedState(memoryAuthored,limits),creative.measureRetainedState(limits),rights.measureRetainedState(limits),
      ...(canvas?[canvas.measureRetainedState(limits)]:[]),
    ],limits),
  };
}

function contextFromCompleteProjection(projection:CreativeProjection,request:ContextRequest,receipts:ContextRightsReceipts,
  canvasFor:(projectId:string,canvasId:string)=>CanvasProjection,memoryAuthored:ReadonlySet<string>){
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
    const canvas = canvasFor(document.projectId, canvasId);
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

  if(blocks.some(block=>Object.hasOwn(block.properties,'rich_text_body'))){
    const effective=new Map(projection.libraryBlocks.map(block=>[block.id,block]));for(const block of blocks)effective.set(block.id,block);
    blocks=ideaDependencies(blocks.map(block=>block.id),[...effective.values()],projection.libraryBlockRelations);
    const issue=validateIdeaDependencyGraph(blocks,projection.libraryBlockRelations);if(issue)throw new ContextIntegrityError(issue.code,issue.message);
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

  const factualBlocks = blocks.filter((block) => !isOutputContextBlock(block));
  const factualBlockIds = new Set(factualBlocks.map((block) => block.id));
  const facts = factualBlocks.map(block=>factFor(block,memoryAuthored)).map((fact) => canvasSnapshot
    ? { ...fact, canvas_id: canvasId, context_set_id: contextSetId }
    : fact);
  const relations = (canvasSnapshot ? projection.libraryBlockRelations : projection.blockRelations)
    .filter((relation) => isSemanticIdeaRelation(relation.kind) && factualBlockIds.has(relation.fromBlockId) && factualBlockIds.has(relation.toBlockId))
    .map((relation) => ({
      relation_id: relation.id,
      from_block_id: relation.fromBlockId,
      to_block_id: relation.toBlockId,
      kind: relation.kind,
      properties: relation.properties,
      source_event_refs: [...relation.sourceEvents],
    }));
  relations.push(...genericIdeaRelationships(factualBlocks));
  const approvedOutputIds = new Set(projection.libraryOutputs.map((output) => output.id));
  const requestedPins = Array.isArray(supplied.pins) ? supplied.pins.map(String) : [];
  const pins = canvasSnapshot
    ? requestedPins.filter((id) => approvedOutputIds.has(id))
    : projection.outputs.filter((output) => output.pinned&&(!rootBlockId||blocks.some((block)=>String(block.properties.source_output_id??"")===output.id))).map((output) => output.id);
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

  const governance=assessCreativeContextFromRights({blocks},receipts);
  const blocking=governance.issues.filter((issue)=>issue.severity==="blocking");
  if(blocking.length){
    const issue=blocking[0]!;
    const code=issue.id.startsWith("source-excerpt-")?"context_source_evidence_unavailable"
      :issue.id.startsWith("source-expired-")||issue.id.startsWith("source-invalid-")||issue.id.startsWith("source-revoked-")
        ||issue.id.startsWith("decision-rights-")?"context_source_rights_expired"
        :issue.id.startsWith("source-rights-")?"context_source_rights_required":"context_decisions_contradict";
    throw new ContextIntegrityError(code,`${issue.label}: ${issue.detail}`);
  }

  return {
    projection,
    snapshot,
    sourceBlockVersions,
    documentRevision: documentGenerationRevision({ snapshot, sourceBlockVersions, documentId: document.id }),
  };
}

/**
 * Older paid slideshows predate the materialized context_groups field. Accept
 * that one compiler-only difference only when every durable authored fact,
 * relation, source revision, governance rule, and original receipt still match.
 */
export async function authoritativePresentationRecoveryContext(
  events: CreativeEvent[],
  request: ContextRequest & { documentRevision?: string },
  expectedSnapshotSha256: string,
) {
  const trusted = authoritativeCreativeContext(events, request);
  const expectedRevision = String(request.documentRevision ?? "");
  const requestedVersions = Array.isArray(request.sourceBlockVersions) ? request.sourceBlockVersions : [];
  const changed = () => new ContextIntegrityError(
    "context_source_version_mismatch",
    "The saved presentation no longer matches its authorized authored source.",
  );
  if (!expectedRevision || JSON.stringify(trusted.sourceBlockVersions) !== JSON.stringify(requestedVersions)) {
    throw changed();
  }

  const digest = async (snapshot: Record<string, unknown>) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(snapshot)));
    return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
  };
  const currentHash = await digest(trusted.snapshot);
  if (currentHash === expectedSnapshotSha256 && trusted.documentRevision === expectedRevision) return trusted;

  const original = request.snapshot;
  if (!original || Object.hasOwn(original, "context_groups") || Object.hasOwn(original, "contextGroups")
    || Object.hasOwn(original, "canvas") || Object.hasOwn(original, "context_scope")
    || Object.hasOwn(original, "character_study")) {
    throw changed();
  }
  const { context_groups: derivedGroups, ...legacySnapshot } = trusted.snapshot;
  const expectedGroups = combinedContextGroups({
    facts: legacySnapshot.facts,
    relationships: legacySnapshot.relationships,
  });
  if (!Array.isArray(derivedGroups) || JSON.stringify(derivedGroups) !== JSON.stringify(expectedGroups)
    || await digest(original) !== expectedSnapshotSha256
    || await digest(legacySnapshot) !== expectedSnapshotSha256) {
    throw changed();
  }
  const legacyRevision = documentGenerationRevision({
    snapshot: legacySnapshot,
    sourceBlockVersions: trusted.sourceBlockVersions,
    documentId: request.documentId,
  });
  if (legacyRevision !== expectedRevision) throw changed();
  return { ...trusted, snapshot: legacySnapshot, documentRevision: legacyRevision };
}
