import { SignalArray } from "signal-utils/array";
import type { CreativeEvent } from "./events";

export type ScenarioKey = "creative-loop" | "async-return" | "concurrency" | "promotion";

export const SCENARIOS = [
  { key: "creative-loop" as const, label: "Creative loop", kicker: "Authored wins", summary: "A user corrects an inferred palette, compiles a stable snapshot, compares variants, and exports with receipts.", actors: ["user", "worker:extractor", "worker:compiler", "worker:generator"] },
  { key: "async-return" as const, label: "Asynchronous return", kicker: "Agency preserved", summary: "The brief composer and scout prepare evidence between sessions; nothing enters the document until the user accepts it.", actors: ["user", "worker:brief", "worker:scout"] },
  { key: "concurrency" as const, label: "Concurrent pressure", kicker: "Conflicts are explicit", summary: "Commutative engagement lands immediately, stale generation is held for reconfirmation, and a partially valid batch still makes progress.", actors: ["user", "model:forma-chat", "worker:validator"] },
  { key: "promotion" as const, label: "Family promotion", kicker: "Inference is not authorship", summary: "An agent detects an aesthetic family. The user alone decides to keep it as a durable collection.", actors: ["worker:indexer", "model:forma-chat", "user"] },
];

const baseTypes: Record<ScenarioKey, Array<[string, string]>> = {
  "creative-loop": [["user","ProjectCreated"],["user","DocumentCreated"],["user","BlockCreated"],["user","ReferenceIngested"],["worker:extractor","ExtractionCompleted"],["user","ChipEdited"],["user","GenerationRequested"],["worker:compiler","ContextCompiled"],["worker:generator","GenerationCompleted"],["user","ComparisonOpened"],["user","ObjectPinned"],["user","ObjectExported"]],
  "async-return": [["user","SessionClosed"],["worker:brief","BriefComposed"],["user","BriefItemPresented"],["worker:scout","ScoutRunStarted"],["worker:scout","GenerationRequested"],["worker:scout","GenerationCompleted"],["worker:scout","ScoutObserved"],["worker:scout","ScoutRunCompleted"],["user","ObservationJudged"],["user","BriefItemAccepted"],["user","BlockCreated"]],
  concurrency: [["model:forma-chat","MutationProposed"],["user","ObjectViewed"],["user","AnnotationAdded"],["user","ProposalAccepted"],["user","GenerationRequested"],["worker:validator","ValidationFailed"],["user","BlockPropertyEdited"],["user","ObjectPinned"],["user","ProposalRejected"]],
  promotion: [["worker:indexer","FamilyDeclared"],["worker:indexer","FamilyMembershipAsserted"],["model:forma-chat","MutationProposed"],["user","ProposalAccepted"],["user","CollectionCreated"],["user","CollectionItemAdded"],["user","CollectionRenamed"]],
};

function payloadFor(type: string, i: number, key: ScenarioKey): Record<string, unknown> {
  const n = i % 24;
  if (type === "ProjectCreated") return { project_id: "p-long", name: "Long horizon study", state: "active" };
  if (type === "DocumentCreated") return { document_id: "d-long", title: "Atmosphere studies" };
  if (type === "BlockCreated") return { block_id: `block-${n}`, type: n % 3 ? "direction" : "palette", handle: `study/block-${n}`, position: `a${String(n).padStart(3,"0")}`, properties: { text: "A quiet, warm nocturne", authority: "authored", weight: .8 } };
  if (type === "ChipEdited") return { block_id: `block-${n}`, chip_id: `chip-${n}`, property: "warmth", old_value: .5, new_value: .72 };
  if (type.includes("Generation")) return type === "GenerationCompleted" ? { generation_id: `g-${i}`, model_id: "adapter-neutral", object_ids: [`object-${i}`], latency_ms: 930 } : { generation_id: `g-${i}`, document_version: i };
  if (type === "ContextCompiled") return { generation_id: `g-${i}`, model_id: "adapter-neutral", adapter_version: "v0.2", compiled_snapshot: { facts: ["direction/nocturne"], pins: ["palette/dusk-warm"], tail: [] }, source_block_versions: [{ block_id: `block-${n}`, version: i }] };
  if (type === "CollectionCreated") return { collection_id: `collection-${n}`, handle: `kept-family-${n}`, parent_collection_id: null, source_claim_ref: `family-${n}` };
  if (type === "CollectionItemAdded") return { collection_id: `collection-${n}`, item_ref: { document_id: "d-long" }, position: "a0" };
  if (type === "FamilyDeclared") return { family_id: `family-${n}`, label: "Warm nocturnes", confidence: .81 };
  if (type === "FamilyMembershipAsserted") return { family_id: `family-${n}`, object_id: `object-${i}`, confidence: .77 };
  if (type === "BriefComposed") return { brief_id: `brief-${i}`, items: [{ item_id: `item-${i}`, item_type: "comparison", rank: 1 }] };
  if (type === "ScoutObserved") return { run_id: `run-${i}`, observation_id: `obs-${i}`, type: "adjacency", confidence: .74, evidence_refs: [`slice:${i-2}:${i}`] };
  if (type === "ValidationFailed") return { attempted_type: "emit_events", attempted_by: "model:forma-chat", errors: [{ index: 1, reason: "stale_sequence" }] };
  return { scenario: key, ref_id: `ref-${i}`, scope: "project", ...(type === "MutationProposed" ? { note: "Proposal is inert until accepted." } : {}) };
}

export function buildScenario(key: ScenarioKey, count: number): CreativeEvent[] {
  const list = new SignalArray<CreativeEvent>();
  const pattern = baseTypes[key];
  const start = Date.UTC(2026, 0, 5, 9);
  for (let i = 0; i < count; i++) {
    const [actor, type] = pattern[i % pattern.length];
    const at = new Date(start + i * 37_000).toISOString();
    list.push({ eventId: `theory-${key}-${i+1}`, streamId: `theory:${key}`, sequence: i + 1, occurredAt: at, recordedAt: at, actor, clientId: i % 17 === 0 ? "web:secondary" : "web:primary", correlationId: `corr-${Math.floor(i / pattern.length)}`, causationId: i ? `theory-${key}-${i}` : null, compensatesEventId: null, schemaVersion: 1, type, payload: payloadFor(type, i, key) });
  }
  return Array.from(list);
}
