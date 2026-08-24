import { effectivePilotReviewerSql, principalAccessFromRow, PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { cancelProjectActorJobs } from "./document-jobs-api.ts";
import { hasCapability, POLICY_VERSION, type PilotRole, type PilotUser } from "./pilot-policy.ts";
import { recordOrganizationAudit } from "./project-access.ts";
import { ensureSchema, uuidV7, type WorkerEnv } from "./runtime.ts";

const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
const emailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const credentialLifetimeMs=30*24*60*60*1000;
const credentialGuard=`EXISTS(SELECT 1 FROM organization_provisioning_credentials live
  JOIN organizations organization ON organization.organization_id=live.organization_id AND organization.status='active'
  JOIN organization_memberships owner ON owner.organization_id=organization.organization_id AND owner.user_id=organization.owner_user_id
    AND owner.role='owner' AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
  JOIN users identity ON identity.user_id=owner.user_id AND identity.consent_version=?
  WHERE live.credential_id=? AND live.organization_id=? AND live.created_by_user_id=organization.owner_user_id
    AND live.status='active' AND live.revoked_at IS NULL AND live.created_at>=?)`;
const credentialBindings=(credentialId:string,organizationId:string)=>[POLICY_VERSION,credentialId,organizationId,new Date(Date.now()-credentialLifetimeMs).toISOString()] as const;
const namedPilotParticipantGuard=`NOT EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=? AND cohort.status IN('active','paused')
  AND NOT EXISTS(SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id
    AND participant.organization_id=cohort.organization_id AND participant.email_normalized=?
    AND participant.status='active' AND participant.revoked_at IS NULL AND(participant.user_id IS NULL OR participant.user_id=?)))`;

async function authenticatedProvisioner(request: Request, env: WorkerEnv, organizationId: string) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!token || token.length > 500) return null;
  const credential = await env.DB.prepare(`SELECT credential.credential_id,credential.created_by_user_id,organization.owner_user_id,
      COALESCE(policy.authentication_source,'any') AS authentication_source,binding.authentication_source AS bound_source,binding.subject AS bound_subject
    FROM organization_provisioning_credentials credential JOIN organizations organization
      ON organization.organization_id=credential.organization_id AND organization.status='active'
      JOIN organization_memberships owner_member ON owner_member.organization_id=organization.organization_id
        AND owner_member.user_id=organization.owner_user_id AND owner_member.role='owner' AND owner_member.status='active'
        AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
      JOIN users owner_identity ON owner_identity.user_id=organization.owner_user_id AND owner_identity.consent_version=?
      LEFT JOIN organization_security_policies policy ON policy.organization_id=organization.organization_id
      LEFT JOIN organization_identity_bindings binding ON binding.organization_id=organization.organization_id
        AND binding.user_id=organization.owner_user_id AND binding.status='active' AND binding.revoked_at IS NULL
    WHERE credential.organization_id=? AND credential.token_hash=? AND credential.status='active' AND credential.revoked_at IS NULL AND credential.created_at>=?`)
    .bind(POLICY_VERSION,organizationId,await digest(token),new Date(Date.now()-credentialLifetimeMs).toISOString()).first<{credential_id:string;created_by_user_id:string;owner_user_id:string;authentication_source:string;bound_source:string|null;bound_subject:string|null}>();
  if (!credential || credential.created_by_user_id !== credential.owner_user_id) return null;
  if(credential.authentication_source!=="any"&&credential.bound_source&&credential.bound_source!==credential.authentication_source)return null;
  const row = await env.DB.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(credential.owner_user_id).first<Record<string, unknown>>();
  if (!row) return null;
  const role = String(row.role) as PilotRole;
  const actor: PilotUser = {
    userId: credential.owner_user_id,
    email: String(row.email),
    displayName: String(row.display_name),
    role,
    consentVersion: row.consent_version ? String(row.consent_version) : null,
    consentedAt: row.consented_at ? String(row.consented_at) : null,
    streamId: `creative:${credential.owner_user_id}`,
    access: await principalAccessFromRow(row,role,{
      email:String(row.email),
      source:credential.bound_source??(credential.authentication_source!=="any"?credential.authentication_source:"openai-workspace"),
      subject:credential.bound_subject??credential.owner_user_id,
    }),
  };
  if(!hasCapability(actor,"workspace.member.manage",{organizationId}))return null;
  return { credential, actor };
}

