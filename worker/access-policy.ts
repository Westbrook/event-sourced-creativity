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
  deniedOrganizationIds?: string[];
  identityPolicyDeniedCustody?: boolean;
};

/** An effective managed cohort hides its tenant from anyone without current named enrollment. */
export const effectivePilotParticipantSql=(organizationId:string,userId:string)=>`NOT EXISTS(
  SELECT 1 FROM pilot_cohorts effective_cohort
  WHERE effective_cohort.organization_id=${organizationId} AND effective_cohort.status IN ('active','paused','closed')
    AND (effective_cohort.status!='closed' OR NOT EXISTS(
      SELECT 1 FROM pilot_cohorts effective_successor
      WHERE effective_successor.organization_id=effective_cohort.organization_id AND effective_successor.status IN ('active','paused')
    ))
    AND NOT EXISTS(
      SELECT 1 FROM pilot_participants effective_participant
      WHERE effective_participant.cohort_id=effective_cohort.cohort_id
        AND effective_participant.organization_id=effective_cohort.organization_id
        AND effective_participant.user_id=${userId}
        AND effective_participant.status='active' AND effective_participant.revoked_at IS NULL
    )
)`;

/** Named reviewers retain read/review access but never inherit earlier project authoring. */
export const effectivePilotReviewerSql=(organizationId:string,userId:string)=>`EXISTS(
  SELECT 1 FROM pilot_cohorts reviewer_cohort
    JOIN pilot_participants reviewer_participant ON reviewer_participant.cohort_id=reviewer_cohort.cohort_id
      AND reviewer_participant.organization_id=reviewer_cohort.organization_id
  WHERE reviewer_cohort.organization_id=${organizationId} AND reviewer_cohort.status IN ('active','paused','closed')
    AND (reviewer_cohort.status!='closed' OR NOT EXISTS(
      SELECT 1 FROM pilot_cohorts reviewer_successor
      WHERE reviewer_successor.organization_id=reviewer_cohort.organization_id AND reviewer_successor.status IN ('active','paused')
    ))
    AND reviewer_participant.user_id=${userId} AND reviewer_participant.status='active'
    AND reviewer_participant.revoked_at IS NULL AND reviewer_participant.role='reviewer'
)`;

const CREATOR_PROJECT_NAME_SQL = `COALESCE((SELECT CASE event.type WHEN 'ProjectRenamed' THEN json_extract(COALESCE(secret.private_json,event.payload),'$.new_name') ELSE json_extract(COALESCE(secret.private_json,event.payload),'$.name') END
        FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
        LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
        WHERE scope.project_access_id=project.project_access_id AND scope.organization_id=project.organization_id
          AND event.type IN ('ProjectCreated','ProjectRenamed')
        ORDER BY scope.project_sequence DESC LIMIT 1),'')`;

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
            AND ${effectivePilotParticipantSql("organization.organization_id","principal.user_id")}
            AND NOT ${effectivePilotReviewerSql("organization.organization_id","principal.user_id")}
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
            AND ${effectivePilotParticipantSql("organization.organization_id","principal.user_id")}
            AND (grant_row.capability IN ('project.read','project.review.approve')
              OR NOT ${effectivePilotReviewerSql("organization.organization_id","principal.user_id")})
        ))
      )), '[]') AS grants_json,
    COALESCE((SELECT json_group_array(json_object(
      'organizationId', organization.organization_id, 'name', organization.name,
      'role', CASE WHEN ${effectivePilotReviewerSql("organization.organization_id","principal.user_id")} THEN 'member' ELSE membership.role END
    )) FROM organization_memberships membership
      JOIN organizations organization ON organization.organization_id=membership.organization_id
      WHERE membership.user_id=principal.user_id AND membership.status='active'
        AND membership.accepted_at IS NOT NULL AND membership.revoked_at IS NULL AND organization.status='active'
        AND ${effectivePilotParticipantSql("organization.organization_id","principal.user_id")}), '[]') AS organizations_json,
    COALESCE((SELECT json_group_array(json_object(
      'projectAccessId', project.project_access_id, 'projectId', project.project_id,
      'projectName', ${CREATOR_PROJECT_NAME_SQL},
      'organizationId', project.organization_id,
      'role', CASE WHEN ${effectivePilotReviewerSql("organization.organization_id","principal.user_id")} THEN 'viewer'
        WHEN project.owner_user_id=principal.user_id THEN 'owner' ELSE project_member.role END
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
      WHERE project.status='active' AND (project.owner_user_id=principal.user_id OR project_member.membership_id IS NOT NULL)
        AND ${effectivePilotParticipantSql("organization.organization_id","principal.user_id")}), '[]') AS projects_json,
    COALESCE((SELECT json_group_array(json_object(
      'organizationId',policy.organization_id,'authenticationSource',policy.authentication_source,
      'allowedDomainsJson',policy.allowed_domains_json,'requireMfa',policy.require_mfa,'version',policy.version,
      'bindingStatus',identity.status,'bindingSource',identity.authentication_source,'bindingSubject',identity.subject,
      'ownsData',CASE WHEN organization.owner_user_id=principal.user_id OR EXISTS(
        SELECT 1 FROM organization_projects owned WHERE owned.organization_id=policy.organization_id
          AND owned.owner_user_id=principal.user_id AND owned.status='active') THEN 1 ELSE 0 END
    )) FROM organization_security_policies policy
      JOIN organizations organization ON organization.organization_id=policy.organization_id AND organization.status='active'
      JOIN organization_memberships policy_membership ON policy_membership.organization_id=policy.organization_id
        AND policy_membership.user_id=principal.user_id AND policy_membership.status='active'
        AND policy_membership.accepted_at IS NOT NULL AND policy_membership.revoked_at IS NULL
      LEFT JOIN organization_identity_bindings identity ON identity.organization_id=policy.organization_id AND identity.user_id=principal.user_id
    ),'[]') AS identity_policies_json,
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
        WHERE membership.user_id=principal.user_id), ''),
      COALESCE((SELECT MAX(policy.updated_at) FROM organization_security_policies policy
        JOIN organization_memberships membership ON membership.organization_id=policy.organization_id
        WHERE membership.user_id=principal.user_id), ''),
      COALESCE((SELECT MAX(binding.updated_at) FROM organization_identity_bindings binding WHERE binding.user_id=principal.user_id), '')
    ) AS permission_epoch
  FROM (SELECT * FROM users WHERE user_id=?) principal
