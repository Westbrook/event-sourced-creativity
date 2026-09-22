import { authenticateStudy, checkedBatch, assertion } from '../native-host/authority.mjs';
import { nativeMemoryAnswerExclusion } from '../../../worker/memory-native-boundary.ts';
import { privateContentScopeGuard, prepareBudgetReservation, prepareCostBudgetReservation } from '../../../worker/pilot-policy.ts';
import { validateFinancialPolicy } from '../native-host/financial-policy.mjs';
import { schemaRows } from './schema-contract.mjs';
import { externalGuard } from './external-guard.mjs';
import { canonical,hash,freeze } from '../core.mjs';
import { LIMITS,operationId,financialScope,validatePreparation,parseExact,inspectResponse,fail,integer } from './contract.mjs';
import { submitPreparation } from './transport.mjs';
const row=(db,id)=>db.prepare('SELECT * FROM generation_preparation_operations WHERE operation_id=?').bind(id).first();

/** Server construction only. No product import/route/CLI, key setup, schema installer or live enablement. */
export function createPreparationHost(env,{plan:input}){
  const plan=freeze(structuredClone(input)),db=env.DB;
  const unchanged=()=>{if(env.DB!==db)fail('preparation_database_changed');};
  async function access(request,grantId,{recovery=false}={}){
    unchanged();
    // Reuse actual Sites personal-administrator, pilot, authorization epoch and Memory boundary.
    const a=await authenticateStudy(request,env,{recovery:true});unchanged();
    const query="SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name GLOB 'generation_preparation_*' ORDER BY name";
    const rows=await db.prepare(query).all();
    if(rows.success!==true||JSON.stringify(rows.results)!==JSON.stringify(schemaRows))fail('preparation_schema_uninstalled');
    const schema={sql:`(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) FROM (${query}))=?`,bindings:[JSON.stringify(schemaRows)]};
    const grant=await db.prepare("SELECT * FROM generation_preparation_grants WHERE grant_id=? AND owner_id=? AND status='authorized' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(grantId,a.user.userId).first();
    if(!grant||grant.plan_id!==plan.id||grant.owner_id!==plan.payerId||grant.runtime_hash!==plan.runtimeHash||grant.authority_version!==plan.source.authorityVersion||grant.source_ref!==plan.source.ref||grant.source_hash!==plan.source.sha256||grant.config_json!==canonical(plan.config)||grant.source_provenance_json!==canonical(plan.source))fail('preparation_grant_unavailable');
    if(!recovery&&(canonical(env.FORMA_PREPARATION_CONFIG)!==canonical(plan.config)||env.FORMA_PREPARATION_RUNTIME_HASH!==plan.runtimeHash||env.FORMA_PREPARATION_CREDENTIAL_BINDING!==plan.config.credentialBinding||(env.OPENAI_MODEL??'gpt-5.6-terra')!==plan.config.model||(env.OPENAI_MODEL?'configured OPENAI_MODEL':'application-default')!==plan.config.modelBasis||(env.OPENAI_PROJECT??null)!==plan.config.projectHeader))fail('preparation_effective_config_changed');
    const grantGuard={sql:"EXISTS(SELECT 1 FROM generation_preparation_grants WHERE grant_id=? AND owner_id=? AND plan_id=? AND policy_json=? AND status='authorized' AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[grantId,a.user.userId,plan.id,grant.policy_json,grant.expires_at]};
    const scope=privateContentScopeGuard(a.user.userId),memory=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});
    const sourceGuard={sql:`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact-input' AND redacted_at IS NULL AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=? AND ${scope.sql} AND ${memory.sql} AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id))`,bindings:[grant.source_ref,a.user.userId,plan.source.expiresAt,LIMITS.sourceBytes,...scope.bindings,...memory.bindings]};
    const guards=[a.guard,schema,grantGuard,sourceGuard];
    const source=(await checkedBatch(env,guards,[db.prepare('SELECT content FROM private_content WHERE content_id=? AND owner_id=?').bind(grant.source_ref,a.user.userId)]))[0].results[0]?.content;
    validatePreparation(plan,source);unchanged();
    guards.push({sql:'EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND content=?)',bindings:[grant.source_ref,a.user.userId,source]});
    const policy=parseExact(grant.policy_json,65536);
    if(!recovery)validateFinancialPolicy(policy,financialScope(plan));
    if(!integer(grant.token_allowance)||grant.token_allowance<plan.request.byteLength+4096+LIMITS.outputTokens)fail('preparation_token_allowance');
    const expiresAt=[grant.expires_at,plan.source.expiresAt,plan.config.expiresAt,policy.expiresAt,new Date(Date.now()+LIMITS.retentionDays*86400000).toISOString()].sort()[0];
    return {...a,grant,source,policy,guards,expiresAt,memory,scope};
  }
  async function hold(id,reason){
    unchanged();const r=await db.prepare("UPDATE generation_preparation_operations SET status='hold',reason=? WHERE operation_id=?").bind(reason,id).run();
    if(r.success!==true)fail('preparation_hold_unacknowledged');return {action:'hold',operationId:id,reason,newPurchases:0};
  }
  async function reserve(request,grantId){
    const a=await access(request,grantId),id=operationId(plan),prior=await row(db,id);unchanged();
    if(prior)return {a,id,prior};
    const tokenId=`h4-token-${hash(id)}`,costId=`h4-cost-${hash(id)}`,period=new Date().toISOString().slice(0,7);
    const context={reservationId:tokenId,streamId:a.user.streamId,correlationId:id,operation:'generation-preparation',period,batchCounterInitialization:true};
    const tokens=await prepareBudgetReservation(env,a.user.userId,a.grant.token_allowance,context);
    // Reserve purchase + lifecycle together; no lifecycle is priced as zero or silently released.
    const allowance=a.policy.reservationMicrousd+a.policy.lifecycleReserveMicrousd;
    const cost=await prepareCostBudgetReservation(env,a.user.userId,allowance,{...context,reservationId:costId,maximumMicrousd:allowance,allowUserOverage:false});
    if(!tokens.ok||!cost.ok)fail('preparation_budget_denied');unchanged();
    const stopped={sql:"EXISTS(SELECT 1 FROM generation_preparation_grants WHERE grant_id=? AND stopped=0)",bindings:[grantId]};
    const r=await checkedBatch(env,[...a.guards,externalGuard(a.user.userId),stopped],[
      db.prepare("INSERT INTO generation_preparation_operations(operation_id,owner_id,grant_id,plan_id,request_hash,scope_hash,token_reservation_id,cost_reservation_id,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,'reserved',strftime('%Y-%m-%dT%H:%M:%fZ','now'),?)").bind(id,a.user.userId,grantId,plan.id,plan.request.sha256,hash(financialScope(plan)),tokenId,costId,a.expiresAt),
      ...tokens.statements,...cost.statements,
      assertion(db,{sql:"EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id=? AND status='active') AND EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=? AND status='active')",bindings:[tokenId,a.user.userId,costId,a.user.userId]})]);
    if(r[0]?.meta?.changes!==1)fail('preparation_reservation_unacknowledged');return {a,id,prior:null};
  }
  async function retain(request,grantId,id,slot,bytes){
    const a=await access(request,grantId),op=await row(db,id);unchanged();
    if(!op||op.owner_id!==a.user.userId)fail('preparation_original_missing');
    const ref=`h4-${hash(id+':'+slot)}`,size=Buffer.byteLength(bytes);
    const bounds={sql:'EXISTS(SELECT 1 FROM generation_preparation_operations WHERE operation_id=? AND private_bytes+?<=? AND private_writes<?)',bindings:[id,size,LIMITS.privateBytes,LIMITS.privateWrites]};
    const kind=slot==='source'?'document-artifact-input':'provider-response';
    await checkedBatch(env,[...a.guards,bounds],[db.prepare('INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'),?,NULL)').bind(ref,a.user.userId,kind,bytes,op.expires_at),db.prepare('INSERT INTO generation_preparation_evidence VALUES(?,?,?,?)').bind(id,slot,ref,hash(bytes)),db.prepare('UPDATE generation_preparation_operations SET private_bytes=private_bytes+?,private_writes=private_writes+1 WHERE operation_id=?').bind(size,id)]);
  }
  async function checkpoint(id,r){
    unchanged();const prior=await row(db,id);if(!prior||!['intent','received'].includes(prior.status))fail('preparation_original_missing');
    if(prior.provider_request_id&&r.requestId!==prior.provider_request_id||prior.receipt_hash&&r.receiptHash&&r.receiptHash!==prior.receipt_hash)fail('preparation_receipt_conflict');
    const statement=r.phase==='headers'?db.prepare('UPDATE generation_preparation_operations SET provider_request_id=COALESCE(provider_request_id,?),http_status=? WHERE operation_id=? AND status=\'intent\'').bind(r.requestId,r.httpStatus,id):db.prepare("UPDATE generation_preparation_operations SET status='received',receipt_hash=?,response_id=?,returned_model=?,usage_json=?,http_status=? WHERE operation_id=? AND status='intent'").bind(r.receiptHash,r.responseId,r.returnedModel,r.usage?JSON.stringify(r.usage):null,r.httpStatus,id);
    const result=await statement.run();unchanged();if(result.success!==true||result.meta?.changes!==1)fail('preparation_checkpoint_unacknowledged');
  }
  async function execute(request,{grantId}={}){
    if(env.FORMA_GENERATION_PREPARATION_ENABLED!=='1')return {action:'disabled',newPurchases:0};
    const {a,id,prior}=await reserve(request,grantId);
    if(prior)return {action:'hold',operationId:id,reason:'original_purchase_only',newPurchases:0};
    let initiatedProviderCalls=0;
    try{
      await retain(request,grantId,id,'source',a.source);
      await retain(request,grantId,id,'request',plan.request.body);
      const current=await access(request,grantId);
      await checkedBatch(env,[...current.guards,{sql:"EXISTS(SELECT 1 FROM generation_preparation_grants WHERE grant_id=? AND stopped=0)",bindings:[grantId]}, {sql:"EXISTS(SELECT 1 FROM generation_preparation_operations WHERE operation_id=? AND status='reserved' AND private_writes=2)",bindings:[id]}],[db.prepare("UPDATE generation_preparation_operations SET status='intent' WHERE operation_id=? AND status='reserved'").bind(id)]);
      // Irreversible intent, including lost acknowledgement before fetch. No lease or timeout resets it.
      const fresh=await access(request,grantId);
      if(fresh.grant.stopped)return hold(id,'stopped_after_intent');
      if(!env.OPENAI_API_KEY)return hold(id,'credential_unavailable');
      initiatedProviderCalls=1;
      const result=await submitPreparation(plan,{signal:AbortSignal.timeout(LIMITS.deadlineMs),checkpoint:r=>checkpoint(id,r),fetchOnce:(url,init)=>fetch(url,{...init,headers:{...init.headers,authorization:`Bearer ${env.OPENAI_API_KEY}`,...(plan.config.projectHeader?{'OpenAI-Project':plan.config.projectHeader}:{})}})});
      await retain(request,grantId,id,'response',result.raw);
      const receipt=await db.prepare('UPDATE generation_preparation_operations SET outcome=? WHERE operation_id=?').bind(result.outcome,id).run();if(receipt.success!==true)fail('preparation_outcome_unacknowledged');
      const outcome=await hold(id,result.outcome==='usable'?'human_review_and_original_reconciliation_required':result.outcome);
      return {...outcome,contentOutcome:result.outcome,initiatedProviderCalls,newPurchases:initiatedProviderCalls};
    }catch{return {...await hold(id,'original_submission_or_custody_unconfirmed'),initiatedProviderCalls,newPurchases:initiatedProviderCalls};}
  }
  async function recover(request,{grantId}={}){
    const a=await access(request,grantId,{recovery:true}),id=operationId(plan),op=await row(db,id);unchanged();
    if(!op||op.owner_id!==a.user.userId||op.plan_id!==plan.id)fail('preparation_original_missing');
    const quota={sql:'EXISTS(SELECT 1 FROM generation_preparation_operations WHERE operation_id=? AND original_reads<?)',bindings:[id,LIMITS.originalReads]};
    const r=await checkedBatch(env,[...a.guards,quota],[db.prepare('UPDATE generation_preparation_operations SET original_reads=original_reads+1 WHERE operation_id=?').bind(id),db.prepare(`SELECT e.slot,e.sha256,c.content FROM generation_preparation_evidence e JOIN private_content c ON c.content_id=e.content_ref WHERE e.operation_id=? AND c.owner_id=? AND c.redacted_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=c.content_id) AND ${a.memory.sql.replaceAll('private_content.','c.')} AND ${a.scope.sql.replaceAll('private_content.','c.')}`).bind(id,a.user.userId,...a.memory.bindings,...a.scope.bindings)]);
    const records=r[1].results;
    if(records.length!==3||records.some(x=>hash(x.content)!==x.sha256)||records.find(x=>x.slot==='source')?.sha256!==plan.source.sha256||records.find(x=>x.slot==='request')?.sha256!==plan.request.sha256||records.find(x=>x.slot==='response')?.sha256!==op.receipt_hash)return hold(id,'original_evidence_unavailable');
    let result;try{result=inspectResponse(parseExact(records.find(x=>x.slot==='response').content,LIMITS.responseBytes),plan,op.http_status);}catch{result={outcome:'invalid'};}
    return {action:'retained_original',operationId:id,contentOutcome:result.outcome,directionSha256:result.directionSha256??null,humanReviewed:false,financialSettled:false,newPurchases:0};
  }
  async function cleanup(request,{operationId:id}){
    unchanged();const a=await authenticateStudy(request,env,{recovery:true}),op=await row(db,id);
    if(!op||op.owner_id!==a.user.userId||Date.now()<Date.parse(op.expires_at))fail('preparation_cleanup_not_due');
    await checkedBatch(env,[a.guard,{sql:'EXISTS(SELECT 1 FROM generation_preparation_operations WHERE operation_id=? AND owner_id=? AND cleanup_attempts=0)',bindings:[id,a.user.userId]}],[db.prepare('UPDATE generation_preparation_operations SET cleanup_attempts=1 WHERE operation_id=?').bind(id)]);
    // Original input and financial identity remain; only our expired copies can be removed, once.
    await checkedBatch(env,[a.guard],[db.prepare("DELETE FROM private_content WHERE owner_id=? AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND content_id IN(SELECT content_ref FROM generation_preparation_evidence WHERE operation_id=?)").bind(a.user.userId,id)]);unchanged();
    return {action:'expired_copies_deleted',financialIdentityPreserved:true};
  }
  return Object.freeze({execute,recover,cleanup});
}
