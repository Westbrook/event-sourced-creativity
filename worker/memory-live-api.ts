import { memoryDigest } from "../src/model/scoped-memory.ts";
import { MEMORY_ASSISTED_OUTCOMES_VERSION } from "../src/model/memory-assisted-outcomes.ts";
import { MEMORY_SAVED_OUTPUTS_VERSION } from "../src/model/memory-saved-outputs.ts";
import { MEMORY_CONSUMPTION_EPISODES_VERSION } from "../src/model/memory-consumption-episodes.ts";
import { MEMORY_CONSUMPTION_V2, MEMORY_CONSUMPTION_V3 } from "../src/model/memory-consumption-v2.ts";
import { MEMORY_WRITE_CONTRACT, memoryCustodyMatches, parseMemoryCustody } from "../src/model/memory-custody.ts";
import { requireUser, requireConsent } from "./pilot-policy.ts";
import { prepareDocumentAuthority } from "./context-authoring-authority.ts";
import { LIVE_MEMORY_POLICY, LIVE_MEMORY_REVIEW_CONTRACT, LIVE_MEMORY_REVIEW_TIMING, liveMemoryAuthority, liveMemoryEnrollmentGuard, type LiveMemoryEnrollment } from "./memory-live-authority.ts";
import { readLiveMemoryCheckpointHealth } from "./memory-live-checkpoints.ts";
import { executionAdmissionGuard } from "./consequential-consent.ts";
import { liveMemoryEnabled, liveMemorySchemaReady, memorySqlAssertion, revokeLiveMemoryCounted, liveMemoryOriginWithdrawalStatements, prepareStructuredConversationWithdrawal, readStructuredConversationCleanupStatuses } from "./memory-live-store.ts";
import { recallLiveMemoryResponse } from "./memory-live-recall.ts";
import { exportLiveMemory } from "./memory-live-export.ts";
import { documentProfileWithdrawalStatements } from "./memory-document-profile-store.ts";
import { prepareDerivationWithdrawal } from "./memory-derivation-store.ts";
import { liveConversationPrune, liveConversationPreserve } from "./memory-live-conversation.ts";
import type { WorkerEnv } from "./runtime.ts";

const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store","vary":"Cookie, oai-authenticated-user-id, oai-authenticated-user-email"}});
const settings=(e:LiveMemoryEnrollment)=>({id:e.enrollment_id,projectId:e.project_id,documentId:e.document_id,organizationId:e.organization_id,
  revision:e.revision,learn:Boolean(e.learn_enabled),recall:Boolean(e.recall_enabled),background:Boolean(e.background_enabled),
  retentionDays:e.retention_days,timeZone:e.time_zone,expiresAt:e.expires_at,policyVersion:e.policy_version,lastAdmittedAt:e.last_admitted_at,
  throughSequence:e.cursor_sequence,cutoffSequence:e.cutoff_sequence,backlog:e.cutoff_sequence!==null,nextDueAt:e.next_due_at,
  attempts:e.attempts,status:e.failure_code??"ready"});

async function memoryRequestText(request:Request):Promise<string|null>{
  if(!request.body)return "";
  const reader=request.body.getReader(),decoder=new TextDecoder(),chunks:string[]=[];let bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
    if(bytes>4096){await reader.cancel();return null;}chunks.push(decoder.decode(value,{stream:true}));}
    chunks.push(decoder.decode());return chunks.join("");
  }finally{reader.releaseLock();}
}

