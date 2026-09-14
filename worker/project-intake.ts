import { projectIntake, type ProjectIntake } from "../src/model/project-intake.ts";
import { intakeGuard, type ProjectIntakeAuthorization, type AtomicIntakeOptions } from "./intake-authority.ts";
export { projectIntakeAuthority } from "./intake-authority.ts";
export type { ProjectIntakeAuthorization };
import { response, failure, readOriginal, reply } from "./project-intake-read.ts";
import { appendEvents } from "./event-append.ts";
import { makeEvent } from "./event-write-primitives.ts";
import { recordIntakeDiagnostic } from "./project-intake-diagnostic.ts";
import type { WorkerEnv } from "./runtime.ts";

/** One bounded all-or-none intake. Generic batch and Canvas receipt semantics do not change. */
export async function handleProjectIntake(env:WorkerEnv,auth:ProjectIntakeAuthorization,value:unknown){
  if(!value||typeof value!=="object"||Array.isArray(value))return response({status:"invalid",error:"invalid_project_intake"},400);
  const body=value as Record<string,unknown>,intake=projectIntake(body.events);
  if(!intake||body.action!=="project_intake"||(body.intakeAction!=="commit"&&body.intakeAction!=="check")
    ||Object.keys(body).some(key=>!["action","intakeAction","events"].includes(key)))
    return response({status:"invalid",error:"invalid_project_intake"},400);
  return commitAtomicIntake(env,auth,intake,body.intakeAction);
}

/** Internal only: callers must build and validate their own closed event grammar.
 * No route passes caller-supplied options or unvalidated events to this core. */
export async function commitAtomicIntake(env:WorkerEnv,auth:ProjectIntakeAuthorization,intake:ProjectIntake,action:"commit"|"check",options?:AtomicIntakeOptions){
  const before=await readOriginal(env,auth,intake,options);
  if(!before.authorized||before.seen||action==="check")return reply(intake,before);
  const stream=auth.user.streamId,owner=auth.user.userId,guard=intakeGuard(env,auth,intake,options);
  const events=intake.events.map(input=>makeEvent(stream,0,"user",options?.clientId??"web:project-intake",
    (options?.correlationPrefix??"project-intake:")+intake.projectId,input.type,input.payload));
  const root=events[0]!,rootKey=String(root.payload.client_event_id),now=new Date().toISOString();
  try{
    await appendEvents(env,events,{retries:1,...(options?.expectedHead === undefined ? {} : {expectedHead:options.expectedHead}),prepareSidecars:assigned=>{
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
  }catch(error){
    recordIntakeDiagnostic("append", "project_intake_unconfirmed", error);
    // This may be a unique-root winner, authorization/head change, or lost DB
    // acknowledgment. Only the actual original receipt read may resolve it.
  }
  return reply(intake,await readOriginal(env,auth,intake,options));
}
