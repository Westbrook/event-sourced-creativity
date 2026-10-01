import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { configuredPilotAdmissionGuard, type PilotUser } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

export type ProductDeliveryPrincipal = Pick<PilotUser, "userId" | "email" | "role" | "authorizationSnapshot">;
export type ProductDeliveryAuthority = { sql: string; bindings: Array<string | number | null> };
/** Same admitted Product principal/capability, not Creator authoring or paid execution. */
export function productDeliveryAuthority(request: Request, env: WorkerEnv, actor: ProductDeliveryPrincipal) {
  const snapshot = actor.authorizationSnapshot;
  if (!snapshot) return { sql: "0", bindings: [] as Array<string | number | null> };
  const cohort = configuredPilotAdmissionGuard(env, actor);
  const encoded = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("forma_impersonation="))?.slice("forma_impersonation=".length) ?? "";
  let impersonation = "";
  try { impersonation = decodeURIComponent(encoded); } catch { /* Same absent-invalid-cookie behavior as requireUser. */ }
  return {
    sql: `EXISTS(SELECT 1 FROM(${PRINCIPAL_WITH_ACCESS_SQL}) principal
      WHERE principal.user_id=? AND principal.email=? AND principal.role=? AND principal.updated_at=?
        AND COALESCE(principal.permission_epoch,'')=? AND COALESCE(principal.grants_json,'[]')=?
        AND COALESCE(principal.organizations_json,'[]')=? AND COALESCE(principal.projects_json,'[]')=?
        AND COALESCE(principal.identity_policies_json,'[]')=? AND COALESCE(principal.approved_canvas_requirements,0)=?
        AND (principal.role='admin' OR EXISTS(SELECT 1 FROM capability_grants grant_row
          WHERE grant_row.user_id=principal.user_id AND grant_row.capability='product.delivery.manage'
            AND grant_row.scope_type='platform' AND grant_row.organization_id IS NULL AND grant_row.project_access_id IS NULL
            AND grant_row.status='active' AND grant_row.revoked_at IS NULL
            AND (grant_row.expires_at IS NULL OR grant_row.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))
        AND (${cohort.sql})
        AND NOT EXISTS(SELECT 1 FROM impersonation_sessions acting
          JOIN replay_personas persona ON persona.persona_id=acting.persona_id AND persona.status='ready'
          JOIN users fictional ON fictional.user_id=acting.fictional_user_id
          WHERE acting.impersonation_id=? AND acting.actor_user_id=principal.user_id AND acting.status='active'
            AND acting.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    bindings: [actor.userId, actor.userId, actor.email, actor.role, snapshot.updatedAt, snapshot.rawEpoch,
      snapshot.grants, snapshot.organizations, snapshot.projects, snapshot.identityPolicies, snapshot.canvasRequirements,
      ...cohort.bindings, impersonation] as Array<string | number | null>,
  };
}


/** Approval is an additional live capability, never implied by manage access. */
export function productDeliveryReleaseAuthority(request: Request, env: WorkerEnv, actor: ProductDeliveryPrincipal): ProductDeliveryAuthority {
  const manage = productDeliveryAuthority(request, env, actor);
  return { sql: `(${manage.sql}) AND EXISTS(SELECT 1 FROM users release_actor WHERE release_actor.user_id=?
    AND (release_actor.role='admin' OR EXISTS(SELECT 1 FROM capability_grants release_grant
      WHERE release_grant.user_id=release_actor.user_id AND release_grant.capability='platform.release.approve'
        AND release_grant.scope_type='platform' AND release_grant.organization_id IS NULL AND release_grant.project_access_id IS NULL
        AND release_grant.status='active' AND release_grant.revoked_at IS NULL
        AND (release_grant.expires_at IS NULL OR release_grant.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))))`,
    bindings: [...manage.bindings, actor.userId] };
}

/** Dependency completeness is re-proved inside the writing transaction. */
export function productDeliveryDependencies(ids: readonly string[], complete: boolean): ProductDeliveryAuthority {
  return { sql: `NOT EXISTS(SELECT 1 FROM json_each(?) expected_dependency WHERE NOT EXISTS(
    SELECT 1 FROM delivery_decisions dependency WHERE dependency.decision_id=expected_dependency.value
      ${complete ? "AND dependency.status IN('passed','approved','completed')" : ""}))`, bindings: [JSON.stringify(ids)] };
}
