import { DOCUMENT_VIEWS } from './document-view-signals.ts';
import type { DocumentView } from './routes.ts';
import { DOCUMENT_ARTIFACT_KINDS } from "./document-artifacts.ts";
import { memoryTimestamp, parseMemoryLifetime, type MemoryRecallLifetime } from "./memory-lifetime.ts";
import { snapshotMemoryConsumptionInput } from "./memory-consumption-episodes.ts";

export const MEMORY_CONSUMPTION_V2 = "memory-consumption-episodes-v2" as const;
/** Explicit historical-view negotiation; V2 remains current-only. */
export const MEMORY_CONSUMPTION_V3 = "memory-consumption-episodes-v3" as const;
/** Explicit governed artifact-view negotiation; V2/V3 remain personal-only. */
export const MEMORY_CONSUMPTION_V4 = "memory-consumption-episodes-v4" as const;
/** Explicit native document-block inspector receipts; earlier contracts stay unchanged. */
export const MEMORY_CONSUMPTION_V5 = "memory-consumption-episodes-v5" as const;
/** Explicit canonical document-page targets; earlier projections keep document-only visits. */
export const MEMORY_CONSUMPTION_V6 = "memory-consumption-episodes-v6" as const;
export type MemoryArtifactConsumptionVersion = typeof MEMORY_CONSUMPTION_V2 | typeof MEMORY_CONSUMPTION_V3 | typeof MEMORY_CONSUMPTION_V4 | typeof MEMORY_CONSUMPTION_V5 | typeof MEMORY_CONSUMPTION_V6;
export type MemoryConsumptionTarget = {kind:"page";documentId:string;view:DocumentView} | { kind: "document"; documentId: string } | {
  kind: "artifact"; documentId: string; artifactId: string; artifactKind: string; revision: number; contentSha256: string;
} | { kind: "block"; documentId: string; blockId: string; revision: number; stateSha256: string };
export type MemoryConsumptionV2Source = { eventId: string; type: "DocumentViewVisited" | "DocumentArtifactViewed" | "BlockInspected";
  recordedAt: string; validUntil: string; target: MemoryConsumptionTarget };
export type MemoryConsumptionV2 = {
  version: MemoryArtifactConsumptionVersion; treatment: "descriptive-consumption"; validUntil: string;
  sources: MemoryConsumptionV2Source[];
  episodes: { episodeId: null; observations: [{ sourceIndex: number; kind: "visit" | "viewer-open" | "inspector-open" }];
    firstRecordedAt: string; lastRecordedAt: string; validUntil: string; independentEvidence: false }[];
  coverage: { eligibleSourceCount: number; observationCount: number; unavailableArtifactSourceCount: number; unavailableBlockSourceCount?: number;
    completeHistory: false; bounded: true; truncated: boolean };
  attention: "not-measured"; comprehension: "not-measured"; inferredPreferences: false;
};
type Row = Record<string, unknown>;
function check(value: unknown): asserts value { if (!value) throw new Error("consumption_v2_invalid"); }
function row(value: unknown, keys: string[]): Row {
  check(!!value && typeof value === "object" && !Array.isArray(value));
  check(Object.keys(value).sort().join(",") === [...keys].sort().join(",")); return value as Row;
}
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240 && value.trim() === value && value.isWellFormed();
function at(value: unknown) { const result = memoryTimestamp(value); check(result !== null); return result; }

/** A negotiated, inspector-only map. Its source indexes never address the
 * enclosing assistant/outcome source map. No new display lease or authority. */
