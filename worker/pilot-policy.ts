import { assertOutputAdmissionBudget, readOutputAdmissionValue, type OutputAdmissionReads } from "./output-admission-reads.ts";
import { intEnv, activeProjectBillingSql } from "./pilot-policy-primitives.ts";
import { DEFAULT_EVIDENCE_RETENTION_DAYS } from "./private-content-storage.ts";
export { DURABLE_WORK_RETENTION_END, DEFAULT_EVIDENCE_RETENTION_DAYS, privateContentRetentionClass, preparePrivateContent, storePrivateContent } from "./private-content-storage.ts";
import { outputSchemaIsReady } from "./output-schema-state.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import { appendAuditEvent, ensureSchema, EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, uuidV7, type WorkerEnv, type WorkerExecutionContext } from "./runtime.ts";
import { MICRO_USD_PER_USD } from "./replay-cost.ts";
import { interruptedDocumentJobUsage, recordedDocumentPlannerUsage } from "./document-job-reservations.ts";
import { providerSubmissions, hasUnsettledProviderSubmission, unsettledProviderSubmissionSql } from "../src/model/provider-submission.ts";
import { readCanvasGovernance } from "./canvas-governance-policy.ts";
import { DEFAULT_REFERENCE_VIDEO_MODEL, DEFAULT_VIDEO_MODEL, VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { AUDIO_ADAPTER_CONTRACTS, audioAdapterContractForModel } from "../src/model/audio.ts";
import { PLATFORM_PRINCIPAL_WITH_ACCESS_SQL, PRINCIPAL_WITH_ACCESS_SQL, principalAccessFromRow, type PrincipalAccess } from "./access-policy.ts";
import type { FormaCapability } from "../src/platform/capabilities.ts";
import { APPLICATIONS, applicationDefinition, applicationIdFromRoute, authorizedApplicationHome, routeRequiredCapabilities, type ApplicationId } from "../src/platform/applications.ts";
import { ASSISTANT_MODELS, assistantModelCostMicrousd, type AssistantModel } from "../src/model/assistant-model-policy.ts";
import { readProjectRequestContext } from "./project-access.ts";
import { readExistingPrincipalRequest, completePrincipalRequest, identityFromRequest, decodedCookieValue, roleRank,
  hasCapability, requireConsent } from "./principal-request-core.ts";
export { hasCapability, requireConsent };
import { configuredPilotAdmissionGuard } from "./intake-authority.ts";
export { configuredPilotAdmissionGuard };

import { POLICY_VERSION } from "./policy-version.ts";
export { POLICY_VERSION };
export type PilotRole = "admin" | "creator" | "agent" | "viewer";
export type ProjectExecutionScope={organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string;actorUserId:string};
export type PilotUser = { userId: string; email: string; displayName: string; role: PilotRole; consentVersion: string | null; consentedAt: string | null; streamId: string; access: PrincipalAccess; fictional?: boolean; billingUserId?: string;projectExecution?:ProjectExecutionScope; authorizationSnapshot?:{updatedAt:string;rawEpoch:string;grants:string;organizations:string;projects:string;identityPolicies:string;canvasRequirements:number} };
export type PilotImpersonation = { impersonationId:string; personaId:string; replaySessionId:string; actor:PilotUser; fictionalUser:PilotUser; startedAt:string; expiresAt:string };

const moneyEnv = (value: string | undefined, fallbackUsd: number) => { const parsed = Number(value); return Math.round((Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackUsd) * MICRO_USD_PER_USD); };

/** Free creative guidance is available only to a live named participant in the exact active organization. */
export async function assistantPilotEntitled(env:WorkerEnv,userId:string,organizationId:string){
  if(!userId||!organizationId)return false;
  const now=new Date().toISOString();
  const admitted=await env.DB.prepare(`SELECT 1 AS authorized FROM pilot_cohorts cohort
    JOIN organizations organization ON organization.organization_id=cohort.organization_id AND organization.status='active'
    JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
    JOIN organization_memberships member ON member.organization_id=cohort.organization_id AND member.user_id=participant.user_id
      AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
    JOIN users identity ON identity.user_id=participant.user_id AND identity.consent_version=?
    WHERE cohort.organization_id=? AND cohort.status='active' AND cohort.starts_at<=? AND cohort.ends_at>=?
      AND participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL AND participant.role!='reviewer' LIMIT 1`)
    .bind(POLICY_VERSION,organizationId,now,now,userId).first();
  return Boolean(admitted);
}


const impersonationCookie=(request:Request,value:string,maxAge:number)=>`forma_impersonation=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol==="https:"?"; Secure":""}`;



export async function requireUser(request: Request, env: WorkerEnv, minimum: PilotRole = "viewer", options:{account?:"effective"|"principal"}={}) {
  await ensureSchema(env);
  const current = await readExistingPrincipalRequest(request, env, minimum, options);
  if (!("kind" in current)) return current;
  const { identity, admittedParticipant } = current;
  let { row } = current;
  if (!row) {
    const now = new Date().toISOString();
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
    const adminEmails = new Set((env.FORMA_ADMIN_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
    const hostname=new URL(request.url).hostname;
    const localBootstrap=(hostname==="localhost"||hostname==="127.0.0.1")&&adminEmails.size===0&&Number(count?.count??0)===0;
    const initialRole: PilotRole = adminEmails.has(identity.email)||localBootstrap ? "admin" : "creator";
    if(admittedParticipant){
      const pilotPeriod=`pilot:${admittedParticipant.cohort_id}`;
      const results=await env.DB.batch([
        env.DB.prepare("UPDATE pilot_participants SET user_id=? WHERE participant_id=? AND cohort_id=? AND email_normalized=? AND status='active' AND revoked_at IS NULL AND (user_id IS NULL OR user_id=?)")
          .bind(identity.userId,admittedParticipant.participant_id,admittedParticipant.cohort_id,identity.email,identity.userId),
        env.DB.prepare(`INSERT OR IGNORE INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at)
          SELECT ?,?,?,?,NULL,NULL,?,? WHERE EXISTS(SELECT 1 FROM pilot_participants WHERE participant_id=? AND user_id=? AND status='active' AND revoked_at IS NULL)`)
          .bind(identity.userId,identity.email,identity.displayName,initialRole,now,now,admittedParticipant.participant_id,identity.userId),
        pilotCostCounterStatement(env,"pilot_user",identity.userId,pilotPeriod,admittedParticipant.participant_cap_microusd,now,
          {sql:"EXISTS(SELECT 1 FROM pilot_participants WHERE participant_id=? AND user_id=? AND status='active')",bindings:[admittedParticipant.participant_id,identity.userId]}),
      ]);
      if(Number(results[1]?.meta.changes??0)!==1)return{response:Response.json({error:"pilot_participant_required"},{status:403}),user:null};
    }else{
      await env.DB.prepare("INSERT OR IGNORE INTO users (user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES (?,?,?,?,NULL,NULL,?,?)").bind(identity.userId, identity.email, identity.displayName, initialRole, now, now).run();
    }
    row = await env.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(identity.userId).first<Record<string, unknown>>();
  } else {
    if (row.email !== identity.email || row.display_name !== identity.displayName) {
      await env.DB.prepare("UPDATE users SET email=?, display_name=?, updated_at=? WHERE user_id=?").bind(identity.email, identity.displayName, new Date().toISOString(), identity.userId).run();
      row = await env.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(identity.userId).first<Record<string, unknown>>();
    }
  }
  if(admittedParticipant&&!admittedParticipant.user_id){
    const now=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE pilot_participants SET user_id=? WHERE participant_id=? AND cohort_id=? AND status='active' AND revoked_at IS NULL AND (user_id IS NULL OR user_id=?)")
        .bind(identity.userId,admittedParticipant.participant_id,admittedParticipant.cohort_id,identity.userId),
      pilotCostCounterStatement(env,"pilot_user",identity.userId,`pilot:${admittedParticipant.cohort_id}`,admittedParticipant.participant_cap_microusd,now),
    ]);
  }
  return completePrincipalRequest(request, env, identity, row, minimum, options);
}

/** Existing-account administrative reads must not bootstrap schema, identity, or counters. */
export async function requireExistingHoldAdministrator(request: Request, env: WorkerEnv) {
  const deny = (error: string, status = 403) => ({user: null, response: Response.json({error}, {status, headers:{"cache-control":"private, no-store"}})});
  if (/(?:^|;\s*)(?:forma_impersonation|forma_project_context)=/.test(request.headers.get("cookie") ?? "")) return deny("return_to_principal_before_internal_access",409);
  const identity = identityFromRequest(request); if (!identity) return deny("authentication_required",401);
  const row = await env.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(identity.userId).first<Record<string,unknown>>();
  if (!row || row.email !== identity.email || row.role !== "admin" || row.consent_version !== POLICY_VERSION) return deny("hold_principal_administrator_required");
  const admission = configuredPilotAdmissionGuard(env, {userId:identity.userId,email:identity.email});
  if (!await env.DB.prepare("SELECT 1 AS allowed WHERE " + admission.sql).bind(...admission.bindings).first()) return deny("pilot_participant_required");
  const access = await principalAccessFromRow(row,"admin",{email:identity.email,source:identity.source,subject:identity.userId});
  if (access.identityPolicyDeniedCustody) return deny("organization_identity_policy_required");
  const user: PilotUser = {userId:identity.userId,email:identity.email,displayName:String(row.display_name),role:"admin",consentVersion:POLICY_VERSION,
    consentedAt:row.consented_at?String(row.consented_at):null,streamId:`creative:${identity.userId}`,access,
    authorizationSnapshot:{updatedAt:String(row.updated_at??""),rawEpoch:String(row.permission_epoch??""),grants:String(row.grants_json??"[]"),
      organizations:String(row.organizations_json??"[]"),projects:String(row.projects_json??"[]"),identityPolicies:String(row.identity_policies_json??"[]"),canvasRequirements:Number(row.approved_canvas_requirements??0)}};
  return {user,response:null};
}


/** Evaluate the real principal and current accepted membership before any protected response. */
export async function requireCapability(
  request: Request,
  env: WorkerEnv,
  required: FormaCapability | readonly FormaCapability[],
  options: { organizationId?: string | null; projectAccessId?: string | null } = {},
) {
  const authorization = await requireUser(request, env, "viewer", { account: "principal" });
  if (authorization.response || !authorization.user) return authorization;
  const capabilities = Array.isArray(required) ? required : [required];
  if (!capabilities.some((capability) => hasCapability(authorization.user!, capability, options))) {
    return { ...authorization, user: null, response: Response.json({ error: "access_denied" }, { status: 403 }) };
  }
  return authorization;
}


export type PlatformAssistantPrincipal = {
  userId: string;
  email: string;
  role: PilotRole;
  consentVersion: string | null;
  updatedAt: string;
  access: PrincipalAccess;
  authorizationSnapshot: {
    rawEpoch: string;
    grants: string;
    organizations: string;
    projects: string;
    identityPolicies: string;
    canvasRequirements: number;
  };
};

/** Internal assistant identity retains normal identity policy without hydrating creator events or project names. */
export async function requirePlatformAssistantPrincipal(request: Request, env: WorkerEnv): Promise<{
  principal: PlatformAssistantPrincipal | null;
  response: Response | null;
}> {
  await ensureSchema(env);
  const identity = identityFromRequest(request);
  if (!identity) return { principal: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) };
  if (decodedCookieValue(request, "forma_impersonation")) {
    return { principal: null, response: Response.json({ error: "return_to_principal_before_internal_access" }, { status: 409 }) };
  }
  const restrictedCohort = env.FORMA_PILOT_COHORT_ID?.trim() ?? "";
  if (restrictedCohort) {
    const breakglass = new Set((env.FORMA_ADMIN_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
    if (!breakglass.has(identity.email)) {
      const now = new Date().toISOString();
      const admitted = await env.DB.prepare(`SELECT 1 AS admitted FROM pilot_cohorts cohort
        JOIN organizations organization ON organization.organization_id=cohort.organization_id AND organization.status='active'
        JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
        WHERE cohort.organization_id=(SELECT selected.organization_id FROM pilot_cohorts selected WHERE selected.cohort_id=?)
          AND cohort.status IN('active','paused') AND cohort.starts_at<=? AND cohort.ends_at>?
          AND participant.user_id=? AND participant.email_normalized=? AND participant.status='active' AND participant.revoked_at IS NULL LIMIT 1`)
        .bind(restrictedCohort, now, now, identity.userId, identity.email).first();
      if (!admitted) return { principal: null, response: Response.json({ error: "pilot_participant_required" }, { status: 403 }) };
    }
  }
  const row = await env.DB.prepare(PLATFORM_PRINCIPAL_WITH_ACCESS_SQL).bind(identity.userId).first<Record<string, unknown>>();
  if (!row) return { principal: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) };
  if (row.email !== identity.email) return { principal: null, response: Response.json({ error: "identity_confirmation_required" }, { status: 403 }) };
  const role = String(row.role) as PilotRole;
  if (!Object.hasOwn(roleRank, role)) return { principal: null, response: Response.json({ error: "invalid_account_role" }, { status: 403 }) };
  const access = await principalAccessFromRow(row, role, { email: identity.email, source: identity.source, subject: identity.userId });
  if (access.identityPolicyDeniedCustody) return { principal: null, response: Response.json({ error: "organization_identity_policy_required" }, { status: 403 }) };
  return { principal: { userId: String(row.user_id), email: identity.email, role,
    consentVersion: row.consent_version ? String(row.consent_version) : null, updatedAt: String(row.updated_at ?? ""), access,
    authorizationSnapshot: { rawEpoch: String(row.permission_epoch ?? ""), grants: String(row.grants_json ?? "[]"),
      organizations: String(row.organizations_json ?? "[]"), projects: String(row.projects_json ?? "[]"),
      identityPolicies: String(row.identity_policies_json ?? "[]"), canvasRequirements: Number(row.approved_canvas_requirements ?? 0) } }, response: null };
}

const period = () => new Date().toISOString().slice(0, 7);
const budgetLimits = (env: WorkerEnv) => {
  const user = Math.max(10_000_000, intEnv(env.FORMA_USER_TOKEN_LIMIT, 10_000_000));
  return { user, workspace: Math.max(user * 10, intEnv(env.FORMA_WORKSPACE_TOKEN_LIMIT, 100_000_000)) };
};
const BUDGET_RECONCILIATION_AGE_MS = 5 * 60_000;
type BudgetReservationRow = { output_bound?:number;output_uncertain?:number; reservation_id: string; owner_id: string; stream_id: string; correlation_id: string; operation: string; period: string; reserved_tokens: number; used_tokens: number; status: string; settlement_reason: string | null; created_at: string; settled_at: string | null; updated_at: string };
export type ProjectBudgetScope={organizationId:string;projectAccessId:string;actorUserId:string};
/** Internal SQL capability; never accept this guard from request JSON. */
export type BudgetReservationGuard={sql:string;bindings:Array<string|number|null>};
async function budgetReservationAdmitted(env:WorkerEnv,guard:BudgetReservationGuard|undefined){return !guard||Boolean(await env.DB.prepare(`SELECT 1 AS admitted WHERE ${guard.sql}`).bind(...guard.bindings).first());}
/** Server-only SQL proofs. The caller must supply original captured assertions,
 * never wire-authored SQL. Missing schema is an unavailable guarded boundary,
 * not permission to initialize output schema from a read-only preparation path. */
async function budgetReservationAssertionStatements(env:WorkerEnv,assertions:readonly OutputSqlAssertion[]=[]){
  if(!assertions.length)return[];
  // Capture before the lazy import yields; callers cannot swap source bindings.
  const captured=assertions.map(assertion=>({...assertion,bindings:[...(assertion.bindings??[])]}));
  if(!outputSchemaIsReady(env.DB))throw new Error("output_budget_assertion_schema_unavailable");
  const {outputAssertionStatements}=await import("./output-command-core.ts");
  return captured.flatMap(assertion=>outputAssertionStatements(env,assertion));
}
type BudgetReservationContext = { batchCounterInitialization?:boolean;outputAdmissionReads?:OutputAdmissionReads;reservationGuard?:BudgetReservationGuard;reservationAssertions?:readonly OutputSqlAssertion[]; streamId?: string; correlationId?: string; operation?: string; period?: string; createdAt?: string;reservationId?:string;projectScope?:ProjectBudgetScope };

async function projectBudgetPolicy(env:WorkerEnv,userId:string,scope:ProjectBudgetScope){
  if(!scope.organizationId||!scope.projectAccessId||scope.actorUserId!==userId)return null;
  return env.DB.prepare(`SELECT token_limit,microusd_limit FROM budget_scope_policies
    WHERE scope='workspace' AND scope_id=? AND organization_id=? AND ${activeProjectBillingSql}`)
    .bind(scope.organizationId,scope.organizationId,userId,userId,scope.projectAccessId,scope.organizationId,userId)
    .first<{token_limit:number;microusd_limit:number}>();
}

/** Avoid conflict INSERTs against retained financial targets. A real missing
 * row is inserted once; limit-only updates never replace balances or identity.
 * Callers commit both statements in their existing transaction. */
export function pilotCostCounterStatement(env: WorkerEnv, scope: "pilot_org" | "pilot_user", scopeId: string,
  pilotPeriod: string, limit: number, now: string, admission?: BudgetReservationGuard) {
  return env.DB.prepare(`INSERT INTO cost_budget_counters(scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at)
    SELECT ?,?,?,0,0,?,? WHERE NOT EXISTS(SELECT 1 FROM cost_budget_counters WHERE scope=? AND scope_id=? AND period=?)${admission?` AND (${admission.sql})`:""}`)
    .bind(scope,scopeId,pilotPeriod,limit,now,scope,scopeId,pilotPeriod,...(admission?.bindings??[]));
}
function budgetCounterRowStatements(env: WorkerEnv, currency: "tokens" | "microusd", scope: "user" | "workspace", scopeId: string, limit: number, reservationPeriod: string) {
  const table=currency==="tokens"?"budget_counters":"cost_budget_counters",now=new Date().toISOString();
  return [env.DB.prepare(`INSERT INTO ${table}(scope,scope_id,period,used_${currency},reserved_${currency},hard_limit_${currency},updated_at)
    SELECT ?,?,?,0,0,?,? WHERE NOT EXISTS(SELECT 1 FROM ${table} WHERE scope=? AND scope_id=? AND period=?)`)
    .bind(scope,scopeId,reservationPeriod,limit,now,scope,scopeId,reservationPeriod),
  env.DB.prepare(`UPDATE ${table} SET hard_limit_${currency}=?,updated_at=? WHERE scope=? AND scope_id=? AND period=? AND hard_limit_${currency} IS NOT ?`)
    .bind(limit,now,scope,scopeId,reservationPeriod,limit)];
}
function budgetRowStatements(env: WorkerEnv, scope: "user" | "workspace", scopeId: string, limit: number,reservationPeriod=period()) {
  return budgetCounterRowStatements(env,"tokens",scope,scopeId,limit,reservationPeriod);
}

async function ensureBudgetRow(env: WorkerEnv, scope: "user" | "workspace", scopeId: string, limit: number,reservationPeriod=period()) {
  await env.DB.batch(budgetRowStatements(env,scope,scopeId,limit,reservationPeriod));
}

export async function readBudgets(env: WorkerEnv, userId: string, options: { initialize?: boolean } = {}) {
  const initialize = options.initialize !== false;
  const limits = budgetLimits(env);
  const currentPeriod = period();
  const select = () => env.DB.prepare("SELECT scope,used_tokens,reserved_tokens,hard_limit_tokens FROM budget_counters WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma'))").bind(currentPeriod, userId);
  let rows = (await select().all<Record<string, unknown>>()).results;
  const userRow = rows.find((row) => row.scope === "user");
  const workspaceRow = rows.find((row) => row.scope === "workspace");
  if (initialize && (!userRow || !workspaceRow || Number(userRow.hard_limit_tokens) !== limits.user || Number(workspaceRow.hard_limit_tokens) !== limits.workspace)) {
    const upsert = (scope: "user" | "workspace", scopeId: string, limit: number) => budgetRowStatements(env,scope,scopeId,limit,currentPeriod);
    const result = await env.DB.batch<Record<string, unknown>>([
      ...upsert("user", userId, limits.user),
      ...upsert("workspace", "forma", limits.workspace),
      select(),
    ]);
    rows = result.at(-1)?.results ?? [];
  }
  // Preview the same effective limits the eventual reservation batch installs,
  // without initializing or changing counters during read-only preparation.
  const map = Object.fromEntries(rows.map((row) => [String(row.scope), { used: Number(row.used_tokens), reserved: Number(row.reserved_tokens), limit: !initialize ? (row.scope === "user" ? limits.user : limits.workspace) : Number(row.hard_limit_tokens) }]));
  return { period: currentPeriod, user: map.user ?? { used: 0, reserved: 0, limit: limits.user }, workspace: map.workspace ?? { used: 0, reserved: 0, limit: limits.workspace } };
}

/** Build the existing token reservation without admitting spend. Counter initialization
 * is metadata only. The caller must commit these statements together with its
 * authorization and assert the returned reservation inside that same transaction. */
export async function prepareBudgetReservation(env: WorkerEnv, userId: string, tokens: number, context: BudgetReservationContext = {}) {
  const reservationGuard=context.reservationGuard;
  const reservationChecks=context.reservationAssertions?.length?await budgetReservationAssertionStatements(env,context.reservationAssertions):[];
  const amount = Math.max(0, Math.floor(tokens)); const limits = budgetLimits(env); const reservationPeriod = context.period ?? period();
  const scope=context.projectScope;
  assertOutputAdmissionBudget(context.outputAdmissionReads,env,userId,reservationPeriod,scope);
  const policy=scope?await readOutputAdmissionValue(context.outputAdmissionReads,"project-budget-policy",()=>projectBudgetPolicy(env,userId,scope)):null;
  if(scope&&!policy)return{ok:false as const,scope:"workspace" as const};
  const counterInitialization:Array<ReturnType<WorkerEnv["DB"]["prepare"]>>=[];
  if(context.outputAdmissionReads&&!reservationChecks.length)await initializeOutputAdmissionCounters(env,userId,reservationPeriod,scope,policy,context.outputAdmissionReads);
  else if(context.batchCounterInitialization||reservationChecks.length){
    // Same metadata writes and live reservation guards, committed together.
    counterInitialization.push(...budgetRowStatements(env,"user",userId,limits.user,reservationPeriod),...budgetRowStatements(env,"workspace","forma",limits.workspace,reservationPeriod));
    if(scope&&policy)counterInitialization.push(...budgetRowStatements(env,"workspace",scope.organizationId,Number(policy.token_limit),reservationPeriod));
  }else {
    await ensureBudgetRow(env,"user",userId,limits.user,reservationPeriod);await ensureBudgetRow(env,"workspace","forma",limits.workspace,reservationPeriod);
    if(scope&&policy)await ensureBudgetRow(env,"workspace",scope.organizationId,Number(policy.token_limit),reservationPeriod);
  }
  const reservationId=context.reservationId??uuidV7();const now=context.createdAt??new Date().toISOString();
  const scopedPredicates=scope&&policy?` AND EXISTS(SELECT 1 FROM budget_counters WHERE scope='workspace' AND scope_id=? AND period=? AND used_tokens+reserved_tokens+?<=hard_limit_tokens)
    AND EXISTS(SELECT 1 FROM budget_scope_policies WHERE scope='workspace' AND scope_id=? AND organization_id=? AND token_limit=?) AND ${activeProjectBillingSql}`:"";
  const reservationStatement=env.DB.prepare(`INSERT OR IGNORE INTO budget_reservations (reservation_id,owner_id,stream_id,correlation_id,operation,period,reserved_tokens,used_tokens,status,settlement_reason,created_at,settled_at,updated_at)
      SELECT ?,?,?,?,?,?,?,0,'authorizing',NULL,?,NULL,?
      WHERE ?>0
      AND EXISTS (SELECT 1 FROM budget_counters WHERE scope='user' AND scope_id=? AND period=? AND used_tokens+reserved_tokens+?<=hard_limit_tokens)
      AND EXISTS (SELECT 1 FROM budget_counters WHERE scope='workspace' AND scope_id='forma' AND period=? AND used_tokens+reserved_tokens+?<=hard_limit_tokens)${scopedPredicates}${reservationGuard?` AND (${reservationGuard.sql})`:""}`)
    .bind(reservationId,userId,context.streamId??"",context.correlationId??"",context.operation??"provider-operation",reservationPeriod,amount,now,now,amount,userId,reservationPeriod,amount,reservationPeriod,amount,...(scope&&policy?[scope.organizationId,reservationPeriod,amount,scope.organizationId,scope.organizationId,Number(policy.token_limit),userId,userId,scope.projectAccessId,scope.organizationId,userId]:[]),...(reservationGuard?.bindings??[]));
  const reservationStatementIndex=reservationChecks.length+counterInitialization.length;
  const statements=[
    ...reservationChecks,...counterInitialization,reservationStatement,
    env.DB.prepare("UPDATE budget_counters SET reserved_tokens=reserved_tokens+?,updated_at=? WHERE scope='user' AND scope_id=? AND period=? AND EXISTS (SELECT 1 FROM budget_reservations WHERE reservation_id=? AND status='authorizing')").bind(amount,now,userId,reservationPeriod,reservationId),
    env.DB.prepare("UPDATE budget_counters SET reserved_tokens=reserved_tokens+?,updated_at=? WHERE scope='workspace' AND scope_id='forma' AND period=? AND EXISTS (SELECT 1 FROM budget_reservations WHERE reservation_id=? AND status='authorizing')").bind(amount,now,reservationPeriod,reservationId),
  ];
  if(scope){
    statements.push(env.DB.prepare("UPDATE budget_counters SET reserved_tokens=reserved_tokens+?,updated_at=? WHERE scope='workspace' AND scope_id=? AND period=? AND EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=? AND status='authorizing')").bind(amount,now,scope.organizationId,reservationPeriod,reservationId));
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO project_budget_reservation_scopes(reservation_kind,reservation_id,organization_id,project_access_id,actor_user_id,workspace_scope_id,created_at) SELECT 'tokens',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id=? AND status='authorizing')")
      .bind(reservationId,scope.organizationId,scope.projectAccessId,userId,scope.organizationId,now,reservationId,userId));
  }
  statements.push(env.DB.prepare("UPDATE budget_reservations SET status='active',updated_at=? WHERE reservation_id=? AND owner_id=? AND status='authorizing'").bind(now,reservationId,userId));
  return { ok: true as const, statements, reservationStatementIndex, reservationId, reservedTokens: amount, period: reservationPeriod };
}

