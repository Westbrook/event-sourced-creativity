import { memoryDerivationSourceWindow } from "../src/model/memory-derivation-policy.ts";
import { readNativeControlBody } from "./native-control-body.ts";
export { NATIVE_CONTROL_READ_TIMEOUT_MS as MEMORY_CONTROL_READ_TIMEOUT_MS } from "./native-control-body.ts";
import { createMemoryElapsed } from '../src/model/memory-lifetime.ts';
import { MEMORY_DERIVATION_HEALTH, parseMemoryDerivationHealth } from '../src/model/memory-derivation-health.ts';
import { readProjectRequestContext, resolveOwnerExecutionScope } from './project-access.ts';
import { nativeMemoryDocumentIdentity, nativeMemoryDocumentScopeQuery, prepareNativeMemoryDocumentScopeObservation } from "./memory-native-scope.ts";
import { readNativeDerivationResult,nativeDerivationResultInputs,nativeDerivationResultResources,nativeDerivationResultStatements,withdrawNativeDerivationResult } from "./memory-derivation-results.ts";
import { controlNativeDerivationResult,reviseNativeDerivationUserControl } from "./memory-derivation-user-controls.ts";
import { DERIVATION_USER_CONTROL_COLUMNS, derivationControlRelation } from "./memory-derivation-user-control-schema.ts";
import { memoryDerivationFinanceView, memoryDerivationFinanceViewStatement } from "./memory-derivation-finance-view.ts";
import { requireUser, requireConsent, type PilotUser, type ProjectExecutionScope } from "./pilot-policy.ts";
import { prepareDocumentAuthority } from "./context-authoring-authority.ts";
import { executionAdmissionGuard } from "./consequential-consent.ts";
import { parseMemoryCustody, memoryCustodyMatches } from "../src/model/memory-custody.ts";
import { liveMemoryAuthority, liveMemoryAuthorityFromPrincipal, liveMemoryEnrollmentGuard, type LiveMemoryEnrollment } from "./memory-live-authority.ts";
import { memoryCanonical, type MemorySqlGuard } from "./memory-sql.ts";
import { MEMORY_DERIVATION_CONTROL, MEMORY_DERIVATION_POLICY, MEMORY_DERIVATION_PURPOSES, DERIVATION_QUALIFICATION_COLUMNS,
  derivationExact, derivationConsentId, derivationHash, derivationId, derivationInteger, derivationTime, parseMemoryDerivationQualification,
  type MemoryDerivationTerms } from "./memory-derivation-policy.ts";
import { memoryDerivationSchema, memoryDerivationBinding, memoryDerivationEnabled, memoryDerivationGrantShape,
  memoryDerivationGrantId, prepareDerivationCapFloor, derivationResults, derivationVerified, derivationChanged, derivationAssertion, derivationRowGuard,
  derivationQualificationGuard, readDerivationQualification, prepareDerivationWithdrawal, DERIVATION_GRANT_COLUMNS,
  type MemoryDerivationGrant } from "./memory-derivation-store.ts";
import type { MemoryDerivationPurpose } from "./memory-derivation-result.ts";
import type { WorkerEnv } from "./runtime.ts";

type Row = Record<string, unknown>;
const headers = { "cache-control": "private, no-store", vary: "Cookie, oai-authenticated-user-id, oai-authenticated-user-email" };
const reply = (value: Row, status = 200) => {
  const body = JSON.stringify({ version: MEMORY_DERIVATION_CONTROL, ...value });
  return new TextEncoder().encode(body).byteLength <= 524288 ? new Response(body, { status, headers: { ...headers, "content-type": "application/json" } })
    : Response.json({ version: MEMORY_DERIVATION_CONTROL, error: "memory_derivation_response_too_large" }, { status: 503, headers });
};
const deny = (error: string, status = 400) => reply({ error }, status);
const privateResponse = (response: Response) => new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...headers } });
const failure = () => deny("memory_derivation_commit_delivery_unconfirmed", 503);
export const parentColumns = ["enrollment_id", "actor_user_id", "owner_user_id", "organization_id", "project_access_id", "project_id", "document_id",
  "permission_epoch", "policy_version", "revision", "learn_enabled", "recall_enabled", "background_enabled", "retention_days", "time_zone",
  "enrolled_at", "expires_at", "cursor_sequence", "cutoff_sequence", "last_local_day", "last_admitted_at", "next_due_at", "lease_token", "lease_expires_at", "attempts", "failure_code"] as const;
const clock = (before: string): MemorySqlGuard => ({ condition: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [before] });
const settingsKey = (env: WorkerEnv) => memoryCanonical([env.FORMA_MEMORY_ENABLED, env.FORMA_MEMORY_USER_IDS,
  env.FORMA_MEMORY_DERIVATION_ENABLED, env.FORMA_MEMORY_DERIVATION_USER_IDS, env.FORMA_MEMORY_DERIVATION_PROCESSING_ENABLED, env.FORMA_MEMORY_SCHEDULING_ENABLED, memoryDerivationBinding(env)]);
