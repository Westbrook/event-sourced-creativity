import { MODEL3D_MINI_APP_SETTINGS } from "./output-model3d-contract.ts";
import { estimateModel3dCostMicrousd, RODIN_IMAGE_MODEL, RODIN_TEXT_MODEL, type RodinModelId } from "./model3d.ts";

/** Exact displayed original-operation terms. Parsing is neither source custody,
 * a user action nor a grant; the server must compare original and fresh terms. */
export type Model3dMiniAppCostPreview = Readonly<{
  version: "model3d-mini-app-cost-v1" | "model3d-mini-app-replacement-cost-v1"; requestId: string; actorUserId: string; projectId: string; documentId: string;
  draftId: string; sourceDigest: string; requirementsDigest: string; expiresAt: string; preparationDigest: string;
  maximumMicrousd: number; maximumCalls: 1; maximumTokens: 1; model: RodinModelId;
  sourceFilesTransferred: 0 | 1; sourceKind: "image" | "saved-model-view" | null;
  referenceSha256: string | null; referenceBytes: number; referenceMimeType: "image/jpeg" | "image/png" | "image/webp" | null;
  replacementCycleId?: string; previousSlotId?: string; previousJobId?: string; previousProviderRequestId?: string;
  priorHeldMicrousd?: 400000; cumulativeMaximumMicrousd?: 800000;
}>;
const keys = ["version", "requestId", "actorUserId", "projectId", "documentId", "draftId", "sourceDigest", "requirementsDigest", "expiresAt", "preparationDigest",
  "maximumMicrousd", "maximumCalls", "maximumTokens", "model", "sourceFilesTransferred", "sourceKind", "referenceSha256", "referenceBytes", "referenceMimeType"] as const;
const replacementKeys = ["replacementCycleId", "previousSlotId", "previousJobId", "previousProviderRequestId", "priorHeldMicrousd", "cumulativeMaximumMicrousd"] as const;
function previewKeys(value: unknown): readonly string[] {
  const version = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "version")?.value : null;
  return version === "model3d-mini-app-replacement-cost-v1" ? [...keys, ...replacementKeys] : keys;
}
function fields(value: unknown, expected: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  if (Reflect.ownKeys(descriptors).length !== expected.length) return null;
  for (const key of expected) {
    const field = descriptors[key];
    if (!field?.enumerable || !Object.hasOwn(field, "value")) return null;
    result[key] = field.value;
  }
  return result;
}
const hex = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
export function parseModel3dMiniAppCostPreview(value: unknown): Model3dMiniAppCostPreview | null {
  try {
    const v = fields(value, previewKeys(value));
    if (!v || !["model3d-mini-app-cost-v1", "model3d-mini-app-replacement-cost-v1"].includes(v.version as string)
      || !["actorUserId", "projectId", "documentId"].every(key => typeof v[key] === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(v[key] as string))
      || typeof v.requestId !== "string" || !/^model3d-[a-f0-9]{64}$/u.test(v.requestId)
      || typeof v.draftId !== "string" || !/^experience-draft-[a-f0-9]{64}$/u.test(v.draftId)
      || !hex(v.sourceDigest) || !hex(v.requirementsDigest)
      || typeof v.preparationDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(v.preparationDigest)
      || typeof v.expiresAt !== "string" || !Number.isFinite(Date.parse(v.expiresAt)) || new Date(v.expiresAt).toISOString() !== v.expiresAt
      || v.maximumMicrousd !== estimateModel3dCostMicrousd(MODEL3D_MINI_APP_SETTINGS) || v.maximumCalls !== 1 || v.maximumTokens !== 1) return null;
    if (v.sourceFilesTransferred === 0) {
      if (v.model !== RODIN_TEXT_MODEL || v.sourceKind !== null || v.referenceSha256 !== null || v.referenceBytes !== 0 || v.referenceMimeType !== null) return null;
    } else if (v.sourceFilesTransferred === 1) {
      if (v.model !== RODIN_IMAGE_MODEL || !["image", "saved-model-view"].includes(v.sourceKind as string) || !hex(v.referenceSha256)
        || !Number.isSafeInteger(v.referenceBytes) || Number(v.referenceBytes) <= 0 || Number(v.referenceBytes) > 24 * 1024 * 1024
        || !["image/jpeg", "image/png", "image/webp"].includes(v.referenceMimeType as string)) return null;
    } else return null;
    if (v.version === "model3d-mini-app-replacement-cost-v1" && (v.sourceFilesTransferred !== 0 || !hex(v.replacementCycleId)
      || typeof v.previousJobId !== "string" || !/^model3d-[a-f0-9]{64}$/u.test(v.previousJobId) || v.previousJobId === v.requestId
      || !["previousSlotId", "previousProviderRequestId"].every(key => typeof v[key] === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(v[key] as string))
      || v.priorHeldMicrousd !== 400000 || v.cumulativeMaximumMicrousd !== 800000)) return null;
    return Object.freeze(v) as Model3dMiniAppCostPreview;
  } catch { return null; }
}
export function model3dMiniAppCostApprovalMatches(value: unknown, expected: unknown, now = Date.now()): boolean {
  try {
    const preview = parseModel3dMiniAppCostPreview(expected), exact = previewKeys(expected), approval = fields(value, [...exact, "confirmed", "providerTransferConfirmed"]);
    return Boolean(preview && Number.isFinite(now) && Date.parse(preview.expiresAt) > now && approval
      && approval.confirmed === true && approval.providerTransferConfirmed === true && exact.every(key => approval[key] === (preview as Record<string, unknown>)[key]));
  } catch { return false; }
}

/** Shape/binding only. The native source resolver still owns parent custody,
 * retained lineage, authorization and budget proofs. */
export function model3dMiniAppAttemptMatches(value: unknown, slot: { jobId: string; attemptOrdinal: number; previousSlotId: string | null }): boolean {
  const preview = parseModel3dMiniAppCostPreview(value);
  return Boolean(preview && preview.requestId === slot.jobId && (preview.version === "model3d-mini-app-cost-v1"
    ? slot.attemptOrdinal === 0 && slot.previousSlotId === null
    : slot.attemptOrdinal === 1 && slot.previousSlotId === preview.previousSlotId));
}
