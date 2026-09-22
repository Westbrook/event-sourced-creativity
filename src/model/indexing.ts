import { ideasInDocument } from './project-ideas.ts';
import { blockTypeDefinition } from "./block-types.ts";
import { foldEvents, type CreativeEvent, type CreativeProjection } from "./events.ts";
import { generationPromotionSignals } from "./generation-signals.ts";

export const EMBEDDING_MODEL_ID = "forma-hash-embedding-v1";
export const EMBEDDING_VERSION = 1;
export const EMBEDDING_DIMENSIONS = 24;

export type VectorItem = {
  id: string;
  kind: "block" | "output";
  label: string;
  vector: number[];
  embeddingModelId: string;
  embeddingVersion: number;
  sourceSequence: number;
  sourceEventIds: string[];
  collectionIds: string[];
  accepted: boolean;
};

export type FewShotExemplar = {
  exemplarId: string;
  kind: "accepted-proposal" | "authored-correction" | "kept-generation";
  label: string;
  summary: string;
  citations: string[];
  sourceSequence: number;
  collectionIds: string[];
  vector: number[];
};

export type RetrievedExemplar = FewShotExemplar & { score: number };

export type FewShotCorpusOptions = {
  projectId?: string;
};

export type FewShotRetrievalOptions = FewShotCorpusOptions & {
  limit?: number;
  collectionId?: string;
};

export type IndexedFamily = {
  familyId: string;
  label: string;
  confidence: number;
  anchorObjectId: string;
  evidenceRefs: string[];
  sourceHead: number;
  indexSignature: string;
  members: Array<{ objectId: string; confidence: number; evidenceRefs: string[]; claimRef: string }>;
};

export type Phase7Index = {
  embeddingModelId: string;
  embeddingVersion: number;
  sourceHead: number;
  items: VectorItem[];
  exemplars: FewShotExemplar[];
  families: IndexedFamily[];
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const machineIdentifier = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:object|generation|block|document|project|context|reference|artifact|event|content|mutation|proposal|corr)[-_][a-z0-9]+(?:[-_][a-z0-9]+)*|[a-z]{1,3}\d+)$/i;
const machineEventName = /^(?:Block|Document|Project|Generation|Object|Proposal|Mutation|Context|Extraction|Chip|Fact|Collection)[A-Z][A-Za-z0-9]+$/;

function readableValue(value: unknown, depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => readableValue(item, depth + 1)).filter(Boolean))].slice(0, 5).join(", ");
  }
  if (typeof value === "object") {
    const item = asRecord(value);
    for (const key of ["text", "title", "label", "description", "instruction", "summary", "name", "message", "rationale", "value", "purpose", "content_direction"]) {
      const text = readableValue(item[key], depth + 1);
      if (text) return text;
    }
    const properties = readableValue(item.properties, depth + 1);
    if (properties) return properties;
    const colors = readableValue(item.colors ?? item.palette, depth + 1);
    if (colors) return colors;
    return "";
  }
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text === "[object Object]" || machineIdentifier.test(text) || machineEventName.test(text)) return "";
  if (/^[a-z][a-z_-]*\/[a-z0-9][a-z0-9_-]*$/i.test(text)) {
    return text.slice(text.lastIndexOf("/") + 1).replace(/[-_]+/g, " ").trim();
  }
  return text;
}

const sentenceCase = (value: string) => value ? `${value[0].toUpperCase()}${value.slice(1)}` : "";
const concise = (value: string, limit = 160) => value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;

