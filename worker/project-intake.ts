import { projectIntake, projectIntakeReceiptPrefix, projectIntakeValue, type ProjectIntake } from "../src/model/project-intake.ts";
import { executionAdmissionGuard, type ConsequentialBinding } from "./consequential-consent.ts";
import { configuredPilotAdmissionGuard, POLICY_VERSION, type BudgetReservationGuard, type PilotImpersonation, type PilotUser } from "./pilot-policy.ts";
import { appendEvents, makeEvent, serializeEvent, type EventRow, type WorkerEnv } from "./runtime.ts";

export type ProjectIntakeAuthorization={user:PilotUser;principal:PilotUser;impersonation:PilotImpersonation|null};
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
const failure=(intake:ProjectIntake,error="project_intake_unconfirmed",status=409)=>
  response({status:"unknown",projectId:intake.projectId,documentId:intake.documentId,error},status);

/** Reuse captured /api/events authority; no principal-only substitution for personas. */
function authority(env:WorkerEnv,auth:ProjectIntakeAuthorization,intake:ProjectIntake):BudgetReservationGuard{
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

type ReceiptState={authorized:boolean;seen:boolean;complete:boolean;events:EventRow[];head:number};
/** Last await for every private response: authority and exact retained bytes in one read. */
async function readOriginal(env:WorkerEnv,auth:ProjectIntakeAuthorization,intake:ProjectIntake):Promise<ReceiptState>{
  const guard=authority(env,auth,intake),stream=auth.user.streamId,prefix=projectIntakeReceiptPrefix(intake.projectId);
  const expected=JSON.stringify(intake.events.map(event=>String(event.payload.client_event_id)));
  const result=await env.DB.prepare(`SELECT expected.value AS requested_key,receipt.client_event_id AS receipt_key,
      event.*,secret.private_json,
      (SELECT COUNT(*) FROM event_client_receipts counted WHERE counted.stream_id=? AND substr(counted.client_event_id,1,?)=?) AS receipt_total,
      (SELECT COALESCE(MAX(sequence),0) FROM events head WHERE head.stream_id=?) AS current_head
    FROM json_each(?) expected
    LEFT JOIN event_client_receipts receipt ON receipt.stream_id=? AND receipt.client_event_id=expected.value
    LEFT JOIN events event ON event.event_id=receipt.event_id AND event.stream_id=receipt.stream_id AND event.sequence=receipt.sequence
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL
    WHERE ${guard.sql} ORDER BY CAST(expected.key AS INTEGER)`)
    .bind(stream,prefix.length,prefix,stream,expected,stream,auth.user.userId,...guard.bindings).all<Record<string,unknown>>();
  const rows=result.results;
  if(rows.length!==intake.events.length)return{authorized:false,seen:false,complete:false,events:[],head:0};
  const seen=Number(rows[0]?.receipt_total??0)>0,events:EventRow[]=[];
  let complete=Number(rows[0]?.receipt_total)===intake.events.length;
  for(let index=0;index<rows.length;index++){
    const row=rows[index]!,input=intake.events[index]!;
    if(row.receipt_key!==input.payload.client_event_id||row.requested_key!==input.payload.client_event_id
      ||typeof row.private_json!=="string"||row.actor!=="user"||row.type!==input.type||row.stream_id!==stream){complete=false;continue;}
    try{
      const event=serializeEvent(row);
      if(projectIntakeValue(event.payload)!==projectIntakeValue(input.payload)||event.compensatesEventId!==null)complete=false;
      events.push(event);
    }catch{complete=false;}
  }
  return{authorized:true,seen,complete:complete&&events.length===intake.events.length,events:complete?events:[],head:Number(rows[0]?.current_head??0)};
}

function reply(intake:ProjectIntake,state:ReceiptState){
  if(!state.authorized)return failure(intake,"project_intake_authority_changed",403);
  if(!state.complete)return failure(intake,state.seen?"project_intake_original_unavailable":"project_intake_unconfirmed");
  return response({status:"complete",projectId:intake.projectId,documentId:intake.documentId,appended:state.events,rejected:[],head:state.head});
}

/** One bounded all-or-none intake. Generic batch and Canvas receipt semantics do not change. */
export async function handleProjectIntake(env:WorkerEnv,auth:ProjectIntakeAuthorization,value:unknown){
  if(!value||typeof value!=="object"||Array.isArray(value))return response({status:"invalid",error:"invalid_project_intake"},400);
  const body=value as Record<string,unknown>,intake=projectIntake(body.events);
  if(!intake||body.action!=="project_intake"||(body.intakeAction!=="commit"&&body.intakeAction!=="check")
    ||Object.keys(body).some(key=>!["action","intakeAction","events"].includes(key)))
    return response({status:"invalid",error:"invalid_project_intake"},400);
  const before=await readOriginal(env,auth,intake);
  if(!before.authorized||before.seen||body.intakeAction==="check")return reply(intake,before);
  const stream=auth.user.streamId,owner=auth.user.userId,guard=authority(env,auth,intake);
  const events=intake.events.map(input=>makeEvent(stream,0,"user","web:project-intake",
    "project-intake:"+intake.projectId,input.type,input.payload));
  const root=events[0]!,rootKey=String(root.payload.client_event_id),now=new Date().toISOString();
  try{
    await appendEvents(env,events,{retries:1,prepareSidecars:assigned=>{
      const batch=JSON.stringify(assigned.map(event=>({id:event.eventId,key:event.payload.client_event_id,type:event.type,sequence:event.sequence,payload:JSON.stringify(event.payload)})));
      const resourceIds=JSON.stringify([...new Set(intake.events.flatMap(event=>[event.payload.project_id,event.payload.document_id,event.payload.block_id,event.payload.reference_id].filter((id):id is string=>typeof id==="string")))]);
      const receipts=assigned.slice(1).map(event=>env.DB.prepare(`INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at)
        SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=?)`)
        .bind(stream,String(event.payload.client_event_id),event.eventId,event.sequence,now,event.eventId,stream,event.sequence));
      // Existing NOT NULL event_id is the all-or-none assertion. Existing root
      // PK fences a concurrent winner; either failure rolls back this entire
      // appendEvents D1 batch, including all staged events/private envelopes.
      receipts.push(env.DB.prepare(`INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at)
        VALUES(?,?,CASE WHEN ${guard.sql}
          AND (SELECT COUNT(*) FROM json_each(?) expected JOIN events saved
            ON saved.event_id=json_extract(expected.value,'$.id') AND saved.stream_id=? AND saved.actor='user'
              AND saved.type=json_extract(expected.value,'$.type') AND saved.sequence=json_extract(expected.value,'$.sequence')
            JOIN event_private_payloads secret ON secret.private_event_id=saved.event_id AND secret.owner_id=?
              AND secret.redacted_at IS NULL AND secret.private_json=json_extract(expected.value,'$.payload'))=?
          AND (SELECT COUNT(*) FROM json_each(?) expected JOIN event_client_receipts receipt
            ON receipt.stream_id=? AND receipt.client_event_id=json_extract(expected.value,'$.key')
              AND receipt.event_id=json_extract(expected.value,'$.id') AND receipt.sequence=json_extract(expected.value,'$.sequence')
            WHERE CAST(expected.key AS INTEGER)>0)=?
          AND NOT EXISTS(SELECT 1 FROM events prior WHERE prior.stream_id=? AND prior.type IN('ProjectCreated','DocumentCreated','BlockCreated','ReferenceIngested')
            AND (json_extract(prior.payload,'$.project_id') IN(SELECT value FROM json_each(?)) AND prior.type='ProjectCreated'
              OR json_extract(prior.payload,'$.document_id') IN(SELECT value FROM json_each(?)) AND prior.type='DocumentCreated'
              OR json_extract(prior.payload,'$.block_id') IN(SELECT value FROM json_each(?)) AND prior.type='BlockCreated'
              OR json_extract(prior.payload,'$.reference_id') IN(SELECT value FROM json_each(?)) AND prior.type='ReferenceIngested')
            AND prior.event_id NOT IN(SELECT json_extract(value,'$.id') FROM json_each(?)))
          THEN ? ELSE NULL END,?,?)`)
        .bind(stream,rootKey,...guard.bindings,batch,stream,owner,assigned.length,batch,stream,assigned.length-1,
          stream,resourceIds,resourceIds,resourceIds,resourceIds,batch,root.eventId,root.sequence,now));
      return receipts;
    }});
  }catch{
    // This may be a unique-root winner, authorization/head change, or lost DB
    // acknowledgment. Only the actual original receipt read may resolve it.
  }
  return reply(intake,await readOriginal(env,auth,intake));
}
