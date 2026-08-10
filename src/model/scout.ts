import { buildPhase7Index, cosineSimilarity } from "./indexing.ts";
import { foldEvents, type CreativeEvent } from "./events.ts";

export type ScoutObservationType = "convergence" | "divergence" | "stall" | "adjacency";

export type ScoutTrajectorySlice = {
  sliceId: string;
  type: ScoutObservationType;
  label: string;
  summary: string;
  confidence: number;
  evidenceRefs: string[];
  metrics: Record<string, number | string>;
  signature: string;
  candidate?: { kind: "style-anchor" | "palette-anchor"; label: string; colors: string[]; sourceFamilyRef?: string };
};

export type ScoutEnvelope = {
  remainingTokens: number;
  requestedTokens: number;
  maxObservations: number;
  plannedVariants: number;
  historicalTokensPerVariant: number;
  capabilities: string[];
  fits: boolean;
};

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const round = (value: number, precision = 3) => Number(value.toFixed(precision));
const eventRef = (event: CreativeEvent | undefined) => event ? `event:${event.eventId}` : "";

function rejectedObservationSignatures(events: CreativeEvent[]) {
  const observations = new Map(events.filter((event) => event.type === "ScoutObserved").map((event) => [String(event.payload.observation_id), String(event.payload.signature ?? "")]));
  return new Set(events.filter((event) => event.type === "ObservationJudged" && event.payload.verdict === "rejected").map((event) => String(event.payload.observation_signature ?? observations.get(String(event.payload.observation_id)) ?? "")).filter(Boolean));
}

function paletteFor(label: string) {
  const warm = /warm|amber|sun|dusk/i.test(label);
  const dark = /night|nocturne|shadow/i.test(label);
  if (warm && dark) return ["#201d25", "#6f4142", "#d48a5d", "#edd4ac"];
  if (warm) return ["#4b302d", "#a45d45", "#e9a073", "#f0d6ad"];
  if (dark) return ["#17242b", "#2f4855", "#6f7f87", "#c5c3b8"];
  return ["#26352f", "#557265", "#a8b6a5", "#e4ddc8"];
}

export function buildScoutTrajectory(events: CreativeEvent[]): ScoutTrajectorySlice[] {
  const index = buildPhase7Index(events);
  const projection = foldEvents(events);
  const outputs = index.items.filter((item) => item.kind === "output").sort((left, right) => left.sourceSequence - right.sourceSequence);
  const recent = outputs.slice(-6);
  const generationEvents = events.filter((event) => event.type === "GenerationCompleted" && event.payload.report_space !== "scout");
  const requestEvents = events.filter((event) => event.type === "GenerationRequested" && event.actor !== "worker:scout");
  const engagementEvents = events.filter((event) => /^(ObjectSaved|ObjectPinned|ObjectExported|AddedToLibrary|BriefItemAccepted)$/.test(event.type));
  const comparisonEvents = events.filter((event) => event.type === "ComparisonOpened");
  const similarities = recent.slice(1).map((item, index) => cosineSimilarity(recent[index].vector, item.vector));
  const meanSimilarity = similarities.length ? similarities.reduce((sum, value) => sum + value, 0) / similarities.length : 0;
  const acceptedRecent = recent.filter((item) => item.accepted).length;
  const evidenceRefs = recent.flatMap((item) => item.sourceEventIds).slice(-10).map((id) => `event:${id}`);
  const headRange = `${recent.at(0)?.sourceSequence ?? 0}-${recent.at(-1)?.sourceSequence ?? events.at(-1)?.sequence ?? 0}`;
  const slices: ScoutTrajectorySlice[] = [];

  if (recent.length >= 2 && meanSimilarity >= .72) {
    const signature = `convergence:${headRange}:${round(meanSimilarity,2)}`;
    slices.push({
      sliceId: `trajectory:${headRange}:convergence`, type: "convergence", label: "The recent work is converging",
      summary: "Recent generations are drawing closer in context-space. This may be useful convergence or premature collapse; compare the cited outputs before accepting it.",
      confidence: round(Math.min(.94, .55 + meanSimilarity * .42)), evidenceRefs, signature,
      metrics: { recent_generations: recent.length, mean_similarity: round(meanSimilarity), accepted_recent: acceptedRecent, comparisons: comparisonEvents.length },
      candidate: { kind: "style-anchor", label: "Converging visual language", colors: paletteFor(recent.map((item) => item.label).join(" ")) },
    });
  } else if (recent.length >= 2) {
    const spread = round(1 - meanSimilarity);
    const signature = `divergence:${headRange}:${round(meanSimilarity,2)}`;
    slices.push({
      sliceId: `trajectory:${headRange}:divergence`, type: "divergence", label: "The recent work is still spreading",
      summary: "Recent generations remain far apart. That can indicate productive breadth, or an unresolved frame; the scout reports the shape without choosing a direction.",
      confidence: round(Math.min(.9, .52 + spread * .35)), evidenceRefs, signature,
      metrics: { recent_generations: recent.length, mean_similarity: round(meanSimilarity), spread, accepted_recent: acceptedRecent },
    });
  }

  const progression = Math.max(engagementEvents.length, outputs.filter((item) => item.accepted).length);
  const attempts = Math.max(requestEvents.length, generationEvents.length);
  if (attempts >= 3 && progression / attempts < .34) {
    const recentRequests = requestEvents.slice(-6); const signature = `stall:${recentRequests.at(0)?.sequence ?? 0}-${recentRequests.at(-1)?.sequence ?? events.at(-1)?.sequence ?? 0}`;
    slices.push({
      sliceId: `trajectory:${signature}:density`, type: "stall", label: "Iteration is outpacing commitment",
      summary: "Generation attempts are accumulating faster than saves, pins, exports, or accepted continuations. This is a stall marker, not a diagnosis.",
      confidence: round(Math.min(.9, .58 + Math.min(1, attempts / 10) * .28)), signature,
      evidenceRefs: [...recentRequests.map(eventRef), ...engagementEvents.slice(-3).map(eventRef)].filter(Boolean),
      metrics: { attempts, progression_events: progression, progression_ratio: round(progression / attempts), comparisons: comparisonEvents.length },
    });
  }

  const visitedObjects = new Set(events.filter((event) => /^(ObjectViewed|ObjectPinned|ObjectSaved|AddedToLibrary)$/.test(event.type)).flatMap((event) => [String(event.payload.object_id ?? ""), ...list(event.payload.object_ids).map(String)]));
  for (const family of projection.families.filter((item) => !item.superseded)) {
    const members = list(family.members).map((value) => value as Record<string, unknown>);
    if (!members.length || members.some((member) => visitedObjects.has(String(member.object_id)))) continue;
    const familyId = String(family.family_id); const label = String(family.label ?? familyId); const signature = `adjacency:${familyId}`;
    slices.push({
      sliceId: `family:${familyId}:unvisited`, type: "adjacency", label: `An unvisited neighboring family: ${label}`,
      summary: "This inferred family is adjacent to the current corpus but has no witnessed visits. It is offered as evidence, never auto-filed or chosen.",
      confidence: round(Number(family.confidence ?? .62)), signature,
      evidenceRefs: list(family.source_events).map(String).slice(-6).map((id) => `event:${id}`),
      metrics: { family_members: members.length, witnessed_visits: 0 },
      candidate: { kind: "palette-anchor", label: `${label} anchor`, colors: paletteFor(label), sourceFamilyRef: `family:${familyId}` },
    });
  }

  const rejected = rejectedObservationSignatures(events);
  return slices.filter((slice) => !rejected.has(slice.signature));
}

