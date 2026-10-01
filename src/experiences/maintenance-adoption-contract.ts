import { canonicalJson, digest, exactKeys, freeze, record } from "./compiler.ts";
import type { ExperienceMaterialSelection } from "./release-contract.ts";
import { canonicalDeliveryStatus, type DeliveryDecisionStatus } from "../platform/delivery-lifecycle.ts";

/** This private control-plane protocol adopts retained evidence, never generation. */
export const EXPERIENCE_MAINTENANCE_ADOPTION_PROTOCOL = "forma-experience-maintenance-adoption@1";
export const MAINTENANCE_ADOPTION_PROTOCOL = EXPERIENCE_MAINTENANCE_ADOPTION_PROTOCOL;
const decisionPrefix = "experience-maintenance:v1:";
export const maintenanceHash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}(?![\s\S])/u.test(value);
const requestId = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/u.test(value);
const eventId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}(?![\s\S])/u.test(value);
const experienceId = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9-]{1,63}(?![\s\S])/u.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z(?![\s\S])/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  // eslint-disable-next-line no-control-regex -- Identity values must exclude control characters.
  && value === value.trim() && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value);
const text = (value: unknown, maximum: number, required = false): value is string => typeof value === "string"
  && value.length <= maximum && value === value.trim() && (!required || value.length > 0);
const profileRef = (value: unknown): value is "model3d.code-declarations@1" => value === "model3d.code-declarations@1";

/** Inspect descriptors before cloning: reject accessors, sparse/extended arrays,
 * non-JSON prototypes, non-finite numbers and unbounded graphs without coercion. */
export function maintenanceAdoptionSnapshot(raw: unknown, maximum = 32768): unknown | null {
  try {
    const active = new WeakSet<object>();
    let nodes = 0, textUnits = 0;
    const visit = (value: unknown, depth: number): boolean => {
      if (++nodes > 8192 || depth > 16) return false;
      if (value === null || typeof value === "boolean") return true;
      if (typeof value === "number") return Number.isFinite(value);
      if (typeof value === "string") { textUnits += value.length; return textUnits <= maximum; }
      if (typeof value !== "object" || active.has(value)) return false;
      const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
      const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
      if (keys.some(key => typeof key !== "string")) return false;
      const length = array ? descriptors.length?.value : null;
      if (array && (!Number.isSafeInteger(length) || length < 0 || length > 8192 || keys.length !== length + 1)) return false;
      active.add(value);
      for (const key of keys as string[]) {
        if (array && key === "length") continue;
        if (array && (!/^(0|[1-9][0-9]*)(?![\s\S])/u.test(key) || Number(key) >= length)) return false;
        const descriptor = descriptors[key];
        textUnits += key.length;
        if (textUnits > maximum || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || !visit(descriptor.value, depth + 1)) return false;
      }
      active.delete(value); return true;
    };
    if (!visit(raw, 0)) return null;
    const snapshot: unknown = structuredClone(raw);
    return new TextEncoder().encode(canonicalJson(snapshot)).length <= maximum ? freeze(snapshot) : null;
  } catch { return null; }
}

export const isMaintenanceDecisionId = (value: unknown): value is string => typeof value === "string" && value.startsWith("experience-maintenance:");
export const validMaintenanceDecisionId = (value: unknown): value is string => typeof value === "string" && value.startsWith(decisionPrefix) && requestId(value.slice(decisionPrefix.length));
export type MaintenanceBinding = Readonly<{
  version: 1; operation: "adopt-baseline"; channel: "managed-fixture"; experienceId: string;
  material: ExperienceMaterialSelection;
  target: Readonly<{ observationHash: string; profileRef: "model3d.code-declarations@1"; profileHash: string; inventoryHash: string }>;
  reviewed: Readonly<{ baselineObservationHash: string; currentObservationHash: string }>;
  eligibilityHash: string;
  expectedAdoption: Readonly<{ revision: number; eventId: string | null; baselineObservationHash: string | null;
    profileRef: "model3d.code-declarations@1" | null; profileHash: string | null }>;
}>;

