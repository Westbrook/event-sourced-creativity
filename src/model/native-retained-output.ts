import { presentationAudienceItem } from "./presentation-delivery.ts";
import type { DocumentArtifactDraftItem, SlideCitation, SlidePresentation, SlideQuote, SlideVisualData, SlideVisualDatum } from "./document-artifacts.ts";
import type { RetainedStorySelection } from "./retained-short-story.ts";

export type NativeRetainedOutputKind = "scene" | "slides";
export type NativeRetainedOutputTarget = Readonly<{ output: NativeRetainedOutputKind; selection: RetainedStorySelection }>;
type NativeRetainedOutputBase = Readonly<{
  schemaVersion: 1;
  kind: "native-retained-output";
  selection: RetainedStorySelection;
  title: string;
  expiresAt: string;
}>;
export type NativeRetainedOutputDto = NativeRetainedOutputBase & (
  | Readonly<{ output: "scene"; content: Readonly<{ content_markdown: string; medium: "visual" | "audio" | null }> }>
  | Readonly<{ output: "slides"; content: Readonly<{ items: readonly DocumentArtifactDraftItem[]; presentation: SlidePresentation | null }> }>
);

export const NATIVE_RETAINED_OUTPUT_JSON_MAX_BYTES = 1_000_000;
export const NATIVE_RETAINED_OUTPUT_TEXT_MAX_BYTES = 80_000;
export const NATIVE_RETAINED_OUTPUT_MARKDOWN_MAX_BYTES = 512_000;
export const NATIVE_RETAINED_OUTPUT_ITEMS_MAX = 100;
export const NATIVE_RETAINED_OUTPUT_BULLETS_MAX = 24;
export const NATIVE_RETAINED_OUTPUT_DATA_MAX = 48;
export const NATIVE_RETAINED_OUTPUT_CITATIONS_MAX = 100;

const encoder = new TextEncoder();
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const digest = /^[a-f0-9]{64}$/u;
const selectionKeys = ["documentId", "artifactId", "revision", "contentSha256"] as const;
// The native typography policy in document-artifacts.ts and office-documents.ts.
// Applying this policy preserves a safe family name; it never loads a font.
const safeFontFamily = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,69}$/u;
const layouts = ["cover", "statement", "split", "columns", "metric", "timeline", "closing", "quote", "scorecard", "comparison", "matrix", "architecture", "personas", "roadmap"] as const;
const visualKinds = ["hero-type", "metric", "bars", "timeline", "diagram", "color-field", "quote", "scorecard", "comparison", "matrix", "architecture", "personas", "roadmap"] as const;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonRecord = { [key: string]: Json };

function invalid(): never { throw new TypeError("Invalid native retained output"); }

/** Capture JSON data descriptors only, before using any native projection.
 * Bounds include private metadata and escaped envelope bytes. Depth and node
 * caps keep adversarial nesting bounded even when the byte limit is small.
 * Proxies cannot be identified without invoking their reflection traps; any
 * thrown trap is caught by the public decoder. No input getter, iterator or
 * serialization hook is called.
 */
function captureJson(input: unknown, limit = NATIVE_RETAINED_OUTPUT_JSON_MAX_BYTES): Json {
  let bytes = 0, nodes = 0;
  const ancestors = new Set<object>();
  const add = (count: number) => { bytes += count; if (bytes > limit) invalid(); };
  function visit(value: unknown, depth: number): Json {
    if (++nodes > 100_000 || depth > 64) invalid();
    if (value === null || typeof value === "boolean") { add(value === null ? 4 : value ? 4 : 5); return value; }
    if (typeof value === "string") {
      if (value.length > limit) invalid();
      add(encoder.encode(JSON.stringify(value)).length); return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) invalid();
      add(JSON.stringify(value).length); return value;
    }
    if (typeof value !== "object" || ancestors.has(value)) invalid();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid();
    const keys = Reflect.ownKeys(value);
    ancestors.add(value);
    try {
      add(2);
      if (array) {
        const length = Object.getOwnPropertyDescriptor(value, "length");
        if (!length || !Object.hasOwn(length, "value") || !Number.isSafeInteger(length.value)
          || length.value < 0 || length.value > 100_000 || keys.length !== length.value + 1) invalid();
        const result: Json[] = [];
        for (let index = 0; index < length.value; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) invalid();
          if (index) add(1);
          result.push(visit(descriptor.value, depth + 1));
        }
        return result;
      }
      const result: JsonRecord = Object.create(null);
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        if (typeof key !== "string" || key.length > limit) invalid();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) invalid();
        if (index) add(1);
        add(encoder.encode(JSON.stringify(key)).length + 1);
        result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally { ancestors.delete(value); }
  }
  return visit(input, 0);
}

