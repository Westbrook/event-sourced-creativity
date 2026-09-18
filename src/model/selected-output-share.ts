import { validateRetainedStoryDto, type RetainedStorySelection } from "./retained-short-story.ts";
import { validateNativeRetainedOutputDto } from "./native-retained-output.ts";
import type { SlidePresentation, SlideVisualData } from "./document-artifacts.ts";

import { parseSelectedOutputShareMediaSelection as parseNativeMediaSelection,
  type SelectedOutputShareMediaSelection as NativeMediaSelection, type SelectedOutputShareExactMediaSelection as ExactMediaSelection,
  type SelectedOutputShareMediaDescriptor as MediaDescriptor } from "./selected-output-share-media.ts";
import { isSelectedOutputShareStableAudioSelection, parseSelectedOutputShareStableAudioSelection,
  selectedOutputShareStableAudioDescriptorMatches, SELECTED_OUTPUT_SHARE_STABLE_AUDIO_PROJECTION_POLICY,
  type SelectedOutputShareStableAudioSelection } from "./selected-output-share-mp3-contract.ts";
import { SELECTED_OUTPUT_SHARE_AUDIO_LIMITS } from "./selected-output-share-audio.ts";
import { SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY } from "./selected-output-share-video.ts";
import { SELECTED_OUTPUT_SHARE_MODEL3D_LIMITS } from "./selected-output-share-model3d.ts";

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

// Media is additive: existing text contracts, projection and digest order above
// stay unchanged. These are closed data shapes, never gate or custody handles.
export const SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY = "selected-output-media-exact-bytes-v1" as const;
export type SelectedOutputShareExactMediaRequestSelection = ExactMediaSelection & Readonly<{
  projectionPolicy: typeof SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY;
}>;
export type SelectedOutputShareMediaRequestSelection = SelectedOutputShareExactMediaRequestSelection | SelectedOutputShareStableAudioSelection;
export type SelectedOutputShareAnySelection = SelectedOutputShareSelection | SelectedOutputShareMediaRequestSelection;
export type SelectedOutputShareMediaDisclosure = Readonly<{ watermark: "synthid-declared" | "not-declared" }>
  | Readonly<{ encoderDeclaration: "x264-163-r3060" | null }> | Readonly<Record<string, never>>;
export type SelectedOutputShareMediaPublicOutput = PublicShareBase & (
  | Readonly<{ output: "audio"; content: Readonly<{ media: Extract<MediaDescriptor, { kind: "audio" }>;
    disclosure: Readonly<{ watermark: "synthid-declared" | "not-declared" }> }> }>
  | Readonly<{ output: "video"; content: Readonly<{ media: Extract<MediaDescriptor, { kind: "video" }>;
    disclosure: Readonly<{ encoderDeclaration: "x264-163-r3060" | null }> }> }>
  | Readonly<{ output: "model3d"; content: Readonly<{ media: Extract<MediaDescriptor, { kind: "model3d" }>;
    disclosure: Readonly<Record<string, never>> }> }>
);
export type SelectedOutputShareAnyPublicOutput = SelectedOutputSharePublicOutput | SelectedOutputShareMediaPublicOutput;
/** Exact-byte policy requires source/public equality. The explicit Stable Audio
 * derivative binds separate MP3 and WAV digests; neither identity proves bytes. */
export type SelectedOutputShareMediaIdentity = Readonly<{
  sourceMediaSha256: string;
  publicMediaSha256: string;
  qualificationPolicy: NativeMediaSelection["policy"];
  projectionPolicy: typeof SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY | typeof SELECTED_OUTPUT_SHARE_STABLE_AUDIO_PROJECTION_POLICY;
}>;
export type SelectedOutputShareMediaCandidate = Readonly<{
  schemaVersion: 1;
  kind: "selected-output-share-candidate";
  purpose: typeof SELECTED_OUTPUT_SHARE_PURPOSE;
  selection: SelectedOutputShareMediaRequestSelection;
  sourceExpiresAt: string;
  mediaIdentity: SelectedOutputShareMediaIdentity;
  publicOutput: SelectedOutputShareMediaPublicOutput;
  candidateSha256: string;
}>;
export type SelectedOutputShareAnyCandidate = SelectedOutputShareCandidate | SelectedOutputShareMediaCandidate;
export type SelectedOutputShareMediaCandidateData = Readonly<{
  descriptor: MediaDescriptor;
  /** Effective native custody expiry, including retained source-revision bounds. */
  sourceExpiresAt: string;
  disclosure: SelectedOutputShareMediaDisclosure;
}>;
const mediaSelectionKeys = [...selectionKeys, "mediaSha256", "policy", "projectionPolicy"] as const;
const mediaCandidateKeys = [...candidateKeys, "mediaIdentity"] as const;
const mediaIdentityKeys = ["sourceMediaSha256", "publicMediaSha256", "qualificationPolicy", "projectionPolicy"] as const;
const mediaDescriptorBaseKeys = ["kind", "mimeType", "sha256", "byteLength"] as const;
const finiteInteger = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const finiteDuration = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 21_600;

