import { canonicalJson, digest, freeze } from "../src/experiences/compiler.ts";
import type { ExperienceOutputBinding, ExperienceOutputStage } from "./experience-output-binding.ts";

/** A replacement is additional exposure, not a refund, reconciliation or retry
 * of the consumed provider call. These pure identities grant no authority. */
export type Model3dReplacementPredecessor = Readonly<{
  slotId: string; jobId: string; grantId: string; targetId: string;
  targetContractDigest: string; sourceDigest: string; requirementsDigest: string;
  providerRequestId: string; maximumMicrousd: 400000;
  confirmation: { key: string; eventId: string; digest: string; planRevisionId: string };
  preflight: { key: string; eventId: string; digest: string; preflightId: string };
  authorization: { key: string; eventId: string; digest: string };
  run: { key: string; eventId: string; digest: string };
}>;
export type Model3dReplacementCycle = Readonly<{
  version: 1; draftId: string; id: string; ordinal: 1;
  predecessor: Model3dReplacementPredecessor;
}>;

const rootKeys = ["version", "draftId", "draftHash", "releaseHash", "requestHash", "sourceBindingHash", "output", "projectId", "documentId", "streamId"];
const predecessorKeys = ["slotId", "jobId", "grantId", "targetId", "targetContractDigest", "sourceDigest", "requirementsDigest", "providerRequestId", "maximumMicrousd", "confirmation", "preflight", "authorization", "run"];
const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const identity = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
const draft = (value: unknown) => typeof value === "string" && /^experience-draft-[a-f0-9]{64}$/u.test(value);
/** No getters, symbols, inherited fields or extra authority-bearing fields. */
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
function receipt(value: unknown, extra?: string) {
  const v = fields(value, ["key", "eventId", "digest", ...(extra ? [extra] : [])]);
  return Boolean(v && typeof v.key === "string" && v.key.length > 0 && v.key.length <= 240
    && identity(v.eventId) && sha(v.digest) && (!extra || identity(v[extra])));
}
export function parseModel3dReplacementPredecessor(value: unknown): Model3dReplacementPredecessor | null {
  try {
    const v = fields(value, predecessorKeys);
    if (!v || !["slotId", "grantId", "targetId", "providerRequestId"].every(key => identity(v[key]))
      || typeof v.jobId !== "string" || !/^model3d-[a-f0-9]{64}$/u.test(v.jobId)
      || !["targetContractDigest", "sourceDigest", "requirementsDigest"].every(key => sha(v[key]))
      || v.maximumMicrousd !== 400000 || !receipt(v.confirmation, "planRevisionId")
      || !receipt(v.preflight, "preflightId") || !receipt(v.authorization) || !receipt(v.run)) return null;
    return freeze(structuredClone(v)) as Model3dReplacementPredecessor;
  } catch { return null; }
}
export function model3dReplacementPrefix(draftId: string): string {
  if (!draft(draftId)) throw new Error("experience_model3d_replacement_lineage_unavailable");
  return `model3d-replace-v1:${draftId.slice("experience-draft-".length)}:`;
}
/** Exactly one child of the root. No save key and no child-of-child fallback. */
export async function model3dReplacementSuccessor(binding: ExperienceOutputBinding, predecessor: Model3dReplacementPredecessor): Promise<Model3dReplacementCycle> {
  const root = fields(binding, rootKeys), prior = parseModel3dReplacementPredecessor(predecessor);
  if (!root || root.version !== 1 || root.output !== "model3d" || !draft(root.draftId)
    || !["projectId", "documentId"].every(key => identity(root[key]))
    || typeof root.streamId !== "string" || !/^creative:[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(root.streamId)
    || !["draftHash", "releaseHash", "requestHash", "sourceBindingHash"].every(key => typeof root[key] === "string" && /^sha256:[a-f0-9]{64}$/u.test(root[key] as string))
    || !prior) throw new Error("experience_model3d_replacement_lineage_unavailable");
  const id = (await digest({ namespace: "experience-model3d-replacement-cycle@1", binding: root, predecessor: prior })).slice(7);
  return freeze({ version: 1, draftId: root.draftId as string, id, ordinal: 1, predecessor: prior });
}
export async function model3dReplacementCycleMatches(binding: ExperienceOutputBinding, candidate: unknown): Promise<boolean> {
  try {
    const value = fields(candidate, ["version", "draftId", "id", "ordinal", "predecessor"]);
    const predecessor = value && parseModel3dReplacementPredecessor(value.predecessor);
    return Boolean(value && predecessor && value.version === 1 && value.ordinal === 1 && sha(value.id)
      && canonicalJson(await model3dReplacementSuccessor(binding, predecessor)) === canonicalJson(value));
  } catch { return false; }
}
export function model3dReplacementCommandKey(cycle: Model3dReplacementCycle, stage: Exclude<ExperienceOutputStage, "save">): string {
  const v = fields(cycle, ["version", "draftId", "id", "ordinal", "predecessor"]);
  if (!v || v.version !== 1 || v.ordinal !== 1 || !sha(v.id) || !parseModel3dReplacementPredecessor(v.predecessor)
    || !["confirm", "preflight", "authorize", "run"].includes(stage)) throw new Error("experience_model3d_replacement_lineage_unavailable");
  return `${model3dReplacementPrefix(cycle.draftId)}${cycle.id}:${stage}`;
}

/** One fully captured observation is required. DB readers must also carry the
 * same predicates into admission and execution transactions. This pure check
 * does not release the predecessor hold or authorize a provider request. */
export type Model3dReplacementEligibility = Readonly<{
  sourceCurrent: boolean; custodyCurrent: boolean; personalOwner: boolean; evidenceComplete: boolean;
  textOnly: boolean; jobFailed: boolean; parentAttemptOrdinal: number; parentPreviousSlotId: string | null;
  parentSlotStatus: string; parentCallCount: number; parentCallStatus: string;
  parentCallUsedMicrousd: number | null; parentReservedMicrousd: number;
  costReservationActive: boolean; providerAccepted: boolean;
  retainedResultCount: number; activeLeaseCount: number; successorCount: number;
  newMaximumMicrousd: number; newMaximumCalls: number;
  now: number; retentionExpiresAt: string;
  /** A verified existing child uses its fixed confirmation deadline. */
  childDeadlineMs?: number;
}>;
export function model3dMayPrepareReplacement(input: Model3dReplacementEligibility): boolean {
  if (![input.sourceCurrent, input.custodyCurrent, input.personalOwner, input.evidenceComplete, input.textOnly,
    input.jobFailed, input.costReservationActive, input.providerAccepted].every(value => value === true)
    || input.parentAttemptOrdinal !== 0 || input.parentPreviousSlotId !== null || input.parentSlotStatus !== "uncertain"
    || input.parentCallCount !== 1 || input.parentCallStatus !== "uncertain" || input.parentCallUsedMicrousd !== null
    || input.parentReservedMicrousd !== 400000 || input.newMaximumMicrousd !== 400000 || input.newMaximumCalls !== 1
    || ![input.retainedResultCount, input.activeLeaseCount, input.successorCount].every(value => value === 0)
    || !Number.isSafeInteger(input.now) || input.now < 0) return false;
  const expires = Date.parse(input.retentionExpiresAt), requiredUntil = input.childDeadlineMs ?? input.now + 15 * 60_000;
  return Number.isSafeInteger(requiredUntil) && Number.isSafeInteger(expires)
    && requiredUntil > input.now && requiredUntil <= input.now + 15 * 60_000
    && new Date(expires).toISOString() === input.retentionExpiresAt && expires > requiredUntil;
}
