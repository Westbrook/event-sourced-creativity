import { memoryAssert, memoryGuardQuery, type MemorySqlGuard } from "./memory-sql.ts";
import { observeNativeMemoryDocumentScope, type NativeMemoryDocumentScope } from "./memory-native-scope.ts";
import { prepareLiveMemoryCheckpointWithdrawal } from "./memory-live-checkpoints.ts";
import { liveMemoryAuthority, liveMemoryEnrollmentGuard, liveMemoryMaintenanceAttemptFor, type LiveMemoryEnrollment, type LiveMemoryMaintenanceAttempt,
  type LiveMemoryDenialCertificate } from "./memory-live-authority.ts";
import { liveMemorySourceQuery, liveMemoryView, type LiveSourceRow } from "./memory-live-sources.ts";
import { uuidV7, type WorkerEnv } from "./runtime.ts";
import { documentProfileWithdrawalStatements } from "./memory-document-profile-store.ts";
import { nativeMemoryOriginWithdrawal, prepareNativeMemoryOriginWithdrawal, prepareNativeMemoryOriginDependencyWithdrawal, nativeMemoryOriginSourceExclusion,
  nativeStructuredOriginSchema, nativeStructuredOriginMinimizedIntegrity, prepareNativeStructuredOriginWithdrawal, prepareNativeDocumentJobOriginWithdrawal,
  readNativeDocumentJobOriginCleanupCoverage, prepareNativeDocumentJobOriginErasureBarrier, type NativeDocumentJobOriginCleanupCoverage,
  type NativeMemoryOriginHeader, type NativeMemoryOriginDependencyWithdrawalScope,
  type NativeMemoryOriginWithdrawalSelector, type NativeMemoryOriginWithdrawalReason } from "./memory-native-origin.ts";

async function liveConversationSchemaReady(env:WorkerEnv):Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_live_conversation_segments'").first());
}
/** Legacy settings/recall remain compatible; only the job runner requires the additive conversation schema. */
export async function liveMemorySchemaReady(env:WorkerEnv,requireConversation=false):Promise<boolean> {
  const row=await env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name IN('memory_live_enrollments','memory_live_sources','memory_live_runs')").first<{count:number}>();
  return row?.count===3&&(!requireConversation||await liveConversationSchemaReady(env)
    &&Boolean(await env.DB.prepare("SELECT 1 FROM pragma_table_info('memory_live_sources') WHERE name='conversation_segmented' AND type='INTEGER' AND [notnull]=1").first()));
}
/** Deployment admission never substitutes for each user's explicit enrollment. No wildcard rollout. */
export const liveMemoryEnabled=(env:WorkerEnv,actorUserId:string)=>env.FORMA_MEMORY_ENABLED==="true"
  && (env.FORMA_MEMORY_USER_IDS??"").split(",").map(id=>id.trim()).filter(Boolean).includes(actorUserId);
export const memorySqlAssertion=(env:WorkerEnv,guard:MemorySqlGuard)=>env.DB.prepare(`SELECT CASE WHEN (${guard.condition}) THEN 1 ELSE json('memory_authority_changed') END AS verified`).bind(...guard.bindings);
const directStructuredWithdrawalReceipts=new WeakMap<D1PreparedStatement,{
  statements:readonly D1PreparedStatement[];acknowledge:(results:readonly unknown[])=>boolean;
}>();
export async function memoryAtomic(env:WorkerEnv,guards:MemorySqlGuard[],writes:D1PreparedStatement[],after:MemorySqlGuard[]=guards) {
  const db=env.DB,statements=[...guards.map(guard=>memorySqlAssertion(env,guard)),...writes,...after.map(guard=>memorySqlAssertion(env,guard))];
  const results=await db.batch<StructuredLedgerRow>(statements);
  memoryAssert(env.DB===db&&structuredResults(results,statements.length)
    &&structuredAsserted(results,[...guards.map((_,index)=>index),...after.map((_,index)=>guards.length+writes.length+index)],"verified"),"memory-write-unconfirmed");
  const written=results.slice(guards.length,guards.length+writes.length);
  for(let index=0;index<writes.length;index++){
    const receipt=directStructuredWithdrawalReceipts.get(writes[index]);
    if(receipt)memoryAssert(receipt.statements.every((statement,offset)=>writes[index+offset]===statement)
      &&receipt.acknowledge(written.slice(index,index+receipt.statements.length)),"memory-write-unconfirmed");
  }
  return written;
}

/** Erasure is independent of deployment/enrollment flags. Historical absence of
 * both origin tables remains compatible, but returns schema assertions rather
 * than an empty array: absence must still hold in the caller's transaction.
 * Keep the ENTIRE returned array contiguous, including its schema bookends.
 * Actor/scope inverses do not require optional conversation/enrollment tables. */
export async function liveMemoryOriginWithdrawalStatements(env:WorkerEnv,selector:NativeMemoryOriginWithdrawalSelector,
  reason:NativeMemoryOriginWithdrawalReason,now:string):Promise<D1PreparedStatement[]> {
  const db=env.DB,selectorKey=canonicalConsent(selector),selected=structuredClone(selector);
  const current=()=>env.DB===db&&canonicalConsent(selector)===selectorKey;
  const legacy=await liveExtractiveMemoryOriginWithdrawalStatements(env,selected,reason,now);
  const checkpoint=await prepareLiveMemoryCheckpointWithdrawal(env,selected);
  directStructuredWithdrawalReceipts.set(checkpoint.statements[0]!,{statements:checkpoint.statements,acknowledge:results=>checkpoint.acknowledge(results as D1Result[])});
  legacy.unshift(...checkpoint.statements);
  legacy.push(checkpoint.terminal);
  if(!current())throw new Error("memory-origin-withdrawal-preparation-changed");
  // Scope-wide privacy/settings boundaries already compose the v2 inverse with
  // native ledger retirement. Direct source and answer identity withdrawals must
  // also retire every v2 consumer, including negative-history fanout.
  if(!("eventId" in selected||"contentId" in selected||"originId" in selected))return legacy;
  const structured=await prepareNativeStructuredOriginWithdrawal(env,selected,reason,now);
  if(!structured||!current())throw new Error("memory-structured-origin-withdrawal-unavailable");
  const job=await prepareNativeDocumentJobOriginWithdrawal(env,selected,reason,now);
  if(!job||!current())throw new Error("memory-document-job-origin-withdrawal-unavailable");
  const statements=structured.statements.map(query=>db.prepare(query.sql).bind(...query.bindings));
  const terminal=structured.terminalAssertions.map(query=>db.prepare(query.sql).bind(...query.bindings));
  const jobStatements=job.statements.map(query=>db.prepare(query.sql).bind(...query.bindings));
  const jobTerminal=job.terminalAssertions.map(query=>db.prepare(query.sql).bind(...query.bindings));
  const jobOffset=statements.length+terminal.length,terminalOffset=jobOffset+jobStatements.length;
  const complete=[...statements,...terminal,...jobStatements,...jobTerminal];
  directStructuredWithdrawalReceipts.set(complete[0],{statements:complete,acknowledge(results){
    return current()&&structuredResults(results as D1Result<StructuredLedgerRow>[],complete.length)
      &&structuredAsserted(results as D1Result<StructuredLedgerRow>[],[...terminal.map((_,index)=>statements.length+index),
        ...jobTerminal.map((_,index)=>terminalOffset+index)],"verified")
      &&structured.acknowledge(results.slice(0,statements.length))
      &&job.acknowledge(results.slice(jobOffset,terminalOffset));
  }});
  return [...legacy,...complete];
}
async function liveExtractiveMemoryOriginWithdrawalStatements(env:WorkerEnv,selector:NativeMemoryOriginWithdrawalSelector,
  reason:NativeMemoryOriginWithdrawalReason,now:string):Promise<D1PreparedStatement[]> {
  const db=env.DB,names=["memory_native_answer_origins","memory_native_answer_dependencies"];
  const schema=await db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name IN(?,?) ORDER BY name")
    .bind(...names).all<{type:string;name:string;sql:string}>();
  if(!schema||typeof schema!=="object"||Array.isArray(schema)||schema.success!==true
    ||"error" in schema&&schema.error!==undefined||!Array.isArray(schema.results)||schema.results.length>names.length
    ||!schema.results.every(row=>row&&typeof row==="object"&&!Array.isArray(row)
      &&Object.keys(row).length===3&&["type","name","sql"].every(key=>Object.prototype.hasOwnProperty.call(row,key))
      &&row.type==="table"&&names.includes(row.name)&&typeof row.sql==="string"&&row.sql.length>0)
    ||new Set(schema.results.map(row=>row.name)).size!==schema.results.length)throw new Error("memory-origin-withdrawal-schema-unavailable");
  const schemaRows=schema.results.map(row=>({type:row.type,name:row.name,sql:row.sql}));
  memoryAssert(schemaRows.length===0||schemaRows.length===names.length,"memory-origin-withdrawal-schema-unavailable");
  const schemaCondition="(SELECT COUNT(*) FROM sqlite_schema WHERE name IN(?,?))=?"
    +schemaRows.map(()=>" AND EXISTS(SELECT 1 FROM sqlite_schema WHERE (type,name,sql) IS (?,?,?))").join("");
  const schemaBindings=[...names,schemaRows.length,...schemaRows.flatMap(row=>[row.type,row.name,row.sql])];
  const schemaAssertion=()=>db.prepare(`SELECT CASE WHEN ${schemaCondition}
    THEN 1 ELSE json('memory_origin_withdrawal_schema_changed') END AS verified`).bind(...schemaBindings);
  const bracket=(writes:D1PreparedStatement[])=>{
    memoryAssert(env.DB===db,"memory-origin-withdrawal-preparation-changed");
    return [schemaAssertion(),...writes,schemaAssertion()];
  };
  if(!schemaRows.length)return bracket([]);
  // Preserve this legacy execution-local, late-bound primitive for existing
  // callers. Jobs use the independently prepared, mutation-bracketed helper
  // below to minimize dependencies as part of each real prune/trim transaction.
  if(selector&&typeof selector==="object"&&"unavailableDependencies" in selector&&selector.unavailableDependencies===true){
    const queries=nativeMemoryOriginWithdrawal(selector,reason,now);
    memoryAssert(queries,"memory-origin-withdrawal-invalid");
    return bracket(queries!.map(query=>db.prepare(query.sql).bind(...query.bindings)));
  }
  const plan=prepareNativeMemoryOriginWithdrawal(selector,reason,now);
  memoryAssert(plan,"memory-origin-withdrawal-invalid");
  const captured=await db.prepare(plan!.targets.sql).bind(...plan!.targets.bindings).all<NativeMemoryOriginHeader>();
  if(!captured||typeof captured!=="object"||Array.isArray(captured)||captured.success!==true
    ||"error" in captured&&captured.error!==undefined||!Array.isArray(captured.results))throw new Error("memory-origin-withdrawal-unavailable");
  // The SELECT is only preparation. Exact selection/header assertions execute
  // with the writes in the caller's transaction, including an empty capture.
  // Existing callers change enrollment revision only after this array. The
  // original revision guard covers every origin step; schema drift still aborts.
  const queries=plan!.statements(captured.results);
  memoryAssert(queries,"memory-origin-withdrawal-invalid");
  return bracket(queries!.map(query=>db.prepare(query.sql).bind(...query.bindings)));
}

/** One fresh snapshot per transaction. Keep beforeMutation ahead of the caller's
 * source/group writes, and all afterMutation statements contiguous after its
 * last prune/trim, inside that SAME atomic batch and before enrollment updates.
 * This cleanup has no deployment/capture flag gate of its own. */
export async function liveMemoryOriginDependencyWithdrawalStatements(env:WorkerEnv,scope:NativeMemoryOriginDependencyWithdrawalScope,
  reason:NativeMemoryOriginWithdrawalReason,now:string):Promise<{
    beforeMutation:D1PreparedStatement[];afterMutation:D1PreparedStatement[];
  }> {
  if(!await env.DB.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins'").first()){
    return {beforeMutation:[],afterMutation:[]};
  }
  const plan=prepareNativeMemoryOriginDependencyWithdrawal(scope,reason,now);
  memoryAssert(plan,"memory-origin-withdrawal-invalid");
  const captured=await env.DB.prepare(plan!.targets.sql).bind(...plan!.targets.bindings).all<NativeMemoryOriginHeader>();
  memoryAssert(captured.success&&Array.isArray(captured.results),"memory-origin-withdrawal-unavailable");
  const queries=plan!.statements(captured.results);
  memoryAssert(queries,"memory-origin-withdrawal-invalid");
  const statements=(items:NonNullable<typeof queries>["beforeMutation"])=>items.map(query=>env.DB.prepare(query.sql).bind(...query.bindings));
  return {beforeMutation:statements(queries!.beforeMutation),afterMutation:statements(queries!.afterMutation)};
}

type LiveMemoryErasureScope={actorUserId:string;personalOnly?:boolean}|{organizationId:string};
/** No getters are executed to obtain acknowledgement values. Reflection may
 * itself be adversarial, so every caller also checks original DB/input identity
 * after this finite copy and after its nested native acknowledgement. */
function memoryErasureReceiptData(input:readonly unknown[],count:number):D1Result<StructuredLedgerRow>[]|null {
  try {
    const value=(object:object,key:PropertyKey)=>{const descriptor=Object.getOwnPropertyDescriptor(object,key);
      if(!descriptor||!("value" in descriptor))throw new Error("memory-erasure-receipt-invalid");return descriptor.value as unknown;};
    const plain=(object:unknown):object is Record<string,unknown>=>!!object&&typeof object==="object"&&!Array.isArray(object)
      &&[Object.prototype,null].includes(Object.getPrototypeOf(object));
    if(!Array.isArray(input)||value(input,"length")!==count)return null;
    const result:D1Result<StructuredLedgerRow>[]=[];
    for(let index=0;index<count;index++){
      const receipt=value(input,index);if(!plain(receipt)||value(receipt,"success")!==true)return null;
      const error=Object.getOwnPropertyDescriptor(receipt,"error");if(error&&(!("value" in error)||error.value!==undefined))return null;
      const rows=value(receipt,"results");if(!Array.isArray(rows))return null;
      const length=value(rows,"length");if(!Number.isSafeInteger(length)||Number(length)<0||Number(length)>1)return null;
      const copied:StructuredLedgerRow[]=[];
      for(let offset=0;offset<Number(length);offset++){
        const row=value(rows,offset);if(!plain(row))return null;
        const keys=Reflect.ownKeys(row);if(keys.some(key=>typeof key!=="string"))return null;
        const copy:StructuredLedgerRow=Object.create(null);
        for(const key of keys as string[]){const item=value(row,key);
          if(item!==null&&typeof item!=="string"&&typeof item!=="boolean"&&!(typeof item==="number"&&Number.isFinite(item)))return null;
          copy[key]=item as string|number|null;}
        copied.push(copy);
      }
      const meta=Object.getOwnPropertyDescriptor(receipt,"meta");let changes:unknown;
      if(meta){if(!("value" in meta)||!plain(meta.value))return null;changes=value(meta.value,"changes");
        if(!Number.isSafeInteger(changes)||Number(changes)<0)return null;}
      result.push({success:true,results:copied,...(meta?{meta:{changes}}:{})} as D1Result<StructuredLedgerRow>);
    }
    return result;
  }catch{return null;}
}
/** Confirmed erasure preparation only. No authored body, event, external resource,
 * ledger or memory-source row is erased here. Complete job evidence precedes the
 * one negative transition/initialization and enrollment revocation in this batch. */
export async function prepareLiveMemoryErasureBarrier(env:WorkerEnv,scope:LiveMemoryErasureScope,now:string):Promise<{
  statements:D1PreparedStatement[];assertionIndexes:number[];pendingOrigins:number;initializedOrigins:number;
  bookkeepingWrites:number;acknowledge(results:readonly unknown[]):boolean;
}> {
  const db=env.DB,selected=structuredClone(scope),key=canonicalConsent(scope),current=()=>env.DB===db&&canonicalConsent(scope)===key;
  const selector="organizationId" in selected?{organizationId:selected.organizationId}:selected.personalOnly
    ?{actorUserId:selected.actorUserId,personalOnly:true as const}:{actorUserId:selected.actorUserId};
  const job=await prepareNativeDocumentJobOriginErasureBarrier(env,selector,now);
  if(!job||!current())throw new Error("memory-erasure-barrier-unavailable");
  const schemaQuery="SELECT type,name,sql FROM sqlite_schema WHERE name='memory_live_enrollments'";
  const schema=structuredClone(await db.prepare(schemaQuery).all<{type:string;name:string;sql:string}>());
  if(!current()||!structuredResults([schema],1)||schema.results.length>1||schema.results.some(row=>!structuredKeys(row,["type","name","sql"])
    ||row.type!=="table"||row.name!=="memory_live_enrollments"||typeof row.sql!=="string"||!row.sql||row.sql.length>65536))
    throw new Error("memory-erasure-enrollment-schema-unavailable");
  const schemaGuard=()=>memorySqlAssertion(env,{condition:`(SELECT COUNT(*) FROM sqlite_schema WHERE name='memory_live_enrollments')=?`
    +(schema.results.length?" AND EXISTS(SELECT 1 FROM sqlite_schema WHERE (type,name,sql) IS (?,?,?))":""),
    bindings:[schema.results.length,...schema.results.flatMap(row=>[row.type,row.name,row.sql])]});
  const clause="organizationId" in selected?"organization_id=?":`actor_user_id=?${selected.personalOnly?" AND organization_id IS NULL":""}`;
  const scopeValue="organizationId" in selected?selected.organizationId:selected.actorUserId;
  let rows:StructuredLedgerRow[]=[];
  if(schema.results.length){
    const result=structuredClone(await db.prepare(`SELECT ${structuredEnrollmentColumns.join(",")} FROM memory_live_enrollments WHERE ${clause}
      ORDER BY enrollment_id`).bind(scopeValue).all<StructuredLedgerRow>());
    if(!current()||!structuredResults([result],1)||structuredBytes(result.results)>1_048_576
      ||result.results.some(row=>!structuredKeys(row,structuredEnrollmentColumns)||!structuredId(row.enrollment_id)
        ||!Number.isSafeInteger(row.revision)||Number(row.revision)<1||Number(row.revision)>=Number.MAX_SAFE_INTEGER
        ||nativeMemoryTimestamp(row.expires_at)===null||[row.learn_enabled,row.recall_enabled,row.background_enabled].some(value=>value!==0&&value!==1)))
      throw new Error("memory-erasure-enrollment-unavailable");
    rows=result.results;
  }
  const needsDisable=(row:StructuredLedgerRow)=>row.learn_enabled!==0||row.recall_enabled!==0||row.background_enabled!==0
    ||row.lease_token!==null||row.lease_expires_at!==null||row.cutoff_sequence!==null||row.failure_code!=="erased"
    ||row.next_due_at!=="9999-12-31T00:00:00.000Z";
  const terminal=rows.map(row=>needsDisable(row)?{...row,learn_enabled:0,recall_enabled:0,background_enabled:0,revision:Number(row.revision)+1,
    lease_token:null,lease_expires_at:null,cutoff_sequence:null,failure_code:"erased",next_due_at:"9999-12-31T00:00:00.000Z",
    expires_at:String(row.expires_at)>now?now:row.expires_at}:row);
  const exact=(expected:StructuredLedgerRow[])=>memorySqlAssertion(env,{condition:`(SELECT COUNT(*) FROM memory_live_enrollments WHERE ${clause})=?
    AND NOT EXISTS(SELECT 1 FROM memory_live_enrollments actual WHERE ${clause} AND NOT EXISTS(SELECT 1 FROM json_each(?) expected
      WHERE (${structuredEnrollmentColumns.map(column=>`actual.${column}`).join(",")}) IS
        (${structuredEnrollmentColumns.map(column=>`json_extract(expected.value,'$.${column}')`).join(",")})))`,
    bindings:[scopeValue,expected.length,scopeValue,canonicalConsent(expected)]});
  const statements=[schemaGuard(),...(schema.results.length?[exact(rows)]:[])],assertionIndexes=statements.map((_,index)=>index);
  const jobOffset=statements.length;statements.push(...job.statements.map(query=>db.prepare(query.sql).bind(...query.bindings)));
  assertionIndexes.push(...job.assertionIndexes.map(index=>jobOffset+index));
  const jobEnd=statements.length,changed=rows.filter(needsDisable).length;let updateIndex:number|null=null;
  if(schema.results.length){
    updateIndex=statements.length;
    statements.push(db.prepare(`UPDATE memory_live_enrollments SET learn_enabled=0,recall_enabled=0,background_enabled=0,revision=revision+1,
      lease_token=NULL,lease_expires_at=NULL,cutoff_sequence=NULL,failure_code='erased',next_due_at='9999-12-31T00:00:00.000Z',
      expires_at=MIN(expires_at,?) WHERE ${clause} AND (learn_enabled!=0 OR recall_enabled!=0 OR background_enabled!=0
        OR lease_token IS NOT NULL OR lease_expires_at IS NOT NULL OR cutoff_sequence IS NOT NULL OR failure_code IS NOT 'erased'
        OR next_due_at!='9999-12-31T00:00:00.000Z')`).bind(now,scopeValue));
    assertionIndexes.push(statements.length);statements.push(memorySqlAssertion(env,{condition:"changes()=?",bindings:[changed]}));
    assertionIndexes.push(statements.length);statements.push(exact(terminal));
  }
  for(const query of job.terminalAssertions){assertionIndexes.push(statements.length);statements.push(db.prepare(query.sql).bind(...query.bindings));}
  assertionIndexes.push(statements.length);statements.push(schemaGuard());
  if(!current())throw new Error("memory-erasure-barrier-changed");
  Object.freeze(statements);Object.freeze(assertionIndexes);let used=false;
  return Object.freeze({statements,assertionIndexes,pendingOrigins:job.pendingOrigins,initializedOrigins:job.initializedOrigins,
    bookkeepingWrites:job.bookkeepingWrites+(updateIndex===null?0:1),acknowledge(results:readonly unknown[]){
      if(used)return false;used=true;if(!current())return false;
      const safe=memoryErasureReceiptData(results,statements.length);
      return safe!==null&&structuredAsserted(safe,assertionIndexes,"verified")
        &&(updateIndex===null||safe[updateIndex].results.length===0&&safe[updateIndex].meta?.changes===changed)
        &&job.acknowledge(safe.slice(jobOffset,jobEnd))&&current();
    }});
}
/** Final source-erasure owner. These terminal assertions MUST follow the caller's
 * generic destructive writes. A ready observation without these same-batch guards
 * is not permission to erase; no request intent is persisted by this function. */
export async function prepareLiveMemoryErasureStatements(env:WorkerEnv,scope:LiveMemoryErasureScope,now:string):Promise<{
  statements:D1PreparedStatement[];terminalAssertions:D1PreparedStatement[];acknowledge(results:readonly unknown[]):boolean;
}> {
  const db=env.DB,key=canonicalConsent(scope),current=()=>env.DB===db&&canonicalConsent(scope)===key;
  const selected=structuredClone(scope),clause="organizationId" in selected?"organization_id=?":`actor_user_id=?${selected.personalOnly?" AND organization_id IS NULL":""}`;
  const scopeValue="organizationId" in selected?selected.organizationId:selected.actorUserId;
  const names=["memory_live_enrollments","memory_live_sources","memory_live_runs","memory_live_conversation_segments"];
  const schema=structuredClone(await db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name IN(?,?,?,?) ORDER BY name")
    .bind(...names).all<{type:string;name:string;sql:string}>());
  if(!current()||!structuredResults([schema],1)||schema.results.some(row=>!structuredKeys(row,["type","name","sql"])
    ||row.type!=="table"||!names.includes(String(row.name))||typeof row.sql!=="string"||!row.sql||row.sql.length>65536)
    ||new Set(schema.results.map(row=>row.name)).size!==schema.results.length
    ||schema.results.length!==0&&(![3,4].includes(schema.results.length)||names.slice(0,3).some(name=>!schema.results.some(row=>row.name===name))))
    throw new Error("memory-erasure-schema-unavailable");
  const present=schema.results.length!==0,conversation=schema.results.some(row=>row.name===names[3]);
  const schemaGuard=()=>memorySqlAssertion(env,{condition:"(SELECT COUNT(*) FROM sqlite_schema WHERE name IN(?,?,?,?))=?"
    +schema.results.map(()=>" AND EXISTS(SELECT 1 FROM sqlite_schema WHERE (type,name,sql) IS (?,?,?))").join(""),
    bindings:[...names,schema.results.length,...schema.results.flatMap(row=>[row.type,row.name,row.sql])]});
  let enrollmentIds:string[]=[];
  if(present){
    const result=structuredClone(await db.prepare(`SELECT enrollment_id FROM memory_live_enrollments WHERE ${clause} ORDER BY enrollment_id`)
      .bind(scopeValue).all<StructuredLedgerRow>());
    if(!current()||!structuredResults([result],1)||structuredBytes(result.results)>1_048_576
      ||result.results.some(row=>!structuredKeys(row,["enrollment_id"])||!structuredId(row.enrollment_id)))
      throw new Error("memory-erasure-enrollment-unavailable");
    enrollmentIds=result.results.map(row=>String(row.enrollment_id));
  }
  const identities=()=>memorySqlAssertion(env,{condition:`(SELECT COUNT(*) FROM memory_live_enrollments WHERE ${clause})=?
    AND NOT EXISTS(SELECT 1 FROM memory_live_enrollments WHERE ${clause} AND enrollment_id NOT IN(SELECT value FROM json_each(?)))`,
    bindings:[scopeValue,enrollmentIds.length,scopeValue,JSON.stringify(enrollmentIds)]});
  const originScope="organizationId" in selected?{organizationId:selected.organizationId}
    :selected.personalOnly?{actorUserId:selected.actorUserId,personalOnly:true as const}:{actorUserId:selected.actorUserId};
  const originWrites=await liveMemoryOriginWithdrawalStatements(env,originScope,"erased",now);
  if(!current())throw new Error("memory-erasure-preparation-changed");
  const profileWrites=await documentProfileWithdrawalStatements(env,selected,now);
  if(!current())throw new Error("memory-erasure-preparation-changed");
  const structuredWrites=await prepareStructuredConversationWithdrawal(env,selected,now);
  if(!current()||structuredWrites.pendingJobOrigins!==0)throw new Error("memory-erasure-job-cleanup-pending");
  const initial=[schemaGuard(),...(present?[identities()]:[])],structuredOffset=initial.length+originWrites.length+profileWrites.length;
  const statements=[...initial,...originWrites,...profileWrites,...structuredWrites.statements];
  if(present){
    statements.push(db.prepare(`DELETE FROM memory_live_sources WHERE enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE ${clause})`).bind(scopeValue),
      ...(conversation?[db.prepare(`DELETE FROM memory_live_conversation_segments WHERE enrollment_id IN(SELECT enrollment_id FROM memory_live_enrollments WHERE ${clause})`).bind(scopeValue)]:[]),
      db.prepare(`UPDATE memory_live_enrollments SET learn_enabled=0,recall_enabled=0,background_enabled=0,revision=revision+1,
        lease_token=NULL,lease_expires_at=NULL,cutoff_sequence=NULL,expires_at=?,next_due_at=?,failure_code='erased' WHERE ${clause}`).bind(now,now,scopeValue));
  }
  const terminalAssertions=[...structuredWrites.terminalAssertions,schemaGuard(),...(present?[identities(),memorySqlAssertion(env,{
    condition:`NOT EXISTS(SELECT 1 FROM memory_live_enrollments WHERE ${clause} AND (learn_enabled IS NOT 0 OR recall_enabled IS NOT 0
      OR background_enabled IS NOT 0 OR lease_token IS NOT NULL OR lease_expires_at IS NOT NULL OR cutoff_sequence IS NOT NULL
      OR failure_code IS NOT 'erased' OR expires_at IS NOT ?))
      AND NOT EXISTS(SELECT 1 FROM memory_live_sources WHERE enrollment_id IN(SELECT value FROM json_each(?)))`
      +(conversation?" AND NOT EXISTS(SELECT 1 FROM memory_live_conversation_segments WHERE enrollment_id IN(SELECT value FROM json_each(?)))":""),
    bindings:[scopeValue,now,JSON.stringify(enrollmentIds),...(conversation?[JSON.stringify(enrollmentIds)]:[])]})]:[])];
  if(!current())throw new Error("memory-erasure-preparation-changed");
  Object.freeze(statements);Object.freeze(terminalAssertions);let used=false;
  return Object.freeze({statements,terminalAssertions,acknowledge(results:readonly unknown[]){
    if(used)return false;used=true;if(!current())return false;
    const safe=memoryErasureReceiptData(results,statements.length+terminalAssertions.length);
    return safe!==null&&structuredAsserted(safe,[...initial.map((_,index)=>index),
      ...terminalAssertions.map((_,index)=>statements.length+index)],"verified")
      &&structuredWrites.acknowledge(safe.slice(structuredOffset,structuredOffset+structuredWrites.statements.length))&&current();
  }});
}
/** Legacy array caller remains fail-closed when derivative cleanup is pending. */
export async function liveMemoryErasureStatements(env:WorkerEnv,scope:LiveMemoryErasureScope,now:string):Promise<D1PreparedStatement[]> {
  const plan=await prepareLiveMemoryErasureStatements(env,scope,now),complete=[...plan.statements,...plan.terminalAssertions];
  directStructuredWithdrawalReceipts.set(complete[0],{statements:complete,acknowledge:plan.acknowledge});
  return complete;
}