function creativeFact(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return readableValue(value);
  const fact = asRecord(value);
  const properties = asRecord(fact.properties);
  const type = String(fact.type ?? properties.type ?? "");
  const typeLabel = blockTypeDefinition(type)?.label ?? readableValue(fact.role ?? fact.kind);
  const detail = readableValue(properties.text ?? properties.instruction ?? properties.description ?? properties.label)
    || readableValue(fact.text ?? fact.instruction ?? fact.description ?? fact.label ?? fact.title)
    || readableValue(fact.handle ?? properties.handle)
    || readableValue(properties.colors ?? properties.palette ?? fact.colors ?? fact.palette)
    || readableValue(properties)
    || readableValue(fact.value);
  if (!detail) return "";
  const negative = ["avoid", "prohibit"].includes(String(properties.intent ?? fact.intent ?? ""));
  const prefixed = typeLabel && !detail.toLowerCase().startsWith(typeLabel.toLowerCase()) ? `${typeLabel}: ${detail}` : detail;
  return negative ? `Avoid ${prefixed.toLowerCase()}` : prefixed;
}

function creativeContextSummary(context: Record<string, unknown>, limit = 5): string {
  return [...new Set(list(context.facts).map(creativeFact).filter(Boolean))].slice(0, limit).join(" · ");
}

function documentTitle(projection: CreativeProjection, documentId: string): string {
  return readableValue(projection.documents.find((document) => document.id === documentId)?.title)
    || readableValue(projection.documentTitle)
    || "Creative study";
}

function generationTitle(event: CreativeEvent | undefined, context: Record<string, unknown>, projection: CreativeProjection, documentId: string): string {
  const brief = asRecord(event?.payload.output_brief);
  return concise(readableValue(event?.payload.title)
    || readableValue(brief.title ?? brief.label)
    || creativeFact(list(context.facts)[0])
    || documentTitle(projection, documentId), 96);
}

function proposedAction(proposed: Record<string, unknown>, projection: CreativeProjection): string {
  const eventType = String(proposed.type ?? "");
  const payload = asRecord(proposed.payload);
  const block = projection.libraryBlocks.find((item) => item.id === String(payload.block_id ?? ""));
  const type = String(payload.type ?? payload.block_type ?? block?.type ?? "");
  const typeLabel = blockTypeDefinition(type)?.label.toLowerCase()
    || readableValue(payload.property ?? payload.property_path)?.replace(/[_-]+/g, " ")
    || "creative direction";
  const detail = readableValue(payload.new_value ?? payload.value ?? asRecord(payload.properties).text)
    || readableValue(payload.handle ?? block?.handle);
  const verb = eventType === "BlockCreated" ? "Add"
    : /(?:Removed|Deleted)/.test(eventType) ? "Remove"
    : /(?:Locked|Protected)/.test(eventType) ? "Protect"
    : /(?:Weight|Influence)/.test(eventType) ? "Adjust the influence of"
    : "Refine";
  const subject = `${verb} ${typeLabel}`;
  return concise(detail && !subject.toLowerCase().includes(detail.toLowerCase()) ? `${subject} · ${detail}` : subject, 96);
}

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const tokens = (value: unknown) => JSON.stringify(value)
  .toLowerCase()
  .replace(/[^a-z0-9#]+/g, " ")
  .trim()
  .split(/\s+/)
  .filter((token) => token.length > 1);

export function embedText(value: unknown): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  for (const token of tokens(value)) {
    const hash = Number.parseInt(stableHash(token), 16);
    const slot = hash % EMBEDDING_DIMENSIONS;
    vector[slot] += (hash & 1 ? 1 : -1) * (1 + Math.min(3, token.length / 8));
  }
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  return magnitude ? vector.map((item) => Number((item / magnitude).toFixed(8))) : vector;
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || !left.length) return 0;
  return left.reduce((sum, item, index) => sum + item * right[index], 0);
}

function collectionIdsFor(projection: CreativeProjection, objectId: string, documentId: string) {
  const ids = new Set<string>();
  const direct = projection.membership[objectId];
  const document = projection.membership[documentId];
  if (direct) ids.add(direct.collectionId);
  if (document) ids.add(document.collectionId);
  if(projection.libraryBlocks.some(block=>block.id===objectId))for(const candidate of projection.documents){
    const filed=projection.membership[candidate.id];if(filed&&ideasInDocument(projection,candidate.id).some(block=>block.id===objectId))ids.add(filed.collectionId);
  }
  return [...ids];
}

