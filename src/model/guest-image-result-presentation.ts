import { ownerMediaNamespace } from "./media-ownership.ts";

/** Historical presentation only. A parsed event is never evidence of current
 * custody, a private-read capability, or permission to use a provider. */
export type GuestImageResultClaimEventOrigin = Readonly<{
  version: 1;
  kind: "guest-image-result-event-origin-v1";
  custodyId: string;
  claimEventId: string;
  outputId: string;
  generationId: string;
  manifestDigest: string;
}>;

export type GuestImageResultClaimPayload = Readonly<{
  version: 1;
  project_id: string;
  document_id: string;
  custody_id: string;
  object_id: string;
  generation_id: string;
  manifest_digest: string;
  claimed_origin: GuestImageResultClaimEventOrigin;
  original_created_at: string;
  title: string;
  model_id: "gpt-image-2" | "gpt-image-2.5-sunburst";
  planner_model_id: "gpt-5.6-terra";
  provider: "openai";
  prompt_technique: "prose" | "bullets" | "json" | "xml";
  quality: "high";
  purpose: "final";
  source_surface: "outputs";
  output_ref: string;
  prompt_ref: string;
  content_expires_at: string;
  media_url: string;
  media_type: "image/png";
  source_content_hash: string;
  image_width: number;
  image_height: number;
  image_byte_length: number;
  latency_ms: number;
  /** Original block.sourceEvents.length counts, never stream sequence offsets. */
  source_block_versions: readonly Readonly<{ block_id: string; version: number }>[];
  source_rights_digest: string;
}>;

export type GuestImageResultClaimPresentation = Readonly<{
  eventId: string;
  streamId: string;
  sequence: number;
  occurredAt: string;
  recordedAt: string;
  actor: string;
  clientId: "server:guest-image-result-claim";
  correlationId: string;
  causationId: null;
  compensatesEventId: null;
  schemaVersion: 1;
  type: "GuestImageResultClaimed";
  payload: GuestImageResultClaimPayload;
}>;

const headerKeys = ["eventId", "streamId", "sequence", "occurredAt", "recordedAt", "actor", "clientId",
  "correlationId", "causationId", "compensatesEventId", "schemaVersion", "type", "payload"] as const;
const payloadKeys = ["version", "project_id", "document_id", "custody_id", "object_id", "generation_id", "manifest_digest",
  "claimed_origin", "original_created_at", "title", "model_id", "planner_model_id", "provider", "prompt_technique", "quality",
  "purpose", "source_surface", "output_ref", "prompt_ref", "content_expires_at", "media_url", "media_type", "source_content_hash",
  "image_width", "image_height", "image_byte_length", "latency_ms", "source_block_versions", "source_rights_digest"] as const;
const originKeys = ["version", "kind", "custodyId", "claimEventId", "outputId", "generationId", "manifestDigest"] as const;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object"
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => record(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const wellFormed = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);

/** Inspect descriptors before reading data, and return a detached frozen tree.
 * JSON.stringify is used only on that tree, never on the caller's object. */
function snapshot(value: unknown): unknown {
  const seen = new Set<object>(); let nodes = 0;
  const invalid = (): never => { throw new Error("invalid_claim_presentation"); };
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 256 || depth > 6) return invalid();
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") return bytes(item) <= 65_536 ? item : invalid();
    if (typeof item === "number") return Number.isFinite(item) && !Object.is(item, -0) ? item : invalid();
    if (typeof item !== "object" || seen.has(item)
      || (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype : !record(item))) return invalid();
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
    if (keys.length > 64 || keys.some(key => typeof key !== "string")) return invalid();
    const result: Record<string, unknown> | unknown[] = Array.isArray(item) ? [] : {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (Array.isArray(item) && key === "length") continue;
      if (["__proto__", "prototype", "constructor"].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")
        || Array.isArray(item) && !/^(0|[1-9]\d*)$/u.test(key)) return invalid();
      (result as Record<string, unknown>)[key] = visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(item) && (item.length > 19 || keys.length !== item.length + 1)) return invalid();
    return Object.freeze(result);
  };
  return visit(value, 0);
}

function origin(value: unknown): value is GuestImageResultClaimEventOrigin {
  return exact(value, originKeys) && value.version === 1 && value.kind === "guest-image-result-event-origin-v1"
    && uuid(value.custodyId) && uuid(value.claimEventId) && uuid(value.generationId)
    && value.outputId === `object-${value.generationId.slice(-8)}` && hash(value.manifestDigest);
}

export function parseGuestImageResultClaimEventOrigin(value: unknown): GuestImageResultClaimEventOrigin | null {
  try { const parsed = snapshot(value); return origin(parsed) ? parsed : null; } catch { return null; }
}

/** Exact v1 cohort and canonical tuple. Source equality, mapped Context/SAVE
 * provenance and whole-lineage proof belong to the producer/current reader. */