/** Capture eight exact-byte fields or nine explicit MP3 derivative fields.
 * Neither declared source identity nor
 * an accepted profile/policy string establishes a native read or public grant. */
export function parseSelectedOutputShareMediaRequestSelection(value: unknown): SelectedOutputShareMediaRequestSelection | null {
  try {
    const derivative = parseSelectedOutputShareStableAudioSelection(value);
    if (derivative) return derivative;
    const captured = fields(value, mediaSelectionKeys);
    if (!captured || captured.projectionPolicy !== SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY) return null;
    const selected = parseNativeMediaSelection({ output: captured.output, documentId: captured.documentId, artifactId: captured.artifactId,
      revision: captured.revision, contentSha256: captured.contentSha256, mediaSha256: captured.mediaSha256, policy: captured.policy });
    if (!selected) return null;
    const result = Object.freeze({ output: selected.output, documentId: selected.documentId, artifactId: selected.artifactId,
      revision: selected.revision, contentSha256: selected.contentSha256, mediaSha256: selected.mediaSha256,
      policy: selected.policy, projectionPolicy: SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY });
    return encoder.encode(JSON.stringify(result)).length <= 1024 ? result as SelectedOutputShareMediaRequestSelection : null;
  } catch { return null; }
}
/** The native reader receives the unchanged seven-field exact selection or
 * the complete nine-field MP3 selection, after explicit policy validation. */
export function selectedOutputShareNativeMediaSelection(value: unknown): NativeMediaSelection | null {
  const selected = parseSelectedOutputShareMediaRequestSelection(value);
  if (!selected) return null;
  if (isSelectedOutputShareStableAudioSelection(selected)) return selected;
  return parseNativeMediaSelection({ output: selected.output, documentId: selected.documentId, artifactId: selected.artifactId,
    revision: selected.revision, contentSha256: selected.contentSha256, mediaSha256: selected.mediaSha256, policy: selected.policy });
}
export function parseSelectedOutputShareAnySelection(value: unknown): SelectedOutputShareAnySelection | null {
  return parseSelectedOutputShareSelection(value) ?? parseSelectedOutputShareMediaRequestSelection(value);
}
/** Functional defaults do not read a private Document, filename or provider prompt. */
export function selectedOutputShareMediaDefaultTitle(output: NativeMediaSelection["output"]): string {
  if (output === "audio") return "Audio";
  if (output === "video") return "Video";
  if (output === "model3d") return "3D";
  throw new TypeError("Unsupported selected media output");
}