function relevantBlockEvent(event: CreativeEvent, blockId: string) {
  return String(event.payload.block_id ?? "") === blockId && /^(Block|Chip|Extraction|Fact)/.test(event.type);
}

function generationContext(events: CreativeEvent[], generationId: string) {
  return [...events].reverse().find((event) => event.type === "ContextCompiled" && String(event.payload.generation_id ?? "") === generationId);
}

function engagementFor(events: CreativeEvent[], objectId: string) {
  return events.filter((event) => String(event.payload.object_id ?? "") === objectId || list(event.payload.object_ids).map(String).includes(objectId));
}

function eventProjectOwnership(events: CreativeEvent[]) {
  const ownership = new Map<string, string>();
  const documentProjects = new Map<string, string>();
  const blockProjects = new Map<string, string>();
  const canvasProjects = new Map<string, string>();
  const generationProjects = new Map<string, string>();
  const objectProjects = new Map<string, string>();
  const proposalProjects = new Map<string, string>();
  let currentProjectId = "";

  for (const event of events) {
    const payload = event.payload;
    const explicitProjectId = String(payload.project_id ?? "");
    if (event.type === "ProjectCreated" || event.type === "ProjectOpened") currentProjectId = explicitProjectId || currentProjectId;

    const documentId = String(payload.document_id ?? payload.target_document_id ?? "");
    const blockId = String(payload.block_id ?? payload.target_block_id ?? "");
    const canvasId = String(payload.canvas_id ?? "");
    const generationId = String(payload.generation_id ?? "");
    const objectId = String(payload.object_id ?? "");
    const proposalProject = list(payload.proposed_events).map(asRecord).map((proposed) => {
      const proposedPayload = asRecord(proposed.payload);
      return String(proposedPayload.project_id ?? "")
        || documentProjects.get(String(proposedPayload.document_id ?? ""))
        || blockProjects.get(String(proposedPayload.block_id ?? ""))
        || "";
    }).find(Boolean);
    const projectId = explicitProjectId
      || documentProjects.get(documentId)
      || blockProjects.get(blockId)
      || canvasProjects.get(canvasId)
      || generationProjects.get(generationId)
      || objectProjects.get(objectId)
      || proposalProjects.get(String(payload.proposal_event_id ?? ""))
      || proposalProject
      || currentProjectId;

    if (projectId) ownership.set(event.eventId, projectId);
    if (event.type === "DocumentCreated" || event.type === "DocumentForked") {
      if (documentId && projectId) documentProjects.set(documentId, projectId);
      if (projectId) currentProjectId = projectId;
    } else if (event.type === "DocumentOpened") {
      currentProjectId = documentProjects.get(documentId) || projectId || currentProjectId;
    }
    if (event.type === "CanvasCreated" && canvasId && projectId) canvasProjects.set(canvasId, projectId);
    if (event.type === "BlockCreated" && blockId && projectId) blockProjects.set(blockId, projectId);
    if (generationId && projectId) generationProjects.set(generationId, projectId);
    if (event.type === "MutationProposed" && projectId) proposalProjects.set(event.eventId, projectId);
    if (projectId) {
      for (const id of [objectId, ...list(payload.object_ids).map(String)].filter(Boolean)) objectProjects.set(id, projectId);
    }
  }
  return ownership;
}

