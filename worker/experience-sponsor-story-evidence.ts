import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import type { OutputConfirmedPlan } from "../src/model/output-delivery-contract.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { preflightOutputNarrativeTarget } from "./output-narrative-preflight.ts";
import { sponsorCurrentSourceAssertions } from "./experience-sponsor-image-evidence.ts";
import { SponsorEntitlementError, type SponsorRecipe } from "./experience-sponsor-policy.ts";
import { outputProofReadStatements, outputDigest } from "./output-disclosure-proof.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";

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

function assertStoryProofRead(checked: unknown, expected: number) {
  if (!Array.isArray(checked) || checked.length !== expected) return fail("sponsor_authority_changed");
  for (let index = 0; index < expected; index++) {
    const receipt = checked[index];
    if (!Object.hasOwn(checked, index) || !record(receipt) || receipt.success !== true
      || !Array.isArray(receipt.results) || receipt.results.length !== 1 || !Object.hasOwn(receipt.results, 0)
      || !record(receipt.results[0]) || !Object.hasOwn(receipt.results[0], "current") || receipt.results[0].current !== 1)
      return fail("sponsor_authority_changed");
  }
}

/** Read-only native evidence, never sponsor authority. The registered ordinary
 * story preflight is recomputed from current authorized context without egress.
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
  const request = trusted.request, env = trusted.env, database = env.DB, context = trusted.context;
  const source = () => canonicalJson({ scope: trusted.scope, principal: { userId: trusted.principal.userId, consentVersion: trusted.principal.consentVersion,
    fictional: trusted.principal.fictional ?? false, projectExecution: trusted.principal.projectExecution ?? null, billingUserId: trusted.principal.billingUserId ?? null,
    authorizationSnapshot: trusted.principal.authorizationSnapshot ?? null }, projectContext: Boolean(trusted.projectContext),
    sourcePrivateCaptured: trusted.sourcePrivateCaptured, sourceProblems: trusted.sourceProblems,
    configuration: { model: env.OPENAI_MODEL ?? null, providerConfigured: Boolean(env.OPENAI_API_KEY), cohort: env.FORMA_PILOT_COHORT_ID ?? null }, ownerHead: trusted.ownerHead,
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, context: trusted.context, assertions: trusted.sourceAssertions });
  const captured = source(), current = () => !request.signal.aborted && trusted.request === request && trusted.env === env && env.DB === database
    && trusted.context === context && source() === captured;
  const assertCurrent = () => { if (!current()) return fail("sponsor_authority_changed"); };
  const wait = async <T>(operation: () => Promise<T>): Promise<T> => {
    assertCurrent();
    try { return await operation(); }
    finally { assertCurrent(); }
  };
  const principalRow = await wait(() => database.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(trusted.scope.actorUserId).first<Record<string, unknown>>());
  if (!principalRow) return fail("sponsor_principal_changed");
  const auth = await wait(() => readExistingPrincipalRequest(request, env, "creator", { account: "principal" }));
  if (!current() || "kind" in auth || auth.response || !auth.user || auth.user.userId !== trusted.scope.actorUserId
    || auth.user.consentVersion !== POLICY_VERSION || auth.user.fictional || auth.user.projectExecution
    || canonicalJson(auth.user.authorizationSnapshot) !== canonicalJson(trusted.principal.authorizationSnapshot)) return fail("sponsor_principal_changed");
  const principal = auth.user;
  const bindings = [trusted.scope.key, String(command.preflightId), principal.userId, principal.userId, trusted.scope.projectId,
    trusted.scope.documentId, trusted.sourceDigest, trusted.requirementsDigest];
  const row = await wait(() => database.prepare(quoteSql).bind(...bindings).first<Quote>());
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
  if (await wait(() => outputDigest(quotedTerms)) !== termsDigest) return fail("sponsor_native_terms_changed");
  const offered = quote.targets[0], target = plan.plan.targets[0], attempt = quote.operationAttempts[target.id];
  if (!record(target) || ["scene_contract", "audio_contract", "video_contract", "storyboard_contract", "model3d_contract"].some(key => Object.hasOwn(target, key))) return fail("sponsor_recipe_unsupported");
  if (!record(attempt) || !exactKeys(attempt, ["ordinal", "previousSlotId"]) || attempt.ordinal !== 0 || attempt.previousSlotId !== null
    || Object.keys(quote.operationAttempts).length !== 1 || offered.targetId !== target.id || quote.maximumCalls !== 1
    || quote.maximumMicrousd !== command.maximumMicrousd || offered.maximumMicrousd !== command.maximumMicrousd) return fail("sponsor_recipe_unsupported");
  const expected = await wait(() => preflightOutputNarrativeTarget({ request, env, scope: trusted.scope, principal, confirmedPlan: plan, target,
    context, ownerHead: trusted.ownerHead, sourceEvents: trusted.events, sourceAssertions: trusted.sourceAssertions,
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest }));
  if (!expected.available || canonicalJson(expected) !== canonicalJson(offered)) return fail("sponsor_recipe_unsupported");
  const release = await wait(() => registeredExperience("short-story"));
  if (!release || release.output.output !== "short_story") return fail("sponsor_recipe_unsupported");
  const recipe: SponsorRecipe = { appId: "short-story", recipeVersion: `short-story@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: "short_story", provider: "openai", model: String(offered.model), routeDigest: await wait(() => digest(offered)), settingsDigest: await wait(() => digest(offered.settings)),
    outputCount: 1, durationMs: 0, width: 0, height: 0, calls: { parsing: 0, planning: 1, render: 0, repair: 0 }, maximumTokens: 128000, maximumMicrousd: Number(offered.maximumMicrousd) };
  const description = { actorKind: "canonical-principal" as const, actorUserId: principal.userId,
    sessionDigest: await wait(() => digest({ version: "sponsor-canonical-principal@1", userId: principal.userId, consentVersion: principal.consentVersion, authorizationSnapshot: principal.authorizationSnapshot ?? null })),
    ownerUserId: principal.userId, projectId: trusted.scope.projectId, documentId: trusted.scope.documentId, sourceRevision: row.source_head,
    sourceDigest: `sha256:${trusted.sourceDigest}`, orderedAssetDigests: [] as string[], rightsDigest: await wait(() => digest(trusted.sourceAssertions)),
    compiledInputDigest: await wait(() => digest({ snapshot: context.snapshot, settings: offered.settings })),
    transferEnvelopeDigest: await wait(() => digest({ sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest, settings: offered.settings })), recipe,
    preflightExpiresAtMs: Date.parse(row.expires_at) };
  const assertions: OutputSqlAssertion[] = [...sponsorCurrentSourceAssertions(trusted),
    { sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${principalColumns.map(column => `captured.${column}`).join(",")})=?)`, bindings: [principal.userId, JSON.stringify(principalColumns.map(column => principalRow[column] ?? null))] },
    { sql: `EXISTS(SELECT 1 FROM (${quoteSql}) captured WHERE terms_digest=? AND expires_at=? AND private_json=? AND source_head=? AND plan_revision_id=? AND plan_json=?)`,
      bindings: [...bindings, row.terms_digest, row.expires_at, row.private_json, row.source_head, row.plan_revision_id, row.plan_json] }];
  const deadline = Math.min(description.preflightExpiresAtMs, ...assertions.flatMap(assertion => assertion.deadlineMs === undefined ? [] : [assertion.deadlineMs]));
  if (!current() || !Number.isFinite(deadline) || deadline <= Date.now()) return fail("sponsor_authority_changed");
  const checked = await wait(() => database.batch<Record<string, unknown>>(outputProofReadStatements(env, assertions)));
  assertStoryProofRead(checked, assertions.length);
  if (!current() || deadline <= Date.now()) return fail("sponsor_authority_changed");
  const assertFinalCurrent = () => {
    assertCurrent();
    if (deadline <= Date.now()) return fail("sponsor_authority_changed");
  };
  const evidence = freeze({ description, offered: JSON.parse(canonicalJson(offered)) as Record<string, unknown> });
  assertFinalCurrent();
  return { ...evidence, assertCurrent: assertFinalCurrent };
}

export async function describeSponsorStoryAdmission(trusted: OutputTrustedContext, command: Record<string, unknown>) {
  const native = await readNative(trusted, command);
  native.assertCurrent();
  return native.description;
}
export async function readSponsorStoryTemplateEvidence(trusted: OutputTrustedContext, command: Record<string, unknown>, recipe: SponsorRecipe) {
  const native = await readNative(trusted, command);
  if (canonicalJson(native.description.recipe) !== canonicalJson(recipe)) return fail("sponsor_native_envelope_mismatch");
  const evidence = freeze({ recipe: native.description.recipe, offered: native.offered });
  native.assertCurrent();
  return evidence;
}
