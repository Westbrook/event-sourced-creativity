import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import type { BudgetReservationGuard, PilotImpersonation, PilotUser } from "./pilot-policy.ts";
import type { ConsequentialBinding } from "./consequential-consent.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { SponsorIntakePostNativeReceipt } from "./experience-sponsor-intake-reads.ts";
import type { ProjectIntake } from "../src/model/project-intake.ts";

export type ProjectIntakeAuthorization={user:PilotUser;principal:PilotUser;impersonation:PilotImpersonation|null};

/** The same captured authorization must still exist at the SQL mutation boundary. */
export function executionAdmissionGuard(user:PilotUser,binding:ConsequentialBinding,sourceHead:number|null,paid=false){
  const snapshot=user.authorizationSnapshot;
  if(!snapshot)return{sql:"0",bindings:[] as Array<string|number|null>};
  const scope=binding.scope;
  const custody=scope?`EXISTS(SELECT 1 FROM organization_projects project
    JOIN project_migration_states migration ON migration.project_access_id=project.project_access_id
      AND migration.organization_id=project.organization_id AND migration.owner_user_id=project.owner_user_id AND migration.status='active'
    WHERE project.project_access_id=? AND project.organization_id=? AND project.project_id=? AND project.owner_user_id=? AND project.status='active')`
    :`NOT EXISTS(SELECT 1 FROM organization_projects project WHERE project.owner_user_id=? AND project.project_id=?)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.owner_user_id=? AND resource.resource_kind='document' AND resource.resource_id=?)`;
  const now=new Date().toISOString();
  const session=binding.contextSessionId?` AND EXISTS(SELECT 1 FROM project_context_sessions selected_session WHERE selected_session.context_id=?
    AND selected_session.principal_user_id=? AND selected_session.organization_id=? AND selected_session.project_access_id=?
    AND selected_session.revoked_at IS NULL AND selected_session.expires_at>? AND selected_session.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`:"";
  const pilot=!paid?"":binding.pilotCohortId?` AND EXISTS(SELECT 1 FROM pilot_cohorts cohort JOIN pilot_participants participant
    ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
    WHERE cohort.cohort_id=? AND cohort.organization_id=? AND cohort.status='active' AND cohort.starts_at<=? AND cohort.ends_at>? AND cohort.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL AND participant.role!='reviewer')`
    :` AND NOT EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.status IN('active','paused','closed')
      AND (cohort.organization_id=? OR EXISTS(SELECT 1 FROM pilot_participants participant WHERE participant.cohort_id=cohort.cohort_id
        AND participant.user_id=? AND participant.status='active' AND participant.revoked_at IS NULL)))`;
  return{sql:`EXISTS(SELECT 1 FROM(${PRINCIPAL_WITH_ACCESS_SQL}) principal WHERE principal.user_id=? AND principal.role=?
    AND principal.updated_at=? AND principal.consent_version=? AND COALESCE(principal.permission_epoch,'')=?
    AND COALESCE(principal.grants_json,'[]')=? AND COALESCE(principal.organizations_json,'[]')=?
    AND COALESCE(principal.projects_json,'[]')=? AND COALESCE(principal.identity_policies_json,'[]')=?
    AND COALESCE(principal.approved_canvas_requirements,0)=?)
    ${sourceHead===null?"":"AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?"} AND ${custody}${session}${pilot}`,
    bindings:[user.userId,user.userId,user.role,snapshot.updatedAt,POLICY_VERSION,snapshot.rawEpoch,snapshot.grants,snapshot.organizations,snapshot.projects,snapshot.identityPolicies,snapshot.canvasRequirements,...(sourceHead===null?[]:[binding.streamId,sourceHead]),
      ...(scope?[scope.projectAccessId,scope.organizationId,binding.projectId,scope.ownerUserId]:[user.userId,binding.projectId,user.userId,binding.documentId]),
      ...(binding.contextSessionId?[binding.contextSessionId,user.userId,scope?.organizationId??"",scope?.projectAccessId??"",now]:[]),
      ...(!paid?[]:binding.pilotCohortId?[binding.pilotCohortId,scope?.organizationId??"",now,now,user.userId]:[scope?.organizationId??"",user.userId])] as Array<string|number|null>};
}

/** Read-only final-boundary equivalent of requireUser's configured pilot entry.
 * Preserve successor admission, explicit breakglass and the exact owner-recovery
 * exception. No consent, authoring capability, paid quota or reservation is granted. */
