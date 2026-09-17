import { digest, record } from "../src/experiences/compiler.ts";
import { OPENAI_IMAGE_DIRECTION_CONTRACT, OPENAI_IMAGE_DIRECTION_SCHEMA, OPENAI_IMAGE_GENERATION_CONTRACT, OPENAI_IMAGE_MODERATION_CONTRACT } from "./openai-image-route-contract.ts";
import { selectImageAdapter } from "./image-adapter-selection.ts";
import { SponsorEntitlementError, type SponsorRecipe } from "./experience-sponsor-policy.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { WorkerEnv } from "./runtime.ts";
import { outputScopeAuthority, retainedOutputBodyAssertions, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputActiveSourceDeadlineAssertions } from "./output-disclosure-proof.ts";

/** Repeat native custody, exact source head/bytes and active rights at each
 * sponsor-only work transaction. This never changes the actor or financial owner. */
export function sponsorCurrentSourceAssertions(trusted: OutputTrustedContext): OutputSqlAssertion[] {
  if (!trusted.context || trusted.sourceProblems.length || !trusted.sourcePrivateCaptured) throw new SponsorEntitlementError("sponsor_source_unavailable");
  return [outputScopeAuthority(trusted.scope, "request"),
    { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [`creative:${trusted.scope.ownerUserId}`, trusted.ownerHead] },
    ...trusted.sourceAssertions, ...outputActiveSourceDeadlineAssertions(trusted.context), ...retainedOutputBodyAssertions(trusted.scope)];
}

/** Actual values shared with provider request builders; no value is copied from
 * a proposed sponsor template. API/schema/default changes alter this evidence. */
export async function sponsorImageTransport(env: WorkerEnv) {
  const selected = selectImageAdapter(env, { quality: "high", references: [] });
  const planning = OPENAI_IMAGE_DIRECTION_CONTRACT, image = OPENAI_IMAGE_GENERATION_CONTRACT, safety = OPENAI_IMAGE_MODERATION_CONTRACT;
  if (selected.provider !== "openai") throw new SponsorEntitlementError("sponsor_recipe_unsupported");
  return { planning: { api: planning.api, maximumOutputTokens: planning.maximumOutputTokens, reasoningEffort: planning.reasoning.effort,
    verbosity: planning.text.verbosity, format: { type: planning.text.format.type, name: planning.text.format.name, strict: planning.text.format.strict, schemaDigest: await digest(OPENAI_IMAGE_DIRECTION_SCHEMA) }, store: planning.store },
  image: { api: image.api, adapterId: selected.adapterId, adapterVersion: selected.adapterVersion, quality: image.defaults.quality,
    outputFormat: image.defaults.outputFormat, partialImages: image.defaults.partialImages, outputCount: image.outputCount },
  safety: { api: safety.api, provider: "openai", model: safety.model, maximumCalls: safety.maximumCalls, input: safety.input } };
}

export async function sponsorImageEvidence(env: WorkerEnv, recipe: SponsorRecipe, offered: unknown) {
  if (!record(offered) || !record(offered.settings) || await digest(offered) !== recipe.routeDigest || await digest(offered.settings) !== recipe.settingsDigest)
    throw new SponsorEntitlementError("sponsor_native_envelope_mismatch");
  return { recipe, offered, transport: await sponsorImageTransport(env) };
}

/** The existing descriptor has already checked source/custody/call lineage. This
 * reread must match its exact immutable quote before v2 uses stable templates. */
export async function readSponsorImageTemplateEvidence(trusted: OutputTrustedContext, command: Record<string, unknown>, recipe: SponsorRecipe) {
  const row = await trusted.env.DB.prepare(`SELECT body.private_json FROM output_preflights preflight
    JOIN event_private_payloads body ON body.private_event_id=preflight.event_id AND body.owner_id=? AND body.project_id=? AND body.document_id=? AND body.redacted_at IS NULL
    WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=?`)
    .bind(trusted.scope.ownerUserId, trusted.scope.projectId, trusted.scope.documentId, trusted.scope.key, String(command.preflightId), trusted.scope.actorUserId).first<{ private_json: string }>();
  const body: unknown = row ? JSON.parse(row.private_json) : null;
  const preflight = record(body) && record(body.preflight) ? body.preflight : null;
  const offered = preflight && Array.isArray(preflight.targets) && preflight.targets.length === 1 ? preflight.targets[0] : null;
  return sponsorImageEvidence(trusted.env, recipe, offered);
}
