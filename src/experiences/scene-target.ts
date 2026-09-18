import { createSceneOutputContract, parseSceneOutputContract, type SceneOutputContract } from "../model/output-scene-contract.ts";

function data(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), copy: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return null;
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    copy[key] = descriptor.value;
  }
  return copy;
}
const exact = (value: Record<string, unknown> | null, keys: readonly string[]) =>
  value !== null && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** A selected target must match the original retained intake, not just promise
 * some Scene. References are caller-trusted comparison inputs, not authority.
 * The host separately proves the current source, target digest and original
 * grant/slot/job association. No page count or generated content is accepted.
 */
export function captureExperienceSceneTarget(value: unknown, expectedSource: unknown): SceneOutputContract | null {
  try {
    const target = data(value), expected = createSceneOutputContract(expectedSource);
    if (!target || !expected || Object.hasOwn(target, "narrative_contract")) return null;
    const contract = parseSceneOutputContract(target.scene_contract);
    const quantity = data(target.quantity), source = data(target.source_scope), coverage = data(target.coverage);
    if (!contract || target.media_kind !== "document" || !exact(quantity, ["kind", "unit", "value"])
      || quantity!.kind !== "exact" || quantity!.unit !== "document" || quantity!.value !== 1
      || !exact(source, ["kind"]) || source!.kind !== "document"
      || !exact(coverage, ["kind"]) || coverage!.kind !== "document_context"
      || ["aspect_ratio", "content_quantity", "count_policy", "variant_id", "member_id", "suggested_count"].some(key => target[key] !== null)
      || ["draftId", "draftHash", "releaseHash", "requestHash", "sourceBindingHash"].some(key =>
        contract.source[key as keyof typeof contract.source] !== expected.source[key as keyof typeof expected.source])) return null;
    return contract;
  } catch { return null; }
}
