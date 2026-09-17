import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import type { OutputConfirmedPlan } from "../src/model/output-delivery-contract.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { preflightOutputImageSlidesTarget } from "./output-image-slides-preflight.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { SponsorEntitlementError, type SponsorRecipe } from "./experience-sponsor-policy.ts";
import { outputProofReadStatements, assertOutputProofRead, outputDigest } from "./output-disclosure-proof.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import { buildDocumentPresentationSourceContract, preparePresentationComparisonRequest } from "./openai-adapter.ts";
import { readFrozenPresentationModelRoutes } from "./presentation-model-routing.ts";
import type { SponsorSlidesCompositionEvidence } from "./experience-sponsor-slides-contract.ts";

// A closed text-source lane. Reference/media/sketch/unknown blocks are refused,
// including describe-only references; no required material is silently omitted.
const textTypes = new Set(["direction", "audience", "message", "emotion", "subject", "environment", "action", "motion", "scale", "composition", "camera", "lighting", "style", "material", "palette", "typography", "format", "output", "brand", "exclusion", "accessibility", "text"]);
const mediaProperties = ["reference_id", "source_output_id", "source_artifact_id", "pixel_reference_mode", "image_url", "media_url", "audio_url", "model_url", "asset_url", "source_media_url", "model3d", "reference", "references", "audio_reference", "sketch"];
const exactFive = { kind: "exact" as const, unit: "slide" as const, value: 5 };
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

/** Read-only native evidence, never sponsor authority. The registered ordinary
 * Slides preflight is recomputed from current authorized context without egress.
 * Original Request/DB/source bytes and all retained proof are checked again in
 * one final read batch. Callers must still run commit-time sponsorship checks. */
