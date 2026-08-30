import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import ts from "typescript";
import {documentIdFromRoute} from "../src/model/routes.ts";
import {routeCapabilities} from "../src/state/route-capabilities.ts";
import {documentJobTerminal,documentJobIsStale,documentJobCanRecoverPresentation,documentJobHasNoBudgetHold,planningStopBudget} from "../src/model/document-jobs.ts";
import {adaptiveJobMatchesRequest,adaptiveRequestKey} from "../src/model/adaptive-request.ts";
import {contextConsentFailure} from "../src/model/context-consent-state.ts";

const path="../src/state/store.ts",syntax=ts.createSourceFile(path,readFileSync(new URL(path,import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),owner=syntax.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="FormaStore");
function actual(name){const method=owner.members.find(node=>node.name?.getText(syntax)===name);assert.ok(method,name);return method.getText(syntax);}
const methods=["#immutableAdaptiveOriginal","#publicDocumentJobDetail","#adaptiveProposalOriginalMatches","#cacheDocumentJobDetail","#certifyAdaptiveProposalOriginal","#canRequestProjectOutputs","#canReadProjectJobs","#jobScope","#scheduleJobPoll","#syncVisibleJobs","syncDocumentJobs","#syncAdaptiveSuggestionSets","#withdrawAdaptiveRead","#clearAdaptivePrivatePresentation","#observeAdaptivePlanningJob","#revalidateMissingAdaptivePlans","#referencedPlanningJobIds","#trimDocumentJobDetails","#rememberPlanningRecovery","planningRecoveryEntries","#driveDocumentJobs","#ackJob","reviewPlanningJob","#requestPlanningConsent","#finishPlanningConsent","closePlanningConsent"].map(actual).join("\n");
// Reuse exact current source ownership, branding, and expiry checks.
// Existing serialized-session authority and network/native ports stay SIMULATED.
const sourceOwnershipMembers=["#sourceGeneration","#sourceRetired","#sourceOwners","#sourcePausedJobs","captureAuthorizationScope","authorizationScopeActive","captureSourceOwnership","sourceOwnershipScopeActive","#sourceExpiryValid","#sourceDeadlineCurrent","sourceOwnershipActive","#assertSourceOwnership"].map(actual).join("\n");
const cell=value=>({get:()=>value,set:next=>{value=next;}}),turn=()=>new Promise(setImmediate);
function fixture(permissions=["project.read"]){
  const calls=[],trace=[],timers=[],document={visibilityState:"visible",documentElement:{dataset:{formaPhase:"populated"}}},window={clearTimeout(){},setTimeout(callback,delay){timers.push({callback,delay});return timers.length;}};
  let responseJobs=[],responseGate=null,requestPort=null;const details=new Map();
  const fetch=async(url,init)=>{calls.push([url,init?.method??"GET"]);if(requestPort)return requestPort(url,init);if(responseGate)await responseGate;const detail=details.get(url);return{ok:true,status:200,json:async()=>detail?{job:detail}:{jobs:responseJobs}};};
  // Actual polling/driver methods; deterministic network and unrelated rendering ports.
  // This proves reader recovery cannot dispatch, not native accessibility.
  const Probe=eval(stripTypeScriptTypes(`(class {
    #jobPollTimer=0;#pendingPassiveJobPath="";#jobsSyncing=false;#jobSyncScope="";#jobResyncRequested=false;
    #jobDetails=new Map();#jobPollFailures=0;#jobPollIssueNotified=false;#pendingJobEventRefresh=false;#pendingJobSessionRefresh=false;
    #dismissedAdaptiveSuggestions=new Set();#pendingJobNotices=[];#jobsDriving=new Set();#presentationRecoveryAttempts=new Set();#adaptiveStructureJobIds=new Map();#pendingAdaptiveIntents=new Map();#planningRecoveryIdentities=new Map();#planningRecoverySequence=0;
    #planningConsentScope="";#planningConsentRoute="";#planningConsentResolve;
    #planningLocaleRevision=0;
    ${sourceOwnershipMembers}
    session=cell({user:{userId:"actor-a"},projectContext:{projectId:"project-a",permissions:permissions}});route=cell("/activity");
    projection=cell({projectId:"project-a",documents:[{id:"doc-a",projectId:"project-a"}]});documentJobs=cell([]);adaptiveStructures=cell({});adaptiveSuggestionSets=cell({});planningConsent=cell(null);
    #authorizationScope(session){return JSON.stringify(session);}#scopeStillActive(scope){return this.#authorizationScope(this.session.get())===scope;}
    #activeAuthorizationScope(){return this.#authorizationScope(this.session.get());}#systemNotice(source){return source;}guardedFetch(url,init){return fetch(url,init);}
    #assertAuthorizationScope(scope){if(!this.#scopeStillActive(scope))throw new Error("scope-changed");}
    async #refreshEvents(){trace.push("events");}async refreshSession(){}#adaptiveIntentForJob(){return "Original intent";}#jobResultVisible(){return false;}#jobNotice(){return "job";}
    notify(){}toast(message){trace.push(message);}async #driveDocumentJob(){trace.push("DISPATCH");}async recoverDocumentPresentation(){trace.push("RECOVER_PROVIDER");}
    drive(jobs){return this.#driveDocumentJobs(jobs);}ack(id){return this.#ackJob(id);}visible(){return this.#syncVisibleJobs();}
    bindPlan(job,plan){this.#adaptiveStructureJobIds.set(job.documentId,job.jobId);this.adaptiveStructures.set({[job.documentId]:plan});}cacheDetail(job){this.#jobDetails.set(job.jobId,job);}
    ${methods}
    ${actual("#clearPendingAdaptiveSelection")}
    ${actual("#canPresentAdaptivePlanningJob")}
  })`));
  const host=new Probe();return{host,calls,trace,timers,jobs(value){responseJobs=value;},detail(job){details.set("/api/document-jobs/"+encodeURIComponent(job.jobId)+"?inspection=1",job);},gate(promise){responseGate=promise;},respondWith(port){requestPort=port;}};
}
const job=(overrides={})=>({jobId:"original-plan",kind:"structure_adaptive",planningExecutionId:"original-plan",documentId:"doc-a",status:"queued",requestedAt:"2026-08-27T00:00:00Z",updatedAt:"2026-08-27T00:00:00Z",notifiedAt:"2026-08-27T00:00:00Z",result:{},...overrides});

test("reader job polling and Activity synchronization remain read-only even with queued or recoverable jobs",async()=>{
  const f=fixture(),jobs=[job(),job({jobId:"old-output",kind:"render_document",status:"failed",result:{artifactKind:"slides",recoverablePresentationCandidate:true}})];
  f.jobs(jobs);f.host.documentJobs.set(jobs);await f.host.syncDocumentJobs();
  assert.deepEqual(f.calls,[["/api/document-jobs","GET"]]);assert.deepEqual(f.host.documentJobs.get(),jobs);assert.ok(f.timers.length);
  f.host.drive(jobs);await f.host.ack("original-plan");assert.deepEqual(f.trace,[]);assert.equal(f.calls.length,1);
  f.host.visible();await turn();assert.deepEqual(f.calls,[["/api/document-jobs","GET"],["/api/document-jobs","GET"]]);assert.deepEqual(f.trace,[]);
});
test("reader recovery does not hide completed original jobs or dispatch from their arrival",async()=>{
  const f=fixture(),saved=job({status:"completed",result:{structure:{interpretation:"Original paid plan"}}});f.jobs([saved]);
  await f.host.syncDocumentJobs();assert.equal(f.host.documentJobs.get()[0].jobId,"original-plan");assert.deepEqual(f.calls,[["/api/document-jobs","GET"]]);assert.deepEqual(f.trace,[]);
});
test("a late planning-job feed cannot enter a different actor or permission scope",async()=>{
  const f=fixture(),gate=Promise.withResolvers();f.jobs([job()]);f.gate(gate.promise);const pending=f.host.syncDocumentJobs();
  f.host.session.set({user:{userId:"actor-b"},projectContext:{projectId:"project-a",permissions:[]}});gate.resolve();await pending;
  assert.deepEqual(f.host.documentJobs.get(),[]);assert.deepEqual(f.trace,[]);assert.equal(f.timers.length,0);
});
test("a role without current read or output authority neither polls nor dispatches",async()=>{
  const f=fixture([]);await f.host.syncDocumentJobs();f.host.visible();f.host.drive([job()]);await f.host.ack("original-plan");await turn();
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.trace,[]);assert.equal(f.timers.length,0);
});

