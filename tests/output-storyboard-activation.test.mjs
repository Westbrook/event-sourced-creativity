import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import './storyboard-r8-imports.mjs';
import {fixture,oneFunction,canonicalJson} from './output-storyboard-source-fixture.mjs';
const {readStoryboardExecutionOffer}=await import('../src/model/output-storyboard-offer.ts');
const {outputTerms}=await import('../src/experiences/output-terms.ts');
const {outputDigest}=await import(process.env.FORMA_SOURCE_ROOT+'/worker/output-disclosure-proof.ts');
const {createOutputAdmissionReads,outputAdmissionGovernanceAssertions,outputAdmissionSponsor,outputAdmissionBudgetOwner,assertOutputAdmissionRequest}=await import('../worker/output-admission-reads.ts');
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Storyboard activation uses existing host cost-transfer approval and exact current terms, without another approval gate',async()=>{
 const f=await offerFixture(),text=source('src/components/forma-experience-host.ts');
 const extract=(start,end,name,deps)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert(a>=0&&b>a);return new Function(...Object.keys(deps),
  stripTypeScriptTypes(text.slice(a,b).replace(start,'function '+name+'(').replaceAll('this.#','this.'))+';return '+name+';')(...Object.values(deps));};
 const terms=extract('  #terms(','  #paidDecision(','terms',{outputTerms});
 const paid=extract('  #paidDecision(','  #arm(','paid',{bindingJson:canonicalJson});
 const state={output:'storyboard',documentId:f.input.scope.documentId,current:{source:'verified'},original:null,preflight:f.offer,plan:{targetId:f.target.targetId,revisionId:f.offer.planRevisionId},grant:null,permitted:{authorize:true,run:false,resumeRun:false}};
 const binding={storyboardSource:f.target.settings.payload.outputStoryboard.source,ownerId:f.input.scope.actorUserId,authorization:{key:'authorization-scope'},client:{identity:{}},revision:'source-revision',plan:{projectId:f.input.scope.projectId,documentId:f.input.scope.documentId}};
 const context={binding,state:()=>state,terms:value=>terms.call(context,value),visible:()=>true,busy:false,approval:false,epoch:1};
 assert.equal(paid.call(context,'authorize'),null);
 context.approval=true;const decision=paid.call(context,'authorize');assert.equal(decision.action,'authorize');assert.equal(decision.termsDigest,f.offer.termsDigest);
 binding.storyboardSource={...binding.storyboardSource,requestHash:'sha256:'+'0'.repeat(64)};assert.equal(paid.call(context,'authorize'),null);
 binding.storyboardSource=f.target.settings.payload.outputStoryboard.source;context.busy=true;assert.equal(paid.call(context,'authorize'),null);
 context.busy=false;state.permitted.authorize=false;assert.equal(paid.call(context,'authorize'),null);
});

