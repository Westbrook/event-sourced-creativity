import { validateRetainedStoryDto, type RetainedStorySelection } from "./retained-short-story.ts";
import { validateNativeRetainedOutputDto } from "./native-retained-output.ts";
import type { SlidePresentation, SlideVisualData } from "./document-artifacts.ts";

/** Detached data contract only. No decoder or candidate authorizes publication. */
export const SELECTED_OUTPUT_SHARE_PURPOSE = "selected-output-read-v1";
export const SELECTED_OUTPUT_SHARE_TITLE_MAX_BYTES = 512;
export const SELECTED_OUTPUT_SHARE_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const SELECTED_OUTPUT_SHARE_JSON_MAX_BYTES = 1_000_000;

export type SelectedOutputShareKind = "short_story" | "scene" | "slides";
export type SelectedOutputShareSelection = Readonly<RetainedStorySelection & { output: SelectedOutputShareKind }>;
export type SelectedOutputShareReview = Readonly<{ title: string; expiresAt: string }>;
export type SelectedOutputShareSlide = Readonly<{
  layout: SlideVisualData["layout"];
  kicker: string;
  bullets: readonly string[];
  section?: string;
  quote?: Readonly<{ text: string; speaker: string; role: string; citation?: string }>;
  citations?: readonly Readonly<{ label: string; anchor: string }>[];
  visual: Readonly<{
    kind: SlideVisualData["visual"]["kind"];
    label: string;
    value: string;
    exactValue?: string;
    displayValue?: string;
    unit?: string;
    data: readonly Readonly<{ label: string; value: string; weight: number; exactValue?: string; displayValue?: string }>[];
  }>;
}>;
type PublicShareBase = Readonly<{
  schemaVersion: 1;
  kind: "selected-output-read";
  title: string;
  expiresAt: string;
  attribution: "Forma";
}>;
export type SelectedOutputSharePublicOutput = PublicShareBase & (
  | Readonly<{ output: "short_story"; content: Readonly<{ text: string }> }>
  | Readonly<{ output: "scene"; content: Readonly<{ text: string; medium: "visual" | "audio" | null }> }>
  | Readonly<{ output: "slides"; content: Readonly<{
    items: readonly Readonly<{ title: string; body: string; slide: SelectedOutputShareSlide | null }>[];
    presentation: SlidePresentation | null;
  }> }>
);
/** Private review envelope: only publicOutput is suitable for public delivery.
 * Selection/hash validity does not establish current custody or publishing rights.
 */
export type SelectedOutputShareCandidate = Readonly<{
  schemaVersion: 1;
  kind: "selected-output-share-candidate";
  purpose: typeof SELECTED_OUTPUT_SHARE_PURPOSE;
  selection: SelectedOutputShareSelection;
  sourceExpiresAt: string;
  publicOutput: SelectedOutputSharePublicOutput;
  candidateSha256: string;
}>;
export type SelectedOutputShareApproval = Readonly<{
  purpose: typeof SELECTED_OUTPUT_SHARE_PURPOSE;
  candidateSha256: string;
  allowPublicRead: true;
}>;

const encoder = new TextEncoder();
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const digest = /^[a-f0-9]{64}$/u;
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const selectionKeys = ["output", "documentId", "artifactId", "revision", "contentSha256"] as const;
const candidateKeys = ["schemaVersion", "kind", "purpose", "selection", "sourceExpiresAt", "publicOutput", "candidateSha256"] as const;

/** Descriptor capture: no getters, serialization hooks or inherited fields. */
function fields(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const names = Reflect.ownKeys(value);
  if (names.length < keys.length || names.length > keys.length + optional.length
    || names.some(name => typeof name !== "string" || !keys.includes(name) && !optional.includes(name))) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const name of [...keys, ...optional.filter(key => names.includes(key))]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return null;
    result[name] = descriptor.value;
  }
  return result;
}

/** Capture bounded JSON descriptors before rebuilding a public data shape.
 * Reflection traps may throw; callers catch them. Accessors and toJSON never run.
 */
