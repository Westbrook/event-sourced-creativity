import { inspectPcmWav, PCM_WAV_EDIT_MAX_BYTES, verifiedAudioTiming } from "./audio-container.ts";
import { AUDIO_LOCAL_CONVERSION_MAX_SECONDS, AUDIO_LOCAL_CONVERSION_METHOD, parseAudioLocalConversion, type AudioLocalConversion } from "./audio-local-conversion.ts";

export type PreparedLocalAudioConversion = Readonly<{ bytes: Uint8Array; conversion: AudioLocalConversion }>;
const sha = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), byte => byte.toString(16).padStart(2, "0")).join("");

/** A new canonical PCM16 container from a browser-decoded buffer, not a bit-preserving MPEG transformation. */
export function encodeBrowserPcm16(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  if (!Array.isArray(channels) || channels.length !== 1 && channels.length !== 2
    || !Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new TypeError("audio_conversion_unsupported");
  const frameCount = channels[0]?.length;
  if (!Number.isSafeInteger(frameCount) || !frameCount || frameCount / sampleRate > AUDIO_LOCAL_CONVERSION_MAX_SECONDS
    || 44 + frameCount * channels.length * 2 > PCM_WAV_EDIT_MAX_BYTES
    || channels.some(channel => Object.getPrototypeOf(channel) !== Float32Array.prototype || channel.length !== frameCount)) throw new TypeError("audio_conversion_unsupported");
  const bytes = new Uint8Array(44 + frameCount * channels.length * 2), view = new DataView(bytes.buffer), blockAlign = channels.length * 2;
  view.setUint32(0, 0x46464952, true); view.setUint32(4, bytes.length - 8, true); view.setUint32(8, 0x45564157, true);
  view.setUint32(12, 0x20746d66, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
  view.setUint32(36, 0x61746164, true); view.setUint32(40, bytes.length - 44, true);
  try {
    for (let frame = 0; frame < frameCount; frame++) for (let channel = 0; channel < channels.length; channel++) {
      const sample = channels[channel]![frame]!;
      if (!Number.isFinite(sample)) throw new TypeError("audio_conversion_invalid");
      const bounded = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + frame * blockAlign + channel * 2, Math.round(bounded * (bounded < 0 ? 32768 : 32767)), true);
    }
    if (!inspectPcmWav(bytes)) throw new TypeError("audio_conversion_invalid");
    return bytes;
  } catch (error) { bytes.fill(0); throw error; }
}

/** Explicit local preparation only: never uploads, saves, plays, or modifies the original. */
export async function prepareLocalAudioConversion(original: Uint8Array, expectedSha256: string,
  options: { signal: AbortSignal; current: () => boolean }): Promise<PreparedLocalAudioConversion> {
  if (Object.getPrototypeOf(original) !== Uint8Array.prototype || original.byteLength < 8 || original.byteLength > PCM_WAV_EDIT_MAX_BYTES
    || !/^[a-f0-9]{64}$/u.test(expectedSha256)) throw new TypeError("audio_conversion_unsupported");
  const bytes = new Uint8Array(original), current = () => !options.signal.aborted && options.current();
  let context: AudioContext | null = null, result: Uint8Array | null = null, active = true, timer: ReturnType<typeof setTimeout> | undefined;
  const assertCurrent = () => { if (!active || !current()) throw new Error("audio_conversion_retired"); };
  let rejectAbort: ((reason?: unknown) => void) | null = null;
  const onAbort = () => { active = false; rejectAbort?.(new Error("audio_conversion_retired")); };
  options.signal.addEventListener("abort", onAbort, { once: true });
  const operation = (async () => {
    assertCurrent();
    if (await sha(bytes) !== expectedSha256) throw new Error("audio_conversion_source_changed");
    assertCurrent();
    const timing = verifiedAudioTiming(bytes, "audio/mpeg");
    if (!timing || timing.durationSeconds > AUDIO_LOCAL_CONVERSION_MAX_SECONDS) throw new TypeError("audio_conversion_unsupported");
    if (typeof globalThis.AudioContext !== "function") throw new TypeError("audio_conversion_unsupported");
    context = new AudioContext();
    const decoded = await context.decodeAudioData(bytes.slice().buffer);
    assertCurrent();
    if (decoded.numberOfChannels !== 1 && decoded.numberOfChannels !== 2 || decoded.length / decoded.sampleRate > AUDIO_LOCAL_CONVERSION_MAX_SECONDS
      || 44 + decoded.length * decoded.numberOfChannels * 2 > PCM_WAV_EDIT_MAX_BYTES) throw new TypeError("audio_conversion_unsupported");
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    result = encodeBrowserPcm16(channels, decoded.sampleRate);
    const decodedMediaSha256 = await sha(result); assertCurrent();
    const conversion = parseAudioLocalConversion({ method: AUDIO_LOCAL_CONVERSION_METHOD, provenance: "client-local", sourceMediaType: "audio/mpeg",
      sourceByteLength: bytes.length, decodedMediaSha256, decodedByteLength: result.length, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels, frameCount: decoded.length });
    if (!conversion) throw new TypeError("audio_conversion_invalid");
    return Object.freeze({ bytes: result, conversion });
  })();
  void operation.catch(() => {});
  let returned = false;
  try {
    const value = await Promise.race([operation, new Promise<never>((_, reject) => {
      rejectAbort = reject; timer = setTimeout(() => { active = false; reject(new Error("audio_conversion_timeout")); }, 30000);
      if (options.signal.aborted) onAbort();
    })]);
    assertCurrent(); returned = true; return value;
  } finally {
    active = false; clearTimeout(timer); options.signal.removeEventListener("abort", onAbort); bytes.fill(0);
    if (!returned) (result as Uint8Array | null)?.fill(0);
    // Native close can stall; late decode is observed and cannot regain the lease.
    try { if (context) void (context as AudioContext).close().catch(() => {}); } catch { /* Detached context. */ }
  }
}
