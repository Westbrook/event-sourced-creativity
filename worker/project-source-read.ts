import type { WorkerEnv } from "./runtime.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import { assistantOwnSendGuard, assistantOwnSendProjectIndexGuard, type AssistantOwnSendFootprint } from "./assistant-context-source.ts";

export type ProjectSourceScope={organizationId:string;projectAccessId:string;projectId:string;ownerUserId:string};

export function projectSourceProjectionAssertion(scope:ProjectSourceScope,head:{sql:string;bindings:Readonly<BudgetReservationGuard["bindings"]>}|null){
  return {sql:`EXISTS(SELECT 1 FROM project_migration_states migration
    JOIN organization_projects project ON project.project_access_id=migration.project_access_id AND project.organization_id=migration.organization_id
      AND project.owner_user_id=migration.owner_user_id AND project.status='active'
    JOIN organizations organization ON organization.organization_id=project.organization_id AND organization.status='active'
    WHERE migration.project_access_id=? AND migration.organization_id=? AND migration.owner_user_id=? AND project.project_id=?
      AND migration.status='active'${head?` AND ${head.sql}`:""}
      AND EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.project_access_id=migration.project_access_id
        AND resource.organization_id=migration.organization_id AND resource.project_id=project.project_id AND resource.owner_user_id=migration.owner_user_id
        AND resource.resource_kind='manifest_version' AND resource.resource_id='canvas-v1'))`,
    bindings:[scope.projectAccessId,scope.organizationId,scope.ownerUserId,scope.projectId,...(head?.bindings??[])]};
}

/** A read may require a current projection, but cannot reactivate or repair one. */
export function projectSourceProjectionCurrentAssertion(scope:ProjectSourceScope,own?:AssistantOwnSendFootprint){
  if(own&&(!own.scope||own.streamId!=="creative:"+scope.ownerUserId||own.scope.organizationId!==scope.organizationId
    ||own.scope.projectAccessId!==scope.projectAccessId||own.scope.projectId!==scope.projectId||own.scope.ownerUserId!==scope.ownerUserId))throw new Error("context_own_send_scope");
  const suffix=own?assistantOwnSendGuard(own):null;
  const index=own?assistantOwnSendProjectIndexGuard(own,true):null,partialIndex=own?assistantOwnSendProjectIndexGuard(own):null;
  const head=own?`(migration.last_owner_sequence=? OR migration.last_owner_sequence=? AND (${index!.sql}))`:"migration.last_owner_sequence=(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)";
  const current=projectSourceProjectionAssertion(scope,{sql:head,bindings:own?[own.sourceHead,own.sourceHead+own.eventWrites.length,...index!.bindings]:[`creative:${scope.ownerUserId}`]});
  return suffix?{sql:`(${current.sql}) AND ((${suffix.sql}) AND (${partialIndex!.sql}))`,bindings:[...current.bindings,...suffix.bindings,...partialIndex!.bindings]}:current;
}

/** Shared source SELECT for ordinary refresh and guarded read-only Output execution. */
export function prepareProjectSourceEventsStatement(env:WorkerEnv,scope:ProjectSourceScope){
  return env.DB.prepare(`SELECT event.*,secret.private_json FROM project_event_scopes scope JOIN events event ON event.event_id=scope.event_id
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
    WHERE scope.project_access_id=? AND scope.organization_id=? AND scope.project_id=? AND scope.owner_user_id=?
    ORDER BY scope.project_sequence`).bind(scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId);
}