test("fresh planning billing and retention override cached details even when the job timestamp is unchanged",async()=>{
  const f=fixture(),oldPlan={interpretation:"PRIVATE OLD PLAN"},old=job({status:"completed",result:{structure:oldPlan,planningStopBudget:{reservationStatus:"retained",billingStatus:"pending"}}});
  f.host.documentJobs.set([old]);f.host.cacheDetail(old);f.host.bindPlan(old,oldPlan);
  f.host.planningConsent.set({recoveryExecutionId:old.jobId,recoveredPlan:oldPlan,quote:{privateInput:"PRIVATE OLD INPUT"},request:{prompt:"PRIVATE OLD INTENT"}});
  const fresh={...old,result:{resultUnavailable:true,planningStopBudget:{reservationStatus:"settled",billingStatus:"settled"}}};f.jobs([fresh]);await f.host.syncDocumentJobs();
  assert.deepEqual(f.host.documentJobs.get()[0].result,fresh.result);assert.deepEqual(f.host.adaptiveStructures.get(),{});
  const review=f.host.planningConsent.get();assert.equal(review.recoveryExecutionId,old.jobId);assert.equal(review.quote,null);assert.equal(review.recoveredPlan,undefined);assert.equal(review.request.prompt,"");assert.equal(review.notice,"failed");
  assert.deepEqual(f.calls,[["/api/document-jobs","GET"]]);assert.deepEqual(f.trace,[]);
});
test("an unavailable different planning request never erases a still-retained original plan",async()=>{
  const f=fixture(),old=job({jobId:"original",planningExecutionId:"original",status:"completed"}),plan={interpretation:"Retained original"};
  f.host.bindPlan(old,plan);f.detail({...old,result:{structure:plan}});const next=job({jobId:"newer",planningExecutionId:"newer",status:"failed",result:{resultUnavailable:true}});f.host.documentJobs.set([next]);f.jobs([next]);
  await f.host.syncDocumentJobs();assert.deepEqual(f.host.adaptiveStructures.get(),{"doc-a":plan});assert.deepEqual(f.calls,[["/api/document-jobs","GET"],["/api/document-jobs/original?inspection=1","GET"]]);
});

