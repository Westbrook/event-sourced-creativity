import type { OutputKind } from "../contracts.ts";
import { normalizeModel3dView, type Model3dView } from "../../model/model3d-view.ts";
import {
  isResultMediaMime, isResultMediaNamespace, isResultMediaPathForNamespace,
  RESULT_ASSET_MAX_BYTES, RESULT_MODEL3D_MAX_BYTES, RESULT_MAX_DIMENSION, RESULT_MAX_DURATION_SECONDS,
  RESULT_IMAGE_MIMES, RESULT_AUDIO_MIMES, RESULT_VIDEO_MIMES, RESULT_MODEL3D_MIMES,
  type ResultMediaAsset, type ResultImageMime, type ResultAudioMime, type ResultVideoMime, type ResultModel3dMime,
} from "./media.ts";
import { experienceResultViewers, type ResultViewerRef } from "./registry.ts";

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
type IdentityBase = {
  documentId: string; outputId: string; sourceRevision: string; sourceDigest: string;
  contentHash: string | null; releaseHash: string;
};
/** Immutable image generations have no editable artifact revision. */
export type ResultIdentity = IdentityBase & (
  | { outputObjectKind: "generation"; outputRevision: null }
  | { outputObjectKind: "artifact"; outputRevision: number }
);
export type ResultDuration =
  | { basis: "unknown"; seconds: null }
  | { basis: "measured" | "recorded" | "estimate"; seconds: number };
export type ResultImageAsset = ResultMediaAsset<ResultImageMime> & { width: number; height: number };
export type ResultTimedAsset<M extends ResultAudioMime | ResultVideoMime> = ResultMediaAsset<M> & { duration: ResultDuration };
export type ResultExpectedAsset = ResultImageAsset | ResultTimedAsset<ResultAudioMime | ResultVideoMime> | ResultMediaAsset<ResultModel3dMime>;
export type ResultSlideCitation = { label: string; anchor: string };
export type ResultSlideDatum = { label: string; value: string; weight: number; exactValue: string | null; displayValue: string | null };
const slideLayouts = ["cover", "statement", "split", "columns", "metric", "timeline", "closing", "quote", "scorecard", "comparison", "matrix", "architecture", "personas", "roadmap"] as const;
const slideVisualKinds = ["hero-type", "metric", "bars", "timeline", "diagram", "color-field", "quote", "scorecard", "comparison", "matrix", "architecture", "personas", "roadmap"] as const;
export type ResultSlideVisual = {
  layout: typeof slideLayouts[number]; kicker: string; section: string | null; bullets: string[];
  quote: { text: string; speaker: string; role: string; citation: string | null } | null;
  citations: ResultSlideCitation[];
  visual: {
    kind: typeof slideVisualKinds[number]; label: string; value: string;
    exactValue: string | null; displayValue: string | null; unit: string | null; data: ResultSlideDatum[];
  };
};
/**
 * Already-projected audience content, not DocumentArtifact/SlideVisualData.
 * Projection and citation visibility decisions belong to a trusted recipient
 * owner. This validator cannot decide whether the supplied copy is public.
 */
