import { qualifySelectedOutputShareAudio, copySelectedOutputShareAudioBytes, type QualifiedSelectedOutputShareAudio } from "../src/model/selected-output-share-audio.ts";
import { parseAudioShareMp3Envelope } from "./audio-share-mp3-envelope.ts";
import { acquireMp3ShareDecoder, MPG123_SHARE_DECODER_SHA256, type Mp3DecoderLease } from "./vendor/mpg123/loader.ts";

/** Dormant decoded representation; neither native custody nor publishing authority. */
export const SELECTED_OUTPUT_SHARE_MP3_PROJECTION = "selected-output-share-stable-mp3-pcm16-v1" as const;
export const SELECTED_OUTPUT_SHARE_MP3_PROJECTION_LIMITS = Object.freeze({ sourceBytes: 1_000_000, seconds: 20,
  maximumSampleRate: 48_000, channels: 2, framesPerYield: 16, deadlineMs: 5_000, publicBytes: 3_840_044 });
export type SelectedOutputShareMp3Expected = Readonly<{ sha256: string; byteLength: number; mimeType: "audio/mpeg"; recipe: "forma.audio.instrumental-20@1" }>;
declare const projectedMp3: unique symbol;
export type ProjectedSelectedOutputShareMp3 = Readonly<{ [projectedMp3]: true; status: "projected";
  projection: typeof SELECTED_OUTPUT_SHARE_MP3_PROJECTION; decoderSha256: typeof MPG123_SHARE_DECODER_SHA256;
  sourceSha256: string; sourceByteLength: number; sourceMimeType: "audio/mpeg";
  sha256: string; byteLength: number; mimeType: "audio/wav"; sampleRate: number; channels: 1 | 2;
  sampleCount: number; durationSeconds: number; durationBasis: "pcm-samples";
}>;
export type SelectedOutputShareMp3Refusal = "invalid_input" | "busy" | "source_mismatch" | "unsupported_mp3" | "decode_failed" | "cancelled" | "timeout" | "decoder_unavailable";
export type SelectedOutputShareMp3Projection = ProjectedSelectedOutputShareMp3 | Readonly<{ status: "unqualified";
  projection: typeof SELECTED_OUTPUT_SHARE_MP3_PROJECTION; reason: SelectedOutputShareMp3Refusal }>;
const owned = new WeakMap<ProjectedSelectedOutputShareMp3, QualifiedSelectedOutputShareAudio>();
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")!.get!;
const arrayLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const intrinsicSet = Uint8Array.prototype.set;
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
const addEvent = EventTarget.prototype.addEventListener, removeEvent = EventTarget.prototype.removeEventListener;
const expectedKeys = ["sha256", "byteLength", "mimeType", "recipe"];
let projecting = false;
function facts(value: unknown): SelectedOutputShareMp3Expected | null {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== expectedKeys.length || expectedKeys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], "value"))) return null;
  const sha256 = descriptors.sha256!.value, byteLength = descriptors.byteLength!.value;
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256) || !Number.isSafeInteger(byteLength) || byteLength < 1
    || byteLength > SELECTED_OUTPUT_SHARE_MP3_PROJECTION_LIMITS.sourceBytes || descriptors.mimeType!.value !== "audio/mpeg"
    || descriptors.recipe!.value !== "forma.audio.instrumental-20@1") return null;
  return Object.freeze({ sha256, byteLength, mimeType: "audio/mpeg", recipe: "forma.audio.instrumental-20@1" });
}
function capture(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Uint8Array.prototype) return null;
  const length = typedLength.call(value); arrayLength.call(typedBuffer.call(value));
  if (!Number.isSafeInteger(length) || length < 1 || length > SELECTED_OUTPUT_SHARE_MP3_PROJECTION_LIMITS.sourceBytes) return null;
  const copy = new Uint8Array(length); intrinsicSet.call(copy, value as Uint8Array); return copy;
}
const sha = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
function makeWav(frames: number, rate: number, channels: 1 | 2): Uint8Array<ArrayBuffer> {
  const length = 44 + frames * channels * 2;
  if (!Number.isSafeInteger(length) || length < 46 || length > SELECTED_OUTPUT_SHARE_MP3_PROJECTION_LIMITS.publicBytes) throw new Error("decode_failed");
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46464952, true); view.setUint32(4, length - 8, true); view.setUint32(8, 0x45564157, true);
  view.setUint32(12, 0x20746d66, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  view.setUint32(36, 0x61746164, true); view.setUint32(40, length - 44, true); return bytes;
}
/** PCM16 v1 preserves decoder samples with fixed quantization; overshoot refuses. */
function pcm16(sample: number): number {
  if (!Number.isFinite(sample) || sample < -1 || sample > 1) throw new Error("decode_failed");
  return Math.round(sample * (sample < 0 ? 32768 : 32767));
}

/** Exact owned source -> owned public WAV. Host must separately establish current
 * native custody and recheck it before publication/serving. No Request, client
 * PCM, arbitrary decoder, source storage, provider or sharing route is accepted.
 */