// Matches the real worker's pending contract: a retained approval is readable
// before a generated structure exists. This is not a completed-plan fixture.
function pendingPlanningReview({jobStatus="running",quoteStatus="reserved",availability=true}={}){
  const f=fixture(),pending=job({status:jobStatus,canvasId:null,sourceSurface:"adaptive",requestKey:"original-planning-request-key",planningLocale:"en",planningProjectScope:false,result:{stage:"planning",...(availability===undefined?{}:{planningReviewAvailable:availability}),planningStopBudget:{reservationStatus:"retained",billingStatus:"pending"}}});
  const quote={executionId:pending.jobId,bindingHash:"b".repeat(64),status:quoteStatus,operation:"adaptive-structure",actorLabel:"Original actor",workspaceId:"org-a",period:"2026-08",expiresAt:"2026-09-27T00:00:00Z",blockId:"",projectId:"project-a",documentId:"doc-a",canvasId:null,sourceHash:"approved-source-hash",privateInput:{approved:"PRIVATE APPROVED SOURCE"},provider:"OpenAI",models:["original-model"],maximumMicrousd:5000,maximumTokens:1400,providerCalls:1,searchCalls:0,publicQuery:"",providerAvailable:false,canExecute:false,canPrepareNew:false};
  const request={projectId:"project-a",documentId:"doc-a",canvasId:null,sourceSurface:"adaptive",projectScope:false,locale:"en",requestKey:pending.requestKey,prompt:"PRIVATE ORIGINAL PENDING INTENT"};
  const review={id:"original-review",request,quote,working:false,notice:"uncertain",submitted:true,recoveryExecutionId:pending.jobId};
  f.host.documentJobs.set([pending]);f.host.planningConsent.set(review);return{f,pending,review};
}
function assertPendingPlanningReviewRetained(f,pending,original){
  const current=f.host.planningConsent.get();assert.ok(current);assert.equal(current.id,original.id);assert.equal(current.recoveryExecutionId,pending.jobId);assert.deepEqual(current.quote,original.quote);assert.deepEqual(current.request,original.request);assert.equal(current.quote.status,original.quote.status);assert.equal(current.notice,"uncertain");assert.equal(current.submitted,true);assert.equal(current.working,false);assert.equal(current.recoveredPlan,undefined);
  assert.ok(f.calls.every(([,method])=>method==="GET"));assert.ok(!f.trace.includes("DISPATCH"));assert.ok(!f.trace.includes("RECOVER_PROVIDER"));
}
const pendingPlanningStates=[
  {jobStatus:"queued",quoteStatus:"reserved"},
  {jobStatus:"running",quoteStatus:"reserved"},
  {jobStatus:"committing",quoteStatus:"reserved"},
  {jobStatus:"running",quoteStatus:"uncertain"},
  {jobStatus:"failed",quoteStatus:"uncertain"},
];
for(const state of pendingPlanningStates)for(const omitted of[false,true])test(`adaptive pending review R4: ${state.jobStatus}/${state.quoteStatus} survives ${omitted?"an omitted feed and exact retained GET":"normal progress polling"} without a generated structure`,async()=>{
  const {f,pending,review}=pendingPlanningReview(state);assert.equal(pending.result.structure,undefined);
  if(omitted){f.jobs([]);f.detail(pending);}else f.jobs([pending]);
  await f.host.syncDocumentJobs();assertPendingPlanningReviewRetained(f,pending,review);
  assert.deepEqual(f.calls,omitted?[["/api/document-jobs","GET"],["/api/document-jobs/original-plan?inspection=1","GET"]]:[["/api/document-jobs","GET"]]);
  assert.deepEqual(f.host.documentJobs.get(),omitted?[]:[pending],"Exact inspection must not inject a pending job into another scoped/page feed");
  if(!omitted)assert.deepEqual(f.host.documentJobs.get()[0].result.planningStopBudget,{reservationStatus:"retained",billingStatus:"pending"});
});

