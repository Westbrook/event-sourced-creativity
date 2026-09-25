import {canonical,hash,seal,verifySeal} from '../core.mjs';
import {reviewedRequests} from '../execution-plan.mjs';
import {sourceAdvisoryInputs} from '../../../src/model/source-advisory.ts';
import {applyProfile} from '../../../docs/evidence/generation-p1/i-profile.mjs';
export const SUPPLIED_VERSION='generation-supplied-study-v2';
export const PROTOCOL='p2-human-between-arm-v1';
export const INVENTORY=Object.freeze({perTrial:{planner:0,sourceAdvisory:1,moderation:1,image:1,storage:1,contextChecker:0,evaluator:0,evidenceWrites:9},trials:2,maxTotalPOSTs:6,maxImages:2,concurrency:1,generationRetries:0,reconciliationReadsPerOriginal:2});
export const EVIDENCE_SLOTS=['plan',...['advisory','moderation','image','storage'].flatMap(s=>[s+'-request',s+'-response'])];
export const supplied=(plan)=>plan?.version===SUPPLIED_VERSION;
export function advisoryRequest(snapshot){
 const {input,mapping}=sourceAdvisoryInputs(snapshot);
 if(input.length!==2||mapping.some(m=>m.truncated))throw Error('study_advisory_scope');
 return {provider:'openai',endpoint:'/v1/moderations',method:'POST',body:JSON.stringify({model:'omni-moderation-latest',input})};
}
/** Descriptor only. Neither this builder nor its hashes grant authority. */
export function makeSuppliedPlan({packet,user,runtimeIdentity,binding}){
 verifySeal('p2-pilot',packet);
 const cells=['baseline','treatment'].map(arm=>{
  const prompt=JSON.parse(packet.arms.find(r=>r.arm===arm&&r.stage==='image').body).prompt;
  return {id:arm,sourceHash:packet.input.bytesSha256,plannerHash:packet.direction.sha256,promptHash:hash(prompt),config:{...packet.settings,prompt}};
 });
 const requests=Object.fromEntries(cells.map(c=>[c.id,{advisory:advisoryRequest(packet.suppliedSnapshot),...reviewedRequests(c,user)}]));
 const plan=seal('supplied-execution',{version:SUPPLIED_VERSION,packet,manifest:{cells,trials:cells.map(c=>({id:c.id,cellId:c.id,repeat:0}))},candidate:{id:packet.selectedFactor,evidenceClass:'agent-proposed-supplied-study',suppliedInputs:{kind:'supplied-agent-draft',...binding,sourceSha256:packet.input.bytesSha256,directionSha256:packet.direction.sha256}},financial:seal('f2-financial',{version:'supplied-requires-server-financial-policy',available:false,maximumCostMicrousd:null}),user,runtimeIdentity,preparation:{required:false},requests,inventory:INVENTORY,execution:'disabled',ready:false,liveAuthorized:false,maximumCostMicrousd:null,authorizedCostMicrousd:0,providerEnforcedChargeCap:false});
 validateSuppliedPlan(plan);return plan;
}
export function validateSuppliedPlan(p){
 verifySeal('supplied-execution',p);verifySeal('p2-pilot',p.packet);
 const b=p.candidate?.suppliedInputs,packet=p.packet,c=p.manifest?.cells,t=p.manifest?.trials;
 if(!supplied(p)||p.execution!=='disabled'||p.ready!==false||p.liveAuthorized!==false||p.authorizedCostMicrousd!==0||p.maximumCostMicrousd!==null||p.providerEnforcedChargeCap!==false||p.preparation?.required!==false||canonical(p.inventory)!==canonical(INVENTORY)||!p.runtimeIdentity?.adapterSha256)throw Error('study_supplied_envelope');
 if(!b||b.kind!=='supplied-agent-draft'||!b.reviewId||!b.authorityVersion||!b.sourceRef||!b.directionRef||b.sourceRef===b.directionRef||b.declaredAuthor!=='agent-proposed-study-draft'||b.approvedUse!==PROTOCOL||b.expiresAt!==packet.input.expiresAt||!Number.isFinite(Date.parse(b.expiresAt))||new Date(b.expiresAt).toISOString()!==b.expiresAt||hash(JSON.stringify(packet.suppliedSnapshot))!==b.sourceSha256||hash(JSON.stringify(packet.direction.value))!==b.directionSha256||packet.protocol?.id!==PROTOCOL||packet.ready!==false||packet.liveAuthorized!==false)throw Error('study_supplied_binding');
 if(c?.length!==2||t?.length!==2||p.candidate.id!==packet.selectedFactor||canonical(t)!==canonical(['baseline','treatment'].map(id=>({id,cellId:id,repeat:0}))))throw Error('study_supplied_pair');
 for(const [i,cell] of c.entries()){
  if(cell.id!==t[i].cellId||cell.sourceHash!==b.sourceSha256||cell.plannerHash!==b.directionSha256||cell.promptHash!==hash(cell.config.prompt)||canonical(cell.config)!==canonical({...packet.settings,prompt:JSON.parse(packet.arms.find(r=>r.arm===cell.id&&r.stage==='image').body).prompt})||canonical(p.requests[cell.id])!==canonical({advisory:advisoryRequest(packet.suppliedSnapshot),...reviewedRequests(cell,p.user)}))throw Error('study_supplied_wire');
 }
 if(c[1].config.prompt!==applyProfile(c[0].config.prompt,{enabled:true}))throw Error('study_supplied_factor');
 return true;
}
