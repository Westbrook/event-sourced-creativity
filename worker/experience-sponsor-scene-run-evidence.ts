import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import { captureSponsorSceneJson } from "./experience-sponsor-scene-contract.ts";
import { requireSceneSponsorRunPreparation, type SceneSponsorRunPreparation } from "./output-scene-sponsored-handoff.ts";
import { outputScenePreflightProof } from "./output-scene-preflight.ts";
import { readOutputScenePayload } from "./output-scene-preflight-contract.ts";
import { requireSceneMiniAppCostApproval } from "./scene-mini-app-consent.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { outputProofReadStatements } from "./output-disclosure-proof.ts";
import { SponsorEntitlementError, type SponsorRecipe } from "./experience-sponsor-policy.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";

const fail = (): never => { throw new SponsorEntitlementError("sponsor_scene_run_evidence_changed"); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const principalColumns = ["user_id", "email", "display_name", "role", "consent_version", "consented_at", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"];
const originalSql = `SELECT grant_row.authorization_event_id,grant_row.preflight_id,grant_row.expires_at,authorization.private_json AS authorization_json,
 quote.private_json AS quote_json,preflight.terms_digest,slot.route_digest,slot.source_digest,slot.maximum_tokens,slot.maximum_microusd,slot.provider,slot.model
 FROM output_execution_grants grant_row
 JOIN output_operation_slots slot ON slot.scope_key=grant_row.scope_key AND slot.grant_id=grant_row.grant_id
 JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
 JOIN event_private_payloads authorization ON authorization.private_event_id=grant_row.authorization_event_id AND authorization.owner_id=plan.owner_user_id
  AND authorization.project_id=plan.project_id AND authorization.document_id=plan.document_id AND authorization.redacted_at IS NULL
 JOIN output_preflights preflight ON preflight.scope_key=grant_row.scope_key AND preflight.preflight_id=grant_row.preflight_id
 JOIN event_private_payloads quote ON quote.private_event_id=preflight.event_id AND quote.owner_id=plan.owner_user_id
  AND quote.project_id=plan.project_id AND quote.document_id=plan.document_id AND quote.redacted_at IS NULL
 WHERE grant_row.scope_key=? AND grant_row.grant_id=? AND grant_row.actor_user_id=? AND plan.owner_user_id=?
  AND plan.document_id=? AND plan.project_id=? AND slot.slot_id=? AND slot.job_id=? AND plan.scope_kind='personal'
  AND grant_row.context_id IS NULL AND grant_row.plan_revision_id=slot.plan_revision_id
  AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
  AND length(CAST(authorization.private_json AS BLOB))<=524288 AND length(CAST(quote.private_json AS BLOB))<=524288`;
type Original = { authorization_event_id: string; preflight_id: string; expires_at: string; authorization_json: string; quote_json: string;
  terms_digest: string; route_digest: string; source_digest: string; maximum_tokens: number; maximum_microusd: number; provider: string; model: string };

/** Separate current Run evidence. Never rewrites an authorize command's revision,
 * manufactures confirmed consent, or changes the original retained source version.
 * Persistent predicates exclude the pre-Run source generation: the native writer
 * legitimately advances it, and dispatch later checks the recorded successor. */
export async function readSponsorSceneRunEvidence(trusted: OutputTrustedContext, commandInput: Record<string, unknown>, recipeInput: SponsorRecipe,
  preparation: SceneSponsorRunPreparation) {
  const command = captureSponsorSceneJson(commandInput), recipe = captureSponsorSceneJson(recipeInput);
  if (!record(command) || !exactKeys(command, ["documentId", "action", "expectedRevision", "clientMutationId", "grantId"])
    || command.action !== "run" || command.documentId !== trusted.scope.documentId || !id(command.grantId) || !id(command.clientMutationId)
    || typeof command.expectedRevision !== "string" || !/^output:[0-9]+$/u.test(command.expectedRevision)) return fail();
  const native = await requireSceneSponsorRunPreparation(preparation, trusted, command);
  native.assertCurrent();
  const env = trusted.env, database = env.DB, scope = trusted.scope, principal = trusted.principal;
  if (scope.kind !== "personal" || scope.actorUserId !== scope.ownerUserId || scope.contextId || scope.organizationId || scope.projectAccessId
    || principal.userId !== scope.actorUserId || principal.streamId !== `creative:${scope.actorUserId}` || principal.fictional || principal.projectExecution
    || principal.billingUserId && principal.billingUserId !== principal.userId || env.FORMA_PILOT_COHORT_ID?.trim()) return fail();
  const proof = outputScenePreflightProof(native.nativePreflight);
  if (!proof?.prepared.sourceVersion || native.slot.grantId !== command.grantId || native.slot.scopeKey !== scope.key
    || proof.requestId !== native.slot.jobId || canonicalJson(proof.prepared.sourceVersion) !== canonicalJson(native.receipt.witness.successor)) return fail();
  const auth = await readExistingPrincipalRequest(trusted.request, env, "creator", { account: "principal" });
  native.assertCurrent();
  if ("kind" in auth || auth.response || !auth.user || auth.user.consentVersion !== POLICY_VERSION || canonicalJson(auth.user) !== canonicalJson(principal)) return fail();
  const capturedPrincipal = await database.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(principal.userId).first<Record<string, unknown>>();
  native.assertCurrent();
  if (!capturedPrincipal) return fail();
  const expected = { userId: String(capturedPrincipal.user_id), email: String(capturedPrincipal.email), displayName: String(capturedPrincipal.display_name),
    role: String(capturedPrincipal.role), consentVersion: capturedPrincipal.consent_version ? String(capturedPrincipal.consent_version) : null,
    consentedAt: capturedPrincipal.consented_at ? String(capturedPrincipal.consented_at) : null,
    authorizationSnapshot: { updatedAt: String(capturedPrincipal.updated_at ?? ""), rawEpoch: String(capturedPrincipal.permission_epoch ?? ""),
      grants: String(capturedPrincipal.grants_json ?? "[]"), organizations: String(capturedPrincipal.organizations_json ?? "[]"),
      projects: String(capturedPrincipal.projects_json ?? "[]"), identityPolicies: String(capturedPrincipal.identity_policies_json ?? "[]"), canvasRequirements: Number(capturedPrincipal.approved_canvas_requirements ?? 0) } };
  if (canonicalJson(expected) !== canonicalJson({ userId: principal.userId, email: principal.email, displayName: principal.displayName, role: principal.role,
    consentVersion: principal.consentVersion, consentedAt: principal.consentedAt, authorizationSnapshot: principal.authorizationSnapshot })) return fail();
  const bindings = [scope.key, command.grantId, principal.userId, principal.userId, scope.documentId, scope.projectId, native.slot.slotId, native.slot.jobId];
  const original = await database.prepare(originalSql).bind(...bindings).first<Original>();
  native.assertCurrent();
  if (!original || original.authorization_json.length > 524288 || original.quote_json.length > 524288 || !(Date.parse(original.expires_at) > Date.now())) return fail();
  const authorization = captureSponsorSceneJson(JSON.parse(original.authorization_json)), quoteBody = captureSponsorSceneJson(JSON.parse(original.quote_json));
  const authorize = record(authorization) && record(authorization.output_command_envelope) ? authorization.output_command_envelope : null;
  const quote = record(quoteBody) && record(quoteBody.preflight) ? quoteBody.preflight : null;
  if (!authorize || !quote || !exactKeys(authorize, ["documentId", "action", "expectedRevision", "clientMutationId", "preflightId", "termsDigest", "maximumMicrousd", "explicitAuthorization", "sceneCostConsent", "sponsor_entitlement"])
    || authorize.action !== "authorize" || authorize.documentId !== scope.documentId || authorize.explicitAuthorization !== true
    || !record(authorize.sponsor_entitlement) || authorize.preflightId !== original.preflight_id || authorize.termsDigest !== original.terms_digest
    || canonicalJson(quote) !== canonicalJson(native.quote) || quote.id !== original.preflight_id || quote.termsDigest !== original.terms_digest
    || authorize.maximumMicrousd !== quote.maximumMicrousd || !Array.isArray(quote.targets) || quote.targets.length !== 1
    || canonicalJson(quote.targets[0]) !== canonicalJson(native.nativePreflight)) return fail();
  const settings = native.nativePreflight.settings as Record<string, unknown>, payload = await readOutputScenePayload(settings.payload);
  native.assertCurrent();
  if (!payload || payload.sceneRequestId !== native.slot.jobId || proof.requestId !== payload.sceneRequestId
    || payload.outputScene.costPreview.expiresAt !== proof.expiresAt) return fail();
  requireSceneMiniAppCostApproval(authorize.sceneCostConsent, payload.outputScene.costPreview, payload.outputScene.costPreview);
  const release = await registeredExperience("scene");
  native.assertCurrent();
  if (!release || release.releaseHash !== payload.outputScene.intake.releaseHash) return fail();
  const actual: SponsorRecipe = { appId: "scene", recipeVersion: `scene@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: "scene", provider: "openai", model: String(native.nativePreflight.model), routeDigest: await digest(native.nativePreflight), settingsDigest: await digest(settings),
    outputCount: 1, durationMs: 0, width: 0, height: 0, calls: { parsing: 0, planning: 1, render: 0, repair: 0 }, maximumTokens: 128000, maximumMicrousd: 1000000 };
  native.assertCurrent();
  if (canonicalJson(actual) !== canonicalJson(recipe) || actual.routeDigest !== `sha256:${original.route_digest}` || original.source_digest !== trusted.sourceDigest
    || actual.provider !== original.provider || actual.model !== original.model || actual.maximumTokens !== original.maximum_tokens || actual.maximumMicrousd !== original.maximum_microusd) return fail();
  const persistentAssertions: OutputSqlAssertion[] = [
    { sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) captured WHERE json_array(${principalColumns.map(column => `captured.${column}`).join(",")})=?)`,
      bindings: [principal.userId, JSON.stringify(principalColumns.map(column => capturedPrincipal[column] ?? null))] },
    { sql: `EXISTS(SELECT 1 FROM (${originalSql}) captured WHERE authorization_event_id=? AND preflight_id=? AND expires_at=? AND authorization_json=? AND quote_json=? AND terms_digest=?
       AND route_digest=? AND source_digest=? AND maximum_tokens=? AND maximum_microusd=? AND provider=? AND model=?)`,
      bindings: [...bindings, original.authorization_event_id, original.preflight_id, original.expires_at, original.authorization_json, original.quote_json, original.terms_digest,
        original.route_digest, original.source_digest, original.maximum_tokens, original.maximum_microusd, original.provider, original.model], deadlineMs: Date.parse(original.expires_at) },
  ];
  const assertions = [...native.assertions, ...persistentAssertions], deadlineMs = Math.min(native.deadlineMs, Date.parse(original.expires_at));
  if (assertions.length > 160 || assertions.some(proof => proof.sql.length > 100000 || (proof.bindings?.length ?? 0) > 100)
    || new TextEncoder().encode(canonicalJson(assertions)).byteLength > 2 * 1024 * 1024) return fail();
  const assertCurrent = () => { native.assertCurrent(); if (env.DB !== database || deadlineMs <= Date.now()) return fail(); };
  assertCurrent();
  const checked = await database.batch<Record<string, unknown>>(outputProofReadStatements(env, assertions));
  assertCurrent();
  const own = (value: unknown, key: PropertyKey): unknown => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  if (!Array.isArray(checked) || own(checked, "length") !== assertions.length || Array.from({ length: assertions.length }, (_, index) => {
    const result = own(checked, index), rows = own(result, "results");
    return own(result, "success") !== true || own(result, "error") !== undefined || !Array.isArray(rows) || own(rows, "length") !== 1 || own(own(rows, 0), "current") !== 1;
  }).some(Boolean)) return fail();
  assertCurrent();
  return freeze({ recipe: actual, offered: JSON.parse(canonicalJson(native.nativePreflight)) as Record<string, unknown>, persistentAssertions, deadlineMs, assertCurrent });
}