function captureData(input: unknown): unknown {
  let byteLength = 0, nodes = 0;
  const ancestors = new Set<object>();
  const count = (amount: number) => { byteLength += amount; if (byteLength > SELECTED_OUTPUT_SHARE_JSON_MAX_BYTES) throw new TypeError("Oversized share data"); };
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > 100_000 || depth > 64) throw new TypeError("Invalid share data");
    if (value === null || typeof value === "boolean") { count(value === null ? 4 : value ? 4 : 5); return value; }
    if (typeof value === "string") {
      if (value.length > SELECTED_OUTPUT_SHARE_JSON_MAX_BYTES) throw new TypeError("Oversized share data");
      count(encoder.encode(JSON.stringify(value)).length); return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) { count(JSON.stringify(value).length); return value; }
    if (typeof value !== "object" || ancestors.has(value)) throw new TypeError("Invalid share data");
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value), names = Reflect.ownKeys(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new TypeError("Invalid share data");
    ancestors.add(value); count(2);
    try {
      if (array) {
        const length = Object.getOwnPropertyDescriptor(value, "length");
        if (!length || !Object.hasOwn(length, "value") || !Number.isSafeInteger(length.value)
          || length.value < 0 || length.value > 100_000 || names.length !== length.value + 1) throw new TypeError("Invalid share data");
        const result: unknown[] = [];
        for (let index = 0; index < length.value; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw new TypeError("Invalid share data");
          if (index) count(1); result.push(visit(descriptor.value, depth + 1));
        }
        return result;
      }
      const result: Record<string, unknown> = Object.create(null);
      for (const [index, key] of names.entries()) {
        if (typeof key !== "string" || key.length > SELECTED_OUTPUT_SHARE_JSON_MAX_BYTES) throw new TypeError("Invalid share data");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw new TypeError("Invalid share data");
        if (index) count(1); count(encoder.encode(JSON.stringify(key)).length + 1);
        result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally { ancestors.delete(value); }
  }
  return visit(input, 0);
}

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !isoTimestamp.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

function titleHasControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code >= 0x7f && code <= 0x9f) return true;
  }
  return false;
}

function reviewChoices(value: unknown, now: number): SelectedOutputShareReview | null {
  const choices = fields(value, ["title", "expiresAt"]);
  if (!Number.isSafeInteger(now) || now < 0 || !choices || typeof choices.title !== "string" || !choices.title.trim()
    || choices.title.length > SELECTED_OUTPUT_SHARE_TITLE_MAX_BYTES
    || encoder.encode(choices.title).length > SELECTED_OUTPUT_SHARE_TITLE_MAX_BYTES
    || titleHasControl(choices.title)) return null;
  const expiry = timestamp(choices.expiresAt);
  if (expiry === null || expiry <= now || expiry - now > SELECTED_OUTPUT_SHARE_MAX_LIFETIME_MS) return null;
  return Object.freeze({ title: choices.title, expiresAt: choices.expiresAt as string });
}

function publicSlide(slide: SlideVisualData | null | undefined): SelectedOutputShareSlide | null {
  if (!slide) return null;
  return {
    layout: slide.layout, kicker: slide.kicker, bullets: [...slide.bullets],
    ...(slide.section === undefined ? {} : { section: slide.section }),
    ...(slide.quote ? { quote: { text: slide.quote.text, speaker: slide.quote.speaker, role: slide.quote.role,
      ...(slide.quote.citation === undefined ? {} : { citation: slide.quote.citation }) } } : {}),
    ...(slide.citations === undefined ? {} : { citations: slide.citations.map(citation => ({ label: citation.label, anchor: citation.anchor })) }),
    visual: { kind: slide.visual.kind, label: slide.visual.label, value: slide.visual.value,
      ...(slide.visual.exactValue === undefined ? {} : { exactValue: slide.visual.exactValue }),
      ...(slide.visual.displayValue === undefined ? {} : { displayValue: slide.visual.displayValue }),
      ...(slide.visual.unit === undefined ? {} : { unit: slide.visual.unit }),
      data: slide.visual.data.map(datum => ({ label: datum.label, value: datum.value, weight: datum.weight,
        ...(datum.exactValue === undefined ? {} : { exactValue: datum.exactValue }),
        ...(datum.displayValue === undefined ? {} : { displayValue: datum.displayValue }) })) },
  };
}

