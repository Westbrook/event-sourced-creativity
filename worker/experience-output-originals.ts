import { readOutputCommand, type OutputCommandReceipt } from "./output-command-core.ts";
import { experienceOutputCommandKey, validateExperienceOutputEnvelope,
  type ExperienceOutputBinding, type ExperienceOutputStage } from "./experience-output-binding.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import { MAX_SCENE_PREPARATION_RENEWALS, scenePreparationCyclePrefix, scenePreparationSuccessor,
  type ScenePreparationPredecessor } from "./experience-scene-renewal.ts";

function error(code: string, status = 409): never { throw Object.assign(new Error(code), { code, status }); }

type Original = { envelope: Record<string, unknown>; receipt: OutputCommandReceipt; sequence: number; digest: string };
const phases = ["save", "confirm", "preflight", "authorize", "run"] as const;

/** Index first: a missing event/body is retained-unavailable, never a new intent. */
async function original(trusted: OutputTrustedContext, binding: ExperienceOutputBinding, phase: ExperienceOutputStage): Promise<Original | null> {
  const key = await experienceOutputCommandKey(binding, phase);
  const row = await trusted.env.DB.prepare(`SELECT command.request_digest,command.event_id,event.sequence
    FROM output_commands command LEFT JOIN events event ON event.event_id=command.event_id
    WHERE command.scope_key=? AND command.actor_user_id=? AND command.command_key=?`)
    .bind(trusted.scope.key, trusted.scope.actorUserId, key).first<{ request_digest: string; event_id: string; sequence: number | null }>();
  if (!row) return null;
  if (typeof row.request_digest !== "string" || !Number.isSafeInteger(row.sequence) || Number(row.sequence) < 1) error("experience_output_original_unavailable", 410);
  const receipt = await readOutputCommand(trusted.env, trusted.scope, key, row.request_digest, { allowUnavailableReceipt: true });
  if (!receipt || receipt.privateUnavailable || receipt.eventId !== row.event_id || receipt.action !== phase) error("experience_output_original_unavailable", 410);
  const envelope = await validateExperienceOutputEnvelope(receipt.payload.output_command_envelope, binding, phase, row.request_digest);
  return { envelope, receipt, sequence: Number(row.sequence), digest: row.request_digest };
}