async function offerFixture(){
 const f=fixture(),target=await f.preflightOutputStoryboardTarget(f.input);assert(target.available);
 const now=Date.now(),offer={id:'preflight',planRevisionId:f.input.confirmedPlan.revisionId,termsDigest:'terms',sourceDigest:f.input.sourceDigest,requirementsDigest:f.input.requirementsDigest,
  createdAt:new Date(now-100).toISOString(),expiresAt:target.settings.original.expiresAt,maximumCalls:5,maximumMicrousd:target.maximumMicrousd,targets:[target],operationAttempts:{[target.targetId]:{ordinal:0,previousSlotId:null}}};
 const options={now,output:'storyboard',targetId:target.targetId,expectedStoryboard:{source:target.settings.payload.outputStoryboard.source,actorUserId:f.input.scope.actorUserId,projectId:f.input.scope.projectId,documentId:f.input.scope.documentId}};
 return {...f,target,offer,options};
}
// All controls are source/preparation controls. Finite source and DB ports do
// not constitute actual persisted user approval, provider work or a journey.
test('Storyboard activation closed quote exposes exact five paid stages and separate safety transfer',async()=>{
 const f=await offerFixture(),parsed=readStoryboardExecutionOffer(f.target);assert(parsed);assert.equal(parsed.calls.length,5);
 const shown=outputTerms(f.offer,f.options);assert.equal(shown.available,true);assert.equal(shown.grantAvailable,false);
 assert.equal(shown.targets[0].calls.length,5);const text=JSON.stringify(shown.targets[0].rows);
 assert.match(text,/Exactly 4 storyboard frames/u);assert.match(text,/4 additional; separate from 5 paid generation stages/u);assert.match(text,/omni-moderation-latest/u);assert.match(text,/no reference pixels, repair request or automatic retry/u);
 assert.equal(f.outputStoryboardPreflightProof(structuredClone(f.target)),null,'client-visible quote cannot manufacture the private preflight witness');
});
test('Storyboard activation rejects malformed stages, lowered frame caps, mixed payload and changed source or deadline',async()=>{
 const f=await offerFixture();
 for(const change of [t=>t.maximumCalls=4,t=>t.settings.calls.pop(),t=>t.settings.calls.reverse(),t=>t.settings.calls[0].stage='planning:0:repair',
  t=>t.settings.calls[1].provider='openai',t=>t.settings.calls[1].maximumMicrousd=1,t=>t.settings.calls[0].maximumOutputTokens=8000,
  t=>t.settings.payload.outputFalImage.width=1024,t=>t.settings.payload.itemCount=3,t=>t.settings.payload.referencePixels=true,t=>t.settings.payload.paidMediaConfirmed=false,
  t=>t.settings.preparationOnly=true,t=>t.settings.executionAvailable=false,t=>t.transferDescription='Send to fal only',t=>t.settings.original.requestId='new-job']){
  const target=structuredClone(f.target);change(target);assert.equal(readStoryboardExecutionOffer(target),null);
 }
 for(const change of [o=>o.expectedStoryboard.source={...o.expectedStoryboard.source,requestHash:'sha256:'+'0'.repeat(64)},o=>o.expectedStoryboard.actorUserId='foreign',o=>o.now=Date.parse(f.offer.expiresAt),o=>delete o.expectedStoryboard]){
  const options=structuredClone(f.options);change(options);assert.equal(outputTerms(f.offer,options).available,false);
 }
 const changed=structuredClone(f.offer);changed.expiresAt=new Date(Date.parse(f.offer.expiresAt)+1).toISOString();assert.equal(outputTerms(changed,f.options).available,false);
 let getters=0;const malicious=structuredClone(f.target);Object.defineProperty(malicious.settings,'calls',{enumerable:true,get(){getters++;return [];}});
 assert.equal(readStoryboardExecutionOffer(malicious),null);assert.equal(getters,0);
 const sparse=structuredClone(f.target),last=sparse.settings.calls[4];delete sparse.settings.calls[4];sparse.settings.calls[4294967295]=last;
 assert.equal(readStoryboardExecutionOffer(sparse),null);
});
test('Storyboard activation displayed grant is bound to original job and expires without renewal',async()=>{
 const f=await offerFixture(),maximum=f.target.maximumMicrousd,counters={maximumMicrousd:maximum,maximumCalls:5,usedMicrousd:0,exposedMicrousd:0,usedCalls:0,pendingCalls:0};
 const grant={id:'grant',planRevisionId:f.offer.planRevisionId,actorUserId:f.input.scope.actorUserId,payerUserId:f.input.scope.actorUserId,status:'authorized',expiresAt:f.offer.expiresAt,disclosure:f.offer,...counters,
  operations:[{id:'slot',jobId:f.target.settings.original.requestId,targetId:f.target.targetId,status:'authorized',...counters}]};
 assert.equal(outputTerms(f.offer,{...f.options,grant}).grantAvailable,true);
 for(const change of [g=>g.operations[0].jobId='foreign',g=>g.maximumCalls=6,g=>g.expiresAt=new Date(Date.parse(f.offer.expiresAt)+1).toISOString(),g=>g.status='revoked']){
  const value=structuredClone(grant);change(value);assert.equal(outputTerms(f.offer,{...f.options,grant:value}).grantAvailable,false);
 }
 assert.equal(outputTerms(f.offer,{...f.options,grant,now:Date.parse(f.offer.expiresAt)}).grantAvailable,false);
});
test('Storyboard activation actual authorization assigns only the private proof original job and atomic source expiry',async()=>{
 async function run(change=()=>{}){
  const f=await offerFixture(),trace={admissions:0,commits:0},plan={...f.input.confirmedPlan,targetContractDigests:{[f.target.targetId]:'target-digest'}};
  const trusted={...f.input,events:f.input.sourceEvents,request:new Request('https://forma.test/api/experiences/drafts/'+f.target.settings.original.draftId+'/output/authorize'),sourceAssertions:[...f.input.sourceAssertions]};
  trusted.env={...f.input.env,DB:{prepare(sql){assert.match(sql,/SELECT \* FROM output_preflights/u);return {bind(){return {first:async()=>({expires_at:f.offer.expiresAt,terms_digest:f.offer.termsDigest,event_id:'preflight-event'})};}};}}};
  const body={explicitAuthorization:true,maximumMicrousd:f.offer.maximumMicrousd,preflightId:f.offer.id,termsDigest:f.offer.termsDigest};
  let current=f.target;const bridge={preflight:async()=>current,prepareAdmission:async input=>{trace.admissions++;trace.input=input;return {events:[{type:'OutputOperationJobQueued',payload:{job_id:input.slots[0].jobId}}],sourceAssertions:[{sql:'source-still-current',bindings:[]}],buildStatements:()=>{throw Error('Not a DB commit proof');}};}};
  const deps={identifier:v=>v,nowIso:()=>new Date().toISOString(),record:v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{},privateEventBody:async()=>({preflight:f.offer}),
   currentPlan:(_t,p)=>p,readConfirmedPlan:async()=>plan,requireCurrentSource:()=>f.input.context,canonicalOutputJson:canonicalJson,
   bridgeTarget:()=>f.input,readStoryboardExecutionOffer,outputStoryboardPreflightProof:f.outputStoryboardPreflightProof,outputDigest,
   uuidV7:()=>crypto.randomUUID(),fail:code=>{throw Error(code);},commandWrite:()=>({sourceAssertions:trusted.sourceAssertions}),
   commitOutputCommand:async(_env,write)=>{trace.commits++;trace.write=write;return {captured:true};}};
  change({f,trusted,body,trace,setCurrent:value=>current=value});
  const authorize=oneFunction('worker/output-requirements-api.ts','async function authorizePlan','\nasync function runGrant',deps);
  return {f,trace,invoke:()=>authorize(trusted,body,'digest',bridge)};
 }
 const f=await run();await f.invoke();assert.equal(f.trace.admissions,1);assert.equal(f.trace.input.slots[0].jobId,f.f.target.settings.original.requestId);
 assert.equal(f.trace.input.slots[0].maximumCalls,5);assert.equal(f.trace.commits,1);assert(f.trace.write.sourceAssertions.some(a=>a.deadlineMs===Date.parse(f.f.offer.expiresAt)));
 assert(f.trace.write.events.some(e=>e.type==='OutputExecutionAuthorized'&&e.payload.authorized_targets[0].job_id===f.f.target.settings.original.requestId));
 for(const change of [x=>x.body.explicitAuthorization=false,x=>x.trusted.request=new Request('https://forma.test/api/output/authorize'),
  x=>x.f.offer.operationAttempts[x.f.target.targetId].ordinal=1,x=>x.f.offer.operationAttempts[x.f.target.targetId].previousSlotId='old',
  x=>x.setCurrent(structuredClone(x.f.target)),x=>x.trusted.scope.contextId='foreign',x=>x.body.maximumMicrousd=1]){
  const f=await run(change);await assert.rejects(f.invoke());assert.equal(f.trace.admissions,0);assert.equal(f.trace.commits,0);
 }
});