export function buildVectorIndex(events: CreativeEvent[]): VectorItem[] {
  const projection = foldEvents(events);
  const promotedDraftIds=new Set(generationPromotionSignals(events).map((signal)=>signal.draftObjectId));
  const blocks: VectorItem[] = projection.libraryBlocks.map((block) => {
    const sources = events.filter((event) => relevantBlockEvent(event, block.id));
    return {
      id: block.id,
      kind: "block",
      label: block.handle,
      vector: embedText({ handle: block.handle, type: block.type, properties: block.properties }),
      embeddingModelId: EMBEDDING_MODEL_ID,
      embeddingVersion: EMBEDDING_VERSION,
      sourceSequence: sources.at(-1)?.sequence ?? 0,
      sourceEventIds: sources.map((event) => event.eventId),
      collectionIds: collectionIdsFor(projection, block.id, block.documentId),
      accepted: String(block.properties.authority ?? "authored") === "authored",
    };
  });
  const outputs: VectorItem[] = projection.libraryOutputs.map((output) => {
    const completed = events.find((event) => event.type === "GenerationCompleted" && list(event.payload.object_ids).map(String).includes(output.id));
    const compiled = generationContext(events, output.generationId);
    const engagement = engagementFor(events, output.id);
    const accepted = promotedDraftIds.has(output.id)||engagement.some((event) => /^(ObjectSaved|ObjectPinned|ObjectExported|AddedToLibrary|PromptFanOutputPromoted)$/.test(event.type));
    const context = asRecord(compiled?.payload.compiled_snapshot);
    return {
      id: output.id,
      kind: "output",
      label: creativeContextSummary(context) || generationTitle(completed, context, projection, output.documentId),
      vector: embedText({ context, provider: output.provider, model: output.modelId }),
      embeddingModelId: EMBEDDING_MODEL_ID,
      embeddingVersion: EMBEDDING_VERSION,
      sourceSequence: Math.max(completed?.sequence ?? 0, compiled?.sequence ?? 0, engagement.at(-1)?.sequence ?? 0),
      sourceEventIds: [compiled?.eventId, completed?.eventId, ...engagement.map((event) => event.eventId)].filter((value): value is string => Boolean(value)),
      collectionIds: collectionIdsFor(projection, output.id, output.documentId),
      accepted,
    };
  });
  return [...blocks, ...outputs];
}

