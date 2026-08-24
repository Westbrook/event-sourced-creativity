import { POLICY_VERSION, hasCapability, requireConsent, requireUser, type PilotUser } from "./pilot-policy.ts";
import { uuidV7, type WorkerEnv } from "./runtime.ts";
import { appendProjectEvents, projectContextCookie, readProjectEventPage, readProjectRequestContext, recordOrganizationAudit, synchronizeProjectScope, type ProjectRequestContext } from "./project-access.ts";
import { cancelProjectActorJobs } from "./document-jobs-api.ts";
import { handleContextPackages } from "./context-packages-api.ts";
import { handleProjectAutomation, handleReviewInbox } from "./review-automation-api.ts";
import { handleDeletionReceipts, handleEnterprise } from "./enterprise-api.ts";
import { effectivePilotParticipantSql, effectivePilotReviewerSql } from "./access-policy.ts";

const safeName = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 100) : "";
const validEmail=(value:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&value.length<=254;
const sha256=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),(byte)=>byte.toString(16).padStart(2,"0")).join("");
const sameOrigin=(request:Request)=>{const origin=request.headers.get("origin");return!origin||origin===new URL(request.url).origin;};
const workspaceDenied=()=>Response.json({error:"access_denied"},{status:403});
const workspaceMutation=(request:Request)=>["POST","PATCH","PUT","DELETE"].includes(request.method);
const period=()=>new Date().toISOString().slice(0,7);
const ownerRole=(actor:PilotUser)=>actor.role==="creator"||actor.role==="admin";
const authenticationSource=(request:Request)=>request.headers.get("oai-authenticated-user-id")&&request.headers.get("oai-authenticated-user-email")?"openai-workspace":request.headers.get("cf-access-authenticated-user-email")?"cloudflare-access":"local-development";
const identityPolicyGuard=`NOT EXISTS(SELECT 1 FROM organization_security_policies security WHERE security.organization_id=? AND (
  security.require_mfa<>0 OR (security.authentication_source!='any' AND security.authentication_source<>?)
  OR NOT json_valid(security.allowed_domains_json)
  OR json_array_length(security.allowed_domains_json)>0 AND NOT EXISTS(SELECT 1 FROM json_each(security.allowed_domains_json) permitted
    WHERE lower(CAST(permitted.value AS TEXT))=lower(substr(?,instr(?,'@')+1)))
))`;
const reviewerAdministratorGuard=`NOT EXISTS(SELECT 1 FROM pilot_cohorts reviewer_cohort
  JOIN pilot_participants reviewer ON reviewer.cohort_id=reviewer_cohort.cohort_id AND reviewer.organization_id=reviewer_cohort.organization_id
  WHERE reviewer_cohort.organization_id=? AND reviewer_cohort.status IN('active','paused','closed')
    AND(reviewer_cohort.status!='closed' OR NOT EXISTS(SELECT 1 FROM pilot_cohorts successor
      WHERE successor.organization_id=reviewer_cohort.organization_id AND successor.status IN('active','paused')))
    AND reviewer.role='reviewer'
    AND reviewer.status='active' AND reviewer.revoked_at IS NULL AND(reviewer.user_id=? OR reviewer.email_normalized=?))`;
async function organizationEmailAllowed(env:WorkerEnv,organizationId:string,email:string,source?:string){
  const security=await env.DB.prepare("SELECT authentication_source,allowed_domains_json,require_mfa FROM organization_security_policies WHERE organization_id=?").bind(organizationId).first<{authentication_source:string;allowed_domains_json:string;require_mfa:number}>();
  if(!security)return true;
  if(security.require_mfa||source&&security.authentication_source!=="any"&&security.authentication_source!==source)return false;
  try{const domains=JSON.parse(security.allowed_domains_json) as unknown;return Array.isArray(domains)&&(!domains.length||domains.includes(email.toLowerCase().split("@").at(-1)));}
  catch{return false;}
}
const scopedProjectNameSql=`COALESCE((SELECT CASE event.type WHEN 'ProjectRenamed' THEN json_extract(COALESCE(secret.private_json,event.payload),'$.new_name') ELSE json_extract(COALESCE(secret.private_json,event.payload),'$.name') END
  FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
  LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
  WHERE scope.project_access_id=project.project_access_id AND scope.organization_id=project.organization_id
    AND event.type IN ('ProjectCreated','ProjectRenamed') ORDER BY scope.project_sequence DESC LIMIT 1),'') AS project_name`;