function grantView(grant: MemoryDerivationGrant) {
  return { scope: { projectId: grant.project_id, documentId: grant.document_id,
    custody: grant.organization_id === null ? { kind: "personal" } : { kind: "organization", organizationId: grant.organization_id,
      projectAccessId: grant.project_access_id, ownerUserId: grant.owner_user_id } }, consentId: grant.consent_id, grantId: grant.grant_id, revision: grant.revision, purpose: grant.purpose, enrollmentId: grant.enrollment_id,
    enrollmentRevision: grant.enrollment_revision, qualificationId: grant.qualification_id, termsSha256: grant.terms_sha256,
    monthlyCapMicroUsd: grant.monthly_cap_microusd, sourceAfterSequence: grant.source_after_sequence,
    background: grant.background_enabled === 1, retentionDays: grant.retention_days, consentedAt: grant.consented_at,
    expiresAt: grant.expires_at, revokedAt: grant.revoked_at };
}
async function rows(env: WorkerEnv, sql: string, bindings: (string | number | null)[]): Promise<Row[]> {
  const db = env.DB, result = structuredClone(await db.prepare(sql).bind(...bindings).all<Row>());
  if (env.DB !== db || !derivationResults([result], 1)) throw new Error("memory-derivation-read-unavailable");
  return result.results;
}
function inventoryGuard(table: "memory_derivation_grants" | "memory_derivation_qualifications", columns: readonly string[],
  where: string, bindings: (string | number | null)[], order: string, selected: Row[]): MemorySqlGuard {
  const value = JSON.stringify(selected.map(row => columns.map(key => row[key])));
  return { condition: `(SELECT json_group_array(json_array(${columns.join(",")})) FROM
    (SELECT ${columns.join(",")} FROM ${table} WHERE ${where} ORDER BY ${order}))=?`, bindings: [...bindings, value] };
}
/** Compatibility boundary for the existing Memory/specialist control routes. */
export async function bodyOf(request: Request, maximumBytes = 4096): Promise<Row | null> {
  const body = await readNativeControlBody(request, maximumBytes);
  return body.status === "parsed" ? body.value : null;
}
async function scope(request: Request, env: WorkerEnv, actor: PilotUser, projectId: string, documentId: string) {
  if(request.method==='GET')return readScope(request,env,actor,projectId,documentId);
  const prepared = await prepareDocumentAuthority(request, env, { projectId, documentId }, "read");
  if (prepared instanceof Response) return privateResponse(prepared);
  if (prepared.principal.fictional || prepared.principal.userId !== actor.userId || prepared.principal.projectExecution
    || prepared.principal.billingUserId && prepared.principal.billingUserId !== actor.userId) return deny("memory_derivation_self_payer_required", 403);
  const binding = prepared.binding, shared = binding.scope;
  const parents = await rows(env, `SELECT ${parentColumns.join(",")} FROM memory_live_enrollments WHERE
    (actor_user_id,owner_user_id,organization_id,project_access_id,project_id,document_id) IS (?,?,?,?,?,?) LIMIT 2`,
    [actor.userId, shared?.ownerUserId ?? actor.userId, shared?.organizationId ?? null, shared?.projectAccessId ?? null, projectId, documentId]);
  if (parents.length !== 1 || !derivationExact(parents[0], parentColumns)) return deny("memory_derivation_parent_required", 409);
  const parent = parents[0] as unknown as LiveMemoryEnrollment, now = new Date().toISOString();
  if (parent.policy_version !== "personal-memory-v2" || parent.permission_epoch !== actor.access.permissionEpoch
    || parent.learn_enabled !== 1 || !derivationTime(parent.expires_at) || parent.expires_at <= now
    || ["forgotten", "erased", "access-changed", "revoked"].includes(parent.failure_code ?? "")) return deny("memory_derivation_parent_unavailable", 409);
  const background = await liveMemoryAuthority(env, parent);
  if (!background) return deny("memory_derivation_authority_unavailable", 403);
  const admission = executionAdmissionGuard(prepared.principal, binding, prepared.sourceHead);
  return { prepared, parent, guards: [{ condition: admission.sql, bindings: admission.bindings }, background.guard,
    liveMemoryEnrollmentGuard(parent, "learn"), derivationRowGuard("memory_live_enrollments", parentColumns, parent)] };
}

/** Read-only inventory/control authority. Source identities and current custody
 * are proved natively; a presentation GET never hydrates the whole project or
 * rebuilds its index (which can retire otherwise valid retained results). */
export async function readScope(request:Request|null,env:WorkerEnv,actor:PilotUser,projectId:string,documentId:string,nativeScope?:ProjectExecutionScope|null){
  const db=env.DB,consent=requireConsent(actor);if(consent)return privateResponse(consent);
  if(actor.projectExecution||actor.billingUserId&&actor.billingUserId!==actor.userId)return deny('memory_derivation_self_payer_required',403);
  nativeScope=nativeScope?structuredClone(nativeScope):nativeScope;
  // Internal selectors are identities, not authority. Re-prove exact custody,
  // enrollment and principal permissions below; HTTP never supplies this argument.
  if(nativeScope&&(request!==null||!derivationExact(nativeScope,['organizationId','projectAccessId','projectId','ownerUserId','actorUserId'])
    ||!Object.values(nativeScope).every(derivationId)||nativeScope.actorUserId!==actor.userId||nativeScope.projectId!==projectId))return deny('memory_derivation_scope_unavailable',403);
  const selected=request?await readProjectRequestContext(request,env,actor):{context:null,response:null};if(selected.response)return privateResponse(selected.response);
  const context=selected.context;if(context&&context.projectId!==projectId)return deny('context_project_denied',403);
  const custody=context?{scope:{organizationId:context.organizationId,projectAccessId:context.projectAccessId,projectId,ownerUserId:context.ownerUserId,actorUserId:actor.userId},denied:false}
    :nativeScope?{scope:nativeScope,denied:false}:await resolveOwnerExecutionScope(env,actor,documentId,projectId,'read');
  if(custody.denied)return deny('context_custody_unavailable',403);
  const shared=custody.scope,parentQuery=`SELECT ${parentColumns.join(',')} FROM memory_live_enrollments WHERE
    (actor_user_id,owner_user_id,organization_id,project_access_id,project_id,document_id) IS (?,?,?,?,?,?) LIMIT 2`;
  const parentBindings=[actor.userId,shared?.ownerUserId??actor.userId,shared?.organizationId??null,shared?.projectAccessId??null,projectId,documentId];
  const scopeQuery=nativeMemoryDocumentScopeQuery(shared?.ownerUserId??actor.userId,documentId);
  const observed=structuredClone(await db.batch<Row>([db.prepare(parentQuery).bind(...parentBindings),db.prepare(scopeQuery.sql).bind(...scopeQuery.bindings)]));
  if(env.DB!==db||!derivationResults(observed,2))throw Error('memory-scope-unavailable');
  const parents=observed[0]!.results;
  if(parents.length!==1||!derivationExact(parents[0],parentColumns))return deny('memory_derivation_parent_required',409);
  const parent=parents[0] as unknown as LiveMemoryEnrollment;
  if(parent.policy_version!=='personal-memory-v2'||parent.permission_epoch!==actor.access.permissionEpoch||parent.learn_enabled!==1
    ||!derivationTime(parent.expires_at)||parent.expires_at<=new Date().toISOString()
    ||['forgotten','erased','access-changed','revoked'].includes(parent.failure_code??''))return deny('memory_derivation_parent_unavailable',409);
  const authority=liveMemoryAuthorityFromPrincipal(env,parent,actor);if(!authority)return deny('memory_derivation_authority_unavailable',403);
  const binding={...authority.binding,contextSessionId:context?.contextId??null},admission=executionAdmissionGuard(actor,binding,null);
  const guards:MemorySqlGuard[]=[{condition:admission.sql,bindings:admission.bindings},authority.guard,liveMemoryEnrollmentGuard(parent,'learn'),
    derivationRowGuard('memory_live_enrollments',parentColumns,parent)];
  const scopeRead=prepareNativeMemoryDocumentScopeObservation(env,{principal:actor,binding},parent,{require:guard=>guards.push({condition:guard.sql,bindings:guard.bindings}),before:deadline=>{if(deadline!==null)guards.push(clock(deadline));},observe:(_statements,results,descriptors)=>{
    if(descriptors?.length!==1||results.length!==1)throw Error('memory-scope-unavailable');
    const query=descriptors[0]!;
    guards.push({condition:`(SELECT json_group_array(json_array(declaration,lifecycle,custody)) FROM (${query.sql}))=?`,
      bindings:[...query.bindings,JSON.stringify(results[0]!.results.map(row=>[row.declaration,row.lifecycle,row.custody]))]});
  }});
  const identity=scopeRead?.accept(observed[1]!);
  if(!identity||env.DB!==db)return deny('memory_derivation_scope_unavailable',403);
  return {parent,prepared:{principal:actor,binding,sourceHead:null},guards,accessDeadline:context?.expiresAt??null};
}

