import { EXPERIENCE_VIDEO_INTENT, readVideoReferenceIntent, type VideoReferenceIntent } from "../experiences/video-reference.ts";

/** Versioned requested intent. Never measured media, source custody or a grant. */
export const VIDEO_OUTPUT_POLICY = Object.freeze({
  schemaVersion: 1, id: "forma.video.owned-still-4@1", artifactKind: "video", productionMode: "manual",
  clipCount: 1, seconds: EXPERIENCE_VIDEO_INTENT.seconds, resolution: EXPERIENCE_VIDEO_INTENT.resolution,
  audioMode: EXPERIENCE_VIDEO_INTENT.audioMode, referenceCount: EXPERIENCE_VIDEO_INTENT.referenceCount,
} as const);
export type VideoOutputSource = Readonly<{
  draftId: string; draftHash: string; releaseHash: string; requestHash: string; sourceBindingHash: string;
}>;
export type VideoOutputContract = typeof VIDEO_OUTPUT_POLICY & Readonly<{
  source: VideoOutputSource;
  reference: VideoReferenceIntent;
  frameSize: "1280x720" | "720x1280";
}>;
const sourceKeys = ["draftId", "draftHash", "releaseHash", "requestHash", "sourceBindingHash"];
function fields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key]);
}
export function createVideoOutputContract(value: unknown): VideoOutputContract | null {
  if (!fields(value, ["source", "reference", "frameSize"]) || !fields(value.source, sourceKeys)
    || !["1280x720", "720x1280"].includes(value.frameSize as string)) return null;
  const source = value.source;
  if (typeof source.draftId !== "string" || !/^experience-draft-[a-f0-9]{64}$/u.test(source.draftId)
    || sourceKeys.slice(1).some(key => typeof source[key] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(source[key] as string))) return null;
  const reference = readVideoReferenceIntent(value.reference);
  if (!reference) return null;
  return Object.freeze({ ...VIDEO_OUTPUT_POLICY, source: Object.freeze({ ...source }) as VideoOutputSource,
    reference, frameSize: value.frameSize as VideoOutputContract["frameSize"] });
}
export function parseVideoOutputContract(value: unknown): VideoOutputContract | null {
  if (!fields(value, [...Object.keys(VIDEO_OUTPUT_POLICY), "source", "reference", "frameSize"])) return null;
  for (const key of Object.keys(VIDEO_OUTPUT_POLICY) as (keyof typeof VIDEO_OUTPUT_POLICY)[])
    if (value[key] !== VIDEO_OUTPUT_POLICY[key]) return null;
  return createVideoOutputContract({ source: value.source, reference: value.reference, frameSize: value.frameSize });
}