export function readMaintenanceAdoptionBinding(raw: unknown): MaintenanceBinding | null {
  const value = maintenanceAdoptionSnapshot(raw);
  if (!record(value) || !exactKeys(value, ["version", "operation", "channel", "experienceId", "material", "target", "reviewed", "eligibilityHash", "expectedAdoption"])
    || value.version !== 1 || value.operation !== "adopt-baseline" || value.channel !== "managed-fixture" || !experienceId(value.experienceId)
    || !record(value.material) || !exactKeys(value.material, ["releaseHash", "sourceHash", "buildHash", "evaluationHash"])
    || !Object.values(value.material).every(maintenanceHash) || !maintenanceHash(value.eligibilityHash)
    || !record(value.target) || !exactKeys(value.target, ["observationHash", "profileRef", "profileHash", "inventoryHash"])
    || !profileRef(value.target.profileRef) || ![value.target.observationHash, value.target.profileHash, value.target.inventoryHash].every(maintenanceHash)
    || !record(value.reviewed) || !exactKeys(value.reviewed, ["baselineObservationHash", "currentObservationHash"])
    || !Object.values(value.reviewed).every(maintenanceHash) || value.target.observationHash !== value.reviewed.currentObservationHash
    || !record(value.expectedAdoption) || !exactKeys(value.expectedAdoption, ["revision", "eventId", "baselineObservationHash", "profileRef", "profileHash"])
    || typeof value.expectedAdoption.revision !== "number" || !Number.isSafeInteger(value.expectedAdoption.revision)
    || value.expectedAdoption.revision < 0 || value.expectedAdoption.revision >= Number.MAX_SAFE_INTEGER) return null;
  const expected = value.expectedAdoption;
  if (expected.revision === 0) {
    if ([expected.eventId, expected.baselineObservationHash, expected.profileRef, expected.profileHash].some(value => value !== null)
      || value.reviewed.baselineObservationHash !== value.reviewed.currentObservationHash) return null;
  } else if (!eventId(expected.eventId) || !maintenanceHash(expected.baselineObservationHash) || !profileRef(expected.profileRef)
    || !maintenanceHash(expected.profileHash) || value.reviewed.baselineObservationHash !== expected.baselineObservationHash
    || value.target.profileRef !== expected.profileRef || value.target.profileHash !== expected.profileHash) return null;
  return value as MaintenanceBinding;
}

export type MaintenanceProposalIntent = Readonly<{
  version: 1; requestId: string; title: string; ownerUserId: string; evidence: string; dependencyIds: readonly string[]; binding: MaintenanceBinding;
}>;
export type MaintenanceTransitionIntent = Readonly<{
  version: 1; requestId: string; decisionId: string; expectedUpdatedAt: string; title: string; ownerUserId: string;
  evidence: string; status: DeliveryDecisionStatus; maintenanceAdoption: MaintenanceBinding;
}>;
export type MaintenanceAdoptionIntent = Readonly<{
  version: 1; requestId: string; decisionId: string; expectedDecisionUpdatedAt: string; approvalEventId: string; binding: MaintenanceBinding;
}>;
export type MaintenanceOperation = "maintenance-proposal" | "maintenance-transition" | "maintenance-adoption";
export type MaintenanceIntent = MaintenanceProposalIntent | MaintenanceTransitionIntent | MaintenanceAdoptionIntent;

export function readMaintenanceAdoptionProposal(raw: unknown): MaintenanceProposalIntent | null {
  const value = maintenanceAdoptionSnapshot(raw);
  if (!record(value) || !exactKeys(value, ["version", "requestId", "title", "ownerUserId", "evidence", "dependencyIds", "binding"])
    || value.version !== 1 || !requestId(value.requestId) || !text(value.title, 160, true) || !identity(value.ownerUserId)
    || !text(value.evidence, 800) || !Array.isArray(value.dependencyIds) || value.dependencyIds.length > 10
    || !value.dependencyIds.every(identity) || new Set(value.dependencyIds).size !== value.dependencyIds.length
    || !readMaintenanceAdoptionBinding(value.binding)) return null;
  return value as MaintenanceProposalIntent;
}
export function readMaintenanceAdoptionTransition(raw: unknown): MaintenanceTransitionIntent | null {
  const value = maintenanceAdoptionSnapshot(raw);
  if (!record(value) || !exactKeys(value, ["version", "requestId", "decisionId", "expectedUpdatedAt", "title", "ownerUserId", "evidence", "status", "maintenanceAdoption"])
    || value.version !== 1 || !requestId(value.requestId) || !validMaintenanceDecisionId(value.decisionId) || !timestamp(value.expectedUpdatedAt)
    || !text(value.title, 160, true) || !identity(value.ownerUserId) || !text(value.evidence, 800)
    || typeof value.status !== "string" || canonicalDeliveryStatus(value.status) !== value.status
    || !readMaintenanceAdoptionBinding(value.maintenanceAdoption)) return null;
  return value as MaintenanceTransitionIntent;
}
export function readMaintenanceAdoptionIntent(raw: unknown): MaintenanceAdoptionIntent | null {
  const value = maintenanceAdoptionSnapshot(raw);
  if (!record(value) || !exactKeys(value, ["version", "requestId", "decisionId", "expectedDecisionUpdatedAt", "approvalEventId", "binding"])
    || value.version !== 1 || !requestId(value.requestId) || !validMaintenanceDecisionId(value.decisionId)
    || !timestamp(value.expectedDecisionUpdatedAt) || !eventId(value.approvalEventId) || !readMaintenanceAdoptionBinding(value.binding)) return null;
  return value as MaintenanceAdoptionIntent;
}
export const readMaintenanceIntent = (operation: MaintenanceOperation, raw: unknown): MaintenanceIntent | null =>
  operation === "maintenance-proposal" ? readMaintenanceAdoptionProposal(raw) : operation === "maintenance-transition" ? readMaintenanceAdoptionTransition(raw)
    : operation === "maintenance-adoption" ? readMaintenanceAdoptionIntent(raw) : null;