function parseArtifactConsumption(original: unknown, originalLifetime: MemoryRecallLifetime, documentId: string,
  sourceWindow: { since: string; expiresAt: string }, expectedVersion: MemoryArtifactConsumptionVersion): MemoryConsumptionV2 | null {
  try {
    const input = snapshotMemoryConsumptionInput({ original, lifetime: originalLifetime, documentId, sourceWindow }) as Row;
    const lifetime = parseMemoryLifetime(input.lifetime); check(lifetime && id(input.documentId));
    const window = row(input.sourceWindow, ["since", "expiresAt"]), since = at(window.since), expires = at(window.expiresAt);
    check(since <= at(lifetime.checkedAt) && expires >= at(lifetime.validUntil));
    const value = row(input.original, ["version", "treatment", "validUntil", "sources", "episodes", "coverage", "attention", "comprehension", "inferredPreferences"]);
    check(value.version === expectedVersion && value.treatment === "descriptive-consumption" && value.validUntil === lifetime.validUntil
      && value.attention === "not-measured" && value.comprehension === "not-measured" && value.inferredPreferences === false);
    check(Array.isArray(value.sources) && value.sources.length <= 64 && Array.isArray(value.episodes) && value.episodes.length === value.sources.length);
    const seen = new Set<string>(), checked = at(lifetime.checkedAt), until = at(lifetime.validUntil);
    const sources = value.sources.map(item => {
      const source = row(item, ["eventId", "type", "recordedAt", "validUntil", "target"]);
      check(id(source.eventId) && !seen.has(source.eventId) && at(source.recordedAt) >= since && at(source.recordedAt) <= checked
        && at(source.validUntil) >= until && at(source.validUntil) <= expires && at(source.validUntil) > at(source.recordedAt)); seen.add(source.eventId);
      const target = source.target as Row;
      check(target && target.documentId === input.documentId);
      if (source.type === "DocumentViewVisited") {
        if(expectedVersion===MEMORY_CONSUMPTION_V6){row(target,["kind","documentId","view"]);check(target.kind==='page'&&DOCUMENT_VIEWS.includes(target.view as DocumentView));}
        else{row(target, ["kind", "documentId"]); check(target.kind === "document");}
      }
      else if (source.type === "BlockInspected") {
        check((expectedVersion === MEMORY_CONSUMPTION_V5 || expectedVersion === MEMORY_CONSUMPTION_V6)); row(target, ["kind", "documentId", "blockId", "revision", "stateSha256"]);
        check(target.kind === "block" && id(target.blockId) && Number.isSafeInteger(target.revision) && Number(target.revision) >= 1
          && typeof target.stateSha256 === "string" && /^[a-f0-9]{64}$/u.test(target.stateSha256));
      } else {
        check(source.type === "DocumentArtifactViewed"); row(target, ["kind", "documentId", "artifactId", "artifactKind", "revision", "contentSha256"]);
        check(target.kind === "artifact" && id(target.artifactId) && typeof target.artifactKind === "string"
          && (DOCUMENT_ARTIFACT_KINDS as readonly string[]).includes(target.artifactKind) && Number.isSafeInteger(target.revision) && Number(target.revision) >= 0
          && typeof target.contentSha256 === "string" && /^[a-f0-9]{64}$/u.test(target.contentSha256));
      }
      return source as unknown as MemoryConsumptionV2Source;
    });
    const episodes = value.episodes.map((item, index) => {
      const episode = row(item, ["episodeId", "observations", "firstRecordedAt", "lastRecordedAt", "validUntil", "independentEvidence"]), source = sources[index];
      check(episode.episodeId === null && episode.independentEvidence === false && episode.firstRecordedAt === source.recordedAt
        && episode.lastRecordedAt === source.recordedAt && episode.validUntil === source.validUntil
        && Array.isArray(episode.observations) && episode.observations.length === 1);
      const observation = row(episode.observations[0], ["sourceIndex", "kind"]);
      check(observation.sourceIndex === index && observation.kind === (source.type === "DocumentViewVisited" ? "visit" : source.type === "BlockInspected" ? "inspector-open" : "viewer-open"));
      return episode as unknown as MemoryConsumptionV2["episodes"][number];
    });
    const coverage = row(value.coverage, ["eligibleSourceCount", "observationCount", "unavailableArtifactSourceCount", "completeHistory", "bounded", "truncated", ...((expectedVersion === MEMORY_CONSUMPTION_V5 || expectedVersion === MEMORY_CONSUMPTION_V6) ? ["unavailableBlockSourceCount"] : [])]);
    check(coverage.eligibleSourceCount === sources.length && coverage.observationCount === episodes.length && coverage.completeHistory === false
      && coverage.bounded === true && typeof coverage.truncated === "boolean" && Number.isSafeInteger(coverage.unavailableArtifactSourceCount)
      && Number(coverage.unavailableArtifactSourceCount) >= 0 && Number(coverage.unavailableArtifactSourceCount) <= 32);
    if((expectedVersion === MEMORY_CONSUMPTION_V5 || expectedVersion === MEMORY_CONSUMPTION_V6))check(Number.isSafeInteger(coverage.unavailableBlockSourceCount)
      && Number(coverage.unavailableBlockSourceCount)>=0 && Number(coverage.unavailableBlockSourceCount)<=32);
    check(new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65_536);
    return { ...value, sources, episodes } as MemoryConsumptionV2;
  } catch { return null; }
}