/** Exact customer workspaces never grant another account, tenant, provider, or platform capability. */
export async function handleWorkspaces(request: Request, env: WorkerEnv, path: string[]) {
  const authorization = await requireUser(request, env, "viewer", { account: "principal" });
  if (authorization.response || !authorization.user) return authorization.response!;
  const actor = authorization.user;
  if(workspaceMutation(request)){const denied=requireConsent(actor);if(denied)return denied;}
  if(workspaceMutation(request)&&!sameOrigin(request))return Response.json({error:"same_origin_required"},{status:403});

  if (!path.length && request.method === "GET") {
    const now=new Date().toISOString();
    const invitations=await env.DB.prepare(`SELECT invitation.invitation_id AS membership_id,invitation.invitation_id,organization.organization_id,organization.name,invitation.role,invitation.created_at,invitation.expires_at
      FROM organization_invitations invitation JOIN organizations organization ON organization.organization_id=invitation.organization_id
      WHERE invitation.email_normalized=? AND invitation.status='pending' AND invitation.revoked_at IS NULL AND invitation.expires_at>? AND organization.status='active'
      UNION SELECT membership.membership_id,membership.membership_id,organization.organization_id,organization.name,membership.role,membership.created_at,NULL
      FROM organization_memberships membership JOIN organizations organization ON organization.organization_id=membership.organization_id
      WHERE membership.user_id=? AND membership.status='pending' AND membership.revoked_at IS NULL AND organization.status='active'
        AND NOT EXISTS(SELECT 1 FROM organization_invitations invitation WHERE invitation.invitation_id=membership.membership_id)
      ORDER BY 6 DESC LIMIT 50`).bind(actor.email.toLowerCase(),now,actor.userId).all();
    const blocked=await env.DB.prepare(`SELECT cohort.organization_id FROM pilot_cohorts cohort JOIN organization_memberships member
      ON member.organization_id=cohort.organization_id AND member.user_id=? AND member.status='active'
      WHERE cohort.status IN ('active','paused','closed')
        AND (cohort.status!='closed' OR NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=cohort.organization_id AND successor.status IN ('active','paused')))
        AND NOT EXISTS(SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id
        AND participant.organization_id=cohort.organization_id AND participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL)`)
      .bind(actor.userId,actor.userId).all<{organization_id:string}>();
    const unavailable=new Set(blocked.results.map((row)=>row.organization_id));
    const organizations=actor.access.organizations.filter((organization)=>!unavailable.has(organization.organizationId)).map((organization)=>({...organization,permissions:actor.access.capabilities.filter((capability)=>capability.startsWith("workspace.")&&hasCapability(actor,capability,{organizationId:organization.organizationId}))}));
    return Response.json({organizations,projects:actor.access.projects.filter((project)=>!unavailable.has(project.organizationId)),invitations:invitations.results,projectCollaboration:"project-scoped"});
  }

  if (!path.length && request.method === "POST") {
    if(!ownerRole(actor))return workspaceDenied();
    const body = await request.json().catch(() => ({})) as { name?: string };
    const name = safeName(body.name);
    if (!name) return Response.json({ error: "organization_name_required" }, { status: 400 });
    const organizationId = uuidV7();
    const membershipId = uuidV7();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO organizations (organization_id,name,owner_user_id,status,created_at,updated_at) VALUES (?,? ,?,'active',?,?)").bind(organizationId, name, actor.userId, now, now),
      env.DB.prepare("INSERT INTO organization_memberships (membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at,revoked_at) VALUES (?,?,?,'owner','active',?,?,?,?,NULL)").bind(membershipId, organizationId, actor.userId, actor.userId, now, now, now),
      env.DB.prepare("INSERT INTO budget_scope_policies(scope,scope_id,organization_id,token_limit,microusd_limit,updated_by_user_id,updated_at) VALUES('workspace',?,?,?,?,?,?)")
        .bind(organizationId,organizationId,100_000_000,1_000_000_000,actor.userId,now),
    ]);
    await recordOrganizationAudit(env,organizationId,actor,"OrganizationCreated","organization",organizationId);
    return Response.json({ organizationId, name, role: "owner" }, { status: 201 });
  }

  if(path.length===1&&path[0]==="context"&&request.method==="DELETE"){
    const now=new Date().toISOString();
    await env.DB.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE principal_user_id=? AND revoked_at IS NULL").bind(now,actor.userId).run();
    return Response.json({ok:true},{headers:{"set-cookie":projectContextCookie(request,"",0)}});
  }

  if(path.length===1&&path[0]==="reviews"&&request.method==="GET")return handleReviewInbox(env,actor);
  if(path.length===1&&path[0]==="deletions"&&request.method==="GET")return handleDeletionReceipts(env,actor);

  const organizationId = path[0] ?? "";
  const membership = actor.access.organizations.find((organization) => organization.organizationId === organizationId);
  const acceptance = path.length === 4 && (path[1] === "members"||path[1]==="invitations") && path[3] === "accept" && request.method === "POST";

  if (acceptance) {
    const now = new Date().toISOString();
    if(!await organizationEmailAllowed(env,organizationId,actor.email,authenticationSource(request)))return Response.json({error:"organization_identity_policy_required"},{status:403});
    const invitation=await env.DB.prepare("SELECT invitation_id,email_normalized,role,invited_by_user_id,token_hash FROM organization_invitations WHERE invitation_id=? AND organization_id=? AND status='pending' AND revoked_at IS NULL AND expires_at>?")
      .bind(path[2],organizationId,now).first<{invitation_id:string;email_normalized:string;role:string;invited_by_user_id:string;token_hash:string}>();
    if(invitation&&invitation.email_normalized!==actor.email.toLowerCase())return Response.json({error:"invitation_unavailable"},{status:403});
    if(invitation){
      const provided=await request.clone().json().catch(()=>({})) as {token?:unknown};
      if(provided.token!==undefined&&(typeof provided.token!=="string"||!provided.token||await sha256(provided.token)!==invitation.token_hash))return Response.json({error:"invitation_unavailable"},{status:403});
      const results=await env.DB.batch([
        env.DB.prepare(`UPDATE organization_invitations SET status='accepted',accepted_at=?,updated_at=? WHERE invitation_id=? AND organization_id=? AND email_normalized=? AND status='pending' AND revoked_at IS NULL AND expires_at>? AND ${identityPolicyGuard}
          AND(role!='administrator' OR ${reviewerAdministratorGuard})`)
          .bind(now,now,path[2],organizationId,actor.email.toLowerCase(),now,organizationId,authenticationSource(request),actor.email,actor.email,organizationId,actor.userId,actor.email.toLowerCase()),
        env.DB.prepare(`INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at,revoked_at)
          SELECT ?,?,?,?,'active',?,?,?, ?,NULL WHERE ${identityPolicyGuard}
            AND(?!='administrator' OR ${reviewerAdministratorGuard})
            AND EXISTS(SELECT 1 FROM organization_invitations accepted
              WHERE accepted.invitation_id=? AND accepted.organization_id=? AND accepted.email_normalized=?
                AND accepted.status='accepted' AND accepted.accepted_at=? AND accepted.revoked_at IS NULL)
          ON CONFLICT(organization_id,user_id) DO UPDATE SET membership_id=excluded.membership_id,role=excluded.role,status='active',invited_by_user_id=excluded.invited_by_user_id,accepted_at=excluded.accepted_at,created_at=excluded.created_at,updated_at=excluded.updated_at,revoked_at=NULL WHERE organization_memberships.status IN('pending','revoked')`)
          .bind(path[2],organizationId,actor.userId,invitation.role,invitation.invited_by_user_id,now,now,now,organizationId,authenticationSource(request),actor.email,actor.email,
            invitation.role,organizationId,actor.userId,actor.email.toLowerCase(),path[2],organizationId,actor.email.toLowerCase(),now),
        env.DB.prepare(`UPDATE organizations SET updated_at=? WHERE organization_id=? AND status='active'
          AND EXISTS(SELECT 1 FROM organization_invitations accepted WHERE accepted.invitation_id=?
            AND accepted.organization_id=organizations.organization_id AND accepted.status='accepted' AND accepted.accepted_at=?)
          AND EXISTS(SELECT 1 FROM organization_memberships accepted_member WHERE accepted_member.organization_id=organizations.organization_id
            AND accepted_member.user_id=? AND accepted_member.status='active' AND accepted_member.accepted_at=?)`)
          .bind(now,organizationId,path[2],now,actor.userId,now),
      ]);
      if(results.some((result)=>Number(result.meta.changes??0)!==1))return Response.json({error:"invitation_unavailable"},{status:403});
    }else{
      if(path[1]==="invitations")return Response.json({error:"invitation_unavailable"},{status:403});
      const pending=await env.DB.prepare("SELECT 1 AS present FROM organization_memberships WHERE membership_id=? AND organization_id=? AND user_id=? AND status='pending' AND revoked_at IS NULL")
        .bind(path[2],organizationId,actor.userId).first();
      if(!pending)return Response.json({error:"invitation_unavailable"},{status:403});
      const accepted=await env.DB.prepare(`UPDATE organization_memberships SET status='active',accepted_at=?,updated_at=? WHERE membership_id=? AND organization_id=? AND user_id=? AND status='pending' AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM organizations WHERE organization_id=? AND status='active') AND ${identityPolicyGuard}
        AND(role!='administrator' OR ${reviewerAdministratorGuard})`)
        .bind(now,now,path[2],organizationId,actor.userId,organizationId,organizationId,authenticationSource(request),actor.email,actor.email,
          organizationId,actor.userId,actor.email.toLowerCase()).run();
      if(Number(accepted.meta.changes??0)!==1)return Response.json({error:"invitation_unavailable"},{status:403});
    }
    const admitted=await env.DB.prepare(`SELECT participant.participant_id,cohort.cohort_id,cohort.participant_cap_microusd
      FROM pilot_cohorts cohort JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
      WHERE cohort.organization_id=? AND cohort.status IN ('active','paused') AND participant.email_normalized=?
        AND participant.status='active' AND participant.revoked_at IS NULL AND (participant.user_id IS NULL OR participant.user_id=?) LIMIT 1`)
      .bind(organizationId,actor.email.toLowerCase(),actor.userId).first<{participant_id:string;cohort_id:string;participant_cap_microusd:number}>();
    if(admitted){
      const now=new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("UPDATE pilot_participants SET user_id=? WHERE participant_id=? AND cohort_id=? AND status='active' AND revoked_at IS NULL AND (user_id IS NULL OR user_id=?)")
          .bind(actor.userId,admitted.participant_id,admitted.cohort_id,actor.userId),
        env.DB.prepare("INSERT OR IGNORE INTO cost_budget_counters(scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at) VALUES('pilot_user',?,?,0,0,?,?)")
          .bind(actor.userId,`pilot:${admitted.cohort_id}`,admitted.participant_cap_microusd,now),
      ]);
    }
    await recordOrganizationAudit(env,organizationId,actor,"OrganizationMembershipAccepted","membership",path[2]!);
    return Response.json({ ok: true });
  }

  if (!membership) return workspaceDenied();

  const excludedParticipant=await env.DB.prepare(`SELECT cohort.cohort_id FROM pilot_cohorts cohort WHERE cohort.organization_id=? AND cohort.status IN ('active','paused','closed')
    AND (cohort.status!='closed' OR NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=cohort.organization_id AND successor.status IN ('active','paused')))
    AND NOT EXISTS(SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
      AND participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL) LIMIT 1`).bind(organizationId,actor.userId).first();
  if(excludedParticipant)return workspaceDenied();

  if(path[1]!=="deletion"){
    const deleting=await env.DB.prepare("SELECT 1 AS present FROM organization_deletion_jobs WHERE organization_id=? AND status IN('pending','partial','processing') LIMIT 1")
      .bind(organizationId).first();
    if(deleting)return Response.json({error:"organization_deletion_in_progress"},{status:409});
  }

  const scope={organizationId};
  const readsMembers=hasCapability(actor,"workspace.member.read",scope);
  const managesMembers=hasCapability(actor,"workspace.member.manage",scope);
  const readsProjects=hasCapability(actor,"workspace.project.read",scope);
  const managesProjects=hasCapability(actor,"workspace.project.manage",scope);

  if(["assurance","security","holds","recovery","ownership","deletion"].includes(path[1]??""))
    return handleEnterprise(request,env,actor,organizationId,path.slice(1));
  if(path.length>=2&&path[1]==="context-packages")return handleContextPackages(request,env,actor,organizationId,path.slice(1));
  if(path.length>=4&&path[1]==="projects"&&path[3]==="automation"&&path.length<=5)
    return handleProjectAutomation(request,env,actor,organizationId,path[2]??"",path.length===5&&path[4]==="runs");

  if(path.length>=2&&path[1]==="pilot"){
    const managesPolicy=hasCapability(actor,"workspace.policy.manage",scope);
    const readsUsage=hasCapability(actor,"workspace.usage.read",scope);
    if(!managesPolicy&&!readsUsage&&!readsMembers)return workspaceDenied();
    const existing=await env.DB.prepare("SELECT * FROM pilot_cohorts WHERE organization_id=? AND status IN ('active','paused','closed') ORDER BY CASE WHEN status='closed' THEN 1 ELSE 0 END,created_at DESC LIMIT 1").bind(organizationId).first<Record<string,unknown>>();
    if(path.length===2&&request.method==="GET"){
      if(!managesPolicy&&!readsUsage)return workspaceDenied();
      if(!existing)return Response.json({organization:membership,cohort:null,participants:[],organizationBudget:null,participantBudget:null,maintenance:null});
      const pilotPeriod=`pilot:${String(existing.cohort_id)}`;
      const [participants,counters,maintenance]=await env.DB.batch([
        env.DB.prepare(`SELECT participant.participant_id,participant.email_normalized,participant.user_id,participant.role,participant.status,participant.created_at,participant.revoked_at,
          CASE WHEN ?=1 THEN counter.used_microusd ELSE NULL END AS used_microusd,CASE WHEN ?=1 THEN counter.reserved_microusd ELSE NULL END AS reserved_microusd,
          CASE WHEN ?=1 THEN counter.hard_limit_microusd ELSE NULL END AS hard_limit_microusd
          FROM pilot_participants participant LEFT JOIN cost_budget_counters counter ON counter.scope='pilot_user' AND counter.scope_id=participant.user_id AND counter.period=?
          WHERE participant.cohort_id=? AND participant.organization_id=? ORDER BY participant.created_at LIMIT 100`)
          .bind(managesPolicy?1:0,managesPolicy?1:0,managesPolicy?1:0,pilotPeriod,existing.cohort_id,organizationId),
        env.DB.prepare("SELECT scope,scope_id,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE period=? AND ((scope='pilot_org' AND scope_id=?) OR (scope='pilot_user' AND scope_id=?))").bind(pilotPeriod,String(existing.cohort_id),actor.userId),
        env.DB.prepare("SELECT status,started_at,finished_at,error_code FROM retention_sweep_runs ORDER BY started_at DESC LIMIT 1"),
      ]);
      const participantRows=participants.results as Array<Record<string,unknown>>;
      const counterRows=counters.results as Array<Record<string,unknown>>;
      const latestMaintenance=maintenance.results[0] as Record<string,unknown>|undefined;
      return Response.json({organization:membership,cohort:existing,participants:readsMembers?participantRows:participantRows.filter((participant)=>participant.user_id===actor.userId),organizationBudget:counterRows.find((counter)=>counter.scope==="pilot_org")??null,participantBudget:counterRows.find((counter)=>counter.scope==="pilot_user")??null,maintenance:latestMaintenance?{...latestMaintenance,scope:"installation"}:null});
    }
    if(path.length===2&&request.method==="POST"){
      if(!managesPolicy||!hasCapability(actor,"workspace.budget.manage",scope)||membership.role!=="owner")return workspaceDenied();
      if(existing&&existing.status!=="closed")return Response.json({error:"pilot_already_configured"},{status:409});
      const body=await request.json().catch(()=>({})) as {startsAt?:unknown;endsAt?:unknown;maxParticipants?:unknown;participantCapMicrousd?:unknown;organizationCapMicrousd?:unknown;evidenceDays?:unknown};
      const start=new Date();
      const end=new Date(start.getTime()+30*86_400_000);
      const maximum=body.maxParticipants===undefined?10:Number(body.maxParticipants);
      const participantCap=body.participantCapMicrousd===undefined?15_000_000:Number(body.participantCapMicrousd);
      const organizationCap=body.organizationCapMicrousd===undefined?150_000_000:Number(body.organizationCapMicrousd);
      const evidenceDays=body.evidenceDays===undefined?365:Number(body.evidenceDays);
      if(body.startsAt!==undefined||body.endsAt!==undefined||!Number.isSafeInteger(maximum)||maximum<2||maximum>100||!Number.isSafeInteger(participantCap)||participantCap<1||participantCap>15_000_000||!Number.isSafeInteger(organizationCap)||organizationCap<participantCap||organizationCap>150_000_000||!Number.isSafeInteger(evidenceDays)||evidenceDays<1||evidenceDays>3650)return Response.json({error:"valid_pilot_configuration_required"},{status:400});
      const cohortId=uuidV7(),participantId=uuidV7(),now=new Date().toISOString(),pilotPeriod=`pilot:${cohortId}`;
      const created=await env.DB.batch([
        env.DB.prepare(`INSERT INTO pilot_cohorts(cohort_id,organization_id,status,starts_at,ends_at,max_participants,participant_cap_microusd,organization_cap_microusd,source_classification,created_by_user_id,created_at,updated_at)
          SELECT ?,?,'active',?,?,?,?,?,'non-sensitive-licensed',?,?,? WHERE EXISTS(SELECT 1 FROM organizations WHERE organization_id=? AND status='active')
            AND NOT EXISTS(SELECT 1 FROM pilot_cohorts WHERE organization_id=? AND status IN ('active','paused'))`)
          .bind(cohortId,organizationId,start.toISOString(),end.toISOString(),maximum,participantCap,organizationCap,actor.userId,now,now,organizationId,organizationId),
        env.DB.prepare("INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,role,status,invited_by_user_id,created_at,revoked_at) SELECT ?,?,?,?,?,'owner','active',?,?,NULL WHERE EXISTS(SELECT 1 FROM pilot_cohorts WHERE cohort_id=? AND organization_id=?)")
          .bind(participantId,cohortId,organizationId,actor.email.toLowerCase(),actor.userId,actor.userId,now,cohortId,organizationId),
        env.DB.prepare("INSERT INTO cost_budget_counters(scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at) SELECT 'pilot_org',?,?,0,0,?,? WHERE EXISTS(SELECT 1 FROM pilot_cohorts WHERE cohort_id=? AND organization_id=?)")
          .bind(cohortId,pilotPeriod,organizationCap,now,cohortId,organizationId),
        env.DB.prepare("INSERT INTO cost_budget_counters(scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at) SELECT 'pilot_user',?,?,0,0,?,? WHERE EXISTS(SELECT 1 FROM pilot_participants WHERE participant_id=? AND cohort_id=?)")
          .bind(actor.userId,pilotPeriod,participantCap,now,participantId,cohortId),
        env.DB.prepare(`INSERT INTO organization_retention_policies(organization_id,transient_days,evidence_days,revision_days,legal_hold,version,updated_by_user_id,updated_at)
          SELECT ?,30,?,365,0,1,?,? WHERE EXISTS(SELECT 1 FROM pilot_cohorts WHERE cohort_id=? AND organization_id=?)
          ON CONFLICT(organization_id) DO UPDATE SET evidence_days=excluded.evidence_days,
            version=organization_retention_policies.version+1,updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at
          WHERE organization_retention_policies.evidence_days IS NOT excluded.evidence_days`)
          .bind(organizationId,evidenceDays,actor.userId,now,cohortId,organizationId),
      ]);
      if(Number(created[0]?.meta.changes??0)!==1)return Response.json({error:"pilot_already_configured"},{status:409});
      await recordOrganizationAudit(env,organizationId,actor,"PilotCohortConfigured","pilot",cohortId,{maxParticipants:maximum,participantCapMicrousd:participantCap,organizationCapMicrousd:organizationCap,evidenceDays});
      return Response.json({cohortId,organizationId,status:"active",startsAt:start.toISOString(),endsAt:end.toISOString(),maxParticipants:maximum,participantCapMicrousd:participantCap,organizationCapMicrousd:organizationCap},{status:201});
    }
    if(!existing)return Response.json({error:"pilot_not_configured"},{status:404});
    if(path.length===2&&request.method==="PATCH"){
      if(!managesPolicy)return workspaceDenied();
      if(existing.status==="closed")return Response.json({error:"pilot_closed_requires_new_cohort"},{status:409});
      const body=await request.json().catch(()=>({})) as {status?:unknown};
      if(!["active","paused","closed"].includes(String(body.status)))return Response.json({error:"valid_pilot_status_required"},{status:400});
      if(body.status==="closed"&&membership.role!=="owner")return workspaceDenied();
      const now=new Date().toISOString();
      await env.DB.prepare("UPDATE pilot_cohorts SET status=?,updated_at=? WHERE cohort_id=? AND organization_id=? AND status IN ('active','paused')")
        .bind(String(body.status),now,existing.cohort_id,organizationId).run();
      await recordOrganizationAudit(env,organizationId,actor,"PilotCohortStatusUpdated","pilot",String(existing.cohort_id),{status:String(body.status)});
      return Response.json({cohortId:existing.cohort_id,status:String(body.status)});
    }
    if(path.length===3&&path[2]==="participants"&&request.method==="GET"){
      if(!readsMembers)return workspaceDenied();
      const participants=await env.DB.prepare("SELECT participant_id,email_normalized,user_id,role,status,created_at,revoked_at FROM pilot_participants WHERE cohort_id=? AND organization_id=? ORDER BY created_at LIMIT 100")
        .bind(existing.cohort_id,organizationId).all();
      return Response.json({cohortId:existing.cohort_id,participants:participants.results});
    }
    if(path.length===3&&path[2]==="participants"&&request.method==="POST"){
      if(!managesMembers)return workspaceDenied();
      const body=await request.json().catch(()=>({})) as {email?:unknown;role?:unknown};
      const email=String(body.email??"").trim().toLowerCase();
      if(!validEmail(email))return Response.json({error:"valid_pilot_participant_email_required"},{status:400});
      const candidate=await env.DB.prepare("SELECT user_id FROM users WHERE email=?").bind(email).first<{user_id:string}>();
      const previous=await env.DB.prepare("SELECT participant_id,user_id,status FROM pilot_participants WHERE cohort_id=? AND organization_id=? AND email_normalized=?")
        .bind(existing.cohort_id,organizationId,email).first<{participant_id:string;user_id:string|null;status:string}>();
      if(previous?.status==="active")return Response.json({error:"pilot_participant_already_enrolled"},{status:409});
      if(previous?.user_id&&candidate?.user_id&&previous.user_id!==candidate.user_id)return Response.json({error:"pilot_participant_account_mismatch"},{status:409});
      const id=previous?.participant_id??uuidV7(),now=new Date().toISOString(),role=body.role==="reviewer"?"reviewer":"member",pilotPeriod=`pilot:${String(existing.cohort_id)}`;
      const participantUserId=previous?.user_id??candidate?.user_id??null;
      if(role==="reviewer"&&participantUserId){
        const administrator=await env.DB.prepare("SELECT 1 AS privileged FROM organization_memberships WHERE organization_id=? AND user_id=? AND role IN('owner','administrator') AND status='active' AND revoked_at IS NULL")
          .bind(organizationId,participantUserId).first();
        if(administrator)return Response.json({error:"pilot_reviewer_administrator_mapping_forbidden"},{status:403});
      }
      try{
        const statements=[previous?env.DB.prepare(`UPDATE pilot_participants SET user_id=COALESCE(user_id,?),role=?,status='active',revoked_at=NULL,invited_by_user_id=?
          WHERE participant_id=? AND cohort_id=? AND organization_id=? AND status='revoked' AND (user_id IS NULL OR user_id=?)
            AND EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.cohort_id=? AND cohort.organization_id=? AND cohort.status IN ('active','paused')
              AND (SELECT COUNT(*) FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id AND participant.status='active' AND participant.revoked_at IS NULL)<cohort.max_participants)
            AND(?<>'reviewer' OR NOT EXISTS(SELECT 1 FROM organization_memberships privileged
              WHERE privileged.organization_id=? AND privileged.user_id=? AND privileged.role IN('owner','administrator')
                AND privileged.status='active' AND privileged.revoked_at IS NULL))`)
          .bind(participantUserId,role,actor.userId,id,existing.cohort_id,organizationId,participantUserId,existing.cohort_id,organizationId,role,organizationId,participantUserId)
          :env.DB.prepare(`INSERT INTO pilot_participants(participant_id,cohort_id,organization_id,email_normalized,user_id,role,status,invited_by_user_id,created_at,revoked_at)
            SELECT ?,?,?,?,?,?,'active',?,?,NULL WHERE EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.cohort_id=? AND cohort.organization_id=? AND cohort.status IN ('active','paused')
              AND (SELECT COUNT(*) FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id AND participant.status='active' AND participant.revoked_at IS NULL)<cohort.max_participants)
              AND(?<>'reviewer' OR NOT EXISTS(SELECT 1 FROM organization_memberships privileged
                WHERE privileged.organization_id=? AND privileged.user_id=? AND privileged.role IN('owner','administrator')
                  AND privileged.status='active' AND privileged.revoked_at IS NULL))`)
            .bind(id,existing.cohort_id,organizationId,email,participantUserId,role,actor.userId,now,existing.cohort_id,organizationId,role,organizationId,participantUserId)];
        if(participantUserId)statements.push(env.DB.prepare("INSERT OR IGNORE INTO cost_budget_counters(scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at) SELECT 'pilot_user',?,?,0,0,?,? WHERE EXISTS(SELECT 1 FROM pilot_participants WHERE participant_id=? AND user_id=? AND status='active' AND revoked_at IS NULL)")
          .bind(participantUserId,pilotPeriod,Number(existing.participant_cap_microusd),now,id,participantUserId));
        const result=await env.DB.batch(statements);
        if(Number(result[0]?.meta.changes??0)!==1)return Response.json({error:"pilot_participant_limit_reached"},{status:409});
      }catch(error){
        if(error instanceof Error&&/UNIQUE/i.test(error.message))return Response.json({error:"pilot_participant_already_enrolled"},{status:409});
        throw error;
      }
      await recordOrganizationAudit(env,organizationId,actor,previous?"PilotParticipantReenrolled":"PilotParticipantEnrolled","participant",id,{role});
      return Response.json({participantId:id,email,role,userId:participantUserId,reenrolled:Boolean(previous)},{status:201});
    }
    if(path.length===4&&path[2]==="participants"&&request.method==="DELETE"){
      if(!managesMembers)return workspaceDenied();
      const candidate=await env.DB.prepare("SELECT participant_id,user_id,role FROM pilot_participants WHERE participant_id=? AND cohort_id=? AND organization_id=? AND status='active' AND revoked_at IS NULL")
        .bind(path[3],existing.cohort_id,organizationId).first<{participant_id:string;user_id:string|null;role:string}>();
      if(!candidate||candidate.role==="owner")return Response.json({error:"pilot_participant_unavailable"},{status:409});
      if(candidate.user_id){
        const owned=await env.DB.prepare("SELECT COUNT(*) AS count FROM organization_projects WHERE organization_id=? AND owner_user_id=? AND status IN('indexing','active')").bind(organizationId,candidate.user_id).first<{count:number}>();
        if(Number(owned?.count??0))return Response.json({error:"project_owner_transfer_required",affectedProjectCount:Number(owned?.count??0)},{status:409});
      }
      const now=new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("UPDATE pilot_participants SET status='revoked',revoked_at=? WHERE participant_id=? AND cohort_id=? AND organization_id=? AND status='active' AND revoked_at IS NULL")
          .bind(now,candidate.participant_id,existing.cohort_id,organizationId),
        env.DB.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE organization_id=? AND principal_user_id=? AND revoked_at IS NULL")
          .bind(now,organizationId,candidate.user_id??""),
        env.DB.prepare("UPDATE project_review_tasks SET status='canceled',resolved_at=?,resolved_by_user_id=? WHERE organization_id=? AND assigned_user_id=? AND status='pending'")
          .bind(now,actor.userId,organizationId,candidate.user_id??""),
        env.DB.prepare("DELETE FROM project_notifications WHERE organization_id=? AND recipient_user_id=?")
          .bind(organizationId,candidate.user_id??""),
        env.DB.prepare("UPDATE project_automation_outbox SET status='canceled' WHERE organization_id=? AND recipient_user_id=? AND status='pending'")
          .bind(organizationId,candidate.user_id??""),
      ]);
      if(candidate.user_id)await cancelProjectActorJobs(env,actor,{organizationId,actorUserId:candidate.user_id});
      await recordOrganizationAudit(env,organizationId,actor,"PilotParticipantRevoked","participant",candidate.participant_id);
      return Response.json({ok:true});
    }
    return new Response("Method not allowed",{status:405});
  }

  if(path.length===2&&path[1]==="retention"&&(request.method==="GET"||request.method==="PATCH")){
    if(!hasCapability(actor,"workspace.policy.manage",scope))return workspaceDenied();
    if(request.method==="PATCH"){
      const body=await request.json().catch(()=>({})) as {transientDays?:unknown;evidenceDays?:unknown;revisionDays?:unknown;legalHold?:unknown};
      const previous=await env.DB.prepare("SELECT transient_days,evidence_days,revision_days,legal_hold,version FROM organization_retention_policies WHERE organization_id=?").bind(organizationId).first<{transient_days:number;evidence_days:number;revision_days:number;legal_hold:number;version:number}>();
      const transient=body.transientDays===undefined?Number(previous?.transient_days??30):Number(body.transientDays);
      const evidence=body.evidenceDays===undefined?Number(previous?.evidence_days??365):Number(body.evidenceDays);
      const revisions=body.revisionDays===undefined?Number(previous?.revision_days??365):Number(body.revisionDays);
      const legalHold=body.legalHold===undefined?Boolean(previous?.legal_hold):body.legalHold;
      if(![transient,evidence,revisions].every((days)=>Number.isSafeInteger(days)&&days>=1&&days<=3650)||typeof legalHold!=="boolean")return Response.json({error:"valid_retention_policy_required"},{status:400});
      const now=new Date().toISOString();
      const changed=await env.DB.prepare(`INSERT INTO organization_retention_policies(organization_id,transient_days,evidence_days,revision_days,legal_hold,version,updated_by_user_id,updated_at)
        SELECT ?,?,?,?,?,1,?,? WHERE EXISTS(SELECT 1 FROM organizations governed
          JOIN organization_memberships authorized ON authorized.organization_id=governed.organization_id AND authorized.user_id=?
            AND authorized.role IN('owner','administrator') AND authorized.status='active'
            AND authorized.accepted_at IS NOT NULL AND authorized.revoked_at IS NULL
          JOIN users identity ON identity.user_id=authorized.user_id AND identity.consent_version=?
          WHERE governed.organization_id=? AND governed.status='active'
            AND ${effectivePilotParticipantSql("governed.organization_id","authorized.user_id")}
            AND NOT ${effectivePilotReviewerSql("governed.organization_id","authorized.user_id")})
          AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs removal
            WHERE removal.organization_id=? AND removal.status IN('pending','processing','partial','completed'))
        ON CONFLICT(organization_id) DO UPDATE SET transient_days=excluded.transient_days,evidence_days=excluded.evidence_days,
          revision_days=excluded.revision_days,legal_hold=excluded.legal_hold,version=organization_retention_policies.version+1,
          updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at`)
        .bind(organizationId,transient,evidence,revisions,legalHold?1:0,actor.userId,now,actor.userId,POLICY_VERSION,organizationId,organizationId).run();
      if(Number(changed.meta.changes??0)!==1)return Response.json({error:"organization_retention_policy_authorization_changed"},{status:409});
      await recordOrganizationAudit(env,organizationId,actor,"OrganizationRetentionPolicyUpdated","retention",organizationId,{transientDays:transient,evidenceDays:evidence,revisionDays:revisions,legalHold});
    }
    const policy=await env.DB.prepare("SELECT transient_days,evidence_days,revision_days,legal_hold,version,updated_at FROM organization_retention_policies WHERE organization_id=?").bind(organizationId).first();
    return Response.json({organization:membership,policy,appliesTo:"new-scoped-content-only"});
  }

  if (path.length === 1 && request.method === "GET") {
    if(!readsMembers&&!readsProjects&&!hasCapability(actor,"workspace.usage.read",scope)&&!hasCapability(actor,"workspace.audit.read",scope))return workspaceDenied();
    const statements=[];
    if(readsMembers)statements.push(env.DB.prepare(`SELECT membership.membership_id,membership.user_id,users.display_name,users.email,membership.role,membership.status,membership.accepted_at
        FROM organization_memberships membership JOIN users ON users.user_id=membership.user_id
        WHERE membership.organization_id=? ORDER BY membership.created_at LIMIT 50`).bind(organizationId));
    if(readsProjects)statements.push(env.DB.prepare(`SELECT project.project_access_id,project.project_id,project.owner_user_id,project.status,project.created_at,${scopedProjectNameSql} FROM organization_projects project WHERE project.organization_id=? ORDER BY project.created_at LIMIT 50`).bind(organizationId));
    if(readsMembers)statements.push(env.DB.prepare("SELECT invitation_id,email_normalized,role,status,expires_at,created_at FROM organization_invitations WHERE organization_id=? ORDER BY created_at DESC LIMIT 50").bind(organizationId));
    const results=statements.length?await env.DB.batch(statements):[];
    const members=readsMembers?results[0]?.results??[]:[];
    const projects=readsProjects?results[readsMembers?1:0]?.results??[]:[];
    const invitations=readsMembers?results[readsProjects?2:1]?.results??[]:[];
    return Response.json({organization:membership,members,projects,invitations,permissions:actor.access.capabilities.filter((capability)=>capability.startsWith("workspace.")&&hasCapability(actor,capability,scope)),projectCollaboration:"project-scoped"});
  }

  if(path.length===2&&path[1]==="members"&&request.method==="GET"){
    if(!readsMembers)return workspaceDenied();
    const [members,invitations]=await env.DB.batch([
      env.DB.prepare(`SELECT membership.membership_id,membership.user_id,users.display_name,users.email,membership.role,membership.status,membership.accepted_at
        FROM organization_memberships membership JOIN users ON users.user_id=membership.user_id
        WHERE membership.organization_id=? ORDER BY membership.created_at LIMIT 50`).bind(organizationId),
      env.DB.prepare("SELECT invitation_id,email_normalized,role,status,expires_at,created_at FROM organization_invitations WHERE organization_id=? ORDER BY created_at DESC LIMIT 50").bind(organizationId),
    ]);
    return Response.json({organization:membership,members:members.results,invitations:invitations.results});
  }

  if(path.length===2&&path[1]==="projects"&&request.method==="GET"){
    if(!readsProjects)return workspaceDenied();
    const projects=await env.DB.prepare(`SELECT project.project_access_id,project.project_id,project.owner_user_id,project.status,project.created_at,${scopedProjectNameSql} FROM organization_projects project WHERE project.organization_id=? ORDER BY project.created_at LIMIT 50`).bind(organizationId).all();
    return Response.json({organization:membership,projects:projects.results});
  }

  if(path.length===2&&path[1]==="audit"&&request.method==="GET"){
    if(!hasCapability(actor,"workspace.audit.read",scope))return workspaceDenied();
    const audit=await env.DB.prepare("SELECT audit.audit_id,users.display_name AS actor_display_name,audit.action,audit.resource_kind,audit.resource_id,audit.detail_json,audit.occurred_at FROM organization_audit_events audit LEFT JOIN users ON users.user_id=audit.actor_user_id WHERE audit.organization_id=? ORDER BY audit.occurred_at DESC LIMIT 50").bind(organizationId).all();
    return Response.json({organization:membership,audit:audit.results});
  }

  if(path.length===2&&path[1]==="usage"&&request.method==="GET"){
    if(!hasCapability(actor,"workspace.usage.read",scope))return workspaceDenied();
    const current=period();
    const [policies,cost,tokens,reservations]=await env.DB.batch([
      env.DB.prepare("SELECT token_limit,microusd_limit,updated_at FROM budget_scope_policies WHERE scope='workspace' AND scope_id=? AND organization_id=?").bind(organizationId,organizationId),
      env.DB.prepare("SELECT used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters WHERE scope='workspace' AND scope_id=? AND period=?").bind(organizationId,current),
      env.DB.prepare("SELECT used_tokens,reserved_tokens,hard_limit_tokens FROM budget_counters WHERE scope='workspace' AND scope_id=? AND period=?").bind(organizationId,current),
      env.DB.prepare("SELECT status,COUNT(*) AS count,COALESCE(SUM(used_microusd),0) AS used_microusd,COALESCE(SUM(reserved_microusd),0) AS reserved_microusd FROM cost_budget_reservations WHERE workspace_id=? AND period=? GROUP BY status").bind(organizationId,current),
    ]);
    return Response.json({organization:membership,period:current,policy:policies.results[0]??null,cost:cost.results[0]??null,tokens:tokens.results[0]??null,reservations:reservations.results});
  }

  if(path.length===2&&path[1]==="policy"&&(request.method==="GET"||request.method==="PATCH")){
    if(!hasCapability(actor,"workspace.policy.manage",scope))return workspaceDenied();
    if(request.method==="PATCH"){
      if(!hasCapability(actor,"workspace.budget.manage",scope))return workspaceDenied();
      const body=await request.json().catch(()=>({})) as {tokenLimit?:number;microusdLimit?:number};
      if(!Number.isSafeInteger(body.tokenLimit)||!Number.isSafeInteger(body.microusdLimit)||Number(body.tokenLimit)<1||Number(body.microusdLimit)<1)return Response.json({error:"valid_workspace_budget_limits_required"},{status:400});
      const now=new Date().toISOString();
      const current=period();
      const [token,cost]=await env.DB.batch<Record<string,unknown>>([
        env.DB.prepare("SELECT used_tokens,reserved_tokens FROM budget_counters WHERE scope='workspace' AND scope_id=? AND period=?").bind(organizationId,current),
        env.DB.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='workspace' AND scope_id=? AND period=?").bind(organizationId,current),
      ]);
      const tokenCommitted=Number(token.results[0]?.used_tokens??0)+Number(token.results[0]?.reserved_tokens??0);
      const costCommitted=Number(cost.results[0]?.used_microusd??0)+Number(cost.results[0]?.reserved_microusd??0);
      if(tokenCommitted>Number(body.tokenLimit)||costCommitted>Number(body.microusdLimit))return Response.json({error:"workspace_budget_limit_below_committed_usage"},{status:409});
      const updated=await env.DB.batch([
        env.DB.prepare(`UPDATE budget_scope_policies SET token_limit=?,microusd_limit=?,updated_by_user_id=?,updated_at=? WHERE scope='workspace' AND scope_id=? AND organization_id=?
          AND NOT EXISTS(SELECT 1 FROM budget_counters WHERE scope='workspace' AND scope_id=? AND period=? AND used_tokens+reserved_tokens>?)
          AND NOT EXISTS(SELECT 1 FROM cost_budget_counters WHERE scope='workspace' AND scope_id=? AND period=? AND used_microusd+reserved_microusd>?)`)
          .bind(body.tokenLimit,body.microusdLimit,actor.userId,now,organizationId,organizationId,organizationId,current,body.tokenLimit,organizationId,current,body.microusdLimit),
        env.DB.prepare("UPDATE budget_counters SET hard_limit_tokens=?,updated_at=? WHERE scope='workspace' AND scope_id=? AND period=? AND used_tokens+reserved_tokens<=?")
          .bind(body.tokenLimit,now,organizationId,current,body.tokenLimit),
        env.DB.prepare("UPDATE cost_budget_counters SET hard_limit_microusd=?,updated_at=? WHERE scope='workspace' AND scope_id=? AND period=? AND used_microusd+reserved_microusd<=?")
          .bind(body.microusdLimit,now,organizationId,current,body.microusdLimit),
        env.DB.prepare("UPDATE organizations SET updated_at=? WHERE organization_id=? AND status='active'").bind(now,organizationId),
      ]);
      if(Number(updated[0]?.meta.changes??0)!==1)return Response.json({error:"workspace_budget_limit_below_committed_usage"},{status:409});
      await recordOrganizationAudit(env,organizationId,actor,"OrganizationBudgetPolicyUpdated","policy",organizationId,{tokenLimit:Number(body.tokenLimit),microusdLimit:Number(body.microusdLimit)});
    }
    const policy=await env.DB.prepare("SELECT token_limit,microusd_limit,updated_at FROM budget_scope_policies WHERE scope='workspace' AND scope_id=? AND organization_id=?").bind(organizationId,organizationId).first();
    return Response.json({organization:membership,policy});
  }

  if (path.length === 2 && path[1] === "members" && request.method === "POST") {
    if (!managesMembers) return workspaceDenied();
    const body = await request.json().catch(() => ({})) as { email?: string; role?: string };
    const email = String(body.email??"").trim().toLowerCase();
    if(!validEmail(email))return Response.json({error:"valid_invitation_email_required"},{status:400});
    if(!await organizationEmailAllowed(env,organizationId,email))return Response.json({error:"organization_identity_policy_required"},{status:403});
    const role = body.role === "administrator" ? "administrator" : "member";
    if(role==="administrator"&&membership.role!=="owner")return workspaceDenied();
    const target = await env.DB.prepare("SELECT users.user_id,membership.status FROM users LEFT JOIN organization_memberships membership ON membership.user_id=users.user_id AND membership.organization_id=? WHERE users.email=?")
      .bind(organizationId,email).first<{user_id:string;status:string|null}>();
    if(target?.status==="active")return Response.json({error:"membership_already_active"},{status:409});
    const id = uuidV7();
    const now = new Date().toISOString();
    const expiresAt=new Date(Date.now()+7*86_400_000).toISOString();
    const token=`${uuidV7()}-${uuidV7()}`;
    const tokenHash=await sha256(token);
    try {
      const statements=[
        env.DB.prepare("UPDATE organization_invitations SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND email_normalized=? AND status='pending' AND revoked_at IS NULL").bind(now,now,organizationId,email),
        env.DB.prepare("INSERT INTO organization_invitations(invitation_id,organization_id,email_normalized,role,invited_by_user_id,token_hash,status,expires_at,created_at,updated_at,accepted_at,revoked_at) VALUES(?,?,?,?,?,?,'pending',?,?,?,NULL,NULL)")
          .bind(id,organizationId,email,role,actor.userId,tokenHash,expiresAt,now,now),
      ];
      if(target)statements.push(env.DB.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at,revoked_at) VALUES(?,?,?,?,'pending',?,NULL,?,?,NULL) ON CONFLICT(organization_id,user_id) DO UPDATE SET membership_id=excluded.membership_id,role=excluded.role,status='pending',invited_by_user_id=excluded.invited_by_user_id,accepted_at=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at,revoked_at=NULL WHERE organization_memberships.status IN('pending','revoked')")
        .bind(id,organizationId,target.user_id,role,actor.userId,now,now));
      await env.DB.batch(statements);
    } catch { return Response.json({ error: "invitation_unavailable" }, { status: 409 }); }
    await recordOrganizationAudit(env,organizationId,actor,"OrganizationMembershipInvited","invitation",id,{role});
    return Response.json({invitationId:id,membershipId:id,status:"pending",expiresAt,invitationUrl:`${new URL(request.url).origin}/settings/workspaces/invitations?invitation=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`},{status:201});
  }

  if(path.length===3&&path[1]==="invitations"&&request.method==="DELETE"){
    if(!managesMembers)return workspaceDenied();
    const target=await env.DB.prepare("SELECT invitation_id,role FROM organization_invitations WHERE invitation_id=? AND organization_id=? AND status='pending' AND revoked_at IS NULL")
      .bind(path[2],organizationId).first<{invitation_id:string;role:string}>();
    if(!target)return Response.json({error:"invitation_unavailable"},{status:404});
    if(target.role==="administrator"&&membership.role!=="owner")return workspaceDenied();
    const now=new Date().toISOString();
    const results=await env.DB.batch([
      env.DB.prepare("UPDATE organization_invitations SET status='revoked',revoked_at=?,updated_at=? WHERE invitation_id=? AND organization_id=? AND status='pending' AND revoked_at IS NULL").bind(now,now,path[2],organizationId),
      env.DB.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE membership_id=? AND organization_id=? AND status='pending'").bind(now,now,path[2],organizationId),
      env.DB.prepare("UPDATE organizations SET updated_at=? WHERE organization_id=? AND status='active'").bind(now,organizationId),
    ]);
    if(Number(results[0]?.meta.changes??0)!==1)return Response.json({error:"invitation_unavailable"},{status:409});
    await recordOrganizationAudit(env,organizationId,actor,"OrganizationInvitationRevoked","invitation",path[2]!);
    return Response.json({ok:true});
  }

  if (path.length === 3 && path[1] === "members" && request.method === "DELETE") {
    if (!managesMembers) return workspaceDenied();
    const target = await env.DB.prepare("SELECT membership.user_id,membership.role,users.email FROM organization_memberships membership JOIN users ON users.user_id=membership.user_id WHERE membership.membership_id=? AND membership.organization_id=? AND membership.status IN ('active','pending')")
      .bind(path[2], organizationId).first<{ user_id: string; role: string;email:string }>();
    if (!target || target.role === "owner") return Response.json({ error: "membership_cannot_be_revoked" }, { status: 409 });
    if(target.role==="administrator"&&membership.role!=="owner")return workspaceDenied();
    const protectedOwner=await env.DB.prepare(`SELECT project.project_access_id FROM organization_projects project
      WHERE project.organization_id=? AND project.owner_user_id=? AND project.status IN('indexing','active')
        AND EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=project.organization_id AND cohort.status IN ('active','paused')) LIMIT 1`)
      .bind(organizationId,target.user_id).first();
    if(protectedOwner)return Response.json({error:"project_owner_transfer_required"},{status:409});
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE membership_id=? AND organization_id=?").bind(now, now, path[2], organizationId),
      env.DB.prepare(`UPDATE pilot_participants SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id=? AND status='active' AND revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.cohort_id=pilot_participants.cohort_id AND cohort.organization_id=pilot_participants.organization_id AND cohort.status IN ('active','paused'))`)
        .bind(now,organizationId,target.user_id),
      env.DB.prepare("UPDATE project_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND user_id=? AND status='active'").bind(now, now, organizationId, target.user_id),
      env.DB.prepare("UPDATE project_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND status='active' AND project_access_id IN (SELECT project_access_id FROM organization_projects WHERE organization_id=? AND owner_user_id=?)").bind(now,now,organizationId,organizationId,target.user_id),
      env.DB.prepare("UPDATE capability_grants SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND user_id=? AND status='active'").bind(now, now, organizationId, target.user_id),
      env.DB.prepare("UPDATE capability_grants SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND scope_type='project' AND status='active' AND project_access_id IN (SELECT project_access_id FROM organization_projects WHERE organization_id=? AND owner_user_id=?)").bind(now,now,organizationId,organizationId,target.user_id),
      env.DB.prepare("UPDATE organization_invitations SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND email_normalized=? AND status='pending'").bind(now,now,organizationId,target.email.toLowerCase()),
      env.DB.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE organization_id=? AND revoked_at IS NULL AND (principal_user_id=? OR project_access_id IN (SELECT project_access_id FROM organization_projects WHERE organization_id=? AND owner_user_id=?))").bind(now,organizationId,target.user_id,organizationId,target.user_id),
      env.DB.prepare("UPDATE project_review_tasks SET status='canceled',resolved_at=?,resolved_by_user_id=? WHERE organization_id=? AND assigned_user_id=? AND status='pending'").bind(now,actor.userId,organizationId,target.user_id),
      env.DB.prepare("DELETE FROM project_notifications WHERE organization_id=? AND recipient_user_id=?").bind(organizationId,target.user_id),
      env.DB.prepare("UPDATE project_automation_outbox SET status='canceled' WHERE organization_id=? AND recipient_user_id=? AND status='pending'").bind(organizationId,target.user_id),
      env.DB.prepare("UPDATE organization_identity_bindings SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND user_id=? AND status='active'").bind(now,now,organizationId,target.user_id),
      env.DB.prepare("UPDATE project_migration_states SET status='quarantine',updated_at=? WHERE organization_id=? AND owner_user_id=? AND status IN('backfill','active')").bind(now,organizationId,target.user_id),
      env.DB.prepare("UPDATE organization_projects SET status='quarantine',updated_at=? WHERE organization_id=? AND owner_user_id=? AND status IN('indexing','active')").bind(now,organizationId,target.user_id),
      env.DB.prepare("UPDATE organizations SET updated_at=? WHERE organization_id=?").bind(now, organizationId),
    ]);
    await cancelProjectActorJobs(env,actor,{organizationId,actorUserId:target.user_id});
    await cancelProjectActorJobs(env,actor,{organizationId,ownerUserId:target.user_id});
    await recordOrganizationAudit(env,organizationId,actor,"OrganizationMembershipRevoked","membership",path[2]!);
    return Response.json({ ok: true });
  }

  if(path.length===3&&path[1]==="members"&&request.method==="PATCH"){
    if(!managesMembers||membership.role!=="owner")return workspaceDenied();
    const body=await request.json().catch(()=>({})) as {role?:string};
    if(!["member","administrator"].includes(String(body.role)))return Response.json({error:"valid_membership_role_required"},{status:400});
    if(body.role==="administrator"){
      const reviewer=await env.DB.prepare(`SELECT 1 AS restricted FROM organization_memberships membership
        WHERE membership.membership_id=? AND membership.organization_id=?
          AND ${effectivePilotReviewerSql("membership.organization_id","membership.user_id")}`)
        .bind(path[2],organizationId).first();
      if(reviewer)return Response.json({error:"pilot_reviewer_administrator_forbidden"},{status:403});
    }
    const now=new Date().toISOString();
    const result=await env.DB.prepare(`UPDATE organization_memberships SET role=?,updated_at=?
      WHERE membership_id=? AND organization_id=? AND role!='owner' AND status='active'
        AND(?!='administrator' OR NOT ${effectivePilotReviewerSql("organization_memberships.organization_id","organization_memberships.user_id")})`)
      .bind(body.role,now,path[2],organizationId,body.role).run();
    if(Number(result.meta.changes??0)!==1)return Response.json({error:body.role==="administrator"?"pilot_reviewer_administrator_forbidden":"membership_unavailable"},{status:body.role==="administrator"?403:404});
    await env.DB.prepare("UPDATE organizations SET updated_at=? WHERE organization_id=?").bind(now,organizationId).run();
    await recordOrganizationAudit(env,organizationId,actor,"OrganizationMembershipRoleUpdated","membership",path[2]!,{role:String(body.role)});
    return Response.json({ok:true,role:body.role});
  }

  if (path.length === 2 && path[1] === "projects" && request.method === "POST") {
    if (!managesProjects) return workspaceDenied();
    const body = await request.json().catch(() => ({})) as { projectId?: string };
    const projectId = safeName(body.projectId);
    const owned = projectId && await env.DB.prepare("SELECT 1 AS present FROM events WHERE stream_id=? AND type='ProjectCreated' AND json_extract(payload,'$.project_id')=? LIMIT 1").bind(actor.streamId, projectId).first();
    if (!owned) return Response.json({ error: "owned_project_required" }, { status: 403 });
    const projectAccessId = uuidV7();
    const now = new Date().toISOString();
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO organization_projects (project_access_id,project_id,organization_id,owner_user_id,status,created_at,updated_at) VALUES (?,?,?,?,'indexing',?,?)").bind(projectAccessId, projectId, organizationId, actor.userId, now, now),
        env.DB.prepare("INSERT INTO project_memberships (membership_id,project_access_id,project_id,organization_id,user_id,role,status,granted_by_user_id,created_at,updated_at,revoked_at) VALUES (?,?,?,?,?,'owner','active',?,?,?,NULL)").bind(uuidV7(), projectAccessId, projectId, organizationId, actor.userId, actor.userId, now, now),
        env.DB.prepare("INSERT INTO project_migration_states(project_access_id,organization_id,owner_user_id,status,last_owner_sequence,updated_at) VALUES(?,?,?,'backfill',0,?)").bind(projectAccessId,organizationId,actor.userId,now),
      ]);
    } catch { return Response.json({ error: "project_already_registered" }, { status: 409 }); }
    try{
      const migration=await synchronizeProjectScope(env,{organizationId,projectAccessId,projectId,ownerUserId:actor.userId});
      const activated=await env.DB.prepare(`UPDATE organization_projects SET status='active',updated_at=?
        WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='indexing'
          AND EXISTS(SELECT 1 FROM organizations organization JOIN organization_memberships owner
            ON owner.organization_id=organization.organization_id AND owner.user_id=organization_projects.owner_user_id
              AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
            WHERE organization.organization_id=organization_projects.organization_id AND organization.status='active'
              AND ${effectivePilotParticipantSql("organization.organization_id","owner.user_id")})`)
        .bind(new Date().toISOString(),projectAccessId,organizationId,actor.userId).run();
      if(Number(activated.meta.changes??0)!==1)throw new Error("project_owner_authorization_changed");
      await recordOrganizationAudit(env,organizationId,actor,"OrganizationProjectRegistered","project",projectAccessId,{eventCount:migration.eventCount});
      return Response.json({projectAccessId,projectId,...migration},{status:201});
    }catch{
      const quarantinedAt=new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("UPDATE project_migration_states SET status='quarantine',updated_at=? WHERE project_access_id=?").bind(quarantinedAt,projectAccessId),
        env.DB.prepare("UPDATE organization_projects SET status='quarantine',updated_at=? WHERE project_access_id=? AND status='indexing'").bind(quarantinedAt,projectAccessId),
      ]);
      return Response.json({error:"project_migration_quarantined"},{status:409});
    }
  }

  if (path.length === 4 && path[1] === "projects" && path[3] === "members" && request.method === "POST") {
    if (!managesProjects) return workspaceDenied();
    const project = await env.DB.prepare("SELECT project_id FROM organization_projects WHERE project_access_id=? AND organization_id=? AND status='active'").bind(path[2], organizationId).first<{ project_id: string }>();
    const body = await request.json().catch(() => ({})) as { userId?: string; role?: string };
    const target = body.userId && await env.DB.prepare("SELECT membership_id FROM organization_memberships WHERE organization_id=? AND user_id=? AND status='active' AND accepted_at IS NOT NULL AND revoked_at IS NULL").bind(organizationId, body.userId).first();
    if (!project || !target || !body.userId) return Response.json({ error: "active_workspace_member_and_project_required" }, { status: 403 });
    const now = new Date().toISOString();
    const role = body.role === "editor" ? "editor" : "viewer";
    try {
      const granted=await env.DB.prepare("INSERT INTO project_memberships(membership_id,project_access_id,project_id,organization_id,user_id,role,status,granted_by_user_id,created_at,updated_at,revoked_at) VALUES(?,?,?,?,?,?,'active',?,?,?,NULL) ON CONFLICT(project_access_id,user_id) DO UPDATE SET membership_id=excluded.membership_id,role=excluded.role,status='active',granted_by_user_id=excluded.granted_by_user_id,created_at=excluded.created_at,updated_at=excluded.updated_at,revoked_at=NULL WHERE project_memberships.status='revoked'")
        .bind(uuidV7(),path[2],project.project_id,organizationId,body.userId,role,actor.userId,now,now).run();
      if(Number(granted.meta.changes??0)!==1)return Response.json({error:"project_membership_already_exists"},{status:409});
    } catch { return Response.json({ error: "project_membership_already_exists" }, { status: 409 }); }
    await env.DB.prepare("UPDATE organization_projects SET updated_at=? WHERE project_access_id=?").bind(now,path[2]).run();
    await recordOrganizationAudit(env,organizationId,actor,"ProjectMembershipGranted","project",path[2]!,{role});
    return Response.json({ ok: true, role }, { status: 201 });
  }

  if(path.length===4&&path[1]==="projects"&&path[3]==="members"&&request.method==="GET"){
    if(!managesProjects&&!hasCapability(actor,"project.read",{organizationId,projectAccessId:path[2]}))return workspaceDenied();
    const members=await env.DB.prepare(`SELECT membership.membership_id,membership.user_id,users.display_name,membership.role,membership.status,membership.created_at,
      EXISTS(SELECT 1 FROM capability_grants grant_row WHERE grant_row.user_id=membership.user_id
        AND grant_row.capability='project.canvas.use' AND grant_row.scope_type='project'
        AND grant_row.project_access_id=membership.project_access_id AND grant_row.organization_id=membership.organization_id
        AND grant_row.status='active' AND grant_row.revoked_at IS NULL
        AND (grant_row.expires_at IS NULL OR grant_row.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))) AS canvas_access,
      (membership.role='owner' OR EXISTS(SELECT 1 FROM capability_grants grant_row WHERE grant_row.user_id=membership.user_id
        AND grant_row.capability='project.review.approve' AND grant_row.scope_type='project'
        AND grant_row.project_access_id=membership.project_access_id AND grant_row.organization_id=membership.organization_id
        AND grant_row.status='active' AND grant_row.revoked_at IS NULL
        AND(grant_row.expires_at IS NULL OR grant_row.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))
        AND ${effectivePilotParticipantSql("membership.organization_id","membership.user_id")} AS review_access
      FROM project_memberships membership JOIN users ON users.user_id=membership.user_id
      WHERE membership.project_access_id=? AND membership.organization_id=? AND (?=1 OR membership.status='active' AND membership.revoked_at IS NULL)
      ORDER BY membership.created_at LIMIT 50`).bind(path[2],organizationId,Number(managesProjects)).all();
    return Response.json({members:members.results});
  }

  if(path.length===5&&path[1]==="projects"&&path[3]==="members"&&(request.method==="DELETE"||request.method==="PATCH")){
    if(!managesProjects)return workspaceDenied();
    const target=await env.DB.prepare("SELECT user_id,role FROM project_memberships WHERE membership_id=? AND project_access_id=? AND organization_id=? AND status='active' AND revoked_at IS NULL").bind(path[4],path[2],organizationId).first<{user_id:string;role:string}>();
    if(!target||target.role==="owner")return Response.json({error:"project_membership_cannot_be_changed"},{status:409});
    const now=new Date().toISOString();
    if(request.method==="DELETE"){
      await env.DB.batch([
        env.DB.prepare("UPDATE project_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE membership_id=? AND project_access_id=? AND organization_id=?").bind(now,now,path[4],path[2],organizationId),
        env.DB.prepare("UPDATE capability_grants SET status='revoked',revoked_at=?,updated_at=? WHERE project_access_id=? AND organization_id=? AND user_id=? AND status='active'").bind(now,now,path[2],organizationId,target.user_id),
        env.DB.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE project_access_id=? AND organization_id=? AND principal_user_id=? AND revoked_at IS NULL").bind(now,path[2],organizationId,target.user_id),
        env.DB.prepare("UPDATE project_review_tasks SET status='canceled',resolved_at=?,resolved_by_user_id=? WHERE project_access_id=? AND organization_id=? AND assigned_user_id=? AND status='pending'").bind(now,actor.userId,path[2],organizationId,target.user_id),
        env.DB.prepare("DELETE FROM project_notifications WHERE project_access_id=? AND organization_id=? AND recipient_user_id=?").bind(path[2],organizationId,target.user_id),
        env.DB.prepare("UPDATE project_automation_outbox SET status='canceled' WHERE project_access_id=? AND organization_id=? AND recipient_user_id=? AND status='pending'").bind(path[2],organizationId,target.user_id),
        env.DB.prepare("UPDATE organization_projects SET updated_at=? WHERE project_access_id=? AND organization_id=?").bind(now,path[2],organizationId),
      ]);
      await cancelProjectActorJobs(env,actor,{organizationId,projectAccessId:path[2],actorUserId:target.user_id});
      await recordOrganizationAudit(env,organizationId,actor,"ProjectMembershipRevoked","membership",path[4]!);
    }else{
      const body=await request.json().catch(()=>({})) as {role?:string;canvasAccess?:boolean;reviewAccess?:boolean};
      const changeCount=Number(body.role!==undefined)+Number(typeof body.canvasAccess==="boolean")+Number(typeof body.reviewAccess==="boolean");
      if(changeCount!==1)return Response.json({error:"single_membership_change_required"},{status:400});
      if(typeof body.canvasAccess==="boolean"||typeof body.reviewAccess==="boolean"){
        const reviewChange=typeof body.reviewAccess==="boolean";
        const enabled=reviewChange?body.reviewAccess!:body.canvasAccess!;
        const capability=reviewChange?"project.review.approve":"project.canvas.use";
        const project=await env.DB.prepare("SELECT project_id FROM organization_projects WHERE project_access_id=? AND organization_id=? AND status='active'").bind(path[2],organizationId).first<{project_id:string}>();
        if(!project)return workspaceDenied();
        const statements=[
          enabled
            ?env.DB.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at,expires_at,revoked_at) SELECT ?,?,?,'project',?,?,?,'active',?,?,?,NULL,NULL WHERE NOT EXISTS(SELECT 1 FROM capability_grants WHERE user_id=? AND capability=? AND project_access_id=? AND organization_id=? AND status='active' AND revoked_at IS NULL AND(expires_at IS NULL OR expires_at>?))")
              .bind(uuidV7(),target.user_id,capability,organizationId,path[2],project.project_id,actor.userId,now,now,target.user_id,capability,path[2],organizationId,now)
            :env.DB.prepare("UPDATE capability_grants SET status='revoked',revoked_at=?,updated_at=? WHERE user_id=? AND capability=? AND scope_type='project' AND project_access_id=? AND organization_id=? AND status='active' AND revoked_at IS NULL")
              .bind(now,now,target.user_id,capability,path[2],organizationId),
          ...(!enabled?[env.DB.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE project_access_id=? AND organization_id=? AND principal_user_id=? AND revoked_at IS NULL").bind(now,path[2],organizationId,target.user_id)]:[]),
          ...(!enabled&&reviewChange?[
            env.DB.prepare("UPDATE project_review_tasks SET status='canceled',resolved_at=?,resolved_by_user_id=? WHERE project_access_id=? AND organization_id=? AND assigned_user_id=? AND status='pending'").bind(now,actor.userId,path[2],organizationId,target.user_id),
            env.DB.prepare("DELETE FROM project_notifications WHERE project_access_id=? AND organization_id=? AND recipient_user_id=? AND kind IN('review_requested','review_due')").bind(path[2],organizationId,target.user_id),
            env.DB.prepare("UPDATE project_automation_outbox SET status='canceled' WHERE project_access_id=? AND organization_id=? AND recipient_user_id=? AND status='pending'").bind(path[2],organizationId,target.user_id),
          ]:[]),
          env.DB.prepare("UPDATE organization_projects SET updated_at=? WHERE project_access_id=? AND organization_id=?").bind(now,path[2],organizationId),
        ];
        const results=await env.DB.batch(statements);
        if(Number(results[0]?.meta.changes??0)!==1)return Response.json({error:reviewChange?(enabled?"review_access_already_granted":"review_access_not_granted"):(enabled?"canvas_access_already_granted":"canvas_access_not_granted")},{status:409});
        await recordOrganizationAudit(env,organizationId,actor,reviewChange?(enabled?"ProjectReviewAccessGranted":"ProjectReviewAccessRevoked"):(enabled?"ProjectCanvasAccessGranted":"ProjectCanvasAccessRevoked"),"membership",path[4]!,{enabled});
      }else{
        if(!["viewer","editor"].includes(String(body.role)))return Response.json({error:"valid_project_role_required"},{status:400});
        await env.DB.batch([
          env.DB.prepare("UPDATE project_memberships SET role=?,updated_at=? WHERE membership_id=? AND project_access_id=? AND organization_id=?").bind(body.role,now,path[4],path[2],organizationId),
          ...(body.role==="viewer"?[
            env.DB.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE project_access_id=? AND organization_id=? AND principal_user_id=? AND revoked_at IS NULL").bind(now,path[2],organizationId,target.user_id),
          ]:[]),
          env.DB.prepare("UPDATE organization_projects SET updated_at=? WHERE project_access_id=? AND organization_id=?").bind(now,path[2],organizationId),
        ]);
        if(body.role==="viewer")await cancelProjectActorJobs(env,actor,{organizationId,projectAccessId:path[2],actorUserId:target.user_id});
        await recordOrganizationAudit(env,organizationId,actor,"ProjectMembershipRoleUpdated","membership",path[4]!,{role:String(body.role)});
      }
    }
    return Response.json({ok:true});
  }

  if(path.length===4&&path[1]==="projects"&&["context","events"].includes(path[3]??"")){
    const project=actor.access.projects.find((item)=>item.organizationId===organizationId&&item.projectAccessId===path[2]);
    if(!project||!hasCapability(actor,"project.read",{organizationId,projectAccessId:path[2]}))return workspaceDenied();
    const row=await env.DB.prepare("SELECT project.owner_user_id FROM organization_projects project JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.status='active' JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL WHERE project.project_access_id=? AND project.organization_id=? AND project.status='active'").bind(path[2],organizationId).first<{owner_user_id:string}>();
    if(!row)return workspaceDenied();
    let context:ProjectRequestContext={contextId:"",organizationId,projectAccessId:path[2]!,projectId:project.projectId,ownerUserId:row.owner_user_id,principalUserId:actor.userId,role:project.role,permissions:actor.access.capabilities.filter((capability)=>capability.startsWith("project.")&&hasCapability(actor,capability,{organizationId,projectAccessId:path[2]})),expiresAt:""};
    if(/(?:^|;\s*)forma_project_context=/.test(request.headers.get("cookie")??"")){
      const selected=await readProjectRequestContext(request,env,actor);
      if(selected.response)return selected.response;
      if(!selected.context)return workspaceDenied();
      if(path[3]==="events"){
        if(selected.context.organizationId!==organizationId||selected.context.projectAccessId!==path[2])return workspaceDenied();
        context=selected.context;
      }
    }
    if(path[3]==="context"&&request.method==="POST"){
      const policy=await env.DB.prepare("SELECT max_session_minutes FROM organization_security_policies WHERE organization_id=?")
        .bind(organizationId).first<{max_session_minutes:number}>();
      const sessionMinutes=Math.max(1,Math.min(480,Math.floor(Number(policy?.max_session_minutes??480))||480));
      const now=new Date().toISOString(),expiresAt=new Date(Date.now()+sessionMinutes*60_000).toISOString(),contextId=uuidV7();
      await env.DB.batch([
        env.DB.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE principal_user_id=? AND revoked_at IS NULL").bind(now,actor.userId),
        env.DB.prepare("INSERT INTO project_context_sessions(context_id,principal_user_id,organization_id,project_access_id,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)").bind(contextId,actor.userId,organizationId,path[2],now,expiresAt),
      ]);
      return Response.json({organizationId,projectAccessId:path[2],projectId:project.projectId,role:project.role,permissions:context.permissions,expiresAt},{headers:{"set-cookie":projectContextCookie(request,contextId,sessionMinutes*60),"cache-control":"private, no-store"}});
    }
    if(path[3]==="events"&&request.method==="GET"){
      const url=new URL(request.url);
      return Response.json(await readProjectEventPage(env,context,Number(url.searchParams.get("after")??0),Number(url.searchParams.get("limit")??5000),url.searchParams.get("content")!=="0"));
    }
    if(path[3]==="events"&&request.method==="POST")return appendProjectEvents(env,context,actor,await request.json());
  }

  return new Response("Method not allowed", { status: 405 });
}