for(const quoteStatus of["reserved","uncertain"])test(`adaptive pending review R4: a missing result and absent availability marker alone do not withdraw ${quoteStatus} review`,async()=>{
  const {f,pending,review}=pendingPlanningReview({quoteStatus});delete pending.result.planningReviewAvailable;f.jobs([pending]);
  await f.host.syncDocumentJobs();assertPendingPlanningReviewRetained(f,pending,review);assert.deepEqual(f.calls,[["/api/document-jobs","GET"]]);
});

for(const withdrawal of[{planningReviewAvailable:false},{resultUnavailable:true},{planningReviewAvailable:true,resultUnavailable:true}])for(const omitted of[false,true])test(`adaptive pending review R4: explicit ${JSON.stringify(withdrawal)} in ${omitted?"exact inspection":"the feed"} clears private review but keeps original recovery identity`,async()=>{
  const {f,pending,review}=pendingPlanningReview({quoteStatus:"uncertain"}),unavailable={...pending,result:{stage:"planning",planningStopBudget:pending.result.planningStopBudget,...withdrawal}};
  if(omitted){f.jobs([]);f.detail(unavailable);}else f.jobs([unavailable]);
  await f.host.syncDocumentJobs();const current=f.host.planningConsent.get();assert.ok(current);assert.equal(current.id,review.id);assert.equal(current.recoveryExecutionId,pending.jobId);assert.equal(current.quote,null);assert.equal(current.recoveredPlan,undefined);assert.equal(current.replaceExecutionId,undefined);assert.deepEqual(current.request,{...review.request,prompt:""});assert.equal(current.submitted,true);assert.equal(current.notice,"failed");assert.equal(current.working,false);assert.doesNotMatch(JSON.stringify(current),/PRIVATE ORIGINAL PENDING INTENT|PRIVATE APPROVED SOURCE|original-model/u);
  assert.deepEqual(f.calls,omitted?[["/api/document-jobs","GET"],["/api/document-jobs/original-plan?inspection=1","GET"]]:[["/api/document-jobs","GET"]]);assert.ok(f.calls.every(([,method])=>method==="GET"));assert.ok(!f.trace.includes("DISPATCH"));assert.ok(!f.trace.includes("RECOVER_PROVIDER"));
  if(!omitted){assert.equal(f.host.documentJobs.get()[0].status,pending.status);assert.deepEqual(f.host.documentJobs.get()[0].result.planningStopBudget,pending.result.planningStopBudget);}
});

