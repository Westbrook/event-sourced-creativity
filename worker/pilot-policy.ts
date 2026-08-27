import { appendAuditEvent, ensureSchema, uuidV7, type WorkerEnv, type WorkerExecutionContext } from "./runtime.ts";
import { MICRO_USD_PER_USD } from "./replay-cost.ts";
import { interruptedDocumentJobUsage, recordedDocumentPlannerUsage } from "./document-job-reservations.ts";
import { hasUnsettledProviderSubmission, unsettledProviderSubmissionSql } from "../src/model/provider-submission.ts";
import { readCanvasGovernance } from "./canvas-governance-policy.ts";
import { DEFAULT_REFERENCE_VIDEO_MODEL, DEFAULT_VIDEO_MODEL, VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { AUDIO_ADAPTER_CONTRACTS, audioAdapterContractForModel } from "../src/model/audio.ts";
import { PLATFORM_PRINCIPAL_WITH_ACCESS_SQL, PRINCIPAL_WITH_ACCESS_SQL, principalAccessFromRow, principalHasCapability, type PrincipalAccess } from "./access-policy.ts";
import type { FormaCapability } from "../src/platform/capabilities.ts";
import { APPLICATIONS, applicationDefinition, applicationIdFromRoute, authorizedApplicationHome, routeRequiredCapabilities, type ApplicationId } from "../src/platform/applications.ts";
import { ASSISTANT_MODELS, assistantModelCostMicrousd, type AssistantModel } from "../src/model/assistant-model-policy.ts";
import { readProjectRequestContext } from "./project-access.ts";

export const POLICY_VERSION = "pilot-2026-08-10";
export type PilotRole = "admin" | "creator" | "agent" | "viewer";
export type ProjectExecutionScope={organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string;actorUserId:string};
export type PilotUser = { userId: string; email: string; displayName: string; role: PilotRole; consentVersion: string | null; consentedAt: string | null; streamId: string; access: PrincipalAccess; fictional?: boolean; billingUserId?: string;projectExecution?:ProjectExecutionScope; authorizationSnapshot?:{updatedAt:string;rawEpoch:string;grants:string;organizations:string;projects:string;identityPolicies:string;canvasRequirements:number} };
export type PilotImpersonation = { impersonationId:string; personaId:string; replaySessionId:string; actor:PilotUser; fictionalUser:PilotUser; startedAt:string; expiresAt:string };

const roleRank: Record<PilotRole, number> = { viewer: 0, agent: 1, creator: 2, admin: 3 };
const intEnv = (value: string | undefined, fallback: number) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback; };
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

function decodeName(request: Request) {
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (!encoded || request.headers.get("oai-authenticated-user-full-name-encoding") !== "percent-encoded-utf-8") return "";
  try { return decodeURIComponent(encoded); } catch { return ""; }
}

function identityFromRequest(request: Request) {
  const url = new URL(request.url);
  const oaiId = request.headers.get("oai-authenticated-user-id");
  const oaiEmail = request.headers.get("oai-authenticated-user-email");
  if (oaiId && oaiEmail) return { userId: oaiId, email: oaiEmail.toLowerCase(), displayName: decodeName(request) || oaiEmail.split("@")[0], source: "openai-workspace" };
  // A bare cf-access-authenticated-user-email header is not a verified identity assertion.
  // Hosted Sites authenticates visitors through its trusted OpenAI identity headers.
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return { userId: "dev-local-creative", email: "creative@local.forma", displayName: "Local creative", source: "local-development" };
  return null;
}

const cookieValue=(request:Request,name:string)=>request.headers.get("cookie")?.split(";").map((value)=>value.trim()).find((value)=>value.startsWith(`${name}=`))?.slice(name.length+1)??"";
const decodedCookieValue=(request:Request,name:string)=>{const value=cookieValue(request,name);try{return decodeURIComponent(value);}catch{return "";}};
const impersonationCookie=(request:Request,value:string,maxAge:number)=>`forma_impersonation=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol==="https:"?"; Secure":""}`;
const impersonationMutationExempt=(request:Request)=>{const url=new URL(request.url);if(["GET","HEAD","OPTIONS"].includes(request.method))return true;if(url.pathname.startsWith("/api/impersonation")||url.pathname.startsWith("/api/replay-sessions")||url.pathname.startsWith("/api/admin/")||url.pathname==="/api/session")return true;return /^\/api\/document-jobs\/[^/]+\/(?:run|ack)$/.test(url.pathname);};

async function activeImpersonation(request:Request,env:WorkerEnv,actor:PilotUser):Promise<PilotImpersonation|null>{
  const id=decodedCookieValue(request,"forma_impersonation");if(!id)return null;const row=await env.DB.prepare(`SELECT impersonation.*,persona.display_name,fictional.email,fictional.role AS fictional_role,fictional.consent_version,fictional.consented_at
    FROM impersonation_sessions impersonation JOIN replay_personas persona ON persona.persona_id=impersonation.persona_id JOIN users fictional ON fictional.user_id=impersonation.fictional_user_id
    WHERE impersonation.impersonation_id=? AND impersonation.actor_user_id=? AND impersonation.status='active' AND impersonation.expires_at>? AND persona.status='ready'`).bind(id,actor.userId,new Date().toISOString()).first<Record<string,unknown>>();
  if(!row)return null;const fictionalUser:PilotUser={userId:String(row.fictional_user_id),email:String(row.email),displayName:String(row.display_name),role:String(row.fictional_role??"creator") as PilotRole,consentVersion:row.consent_version?String(row.consent_version):null,consentedAt:row.consented_at?String(row.consented_at):null,streamId:`creative:${String(row.fictional_user_id)}`,access:await principalAccessFromRow({updated_at:row.updated_at??""},"creator"),fictional:true,billingUserId:actor.userId};
  return{impersonationId:String(row.impersonation_id),personaId:String(row.persona_id),replaySessionId:String(row.replay_session_id),actor,fictionalUser,startedAt:String(row.started_at),expiresAt:String(row.expires_at)};
}