async function allowedDomain(env: WorkerEnv, organizationId: string, email: string,source:string) {
  const policy = await env.DB.prepare("SELECT allowed_domains_json,authentication_source,require_mfa FROM organization_security_policies WHERE organization_id=?")
    .bind(organizationId).first<{allowed_domains_json:string;authentication_source:string;require_mfa:number}>();
  if (!policy) return true;
  if(policy.require_mfa||policy.authentication_source!=="any"&&policy.authentication_source!==source)return false;
  try {
    const domains = JSON.parse(policy.allowed_domains_json) as unknown;
    return Array.isArray(domains) && (!domains.length || domains.includes(email.toLowerCase().split("@").at(-1)));
  } catch { return false; }
}

async function provisionUser(request: Request, env: WorkerEnv, organizationId: string, operator: PilotUser,credentialId:string) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const userId = String(body.userId ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const displayName = String(body.displayName ?? email.split("@")[0] ?? "").trim().slice(0, 100);
  const source = String(body.authenticationSource ?? "openai-workspace");
  if (!userId || userId.length > 160 || !emailValid(email) || !displayName || !["openai-workspace", "cloudflare-access", "local-development"].includes(source)) {
    return Response.json({ error: "valid_provisioned_identity_required" }, { status: 400 });
  }
  if(userId===operator.userId||email===operator.email.toLowerCase())return Response.json({error:"organization_owner_provisioning_forbidden"},{status:409});
  if(!await allowedDomain(env,organizationId,email,source))return Response.json({error:"organization_identity_policy_required"},{status:403});
  if(source==="cloudflare-access"&&userId!==`access:${email}`||source==="local-development"&&userId!=="dev-local-creative")
    return Response.json({error:"authentication_source_subject_mismatch"},{status:400});
  const existing = await env.DB.prepare("SELECT user_id,email FROM users WHERE user_id=? OR email=? LIMIT 2").bind(userId, email).all<{ user_id: string; email: string }>();
  if (existing.results.some((identity) => identity.user_id !== userId || identity.email !== email)) return Response.json({ error: "provisioned_identity_conflict" }, { status: 409 });
  const pilot = await env.DB.prepare(`SELECT cohort.cohort_id FROM pilot_cohorts cohort WHERE cohort.organization_id=? AND cohort.status IN('active','paused')
    AND NOT EXISTS(SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
      AND participant.email_normalized=? AND participant.status='active' AND participant.revoked_at IS NULL AND (participant.user_id IS NULL OR participant.user_id=?)) LIMIT 1`)
    .bind(organizationId, email, userId).first();
  if (pilot) return Response.json({ error: "named_pilot_participant_required" }, { status: 403 });
  const membership=await env.DB.prepare(`SELECT member.role,member.status,identity.authentication_source,identity.subject,identity.status AS identity_status,
      account.display_name,policy.organization_id AS policy_exists
    FROM organization_memberships member JOIN users account ON account.user_id=member.user_id
      LEFT JOIN organization_identity_bindings identity ON identity.organization_id=member.organization_id AND identity.user_id=member.user_id
      LEFT JOIN organization_security_policies policy ON policy.organization_id=member.organization_id
    WHERE member.organization_id=? AND member.user_id=?`).bind(organizationId,userId).first<Record<string,unknown>>();
  if(membership&&membership.role==="member"&&membership.status==="active"&&membership.identity_status==="active"
    &&membership.authentication_source===source&&membership.subject===userId&&membership.display_name===displayName&&membership.policy_exists){
    return Response.json({userId,email,displayName,active:true,role:"member",interoperability:"local-scoped-endpoint-only"});
  }
  const now = new Date().toISOString();
  const membershipId = uuidV7();
  const identityId = uuidV7();
  const results=await env.DB.batch([
    env.DB.prepare(`INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at)
      SELECT ?,?,?,'creator',NULL,NULL,?,? WHERE ${credentialGuard} AND ${namedPilotParticipantGuard}
      ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,updated_at=excluded.updated_at WHERE users.email=excluded.email`)
      .bind(userId,email,displayName,now,now,...credentialBindings(credentialId,organizationId),organizationId,email,userId),
    env.DB.prepare(`INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at,revoked_at)
      SELECT ?,?,?,'member','active',?,?,?,?,NULL WHERE ${credentialGuard} AND ${namedPilotParticipantGuard}
        AND EXISTS(SELECT 1 FROM users provisioned WHERE provisioned.user_id=? AND provisioned.email=? AND provisioned.updated_at=?)
      ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role,status='active',accepted_at=excluded.accepted_at,updated_at=excluded.updated_at,revoked_at=NULL
      WHERE organization_memberships.role!='owner'`)
      .bind(membershipId,organizationId,userId,operator.userId,now,now,now,...credentialBindings(credentialId,organizationId),organizationId,email,userId,userId,email,now),
    env.DB.prepare(`INSERT INTO organization_identity_bindings(binding_id,organization_id,user_id,authentication_source,subject,status,created_at,updated_at,revoked_at)
      SELECT ?,?,?,?,?,'active',?,?,NULL WHERE EXISTS(SELECT 1 FROM organization_memberships provisioned
        WHERE provisioned.organization_id=? AND provisioned.user_id=? AND provisioned.role='member'
          AND provisioned.status='active' AND provisioned.accepted_at=? AND provisioned.revoked_at IS NULL)
      ON CONFLICT(organization_id,user_id) DO UPDATE SET authentication_source=excluded.authentication_source,
        subject=excluded.subject,status='active',updated_at=excluded.updated_at,revoked_at=NULL`)
      .bind(identityId,organizationId,userId,source,userId,now,now,organizationId,userId,now),
    env.DB.prepare(`INSERT OR IGNORE INTO organization_security_policies(organization_id,authentication_source,allowed_domains_json,require_mfa,encryption_mode,max_session_minutes,version,updated_by_user_id,updated_at)
      SELECT ?,'any','[]',0,'platform-unverified',480,1,?,? WHERE EXISTS(SELECT 1 FROM organization_memberships provisioned
        WHERE provisioned.organization_id=? AND provisioned.user_id=? AND provisioned.role='member' AND provisioned.status='active' AND provisioned.accepted_at=?)`)
      .bind(organizationId,operator.userId,now,organizationId,userId,now),
    env.DB.prepare(`UPDATE capability_grants SET status='revoked',revoked_at=?,updated_at=?
      WHERE organization_id=? AND user_id=? AND scope_type='workspace' AND status='active'
        AND EXISTS(SELECT 1 FROM organization_memberships provisioned WHERE provisioned.organization_id=?
          AND provisioned.user_id=? AND provisioned.role='member' AND provisioned.accepted_at=?)`)
      .bind(now,now,organizationId,userId,organizationId,userId,now),
    env.DB.prepare(`UPDATE pilot_participants SET user_id=? WHERE organization_id=? AND email_normalized=? AND status='active' AND revoked_at IS NULL AND user_id IS NULL
      AND EXISTS(SELECT 1 FROM organization_memberships provisioned WHERE provisioned.organization_id=? AND provisioned.user_id=?
        AND provisioned.status='active' AND provisioned.accepted_at=?)`).bind(userId,organizationId,email,organizationId,userId,now),
    env.DB.prepare(`UPDATE organizations SET updated_at=? WHERE organization_id=? AND status='active'
      AND EXISTS(SELECT 1 FROM organization_memberships provisioned WHERE provisioned.organization_id=organizations.organization_id
        AND provisioned.user_id=? AND provisioned.status='active' AND provisioned.accepted_at=?)`).bind(now,organizationId,userId,now),
  ]);
  if(Number(results[0]?.meta.changes??0)!==1){
    const live=await env.DB.prepare(`SELECT 1 AS active WHERE ${credentialGuard}`).bind(...credentialBindings(credentialId,organizationId)).first();
    return live?Response.json({error:"named_pilot_participant_required"},{status:403}):Response.json({error:"provisioning_credentials_required"},{status:401});
  }
  if(Number(results[1]?.meta.changes??0)!==1||Number(results[2]?.meta.changes??0)!==1)
    return Response.json({error:"provisioned_identity_conflict"},{status:409});
  await recordOrganizationAudit(env, organizationId, operator, "OrganizationIdentityProvisioned", "identity", userId);
  return Response.json({ userId, email, displayName, active: true, role: "member", interoperability: "local-scoped-endpoint-only" }, { status: existing.results.length ? 200 : 201 });
}

