import { parseMemoryAssistedOutcomes } from "../src/model/memory-assisted-outcomes.ts";
import { parseMemorySavedOutputs } from "../src/model/memory-saved-outputs.ts";
import { memoryTimestamp } from "../src/model/memory-lifetime.ts";
import type {
  ConsumptionAuthority, ConsumptionEpisode, ConsumptionInput, ConsumptionObservation,
  ConsumptionOrigin, ConsumptionProjection, ConsumptionSource, ConsumptionSourceRef,
} from "./memory-consumption-types.ts";

const AUTHORITY_KEYS = ["enrollment_id", "actor_user_id", "owner_user_id", "organization_id", "project_access_id",
  "project_id", "document_id", "permission_epoch", "revision", "cursor_sequence"] as const;
const SOURCE_KEYS = ["eventId", "sequence", "type", "blockId", "recordedAt", "validUntil"] as const;
const KINDS = ["visit", "inspection", "reuse"] as const;
const ORIGINS: ConsumptionOrigin[] = ["assistant-assisted", "native-generated-output", "copy", "unknown"];
function check(ok: unknown): asserts ok { if (!ok) throw new TypeError("Invalid consumption projection input."); }
function object(value: unknown, keys: readonly string[]): void {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  const actual = Reflect.ownKeys(value);
  check(actual.length === keys.length && actual.every((key) => typeof key === "string" && keys.includes(key)));
}
function array(value: unknown, maximum: number): void { check(Array.isArray(value) && value.length <= maximum); }
function id(value: unknown): void {
  check(typeof value === "string" && value.length > 0 && value.length <= 240 && value.trim() === value && value.isWellFormed());
}
function integer(value: unknown, minimum: number): void { check(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum); }
function time(value: unknown): number { const parsed = memoryTimestamp(value); check(parsed !== null); return parsed; }
function key(ref: ConsumptionSourceRef): string { return JSON.stringify([ref.eventId, ref.sequence]); }
function authorityKey(value: ConsumptionAuthority): string { return JSON.stringify(AUTHORITY_KEYS.map((name) => value[name])); }

/** Bounded data capture; neither validation nor calculation reads caller objects again. */
function capture(input: unknown): unknown {
  let nodes = 0; let bytes = 0;
  const path = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    check(++nodes <= 16_384 && depth <= 12);
    bytes += 8; check(bytes <= 1_048_576);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") { check(Number.isFinite(value)); return value; }
    if (typeof value === "string") {
      check(value.length <= 16_384 && value.isWellFormed());
      bytes += new TextEncoder().encode(value).byteLength; check(bytes <= 1_048_576); return value;
    }
    check(typeof value === "object" && value !== null && !path.has(value));
    path.add(value);
    try {
      if (Array.isArray(value)) {
        check(Object.getPrototypeOf(value) === Array.prototype);
        const descriptor = Object.getOwnPropertyDescriptor(value, "length");
        check(descriptor && Object.hasOwn(descriptor, "value"));
        const length: unknown = descriptor.value;
        check(typeof length === "number" && Number.isSafeInteger(length) && length >= 0 && length <= 256);
        const keys = Reflect.ownKeys(value);
        check(keys.length === length + 1 && keys.every((name) => name === "length"
          || typeof name === "string" && /^(0|[1-9][0-9]*)$/.test(name) && Number(name) < length));
        const result: unknown[] = new Array(length);
        for (let index = 0; index < length; index++) {
          const item = Object.getOwnPropertyDescriptor(value, String(index));
          check(item && Object.hasOwn(item, "value") && item.enumerable);
          Object.defineProperty(result, index, { value: copy(item.value, depth + 1), enumerable: true });
        }
        return Object.freeze(result);
      }
      check(Object.getPrototypeOf(value) === Object.prototype);
      const keys = Reflect.ownKeys(value); check(keys.length <= 32);
      const result: Record<string, unknown> = {};
      for (const name of keys) {
        check(typeof name === "string" && name.length <= 240);
        const item = Object.getOwnPropertyDescriptor(value, name);
        check(item && Object.hasOwn(item, "value") && item.enumerable);
        bytes += name.length * 3; check(bytes <= 1_048_576);
        Object.defineProperty(result, name, { value: copy(item.value, depth + 1), enumerable: true });
      }
      return Object.freeze(result);
    } finally { path.delete(value); }
  };
  return copy(input, 0);
}

