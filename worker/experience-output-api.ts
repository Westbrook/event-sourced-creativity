import { readVideoExecutionOffer } from "../src/model/output-video-offer.ts";
import { model3dMiniAppCostApprovalMatches, model3dMiniAppAttemptMatches, type Model3dMiniAppCostPreview } from "../src/model/model3d-mini-app-consent.ts";
import { model3dReplacementSuccessor } from "./experience-model3d-replacement.ts";
import { captureModel3dReplacementParent, model3dReplacementIndexAssertion } from "./experience-model3d-replacement-proof.ts";
import { readOutputModel3dPayload } from "./output-model3d-execution.ts";
import { experienceModel3dOutputContract } from "./experience-model3d-recipe.ts";
import { prepareExperienceModel3dReference } from "./experience-model3d-reference-source.ts";
import { prepareExperienceVideoOutputSource } from "./experience-video-output-source.ts";
import { parseAudioMiniAppCostPreview, audioMiniAppCostApprovalMatches, type AudioMiniAppCostPreview } from "../src/model/audio-mini-app-consent.ts";
import { createAudioOutputContract } from "../src/model/output-audio-contract.ts";
import { createStoryboardOutputContract } from "../src/model/output-storyboard-contract.ts";
import { readStoryboardExecutionOffer } from "../src/model/output-storyboard-offer.ts";
import { createSceneOutputContract } from "../src/model/output-scene-contract.ts";
import { sceneMiniAppCostApprovalMatches } from "../src/model/scene-mini-app-consent.ts";
import { readOutputScenePayload } from "./output-scene-preflight-contract.ts";
import { outputScenePreparationIdentity } from "./output-scene-source.ts";
import { outputVideoPreparationIdentity } from "./output-video-source.ts";
import { scenePreparationSuccessor } from "./experience-scene-renewal.ts";
import { sceneRenewalIndexAssertion, sceneRenewalNoExecutionAssertion, sceneRenewalWindowAssertion, sceneRenewalPredecessorAssertion } from "./experience-scene-renewal-proof.ts";
import { SHORT_STORY_NARRATIVE_CONTRACT } from "../src/model/output-narrative-contract.ts";
import { recoverOutputFalImage } from "./output-fal-recovery.ts";
import { recoverOutputVideo } from "./output-video-recovery.ts";
import { recoverOutputModel3d } from "./output-model3d-recovery.ts";
import { outputModel3dRecoveryAvailable } from "./output-model3d-recovery-availability.ts";
import { retainedPersonalFalRecoverySql, falRecoveryJobStateAllowed, type FalRecoveryStage } from "./output-fal-recovery-policy.ts";
import { outputSourceEpochAssertion } from "./output-requirements-ledger.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import { canonicalJson } from "../src/experiences/compiler.ts";
import { experienceResourceId, receiptPrefix, registeredExperience } from "../src/experiences/intake.ts";
import { experienceSourceMismatch } from "../src/experiences/host-source.ts";
import type { ExperienceIntakeReceipt } from "../src/experiences/native-host.ts";
import type { ExperienceNativeState, ExperienceNativeUnavailable } from "../src/experiences/output-binding-contract.ts";
import { authorizeExperienceIntake, readExperienceDraft, experienceDraftGuard, readExperienceBody } from "./experience-intake-api.ts";
import { commitAtomicIntake } from "./project-intake.ts";
import { loadOutputTrustedContext, outputExperienceCommands, type OutputExecutionBridge, type OutputTrustedContext } from "./output-requirements-api.ts";
import { outputCommandReceiptAssertion } from "./output-command-core.ts";
import { outputProofCapacityDiagnostic, type OutputProofCapacityReason } from "./output-proof-capacity-diagnostic.ts";
import { experienceOutputAuthorization, experienceOutputBinding, experienceOutputEnvelope,
  type ExperienceOutputBinding, type ExperienceOutputStage } from "./experience-output-binding.ts";
import { createExperienceOutputRecipe, matchExperienceOutputRecipeTarget, type ExperienceOutputRecipe } from "./experience-output-recipe.ts";
import type { WorkerEnv, WorkerExecutionContext } from "./runtime.ts";
import { readExperienceOutputLineage, model3dReplacementPredecessor, scenePreparationPredecessor, experienceOutputPhases as phases, experienceOutputError as error,
  type ExperienceOutputLineage, type ExperienceOutputOriginal as Original } from "./experience-output-originals.ts";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const diagnosticCodes = new Set(`not_found method_not_allowed same_origin_required experience_output_request_invalid experience_output_unavailable
experience_output_unbound_requirement experience_output_requirement_changed experience_output_requirement_evidence_unavailable experience_draft_unavailable
experience_image_ratio_required experience_scene_contract_unavailable experience_audio_contract_unavailable experience_storyboard_contract_unavailable experience_model3d_contract_unavailable
experience_intake_original_unavailable experience_output_scope_changed output_video_source_changed experience_model3d_original_changed experience_output_source_changed experience_output_source_unavailable
experience_output_plan_unavailable experience_output_plan_changed experience_output_preflight_changed experience_video_preflight_unavailable experience_model3d_preflight_unavailable experience_storyboard_preflight_unavailable experience_scene_preflight_unavailable
experience_output_unbound_operation experience_output_original_authorization_unavailable experience_output_original_operation_changed experience_scene_original_consent_unavailable experience_output_original_job_unavailable experience_model3d_original_consent_unavailable experience_audio_original_consent_unavailable
experience_output_original_run_unavailable experience_output_original_grant_unavailable experience_video_original_attempt_unavailable experience_storyboard_original_attempt_unavailable experience_audio_recovery_unavailable
experience_audio_confirmation_required experience_model3d_confirmation_required experience_model3d_image_recovery_forbidden experience_storyboard_recovery_unavailable experience_review_stale experience_scene_confirmation_required experience_release_changed
experience_scene_renewal_required experience_scene_renewal_unavailable experience_scene_renewal_lineage_unavailable experience_scene_renewal_scope_unavailable
experience_output_recipe_confirmation_required experience_output_unbound_plan experience_output_unbound_preflight experience_output_preflight_required experience_output_authorization_unavailable experience_output_authorization_terms_changed
experience_output_explicit_run_required experience_output_run_unavailable output_source_epoch_required experience_output_explicit_recovery_required experience_output_native_refused
experience_output_original_unavailable experience_output_stage_evidence_unavailable mutation_key_reused_with_different_content output_command_scope_mismatch original_command_content_unavailable invalid_output_scope
output_revision_or_authority_changed invalid_output_requirement output_active_commitment_requires_cancellation output_requirements_need_confirmation invalid_output_plan output_scope_amendment_reason_required output_private_evidence_unavailable output_requirements_failed
experience_output_original_envelope_unavailable experience_output_binding_invalid experience_output_revision_invalid experience_output_envelope_invalid experience_scene_recipe_invalid output_revision_conflict confirmed_output_plan_required output_plan_needs_reconfirmation output_plan_evidence_mismatch output_read_model_unavailable output_source_private_evidence_unavailable output_block_identity_unavailable requirement_block_identity_mismatch output_requirements_required output_interpretation_review_required finite_target_selection_required target_not_selected_in_confirmed_plan
output_scene_original_unavailable output_scene_personal_source_required output_scene_target_changed output_scene_source_changed output_scene_requirement_changed output_scene_original_expired
scene_cost_changed scene_cost_authority_changed scene_cost_request_required scene_cost_request_invalid document_not_found context_source_rights_expired scene_cost_confirmation_required
context_block_not_authorized context_source_not_authorized context_source_version_mismatch context_source_evidence_unavailable context_source_rights_required context_decisions_contradict
output_source_proof_too_large output_source_changed_during_read`.split(/\s+/u));
type DiagnosticStage = "initial_load" | "final_load" | "final_state" | "final_disclose" | "authorize" | "run" | "recover_result" | `recover_result_${FalRecoveryStage}` | `prepare_${"save" | "confirm" | "preflight"}_${"state" | "execute" | "reload"}`;
function diagnosticKind(cause: unknown) {
  if (!(cause instanceof Error)) return "unknown";
  const message = cause.message.slice(0, 2048);
  if (/CHECK constraint failed|UNIQUE constraint failed/iu.test(message)) return "db_constraint";
  if (/no such (?:table|column)|too many SQL variables|SQLITE_SCHEMA/iu.test(message)) return "db_schema";
  if (/SQLITE_BUSY|database is locked/iu.test(message)) return "db_busy";
  if (["TypeError", "SyntaxError", "RangeError", "AbortError"].includes(cause.name)) return cause.name;
  return "unknown";
}
// Fixed log-only labels. This is diagnosis, not permission, retryability or
// evidence that any paid request reached a provider. Public errors stay unchanged.
const nativeDiagnosticSubtypes = new Map([
  ["bridge_target_mismatch", "bridge_target_mismatch"],
  ["bridge_preflight_incomplete", "bridge_preflight_incomplete"],
  ["bridge_provider_call_routes_required", "bridge_provider_call_routes_required"],
  ["bridge_provider_call_routes_invalid", "bridge_provider_call_routes_invalid"],
  // Fixed original-image recovery failures are log-only. Public responses still
  // disclose no retained provider identity, private checkpoint or source detail.
  ...[
    "output_native_operation_required", "output_execution_contract_changed", "output_execution_grant_inactive",
    "output_fal_recovery_job_unavailable", "output_fal_recovery_scope_unsupported", "output_fal_recovery_route_unsupported",
    "output_fal_recovery_contract_unavailable", "output_fal_recovery_checkpoint_unavailable", "output_fal_recovery_completion_unavailable",
    "output_fal_recovery_content_unavailable", "output_fal_recovery_plan_unavailable", "output_fal_recovery_call_unavailable",
    "output_fal_recovery_origin_unavailable", "output_fal_recovery_provenance_unavailable", "output_fal_recovery_canceled",
    "output_fal_recovery_settlement_unavailable", "output_fal_recovery_unavailable", "output_fal_recovery_receipt_mismatch",
    "output_fal_recovery_result_unavailable", "output_fal_result_outside_contract", "output_fal_result_too_large", "output_fal_result_empty", "output_fal_redirect_refused",
    "output_fal_recovery_ack_unavailable",
    "output_fal_checkpoint_invalid", "output_job_binding_missing", "output_job_scope_mismatch", "output_execution_authority_revoked", "output_execution_scope_mismatch",
    "output_execution_grant_not_found", "output_execution_context_changed",
  ].map(code => [code, code] as const),
]);
const providerDiagnosticCodes = new Set([
  "fal_provider_returned_no_image", "fal_provider_returned_invalid_image_url", "fal_provider_returned_untrusted_image_url",
  "fal_provider_returned_empty_image", "fal_provider_returned_non_image", "fal_provider_returned_invalid_request_id", "fal_provider_receipt_mismatch",
]);
const providerDiagnosticStatuses = new Map([[400,"provider_http_400"],[401,"provider_http_401"],[403,"provider_http_403"],[404,"provider_http_404"],
  [408,"provider_http_408"],[409,"provider_http_409"],[410,"provider_http_410"],[422,"provider_http_422"],[429,"provider_http_429"],
  [500,"provider_http_500"],[502,"provider_http_502"],[503,"provider_http_503"],[504,"provider_http_504"]]);