/** Original actors may inspect their own consent metadata to withdraw it even
 * after learning/access/qualification expires. This never reads source bodies,
 * offers new consent or grants document access. Mutations still use native scope. */
async function ownedScope(env: WorkerEnv, actor: PilotUser, projectId: string, documentId: string) {
  const identity = actor.authorizationSnapshot;
  if (!identity) return deny("memory_derivation_identity_unavailable", 403);
  const found = await rows(env, `SELECT ${parentColumns.join(",")} FROM memory_live_enrollments WHERE actor_user_id=? AND project_id=? AND document_id=? LIMIT 2`, [actor.userId, projectId, documentId]);
  if (found.length !== 1 || !derivationExact(found[0], parentColumns)) return deny("memory_derivation_parent_required", 409);
  const parent = found[0] as unknown as LiveMemoryEnrollment;
  return { prepared: null, parent, guards: [derivationRowGuard("memory_live_enrollments", parentColumns, parent),
    { condition: "EXISTS(SELECT 1 FROM users WHERE user_id=? AND role=? AND COALESCE(updated_at,'')=?)", bindings: [actor.userId, actor.role, identity.updatedAt] }] };
}

/** Controls only. No route provisions credentials, creates qualification/cap
 * evidence, dispatches a model, reserves allowance, or schedules background work. */