export async function reserveBudget(env: WorkerEnv, userId: string, tokens: number, context: BudgetReservationContext = {}) {
  const reservationGuard=context.reservationGuard;
  const prepared = await prepareBudgetReservation(env,userId,tokens,context);
  if(!prepared.ok)return prepared;
  const {statements,reservationId,reservedTokens:amount,period:reservationPeriod}=prepared;
  const scope=context.projectScope;
  const results=await env.DB.batch(statements);
  if (Number(results[prepared.reservationStatementIndex]?.meta.changes ?? 0) !== 1) {
    if(!await budgetReservationAdmitted(env,reservationGuard))return{ok:false as const,scope:"authorization" as const};
    if(context.reservationId){
      const existing=await budgetReservation(env,userId,reservationId);
      if(existing?.status==="active"&&existing.reserved_tokens===amount&&existing.period===reservationPeriod&&existing.stream_id===(context.streamId??"")&&existing.correlation_id===(context.correlationId??"")&&existing.operation===(context.operation??"provider-operation")){
        if(!scope)return{ok:true as const,reservationId,reservedTokens:amount,period:reservationPeriod,reused:true as const};
        const bound=await env.DB.prepare("SELECT organization_id,project_access_id,actor_user_id FROM project_budget_reservation_scopes WHERE reservation_kind='tokens' AND reservation_id=?").bind(reservationId).first<Record<string,unknown>>();
        if(bound?.organization_id===scope.organizationId&&bound.project_access_id===scope.projectAccessId&&bound.actor_user_id===userId)return{ok:true as const,reservationId,reservedTokens:amount,period:reservationPeriod,reused:true as const};
      }
    }
    const budgets = await readBudgets(env, userId); const userRemaining = budgets.user.limit - budgets.user.used - budgets.user.reserved;
    return { ok: false as const, scope: userRemaining < amount ? "user" as const : "workspace" as const };
  }
  return { ok: true as const, reservationId, reservedTokens: amount, period: reservationPeriod };
}

async function budgetReservation(env: WorkerEnv, userId: string, reservationId: string) {
  return env.DB.prepare(`SELECT *${outputReservationColumns(env,"budget_reservations")} FROM budget_reservations WHERE reservation_id=? AND owner_id=?`).bind(reservationId,userId).first<BudgetReservationRow>();
}

async function adoptLegacyBudgetReservation(env: WorkerEnv, userId: string, reservationId: string, reservedTokens: number, context: BudgetReservationContext) {
  const now = new Date().toISOString(); const createdAt = context.createdAt ?? now;
  // BEFORE INSERT guards run even for INSERT OR IGNORE. Existing reservations,
  // including reviewed holds, must never be proposed for adoption again.
  await env.DB.prepare("INSERT OR IGNORE INTO budget_reservations (reservation_id,owner_id,stream_id,correlation_id,operation,period,reserved_tokens,used_tokens,status,settlement_reason,created_at,settled_at,updated_at) SELECT ?,?,?,?,?,?,?,0,'active',NULL,?,NULL,? WHERE NOT EXISTS (SELECT 1 FROM budget_reservations WHERE reservation_id=?)")
    .bind(reservationId,userId,context.streamId??"",context.correlationId??"",context.operation??"legacy-provider-operation",context.period??createdAt.slice(0,7),Math.max(0,Math.floor(reservedTokens)),createdAt,now,reservationId).run();
}

/** Correlated checks share the existing reservation read and settlement transaction. */
const outputReservationSql=(table:"budget_reservations"|"cost_budget_reservations",uncertain=false)=>`EXISTS(SELECT 1 FROM output_operation_slots slot
 JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
 ${uncertain?"JOIN output_provider_calls call_row ON call_row.scope_key=slot.scope_key AND call_row.slot_id=slot.slot_id":""}
 WHERE slot.${table==="budget_reservations"?"token":"cost"}_reservation_id=${table}.reservation_id AND grant_row.payer_user_id=${table}.owner_id
 ${uncertain?"AND call_row.status IN('pending','uncertain')":""})`;
const outputReservationColumns=(env:WorkerEnv,table:"budget_reservations"|"cost_budget_reservations")=>outputSchemaIsReady(env.DB)?`,${outputReservationSql(table)} AS output_bound,${outputReservationSql(table,true)} AS output_uncertain`:"";
const outputSettlementGuard=(env:WorkerEnv,table:"budget_reservations"|"cost_budget_reservations")=>outputSchemaIsReady(env.DB)?` AND NOT ${outputReservationSql(table,true)}`:"";

type TokenSettlementScope={organization_id:string;project_access_id:string;actor_user_id:string};
function tokenSettlementStatements(env:WorkerEnv,userId:string,reservationId:string,reservation:BudgetReservationRow,scope:TokenSettlementScope|null,used:number,reason:string){
  const actual = Math.max(0,Math.floor(used)); const now = new Date().toISOString(); const status = actual > 0 ? "settled" : "released";
  const guarded=outputSettlementGuard(env,"budget_reservations");
  const active = `EXISTS (SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id=? AND status='active'${guarded})`;
  const statements=[
    env.DB.prepare(`UPDATE budget_counters SET reserved_tokens=MAX(0,reserved_tokens-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_tokens=used_tokens+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='user' AND scope_id=? AND period=?`).bind(reservationId,userId,reservation.reserved_tokens,reservationId,userId,actual,now,userId,reservation.period),
    env.DB.prepare(`UPDATE budget_counters SET reserved_tokens=MAX(0,reserved_tokens-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_tokens=used_tokens+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='workspace' AND scope_id='forma' AND period=?`).bind(reservationId,userId,reservation.reserved_tokens,reservationId,userId,actual,now,reservation.period),
  ];
  if(scope)statements.push(env.DB.prepare(`UPDATE budget_counters SET reserved_tokens=MAX(0,reserved_tokens-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_tokens=used_tokens+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='workspace' AND scope_id=? AND period=?`).bind(reservationId,userId,reservation.reserved_tokens,reservationId,userId,actual,now,scope.organization_id,reservation.period));
  statements.push(env.DB.prepare(`UPDATE budget_reservations SET used_tokens=?,status=?,settlement_reason=?,settled_at=?,updated_at=? WHERE reservation_id=? AND owner_id=? AND status='active'${guarded}`).bind(actual,status,reason,now,now,reservationId,userId));
  return {statements,actual,status};
}

export async function settleBudget(env: WorkerEnv, userId: string, reservationId: string, used: number, reason = "provider_usage_recorded") {
  const reservation = await budgetReservation(env,userId,reservationId); if(!reservation)return{settled:false as const,reservedTokens:0,usedTokens:0,status:"missing"};
  if(reservation.output_uncertain)return{settled:false as const,reservedTokens:0,usedTokens:0,status:"uncertain"};
  const scope=await env.DB.prepare("SELECT organization_id,project_access_id,actor_user_id FROM project_budget_reservation_scopes WHERE reservation_kind='tokens' AND reservation_id=? AND actor_user_id=?")
    .bind(reservationId,userId).first<{organization_id:string;project_access_id:string;actor_user_id:string}>();
  const {statements,actual,status}=tokenSettlementStatements(env,userId,reservationId,reservation,scope,used,reason);
  const results=await env.DB.batch(statements);
  const settled=Number(results.at(-1)?.meta.changes??0)===1;
  return { settled, reservedTokens: reservation.reserved_tokens, usedTokens: settled ? actual : reservation.used_tokens, status: settled ? status : reservation.status };
}

export async function releaseBudget(env: WorkerEnv, userId: string, reservationId: string, options: BudgetReservationContext & { reservedTokens?: number; reason?: string } = {}) {
  if(!await budgetReservation(env,userId,reservationId)&&Number(options.reservedTokens)>0)await adoptLegacyBudgetReservation(env,userId,reservationId,Number(options.reservedTokens),options);
  return settleBudget(env,userId,reservationId,0,options.reason??"provider_operation_failed");
}

export async function releaseBudgetReservationsForCorrelation(env:WorkerEnv,user:PilotUser,correlationId:string,reason:string){
  const billingUserId=user.billingUserId??user.userId;
  const legacy=await env.DB.prepare(`SELECT occurred_at,json_extract(payload,'$.reservation_id') AS reservation_id,CAST(json_extract(payload,'$.reserved_tokens') AS INTEGER) AS reserved_tokens,COALESCE(json_extract(payload,'$.operation'),'provider-operation') AS operation,COALESCE(json_extract(payload,'$.period'),substr(occurred_at,1,7)) AS period FROM events reserved
    WHERE stream_id=? AND correlation_id=? AND type='BudgetReserved' AND NOT EXISTS (SELECT 1 FROM events terminal WHERE terminal.stream_id=reserved.stream_id AND terminal.type IN ('BudgetReleased','GenerationUsageRecorded') AND json_extract(terminal.payload,'$.reservation_id')=json_extract(reserved.payload,'$.reservation_id'))`).bind(user.streamId,correlationId).all<Record<string,unknown>>();
  for(const row of legacy.results){const reservationId=String(row.reservation_id??"");const tokens=Number(row.reserved_tokens??0);if(reservationId&&tokens>0)await adoptLegacyBudgetReservation(env,billingUserId,reservationId,tokens,{streamId:user.streamId,correlationId,operation:String(row.operation??"provider-operation"),period:String(row.period??period()),createdAt:String(row.occurred_at??new Date().toISOString())});}
  const active=await env.DB.prepare("SELECT * FROM budget_reservations WHERE owner_id=? AND stream_id=? AND correlation_id=? AND status='active' AND operation NOT LIKE 'memory-derivation:%' ORDER BY created_at").bind(billingUserId,user.streamId,correlationId).all<BudgetReservationRow>();const released=[] as Array<{id:string;tokens:number;operation:string}>;
  for(const reservation of active.results){const result=await releaseBudget(env,billingUserId,reservation.reservation_id,{reason});if(result.settled)released.push({id:reservation.reservation_id,tokens:result.reservedTokens,operation:reservation.operation});}
  return released;
}

type DocumentReservationJob = {
  job_id: string;
  owner_id: string;
  stream_id: string;
  document_id: string;
  kind: string;
  status: string;
  correlation_id: string;
  request_json: string;
  result_json: string | null;
};

