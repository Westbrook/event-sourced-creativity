export type NativeRetainedVideoMedia = Readonly<{ url: string; mediaType: "video/mp4" }>;
export type NativeRetainedVideoClip = Readonly<{
  id: string;
  title: string;
  body: string;
  notes: string;
  /** An exact declared private reference, not a byte-availability or digest claim. */
  media: NativeRetainedVideoMedia | null;
}>;
export type NativeRetainedVideoContent = Readonly<{
  content_markdown: string;
  /** The completion's root reference stays distinct from each scene reference. */
  primaryMedia: NativeRetainedVideoMedia | null;
  clips: readonly NativeRetainedVideoClip[];
}>;

export const NATIVE_RETAINED_VIDEO_CLIPS_MAX = 100;
export const NATIVE_RETAINED_VIDEO_TEXT_MAX_BYTES = 80_000;
export const NATIVE_RETAINED_VIDEO_MARKDOWN_MAX_BYTES = 512_000;
export const NATIVE_RETAINED_VIDEO_JSON_MAX_BYTES = 1_000_000;
const encoder = new TextEncoder();
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

function invalid(): never { throw new TypeError("Invalid native retained Video"); }
function record(value: unknown): object {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  return value;
}
function own(value: object, key: string, required = true): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) { if (required) invalid(); return undefined; }
  if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) invalid();
  return descriptor.value;
}
function closed(value: unknown, required: readonly string[], optional: readonly string[] = []): object {
  const result = record(value), keys = Reflect.ownKeys(result);
  if (keys.length < required.length || keys.length > required.length + optional.length) invalid();
  for (const key of keys) {
    if (typeof key !== "string" || !required.includes(key) && !optional.includes(key)) invalid();
    own(result, key);
  }
  for (const key of required) own(result, key);
  return result;
}
function text(value: unknown, limit = NATIVE_RETAINED_VIDEO_TEXT_MAX_BYTES): string {
  if (typeof value !== "string" || value.length > limit || encoder.encode(value).length > limit) invalid();
  return value;
}
function list(value: unknown, maximum = NATIVE_RETAINED_VIDEO_CLIPS_MAX): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const descriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!descriptor || !Object.hasOwn(descriptor, "value")) invalid();
  const length: unknown = descriptor.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maximum
    || Reflect.ownKeys(value).length !== length + 1) invalid();
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) result.push(own(value, String(index)));
  return result;
}
function privateMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || !/^\/api\/media\/(?:[A-Za-z0-9._~!'()*-]|%[A-Fa-f0-9]{2})+$/u.test(value)) return false;
  const segment = value.slice("/api/media/".length), key = decodeURIComponent(segment);
  if (!key || encodeURIComponent(key) !== segment || key.split("/").some(part => part === "." || part === "..")) return false;
  for (let index = 0; index < key.length; index++) {
    const code = key.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return false;
  }
  return true;
}
function media(value: unknown): NativeRetainedVideoMedia | null {
  if (value === null) return null;
  const row = closed(value, ["url", "mediaType"]), url = own(row, "url"), mediaType = own(row, "mediaType");
  if (!privateMediaUrl(url) || mediaType !== "video/mp4") invalid();
  return Object.freeze({ url, mediaType });
}
function clip(value: unknown, ids: Set<string>): NativeRetainedVideoClip {
  const row = closed(value, ["id", "title", "body", "notes", "media"]), id = own(row, "id");
  if (typeof id !== "string" || !identifier.test(id) || ids.has(id)) invalid();
  ids.add(id);
  return Object.freeze({ id, title: text(own(row, "title")), body: text(own(row, "body")),
    notes: text(own(row, "notes")), media: media(own(row, "media")) });
}
function finish(markdown: unknown, primaryMedia: unknown, values: unknown): NativeRetainedVideoContent {
  const entries = list(values), ids = new Set<string>();
  if (!entries.length) invalid();
  const result = Object.freeze({ content_markdown: text(markdown, NATIVE_RETAINED_VIDEO_MARKDOWN_MAX_BYTES),
    primaryMedia: media(primaryMedia),
    clips: Object.freeze(entries.map(value => clip(value, ids))) });
  // Serialize only the newly constructed, closed data. Escaped bytes count too.
  if (encoder.encode(JSON.stringify(result)).length > NATIVE_RETAINED_VIDEO_JSON_MAX_BYTES) invalid();
  return result;
}
function authoredItem(value: unknown): Readonly<{ title: string; body: string; notes: string }> {
  const row = closed(value, ["title", "body"], ["notes", "image_prompt", "slide", "context_group_ids"]);
  if (Object.getOwnPropertyDescriptor(row, "image_prompt")) text(own(row, "image_prompt"));
  if (Object.getOwnPropertyDescriptor(row, "slide") && own(row, "slide") !== null) invalid();
  if (Object.getOwnPropertyDescriptor(row, "context_group_ids")) {
    for (const id of list(own(row, "context_group_ids"))) text(id);
  }
  return { title: text(own(row, "title")), body: text(own(row, "body")),
    notes: Object.getOwnPropertyDescriptor(row, "notes") ? text(own(row, "notes")) : "" };
}
function receiptMedia(row: object): NativeRetainedVideoMedia | null {
  const url = own(row, "media_url"), mediaType = own(row, "media_type");
  const selected = url === null && mediaType === null ? null : media({ url, mediaType });
  for (const key of ["width", "height"] as const) {
    if (!Object.getOwnPropertyDescriptor(row, key)) continue;
    const dimension = own(row, key);
    if (dimension !== null && (typeof dimension !== "number" || !Number.isSafeInteger(dimension)
      || dimension <= 0 || dimension > 32768 || !selected)) invalid();
  }
  // A managed plan's requested duration is not a measured media duration.
  // Validate a present receipt value, but do not deliver a playback-time claim.
  if (Object.getOwnPropertyDescriptor(row, "duration_seconds")) {
    const duration = own(row, "duration_seconds");
    if (duration !== null && (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0)) invalid();
  }
  return selected;
}

/** NEW native adaptation. The caller captures bounded JSON and binds the exact
 * selected completion, source revision, owner and private-media namespace.
 * Current edits retain their text; immutable completion indices supply IDs and
 * media. No input getter, iterator or serialization hook is invoked. Reflection
 * traps may throw and fail closed. Root media never fills a missing scene file.
 */
export function projectNativeRetainedVideo(rawContentMarkdown: unknown, rawItems: unknown,
  receipt: unknown): NativeRetainedVideoContent | null {
  try {
    const envelope = record(receipt);
    if (own(envelope, "artifact_kind") !== "video") invalid();
    const url = own(envelope, "media_url"), mediaType = own(envelope, "media_type");
    const primaryMedia = url === null && mediaType === null ? null : media({ url, mediaType });
    const authored = list(rawItems), receipts = list(own(envelope, "items")), count = own(envelope, "item_count");
    if (!authored.length || authored.length !== receipts.length || typeof count !== "number"
      || !Number.isSafeInteger(count) || count !== receipts.length) invalid();
    const clips = authored.map((value, index) => {
      const item = authoredItem(value), selected = record(receipts[index]);
      if (Object.getOwnPropertyDescriptor(selected, "title")) text(own(selected, "title"));
      return { id: own(selected, "id"), title: item.title, body: item.body, notes: item.notes, media: receiptMedia(selected) };
    });
    return finish(rawContentMarkdown, primaryMedia, clips);
  } catch { return null; }
}

/** Validate and copy the closed audience content without trusting its prototype. */
export function validateNativeRetainedVideo(content: unknown): NativeRetainedVideoContent | null {
  try {
    const row = closed(content, ["content_markdown", "primaryMedia", "clips"]);
    return finish(own(row, "content_markdown"), own(row, "primaryMedia"), own(row, "clips"));
  } catch { return null; }
}