// A fulfilled exact read can still become stale while Promise.all waits for a
// different execution. Keep the real Store polling and explicit-resume methods;
// only network delivery, time, and unrelated rendering are deterministic ports.
async function aggregateCanvasPlan(label){
  const id="aggregate-"+label.toLowerCase(),request={projectId:"project-a",documentId:"doc-a",canvasId:"board-a",sourceSurface:"canvas",projectScope:true,locale:"en",prompt:"PRIVATE "+label+" original paid intent",requestKey:""};
  request.requestKey=await adaptiveRequestKey(request);
  const structure={interpretation:"PRIVATE "+label+" original paid interpretation",active_decision:{type:"subject",label:"Decision "+label,prompt:"Preserve "+label,why:"Keep the original decision."},suggested_blocks:[{type:"lighting",subtype:"Natural",label:"Light "+label,instruction:"Preserve the original light.",reason:"Continuity.",relationship_to:"Decision "+label}],hidden_until_later:["Later "+label]};
  const quote={executionId:id,bindingHash:"binding-"+label,status:"completed",operation:"adaptive-structure",actorLabel:"Original actor",workspaceId:"org-a",period:"2026-08",expiresAt:"2026-09-27T00:00:00Z",blockId:"",projectId:request.projectId,documentId:request.documentId,canvasId:request.canvasId,sourceHash:"source-"+label,privateInput:{approved:"PRIVATE "+label+" approved source"},provider:"OpenAI",models:["original-model-"+label],maximumMicrousd:5000,maximumTokens:1400,providerCalls:1,searchCalls:0,publicQuery:"",providerAvailable:false,canExecute:false,canPrepareNew:false};
  const saved=job({jobId:id,planningExecutionId:id,documentId:request.documentId,canvasId:request.canvasId,sourceSurface:request.sourceSurface,requestKey:request.requestKey,planningLocale:request.locale,planningProjectScope:request.projectScope,status:"completed",result:{structure,intent:request.prompt,planningReviewAvailable:true}});
  return{id,request,structure,quote,job:saved,body:{quote,planningRequest:request,job:saved,status:"completed"}};
}
async function aggregateCanvasFixture(t){
  const f=fixture(["project.read","project.canvas.use"]),a=await aggregateCanvasPlan("A"),b=await aggregateCanvasPlan("B"),requests=[],queued=[],waiters=[];
  f.respondWith((url,init)=>{
    const gate=Promise.withResolvers(),request={url,method:init?.method??"GET",body:init?.body?JSON.parse(init.body):null,gate};
    requests.push(request);if(waiters.length)waiters.shift()(request);else queued.push(request);
    return gate.promise;
  });
  const take=()=>queued.length?Promise.resolve(queued.shift()):new Promise(resolve=>waiters.push(resolve));
  const reply=async(request,body,status=200)=>{request.gate.resolve({ok:status>=200&&status<300,status,json:async()=>body});await turn();};
  const resume=async(plan,body=plan.body,status=200)=>{
    const reading=f.host.reviewPlanningJob(plan.id),request=await take();
    assert.equal(request.url,"/api/document-jobs/adaptive");assert.equal(request.method,"POST");assert.equal(request.body.action,"resume");assert.equal(request.body.executionId,plan.id);assert.equal(request.body.prompt,"");assert.equal(Object.hasOwn(request.body,"approvedBindingHash"),false);
    await reply(request,body,status);assert.equal(await reading,true);
  };
  t.after(()=>f.host.closePlanningConsent());
  f.host.documentJobs.set([a.job,b.job]);
  for(const plan of[a,b]){await resume(plan);f.host.closePlanningConsent();}
  assert.deepEqual(new Set((f.host.adaptiveSuggestionSets.get()["doc-a"]??[]).map(item=>item.id)),new Set([a.id,b.id]));
  return{f,a,b,requests,take,reply,resume};
}
async function omittedAggregateCanvasReads(pair){
  const {f,a,b,take,reply}=pair,polling=f.host.syncDocumentJobs(),list=await take();
  assert.equal(list.url,"/api/document-jobs");assert.equal(list.method,"GET");assert.equal(list.body,null);
  await reply(list,{jobs:[],hasMore:true,nextCursor:"other-page"});
  const pending=new Map();
  for(let index=0;index<2;index++){
    const request=await take(),plan=[a,b].find(item=>request.url==="/api/document-jobs/"+encodeURIComponent(item.id)+"?inspection=1");
    assert.ok(plan,"Inspect only the two exact retained executions");assert.equal(request.method,"GET");assert.equal(request.body,null);pending.set(plan.id,request);
  }
  assert.equal(pending.size,2);return{polling,pending};
}
function assertAggregateCanvasReadsOnly(pair){
  const {f,requests}=pair;
  assert.ok(requests.every(request=>request.method==="GET"||request.url==="/api/document-jobs/adaptive"&&request.body.action==="resume"),"Recovery never requests a quote, approval, new execution, or provider operation");
  assert.deepEqual(f.host.documentJobs.get(),[],"Exact inspections must not inject results into the filtered Activity feed");
  assert.ok(!f.trace.includes("DISPATCH"));assert.ok(!f.trace.includes("RECOVER_PROVIDER"));
}
function assertAggregateCanvasWithdrawal(pair){
  const {f,a,b}=pair,sets=f.host.adaptiveSuggestionSets.get()["doc-a"]??[],review=f.host.planningConsent.get();
  assert.ok(!sets.some(item=>item.id===a.id),"A newer withdrawal must remain authoritative after the other execution resolves");
  assert.deepEqual(sets.find(item=>item.id===b.id)?.structure,b.structure,"The unrelated, still-readable Canvas plan must remain available");
  assert.ok(review);assert.equal(review.recoveryExecutionId,a.id);assert.equal(review.quote,null);assert.equal(review.recoveredPlan,undefined);assert.equal(review.request.prompt,"");assert.equal(review.submitted,true);assert.equal(review.working,false);assert.equal(review.notice,"failed");assert.doesNotMatch(JSON.stringify(review),/PRIVATE A|original-model-A/u);
  const identities=f.host.planningRecoveryEntries();
  assert.ok(identities.some(identity=>identity.jobId===a.id),"Keep the exact content-free recovery handle");
  assert.doesNotMatch(JSON.stringify(identities),/PRIVATE|original-model|binding-/u);
  assertAggregateCanvasReadsOnly(pair);
}
for(const first of["A","B"])for(const withdrawal of["404","explicit-unavailable"])test("adaptive aggregate revision R6: "+first+" exact inspection first cannot restore A after newer "+withdrawal+" withdrawal",{timeout:3000},async t=>{
  const pair=await aggregateCanvasFixture(t),{a,b,f,reply,resume}=pair,{polling,pending}=await omittedAggregateCanvasReads(pair),earlier=first==="A"?a:b,later=first==="A"?b:a;
  await reply(pending.get(earlier.id),{job:earlier.job});
  // In the A-first case A has already fulfilled successfully inside Promise.all;
  // B remains deferred. The later explicit resume supersedes A's old certificate.
  const body=withdrawal==="404"?{error:"adaptive_execution_unavailable"}:{...a.body,job:{...a.job,result:{planningReviewAvailable:false,resultUnavailable:true}}};
  await resume(a,body,withdrawal==="404"?404:200);
  assert.ok(!(f.host.adaptiveSuggestionSets.get()["doc-a"]??[]).some(item=>item.id===a.id));
  await reply(pending.get(later.id),{job:later.job});await polling;
  assertAggregateCanvasWithdrawal(pair);
});
for(const first of["A","B"])test("adaptive aggregate revision R6: valid A and B remain available with "+first+" exact inspection completing first",{timeout:3000},async t=>{
  const pair=await aggregateCanvasFixture(t),{a,b,f,reply}=pair,{polling,pending}=await omittedAggregateCanvasReads(pair),order=first==="A"?[a,b]:[b,a];
  for(const plan of order)await reply(pending.get(plan.id),{job:plan.job});await polling;
  const sets=f.host.adaptiveSuggestionSets.get()["doc-a"]??[];
  assert.deepEqual(new Set(sets.map(item=>item.id)),new Set([a.id,b.id]));
  for(const plan of[a,b])assert.deepEqual(sets.find(item=>item.id===plan.id)?.structure,plan.structure);
  assert.equal(f.host.planningConsent.get(),null);assertAggregateCanvasReadsOnly(pair);
});