const parseDocumentReservationJson = (value: string | null | undefined): Record<string, unknown> => {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

async function terminalReservationJob(
  env: WorkerEnv,
  user: PilotUser,
  correlationId: string,
  tokenReservationId = "",
  costReservationId = "",
) {
  const jobId = correlationId.split(":attempt:")[0] ?? "";
  return env.DB.prepare(`SELECT job_id,owner_id,stream_id,document_id,kind,status,correlation_id,request_json,result_json
    FROM document_jobs
    WHERE owner_id=? AND stream_id=? AND status IN ('completed','partial','failed','canceled')
      AND (correlation_id=? OR job_id=?
        OR (?<>'' AND json_extract(COALESCE(result_json,'{}'),'$.reservationId')=?)
        OR (?<>'' AND json_extract(COALESCE(result_json,'{}'),'$.costReservationId')=?))
    ORDER BY CASE WHEN (?<>'' AND json_extract(COALESCE(result_json,'{}'),'$.reservationId')=?)
      OR (?<>'' AND json_extract(COALESCE(result_json,'{}'),'$.costReservationId')=?) THEN 0 ELSE 1 END,updated_at DESC LIMIT 1`)
    .bind(user.userId,user.streamId,correlationId,jobId,tokenReservationId,tokenReservationId,costReservationId,costReservationId,tokenReservationId,tokenReservationId,costReservationId,costReservationId)
    .first<DocumentReservationJob>();
}

/** Settle a terminal document attempt from durable paid-work receipts rather than erasing incurred usage. */
export async function settleInterruptedDocumentJobReservations(
  env: WorkerEnv,
  user: PilotUser,
  job: Pick<DocumentReservationJob,"job_id"|"stream_id"|"document_id"|"correlation_id"|"request_json"|"result_json">&{kind?:string},
  options: { tokenReservationId?: string; costReservationId?: string; reason: string; automatic?: boolean } = { reason: "document_job_interrupted" },
) {
  const checkpoint=parseDocumentReservationJson(job.result_json);
  const request=parseDocumentReservationJson(job.request_json);
  const kind=job.kind;
  if(kind==="render_document"&&request.artifactKind==="slides"&&checkpoint.providerSubmissionProtocol===1&&providerSubmissions(checkpoint).length){
    // New per-call accounting must never fall through to aggregate repricing or
    // non-atomic release, including scheduler and historical cleanup callers.
    const terminal=await env.DB.prepare(`SELECT * FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=?
      AND request_json IS ? AND result_json IS ? AND status IN('failed','canceled','completed','partial')`)
      .bind(job.job_id,user.userId,job.stream_id,job.correlation_id,job.request_json,job.result_json).first<DocumentReservationJob>();
    if(!terminal||options.tokenReservationId&&options.tokenReservationId!==checkpoint.reservationId||options.costReservationId&&options.costReservationId!==checkpoint.costReservationId)
      return{settled:false,usedTokens:0,releasedTokens:0,usedMicrousd:0,releasedMicrousd:0};
    const settlement=await settleLegacyPresentationReservations(env,user,terminal,{reason:options.reason});
    return{settled:settlement.status==="known"&&(settlement.settled||settlement.auditRepaired),usedTokens:settlement.usedTokens,
      usedMicrousd:settlement.usedMicrousd,releasedTokens:settlement.releasedTokens,releasedMicrousd:settlement.releasedMicrousd};
  }
  const inconclusiveLegacyImage=(kind==="preview"||kind==="generate")&&checkpoint.providerSubmissionProtocol!==1;
  if(inconclusiveLegacyImage||hasUnsettledProviderSubmission(checkpoint)||request.artifactKind==="storyboard"&&(checkpoint.storyboardProviderSubmission==="pending"||checkpoint.storyboardProviderSubmission==="confirmed"))return{settled:false,usedTokens:0,releasedTokens:0,usedMicrousd:0,releasedMicrousd:0};
  const billingUserId=user.billingUserId??user.userId;
  const tokenReservationId=String(options.tokenReservationId??checkpoint.reservationId??"");
  const costReservationId=String(options.costReservationId??checkpoint.costReservationId??"");
  const token=tokenReservationId?await budgetReservation(env,billingUserId,tokenReservationId):null;
  const cost=costReservationId?await costBudgetReservation(env,billingUserId,costReservationId):null;
  const expectedOperation=kind==="preview"?"image-preview":kind==="generate"?"image-generation":`document-render:${String(request.artifactKind??"unknown")}`;
  const jobCorrelation=(correlation:string)=>correlation===job.correlation_id||correlation===job.job_id||correlation.startsWith(`${job.job_id}:attempt:`);
  const ownedToken=token&&token.stream_id===user.streamId&&token.operation===expectedOperation&&jobCorrelation(token.correlation_id)&&token.status==="active"?token:null;
  const scopedCost=cost&&cost.stream_id===user.streamId&&cost.operation===expectedOperation&&jobCorrelation(cost.correlation_id)&&(cost.status==="active"||cost.status==="executing")?cost:null;
  const ownedCost=scopedCost&&(!ownedToken||(scopedCost.correlation_id===ownedToken.correlation_id&&scopedCost.period===ownedToken.period))?scopedCost:null;
  if(!ownedToken&&!ownedCost)return{settled:false,usedTokens:0,releasedTokens:0,usedMicrousd:0,releasedMicrousd:0};

  const plannerResponseId=String(checkpoint.plannerResponseId??"");
  const plannerReceipts=plannerResponseId?await env.DB.prepare("SELECT payload FROM events WHERE stream_id=? AND type='GenerationUsageRecorded' AND json_extract(payload,'$.planner_response_id')=?")
    .bind(user.streamId,plannerResponseId).all<{payload:string}>():{results:[]};
  const expectedPlannerCost=interruptedDocumentJobUsage(checkpoint,request).plannerCostMicrousd;
  const recordedPlanner=recordedDocumentPlannerUsage(plannerReceipts.results.map((event)=>({payload:parseDocumentReservationJson(event.payload)})),plannerResponseId,expectedPlannerCost);
  const usage=interruptedDocumentJobUsage(checkpoint,request,{plannerTokensAlreadyRecorded:recordedPlanner.tokensRecorded,plannerCostAlreadyRecordedMicrousd:recordedPlanner.recordedCostMicrousd});
  const tokenSettlement=ownedToken?await settleBudget(env,billingUserId,ownedToken.reservation_id,usage.totalTokens,options.reason):null;
  const costSettlement=ownedCost?await settleCostBudget(env,billingUserId,ownedCost.reservation_id,ownedCost.output_bound?usage.totalCostMicrousd:Math.min(ownedCost.reserved_microusd,usage.totalCostMicrousd)):null;
  const tokenSettled=Boolean(tokenSettlement?.settled);
  const costSettled=Boolean(costSettlement?.settled);
  if(!tokenSettled&&!costSettled)return{settled:false,usedTokens:0,releasedTokens:0,usedMicrousd:0,releasedMicrousd:0};

  const correlationId=ownedToken?.correlation_id??ownedCost?.correlation_id??job.correlation_id;
  const operation=ownedToken?.operation??ownedCost?.operation??`document-render:${String(request.artifactKind??"unknown")}`;
  const usedTokens=tokenSettled?Number(tokenSettlement?.usedTokens??0):0;
  const usedMicrousd=costSettled?Number(costSettlement?.usedMicrousd??0):0;
  const recordedPlannerCost=costSettled?Math.min(usedMicrousd,usage.plannerCostMicrousd):0;
  const releasedTokens=tokenSettled?Math.max(0,Number(tokenSettlement?.reservedTokens??0)-usedTokens):0;
  const releasedMicrousd=costSettled?Math.max(0,Number(costSettlement?.reservedMicrousd??0)-usedMicrousd):0;

  if((tokenSettled&&usedTokens>0)||(costSettled&&usedMicrousd>0)){
    await appendAuditEvent(env,user.streamId,"worker:policy","GenerationUsageRecorded",{
      operation:`${operation}:interrupted`,job_id:job.job_id,document_id:job.document_id,
      reservation_id:ownedToken?.reservation_id,cost_reservation_id:ownedCost?.reservation_id??costReservationId,
      input_tokens:tokenSettled?usage.inputTokens:0,output_tokens:tokenSettled?usage.outputTokens:0,total_tokens:usedTokens,
      planner_tokens:tokenSettled?usage.plannerUsage.totalTokens:0,
      reserved_tokens:tokenSettlement?.reservedTokens??0,reserved_microusd:ownedCost?.reserved_microusd??0,
      cost_microusd:usedMicrousd,planner_cost_microusd:recordedPlannerCost,
      video_cost_microusd:usage.sceneCostMicrousd+usage.singleVideoCostMicrousd,
      ...(usage.singleAudioCostMicrousd?{audio_cost_microusd:usage.singleAudioCostMicrousd}:{}),
      planner_response_id:plannerResponseId||null,model_ids:[usage.plannerModel],
      reason:options.reason,automatic_reconciliation:Boolean(options.automatic),
    },correlationId);
  }
  await appendAuditEvent(env,user.streamId,"worker:policy","BudgetReleased",{
    operation,job_id:job.job_id,document_id:job.document_id,
    reservation_id:ownedToken?.reservation_id??tokenReservationId,cost_reservation_id:ownedCost?.reservation_id??costReservationId,
    reserved_tokens:tokenSettlement?.reservedTokens??0,used_tokens:usedTokens,released_tokens:releasedTokens,
    reserved_microusd:costSettlement?.reservedMicrousd??0,used_microusd:usedMicrousd,released_microusd:releasedMicrousd,
    reason:options.reason,automatic_reconciliation:Boolean(options.automatic),
  },correlationId);

  return{settled:true,usedTokens,releasedTokens,usedMicrousd,releasedMicrousd};
}

/** Reconcile only an exact terminal legacy slide attempt; never admit or repeat provider work. */
export async function settleLegacyPresentationReservations(
  env:WorkerEnv,user:PilotUser,job:DocumentReservationJob,
  options:{reason?:string;assertions?:import("./output-requirements-ledger.ts").OutputSqlAssertion[]}={},
){
  const stop=(reason:string,status:"uncertain"|"conflict"="uncertain")=>({status,reason,settled:false,auditRepaired:false,usedTokens:0,usedMicrousd:0,releasedTokens:0,releasedMicrousd:0});
  const checkpoint=parseDocumentReservationJson(job.result_json),request=parseDocumentReservationJson(job.request_json);
  const integer=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0;
  const receipt=parseDocumentReservationJson(JSON.stringify(checkpoint.generationReceipt??{}));
  if(job.owner_id!==user.userId||job.stream_id!==user.streamId||job.kind!=="render_document"||request.artifactKind!=="slides"
    ||!["failed","canceled","completed","partial"].includes(job.status))return stop("legacy_presentation_attempt_mismatch","conflict");
  await ensureSchema(env);
  if(await env.DB.prepare("SELECT 1 AS disposed FROM budget_hold_dispositions WHERE job_id=? AND operator_id=? AND correlation_id=?")
    .bind(job.job_id,user.userId,job.correlation_id).first())return stop("administrative_disposition_requires_review","conflict");
  if(checkpoint.providerSubmissionProtocol!==1||hasUnsettledProviderSubmission(checkpoint))return stop("legacy_presentation_unresolved_provider_call");
  const calls=providerSubmissions(checkpoint);
  if(!calls.length)return stop("legacy_presentation_per_call_evidence_missing");
  const currentClient=String(checkpoint.presentationProviderClientRequestId??"");
  if(checkpoint.presentationProviderSubmission==="pending"&&(!currentClient||!calls.some(call=>call.clientRequestId===currentClient&&["completed","rejected"].includes(call.status))))return stop("legacy_presentation_unresolved_provider_call");
  if(currentClient&&!calls.some(call=>call.clientRequestId===currentClient))return stop("legacy_presentation_current_client_mismatch");
  if(!currentClient&&(receipt.provider_request_status==="submission_unknown"||receipt.provider_submission_uncertain===true))return stop("legacy_presentation_current_client_missing");
  let inputTokens=0,outputTokens=0,usedTokens=0,usedMicrousd=0;
  const responseIds=new Set<string>();
  for(const call of calls){
    if(call.provider!=="openai"||call.operation!=="planning")return stop("legacy_presentation_call_identity_mismatch");
    if(call.status==="rejected"){
      if([call.costMicrousd,call.inputTokens,call.outputTokens,call.totalTokens].some(value=>value!==undefined&&value!==0))return stop("legacy_presentation_rejection_usage_conflict");
      continue;
    }
    if(call.status!=="completed"||!call.providerRequestId||responseIds.has(call.providerRequestId)
      ||![call.inputTokens,call.outputTokens,call.totalTokens,call.costMicrousd].every(integer)
      ||call.totalTokens!==Number(call.inputTokens)+Number(call.outputTokens))return stop("legacy_presentation_usage_unverified");
    responseIds.add(call.providerRequestId);
    inputTokens+=Number(call.inputTokens);outputTokens+=Number(call.outputTokens);usedTokens+=Number(call.totalTokens);usedMicrousd+=Number(call.costMicrousd);
  }
  if(![inputTokens,outputTokens,usedTokens,usedMicrousd].every(integer))return stop("legacy_presentation_usage_unverified");
  const aggregate=parseDocumentReservationJson(JSON.stringify(checkpoint.plannerUsage??{})),plannerInput=parseDocumentReservationJson(JSON.stringify(checkpoint.plannerInput??{}));
  const validation=parseDocumentReservationJson(JSON.stringify(plannerInput.validation??{}));
  if(checkpoint.plannerResponseId&&!responseIds.has(String(checkpoint.plannerResponseId))
    ||checkpoint.plannerResponseIds!==undefined&&(!Array.isArray(checkpoint.plannerResponseIds)||checkpoint.plannerResponseIds.some(id=>typeof id!=="string"||!responseIds.has(id)))
    ||[receipt.actual_provider_call_count,receipt.planner_provider_call_count,plannerInput.provider_request_count,validation.provider_call_count].some(value=>Number(value??0)>calls.length)
    ||Number(aggregate.inputTokens??0)>inputTokens||Number(aggregate.outputTokens??0)>outputTokens||Number(aggregate.totalTokens??0)>usedTokens)return stop("legacy_presentation_call_history_incomplete");
  const tokenId=String(checkpoint.reservationId??""),costId=String(checkpoint.costReservationId??""),payer=user.billingUserId??user.userId;
  if(!tokenId||!costId)return stop("legacy_presentation_reservations_missing","conflict");
  await ensureSchema(env);
  const {ensureOutputRequirementsSchema,outputAssertionStatements}=await import("./output-requirements-ledger.ts");
  await ensureOutputRequirementsSchema(env);
  const jobProof={sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND kind=? AND status=? AND correlation_id=? AND request_json IS ? AND result_json IS ?)",
    bindings:[job.job_id,job.owner_id,job.stream_id,job.document_id,job.kind,job.status,job.correlation_id,job.request_json,job.result_json]};
  const auditWhere="stream_id=? AND type='GenerationUsageRecorded' AND (json_extract(payload,'$.reservation_id')=? OR json_extract(payload,'$.cost_reservation_id')=?)";
  const auditBindings=[job.stream_id,tokenId,costId];
  const reads=await env.DB.batch([
    env.DB.prepare("SELECT 1 AS matches WHERE "+jobProof.sql).bind(...jobProof.bindings),
    env.DB.prepare("SELECT * FROM budget_reservations WHERE reservation_id=? AND owner_id=?").bind(tokenId,payer),
    env.DB.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?").bind(costId,payer),
    env.DB.prepare("SELECT * FROM project_budget_reservation_scopes WHERE reservation_kind='tokens' AND reservation_id=?").bind(tokenId),
    env.DB.prepare("SELECT * FROM project_budget_reservation_scopes WHERE reservation_kind='usd' AND reservation_id=?").bind(costId),
    env.DB.prepare("SELECT * FROM pilot_cost_reservation_scopes WHERE reservation_id=?").bind(costId),
    env.DB.prepare("SELECT event_id,correlation_id,payload FROM events WHERE "+auditWhere).bind(...auditBindings),
    env.DB.prepare("SELECT slot_id FROM output_operation_slots WHERE job_id=? OR token_reservation_id=? OR cost_reservation_id=? LIMIT 1").bind(job.job_id,tokenId,costId),
  ]);
  const token=reads[1]?.results[0] as BudgetReservationRow|undefined,cost=reads[2]?.results[0] as CostBudgetReservationRow|undefined;
  type ScopeRow=Record<string,string|number|null>;
  const tokenScope=reads[3]?.results[0] as ScopeRow|undefined,costScope=reads[4]?.results[0] as ScopeRow|undefined,fixedScope=reads[5]?.results[0] as ScopeRow|undefined;
  if(!reads[0]?.results.length)return stop("legacy_presentation_evidence_changed","conflict");
  if(reads[7]?.results.length)return stop("legacy_presentation_output_bound","conflict");
  if(!token||!cost||token.stream_id!==job.stream_id||cost.stream_id!==job.stream_id
    ||token.correlation_id!==job.correlation_id||cost.correlation_id!==job.correlation_id||token.operation!=="document-render:slides"||cost.operation!==token.operation||token.period!==cost.period
    ||checkpoint.costReservationPeriod!==undefined&&checkpoint.costReservationPeriod!==cost.period
    ||![token.reserved_tokens,token.used_tokens,cost.reserved_microusd,cost.used_microusd].every(integer)
    ||!((token.status==="active"&&token.used_tokens===0)||(token.status===(usedTokens?"settled":"released")&&token.used_tokens===usedTokens))
    ||!((["active","executing"].includes(cost.status)&&cost.used_microusd===0)||(cost.status===(usedMicrousd?"settled":"released")&&cost.used_microusd===usedMicrousd)))return stop("legacy_presentation_reservation_mismatch","conflict");
  if(Boolean(tokenScope)!==Boolean(costScope)||tokenScope&&(!costScope||["organization_id","project_access_id","actor_user_id","workspace_scope_id"].some(key=>tokenScope[key]!==costScope[key])
    ||tokenScope.actor_user_id!==payer||tokenScope.organization_id!==cost.workspace_id||tokenScope.workspace_scope_id!==cost.workspace_id)
    ||!costScope&&cost.workspace_id!=="forma"||fixedScope&&(!costScope||fixedScope.actor_user_id!==payer||fixedScope.organization_id!==cost.workspace_id))return stop("legacy_presentation_billing_scope_mismatch","conflict");
  let recordedTokens=0,recordedCost=0,recordedInput=0,recordedOutput=0;
  const audits=(reads[6]?.results??[]) as Array<{event_id:string;correlation_id:string;payload:string}>;
  for(const row of audits){
    const value=parseDocumentReservationJson(String(row.payload));
    if(row.correlation_id!==token.correlation_id||value.document_id&&value.document_id!==job.document_id||value.job_id&&value.job_id!==job.job_id
      ||value.reservation_id&&value.reservation_id!==tokenId||value.cost_reservation_id&&value.cost_reservation_id!==costId
      ||value.planner_response_id&&!responseIds.has(String(value.planner_response_id))
      ||![value.total_tokens??0,value.cost_microusd??0,value.input_tokens??0,value.output_tokens??0].every(integer))return stop("legacy_presentation_audit_conflict","conflict");
    if(value.reservation_id===tokenId){recordedTokens+=Number(value.total_tokens??0);recordedInput+=Number(value.input_tokens??0);recordedOutput+=Number(value.output_tokens??0);}
    if(value.cost_reservation_id===costId)recordedCost+=Number(value.cost_microusd??0);
  }
  if(![recordedTokens,recordedCost,recordedInput,recordedOutput].every(integer)||recordedTokens>usedTokens||recordedCost>usedMicrousd)return stop("legacy_presentation_audit_conflict","conflict");
  const missingTokens=usedTokens-recordedTokens,missingCost=usedMicrousd-recordedCost;
  if(missingTokens&&(recordedInput+recordedOutput!==recordedTokens||recordedInput>inputTokens||recordedOutput>outputTokens))return stop("legacy_presentation_audit_breakdown_unverified");
  const tokenActive=token.status==="active",costActive=["active","executing"].includes(cost.status),settled=tokenActive||costActive;
  if(tokenActive&&recordedTokens>0||costActive&&recordedCost>0)return stop("legacy_presentation_audit_ahead_of_ledger","conflict");
  const known=(didSettle:boolean,auditRepaired:boolean)=>({status:"known" as const,settled:didSettle,auditRepaired,usedTokens,usedMicrousd,
    releasedTokens:didSettle&&tokenActive?Math.max(0,token.reserved_tokens-usedTokens):0,releasedMicrousd:didSettle&&costActive?Math.max(0,cost.reserved_microusd-usedMicrousd):0,
    receipt:{reservation_id:cost.reservation_id,reserved_microusd:cost.reserved_microusd,used_microusd:usedMicrousd,status:usedMicrousd?"settled":"released"}});
  if(!settled&&!missingTokens&&!missingCost)return known(false,false);
  const assert=(proof:import("./output-requirements-ledger.ts").OutputSqlAssertion)=>outputAssertionStatements(env,proof);
  const rowProof=(table:string,row:ScopeRow)=>({sql:"EXISTS(SELECT 1 FROM "+table+" WHERE "+Object.keys(row).map(key=>key+" IS ?").join(" AND ")+")",bindings:Object.values(row)});
  const scopeProof=(table:string,row:ScopeRow|undefined,predicate:string,bindings:Array<string|number|null>)=>row?rowProof(table,row):{sql:"NOT EXISTS(SELECT 1 FROM "+table+" WHERE "+predicate+")",bindings};
  const nativeProof={sql:"NOT EXISTS(SELECT 1 FROM output_operation_slots WHERE job_id=? OR token_reservation_id=? OR cost_reservation_id=?)",bindings:[job.job_id,tokenId,costId]};
  const proofs=[...(options.assertions??[]),jobProof,nativeProof,rowProof("budget_reservations",token as unknown as ScopeRow),rowProof("cost_budget_reservations",cost as unknown as ScopeRow),
    scopeProof("project_budget_reservation_scopes",tokenScope,"reservation_kind='tokens' AND reservation_id=?",[tokenId]),scopeProof("project_budget_reservation_scopes",costScope,"reservation_kind='usd' AND reservation_id=?",[costId]),
    scopeProof("pilot_cost_reservation_scopes",fixedScope,"reservation_id=?",[costId]),{sql:"(SELECT COUNT(*) FROM events WHERE "+auditWhere+")=?",bindings:[...auditBindings,audits.length]}];
  const counterProof=(table:string,unit:string,scope:string,id:string,reserved:number,used:number,counterPeriod=token.period)=>({sql:"EXISTS(SELECT 1 FROM "+table+" WHERE scope=? AND scope_id=? AND period=? AND typeof(used_"+unit+")='integer' AND used_"+unit+">=0 AND used_"+unit+"<=? AND typeof(reserved_"+unit+")='integer' AND reserved_"+unit+">=?)",bindings:[scope,id,counterPeriod,Number.MAX_SAFE_INTEGER-used,reserved]});
  if(tokenActive){
    proofs.push(counterProof("budget_counters","tokens","user",payer,token.reserved_tokens,usedTokens),counterProof("budget_counters","tokens","workspace","forma",token.reserved_tokens,usedTokens));
    if(tokenScope)proofs.push(counterProof("budget_counters","tokens","workspace",String(tokenScope.organization_id),token.reserved_tokens,usedTokens));
  }
  if(costActive){
    proofs.push(counterProof("cost_budget_counters","microusd","user",payer,cost.reserved_microusd,usedMicrousd),counterProof("cost_budget_counters","microusd","workspace",cost.workspace_id,cost.reserved_microusd,usedMicrousd));
    if(cost.workspace_id!=="forma")proofs.push(counterProof("cost_budget_counters","microusd","workspace","forma",cost.reserved_microusd,usedMicrousd));
    if(fixedScope)proofs.push(counterProof("cost_budget_counters","microusd","pilot_org",String(fixedScope.cohort_id),cost.reserved_microusd,usedMicrousd,"pilot:"+fixedScope.cohort_id),counterProof("cost_budget_counters","microusd","pilot_user",payer,cost.reserved_microusd,usedMicrousd,"pilot:"+fixedScope.cohort_id));
  }
  const statements=proofs.flatMap(assert),reason=options.reason??"legacy_presentation_provider_reconciled";
  const appendSettlement=(batch:D1PreparedStatement[],counterCount:number)=>batch.forEach((statement,index)=>{statements.push(statement);if(index<counterCount||index===batch.length-1)statements.push(...assert({sql:"changes()=1"}));});
  if(tokenActive)appendSettlement(tokenSettlementStatements(env,payer,tokenId,token,tokenScope?{organization_id:String(tokenScope.organization_id),project_access_id:String(tokenScope.project_access_id),actor_user_id:String(tokenScope.actor_user_id)}:null,usedTokens,reason).statements,2+(tokenScope?1:0));
  if(costActive)appendSettlement(costSettlementStatements(env,payer,cost,fixedScope?{cohort_id:String(fixedScope.cohort_id),organization_id:String(fixedScope.organization_id),actor_user_id:String(fixedScope.actor_user_id)}:null,usedMicrousd).statements,2+(cost.workspace_id!=="forma"?1:0)+(fixedScope?2:0));
  const eventIds:string[]=[];
  const appendFinancialEvent=async(type:string,payload:Record<string,unknown>,identity:unknown)=>{
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(["legacy-slides-settlement-v1",job.job_id,job.correlation_id,tokenId,costId,type,identity]))))).map(value=>value.toString(16).padStart(2,"0")).join("");
    const event=makeEvent(job.stream_id,0,"worker:policy","server:policy",token.correlation_id,type,payload);
    event.eventId=digest.slice(0,8)+"-"+digest.slice(8,12)+"-5"+digest.slice(13,16)+"-8"+digest.slice(17,20)+"-"+digest.slice(20,32);
    const bindings=eventWriteBindings(event);
    statements.push(env.DB.prepare("INSERT INTO event_write_stage ("+EVENT_WRITE_COLUMNS+") SELECT ?,?,COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)+1,"+Array(14).fill("?").join(","))
      .bind(...bindings.slice(0,2),job.stream_id,...bindings.slice(3)));
    eventIds.push(event.eventId);
  };
  const common={job_id:job.job_id,document_id:job.document_id,artifact_kind:"slides",reservation_id:tokenId,cost_reservation_id:costId,reason};
  if(missingTokens||missingCost)await appendFinancialEvent("GenerationUsageRecorded",{...common,operation:"document-render:slides:reconciliation",
    input_tokens:missingTokens?inputTokens-recordedInput:0,output_tokens:missingTokens?outputTokens-recordedOutput:0,total_tokens:missingTokens,planner_tokens:missingTokens,
    cost_microusd:missingCost,planner_cost_microusd:missingCost,reserved_tokens:token.reserved_tokens,reserved_microusd:cost.reserved_microusd,
    planner_response_id:String(checkpoint.plannerResponseId??"")||[...responseIds].at(-1)||null,model_ids:[...new Set(calls.map(call=>call.model))],provider_call_count:calls.length},[recordedTokens,recordedCost,usedTokens,usedMicrousd]);
  if(settled)await appendFinancialEvent("BudgetReleased",{...common,operation:"document-render:slides",reserved_tokens:tokenActive?token.reserved_tokens:0,used_tokens:tokenActive?usedTokens:0,released_tokens:tokenActive?Math.max(0,token.reserved_tokens-usedTokens):0,
    reserved_microusd:costActive?cost.reserved_microusd:0,used_microusd:costActive?usedMicrousd:0,released_microusd:costActive?Math.max(0,cost.reserved_microusd-usedMicrousd):0},[tokenActive,costActive,usedTokens,usedMicrousd]);
  const finalProof={sql:"EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id=? AND status=? AND used_tokens=?) AND EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=? AND status=? AND used_microusd=?)"
    +" AND (SELECT COALESCE(SUM(COALESCE(json_extract(payload,'$.total_tokens'),0)),0) FROM events WHERE stream_id=? AND type='GenerationUsageRecorded' AND json_extract(payload,'$.reservation_id')=?)=?"
    +" AND (SELECT COALESCE(SUM(COALESCE(json_extract(payload,'$.cost_microusd'),0)),0) FROM events WHERE stream_id=? AND type='GenerationUsageRecorded' AND json_extract(payload,'$.cost_reservation_id')=?)=?",
    bindings:[tokenId,payer,usedTokens?"settled":"released",usedTokens,costId,payer,usedMicrousd?"settled":"released",usedMicrousd,job.stream_id,tokenId,usedTokens,job.stream_id,costId,usedMicrousd]};
  statements.push(...assert(finalProof),...assert({sql:"(SELECT COUNT(*) FROM events WHERE event_id IN(SELECT value FROM json_each(?)))=?",bindings:[JSON.stringify(eventIds),eventIds.length]}));
  try{await env.DB.batch(statements);return known(settled,!settled&&Boolean(missingTokens||missingCost));}
  catch{
    // Lost acknowledgement or a competing reconciler is success only after an exact durable re-read.
    const confirmed=await env.DB.prepare("SELECT 1 AS confirmed WHERE "+jobProof.sql+" AND "+nativeProof.sql+" AND "+finalProof.sql).bind(...jobProof.bindings,...nativeProof.bindings,...finalProof.bindings).first();
    return confirmed?known(false,false):stop("legacy_presentation_accounting_write_conflict","conflict");
  }
}

