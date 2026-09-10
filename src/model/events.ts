import { audioMetadataAfterSourceEdit } from "./audio.ts";
import { normalizeImageFocalPoint, type ImageFocalPoint } from "./focal-point.ts";
import { normalizePromptTechnique, PROMPT_TECHNIQUES, type PromptTechnique } from "./prompt-structures.ts";
import { isDocumentArtifactKind, normalizeSlidePresentation, normalizeSlideVisual, parseAudioMediaRevision, type DocumentArtifact } from "./document-artifacts.ts";

export type EventActor = "user" | `worker:${string}` | `model:${string}`;

export type CreativeEvent = {
  eventId: string;
  streamId: string;
  sequence: number;
  occurredAt: string;
  recordedAt: string;
  actor: EventActor | string;
  clientId: string;
  correlationId: string;
  causationId: string | null;
  compensatesEventId: string | null;
  schemaVersion: number;
  type: string;
  payload: Record<string, unknown>;
};

export type EventInput = {
  type: string;
  payload: Record<string, unknown>;
  compensatesEventId?: string | null;
};

export type CreativeBlock = {
  id: string;
  documentId: string;
  canvasId: string;
  projectId: string;
  scope: "document" | "library" | "canvas";
  type: string;
  handle: string;
  position: string;
  removed: boolean;
  locked: boolean;
  properties: Record<string, unknown>;
  sourceEvents: string[];
};

export type CreativeBlockRelation = {
  id: string;
  projectId: string;
  documentId: string;
  fromBlockId: string;
  toBlockId: string;
  kind: string;
  removed: boolean;
  properties: Record<string, unknown>;
  sourceEvents: string[];
};

export type CreativeProject = {
  id: string;
  name: string;
  state: string;
  createdSequence: number;
  lastSequence: number;
  documentCount: number;
  collectionCount: number;
  blockCount: number;
  outputCount: number;
  artifactCount: number;
  recentGenerations: GenerationHistoryItem[];
  recentArtifacts: DocumentArtifact[];
};

export type CreativeCollection = {
  id: string;
  projectId: string;
  handle: string;
  parentId: string | null;
  removed: boolean;
  position: string;
  sourceClaimRef: string | null;
};

export type CreativeDocument = {
  id: string;
  projectId: string;
  title: string;
  handle: string;
  removed: boolean;
  createdSequence: number;
  sourceEvents: string[];
};

export type CreativeOutput = {
  id: string;
  documentId: string;
  title?: string;
  titleSource?: "generated" | "authored";
  createdAt?: string;
  canvasId: string | null;
  contextSetId: string | null;
  generationId: string;
  modelId: string;
  variant: number;
  latency: number;
  sequence: number;
  pinned: boolean;
  saved: boolean;
  discarded: boolean;
  library: boolean;
  contentRef: string | null;
  promptRef: string | null;
  promptTechnique: PromptTechnique;
  promptFanId: string | null;
  provider: string;
  mediaUrl: string | null;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  plannerModelId: string | null;
  quality: "low" | "medium" | "high";
  purpose: "ideate" | "final";
  sourceEventId: string;
  sourceSurface: string | null;
  promotionId: string | null;
  promotedFromId: string | null;
  promotedFromEventId: string | null;
  focalPoint: ImageFocalPoint | null;
  standalone: boolean;
  standaloneSequence: number | null;
  productionMode?: "manual" | "managed";
  productionTeam?: string | null;
};

export type PromptFanGeneration = {
  kind: "fan";
  id: string;
  documentId: string;
  outputs: CreativeOutput[];
  sequence: number;
  quality: CreativeOutput["quality"];
  purpose: CreativeOutput["purpose"];
  complete: number;
  standaloneCount: number;
};

export type GenerationHistoryItem =
  | { kind: "output"; id: string; documentId: string; output: CreativeOutput; sequence: number }
  | PromptFanGeneration;

export const isDraftOutput = (output: CreativeOutput | null | undefined) =>
  Boolean(output && (output.purpose === "ideate" || output.quality === "low"));

export const outputQualityLabel = (output: CreativeOutput | null | undefined) =>
  isDraftOutput(output) ? "Draft" : "Full quality";

export function generationMix(outputs: CreativeOutput[]) {
  const drafts = outputs.filter(isDraftOutput).length;
  return { total: outputs.length, drafts, full: outputs.length - drafts };
}

export function generationHistoryItems(outputs: CreativeOutput[]): GenerationHistoryItem[] {
  const fans = new Map<string, CreativeOutput[]>();
  const items: GenerationHistoryItem[] = [];
  for (const output of outputs) {
    if (output.promptFanId) fans.set(output.promptFanId, [...(fans.get(output.promptFanId) ?? []), output]);
    if (!output.promptFanId || output.standalone) items.push({ kind: "output", id: output.id, documentId: output.documentId, output, sequence: output.standaloneSequence ?? output.sequence });
  }
  for (const [id, members] of fans) {
    const ordered = [...members].sort((left, right) => PROMPT_TECHNIQUES.indexOf(left.promptTechnique) - PROMPT_TECHNIQUES.indexOf(right.promptTechnique));
    const representative = ordered[0];
    if (!representative) continue;
    items.push({ kind: "fan", id, documentId: representative.documentId, outputs: ordered, sequence: Math.max(...ordered.map((output) => output.sequence)), quality: representative.quality, purpose: representative.purpose, complete: ordered.length, standaloneCount: ordered.filter((output) => output.standalone).length });
  }
  return items.sort((left, right) => right.sequence - left.sequence || (left.kind === "fan" ? -1 : 1));
}

