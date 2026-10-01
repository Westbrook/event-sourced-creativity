import { projectIntake, projectIntakeReceiptPrefix, projectIntakeValue, type ProjectIntake } from "../src/model/project-intake.ts";
import { executionAdmissionGuard, type ConsequentialBinding } from "./consequential-consent.ts";
import { configuredPilotAdmissionGuard, POLICY_VERSION, type BudgetReservationGuard, type PilotImpersonation, type PilotUser } from "./pilot-policy.ts";
import { appendEvents, makeEvent, serializeEvent, type EventRow, type WorkerEnv } from "./runtime.ts";

export type ProjectIntakeAuthorization={user:PilotUser;principal:PilotUser;impersonation:PilotImpersonation|null};
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
const failure=(intake:ProjectIntake,error="project_intake_unconfirmed",status=409)=>
  response({status:"unknown",projectId:intake.projectId,documentId:intake.documentId,error},status);

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

type ReceiptState={authorized:boolean;seen:boolean;complete:boolean;events:EventRow[];head:number};

/** Server-owned options only. SQL is an additional assertion, never request data. */
type AtomicIntakeOptions={receiptPrefix:string;clientId:string;correlationPrefix:string;guard:BudgetReservationGuard};

/** Capture data descriptors once before the first await. These finite limits cover
 * the default <=11 events and the registered Experience <=16-event envelope.
 * Counters bound accepted snapshots (text in UTF-16 units), not peak allocation
 * during descriptor enumeration or SQL execution. Proxy reflection traps may run. */
function captureAtomicIntake(intake:ProjectIntake,options?:AtomicIntakeOptions):{intake:ProjectIntake;options?:AtomicIntakeOptions}|null{
  let nodes=0,text=0;
  const capture=(value:unknown,depth=0):unknown=>{
    if(++nodes>4096||depth>12)throw new Error("atomic_intake_limit");
    if(value===null||typeof value==="boolean")return value;
    if(typeof value==="string"){text+=value.length;if(value.length>262144||text>524288)throw new Error("atomic_intake_limit");return value;}
    if(typeof value==="number"){if(!Number.isFinite(value))throw new Error("atomic_intake_value");return value;}
    if(typeof value!=="object")throw new Error("atomic_intake_value");
    const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(prototype!==(array?Array.prototype:Object.prototype)&&!(prototype===null&&!array))throw new Error("atomic_intake_object");
    const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
    if(keys.some(key=>typeof key!=="string")||keys.length>4096)throw new Error("atomic_intake_keys");
    if(array){
      const length=descriptors.length?.value;
      if(!Number.isInteger(length)||length<0||length>128||keys.length!==length+1)throw new Error("atomic_intake_array");
      const result:unknown[]=[];
      for(let index=0;index<length;index++){
        const descriptor=descriptors[String(index)];
        if(!descriptor||!descriptor.enumerable||!("value" in descriptor))throw new Error("atomic_intake_descriptor");
        result.push(capture(descriptor.value,depth+1));
      }
      return Object.freeze(result);
    }
    const result:Record<string,unknown>={};
    for(const key of keys as string[]){
      text+=key.length;if(text>524288)throw new Error("atomic_intake_limit");
      const descriptor=descriptors[key]!;
      if(!descriptor.enumerable||!("value" in descriptor))throw new Error("atomic_intake_descriptor");
      Object.defineProperty(result,key,{value:capture(descriptor.value,depth+1),enumerable:true});
    }
    return Object.freeze(result);
  };
  const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value);
  const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  const identifier=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
  const label=(value:unknown,maximum:number):value is string=>typeof value==="string"&&value.length<=maximum&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
  try{
    const saved=capture(options===undefined?{intake}:{intake,options}) as {intake:ProjectIntake;options?:AtomicIntakeOptions};
    const candidate=saved.intake,custom=saved.options;
    if(!record(candidate)||!exact(candidate,["projectId","documentId","events"])||!identifier(candidate.projectId)||!identifier(candidate.documentId)
      ||candidate.projectId===candidate.documentId||!Array.isArray(candidate.events)||candidate.events.length<3||candidate.events.length>16)return null;
    if(custom!==undefined){
      if(!record(custom)||!exact(custom,["receiptPrefix","clientId","correlationPrefix","guard"])
        ||typeof custom.receiptPrefix!=="string"||!custom.receiptPrefix.length||custom.receiptPrefix.length>128||custom.receiptPrefix.includes("\0")||!label(custom.clientId,80)
        ||!label(custom.correlationPrefix,80)||!custom.correlationPrefix.endsWith(":")
        ||!record(custom.guard)||!exact(custom.guard,["sql","bindings"])||typeof custom.guard.sql!=="string"
        ||!custom.guard.sql.trim()||custom.guard.sql.length>8192||custom.guard.sql.includes("\0")
        ||!Array.isArray(custom.guard.bindings)||custom.guard.bindings.length>128
        ||custom.guard.bindings.some(value=>value!==null&&typeof value!=="string"&&typeof value!=="number"))return null;
    }
    const prefix=custom?.receiptPrefix??projectIntakeReceiptPrefix(candidate.projectId),created=new Set([candidate.projectId,candidate.documentId]),references=new Set<string>();
    for(const [index,event] of candidate.events.entries()){
      if(!record(event)||Object.keys(event).some(key=>!["type","payload","compensatesEventId"].includes(key))
        ||event.compensatesEventId!=null||!record(event.payload)||event.payload.project_id!==candidate.projectId
        ||(index===0?event.payload.document_id!==undefined:event.payload.document_id!==candidate.documentId)
        ||event.payload.client_event_id!==prefix+index)return null;
      if(index<3){if(event.type!==["ProjectCreated","DocumentCreated","EmptyCanvasChosen"][index])return null;}
      else if(event.type==="BlockCreated"||event.type==="ReferenceIngested"){
        const id=event.payload[event.type==="BlockCreated"?"block_id":"reference_id"];
        if(!identifier(id)||created.has(id))return null;
        created.add(id);if(event.type==="ReferenceIngested")references.add(id);
      }else if(event.type!=="RightsAsserted"||!identifier(event.payload.reference_id)||!references.has(event.payload.reference_id))return null;
    }
    return saved;
  }catch{return null;}
}
const intakeGuard=(env:WorkerEnv,auth:ProjectIntakeAuthorization,intake:ProjectIntake,options?:AtomicIntakeOptions)=>{
  const original=projectIntakeAuthority(env,auth,intake);
  return options?{sql:`(${original.sql}) AND (${options.guard.sql})`,bindings:[...original.bindings,...options.guard.bindings]}:original;
};