/** Repairs orphaned owner-and-stream-scoped reservations without discarding documented provider usage. */
export async function reconcileFailedBudgetReservations(env: WorkerEnv, user: PilotUser, now = Date.now()) {
  await ensureSchema(env);const cutoff=new Date(now-BUDGET_RECONCILIATION_AGE_MS).toISOString();const billingUserId=user.billingUserId??user.userId;
  const legacyStatement=env.DB.prepare(`SELECT reserved.event_id,reserved.correlation_id,reserved.occurred_at,
      json_extract(reserved.payload,'$.reservation_id') AS reservation_id,
      CAST(json_extract(reserved.payload,'$.reserved_tokens') AS INTEGER) AS reserved_tokens,
      COALESCE(json_extract(reserved.payload,'$.operation'),'image-generation') AS operation,
      COALESCE(json_extract(reserved.payload,'$.period'),substr(reserved.occurred_at,1,7)) AS period
    FROM events reserved
    WHERE reserved.stream_id=? AND reserved.type='BudgetReserved' AND reserved.occurred_at<=?
      AND json_extract(reserved.payload,'$.reservation_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM budget_reservations ledger WHERE ledger.reservation_id=json_extract(reserved.payload,'$.reservation_id'))
      AND NOT EXISTS (SELECT 1 FROM events terminal WHERE terminal.stream_id=reserved.stream_id AND terminal.type IN ('BudgetReleased','GenerationUsageRecorded') AND json_extract(terminal.payload,'$.reservation_id')=json_extract(reserved.payload,'$.reservation_id'))
    ORDER BY reserved.occurred_at ASC LIMIT 200`).bind(user.streamId,cutoff);
  const [legacy,outputHistory]=await env.DB.batch<Record<string,unknown>>([legacyStatement,
    env.DB.prepare("SELECT EXISTS(SELECT 1 FROM events WHERE type='OutputExecutionAuthorized' AND (stream_id=? OR actor=?)) AS present").bind(user.streamId,`user:${user.userId}`)]);
  if(outputHistory.results[0]?.present){
    await(await import("./output-requirements-ledger.ts")).ensureOutputRequirementsSchema(env);
    await(await import("./output-reconciliation-entry.ts")).reconcileExpiredOutputAuthorizations(env,user,now);
  }
  for(const row of legacy.results){const reservationId=String(row.reservation_id??"");const reservedTokens=Number(row.reserved_tokens??0);if(!reservationId||reservedTokens<=0)continue;await adoptLegacyBudgetReservation(env,billingUserId,reservationId,reservedTokens,{streamId:user.streamId,correlationId:String(row.correlation_id??""),operation:String(row.operation??"image-generation"),period:String(row.period??period()),createdAt:String(row.occurred_at??new Date(now).toISOString())});}

  const active=await env.DB.prepare(`SELECT * FROM budget_reservations reservation
    WHERE reservation.owner_id=? AND reservation.stream_id=? AND reservation.status='active' AND reservation.created_at<=?
      -- Legacy planning lacks an exact non-submission boundary, including attempt-correlated orphan holds.
      -- Only explicit proven-unused release paths may release this historical operation.
      AND reservation.operation!='adaptive-structure'
      -- Both historical assistant formats can outlive their task row; neither is proof of non-submission.
      AND reservation.operation NOT LIKE 'assistant:%' AND reservation.operation NOT LIKE 'assistant-specialist:%'
      AND reservation.correlation_id NOT LIKE 'assistant:%' AND reservation.correlation_id NOT LIKE 'assistant-specialist:%'
      -- Synthetic benchmark calls retain uncertain exposure even when optional benchmark schema is absent.
      -- Only exact verified usage or a proven-undispatched disposition may settle these operation-bound holds.
      AND reservation.operation NOT LIKE 'memory-benchmark:%' AND reservation.operation NOT LIKE 'memory-derivation:%'
      AND NOT EXISTS (SELECT 1 FROM consequential_execution_steps step WHERE step.token_reservation_id=reservation.reservation_id
        AND(step.status IN('reserved','submitting','uncertain','usage-recorded','settled') OR step.verified_tokens IS NOT NULL
          OR step.verified_microusd IS NOT NULL OR step.provider_request_id IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM document_jobs job WHERE job.stream_id=? AND job.owner_id=? AND (job.status IN ('queued','running','committing') OR job.status IN ('failed','canceled') AND (${unsettledProviderSubmissionSql("job.result_json")} OR json_extract(COALESCE(job.result_json,'{}'),'$.presentationProviderSubmission')='pending' OR json_extract(COALESCE(job.request_json,'{}'),'$.artifactKind')='storyboard' AND json_extract(COALESCE(job.result_json,'{}'),'$.storyboardProviderSubmission') IN ('pending','confirmed') OR json_extract(COALESCE(job.request_json,'{}'),'$.artifactKind')='audio' AND json_extract(COALESCE(job.result_json,'{}'),'$.audioProviderSubmission')='pending'))
        AND (job.correlation_id=reservation.correlation_id OR json_extract(COALESCE(job.result_json,'{}'),'$.reservationId')=reservation.reservation_id))
    ORDER BY reservation.created_at ASC LIMIT 100`).bind(billingUserId,user.streamId,cutoff,user.streamId,user.userId).all<BudgetReservationRow>();

  let released=0;let count=0;let releasedMicrousd=0;let costReservationCount=0;
  for(const row of active.results){
    const job=await terminalReservationJob(env,user,row.correlation_id,row.reservation_id);
    if(job&&hasUnsettledProviderSubmission(parseDocumentReservationJson(job.result_json)))continue;
    if(job&&(row.operation.startsWith("document-render:")||row.operation==="image-preview"||row.operation==="image-generation")){
      const settlement=await settleInterruptedDocumentJobReservations(env,user,job,{tokenReservationId:row.reservation_id,reason:"orphaned_failed_reservation_reconciled",automatic:true});
      if(!settlement.settled)continue;
      released+=settlement.releasedTokens;count+=1;releasedMicrousd+=settlement.releasedMicrousd;if(settlement.releasedMicrousd||settlement.usedMicrousd)costReservationCount+=1;
      continue;
    }
    const settlement=await releaseBudget(env,billingUserId,row.reservation_id,{reason:"orphaned_failed_reservation_reconciled"});
    if(!settlement.settled)continue;
    released+=settlement.reservedTokens;count+=1;
    await appendAuditEvent(env,user.streamId,"worker:policy","BudgetReleased",{reservation_id:row.reservation_id,reserved_tokens:settlement.reservedTokens,used_tokens:0,released_tokens:settlement.reservedTokens,reason:"orphaned_failed_reservation_reconciled",operation:row.operation,automatic_reconciliation:true},row.correlation_id||uuidV7());
  }

  const activeCosts=await env.DB.prepare(`SELECT * FROM cost_budget_reservations reservation
    WHERE reservation.owner_id=? AND reservation.stream_id=? AND (reservation.operation LIKE 'document-render:%' OR reservation.operation IN ('image-preview','image-generation'))
      AND reservation.status IN ('active','executing') AND reservation.created_at<=?
      AND NOT EXISTS (SELECT 1 FROM document_jobs job WHERE job.stream_id=? AND job.owner_id=? AND (job.status IN ('queued','running','committing') OR job.status IN ('failed','canceled') AND (${unsettledProviderSubmissionSql("job.result_json")} OR json_extract(COALESCE(job.result_json,'{}'),'$.presentationProviderSubmission')='pending' OR json_extract(COALESCE(job.request_json,'{}'),'$.artifactKind')='storyboard' AND json_extract(COALESCE(job.result_json,'{}'),'$.storyboardProviderSubmission') IN ('pending','confirmed') OR json_extract(COALESCE(job.request_json,'{}'),'$.artifactKind')='audio' AND json_extract(COALESCE(job.result_json,'{}'),'$.audioProviderSubmission')='pending'))
        AND (job.correlation_id=reservation.correlation_id OR json_extract(COALESCE(job.result_json,'{}'),'$.costReservationId')=reservation.reservation_id))
    ORDER BY reservation.created_at ASC LIMIT 100`).bind(billingUserId,user.streamId,cutoff,user.streamId,user.userId).all<CostBudgetReservationRow>();
  for(const row of activeCosts.results){
    const job=await terminalReservationJob(env,user,row.correlation_id,"",row.reservation_id);
    if(!job||hasUnsettledProviderSubmission(parseDocumentReservationJson(job.result_json)))continue;
    const settlement=await settleInterruptedDocumentJobReservations(env,user,job,{costReservationId:row.reservation_id,reason:"orphaned_failed_cost_reservation_reconciled",automatic:true});
    if(!settlement.settled)continue;
    released+=settlement.releasedTokens;if(settlement.usedTokens||settlement.releasedTokens)count+=1;
    releasedMicrousd+=settlement.releasedMicrousd;costReservationCount+=1;
  }

  return{releasedTokens:released,reservationCount:count,releasedMicrousd,costReservationCount};
}

export type CostBudgetSnapshot = { usedMicrousd: number; reservedMicrousd: number; limitMicrousd: number; remainingMicrousd: number };
const costBudgetLimits = (env: WorkerEnv) => {
  const user = Math.max(100 * MICRO_USD_PER_USD, moneyEnv(env.FORMA_USER_COST_LIMIT_USD, 100));
  return { user, workspace: Math.max(user * 10, moneyEnv(env.FORMA_WORKSPACE_COST_LIMIT_USD, 1_000)) };
};

function costBudgetRowStatements(env: WorkerEnv, scope: "user" | "workspace", scopeId: string, limitMicrousd: number, reservationPeriod = period()) {
  return budgetCounterRowStatements(env,"microusd",scope,scopeId,limitMicrousd,reservationPeriod);
}

async function ensureCostBudgetRow(env: WorkerEnv, scope: "user" | "workspace", scopeId: string, limitMicrousd: number, reservationPeriod = period()) {
  await env.DB.batch(costBudgetRowStatements(env,scope,scopeId,limitMicrousd,reservationPeriod));
}

/** Initialize existing counter metadata once for this authorization request. No
 * funds are reserved here: every child reservation retains its live SQL checks
 * in the enclosing grant transaction. Ordinary job admissions keep their path. */
function initializeOutputAdmissionCounters(env:WorkerEnv,userId:string,reservationPeriod:string,scope:ProjectBudgetScope|undefined,policy:{token_limit:number;microusd_limit:number}|null,reads:OutputAdmissionReads){
  assertOutputAdmissionBudget(reads,env,userId,reservationPeriod,scope);
  if(scope&&!policy)throw new Error("output_admission_budget_policy_required");
  return readOutputAdmissionValue(reads,"budget-counter-initialization",async()=>{
    const tokens=budgetLimits(env),costs=costBudgetLimits(env);
    const statements=[
      ...budgetRowStatements(env,"user",userId,tokens.user,reservationPeriod),
      ...budgetRowStatements(env,"workspace","forma",tokens.workspace,reservationPeriod),
      ...costBudgetRowStatements(env,"user",userId,costs.user,reservationPeriod),
      ...costBudgetRowStatements(env,"workspace","forma",costs.workspace,reservationPeriod),
    ];
    if(scope&&policy)statements.push(
      ...budgetRowStatements(env,"workspace",scope.organizationId,Number(policy.token_limit),reservationPeriod),
      ...costBudgetRowStatements(env,"workspace",scope.organizationId,Number(policy.microusd_limit),reservationPeriod),
    );
    statements.push(env.DB.prepare("SELECT used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=? AND period=?").bind(userId,reservationPeriod));
    const results=await env.DB.batch<Record<string,unknown>>(statements);
    return results.at(-1)?.results[0]??null;
  });
}

export async function readCostBudgets(env: WorkerEnv, userId: string, options: { initialize?: boolean } = {}) {
  const initialize = options.initialize !== false;
  const limits = costBudgetLimits(env);
  const currentPeriod=period();
  const select=()=>env.DB.prepare("SELECT scope,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma'))").bind(currentPeriod,userId);
  let rows=(await select().all<Record<string,unknown>>()).results;
  const userRow=rows.find((row)=>row.scope==="user"),workspaceRow=rows.find((row)=>row.scope==="workspace");
  if(initialize&&(!userRow||!workspaceRow||Number(userRow.hard_limit_microusd)!==limits.user||Number(workspaceRow.hard_limit_microusd)!==limits.workspace)){
    const upsert=(scope:"user"|"workspace",scopeId:string,limit:number)=>costBudgetRowStatements(env,scope,scopeId,limit,currentPeriod);
    const result=await env.DB.batch<Record<string,unknown>>([...upsert("user",userId,limits.user),...upsert("workspace","forma",limits.workspace),select()]);
    rows=result.at(-1)?.results??[];
  }
  const map = Object.fromEntries(rows.map((row) => {
    const usedMicrousd = Number(row.used_microusd); const reservedMicrousd = Number(row.reserved_microusd); const limitMicrousd = !initialize ? (row.scope === "user" ? limits.user : limits.workspace) : Number(row.hard_limit_microusd);
    return [String(row.scope), { usedMicrousd, reservedMicrousd, limitMicrousd, remainingMicrousd: Math.max(0, limitMicrousd - usedMicrousd - reservedMicrousd) } satisfies CostBudgetSnapshot];
  }));
  const empty = (limitMicrousd: number): CostBudgetSnapshot => ({ usedMicrousd: 0, reservedMicrousd: 0, limitMicrousd, remainingMicrousd: limitMicrousd });
  return { period: currentPeriod, currency: "USD" as const, user: map.user ?? empty(limits.user), workspace: map.workspace ?? empty(limits.workspace) };
}

/** Keep authenticated session bootstrap on one steady-state D1 budget read. */
export async function readAccountBudgets(env: WorkerEnv, userId: string,organizationId?:string) {
  const tokens = budgetLimits(env);
  const costs = costBudgetLimits(env);
  const currentPeriod = period();
  const policy=organizationId?await env.DB.prepare("SELECT token_limit,microusd_limit FROM budget_scope_policies WHERE scope='workspace' AND scope_id=? AND organization_id=?")
    .bind(organizationId,organizationId).first<{token_limit:number;microusd_limit:number}>():null;
  if(organizationId&&!policy)throw new Error("workspace_budget_policy_unavailable");
  const workspaceId=organizationId??"forma";
  const workspaceTokenLimit=policy?Number(policy.token_limit):tokens.workspace;
  const workspaceCostLimit=policy?Number(policy.microusd_limit):costs.workspace;
  const query = () => env.DB.prepare(`
    SELECT 'tokens' AS currency,scope,scope_id,used_tokens AS used,reserved_tokens AS reserved,hard_limit_tokens AS hard_limit
    FROM budget_counters
    WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id IN(?,'forma')))
    UNION ALL
    SELECT 'USD' AS currency,scope,scope_id,used_microusd AS used,reserved_microusd AS reserved,hard_limit_microusd AS hard_limit
    FROM cost_budget_counters
    WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id IN(?,'forma')))
  `).bind(currentPeriod,userId,workspaceId,currentPeriod,userId,workspaceId);
  let rows = (await query().all<Record<string, unknown>>()).results;
  const expected = new Map([
    [`tokens:user:${userId}`,tokens.user],[`tokens:workspace:${workspaceId}`,workspaceTokenLimit],
    [`USD:user:${userId}`,costs.user],[`USD:workspace:${workspaceId}`,workspaceCostLimit],
    ...(organizationId?[["tokens:workspace:forma",tokens.workspace],["USD:workspace:forma",costs.workspace]] as Array<[string,number]>:[]),
  ]);
  if (rows.length !== expected.size || rows.some((row) => Number(row.hard_limit) !== expected.get(`${String(row.currency)}:${String(row.scope)}:${String(row.scope_id)}`))) {
    const tokenUpsert=(scope:"user"|"workspace",scopeId:string,limit:number)=>budgetRowStatements(env,scope,scopeId,limit,currentPeriod);
    const costUpsert=(scope:"user"|"workspace",scopeId:string,limit:number)=>costBudgetRowStatements(env,scope,scopeId,limit,currentPeriod);
    const results = await env.DB.batch<Record<string, unknown>>([
      ...tokenUpsert("user",userId,tokens.user),...tokenUpsert("workspace",workspaceId,workspaceTokenLimit),
      ...(organizationId?[...tokenUpsert("workspace","forma",tokens.workspace)]:[]),
      ...costUpsert("user",userId,costs.user),...costUpsert("workspace",workspaceId,workspaceCostLimit),
      ...(organizationId?[...costUpsert("workspace","forma",costs.workspace)]:[]),
      query(),
    ]);
    rows = results.at(-1)?.results ?? [];
  }
  const entry = (currency: "tokens" | "USD", scope: "user" | "workspace",scopeId=scope==="user"?userId:workspaceId) => rows.find((row) => row.currency === currency && row.scope === scope&&row.scope_id===scopeId);
  const tokenScope = (scope: "user" | "workspace") => {
    const row = entry("tokens", scope);
    const used=Number(row?.used??0),reserved=Number(row?.reserved??0);
    let limit=Number(row?.hard_limit??(scope==="workspace"?workspaceTokenLimit:tokens.user));
    if(scope==="workspace"&&organizationId){const platform=entry("tokens","workspace","forma");const available=Math.max(0,Number(platform?.hard_limit??tokens.workspace)-Number(platform?.used??0)-Number(platform?.reserved??0));limit=Math.min(limit,used+reserved+available);}
    return{used,reserved,limit};
  };
  const costScope = (scope: "user" | "workspace"): CostBudgetSnapshot => {
    const row = entry("USD", scope);
    const usedMicrousd = Number(row?.used ?? 0);
    const reservedMicrousd = Number(row?.reserved ?? 0);
    let limitMicrousd=Number(row?.hard_limit??(scope==="workspace"?workspaceCostLimit:costs.user));
    if(scope==="workspace"&&organizationId){const platform=entry("USD","workspace","forma");const available=Math.max(0,Number(platform?.hard_limit??costs.workspace)-Number(platform?.used??0)-Number(platform?.reserved??0));limitMicrousd=Math.min(limitMicrousd,usedMicrousd+reservedMicrousd+available);}
    return { usedMicrousd, reservedMicrousd, limitMicrousd, remainingMicrousd: Math.max(0, limitMicrousd - usedMicrousd - reservedMicrousd) };
  };
  return {
    budgets: { period: currentPeriod, user: tokenScope("user"), workspace: tokenScope("workspace") },
    costBudgets: { period: currentPeriod, currency: "USD" as const, user: costScope("user"), workspace: costScope("workspace") },
  };
}

