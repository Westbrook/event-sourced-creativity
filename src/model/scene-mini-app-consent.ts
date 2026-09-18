/** Separate single-call Scene disclosure. Never reinterpret legacy scene-cost-v1
 * or infer deliberate confirmation from a grant, GET, checkbox default or hash. */
export type SceneMiniAppCostPreview = Readonly<{
  version: "scene-mini-app-cost-v1";
  requestId: string;
  actorUserId: string;
  projectId: string;
  documentId: string;
  contextSessionId: null;
  permissionEpoch: string;
  period: string;
  requestHash: string;
  sourceHash: string;
  provider: "openai";
  model: "gpt-5.6-terra";
  sceneMedium: "visual";
  productionMode: "manual";
  itemCount: 1;
  reusedSourceCount: 0;
  providerCallCount: 1;
  maximumProviderCallCount: 1;
  maximumMicrousd: 1_000_000;
  maximumInputTokens: number;
  maximumOutputTokens: 3000;
  maximumTokens: 128000;
  sceneContractDigest: string;
  executionContractDigest: string;
  expiresAt: string;
  bindingHash: string;
}>;
export type SceneMiniAppCostApproval = SceneMiniAppCostPreview & Readonly<{ confirmed: true }>;
const keys = ["version", "requestId", "actorUserId", "projectId", "documentId", "contextSessionId", "permissionEpoch", "period",
  "requestHash", "sourceHash", "provider", "model", "sceneMedium", "productionMode", "itemCount", "reusedSourceCount", "providerCallCount",
  "maximumProviderCallCount", "maximumMicrousd", "maximumInputTokens", "maximumOutputTokens", "maximumTokens", "sceneContractDigest",
  "executionContractDigest", "expiresAt", "bindingHash"] as const;
const closed = (value: unknown, expected: readonly string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === expected.length && expected.every(key => descriptors[key]?.enumerable && "value" in descriptors[key]);
};
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const digest = (value: unknown) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);

/** Shape/copy only; this does not prove server provenance or current authority.
 * An expired original disclosure may still be read but never confirmed. */
export function parseSceneMiniAppCostPreview(value: unknown): SceneMiniAppCostPreview | null {
  if (!closed(value, keys) || value.version !== "scene-mini-app-cost-v1"
    || !["requestId", "actorUserId", "projectId", "documentId", "permissionEpoch"].every(key => id(value[key]))
    || value.contextSessionId !== null || typeof value.period !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value.period)
    || !["requestHash", "sourceHash", "bindingHash"].every(key => hash(value[key]))
    || !digest(value.sceneContractDigest) || !digest(value.executionContractDigest)
    || value.provider !== "openai" || value.model !== "gpt-5.6-terra" || value.sceneMedium !== "visual" || value.productionMode !== "manual"
    || value.itemCount !== 1 || value.reusedSourceCount !== 0 || value.providerCallCount !== 1 || value.maximumProviderCallCount !== 1
    || value.maximumMicrousd !== 1_000_000 || value.maximumOutputTokens !== 3000 || value.maximumTokens !== 128000
    || !Number.isSafeInteger(value.maximumInputTokens) || Number(value.maximumInputTokens) < 4096 || Number(value.maximumInputTokens) > 125000
    || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))
    || new Date(value.expiresAt).toISOString() !== value.expiresAt) return null;
  return Object.freeze(Object.fromEntries(keys.map(key => [key, value[key]]))) as SceneMiniAppCostPreview;
}

/** Compare the deliberate action to the exact independently retained server
 * preview. Callers must recheck live source, access, budget and lease separately. */
export function sceneMiniAppCostApprovalMatches(value: unknown, preview: unknown, now = Date.now()): value is SceneMiniAppCostApproval {
  if (!Number.isFinite(now) || !closed(value, [...keys, "confirmed"]) || value.confirmed !== true) return false;
  const expected = parseSceneMiniAppCostPreview(preview);
  if (!expected || Date.parse(expected.expiresAt) <= now) return false;
  const candidate = parseSceneMiniAppCostPreview(Object.fromEntries(keys.map(key => [key, value[key]])));
  return candidate !== null && keys.every(key => candidate[key] === expected[key]);
}
