import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import { readStoryboardExecutionOffer } from "../src/model/output-storyboard-offer.ts";
import type { OutputConfirmedPlan } from "../src/model/output-delivery-contract.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { preflightOutputStoryboardTarget, outputStoryboardPreflightProof, storyboardPlanningSnapshot } from "./output-storyboard-preflight.ts";
import { prepareStoryboardPlannerRequest } from "./openai-adapter.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { SponsorEntitlementError, type SponsorRecipe } from "./experience-sponsor-policy.ts";
import { outputProofReadStatements, outputDigest } from "./output-disclosure-proof.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import { STORYBOARD_SPONSOR_TRANSFER, type SponsorStoryboardPlanningEvidence } from "./experience-sponsor-storyboard-contract.ts";

const textTypes = new Set(["direction", "audience", "message", "emotion", "subject", "environment", "action", "motion", "scale", "composition", "camera", "lighting", "style", "material", "palette", "typography", "format", "output", "brand", "exclusion", "accessibility", "text"]);
const mediaProperties = ["reference_id", "source_output_id", "source_artifact_id", "pixel_reference_mode", "image_url", "media_url", "audio_url", "model_url", "asset_url", "source_media_url", "model3d", "reference", "references", "audio_reference", "sketch"];
const textSource = (facts: readonly unknown[]) => facts.length > 0 && facts.every(fact => record(fact) && textTypes.has(String(fact.type).toLowerCase())
  && record(fact.properties) && !mediaProperties.some(key => Object.hasOwn(fact.properties as Record<string, unknown>, key)));
