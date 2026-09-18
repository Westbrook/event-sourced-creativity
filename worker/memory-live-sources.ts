import { memoryEventAction } from "../src/model/memory-observations.ts";
import { liveMemoryTurnGuard, type LiveMemoryAuthority, type LiveMemoryEnrollment } from "./memory-live-authority.ts";

// Deliberately excludes passive attention, raw telemetry, generated prose and arbitrary analytics.
// Additional signals require their own purpose/retention contract, not automatic enrollment.
// Artifact-view references have a separate retained-body proof and negotiated
// inspector projection. They stay OUT of this assistant/origin/export predicate:
// durable answers do not yet carry artifact body/revision dependency inverses.
export const LIVE_MEMORY_EVENT_TYPES = ["DocumentOpened","DocumentViewVisited","ObjectViewed","ComparisonOpened",
  "BlockCreated","BlockPropertyEdited","ChipEdited","BlockWeightSet","BlockLocked","BlockUnlocked","BlockRelationAdded","BlockRelationRemoved",
  "BlockRemoved","BlockRestored","ObjectSaved","ObjectPinned","ObjectExported","DocumentArtifactExported","ArtifactApproved",
  "CanvasItemPlaced","CanvasReferenceCreated","ContextSetFormalized","ObjectDiscarded","ObjectCritiqued","ArtifactChangesRequested",
  "ArtifactReviewRequested","GenerationRequested","DocumentRenderRequested","ProposalAccepted","ProposalRejected","ProposalDeclined",
  "BriefItemAccepted","BriefItemIgnored","BriefDismissed","AssistantReasoned"] as const;
const TYPES=LIVE_MEMORY_EVENT_TYPES.map(type=>`'${type}'`).join(",");
export type LiveSourceRow={event_id:string;sequence:number;type:string;recorded_at:string;block_id:string|null;turn_id:string|null;user_text:string|null;assistant_text:string|null};

