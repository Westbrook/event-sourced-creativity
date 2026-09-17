import { projectIntakeReceiptPrefix, projectIntakeValue, type ProjectIntake } from "../src/model/project-intake.ts";
import { intakeGuard, type ProjectIntakeAuthorization, type AtomicIntakeOptions } from "./intake-authority.ts";
import { serializeEvent } from "./event-read-primitives.ts";
import { recordIntakeDiagnostic } from "./project-intake-diagnostic.ts";
import { readSponsorIntakePostNativeReceipt } from "./experience-sponsor-intake-reads.ts";
import { readSponsorStoryIntakeNativeReceipt } from "./experience-sponsor-story-intake-native.ts";
import { readSponsorAudioIntakeNativeReceipt } from "./experience-sponsor-audio-intake-native.ts";
import type { EventRow } from "./event-write-primitives.ts";
import type { WorkerEnv } from "./runtime.ts";

const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
const failure=(intake:ProjectIntake,error="project_intake_unconfirmed",status=409)=>{
  recordIntakeDiagnostic("receipt",error);
  return response({status:"unknown",projectId:intake.projectId,documentId:intake.documentId,error},status);
};

type ReceiptState={authorized:boolean;seen:boolean;complete:boolean;events:EventRow[];head:number};

/** Last await for every private response: authority and exact retained bytes in one read. */
async function readOriginal(env:WorkerEnv,auth:ProjectIntakeAuthorization,intake:ProjectIntake,options?:AtomicIntakeOptions):Promise<ReceiptState>{
  const guard=intakeGuard(env,auth,intake,options),stream=auth.user.streamId,prefix=options?.receiptPrefix??projectIntakeReceiptPrefix(intake.projectId);
  const expected=JSON.stringify(intake.events.map(event=>String(event.payload.client_event_id)));
  const sql=`SELECT expected.value AS requested_key,receipt.client_event_id AS receipt_key,
      event.*,secret.private_json,
      (SELECT COUNT(*) FROM event_client_receipts counted WHERE counted.stream_id=? AND substr(counted.client_event_id,1,?)=?) AS receipt_total,
      (SELECT COALESCE(MAX(sequence),0) FROM events head WHERE head.stream_id=?) AS current_head
    FROM json_each(?) expected
    LEFT JOIN event_client_receipts receipt ON receipt.stream_id=? AND receipt.client_event_id=expected.value
    LEFT JOIN events event ON event.event_id=receipt.event_id AND event.stream_id=receipt.stream_id AND event.sequence=receipt.sequence
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL
    WHERE ${guard.sql} ORDER BY CAST(expected.key AS INTEGER)`;
  const bindings=[stream,prefix.length,prefix,stream,expected,stream,auth.user.userId,...guard.bindings];
  // The optional token belongs to one actual POST and this exact native call.
  // Both the first read and post-append/lost-ACK read retain the full intakeGuard.
  const result=options?.sponsorAudioIntakeRead!==undefined
    ?await readSponsorAudioIntakeNativeReceipt(options.sponsorAudioIntakeRead,env,auth,intake,options,sql,bindings)
    :options?.sponsorStoryIntakeRead
    ?await readSponsorStoryIntakeNativeReceipt(options.sponsorStoryIntakeRead,env,auth,intake,options,sql,bindings)
    :options?.sponsorIntakeRead
    ?await readSponsorIntakePostNativeReceipt(options.sponsorIntakeRead,env,auth,intake,options,sql,bindings)
    :await env.DB.prepare(sql).bind(...bindings).all<Record<string,unknown>>();
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

export { response, failure, readOriginal, reply };
export type { ReceiptState };