export async function requireUser(request: Request, env: WorkerEnv, minimum: PilotRole = "viewer", options:{account?:"effective"|"principal"}={}) {
  await ensureSchema(env);
  const identity = identityFromRequest(request);
  if (!identity) return { response: Response.json({ error: "authentication_required" }, { status: 401 }), user: null };
  const restrictedCohort=env.FORMA_PILOT_COHORT_ID?.trim()??"";
  type AdmittedPilotParticipant={participant_id:string;user_id:string|null;cohort_id:string;participant_cap_microusd:number};
  let admittedParticipant:AdmittedPilotParticipant|null=null;
  if(restrictedCohort){
    const now=new Date().toISOString();
    admittedParticipant=await env.DB.prepare(`SELECT participant.participant_id,participant.user_id,cohort.cohort_id,cohort.participant_cap_microusd
      FROM pilot_cohorts cohort JOIN organizations organization ON organization.organization_id=cohort.organization_id AND organization.status='active'
      JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
      WHERE cohort.organization_id=(SELECT selected.organization_id FROM pilot_cohorts selected WHERE selected.cohort_id=?)
        AND cohort.status IN ('active','paused') AND cohort.starts_at<=? AND cohort.ends_at>?
        AND participant.email_normalized=? AND participant.status='active' AND participant.revoked_at IS NULL
        AND (participant.user_id IS NULL OR participant.user_id=?) ORDER BY cohort.created_at DESC LIMIT 1`)
      .bind(restrictedCohort,now,now,identity.email,identity.userId).first<AdmittedPilotParticipant>();
    const breakglass=new Set((env.FORMA_ADMIN_EMAILS??"").split(",").map((value)=>value.trim().toLowerCase()).filter(Boolean));
    if(!admittedParticipant&&!breakglass.has(identity.email)){
      const ownerRecovery=await env.DB.prepare(`SELECT 1 AS authorized FROM pilot_cohorts cohort
        JOIN organizations organization ON organization.organization_id=cohort.organization_id AND organization.status='active'
        JOIN organization_memberships member ON member.organization_id=cohort.organization_id AND member.user_id=? AND member.role='owner'
          AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
        JOIN users principal ON principal.user_id=member.user_id AND principal.email=?
        WHERE cohort.cohort_id=? AND (cohort.status='closed' OR cohort.ends_at<=? OR cohort.starts_at>?)
          AND NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=cohort.organization_id
            AND successor.status IN ('active','paused') AND successor.starts_at<=? AND successor.ends_at>?)`)
        .bind(identity.userId,identity.email,restrictedCohort,now,now,now,now).first();
      if(!ownerRecovery)return{response:Response.json({error:"pilot_participant_required"},{status:403}),user:null};
    }
  }
  let row = await env.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(identity.userId).first<Record<string, unknown>>();
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
        env.DB.prepare(`INSERT OR IGNORE INTO cost_budget_counters(scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at)
          SELECT 'pilot_user',?,?,0,0,?,? WHERE EXISTS(SELECT 1 FROM pilot_participants WHERE participant_id=? AND user_id=? AND status='active')`)
          .bind(identity.userId,pilotPeriod,admittedParticipant.participant_cap_microusd,now,admittedParticipant.participant_id,identity.userId),
      ]);
      if(Number(results[1]?.meta.changes??0)!==1)return{response:Response.json({error:"pilot_participant_required"},{status:403}),user:null};
    }else{
      await env.DB.prepare("INSERT OR IGNORE INTO users (user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES (?,?,?,?,NULL,NULL,?,?)").bind(identity.userId, identity.email, identity.displayName, initialRole, now, now).run();
    }
    row = await env.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(identity.userId).first<Record<string, unknown>>();
  } else {
    const observed = { email: identity.email, source: identity.source, subject: identity.userId };
    const access = await principalAccessFromRow(row, String(row.role), observed);
    if (access.identityPolicyDeniedCustody || row.email !== identity.email && access.deniedOrganizationIds?.length) {
      return { response: Response.json({ error: "organization_identity_policy_required" }, { status: 403 }), user: null, principal: null, impersonation: null };
    }
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
      env.DB.prepare("INSERT OR IGNORE INTO cost_budget_counters(scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at) VALUES('pilot_user',?,?,0,0,?,?)")
        .bind(identity.userId,`pilot:${admittedParticipant.cohort_id}`,admittedParticipant.participant_cap_microusd,now),
    ]);
  }
  const role=String(row?.role) as PilotRole;
  if(!Object.hasOwn(roleRank,role)||!Object.hasOwn(roleRank,minimum))return{response:Response.json({error:"invalid_account_role"},{status:403}),user:null,principal:null,impersonation:null};
  const access=await principalAccessFromRow(row??{},role,{email:identity.email,source:identity.source,subject:identity.userId});
  if(access.identityPolicyDeniedCustody)return{response:Response.json({error:"organization_identity_policy_required"},{status:403}),user:null,principal:null,impersonation:null};
  const principal: PilotUser = { userId: String(row?.user_id), email: String(row?.email), displayName: String(row?.display_name), role, consentVersion: row?.consent_version ? String(row?.consent_version) : null, consentedAt: row?.consented_at ? String(row.consented_at) : null, streamId: `creative:${identity.userId}`, access,
    authorizationSnapshot:{updatedAt:String(row?.updated_at??""),rawEpoch:String(row?.permission_epoch??""),grants:String(row?.grants_json??"[]"),organizations:String(row?.organizations_json??"[]"),projects:String(row?.projects_json??"[]"),identityPolicies:String(row?.identity_policies_json??"[]"),canvasRequirements:Number(row?.approved_canvas_requirements??0)} };
  if (roleRank[principal.role] < roleRank[minimum]) return { response: Response.json({ error: "insufficient_role", required: minimum, role: principal.role }, { status: 403 }), user: null, principal, impersonation:null };
  const principalOnly=options.account==="principal";
  const checkPrincipalImpersonation=principalOnly&&new URL(request.url).pathname!=="/api/impersonation"&&Boolean(decodedCookieValue(request,"forma_impersonation"));
  const impersonation=principalOnly&&!checkPrincipalImpersonation?null:await activeImpersonation(request,env,principal);
  if(principalOnly&&impersonation)return{response:Response.json({error:"return_to_principal_before_internal_access"},{status:409}),user:null,principal,impersonation};
  const user=impersonation?.fictionalUser??principal;
  if(impersonation&&!impersonationMutationExempt(request)&&request.headers.get("x-forma-impersonation-confirmation")!=="I understand, continue")return{response:Response.json({error:"impersonation_confirmation_required",message:`You are acting as ${user.displayName}. Confirm this individual interaction before it changes the fictional account.`},{status:428}),user:null,principal,impersonation};
  return { response: null, user, principal, impersonation };
}

