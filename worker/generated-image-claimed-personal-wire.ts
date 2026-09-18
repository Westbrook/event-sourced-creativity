import { parseGuestImageResultCompletedCustodyReview, parseGuestImageResultMediaUrl,
  type GuestImageResultCompletedCustodyReview } from "../src/model/generated-image-edit.ts";

/** Fixed wire values only. A parsed selector, view, or response marker never
 * proves a principal, custody, revision, private body, or readable PNG. */
export const GUEST_IMAGE_PERSONAL_PATHS = Object.freeze({
  draft: "/api/experiences/image/claimed-result/",
  inputs: "/api/claimed-image-inputs/",
});
export const GUEST_IMAGE_PERSONAL_WIRE_LIMITS = Object.freeze({
  draftBytes: 65_536, inputBytes: 524_288, promptBytes: 65_536,
  nodes: 256, depth: 8, sourceVersions: 19, pngBytes: 24_000_000,
});

export type GuestImagePersonalPath = Readonly<
  { kind: "draft"; draftId: string | null } | { kind: "inputs"; outputId: string | null }
>;
export function guestImagePersonalPath(pathname: string): GuestImagePersonalPath | null {
  for (const kind of ["draft", "inputs"] as const) {
    const prefix = GUEST_IMAGE_PERSONAL_PATHS[kind];
    if (pathname !== prefix.slice(0, -1) && !pathname.startsWith(prefix)) continue;
    const raw = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
    const valid = kind === "draft" ? /^experience-draft-[a-f0-9]{64}$/u.test(raw) : /^object-[a-f0-9]{8}$/u.test(raw);
    // The two selectors contain only their literal ASCII grammar. Percent
    // aliases, additional segments and an empty reserved namespace refuse.
    return kind === "draft" ? Object.freeze({ kind, draftId: valid ? raw : null })
      : Object.freeze({ kind, outputId: valid ? raw : null });
  }
  return null;
}

export type GuestImagePersonalMedia = Readonly<{
  url: string; mediaType: "image/png"; sha256: string; byteLength: number; width: number; height: number;
}>;
export type GuestImageResultDraftView = Readonly<{
  version: 1; status: "claimed-result"; draftId: string; ownerId: string; projectId: string; documentId: string;
  outputId: string; generationId: string; sourceEventId: string; claim: GuestImageResultCompletedCustodyReview;
  title: string; revision: number; editEventId: string | null; media: GuestImagePersonalMedia; head: number; expiresAt: string;
}>;
export type GuestImageResultInputOutput = Readonly<{
  object_id: string; generation_id: string; document_id: string; quality: "high"; purpose: "final";
  prompt_technique: "prose" | "bullets" | "json" | "xml"; provider: "openai"; model: "gpt-image-2";
  planner_model: "gpt-5.6-terra"; source_surface: "outputs";
}>;
export type GuestImageResultInputView = Readonly<{
  schema_version: 2; origin: "guest-image-result-claim"; claim: GuestImageResultCompletedCustodyReview;
  output: GuestImageResultInputOutput; submitted_prompt: string | null; retained_input_status: "available" | "unavailable";
  source_block_versions: readonly Readonly<{ block_id: string; version: number }>[];
  compile_event_id: null; document_snapshot: null; context_hash: null;
  reference_inputs: readonly []; used_reference_pixels: false;
}>;

type Row = Record<string, unknown>;
const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).byteLength;
const row = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value: Row, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uint = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const invalid = (): never => { throw new Error("guest_image_personal_wire_invalid"); };