function capturedMediaDescriptor(value: unknown, output: NativeMediaSelection["output"]): MediaDescriptor | null {
  const additional = output === "audio" ? ["sampleRate", "channels", "sampleCount", "durationSeconds", "durationBasis"]
    : output === "video" ? ["width", "height", "durationSeconds"] : [];
  const data = fields(value, [...mediaDescriptorBaseKeys, ...additional]);
  if (!data || data.kind !== output || typeof data.sha256 !== "string" || !digest.test(data.sha256)
    || !finiteInteger(data.byteLength, 1, output === "model3d" ? SELECTED_OUTPUT_SHARE_MODEL3D_LIMITS.bytes : SELECTED_OUTPUT_SHARE_AUDIO_LIMITS.bytes)) return null;
  if (output === "audio") {
    if (data.mimeType !== "audio/wav" || !finiteInteger(data.sampleRate, 8000, 384_000)
      || !finiteInteger(data.channels, 1, 8) || !finiteInteger(data.sampleCount, 1, data.byteLength)
      || !finiteDuration(data.durationSeconds) || data.durationSeconds !== data.sampleCount / data.sampleRate
      || data.durationBasis !== "pcm-samples") return null;
    // PCM may be 8/16/24/32-bit with fmt16 or fmt18. Capture possible container
    // sizes without inventing omitted bit depth or inspecting/copying any bytes.
    const { sampleCount, channels, byteLength } = data;
    if (![1, 2, 3, 4].some(bytesPerSample => {
      const samples = sampleCount * channels * bytesPerSample;
      return [44, 46].some(header => header + samples + samples % 2 === byteLength);
    })) return null;
    return Object.freeze({ kind: "audio", mimeType: "audio/wav", sha256: data.sha256, byteLength: data.byteLength,
      sampleRate: data.sampleRate, channels: data.channels, sampleCount: data.sampleCount,
      durationSeconds: data.durationSeconds, durationBasis: "pcm-samples" });
  }
  if (output === "video") {
    if (data.mimeType !== "video/mp4" || !finiteInteger(data.width, 1, 16_384) || !finiteInteger(data.height, 1, 16_384)
      || !finiteDuration(data.durationSeconds)) return null;
    return Object.freeze({ kind: "video", mimeType: "video/mp4", sha256: data.sha256, byteLength: data.byteLength,
      width: data.width, height: data.height, durationSeconds: data.durationSeconds });
  }
  if (data.mimeType !== "model/gltf-binary") return null;
  return Object.freeze({ kind: "model3d", mimeType: "model/gltf-binary", sha256: data.sha256, byteLength: data.byteLength });
}
function capturedMediaContent(output: NativeMediaSelection["output"], descriptor: unknown,
  disclosure: unknown): SelectedOutputShareMediaPublicOutput["content"] | null {
  const media = capturedMediaDescriptor(descriptor, output);
  if (!media) return null;
  if (media.kind === "audio") {
    const declared = fields(disclosure, ["watermark"]);
    if (!declared || declared.watermark !== "synthid-declared" && declared.watermark !== "not-declared") return null;
    return immutable({ media, disclosure: { watermark: declared.watermark } });
  }
  if (media.kind === "video") {
    const declared = fields(disclosure, ["encoderDeclaration"]);
    if (!declared || declared.encoderDeclaration !== null && declared.encoderDeclaration !== "x264-163-r3060") return null;
    return immutable({ media, disclosure: { encoderDeclaration: declared.encoderDeclaration } });
  }
  return fields(disclosure, []) ? immutable({ media, disclosure: {} }) : null;
}
function capturedMediaIdentity(value: unknown, selected: SelectedOutputShareMediaRequestSelection,
  publicHash: string): SelectedOutputShareMediaIdentity | null {
  const identity = fields(value, mediaIdentityKeys);
  if (!identity || identity.sourceMediaSha256 !== selected.mediaSha256 || identity.publicMediaSha256 !== publicHash
    || !isSelectedOutputShareStableAudioSelection(selected) && identity.sourceMediaSha256 !== identity.publicMediaSha256
    || identity.qualificationPolicy !== selected.policy
    || identity.projectionPolicy !== selected.projectionPolicy) return null;
  return Object.freeze({ sourceMediaSha256: selected.mediaSha256, publicMediaSha256: publicHash,
    qualificationPolicy: selected.policy, projectionPolicy: selected.projectionPolicy });
}
function mediaDisclosureMatches(selected: SelectedOutputShareMediaRequestSelection,
  content: SelectedOutputShareMediaPublicOutput["content"]): boolean {
  return selected.output !== "video" || "encoderDeclaration" in content.disclosure
    && content.disclosure.encoderDeclaration === (selected.policy === SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY ? "x264-163-r3060" : null);
}
function mediaDescriptorMatchesSelection(selected: SelectedOutputShareMediaRequestSelection, descriptor: MediaDescriptor): boolean {
  return isSelectedOutputShareStableAudioSelection(selected)
    ? selectedOutputShareStableAudioDescriptorMatches(descriptor)
    : descriptor.sha256 === selected.mediaSha256;
}

/** DATA projection only: caller-supplied descriptors do not prove actual media,
 * canonical custody, approval or publishing rights. The server must derive data
 * exclusively from its current opaque native byte proof, then rejoin authority.
 * This function copies no file buffer and implements no byte transformation. */
export async function projectSelectedOutputShareMediaCandidate(selection: unknown, data: unknown,
  review: unknown, now = Date.now()): Promise<SelectedOutputShareMediaCandidate | null> {
  try {
    const selected = parseSelectedOutputShareMediaRequestSelection(selection), choices = reviewChoices(review, now);
    if (!selected || !choices) return null;
    const captured = fields(data, ["descriptor", "sourceExpiresAt", "disclosure"]);
    if (!captured) return null;
    const retainedExpiry = timestamp(captured.sourceExpiresAt), content = capturedMediaContent(selected.output, captured.descriptor, captured.disclosure);
    if (retainedExpiry === null || timestamp(choices.expiresAt)! > retainedExpiry || !content
      || !mediaDescriptorMatchesSelection(selected, content.media) || !mediaDisclosureMatches(selected, content)) return null;
    const mediaIdentity: SelectedOutputShareMediaIdentity = Object.freeze({ sourceMediaSha256: selected.mediaSha256,
      publicMediaSha256: content.media.sha256, qualificationPolicy: selected.policy, projectionPolicy: selected.projectionPolicy });
    const publicOutput = immutable({ schemaVersion: 1, kind: "selected-output-read", output: selected.output,
      title: choices.title, expiresAt: choices.expiresAt, attribution: "Forma", content }) as SelectedOutputShareMediaPublicOutput;
    const candidate = immutable<Omit<SelectedOutputShareMediaCandidate, "candidateSha256">>({ schemaVersion: 1,
      kind: "selected-output-share-candidate", purpose: SELECTED_OUTPUT_SHARE_PURPOSE, selection: selected,
      sourceExpiresAt: captured.sourceExpiresAt as string, mediaIdentity, publicOutput });
    const serialized = JSON.stringify(candidate);
    if (encoder.encode(JSON.stringify({ ...candidate, candidateSha256: "0".repeat(64) })).length > SELECTED_OUTPUT_SHARE_JSON_MAX_BYTES) return null;
    const candidateSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(serialized))),
      byte => byte.toString(16).padStart(2, "0")).join("");
    return Object.freeze({ ...candidate, candidateSha256 });
  } catch { return null; }
}
/** Recipient data has no private selection, policy, storage URL or filename.
 * This parser only captures its closed finite shape, never access or provenance. */