`;

/** Platform authorization preserves exact policy epochs without ever selecting creator events, payloads, or names. */
export const PLATFORM_PRINCIPAL_WITH_ACCESS_SQL = PRINCIPAL_WITH_ACCESS_SQL.replace(CREATOR_PROJECT_NAME_SQL, "''");

function parseList<T>(value: unknown): T[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

type ObservedIdentity = { email: string; source: string; subject: string };

export async function principalAccessFromRow(row: Record<string, unknown>, role: string, observed?: ObservedIdentity): Promise<PrincipalAccess> {
  const policies = parseList<{ organizationId: string; authenticationSource: string; allowedDomainsJson: string; requireMfa: number; version: number; bindingStatus: string | null; bindingSource: string | null; bindingSubject: string | null; ownsData: number }>(row.identity_policies_json);
  const deniedPolicies = policies.filter((policy) => {
    let domains: unknown;
    try { domains = JSON.parse(policy.allowedDomainsJson); } catch { return true; }
    if (!Array.isArray(domains) || domains.some((domain) => typeof domain !== "string")) return true;
    if (Number(policy.requireMfa) !== 0) return true;
    if (!["any", "openai-workspace", "cloudflare-access", "local-development"].includes(policy.authenticationSource)) return true;
    if (!observed) return policy.authenticationSource !== "any" || domains.length > 0 || Boolean(policy.bindingStatus);
    if (policy.authenticationSource !== "any" && policy.authenticationSource !== observed.source) return true;
    const domain = observed.email.toLowerCase().split("@").at(-1) ?? "";
    if (domains.length && !domains.includes(domain)) return true;
    return Boolean(policy.bindingStatus && (policy.bindingStatus !== "active" || policy.bindingSource !== observed.source || policy.bindingSubject !== observed.subject));
  });
  const blocked = new Set(deniedPolicies.map((policy) => policy.organizationId));
  const grants = parseList<ScopedCapability>(row.grants_json).filter((grant) => {
    if (!isFormaCapability(grant.capability) || capabilityScopeFor(grant.capability) !== grant.scope) return false;
    if (grant.organizationId && blocked.has(grant.organizationId)) return false;
    if (grant.scope === "workspace") return Boolean(grant.organizationId) && !grant.projectAccessId;
    if (grant.scope === "project") return Boolean(grant.organizationId && grant.projectAccessId);
    return !grant.organizationId && !grant.projectAccessId;
  });
  const organizations = parseList<OrganizationAccess>(row.organizations_json).filter((organization) => Boolean(organization.organizationId) && !blocked.has(organization.organizationId));
  const projects = parseList<PrincipalAccess["projects"][number]>(row.projects_json)
    .filter((project) => Boolean(project.projectAccessId && project.organizationId && project.projectId) && !blocked.has(project.organizationId));
  const canvasAccess=role==="admin"||(role==="creator"||role==="viewer")&&Number(row.approved_canvas_requirements??0)===3;
  const capabilities = new Set<FormaCapability>(role === "creator" || role === "admin" ? CREATOR_CAPABILITIES : SELF_CAPABILITIES);
  if (projects.length) capabilities.add("project.read");
  if(projects.some((project)=>project.role==="owner"||project.role==="editor")){
    capabilities.add("project.author");
    capabilities.add("project.library.manage");
    capabilities.add("project.output.request");
  }
  if(projects.some((project)=>project.role==="owner"))capabilities.add("project.review.approve");
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
    ...policies.map((policy)=>`i:${policy.organizationId}:${policy.version}:${blocked.has(policy.organizationId)?"denied":"allowed"}`),
  ].sort().join(";");
  const source=`${String(row.permission_epoch??row.updated_at??"")}|${canvasAccess?"canvas":"no-canvas"}|${fingerprint}`;
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(source));
  const permissionEpoch=Array.from(new Uint8Array(digest),(byte)=>byte.toString(16).padStart(2,"0")).join("");
  return { capabilities: [...capabilities], grants, organizations, projects, permissionEpoch,canvasAccess,deniedOrganizationIds:[...blocked],identityPolicyDeniedCustody:deniedPolicies.some((policy)=>Boolean(policy.ownsData)) };
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
  if(capability==="project.review.approve"){
    if(project.role==="owner")return true;
    return access.grants.some((grant)=>grant.capability===capability&&grant.projectAccessId===scope.projectAccessId&&grant.organizationId===scope.organizationId);
  }
  if (project.role === "owner" || project.role === "editor") return true;
  if (project.role === "viewer") return capability === "project.read";
  return access.grants.some((grant) => grant.capability === capability
    && grant.projectAccessId === scope.projectAccessId
    && grant.organizationId === scope.organizationId);
}