const providerDiagnosticCategories = new Map([["safety","provider_safety"],["authentication","provider_authentication"],["access","provider_access"],
  ["quota","provider_quota"],["rate_limit","provider_rate_limit"],["network","provider_network"],["canceled","provider_canceled"],
  ["provider","provider_refused"],["server","provider_server"],["unknown","provider_unknown"]]);
function diagnosticSubtype(cause: unknown): string | undefined {
  let current: unknown = cause, fallback: string | undefined;
  // D1 wrappers may retain the actionable error in cause. Only own data
  // properties, three nodes and 2048 message characters per node are inspected.
  // No stack, arbitrary object serialization, getters or recursive traversal.
  try { for (let depth = 0; depth < 3 && record(current); depth++) {
    const code = Object.getOwnPropertyDescriptor(current, "code")?.value;
    const raw = Object.getOwnPropertyDescriptor(current, "message")?.value;
    const native = nativeDiagnosticSubtypes.get(typeof code === "string" ? code : typeof raw === "string" ? raw : "");
    if (native) return native;
    if (!(current instanceof Error)) break;
    // Only fixed labels from own data properties, never a provider message,
    // URL, request identifier, prepared prompt, arbitrary code or accessor.
    if(Object.getOwnPropertyDescriptor(current,"name")?.value==="ProviderRequestError"){
      const detail=Object.getOwnPropertyDescriptor(current,"detail")?.value;
      if(record(detail)){
        const providerCode=Object.getOwnPropertyDescriptor(detail,"code")?.value;
        if(typeof providerCode==="string"&&providerDiagnosticCodes.has(providerCode))return providerCode;
        const status=Object.getOwnPropertyDescriptor(detail,"httpStatus")?.value;
        if(typeof status==="number"&&providerDiagnosticStatuses.has(status))return providerDiagnosticStatuses.get(status);
        const category=Object.getOwnPropertyDescriptor(detail,"category")?.value;
        if(typeof category==="string"&&providerDiagnosticCategories.has(category))return providerDiagnosticCategories.get(category);
      }
    }
    const message = typeof raw === "string" ? raw.slice(0, 2048) : "";
    if (/\b(?:CHECK|UNIQUE|FOREIGN KEY|NOT NULL) constraint failed\b|\bSQLITE_CONSTRAINT(?:_[A-Z_]+)?\b/iu.test(message)) return "d1_constraint";
    if (/\bWrong number of parameter bindings\b|\bSQLITE_RANGE\b/iu.test(message)) return "d1_binding_count";
    if (/\bD1_TYPE_ERROR\b/u.test(message)) return "d1_binding_type";
    if (/\bExpression tree is too large\b/iu.test(message)) return "d1_expression_depth";
    if (/\bparser stack overflow\b/iu.test(message)) return "d1_parser_depth";
    if (/\bmalformed JSON\b/iu.test(message)) return "d1_malformed_json";
    if (/\bambiguous column name\b/iu.test(message)) return "d1_ambiguous_column";
    if (/\bSQLITE_AUTH\b|\bnot authorized\b/iu.test(message)&&/\bD1_ERROR\b|\bSQLITE_AUTH\b/u.test(message)) return "d1_sql_authorization";
    if (/\bSQL statement too long\b|\bstatement is too long\b/iu.test(message)) return "d1_statement_length";
    if (/\btoo many terms in compound SELECT\b/iu.test(message)) return "d1_compound_limit";
    if (/\btoo many SQL variables\b/iu.test(message)) return "d1_parameter_limit";
    if (/\bSQLITE_TOOBIG\b|\bstring or blob too big\b/iu.test(message)) return "d1_value_limit";
    if (/\bSQLITE_BUSY\b|\bSQLITE_LOCKED\b|\bdatabase is locked\b/iu.test(message)) return "d1_busy";
    if (/\bno such (?:table|column)\b|\bSQLITE_SCHEMA\b/iu.test(message)) return "d1_schema";
    if (/\bToo many API requests by single worker invocation\b|\bToo many subrequests\b/iu.test(message)) return "worker_subrequest_limit";
    if (/\bD1_ERROR:\s*too many queries\b/iu.test(message)) return "d1_query_limit";
    if (/\bD1_ERROR\b|\bSQLITE_ERROR\b/u.test(message)) fallback = "d1_error";
    current = Object.getOwnPropertyDescriptor(current, "cause")?.value;
  } } catch { /* Optional diagnosis must never replace the original refusal. */ }
  return fallback;
}
const unavailable = (code: string, status = 409, diagnostic?: { stage: DiagnosticStage; kind: string; capacity?: OutputProofCapacityReason }) => {
  const safeCode = diagnosticCodes.has(code) ? code : "experience_output_unavailable";
  // The platform associates this bounded code with its request log. Never log
  // source text, request bodies, provider responses, credentials or actor data.
  console.warn("experience_output_refused", { code: safeCode, status, ...(diagnostic ?? {}) });
  return Response.json({ version: 1, status: "unavailable", error: safeCode,
  originalIntent: "unknown_or_retained", permitted: { prepare: false, authorize: false, run: false, resumeRun: false, recoverResult: false } } satisfies ExperienceNativeUnavailable,
{ status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
};
async function refused(response: Response): Promise<Response> {
  const value: unknown = await response.json().catch(() => null);
  const code = record(value) && typeof value.error === "string" && /^[a-z][a-z0-9_]+$/u.test(value.error)
    ? value.error : "experience_output_unavailable";
  const result = unavailable(code, response.status >= 400 && response.status < 600 ? response.status : 409);
  // Preserve authentication/consent response headers without retaining stale body
  // encoding, length or cache metadata from the replaced refusal representation.
  for (const [name, value] of response.headers) if (!["content-type", "content-length", "content-encoding", "cache-control", "x-content-type-options"].includes(name)) result.headers.set(name, value);
  return result;
}
type Loaded = { trusted: OutputTrustedContext; binding: ExperienceOutputBinding; recipe: ExperienceOutputRecipe;
  /** Passive completed Image inspection only; never permission to rebase a command. */
  retainedImageSourceChanged?: boolean;
  retained: NonNullable<Awaited<ReturnType<typeof readExperienceDraft>>>; receipt: ExperienceIntakeReceipt;
  rootBinding: ExperienceOutputBinding; lineage: ExperienceOutputLineage;
  originals: Partial<Record<ExperienceOutputStage, Original>> };

function validateManagedRequirement(loaded: Loaded) {
  const { trusted, recipe } = loaded, saved = loaded.originals.save;
  const matches = trusted.projection.libraryBlocks.filter(block => block.id === recipe.spec.id);
  if (!saved) { if (matches.length) error("experience_output_unbound_requirement", 410); return; }
  const payload = saved.receipt.payload, block = matches[0];
  if (matches.length !== 1 || !block || payload.block_id !== recipe.spec.id || payload.type !== "output"
    || payload.scope !== "document" || payload.project_id !== trusted.scope.projectId || payload.document_id !== trusted.scope.documentId
    || !record(payload.properties) || canonicalJson(payload.properties.output_spec) !== canonicalJson(recipe.spec)
    || block.type !== "output" || block.scope !== "document" || block.removed || block.locked || block.canvasId !== ""
    || block.projectId !== trusted.scope.projectId || block.documentId !== trusted.scope.documentId
    || block.handle !== payload.handle || block.position !== payload.position
    || canonicalJson(block.properties) !== canonicalJson(payload.properties)
    || canonicalJson(block.sourceEvents) !== canonicalJson([saved.receipt.eventId])) error("experience_output_requirement_changed");
  const events = trusted.events.filter(event => event.eventId === saved.receipt.eventId);
  if (events.length !== 1 || events[0]!.type !== "BlockCreated" || events[0]!.actor !== `user:${trusted.scope.actorUserId}`
    || events[0]!.streamId !== `creative:${trusted.scope.ownerUserId}` || events[0]!.sequence !== saved.sequence
    || canonicalJson(events[0]!.payload) !== canonicalJson(payload)) error("experience_output_requirement_evidence_unavailable", 410);
}

async function load(request: Request, env: WorkerEnv, draftId: string, permission: "read" | "author" | "request"): Promise<Loaded | Response> {
  const auth = await authorizeExperienceIntake(request, env); if (auth instanceof Response) return refused(auth);
  const retained = await readExperienceDraft(env, auth, draftId); if (!retained) error("experience_draft_unavailable", 410);
  const plan = retained.plan, binding = await experienceOutputBinding(plan);
  const ratio = plan.request.values.ratio;
  if (binding.output === "image" && (!ratio || ratio.provenance !== "authored" || !record(ratio.value))) error("experience_image_ratio_required");
  const identities = { requirementId: await experienceResourceId(draftId, "native-output-requirement"), deliverableId: await experienceResourceId(draftId, "native-output-deliverable") };
  const sceneContract = binding.output === "scene" ? createSceneOutputContract({ draftId: binding.draftId, draftHash: binding.draftHash,
    releaseHash: binding.releaseHash, requestHash: binding.requestHash, sourceBindingHash: binding.sourceBindingHash }) : null;
  if (binding.output === "scene" && !sceneContract) error("experience_scene_contract_unavailable");
  const audioContract = binding.output === "audio" ? createAudioOutputContract({ draftId: binding.draftId, draftHash: binding.draftHash,
    releaseHash: binding.releaseHash, requestHash: binding.requestHash, sourceBindingHash: binding.sourceBindingHash }) : null;
  if (binding.output === "audio" && !audioContract) error("experience_audio_contract_unavailable");
  const storyboardContract = binding.output === "storyboard" ? createStoryboardOutputContract({ draftId: binding.draftId, draftHash: binding.draftHash,
    releaseHash: binding.releaseHash, requestHash: binding.requestHash, sourceBindingHash: binding.sourceBindingHash }) : null;
  if (binding.output === "storyboard" && !storyboardContract) error("experience_storyboard_contract_unavailable");
  const model3dContract = binding.output === "model3d" ? experienceModel3dOutputContract(plan, binding) : null;
  if (binding.output === "model3d" && !model3dContract) error("experience_model3d_contract_unavailable");
  const videoSource = binding.output === "video" ? await prepareExperienceVideoOutputSource(request, env, auth, retained) : null;
  const recipe = createExperienceOutputRecipe(binding.output === "video" ? { output: "video", ...identities, contract: videoSource!.contract } : binding.output === "model3d" ? { output: "model3d", ...identities, contract: model3dContract! } : binding.output === "storyboard" ? { output: "storyboard", ...identities, contract: storyboardContract! } : binding.output === "audio" ? { output: "audio", ...identities, contract: audioContract! } : binding.output === "scene" ? { output: "scene", ...identities, contract: sceneContract! } : binding.output === "short_story" ? { output: "short_story", ...identities, contract: SHORT_STORY_NARRATIVE_CONTRACT } : binding.output === "slides" ? { output: "slides", ...identities }
    : { output: "image", ...identities, variantId: await experienceResourceId(draftId, "native-output-variant"), aspectRatio: ratio!.value as { width: number; height: number } });
  const intakeResponse = await commitAtomicIntake(env, auth, { projectId: plan.projectId, documentId: plan.documentId, events: structuredClone(plan.events) as typeof plan.events[number][] }, "check", {
    receiptPrefix: receiptPrefix(draftId), clientId: "web:experience-intake", correlationPrefix: "experience-intake:", guard: experienceDraftGuard(auth, plan, retained.content) });
  const receipt = { ...await intakeResponse.json() as Record<string, unknown>, draftId, draftHash: plan.draftHash } as unknown as ExperienceIntakeReceipt;
  if (!intakeResponse.ok || receipt.status !== "complete") error("experience_intake_original_unavailable", 410);
  const trusted = await loadOutputTrustedContext(request, env, plan.documentId, permission); if (trusted instanceof Response) return refused(trusted);
  if (trusted.scope.kind !== "personal" || trusted.scope.actorUserId !== auth.user.userId || trusted.scope.ownerUserId !== auth.user.userId
    || trusted.scope.documentId !== plan.documentId || trusted.scope.projectId !== plan.projectId) error("experience_output_scope_changed", 403);
  // The same retained draft/custody assertion participates in every native write
  // and final private disclosure, not only this earlier in-memory source check.
  trusted.sourceAssertions.push(experienceDraftGuard(auth, plan, retained.content));
  if (videoSource) {
    if (videoSource.head !== trusted.ownerHead) error("output_video_source_changed", 409);
    trusted.sourceAssertions.push(videoSource.guard, { sql: "COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)=?",
      bindings: [binding.streamId, videoSource.head] });
  }
  if (model3dContract?.reference) {
    // Passive state and prepare both reread the original source. A once-saved
    // preparation may not present a later changed image as current custody.
    const original = await prepareExperienceModel3dReference(request, env, auth, model3dContract.reference.selection);
    if (canonicalJson(original.reference) !== canonicalJson(plan.reference) || original.head !== trusted.ownerHead)
      error("experience_model3d_original_changed", 409);
    trusted.sourceAssertions.push(original.guard, { sql: "COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)=?",
      bindings: [binding.streamId, original.head] });
  }
  // Schema readiness belongs to deployment. Exact reads below fail closed; this
  // creator adapter never initializes DDL or infers readiness from a warm cache.
  const lineage = await readExperienceOutputLineage(trusted, binding);
  const loaded: Loaded = { trusted, binding: lineage.binding, rootBinding: binding, lineage, recipe, retained, receipt, originals: lineage.originals };
  // Earlier stages are an atomic prerequisite, not merely UI provenance. Their
  // immutable index/event associations survive through each later native batch.
  trusted.sourceAssertions.push(...lineage.witnesses.map(value => outputCommandReceiptAssertion(trusted.scope, value.receipt)));
  if (binding.output === "scene" || binding.output === "video") trusted.sourceAssertions.push(sceneRenewalIndexAssertion(trusted.scope, binding.draftId, lineage.cycleCommandKeys, binding.output));
  if (binding.output === "model3d") trusted.sourceAssertions.push(model3dReplacementIndexAssertion(trusted.scope, binding.draftId, lineage.cycleCommandKeys));
  validateManagedRequirement(loaded);
  const sourceMismatch = experienceSourceMismatch(plan, receipt, { documentId: trusted.projection.documentId, projectId: trusted.projection.projectId,
    documents: trusted.projection.documents, blocks: trusted.projection.libraryBlocks.filter(block => block.id !== recipe.spec.id),
    relations: trusted.projection.libraryBlockRelations, events: trusted.events });
  if (sourceMismatch !== null) {
    console.warn("experience_output_source_mismatch", { category: sourceMismatch });
    if (request.method !== "GET" || permission !== "read" || binding.output !== "image" || !loaded.originals.run)
      error("experience_output_source_changed");
    loaded.retainedImageSourceChanged = true;
  }
  if (trusted.sourceProblems.length) error("experience_output_source_unavailable", 410);
  return loaded;
}

async function confirmed(loaded: Loaded) {
  const saved = loaded.originals.confirm;
  if (!saved) return null;
  const id = saved.receipt.payload.plan_revision_id;
  if (typeof id !== "string") error("experience_output_plan_unavailable", 410);
  const plan = await outputExperienceCommands.readConfirmedPlan(loaded.trusted, id);
  if (!plan || canonicalJson(plan) !== canonicalJson(saved.receipt.payload.confirmed_plan)
    || !matchExperienceOutputRecipeTarget(loaded.recipe, plan.plan, { documentId: loaded.binding.documentId,
      sourceRevision: loaded.retainedImageSourceChanged ? plan.sourceDigest : loaded.trusted.sourceDigest,
      requirementRevision: loaded.retainedImageSourceChanged ? plan.requirementsDigest : loaded.trusted.requirementsDigest })) error("experience_output_plan_changed");
  return plan;
}

/** A quote renewal is an unpaid successor of one positively never-authorized
 * lineage. No missing/failed read is interpreted as absence. These predicates
 * accompany the native confirmation transaction, not only this preview. */
async function renewalOffer(loaded: Loaded) {
  if (loaded.binding.output !== "scene" && loaded.binding.output !== "video" || loaded.originals.authorize || loaded.originals.run
    || (loaded.binding.preparationCycle?.ordinal ?? 0) >= 8) return null;
  const predecessor = scenePreparationPredecessor(loaded.binding, loaded.originals);
  if (!predecessor) return null;
  const plan = await confirmed(loaded), root = loaded.rootBinding;
  const contract = root.output === "scene" ? createSceneOutputContract({ draftId: root.draftId, draftHash: root.draftHash,
    releaseHash: root.releaseHash, requestHash: root.requestHash, sourceBindingHash: root.sourceBindingHash }) : null;
  const videoContract = root.output === "video" ? loaded.recipe.spec.deliverables[0]?.video_contract : null;
  const identityFor = (confirmed: { revisionId: string; confirmedAt: string }) => videoContract
    ? outputVideoPreparationIdentity(videoContract, confirmed, loaded.recipe.targetId)
    : contract ? outputScenePreparationIdentity(contract, confirmed, loaded.recipe.targetId) : Promise.resolve(null);
  if (!plan || !contract && !videoContract) return null;
  const original = await identityFor(plan);
  const now = Date.now();
  if (!original || Date.parse(original.expiresAt) > now || Date.parse(loaded.retained.expiresAt) <= now + 900_000) return null;
  if ((await registeredExperience(loaded.retained.plan.request.experienceId))?.releaseHash !== root.releaseHash) return null;
  const latest = await outputExperienceCommands.readConfirmedPlan(loaded.trusted);
  if (!latest || canonicalJson(latest) !== canonicalJson(plan)) return null;
  const requestIds: string[] = [];
  for (const witness of loaded.lineage.witnesses) {
    if (witness.receipt.action !== "confirm") continue;
    const saved = witness.receipt.payload.confirmed_plan;
    if (!record(saved) || typeof saved.revisionId !== "string" || typeof saved.confirmedAt !== "string") error("experience_scene_renewal_lineage_unavailable", 410);
    const identity = await identityFor({ revisionId: saved.revisionId, confirmedAt: saved.confirmedAt });
    if (!identity) error("experience_scene_renewal_lineage_unavailable", 410);
    requestIds.push(identity.requestId);
  }
  const guards = [sceneRenewalNoExecutionAssertion(loaded.trusted.scope, requestIds, loaded.binding.output),
    sceneRenewalWindowAssertion(loaded.trusted.scope, root.draftId, original.expiresAt, loaded.retained.expiresAt),
    sceneRenewalPredecessorAssertion(loaded.trusted.scope, predecessor)];
  const clear = await loaded.trusted.env.DB.prepare(`SELECT CASE WHEN ${guards.map(guard => `(${guard.sql})`).join(" AND ")} THEN 1 ELSE 0 END AS clear`)
    .bind(...guards.flatMap(guard => guard.bindings ?? [])).first<{ clear: number }>();
  if (clear?.clear !== 1) return null;
  return { predecessor, cycle: await scenePreparationSuccessor(root, predecessor), guards,
    disclosure: { predecessorPreflightId: predecessor.preflight.preflightId, expiredAt: original.expiresAt } };
}

async function replacementOffer(loaded: Loaded) {
  if (loaded.binding.output !== "model3d" || loaded.binding.replacementCycle || !loaded.originals.run || !loaded.originals.authorize) return null;
  const grantId = loaded.originals.authorize.receipt.payload.grant_id;
  if (typeof grantId !== "string") return null;
  const evidence = await outputExperienceCommands.readGrantEvidence(loaded.trusted.env, loaded.trusted.scope, grantId, true);
  if (evidence.slots.length !== 1) return null;
  const slot = evidence.slots[0]!;
  const job = await loaded.trusted.env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=? AND document_id=?")
    .bind(slot.jobId, loaded.trusted.scope.ownerUserId, loaded.binding.documentId).first<DocumentJobRow>();
  if (!job || job.status !== "failed" || slot.status !== "uncertain") return null;
  const parent = await captureModel3dReplacementParent(loaded.trusted.env, loaded.trusted.scope, slot, job, {
    assertions: loaded.trusted.sourceAssertions, current: { sourceDigest: loaded.trusted.sourceDigest,
      requirementsDigest: loaded.trusted.requirementsDigest, retentionExpiresAt: loaded.retained.expiresAt },
  });
  const prior = model3dReplacementPredecessor(loaded.rootBinding, loaded.originals, parent.checkpoint.providerRequestId as string);
  if (!prior || prior.slotId !== slot.slotId || prior.jobId !== slot.jobId || prior.sourceDigest !== loaded.trusted.sourceDigest) return null;
  const cycle = await model3dReplacementSuccessor(loaded.rootBinding, prior);
  return { cycle, guards: parent.assertions, disclosure: { cycleId: cycle.id, previousSlotId: prior.slotId,
    previousJobId: prior.jobId, priorHeldMicrousd: 400000 as const, newMaximumMicrousd: 400000 as const, cumulativeMaximumMicrousd: 800000 as const } };
}

/** Audio preparation wire shape is server-only while the native client selector stays closed. */
type ExperiencePreparedState = (ExperienceNativeState | (Omit<ExperienceNativeState, "output"> & { output: "audio" | "storyboard" | "model3d" | "video" })) & { audioCostPreview?: AudioMiniAppCostPreview | null; model3dCostPreview?: Model3dMiniAppCostPreview | null };
async function state(loaded: Loaded): Promise<ExperiencePreparedState> {
  const { trusted, binding, originals } = loaded, plan = await confirmed(loaded);
  const preflightValue = originals.preflight?.receipt.payload.preflight;
  const preflight = preflightValue as ExperienceNativeState["preflight"];
  if (originals.preflight && (!record(preflightValue) || !plan || preflight?.planRevisionId !== plan.revisionId
    || preflight.sourceDigest !== (loaded.retainedImageSourceChanged ? plan.sourceDigest : trusted.sourceDigest)
    || preflight.requirementsDigest !== (loaded.retainedImageSourceChanged ? plan.requirementsDigest : trusted.requirementsDigest)
    || !Array.isArray(preflight.targets) || preflight.targets.length !== 1 || !record(preflight.targets[0]) || preflight.targets[0].targetId !== loaded.recipe.targetId
    || originals.preflight!.envelope.planRevisionId !== plan.revisionId)) error("experience_output_preflight_changed");
  const result: ExperiencePreparedState = { version: 1, draftId: binding.draftId, draftHash: binding.draftHash, releaseHash: binding.releaseHash,
    documentId: binding.documentId, projectId: binding.projectId, output: binding.output, sourceSurface: "outputs",
    status: preflight ? "review" : originals.save ? "preparing" : "absent", disposition: preflight ? "prepared" : "never_admitted",
    current: { custody: "verified", source: "verified", sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest },
    stage: [...phases].reverse().find(phase => originals[phase]) ?? null,
    plan: plan ? { revisionId: plan.revisionId, targetId: loaded.recipe.targetId, targetContractDigest: plan.targetContractDigests[loaded.recipe.targetId]!, sourceDigest: plan.sourceDigest, requirementsDigest: plan.requirementsDigest } : null,
    preflight: preflight ?? null, grant: null, original: null,
    permitted: { prepare: !preflight && !originals.authorize, authorize: Boolean(preflight?.targets.every(target => target.available) && Date.parse(preflight.expiresAt) > Date.now() && !originals.authorize), run: false, resumeRun: false } };
  if (binding.output === "video") {
    const offered=preflight?.targets[0],video=readVideoExecutionOffer(offered);
    if(offered?.available&&(!video||canonicalJson(video.contract)!==canonicalJson(loaded.recipe.spec.deliverables[0]?.video_contract)
      ||video.original.actorUserId!==trusted.scope.actorUserId||video.original.documentId!==binding.documentId||video.original.projectId!==binding.projectId
      ||video.original.sourceDigest!==trusted.sourceDigest||video.original.requirementsDigest!==trusted.requirementsDigest))error("experience_video_preflight_unavailable",410);
    if(!video||Date.parse(String(video.original.expiresAt))<=Date.now())result.permitted.authorize=false;
    if(video && Date.parse(String(video.original.expiresAt))<=Date.now() && !originals.authorize)result.status="unavailable";
  }
  if (binding.output === "audio") {
    result.audioCostPreview=parseAudioMiniAppCostPreview(record(preflight?.targets[0]?.settings)?preflight!.targets[0]!.settings.costPreview:null);
    if(!result.audioCostPreview||Date.parse(result.audioCostPreview.expiresAt)<=Date.now())result.permitted.authorize=false;
  }
  if(binding.output==="model3d"){
    const settings=preflight?.targets[0]?.settings,payload=record(settings)?await readOutputModel3dPayload(settings.payload):null;
    if(preflight?.targets[0]?.available&&(!payload||canonicalJson(payload.contract)!==canonicalJson(loaded.recipe.spec.deliverables[0]?.model3d_contract)
      ||payload.preview.actorUserId!==trusted.scope.actorUserId||payload.preview.documentId!==binding.documentId||payload.preview.projectId!==binding.projectId
      ||payload.preview.sourceDigest!==trusted.sourceDigest||payload.preview.requirementsDigest!==trusted.requirementsDigest))error("experience_model3d_preflight_unavailable",410);
    result.model3dCostPreview=payload?.preview??null;
    if(!result.model3dCostPreview||Date.parse(result.model3dCostPreview.expiresAt)<=Date.now())result.permitted.authorize=false;
  }
  if (binding.output === "storyboard") {
    const offered=preflight?.targets[0],storyboard=readStoryboardExecutionOffer(offered);
    if(offered?.available&&(!storyboard||canonicalJson(storyboard.contract)!==canonicalJson(loaded.recipe.spec.deliverables[0]?.storyboard_contract)
      ||storyboard.original.actorUserId!==trusted.scope.actorUserId||storyboard.original.documentId!==binding.documentId||storyboard.original.projectId!==binding.projectId
      ||storyboard.original.sourceDigest!==trusted.sourceDigest||storyboard.original.requirementsDigest!==trusted.requirementsDigest))error("experience_storyboard_preflight_unavailable",410);
    if(!storyboard||Date.parse(String(storyboard.original.expiresAt))<=Date.now())result.permitted.authorize=false;
  }
  if (binding.output === "scene") {
    const settings = preflight?.targets[0]?.settings;
    const scenePayload = record(settings) ? await readOutputScenePayload(settings.payload) : null;
    if (preflight?.targets[0]?.available && (!scenePayload
      || canonicalJson(scenePayload.outputScene.sceneContract) !== canonicalJson(loaded.recipe.spec.deliverables[0]?.scene_contract))) error("experience_scene_preflight_unavailable");
    result.sceneCostPreview = scenePayload?.outputScene.costPreview ?? null;
    if (!result.sceneCostPreview || Date.parse(result.sceneCostPreview.expiresAt) <= Date.now()) result.permitted.authorize = false;
  }
  if (!originals.authorize) {
    if (plan && await trusted.env.DB.prepare("SELECT 1 AS present FROM output_operation_slots WHERE scope_key=? AND plan_revision_id=? LIMIT 1").bind(trusted.scope.key, plan.revisionId).first()) error("experience_output_unbound_operation", 410);
    if (preflight && (((binding.output === "storyboard" || binding.output === "video") ? !preflight.targets.every(target => target.available) : !result.permitted.authorize)
      || Date.parse(preflight.expiresAt) <= Date.now())) result.status = "unavailable";
    if ((binding.output === "scene" || binding.output === "video") && result.status === "unavailable") {
      const renewal = await renewalOffer(loaded);
      if (renewal) {
        if (binding.output === "video") result.videoRenewal = renewal.disclosure;
        else result.sceneRenewal = renewal.disclosure;
        result.permitted.renewPreparation = true;
      }
    }
    return result;
  }
  const authorization = originals.authorize, grantId = authorization.receipt.payload.grant_id;
  if (typeof grantId !== "string" || !plan || !preflight || authorization.envelope.preflightId !== preflight.id
    || authorization.envelope.termsDigest !== preflight.termsDigest || authorization.envelope.explicitAuthorization !== true
    || authorization.envelope.maximumMicrousd !== preflight.maximumMicrousd) error("experience_output_original_authorization_unavailable", 410);
  const evidence = await outputExperienceCommands.readGrantEvidence(trusted.env, trusted.scope, grantId, true);
  if (evidence.slots.length !== 1 || canonicalJson(evidence.confirmedPlan) !== canonicalJson(plan) || canonicalJson(evidence.preflight) !== canonicalJson(preflight)) error("experience_output_original_operation_changed");
  const slot = evidence.slots[0]!, authorizedTargets = authorization.receipt.payload.authorized_targets;
  if(binding.output==="model3d"&&(!result.model3dCostPreview||Date.parse(result.model3dCostPreview.expiresAt)<=Date.now())){result.permitted.run=false;result.permitted.resumeRun=false;}
  if (binding.output === "scene" && (!result.sceneCostPreview || slot.jobId !== result.sceneCostPreview.requestId
    // Equality of an already indexed original action, not synthesized approval.
    || canonicalJson(authorization.envelope.sceneCostConsent ?? null) !== canonicalJson({ ...result.sceneCostPreview, confirmed: true }))) error("experience_scene_original_consent_unavailable", 410);
  if (slot.grantId !== grantId || slot.targetId !== loaded.recipe.targetId || slot.planRevisionId !== plan.revisionId
    || slot.targetContractDigest !== plan.targetContractDigests[loaded.recipe.targetId] || slot.sourceDigest !== plan.sourceDigest
    || (binding.output === "model3d" ? !model3dMiniAppAttemptMatches(result.model3dCostPreview, slot) : slot.attemptOrdinal !== 0 || slot.previousSlotId !== null)
    || !Array.isArray(authorizedTargets) || authorizedTargets.length !== 1
    || canonicalJson(authorizedTargets[0]) !== canonicalJson({ target_id: slot.targetId, operation_slot_id: slot.slotId, job_id: slot.jobId, route_digest: slot.routeDigest })) error("experience_output_original_operation_changed");
  const job = await trusted.env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=?")
    .bind(slot.jobId, trusted.scope.actorUserId, binding.streamId, binding.documentId).first<DocumentJobRow>();
  if (!job || !job.correlation_id || !Number.isFinite(Date.parse(job.expires_at)) || Date.parse(job.expires_at) <= Date.now()) error("experience_output_original_job_unavailable", 410);
  trusted.sourceAssertions.push({ sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND status=? AND expires_at=? AND correlation_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    bindings: [slot.jobId, trusted.scope.actorUserId, binding.streamId, binding.documentId, job.status, job.expires_at, job.correlation_id], deadlineMs: Date.parse(job.expires_at) });
  if(binding.output==="model3d"&&(!result.model3dCostPreview||!model3dMiniAppAttemptMatches(result.model3dCostPreview, slot)
    ||canonicalJson(authorization.envelope.model3dCostConsent)!==canonicalJson({...result.model3dCostPreview,confirmed:true,providerTransferConfirmed:true})))error("experience_model3d_original_consent_unavailable",410);
  if(binding.output==="audio"&&(!result.audioCostPreview||slot.jobId!==result.audioCostPreview.requestId||slot.attemptOrdinal!==0||slot.previousSlotId||canonicalJson(authorization.envelope.audioCostConsent)!==canonicalJson({...result.audioCostPreview,confirmed:true,providerTransferConfirmed:true})))error("experience_audio_original_consent_unavailable",410);
  const run = originals.run;
  if (run && (run.envelope.grantId !== grantId || run.envelope.explicitRun !== true || run.receipt.payload.grant_id !== grantId
    || canonicalJson(run.receipt.payload.job_ids) !== canonicalJson([slot.jobId]) || run.receipt.payload.existing_jobs_only !== true)) error("experience_output_original_run_unavailable", 410);
  const snapshot = await outputExperienceCommands.snapshot(trusted);
  const grant = snapshot.grants.find(value => value.id === grantId);
  if (!grant || grant.status !== evidence.row.status || grant.expiresAt !== String(evidence.row.expires_at) || grant.planRevisionId !== plan.revisionId
    || grant.actorUserId !== trusted.scope.actorUserId || grant.payerUserId !== trusted.scope.actorUserId
    || grant.maximumMicrousd !== preflight.maximumMicrousd || grant.maximumCalls !== preflight.maximumCalls
    || canonicalJson(grant.disclosure) !== canonicalJson(preflight) || grant.operations.length !== 1
    || grant.operations[0]!.id !== slot.slotId || grant.operations[0]!.jobId !== slot.jobId || grant.operations[0]!.targetId !== slot.targetId
    || grant.operations[0]!.status !== slot.status)
    error("experience_output_original_grant_unavailable", 410);
  result.grant = grant;
  result.original = { authorization: { key: authorization.receipt.key, eventId: authorization.receipt.eventId },
    run: run ? { key: run.receipt.key, eventId: run.receipt.eventId } : null,
    grantId, grantStatus: String(evidence.row.status), slotId: slot.slotId, slotStatus: slot.status, jobId: slot.jobId, jobStatus: job.status,
    targetId: slot.targetId, targetContractDigest: slot.targetContractDigest, routeDigest: slot.routeDigest, planRevisionId: plan.revisionId,
    sourceDigest: plan.sourceDigest, requirementsDigest: plan.requirementsDigest, expiresAt: String(evidence.row.expires_at), correlationId: job.correlation_id, jobExpiresAt: job.expires_at };
  result.disposition = run ? "original_run_recorded" : "original_authorized";
  result.status = ["authorized", "queued", "running", "succeeded", "failed", "cancelled", "unavailable", "uncertain"].includes(slot.status) ? slot.status as ExperienceNativeState["status"] : "unavailable";
  if (job.status === "partial") result.status = "partial";
  else if (job.status === "failed") result.status = "failed";
  else if (job.status === "canceled") result.status = "cancelled";
  else if (job.status === "completed" && slot.status !== "succeeded") result.status = "unavailable";
  else if (!["queued", "running", "committing", "completed"].includes(job.status)) result.status = "unavailable";
  result.permitted = { prepare: false, authorize: false,
    run: !run && job.status === "queued" && slot.status === "authorized" && Number(evidence.row.deadline_current) === 1 && evidence.row.status === "authorized",
    // Resume is an explicit wake-up of the exact recorded run, not a fresh
    // command or provider attempt. Native receipts/leases still decide work.
    resumeRun: Boolean(run && snapshot.permissions?.canRequest === true && ["queued", "running"].includes(job.status) && ["queued", "running"].includes(slot.status)
      && Number(evidence.row.deadline_current) === 1 && ["authorized", "active"].includes(grant.status)
      && grant.pendingCalls === 0 && grant.operations[0]!.pendingCalls === 0) };
  if (Number(evidence.row.deadline_current) !== 1) { if (job.status !== "completed") result.status = "unavailable"; result.permitted.run = false; result.permitted.resumeRun = false; }
  if (binding.output === "scene" && (!result.sceneCostPreview || Date.parse(result.sceneCostPreview.expiresAt) <= Date.now())) {
    result.permitted.run = false; result.permitted.resumeRun = false;
  }
  if (binding.output === "model3d" && (!result.model3dCostPreview || Date.parse(result.model3dCostPreview.expiresAt) <= Date.now())) {
    result.permitted.run = false; result.permitted.resumeRun = false;
  }
  if(binding.output==="video"){
    const video=readVideoExecutionOffer(preflight.targets[0]);
    if(!video||video.original.requestId!==slot.jobId||slot.attemptOrdinal!==0||slot.previousSlotId)error("experience_video_original_attempt_unavailable",410);
    // A wake-up is never permission to redo planning, upload or submit media.
    result.permitted.resumeRun=false;
    if(Date.parse(String(video.original.expiresAt))<=Date.now())result.permitted.run=false;
  }
  if(binding.output==="storyboard"){
    const storyboard=readStoryboardExecutionOffer(preflight.targets[0]);
    if(!storyboard||storyboard.original.requestId!==slot.jobId||slot.attemptOrdinal!==0||slot.previousSlotId)error("experience_storyboard_original_attempt_unavailable",410);
    if(Date.parse(String(storyboard.original.expiresAt))<=Date.now()){result.permitted.run=false;result.permitted.resumeRun=false;}
  }
  result.permitted.recoverResult = Boolean(run && binding.output === "image" && preflight.targets[0]?.provider === "fal" && preflight.targets[0]?.model === "ideogram/v4"
    && preflight.targets[0]?.route === "document-image-fal-manual-v1" && job.status === "failed" && falRecoveryJobStateAllowed(job.status,slot.status) && snapshot.permissions?.canRequest
    && ["authorized", "active", "completed"].includes(String(evidence.row.status)) && await trusted.env.DB.prepare(`SELECT 1 AS available FROM output_execution_grants
      WHERE scope_key=? AND grant_id=? AND ${retainedPersonalFalRecoverySql}
      AND NOT EXISTS(SELECT 1 FROM document_jobs current WHERE current.job_id=? AND (
        current.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') OR json_extract(current.result_json,'$.outputFalRecovery.expiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`)
      .bind(trusted.scope.key,grantId,job.job_id).first());
  const jobMetadata: unknown = JSON.parse(job.result_json ?? "{}");
  if (binding.output === "model3d") {
    result.permitted.recoverResult = Boolean(run && snapshot.permissions?.canRequest
      && await outputModel3dRecoveryAvailable(trusted.env, trusted.scope, slot, job));
    const recovery = record(jobMetadata) ? jobMetadata.outputModel3dRecovery : null;
    if (job.status === "completed" && slot.status === "succeeded" && grant.status === "completed" && record(recovery)
      && recovery.version === "output-model3d-recovery-v1" && recovery.status === "completed"
      && typeof recovery.completionEventId === "string") result.recovery = "completed";
  }
  if(binding.output==="video"){
    // Availability is advisory. The recovery entry revalidates current rights,
    // source, private originals, both paid calls and a token-fenced read lease.
    result.permitted.recoverResult=Boolean(run&&job.status==="failed"&&snapshot.permissions?.canRequest
      && preflight.targets[0]?.provider==="fal"&&preflight.targets[0]?.route==="document-video-owned-still-four-seconds-manual-v1"
      && ["authorized","active","completed"].includes(grant.status)&&["failed","uncertain"].includes(slot.status)
      &&await trusted.env.DB.prepare(`SELECT 1 AS available FROM document_jobs job
        JOIN output_operation_slots original ON original.job_id=job.job_id AND original.scope_key=? AND original.slot_id=?
        JOIN output_provider_calls media ON media.scope_key=original.scope_key AND media.slot_id=original.slot_id
        JOIN private_content request ON request.content_id=json_extract(job.result_json,'$.outputVideoMediaCheckpoint.requestRef')
        WHERE job.job_id=? AND job.owner_id=? AND job.status='failed' AND job.kind='render_document' AND job.source_surface='outputs'
          AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND json_type(job.result_json,'$.outputVideoStop') IS NULL
          AND (job.lease_expires_at IS NULL OR job.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          AND (json_type(job.result_json,'$.outputVideoRecovery') IS NULL OR json_extract(job.result_json,'$.outputVideoRecovery.status')='completed'
            OR json_extract(job.result_json,'$.outputVideoRecovery.expiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          AND media.call_key='video:initial' AND media.stage_key='video:initial' AND media.provider='fal' AND media.status IN('uncertain','settled')
          AND media.client_request_id=json_extract(job.result_json,'$.outputVideoMediaCheckpoint.clientRequestId')
          AND media.request_digest=json_extract(job.result_json,'$.outputVideoMediaCheckpoint.requestDigest')
          AND length(media.provider_response_id) BETWEEN 1 AND 200 AND lower(media.provider_response_id) NOT IN('pending','unknown','submitted')
          AND request.owner_id=job.owner_id AND request.kind='prompt' AND request.redacted_at IS NULL AND request.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=request.content_id)`)
        .bind(trusted.scope.key,slot.slotId,job.job_id,trusted.scope.actorUserId).first());
    const videoRecovery=record(jobMetadata)?jobMetadata.outputVideoRecovery:null;
    if(job.status==="completed"&&slot.status==="succeeded"&&grant.status==="completed"&&record(videoRecovery)
      &&videoRecovery.version==="output-video-recovery-v1"&&videoRecovery.status==="completed")result.recovery="completed";
  }
  const recovery = record(jobMetadata) ? jobMetadata.outputFalRecovery : null;
  if (binding.output === "image" && preflight.targets[0]?.provider === "fal" && result.status === "succeeded" && job.status === "completed" && grant.status === "completed" && record(recovery)
    && recovery.version === "output-fal-recovery-v1" && recovery.status === "completed" && typeof recovery.completionEventId === "string") result.recovery = "completed";
  if (loaded.retainedImageSourceChanged) {
    // Original receipts remain immutable. Today's authorization, source/private
    // assertions and disclosure guards remain current; only the result is historical.
    if (binding.output !== "image" || !run || result.status !== "succeeded" || job.status !== "completed"
      || slot.status !== "succeeded" || grant.status !== "completed" || grant.pendingCalls !== 0
      || grant.operations[0]!.pendingCalls !== 0) error("experience_output_source_changed");
    result.current.source = "changed";
    result.permitted = { prepare: false, authorize: false, run: false, resumeRun: false, recoverResult: false, renewPreparation: false };
  }
  if (binding.output === "model3d" && !binding.replacementCycle && result.status === "failed") {
    try { const offer = await replacementOffer(loaded); if (offer) {
      result.model3dReplacement = offer.disclosure; result.permitted.prepareReplacement = true;
      trusted.sourceAssertions.push(...offer.guards);
    } } catch { /* An unverified parent must not expose replacement authority. */ }
  }
  return result;
}

async function execute(loaded: Loaded, phase: ExperienceOutputStage, fields: Record<string, unknown>, bridge: OutputExecutionBridge, executionContext: WorkerExecutionContext) {
  const prior = loaded.originals[phase];
  const envelope = prior?.envelope ?? await experienceOutputEnvelope(loaded.binding, phase, loaded.trusted.ownerHead, fields);
  const result = await outputExperienceCommands.execute(loaded.trusted, envelope, bridge, executionContext);
  if (result instanceof Response) {
    const issue = await result.json() as Record<string, unknown>;
    error(typeof issue.error === "string" ? issue.error : "experience_output_native_refused", result.status);
  }
  // Commit acknowledgement is not admission replacement authority. The following
  // request state is always reconstructed from the original indexed command.
}

/** Existing native transaction adapter for registered personal mini-apps. No generic job POST. */
export async function handleExperienceOutput(request: Request, env: WorkerEnv, executionContext: WorkerExecutionContext, bridge: OutputExecutionBridge): Promise<Response> {
  let diagnosticStage: DiagnosticStage = "initial_load";
  try {
    const url = new URL(request.url), match = /^\/api\/experiences\/drafts\/(experience-draft-[a-f0-9]{64})\/output(?:\/(prepare|authorize|run|recover-result))?$/u.exec(url.pathname);
    if (!match) return unavailable("not_found", 404);
    const draftId = match[1]!, action = match[2];
    if (url.searchParams.size || (action ? request.method !== "POST" : request.method !== "GET")) return unavailable("method_not_allowed", 405);
    let body: Record<string, unknown> = {};
    let recovered: "pending" | "completed" | undefined;
    if (action) {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return unavailable("same_origin_required", 403);
      const value = await readExperienceBody(request);
      const keys = action === "prepare" ? ["draftHash", "explicitRequirementsConfirmation", ...(record(value) && Object.hasOwn(value, "renewal") ? ["renewal"] : []), ...(record(value) && Object.hasOwn(value, "replacement") ? ["replacement"] : [])] : action === "authorize" ? ["draftHash", "termsDigest", "maximumMicrousd", "explicitAuthorization", ...(record(value) && Object.hasOwn(value, "sceneCostConsent") ? ["sceneCostConsent"] : []), ...(record(value) && Object.hasOwn(value, "audioCostConsent") ? ["audioCostConsent"] : []), ...(record(value) && Object.hasOwn(value, "model3dCostConsent") ? ["model3dCostConsent"] : [])] : action === "recover-result" ? ["draftHash", "grantId", "jobId", "explicitRecovery"] : ["draftHash", "grantId", "explicitRun"];
      if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return unavailable("experience_output_request_invalid", 400);
      body = value;
    }
    let loaded = await load(request, env, draftId, action === "prepare" ? "author" : action ? "request" : "read");
    if (loaded instanceof Response) return loaded;
    if (loaded.binding.output === "audio" && action === "recover-result") error("experience_audio_recovery_unavailable", 409);
    if (action === "recover-result" && !["image", "video", "model3d", "audio", "storyboard"].includes(loaded.binding.output))
      error("experience_output_explicit_recovery_required", 403);
    if(action==="authorize"&&(loaded.binding.output==="audio")!==Object.hasOwn(body,"audioCostConsent"))error("experience_audio_confirmation_required",403);
    if(action==="authorize"&&(loaded.binding.output==="model3d")!==Object.hasOwn(body,"model3dCostConsent"))error("experience_model3d_confirmation_required",403);
    if (loaded.binding.output === "storyboard" && action === "recover-result") error("experience_storyboard_recovery_unavailable", 409);
    if (action && body.draftHash !== loaded.binding.draftHash) error("experience_review_stale");
    if (action === "authorize" && (loaded.binding.output === "scene") !== Object.hasOwn(body, "sceneCostConsent")) error("experience_scene_confirmation_required", 403);
    if (action && (await registeredExperience(loaded.retained.plan.request.experienceId))?.releaseHash !== loaded.binding.releaseHash) error("experience_release_changed");
    if (action === "prepare") {
      if (body.explicitRequirementsConfirmation !== true) error("experience_output_recipe_confirmation_required", 403);
      if (Object.hasOwn(body, "replacement")) {
        const input = body.replacement;
        if (loaded.binding.output !== "model3d" || Object.hasOwn(body, "renewal") || !record(input)
          || Object.keys(input).length !== 3 || input.explicitReplacement !== true || typeof input.cycleId !== "string"
          || typeof input.previousSlotId !== "string") error("experience_model3d_replacement_unavailable", 403);
        const existing = loaded.binding.replacementCycle;
        if (existing && (existing.id !== input.cycleId || existing.predecessor.slotId !== input.previousSlotId)) error("experience_model3d_replacement_unavailable", 409);
        if (!existing) {
          const offer = await replacementOffer(loaded);
          if (!offer || offer.cycle.id !== input.cycleId || offer.cycle.predecessor.slotId !== input.previousSlotId) error("experience_model3d_replacement_unavailable", 409);
          loaded.trusted.sourceAssertions.push(...offer.guards);
          await execute({ ...loaded, binding: { ...loaded.rootBinding, replacementCycle: offer.cycle }, originals: { save: loaded.originals.save } },
            "confirm", { explicitRequirementsConfirmation: true, explicitReplacement: true }, bridge, executionContext);
          const refreshed = await load(request, env, draftId, "author"); if (refreshed instanceof Response) return refreshed; loaded = refreshed;
        }
      }
      if (Object.hasOwn(body, "renewal")) {
        diagnosticStage = "prepare_confirm_state";
        const input = body.renewal;
        if (loaded.binding.output !== "scene" && loaded.binding.output !== "video" || !record(input) || Object.keys(input).length !== 2
          || input.explicitRenewal !== true || typeof input.predecessorPreflightId !== "string") error("experience_scene_renewal_required", 403);
        const existing = loaded.binding.preparationCycle;
        if (existing?.predecessor.preflight.preflightId !== input.predecessorPreflightId) {
          const offer = await renewalOffer(loaded);
          if (!offer || offer.disclosure.predecessorPreflightId !== input.predecessorPreflightId) error("experience_scene_renewal_unavailable", 409);
          loaded.trusted.sourceAssertions.push(...offer.guards);
          // The root save is never repeated. The exact old index, all ancestor
          // receipt/private witnesses and native source/head checks fence this
          // first confirmation together in commitOutputCommand's atomic batch.
          diagnosticStage = "prepare_confirm_execute";
          await execute({ ...loaded, binding: { ...loaded.rootBinding, preparationCycle: offer.cycle },
            originals: { save: loaded.originals.save } }, "confirm", { explicitRequirementsConfirmation: true }, bridge, executionContext);
          diagnosticStage = "prepare_confirm_reload";
          const refreshed = await load(request, env, draftId, "author"); if (refreshed instanceof Response) return refreshed; loaded = refreshed;
        }
        // A lost-response retry can continue ONLY the same already-indexed
        // child. It cannot renew again or repeat a financial/run stage.
      }
      for (const phase of ["save", "confirm", "preflight"] as const) {
        if (!loaded.originals[phase]) {
          diagnosticStage = `prepare_${phase}_state`;
          const current = await state(loaded);
          if (!current.permitted.prepare) break;
          if (phase === "confirm" && await outputExperienceCommands.readConfirmedPlan(loaded.trusted)) error("experience_output_unbound_plan", 410);
          const plan = phase === "preflight" ? await confirmed(loaded) : null;
          if (phase === "preflight" && (!plan || await env.DB.prepare("SELECT 1 AS present FROM output_preflights WHERE scope_key=? AND plan_revision_id=? AND actor_user_id=? LIMIT 1").bind(loaded.trusted.scope.key, plan.revisionId, loaded.trusted.scope.actorUserId).first())) error("experience_output_unbound_preflight", 410);
          diagnosticStage = `prepare_${phase}_execute`;
          await execute(loaded, phase, phase === "save" ? { blockId: loaded.recipe.spec.id, spec: loaded.recipe.spec, explicitRequirementsConfirmation: body.explicitRequirementsConfirmation }
            : phase === "confirm" ? { explicitRequirementsConfirmation: body.explicitRequirementsConfirmation }
            : { planRevisionId: plan!.revisionId, targetIds: [loaded.recipe.targetId],
              ...(loaded.binding.replacementCycle ? { alternativeOfSlotId: loaded.binding.replacementCycle.predecessor.slotId } : {}) }, bridge, executionContext);
          diagnosticStage = `prepare_${phase}_reload`;
          const refreshed = await load(request, env, draftId, "author"); if (refreshed instanceof Response) return refreshed; loaded = refreshed;
        }
      }
    } else if (action === "authorize") {
      diagnosticStage = "authorize";
      const current = await state(loaded);
      if (!current.preflight) error("experience_output_preflight_required");
      const confirmation = experienceOutputAuthorization(body, current.preflight);
      if (!loaded.originals.authorize && !current.permitted.authorize) error("experience_output_authorization_unavailable");
      if (loaded.originals.authorize && (loaded.originals.authorize.envelope.termsDigest !== body.termsDigest || loaded.originals.authorize.envelope.maximumMicrousd !== body.maximumMicrousd)) error("experience_output_authorization_terms_changed");
      if (loaded.binding.output === "scene") {
        if (!current.sceneCostPreview || (!loaded.originals.authorize
          ? !sceneMiniAppCostApprovalMatches(body.sceneCostConsent, current.sceneCostPreview)
          : canonicalJson(body.sceneCostConsent) !== canonicalJson(loaded.originals.authorize.envelope.sceneCostConsent))) error("experience_scene_confirmation_required", 403);
      }
      if(loaded.binding.output==="audio"&&(!current.audioCostPreview||(!loaded.originals.authorize?!audioMiniAppCostApprovalMatches(body.audioCostConsent,current.audioCostPreview):canonicalJson(body.audioCostConsent)!==canonicalJson(loaded.originals.authorize.envelope.audioCostConsent))))error("experience_audio_confirmation_required",403);
      if(loaded.binding.output==="model3d"&&(!current.model3dCostPreview||(!loaded.originals.authorize?!model3dMiniAppCostApprovalMatches(body.model3dCostConsent,current.model3dCostPreview):canonicalJson(body.model3dCostConsent)!==canonicalJson(loaded.originals.authorize.envelope.model3dCostConsent))))error("experience_model3d_confirmation_required",403);
      await execute(loaded, "authorize", { ...confirmation, preflightId: current.preflight.id,
        ...(loaded.binding.output==="model3d"?{model3dCostConsent:body.model3dCostConsent}:{}),
        ...(loaded.binding.output==="audio"?{audioCostConsent:body.audioCostConsent}:{}),
        ...(loaded.binding.output === "scene" ? { sceneCostConsent: body.sceneCostConsent } : {}) }, bridge, executionContext);
    } else if (action === "run") {
      diagnosticStage = "run";
      const current = await state(loaded);
      if (body.explicitRun !== true || !current.original || body.grantId !== current.original.grantId) error("experience_output_explicit_run_required", 403);
      if (!loaded.originals.run && !current.permitted.run) error("experience_output_run_unavailable");
      if (!loaded.originals.run || current.permitted.resumeRun)
        await execute(loaded, "run", { grantId: current.original.grantId, explicitRun: body.explicitRun }, bridge, executionContext);
    } else if (action === "recover-result") {
      diagnosticStage = "recover_result";
      // Preserve intake/command custody without capturing state()'s old job status.
      // Source epochs allow only the same nonsemantic native events during recovery.
      const recoveryLoaded = loaded;
      const assertions = recoveryLoaded.trusted.sourceAssertions.map(assertion => {
        const capturedHead=assertion.sql === "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?"
          || ["video", "model3d"].includes(recoveryLoaded.binding.output)&&assertion.sql === "COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)=?";
        if(!capturedHead)return assertion;
        if(assertion.bindings?.length!==2||assertion.bindings[0]!==recoveryLoaded.binding.streamId
          ||!Number.isSafeInteger(assertion.bindings[1])||assertion.bindings[1]!==recoveryLoaded.trusted.ownerHead)error("output_source_epoch_required",403);
        return outputSourceEpochAssertion(recoveryLoaded.trusted.scope,{head:Number(assertion.bindings[1]),sourceDigest:recoveryLoaded.trusted.sourceDigest});
      });
      const current = await state(loaded);
      if (body.explicitRecovery !== true || !current.original?.run || body.grantId !== current.original.grantId || body.jobId !== current.original.jobId
        || !current.permitted.recoverResult && current.original.jobStatus !== "completed") error("experience_output_explicit_recovery_required",403);
      const job = await env.DB.prepare("SELECT document_jobs.*,(SELECT slot.slot_id FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id) AS output_slot_id FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=?")
        .bind(current.original.jobId,loaded.trusted.scope.actorUserId,loaded.binding.streamId,loaded.binding.documentId).first<DocumentJobRow>();
      if (!job) error("experience_output_original_job_unavailable",410);
      const recover=loaded.binding.output==="video"?recoverOutputVideo:loaded.binding.output==="model3d"?recoverOutputModel3d:recoverOutputFalImage;
      const outcome = await recover(env,loaded.trusted.principal,job,{assertions,signal:request.signal,
        ...(loaded.binding.output==="image"?{onStage:(stage:FalRecoveryStage)=>{diagnosticStage=`recover_result_${stage}`;}}:{})});
      recovered = outcome.status;
    }
    diagnosticStage = "final_load";
    const latest = action ? await load(request, env, draftId, "read") : loaded; if (latest instanceof Response) return latest;
    diagnosticStage = "final_state";
    const value = await state(latest);
    if (recovered) value.recovery = recovered;
    const assertions = latest.lineage.witnesses.map(value => outputCommandReceiptAssertion(latest.trusted.scope, value.receipt));
    diagnosticStage = "final_disclose";
    return await outputExperienceCommands.disclose(latest.trusted, value, 200, assertions);
  } catch (cause) {
    const item = record(cause) ? cause : {};
    const code = typeof item.code === "string" ? item.code : typeof item.message === "string" && /^[a-z][a-z0-9_]+$/u.test(item.message) ? item.message : "experience_output_unavailable";
    const kind = code !== "experience_output_unavailable" && diagnosticCodes.has(code) ? "coded" : diagnosticKind(cause);
    const capacity = code === "output_source_proof_too_large" && item.status === 413 ? outputProofCapacityDiagnostic(cause) : undefined;
    return unavailable(code, typeof item.status === "number" && item.status >= 400 && item.status < 600 ? item.status : 409,
      { stage: diagnosticStage, kind: kind === "unknown" ? diagnosticSubtype(cause) ?? kind : kind, ...(capacity ? { capacity } : {}) });
  }
}