function nativeProjection(selected: SelectedOutputShareSelection, nativeDto: unknown, choices: SelectedOutputShareReview, now: number) {
  const nativeSelection = Object.freeze({ documentId: selected.documentId, artifactId: selected.artifactId,
    revision: selected.revision, contentSha256: selected.contentSha256 });
  const base = { schemaVersion: 1 as const, kind: "selected-output-read" as const,
    title: choices.title, expiresAt: choices.expiresAt, attribution: "Forma" as const };
  let publicOutput: SelectedOutputSharePublicOutput;
  let sourceExpiresAt: string;
  if (selected.output === "short_story") {
    const native = validateRetainedStoryDto(nativeDto, nativeSelection, now);
    if (!native) return null;
    sourceExpiresAt = native.expiresAt;
    publicOutput = { ...base, output: "short_story", content: { text: native.contentMarkdown } };
  } else {
    const native = validateNativeRetainedOutputDto(nativeDto, { output: selected.output, selection: nativeSelection }, now);
    if (!native) return null;
    sourceExpiresAt = native.expiresAt;
    if (native.output === "scene") {
      publicOutput = { ...base, output: "scene", content: { text: native.content.content_markdown, medium: native.content.medium } };
    } else if (native.output === "slides") {
      publicOutput = { ...base, output: "slides", content: {
        items: native.content.items.map(item => ({ title: item.title, body: item.body, slide: publicSlide(item.slide) })),
        // These are reviewed audience display strings, not semantic redaction.
        presentation: native.content.presentation,
      } };
    } else return null;
  }
  return { publicOutput, sourceExpiresAt };
}

/** Decode exact artifact identity, without proving current custody. Media kinds refuse. */
export function parseSelectedOutputShareSelection(value: unknown): SelectedOutputShareSelection | null {
  try {
    const captured = fields(value, selectionKeys);
    if (!captured || captured.output !== "short_story" && captured.output !== "scene" && captured.output !== "slides"
      || typeof captured.documentId !== "string" || !identifier.test(captured.documentId)
      || typeof captured.artifactId !== "string" || !identifier.test(captured.artifactId)
      || typeof captured.revision !== "number" || !Number.isSafeInteger(captured.revision) || captured.revision < 0
      || typeof captured.contentSha256 !== "string" || !digest.test(captured.contentSha256)) return null;
    return Object.freeze({ output: captured.output, documentId: captured.documentId, artifactId: captured.artifactId,
      revision: captured.revision, contentSha256: captured.contentSha256 });
  } catch { return null; }
}

/** Functional default for a separately reviewed share title; never a private name. */
export function selectedOutputShareDefaultTitle(output: SelectedOutputShareKind): string {
  if (output === "short_story") return "Short story";
  if (output === "scene") return "Scene";
  if (output === "slides") return "Slides";
  throw new TypeError("Unsupported selected output");
}

/** Project a descriptor-captured, already-authorized native text DTO into an
 * immutable review candidate. The caller must independently establish current
 * canonical custody and rejoin it at commit/read. A candidate is never a grant.
 * Body text remains literal data: no Markdown/HTML interpretation, linkification,
 * URL discovery, media reads or asset dependencies are introduced here.
 */
export async function projectSelectedOutputShareCandidate(selection: unknown, nativeDto: unknown,
  review: unknown, now = Date.now()): Promise<SelectedOutputShareCandidate | null> {
  try {
    // Refuse every unsupported output before examining its private DTO.
    const selected = parseSelectedOutputShareSelection(selection);
    const choices = reviewChoices(review, now);
    if (!selected || !choices) return null;
    const projected = nativeProjection(selected, nativeDto, choices, now);
    if (!projected) return null;
    const { publicOutput, sourceExpiresAt } = projected;
    const requestedExpiry = timestamp(choices.expiresAt)!;
    const retainedExpiry = timestamp(sourceExpiresAt);
    // The reviewed expiry must be the actual expiry: no silent clamping or
    // extension of the underlying retained source lifetime.
    if (retainedExpiry === null || requestedExpiry > retainedExpiry) return null;
    const captured = immutable<Omit<SelectedOutputShareCandidate, "candidateSha256">>({ schemaVersion: 1, kind: "selected-output-share-candidate",
      purpose: SELECTED_OUTPUT_SHARE_PURPOSE, selection: selected, sourceExpiresAt, publicOutput });
    const serialized = JSON.stringify(captured);
    if (encoder.encode(JSON.stringify({ ...captured, candidateSha256: "0".repeat(64) })).length > SELECTED_OUTPUT_SHARE_JSON_MAX_BYTES) return null;
    const candidateSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(serialized))),
      byte => byte.toString(16).padStart(2, "0")).join("");
    return Object.freeze({ ...captured, candidateSha256 });
  } catch { return null; }
}

