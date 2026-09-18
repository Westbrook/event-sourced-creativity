import { readOutputCommand, type OutputCommandReceipt } from "./output-command-core.ts";
import { experienceOutputCommandKey, validateExperienceOutputEnvelope,
  type ExperienceOutputBinding, type ExperienceOutputStage } from "./experience-output-binding.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import { MAX_SCENE_PREPARATION_RENEWALS, scenePreparationCyclePrefix, scenePreparationSuccessor,
  type ScenePreparationPredecessor } from "./experience-scene-renewal.ts";
import { canonicalJson } from "../src/experiences/compiler.ts";
import { model3dReplacementPrefix, model3dReplacementCycleMatches, parseModel3dReplacementPredecessor,
  type Model3dReplacementPredecessor } from "./experience-model3d-replacement.ts";

function error(code: string, status = 409): never { throw Object.assign(new Error(code), { code, status }); }

type Original = { envelope: Record<string, unknown>; receipt: OutputCommandReceipt; sequence: number; digest: string };
type LineageContext = Pick<OutputTrustedContext, "env" | "scope">;
const phases = ["save", "confirm", "preflight", "authorize", "run"] as const;

/** Index first: a missing event/body is retained-unavailable, never a new intent. */
async function original(trusted: LineageContext, binding: ExperienceOutputBinding, phase: ExperienceOutputStage): Promise<Original | null> {
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

async function originals(trusted: LineageContext, binding: ExperienceOutputBinding): Promise<Partial<Record<ExperienceOutputStage, Original>>> {
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
  if (!["scene", "video", "model3d", "slides", "audio", "storyboard"].includes(binding.output) || binding.output === "model3d" && !binding.replacementCycle || !saved.confirm || !saved.preflight) return null;
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

/** Reuses every original receipt. Provider identity still needs a live owned
 * checkpoint comparison; accepting this pure join grants no replacement. */
export function model3dReplacementPredecessor(root: ExperienceOutputBinding, saved: Partial<Record<ExperienceOutputStage, Original>>,
  providerRequestId: string): Model3dReplacementPredecessor | null {
  if (root.output !== "model3d" || root.preparationCycle || root.replacementCycle
    || !saved.save || !saved.confirm || !saved.preflight || !saved.authorize || !saved.run) return null;
  const plan = saved.confirm.receipt.payload.confirmed_plan, preflight = saved.preflight.receipt.payload.preflight;
  const auth = saved.authorize.receipt.payload, run = saved.run.receipt.payload;
  if (!record(plan) || !record(preflight) || !Array.isArray(auth.authorized_targets) || auth.authorized_targets.length !== 1
    || !record(auth.authorized_targets[0]) || !record(plan.targetContractDigests)) return null;
  const target = auth.authorized_targets[0];
  if (plan.revisionId !== saved.confirm.receipt.payload.plan_revision_id || preflight.planRevisionId !== plan.revisionId
    || auth.plan_revision_id !== plan.revisionId || auth.preflight_id !== preflight.id || run.grant_id !== auth.grant_id
    || run.existing_jobs_only !== true || canonicalJson(run.job_ids) !== canonicalJson([target.job_id])
    || preflight.maximumMicrousd !== 400000 || preflight.maximumCalls !== 1
    || preflight.sourceDigest !== plan.sourceDigest || preflight.requirementsDigest !== plan.requirementsDigest
    || typeof target.target_id !== "string") return null;
  const witness = (value: Original) => ({ key: value.receipt.key, eventId: value.receipt.eventId, digest: value.digest });
  return parseModel3dReplacementPredecessor({ slotId: target.operation_slot_id, jobId: target.job_id, grantId: auth.grant_id,
    targetId: target.target_id, targetContractDigest: plan.targetContractDigests[target.target_id], sourceDigest: plan.sourceDigest,
    requirementsDigest: plan.requirementsDigest, providerRequestId, maximumMicrousd: 400000,
    confirmation: { ...witness(saved.confirm), planRevisionId: plan.revisionId },
    preflight: { ...witness(saved.preflight), preflightId: preflight.id }, authorization: witness(saved.authorize), run: witness(saved.run) });
}

async function model3dLineage(trusted: LineageContext, root: ExperienceOutputBinding, initial: ExperienceOutputLineage["originals"]): Promise<ExperienceOutputLineage> {
  const result: ExperienceOutputLineage = { binding: root, originals: initial, witnesses: Object.values(initial), cycleCommandKeys: [] };
  const prefix = model3dReplacementPrefix(root.draftId);
  const index = await trusted.env.DB.prepare(`SELECT command_key,request_digest FROM output_commands
    WHERE scope_key=? AND actor_user_id=? AND substr(command_key,1,?)=? ORDER BY command_key LIMIT 5`)
    .bind(trusted.scope.key, trusted.scope.actorUserId, prefix.length, prefix).all<{ command_key: string; request_digest: string }>();
  if (index.success === false || !Array.isArray(index.results) || index.results.length > 4) error("experience_model3d_replacement_lineage_unavailable", 410);
  if (!index.results.length) return result;
  const confirmation = index.results.filter(row => row.command_key.endsWith(":confirm"));
  if (confirmation.length !== 1) error("experience_model3d_replacement_lineage_unavailable", 410);
  const receipt = await readOutputCommand(trusted.env, trusted.scope, confirmation[0]!.command_key, confirmation[0]!.request_digest, { allowUnavailableReceipt: true });
  const envelope = receipt?.payload.output_command_envelope;
  if (!receipt || receipt.privateUnavailable || !record(envelope) || !record(envelope.experienceBinding)) error("experience_model3d_replacement_lineage_unavailable", 410);
  const candidate = envelope.experienceBinding, cycle = candidate.replacementCycle;
  if (!record(cycle) || !record(cycle.predecessor) || typeof cycle.predecessor.providerRequestId !== "string"
    || !await model3dReplacementCycleMatches(root, cycle)) error("experience_model3d_replacement_lineage_unavailable", 410);
  const prior = model3dReplacementPredecessor(root, initial, cycle.predecessor.providerRequestId);
  if (!prior || canonicalJson(prior) !== canonicalJson(cycle.predecessor)
    || canonicalJson(candidate) !== canonicalJson({ ...root, replacementCycle: cycle })) error("experience_model3d_replacement_lineage_unavailable", 410);
  const child = candidate as ExperienceOutputBinding, selected: ExperienceOutputLineage["originals"] = { save: initial.save };
  const remaining = new Set(index.results.map(row => row.command_key));
  if (remaining.size !== index.results.length) error("experience_model3d_replacement_lineage_unavailable", 410);
  let missing = false;
  for (const phase of phases.slice(1)) {
    const found = await original(trusted, child, phase);
    if (found && (missing || !remaining.delete(found.receipt.key))) error("experience_model3d_replacement_lineage_unavailable", 410);
    if (found) { selected[phase] = found; result.witnesses.push(found); result.cycleCommandKeys.push(found.receipt.key); }
    else missing = true;
  }
  if (!selected.confirm || remaining.size) error("experience_model3d_replacement_lineage_unavailable", 410);
  return { ...result, binding: child, originals: selected };
}

/** Read-only contiguous lineage selection. Indexed holes, redaction and orphan
 * children fail closed; a damaged successor never falls back to the root. */
export async function readExperienceOutputLineage(trusted: LineageContext, root: ExperienceOutputBinding): Promise<ExperienceOutputLineage> {
  if (Object.hasOwn(root, "preparationCycle") || Object.hasOwn(root, "replacementCycle")) error("experience_scene_renewal_lineage_unavailable", 410);
  const initial = await originals(trusted, root);
  const result: ExperienceOutputLineage = root.output === "model3d" ? await model3dLineage(trusted, root, initial)
    : { binding: root, originals: initial, witnesses: Object.values(initial), cycleCommandKeys: [] };
  if (root.output !== "scene" && root.output !== "video" && root.output !== "model3d" && root.output !== "slides" && root.output !== "audio" && root.output !== "storyboard") return result;
  const renewalRoot = result.binding;
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
    const child = { ...renewalRoot, preparationCycle: await scenePreparationSuccessor(renewalRoot, predecessor) };
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
