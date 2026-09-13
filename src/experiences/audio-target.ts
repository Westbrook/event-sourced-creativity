import { createAudioOutputContract, parseAudioOutputContract, type AudioOutputContract } from "../model/output-audio-contract.ts";
function data(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !descriptors[key]!.enumerable || !Object.hasOwn(descriptors[key]!, "value")) return null;
    result[key] = descriptors[key]!.value;
  }
  return result;
}
const exact = (value: Record<string, unknown> | null, keys: readonly string[]) => value !== null
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
/** Exact original intake comparison only. Server/current source and grant authority are separate. */
export function captureExperienceAudioTarget(value: unknown, expectedSource: unknown): AudioOutputContract | null {
  try {
    const target = data(value), expected = createAudioOutputContract(expectedSource);
    if (!target || !expected || ["narrative_contract", "scene_contract", "video_contract", "storyboard_contract"].some(key => Object.hasOwn(target, key))) return null;
    const contract = parseAudioOutputContract(target.audio_contract), quantity = data(target.quantity), source = data(target.source_scope), coverage = data(target.coverage);
    if (!contract || target.media_kind !== "audio" || !exact(quantity, ["kind", "unit", "value"])
      || quantity!.kind !== "exact" || quantity!.unit !== "episode" || quantity!.value !== 1
      || !exact(source, ["kind"]) || source!.kind !== "document" || !exact(coverage, ["kind"]) || coverage!.kind !== "document_context"
      || ["aspect_ratio", "content_quantity", "count_policy", "variant_id", "member_id", "suggested_count"].some(key => target[key] !== null)
      || Object.keys(expected.source).some(key => contract.source[key as keyof typeof contract.source] !== expected.source[key as keyof typeof expected.source])) return null;
    return contract;
  } catch { return null; }
}
