import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES } from "./output-asset-inspection.ts";

/** Exact-byte container qualification only; never source or publishing authority. */
export const SELECTED_OUTPUT_SHARE_AUDIO_POLICY = "selected-output-share-audio-v1" as const;
export const SELECTED_OUTPUT_SHARE_AUDIO_LIMITS = Object.freeze({ bytes: MAX_OUTPUT_ASSET_BYTES, chunks: 2 });
type AudioMime = "audio/wav" | "audio/mpeg";
export type SelectedOutputShareAudioExpected = Readonly<{ sha256: string; byteLength: number; mimeType: AudioMime }>;
export type SelectedOutputShareAudioRefusal = "invalid_input" | "unsupported_audio" | "unqualified_metadata" | "invalid_audio" | "selection_mismatch";
declare const audioQualification: unique symbol;
export type QualifiedSelectedOutputShareAudio = Readonly<{
  [audioQualification]: true;
  status: "qualified";
  policy: typeof SELECTED_OUTPUT_SHARE_AUDIO_POLICY;
  mimeType: "audio/wav";
  sha256: string;
  byteLength: number;
  sampleRate: number;
  channels: number;
  sampleCount: number;
  durationSeconds: number;
  durationBasis: "pcm-samples";
}>;
export type SelectedOutputShareAudioQualification = QualifiedSelectedOutputShareAudio
  | Readonly<{ status: "unqualified"; policy: typeof SELECTED_OUTPUT_SHARE_AUDIO_POLICY; reason: SelectedOutputShareAudioRefusal }>;

const ownedAudio = new WeakMap<QualifiedSelectedOutputShareAudio, Uint8Array<ArrayBuffer>>();
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const setBytes = Uint8Array.prototype.set;
const expectedKeys = ["sha256", "byteLength", "mimeType"] as const;
function expectedFacts(value: unknown): SelectedOutputShareAudioExpected | null {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype
    && Object.getPrototypeOf(value) !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== "string" || !expectedKeys.includes(key as typeof expectedKeys[number]))) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of expectedKeys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, "value") || !field.enumerable) return null;
    result[key] = field.value;
  }
  if (typeof result.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(result.sha256)
    || typeof result.byteLength !== "number" || !Number.isSafeInteger(result.byteLength)
    || result.byteLength < 1 || result.byteLength > SELECTED_OUTPUT_SHARE_AUDIO_LIMITS.bytes
    || result.mimeType !== "audio/wav" && result.mimeType !== "audio/mpeg") return null;
  return Object.freeze({ sha256: result.sha256, byteLength: result.byteLength, mimeType: result.mimeType });
}
function captureBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Uint8Array.prototype) return null;
  const length = typedLength.call(value) as number;
  bufferLength.call(typedBuffer.call(value)); // Reject shared memory and proxy impostors.
  if (!length || length > SELECTED_OUTPUT_SHARE_AUDIO_LIMITS.bytes) return null;
  const copy = new Uint8Array(length);
  setBytes.call(copy, value as Uint8Array);
  return copy;
}
const ascii = (bytes: Uint8Array, offset: number, length = 4) => String.fromCharCode(...bytes.subarray(offset, offset + length));

/** PCM fmt followed by exactly one data chunk. Even RIFF padding is closed. */
function publicWav(bytes: Uint8Array): SelectedOutputShareAudioRefusal | null {
  if (bytes.length < 44 || ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WAVE") return "unsupported_audio";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== bytes.length - 8) return "invalid_audio";
  let cursor = 12, count = 0;
  while (cursor + 8 <= bytes.length) {
    const type = ascii(bytes, cursor), length = view.getUint32(cursor + 4, true), start = cursor + 8, end = start + length;
    if (end + length % 2 > bytes.length) return "invalid_audio";
    if (length % 2 && bytes[end] !== 0) return "unqualified_metadata";
    if (type === "fmt ") {
      if (count !== 0) return "invalid_audio";
      if (length !== 16 && length !== 18) return "unsupported_audio";
      if (view.getUint16(start, true) !== 1) return "unsupported_audio";
      if (length === 18 && view.getUint16(start + 16, true) !== 0) return "unqualified_metadata";
    } else if (type === "data") {
      if (count !== 1 || !length) return "invalid_audio";
    } else return "unqualified_metadata";
    if (++count > SELECTED_OUTPUT_SHARE_AUDIO_LIMITS.chunks) return "invalid_audio";
    cursor = end + length % 2;
  }
  return count === 2 && cursor === bytes.length ? null : "invalid_audio";
}

/** Capture before any await; bind complete bytes to trusted expected facts.
 * No ownership/revision/consent check, share creation, file transfer or provider
 * call occurs. Samples, audible content, watermarks and steganography are not
 * assessed. Qualification never strips, transcodes or rewrites the recording.
 */
export async function qualifySelectedOutputShareAudio(input: unknown, expected: unknown): Promise<SelectedOutputShareAudioQualification> {
  const refused = (reason: SelectedOutputShareAudioRefusal): SelectedOutputShareAudioQualification =>
    Object.freeze({ status: "unqualified", policy: SELECTED_OUTPUT_SHARE_AUDIO_POLICY, reason });
  let bytes: Uint8Array<ArrayBuffer> | null = null, retained = false;
  try {
    const facts = expectedFacts(expected);
    if (!facts) return refused("invalid_input");
    bytes = captureBytes(input);
    if (!bytes) return refused("invalid_input");
    if (bytes.length !== facts.byteLength) return refused("selection_mismatch");
    // Frame allocation alone cannot prove MP3 entropy consumption. Opaque
    // strings can survive inside declared part2_3_length and decode as silence.
    if (facts.mimeType !== "audio/wav") return refused("unsupported_audio");
    const failure = publicWav(bytes);
    if (failure) return refused(failure);
    const inspection = await inspectOutputAsset(bytes, "audio.wav", { snapshot: false });
    if (inspection.status !== "inspected" || inspection.kind !== "audio" || inspection.mimeType !== facts.mimeType || inspection.extension !== "wav") return refused("invalid_audio");
    if (inspection.sha256 !== facts.sha256 || inspection.byteLength !== facts.byteLength) return refused("selection_mismatch");
    const { sampleRate, channels, sampleCount, durationSeconds, durationBasis } = inspection.facts;
    if (!sampleRate || !channels || !sampleCount || !durationSeconds || durationBasis !== "pcm-samples") return refused("invalid_audio");
    const result = Object.freeze({ status: "qualified", policy: SELECTED_OUTPUT_SHARE_AUDIO_POLICY, ...facts,
      sampleRate, channels, sampleCount, durationSeconds, durationBasis }) as QualifiedSelectedOutputShareAudio;
    ownedAudio.set(result, bytes); retained = true;
    return result;
  } catch { return refused("invalid_input"); }
  finally { if (!retained) bytes?.fill(0); }
}

/** Fresh copy of the locally owned qualified bytes; serialized/forged facts
 * cannot recover bytes. Current source/publication authority remains separate. */
export function copySelectedOutputShareAudioBytes(qualification: unknown): Uint8Array<ArrayBuffer> | null {
  if (qualification === null || typeof qualification !== "object") return null;
  const bytes = ownedAudio.get(qualification as QualifiedSelectedOutputShareAudio);
  return bytes ? new Uint8Array(bytes) : null;
}