export async function revokeLiveMemory(env:WorkerEnv,e:LiveMemoryEnrollment,code="revoked") {
  return (await revokeLiveMemoryCounted(env,e,code)).revoked;
}

/** Count the deletion that committed, never a separate pre-delete estimate. */
export async function revokeLiveMemoryCounted(env:WorkerEnv,e:LiveMemoryEnrollment,code="revoked") {
  const now=new Date().toISOString(),snapshot=structuredClone(e),key=canonicalConsent(e),db=env.DB;
  const originWrites=await liveMemoryOriginWithdrawalStatements(env,{enrollmentId:snapshot.enrollment_id,currentRevision:snapshot.revision},
    code==="forgotten"||code==="erased"?"erased":code==="access-changed"?"access-withdrawn":"enrollment-changed",now);
  const profileWrites=await documentProfileWithdrawalStatements(env,{enrollmentId:snapshot.enrollment_id,currentEnrollmentRevision:snapshot.revision},now);
  const structuredWrites=await prepareStructuredConversationWithdrawal(env,{enrollment:snapshot},now);
  const conversationReady=await liveConversationSchemaReady(env);
  // Stable ledger scope survives replacement, but a stale revocation must not gain
  // authority over the newer enrollment occupying that scope.
  const current=structuredClone(await db.prepare(`SELECT ${structuredJsonRow("enrollment",structuredEnrollmentColumns)} AS enrollment_json
    FROM memory_live_enrollments enrollment WHERE enrollment_id=?`).bind(snapshot.enrollment_id).all<StructuredLedgerRow>());
  if (!structuredResults([current],1)) throw new Error("memory-structured-withdrawal-unavailable");
  if (env.DB!==db || canonicalConsent(e)!==key || current.results.length!==1
    || typeof current.results[0].enrollment_json!=="string" || canonicalConsent(JSON.parse(current.results[0].enrollment_json))!==key)
    return {revoked:false,erased:0,structuredPendingRevisions:0,structuredPendingOrigins:0};
  const exact=(row:LiveMemoryEnrollment)=>memorySqlAssertion(env,{condition:`EXISTS(SELECT 1 FROM memory_live_enrollments WHERE
    ${structuredEnrollmentColumns.map(column=>`${column} IS ?`).join(" AND ")})`,bindings:structuredEnrollmentColumns.map(column=>row[column as keyof LiveMemoryEnrollment])});
  const terminal:LiveMemoryEnrollment={...snapshot,learn_enabled:0,recall_enabled:0,background_enabled:0,revision:snapshot.revision+1,
    lease_token:null,lease_expires_at:null,cutoff_sequence:null,failure_code:code,next_due_at:"9999-12-31T00:00:00.000Z"};
  const withdrawalWrites=[...originWrites,...profileWrites,...structuredWrites.statements];
  const statements=[exact(snapshot),...withdrawalWrites,
    db.prepare("DELETE FROM memory_live_sources WHERE enrollment_id=? AND EXISTS(SELECT 1 FROM memory_live_enrollments WHERE enrollment_id=? AND revision=?)").bind(snapshot.enrollment_id,snapshot.enrollment_id,snapshot.revision),
    ...(conversationReady?[db.prepare("DELETE FROM memory_live_conversation_segments WHERE enrollment_id=? AND EXISTS(SELECT 1 FROM memory_live_enrollments WHERE enrollment_id=? AND revision=?)").bind(snapshot.enrollment_id,snapshot.enrollment_id,snapshot.revision)]:[]),
    db.prepare(`UPDATE memory_live_enrollments SET learn_enabled=0,recall_enabled=0,background_enabled=0,revision=revision+1,
      lease_token=NULL,lease_expires_at=NULL,cutoff_sequence=NULL,failure_code=?,next_due_at='9999-12-31T00:00:00.000Z' WHERE enrollment_id=? AND revision=?`).bind(code,snapshot.enrollment_id,snapshot.revision)];
  const updateIndex=statements.length-1;
  statements.push(...structuredWrites.terminalAssertions,exact(terminal));
  try {
    const results=structuredClone(await db.batch<StructuredLedgerRow>(statements));
    const structuredOffset=1+originWrites.length+profileWrites.length;
    const assertions=[0,...structuredWrites.assertionIndexes.map(index=>structuredOffset+index),
      ...structuredWrites.terminalAssertions.map((_,index)=>updateIndex+1+index),statements.length-1];
    const erased=results[withdrawalWrites.length+1]?.meta?.changes;
    if (env.DB!==db||canonicalConsent(e)!==key||!structuredResults(results,statements.length)||!structuredAsserted(results,assertions,"verified")
      || results[updateIndex]?.meta?.changes!==1||typeof erased!=="number"||!Number.isSafeInteger(erased)||erased<0
      || !structuredWrites.acknowledge(results.slice(structuredOffset,structuredOffset+structuredWrites.statements.length)))
      throw new Error("memory-structured-withdrawal-unconfirmed");
    return {revoked:true,erased,structuredPendingRevisions:structuredWrites.pendingRevisions,structuredPendingOrigins:structuredWrites.pendingOrigins};
  } catch(error) {throw new Error("memory-structured-withdrawal-unconfirmed",{cause:error});}
}

/** Retire only one freshly certified denial in the caller's current attempt.
 * The complete original enrollment admits this batch; its exact terminal row
 * and the original native denial are proved after ALL writes. A canonical
 * terminal enrollment may clean residual data without incrementing revision.
 * This does not change legacy explicit revocation/expiry/disabled semantics. */
export async function retireDeniedLiveMemoryCounted(env:WorkerEnv,e:LiveMemoryEnrollment,
  attempt:LiveMemoryMaintenanceAttempt,certificate:LiveMemoryDenialCertificate):Promise<{retired:true;erased:number}> {
  memoryAssert(liveMemoryMaintenanceAttemptFor(env,attempt),"memory-maintenance-unavailable");
  const db=env.DB,snapshot={...e},key=JSON.stringify(snapshot),now=new Date().toISOString();
  const names=["memory_live_enrollments","memory_live_sources","memory_live_conversation_segments",
    "memory_native_answer_origins","memory_native_answer_dependencies","memory_document_profile_grants","memory_document_profile_suppressions"];
  const placeholders=names.map(()=>"?").join(",");
  // Explicit successful schema evidence, including absent optional tables. A
  // failed/partial projection cannot silently become an empty cleanup path.
  const schema=await db.prepare(`SELECT type,name,sql FROM sqlite_schema WHERE name IN(${placeholders}) ORDER BY name`)
    .bind(...names).all<{type:string;name:string;sql:string}>();
  if(!schema||Array.isArray(schema)||schema.success!==true||"error" in schema&&schema.error!==undefined
    ||!Array.isArray(schema.results)||schema.results.length>names.length
    ||!schema.results.every(row=>row&&typeof row==="object"&&!Array.isArray(row)
      &&Object.keys(row).length===3&&row.type==="table"&&names.includes(row.name)&&typeof row.sql==="string"&&row.sql.length>0)
    ||new Set(schema.results.map(row=>row.name)).size!==schema.results.length)throw new Error("memory-retirement-schema-unavailable");
  const tables=new Set(schema.results.map(row=>row.name));
  memoryAssert(tables.has("memory_live_enrollments")&&tables.has("memory_live_sources")
    &&tables.has("memory_native_answer_origins")===tables.has("memory_native_answer_dependencies"),"memory-retirement-schema-unavailable");
  const schemaGuard:MemorySqlGuard={condition:`(SELECT COUNT(*) FROM sqlite_schema WHERE name IN(${placeholders}))=?`
    +schema.results.map(()=>" AND EXISTS(SELECT 1 FROM sqlite_schema WHERE (type,name,sql) IS (?,?,?))").join(""),
    bindings:[...names,schema.results.length,...schema.results.flatMap(row=>[row.type,row.name,row.sql])]};
  // This supported enrollment-wide selector has no old-revision guard to become
  // vacuous after our own UPDATE. The certificate's full original-row proof is
  // first in the batch. Reuse the SAME captured final origin assertion at end.
  const originWrites:D1PreparedStatement[]=[];
  if(tables.has("memory_native_answer_origins")){
    const originPlan=prepareNativeMemoryOriginWithdrawal({enrollmentId:snapshot.enrollment_id},"access-withdrawn",now);
    if(!originPlan)throw new Error("memory-retirement-origin-invalid");
    const captured=await db.prepare(originPlan.targets.sql).bind(...originPlan.targets.bindings).all<NativeMemoryOriginHeader>();
    if(!captured||Array.isArray(captured)||captured.success!==true||"error" in captured&&captured.error!==undefined
      ||!Array.isArray(captured.results))throw new Error("memory-retirement-origin-unavailable");
    const queries=originPlan.statements(captured.results);
    if(!queries||queries.length!==7)throw new Error("memory-retirement-origin-invalid");
    originWrites.push(...queries.map(query=>db.prepare(query.sql).bind(...query.bindings)));
  }
  const grantColumns=["grant_id","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id",
    "permission_epoch","policy_version","recipe_version","revision","enrollment_id","enrollment_revision","infer_enabled","inspect_enabled",
    "background_enabled","source_after_sequence","consented_at","expires_at","retention_days","revoked_at"] as const;
  let originalProfiles:D1PreparedStatement|null=null,terminalProfiles:D1PreparedStatement|null=null;
  if(tables.has("memory_document_profile_grants")){
    // Complete, uncapped metadata capture. Scope-only NOT EXISTS would become
    // vacuous if a later write deleted a grant or changed its first tombstone.
    const captured=await db.prepare(`SELECT ${grantColumns.join(",")} FROM memory_document_profile_grants WHERE enrollment_id=? ORDER BY grant_id`)
      .bind(snapshot.enrollment_id).all<Record<string,unknown>>();
    const instant=(value:unknown):value is string=>typeof value==="string"&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
    if(!captured||Array.isArray(captured)||captured.success!==true||"error" in captured&&captured.error!==undefined
      ||!Array.isArray(captured.results)||!captured.results.every(row=>row&&typeof row==="object"&&!Array.isArray(row)
        &&Object.keys(row).length===grantColumns.length&&grantColumns.every(column=>Object.prototype.hasOwnProperty.call(row,column))
        &&Object.values(row).every(value=>value===null||typeof value==="string"||typeof value==="number"&&Number.isSafeInteger(value))
        &&typeof row.grant_id==="string"&&row.grant_id.length>0&&row.enrollment_id===snapshot.enrollment_id
        &&typeof row.revision==="number"&&Number.isSafeInteger(row.revision)&&row.revision>0
        &&(row.revoked_at===null?row.revision<Number.MAX_SAFE_INTEGER:instant(row.revoked_at))&&instant(row.expires_at)
        &&[row.infer_enabled,row.inspect_enabled,row.background_enabled].every(value=>value===0||value===1))
      ||new Set(captured.results.map(row=>row.grant_id)).size!==captured.results.length)throw new Error("memory-retirement-profile-unavailable");
    const rows=captured.results.map(row=>({...row}));
    const profileAssertion=(expected:readonly Record<string,unknown>[])=>db.prepare(`WITH expected AS (
      SELECT ${grantColumns.map(column=>`json_extract(value,'$.${column}') AS ${column}`).join(",")} FROM json_each(?))
      SELECT CASE WHEN NOT EXISTS(SELECT grant_id FROM memory_document_profile_grants WHERE enrollment_id=? EXCEPT SELECT grant_id FROM expected)
        AND NOT EXISTS(SELECT 1 FROM expected LEFT JOIN memory_document_profile_grants actual ON actual.grant_id=expected.grant_id
          WHERE actual.grant_id IS NULL OR NOT ((${grantColumns.map(column=>`actual.${column}`).join(",")})
            IS (${grantColumns.map(column=>`expected.${column}`).join(",")})))
        THEN 1 ELSE json('memory_retirement_profile_changed') END AS verified`).bind(JSON.stringify(expected),snapshot.enrollment_id);
    originalProfiles=profileAssertion(rows);
    terminalProfiles=profileAssertion(rows.map(row=>({...row,infer_enabled:0,inspect_enabled:0,background_enabled:0,
      revision:Number(row.revision)+(row.revoked_at===null?1:0),revoked_at:row.revoked_at??now,
      expires_at:String(row.expires_at)<now?row.expires_at:now})));
  }
  const profileWrites=await documentProfileWithdrawalStatements(env,{enrollmentId:snapshot.enrollment_id},now);
  const checkpoint=await prepareLiveMemoryCheckpointWithdrawal(env,{enrollmentId:snapshot.enrollment_id});
  const structuredWrites=await prepareStructuredConversationWithdrawal(env,{enrollment:snapshot},now);
  // Fixed enrollment-wide contract of the unchanged profile helper: exact
  // length and SELECT receipt offsets, never inspection of opaque SQL. A future
  // helper-shape change fails closed until this adapter is reviewed with it.
  const profileContract=tables.has("memory_document_profile_grants")
    ?tables.has("memory_document_profile_suppressions")?{length:6,assertions:[0,3,4,5]}:{length:4,assertions:[0,2,3]}
    :tables.has("memory_document_profile_suppressions")?{length:3,assertions:[0,1,2]}:{length:2,assertions:[0,1]};
  memoryAssert(profileWrites.length===profileContract.length,"memory-retirement-profile-contract-changed");
  // All asynchronous preparation precedes the certificate's last freshness and
  // DB/configuration/full-input check. Nothing below awaits before the one batch.
  memoryAssert(env.DB===db&&JSON.stringify(e)===key,"memory-retirement-preparation-changed");
  const proof=attempt.denialRetirementStatements(e,certificate),terminal=proof.terminal;
  const writes:D1PreparedStatement[]=[],assertions:number[]=[];
  const asserted=(statement:D1PreparedStatement)=>{assertions.push(writes.length);writes.push(statement);};
  proof.beforeMutation.forEach(asserted);
  asserted(memorySqlAssertion(env,schemaGuard));
  assertions.push(...checkpoint.assertionIndexes.map(index=>writes.length+index));
  writes.push(...checkpoint.statements);
  const originOffset=writes.length;
  writes.push(...originWrites);
  if(originWrites.length)assertions.push(...[0,2,4,6].map(index=>originOffset+index));
  if(originalProfiles)asserted(originalProfiles);
  const profileOffset=writes.length;
  writes.push(...profileWrites);
  assertions.push(...profileContract.assertions.map(index=>profileOffset+index));
  if(terminalProfiles)asserted(terminalProfiles);
  const structuredOffset=writes.length;
  writes.push(...structuredWrites.statements);
  assertions.push(...structuredWrites.assertionIndexes.map(index=>structuredOffset+index));
  writes.push(db.prepare("DELETE FROM memory_live_sources WHERE enrollment_id=?").bind(snapshot.enrollment_id));
  const countIndex=writes.length;
  writes.push(db.prepare("SELECT changes() AS erased"));
  if(tables.has("memory_live_conversation_segments"))writes.push(db.prepare("DELETE FROM memory_live_conversation_segments WHERE enrollment_id=?").bind(snapshot.enrollment_id));
  // Canonical terminal no-op leaves the enrollment byte-for-byte untouched.
  // Noncanonical all-off state is normalized once, not assumed already retired.
  if(terminal.revision!==snapshot.revision)writes.push(db.prepare(`UPDATE memory_live_enrollments SET
    learn_enabled=?,recall_enabled=?,background_enabled=?,revision=?,lease_token=?,lease_expires_at=?,cutoff_sequence=?,failure_code=?,next_due_at=?
    WHERE enrollment_id=? AND revision=?`).bind(terminal.learn_enabled,terminal.recall_enabled,terminal.background_enabled,terminal.revision,
      terminal.lease_token,terminal.lease_expires_at,terminal.cutoff_sequence,terminal.failure_code,terminal.next_due_at,snapshot.enrollment_id,snapshot.revision));
  asserted(memorySqlAssertion(env,schemaGuard));
  if(originWrites.length)asserted(originWrites[originWrites.length-1]!);
  if(terminalProfiles)asserted(terminalProfiles);
  asserted(memorySqlAssertion(env,{condition:"NOT EXISTS(SELECT 1 FROM memory_live_sources WHERE enrollment_id=?)",bindings:[snapshot.enrollment_id]}));
  if(tables.has("memory_live_conversation_segments"))asserted(memorySqlAssertion(env,
    {condition:"NOT EXISTS(SELECT 1 FROM memory_live_conversation_segments WHERE enrollment_id=?)",bindings:[snapshot.enrollment_id]}));
  if(tables.has("memory_document_profile_grants")){
    asserted(memorySqlAssertion(env,{condition:`NOT EXISTS(SELECT 1 FROM memory_document_profile_grants WHERE enrollment_id=?
      AND (revoked_at IS NULL OR infer_enabled<>0 OR inspect_enabled<>0 OR background_enabled<>0 OR expires_at>?))`,bindings:[snapshot.enrollment_id,now]}));
    if(tables.has("memory_document_profile_suppressions"))asserted(memorySqlAssertion(env,
      {condition:`NOT EXISTS(SELECT 1 FROM memory_document_profile_suppressions WHERE grant_id IN(
        SELECT grant_id FROM memory_document_profile_grants WHERE enrollment_id=?))`,bindings:[snapshot.enrollment_id]}));
  }else if(tables.has("memory_document_profile_suppressions")){
    // Without grants, scope cannot be reconstructed. The existing inverse admits
    // only empty orphan storage; require it still empty after all later writes.
    asserted(memorySqlAssertion(env,{condition:"NOT EXISTS(SELECT 1 FROM memory_document_profile_suppressions)",bindings:[]}));
  }
  structuredWrites.terminalAssertions.forEach(asserted);
  asserted(checkpoint.terminal);
  // Exact terminal enrollment first, then the same native-only denial witness
  // and its deadline last. Never replay the original enrollment after mutation.
  proof.afterRetirement.forEach(asserted);
  const results=await db.batch<Record<string,unknown>>(writes);
  // SQL failures above roll back. A malformed postcommit envelope is instead an
  // unconfirmed outcome: do not claim rollback or return guessed erased counts.
  memoryAssert(Array.isArray(results)&&results.length===writes.length&&results.every(result=>result&&!Array.isArray(result)
    &&result.success===true&&!("error" in result&&result.error!==undefined)&&Array.isArray(result.results)),"memory-retirement-unconfirmed");
  memoryAssert(assertions.every(index=>results[index]?.results.length===1&&Object.keys(results[index]!.results[0]??{}).length===1
    &&Object.entries(results[index]!.results[0]??{}).every(([name,value])=>["verified","context_source_asserted","memory_retirement_asserted"].includes(name)&&value===1)),
  "memory-retirement-unconfirmed");
  memoryAssert(env.DB===db&&JSON.stringify(e)===key
    &&structuredWrites.acknowledge(results.slice(structuredOffset,structuredOffset+structuredWrites.statements.length)),"memory-retirement-unconfirmed");
  const count=results[countIndex]?.results;
  memoryAssert(count?.length===1&&Object.keys(count[0]??{}).length===1&&typeof count[0]?.erased==="number"
    &&Number.isSafeInteger(count[0].erased)&&Number(count[0].erased)>=0,"memory-retirement-unconfirmed");
  return {retired:true,erased:Number(count![0]!.erased)};
}

