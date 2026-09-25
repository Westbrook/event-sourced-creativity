// Disposable, synthetic-only local exercise. Every provider/object interaction is intercepted.
import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {fixture} from '../tests/generation-p4-fixture.mjs';
export async function demonstrate(){
 const result={version:'p4-synthetic-complete-chain-v1',classification:'synthetic',actualGrant:false,realProviderCalls:0,actualSpending:false,userFinancialConsent:false,hostedQualified:false,modes:[],missingEvidence:[]};
 for(const mode of ['accepted-estimate','bounded-proof']){
  const clean=[];try{
   const f=await fixture({after:fn=>clean.push(fn)},{mode});const preview=await f.preview();assert.equal(preview.committable,true);
   const command=f.command(preview),commit=await f.call(command);assert.equal(commit.status,'committed');const afterCommit=f.counts();assert.equal(f.calls.length,0);
   assert.equal((await f.fresh().execute(f.request(),f.args())).action,'disabled');f.env.FORMA_GENERATION_STUDY_ENABLED='1';
   const baseline=await f.fresh().execute(f.request(),f.args());let humanGate=false;try{await f.fresh().execute(f.request(),f.args('treatment'));}catch{humanGate=true;}assert.equal(humanGate,true);
   await f.observe();let settlementGate=false;try{await f.fresh().execute(f.request(),f.args('treatment'));}catch{settlementGate=true;}assert.equal(settlementGate,true);
   const settlement=await f.settle();const treatment=await f.fresh().execute(f.request(),f.args('treatment'));await f.settle('treatment');await f.fresh().recover(f.request(),f.args());assert.equal(f.calls.length,6);
   result.modes.push({mode,preview,explicitSimulatedDecision:command,commit,afterCommit,baseline,humanGate,settlementGate,settlement,treatment,afterChain:f.counts(),interceptedPostCount:f.calls.length,evidence:f.sqlite.prepare('SELECT operation_id,slot FROM generation_study_evidence ORDER BY operation_id,slot').all(),originalOnlyStages:f.sqlite.prepare('SELECT operation_id,stage,status FROM generation_study_stages ORDER BY operation_id,stage').all(),status:await f.call({action:'status',proposalId:f.proposal.proposalId})});
  }finally{clean.reverse().forEach(fn=>fn());}
 }
 for(const missing of ['baseline:account','treatment:lifecycle','treatment:deletion','treatment:bound']){
  const clean=[];try{const f=await fixture({after:fn=>clean.push(fn)},{mode:missing.endsWith('bound')?'bounded-proof':'accepted-estimate',missing,classification:'actual'});const p=await f.preview(),commit=await f.call(f.command(p));assert.equal(p.committable,false);assert.equal(commit.status,'denied');result.missingEvidence.push({syntheticFixture:true,proposalClassification:'actual',missing,committable:p.committable,issues:p.display.issues,commit,counts:f.counts()});}finally{clean.reverse().forEach(fn=>fn());}
 }
 return result;
}
const result=await demonstrate(),target=process.argv[2];
if(target){if(existsSync(target))throw Error('Refusing to overwrite an evidence artifact');writeFileSync(target,JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify({modes:result.modes.map(m=>({mode:m.mode,commit:m.commit.status,afterCommit:m.afterCommit,interceptedPosts:m.interceptedPostCount,evidenceRecords:m.evidence.length,humanGate:m.humanGate,settlementGate:m.settlementGate})),missingEvidence:result.missingEvidence,actualGrant:false,realProviderCalls:0,userFinancialConsent:false},null,2));