export type CostBudgetReservationRow = {
  output_bound?:number;output_uncertain?:number;
  reservation_id: string;
  owner_id: string;
  workspace_id: string;
  stream_id: string;
  correlation_id: string;
  operation: string;
  period: string;
  reserved_microusd: number;
  used_microusd: number;
  status: string;
  allow_user_overage: number;
  created_at: string;
  settled_at: string | null;
  updated_at: string;
};

type CostReservationOptions = {
  batchCounterInitialization?:boolean;
  outputAdmissionReads?:OutputAdmissionReads;
  reservationGuard?:BudgetReservationGuard;
  /** Server-only original proofs, committed with counters/reservation/scopes. */
  reservationAssertions?:readonly OutputSqlAssertion[];
  maximumMicrousd: number;
  allowUserOverage: boolean;
  reservationId?: string;
  period?: string;
  streamId?: string;
  correlationId?: string;
  operation?: string;
  projectScope?:ProjectBudgetScope;
};

type ManagedPilotBudget={
  cohort_id:string;
  organization_id:string;
  status:string;
  starts_at:string;
  ends_at:string;
  participant_cap_microusd:number;
  organization_cap_microusd:number;
  participant_user_id:string|null;
  participant_status:string|null;
  participant_revoked_at:string|null;
  participant_role:string|null;
};

/** A managed participant can spend only inside their exact live cohort and project. */
export async function pilotExecutionAllowance(env:WorkerEnv,userId:string,projectScope?:ProjectBudgetScope,admissionReads?:OutputAdmissionReads){
  assertOutputAdmissionBudget(admissionReads,env,userId,period(),projectScope);
  const pilot=await readOutputAdmissionValue(admissionReads,"pilot-allowance",()=>projectScope?env.DB.prepare(`SELECT cohort.cohort_id,cohort.organization_id,cohort.status,cohort.starts_at,cohort.ends_at,
      cohort.participant_cap_microusd,cohort.organization_cap_microusd,participant.user_id AS participant_user_id,
      participant.status AS participant_status,participant.revoked_at AS participant_revoked_at,participant.role AS participant_role
    FROM pilot_cohorts cohort LEFT JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id
      AND participant.organization_id=cohort.organization_id AND participant.user_id=?
    WHERE cohort.organization_id=? AND cohort.status IN ('active','paused','closed') ORDER BY CASE WHEN cohort.status='closed' THEN 1 ELSE 0 END,cohort.created_at DESC LIMIT 1`)
    .bind(userId,projectScope.organizationId).first<ManagedPilotBudget>():env.DB.prepare(`SELECT cohort.cohort_id,cohort.organization_id,cohort.status,cohort.starts_at,cohort.ends_at,
      cohort.participant_cap_microusd,cohort.organization_cap_microusd,participant.user_id AS participant_user_id,
      participant.status AS participant_status,participant.revoked_at AS participant_revoked_at,participant.role AS participant_role
    FROM pilot_cohorts cohort JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id
      AND participant.organization_id=cohort.organization_id AND participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL
    WHERE cohort.status IN ('active','paused','closed') ORDER BY CASE WHEN cohort.status='closed' THEN 1 ELSE 0 END,cohort.created_at DESC LIMIT 1`)
    .bind(userId).first<ManagedPilotBudget>());
  if(!pilot)return{allowed:true as const,pilot:null};
  const now=new Date().toISOString();
  if(!projectScope||pilot.status!=="active"||pilot.starts_at>now||pilot.ends_at<=now||pilot.participant_user_id!==userId||pilot.participant_status!=="active"||pilot.participant_revoked_at||pilot.participant_role==="reviewer")
    return{allowed:false as const,pilot};
  return{allowed:true as const,pilot};
}

export async function costBudgetReservation(env: WorkerEnv, userId: string, reservationId: string) {
  if (!reservationId) return null;
  return env.DB.prepare(`SELECT *${outputReservationColumns(env,"cost_budget_reservations")} FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?`).bind(reservationId, userId).first<CostBudgetReservationRow>();
}

/** Build the existing dollar reservation for composition with a guarded admission.
 * This does not reserve money. There is no separate Output budget authority. */