function record(value: Json | undefined, required: readonly string[], optional: readonly string[] = [], extra = false): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  if (required.some(key => !Object.hasOwn(value, key))
    || !extra && Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid();
  return value;
}
function text(value: Json | undefined, maximum = NATIVE_RETAINED_OUTPUT_TEXT_MAX_BYTES): string {
  if (typeof value !== "string" || value.length > maximum || encoder.encode(value).length > maximum) invalid();
  return value;
}
function list(value: Json | undefined, maximum: number): Json[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}
function strings(value: Json | undefined, maximum: number): string[] { return list(value, maximum).map(item => text(item)); }
function choice<T extends string>(value: Json | undefined, values: readonly T[]): T {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) invalid();
  return value as T;
}
function optionalText(value: JsonRecord, key: string): { [key: string]: string } {
  return Object.hasOwn(value, key) ? { [key]: text(value[key]) } : {};
}
function readSelection(value: Json | undefined): RetainedStorySelection {
  const entry = record(value, selectionKeys);
  if (typeof entry.documentId !== "string" || !identifier.test(entry.documentId)
    || typeof entry.artifactId !== "string" || !identifier.test(entry.artifactId)
    || typeof entry.revision !== "number" || !Number.isSafeInteger(entry.revision) || entry.revision < 0
    || typeof entry.contentSha256 !== "string" || !digest.test(entry.contentSha256)) invalid();
  return Object.freeze({ documentId: entry.documentId, artifactId: entry.artifactId,
    revision: entry.revision, contentSha256: entry.contentSha256 });
}
function readTarget(value: unknown): NativeRetainedOutputTarget {
  const entry = record(captureJson(value, 4096), ["output", "selection"]);
  return Object.freeze({ output: choice(entry.output, ["scene", "slides"]), selection: readSelection(entry.selection) });
}
function selectionFromQuery(parameters: URLSearchParams, documentId: string | null, artifactId: string | null): RetainedStorySelection {
  const revision = parameters.get("revision");
  if (typeof revision !== "string" || !/^(0|[1-9]\d*)$/u.test(revision)) invalid();
  return readSelection({ documentId, artifactId, revision: Number(revision), contentSha256: parameters.get("sha256") });
}
function exactQuery(parameters: URLSearchParams, keys: readonly string[]): boolean {
  const names = [...parameters.keys()];
  return names.length === keys.length && keys.every(key => parameters.getAll(key).length === 1)
    && names.every(key => keys.includes(key));
}

function hasUnsafeUrlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || code === 0x5c || code === 0x23) return true;
  }
  return false;
}

/** Decode a requested selection; the route does not grant current read access. */
export function parseNativeRetainedOutputRoute(route: string): NativeRetainedOutputTarget | null {
  try {
    if (typeof route !== "string" || route.length > 2048 || hasUnsafeUrlCharacters(route)) return null;
    const path = route.split("?", 1)[0];
    if (path !== "/make/scene" && path !== "/make/slides") return null;
    const url = new URL(route, "https://forma.local");
    if (!exactQuery(url.searchParams, ["document", "artifact", "revision", "sha256"])) return null;
    return Object.freeze({ output: path === "/make/scene" ? "scene" : "slides",
      selection: selectionFromQuery(url.searchParams, url.searchParams.get("document"), url.searchParams.get("artifact")) });
  } catch { return null; }
}