/** Closed recipient-data parser, not an authorization or source witness. It
 * reuses native text/Slides validation with a local structural placeholder;
 * that placeholder is never returned or used to resolve a real Document.
 */
export function validateSelectedOutputSharePublicOutput(value: unknown, now = Date.now()): SelectedOutputSharePublicOutput | null {
  try {
    const captured = fields(captureData(value), ["schemaVersion", "kind", "output", "title", "expiresAt", "attribution", "content"]);
    if (!captured || captured.schemaVersion !== 1 || captured.kind !== "selected-output-read" || captured.attribution !== "Forma") return null;
    const choices = reviewChoices({ title: captured.title, expiresAt: captured.expiresAt }, now);
    const selected = parseSelectedOutputShareSelection({ output: captured.output, documentId: "public-data-shape",
      artifactId: "public-data-shape", revision: 0, contentSha256: "0".repeat(64) });
    if (!choices || !selected) return null;
    const { output, ...selection } = selected;
    const base = { schemaVersion: 1, selection, title: choices.title, expiresAt: choices.expiresAt };
    let nativeDto: unknown;
    if (output === "short_story") {
      const content = fields(captured.content, ["text"]);
      if (!content) return null;
      nativeDto = { ...base, kind: "native-retained-short-story", contentMarkdown: content.text };
    } else if (output === "scene") {
      const content = fields(captured.content, ["text", "medium"]);
      if (!content) return null;
      nativeDto = { ...base, kind: "native-retained-output", output, content: { content_markdown: content.text, medium: content.medium } };
    } else {
      const content = fields(captured.content, ["items", "presentation"]);
      if (!content || !Array.isArray(content.items) || content.items.length > 100) return null;
      const items = content.items.map(rawItem => {
        const item = fields(rawItem, ["title", "body", "slide"]);
        if (!item) throw new TypeError("Invalid public slide");
        let slide: unknown = null;
        if (item.slide !== null) {
          const visual = fields(item.slide, ["layout", "kicker", "bullets", "visual"], ["quote", "citations", "section"]);
          if (!visual) throw new TypeError("Invalid public slide");
          if (Object.hasOwn(visual, "citations")) {
            if (!Array.isArray(visual.citations) || visual.citations.length > 100) throw new TypeError("Invalid public citations");
            visual.citations = visual.citations.map(value => {
              const citation = fields(value, ["label", "anchor"]);
              if (!citation) throw new TypeError("Invalid public citation");
              return { label: citation.label, anchor: citation.anchor, excerpt: "" };
            });
          }
          slide = visual;
        }
        return { title: item.title, body: item.body, notes: "", image_prompt: "", slide };
      });
      nativeDto = { ...base, kind: "native-retained-output", output, content: { items, presentation: content.presentation } };
    }
    const projected = nativeProjection(selected, nativeDto, choices, now);
    return projected ? immutable(projected.publicOutput) : null;
  } catch { return null; }
}

/** Decode deliberate read-share approval for the caller's freshly derived
 * candidate. This checks the approval shape/digest only; it neither verifies
 * an arbitrary expected candidate nor establishes publishing authorization.
 */
export function parseSelectedOutputShareApproval(value: unknown, expectedCandidate: SelectedOutputShareCandidate): SelectedOutputShareApproval | null {
  try {
    const expected = fields(expectedCandidate, candidateKeys);
    const approval = fields(value, ["purpose", "candidateSha256", "allowPublicRead"]);
    if (!expected || expected.schemaVersion !== 1 || expected.kind !== "selected-output-share-candidate"
      || expected.purpose !== SELECTED_OUTPUT_SHARE_PURPOSE || typeof expected.candidateSha256 !== "string" || !digest.test(expected.candidateSha256)
      || !approval || approval.purpose !== SELECTED_OUTPUT_SHARE_PURPOSE || approval.allowPublicRead !== true
      || approval.candidateSha256 !== expected.candidateSha256) return null;
    return Object.freeze({ purpose: SELECTED_OUTPUT_SHARE_PURPOSE, candidateSha256: expected.candidateSha256, allowPublicRead: true });
  } catch { return null; }
}
