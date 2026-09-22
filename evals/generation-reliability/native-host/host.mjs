import {externalGuard, preparationGuards} from '../preparation/external-guard.mjs';
import { imageFinancialScope, resolveFinancialPolicy } from './financial-policy.mjs';
import { financialCompletion } from './financial-reconciliation.mjs';
import { checkpointGenerationEvidence, operationEvidence } from '../../../worker/generation-evidence.ts';
import { prepareBudgetReservation, prepareCostBudgetReservation, settleBudget, settleCostBudget } from '../../../worker/pilot-policy.ts';
import { validateExecutionPlan, operationKey, safetyIdentifier } from '../execution-plan.mjs';
import { hash, canonical, freeze, verifySeal } from '../core.mjs';
import { retainedStudyInputs, authenticateStudy, checkedBatch, assertion } from './authority.mjs';
import { submitStudyStage, validateWire, digest, HOST_LIMITS } from './transport.mjs';

const fail=code=>{throw Error(code);};
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const row=(db,id)=>db.prepare('SELECT * FROM generation_study_operations WHERE operation_id=?').bind(id).first();


/** Server-owned config only; no HTTP route, authority factory, mock import, CLI live command or automatic schema installation. */
export function createNativeStudyHost(env,{plan:original,runtimeIdentity,financialPolicies=[],financialAccount=null}){
  const plan=freeze(structuredClone(original)),runtime=freeze(structuredClone(runtimeIdentity));
  const db=env.DB,policies=freeze(structuredClone(financialPolicies)),account=freeze(structuredClone(financialAccount));
  const unchanged=()=>{if(env.DB!==db)fail('study_database_changed');};
  async function access(request,grantId,recovery=false){
    unchanged();validateExecutionPlan(plan);
    if(canonical(runtime)!==canonical(plan.runtimeIdentity))fail('study_runtime_changed');
    const a=await retainedStudyInputs(request,env,grantId,plan.id,{recovery});unchanged();
    if(plan.user!==safetyIdentifier(a.user.userId)||a.grant.runtime_hash!==hash(runtime))fail('study_owner_runtime_mismatch');
    const binding=plan.candidate.retainedInputs;
    if(!binding||binding.sourceRef!==a.source.content_id||binding.directionRef!==a.direction.content_id||binding.sourceSha256!==a.grant.source_hash||binding.directionSha256!==a.grant.direction_hash||binding.authorityVersion!==a.grant.authority_version)fail('study_capture_retention_mismatch');
    const preparation=await preparationGuards(db,a.user.userId);
    a.guards.push(...preparation.identity,...(!recovery?preparation.holds:[]));
    return a;
  }
  async function admission(a,trial){
    if(plan.preparation.required||plan.candidate.evidenceClass==='new-current-synthetic-control')fail('study_actual_inputs_required');
    verifySeal('f2-financial',plan.financial);
    const cell=plan.manifest.cells.find(c=>c.id===trial.cellId);
    if(!cell)fail('study_trial_missing');
    const policy=policies.find(p=>p.scope.operationId===operationKey(a.user.userId,plan,trial));
    let finance;
    if(policy){
      finance=await resolveFinancialPolicy(env,{policy,scope:imageFinancialScope(plan,trial,a.user.userId,account),grantId:a.grant.grant_id,ownerId:a.user.userId});
      a.guards.push(finance.guard);
    }else{
      if(plan.financial.available!==true||!integer(plan.financial.maximumCostMicrousd)||plan.financial.maximumCostMicrousd===0)fail('study_financial_unavailable');
      if(!Number.isFinite(Date.parse(plan.financial.pricingEvidence?.reviewExpiresAt))||Date.now()>=Date.parse(plan.financial.pricingEvidence?.reviewExpiresAt))fail('study_financial_expired');
      if(!plan.financial.promptEvidence?.some(p=>p.sha256===cell.promptHash&&p.captureId===plan.candidate.id))fail('study_financial_prompt_mismatch');
      finance={reservationMicrousd:plan.financial.maximumCostMicrousd,lifecycleReserveMicrousd:0,policy:null};
    }
    a.guards.push({sql:'NOT EXISTS(SELECT 1 FROM generation_study_lifecycle_holds WHERE owner_id=?)',bindings:[a.user.userId]});
    const total=finance.reservationMicrousd+finance.lifecycleReserveMicrousd;
    if(!integer(total)||total>a.grant.allowance_microusd||!integer(a.grant.allowance_microusd)||!integer(a.grant.token_allowance)||a.grant.token_allowance<1)fail('study_allowance_unavailable');
    for(const stage of ['moderation','image'])validateWire(plan.requests[cell.id][stage],stage,plan.user);
    if(JSON.parse(plan.requests[cell.id].moderation.body).input[0].text!==cell.config.prompt)fail('study_moderation_prompt_mismatch');
    return finance;
  }
  async function hold(id,reason){unchanged();await db.prepare("UPDATE generation_study_operations SET status='hold',reason=? WHERE operation_id=?").bind(reason,id).run();return {action:'hold',operationId:id,reason,newPurchases:0};}
  async function retain(request,grantId,id,suffix,content){
    const a=await access(request,grantId),op=await row(db,id);unchanged();
    if(!op||op.owner_id!==a.user.userId)fail('study_operation_missing');
    const bytes=Buffer.byteLength(content),ref=`h3-${digest(id+':'+suffix)}`;
    const bounds={sql:'EXISTS(SELECT 1 FROM generation_study_operations WHERE operation_id=? AND owner_id=? AND private_bytes+?<=? AND private_writes<?)',bindings:[id,a.user.userId,bytes,HOST_LIMITS.evidenceBytes,HOST_LIMITS.privateWrites]};
    await checkedBatch(env,[...a.guards,bounds],[db.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,'provider-response',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,NULL)").bind(ref,a.user.userId,content,op.expires_at),db.prepare('UPDATE generation_study_operations SET private_bytes=private_bytes+?,private_writes=private_writes+1 WHERE operation_id=?').bind(bytes,id),db.prepare('INSERT INTO generation_study_evidence VALUES(?,?,?,?)').bind(id,suffix,ref,digest(content))]);
    return ref;
  }
  async function evidence(request,grantId,id,trial,stage,phase,result){
    const wire=plan.requests[trial.cellId][stage];
    const body=JSON.parse(wire.body);
    const operation=operationEvidence(wire.provider,wire.endpoint,body.model??'private-storage',stage==='image'?{n:1,size:body.size,quality:body.quality,output_format:body.output_format}:{},
      {entryPath:'H3-native-study',requestSha256:hash(wire.body),requestId:result?.requestId??null,compilerVersion:plan.candidate.id,adapterVersion:runtime.adapterSha256});
    await checkpointGenerationEvidence(value=>retain(request,grantId,id,`${stage}-${phase}`,JSON.stringify(value)),`${id}:${stage}`,phase,operation,
      stage==='moderation'?'app_moderation':stage==='storage'?'storage':phase==='request'?'media_submission':'media_result',
      {dispatchState:phase==='request'?'not_dispatched':'response_received',contentOutcome:result?.outcome??'unknown',accountingState:phase==='request'?'not_incurred':'unknown'},
      phase==='request'?{requestBody:wire.body}:{responseBody:result?.raw??'{}'});
  }
  async function reserve(request,grantId,trial){
    const a=await access(request,grantId),finance=await admission(a,trial);
    const id=operationKey(a.user.userId,plan,trial),prior=await row(db,id);unchanged();
    if(prior)return {a,id,prior};
    const tokenId=`h3-token-${digest(id)}`,costId=`h3-cost-${digest(id)}`,lifeId=finance.lifecycleReserveMicrousd?`f3-lifecycle-${digest(id)}`:null;
    const period=new Date().toISOString().slice(0,7),context={reservationId:tokenId,streamId:a.user.streamId,correlationId:id,operation:'generation-study',period,batchCounterInitialization:true};
    const tokens=await prepareBudgetReservation(env,a.user.userId,a.grant.token_allowance,context);
    const cost=await prepareCostBudgetReservation(env,a.user.userId,finance.reservationMicrousd,{...context,reservationId:costId,maximumMicrousd:a.grant.allowance_microusd,allowUserOverage:false});
    const life=lifeId?await prepareCostBudgetReservation(env,a.user.userId,finance.lifecycleReserveMicrousd,{...context,reservationId:lifeId,operation:'study-lifecycle-provision',maximumMicrousd:a.grant.allowance_microusd,allowUserOverage:false}):null;
    if(!tokens.ok||!cost.ok||life&&!life.ok)fail('study_account_reservation_denied');
    unchanged();
    const stopped={sql:"EXISTS(SELECT 1 FROM generation_study_grants WHERE grant_id=? AND stopped=0) AND COALESCE((SELECT SUM(COALESCE(measured_microusd,0)+COALESCE((SELECT reserved_microusd FROM cost_budget_reservations WHERE reservation_id=generation_study_operations.lifecycle_reservation_id),0)) FROM generation_study_operations WHERE grant_id=?),0)+?<=?",bindings:[grantId,grantId,finance.reservationMicrousd+finance.lifecycleReserveMicrousd,a.grant.allowance_microusd]};
    // Native token and dollar preparation statements plus H state in one D1 batch. No independent SQLite journal.
    const results=await checkedBatch(env,[...a.guards,await externalGuard(db,a.user.userId),stopped],[
      db.prepare("INSERT INTO generation_study_operations(operation_id,owner_id,grant_id,plan_id,trial_id,request_hash,token_reservation_id,cost_reservation_id,status,created_at,expires_at,financial_policy_id,lifecycle_reservation_id) VALUES(?,?,?,?,?,?,?,?,'reserved',strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,?,?)").bind(id,a.user.userId,grantId,plan.id,trial.id,digest(plan.requests[trial.cellId].image.body),tokenId,costId,a.expiresAt,finance.policy?.id??null,lifeId),
      ...tokens.statements,...cost.statements,...(life?.statements??[]),
      ...(lifeId?[assertion(db,{sql:"EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=? AND status='active' AND reserved_microusd=?)",bindings:[lifeId,a.user.userId,finance.lifecycleReserveMicrousd]})]:[]),
      assertion(db,{sql:"EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id=? AND status='active') AND EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=? AND status='active')",bindings:[tokenId,a.user.userId,costId,a.user.userId]})]);
    if(results[0]?.meta?.changes!==1)fail('study_reservation_not_acknowledged');
    return {a,id,prior:null};
  }
  async function checkpoint(id,stage,receipt){
    unchanged();
    const prior=await row(db,id);if(!prior)fail('study_operation_missing');
    if(stage==='image'&&prior.provider_request_id&&receipt.requestId!==prior.provider_request_id){await hold(id,'receipt_identity_conflict');fail('study_receipt_conflict');}
    if(stage==='image'&&prior.receipt_hash&&receipt.receiptHash&&receipt.receiptHash!==prior.receipt_hash){await hold(id,'receipt_hash_conflict');fail('study_receipt_conflict');}
    const statements=[];
    const usage=receipt.usage&&typeof receipt.usage==='object'?Object.fromEntries(['input_tokens','output_tokens','total_tokens'].filter(k=>integer(receipt.usage[k])).map(k=>[k,receipt.usage[k]])):null;
    if(stage==='image')statements.push(db.prepare('UPDATE generation_study_operations SET provider_request_id=COALESCE(provider_request_id,?),receipt_hash=COALESCE(receipt_hash,?),usage_json=COALESCE(?,usage_json) WHERE operation_id=?').bind(receipt.requestId??null,receipt.receiptHash??null,usage?JSON.stringify(usage):null,id));
    if(receipt.phase==='receipt')statements.push(db.prepare("UPDATE generation_study_stages SET status='received',receipt_hash=? WHERE operation_id=? AND stage=? AND status='intent'").bind(receipt.receiptHash,id,stage));
    if(statements.length){const result=await db.batch(statements);unchanged();if(!Array.isArray(result)||result.length!==statements.length||result.some(r=>r?.success!==true))fail('study_receipt_unacknowledged');}
  }
  async function execute(request,{grantId,trialId}){
    if(env.FORMA_GENERATION_STUDY_ENABLED!=='1')return {action:'disabled',newPurchases:0};
    const trial=plan.manifest.trials.find(t=>t.id===trialId);if(!trial)fail('study_trial_missing');
    const {id,prior}=await reserve(request,grantId,trial);
    if(prior){
      if(prior.plan_id!==plan.id)return hold(id,'original_plan_changed');
      if(prior.status==='completed')return recover(request,{grantId,trialId});
      if(prior.status!=='paused')return {action:'hold',operationId:id,reason:'original_purchase_only',newPurchases:0};
    }
    if(!prior){try{await retain(request,grantId,id,'plan',JSON.stringify(plan));}catch{return hold(id,'plan_custody_unconfirmed');}}
    const signal=AbortSignal.timeout(HOST_LIMITS.deadlineMs);
    let imageAttempts=0;
    for(const stage of ['moderation','image']){
      const existing=await db.prepare('SELECT * FROM generation_study_stages WHERE operation_id=? AND stage=?').bind(id,stage).first();
      if(existing){if(stage==='moderation'&&existing.status==='complete')continue;return hold(id,'dispatch_intent_not_retriable');}
      let a=await access(request,grantId);
      if(a.grant.stopped){await db.prepare("UPDATE generation_study_operations SET status='paused' WHERE operation_id=?").bind(id).run();return {action:'paused',operationId:id,newPurchases:0};}
      try{
        await evidence(request,grantId,id,trial,stage,'request');
        a=await access(request,grantId);await admission(a,trial);
        await checkedBatch(env,[...a.guards,{sql:"EXISTS(SELECT 1 FROM generation_study_grants WHERE grant_id=? AND stopped=0)",bindings:[grantId]}],[
          db.prepare("INSERT INTO generation_study_stages VALUES(?,?,'intent',?,NULL)").bind(id,stage,digest(plan.requests[trial.cellId][stage].body)),db.prepare("UPDATE generation_study_operations SET status='running' WHERE operation_id=?").bind(id)]);
        // Intent is irreversible even if the process dies before fetch. No lease-expiry replay.
        if(stage==='image')imageAttempts++;
        const result=await submitStudyStage(env,plan.requests[trial.cellId][stage],stage,{signal,checkpoint:r=>checkpoint(id,stage,r)});
        await evidence(request,grantId,id,trial,stage,'response',result);
        if(result.outcome!=='usable')return hold(id,stage==='moderation'?'moderation_not_passed':'original_charge_unknown');
        if(stage==='moderation'){
          await db.prepare("UPDATE generation_study_stages SET status='complete' WHERE operation_id=? AND stage='moderation' AND status='received'").bind(id).run();continue;
        }
        // Incurred identity/usage were checkpointed before this separate, fallible custody boundary.
        await evidence(request,grantId,id,trial,'storage','request');
        a=await access(request,grantId);
        const key=`generation-study/${digest(a.user.userId)}/${digest(id)}.png`;
        await checkedBatch(env,a.guards,[db.prepare("INSERT INTO generation_study_stages VALUES(?,'storage','intent',?,NULL)").bind(id,result.artifactHash)]);
        // Recheck immediately before and after object I/O. The private object has no public route.
        await access(request,grantId);unchanged();
        const originalOperation=await row(db,id);
        await env.MEDIA.put(key,result.bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{owner:a.user.userId,operation:id,expiresAt:originalOperation.expires_at,sha256:result.artifactHash}});
        a=await access(request,grantId);
        await checkedBatch(env,a.guards,[db.prepare("UPDATE generation_study_operations SET artifact_ref=?,artifact_hash=?,status='hold',reason=? WHERE operation_id=?").bind(key,result.artifactHash,result.completeUsage?'original_charge_unreconciled':'usage_missing',id),db.prepare("UPDATE generation_study_stages SET status='complete',receipt_hash=? WHERE operation_id=? AND stage='storage'").bind(result.artifactHash,id)]);
        await evidence(request,grantId,id,trial,'storage','response',{outcome:'usable',raw:JSON.stringify({sha256:result.artifactHash,bytes:result.bytes.length,mimeType:'image/png',width:1536,height:1024})});
        return {action:'hold',newPurchases:imageAttempts,operationId:id,reason:result.completeUsage?'original_charge_unreconciled':'usage_missing',contentOutcome:'usable',accountingState:'unknown',uncachedEstimateMicrousd:result.uncachedEstimateMicrousd,measuredMicrousd:null};
      }catch{await hold(id,'stage_unconfirmed');return {action:'hold',operationId:id,reason:'stage_unconfirmed',newPurchases:imageAttempts};}
    }
    return hold(id,'original_result_needed');
  }
  async function control(request,{grantId,stopped}){
    if(typeof stopped!=='boolean')fail('study_control_invalid');
    const a=await access(request,grantId,true);
    await checkedBatch(env,a.guards,[db.prepare('UPDATE generation_study_grants SET stopped=? WHERE grant_id=? AND owner_id=?').bind(stopped?1:0,grantId,a.user.userId)]);
    return {stopped};
  }
  async function recover(request,{grantId,trialId}){
    const a=await access(request,grantId,true),trial=plan.manifest.trials.find(t=>t.id===trialId);if(!trial)fail('study_trial_missing');
    const id=operationKey(a.user.userId,plan,trial),op=await row(db,id);
    if(!op||op.plan_id!==plan.id)return {action:'hold',reason:'original_operation_missing',newPurchases:0};
    if(!op.artifact_ref||!op.artifact_hash)return {action:'hold',reason:'direct_images_retrieval_unavailable',newPurchases:0};
    const receipts=(await checkedBatch(env,a.guards,[db.prepare("SELECT e.slot,e.sha256,p.content FROM generation_study_evidence e JOIN private_content p ON p.content_id=e.content_ref WHERE e.operation_id=? AND p.owner_id=? AND p.redacted_at IS NULL AND p.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(id,a.user.userId)]))[0].results;
    if(receipts.length!==7||receipts.some(r=>digest(r.content)!==r.sha256)||!receipts.some(r=>r.slot==='plan'&&r.content===JSON.stringify(plan)))return hold(id,'original_evidence_unavailable');
    await checkedBatch(env,a.guards,[assertion(db,{sql:'EXISTS(SELECT 1 FROM generation_study_operations WHERE operation_id=? AND artifact_reads<2)',bindings:[id]}),db.prepare('UPDATE generation_study_operations SET artifact_reads=artifact_reads+1 WHERE operation_id=?').bind(id)]);
    const body=await env.MEDIA.get(op.artifact_ref);await access(request,grantId,true);unchanged();
    if(!body||body.size>HOST_LIMITS.artifactBytes||body.customMetadata?.owner!==a.user.userId||body.customMetadata?.operation!==id)return hold(id,'original_artifact_unavailable');
    const bytes=new Uint8Array(await new Response(body.body).arrayBuffer());await access(request,grantId,true);
    if(bytes.byteLength>HOST_LIMITS.artifactBytes||digest(bytes)!==op.artifact_hash)return hold(id,'original_artifact_corrupt');
    return {action:op.status==='completed'?'reuse_completed':'retained_unsettled',operationId:id,newPurchases:0,accountingState:op.measured_microusd===null?'unknown':'measured',bytes};
  }
  /** Read a separately entered verified original billing receipt. No provider GET/POST, polling or replacement purchase. */
  async function reconcile(request,{grantId,trialId}){
    unchanged();
    const a=await authenticateStudy(request,env,{recovery:true}),trial=plan.manifest.trials.find(t=>t.id===trialId);if(!trial)fail('study_trial_missing');
    const id=operationKey(a.user.userId,plan,trial),op=await row(db,id),charge=await db.prepare('SELECT * FROM generation_study_charges WHERE operation_id=?').bind(id).first();
    unchanged();
    if(!op||op.grant_id!==grantId||!charge)return {action:'hold',reason:'original_verified_charge_required',newPurchases:0};
    if(charge.provider_request_id!==op.provider_request_id||charge.receipt_hash!==op.receipt_hash||charge.scope_hash!==hash({planId:plan.id,inventory:plan.inventory,limits:HOST_LIMITS}))return hold(id,'receipt_conflict');
    let completion=null,policy=null;
    if(op.financial_policy_id){
      const stored=await db.prepare('SELECT policy_json FROM generation_study_financial_grants WHERE grant_id=? AND operation_id=? AND owner_id=? AND policy_id=?').bind(grantId,id,a.user.userId,op.financial_policy_id).first();
      if(!stored)return hold(id,'original_financial_policy_missing');
      policy=JSON.parse(stored.policy_json);verifySeal('financial-policy',policy);
      completion=await financialCompletion(db,op,charge,policy);
      if(!completion.providerSettled)return {...await hold(id,completion.reason),financial:completion};
    }
    const incurred=completion?.incurredMicrousd??charge.measured_microusd,tokens=completion?.incurredTokens??charge.measured_tokens;
    // Final verified incurred totals can exceed the first immutable receipt. Partial/uncertain assessments
    // cannot settle a native reservation. Restart resumes the same idempotent pair, never dispatches.
    unchanged();
    await settleBudget(env,a.user.userId,op.token_reservation_id,tokens,'verified_original_study_receipt');
    unchanged();
    await settleCostBudget(env,a.user.userId,op.cost_reservation_id,incurred);
    unchanged();
    const cost=await db.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').bind(op.cost_reservation_id).first();
    const token=await db.prepare('SELECT * FROM budget_reservations WHERE reservation_id=?').bind(op.token_reservation_id).first();
    if(cost.used_microusd!==incurred||token.used_tokens!==tokens||!['settled','released'].includes(token.status)||!['settled','released','exceeded'].includes(cost.status))return hold(id,'settlement_incomplete');
    if(policy){
      completion=await financialCompletion(db,op,charge,policy);
      if(completion.lifecycle?.lifecycle_closed===1&&op.lifecycle_reservation_id){
        await settleCostBudget(env,a.user.userId,op.lifecycle_reservation_id,completion.lifecycle.lifecycle_incurred_microusd);
        completion=await financialCompletion(db,op,charge,policy);
      }
    }
    const complete=(completion?completion.nextPurchaseEligible:charge.residual_exposure_microusd===0)&&Boolean(op.artifact_ref)&&incurred<=cost.reserved_microusd&&tokens<=token.reserved_tokens;
    const latest=completion?{sql:'(SELECT evidence_id FROM generation_study_reconciliations WHERE operation_id=? ORDER BY sequence DESC LIMIT 1) IS ?',bindings:[id,completion.evidenceId]}:null;
    await checkedBatch(env,[a.guard,...(latest?[latest]:[])],[db.prepare('UPDATE generation_study_operations SET measured_microusd=?,measured_tokens=?,status=?,reason=? WHERE operation_id=?').bind(incurred,tokens,complete?'completed':'hold',complete?null:completion?.reason??'original_custody_overrun_or_residual_exposure',id)]);
    return {action:complete?'completed':'hold',operationId:id,measuredMicrousd:incurred,newPurchases:0,...(completion?{financial:{...completion,nextPurchaseEligible:complete},artifactState:op.artifact_ref&&op.artifact_hash?'retained':'unavailable',nextPurchaseEligible:complete}:{})};
  }

  async function cleanup(request,{operationId}){
    const a=await authenticateStudy(request,env,{recovery:true}),op=await row(db,operationId);
    if(!op||op.owner_id!==a.user.userId||Date.now()<Date.parse(op.expires_at))fail('study_cleanup_not_due');
    // Exactly one deletion attempt. Financial and immutable purchase rows survive; failed/unknown deletion needs a separately scoped recovery.
    await checkedBatch(env,[a.guard],[assertion(db,{sql:"EXISTS(SELECT 1 FROM generation_study_operations WHERE operation_id=? AND owner_id=? AND cleanup_attempts=0 AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[operationId,a.user.userId]}),db.prepare('UPDATE generation_study_operations SET cleanup_attempts=1 WHERE operation_id=?').bind(operationId)]);
    await env.MEDIA.delete(`generation-study/${digest(a.user.userId)}/${digest(operationId)}.png`);
    await checkedBatch(env,[a.guard],[db.prepare("DELETE FROM private_content WHERE owner_id=? AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND content_id IN(SELECT content_ref FROM generation_study_evidence WHERE operation_id=?)").bind(a.user.userId,operationId)]);
    return {action:'expired_private_copies_deleted',accountingPreserved:true};
  }
  return Object.freeze({execute,control,recover,reconcile,cleanup});
}