type AtomicIntakeScope={database:WorkerEnv["DB"];stream:string;owner:string;prefix:string;clientId:string;correlationId:string;guard:BudgetReservationGuard;custom:boolean};
/** Last await for every private response: the same captured predicate is evaluated
 * against live database authority, custody and expiry, never a cached boolean. */
async function readOriginal(scope:AtomicIntakeScope,intake:ProjectIntake):Promise<ReceiptState>{
  const {database,guard,stream,owner,prefix}=scope;
  const expected=JSON.stringify(intake.events.map(event=>String(event.payload.client_event_id)));
  const result=await database.prepare(`SELECT expected.value AS requested_key,receipt.client_event_id AS receipt_key,
      event.*,secret.private_json,
      (SELECT COUNT(*) FROM event_client_receipts counted WHERE counted.stream_id=? AND substr(counted.client_event_id,1,length(?))=?) AS receipt_total,
      (SELECT COALESCE(MAX(sequence),0) FROM events head WHERE head.stream_id=?) AS current_head
    FROM json_each(?) expected
    LEFT JOIN event_client_receipts receipt ON receipt.stream_id=? AND receipt.client_event_id=expected.value
    LEFT JOIN events event ON event.event_id=receipt.event_id AND event.stream_id=receipt.stream_id AND event.sequence=receipt.sequence
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL
    WHERE ${guard.sql} ORDER BY CAST(expected.key AS INTEGER)`)
    .bind(stream,prefix,prefix,stream,expected,stream,owner,...guard.bindings).all<Record<string,unknown>>();
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
      if(projectIntakeValue(event.payload)!==projectIntakeValue(input.payload)||event.compensatesEventId!==null
        ||scope.custom&&(event.clientId!==scope.clientId||event.correlationId!==scope.correlationId))complete=false;
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
  return commitAtomicIntake(env,auth,intake,body.intakeAction);
}

/** Internal only: trusted callers validate their closed semantic event grammar.
 * This core captures a bounded creation envelope; no route accepts options/SQL.
 * Captured request authorization still requires its original live SQL assertions. */