// Source guards below are actual current Store members. The fixture's original
// serialized-session authority and network/native ports are SIMULATED; these
// controls make no claim about a Worker source-retirement or billing receipt.
test("adaptive polling source owner: copied and foreign tokens cannot authorize retained recovery",()=>{
  const f=fixture(),other=fixture(),source=f.host.captureSourceOwnership();
  assert.ok(source);assert.equal(Object.isFrozen(source),true);assert.equal(Object.isFrozen(source.authorization),true);
  assert.equal(f.host.sourceOwnershipScopeActive(source),true);assert.equal(f.host.sourceOwnershipActive(source),true);
  const copied=structuredClone(source);
  assert.equal(f.host.sourceOwnershipScopeActive(copied),false);assert.equal(f.host.sourceOwnershipActive(copied),false);
  assert.equal(other.host.sourceOwnershipScopeActive(source),false);assert.equal(other.host.sourceOwnershipActive(source),false);
  assert.equal(f.host.sourceOwnershipActive(null),false);assert.deepEqual(f.calls,[]);assert.deepEqual(other.calls,[]);
});

for(const [label,offset,valid]of[["no deadline",null,true],["current deadline",60_000,true],["exact deadline",0,false],["expired",-1,false],["malformed","not-a-time",false],["empty","",false]])test("adaptive polling source owner: "+label+" uses the actual current expiry guard",async t=>{
  const now=Date.parse("2026-08-28T14:00:00Z");t.mock.method(Date,"now",()=>now);
  const f=fixture(),session=f.host.session.get(),expiresAt=typeof offset==="number"?new Date(now+offset).toISOString():offset;
  f.host.session.set({...session,projectContext:{...session.projectContext,expiresAt}});
  const source=f.host.captureSourceOwnership();
  assert.equal(f.host.sourceOwnershipScopeActive(source),true,"request ownership alone is not private-source availability");
  assert.equal(f.host.sourceOwnershipActive(source),valid);
  f.jobs([job({status:"completed",result:{structure:{interpretation:"PRIVATE CURRENT PLAN"}}})]);
  await f.host.syncDocumentJobs();
  assert.deepEqual(f.calls,valid?[["/api/document-jobs","GET"]]:[]);
  assert.equal(f.host.documentJobs.get().length,valid?1:0);
  assert.deepEqual(f.trace,[]);
});

