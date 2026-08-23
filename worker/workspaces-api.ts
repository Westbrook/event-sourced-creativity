import { hasCapability, requireConsent, requireUser, type PilotUser } from "./pilot-policy.ts";
import { uuidV7, type WorkerEnv } from "./runtime.ts";
import { appendProjectEvents, projectContextCookie, readProjectEventPage, readProjectRequestContext, recordOrganizationAudit, synchronizeProjectScope, type ProjectRequestContext } from "./project-access.ts";
import { cancelProjectActorJobs } from "./document-jobs-api.ts";

const safeName = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 100) : "";
const validEmail=(value:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&value.length<=254;
const sha256=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),(byte)=>byte.toString(16).padStart(2,"0")).join("");
const sameOrigin=(request:Request)=>{const origin=request.headers.get("origin");return!origin||origin===new URL(request.url).origin;};
const workspaceDenied=()=>Response.json({error:"access_denied"},{status:403});
const workspaceMutation=(request:Request)=>["POST","PATCH","PUT","DELETE"].includes(request.method);
const period=()=>new Date().toISOString().slice(0,7);
const ownerRole=(actor:PilotUser)=>actor.role==="creator"||actor.role==="admin";
const scopedProjectNameSql=`COALESCE((SELECT CASE event.type WHEN 'ProjectRenamed' THEN json_extract(event.payload,'$.new_name') ELSE json_extract(event.payload,'$.name') END
  FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
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
    const organizations=actor.access.organizations.map((organization)=>({...organization,permissions:actor.access.capabilities.filter((capability)=>capability.startsWith("workspace.")&&hasCapability(actor,capability,{organizationId:organization.organizationId}))}));
    return Response.json({ organizations, projects: actor.access.projects, invitations: invitations.results, projectCollaboration:"project-scoped" });
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

  const organizationId = path[0] ?? "";
  const membership = actor.access.organizations.find((organization) => organization.organizationId === organizationId);
  const acceptance = path.length === 4 && (path[1] === "members"||path[1]==="invitations") && path[3] === "accept" && request.method === "POST";

  if (acceptance) {
    const now = new Date().toISOString();
    const invitation=await env.DB.prepare("SELECT invitation_id,email_normalized,role,invited_by_user_id,token_hash FROM organization_invitations WHERE invitation_id=? AND organization_id=? AND status='pending' AND revoked_at IS NULL AND expires_at>?")
      .bind(path[2],organizationId,now).first<{invitation_id:string;email_normalized:string;role:string;invited_by_user_id:string;token_hash:string}>();
    if(invitation&&invitation.email_normalized!==actor.email.toLowerCase())return Response.json({error:"invitation_unavailable"},{status:403});
    if(invitation){
      const provided=await request.clone().json().catch(()=>({})) as {token?:unknown};
      if(provided.token!==undefined&&(typeof provided.token!=="string"||!provided.token||await sha256(provided.token)!==invitation.token_hash))return Response.json({error:"invitation_unavailable"},{status:403});
      const results=await env.DB.batch([
        env.DB.prepare("UPDATE organization_invitations SET status='accepted',accepted_at=?,updated_at=? WHERE invitation_id=? AND organization_id=? AND email_normalized=? AND status='pending' AND revoked_at IS NULL AND expires_at>?")
          .bind(now,now,path[2],organizationId,actor.email.toLowerCase(),now),
        env.DB.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at,revoked_at) VALUES(?,?,?,?,'active',?,?,?, ?,NULL) ON CONFLICT(organization_id,user_id) DO UPDATE SET membership_id=excluded.membership_id,role=excluded.role,status='active',invited_by_user_id=excluded.invited_by_user_id,accepted_at=excluded.accepted_at,created_at=excluded.created_at,updated_at=excluded.updated_at,revoked_at=NULL WHERE organization_memberships.status IN('pending','revoked')")
          .bind(path[2],organizationId,actor.userId,invitation.role,invitation.invited_by_user_id,now,now,now),
        env.DB.prepare("UPDATE organizations SET updated_at=? WHERE organization_id=? AND status='active'").bind(now,organizationId),
      ]);
      if(results.some((result)=>Number(result.meta.changes??0)!==1))return Response.json({error:"invitation_unavailable"},{status:403});
    }else{
      if(path[1]==="invitations")return Response.json({error:"invitation_unavailable"},{status:403});
      const pending=await env.DB.prepare("SELECT 1 AS present FROM organization_memberships WHERE membership_id=? AND organization_id=? AND user_id=? AND status='pending' AND revoked_at IS NULL")
        .bind(path[2],organizationId,actor.userId).first();
      if(!pending)return Response.json({error:"invitation_unavailable"},{status:403});
      const accepted=await env.DB.prepare("UPDATE organization_memberships SET status='active',accepted_at=?,updated_at=? WHERE membership_id=? AND organization_id=? AND user_id=? AND status='pending' AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM organizations WHERE organization_id=? AND status='active')")
        .bind(now,now,path[2],organizationId,actor.userId,organizationId).run();
      if(Number(accepted.meta.changes??0)!==1)return Response.json({error:"invitation_unavailable"},{status:403});
    }
    await recordOrganizationAudit(env,organizationId,actor,"OrganizationMembershipAccepted","membership",path[2]!);
    return Response.json({ ok: true });
  }

  if (!membership) return workspaceDenied();

  const scope={organizationId};
  const readsMembers=hasCapability(actor,"workspace.member.read",scope);
  const managesMembers=hasCapability(actor,"workspace.member.manage",scope);
  const readsProjects=hasCapability(actor,"workspace.project.read",scope);
  const managesProjects=hasCapability(actor,"workspace.project.manage",scope);

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
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE membership_id=? AND organization_id=?").bind(now, now, path[2], organizationId),
      env.DB.prepare("UPDATE project_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND user_id=? AND status='active'").bind(now, now, organizationId, target.user_id),
      env.DB.prepare("UPDATE project_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND status='active' AND project_access_id IN (SELECT project_access_id FROM organization_projects WHERE organization_id=? AND owner_user_id=?)").bind(now,now,organizationId,organizationId,target.user_id),
      env.DB.prepare("UPDATE capability_grants SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND user_id=? AND status='active'").bind(now, now, organizationId, target.user_id),
      env.DB.prepare("UPDATE capability_grants SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND scope_type='project' AND status='active' AND project_access_id IN (SELECT project_access_id FROM organization_projects WHERE organization_id=? AND owner_user_id=?)").bind(now,now,organizationId,organizationId,target.user_id),
      env.DB.prepare("UPDATE organization_invitations SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND email_normalized=? AND status='pending'").bind(now,now,organizationId,target.email.toLowerCase()),
      env.DB.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE organization_id=? AND revoked_at IS NULL AND (principal_user_id=? OR project_access_id IN (SELECT project_access_id FROM organization_projects WHERE organization_id=? AND owner_user_id=?))").bind(now,organizationId,target.user_id,organizationId,target.user_id),
      env.DB.prepare("UPDATE project_migration_states SET status='quarantine',updated_at=? WHERE organization_id=? AND owner_user_id=? AND status='active'").bind(now,organizationId,target.user_id),
      env.DB.prepare("UPDATE organization_projects SET status='quarantine',updated_at=? WHERE organization_id=? AND owner_user_id=? AND status='active'").bind(now,organizationId,target.user_id),
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
    const now=new Date().toISOString();
    const result=await env.DB.prepare("UPDATE organization_memberships SET role=?,updated_at=? WHERE membership_id=? AND organization_id=? AND role!='owner' AND status='active'").bind(body.role,now,path[2],organizationId).run();
    if(Number(result.meta.changes??0)!==1)return Response.json({error:"membership_unavailable"},{status:404});
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
      await env.DB.prepare("UPDATE organization_projects SET status='active',updated_at=? WHERE project_access_id=? AND organization_id=?").bind(new Date().toISOString(),projectAccessId,organizationId).run();
      await recordOrganizationAudit(env,organizationId,actor,"OrganizationProjectRegistered","project",projectAccessId,{eventCount:migration.eventCount});
      return Response.json({projectAccessId,projectId,...migration},{status:201});
    }catch{
      await env.DB.prepare("UPDATE project_migration_states SET status='quarantine',updated_at=? WHERE project_access_id=?").bind(new Date().toISOString(),projectAccessId).run();
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
        AND (grant_row.expires_at IS NULL OR grant_row.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))) AS canvas_access
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
        env.DB.prepare("UPDATE organization_projects SET updated_at=? WHERE project_access_id=? AND organization_id=?").bind(now,path[2],organizationId),
      ]);
      await cancelProjectActorJobs(env,actor,{organizationId,projectAccessId:path[2],actorUserId:target.user_id});
      await recordOrganizationAudit(env,organizationId,actor,"ProjectMembershipRevoked","membership",path[4]!);
    }else{
      const body=await request.json().catch(()=>({})) as {role?:string;canvasAccess?:boolean};
      if(typeof body.canvasAccess==="boolean"){
        if(body.role!==undefined)return Response.json({error:"single_membership_change_required"},{status:400});
        const project=await env.DB.prepare("SELECT project_id FROM organization_projects WHERE project_access_id=? AND organization_id=? AND status='active'").bind(path[2],organizationId).first<{project_id:string}>();
        if(!project)return workspaceDenied();
        const statements=[
          body.canvasAccess
            ?env.DB.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at,expires_at,revoked_at) SELECT ?,?,'project.canvas.use','project',?,?,?,'active',?,?,?,NULL,NULL WHERE NOT EXISTS(SELECT 1 FROM capability_grants WHERE user_id=? AND capability='project.canvas.use' AND project_access_id=? AND organization_id=? AND status='active' AND revoked_at IS NULL AND(expires_at IS NULL OR expires_at>?))")
              .bind(uuidV7(),target.user_id,organizationId,path[2],project.project_id,actor.userId,now,now,target.user_id,path[2],organizationId,now)
            :env.DB.prepare("UPDATE capability_grants SET status='revoked',revoked_at=?,updated_at=? WHERE user_id=? AND capability='project.canvas.use' AND scope_type='project' AND project_access_id=? AND organization_id=? AND status='active' AND revoked_at IS NULL")
              .bind(now,now,target.user_id,path[2],organizationId),
          ...(body.canvasAccess?[]:[env.DB.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE project_access_id=? AND organization_id=? AND principal_user_id=? AND revoked_at IS NULL").bind(now,path[2],organizationId,target.user_id)]),
          env.DB.prepare("UPDATE organization_projects SET updated_at=? WHERE project_access_id=? AND organization_id=?").bind(now,path[2],organizationId),
        ];
        const results=await env.DB.batch(statements);
        if(Number(results[0]?.meta.changes??0)!==1)return Response.json({error:body.canvasAccess?"canvas_access_already_granted":"canvas_access_not_granted"},{status:409});
        await recordOrganizationAudit(env,organizationId,actor,body.canvasAccess?"ProjectCanvasAccessGranted":"ProjectCanvasAccessRevoked","membership",path[4]!,{enabled:body.canvasAccess});
      }else{
        if(!["viewer","editor"].includes(String(body.role)))return Response.json({error:"valid_project_role_required"},{status:400});
        await env.DB.batch([
          env.DB.prepare("UPDATE project_memberships SET role=?,updated_at=? WHERE membership_id=? AND project_access_id=? AND organization_id=?").bind(body.role,now,path[4],path[2],organizationId),
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
      const now=new Date().toISOString(),expiresAt=new Date(Date.now()+8*60*60_000).toISOString(),contextId=uuidV7();
      await env.DB.batch([
        env.DB.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE principal_user_id=? AND revoked_at IS NULL").bind(now,actor.userId),
        env.DB.prepare("INSERT INTO project_context_sessions(context_id,principal_user_id,organization_id,project_access_id,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)").bind(contextId,actor.userId,organizationId,path[2],now,expiresAt),
      ]);
      return Response.json({organizationId,projectAccessId:path[2],projectId:project.projectId,role:project.role,permissions:context.permissions,expiresAt},{headers:{"set-cookie":projectContextCookie(request,contextId,8*60*60),"cache-control":"private, no-store"}});
    }
    if(path[3]==="events"&&request.method==="GET"){
      const url=new URL(request.url);
      return Response.json(await readProjectEventPage(env,context,Number(url.searchParams.get("after")??0),Number(url.searchParams.get("limit")??5000),url.searchParams.get("content")!=="0"));
    }
    if(path[3]==="events"&&request.method==="POST")return appendProjectEvents(env,context,actor,await request.json());
  }

  return new Response("Method not allowed", { status: 405 });
}