export async function prepareCostBudgetReservation(env: WorkerEnv, userId: string, requestedMicrousd: number, options: CostReservationOptions) {
  const reservationGuard=options.reservationGuard;
  const reservationChecks=options.reservationAssertions?.length?await budgetReservationAssertionStatements(env,options.reservationAssertions):[];
  const amount = Math.max(0, Math.floor(requestedMicrousd));
  if (!amount || amount > Math.floor(options.maximumMicrousd)) return { ok: false as const, scope: "authorization" as const };
  const limits = costBudgetLimits(env);
  const now = new Date().toISOString();
  const reservationPeriod = options.period ?? period();
  const reservationId = options.reservationId ?? uuidV7();
  const scope=options.projectScope;
  assertOutputAdmissionBudget(options.outputAdmissionReads,env,userId,reservationPeriod,scope);
  const allowance=await pilotExecutionAllowance(env,userId,scope,options.outputAdmissionReads);
  if(!allowance.allowed)return{ok:false as const,scope:"authorization" as const};
  const pilot=allowance.pilot;
  const userOverageAllowed=options.allowUserOverage&&!pilot;
  const policy=scope?await readOutputAdmissionValue(options.outputAdmissionReads,"project-budget-policy",()=>projectBudgetPolicy(env,userId,scope)):null;
  if(scope&&!policy)return{ok:false as const,scope:"workspace" as const};
  const workspaceId=scope?.organizationId??"forma";
  let userBefore:Record<string,unknown>|null=null;
  const counterInitialization:Array<ReturnType<WorkerEnv["DB"]["prepare"]>>=[];
  let userBeforeStatementIndex:number|undefined;
  if(options.outputAdmissionReads&&!reservationChecks.length)userBefore=await initializeOutputAdmissionCounters(env,userId,reservationPeriod,scope,policy,options.outputAdmissionReads);
  else if(options.batchCounterInitialization||reservationChecks.length){
    counterInitialization.push(...costBudgetRowStatements(env,"user",userId,limits.user,reservationPeriod),...costBudgetRowStatements(env,"workspace","forma",limits.workspace,reservationPeriod));
    if(scope&&policy)counterInitialization.push(...costBudgetRowStatements(env,"workspace",scope.organizationId,Number(policy.microusd_limit),reservationPeriod));
    userBeforeStatementIndex=reservationChecks.length+counterInitialization.length;
    counterInitialization.push(env.DB.prepare("SELECT used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=? AND period=?").bind(userId,reservationPeriod));
  }else {
    await ensureCostBudgetRow(env, "user", userId, limits.user, reservationPeriod);
    await ensureCostBudgetRow(env, "workspace", "forma", limits.workspace, reservationPeriod);
    if(scope&&policy)await ensureCostBudgetRow(env,"workspace",scope.organizationId,Number(policy.microusd_limit),reservationPeriod);
    userBefore=await env.DB.prepare("SELECT used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=? AND period=?").bind(userId,reservationPeriod).first<Record<string,unknown>>();
  }
  const authorizing = "EXISTS (SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=? AND status='authorizing')";
  const scopedPredicates=scope&&policy?` AND EXISTS(SELECT 1 FROM cost_budget_counters WHERE scope='workspace' AND scope_id=? AND period=? AND used_microusd+reserved_microusd+?<=hard_limit_microusd)
    AND EXISTS(SELECT 1 FROM budget_scope_policies WHERE scope='workspace' AND scope_id=? AND organization_id=? AND microusd_limit=?) AND ${activeProjectBillingSql}`:"";
  const pilotPeriod=pilot?`pilot:${pilot.cohort_id}`:"";
  const pilotPredicates=pilot?` AND EXISTS(SELECT 1 FROM pilot_cohorts cohort JOIN pilot_participants participant
      ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
      WHERE cohort.cohort_id=? AND cohort.organization_id=? AND cohort.status='active' AND cohort.starts_at<=? AND cohort.ends_at>?
        AND participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL AND participant.role!='reviewer')
    AND EXISTS(SELECT 1 FROM cost_budget_counters WHERE scope='pilot_org' AND scope_id=? AND period=? AND used_microusd+reserved_microusd+?<=hard_limit_microusd)
    AND EXISTS(SELECT 1 FROM cost_budget_counters WHERE scope='pilot_user' AND scope_id=? AND period=? AND used_microusd+reserved_microusd+?<=hard_limit_microusd)`:"";
  const reservationStatementIndex=reservationChecks.length+counterInitialization.length;
  const statements=[
    ...reservationChecks,...counterInitialization,
    env.DB.prepare(`INSERT OR IGNORE INTO cost_budget_reservations (reservation_id,owner_id,workspace_id,stream_id,correlation_id,operation,period,reserved_microusd,used_microusd,status,allow_user_overage,created_at,settled_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,0,'authorizing',?,?,NULL,?
      WHERE ?>0
      AND EXISTS (SELECT 1 FROM cost_budget_counters WHERE scope='user' AND scope_id=? AND period=? AND (?=1 OR used_microusd+reserved_microusd+?<=hard_limit_microusd))
      AND EXISTS (SELECT 1 FROM cost_budget_counters WHERE scope='workspace' AND scope_id='forma' AND period=? AND used_microusd+reserved_microusd+?<=hard_limit_microusd)${scopedPredicates}${pilotPredicates}${reservationGuard?` AND (${reservationGuard.sql})`:""}`)
      .bind(reservationId,userId,workspaceId,options.streamId??"",options.correlationId??"",options.operation??"provider-operation",reservationPeriod,amount,userOverageAllowed?1:0,now,now,amount,userId,reservationPeriod,userOverageAllowed?1:0,amount,reservationPeriod,amount,...(scope&&policy?[scope.organizationId,reservationPeriod,amount,scope.organizationId,scope.organizationId,Number(policy.microusd_limit),userId,userId,scope.projectAccessId,scope.organizationId,userId]:[]),...(pilot?[pilot.cohort_id,pilot.organization_id,now,now,userId,pilot.cohort_id,pilotPeriod,amount,userId,pilotPeriod,amount]:[]),...(reservationGuard?.bindings??[])),
    env.DB.prepare(`UPDATE cost_budget_counters SET reserved_microusd=reserved_microusd+?,updated_at=? WHERE scope='user' AND scope_id=? AND period=? AND ${authorizing}`).bind(amount, now, userId, reservationPeriod, reservationId, userId),
    env.DB.prepare(`UPDATE cost_budget_counters SET reserved_microusd=reserved_microusd+?,updated_at=? WHERE scope='workspace' AND scope_id='forma' AND period=? AND ${authorizing}`).bind(amount, now, reservationPeriod, reservationId, userId),
  ];
  if(scope){
    statements.push(env.DB.prepare(`UPDATE cost_budget_counters SET reserved_microusd=reserved_microusd+?,updated_at=? WHERE scope='workspace' AND scope_id=? AND period=? AND ${authorizing}`).bind(amount,now,scope.organizationId,reservationPeriod,reservationId,userId));
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO project_budget_reservation_scopes(reservation_kind,reservation_id,organization_id,project_access_id,actor_user_id,workspace_scope_id,created_at) SELECT 'usd',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=? AND status='authorizing')")
      .bind(reservationId,scope.organizationId,scope.projectAccessId,userId,scope.organizationId,now,reservationId,userId));
  }
  if(pilot){
    statements.push(env.DB.prepare(`UPDATE cost_budget_counters SET reserved_microusd=reserved_microusd+?,updated_at=? WHERE scope='pilot_org' AND scope_id=? AND period=? AND ${authorizing}`)
      .bind(amount,now,pilot.cohort_id,pilotPeriod,reservationId,userId));
    statements.push(env.DB.prepare(`UPDATE cost_budget_counters SET reserved_microusd=reserved_microusd+?,updated_at=? WHERE scope='pilot_user' AND scope_id=? AND period=? AND ${authorizing}`)
      .bind(amount,now,userId,pilotPeriod,reservationId,userId));
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO pilot_cost_reservation_scopes(reservation_id,cohort_id,organization_id,actor_user_id,created_at)
      SELECT ?,?,?,?,? WHERE ${authorizing}`).bind(reservationId,pilot.cohort_id,pilot.organization_id,userId,now,reservationId,userId));
  }
  statements.push(env.DB.prepare("UPDATE cost_budget_reservations SET status='active',updated_at=? WHERE reservation_id=? AND owner_id=? AND status='authorizing'").bind(now,reservationId,userId));
  return { ok:true as const, statements, reservationStatementIndex, userBeforeStatementIndex, reservationId, reservedMicrousd:amount, period:reservationPeriod, workspaceId, userBefore, userOverageAllowed, pilot, pilotPeriod, limits };
}

export async function reserveCostBudget(env: WorkerEnv, userId: string, requestedMicrousd: number, options: CostReservationOptions) {
  const reservationGuard=options.reservationGuard;
  const prepared=await prepareCostBudgetReservation(env,userId,requestedMicrousd,options);
  if(!prepared.ok)return prepared;
  const {statements,reservationId,reservedMicrousd:amount,period:reservationPeriod,workspaceId,userOverageAllowed,pilot,pilotPeriod,limits}=prepared;
  const scope=options.projectScope;
  const results=await env.DB.batch<Record<string,unknown>>(statements);
  const userBefore=prepared.userBeforeStatementIndex===undefined?prepared.userBefore:results[prepared.userBeforeStatementIndex]?.results[0]??null;
  if (Number(results[prepared.reservationStatementIndex]?.meta.changes ?? 0) !== 1) {
    const existing = options.reservationId ? await costBudgetReservation(env, userId, reservationId) : null;
    if(!await budgetReservationAdmitted(env,reservationGuard))return{ok:false as const,scope:"authorization" as const};
    if(existing?.status==="active"&&Number(existing.reserved_microusd)===amount&&existing.period===reservationPeriod&&existing.workspace_id===workspaceId&&existing.stream_id===(options.streamId??"")&&existing.correlation_id===(options.correlationId??"")&&existing.operation===(options.operation??"provider-operation")){
      if(!scope)return{ok:true as const,reservationId,reservedMicrousd:amount,period:reservationPeriod,userOverageMicrousd:0,reused:true as const};
      const bound=await env.DB.prepare("SELECT organization_id,project_access_id,actor_user_id FROM project_budget_reservation_scopes WHERE reservation_kind='usd' AND reservation_id=?").bind(reservationId).first<Record<string,unknown>>();
      if(bound?.organization_id===scope.organizationId&&bound.project_access_id===scope.projectAccessId&&bound.actor_user_id===userId){
        if(pilot){const fixed=await env.DB.prepare("SELECT 1 AS valid FROM pilot_cost_reservation_scopes WHERE reservation_id=? AND cohort_id=? AND organization_id=? AND actor_user_id=?")
          .bind(reservationId,pilot.cohort_id,pilot.organization_id,userId).first();if(!fixed)return{ok:false as const,scope:"authorization" as const};}
        return{ok:true as const,reservationId,reservedMicrousd:amount,period:reservationPeriod,userOverageMicrousd:0,reused:true as const};
      }
    }
    if(pilot){
      const fixed=await env.DB.prepare("SELECT used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE scope='pilot_user' AND scope_id=? AND period=?")
        .bind(userId,pilotPeriod).first<{used_microusd:number;reserved_microusd:number;hard_limit_microusd:number}>();
      if(fixed&&Number(fixed.used_microusd)+Number(fixed.reserved_microusd)+amount>Number(fixed.hard_limit_microusd))return{ok:false as const,scope:"user" as const};
    }
    const projectedUser = Number(userBefore?.used_microusd ?? 0) + Number(userBefore?.reserved_microusd ?? 0) + amount;
    return { ok: false as const, scope: !userOverageAllowed && projectedUser > Number(userBefore?.hard_limit_microusd ?? limits.user) ? "user" as const : "workspace" as const };
  }
  const projectedUser = Number(userBefore?.used_microusd ?? 0) + Number(userBefore?.reserved_microusd ?? 0) + amount;
  return { ok: true as const, reservationId, reservedMicrousd: amount, period: reservationPeriod, userOverageMicrousd: Math.max(0, projectedUser - Number(userBefore?.hard_limit_microusd ?? limits.user)), reused: false as const };
}

async function resolveCostReservation(env: WorkerEnv, userId: string, reservation: string | number) {
  if (typeof reservation === "string") return costBudgetReservation(env, userId, reservation);
  const amount = Math.max(0, Math.floor(reservation));
  if (!amount) return null;
  const matches = await env.DB.prepare("SELECT * FROM cost_budget_reservations WHERE owner_id=? AND reserved_microusd=? AND status IN ('active','executing') LIMIT 2").bind(userId, amount).all<CostBudgetReservationRow>();
  return matches.results.length === 1 ? matches.results[0]! : null;
}

/** Single-consumer provider execution prevents two requests from spending the same active reservation. */
export async function claimCostBudgetReservation(env: WorkerEnv, userId: string, reservationId: string) {
  return claimCostReservation(env,userId,reservationId,true);
}
/** Native Memory owns its original paired holds. A failed claim is not proof of
 * non-submission and cannot release money. This still is not a dispatch grant. */
export async function claimCostBudgetReservationWithoutRelease(env: WorkerEnv, userId: string, reservationId: string) {
  return claimCostReservation(env,userId,reservationId,false);
}
async function claimCostReservation(env: WorkerEnv, userId: string, reservationId: string, releaseOnFailure:boolean) {
  const reservation=await env.DB.prepare(`SELECT *${outputReservationColumns(env,"cost_budget_reservations")},
    (SELECT json_object('cohort_id',fixed.cohort_id,'organization_id',fixed.organization_id) FROM pilot_cost_reservation_scopes fixed
      WHERE fixed.reservation_id=cost_budget_reservations.reservation_id AND fixed.actor_user_id=cost_budget_reservations.owner_id) AS fixed_scope_json
    FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?`).bind(reservationId,userId).first<CostBudgetReservationRow&{fixed_scope_json:string|null}>();
  if(!reservation||reservation.status!=="active")return false;
  const fixed=reservation.fixed_scope_json?JSON.parse(reservation.fixed_scope_json) as {cohort_id:string;organization_id:string}:null;
  const now=new Date().toISOString();
  const restriction=fixed?` AND EXISTS(
    SELECT 1 FROM pilot_cost_reservation_scopes fixed_scope
      JOIN pilot_cohorts cohort ON cohort.cohort_id=fixed_scope.cohort_id AND cohort.organization_id=fixed_scope.organization_id
      JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
    WHERE fixed_scope.reservation_id=cost_budget_reservations.reservation_id
      AND fixed_scope.actor_user_id=cost_budget_reservations.owner_id
      AND fixed_scope.cohort_id=? AND fixed_scope.organization_id=?
      AND cohort.status='active' AND cohort.starts_at<=? AND cohort.ends_at>?
      AND participant.user_id=cost_budget_reservations.owner_id
      AND participant.status='active' AND participant.revoked_at IS NULL AND participant.role!='reviewer'
  ) AND EXISTS(
    SELECT 1 FROM project_budget_reservation_scopes billing_scope
      JOIN organization_projects billed_project ON billed_project.project_access_id=billing_scope.project_access_id
        AND billed_project.organization_id=billing_scope.organization_id AND billed_project.status='active'
      JOIN project_migration_states billed_migration ON billed_migration.project_access_id=billed_project.project_access_id
        AND billed_migration.organization_id=billed_project.organization_id AND billed_migration.status='active'
      JOIN organizations billed_organization ON billed_organization.organization_id=billed_project.organization_id AND billed_organization.status='active'
      JOIN users billed_identity ON billed_identity.user_id=cost_budget_reservations.owner_id AND billed_identity.consent_version=?
      JOIN organization_memberships billed_actor ON billed_actor.organization_id=billed_project.organization_id
        AND billed_actor.user_id=cost_budget_reservations.owner_id AND billed_actor.status='active'
        AND billed_actor.accepted_at IS NOT NULL AND billed_actor.revoked_at IS NULL
      JOIN organization_memberships billed_owner ON billed_owner.organization_id=billed_project.organization_id
        AND billed_owner.user_id=billed_project.owner_user_id AND billed_owner.status='active'
        AND billed_owner.accepted_at IS NOT NULL AND billed_owner.revoked_at IS NULL
      LEFT JOIN project_memberships billed_member ON billed_member.project_access_id=billed_project.project_access_id
        AND billed_member.organization_id=billed_project.organization_id AND billed_member.project_id=billed_project.project_id
        AND billed_member.user_id=cost_budget_reservations.owner_id AND billed_member.status='active' AND billed_member.revoked_at IS NULL
    WHERE billing_scope.reservation_kind='usd' AND billing_scope.reservation_id=cost_budget_reservations.reservation_id
      AND billing_scope.organization_id=cost_budget_reservations.workspace_id
      AND billing_scope.workspace_scope_id=cost_budget_reservations.workspace_id
      AND billing_scope.actor_user_id=cost_budget_reservations.owner_id
      AND (billed_project.owner_user_id=cost_budget_reservations.owner_id OR billed_member.role IN ('owner','editor'))
  )`:` AND NOT EXISTS(SELECT 1 FROM pilot_cost_reservation_scopes fixed_scope WHERE fixed_scope.reservation_id=cost_budget_reservations.reservation_id)
    AND NOT EXISTS(
      SELECT 1 FROM pilot_cohorts unmanaged_cohort
      WHERE unmanaged_cohort.status IN ('active','paused','closed')
        AND (unmanaged_cohort.status!='closed' OR NOT EXISTS(
          SELECT 1 FROM pilot_cohorts unmanaged_successor
          WHERE unmanaged_successor.organization_id=unmanaged_cohort.organization_id AND unmanaged_successor.status IN ('active','paused')
        ))
        AND (
          unmanaged_cohort.organization_id=cost_budget_reservations.workspace_id
          OR (cost_budget_reservations.workspace_id='forma' AND EXISTS(SELECT 1 FROM pilot_participants unmanaged_participant
            WHERE unmanaged_participant.cohort_id=unmanaged_cohort.cohort_id
              AND unmanaged_participant.organization_id=unmanaged_cohort.organization_id
              AND unmanaged_participant.user_id=cost_budget_reservations.owner_id
              AND unmanaged_participant.status='active' AND unmanaged_participant.revoked_at IS NULL))
        )
    )`;
  const projectCustody=reservation.workspace_id==="forma"?"":` AND EXISTS(SELECT 1 FROM project_budget_reservation_scopes scoped
      JOIN organization_projects project ON project.project_access_id=scoped.project_access_id
        AND project.organization_id=scoped.organization_id AND project.status='active'
      JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
      JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id
        AND migration.organization_id=project.organization_id AND migration.status='active'
      JOIN users identity ON identity.user_id=cost_budget_reservations.owner_id AND identity.consent_version=?
      JOIN organization_memberships member ON member.organization_id=project.organization_id
        AND member.user_id=cost_budget_reservations.owner_id AND member.status='active'
        AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
      JOIN organization_memberships owner ON owner.organization_id=project.organization_id
        AND owner.user_id=project.owner_user_id AND owner.status='active'
        AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
      LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id
        AND project_member.organization_id=project.organization_id AND project_member.user_id=cost_budget_reservations.owner_id
        AND project_member.status='active' AND project_member.revoked_at IS NULL
      WHERE scoped.reservation_kind='usd' AND scoped.reservation_id=cost_budget_reservations.reservation_id
        AND scoped.organization_id=cost_budget_reservations.workspace_id
        AND scoped.actor_user_id=cost_budget_reservations.owner_id
        AND(project.owner_user_id=cost_budget_reservations.owner_id OR project_member.role IN('owner','editor')))`;
  const claimed=await env.DB.prepare(`UPDATE cost_budget_reservations SET status='executing',updated_at=?
    WHERE reservation_id=? AND owner_id=? AND status='active'${restriction}${projectCustody}`)
    .bind(now,reservationId,userId,...(fixed?[fixed.cohort_id,fixed.organization_id,now,now,POLICY_VERSION]:[]),...(reservation.workspace_id!=="forma"?[POLICY_VERSION]:[])).run();
  if(Number(claimed.meta.changes??0)===1)return true;
  if(releaseOnFailure)await settleCostBudget(env,userId,reservationId,0,{activeOnly:true});
  return false;
}

type FixedCostSettlementScope={cohort_id:string;organization_id:string;actor_user_id:string};
function costSettlementStatements(env:WorkerEnv,userId:string,row:CostBudgetReservationRow,fixed:FixedCostSettlementScope|null,usedMicrousd:number,options:{activeOnly?:boolean}={}){
  const now = new Date().toISOString();
  const used = Math.max(0, Math.floor(usedMicrousd));
  const status = used > 0 ? "settled" : "released";
  const allowedStatus=options.activeOnly?"status='active'":"status IN ('active','executing')";
  const guarded=outputSettlementGuard(env,"cost_budget_reservations");
  const active = `EXISTS (SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=? AND ${allowedStatus}${guarded})`;
  const statements=[
    env.DB.prepare(`UPDATE cost_budget_counters SET reserved_microusd=MAX(0,reserved_microusd-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_microusd=used_microusd+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='user' AND scope_id=? AND period=?`).bind(row.reservation_id, userId, row.reserved_microusd, row.reservation_id, userId, used, now, userId, row.period),
    env.DB.prepare(`UPDATE cost_budget_counters SET reserved_microusd=MAX(0,reserved_microusd-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_microusd=used_microusd+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='workspace' AND scope_id=? AND period=?`).bind(row.reservation_id, userId, row.reserved_microusd, row.reservation_id, userId, used, now, row.workspace_id, row.period),
  ];
  if(row.workspace_id!=="forma")statements.push(env.DB.prepare(`UPDATE cost_budget_counters SET reserved_microusd=MAX(0,reserved_microusd-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_microusd=used_microusd+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='workspace' AND scope_id='forma' AND period=?`).bind(row.reservation_id,userId,row.reserved_microusd,row.reservation_id,userId,used,now,row.period));
  if(fixed){
    const fixedPeriod=`pilot:${fixed.cohort_id}`;
    statements.push(env.DB.prepare(`UPDATE cost_budget_counters SET reserved_microusd=MAX(0,reserved_microusd-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_microusd=used_microusd+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='pilot_org' AND scope_id=? AND period=?`)
      .bind(row.reservation_id,userId,row.reserved_microusd,row.reservation_id,userId,used,now,fixed.cohort_id,fixedPeriod));
    statements.push(env.DB.prepare(`UPDATE cost_budget_counters SET reserved_microusd=MAX(0,reserved_microusd-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_microusd=used_microusd+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='pilot_user' AND scope_id=? AND period=?`)
      .bind(row.reservation_id,userId,row.reserved_microusd,row.reservation_id,userId,used,now,userId,fixedPeriod));
    if(used>Number(row.reserved_microusd))statements.push(env.DB.prepare(`UPDATE pilot_cohorts SET status='paused',updated_at=? WHERE cohort_id=? AND organization_id=? AND status='active' AND ${active}`)
      .bind(now,fixed.cohort_id,fixed.organization_id,row.reservation_id,userId));
  }
  statements.push(env.DB.prepare(`UPDATE cost_budget_reservations SET used_microusd=?,status=?,settled_at=?,updated_at=? WHERE reservation_id=? AND owner_id=? AND ${allowedStatus}${guarded}`).bind(used,status,now,now,row.reservation_id,userId));
  return {statements,used,status};
}

/** Server-only identity of an already claimed Scene purchase; never accepted from request JSON. */
export type ClaimedSceneBudget = {
  actorUserId: string;
  streamId: string;
  correlationId: string;
  period: string;
  tokenReservationId: string;
  costReservationId: string;
  reservedTokens: number;
  reservedMicrousd: number;
  projectScope: ProjectExecutionScope | null;
  pilotCohortId: string | null;
};

/**
 * Read-only dispatch proof for the original reservation, not another reservation or a release.
 * Current counters already include this hold. Comparing their totals never adds the hold twice.
 */
export function claimedSceneBudgetGuard(env: WorkerEnv, claim: ClaimedSceneBudget): BudgetReservationGuard {
  return claimedProviderBudgetGuard(env,claim,"document-render:scene");
}
export type ClaimedProviderBudgetOperation = "document-render:scene" | "memory-derivation:rolling-summary" | "memory-derivation:profile" | "memory-derivation:suggestion";
/** Same original-ledger/custody proof for a closed server-derived operation.
 * Request JSON cannot choose an arbitrary operation or mint source authority. */
export function claimedProviderBudgetGuard(env: WorkerEnv, claim: ClaimedSceneBudget, operation: ClaimedProviderBudgetOperation): BudgetReservationGuard {
  if(!["document-render:scene","memory-derivation:rolling-summary","memory-derivation:profile","memory-derivation:suggestion"].includes(operation))return{sql:"0",bindings:[]};
  const tokens=budgetLimits(env), money=costBudgetLimits(env), scope=claim.projectScope;
  if (!claim.actorUserId || !claim.streamId || !claim.correlationId || claim.period!==period()
    || !claim.tokenReservationId || !claim.costReservationId
    || !Number.isSafeInteger(claim.reservedTokens) || claim.reservedTokens<=0
    || !Number.isSafeInteger(claim.reservedMicrousd) || claim.reservedMicrousd<=0
    || scope && scope.actorUserId!==claim.actorUserId || claim.pilotCohortId && !scope) return {sql:"0",bindings:[]};
  const value=JSON.stringify({...claim,workspaceId:scope?.organizationId??"forma",
    tokenUserLimit:tokens.user,tokenGlobalLimit:tokens.workspace,
    costUserLimit:money.user,costGlobalLimit:money.workspace,now:new Date().toISOString()});
  const counter=(alias:string,unit:"tokens"|"microusd",held:string,limit?:string)=>`
    typeof(${alias}.used_${unit})='integer' AND typeof(${alias}.reserved_${unit})='integer'
    AND typeof(${alias}.hard_limit_${unit})='integer' AND ${alias}.used_${unit}>=0
    AND ${alias}.reserved_${unit}>=${held} AND ${alias}.hard_limit_${unit}>0
    AND ${alias}.used_${unit}+${alias}.reserved_${unit}<=${limit?`MIN(${alias}.hard_limit_${unit},${limit})`:`${alias}.hard_limit_${unit}`}`;
  const sql=`EXISTS(
    SELECT 1 FROM (SELECT ? AS value) pinned
    JOIN budget_reservations token ON token.reservation_id=json_extract(pinned.value,'$.tokenReservationId')
    JOIN cost_budget_reservations cost ON cost.reservation_id=json_extract(pinned.value,'$.costReservationId')
    JOIN budget_counters token_user ON token_user.scope='user' AND token_user.scope_id=token.owner_id AND token_user.period=token.period
    JOIN budget_counters token_global ON token_global.scope='workspace' AND token_global.scope_id='forma' AND token_global.period=token.period
    JOIN cost_budget_counters cost_user ON cost_user.scope='user' AND cost_user.scope_id=cost.owner_id AND cost_user.period=cost.period
    JOIN cost_budget_counters cost_global ON cost_global.scope='workspace' AND cost_global.scope_id='forma' AND cost_global.period=cost.period
    WHERE (token.owner_id,token.stream_id,token.correlation_id,token.operation,token.period,token.reserved_tokens,token.used_tokens,token.status)=
      (json_extract(pinned.value,'$.actorUserId'),json_extract(pinned.value,'$.streamId'),json_extract(pinned.value,'$.correlationId'),
       '${operation}',json_extract(pinned.value,'$.period'),json_extract(pinned.value,'$.reservedTokens'),0,'active')
      AND token.settled_at IS NULL${operation === "document-render:scene" ? "" : " AND token.period=strftime('%Y-%m','now')"}
      AND (cost.owner_id,cost.stream_id,cost.correlation_id,cost.operation,cost.period,cost.reserved_microusd,cost.used_microusd,cost.status,cost.allow_user_overage,cost.workspace_id)=
      (token.owner_id,token.stream_id,token.correlation_id,token.operation,token.period,
       json_extract(pinned.value,'$.reservedMicrousd'),0,'executing',0,json_extract(pinned.value,'$.workspaceId'))
      AND cost.settled_at IS NULL
      AND (${counter("token_user","tokens","token.reserved_tokens","json_extract(pinned.value,'$.tokenUserLimit')")})
      AND (${counter("token_global","tokens","token.reserved_tokens","json_extract(pinned.value,'$.tokenGlobalLimit')")})
      AND (${counter("cost_user","microusd","cost.reserved_microusd","json_extract(pinned.value,'$.costUserLimit')")})
      AND (${counter("cost_global","microusd","cost.reserved_microusd","json_extract(pinned.value,'$.costGlobalLimit')")})
      AND ${scope?`EXISTS(
        SELECT 1 FROM project_budget_reservation_scopes token_scope
        JOIN project_budget_reservation_scopes cost_scope ON cost_scope.reservation_kind='usd' AND cost_scope.reservation_id=cost.reservation_id
        JOIN budget_scope_policies policy ON policy.scope='workspace' AND policy.scope_id=cost.workspace_id AND policy.organization_id=cost.workspace_id
        JOIN budget_counters workspace_tokens ON workspace_tokens.scope='workspace' AND workspace_tokens.scope_id=cost.workspace_id AND workspace_tokens.period=token.period
        JOIN cost_budget_counters workspace_cost ON workspace_cost.scope='workspace' AND workspace_cost.scope_id=cost.workspace_id AND workspace_cost.period=cost.period
        WHERE token_scope.reservation_kind='tokens' AND token_scope.reservation_id=token.reservation_id
          AND (token_scope.organization_id,token_scope.project_access_id,token_scope.actor_user_id,token_scope.workspace_scope_id)=
            (cost.workspace_id,json_extract(pinned.value,'$.projectScope.projectAccessId'),token.owner_id,cost.workspace_id)
          AND (cost_scope.organization_id,cost_scope.project_access_id,cost_scope.actor_user_id,cost_scope.workspace_scope_id)=
            (token_scope.organization_id,token_scope.project_access_id,token_scope.actor_user_id,token_scope.workspace_scope_id)
          AND typeof(policy.token_limit)='integer' AND policy.token_limit>0
          AND typeof(policy.microusd_limit)='integer' AND policy.microusd_limit>0
          AND (${counter("workspace_tokens","tokens","token.reserved_tokens","policy.token_limit")})
          AND (${counter("workspace_cost","microusd","cost.reserved_microusd","policy.microusd_limit")})
          AND ${activeProjectBillingSql}
      )`:`NOT EXISTS(SELECT 1 FROM project_budget_reservation_scopes billing
        WHERE (billing.reservation_kind,billing.reservation_id) IN (('tokens',token.reservation_id),('usd',cost.reservation_id)))`}
      AND ${claim.pilotCohortId?`EXISTS(
        SELECT 1 FROM pilot_cost_reservation_scopes fixed
        JOIN pilot_cohorts cohort ON cohort.cohort_id=fixed.cohort_id AND cohort.organization_id=fixed.organization_id
        JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
        JOIN cost_budget_counters pilot_org ON pilot_org.scope='pilot_org' AND pilot_org.scope_id=cohort.cohort_id AND pilot_org.period='pilot:'||cohort.cohort_id
        JOIN cost_budget_counters pilot_user ON pilot_user.scope='pilot_user' AND pilot_user.scope_id=cost.owner_id AND pilot_user.period=pilot_org.period
        WHERE (fixed.reservation_id,fixed.cohort_id,fixed.organization_id,fixed.actor_user_id)=
          (cost.reservation_id,json_extract(pinned.value,'$.pilotCohortId'),cost.workspace_id,cost.owner_id)
          AND cohort.status='active' AND cohort.starts_at<=json_extract(pinned.value,'$.now')
          AND cohort.ends_at>json_extract(pinned.value,'$.now') AND cohort.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND participant.user_id=cost.owner_id AND participant.status='active' AND participant.revoked_at IS NULL AND participant.role!='reviewer'
          AND typeof(cohort.participant_cap_microusd)='integer' AND cohort.participant_cap_microusd>0
          AND typeof(cohort.organization_cap_microusd)='integer' AND cohort.organization_cap_microusd>0
          AND (${counter("pilot_org","microusd","cost.reserved_microusd","cohort.organization_cap_microusd")})
          AND (${counter("pilot_user","microusd","cost.reserved_microusd","cohort.participant_cap_microusd")})
      )`:`(NOT EXISTS(SELECT 1 FROM pilot_cost_reservation_scopes fixed WHERE fixed.reservation_id=cost.reservation_id)
        AND NOT EXISTS(SELECT 1 FROM pilot_cohorts cohort
          WHERE cohort.status IN ('active','paused','closed')
            AND (cohort.status!='closed' OR NOT EXISTS(SELECT 1 FROM pilot_cohorts successor
              WHERE successor.organization_id=cohort.organization_id AND successor.status IN ('active','paused')))
            AND (cohort.organization_id=cost.workspace_id OR cost.workspace_id='forma' AND EXISTS(
              SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id
                AND participant.organization_id=cohort.organization_id AND participant.user_id=cost.owner_id
                AND participant.status='active' AND participant.revoked_at IS NULL))))`}
  )`;
  return {sql,bindings:[value,...(scope?[claim.actorUserId,claim.actorUserId,scope.projectAccessId,scope.organizationId,claim.actorUserId]:[])]};
}

export async function settleCostBudget(env: WorkerEnv, userId: string, reservation: string | number, usedMicrousd: number, options:{activeOnly?:boolean}={}) {
  const row = await resolveCostReservation(env, userId, reservation);
  if (!row) return { settled: false as const, reservedMicrousd: 0, usedMicrousd: 0, status: "missing" as const };
  if(row.output_uncertain)return{settled:false as const,reservedMicrousd:row.reserved_microusd,usedMicrousd:row.used_microusd,status:"uncertain" as const};
  if(options.activeOnly&&row.status!=="active")return{settled:false as const,reservedMicrousd:row.reserved_microusd,usedMicrousd:row.used_microusd,status:row.status};
  let fixed:{cohort_id:string;organization_id:string;actor_user_id:string}|null=null;
  if(row.workspace_id!=="forma"){
    const scoped=await env.DB.prepare("SELECT 1 AS valid FROM project_budget_reservation_scopes WHERE reservation_kind='usd' AND reservation_id=? AND organization_id=? AND workspace_scope_id=? AND actor_user_id=?")
      .bind(row.reservation_id,row.workspace_id,row.workspace_id,userId).first();
    if(!scoped)return{settled:false as const,reservedMicrousd:0,usedMicrousd:0,status:"missing" as const};
    fixed=await env.DB.prepare("SELECT cohort_id,organization_id,actor_user_id FROM pilot_cost_reservation_scopes WHERE reservation_id=? AND organization_id=? AND actor_user_id=?")
      .bind(row.reservation_id,row.workspace_id,userId).first<{cohort_id:string;organization_id:string;actor_user_id:string}>();
  }
  const {statements,used,status}=costSettlementStatements(env,userId,row,fixed,usedMicrousd,options);
  const results=await env.DB.batch(statements);
  const settled=Number(results.at(-1)?.meta.changes??0)===1;
  return { settled, reservationId: row.reservation_id, reservedMicrousd: row.reserved_microusd, usedMicrousd: settled ? used : row.used_microusd, period: row.period, status: settled ? status : row.status };
}

/** Original personal foreground Slides only. Reuse the established settlement
 * writers, but qualify the exact pair and acknowledge its final row atomically. */
export async function settlePersonalPresentationBudgets(env:WorkerEnv,userId:string,input:{jobId:string;streamId:string;correlationId:string;reservationId:string;costReservationId:string;usedTokens:number;usedMicrousd:number}){
  input=Object.freeze({...input});
  const db=env.DB,fail=():never=>{throw new Error("presentation_settlement_unavailable");};
  if(![input.usedTokens,input.usedMicrousd].every(n=>Number.isSafeInteger(n)&&n>=0))return fail();
  const read=structuredClone(await db.batch([
    db.prepare(`SELECT budget_reservations.*${outputReservationColumns(env,"budget_reservations")} FROM budget_reservations WHERE reservation_id=? AND owner_id=?`).bind(input.reservationId,userId),
    db.prepare(`SELECT cost_budget_reservations.*${outputReservationColumns(env,"cost_budget_reservations")} FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?`).bind(input.costReservationId,userId),
  ]));
  const complete=(results:unknown,count:number):results is D1Result<Record<string,unknown>>[]=>Array.isArray(results)&&results.length===count&&Array.from({length:count},(_,i)=>i).every(i=>Object.hasOwn(results,i)&&results[i]?.success===true&&results[i]?.error===undefined);
  const single=(result:D1Result<Record<string,unknown>>)=>Array.isArray(result.results)&&result.results.length===1&&Object.hasOwn(result.results,0)&&result.results[0]&&typeof result.results[0]==="object"&&!Array.isArray(result.results[0]);
  if(env.DB!==db||!complete(read,2)||!read.every(single))return fail();
  const token=read[0].results[0] as unknown as BudgetReservationRow,cost=read[1].results[0] as unknown as CostBudgetReservationRow;
  if(token.reservation_id!==input.reservationId||cost.reservation_id!==input.costReservationId||token.owner_id!==userId||cost.owner_id!==userId
    ||token.stream_id!==input.streamId||cost.stream_id!==input.streamId||token.correlation_id!==input.correlationId||cost.correlation_id!==input.correlationId
    ||token.operation!=="document-render:slides"||cost.operation!==token.operation||token.period!==cost.period||cost.workspace_id!=="forma"
    ||token.output_bound||cost.output_bound||token.output_uncertain||cost.output_uncertain
    ||token.status!=="active"||!["active","executing"].includes(cost.status)
    ||![token.reserved_tokens,cost.reserved_microusd].every(n=>Number.isSafeInteger(n)&&n>0)
    ||token.used_tokens!==0||cost.used_microusd!==0||token.settled_at!==null||cost.settled_at!==null)return fail();
  const tokens=tokenSettlementStatements(env,userId,token.reservation_id,token,null,input.usedTokens,"document_slides_completed");
  const dollars=costSettlementStatements(env,userId,cost,null,input.usedMicrousd);
  const {outputAssertionStatements}=await import("./output-requirements-ledger.ts");
  const guard=outputAssertionStatements(env,{sql:`EXISTS(SELECT 1 FROM budget_reservations token JOIN cost_budget_reservations cost
    ON cost.owner_id=token.owner_id AND cost.stream_id=token.stream_id AND cost.correlation_id=token.correlation_id AND cost.operation=token.operation AND cost.period=token.period
    JOIN document_jobs job ON job.owner_id=token.owner_id AND job.stream_id=token.stream_id AND job.correlation_id=token.correlation_id
    WHERE token.reservation_id=? AND cost.reservation_id=? AND token.owner_id=? AND token.stream_id=? AND token.correlation_id=?
      AND token.operation='document-render:slides' AND token.period=? AND token.status='active' AND cost.status=? AND cost.workspace_id='forma'
      AND token.reserved_tokens=? AND cost.reserved_microusd=? AND token.updated_at IS ? AND cost.updated_at IS ?
      AND job.job_id=? AND job.kind='render_document' AND job.status='committing' AND job.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND json_extract(job.request_json,'$.artifactKind')='slides'
      AND json_extract(job.result_json,'$.reservationId')=token.reservation_id AND json_extract(job.result_json,'$.costReservationId')=cost.reservation_id
      AND NOT EXISTS(SELECT 1 FROM project_budget_reservation_scopes scope WHERE scope.reservation_id IN(token.reservation_id,cost.reservation_id))
      AND NOT EXISTS(SELECT 1 FROM pilot_cost_reservation_scopes fixed WHERE fixed.reservation_id=cost.reservation_id)
      AND NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.token_reservation_id=token.reservation_id OR slot.cost_reservation_id=cost.reservation_id)
      AND NOT EXISTS(SELECT 1 FROM budget_hold_dispositions disposition WHERE disposition.token_reservation_id=token.reservation_id OR disposition.cost_reservation_id=cost.reservation_id))`,
    bindings:[token.reservation_id,cost.reservation_id,userId,input.streamId,input.correlationId,token.period,cost.status,token.reserved_tokens,cost.reserved_microusd,token.updated_at,cost.updated_at,input.jobId]});
  const acknowledged=(statements:D1PreparedStatement[])=>statements.flatMap(statement=>[statement,...outputAssertionStatements(env,{sql:"changes()=1"})]);
  const statements=[...guard,...acknowledged(tokens.statements),...acknowledged(dollars.statements),
    db.prepare("SELECT reservation_id,reserved_microusd,used_microusd,status FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?").bind(cost.reservation_id,userId)];
  if(env.DB!==db)return fail();
  const written=structuredClone(await db.batch(statements));
  if(env.DB!==db||!complete(written,statements.length)||!single(written[written.length-1]))return fail();
  const receipt=written[written.length-1].results[0];
  if(Object.keys(receipt).length!==4||receipt.reservation_id!==cost.reservation_id||receipt.reserved_microusd!==cost.reserved_microusd||receipt.used_microusd!==input.usedMicrousd||receipt.status!==dollars.status)return fail();
  return Object.freeze({reservation_id:cost.reservation_id,reserved_microusd:cost.reserved_microusd,used_microusd:input.usedMicrousd,status:dollars.status});
}

/** Compose the existing account settlements for one durable Output slot. */
export async function settleDocumentGenerationBudgets(env:WorkerEnv,userId:string,input:{reservationId:string;costReservationId:string;usedTokens?:number;usedMicrousd?:number;reason?:string;assertions?:import("./output-requirements-ledger.ts").OutputSqlAssertion[]}){
  const read=await env.DB.batch([
    env.DB.prepare(`SELECT budget_reservations.*${outputReservationColumns(env,"budget_reservations")},scope.organization_id AS scoped_organization_id,scope.project_access_id AS scoped_project_access_id,scope.actor_user_id AS scoped_actor_user_id
      FROM budget_reservations LEFT JOIN project_budget_reservation_scopes scope ON scope.reservation_kind='tokens' AND scope.reservation_id=budget_reservations.reservation_id AND scope.actor_user_id=budget_reservations.owner_id
      WHERE budget_reservations.reservation_id=? AND budget_reservations.owner_id=?`).bind(input.reservationId,userId),
    env.DB.prepare(`SELECT cost_budget_reservations.*${outputReservationColumns(env,"cost_budget_reservations")},scope.reservation_id AS scoped_reservation_id,
      scope.organization_id AS scoped_organization_id,scope.project_access_id AS scoped_project_access_id,scope.actor_user_id AS scoped_actor_user_id,
      fixed.cohort_id AS fixed_cohort_id,fixed.organization_id AS fixed_organization_id,fixed.actor_user_id AS fixed_actor_user_id,
      native.scope_key AS output_scope_key,native.slot_id AS output_slot_id,grant_row.payer_user_id AS output_payer_user_id,
      job.job_id AS output_job_id,job.correlation_id AS output_correlation_id,
      json_extract(COALESCE(job.result_json,'{}'),'$.providerSubmissions') AS output_receipts_json,
      (SELECT json_group_array(json_object('clientRequestId',call.client_request_id,'provider',call.provider,'model',call.model,
        'stage',call.stage_key,'status',call.status,'usedMicrousd',call.used_microusd,'providerRequestId',call.provider_response_id))
       FROM output_provider_calls call WHERE call.scope_key=native.scope_key AND call.slot_id=native.slot_id) AS output_calls_json
      FROM cost_budget_reservations LEFT JOIN project_budget_reservation_scopes scope ON scope.reservation_kind='usd' AND scope.reservation_id=cost_budget_reservations.reservation_id
        AND scope.organization_id=cost_budget_reservations.workspace_id AND scope.workspace_scope_id=cost_budget_reservations.workspace_id AND scope.actor_user_id=cost_budget_reservations.owner_id
      LEFT JOIN pilot_cost_reservation_scopes fixed ON fixed.reservation_id=cost_budget_reservations.reservation_id AND fixed.organization_id=cost_budget_reservations.workspace_id AND fixed.actor_user_id=cost_budget_reservations.owner_id
      LEFT JOIN output_operation_slots native ON native.cost_reservation_id=cost_budget_reservations.reservation_id AND native.token_reservation_id=?
      LEFT JOIN output_execution_grants grant_row ON grant_row.scope_key=native.scope_key AND grant_row.grant_id=native.grant_id
      LEFT JOIN document_jobs job ON job.job_id=native.job_id AND job.owner_id=grant_row.actor_user_id AND job.stream_id=cost_budget_reservations.stream_id
      WHERE cost_budget_reservations.reservation_id=? AND cost_budget_reservations.owner_id=?`).bind(input.reservationId,input.costReservationId,userId),
  ]);
  const token=read[0]?.results[0] as (BudgetReservationRow&{scoped_organization_id:string|null;scoped_project_access_id:string|null;scoped_actor_user_id:string|null})|undefined;
  const cost=read[1]?.results[0] as (CostBudgetReservationRow&{scoped_reservation_id:string|null;scoped_organization_id:string|null;scoped_project_access_id:string|null;scoped_actor_user_id:string|null;fixed_cohort_id:string|null;fixed_organization_id:string|null;fixed_actor_user_id:string|null;output_scope_key:string|null;output_slot_id:string|null;output_payer_user_id:string|null;output_job_id:string|null;output_correlation_id:string|null;output_receipts_json:string|null;output_calls_json:string})|undefined;
  if(!token||!cost||!token.output_bound||!cost.output_bound||!cost.output_slot_id||!cost.output_job_id||cost.output_payer_user_id!==userId||cost.output_correlation_id!==cost.correlation_id
    ||token.stream_id!==cost.stream_id||token.correlation_id!==cost.correlation_id||token.operation!==cost.operation||token.period!==cost.period
    ||token.scoped_organization_id!==cost.scoped_organization_id||token.scoped_project_access_id!==cost.scoped_project_access_id||token.scoped_actor_user_id!==cost.scoped_actor_user_id
    ||cost.workspace_id!=="forma"&&!cost.scoped_reservation_id)throw new Error("output_admitted_reservations_missing");
  if(token.output_uncertain||cost.output_uncertain)return {settled:false,status:"uncertain" as const};
  // A durable provider witness, never a client amount or an erased source body,
  // determines final usage. Missing financial evidence holds the reservation.
  const calls=JSON.parse(cost.output_calls_json) as Array<{clientRequestId:string;provider:string;model:string;stage:string;status:string;usedMicrousd:number|null;providerRequestId:string|null}>;
  const receipts=providerSubmissions({providerSubmissions:JSON.parse(cost.output_receipts_json??"{}")});
  let usedTokens=0,usedMicrousd=0;
  for(const call of calls){
    const receipt=receipts.find(item=>item.clientRequestId===call.clientRequestId);
    if(!receipt||receipt.provider!==call.provider||receipt.model!==call.model||receipt.operation!==(call.stage.startsWith("planning:")?"planning":call.stage==="audio:initial"?"audio":call.stage==="model3d:initial"?"model3d":call.stage==="video:initial"?"video":"image")
      ||!Number.isSafeInteger(call.usedMicrousd)||Number(call.usedMicrousd)<0
      ||call.status==="rejected"&&(receipt.status!=="rejected"||call.usedMicrousd!==0)
      ||call.status==="settled"&&(receipt.status!=="completed"||receipt.costMicrousd!==call.usedMicrousd||(receipt.providerRequestId??null)!==call.providerRequestId
        ||![receipt.inputTokens,receipt.outputTokens,receipt.totalTokens].every(value=>Number.isSafeInteger(value)&&Number(value)>=0))
      ||!["settled","rejected"].includes(call.status))return {settled:false,status:"uncertain" as const};
    usedTokens+=call.status==="rejected"?0:Number(receipt.totalTokens);usedMicrousd+=Number(call.usedMicrousd);
  }
  if(!Number.isSafeInteger(usedTokens)||!Number.isSafeInteger(usedMicrousd))throw new Error("output_provider_usage_invalid");
  if(input.usedTokens!==undefined&&input.usedTokens!==usedTokens||input.usedMicrousd!==undefined&&input.usedMicrousd!==usedMicrousd)throw new Error("output_provider_usage_mismatch");
  if(token.status!=="active"&&!["active","executing"].includes(cost.status)){if(token.used_tokens!==usedTokens||cost.used_microusd!==usedMicrousd)throw new Error("output_provider_usage_mismatch");return {settled:false,status:"known" as const,receipt:{reservation_id:cost.reservation_id,reserved_microusd:cost.reserved_microusd,used_microusd:cost.used_microusd,status:cost.status}};}
  const scope=token.scoped_organization_id&&token.scoped_project_access_id&&token.scoped_actor_user_id?{organization_id:token.scoped_organization_id,project_access_id:token.scoped_project_access_id,actor_user_id:token.scoped_actor_user_id}:null;
  const fixed=cost.fixed_cohort_id&&cost.fixed_organization_id&&cost.fixed_actor_user_id?{cohort_id:cost.fixed_cohort_id,organization_id:cost.fixed_organization_id,actor_user_id:cost.fixed_actor_user_id}:null;
  const tokens=tokenSettlementStatements(env,userId,input.reservationId,token,scope,usedTokens,input.reason??"provider_usage_recorded");
  const dollars=costSettlementStatements(env,userId,cost,fixed,usedMicrousd);
  const {outputAssertionStatements}=await import("./output-requirements-ledger.ts");
  const proof=outputAssertionStatements(env,{sql:`EXISTS(SELECT 1 FROM output_operation_slots slot JOIN document_jobs job ON job.job_id=slot.job_id
    WHERE slot.scope_key=? AND slot.slot_id=? AND slot.token_reservation_id=? AND slot.cost_reservation_id=? AND job.job_id=? AND job.correlation_id=?
      AND json_extract(COALESCE(job.result_json,'{}'),'$.providerSubmissions') IS ?
      AND (SELECT COUNT(*) FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id)=?
      AND (SELECT COALESCE(SUM(call.used_microusd),0) FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id)=?
      AND NOT EXISTS(SELECT 1 FROM output_provider_calls call WHERE call.scope_key=slot.scope_key AND call.slot_id=slot.slot_id AND call.status NOT IN('settled','rejected')))`,
    bindings:[cost.output_scope_key,cost.output_slot_id,input.reservationId,input.costReservationId,cost.output_job_id,cost.correlation_id,cost.output_receipts_json,calls.length,usedMicrousd]});
  const authority=(input.assertions??[]).flatMap(assertion=>outputAssertionStatements(env,assertion));
  const written=await env.DB.batch([...authority,...proof,...tokens.statements,...dollars.statements]);
  return {settled:Number(written[authority.length+proof.length+tokens.statements.length-1]?.meta.changes??0)===1||Number(written.at(-1)?.meta.changes??0)===1,status:"known" as const,receipt:{reservation_id:cost.reservation_id,reserved_microusd:cost.reserved_microusd,used_microusd:usedMicrousd,status:dollars.status}};
}

export async function releaseCostBudget(env: WorkerEnv, userId: string, reservation: string | number) {
  return settleCostBudget(env, userId, reservation, 0);
}

/** Adopt a proven pre-ledger reservation without incrementing a counter that already contains it. */
export async function adoptLegacyCostReservation(env: WorkerEnv, userId: string, input: { reservationId: string; amountMicrousd: number; period: string; streamId: string; correlationId: string; operation: string }) {
  const amount = Math.max(0, Math.floor(input.amountMicrousd));
  if (!amount || !input.reservationId || !input.correlationId || !input.period) return false;
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO cost_budget_reservations (reservation_id,owner_id,workspace_id,stream_id,correlation_id,operation,period,reserved_microusd,used_microusd,status,allow_user_overage,created_at,settled_at,updated_at)
    SELECT ?,?,'forma',?,?,?,?,?,0,'active',0,?,NULL,?
    WHERE EXISTS (SELECT 1 FROM cost_budget_counters WHERE scope='user' AND scope_id=? AND period=? AND reserved_microusd>=?)
    AND EXISTS (SELECT 1 FROM cost_budget_counters WHERE scope='workspace' AND scope_id='forma' AND period=? AND reserved_microusd>=?)
    AND NOT EXISTS (SELECT 1 FROM cost_budget_reservations WHERE owner_id=? AND stream_id=? AND correlation_id=? AND status IN ('active','executing'))
    AND NOT EXISTS (SELECT 1 FROM cost_budget_reservations WHERE reservation_id=?)`)
    .bind(input.reservationId,userId,input.streamId,input.correlationId,input.operation,input.period,amount,now,now,userId,input.period,amount,input.period,amount,userId,input.streamId,input.correlationId,input.reservationId).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function releaseCostReservationsForCorrelation(env: WorkerEnv, userId: string, correlationId: string, streamId: string) {
  const active = await env.DB.prepare("SELECT reservation_id FROM cost_budget_reservations WHERE owner_id=? AND stream_id=? AND correlation_id=? AND status IN ('active','executing') AND operation NOT LIKE 'memory-derivation:%'").bind(userId, streamId, correlationId).all<{ reservation_id: string }>();
  for (const row of active.results) await releaseCostBudget(env, userId, row.reservation_id);
  return active.results.length;
}

/** Ordinary hydration needs current read membership, not permission to buy new work. */
const activeProjectReadSql=`EXISTS(SELECT 1 FROM organization_projects project
  JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
  JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
  JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id
    AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
  LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id AND project_member.project_id=project.project_id
    AND project_member.user_id=? AND project_member.status='active' AND project_member.revoked_at IS NULL
  WHERE project.project_access_id=? AND project.organization_id=? AND project.status='active' AND (project.owner_user_id=? OR project_member.role IN('owner','editor','viewer')))`;
function privateContentScopeGuardFor(ownerId:string,projectScope:ProjectExecutionScope|undefined,projectAuthoritySql:string){
  if(projectScope&&projectScope.actorUserId!==ownerId)return{sql:"0",bindings:[] as string[]};
  const containment=projectScope?` AND EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id
    AND resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=? AND resource.owner_user_id=? AND resource.actor_user_id=? AND resource.visibility='actor_private'
    AND(private_content.kind NOT IN('chat-user','chat-assistant','chat-assistant-memory','memory-structured-ledger','memory-structured-origin','memory-document-job-origin') OR EXISTS(SELECT 1 FROM private_content_retention_scopes retention
      WHERE retention.content_id=private_content.content_id AND retention.organization_id=resource.organization_id
        AND retention.project_access_id=resource.project_access_id AND retention.project_id=resource.project_id
        AND retention.actor_user_id=resource.actor_user_id
        AND(private_content.kind NOT IN('memory-structured-ledger','memory-structured-origin','memory-document-job-origin') OR (retention.classification='transient-private'
          AND typeof(retention.policy_version)='integer' AND retention.policy_version BETWEEN 0 AND 9007199254740991
          AND retention.created_at=private_content.created_at))))) AND ${projectAuthoritySql}`:
    " AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id AND resource.actor_user_id=private_content.owner_id AND resource.owner_user_id!=private_content.owner_id AND resource.visibility='actor_private')"
    + " AND(private_content.kind NOT IN('chat-user','chat-assistant','chat-assistant-memory','memory-structured-ledger','memory-structured-origin','memory-document-job-origin') OR NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=private_content.content_id))";
  return{sql:containment.replace(/^ AND /u,""),bindings:projectScope?[projectScope.projectAccessId,projectScope.organizationId,projectScope.projectId,projectScope.ownerUserId,ownerId,ownerId,ownerId,projectScope.projectAccessId,projectScope.organizationId,ownerId]:[]};
}
/** Reused by atomic recovery writes; retain the original billing predicate exactly. */
export function privateContentScopeGuard(ownerId:string,projectScope?:ProjectExecutionScope){
  return privateContentScopeGuardFor(ownerId,projectScope,activeProjectBillingSql);
}

export async function loadPrivateContent(env: WorkerEnv, ownerId: string, scope: "all" | "chat" | "memory" = "all", projectScope?: ProjectExecutionScope, contentIds?: string[]) {
  if(contentIds && !contentIds.length)return {};
  const now = new Date().toISOString(),guard=privateContentScopeGuardFor(ownerId,projectScope,activeProjectReadSql);
  const { nativeMemoryAnswerExclusion } = await import("./memory-native-boundary.ts");
  const ordinary = await nativeMemoryAnswerExclusion(env,{answerAlias:"private_content"});
  const restricted = scope === "chat" ? " AND kind IN ('chat-user','chat-assistant')" : scope === "memory" ? " AND kind='condition'" : "";
  const rows=await env.DB.prepare(`SELECT content_id,content FROM private_content WHERE owner_id=? AND redacted_at IS NULL AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND kind NOT IN('provider-response','activity-issue-note','execution-consent','context-proposal','authoring-preview','memory-structured-ledger','memory-structured-origin','memory-document-job-origin','guest-image-stage-history') AND substr(content_id,1,26)!='guest-image-stage-history-'${restricted}${contentIds?" AND content_id IN(SELECT value FROM json_each(?))":""} AND ${guard.sql} AND ${ordinary.sql}`).bind(ownerId,now,...(contentIds?[JSON.stringify(contentIds)]:[]),...guard.bindings,...ordinary.bindings).all<{content_id:string;content:string}>();
  return Object.fromEntries(rows.results.map((row) => [row.content_id, row.content]));
}

/** Paid response bodies are server-only evidence and never enter ordinary private-content hydration. */
export async function loadPrivateProviderResponse(env:WorkerEnv,ownerId:string,contentId:string,projectScope?:ProjectExecutionScope){
  if(!contentId||projectScope&&projectScope.actorUserId!==ownerId)return null;
  const now=new Date().toISOString();
  const containment=projectScope?` AND EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id
    AND resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=? AND resource.owner_user_id=? AND resource.actor_user_id=? AND resource.visibility='actor_private') AND ${activeProjectBillingSql}`
    :" AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id)";
  const bindings=projectScope?[ownerId,contentId,now,projectScope.projectAccessId,projectScope.organizationId,projectScope.projectId,projectScope.ownerUserId,ownerId,ownerId,ownerId,projectScope.projectAccessId,projectScope.organizationId,ownerId]:[ownerId,contentId,now];
  return env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE owner_id=? AND content_id=? AND kind='provider-response' AND redacted_at IS NULL AND expires_at>?${containment}`).bind(...bindings).first<{content:string;expires_at:string}>();
}

export async function handleSession(request: Request, env: WorkerEnv, _context?: WorkerExecutionContext, authorization?: Awaited<ReturnType<typeof requireUser>>) {
  void _context;
  const auth = authorization ?? await requireUser(request, env); if (auth.response || !auth.user) return auth.response!; const user = auth.user;
  if (request.method === "POST") {
    const body = await request.json() as { action?: string; ownershipConfirmed?: boolean; providerProcessingConfirmed?: boolean };
    if (body.action !== "accept_terms" || !body.ownershipConfirmed || !body.providerProcessingConfirmed) return Response.json({ error: "explicit_consent_required" }, { status: 400 });
    const now = new Date().toISOString(); await env.DB.prepare("UPDATE users SET consent_version=?,consented_at=?,updated_at=? WHERE user_id=?").bind(POLICY_VERSION, now, now, user.userId).run();
    await appendAuditEvent(env, user.streamId, "user", "ConsentAccepted", { policy_version: POLICY_VERSION, ownership_confirmed: true, external_provider_processing_confirmed: true });
    user.consentVersion = POLICY_VERSION; user.consentedAt = now;
  } else if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const url=new URL(request.url);
  const requestedAudience=url.searchParams.get("audience");
  if(requestedAudience&&!APPLICATIONS.some((application)=>application.id===requestedAudience))return Response.json({error:"invalid_audience"},{status:400});
  const audience=(requestedAudience??(url.pathname.startsWith("/api/")?"creative":applicationIdFromRoute(url.pathname))) as ApplicationId;
  const principal=auth.principal??user;
  const selected=(audience==="creative"||audience==="canvas")&&!auth.impersonation?await readProjectRequestContext(request,env,principal):{context:null,response:null};
  if(selected.response)return selected.response;
  const required=audience==="canvas"?[]:routeRequiredCapabilities(requestedAudience?`/${audience}`:url.pathname);
  if(required.length&&!required.some((capability)=>hasCapability(principal,capability)))return Response.json({error:"access_denied"},{status:403});
  const publicUser=(candidate:PilotUser)=>({userId:candidate.userId,email:candidate.email,displayName:candidate.displayName,role:candidate.role,consentVersion:candidate.consentVersion,consentedAt:candidate.consentedAt,...(candidate.fictional?{fictional:true,billingUserId:candidate.billingUserId}:{})});
  const safeUser=publicUser(user);
  const safeImpersonation=auth.impersonation?{active:true,impersonationId:auth.impersonation.impersonationId,personaId:auth.impersonation.personaId,replaySessionId:auth.impersonation.replaySessionId,actor:publicUser(auth.impersonation.actor),fictionalUser:publicUser(auth.impersonation.fictionalUser),startedAt:auth.impersonation.startedAt,expiresAt:auth.impersonation.expiresAt}:null;
  if(["operations","product","knowledge","engineering"].includes(audience)){
    if(auth.impersonation)return Response.json({error:"return_to_principal_before_internal_access"},{status:409,headers:{"cache-control":"private, no-store"}});
    const allowed=new Set<FormaCapability>(applicationDefinition(audience).requiredCapabilities);
    if(audience==="product"&&principal.role==="admin")allowed.add("evaluation.actual.run");
    // This Engineering control needs both existing grants; exposing the grant
    // does not create it or relax the metadata endpoint's fresh authorization.
    if(audience==="engineering"&&hasCapability(principal,"engineering.diagnostics.read")&&hasCapability(principal,"platform.identity.manage"))allowed.add("platform.identity.manage");
    const capabilities=principal.access.capabilities.filter((capability)=>allowed.has(capability));
    const access={role:principal.role,capabilities:principal.access.capabilities,canvasAccess:principal.access.canvasAccess};
    const availableApplications=APPLICATIONS.filter((application)=>application.id==="creative"||application.id==="canvas"&&principal.access.canvasAccess||application.requiredCapabilities.some((capability)=>principal.access.capabilities.includes(capability)))
      .map((application)=>({id:application.id,href:authorizedApplicationHome(application.id,access)}));
    const assistant=principal.consentVersion===POLICY_VERSION
      ?{enabled:true as const,host:"platform" as const,phase:"read-only" as const}:null;
    return Response.json({user:publicUser(principal),audience,capabilities,availableApplications,permissionEpoch:principal.access.permissionEpoch,organizations:[],canvas:{access:principal.access.canvasAccess},impersonation:null,...(assistant?{assistant}:{})},{headers:{"cache-control":"private, no-store"}});
  }
  const selectedImageProvider=env.FORMA_IMAGE_PROVIDER??"openai";
  const provider={name:"Approved creative generation",model:env.OPENAI_IMAGE_MODEL??"gpt-image-2",plannerModel:env.OPENAI_MODEL??"gpt-5.6-terra",plannerConfigured:Boolean(env.OPENAI_API_KEY),configured:Boolean(env.OPENAI_API_KEY&&(!["fal","fal-ideogram","ideogram"].includes(selectedImageProvider)||env.FAL_KEY)),videoModel:env.FAL_VIDEO_MODEL??DEFAULT_VIDEO_MODEL,videoReferenceModel:env.FAL_REFERENCE_VIDEO_MODEL??DEFAULT_REFERENCE_VIDEO_MODEL,videoConfigured:Boolean(env.OPENAI_API_KEY&&env.FAL_KEY),model3dConfigured:Boolean(env.FAL_KEY),model3dModel:"fal-ai/hyper3d/rodin/v2.5/text-to-3d",model3dReferenceModel:"fal-ai/hyper3d/rodin/v2.5",audioModel:env.FAL_AUDIO_MODEL??"fal-ai/lyria3/pro",audioConfigured:Boolean(env.OPENAI_API_KEY&&env.FAL_KEY&&(!env.FORMA_AUDIO_PROVIDER||env.FORMA_AUDIO_PROVIDER==="fal")&&(!env.FAL_AUDIO_MODEL||audioAdapterContractForModel(env.FAL_AUDIO_MODEL))),audioModels:AUDIO_ADAPTER_CONTRACTS.map((contract)=>({model:contract.model,label:contract.label,capabilities:contract.capabilities,maximumDurationSeconds:contract.maximumAdvertisedDurationSeconds,pricing:contract.pricing})),...((audience==="operations"&&(hasCapability(principal,"platform.provider.configure")||hasCapability(principal,"platform.policy.manage")))?{name:"OpenAI Responses · OpenAI + Fal image adapters · Fal video and audio specialists",imageProvider:selectedImageProvider,imageProviders:[{provider:"openai",model:env.OPENAI_IMAGE_MODEL??"gpt-image-2",configured:Boolean(env.OPENAI_API_KEY)},{provider:"fal",model:env.FAL_IMAGE_MODEL??"ideogram/v4",previewModel:env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast",editModel:env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image",configured:Boolean(env.FAL_KEY)}],videoProvider:env.FORMA_VIDEO_PROVIDER??"fal",audioProvider:env.FORMA_AUDIO_PROVIDER??"fal",videoAdapterVersion:VIDEO_ADAPTER_CONTRACT.adapterVersion,videoApiSunset:null}:{})};
  if(request.method==="GET"&&url.searchParams.get("profile")==="still")return Response.json({
    user:safeUser,permissionEpoch:user.access.permissionEpoch,impersonation:safeImpersonation,
    projects:auth.impersonation?[]:principal.access.projects,
    policy:{version:POLICY_VERSION,accepted:user.consentVersion===POLICY_VERSION,retentionDays:intEnv(env.FORMA_RETENTION_DAYS,30)},
    provider:{configured:provider.configured,plannerConfigured:provider.plannerConfigured,videoConfigured:provider.videoConfigured,audioConfigured:provider.audioConfigured,model3dConfigured:provider.model3dConfigured},
    ...(selected.context?{projectContext:{organizationId:selected.context.organizationId,projectAccessId:selected.context.projectAccessId,projectId:selected.context.projectId,ownerUserId:selected.context.ownerUserId,principalUserId:selected.context.principalUserId,permissions:selected.context.permissions,role:selected.context.role,expiresAt:selected.context.expiresAt}}:{}),
  },{headers:{"cache-control":"private, no-store"}});
  const budgetUser=principal;
  if(request.method==="POST")await reconcileFailedBudgetReservations(env,budgetUser);
  const canReadTenantUsage=Boolean(selected.context&&hasCapability(principal,"workspace.usage.read",{organizationId:selected.context.organizationId}));
  const [canvas,accountBudgets]=await Promise.all([readCanvasGovernance(env,user.role),readAccountBudgets(env,budgetUser.userId,canReadTenantUsage?selected.context?.organizationId:undefined)]);
  const scopedRetention=selected.context?await env.DB.prepare(`SELECT policy.transient_days,policy.evidence_days,
    (SELECT status FROM pilot_cohorts cohort WHERE cohort.organization_id=organization.organization_id AND cohort.status IN ('active','paused','closed')
      ORDER BY CASE WHEN cohort.status='closed' THEN 1 ELSE 0 END,cohort.created_at DESC LIMIT 1) AS pilot_status
    FROM organizations organization LEFT JOIN organization_retention_policies policy ON policy.organization_id=organization.organization_id WHERE organization.organization_id=?`)
    .bind(selected.context.organizationId).first<{transient_days:number|null;evidence_days:number|null;pilot_status:string|null}>():null;
  const privileged=audience==="operations"&&(hasCapability(principal,"platform.provider.configure")||hasCapability(principal,"platform.policy.manage"));
  const selectedCanvasAccess=Boolean(selected.context&&canvas.access&&hasCapability(principal,"project.canvas.use",{organizationId:selected.context.organizationId,projectAccessId:selected.context.projectAccessId}));
  const safeCanvas=selected.context?{...canvas,access:selectedCanvasAccess,blockedBy:[],requirements:[]}:privileged?canvas:{...canvas,blockedBy:[],requirements:[]};
  const effectiveAccess=auth.impersonation?user.access:principal.access;
  const personalCapabilities=canvas.access?[...new Set<FormaCapability>([...effectiveAccess.capabilities,"project.canvas.use"])]:effectiveAccess.capabilities;
  const capabilities=selected.context?[
    ...effectiveAccess.capabilities.filter((capability)=>capability.startsWith("self.")),
    ...selected.context.permissions.filter((capability)=>capability!=="project.canvas.use"||selectedCanvasAccess),
  ]:personalCapabilities;
  const assistantEditors=new Set((env.FORMA_ASSISTANT_ACTION_USER_IDS??"").split(",").map((value)=>value.trim()).filter(Boolean));
  const assistantProviders=new Set((env.FORMA_ASSISTANT_PROVIDER_USER_IDS??"").split(",").map((value)=>value.trim()).filter(Boolean));
  const assistantPremiumUsers=new Set((env.FORMA_ASSISTANT_SOL_USER_IDS??"").split(",").map((value)=>value.trim()).filter(Boolean));
  const assistantModelAllowlist=(env.FORMA_ASSISTANT_ALLOWED_MODELS??"gpt-5.6-luna,gpt-5.6-terra").split(",")
    .map((value)=>value.trim()).filter((value):value is AssistantModel=>ASSISTANT_MODELS.includes(value as AssistantModel));
  const assistantProviderAllowed=Boolean(env.OPENAI_API_KEY&&assistantProviders.has(principal.userId)
    &&(selected.context?hasCapability(principal,"project.output.request",{organizationId:selected.context.organizationId,projectAccessId:selected.context.projectAccessId})
      :effectiveAccess.capabilities.includes("project.output.request")));
  const assistantModels=assistantProviderAllowed?[...new Set(assistantModelAllowlist)]
    .filter((model)=>model!=="gpt-5.6-sol"||principal.role==="admin"&&assistantPremiumUsers.has(principal.userId))
    .map((id)=>({id,maximumMicrousd:assistantModelCostMicrousd(id,10_400,1_600),premiumApprovalRequired:id==="gpt-5.6-sol"})):[];
  const assistant=!auth.impersonation&&(audience==="creative"||audience==="canvas")
    ?{enabled:true as const,phase:assistantEditors.has(principal.userId)?"actions" as const:"read-only" as const,capabilities:["project.assistant.read",...(!selected.context||hasCapability(principal,"project.author",{organizationId:selected.context.organizationId,projectAccessId:selected.context.projectAccessId})?["project.assistant.propose"]:[])],...(assistantModels.length?{models:assistantModels}:{})}
    :null;
  const visibleBudgets=privileged||canReadTenantUsage?accountBudgets:{budgets:{...accountBudgets.budgets,workspace:{...accountBudgets.budgets.user}},costBudgets:{...accountBudgets.costBudgets,workspace:{...accountBudgets.costBudgets.user}}};
  return Response.json({user:safeUser,audience,capabilities,permissionEpoch:effectiveAccess.permissionEpoch,organizations:auth.impersonation?[]:principal.access.organizations,projects:auth.impersonation?[]:principal.access.projects,
    ...(selected.context?{projectContext:{organizationId:selected.context.organizationId,projectAccessId:selected.context.projectAccessId,projectId:selected.context.projectId,ownerUserId:selected.context.ownerUserId,role:selected.context.role,permissions:selected.context.permissions.filter((capability)=>capability!=="project.canvas.use"||selectedCanvasAccess),expiresAt:selected.context.expiresAt,managedPilot:Boolean(scopedRetention?.pilot_status)}}:{}),
    ...(assistant?{assistant}:{}),impersonation:safeImpersonation,policy:{version:POLICY_VERSION,accepted:user.consentVersion===POLICY_VERSION,passiveCapture:false,attentionCapture:{available:true,defaultOn:false,retentionDays:14,rawInputCapture:false},externalAssetsRequireAssertion:true,retentionDays:Number(scopedRetention?.transient_days??intEnv(env.FORMA_RETENTION_DAYS,30)),evidenceRetentionDays:Number(scopedRetention?.evidence_days??Math.max(1,Math.min(3650,intEnv(env.FORMA_EVIDENCE_RETENTION_DAYS,DEFAULT_EVIDENCE_RETENTION_DAYS)))),sharing:"private-expiring-revocable"},canvas:safeCanvas,provider,...visibleBudgets});
}

export async function handleImpersonation(request:Request,env:WorkerEnv){
  const auth=await requireUser(request,env,"admin",{account:"principal"});if(auth.response||!auth.user)return auth.response!;const actor=auth.user;
  if(request.method==="POST"){
    const body=await request.json().catch(()=>({})) as {personaId?:string;confirmation?:string};if(body.confirmation!=="I understand, continue")return Response.json({error:"explicit_impersonation_confirmation_required"},{status:428});
    const persona=await env.DB.prepare("SELECT * FROM replay_personas WHERE persona_id=? AND owner_id=? AND status='ready'").bind(String(body.personaId??""),actor.userId).first<Record<string,unknown>>();if(!persona)return Response.json({error:"replay_persona_not_ready"},{status:409});
    const now=new Date();const expiresAt=new Date(now.getTime()+8*60*60_000);const impersonationId=uuidV7();await env.DB.batch([env.DB.prepare("UPDATE impersonation_sessions SET status='ended',ended_at=? WHERE actor_user_id=? AND status='active'").bind(now.toISOString(),actor.userId),env.DB.prepare("INSERT INTO impersonation_sessions (impersonation_id,actor_user_id,persona_id,fictional_user_id,replay_session_id,status,started_at,expires_at,ended_at) VALUES (?,?,?,?,?,'active',?,?,NULL)").bind(impersonationId,actor.userId,String(persona.persona_id),String(persona.fictional_user_id),String(persona.session_id),now.toISOString(),expiresAt.toISOString())]);
    await appendAuditEvent(env,actor.streamId,"user","ReplayPersonaImpersonationStarted",{impersonation_id:impersonationId,persona_id:String(persona.persona_id),replay_session_id:String(persona.session_id),fictional_user_id:String(persona.fictional_user_id),expires_at:expiresAt.toISOString(),explicit_confirmation:true});
    const response=Response.json({active:true,route:String(persona.route??"/projects"),displayName:String(persona.display_name),expiresAt:expiresAt.toISOString()});response.headers.set("set-cookie",impersonationCookie(request,impersonationId,8*60*60));return response;
  }
  if(request.method==="DELETE"){
    const id=decodedCookieValue(request,"forma_impersonation");const now=new Date().toISOString();if(id){const active=await env.DB.prepare("SELECT * FROM impersonation_sessions WHERE impersonation_id=? AND actor_user_id=? AND status='active'").bind(id,actor.userId).first<Record<string,unknown>>();await env.DB.prepare("UPDATE impersonation_sessions SET status='ended',ended_at=? WHERE impersonation_id=? AND actor_user_id=? AND status='active'").bind(now,id,actor.userId).run();if(active)await appendAuditEvent(env,actor.streamId,"user","ReplayPersonaImpersonationEnded",{impersonation_id:id,persona_id:String(active.persona_id),replay_session_id:String(active.replay_session_id),fictional_user_id:String(active.fictional_user_id)});}
    const response=Response.json({active:false,route:"/laboratory/replay"});response.headers.set("set-cookie",impersonationCookie(request,"",0));return response;
  }
  return new Response("Method not allowed",{status:405});
}

export async function handleAdminUsers(request: Request, env: WorkerEnv) {
  const auth = await requireCapability(request, env, "platform.identity.manage"); if (auth.response || !auth.user) return auth.response!;
  if (request.method === "GET") {
    const result = await env.DB.prepare("SELECT user_id,email,display_name,role,consent_version,consented_at,created_at FROM users ORDER BY created_at").all(); return Response.json({ users: result.results });
  }
  if (request.method !== "PATCH") return new Response("Method not allowed", { status: 405 });
  const body = await request.json() as { userId?: string; role?: PilotRole }; if (!body.userId || !body.role || !Object.hasOwn(roleRank,body.role)) return Response.json({ error: "valid_user_and_role_required" }, { status: 400 });
  if(body.userId===auth.user.userId)return Response.json({error:auth.user.role==="admin"?"admin_cannot_change_self":"self_role_change_forbidden"},{status:auth.user.role==="admin"?409:403});
  const target=await env.DB.prepare("SELECT role FROM users WHERE user_id=?").bind(body.userId).first<{role:string}>();
  if(!target)return Response.json({error:"user_not_found"},{status:404});
  if((body.role==="admin"||target.role==="admin")&&auth.user.role!=="admin")return Response.json({error:"administrator_approval_required"},{status:403});
  const result = await env.DB.prepare("UPDATE users SET role=?,updated_at=? WHERE user_id=?").bind(body.role, new Date().toISOString(), body.userId).run(); if (Number(result.meta.changes ?? 0) !== 1) return Response.json({ error: "user_not_found" }, { status: 404 });
  await appendAuditEvent(env, auth.user.streamId, "user", "RoleAssigned", { subject_user_id: body.userId, role: body.role }); return Response.json({ ok: true });
}