export function parseGuestImageResultClaimEvent(value: unknown): GuestImageResultClaimPresentation | null {
  try {
    const event = snapshot(value);
    if (!exact(event, headerKeys) || event.type !== "GuestImageResultClaimed" || !uuid(event.eventId)
      || !integer(event.sequence, 1) || !iso(event.occurredAt) || event.recordedAt !== event.occurredAt
      || event.clientId !== "server:guest-image-result-claim" || event.schemaVersion !== 1
      || event.causationId !== null || event.compensatesEventId !== null
      || typeof event.streamId !== "string" || !event.streamId.startsWith("creative:")) return null;
    const owner = event.streamId.slice("creative:".length);
    // eslint-disable-next-line no-control-regex -- Match the exact canonical owner contract.
    if (!owner || !wellFormed(owner) || bytes(owner) > 200 || /[\u0000-\u001f\u007f]/u.test(owner) || owner.startsWith("guest:")
      || /^forma-guest-(session|claim)-v1\./u.test(owner) || event.actor !== `user:${owner}`) return null;
    const p = event.payload;
    if (!exact(p, payloadKeys) || bytes(JSON.stringify(p)) > 65_536 || p.version !== 1
      || !uuid(p.project_id) || !uuid(p.document_id) || !uuid(p.custody_id) || !uuid(p.generation_id)
      || p.object_id !== `object-${p.generation_id.slice(-8)}` || !hash(p.manifest_digest) || !origin(p.claimed_origin)
      || p.claimed_origin.custodyId !== p.custody_id || p.claimed_origin.claimEventId !== event.eventId
      || p.claimed_origin.outputId !== p.object_id || p.claimed_origin.generationId !== p.generation_id
      || p.claimed_origin.manifestDigest !== p.manifest_digest
      || event.correlationId !== `guest-image-result-claim:v1:${p.custody_id}`
      || !iso(p.original_created_at) || p.original_created_at > event.occurredAt || !iso(p.content_expires_at)
      || p.content_expires_at <= event.occurredAt || typeof p.title !== "string" || p.title.length > 8192
      || (p.model_id !== "gpt-image-2" && p.model_id !== "gpt-image-2.5-sunburst") || p.planner_model_id !== "gpt-5.6-terra" || p.provider !== "openai"
      || typeof p.prompt_technique !== "string" || !["prose", "bullets", "json", "xml"].includes(p.prompt_technique) || p.quality !== "high"
      || p.purpose !== "final" || p.source_surface !== "outputs"
      || typeof p.output_ref !== "string" || !/^guest-image-result-history-[a-f0-9]{64}$/u.test(p.output_ref)
      || typeof p.prompt_ref !== "string" || !/^guest-image-result-history-[a-f0-9]{64}$/u.test(p.prompt_ref)
      || p.output_ref === p.prompt_ref || p.media_type !== "image/png"
      || typeof p.source_content_hash !== "string" || !/^[a-f0-9]{64}$/u.test(p.source_content_hash)
      || !integer(p.image_width, 1, 8192) || !integer(p.image_height, 1, 8192)
      || !integer(p.image_byte_length, 1, 24_000_000) || !integer(p.latency_ms)
      || !hash(p.source_rights_digest) || !Array.isArray(p.source_block_versions)
      || p.source_block_versions.length < 1 || p.source_block_versions.length > 19) return null;
    const blockIds = new Set<string>();
    for (const entry of p.source_block_versions) {
      if (!exact(entry, ["block_id", "version"]) || !uuid(entry.block_id) || !integer(entry.version, 1, 19)
        || blockIds.has(entry.block_id)) return null;
      blockIds.add(entry.block_id);
    }
    const key = `guest-image-result-media-v1/${ownerMediaNamespace(owner)}/${p.custody_id}/${p.object_id}.png`;
    if (p.media_url !== `/api/media/${encodeURIComponent(key)}`) return null;
    return event as unknown as GuestImageResultClaimPresentation;
  } catch { return null; }
}

// Read only own data scalars when an invalid claim must invalidate an earlier
// alias. This path never treats partial/redacted data as a valid presentation.
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

/** Match legacy String() identities for JSON scalars/arrays without invoking
 * hooks. The fold also records its actual resolved native identity before a
 * write, so opaque non-JSON legacy coercions cannot overwrite a claim. */
function nativeString(value: unknown): string | null {
  const seen = new Set<object>(); let nodes = 0;
  const visit = (item: unknown, depth: number): string | null => {
    if (++nodes > 4096 || depth > 32) return null;
    if (item === null || item === undefined || ["string", "number", "boolean"].includes(typeof item)) return String(item);
    if (!Array.isArray(item)) return record(item) ? "[object Object]" : null;
    if (seen.has(item) || Object.getPrototypeOf(item) !== Array.prototype || Object.hasOwn(item, "toString")
      || Object.hasOwn(item, "join") || Object.hasOwn(item, Symbol.toPrimitive) || item.length > 4096) return null;
    seen.add(item);
    const parts: string[] = [];
    for (let index = 0; index < item.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
      if (descriptor && !Object.hasOwn(descriptor, "value")) return null;
      const child = descriptor?.value;
      const part = child === null || child === undefined ? "" : visit(child, depth + 1);
      if (part === null) return null;
      parts.push(part);
    }
    seen.delete(item);
    return parts.join(",");
  };
  return visit(value, 0);
}