export function hasCapability(user: PilotUser, capability: FormaCapability, scope?: { organizationId?: string | null; projectAccessId?: string | null }) {
  return principalHasCapability(user.access, capability, scope);
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

export function requireConsent(user: PilotUser) {
  return user.consentVersion === POLICY_VERSION ? null : Response.json({ error: "pilot_terms_required", policyVersion: POLICY_VERSION }, { status: 428 });
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
type BudgetReservationRow = { reservation_id: string; owner_id: string; stream_id: string; correlation_id: string; operation: string; period: string; reserved_tokens: number; used_tokens: number; status: string; settlement_reason: string | null; created_at: string; settled_at: string | null; updated_at: string };
export type ProjectBudgetScope={organizationId:string;projectAccessId:string;actorUserId:string};
/** Internal SQL capability; never accept this guard from request JSON. */
export type BudgetReservationGuard={sql:string;bindings:Array<string|number|null>};
async function budgetReservationAdmitted(env:WorkerEnv,guard:BudgetReservationGuard|undefined){return !guard||Boolean(await env.DB.prepare(`SELECT 1 AS admitted WHERE ${guard.sql}`).bind(...guard.bindings).first());}
type BudgetReservationContext = { streamId?: string; correlationId?: string; operation?: string; period?: string; createdAt?: string;reservationId?:string;projectScope?:ProjectBudgetScope;reservationGuard?:BudgetReservationGuard };

const activeProjectBillingSql=`EXISTS(SELECT 1 FROM organization_projects project
  JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
  JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
  JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id
    AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
  LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id AND project_member.project_id=project.project_id
    AND project_member.user_id=? AND project_member.status='active' AND project_member.revoked_at IS NULL
  WHERE project.project_access_id=? AND project.organization_id=? AND project.status='active' AND (project.owner_user_id=? OR project_member.role IN('owner','editor')))`;

async function projectBudgetPolicy(env:WorkerEnv,userId:string,scope:ProjectBudgetScope){
  if(!scope.organizationId||!scope.projectAccessId||scope.actorUserId!==userId)return null;
  return env.DB.prepare(`SELECT token_limit,microusd_limit FROM budget_scope_policies
    WHERE scope='workspace' AND scope_id=? AND organization_id=? AND ${activeProjectBillingSql}`)
    .bind(scope.organizationId,scope.organizationId,userId,userId,scope.projectAccessId,scope.organizationId,userId)
    .first<{token_limit:number;microusd_limit:number}>();
}

async function ensureBudgetRow(env: WorkerEnv, scope: "user" | "workspace", scopeId: string, limit: number,reservationPeriod=period()) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO budget_counters (scope,scope_id,period,used_tokens,reserved_tokens,hard_limit_tokens,updated_at)
    VALUES (?,?,?,0,0,?,?) ON CONFLICT(scope,scope_id,period) DO UPDATE
    SET hard_limit_tokens=excluded.hard_limit_tokens,updated_at=excluded.updated_at
    WHERE budget_counters.hard_limit_tokens IS NOT excluded.hard_limit_tokens`)
    .bind(scope, scopeId, reservationPeriod, limit, now).run();
}

export async function readBudgets(env: WorkerEnv, userId: string) {
  const limits = budgetLimits(env);
  const currentPeriod = period();
  const select = () => env.DB.prepare("SELECT scope,used_tokens,reserved_tokens,hard_limit_tokens FROM budget_counters WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma'))").bind(currentPeriod, userId);
  let rows = (await select().all<Record<string, unknown>>()).results;
  const userRow = rows.find((row) => row.scope === "user");
  const workspaceRow = rows.find((row) => row.scope === "workspace");
  if (!userRow || !workspaceRow || Number(userRow.hard_limit_tokens) !== limits.user || Number(workspaceRow.hard_limit_tokens) !== limits.workspace) {
    const now = new Date().toISOString();
    const upsert = (scope: "user" | "workspace", scopeId: string, limit: number) => env.DB.prepare(`INSERT INTO budget_counters (scope,scope_id,period,used_tokens,reserved_tokens,hard_limit_tokens,updated_at)
      VALUES (?,?,?,0,0,?,?) ON CONFLICT(scope,scope_id,period) DO UPDATE
      SET hard_limit_tokens=excluded.hard_limit_tokens,updated_at=excluded.updated_at
      WHERE budget_counters.hard_limit_tokens IS NOT excluded.hard_limit_tokens`).bind(scope, scopeId, currentPeriod, limit, now);
    const result = await env.DB.batch<Record<string, unknown>>([
      upsert("user", userId, limits.user),
      upsert("workspace", "forma", limits.workspace),
      select(),
    ]);
    rows = result.at(-1)?.results ?? [];
  }
  const map = Object.fromEntries(rows.map((row) => [String(row.scope), { used: Number(row.used_tokens), reserved: Number(row.reserved_tokens), limit: Number(row.hard_limit_tokens) }]));
  return { period: currentPeriod, user: map.user ?? { used: 0, reserved: 0, limit: limits.user }, workspace: map.workspace ?? { used: 0, reserved: 0, limit: limits.workspace } };
}

export async function reserveBudget(env: WorkerEnv, userId: string, tokens: number, context: BudgetReservationContext = {}) {
  const reservationGuard=context.reservationGuard;
  const amount = Math.max(0, Math.floor(tokens)); const limits = budgetLimits(env); const reservationPeriod = context.period ?? period();
  const scope=context.projectScope;
  const policy=scope?await projectBudgetPolicy(env,userId,scope):null;
  if(scope&&!policy)return{ok:false as const,scope:"workspace" as const};
  await ensureBudgetRow(env,"user",userId,limits.user,reservationPeriod);await ensureBudgetRow(env,"workspace","forma",limits.workspace,reservationPeriod);
  if(scope&&policy)await ensureBudgetRow(env,"workspace",scope.organizationId,Number(policy.token_limit),reservationPeriod);
  const reservationId=context.reservationId??uuidV7();const now=context.createdAt??new Date().toISOString();
  const scopedPredicates=scope&&policy?` AND EXISTS(SELECT 1 FROM budget_counters WHERE scope='workspace' AND scope_id=? AND period=? AND used_tokens+reserved_tokens+?<=hard_limit_tokens)
    AND EXISTS(SELECT 1 FROM budget_scope_policies WHERE scope='workspace' AND scope_id=? AND organization_id=? AND token_limit=?) AND ${activeProjectBillingSql}`:"";
  const reservationStatement=env.DB.prepare(`INSERT OR IGNORE INTO budget_reservations (reservation_id,owner_id,stream_id,correlation_id,operation,period,reserved_tokens,used_tokens,status,settlement_reason,created_at,settled_at,updated_at)
      SELECT ?,?,?,?,?,?,?,0,'authorizing',NULL,?,NULL,?
      WHERE ?>0
      AND EXISTS (SELECT 1 FROM budget_counters WHERE scope='user' AND scope_id=? AND period=? AND used_tokens+reserved_tokens+?<=hard_limit_tokens)
      AND EXISTS (SELECT 1 FROM budget_counters WHERE scope='workspace' AND scope_id='forma' AND period=? AND used_tokens+reserved_tokens+?<=hard_limit_tokens)${scopedPredicates}${reservationGuard?` AND (${reservationGuard.sql})`:""}`)
    .bind(reservationId,userId,context.streamId??"",context.correlationId??"",context.operation??"provider-operation",reservationPeriod,amount,now,now,amount,userId,reservationPeriod,amount,reservationPeriod,amount,...(scope&&policy?[scope.organizationId,reservationPeriod,amount,scope.organizationId,scope.organizationId,Number(policy.token_limit),userId,userId,scope.projectAccessId,scope.organizationId,userId]:[]),...(reservationGuard?.bindings??[]));
  const statements=[
    reservationStatement,
    env.DB.prepare("UPDATE budget_counters SET reserved_tokens=reserved_tokens+?,updated_at=? WHERE scope='user' AND scope_id=? AND period=? AND EXISTS (SELECT 1 FROM budget_reservations WHERE reservation_id=? AND status='authorizing')").bind(amount,now,userId,reservationPeriod,reservationId),
    env.DB.prepare("UPDATE budget_counters SET reserved_tokens=reserved_tokens+?,updated_at=? WHERE scope='workspace' AND scope_id='forma' AND period=? AND EXISTS (SELECT 1 FROM budget_reservations WHERE reservation_id=? AND status='authorizing')").bind(amount,now,reservationPeriod,reservationId),
  ];
  if(scope){
    statements.push(env.DB.prepare("UPDATE budget_counters SET reserved_tokens=reserved_tokens+?,updated_at=? WHERE scope='workspace' AND scope_id=? AND period=? AND EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=? AND status='authorizing')").bind(amount,now,scope.organizationId,reservationPeriod,reservationId));
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO project_budget_reservation_scopes(reservation_kind,reservation_id,organization_id,project_access_id,actor_user_id,workspace_scope_id,created_at) SELECT 'tokens',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id=? AND status='authorizing')")
      .bind(reservationId,scope.organizationId,scope.projectAccessId,userId,scope.organizationId,now,reservationId,userId));
  }
  statements.push(env.DB.prepare("UPDATE budget_reservations SET status='active',updated_at=? WHERE reservation_id=? AND owner_id=? AND status='authorizing'").bind(now,reservationId,userId));
  const results=await env.DB.batch(statements);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
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
  return env.DB.prepare("SELECT * FROM budget_reservations WHERE reservation_id=? AND owner_id=?").bind(reservationId,userId).first<BudgetReservationRow>();
}

async function adoptLegacyBudgetReservation(env: WorkerEnv, userId: string, reservationId: string, reservedTokens: number, context: BudgetReservationContext) {
  const now = new Date().toISOString(); const createdAt = context.createdAt ?? now;
  await env.DB.prepare("INSERT OR IGNORE INTO budget_reservations (reservation_id,owner_id,stream_id,correlation_id,operation,period,reserved_tokens,used_tokens,status,settlement_reason,created_at,settled_at,updated_at) VALUES (?,?,?,?,?,?,?,0,'active',NULL,?,NULL,?)")
    .bind(reservationId,userId,context.streamId??"",context.correlationId??"",context.operation??"legacy-provider-operation",context.period??createdAt.slice(0,7),Math.max(0,Math.floor(reservedTokens)),createdAt,now).run();
}

export async function settleBudget(env: WorkerEnv, userId: string, reservationId: string, used: number, reason = "provider_usage_recorded") {
  const reservation = await budgetReservation(env,userId,reservationId); if(!reservation)return{settled:false as const,reservedTokens:0,usedTokens:0,status:"missing"};
  const scope=await env.DB.prepare("SELECT organization_id,project_access_id,actor_user_id FROM project_budget_reservation_scopes WHERE reservation_kind='tokens' AND reservation_id=? AND actor_user_id=?")
    .bind(reservationId,userId).first<{organization_id:string;project_access_id:string;actor_user_id:string}>();
  const actual = Math.max(0,Math.floor(used)); const now = new Date().toISOString(); const status = actual > 0 ? "settled" : "released";
  const active = "EXISTS (SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id=? AND status='active')";
  const statements=[
    env.DB.prepare(`UPDATE budget_counters SET reserved_tokens=MAX(0,reserved_tokens-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_tokens=used_tokens+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='user' AND scope_id=? AND period=?`).bind(reservationId,userId,reservation.reserved_tokens,reservationId,userId,actual,now,userId,reservation.period),
    env.DB.prepare(`UPDATE budget_counters SET reserved_tokens=MAX(0,reserved_tokens-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_tokens=used_tokens+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='workspace' AND scope_id='forma' AND period=?`).bind(reservationId,userId,reservation.reserved_tokens,reservationId,userId,actual,now,reservation.period),
  ];
  if(scope)statements.push(env.DB.prepare(`UPDATE budget_counters SET reserved_tokens=MAX(0,reserved_tokens-(CASE WHEN ${active} THEN ? ELSE 0 END)),used_tokens=used_tokens+(CASE WHEN ${active} THEN ? ELSE 0 END),updated_at=? WHERE scope='workspace' AND scope_id=? AND period=?`).bind(reservationId,userId,reservation.reserved_tokens,reservationId,userId,actual,now,scope.organization_id,reservation.period));
  statements.push(env.DB.prepare("UPDATE budget_reservations SET used_tokens=?,status=?,settlement_reason=?,settled_at=?,updated_at=? WHERE reservation_id=? AND owner_id=? AND status='active'").bind(actual,status,reason,now,now,reservationId,userId));
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
  const active=await env.DB.prepare("SELECT * FROM budget_reservations WHERE owner_id=? AND stream_id=? AND correlation_id=? AND status='active' ORDER BY created_at").bind(billingUserId,user.streamId,correlationId).all<BudgetReservationRow>();const released=[] as Array<{id:string;tokens:number;operation:string}>;
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
  const costSettlement=ownedCost?await settleCostBudget(env,billingUserId,ownedCost.reservation_id,Math.min(ownedCost.reserved_microusd,usage.totalCostMicrousd)):null;
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

/** Repairs orphaned owner-and-stream-scoped reservations without discarding documented provider usage. */
export async function reconcileFailedBudgetReservations(env: WorkerEnv, user: PilotUser, now = Date.now()) {
  await ensureSchema(env);const cutoff=new Date(now-BUDGET_RECONCILIATION_AGE_MS).toISOString();const billingUserId=user.billingUserId??user.userId;
  const legacy=await env.DB.prepare(`SELECT reserved.event_id,reserved.correlation_id,reserved.occurred_at,
      json_extract(reserved.payload,'$.reservation_id') AS reservation_id,
      CAST(json_extract(reserved.payload,'$.reserved_tokens') AS INTEGER) AS reserved_tokens,
      COALESCE(json_extract(reserved.payload,'$.operation'),'image-generation') AS operation,
      COALESCE(json_extract(reserved.payload,'$.period'),substr(reserved.occurred_at,1,7)) AS period
    FROM events reserved
    WHERE reserved.stream_id=? AND reserved.type='BudgetReserved' AND reserved.occurred_at<=?
      AND json_extract(reserved.payload,'$.reservation_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM events terminal WHERE terminal.stream_id=reserved.stream_id AND terminal.type IN ('BudgetReleased','GenerationUsageRecorded') AND json_extract(terminal.payload,'$.reservation_id')=json_extract(reserved.payload,'$.reservation_id'))
    ORDER BY reserved.occurred_at ASC LIMIT 200`).bind(user.streamId,cutoff).all<Record<string,unknown>>();
  for(const row of legacy.results){const reservationId=String(row.reservation_id??"");const reservedTokens=Number(row.reserved_tokens??0);if(!reservationId||reservedTokens<=0)continue;await adoptLegacyBudgetReservation(env,billingUserId,reservationId,reservedTokens,{streamId:user.streamId,correlationId:String(row.correlation_id??""),operation:String(row.operation??"image-generation"),period:String(row.period??period()),createdAt:String(row.occurred_at??new Date(now).toISOString())});}

  const active=await env.DB.prepare(`SELECT * FROM budget_reservations reservation
    WHERE reservation.owner_id=? AND reservation.stream_id=? AND reservation.status='active' AND reservation.created_at<=?
      -- Legacy planning lacks an exact non-submission boundary, including attempt-correlated orphan holds.
      -- Only explicit proven-unused release paths may release this historical operation.
      AND reservation.operation!='adaptive-structure'
      -- Both historical assistant formats can outlive their task row; neither is proof of non-submission.
      AND reservation.operation NOT LIKE 'assistant:%' AND reservation.operation NOT LIKE 'assistant-specialist:%'
      AND reservation.correlation_id NOT LIKE 'assistant:%' AND reservation.correlation_id NOT LIKE 'assistant-specialist:%'
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

async function ensureCostBudgetRow(env: WorkerEnv, scope: "user" | "workspace", scopeId: string, limitMicrousd: number, reservationPeriod = period()) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO cost_budget_counters (scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at)
    VALUES (?,?,?,0,0,?,?) ON CONFLICT(scope,scope_id,period) DO UPDATE
    SET hard_limit_microusd=excluded.hard_limit_microusd,updated_at=excluded.updated_at
    WHERE cost_budget_counters.hard_limit_microusd IS NOT excluded.hard_limit_microusd`)
    .bind(scope, scopeId, reservationPeriod, limitMicrousd, now).run();
}

export async function readCostBudgets(env: WorkerEnv, userId: string) {
  const limits = costBudgetLimits(env);
  const currentPeriod=period();
  const select=()=>env.DB.prepare("SELECT scope,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma'))").bind(currentPeriod,userId);
  let rows=(await select().all<Record<string,unknown>>()).results;
  const userRow=rows.find((row)=>row.scope==="user"),workspaceRow=rows.find((row)=>row.scope==="workspace");
  if(!userRow||!workspaceRow||Number(userRow.hard_limit_microusd)!==limits.user||Number(workspaceRow.hard_limit_microusd)!==limits.workspace){
    const now=new Date().toISOString();
    const upsert=(scope:"user"|"workspace",scopeId:string,limit:number)=>env.DB.prepare(`INSERT INTO cost_budget_counters (scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at)
      VALUES (?,?,?,0,0,?,?) ON CONFLICT(scope,scope_id,period) DO UPDATE
      SET hard_limit_microusd=excluded.hard_limit_microusd,updated_at=excluded.updated_at
      WHERE cost_budget_counters.hard_limit_microusd IS NOT excluded.hard_limit_microusd`).bind(scope,scopeId,currentPeriod,limit,now);
    const result=await env.DB.batch<Record<string,unknown>>([upsert("user",userId,limits.user),upsert("workspace","forma",limits.workspace),select()]);
    rows=result.at(-1)?.results??[];
  }
  const map = Object.fromEntries(rows.map((row) => {
    const usedMicrousd = Number(row.used_microusd); const reservedMicrousd = Number(row.reserved_microusd); const limitMicrousd = Number(row.hard_limit_microusd);
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
    const now = new Date().toISOString();
    const tokenUpsert = (scope: "user" | "workspace", scopeId: string, limit: number) => env.DB.prepare(`
      INSERT INTO budget_counters (scope,scope_id,period,used_tokens,reserved_tokens,hard_limit_tokens,updated_at)
      VALUES (?,?,?,0,0,?,?) ON CONFLICT(scope,scope_id,period) DO UPDATE
      SET hard_limit_tokens=excluded.hard_limit_tokens,updated_at=excluded.updated_at
      WHERE budget_counters.hard_limit_tokens IS NOT excluded.hard_limit_tokens
    `).bind(scope, scopeId, currentPeriod, limit, now);
    const costUpsert = (scope: "user" | "workspace", scopeId: string, limit: number) => env.DB.prepare(`
      INSERT INTO cost_budget_counters (scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at)
      VALUES (?,?,?,0,0,?,?) ON CONFLICT(scope,scope_id,period) DO UPDATE
      SET hard_limit_microusd=excluded.hard_limit_microusd,updated_at=excluded.updated_at
      WHERE cost_budget_counters.hard_limit_microusd IS NOT excluded.hard_limit_microusd
    `).bind(scope, scopeId, currentPeriod, limit, now);
    const results = await env.DB.batch<Record<string, unknown>>([
      tokenUpsert("user",userId,tokens.user),tokenUpsert("workspace",workspaceId,workspaceTokenLimit),
      ...(organizationId?[tokenUpsert("workspace","forma",tokens.workspace)]:[]),
      costUpsert("user",userId,costs.user),costUpsert("workspace",workspaceId,workspaceCostLimit),
      ...(organizationId?[costUpsert("workspace","forma",costs.workspace)]:[]),
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
  reservationGuard?:BudgetReservationGuard;
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
export async function pilotExecutionAllowance(env:WorkerEnv,userId:string,projectScope?:ProjectBudgetScope){
  const pilot=projectScope?await env.DB.prepare(`SELECT cohort.cohort_id,cohort.organization_id,cohort.status,cohort.starts_at,cohort.ends_at,
      cohort.participant_cap_microusd,cohort.organization_cap_microusd,participant.user_id AS participant_user_id,
      participant.status AS participant_status,participant.revoked_at AS participant_revoked_at,participant.role AS participant_role
    FROM pilot_cohorts cohort LEFT JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id
      AND participant.organization_id=cohort.organization_id AND participant.user_id=?
    WHERE cohort.organization_id=? AND cohort.status IN ('active','paused','closed') ORDER BY CASE WHEN cohort.status='closed' THEN 1 ELSE 0 END,cohort.created_at DESC LIMIT 1`)
    .bind(userId,projectScope.organizationId).first<ManagedPilotBudget>():await env.DB.prepare(`SELECT cohort.cohort_id,cohort.organization_id,cohort.status,cohort.starts_at,cohort.ends_at,
      cohort.participant_cap_microusd,cohort.organization_cap_microusd,participant.user_id AS participant_user_id,
      participant.status AS participant_status,participant.revoked_at AS participant_revoked_at,participant.role AS participant_role
    FROM pilot_cohorts cohort JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id
      AND participant.organization_id=cohort.organization_id AND participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL
    WHERE cohort.status IN ('active','paused','closed') ORDER BY CASE WHEN cohort.status='closed' THEN 1 ELSE 0 END,cohort.created_at DESC LIMIT 1`)
    .bind(userId).first<ManagedPilotBudget>();
  if(!pilot)return{allowed:true as const,pilot:null};
  const now=new Date().toISOString();
  if(!projectScope||pilot.status!=="active"||pilot.starts_at>now||pilot.ends_at<=now||pilot.participant_user_id!==userId||pilot.participant_status!=="active"||pilot.participant_revoked_at||pilot.participant_role==="reviewer")
    return{allowed:false as const,pilot};
  return{allowed:true as const,pilot};
}

export async function costBudgetReservation(env: WorkerEnv, userId: string, reservationId: string) {
  if (!reservationId) return null;
  return env.DB.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?").bind(reservationId, userId).first<CostBudgetReservationRow>();
}

export async function reserveCostBudget(env: WorkerEnv, userId: string, requestedMicrousd: number, options: CostReservationOptions) {
  const reservationGuard=options.reservationGuard;
  const amount = Math.max(0, Math.floor(requestedMicrousd));
  if (!amount || amount > Math.floor(options.maximumMicrousd)) return { ok: false as const, scope: "authorization" as const };
  const limits = costBudgetLimits(env);
  const now = new Date().toISOString();
  const reservationPeriod = options.period ?? period();
  const reservationId = options.reservationId ?? uuidV7();
  const scope=options.projectScope;
  const allowance=await pilotExecutionAllowance(env,userId,scope);
  if(!allowance.allowed)return{ok:false as const,scope:"authorization" as const};
  const pilot=allowance.pilot;
  const userOverageAllowed=options.allowUserOverage&&!pilot;
  const policy=scope?await projectBudgetPolicy(env,userId,scope):null;
  if(scope&&!policy)return{ok:false as const,scope:"workspace" as const};
  const workspaceId=scope?.organizationId??"forma";
  await ensureCostBudgetRow(env, "user", userId, limits.user, reservationPeriod);
  await ensureCostBudgetRow(env, "workspace", "forma", limits.workspace, reservationPeriod);
  if(scope&&policy)await ensureCostBudgetRow(env,"workspace",scope.organizationId,Number(policy.microusd_limit),reservationPeriod);
  const userBefore = await env.DB.prepare("SELECT used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=? AND period=?").bind(userId, reservationPeriod).first<Record<string, unknown>>();
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
  const statements=[
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
  const results=await env.DB.batch(statements);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
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
  const reservation=await costBudgetReservation(env,userId,reservationId);
  if(!reservation||reservation.status!=="active")return false;
  const fixed=await env.DB.prepare("SELECT cohort_id,organization_id FROM pilot_cost_reservation_scopes WHERE reservation_id=? AND actor_user_id=?")
    .bind(reservationId,userId).first<{cohort_id:string;organization_id:string}>();
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
  await settleCostBudget(env,userId,reservationId,0,{activeOnly:true});
  return false;
}

export async function settleCostBudget(env: WorkerEnv, userId: string, reservation: string | number, usedMicrousd: number, options:{activeOnly?:boolean}={}) {
  const row = await resolveCostReservation(env, userId, reservation);
  if (!row) return { settled: false as const, reservedMicrousd: 0, usedMicrousd: 0, status: "missing" as const };
  if(options.activeOnly&&row.status!=="active")return{settled:false as const,reservedMicrousd:row.reserved_microusd,usedMicrousd:row.used_microusd,status:row.status};
  let fixed:{cohort_id:string;organization_id:string;actor_user_id:string}|null=null;
  if(row.workspace_id!=="forma"){
    const scoped=await env.DB.prepare("SELECT 1 AS valid FROM project_budget_reservation_scopes WHERE reservation_kind='usd' AND reservation_id=? AND organization_id=? AND workspace_scope_id=? AND actor_user_id=?")
      .bind(row.reservation_id,row.workspace_id,row.workspace_id,userId).first();
    if(!scoped)return{settled:false as const,reservedMicrousd:0,usedMicrousd:0,status:"missing" as const};
    fixed=await env.DB.prepare("SELECT cohort_id,organization_id,actor_user_id FROM pilot_cost_reservation_scopes WHERE reservation_id=? AND organization_id=? AND actor_user_id=?")
      .bind(row.reservation_id,row.workspace_id,userId).first<{cohort_id:string;organization_id:string;actor_user_id:string}>();
  }
  const now = new Date().toISOString();
  const used = Math.max(0, Math.floor(usedMicrousd));
  const status = used > 0 ? "settled" : "released";
  const allowedStatus=options.activeOnly?"status='active'":"status IN ('active','executing')";
  const active = `EXISTS (SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=? AND ${allowedStatus})`;
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
  statements.push(env.DB.prepare(`UPDATE cost_budget_reservations SET used_microusd=?,status=?,settled_at=?,updated_at=? WHERE reservation_id=? AND owner_id=? AND ${allowedStatus}`).bind(used,status,now,now,row.reservation_id,userId));
  const results=await env.DB.batch(statements);
  const settled=Number(results.at(-1)?.meta.changes??0)===1;
  return { settled, reservationId: row.reservation_id, reservedMicrousd: row.reserved_microusd, usedMicrousd: settled ? used : row.used_microusd, period: row.period, status: settled ? status : row.status };
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
    AND NOT EXISTS (SELECT 1 FROM cost_budget_reservations WHERE owner_id=? AND stream_id=? AND correlation_id=? AND status IN ('active','executing'))`)
    .bind(input.reservationId,userId,input.streamId,input.correlationId,input.operation,input.period,amount,now,now,userId,input.period,amount,input.period,amount,userId,input.streamId,input.correlationId).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function releaseCostReservationsForCorrelation(env: WorkerEnv, userId: string, correlationId: string, streamId: string) {
  const active = await env.DB.prepare("SELECT reservation_id FROM cost_budget_reservations WHERE owner_id=? AND stream_id=? AND correlation_id=? AND status IN ('active','executing')").bind(userId, streamId, correlationId).all<{ reservation_id: string }>();
  for (const row of active.results) await releaseCostBudget(env, userId, row.reservation_id);
  return active.results.length;
}

export const DURABLE_WORK_RETENTION_END = "9999-12-31T23:59:59.999Z";
export const DEFAULT_EVIDENCE_RETENTION_DAYS = 365;

type PrivateContentKind = "prompt" | "provider-output" | "provider-response" | "intent" | "condition" | "critique" | "adaptive-intent" | "adaptive-structure" | "chat-user" | "chat-assistant" | "ideation-prompt" | "document-artifact" | "document-artifact-input" | "activity-issue-note" | "execution-consent" | "context-proposal" | "authoring-preview";

export function privateContentRetentionClass(kind: PrivateContentKind): "durable-work" | "governed-evidence" | "transient-private" {
  return kind === "document-artifact" ? "durable-work" : ["document-artifact-input","activity-issue-note","execution-consent","context-proposal","authoring-preview"].includes(kind) ? "governed-evidence" : "transient-private";
}

export async function storePrivateContent(env: WorkerEnv, ownerId: string, kind: PrivateContentKind, content: string, projectScope?: ProjectExecutionScope,guard?:BudgetReservationGuard,publish?:(stored:{contentId:string;expiresAt:string})=>Array<ReturnType<WorkerEnv["DB"]["prepare"]>>) {
  if(projectScope&&projectScope.actorUserId!==ownerId)throw new Error("project_private_content_actor_mismatch");
  const policy=projectScope?await env.DB.prepare("SELECT transient_days,evidence_days,version FROM organization_retention_policies WHERE organization_id=?")
    .bind(projectScope.organizationId).first<{transient_days:number;evidence_days:number;version:number}>():null;
  const contentId = uuidV7(); const createdAt = new Date(); const category=privateContentRetentionClass(kind);
  const days=category==="governed-evidence"?Number(policy?.evidence_days??Math.max(1,Math.min(3650,intEnv(env.FORMA_EVIDENCE_RETENTION_DAYS,DEFAULT_EVIDENCE_RETENTION_DAYS)))):Number(policy?.transient_days??intEnv(env.FORMA_RETENTION_DAYS,30));
  const expiresAt=category==="durable-work"?new Date(DURABLE_WORK_RETENTION_END):new Date(createdAt.getTime()+days*86_400_000);
  const now=createdAt.toISOString();
  const statements=projectScope?[
    env.DB.prepare(`INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at)
      SELECT ?,?,?,?,?,?,NULL WHERE ${activeProjectBillingSql}
        AND EXISTS(SELECT 1 FROM organization_projects WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=? AND status='active')
        AND ((?=0 AND NOT EXISTS(SELECT 1 FROM organization_retention_policies current_policy WHERE current_policy.organization_id=?))
          OR EXISTS(SELECT 1 FROM organization_retention_policies current_policy WHERE current_policy.organization_id=? AND current_policy.version=?))${guard?` AND (${guard.sql})`:""}`)
      .bind(contentId,ownerId,kind,content,now,expiresAt.toISOString(),ownerId,ownerId,projectScope.projectAccessId,projectScope.organizationId,ownerId,projectScope.projectAccessId,projectScope.organizationId,projectScope.projectId,projectScope.ownerUserId,Number(policy?.version??0),projectScope.organizationId,projectScope.organizationId,Number(policy?.version??0),...(guard?.bindings??[])),
    env.DB.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
      SELECT ?,'content',?,?,?,?,'actor_private',NULL,?,? WHERE EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)`)
      .bind(projectScope.projectAccessId,contentId,projectScope.organizationId,projectScope.projectId,projectScope.ownerUserId,ownerId,now,contentId,ownerId),
    env.DB.prepare(`INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.project_access_id=? AND resource.organization_id=?
        AND resource.project_id=? AND resource.resource_kind='content' AND resource.resource_id=? AND resource.actor_user_id=?)`)
      .bind(contentId,projectScope.organizationId,projectScope.projectAccessId,projectScope.projectId,ownerId,category,Number(policy?.version??0),expiresAt.toISOString(),now,projectScope.projectAccessId,projectScope.organizationId,projectScope.projectId,contentId,ownerId),
  ]:[env.DB.prepare(`INSERT INTO private_content (content_id,owner_id,kind,content,created_at,expires_at,redacted_at) ${guard?`SELECT ?,?,?,?,?,?,NULL WHERE ${guard.sql}`:"VALUES (?,?,?,?,?,?,NULL)"}`).bind(contentId,ownerId,kind,content,now,expiresAt.toISOString(),...(guard?.bindings??[]))];
  statements.push(projectScope?env.DB.prepare(`UPDATE private_content SET content='',redacted_at=? WHERE owner_id=? AND redacted_at IS NULL AND kind!='document-artifact' AND expires_at<=?
    AND EXISTS(SELECT 1 FROM private_content_retention_scopes governed WHERE governed.content_id=private_content.content_id AND governed.organization_id=?)
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes governed JOIN organization_retention_policies policy ON policy.organization_id=governed.organization_id AND policy.legal_hold=1
      WHERE governed.content_id=private_content.content_id AND governed.classification='governed-evidence')
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes governed JOIN organization_legal_holds hold
      ON hold.organization_id=governed.organization_id AND hold.status='active'
      WHERE governed.content_id=private_content.content_id
        AND(hold.scope_kind='organization'
          OR hold.scope_kind='project' AND hold.resource_id=governed.project_access_id
          OR hold.scope_kind='content' AND hold.resource_id=governed.content_id))
    AND EXISTS(SELECT 1 FROM private_content inserted WHERE inserted.content_id=? AND inserted.owner_id=?)`)
    .bind(now,ownerId,now,projectScope.organizationId,contentId,ownerId):env.DB.prepare(`UPDATE private_content SET content='',redacted_at=? WHERE owner_id=? AND redacted_at IS NULL AND kind!='document-artifact' AND expires_at<=?
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id)`)
    .bind(now,ownerId,now));
  const publicationOffset=statements.length,publications=publish?.({contentId,expiresAt:expiresAt.toISOString()})??[];
  statements.push(...publications);
  const results=await env.DB.batch(statements);
  if(Number(results[0]?.meta.changes??0)!==1||projectScope&&(Number(results[1]?.meta.changes??0)!==1||Number(results[2]?.meta.changes??0)!==1))throw new Error("project_private_content_access_revoked");
  if(publications.some((_,index)=>Number(results[publicationOffset+index]?.meta.changes??0)!==1))throw new Error("private_content_publication_unavailable");
  return { contentId, expiresAt: expiresAt.toISOString() };
}

/** Reused by private reads and atomic recovery writes; the caller also binds exact retention/bytes. */
export function privateContentScopeGuard(ownerId:string,projectScope?:ProjectExecutionScope){
  if(projectScope&&projectScope.actorUserId!==ownerId)return{sql:"0",bindings:[] as string[]};
  const containment=projectScope?` AND EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id
    AND resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=? AND resource.owner_user_id=? AND resource.actor_user_id=? AND resource.visibility='actor_private'
    AND(private_content.kind NOT IN('chat-user','chat-assistant') OR EXISTS(SELECT 1 FROM private_content_retention_scopes retention
      WHERE retention.content_id=private_content.content_id AND retention.organization_id=resource.organization_id
        AND retention.project_access_id=resource.project_access_id AND retention.project_id=resource.project_id
        AND retention.actor_user_id=resource.actor_user_id))) AND ${activeProjectBillingSql}`:
    " AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id AND resource.actor_user_id=private_content.owner_id AND resource.owner_user_id!=private_content.owner_id AND resource.visibility='actor_private')"
    + " AND(private_content.kind NOT IN('chat-user','chat-assistant') OR NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=private_content.content_id))";
  return{sql:containment.replace(/^ AND /u,""),bindings:projectScope?[projectScope.projectAccessId,projectScope.organizationId,projectScope.projectId,projectScope.ownerUserId,ownerId,ownerId,ownerId,projectScope.projectAccessId,projectScope.organizationId,ownerId]:[]};
}

export async function loadPrivateContent(env: WorkerEnv, ownerId: string, scope: "all" | "chat" | "memory" = "all", projectScope?: ProjectExecutionScope) {
  const now = new Date().toISOString(),guard=privateContentScopeGuard(ownerId,projectScope);
  const restricted = scope === "chat" ? " AND kind IN ('chat-user','chat-assistant')" : scope === "memory" ? " AND kind='condition'" : "";
  const rows=await env.DB.prepare(`SELECT content_id,content FROM private_content WHERE owner_id=? AND redacted_at IS NULL AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND kind NOT IN('provider-response','activity-issue-note','execution-consent','context-proposal','authoring-preview')${restricted} AND ${guard.sql}`).bind(ownerId,now,...guard.bindings).all<{content_id:string;content:string}>();
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

export async function handleSession(request: Request, env: WorkerEnv, _context?: WorkerExecutionContext) {
  void _context;
  const auth = await requireUser(request, env); if (auth.response || !auth.user) return auth.response!; const user = auth.user;
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
    const capabilities=principal.access.capabilities.filter((capability)=>allowed.has(capability));
    const access={role:principal.role,capabilities:principal.access.capabilities,canvasAccess:principal.access.canvasAccess};
    const availableApplications=APPLICATIONS.filter((application)=>application.id==="creative"||application.id==="canvas"&&principal.access.canvasAccess||application.requiredCapabilities.some((capability)=>principal.access.capabilities.includes(capability)))
      .map((application)=>({id:application.id,href:authorizedApplicationHome(application.id,access)}));
    const assistant=principal.consentVersion===POLICY_VERSION
      ?{enabled:true as const,host:"platform" as const,phase:"read-only" as const}:null;
    return Response.json({user:publicUser(principal),audience,capabilities,availableApplications,permissionEpoch:principal.access.permissionEpoch,organizations:[],canvas:{access:principal.access.canvasAccess},impersonation:null,...(assistant?{assistant}:{})},{headers:{"cache-control":"private, no-store"}});
  }
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
  const selectedImageProvider=env.FORMA_IMAGE_PROVIDER??"openai";
  const provider={name:"Approved creative generation",model:env.OPENAI_IMAGE_MODEL??"gpt-image-2",plannerModel:env.OPENAI_MODEL??"gpt-5.6-terra",plannerConfigured:Boolean(env.OPENAI_API_KEY),configured:Boolean(env.OPENAI_API_KEY&&(!["fal","fal-ideogram","ideogram"].includes(selectedImageProvider)||env.FAL_KEY)),videoModel:env.FAL_VIDEO_MODEL??DEFAULT_VIDEO_MODEL,videoReferenceModel:env.FAL_REFERENCE_VIDEO_MODEL??DEFAULT_REFERENCE_VIDEO_MODEL,videoConfigured:Boolean(env.OPENAI_API_KEY&&env.FAL_KEY),audioModel:env.FAL_AUDIO_MODEL??"fal-ai/lyria3/pro",audioConfigured:Boolean(env.OPENAI_API_KEY&&env.FAL_KEY&&(!env.FORMA_AUDIO_PROVIDER||env.FORMA_AUDIO_PROVIDER==="fal")&&(!env.FAL_AUDIO_MODEL||audioAdapterContractForModel(env.FAL_AUDIO_MODEL))),audioModels:AUDIO_ADAPTER_CONTRACTS.map((contract)=>({model:contract.model,label:contract.label,capabilities:contract.capabilities,maximumDurationSeconds:contract.maximumAdvertisedDurationSeconds,pricing:contract.pricing})),...(privileged?{name:"OpenAI Responses · OpenAI + Fal image adapters · Fal video and audio specialists",imageProvider:selectedImageProvider,imageProviders:[{provider:"openai",model:env.OPENAI_IMAGE_MODEL??"gpt-image-2",configured:Boolean(env.OPENAI_API_KEY)},{provider:"fal",model:env.FAL_IMAGE_MODEL??"ideogram/v4",previewModel:env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast",editModel:env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image",configured:Boolean(env.FAL_KEY)}],videoProvider:env.FORMA_VIDEO_PROVIDER??"fal",audioProvider:env.FORMA_AUDIO_PROVIDER??"fal",videoAdapterVersion:VIDEO_ADAPTER_CONTRACT.adapterVersion,videoApiSunset:null}:{})};
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
