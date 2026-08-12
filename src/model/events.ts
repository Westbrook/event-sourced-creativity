import { normalizeImageFocalPoint, type ImageFocalPoint } from "./focal-point.ts";

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
  type: string;
  handle: string;
  position: string;
  removed: boolean;
  locked: boolean;
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
};

export const isDraftOutput = (output: CreativeOutput | null | undefined) =>
  Boolean(output && (output.purpose === "ideate" || output.quality === "low"));

export const outputQualityLabel = (output: CreativeOutput | null | undefined) =>
  isDraftOutput(output) ? "Draft" : "Full quality";

export function generationMix(outputs: CreativeOutput[]) {
  const drafts = outputs.filter(isDraftOutput).length;
  return { total: outputs.length, drafts, full: outputs.length - drafts };
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
  collections: CreativeCollection[];
  membership: Record<string, { collectionId: string; position: string }>;
  outputs: CreativeOutput[];
  libraryOutputs: CreativeOutput[];
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
  return String(ref.document_id ?? ref.collection_id ?? ref.object_id ?? "");
};

export function foldEvents(events: CreativeEvent[], asOf = Number.POSITIVE_INFINITY, selectedDocumentId = ""): CreativeProjection {
  const projects = new Map<string, Omit<CreativeProject, "documentCount" | "collectionCount" | "blockCount" | "outputCount">>();
  const blocks = new Map<string, CreativeBlock>();
  const documents = new Map<string, CreativeDocument>();
  const collections = new Map<string, CreativeCollection>();
  const membership: Record<string, { collectionId: string; position: string }> = {};
  const outputs = new Map<string, CreativeOutput>();
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
    projects: [], documents: [], blocks: [], libraryBlocks: [], collections: [], membership, outputs: [], libraryOutputs: [],
    latestCompile: null, brief: null, presentedBriefItems: new Set(),
    annotations: [], families: [], preferences: [], conditions: [], lastSession: null, currentSessionId: null, sessionOpen: false,
  };

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
        blocks.set(id, { id, documentId: String(p.document_id ?? state.documentId), type: String(p.type ?? "text"), handle: String(p.handle ?? id), position: String(p.position ?? "a0"), removed: false, locked: false, properties: { ...asRecord(p.properties) }, sourceEvents: [event.eventId] });
        break;
      }
      case "BlockRenamed": { const b = blocks.get(String(p.block_id)); if (b) { b.handle = String(p.new_handle ?? b.handle); b.sourceEvents.push(event.eventId); } break; }
      case "BlockPropertyEdited": {
        const b = blocks.get(String(p.block_id)); const path = String(p.property_path ?? "");
        if (b && path === "position") b.position = String(p.new_value ?? b.position);
        else if (b && path === "type") b.type = String(p.new_value ?? b.type);
        else if (b && path) b.properties[path] = p.new_value;
        if (b) b.sourceEvents.push(event.eventId);
        break;
      }
      case "BlockWeightSet": { const b = blocks.get(String(p.block_id)); if (b) b.properties.weight = Number(p.weight ?? .5); break; }
      case "BlockLocked": case "BlockUnlocked": { const b = blocks.get(String(p.block_id)); if (b) b.locked = event.type === "BlockLocked"; break; }
      case "BlockRemoved": case "BlockRestored": { const b = blocks.get(String(p.block_id)); if (b) b.removed = event.type === "BlockRemoved"; break; }
      case "ChipEdited": { const b = blocks.get(String(p.block_id)); if (b) { b.properties[String(p.property ?? "value")] = p.new_value; b.properties.authority = event.compensatesEventId ? "inferred" : "authored"; b.sourceEvents.push(event.eventId); } break; }
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
      case "ContextCompiled": state.latestCompile = p; break;
      case "IdeationPreviewCompleted": {
        const id=String(p.object_id??(Array.isArray(p.object_ids)?p.object_ids[0]:"")??"")||`draft-${String(p.generation_id??event.eventId)}`;
        previewOutputByEvent.set(event.eventId,id);
        outputs.set(id,{id,documentId:String(p.document_id??state.documentId),generationId:String(p.generation_id??""),modelId:String(p.model_id??"gpt-image-2"),variant:Number(p.variant??outputs.size%4),latency:Number(p.latency_ms??0),sequence:event.sequence,pinned:false,saved:false,discarded:false,library:false,contentRef:p.output_ref?String(p.output_ref):null,provider:String(p.provider??"openai"),mediaUrl:p.media_url?String(p.media_url):null,mediaType:p.media_type?String(p.media_type):null,width:p.image_width?Number(p.image_width):null,height:p.image_height?Number(p.image_height):null,plannerModelId:p.planner_model_id?String(p.planner_model_id):null,quality:"low",purpose:"ideate",sourceEventId:event.eventId,sourceSurface:p.source_surface?String(p.source_surface):p.source_chat_turn_id?"chat":null,promotionId:null,promotedFromId:null,promotedFromEventId:null,focalPoint:normalizeImageFocalPoint(p.focal_point)});
        break;
      }
      case "GenerationCompleted": {
        if (p.report_space === "scout") break;
        const ids = Array.isArray(p.object_ids) ? p.object_ids : [];
        ids.forEach((value) => { const id = String(value); const promotedFromEventId=p.reference_preview_event_id?String(p.reference_preview_event_id):null; outputs.set(id, { id, documentId: String(p.document_id ?? state.documentId), generationId: String(p.generation_id ?? ""), modelId: String(p.model_id ?? "adapter-neutral"), variant: Number(p.variant ?? outputs.size % 4), latency: Number(p.latency_ms ?? 0), sequence: event.sequence, pinned: false, saved: false, discarded: false, library: false, contentRef: p.output_ref ? String(p.output_ref) : null, provider: String(p.provider ?? (p.simulation ? "simulation" : "unknown")), mediaUrl: p.media_url ? String(p.media_url) : null, mediaType: p.media_type ? String(p.media_type) : null, width: p.image_width ? Number(p.image_width) : null, height: p.image_height ? Number(p.image_height) : null, plannerModelId: p.planner_model_id ? String(p.planner_model_id) : null, quality:p.quality==="low"?"low":p.quality==="medium"?"medium":"high",purpose:p.purpose==="ideate"?"ideate":"final",sourceEventId:event.eventId,sourceSurface:p.source_surface?String(p.source_surface):null,promotionId:p.promotion_id?String(p.promotion_id):null,promotedFromId:p.promoted_from_object_id?String(p.promoted_from_object_id):promotedFromEventId?previewOutputByEvent.get(promotedFromEventId)??null:null,promotedFromEventId,focalPoint:normalizeImageFocalPoint(p.focal_point) }); });
        break;
      }
      case "ImageFocalPointCalculated": {
        const focalPoint=normalizeImageFocalPoint(p.focal_point);if(!focalPoint)break;
        if(p.target_kind==="generation"){const output=outputs.get(String(p.target_id??""));if(output){output.focalPoint=focalPoint;}}
        else {const block=blocks.get(String(p.block_id??p.target_id??""));if(block){block.properties.focal_point=focalPoint;block.sourceEvents.push(event.eventId);}}
        break;
      }
      case "ObjectPinned": case "ObjectUnpinned": { const o = outputs.get(String(p.object_id)); if (o) o.pinned = event.type === "ObjectPinned"; break; }
      case "ObjectSaved": { const o = outputs.get(String(p.object_id)); if (o) o.saved = true; break; }
      case "ObjectDiscarded": { const o = outputs.get(String(p.object_id)); if (o) o.discarded = true; break; }
      case "AddedToLibrary": case "RemovedFromLibrary": { const o = outputs.get(String(p.object_id ?? p.item_id)); if (o) o.library = event.type === "AddedToLibrary"; break; }
      case "BriefComposed": state.brief = p; state.presentedBriefItems.clear(); break;
      case "BriefItemPresented": state.presentedBriefItems.add(String(p.item_id)); break;
      case "BriefItemIgnored": if (state.brief && String(state.brief.brief_id) === String(p.brief_id) && Array.isArray(state.brief.items)) state.brief = { ...state.brief, items: state.brief.items.filter((value) => String(asRecord(value).item_id) !== String(p.item_id)) }; break;
      case "BriefItemAccepted": case "BriefDismissed": case "EmptyCanvasChosen": if (!p.brief_id || String(state.brief?.brief_id) === String(p.brief_id)) { state.brief = null; state.presentedBriefItems.clear(); } break;
      case "SessionOpened": state.currentSessionId = String(p.session_id ?? ""); state.sessionOpen = true; break;
      case "SessionClosed": state.lastSession = p; state.currentSessionId = null; state.sessionOpen = false; state.brief = null; state.presentedBriefItems.clear(); break;
      case "AnnotationAdded": annotations.set(String(p.annotation_id), p); break;
      case "AnnotationRetracted": annotations.delete(String(p.annotation_id)); break;
      case "FamilyDeclared": {
        const id = String(p.family_id); const current = families.get(id);
        families.set(id, { ...current, ...p, authority: "inferred", members: Array.isArray(current?.members) ? current.members : [], source_events: [...(Array.isArray(current?.source_events) ? current.source_events : []), event.eventId], superseded: false });
        break;
      }
      case "FamilyAnchorSet": { const f = families.get(String(p.family_id)); if (f) { Object.assign(f, p); f.source_events = [...(Array.isArray(f.source_events) ? f.source_events : []), event.eventId]; } break; }
      case "FamilyMembershipAsserted": {
        const familyId = String(p.family_id); const f = families.get(familyId); if (!f) break;
        const objectId = String(p.object_id); const members = Array.isArray(f.members) ? f.members.map(asRecord).filter((member) => String(member.object_id) !== objectId) : [];
        members.push({ ...p, object_id: objectId, claim_ref: p.claim_ref ?? `family-membership:${familyId}:${objectId}`, event_id: event.eventId, authority: "inferred" }); f.members = members; f.source_events = [...(Array.isArray(f.source_events) ? f.source_events : []), event.eventId];
        break;
      }
      case "ClaimSuperseded": {
        const claimRef = String(p.claim_ref ?? "");
        if (claimRef.startsWith("family-membership:")) {
          const [, familyId, ...objectParts] = claimRef.split(":"); const f = families.get(familyId); const objectId = objectParts.join(":");
          if (f && Array.isArray(f.members)) { f.members = f.members.map(asRecord).filter((member) => String(member.object_id) !== objectId); f.corrected_claims = [...(Array.isArray(f.corrected_claims) ? f.corrected_claims : []), claimRef]; }
        } else if (claimRef.startsWith("family:")) { const f = families.get(claimRef.slice(7)); if (f) { f.superseded = true; f.superseded_by = p.new_event_id ?? p.replacement_ref ?? null; } }
        break;
      }
      case "PreferenceAuthored": preferences.set(String(p.preference_id), { ...p, authority: "authored" }); break;
      case "PreferenceRevoked": preferences.delete(String(p.preference_id)); break;
      case "ConditionSet": conditions.set(String(p.condition_id), { ...p, fired: false }); break;
      case "ConditionFired": { const c = conditions.get(String(p.condition_id)); if (c) c.fired = true; break; }
    }
  }
  const visibleDocuments=[...documents.values()].filter((document)=>!document.removed&&document.projectId===state.projectId).sort((a,b)=>b.createdSequence-a.createdSequence);const visibleDocumentIds=new Set(visibleDocuments.map((document)=>document.id));
  for(const id of Object.keys(membership))if(documents.has(id)&&!visibleDocumentIds.has(id))delete membership[id];
  state.libraryBlocks = [...blocks.values()].filter((b) => !b.removed&&(!documents.has(b.documentId)||visibleDocumentIds.has(b.documentId))).sort((a, b) => a.position.localeCompare(b.position));
  state.documents = visibleDocuments;
  const selectedDocument=selectedDocumentId?visibleDocuments.find((document)=>document.id===selectedDocumentId):undefined;
  if(selectedDocument){state.documentId=selectedDocument.id;state.documentTitle=selectedDocument.title;}
  else if(!visibleDocumentIds.has(state.documentId)){const fallback=visibleDocuments[0];state.documentId=fallback?.id??"";state.documentTitle=fallback?.title??"No document open";state.latestCompile=null;}
  state.blocks = state.libraryBlocks.filter((block) => block.documentId === state.documentId);
  state.collections = [...collections.values()].filter((c) => !c.removed&&c.projectId===state.projectId).sort((a, b) => a.position.localeCompare(b.position) || a.handle.localeCompare(b.handle));
  state.libraryOutputs = [...outputs.values()].filter((o) => !o.discarded&&(!documents.has(o.documentId)||visibleDocumentIds.has(o.documentId))).sort((a, b) => b.sequence - a.sequence);
  state.outputs = state.libraryOutputs.filter((output) => output.documentId === state.documentId);
  state.annotations = [...annotations.values()]; state.families = [...families.values()]; state.preferences = [...preferences.values()]; state.conditions = [...conditions.values()];
  state.projects=[...projects.values()].map((project)=>{const projectDocuments=[...documents.values()].filter((document)=>document.projectId===project.id&&!document.removed);const documentIds=new Set(projectDocuments.map((document)=>document.id));return{...project,documentCount:projectDocuments.length,collectionCount:[...collections.values()].filter((collection)=>collection.projectId===project.id&&!collection.removed).length,blockCount:[...blocks.values()].filter((block)=>documentIds.has(block.documentId)&&!block.removed).length,outputCount:[...outputs.values()].filter((output)=>documentIds.has(output.documentId)&&!output.discarded).length};}).sort((a,b)=>a.id===state.projectId?-1:b.id===state.projectId?1:b.lastSequence-a.lastSequence);
  if(!state.projects.length&&state.projectId)state.projects=[{id:state.projectId,name:state.projectName,state:state.projectState,createdSequence:0,lastSequence:0,documentCount:state.documents.length,collectionCount:state.collections.length,blockCount:state.libraryBlocks.length,outputCount:state.libraryOutputs.length}];
  return state;
}

export const shortEventType = (type: string) => type.replace(/([a-z])([A-Z])/g, "$1 $2");
export function eventCategory(type: string) {
  if (/^(Block|Document|Project)/.test(type)) return "document";
  if (type.startsWith("Collection")) return "collection";
  if (/Generation|Ideation|ContextCompiled|Model|Adapter|Capability/.test(type)) return "generation";
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
