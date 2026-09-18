const intEnv = (value: string | undefined, fallback: number) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback; };

const activeProjectBillingSql=`EXISTS(SELECT 1 FROM organization_projects project
  JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
  JOIN organization_memberships member ON member.organization_id=project.organization_id AND member.user_id=? AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
  JOIN organization_memberships owner_member ON owner_member.organization_id=project.organization_id AND owner_member.user_id=project.owner_user_id
    AND owner_member.status='active' AND owner_member.accepted_at IS NOT NULL AND owner_member.revoked_at IS NULL
  LEFT JOIN project_memberships project_member ON project_member.project_access_id=project.project_access_id AND project_member.organization_id=project.organization_id AND project_member.project_id=project.project_id
    AND project_member.user_id=? AND project_member.status='active' AND project_member.revoked_at IS NULL
  WHERE project.project_access_id=? AND project.organization_id=? AND project.status='active' AND (project.owner_user_id=? OR project_member.role IN('owner','editor')))`;

export { intEnv, activeProjectBillingSql };