/** Both fold and naming must reject claim-involved creation collisions in
 * either order. Ordinary native/native replacement semantics stay unchanged.
 * All retained identity sets are included in the fold's existing accounting. */
export function createGuestImageResultOriginIndex() {
  const nativeOutputs = new Set<string>(), nativeGenerations = new Set<string>();
  const claimedOutputs = new Set<string>(), claimedGenerations = new Set<string>();
  const conflictedOutputs = new Set<string>(), conflictedGenerations = new Set<string>();
  const outputGenerations = new Map<string, Set<string>>(), generationOutputs = new Map<string, Set<string>>();
  const creationEvents = new Map<string, { claimed: boolean; outputs: Set<string>; generations: Set<string> }>();
  const invalidatedOutputs = new Set<string>();
  const register = (ids: Set<string>, generations: Set<string>, claimed: boolean, invalid: boolean) => {
    for (const id of ids) {
      const linked = outputGenerations.get(id) ?? new Set<string>();
      for (const generation of generations) {
        linked.add(generation);
        const outputs = generationOutputs.get(generation) ?? new Set<string>();
        outputs.add(id); generationOutputs.set(generation, outputs);
      }
      outputGenerations.set(id, linked);
    }
    const collision = [...ids].some(id => claimedOutputs.has(id) || claimed && nativeOutputs.has(id))
      || [...generations].some(id => claimedGenerations.has(id) || claimed && nativeGenerations.has(id));
    if (collision || invalid) {
      for (const id of ids) { conflictedOutputs.add(id); invalidatedOutputs.add(id); }
      for (const id of generations) {
        conflictedGenerations.add(id);
        for (const output of generationOutputs.get(id) ?? []) invalidatedOutputs.add(output);
      }
    }
    for (const id of ids) (claimed ? claimedOutputs : nativeOutputs).add(id);
    for (const id of generations) (claimed ? claimedGenerations : nativeGenerations).add(id);
  };
  const observe = (event: unknown): GuestImageResultClaimPresentation | null => {
    const type = own(event, "type"), claimed = type === "GuestImageResultClaimed";
    if (!claimed && type !== "GenerationCompleted" && type !== "IdeationPreviewCompleted") return null;
    const p = own(event, "payload"), o = claimed ? own(p, "claimed_origin") : null;
    const ids = new Set<string>(), generations = new Set<string>();
    const addOutput = (value: unknown) => {
      const id = claimed ? value : nativeString(value);
      if (typeof id === "string" && id) ids.add(id);
    };
    const addGeneration = (value: unknown) => {
      const id = claimed ? value : nativeString(value);
      if (uuid(id)) generations.add(id);
    };
    addOutput(own(p, "object_id"));
    addGeneration(own(p, "generation_id"));
    if (claimed) { addOutput(own(o, "outputId")); addGeneration(own(o, "generationId")); }
    const list = own(p, "object_ids");
    if (Array.isArray(list)) for (const key of Object.keys(list)) addOutput(own(list, key));
    const parsed = claimed ? parseGuestImageResultClaimEvent(event) : null;
    const eventId = own(event, "eventId"), previous = typeof eventId === "string" ? creationEvents.get(eventId) : undefined;
    const repeatedClaimEvent = Boolean(previous && (claimed || previous.claimed));
    if (previous) {
      for (const id of previous.outputs) ids.add(id);
      for (const id of previous.generations) generations.add(id);
    }
    register(ids, generations, claimed, claimed && !parsed || repeatedClaimEvent);
    if (typeof eventId === "string") creationEvents.set(eventId, { claimed: claimed || Boolean(previous?.claimed), outputs: ids, generations });
    return parsed;
  };
  return {
    observe,
    observeNativeOutput: (id: string, generationId: string) => register(new Set([id]), new Set([generationId]), false, false),
    takeInvalidatedOutputs: () => { const ids = [...invalidatedOutputs]; invalidatedOutputs.clear(); return ids; },
    isUnambiguous: (id: string, generationId = "") => !conflictedOutputs.has(id) && !conflictedGenerations.has(generationId)
      && ![...(outputGenerations.get(id) ?? [])].some(generation => conflictedGenerations.has(generation)),
    retainedState: [nativeOutputs, nativeGenerations, claimedOutputs, claimedGenerations, conflictedOutputs, conflictedGenerations, outputGenerations, generationOutputs, creationEvents, invalidatedOutputs],
  };
}