export function buildFewShotCorpus(events: CreativeEvent[], content: Record<string, string> = {}, options: FewShotCorpusOptions = {}): FewShotExemplar[] {
  const projection = foldEvents(events, Number.POSITIVE_INFINITY, "", options.projectId ?? "");
  const eventProjects = options.projectId ? eventProjectOwnership(events) : null;
  const belongsToProject = (event: CreativeEvent) => !options.projectId || eventProjects?.get(event.eventId) === options.projectId;
  const promotions=generationPromotionSignals(events);
  const exemplars: FewShotExemplar[] = [];
  for (const event of events.filter((item) => item.type === "MutationProposed" && belongsToProject(item))) {
    const accepted = events.find((item) => item.type === "ProposalAccepted" && String(item.payload.proposal_event_id ?? "") === event.eventId);
    if (!accepted) continue;
    const proposed = list(event.payload.proposed_events).map(asRecord);
    const actions = proposed.map((item) => proposedAction(item, projection)).filter(Boolean);
    const prompt = readableValue(content[String(event.payload.content_ref ?? "")]) || actions.join("; ") || "Accepted a change to the creative direction.";
    const label = concise(actions.join(" · ") || sentenceCase(prompt) || "Accepted creative decision", 112);
    exemplars.push({
      exemplarId: `proposal:${event.eventId}`,
      kind: "accepted-proposal",
      label,
      summary: prompt,
      citations: [event.eventId, accepted.eventId],
      sourceSequence: accepted.sequence,
      collectionIds: collectionIdsFor(projection, String(event.payload.document_id??projection.documentId), String(event.payload.document_id??projection.documentId)),
      vector: embedText({ prompt, proposed }),
    });
  }
  for (const event of events.filter((item) => item.type === "ChipEdited" && belongsToProject(item))) {
    const blockId = String(event.payload.block_id ?? "");
    const extracted = [...events].reverse().find((item) => item.sequence < event.sequence && item.type === "ExtractionCompleted" && String(item.payload.block_id ?? "") === blockId);
    if (!extracted) continue;
    const property = String(event.payload.property ?? "value");
    const block = projection.libraryBlocks.find((item) => item.id === blockId);
    const propertyLabel = property === "colors" ? "color palette" : property.replace(/[_-]+/g, " ");
    const blockLabel = blockTypeDefinition(block?.type ?? "")?.label.toLowerCase() ?? propertyLabel;
    const previous = readableValue(event.payload.old_value) || "the inferred value";
    const authored = readableValue(event.payload.new_value) || "the authored value";
    exemplars.push({
      exemplarId: `correction:${event.eventId}`,
      kind: "authored-correction",
      label: `Refine ${blockLabel === "palette" ? "color palette" : blockLabel}`,
      summary: `${previous} → ${authored}`,
      citations: [extracted.eventId, event.eventId],
      sourceSequence: event.sequence,
      collectionIds: collectionIdsFor(projection, blockId, projection.libraryBlocks.find((block)=>block.id===blockId)?.documentId??String(event.payload.document_id??projection.documentId)),
      vector: embedText({ blockId, property, old: event.payload.old_value, value: event.payload.new_value }),
    });
  }
  for (const event of events.filter((item) => item.type === "GenerationCompleted" && belongsToProject(item))) {
    const generationId = String(event.payload.generation_id ?? "");
    const objectIds = list(event.payload.object_ids).map(String);
    const engagement = events.filter((item) => item.sequence > event.sequence && objectIds.some((id) => String(item.payload.object_id ?? "") === id) && /^(ObjectSaved|ObjectPinned|ObjectExported|AddedToLibrary|PromptFanOutputPromoted)$/.test(item.type));const promotion=promotions.find((signal)=>signal.status==="completed"&&signal.fullGenerationId===generationId);
    if (!engagement.length&&!promotion) continue;
    const compiled = generationContext(events, generationId);
    const context = asRecord(compiled?.payload.compiled_snapshot);
    const outputDocumentId = String(event.payload.document_id ?? projection.libraryOutputs.find((output) => output.id === objectIds[0])?.documentId ?? projection.documentId);
    const title = generationTitle(event, context, projection, outputDocumentId);
    const summary = creativeContextSummary(context)
      || readableValue(asRecord(event.payload.output_brief).purpose ?? event.payload.summary ?? event.payload.rationale)
      || `Saved visual direction from ${documentTitle(projection, outputDocumentId)}.`;
    exemplars.push({
      exemplarId: `generation:${event.eventId}`,
      kind: "kept-generation",
      label: `Saved image · ${title}`,
      summary: concise(summary, 320),
      citations: [compiled?.eventId,event.eventId,engagement[0]?.eventId,...(promotion?.evidenceRefs??[])].filter((value,index,items): value is string => Boolean(value)&&items.indexOf(value)===index),
      sourceSequence: engagement[0]?.sequence??event.sequence,
      collectionIds: collectionIdsFor(projection, objectIds[0] ?? "", outputDocumentId),
      vector: embedText({ context, outcomes: [...engagement.map((item) => item.type),...(promotion?["IdeationPromoted"]:[])] }),
    });
  }
  return exemplars.sort((left, right) => right.sourceSequence - left.sourceSequence);
}