test('Storyboard activation admission handoff preserves the exact job, quoted payload and source-refresh capability',async()=>{
 async function run(mutate=()=>{}){
  const f=await offerFixture(),trace={jobs:0,budgets:0},slot={scopeKey:'scope',slotId:'slot',jobId:f.target.settings.original.requestId,grantId:'grant',targetId:f.target.targetId,planRevisionId:f.offer.planRevisionId,sourceDigest:f.input.sourceDigest,targetContractDigest:'digest',routeDigest:await outputDigest(f.target),attemptOrdinal:0,previousSlotId:null,maximumMicrousd:f.target.maximumMicrousd,maximumCalls:5,maximumTokens:f.target.maximumTokens};
  const input={...f.input,slots:[slot],preflight:{targets:[f.target]},confirmedPlan:{...f.input.confirmedPlan},request:new Request('https://forma.test/api/experiences/drafts/'+f.target.settings.original.draftId+'/output/authorize')};
  class OutputConflictError extends Error{}
  const deps={createOutputAdmissionReads,outputAdmissionGovernanceAssertions,outputAdmissionSponsor,outputAdmissionBudgetOwner,outputDigest,OutputConflictError,readStoryboardExecutionOffer,
   preflightOutputNativeTarget:arg=>f.preflightOutputStoryboardTarget(arg),preflightOutputStoryboardTarget:arg=>f.preflightOutputStoryboardTarget(arg),outputStoryboardPreflightProof:f.outputStoryboardPreflightProof,
   prepareOutputDocumentJob:async(request,env,command,preparation)=>{trace.jobs++;trace.command=command;trace.preparation=preparation;assert.equal(request,input.request);assert.equal(env,input.env);
    assertOutputAdmissionRequest(preparation.readScope,request,env,command.documentId);assert.equal(outputAdmissionSponsor(preparation.readScope),null);
    return {user:input.principal,budgetOwnerId:trace.budgetOwner??input.principal.billingUserId??input.principal.userId,kind:'render_document',jobId:slot.jobId,initialResult:{}};},
   prepareBudgetReservation:async(env,payer)=>{trace.budgets++;assert.equal(env,input.env);assert.equal(payer,input.principal.billingUserId??input.principal.userId);return {ok:false};}};
  const prepare=oneFunction('worker/output-document-execution.ts','async function prepareAdmission','\nexport const outputDocumentExecutionBridge',deps);
  mutate({f,input,slot,trace});return {f,input,slot,trace,invoke:()=>prepare(input)};
 }
 const f=await run();await assert.rejects(f.invoke(),/output_token_budget_unavailable/u);
 assert.equal(f.trace.jobs,1);assert.equal(f.trace.budgets,1);assert.equal(f.trace.preparation.jobId,f.f.target.settings.original.requestId);
 assert.deepEqual(f.trace.command.payload,f.f.target.settings.payload);assert.equal(f.trace.preparation.maximumCalls,5);
 assert.equal(f.trace.preparation.outputStoryboard.maximumMicrousd,f.f.target.maximumMicrousd);assert.equal(typeof f.trace.preparation.outputStoryboard.refresh,'function');
 const foreignBudget=await run(({trace})=>{trace.budgetOwner='foreign';});
 await assert.rejects(foreignBudget.invoke(),/output_job_budget_scope_mismatch/u);
 assert.equal(foreignBudget.trace.jobs,1);assert.equal(foreignBudget.trace.budgets,0,'a foreign job payer cannot reach reservation preparation');
 for(const mutate of [x=>x.slot.jobId='foreign',x=>x.slot.attemptOrdinal=1,x=>x.slot.previousSlotId='old',x=>x.f.input.current=false,x=>x.slot.routeDigest='changed']){
  const f=await run(mutate);await assert.rejects(f.invoke());assert.equal(f.trace.jobs,0);assert.equal(f.trace.budgets,0);
 }
 // Stop at a deliberately refused budget reservation. No successful admission
 // or synthetic persistence is inferred from the internal preparation handoff.
});
test('Storyboard activation runtime gate rejects a foreign or alternative job before private writes or dispatch',async()=>{
 const f=await offerFixture(),body=source('worker/output-execution-control.ts'),start=body.indexOf(' const storyboardProof='),end=body.indexOf(' const storyboardSourceAssertions',start);
 assert(start>=0&&end>start);class OutputConflictError extends Error{}
 const check=new Function('authority','current','job','slot','outputStoryboardPreflightProof','OutputConflictError',
  stripTypeScriptTypes('function check(){'+body.slice(start,end)+'return storyboardProof;}')+';return check();');
 const slot={jobId:f.target.settings.original.requestId,attemptOrdinal:0,previousSlotId:null},job={job_id:slot.jobId},authority={target:f.input.target};
 assert(check(authority,f.target,job,slot,f.outputStoryboardPreflightProof,OutputConflictError));
 for(const mutate of [s=>s.jobId='foreign',s=>s.attemptOrdinal=1,s=>s.previousSlotId='old']){
  const changed={...slot};mutate(changed);assert.throws(()=>check(authority,f.target,job,changed,f.outputStoryboardPreflightProof,OutputConflictError));
 }
 assert.throws(()=>check(authority,structuredClone(f.target),job,slot,f.outputStoryboardPreflightProof,OutputConflictError));
 assert.throws(()=>check(authority,f.target,{job_id:'foreign'},slot,f.outputStoryboardPreflightProof,OutputConflictError));
});

