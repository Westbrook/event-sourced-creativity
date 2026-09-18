import { PCM_WAV_EDIT_MAX_BYTES, inspectPcmWav } from "./audio-container.ts";

export const AUDIO_LOCAL_CONVERSION_METHOD = "browser-decode-pcm16-v1" as const;
export const AUDIO_LOCAL_CONVERSION_MEDIA_TYPE = "application/vnd.forma.audio-converted-trim+json";
export const AUDIO_LOCAL_CONVERSION_MAX_SECONDS = 180;
export const AUDIO_LOCAL_CONVERSION_WIRE_MAX_BYTES = Math.ceil(PCM_WAV_EDIT_MAX_BYTES / 3) * 4 + 8192;

export type AudioLocalConversion = Readonly<{
  method: typeof AUDIO_LOCAL_CONVERSION_METHOD; provenance: "client-local";
  sourceMediaType: "audio/mpeg"; sourceByteLength: number;
  decodedMediaSha256: string; decodedByteLength: number;
  sampleRate: number; channels: 1 | 2; frameCount: number;
}>;
export type AudioTrimOperationRequest = {
  expectedRevision: number; expectedContentSha256: string;
  audioTrim: { sourceMediaSha256: string; sourceFrameCount: number; startFrame: number; endFrame: number; resultMediaSha256: string; conversion?: AudioLocalConversion };
};
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== "string" || !keys.includes(key) && !optional.includes(key)) || keys.some(key => !own.includes(key))) return null;
  const result: Record<string, unknown> = {};
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    result[key] = descriptor.value;
  }
  return result;
}

/** Describes an explicitly adopted browser-local conversion, never a server-certified decode. */
export function parseAudioLocalConversion(value: unknown): AudioLocalConversion | null {
  try {
    const row = record(value, ["method", "provenance", "sourceMediaType", "sourceByteLength", "decodedMediaSha256", "decodedByteLength", "sampleRate", "channels", "frameCount"]);
    if (!row || row.method !== AUDIO_LOCAL_CONVERSION_METHOD || row.provenance !== "client-local" || row.sourceMediaType !== "audio/mpeg"
      || !integer(row.sourceByteLength, 8, PCM_WAV_EDIT_MAX_BYTES) || !hash(row.decodedMediaSha256)
      || !integer(row.sampleRate, 8000, 96000) || row.channels !== 1 && row.channels !== 2
      || !integer(row.frameCount, 1) || !integer(row.decodedByteLength, 46, PCM_WAV_EDIT_MAX_BYTES)
      || row.decodedByteLength !== 44 + row.frameCount * row.channels * 2
      || row.frameCount / row.sampleRate > AUDIO_LOCAL_CONVERSION_MAX_SECONDS) return null;
    return Object.freeze({ method: AUDIO_LOCAL_CONVERSION_METHOD, provenance: "client-local", sourceMediaType: "audio/mpeg",
      sourceByteLength: row.sourceByteLength, decodedMediaSha256: row.decodedMediaSha256, decodedByteLength: row.decodedByteLength,
      sampleRate: row.sampleRate, channels: row.channels, frameCount: row.frameCount });
  } catch { return null; }
}

export function parseAudioTrimOperationRequest(value: unknown): AudioTrimOperationRequest | null {
  try {
    const row = record(value, ["expectedRevision", "expectedContentSha256", "audioTrim"]);
    const trim = row && record(row.audioTrim, ["sourceMediaSha256", "sourceFrameCount", "startFrame", "endFrame", "resultMediaSha256"], ["conversion"]);
    if (!row || !trim || !integer(row.expectedRevision, 0) || !hash(row.expectedContentSha256)
      || !hash(trim.sourceMediaSha256) || !hash(trim.resultMediaSha256) || !integer(trim.sourceFrameCount, 1)
      || !integer(trim.startFrame, 0) || !integer(trim.endFrame, 1)
      || trim.startFrame >= trim.endFrame || trim.endFrame > trim.sourceFrameCount) return null;
    const converted = Object.hasOwn(trim, "conversion"), conversion = converted ? parseAudioLocalConversion(trim.conversion) : null;
    if (converted && (!conversion || conversion.frameCount !== trim.sourceFrameCount)) return null;
    return { expectedRevision: row.expectedRevision, expectedContentSha256: row.expectedContentSha256,
      audioTrim: { sourceMediaSha256: trim.sourceMediaSha256, sourceFrameCount: trim.sourceFrameCount,
        startFrame: trim.startFrame, endFrame: trim.endFrame, resultMediaSha256: trim.resultMediaSha256,
        ...(conversion ? { conversion } : {}) } };
  } catch { return null; }
}