function capture(value: unknown, maximum: number, preserveDraftTitle = false): unknown {
  const seen = new Set<object>(); let nodes = 0, used = 0;
  const charge = (text: string, originalTitle = false) => { if ((!originalTitle && !text.isWellFormed()) || (used += bytes(text)) > maximum) invalid(); };
  const visit = (item: unknown, depth: number, originalTitle = false): unknown => {
    if (++nodes > GUEST_IMAGE_PERSONAL_WIRE_LIMITS.nodes || depth > GUEST_IMAGE_PERSONAL_WIRE_LIMITS.depth) return invalid();
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") {
      if (originalTitle && item.length > 8192) return invalid();
      charge(item, originalTitle); return item;
    }
    if (typeof item === "number") return Number.isFinite(item) && !Object.is(item, -0) ? item : invalid();
    if (typeof item !== "object" || seen.has(item) || (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype : !row(item))) return invalid();
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string")) return invalid();
    if (Array.isArray(item)) {
      const length = descriptors.length;
      if (!length || !Object.hasOwn(length, "value") || !uint(length.value, 0, GUEST_IMAGE_PERSONAL_WIRE_LIMITS.sourceVersions)
        || keys.length !== length.value + 1) return invalid();
      const result: unknown[] = [];
      for (let i = 0; i < length.value; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return invalid();
        result.push(visit(descriptor.value, depth + 1));
      }
      return Object.freeze(result);
    }
    const result: Row = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!; charge(key);
      if (["__proto__", "prototype", "constructor", "toJSON"].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return invalid();
      // Canonical titles preserve original UTF16, including escaped unpaired
      // surrogates. Only this top-level draft field receives that treatment;
      // keys, identities, media URLs and prompt text retain strict admission.
      result[key] = visit(descriptor.value, depth + 1, preserveDraftTitle && depth === 0 && key === "title");
    }
    return Object.freeze(result);
  };
  const captured = visit(value, 0);
  if (bytes(JSON.stringify(captured)) > maximum) return invalid();
  return captured;
}

function media(value: unknown, ownerId: string, outputId: string, custodyId: string, revision: number): GuestImagePersonalMedia | null {
  if (!row(value) || !exact(value, ["url", "mediaType", "sha256", "byteLength", "width", "height"])) return null;
  const parsed = parseGuestImageResultMediaUrl(value.url);
  if (!parsed || parsed.ownerId !== ownerId || parsed.custodyId !== custodyId || parsed.outputId !== outputId
    || (revision === 0 ? parsed.revisionId !== null : parsed.revisionId === null)
    || value.mediaType !== "image/png" || !sha(value.sha256) || !uint(value.byteLength, 1, GUEST_IMAGE_PERSONAL_WIRE_LIMITS.pngBytes)
    || !uint(value.width, 1, 16_384) || !uint(value.height, 1, 16_384)) return null;
  return Object.freeze({ url: String(value.url), mediaType: "image/png", sha256: value.sha256,
    byteLength: value.byteLength, width: value.width, height: value.height });
}

/** Detached value validation only. In particular, no clock or database read
 * turns a merely well-shaped expiresAt/review into current read authority. */
export function parseGuestImageResultDraftView(value: unknown): GuestImageResultDraftView | null {
  try {
    const v = capture(value, GUEST_IMAGE_PERSONAL_WIRE_LIMITS.draftBytes, true);
    if (!row(v) || !exact(v, ["version", "status", "draftId", "ownerId", "projectId", "documentId", "outputId", "generationId",
      "sourceEventId", "claim", "title", "revision", "editEventId", "media", "head", "expiresAt"])
      || v.version !== 1 || v.status !== "claimed-result" || typeof v.draftId !== "string" || !/^experience-draft-[a-f0-9]{64}$/u.test(v.draftId)
      || typeof v.ownerId !== "string" || !uuid(v.projectId) || !uuid(v.documentId) || !uuid(v.generationId)
      || v.outputId !== `object-${v.generationId.slice(-8)}` || !uuid(v.sourceEventId)
      || typeof v.title !== "string" || v.title.length > 8192 || !uint(v.revision, 0, 127)
      || (v.revision === 0 ? v.editEventId !== null : !uuid(v.editEventId)) || !uint(v.head, 1) || !iso(v.expiresAt)) return null;
    const claim = parseGuestImageResultCompletedCustodyReview(v.claim);
    if (!claim || claim.claimEventId !== v.sourceEventId) return null;
    const currentMedia = media(v.media, v.ownerId, String(v.outputId), claim.custodyId, v.revision);
    if (!currentMedia) return null;
    return Object.freeze({ version: 1, status: "claimed-result", draftId: v.draftId, ownerId: v.ownerId,
      projectId: v.projectId, documentId: v.documentId, outputId: String(v.outputId), generationId: v.generationId,
      sourceEventId: v.sourceEventId, claim, title: v.title, revision: v.revision,
      editEventId: v.editEventId as string | null, media: currentMedia, head: v.head, expiresAt: v.expiresAt });
  } catch { return null; }
}