export type ResultAudienceSlide = { id: string; title: string; body: string; slide: ResultSlideVisual | null };
// This first contract has no arbitrary-font or new-style fallback. The future
// trusted projection must explicitly provide this narrow style or null; a
// native record cannot be passed through and silently adapted by validation.
export type ResultSlidePresentation = {
  aspectRatio: "16:9"; stylePreset: "gallery" | "editorial" | "nocturne" | "field-notes";
  mode: "light" | "dark"; footerLabel: string;
  palette: { background: string; foreground: string; accent: string; muted: string; surface: string };
};
export type ResultContentMap = {
  image: { image: ResultImageAsset; alt: string; caption: string };
  short_story: { content_markdown: string };
  // An audio-medium Scene is written output, never permission for an audio asset.
  scene: { medium: "visual" | "audio" | null; content_markdown: string };
  slides: { slides: ResultAudienceSlide[]; presentation: ResultSlidePresentation | null };
  storyboard: { frames: { id: string; title: string; body: string; image: ResultImageAsset | null; alt: string; caption: string; duration: ResultDuration }[] };
  video: { clips: { id: string; title: string; asset: ResultTimedAsset<ResultVideoMime>; transcript: string | null; description: string }[] };
  audio: { asset: ResultTimedAsset<ResultAudioMime>; transcript: string | null; description: string };
  model3d: { glb: ResultMediaAsset<ResultModel3dMime>; view: Model3dView | null; poster: { image: ResultImageAsset; alt: string } | null; description: string };
};
type ResultEnvelope<K extends OutputKind> = {
  schemaVersion: 1; output: K; viewerRef: ResultViewerRef<K>; viewerContractRevision: 1;
  identity: K extends "image" ? Extract<ResultIdentity, { outputObjectKind: "generation" }> : Extract<ResultIdentity, { outputObjectKind: "artifact" }>;
  title: string; content: ResultContentMap[K];
};
export type ExperienceResultDto = DeepReadonly<{ [K in OutputKind]: ResultEnvelope<K> }[OutputKind]>;

/**
 * Supplied separately by a future trusted result transport, not copied from the
 * candidate DTO or an intake manifest. Retained release identity is compared
 * exactly; there is no current-catalog lookup or intake recompilation.
 *
 * The future host must independently establish personal-only delivery scope and
 * current recipient authority before supplying this exact output/asset manifest.
 * /api/media also serves project assets. Namespace equality is not personal
 * scope or ownership, and legacy namespaces can collide. Neither this type nor
 * a successful validation grants current read authority.
 */
export type ExpectedExperienceResult = DeepReadonly<{ [K in OutputKind]: {
  output: K; viewerRef: ResultViewerRef<K>; viewerContractRevision: number;
  identity: ResultEnvelope<K>["identity"];
  media: { namespace: string; assets: ResultExpectedAsset[] };
} }[OutputKind]>;
export type ResultValidationFailure =
  | "invalid-result" | "invalid-expectation" | "unsupported-viewer-contract" | "identity-mismatch" | "media-mismatch";
export type ResultValidation =
  | { ok: true; value: ExperienceResultDto }
  | { ok: false; code: ResultValidationFailure };

// Canonical artifact revision ceilings: worker/artifact-api.ts. They are not
// promises about every historical/generated artifact. The 80 KB item ceiling
// also bounds this new projection's labels/descriptions/transcripts; the
// 100-item ceiling bounds its audience citations. Native-to-audience mappings
// for those fields are not implemented or inferred here. Larger legacy or
// unmapped results are unsupported; never truncate or coerce them into this DTO.
export const RESULT_JSON_MAX_BYTES = 1_000_000;
export const RESULT_MARKDOWN_MAX_BYTES = 512_000;
export const RESULT_ITEM_TEXT_MAX_BYTES = 80_000;
export const RESULT_MAX_ITEMS = 100;
export const RESULT_SLIDE_MAX_BULLETS = 24;
export const RESULT_SLIDE_MAX_DATA = 48;
// Derived from this exact DTO shape: the deepest leaf is a slide visual datum.
export const RESULT_JSON_MAX_DEPTH = 8;
// Current maximum per slide: item/title/body/id 4 + visual record/scalars 4 +
// bullets 25 + quote 5 + citations 301 + graphic/data 296 = 635 value nodes.
// Keep explicit headroom over 100 fully populated slides plus the envelope.
// Byte/depth/field/item limits still apply independently and are unchanged.
export const RESULT_JSON_MAX_NODES = 100_000;
const encoder = new TextEncoder();
const sha256 = /^[a-f0-9]{64}$/u;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const baseAssetKeys = ["url", "mime", "sha256", "bytes"];
const identityKeys = ["documentId", "outputId", "sourceRevision", "sourceDigest", "contentHash", "releaseHash", "outputObjectKind", "outputRevision"];
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };
class InvalidResult extends Error {
  readonly code: ResultValidationFailure;
  constructor(code: ResultValidationFailure = "invalid-result") { super(code); this.code = code; }
}
function requireValue(condition: unknown, code: ResultValidationFailure = "invalid-result"): asserts condition {
  if (!condition) throw new InvalidResult(code);
}

