import {
  CREATOR_CAPABILITIES,
  PLATFORM_ADMIN_CAPABILITIES,
  SELF_CAPABILITIES,
  WORKSPACE_OWNER_CAPABILITIES,
  capabilityScopeFor,
  isFormaCapability,
  type FormaCapability,
  type ScopedCapability,
} from "../src/platform/capabilities.ts";
import { CURRENT_CANVAS_ADAPTER_APPROVAL_SQL } from "./canvas-governance-policy.ts";

export type OrganizationAccess = {
  organizationId: string;
  name: string;
  role: "owner" | "administrator" | "member";
};

export type PrincipalAccess = {
  capabilities: FormaCapability[];
  grants: ScopedCapability[];
  organizations: OrganizationAccess[];
  projects: Array<{ projectAccessId: string; projectId: string; projectName:string; organizationId: string; role: string }>;
  permissionEpoch: string;
  canvasAccess:boolean;
};

/** One indexed user query resolves active grants and accepted parent scopes atomically. */
export const PRINCIPAL_WITH_ACCESS_SQL = `
  SELECT principal.*,
    COALESCE((SELECT json_group_array(json_object(
      'capability', grant_row.capability, 'scope', grant_row.scope_type,
      'organizationId', grant_row.organization_id, 'projectAccessId', grant_row.project_access_id,
      'expiresAt', grant_row.expires_at
    )) FROM capability_grants grant_row
    WHERE grant_row.user_id=principal.user_id AND grant_row.status='active'
      AND grant_row.revoked_at IS NULL AND (grant_row.expires_at IS NULL OR grant_row.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND (
        grant_row.scope_type IN ('platform','synthetic','self')
        OR (grant_row.scope_type='workspace' AND EXISTS (
          SELECT 1 FROM organizations organization
          JOIN organization_memberships membership ON membership.organization_id=organization.organization_id
          WHERE organization.organization_id=grant_row.organization_id AND organization.status='active'
            AND membership.user_id=principal.user_id AND membership.status='active'
            AND membership.accepted_at IS NOT NULL AND membership.revoked_at IS NULL
        ))
        OR (grant_row.scope_type='project' AND EXISTS (
          SELECT 1 FROM organization_projects project
          JOIN organizations organization ON organization.organization_id=project.organization_id
          JOIN organization_memberships membership ON membership.organization_id=organization.organization_id
            AND membership.user_id=principal.user_id
          JOIN organization_memberships owner_membership ON owner_membership.organization_id=organization.organization_id
            AND owner_membership.user_id=project.owner_user_id AND owner_membership.status='active'
            AND owner_membership.accepted_at IS NOT NULL AND owner_membership.revoked_at IS NULL
          LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id
            AND project_member.user_id=principal.user_id AND project_member.organization_id=project.organization_id
            AND project_member.project_id=project.project_id
          WHERE project.project_access_id=grant_row.project_access_id AND project.organization_id=grant_row.organization_id
            AND project.status='active' AND organization.status='active' AND membership.status='active'
            AND membership.accepted_at IS NOT NULL AND membership.revoked_at IS NULL
            AND (project.owner_user_id=principal.user_id OR (project_member.status='active' AND project_member.revoked_at IS NULL))
        ))
      )), '[]') AS grants_json,
    COALESCE((SELECT json_group_array(json_object(
      'organizationId', organization.organization_id, 'name', organization.name, 'role', membership.role
    )) FROM organization_memberships membership
      JOIN organizations organization ON organization.organization_id=membership.organization_id
      WHERE membership.user_id=principal.user_id AND membership.status='active'
        AND membership.accepted_at IS NOT NULL AND membership.revoked_at IS NULL AND organization.status='active'), '[]') AS organizations_json,
    COALESCE((SELECT json_group_array(json_object(
      'projectAccessId', project.project_access_id, 'projectId', project.project_id,
      'projectName', COALESCE((SELECT CASE event.type WHEN 'ProjectRenamed' THEN json_extract(event.payload,'$.new_name') ELSE json_extract(event.payload,'$.name') END
        FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
        WHERE scope.project_access_id=project.project_access_id AND scope.organization_id=project.organization_id
          AND event.type IN ('ProjectCreated','ProjectRenamed')
        ORDER BY scope.project_sequence DESC LIMIT 1),''),
      'organizationId', project.organization_id,
      'role', CASE WHEN project.owner_user_id=principal.user_id THEN 'owner' ELSE project_member.role END
    )) FROM organization_projects project
      JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
      JOIN organization_memberships membership ON membership.organization_id=project.organization_id
        AND membership.user_id=principal.user_id AND membership.status='active'
        AND membership.accepted_at IS NOT NULL AND membership.revoked_at IS NULL
      JOIN organization_memberships owner_membership ON owner_membership.organization_id=project.organization_id
        AND owner_membership.user_id=project.owner_user_id AND owner_membership.status='active'
        AND owner_membership.accepted_at IS NOT NULL AND owner_membership.revoked_at IS NULL
      LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id
        AND project_member.organization_id=project.organization_id AND project_member.project_id=project.project_id
        AND project_member.user_id=principal.user_id AND project_member.status='active' AND project_member.revoked_at IS NULL
      WHERE project.status='active' AND (project.owner_user_id=principal.user_id OR project_member.membership_id IS NOT NULL)), '[]') AS projects_json,
    (SELECT COUNT(DISTINCT requirement_id) FROM canvas_governance_requirements
      WHERE requirement_id IN ('trust_safety','counsel','second_image_adapter') AND status='approved' AND json_valid(details_json)
        AND (${CURRENT_CANVAS_ADAPTER_APPROVAL_SQL})) AS approved_canvas_requirements,
    MAX(
      principal.updated_at,
      COALESCE((SELECT MAX(updated_at) FROM capability_grants WHERE user_id=principal.user_id), ''),
      COALESCE((SELECT MAX(updated_at) FROM organization_memberships WHERE user_id=principal.user_id), ''),
      COALESCE((SELECT MAX(updated_at) FROM project_memberships WHERE user_id=principal.user_id), ''),
      COALESCE((SELECT MAX(organization.updated_at) FROM organizations organization
        JOIN organization_memberships membership ON membership.organization_id=organization.organization_id
        WHERE membership.user_id=principal.user_id), ''),
      COALESCE((SELECT MAX(project.updated_at) FROM organization_projects project
        JOIN organization_memberships membership ON membership.organization_id=project.organization_id
        WHERE membership.user_id=principal.user_id), '')
    ) AS permission_epoch
  FROM (SELECT * FROM users WHERE user_id=?) principal
`;