export function nativeRetainedOutputRequestPath(target: NativeRetainedOutputTarget): string {
  const checked = readTarget(target), selected = checked.selection;
  return `/api/retained-output/${checked.output}/${encodeURIComponent(selected.documentId)}/${encodeURIComponent(selected.artifactId)}`
    + `?revision=${selected.revision}&sha256=${selected.contentSha256}`;
}

/** Server decoding only. Authentication and current native selection are separate. */
export function parseNativeRetainedOutputRequestUrl(requestUrl: string): NativeRetainedOutputTarget | null {
  try {
    if (typeof requestUrl !== "string" || requestUrl.length > 4096 || hasUnsafeUrlCharacters(requestUrl)) return null;
    const rawPath = requestUrl.match(/^https?:\/\/[^/?#]+(\/[^?#]*)/u)?.[1];
    const path = rawPath?.match(/^\/api\/retained-output\/(scene|slides)\/([^/]+)\/([^/]+)$/u);
    if (!path) return null;
    const url = new URL(requestUrl);
    if (url.username || url.password || !exactQuery(url.searchParams, ["revision", "sha256"])) return null;
    return Object.freeze({ output: path[1] as NativeRetainedOutputKind,
      selection: selectionFromQuery(url.searchParams, decodeURIComponent(path[2]!), decodeURIComponent(path[3]!)) });
  } catch { return null; }
}

function readPresentation(value: Json | undefined): SlidePresentation | null {
  if (value === null || value === undefined) return null;
  const entry = record(value, ["aspectRatio", "theme", "footerLabel", "stylePreset", "mode", "palette"], ["fontFamily"]);
  const palette = record(entry.palette, ["background", "foreground", "accent", "muted", "surface"]);
  for (const color of Object.values(palette)) if (typeof color !== "string" || !/^#[0-9a-f]{6}$/iu.test(color)) invalid();
  const font = optionalText(entry, "fontFamily");
  if (font.fontFamily !== undefined && !safeFontFamily.test(font.fontFamily)) invalid();
  return { aspectRatio: choice(entry.aspectRatio, ["16:9"]), theme: text(entry.theme), footerLabel: text(entry.footerLabel),
    stylePreset: choice(entry.stylePreset, ["gallery", "editorial", "nocturne", "field-notes"]),
    mode: choice(entry.mode, ["light", "dark"]), ...font,
    palette: { background: palette.background as string, foreground: palette.foreground as string,
      accent: palette.accent as string, muted: palette.muted as string, surface: palette.surface as string } };
}
function readQuote(value: Json | undefined, audience: boolean): SlideQuote {
  const entry = record(value, ["text", "speaker", "role"], audience ? ["citation"] : ["sourceId", "citation"]);
  return { text: text(entry.text), speaker: text(entry.speaker), role: text(entry.role),
    ...optionalText(entry, "citation"), ...optionalText(entry, "sourceId") };
}
function readCitation(value: Json, audience: boolean): SlideCitation {
  const entry = record(value, ["label", "anchor", "excerpt"], audience ? [] : ["sourceId"]);
  const excerpt = text(entry.excerpt);
  if (audience && excerpt !== "") invalid();
  return { label: text(entry.label), anchor: text(entry.anchor), excerpt, ...optionalText(entry, "sourceId") };
}
function readDatum(value: Json, audience: boolean): SlideVisualDatum {
  const entry = record(value, ["label", "value", "weight"], ["exactValue", "displayValue", ...audience ? [] : ["sourceIds"]]);
  if (typeof entry.weight !== "number" || entry.weight < 0 || entry.weight > 1) invalid();
  return { label: text(entry.label), value: text(entry.value), weight: entry.weight,
    ...optionalText(entry, "exactValue"), ...optionalText(entry, "displayValue"),
    ...Object.hasOwn(entry, "sourceIds") ? { sourceIds: strings(entry.sourceIds, NATIVE_RETAINED_OUTPUT_CITATIONS_MAX) } : {} };
}
function readSlide(value: Json | undefined, audience: boolean): SlideVisualData | null {
  // Native drafts allow an absent visual and an absent presentation. These two
  // omissions map to null; malformed present records are never repaired.
  if (value === null || value === undefined) return null;
  const entry = record(value, ["layout", "kicker", "bullets", "visual"],
    ["quote", "citations", "section", ...audience ? [] : ["sourceIds", "sourceOrder"]]);
  const visual = record(entry.visual, ["kind", "label", "value", "data"], ["exactValue", "displayValue", "unit"]);
  if (Object.hasOwn(entry, "sourceOrder") && (typeof entry.sourceOrder !== "number"
    || !Number.isSafeInteger(entry.sourceOrder) || entry.sourceOrder <= 0)) invalid();
  return {
    layout: choice(entry.layout, layouts), kicker: text(entry.kicker), bullets: strings(entry.bullets, NATIVE_RETAINED_OUTPUT_BULLETS_MAX),
    ...Object.hasOwn(entry, "quote") ? { quote: readQuote(entry.quote, audience) } : {},
    ...Object.hasOwn(entry, "citations") ? { citations: list(entry.citations, NATIVE_RETAINED_OUTPUT_CITATIONS_MAX).map(item => readCitation(item, audience)) } : {},
    ...Object.hasOwn(entry, "sourceIds") ? { sourceIds: strings(entry.sourceIds, NATIVE_RETAINED_OUTPUT_CITATIONS_MAX) } : {},
    ...optionalText(entry, "section"), ...Object.hasOwn(entry, "sourceOrder") ? { sourceOrder: entry.sourceOrder as number } : {},
    visual: { kind: choice(visual.kind, visualKinds), label: text(visual.label), value: text(visual.value),
      ...optionalText(visual, "exactValue"), ...optionalText(visual, "displayValue"), ...optionalText(visual, "unit"),
      data: list(visual.data, NATIVE_RETAINED_OUTPUT_DATA_MAX).map(item => readDatum(item, audience)) },
  };
}
function readItem(value: Json, audience: boolean): DocumentArtifactDraftItem {
  const entry = record(value, audience ? ["title", "body", "notes", "image_prompt", "slide"] : ["title", "body"],
    audience ? [] : ["notes", "image_prompt", "slide", "context_group_ids"]);
  // Absent private producer fields do not invent audience content. Present
  // values are checked before they are deliberately omitted from delivery.
  const notes = Object.hasOwn(entry, "notes") ? text(entry.notes) : "";
  const imagePrompt = Object.hasOwn(entry, "image_prompt") ? text(entry.image_prompt) : "";
  if (audience && (notes !== "" || imagePrompt !== "")) invalid();
  if (Object.hasOwn(entry, "context_group_ids")) strings(entry.context_group_ids, NATIVE_RETAINED_OUTPUT_CITATIONS_MAX);
  return { title: text(entry.title), body: text(entry.body), notes, image_prompt: imagePrompt, slide: readSlide(entry.slide, audience) };
}

/** The existing privacy helper preserves known copy but spreads its inputs.
 * It therefore receives only fresh, structurally validated native fields; a
 * second whitelist removes empty private source arrays that it may retain.
 */
function audienceItem(item: DocumentArtifactDraftItem): DocumentArtifactDraftItem {
  const safe = presentationAudienceItem(item), slide = safe.slide;
  if (slide) {
    delete slide.sourceIds;
    delete slide.sourceOrder;
    if (!Object.hasOwn(item.slide!, "citations")) delete slide.citations;
    for (const datum of slide.visual.data) delete datum.sourceIds;
  }
  return { title: safe.title, body: safe.body, notes: "", image_prompt: "", slide };
}
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) immutable(item);
    Object.freeze(value);
  }
  return value;
}
function finish(target: NativeRetainedOutputTarget, title: string, expiresAt: string,
  content: NativeRetainedOutputDto["content"], now: number): NativeRetainedOutputDto {
  if (typeof now !== "number" || !Number.isFinite(now) || typeof expiresAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(expiresAt)) invalid();
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || new Date(expiry).toISOString() !== expiresAt) invalid();
  const result = { schemaVersion: 1, kind: "native-retained-output", output: target.output,
    selection: target.selection, title, expiresAt, content } as NativeRetainedOutputDto;
  if (encoder.encode(JSON.stringify(result)).length > NATIVE_RETAINED_OUTPUT_JSON_MAX_BYTES) invalid();
  return immutable(result);
}

