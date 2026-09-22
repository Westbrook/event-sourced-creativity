import { createHmac } from 'node:crypto';
import { unknownGenerationOutcome } from '../../src/model/generation-outcome-evidence.ts';
import { hash, validateManifest } from './core.mjs';

export const COST_STAGES=['planner','media','moderation','contextChecker','evaluator','render','storage','reconciliation'];
export const RUBRIC = Object.freeze({version:'fidelity-v1',scale:{0:'missing or contradicted',1:'major loss',2:'partial',3:'faithful',4:'fully faithful'},
  dimensions:['literary_identity','adult_subject','era','scene_and_spatial_relationships','palette','exact_text','reference_roles','prohibited_additions'],
  acceptance:'All applicable original critical requirements faithful (>=3), no unsafe output, and artifact usable; no aesthetic-similarity target.'});
export function blindedReview(manifest, records, secret) {
  if(typeof secret!=='string'||secret.length<16) throw new Error('private_blinding_secret_required');
  const key=[],items=[];
  for(const record of records){
    const trial=manifest.trials.find(t=>t.id===record.trialId);
    if(!trial) throw new Error('unplanned_trial');
    const c=manifest.cases.find(c=>c.id===trial.caseId);
    const label=createHmac('sha256',secret).update(trial.id).digest('hex').slice(0,24);
    key.push({label,trialId:trial.id,cellId:trial.cellId,artifactHash:record.artifactHash??null});
    // No arm, model, provider, prompt variant, filenames or raw errors in reviewer projection.
    items.push({label,requirements:c.requirements.map(({id,text,critical})=>({id,text,critical})),rubric:RUBRIC,
      artifactToken:record.artifactHash?createHmac('sha256',secret).update(record.artifactHash).digest('hex'):null,artifactAvailable:record.status==='completed'&&Boolean(record.artifactHash)});
  }
  return { reviewer:items.sort((a,b)=>a.label.localeCompare(b.label)), privateKey:key };
}
export function fidelity(c, judgment){
  if(!judgment) return { usable:false,judged:false,criticalIntentLoss:false };
  const required=new Set(c.requirements.map(r=>r.id));
  if(Object.keys(judgment.scores??{}).some(id=>!required.has(id))) throw new Error('unexpected_rubric_requirement');
  for(const r of c.requirements) if(!Number.isInteger(judgment.scores?.[r.id])||judgment.scores[r.id]<0||judgment.scores[r.id]>4) throw new Error('incomplete_fidelity_scores');
  const criticalIntentLoss=c.requirements.some(r=>r.critical&&judgment.scores[r.id]<3);
  return {usable:judgment.artifactUsable===true&&!judgment.unsafe&& !criticalIntentLoss,judged:true,criticalIntentLoss,unsafe:judgment.unsafe===true};
}
export function costs(records){
  const seen=new Map(), stages=Object.fromEntries(COST_STAGES.map(stage=>[stage,{knownMicrousd:0,unknownCalls:0} ]));
  for(const r of records) for(const call of r.costs??[]){
    if(!stages[call.stage]||!call.operationId) throw new Error('invalid_cost_stage_or_identity');
    const encoded=JSON.stringify(call);
    if(seen.has(call.operationId)){if(seen.get(call.operationId)!==encoded)throw new Error('conflicting_cost_receipt');continue;}
    seen.set(call.operationId,encoded);
    if(call.costMicrousd===null) stages[call.stage].unknownCalls++;
    else if(!Number.isSafeInteger(call.costMicrousd)||call.costMicrousd<0)throw new Error('invalid_cost');
    else stages[call.stage].knownMicrousd+=call.costMicrousd;
  }
  return {stages,knownMicrousd:Object.values(stages).reduce((n,s)=>n+s.knownMicrousd,0),unknownCalls:Object.values(stages).reduce((n,s)=>n+s.unknownCalls,0),
    interpretation:'Measured stage costs across successes, failures and evaluators; cached tokens and partial delivery included once in each operation receipt, never added again.'};
}
export function summarize(manifest, records){
  validateManifest(manifest);
  const trials=new Map(manifest.trials.map(t=>[t.id,t])),seen=new Set();
  const rows=records.map(r=>{
    const t=trials.get(r.trialId);
    if(!t||seen.has(r.trialId)||r.initiated!==true)throw new Error('unplanned_duplicate_or_uninitiated_record');
    seen.add(r.trialId);
    if(!['completed','blocked','failed','uncertain','no_tool','unusable'].includes(r.status))throw new Error('invalid_trial_status');
    if (!r.callCounts || COST_STAGES.some(stage => !Number.isSafeInteger(r.callCounts[stage]) || r.callCounts[stage] < 0)) throw new Error('complete_call_inventory_required');
    if (r.dispatched && r.callCounts.media < 1) throw new Error('dispatched_media_call_missing');
    const receipts = [...new Map((r.costs??[]).map(call=>[call.operationId,call])).values()];
    const reconciledCosts = [...(r.costs??[])];
    for (const stage of COST_STAGES) {
      const actual = receipts.filter(call=>call.stage===stage).length;
      if (actual > r.callCounts[stage]) throw new Error('cost_exceeds_call_inventory');
      for (let missing=actual; missing<r.callCounts[stage]; missing++) reconciledCosts.push({operationId:`${t.id}:missing:${stage}:${missing}`,stage,costMicrousd:null});
    }
    const c=manifest.cases.find(c=>c.id===t.caseId), score=fidelity(c,r.judgment);
    const cell=manifest.cells.find(cell=>cell.id===t.cellId);
    const [width,height]=cell.config.size.split('x').map(Number);
    const artifactContractValid=r.artifact?.width===width&&r.artifact?.height===height&&r.artifact?.format===cell.config.outputFormat;
    return {...r,...t,costs:reconciledCosts,score,artifactContractValid,usable:r.status==='completed'&&Boolean(r.artifactHash)&&artifactContractValid&&score.usable};
  });
  const ledger=costs(rows), usable=rows.filter(r=>r.usable).length;
  const byCell=manifest.cells.map(cell=>{const rs=rows.filter(r=>r.cellId===cell.id);return{cellId:cell.id,caseId:cell.caseId,initiated:rs.length,usable:rs.filter(r=>r.usable).length,rate:rs.length?rs.filter(r=>r.usable).length/rs.length:null};});
  const paired=manifest.cases.map(c=>{
    const arms=byCell.filter(a=>a.caseId===c.id),baseline=arms[0];
    return {caseId:c.id,stratum:c.stratum,arms,deltas:arms.slice(1).map(a=>({cellId:a.cellId,usableRateDelta:baseline?.rate!==null&&a.rate!==null?a.rate-baseline.rate:null}))};
  });
  const deltas=paired.map(c=>c.deltas[0]?.usableRateDelta).filter(d=>typeof d==='number');
  // Whole-case bootstrap, not output bootstrap. Descriptive only for this convenience corpus.
  let interval=null;
  if(deltas.length>=2){let state=0x9e3779b9;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
    const means=Array.from({length:2000},()=>deltas.reduce(sum=>sum+deltas[Math.floor(random()*deltas.length)],0)/deltas.length).sort((a,b)=>a-b);
    interval=[means[50],means[1949]];
  }
  return {counts:{planned:manifest.trials.length,initiated:rows.length,dispatched:rows.filter(r=>r.dispatched).length,completed:rows.filter(r=>r.status==='completed').length,blocked:rows.filter(r=>r.status==='blocked').length,unexecuted:manifest.trials.length-rows.length},
    acceptance:{usable,denominator:rows.length,rate:rows.length?usable/rows.length:null,basis:'prespecified initiated trials, including local blocks; unexecuted after stops excluded',unjudged:rows.filter(r=>!r.score.judged&&r.status==='completed').length},
    outcomes:Object.fromEntries([...new Set(rows.map(r=>r.status))].map(s=>[s,rows.filter(r=>r.status===s).length])),
    stageOutcomes:rows.map(r=>({trialId:r.id,outcome:r.outcome??unknownGenerationOutcome()})),costs:ledger,
    knownCostPerUsableMicrousd:usable?ledger.knownMicrousd/usable:null,totalCostPerUsableMicrousd:usable&&ledger.unknownCalls===0?ledger.knownMicrousd/usable:null,
    latency: Object.fromEntries(['firstUsablePreviewMs','completedMs'].map(field=>{const values=rows.map(r=>r.latency?.[field]).filter(v=>Number.isFinite(v)&&v>=0).sort((a,b)=>a-b);return[field,{observed:values.length,missing:rows.length-values.length,p50:values.length?values[Math.floor((values.length-1)/2)]:null,p95:values.length>=20?values[Math.ceil(values.length*.95)-1]:null,uncertainty:values.length<20?'insufficient_for_p95':'descriptive_observed_only'}];})),
    pairedCases:paired,uncertainty:{label:deltas.length<10?'exploratory_small_case_sample':'case_clustered_descriptive',independentCaseUnits:deltas.length,correlatedRepetitions:manifest.repetitions,
      pairedMeanDelta:deltas.length?deltas.reduce((a,b)=>a+b,0)/deltas.length:null,caseBootstrap95:interval,
      limitation:'First contrast only; no product-wide inference, no independent-output binomial interval. Held-out cases and prespecified tradeoffs required.'},
    pauseRequired:rows.some(r=>r.score.unsafe||r.score.criticalIntentLoss)||ledger.unknownCalls>0};
}
/** Offline fixture execution only: no credentials, fetch, provider adapters or callback dispatch. */
export function runMockTrials(manifest, fixtures, { maximumCostMicrousd=1_000_000 }={}){
  validateManifest(manifest); const records=[];let stop=null;
  if(!Number.isSafeInteger(maximumCostMicrousd)||maximumCostMicrousd<0)throw new Error('invalid_mock_budget');
  for(const trial of manifest.trials){
    const f=fixtures[trial.id];
    if(!f){stop='unexecuted_fixture_not_supplied';break;}
    const spent=costs(records).knownMicrousd;
    if(!Number.isSafeInteger(f.maximumCostMicrousd)||f.maximumCostMicrousd<0){stop='unqualified_mock_estimate';break;}
    if(spent+f.maximumCostMicrousd>maximumCostMicrousd){stop='budget_bound';break;}
    const costsForTrial=(f.costs??[]).map((c,i)=>({...c,operationId:`${trial.id}:${i}`}));
    const record={...structuredClone(f),trialId:trial.id,initiated:true,costs:costsForTrial};records.push(record);
    const result=summarize(manifest,records);
    if(result.pauseRequired){stop=result.costs.unknownCalls?'unknown_financial_exposure':'unsafe_or_critical_intent_loss';break;}
    if(['authentication','access','infrastructure'].includes(f.stopCause)){stop=f.stopCause;break;}
    if(result.costs.knownMicrousd>maximumCostMicrousd){stop='recorded_budget_overrun';break;}
  }
  return {simulation:true,records,stop,summary:summarize(manifest,records),actualProviderCalls:0,actualGenerationSubmissions:0};
}
export function mockCompleted(c,overrides={}){
  return {status:'completed',dispatched:true,maximumCostMicrousd:1000,artifactHash:hash('synthetic-artifact'),artifact:{width:1536,height:1024,format:'png'},
    callCounts:{planner:0,media:1,moderation:1,contextChecker:0,evaluator:1,render:0,storage:0,reconciliation:0},
    judgment:{artifactUsable:true,unsafe:false,scores:Object.fromEntries(c.requirements.map(r=>[r.id,4]))},
    costs:[{stage:'media',costMicrousd:700},{stage:'evaluator',costMicrousd:200},{stage:'moderation',costMicrousd:0}],
    outcome:{...unknownGenerationOutcome('media_result'),contentOutcome:'usable',dispatchState:'response_received',accountingState:'usage_recorded'},...overrides};
}
