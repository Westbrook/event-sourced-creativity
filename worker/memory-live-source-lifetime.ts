import type { LiveMemoryEnrollment } from "./memory-live-authority.ts";
import type { LiveSourceRow as NativeSourceRow } from "./memory-live-sources.ts";
import { nativeMemoryTimestamp as liveMemoryTimestamp } from "./memory-native-deadlines.ts";

export type LiveSourceRow = NativeSourceRow & { lifetime_json: string };
export type LiveSourceSnapshot = LiveSourceRow & { valid_until: string };

/** Metadata for the exact selected native source. The unchanged query predicate remains the authority.
 * LEFT JOIN and JSON preserve missing/invalid required deadlines for fail-closed validation, never MIN(NULL).
 * No additional content bytes, content IDs or task IDs leave the database. */
export function liveMemoryLifetimeProjection() {
  const assigned=(alias:"authored"|"answer"|"approved"|"retained")=>`(SELECT deadline.assigned_expires_at
    FROM private_content_retention_scopes deadline
    WHERE (deadline.content_id,deadline.organization_id,deadline.project_access_id,deadline.project_id,deadline.actor_user_id)
      IS (${alias}.content_id,turn.organization_id,turn.project_access_id,turn.project_id,turn.actor_user_id))`;
  return `json_object('remembered',remembered.expires_at,'conversation',
    CASE WHEN event.type='AssistantReasoned' THEN json_object(
      'authored',authored.expires_at,'answer',answer.expires_at,
      'authoredAssigned',${assigned("authored")},'answerAssigned',${assigned("answer")},
      'paid',json((SELECT json_group_array(json_object(
        'scopeMatches',(signed.organization_id,signed.project_access_id,signed.project_id,signed.document_id,signed.status,
          json_extract(signed.result_json,'$.specialistConsentVersion'))
          IS (turn.organization_id,turn.project_access_id,turn.project_id,turn.document_id,'completed',1),
        'consent',approved.expires_at,'result',retained.expires_at,
        'consentAssigned',${assigned("approved")},'resultAssigned',${assigned("retained")}))
        FROM assistant_specialist_tasks signed
        LEFT JOIN consequential_executions execution
          ON (execution.execution_id,execution.actor_user_id,execution.operation,execution.status,execution.binding_hash)
            =(signed.task_id,signed.actor_user_id,'assistant-specialist','completed',json_extract(signed.result_json,'$.bindingHash'))
        LEFT JOIN private_content approved
          ON (approved.content_id,approved.owner_id,approved.kind,approved.redacted_at)
            IS (execution.consent_ref,execution.actor_user_id,'execution-consent',NULL)
        LEFT JOIN private_content retained
          ON (retained.content_id,retained.owner_id,retained.kind,retained.redacted_at)
            IS (execution.result_ref,execution.actor_user_id,'context-proposal',NULL)
        WHERE (signed.actor_user_id,signed.scope_key,signed.turn_id)=(turn.actor_user_id,turn.scope_key,turn.turn_id))))
      ELSE NULL END) AS lifetime_json`;
}

/** Convert captured metadata to the earliest source deadline only after the trailing native checks.
 * All required fields are visited; missing timestamps cannot disappear from an aggregate. */
export function liveMemorySourceDeadline(row:Pick<LiveSourceRow,"type"|"recorded_at"|"lifetime_json">,e:LiveMemoryEnrollment,checkedAt:number):string|null {
  const recorded=liveMemoryTimestamp(row.recorded_at),enrolled=liveMemoryTimestamp(e.enrolled_at),expires=liveMemoryTimestamp(e.expires_at);
  if(recorded===null||enrolled===null||expires===null||!Number.isFinite(checkedAt)||recorded<enrolled||recorded>checkedAt
    ||!Number.isSafeInteger(e.retention_days)||e.retention_days<1||e.retention_days>365)return null;
  const retention=recorded+e.retention_days*86_400_000;
  if(!Number.isSafeInteger(retention))return null;
  let value:unknown;
  try{value=JSON.parse(row.lifetime_json);}catch{return null;}
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const metadata=value as Record<string,unknown>,deadlines=[expires,retention];
  const required=(timestamp:unknown)=>{const parsed=liveMemoryTimestamp(timestamp);if(parsed===null)return false;deadlines.push(parsed);return true;};
  const assigned=(timestamp:unknown)=>e.organization_id!==null?required(timestamp):timestamp===null;
  if(!required(metadata.remembered))return null;
  if(row.type==="AssistantReasoned"){
    if(!metadata.conversation||typeof metadata.conversation!=="object"||Array.isArray(metadata.conversation))return null;
    const conversation=metadata.conversation as Record<string,unknown>;
    if(!required(conversation.authored)||!required(conversation.answer)
      ||!assigned(conversation.authoredAssigned)||!assigned(conversation.answerAssigned)
      ||!Array.isArray(conversation.paid)||conversation.paid.length>1)return null;
    // The native single-consented-turn index permits zero or one signed canonical task.
    for(const entry of conversation.paid){
      if(!entry||typeof entry!=="object"||Array.isArray(entry))return null;
      const paid=entry as Record<string,unknown>;
      if(paid.scopeMatches!==1||!required(paid.consent)||!required(paid.result)
        ||!assigned(paid.consentAssigned)||!assigned(paid.resultAssigned))return null;
    }
  }else if(metadata.conversation!==null)return null;
  const until=Math.min(...deadlines);
  return until>checkedAt&&until>recorded?new Date(until).toISOString():null;
}