export async function readLiveMemory(env:WorkerEnv,e:LiveMemoryEnrollment) {
  memoryAssert(liveMemoryEnabled(env,e.actor_user_id),"memory-disabled");
  const a=await liveMemoryAuthority(env,e);memoryAssert(a,"memory-access-changed");
  const originTablePresent=Boolean(await env.DB.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins'").first());
  const q=liveMemorySourceQuery(e,a!),enrollmentGuard=liveMemoryEnrollmentGuard(e,"recall");
  const guards=[a!.guard,{condition:`(${enrollmentGuard.condition}) AND
    (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins')=?`,
    bindings:[...enrollmentGuard.bindings,originTablePresent?1:0]}];
  // One transaction: authorization checks surround the source/body selection. Prose is never persisted again.
  const results=await env.DB.batch<LiveSourceRow|{verified:number}>([
    ...guards.map(g=>memoryGuardQuery(env.DB,g)),
    env.DB.prepare(`SELECT event.event_id,event.sequence,event.type,event.recorded_at,json_extract(event.payload,'$.block_id') AS block_id,
      turn.turn_id,substr(authored.content,1,512) AS user_text,substr(answer.content,1,512) AS assistant_text
      ${q.joins} JOIN memory_live_sources remembered ON remembered.event_id=event.event_id AND remembered.enrollment_id=?
      WHERE ${q.condition} AND remembered.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND ${nativeMemoryOriginSourceExclusion(originTablePresent)}
      ORDER BY event.sequence DESC LIMIT 64`).bind(...q.bindings.slice(0,6),e.enrollment_id,...q.bindings.slice(6)),
    ...guards.map(g=>memoryGuardQuery(env.DB,g)),
  ]);
  memoryAssert(results.every(result=>result.success)&&[0,1,3,4].every(index=>(results[index].results[0] as {verified:number})?.verified===1),"memory-access-changed");
  return liveMemoryView((results[2].results as LiveSourceRow[]).reverse(),e);
}

import { memoryDigest } from "../src/model/scoped-memory.ts";
import { canonicalConsent, executionAdmissionGuard, executionContentCustodyGuard } from "./consequential-consent.ts";
import { AssistantContextReadWitness, copyAssistantStructuredOwnSendFootprint, type AssistantStructuredOwnSendFootprint } from "./assistant-context-source.ts";
import { preparePrivateContent, privateContentScopeGuard, configuredPilotAdmissionGuard, type PilotUser } from "./pilot-policy.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { nativeMemoryDescriptor, nativeMemoryGrantDeadline, nativeMemoryTimestamp, nativeMemoryPilotQuery, nativeMemoryPilotDeadline } from "./memory-native-deadlines.ts";
import { nativeMemoryEnrollmentQuery, type NativeMemoryPreparedDocument } from "./memory-live-context.ts";
import { LIVE_MEMORY_POLICY } from "./memory-live-authority.ts";
import { prepareLegacyConversationOriginalsCommit, captureLegacyConversationOriginals, legacyConversationOriginalsEvidence,
  prepareLegacyConversationOriginalsOwnSend, legacyConversationOriginalsOwnSendStatements,
  type LegacyConversationOriginalsOwnSend, type LegacyConversationOriginalInterval,
  type LegacyConversationOriginalPrepared, type LegacyConversationOriginalCapture,
  type LegacyConversationOriginalReceipt, type LegacyConversationOriginalsCommit } from "./events-api.ts";

type StructuredLedgerRow = Record<string, unknown>;
export type StructuredConversationOriginal = Pick<LegacyConversationOriginalReceipt["originals"][number],
  "eventId" | "sequence" | "turnId" | "role" | "contentRef" | "contentHash">;
export type StructuredConversationDeclaration = {
  itemId: string; revision: number; category: "goal" | "decision" | "proposal" | "rejected-alternative" | "question" | "blocker" | "next-step";
  operation: "assert" | "correct" | "supersede" | "withdraw"; predecessor: { itemId: string; revision: number } | null;
  source: StructuredConversationOriginal; start: number; end: number; text: string;
};
export type StructuredConversationLedger = { schemaVersion: 1; recipeVersion: "native-declared-ledger-v1"; semanticCompleteness: false;
  annotations: StructuredConversationDeclaration[]; originals: StructuredConversationOriginal[] };
export type StructuredConversationLedgerRead = { readonly status: "initial" | "active"; readonly ledgerId: string; readonly revision: number;
  readonly ledger: StructuredConversationLedger; readonly validUntil: string; readonly expiresAt: string | null };
const structuredHeads = "memory_structured_conversation_heads", structuredRevisions = "memory_structured_conversation_revisions";
const structuredKind = "memory-structured-ledger", structuredRecipe = "native-declared-ledger-v1";
const structuredSchemaHash = "4eac78f116b620e9fc22949faf7d4e3a5abfe8fab083e1c2827bd6091cae2a79";
// Explicit candidate migration; absence preserves the original annotation-only contract.
const structuredCaptureSchemaHash = "075a857266dad2a438313faf7641ddae71aa96ebdaed8c0a6e1af373de2e09e8";
const structuredHeadColumns = ["ledger_id","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id",
  "enrollment_id","enrollment_revision","permission_epoch","policy_version","storage_revision","current_body_ref","current_body_hash","annotation_count",
  "coverage_after_sequence","coverage_through_sequence","state","first_terminal_at","cleanup_turn","expires_at","created_at","updated_at"];
const structuredRevisionColumns = ["ledger_id","revision","predecessor_revision","predecessor_hash","body_ref","body_hash","schema_version","recipe_version",
  "annotation_count","coverage_after_sequence","coverage_through_sequence","created_at","expires_at"];
const structuredEnrollmentColumns = ["enrollment_id","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id",
  "permission_epoch","policy_version","revision","learn_enabled","recall_enabled","background_enabled","retention_days","time_zone","enrolled_at","expires_at",
  "cursor_sequence","cutoff_sequence","last_local_day","last_admitted_at","next_due_at","lease_token","lease_expires_at","attempts","failure_code"];
const structuredBodyColumns = ["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"];
const structuredResourceColumns = ["project_access_id","resource_kind","resource_id","organization_id","project_id","owner_user_id","visibility","source_event_id","actor_user_id","created_at"];
const structuredRetentionColumns = ["content_id","organization_id","project_access_id","project_id","actor_user_id","classification","policy_version","assigned_expires_at","created_at"];
const structuredSchemaExpression = `(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql))
  FROM(SELECT type,name,tbl_name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END AS sql FROM sqlite_schema
    WHERE tbl_name IN('${structuredHeads}','${structuredRevisions}') ORDER BY name LIMIT 12))`;
const structuredBytes = (value: unknown) => new TextEncoder().encode(canonicalConsent(value)).byteLength;
const structuredObject = (value: unknown): value is StructuredLedgerRow => Boolean(value && typeof value === "object" && !Array.isArray(value));
const structuredKeys = (value: unknown, keys: readonly string[]): value is StructuredLedgerRow => structuredObject(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const structuredId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240 && value.isWellFormed();
const structuredHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const structuredJsonRow = (alias: string, columns: readonly string[]) => "json_object(" + columns.map(column => `'${column}',${alias}.${column}`).join(",") + ")";
const structuredFreeze = <T>(value: T): T => { if (value && typeof value === "object") { for (const child of Object.values(value)) structuredFreeze(child); Object.freeze(value); } return value; };
const structuredSettings = (env: WorkerEnv) => canonicalConsent([env.FORMA_MEMORY_ENABLED,env.FORMA_MEMORY_USER_IDS,
  env.FORMA_MEMORY_SCHEDULING_ENABLED,env.FORMA_PILOT_COHORT_ID,env.FORMA_ADMIN_EMAILS]);
const structuredScope = (e: LiveMemoryEnrollment) => [e.actor_user_id,e.owner_user_id,e.organization_id,e.project_access_id,e.project_id,e.document_id];
const structuredScopeWhere = "(actor_user_id,owner_user_id,organization_id,project_access_id,project_id,document_id) IS (?,?,?,?,?,?)";
const structuredRef = (value: LegacyConversationOriginalReceipt["originals"][number]): StructuredConversationOriginal => ({eventId:value.eventId,sequence:value.sequence,
  turnId:value.turnId,role:value.role,contentRef:value.contentRef,contentHash:value.contentHash});
function structuredResults(results: D1Result<StructuredLedgerRow>[], count: number): boolean {
  return Array.isArray(results) && results.length === count && Array.from(results).every(result => structuredObject(result)
    && Object.hasOwn(result,"success") && result.success === true && result.error === undefined
    && Object.hasOwn(result,"results") && Array.isArray(result.results));
}
function structuredAsserted(results: D1Result<StructuredLedgerRow>[], indexes: readonly number[], column="context_source_asserted"): boolean {
  return indexes.every(index => results[index]?.results.length === 1 && structuredObject(results[index].results[0])
    && Object.keys(results[index].results[0]).length === 1
    && Object.keys(results[index].results[0])[0] === column && Object.values(results[index].results[0])[0] === 1);
}
async function structuredSchemaValue(value: unknown): Promise<boolean> {
  if (typeof value !== "string" || value.length > 20_000) throw new Error("memory-structured-schema-unavailable");
  const rows: unknown = JSON.parse(value);
  if (!Array.isArray(rows) || rows.length !== 0 && (rows.length !== 11
    || ![structuredSchemaHash,structuredCaptureSchemaHash].includes(await memoryDigest(canonicalConsent(rows)))))
    throw new Error("memory-structured-schema-unavailable");
  return rows.length === 11;
}
/** Exact normal 0032 or reviewed reference-capture candidate; absence is witnessed, never installed.
 * This helper is metadata-only and grants no ledger/body access. */
export async function structuredConversationLedgerSchema(env: WorkerEnv): Promise<{present:boolean;referenceCapture:boolean;guard:MemorySqlGuard}> {
  const db=env.DB, result=structuredClone(await db.prepare(`SELECT ${structuredSchemaExpression} AS schema_json`).all<StructuredLedgerRow>());
  if (!structuredResults([result],1) || result.results.length !== 1) throw new Error("memory-structured-schema-unavailable");
  const value=result.results[0].schema_json, present=await structuredSchemaValue(value);
  if (env.DB!==db) throw new Error("memory-structured-preparation-changed");
  const referenceCapture=present&&await memoryDigest(canonicalConsent(JSON.parse(String(value))))===structuredCaptureSchemaHash;
  if (env.DB!==db) throw new Error("memory-structured-preparation-changed");
  return {present,referenceCapture,guard:{condition:`${structuredSchemaExpression} IS ?`,bindings:[String(value)]}};
}
function structuredLedgerValue(input: unknown, originals: readonly LegacyConversationOriginalReceipt["originals"][number][]): StructuredConversationLedger | null {
  if (!structuredKeys(input,["schemaVersion","recipeVersion","semanticCompleteness","annotations","originals"])
    || input.schemaVersion!==1 || input.recipeVersion!==structuredRecipe || input.semanticCompleteness!==false
    || !Array.isArray(input.annotations) || input.annotations.length>256 || !Array.isArray(input.originals) || input.originals.length>128) return null;
  const refs:StructuredConversationOriginal[]=[], seen=new Set<string>(), native=new Map(originals.map(row=>[row.eventId,row]));
  for (const ref of input.originals) {
    if (!structuredKeys(ref,["eventId","sequence","turnId","role","contentRef","contentHash"]) || !structuredId(ref.eventId)
      || seen.has(ref.eventId) || !native.has(ref.eventId) || canonicalConsent(ref)!==canonicalConsent(structuredRef(native.get(ref.eventId)!))) return null;
    seen.add(ref.eventId);refs.push(structuredRef(native.get(ref.eventId)!));
  }
  refs.sort((a,b)=>a.sequence-b.sequence||a.eventId.localeCompare(b.eventId));
  const annotations:StructuredConversationDeclaration[]=[], heads=new Map<string,StructuredConversationDeclaration>();
  const categories=["goal","decision","proposal","rejected-alternative","question","blocker","next-step"];
  for (const value of input.annotations) {
    if (!structuredKeys(value,["itemId","revision","category","operation","predecessor","source","start","end","text"])
      || !structuredId(value.itemId) || typeof value.revision!=="number" || !Number.isSafeInteger(value.revision) || value.revision<1
      || typeof value.category!=="string" || !categories.includes(value.category)
      || typeof value.operation!=="string" || !["assert","correct","supersede","withdraw"].includes(value.operation)
      || !structuredKeys(value.source,["eventId","sequence","turnId","role","contentRef","contentHash"])
      || typeof value.source.eventId!=="string" || !seen.has(value.source.eventId)
      || canonicalConsent(value.source)!==canonicalConsent(structuredRef(native.get(value.source.eventId)!))
      || value.category==="decision" && value.source.role!=="user"
      || typeof value.start!=="number" || !Number.isSafeInteger(value.start) || value.start<0
      || typeof value.end!=="number" || !Number.isSafeInteger(value.end) || value.end<=value.start
      || typeof value.text!=="string" || !value.text.isWellFormed() || value.text.length>16_384) return null;
    const source=native.get(value.source.eventId)!, quote=Array.from(source.text);
    if (value.end>quote.length || quote.slice(value.start,value.end).join("")!==value.text) return null;
    const previous=heads.get(value.itemId);
    if (!previous) { if (value.operation!=="assert" || value.revision!==1 || value.predecessor!==null) return null; }
    else {
      if (value.operation==="assert" || value.revision!==previous.revision+1
        || !structuredKeys(value.predecessor,["itemId","revision"]) || value.predecessor.itemId!==previous.itemId || value.predecessor.revision!==previous.revision
        || value.category!==previous.category || source.role!==previous.source.role || source.sequence<previous.source.sequence
        || source.sequence===previous.source.sequence && value.start<previous.end) return null;
    }
    const annotation:StructuredConversationDeclaration={itemId:value.itemId,revision:value.revision,category:value.category as StructuredConversationDeclaration["category"],
      operation:value.operation as StructuredConversationDeclaration["operation"],predecessor:previous?{itemId:previous.itemId,revision:previous.revision}:null,
      source:structuredRef(source),start:value.start,end:value.end,text:value.text};
    annotations.push(annotation);heads.set(annotation.itemId,annotation);
  }
  const result:StructuredConversationLedger={schemaVersion:1,recipeVersion:structuredRecipe,semanticCompleteness:false,annotations,originals:refs};
  return structuredBytes(result)<=131_072?result:null;
}
function structuredExtends(before: StructuredConversationLedger, after: StructuredConversationLedger, referenceCapture=false): boolean {
  return (after.annotations.length>before.annotations.length
      || referenceCapture&&after.annotations.length===before.annotations.length&&after.originals.length>before.originals.length)
    && canonicalConsent(after.annotations.slice(0,before.annotations.length))===canonicalConsent(before.annotations)
    && before.originals.every(ref=>after.originals.some(next=>canonicalConsent(ref)===canonicalConsent(next)));
}
function structuredHistoryQuery(e: LiveMemoryEnrollment, ledgerId: string, binding: LegacyConversationOriginalPrepared["binding"]) {
  const scope=e.organization_id&&e.project_access_id?{organizationId:e.organization_id,projectAccessId:e.project_access_id,projectId:e.project_id,ownerUserId:e.owner_user_id,actorUserId:e.actor_user_id}:undefined;
  // Native memory uses current read authority, not authority to make a new purchase.
  // The complete history validator below still requires the exact retained sidecars.
  const custody=scope?executionContentCustodyGuard(binding):privateContentScopeGuard(e.actor_user_id);
  const retained=scope?` AND EXISTS(SELECT 1 FROM private_content_retention_scopes retention
    WHERE (retention.content_id,retention.organization_id,retention.project_access_id,retention.project_id,retention.actor_user_id,
      retention.classification,retention.created_at)=(private_content.content_id,?,?,?,?,'transient-private',private_content.created_at)
      AND typeof(retention.policy_version)='integer' AND retention.policy_version BETWEEN 0 AND 9007199254740991)`:"";
  const body="json_object("+structuredBodyColumns.map(key=>`'${key}',${key==="content"?"CASE WHEN length(CAST(private_content.content AS BLOB))<=131072 THEN private_content.content ELSE NULL END":`private_content.${key}`}`).join(",")+")";
  const revision=structuredJsonRow("revision",structuredRevisionColumns);
  const resources=`(SELECT json_group_array(json(${structuredJsonRow("resource",structuredResourceColumns)})) FROM(SELECT * FROM project_resource_scopes
    WHERE resource_kind='content' AND resource_id=revision.body_ref ORDER BY project_access_id LIMIT 2) resource)`;
  const retention=`(SELECT json_group_array(json(${structuredJsonRow("retention",structuredRetentionColumns)})) FROM(SELECT * FROM private_content_retention_scopes WHERE content_id=revision.body_ref LIMIT 2) retention)`;
  return nativeMemoryDescriptor(`WITH selected_heads AS(SELECT * FROM ${structuredHeads} WHERE ledger_id=? OR ${structuredScopeWhere}),
    selected_revisions AS(SELECT * FROM ${structuredRevisions} WHERE ledger_id=? OR ledger_id IN(SELECT ledger_id FROM selected_heads) ORDER BY revision LIMIT 65),
    history AS(SELECT json_group_array(json_object('revision',json(${revision}),'body',CASE WHEN private_content.content_id IS NULL THEN NULL ELSE json(${body}) END,
      'resources',json(${resources}),'retentions',json(${retention}))) AS value FROM selected_revisions revision
      LEFT JOIN private_content ON private_content.content_id=revision.body_ref AND private_content.owner_id=? AND private_content.kind='${structuredKind}' AND (${custody.sql})${retained})
    SELECT (SELECT json_group_array(json(${structuredJsonRow("head",structuredHeadColumns)})) FROM selected_heads head) AS heads_json,
      CASE WHEN length(CAST(history.value AS BLOB))<=1048576 THEN history.value ELSE NULL END AS history_json,
      CASE WHEN NOT EXISTS(SELECT 1 FROM selected_revisions revision LEFT JOIN private_content ON private_content.content_id=revision.body_ref
        WHERE revision.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR private_content.content_id IS NULL OR private_content.redacted_at IS NOT NULL
          OR private_content.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR EXISTS(SELECT 1 FROM private_content_retention_scopes retention
            WHERE retention.content_id=revision.body_ref AND retention.assigned_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))
      AND NOT EXISTS(SELECT 1 FROM selected_revisions revision JOIN private_content ledger_body ON ledger_body.content_id=revision.body_ref
        AND ledger_body.owner_id=? AND ledger_body.kind='${structuredKind}' JOIN json_each(
          CASE WHEN length(CAST(ledger_body.content AS BLOB))<=131072 THEN CASE WHEN json_valid(ledger_body.content) THEN ledger_body.content ELSE '{}' END ELSE '{}' END,'$.originals') dependency
        JOIN events original ON original.event_id=json_extract(dependency.value,'$.eventId')
        WHERE original.recorded_at<? OR strftime('%Y-%m-%dT%H:%M:%fZ',original.recorded_at,'+'||?||' days')<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      THEN 1 ELSE 0 END AS alive FROM history`,
    [ledgerId,...structuredScope(e),ledgerId,e.actor_user_id,...custody.bindings,...(scope?[scope.organizationId,scope.projectAccessId,scope.projectId,e.actor_user_id]:[]),e.actor_user_id,e.enrolled_at,e.retention_days]);
}
type StructuredLedgerHistory = {head:StructuredLedgerRow|null;rows:StructuredLedgerRow[];ledger:StructuredConversationLedger;expiresAt:string|null};
type StructuredLedgerFrame = {env:WorkerEnv;enrollmentKey:string;preparedKey:string;settings:string;historyKey:string;read:StructuredConversationLedgerRead};
const structuredLedgerFrames=new WeakMap<StructuredConversationLedgerRead,StructuredLedgerFrame>();
async function structuredHistoryValue(row: StructuredLedgerRow, ledgerId:string, e:LiveMemoryEnrollment,
  originals:readonly LegacyConversationOriginalReceipt["originals"][number][], fresh:()=>boolean,referenceCapture=false):Promise<StructuredLedgerHistory|null> {
  if (row.alive!==1 || typeof row.heads_json!=="string" || typeof row.history_json!=="string") return null;
  const heads:unknown=JSON.parse(row.heads_json), rows:unknown=JSON.parse(row.history_json);
  if (!Array.isArray(heads) || heads.length>1 || !Array.isArray(rows) || rows.length>64 || structuredBytes(rows)>1_048_576) return null;
  const empty:StructuredConversationLedger={schemaVersion:1,recipeVersion:structuredRecipe,semanticCompleteness:false,annotations:[],originals:[]};
  if (!heads.length) return rows.length?null:{head:null,rows:[],ledger:empty,expiresAt:null};
  const head=heads[0];
  if (!structuredKeys(head,structuredHeadColumns) || head.ledger_id!==ledgerId || head.state!=="active" || head.first_terminal_at!==null
    || canonicalConsent([head.actor_user_id,head.owner_user_id,head.organization_id,head.project_access_id,head.project_id,head.document_id])!==canonicalConsent(structuredScope(e))
    || head.enrollment_id!==e.enrollment_id || head.enrollment_revision!==e.revision || head.permission_epoch!==e.permission_epoch || head.policy_version!==e.policy_version
    || head.storage_revision!==rows.length || !rows.length || !structuredHash(head.current_body_hash)
    || nativeMemoryTimestamp(head.created_at)===null || nativeMemoryTimestamp(head.updated_at)===null || nativeMemoryTimestamp(head.expires_at)===null) return null;
  let previous=empty, previousHash:string|null=null;
  const deadlines=[Date.parse(String(head.expires_at))];
  for (const [index, value] of rows.entries()) {
    if (!structuredKeys(value,["revision","body","resources","retentions"]) || !structuredKeys(value.revision,structuredRevisionColumns)
      || !structuredKeys(value.body,structuredBodyColumns) || !Array.isArray(value.resources) || !Array.isArray(value.retentions)) return null;
    const revision=value.revision, body=value.body;
    if (revision.ledger_id!==ledgerId || revision.revision!==index+1 || revision.predecessor_revision!==index || revision.predecessor_hash!==previousHash
      || revision.schema_version!==1 || revision.recipe_version!==structuredRecipe || !structuredHash(revision.body_hash)
      || body.content_id!==revision.body_ref || body.owner_id!==e.actor_user_id || body.kind!==structuredKind || body.redacted_at!==null
      || body.created_at!==revision.created_at || nativeMemoryTimestamp(revision.created_at)===null || nativeMemoryTimestamp(revision.expires_at)===null
      || nativeMemoryTimestamp(body.expires_at)===null || String(body.expires_at)>String(revision.expires_at)
      || typeof body.content!=="string" || body.content.length>131_072 || !body.content.isWellFormed() || new TextEncoder().encode(body.content).byteLength>131_072) return null;
    const ledger=structuredLedgerValue(JSON.parse(body.content),originals);
    if (!ledger || ledger.originals.some(ref=>Date.parse(originals.find(original=>original.eventId===ref.eventId)!.recordedAt)<Date.parse(e.enrolled_at))
      || canonicalConsent(ledger)!==body.content || !structuredExtends(previous,ledger,referenceCapture)
      || revision.annotation_count!==ledger.annotations.length || !ledger.originals.length
      || revision.coverage_after_sequence!==Math.min(...ledger.originals.map(ref=>ref.sequence))-1
      || revision.coverage_through_sequence!==Math.max(...ledger.originals.map(ref=>ref.sequence))) return null;
    for (const ref of ledger.originals) {
      const original=originals.find(value=>value.eventId===ref.eventId)!;
      deadlines.push(Date.parse(original.expiresAt),Date.parse(original.recordedAt)+e.retention_days*86_400_000);
    }
    const hash=await memoryDigest(body.content);
    if (!fresh() || hash!==revision.body_hash) return null;
    if (e.organization_id!==null) {
      if (value.resources.length!==1 || value.retentions.length!==1 || !structuredKeys(value.resources[0],structuredResourceColumns)
        || !structuredKeys(value.retentions[0],structuredRetentionColumns)) return null;
      const resource=value.resources[0], retention=value.retentions[0];
      if (resource.resource_id!==body.content_id || resource.resource_kind!=="content" || resource.project_access_id!==e.project_access_id
        || resource.organization_id!==e.organization_id || resource.project_id!==e.project_id || resource.owner_user_id!==e.owner_user_id
        || resource.actor_user_id!==e.actor_user_id || resource.visibility!=="actor_private" || resource.created_at!==body.created_at
        || retention.content_id!==body.content_id || retention.project_access_id!==e.project_access_id || retention.organization_id!==e.organization_id
        || retention.project_id!==e.project_id || retention.actor_user_id!==e.actor_user_id || retention.classification!=="transient-private"
        || typeof retention.policy_version!=="number" || !Number.isSafeInteger(retention.policy_version) || retention.policy_version<0
        || retention.created_at!==body.created_at || nativeMemoryTimestamp(retention.assigned_expires_at)===null
        || String(retention.assigned_expires_at)>String(revision.expires_at)) return null;
      deadlines.push(Date.parse(String(retention.assigned_expires_at)));
    } else if (value.resources.length || value.retentions.length) return null;
    deadlines.push(Date.parse(String(body.expires_at)),Date.parse(String(revision.expires_at)));
    previous=ledger;previousHash=hash;
  }
  const last=(rows.at(-1) as StructuredLedgerRow).revision as StructuredLedgerRow;
  if (head.current_body_ref!==last.body_ref || head.current_body_hash!==last.body_hash || head.annotation_count!==last.annotation_count
    || head.coverage_after_sequence!==last.coverage_after_sequence || head.coverage_through_sequence!==last.coverage_through_sequence
    || head.expires_at!==last.expires_at || Math.min(...deadlines)<=Date.now()) return null;
  return {head,rows:rows as StructuredLedgerRow[],ledger:previous,expiresAt:new Date(Math.min(...deadlines)).toISOString()};
}
type StructuredLedgerPreparation = {read:StructuredConversationLedgerRead;history:StructuredLedgerHistory;witness:AssistantContextReadWitness<null>;
  source:LegacyConversationOriginalsCommit;enrollment:LiveMemoryEnrollment;authority:NonNullable<Awaited<ReturnType<typeof liveMemoryAuthority>>>;
  enrollmentKey:string;preparedKey:string;settings:string;fresh:()=>boolean;historyQuery:ReturnType<typeof nativeMemoryDescriptor>;
  historyKey:string;schemaGuard:MemorySqlGuard;ledgerId:string;policy:StructuredLedgerRow|null;authorityBytes:number;referenceCapture:boolean};
async function structuredPrepare(env:WorkerEnv,enrollment:LiveMemoryEnrollment,prepared:LegacyConversationOriginalPrepared,
  captures:readonly LegacyConversationOriginalCapture[],learn:boolean):Promise<StructuredLedgerPreparation|null> {
  const e=structuredClone(enrollment), supplied=structuredClone(prepared), enrollmentKey=canonicalConsent(enrollment),preparedKey=canonicalConsent(prepared),settings=structuredSettings(env),db=env.DB;
  const started=Date.now();
  if (!structuredKeys(e,structuredEnrollmentColumns) || !liveMemoryEnabled(env,e.actor_user_id) || !Number.isSafeInteger(e.retention_days)
    || e.retention_days<1 || e.retention_days>365 || nativeMemoryTimestamp(e.expires_at)===null || nativeMemoryTimestamp(e.enrolled_at)===null) return null;
  const fresh=()=>env.DB===db&&canonicalConsent(enrollment)===enrollmentKey&&canonicalConsent(prepared)===preparedKey&&structuredSettings(env)===settings;
  const authority=await liveMemoryAuthority(env,e);
  if (!fresh() || !authority || supplied.principal.userId!==e.actor_user_id || supplied.binding.streamId!==`creative:${e.owner_user_id}`
    || supplied.binding.projectId!==e.project_id || supplied.binding.documentId!==e.document_id
    || canonicalConsent(supplied.binding.scope)!==canonicalConsent(authority.binding.scope)
    || supplied.principal.access.permissionEpoch!==e.permission_epoch) return null;
  const ledgerId=await memoryDigest(canonicalConsent(structuredScope(e)));
  if (!fresh()) return null;
  const recall=liveMemoryEnrollmentGuard(e,"recall"), learning=learn?liveMemoryEnrollmentGuard(e,"learn"):{condition:"1",bindings:[]};
  const q1=nativeMemoryDescriptor(`SELECT ${structuredSchemaExpression} AS schema_json,
    CASE WHEN (${authority.guard.condition}) AND (${recall.condition}) AND (${learning.condition}) THEN 1 ELSE 0 END AS allowed,
    (SELECT ${structuredJsonRow("enrollment",structuredEnrollmentColumns)} FROM memory_live_enrollments enrollment WHERE enrollment_id=?) AS enrollment_json,
    (SELECT json_object('organization_id',organization_id,'transient_days',transient_days,'evidence_days',evidence_days,'version',version,'legal_hold',legal_hold)
      FROM organization_retention_policies WHERE organization_id=?) AS policy_json`,
    [...authority.guard.bindings,...recall.bindings,...learning.bindings,e.enrollment_id,e.organization_id]);
  const first=structuredClone(await db.batch<StructuredLedgerRow>([db.prepare(q1.sql).bind(...q1.bindings)]));
  if (!fresh() || !structuredResults(first,1) || first[0].results.length!==1) return null;
  const initial=first[0].results[0];
  if (initial.allowed!==1 || typeof initial.enrollment_json!=="string" || canonicalConsent(JSON.parse(initial.enrollment_json))!==enrollmentKey
    || !await structuredSchemaValue(initial.schema_json) || !fresh()) return null;
  const q2=structuredHistoryQuery(e,ledgerId,authority.binding), second=structuredClone(await db.batch<StructuredLedgerRow>([db.prepare(q2.sql).bind(...q2.bindings)]));
  if (!fresh() || !structuredResults(second,1) || second[0].results.length!==1) return null;
  const witness=new AssistantContextReadWitness<null>(env), queries=[q1,q2],results=[first[0],second[0]];
  witness.observe(queries.map(query=>db.prepare(query.sql).bind(...query.bindings)),results,queries);
  // The two captured queries include all ledger authorization/schema/history reads.
  // SQL expiry in the captured history query closes its clock without a third witness row.
  witness.seal(null);
  const budget={statements:witness.statements().length,rows:results.reduce((n,result)=>n+result.results.length,0),
    bytes:results.reduce((n,result)=>n+result.results.reduce((sum,row)=>sum+structuredBytes(row),0),0)};
  if (budget.statements!==2) return null;
  const source=await prepareLegacyConversationOriginalsCommit(env,prepared,captures,budget);
  if (!source || !fresh() || canonicalConsent([source.scope.actorUserId,source.scope.ownerUserId,source.scope.organizationId,source.scope.projectAccessId,source.scope.projectId,source.scope.documentId])
    !==canonicalConsent(structuredScope(e))) return null;
  const referenceCapture=await memoryDigest(canonicalConsent(JSON.parse(String(initial.schema_json))))===structuredCaptureSchemaHash;
  const history=await structuredHistoryValue(second[0].results[0],ledgerId,e,source.originals,()=>fresh()&&source.isCurrent(),referenceCapture);
  if (!history || !fresh() || !source.isCurrent()) return null;
  const grant=nativeMemoryGrantDeadline(authority.principal,started);
  if (grant===undefined) return null;
  const validUntil=new Date(Math.min(Date.parse(source.validUntil),Date.parse(e.expires_at),history.expiresAt?Date.parse(history.expiresAt):Infinity,
    grant?Date.parse(grant):Infinity)).toISOString();
  if (Date.parse(validUntil)<=Date.now()) return null;
  const policy:unknown=initial.policy_json===null?null:typeof initial.policy_json==="string"?JSON.parse(initial.policy_json):undefined;
  if (policy!==null && (!structuredObject(policy) || policy.organization_id!==e.organization_id || typeof policy.version!=="number" || !Number.isSafeInteger(policy.version) || policy.version<0)) return null;
  const read=structuredFreeze<StructuredConversationLedgerRead>({status:history.head?"active":"initial",ledgerId,revision:history.rows.length,
    ledger:structuredClone(history.ledger),validUntil,expiresAt:history.expiresAt});
  return {read,history,witness,source,enrollment:e,authority,enrollmentKey,preparedKey,settings,
    fresh:()=>fresh()&&source.isCurrent()&&Date.now()<Date.parse(validUntil),historyQuery:q2,historyKey:canonicalConsent({head:history.head,rows:history.rows}),
    schemaGuard:{condition:`${structuredSchemaExpression} IS ?`,bindings:[String(initial.schema_json)]},ledgerId,policy:policy as StructuredLedgerRow|null,authorityBytes:structuredBytes(initial),referenceCapture};
}
/** Only native ledger append consumes these statements, within its issued source,
 * schema, exact policy/history and enrollment witnesses before every insertion.
 * Learning from authorized reads does not grant the actor paid execution rights. */
function structuredSharedPrivateContent(env:WorkerEnv,plan:StructuredLedgerPreparation,content:string,expiryCeiling:string) {
  const e=plan.enrollment,scope=plan.authority.binding.scope;
  if(!scope||scope.actorUserId!==e.actor_user_id||scope.ownerUserId!==e.owner_user_id
    ||scope.organizationId!==e.organization_id||scope.projectAccessId!==e.project_access_id||scope.projectId!==e.project_id)
    throw new Error("memory-structured-storage-scope-invalid");
  const ceiling=Date.parse(expiryCeiling);
  memoryAssert(Number.isSafeInteger(ceiling)&&new Date(ceiling).toISOString()===expiryCeiling&&ceiling>Date.now(),
    "private_content_expiry_ceiling_invalid");
  const contentId=uuidV7(),createdAt=new Date(),configuredDays=Number(env.FORMA_RETENTION_DAYS);
  // Match preparePrivateContent's transient policy calculation, including fallback
  // flooring, date-range rejection and the non-renewable original expiry ceiling.
  const fallbackDays=Number.isFinite(configuredDays)&&configuredDays>0?Math.floor(configuredDays):30;
  const days=Number(plan.policy?.transient_days??fallbackDays);
  const expiresAt=new Date(createdAt.getTime()+days*86_400_000);
  expiresAt.setTime(Math.min(expiresAt.getTime(),ceiling));
  const now=createdAt.toISOString(),expires=expiresAt.toISOString(),version=Number(plan.policy?.version??0);
  const learning=liveMemoryEnrollmentGuard(e,"learn"),recall=liveMemoryEnrollmentGuard(e,"recall"),authority=plan.authority.guard;
  const statements=[
    env.DB.prepare(`INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at)
      SELECT ?,?,?,?,?,?,NULL WHERE (${authority.condition}) AND (${learning.condition}) AND (${recall.condition})
        AND EXISTS(SELECT 1 FROM organization_projects WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=? AND status='active')
        AND ((?=0 AND NOT EXISTS(SELECT 1 FROM organization_retention_policies current_policy WHERE current_policy.organization_id=?))
          OR EXISTS(SELECT 1 FROM organization_retention_policies current_policy WHERE current_policy.organization_id=? AND current_policy.version=?))`)
      .bind(contentId,e.actor_user_id,structuredKind,content,now,expires,...authority.bindings,...learning.bindings,...recall.bindings,
        scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,version,scope.organizationId,scope.organizationId,version),
    env.DB.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at)
      SELECT ?,'content',?,?,?,?,'actor_private',NULL,?,? WHERE EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?)`)
      .bind(scope.projectAccessId,contentId,scope.organizationId,scope.projectId,scope.ownerUserId,e.actor_user_id,now,contentId,e.actor_user_id),
    env.DB.prepare(`INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.project_access_id=? AND resource.organization_id=?
        AND resource.project_id=? AND resource.resource_kind='content' AND resource.resource_id=? AND resource.actor_user_id=?)`)
      .bind(contentId,scope.organizationId,scope.projectAccessId,scope.projectId,e.actor_user_id,"transient-private",version,expires,now,
        scope.projectAccessId,scope.organizationId,scope.projectId,contentId,e.actor_user_id),
  ];
  return{contentId,createdAt:now,expiresAt:expires,statements,requiredInserts:3};
}
/** Native recall of the COMPLETE bounded declared ledger. The caller supplies current
 * issued original frames for every retained dependency; no prior-head/text fallback. */
export async function readStructuredConversationLedger(env:WorkerEnv,enrollment:LiveMemoryEnrollment,prepared:LegacyConversationOriginalPrepared,
  captures:readonly LegacyConversationOriginalCapture[]):Promise<StructuredConversationLedgerRead|null> {
  try {
    const plan=await structuredPrepare(env,enrollment,prepared,captures,false);
    if (!plan || !plan.fresh()) return null;
    const statements=[...plan.source.precommitStatements(),...plan.witness.precommitStatements(),...plan.source.precommitStatements()];
    const results=structuredClone(await env.DB.batch<StructuredLedgerRow>(statements));
    if (!plan.fresh() || !structuredResults(results,statements.length) || !structuredAsserted(results,statements.map((_,index)=>index))) return null;
    structuredLedgerFrames.set(plan.read,{env,enrollmentKey:plan.enrollmentKey,preparedKey:plan.preparedKey,settings:plan.settings,historyKey:plan.historyKey,read:plan.read});
    return plan.read;
  } catch { return null; }
}
function structuredStateAssertion(env:WorkerEnv,query:ReturnType<typeof nativeMemoryDescriptor>,head:StructuredLedgerRow|null,rows:StructuredLedgerRow[]) {
  const paths=[...structuredRevisionColumns.map(key=>`$.revision.${key}`),...structuredBodyColumns.map(key=>`$.body.${key}`),
    ...structuredResourceColumns.map(key=>`$.resources[0].${key}`),...structuredRetentionColumns.map(key=>`$.retentions[0].${key}`)];
  const equal=(keys:string[],a:string,b:string)=>`(${keys.map(key=>`json_extract(${a},'${key}')`).join(",")}) IS (${keys.map(key=>`json_extract(${b},'${key}')`).join(",")})`;
  return env.DB.prepare(`WITH actual AS(${query.sql}), expected_heads AS(SELECT value FROM json_each(?)),expected_rows AS(SELECT value FROM json_each(?))
    SELECT CASE WHEN actual.alive=1 AND json_array_length(actual.heads_json)=(SELECT COUNT(*) FROM expected_heads)
      AND json_array_length(actual.history_json)=(SELECT COUNT(*) FROM expected_rows)
      AND NOT EXISTS(SELECT 1 FROM json_each(actual.heads_json) observed LEFT JOIN expected_heads expected
        ON json_extract(observed.value,'$.ledger_id')=json_extract(expected.value,'$.ledger_id') WHERE expected.value IS NULL
        OR NOT(${equal(structuredHeadColumns.map(key=>`$.${key}`),"observed.value","expected.value")}))
      AND NOT EXISTS(SELECT 1 FROM json_each(actual.history_json) observed LEFT JOIN expected_rows expected
        ON json_extract(observed.value,'$.revision.revision')=json_extract(expected.value,'$.revision.revision') WHERE expected.value IS NULL
        OR NOT(${equal(paths,"observed.value","expected.value")})
        OR json_array_length(json_extract(observed.value,'$.resources'))!=json_array_length(json_extract(expected.value,'$.resources'))
        OR json_array_length(json_extract(observed.value,'$.retentions'))!=json_array_length(json_extract(expected.value,'$.retentions')))
      THEN 1 ELSE json('memory_structured_state_changed') END AS verified FROM actual`).bind(...query.bindings,JSON.stringify(head?[head]:[]),JSON.stringify(rows));
}
/** An append is a native learn+recall CAS, not acceptance of the declaration's meaning.
 * The issued expected read and complete current native originals are independent proofs.
 * No unchanged snapshots, implicit re-enrollment, pruning, retrospective learning or TTL renewal. */
export async function appendStructuredConversationLedger(env:WorkerEnv,enrollment:LiveMemoryEnrollment,prepared:LegacyConversationOriginalPrepared,
  captures:readonly LegacyConversationOriginalCapture[],expected:StructuredConversationLedgerRead,proposed:unknown):Promise<StructuredConversationLedgerRead|null> {
  let dispatched=false;
  try {
    const expectedFrame=structuredLedgerFrames.get(expected);
    if (!expectedFrame || expectedFrame.env!==env || expectedFrame.read!==expected || Date.now()>=Date.parse(expected.validUntil)
      || !structuredKeys(proposed,["schemaVersion","recipeVersion","semanticCompleteness","annotations","originals"])
      || !Array.isArray(proposed.annotations) || proposed.annotations.length>256 || !Array.isArray(proposed.originals) || proposed.originals.length>128) return null;
    const copy=structuredClone(proposed), proposedKey=canonicalConsent(copy);
    if (new TextEncoder().encode(proposedKey).byteLength>131_072) return null;
    const plan=await structuredPrepare(env,enrollment,prepared,captures,true);
    if (!plan || !plan.fresh() || canonicalConsent(proposed)!==proposedKey || expectedFrame.enrollmentKey!==plan.enrollmentKey
      || expectedFrame.preparedKey!==plan.preparedKey || expectedFrame.settings!==plan.settings || expectedFrame.historyKey!==plan.historyKey
      || expected.revision!==plan.read.revision || expected.ledgerId!==plan.ledgerId || plan.history.rows.length>=64) return null;
    const ledger=structuredLedgerValue(copy,plan.source.originals);
    if (!ledger || !structuredExtends(plan.history.ledger,ledger,plan.referenceCapture) || !ledger.originals.length) return null;
    const e=plan.enrollment, originalMap=new Map(plan.source.originals.map(row=>[row.eventId,row]));
    const sourceDeadlines=ledger.originals.flatMap(ref=>{const row=originalMap.get(ref.eventId)!;return [Date.parse(row.expiresAt),Date.parse(row.recordedAt)+e.retention_days*86_400_000];});
    if (ledger.originals.some(ref=>Date.parse(originalMap.get(ref.eventId)!.recordedAt)<Date.parse(e.enrolled_at))) return null;
    const grant=nativeMemoryGrantDeadline(plan.authority.principal,Date.now());
    if (grant===undefined) return null;
    const expiry=Math.min(Date.parse(e.expires_at),...sourceDeadlines,plan.history.expiresAt?Date.parse(plan.history.expiresAt):Infinity,grant?Date.parse(grant):Infinity);
    if (!Number.isFinite(expiry) || expiry<=Date.now()) return null;
    const body=canonicalConsent(ledger), hash=await memoryDigest(body);
    if (!plan.fresh() || canonicalConsent(proposed)!==proposedKey) return null;
    const stored=e.organization_id===null
      ?await preparePrivateContent(env,e.actor_user_id,structuredKind,body,plan.authority.binding.scope??undefined,undefined,undefined,undefined,new Date(expiry).toISOString())
      :structuredSharedPrivateContent(env,plan,body,new Date(expiry).toISOString());
    if (!plan.fresh() || canonicalConsent(proposed)!==proposedKey || stored.statements.length!==(e.organization_id===null?1:3)
      || stored.requiredInserts!==stored.statements.length || nativeMemoryTimestamp(stored.createdAt)===null || nativeMemoryTimestamp(stored.expiresAt)===null
      || Date.parse(stored.expiresAt)>expiry || Date.parse(stored.expiresAt)<=Date.now()) return null;
    const revision=plan.history.rows.length+1, now=stored.createdAt;
    const originWithdrawal=await prepareNativeStructuredOriginWithdrawal(env,{ledgerId:plan.ledgerId},"source-unavailable",now);
    if(!originWithdrawal||!plan.fresh()||canonicalConsent(proposed)!==proposedKey)return null;
    const jobWithdrawal=await prepareNativeDocumentJobOriginWithdrawal(env,{ledgerId:plan.ledgerId},"source-unavailable",now);
    if(!jobWithdrawal||!plan.fresh()||canonicalConsent(proposed)!==proposedKey)return null;
    const nextRevision:StructuredLedgerRow={ledger_id:plan.ledgerId,revision,predecessor_revision:revision-1,predecessor_hash:plan.history.head?.current_body_hash??null,
      body_ref:stored.contentId,body_hash:hash,schema_version:1,recipe_version:structuredRecipe,annotation_count:ledger.annotations.length,
      coverage_after_sequence:Math.min(...ledger.originals.map(ref=>ref.sequence))-1,coverage_through_sequence:Math.max(...ledger.originals.map(ref=>ref.sequence)),created_at:now,expires_at:stored.expiresAt};
    const nextHead:StructuredLedgerRow={ledger_id:plan.ledgerId,actor_user_id:e.actor_user_id,owner_user_id:e.owner_user_id,organization_id:e.organization_id,
      project_access_id:e.project_access_id,project_id:e.project_id,document_id:e.document_id,enrollment_id:e.enrollment_id,enrollment_revision:e.revision,
      permission_epoch:e.permission_epoch,policy_version:e.policy_version,storage_revision:revision,current_body_ref:stored.contentId,current_body_hash:hash,
      annotation_count:ledger.annotations.length,coverage_after_sequence:nextRevision.coverage_after_sequence,coverage_through_sequence:nextRevision.coverage_through_sequence,
      state:"active",first_terminal_at:null,cleanup_turn:0,expires_at:stored.expiresAt,created_at:plan.history.head?.created_at??now,updated_at:now};
    const nextBody={content_id:stored.contentId,owner_id:e.actor_user_id,kind:structuredKind,content:body,created_at:now,expires_at:stored.expiresAt,redacted_at:null};
    const resource={project_access_id:e.project_access_id,resource_kind:"content",resource_id:stored.contentId,organization_id:e.organization_id,project_id:e.project_id,
      owner_user_id:e.owner_user_id,visibility:"actor_private",source_event_id:null,actor_user_id:e.actor_user_id,created_at:now};
    const retention={content_id:stored.contentId,organization_id:e.organization_id,project_access_id:e.project_access_id,project_id:e.project_id,actor_user_id:e.actor_user_id,
      classification:"transient-private",policy_version:plan.policy?.version??0,assigned_expires_at:stored.expiresAt,created_at:now};
    const rows=[...plan.history.rows,{revision:nextRevision,body:nextBody,resources:e.organization_id===null?[]:[resource],retentions:e.organization_id===null?[]:[retention]}];
    if (structuredBytes(rows)>1_048_576) return null;
    // Budget the exact encoded complete postimage as well, including JSON escaping in
    // the actual one-row history projection and the source union's certified reads.
    const postRow={heads_json:JSON.stringify([nextHead]),history_json:JSON.stringify(rows),alive:1};
    if (structuredBytes(postRow)+plan.authorityBytes+plan.source.budget.bytes>2_097_152) return null;
    const statements:D1PreparedStatement[]=[],proofIndexes:number[]=[],ownIndexes:number[]=[];
    const proof=(items:D1PreparedStatement[])=>{for(const statement of items){proofIndexes.push(statements.length);statements.push(statement);}};
    const asserted=(statement:D1PreparedStatement)=>{ownIndexes.push(statements.length);statements.push(statement);};
    const changed=()=>asserted(memorySqlAssertion(env,{condition:"changes()=1",bindings:[]}));
    // A host check after dispatch cannot undo a committed write. Keep the original
    // issued read/capture ceiling in the same SQLite transaction as publication.
    const commitUntil=new Date(Math.min(Date.parse(expected.validUntil),Date.parse(plan.read.validUntil),Date.parse(plan.source.validUntil),grant?Date.parse(grant):Infinity)).toISOString();
    const beforeDeadline=()=>memorySqlAssertion(env,{condition:"strftime('%Y-%m-%dT%H:%M:%fZ','now')<?",bindings:[commitUntil]});
    asserted(beforeDeadline());proof(plan.source.precommitStatements());proof(plan.witness.precommitStatements());
    const originOffset=statements.length;
    statements.push(...originWithdrawal.statements.map(query=>env.DB.prepare(query.sql).bind(...query.bindings)));
    ownIndexes.push(...originWithdrawal.assertionIndexes.map(index=>originOffset+index));
    const jobOffset=statements.length;
    statements.push(...jobWithdrawal.statements.map(query=>env.DB.prepare(query.sql).bind(...query.bindings)));
    ownIndexes.push(...jobWithdrawal.assertionIndexes.map(index=>jobOffset+index));
    for (const statement of stored.statements) {
      asserted(beforeDeadline());proof(plan.source.precommitStatements());proof(plan.witness.precommitStatements());statements.push(statement);changed();
    }
    asserted(beforeDeadline());proof(plan.source.precommitStatements());proof(plan.witness.precommitStatements());
    if (!plan.history.head) statements.push(env.DB.prepare(`INSERT INTO ${structuredHeads}(${structuredHeadColumns.join(",")}) VALUES(${structuredHeadColumns.map(()=>"?").join(",")})`)
      .bind(...structuredHeadColumns.map(key=>nextHead[key] as string|number|null)));
    else statements.push(env.DB.prepare(`UPDATE ${structuredHeads} SET ${structuredHeadColumns.filter(key=>key!=="ledger_id").map(key=>`${key}=?`).join(",")} WHERE ledger_id=? AND state='active' AND storage_revision=?`)
      .bind(...structuredHeadColumns.filter(key=>key!=="ledger_id").map(key=>nextHead[key] as string|number|null),plan.ledgerId,revision-1));
    changed();proof(plan.source.precommitStatements());
    // The head has intentionally changed, but every old revision/body remains exact.
    asserted(structuredStateAssertion(env,plan.historyQuery,nextHead,plan.history.rows));
    statements.push(env.DB.prepare(`INSERT INTO ${structuredRevisions}(${structuredRevisionColumns.join(",")}) VALUES(${structuredRevisionColumns.map(()=>"?").join(",")})`)
      .bind(...structuredRevisionColumns.map(key=>nextRevision[key] as string|number|null)));
    changed();asserted(structuredStateAssertion(env,plan.historyQuery,nextHead,rows));
    asserted(memorySqlAssertion(env,plan.schemaGuard));
    const enrollmentGuard=liveMemoryEnrollmentGuard(e,"learn"),recallGuard=liveMemoryEnrollmentGuard(e,"recall");
    asserted(memorySqlAssertion(env,{condition:`(${plan.authority.guard.condition}) AND (${enrollmentGuard.condition}) AND (${recallGuard.condition})
      AND EXISTS(SELECT 1 FROM memory_live_enrollments WHERE ${structuredEnrollmentColumns.map(key=>`${key} IS ?`).join(" AND ")})`,
      bindings:[...plan.authority.guard.bindings,...enrollmentGuard.bindings,...recallGuard.bindings,...structuredEnrollmentColumns.map(key=>e[key as keyof LiveMemoryEnrollment])]}));
    proof(plan.source.precommitStatements());asserted(beforeDeadline());
    originWithdrawal.terminalAssertions.forEach(query=>asserted(env.DB.prepare(query.sql).bind(...query.bindings)));
    jobWithdrawal.terminalAssertions.forEach(query=>asserted(env.DB.prepare(query.sql).bind(...query.bindings)));
    if (!plan.fresh() || Date.now()>=Date.parse(expected.validUntil) || canonicalConsent(proposed)!==proposedKey) return null;
    dispatched=true;
    const results=structuredClone(await env.DB.batch<StructuredLedgerRow>(statements));
    if (!plan.fresh() || !structuredResults(results,statements.length) || !structuredAsserted(results,proofIndexes)
      || !structuredAsserted(results,ownIndexes,"verified")
      || !originWithdrawal.acknowledge(results.slice(originOffset,originOffset+originWithdrawal.statements.length))
      || !jobWithdrawal.acknowledge(results.slice(jobOffset,jobOffset+jobWithdrawal.statements.length))) throw new Error("memory-structured-write-unconfirmed");
    const validUntil=new Date(Math.min(Date.parse(expected.validUntil),Date.parse(plan.read.validUntil),Date.parse(stored.expiresAt))).toISOString();
    const read=structuredFreeze<StructuredConversationLedgerRead>({status:"active",ledgerId:plan.ledgerId,revision,ledger,validUntil,expiresAt:stored.expiresAt});
    structuredLedgerFrames.set(read,{env,enrollmentKey:plan.enrollmentKey,preparedKey:plan.preparedKey,settings:plan.settings,
      historyKey:canonicalConsent({head:nextHead,rows}),read});
    return read;
  } catch(error) {
    // A rejected native batch may be known to roll back; a transport/acknowledgement
    // failure after dispatch is not such proof. Never fabricate a successful read.
    if (dispatched) throw new Error("memory-structured-write-unconfirmed",{cause:error});
    return null;
  }
}

export type StructuredConversationWithdrawalSelector = {actorUserId:string;personalOnly?:boolean}|{organizationId:string}|{enrollment:LiveMemoryEnrollment;expectedEnrollmentAbsent?:true};
const structuredOriginBodyResidue=(ref:string)=>`(EXISTS(SELECT 1 FROM private_content body WHERE body.content_id=${ref})
  OR EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=${ref})
  OR EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=${ref}))`;
const structuredOriginPending=(origin:string)=>`(${origin}.status IS NOT 'minimized'
  OR ${structuredOriginBodyResidue(`${origin}.answer_content_id`)}
  OR ${structuredOriginBodyResidue(`${origin}.manifest_content_ref`)}
  OR EXISTS(SELECT 1 FROM memory_structured_answer_originals dependency WHERE dependency.origin_id=${origin}.origin_id)
  OR EXISTS(SELECT 1 FROM memory_structured_answer_ledger_revisions dependency WHERE dependency.origin_id=${origin}.origin_id))`;
// This key is the native answer scope, not the hashed ledger identity. It survives
// terminal metadata minimization and must classify shared tombstones as shared.
const structuredOriginScopeKey=(e:LiveMemoryEnrollment)=>JSON.stringify([e.organization_id??"",e.project_access_id??"",e.project_id,e.document_id]);
// These rows are comparison metadata backed by the native full registry/MF/
// progress snapshot. They are never accepted from the caller or a public marker.
const structuredJobCoverageText=(coverage:NativeDocumentJobOriginCleanupCoverage)=>{
  const text=canonicalConsent(coverage.rows);if(structuredBytes(text)>1_048_576)throw new Error("memory-job-cleanup-coverage-unavailable");return text;
};
const structuredJobRows=`(SELECT json_extract(value,'$.actor_user_id') AS actor_user_id,json_extract(value,'$.scope_key') AS scope_key,
  json_extract(value,'$.status') AS status,json_extract(value,'$.enrollment_id') AS enrollment_id,
  json_extract(value,'$.enrollment_revision') AS enrollment_revision,json_extract(value,'$.answer_content_id') AS answer_content_id,
  json_extract(value,'$.manifest_content_ref') AS manifest_content_ref FROM json_each(?))`;
// Exact native coverage already proves minimized headers have no live selector,
// progress or derivative residue. Unknown/resurrected residues never become zero.
const structuredJobPending=(origin:string)=>`(${origin}.status IS NOT 'minimized'
  OR ${structuredOriginBodyResidue(`${origin}.answer_content_id`)} OR ${structuredOriginBodyResidue(`${origin}.manifest_content_ref`)})`;
const structuredOriginOrphan=(present:boolean,actorId:string|null,jobRows:string)=>{
  const actorClause=actorId===null?"":"AND body.owner_id=?";
  const manifestOwned=`EXISTS(SELECT 1 FROM json_each(?) job WHERE
    json_extract(job.value,'$.manifest_content_ref')=body.content_id AND json_extract(job.value,'$.actor_user_id')=body.owner_id)`;
  const answerOwned=`EXISTS(SELECT 1 FROM json_each(?) job WHERE body.kind='chat-assistant-memory' AND event.actor='worker:memory'
    AND json_extract(job.value,'$.answer_content_id')=body.content_id AND json_extract(job.value,'$.actor_user_id')=body.owner_id
    AND json_extract(job.value,'$.answer_event_id')=event.event_id AND json_extract(job.value,'$.stream_id')=event.stream_id
    AND json_extract(job.value,'$.source_head')+2=event.sequence
    AND CASE WHEN json_valid(event.payload) THEN json_type(event.payload,'$.memory_origin_version')='integer'
      AND json_extract(event.payload,'$.memory_origin_version') IS 3
      AND json_extract(event.payload,'$.job_id')=json_extract(job.value,'$.job_id')
      AND json_extract(event.payload,'$.turn_id')=json_extract(job.value,'$.turn_id') ELSE 0 END)`;
  return {sql:`(EXISTS(SELECT 1 FROM private_content body
    WHERE body.kind IN('memory-structured-origin','memory-document-job-origin') ${actorClause}
      AND ${structuredOriginBodyResidue("body.content_id")} AND NOT(
        (body.kind='memory-structured-origin' AND ${present?"EXISTS(SELECT 1 FROM memory_structured_answer_origins origin WHERE origin.manifest_content_ref=body.content_id AND origin.actor_user_id=body.owner_id)":"0"})
        OR (body.kind='memory-document-job-origin' AND ${manifestOwned})))
    OR EXISTS(SELECT 1 FROM private_content body JOIN events event ON event.type='AssistantReasoned'
      AND CASE WHEN json_valid(event.payload) THEN json_extract(event.payload,'$.content_ref') IS body.content_id
        AND json_type(event.payload,'$.memory_origin_version') IS NOT NULL
        AND NOT(json_type(event.payload,'$.memory_origin_version')='integer' AND json_extract(event.payload,'$.memory_origin_version') IS 1) ELSE 0 END
      WHERE ${structuredOriginBodyResidue("body.content_id")} ${actorClause}
      ${present?"AND NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins origin WHERE origin.answer_content_id=body.content_id AND origin.actor_user_id=body.owner_id)":""}
      AND NOT(${answerOwned})))`,bindings:[...(actorId===null?[]:[actorId]),jobRows,...(actorId===null?[]:[actorId]),jobRows]};
};

/** One cohesive privacy inverse: one scoped job transition, then the existing
 * v2 and ledger owners, with exact terminal assertions. Pending origins are a separate
 * logical count; neither held nor unacknowledged derived data is called erased. */
export async function prepareStructuredConversationWithdrawal(env:WorkerEnv,selector:StructuredConversationWithdrawalSelector,now:string):Promise<{
  statements:D1PreparedStatement[];terminalAssertions:D1PreparedStatement[];assertionIndexes:number[];
  pendingRevisions:number;pendingOrigins:number;pendingJobOrigins:number;acknowledge(results:readonly unknown[]):boolean;
}> {
  const db=env.DB,key=canonicalConsent(selector);
  const selected=structuredClone(selector);
  if(Object.hasOwn(selected,"expectedEnrollmentAbsent")&&(!("enrollment" in selected)||selected.expectedEnrollmentAbsent!==true
    ||!structuredKeys(selected,["enrollment","expectedEnrollmentAbsent"])||!structuredKeys(selected.enrollment,structuredEnrollmentColumns)
    ||selected.enrollment.revision!==1))throw new Error("memory-structured-withdrawal-invalid");
  const enrollmentAbsence="enrollment" in selected&&selected.expectedEnrollmentAbsent===true
    ?{condition:"NOT EXISTS(SELECT 1 FROM memory_live_enrollments WHERE enrollment_id=?)",bindings:[selected.enrollment.enrollment_id]}:null;
  const originSelector="enrollment" in selected?(enrollmentAbsence?{enrollmentId:selected.enrollment.enrollment_id}
    :{enrollmentId:selected.enrollment.enrollment_id,currentRevision:selected.enrollment.revision})
    :"organizationId" in selected?{organizationId:selected.organizationId}
      :selected.personalOnly?{actorUserId:selected.actorUserId,personalOnly:true as const}:{actorUserId:selected.actorUserId};
  const origin=await prepareNativeStructuredOriginWithdrawal(env,originSelector,"erased",now);
  if(!origin||env.DB!==db||canonicalConsent(selector)!==key)throw new Error("memory-structured-origin-withdrawal-unavailable");
  const job=await prepareNativeDocumentJobOriginWithdrawal(env,originSelector,"erased",now);
  if(!job||env.DB!==db||canonicalConsent(selector)!==key)throw new Error("memory-document-job-origin-withdrawal-unavailable");
  const schema=await nativeStructuredOriginSchema(env);
  if(env.DB!==db||canonicalConsent(selector)!==key)throw new Error("memory-structured-origin-withdrawal-changed");
  const where="enrollment" in selected?{condition:"origin.actor_user_id=? AND origin.scope_key=?",
    bindings:[selected.enrollment.actor_user_id,structuredOriginScopeKey(selected.enrollment)]}
    :"organizationId" in selected?{condition:"json_extract(origin.scope_key,'$[0]')=?",bindings:[selected.organizationId]}
      :{condition:`origin.actor_user_id=?${selected.personalOnly?" AND json_extract(origin.scope_key,'$[0]')='' AND json_extract(origin.scope_key,'$[1]')=''":""}`,bindings:[selected.actorUserId]};
  const actorId="enrollment" in selected?selected.enrollment.actor_user_id:"actorUserId" in selected?selected.actorUserId:null;
  const originIntegrity=schema.present?nativeStructuredOriginMinimizedIntegrity():{sql:"1",bindings:[]};
  const countFor=(coverage:NativeDocumentJobOriginCleanupCoverage)=>{
    const jobRows=structuredJobCoverageText(coverage),orphan=structuredOriginOrphan(schema.present,actorId,jobRows);
    return nativeMemoryDescriptor(`SELECT ${schema.present?`(SELECT COUNT(*) FROM memory_structured_answer_origins origin
      WHERE (${where.condition}) AND ${structuredOriginPending("origin")})`:"0"}
      +(SELECT COUNT(*) FROM ${structuredJobRows} origin WHERE (${where.condition}) AND ${structuredJobPending("origin")}) AS pending,
      CASE WHEN ${orphan.sql} OR NOT (${originIntegrity.sql}) THEN 1 ELSE 0 END AS orphaned`,
      [...(schema.present?where.bindings:[]),jobRows,...where.bindings,...orphan.bindings,...originIntegrity.bindings]);
  };
  const countQuery=countFor(job.initialCoverage),terminalCountQuery=countFor(job.terminalCoverage);
  const counts=structuredClone(await db.prepare(countQuery.sql).bind(...countQuery.bindings).all<StructuredLedgerRow>());
  if(env.DB!==db||canonicalConsent(selector)!==key||!structuredResults([counts],1)||counts.results.length!==1
    ||!structuredKeys(counts.results[0],["pending","orphaned"])||counts.results[0].orphaned!==0
    ||typeof counts.results[0].pending!=="number"||!Number.isSafeInteger(counts.results[0].pending)||counts.results[0].pending<0)
    throw new Error("memory-structured-origin-withdrawal-unavailable");
  const pendingOrigins=counts.results[0].pending;
  // Only this wrapper's own bookends precede initial enrollment insertion. Its
  // outer terminal assertions must allow the caller's subsequently inserted row.
  const pendingAssertion=(preInsert=false,terminal=false)=>{
    const query=terminal?terminalCountQuery:countQuery;
    return memorySqlAssertion(env,{condition:`(${schema.guard.condition}) AND EXISTS(SELECT 1 FROM (${query.sql}) captured
      WHERE captured.pending=? AND captured.orphaned=0)${preInsert&&enrollmentAbsence?` AND (${enrollmentAbsence.condition})`:""}`,
      bindings:[...schema.guard.bindings,...query.bindings,pendingOrigins,...(preInsert&&enrollmentAbsence?enrollmentAbsence.bindings:[])]});
  };
  const ledger=await prepareStructuredConversationLedgerWithdrawal(env,selector,now);
  if(env.DB!==db||canonicalConsent(selector)!==key)throw new Error("memory-structured-origin-withdrawal-changed");
  const originStatements=origin.statements.map(query=>db.prepare(query.sql).bind(...query.bindings));
  const originTerminal=origin.terminalAssertions.map(query=>db.prepare(query.sql).bind(...query.bindings));
  const nativeStatements=(queries:readonly {sql:string;bindings:readonly (string|number|null)[]}[])=>queries.map(query=>db.prepare(query.sql).bind(...query.bindings));
  const jobInitial=nativeStatements(job.initialCoverage.assertions),jobStatements=nativeStatements(job.statements),jobTerminal=nativeStatements(job.terminalCoverage.assertions);
  const pendingIndex=jobInitial.length,jobOffset=pendingIndex+1,originOffset=jobOffset+jobStatements.length;
  const ledgerOffset=originOffset+originStatements.length,terminalOffset=ledgerOffset+ledger.statements.length;
  const jobTerminalOffset=terminalOffset+originTerminal.length;
  // The exact original snapshot precedes the sole job inverse. Subsequent
  // bookends use its exact terminal negative state, never active-or-withdrawn.
  const statements=[...jobInitial,pendingAssertion(true),...jobStatements,...originStatements,...ledger.statements,
    ...originTerminal,...jobTerminal,pendingAssertion(true,true)];
  const assertionIndexes=[...jobInitial.map((_,index)=>index),pendingIndex,...job.assertionIndexes.map(index=>jobOffset+index),
    ...origin.assertionIndexes.map(index=>originOffset+index),...ledger.assertionIndexes.map(index=>ledgerOffset+index),
    ...originTerminal.map((_,index)=>terminalOffset+index),...jobTerminal.map((_,index)=>jobTerminalOffset+index),statements.length-1];
  return {statements,terminalAssertions:[...originTerminal,...ledger.terminalAssertions,...jobTerminal,pendingAssertion(false,true)],assertionIndexes,
    pendingRevisions:ledger.pendingRevisions,pendingOrigins,pendingJobOrigins:job.pendingOrigins,acknowledge(results){
      return env.DB===db&&canonicalConsent(selector)===key&&structuredResults(results as D1Result<StructuredLedgerRow>[],statements.length)
        &&structuredAsserted(results as D1Result<StructuredLedgerRow>[],assertionIndexes,"verified")
        &&job.acknowledge(results.slice(jobOffset,originOffset))&&origin.acknowledge(results.slice(originOffset,ledgerOffset));
    }};
}
const structuredHeld = (bodyRef:string) => `(EXISTS(SELECT 1 FROM private_content_retention_scopes governed JOIN organization_retention_policies policy
  ON policy.organization_id=governed.organization_id AND policy.legal_hold=1 WHERE governed.content_id=${bodyRef} AND governed.classification='governed-evidence')
  OR EXISTS(SELECT 1 FROM private_content_retention_scopes governed JOIN organization_legal_holds hold ON hold.organization_id=governed.organization_id AND hold.status='active'
    WHERE governed.content_id=${bodyRef} AND (hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=governed.project_access_id
      OR hold.scope_kind='content' AND hold.resource_id=governed.content_id)))`;
const structuredScopeHeld=(organization:string,access:string,body:string)=>`(${organization} IS NOT NULL AND EXISTS(SELECT 1 FROM organization_legal_holds hold
  WHERE hold.organization_id=${organization} AND hold.status='active' AND (hold.scope_kind='organization'
    OR hold.scope_kind='project' AND hold.resource_id=${access} OR hold.scope_kind='content' AND hold.resource_id=${body})))`;
function structuredWithdrawalWhere(selector:StructuredConversationWithdrawalSelector):MemorySqlGuard {
  if ("enrollment" in selector) {
    const e=selector.enrollment;
    if (!structuredKeys(e,structuredEnrollmentColumns)) throw new Error("memory-structured-withdrawal-invalid");
    // Enrollment IDs are intentionally NOT the selector: retiring heads have already
    // cleared them, and replacement enrollment must encounter the same durable fence.
    return {condition:structuredScopeWhere,bindings:structuredScope(e)};
  }
  if ("organizationId" in selector) {
    if (!structuredId(selector.organizationId)) throw new Error("memory-structured-withdrawal-invalid");
    return {condition:"organization_id=?",bindings:[selector.organizationId]};
  }
  if (!structuredId(selector.actorUserId)) throw new Error("memory-structured-withdrawal-invalid");
  return {condition:`actor_user_id=?${selector.personalOnly?" AND organization_id IS NULL":""}`,bindings:[selector.actorUserId]};
}
const structuredMetadataReadable=(alias:string,columns:readonly string[])=>columns.map(column=>`(typeof(${alias}.${column})!='blob' AND
  (typeof(${alias}.${column})!='text' OR length(CAST(${alias}.${column} AS BLOB))<=1024))`).join(" AND ");
// Unavailable scalar metadata is represented without hydrating arbitrary bytes.
// Such a row cannot be a physical target, but cannot poison a different valid
// revision's bounded cleanup projection either. No original body text is read.
const structuredRetirementJsonRow=(alias:string,columns:readonly string[])=>{
  const value=(column:string)=>`CASE WHEN typeof(${alias}.${column})='blob' OR typeof(${alias}.${column})='text' AND length(CAST(${alias}.${column} AS BLOB))>1024 THEN NULL ELSE ${alias}.${column} END`;
  const initial="json_object("+columns.slice(0,15).map(column=>`'${column}',${value(column)}`).join(",")+")";
  // Preserve every explicit NULL key and its order while keeping each function
  // below D1's 32-argument compatibility limit. These fixed rows have at most 23 columns.
  return columns.length<=15?initial:"json_set("+initial+","+columns.slice(15).map(column=>`'$.${column}',${value(column)}`).join(",")+")";
};
function structuredRetirementQuery(where:MemorySqlGuard) {
  const bodyColumns=structuredBodyColumns.filter(key=>key!=="content"&&key!=="redacted_at");
  return nativeMemoryDescriptor(`WITH selected_heads AS(SELECT * FROM ${structuredHeads} WHERE ${where.condition}),
    selected_rows AS(SELECT revision.*,head.actor_user_id AS expected_actor,head.organization_id AS expected_organization,head.project_access_id AS expected_access FROM ${structuredRevisions} revision JOIN selected_heads head ON head.ledger_id=revision.ledger_id)
    SELECT (SELECT json_group_array(json(${structuredRetirementJsonRow("head",structuredHeadColumns)})) FROM(SELECT * FROM selected_heads ORDER BY ledger_id) head) AS heads_json,
      (SELECT json_group_array(json_object('revision',json(${structuredRetirementJsonRow("revision",structuredRevisionColumns)}),
        'body',CASE WHEN private_content.content_id IS NULL THEN NULL ELSE json(${structuredRetirementJsonRow("private_content",bodyColumns)}) END,
        'metadata_valid',CASE WHEN ${structuredMetadataReadable("revision",structuredRevisionColumns)}
          AND (private_content.content_id IS NULL OR (${structuredMetadataReadable("private_content",bodyColumns)}))
          AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=revision.body_ref
            AND NOT(${structuredMetadataReadable("resource",structuredResourceColumns)}))
          AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=revision.body_ref
            AND NOT(${structuredMetadataReadable("retention",structuredRetentionColumns)})) THEN 1 ELSE 0 END,
        'body_exists',(SELECT COUNT(*) FROM private_content present WHERE present.content_id=revision.body_ref),
        'body_conflicts',((SELECT COUNT(*) FROM ${structuredHeads} other WHERE other.ledger_id!=revision.ledger_id AND other.current_body_ref=revision.body_ref)
          +(SELECT COUNT(*) FROM ${structuredRevisions} other WHERE other.ledger_id!=revision.ledger_id AND other.body_ref=revision.body_ref)),
        'resources',json((SELECT json_group_array(json(${structuredRetirementJsonRow("resource",structuredResourceColumns)})) FROM(SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=revision.body_ref LIMIT 2) resource)),
        'retentions',json((SELECT json_group_array(json(${structuredRetirementJsonRow("retention",structuredRetentionColumns)})) FROM(SELECT * FROM private_content_retention_scopes WHERE content_id=revision.body_ref LIMIT 2) retention)), 'held',CASE WHEN ${structuredHeld("revision.body_ref")} OR ${structuredScopeHeld("revision.expected_organization","revision.expected_access","revision.body_ref")} THEN 1 ELSE 0 END))
       FROM(SELECT * FROM selected_rows ORDER BY ledger_id,revision) revision LEFT JOIN private_content ON private_content.content_id=revision.body_ref
        AND private_content.owner_id=revision.expected_actor AND private_content.kind='${structuredKind}') AS rows_json`,where.bindings);
}
const structuredRetiredHead = (head:StructuredLedgerRow,now:string,remaining:boolean):StructuredLedgerRow => ({...head,
  enrollment_id:null,enrollment_revision:null,permission_epoch:null,policy_version:null,current_body_ref:null,current_body_hash:null,annotation_count:null,
  coverage_after_sequence:null,coverage_through_sequence:null,expires_at:null,state:remaining?"retiring":"retired",
  first_terminal_at:head.first_terminal_at??now,cleanup_turn:remaining?head.cleanup_turn:0,updated_at:now});
function structuredMetadataAssertion(env:WorkerEnv,query:ReturnType<typeof nativeMemoryDescriptor>,heads:StructuredLedgerRow[],rows:StructuredLedgerRow[]) {
  const headFields=structuredHeadColumns.map(column=>`$.${column}`),rowFields=[...structuredRevisionColumns.map(column=>`$.revision.${column}`),
    ...structuredBodyColumns.filter(column=>column!=="content"&&column!=="redacted_at").map(column=>`$.body.${column}`),
    ...structuredResourceColumns.map(column=>`$.resources[0].${column}`),...structuredRetentionColumns.map(column=>`$.retentions[0].${column}`),"$.held","$.body_exists","$.body_conflicts","$.metadata_valid"];
  const equal=(fields:string[])=>`(${fields.map(field=>`json_extract(observed.value,'${field}')`).join(",")}) IS (${fields.map(field=>`json_extract(expected.value,'${field}')`).join(",")})`;
  return env.DB.prepare(`WITH actual AS(${query.sql}),expected_heads AS(SELECT value FROM json_each(?)),expected_rows AS(SELECT value FROM json_each(?))
    SELECT CASE WHEN json_array_length(actual.heads_json)=(SELECT COUNT(*) FROM expected_heads) AND json_array_length(actual.rows_json)=(SELECT COUNT(*) FROM expected_rows)
      AND NOT EXISTS(SELECT 1 FROM json_each(actual.heads_json) observed LEFT JOIN expected_heads expected
        ON json_extract(observed.value,'$.ledger_id')=json_extract(expected.value,'$.ledger_id') WHERE expected.value IS NULL OR NOT(${equal(headFields)}))
      AND NOT EXISTS(SELECT 1 FROM json_each(actual.rows_json) observed LEFT JOIN expected_rows expected
        ON (json_extract(observed.value,'$.revision.ledger_id'),json_extract(observed.value,'$.revision.revision'))
          =(json_extract(expected.value,'$.revision.ledger_id'),json_extract(expected.value,'$.revision.revision'))
        WHERE expected.value IS NULL OR NOT(${equal(rowFields)})
          OR json_array_length(json_extract(observed.value,'$.resources'))!=json_array_length(json_extract(expected.value,'$.resources'))
          OR json_array_length(json_extract(observed.value,'$.retentions'))!=json_array_length(json_extract(expected.value,'$.retentions')))
      THEN 1 ELSE json('memory_structured_retirement_changed') END AS verified FROM actual`).bind(...query.bindings,JSON.stringify(heads),JSON.stringify(rows));
}
function structuredRetirementRows(value:StructuredLedgerRow):{heads:StructuredLedgerRow[];rows:StructuredLedgerRow[]}|null {
  if (typeof value.heads_json!=="string" || typeof value.rows_json!=="string" || structuredBytes(value)>2_097_152) return null;
  const heads:unknown=JSON.parse(value.heads_json),rows:unknown=JSON.parse(value.rows_json);
  if (!Array.isArray(heads)||!Array.isArray(rows) || heads.some(head=>!structuredKeys(head,structuredHeadColumns))
    || rows.some(row=>!structuredKeys(row,["revision","body","body_exists","body_conflicts","metadata_valid","resources","retentions","held"]) || !structuredKeys(row.revision,structuredRevisionColumns)
      || row.body!==null&&!structuredKeys(row.body,structuredBodyColumns.filter(column=>column!=="content"&&column!=="redacted_at"))
      || !Array.isArray(row.resources)||row.resources.length>1||!Array.isArray(row.retentions)||row.retentions.length>1||![0,1].includes(row.held as number))) return null;
  const byHead=new Map((heads as StructuredLedgerRow[]).map(head=>[head.ledger_id,head]));
  if (byHead.size!==heads.length) return null;
  for (const value of rows as StructuredLedgerRow[]) {
    const revision=value.revision as StructuredLedgerRow,body=value.body as StructuredLedgerRow|null,head=byHead.get(revision.ledger_id);
    const resources=value.resources as StructuredLedgerRow[],retentions=value.retentions as StructuredLedgerRow[];
    if (!head || !structuredId(revision.body_ref) || !structuredHash(revision.body_hash) || ![0,1].includes(value.body_exists as number)
      || value.metadata_valid!==1 || value.body_conflicts!==0 || (body===null?value.body_exists!==0:value.body_exists!==1) || nativeMemoryTimestamp(revision.created_at)===null
      || nativeMemoryTimestamp(revision.expires_at)===null || body && (body.content_id!==revision.body_ref || body.owner_id!==head.actor_user_id
        || body.kind!==structuredKind || body.created_at!==revision.created_at || nativeMemoryTimestamp(body.expires_at)===null
        || String(body.expires_at)>String(revision.expires_at))) return null;
    if (head.organization_id===null) { if (resources.length||retentions.length) return null; }
    else {
      if (body && (resources.length!==1||retentions.length!==1)) return null;
      if (resources.some(resource=>!structuredKeys(resource,structuredResourceColumns) || resource.resource_id!==revision.body_ref || resource.resource_kind!=="content"
        || resource.project_access_id!==head.project_access_id || resource.organization_id!==head.organization_id || resource.project_id!==head.project_id
        || resource.owner_user_id!==head.owner_user_id || resource.actor_user_id!==head.actor_user_id || resource.visibility!=="actor_private"
        || resource.created_at!==revision.created_at)) return null;
      if (retentions.some(retention=>!structuredKeys(retention,structuredRetentionColumns) || retention.content_id!==revision.body_ref
        || retention.organization_id!==head.organization_id || retention.project_access_id!==head.project_access_id || retention.project_id!==head.project_id
        || retention.actor_user_id!==head.actor_user_id || retention.classification!=="transient-private" || retention.created_at!==revision.created_at
        || typeof retention.policy_version!=="number" || !Number.isSafeInteger(retention.policy_version) || retention.policy_version<0
        || nativeMemoryTimestamp(retention.assigned_expires_at)===null || String(retention.assigned_expires_at)>String(revision.expires_at))) return null;
    }
  }
  return {heads:heads as StructuredLedgerRow[],rows:rows as StructuredLedgerRow[]};
}
/** Prepare only; callers retain their existing authorization/certificate around the
 * entire returned batch. Holds defer physical erasure, never restore readable heads. */
async function prepareStructuredConversationLedgerWithdrawal(env:WorkerEnv,selector:StructuredConversationWithdrawalSelector,now:string):Promise<{
  statements:D1PreparedStatement[];terminalAssertions:D1PreparedStatement[];assertionIndexes:number[];pendingRevisions:number;
}> {
  const selected=structuredClone(selector),key=canonicalConsent(selector),db=env.DB;
  if (nativeMemoryTimestamp(now)===null) throw new Error("memory-structured-withdrawal-invalid");
  const schema=await structuredConversationLedgerSchema(env),where=structuredWithdrawalWhere(selected);
  if (!schema.present) {
    // Absence of ledger tables is not evidence that dedicated private data was
    // erased. Without a native scope association, do not guess an orphan's document
    // or delete it; actor-wide (organization selector: globally conservative)
    // no-owned-pending-data evidence must survive the caller's entire transaction.
    const actorId="enrollment" in selected?selected.enrollment.actor_user_id:"actorUserId" in selected?selected.actorUserId:null;
    const empty:MemorySqlGuard={condition:`NOT EXISTS(SELECT 1 FROM private_content body WHERE body.kind='${structuredKind}'
      ${actorId===null?"":"AND body.owner_id=?"} AND (body.content!='' OR body.redacted_at IS NULL
        OR EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=body.content_id)
        OR EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=body.content_id)))`,bindings:actorId===null?[]:[actorId]};
    const observed=structuredClone(await db.prepare(`SELECT CASE WHEN ${empty.condition} THEN 1 ELSE 0 END AS empty`).bind(...empty.bindings).all<StructuredLedgerRow>());
    if(!structuredResults([observed],1)||observed.results.length!==1||observed.results[0].empty!==1)throw new Error("memory-structured-withdrawal-unavailable");
    if (env.DB!==db||canonicalConsent(selector)!==key) throw new Error("memory-structured-preparation-changed");
    const absent=()=>memorySqlAssertion(env,{condition:`(${schema.guard.condition}) AND (${empty.condition})`,bindings:[...schema.guard.bindings,...empty.bindings]});
    return {statements:[absent(),absent()],terminalAssertions:[absent()],assertionIndexes:[0,1],pendingRevisions:0};
  }
  // A selected-head projection cannot prove that all owned private ledger data
  // has custody. Unassociated bodies cannot be assigned to a document (or org),
  // so fail closed actor-wide, or globally for an organization selector. A
  // registered revision/head with the same actor preserves other-scope ledgers.
  const actorId="enrollment" in selected?selected.enrollment.actor_user_id:"actorUserId" in selected?selected.actorUserId:null;
  const noOrphans:MemorySqlGuard={condition:`NOT EXISTS(SELECT 1 FROM private_content body WHERE body.kind='${structuredKind}'
    ${actorId===null?"":"AND body.owner_id=?"} AND (body.content!='' OR body.redacted_at IS NULL
      OR EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=body.content_id)
      OR EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=body.content_id))
    AND NOT EXISTS(SELECT 1 FROM ${structuredRevisions} revision JOIN ${structuredHeads} head ON head.ledger_id=revision.ledger_id
      WHERE revision.body_ref=body.content_id AND head.actor_user_id=body.owner_id))`,bindings:actorId===null?[]:[actorId]};
  const orphanEvidence=structuredClone(await db.prepare(`SELECT CASE WHEN ${noOrphans.condition} THEN 1 ELSE 0 END AS empty`).bind(...noOrphans.bindings).all<StructuredLedgerRow>());
  if(!structuredResults([orphanEvidence],1)||orphanEvidence.results.length!==1||orphanEvidence.results[0].empty!==1)
    throw new Error("memory-structured-withdrawal-unavailable");
  // Reuse every existing schema assertion, including the caller's terminal
  // assertion after its own writes, so late orphan creation cannot confirm erase.
  const schemaAssertion=()=>memorySqlAssertion(env,{condition:`(${schema.guard.condition}) AND (${noOrphans.condition})`,
    bindings:[...schema.guard.bindings,...noOrphans.bindings]});
  const query=structuredRetirementQuery(where),captured=structuredClone(await db.batch<StructuredLedgerRow>([db.prepare(query.sql).bind(...query.bindings)]));
  if (!structuredResults(captured,1)||captured[0].results.length!==1) throw new Error("memory-structured-retirement-unavailable");
  const state=structuredRetirementRows(captured[0].results[0]);
  if (!state) throw new Error("memory-structured-retirement-unavailable");
  for (const head of state.heads) {
    const id=await memoryDigest(canonicalConsent([head.actor_user_id,head.owner_user_id,head.organization_id,head.project_access_id,head.project_id,head.document_id]));
    if (id!==head.ledger_id||nativeMemoryTimestamp(head.created_at)===null||String(head.created_at)>now) throw new Error("memory-structured-retirement-invalid");
  }
  const removable=state.rows.filter(row=>row.held===0),remaining=state.rows.filter(row=>row.held===1);
  const terminal=state.heads.map(head=>structuredRetiredHead(head,now,remaining.some(row=>(row.revision as StructuredLedgerRow).ledger_id===head.ledger_id)));
  const bodyIds=JSON.stringify(removable.map(row=>(row.revision as StructuredLedgerRow).body_ref));
  const headIds=JSON.stringify(state.heads.map(head=>head.ledger_id));
  const resourceRows=JSON.stringify(removable.flatMap(row=>row.resources as StructuredLedgerRow[]));
  const retentionRows=JSON.stringify(removable.flatMap(row=>row.retentions as StructuredLedgerRow[]));
  const custodyMatch=(table:string,columns:string[])=>`EXISTS(SELECT 1 FROM json_each(?) expected WHERE (${columns.map(column=>`${table}.${column}`).join(",")})
    IS (${columns.map(column=>`json_extract(expected.value,'$.${column}')`).join(",")}))`;
  // Keep the original assignment scope after deleting its sidecar: a newly added
  // hold must still abort the transaction, rather than disappearing with our own DELETE.
  const holdGuard:MemorySqlGuard={condition:`NOT EXISTS(SELECT 1 FROM json_each(?) assigned JOIN organization_legal_holds hold
    ON hold.organization_id=json_extract(assigned.value,'$.organization_id') AND hold.status='active'
    WHERE hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=json_extract(assigned.value,'$.project_access_id')
      OR hold.scope_kind='content' AND hold.resource_id=json_extract(assigned.value,'$.content_id'))`,bindings:[JSON.stringify(removable.flatMap(row=>{const revision=row.revision as StructuredLedgerRow,head=state.heads.find(head=>head.ledger_id===revision.ledger_id)!;
      return head.organization_id===null?[]:[{organization_id:head.organization_id,project_access_id:head.project_access_id,content_id:revision.body_ref}];}))]};
  const before=structuredMetadataAssertion(env,query,state.heads,state.rows);
  const headUpdate=db.prepare(`UPDATE ${structuredHeads} SET enrollment_id=NULL,enrollment_revision=NULL,permission_epoch=NULL,policy_version=NULL,
    current_body_ref=NULL,current_body_hash=NULL,annotation_count=NULL,coverage_after_sequence=NULL,coverage_through_sequence=NULL,expires_at=NULL,state='retiring',
    first_terminal_at=COALESCE(first_terminal_at,?),updated_at=? WHERE ledger_id IN(SELECT value FROM json_each(?))`).bind(now,now,headIds);
  const writes=[headUpdate,
    db.prepare(`UPDATE private_content SET content='',redacted_at=COALESCE(redacted_at,?) WHERE kind='${structuredKind}' AND content_id IN(SELECT value FROM json_each(?))
      AND EXISTS(SELECT 1 FROM ${structuredRevisions} revision JOIN ${structuredHeads} head ON head.ledger_id=revision.ledger_id
        WHERE revision.body_ref=private_content.content_id AND head.actor_user_id=private_content.owner_id)` ).bind(now,bodyIds),
    db.prepare(`DELETE FROM project_resource_scopes WHERE ${custodyMatch("project_resource_scopes",structuredResourceColumns)}`).bind(resourceRows),
    db.prepare(`DELETE FROM private_content_retention_scopes WHERE ${custodyMatch("private_content_retention_scopes",structuredRetentionColumns)}`).bind(retentionRows),
    db.prepare(`DELETE FROM ${structuredRevisions} WHERE ledger_id IN(SELECT value FROM json_each(?)) AND body_ref IN(SELECT value FROM json_each(?))`).bind(headIds,bodyIds),
    db.prepare(`UPDATE ${structuredHeads} SET state='retired',cleanup_turn=0 WHERE ledger_id IN(SELECT value FROM json_each(?))
      AND NOT EXISTS(SELECT 1 FROM ${structuredRevisions} revision WHERE revision.ledger_id=${structuredHeads}.ledger_id)`).bind(headIds)];
  // The native head/revision association is personal document custody; private_content
  // itself has no document column. Reject contradictory registered head associations.
  // Redaction is deliberately not an admission field: the existing privacy caller
  // may already have blanked the same body earlier in this very transaction.
  const cleared=()=>memorySqlAssertion(env,{condition:`NOT EXISTS(SELECT 1 FROM json_each(?) target LEFT JOIN private_content body
      ON body.content_id=json_extract(target.value,'$.revision.body_ref') WHERE
        (json_extract(target.value,'$.body_exists')=0 AND body.content_id IS NOT NULL)
        OR (json_extract(target.value,'$.body_exists')=1 AND (body.content_id IS NULL OR body.content!='' OR body.redacted_at IS NULL
          OR NOT((body.owner_id,body.kind,body.created_at,body.expires_at) IS
            (json_extract(target.value,'$.body.owner_id'),json_extract(target.value,'$.body.kind'),json_extract(target.value,'$.body.created_at'),json_extract(target.value,'$.body.expires_at'))))))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) target JOIN ${structuredHeads} other ON other.current_body_ref=json_extract(target.value,'$.revision.body_ref')
      WHERE other.ledger_id!=json_extract(target.value,'$.revision.ledger_id'))
    AND NOT EXISTS(SELECT 1 FROM ${structuredRevisions} other WHERE other.body_ref IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id IN(SELECT value FROM json_each(?)))`,bindings:[JSON.stringify(removable),JSON.stringify(removable),bodyIds,bodyIds,bodyIds]});
  const after=()=>structuredMetadataAssertion(env,query,terminal,remaining);
  if (env.DB!==db||canonicalConsent(selector)!==key) throw new Error("memory-structured-preparation-changed");
  const statements=[schemaAssertion(),before,memorySqlAssertion(env,holdGuard),...writes,after(),cleared(),memorySqlAssertion(env,holdGuard),schemaAssertion()];
  return {statements,pendingRevisions:remaining.length,terminalAssertions:[after(),cleared(),memorySqlAssertion(env,holdGuard),schemaAssertion()],
    assertionIndexes:[0,1,2,statements.length-4,statements.length-3,statements.length-2,statements.length-1]};
}


// Cleanup trusts the native head/revision association, not arbitrary source text:
// private_content has no document column. An inconsistent registered association
// is deferred, never repaired by deleting a different document's private custody.
const structuredCanonicalTime=(sql:string)=>`(${sql} IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',${sql}) IS ${sql})`;
function structuredCleanupEligible(head:string,revision:string):string {
  const body=`${revision}.body_ref`;
  return `(${structuredMetadataReadable(revision,structuredRevisionColumns)}) AND ${structuredCanonicalTime(`${revision}.created_at`)} AND ${structuredCanonicalTime(`${revision}.expires_at`)}
    AND length(${body}) BETWEEN 1 AND 240
    AND NOT EXISTS(SELECT 1 FROM ${structuredHeads} other WHERE other.ledger_id!=${head}.ledger_id AND other.current_body_ref=${body})
    AND NOT ${structuredHeld(body)} AND NOT ${structuredScopeHeld(`${head}.organization_id`,`${head}.project_access_id`,body)}
    AND NOT EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=${body} AND
      (NOT(${structuredMetadataReadable("content",structuredBodyColumns.filter(column=>column!=="content"&&column!=="redacted_at"))}) OR content.owner_id!=${head}.actor_user_id OR content.kind!='${structuredKind}' OR content.created_at IS NOT ${revision}.created_at
        OR NOT ${structuredCanonicalTime("content.expires_at")} OR content.expires_at>${revision}.expires_at))
    AND (SELECT COUNT(*) FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=${body})<=1
    AND (SELECT COUNT(*) FROM private_content_retention_scopes retention WHERE retention.content_id=${body})<=1
    AND (${head}.organization_id IS NULL AND
      NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=${body})
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=${body})
      OR ${head}.organization_id IS NOT NULL
        AND (NOT EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=${body}) OR
          EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=${body})
          AND EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=${body}))
        AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=${body}
          AND (NOT(${structuredMetadataReadable("resource",structuredResourceColumns)}) OR NOT((resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id,resource.actor_user_id,resource.visibility,resource.created_at,resource.source_event_id)
            IS (${head}.project_access_id,${head}.organization_id,${head}.project_id,${head}.owner_user_id,${head}.actor_user_id,'actor_private',${revision}.created_at,NULL))))
        AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=${body}
          AND (NOT(${structuredMetadataReadable("retention",structuredRetentionColumns)}) OR NOT((retention.organization_id,retention.project_access_id,retention.project_id,retention.actor_user_id,retention.classification,retention.created_at)
            IS (${head}.organization_id,${head}.project_access_id,${head}.project_id,${head}.actor_user_id,'transient-private',${revision}.created_at))
            OR typeof(retention.policy_version)!='integer' OR retention.policy_version<0 OR retention.policy_version>9007199254740991
            OR NOT ${structuredCanonicalTime("retention.assigned_expires_at")} OR retention.assigned_expires_at>${revision}.expires_at)))`;
}
const structuredCleanupExpired=(head:string)=>`(${head}.expires_at<=? OR EXISTS(SELECT 1 FROM ${structuredRevisions} revision
  LEFT JOIN private_content content ON content.content_id=revision.body_ref
  LEFT JOIN private_content_retention_scopes retention ON retention.content_id=revision.body_ref
  WHERE revision.ledger_id=${head}.ledger_id AND (revision.expires_at<=? OR content.expires_at<=? OR retention.assigned_expires_at<=?)))`;
function structuredCleanupSelection(now:string) {
  return nativeMemoryDescriptor(`WITH candidates AS(SELECT head.ledger_id,head.created_at,head.first_terminal_at,head.cleanup_turn,
    CASE WHEN head.state='active' THEN 'fence' WHEN NOT EXISTS(SELECT 1 FROM ${structuredRevisions} revision WHERE revision.ledger_id=head.ledger_id)
      THEN 'finish' ELSE 'revision' END AS operation,
    (SELECT revision.revision FROM ${structuredRevisions} revision WHERE revision.ledger_id=head.ledger_id AND ${structuredCleanupEligible("head","revision")}
      ORDER BY revision.revision LIMIT 1) AS target_revision
    FROM ${structuredHeads} head WHERE (${structuredMetadataReadable("head",structuredHeadColumns)}) AND ${structuredCanonicalTime("head.created_at")} AND head.created_at<=?
      AND (head.state='active' AND ${structuredCleanupExpired("head")}
        OR head.state='retiring' AND (NOT EXISTS(SELECT 1 FROM ${structuredRevisions} revision WHERE revision.ledger_id=head.ledger_id)
          OR EXISTS(SELECT 1 FROM ${structuredRevisions} revision WHERE revision.ledger_id=head.ledger_id AND ${structuredCleanupEligible("head","revision")}))))
    SELECT ledger_id,operation,target_revision FROM candidates
      ORDER BY CASE WHEN cleanup_turn!=0 THEN 0 ELSE 1 END,COALESCE(first_terminal_at,created_at),ledger_id LIMIT 1`,[now,now,now,now,now]);
}
const structuredStrayBodies=`EXISTS(SELECT 1 FROM private_content body WHERE body.kind='${structuredKind}'
  AND (body.content!='' OR body.redacted_at IS NULL OR EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=body.content_id)
    OR EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=body.content_id))
  AND NOT EXISTS(SELECT 1 FROM ${structuredRevisions} revision WHERE revision.body_ref=body.content_id))`;
const structuredCleanupUnavailable=()=>`(${structuredStrayBodies}
  OR EXISTS(SELECT 1 FROM ${structuredHeads} head WHERE (head.state='retiring' OR head.state='active' AND ${structuredCleanupExpired("head")})
    AND (NOT(${structuredMetadataReadable("head",structuredHeadColumns)}) OR NOT ${structuredCanonicalTime("head.created_at")}))
  OR EXISTS(SELECT 1 FROM ${structuredHeads} head JOIN ${structuredRevisions} revision ON revision.ledger_id=head.ledger_id
    WHERE head.state='retired' OR (head.state='retiring' OR head.state='active' AND ${structuredCleanupExpired("head")})
      AND NOT ${structuredHeld("revision.body_ref")} AND NOT ${structuredScopeHeld("head.organization_id","head.project_access_id","revision.body_ref")}
      AND NOT(${structuredCleanupEligible("head","revision")})))`;
async function structuredCleanupAbsent(env:WorkerEnv):Promise<void> {
  const result=structuredClone(await env.DB.prepare(`SELECT EXISTS(SELECT 1 FROM private_content WHERE kind='${structuredKind}') AS stray`).all<StructuredLedgerRow>());
  if (!structuredResults([result],1)||result.results.length!==1||result.results[0].stray!==0) throw new Error("memory-structured-cleanup-unavailable");
}
function structuredCleanupHoldGuard(head:StructuredLedgerRow,row:StructuredLedgerRow|null):MemorySqlGuard {
  // Scope is retained independently of sidecar deletion, including a missing body
  // whose valid native revision still identifies the original shared document.
  if (!row || head.organization_id===null) return {condition:"1",bindings:[]};
  return {condition:`NOT EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=? AND hold.status='active'
    AND (hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=? OR hold.scope_kind='content' AND hold.resource_id=?))`,
    bindings:[String(head.organization_id),String(head.project_access_id),String((row.revision as StructuredLedgerRow).body_ref)]};
}
function structuredCleanupBodyCleared(env:WorkerEnv,head:StructuredLedgerRow,row:StructuredLedgerRow):D1PreparedStatement {
  const revision=row.revision as StructuredLedgerRow,body=row.body as StructuredLedgerRow|null;
  const expected=body?`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='${structuredKind}'
    AND created_at IS ? AND expires_at IS ? AND content='' AND redacted_at IS NOT NULL)`:`NOT EXISTS(SELECT 1 FROM private_content WHERE content_id=?)`;
  return memorySqlAssertion(env,{condition:`${expected}
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?)
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=?)
    AND NOT EXISTS(SELECT 1 FROM ${structuredHeads} WHERE ledger_id!=? AND current_body_ref=?)
    AND NOT EXISTS(SELECT 1 FROM ${structuredRevisions} WHERE body_ref=?)`,
    bindings:[...(body?[String(revision.body_ref),String(head.actor_user_id),String(body.created_at),String(body.expires_at)]:[String(revision.body_ref)]),
      String(revision.body_ref),String(revision.body_ref),String(head.ledger_id),String(revision.body_ref),String(revision.body_ref)]});
}
/** Read-only preparation. The returned methods are internal retention work, not
 * user authority or a general SQL execution API. Runtime supplies one eligible
 * ordinary UPDATE; a stale/unknown commit fails without reusing its allowance. */
export async function prepareStructuredConversationRetentionStep(env:WorkerEnv,input:{now:string}):Promise<null|{
  nextClass:number;oldest:string;commitOrdinary(classIndex:number,statement:D1PreparedStatement):Promise<0|1>;commitLedger():Promise<0|1>;
  commitOrigin(step:NonNullable<Awaited<ReturnType<typeof import("./memory-native-origin.ts").prepareNativeStructuredOriginRetentionStep>>>):Promise<0|1>;
}> {
  const db=env.DB,now=input.now;
  if (nativeMemoryTimestamp(now)===null) throw new Error("memory-structured-cleanup-invalid");
  const schema=await structuredConversationLedgerSchema(env);
  if (!schema.present) {await structuredCleanupAbsent(env);return null;}
  const selection=structuredCleanupSelection(now),selected=structuredClone(await db.prepare(selection.sql).bind(...selection.bindings).all<StructuredLedgerRow>());
  if (!structuredResults([selected],1)||selected.results.length>1) throw new Error("memory-structured-cleanup-unavailable");
  if (!selected.results.length) {
    // Held data is intentionally pending. Unheld malformed targets/stray bodies
    // must not be reported as a successfully empty sweep after other work drains.
    const pending=structuredClone(await db.prepare(`SELECT CASE WHEN ${structuredCleanupUnavailable()}
      THEN 1 ELSE 0 END AS unavailable`).bind(now,now,now,now,now,now,now,now).all<StructuredLedgerRow>());
    if (!structuredResults([pending],1)||pending.results.length!==1||pending.results[0].unavailable!==0) throw new Error("memory-structured-cleanup-unavailable");
    return null;
  }
  const candidate=selected.results[0];
  if (!structuredKeys(candidate,["ledger_id","operation","target_revision"])||!structuredHash(candidate.ledger_id)
    || !["fence","revision","finish"].includes(String(candidate.operation))) throw new Error("memory-structured-cleanup-unavailable");
  const query=structuredRetirementQuery({condition:"ledger_id=?",bindings:[candidate.ledger_id]}),captured=structuredClone(await db.prepare(query.sql).bind(...query.bindings).all<StructuredLedgerRow>());
  if (!structuredResults([captured],1)||captured.results.length!==1) throw new Error("memory-structured-cleanup-unavailable");
  // An invalid sibling must not prevent cleanup of another proven revision. Keep
  // every bounded sibling projection in the before/after metadata assertion;
  // unavailable scalar markers never qualify as this unit's physical target.
  // Validate the selected target with the same exact custody parser.
  const raw=captured.results[0];
  if (typeof raw.heads_json!=="string"||typeof raw.rows_json!=="string"||structuredBytes(raw)>2_097_152) throw new Error("memory-structured-cleanup-unavailable");
  const heads:unknown=JSON.parse(raw.heads_json),rows:unknown=JSON.parse(raw.rows_json);
  if (!Array.isArray(heads)||heads.length!==1||!structuredKeys(heads[0],structuredHeadColumns)||!Array.isArray(rows)||rows.length>64) throw new Error("memory-structured-cleanup-unavailable");
  const head=heads[0],allRows=rows as StructuredLedgerRow[];
  const target=candidate.operation==="revision"?allRows.find(row=>structuredObject(row.revision)&&row.revision.revision===candidate.target_revision)??null:null;
  if (candidate.operation==="revision" && (!target||!structuredRetirementRows({heads_json:JSON.stringify(heads),rows_json:JSON.stringify([target])})||target.held!==0)
    || candidate.operation==="fence"&&head.state!=="active" || candidate.operation==="finish"&&(head.state!=="retiring"||allRows.length))
    throw new Error("memory-structured-cleanup-unavailable");
  if (env.DB!==db||input.now!==now) throw new Error("memory-structured-preparation-changed");
  let consumed=false;
  const exactSelection=()=>memorySqlAssertion(env,{condition:`EXISTS(SELECT 1 FROM (${selection.sql}) selected WHERE
    (selected.ledger_id,selected.operation,selected.target_revision) IS (?,?,?))`,bindings:[...selection.bindings,String(candidate.ledger_id),String(candidate.operation),candidate.target_revision as number|null]});
  const commit=async(classIndex:number,ordinary:D1PreparedStatement|null):Promise<0|1>=>{
    if (consumed||env.DB!==db||input.now!==now||!Number.isInteger(classIndex)||classIndex<0||classIndex>3||Boolean(ordinary)!==(classIndex!==3))
      throw new Error("memory-structured-cleanup-stale");
    consumed=true;
    const holdGuard=structuredCleanupHoldGuard(head,target),statements:D1PreparedStatement[]=[],assertions:number[]=[],writes:{index:number;maximum:number;exact:boolean}[]=[];
    const prove=(statement:D1PreparedStatement)=>{assertions.push(statements.length);statements.push(statement);};
    const write=(statement:D1PreparedStatement,maximum=1,exact=true)=>{writes.push({index:statements.length,maximum,exact});statements.push(statement);
      prove(memorySqlAssertion(env,{condition:exact?"changes()=1":`changes() BETWEEN 0 AND ${maximum}`,bindings:[]}));};
    prove(memorySqlAssertion(env,schema.guard));prove(exactSelection());prove(structuredMetadataAssertion(env,query,[head],allRows));
    if (!ordinary) prove(memorySqlAssertion(env,holdGuard));
    let nextHead:StructuredLedgerRow,remaining=allRows;
    if (ordinary) {
      write(ordinary);
      nextHead={...head,cleanup_turn:(classIndex+1)%4,updated_at:now};
    } else if (candidate.operation==="fence") {
      nextHead={...structuredRetiredHead(head,now,true),cleanup_turn:0};
    } else if (candidate.operation==="finish") {
      nextHead=structuredRetiredHead(head,now,false);
    } else {
      const row=target!,revision=row.revision as StructuredLedgerRow,body=row.body as StructuredLedgerRow|null;
      if (body) write(db.prepare(`UPDATE private_content SET content='',redacted_at=COALESCE(redacted_at,?)
        WHERE content_id=? AND owner_id=? AND kind='${structuredKind}' AND created_at IS ? AND expires_at IS ?`)
        .bind(now,revision.body_ref,head.actor_user_id,body.created_at,body.expires_at));
      for (const resource of row.resources as StructuredLedgerRow[]) write(db.prepare(`DELETE FROM project_resource_scopes WHERE
        (${structuredResourceColumns.join(",")}) IS (${structuredResourceColumns.map(()=>"?").join(",")})`).bind(...structuredResourceColumns.map(column=>resource[column] as string|number|null)));
      for (const retention of row.retentions as StructuredLedgerRow[]) write(db.prepare(`DELETE FROM private_content_retention_scopes WHERE
        (${structuredRetentionColumns.join(",")}) IS (${structuredRetentionColumns.map(()=>"?").join(",")})`).bind(...structuredRetentionColumns.map(column=>retention[column] as string|number|null)));
      write(db.prepare(`DELETE FROM ${structuredRevisions} WHERE (${structuredRevisionColumns.join(",")}) IS (${structuredRevisionColumns.map(()=>"?").join(",")})`)
        .bind(...structuredRevisionColumns.map(column=>revision[column] as string|number|null)));
      remaining=allRows.filter(row=>row!==target);nextHead={...head,cleanup_turn:0,updated_at:now};
    }
    write(db.prepare(`UPDATE ${structuredHeads} SET ${structuredHeadColumns.filter(column=>column!=="ledger_id").map(column=>`${column}=?`).join(",")}
      WHERE (${structuredHeadColumns.join(",")}) IS (${structuredHeadColumns.map(()=>"?").join(",")})`)
      .bind(...structuredHeadColumns.filter(column=>column!=="ledger_id").map(column=>nextHead[column] as string|number|null),...structuredHeadColumns.map(column=>head[column] as string|number|null)));
    prove(structuredMetadataAssertion(env,query,[nextHead],remaining));
    if (!ordinary) {if(target)prove(structuredCleanupBodyCleared(env,head,target));prove(memorySqlAssertion(env,holdGuard));}
    prove(memorySqlAssertion(env,schema.guard));
    if (writes.length>(ordinary?2:5)) throw new Error("memory-structured-cleanup-unit-invalid");
    try {
      const results=structuredClone(await db.batch<StructuredLedgerRow>(statements));
      if (env.DB!==db||input.now!==now||!structuredResults(results,statements.length)||!structuredAsserted(results,assertions,"verified")
        || writes.some(write=>{
          const changes=results[write.index]?.meta?.changes;
          return typeof changes!=="number"||!Number.isSafeInteger(changes)||changes<0
            || changes>write.maximum || write.exact&&changes!==1;
        }))
        throw new Error("memory-structured-cleanup-unconfirmed");
      return 1;
    } catch(error) {throw new Error("memory-structured-cleanup-unconfirmed",{cause:error});}
  };
  const commitOrigin=async(step:NonNullable<Awaited<ReturnType<typeof import("./memory-native-origin.ts").prepareNativeStructuredOriginRetentionStep>>>):Promise<0|1>=>{
    // A source-issued origin unit shares the existing class-3 allowance. Its
    // availability/body/dependency assertions follow this ledger's cursor write,
    // so no mutation follows the origin's final physical-cleanup/hold proof.
    if(consumed||env.DB!==db||input.now!==now||!step||step.workUnits!==1||nativeMemoryTimestamp(step.oldest)===null
      ||!structuredId(step.selectionKey)||!Array.isArray(step.statements)||!step.statements.length||typeof step.acknowledge!=="function")
      throw new Error("memory-structured-cleanup-stale");
    consumed=true;
    const nextHead={...head,cleanup_turn:0,updated_at:now};
    const before=[memorySqlAssertion(env,schema.guard),exactSelection(),structuredMetadataAssertion(env,query,[head],allRows)];
    const originStatements=step.statements.map(value=>db.prepare(value.sql).bind(...value.bindings));
    const cursor=db.prepare(`UPDATE ${structuredHeads} SET cleanup_turn=0,updated_at=?
      WHERE (${structuredHeadColumns.join(",")}) IS (${structuredHeadColumns.map(()=>"?").join(",")})`)
      .bind(now,...structuredHeadColumns.map(column=>head[column] as string|number|null));
    const after=[structuredMetadataAssertion(env,query,[nextHead],allRows),memorySqlAssertion(env,schema.guard)];
    const cursorIndex=before.length,originOffset=cursorIndex+2;
    const statements=[...before,cursor,memorySqlAssertion(env,{condition:"changes()=1",bindings:[]}),...originStatements,...after];
    try {
      const results=structuredClone(await db.batch<StructuredLedgerRow>(statements));
      if(env.DB!==db||input.now!==now||!structuredResults(results,statements.length)
        ||!structuredAsserted(results,[0,1,2,cursorIndex+1,...after.map((_,index)=>originOffset+originStatements.length+index)],"verified")
        ||results[cursorIndex]?.meta?.changes!==1||!step.acknowledge(results.slice(originOffset,originOffset+originStatements.length)))
        throw new Error("memory-structured-cleanup-unconfirmed");
      return 1;
    }catch(error){throw new Error("memory-structured-cleanup-unconfirmed",{cause:error});}
  };
  return Object.freeze({nextClass:Number(head.cleanup_turn),oldest:String(head.first_terminal_at??head.created_at),
    commitOrdinary:(classIndex:number,statement:D1PreparedStatement)=>commit(classIndex,statement),commitLedger:()=>commit(3,null),commitOrigin});
}
/** Eligible defined work units, not physical rows or a claim that held data vanished. */
export async function structuredConversationRetentionBacklog(env:WorkerEnv,input:{now:string}):Promise<{count:number;oldest:string|null}> {
  const db=env.DB,now=input.now;
  if(nativeMemoryTimestamp(now)===null)throw new Error("memory-structured-cleanup-invalid");
  const schema=await structuredConversationLedgerSchema(env);
  if(!schema.present){await structuredCleanupAbsent(env);return {count:0,oldest:null};}
  const result=structuredClone(await db.prepare(`WITH pending AS(SELECT head.ledger_id,head.state,COALESCE(head.first_terminal_at,head.expires_at,head.created_at) AS oldest,
    (SELECT COUNT(*) FROM ${structuredRevisions} revision WHERE revision.ledger_id=head.ledger_id) AS total,
    (SELECT COUNT(*) FROM ${structuredRevisions} revision WHERE revision.ledger_id=head.ledger_id AND ${structuredCleanupEligible("head","revision")}) AS eligible
    FROM ${structuredHeads} head WHERE (${structuredMetadataReadable("head",structuredHeadColumns)}) AND ${structuredCanonicalTime("head.created_at")}
      AND (head.state='retiring' OR head.state='active' AND ${structuredCleanupExpired("head")})),
    work AS(SELECT *,eligible+CASE WHEN state='active' THEN 1 ELSE 0 END+CASE WHEN total=eligible THEN 1 ELSE 0 END AS units FROM pending)
    SELECT COALESCE(SUM(units),0) AS count,MIN(CASE WHEN units>0 THEN oldest ELSE NULL END) AS oldest,
      CASE WHEN ${structuredCleanupUnavailable()} THEN 1 ELSE 0 END AS stray FROM work`).bind(now,now,now,now,now,now,now,now,now,now,now,now).all<StructuredLedgerRow>());
  if(env.DB!==db||input.now!==now||!structuredResults([result],1)||result.results.length!==1||!structuredKeys(result.results[0],["count","oldest","stray"]))throw new Error("memory-structured-cleanup-unavailable");
  const row=result.results[0];
  if(row.stray!==0||typeof row.count!=="number"||!Number.isSafeInteger(row.count)||row.count<0||row.oldest!==null&&nativeMemoryTimestamp(row.oldest)===null)throw new Error("memory-structured-cleanup-unavailable");
  return {count:row.count,oldest:row.oldest as string|null};
}


export type StructuredConversationCleanupStatus = Readonly<{
  scopeKey:string|null;state:"unreported"|"absent"|"active"|"pending"|"complete";
}>;
/** Actor-owned privacy metadata only. No recall/learning/project capability is
 * fabricated or required to inspect withdrawal after access loss. The server's
 * genuine signed-in principal snapshot and full current enrollment rows still
 * have to survive the final native guarded read. A status is observed persisted
 * state, not retroactive confirmation of an earlier ambiguous write receipt. */
export async function readStructuredConversationCleanupStatuses(env:WorkerEnv,actor:PilotUser,
  enrollments:readonly LiveMemoryEnrollment[]):Promise<readonly StructuredConversationCleanupStatus[]|null> {
  try {
    if(!Array.isArray(enrollments)||enrollments.length>50)return null;
    const originalActor=structuredClone(actor),originalRows=structuredClone(enrollments),actorKey=canonicalConsent(actor),rowsKey=canonicalConsent(enrollments),db=env.DB;
    const snapshot=originalActor.authorizationSnapshot;
    if(!snapshot||originalActor.fictional||!structuredId(originalActor.userId)||!["admin","creator","viewer"].includes(originalActor.role)
      ||originalRows.some(row=>!structuredKeys(row,structuredEnrollmentColumns)||row.actor_user_id!==originalActor.userId)
      ||new Set(originalRows.map(row=>row.enrollment_id)).size!==originalRows.length||structuredBytes(originalRows)>1_048_576)return null;
    const fresh=()=>env.DB===db&&canonicalConsent(actor)===actorKey&&canonicalConsent(enrollments)===rowsKey;
    const schema=await structuredConversationLedgerSchema(env);
    if(!fresh())return null;
    const originSchema=await nativeStructuredOriginSchema(env);
    if(!fresh())return null;
    const job=await readNativeDocumentJobOriginCleanupCoverage(env,new Date().toISOString());
    if(!job||!fresh())return null;
    const jobRows=structuredJobCoverageText(job);
    const originIntegrity=originSchema.present?nativeStructuredOriginMinimizedIntegrity():{sql:"1",bindings:[]};
    const supplied=[] as {scopeKey:string;originScopeKey:string;enrollment:LiveMemoryEnrollment}[];
    for(const enrollment of originalRows){
      if(![enrollment.actor_user_id,enrollment.owner_user_id,enrollment.project_id,enrollment.document_id].every(structuredId)
        ||Boolean(enrollment.organization_id)!==Boolean(enrollment.project_access_id)
        ||enrollment.organization_id===null&&enrollment.actor_user_id!==enrollment.owner_user_id)return null;
      supplied.push({scopeKey:await memoryDigest(canonicalConsent(structuredScope(enrollment))),originScopeKey:structuredOriginScopeKey(enrollment),enrollment});
      if(!fresh())return null;
    }
    const principal:MemorySqlGuard={condition:`EXISTS(SELECT 1 FROM(${PRINCIPAL_WITH_ACCESS_SQL}) principal WHERE
      (principal.user_id,principal.role,principal.updated_at,principal.consent_version,COALESCE(principal.permission_epoch,''),
        COALESCE(principal.grants_json,'[]'),COALESCE(principal.organizations_json,'[]'),COALESCE(principal.projects_json,'[]'),
        COALESCE(principal.identity_policies_json,'[]'),COALESCE(principal.approved_canvas_requirements,0)) IS (?,?,?,?,?,?,?,?,?,?))`,
      bindings:[originalActor.userId,originalActor.userId,originalActor.role,snapshot.updatedAt,originalActor.consentVersion??null,
        snapshot.rawEpoch,snapshot.grants,snapshot.organizations,snapshot.projects,snapshot.identityPolicies,snapshot.canvasRequirements]};
    const matchScope=`(head.actor_user_id,head.owner_user_id,head.organization_id,head.project_access_id,head.project_id,head.document_id) IS
      (json_extract(supplied.value,'$.enrollment.actor_user_id'),json_extract(supplied.value,'$.enrollment.owner_user_id'),
       json_extract(supplied.value,'$.enrollment.organization_id'),json_extract(supplied.value,'$.enrollment.project_access_id'),
       json_extract(supplied.value,'$.enrollment.project_id'),json_extract(supplied.value,'$.enrollment.document_id'))`;
    const metadata=schema.present?`(SELECT json_group_array(json_object('ordinal',supplied.key,
      'heads',json((SELECT json_group_array(json(${structuredRetirementJsonRow("head",structuredHeadColumns)}))
        FROM(SELECT head.* FROM ${structuredHeads} head WHERE head.ledger_id=json_extract(supplied.value,'$.scopeKey') OR ${matchScope} ORDER BY head.ledger_id LIMIT 2) head)),
      'revision_count',(SELECT COUNT(*) FROM ${structuredRevisions} revision WHERE revision.ledger_id=json_extract(supplied.value,'$.scopeKey')),
      'tail_count',(SELECT COUNT(*) FROM ${structuredRevisions} revision JOIN ${structuredHeads} head ON head.ledger_id=revision.ledger_id
        WHERE head.ledger_id=json_extract(supplied.value,'$.scopeKey') AND revision.revision=head.storage_revision
          AND revision.body_ref=head.current_body_ref AND revision.body_hash=head.current_body_hash))) FROM(SELECT key,value FROM supplied ORDER BY key) supplied)`:`'[]'`;
    const orphan=schema.present?`EXISTS(SELECT 1 FROM private_content body WHERE body.owner_id=? AND body.kind='${structuredKind}'
      AND (body.content!='' OR body.redacted_at IS NULL OR EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=body.content_id)
        OR EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=body.content_id))
      AND NOT EXISTS(SELECT 1 FROM ${structuredRevisions} revision WHERE revision.body_ref=body.content_id))`:`0`;
    const originMetadata=`(SELECT json_group_array(json_object('ordinal',supplied.key,'pending',
      ${originSchema.present?`(SELECT COUNT(*) FROM memory_structured_answer_origins origin WHERE
        (origin.actor_user_id,origin.scope_key) IS
          (json_extract(supplied.value,'$.enrollment.actor_user_id'),json_extract(supplied.value,'$.originScopeKey'))
        AND (origin.status IN('withdrawn','minimized') OR origin.enrollment_id IS NOT json_extract(supplied.value,'$.enrollment.enrollment_id')
          OR origin.enrollment_revision IS NOT json_extract(supplied.value,'$.enrollment.revision')
          OR json_extract(supplied.value,'$.enrollment.recall_enabled') IS NOT 1)
        AND ${structuredOriginPending("origin")})`:"0"}
      +(SELECT COUNT(*) FROM ${structuredJobRows} origin WHERE
        (origin.actor_user_id,origin.scope_key) IS
          (json_extract(supplied.value,'$.enrollment.actor_user_id'),json_extract(supplied.value,'$.originScopeKey'))
        AND (origin.status IN('withdrawn','minimized') OR origin.enrollment_id IS NOT json_extract(supplied.value,'$.enrollment.enrollment_id')
          OR origin.enrollment_revision IS NOT json_extract(supplied.value,'$.enrollment.revision')
          OR json_extract(supplied.value,'$.enrollment.recall_enabled') IS NOT 1)
        AND ${structuredJobPending("origin")}))) FROM(SELECT key,value FROM supplied ORDER BY key) supplied)`;
    const originOrphan=structuredOriginOrphan(originSchema.present,originalActor.userId,jobRows);
    const query=nativeMemoryDescriptor(`WITH supplied AS(SELECT key,value FROM json_each(?))
      SELECT CASE WHEN (${schema.guard.condition}) AND (${originSchema.guard.condition}) AND (${principal.condition}) THEN 1 ELSE 0 END AS privacy_status_authorized,
        CASE WHEN NOT EXISTS(SELECT 1 FROM supplied LEFT JOIN memory_live_enrollments current
          ON (${structuredEnrollmentColumns.map(column=>`current.${column}`).join(",")}) IS
            (${structuredEnrollmentColumns.map(column=>`json_extract(supplied.value,'$.enrollment.${column}')`).join(",")})
          WHERE current.enrollment_id IS NULL) THEN 1 ELSE 0 END AS enrollments_current,
        ${metadata} AS statuses_json,${originMetadata} AS origin_statuses_json,
        CASE WHEN ${orphan} OR ${originOrphan.sql} OR NOT (${originIntegrity.sql}) THEN 1 ELSE 0 END AS contradictory_orphan`,
      [canonicalConsent(supplied),...schema.guard.bindings,...originSchema.guard.bindings,...principal.bindings,jobRows,
        ...(schema.present?[originalActor.userId]:[]),...originOrphan.bindings,...originIntegrity.bindings]);
    const statement=db.prepare(query.sql).bind(...query.bindings),result=structuredClone(await statement.all<StructuredLedgerRow>());
    if(!fresh()||!structuredResults([result],1)||result.results.length!==1)return null;
    const row=result.results[0];
    if(!structuredKeys(row,["privacy_status_authorized","enrollments_current","statuses_json","origin_statuses_json","contradictory_orphan"])
      ||row.privacy_status_authorized!==1||row.enrollments_current!==1||row.contradictory_orphan!==0||typeof row.statuses_json!=="string"
      ||typeof row.origin_statuses_json!=="string"||structuredBytes(row)>1_048_576)return null;
    const statusRows:unknown=JSON.parse(row.statuses_json),statuses:StructuredConversationCleanupStatus[]=[];
    if(!Array.isArray(statusRows)||statusRows.length!==(schema.present?supplied.length:0))return null;
    if(!schema.present)statuses.push(...supplied.map(()=>({scopeKey:null,state:"unreported" as const})));
    else for(let index=0;index<supplied.length;index++){
      const value=statusRows[index],expected=supplied[index];
      if(!structuredKeys(value,["ordinal","heads","revision_count","tail_count"])||value.ordinal!==index||!Array.isArray(value.heads)||value.heads.length>1
        ||typeof value.revision_count!=="number"||!Number.isSafeInteger(value.revision_count)||value.revision_count<0||value.revision_count>64
        ||typeof value.tail_count!=="number"||!Number.isSafeInteger(value.tail_count)||value.tail_count<0||value.tail_count>1)return null;
      if(value.heads.length===0){if(value.revision_count||value.tail_count)return null;statuses.push({scopeKey:expected.scopeKey,state:"absent"});continue;}
      const head=value.heads[0];
      if(!structuredKeys(head,structuredHeadColumns)||head.ledger_id!==expected.scopeKey
        ||canonicalConsent([head.actor_user_id,head.owner_user_id,head.organization_id,head.project_access_id,head.project_id,head.document_id])!==canonicalConsent(structuredScope(expected.enrollment))
        ||nativeMemoryTimestamp(head.created_at)===null||nativeMemoryTimestamp(head.updated_at)===null||String(head.created_at)>String(head.updated_at)
        ||Date.parse(String(head.updated_at))>Date.now()||typeof head.storage_revision!=="number"||!Number.isSafeInteger(head.storage_revision)||head.storage_revision<1
        ||typeof head.cleanup_turn!=="number"||!Number.isInteger(head.cleanup_turn)||head.cleanup_turn<0||head.cleanup_turn>3)return null;
      const activeFields=["enrollment_id","enrollment_revision","permission_epoch","policy_version","current_body_ref","current_body_hash","annotation_count",
        "coverage_after_sequence","coverage_through_sequence","expires_at"];
      if(head.state==="active"){
        if(head.first_terminal_at!==null||activeFields.some(field=>head[field]===null)||!structuredHash(head.current_body_hash)
          ||!structuredId(head.current_body_ref)||nativeMemoryTimestamp(head.expires_at)===null||value.revision_count!==head.storage_revision||value.tail_count!==1)return null;
        statuses.push({scopeKey:expected.scopeKey,state:"active"});
      }else if(head.state==="retiring"||head.state==="retired"){
        if(activeFields.some(field=>head[field]!==null)||nativeMemoryTimestamp(head.first_terminal_at)===null
          ||String(head.first_terminal_at)<String(head.created_at)||String(head.first_terminal_at)>String(head.updated_at)||value.revision_count>head.storage_revision||value.tail_count!==0
          ||head.state==="retired"&&(value.revision_count!==0||head.cleanup_turn!==0))return null;
        statuses.push({scopeKey:expected.scopeKey,state:head.state==="retiring"?"pending":"complete"});
      }else return null;
    }
    const originRows:unknown=JSON.parse(row.origin_statuses_json);
    if(!Array.isArray(originRows)||originRows.length!==supplied.length)return null;
    for(let index=0;index<originRows.length;index++){
      const value=originRows[index];
      if(!structuredKeys(value,["ordinal","pending"])||value.ordinal!==index||typeof value.pending!=="number"
        ||!Number.isSafeInteger(value.pending)||value.pending<0)return null;
      if(value.pending>0)statuses[index]={scopeKey:supplied[index].scopeKey,state:"pending"};
    }
    const witness=new AssistantContextReadWitness<null>(env);
    witness.observe([statement],[result],[query]);witness.seal(null);
    const assertions=[...job.assertions.map(query=>db.prepare(query.sql).bind(...query.bindings)),...witness.precommitStatements()];
    const final=structuredClone(await db.batch<StructuredLedgerRow>(assertions));
    if(!fresh()||!structuredResults(final,assertions.length)
      ||!structuredAsserted(final,job.assertions.map((_,index)=>index),"verified")
      ||!structuredAsserted(final,assertions.slice(job.assertions.length).map((_,index)=>job.assertions.length+index),"context_source_asserted"))return null;
    return structuredFreeze(statuses);
  }catch{return null;}
}

/** Source material for a native declared-context projection, not serialized
 * authorization. Only this module's issued object can supply publication proof. */
export type StructuredConversationContextSource = Readonly<{
  scope: Readonly<LegacyConversationOriginalReceipt["scope"]>;
  enrollmentId: string;
  enrollmentRevision: number;
  read: StructuredConversationLedgerRead;
  originals: readonly Readonly<LegacyConversationOriginalReceipt["originals"][number]>[];
  sourceHead: number;
  frameCount: number;
}>;
type StructuredConversationContextFrame = {
  env: WorkerEnv;
  db: WorkerEnv["DB"];
  plan: StructuredLedgerPreparation;
  sourceKey: string;
  inputsCurrent: () => boolean;
};
const structuredConversationContextFrames = new WeakMap<StructuredConversationContextSource, StructuredConversationContextFrame>();
function structuredConversationContextFrame(env: WorkerEnv, source: StructuredConversationContextSource) {
  const frame = structuredConversationContextFrames.get(source);
  if (!frame || frame.env !== env || frame.db !== env.DB || !frame.inputsCurrent() || !frame.plan.fresh()
    || frame.plan.read.status !== "active" || source.read !== frame.plan.read
    || canonicalConsent(source) !== frame.sourceKey) return null;
  return frame;
}

/** Authentic complete native assertions for a later consuming transaction.
 * Materializing statements is NOT database-currentness or a commit receipt.
 * The caller must run and strictly acknowledge them in its original DB batch.
 * There is deliberately NO own-answer-write exemption: changing captured source
 * head, enrollment or ledger still invalidates this proof. Existing answer-origin
 * publication needs a separately reviewed integration before these are usable
 * with newly persisted memory-derived answers. */
export function structuredConversationContextSourceStatements(env: WorkerEnv,
  source: StructuredConversationContextSource): D1PreparedStatement[] | null {
  try {
    const frame = structuredConversationContextFrame(env, source);
    if (!frame) return null;
    const statements = [...frame.plan.source.precommitStatements(), ...frame.plan.witness.precommitStatements(),
      ...frame.plan.source.precommitStatements(), frame.db.prepare(`SELECT CASE WHEN
        strftime('%Y-%m-%dT%H:%M:%fZ','now')<? THEN 1
        ELSE json('memory_structured_context_expired') END AS context_source_asserted`).bind(source.read.validUntil)];
    return structuredConversationContextFrame(env, source) === frame ? statements : null;
  } catch { return null; }
}

/** Read-only native replay; no new snapshot, original or deadline is minted.
 * Unknown/malformed acknowledgements return no context, never a prior ledger. */
export async function replayStructuredConversationContextSource(env: WorkerEnv,
  source: StructuredConversationContextSource): Promise<StructuredConversationContextSource | null> {
  try {
    const frame = structuredConversationContextFrame(env, source);
    if (!frame) return null;
    const statements = structuredConversationContextSourceStatements(env, source);
    if (!statements || !statements.length || structuredConversationContextFrame(env, source) !== frame) return null;
    const results = structuredClone(await frame.db.batch<StructuredLedgerRow>(statements));
    if (structuredConversationContextFrame(env, source) !== frame || !structuredResults(results, statements.length)
      || !structuredAsserted(results, statements.map((_, index) => index))) return null;
    return source;
  } catch { return null; }
}

/** Issue only from genuine S3 captures and the complete active S4 native ledger.
 * Existing recall permission is required; learning may remain paused. This does
 * not synthesize model MemoryAccess/fences or imply semantic completeness. */
export async function prepareStructuredConversationContextSource(env: WorkerEnv, enrollment: LiveMemoryEnrollment,
  prepared: LegacyConversationOriginalPrepared, captures: readonly LegacyConversationOriginalCapture[]): Promise<StructuredConversationContextSource | null> {
  let source: StructuredConversationContextSource | null = null;
  try {
    const db = env.DB;
    if (!Array.isArray(captures)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(captures, "length");
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 1 || lengthDescriptor.value > 32) return null;
    const captureLength: number = lengthDescriptor.value;
    const captureInput: LegacyConversationOriginalCapture[] = [];
    for (let index = 0; index < captureLength; index++) {
      const entry = Object.getOwnPropertyDescriptor(captures, String(index));
      if (!entry || !Object.hasOwn(entry, "value")) return null;
      captureInput[index] = entry.value;
    }
    // Bind the caller's original frame inventory before the first await, not
    // only the later source bridge's private copy. The handles remain genuine;
    // no receipt or original is reconstructed from their public fields. Bound
    // the copy before native reads and never invoke caller iterators or getters.
    const inputsCurrent = () => {
      if (env.DB !== db) return false;
      const length = Object.getOwnPropertyDescriptor(captures, "length");
      if (!length || !Object.hasOwn(length, "value") || length.value !== captureLength) return false;
      for (let index = 0; index < captureLength; index++) {
        const entry = Object.getOwnPropertyDescriptor(captures, String(index));
        if (!entry || !Object.hasOwn(entry, "value") || entry.value !== captureInput[index]) return false;
      }
      return true;
    };
    if (!inputsCurrent()) return null;
    const plan = await structuredPrepare(env, enrollment, prepared, captureInput, false);
    if (!inputsCurrent() || !plan || !plan.fresh() || plan.read.status !== "active") return null;
    source = structuredFreeze<StructuredConversationContextSource>({
      scope: structuredClone(plan.source.scope), enrollmentId: plan.enrollment.enrollment_id,
      enrollmentRevision: plan.enrollment.revision, read: plan.read,
      originals: structuredClone(plan.source.originals), sourceHead: plan.source.sourceHead, frameCount: plan.source.frameCount,
    });
    structuredConversationContextFrames.set(source, {env, db, plan, sourceKey: canonicalConsent(source), inputsCurrent});
    const observed = await replayStructuredConversationContextSource(env, source);
    if (observed !== source || !inputsCurrent() || !plan.fresh()) {
      structuredConversationContextFrames.delete(source);
      return null;
    }
    return source;
  } catch {
    if (source) structuredConversationContextFrames.delete(source);
    return null;
  }
}

// R6 selection is an independent metadata certificate. It is never attached to
// the already sealed page witness and never exempted for the caller's answer.
declare const nativeMemorySelectionProofType: unique symbol;
export type NativeMemorySelectionProof = Readonly<{[nativeMemorySelectionProofType]: true}>;
export type NativeMemorySelection = Readonly<{
  mode: "extractive" | "structured";
  proof: NativeMemorySelectionProof;
  enrollment: LiveMemoryEnrollment;
  ledgerId: string;
}>;
type NativeMemorySelectionFrame = {
  env: WorkerEnv; db: WorkerEnv["DB"]; value: NativeMemorySelection;
  witness: AssistantContextReadWitness<null>; preparedKey: string; authorityKey: string;
  prepared: NativeMemoryPreparedDocument; key: string; settings: string; validUntil: string;
  scope: NativeMemoryDocumentScope;
};
const nativeMemorySelectionFrames = new WeakMap<NativeMemorySelectionProof, NativeMemorySelectionFrame>();
function nativeMemorySelectionFrame(env: WorkerEnv, selection: NativeMemorySelection) {
  try {
    const frame = nativeMemorySelectionFrames.get(selection?.proof);
    return frame && frame.env === env && frame.db === env.DB && frame.value === selection
      && frame.preparedKey === canonicalConsent(frame.prepared) && frame.settings === structuredSettings(env)
      && frame.key === canonicalConsent([selection.mode, selection.enrollment, selection.ledgerId])
      && Date.now() < Date.parse(frame.validUntil) ? frame : null;
  } catch { return null; }
}
export function nativeMemorySelectionStatements(env: WorkerEnv, selection: NativeMemorySelection): D1PreparedStatement[] | null {
  try {
    const frame = nativeMemorySelectionFrame(env, selection);
    if (!frame) return null;
    const statements = [...frame.witness.precommitStatements(), frame.db.prepare(`SELECT CASE WHEN
      strftime('%Y-%m-%dT%H:%M:%fZ','now')<? THEN 1 ELSE json('memory_selection_expired') END AS context_source_asserted`)
      .bind(frame.validUntil)];
    return nativeMemorySelectionFrame(env, selection) === frame ? statements : null;
  } catch { return null; }
}
/** Metadata only; authorization remains the original selection's replayed proof. */
export function nativeMemorySelectionScope(env: WorkerEnv, selection: NativeMemorySelection): NativeMemoryDocumentScope | null {
  return nativeMemorySelectionFrame(env, selection)?.scope ?? null;
}
/** Matches only the exact assertion result slice actually executed by the caller.
 * A successful host check or materialized statement is not a database receipt. */
export function nativeMemorySelectionMatches(env: WorkerEnv, selection: NativeMemorySelection,
  results: readonly D1Result<StructuredLedgerRow>[]): boolean {
  try {
    const statements = nativeMemorySelectionStatements(env, selection);
    return !!statements && structuredResults(results as D1Result<StructuredLedgerRow>[], statements.length)
      && structuredAsserted(results as D1Result<StructuredLedgerRow>[], statements.map((_, index) => index));
  } catch { return false; }
}
export async function replayNativeMemorySelection(env: WorkerEnv, selection: NativeMemorySelection): Promise<NativeMemorySelection | null> {
  try {
    const frame = nativeMemorySelectionFrame(env, selection), statements = nativeMemorySelectionStatements(env, selection);
    if (!frame || !statements) return null;
    const results = structuredClone(await frame.db.batch<StructuredLedgerRow>(statements));
    return nativeMemorySelectionFrame(env, selection) === frame && nativeMemorySelectionMatches(env, selection, results) ? selection : null;
  } catch { return null; }
}

/** Genuine absence requires normal 0032, complete original request authority and
 * enrollment, and no scoped head/fence, orphan or contradictory v2 history.
 * Missing schema is unavailable, not proof that memory never existed. Selecting
 * structured metadata does not authorize its bodies: complete S3/S4/R5 admission
 * is still mandatory. A later failure must never fall back to extractive chat. */
export async function prepareNativeMemorySelection(env: WorkerEnv, prepared: NativeMemoryPreparedDocument): Promise<NativeMemorySelection | null> {
  let selection: NativeMemorySelection | null = null;
  try {
    const db = env.DB, captured = structuredClone(prepared), preparedKey = canonicalConsent(prepared), settings = structuredSettings(env);
    const { principal, binding } = captured, started = Date.now();
    const fresh = () => env.DB === db && canonicalConsent(prepared) === preparedKey && structuredSettings(env) === settings;
    if (!principal || !binding || !liveMemoryEnabled(env, principal.userId) || principal.fictional || !principal.authorizationSnapshot
      || principal.userId !== binding.actorUserId || principal.access.permissionEpoch !== binding.permissionEpoch
      || !structuredId(binding.projectId) || !structuredId(binding.documentId)
      || binding.streamId !== `creative:${binding.scope?.ownerUserId ?? principal.userId}`
      || binding.scope && (binding.scope.actorUserId !== principal.userId || binding.scope.projectId !== binding.projectId)) return null;
    const deadlines = [started + 60_000];
    const bound = (value: string | null | undefined) => {
      if (value === null) return;
      const at = nativeMemoryTimestamp(value);
      if (at === null || at <= started) throw new Error("memory-selection-expired");
      deadlines.push(at);
    };
    bound(nativeMemoryGrantDeadline(principal, started));
    const ledgerSchema = await structuredConversationLedgerSchema(env);
    if (!fresh() || !ledgerSchema.present) return null;
    const originSchema = await nativeStructuredOriginSchema(env);
    if (!fresh()) return null;
    const enrollmentQuery = nativeMemoryEnrollmentQuery(captured, LIVE_MEMORY_POLICY);
    const enrollmentResult = structuredClone(await db.prepare(enrollmentQuery.sql).bind(...enrollmentQuery.bindings).all<StructuredLedgerRow>());
    if (!fresh() || !structuredResults([enrollmentResult], 1) || enrollmentResult.results.length !== 1
      || !structuredKeys(enrollmentResult.results[0], structuredEnrollmentColumns)) return null;
    const e = structuredClone(enrollmentResult.results[0]) as unknown as LiveMemoryEnrollment;
    if (!structuredId(e.enrollment_id) || !Number.isSafeInteger(e.revision) || e.revision < 1
      || !Number.isSafeInteger(e.retention_days) || e.retention_days < 1 || e.retention_days > 365
      || nativeMemoryTimestamp(e.enrolled_at) === null || Date.parse(e.enrolled_at) > started
      || !Number.isSafeInteger(e.cursor_sequence) || e.cursor_sequence < 0
      || e.cutoff_sequence !== null && (!Number.isSafeInteger(e.cutoff_sequence) || e.cutoff_sequence < e.cursor_sequence)) return null;
    bound(e.expires_at);
    const authority = await liveMemoryAuthority(env, e);
    if (!fresh() || !authority || canonicalConsent(authority.binding.scope) !== canonicalConsent(binding.scope)) return null;
    bound(nativeMemoryGrantDeadline(authority.principal, started));
    const ledgerId = await memoryDigest(canonicalConsent(structuredScope(e)));
    if (!fresh()) return null;
    const recall = liveMemoryEnrollmentGuard(e, "recall"), request = executionAdmissionGuard(principal, binding, null);
    const configured = configuredPilotAdmissionGuard(env, principal);
    const originIntegrity=originSchema.present?nativeStructuredOriginMinimizedIntegrity():{sql:"1",bindings:[]};
    const queries = [enrollmentQuery, nativeMemoryDescriptor(`SELECT CASE WHEN
      (${ledgerSchema.guard.condition}) AND (${originSchema.guard.condition}) AND (${authority.guard.condition})
      AND (${recall.condition}) AND (${request.sql}) AND (${configured.sql}) AND (${originIntegrity.sql}) THEN 1 ELSE 0 END AS allowed`,
    [...ledgerSchema.guard.bindings, ...originSchema.guard.bindings, ...authority.guard.bindings,
      ...recall.bindings, ...request.bindings, ...configured.bindings,...originIntegrity.bindings])];
    const configuredId = env.FORMA_PILOT_COHORT_ID?.trim() ?? "";
    const breakglass = (env.FORMA_ADMIN_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).includes(principal.email.toLowerCase());
    const pilotIndex = configuredId && !breakglass ? queries.length : null;
    if (pilotIndex !== null) queries.push(nativeMemoryPilotQuery(configuredId));
    const sessionIndex = binding.contextSessionId ? queries.length : null;
    if (binding.contextSessionId) queries.push(nativeMemoryDescriptor(
      "SELECT context_id,principal_user_id,organization_id,project_access_id,expires_at,revoked_at FROM project_context_sessions WHERE context_id=?",
      [binding.contextSessionId]));
    // Head inventory includes terminal fences regardless of enrollment replacement.
    // A body without any trustworthy native revision has no document column, so
    // actor-wide orphan ambiguity denies; another correctly registered scope does not.
    const inventoryIndex = queries.length;
    const markedHistory = `EXISTS(SELECT 1 FROM events event WHERE event.stream_id=? AND event.actor=? AND event.type='AssistantReasoned'
      AND CASE WHEN json_valid(event.payload) THEN
        json_type(event.payload,'$.memory_origin_version') IS NOT NULL
        AND NOT(json_type(event.payload,'$.memory_origin_version')='integer' AND json_extract(event.payload,'$.memory_origin_version') IS 1)
        AND ((json_extract(event.payload,'$.project_id'),json_extract(event.payload,'$.document_id'),
          json_extract(event.payload,'$.organization_id'),json_extract(event.payload,'$.project_access_id')) IS (?,?,?,?)
          OR json_type(event.payload,'$.project_id') IS NOT 'text' OR json_type(event.payload,'$.document_id') IS NOT 'text'
          OR length(COALESCE(json_extract(event.payload,'$.project_id'),'')) NOT BETWEEN 1 AND 240
          OR length(COALESCE(json_extract(event.payload,'$.document_id'),'')) NOT BETWEEN 1 AND 240
          OR COALESCE(json_type(event.payload,'$.organization_id'),'missing') NOT IN('text','null')
          OR COALESCE(json_type(event.payload,'$.project_access_id'),'missing') NOT IN('text','null')
          OR NOT(json_type(event.payload,'$.organization_id')='null' AND json_type(event.payload,'$.project_access_id')='null'
            OR json_type(event.payload,'$.organization_id')='text' AND json_type(event.payload,'$.project_access_id')='text'
              AND length(json_extract(event.payload,'$.organization_id')) BETWEEN 1 AND 240
              AND length(json_extract(event.payload,'$.project_access_id')) BETWEEN 1 AND 240))
        ELSE 1 END)`;
    const orphanManifest = `EXISTS(SELECT 1 FROM private_content body WHERE body.owner_id=? AND body.kind='memory-structured-origin'
      ${originSchema.present ? "AND NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins origin WHERE origin.manifest_content_ref=body.content_id AND origin.actor_user_id=body.owner_id)" : ""})`;
    queries.push(nativeMemoryDescriptor(`WITH selected AS(SELECT * FROM ${structuredHeads}
      WHERE ledger_id=? OR ${structuredScopeWhere} LIMIT 2)
      SELECT (SELECT json_group_array(json(${structuredJsonRow("head", structuredHeadColumns)})) FROM selected head) AS heads_json,
        (SELECT COUNT(*) FROM ${structuredRevisions} WHERE ledger_id=? OR ledger_id IN(SELECT ledger_id FROM selected)) AS revision_count,
        CASE WHEN EXISTS(SELECT 1 FROM private_content body WHERE body.owner_id=? AND body.kind='${structuredKind}'
          AND (body.content!='' OR body.redacted_at IS NULL
            OR EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource_kind='content' AND resource_id=body.content_id)
            OR EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=body.content_id))
          AND NOT EXISTS(SELECT 1 FROM ${structuredRevisions} revision JOIN ${structuredHeads} head ON head.ledger_id=revision.ledger_id
            WHERE revision.body_ref=body.content_id AND head.actor_user_id=body.owner_id)) THEN 1 ELSE 0 END AS orphaned,
        CASE WHEN NOT EXISTS(SELECT 1 FROM selected) THEN
          ${originSchema.present ? `(SELECT COUNT(*) FROM memory_structured_answer_origins WHERE actor_user_id=? AND scope_key=?)+` : ""}
          ${markedHistory}+${orphanManifest} ELSE 0 END AS origin_count`,
    [ledgerId, ...structuredScope(e), ledgerId, e.actor_user_id, ...(originSchema.present ? [e.actor_user_id,structuredOriginScopeKey(e)] : []),
      binding.streamId,`user:${principal.userId}`,e.project_id,e.document_id,e.organization_id,e.project_access_id,e.actor_user_id]));
    const statements = queries.map(query => db.prepare(query.sql).bind(...query.bindings));
    const results = structuredClone(await db.batch<StructuredLedgerRow>([db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS checked_at"), ...statements]));
    if (!fresh() || !structuredResults(results, statements.length + 1) || results[0].results.length !== 1
      || !structuredKeys(results[0].results[0], ["checked_at"])) return null;
    const checked = nativeMemoryTimestamp(results[0].results[0].checked_at);
    if (checked === null || checked < started - 60_000) return null;
    deadlines.push(checked + 60_000);
    const capturedResults = results.slice(1);
    if (canonicalConsent(capturedResults[0].results) !== canonicalConsent(enrollmentResult.results)
      || capturedResults[1].results.length !== 1 || capturedResults[1].results[0].allowed !== 1) return null;
    if (pilotIndex !== null) bound(nativeMemoryPilotDeadline(capturedResults[pilotIndex].results, configuredId, checked));
    if (sessionIndex !== null) {
      const rows = capturedResults[sessionIndex].results;
      if (rows.length !== 1 || rows[0].context_id !== binding.contextSessionId || rows[0].principal_user_id !== principal.userId
        || rows[0].organization_id !== binding.scope?.organizationId || rows[0].project_access_id !== binding.scope?.projectAccessId
        || rows[0].revoked_at !== null) return null;
      bound(typeof rows[0].expires_at === "string" ? rows[0].expires_at : undefined);
    }
    const inventory = capturedResults[inventoryIndex].results;
    if (inventory.length !== 1 || !structuredKeys(inventory[0], ["heads_json", "revision_count", "orphaned", "origin_count"])
      || inventory[0].orphaned !== 0 || typeof inventory[0].heads_json !== "string"
      || typeof inventory[0].revision_count !== "number" || !Number.isSafeInteger(inventory[0].revision_count)
      || inventory[0].revision_count < 0 || inventory[0].revision_count > 64
      || typeof inventory[0].origin_count !== "number" || !Number.isSafeInteger(inventory[0].origin_count) || inventory[0].origin_count < 0) return null;
    const heads: unknown = JSON.parse(inventory[0].heads_json);
    if (!Array.isArray(heads) || heads.length > 1) return null;
    let mode: NativeMemorySelection["mode"];
    if (!heads.length) {
      if (inventory[0].revision_count !== 0 || inventory[0].origin_count !== 0) return null;
      mode = "extractive";
    } else {
      const head = heads[0];
      if (!structuredKeys(head, structuredHeadColumns) || head.ledger_id !== ledgerId || head.state !== "active" || head.first_terminal_at !== null
        || canonicalConsent(structuredHeadColumns.slice(1, 7).map(column => head[column])) !== canonicalConsent(structuredScope(e))
        || head.enrollment_id !== e.enrollment_id || head.enrollment_revision !== e.revision
        || head.permission_epoch !== e.permission_epoch || head.policy_version !== e.policy_version
        || head.storage_revision !== inventory[0].revision_count || !inventory[0].revision_count
        || !structuredId(head.current_body_ref) || !structuredHash(head.current_body_hash)
        || nativeMemoryTimestamp(head.created_at) === null || nativeMemoryTimestamp(head.updated_at) === null) return null;
      bound(typeof head.expires_at === "string" ? head.expires_at : undefined);
      mode = "structured";
    }
    const validUntil = new Date(Math.min(...deadlines)).toISOString();
    if (!fresh() || Date.now() >= Date.parse(validUntil)) return null;
    const witness = new AssistantContextReadWitness<null>(env);
    witness.observe(statements, capturedResults, queries);
    const scope = await observeNativeMemoryDocumentScope(env, captured, e, witness);
    if (!scope || !fresh()) return null;
    witness.before(validUntil); witness.seal(null);
    const proof = Object.freeze(Object.create(null)) as NativeMemorySelectionProof;
    selection = structuredFreeze({mode, proof, enrollment: e, ledgerId});
    nativeMemorySelectionFrames.set(proof, {env, db, value: selection, witness, prepared, preparedKey, scope,
      authorityKey: canonicalConsent({principal: captured.principal, binding: captured.binding}),
      settings, validUntil, key: canonicalConsent([mode, e, ledgerId])});
    if (await replayNativeMemorySelection(env, selection) !== selection) {
      nativeMemorySelectionFrames.delete(proof); return null;
    }
    return selection;
  } catch {
    if (selection) nativeMemorySelectionFrames.delete(selection.proof);
    return null;
  }
}

/** Discover only the complete retained ledger inventory, not a recent chat tail.
 * This query is bounded and does not itself grant source authority. Every saved
 * ref must subsequently match genuine S3 captures and full S4 validation. */
function structuredSavedIntervals(input:readonly LegacyConversationOriginalInterval[]):LegacyConversationOriginalInterval[]|null {
  if(!Array.isArray(input))return null;
  const size=Object.getOwnPropertyDescriptor(input,"length");
  if(!size||!Object.hasOwn(size,"value")||!Number.isSafeInteger(size.value)||size.value<1||size.value>32)return null;
  const result:LegacyConversationOriginalInterval[]=[];
  for(let index=0;index<size.value;index++){
    const entry=Object.getOwnPropertyDescriptor(input,String(index));
    if(!entry||!Object.hasOwn(entry,"value")||!structuredObject(entry.value)
      ||Reflect.ownKeys(entry.value).length!==2)return null;
    const after=Object.getOwnPropertyDescriptor(entry.value,"afterSequence"),through=Object.getOwnPropertyDescriptor(entry.value,"throughSequence");
    if(!after||!through||!Object.hasOwn(after,"value")||!Object.hasOwn(through,"value")
      ||!Number.isSafeInteger(after.value)||after.value<0||!Number.isSafeInteger(through.value)||through.value<=after.value)return null;
    result.push({afterSequence:after.value,throughSequence:through.value});
  }
  return result;
}
export async function discoverNativeStructuredConversationOriginals(env: WorkerEnv, prepared: LegacyConversationOriginalPrepared,
  selection: NativeMemorySelection, savedIntervals?:readonly LegacyConversationOriginalInterval[]): Promise<Readonly<{
    enrollment: LiveMemoryEnrollment; captures: readonly LegacyConversationOriginalCapture[];
    intervals: readonly LegacyConversationOriginalInterval[];
  }> | null> {
  try {
    // Saved intervals choose what to reread, not what is trustworthy. Bind their
    // original data-only inventory before the first await and issue new genuine
    // captures under today's authority and head. Nothing renews the saved lease.
    const selectedIntervals=savedIntervals===undefined?undefined:structuredSavedIntervals(savedIntervals);
    if(selectedIntervals===null)return null;
    const intervalKey=canonicalConsent(selectedIntervals??null);
    const intervalsCurrent=()=>savedIntervals===undefined?selectedIntervals===undefined
      :canonicalConsent(structuredSavedIntervals(savedIntervals))===intervalKey;
    const frame = nativeMemorySelectionFrame(env, selection), db = env.DB, preparedKey = canonicalConsent(prepared);
    const current = () => nativeMemorySelectionFrame(env, selection) === frame && env.DB === db && canonicalConsent(prepared) === preparedKey&&intervalsCurrent();
    if (!frame || selection.mode !== "structured" || !Number.isSafeInteger(prepared.sourceHead) || prepared.sourceHead < 1
      || canonicalConsent({principal: prepared.principal, binding: prepared.binding}) !== frame.authorityKey
      || await replayNativeMemorySelection(env, selection) !== selection || !current()) return null;
    const query = structuredHistoryQuery(selection.enrollment, selection.ledgerId, prepared.binding);
    const result = structuredClone(await db.prepare(query.sql).bind(...query.bindings).all<StructuredLedgerRow>());
    if (!current() || !structuredResults([result], 1) || result.results.length !== 1
      || result.results[0].alive !== 1 || typeof result.results[0].history_json !== "string"
      || typeof result.results[0].heads_json !== "string" || structuredBytes(result.results[0]) > 1_048_576) return null;
    const rows: unknown = JSON.parse(result.results[0].history_json), heads: unknown = JSON.parse(result.results[0].heads_json);
    if (!Array.isArray(rows) || !rows.length || rows.length > 64 || !Array.isArray(heads) || heads.length !== 1) return null;
    const refs = new Map<string, StructuredConversationOriginal>(), identities = new Map<string, string>();
    for (const row of rows) {
      if (!structuredKeys(row, ["revision", "body", "resources", "retentions"]) || !structuredKeys(row.body, structuredBodyColumns)
        || typeof row.body.content !== "string" || new TextEncoder().encode(row.body.content).byteLength > 131_072) return null;
      const body: unknown = JSON.parse(row.body.content);
      if (!structuredObject(body) || !Array.isArray(body.originals) || !body.originals.length || body.originals.length > 128) return null;
      for (const ref of body.originals) {
        if (!structuredKeys(ref, ["eventId", "sequence", "turnId", "role", "contentRef", "contentHash"])
          || !structuredId(ref.eventId) || !structuredId(ref.turnId) || !structuredId(ref.contentRef) || !structuredHash(ref.contentHash)
          || ref.role !== "user" && ref.role !== "assistant" || typeof ref.sequence !== "number" || !Number.isSafeInteger(ref.sequence)
          || ref.sequence < 1 || ref.sequence > prepared.sourceHead) return null;
        const encoded = canonicalConsent(ref), keys = ["event:" + ref.eventId, "content:" + ref.contentRef,
          "sequence:" + ref.sequence, "role:" + canonicalConsent([ref.turnId, ref.role])];
        if (keys.some(key => identities.has(key) && identities.get(key) !== encoded)) return null;
        for (const key of keys) identities.set(key, encoded);
        refs.set(ref.eventId, ref as unknown as StructuredConversationOriginal);
        if (refs.size > 128) return null;
      }
    }
    const originals = [...refs.values()].sort((a, b) => a.sequence - b.sequence);
    if (!originals.length) return null;
    // A ledger may cite only one role of a complete native turn. Discover its
    // actual paired native event by immutable turn identity, never by a guessed
    // adjacent sequence or an arbitrary recent window. S3 still validates every
    // per-role payload, cause, actor, body and custody before admission.
    const turnIds = [...new Set(originals.map(ref => ref.turnId))];
    const pairsResult = structuredClone(await db.prepare(`SELECT event_id,sequence,type,
      json_extract(payload,'$.turn_id') AS turn_id FROM events WHERE stream_id=?
      AND type IN('ChatMessageSent','AssistantReasoned') AND json_extract(payload,'$.document_id')=?
      AND json_extract(payload,'$.turn_id') IN(SELECT value FROM json_each(?)) ORDER BY sequence LIMIT 129`)
      .bind(prepared.binding.streamId, prepared.binding.documentId, JSON.stringify(turnIds)).all<StructuredLedgerRow>());
    if (!current() || !structuredResults([pairsResult], 1) || pairsResult.results.length !== turnIds.length * 2
      || pairsResult.results.length > 128 || !pairsResult.results.every(row => structuredKeys(row, ["event_id", "sequence", "type", "turn_id"])
        && structuredId(row.event_id) && structuredId(row.turn_id) && typeof row.sequence === "number" && Number.isSafeInteger(row.sequence)
        && row.sequence > 0 && row.sequence <= prepared.sourceHead && (row.type === "ChatMessageSent" || row.type === "AssistantReasoned"))) return null;
    if (!originals.every(ref => pairsResult.results.some(row => row.event_id === ref.eventId && row.sequence === ref.sequence
      && row.turn_id === ref.turnId && row.type === (ref.role === "user" ? "ChatMessageSent" : "AssistantReasoned")))) return null;
    const pairs: {afterSequence: number; throughSequence: number}[] = [];
    for (const turnId of turnIds) {
      const rows = pairsResult.results.filter(row => row.turn_id === turnId);
      if (rows.length !== 2 || rows[0].type !== "ChatMessageSent" || rows[1].type !== "AssistantReasoned"
        || Number(rows[0].sequence) >= Number(rows[1].sequence)) return null;
      pairs.push({afterSequence: Number(rows[0].sequence) - 1, throughSequence: Number(rows[1].sequence)});
    }
    pairs.sort((a, b) => a.afterSequence - b.afterSequence);
    const boundaries=pairs.map((pair,index)=>({ordinal:index,afterSequence:pair.afterSequence,
      previousThrough:index?pairs[index-1].throughSequence:pair.afterSequence}));
    const gapResult=structuredClone(await db.prepare(`SELECT CAST(candidate.key AS INTEGER) AS ordinal,
      CASE WHEN EXISTS(SELECT 1 FROM events event WHERE event.stream_id=?
        AND event.type IN('ChatMessageSent','AssistantReasoned')
        AND event.sequence>json_extract(candidate.value,'$.previousThrough')
        AND event.sequence<=json_extract(candidate.value,'$.afterSequence')) THEN 1 ELSE 0 END AS separated
      FROM json_each(?) candidate ORDER BY CAST(candidate.key AS INTEGER) LIMIT 65`)
      .bind(prepared.binding.streamId,JSON.stringify(boundaries)).all<StructuredLedgerRow>());
    if(!current()||!structuredResults([gapResult],1)||gapResult.results.length!==pairs.length
      ||!gapResult.results.every((row,index)=>structuredKeys(row,["ordinal","separated"])
        &&row.ordinal===index&&(row.separated===0||row.separated===1)))return null;
    let intervals: LegacyConversationOriginalInterval[] = [];
    let groupSize=0;
    for(let index=0;index<pairs.length;index++) {
      const pair=pairs[index];
      // Intervening chat belongs to a distinct interval even when it is old or
      // unreadable. Never widen a retained pair across an unrelated document.
      if(!intervals.length||groupSize===6||gapResult.results[index].separated===1){
        intervals.push({...pair});groupSize=1;
      }else{
        intervals[intervals.length-1].throughSequence=Math.max(intervals.at(-1)!.throughSequence,pair.throughSequence);groupSize++;
      }
    }
    if(selectedIntervals!==undefined)intervals=selectedIntervals;
    if(intervals.some(interval=>interval.throughSequence>prepared.sourceHead))return null;
    if (!intervals.length || intervals.length > 32) return null;
    const captures: LegacyConversationOriginalCapture[] = [];
    for (const interval of intervals) {
      if (!current()) return null;
      const capture = await captureLegacyConversationOriginals(env, prepared, interval);
      if (!capture || !current()) return null;
      captures.push(capture);
    }
    // Admission uses the same genuine frames, checks every old negative source,
    // and executes its exact history/source proof. Discovery cannot issue a value
    // on the strength of its initial untrusted body parsing alone.
    const source = await prepareStructuredConversationContextSource(env, selection.enrollment, prepared, captures);
    if (!source || !current() || !originals.every(ref => source.originals.some(original => canonicalConsent(structuredRef(original)) === canonicalConsent(ref)))
      || await replayNativeMemorySelection(env, selection) !== selection || !current()) return null;
    return structuredFreeze({enrollment: selection.enrollment, captures, intervals});
  } catch { return null; }
}

/** Read-only metadata from the exact private source frame. This object never
 * substitutes for source replay, the genuine context proof, or final assertions. */
export function structuredConversationContextSourceEvidence(env: WorkerEnv, source: StructuredConversationContextSource) {
  try {
    const frame = structuredConversationContextFrame(env, source);
    if (!frame || !frame.plan.history.head) return null;
    const originalEvidence = legacyConversationOriginalsEvidence(env, frame.plan.source);
    if (!originalEvidence) return null;
    const evidence = structuredFreeze({enrollment: structuredClone(frame.plan.enrollment), head: structuredClone(frame.plan.history.head),
      ledgerRevisions: structuredClone(frame.plan.history.rows), intervals: structuredClone(originalEvidence.intervals),
      sourceHead: source.sourceHead, validUntil: source.read.validUntil,
      sourceRetentionCeiling: new Date(Math.min(Date.parse(frame.plan.enrollment.expires_at),
        Date.parse(frame.plan.history.expiresAt!), ...source.originals.flatMap(original =>
          [Date.parse(original.expiresAt), Date.parse(original.recordedAt) + frame.plan.enrollment.retention_days * 86_400_000]))).toISOString()});
    return structuredConversationContextFrame(env, source) === frame ? evidence : null;
  } catch { return null; }
}

declare const structuredConversationOwnSendType: unique symbol;
export type StructuredConversationContextOwnSend = Readonly<{[structuredConversationOwnSendType]: true}>;
type StructuredConversationOwnSendFrame = {env: WorkerEnv; db: WorkerEnv["DB"]; source: StructuredConversationContextSource;
  frame: StructuredConversationContextFrame; sourceProof: LegacyConversationOriginalsOwnSend;
  own: AssistantStructuredOwnSendFootprint; ownKey: string};
const structuredConversationOwnSendFrames = new WeakMap<StructuredConversationContextOwnSend, StructuredConversationOwnSendFrame>();
function structuredConversationOwnSendFrame(env: WorkerEnv, proof: StructuredConversationContextOwnSend) {
  const own = structuredConversationOwnSendFrames.get(proof);
  return own && own.env === env && own.db === env.DB && structuredConversationContextFrame(env, own.source) === own.frame
    && canonicalConsent(copyAssistantStructuredOwnSendFootprint(own.own)) === own.ownKey ? own : null;
}
/** Separate final-only capability; issuance first requires the original strict
 * source assertions. Its genuine S3 successor recognizes only the server's exact
 * two-event/three-body footprint. No original witness or deadline is changed. */
export async function prepareStructuredConversationContextOwnSend(env: WorkerEnv, source: StructuredConversationContextSource,
  own: AssistantStructuredOwnSendFootprint): Promise<StructuredConversationContextOwnSend | null> {
  try {
    const ownKey=canonicalConsent(copyAssistantStructuredOwnSendFootprint(own));
    const ownCurrent=()=>canonicalConsent(copyAssistantStructuredOwnSendFootprint(own))===ownKey;
    const frame = structuredConversationContextFrame(env, source);
    if (!frame || await replayStructuredConversationContextSource(env, source) !== source
      || structuredConversationContextFrame(env, source) !== frame || !ownCurrent()) return null;
    const sourceProof = await prepareLegacyConversationOriginalsOwnSend(env, frame.plan.source, own);
    if (!sourceProof || structuredConversationContextFrame(env, source) !== frame || !ownCurrent()) return null;
    const proof = Object.freeze(Object.create(null)) as StructuredConversationContextOwnSend;
    structuredConversationOwnSendFrames.set(proof, {env, db: env.DB, source, frame, sourceProof,own,ownKey});
    return structuredConversationContextOwnSendStatements(env, proof) ? proof : null;
  } catch { return null; }
}
export function structuredConversationContextOwnSendStatements(env: WorkerEnv,
  proof: StructuredConversationContextOwnSend): D1PreparedStatement[] | null {
  try {
    const own = structuredConversationOwnSendFrame(env, proof);
    if (!own) return null;
    const sourceStatements = legacyConversationOriginalsOwnSendStatements(env, own.sourceProof);
    if (!sourceStatements?.length) return null;
    const statements = [...sourceStatements, ...own.frame.plan.witness.precommitStatements(), ...sourceStatements,
      own.db.prepare(`SELECT CASE WHEN strftime('%Y-%m-%dT%H:%M:%fZ','now')<? THEN 1
        ELSE json('memory_structured_own_context_expired') END AS context_source_asserted`).bind(own.source.read.validUntil)];
    return structuredConversationOwnSendFrame(env, proof) === own ? statements : null;
  } catch { return null; }
}
export async function replayStructuredConversationContextOwnSend(env: WorkerEnv,
  proof: StructuredConversationContextOwnSend): Promise<StructuredConversationContextSource | null> {
  try {
    const own = structuredConversationOwnSendFrame(env, proof), statements = structuredConversationContextOwnSendStatements(env, proof);
    if (!own || !statements) return null;
    const results = structuredClone(await own.db.batch<StructuredLedgerRow>(statements));
    if (structuredConversationOwnSendFrame(env, proof) !== own || !structuredResults(results, statements.length)
      || !structuredAsserted(results, statements.map((_, index) => index))) return null;
    return own.source;
  } catch { return null; }
}
