import { hash, canonical, freeze } from './core.mjs';
import { STAGES, validateExecutionPlan, operationKey } from './execution-plan.mjs';
import { checkpointGenerationEvidence, operationEvidence } from '../../worker/generation-evidence.ts';

const amount = n => Number.isSafeInteger(n) && n >= 0;
const unresolved = op => Object.values(op.custody??{}).some(r=>r.accountingState!=='settled') || Object.values(op.stages).some(s => ['submitted','accepted','uncertain'].includes(s.status) || s.accountingState==='unknown') || op.status==='hold' || op.reconciliationAccounting==='unknown';
class BridgeError extends Error {}
const fail = reason => { throw new BridgeError(reason); };
// Untrusted provider/custody exceptions may contain private prompts. Never journal their messages.
const failureCode = error => error instanceof BridgeError ? error.message : 'host_operation_failed';
const nowIso = now => new Date(now()).toISOString();

/**
 * No env/key/global fetch/production registration. authority, custody and transport are trusted
 * host dependencies, NOT request fields. No default authority and no production implementation.
 * The host must use its existing authenticated owner/retention/paid-grant workflow, and bind
 * this canonical journal to that authority domain. Mock fixtures are the only shipped transport.
 */
export class DurableExecutionBridge {
  constructor({journal,authority,custody,transport,runtimeIdentity,enabled=false,now=Date.now}) {
    Object.assign(this,{journal,authority,custody,transport,runtimeIdentity:freeze(structuredClone(runtimeIdentity)),enabled,now});
  }
  async access(context,plan,purpose) {
    if(!this.enabled) fail('bridge_disabled');
    const a=await this.authority.resolveAccess({context,planId:plan.id,purpose});
    if(!a?.authorizationId || a.journalId!==this.journal.identity || !a.scope || !Number.isFinite(a.retentionUntil) || this.now()>=a.retentionUntil || a.user!==plan.user) fail('private_access_or_retention_denied');
    return freeze(structuredClone(a));
  }
  async permit(context,plan,trial) {
    const a=await this.access(context,plan,'execution-admission');
    const p=await this.authority.resolveAdmission({context,access:a,plan,trial});
    const f=p?.financial;
    if(p?.reviewedPlanId!==plan.id || p.candidateId!==plan.candidate.id || p.financialHash!==hash(plan.financial)
      || p.runtimeHash!==hash(this.runtimeIdentity) || p.journalId!==this.journal.identity || !p.paidAuthorityId || p.scope!==a.scope || !p.reviewId
      || !Number.isFinite(p.validUntil) || this.now()>=p.validUntil) fail('review_or_paid_authority_denied');
    if(plan.preparation.required || !p.sourceEvidenceId) fail('frozen_current_source_direction_required');
    if(plan.financial.available!==true || !f?.available || f.qualificationHash!==hash(plan.financial) || f.promptHash!==plan.manifest.cells.find(c=>c.id===trial.cellId).promptHash || f.cellId!==trial.cellId || !amount(f.maximumCostMicrousd)
      || !amount(p.allowanceMicrousd) || !STAGES.every(s=>amount(f.stageMaximums?.[s]))
      || !amount(f.reconciliationMaximumMicrousd) || !amount(f.evidenceMaximumMicrousd)
      || f.maximumCostMicrousd!==Object.values(f.stageMaximums).reduce((a,b)=>a+b,0)+f.reconciliationMaximumMicrousd+f.evidenceMaximumMicrousd) fail('financial_admission_unavailable');
    return freeze(structuredClone({access:a,...p}));
  }
  checkExpiry(p) { if(this.now()>=Math.min(p.access.retentionUntil,p.validUntil)) fail('authority_expired_before_reservation'); }
  async retain(context,plan,key,value,operationId) {
    const a=await this.access(context,plan,'private-evidence-write');
    if(!operationId) fail('custody_requires_reserved_operation');
    this.journal.transaction((s,emit)=>{
      const op=s.operations[operationId];if(!op||op.scope!==a.scope) fail('custody_scope_mismatch');
      if(op.custody[key]) fail('custody_write_already_claimed');
      op.custody[key]={accountingState:'unknown',costMicrousd:null};
      emit({at:nowIso(this.now),type:'custody-intent',operationId,keyHash:hash(key)});return null;
    });
    // Custody performs its own owner/expiry check at the actual I/O boundary.
    const receipt=await this.custody.put({access:a,key,value,sha256:hash(value)});
    this.journal.transaction((s,emit)=>{
      const op=s.operations[operationId],known=receipt?.accountingState==='settled'&&amount(receipt.costMicrousd);
      op.custody[key]={accountingState:known?'settled':'unknown',costMicrousd:known?receipt.costMicrousd:null};
      if(known) op.chargedMicrousd+=receipt.costMicrousd;
      if(op.chargedMicrousd>op.maximumMicrousd || Object.values(op.custody).reduce((n,r)=>n+(r.costMicrousd??0),0)>op.evidenceMaximumMicrousd) {op.status='hold';op.reason='estimate_exceeded';}
      emit({at:nowIso(this.now),type:'custody-checkpoint',operationId,keyHash:hash(key),...op.custody[key]});return null;
    });
    if(!receipt?.ref || receipt.sha256!==hash(value)) fail('private_evidence_retention_failed');
    if(receipt.accountingState!=='settled'||!amount(receipt.costMicrousd)) fail('custody_accounting_unknown');
    if(this.journal.read().operations[operationId].reason==='estimate_exceeded') fail('estimate_exceeded');
    return {ref:receipt.ref,sha256:receipt.sha256};
  }
  hold(id,reason) {
    return this.journal.transaction((s,emit)=>{
      const op=s.operations[id]; if(!op) return null;
      op.status='hold';op.reason=reason;
      emit({at:nowIso(this.now),type:'hold',operationId:id,reason});return op;
    });
  }
  async evidence(context,plan,op,stage,phase,result=null) {
    const request=plan.requests[op.cellId][stage];
    const body=JSON.parse(request.body);
    const operation=operationEvidence(request.provider,request.endpoint,body.model??'private-storage',
      stage==='image'?{n:1,size:body.size,quality:body.quality,output_format:body.output_format}:{},
      {entryPath:'B-durable-experiment',requestSha256:hash(request.body),requestId:result?.providerRequestId??null,
        compilerVersion:plan.candidate.id,adapterVersion:plan.runtimeIdentity.adapterSha256});
    let retained;
    await checkpointGenerationEvidence(async e=>{
      retained=await this.retain(context,plan,`${op.id}:${stage}:${phase}`,e,op.id);
    },`${op.id}:${stage}`,phase,operation,stage==='moderation'?'app_moderation':stage==='storage'?'storage':phase==='request'?'media_submission':'media_result',
    {dispatchState:phase==='request'?'not_dispatched':'response_received',contentOutcome:result?.contentOutcome??'unknown',
      accountingState:phase==='request'?'not_incurred':result?.accountingState??'unknown'},
    phase==='request'?{requestBody:request.body}:{responseBody:JSON.stringify(result?.receipt??{}),...(result?.safety?{safety:result.safety}:{})});
    this.journal.transaction((s,emit)=>{
      const row=s.operations[op.id].stages[stage];row[`${phase}Evidence`]=retained;
      emit({at:nowIso(this.now),type:'stage-evidence',operationId:op.id,stage,phase,...retained});
    });
  }
  async run({plan:input,trialId,context}) {
    if(!this.enabled) return {action:'disabled',newPurchases:0};
    // Snapshot before the first await; callers cannot change candidate/payload during admission.
    const plan=freeze(structuredClone(input));validateExecutionPlan(plan);
    if(canonical(plan.runtimeIdentity)!==canonical(this.runtimeIdentity)) fail('runtime_identity_mismatch');
    const trial=plan.manifest.trials.find(t=>t.id===trialId);if(!trial) fail('unreviewed_trial');
    const a=await this.access(context,plan,'private-result-read');
    const id=operationKey(a.scope,plan,trial);
    let prior=this.journal.read().operations[id];
    if(prior) {
      if(prior.planId!==plan.id) return {action:'hold',reason:'existing_purchase_other_review',operationId:id};
      if(prior.status==='completed') return this.reuse(context,plan,prior);
      if(unresolved(prior)) return {action:'hold',reason:'original_request_reconciliation_only',operationId:id};
      if(prior.status!=='paused') return {action:'hold',reason:'operation_already_reserved',operationId:id};
    }
    const p=await this.permit(context,plan,trial);
    if(p.scope!==a.scope) fail('authority_scope_changed');
    const op=this.journal.transaction((s,emit)=>{
      this.checkExpiry(p);
      const scope=s.scopes[p.scope]??={stopped:false,spentMicrousd:0};
      if(scope.stopped) fail('study_stopped');
      const existing=s.operations[id];
      if(existing) {
        if(existing.planId!==plan.id || existing.status!=='paused' || unresolved(existing)) fail('operation_already_reserved');
        existing.status='running';return existing;
      }
      const all=Object.values(s.operations).filter(o=>o.scope===p.scope);
      if(all.some(unresolved)) fail('unknown_exposure_stop_dispatch');
      if(all.some(o=>['running','reserved','paused'].includes(o.status))) fail('concurrency_limit');
      const spent=all.reduce((n,o)=>n+o.chargedMicrousd,0);
      if(!amount(spent+p.financial.maximumCostMicrousd) || spent+p.financial.maximumCostMicrousd>p.allowanceMicrousd) fail('authorized_allowance_exceeded');
      const row={id,scope:p.scope,planId:plan.id,trialId,cellId:trial.cellId,status:'running',planReceipt:null,custody:{},
        paidAuthorityId:p.paidAuthorityId,financialAdmissionHash:hash(p.financial),reconciliationMaximumMicrousd:p.financial.reconciliationMaximumMicrousd,reviewId:p.reviewId,maximumMicrousd:p.financial.maximumCostMicrousd,evidenceMaximumMicrousd:p.financial.evidenceMaximumMicrousd,chargedMicrousd:0,
        stages:Object.fromEntries(STAGES.map(stage=>[stage,{id:`${id}:${stage}`,status:'planned',accountingState:'not_incurred',contentOutcome:'unknown',maximumMicrousd:p.financial.stageMaximums[stage],providerRequestId:null,reconciliationReads:0}]))};
      s.operations[id]=row;emit({at:nowIso(this.now),type:'reserved',operationId:id,planId:plan.id,paidAuthorityId:p.paidAuthorityId});return row;
    });
    if(!op.planReceipt) {
      try {
        const receipt=await this.retain(context,plan,`${id}:plan`,plan,id);
        this.journal.transaction(s=>{s.operations[id].planReceipt=receipt;return null;});
      } catch(error) {return {action:'hold',operation:this.hold(id,failureCode(error))};}
    }
    let artifact=null, accountingUncertain=false;
    for(const stage of STAGES) {
      prior=this.journal.read().operations[id];
      if(prior.stages[stage].status==='completed') continue;
      if(this.journal.read().scopes[a.scope].stopped) {
        this.journal.transaction((s,emit)=>{s.operations[id].status='paused';emit({at:nowIso(this.now),type:'paused',operationId:id});return null;});
        return {action:'paused',operationId:id};
      }
      // A process that lost in-memory pixels cannot silently regenerate them.
      if(stage==='storage'&&!artifact) return {action:'hold',operation:this.hold(id,'original_result_needed_for_storage')};
      try {
        await this.evidence(context,plan,op,stage,'request');
        const fresh=await this.permit(context,plan,trial);
        if(fresh.scope!==op.scope || fresh.paidAuthorityId!==op.paidAuthorityId || hash(fresh.financial)!==op.financialAdmissionHash) fail('authority_changed');
        this.journal.transaction((s,emit)=>{
          this.checkExpiry(fresh);const row=s.operations[id].stages[stage];
          if(s.scopes[a.scope].stopped) fail('study_stopped');
          const previousSpend=Object.values(s.operations).filter(o=>o.scope===a.scope&&o.id!==id).reduce((n,o)=>n+o.chargedMicrousd,0);
          if(previousSpend+s.operations[id].maximumMicrousd>fresh.allowanceMicrousd) fail('authorized_allowance_exceeded');
          if(row.status!=='planned') fail('stage_already_claimed');
          row.status='submitted';row.accountingState='unknown';
          emit({at:nowIso(this.now),type:'dispatch-intent',operationId:id,stage,requestHash:hash(plan.requests[op.cellId][stage].body)});return null;
        });
        // There is deliberately no retry loop. A throw after the claim leaves unknown exposure.
        const request=plan.requests[op.cellId][stage];
        const result=stage==='storage'
          ? await this.custody.storeArtifact({access:await this.access(context,plan,'private-artifact-write'),operationId:id,artifact})
          : await this.transport.execute({operationId:`${id}:${stage}`,stage,request}, {
            accepted: identity=>this.accepted(id,stage,request.provider,identity),
          });
        this.checkpointResult(id,stage,result);
        await this.evidence(context,plan,op,stage,'response',result);
        if(stage==='image'&&result.artifact) artifact=Uint8Array.from(result.artifact);
        if(stage==='storage') {
          if(!result.artifactRef || result.artifactHash!==hash(Buffer.from(artifact))) fail('artifact_custody_mismatch');
          this.journal.transaction(s=>{s.operations[id].artifact={ref:result.artifactRef,sha256:result.artifactHash};return null;});
        }
        if(stage==='moderation' && !(result.safety?.source==='standalone_omni' && result.safety.validity==='valid' && result.safety.verdict==='clear' && result.safety.expectedResultCount===1 && result.safety.returnedResultCount===1)) {
          return {action:'hold',operation:this.hold(id,'moderation_not_clear')};
        }
        if(result.accountingState!=='settled'||!amount(result.costMicrousd)) {
          if(stage==='image'&&artifact) accountingUncertain=true;
          else return {action:'hold',operation:this.hold(id,'unknown_financial_exposure')};
        }
        if(this.journal.read().operations[id].status==='hold') return {action:'hold',reason:'estimate_exceeded',operationId:id};
        if(stage==='image'&&result.contentOutcome!=='usable') return {action:'hold',operation:this.hold(id,'image_not_usable')};
      } catch(error) {
        this.hold(id,failureCode(error));return {action:'hold',reason:failureCode(error),operationId:id};
      }
    }
    if(accountingUncertain) return {action:'hold',operation:this.hold(id,'unknown_financial_exposure')};
    this.journal.transaction((s,emit)=>{s.operations[id].status='completed';emit({at:nowIso(this.now),type:'completed',operationId:id});return null;});
    const verified=await this.reuse(context,plan,this.journal.read().operations[id]);
    return verified.action==='reuse_completed'?{...verified,action:'completed',newPurchases:1}:verified;
  }
  accepted(id,stage,provider,identity) {
    if(identity?.provider!==provider || !identity.providerRequestId) fail('original_request_identity_invalid');
    this.journal.transaction((s,emit)=>{
      const row=s.operations[id].stages[stage];
      if(!['submitted','accepted'].includes(row.status) || row.providerRequestId&&row.providerRequestId!==identity.providerRequestId) fail('original_request_identity_changed');
      row.status='accepted';row.providerRequestId=identity.providerRequestId;row.provider=provider;
      emit({at:nowIso(this.now),type:'accepted',operationId:id,stage,provider,providerRequestId:identity.providerRequestId});return null;
    });
  }
  checkpointResult(id,stage,result) {
    if(!result || !['usable','refused','invalid','unknown'].includes(result.contentOutcome)) fail('invalid_stage_result');
    this.journal.transaction((s,emit)=>{
      const op=s.operations[id],row=op.stages[stage];
      if(!['submitted','accepted','uncertain'].includes(row.status)) fail('stage_not_in_flight');
      if(row.providerRequestId&&result.providerRequestId!==row.providerRequestId) fail('original_request_identity_changed');
      row.providerRequestId=result.providerRequestId??row.providerRequestId;
      row.status='completed';row.contentOutcome=result.contentOutcome;
      row.accountingState=result.accountingState==='settled'&&amount(result.costMicrousd)?'settled':'unknown';
      row.costMicrousd=row.accountingState==='settled'?result.costMicrousd:null;
      if(row.costMicrousd!==null) op.chargedMicrousd+=row.costMicrousd;
      if(row.costMicrousd>row.maximumMicrousd || op.chargedMicrousd>op.maximumMicrousd) {op.status='hold';op.reason='estimate_exceeded';}
      emit({at:nowIso(this.now),type:'financial-checkpoint',operationId:id,stage,contentOutcome:row.contentOutcome,accountingState:row.accountingState,costMicrousd:row.costMicrousd,providerRequestId:row.providerRequestId});return null;
    });
  }
  async reuse(context,plan,op) {
    const access=await this.access(context,plan,'private-result-read');
    if(access.scope!==op.scope || !op.artifact || STAGES.some(stage=>!op.stages[stage].responseEvidence)) return {action:'hold',reason:'completed_evidence_missing'};
    const retainedPlan=await this.custody.read({access,ref:op.planReceipt.ref});
    if(hash(retainedPlan)!==op.planReceipt.sha256 || retainedPlan.id!==plan.id) return {action:'hold',reason:'completed_plan_mismatch'};
    for(const stage of STAGES) {
      for(const phase of ['request','response']) {
        const receipt=op.stages[stage][`${phase}Evidence`];
        const value=await this.custody.read({access:await this.access(context,plan,'private-evidence-read'),ref:receipt.ref});
        if(hash(value)!==receipt.sha256) return {action:'hold',reason:'completed_evidence_mismatch'};
      }
    }
    const bytes=await this.custody.readArtifact({access:await this.access(context,plan,'private-artifact-read'),ref:op.artifact.ref});
    if(hash(Buffer.from(bytes))!==op.artifact.sha256) return {action:'hold',reason:'completed_artifact_mismatch'};
    return {action:'reuse_completed',operationId:op.id,artifact:op.artifact,newPurchases:0,accountingState:'settled'};
  }
  async stop({context,plan:input,stopped=true}) {
    const plan=freeze(structuredClone(input));validateExecutionPlan(plan);
    const a=await this.access(context,plan,'study-control');
    // Host authorizes stop/resume independently; elapsed time is never resume permission.
    const receipt=await this.authority.authorizeControl({context,access:a,planId:plan.id,stopped});
    if(!receipt?.authorizationId || receipt.scope!==a.scope || receipt.planId!==plan.id || receipt.stopped!==stopped || !Number.isFinite(receipt.validUntil) || this.now()>=receipt.validUntil) fail('study_control_denied');
    this.journal.transaction((s,emit)=>{const scope=s.scopes[a.scope]??={spentMicrousd:0};scope.stopped=stopped;emit({at:nowIso(this.now),type:stopped?'stop':'resume',scope:a.scope});return null;});
  }
  async reconcile({context,plan:input,trialId,stage='image'}) {
    if(!this.enabled) return {action:'disabled',newPurchases:0};
    const plan=freeze(structuredClone(input));validateExecutionPlan(plan);
    const trial=plan.manifest.trials.find(t=>t.id===trialId);if(!trial||stage!=='image') fail('invalid_reconciliation');
    const a=await this.access(context,plan,'original-request-reconciliation'),id=operationKey(a.scope,plan,trial);
    const op=this.journal.read().operations[id],row=op?.stages[stage];
    if(!row||op.planId!==plan.id) return {action:'hold',reason:'original_operation_missing'};
    if(op.status==='completed') return this.reuse(context,plan,op);
    if(!row.providerRequestId) return {action:'hold',reason:'original_request_unknown'};
    // Read authority is separate from new-purchase admission; F2 unavailability never permits reads.
    let receipt=await this.authority.authorizeReconciliation({context,access:a,plan,operation:op,stage});
    if(!receipt?.authorizationId || receipt.scope!==a.scope || receipt.operationId!==id || receipt.providerRequestId!==row.providerRequestId || receipt.stage!==stage || receipt.maximumReads!==2 || !amount(receipt.maximumCostMicrousd) || receipt.maximumCostMicrousd>op.reconciliationMaximumMicrousd || !Number.isFinite(receipt.validUntil) || this.now()>=receipt.validUntil) fail('original_reconciliation_authority_denied');
    const identity=freeze({provider:plan.requests[op.cellId][stage].provider,providerRequestId:row.providerRequestId});
    if(this.transport.reconciliationSupported!==true) return {action:'hold',reason:'original_request_retrieval_unsupported'};
    const reads=[];
    for(const kind of ['status','result']) {
      const currentAccess=await this.access(context,plan,'original-request-reconciliation');
      receipt=await this.authority.authorizeReconciliation({context,access:currentAccess,plan,operation:op,stage});
      if(!receipt?.authorizationId || receipt.scope!==a.scope || receipt.operationId!==id || receipt.providerRequestId!==row.providerRequestId || receipt.stage!==stage || receipt.maximumReads!==2 || !amount(receipt.maximumCostMicrousd) || receipt.maximumCostMicrousd>op.reconciliationMaximumMicrousd || !Number.isFinite(receipt.validUntil) || this.now()>=Math.min(receipt.validUntil,currentAccess.retentionUntil)) fail('original_reconciliation_authority_denied');
      const claimed=this.journal.transaction((s,emit)=>{
        const r=s.operations[id].stages[stage];
        if(r.reconciliationReads!==(kind==='status'?0:1)) return false;
        s.operations[id].reconciliationAccounting='unknown';
        r.reconciliationReads++;emit({at:nowIso(this.now),type:'reconciliation-intent',operationId:id,stage,kind,identity});return true;
      });
      if(!claimed) return {action:'hold',reason:'reconciliation_bound_exhausted',reads};
      try {
        const result=await this.transport[kind](identity);
        reads.push(kind);
        if(result.provider!==identity.provider||result.providerRequestId!==identity.providerRequestId) fail('original_request_reconciliation_mismatch');
        await this.retain(context,plan,`${id}:${stage}:reconcile:${kind}`,result,id);
        this.journal.transaction((s,emit)=>{emit({at:nowIso(this.now),type:'reconciliation-receipt',operationId:id,stage,kind,accountingState:'unknown',receiptHash:hash(result)});return null;});
        if(kind==='status'&&result.state!=='completed') break;
      } catch(error) {this.hold(id,failureCode(error));return {action:'hold',reason:failureCode(error),reads};}
    }
    // Original-result inspection cannot clear settlement/custody uncertainty. No submit path here.
    return {action:'hold',reason:'original_evidence_retained_requires_authoritative_settlement',reads,newPurchases:0};
  }
}
