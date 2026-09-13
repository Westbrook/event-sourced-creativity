import { readModel3dReferenceIntent, type Model3dReferenceIntent } from "../experiences/model3d-reference.ts";
import { type Model3dSettings, RODIN_ADAPTER_VERSION, RODIN_IMAGE_MODEL, RODIN_TEXT_MODEL } from "./model3d.ts";
import { MODEL3D_STATIC_POLICY } from "./model3d-static-policy.ts";

/** Requested mini-app profile only. General Model3D settings remain unchanged. */
export const MODEL3D_MINI_APP_SETTINGS: Readonly<Model3dSettings> = Object.freeze({
  tier: "Gen-2.5-High", geometry_file_format: "glb", material: "All", quality_mesh_option: "Auto",
  texture_mode: "auto", seed: null, enable_creative_mode: false, hd_texture: false,
  texture_delight: false, is_micro: false, TAPose: false, use_original_alpha: false,
  preview_render: false, bbox_condition: null, addons: Object.freeze({ high_pack: false }),
});
export const MODEL3D_OUTPUT_POLICY = Object.freeze({
  schemaVersion: 1, id: "forma.model3d.static-glb@1", artifactKind: "model3d", productionMode: "manual",
  requestedSubjectCount: 1, primaryGlbCount: 1, fileFormat: "glb", maximumReferenceImages: 1,
  staticPolicy: MODEL3D_STATIC_POLICY, adapterVersion: RODIN_ADAPTER_VERSION,
} as const);
export type Model3dOutputSource = Readonly<{
  draftId: string; draftHash: string; releaseHash: string; requestHash: string; sourceBindingHash: string;
}>;
export type Model3dOutputReference = Readonly<{
  selection: Model3dReferenceIntent; sourceDigest: string; copiedBlockId: string;
}>;
export type Model3dOutputContract = typeof MODEL3D_OUTPUT_POLICY & Readonly<{
  source: Model3dOutputSource; reference: Model3dOutputReference | null;
}>;
const sourceKeys = ["draftId", "draftHash", "releaseHash", "requestHash", "sourceBindingHash"] as const;
const hex = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,239}$/u.test(value);

/** Snapshot closed ordinary data records without invoking authored getters. */
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
  for (const key of keys) {
    const field = descriptors[key];
    if (!field?.enumerable || !Object.hasOwn(field, "value")) return null;
    result[key] = field.value;
  }
  return result;
}
function reference(value: unknown): Model3dOutputReference | null | undefined {
  if (value === null) return null;
  const captured = fields(value, ["selection", "sourceDigest", "copiedBlockId"]);
  if (!captured || !hex(captured.sourceDigest) || !id(captured.copiedBlockId)) return undefined;
  const selection = readModel3dReferenceIntent(captured.selection);
  if (!selection || captured.copiedBlockId === selection.sourceBlockId) return undefined;
  return Object.freeze({ selection, sourceDigest: captured.sourceDigest, copiedBlockId: captured.copiedBlockId });
}

/** Source-bound intent, never ownership evidence, price consent or an execution grant.
 * null reference preserves the existing text-only authoring path. A selected image
 * must be the exact retained original plus its distinct Document copy, not a URL.
 */
export function createModel3dOutputContract(value: unknown): Model3dOutputContract | null {
  try {
    const captured = fields(value, [...sourceKeys, "reference"]);
    if (!captured || typeof captured.draftId !== "string" || !/^experience-draft-[a-f0-9]{64}$/u.test(captured.draftId)
      || sourceKeys.slice(1).some(key => typeof captured[key] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(captured[key] as string))) return null;
    const selected = reference(captured.reference);
    if (selected === undefined) return null;
    return Object.freeze({ ...MODEL3D_OUTPUT_POLICY, source: Object.freeze({
      draftId: captured.draftId, draftHash: captured.draftHash as string, releaseHash: captured.releaseHash as string,
      requestHash: captured.requestHash as string, sourceBindingHash: captured.sourceBindingHash as string,
    }), reference: selected });
  } catch { return null; }
}
export function parseModel3dOutputContract(value: unknown): Model3dOutputContract | null {
  try {
    const captured = fields(value, [...Object.keys(MODEL3D_OUTPUT_POLICY), "source", "reference"]);
    if (!captured) return null;
    for (const key of Object.keys(MODEL3D_OUTPUT_POLICY) as (keyof typeof MODEL3D_OUTPUT_POLICY)[]) {
      if (captured[key] !== MODEL3D_OUTPUT_POLICY[key]) return null;
    }
    const source = fields(captured.source, sourceKeys);
    return source ? createModel3dOutputContract({ ...source, reference: captured.reference }) : null;
  } catch { return null; }
}
export function model3dOutputModel(contract: Model3dOutputContract) {
  const captured = parseModel3dOutputContract(contract);
  if (!captured) throw Error("model3d_output_contract_invalid");
  return captured.reference ? RODIN_IMAGE_MODEL : RODIN_TEXT_MODEL;
}
