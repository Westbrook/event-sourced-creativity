import { canonicalJson, digest, freeze } from "../src/experiences/compiler.ts";
import type { ExperienceOutputBinding } from "./experience-output-binding.ts";

/** Immutable lineage only. These values are not financial or write authority. */
export type ScenePreparationPredecessor = Readonly<{
  ordinal: number;
  cycleId: string | null;
  confirmation: { key: string; eventId: string; digest: string; planRevisionId: string };
  preflight: { key: string; eventId: string; digest: string; preflightId: string };
  sourceDigest: string;
  requirementsDigest: string;
}>;
export type ScenePreparationCycle = Readonly<{
  version: 1;
  /** Absent for legacy Scene cycles so their immutable shape stays unchanged. */
  output?: "video";
  draftId: string;
  id: string;
  ordinal: number;
  predecessor: ScenePreparationPredecessor;
}>;

// Bound exact lineage traversal; reaching the bound is unavailable, not reset.
export const MAX_SCENE_PREPARATION_RENEWALS = 8;
const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const text = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 240;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

function validPredecessor(value: unknown): value is ScenePreparationPredecessor {
  if (!record(value) || !exactKeys(value, ["ordinal", "cycleId", "confirmation", "preflight", "sourceDigest", "requirementsDigest"])
    || !Number.isSafeInteger(value.ordinal) || Number(value.ordinal) < 0
    || Number(value.ordinal) >= MAX_SCENE_PREPARATION_RENEWALS
    || (value.ordinal === 0 ? value.cycleId !== null : !sha(value.cycleId))
    || !text(value.sourceDigest) || !text(value.requirementsDigest)) return false;
  const confirmation = value.confirmation, preflight = value.preflight;
  return record(confirmation) && record(preflight)
    && exactKeys(confirmation, ["key", "eventId", "digest", "planRevisionId"])
    && exactKeys(preflight, ["key", "eventId", "digest", "preflightId"])
    && [confirmation.key, confirmation.eventId, confirmation.planRevisionId,
      preflight.key, preflight.eventId, preflight.preflightId].every(text)
    && sha(confirmation.digest) && sha(preflight.digest);
}

/** Same predecessor always produces the same successor, including lost-response
 * and concurrent requests. A server transaction must still fence the predecessor
 * and all custody/never-authorized witnesses when appending its first receipt. */
export async function scenePreparationSuccessor(binding: ExperienceOutputBinding, predecessor: ScenePreparationPredecessor): Promise<ScenePreparationCycle> {
  if (!record(binding) || !exactKeys(binding, ["version", "draftId", "draftHash", "releaseHash", "requestHash", "sourceBindingHash", "output", "projectId", "documentId", "streamId"])
    || binding.version !== 1 || !["scene", "video"].includes(binding.output) || !validPredecessor(predecessor)) throw new Error("experience_scene_renewal_lineage_unavailable");
  scenePreparationCyclePrefix(binding.draftId, binding.output as "scene" | "video");
  const id = (await digest({ namespace: `experience-${binding.output}-preparation-cycle@1`, binding, predecessor })).slice(7);
  return freeze({ version: 1, ...(binding.output === "video" ? { output: "video" as const } : {}), draftId: binding.draftId, id, ordinal: predecessor.ordinal + 1, predecessor: structuredClone(predecessor) });
}

/** Prefix scopes indexed orphan detection to this draft, not other Documents
 * sharing the same personal project output scope. */
export function scenePreparationCyclePrefix(draftId: string, output: "scene" | "video" = "scene"): string {
  if (!["scene", "video"].includes(output) || typeof draftId !== "string" || !/^experience-draft-[a-f0-9]{64}$/u.test(draftId)) throw new Error("experience_scene_renewal_lineage_unavailable");
  return `${output}-cycle-v1:${draftId.slice("experience-draft-".length)}:`;
}

/** No save key: successor cycles reuse the original managed requirement. v1
 * command keys remain owned by experienceOutputCommandKey and are untouched. */
export function scenePreparationCommandKey(cycle: ScenePreparationCycle, stage: "confirm" | "preflight" | "authorize" | "run"): string {
  if (cycle.version !== 1 || !sha(cycle.id) || !validPredecessor(cycle.predecessor)
    || cycle.ordinal !== cycle.predecessor.ordinal + 1 || !["confirm", "preflight", "authorize", "run"].includes(stage))
    throw new Error("experience_scene_renewal_lineage_unavailable");
  return `${scenePreparationCyclePrefix(cycle.draftId, cycle.output ?? "scene")}${cycle.id}:${stage}`;
}

export async function scenePreparationCycleMatches(binding: ExperienceOutputBinding, predecessor: ScenePreparationPredecessor, candidate: unknown): Promise<boolean> {
  try { return canonicalJson(await scenePreparationSuccessor(binding, predecessor)) === canonicalJson(candidate); }
  catch { return false; }
}

/** Explicit complete evidence, not truthy defaults or an absent query row.
 * The caller must read these counts in one DB snapshot and carry equivalent
 * predicates into the append transaction; this pure check cannot authorize it. */
export type SceneRenewalEligibility = Readonly<{
  now: number;
  preparationExpiresAt: string;
  retentionExpiresAt: string;
  requiredWindowMs: number;
  sourceCurrent: boolean;
  custodyCurrent: boolean;
  releaseCurrent: boolean;
  requirementCurrent: boolean;
  evidenceComplete: boolean;
  authorizationReceipts: number;
  runReceipts: number;
  grants: number;
  slots: number;
  jobs: number;
  tokenReservations: number;
  costReservations: number;
  providerCalls: number;
}>;

export function scenePreparationMayRenew(input: SceneRenewalEligibility): boolean {
  if (!record(input) || !Number.isSafeInteger(input.now) || input.now < 0
    || !Number.isSafeInteger(input.requiredWindowMs) || input.requiredWindowMs < 15 * 60_000
    || ![input.sourceCurrent, input.custodyCurrent, input.releaseCurrent, input.requirementCurrent, input.evidenceComplete].every(value => value === true)) return false;
  const expiry = Date.parse(input.preparationExpiresAt), retainedUntil = Date.parse(input.retentionExpiresAt);
  if (!Number.isSafeInteger(expiry) || !Number.isSafeInteger(retainedUntil) || expiry > input.now
    || !Number.isSafeInteger(input.now + input.requiredWindowMs) || retainedUntil <= input.now + input.requiredWindowMs) return false;
  return [input.authorizationReceipts, input.runReceipts, input.grants, input.slots, input.jobs,
    input.tokenReservations, input.costReservations, input.providerCalls].every(value => Number.isSafeInteger(value) && value === 0);
}
