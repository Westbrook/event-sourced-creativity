import { foldEvents, type CreativeEvent } from "./events.ts";
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

function collectionIdsFor(events: CreativeEvent[], objectId: string, documentId: string) {
  const projection = foldEvents(events);
  const ids = new Set<string>();
  const direct = projection.membership[objectId];
  const document = projection.membership[documentId];
  if (direct) ids.add(direct.collectionId);
  if (document) ids.add(document.collectionId);
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
      collectionIds: collectionIdsFor(events, block.id, projection.documentId),
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
      label: `${list(context.facts).map(String).join(" · ") || output.id}`,
      vector: embedText({ context, provider: output.provider, model: output.modelId }),
      embeddingModelId: EMBEDDING_MODEL_ID,
      embeddingVersion: EMBEDDING_VERSION,
      sourceSequence: Math.max(completed?.sequence ?? 0, compiled?.sequence ?? 0, engagement.at(-1)?.sequence ?? 0),
      sourceEventIds: [compiled?.eventId, completed?.eventId, ...engagement.map((event) => event.eventId)].filter((value): value is string => Boolean(value)),
      collectionIds: collectionIdsFor(events, output.id, projection.documentId),
      accepted,
    };
  });
  return [...blocks, ...outputs];
}

export function buildFewShotCorpus(events: CreativeEvent[], content: Record<string, string> = {}): FewShotExemplar[] {
  const projection = foldEvents(events);
  const promotions=generationPromotionSignals(events);
  const exemplars: FewShotExemplar[] = [];
  for (const event of events.filter((item) => item.type === "MutationProposed")) {
    const accepted = events.find((item) => item.type === "ProposalAccepted" && String(item.payload.proposal_event_id ?? "") === event.eventId);
    if (!accepted) continue;
    const proposed = list(event.payload.proposed_events).map(asRecord);
    const prompt = content[String(event.payload.content_ref ?? "")] ?? proposed.map((item) => String(item.type ?? "change")).join(" + ");
    const label = proposed.map((item) => String(item.type ?? "change")).join(" + ") || "Accepted chat proposal";
    exemplars.push({
      exemplarId: `proposal:${event.eventId}`,
      kind: "accepted-proposal",
      label,
      summary: prompt,
      citations: [event.eventId, accepted.eventId],
      sourceSequence: accepted.sequence,
      collectionIds: collectionIdsFor(events, projection.documentId, projection.documentId),
      vector: embedText({ prompt, proposed }),
    });
  }
  for (const event of events.filter((item) => item.type === "ChipEdited")) {
    const blockId = String(event.payload.block_id ?? "");
    const extracted = [...events].reverse().find((item) => item.sequence < event.sequence && item.type === "ExtractionCompleted" && String(item.payload.block_id ?? "") === blockId);
    if (!extracted) continue;
    const property = String(event.payload.property ?? "value");
    exemplars.push({
      exemplarId: `correction:${event.eventId}`,
      kind: "authored-correction",
      label: `Correct ${property}`,
      summary: `${String(event.payload.old_value ?? "inferred value")} → ${String(event.payload.new_value ?? "authored value")}`,
      citations: [extracted.eventId, event.eventId],
      sourceSequence: event.sequence,
      collectionIds: collectionIdsFor(events, blockId, projection.documentId),
      vector: embedText({ blockId, property, old: event.payload.old_value, value: event.payload.new_value }),
    });
  }
  for (const event of events.filter((item) => item.type === "GenerationCompleted")) {
    const generationId = String(event.payload.generation_id ?? "");
    const objectIds = list(event.payload.object_ids).map(String);
    const engagement = events.filter((item) => item.sequence > event.sequence && objectIds.some((id) => String(item.payload.object_id ?? "") === id) && /^(ObjectSaved|ObjectPinned|ObjectExported|AddedToLibrary|PromptFanOutputPromoted)$/.test(item.type));const promotion=promotions.find((signal)=>signal.status==="completed"&&signal.fullGenerationId===generationId);
    if (!engagement.length&&!promotion) continue;
    const compiled = generationContext(events, generationId);
    const context = asRecord(compiled?.payload.compiled_snapshot);
    exemplars.push({
      exemplarId: `generation:${event.eventId}`,
      kind: "kept-generation",
      label: `Kept generation · ${objectIds[0] ?? generationId}`,
      summary: list(context.facts).map(String).join(" · ") || "Accepted generation context",
      citations: [compiled?.eventId,event.eventId,engagement[0]?.eventId,...(promotion?.evidenceRefs??[])].filter((value,index,items): value is string => Boolean(value)&&items.indexOf(value)===index),
      sourceSequence: engagement[0]?.sequence??event.sequence,
      collectionIds: collectionIdsFor(events, objectIds[0] ?? "", projection.documentId),
      vector: embedText({ context, outcomes: [...engagement.map((item) => item.type),...(promotion?["IdeationPromoted"]:[])] }),
    });
  }
  return exemplars.sort((left, right) => right.sourceSequence - left.sourceSequence);
}

export function retrieveFewShotExemplars(events: CreativeEvent[], query: string, content: Record<string, string> = {}, options: { limit?: number; collectionId?: string } = {}): RetrievedExemplar[] {
  const queryVector = embedText(query);
  return buildFewShotCorpus(events, content)
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