export const generationHistoryItemIsDraft = (item: GenerationHistoryItem | null | undefined) =>
  Boolean(item && (item.kind === "output" ? isDraftOutput(item.output) : item.purpose === "ideate" || item.quality === "low"));

export function generationHistoryMix(outputs: CreativeOutput[]) {
  const items = generationHistoryItems(outputs);
  const drafts = items.filter(generationHistoryItemIsDraft).length;
  return { total: items.length, drafts, full: items.length - drafts };
}

export type CreativeProjection = {
  projectId: string;
  projectName: string;
  projectState: string;
  projects: CreativeProject[];
  documentId: string;
  documentTitle: string;
  documents: CreativeDocument[];
  blocks: CreativeBlock[];
  libraryBlocks: CreativeBlock[];
  blockRelations: CreativeBlockRelation[];
  libraryBlockRelations: CreativeBlockRelation[];
  collections: CreativeCollection[];
  membership: Record<string, { collectionId: string; position: string }>;
  outputs: CreativeOutput[];
  libraryOutputs: CreativeOutput[];
  artifacts: DocumentArtifact[];
  libraryArtifacts: DocumentArtifact[];
  latestCompile: Record<string, unknown> | null;
  brief: Record<string, unknown> | null;
  presentedBriefItems: Set<string>;
  annotations: Array<Record<string, unknown>>;
  families: Array<Record<string, unknown>>;
  preferences: Array<Record<string, unknown>>;
  conditions: Array<Record<string, unknown>>;
  lastSession: Record<string, unknown> | null;
  currentSessionId: string | null;
  sessionOpen: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const itemId = (value: unknown) => {
  const ref = asRecord(value);
  return String(ref.document_id ?? ref.block_id ?? ref.collection_id ?? ref.object_id ?? "");
};

export function foldEvents(events: CreativeEvent[], asOf = Number.POSITIVE_INFINITY, selectedDocumentId = "", selectedProjectId = ""): CreativeProjection {
  const projects = new Map<string, Omit<CreativeProject, "documentCount" | "collectionCount" | "blockCount" | "outputCount" | "artifactCount" | "recentGenerations" | "recentArtifacts">>();
  const blocks = new Map<string, CreativeBlock>();
  const blockRelations = new Map<string, CreativeBlockRelation>();
  const documents = new Map<string, CreativeDocument>();
  const collections = new Map<string, CreativeCollection>();
  const membership: Record<string, { collectionId: string; position: string }> = {};
  const outputs = new Map<string, CreativeOutput>();
  const artifacts = new Map<string, DocumentArtifact>();
  const originalAudio = new Map<string, Pick<DocumentArtifact, "mediaUrl" | "mediaType" | "settings">>();
  const generationCanvas = new Map<string,{canvasId:string;contextSetId:string}>();
  const documentCompiles = new Map<string, Record<string, unknown>>();
  const previewOutputByEvent = new Map<string, string>();
  const annotations = new Map<string, Record<string, unknown>>();
  const families = new Map<string, Record<string, unknown>>();
  const preferences = new Map<string, Record<string, unknown>>();
  const conditions = new Map<string, Record<string, unknown>>();
  const state: CreativeProjection = {
    projectId: "",
    projectName: "Untitled project",
    projectState: "active",
    documentId: "",
    documentTitle: "Untitled document",
    projects: [], documents: [], blocks: [], libraryBlocks: [], blockRelations: [], libraryBlockRelations: [], collections: [], membership, outputs: [], libraryOutputs: [], artifacts: [], libraryArtifacts: [],
    latestCompile: null, brief: null, presentedBriefItems: new Set(),
    annotations: [], families: [], preferences: [], conditions: [], lastSession: null, currentSessionId: null, sessionOpen: false,
  };
  const familyProjectId = (payload: Record<string, unknown>, objectId = "") => {
    const explicit = String(payload.project_id ?? "");
    if (explicit) return explicit;
    const output = objectId ? outputs.get(objectId) : undefined;
    return (output ? documents.get(output.documentId)?.projectId : undefined) ?? state.projectId;
  };
  const scopedFamilyKey = (id: string, projectId: string) => `${projectId}\u0000${id}`;
  const scopedFamily = (id: string, payload: Record<string, unknown>, objectId = "") =>
    families.get(scopedFamilyKey(id, familyProjectId(payload, objectId)));

  for (const event of events) {
    if (event.sequence > asOf) break;
    const p = event.payload;
    switch (event.type) {
      case "ProjectCreated": {
        const id=String(p.project_id??"");const name=String(p.name??"Untitled project");const projectState=String(p.state??"active");
        projects.set(id,{id,name,state:projectState,createdSequence:event.sequence,lastSequence:event.sequence});state.projectId=id;state.projectName=name;state.projectState=projectState;state.latestCompile=null;break;
      }
      case "ProjectOpened": {
        const project=projects.get(String(p.project_id??""));if(project){state.projectId=project.id;state.projectName=project.name;state.projectState=project.state;state.latestCompile=null;project.lastSequence=event.sequence;const latest=[...documents.values()].filter((document)=>document.projectId===project.id&&!document.removed).sort((a,b)=>b.createdSequence-a.createdSequence)[0];state.documentId=latest?.id??"";state.documentTitle=latest?.title??"No document open";}break;
      }
      case "ProjectRenamed": { const project=projects.get(String(p.project_id??state.projectId));if(project){project.name=String(p.new_name??project.name);project.lastSequence=event.sequence;if(project.id===state.projectId)state.projectName=project.name;}break; }
      case "ProjectStateChanged": { const project=projects.get(String(p.project_id??state.projectId));if(project){project.state=String(p.state??project.state);project.lastSequence=event.sequence;if(project.id===state.projectId)state.projectState=project.state;}break; }
      case "DocumentCreated": {
        const id=String(p.document_id??"");const title=String(p.title??state.documentTitle);state.documentId=id;state.documentTitle=title;state.latestCompile=null;
        documents.set(id,{id,projectId:String(p.project_id??state.projectId),title,handle:String(p.handle??`document-${id.slice(0,8)}`),removed:false,createdSequence:event.sequence,sourceEvents:[event.eventId]});break;
      }
      case "DocumentRenamed": {
        const id=String(p.document_id??state.documentId);const document=documents.get(id);if(document){document.title=String(p.new_title??document.title);document.sourceEvents.push(event.eventId);}if(id===state.documentId)state.documentTitle=String(p.new_title??state.documentTitle);break;
      }
      case "DocumentForked": {
        const id=String(p.document_id??state.documentId);const title=String(p.title??"Imported document fork");state.documentId=id;state.documentTitle=title;state.latestCompile=null;
        documents.set(id,{id,projectId:String(p.project_id??state.projectId),title,handle:String(p.handle??`fork-${id.slice(0,8)}`),removed:false,createdSequence:event.sequence,sourceEvents:[event.eventId]});break;
      }
      case "DocumentOpened": {
        const document=documents.get(String(p.document_id??""));if(document&&!document.removed){state.documentId=document.id;state.documentTitle=document.title;state.latestCompile=null;document.sourceEvents.push(event.eventId);}break;
      }
      case "DocumentRemoved": case "DocumentRestored": {
        const document=documents.get(String(p.document_id??""));if(document){document.removed=event.type==="DocumentRemoved";document.sourceEvents.push(event.eventId);if(event.type==="DocumentRestored"&&p.was_current){state.documentId=document.id;state.documentTitle=document.title;state.latestCompile=null;}}break;
      }
      case "BlockCreated": {
        const id = String(p.block_id);
        const scope: CreativeBlock["scope"] = p.canvas_id || p.scope === "canvas" ? "canvas" : p.scope === "library" || p.library_block === true ? "library" : "document";
        const documentId = scope === "document" ? String(p.document_id ?? state.documentId) : "";
        const canvasId = scope === "canvas" ? String(p.canvas_id ?? "") : "";
        const projectId = String(p.project_id ?? (documentId ? documents.get(documentId)?.projectId : state.projectId) ?? state.projectId);
        blocks.set(id, { id, documentId, canvasId, projectId, scope, type: String(p.type ?? "text"), handle: String(p.handle ?? id), position: String(p.position ?? "a0"), removed: false, locked: false, properties: { ...asRecord(p.properties) }, sourceEvents: [event.eventId] });
        break;
      }
      case "BlockRehomed": { const b=blocks.get(String(p.block_id??""));if(b){const nextScope=String(p.scope??"library") as CreativeBlock["scope"];b.scope=nextScope;b.documentId=nextScope==="document"?String(p.document_id??""):"";b.canvasId=nextScope==="canvas"?String(p.canvas_id??""):"";b.projectId=String(p.project_id??b.projectId);b.sourceEvents.push(event.eventId);}break; }
      case "BlockRenamed": { const b = blocks.get(String(p.block_id)); if (b) { b.handle = String(p.new_handle ?? b.handle); b.sourceEvents.push(event.eventId); } break; }
      case "BlockPropertyEdited": {
        const b = blocks.get(String(p.block_id)); const path = String(p.property_path ?? "");
        if (b && path === "position") b.position = String(p.new_value ?? b.position);
        else if (b && path === "type") b.type = String(p.new_value ?? b.type);
        else if (b && path) { b.properties = audioMetadataAfterSourceEdit(b.type, b.properties, path, p.new_value); b.properties[path] = p.new_value; }
        if (b) b.sourceEvents.push(event.eventId);
        break;
      }
      case "BlockWeightSet": { const b = blocks.get(String(p.block_id)); if (b) { b.properties.weight = Number(p.weight ?? .5); b.sourceEvents.push(event.eventId); } break; }
      case "BlockLocked": case "BlockUnlocked": { const b = blocks.get(String(p.block_id)); if (b) { b.locked = event.type === "BlockLocked"; b.sourceEvents.push(event.eventId); } break; }
      case "BlockRemoved": case "BlockRestored": { const b = blocks.get(String(p.block_id)); if (b) { b.removed = event.type === "BlockRemoved"; b.sourceEvents.push(event.eventId); } break; }
      case "BlockRelationAdded": {
        const id=String(p.relation_id??"");const fromBlockId=String(p.from_block_id??"");const toBlockId=String(p.to_block_id??"");if(!id||!fromBlockId||!toBlockId||fromBlockId===toBlockId)break;
        const from=blocks.get(fromBlockId);const to=blocks.get(toBlockId);const existing=blockRelations.get(id);const documentId=String(p.document_id??(from?.documentId&&from.documentId===to?.documentId?from.documentId:"")??"");const projectId=String(p.project_id??from?.projectId??to?.projectId??state.projectId);
        const kind=String(p.kind??existing?.kind??"visual_evidence");
        blockRelations.set(id,{id,projectId,documentId,fromBlockId,toBlockId,kind,removed:false,properties:{...(existing?.properties??{}),...asRecord(p.properties)},sourceEvents:[...(existing?.sourceEvents??[]),event.eventId]});
        // A structural edit changes both authored decisions and must invalidate
        // every exact-source approval without altering historical relationship versions.
        if(kind==="context_contains"||kind==="action_participant"){from?.sourceEvents.push(event.eventId);to?.sourceEvents.push(event.eventId);}
        break;
      }
      case "BlockRelationRemoved": { const relation=blockRelations.get(String(p.relation_id??""));if(relation){relation.removed=true;relation.sourceEvents.push(event.eventId);if(relation.kind==="context_contains"||relation.kind==="action_participant"){blocks.get(relation.fromBlockId)?.sourceEvents.push(event.eventId);blocks.get(relation.toBlockId)?.sourceEvents.push(event.eventId);}}break; }
      case "ChipEdited": { const b = blocks.get(String(p.block_id)); if (b) { b.properties = audioMetadataAfterSourceEdit(b.type, b.properties, String(p.property ?? "value"), p.new_value); b.properties[String(p.property ?? "value")] = p.new_value; b.properties.authority = event.compensatesEventId ? "inferred" : "authored"; b.sourceEvents.push(event.eventId); } break; }
      case "ExtractionRequested": { const b = blocks.get(String(p.block_id)); if (b) { b.properties.extraction_status = "pending"; b.sourceEvents.push(event.eventId); } break; }
      case "ExtractionCompleted": {
        const b = blocks.get(String(p.block_id)); const chips = Array.isArray(p.chips) ? p.chips : [];
        if (b) {
          for (const value of chips) { const chip = asRecord(value); const property = String(chip.property ?? ""); if (property) b.properties[property] = chip.value; }
          const confidenceValues = chips.map((value) => Number(asRecord(value).confidence ?? 1));
          b.properties.extraction_status = "complete"; b.properties.extractor = p.extractor_name; b.properties.confidence = Number(p.overall_confidence ?? (confidenceValues.length ? Math.min(...confidenceValues) : 1)); b.sourceEvents.push(event.eventId);
        }
        break;
      }
      case "ExtractionFailed": { const b = blocks.get(String(p.block_id)); if (b) { b.properties.extraction_status = "failed"; b.sourceEvents.push(event.eventId); } break; }
      case "CollectionCreated": { const id = String(p.collection_id); collections.set(id, { id, projectId: String(p.project_id??state.projectId), handle: String(p.handle ?? "untitled"), parentId: p.parent_collection_id ? String(p.parent_collection_id) : null, removed: false, position: String(p.position ?? "a0"), sourceClaimRef: p.source_claim_ref ? String(p.source_claim_ref) : null }); break; }
      case "CollectionRenamed": { const c = collections.get(String(p.collection_id)); if (c) c.handle = String(p.new_handle ?? c.handle); break; }
      case "CollectionRemoved": case "CollectionRestored": { const c = collections.get(String(p.collection_id)); if (c) c.removed = event.type === "CollectionRemoved"; break; }
      case "CollectionItemAdded": { const id = itemId(p.item_ref); if (id) membership[id] = { collectionId: String(p.collection_id), position: String(p.position ?? "a0") }; break; }
      case "CollectionItemRemoved": delete membership[itemId(p.item_ref)]; break;
      case "CollectionItemMoved": { const id = itemId(p.item_ref); if (id) membership[id] = { collectionId: String(p.to_collection_id), position: String(p.position ?? "a0") }; break; }
      case "ContextCompiled": {const snapshot=asRecord(p.compiled_snapshot);const snapshotDocument=asRecord(snapshot.document);const documentId=String(p.document_id??snapshotDocument.id??state.documentId??"");if(documentId)documentCompiles.set(documentId,p);if(!documentId||documentId===state.documentId)state.latestCompile=p;const canvas=asRecord(snapshot.canvas);const generationId=String(p.generation_id??"");if(generationId&&canvas.canvas_id)generationCanvas.set(generationId,{canvasId:String(canvas.canvas_id),contextSetId:String(canvas.context_set_id??"")});break;}
      case "IdeationPreviewCompleted": {
        const id=String(p.object_id??(Array.isArray(p.object_ids)?p.object_ids[0]:"")??"")||`draft-${String(p.generation_id??event.eventId)}`;
        previewOutputByEvent.set(event.eventId,id);
        {const receipt=generationCanvas.get(String(p.generation_id??""));const generatedTitle=String(p.title??asRecord(p.output_brief).title??"").trim();outputs.set(id,{id,documentId:String(p.document_id??state.documentId),...(generatedTitle?{title:generatedTitle,titleSource:"generated" as const}:{}),createdAt:event.occurredAt,canvasId:p.canvas_id?String(p.canvas_id):receipt?.canvasId??null,contextSetId:p.context_set_id?String(p.context_set_id):receipt?.contextSetId??null,generationId:String(p.generation_id??""),modelId:String(p.model_id??"gpt-image-2"),variant:Number(p.variant??outputs.size%4),latency:Number(p.latency_ms??0),sequence:event.sequence,pinned:false,saved:false,discarded:false,library:false,contentRef:p.output_ref?String(p.output_ref):null,promptRef:p.prompt_ref?String(p.prompt_ref):null,promptTechnique:normalizePromptTechnique(p.prompt_technique),promptFanId:p.prompt_fan_id?String(p.prompt_fan_id):null,provider:String(p.provider??"openai"),mediaUrl:p.media_url?String(p.media_url):null,mediaType:p.media_type?String(p.media_type):null,width:p.image_width?Number(p.image_width):null,height:p.image_height?Number(p.image_height):null,plannerModelId:p.planner_model_id?String(p.planner_model_id):null,quality:"low",purpose:"ideate",sourceEventId:event.eventId,sourceSurface:p.source_surface?String(p.source_surface):p.source_chat_turn_id?"chat":null,promotionId:null,promotedFromId:null,promotedFromEventId:null,focalPoint:normalizeImageFocalPoint(p.focal_point),standalone:!p.prompt_fan_id,standaloneSequence:p.prompt_fan_id?null:event.sequence,...(p.production_mode==="managed"?{productionMode:"managed" as const,productionTeam:p.production_team?String(p.production_team):null}:{})});}
        break;
      }
      case "GenerationCompleted": {
        if (p.report_space === "scout") break;
        const ids = Array.isArray(p.object_ids) ? p.object_ids : [];
        ids.forEach((value) => { const id = String(value); const promotedFromEventId=p.reference_preview_event_id?String(p.reference_preview_event_id):null;const receipt=generationCanvas.get(String(p.generation_id??""));const generatedTitle=String(p.title??asRecord(p.output_brief).title??"").trim(); outputs.set(id, { id, documentId: String(p.document_id ?? state.documentId),...(generatedTitle?{title:generatedTitle,titleSource:"generated" as const}:{}),createdAt:event.occurredAt, canvasId:p.canvas_id?String(p.canvas_id):receipt?.canvasId??null,contextSetId:p.context_set_id?String(p.context_set_id):receipt?.contextSetId??null,generationId: String(p.generation_id ?? ""), modelId: String(p.model_id ?? "adapter-neutral"), variant: Number(p.variant ?? outputs.size % 4), latency: Number(p.latency_ms ?? 0), sequence: event.sequence, pinned: false, saved: false, discarded: false, library: false, contentRef: p.output_ref ? String(p.output_ref) : null, promptRef:p.prompt_ref?String(p.prompt_ref):null,promptTechnique:normalizePromptTechnique(p.prompt_technique),promptFanId:p.prompt_fan_id?String(p.prompt_fan_id):null, provider: String(p.provider ?? (p.simulation ? "simulation" : "unknown")), mediaUrl: p.media_url ? String(p.media_url) : null, mediaType: p.media_type ? String(p.media_type) : null, width: p.image_width ? Number(p.image_width) : null, height: p.image_height ? Number(p.image_height) : null, plannerModelId: p.planner_model_id ? String(p.planner_model_id) : null, quality:p.quality==="low"?"low":p.quality==="medium"?"medium":"high",purpose:p.purpose==="ideate"?"ideate":"final",sourceEventId:event.eventId,sourceSurface:p.source_surface?String(p.source_surface):null,promotionId:p.promotion_id?String(p.promotion_id):null,promotedFromId:p.promoted_from_object_id?String(p.promoted_from_object_id):promotedFromEventId?previewOutputByEvent.get(promotedFromEventId)??null:null,promotedFromEventId,focalPoint:normalizeImageFocalPoint(p.focal_point),standalone:!p.prompt_fan_id,standaloneSequence:p.prompt_fan_id?null:event.sequence,...(p.production_mode==="managed"?{productionMode:"managed" as const,productionTeam:p.production_team?String(p.production_team):null}:{}) }); });
        break;
      }
      case "DocumentRenderCompleted": {
        const kind = p.artifact_kind;
        if (!isDocumentArtifactKind(kind)) break;
        const id = String(p.artifact_id ?? event.eventId);
        const rawItems = Array.isArray(p.items) ? p.items : [];
        artifacts.set(id, {
          id, documentId: String(p.document_id ?? state.documentId), kind,
          title: String(p.title ?? "Untitled artifact"), titleSource:"generated",createdAt:event.occurredAt,summary: String(p.summary ?? ""), contentRef: p.content_ref ? String(p.content_ref) : null, inputRef:p.input_ref?String(p.input_ref):null,
          itemCount: Number(p.item_count ?? rawItems.length),
          items: rawItems.map((value, index) => { const item=asRecord(value); return { id:String(item.id??`${id}-${index+1}`),title:String(item.title??`Part ${index+1}`),body:String(item.body??""),notes:String(item.notes??""),imagePrompt:String(item.image_prompt??""),contextGroupIds:Array.isArray(item.context_group_ids)?item.context_group_ids.map(String).filter(Boolean):[],mediaUrl:item.media_url?String(item.media_url):null,mediaType:item.media_type?String(item.media_type):null,...(item.scene_id?{sceneId:String(item.scene_id)}:{}),...(Number.isSafeInteger(item.narrative_order)&&Number(item.narrative_order)>0?{narrativeOrder:Number(item.narrative_order)}:{}),...(Number.isSafeInteger(item.generation_order)&&Number(item.generation_order)>0?{generationOrder:Number(item.generation_order)}:{}),...(Number.isFinite(item.duration_seconds)&&Number(item.duration_seconds)>0?{durationSeconds:Number(item.duration_seconds)}:{}),width:item.width?Number(item.width):null,height:item.height?Number(item.height):null,focalPoint:normalizeImageFocalPoint(item.focal_point),slide:item.slide?normalizeSlideVisual(item.slide,item,index):null }; }),
          mediaUrl: p.media_url ? String(p.media_url) : null, mediaType: p.media_type ? String(p.media_type) : null,
          provider: String(p.provider ?? "openai"), modelId: String(p.model_id ?? "adapter-neutral"), latency: Number(p.latency_ms ?? 0), sequence: event.sequence, library: false,
          sourceEventId: event.eventId, sourceSurface: p.source_surface ? String(p.source_surface) : null, settings: asRecord(p.settings), presentation:normalizeSlidePresentation(p.presentation),
        });
        if (kind === "audio") { const audio = artifacts.get(id)!; originalAudio.set(id, { mediaUrl: audio.mediaUrl, mediaType: audio.mediaType, settings: { ...audio.settings } }); }
        break;
      }
      case "DocumentArtifactEdited": {
        const artifact = artifacts.get(String(p.artifact_id ?? ""));
        if (!artifact || artifact.kind !== "audio" || !Object.hasOwn(p, "audio_revision")
          || p.document_id !== artifact.documentId || p.content_ref !== artifact.contentRef
          || p.project_id !== documents.get(artifact.documentId)?.projectId) break;
        const revised = parseAudioMediaRevision(p.audio_revision);
        if (revised && Number.isSafeInteger(p.revision) && revised.source.revision < Number(p.revision)) {
          artifact.mediaUrl = revised.media.url; artifact.mediaType = revised.media.mediaType;
          artifact.settings = { ...artifact.settings, source_media_sha256: revised.media.sha256,
            duration_seconds: revised.durationSeconds, estimated_duration_seconds: null, duration_basis: "media-container",
            duration_media_url: revised.media.url, duration_media_sha256: revised.media.sha256 };
        } else if (p.audio_revision === null && p.revision_action === "restore" && p.source_surface === "document-artifact-history"
          && Number.isSafeInteger(p.restored_from_revision) && Number(p.restored_from_revision) >= 0
          && Number(p.restored_from_revision) < Number(p.revision) && originalAudio.has(artifact.id)) {
          const original = originalAudio.get(artifact.id)!;
          artifact.mediaUrl = original.mediaUrl; artifact.mediaType = original.mediaType; artifact.settings = { ...original.settings };
        } else {
          // A malformed edited binding is unavailable; never relabel the original file as this revision.
          artifact.mediaUrl = null; artifact.mediaType = null;
          artifact.settings = { ...artifact.settings, source_media_sha256: null, duration_seconds: null,
            estimated_duration_seconds: null, duration_media_url: null, duration_media_sha256: null };
        }
        break;
      }
      case "OutputRenamed": {
        const id=String(p.output_id??""),documentId=String(p.document_id??""),title=typeof p.new_title==="string"?p.new_title.normalize("NFC").trim():"";
        const target=p.output_kind==="image"?outputs.get(id):p.output_kind==="artifact"?artifacts.get(id):undefined;
        const identified=p.output_kind==="image"?String(p.object_id??"")===id&&!p.artifact_id:p.output_kind==="artifact"&&String(p.artifact_id??"")===id&&!p.object_id;
        if(target&&identified&&title&&Array.from(title).length<=120&&!/\p{Cc}/u.test(title)
          &&target.documentId===documentId&&documents.get(documentId)?.projectId===String(p.project_id??"")){
          target.title=title;target.titleSource="authored";
        }
        break;
      }
      case "ImageFocalPointCalculated": {
        const focalPoint=normalizeImageFocalPoint(p.focal_point);if(!focalPoint)break;
        if(p.target_kind==="generation"){const output=outputs.get(String(p.target_id??""));if(output){output.focalPoint=focalPoint;}}
        else if(p.target_kind==="artifact"){for(const artifact of artifacts.values()){const item=artifact.items.find((candidate)=>candidate.id===String(p.target_id??""));if(item){item.focalPoint=focalPoint;break;}}}
        else {const block=blocks.get(String(p.block_id??p.target_id??""));if(block){block.properties.focal_point=focalPoint;block.sourceEvents.push(event.eventId);}}
        break;
      }
      case "ObjectPinned": case "ObjectUnpinned": { const o = outputs.get(String(p.object_id)); if (o) o.pinned = event.type === "ObjectPinned"; break; }
      case "ObjectSaved": { const o = outputs.get(String(p.object_id)); if (o) o.saved = true; break; }
      case "PromptFanOutputPromoted": { const o = outputs.get(String(p.object_id)); if (o && o.promptFanId === String(p.prompt_fan_id ?? o.promptFanId)) { o.standalone = true; o.standaloneSequence = event.sequence; } break; }
      case "ObjectDiscarded": { const o = outputs.get(String(p.object_id)); if (o) o.discarded = true; break; }
      case "AddedToLibrary": case "RemovedFromLibrary": { const id=String(p.object_id??p.item_id),kept=event.type==="AddedToLibrary",output=outputs.get(id),artifact=artifacts.get(id);if(output)output.library=kept;if(artifact)artifact.library=kept;break; }
      case "BriefComposed": state.brief = p; state.presentedBriefItems.clear(); break;
      case "BriefItemPresented": state.presentedBriefItems.add(String(p.item_id)); break;
      case "BriefItemIgnored": if (state.brief && String(state.brief.brief_id) === String(p.brief_id) && Array.isArray(state.brief.items)) state.brief = { ...state.brief, items: state.brief.items.filter((value) => String(asRecord(value).item_id) !== String(p.item_id)) }; break;
      case "BriefItemAccepted": case "BriefDismissed": case "EmptyCanvasChosen": if (!p.brief_id || String(state.brief?.brief_id) === String(p.brief_id)) { state.brief = null; state.presentedBriefItems.clear(); } break;
      case "SessionOpened": state.currentSessionId = String(p.session_id ?? ""); state.sessionOpen = true; break;
      case "SessionClosed": state.lastSession = p; state.currentSessionId = null; state.sessionOpen = false; state.brief = null; state.presentedBriefItems.clear(); break;
      case "AnnotationAdded": annotations.set(String(p.annotation_id), p); break;
      case "AnnotationRetracted": annotations.delete(String(p.annotation_id)); break;
      case "FamilyDeclared": {
        const id = String(p.family_id); const projectId = familyProjectId(p); const key = scopedFamilyKey(id, projectId); const current = families.get(key);
        families.set(key, { ...current, ...p, project_id: projectId, authority: "inferred", members: Array.isArray(current?.members) ? current.members : [], source_events: [...(Array.isArray(current?.source_events) ? current.source_events : []), event.eventId], superseded: false });
        break;
      }
      case "FamilyAnchorSet": { const f = scopedFamily(String(p.family_id), p, String(p.object_id ?? "")); if (f) { Object.assign(f, p); f.source_events = [...(Array.isArray(f.source_events) ? f.source_events : []), event.eventId]; } break; }
      case "FamilyMembershipAsserted": {
        const familyId = String(p.family_id); const objectId = String(p.object_id); const f = scopedFamily(familyId, p, objectId); if (!f) break;
        const members = Array.isArray(f.members) ? f.members.map(asRecord).filter((member) => String(member.object_id) !== objectId) : [];
        members.push({ ...p, object_id: objectId, claim_ref: p.claim_ref ?? `family-membership:${familyId}:${objectId}`, event_id: event.eventId, authority: "inferred" }); f.members = members; f.source_events = [...(Array.isArray(f.source_events) ? f.source_events : []), event.eventId];
        break;
      }
      case "ClaimSuperseded": {
        const claimRef = String(p.claim_ref ?? "");
        if (claimRef.startsWith("family-membership:")) {
          const [, familyId, ...objectParts] = claimRef.split(":"); const objectId = objectParts.join(":"); const f = scopedFamily(familyId, p, objectId);
          if (f && Array.isArray(f.members)) { f.members = f.members.map(asRecord).filter((member) => String(member.object_id) !== objectId); f.corrected_claims = [...(Array.isArray(f.corrected_claims) ? f.corrected_claims : []), claimRef]; }
        } else if (claimRef.startsWith("family:")) { const f = scopedFamily(claimRef.slice(7), p); if (f) { f.superseded = true; f.superseded_by = p.new_event_id ?? p.replacement_ref ?? null; } }
        break;
      }
      case "PreferenceAuthored": preferences.set(String(p.preference_id), { ...p, authority: "authored" }); break;
      case "PreferenceRevoked": preferences.delete(String(p.preference_id)); break;
      case "PromptTechniquePreferred": preferences.set(String(p.preference_id), { ...p, preference_kind: "prompt_technique", technique: normalizePromptTechnique(p.technique), authority: "authored", authored_sequence: event.sequence, source_event_id: event.eventId }); break;
      case "PromptTechniquePreferenceRevoked": preferences.delete(String(p.preference_id)); break;
      case "ConditionSet": conditions.set(String(p.condition_id), { ...p, fired: false }); break;
      case "ConditionFired": { const c = conditions.get(String(p.condition_id)); if (c) c.fired = true; break; }
    }
  }
  const requestedDocument=selectedDocumentId?documents.get(selectedDocumentId):undefined;
  if(requestedDocument&&!requestedDocument.removed&&requestedDocument.projectId!==state.projectId){const requestedProject=projects.get(requestedDocument.projectId);state.projectId=requestedDocument.projectId;if(requestedProject){state.projectName=requestedProject.name;state.projectState=requestedProject.state;}}
  if(selectedProjectId&&selectedProjectId!==state.projectId){const requestedProject=projects.get(selectedProjectId);if(requestedProject){state.projectId=requestedProject.id;state.projectName=requestedProject.name;state.projectState=requestedProject.state;}}
  const visibleDocuments=[...documents.values()].filter((document)=>!document.removed&&document.projectId===state.projectId).sort((a,b)=>b.createdSequence-a.createdSequence);const visibleDocumentIds=new Set(visibleDocuments.map((document)=>document.id));
  const visibleCollections=new Set([...collections.values()].filter((collection)=>!collection.removed&&collection.projectId===state.projectId).map((collection)=>collection.id));
  for(const [id,filed] of Object.entries(membership)){
    const itemProjectId=documents.get(id)?.projectId??blocks.get(id)?.projectId??collections.get(id)?.projectId??(outputs.get(id)?.documentId?documents.get(outputs.get(id)!.documentId)?.projectId:undefined);
    if(!visibleCollections.has(filed.collectionId)||(documents.has(id)&&!visibleDocumentIds.has(id))||(blocks.has(id)&&blocks.get(id)!.removed)||(itemProjectId&&itemProjectId!==state.projectId))delete membership[id];
  }
  state.libraryBlocks = [...blocks.values()].filter((b) => !b.removed&&b.projectId===state.projectId&&(b.scope==="library"||b.scope==="canvas"||visibleDocumentIds.has(b.documentId))).sort((a, b) => a.position.localeCompare(b.position));
  state.documents = visibleDocuments;
  const selectedDocument=selectedDocumentId?visibleDocuments.find((document)=>document.id===selectedDocumentId):undefined;
  if(selectedDocument){state.documentId=selectedDocument.id;state.documentTitle=selectedDocument.title;}
  else if(!visibleDocumentIds.has(state.documentId)){const fallback=visibleDocuments[0];state.documentId=fallback?.id??"";state.documentTitle=fallback?.title??"No document open";state.latestCompile=null;}
  if(state.documentId)state.latestCompile=documentCompiles.get(state.documentId)??null;
  state.blocks = state.libraryBlocks.filter((block) => block.scope==="document"&&block.documentId === state.documentId);
  const visibleBlockIds=new Set(state.libraryBlocks.map((block)=>block.id));const documentBlockIds=new Set(state.blocks.map((block)=>block.id));
  state.libraryBlockRelations=[...blockRelations.values()].filter((relation)=>!relation.removed&&relation.projectId===state.projectId&&visibleBlockIds.has(relation.fromBlockId)&&visibleBlockIds.has(relation.toBlockId));
  state.blockRelations=state.libraryBlockRelations.filter((relation)=>documentBlockIds.has(relation.fromBlockId)&&documentBlockIds.has(relation.toBlockId));
  state.collections = [...collections.values()].filter((c) => !c.removed&&c.projectId===state.projectId).sort((a, b) => a.position.localeCompare(b.position) || a.handle.localeCompare(b.handle));
  state.libraryOutputs = [...outputs.values()].filter((o) => !o.discarded&&(!documents.has(o.documentId)||visibleDocumentIds.has(o.documentId))).sort((a, b) => b.sequence - a.sequence);
  state.outputs = state.libraryOutputs.filter((output) => output.documentId === state.documentId);
  state.libraryArtifacts = [...artifacts.values()].filter((artifact) => !documents.has(artifact.documentId) || visibleDocumentIds.has(artifact.documentId)).sort((a,b)=>b.sequence-a.sequence);
  state.artifacts = state.libraryArtifacts.filter((artifact)=>artifact.documentId===state.documentId);
  const visibleOutputIds = new Set(state.libraryOutputs.map((output) => output.id));
  state.families = [...families.values()].flatMap((family) => {
    if (String(family.project_id ?? "") !== state.projectId) return [];
    const originalMembers = Array.isArray(family.members) ? family.members.map(asRecord) : [];
    const members = originalMembers.filter((member) => visibleOutputIds.has(String(member.object_id ?? "")));
    const anchorId = String(family.object_id ?? "");
    if (originalMembers.length && !members.length && (!anchorId || !visibleOutputIds.has(anchorId))) return [];
    const scoped: Record<string, unknown> = { ...family, members };
    if (anchorId && !visibleOutputIds.has(anchorId)) {
      const replacement = String(members[0]?.object_id ?? "");
      if (replacement) scoped.object_id = replacement;
      else delete scoped.object_id;
    }
    return [scoped];
  });
  state.annotations = [...annotations.values()]; state.preferences = [...preferences.values()]; state.conditions = [...conditions.values()];
  state.projects=[...projects.values()].map((project)=>{const projectDocuments=[...documents.values()].filter((document)=>document.projectId===project.id&&!document.removed);const documentIds=new Set(projectDocuments.map((document)=>document.id));const projectOutputs=[...outputs.values()].filter((output)=>documentIds.has(output.documentId)&&!output.discarded);const projectArtifacts=[...artifacts.values()].filter((artifact)=>documentIds.has(artifact.documentId)).sort((left,right)=>right.sequence-left.sequence);const history=generationHistoryItems(projectOutputs);return{...project,documentCount:projectDocuments.length,collectionCount:[...collections.values()].filter((collection)=>collection.projectId===project.id&&!collection.removed).length,blockCount:[...blocks.values()].filter((block)=>block.projectId===project.id&&!block.removed&&(block.scope==="library"||block.scope==="canvas"||documentIds.has(block.documentId))).length,outputCount:history.length+projectArtifacts.length,artifactCount:projectArtifacts.length,recentGenerations:history.slice(0,2),recentArtifacts:projectArtifacts.slice(0,2)};}).sort((a,b)=>a.id===state.projectId?-1:b.id===state.projectId?1:b.lastSequence-a.lastSequence);
  if(!state.projects.length&&state.projectId){const history=generationHistoryItems(state.libraryOutputs);state.projects=[{id:state.projectId,name:state.projectName,state:state.projectState,createdSequence:0,lastSequence:0,documentCount:state.documents.length,collectionCount:state.collections.length,blockCount:state.libraryBlocks.length,outputCount:history.length+state.libraryArtifacts.length,artifactCount:state.libraryArtifacts.length,recentGenerations:history.slice(0,2),recentArtifacts:state.libraryArtifacts.slice(0,2)}];}
  return state;
}

export const shortEventType = (type: string) => type.replace(/([a-z])([A-Z])/g, "$1 $2");
export function eventCategory(type: string) {
  if (/^(Canvas|Stroke|ContextSet)/.test(type)) return "canvas";
  if (/^Document(?:Render|Artifact)/.test(type)) return "generation";
  if (/^(Block|Document|Project)/.test(type)) return "document";
  if (type.startsWith("Collection")) return "collection";
  if (/Generation|Ideation|DocumentRender|DocumentArtifact|OutputRenamed|ContextCompiled|Model|Adapter|Capability|PromptTechnique/.test(type)) return "generation";
  if (/Extraction|Chip|Fact|Claim/.test(type)) return "reflection";
  if (/Brief|Session|PhaseGate|Deferred|Condition|Resurfaced/.test(type)) return "session";
  if (/Proposal|Mutation|Assistant/.test(type)) return "conversation";
  if (/Scout|Observation/.test(type)) return "scout";
  return "engagement";
}

export function contextDiff(left: CreativeProjection, right: CreativeProjection) {
  const before = new Map(left.blocks.map((b) => [b.id, b]));
  const after = new Map(right.blocks.map((b) => [b.id, b]));
  return [...new Set([...before.keys(), ...after.keys()])].map((id) => ({ id, before: before.get(id), after: after.get(id), status: !before.has(id) ? "added" : !after.has(id) ? "removed" : JSON.stringify(before.get(id)) === JSON.stringify(after.get(id)) ? "unchanged" : "changed" })).filter((x) => x.status !== "unchanged");
}