export function configuredPilotAdmissionGuard(env:WorkerEnv,principal:Pick<PilotUser,"userId"|"email">):BudgetReservationGuard{
  const configured=env.FORMA_PILOT_COHORT_ID?.trim()??"";
  const breakglass=new Set((env.FORMA_ADMIN_EMAILS??"").split(",").map(value=>value.trim().toLowerCase()).filter(Boolean));
  if(!configured||breakglass.has(principal.email.toLowerCase()))return{sql:"1",bindings:[]};
  return{sql:`(EXISTS(SELECT 1 FROM pilot_cohorts cohort
      JOIN organizations organization ON organization.organization_id=cohort.organization_id AND organization.status='active'
      JOIN pilot_participants participant ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
      WHERE cohort.organization_id=(SELECT selected.organization_id FROM pilot_cohorts selected WHERE selected.cohort_id=?)
        AND cohort.status IN('active','paused')
        AND cohort.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND cohort.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND participant.email_normalized=? AND participant.status='active' AND participant.revoked_at IS NULL
        AND (participant.user_id IS NULL OR participant.user_id=?))
    OR EXISTS(SELECT 1 FROM pilot_cohorts cohort
      JOIN organizations organization ON organization.organization_id=cohort.organization_id AND organization.status='active'
      JOIN organization_memberships member ON member.organization_id=cohort.organization_id AND member.user_id=? AND member.role='owner'
        AND member.status='active' AND member.accepted_at IS NOT NULL AND member.revoked_at IS NULL
      JOIN users owner ON owner.user_id=member.user_id AND owner.email=?
      WHERE cohort.cohort_id=?
        AND (cohort.status='closed' OR cohort.ends_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR cohort.starts_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND NOT EXISTS(SELECT 1 FROM pilot_cohorts successor WHERE successor.organization_id=cohort.organization_id
          AND successor.status IN('active','paused') AND successor.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND successor.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))`,
    bindings:[configured,principal.email.toLowerCase(),principal.userId,principal.userId,principal.email.toLowerCase(),configured]};
}

/** Reuse captured /api/events authority; no principal-only substitution for personas. */
export function projectIntakeAuthority(env:WorkerEnv,auth:ProjectIntakeAuthorization,intake:Pick<ProjectIntake,"projectId"|"documentId">):BudgetReservationGuard{
  const user=auth.user,principal=auth.impersonation?.actor??user;
  // Preserve requireUser's creator minimum for both intake and exact receipt reads.
  if(principal.role!=="creator"&&principal.role!=="admin")return{sql:"0",bindings:[]};
  const binding:ConsequentialBinding={version:"project-intake-v1",intentHash:"",operation:"project-intake",
    actorUserId:principal.userId,permissionEpoch:principal.access.permissionEpoch,streamId:user.streamId,
    projectId:intake.projectId,documentId:intake.documentId,canvasId:null,blockId:"",sourceHash:"",
    period:"",scope:null,contextSessionId:null,pilotCohortId:null,steps:[],publicQuery:"",request:{}};
  const admitted=executionAdmissionGuard(principal,binding,null),pilot=configuredPilotAdmissionGuard(env,principal);
  const current={sql:admitted.sql+" AND "+pilot.sql,bindings:[...admitted.bindings,...pilot.bindings]};
  if(user.projectExecution||user.streamId!=="creative:"+user.userId||user.fictional&&!auth.impersonation)return{sql:"0",bindings:[]};
  if(!auth.impersonation)return current;
  const original=auth.impersonation;
  return{sql:current.sql+` AND EXISTS(SELECT 1 FROM impersonation_sessions acting
      JOIN replay_personas persona ON persona.persona_id=acting.persona_id AND persona.status='ready'
      JOIN users fictional ON fictional.user_id=acting.fictional_user_id
      WHERE acting.impersonation_id=? AND acting.actor_user_id=? AND acting.fictional_user_id=?
        AND acting.persona_id=? AND acting.replay_session_id=? AND acting.status='active'
        AND acting.expires_at>? AND acting.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND fictional.role=? AND fictional.consent_version=? AND COALESCE(fictional.consented_at,'')=?)
    AND NOT EXISTS(SELECT 1 FROM organization_projects project WHERE project.owner_user_id=? AND project.project_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.owner_user_id=? AND resource.resource_kind='document' AND resource.resource_id=?)`,
    bindings:[...current.bindings,original.impersonationId,principal.userId,user.userId,original.personaId,original.replaySessionId,
      new Date().toISOString(),user.role,POLICY_VERSION,user.consentedAt??"",user.userId,intake.projectId,user.userId,intake.documentId]};
}

type AtomicIntakeOptions={receiptPrefix:string;clientId:string;correlationPrefix:string;guard:BudgetReservationGuard;expectedHead?:number;sponsorIntakeRead?:SponsorIntakePostNativeReceipt};
const intakeGuard=(env:WorkerEnv,auth:ProjectIntakeAuthorization,intake:ProjectIntake,options?:AtomicIntakeOptions)=>{
  const original=projectIntakeAuthority(env,auth,intake);
  return options?{sql:`(${original.sql}) AND (${options.guard.sql})`,bindings:[...original.bindings,...options.guard.bindings]}:original;
};

export { intakeGuard };
export type { AtomicIntakeOptions };