export function parseGuestImageResultInputView(value: unknown): GuestImageResultInputView | null {
  try {
    const v = capture(value, GUEST_IMAGE_PERSONAL_WIRE_LIMITS.inputBytes);
    if (!row(v) || !exact(v, ["schema_version", "origin", "claim", "output", "submitted_prompt", "retained_input_status",
      "source_block_versions", "compile_event_id", "document_snapshot", "context_hash", "reference_inputs", "used_reference_pixels"])
      || v.schema_version !== 2 || v.origin !== "guest-image-result-claim" || v.compile_event_id !== null || v.document_snapshot !== null
      || v.context_hash !== null || !Array.isArray(v.reference_inputs) || v.reference_inputs.length !== 0 || v.used_reference_pixels !== false) return null;
    const claim = parseGuestImageResultCompletedCustodyReview(v.claim), p = v.output;
    if (!claim || !row(p) || !exact(p, ["object_id", "generation_id", "document_id", "quality", "purpose", "prompt_technique", "provider", "model", "planner_model", "source_surface"])
      || !uuid(p.generation_id) || p.object_id !== `object-${p.generation_id.slice(-8)}` || !uuid(p.document_id)
      || p.quality !== "high" || p.purpose !== "final" || typeof p.prompt_technique !== "string" || !["prose", "bullets", "json", "xml"].includes(p.prompt_technique)
      || p.provider !== "openai" || p.model !== "gpt-image-2" || p.planner_model !== "gpt-5.6-terra" || p.source_surface !== "outputs") return null;
    if (v.retained_input_status === "available") {
      if (typeof v.submitted_prompt !== "string" || bytes(v.submitted_prompt) < 1 || bytes(v.submitted_prompt) > GUEST_IMAGE_PERSONAL_WIRE_LIMITS.promptBytes) return null;
    } else if (v.retained_input_status !== "unavailable" || v.submitted_prompt !== null) return null;
    if (!Array.isArray(v.source_block_versions) || v.source_block_versions.length < 1) return null;
    const versions: { block_id: string; version: number }[] = [], ids = new Set<string>();
    for (const item of v.source_block_versions) {
      if (!row(item) || !exact(item, ["block_id", "version"]) || !uuid(item.block_id) || !uint(item.version, 1, 19) || ids.has(item.block_id)) return null;
      ids.add(item.block_id); versions.push(Object.freeze({ block_id: item.block_id, version: item.version }));
    }
    return Object.freeze({ schema_version: 2, origin: "guest-image-result-claim", claim,
      output: Object.freeze({ object_id: String(p.object_id), generation_id: p.generation_id, document_id: p.document_id,
        quality: "high", purpose: "final", prompt_technique: p.prompt_technique as GuestImageResultInputOutput["prompt_technique"],
        provider: "openai", model: "gpt-image-2", planner_model: "gpt-5.6-terra", source_surface: "outputs" }),
      submitted_prompt: v.submitted_prompt as string | null, retained_input_status: v.retained_input_status,
      source_block_versions: Object.freeze(versions), compile_event_id: null, document_snapshot: null, context_hash: null,
      reference_inputs: Object.freeze([]) as readonly [], used_reference_pixels: false });
  } catch { return null; }
}

// Negative response bookkeeping only: the outer fetch wrapper must not attach
// unrelated retention work to a completed bounded claimed read/refusal. This
// marker cannot authorize any request or turn an unproved value into a read.
const handled = new WeakSet<Response>();
export function markGuestImagePersonalResponse(response: Response): Response { handled.add(response); return response; }
export function isGuestImagePersonalResponse(response: Response): boolean { return handled.has(response); }

export function guestImagePersonalJson(value: GuestImageResultDraftView | GuestImageResultInputView | Readonly<{ status: "absent" }>): Response {
  const captured = capture(value, GUEST_IMAGE_PERSONAL_WIRE_LIMITS.inputBytes, true);
  const absent = row(captured) && exact(captured, ["status"]) && captured.status === "absent";
  const parsed = absent ? Object.freeze({ status: "absent" as const }) : parseGuestImageResultDraftView(captured) ?? parseGuestImageResultInputView(captured);
  if (!parsed) return invalid();
  return markGuestImagePersonalResponse(new Response(JSON.stringify(parsed), { headers: {
    "content-type": "application/json", "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    vary: "Cookie, oai-authenticated-user-id, oai-authenticated-user-email",
  } }));
}
export function guestImagePersonalRefusal(status = 404): Response {
  if (![400, 401, 403, 404, 405, 408, 409, 413, 429].includes(status)) return invalid();
  return markGuestImagePersonalResponse(Response.json({ status: "refused", code: "unavailable" }, { status, headers: {
    "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    vary: "Cookie, oai-authenticated-user-id, oai-authenticated-user-email",
  } }));
}