/** The caller bounds transport bytes before parsing and independently owns
 * authentication, current source authority, retirement and same-Document Edit.
 * This validates exact data identity; it is not an authority or release receipt.
 */
export function validateNativeRetainedOutputDto(candidate: unknown, target: NativeRetainedOutputTarget, now = Date.now()): NativeRetainedOutputDto | null {
  try {
    const expected = readTarget(target);
    const value = record(captureJson(candidate), ["schemaVersion", "kind", "output", "selection", "title", "expiresAt", "content"]);
    if (value.schemaVersion !== 1 || value.kind !== "native-retained-output" || value.output !== expected.output) return null;
    const selected = readSelection(value.selection);
    if (selectionKeys.some(key => selected[key] !== expected.selection[key])) return null;
    const title = text(value.title), expiresAt = text(value.expiresAt, 24);
    if (expected.output === "scene") {
      const content = record(value.content, ["content_markdown", "medium"]);
      const medium = content.medium === null ? null : choice(content.medium, ["visual", "audio"]);
      return finish(expected, title, expiresAt, { content_markdown: text(content.content_markdown, NATIVE_RETAINED_OUTPUT_MARKDOWN_MAX_BYTES), medium }, now);
    }
    const content = record(value.content, ["items", "presentation"]);
    const items = list(content.items, NATIVE_RETAINED_OUTPUT_ITEMS_MAX).map(item => readItem(item, true));
    if (!items.length) return null;
    // Closed audience DTOs cannot restore an attribution that the native
    // privacy projection would remove or modify.
    if (items.some(item => JSON.stringify(audienceItem(item)) !== JSON.stringify(item))) return null;
    return finish(expected, title, expiresAt, { items, presentation: readPresentation(content.presentation) }, now);
  } catch { return null; }
}