export const maintenanceIntentDigest = (operation: MaintenanceOperation, actorUserId: string, intent: MaintenanceIntent) =>
  digest({ protocol: EXPERIENCE_MAINTENANCE_ADOPTION_PROTOCOL, operation, actorUserId, intent });
export const maintenanceBindingDigest = (binding: MaintenanceBinding) => digest(binding);
export const maintenanceSubjectDigest = (binding: Pick<MaintenanceBinding, "channel" | "experienceId" | "material">) =>
  digest({ channel: binding.channel, experienceId: binding.experienceId, material: binding.material });
export const maintenanceTransitionEventId = (decisionId: string, updatedAt: string) => `maintenance-transition:v1:${decisionId.slice(decisionPrefix.length)}:${updatedAt}`;
export const sameMaintenanceBinding = (left: MaintenanceBinding, right: MaintenanceBinding) => canonicalJson(left) === canonicalJson(right);

export type MaintenanceOperationReceipt = Readonly<{
  version: 1; protocol: typeof EXPERIENCE_MAINTENANCE_ADOPTION_PROTOCOL; operation: MaintenanceOperation; requestId: string;
  actorUserId: string; intentDigest: string; eventId: string; sequence: number; acknowledgmentDigest: string;
}>;
/** Exact immutable original only; a current head is not an acknowledgment. */
export async function readMaintenanceOperationReceipt(raw: unknown, rawExpected: {
  operation: MaintenanceOperation; actorUserId: string; intent: MaintenanceIntent;
}): Promise<{ receipt: MaintenanceOperationReceipt; result: Record<string, unknown> } | null> {
  const value = maintenanceAdoptionSnapshot(raw, 65536), expected = maintenanceAdoptionSnapshot(rawExpected);
  if (!record(expected) || !exactKeys(expected, ["operation", "actorUserId", "intent"]) || !identity(expected.actorUserId)) return null;
  const operation = expected.operation as MaintenanceOperation, intent = readMaintenanceIntent(operation, expected.intent);
  if (!intent || !record(value) || !exactKeys(value, ["receipt", "result"]) || !record(value.receipt) || !record(value.result)) return null;
  const receipt = value.receipt;
  if (!exactKeys(receipt, ["version", "protocol", "operation", "requestId", "actorUserId", "intentDigest", "eventId", "sequence", "acknowledgmentDigest"])
    || receipt.version !== 1 || receipt.protocol !== EXPERIENCE_MAINTENANCE_ADOPTION_PROTOCOL || receipt.operation !== operation
    || receipt.requestId !== intent.requestId || receipt.actorUserId !== expected.actorUserId || !eventId(receipt.eventId)
    || typeof receipt.sequence !== "number" || !Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1
    || !maintenanceHash(receipt.intentDigest) || !maintenanceHash(receipt.acknowledgmentDigest)
    || receipt.intentDigest !== await maintenanceIntentDigest(operation, expected.actorUserId, intent)
    || receipt.acknowledgmentDigest !== await digest(value.result)) return null;
  return freeze({ receipt, result: value.result }) as { receipt: MaintenanceOperationReceipt; result: Record<string, unknown> };
}