function validateAuthority(value: ConsumptionAuthority): void {
  object(value, AUTHORITY_KEYS);
  for (const name of ["enrollment_id", "actor_user_id", "owner_user_id", "project_id", "document_id", "permission_epoch"] as const) id(value[name]);
  integer(value.revision, 1); integer(value.cursor_sequence, 0);
  if (value.organization_id === null) check(value.project_access_id === null && value.actor_user_id === value.owner_user_id);
  else { id(value.organization_id); id(value.project_access_id); }
}

/**
 * Reduces caller-certified, explicitly witnessed consumption in one selected
 * window. This neither queries native records nor authenticates the caller.
 * Invalid input/expired parent returns null, never a certified zero-history result.
 */
export function reduceConsumptionEpisodes(original: ConsumptionInput): ConsumptionProjection | null {
  try { return reduce(capture(original) as ConsumptionInput); } catch { return null; }
}

function reduce(input: ConsumptionInput): ConsumptionProjection {
  object(input, ["authority", "checkedAt", "validUntil", "sources", "observations", "compensations", "withdrawnSources", "provenance"]);
  validateAuthority(input.authority);
  const scope = authorityKey(input.authority), now = time(input.checkedAt), parentUntil = time(input.validUntil);
  check(parentUntil > now);
  array(input.sources, 64); array(input.observations, 256); array(input.compensations, 128); array(input.withdrawnSources, 64);
  const sources = new Map<string, { source: ConsumptionSource; index: number }>();
  const ids = new Set<string>(), sequences = new Set<number>();
  input.sources.forEach((source, index) => {
    object(source, SOURCE_KEYS); id(source.eventId); id(source.type); integer(source.sequence, 1);
    if (source.blockId !== null) id(source.blockId);
    check(source.sequence <= input.authority.cursor_sequence && !ids.has(source.eventId) && !sequences.has(source.sequence));
    check(time(source.recordedAt) < time(source.validUntil));
    ids.add(source.eventId); sequences.add(source.sequence); sources.set(key(source), { source, index });
  });
  // A reusable projection must refresh when a known future observation/undo activates.
  const nextActivation = Math.min(parentUntil, ...input.sources.map((source) => time(source.recordedAt)).filter((recorded) => recorded > now));
  const reference = (ref: ConsumptionSourceRef) => {
    object(ref, ["eventId", "sequence"]); id(ref.eventId); integer(ref.sequence, 1);
    const found = sources.get(key(ref)); check(found); return found;
  };
  const withdrawn = new Set(input.withdrawnSources.map((ref) => { reference(ref); return key(ref); }));
  const eligible = (ref: ConsumptionSourceRef) => {
    const entry = sources.get(key(ref)); check(entry);
    const source = entry.source;
    return !withdrawn.has(key(ref)) && time(source.recordedAt) <= now && time(source.validUntil) > now;
  };
  const sameAuthority = (authority: ConsumptionAuthority) => { validateAuthority(authority); check(authorityKey(authority) === scope); };
  const observations = new Map<string, ConsumptionObservation>();
  for (const observation of input.observations) {
    object(observation, ["source", "authority", "kind", "episodeId", "resourceRevision", "copiedFrom"]);
    sameAuthority(observation.authority); const source = reference(observation.source).source;
    check(KINDS.includes(observation.kind));
    if (observation.episodeId !== null) id(observation.episodeId);
    if (observation.resourceRevision !== null) id(observation.resourceRevision);
    if (observation.copiedFrom !== null) {
      object(observation.copiedFrom, ["source", "revision"]);
      const copied = reference(observation.copiedFrom.source).source;
      check(copied.sequence < source.sequence && time(copied.recordedAt) <= time(source.recordedAt));
      if (observation.copiedFrom.revision !== null) id(observation.copiedFrom.revision);
    }
    const previous = observations.get(key(source));
    // Descriptor-key order is not part of observation identity.
    const identity = (item: ConsumptionObservation) => JSON.stringify([item.kind, item.episodeId, item.resourceRevision,
      item.copiedFrom === null ? null : [key(item.copiedFrom.source), item.copiedFrom.revision]]);
    check(!previous || identity(previous) === identity(observation));
    observations.set(key(source), observation);
  }
  for (const observation of observations.values()) {
    const copy = observation.copiedFrom;
    if (copy === null) continue;
    const parent = observations.get(key(copy.source));
    check(!parent || parent.resourceRevision === null || copy.revision === null || parent.resourceRevision === copy.revision);
  }
  const compensations = new Map<string, ConsumptionInput["compensations"][number]>();
  for (const compensation of input.compensations) {
    object(compensation, ["source", "authority", "target"]); sameAuthority(compensation.authority);
    const source = reference(compensation.source).source;
    check(!observations.has(key(source)));
    if (compensation.target !== null) {
      const target = reference(compensation.target).source;
      check(target.sequence < source.sequence && time(target.recordedAt) <= time(source.recordedAt));
    }
    const previous = compensations.get(key(source));
    check(!previous || (previous.target === null ? null : key(previous.target)) === (compensation.target === null ? null : key(compensation.target)));
    compensations.set(key(source), compensation);
  }
  const suppressed = new Set<string>(), compensated = new Set<string>();
  let unresolvedCompensationCount = 0;
  for (const compensation of compensations.values()) {
    const source = reference(compensation.source).source;
    if (time(source.recordedAt) > now) continue;
    if (compensation.target !== null) suppressed.add(key(compensation.target));
    if (!eligible(compensation.source)) continue;
    if (compensation.target === null || !observations.has(key(compensation.target))) unresolvedCompensationCount++;
    else if (eligible(compensation.target)) compensated.add(key(compensation.target));
  }
  // A past negative witness remains suppressive if its own lease later expires.
  // Callers must retain this target footprint for the positive source's lifetime.
  // Compensation-of-compensation never silently becomes redo/restoration.
  const ordered = [...observations.values()].sort((a, b) => a.source.sequence - b.source.sequence);
  const omitted = new Set(suppressed);
  for (const observation of ordered) if (!eligible(observation.source)
    || observation.copiedFrom !== null && (!eligible(observation.copiedFrom.source) || omitted.has(key(observation.copiedFrom.source)))) {
    omitted.add(key(observation.source));
  }

  type Lineage = { origin: "assistant-assisted" | "native-generated-output"; sourceIndexes: number[]; until: number };
  const lineage = new Map<string, Lineage[]>();
  if (input.provenance !== null) {
    object(input.provenance, ["selection", "outcomes", "savedOutputs"]); array(input.provenance.selection, 64);
    const seen = new Set<string>();
    for (const source of input.provenance.selection) {
      object(source, SOURCE_KEYS);
      const current = sources.get(key(source));
      check(current && !seen.has(key(source)) && SOURCE_KEYS.every((field) => source[field] === current.source[field]));
      seen.add(key(source));
    }
    const selection = input.provenance.selection;
    const allEligible = selection.every(eligible);
    const append = (indices: number[], origin: Lineage["origin"], until: number) => {
      const group: Lineage = { origin, sourceIndexes: indices.map((index) => sources.get(key(selection[index]))!.index), until };
      for (const index of indices) {
        const k = key(selection[index]); lineage.set(k, [...(lineage.get(k) ?? []), group]);
      }
    };
    for (const kind of ["outcomes", "savedOutputs"] as const) {
      const wrapper = input.provenance[kind];
      if (wrapper === null) continue;
      object(wrapper, ["value", "validUntil"]);
      const until = Math.min(parentUntil, time(wrapper.validUntil), ...selection.map((source) => time(source.validUntil)));
      if (!allEligible || until <= now) continue;
      const lifetime = { checkedAt: input.checkedAt, validUntil: new Date(until).toISOString() };
      if (kind === "outcomes") {
        const parsed = parseMemoryAssistedOutcomes(wrapper.value, selection, lifetime); check(parsed);
        // The accepted helper marks both accepted and rejected decisions as assisted.
        // This preserves origin only; it does not invent acceptance or consumption.
        for (const outcome of parsed.outcomes) append(outcome.mutation === null ? [outcome.decision.sourceIndex]
          : [outcome.decision.sourceIndex, outcome.mutation.sourceIndex], "assistant-assisted", until);
      } else {
        const parsed = parseMemorySavedOutputs(wrapper.value, selection, lifetime); check(parsed);
        for (const output of parsed.outputs) append(output.sourceIndexes, "native-generated-output", until);
      }
    }
  }
  const episodes = new Map<string, ConsumptionEpisode>();
  const derived = new Map<string, { origins: ConsumptionOrigin[]; sourceIndexes: number[]; until: number }>();
  let observationCount = 0, incompleteLineageCount = 0;
  for (const observation of ordered) {
    if (omitted.has(key(observation.source))) continue;
    const current = reference(observation.source), source = current.source;
    const copy = observation.copiedFrom;
    const dependencies = [current, ...(copy === null ? [] : [reference(copy.source)])];
    const proof = dependencies.flatMap(({ source }) => lineage.get(key(source)) ?? [])
      .filter((item) => item.sourceIndexes.every((index) => !omitted.has(key(input.sources[index]))));
    const upstream = copy === null ? undefined : derived.get(key(copy.source));
    const origins = new Set<ConsumptionOrigin>([...proof.map((item) => item.origin), ...(upstream?.origins ?? [])]);
    if (copy !== null) origins.add("copy");
    if (proof.length === 0 && !upstream) origins.add("unknown");
    const proofIndexes = [...new Set([...proof.flatMap((item) => item.sourceIndexes), ...(upstream?.sourceIndexes ?? []),
      ...(copy === null ? [] : [reference(copy.source).index])])].sort((a, b) => a - b);
    const until = Math.min(nextActivation, upstream?.until ?? parentUntil,
      ...dependencies.map(({ source }) => time(source.validUntil)), ...proof.map((item) => item.until));
    derived.set(key(source), { origins: [...origins], sourceIndexes: proofIndexes, until });
    const known = observation.episodeId !== null && observation.resourceRevision !== null;
    // Unknown boundaries/revisions never merge via time, proximity or defaults.
    const groupKey = known ? JSON.stringify([observation.episodeId, source.blockId, observation.resourceRevision]) : key(source);
    const episode: ConsumptionEpisode = episodes.get(groupKey) ?? {
      episodeId: observation.episodeId, documentId: input.authority.document_id, blockId: source.blockId,
      resourceRevision: observation.resourceRevision, observations: [], origins: [], provenanceSourceIndexes: [],
      firstRecordedAt: source.recordedAt, lastRecordedAt: source.recordedAt, validUntil: new Date(until).toISOString(), independentEvidence: false as const,
    };
    episode.observations.push({ sourceIndex: current.index, kind: observation.kind,
      copiedFrom: copy === null ? null : { sourceIndex: reference(copy.source).index, revision: copy.revision } });
    episode.origins = ORIGINS.filter((origin) => origins.has(origin) || episode.origins.includes(origin));
    episode.provenanceSourceIndexes = [...new Set([...episode.provenanceSourceIndexes, ...proofIndexes])].sort((a, b) => a - b);
    episode.firstRecordedAt = new Date(Math.min(time(episode.firstRecordedAt), time(source.recordedAt))).toISOString();
    episode.lastRecordedAt = new Date(Math.max(time(episode.lastRecordedAt), time(source.recordedAt))).toISOString();
    episode.validUntil = new Date(Math.min(time(episode.validUntil), until)).toISOString();
    episodes.set(groupKey, episode); observationCount++;
    if (!known || copy !== null && copy.revision === null) incompleteLineageCount++;
  }
  const eligibleSources = input.sources.filter(eligible);
  const values = [...episodes.values()];
  const until = Math.min(nextActivation, ...eligibleSources.map((source) => time(source.validUntil)), ...values.map((episode) => time(episode.validUntil)));
  return {
    version: "memory-consumption-episodes-v1", treatment: "descriptive-consumption", validUntil: new Date(until).toISOString(), episodes: values,
    coverage: { eligibleSourceCount: eligibleSources.length, observationCount, compensatedObservationCount: compensated.size,
      unresolvedCompensationCount, incompleteLineageCount, completeHistory: false, bounded: true },
    attention: "not-measured", comprehension: "not-measured", inferredPreferences: false,
  };
}
