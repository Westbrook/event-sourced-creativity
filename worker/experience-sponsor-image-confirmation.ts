import { canonicalJson, record } from "../src/experiences/compiler.ts";
import { experienceSourceMismatch } from "../src/experiences/host-source.ts";
import { experienceResourceId, registeredExperience } from "../src/experiences/intake.ts";
import type { ExperienceIntakeReceipt } from "../src/experiences/native-host.ts";
import { experienceOutputBinding, experienceOutputCommandKey, experienceOutputEnvelope,
  validateExperienceOutputEnvelope, type ExperienceOutputBinding } from "./experience-output-binding.ts";
import { createExperienceOutputRecipe, matchExperienceOutputRecipeTarget, type ExperienceOutputRecipe } from "./experience-output-recipe.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { createSponsorImageConfirmationAllowance, requireSponsorImageConfirmationAllowance,
  readSponsorImageConfirmationOriginal, sponsorImageConfirmationEnvironment, sponsorImageConfirmationAssertions,
  requireSponsorImageConfirmationWrite, refreshSponsorImageConfirmationReceipt, finishSponsorImageConfirmation,
  type SponsorImageConfirmationAllowance } from "./experience-sponsor-intake-reads.ts";
import { continueOutputTrustedContext } from "./output-trusted-context.ts";
import { outputExperienceCommands, type OutputTrustedContext } from "./output-requirements-api.ts";
import { outputDocumentExecutionBridge } from "./output-document-execution.ts";
import { readOutputCommand, outputCommandReceiptAssertion, outputScopeAuthority,
  retainedOutputBodyAssertions, type OutputCommandReceipt, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputActiveSourceDeadlineAssertions } from "./output-disclosure-proof.ts";
import { inheritRuntimeSchemaReadiness, type WorkerEnv, type WorkerExecutionContext } from "./runtime.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const noDetachedWork: WorkerExecutionContext = { waitUntil() { fail("sponsor_confirmation_detached_work_unsupported"); } };
type Stage = "save" | "confirm";
type Original = { receipt: OutputCommandReceipt; envelope: Record<string, unknown>; sequence: number };
type Saved = Awaited<ReturnType<typeof readSponsorImageConfirmationOriginal>>;
type Loaded = { trusted: OutputTrustedContext; saved: Saved; binding: ExperienceOutputBinding;
  recipe: ExperienceOutputRecipe; originals: Partial<Record<Stage, Original>> };

function fields(recipe: ExperienceOutputRecipe, phase: Stage): Record<string, unknown> {
  return phase === "save" ? { blockId: recipe.spec.id, spec: recipe.spec, explicitRequirementsConfirmation: true }
    : { explicitRequirementsConfirmation: true };
}

/** These are the same native stage identities used by the canonical Image
 * host. A changed source or release cannot escape its original stage key. */
async function original(trusted: OutputTrustedContext, binding: ExperienceOutputBinding, recipe: ExperienceOutputRecipe,
  phase: Stage): Promise<Original | null> {
  const key = await experienceOutputCommandKey(binding, phase);
  const row = await trusted.env.DB.prepare(`SELECT command.request_digest,command.event_id,event.sequence
    FROM output_commands command LEFT JOIN events event ON event.event_id=command.event_id
    WHERE command.scope_key=? AND command.actor_user_id=? AND command.command_key=?`)
    .bind(trusted.scope.key, trusted.scope.actorUserId, key).first<{ request_digest: string; event_id: string; sequence: number | null }>();
  if (!row) return null;
  if (typeof row.request_digest !== "string" || !Number.isSafeInteger(row.sequence) || Number(row.sequence) < 1)
    return fail("sponsor_confirmation_original_unavailable");
  const receipt = await readOutputCommand(trusted.env, trusted.scope, key, row.request_digest, { allowUnavailableReceipt: true });
  if (!receipt || receipt.privateUnavailable || receipt.eventId !== row.event_id || receipt.action !== phase)
    return fail("sponsor_confirmation_original_unavailable");
  const envelope = await validateExperienceOutputEnvelope(receipt.payload.output_command_envelope, binding, phase, row.request_digest);
  const expected = await experienceOutputEnvelope(binding, phase, Number(String(envelope.expectedRevision).slice(7)), fields(recipe, phase));
  if (canonicalJson(envelope) !== canonicalJson(expected)) return fail("sponsor_confirmation_original_changed");
  return { receipt, envelope, sequence: Number(row.sequence) };
}