export async function handleMemoryDerivationSettings(request: Request, env: WorkerEnv): Promise<Response> {
  const db = env.DB, configuration = settingsKey(env), started = Date.now(), deadline = new Date(started + 60000).toISOString();
  const auth = await requireUser(request, env, "viewer", { account: "principal" });
  if (auth.response || !auth.user) return privateResponse(auth.response ?? deny("authentication_required", 401));
  const actor = auth.user;
  if (actor.fictional) return deny("principal_account_required", 403);
  const current = () => env.DB === db && settingsKey(env) === configuration && Date.now() < started + 60000;
  const url = new URL(request.url);
  if (!["GET", "PUT", "DELETE"].includes(request.method)) return deny("method_not_allowed", 405);
  if (request.method !== "GET" && (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site")) return deny("same_origin_required", 403);
  try {
    const schema = await memoryDerivationSchema(env);
    if (!current()) return deny("memory_derivation_unavailable", 503);
    if (!schema.present) return request.method === "GET" ? reply({ enabled: false, available: false, reason: "schema-unavailable", grants: [], qualifications: [] }) : deny("memory_derivation_schema_unavailable", 503);
    if (request.method === "DELETE") {
      const body = await bodyOf(request), grantId = url.searchParams.get("grantId");
      if (!derivationHash(grantId) || [...url.searchParams.keys()].some(key => key !== "grantId") || url.searchParams.getAll("grantId").length !== 1
        || !body || !derivationExact(body, ["version", "revision", "consentId", "confirmation"]) || body.version !== MEMORY_DERIVATION_CONTROL
        || body.confirmation !== "REVOKE_DERIVED_MEMORY" || !derivationInteger(body.revision, 1) || !derivationConsentId(body.consentId)) return deny("explicit_memory_derivation_revocation_required");
      const found = await rows(env, `SELECT ${DERIVATION_GRANT_COLUMNS.join(",")} FROM memory_derivation_grants WHERE grant_id=? AND actor_user_id=? ORDER BY revision DESC LIMIT 1`, [grantId, actor.userId]);
      if (found.length !== 1 || !memoryDerivationGrantShape(found[0])) return deny("memory_derivation_not_found", 404);
      const grant = found[0], identity = actor.authorizationSnapshot;
      if (grant.revision !== body.revision || grant.consent_id !== body.consentId) return deny("memory_derivation_revision_changed", 409);
      if (!identity) return deny("memory_derivation_identity_unavailable", 403);
      const guards = [schema.guard, clock(deadline), { condition: "EXISTS(SELECT 1 FROM users WHERE user_id=? AND role=? AND COALESCE(updated_at,'')=?)", bindings: [actor.userId, actor.role, identity.updatedAt] },
        derivationRowGuard("memory_derivation_grants", DERIVATION_GRANT_COLUMNS, grant),
        { condition: "NOT EXISTS(SELECT 1 FROM memory_derivation_grants WHERE grant_id=? AND revision>?)", bindings: [grantId, grant.revision] }];
      const withdrawal = await prepareDerivationWithdrawal(env, { grantId, currentRevision: grant.revision }, new Date().toISOString());
      const statements = [...guards.map(guard => derivationAssertion(env, guard)), ...withdrawal.statements,
        derivationAssertion(env, guards[0]!), derivationAssertion(env, guards[1]!), derivationAssertion(env, guards[2]!), derivationAssertion(env, guards[4]!)];
      if (!current()) return failure();
      const result = structuredClone(await db.batch(statements));
      if (!current() || !derivationResults(result, statements.length) || !result.slice(0, guards.length).every(derivationVerified)
        || !result.slice(-4).every(derivationVerified) || !withdrawal.acknowledge(result.slice(guards.length, guards.length + withdrawal.statements.length))) return failure();
      return reply({ revoked: true, grantId, revision: grant.revision, consentId: grant.consent_id, reEnrollmentRequired: true });
    }
    const body = request.method === "PUT" ? await bodyOf(request) : null;
    const projectId = body?.projectId ?? url.searchParams.get("projectId"), documentId = body?.documentId ?? url.searchParams.get("documentId");
    if (!derivationId(projectId) || !derivationId(documentId) || projectId.length > 120 || documentId.length > 120
      || request.method === "GET" && ([...url.searchParams.keys()].some(key => !["projectId", "documentId"].includes(key))
        || url.searchParams.getAll("projectId").length !== 1 || url.searchParams.getAll("documentId").length !== 1)
      || request.method === "PUT" && url.search) return deny("memory_derivation_scope_required");
    let selected: Awaited<ReturnType<typeof scope>> | Awaited<ReturnType<typeof ownedScope>> = await scope(request, env, actor, projectId, documentId);
    if (selected instanceof Response && request.method === "GET" && [403, 409].includes(selected.status)) selected = await ownedScope(env, actor, projectId, documentId);
    if (selected instanceof Response) return selected;
    const { parent, prepared } = selected, binding = memoryDerivationBinding(env), enabled = prepared !== null && memoryDerivationEnabled(env, actor.userId)
      && url.origin === binding?.origin;
    const grantWhere = "enrollment_id=? AND actor_user_id=?", grantBindings = [parent.enrollment_id, actor.userId];
    const stored = await rows(env, `SELECT ${DERIVATION_GRANT_COLUMNS.join(",")} FROM memory_derivation_grants WHERE ${grantWhere} ORDER BY grant_id,revision LIMIT 193`, grantBindings);
    if (stored.length > 192 || !stored.every(memoryDerivationGrantShape)) return deny("memory_derivation_inventory_unavailable", 503);
    const baseGuards = [schema.guard, clock(deadline), ...selected.guards,
      inventoryGuard("memory_derivation_grants", DERIVATION_GRANT_COLUMNS, grantWhere, grantBindings, "grant_id,revision", stored)];
    if (request.method === "GET") {
      const qualifications: { qualificationId: string; termsSha256: string; expiresAt: string; terms: MemoryDerivationTerms }[] = [];
      if (enabled && binding) {
        const where = "source_sha256=? AND origin=? AND deployment_id=? AND status='qualified' AND expires_at>?",
          values = [binding.sourceSha256, binding.origin, binding.deploymentId, new Date(started).toISOString()];
        const candidates = await rows(env, `SELECT ${DERIVATION_QUALIFICATION_COLUMNS.join(",")} FROM memory_derivation_qualifications WHERE ${where} ORDER BY qualification_id LIMIT 17`, values);
        if (candidates.length > 16) return deny("memory_derivation_inventory_unavailable", 503);
        baseGuards.push(inventoryGuard("memory_derivation_qualifications", DERIVATION_QUALIFICATION_COLUMNS, where, values, "qualification_id", candidates));
        for (const candidate of candidates) { const accepted = await parseMemoryDerivationQualification(candidate, binding);
          if (accepted&&(!['memory-profile-consolidation-v1','memory-field-suggestions-v1'].includes(accepted.terms.recipeVersion)||schema.userControlsPresent&&schema.lifecyclePresent)&&(!['memory-derivation-candidates-v2','memory-field-suggestions-v1'].includes(accepted.terms.recipeVersion)||schema.observationControlsPresent&&schema.lifecyclePresent)) { baseGuards.push(derivationQualificationGuard(accepted.row));
            qualifications.push({ qualificationId: accepted.row.qualification_id, termsSha256: accepted.row.terms_sha256, expiresAt: accepted.row.expires_at, terms: accepted.terms }); } }
      }
      const reads=[...baseGuards.map(guard => derivationAssertion(env, guard)),...(schema.financePresent?[memoryDerivationFinanceViewStatement(env,actor.userId)]:[])];
      const checked = structuredClone(await db.batch(reads));
      if (!current() || !derivationResults(checked, reads.length) || !checked.slice(0,baseGuards.length).every(derivationVerified)
        || schema.financePresent&&checked.at(-1)!.results.length!==1) return deny("memory_derivation_unavailable", 503);
      const financial=schema.financePresent?memoryDerivationFinanceView(checked.at(-1)!.results[0]):undefined;
      return reply({ enabled, available: qualifications.length > 0, reason: !enabled ? "disabled" : qualifications.length ? null : "qualification-required",
        scope: { projectId, documentId, custody: parent.organization_id !== null ? { kind: "organization", organizationId: parent.organization_id, projectAccessId: parent.project_access_id, ownerUserId: parent.owner_user_id } : { kind: "personal" } },
        policyVersion: MEMORY_DERIVATION_POLICY, enrollmentId: parent.enrollment_id, enrollmentRevision: parent.revision,
        grants: stored.map(grant => grantView(grant as MemoryDerivationGrant)), qualifications,...(financial?{financial}:{}),
        capScope: "payer-utc-calendar-month-all-memory-purposes", sourceWindow: qualifications.some(item=>memoryDerivationSourceWindow(item.terms.recipeVersion)!=='future-originals')?"qualified-recipe":"future-originals", processingImplemented: schema.completionPresent && env.FORMA_MEMORY_DERIVATION_PROCESSING_ENABLED === "true" && env.FORMA_MEMORY_SCHEDULING_ENABLED === "true" });
    }
    if (!prepared) return deny("memory_derivation_authority_unavailable", 403);
    if (!body || !derivationExact(body, ["version", "policyVersion", "purpose", "qualificationId", "termsSha256", "projectId", "documentId", "enrollmentId", "enrollmentRevision", "revision", "expectedConsentId", "expectedCustody", "monthlyCapMicroUsd", "background", "retentionDays", "expiresAt", "sourceWindow", "chargeMyAiAllowance", "confirmation"])
      || body.version !== MEMORY_DERIVATION_CONTROL || body.policyVersion !== MEMORY_DERIVATION_POLICY || body.confirmation !== "ENABLE_DERIVED_MEMORY"
      || body.chargeMyAiAllowance !== true || !(["future-originals","future-originals-and-actions","future-originals-actions-and-fields"] as unknown[]).includes(body.sourceWindow) || !MEMORY_DERIVATION_PURPOSES.some(purpose => purpose === body.purpose)
      || !derivationId(body.qualificationId) || !derivationHash(body.termsSha256) || !derivationInteger(body.revision, 0, Number.MAX_SAFE_INTEGER - 1) || !(body.expectedConsentId === null || derivationConsentId(body.expectedConsentId))
      || !derivationInteger(body.retentionDays, 1, 365) || !derivationTime(body.expiresAt) || typeof body.background !== "boolean"
      || !derivationInteger(body.monthlyCapMicroUsd, 1, 1_000_000_000)) return deny("explicit_memory_derivation_consent_required");
    const consent = requireConsent(actor); if (consent) return privateResponse(consent);
    if (!enabled || prepared.sourceHead === null) return deny("memory_derivation_disabled", 503);
    const expectedCustody = parseMemoryCustody(body.expectedCustody);
    if (!expectedCustody || !memoryCustodyMatches(expectedCustody, prepared.binding.scope)) return deny("memory_derivation_custody_changed", 409);
    const qualified = await readDerivationQualification(env, body.qualificationId), now = new Date().toISOString();
    if (!qualified || ['memory-profile-consolidation-v1','memory-field-suggestions-v1'].includes(qualified.terms.recipeVersion)&&(!schema.userControlsPresent||!schema.lifecyclePresent) || ['memory-derivation-candidates-v2','memory-field-suggestions-v1'].includes(qualified.terms.recipeVersion)&&(!schema.observationControlsPresent||!schema.lifecyclePresent)
      || body.sourceWindow!==(memoryDerivationSourceWindow(qualified.terms.recipeVersion)) || qualified.terms.purpose !== body.purpose || qualified.row.terms_sha256 !== body.termsSha256
      || qualified.terms.monthlyCapMicroUsd !== body.monthlyCapMicroUsd) return deny("memory_derivation_qualification_required", 503);
    if (body.enrollmentId !== parent.enrollment_id || body.enrollmentRevision !== parent.revision || body.retentionDays > parent.retention_days
      || body.expiresAt <= now || body.expiresAt > parent.expires_at || body.expiresAt > qualified.row.expires_at
      || Date.parse(body.expiresAt) > Date.now() + 365 * 86400000 || body.background && parent.background_enabled !== 1) return deny("memory_derivation_parent_changed", 409);
    const purpose = body.purpose as MemoryDerivationPurpose, grantId = await memoryDerivationGrantId(parent, purpose), prior = stored.filter(row => row.grant_id === grantId),
      latest = prior.at(-1) as MemoryDerivationGrant | undefined;
    if ((latest?.revision ?? 0) !== body.revision || (latest?.consent_id ?? null) !== body.expectedConsentId || prior.length >= 64) return deny("memory_derivation_revision_changed", 409);
    const grant: MemoryDerivationGrant = { consent_id: crypto.randomUUID(), grant_id: grantId, revision: body.revision + 1, actor_user_id: actor.userId, owner_user_id: parent.owner_user_id,
      organization_id: parent.organization_id, project_access_id: parent.project_access_id, project_id: projectId, document_id: documentId,
      enrollment_id: parent.enrollment_id, enrollment_revision: parent.revision, permission_epoch: parent.permission_epoch, policy_version: MEMORY_DERIVATION_POLICY,
      purpose, qualification_id: qualified.row.qualification_id, terms_sha256: qualified.row.terms_sha256, payer_user_id: actor.userId,
      monthly_cap_microusd: qualified.terms.monthlyCapMicroUsd, source_after_sequence: prepared.sourceHead, retention_days: body.retentionDays,
      background_enabled: Number(body.background), consented_at: now, expires_at: body.expiresAt, revoked_at: null };
    if (!memoryDerivationGrantShape(grant)) return deny("memory_derivation_grant_invalid", 409);
    const withdrawal = latest ? await prepareDerivationWithdrawal(env, { grantId, currentRevision: latest.revision }, now) : null;
    const capFloor = await prepareDerivationCapFloor(env, grant, schema.financePresent);
    const qualifiedGuard = derivationQualificationGuard(qualified.row), grantClock = clock(grant.expires_at), before = [...baseGuards, qualifiedGuard, grantClock, ...capFloor.before], after = [...capFloor.after, schema.guard, clock(deadline), ...selected.guards, qualifiedGuard, grantClock,
      derivationRowGuard("memory_derivation_grants", DERIVATION_GRANT_COLUMNS, grant)];
    const writes = [...(withdrawal?.statements ?? []), db.prepare(`INSERT INTO memory_derivation_grants(${DERIVATION_GRANT_COLUMNS.join(",")}) VALUES(${DERIVATION_GRANT_COLUMNS.map(() => "?").join(",")})`).bind(...DERIVATION_GRANT_COLUMNS.map(key => grant[key])),
      derivationAssertion(env, { condition: "changes()=1", bindings: [] })];
    const statements = [...before.map(guard => derivationAssertion(env, guard)), ...writes, ...after.map(guard => derivationAssertion(env, guard))];
    if (!current() || !memoryDerivationEnabled(env, actor.userId)) return failure();
    try {
      const result = structuredClone(await db.batch(statements));
      if (!current() || new Date().toISOString() >= grant.expires_at || !derivationResults(result, statements.length) || !result.slice(0, before.length).every(derivationVerified)
        || !result.slice(-after.length).every(derivationVerified) || !derivationVerified(result[before.length + writes.length - 1]!)
        || !derivationChanged(result[before.length + writes.length - 2]!, 1, capFloor.changes)
        || withdrawal && !withdrawal.acknowledge(result.slice(before.length, before.length + withdrawal.statements.length))) return failure();
    } catch { return failure(); }
    return reply({ grant: grantView(grant), capScope: "payer-utc-calendar-month-all-memory-purposes", processingImplemented: schema.completionPresent && env.FORMA_MEMORY_DERIVATION_PROCESSING_ENABLED === "true" && env.FORMA_MEMORY_SCHEDULING_ENABLED === "true" });
  } catch { return request.method === "GET" ? deny("memory_derivation_unavailable", 503) : failure(); }
}

function principalGuard(actor:PilotUser):MemorySqlGuard|null{
  return actor.authorizationSnapshot?{condition:"EXISTS(SELECT 1 FROM users WHERE user_id=? AND role=? AND COALESCE(updated_at,'')=?)",
    bindings:[actor.userId,actor.role,actor.authorizationSnapshot.updatedAt]}:null;
}
const sameOrigin=(request:Request)=>request.headers.get('origin')===new URL(request.url).origin&&request.headers.get('sec-fetch-site')!=='cross-site';

/** Private inspection and explicit user changes only. Never provider dispatch. */
export async function handleMemoryDerivationResult(request:Request,env:WorkerEnv):Promise<Response>{
  const db=env.DB,started=Date.now(),configuration=settingsKey(env);
  const auth=await requireUser(request,env,'viewer',{account:'principal'});
  if(auth.response||!auth.user)return privateResponse(auth.response??deny('authentication_required',401));
  const actor=auth.user,identity=principalGuard(actor),url=new URL(request.url),jobId=url.searchParams.get('jobId');
  if(actor.fictional||!identity)return deny('principal_account_required',403);
  if(!['GET','POST','DELETE'].includes(request.method))return deny('method_not_allowed',405);
  if(request.method!=='GET'&&!sameOrigin(request))return deny('same_origin_required',403);
  if(!derivationHash(jobId)||url.searchParams.getAll('jobId').length!==1||[...url.searchParams.keys()].some(key=>!['jobId','resources'].includes(key)))return deny('memory_result_request_invalid');
  const resources=url.searchParams.get('resources');
  if(resources!==null&&(resources!=='1'||request.method!=='GET'||url.searchParams.getAll('resources').length!==1))return deny('memory_result_request_invalid');
  const current=()=>env.DB===db&&Date.now()-started<60000&&settingsKey(env)===configuration;
  try{
    if(request.method==='DELETE'){
      const body=await bodyOf(request);
      if(!body||!derivationExact(body,['version','confirmation'])||body.version!==MEMORY_DERIVATION_CONTROL||body.confirmation!=='WITHDRAW_DERIVED_RESULT')return deny('explicit_memory_result_withdrawal_required');
      if(!current())return failure();
      const withdrawn=await withdrawNativeDerivationResult(env,actor.userId,jobId,identity);
      return current()?withdrawn?reply({jobId,state:'withdrawn'}):deny('memory_result_not_found',404):failure();
    }
    const body=request.method==='POST'?await bodyOf(request,16384):null;
    if(request.method==='POST'&&(!body||!derivationExact(body,['version','claimKey','action','correctionText','expectedRevisions','confirmation'])
      ||body.version!==MEMORY_DERIVATION_CONTROL||body.confirmation!=='CHANGE_DERIVED_MEMORY'||!derivationId(body.claimKey)
      ||!['suppressed','corrected'].includes(String(body.action))||!body.expectedRevisions||typeof body.expectedRevisions!=='object'||Array.isArray(body.expectedRevisions)))return deny('explicit_memory_user_control_required');
    const read=await readNativeDerivationResult(env,actor.userId,jobId);
    if(!read||!current())return deny('memory_result_unavailable',404);
    if(body){
      const controls=await controlNativeDerivationResult(env,read,String(body.claimKey),body.action as 'suppressed'|'corrected',body.correctionText,body.expectedRevisions as Record<string,number>,identity);
      return current()?reply({jobId,state:'withdrawn',controls}):failure();
    }
    const input=nativeDerivationResultInputs(env,read),lineages=[...new Set(input.candidate.items.flatMap(item=>[...item.lineageIds]))];
    const schema=await memoryDerivationSchema(env);
    const controlQuery=`SELECT c.lineage_id,c.revision FROM ${derivationControlRelation(schema.observationControlsPresent)} c JOIN memory_derivation_grants g ON g.enrollment_id=c.enrollment_id AND g.purpose=c.purpose
      JOIN memory_derivation_jobs j ON j.consent_id=g.consent_id WHERE j.job_id=? AND c.actor_user_id=? AND c.lineage_id IN(SELECT value FROM json_each(?)) ORDER BY c.lineage_id`;
    const controlBindings=[jobId,actor.userId,JSON.stringify(lineages)];
    const controls=schema.userControlsPresent?await rows(env,controlQuery,controlBindings):[];
    const controlRevisions=Object.fromEntries(lineages.map(lineage=>[lineage,Number(controls.find(row=>row.lineage_id===lineage)?.revision??0)]));
    const statements=[derivationAssertion(env,identity),...nativeDerivationResultStatements(env,read),...(schema.userControlsPresent?[derivationAssertion(env,{condition:`(SELECT json_group_array(json_array(lineage_id,revision)) FROM (${controlQuery}))=?`,bindings:[...controlBindings,JSON.stringify(controls.map(row=>[row.lineage_id,row.revision]))]})]:[])];
    const checked=structuredClone(await db.batch<Record<string,unknown>>(statements));
    if(!current()||!derivationResults(checked,statements.length)||!checked.every(row=>derivationVerified(row)||row.results.length===1&&row.results[0]?.context_source_asserted===1))return deny('memory_result_unavailable',503);
    nativeDerivationResultInputs(env,read);return reply({...input,controlRevisions,...(resources==='1'?{resourceEvidence:nativeDerivationResultResources(env,read)}:{})});
  }catch{return request.method==='GET'?deny('memory_result_unavailable',503):failure();}
}

export async function handleMemoryDerivationUserControls(request:Request,env:WorkerEnv):Promise<Response>{
  const db=env.DB,started=Date.now();const auth=await requireUser(request,env,'viewer',{account:'principal'});
  if(auth.response||!auth.user)return privateResponse(auth.response??deny('authentication_required',401));
  const actor=auth.user,identity=principalGuard(actor),url=new URL(request.url);
  if(actor.fictional||!identity)return deny('principal_account_required',403);
  if(!['GET','PUT'].includes(request.method))return deny('method_not_allowed',405);
  if(request.method==='PUT'&&!sameOrigin(request))return deny('same_origin_required',403);
  const current=()=>env.DB===db&&Date.now()-started<60000;
  try{
    if(request.method==='PUT'){
      const body=await bodyOf(request,16384);
      if(url.search||!body||!derivationExact(body,['version','controlId','revision','action','correctionText','confirmation'])
        ||body.version!==MEMORY_DERIVATION_CONTROL||body.confirmation!=='CHANGE_DERIVED_MEMORY'||!derivationHash(body.controlId)
        ||!derivationInteger(body.revision,1)||!['suppressed','corrected','released'].includes(String(body.action)))return deny('explicit_memory_user_control_required');
      const result=await reviseNativeDerivationUserControl(env,actor.userId,body.controlId,body.revision,body.action as 'suppressed'|'corrected'|'released',body.correctionText,identity);
      return current()?reply({control:result}):failure();
    }
    const projectId=url.searchParams.get('projectId'),documentId=url.searchParams.get('documentId'),after=url.searchParams.get('after')??'';
    if(!derivationId(projectId)||!derivationId(documentId)||after!==''&&!derivationHash(after)
      ||[...url.searchParams.keys()].some(key=>!['projectId','documentId','after'].includes(key)||url.searchParams.getAll(key).length!==1))return deny('memory_user_control_scope_required');
    const schema=await memoryDerivationSchema(env);
    if(!schema.userControlsPresent)return deny('memory_user_control_schema_unavailable',503);
    let selected:Awaited<ReturnType<typeof scope>>|Awaited<ReturnType<typeof ownedScope>>=await scope(request,env,actor,projectId,documentId);const canReadText=!(selected instanceof Response);
    if(selected instanceof Response&&[403,409].includes(selected.status))selected=await ownedScope(env,actor,projectId,documentId);
    if(selected instanceof Response)return selected;
    const where="enrollment_id=? AND actor_user_id=? AND control_id>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings=[selected.parent.enrollment_id,actor.userId,after];
    // No correction body is loaded on the metadata-only path after access loss.
    const projection=DERIVATION_USER_CONTROL_COLUMNS.map(key=>!canReadText&&key==='correction_text'?'NULL AS correction_text':key).join(',');
    const query=`SELECT ${projection} FROM ${derivationControlRelation(schema.observationControlsPresent)} WHERE ${where} ORDER BY control_id LIMIT 129`;
    const records=await rows(env,query,bindings);
    if(records.length>129||records.some(row=>!derivationExact(row,DERIVATION_USER_CONTROL_COLUMNS)))return deny('memory_user_control_unavailable',503);
    const guard:MemorySqlGuard={condition:`(SELECT json_group_array(json_array(${DERIVATION_USER_CONTROL_COLUMNS.join(',')})) FROM (${query}))=?`,
      bindings:[...bindings,JSON.stringify(records.map(row=>DERIVATION_USER_CONTROL_COLUMNS.map(key=>row[key])))]};
    const checked=await db.batch([schema.guard,identity,...selected.guards,guard].map(value=>derivationAssertion(env,value)));
    if(!current()||records.some(row=>String(row.expires_at)<=new Date().toISOString())||!derivationResults(checked,selected.guards.length+3)||!checked.every(derivationVerified))return deny('memory_user_control_unavailable',503);
    const parent=selected.parent;
    return reply({available:true,scope:{projectId,documentId,custody:parent.organization_id===null?{kind:'personal'}:{kind:'organization',organizationId:parent.organization_id,projectAccessId:parent.project_access_id,ownerUserId:parent.owner_user_id}},enrollmentId:parent.enrollment_id,enrollmentRevision:parent.revision,validUntil:new Date(started+60000).toISOString(),controls:records.slice(0,128).map(row=>({controlId:row.control_id,claimKey:row.claim_key,lineageId:row.lineage_id,
      revision:row.revision,action:row.action,correctionText:row.correction_text,expiresAt:row.expires_at,purpose:row.purpose,textAvailable:canReadText})),next:records.length>128?records[127]!.control_id:null});
  }catch{return request.method==='GET'?deny('memory_user_control_unavailable',503):failure();}
}

/** Bounded metadata discovery. Private text is loaded only by a separate fresh
 * result read, never by this inventory or an arbitrary client scope key. */
export async function handleMemoryDerivationResults(request:Request,env:WorkerEnv):Promise<Response>{
  const db=env.DB,started=Date.now(),configuration=settingsKey(env),url=new URL(request.url);
  const elapsed=createMemoryElapsed({wall:started,monotonic:performance.now()});
  const auth=await requireUser(request,env,'viewer',{account:'principal'});
  if(auth.response||!auth.user)return privateResponse(auth.response??deny('authentication_required',401));
  const actor=auth.user,identity=principalGuard(actor);
  if(actor.fictional||!identity)return deny('principal_account_required',403);
  if(request.method!=='GET')return deny('method_not_allowed',405);
  const projectId=url.searchParams.get('projectId'),documentId=url.searchParams.get('documentId'),after=url.searchParams.get('after')??'',purpose=url.searchParams.get('purpose'),latest=url.searchParams.get('latest'),diagnostics=url.searchParams.get('diagnostics');
  if(!derivationId(projectId)||!derivationId(documentId)||after!==''&&!derivationHash(after)
    ||latest!==null&&(latest!=='1'||purpose===null||after!=='')
    ||diagnostics!==null&&diagnostics!=='1'
    ||purpose!==null&&!MEMORY_DERIVATION_PURPOSES.includes(purpose as MemoryDerivationPurpose)
    ||[...url.searchParams.keys()].some(key=>!['projectId','documentId','after','purpose','latest','diagnostics'].includes(key)||url.searchParams.getAll(key).length!==1))return deny('memory_result_scope_required');
  try{
    const schema=await memoryDerivationSchema(env),selected=await scope(request,env,actor,projectId,documentId);
    if(selected instanceof Response)return selected;
    if(!schema.userControlsPresent)return deny('memory_result_schema_unavailable',503);
    const resource=nativeMemoryDocumentIdentity(selected.parent);if(!resource)return deny('memory_result_scope_unavailable',503);
    const scopeKey=memoryCanonical([resource.partitionKey,resource.documentKey]);
    const now=new Date().toISOString(),cursorGuards:MemorySqlGuard[]=[];
    let afterSequence=Number.MAX_SAFE_INTEGER;
    if(after){
      const cursorQuery=`SELECT j.through_sequence FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
        WHERE j.job_id=? AND g.enrollment_id=? AND g.actor_user_id=? AND g.revoked_at IS NULL AND g.expires_at>?${purpose?' AND g.purpose=?':''}`;
      const cursorBindings=[after,selected.parent.enrollment_id,actor.userId,now,...(purpose?[purpose]:[])],cursor=await rows(env,cursorQuery,cursorBindings);
      if(cursor.length!==1||!derivationExact(cursor[0],['through_sequence'])||!derivationInteger(cursor[0].through_sequence))return deny('memory_result_cursor_unavailable',409);
      afterSequence=cursor[0].through_sequence;
      cursorGuards.push({condition:`(SELECT json_group_array(through_sequence) FROM (${cursorQuery}))=?`,bindings:[...cursorBindings,JSON.stringify([afterSequence])]});
    }
    const query=`SELECT j.job_id,g.purpose,? AS scope_key,r.expires_at FROM memory_derivation_results r
      JOIN memory_derivation_jobs j ON j.job_id=r.job_id JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
      WHERE g.enrollment_id=? AND g.actor_user_id=? AND g.revoked_at IS NULL AND g.expires_at>?
        AND r.state='active' AND r.expires_at>?${purpose?' AND g.purpose=?':''} AND (j.through_sequence<? OR j.through_sequence=? AND j.job_id>?)
        ${latest?`AND NOT EXISTS(SELECT 1 FROM memory_derivation_results newer
          JOIN memory_derivation_jobs newer_job ON newer_job.job_id=newer.job_id
          JOIN memory_derivation_grants newer_grant ON newer_grant.consent_id=newer_job.consent_id
          WHERE newer_grant.enrollment_id=g.enrollment_id AND newer_grant.actor_user_id=g.actor_user_id
            AND newer_grant.purpose=g.purpose AND newer_grant.revoked_at IS NULL
            AND newer_grant.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
            AND (newer_job.through_sequence>j.through_sequence OR newer_job.through_sequence=j.through_sequence AND newer_job.job_id<j.job_id))`:''}
      ORDER BY j.through_sequence DESC,j.job_id LIMIT 9`;
    const bindings=[scopeKey,selected.parent.enrollment_id,actor.userId,now,now,...(purpose?[purpose]:[]),afterSequence,afterSequence,after],found=await rows(env,query,bindings);
    const columns=['job_id','purpose','scope_key','expires_at'];
    if(found.length>9||found.some(row=>!derivationExact(row,columns)))return deny('memory_result_unavailable',503);
    const guard:MemorySqlGuard={condition:`(SELECT json_group_array(json_array(${columns.join(',')})) FROM (${query}))=?`,bindings:[...bindings,JSON.stringify(found.map(row=>columns.map(key=>row[key])))]};
    // Reuse the same indexed aggregate and exact final replay. Opt-in diagnostics
    // do not hydrate source prose, add per-job requests, or widen old clients.
    const pending='j.job_id IS NOT NULL AND done.job_id IS NULL';
    const liveLease="j.state='leased' AND j.lease_expires_at>clock.checked_at";
    const latency="CAST(strftime('%s',done.completed_at) AS INTEGER)-CAST(strftime('%s',j.created_at) AS INTEGER)";
    const healthSql=diagnostics?`,json_object('version','${MEMORY_DERIVATION_HEALTH}',
      'ready',SUM(CASE WHEN ${pending} AND j.expires_at>clock.checked_at AND j.state='waiting' AND j.not_before<=clock.checked_at THEN 1 ELSE 0 END),
      'deferred',SUM(CASE WHEN ${pending} AND j.expires_at>clock.checked_at AND j.state='waiting' AND j.not_before>clock.checked_at THEN 1 ELSE 0 END),
      'leased',SUM(CASE WHEN ${pending} AND j.expires_at>clock.checked_at AND ${liveLease} THEN 1 ELSE 0 END),
      'recovery',SUM(CASE WHEN ${pending} AND j.expires_at>clock.checked_at AND j.state='leased' AND j.lease_expires_at<=clock.checked_at THEN 1 ELSE 0 END),
      'expired',SUM(CASE WHEN ${pending} AND j.expires_at<=clock.checked_at THEN 1 ELSE 0 END),
      'oldestPendingAt',MIN(CASE WHEN ${pending} THEN j.created_at END),
      'lastCompletedAt',MAX(done.completed_at),
      'lastRetainedAt',MAX(CASE WHEN r.state='active' AND r.expires_at>clock.checked_at THEN r.published_at END),
      'completionLatencySeconds',json_object('samples',COUNT(done.job_id),'total',COALESCE(SUM(${latency}),0),'maximum',COALESCE(MAX(${latency}),0))) AS health_json`:'';
    const progressQuery=`SELECT g.purpose,
      SUM(CASE WHEN j.job_id IS NOT NULL AND done.job_id IS NULL THEN 1 ELSE 0 END) AS pending,
      COUNT(done.job_id) AS completed,
      SUM(CASE WHEN r.state='active' AND r.expires_at>? THEN 1 ELSE 0 END) AS retained,
      SUM(CASE WHEN f.dispatch_token IS NOT NULL AND usage.finance_id IS NULL THEN 1 ELSE 0 END) AS uncertain,
      ${schema.producersPresent?`MIN(COALESCE((SELECT registered_through_sequence FROM memory_derivation_cursors WHERE consent_id=g.consent_id),g.source_after_sequence),
        COALESCE((SELECT registered_through_sequence FROM memory_derivation_producer_cursors WHERE consent_id=g.consent_id),g.source_after_sequence))`:
        '(SELECT registered_through_sequence FROM memory_derivation_cursors WHERE consent_id=g.consent_id)'} AS registeredThrough,
      ${schema.producersPresent?`MIN(COALESCE((SELECT through_sequence FROM memory_derivation_completion_cursors WHERE consent_id=g.consent_id),g.source_after_sequence),
        COALESCE((SELECT completed_through_sequence FROM memory_derivation_producer_cursors WHERE consent_id=g.consent_id),g.source_after_sequence))`:
        '(SELECT through_sequence FROM memory_derivation_completion_cursors WHERE consent_id=g.consent_id)'} AS completedThrough
      ${schema.producersPresent?`,json_array(
        json_object('producer','creator','registeredThrough',COALESCE((SELECT registered_through_sequence FROM memory_derivation_cursors WHERE consent_id=g.consent_id),g.source_after_sequence),
          'completedThrough',COALESCE((SELECT through_sequence FROM memory_derivation_completion_cursors WHERE consent_id=g.consent_id),g.source_after_sequence)),
        json_object('producer','chat-studio','registeredThrough',COALESCE((SELECT registered_through_sequence FROM memory_derivation_producer_cursors WHERE consent_id=g.consent_id),g.source_after_sequence),
          'completedThrough',COALESCE((SELECT completed_through_sequence FROM memory_derivation_producer_cursors WHERE consent_id=g.consent_id),g.source_after_sequence))) AS producers_json`:''}
      ${healthSql}
      FROM memory_derivation_grants g LEFT JOIN memory_derivation_jobs j ON j.consent_id=g.consent_id
      LEFT JOIN memory_derivation_completions done ON done.job_id=j.job_id LEFT JOIN memory_derivation_results r ON r.job_id=j.job_id
      LEFT JOIN memory_derivation_job_finance link ON link.job_id=j.job_id LEFT JOIN memory_derivation_finance f ON f.finance_id=link.finance_id
      LEFT JOIN memory_derivation_usage usage ON usage.finance_id=f.finance_id
      ${diagnostics?'CROSS JOIN (SELECT ? AS checked_at) clock':''}
      WHERE g.enrollment_id=? AND g.actor_user_id=? AND g.revoked_at IS NULL AND g.expires_at>?${purpose?' AND g.purpose=?':''} GROUP BY g.consent_id ORDER BY g.purpose LIMIT 4`;
    const progressBindings=[now,...(diagnostics?[now]:[]),selected.parent.enrollment_id,actor.userId,now,...(purpose?[purpose]:[])],progressColumns=['purpose','pending','completed','retained','uncertain','registeredThrough','completedThrough',...(schema.producersPresent?['producers_json']:[]),...(diagnostics?['health_json']:[])];
    const progress=schema.completionPresent?await rows(env,progressQuery,progressBindings):[];
    if(progress.length>3||progress.some(row=>!derivationExact(row,progressColumns)))return deny('memory_result_status_unavailable',503);
    const presentedProgress=progress.map(({producers_json,health_json,...row})=>({...row,
      ...(schema.producersPresent?{producers:JSON.parse(String(producers_json))}:{}),
      ...(diagnostics?{health:parseMemoryDerivationHealth(JSON.parse(String(health_json)),{pending:Number(row.pending),completed:Number(row.completed),retained:Number(row.retained)},now)}:{})}));
    const guards=[schema.guard,identity,...selected.guards,...cursorGuards,guard,clock(new Date(started+60000).toISOString()),...(schema.completionPresent?[{condition:`(SELECT json_group_array(json_array(${progressColumns.join(',')})) FROM (${progressQuery}))=?`,bindings:[...progressBindings,JSON.stringify(progress.map(row=>progressColumns.map(key=>row[key])))]}]:[])];
    const checked=await db.batch(guards.map(value=>derivationAssertion(env,value)));
    if(env.DB!==db||settingsKey(env)!==configuration||elapsed.elapsed({wall:Date.now(),monotonic:performance.now()})>=60000||found.some(row=>String(row.expires_at)<=new Date().toISOString())
      ||!derivationResults(checked,guards.length)||!checked.every(derivationVerified))return deny('memory_result_unavailable',503);
    const parent=selected.parent;
    return reply({scope:{projectId,documentId,custody:parent.organization_id===null?{kind:'personal'}:{kind:'organization',organizationId:parent.organization_id,projectAccessId:parent.project_access_id,ownerUserId:parent.owner_user_id}},
      enrollmentId:parent.enrollment_id,enrollmentRevision:parent.revision,
      checkedAt:now,progress:presentedProgress,...(diagnostics?{diagnostics:MEMORY_DERIVATION_HEALTH}:{}),...(purpose?{purpose}:{}),...(latest?{latest:true}:{}),results:found.slice(0,8).map(row=>({jobId:row.job_id,purpose:row.purpose,scopeKey:row.scope_key,expiresAt:row.expires_at})),next:found.length>8?found[7]!.job_id:null});
  }catch{return deny('memory_result_unavailable',503);}
}
