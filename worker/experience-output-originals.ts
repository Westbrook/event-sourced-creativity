import { readOutputCommand, type OutputCommandReceipt } from "./output-command-core.ts";
import { experienceOutputCommandKey, validateExperienceOutputEnvelope,
  type ExperienceOutputBinding, type ExperienceOutputStage } from "./experience-output-binding.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";

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

export { original as readExperienceOutputOriginal, originals as readExperienceOutputOriginals, phases as experienceOutputPhases, error as experienceOutputError };
export type { Original as ExperienceOutputOriginal };
