import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import type { OutputConfirmedPlan, OutputNativeTargetPreflight } from "../src/model/output-delivery-contract.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { outputScenePreflightProof, createOutputSceneProviderInput } from "./output-scene-preflight.ts";
import { readOutputScenePayload, outputScenePreflightConfiguration } from "./output-scene-preflight-contract.ts";
import { createSceneMiniAppCostPreview, requireSceneMiniAppCostApproval } from "./scene-mini-app-consent.ts";
import { OUTPUT_SCENE_MODEL } from "./output-scene-request.ts";
import { sceneSourceVersionAssertions } from "./scene-source-generation.ts";
import { captureSponsorSceneJson } from "./experience-sponsor-scene-contract.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { SponsorEntitlementError, type SponsorRecipe } from "./experience-sponsor-policy.ts";
import { outputProofReadStatements, outputDigest } from "./output-disclosure-proof.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const commandKeys = ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization", "sceneCostConsent"];
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const principalColumns = ["user_id", "email", "display_name", "role", "consent_version", "consented_at", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"];
const quoteSql = `SELECT preflight.terms_digest,preflight.expires_at,body.private_json,plan.source_head,plan.plan_revision_id,plan_body.private_json AS plan_json
  FROM output_preflights preflight JOIN output_plan_revisions plan ON plan.scope_key=preflight.scope_key AND plan.plan_revision_id=preflight.plan_revision_id
  JOIN event_private_payloads body ON body.private_event_id=preflight.event_id AND body.owner_id=plan.owner_user_id AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND body.redacted_at IS NULL
  JOIN event_private_payloads plan_body ON plan_body.private_event_id=plan.confirmed_event_id AND plan_body.owner_id=plan.owner_user_id AND plan_body.project_id=plan.project_id AND plan_body.document_id=plan.document_id AND plan_body.redacted_at IS NULL
  WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND plan.scope_kind='personal'
    AND plan.owner_user_id=? AND plan.project_id=? AND plan.document_id=? AND plan.source_digest=? AND plan.requirements_digest=?
    AND length(CAST(body.private_json AS BLOB))<=524288 AND length(CAST(plan_body.private_json AS BLOB))<=524288
    AND NOT EXISTS(SELECT 1 FROM output_plan_revisions newer WHERE newer.scope_key=plan.scope_key AND newer.revision>plan.revision)`;
type Quote = { terms_digest: string; expires_at: string; private_json: string; source_head: number; plan_revision_id: string; plan_json: string };

/** Inert evidence only. The native producer supplies its ORIGINAL version-bearing
 * WeakMap proof; this collector never invokes native preparation/nonce activation
 * or manufactures actor consent. An earlier proof made stale by a subsequent
 * command is refused, even when that command preserves the visible text.
 * Current original proof, Request/DB/source bytes and private quote/plan are
 * checked in one final read batch. No returned object grants spending or access. */
async function readNative(trusted: OutputTrustedContext, commandInput: Record<string, unknown>, nativePreflight: OutputNativeTargetPreflight) {
  const rawCommand = captureSponsorSceneJson(commandInput);
  if (!record(rawCommand) || !exactKeys(rawCommand, commandKeys) || rawCommand.action !== "authorize"
    || !id(rawCommand.clientMutationId) || !id(rawCommand.preflightId) || rawCommand.documentId !== trusted.scope.documentId
    || rawCommand.expectedRevision !== `output:${trusted.ownerHead}` || rawCommand.explicitAuthorization !== true
    || !Number.isSafeInteger(rawCommand.maximumMicrousd) || Number(rawCommand.maximumMicrousd) < 1) return fail("sponsor_command_invalid");
  const command = rawCommand;
  const proof = outputScenePreflightProof(nativePreflight);
  if (!proof?.prepared.sourceVersion || !proof.sourceAssertions.length || !nativePreflight.available) return fail("sponsor_scene_original_proof_required");
  const native = captureSponsorSceneJson(nativePreflight);
  const prepared = proof.prepared, version = proof.prepared.sourceVersion;
  if (version.streamId !== trusted.principal.streamId || version.projectAccessId !== undefined
    || prepared.binding.actorUserId !== trusted.scope.actorUserId || prepared.binding.projectId !== trusted.scope.projectId
    || prepared.binding.documentId !== trusted.scope.documentId || prepared.scope || prepared.production
    || canonicalJson(prepared.authoredSnapshot) !== canonicalJson(trusted.context?.snapshot)) return fail("sponsor_scene_original_proof_mismatch");
  if (trusted.principal.userId !== trusted.scope.actorUserId || trusted.principal.streamId !== `creative:${trusted.scope.actorUserId}`
    || trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== trusted.scope.actorUserId || trusted.scope.contextId
    || trusted.scope.organizationId || trusted.scope.projectAccessId || trusted.projectContext || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== trusted.principal.userId || trusted.env.FORMA_PILOT_COHORT_ID?.trim()
    || !trusted.context || trusted.sourceProblems.length || !trusted.sourcePrivateCaptured) return fail("sponsor_scope_unsupported");
  if (!trusted.env.OPENAI_API_KEY || (trusted.env.OPENAI_MODEL ?? OUTPUT_SCENE_MODEL) !== OUTPUT_SCENE_MODEL) return fail("sponsor_scene_provider_unavailable");
  const request = trusted.request, env = trusted.env, database = env.DB, originalPrincipal = trusted.principal;
  const source = () => canonicalJson({ scope: trusted.scope, principal: trusted.principal,
    request: { url: request.url, method: request.method, headers: [...request.headers.entries()] }, projectContext: Boolean(trusted.projectContext),
    sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems,
    configuration: { model: env.OPENAI_MODEL ?? null, providerKey: env.OPENAI_API_KEY ?? null, cohort: env.FORMA_PILOT_COHORT_ID ?? null }, ownerHead: trusted.ownerHead,
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, context: trusted.context, assertions: trusted.sourceAssertions });
  const captured = source(), current = () => trusted.request === request && trusted.env === env && env.DB === database && trusted.principal === originalPrincipal && source() === captured;
  const principalRow = await database.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(trusted.scope.actorUserId).first<Record<string, unknown>>();
  if (!principalRow) return fail("sponsor_principal_changed");
  const auth = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" });
  if (!current() || "kind" in auth || auth.response || !auth.user || auth.user.userId !== trusted.scope.actorUserId
    || auth.user.consentVersion !== POLICY_VERSION || auth.user.fictional || auth.user.projectExecution
    || canonicalJson(auth.user) !== canonicalJson(trusted.principal)) return fail("sponsor_principal_changed");
  const principal = auth.user;
  const bindings = [trusted.scope.key, String(command.preflightId), principal.userId, principal.userId, trusted.scope.projectId,
    trusted.scope.documentId, trusted.sourceDigest, trusted.requirementsDigest];
  const row = await database.prepare(quoteSql).bind(...bindings).first<Quote>();
  if (!row || row.terms_digest !== command.termsDigest || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) return fail("sponsor_native_terms_changed");
  if (row.private_json.length > 524288 || row.plan_json.length > 524288) return fail("sponsor_recipe_unsupported");
  const body = captureSponsorSceneJson(JSON.parse(row.private_json)), planBody = captureSponsorSceneJson(JSON.parse(row.plan_json));
  const quote = record(body) && record(body.preflight) ? body.preflight : null;
  const plan = record(planBody) && record(planBody.confirmed_plan) ? planBody.confirmed_plan as unknown as OutputConfirmedPlan : null;
  if (!quote || !plan || !record(plan.plan) || !Array.isArray(plan.plan.targets) || plan.plan.targets.length !== 1
    || plan.id !== trusted.scope.documentId || plan.revisionId !== row.plan_revision_id || quote.planRevisionId !== plan.revisionId
    || quote.id !== command.preflightId || quote.termsDigest !== row.terms_digest || quote.expiresAt !== row.expires_at
    || [quote.sourceDigest, plan.sourceDigest].some(value => value !== trusted.sourceDigest)
    || [quote.requirementsDigest, plan.requirementsDigest].some(value => value !== trusted.requirementsDigest)
    || !Array.isArray(quote.targets) || quote.targets.length !== 1 || !record(quote.targets[0]) || !record(quote.operationAttempts)) return fail("sponsor_recipe_unsupported");
  const { termsDigest, ...quotedTerms } = quote;
  if (await outputDigest(quotedTerms) !== termsDigest) return fail("sponsor_native_terms_changed");
  const offered = quote.targets[0], target = plan.plan.targets[0], attempt = quote.operationAttempts[target.id];
  if (!record(target) || !record(target.scene_contract) || ["audio_contract", "video_contract", "storyboard_contract", "model3d_contract"].some(key => Object.hasOwn(target, key))) return fail("sponsor_recipe_unsupported");
  if (!record(attempt) || !exactKeys(attempt, ["ordinal", "previousSlotId"]) || attempt.ordinal !== 0 || attempt.previousSlotId !== null
    || Object.keys(quote.operationAttempts).length !== 1 || offered.targetId !== target.id || quote.maximumCalls !== 1
    || quote.maximumMicrousd !== command.maximumMicrousd || offered.maximumMicrousd !== command.maximumMicrousd) return fail("sponsor_recipe_unsupported");
  if (canonicalJson(native) !== canonicalJson(offered)) return fail("sponsor_scene_original_proof_mismatch");
  const payload = await readOutputScenePayload(offered.settings && record(offered.settings) ? offered.settings.payload : null);
  if (!payload || canonicalJson(payload.outputScene.sceneContract) !== canonicalJson(target.scene_contract)
    || payload.outputTargetInstructions !== target.instruction_text.trim() || payload.sceneRequestId !== proof.requestId
    || payload.outputScene.costPreview.expiresAt !== proof.expiresAt) return fail("sponsor_recipe_unsupported");
  const expected = await outputScenePreflightConfiguration(offered.targetId as string, payload);
  const input = await createOutputSceneProviderInput(payload.outputScene.intake, prepared.effectiveSnapshot, target.instruction_text);
  const refreshedPreview = await createSceneMiniAppCostPreview(prepared, payload.outputScene.sceneContract, payload.outputScene.intake,
    payload.outputScene.contract, proof.expiresAt);
  if (!expected || canonicalJson(expected) !== canonicalJson(offered) || !input
    || canonicalJson(input) !== payload.outputScene.contract.input || !refreshedPreview) return fail("sponsor_recipe_unsupported");
  requireSceneMiniAppCostApproval(command.sceneCostConsent, payload.outputScene.costPreview, refreshedPreview);
  const release = await registeredExperience("scene");
  if (!release || release.output.output !== "scene" || release.releaseHash !== payload.outputScene.intake.releaseHash) return fail("sponsor_recipe_unsupported");
  const recipe: SponsorRecipe = { appId: "scene", recipeVersion: `scene@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: "scene", provider: "openai", model: String(offered.model), routeDigest: await digest(offered), settingsDigest: await digest(offered.settings),
    outputCount: 1, durationMs: 0, width: 0, height: 0, calls: { parsing: 0, planning: 1, render: 0, repair: 0 }, maximumTokens: 128000, maximumMicrousd: Number(offered.maximumMicrousd) };
  const description = { actorKind: "canonical-principal" as const, actorUserId: principal.userId,
    sessionDigest: await digest({ version: "sponsor-canonical-principal@1", userId: principal.userId, consentVersion: principal.consentVersion, authorizationSnapshot: principal.authorizationSnapshot ?? null }),
    ownerUserId: principal.userId, projectId: trusted.scope.projectId, documentId: trusted.scope.documentId, sourceRevision: row.source_head,
    sourceDigest: `sha256:${trusted.sourceDigest}`, orderedAssetDigests: [] as string[], rightsDigest: await digest(trusted.sourceAssertions),
    compiledInputDigest: await digest({ snapshot: trusted.context.snapshot, settings: offered.settings }),
    transferEnvelopeDigest: await digest({ sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, settings: offered.settings }), recipe,
    preflightExpiresAtMs: Math.min(Date.parse(row.expires_at), Date.parse(proof.expiresAt), Date.parse(prepared.validUntil)) };
  const assertions: OutputSqlAssertion[] = [...sponsorCurrentSourceAssertions(trusted), ...proof.sourceAssertions, ...sceneSourceVersionAssertions(version),
    { sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${principalColumns.map(column => `captured.${column}`).join(",")})=?)`, bindings: [principal.userId, JSON.stringify(principalColumns.map(column => principalRow[column] ?? null))] },
    { sql: `EXISTS(SELECT 1 FROM (${quoteSql}) captured WHERE terms_digest=? AND expires_at=? AND private_json=? AND source_head=? AND plan_revision_id=? AND plan_json=?)`,
      bindings: [...bindings, row.terms_digest, row.expires_at, row.private_json, row.source_head, row.plan_revision_id, row.plan_json] }];
  if (assertions.length > 128 || assertions.some(assertion => assertion.sql.length > 100000 || (assertion.bindings?.length ?? 0) > 100)
    || new TextEncoder().encode(canonicalJson(assertions)).byteLength > 2 * 1024 * 1024) return fail("sponsor_scene_evidence_limit");
  const deadline = Math.min(description.preflightExpiresAtMs, ...assertions.flatMap(assertion => assertion.deadlineMs === undefined ? [] : [assertion.deadlineMs]));
  if (!current() || !Number.isFinite(deadline) || deadline <= Date.now()) return fail("sponsor_authority_changed");
  const checked = await database.batch<Record<string, unknown>>(outputProofReadStatements(env, assertions));
  // The older shared helper skips sparse slots. Require every own data slot and
  // native integer predicate; malformed/late responses never become evidence.
  const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object"
    ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  if (!Array.isArray(checked) || own(checked, "length") !== assertions.length || Array.from({ length: assertions.length }, (_, index) => {
    const result = own(checked, index), rows = own(result, "results"), row = own(rows, 0);
    return own(result, "success") !== true || own(result, "error") !== undefined || !Array.isArray(rows) || own(rows, "length") !== 1 || own(row, "current") !== 1;
  }).some(Boolean)) return fail("sponsor_authority_changed");
  if (!current() || deadline <= Date.now()) return fail("sponsor_authority_changed");
  return freeze({ description, offered: JSON.parse(canonicalJson(offered)) as Record<string, unknown> });
}

export async function describeSponsorSceneAdmission(trusted: OutputTrustedContext, command: Record<string, unknown>, nativePreflight: OutputNativeTargetPreflight) {
  return (await readNative(trusted, command, nativePreflight)).description;
}
export async function readSponsorSceneTemplateEvidence(trusted: OutputTrustedContext, command: Record<string, unknown>, recipe: SponsorRecipe, nativePreflight: OutputNativeTargetPreflight) {
  const capturedRecipe = captureSponsorSceneJson(recipe);
  const native = await readNative(trusted, command, nativePreflight);
  if (canonicalJson(native.description.recipe) !== canonicalJson(capturedRecipe)) return fail("sponsor_native_envelope_mismatch");
  return freeze({ recipe: native.description.recipe, offered: native.offered });
}
