import { FORMA_CAPABILITIES, type FormaCapability } from "../src/platform/capabilities.ts";
import { hasCapability } from "./principal-request-core.ts";
import type { PilotUser } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

const CONTEXT_COOKIE="forma_project_context";

export type ProjectRequestContext={
  contextId:string;organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string;
  principalUserId:string;role:string;permissions:FormaCapability[];expiresAt:string;
};

const readCookie=(request:Request,name:string)=>{
  const value=request.headers.get("cookie")?.split(";").map((part)=>part.trim()).find((part)=>part.startsWith(`${name}=`))?.slice(name.length+1)??"";
  try{return decodeURIComponent(value);}catch{return"";}
};

/** Presence only, using the resolver's exact first-cookie/decode semantics; not authority. */
export const hasProjectContextCookie=(request:Request)=>Boolean(readCookie(request,CONTEXT_COOKIE));

export const projectContextCookie=(request:Request,value:string,maxAge:number)=>`${CONTEXT_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol==="https:"?"; Secure":""}`;

export function rejectProjectContext(request:Request,error="project_access_revoked"){
  return Response.json({error},{status:403,headers:{"set-cookie":projectContextCookie(request,"",0),"cache-control":"private, no-store"}});
}

/** Resolve the opaque selection against live membership and migration state on every request. */
export async function readProjectRequestContext(request:Request,env:WorkerEnv,principal:PilotUser):Promise<{context:ProjectRequestContext|null;response:Response|null}>{
  const contextId=readCookie(request,CONTEXT_COOKIE);
  if(!contextId)return{context:null,response:null};
  if(principal.fictional||readCookie(request,"forma_impersonation"))return{context:null,response:Response.json({error:"project_context_impersonation_unavailable"},{status:409,headers:{"set-cookie":projectContextCookie(request,"",0)}})};
  const now=new Date().toISOString();
  const row=await env.DB.prepare(`SELECT context.context_id,context.organization_id,context.project_access_id,context.expires_at,
      project.project_id,project.owner_user_id,CASE WHEN project.owner_user_id=? THEN 'owner' ELSE project_member.role END AS role
    FROM project_context_sessions context
    JOIN organization_projects project ON project.project_access_id=context.project_access_id AND project.organization_id=context.organization_id AND project.status='active'
    JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id AND migration.organization_id=project.organization_id AND migration.status='active'
    JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
    JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
    JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id
      AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
    LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id AND project_member.project_id=project.project_id AND project_member.user_id=? AND project_member.status='active' AND project_member.revoked_at IS NULL
    WHERE context.context_id=? AND context.principal_user_id=? AND context.revoked_at IS NULL AND context.expires_at>?
      AND (project.owner_user_id=? OR project_member.membership_id IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=project.organization_id AND cohort.status IN ('active','paused','closed')
        AND (cohort.status!='closed' OR NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=cohort.organization_id AND successor.status IN ('active','paused')))
        AND NOT EXISTS(SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id AND participant.organization_id=project.organization_id
          AND participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL))`)
    .bind(principal.userId,principal.userId,principal.userId,contextId,principal.userId,now,principal.userId,principal.userId).first<Record<string,unknown>>();
  if(!row)return{context:null,response:rejectProjectContext(request)};
  const scope={organizationId:String(row.organization_id),projectAccessId:String(row.project_access_id)};
  if(!hasCapability(principal,"project.read",scope))return{context:null,response:rejectProjectContext(request)};
  const permissions=FORMA_CAPABILITIES.filter((capability)=>capability.startsWith("project.")&&hasCapability(principal,capability,scope));
  const effectiveRole=principal.access.projects.find((project)=>project.organizationId===scope.organizationId&&project.projectAccessId===scope.projectAccessId)?.role??String(row.role);
  return{response:null,context:{contextId,organizationId:scope.organizationId,projectAccessId:scope.projectAccessId,projectId:String(row.project_id),ownerUserId:String(row.owner_user_id),principalUserId:principal.userId,role:effectiveRole,permissions,expiresAt:String(row.expires_at)}};
}