/** Expected custody is a consent constraint only; native code independently resolves actor, custody and authority. */
export async function handleLiveMemory(request:Request,env:WorkerEnv,operation:"settings"|"recall"|"export"|"processing"):Promise<Response> {
  const requestDb=env.DB;
  const auth=await requireUser(request,env,"viewer",{account:"principal"});
  if(auth.response||!auth.user)return auth.response??reply({error:"authentication_required"},401);
  if(auth.user.fictional)return reply({error:"principal_account_required"},403);
  if(!await liveMemorySchemaReady(env))return reply({error:"memory_schema_unavailable"},503);
  const actor=auth.user,url=new URL(request.url),id=url.searchParams.get("id");
  if(request.method==="GET"){
    if(operation==="settings"){
      const after=url.searchParams.get("after")??"";
      try{
        const db=requestDb;
        if(env.DB!==db)return reply({error:"memory_cleanup_status_unavailable"},503);
        const result=structuredClone(await db.prepare("SELECT * FROM memory_live_enrollments WHERE actor_user_id=? AND enrollment_id>? ORDER BY enrollment_id LIMIT 51")
          .bind(actor.userId,after).all<LiveMemoryEnrollment>());
        if(env.DB!==db||!result||typeof result!=="object"||result.success!==true||(result as typeof result & {error?:unknown}).error!==undefined||!Array.isArray(result.results)||result.results.length>51
          ||!Array.from(result.results).every(row=>row&&typeof row==="object"&&!Array.isArray(row)&&row.actor_user_id===actor.userId&&typeof row.enrollment_id==="string"))
          return reply({error:"memory_cleanup_status_unavailable"},503);
        const writeContractVersion=await liveMemorySchemaReady(env,true)?MEMORY_WRITE_CONTRACT:null;
        if(env.DB!==db)return reply({error:"memory_cleanup_status_unavailable"},503);
        const page=result.results.slice(0,50),cleanup=await readStructuredConversationCleanupStatuses(env,actor,page);
        if(env.DB!==db||!cleanup||cleanup.length!==page.length)return reply({error:"memory_cleanup_status_unavailable"},503);
        return reply({enabled:liveMemoryEnabled(env,actor.userId),policyVersion:LIVE_MEMORY_POLICY,reviewContract:LIVE_MEMORY_REVIEW_CONTRACT,writeContractVersion,
          enrollments:page.map((row,index)=>({...settings(row),structuredCleanup:cleanup[index]})),nextAfter:result.results.length>50?page.at(-1)!.enrollment_id:null});
      }catch{return reply({error:"memory_cleanup_status_unavailable"},503);}
    }
    if(!id)return reply({error:"memory_id_required"},400);
    const outcomes=operation==="recall"?url.searchParams.get("outcomes"):null;
    if(outcomes!==null&&outcomes!==MEMORY_ASSISTED_OUTCOMES_VERSION)return reply({error:"memory_outcomes_version_unsupported"},400);
    const savedOutputs=operation==="recall"?url.searchParams.get("savedOutputs"):null;
    if(savedOutputs!==null&&savedOutputs!==MEMORY_SAVED_OUTPUTS_VERSION)return reply({error:"memory_saved_outputs_version_unsupported"},400);
    const consumptionEpisodes=operation==="recall"?url.searchParams.getAll("consumptionEpisodes"):[];
    if(consumptionEpisodes.length>1||consumptionEpisodes.length===1&&![MEMORY_CONSUMPTION_EPISODES_VERSION,MEMORY_CONSUMPTION_V2,MEMORY_CONSUMPTION_V3].some(version=>version===consumptionEpisodes[0]))
      return reply({error:"memory_consumption_version_unsupported"},400);
    const revision=operation==="export"?url.searchParams.get("revision"):null;
    if(operation==="export"&&(!revision||!/^\d+$/u.test(revision)||!Number.isSafeInteger(Number(revision))||Number(revision)<1))return reply({error:"memory_revision_required"},400);
    const e=await env.DB.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=? AND actor_user_id=?").bind(id,actor.userId).first<LiveMemoryEnrollment>();
    if(!e)return reply({error:"memory_not_found"},404);
    if(!liveMemoryEnabled(env,actor.userId))return reply({error:"memory_disabled"},503);
    if(operation==="processing"){
      try{
        const authority=await liveMemoryAuthority(env,e);
        if(!authority||env.DB!==requestDb)return reply({error:"memory_processing_unavailable"},403);
        return reply(await readLiveMemoryCheckpointHealth(env,e,[authority.guard,liveMemoryEnrollmentGuard(e)]));
      }catch{return reply({error:"memory_processing_unavailable"},503);}
    }
    if(operation==="export"){
      if(e.revision!==Number(revision))return reply({error:"memory_revision_changed"},409);
      try{return await exportLiveMemory(env,e,actor);}catch{return reply({error:"memory_export_unavailable"},403);}
    }
    try{return await recallLiveMemoryResponse(env,e,actor,{assistedOutcomes:outcomes===MEMORY_ASSISTED_OUTCOMES_VERSION,
      savedOutputs:savedOutputs===MEMORY_SAVED_OUTPUTS_VERSION,consumptionEpisodes:consumptionEpisodes[0]===MEMORY_CONSUMPTION_V3?MEMORY_CONSUMPTION_V3:consumptionEpisodes[0]===MEMORY_CONSUMPTION_V2?MEMORY_CONSUMPTION_V2:consumptionEpisodes.length===1});}catch{return reply({error:"memory_unavailable"},403);}
  }
  if(operation!=="settings"||request.method!=="PUT"&&request.method!=="DELETE")return reply({error:"method_not_allowed"},405);
  const origin=request.headers.get("origin");if(origin&&origin!==url.origin)return reply({error:"same_origin_required"},403);
  if(request.headers.get("sec-fetch-site")==="cross-site")return reply({error:"same_origin_required"},403);
  const raw=await memoryRequestText(request);if(raw===null)return reply({error:"memory_request_too_large"},413);
  let body:Record<string,unknown>;try{body=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=="object")throw new Error();}catch{return reply({error:"invalid_memory_request"},400);}
  if(request.method==="DELETE"){
    if(!id||body.confirmation!=="FORGET_MY_MEMORY"||!Number.isSafeInteger(body.revision))return reply({error:"explicit_memory_erasure_required"},400);
    const e=await env.DB.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=? AND actor_user_id=?").bind(id,actor.userId).first<LiveMemoryEnrollment>();
    if(!e)return reply({error:"memory_not_found"},404);if(e.revision!==body.revision)return reply({error:"memory_revision_changed"},409);
    try{
      const withdrawal=await revokeLiveMemoryCounted(env,e,"forgotten");
      if(!withdrawal.revoked)return reply({error:"memory_revision_changed"},409);
      if(withdrawal.structuredPendingRevisions>0||withdrawal.structuredPendingOrigins>0)return reply({erased:false,memoryWithdrawn:true,
        physicalCleanupPending:true,reEnrollmentRequired:true,otherDevicesAndBackupsPurged:false});
      return reply({erased:true,reEnrollmentRequired:true,otherDevicesAndBackupsPurged:false});
    }catch{return reply({error:"memory_write_unconfirmed"},409);}
  }
  if(!liveMemoryEnabled(env,actor.userId))return reply({error:"memory_disabled"},503);
  if(!await liveMemorySchemaReady(env,true))return reply({error:"memory_schema_unavailable"},503);
  const consent=requireConsent(actor);if(consent)return consent;
  if(!Object.hasOwn(body,"expectedCustody"))return reply({error:"explicit_memory_custody_required"},400);
  const expectedCustody=parseMemoryCustody(body.expectedCustody);
  if(!expectedCustody)return reply({error:"invalid_memory_custody"},400);
  const allowed=new Set(["projectId","documentId","learn","recall","background","retentionDays","timeZone","expiresAt","revision","confirmation","policyVersion","reviewTiming","expectedCustody"]);
  if(Object.keys(body).some(key=>!allowed.has(key))||body.confirmation!=="ENABLE_PERSONAL_MEMORY"||body.policyVersion!==LIVE_MEMORY_POLICY
    || ![body.learn,body.recall,body.background].every(value=>typeof value==="boolean")||!Number.isSafeInteger(body.revision)||Number(body.revision)<0||Number(body.revision)>=Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(body.retentionDays)||Number(body.retentionDays)<1||Number(body.retentionDays)>365
    || typeof body.projectId!=="string"||typeof body.documentId!=="string"||typeof body.timeZone!=="string"||body.timeZone.length>80
    || typeof body.expiresAt!=="string")return reply({error:"explicit_memory_preferences_required"},400);
  if(body.background&&body.reviewTiming!==LIVE_MEMORY_REVIEW_TIMING
    || body.reviewTiming!==undefined&&body.reviewTiming!==LIVE_MEMORY_REVIEW_TIMING)return reply({error:"explicit_memory_review_timing_required",reviewContract:LIVE_MEMORY_REVIEW_CONTRACT},400);
  const now=new Date().toISOString(),expiry=Date.parse(body.expiresAt);
  if(!Number.isFinite(expiry)||expiry<=Date.parse(now)||expiry>Date.parse(now)+365*86_400_000)return reply({error:"invalid_memory_expiry"},400);
  try{new Intl.DateTimeFormat("en-US",{timeZone:body.timeZone}).format();}catch{return reply({error:"invalid_memory_timezone"},400);}
  const prepared=await prepareDocumentAuthority(request,env,body,"read");if(prepared instanceof Response)return prepared;
  const binding=prepared.binding,scope=binding.scope;
  if(!memoryCustodyMatches(expectedCustody,scope))return reply({error:"memory_custody_changed"},409);
  const enrollmentId=await memoryDigest(JSON.stringify([actor.userId,scope?.organizationId??"",scope?.projectAccessId??"",binding.projectId,binding.documentId]));
  const old=await env.DB.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=? AND actor_user_id=?").bind(enrollmentId,actor.userId).first<LiveMemoryEnrollment>();
  if((old?.revision??0)!==body.revision)return reply({error:"memory_revision_changed"},409);
  const preserve=Boolean(old&&old.policy_version===LIVE_MEMORY_POLICY&&old.permission_epoch===prepared.principal.access.permissionEpoch&&Date.parse(old.expires_at)>Date.parse(now)
    && old.actor_user_id===actor.userId&&old.owner_user_id===(scope?.ownerUserId??actor.userId)
    && old.organization_id===(scope?.organizationId??null)&&old.project_access_id===(scope?.projectAccessId??null)
    && old.project_id===binding.projectId&&old.document_id===binding.documentId
    && (old.learn_enabled||old.recall_enabled)&&(body.learn||body.recall)&&!["forgotten","erased","access-changed","revoked"].includes(old.failure_code??""));
  const e:LiveMemoryEnrollment={enrollment_id:enrollmentId,actor_user_id:actor.userId,owner_user_id:scope?.ownerUserId??actor.userId,
    organization_id:scope?.organizationId??null,project_access_id:scope?.projectAccessId??null,project_id:binding.projectId,document_id:binding.documentId,
    permission_epoch:prepared.principal.access.permissionEpoch,policy_version:LIVE_MEMORY_POLICY,revision:(old?.revision??0)+1,
    learn_enabled:Number(body.learn),recall_enabled:Number(body.recall),background_enabled:Number(body.background),retention_days:Number(body.retentionDays),
    time_zone:body.timeZone,enrolled_at:preserve?old!.enrolled_at:now,expires_at:new Date(expiry).toISOString(),
    cursor_sequence:preserve&&old!.learn_enabled?old!.cursor_sequence:prepared.sourceHead,cutoff_sequence:preserve&&old!.learn_enabled&&body.learn?old!.cutoff_sequence:null,
    last_local_day:preserve?old!.last_local_day:null,last_admitted_at:preserve?old!.last_admitted_at:null,next_due_at:now,lease_token:null,lease_expires_at:null,attempts:0,failure_code:null};
  const authority=await liveMemoryAuthority(env,e);
  if(!authority)return reply({error:"memory_background_authority_unavailable",message:"This scope cannot currently authorize durable memory independently of the signed-in session."},403);
  const revisionGuard=old?{condition:`EXISTS(SELECT 1 FROM memory_live_enrollments WHERE enrollment_id=? AND revision=?
    AND cursor_sequence=? AND cutoff_sequence IS ? AND last_local_day IS ? AND last_admitted_at IS ? AND lease_token IS ?
    AND lease_expires_at IS ? AND attempts=?)`,bindings:[enrollmentId,old.revision,old.cursor_sequence,old.cutoff_sequence,old.last_local_day,old.last_admitted_at,old.lease_token,old.lease_expires_at,old.attempts]}
    :{condition:"NOT EXISTS(SELECT 1 FROM memory_live_enrollments WHERE enrollment_id=?)",bindings:[enrollmentId]};
  const columns=Object.keys(e),values=Object.values(e);
  // The original browser/project session must survive grant publication. Only later background use is session-independent.
  const preparedAdmission=executionAdmissionGuard(prepared.principal,prepared.binding,null);
  const enrollmentAdmission={condition:preparedAdmission.sql,bindings:preparedAdmission.bindings};
  const conversationCleanup=liveConversationPrune(enrollmentId,old?.revision??0);
  const conversationPreserve=liveConversationPreserve(e,old?.revision??0,now);
  // Even preserving settings publish a new enrollment revision. Original
  // derived answers retain their old tuple and must never be retagged/revived.
  const originWrites=await liveMemoryOriginWithdrawalStatements(env,old?{enrollmentId,currentRevision:old.revision}:{enrollmentId},"enrollment-changed",now);
  const profileWrites=await documentProfileWithdrawalStatements(env,old?{enrollmentId,currentEnrollmentRevision:old.revision}:{enrollmentId},now);
  const derivationWrites=await prepareDerivationWithdrawal(env,old?{enrollmentId,currentEnrollmentRevision:old.revision}:{enrollmentId},now);
  // Every replacement, including preserve=true and a new enrollment identity,
  // retires the old stable-scope structured ledger instead of retagging history.
  const structuredWrites=await prepareStructuredConversationWithdrawal(env,old?{enrollment:old}:{enrollment:e,expectedEnrollmentAbsent:true},now);
  const beforeGuards=[authority.guard,enrollmentAdmission,revisionGuard],afterGuards=[authority.guard,enrollmentAdmission];
  try{
  const writes=[
    ...originWrites,...profileWrites,...derivationWrites.statements,...structuredWrites.statements,
    ...(preserve?[]:[env.DB.prepare("DELETE FROM memory_live_sources WHERE enrollment_id=?").bind(enrollmentId),
      env.DB.prepare("DELETE FROM memory_live_conversation_segments WHERE enrollment_id=?").bind(enrollmentId)]),
    ...(preserve?[
      env.DB.prepare(`UPDATE memory_live_sources SET expires_at=MIN(expires_at,?,COALESCE((SELECT strftime('%Y-%m-%dT%H:%M:%fZ',event.recorded_at,'+'||?||' days')
        FROM events event WHERE event.event_id=memory_live_sources.event_id AND event.sequence=memory_live_sources.sequence),?)) WHERE enrollment_id=?`).bind(e.expires_at,e.retention_days,now,enrollmentId),
      env.DB.prepare("DELETE FROM memory_live_sources WHERE enrollment_id=? AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(enrollmentId),
      env.DB.prepare(conversationCleanup.sql).bind(...conversationCleanup.bindings),
      env.DB.prepare(conversationPreserve.sql).bind(...conversationPreserve.bindings),
    ]:[]),
    env.DB.prepare(`INSERT INTO memory_live_enrollments(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})
      ON CONFLICT(enrollment_id) DO UPDATE SET ${columns.filter(key=>key!=="enrollment_id").map(key=>`${key}=excluded.${key}`).join(",")}`).bind(...values),
    memorySqlAssertion(env,{condition:`changes()=1 AND EXISTS(SELECT 1 FROM memory_live_enrollments WHERE ${columns.map(key=>`${key} IS ?`).join(" AND ")})`,bindings:values}),
    ...structuredWrites.terminalAssertions,
    ...derivationWrites.terminalAssertions,
  ];
  // Keep the identical guarded transaction order, but validate the complete raw
  // acknowledgement here: the shared helper returns only the inner write slice.
  const statements=[...beforeGuards.map(guard=>memorySqlAssertion(env,guard)),...writes,...afterGuards.map(guard=>memorySqlAssertion(env,guard))];
  const enrollmentIndex=writes.length-structuredWrites.terminalAssertions.length-derivationWrites.terminalAssertions.length-2;
  const derivationOffset=originWrites.length+profileWrites.length;
  const structuredOffset=derivationOffset+derivationWrites.statements.length;
  const verifiedIndexes=[...beforeGuards.map((_,index)=>index),
    ...structuredWrites.assertionIndexes.map(index=>beforeGuards.length+structuredOffset+index),
    ...derivationWrites.assertionIndexes.map(index=>beforeGuards.length+derivationOffset+index),
    beforeGuards.length+enrollmentIndex+1,
    ...structuredWrites.terminalAssertions.map((_,index)=>beforeGuards.length+enrollmentIndex+2+index),
    ...derivationWrites.terminalAssertions.map((_,index)=>beforeGuards.length+enrollmentIndex+2+structuredWrites.terminalAssertions.length+index),
    ...afterGuards.map((_,index)=>beforeGuards.length+writes.length+index)];
    const results=structuredClone(await env.DB.batch(statements));
    if(!Array.isArray(results)||results.length!==statements.length||!Array.from(results).every(result=>result&&typeof result==="object"&&!Array.isArray(result)
      &&Object.hasOwn(result,"success")&&result.success===true&&(result as typeof result & {error?:unknown}).error===undefined&&Object.hasOwn(result,"results")&&Array.isArray(result.results))
      ||!verifiedIndexes.every(index=>results[index].results.length===1&&results[index].results[0]&&typeof results[index].results[0]==="object"
        &&!Array.isArray(results[index].results[0])&&Object.keys(results[index].results[0]).length===1
        &&Object.hasOwn(results[index].results[0],"verified")&&(results[index].results[0] as {verified:unknown}).verified===1)
      ||results[beforeGuards.length+enrollmentIndex].meta?.changes!==1
      ||!derivationWrites.acknowledge(results.slice(beforeGuards.length+derivationOffset,beforeGuards.length+derivationOffset+derivationWrites.statements.length))
      ||!structuredWrites.acknowledge(results.slice(beforeGuards.length+structuredOffset,
        beforeGuards.length+structuredOffset+structuredWrites.statements.length)))throw new Error("memory-write-unconfirmed");
  }catch{return reply({error:"memory_write_unconfirmed"},409);}
  return reply({enrollment:settings(e),reviewContract:LIVE_MEMORY_REVIEW_CONTRACT,historyStartsAt:e.enrolled_at,priorMemoryCleared:!preserve&&structuredWrites.pendingRevisions===0&&structuredWrites.pendingOrigins===0,uiChanged:false});
}
