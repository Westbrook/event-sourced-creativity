export type CreativeEvent = {
  eventId: string;
  streamId: string;
  sequence: number;
  occurredAt: string;
  recordedAt: string;
  actor: string;
  clientId: string;
  correlationId: string;
  causationId: string | null;
  compensatesEventId: string | null;
  schemaVersion: number;
  type: string;
  payload: Record<string, unknown>;
};

export type CreativeBlock = {
  id: string;
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

export type CreativeOutput = {
  id: string;
  generationId: string;
  modelId: string;
  variant: number;
  latency: number;
  sequence: number;
  pinned: boolean;
  saved: boolean;
};

export type CreativeProjection = {
  projectName: string;
  documentId: string;
  documentTitle: string;
  blocks: CreativeBlock[];
  collections: CreativeCollection[];
  membership: Record<string, { collectionId: string; position: string }>;
  outputs: CreativeOutput[];
  latestCompile: Record<string, unknown> | null;
  brief: Record<string, unknown> | null;
  presentedBriefItems: Set<string>;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function foldEvents(events: CreativeEvent[]): CreativeProjection {
  const blocks = new Map<string, CreativeBlock>();
  const collections = new Map<string, CreativeCollection>();
  const membership: Record<string, { collectionId: string; position: string }> = {};
  const outputs = new Map<string, CreativeOutput>();
  const state: CreativeProjection = {
    projectName: "Untitled project",
    documentId: "",
    documentTitle: "Untitled document",
    blocks: [],
    collections: [],
    membership,
    outputs: [],
    latestCompile: null,
    brief: null,
    presentedBriefItems: new Set(),
  };

  for (const event of events) {
    const payload = event.payload;
    switch (event.type) {
      case "ProjectCreated":
        state.projectName = String(payload.name ?? state.projectName);
        break;
      case "ProjectRenamed":
        state.projectName = String(payload.new_name ?? state.projectName);
        break;
      case "DocumentCreated":
        state.documentId = String(payload.document_id ?? state.documentId);
        state.documentTitle = String(payload.title ?? state.documentTitle);
        break;
      case "BlockCreated": {
        const id = String(payload.block_id);
        blocks.set(id, {
          id,
          type: String(payload.type ?? "text"),
          handle: String(payload.handle ?? id),
          position: String(payload.position ?? "a0"),
          removed: false,
          locked: false,
          properties: { ...asRecord(payload.properties) },
          sourceEvents: [event.eventId],
        });
        break;
      }
      case "BlockRenamed": {
        const block = blocks.get(String(payload.block_id));
        if (block) {
          block.handle = String(payload.new_handle ?? block.handle);
          block.sourceEvents.push(event.eventId);
        }
        break;
      }
      case "BlockPropertyEdited": {
        const block = blocks.get(String(payload.block_id));
        const path = String(payload.property_path ?? "");
        if (block && path) {
          block.properties[path] = payload.new_value;
          block.sourceEvents.push(event.eventId);
        }
        break;
      }
      case "BlockWeightSet": {
        const block = blocks.get(String(payload.block_id));
        if (block) {
          block.properties.weight = Number(payload.weight ?? block.properties.weight ?? 0.5);
          block.sourceEvents.push(event.eventId);
        }
        break;
      }
      case "BlockLocked": {
        const block = blocks.get(String(payload.block_id));
        if (block) {
          block.locked = true;
          block.sourceEvents.push(event.eventId);
        }
        break;
      }
      case "BlockUnlocked": {
        const block = blocks.get(String(payload.block_id));
        if (block) {
          block.locked = false;
          block.sourceEvents.push(event.eventId);
        }
        break;
      }
      case "BlockRemoved": {
        const block = blocks.get(String(payload.block_id));
        if (block) block.removed = true;
        break;
      }
      case "BlockRestored": {
        const block = blocks.get(String(payload.block_id));
        if (block) block.removed = false;
        break;
      }
      case "ChipEdited": {
        const block = blocks.get(String(payload.block_id));
        if (block) {
          block.properties[String(payload.property ?? "value")] = payload.new_value;
          // Compensation reverses both the value and the promotion of authority.
          block.properties.authority = event.compensatesEventId ? "inferred" : "authored";
          block.sourceEvents.push(event.eventId);
        }
        break;
      }
      case "CollectionCreated": {
        const id = String(payload.collection_id);
        collections.set(id, {
          id,
          handle: String(payload.handle ?? "untitled"),
          parentId: payload.parent_collection_id ? String(payload.parent_collection_id) : null,
          removed: false,
          position: String(payload.position ?? "a0"),
          sourceClaimRef: payload.source_claim_ref ? String(payload.source_claim_ref) : null,
        });
        break;
      }
      case "CollectionRenamed": {
        const collection = collections.get(String(payload.collection_id));
        if (collection) collection.handle = String(payload.new_handle ?? collection.handle);
        break;
      }
      case "CollectionRemoved": {
        const collection = collections.get(String(payload.collection_id));
        if (collection) collection.removed = true;
        break;
      }
      case "CollectionRestored": {
        const collection = collections.get(String(payload.collection_id));
        if (collection) collection.removed = false;
        break;
      }
      case "CollectionItemAdded": {
        const ref = asRecord(payload.item_ref);
        const itemId = String(ref.document_id ?? ref.collection_id ?? "");
        if (itemId) membership[itemId] = { collectionId: String(payload.collection_id), position: String(payload.position ?? "a0") };
        break;
      }
      case "CollectionItemRemoved": {
        const ref = asRecord(payload.item_ref);
        const itemId = String(ref.document_id ?? ref.collection_id ?? "");
        delete membership[itemId];
        break;
      }
      case "CollectionItemMoved": {
        const ref = asRecord(payload.item_ref);
        const itemId = String(ref.document_id ?? ref.collection_id ?? "");
        if (itemId) membership[itemId] = { collectionId: String(payload.to_collection_id), position: String(payload.position ?? "a0") };
        break;
      }
      case "ContextCompiled":
        state.latestCompile = payload;
        break;
      case "GenerationCompleted": {
        const objectIds = Array.isArray(payload.object_ids) ? payload.object_ids : [];
        objectIds.forEach((objectId) => {
          const id = String(objectId);
          outputs.set(id, {
            id,
            generationId: String(payload.generation_id ?? ""),
            modelId: String(payload.model_id ?? "adapter-neutral"),
            variant: Number(payload.variant ?? outputs.size % 4),
            latency: Number(payload.latency_ms ?? 0),
            sequence: event.sequence,
            pinned: false,
            saved: false,
          });
        });
        break;
      }
      case "ObjectPinned": {
        const output = outputs.get(String(payload.object_id));
        if (output) output.pinned = true;
        break;
      }
      case "ObjectUnpinned": {
        const output = outputs.get(String(payload.object_id));
        if (output) output.pinned = false;
        break;
      }
      case "ObjectSaved": {
        const output = outputs.get(String(payload.object_id));
        if (output) output.saved = true;
        break;
      }
      case "BriefComposed":
        state.brief = payload;
        break;
      case "BriefItemPresented":
        state.presentedBriefItems.add(String(payload.item_id));
        break;
    }
  }

  state.blocks = Array.from(blocks.values())
    .filter((block) => !block.removed)
    .sort((a, b) => a.position.localeCompare(b.position));
  state.collections = Array.from(collections.values())
    .filter((collection) => !collection.removed)
    .sort((a, b) => a.position.localeCompare(b.position) || a.handle.localeCompare(b.handle));
  state.outputs = Array.from(outputs.values()).sort((a, b) => b.sequence - a.sequence);
  return state;
}

export function shortEventType(type: string) {
  return type.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function eventCategory(type: string) {
  if (type.startsWith("Block") || type.startsWith("Document") || type.startsWith("Project")) return "document";
  if (type.startsWith("Collection")) return "collection";
  if (type.includes("Generation") || type === "ContextCompiled") return "generation";
  if (type.includes("Extraction") || type === "ChipEdited") return "reflection";
  if (type.includes("Brief") || type.includes("Session")) return "session";
  if (type.includes("Proposal") || type === "MutationProposed") return "conversation";
  return "engagement";
}