/** SELECT and INSERT share exactly the same native source/custody predicate. No stored prose or copied authorization. */
export function liveMemorySourceQuery(e:LiveMemoryEnrollment,a:LiveMemoryAuthority) {
  const turn=liveMemoryTurnGuard(a);
  // Ordinary personal /api/events writes use the legacy actor "user". That
  // alias belongs only to this authenticated owner's private stream; it is
  // never evidence of a collaborator's identity or an assistant conversation.
  const personalActorAlias=e.organization_id===null&&e.project_access_id===null
    &&e.owner_user_id===e.actor_user_id&&a.principal.userId===e.actor_user_id&&a.binding.scope===null;
  const sourceActor=`(event.actor=?${personalActorAlias?` OR (event.actor='user' AND event.type!='AssistantReasoned'
    AND (json_type(event.payload,'$.actor_user_id') IS NULL OR json_type(event.payload,'$.actor_user_id')='text'
      AND json_extract(event.payload,'$.actor_user_id')=?)
    AND (json_extract(event.payload,'$._private_ref') IS NULL OR json_valid(secret.private_json)
      AND (json_type(secret.private_json,'$.actor_user_id') IS NULL OR json_type(secret.private_json,'$.actor_user_id')='text'
        AND json_extract(secret.private_json,'$.actor_user_id')=?)))`:""})`;
  const paidFinal=`EXISTS(SELECT 1 FROM assistant_specialist_tasks committed_task
      JOIN assistant_action_commits committed ON committed.commit_id='task:'||committed_task.task_id AND committed.verified=1
      JOIN event_client_receipts receipt ON receipt.stream_id=event.stream_id AND receipt.event_id=event.event_id AND receipt.sequence=event.sequence
        AND receipt.client_event_id='assistant-specialist:'||committed_task.actor_user_id||':'||committed_task.task_id||':0'
      WHERE (committed_task.actor_user_id,committed_task.scope_key,committed_task.turn_id,committed_task.organization_id,
        committed_task.project_access_id,committed_task.project_id,committed_task.document_id,committed_task.status)
        IS (turn.actor_user_id,turn.scope_key,turn.turn_id,turn.organization_id,turn.project_access_id,turn.project_id,turn.document_id,'completed'))`;
  const joins=`FROM events event
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    LEFT JOIN assistant_turns turn ON event.type='AssistantReasoned'
      AND (turn.actor_user_id,turn.scope_key,turn.project_id,turn.document_id,turn.organization_id,turn.project_access_id)
        IS (?,?,?,?,?,?)
      AND (turn.turn_id,turn.assistant_content_ref)=(json_extract(event.payload,'$.turn_id'),json_extract(event.payload,'$.content_ref'))
    LEFT JOIN private_content authored ON (authored.content_id,authored.owner_id,authored.kind,authored.redacted_at) IS (turn.user_content_ref,turn.actor_user_id,'chat-user',NULL)
      AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    LEFT JOIN private_content answer ON (answer.content_id,answer.owner_id,answer.kind,answer.redacted_at) IS (turn.assistant_content_ref,turn.actor_user_id,'chat-assistant',NULL)
      AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
  const custody=e.organization_id?`(EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=event.event_id
    AND custody.source_stream_id=event.stream_id AND custody.source_sequence=event.sequence
    AND (custody.organization_id,custody.project_access_id,custody.project_id,custody.owner_user_id,custody.actor_user_id)=(?,?,?,?,?))
    OR event.type='AssistantReasoned' AND NOT EXISTS(SELECT 1 FROM project_event_scopes contradictory WHERE contradictory.event_id=event.event_id)
      AND (${paidFinal}))`
    :`NOT EXISTS(SELECT 1 FROM project_event_scopes custody WHERE custody.event_id=event.event_id)`;
  const condition=`(event.stream_id=? AND ${sourceActor} AND event.type IN(${TYPES})
    AND event.event_id NOT LIKE 'optimistic:%' AND event.client_id NOT LIKE '%optimistic%'
    AND (json_extract(event.payload,'$.project_id') IS NULL OR json_extract(event.payload,'$.project_id')=?) AND json_extract(event.payload,'$.document_id')=?)
    AND (event.recorded_at>=? AND julianday(event.recorded_at)>julianday('now')-? AND event.recorded_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND ((COALESCE(json_extract(event.payload,'$.simulation'),0),COALESCE(json_extract(event.payload,'$.origin.synthetic'),0),COALESCE(json_extract(event.payload,'$.synthetic'),0))=(0,0,0)
    AND json_extract(event.payload,'$.mock_data_source') IS NULL
    AND (json_extract(event.payload,'$.actor_user_id') IS NULL OR json_extract(event.payload,'$.actor_user_id')=turn.actor_user_id OR event.type!='AssistantReasoned')
    AND json_extract(event.payload,'$.replay_session_id') IS NULL AND json_extract(event.payload,'$.fictional_user_id') IS NULL)
    AND (json_extract(event.payload,'$._private_ref') IS NULL OR json_extract(event.payload,'$._private_ref')=event.event_id
      AND (secret.owner_id,secret.project_id,secret.document_id,secret.redacted_at) IS (?,?,?,NULL) AND json_valid(secret.private_json)
      AND COALESCE(json_extract(secret.private_json,'$.origin.synthetic'),0)=0 AND COALESCE(json_extract(secret.private_json,'$.simulation'),0)=0)
    AND (${custody})
    AND (event.type!='AssistantReasoned' OR json_extract(event.payload,'$.operation')='creative-chat'
      AND authored.content_id IS NOT NULL AND answer.content_id IS NOT NULL AND (${turn.condition})
      AND ((${paidFinal}) OR NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE task.actor_user_id=turn.actor_user_id AND task.scope_key=turn.scope_key AND task.turn_id=turn.turn_id)
        AND EXISTS(SELECT 1 FROM events message WHERE message.event_id=event.causation_id AND message.stream_id=event.stream_id
          AND message.actor=event.actor AND message.type='ChatMessageSent' AND message.correlation_id=event.correlation_id
          AND json_extract(message.payload,'$.content_ref')=turn.user_content_ref AND json_extract(message.payload,'$.turn_id')=turn.turn_id))
      AND NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks pending WHERE pending.actor_user_id=turn.actor_user_id
        AND pending.scope_key=turn.scope_key AND pending.turn_id=turn.turn_id
        AND (pending.status!='completed' OR COALESCE(json_extract(pending.result_json,'$.specialistConsentVersion'),0)!=1))
      AND NOT EXISTS(SELECT 1 FROM events newer WHERE newer.stream_id=event.stream_id AND newer.type='AssistantReasoned'
        AND json_extract(newer.payload,'$.content_ref')=turn.assistant_content_ref AND newer.sequence>event.sequence))`;
  const bindings=[e.actor_user_id,a.scopeKey,e.project_id,e.document_id,e.organization_id,e.project_access_id,
    `creative:${e.owner_user_id}`,`user:${e.actor_user_id}`,...(personalActorAlias?[e.actor_user_id,e.actor_user_id]:[]),e.project_id,e.document_id,e.enrolled_at,e.retention_days,
    e.owner_user_id,e.project_id,e.document_id,...(e.organization_id?[e.organization_id,e.project_access_id,e.project_id,e.owner_user_id,e.actor_user_id]:[]),...turn.bindings];
  return {joins,condition,bindings};
}

export function liveMemoryView(rows:LiveSourceRow[],e:LiveMemoryEnrollment) {
  const counts=new Map<string,number>();
  for(const row of rows){const action=row.type==="AssistantReasoned"?"conversation":memoryEventAction(row.type);if(action)counts.set(action,(counts.get(action)??0)+1);}
  const conversations=rows.filter(row=>row.type==="AssistantReasoned"&&row.user_text!==null&&row.assistant_text!==null).slice(-8);
  const excerpts=conversations.map(row=>({sourceEventId:row.event_id,recordedAt:row.recorded_at,user:row.user_text!,assistant:row.assistant_text!}));
  return {mode:"live-reference-memory",scope:{organizationId:e.organization_id,projectId:e.project_id,documentId:e.document_id},
    treatment:"untrusted-historical-evidence",method:"extractive-not-semantic",consumption:Object.fromEntries(counts),
    rollingConversation:{summary:excerpts.slice(0,-2),recent:excerpts.slice(-2),completeFromStart:false},
    coverage:{since:e.enrolled_at,throughSequence:e.cursor_sequence,remainingThroughSequence:e.cutoff_sequence,bounded:true,sourceCount:rows.length},
    sources:rows.map(row=>({eventId:row.event_id,type:row.type,blockId:row.block_id,recordedAt:row.recorded_at})),
    note:"Observed actions are not inferred preferences; excerpts are truncated and access-filtered."};
}