function validateRequirement(loaded: Loaded) {
  const { trusted, recipe, originals } = loaded, saved = originals.save;
  const matches = trusted.projection.libraryBlocks.filter(block => block.id === recipe.spec.id);
  if (!saved) {
    if (matches.length || trusted.requirements.length) fail("sponsor_confirmation_unbound_requirement");
    return;
  }
  const block = matches[0], payload = saved.receipt.payload;
  if (matches.length !== 1 || !block || trusted.requirements.length !== 1
    || trusted.requirements[0]?.blockId !== recipe.spec.id || trusted.requirements[0]?.status !== "valid"
    || canonicalJson(trusted.requirements[0]?.spec) !== canonicalJson(recipe.spec)
    || payload.block_id !== recipe.spec.id || payload.type !== "output" || payload.scope !== "document"
    || payload.project_id !== trusted.scope.projectId || payload.document_id !== trusted.scope.documentId
    || !record(payload.properties) || canonicalJson(payload.properties.output_spec) !== canonicalJson(recipe.spec)
    || block.type !== "output" || block.scope !== "document" || block.removed || block.locked || block.canvasId !== ""
    || block.projectId !== trusted.scope.projectId || block.documentId !== trusted.scope.documentId
    || block.handle !== payload.handle || block.position !== payload.position
    || canonicalJson(block.properties) !== canonicalJson(payload.properties)
    || canonicalJson(block.sourceEvents) !== canonicalJson([saved.receipt.eventId])) fail("sponsor_confirmation_requirement_changed");
  const events = trusted.events.filter(event => event.eventId === saved.receipt.eventId);
  if (events.length !== 1 || events[0]!.type !== "BlockCreated" || events[0]!.actor !== `user:${trusted.scope.actorUserId}`
    || events[0]!.streamId !== `creative:${trusted.scope.ownerUserId}` || events[0]!.sequence !== saved.sequence
    || canonicalJson(events[0]!.payload) !== canonicalJson(payload)) fail("sponsor_confirmation_requirement_evidence_unavailable");
}

async function load(cap: SponsorImageConfirmationAllowance, request: Request, env: WorkerEnv): Promise<Loaded> {
  const selected = requireSponsorImageConfirmationAllowance(cap, request, env);
  const saved = await readSponsorImageConfirmationOriginal(cap, request, env), plan = saved.plan;
  if (plan.release.definition.id !== "image" || plan.release.output.output !== "image"
    || Object.hasOwn(plan, "reference") || Object.hasOwn(plan.request, "reference")) fail("sponsor_confirmation_image_required");
  const ratio = plan.request.values.ratio;
  if (!ratio || ratio.provenance !== "authored" || !record(ratio.value)) fail("sponsor_confirmation_ratio_required");
  const binding = await experienceOutputBinding(plan);
  const recipe = createExperienceOutputRecipe({ output: "image",
    requirementId: await experienceResourceId(plan.draftId, "native-output-requirement"),
    deliverableId: await experienceResourceId(plan.draftId, "native-output-deliverable"),
    variantId: await experienceResourceId(plan.draftId, "native-output-variant"),
    aspectRatio: ratio.value as { width: number; height: number } });
  const nativeEnv = sponsorImageConfirmationEnvironment(cap, request, env);
  // The native Output lifecycle is entered here, not by ordinary intake/read
  // consumers of the capability leaf. Preserve only existing schema readiness;
  // this neither initializes schema nor marks an unready database as ready.
  inheritRuntimeSchemaReadiness(env.DB, nativeEnv.DB);
  const trusted = await continueOutputTrustedContext(request, nativeEnv, plan.documentId,
    selected.mode === "confirm" ? "author" : "read", saved.auth);
  if (trusted instanceof Response) return fail("sponsor_confirmation_source_unavailable");
  if (trusted.scope.kind !== "personal" || trusted.scope.actorUserId !== saved.auth.user.userId
    || trusted.scope.ownerUserId !== saved.auth.user.userId || trusted.scope.documentId !== plan.documentId
    || trusted.scope.projectId !== plan.projectId || trusted.sourceProblems.length || !trusted.sourcePrivateCaptured || !trusted.context)
    fail("sponsor_confirmation_source_unavailable");
  trusted.sourceAssertions.push(...sponsorImageConfirmationAssertions(cap, request, env));
  const originals: Loaded["originals"] = {};
  const save = await original(trusted, binding, recipe, "save"), confirm = await original(trusted, binding, recipe, "confirm");
  if (confirm && !save) fail("sponsor_confirmation_stage_evidence_unavailable");
  if (save) originals.save = save;
  if (confirm) originals.confirm = confirm;
  trusted.sourceAssertions.push(...Object.values(originals).map(value => outputCommandReceiptAssertion(trusted.scope, value.receipt)));
  const loaded = { trusted, saved, binding, recipe, originals };
  validateRequirement(loaded);
  if (experienceSourceMismatch(plan, saved.nativeReceipt as ExperienceIntakeReceipt, {
    documentId: trusted.projection.documentId, projectId: trusted.projection.projectId, documents: trusted.projection.documents,
    blocks: trusted.projection.libraryBlocks.filter(block => block.id !== recipe.spec.id),
    relations: trusted.projection.libraryBlockRelations, events: trusted.events }) !== null) fail("sponsor_confirmation_source_changed");
  return loaded;
}

