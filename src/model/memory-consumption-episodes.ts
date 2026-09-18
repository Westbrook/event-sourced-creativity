import { memoryTimestamp, parseMemoryLifetime, type MemoryRecallLifetime } from "./memory-lifetime.ts";

export const MEMORY_CONSUMPTION_EPISODES_VERSION = "memory-consumption-episodes-v1" as const;

export type MemoryConsumptionSource = {
  eventId: string; type: string; blockId: string | null; recordedAt: string; validUntil: string;
};
/** Only the native recorded-navigation subset is supported by this client. */
export type MemoryConsumptionEpisode = {
  episodeId: null; documentId: string; blockId: null; resourceRevision: null;
  observations: [{ sourceIndex: number; kind: "visit"; copiedFrom: null }];
  origins: ["unknown"]; provenanceSourceIndexes: [];
  firstRecordedAt: string; lastRecordedAt: string; validUntil: string; independentEvidence: false;
};
export type MemoryConsumptionEpisodes = {
  version: typeof MEMORY_CONSUMPTION_EPISODES_VERSION; treatment: "descriptive-consumption"; validUntil: string;
  episodes: MemoryConsumptionEpisode[];
  coverage: { eligibleSourceCount: number; observationCount: number; compensatedObservationCount: 0;
    unresolvedCompensationCount: 0; incompleteLineageCount: number; completeHistory: false; bounded: true };
  attention: "not-measured"; comprehension: "not-measured"; inferredPreferences: false;
};

type Row = Record<string, unknown>;
function check(value: unknown): asserts value { if (!value) throw new Error("invalid-consumption-episodes"); }
function row(value: unknown, names: readonly string[]): Row {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  const keys = Reflect.ownKeys(value);
  check(keys.length === names.length && keys.every(key => typeof key === "string" && names.includes(key)));
  return value as Row;
}
function list(value: unknown): unknown[] { check(Array.isArray(value) && value.length <= 64); return value; }
function id(value: unknown): string {
  check(typeof value === "string" && value.length > 0 && value.length <= 240 && value.trim() === value && value.isWellFormed());
  return value;
}
function timestamp(value: unknown): number { const result = memoryTimestamp(value); check(result !== null); return result; }

/** Capture data descriptors only. Validation never revisits mutable caller input. */
export function snapshotMemoryConsumptionInput(original: unknown): unknown {
  let nodes = 0, bytes = 0;
  const ancestors = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    check(++nodes <= 8192 && depth <= 12); bytes += 8; check(bytes <= 262_144);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") { check(Number.isFinite(value)); return value; }
    if (typeof value === "string") {
      check(value.length <= 16_384 && value.isWellFormed());
      bytes += new TextEncoder().encode(value).byteLength; check(bytes <= 262_144); return value;
    }
    check(value !== null && typeof value === "object" && !ancestors.has(value));
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        check(Object.getPrototypeOf(value) === Array.prototype);
        const size = Object.getOwnPropertyDescriptor(value, "length");
        check(size && Object.hasOwn(size, "value") && Number.isSafeInteger(size.value) && size.value >= 0 && size.value <= 64);
        const length: number = size.value;
        const keys = Reflect.ownKeys(value);
        check(keys.length === length + 1 && keys.every(key => key === "length"
          || typeof key === "string" && /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < length));
        const result: unknown[] = [];
        for (let index = 0; index < length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          check(descriptor?.enumerable && Object.hasOwn(descriptor, "value"));
          result.push(copy(descriptor.value, depth + 1));
        }
        return result;
      }
      check(Object.getPrototypeOf(value) === Object.prototype);
      const keys = Reflect.ownKeys(value); check(keys.length <= 16);
      const result: Row = {};
      for (const key of keys) {
        check(typeof key === "string" && key.length <= 240);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        check(descriptor?.enumerable && Object.hasOwn(descriptor, "value"));
        bytes += key.length * 3; check(bytes <= 262_144);
        Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true });
      }
      return result;
    } finally { ancestors.delete(value); }
  };
  return copy(original, 0);
}

/** Validate references inside the enclosing certified window, not native authority.
 * A visit-typed source alone is not evidence: a valid returned subset may be empty.
 * No Worker imports, inferred sessions, new origin evidence or child display lease.
 */