export function retrieveFewShotExemplars(events: CreativeEvent[], query: string, content: Record<string, string> = {}, options: FewShotRetrievalOptions = {}): RetrievedExemplar[] {
  const queryVector = embedText(query);
  return buildFewShotCorpus(events, content, { projectId: options.projectId })
    .filter((item) => !options.collectionId || item.collectionIds.includes(options.collectionId))
    .map((item) => ({ ...item, score: cosineSimilarity(queryVector, item.vector) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.sourceSequence - left.sourceSequence)
    .slice(0, options.limit ?? 3);
}

function familyLabel(items: VectorItem[]) {
  const common = tokens(items[0]?.label ?? "").filter((token) => items.every((item) => tokens(item.label).includes(token)));
  if (common.includes("warm") && common.includes("nocturne")) return "Warm nocturnes";
  const ignored = new Set(["direction", "reference", "palette", "block", "output", "object", "adapter", "neutral"]);
  const useful = common.filter((token) => !ignored.has(token) && !/^\d+$/.test(token));
  const words = useful.slice(0, 2);
  if (!words.length) return "Related studies";
  return `${words[0][0].toUpperCase()}${words[0].slice(1)}${words[1] ? ` ${words[1]}` : " studies"}`;
}

function clusterFamilies(events: CreativeEvent[], items: VectorItem[]): IndexedFamily[] {
  const outputs = items.filter((item) => item.kind === "output");
  const unused = new Set(outputs.map((item) => item.id));
  const byId = new Map(outputs.map((item) => [item.id, item]));
  const clusters: VectorItem[][] = [];
  while (unused.size) {
    const seedId = unused.values().next().value as string;
    const seed = byId.get(seedId)!; unused.delete(seedId);
    const cluster = [seed];
    for (const candidateId of [...unused]) {
      const candidate = byId.get(candidateId)!;
      if (cluster.some((item) => cosineSimilarity(item.vector, candidate.vector) >= 0.72)) { cluster.push(candidate); unused.delete(candidateId); }
    }
    if (cluster.length >= 2) clusters.push(cluster);
  }
  const sourceHead = items.reduce((head, item) => Math.max(head, item.sourceSequence), 0);
  return clusters.map((cluster) => {
    const ids = cluster.map((item) => item.id).sort();
    const label = familyLabel(cluster);
    const pairScores: number[] = [];
    for (let left = 0; left < cluster.length; left++) for (let right = left + 1; right < cluster.length; right++) pairScores.push(cosineSimilarity(cluster[left].vector, cluster[right].vector));
    const similarity = pairScores.reduce((sum, score) => sum + score, 0) / Math.max(1, pairScores.length);
    const acceptedRatio = cluster.filter((item) => item.accepted).length / cluster.length;
    const confidence = Number(Math.min(.97, similarity * .82 + acceptedRatio * .18).toFixed(2));
    const signature = stableHash(`${EMBEDDING_MODEL_ID}:${sourceHead}:${ids.join(":")}:${label}`);
    const existing = [...events].reverse().find((event) => event.type === "FamilyDeclared" && String(event.payload.label ?? "").toLowerCase() === label.toLowerCase());
    const familyId = String(existing?.payload.family_id ?? `family-${stableHash(`${EMBEDDING_MODEL_ID}:${ids.join(":")}`)}`);
    const evidenceRefs = cluster.flatMap((item) => item.sourceEventIds).slice(0, 12);
    return {
      familyId,
      label,
      confidence,
      anchorObjectId: cluster.find((item) => item.accepted)?.id ?? cluster[0].id,
      evidenceRefs,
      sourceHead,
      indexSignature: signature,
      members: cluster.map((item) => ({ objectId: item.id, confidence: Number(Math.max(.5, cosineSimilarity(cluster[0].vector, item.vector)).toFixed(2)), evidenceRefs: item.sourceEventIds.slice(0, 4), claimRef: `family-membership:${familyId}:${item.id}` })),
    };
  });
}

export function buildPhase7Index(events: CreativeEvent[], content: Record<string, string> = {}): Phase7Index {
  const items = buildVectorIndex(events);
  return {
    embeddingModelId: EMBEDDING_MODEL_ID,
    embeddingVersion: EMBEDDING_VERSION,
    sourceHead: items.reduce((head, item) => Math.max(head, item.sourceSequence), 0),
    items,
    exemplars: buildFewShotCorpus(events, content),
    families: clusterFamilies(events, items),
  };
}

export function phase7IndexStatus(events: CreativeEvent[], content: Record<string, string> = {}) {
  const index = buildPhase7Index(events, content);
  const receipts = events.filter((event) => event.type === "FamilyDeclared" && event.payload.embedding_model_id === EMBEDDING_MODEL_ID);
  const indexedThrough = receipts.reduce((head, event) => Math.max(head, Number(event.payload.source_head ?? 0)), 0);
  const activeFamilies = foldEvents(events).families.filter((family) => !family.superseded);
  return {
    ...index,
    indexedThrough,
    staleBy: Math.max(0, index.sourceHead - indexedThrough),
    fresh: indexedThrough >= index.sourceHead && index.sourceHead > 0,
    activeFamilyCount: activeFamilies.length,
  };
}
