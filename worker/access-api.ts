import { capabilityScopeFor, isFormaCapability, type FormaCapability } from "../src/platform/capabilities.ts";
import { hasCapability, requireCapability } from "./pilot-policy.ts";
import { appendAuditEvent, uuidV7, type WorkerEnv } from "./runtime.ts";

type GrantInput = { userId?: string; capability?: string; organizationId?: string; projectAccessId?: string; expiresAt?: string };
const ADMIN_APPROVAL_CAPABILITIES=new Set(["platform.identity.manage","platform.provider.activate","platform.release.approve","evaluation.actual.approve","evaluation.actual.run"]);

/** Platform identity operators issue explicit privileges without changing a person's global role. */
export async function handleCapabilityGrants(request: Request, env: WorkerEnv, grantId = "") {
  const authorization = await requireCapability(request, env, "platform.identity.manage");
  if (authorization.response || !authorization.user) return authorization.response!;
  const actor = authorization.user;

  if (request.method === "GET") {
    const now = new Date().toISOString();
    const rows = await env.DB.prepare(`SELECT grants.grant_id,grants.user_id,users.display_name,users.email,grants.capability,
      grants.scope_type,grants.organization_id,grants.project_access_id,grants.status,grants.expires_at,grants.created_at
      FROM capability_grants grants JOIN users ON users.user_id=grants.user_id
      WHERE grants.status='active' AND grants.revoked_at IS NULL AND (grants.expires_at IS NULL OR grants.expires_at>?)
      ORDER BY grants.created_at DESC LIMIT 200`).bind(now).all();
    return Response.json({ grants: rows.results }, { headers: { "cache-control": "private, no-store" } });
  }

  if (request.method === "DELETE") {
    if (!grantId) return Response.json({ error: "grant_required" }, { status: 400 });
    const grant=await env.DB.prepare("SELECT grant_id,user_id,capability,scope_type,organization_id,project_access_id FROM capability_grants WHERE grant_id=? AND status='active' AND revoked_at IS NULL")
      .bind(grantId).first<{grant_id:string;user_id:string;capability:string;scope_type:string;organization_id:string|null;project_access_id:string|null}>();
    if(!grant)return Response.json({error:"grant_not_found"},{status:404});
    if(!isFormaCapability(grant.capability)||capabilityScopeFor(grant.capability)!==grant.scope_type)return Response.json({error:"invalid_capability_grant"},{status:409});
    if(grant.user_id===actor.userId)return Response.json({error:"self_privilege_revocation_forbidden"},{status:403});
    if(!hasCapability(actor,grant.capability,{organizationId:grant.organization_id,projectAccessId:grant.project_access_id}))return Response.json({error:"capability_delegation_forbidden"},{status:403});
    if(ADMIN_APPROVAL_CAPABILITIES.has(grant.capability)&&actor.role!=="admin")return Response.json({error:"administrator_approval_required"},{status:403});
    const now = new Date().toISOString();
    const result=await env.DB.prepare("UPDATE capability_grants SET status='revoked',revoked_at=?,updated_at=? WHERE grant_id=? AND user_id=? AND capability=? AND scope_type=? AND COALESCE(organization_id,'')=? AND COALESCE(project_access_id,'')=? AND status='active' AND revoked_at IS NULL")
      .bind(now,now,grantId,grant.user_id,grant.capability,grant.scope_type,grant.organization_id??"",grant.project_access_id??"").run();
    if (Number(result.meta.changes ?? 0) !== 1) return Response.json({ error: "grant_not_found" }, { status: 404 });
    await appendAuditEvent(env,actor.streamId,"user","CapabilityRevoked",{grant_id:grantId,principal_user_id:actor.userId,subject_user_id:grant.user_id,capability:grant.capability,scope_type:grant.scope_type,organization_id:grant.organization_id,project_access_id:grant.project_access_id});
    return Response.json({ ok: true });
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.json().catch(() => ({})) as GrantInput;
  if (!body.userId || !isFormaCapability(body.capability)) return Response.json({ error: "valid_user_and_capability_required" }, { status: 400 });
  const capability: FormaCapability = body.capability;
  const scope = capabilityScopeFor(capability);
  if(body.userId===actor.userId)return Response.json({error:"self_privilege_escalation_forbidden"},{status:403});
  if(!hasCapability(actor,capability,{organizationId:body.organizationId,projectAccessId:body.projectAccessId}))return Response.json({error:"capability_delegation_forbidden"},{status:403});
  if(ADMIN_APPROVAL_CAPABILITIES.has(capability)&&actor.role!=="admin")return Response.json({error:"administrator_approval_required"},{status:403});
  if (scope === "self") return Response.json({ error: "self_capabilities_are_not_delegated" }, { status: 400 });
  if ((scope === "workspace" || scope === "project") && !body.organizationId) return Response.json({ error: "organization_scope_required" }, { status: 400 });
  if (scope === "project" && !body.projectAccessId) return Response.json({ error: "project_scope_required" }, { status: 400 });
  if(scope!=="project"&&body.projectAccessId)return Response.json({error:"unexpected_project_scope"},{status:400});
  if ((scope === "platform" || scope === "synthetic") && (body.organizationId || body.projectAccessId)) return Response.json({ error: "unexpected_resource_scope" }, { status: 400 });
  const target = await env.DB.prepare("SELECT user_id FROM users WHERE user_id=?").bind(body.userId).first();
  if (!target) return Response.json({ error: "user_not_found" }, { status: 404 });
  if (body.organizationId) {
    const membership = await env.DB.prepare("SELECT membership_id FROM organization_memberships WHERE organization_id=? AND user_id=? AND status='active' AND accepted_at IS NOT NULL AND revoked_at IS NULL").bind(body.organizationId, body.userId).first();
    if (!membership) return Response.json({ error: "active_organization_membership_required" }, { status: 403 });
  }
  if (body.projectAccessId) {
    const project = await env.DB.prepare("SELECT project.project_id FROM organization_projects project JOIN project_memberships member ON member.project_access_id=project.project_access_id AND member.organization_id=project.organization_id AND member.project_id=project.project_id WHERE project.project_access_id=? AND project.organization_id=? AND member.user_id=? AND project.status='active' AND member.status='active' AND member.revoked_at IS NULL").bind(body.projectAccessId, body.organizationId, body.userId).first<{ project_id: string }>();
    if (!project) return Response.json({ error: "active_project_membership_required" }, { status: 403 });
  }
  const now = new Date();
  const expiry=body.expiresAt?Date.parse(body.expiresAt):null;
  if(expiry!==null&&(!Number.isFinite(expiry)||expiry<=now.getTime()))return Response.json({error:"future_expiry_required"},{status:400});
  const normalizedExpiry=expiry===null?null:new Date(expiry).toISOString();
  const timestamp=now.toISOString();
  const id = uuidV7();
  await env.DB.prepare("INSERT INTO capability_grants (grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at,expires_at,revoked_at) VALUES (?,?,?,?,?,?,NULL,'active',?,?,?,?,NULL)")
    .bind(id, body.userId, capability, scope, body.organizationId ?? null, body.projectAccessId ?? null, actor.userId, timestamp, timestamp, normalizedExpiry).run();
  await appendAuditEvent(env, actor.streamId, "user", "CapabilityGranted", { grant_id: id, subject_user_id: body.userId, capability, scope_type: scope, organization_id: body.organizationId ?? null, project_access_id: body.projectAccessId ?? null });
  return Response.json({ ok: true, grantId: id }, { status: 201 });
}
