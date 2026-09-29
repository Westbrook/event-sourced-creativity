import type {WorkerEnv} from './runtime.ts';
import {qualificationReadDb,qualificationPrincipal,qualificationResponse,QUALIFICATION_LIMITS,QUALIFICATION_EXPIRY} from './generation-study-qualification.ts';
import {consentHash} from './consequential-consent.ts';
import {HOLD_QUERIES} from './generation-study-hold-queries.ts';
export const HOLD_READ_PATH='/api/internal/generation-study/hold-classification';
export const HOLD_READ_LIMITS={...QUALIFICATION_LIMITS,rowsPerQuery:101,resultBytes:65536,outputBytes:32768};
const required={
 budget_reservations:['reservation_id','owner_id','operation','period','status','created_at','stream_id','correlation_id'],
 cost_budget_reservations:['reservation_id','owner_id','operation','period','status','created_at','stream_id','correlation_id'],
 document_jobs:['job_id','owner_id','stream_id','correlation_id','result_json'],
 output_operation_slots:['scope_key','grant_id','token_reservation_id','cost_reservation_id'],
 output_execution_grants:['scope_key','grant_id','payer_user_id'],
 consequential_execution_steps:['execution_id','token_reservation_id','cost_reservation_id'],
 consequential_executions:['execution_id','actor_user_id'],
} as const;
const fail=()=>{throw Error('hold_classification_unavailable');};
const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).length;
/** Owner-only, fixed metadata classification. No financial finality or clearance claim.
 * Existing authentication receives a SELECT-only DB; MEDIA and provider are never passed. */
export async function handleStudyHoldRead(request:Request,env:WorkerEnv):Promise<Response>{
 if(env.FORMA_GENERATION_STUDY_HOLD_READ_ENABLED!=='1')return qualificationResponse({status:'disabled',newPurchases:0});
 if(request.method!=='GET'||request.body!==null)return qualificationResponse({status:'denied',reason:'fixed_read_required'},405);
 if(Date.now()>=Date.parse(QUALIFICATION_EXPIRY))return qualificationResponse({status:'expired',newPurchases:0},410);
 try{
  const original=env.DB,read=qualificationReadDb(original,HOLD_READ_LIMITS),db=read.db;
  const actor=await qualificationPrincipal(request,env,db),observedAt=new Date().toISOString();
  for(const [table,names] of Object.entries(required)){
   // Table identifiers come exclusively from the compiled contract above.
   const rows=(await db.prepare(`SELECT name,type,hidden FROM pragma_table_xinfo('${table}') ORDER BY cid LIMIT 101`).all()).results as {name:string;type:string;hidden:number}[];
   if(rows.length===101||names.some(n=>!rows.some(c=>c.name===n&&c.type.toUpperCase()==='TEXT'&&c.hidden===0)))fail();
  }
  const groups:Record<string,unknown>={};let metadataBytes=0;
  for(const [kind,query] of Object.entries(HOLD_QUERIES)){
   const rows=(await db.prepare(query.sql).bind(...query.bindings.map(n=>n==='owner_id'?actor.userId:observedAt)).all()).results as Record<string,unknown>[];
   metadataBytes+=bytes(rows);if(rows.length===101||metadataBytes>65536)fail();
   const counts=new Map<string,number>();
   for(const row of rows){
    if(!['authorizing','active','executing','exceeded','other-unsettled'].includes(String(row.reservation_state))||!['generation-study','study-lifecycle-provision','image-generation','image-preview','video-generation','other-or-unknown'].includes(String(row.operation_class))||!['unknown','under-1-day','1-to-7-days','7-days-or-more'].includes(String(row.age_bucket))||![0,1,2].includes(Number(row.document_matches_capped2))||![0,1].includes(Number(row.output_binding_candidate))||![0,1].includes(Number(row.consequential_binding_candidate)))fail();
    const value={reservationState:row.reservation_state,operationClass:row.operation_class,ageBucket:row.age_bucket,documentMatchesCapped2:row.document_matches_capped2,outputCandidate:row.output_binding_candidate,consequentialCandidate:row.consequential_binding_candidate};
    const key=JSON.stringify(value);counts.set(key,(counts.get(key)??0)+1);
   }
   groups[kind]={reservationCount:rows.length,groups:[...counts].map(([key,count])=>({...JSON.parse(key),count}))};
  }
  const after=await qualificationPrincipal(request,env,db);
  const principal=(a:typeof actor)=>consentHash({id:a.userId,consent:a.consentVersion,snapshot:a.authorizationSnapshot,access:a.access});
  if(env.DB!==original||await principal(actor)!==await principal(after))fail();read.check();
  const output={contract:'forma-p5-hold-classification-v1',status:'observed-not-cleared',observedAt,groups,completeWithinBound:true,uniqueOperations:null,finality:'not-established',newPurchases:0,metrics:read.metrics,limits:HOLD_READ_LIMITS};
  if(bytes(output)>HOLD_READ_LIMITS.outputBytes)fail();return qualificationResponse(output);
 }catch{return qualificationResponse({status:'unavailable',reason:'hold_classification_unavailable',completeWithinBound:false,newPurchases:0},409);}
}