export function parseMemoryConsumptionEpisodes(original: unknown, originalSources: readonly MemoryConsumptionSource[],
  originalLifetime: MemoryRecallLifetime, originalDocumentId: string): MemoryConsumptionEpisodes | null {
  try {
    const input = snapshotMemoryConsumptionInput({ projection: original, sources: originalSources, lifetime: originalLifetime, documentId: originalDocumentId }) as Row;
    const value = row(input.projection, ["version", "treatment", "validUntil", "episodes", "coverage", "attention", "comprehension", "inferredPreferences"]);
    const lifetime = parseMemoryLifetime(input.lifetime); check(lifetime);
    const documentId = id(input.documentId), checked = timestamp(lifetime.checkedAt), until = timestamp(lifetime.validUntil);
    check(value.version === MEMORY_CONSUMPTION_EPISODES_VERSION && value.treatment === "descriptive-consumption"
      && value.validUntil === lifetime.validUntil && value.attention === "not-measured"
      && value.comprehension === "not-measured" && value.inferredPreferences === false);
    check(new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65_536);
    const sources = list(input.sources).map(item => {
      const source = row(item, ["eventId", "type", "blockId", "recordedAt", "validUntil"]);
      id(source.eventId); id(source.type); if (source.blockId !== null) id(source.blockId);
      check(timestamp(source.recordedAt) <= checked && timestamp(source.validUntil) >= until);
      return source;
    });
    check(new Set(sources.map(source => source.eventId)).size === sources.length);
    const coverage = row(value.coverage, ["eligibleSourceCount", "observationCount", "compensatedObservationCount",
      "unresolvedCompensationCount", "incompleteLineageCount", "completeHistory", "bounded"]);
    const rawEpisodes = list(value.episodes);
    check(coverage.eligibleSourceCount === sources.length && coverage.observationCount === rawEpisodes.length
      && coverage.incompleteLineageCount === rawEpisodes.length && coverage.compensatedObservationCount === 0
      && coverage.unresolvedCompensationCount === 0 && coverage.completeHistory === false && coverage.bounded === true);
    let previous = -1;
    const episodes: MemoryConsumptionEpisode[] = rawEpisodes.map(item => {
      const episode = row(item, ["episodeId", "documentId", "blockId", "resourceRevision", "observations", "origins",
        "provenanceSourceIndexes", "firstRecordedAt", "lastRecordedAt", "validUntil", "independentEvidence"]);
      const observations = list(episode.observations), origins = list(episode.origins), provenance = list(episode.provenanceSourceIndexes);
      check(episode.episodeId === null && episode.documentId === documentId && episode.blockId === null && episode.resourceRevision === null
        && episode.independentEvidence === false && observations.length === 1 && origins.length === 1 && origins[0] === "unknown" && provenance.length === 0);
      const observation = row(observations[0], ["sourceIndex", "kind", "copiedFrom"]), index = observation.sourceIndex;
      check(typeof index === "number" && Number.isSafeInteger(index) && index > previous && index >= 0 && index < sources.length
        && observation.kind === "visit" && observation.copiedFrom === null);
      const source = sources[index], episodeUntil = timestamp(episode.validUntil);
      check(source.type === "DocumentViewVisited" && source.blockId === null && episode.firstRecordedAt === source.recordedAt
        && episode.lastRecordedAt === source.recordedAt && episodeUntil >= until && episodeUntil <= timestamp(source.validUntil));
      previous = index;
      return { episodeId: null, documentId, blockId: null, resourceRevision: null,
        observations: [{ sourceIndex: index, kind: "visit", copiedFrom: null }], origins: ["unknown"], provenanceSourceIndexes: [],
        firstRecordedAt: source.recordedAt as string, lastRecordedAt: source.recordedAt as string,
        validUntil: episode.validUntil as string, independentEvidence: false };
    });
    return { version: MEMORY_CONSUMPTION_EPISODES_VERSION, treatment: "descriptive-consumption", validUntil: lifetime.validUntil, episodes,
      coverage: { eligibleSourceCount: sources.length, observationCount: episodes.length, compensatedObservationCount: 0,
        unresolvedCompensationCount: 0, incompleteLineageCount: episodes.length, completeHistory: false, bounded: true },
      attention: "not-measured", comprehension: "not-measured", inferredPreferences: false };
  } catch { return null; }
}
