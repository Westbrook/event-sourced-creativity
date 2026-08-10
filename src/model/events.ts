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

export type CreativeCollection = {
  id: string;
  handle: string;
  parentId: string | null;
  removed: boolean;
  position: string;
  sourceClaimRef: string | null;
};

export type CreativeDocument = {
  id: string;
  title: string;
  handle: string;
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
};

export type CreativeProjection = {
  projectId: string;
  projectName: string;
  projectState: string;
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

export function foldEvents(events: CreativeEvent[], asOf = Number.POSITIVE_INFINITY): CreativeProjection {
  const blocks = new Map<string, CreativeBlock>();
  const documents = new Map<string, CreativeDocument>();
  const collections = new Map<string, CreativeCollection>();
  const membership: Record<string, { collectionId: string; position: string }> = {};
  const outputs = new Map<string, CreativeOutput>();
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
    documents: [], blocks: [], libraryBlocks: [], collections: [], membership, outputs: [], libraryOutputs: [],
    latestCompile: null, brief: null, presentedBriefItems: new Set(),
    annotations: [], families: [], preferences: [], conditions: [], lastSession: null, currentSessionId: null, sessionOpen: false,
  };

  for (const event of events) {
    if (event.sequence > asOf) break;
    const p = event.payload;
    switch (event.type) {
      case "ProjectCreated": state.projectId = String(p.project_id ?? ""); state.projectName = String(p.name ?? state.projectName); break;
      case "ProjectRenamed": state.projectName = String(p.new_name ?? state.projectName); break;
      case "ProjectStateChanged": state.projectState = String(p.state ?? state.projectState); break;
      case "DocumentCreated": {
        const id=String(p.document_id??"");const title=String(p.title??state.documentTitle);state.documentId=id;state.documentTitle=title;state.latestCompile=null;
        documents.set(id,{id,title,handle:String(p.handle??`document-${id.slice(0,8)}`),createdSequence:event.sequence,sourceEvents:[event.eventId]});break;
      }
      case "DocumentRenamed": {
        const id=String(p.document_id??state.documentId);const document=documents.get(id);if(document){document.title=String(p.new_title??document.title);document.sourceEvents.push(event.eventId);}if(id===state.documentId)state.documentTitle=String(p.new_title??state.documentTitle);break;
      }
      case "DocumentForked": {
        const id=String(p.document_id??state.documentId);const title=String(p.title??"Imported document fork");state.documentId=id;state.documentTitle=title;state.latestCompile=null;
        documents.set(id,{id,title,handle:String(p.handle??`fork-${id.slice(0,8)}`),createdSequence:event.sequence,sourceEvents:[event.eventId]});break;
      }
      case "DocumentOpened": {
        const document=documents.get(String(p.document_id??""));if(document){state.documentId=document.id;state.documentTitle=document.title;state.latestCompile=null;document.sourceEvents.push(event.eventId);}break;
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
      case "CollectionCreated": { const id = String(p.collection_id); collections.set(id, { id, handle: String(p.handle ?? "untitled"), parentId: p.parent_collection_id ? String(p.parent_collection_id) : null, removed: false, position: String(p.position ?? "a0"), sourceClaimRef: p.source_claim_ref ? String(p.source_claim_ref) : null }); break; }
      case "CollectionRenamed": { const c = collections.get(String(p.collection_id)); if (c) c.handle = String(p.new_handle ?? c.handle); break; }
      case "CollectionRemoved": case "CollectionRestored": { const c = collections.get(String(p.collection_id)); if (c) c.removed = event.type === "CollectionRemoved"; break; }
      case "CollectionItemAdded": { const id = itemId(p.item_ref); if (id) membership[id] = { collectionId: String(p.collection_id), position: String(p.position ?? "a0") }; break; }
      case "CollectionItemRemoved": delete membership[itemId(p.item_ref)]; break;
      case "CollectionItemMoved": { const id = itemId(p.item_ref); if (id) membership[id] = { collectionId: String(p.to_collection_id), position: String(p.position ?? "a0") }; break; }
      case "ContextCompiled": state.latestCompile = p; break;
      case "GenerationCompleted": {
        if (p.report_space === "scout") break;
        const ids = Array.isArray(p.object_ids) ? p.object_ids : [];
        ids.forEach((value) => { const id = String(value); outputs.set(id, { id, documentId: String(p.document_id ?? state.documentId), generationId: String(p.generation_id ?? ""), modelId: String(p.model_id ?? "adapter-neutral"), variant: Number(p.variant ?? outputs.size % 4), latency: Number(p.latency_ms ?? 0), sequence: event.sequence, pinned: false, saved: false, discarded: false, library: false, contentRef: p.output_ref ? String(p.output_ref) : null, provider: String(p.provider ?? (p.simulation ? "simulation" : "unknown")) }); });
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
  state.libraryBlocks = [...blocks.values()].filter((b) => !b.removed).sort((a, b) => a.position.localeCompare(b.position));
  state.documents = [...documents.values()].sort((a,b)=>b.createdSequence-a.createdSequence);
  state.blocks = state.libraryBlocks.filter((block) => block.documentId === state.documentId);
  state.collections = [...collections.values()].filter((c) => !c.removed).sort((a, b) => a.position.localeCompare(b.position) || a.handle.localeCompare(b.handle));
  state.libraryOutputs = [...outputs.values()].filter((o) => !o.discarded).sort((a, b) => b.sequence - a.sequence);
  state.outputs = state.libraryOutputs.filter((output) => output.documentId === state.documentId);
  state.annotations = [...annotations.values()]; state.families = [...families.values()]; state.preferences = [...preferences.values()]; state.conditions = [...conditions.values()];
  return state;
}

export const shortEventType = (type: string) => type.replace(/([a-z])([A-Z])/g, "$1 $2");
export function eventCategory(type: string) {
  if (/^(Block|Document|Project)/.test(type)) return "document";
  if (type.startsWith("Collection")) return "collection";
  if (/Generation|ContextCompiled|Model|Adapter|Capability/.test(type)) return "generation";
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