test('Storyboard activation actual native job gate needs server-owned preparation and exactly five calls',async()=>{
 const f=await offerFixture(),payload=structuredClone(f.target.settings.payload),text=source('worker/document-jobs-api.ts');
 const begin=text.indexOf('  const nativeAudio=outputPreparation?.outputAudio??null;'),end=text.indexOf('  const nativeScene=',begin);
 const gate=new Function('outputPreparation','payload','kind',stripTypeScriptTypes('async function gate(){'+text.slice(begin,end)+'return {nativeStoryboard};}')+';return gate();');
 let refreshed=0;const native={payload:structuredClone(payload),maximumMicrousd:f.target.maximumMicrousd,refresh:async()=>{refreshed++;}};
 assert.equal((await gate({outputStoryboard:native},payload,'render_document')).nativeStoryboard,native);assert.equal(refreshed,1);
 assert.equal((await gate({},payload,'render_document')).status,422);
 const changed=structuredClone(payload);changed.itemCount=3;assert.equal((await gate({outputStoryboard:native},changed,'render_document')).status,422);
 const allowance=text.match(/outputPreparation\.maximumCalls!==\((nativeStoryboard\?5:[^\n]+?)\)\)return Response\.json/u);assert(allowance);
 const calls=new Function('nativeStoryboard','nativeAudio','nativeNarrative','nativeScene','payload','return '+allowance[1]);
 assert.equal(calls(native,null,null,null,payload),5);assert.equal(calls(null,null,null,null,payload),2,'legacy route unchanged');
 const estimate=text.match(/const estimatedCostMicrousd=(nativeStoryboard\?nativeStoryboard\.maximumMicrousd:)/u);assert(estimate,'native quote does not fall back to the legacy five-dollar estimate');
});