type ConsumptionParseInput = [original: unknown, lifetime: MemoryRecallLifetime, documentId: string, sourceWindow: { since: string; expiresAt: string }];
export function parseMemoryConsumptionV2(...input: ConsumptionParseInput): MemoryConsumptionV2 | null {
  return parseArtifactConsumption(...input, MEMORY_CONSUMPTION_V2);
}
export function parseMemoryConsumptionV3(...input: ConsumptionParseInput): MemoryConsumptionV2 | null {
  return parseArtifactConsumption(...input, MEMORY_CONSUMPTION_V3);
}

export function parseMemoryConsumptionV4(...input: ConsumptionParseInput): MemoryConsumptionV2 | null {
  return parseArtifactConsumption(...input, MEMORY_CONSUMPTION_V4);
}

export function parseMemoryConsumptionV5(...input: ConsumptionParseInput): MemoryConsumptionV2 | null {
  return parseArtifactConsumption(...input, MEMORY_CONSUMPTION_V5);
}

export function parseMemoryConsumptionV6(...input: ConsumptionParseInput): MemoryConsumptionV2 | null {
  return parseArtifactConsumption(...input, MEMORY_CONSUMPTION_V6);
}

export type MemoryConsumptionWindows = {
  basis: "selected-certified-observations"; completeHistory: false; validUntil: string;
  windows: { days: 7 | 30; since: string; sourceIndexes: number[]; documentVisits: number;
    artifactOpenings: number; blockOpenings: number; distinctArtifacts: number; distinctBlocks: number; pageVisits?:{view:DocumentView;count:number}[] }[];
};
/** Pure descriptive projection, never a new source, session, preference or access
 * grant. Counts use only the explicitly negotiated inspector source map. Repeated
 * openings remain observations; distinct resources coalesce revisions, not visits.
 * The two windows overlap and inherit the exact parent's display deadline. */
export function memoryConsumptionWindows(...input: ConsumptionParseInput): MemoryConsumptionWindows | null {
  try{input=snapshotMemoryConsumptionInput(input) as ConsumptionParseInput;}catch{return null;}
  const projection=parseMemoryConsumptionV5(...input)??parseMemoryConsumptionV6(...input);if(!projection)return null;
  const checked=memoryTimestamp(input[1].checkedAt),enrolled=memoryTimestamp(input[3].since);
  if(checked===null||enrolled===null)return null;
  return {basis:"selected-certified-observations",completeHistory:false,validUntil:projection.validUntil,
    windows:([7,30] as const).map(days=>{
      const since=Math.max(enrolled,checked-days*86400000),sourceIndexes=projection.sources.flatMap((source,index)=>Date.parse(source.recordedAt)>=since?[index]:[]);
      let documentVisits=0,artifactOpenings=0,blockOpenings=0;const artifacts=new Set<string>(),blocks=new Set<string>(),pages=new Map<DocumentView,number>();
      for(const index of sourceIndexes){const target=projection.sources[index]!.target;
        if(target.kind==='document'||target.kind==='page')documentVisits++;
        if(target.kind==='page')pages.set(target.view,(pages.get(target.view)??0)+1);
        if(target.kind==='artifact'){artifactOpenings++;artifacts.add(target.artifactId);}
        if(target.kind==='block'){blockOpenings++;blocks.add(target.blockId);}
      }
      return {days,since:new Date(since).toISOString(),sourceIndexes,documentVisits,artifactOpenings,blockOpenings,distinctArtifacts:artifacts.size,distinctBlocks:blocks.size,...(projection.version===MEMORY_CONSUMPTION_V6?{pageVisits:DOCUMENT_VIEWS.filter(view=>pages.has(view)).map(view=>({view,count:pages.get(view)!}))}:{})};
    })};
}