/**
 * Capture a private bounded quarantine tree from data descriptors only.
 * Never read a live property value, invoke accessors/toJSON/custom iterators,
 * or retain caller-owned objects. All subsequent schema/identity/media checks
 * use this inert tree, not a second read of a potentially stateful Proxy.
 * This is capture before exact schema validation, not result publication:
 * nothing is returned or frozen as a result until the complete schema passes.
 */
function captureJson(input: unknown): Json {
  let bytes = 0, nodes = 0;
  const ancestors = new Set<object>();
  function charge(count: number) { bytes += count; requireValue(bytes <= RESULT_JSON_MAX_BYTES); }
  function capture(value: unknown, depth: number): Json {
    requireValue(++nodes <= RESULT_JSON_MAX_NODES && depth <= RESULT_JSON_MAX_DEPTH);
    if (value === null || typeof value === "boolean") { charge(value === null ? 4 : value ? 4 : 5); return value; }
    if (typeof value === "string") {
      requireValue(value.length <= RESULT_MARKDOWN_MAX_BYTES);
      charge(encoder.encode(JSON.stringify(value)).length); return value;
    }
    if (typeof value === "number") {
      requireValue(Number.isFinite(value)); charge(String(value).length); return value;
    }
    requireValue(value && typeof value === "object" && !ancestors.has(value));
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    requireValue(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null);
    const keys = Reflect.ownKeys(value);
    requireValue(keys.every(key => typeof key === "string"));
    ancestors.add(value);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      requireValue(Number.isSafeInteger(length) && length >= 0 && length <= RESULT_MAX_ITEMS && keys.length === length + 1);
      const result: Json[] = []; charge(2 + Math.max(0, length - 1));
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        requireValue(descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable);
        result.push(capture(descriptor.value, depth + 1));
      }
      ancestors.delete(value); return result;
    }
    requireValue(keys.length <= 64);
    const result: Obj = {}; charge(2 + Math.max(0, keys.length - 1));
    for (const key of keys as string[]) {
      requireValue(key.length <= 128 && !["__proto__", "prototype", "constructor"].includes(key));
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      requireValue(descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable);
      charge(encoder.encode(JSON.stringify(key)).length + 1);
      result[key] = capture(descriptor.value, depth + 1);
    }
    ancestors.delete(value); return result;
  }
  return capture(input, 0);
}
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
function exact(value: Json | undefined, keys: readonly string[]): Obj {
  requireValue(value && typeof value === "object" && !Array.isArray(value));
  requireValue(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
  return value;
}
function oneOf(value: Json | undefined, values: readonly (string | number | null)[]) { requireValue(values.includes(value as string | number | null)); }
function text(value: Json | undefined, max = RESULT_ITEM_TEXT_MAX_BYTES, nonempty = false) {
  requireValue(typeof value === "string" && encoder.encode(value).length <= max && (!nonempty || value.trim().length > 0));
}
function nullableText(value: Json | undefined) { if (value !== null) text(value); }
function id(value: Json | undefined) { requireValue(typeof value === "string" && identifier.test(value)); }
function integer(value: Json | undefined, min = 0, max = Number.MAX_SAFE_INTEGER) { requireValue(typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max); }
function list(value: Json | undefined, max = RESULT_MAX_ITEMS, min = 0): Json[] {
  requireValue(Array.isArray(value) && value.length >= min && value.length <= max); return value;
}
function outputKind(value: Json | undefined): OutputKind {
  requireValue(typeof value === "string" && Object.hasOwn(experienceResultViewers, value)); return value as OutputKind;
}
function identity(value: Json | undefined, output: OutputKind): Obj {
  const record = exact(value, identityKeys);
  id(record.documentId); id(record.outputId); id(record.sourceRevision);
  requireValue(typeof record.sourceDigest === "string" && sha256.test(record.sourceDigest));
  requireValue(record.contentHash === null || typeof record.contentHash === "string" && sha256.test(record.contentHash));
  requireValue(typeof record.releaseHash === "string" && /^sha256:[a-f0-9]{64}$/u.test(record.releaseHash));
  if (output === "image") {
    oneOf(record.outputObjectKind, ["generation"]); requireValue(record.outputRevision === null);
  } else {
    oneOf(record.outputObjectKind, ["artifact"]); integer(record.outputRevision);
  }
  return record;
}
function duration(value: Json | undefined) {
  const record = exact(value, ["basis", "seconds"]);
  oneOf(record.basis, ["unknown", "measured", "recorded", "estimate"]);
  if (record.basis === "unknown") requireValue(record.seconds === null);
  else requireValue(typeof record.seconds === "number" && Number.isFinite(record.seconds) && record.seconds > 0 && record.seconds <= RESULT_MAX_DURATION_SECONDS);
}
function assetKeys(value: Json | undefined): readonly string[] {
  requireValue(value && typeof value === "object" && !Array.isArray(value) && isResultMediaMime(value.mime));
  if ((RESULT_IMAGE_MIMES as readonly string[]).includes(value.mime)) return [...baseAssetKeys, "width", "height"];
  return value.mime === "model/gltf-binary" ? baseAssetKeys : [...baseAssetKeys, "duration"];
}
function validateAsset(record: Obj, namespace: Json | undefined) {
  requireValue(isResultMediaPathForNamespace(record.url, namespace) && isResultMediaMime(record.mime));
  requireValue(typeof record.sha256 === "string" && sha256.test(record.sha256));
  integer(record.bytes, 1, record.mime === "model/gltf-binary" ? RESULT_MODEL3D_MAX_BYTES : RESULT_ASSET_MAX_BYTES);
  if ((RESULT_IMAGE_MIMES as readonly string[]).includes(record.mime)) {
    integer(record.width, 1, RESULT_MAX_DIMENSION); integer(record.height, 1, RESULT_MAX_DIMENSION);
  } else if (record.mime !== "model/gltf-binary") duration(record.duration);
}
type MediaCheck = (value: Json | undefined, mimes: readonly string[]) => Obj;
function slideVisual(value: Json | undefined) {
  if (value === null) return;
  const record = exact(value, ["layout", "kicker", "section", "bullets", "quote", "citations", "visual"]);
  oneOf(record.layout, slideLayouts); text(record.kicker); nullableText(record.section);
  for (const bullet of list(record.bullets, RESULT_SLIDE_MAX_BULLETS)) text(bullet);
  if (record.quote !== null) {
    const quote = exact(record.quote, ["text", "speaker", "role", "citation"]);
    text(quote.text); text(quote.speaker); text(quote.role); nullableText(quote.citation);
  }
  for (const item of list(record.citations)) {
    const citation = exact(item, ["label", "anchor"]); text(citation.label); text(citation.anchor);
    requireValue(Boolean(citation.label || citation.anchor));
  }
  const visual = exact(record.visual, ["kind", "label", "value", "exactValue", "displayValue", "unit", "data"]);
  oneOf(visual.kind, slideVisualKinds); text(visual.label); text(visual.value);
  nullableText(visual.exactValue); nullableText(visual.displayValue); nullableText(visual.unit);
  for (const item of list(visual.data, RESULT_SLIDE_MAX_DATA)) {
    const datum = exact(item, ["label", "value", "weight", "exactValue", "displayValue"]);
    text(datum.label); text(datum.value); nullableText(datum.exactValue); nullableText(datum.displayValue);
    requireValue(typeof datum.weight === "number" && Number.isFinite(datum.weight) && datum.weight >= 0 && datum.weight <= 1);
  }
}
function presentation(value: Json | undefined) {
  if (value === null) return;
  const record = exact(value, ["aspectRatio", "stylePreset", "mode", "footerLabel", "palette"]);
  oneOf(record.aspectRatio, ["16:9"]); oneOf(record.stylePreset, ["gallery", "editorial", "nocturne", "field-notes"]);
  oneOf(record.mode, ["light", "dark"]); text(record.footerLabel);
  const palette = exact(record.palette, ["background", "foreground", "accent", "muted", "surface"]);
  for (const color of Object.values(palette)) requireValue(typeof color === "string" && /^#[a-fA-F0-9]{6}$/u.test(color));
  // No arbitrary font names, CSS, theme records, imports or URLs in this slice.
}
function uniqueItemIds(items: Json[]) {
  const ids = new Set<Json>();
  for (const item of items) {
    requireValue(item && typeof item === "object" && !Array.isArray(item));
    id(item.id); requireValue(!ids.has(item.id!)); ids.add(item.id!);
  }
}
function validateContent(value: Json | undefined, output: OutputKind, media: MediaCheck) {
  const image = (candidate: Json | undefined) => {
    media(candidate, RESULT_IMAGE_MIMES);
  };
  const timed = (candidate: Json | undefined, mimes: readonly string[]) => {
    media(candidate, mimes);
  };
  switch (output) {
    case "image": {
      const record = exact(value, ["image", "alt", "caption"]);
      image(record.image); text(record.alt, RESULT_ITEM_TEXT_MAX_BYTES, true); text(record.caption); return;
    }
    case "short_story": {
      const record = exact(value, ["content_markdown"]);
      text(record.content_markdown, RESULT_MARKDOWN_MAX_BYTES, true); return;
    }
    case "scene": {
      const record = exact(value, ["medium", "content_markdown"]); oneOf(record.medium, ["visual", "audio", null]);
      text(record.content_markdown, RESULT_MARKDOWN_MAX_BYTES, true); return;
    }
    case "slides": {
      const record = exact(value, ["slides", "presentation"]), items = list(record.slides, RESULT_MAX_ITEMS, 1);
      uniqueItemIds(items);
      for (const item of items) {
        const slide = exact(item, ["id", "title", "body", "slide"]);
        text(slide.title); text(slide.body); slideVisual(slide.slide);
      }
      presentation(record.presentation); return;
    }
    case "storyboard": {
      const record = exact(value, ["frames"]), items = list(record.frames, RESULT_MAX_ITEMS, 1);
      uniqueItemIds(items);
      for (const item of items) {
        const frame = exact(item, ["id", "title", "body", "image", "alt", "caption", "duration"]);
        text(frame.title); text(frame.body); text(frame.caption); text(frame.alt, RESULT_ITEM_TEXT_MAX_BYTES, frame.image !== null);
        if (frame.image !== null) image(frame.image);
        duration(frame.duration);
      }
      return;
    }
    case "video": {
      const record = exact(value, ["clips"]), items = list(record.clips, RESULT_MAX_ITEMS, 1);
      uniqueItemIds(items);
      for (const item of items) {
        const clip = exact(item, ["id", "title", "asset", "transcript", "description"]);
        text(clip.title); timed(clip.asset, RESULT_VIDEO_MIMES); nullableText(clip.transcript); text(clip.description);
      }
      return;
    }
    case "audio": {
      const record = exact(value, ["asset", "transcript", "description"]);
      timed(record.asset, RESULT_AUDIO_MIMES); nullableText(record.transcript); text(record.description); return;
    }
    case "model3d": {
      const record = exact(value, ["glb", "view", "poster", "description"]); media(record.glb, RESULT_MODEL3D_MIMES); text(record.description);
      if (record.poster !== null) {
        const poster = exact(record.poster, ["image", "alt"]); image(poster.image); text(poster.alt, RESULT_ITEM_TEXT_MAX_BYTES, true);
      }
      if (record.view !== null) {
        const view = exact(record.view, ["version", "position", "target", "fov", "background"]);
        oneOf(view.version, [1]); oneOf(view.fov, [35]); oneOf(view.background, ["transparent", "#ffffff", "#18181b"]);
        for (const vector of [view.position, view.target]) for (const coordinate of list(vector, 3, 3)) {
          requireValue(typeof coordinate === "number" && Number.isFinite(coordinate) && Math.abs(coordinate) <= 32);
        }
        // The existing distance/target checks are secondary to the exact schema.
        requireValue(normalizeModel3dView(view));
      }
      return;
    }
  }
}

/**
 * Pure, synchronous shape/identity validation of a retained projected result.
 * No renderer, fetch, store, actor, job, provider or current-release resolution.
 * Success means only this DTO matches the supplied expected metadata. It proves
 * neither content quality nor permission, media bytes, provenance, or readiness.
 */
export function validateExperienceResult(input: unknown, expectedInput: unknown): ResultValidation {
  let validatingExpectation = true;
  try {
    const expected = exact(captureJson(expectedInput), ["output", "viewerRef", "viewerContractRevision", "identity", "media"]);
    const expectedOutput = outputKind(expected.output), expectedIdentity = identity(expected.identity, expectedOutput);
    const descriptor = experienceResultViewers[expectedOutput];
    requireValue(expected.viewerRef === descriptor.id && expected.viewerContractRevision === descriptor.contractRevision, "unsupported-viewer-contract");
    const mediaScope = exact(expected.media, ["namespace", "assets"]);
    requireValue(isResultMediaNamespace(mediaScope.namespace));
    const expectedAssets = new Map<string, Obj>();
    for (const value of list(mediaScope.assets)) {
      const asset = exact(value, assetKeys(value)); validateAsset(asset, mediaScope.namespace);
      requireValue(typeof asset.url === "string" && !expectedAssets.has(asset.url));
      expectedAssets.set(asset.url, asset);
    }
    validatingExpectation = false;
    const result = exact(captureJson(input), ["schemaVersion", "output", "viewerRef", "viewerContractRevision", "identity", "title", "content"]);
    requireValue(result.schemaVersion === descriptor.dtoVersion, "unsupported-viewer-contract");
    requireValue(result.viewerRef === expected.viewerRef && result.viewerContractRevision === expected.viewerContractRevision, "identity-mismatch");
    requireValue(result.output === expectedOutput, "identity-mismatch");
    const resultIdentity = identity(result.identity, expectedOutput);
    for (const key of identityKeys) requireValue(resultIdentity[key] === expectedIdentity[key], "identity-mismatch");
    text(result.title);
    const usedAssets = new Set<string>();
    const media: MediaCheck = (value, mimes) => {
      const asset = exact(value, assetKeys(value));
      validateAsset(asset, mediaScope.namespace);
      requireValue(typeof asset.mime === "string" && mimes.includes(asset.mime));
      const retained = expectedAssets.get(asset.url as string);
      requireValue(retained && Object.keys(asset).every(key => {
        if (key !== "duration") return retained[key] === asset[key];
        const actual = asset.duration as Obj, retainedDuration = retained.duration as Obj;
        return retainedDuration && actual.basis === retainedDuration.basis && actual.seconds === retainedDuration.seconds;
      }), "media-mismatch");
      usedAssets.add(asset.url as string); return asset;
    };
    validateContent(result.content, expectedOutput, media);
    requireValue(usedAssets.size === expectedAssets.size, "media-mismatch");
    // The descriptor-captured tree has passed every schema and binding check.
    // Normalize only its saved camera, then freeze and publish that SAME tree.
    // Never reread, freeze or mutate the caller's original object graph.
    if (expectedOutput === "model3d") {
      const content = result.content as Obj;
      if (content.view !== null) content.view = normalizeModel3dView(content.view) as unknown as Json;
    }
    return { ok: true, value: freeze(result) as unknown as ExperienceResultDto };
  } catch (error) {
    const code = error instanceof InvalidResult ? error.code : "invalid-result";
    return { ok: false, code: validatingExpectation && code === "invalid-result" ? "invalid-expectation" : code };
  }
}
