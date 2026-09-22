import { hash, makeCell, makeManifest, freezeCase, seal } from '../core.mjs';
import { makeExecutionPlan, safetyIdentifier } from '../execution-plan.mjs';

export const MOCK_RUNTIME={adapterSha256:hash('mock-runtime'),compilerSha256:hash('mock-compiler')};
export function mockPlan({experiment='mock-bridge',prompt='An adult botanist. No logos.',preparation=false}={}) {
  const c=freezeCase({key:'mock',stratum:'mock-control',source:{brief:prompt},direction:{scene:prompt},prompt,requirements:[{id:'subject',text:prompt,mustContain:[prompt],critical:true}]});
  const config={model:'gpt-image-2.5-sunburst',endpoint:'/v1/images/generations',quality:'high',size:'1536x1024',outputFormat:'png',stream:false,moderation:null,references:[],prompt,planner:{mode:'frozen'},checker:{mode:'off'},compiler:'mock'};
  const cell=makeCell(c,config);
  const manifest=makeManifest({experiment,cases:[c],cells:[cell],interpretation:'mock only',callsPerTrial:{planner:0,moderation:1,media:1,storage:1,evaluator:0,contextChecker:0,status:1,result:1}});
  return makeExecutionPlan({manifest,candidate:{id:'mock-candidate',captures:[{cellId:cell.id,sourceHash:cell.sourceHash,directionHash:cell.plannerHash,promptHash:cell.promptHash}]},
    financial:{version:'MOCK_NOT_FINANCIAL_EVIDENCE',available:true,maximumCostMicrousd:100},user:safetyIdentifier('mock-owner'),runtimeIdentity:MOCK_RUNTIME,preparation:{required:preparation}});
}
export const resealPlan=(plan,patch)=>{const {id:_,...body}=structuredClone(plan);return seal('execution',{...body,...patch});};

/** TEST ONLY. No credentials, fetch, private source reader or production registration. */
export function mockHost(plan,{now=()=>1000,onExecute,onPut,journalId}={}) {
  const records=new Map(),artifacts=new Map(),calls=[];let denied=false,expires=10000;
  const check=a=>{if(denied||now()>=Math.min(a.retentionUntil,expires)||a.scope!=='mock-owner-ledger') throw new Error('mock_private_access_denied');};
  const authority={
    resolveAccess:async()=>{if(denied) throw new Error('mock_access_revoked');return {authorizationId:'mock-owner-auth',journalId,scope:'mock-owner-ledger',retentionUntil:expires,user:plan.user};},
    resolveAdmission:async({plan:p,trial,access})=>({scope:access.scope,journalId,reviewedPlanId:p.id,candidateId:p.candidate.id,financialHash:hash(p.financial),runtimeHash:hash(MOCK_RUNTIME),reviewId:'mock-review',paidAuthorityId:'mock-paid-grant',sourceEvidenceId:'mock-source',validUntil:expires,allowanceMicrousd:1000,
      financial:{available:true,qualificationHash:hash(p.financial),promptHash:p.manifest.cells.find(c=>c.id===trial.cellId).promptHash,cellId:trial.cellId,maximumCostMicrousd:100,stageMaximums:{moderation:0,image:50,storage:10},reconciliationMaximumMicrousd:20,evidenceMaximumMicrousd:20}}),
    authorizeControl:async({access,planId,stopped})=>{check(access);return {authorizationId:'mock-control',scope:access.scope,planId,stopped,validUntil:expires};},authorizeReconciliation:async({access,operation,stage})=>{check(access);return {authorizationId:'mock-reconciliation',scope:access.scope,operationId:operation.id,providerRequestId:operation.stages[stage].providerRequestId,stage,maximumReads:2,maximumCostMicrousd:20,validUntil:expires};},
  };
  const custody={
    async put({access,key,value,sha256}) {check(access);await onPut?.({key,value});check(access);records.set(key,structuredClone(value));return {ref:key,sha256,accountingState:'settled',costMicrousd:0};},
    async read({access,ref}) {check(access);return structuredClone(records.get(ref));},
    async storeArtifact({access,operationId,artifact}) {check(access);artifacts.set(operationId,Buffer.from(artifact));return {artifactRef:operationId,artifactHash:hash(Buffer.from(artifact)),contentOutcome:'usable',accountingState:'settled',costMicrousd:0,receipt:{stored:true}};},
    async readArtifact({access,ref}) {check(access);return artifacts.get(ref);},
  };
  const safety={schemaVersion:'forma-safety-evidence-v1',source:'standalone_omni',stage:'input',verdict:'clear',validity:'valid',expectedResultCount:1,returnedResultCount:1,requestedModel:'omni-moderation-latest',returnedModel:null,requestId:'mock-mod',responseId:null};
  const transport={
    reconciliationSupported:true,
    async execute(input,hooks) {
      calls.push(input);const overridden=await onExecute?.(input,hooks);
      if(overridden) return overridden;
      return {providerRequestId:`mock-${input.stage}`,contentOutcome:input.stage==='image'?'usable':'unknown',accountingState:'settled',costMicrousd:input.stage==='image'?10:0,
        ...(input.stage==='image'?{artifact:Buffer.from('mock-pixels')}:{safety}),receipt:{fixture:true}};
    },
    async status(identity) {calls.push({kind:'status',identity});return {...identity,state:'completed'};},
    async result(identity) {calls.push({kind:'result',identity});return {...identity,artifactHash:hash('original-pixels'),fixture:true};},
  };
  return {authority,custody,transport,records,artifacts,calls,deny:()=>{denied=true;},expire:n=>{expires=n;}};
}
