import { SELECTED_OUTPUT_SHARE_AUDIO_POLICY } from "./selected-output-share-audio.ts";

/** Closed declarations only. These values grant neither MP3 custody nor byte
 * projection/publication authority; those capabilities belong to the Worker. */
export const SELECTED_OUTPUT_SHARE_STABLE_AUDIO_SOURCE_PROFILE = "forma.audio.instrumental-20.mp3@1" as const;
export const SELECTED_OUTPUT_SHARE_STABLE_AUDIO_PROJECTION_POLICY = "selected-output-share-stable-mp3-pcm16-v1" as const;
export type SelectedOutputShareStableAudioSelection = Readonly<{
  output: "audio";
  documentId: string;
  artifactId: string;
  revision: number;
  contentSha256: string;
  /** The selected MP3 digest, never the derived WAV digest. */
  mediaSha256: string;
  /** The public WAV qualification, not an MP3 qualification. */
  policy: typeof SELECTED_OUTPUT_SHARE_AUDIO_POLICY;
  sourceProfile: typeof SELECTED_OUTPUT_SHARE_STABLE_AUDIO_SOURCE_PROFILE;
  projectionPolicy: typeof SELECTED_OUTPUT_SHARE_STABLE_AUDIO_PROJECTION_POLICY;
}>;
export type SelectedOutputShareStableAudioDescriptor = Readonly<{
  kind: "audio";
  mimeType: "audio/wav";
  sha256: string;
  byteLength: number;
  sampleRate: 32000 | 44100 | 48000;
  channels: 1 | 2;
  sampleCount: number;
  durationSeconds: 20;
  durationBasis: "pcm-samples";
}>;

const selectionKeys = ["output", "documentId", "artifactId", "revision", "contentSha256", "mediaSha256",
  "policy", "sourceProfile", "projectionPolicy"] as const;
const descriptorKeys = ["kind", "mimeType", "sha256", "byteLength", "sampleRate", "channels", "sampleCount",
  "durationSeconds", "durationBasis"] as const;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const digest = /^[a-f0-9]{64}$/u;

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(name => typeof name !== "string" || !keys.includes(name))) return null;
  const captured: Record<string, unknown> = Object.create(null);
  for (const name of keys) {
    const field = Object.getOwnPropertyDescriptor(value, name);
    if (!field?.enumerable || !Object.hasOwn(field, "value")) return null;
    captured[name] = field.value;
  }
  return captured;
}

/** No source fallback, coercion, accessor or serializer is accepted. */
export function parseSelectedOutputShareStableAudioSelection(value: unknown): SelectedOutputShareStableAudioSelection | null {
  try {
    const data = fields(value, selectionKeys);
    if (!data || data.output !== "audio" || data.policy !== SELECTED_OUTPUT_SHARE_AUDIO_POLICY
      || data.sourceProfile !== SELECTED_OUTPUT_SHARE_STABLE_AUDIO_SOURCE_PROFILE
      || data.projectionPolicy !== SELECTED_OUTPUT_SHARE_STABLE_AUDIO_PROJECTION_POLICY
      || ![data.documentId, data.artifactId].every(id => typeof id === "string" && identifier.test(id))
      || typeof data.revision !== "number" || !Number.isSafeInteger(data.revision) || data.revision < 0
      || ![data.contentSha256, data.mediaSha256].every(hash => typeof hash === "string" && digest.test(hash))) return null;
    return Object.freeze({ output: "audio", documentId: data.documentId as string, artifactId: data.artifactId as string,
      revision: data.revision, contentSha256: data.contentSha256 as string, mediaSha256: data.mediaSha256 as string,
      policy: SELECTED_OUTPUT_SHARE_AUDIO_POLICY, sourceProfile: SELECTED_OUTPUT_SHARE_STABLE_AUDIO_SOURCE_PROFILE,
      projectionPolicy: SELECTED_OUTPUT_SHARE_STABLE_AUDIO_PROJECTION_POLICY });
  } catch { return null; }
}

export function isSelectedOutputShareStableAudioSelection(value: unknown): value is SelectedOutputShareStableAudioSelection {
  return parseSelectedOutputShareStableAudioSelection(value) !== null;
}

/** Declared envelope of the sole derivative policy: 44-byte PCM16 WAV, exactly
 * 20 seconds, MPEG-1 rates and mono/stereo. This inspects no bytes and proves no
 * decoding, hash integrity, custody, watermark or permission. */
export function selectedOutputShareStableAudioDescriptorMatches(value: unknown): value is SelectedOutputShareStableAudioDescriptor {
  try {
    const data = fields(value, descriptorKeys);
    return data !== null && data.kind === "audio" && data.mimeType === "audio/wav"
      && typeof data.sha256 === "string" && digest.test(data.sha256)
      && (data.sampleRate === 32000 || data.sampleRate === 44100 || data.sampleRate === 48000)
      && (data.channels === 1 || data.channels === 2) && data.sampleCount === data.sampleRate * 20
      && data.durationSeconds === 20 && data.durationBasis === "pcm-samples"
      && typeof data.byteLength === "number" && data.byteLength <= 3_840_044
      && data.byteLength === 44 + data.sampleCount * data.channels * 2;
  } catch { return false; }
}