const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const commandKeys = ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization"];
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const principalColumns = ["user_id", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"];
const quoteSql = `SELECT preflight.terms_digest,preflight.expires_at,body.private_json,plan.source_head,plan.plan_revision_id,plan_body.private_json AS plan_json
  FROM output_preflights preflight JOIN output_plan_revisions plan ON plan.scope_key=preflight.scope_key AND plan.plan_revision_id=preflight.plan_revision_id
  JOIN event_private_payloads body ON body.private_event_id=preflight.event_id AND body.owner_id=plan.owner_user_id AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND body.redacted_at IS NULL
  JOIN event_private_payloads plan_body ON plan_body.private_event_id=plan.confirmed_event_id AND plan_body.owner_id=plan.owner_user_id AND plan_body.project_id=plan.project_id AND plan_body.document_id=plan.document_id AND plan_body.redacted_at IS NULL
  WHERE preflight.scope_key=? AND preflight.preflight_id=? AND preflight.actor_user_id=? AND plan.scope_kind='personal'
    AND plan.owner_user_id=? AND plan.project_id=? AND plan.document_id=? AND plan.source_digest=? AND plan.requirements_digest=?
    AND NOT EXISTS(SELECT 1 FROM output_plan_revisions newer WHERE newer.scope_key=plan.scope_key AND newer.revision>plan.revision)`;
type Quote = { terms_digest: string; expires_at: string; private_json: string; source_head: number; plan_revision_id: string; plan_json: string };

/** Dormant native evidence, not sponsor authority or a new consent path. The
 * actual Storyboard preflight rereads original intake without writing. Every
 * assertion in its private WeakMap proof is repeated at the final read boundary. */
async function readNative(trusted: OutputTrustedContext, rawCommand: Record<string, unknown>) {
  if (trusted.request.signal.aborted) return fail("sponsor_authority_changed");
  if (jsonIssues(rawCommand).length || !exactKeys(rawCommand, commandKeys) || rawCommand.action !== "authorize"
    || !id(rawCommand.clientMutationId) || !id(rawCommand.preflightId) || rawCommand.documentId !== trusted.scope.documentId
    || rawCommand.expectedRevision !== `output:${trusted.ownerHead}` || rawCommand.explicitAuthorization !== true
    || !Number.isSafeInteger(rawCommand.maximumMicrousd) || Number(rawCommand.maximumMicrousd) < 1) return fail("sponsor_command_invalid");
  const command = JSON.parse(canonicalJson(rawCommand)) as Record<string, unknown>;
  if (trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== trusted.scope.actorUserId || trusted.scope.contextId
    || trusted.scope.organizationId || trusted.scope.projectAccessId || trusted.projectContext || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== trusted.principal.userId || trusted.env.FORMA_PILOT_COHORT_ID?.trim()
    || !trusted.context || trusted.sourceProblems.length || !trusted.sourcePrivateCaptured) return fail("sponsor_scope_unsupported");
  if (!textSource(trusted.context.snapshot.facts)) return fail("sponsor_storyboard_text_source_required");
  const request = trusted.request, env = trusted.env, database = env.DB;
  const source = () => canonicalJson({ scope: trusted.scope, principal: { userId: trusted.principal.userId, consentVersion: trusted.principal.consentVersion,
    fictional: trusted.principal.fictional ?? false, projectExecution: trusted.principal.projectExecution ?? null, billingUserId: trusted.principal.billingUserId ?? null,
    authorizationSnapshot: trusted.principal.authorizationSnapshot ?? null }, projectContext: Boolean(trusted.projectContext),
    request: { url: trusted.request.url, method: trusted.request.method, headers: [...trusted.request.headers] },
    sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems,
    configuration: { model: env.OPENAI_MODEL ?? null, imageProvider: env.FORMA_IMAGE_PROVIDER ?? null, imageModel: env.FAL_IMAGE_MODEL ?? null,
      plannerConfigured: Boolean(env.OPENAI_API_KEY), imageConfigured: Boolean(env.FAL_KEY), cohort: env.FORMA_PILOT_COHORT_ID ?? null },
    ownerHead: trusted.ownerHead, sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest,
    context: trusted.context, events: trusted.events, assertions: trusted.sourceAssertions });
  const captured = source(), current = () => !request.signal.aborted && trusted.request === request && trusted.env === env && env.DB === database && source() === captured;
  // Capture the original scope's retained-body WeakMap before cloning.
  const capturedAssertions = structuredClone(sponsorCurrentSourceAssertions(trusted));
  const native = { ...trusted, scope: structuredClone(trusted.scope), context: structuredClone(trusted.context),
    events: structuredClone(trusted.events), sourceAssertions: structuredClone(trusted.sourceAssertions),
    sourceProblems: [...trusted.sourceProblems], env: { ...env } };
  if (!current()) return fail("sponsor_authority_changed");
  const principalRow = await database.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(native.scope.actorUserId).first<Record<string, unknown>>();
  if (!current()) return fail("sponsor_authority_changed");
  if (!principalRow) return fail("sponsor_principal_changed");
  const auth = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" });
  if (!current() || "kind" in auth || auth.response || !auth.user || auth.user.userId !== native.scope.actorUserId
    || auth.user.consentVersion !== POLICY_VERSION || auth.user.fictional || auth.user.projectExecution
    || canonicalJson(auth.user.authorizationSnapshot) !== canonicalJson(trusted.principal.authorizationSnapshot)) return fail("sponsor_principal_changed");
  const principal = auth.user;
  const bindings = [native.scope.key, String(command.preflightId), principal.userId, principal.userId, native.scope.projectId,
    native.scope.documentId, native.sourceDigest, native.requirementsDigest];
  const row = await database.prepare(quoteSql).bind(...bindings).first<Quote>();
  if (!current()) return fail("sponsor_authority_changed");
  if (!row || row.terms_digest !== command.termsDigest || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) return fail("sponsor_native_terms_changed");
  const body: unknown = JSON.parse(row.private_json), planBody: unknown = JSON.parse(row.plan_json);
  const quote = record(body) && record(body.preflight) ? body.preflight : null;
  const plan = record(planBody) && record(planBody.confirmed_plan) ? planBody.confirmed_plan as unknown as OutputConfirmedPlan : null;
  if (!quote || !plan || !record(plan.plan) || !Array.isArray(plan.plan.targets) || plan.plan.targets.length !== 1
    || plan.id !== native.scope.documentId || plan.revisionId !== row.plan_revision_id || quote.planRevisionId !== plan.revisionId
    || quote.id !== command.preflightId || quote.termsDigest !== row.terms_digest || quote.expiresAt !== row.expires_at
    || [quote.sourceDigest, plan.sourceDigest].some(value => value !== native.sourceDigest)
    || [quote.requirementsDigest, plan.requirementsDigest].some(value => value !== native.requirementsDigest)
    || !Array.isArray(quote.targets) || quote.targets.length !== 1 || !record(quote.targets[0]) || !record(quote.operationAttempts)) return fail("sponsor_recipe_unsupported");
  const { termsDigest, ...quotedTerms } = quote;
  if (await outputDigest(quotedTerms) !== termsDigest) return fail("sponsor_native_terms_changed");
  if (!current()) return fail("sponsor_authority_changed");
  const offered = quote.targets[0], target = plan.plan.targets[0], attempt = quote.operationAttempts[target.id];
  if (!record(target) || ["narrative_contract", "scene_contract", "audio_contract", "video_contract", "model3d_contract"].some(key => Object.hasOwn(target, key))
    || !record(attempt) || !exactKeys(attempt, ["ordinal", "previousSlotId"]) || attempt.ordinal !== 0 || attempt.previousSlotId !== null
    || Object.keys(quote.operationAttempts).length !== 1 || offered.targetId !== target.id || quote.maximumCalls !== 5
    || quote.maximumMicrousd !== command.maximumMicrousd || offered.maximumMicrousd !== command.maximumMicrousd) return fail("sponsor_recipe_unsupported");
  const expected = await preflightOutputStoryboardTarget({ request, env: native.env, scope: native.scope, principal, confirmedPlan: plan, target,
    context: native.context, ownerHead: native.ownerHead, sourceEvents: native.events, sourceAssertions: native.sourceAssertions,
    sourceDigest: native.sourceDigest, requirementsDigest: native.requirementsDigest });
  if (!current()) return fail("sponsor_authority_changed");
  const proof = outputStoryboardPreflightProof(expected), execution = readStoryboardExecutionOffer(expected);
  if (!proof?.sourceAssertions.length || !execution || expected.maximumTokens !== 224000 || canonicalJson(expected) !== canonicalJson(offered)
    || proof.requestId !== execution.original.requestId || proof.expiresAt !== execution.original.expiresAt) return fail("sponsor_recipe_unsupported");
  const snapshot = storyboardPlanningSnapshot(native.context.snapshot, native.context.projection, native.events);
  const prepared = await prepareStoryboardPlannerRequest(native.env, principal.userId, { documentTitle: native.context.projection.documentTitle,
    snapshot, options: { itemCount: 4, productionMode: "manual", outputTargetInstructions: target.instruction_text } }, execution.contract);
  if (!current()) return fail("sponsor_authority_changed");
  const wire: unknown = JSON.parse(prepared.requestBody), text = record(wire) && record(wire.text) ? wire.text : null;
  const format = text && record(text.format) ? text.format : null, schema = format && record(format.schema) ? format.schema : null;
  const cache = record(wire) && record(wire.prompt_cache_options) ? wire.prompt_cache_options : null;
  const reasoning = record(wire) && record(wire.reasoning) ? wire.reasoning : null;
  if (!record(wire) || !schema || wire.model !== "gpt-5.6-terra" || wire.store !== false || wire.service_tier !== "default"
    || !cache || !exactKeys(cache, ["mode"]) || cache.mode !== "explicit" || reasoning?.effort !== "low"
    || format?.type !== "json_schema" || format.name !== "document_storyboard" || format.strict !== true
    || prepared.requestDigest !== execution.planner.requestDigest || prepared.maximumInputTokens !== execution.planner.maximumInputTokens
    || prepared.maximumOutputTokens !== 4000) return fail("sponsor_recipe_unsupported");
  const planning: SponsorStoryboardPlanningEvidence = { requestDigest: `sha256:${prepared.requestDigest}`, schemaDigest: await digest(schema),
    contractDigest: await digest(execution.contract), maximumInputTokens: prepared.maximumInputTokens, maximumOutputTokens: 4000,
    model: "gpt-5.6-terra", store: false, serviceTier: "default", cacheMode: "explicit", reasoningEffort: "low" };
  if (!current()) return fail("sponsor_authority_changed");
  const release = await registeredExperience("storyboard");
  if (!current()) return fail("sponsor_authority_changed");
  if (!release || release.output.output !== "storyboard" || execution.contract.source.releaseHash !== release.releaseHash) return fail("sponsor_recipe_unsupported");
  const recipe: SponsorRecipe = { appId: "storyboard", recipeVersion: `storyboard@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: "storyboard", provider: "fal", model: String(offered.model), routeDigest: await digest(offered), settingsDigest: await digest(offered.settings),
    outputCount: 1, durationMs: 0, width: 1536, height: 1024, calls: { parsing: 0, planning: 1, render: 4, repair: 0 },
    maximumTokens: 224000, maximumMicrousd: Number(offered.maximumMicrousd) };
  const transfer = STORYBOARD_SPONSOR_TRANSFER;
  const assertions: OutputSqlAssertion[] = [...capturedAssertions, ...structuredClone(proof.sourceAssertions),
    { sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${principalColumns.map(column => `captured.${column}`).join(",")})=?)`,
      bindings: [principal.userId, JSON.stringify(principalColumns.map(column => principalRow[column] ?? null))] },
    { sql: `EXISTS(SELECT 1 FROM (${quoteSql}) captured WHERE terms_digest=? AND expires_at=? AND private_json=? AND source_head=? AND plan_revision_id=? AND plan_json=?)`,
      bindings: [...bindings, row.terms_digest, row.expires_at, row.private_json, row.source_head, row.plan_revision_id, row.plan_json] }];
  const description = { actorKind: "canonical-principal" as const, actorUserId: principal.userId,
    sessionDigest: await digest({ version: "sponsor-canonical-principal@1", userId: principal.userId, consentVersion: principal.consentVersion, authorizationSnapshot: principal.authorizationSnapshot ?? null }),
    ownerUserId: principal.userId, projectId: native.scope.projectId, documentId: native.scope.documentId, sourceRevision: row.source_head,
    sourceDigest: `sha256:${native.sourceDigest}`, orderedAssetDigests: [] as string[], rightsDigest: await digest(assertions),
    compiledInputDigest: await digest({ snapshot, settings: offered.settings, planning }),
    transferEnvelopeDigest: await digest({ sourceDigest: native.sourceDigest, requirementsDigest: native.requirementsDigest, settings: offered.settings, planning, transfer }), recipe,
    originalRequestId: proof.requestId, originalExpiresAtMs: Date.parse(proof.expiresAt), preflightExpiresAtMs: Date.parse(row.expires_at) };
  const deadline = Math.min(description.preflightExpiresAtMs, description.originalExpiresAtMs,
    ...assertions.flatMap(assertion => assertion.deadlineMs === undefined ? [] : [assertion.deadlineMs]));
  const assertCurrent = () => { if (!current() || !Number.isFinite(deadline) || deadline <= Date.now()) return fail("sponsor_authority_changed"); };
  assertCurrent();
  const checked = await database.batch<Record<string, unknown>>(outputProofReadStatements(env, assertions));
  if (!Array.isArray(checked) || checked.length !== assertions.length || Array.from({ length: assertions.length }, (_, index) => checked[index]).some(result => result?.success !== true
    || !Array.isArray(result.results) || result.results.length !== 1 || result.results[0]?.current !== 1)) return fail("sponsor_authority_changed");
  assertCurrent();
  return freeze({ description, offered: JSON.parse(canonicalJson(offered)) as Record<string, unknown>, planning, transfer, assertCurrent });
}

export async function describeSponsorStoryboardAdmission(trusted: OutputTrustedContext, command: Record<string, unknown>) {
  const native = await readNative(trusted, command);
  native.assertCurrent();
  return native.description;
}
export async function readSponsorStoryboardTemplateEvidence(trusted: OutputTrustedContext, command: Record<string, unknown>, recipe: SponsorRecipe) {
  if (jsonIssues(recipe).length) return fail("sponsor_native_envelope_mismatch");
  const capturedRecipe = JSON.parse(canonicalJson(recipe)) as SponsorRecipe;
  const native = await readNative(trusted, command);
  if (canonicalJson(native.description.recipe) !== canonicalJson(capturedRecipe)) return fail("sponsor_native_envelope_mismatch");
  native.assertCurrent();
  return freeze({ recipe: native.description.recipe, offered: native.offered, planning: native.planning, transfer: native.transfer });
}
