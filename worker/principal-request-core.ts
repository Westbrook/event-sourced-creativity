import { PRINCIPAL_WITH_ACCESS_SQL, principalAccessFromRow, principalHasCapability } from "./access-policy.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { PilotRole, PilotUser, PilotImpersonation } from "./pilot-policy.ts";
import type { FormaCapability } from "../src/platform/capabilities.ts";

const roleRank: Record<PilotRole, number> = { viewer: 0, agent: 1, creator: 2, admin: 3 };

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

const impersonationMutationExempt=(request:Request)=>{const url=new URL(request.url);if(["GET","HEAD","OPTIONS"].includes(request.method))return true;if(url.pathname.startsWith("/api/impersonation")||url.pathname.startsWith("/api/replay-sessions")||url.pathname.startsWith("/api/admin/")||url.pathname==="/api/session")return true;return /^\/api\/document-jobs\/[^/]+\/(?:run|ack)$/.test(url.pathname);};

async function activeImpersonation(request:Request,env:WorkerEnv,actor:PilotUser):Promise<PilotImpersonation|null>{
  const id=decodedCookieValue(request,"forma_impersonation");if(!id)return null;const row=await env.DB.prepare(`SELECT impersonation.*,persona.display_name,fictional.email,fictional.role AS fictional_role,fictional.consent_version,fictional.consented_at
    FROM impersonation_sessions impersonation JOIN replay_personas persona ON persona.persona_id=impersonation.persona_id JOIN users fictional ON fictional.user_id=impersonation.fictional_user_id
    WHERE impersonation.impersonation_id=? AND impersonation.actor_user_id=? AND impersonation.status='active' AND impersonation.expires_at>? AND persona.status='ready'`).bind(id,actor.userId,new Date().toISOString()).first<Record<string,unknown>>();
  if(!row)return null;const fictionalUser:PilotUser={userId:String(row.fictional_user_id),email:String(row.email),displayName:String(row.display_name),role:String(row.fictional_role??"creator") as PilotRole,consentVersion:row.consent_version?String(row.consent_version):null,consentedAt:row.consented_at?String(row.consented_at):null,streamId:`creative:${String(row.fictional_user_id)}`,access:await principalAccessFromRow({updated_at:row.updated_at??""},"creator"),fictional:true,billingUserId:actor.userId};
  return{impersonationId:String(row.impersonation_id),personaId:String(row.persona_id),replaySessionId:String(row.replay_session_id),actor,fictionalUser,startedAt:String(row.started_at),expiresAt:String(row.expires_at)};
}

type PrincipalRequestIdentity = NonNullable<ReturnType<typeof identityFromRequest>>;
  type AdmittedPilotParticipant={participant_id:string;user_id:string|null;cohort_id:string;participant_cap_microusd:number};
export type PrincipalLifecycleRequired = {
  kind: "lifecycle-required";
  reason: "missing-account" | "profile-update" | "participant-link";
  identity: PrincipalRequestIdentity;
  row: Record<string, unknown> | null;
  admittedParticipant: AdmittedPilotParticipant | null;
};

/** Completion of the actual observed row; not a request-authorization entry point. */
export async function completePrincipalRequest(request: Request, env: WorkerEnv, identity: PrincipalRequestIdentity,
  row: Record<string, unknown> | null, minimum: PilotRole, options: { account?: "effective" | "principal" }) {
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

export type PrincipalAuthorizationResult = Awaited<ReturnType<typeof completePrincipalRequest>> | { response: Response; user: null };
export type ExistingPrincipalRequestResult = PrincipalAuthorizationResult | PrincipalLifecycleRequired;

/** Existing-account production path. Lifecycle continuations are internal and never authorization success. */
export async function readExistingPrincipalRequest(request: Request, env: WorkerEnv, minimum: PilotRole = "viewer", options:{account?:"effective"|"principal"}={}): Promise<ExistingPrincipalRequestResult> {
  const identity = identityFromRequest(request);
  if (!identity) return { response: Response.json({ error: "authentication_required" }, { status: 401 }), user: null };
  const restrictedCohort=env.FORMA_PILOT_COHORT_ID?.trim()??"";
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
  if (!row) return { kind: "lifecycle-required", reason: "missing-account", identity, row, admittedParticipant } satisfies PrincipalLifecycleRequired;
  {
    const observed = { email: identity.email, source: identity.source, subject: identity.userId };
    const access = await principalAccessFromRow(row, String(row.role), observed);
    if (access.identityPolicyDeniedCustody || row.email !== identity.email && access.deniedOrganizationIds?.length) {
      return { response: Response.json({ error: "organization_identity_policy_required" }, { status: 403 }), user: null, principal: null, impersonation: null };
    }
  }
  if (row.email !== identity.email || row.display_name !== identity.displayName)
    return { kind: "lifecycle-required", reason: "profile-update", identity, row, admittedParticipant } satisfies PrincipalLifecycleRequired;
  if(admittedParticipant&&!admittedParticipant.user_id)
    return { kind: "lifecycle-required", reason: "participant-link", identity, row, admittedParticipant } satisfies PrincipalLifecycleRequired;
  return completePrincipalRequest(request, env, identity, row, minimum, options);
}

export function hasCapability(user: PilotUser, capability: FormaCapability, scope?: { organizationId?: string | null; projectAccessId?: string | null }) {
  return principalHasCapability(user.access, capability, scope);
}

export function requireConsent(user: PilotUser) {
  return user.consentVersion === POLICY_VERSION ? null : Response.json({ error: "pilot_terms_required", policyVersion: POLICY_VERSION }, { status: 428 });
}

export { identityFromRequest, decodedCookieValue, roleRank };