export function validateSelectedOutputShareMediaPublicOutput(value: unknown, now = Date.now()): SelectedOutputShareMediaPublicOutput | null {
  try {
    const captured = fields(value, ["schemaVersion", "kind", "output", "title", "expiresAt", "attribution", "content"]);
    if (!captured || captured.schemaVersion !== 1 || captured.kind !== "selected-output-read" || captured.attribution !== "Forma"
      || captured.output !== "audio" && captured.output !== "video" && captured.output !== "model3d") return null;
    const choices = reviewChoices({ title: captured.title, expiresAt: captured.expiresAt }, now);
    const data = fields(captured.content, ["media", "disclosure"]);
    const content = data && capturedMediaContent(captured.output, data.media, data.disclosure);
    if (!choices || !content) return null;
    return immutable({ schemaVersion: 1, kind: "selected-output-read", output: captured.output,
      title: choices.title, expiresAt: choices.expiresAt, attribution: "Forma", content }) as SelectedOutputShareMediaPublicOutput;
  } catch { return null; }
}
export function validateSelectedOutputShareAnyPublicOutput(value: unknown, now = Date.now()): SelectedOutputShareAnyPublicOutput | null {
  return validateSelectedOutputShareMediaPublicOutput(value, now) ?? validateSelectedOutputSharePublicOutput(value, now);
}
/** Approval shape/digest only, matching the text API's responsibility. The
 * expected candidate must already have been freshly derived by the authority. */
export function parseSelectedOutputShareMediaApproval(value: unknown,
  expectedCandidate: SelectedOutputShareMediaCandidate): SelectedOutputShareApproval | null {
  try {
    const expected = fields(expectedCandidate, mediaCandidateKeys), approval = fields(value, ["purpose", "candidateSha256", "allowPublicRead"]);
    if (!expected || expected.schemaVersion !== 1 || expected.kind !== "selected-output-share-candidate"
      || expected.purpose !== SELECTED_OUTPUT_SHARE_PURPOSE || typeof expected.candidateSha256 !== "string" || !digest.test(expected.candidateSha256)
      || !approval || approval.purpose !== SELECTED_OUTPUT_SHARE_PURPOSE || approval.allowPublicRead !== true
      || approval.candidateSha256 !== expected.candidateSha256) return null;
    const selected = parseSelectedOutputShareMediaRequestSelection(expected.selection);
    const output = fields(expected.publicOutput, ["schemaVersion", "kind", "output", "title", "expiresAt", "attribution", "content"]);
    const content = output && fields(output.content, ["media", "disclosure"]);
    const media = selected && content && capturedMediaContent(selected.output, content.media, content.disclosure);
    if (!selected || !output || output.output !== selected.output || !media || !mediaDisclosureMatches(selected, media)
      || !mediaDescriptorMatchesSelection(selected, media.media)
      || !capturedMediaIdentity(expected.mediaIdentity, selected, media.media.sha256)) return null;
    return Object.freeze({ purpose: SELECTED_OUTPUT_SHARE_PURPOSE, candidateSha256: expected.candidateSha256, allowPublicRead: true });
  } catch { return null; }
}
export function parseSelectedOutputShareAnyApproval(value: unknown,
  expectedCandidate: SelectedOutputShareAnyCandidate): SelectedOutputShareApproval | null {
  try {
    const expected = fields(expectedCandidate, candidateKeys, ["mediaIdentity"]);
    if (!expected) return null;
    return parseSelectedOutputShareSelection(expected.selection)
      ? parseSelectedOutputShareApproval(value, expectedCandidate as SelectedOutputShareCandidate)
      : parseSelectedOutputShareMediaApproval(value, expectedCandidate as SelectedOutputShareMediaCandidate);
  } catch { return null; }
}