async function deprovisionUser(env: WorkerEnv, organizationId: string, operator: PilotUser, userId: string,credentialId:string) {
  if (!userId || userId === operator.userId) return Response.json({ error: "organization_owner_deprovisioning_forbidden" }, { status: 409 });
  const owned = await env.DB.prepare("SELECT COUNT(*) AS count FROM organization_projects WHERE organization_id=? AND owner_user_id=?")
    .bind(organizationId, userId).first<{ count: number }>();
  if (Number(owned?.count ?? 0) > 0) return Response.json({ error: "project_custody_transfer_required" }, { status: 409 });
  const now = new Date().toISOString();
  const proof="EXISTS(SELECT 1 FROM organization_memberships withdrawn WHERE withdrawn.organization_id=? AND withdrawn.user_id=? AND withdrawn.status='revoked' AND withdrawn.revoked_at=?)";
  const results=await env.DB.batch([
    env.DB.prepare(`UPDATE organization_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND user_id=? AND role!='owner' AND status='active'
      AND NOT EXISTS(SELECT 1 FROM organization_projects owned WHERE owned.organization_id=organization_memberships.organization_id
        AND owned.owner_user_id=organization_memberships.user_id) AND ${credentialGuard}`)
      .bind(now,now,organizationId,userId,...credentialBindings(credentialId,organizationId)),
    env.DB.prepare(`UPDATE organization_identity_bindings SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND user_id=? AND status='active' AND ${proof}`).bind(now,now,organizationId,userId,organizationId,userId,now),
    env.DB.prepare(`UPDATE project_memberships SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND user_id=? AND status='active' AND ${proof}`).bind(now,now,organizationId,userId,organizationId,userId,now),
    env.DB.prepare(`UPDATE capability_grants SET status='revoked',revoked_at=?,updated_at=? WHERE organization_id=? AND user_id=? AND status='active' AND ${proof}`).bind(now,now,organizationId,userId,organizationId,userId,now),
    env.DB.prepare(`UPDATE pilot_participants SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id=? AND status='active' AND ${proof}`).bind(now,organizationId,userId,organizationId,userId,now),
    env.DB.prepare(`UPDATE project_context_sessions SET revoked_at=? WHERE organization_id=? AND principal_user_id=? AND revoked_at IS NULL AND ${proof}`).bind(now,organizationId,userId,organizationId,userId,now),
    env.DB.prepare(`UPDATE project_review_tasks SET status='canceled',resolved_at=?,resolved_by_user_id=? WHERE organization_id=? AND assigned_user_id=? AND status='pending' AND ${proof}`).bind(now,operator.userId,organizationId,userId,organizationId,userId,now),
    env.DB.prepare(`DELETE FROM project_notifications WHERE organization_id=? AND recipient_user_id=? AND ${proof}`).bind(organizationId,userId,organizationId,userId,now),
    env.DB.prepare(`UPDATE project_automation_outbox SET status='canceled' WHERE organization_id=? AND recipient_user_id=? AND status='pending' AND ${proof}`).bind(organizationId,userId,organizationId,userId,now),
    env.DB.prepare(`DELETE FROM organization_identity_group_members WHERE organization_id=? AND user_id=? AND ${proof}`).bind(organizationId,userId,organizationId,userId,now),
    env.DB.prepare(`UPDATE organizations SET updated_at=? WHERE organization_id=? AND status='active' AND ${proof}`).bind(now,organizationId,organizationId,userId,now),
  ]);
  if(Number(results[0]?.meta.changes??0)!==1){
    const live=await env.DB.prepare(`SELECT 1 AS active WHERE ${credentialGuard}`).bind(...credentialBindings(credentialId,organizationId)).first();
    return live?Response.json({error:"project_custody_transfer_required"},{status:409}):Response.json({error:"provisioning_credentials_required"},{status:401});
  }
  await cancelProjectActorJobs(env,operator,{organizationId,actorUserId:userId});
  await recordOrganizationAudit(env, organizationId, operator, "OrganizationIdentityDeprovisioned", "identity", userId);
  return Response.json({ userId, active: false, revokedAt: now });
}