async function readNative(trusted: OutputTrustedContext, rawCommand: Record<string, unknown>) {
  if (jsonIssues(rawCommand).length || !exactKeys(rawCommand, commandKeys) || rawCommand.action !== "authorize"
    || !id(rawCommand.clientMutationId) || !id(rawCommand.preflightId) || rawCommand.documentId !== trusted.scope.documentId
    || rawCommand.expectedRevision !== `output:${trusted.ownerHead}` || rawCommand.explicitAuthorization !== true
    || !Number.isSafeInteger(rawCommand.maximumMicrousd) || Number(rawCommand.maximumMicrousd) < 1) return fail("sponsor_command_invalid");
  const command = JSON.parse(canonicalJson(rawCommand)) as Record<string, unknown>;
  if (trusted.scope.kind !== "personal" || trusted.scope.ownerUserId !== trusted.scope.actorUserId || trusted.scope.contextId
    || trusted.scope.organizationId || trusted.scope.projectAccessId || trusted.projectContext || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.billingUserId && trusted.principal.billingUserId !== trusted.principal.userId || trusted.env.FORMA_PILOT_COHORT_ID?.trim()
    || !trusted.context || trusted.sourceProblems.length || !trusted.sourcePrivateCaptured) return fail("sponsor_scope_unsupported");
  if (!textSource(trusted.context.snapshot.facts)) return fail("sponsor_slides_text_source_required");
  const request = trusted.request, env = trusted.env, database = env.DB;
  const source = () => canonicalJson({ scope: trusted.scope, principal: { userId: trusted.principal.userId, consentVersion: trusted.principal.consentVersion,
    fictional: trusted.principal.fictional ?? false, projectExecution: trusted.principal.projectExecution ?? null, billingUserId: trusted.principal.billingUserId ?? null,
    authorizationSnapshot: trusted.principal.authorizationSnapshot ?? null }, projectContext: Boolean(trusted.projectContext),
    sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems,
    configuration: { model: env.OPENAI_MODEL ?? null, compositionModel: env.OPENAI_SLIDES_COMPOSITION_MODEL ?? null,
      compositionEffort: env.OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT ?? null, repairModel: env.OPENAI_SLIDES_REPAIR_MODEL ?? null,
      repairEffort: env.OPENAI_SLIDES_REPAIR_REASONING_EFFORT ?? null, providerConfigured: Boolean(env.OPENAI_API_KEY), cohort: env.FORMA_PILOT_COHORT_ID ?? null }, ownerHead: trusted.ownerHead,
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, context: trusted.context, assertions: trusted.sourceAssertions });
  const captured = source(), current = () => trusted.request === request && trusted.env === env && env.DB === database && source() === captured;
  // Retained private-body witnesses are keyed to the original scope identity.
  // Capture them before cloning; a cloned scope cannot recover that WeakMap.
  const capturedAssertions = structuredClone(sponsorCurrentSourceAssertions(trusted));
  // Compute evidence from the captured inputs even if an internal caller changes
  // and later restores its object during an await. Final reads still establish
  // current custody; this copy creates no transferable source authority.
  const native = { ...trusted, scope: structuredClone(trusted.scope), context: structuredClone(trusted.context),
    sourceAssertions: structuredClone(trusted.sourceAssertions), sourceProblems: [...trusted.sourceProblems],
    env: { ...env } };
  const principalRow = await database.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(trusted.scope.actorUserId).first<Record<string, unknown>>();
  if (!principalRow) return fail("sponsor_principal_changed");
  const auth = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" });
  if (!current() || "kind" in auth || auth.response || !auth.user || auth.user.userId !== trusted.scope.actorUserId
    || auth.user.consentVersion !== POLICY_VERSION || auth.user.fictional || auth.user.projectExecution
    || canonicalJson(auth.user.authorizationSnapshot) !== canonicalJson(trusted.principal.authorizationSnapshot)) return fail("sponsor_principal_changed");
  const principal = auth.user;
  const bindings = [trusted.scope.key, String(command.preflightId), principal.userId, principal.userId, trusted.scope.projectId,
    trusted.scope.documentId, trusted.sourceDigest, trusted.requirementsDigest];
  const row = await database.prepare(quoteSql).bind(...bindings).first<Quote>();
  if (!row || row.terms_digest !== command.termsDigest || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) return fail("sponsor_native_terms_changed");
  const body: unknown = JSON.parse(row.private_json), planBody: unknown = JSON.parse(row.plan_json);
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
  if (!record(target) || ["narrative_contract", "scene_contract", "audio_contract", "video_contract", "storyboard_contract", "model3d_contract"].some(key => Object.hasOwn(target, key))) return fail("sponsor_recipe_unsupported");
  if (target.media_kind !== "slides" || canonicalJson(target.quantity) !== canonicalJson({ kind: "exact", unit: "presentation", value: 1 })
    || canonicalJson(target.content_quantity) !== canonicalJson(exactFive) || canonicalJson(target.count_policy) !== canonicalJson(exactFive)
    || target.source_scope.kind !== "document" || target.coverage.kind !== "document_outline" || target.aspect_ratio || target.variant_id || target.member_id) return fail("sponsor_recipe_unsupported");
  if (!record(attempt) || !exactKeys(attempt, ["ordinal", "previousSlotId"]) || attempt.ordinal !== 0 || attempt.previousSlotId !== null
    || Object.keys(quote.operationAttempts).length !== 1 || offered.targetId !== target.id || quote.maximumCalls !== 2
    || quote.maximumMicrousd !== command.maximumMicrousd || offered.maximumMicrousd !== command.maximumMicrousd) return fail("sponsor_recipe_unsupported");
  const expected = await preflightOutputImageSlidesTarget({ request, env: native.env, scope: native.scope, principal, confirmedPlan: plan, target,
    context: native.context, ownerHead: native.ownerHead, sourceEvents: native.events, sourceAssertions: native.sourceAssertions,
    sourceDigest: native.sourceDigest, requirementsDigest: native.requirementsDigest });
  if (!expected.available || canonicalJson(expected) !== canonicalJson(offered)) return fail("sponsor_recipe_unsupported");
  const settings = record(offered.settings) ? offered.settings : null;
  const calls = settings && Array.isArray(settings.calls) ? settings.calls : [];
  if (!settings || !record(settings.payload) || calls.length !== 2 || !calls.every(call => record(call)
    && Number.isSafeInteger(call.maximumInputTokens) && Number(call.maximumInputTokens) >= 25000 && Number(call.maximumInputTokens) <= 121500
    && call.maximumOutputTokens === 6500)) return fail("sponsor_recipe_unsupported");
  const routes = readFrozenPresentationModelRoutes({ composition: calls[0].presentationRoute, repair: calls[1].presentationRoute });
  const options = { productionMode: "manual" as const, itemCount: 5, requestedSlideCount: 5, slideCountPolicy: exactFive,
    outputTargetInstructions: String(settings.payload.outputTargetInstructions), presentationModelRoutes: routes };
  const sourceContract = buildDocumentPresentationSourceContract(native.context.snapshot, options);
  if (sourceContract.schemaVersion !== 2 || sourceContract.sourceIssues?.length) return fail("sponsor_recipe_unsupported");
  // This is the actual adapter's offline composition seam. No provider request,
  // request capability or future repair digest is created by this read.
  const prepared = await preparePresentationComparisonRequest(native.env, principal.userId, {
    documentTitle: native.context.projection.documentTitle, snapshot: native.context.snapshot, options,
  });
  const wire: unknown = JSON.parse(prepared.requestBody);
  const text = record(wire) && record(wire.text) ? wire.text : null;
  const format = text && record(text.format) ? text.format : null;
  const schema = format && record(format.schema) ? format.schema : null;
  const properties = schema && record(schema.properties) ? schema.properties : null;
  const items = properties && record(properties.items) ? properties.items : null;
  if (!record(wire) || typeof wire.input !== "string" || wire.model !== routes.composition.model || wire.store !== false
    || wire.max_output_tokens !== 6500 || format?.type !== "json_schema" || format.name !== "document_slides" || format.strict !== true
    || items?.minItems !== 5 || items.maxItems !== 5 || prepared.phase !== "composition"
    || prepared.maximumInputTokens > Number(calls[0].maximumInputTokens) || prepared.maximumOutputTokens !== 6500
    || canonicalJson(prepared.route) !== canonicalJson(routes.composition)) return fail("sponsor_recipe_unsupported");
  const composition: SponsorSlidesCompositionEvidence = { phase: "composition", requestDigest: `sha256:${prepared.requestDigest}`,
    // Native contracts contain optional undefined fields. Hash their JSON wire
    // representation, as the adapter does, rather than treating them as JSON.
    schemaDigest: await digest(schema), sourceContractDigest: await digest(JSON.parse(JSON.stringify(sourceContract))), sourceContractVersion: 2,
    maximumInputTokens: prepared.maximumInputTokens, maximumOutputTokens: 6500, route: prepared.route };
  const release = await registeredExperience("slides");
  if (!release || release.output.output !== "slides") return fail("sponsor_recipe_unsupported");
  const recipe: SponsorRecipe = { appId: "slides", recipeVersion: `slides@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: "slides", provider: "openai", model: String(offered.model), routeDigest: await digest(offered), settingsDigest: await digest(offered.settings),
    outputCount: 1, durationMs: 0, width: 0, height: 0, calls: { parsing: 0, planning: 1, render: 0, repair: 1 }, maximumTokens: 128000, maximumMicrousd: Number(offered.maximumMicrousd) };
  const description = { actorKind: "canonical-principal" as const, actorUserId: principal.userId,
    sessionDigest: await digest({ version: "sponsor-canonical-principal@1", userId: principal.userId, consentVersion: principal.consentVersion, authorizationSnapshot: principal.authorizationSnapshot ?? null }),
    ownerUserId: principal.userId, projectId: native.scope.projectId, documentId: native.scope.documentId, sourceRevision: row.source_head,
    sourceDigest: `sha256:${native.sourceDigest}`, orderedAssetDigests: [] as string[], rightsDigest: await digest(native.sourceAssertions),
    compiledInputDigest: await digest({ snapshot: native.context.snapshot, settings: offered.settings, composition }),
    transferEnvelopeDigest: await digest({ sourceDigest: native.sourceDigest, requirementsDigest: native.requirementsDigest, settings: offered.settings, composition }), recipe,
    preflightExpiresAtMs: Date.parse(row.expires_at) };
  const assertions: OutputSqlAssertion[] = [...capturedAssertions,
    { sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${principalColumns.map(column => `captured.${column}`).join(",")})=?)`, bindings: [principal.userId, JSON.stringify(principalColumns.map(column => principalRow[column] ?? null))] },
    { sql: `EXISTS(SELECT 1 FROM (${quoteSql}) captured WHERE terms_digest=? AND expires_at=? AND private_json=? AND source_head=? AND plan_revision_id=? AND plan_json=?)`,
      bindings: [...bindings, row.terms_digest, row.expires_at, row.private_json, row.source_head, row.plan_revision_id, row.plan_json] }];
  const deadline = Math.min(description.preflightExpiresAtMs, ...assertions.flatMap(assertion => assertion.deadlineMs === undefined ? [] : [assertion.deadlineMs]));
  if (!current() || !Number.isFinite(deadline) || deadline <= Date.now()) return fail("sponsor_authority_changed");
  const checked = await database.batch<Record<string, unknown>>(outputProofReadStatements(env, assertions));
  assertOutputProofRead(checked, assertions.length);
  if (!current() || deadline <= Date.now()) return fail("sponsor_authority_changed");
  return freeze({ description, offered: JSON.parse(canonicalJson(offered)) as Record<string, unknown>, composition });
}

export async function describeSponsorSlidesAdmission(trusted: OutputTrustedContext, command: Record<string, unknown>) {
  return (await readNative(trusted, command)).description;
}
export async function readSponsorSlidesTemplateEvidence(trusted: OutputTrustedContext, command: Record<string, unknown>, recipe: SponsorRecipe) {
  if (jsonIssues(recipe).length) return fail("sponsor_native_envelope_mismatch");
  const capturedRecipe = JSON.parse(canonicalJson(recipe)) as SponsorRecipe;
  const native = await readNative(trusted, command);
  if (canonicalJson(native.description.recipe) !== canonicalJson(capturedRecipe)) return fail("sponsor_native_envelope_mismatch");
  return freeze({ recipe: native.description.recipe, offered: native.offered, composition: native.composition });
}