function parseList<T>(value: unknown): T[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export async function principalAccessFromRow(row: Record<string, unknown>, role: string): Promise<PrincipalAccess> {
  const grants = parseList<ScopedCapability>(row.grants_json).filter((grant) => {
    if (!isFormaCapability(grant.capability) || capabilityScopeFor(grant.capability) !== grant.scope) return false;
    if (grant.scope === "workspace") return Boolean(grant.organizationId) && !grant.projectAccessId;
    if (grant.scope === "project") return Boolean(grant.organizationId && grant.projectAccessId);
    return !grant.organizationId && !grant.projectAccessId;
  });
  const organizations = parseList<OrganizationAccess>(row.organizations_json).filter((organization) => Boolean(organization.organizationId));
  const projects = parseList<PrincipalAccess["projects"][number]>(row.projects_json)
    .filter((project) => Boolean(project.projectAccessId && project.organizationId && project.projectId));
  const canvasAccess=role==="admin"||(role==="creator"||role==="viewer")&&Number(row.approved_canvas_requirements??0)===3;
  const capabilities = new Set<FormaCapability>(role === "creator" || role === "admin" ? CREATOR_CAPABILITIES : SELF_CAPABILITIES);
  if (projects.length) capabilities.add("project.read");
  if(projects.some((project)=>project.role==="owner"||project.role==="editor")){
    capabilities.add("project.author");
    capabilities.add("project.library.manage");
    capabilities.add("project.output.request");
  }
  if(canvasAccess&&projects.some((project)=>project.role==="owner"))capabilities.add("project.canvas.use");
  if (role === "admin") PLATFORM_ADMIN_CAPABILITIES.forEach((capability) => capabilities.add(capability));
  for (const grant of grants) capabilities.add(grant.capability);
  for (const membership of organizations) {
    if (membership.role === "owner" || membership.role === "administrator") {
      WORKSPACE_OWNER_CAPABILITIES.forEach((capability) => capabilities.add(capability));
    }
  }
  // A timestamp alone does not change when a grant expires naturally or when
  // multiple authorization updates land in the same clock tick.
  const fingerprint=[
    ...grants.map((grant)=>`g:${grant.capability}:${grant.scope}:${grant.organizationId??""}:${grant.projectAccessId??""}:${grant.expiresAt??""}`),
    ...organizations.map((organization)=>`o:${organization.organizationId}:${organization.role}`),
    ...projects.map((project)=>`p:${project.organizationId}:${project.projectAccessId}:${project.role}`),
  ].sort().join(";");
  const source=`${String(row.permission_epoch??row.updated_at??"")}|${canvasAccess?"canvas":"no-canvas"}|${fingerprint}`;
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(source));
  const permissionEpoch=Array.from(new Uint8Array(digest),(byte)=>byte.toString(16).padStart(2,"0")).join("");
  return { capabilities: [...capabilities], grants, organizations, projects, permissionEpoch,canvasAccess };
}

export function principalHasCapability(
  access: PrincipalAccess,
  capability: FormaCapability,
  scope?: { organizationId?: string | null; projectAccessId?: string | null },
) {
  if (!access.capabilities.includes(capability)) return false;
  const kind = capabilityScopeFor(capability);
  if (kind === "self" || kind === "synthetic" || kind === "platform") return true;
  if (kind === "workspace") {
    if(!scope?.organizationId)return false;
    return access.organizations.some((organization) =>
      organization.organizationId === scope.organizationId
      && ((organization.role === "owner" || organization.role === "administrator")
        || access.grants.some((grant) => grant.capability === capability && grant.organizationId === organization.organizationId)),
    );
  }
  if (!scope?.projectAccessId||!scope.organizationId) return false;
  const project = access.projects.find((candidate) => candidate.projectAccessId === scope.projectAccessId
    && candidate.organizationId === scope.organizationId);
  if (!project) return false;
  if(capability==="project.canvas.use"){
    if(!access.canvasAccess)return false;
    if(project.role==="owner")return true;
    return access.grants.some((grant)=>grant.capability===capability&&grant.projectAccessId===scope.projectAccessId&&grant.organizationId===scope.organizationId);
  }
  if (project.role === "owner" || project.role === "editor") return true;
  if (project.role === "viewer") return capability === "project.read";
  return access.grants.some((grant) => grant.capability === capability
    && grant.projectAccessId === scope.projectAccessId
    && grant.organizationId === scope.organizationId);
}
