import { AUDIO_ROLES, SAFE_AUDIO_MIME_TYPES, audioPlaybackTiming, type AudioRole, type AudioPlaybackTiming } from "./audio.ts";

export type NativeRetainedAudioContent = Readonly<{
  content_markdown: string;
  lyrics: string;
  role: AudioRole | null;
  media: Readonly<{ url: string; mediaType: string; sha256: string }> | null;
  timing: Readonly<AudioPlaybackTiming> | null;
  synthIdWatermarked: boolean;
  inputRef: string;
}>;
const textLimit = 512_000;
const encoder = new TextEncoder();
const opaque = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const digest = /^[a-f0-9]{64}$/u;
function invalid(): never { throw new TypeError("Invalid native retained Audio"); }
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
function closed(value: unknown, keys: readonly string[]): object {
  const result = record(value), names = Reflect.ownKeys(result);
  if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) invalid();
  for (const key of keys) own(result, key);
  return result;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > textLimit || encoder.encode(value).length > textLimit) invalid();
  return value;
}
export function nativeRetainedAudioMediaUrl(value: unknown): string | null {
  try {
    if (typeof value !== "string" || value.length > 2048 || !/^\/api\/media\/(?:[A-Za-z0-9._~!'()*-]|%[A-Fa-f0-9]{2})+$/u.test(value)) return null;
    const segment = value.slice("/api/media/".length), key = decodeURIComponent(segment);
    if (!key || encodeURIComponent(key) !== segment || key.split("/").some(part => part === "." || part === "..")) return null;
    for (let index = 0; index < key.length; index++) {
      const code = key.charCodeAt(index);
      if (code < 0x20 || code === 0x7f || code === 0x5c) return null;
    }
    return value;
  } catch { return null; }
}
function media(value: unknown): NativeRetainedAudioContent["media"] {
  if (value === null) return null;
  const row = closed(value, ["url", "mediaType", "sha256"]);
  const url = nativeRetainedAudioMediaUrl(own(row, "url"));
  const mediaType = own(row, "mediaType"), sha256 = own(row, "sha256");
  if (!url || typeof mediaType !== "string" || !(SAFE_AUDIO_MIME_TYPES as readonly string[]).includes(mediaType)
    || typeof sha256 !== "string" || !digest.test(sha256)) invalid();
  return Object.freeze({ url, mediaType, sha256 });
}
export function captureNativeRetainedAudioMedia(value: unknown): NativeRetainedAudioContent["media"] {
  try { return media(value); } catch { return null; }
}
function timing(value: unknown): NativeRetainedAudioContent["timing"] {
  if (value === null) return null;
  const row = closed(value, ["seconds", "basis"]), seconds = own(row, "seconds"), basis = own(row, "basis");
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0
    || basis !== "measured" && basis !== "estimate" && basis !== "recorded") invalid();
  return Object.freeze({ seconds, basis });
}
function finish(markdown: unknown, lyrics: unknown, role: unknown, retainedMedia: unknown,
  retainedTiming: unknown, watermark: unknown, inputRef: unknown): NativeRetainedAudioContent {
  if (role !== null && (typeof role !== "string" || !(AUDIO_ROLES as readonly string[]).includes(role))) invalid();
  if (typeof watermark !== "boolean" || typeof inputRef !== "string" || !opaque.test(inputRef)) invalid();
  const selectedMedia = media(retainedMedia), selectedTiming = timing(retainedTiming);
  if (!selectedMedia && selectedTiming) invalid();
  return Object.freeze({ content_markdown: text(markdown), lyrics: text(lyrics), role: role as AudioRole | null,
    media: selectedMedia, timing: selectedTiming, synthIdWatermarked: watermark, inputRef });
}

// The enclosing native projector first captures bounded JSON. Only the exact
// completion envelope supplies media; prose and an input plan never imply a file.
export function projectNativeRetainedAudio(markdown: unknown, receipt: unknown): NativeRetainedAudioContent | null {
  try {
    const row = record(receipt);
    if (own(row, "artifact_kind") !== "audio") invalid();
    const settings = record(own(row, "settings")), url = own(row, "media_url"), mime = own(row, "media_type");
    const hash = own(settings, "source_media_sha256", false);
    let retainedMedia: NativeRetainedAudioContent["media"] = null;
    if (url !== null || mime !== null) retainedMedia = media({ url, mediaType: mime, sha256: hash });
    else if (hash !== null && hash !== undefined) invalid();
    const timingProperties: Record<string, unknown> = {};
    for (const key of ["duration_seconds", "estimated_duration_seconds", "duration_basis", "duration_media_url", "duration_media_sha256", "source_media_sha256"])
      if (Object.getOwnPropertyDescriptor(settings, key)) timingProperties[key] = own(settings, key);
    const role = own(settings, "audio_role", false), lyrics = own(settings, "lyrics", false), watermark = own(settings, "audio_synthid_watermarked", false);
    return finish(markdown, lyrics === undefined ? "" : lyrics, role === undefined ? null : role,
      retainedMedia, retainedMedia ? audioPlaybackTiming(timingProperties, retainedMedia.url) : null,
      watermark === undefined ? false : watermark, own(row, "input_ref"));
  } catch { return null; }
}

export function validateNativeRetainedAudio(value: unknown): NativeRetainedAudioContent | null {
  try {
    const row = closed(value, ["content_markdown", "lyrics", "role", "media", "timing", "synthIdWatermarked", "inputRef"]);
    return finish(own(row, "content_markdown"), own(row, "lyrics"), own(row, "role"), own(row, "media"),
      own(row, "timing"), own(row, "synthIdWatermarked"), own(row, "inputRef"));
  } catch { return null; }
}
