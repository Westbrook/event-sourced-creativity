/** Fixed mini-app intent only. This is not source custody, consent, a quote,
 * a provider claim, or evidence that any image has been generated. */
export const STORYBOARD_OUTPUT_POLICY = Object.freeze({
  schemaVersion: 1,
  id: "forma.storyboard.four-frames@1",
  artifactKind: "storyboard",
  productionMode: "manual",
  frameCount: 4,
  maximumPlanningCalls: 1,
  maximumFrameCalls: 4,
  maximumPlanBytes: 262_144,
} as const);
export type StoryboardOutputSource = Readonly<{
  draftId: string; draftHash: string; releaseHash: string; requestHash: string; sourceBindingHash: string;
}>;
export type StoryboardOutputContract = typeof STORYBOARD_OUTPUT_POLICY & Readonly<{ source: StoryboardOutputSource }>;

function fields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key]);
}
export function createStoryboardOutputContract(value: unknown): StoryboardOutputContract | null {
  try {
    const keys = ["draftId", "draftHash", "releaseHash", "requestHash", "sourceBindingHash"];
    if (!fields(value, keys) || typeof value.draftId !== "string" || !/^experience-draft-[a-f0-9]{64}$/u.test(value.draftId)
      || keys.slice(1).some(key => typeof value[key] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value[key] as string))) return null;
    return Object.freeze({ ...STORYBOARD_OUTPUT_POLICY, source: Object.freeze({ draftId: value.draftId,
      draftHash: value.draftHash as string, releaseHash: value.releaseHash as string, requestHash: value.requestHash as string,
      sourceBindingHash: value.sourceBindingHash as string }) });
  } catch { return null; }
}
export function parseStoryboardOutputContract(value: unknown): StoryboardOutputContract | null {
  try {
    if (!fields(value, [...Object.keys(STORYBOARD_OUTPUT_POLICY), "source"])) return null;
    for (const key of Object.keys(STORYBOARD_OUTPUT_POLICY) as (keyof typeof STORYBOARD_OUTPUT_POLICY)[])
      if (value[key] !== STORYBOARD_OUTPUT_POLICY[key]) return null;
    return createStoryboardOutputContract(value.source);
  } catch { return null; }
}