async function originals(trusted: OutputTrustedContext, binding: ExperienceOutputBinding): Promise<Partial<Record<ExperienceOutputStage, Original>>> {
  const loaded: { originals: Partial<Record<ExperienceOutputStage, Original>> } = { originals: {} };
  let missing = false;
  for (const phase of phases) {
    const found = await original(trusted, binding, phase);
    if (found && missing) error("experience_output_stage_evidence_unavailable", 410);
    if (found) loaded.originals[phase] = found; else missing = true;
  }
  return loaded.originals;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
/** Only exact retained confirmed/preflight receipt identities may name a child.
 * No read of the arbitrary latest native plan participates in this join. */
export function scenePreparationPredecessor(binding: ExperienceOutputBinding, saved: Partial<Record<ExperienceOutputStage, Original>>): ScenePreparationPredecessor | null {
  if (!["scene", "video"].includes(binding.output) || !saved.confirm || !saved.preflight) return null;
  const confirmation = saved.confirm.receipt.payload, plan = confirmation.confirmed_plan;
  const preparation = saved.preflight.receipt.payload, preflight = preparation.preflight;
  if (!record(plan) || !record(preflight) || typeof plan.revisionId !== "string"
    || plan.revisionId !== confirmation.plan_revision_id || preflight.planRevisionId !== plan.revisionId
    || typeof preflight.id !== "string" || preflight.id !== preparation.preflight_id
    || preparation.plan_revision_id !== plan.revisionId || typeof plan.sourceDigest !== "string"
    || typeof plan.requirementsDigest !== "string" || preflight.sourceDigest !== plan.sourceDigest
    || preflight.requirementsDigest !== plan.requirementsDigest) error("experience_scene_renewal_lineage_unavailable", 410);
  return { ordinal: binding.preparationCycle?.ordinal ?? 0, cycleId: binding.preparationCycle?.id ?? null,
    confirmation: { key: saved.confirm.receipt.key, eventId: saved.confirm.receipt.eventId, digest: saved.confirm.digest, planRevisionId: plan.revisionId },
    preflight: { key: saved.preflight.receipt.key, eventId: saved.preflight.receipt.eventId, digest: saved.preflight.digest, preflightId: preflight.id },
    sourceDigest: plan.sourceDigest, requirementsDigest: plan.requirementsDigest };
}

export type ExperienceOutputLineage = {
  binding: ExperienceOutputBinding;
  originals: Partial<Record<ExperienceOutputStage, Original>>;
  /** Includes root and all predecessors, not only the selected phase subset. */
  witnesses: Original[];
  /** Exact observed index for a final atomic no-orphan/stale-selection fence. */
  cycleCommandKeys: string[];
};

/** Read-only contiguous lineage selection. Indexed holes, redaction and orphan
 * children fail closed; a damaged successor never falls back to the root. */
export async function readExperienceOutputLineage(trusted: OutputTrustedContext, root: ExperienceOutputBinding): Promise<ExperienceOutputLineage> {
  if (Object.hasOwn(root, "preparationCycle")) error("experience_scene_renewal_lineage_unavailable", 410);
  const initial = await originals(trusted, root);
  const result: ExperienceOutputLineage = { binding: root, originals: initial, witnesses: Object.values(initial), cycleCommandKeys: [] };
  if (root.output !== "scene" && root.output !== "video") return result;
  const prefix = scenePreparationCyclePrefix(root.draftId, root.output);
  const index = await trusted.env.DB.prepare(`SELECT command_key FROM output_commands
    WHERE scope_key=? AND actor_user_id=? AND substr(command_key,1,?)=? ORDER BY command_key LIMIT ?`)
    .bind(trusted.scope.key, trusted.scope.actorUserId, prefix.length, prefix, MAX_SCENE_PREPARATION_RENEWALS * 4 + 1)
    .all<{ command_key: string }>();
  if (!index.success || !Array.isArray(index.results) || index.results.length > MAX_SCENE_PREPARATION_RENEWALS * 4)
    error("experience_scene_renewal_lineage_unavailable", 410);
  const remaining = new Set(index.results.map(row => row.command_key));
  if (remaining.size !== index.results.length) error("experience_scene_renewal_lineage_unavailable", 410);
  for (let depth = 0; remaining.size && depth < MAX_SCENE_PREPARATION_RENEWALS; depth++) {
    // Any financial/execution receipt in a predecessor makes a child invalid,
    // even if that original execution failed or its charge later settled.
    if (result.originals.authorize || result.originals.run) error("experience_scene_renewal_lineage_unavailable", 410);
    const predecessor = scenePreparationPredecessor(result.binding, result.originals);
    if (!predecessor || !initial.save) error("experience_scene_renewal_lineage_unavailable", 410);
    const child = { ...root, preparationCycle: await scenePreparationSuccessor(root, predecessor) };
    const selected: Partial<Record<ExperienceOutputStage, Original>> = { save: initial.save };
    let missing = false;
    for (const phase of phases.slice(1)) {
      const key = await experienceOutputCommandKey(child, phase);
      const found = await original(trusted, child, phase);
      if (found && (missing || !remaining.delete(key))) error("experience_scene_renewal_lineage_unavailable", 410);
      if (found) { selected[phase] = found; result.witnesses.push(found); result.cycleCommandKeys.push(key); }
      else { if (remaining.has(key)) error("experience_scene_renewal_lineage_unavailable", 410); missing = true; }
    }
    if (!selected.confirm) error("experience_scene_renewal_lineage_unavailable", 410);
    result.binding = child; result.originals = selected;
  }
  if (remaining.size) error("experience_scene_renewal_lineage_unavailable", 410);
  return result;
}

export { original as readExperienceOutputOriginal, originals as readExperienceOutputOriginals, phases as experienceOutputPhases, error as experienceOutputError };
export type { Original as ExperienceOutputOriginal };
