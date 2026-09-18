/** Fixed output intent, not job, grant, consent, source or fulfillment authority.
 * Unsupported text remains literal and cannot inherit the simple-font claim. */
export const SCENE_OUTPUT_POLICY = Object.freeze({
  schemaVersion: 1,
  id: "forma.scene.screenplay@1",
  artifactKind: "scene",
  productionMode: "manual",
  medium: "visual",
  sceneCount: 1,
  characterCount: 2,
  locationCount: 1,
  format: "forma-screenplay@1",
  pageRange: Object.freeze({ min: 1, max: 2 }),
  maximumBodyBytes: 65_536,
  fontSha256: "55b4c98f123daebb3ed27947ba47b2af00554fc6284d639a540bcef5e6258ad2",
  metricsSha256: "e80ad73375f5a09682f371e40f421c69c14c123aed93ed1904d72be167cb776d",
  paginationPolicySha256: "e88edebeeb9ab0353a22244c0bc2d67c84a3ac6f3f95e997bd5f297f0cfa3eb1",
} as const);
export type SceneOutputSource = Readonly<{
  draftId: string; draftHash: string; releaseHash: string; requestHash: string; sourceBindingHash: string;
}>;
export type SceneOutputContract = typeof SCENE_OUTPUT_POLICY & Readonly<{ source: SceneOutputSource }>;
function fields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key]);
}
function source(value: unknown): SceneOutputSource | null {
  const keys = ["draftId", "draftHash", "releaseHash", "requestHash", "sourceBindingHash"];
  if (!fields(value, keys) || typeof value.draftId !== "string" || !/^experience-draft-[a-f0-9]{64}$/u.test(value.draftId)
    || keys.slice(1).some(key => typeof value[key] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value[key] as string))) return null;
  return Object.freeze({ draftId: value.draftId, draftHash: value.draftHash as string, releaseHash: value.releaseHash as string,
    requestHash: value.requestHash as string, sourceBindingHash: value.sourceBindingHash as string });
}
/** References must still be resolved against the original private intake and
 * current Document by the server; syntactically valid hashes prove no custody. */
export function createSceneOutputContract(value: unknown): SceneOutputContract | null {
  const captured = source(value);
  return captured ? Object.freeze({ ...SCENE_OUTPUT_POLICY, source: captured }) : null;
}
export function parseSceneOutputContract(value: unknown): SceneOutputContract | null {
  if (!fields(value, [...Object.keys(SCENE_OUTPUT_POLICY), "source"]) || !fields(value.pageRange, ["min", "max"])
    || value.pageRange.min !== 1 || value.pageRange.max !== 2) return null;
  for (const key of Object.keys(SCENE_OUTPUT_POLICY) as (keyof typeof SCENE_OUTPUT_POLICY)[]) {
    if (key !== "pageRange" && value[key] !== SCENE_OUTPUT_POLICY[key]) return null;
  }
  return createSceneOutputContract(value.source);
}