export async function commitAtomicIntake(env:WorkerEnv,auth:ProjectIntakeAuthorization,intake:ProjectIntake,action:"commit"|"check",options?:AtomicIntakeOptions){
  const saved=captureAtomicIntake(intake,options);
  if(!saved||(action!=="commit"&&action!=="check"))return response({status:"invalid",error:"invalid_project_intake"},400);
  intake=saved.intake;options=saved.options;
  // Keep the request's original database/configuration and authority identity.
  // The owned SQL and primitive bindings are reused, but checked live each time.
  const database=env.DB,executionEnv:WorkerEnv={...env,DB:database};
  const stream=auth.user.streamId,owner=auth.user.userId,original=intakeGuard(executionEnv,auth,intake,options);
  const guard={sql:original.sql,bindings:[...original.bindings]};
  Object.freeze(guard.bindings);Object.freeze(guard);
  const scope:AtomicIntakeScope=Object.freeze({database,stream,owner,guard,
    prefix:options?.receiptPrefix??projectIntakeReceiptPrefix(intake.projectId),
    clientId:options?.clientId??"web:project-intake",correlationId:(options?.correlationPrefix??"project-intake:")+intake.projectId,custom:options!==undefined});
  const before=await readOriginal(scope,intake);
  if(!before.authorized||before.seen||action==="check")return reply(intake,before);
  const events=intake.events.map(input=>makeEvent(stream,0,"user",scope.clientId,scope.correlationId,input.type,input.payload));
  const root=events[0]!,rootKey=String(root.payload.client_event_id),now=new Date().toISOString();
  try{
    await appendEvents(executionEnv,events,{retries:1,prepareSidecars:assigned=>{
      const batch=JSON.stringify(assigned.map(event=>({id:event.eventId,key:event.payload.client_event_id,type:event.type,sequence:event.sequence,payload:JSON.stringify(event.payload)})));
      const resourceIds=JSON.stringify([...new Set(intake.events.flatMap(event=>[event.payload.project_id,event.payload.document_id,event.payload.block_id,event.payload.reference_id].filter((id):id is string=>typeof id==="string")))]);
      const receipts=assigned.slice(1).map(event=>database.prepare(`INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at)
        SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=?)`)
        .bind(stream,String(event.payload.client_event_id),event.eventId,event.sequence,now,event.eventId,stream,event.sequence));
      // Existing NOT NULL event_id is the all-or-none assertion. Existing root
      // PK fences a concurrent winner; either failure rolls back this entire
      // appendEvents D1 batch, including all staged events/private envelopes.
      receipts.push(database.prepare(`INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at)
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
          AND (SELECT COUNT(*) FROM event_client_receipts counted WHERE counted.stream_id=?
            AND substr(counted.client_event_id,1,length(?))=?)=?
          AND NOT EXISTS(SELECT 1 FROM events prior WHERE prior.stream_id=? AND prior.type IN('ProjectCreated','DocumentCreated','BlockCreated','ReferenceIngested')
            AND (json_extract(prior.payload,'$.project_id') IN(SELECT value FROM json_each(?)) AND prior.type='ProjectCreated'
              OR json_extract(prior.payload,'$.document_id') IN(SELECT value FROM json_each(?)) AND prior.type='DocumentCreated'
              OR json_extract(prior.payload,'$.block_id') IN(SELECT value FROM json_each(?)) AND prior.type='BlockCreated'
              OR json_extract(prior.payload,'$.reference_id') IN(SELECT value FROM json_each(?)) AND prior.type='ReferenceIngested')
            AND prior.event_id NOT IN(SELECT json_extract(value,'$.id') FROM json_each(?)))
          THEN ? ELSE NULL END,?,?)`)
        .bind(stream,rootKey,...guard.bindings,batch,stream,owner,assigned.length,batch,stream,assigned.length-1,
          stream,scope.prefix,scope.prefix,assigned.length-1,stream,resourceIds,resourceIds,resourceIds,resourceIds,batch,root.eventId,root.sequence,now));
      return receipts;
    }});
  }catch{
    // This may be a unique-root winner, authorization/head change, or lost DB
    // acknowledgment. Only the actual original receipt read may resolve it.
  }
  return reply(intake,await readOriginal(scope,intake));
}