/** Project bounded current private native JSON after the Worker establishes
 * access and witnesses the exact retained selection. Extra root metadata is
 * discarded; nested native records are closed. Native copy is never trimmed,
 * truncated, coerced or repaired. Citation attribution follows Forma's existing
 * audience privacy policy, and evidence excerpts and producer fields stay out.
 */
export function projectNativeRetainedOutput(target: NativeRetainedOutputTarget, rawContent: unknown,
  expiresAt: string, sceneMedium: unknown = null): NativeRetainedOutputDto | null {
  try {
    const expected = readTarget(target);
    const raw = record(captureJson(rawContent), ["title"], [], true);
    const title = text(raw.title);
    if (Object.hasOwn(raw, "content_markdown")) text(raw.content_markdown, NATIVE_RETAINED_OUTPUT_MARKDOWN_MAX_BYTES);
    if (expected.output === "scene") {
      if (sceneMedium !== null && sceneMedium !== "visual" && sceneMedium !== "audio") return null;
      return finish(expected, title, expiresAt, { content_markdown: text(raw.content_markdown, NATIVE_RETAINED_OUTPUT_MARKDOWN_MAX_BYTES), medium: sceneMedium }, Date.now());
    }
    const items = list(raw.items, NATIVE_RETAINED_OUTPUT_ITEMS_MAX).map(item => audienceItem(readItem(item, false)));
    if (!items.length) return null;
    return finish(expected, title, expiresAt, { items, presentation: readPresentation(raw.presentation) }, Date.now());
  } catch { return null; }
}