export function buildScoutEnvelope(events: CreativeEvent[], remainingTokens: number, maxObservations = 3): ScoutEnvelope {
  const usage = events.filter((event) => event.type === "GenerationUsageRecorded").map((event) => Number(event.payload.total_tokens ?? 0)).filter((value) => value > 0);
  const historicalTokensPerVariant = usage.length ? Math.round(usage.reduce((sum, value) => sum + value, 0) / usage.length) : 2_000;
  const plannedVariants = Math.max(1, Math.min(maxObservations, 4)); const requestedTokens = plannedVariants * historicalTokensPerVariant;
  const capabilities = [...new Set(events.filter((event) => event.type === "CapabilityDeclared").flatMap((event) => list(event.payload.capabilities).map(String)))];
  return { remainingTokens, requestedTokens, maxObservations, plannedVariants, historicalTokensPerVariant, capabilities, fits: requestedTokens <= remainingTokens };
}

export function scoutPrecisionLedger(events: CreativeEvent[]) {
  const observations = events.filter((event) => event.type === "ScoutObserved");
  const byId = new Map(observations.map((event) => [String(event.payload.observation_id), event]));
  const judgments = events.filter((event) => event.type === "ObservationJudged" && byId.has(String(event.payload.observation_id)));
  const counts = { confirmed: 0, rejected: 0, unclear: 0 };
  for (const judgment of judgments) { const verdict = String(judgment.payload.verdict) as keyof typeof counts; if (verdict in counts) counts[verdict] += 1; }
  const costUsd = events.filter((event) => event.type === "ScoutRunCompleted").reduce((sum, event) => sum + Number(event.payload.cost_usd ?? 0), 0);
  const meanConfidence = observations.length ? observations.reduce((sum, event) => sum + Number(event.payload.confidence ?? 0), 0) / observations.length : 0;
  const byType = (["convergence","divergence","stall","adjacency"] as ScoutObservationType[]).map((type) => {
    const ids = new Set(observations.filter((event) => event.payload.type === type).map((event) => String(event.payload.observation_id)));
    const judged = judgments.filter((event) => ids.has(String(event.payload.observation_id)));
    return { type, observations: ids.size, judged: judged.length, confirmed: judged.filter((event) => event.payload.verdict === "confirmed").length };
  });
  return {
    observations: observations.length, judged: judgments.length, ...counts, meanConfidence: round(meanConfidence), costUsd: round(costUsd,6),
    confirmedPerDollar: costUsd > 0 ? round(counts.confirmed / costUsd,2) : counts.confirmed > 0 ? Number.POSITIVE_INFINITY : null,
    byType,
  };
}