export async function projectSelectedOutputShareMp3(input: unknown, expected: unknown, signal: AbortSignal): Promise<SelectedOutputShareMp3Projection> {
  const refusal = (reason: SelectedOutputShareMp3Refusal): SelectedOutputShareMp3Projection => Object.freeze({ status: "unqualified", projection: SELECTED_OUTPUT_SHARE_MP3_PROJECTION, reason });
  if (projecting) return refusal("busy");
  projecting = true;
  let source: Uint8Array<ArrayBuffer> | null = null, wav: Uint8Array<ArrayBuffer> | null = null, decoder: Mp3DecoderLease | null = null;
  let stopped: "cancelled" | "timeout" | null = null, timer: ReturnType<typeof setTimeout> | undefined, listening = false;
  let rejectStopped: (reason: Error) => void = () => {};
  const stop = (reason: "cancelled" | "timeout") => { if (!stopped) { stopped = reason; rejectStopped(new Error(reason)); } };
  const onAbort = () => stop("cancelled");
  try {
    let expectedFacts: SelectedOutputShareMp3Expected | null;
    try { expectedFacts = facts(expected); } catch { return refusal("invalid_input"); }
    if (!expectedFacts) return refusal("invalid_input");
    let alreadyAborted: boolean;
    try { alreadyAborted = signalAborted.call(signal); } catch { return refusal("invalid_input"); }
    if (alreadyAborted) return refusal("cancelled");
    try { source = capture(input); } catch { return refusal("invalid_input"); }
    if (!source) return refusal("invalid_input");
    if (source.length !== expectedFacts.byteLength) return refusal("source_mismatch");
    const interrupted = new Promise<never>((_, reject) => { rejectStopped = reject; }); void interrupted.catch(() => {});
    addEvent.call(signal, "abort", onAbort, { once: true }); listening = true;
    timer = setTimeout(() => stop("timeout"), SELECTED_OUTPUT_SHARE_MP3_PROJECTION_LIMITS.deadlineMs);
    const check = () => { if (signalAborted.call(signal)) stop("cancelled"); if (stopped) throw new Error(stopped); };
    const wait = async <T>(pending: Promise<T>): Promise<T> => { check(); const value = await Promise.race([pending, interrupted]); check(); return value; };
    if (await wait(sha(source)) !== expectedFacts.sha256) return refusal("source_mismatch");
    const envelope = parseAudioShareMp3Envelope(source);
    if (!envelope.ok) return refusal("unsupported_mp3");
    decoder = acquireMp3ShareDecoder(); if (!decoder) return refusal("decoder_unavailable");
    wav = makeWav(envelope.outputSamples, envelope.sampleRate, envelope.channels);
    const view = new DataView(wav.buffer); let samples = 0;
    for (let index = 0; index < envelope.frames.length; index++) {
      check(); const frame = envelope.frames[index]!;
      const decoded = decoder.frame(source.subarray(frame.offset, frame.offset + frame.length), (left, right) => {
        if (samples >= envelope.outputSamples || envelope.channels === 1 && left !== right) throw new Error("decode_failed");
        const offset = 44 + samples * envelope.channels * 2;
        view.setInt16(offset, pcm16(left), true); if (envelope.channels === 2) view.setInt16(offset + 2, pcm16(right), true); samples++;
      });
      if (decoded.samples && decoded.rate !== envelope.sampleRate || decoded.done && index !== envelope.frames.length - 1) throw new Error("decode_failed");
      if ((index + 1) % SELECTED_OUTPUT_SHARE_MP3_PROJECTION_LIMITS.framesPerYield === 0) await wait(new Promise<void>(resolve => setTimeout(resolve, 0)));
    }
    if (samples !== envelope.outputSamples) throw new Error("decode_failed");
    // No native state spans the expensive qualification/digest awaits.
    decoder.close(); decoder = null;
    const digest = await wait(sha(wav));
    const qualified = await wait(qualifySelectedOutputShareAudio(wav, { sha256: digest, byteLength: wav.length, mimeType: "audio/wav" }));
    if (qualified.status !== "qualified") return refusal("decode_failed");
    const result = Object.freeze({ status: "projected", projection: SELECTED_OUTPUT_SHARE_MP3_PROJECTION,
      decoderSha256: MPG123_SHARE_DECODER_SHA256, sourceSha256: expectedFacts.sha256, sourceByteLength: source.length, sourceMimeType: "audio/mpeg",
      sha256: digest, byteLength: wav.length, mimeType: "audio/wav", sampleRate: envelope.sampleRate, channels: envelope.channels,
      sampleCount: samples, durationSeconds: samples / envelope.sampleRate, durationBasis: "pcm-samples" }) as ProjectedSelectedOutputShareMp3;
    owned.set(result, qualified); return result;
  } catch { return refusal(stopped ?? "decode_failed"); }
  finally {
    clearTimeout(timer); if (listening) removeEvent.call(signal, "abort", onAbort);
    decoder?.close(); source?.fill(0); wav?.fill(0); projecting = false;
  }
}
/** A copy from this exact local witness only; it conveys no publishing right. */
export function copySelectedOutputShareMp3Bytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (!value || typeof value !== "object") return null;
  const qualified = owned.get(value as ProjectedSelectedOutputShareMp3);
  return qualified ? copySelectedOutputShareAudioBytes(qualified) : null;
}
