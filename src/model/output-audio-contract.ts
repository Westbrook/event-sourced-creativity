import { EXPERIENCE_AUDIO_INTENT } from "../experiences/contracts.ts";

/** Requested instrumental profile, never measured media, permission or a grant. */
export const AUDIO_OUTPUT_POLICY = Object.freeze({
  schemaVersion: 1, id: "forma.audio.instrumental-20@1", artifactKind: "audio",
  productionMode: "manual", trackCount: 1, ...EXPERIENCE_AUDIO_INTENT,
} as const);
export type AudioOutputSource = Readonly<{
  draftId: string; draftHash: string; releaseHash: string; requestHash: string; sourceBindingHash: string;
}>;
export type AudioOutputContract = typeof AUDIO_OUTPUT_POLICY & Readonly<{ source: AudioOutputSource }>;
function fields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key]);
}
export function createAudioOutputContract(value: unknown): AudioOutputContract | null {
  const keys = ["draftId", "draftHash", "releaseHash", "requestHash", "sourceBindingHash"];
  if (!fields(value, keys) || typeof value.draftId !== "string" || !/^experience-draft-[a-f0-9]{64}$/u.test(value.draftId)
    || keys.slice(1).some(key => typeof value[key] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value[key] as string))) return null;
  return Object.freeze({ ...AUDIO_OUTPUT_POLICY, source: Object.freeze({
    draftId: value.draftId, draftHash: value.draftHash as string, releaseHash: value.releaseHash as string,
    requestHash: value.requestHash as string, sourceBindingHash: value.sourceBindingHash as string,
  }) });
}
export function parseAudioOutputContract(value: unknown): AudioOutputContract | null {
  if (!fields(value, [...Object.keys(AUDIO_OUTPUT_POLICY), "source"])) return null;
  for (const key of Object.keys(AUDIO_OUTPUT_POLICY) as (keyof typeof AUDIO_OUTPUT_POLICY)[]) if (value[key] !== AUDIO_OUTPUT_POLICY[key]) return null;
  return createAudioOutputContract(value.source);
}