async function confirmation(loaded: Loaded) {
  const original = loaded.originals.confirm;
  if (!original) return null;
  const id = original.receipt.payload.plan_revision_id;
  if (typeof id !== "string") return fail("sponsor_confirmation_plan_unavailable");
  const plan = await outputExperienceCommands.readConfirmedPlan(loaded.trusted, id);
  const latest = await outputExperienceCommands.readConfirmedPlan(loaded.trusted);
  if (!plan || latest?.revisionId !== id || canonicalJson(plan) !== canonicalJson(original.receipt.payload.confirmed_plan)
    || !matchExperienceOutputRecipeTarget(loaded.recipe, plan.plan, { documentId: loaded.binding.documentId,
      sourceRevision: loaded.trusted.sourceDigest, requirementRevision: loaded.trusted.requirementsDigest }))
    return fail("sponsor_confirmation_plan_changed");
  return plan;
}

function currentProofs(loaded: Loaded): OutputSqlAssertion[] {
  const trusted = loaded.trusted;
  return [outputScopeAuthority(trusted.scope, "read"),
    { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [loaded.binding.streamId, trusted.ownerHead] },
    ...trusted.sourceAssertions, ...outputActiveSourceDeadlineAssertions(trusted.context!), ...retainedOutputBodyAssertions(trusted.scope)];
}

async function finish(cap: SponsorImageConfirmationAllowance, request: Request, env: WorkerEnv, loaded: Loaded, replayed: boolean) {
  const plan = await confirmation(loaded), selected = requireSponsorImageConfirmationAllowance(cap, request, env);
  const identity = (value: Original) => ({ key: value.receipt.key, eventId: value.receipt.eventId, requestDigest: value.receipt.requestDigest });
  const body = { version: 1, kind: "sponsor-image-confirmation", status: plan ? "confirmed" : "unconfirmed",
    generation: "unavailable", actorUserId: loaded.trusted.scope.actorUserId, campaignId: selected.campaignId,
    binding: loaded.binding, replayed,
    ...(plan ? { planRevisionId: plan.revisionId, targetId: loaded.recipe.targetId,
      receipts: { save: identity(loaded.originals.save!), confirm: identity(loaded.originals.confirm!) } } : {}) };
  return finishSponsorImageConfirmation(cap, request, env, body, 200, currentProofs(loaded));
}

/** Dormant, read-only reopening of the exact native confirmation. This never
 * saves, preflights, authorizes, runs, or installs a schema. */
export async function readSponsorImageConfirmation(request: Request, env: WorkerEnv, draftId: string) {
  if (request.method !== "GET") return fail("sponsor_confirmation_get_required");
  const cap = await createSponsorImageConfirmationAllowance(request, env, draftId);
  return finish(cap, request, env, await load(cap, request, env), true);
}

/** Deliberate actual POST only. Each native stage commits with the full original
 * source/read proof. A saved stage can survive a later refusal and is recovered
 * by its exact original key on the next newly charged request. */
export async function confirmSponsorImageOutput(request: Request, env: WorkerEnv, draftId: string) {
  if (request.method !== "POST") return fail("sponsor_confirmation_post_required");
  const cap = await createSponsorImageConfirmationAllowance(request, env, draftId);
  let loaded = await load(cap, request, env), replayed = true;
  for (const phase of ["save", "confirm"] as const) {
    if (loaded.originals[phase]) continue;
    const current = await registeredExperience("image");
    if (!current || canonicalJson(current) !== canonicalJson(loaded.saved.plan.release)) fail("sponsor_confirmation_release_changed");
    if (phase === "confirm" && await outputExperienceCommands.readConfirmedPlan(loaded.trusted)) fail("sponsor_confirmation_unbound_plan");
    const live = await requireSponsorImageConfirmationWrite(cap, request, env);
    loaded.trusted.sourceAssertions.push(...live, ...outputActiveSourceDeadlineAssertions(loaded.trusted.context!));
    const envelope = await experienceOutputEnvelope(loaded.binding, phase, loaded.trusted.ownerHead, fields(loaded.recipe, phase));
    const result = await outputExperienceCommands.execute(loaded.trusted, envelope, outputDocumentExecutionBridge, noDetachedWork);
    if (result instanceof Response) return fail("sponsor_confirmation_native_refused");
    replayed = false;
    await refreshSponsorImageConfirmationReceipt(cap, request, env);
    loaded = await load(cap, request, env);
    if (!loaded.originals[phase] || loaded.originals[phase]!.receipt.eventId !== result.receipt.eventId)
      fail("sponsor_confirmation_stage_evidence_unavailable");
  }
  return finish(cap, request, env, loaded, replayed);
}