for(const phase of["headers","body"])test("adaptive polling source owner: expiry while "+phase+" are pending cannot publish an old private job",async t=>{
  let now=Date.parse("2026-08-28T14:00:00Z");t.mock.method(Date,"now",()=>now);
  const f=fixture(),session=f.host.session.get(),gate=Promise.withResolvers();
  f.host.session.set({...session,projectContext:{...session.projectContext,expiresAt:new Date(now+60_000).toISOString()}});
  const source=f.host.captureSourceOwnership(),saved=job({status:"completed",result:{structure:{interpretation:"PRIVATE EXPIRED PLAN"}}});
  f.respondWith(async()=>{
    if(phase==="headers")await gate.promise;
    return{ok:true,status:200,json:async()=>{if(phase==="body")await gate.promise;return{jobs:[saved]};}};
  });
  const pending=f.host.syncDocumentJobs();await turn();
  assert.deepEqual(f.calls,[["/api/document-jobs","GET"]]);assert.deepEqual(f.host.documentJobs.get(),[]);
  now+=60_000;
  assert.equal(f.host.sourceOwnershipScopeActive(source),true);assert.equal(f.host.sourceOwnershipActive(source),false);
  gate.resolve();await pending;
  assert.deepEqual(f.host.documentJobs.get(),[]);assert.deepEqual(f.host.adaptiveStructures.get(),{});assert.deepEqual(f.host.adaptiveSuggestionSets.get(),{});
  assert.deepEqual(f.trace,[]);assert.equal(f.timers.length,0);assert.deepEqual(f.calls,[["/api/document-jobs","GET"]]);
});