async function upsertGroup(request: Request, env: WorkerEnv, organizationId: string, operator: PilotUser,credentialId:string) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const externalId = String(body.externalId ?? "").trim().slice(0, 160);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const role = String(body.mappedRole ?? "member");
  if (!externalId || !name || !["member", "administrator"].includes(role)) return Response.json({ error: "valid_scoped_identity_group_required" }, { status: 400 });
  const supplied=body.memberUserIds;
  if(supplied!==undefined&&(!Array.isArray(supplied)||supplied.length>100||supplied.some((value)=>typeof value!=="string"||!value.trim())))
    return Response.json({error:"valid_scoped_identity_group_members_required"},{status:400});
  const members=supplied===undefined?null:[...new Set((supplied as string[]).map((value)=>value.trim()))];
  const known=await env.DB.prepare("SELECT group_id FROM organization_identity_groups WHERE organization_id=? AND external_id=?")
    .bind(organizationId,externalId).first<{group_id:string}>();
  const current=known?await env.DB.prepare("SELECT user_id FROM organization_identity_group_members WHERE group_id=? AND organization_id=?")
    .bind(known.group_id,organizationId).all<{user_id:string}>():{results:[] as Array<{user_id:string}>};
  const previous=current.results.map((member)=>member.user_id);
  const mapped=members??previous;
  if(members){
    for(const member of members){
      if(member===operator.userId)return Response.json({error:"organization_owner_group_mapping_forbidden"},{status:409});
      const allowed=await env.DB.prepare(`SELECT 1 AS present FROM organization_memberships membership JOIN users identity ON identity.user_id=membership.user_id
        WHERE membership.organization_id=? AND membership.user_id=? AND membership.status='active' AND membership.role!='owner'
          AND membership.accepted_at IS NOT NULL AND membership.revoked_at IS NULL`).bind(organizationId,member).first();
      if(!allowed)return Response.json({error:"organization_identity_group_member_unavailable"},{status:403});
    }
  }
  if(role==="administrator")for(const member of mapped){
    const reviewer=await env.DB.prepare(`SELECT 1 AS restricted WHERE ${effectivePilotReviewerSql("?","?")}`)
      .bind(organizationId,member).first();
    if(reviewer)return Response.json({error:"pilot_reviewer_administrator_mapping_forbidden"},{status:403});
  }
  const id = uuidV7();
  const now = new Date().toISOString();
  const groupId=known?.group_id??id;
  const groupProof="EXISTS(SELECT 1 FROM organization_identity_groups mapped WHERE mapped.group_id=? AND mapped.organization_id=? AND mapped.updated_at=?)";
  const statements:D1PreparedStatement[]=[env.DB.prepare(`INSERT INTO organization_identity_groups(group_id,organization_id,external_id,name,mapped_role,created_at,updated_at)
    SELECT ?,?,?,?,?,?,? WHERE ${credentialGuard}
    ON CONFLICT(organization_id,external_id) DO UPDATE SET name=excluded.name,mapped_role=excluded.mapped_role,updated_at=excluded.updated_at`)
    .bind(groupId,organizationId,externalId,name,role,now,now,...credentialBindings(credentialId,organizationId))];
  if(members){
    statements.push(env.DB.prepare(`DELETE FROM organization_identity_group_members WHERE group_id=? AND organization_id=? AND ${groupProof}`)
      .bind(groupId,organizationId,groupId,organizationId,now));
    for(const member of members){
      statements.push(env.DB.prepare(`INSERT INTO organization_identity_group_members(group_id,organization_id,user_id,created_at)
        SELECT ?,?,?,? WHERE ${groupProof}
          AND EXISTS(SELECT 1 FROM organization_memberships active WHERE active.organization_id=? AND active.user_id=?
            AND active.role!='owner' AND active.status='active' AND active.revoked_at IS NULL)
          AND(?<>'administrator' OR NOT ${effectivePilotReviewerSql("?","?")})
        ON CONFLICT(group_id,user_id) DO NOTHING`)
        .bind(groupId,organizationId,member,now,groupId,organizationId,now,organizationId,member,role,organizationId,member));
    }
  }
  for(const member of new Set([...previous,...mapped])){
    statements.push(env.DB.prepare(`UPDATE organization_memberships SET role=CASE WHEN EXISTS(
      SELECT 1 FROM organization_identity_group_members membership JOIN organization_identity_groups identity_group
        ON identity_group.group_id=membership.group_id AND identity_group.organization_id=membership.organization_id
      WHERE membership.organization_id=organization_memberships.organization_id AND membership.user_id=organization_memberships.user_id
        AND identity_group.mapped_role='administrator')
      AND NOT ${effectivePilotReviewerSql("organization_memberships.organization_id","organization_memberships.user_id")}
      THEN 'administrator' ELSE 'member' END,updated_at=?
      WHERE organization_id=? AND user_id=? AND role!='owner' AND status='active' AND revoked_at IS NULL AND ${groupProof}`)
      .bind(now,organizationId,member,groupId,organizationId,now));
    statements.push(env.DB.prepare(`UPDATE capability_grants SET status='revoked',revoked_at=?,updated_at=?
      WHERE organization_id=? AND user_id=? AND scope_type='workspace' AND status='active'
        AND EXISTS(SELECT 1 FROM organization_memberships effective
          WHERE effective.organization_id=? AND effective.user_id=? AND effective.role='member' AND effective.updated_at=?)`)
      .bind(now,now,organizationId,member,organizationId,member,now));
    statements.push(env.DB.prepare(`UPDATE project_context_sessions SET revoked_at=?
      WHERE organization_id=? AND principal_user_id=? AND revoked_at IS NULL AND ${groupProof}`)
      .bind(now,organizationId,member,groupId,organizationId,now));
  }
  statements.push(env.DB.prepare(`UPDATE organizations SET updated_at=? WHERE organization_id=? AND status='active' AND ${groupProof}`)
    .bind(now,organizationId,groupId,organizationId,now));
  const results=await env.DB.batch(statements);
  if(Number(results[0]?.meta.changes??0)!==1)return Response.json({error:"provisioning_credentials_required"},{status:401});
  await recordOrganizationAudit(env,organizationId,operator,"OrganizationIdentityGroupMapped","identity-group",groupId,{memberCount:mapped.length});
  return Response.json({groupId,externalId,name,mappedRole:role,...(members?{memberUserIds:members}:{})});
}

/** Scoped provisioning uses one-time owner-created hashed credentials, never an invented enterprise IdP. */
export async function handleProvisioning(request: Request, env: WorkerEnv, path: string[]) {
  await ensureSchema(env);
  const organizationId = path[0] ?? "";
  const authorized = await authenticatedProvisioner(request, env, organizationId);
  if (!authorized) return Response.json({ error: "provisioning_credentials_required" }, { status: 401 });
  if(path[1]==="users"&&path.length===2&&request.method==="POST")return provisionUser(request,env,organizationId,authorized.actor,authorized.credential.credential_id);
  if(path[1]==="users"&&path.length===3&&request.method==="DELETE")return deprovisionUser(env,organizationId,authorized.actor,path[2]??"",authorized.credential.credential_id);
  if(path[1]==="groups"&&path.length===2&&request.method==="POST")return upsertGroup(request,env,organizationId,authorized.actor,authorized.credential.credential_id);
  return new Response("Not found", { status: 404 });
}
