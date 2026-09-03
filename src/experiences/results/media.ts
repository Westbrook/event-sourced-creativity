/**
 * Syntax and metadata only. No GET, ownership decision, byte inspection, or
 * permission is performed here. A future trusted result owner supplies the
 * expected namespace and retained media manifest. The /api/media route also
 * serves project media: its syntax proves neither personal scope nor custody.
 * A future host must independently establish personal-only delivery authority
 * and exact retained output identity; current GET custody still decides reads.
 */
export const RESULT_IMAGE_MIMES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"] as const);
export const RESULT_AUDIO_MIMES = Object.freeze([
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/wav",
  "audio/x-wav", "audio/wave", "audio/ogg", "audio/flac", "audio/x-flac", "audio/webm",
] as const);
export const RESULT_VIDEO_MIMES = Object.freeze(["video/mp4"] as const);
export const RESULT_MODEL3D_MIMES = Object.freeze(["model/gltf-binary"] as const);
export type ResultImageMime = typeof RESULT_IMAGE_MIMES[number];
export type ResultAudioMime = typeof RESULT_AUDIO_MIMES[number];
export type ResultVideoMime = typeof RESULT_VIDEO_MIMES[number];
export type ResultModel3dMime = typeof RESULT_MODEL3D_MIMES[number];
export type ResultMediaMime = ResultImageMime | ResultAudioMime | ResultVideoMime | ResultModel3dMime;
export type ResultMediaAsset<M extends ResultMediaMime = ResultMediaMime> = {
  url: string; mime: M; sha256: string; bytes: number;
};

// Mirrors the native Output inspection ceiling, not provider request defaults.
// These metadata checks do not replace the native byte/container inspectors.
export const RESULT_ASSET_MAX_BYTES = 24_000_000;
export const RESULT_MODEL3D_MAX_BYTES = 64 * 1024 * 1024;
export const RESULT_MAX_DIMENSION = 16_384;
export const RESULT_MAX_DURATION_SECONDS = 6 * 60 * 60;

export function isResultMediaNamespace(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,512}$/u.test(value) && value !== "." && value !== "..";
}

/**
 * Canonical producers encode the ENTIRE key with encodeURIComponent:
 * /api/media/u-...%2Fgenerated%2F<id>.png. Encoded separators are required;
 * raw separators, alternate encodings and a second decoding are not accepted.
 * The route deliberately has no shared-token or absolute-URL alternative.
 */
export function isResultMediaPathForNamespace(value: unknown, namespace: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096 || !isResultMediaNamespace(namespace)) return false;
  const prefix = "/api/media/";
  if (!value.startsWith(prefix) || /[\p{Cc}\p{Cf}\\?#]/u.test(value)) return false;
  const suffix = value.slice(prefix.length);
  if (!suffix || suffix.includes("/")) return false;
  try {
    const url = new URL(value, "https://forma.invalid");
    if (url.origin !== "https://forma.invalid" || url.pathname !== value || url.search || url.hash || url.username || url.password) return false;
    const key = decodeURIComponent(suffix);
    if (encodeURIComponent(key) !== suffix) return false;
    const segments = key.split("/");
    // Current generated/uploaded keys are ASCII namespace/path/file.
    // Reject percent literals as well as traversal, controls and empty segments.
    return segments.length >= 2 && segments.length <= 16 && segments[0] === namespace
      && segments.every(segment => /^[A-Za-z0-9._-]{1,512}$/u.test(segment) && segment !== "." && segment !== "..");
  } catch { return false; }
}

export function isResultMediaMime(value: unknown): value is ResultMediaMime {
  return typeof value === "string" && (
    (RESULT_IMAGE_MIMES as readonly string[]).includes(value)
    || (RESULT_AUDIO_MIMES as readonly string[]).includes(value)
    || (RESULT_VIDEO_MIMES as readonly string[]).includes(value)
    || (RESULT_MODEL3D_MIMES as readonly string[]).includes(value)
  );
}