export function audioTrimOperationFingerprintInput(value: unknown): string | null {
  const request = parseAudioTrimOperationRequest(value);
  return request ? JSON.stringify(request) : null;
}

/** The private wire carries PCM source bytes; the retained operation keeps only their exact digest. */
export function encodeAudioConversionSource(bytes: Uint8Array): string {
  if (Object.getPrototypeOf(bytes) !== Uint8Array.prototype || bytes.byteLength > PCM_WAV_EDIT_MAX_BYTES || !inspectPcmWav(bytes)) throw new TypeError("audio_conversion_invalid");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
export function decodeAudioConversionSource(value: unknown, conversion: AudioLocalConversion): Uint8Array | null {
  if (typeof value !== "string" || value.length !== Math.ceil(conversion.decodedByteLength / 3) * 4
    || /[^A-Za-z0-9+/=]/u.test(value)) return null;
  try {
    const binary = atob(value); if (binary.length !== conversion.decodedByteLength || btoa(binary) !== value) return null;
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0)), info = inspectPcmWav(bytes);
    if (!info || info.sampleRate !== conversion.sampleRate || info.channels !== conversion.channels || info.frameCount !== conversion.frameCount) { bytes.fill(0); return null; }
    return bytes;
  } catch { return null; }
}

/** Fatal UTF-8 and observed byte bounds apply before parsing the private PCM wire. */
export async function readAudioConversionWire(request: Request): Promise<{ request: AudioTrimOperationRequest; bytes: Uint8Array } | null> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(length) || Number(length) > AUDIO_LOCAL_CONVERSION_WIRE_MAX_BYTES)) return null;
  if (request.headers.get("content-type") !== AUDIO_LOCAL_CONVERSION_MEDIA_TYPE || !request.body) return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0, complete = false, active = true, timer: ReturnType<typeof setTimeout> | undefined;
  const operation = (async () => {
    while (true) {
      const next = await reader.read(); if (!active) return null; if (next.done) { complete = true; break; }
      if (!(next.value instanceof Uint8Array) || chunks.length >= 65536 || total + next.value.byteLength > AUDIO_LOCAL_CONVERSION_WIRE_MAX_BYTES) return null;
      chunks.push(new Uint8Array(next.value)); total += next.value.byteLength;
    }
    if (length !== null && Number(length) !== total) return null;
    const joined = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)); }
    finally { joined.fill(0); }
    const wire = record(value, ["operation", "convertedAudioSource"]), parsed = wire && parseAudioTrimOperationRequest(wire.operation);
    if (!parsed?.audioTrim.conversion) return null;
    const bytes = decodeAudioConversionSource(wire!.convertedAudioSource, parsed.audioTrim.conversion);
    return bytes ? { request: parsed, bytes } : null;
  })();
  void operation.catch(() => {});
  try {
    return await Promise.race([operation, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 30000); })]);
  } catch { return null; }
  finally {
    active = false; clearTimeout(timer);
    if (!complete) { try { void reader.cancel().catch(() => {}); } catch { /* Best effort, never awaited. */ } }
    try { reader.releaseLock(); } catch { /* Pending read remains observed. */ }
    for (const chunk of chunks) chunk.fill(0);
  }
}
