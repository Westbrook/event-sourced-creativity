import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import ts from "typescript";
import { adaptiveSuggestionsForCanvas } from "../src/model/block-types.ts";
import { adaptiveRequestKey, adaptiveJobMatchesRequest } from "../src/model/adaptive-request.ts";
import { contextConsentAction, contextConsentFailure } from "../src/model/context-consent-state.ts";
import { DOCUMENT_JOB_KINDS, documentJobStopBudgetMessage, documentJobTerminal, documentJobHasNoBudgetHold, planningStopBudget } from "../src/model/document-jobs.ts";
import { isDocumentArtifactKind } from "../src/model/document-artifacts.ts";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";
import englishSystemMessages from "../src/components/design-system/locales/system-en.ts";
import frenchMessages from "../src/components/design-system/locales/fr.ts";
import arabicMessages from "../src/components/design-system/locales/ar.ts";
import japaneseMessages from "../src/components/design-system/locales/ja.ts";

const {FORMA_DEFAULT_MESSAGES}=await(async()=>{
  const previousElement=globalThis.HTMLElement,previousRegistry=globalThis.customElements;
  globalThis.HTMLElement=class extends EventTarget{};globalThis.customElements={get(){return undefined;},define(){}};
  try{return await import("../src/components/design-system/localization.ts");}
  finally{
    if(previousElement===undefined)delete globalThis.HTMLElement;else globalThis.HTMLElement=previousElement;
    if(previousRegistry===undefined)delete globalThis.customElements;else globalThis.customElements=previousRegistry;
  }
})();
const stopLocaleCatalogs={en:englishSystemMessages,fr:frenchMessages,ar:arabicMessages,ja:japaneseMessages};


const parse=path=>ts.createSourceFile(path,readFileSync(new URL(path,import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const storeSyntax=parse("../src/state/store.ts"),shellSyntax=parse("../src/components/forma-shell.ts"),previewSyntax=parse("../src/components/consequential-preview.ts"),canvasSyntax=parse("../src/canvas/canvas-application.ts"),adaptiveSyntax=parse("../src/components/forma-studio-editor-alternatives.ts");
function member(syntax,className,name){const owner=syntax.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text===className),node=owner?.members.find(candidate=>candidate.name?.getText(syntax)===name&&(!ts.isMethodDeclaration(candidate)||candidate.body));assert.ok(node,`${className}.${name} production member exists`);return node.getText(syntax);}
const actualStore=["subscribe","loadDocumentJobDetail","#hydrateDocumentJobGenerationReceipt","#systemNotice","stopDocumentJob","structureAdaptive","#finishPlanningConsent","closePlanningConsent","reviewPlanningJob","newPlanningPreview","previewPlanningConsent","approvePlanningConsent","#requestPlanningConsent","#canReadProjectJobs","#canRequestProjectOutputs","canPreparePlanning","notify","#snapshotIdentity","#authorizationScope","#activeAuthorizationScope","#scopeStillActive","#assertAuthorizationScope","captureAuthorizationScope","authorizationScopeActive","guardedFetch","#adaptiveIntentForJob","#syncAdaptiveSuggestionSets","#withdrawAdaptiveRead","#clearAdaptivePrivatePresentation","#observeAdaptivePlanningJob","#referencedPlanningJobIds","#trimDocumentJobDetails","#rememberPlanningRecovery","planningRecoveryEntries","dismissAdaptiveStructure","dismissAdaptiveSuggestion","adaptiveSuggestionSetsFor"].map(name=>member(storeSyntax,"FormaStore",name)).join("\n");
// The selected-member host must execute the real Store ownership/deadline
// implementation; it is not a fallback or a newly invented authority port.
const actualSourceOwnershipStore=["#sourcePausedJobs","#sourceOwnedJobResponse","#privateJobReference","#sourceGeneration","#sourceRetired","#sourceOwners","captureSourceOwnership","sourceOwnershipScopeActive","sourceOwnershipActive","#sourceExpiryValid","#sourceDeadlineCurrent","#assertSourceOwnership"].map(name=>member(storeSyntax,"FormaStore",name)).join("\n");
const cell=value=>({get:()=>value,set:next=>{value=next;}});
function deferred(){let resolve,reject;const promise=new Promise((accept,fail)=>{resolve=accept;reject=fail;});return{promise,resolve,reject};}
const turn=()=>new Promise(setImmediate),document={documentElement:{lang:"en"}};


// Execute the production locale callback, not a synthetic selection reset.
// setFormaLocale changes document.lang before dispatching this event; the test
// seam mirrors that order while leaving every private clock mutation to Store.
function actualLocaleChangeMemberR16(){
  const owner=storeSyntax.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="FormaStore");
  const constructor=owner?.members.find(ts.isConstructorDeclaration);assert.ok(constructor);
  let handler;
  function visit(node){
    if(ts.isCallExpression(node)&&node.expression.getText(storeSyntax)==="document.addEventListener"
      &&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==="forma-locale-change")handler=node.arguments[1];
    ts.forEachChild(node,visit);
  }
  visit(constructor);assert.ok(handler&&ts.isArrowFunction(handler)&&ts.isBlock(handler.body));
  return 'dispatchActualLocaleChangeR16(locale:string){document.documentElement.lang=locale;const event={target:document,detail:{locale}};'+handler.body.getText(storeSyntax).slice(1,-1)+'}';
}

// Actual production methods with deterministic in-memory ports only.
// These are not native-browser accessibility or provider evidence.
function fixture(t,locale="en",{polling=false,scope=""}={}){
  const currentFormaLocale=()=>({locale,formatLocale:locale,messages:stopLocaleCatalogs[locale]});
  const calls=[],queues=[],takers=[],trace=[];
  const window={clearTimeout(){}};
  const fetch=(url,init={method:"GET"})=>{const reading=init.method==="GET";assert.ok(reading?polling&&(/^\/api\/document-jobs(?:\?|$)/u.test(url)||/^\/api\/document-jobs\/[^/]+\?inspection=1$/u.test(url)):url==="/api/document-jobs/adaptive"||/^\/api\/document-jobs\/[^/]+\/(?:cancel|force-fail)$/u.test(url));assert.equal(init.method,reading?"GET":"POST");const gate=deferred(),call={url,init,body:init.body?JSON.parse(init.body):null,gate};calls.push(call);if(takers.length)takers.shift()(call);else queues.push(call);return gate.promise;};
  const pollingMethods=polling?["syncDocumentJobs","#revalidateMissingAdaptivePlans"].map(name=>member(storeSyntax,"FormaStore",name)).join("\n"):'async syncDocumentJobs(){trace.push(["sync-jobs"]);}';
  const Probe=eval(stripTypeScriptTypes(`((DOCUMENT_JOB_KINDS,isDocumentArtifactKind)=>(class {
    #listeners=new Set();#planningConsentScope="";#planningConsentRoute="";#planningConsentResolve;
    #navigationCommit=null;#appendPipeline=Promise.resolve();#pendingAdaptiveIntents=new Map();#adaptiveStructureJobIds=new Map();#dismissedAdaptiveSuggestions=new Set();
    #planningRecoveryIdentities=new Map();#planningRecoverySequence=0;#planningLocaleRevision=0;
    #jobsSyncing=false;#jobSyncScope="";#jobResyncRequested=false;#jobDetails=new Map();#jobPollFailures=0;#jobPollIssueNotified=false;#pendingJobEventRefresh=false;#pendingJobSessionRefresh=false;#pendingJobNotices=[];#jobPollTimer=0;
    #jobScope(){return scope;}onEventRefresh=async()=>{};async #refreshEvents(){await this.onEventRefresh();}#jobResultVisible(){return false;}async #ackJob(){}#jobNotice(){return "";}
    knownPlanJob(documentId){return this.#adaptiveStructureJobIds.get(documentId);}inspectionJob(jobId){return this.#jobDetails.get(jobId);}
    planningConsent=cell(null);route=cell("/document/doc-a/alpha");projection=cell({projectId:"project-a",documentId:"doc-a",documents:[{id:"doc-a",projectId:"project-a",title:"Original document"},{id:"doc-b",projectId:"project-a",title:"Other document"}]});
    session=cell({user:{userId:"actor-a"},impersonation:null,audience:"creative",permissionEpoch:"epoch-a",provider:{configured:true,plannerConfigured:true},policy:{version:"policy-a",accepted:true},projectContext:{organizationId:"org-a",projectAccessId:"access-a",projectId:"project-a",ownerUserId:"owner-a",role:"editor",permissions:["project.read","project.author","project.output.request"]}});
    documentJobs=cell([]);adaptiveStructures=cell({"doc-a":{interpretation:"Existing plan"}});adaptiveSuggestionSets=cell({"doc-a":[{id:"saved-plan",intent:"Saved original intent"}]});content=cell({});events=cell([]);canvasProjection=cell({selectedCanvasId:"board-a"});
    #driveDocumentJobs(jobs){trace.push(["drive",jobs]);}#scheduleJobPoll(delay){trace.push(["poll",delay]);}
    async refreshSession(){trace.push(["refresh-session"]);}
    async confirmImpersonatedInteraction(){throw new Error("Unexpected impersonation");}documentJobActive(){return false;}canvasPlanningDocumentId(){return "doc-a";}toast(value){trace.push(["toast",value]);}pendingIntent(id){return this.#pendingAdaptiveIntents.get(id);}
    ${actualStore}
    ${actualSourceOwnershipStore}
    ${actualLocaleChangeMemberR16()}
    ${member(storeSyntax,"FormaStore","#clearPendingAdaptiveSelection")}
    ${member(storeSyntax,"FormaStore","#canPresentAdaptivePlanningJob")}
    ${pollingMethods}
  }))`))(DOCUMENT_JOB_KINDS,isDocumentArtifactKind);
  const host=new Probe();t.after(()=>host.closePlanningConsent());
  return{host,calls,trace,take:()=>queues.length?Promise.resolve(queues.shift()):new Promise(resolve=>takers.push(resolve)),async reply(call,body,status=200,beforeJson=()=>{}){call.gate.resolve({ok:status>=200&&status<300,status,json:async()=>{beforeJson();return body;}});await turn();}};
}
function quote(request,overrides={}){return{executionId:"approval-a",bindingHash:"hash-a",status:"quoted",providerAvailable:true,canExecute:true,budgetAvailable:true,unavailableReasons:[],operation:"adaptive-structure",actorLabel:"Fixture actor",workspaceId:"org-a",period:"2026-08",expiresAt:"2026-08-27T12:10:00Z",blockId:"",projectId:request.projectId,documentId:request.documentId,canvasId:request.canvasId,privateInput:{approved:"source-a",scope:"document",projectTitle:"Fixture project",documentTitle:"Original title",blockCount:3,documentCount:1,protectedBlockCount:1},models:["model-a"],provider:"openai",maximumMicrousd:5000,maximumTokens:1400,providerCalls:1,searchCalls:0,publicQuery:"",sourceHash:"source-a",...overrides};}
function job(request,executionId="approval-a",overrides={}){return{jobId:executionId,kind:"structure_adaptive",documentId:request.documentId,canvasId:request.canvasId,sourceSurface:request.sourceSurface,requestKey:request.requestKey,status:"completed",result:{structure:{interpretation:"New plan"}},requestedAt:"2026-08-27T00:00:00Z",updatedAt:"2026-08-27T00:00:01Z",completedAt:"2026-08-27T00:00:01Z",...overrides};}
async function open(f,prompt="My original intent",options={},quoteOptions={}){const decision=f.host.structureAdaptive(prompt,options),request=await f.take(),preview=quote(request.body,quoteOptions);assert.equal(request.body.action,"quote");await f.reply(request,{quote:preview});return{decision,request,preview};}
function planningShellMembers() {
  const owner=shellSyntax.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==="FormaShell"),included=new Set();
  function include(name) {
    if(included.has(name))return;
    const node=owner?.members.find(candidate=>candidate.name?.getText(shellSyntax)===name);
    assert.ok(node,"Actual planning shell member exists: "+name);included.add(name);
    function visit(child) {
      if(ts.isPropertyAccessExpression(child)&&child.expression.kind===ts.SyntaxKind.ThisKeyword&&ts.isPrivateIdentifier(child.name))include(child.name.getText(shellSyntax));
      ts.forEachChild(child,visit);
    }
    visit(node);
  }
  include("#planningConsent");
  return owner.members.filter(node=>included.has(node.name?.getText(shellSyntax))).map(node=>node.getText(shellSyntax)).join("\n");
}

function render(f,focusPort={}){
  const handlers=[],nothing=Symbol("nothing"),value=item=>Array.isArray(item)?item.map(value).join(""):typeof item==="function"?`__handler_${handlers.push(item)-1}__`:item===nothing?"":String(item??"");
  const html=(parts,...values)=>parts.reduce((result,part,index)=>result+part+(index<values.length?value(values[index]):""),""),icon=()=>"",i18n={t:(key,_fallback,values)=>values?key+JSON.stringify(values):key,number:String};
  const functionNode=previewSyntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="consequentialPreview");assert.ok(functionNode);
  const consequentialPreview=eval(stripTypeScriptTypes("("+functionNode.getText(previewSyntax).replace(/^export\s+/,"")+")"));
  const dialog=focusPort.dialog??{open:true,close(){this.open=false;f.trace.push(["dialog-close"]);}},store=f.host;
  // Fixture request identifiers are plain ASCII; no browser selector behavior is claimed.
  const CSS={escape:value=>String(value)};
  const Probe=eval(stripTypeScriptTypes(`(class {store=store;i18n=i18n;get isConnected(){return focusPort.connected!==false;}get updateComplete(){return focusPort.updateComplete??Promise.resolve(true);}get ownerDocument(){return focusPort.ownerDocument??document;}requestUpdate(){}querySelector(selector){if(selector===".planning-consent-dialog")return dialog;return focusPort.querySelector?.(selector)??null;}querySelectorAll(selector){return focusPort.querySelectorAll?.(selector)??[];}render(){return this.#planningConsent();}${planningShellMembers()}})`)),probe=new Probe(),markup=probe.render();
  const buttons=[...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([,attrs,label])=>({label,disabled:/\?disabled=true\b/.test(attrs),click:handlers[Number(attrs.match(/@click=__handler_(\d+)__/)?.[1])]}));
  return{markup,buttons,probe,nativeClose:handlers[Number(markup.match(/@close=__handler_(\d+)__/)?.[1])],cancel:handlers[Number(markup.match(/@cancel=__handler_(\d+)__/)?.[1])],keydown:handlers[Number(markup.match(/@keydown=__handler_(\d+)__/)?.[1])]};
}
function entryHost(f,kind,draft="  Keep my exact original intent.\n"){
  const store=f.host,trace=f.trace;
  if(kind==="canvas"){
    const Probe=eval(stripTypeScriptTypes(`(class {store=store;i18n={t:(_key,fallback)=>fallback};#intent=${JSON.stringify(draft)};#intentSubmitting=false;#selected=new Set();#canEditCanvas(){return true;}#anchorDocumentId(){return "doc-a";}#settleCanvasWrites(){return Promise.resolve(true);}#trackCanvasInteraction(...args){trace.push(["interaction",...args]);}requestUpdate(){}get draft(){return this.#intent;}set draft(value){this.#intent=value;}ask(){return this.#askIntent();}${member(canvasSyntax,"CanvasApplication","#askIntent")}})`));return new Probe();
  }
  const Probe=eval(stripTypeScriptTypes(`(class {store=store;#intentPrompt=${JSON.stringify(draft)};requestUpdate(){}get draft(){return this.#intentPrompt;}ask(){return this.#askForma({preventDefault(){}});}tool(event){this.#assistantTool(event);}${member(adaptiveSyntax,"FormaAdaptivePath","#askForma")}${member(adaptiveSyntax,"FormaAdaptivePath","#assistantTool")}})`));return new Probe();
}


// These regressions drive the actual public polling method, then the actual
// review/store/render path. An omitted scoped/page result is not a deletion
// receipt: only a free, exact-ID read may recertify displayed private content.
async function displayedAdaptivePlan(t,{canvasId=null,reader=true,scope=""}={}){
  const f=fixture(t,"en",{polling:true,scope}),saved=await retainedActivity(f,{reader,canvasId});
  if(canvasId){const session=f.host.session.get();f.host.session.set({...session,projectContext:{...session.projectContext,permissions:[...session.projectContext.permissions,"project.canvas.use"]}});}
  const reviewing=f.host.reviewPlanningJob(saved.executionId),resume=await f.take();
  assert.equal(resume.body.action,"resume");await f.reply(resume,saved.body);assert.equal(await reviewing,true);
  assert.deepEqual(f.host.planningConsent.get().recoveredPlan,saved.originalPlan);
  assert.match(render(f).markup,/Original paid interpretation — 原文\./);
  const unrelated={interpretation:"Unrelated document plan must remain"};
  f.host.adaptiveStructures.set({...f.host.adaptiveStructures.get(),"doc-b":unrelated});
  return{f,saved,unrelated};
}
async function missingAdaptiveRead(f,saved,{page={jobs:[]}}={}){
  const pending=f.host.syncDocumentJobs(),list=await f.take();
  assert.equal(list.init.method,"GET");assert.match(list.url,/^\/api\/document-jobs(?:\?|$)/u);
  await f.reply(list,page);
  const exact=await f.take();
  assert.equal(exact.init.method,"GET");assert.equal(exact.url,"/api/document-jobs/"+encodeURIComponent(saved.executionId)+"?inspection=1");
  assert.equal(exact.body,null);
  return{pending,list,exact};
}
function assertUnverifiedAdaptivePlanCleared(f,saved,unrelated,{review=true}={}){
  // R5 contract: clearing private presentation keeps the selected execution ID.
  // Only explicit selection/dismissal changes that content-free identity.
  if(!saved.request.canvasId){assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);assert.equal(f.host.knownPlanJob("doc-a"),saved.executionId);}
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
  assert.equal(f.host.pendingIntent(saved.executionId),undefined);
  assert.ok(!Object.values(f.host.adaptiveSuggestionSets.get()).flat().some(item=>item.id===saved.executionId));
  assert.equal(f.host.inspectionJob(saved.executionId)?.result?.structure,undefined);
  assert.ok(!f.host.documentJobs.get().some(item=>item.jobId===saved.executionId&&item.result?.structure));
  if(!review){assert.equal(f.host.planningConsent.get(),null);return;}
  const state=f.host.planningConsent.get(),view=render(f);
  assert.ok(state);assert.equal(state.recoveryExecutionId,saved.executionId);
  assert.equal(state.quote,null);assert.equal(state.recoveredPlan,undefined);assert.equal(state.submitted,true);
  assert.deepEqual(state.request,{...saved.request,prompt:""});
  assert.ok(state.notice);assert.doesNotMatch(view.markup,/Original paid interpretation|Original next decision|Original later decision|original-private-input|original-paid-model|Preserve the original paid intent/u);
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.retrieveExisting"&&!button.disabled));
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));
  assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview","action.cancel"].includes(button.label)));
}
async function assertNoAutomaticAdaptivePurchase(f,initialCalls=1){
  const calls=f.calls.length;
  await f.host.newPlanningPreview();await f.host.approvePlanningConsent();
  assert.equal(f.calls.length,calls);
  assert.ok(f.calls.slice(initialCalls).every(call=>call.init.method==="GET"));
  assert.equal(f.calls.slice(initialCalls).filter(call=>call.body?.action==="execute"||call.body?.action==="quote").length,0);
}

for(const status of[404,403])test("adaptive disappeared plan: exact "+status+" clears displayed document, private preview and intent but keeps original retrieval",{timeout:3000},async t=>{
  const {f,saved,unrelated}=await displayedAdaptivePlan(t,{reader:false});
  const {pending,exact}=await missingAdaptiveRead(f,saved);
  await f.reply(exact,{error:status===404?"job_not_found":"project_access_required"},status);await pending;
  assertUnverifiedAdaptivePlanCleared(f,saved,unrelated);
  await assertNoAutomaticAdaptivePurchase(f);
  assert.deepEqual(f.calls.map(call=>[call.init.method,call.body?.action??null]),[["POST","resume"],["GET",null],["GET",null]]);
});

for(const canvasId of[null,"original-board"])test("adaptive disappeared plan: "+(canvasId?"Canvas suggestion":"document map")+" is checked after its review closes",{timeout:3000},async t=>{
  const {f,saved,unrelated}=await displayedAdaptivePlan(t,{canvasId});
  if(canvasId)assert.ok(f.host.adaptiveSuggestionSets.get()["doc-a"].some(item=>item.id===saved.executionId));
  else assert.equal(f.host.knownPlanJob("doc-a"),saved.executionId);
  f.host.closePlanningConsent();
  const {pending,exact}=await missingAdaptiveRead(f,saved);
  await f.reply(exact,{error:"job_not_found"},404);await pending;
  assertUnverifiedAdaptivePlanCleared(f,saved,unrelated,{review:false});await assertNoAutomaticAdaptivePurchase(f);
});

test("adaptive disappeared plan: a displayed completed quote is tracked without a preexisting recovery ID",{timeout:3000},async t=>{
  const {f,saved,unrelated}=await displayedAdaptivePlan(t,{reader:false});
  f.host.closePlanningConsent();
  // Re-enter through the actual same-intent free quote path, not through an
  // artificial recoveryExecutionId. The server reuses the original paid quote.
  const reopened=await open(f,saved.request.prompt,saved.request,saved.originalQuote);
  assert.equal(f.host.planningConsent.get().recoveryExecutionId,undefined);
  assert.equal(f.host.planningConsent.get().quote.executionId,saved.executionId);
  assert.match(render(f).markup,/original-private-input/);
  const {pending,exact}=await missingAdaptiveRead(f,saved);
  await f.reply(exact,{error:"job_not_found"},404);await pending;
  assertUnverifiedAdaptivePlanCleared(f,saved,unrelated);await assertNoAutomaticAdaptivePurchase(f,2);
  f.host.closePlanningConsent();await reopened.decision;
});

for(const canvasId of[null,"original-board"])for(const scope of["?document=doc-b",""])test("adaptive disappeared plan: "+(canvasId?"board":"document")+" survives a "+(scope?"scoped":"paginated")+" omission when exact free inspection still verifies it",{timeout:3000},async t=>{
  const {f,saved,unrelated}=await displayedAdaptivePlan(t,{canvasId,scope});
  const {pending,list,exact}=await missingAdaptiveRead(f,saved,{page:{jobs:[],hasMore:true,nextCursor:"earlier-page"}});
  assert.equal(list.url,"/api/document-jobs"+scope);
  const verified={...saved.body.job,updatedAt:"2026-08-27T03:04:05Z",progressMessage:"Retained paid plan verified without provider access"};
  await f.reply(exact,{job:verified});await pending;
  assert.deepEqual(f.host.documentJobs.get(),[],"Exact inspection must not inject an omitted result into the scoped/page feed");
  assert.deepEqual(f.host.inspectionJob(saved.executionId),verified);
  assert.equal(f.host.pendingIntent(saved.executionId),saved.request.prompt);
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
  if(canvasId)assert.deepEqual(f.host.adaptiveSuggestionSets.get()["doc-a"].find(item=>item.id===saved.executionId)?.structure,saved.originalPlan);
  else{assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],saved.originalPlan);assert.equal(f.host.knownPlanJob("doc-a"),saved.executionId);}
  const state=f.host.planningConsent.get();
  assert.equal(state.recoveryExecutionId,saved.executionId);assert.deepEqual(state.recoveredPlan,saved.originalPlan);
  assert.deepEqual(state.request,saved.request);assert.deepEqual(state.quote,saved.originalQuote);
  assert.match(render(f).markup,/Original paid interpretation — 原文\./);
  assert.match(render(f).markup,/original-private-input/);
  assert.ok(f.calls.slice(1).every(call=>call.init.method==="GET"));
});

for(const failure of["transport","http500","missing-job","wrong-id","wrong-document","wrong-board","wrong-request-key","wrong-surface","wrong-execution"])test("adaptive disappeared plan: "+failure+" cannot certify cached private content or offer a repurchase",{timeout:3000},async t=>{
  const {f,saved,unrelated}=await displayedAdaptivePlan(t,{reader:false});
  const {pending,exact}=await missingAdaptiveRead(f,saved);
  if(failure==="transport")exact.gate.reject(new Error("Exact inspection was interrupted"));
  else if(failure==="http500")await f.reply(exact,{error:"temporary_inspection_failure"},500);
  else if(failure==="missing-job")await f.reply(exact,{});
  else{
    const difference=failure==="wrong-id"?{jobId:"other-execution"}:
      failure==="wrong-document"?{documentId:"doc-b"}:
      failure==="wrong-board"?{canvasId:"other-board"}:
      failure==="wrong-request-key"?{requestKey:"adaptive:wrong-source"}:
      failure==="wrong-surface"?{sourceSurface:"canvas"}:{planningExecutionId:"other-execution"};
    await f.reply(exact,{job:{...saved.body.job,...difference}});
  }
  await pending;assertUnverifiedAdaptivePlanCleared(f,saved,unrelated);await assertNoAutomaticAdaptivePurchase(f);
});

for(const stage of["response","json"])test("adaptive disappeared plan: changed authorization during exact "+stage+" read ignores the late private response",{timeout:3000},async t=>{
  const {f,saved}=await displayedAdaptivePlan(t);
  const {pending,exact}=await missingAdaptiveRead(f,saved);
  const replacement={interpretation:"The new actor's unrelated plan"},replacementJob={...saved.body.job,jobId:"new-actor-job",planningExecutionId:"new-actor-job",result:{structure:replacement,intent:"New actor intent"}};
  const replaceActor=()=>{
    const session=f.host.session.get();
    f.host.session.set({...session,user:{userId:"actor-b"},permissionEpoch:"epoch-b",projectContext:{...session.projectContext,projectAccessId:"access-b"}});
    f.host.adaptiveStructures.set({"doc-b":replacement});f.host.adaptiveSuggestionSets.set({});f.host.documentJobs.set([replacementJob]);f.host.notify();
  };
  if(stage==="response")replaceActor();
  await f.reply(exact,{job:saved.body.job},200,stage==="json"?replaceActor:()=>{});await pending;
  assert.equal(f.host.planningConsent.get(),null);
  assert.deepEqual(f.host.adaptiveStructures.get(),{"doc-b":replacement});
  assert.deepEqual(f.host.adaptiveSuggestionSets.get(),{});
  assert.deepEqual(f.host.documentJobs.get(),[replacementJob]);
  assert.equal(f.host.inspectionJob(saved.executionId)?.result?.structure,undefined);
  assert.ok(f.calls.slice(1).every(call=>call.init.method==="GET"));
});



// Keep the user's selected execution separate from its currently available
// private presentation. Network arrival order must never choose a different plan.
async function selectedAdaptivePair(t){
  const {f,saved:older,unrelated}=await displayedAdaptivePlan(t,{reader:false});
  const newerId="newer-selected-execution",newerPlan={...older.originalPlan,interpretation:"LATEST SELECTED PAID PLAN B"};
  const preview=quote(older.request,{executionId:newerId,bindingHash:"newer-binding",sourceHash:"newer-source",status:"quoted",providerAvailable:true,canExecute:true,canPrepareNew:false});
  const preparing=f.host.newPlanningPreview(),newQuote=await f.take();
  assert.equal(newQuote.body.action,"quote");assert.equal(newQuote.body.replaceExecutionId,older.executionId);
  await f.reply(newQuote,{quote:preview});await preparing;
  const executing=f.host.approvePlanningConsent(),approved=await f.take();assert.equal(approved.body.action,"execute");assert.equal(approved.body.executionId,newerId);
  const newerJob={...older.body.job,jobId:newerId,planningExecutionId:newerId,requestedAt:"2026-08-27T01:00:00Z",updatedAt:"2026-08-27T01:00:01Z",completedAt:"2026-08-27T01:00:01Z",result:{intent:older.request.prompt,structure:newerPlan}};
  const newerQuote={...preview,status:"completed",canExecute:false,canPrepareNew:true};
  await f.reply(approved,{quote:newerQuote,planningRequest:older.request,job:newerJob,status:"completed"});await executing;
  assert.equal(f.host.planningConsent.get(),null);assert.equal(f.host.knownPlanJob("doc-a"),newerId);
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],newerPlan);
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
  assert.deepEqual(f.calls.map(call=>call.body?.action),["resume","quote","execute"]);
  return{f,older,newerId,newerJob,newerPlan,newerQuote,unrelated};
}
async function missingAdaptivePairRead(pair){
  const {f,older,newerId}=pair,pending=f.host.syncDocumentJobs(),list=await f.take();
  assert.equal(list.init.method,"GET");assert.equal(list.url,"/api/document-jobs");
  await f.reply(list,{jobs:[],hasMore:true,nextCursor:"an-earlier-page"});
  const reads=[await f.take(),await f.take()],byId=new Map();
  for(const call of reads){
    assert.equal(call.init.method,"GET");assert.equal(call.body,null);
    const id=call.url==="/api/document-jobs/"+encodeURIComponent(older.executionId)+"?inspection=1"?older.executionId:
      call.url==="/api/document-jobs/"+encodeURIComponent(newerId)+"?inspection=1"?newerId:null;
    assert.ok(id,"Only the two exact retained planning identities may be inspected");byId.set(id,call);
  }
  assert.equal(byId.size,2);return{pending,byId};
}
async function selectedAdaptivePairAfterOutage(t){
  const pair=await selectedAdaptivePair(t),{f,older,newerId,unrelated}=pair,first=await missingAdaptivePairRead(pair);
  for(const call of first.byId.values())await f.reply(call,{error:"temporary_inspection_failure"},500);
  await first.pending;
  assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
  assert.equal(f.host.pendingIntent(older.executionId),undefined);assert.equal(f.host.pendingIntent(newerId),undefined);
  assert.equal(f.host.inspectionJob(older.executionId)?.result?.structure,undefined);assert.equal(f.host.inspectionJob(newerId)?.result?.structure,undefined);
  assert.equal(f.host.planningConsent.get(),null);assert.deepEqual(f.host.documentJobs.get(),[]);
  const entries=f.host.planningRecoveryEntries();
  assert.deepEqual(new Set(entries.map(entry=>entry.jobId)),new Set([older.executionId,newerId]));
  assert.doesNotMatch(JSON.stringify(entries),/Original paid interpretation|LATEST SELECTED PAID PLAN B|Preserve the original paid intent|original-private-input/u);
  return{...pair,selectionAfterOutage:f.host.knownPlanJob("doc-a")};
}
function assertSelectionRecoveryMadeNoNewPurchase(f){
  assert.equal(f.calls.slice(3).some(call=>call.body?.action==="quote"||call.body?.action==="execute"),false);
  assert.deepEqual(f.host.events.get(),[]);
}

for(const first of["older","newer"])test("adaptive selection continuity R5: "+first+" response first cannot replace the selected paid plan",{timeout:3000},async t=>{
  const pair=await selectedAdaptivePairAfterOutage(t),{f,older,newerId,newerJob,newerPlan,unrelated,selectionAfterOutage}=pair;
  const next=await missingAdaptivePairRead(pair),order=first==="older"?[older.body.job,newerJob]:[newerJob,older.body.job];
  for(const result of order)await f.reply(next.byId.get(result.jobId),{job:result});
  await next.pending;
  assert.equal(f.host.knownPlanJob("doc-a"),newerId,"Arrival order must not select another valid historical plan");
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],newerPlan);
  assert.equal(selectionAfterOutage,newerId,"The selected ID is content-free metadata and survives private-content clearing");
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
  assert.deepEqual(f.host.documentJobs.get(),[],"Inspection does not inject either result into the page feed");
  assert.equal(f.host.planningConsent.get(),null);assertSelectionRecoveryMadeNoNewPurchase(f);
});

test("adaptive selection continuity R5: dismiss after an outage prevents both pending results from silently selecting a plan",{timeout:3000},async t=>{
  const pair=await selectedAdaptivePairAfterOutage(t),{f,older,newerId,newerJob,unrelated}=pair,next=await missingAdaptivePairRead(pair);
  // The deliberate dismissal wins over exact reads already in flight.
  f.host.dismissAdaptiveStructure("doc-a");
  assert.equal(f.host.knownPlanJob("doc-a"),undefined);assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);
  for(const result of[older.body.job,newerJob])await f.reply(next.byId.get(result.jobId),{job:result});
  await next.pending;
  assert.equal(f.host.knownPlanJob("doc-a"),undefined,"An available historical plan is not a new user selection");
  assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);assert.deepEqual(f.host.documentJobs.get(),[]);
  assert.deepEqual(new Set(f.host.planningRecoveryEntries().map(entry=>entry.jobId)),new Set([older.executionId,newerId]),"Dismissal need not destroy explicit original-ID retrieval");
  assert.equal(f.host.planningConsent.get(),null);assertSelectionRecoveryMadeNoNewPurchase(f);
});

for(const first of["older","newer"])test("adaptive selection continuity R5: explicit older-plan selection beats pending "+first+"-first background reads",{timeout:3000},async t=>{
  const pair=await selectedAdaptivePairAfterOutage(t),{f,older,newerJob,unrelated}=pair,next=await missingAdaptivePairRead(pair);
  // Deliberately choose A while the earlier poll still awaits A and B. Picking
  // the newest timestamp is not a substitute for honoring this explicit choice.
  const reviewing=f.host.reviewPlanningJob(older.executionId),resume=await f.take();
  assert.equal(resume.body.action,"resume");assert.equal(resume.body.executionId,older.executionId);assert.equal(resume.body.prompt,"");
  await f.reply(resume,older.body);assert.equal(await reviewing,true);
  assert.equal(f.host.knownPlanJob("doc-a"),older.executionId);assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],older.originalPlan);
  const order=first==="older"?[older.body.job,newerJob]:[newerJob,older.body.job];
  for(const result of order)await f.reply(next.byId.get(result.jobId),{job:result});
  await next.pending;
  assert.equal(f.host.knownPlanJob("doc-a"),older.executionId);assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],older.originalPlan);
  const state=f.host.planningConsent.get();assert.equal(state.recoveryExecutionId,older.executionId);assert.deepEqual(state.recoveredPlan,older.originalPlan);
  assert.match(render(f).markup,/Original paid interpretation/u);assert.doesNotMatch(render(f).markup,/LATEST SELECTED PAID PLAN B/u);
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);assert.deepEqual(f.host.documentJobs.get().map(job=>job.jobId),[older.executionId]);
  assertSelectionRecoveryMadeNoNewPurchase(f);
});

for(const force of [false,true])test(`actual store stop: ${force?"force-stop":"stop"} never promises an unverified release`,async t=>{
  for(const [budget,expected]of[
    [{reservationStatus:"retained",billingStatus:"pending"},/hold is retained/u],
    [{reservationStatus:"retained",billingStatus:"not-incurred"},/hold remains pending release/u],
    [{reservationStatus:"released",billingStatus:"not-incurred"},/Unused reserved budget was released/u],
    [{reservationStatus:"not-reserved",billingStatus:"not-incurred"},/No budget was reserved/u],
    [{reservationStatus:"settled",billingStatus:"settled"},/Verified provider usage remains charged/u],
    [{reservationStatus:"unknown",billingStatus:"unknown"},/Billing is not yet confirmed/u],
    [undefined,/Billing is not yet confirmed/u],
  ]){
    const f=fixture(t),original=job({documentId:"doc-a",canvasId:null,sourceSurface:"studio",requestKey:"request-a"},"approval-a",{status:"running"});f.host.documentJobs.set([original]);
    const stopping=f.host.stopDocumentJob(original.jobId,force),call=await f.take();assert.equal(call.url,"/api/document-jobs/approval-a/"+(force?"force-fail":"cancel"));
    await f.reply(call,{job:{...original,status:force?"failed":"canceled"},stoppedCount:1,...(budget?{budget}:{})});assert.equal(await stopping,true);
    const messages=f.trace.filter(([kind])=>kind==="toast").map(([,message])=>message);assert.equal(messages.length,1);assert.match(messages[0],expected);
    if(budget?.reservationStatus!=="released")assert.doesNotMatch(messages[0],/was released|released budget/u);
    assert.ok(f.trace.some(([kind])=>kind==="sync-jobs"));assert.ok(f.trace.some(([kind])=>kind==="refresh-session"));
  }
});
test("actual store stop: completed or still-running races do not claim a successful cancellation",async t=>{
  for(const status of ["completed","failed","running"]){
    const f=fixture(t),original=job({documentId:"doc-a",canvasId:null,sourceSurface:"studio",requestKey:"request-a"},"approval-a",{status:"running"});f.host.documentJobs.set([original]);
    const stopping=f.host.stopDocumentJob(original.jobId),call=await f.take();
    await f.reply(call,{job:{...original,status},stoppedCount:0,budget:status!=="running"?{reservationStatus:"settled",billingStatus:"settled"}:{reservationStatus:"retained",billingStatus:"pending"}});
    assert.equal(await stopping,status!=="running");
    const message=f.trace.find(([kind])=>kind==="toast")[1];assert.match(message,status!=="running"?/Operation already finished/u:/stop is not yet confirmed/u);assert.doesNotMatch(message,/Operation stopped|was released/u);
  }
});

for(const locale of ["fr","ar","ja"])test(`actual store stop: ${locale} translates live typed billing separately from the outcome`,async t=>{
  const catalog=stopLocaleCatalogs[locale],translate=source=>catalog[formaSystemMessageId(source)];
  for(const force of [false,true])for(const budget of [
    {reservationStatus:"retained",billingStatus:"pending"},
    {reservationStatus:"retained",billingStatus:"not-incurred"},
    {reservationStatus:"released",billingStatus:"not-incurred"},
    {reservationStatus:"not-reserved",billingStatus:"not-incurred"},
    {reservationStatus:"settled",billingStatus:"settled"},
    {reservationStatus:"unknown",billingStatus:"unknown"},
  ]){
    const f=fixture(t,locale),original=job({documentId:"doc-a",canvasId:null,sourceSurface:"studio",requestKey:"request-a"},"approval-a",{status:"running"});
    f.host.documentJobs.set([original]);const stopping=f.host.stopDocumentJob(original.jobId,force),call=await f.take();
    // Cached human text is deliberately misleading; only this response's typed budget controls the toast.
    await f.reply(call,{job:{...original,status:force?"failed":"canceled",progressMessage:"Unused reserved budget was released.",result:{billingStatus:"settled"}},stoppedCount:1,budget});
    assert.equal(await stopping,true);
    const source=documentJobStopBudgetMessage(budget),outcome=force?"Operation force-failed.":"Operation stopped.";
    assert.ok(translate(source));assert.notEqual(translate(source),source);
    assert.equal(f.trace.find(([kind])=>kind==="toast")[1],translate(outcome)+" "+translate(source));
  }
  for(const status of ["completed","running"]){
    const f=fixture(t,locale),original=job({documentId:"doc-a",canvasId:null,sourceSurface:"studio",requestKey:"request-a"},"approval-a",{status:"running"});
    f.host.documentJobs.set([original]);const stopping=f.host.stopDocumentJob(original.jobId),call=await f.take(),budget={reservationStatus:"retained",billingStatus:"pending"};
    await f.reply(call,{job:{...original,status},stoppedCount:0,budget});assert.equal(await stopping,status==="completed");
    assert.equal(f.trace.find(([kind])=>kind==="toast")[1],translate(status==="completed"?"Operation already finished.":"The stop is not yet confirmed.")+" "+translate(documentJobStopBudgetMessage(budget)));
  }
});

test("planning store previews for free before explicit approval and keeps the existing plan",async t=>{
  const f=fixture(t),old=structuredClone(f.host.adaptiveStructures.get()),opened=await open(f);assert.deepEqual(f.calls.map(call=>call.body.action),["quote"]);assert.deepEqual(f.host.adaptiveStructures.get(),old);assert.equal(f.host.documentJobs.get().length,0);assert.deepEqual(f.trace,[]);assert.equal(Object.hasOwn(opened.request.body,"executionId"),false);
  const approving=f.host.approvePlanningConsent(),submitted=await f.take();assert.equal(submitted.body.action,"execute");assert.equal(submitted.body.executionId,opened.preview.executionId);assert.equal(submitted.body.approvedBindingHash,opened.preview.bindingHash);await f.host.approvePlanningConsent();assert.equal(f.calls.length,2);
  await f.reply(submitted,{job:job(submitted.body,"approval-a",{status:"queued",result:{}})});await approving;assert.equal(await opened.decision,true);assert.deepEqual(f.host.adaptiveStructures.get(),old);assert.equal(f.host.pendingIntent("approval-a"),"My original intent");
});
test("closing a free preview preserves saved plans and ignores its late response",async t=>{
  const f=fixture(t),plans=structuredClone(f.host.adaptiveStructures.get()),sets=structuredClone(f.host.adaptiveSuggestionSets.get()),decision=f.host.structureAdaptive("Original intent"),request=await f.take();f.host.closePlanningConsent();assert.equal(await decision,false);await f.reply(request,{quote:quote(request.body)});assert.equal(f.host.planningConsent.get(),null);assert.deepEqual(f.host.adaptiveStructures.get(),plans);assert.deepEqual(f.host.adaptiveSuggestionSets.get(),sets);assert.equal(f.calls.length,1);
});
test("a canceled quote cannot overwrite a newly opened review in the same route and scope",async t=>{
  const f=fixture(t),first=f.host.structureAdaptive("First intent"),old=await f.take();f.host.closePlanningConsent();assert.equal(await first,false);const second=f.host.structureAdaptive("Second intent"),current=await f.take();await f.reply(current,{quote:quote(current.body,{executionId:"current",bindingHash:"current-hash"})});await f.reply(old,{quote:quote(old.body,{executionId:"obsolete",bindingHash:"obsolete-hash"})});assert.equal(f.host.planningConsent.get().request.prompt,"Second intent");assert.equal(f.host.planningConsent.get().quote.executionId,"current");f.host.closePlanningConsent();assert.equal(await second,false);
});
test("lost approval response preserves its exact identity and permits Retrieve only",async t=>{
  const f=fixture(t),opened=await open(f),approving=f.host.approvePlanningConsent(),submitted=await f.take();submitted.gate.reject(new Error("Lost response"));await approving;assert.equal(f.host.planningConsent.get().quote.status,"uncertain");assert.equal(f.host.planningConsent.get().quote.executionId,opened.preview.executionId);assert.equal(f.host.planningConsent.get().quote.bindingHash,opened.preview.bindingHash);
  const view=render(f);assert.ok(view.buttons.some(button=>button.label==="context.consent.reuse"&&!button.disabled));assert.ok(!view.buttons.some(button=>button.label==="planning.consent.approve"));const retrieving=f.host.approvePlanningConsent(),retrieval=await f.take();assert.equal(retrieval.body.action,"retrieve");assert.equal(retrieval.body.executionId,opened.preview.executionId);assert.equal(retrieval.body.approvedBindingHash,opened.preview.bindingHash);await f.reply(retrieval,{status:"uncertain"},409);await retrieving;assert.deepEqual(f.calls.map(call=>call.body.action),["quote","execute","retrieve"]);assert.equal(contextConsentAction(f.host.planningConsent.get().quote.status,true).action,"retrieve");
});
test("a cross-session winner replaces the full preview and subsequent retrieval uses its id and hash",async t=>{
  const f=fixture(t),opened=await open(f),winner=quote(opened.request.body,{executionId:"winner-b",bindingHash:"winner-hash",status:"reserved",privateInput:{approved:"winner-b-exact-input"},sourceHash:"winner-source",models:["winner-model"],maximumMicrousd:8000}),approving=f.host.approvePlanningConsent(),submitted=await f.take();
  await f.reply(submitted,{quote:winner,status:"reserved",job:job(opened.request.body,"winner-b",{planningExecutionId:"winner-b",status:"running",result:{planningReviewAvailable:true}}),requestedExecutionId:opened.preview.executionId,reusedExecutionId:winner.executionId},202);await approving;assert.deepEqual(f.host.planningConsent.get().quote,winner);assert.equal(await opened.decision,true);const view=render(f);assert.match(view.markup,/winner-b-exact-input/);assert.match(view.markup,/winner-source/);assert.match(view.markup,/winner-model/);assert.match(view.markup,/USD 0\.0080/);assert.doesNotMatch(view.markup,/source-a|model-a/);
  const retrieving=f.host.approvePlanningConsent(),retrieval=await f.take();assert.equal(retrieval.body.action,"retrieve");assert.equal(retrieval.body.executionId,"winner-b");assert.equal(retrieval.body.approvedBindingHash,"winner-hash");await f.reply(retrieval,{quote:{...winner,status:"completed"},job:job(opened.request.body,"winner-b",{planningExecutionId:"winner-b"})});await retrieving;assert.equal(f.host.planningConsent.get().recoveryExecutionId,"winner-b");assert.equal(f.host.documentJobs.get()[0].jobId,"winner-b");
});
test("completed cross-session winner is accepted only with the explicit requested/reused execution pair",async t=>{
  const f=fixture(t),opened=await open(f),approving=f.host.approvePlanningConsent(),submitted=await f.take(),winner=quote(opened.request.body,{executionId:"winner-b",bindingHash:"winner-hash",status:"completed",privateInput:{approved:"winner-b"}});
  await f.reply(submitted,{quote:winner,job:job(opened.request.body,"winner-b",{planningExecutionId:"winner-b"}),requestedExecutionId:opened.preview.executionId,reusedExecutionId:winner.executionId});await approving;assert.equal(f.host.planningConsent.get().recoveryExecutionId,"winner-b");assert.equal(await opened.decision,true);assert.equal(f.host.documentJobs.get()[0].jobId,"winner-b");assert.equal(f.host.adaptiveStructures.get()["doc-a"].interpretation,"New plan");
});
test("a missing or mismatched redirect pair cannot admit another execution result",async t=>{
  for(const pair of[{}, {requestedExecutionId:"wrong",reusedExecutionId:"winner-b"},{requestedExecutionId:"approval-a",reusedExecutionId:"wrong"}]){
    const f=fixture(t),opened=await open(f),old=structuredClone(f.host.adaptiveStructures.get()),approving=f.host.approvePlanningConsent(),submitted=await f.take(),winner=quote(opened.request.body,{executionId:"winner-b",bindingHash:"winner-hash",status:"completed"});await f.reply(submitted,{quote:winner,job:job(opened.request.body,"winner-b"),...pair});await approving;assert.equal(f.host.documentJobs.get().length,0);assert.deepEqual(f.host.adaptiveStructures.get(),old);assert.notEqual(f.host.planningConsent.get(),null);assert.equal(f.host.planningConsent.get().quote.executionId,opened.preview.executionId);f.host.closePlanningConsent();assert.equal(await opened.decision,false);
  }
});
for(const phase of["quote","execute"])for(const changed of["actor","permission","custody","route"])test(`late ${phase} response is ignored after ${changed} changes during JSON decoding`,async t=>{
  const f=fixture(t),old=structuredClone(f.host.adaptiveStructures.get());let decision,request,action;if(phase==="quote"){decision=f.host.structureAdaptive("Original");request=await f.take();}else{const opened=await open(f);decision=opened.decision;action=f.host.approvePlanningConsent();request=await f.take();}
  await f.reply(request,phase==="quote"?{quote:quote(request.body)}:{job:job(request.body)},200,()=>{const session=f.host.session.get();if(changed==="route")f.host.route.set("/document/doc-b/beta");else f.host.session.set(changed==="actor"?{...session,user:{userId:"actor-b"}}:changed==="permission"?{...session,permissionEpoch:"epoch-b"}:{...session,projectContext:{...session.projectContext,projectAccessId:"access-b"}});f.host.notify();});await action;assert.equal(await decision,false);assert.equal(f.host.planningConsent.get(),null);assert.equal(f.host.documentJobs.get().length,0);assert.deepEqual(f.host.adaptiveStructures.get(),old);
});
test("a result for the wrong document, board, surface, request, or execution never replaces the saved plan",async t=>{
  for(const difference of[{documentId:"doc-b"},{canvasId:"board-b"},{sourceSurface:"canvas"},{requestKey:"another-request"},{jobId:"other-execution"}]){
    const f=fixture(t),old=structuredClone(f.host.adaptiveStructures.get()),opened=await open(f),approving=f.host.approvePlanningConsent(),submitted=await f.take();await f.reply(submitted,{job:job(opened.request.body,"approval-a",difference)});await approving;assert.deepEqual(f.host.adaptiveStructures.get(),old);assert.equal(f.host.documentJobs.get().length,0);assert.equal(f.host.planningConsent.get().notice,"uncertain");f.host.closePlanningConsent();assert.equal(await opened.decision,false);
  }
});
test("a wrong-scope pending preview is rejected before replacing the original approval",async t=>{
  const f=fixture(t),opened=await open(f),approving=f.host.approvePlanningConsent(),submitted=await f.take();await f.reply(submitted,{quote:quote(opened.request.body,{documentId:"doc-b",status:"reserved"})},409);await approving;assert.equal(f.host.planningConsent.get().quote.documentId,"doc-a");assert.equal(f.host.planningConsent.get().quote.executionId,opened.preview.executionId);assert.equal(f.host.documentJobs.get().length,0);
});
test("planning preview names original source breadth and destination outside the exact-input disclosure",async t=>{
  const f=fixture(t),opened=await open(f,"Original",{canvasId:"board-a",sourceSurface:"canvas",projectScope:true},{privateInput:{scope:"whole-project",projectTitle:"Original project",documentTitle:"Original document",canvasTitle:"Original board",blockCount:61,documentCount:3,protectedBlockCount:8}}),view=render(f),summary=view.markup.split("<details>")[0];
  assert.match(summary,/planning\.consent\.scopeProject/u);assert.match(summary,/"count":"61"/u);assert.match(summary,/"documents":"3"/u);assert.match(summary,/Original project/u);assert.match(summary,/Original document \/ Original board/u);assert.match(summary,/planning\.consent\.protected\{"count":"8"\}/u);
  f.host.projection.set({projectId:"project-a",documentId:"doc-a",documentTitle:"Renamed later"});assert.doesNotMatch(render(f).markup.split("<details>")[0],/Renamed later/u);f.host.closePlanningConsent();assert.equal(await opened.decision,false);
});
test("provider-disabled planning opens a free preview; approval is disabled and saved retrieval is enabled",async t=>{
  const f=fixture(t),session=f.host.session.get();f.host.session.set({...session,provider:{configured:false,plannerConfigured:false}});const opened=await open(f,"Original",{},{providerAvailable:false,canExecute:false});let view=render(f);assert.match(view.markup,/context\.consent\.unavailable/);assert.ok(view.buttons.some(button=>button.label==="planning.consent.approve"&&button.disabled));await f.host.approvePlanningConsent();assert.equal(f.calls.length,1);f.host.planningConsent.set({...f.host.planningConsent.get(),quote:{...opened.preview,status:"completed"}});view=render(f);assert.ok(view.buttons.some(button=>button.label==="context.consent.reuse"&&!button.disabled));const retrieving=f.host.approvePlanningConsent(),call=await f.take();assert.equal(call.body.action,"retrieve");await f.reply(call,{job:job(call.body)});await retrieving;assert.equal(await opened.decision,true);
});
for(const reason of["budget","policy"])test(`${reason}-blocked approval preserves the free preview and allows saved retrieval`,async t=>{
  const f=fixture(t),blocked={canExecute:false,...(reason==="budget"?{budgetAvailable:false}:{unavailableReasons:["policy_unavailable"]})},opened=await open(f,"Original",{},blocked);let view=render(f);assert.ok(view.markup.includes(reason==="budget"?"planning.consent.budgetUnavailable":"planning.consent.policyUnavailable"));assert.ok(view.buttons.some(button=>button.label==="planning.consent.approve"&&button.disabled));await f.host.approvePlanningConsent();assert.equal(f.calls.length,1);f.host.planningConsent.set({...f.host.planningConsent.get(),quote:{...opened.preview,status:"completed"}});view=render(f);assert.ok(view.buttons.some(button=>button.label==="context.consent.reuse"&&!button.disabled));const retrieving=f.host.approvePlanningConsent(),call=await f.take();assert.equal(call.body.action,"retrieve");await f.reply(call,{job:job(call.body)});await retrieving;assert.equal(await opened.decision,true);
});
test("actual shell Escape cancels free review without changing saved plans or submitting work",async t=>{
  const f=fixture(t),opened=await open(f),view=render(f);assert.match(view.markup,/aria-labelledby="planning-consent-title"/);assert.match(view.markup,/aria-describedby="planning-consent-description"/);let prevented=false;view.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(await opened.decision,false);assert.equal(f.host.adaptiveStructures.get()["doc-a"].interpretation,"Existing plan");assert.equal(f.calls.length,1);
});
test("actual shell keyboard Escape closes only the planning review and ignores composition",async t=>{
  const f=fixture(t),opened=await open(f),view=render(f);let prevented=false,stopped=false;const event={key:"Escape",isComposing:true,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}};
  view.keydown(event);assert.notEqual(f.host.planningConsent.get(),null);assert.equal(prevented,false);assert.equal(stopped,false);
  event.isComposing=false;view.keydown(event);assert.equal(await opened.decision,false);assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(f.calls.length,1);assert.equal(f.host.adaptiveStructures.get()["doc-a"].interpretation,"Existing plan");
});
for(const kind of["canvas","adaptive"])test(`actual ${kind} entry preserves original intent while reviewing and after cancel`,{timeout:2000},async t=>{
  const f=fixture(t),draft="  Keep my exact original intent.\n",entry=entryHost(f,kind,draft),pending=entry.ask(),call=await f.take();await f.reply(call,{quote:quote(call.body)});assert.equal(entry.draft,draft);f.host.closePlanningConsent();await pending;assert.equal(entry.draft,draft);assert.deepEqual(f.calls.map(request=>request.body.action),["quote"]);
});
for(const kind of["canvas","adaptive"])test(`actual ${kind} entry permits provider-disabled free previews`,{timeout:2000},async t=>{
  const f=fixture(t),session=f.host.session.get();f.host.session.set({...session,provider:{configured:false,plannerConfigured:false}});const entry=entryHost(f,kind),pending=entry.ask(),outcome=await Promise.race([f.take().then(call=>({call})),Promise.resolve(pending).then(returned=>({returned}))]);assert.ok(outcome.call,"Provider configuration must gate paid approval, not free preview");const call=outcome.call;await f.reply(call,{quote:quote(call.body,{providerAvailable:false,canExecute:false})});assert.equal(call.body.action,"quote");f.host.closePlanningConsent();await pending;
});
test("actual adaptive assistant planning tool routes to the free preview while the provider is disabled",async t=>{
  const f=fixture(t),session=f.host.session.get();f.host.session.set({...session,provider:{configured:false,plannerConfigured:false}});const entry=entryHost(f,"adaptive"),resolved=deferred(),event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},detail:{mode:"plan-document",actorUserId:"actor-a",projectId:"project-a",documentId:"doc-a",canvasId:null,message:"Original assistant intent",resolve:resolved.resolve}};entry.tool(event);assert.equal(event.defaultPrevented,true);const call=await f.take();await f.reply(call,{quote:quote(call.body,{providerAvailable:false,canExecute:false})});f.host.closePlanningConsent();assert.equal(await resolved.promise,false);assert.equal(call.body.action,"quote");
});

for(const scope of["personal","project"])for(const missing of["both","author","output"])test(`adaptive personal reader R3: ${scope} recovery with missing ${missing} capability never offers replacement despite a permissive receipt`,{timeout:2000},async t=>{
  const f=fixture(t),saved=await retainedActivity(f,{reader:false}),session=f.host.session.get();
  const permissions=["project.read",...(missing==="author"?["project.output.request"]:missing==="output"?["project.author"]:[])];
  saved.originalQuote.canPrepareNew=true;
  f.host.session.set(scope==="personal"?{...session,user:{...session.user,role:"viewer"},capabilities:permissions,projectContext:null}:{...session,capabilities:["project.read","project.author","project.output.request"],projectContext:{...session.projectContext,role:"viewer",permissions}});
  if(scope==="personal")saved.originalQuote.workspaceId=null;
  const reviewing=f.host.reviewPlanningJob(saved.executionId),resume=await f.take();assert.equal(resume.body.action,"resume");await f.reply(resume,saved.body);await reviewing;
  const before=f.host.planningConsent.get(),view=render(f);assert.equal(f.host.canPreparePlanning(),false);assert.match(view.markup,/Original paid interpretation/);assert.ok(!view.buttons.some(button=>["planning.consent.newPreview","planning.consent.approve","context.consent.preview"].includes(button.label)));
  await f.host.newPlanningPreview();assert.deepEqual(f.calls.map(call=>call.body.action),["resume"]);const after=f.host.planningConsent.get();assert.equal(after.quote,before.quote);assert.equal(after.recoveryExecutionId,saved.executionId);assert.deepEqual(after.recoveredPlan,saved.originalPlan);assert.deepEqual(after.request,saved.request);assert.equal(after.submitted,true);
});

for(const failure of["denied","transport","malformed","wrong-scope"])test(`adaptive personal reader R3: ${failure} new-preview response preserves the original personal-author review`,{timeout:2000},async t=>{
  const f=fixture(t),saved=await retainedActivity(f,{reader:false}),session=f.host.session.get();saved.originalQuote.workspaceId=null;
  f.host.session.set({...session,user:{...session.user,role:"creator"},capabilities:["project.read","project.author","project.output.request"],projectContext:null});
  const reviewing=f.host.reviewPlanningJob(saved.executionId),resume=await f.take();await f.reply(resume,saved.body);await reviewing;assert.equal(f.host.canPreparePlanning(),true);
  const original=f.host.planningConsent.get(),plans=structuredClone(f.host.adaptiveStructures.get()),preparing=f.host.newPlanningPreview(),attempt=await f.take();assert.equal(attempt.body.action,"quote");assert.equal(attempt.body.replaceExecutionId,saved.executionId);assert.equal(Object.hasOwn(attempt.body,"approvedBindingHash"),false);assert.equal(Object.hasOwn(attempt.body,"executionId"),false);
  const pending=f.host.planningConsent.get();assert.equal(pending.quote,original.quote);assert.deepEqual(pending.recoveredPlan,saved.originalPlan);assert.equal(pending.recoveryExecutionId,saved.executionId);assert.match(render(f).markup,/Original paid interpretation/);
  if(failure==="transport")attempt.gate.reject(new Error("Connection ended during the free preview"));
  else if(failure==="denied")await f.reply(attempt,{error:"context_project_denied",submission:"not-submitted"},403);
  else if(failure==="malformed")await f.reply(attempt,{});
  else await f.reply(attempt,{quote:quote(saved.request,{executionId:"wrong-preview",bindingHash:"wrong-binding",documentId:"doc-b"})});
  await preparing;const state=f.host.planningConsent.get(),view=render(f);assert.equal(state.quote,original.quote);assert.equal(state.recoveryExecutionId,saved.executionId);assert.deepEqual(state.recoveredPlan,saved.originalPlan);assert.deepEqual(state.request,saved.request);assert.equal(state.replaceExecutionId,undefined);assert.equal(state.submitted,true);assert.equal(state.notice,"failed");assert.equal(state.working,false);
  assert.match(view.markup,/Original paid interpretation/);assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","action.cancel"].includes(button.label)));assert.deepEqual(f.calls.map(call=>call.body.action),["resume","quote"]);assert.deepEqual(f.host.adaptiveStructures.get(),plans);assert.equal(f.host.documentJobs.get()[0].jobId,saved.executionId);
});


// Confirmed withdrawal of the old paid execution is different from a failed
// attempt to prepare new work: keep its identity, never its withdrawn bytes.
for(const canvasId of[null,"original-board"])for(const error of["adaptive_existing_request_unavailable","adaptive_result_unavailable"])test("adaptive withdrawn preview R4: "+error+" clears the original "+(canvasId?"board":"document")+" private review",{timeout:3000},async t=>{
  const {f,saved,unrelated}=await displayedAdaptivePlan(t,{reader:false,canvasId}),initial=render(f);
  const next=initial.buttons.find(button=>button.label==="planning.consent.newPreview");
  assert.ok(next&&!next.disabled,"The actual rendered New preview control must be available");
  next.click();const attempt=await f.take();
  assert.equal(attempt.body.action,"quote");assert.equal(attempt.body.replaceExecutionId,saved.executionId);
  assert.equal(attempt.body.documentId,saved.request.documentId);assert.equal(attempt.body.canvasId,canvasId);
  assert.equal(attempt.body.prompt,saved.request.prompt);assert.equal(Object.hasOwn(attempt.body,"approvedBindingHash"),false);
  await f.reply(attempt,{error,noAutomaticRetry:true},409);
  assert.equal(f.host.planningConsent.get().working,false);
  assertUnverifiedAdaptivePlanCleared(f,saved,unrelated);
  await assertNoAutomaticAdaptivePurchase(f,2);
  assert.deepEqual(f.calls.map(call=>call.body?.action),["resume","quote"]);
  const retrieve=render(f).buttons.find(button=>button.label==="planning.consent.retrieveExisting");
  assert.ok(retrieve&&!retrieve.disabled);retrieve.click();const same=await f.take();
  assert.equal(same.body.action,"resume");assert.equal(same.body.executionId,saved.executionId);
  assert.equal(same.body.documentId,saved.request.documentId);assert.equal(same.body.canvasId,canvasId);
  assert.equal(same.body.prompt,"");assert.equal(same.body.requestKey,saved.request.requestKey);
  assert.equal(Object.hasOwn(same.body,"approvedBindingHash"),false);assert.equal(Object.hasOwn(same.body,"replaceExecutionId"),false);
  await f.reply(same,{error:"adaptive_execution_unavailable",noAutomaticRetry:true},404);
  assertUnverifiedAdaptivePlanCleared(f,saved,unrelated);
  assert.deepEqual(f.calls.map(call=>call.body?.action),["resume","quote","resume"]);
  assert.equal(f.calls.some(call=>call.body?.action==="execute"),false);
});

for(const failure of["denied","transport","malformed"])test("adaptive withdrawn preview R4: ordinary "+failure+" preparation failure preserves valid paid work",{timeout:3000},async t=>{
  const {f,saved}=await displayedAdaptivePlan(t,{reader:false}),original=f.host.planningConsent.get();
  const plans=structuredClone(f.host.adaptiveStructures.get()),jobs=structuredClone(f.host.documentJobs.get()),suggestions=structuredClone(f.host.adaptiveSuggestionSets.get());
  const next=render(f).buttons.find(button=>button.label==="planning.consent.newPreview");assert.ok(next&&!next.disabled);next.click();
  const attempt=await f.take();assert.equal(attempt.body.action,"quote");assert.equal(attempt.body.replaceExecutionId,saved.executionId);
  if(failure==="transport"){attempt.gate.reject(new Error("New free preview connection was lost"));await turn();}
  else if(failure==="denied")await f.reply(attempt,{error:"context_project_denied",submission:"not-submitted"},403);
  else await f.reply(attempt,{});
  const state=f.host.planningConsent.get(),view=render(f);
  assert.equal(state.working,false);assert.equal(state.replaceExecutionId,undefined);assert.equal(state.notice,"failed");
  assert.equal(state.recoveryExecutionId,saved.executionId);assert.equal(state.submitted,true);
  assert.deepEqual(state.quote,original.quote);assert.deepEqual(state.recoveredPlan,saved.originalPlan);assert.deepEqual(state.request,saved.request);
  assert.deepEqual(f.host.adaptiveStructures.get(),plans);assert.deepEqual(f.host.documentJobs.get(),jobs);assert.deepEqual(f.host.adaptiveSuggestionSets.get(),suggestions);
  assert.equal(f.host.pendingIntent(saved.executionId),saved.request.prompt);assert.equal(f.host.knownPlanJob("doc-a"),saved.executionId);
  assert.match(view.markup,/Original paid interpretation|original-private-input/u);
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));
  assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","action.cancel"].includes(button.label)));
  assert.deepEqual(f.calls.map(call=>call.body?.action),["resume","quote"]);
});

// Re-entry is retrieval of a retained execution, never reconstruction of a purchase.
// Actual public store/poll/render methods, with only response delivery reordered.
// A newer withdrawal or certification must win over an older in-flight read.
async function readInvalidationFixtureR5(t,canvasId){
  const f=fixture(t,"en",{polling:true}),saved=await retainedActivity(f,{reader:true,canvasId});
  if(canvasId){const session=f.host.session.get();f.host.session.set({...session,projectContext:{...session.projectContext,permissions:[...session.projectContext.permissions,"project.canvas.use"]}});}
  const unrelated={interpretation:"Unrelated document plan must remain"};
  f.host.adaptiveStructures.set({"doc-b":unrelated});f.host.adaptiveSuggestionSets.set({});
  f.host.documentJobs.set([{...saved.originalJob,status:"running",result:{planningReviewAvailable:true}}]);
  return{f,saved,unrelated};
}
async function releaseOldPlanningReadR5(f,call,kind,body){
  if(kind==="non-JSON"){
    call.gate.resolve({ok:true,status:200,json:async()=>{throw new SyntaxError("Delayed unreadable response");}});await turn();
  }else if(kind==="HTTP404")await f.reply(call,{error:"adaptive_execution_unavailable"},404);
  else await f.reply(call,body);
}
function assertInvalidatedPlanningReadR5(f,saved,unrelated){
  if(!saved.request.canvasId){assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);assert.ok([undefined,saved.executionId].includes(f.host.knownPlanJob("doc-a")),"Private erasure may retain the original content-free selection, never select a different plan");}
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
  assert.equal(f.host.pendingIntent(saved.executionId),undefined);assert.equal(f.host.inspectionJob(saved.executionId)?.result?.structure,undefined);
  assert.ok(!Object.values(f.host.adaptiveSuggestionSets.get()).flat().some(item=>item.id===saved.executionId));
  assert.ok(!f.host.documentJobs.get().some(item=>item.jobId===saved.executionId&&item.result?.structure));
  const state=f.host.planningConsent.get(),view=render(f);
  assert.equal(state.recoveryExecutionId,saved.executionId);assert.equal(state.quote,null);assert.equal(state.recoveredPlan,undefined);
  assert.deepEqual(state.request,{...saved.request,prompt:""});assert.equal(state.submitted,true);assert.ok(state.notice);
  assert.equal(state.working,false,"Discarding an older read must not strand the original retrieval control");
  assert.doesNotMatch(view.markup,/Original paid interpretation|Original next decision|Original later decision|original-private-input|original-paid-model|Preserve the original paid intent/u);
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.retrieveExisting"&&!button.disabled));
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));
  assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview","action.cancel"].includes(button.label)));
  assertOnlyOriginalPlanningReads(f,saved);
}
function assertRecertifiedPlanningReadR5(f,saved,unrelated){
  const state=f.host.planningConsent.get(),view=render(f);
  assert.equal(state.recoveryExecutionId,saved.executionId);assert.equal(state.quote.executionId,saved.executionId);
  assert.equal(state.quote.bindingHash,saved.originalQuote.bindingHash);assert.deepEqual(state.request,saved.request);
  assert.deepEqual(state.recoveredPlan,saved.originalPlan);assert.equal(state.notice,"");assert.equal(state.working,false);
  assert.match(view.markup,/Original paid interpretation — 原文\./u);assert.match(view.markup,/original-private-input/u);
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));
  assert.ok(!view.buttons.some(button=>["planning.consent.approve","planning.consent.newPreview","context.consent.preview","action.cancel"].includes(button.label)));
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
  if(saved.request.canvasId)assert.deepEqual(f.host.adaptiveSuggestionSets.get()["doc-a"]?.find(item=>item.id===saved.executionId)?.structure,saved.originalPlan);
  else assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],saved.originalPlan);
  assertOnlyOriginalPlanningReads(f,saved);
}
async function deliberatelyRecertifyPlanningReadR5(f,saved,unrelated){
  const reading=f.host.previewPlanningConsent();
  const next=await Promise.race([f.take().then(call=>({call})),Promise.resolve(reading).then(()=>({finished:true}))]);
  assert.ok(next.call,"A deliberate free retrieval must remain available for the exact original identity");
  assert.equal(next.call.body.action,"resume");assert.equal(next.call.body.executionId,saved.executionId);
  assert.equal(next.call.body.prompt,"");assert.equal(Object.hasOwn(next.call.body,"approvedBindingHash"),false);
  await f.reply(next.call,saved.body);await reading;assertRecertifiedPlanningReadR5(f,saved,unrelated);
}

for(const canvasId of[null,"original-board"]){
  const surface=canvasId?"Canvas":"Document";
  for(const olderResponse of["successful","non-JSON"])test("adaptive read invalidation R5: "+surface+" newer withdrawal wins over an older "+olderResponse+" resume, then deliberate recovery remains free",{timeout:3000},async t=>{
    const {f,saved,unrelated}=await readInvalidationFixtureR5(t,canvasId);
    const opening=f.host.reviewPlanningJob(saved.executionId),older=await f.take();assert.equal(older.body.action,"resume");
    const polling=f.host.syncDocumentJobs(),list=await f.take();assert.equal(list.init.method,"GET");
    await f.reply(list,{jobs:[{...saved.originalJob,result:{planningReviewAvailable:false,resultUnavailable:true}}]});await polling;
    assert.equal(f.host.planningConsent.get().quote,null);assert.equal(f.host.planningConsent.get().request.prompt,"");
    await releaseOldPlanningReadR5(f,older,olderResponse,saved.body);await opening;
    assertInvalidatedPlanningReadR5(f,saved,unrelated);
    await deliberatelyRecertifyPlanningReadR5(f,saved,unrelated);
    assert.deepEqual(f.calls.map(call=>call.init.method==="GET"?"GET":call.body.action),["resume","GET","resume"]);
  });
  test("adaptive read invalidation R5: "+surface+" ordinary retained pending updates do not invalidate its original resume",{timeout:3000},async t=>{
    const {f,saved,unrelated}=await readInvalidationFixtureR5(t,canvasId);
    const opening=f.host.reviewPlanningJob(saved.executionId),older=await f.take();
    for(const status of["running","committing"]){
      const polling=f.host.syncDocumentJobs(),list=await f.take();
      await f.reply(list,{jobs:[{...saved.originalJob,status,result:{planningReviewAvailable:true}}]});await polling;
      assert.equal(f.host.planningConsent.get().recoveryExecutionId,saved.executionId);
    }
    await f.reply(older,saved.body);await opening;assertRecertifiedPlanningReadR5(f,saved,unrelated);
    assert.deepEqual(f.calls.map(call=>call.init.method==="GET"?"GET":call.body.action),["resume","GET","GET"]);
  });
  for(const olderResponse of["successful","non-JSON"])test("adaptive read invalidation R5: "+surface+" newer resume withdrawal wins over an older "+olderResponse+" exact inspection",{timeout:3000},async t=>{
    const {f,saved,unrelated}=await displayedAdaptivePlan(t,{canvasId,reader:true});
    const oldInspection=await missingAdaptiveRead(f,saved);f.host.closePlanningConsent();
    const reopening=f.host.reviewPlanningJob(saved.executionId),newer=await f.take();assert.equal(newer.body.action,"resume");
    await f.reply(newer,{error:"adaptive_execution_unavailable"},404);await reopening;
    assertInvalidatedPlanningReadR5(f,saved,unrelated);
    const oldResult={job:{...saved.body.job,result:{...saved.body.job.result,quote:saved.originalQuote,planningReviewAvailable:true}}};
    await releaseOldPlanningReadR5(f,oldInspection.exact,olderResponse,oldResult);await oldInspection.pending;
    assertInvalidatedPlanningReadR5(f,saved,unrelated);
    await deliberatelyRecertifyPlanningReadR5(f,saved,unrelated);
    assert.deepEqual(f.calls.map(call=>call.init.method==="GET"?"GET":call.body.action),["resume","GET","GET","resume","resume"]);
  });
  for(const olderResponse of["HTTP404","non-JSON"])test("adaptive read invalidation R5: "+surface+" newer successful resume survives an older "+olderResponse+" exact-inspection failure",{timeout:3000},async t=>{
    const {f,saved,unrelated}=await displayedAdaptivePlan(t,{canvasId,reader:true});
    const oldInspection=await missingAdaptiveRead(f,saved);f.host.closePlanningConsent();
    const reopening=f.host.reviewPlanningJob(saved.executionId),newer=await f.take();
    assert.equal(newer.body.action,"resume");assert.equal(newer.body.executionId,saved.executionId);
    await f.reply(newer,saved.body);await reopening;assertRecertifiedPlanningReadR5(f,saved,unrelated);
    await releaseOldPlanningReadR5(f,oldInspection.exact,olderResponse);await oldInspection.pending;
    assertRecertifiedPlanningReadR5(f,saved,unrelated);
    assert.deepEqual(f.calls.map(call=>call.init.method==="GET"?"GET":call.body.action),["resume","GET","GET","resume"]);
  });
}

async function retainedActivity(f,{reader=true,canvasId=null}={}){
  // This isolated retained-job fixture has no second certified Canvas plan.
  // Remove the generic cancellation fixture's intentionally incomplete marker;
  // full sibling continuity is covered by real serialized R11/R12 jobs below.
  f.host.adaptiveSuggestionSets.set({});
  const request={projectId:"project-a",documentId:"doc-a",canvasId,sourceSurface:canvasId?"canvas":"adaptive",projectScope:Boolean(canvasId),locale:"ja-JP",prompt:"Preserve the original paid intent — 原文.",requestKey:""};
  request.requestKey=await adaptiveRequestKey(request);
  const executionId="retained-execution",originalPlan={interpretation:"Original paid interpretation — 原文.",active_decision:{type:"subject",label:"Original next decision",prompt:"Preserve the authored subject.",why:"The original brief requires it."},suggested_blocks:[{type:"lighting",subtype:"Natural",label:"Original light",instruction:"Keep the original soft light.",reason:"Preserve continuity.",relationship_to:"Original subject"},{type:"environment",subtype:"Setting",label:"Original harbor",instruction:"Keep the original harbor setting.",reason:"Preserve the authored location.",relationship_to:"Original subject"}],hidden_until_later:["Original later decision"]};
  const originalQuote=quote(request,{executionId,bindingHash:"retained-binding",status:"completed",providerAvailable:false,canExecute:false,canPrepareNew:true,budgetAvailable:false,sourceHash:"retained-source",models:["original-paid-model"],privateInput:{approved:"original-private-input",scope:canvasId?"whole-project":"document",projectTitle:"Original project",documentTitle:"Original document",canvasTitle:canvasId?"Original board":null,blockCount:14,documentCount:1}});
  const originalJob=job(request,executionId,{planningExecutionId:executionId,planningProjectScope:request.projectScope,planningLocale:request.locale,status:"failed",result:{}});
  const session=f.host.session.get();f.host.session.set({...session,provider:{configured:false,plannerConfigured:false},projectContext:{...session.projectContext,role:reader?"viewer":"editor",permissions:reader?["project.read"]:["project.read","project.author","project.output.request"]}});
  f.host.projection.set({...f.host.projection.get(),documentId:"doc-b"});f.host.route.set("/activity");f.host.documentJobs.set([originalJob]);
  const completedJob={...originalJob,status:"completed",result:{intent:request.prompt,structure:originalPlan}};
  return{request,executionId,originalPlan,originalQuote,originalJob,body:{quote:originalQuote,planningRequest:request,job:completedJob,status:"completed"}};
}

for(const kind of["canvas","adaptive"])test(`stale ${kind} approval offers a fresh free preview without losing intent or saved plans`,{timeout:2000},async t=>{
  const f=fixture(t),draft="  Preserve my original draft.\n",entry=entryHost(f,kind,draft),plans=structuredClone(f.host.adaptiveStructures.get()),sets=structuredClone(f.host.adaptiveSuggestionSets.get()),pending=entry.ask(),first=await f.take();await f.reply(first,{quote:quote(first.body)});
  const approving=f.host.approvePlanningConsent(),attempt=await f.take();await f.reply(attempt,{error:"adaptive_consent_changed",submission:"not-submitted"},409);await approving;
  const state=f.host.planningConsent.get(),view=render(f);assert.equal(state.quote,null);assert.equal(state.notice,"refresh");assert.equal(state.submitted,false);assert.equal(entry.draft,draft);assert.deepEqual(f.host.adaptiveStructures.get(),plans);assert.deepEqual(f.host.adaptiveSuggestionSets.get(),sets);
  assert.ok(view.buttons.some(button=>button.label==="context.consent.preview"&&!button.disabled));assert.ok(!view.buttons.some(button=>button.label==="planning.consent.approve"));assert.ok(view.buttons.some(button=>button.label==="action.cancel"));assert.doesNotMatch(view.markup,/planning\.consent\.closeHint/);
  const previewing=f.host.previewPlanningConsent(),fresh=await f.take();assert.equal(fresh.body.action,"quote");assert.equal(fresh.body.prompt,draft.trim());assert.equal(Object.hasOwn(fresh.body,"executionId"),false);assert.equal(Object.hasOwn(fresh.body,"approvedBindingHash"),false);
  await f.reply(fresh,{quote:quote(fresh.body,{executionId:"fresh-preview",bindingHash:"fresh-binding",sourceHash:"fresh-source"})});await previewing;assert.equal(f.host.planningConsent.get().quote.executionId,"fresh-preview");assert.equal(f.host.planningConsent.get().submitted,false);assert.deepEqual(f.calls.map(call=>call.body.action),["quote","execute","quote"]);assert.deepEqual(f.host.adaptiveStructures.get(),plans);assert.deepEqual(f.host.adaptiveSuggestionSets.get(),sets);assert.equal(entry.draft,draft);
  f.host.closePlanningConsent();await pending;assert.equal(entry.draft,draft);
});

for(const status of["reserved","submitting","uncertain"])test(`reopened ${status} planning review says Close review and retrieves without another approval`,{timeout:2000},async t=>{
  const f=fixture(t),opened=await open(f,"Original paid intent",{},{status}),view=render(f);assert.equal(f.host.planningConsent.get().submitted,true);assert.match(view.markup,/planning\.consent\.closeHint/);assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));assert.ok(!view.buttons.some(button=>button.label==="action.cancel"||button.label==="planning.consent.approve"));assert.ok(view.buttons.some(button=>button.label==="context.consent.reuse"&&!button.disabled));
  const retrieving=f.host.approvePlanningConsent(),call=await f.take();assert.equal(call.body.action,"retrieve");assert.equal(call.body.executionId,opened.preview.executionId);assert.equal(call.body.approvedBindingHash,opened.preview.bindingHash);const pendingView=render(f);assert.match(pendingView.markup,/planning\.consent\.checking/);assert.doesNotMatch(pendingView.markup,/planning\.consent\.preparing/);
  await f.reply(call,{quote:opened.preview,status},409);await retrieving;assert.deepEqual(f.calls.map(request=>request.body.action),["quote","retrieve"]);f.host.closePlanningConsent();assert.equal(await opened.decision,false);
});

for(const canvasId of[null,"original-board"])test(`reader Activity resumes the original ${canvasId?"board":"document"} plan by job ID and displays it without purchase controls`,{timeout:2000},async t=>{
  const f=fixture(t),saved=await retainedActivity(f,{canvasId}),reviewing=f.host.reviewPlanningJob(saved.executionId),call=await f.take();assert.equal(call.body.action,"resume");assert.equal(call.body.executionId,saved.executionId);assert.equal(call.body.prompt,"");assert.equal(call.body.documentId,"doc-a");assert.equal(call.body.canvasId,canvasId);assert.equal(call.body.requestKey,saved.request.requestKey);assert.equal(Object.hasOwn(call.body,"approvedBindingHash"),false);
  const pendingView=render(f);assert.match(pendingView.markup,/planning\.consent\.checking/);assert.ok(pendingView.buttons.some(button=>button.label==="planning.consent.closeReview"));assert.ok(!pendingView.buttons.some(button=>button.label==="action.cancel"));
  await f.reply(call,saved.body);assert.equal(await reviewing,true);const state=f.host.planningConsent.get(),view=render(f);assert.equal(state.recoveryExecutionId,saved.executionId);assert.deepEqual(state.request,saved.request);assert.deepEqual(state.recoveredPlan,saved.originalPlan);assert.match(view.markup,/Original paid interpretation — 原文\./);assert.match(view.markup,/Original next decision/);assert.match(view.markup,/Keep the original soft light\./);assert.match(view.markup,/Original later decision/);assert.match(view.markup,/original-paid-model/);assert.match(view.markup,/original-private-input/);
  assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview"].includes(button.label)));await f.host.newPlanningPreview();assert.deepEqual(f.calls.map(request=>request.body.action),["resume"]);assert.deepEqual(f.trace,[]);assert.equal(f.host.documentJobs.get()[0].jobId,saved.executionId);assert.equal(f.host.projection.get().documentId,"doc-b");
  f.host.closePlanningConsent();assert.equal(f.host.documentJobs.get()[0].jobId,saved.executionId);
});

test("only an explicit author action requests a new free preview after reviewing a retained plan",{timeout:2000},async t=>{
  const f=fixture(t),saved=await retainedActivity(f,{reader:false}),reviewing=f.host.reviewPlanningJob(saved.executionId),resume=await f.take();await f.reply(resume,saved.body);await reviewing;const originalPlan=structuredClone(f.host.adaptiveStructures.get()["doc-a"]),view=render(f);assert.ok(view.buttons.some(button=>button.label==="planning.consent.newPreview"&&!button.disabled));assert.deepEqual(f.calls.map(call=>call.body.action),["resume"]);
  const preparing=f.host.newPlanningPreview(),fresh=await f.take();assert.equal(fresh.body.action,"quote");assert.equal(fresh.body.replaceExecutionId,saved.executionId);assert.equal(fresh.body.prompt,saved.request.prompt);assert.equal(Object.hasOwn(fresh.body,"approvedBindingHash"),false);assert.equal(Object.hasOwn(fresh.body,"executionId"),false);assert.equal(f.host.planningConsent.get().submitted,true);assert.equal(f.host.planningConsent.get().recoveryExecutionId,saved.executionId);assert.deepEqual(f.host.planningConsent.get().recoveredPlan,saved.originalPlan);assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],originalPlan);
  await f.reply(fresh,{quote:quote(saved.request,{executionId:"new-review",bindingHash:"new-binding",sourceHash:"new-source"})});await preparing;assert.equal(f.host.planningConsent.get().quote.executionId,"new-review");assert.equal(f.host.planningConsent.get().recoveredPlan,undefined);assert.equal(f.host.planningConsent.get().submitted,false);assert.equal(f.host.planningConsent.get().recoveryExecutionId,undefined);assert.deepEqual(f.calls.map(call=>call.body.action),["resume","quote"]);assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],originalPlan);
});

for(const canPrepareNew of[false,undefined])test(`a recovered plan cannot invite replacement without settled-receipt permission (${String(canPrepareNew)})`,{timeout:2000},async t=>{
  const f=fixture(t),saved=await retainedActivity(f,{reader:false});saved.originalQuote.canPrepareNew=canPrepareNew;saved.body.job.result.billingStatus="pending";const reviewing=f.host.reviewPlanningJob(saved.executionId),resume=await f.take();await f.reply(resume,saved.body);await reviewing;
  const view=render(f);assert.match(view.markup,/Original paid interpretation/);assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview"].includes(button.label)));await f.host.newPlanningPreview();assert.deepEqual(f.calls.map(call=>call.body.action),["resume"]);assert.equal(f.host.planningConsent.get().recoveryExecutionId,saved.executionId);assert.deepEqual(f.host.planningConsent.get().recoveredPlan,saved.originalPlan);
});

for(const failure of["erased","transport"])test(`Activity ${failure} recovery keeps the original ID and exposes retrieval only`,{timeout:2000},async t=>{
  const f=fixture(t),saved=await retainedActivity(f),plans=structuredClone(f.host.adaptiveStructures.get()),reviewing=f.host.reviewPlanningJob(saved.executionId),call=await f.take();
  if(failure==="transport")call.gate.reject(new Error("Lost resume response"));else await f.reply(call,{error:"adaptive_result_unavailable",noAutomaticRetry:true},404);await reviewing;
  const state=f.host.planningConsent.get(),view=render(f);assert.equal(state.recoveryExecutionId,saved.executionId);assert.equal(state.quote,null);assert.equal(state.submitted,true);assert.equal(state.recoveredPlan,undefined);assert.deepEqual(f.host.adaptiveStructures.get(),plans);assert.ok(view.buttons.some(button=>button.label==="planning.consent.retrieveExisting"&&!button.disabled));assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview","action.cancel"].includes(button.label)));
  await f.host.newPlanningPreview();await f.host.approvePlanningConsent();assert.equal(f.calls.length,1);const retrying=f.host.previewPlanningConsent(),retry=await f.take();assert.equal(retry.body.action,"resume");assert.equal(retry.body.executionId,saved.executionId);assert.equal(Object.hasOwn(retry.body,"approvedBindingHash"),false);await f.reply(retry,{error:"adaptive_result_unavailable",noAutomaticRetry:true},404);await retrying;assert.deepEqual(f.calls.map(request=>request.body.action),["resume","resume"]);assert.deepEqual(f.host.adaptiveStructures.get(),plans);assert.equal(f.host.planningConsent.get().recoveryExecutionId,saved.executionId);
});

for(const difference of[{projectId:"other-project"},{documentId:"doc-b"},{canvasId:"other-board"}])test(`Activity resume rejects a wrong-scope quote (${Object.keys(difference)[0]}) without replacing the saved plan`,{timeout:2000},async t=>{
  const f=fixture(t),saved=await retainedActivity(f),plans=structuredClone(f.host.adaptiveStructures.get()),jobs=structuredClone(f.host.documentJobs.get()),reviewing=f.host.reviewPlanningJob(saved.executionId),call=await f.take();await f.reply(call,{...saved.body,quote:{...saved.originalQuote,...difference}});await reviewing;
  const state=f.host.planningConsent.get();assert.equal(state.recoveryExecutionId,saved.executionId);assert.equal(state.quote,null);assert.equal(state.recoveredPlan,undefined);assert.equal(state.request.prompt,"");assert.deepEqual(f.host.adaptiveStructures.get(),plans);assert.deepEqual(f.host.documentJobs.get(),jobs);assert.deepEqual(f.calls.map(request=>request.body.action),["resume"]);assert.ok(!render(f).buttons.some(button=>["planning.consent.approve","context.consent.preview"].includes(button.label)));
});

for(const changed of["actor","permission","custody","route"])test(`late Activity resume after ${changed} changes during JSON decoding is ignored`,{timeout:2000},async t=>{
  const f=fixture(t),saved=await retainedActivity(f),plans=structuredClone(f.host.adaptiveStructures.get()),jobs=structuredClone(f.host.documentJobs.get()),reviewing=f.host.reviewPlanningJob(saved.executionId),call=await f.take();
  await f.reply(call,saved.body,200,()=>{const session=f.host.session.get();if(changed==="route")f.host.route.set("/document/doc-b/beta");else f.host.session.set(changed==="actor"?{...session,user:{userId:"actor-b"}}:changed==="permission"?{...session,permissionEpoch:"epoch-b"}:{...session,projectContext:{...session.projectContext,projectAccessId:"access-b"}});f.host.notify();});await reviewing;
  assert.equal(f.host.planningConsent.get(),null);assert.deepEqual(f.host.adaptiveStructures.get(),plans);assert.deepEqual(f.host.documentJobs.get(),jobs);assert.deepEqual(f.calls.map(request=>request.body.action),["resume"]);assert.deepEqual(f.trace,[]);
});

// Closed reviews keep only a same-authority, content-free recovery identity.
// The private result is recertified by exact GET; it is never fabricated into a page.
function assertContentFreePlanningRecovery(f,saved){
  const entries=f.host.planningRecoveryEntries();
  const identity=entries.find(entry=>entry.jobId===saved.executionId);
  assert.ok(identity,"The omitted original request keeps a content-free retry target");
  assert.equal(identity.documentId,saved.request.documentId);
  assert.equal(identity.canvasId??null,saved.request.canvasId);
  assert.equal(identity.sourceSurface,saved.request.sourceSurface);
  assert.equal(identity.requestKey,saved.request.requestKey);
  assert.equal(identity.planningExecutionId,saved.executionId);
  assert.equal(identity.planningLocale,saved.request.locale);
  assert.equal(identity.planningProjectScope,saved.request.projectScope);
  assert.equal(identity.kind,"structure_adaptive");
  const allowed=new Set(["jobId","documentId","canvasId","sourceSurface","requestKey","planningLocale","planningProjectScope","planningExecutionId","kind"]);
  assert.deepEqual(Object.keys(identity).filter(key=>!allowed.has(key)),[],"Recovery metadata contains no status, result, prompt, private input or receipt");
  const serialized=JSON.stringify(identity);
  for(const privateText of[saved.request.prompt,saved.originalPlan.interpretation,"original-private-input","original-paid-model"]){
    assert.ok(!serialized.includes(privateText),"Recovery metadata must not retain private presentation bytes");
  }
  assert.deepEqual(f.host.documentJobs.get(),[],"Recovery metadata stays outside the scoped/paginated feed");
  return identity;
}
async function closedPlanningRecoveryAfter500(t,canvasId){
  const {f,saved,unrelated}=await displayedAdaptivePlan(t,{canvasId,reader:true});
  f.host.closePlanningConsent();
  const page={jobs:[],hasMore:true,nextCursor:"earlier-page"};
  const first=await missingAdaptiveRead(f,saved,{page});
  await f.reply(first.exact,{error:"temporary_inspection_failure"},500);
  await first.pending;
  assertUnverifiedAdaptivePlanCleared(f,saved,unrelated,{review:false});
  assertContentFreePlanningRecovery(f,saved);
  await assertNoAutomaticAdaptivePurchase(f);
  return{f,saved,unrelated,page};
}
function assertOnlyOriginalPlanningReads(f,saved){
  for(const call of f.calls){
    if(call.init.method==="GET"){
      assert.ok(call.url==="/api/document-jobs"||call.url==="/api/document-jobs/"+encodeURIComponent(saved.executionId)+"?inspection=1");
      assert.equal(call.body,null);
    }else{
      assert.equal(call.url,"/api/document-jobs/adaptive");
      assert.equal(call.body.action,"resume","Read-only recovery must never issue quote, execute, run or provider requests");
      assert.equal(call.body.executionId,saved.executionId);
      assert.equal(Object.hasOwn(call.body,"approvedBindingHash"),false);
    }
  }
}
async function reopenOriginalPlanningReview(f,saved){
  const reviewing=f.host.reviewPlanningJob(saved.executionId);
  const next=await Promise.race([
    f.take().then(call=>({call})),
    Promise.resolve(reviewing).then(result=>({result})),
  ]);
  assert.ok(next.call,"reviewPlanningJob must reopen the original identity even outside the current feed");
  const call=next.call;
  assert.equal(call.init.method,"POST");
  assert.equal(call.body.action,"resume");
  assert.equal(call.body.executionId,saved.executionId);
  assert.equal(call.body.documentId,saved.request.documentId);
  assert.equal(call.body.canvasId,saved.request.canvasId);
  assert.equal(call.body.sourceSurface,saved.request.sourceSurface);
  assert.equal(call.body.requestKey,saved.request.requestKey);
  assert.equal(call.body.prompt,"","Recovery must not reconstruct or resend the private intent");
  assert.equal(Object.hasOwn(call.body,"approvedBindingHash"),false);
  await f.reply(call,saved.body);
  assert.equal(await reviewing,true);
  const state=f.host.planningConsent.get(),view=render(f);
  assert.equal(state.recoveryExecutionId,saved.executionId);
  assert.deepEqual(state.recoveredPlan,saved.originalPlan);
  assert.deepEqual(state.request,saved.request);
  assert.equal(state.quote.executionId,saved.executionId);
  assert.equal(state.quote.bindingHash,saved.originalQuote.bindingHash);
  assert.match(view.markup,/Original paid interpretation — 原文\./);
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));
  assert.ok(!view.buttons.some(button=>["planning.consent.approve","planning.consent.newPreview","context.consent.preview","action.cancel"].includes(button.label)));
  assertOnlyOriginalPlanningReads(f,saved);
}

for(const canvasId of[null,"original-board"]){
  const surface=canvasId?"Canvas":"Document";
  test("adaptive closed recovery R4: "+surface+" retries an omitted original after transient inspection failure without buying again",{timeout:3000},async t=>{
    const {f,saved,unrelated,page}=await closedPlanningRecoveryAfter500(t,canvasId);
    const polling=f.host.syncDocumentJobs(),list=await f.take();
    assert.equal(list.url,"/api/document-jobs");
    assert.equal(list.init.method,"GET");
    await f.reply(list,page);
    const next=await Promise.race([
      f.take().then(call=>({call})),
      Promise.resolve(polling).then(()=>({finished:true})),
    ]);
    assert.ok(next.call,"A later omitted feed must still revalidate the original content-free identity");
    const exact=next.call;
    assert.equal(exact.url,"/api/document-jobs/"+encodeURIComponent(saved.executionId)+"?inspection=1");
    assert.equal(exact.init.method,"GET");
    assert.equal(exact.body,null);
    const verified={...saved.body.job,result:{...saved.body.job.result,quote:saved.originalQuote}};
    await f.reply(exact,{job:verified});
    await polling;
    assert.deepEqual(f.host.documentJobs.get(),[],"Successful exact inspection is not a page-list insertion");
    assert.deepEqual(f.host.inspectionJob(saved.executionId),verified);
    assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
    assert.equal(f.host.planningConsent.get(),null,"Background recovery must not reopen a closed modal");
    if(canvasId){
      assert.deepEqual(f.host.adaptiveSuggestionSets.get()["doc-a"]?.find(item=>item.id===saved.executionId)?.structure,saved.originalPlan);
    }else{
      assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],saved.originalPlan);
      assert.equal(f.host.knownPlanJob("doc-a"),saved.executionId);
    }
    assertContentFreePlanningRecovery(f,saved);
    assertOnlyOriginalPlanningReads(f,saved);
    await reopenOriginalPlanningReview(f,saved);
    assert.deepEqual(f.calls.map(call=>call.init.method==="GET"?"GET":call.body.action),["resume","GET","GET","GET","GET","resume"]);
  });
  test("adaptive closed recovery R4: "+surface+" reader can explicitly retrieve the content-free target before a successful poll",{timeout:3000},async t=>{
    const {f,saved}=await closedPlanningRecoveryAfter500(t,canvasId);
    await reopenOriginalPlanningReview(f,saved);
    assert.deepEqual(f.calls.map(call=>call.init.method==="GET"?"GET":call.body.action),["resume","GET","GET","resume"]);
  });
  test("adaptive closed recovery R4: "+surface+" content-free retry identity is unavailable after the actor changes",{timeout:3000},async t=>{
    const {f,saved}=await closedPlanningRecoveryAfter500(t,canvasId);
    const count=f.calls.length,session=f.host.session.get();
    f.host.session.set({...session,user:{...session.user,userId:"actor-b"},permissionEpoch:"epoch-b"});
    f.host.notify();
    assert.deepEqual(f.host.planningRecoveryEntries(),[],"An original actor's retry identity is not discoverable to another actor");
    assert.equal(await f.host.reviewPlanningJob(saved.executionId),false);
    assert.equal(f.calls.length,count,"Wrong-actor recovery must not make an exact read or resume request");
    assert.equal(f.host.planningConsent.get(),null);
    assertOnlyOriginalPlanningReads(f,saved);
  });
}

// Deterministic focus ports exercise the production shell/host contract only.
// They do not emulate native focus traversal, layout, or assistive technology.
function planningFocusPort(f,executionId,{matching=true,nativeReturn=false,headingTabindex=null}={}) {
  const gate=deferred(),focusCalls=[],ownerDocument={activeElement:null},nodes=[],listeners=new Map();
  let rendered=false;
  const port={connected:true,ownerDocument,updateComplete:gate.promise,focusCalls};
  function node(name,tagName="BUTTON",attributes={}) {
    const values=new Map(Object.entries(attributes));
    const target={name,tagName,isConnected:true,hidden:false,disabled:false,inert:false,dataset:{},
      getAttribute:key=>values.get(key)??null,hasAttribute:key=>values.has(key),setAttribute:(key,value)=>values.set(key,String(value)),removeAttribute:key=>values.delete(key),
      getClientRects:()=>target.isConnected&&!target.hidden?[{}]:[],checkVisibility:()=>target.isConnected&&!target.hidden,
      closest:()=>null,
      matches:selector=>selector.includes(":disabled")?target.disabled:selector.includes("[hidden]")?target.hidden:false,
      addEventListener(type,handler,options){const key=name+":"+type;listeners.set(key,[...(listeners.get(key)??[]),{handler,once:Boolean(options?.once)}]);},
      focus(options){focusCalls.push({name,options,rendered,dialogOpen:port.dialog.open,reviewOpen:Boolean(f.host.planningConsent.get()),tabindex:values.get("tabindex")??null});ownerDocument.activeElement=target;},
    };
    Object.defineProperty(target,"tabIndex",{get:()=>values.has("tabindex")?Number(values.get("tabindex")):tagName==="BUTTON"?0:-1,set:value=>values.set("tabindex",String(value))});
    nodes.push(target);return target;
  }
  port.original=node("removed-opener");port.original.isConnected=false;
  port.nativeOpener=node("plan-field","TEXTAREA");
  port.other=node("different-request");port.other.dataset.planningRecoveryId="different-execution";port.other.setAttribute("data-planning-recovery-id","different-execution");
  port.replacement=node("same-request");port.replacement.dataset.planningRecoveryId=executionId;port.replacement.setAttribute("data-planning-recovery-id",executionId);
  port.heading=node("current-heading","H1",headingTabindex===null?{}:{tabindex:headingTabindex});
  port.main=node("current-main","MAIN",{id:"main-content",tabindex:"-1"});
  port.activity=node("current-activity","FORMA-ACTIVITY");
  port.dialog={open:true,close(){if(!this.open)return;this.open=false;f.trace.push(["dialog-close"]);ownerDocument.activeElement=nativeReturn?port.nativeOpener:null;}};
  const candidates=()=>[port.other,...matching?[port.replacement]:[]];
  function select(selector) {
    const matches=new Set(selector.split(",").flatMap(part=>{
      part=part.trim();
      if(part.includes("data-planning-recovery-id")){
        const exact=part.match(/\[data-planning-recovery-id=(?:"([^"]*)"|'([^']*)'|([^\]]+))\]/u),id=exact?.[1]??exact?.[2]??exact?.[3];
        return candidates().filter(candidate=>id===undefined||candidate.dataset.planningRecoveryId===id);
      }
      if(part.includes("dialog")&&part.includes(":modal"))return port.dialog.open?[port.dialog]:[];
      if(part==="forma-activity")return[port.activity];
      if(/\bh1\b|\[role=['"]heading/u.test(part))return[port.heading];
      if(part==="#main-content"||part==="main")return[port.main];
      return[];
    }));
    // querySelector uses tree order across a selector list, not selector priority.
    // In the real Activity DOM, main precedes its descendant page heading.
    return [port.main,port.activity,port.heading,...candidates(),port.nativeOpener,port.dialog].filter(candidate=>matches.has(candidate));
  }
  port.querySelector=selector=>select(selector)[0]??null;port.querySelectorAll=select;
  ownerDocument.querySelector=port.querySelector;ownerDocument.querySelectorAll=select;
  port.main.querySelector=port.querySelector;port.main.querySelectorAll=select;
  port.activity.querySelector=port.querySelector;port.activity.querySelectorAll=select;port.activity.updateComplete=gate.promise;
  port.complete=async()=>{rendered=true;gate.resolve(true);await turn();};
  port.blurHeading=()=>{const key="current-heading:blur",entries=listeners.get(key)??[];listeners.set(key,entries.filter(entry=>!entry.once));for(const entry of entries)entry.handler({target:port.heading});};
  port.disconnect=()=>{port.connected=false;for(const target of nodes)target.isConnected=false;};
  return port;
}
function dismissPlanningFocus(view,kind) {
  if(kind==="close"){
    const close=view.buttons.find(button=>["planning.consent.closeReview","action.cancel"].includes(button.label));assert.ok(close);close.click();return;
  }
  let prevented=false,stopped=false;
  const event={key:"Escape",isComposing:false,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}};
  if(kind==="escape"){view.keydown(event);assert.equal(stopped,true,"Escape stays in the topmost review");}
  else view.cancel(event);
  assert.equal(prevented,true);
}
async function recoveredPlanningFocus(t) {
  const f=fixture(t),saved=await retainedActivity(f);
  await reopenOriginalPlanningReview(f,saved);f.host.closePlanningConsent();
  // Simulate a later scoped/page omission. Retention/500 behavior has its own
  // actual-host coverage above; focus must not depend on its internal cache map.
  f.host.documentJobs.set([]);
  assert.equal(f.host.planningRecoveryEntries().length,1);
  f.host.route.set("/activity");
  await reopenOriginalPlanningReview(f,saved);
  assert.equal(f.host.planningRecoveryEntries().length,0,"The original recovery-card subtree really disappears");
  assert.equal(f.host.documentJobs.get()[0].jobId,saved.executionId);
  assert.ok(f.host.planningConsent.get(),"The original review is still open");
  return{f,saved};
}
test("planning native-close R6: the focus port honors DOM order rather than selector priority",t=>{
  const f=fixture(t),port=planningFocusPort(f,"original-execution",{matching:false});
  assert.equal(port.querySelector("#main-content h1,#main-content"),port.main,"The ancestor matches first even when the heading selector is written first");
  assert.equal(port.querySelector("#main-content,#main-content h1"),port.main);
  assert.equal(port.querySelector("#main-content h1,main h1,[role='main'] h1"),port.heading,"A heading-only query cannot resolve to main");
});
for(const eventOwner of["old-detached-dialog","reopened-dialog"])test("planning native-close R6: "+eventOwner+" cannot dismiss the next review instance",{timeout:3000},async t=>{
  const {f,saved}=await recoveredPlanningFocus(t),port=planningFocusPort(f,saved.executionId),oldView=render(f,port),oldId=f.host.planningConsent.get().id;
  dismissPlanningFocus(oldView,"close");assert.equal(f.host.planningConsent.get(),null);
  const reopening=f.host.reviewPlanningJob(saved.executionId),resume=await f.take(),newId=f.host.planningConsent.get().id;
  assert.notEqual(newId,oldId,"Reopening even the same request creates a different review owner");assert.equal(resume.body.action,"resume");
  // Model either a queued callback on the detached old element or the current
  // listener on a native dialog that was reopened before its old event arrived.
  if(eventOwner==="reopened-dialog")port.dialog.open=true;
  const callback=eventOwner==="old-detached-dialog"?oldView.nativeClose:render(f,port).nativeClose;
  assert.equal(typeof callback,"function","Exercise the production native-close binding");
  callback({currentTarget:port.dialog,target:port.dialog});
  const after=f.host.planningConsent.get()?.id??null;
  await f.reply(resume,saved.body);await reopening;await port.complete();
  assert.equal(after,newId,"An old native close cannot clear a newer review");
  assert.equal(f.host.planningConsent.get()?.id,newId,"The newer retained response remains reviewable");
  assert.deepEqual(port.focusCalls,[],"The old close must not steal focus from the new review");
  if(eventOwner==="reopened-dialog")assert.equal(port.dialog.open,true,"An open replacement dialog must remain open");
});
test("planning native-close R6: the current closed same-ID dialog clears its review and restores exact-request focus",{timeout:3000},async t=>{
  const {f,saved}=await recoveredPlanningFocus(t),port=planningFocusPort(f,saved.executionId),view=render(f,port);
  const id=f.host.planningConsent.get().id;
  port.dialog.close();assert.equal(f.host.planningConsent.get().id,id,"Native close delivery is a separate event from closing the element");
  view.nativeClose({currentTarget:port.dialog,target:port.dialog});
  assert.equal(f.host.planningConsent.get(),null);await turn();assert.deepEqual(port.focusCalls,[],"The shared return waits for rendering");
  await port.complete();
  assert.equal(port.focusCalls.length,1);assert.equal(port.focusCalls[0].name,"same-request");
  assert.equal(port.focusCalls[0].dialogOpen,false);assert.equal(port.focusCalls[0].reviewOpen,false);assert.equal(port.focusCalls[0].rendered,true);
});
test("planning native-close R6: a missing request focuses the heading before its main ancestor",{timeout:3000},async t=>{
  const {f,saved}=await recoveredPlanningFocus(t),port=planningFocusPort(f,saved.executionId,{matching:false}),view=render(f,port);
  assert.equal(port.querySelector("#main-content h1,#main-content"),port.main,"This port exposes the real selector-list trap");
  port.dialog.close();view.nativeClose({currentTarget:port.dialog,target:port.dialog});await port.complete();
  assert.equal(port.focusCalls.length,1);assert.equal(port.focusCalls[0].name,"current-heading","Main cannot satisfy a heading-specific fallback");
  assert.equal(port.focusCalls[0].tabindex,"-1");assert.equal(port.main.getAttribute("tabindex"),"-1","Do not modify the existing main landmark");
  port.blurHeading();assert.equal(port.heading.hasAttribute("tabindex"),false);
});
test("planning native-close R6: ordinary free-preview closure preserves native Plan-field focus",{timeout:3000},async t=>{
  const f=fixture(t),opened=await open(f),port=planningFocusPort(f,opened.preview.executionId,{matching:false,nativeReturn:true}),view=render(f,port);
  port.dialog.close();assert.equal(port.ownerDocument.activeElement,port.nativeOpener);
  view.nativeClose({currentTarget:port.dialog,target:port.dialog});assert.equal(await opened.decision,false);await port.complete();
  assert.equal(f.host.planningConsent.get(),null);assert.equal(port.ownerDocument.activeElement,port.nativeOpener);
  assert.deepEqual(port.focusCalls,[]);assert.equal(port.heading.hasAttribute("tabindex"),false);
});


for(const kind of["close","escape","native-cancel"])test("planning focus R5: "+kind+" returns to the exact replacement request only after modal close and rendering",{timeout:3000},async t=>{
  const {f,saved}=await recoveredPlanningFocus(t),port=planningFocusPort(f,saved.executionId),view=render(f,port);
  dismissPlanningFocus(view,kind);
  assert.equal(port.dialog.open,false);assert.equal(f.host.planningConsent.get(),null);
  await turn();assert.deepEqual(port.focusCalls,[],"Do not focus inert background or a not-yet-rendered replacement");
  await port.complete();
  assert.equal(port.focusCalls.length,1);assert.equal(port.focusCalls[0].name,"same-request","Never select the first same-title/different-request action");
  assert.equal(port.focusCalls[0].dialogOpen,false);assert.equal(port.focusCalls[0].reviewOpen,false);assert.equal(port.focusCalls[0].rendered,true);
  assert.equal(port.ownerDocument.activeElement,port.replacement);assert.notEqual(port.ownerDocument.activeElement,port.original);
});
for(const kind of["close","escape"])for(const headingTabindex of[null,"0"])test("planning focus R5: "+kind+" uses the current heading when the request is absent and preserves tabindex "+String(headingTabindex),{timeout:3000},async t=>{
  const {f,saved}=await recoveredPlanningFocus(t),port=planningFocusPort(f,saved.executionId,{matching:false,headingTabindex}),view=render(f,port);
  dismissPlanningFocus(view,kind);await turn();assert.deepEqual(port.focusCalls,[]);
  await port.complete();
  assert.equal(port.focusCalls.length,1);assert.equal(port.focusCalls[0].name,"current-heading","No different request may substitute for the missing one");
  assert.equal(port.focusCalls[0].tabindex,headingTabindex??"-1","Make only an otherwise-unfocusable heading programmatically focusable");
  port.blurHeading();assert.equal(port.heading.getAttribute("tabindex"),headingTabindex,"Temporary tabindex is removed without overwriting an authored value");
});
for(const changed of["actor","permission","custody","route","new-request","reopened-request","disconnect"])test("planning focus R5: delayed close cannot steal focus after "+changed,{timeout:3000},async t=>{
  const {f,saved}=await recoveredPlanningFocus(t),port=planningFocusPort(f,saved.executionId),previous=f.host.planningConsent.get(),view=render(f,port);
  dismissPlanningFocus(view,"close");
  const session=f.host.session.get();
  if(changed==="actor")f.host.session.set({...session,user:{...session.user,userId:"other-actor"}});
  else if(changed==="permission")f.host.session.set({...session,permissionEpoch:"new-permission-epoch"});
  else if(changed==="custody")f.host.session.set({...session,projectContext:{...session.projectContext,projectAccessId:"other-project-access"}});
  else if(changed==="route")f.host.route.set("/document/doc-b/other-work");
  else if(changed==="disconnect")port.disconnect();
  else{const id=changed==="new-request"?"different-execution":saved.executionId;f.host.planningConsent.set({...previous,id:"new-review-instance",recoveryExecutionId:id,quote:{...previous.quote,executionId:id}});port.ownerDocument.activeElement=port.other;}
  await port.complete();
  assert.deepEqual(port.focusCalls,[],"No old close callback may focus a foreign scope, new task, or detached surface");
  assert.equal(port.heading.hasAttribute("tabindex"),false);
});
for(const kind of["close","escape"])test("planning focus R5: ordinary free-preview "+kind+" preserves native return to the Plan field",{timeout:3000},async t=>{
  const f=fixture(t),opened=await open(f),port=planningFocusPort(f,opened.preview.executionId,{matching:false,nativeReturn:true}),view=render(f,port);
  dismissPlanningFocus(view,kind);assert.equal(await opened.decision,false);
  assert.equal(port.ownerDocument.activeElement,port.nativeOpener);
  await port.complete();
  assert.equal(port.ownerDocument.activeElement,port.nativeOpener,"Activity recovery fallback must not override the prior free-preview focus contract");
  assert.equal(port.heading.hasAttribute("tabindex"),false);assert.ok(port.focusCalls.every(call=>call.name==="plan-field"));
});


// These interleavings execute the real store admission, polling and presentation
// methods. Network/provider ports remain deterministic in-memory fixtures.
async function concurrentPlanningRead(t,canvasId,seam){
  const state=await displayedAdaptivePlan(t,{canvasId,reader:false});
  const {f,saved}=state;f.host.closePlanningConsent();
  const session=f.host.session.get();
  f.host.session.set({...session,provider:{configured:true,plannerConfigured:true}});
  const polling=f.host.syncDocumentJobs(),list=await f.take();
  assert.equal(list.url,"/api/document-jobs");
  assert.equal(list.init.method,"GET");
  let held=list;
  if(seam==="inspection"){
    await f.reply(list,{jobs:[],hasMore:true,nextCursor:"earlier-page"});
    held=await f.take();
    assert.equal(held.url,"/api/document-jobs/"+encodeURIComponent(saved.executionId)+"?inspection=1");
    assert.equal(held.init.method,"GET");
  }
  return{...state,canvasId,seam,polling,held};
}
async function completeNewerPlanningDuringRead(state){
  const {f,saved}=state,id="newer-approved-plan",prompt="A newer explicitly approved direction with a different source";
  const plan={...saved.originalPlan,interpretation:"Newer planning result from the exact newly approved source"};
  const decision=f.host.structureAdaptive(prompt,{documentId:saved.request.documentId,canvasId:saved.request.canvasId,sourceSurface:saved.request.sourceSurface,projectScope:saved.request.projectScope,locale:saved.request.locale});
  const prepared=await f.take();assert.equal(prepared.body.action,"quote");
  const request={...prepared.body};delete request.action;
  assert.notEqual(request.requestKey,saved.request.requestKey);
  const preview=quote(request,{executionId:id,bindingHash:"newer-approved-binding",sourceHash:"newer-approved-source",privateInput:{approved:"NEWER_EXACT_PRIVATE_INPUT"},status:"quoted",providerAvailable:true,canExecute:true});
  await f.reply(prepared,{quote:preview});
  const approving=f.host.approvePlanningConsent(),execute=await f.take();
  assert.equal(execute.body.action,"execute");
  assert.equal(execute.body.executionId,id);
  assert.equal(execute.body.approvedBindingHash,preview.bindingHash);
  const completedQuote={...preview,status:"completed",canExecute:false};
  const completed=job(request,id,{planningExecutionId:id,planningLocale:request.locale,planningProjectScope:request.projectScope,requestedAt:"2026-08-27T00:10:00Z",updatedAt:"2026-08-27T00:10:01Z",completedAt:"2026-08-27T00:10:01Z",result:{structure:plan,intent:prompt,quote:completedQuote,planningReviewAvailable:true,sourceHash:preview.sourceHash,executionId:id,bindingHash:preview.bindingHash}});
  await f.reply(execute,{quote:completedQuote,planningRequest:request,job:completed});
  await approving;assert.equal(await decision,true);
  const newer={id,prompt,plan,request,quote:completedQuote,job:completed};state.newer=newer;
  assertNewerPlanningRemains(state);
  return newer;
}
function assertNewerPlanningRemains(state){
  const {f,saved,newer,canvasId}=state;
  const current=f.host.documentJobs.get().find(item=>item.jobId===newer.id);
  assert.ok(current,"A list or inspection begun before admission must not remove the newly admitted canonical job");
  assert.deepEqual(current.result.structure,newer.plan);
  assert.equal(current.requestKey,newer.request.requestKey);
  assert.equal(current.result.bindingHash,newer.quote.bindingHash);
  assert.equal(current.result.sourceHash,newer.quote.sourceHash);
  if(canvasId){
    const shown=f.host.adaptiveSuggestionSets.get()[saved.request.documentId]?.find(item=>item.id===newer.id);
    assert.ok(shown,"A late older inspection must not replace the newer Canvas suggestion set");
    assert.deepEqual(shown.structure,newer.plan);
    assert.equal(shown.intent,newer.prompt);
    assert.equal(shown.canvasId,canvasId);
  }else{
    assert.deepEqual(f.host.adaptiveStructures.get()[saved.request.documentId],newer.plan,"A late older inspection must not replace the selected newer Document plan");
    assert.equal(f.host.knownPlanJob(saved.request.documentId),newer.id);
  }
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],state.unrelated);
  assert.equal(f.host.planningConsent.get(),null,"Background reconciliation must not reopen a review");
}
function assertOneExplicitPlanningPurchase(state){
  const {f,newer}=state;
  assert.equal(f.calls.filter(call=>call.body?.action==="quote").length,1);
  const executes=f.calls.filter(call=>call.body?.action==="execute");
  assert.equal(executes.length,1,"Reconciliation must not purchase any replacement");
  assert.equal(executes[0].body.executionId,newer.id);
  for(const call of f.calls.filter(call=>call.init.method==="POST")){
    assert.equal(call.url,"/api/document-jobs/adaptive");
    assert.ok(["resume","quote","execute"].includes(call.body.action));
  }
}
async function settleConcurrentPlanningRead(state,{oldJob,newerJob,beforeJson=()=>{}}={}){
  const {f,saved,newer,polling,held,seam}=state;
  const original=oldJob??{...saved.body.job,result:{...saved.body.job.result,quote:saved.originalQuote,planningReviewAvailable:true}};
  const fresh=newerJob??newer.job;
  // Every request before this cursor was already consumed by the setup and
  // explicit admission. Drain only actual later GETs, never invent a callback.
  let cursor=f.calls.length,settled=false;
  const completion=Promise.resolve(polling).then(()=>{settled=true;});
  await f.reply(held,seam==="list"?{jobs:[],hasMore:true,nextCursor:"earlier-page"}:{job:original},200,beforeJson);
  for(let turns=0;turns<20&&!settled;turns++){
    while(cursor<f.calls.length){
      const call=await f.take();assert.equal(call,f.calls[cursor++]);
      assert.equal(call.init.method,"GET","A late read may only trigger another free read");
      assert.equal(call.body,null);
      const oldUrl="/api/document-jobs/"+encodeURIComponent(saved.executionId)+"?inspection=1";
      const newUrl="/api/document-jobs/"+encodeURIComponent(newer.id)+"?inspection=1";
      assert.ok(call.url===oldUrl||call.url===newUrl,"Reconcile only the two exact retained request identities");
      await f.reply(call,{job:call.url===oldUrl?original:fresh});
    }
    if(!settled)await turn();
  }
  assert.ok(settled,"The poll must finish after its bounded exact reads");
  await completion;
}
function dismissConcurrentPlanning(state,id){
  if(state.canvasId)state.f.host.dismissAdaptiveSuggestion(state.saved.request.documentId,id);
  else state.f.host.dismissAdaptiveStructure(state.saved.request.documentId);
}
function assertNewerPlanningNotPresented(state){
  const {f,saved,newer,canvasId}=state;
  if(canvasId)assert.ok(!(f.host.adaptiveSuggestionSets.get()[saved.request.documentId]??[]).some(item=>item.id===newer.id));
  else assert.equal(f.host.adaptiveStructures.get()[saved.request.documentId],undefined,"An older result must not become a silent fallback for a dismissed or withdrawn newer selection");
  assert.equal(f.host.planningConsent.get(),null);
}

for(const canvasId of[null,"original-board"]){
  const surface=canvasId?"Canvas":"Document";
  for(const seam of["list","inspection"]){
    test("adaptive concurrent feed R5: "+surface+" preserves a newer approved completion while its older "+seam+" response waits",{timeout:3000},async t=>{
      const state=await concurrentPlanningRead(t,canvasId,seam);
      await completeNewerPlanningDuringRead(state);
      await settleConcurrentPlanningRead(state);
      assertNewerPlanningRemains(state);assertOneExplicitPlanningPurchase(state);
    });
    for(const authorityChange of["actor","permission"]){
      test("adaptive concurrent feed R5: "+surface+" rejects a late "+seam+" after "+authorityChange+" changes",{timeout:3000},async t=>{
        const state=await concurrentPlanningRead(t,canvasId,seam),{f}=state;
        await completeNewerPlanningDuringRead(state);
        const replacement={"doc-b":{interpretation:"Current authority's unrelated presentation"}};
        const change=()=>{
          const session=f.host.session.get();
          f.host.session.set(authorityChange==="actor"?{...session,user:{...session.user,userId:"actor-b"},permissionEpoch:"epoch-b"}:{...session,permissionEpoch:"epoch-b",projectContext:{...session.projectContext,permissions:["project.read"]}});
          // Model the new session's already-published authorized presentation.
          f.host.adaptiveStructures.set(replacement);f.host.adaptiveSuggestionSets.set({});f.host.documentJobs.set([]);f.host.notify();
        };
        const calls=f.calls.length;
        await settleConcurrentPlanningRead(state,{beforeJson:change});
        assert.deepEqual(f.host.adaptiveStructures.get(),replacement);
        assert.deepEqual(f.host.adaptiveSuggestionSets.get(),{});
        assert.deepEqual(f.host.documentJobs.get(),[]);
        assert.deepEqual(f.host.planningRecoveryEntries(),[]);
        assert.equal(f.host.planningConsent.get(),null);
        assert.equal(f.calls.length,calls,"Changed authority must not trigger further exact reads or execution");
        assertOneExplicitPlanningPurchase(state);
      });
    }
  }
  test("adaptive concurrent feed R5: "+surface+" keeps an older dismissed plan hidden while preserving the newer completion",{timeout:3000},async t=>{
    const state=await concurrentPlanningRead(t,canvasId,"inspection");
    dismissConcurrentPlanning(state,state.saved.executionId);
    await completeNewerPlanningDuringRead(state);
    await settleConcurrentPlanningRead(state);
    assertNewerPlanningRemains(state);
    if(canvasId)assert.ok(!(state.f.host.adaptiveSuggestionSets.get()[state.saved.request.documentId]??[]).some(item=>item.id===state.saved.executionId));
    assertOneExplicitPlanningPurchase(state);
  });
  test("adaptive concurrent feed R5: "+surface+" does not undo dismissal of the newer selected plan",{timeout:3000},async t=>{
    const state=await concurrentPlanningRead(t,canvasId,"inspection");
    await completeNewerPlanningDuringRead(state);
    dismissConcurrentPlanning(state,state.newer.id);
    await settleConcurrentPlanningRead(state);
    assertNewerPlanningNotPresented(state);
    assert.ok(state.f.host.documentJobs.get().some(item=>item.jobId===state.newer.id),"Dismissing presentation does not delete its job");
    assertOneExplicitPlanningPurchase(state);
  });
  test("adaptive concurrent feed R5: "+surface+" withdraws only the unavailable older execution",{timeout:3000},async t=>{
    const state=await concurrentPlanningRead(t,canvasId,"inspection");
    await completeNewerPlanningDuringRead(state);
    await settleConcurrentPlanningRead(state,{oldJob:{...state.saved.body.job,result:{planningReviewAvailable:false,resultUnavailable:true}}});
    assertNewerPlanningRemains(state);
    assert.equal(state.f.host.inspectionJob(state.saved.executionId)?.result?.structure,undefined);
    if(canvasId)assert.ok(!(state.f.host.adaptiveSuggestionSets.get()[state.saved.request.documentId]??[]).some(item=>item.id===state.saved.executionId));
    assertOneExplicitPlanningPurchase(state);
  });
  test("adaptive concurrent feed R5: "+surface+" keeps a newer withdrawn execution private without falling back to the older selection",{timeout:3000},async t=>{
    const state=await concurrentPlanningRead(t,canvasId,"inspection"),{f}=state;
    await completeNewerPlanningDuringRead(state);
    const reviewing=f.host.reviewPlanningJob(state.newer.id),resume=await f.take();
    assert.equal(resume.body.action,"resume");assert.equal(resume.body.executionId,state.newer.id);
    await f.reply(resume,{error:"adaptive_result_unavailable",noAutomaticRetry:true},404);await reviewing;
    f.host.closePlanningConsent();
    await settleConcurrentPlanningRead(state,{newerJob:{...state.newer.job,result:{planningReviewAvailable:false,resultUnavailable:true}}});
    assertNewerPlanningNotPresented(state);
    assert.equal(f.host.inspectionJob(state.newer.id)?.result?.structure,undefined);
    assert.equal(f.host.documentJobs.get().find(item=>item.jobId===state.newer.id)?.result?.structure,undefined);
    assertOneExplicitPlanningPurchase(state);
  });
  test("adaptive concurrent feed R5: "+surface+" rejects a mismatched older source without discarding the newer approved source",{timeout:3000},async t=>{
    const state=await concurrentPlanningRead(t,canvasId,"inspection");
    await completeNewerPlanningDuringRead(state);
    await settleConcurrentPlanningRead(state,{oldJob:{...state.saved.body.job,requestKey:"adaptive:wrong-old-source",result:{...state.saved.body.job.result,planningReviewAvailable:true}}});
    assertNewerPlanningRemains(state);
    assert.equal(state.f.host.inspectionJob(state.saved.executionId)?.result?.structure,undefined);
    assertOneExplicitPlanningPurchase(state);
  });
}

// Reuse the event-refresh fixture port supplied by the terminal-observation tests.
// Withdrawal must become authoritative before either unrelated refresh can wait.
for(const canvasId of[null,"original-board"])for(const refresh of["events","account"]){
  test("adaptive pre-refresh withdrawal R6: "+(canvasId?"Canvas":"Document")+" rejects older paid content while "+refresh+" refresh is paused",{timeout:3000},async t=>{
    const {f,saved,unrelated}=await readInvalidationFixtureR5(t,canvasId),entered=deferred(),release=deferred();
    const waitForRefresh=async()=>{entered.resolve();await release.promise;};
    if(refresh==="events"){assert.equal(typeof f.host.onEventRefresh,"function");f.host.onEventRefresh=waitForRefresh;}
    else f.host.refreshSession=waitForRefresh;
    t.after(()=>release.resolve());
    const opening=f.host.reviewPlanningJob(saved.executionId),older=await f.take();
    assert.equal(older.body.action,"resume");assert.equal(older.body.executionId,saved.executionId);
    const polling=f.host.syncDocumentJobs(),list=await f.take();assert.equal(list.init.method,"GET");
    await f.reply(list,{jobs:[{...saved.originalJob,result:{planningReviewAvailable:false,resultUnavailable:true}}]});
    await entered.promise;
    let delivered=false;
    try{
      const withdrawn=f.host.documentJobs.get().find(job=>job.jobId===saved.executionId);
      assert.equal(withdrawn.result.planningReviewAvailable,false);assert.equal(withdrawn.result.resultUnavailable,true);
      assertInvalidatedPlanningReadR5(f,saved,unrelated);
      // This response was captured before withdrawal but arrives inside the await.
      await f.reply(older,saved.body);delivered=true;await opening;
      assertInvalidatedPlanningReadR5(f,saved,unrelated);
      assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","GET"]);
    }finally{
      if(!delivered){await f.reply(older,saved.body);await opening;}
      release.resolve();await polling;
    }
    assertInvalidatedPlanningReadR5(f,saved,unrelated);
    // Erasure clears private bytes, not the content-free identity or free recovery.
    await deliberatelyRecertifyPlanningReadR5(f,saved,unrelated);
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","GET","resume"]);
    assert.equal(f.calls.some(call=>call.body?.action==="quote"||call.body?.action==="execute"),false);
  });
}


// R10: exact negative evidence may follow an incidental completed observation.
// Deliberately beginning a newer exact recovery is different: its successful
// certification must fence the old negative. No provider or purchase ports exist.
for(const canvasId of[null,"original-board"])for(const inspectionPath of["detail","omitted"])for(const newer of["none","incidental-completion","deliberate-resume","deliberate-detail"]){
  const surface=canvasId?"Canvas":"Document";
  test("adaptive inspection withdrawal R10: "+surface+" "+inspectionPath+" after "+newer,{timeout:5000},async t=>{
    const {f,saved,unrelated}=await personalPlanningDetailFixtureR7(t,canvasId);
    await showOriginalPlanningDetailR7(f,saved);
    const serialized=await adaptiveWorkerSerializationR7(saved);
    let earlierPositive,earlierReading;
    if(inspectionPath==="omitted"&&newer==="incidental-completion"){
      // This positive detail was requested BEFORE the omitted exact read.
      // Its later arrival is not a newer deliberate recertification request.
      earlierReading=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error}));
      earlierPositive=await f.take();
      assert.equal(earlierPositive.url,"/api/document-jobs/"+saved.executionId+"?inspection=1");
    }
    let negative,reading;
    if(inspectionPath==="detail"){
      reading=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error}));
      negative=await f.take();
    }else{
      const omitted=await missingAdaptiveRead(f,saved);
      negative=omitted.exact;reading=omitted.pending.then(value=>({value}),error=>({error}));
    }
    assert.equal(negative.init.method,"GET");
    assert.equal(negative.url,"/api/document-jobs/"+saved.executionId+"?inspection=1");
    if(newer==="incidental-completion"){
      if(inspectionPath==="detail"){
        const polling=f.host.syncDocumentJobs(),list=await f.take();
        assert.equal(list.url,"/api/document-jobs");
        await f.reply(list,{jobs:[serialized.feed]});await polling;
      }else{
        await f.reply(earlierPositive,{job:serialized.detail});
        const prior=await earlierReading;
        assert.deepEqual(prior.value?.result?.structure,saved.originalPlan);
      }
    }else if(newer==="deliberate-resume"){
      const resuming=f.host.previewPlanningConsent(),resume=await f.take();
      assert.equal(resume.body.action,"resume");assert.equal(resume.body.executionId,saved.executionId);
      await f.reply(resume,{...saved.body,job:serialized.detail});await resuming;
    }else if(newer==="deliberate-detail"){
      // Native Activity inspection is itself an exact deliberate read; it
      // must establish a later read boundary, not look like ordinary polling.
      const inspecting=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error})),detail=await f.take();
      assert.equal(detail.url,"/api/document-jobs/"+saved.executionId+"?inspection=1");
      await f.reply(detail,{job:serialized.detail});
      const current=await inspecting;
      assert.deepEqual(current.value?.result?.structure,saved.originalPlan);
    }
    assert.equal(planningDetailHasPrivateBytesR7(f,saved),true);
    const privateSnapshot=()=>structuredClone({review:f.host.planningConsent.get(),plans:f.host.adaptiveStructures.get(),suggestions:f.host.adaptiveSuggestionSets.get(),intent:f.host.pendingIntent(saved.executionId)});
    const before=privateSnapshot();
    // The real worker's retained-but-unavailable contract carries no private
    // quote/plan/intent. Preserve exact document/board/request identity.
    const unavailable={...serialized.detail,result:{planningReviewAvailable:false,resultUnavailable:true}};
    await f.reply(negative,{job:unavailable});const outcome=await reading;
    assert.equal(outcome?.value?.result?.structure,undefined);
    assert.equal(outcome?.value?.result?.intent,undefined);
    assert.equal(outcome?.value?.result?.quote,undefined);
    if(newer.startsWith("deliberate-")){
      assert.deepEqual(privateSnapshot(),before,"An older negative cannot erase a newer deliberately certified original result");
      assertRecertifiedPlanningReadR5(f,saved,unrelated);
    }else{
      assertInvalidatedPlanningReadR5(f,saved,unrelated);
      assert.equal(planningDetailHasPrivateBytesR7(f,saved),false,"Incidental completion cannot suppress current exact withdrawal");
      assert.equal(f.host.planningConsent.get().recoveryExecutionId,saved.executionId);
    }
    const expected=["resume"];
    if(inspectionPath==="omitted"&&newer==="incidental-completion")expected.push("GET");
    expected.push(...(inspectionPath==="detail"?["GET"]:["GET","GET"]));
    if(newer==="incidental-completion"&&inspectionPath==="detail"||newer==="deliberate-detail")expected.push("GET");
    if(newer==="deliberate-resume")expected.push("resume");
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),expected);
    assertOnlyOriginalPlanningReads(f,saved);
    assert.equal(f.calls.some(call=>call.body?.action==="quote"||call.body?.action==="execute"),false);
  });
}

// A canonical completed observation is newer evidence than a pending response
// already in flight. It must settle the same open review before refresh awaits.
function completedPlanningObservationR6(saved){
  return{...saved.body.job,status:"completed",updatedAt:"2026-08-27T00:05:00Z",completedAt:"2026-08-27T00:05:00Z",result:{...saved.body.job.result,quote:saved.originalQuote,planningReviewAvailable:true}};
}
function assertCompletedPlanningObservationR6(f,saved,unrelated){
  const current=f.host.documentJobs.get().find(job=>job.jobId===saved.executionId);
  assert.ok(current);assert.equal(current.status,"completed","An older response must not downgrade certified completed work");
  assert.deepEqual(current.result.structure,saved.originalPlan);
  const review=f.host.planningConsent.get();assert.ok(review?.quote,"Certified completion must populate the exact open review");
  assert.equal(review.quote.status,"completed","The review must not regress to an older pending or failed status");
  assertRecertifiedPlanningReadR5(f,saved,unrelated);
  assert.equal(f.host.planningConsent.get().working,false,"Completed evidence must settle the visible review, not leave a working spinner");
  assert.equal(f.calls.some(call=>call.body?.action==="quote"||call.body?.action==="execute"),false);
}
async function releaseOlderTerminalResponseR6(f,older,saved,kind){
  if(kind==="non-JSON")return releaseOldPlanningReadR5(f,older,"non-JSON");
  const failed=kind==="failed";
  const body={quote:{...saved.originalQuote,status:failed?"failed":"reserved"},planningRequest:saved.request,job:{...saved.originalJob,status:failed?"failed":"running",result:{planningReviewAvailable:true}},status:failed?"failed":"reserved",...(failed?{error:"adaptive_execution_failed"}:{})};
  await f.reply(older,body,failed?409:202);
}

for(const canvasId of[null,"original-board"]){
  const surface=canvasId?"Canvas":"Document";
  for(const olderResponse of["running","failed","non-JSON"]){
    test("adaptive terminal observation R6: "+surface+" completed feed wins over an older "+olderResponse+" resume",{timeout:3000},async t=>{
      const {f,saved,unrelated}=await readInvalidationFixtureR5(t,canvasId);
      const opening=f.host.reviewPlanningJob(saved.executionId),older=await f.take();
      assert.equal(older.body.action,"resume");assert.equal(older.body.executionId,saved.executionId);
      const polling=f.host.syncDocumentJobs(),list=await f.take();assert.equal(list.init.method,"GET");
      await f.reply(list,{jobs:[completedPlanningObservationR6(saved)]});await polling;
      assert.equal(f.host.documentJobs.get()[0].status,"completed");
      await releaseOlderTerminalResponseR6(f,older,saved,olderResponse);await opening;
      assertCompletedPlanningObservationR6(f,saved,unrelated);
      assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","GET"]);
    });
  }
  test("adaptive terminal observation R6: "+surface+" completion settles its review while event refresh is still waiting",{timeout:3000},async t=>{
    const {f,saved,unrelated}=await readInvalidationFixtureR5(t,canvasId),entered=deferred(),releaseRefresh=deferred();
    f.host.onEventRefresh=async()=>{entered.resolve();await releaseRefresh.promise;};
    const opening=f.host.reviewPlanningJob(saved.executionId),older=await f.take();
    const polling=f.host.syncDocumentJobs(),list=await f.take();
    await f.reply(list,{jobs:[completedPlanningObservationR6(saved)]});
    await entered.promise;
    try{
      assert.equal(f.host.documentJobs.get()[0].status,"completed");
      // Release the older response inside the refresh gap, not after polling.
      await releaseOlderTerminalResponseR6(f,older,saved,"running");await opening;
      assertCompletedPlanningObservationR6(f,saved,unrelated);
    }finally{releaseRefresh.resolve();await polling;}
    assertCompletedPlanningObservationR6(f,saved,unrelated);
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","GET"]);
  });
  test("adaptive terminal observation R6: "+surface+" ordinary pending updates leave original retrieval usable",{timeout:3000},async t=>{
    const {f,saved,unrelated}=await readInvalidationFixtureR5(t,canvasId);
    const opening=f.host.reviewPlanningJob(saved.executionId),older=await f.take();
    for(const status of["running","committing"]){
      const polling=f.host.syncDocumentJobs(),list=await f.take();
      await f.reply(list,{jobs:[{...saved.originalJob,status,result:{planningReviewAvailable:true}}]});await polling;
      const review=f.host.planningConsent.get();
      assert.equal(review.recoveryExecutionId,saved.executionId);
      assert.equal(review.working,true,"An ordinary progress update is neither completion nor withdrawal");
      assert.equal(review.notice,"");assert.equal(review.recoveredPlan,undefined);
    }
    await f.reply(older,saved.body);await opening;
    assertCompletedPlanningObservationR6(f,saved,unrelated);
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","GET","GET"]);
  });
  test("adaptive terminal observation R6: "+surface+" late free quote cannot restore a newly withdrawn unknown returned identity or strand its controls",{timeout:3000},async t=>{
    const {f,saved}=await displayedAdaptivePlan(t,{canvasId,reader:true});f.host.closePlanningConsent();
    const decision=f.host.structureAdaptive(saved.request.prompt,{documentId:saved.request.documentId,canvasId:saved.request.canvasId,sourceSurface:saved.request.sourceSurface,projectScope:saved.request.projectScope,locale:saved.request.locale});
    const older=await f.take();assert.equal(older.body.action,"quote");
    const before=f.host.planningConsent.get();assert.equal(before.quote,null);assert.equal(before.recoveryExecutionId,undefined);
    const polling=f.host.syncDocumentJobs(),list=await f.take();
    await f.reply(list,{jobs:[{...saved.body.job,result:{planningReviewAvailable:false,resultUnavailable:true}}]});await polling;
    await f.reply(older,{quote:saved.originalQuote,planningRequest:saved.request,executionId:saved.executionId,reused:true});await settleReplacementPreviewR13(f);
    const state=f.host.planningConsent.get(),view=render(f);
    assert.ok(state);assert.equal(state.working,false,"An obsolete response must not leave its unknown-ID review disabled");
    assert.equal(state.quote,null);assert.equal(state.recoveredPlan,undefined);
    assert.doesNotMatch(view.markup,/Original paid interpretation|original-private-input|original-paid-model/u);
    assert.ok(!view.buttons.some(button=>button.label==="planning.consent.approve"));
    // Whether the app now knows the execution ID or only the original intent,
    // the remaining control must be a free lookup/read, never a purchase.
    const retry=view.buttons.find(button=>["context.consent.preview","planning.consent.retrieveExisting","context.consent.reuse"].includes(button.label));
    assert.ok(retry&&!retry.disabled,"Keep a visible, enabled free recovery control");
    retry.click();const request=await f.take();
    assert.ok(["quote","resume","retrieve"].includes(request.body.action));
    assert.equal(request.body.documentId,saved.request.documentId);
    assert.equal(request.body.canvasId,saved.request.canvasId);
    if(request.body.action!=="quote")assert.equal(request.body.executionId,saved.executionId);
    await f.reply(request,{error:"adaptive_existing_request_unavailable",noAutomaticRetry:true},409);
    assert.equal(f.host.planningConsent.get().working,false);
    assert.equal(f.calls.some(call=>call.body?.action==="execute"),false);
    f.host.closePlanningConsent();assert.equal(await decision,false);
  });
}


// Native personal Activity inspection uses this loader independently of polling.
async function personalPlanningDetailFixtureR7(t,canvasId){
  const f=fixture(t,"en",{polling:true}),saved=await retainedActivity(f,{reader:true,canvasId});
  const session=f.host.session.get();
  f.host.session.set({...session,projectContext:null,capabilities:["project.read",...(canvasId?["project.canvas.use"]:[])]});
  saved.originalQuote.workspaceId=null;
  const unrelated={interpretation:"Unrelated document plan must remain"};
  f.host.adaptiveStructures.set({"doc-b":unrelated});f.host.adaptiveSuggestionSets.set({});
  return{f,saved,unrelated};
}
async function showOriginalPlanningDetailR7(f,saved){
  const opening=f.host.reviewPlanningJob(saved.executionId),resume=await f.take();
  assert.equal(resume.body.action,"resume");assert.equal(resume.body.executionId,saved.executionId);
  await f.reply(resume,saved.body);await opening;
  assert.deepEqual(f.host.planningConsent.get().recoveredPlan,saved.originalPlan);
}
function planningDetailHasPrivateBytesR7(f,saved){
  return /Original paid interpretation|original-private-input|original-paid-model|Preserve the original paid intent/u.test(JSON.stringify({
    detail:f.host.inspectionJob(saved.executionId),job:f.host.documentJobs.get().find(job=>job.jobId===saved.executionId),
    plan:f.host.adaptiveStructures.get()[saved.request.documentId],suggestions:f.host.adaptiveSuggestionSets.get()[saved.request.documentId],
    intent:f.host.pendingIntent(saved.executionId),review:f.host.planningConsent.get(),
  }));
}
for(const canvasId of[null,"original-board"]){
  const surface=canvasId?"Canvas":"Document";
  test("adaptive detail observation R7: "+surface+" old personal inspection cannot return or cache bytes withdrawn after a newer resume",{timeout:3000},async t=>{
    const {f,saved,unrelated}=await personalPlanningDetailFixtureR7(t,canvasId);
    // Both Activity controls were available while this original job was failed.
    const reading=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error})),older=await f.take();
    assert.equal(older.url,"/api/document-jobs/"+saved.executionId+"?inspection=1");
    await showOriginalPlanningDetailR7(f,saved);
    const polling=f.host.syncDocumentJobs(),list=await f.take();
    await f.reply(list,{jobs:[{...saved.body.job,result:{planningReviewAvailable:false,resultUnavailable:true}}]});await polling;
    assertInvalidatedPlanningReadR5(f,saved,unrelated);
    await f.reply(older,{job:{...saved.body.job,result:{...saved.body.job.result,planningReviewAvailable:true}}});
    const outcome=await reading;
    assert.equal(outcome.value?.result?.structure,undefined,"Do not return stale private bytes even if a component will discard them");
    assert.equal(outcome.value?.result?.intent,undefined);assert.equal(outcome.value?.result?.quote,undefined);
    assertInvalidatedPlanningReadR5(f,saved,unrelated);
    assert.equal(planningDetailHasPrivateBytesR7(f,saved),false);
    await deliberatelyRecertifyPlanningReadR5(f,saved,unrelated);
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["GET","resume","GET","resume"]);
  });
  for(const flags of[{planningReviewAvailable:false},{resultUnavailable:true},{planningReviewAvailable:false,resultUnavailable:true}]){
    test("adaptive detail observation R7: "+surface+" current personal inspection publishes "+JSON.stringify(flags)+" before returning",{timeout:3000},async t=>{
      const {f,saved,unrelated}=await personalPlanningDetailFixtureR7(t,canvasId);
      await showOriginalPlanningDetailR7(f,saved);
      const publications=[],notify=f.host.notify.bind(f.host);
      f.host.notify=()=>{notify();publications.push({kind:"notification",privateBytes:planningDetailHasPrivateBytesR7(f,saved)});};
      const reading=f.host.loadDocumentJobDetail(saved.executionId).then(value=>{publications.push({kind:"return"});return{value};},error=>{publications.push({kind:"return"});return{error};});
      const exact=await f.take();assert.equal(exact.url,"/api/document-jobs/"+saved.executionId+"?inspection=1");
      await f.reply(exact,{job:{...saved.body.job,result:flags}});const outcome=await reading;
      assert.equal(outcome.value?.result?.structure,undefined);assert.equal(outcome.value?.result?.intent,undefined);
      assertInvalidatedPlanningReadR5(f,saved,unrelated);assert.equal(planningDetailHasPrivateBytesR7(f,saved),false);
      const published=publications.findIndex(entry=>entry.kind==="notification"&&!entry.privateBytes),returned=publications.findIndex(entry=>entry.kind==="return");
      assert.ok(published>=0&&published<returned,"Publish the cleared review/cache/intent before the inspection caller resumes");
      await deliberatelyRecertifyPlanningReadR5(f,saved,unrelated);
      assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","GET","resume"]);
    });
  }
  test("adaptive detail observation R7: "+surface+" current personal inspection retains its exact valid paid result without a purchase",{timeout:3000},async t=>{
    const {f,saved,unrelated}=await personalPlanningDetailFixtureR7(t,canvasId);
    await showOriginalPlanningDetailR7(f,saved);
    const reading=f.host.loadDocumentJobDetail(saved.executionId),exact=await f.take();
    const detail={...saved.body.job,result:{...saved.body.job.result,planningReviewAvailable:true}};
    await f.reply(exact,{job:detail});assert.deepEqual(await reading,detail);
    assert.deepEqual(f.host.inspectionJob(saved.executionId),detail);
    assertRecertifiedPlanningReadR5(f,saved,unrelated);
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","GET"]);
  });
}
test("adaptive detail observation R7: non-adaptive personal details retain the existing exact cache behavior",{timeout:3000},async t=>{
  const f=fixture(t,"en",{polling:true}),session=f.host.session.get();
  f.host.session.set({...session,projectContext:null,capabilities:["project.read"]});
  const listed={jobId:"existing-image",kind:"generate",documentId:"doc-a",status:"failed",requestedAt:"2026-08-27T00:00:00Z",updatedAt:"2026-08-27T00:00:01Z",result:{}};
  const detail={...listed,result:{prompt:"An ordinary retained image prompt.",providerRequestId:"original-image-request",sourceHash:"original-image-source"}};
  f.host.documentJobs.set([listed]);
  const plans=structuredClone(f.host.adaptiveStructures.get()),suggestions=structuredClone(f.host.adaptiveSuggestionSets.get());
  const reading=f.host.loadDocumentJobDetail(listed.jobId),exact=await f.take();
  assert.equal(exact.url,"/api/document-jobs/"+listed.jobId+"?inspection=1");
  await f.reply(exact,{job:detail});assert.deepEqual(await reading,detail);
  assert.deepEqual(await f.host.loadDocumentJobDetail(listed.jobId),detail);
  assert.equal(f.calls.length,1);assert.deepEqual(f.host.documentJobs.get(),[detail]);
  assert.deepEqual(f.host.adaptiveStructures.get(),plans);assert.deepEqual(f.host.adaptiveSuggestionSets.get(),suggestions);
  assert.equal(f.host.planningConsent.get(),null);
});

// Exercise the real worker serialization boundary, then the existing actual
// Store/shell fixture. Certification/DB/provider work is outside this unit:
// the fixture supplies an already-certified completed row, never a real call.
async function adaptiveWorkerSerializationR7(saved,{rawQuoteCheckpoint=false,jobStatus="completed"}={}){
  const workerSyntax=parse("../worker/document-jobs-api.ts");
  const declaration=name=>{
    const node=workerSyntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
    assert.ok(node,"Actual worker serializer helper exists: "+name);return node.getText(workerSyntax);
  };
  const consent=workerSyntax.statements.filter(ts.isVariableStatement).flatMap(node=>node.declarationList.declarations).find(node=>node.name.getText(workerSyntax)==="consentedAdaptiveJob");
  assert.ok(consent?.initializer,"Actual approved-adaptive identity predicate exists");
  const {normalizePromptTechnique}=await import("../src/model/prompt-structures.ts");
  const {documentGenerationRevision,documentGenerationRequestKey}=await import("../src/model/document-jobs.ts");
  // These are actual serialization helpers, including the real quote-removal
  // rules. Unrelated rendering/provider branches are not exercised by this row.
  const helpers=["parseResult","parseRequest","safeResult","generationRevisionFromRequest","generationRequestIdentity","parentJobIdFromRequest","fanKindFromRequest","errorDetailFromResult","queueRecoveryPresentation","serializeJob","safeScopedJob"].map(declaration).join("\n");
  const serializer=eval(stripTypeScriptTypes("(()=>{const certifiedAdaptiveRows=new WeakSet();const consentedAdaptiveJob="+consent.initializer.getText(workerSyntax)+";"+helpers+";return{safeResult,serializeJob,safeScopedJob,certify:row=>certifiedAdaptiveRows.add(row)};})()"));
  const result={...saved.body.job.result,executionId:saved.executionId,bindingHash:saved.originalQuote.bindingHash,requestKey:saved.request.requestKey,sourceHash:saved.originalQuote.sourceHash,billingStatus:jobStatus==="completed"?"settled":"pending",quote:saved.originalQuote};
  const safe=serializer.safeResult(result);
  assert.equal(Object.hasOwn(safe,"quote"),false,"The real safeResult must not forward private quotes");
  const row={job_id:saved.executionId,owner_id:"actor-a",stream_id:"fixture-stream",document_id:saved.request.documentId,kind:"structure_adaptive",status:jobStatus,source_surface:saved.request.sourceSurface,correlation_id:saved.executionId,requested_sequence:7,request_json:JSON.stringify({...saved.request,adaptiveConsentVersion:1}),result_json:JSON.stringify({...safe,...(rawQuoteCheckpoint?{quote:saved.originalQuote}:{}),planningReviewAvailable:true}),error_message:null,attempt_count:1,requested_at:"2026-08-27T00:00:00Z",started_at:"2026-08-27T00:00:01Z",completed_at:jobStatus==="completed"?"2026-08-27T00:05:00Z":null,lease_expires_at:null,notified_at:null,expires_at:"2026-09-27T00:00:00Z",updated_at:"2026-08-27T00:05:00Z"};
  serializer.certify(row);
  const serialized={feed:serializer.serializeJob(row,null,false),detail:serializer.serializeJob(row),scoped:serializer.safeScopedJob(row)};
  for(const [surface,job]of Object.entries(serialized)){
    assert.equal(job.status,jobStatus,surface);
    assert.equal(job.planningExecutionId,saved.executionId,surface);
    assert.equal(Object.hasOwn(job.result,"quote"),false,surface+" must not leak the private quote");
    assert.doesNotMatch(JSON.stringify(job),/original-private-input/u,surface+" must not leak the approved private input");
    assert.deepEqual(job.result.structure,saved.originalPlan,surface+" still publishes its certified plan");
  }
  return serialized;
}

async function serializedPlanningCompletionFixtureR7(t,{canvasId=null,pendingReview=false}={}){
  const {f,saved,unrelated}=await readInvalidationFixtureR5(t,canvasId);
  const session=f.host.session.get();
  f.host.session.set({...session,projectContext:{...session.projectContext,role:"editor",permissions:["project.read","project.author","project.output.request",...(canvasId?["project.canvas.use"]:[])]}});
  assert.equal(f.host.canPreparePlanning(),true);
  const pendingQuote={...saved.originalQuote,status:"reserved",canPrepareNew:false};
  const pendingJob={...saved.originalJob,status:"running",completedAt:null,result:{planningReviewAvailable:true}};
  const pendingBody={quote:pendingQuote,planningRequest:saved.request,job:pendingJob,status:"reserved"};
  let reading=f.host.reviewPlanningJob(saved.executionId),older=await f.take();
  assert.equal(older.body.action,"resume");assert.equal(older.body.executionId,saved.executionId);
  if(pendingReview){
    await f.reply(older,pendingBody,202);assert.equal(await reading,true);
    assert.equal(f.host.planningConsent.get().quote.status,"reserved");
    reading=f.host.previewPlanningConsent();older=await f.take();
    assert.equal(older.body.action,"resume");assert.equal(older.body.executionId,saved.executionId);
  }
  const reviewId=f.host.planningConsent.get().id;
  const serialized=await adaptiveWorkerSerializationR7(saved);
  const polling=f.host.syncDocumentJobs(),list=await f.take();
  assert.equal(list.init.method,"GET");assert.equal(list.url,"/api/document-jobs");
  // Use the actual project feed shape: no synthetic result.quote enrichment.
  await f.reply(list,{jobs:[serialized.scoped]});await polling;
  const state={f,saved,unrelated,reading,older,reviewId,pendingBody,serialized,pendingReview};
  assertSerializedPlanningCompletionR7(state);
  return state;
}
function assertSerializedPlanningCompletionR7(state){
  const {f,saved,unrelated,reviewId,pendingReview}=state;
  const job=f.host.documentJobs.get().find(job=>job.jobId===saved.executionId),review=f.host.planningConsent.get(),view=render(f);
  assert.equal(job?.status,"completed","Older replies cannot downgrade the completed queue entry");
  assert.deepEqual(job.result.structure,saved.originalPlan);
  assert.equal(review?.id,reviewId,"No closing or replacement modal is needed");
  assert.equal(review.recoveryExecutionId,saved.executionId);assert.deepEqual(review.recoveredPlan,saved.originalPlan);
  assert.equal(review.working,false,"The completed plan must not leave a lookup spinner");assert.equal(review.notice,"");
  assert.match(view.markup,/Original paid interpretation — 原文\./u);
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
  if(saved.request.canvasId)assert.deepEqual(f.host.adaptiveSuggestionSets.get()["doc-a"]?.find(item=>item.id===saved.executionId)?.structure,saved.originalPlan);
  else assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],saved.originalPlan);
  assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),pendingReview?["resume","resume","GET"]:["resume","GET"],"Only the original in-flight read and existing polling may run");
  assert.equal(f.calls.some(call=>call.body?.action==="quote"||call.body?.action==="execute"),false,"No new quote, paid approval, or provider request");
  assert.ok(!view.buttons.some(button=>button.label==="planning.consent.approve"));
}
function assertSerializedPlanningReceiptR7(state){
  assertSerializedPlanningCompletionR7(state);
  const {f,saved}=state,review=f.host.planningConsent.get(),view=render(f);
  assert.ok(review.quote,"The authorized original receipt must populate this same open review");
  assert.equal(review.quote.status,"completed");assert.equal(review.quote.executionId,saved.executionId);
  assert.equal(review.quote.bindingHash,saved.originalQuote.bindingHash);assert.equal(review.quote.sourceHash,saved.originalQuote.sourceHash);
  assert.deepEqual(review.quote.privateInput,saved.originalQuote.privateInput);assert.deepEqual(review.quote.models,saved.originalQuote.models);
  assert.equal(review.quote.maximumMicrousd,saved.originalQuote.maximumMicrousd);assert.equal(review.quote.canPrepareNew,true);
  assert.deepEqual(review.request,saved.request);
  assert.match(view.markup,/context\.consent\.reservation/u);assert.match(view.markup,/context\.consent\.exactInput/u);
  assert.match(view.markup,/planning\.consent\.destination/u);assert.match(view.markup,/original-private-input/u);
  assert.match(view.markup,new RegExp(saved.request.canvasId?"planning\\.consent\\.scopeProject":"planning\\.consent\\.scopeDocument","u"));
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.newPreview"&&!button.disabled),"Show the eligible next step without Close → Retrieve existing plan again");
}

test("adaptive serialized completion R7: actual feed, detail and scoped serializers never leak private quotes",async t=>{
  const {saved}=await readInvalidationFixtureR5(t,null);
  await adaptiveWorkerSerializationR7(saved);
  // Even a legacy/raw checkpoint containing a quote must be sanitized.
  await adaptiveWorkerSerializationR7(saved,{rawQuoteCheckpoint:true});
});
for(const canvasId of[null,"original-board"])for(const pendingReview of[false,true]){
  const label=(canvasId?"Canvas":"Document")+" "+(pendingReview?"pending review":"initial review");
  test("adaptive serialized completion R7: "+label+" reconciles the original completed receipt without reopening",{timeout:3000},async t=>{
    const state=await serializedPlanningCompletionFixtureR7(t,{canvasId,pendingReview});
    const {f,saved,older,reading,serialized}=state;
    // The general feed deliberately lacks the private quote. Only the already
    // in-flight exact-ID authorized resume may supply that immutable disclosure.
    const body={...saved.body,job:serialized.scoped};
    await f.reply(older,body);await reading;
    assertSerializedPlanningReceiptR7(state);
  });
  for(const responseKind of["running","failed","non-JSON"]){
    test("adaptive serialized completion R7: "+label+" ignores a late "+responseKind+" response without losing its completed plan",{timeout:3000},async t=>{
      const state=await serializedPlanningCompletionFixtureR7(t,{canvasId,pendingReview});
      const {f,saved,older,reading,pendingBody}=state;
      const beforeQuote=structuredClone(f.host.planningConsent.get().quote);
      if(responseKind==="non-JSON"){
        older.gate.resolve({ok:true,status:200,json:async()=>{throw new SyntaxError("Delayed unreadable response");}});await turn();
      }else if(responseKind==="failed"){
        await f.reply(older,{quote:{...saved.originalQuote,status:"failed",canPrepareNew:false},planningRequest:saved.request,job:{...saved.originalJob,status:"failed",result:{planningReviewAvailable:true}},status:"failed",error:"adaptive_execution_failed"},409);
      }else await f.reply(older,pendingBody,202);
      await reading;assertSerializedPlanningCompletionR7(state);
      assert.deepEqual(f.host.planningConsent.get().quote,beforeQuote,"A stale non-completion cannot rewrite a retained disclosure");
    });
  }
}

// Model the actual FormaElement subscription boundary: publication is observed
// only when production notify() calls the production subscribe() listener.
function watchPlanningPublicationR7(f){
  const snapshots=[];
  const capture=()=>{
    const state=f.host.planningConsent.get();
    if(!state){snapshots.push({markup:"",buttons:[],reviewId:null,recoveryExecutionId:null});return;}
    const view=render(f);
    snapshots.push({...view,reviewId:state.id,recoveryExecutionId:state.recoveryExecutionId});
  };
  capture();const unsubscribe=f.host.subscribe(capture);
  return{snapshots,unsubscribe,last:()=>snapshots.at(-1)};
}
async function planningPublicationPairR7(t,canvasId){
  const f=fixture(t,"en",{polling:true}),older=await retainedActivity(f,{reader:true,canvasId});
  if(canvasId){const session=f.host.session.get();f.host.session.set({...session,projectContext:{...session.projectContext,permissions:[...session.projectContext.permissions,"project.canvas.use"]}});}
  const newerId="publication-sibling-b",request={...older.request,prompt:"The separate retained intent for sibling B",requestKey:""};
  request.requestKey=await adaptiveRequestKey(request);
  const plan={...older.originalPlan,interpretation:"Separate retained plan B"};
  const preview=quote(request,{executionId:newerId,bindingHash:"sibling-b-binding",status:"completed",providerAvailable:false,canExecute:false,canPrepareNew:false});
  const newerJob=job(request,newerId,{planningExecutionId:newerId,planningLocale:request.locale,planningProjectScope:request.projectScope,result:{intent:request.prompt,structure:plan,planningReviewAvailable:true}});
  f.host.documentJobs.set([older.originalJob,newerJob]);
  let opening=f.host.reviewPlanningJob(newerId),resume=await f.take();
  assert.equal(resume.body.action,"resume");assert.equal(resume.body.executionId,newerId);
  await f.reply(resume,{quote:preview,planningRequest:request,job:newerJob});await opening;
  f.host.closePlanningConsent();
  opening=f.host.reviewPlanningJob(older.executionId);resume=await f.take();
  assert.equal(resume.body.action,"resume");assert.equal(resume.body.executionId,older.executionId);
  await f.reply(resume,older.body);await opening;
  assert.match(render(f).markup,/original-private-input/u);
  return{f,older,newerId,newerJob};
}
function assertPublicationUsesOnlyRetainedReadsR7(pair){
  const {f,older,newerId}=pair;
  for(const call of f.calls){
    if(call.init.method==="GET"){
      assert.equal(call.body,null);
      assert.ok(call.url==="/api/document-jobs"||[older.executionId,newerId].some(id=>call.url==="/api/document-jobs/"+encodeURIComponent(id)+"?inspection=1"));
    }else{
      assert.equal(call.url,"/api/document-jobs/adaptive");
      assert.equal(call.body.action,"resume","Publication must not quote, execute, run or call a provider");
      assert.ok([older.executionId,newerId].includes(call.body.executionId));
      assert.equal(Object.hasOwn(call.body,"approvedBindingHash"),false);
    }
  }
}
for(const canvasId of[null,"original-board"]){
  const surface=canvasId?"Canvas":"Document";
  for(const withdrawal of["HTTP404","explicit-withdrawal"]){
    test("adaptive inspection publication R7: "+surface+" publishes "+withdrawal+" before unrelated inspection B returns",{timeout:3000},async t=>{
      const pair=await planningPublicationPairR7(t,canvasId),{f,older,newerId,newerJob}=pair;
      const watched=watchPlanningPublicationR7(f),reads=await missingAdaptivePairRead(pair);
      const before=watched.snapshots.length,reviewId=watched.last().reviewId;
      assert.match(watched.last().markup,/original-private-input/u);
      let siblingReleased=false;
      try{
        if(withdrawal==="HTTP404")await f.reply(reads.byId.get(older.executionId),{error:"job_not_found"},404);
        else await f.reply(reads.byId.get(older.executionId),{job:{...older.body.job,result:{planningReviewAvailable:false,resultUnavailable:true}}});
        assert.ok(watched.snapshots.length>before,"A withdrawal must publish immediately, without waiting for unrelated B");
        const published=watched.snapshots.slice(before);
        for(const view of published){
          assert.equal(view.reviewId,reviewId);
          assert.equal(view.recoveryExecutionId,older.executionId);
          assert.doesNotMatch(view.markup,/Original paid interpretation|Original next decision|Original later decision|original-private-input|original-paid-model|Preserve the original paid intent/u);
        }
        const view=watched.last();
        const retry=view.buttons.find(button=>button.label==="planning.consent.retrieveExisting");
        assert.ok(retry&&!retry.disabled,"The actual published view must keep the free original-ID recovery control usable");
        assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview"].includes(button.label)));
        retry.click();const original=await f.take();
        assert.equal(original.body.action,"resume");assert.equal(original.body.executionId,older.executionId);
        assert.equal(original.body.prompt,"");assert.equal(original.body.documentId,older.request.documentId);
        assert.equal(original.body.canvasId,canvasId);
        await f.reply(original,{error:"adaptive_result_unavailable",noAutomaticRetry:true},404);
        assert.equal(siblingReleased,false);
        assertPublicationUsesOnlyRetainedReadsR7(pair);
      }finally{
        siblingReleased=true;await f.reply(reads.byId.get(newerId),{job:newerJob});await reads.pending;watched.unsubscribe();
      }
    });
  }
  test("adaptive inspection publication R7: "+surface+" publishes recovered A immediately while unrelated inspection B still waits",{timeout:3000},async t=>{
    const pair=await planningPublicationPairR7(t,canvasId),{f,older,newerId,newerJob}=pair;
    const outage=await missingAdaptivePairRead(pair);
    for(const call of outage.byId.values())await f.reply(call,{error:"temporary_inspection_failure"},500);
    await outage.pending;
    assert.equal(f.host.planningConsent.get().recoveryExecutionId,older.executionId);
    assert.equal(f.host.planningConsent.get().recoveredPlan,undefined);
    const watched=watchPlanningPublicationR7(f),reads=await missingAdaptivePairRead(pair);
    const before=watched.snapshots.length,reviewId=watched.last().reviewId;
    assert.doesNotMatch(watched.last().markup,/Original paid interpretation/u);
    try{
      // Exact job serialization intentionally withholds the consent quote.
      // This case proves result publication, not private-receipt reconstruction.
      const completed={...older.body.job,result:{...older.body.job.result,planningReviewAvailable:true}};
      assert.equal(Object.hasOwn(completed.result,"quote"),false);
      await f.reply(reads.byId.get(older.executionId),{job:completed});
      assert.ok(watched.snapshots.length>before,"Completed A must publish without waiting for unrelated B");
      const view=watched.last();
      assert.equal(view.reviewId,reviewId);assert.equal(view.recoveryExecutionId,older.executionId);
      assert.match(view.markup,/Original paid interpretation — 原文\./u);
      assert.match(view.markup,/Original next decision/u);
      assert.doesNotMatch(view.markup,/planning\.consent\.checking|planning\.consent\.preparing/u);
      assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));
      assert.ok(!view.buttons.some(button=>button.label==="planning.consent.approve"));
      assertPublicationUsesOnlyRetainedReadsR7(pair);
    }finally{
      await f.reply(reads.byId.get(newerId),{job:newerJob});await reads.pending;watched.unsubscribe();
    }
  });
}


// Initial approval already has an exact reviewed execution ID, even before its
// first job response. These use actual store methods and reordered HTTP only.
async function initialPlanningAdmissionR7(t, canvasId) {
  const f = fixture(t, "en", { polling: true });
  if (canvasId) {
    const session = f.host.session.get();
    f.host.session.set({ ...session, projectContext: { ...session.projectContext, permissions: [...session.projectContext.permissions, "project.canvas.use"] } });
  }
  const unrelated = { interpretation: "UNRELATED R7 DOCUMENT PLAN" };
  f.host.adaptiveStructures.set({ "doc-b": unrelated }); f.host.adaptiveSuggestionSets.set({});
  const opened = await open(f, "PRIVATE R7 ORIGINAL APPROVED INTENT", {
    documentId: "doc-a", ...(canvasId ? { canvasId } : {}),
    sourceSurface: canvasId ? "canvas" : "adaptive", projectScope: Boolean(canvasId), locale: "en",
  });
  const request = { ...opened.request.body }; delete request.action;
  const id = opened.preview.executionId, approving = f.host.approvePlanningConsent(), submitted = await f.take();
  assert.equal(submitted.body.action, "execute"); assert.equal(submitted.body.executionId, id);
  assert.equal(submitted.body.approvedBindingHash, opened.preview.bindingHash);
  assert.equal(f.host.planningConsent.get().submitted, true);
  const pending = job(request, id, {
    planningExecutionId: id, planningProjectScope: request.projectScope, planningLocale: request.locale,
    status: "running", completedAt: null,
    result: { executionId: id, bindingHash: opened.preview.bindingHash, planningReviewAvailable: true },
  });
  const accepted = { quote: { ...opened.preview, status: "reserved", canExecute: false }, job: pending, status: "reserved" };
  return { f, opened, request, id, approving, submitted, pending, accepted, unrelated };
}
function assertInitialPlanningAdmissionCallsR7(state) {
  const { f, id, opened } = state, quotes = f.calls.filter(call => call.body?.action === "quote"), executions = f.calls.filter(call => call.body?.action === "execute");
  assert.equal(quotes.length, 1); assert.equal(executions.length, 1, "Progress and recovery cannot buy the same work again");
  assert.equal(executions[0].body.executionId, id); assert.equal(executions[0].body.approvedBindingHash, opened.preview.bindingHash);
  assert.ok(f.calls.every(call => call.init.method === "GET" || ["quote", "execute"].includes(call.body?.action)));
  assert.deepEqual(f.host.events.get(), []);
}

for(const canvasId of[null,"initial-approved-board"])test("adaptive initial admission R7: "+(canvasId?"Canvas":"Document")+" closing an in-flight first approval keeps only its exact recovery handle",{timeout:3000},async t=>{
  const state=await initialPlanningAdmissionR7(t,canvasId),{f,id,submitted,approving,accepted,opened}=state;
  assert.deepEqual(f.host.planningRecoveryEntries(),[],"An active first submission is not an omitted historical job");
  f.host.closePlanningConsent();assert.equal(await opened.decision,false);
  const entries=f.host.planningRecoveryEntries();assert.equal(entries.length,1);assert.equal(entries[0].jobId,id);
  assert.doesNotMatch(JSON.stringify(entries),/PRIVATE|source-a|model-a|quoted|reserved/u);
  await f.reply(submitted,accepted,202);await approving;
  assert.equal(f.host.planningConsent.get(),null);assert.deepEqual(f.host.documentJobs.get(),[]);
  const reopening=f.host.reviewPlanningJob(id),lookup=await f.take();
  assert.equal(lookup.body.action,"resume");assert.equal(lookup.body.executionId,id);
  await f.reply(lookup,{...accepted,planningRequest:state.request},202);await reopening;
  assert.equal(f.host.planningConsent.get().recoveryExecutionId,id);assert.equal(f.host.planningConsent.get().working,false);
  assert.equal(f.calls.filter(call=>call.body?.action==="execute").length,1);
  assert.equal(f.calls.filter(call=>call.body?.action==="quote").length,1);
});

for (const canvasId of [null, "initial-approved-board"]) {
  const surface = canvasId ? "Canvas" : "Document";
  for (const status of ["queued", "running"]) {
    test("adaptive initial admission R7: " + surface + " " + status + " discovery before 202 keeps the exact approval usable", { timeout: 3_000 }, async t => {
      const state = await initialPlanningAdmissionR7(t, canvasId), { f, opened, id, submitted, approving, pending, accepted, unrelated } = state;
      let polling;
      try {
        polling = f.host.syncDocumentJobs(); const list = await f.take(); assert.equal(list.init.method, "GET");
        await f.reply(list, { jobs: [{ ...pending, status }] }); await polling;
        await f.reply(submitted, accepted, 202); await approving;
        assert.equal(f.host.planningConsent.get(), null, "A valid admission response must not be discarded into a permanently working quoted review");
        assert.equal(await opened.decision, true);
        const current = f.host.documentJobs.get().find(item => item.jobId === id);
        assert.ok(current); assert.equal(current.requestKey, state.request.requestKey);
        assert.equal(current.planningExecutionId, id); assert.equal(current.status, "running");
        assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"], unrelated);
        assertInitialPlanningAdmissionCallsR7(state);
      } finally {
        await f.reply(submitted, accepted, 202); await approving; await polling;
        f.host.closePlanningConsent();
      }
    });
  }

  for (const outcome of ["completed", "withdrawn"]) {
    test("adaptive initial admission R7: " + surface + " " + outcome + " observation owns the submitted quoted review before its old 202 arrives", { timeout: 3_000 }, async t => {
      const state = await initialPlanningAdmissionR7(t, canvasId), { f, id, submitted, approving, pending, accepted, unrelated } = state;
      const entered = deferred(), release = deferred(); let polling;
      const plan = {
        interpretation: "R7 ORIGINAL PAID PLAN IS COMPLETE",
        active_decision: { type: "subject", label: "Original subject", prompt: "Keep the approved subject.", why: "Preserve the approved brief." },
        suggested_blocks: [
          { type: "lighting", subtype: "Natural", label: "Original light", instruction: "Keep soft light.", reason: "Preserve continuity.", relationship_to: "Original subject" },
          { type: "environment", subtype: "Setting", label: "Original place", instruction: "Keep the original setting.", reason: "Preserve context.", relationship_to: "Original subject" },
        ], hidden_until_later: [],
      };
      const observed = { ...pending, status: outcome === "completed" ? "completed" : "failed", updatedAt: "2026-08-27T00:05:00Z", completedAt: "2026-08-27T00:05:00Z",
        // Match real job-feed serialization: no private quote is injected here.
        result: outcome === "completed"
          ? { executionId: id, bindingHash: state.opened.preview.bindingHash, planningReviewAvailable: true, structure: plan, intent: state.request.prompt }
          : { planningReviewAvailable: false, resultUnavailable: true },
      };
      const assertObserved = () => {
        const review = f.host.planningConsent.get(); assert.ok(review);
        assert.equal(review.working, false, "Terminal evidence must settle the initial review before another refresh can finish");
        assert.equal(review.submitted, true);
        assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"], unrelated);
        const view = render(f);
        assert.ok(!view.buttons.some(button => button.label === "planning.consent.approve"), "Observed completion or withdrawal cannot expose another approval");
        if (outcome === "completed") {
          assert.deepEqual(review.recoveredPlan, plan);
          assert.equal(review.quote?.executionId ?? review.recoveryExecutionId, id);
          if (canvasId) assert.deepEqual(f.host.adaptiveSuggestionSets.get()["doc-a"]?.find(item => item.id === id)?.structure, plan);
          else { assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"], plan); assert.equal(f.host.knownPlanJob("doc-a"), id); }
          assert.match(view.markup, /R7 ORIGINAL PAID PLAN IS COMPLETE/u);
        } else {
          assert.equal(review.recoveryExecutionId, id); assert.equal(review.quote, null);
          assert.equal(review.recoveredPlan, undefined); assert.equal(review.request.prompt, "");
          assert.equal(f.host.pendingIntent(id), undefined); assert.equal(f.host.adaptiveStructures.get()["doc-a"], undefined);
          assert.ok(!(f.host.adaptiveSuggestionSets.get()["doc-a"] ?? []).some(item => item.id === id));
          assert.doesNotMatch(view.markup, /PRIVATE R7 ORIGINAL APPROVED INTENT|source-a/u);
          assert.ok(view.buttons.some(button => button.label === "planning.consent.retrieveExisting" && !button.disabled));
        }
      };
      try {
        f.host.onEventRefresh = async () => { entered.resolve(); await release.promise; };
        polling = f.host.syncDocumentJobs(); const list = await f.take();
        await f.reply(list, { jobs: [observed] }); await entered.promise;
        assertObserved();
        const beforeOldResponse = structuredClone(f.host.planningConsent.get());
        await f.reply(submitted, accepted, 202); await approving;
        assertObserved(); assert.deepEqual(f.host.planningConsent.get(), beforeOldResponse, "The older 202 cannot undo newer terminal evidence");
        release.resolve(); await polling; assertObserved();
        assert.equal(f.host.documentJobs.get().find(item => item.jobId === id)?.status, observed.status);
        assertInitialPlanningAdmissionCallsR7(state);
      } finally {
        release.resolve(); await f.reply(submitted, accepted, 202); await approving; await polling;
        f.host.closePlanningConsent();
      }
    });
  }
}

// A completed predecessor is not the identity of a newly quoted replacement.
// Reuse the actual Store/poll/shell fixture; all provider responses below are
// deterministic memory ports, including the explicitly approved B execution.
function replacementPredecessorObservationR7(saved,withdrawn=false){
  return{...saved.body.job,result:withdrawn?{planningReviewAvailable:false,resultUnavailable:true}:{...saved.body.job.result,quote:saved.originalQuote,planningReviewAvailable:true}};
}
async function beginReplacementObservationR7(t,canvasId){
  const pair=await displayedAdaptivePlan(t,{canvasId,reader:false}),{f,saved}=pair;
  const preview=quote(saved.request,{executionId:"replacement-preview-b",bindingHash:"replacement-binding-b",sourceHash:"current-source-b",status:"quoted",canPrepareNew:false,privateInput:{approved:"PRIVATE NEW B SOURCE"},models:["new-b-model"]});
  const preparing=f.host.newPlanningPreview(),request=await f.take();
  assert.equal(request.body.action,"quote");assert.equal(request.body.replaceExecutionId,saved.executionId);assert.equal(request.body.prompt,saved.request.prompt);assert.equal(request.body.requestKey,saved.request.requestKey);
  assert.equal(Object.hasOwn(request.body,"executionId"),false);assert.equal(Object.hasOwn(request.body,"approvedBindingHash"),false);
  assert.equal(f.host.planningConsent.get().working,true);
  assert.deepEqual(f.host.planningConsent.get().recoveredPlan,saved.originalPlan);
  return{...pair,preview,preparing,request};
}
async function observeReplacementPredecessorR7(pair,withdrawn=false){
  const {f,saved}=pair,polling=f.host.syncDocumentJobs(),list=await f.take();
  assert.equal(list.init.method,"GET");assert.equal(list.url,"/api/document-jobs");assert.equal(list.body,null);
  await f.reply(list,{jobs:[replacementPredecessorObservationR7(saved,withdrawn)]});await polling;
}
function assertReplacementPreviewReadyR7(pair){
  const {f,preview,saved,unrelated}=pair,state=f.host.planningConsent.get(),view=render(f);
  assert.ok(state);assert.deepEqual(state.quote,preview);assert.equal(state.quote.status,"quoted");
  assert.equal(state.replaceExecutionId,undefined,"Once B is adopted, the predecessor is server-bound provenance, not B's current client execution identity");
  assert.equal(state.recoveryExecutionId,undefined);assert.equal(state.recoveredPlan,undefined);assert.equal(state.working,false);assert.equal(state.submitted,false);assert.equal(state.notice,"");assert.deepEqual(state.request,saved.request);
  assert.match(view.markup,/PRIVATE NEW B SOURCE|new-b-model/u);assert.doesNotMatch(view.markup,/original-private-input|original-paid-model/u);
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.approve"&&!button.disabled));
  assert.ok(view.buttons.some(button=>button.label==="action.cancel"));
  assert.ok(!view.buttons.some(button=>["planning.consent.newPreview","planning.consent.retrieveExisting","planning.consent.closeReview"].includes(button.label)));
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
}
for(const canvasId of[null,"original-board"]){
  const surface=canvasId?"Canvas":"Document";
  test("adaptive replacement observation R7: "+surface+" unchanged A completion preserves a working explicit preview and adopts B",{timeout:3000},async t=>{
    const pair=await beginReplacementObservationR7(t,canvasId),{f,saved,preview,preparing,request}=pair;
    await observeReplacementPredecessorR7(pair);
    const during=f.host.planningConsent.get();
    // Settle the controlled response before assertions so a failing regression
    // cannot leave a detached mock request waiting after the test ends.
    await f.reply(request,{quote:preview});await preparing;
    assert.equal(during.working,true,"An unchanged completed predecessor cannot cancel preparation of a different free quote");
    assert.equal(during.replaceExecutionId,saved.executionId);assert.deepEqual(during.quote,saved.originalQuote);assert.deepEqual(during.recoveredPlan,saved.originalPlan);assert.equal(during.notice,"");
    assertReplacementPreviewReadyR7(pair);
    if(canvasId)assert.deepEqual(f.host.adaptiveSuggestionSets.get()["doc-a"]?.find(item=>item.id===saved.executionId)?.structure,saved.originalPlan);
    else assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],saved.originalPlan);
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","quote","GET"]);
    assert.equal(f.calls.some(call=>call.body?.action==="execute"),false);
  });
  test("adaptive replacement observation R7: "+surface+" A withdrawal still invalidates its pending replacement preview",{timeout:3000},async t=>{
    const pair=await beginReplacementObservationR7(t,canvasId),{f,saved,unrelated,preview,preparing,request}=pair;
    await observeReplacementPredecessorR7(pair,true);
    assertUnverifiedAdaptivePlanCleared(f,saved,unrelated);
    await f.reply(request,{quote:preview});await preparing;
    assertUnverifiedAdaptivePlanCleared(f,saved,unrelated);
    assert.doesNotMatch(render(f).markup,/PRIVATE NEW B SOURCE|new-b-model/u);
    assert.equal(f.host.planningConsent.get().replaceExecutionId,undefined);
    assert.ok(f.host.documentJobs.get().some(entry=>entry.jobId===saved.executionId),"Keep A's exact content-free Activity recovery route");
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","quote","GET"]);
    assert.equal(f.calls.some(call=>call.body?.action==="execute"),false);
  });
  for(const observation of["completed","withdrawn"])test("adaptive replacement observation R7: "+surface+" adopted B approval is independent of later A "+observation+" observation",{timeout:3000},async t=>{
    const pair=await beginReplacementObservationR7(t,canvasId),{f,saved,unrelated,preview,preparing,request}=pair;
    await f.reply(request,{quote:preview});await preparing;
    const adopted=f.host.planningConsent.get();
    assert.deepEqual(adopted.quote,preview);assert.equal(adopted.recoveryExecutionId,undefined);assert.equal(adopted.working,false);
    const approving=f.host.approvePlanningConsent(),execute=await f.take();
    assert.equal(execute.body.action,"execute");assert.equal(execute.body.executionId,preview.executionId);assert.equal(execute.body.approvedBindingHash,preview.bindingHash);assert.equal(Object.hasOwn(execute.body,"replaceExecutionId"),false);
    await observeReplacementPredecessorR7(pair,observation==="withdrawn");
    const during=f.host.planningConsent.get();
    const completedQuote={...preview,status:"completed",canExecute:false},structure={...saved.originalPlan,interpretation:"NEW B COMPLETED PLAN"};
    const completed=job(saved.request,preview.executionId,{planningExecutionId:preview.executionId,planningLocale:saved.request.locale,planningProjectScope:saved.request.projectScope,result:{structure,intent:saved.request.prompt,quote:completedQuote,planningReviewAvailable:true}});
    await f.reply(execute,{quote:completedQuote,planningRequest:saved.request,job:completed,status:"completed"});await approving;
    assert.equal(during.working,true,"Only B's own completion or withdrawal can settle its approval");
    assert.equal(during.quote.executionId,preview.executionId);assert.equal(during.quote.bindingHash,preview.bindingHash);assert.equal(during.recoveredPlan,undefined);assert.equal(during.notice,"");
    assert.equal(f.host.planningConsent.get(),null,"A later A observation must not make the accepted B response disappear or strand its approval controls");
    assert.equal(adopted.replaceExecutionId,undefined,"B approval must track B, not retain A as the current execution identity");
    assert.deepEqual(f.host.documentJobs.get().find(entry=>entry.jobId===preview.executionId)?.result?.structure,structure);
    if(canvasId)assert.deepEqual(f.host.adaptiveSuggestionSets.get()["doc-a"]?.find(item=>item.id===preview.executionId)?.structure,structure);
    else{assert.equal(f.host.knownPlanJob("doc-a"),preview.executionId);assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],structure);}
    assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","quote","execute","GET"]);
    assert.deepEqual(f.calls.filter(call=>call.body?.action==="execute").map(call=>call.body.executionId),[preview.executionId]);
  });
}

// Reuses adaptiveActivityCapacityR8/adaptiveCapacityNeighborsR8 from the
// capacity regression patch and the existing personal detail/serializer ports.
// Keep A pending in the feed: ordinary retained progress is not a terminal
// observation and must not independently invalidate its held exact read.
for(const canvasId of[null,"original-board"]){
  test("adaptive active-read capacity R8: "+(canvasId?"Canvas":"Document")+" represented pending detail survives a supported full Activity page",{timeout:15000},async t=>{
    const {f,saved,unrelated}=await personalPlanningDetailFixtureR7(t,canvasId);
    const pending={...saved.originalJob,status:"running",completedAt:null,result:{planningReviewAvailable:true}};
    f.host.documentJobs.set([pending]);
    const detail=(await adaptiveWorkerSerializationR7(saved)).detail;
    const neighbors=await adaptiveCapacityNeighborsR8(saved,adaptiveActivityCapacityR8()-1);
    const page=[pending,...neighbors];
    assert.equal(page.length,adaptiveActivityCapacityR8());
    assert.equal(new Set(page.map(job=>job.jobId)).size,page.length);
    assert.equal(Object.hasOwn(detail.result,"quote"),false,"The real private inspection serializer does not expose the quote");
    assert.ok(page.every(job=>!Object.hasOwn(job.result,"quote")),"No general feed entry is artificially enriched with private metadata");
    const reading=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error}));
    const exact=await f.take();
    assert.equal(exact.init.method,"GET");assert.equal(exact.url,"/api/document-jobs/"+saved.executionId+"?inspection=1");
    const polling=f.host.syncDocumentJobs(),list=await f.take();
    assert.equal(list.init.method,"GET");assert.equal(list.url,"/api/document-jobs");
    await f.reply(list,{jobs:page});await polling;
    assert.equal(f.host.documentJobs.get().find(job=>job.jobId===saved.executionId)?.status,"running");
    assert.equal(f.host.planningConsent.get(),null,"A detail inspection does not open a planning approval");
    // The original exact request is still valid and its current identity is
    // represented in the authorized page. Capacity pressure alone cannot erase
    // its revision and turn a retained completed response into an error.
    await f.reply(exact,{job:detail});const outcome=await reading;
    assert.equal(outcome.error,undefined,"An in-flight represented detail must not fail because unrelated rows exhausted historical recovery slots");
    assert.deepEqual(outcome.value,detail);
    assert.deepEqual(f.host.inspectionJob(saved.executionId),detail);
    assert.deepEqual(f.host.documentJobs.get().find(job=>job.jobId===saved.executionId),detail);
    assert.deepEqual(outcome.value.result.structure,saved.originalPlan);
    assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
    assert.equal(f.host.planningConsent.get(),null);
    assert.deepEqual(f.calls.map(call=>[call.url,call.init.method]),[["/api/document-jobs/"+saved.executionId+"?inspection=1","GET"],["/api/document-jobs","GET"]],"One held detail read and one ordinary feed; no replacement, quote, approval, or provider request");
  });
}

// Capacity must be tested against the real API page size, not an invented
// 25-row pagination contract. Both current Activity list queries allow 120.
function adaptiveActivityCapacityR8(){
  const source=readFileSync(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8");
  const scoped=/ORDER BY CASE WHEN job\.status[^\n]+LIMIT (\d+)/u.exec(source);
  const personal=/ORDER BY CASE WHEN status IN \('queued','running','committing'\) THEN 0 ELSE 1 END,requested_at DESC LIMIT (\d+)/u.exec(source);
  assert.ok(scoped&&personal,"Read the real scoped and personal job-feed SQL limits");
  const limit=Math.min(Number(scoped[1]),Number(personal[1]));
  assert.ok(Number.isSafeInteger(limit)&&limit>25,"These fixtures require an actually supported feed larger than the 24-entry recovery cache");
  return limit;
}
async function adaptiveCapacityNeighborsR8(saved,count){
  assert.ok(count<=adaptiveActivityCapacityR8());
  const jobs=[];
  for(let index=0;index<count;index++){
    const executionId="capacity-other-"+index;
    const request={...saved.request,prompt:"Independent authorized planning intent "+index};
    request.requestKey=await adaptiveRequestKey(request);
    const originalPlan={...saved.originalPlan,interpretation:"Other completed plan "+index};
    const originalQuote={...saved.originalQuote,executionId,bindingHash:"capacity-binding-"+index};
    const originalJob={...saved.originalJob,jobId:executionId,planningExecutionId:executionId,requestKey:request.requestKey};
    const body={quote:originalQuote,planningRequest:request,job:{...originalJob,status:"completed",result:{intent:request.prompt,structure:originalPlan}},status:"completed"};
    // Reuse the actual safeResult + serializeJob + scoped serialization fixture.
    // Only synthetic identities/retained outputs are supplied; no app/provider work.
    const serialized=await adaptiveWorkerSerializationR7({request,executionId,originalPlan,originalQuote,originalJob,body});
    jobs.push(serialized.scoped);
  }
  return jobs;
}
async function settleCapacityPollR8(f,polling,cursor,saved,serialized){
  let settled=false;
  const completion=Promise.resolve(polling).finally(()=>{settled=true;});
  // A repair may retain A and perform its normal free exact inspection. Permit
  // that one identity; do not require a specific internal caching implementation.
  for(let index=0;index<64&&!settled;index++){
    while(cursor<f.calls.length){
      const call=await f.take();assert.equal(call,f.calls[cursor++]);
      assert.equal(call.init.method,"GET","Capacity recovery must remain read-only");assert.equal(call.body,null);
      assert.equal(call.url,"/api/document-jobs/"+encodeURIComponent(saved.executionId)+"?inspection=1","Only the original omitted execution needs exact recovery");
      await f.reply(call,{job:serialized});
    }
    if(!settled)await turn();
  }
  assert.equal(settled,true,"A supported Activity page must settle after bounded exact recovery");await completion;
}
function assertCapacityOriginalReadableR8(f,saved,reviewId){
  const state=f.host.planningConsent.get(),view=render(f);
  assert.equal(state?.id,reviewId,"The original request stays in this open review");
  assert.equal(state.recoveryExecutionId,saved.executionId);
  assert.equal(state.working,false,"Cache pressure must not strand an already-delivered receipt behind a disabled spinner");
  assert.equal(state.notice,"");assert.deepEqual(state.recoveredPlan,saved.originalPlan);
  assert.equal(state.quote?.executionId,saved.executionId,"The original valid completed reply must still be adopted");
  assert.equal(state.quote.status,"completed");assert.deepEqual(state.quote.privateInput,saved.originalQuote.privateInput);
  assert.match(view.markup,/Original paid interpretation — 原文\./u);assert.match(view.markup,/context\.consent\.exactInput/u);
  assert.ok(!view.buttons.some(button=>button.label==="planning.consent.approve"));
  if(saved.request.canvasId)assert.deepEqual(f.host.adaptiveSuggestionSets.get()["doc-a"]?.find(item=>item.id===saved.executionId)?.structure,saved.originalPlan);
  else{assert.equal(f.host.knownPlanJob("doc-a"),saved.executionId);assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],saved.originalPlan);}
  assert.deepEqual(f.calls.filter(call=>call.init.method==="POST").map(call=>[call.body.action,call.body.executionId]),[["resume",saved.executionId]],"Do not reconstruct intent, purchase, or issue a replacement request to recover A");
}

test("adaptive capacity R8: fixtures fit the actual scoped and personal Activity feed limits",()=>{
  const limit=adaptiveActivityCapacityR8();assert.ok(26<=limit);
});
for(const canvasId of[null,"original-board"]){
  const surface=canvasId?"Canvas":"Document";
  for(const placement of["omitted-full-page","first-before-25-others"]){
    test("adaptive capacity R8: "+surface+" active original receipt survives "+placement,{timeout:15000},async t=>{
      const {f,saved,unrelated}=await readInvalidationFixtureR5(t,canvasId);
      const original=(await adaptiveWorkerSerializationR7(saved)).scoped;
      // A full supported page may omit A. The other case keeps A in the feed,
      // ahead of 25 unrelated jobs, proving that omission alone is not the cause.
      const count=placement==="omitted-full-page"?adaptiveActivityCapacityR8():25;
      const others=await adaptiveCapacityNeighborsR8(saved,count);
      const page=placement==="omitted-full-page"?others:[original,...others];
      assert.ok(page.length<=adaptiveActivityCapacityR8());assert.equal(new Set(page.map(job=>job.jobId)).size,page.length);
      const reading=f.host.reviewPlanningJob(saved.executionId),older=await f.take();
      assert.equal(older.body.action,"resume");assert.equal(older.body.executionId,saved.executionId);
      const reviewId=f.host.planningConsent.get().id;
      const polling=f.host.syncDocumentJobs(),list=await f.take(),cursor=f.calls.length;
      assert.equal(list.url,"/api/document-jobs");assert.equal(list.init.method,"GET");
      await f.reply(list,{jobs:page});await settleCapacityPollR8(f,polling,cursor,saved,original);
      await f.reply(older,{...saved.body,job:original});await reading;
      assertCapacityOriginalReadableR8(f,saved,reviewId);
      assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
    });
  }
  test("adaptive capacity R8: "+surface+" closed selected original survives repeated full supported pages without reopening",{timeout:15000},async t=>{
    const {f,saved,unrelated}=await displayedAdaptivePlan(t,{canvasId,reader:true});f.host.closePlanningConsent();
    const original=(await adaptiveWorkerSerializationR7(saved)).scoped,others=await adaptiveCapacityNeighborsR8(saved,adaptiveActivityCapacityR8());
    for(let pass=0;pass<2;pass++){
      const polling=f.host.syncDocumentJobs(),list=await f.take(),cursor=f.calls.length;
      assert.equal(list.url,"/api/document-jobs");await f.reply(list,{jobs:others});await settleCapacityPollR8(f,polling,cursor,saved,original);
      assert.equal(f.host.planningConsent.get(),null,"Background recertification must not reopen the review");
      if(canvasId)assert.deepEqual(f.host.adaptiveSuggestionSets.get()["doc-a"]?.find(item=>item.id===saved.executionId)?.structure,saved.originalPlan);
      else{assert.equal(f.host.knownPlanJob("doc-a"),saved.executionId);assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],saved.originalPlan);}
      assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
      assert.ok(f.host.planningRecoveryEntries().some(entry=>entry.jobId===saved.executionId),"Keep the exact omitted identity discoverable in Activity");
      assert.ok(!f.host.documentJobs.get().some(job=>job.jobId===saved.executionId),"An exact inspection must not inject A into an unrelated/full feed page");
    }
    assert.deepEqual(f.calls.filter(call=>call.init.method==="POST").map(call=>[call.body.action,call.body.executionId]),[["resume",saved.executionId]]);
    assert.equal(f.calls.filter(call=>call.url==="/api/document-jobs/"+saved.executionId+"?inspection=1").length,2,"Each omitted page recertifies the original privately and for free");
  });
}

// A valid requested-A/reused-B receipt is a cross-session identity handoff,
// not a second approval. Use real job serializers as well as actual Store,
// subscription-independent shell handlers, and deterministic memory ports.
async function crossSessionWinnerFixtureR8(t,canvasId){
  const state=await initialPlanningAdmissionR7(t,canvasId),{f,opened,request,submitted,approving}=state;
  const winnerId="winner-execution-r8",reviewId=f.host.planningConsent.get().id;
  const plan={
    interpretation:"WINNER_PAID_PLAN_R8",
    active_decision:{type:"subject",label:"Winner subject",prompt:"Keep the original winner subject.",why:"Use the work already approved."},
    suggested_blocks:[
      {type:"lighting",subtype:"Natural",label:"Winner lighting",instruction:"Keep the winner light.",reason:"Preserve the approved result.",relationship_to:"Winner subject"},
      {type:"environment",subtype:"Setting",label:"Winner setting",instruction:"Keep the winner setting.",reason:"Preserve continuity.",relationship_to:"Winner subject"},
    ],hidden_until_later:["Winner later decision"],
  };
  const completedQuote=quote(request,{
    executionId:winnerId,bindingHash:"winner-binding-r8",sourceHash:"winner-source-r8",status:"completed",
    canExecute:false,canPrepareNew:true,models:["winner-model-r8"],maximumMicrousd:8000,maximumTokens:1700,
    privateInput:{approved:"WINNER_PRIVATE_INPUT_R8",scope:canvasId?"whole-project":"document",projectTitle:"Winner original project",documentTitle:"Winner original document",canvasTitle:canvasId?"Winner original board":null,documentCount:canvasId?3:1,blockCount:9,protectedBlockCount:2},
  });
  const pendingQuote={...completedQuote,status:"reserved",canPrepareNew:false};
  const rawCompleted=job(request,winnerId,{planningExecutionId:winnerId,planningLocale:request.locale,planningProjectScope:request.projectScope,result:{structure:plan,intent:request.prompt}});
  const completed=await adaptiveWorkerSerializationR7({executionId:winnerId,request,originalQuote:completedQuote,originalPlan:plan,body:{job:rawCompleted}});
  const pending=await adaptiveWorkerSerializationR7({
    executionId:winnerId,request,originalQuote:pendingQuote,originalPlan:undefined,
    body:{job:{...rawCompleted,status:"running",completedAt:null,result:{planningReviewAvailable:true}}},
  },{jobStatus:"running"});
  const pair={requestedExecutionId:opened.preview.executionId,reusedExecutionId:winnerId};
  const completedBody={quote:completedQuote,planningRequest:request,job:completed.scoped,status:"completed",...pair};
  const pendingBody={quote:pendingQuote,planningRequest:request,job:pending.scoped,status:"reserved",...pair};
  t.after(async()=>{await f.reply(submitted,pendingBody,202);await approving;f.host.closePlanningConsent();await opened.decision;});
  return{...state,winnerId,reviewId,plan,completedQuote,pendingQuote,completedJob:completed.scoped,pendingJob:pending.scoped,completedBody,pendingBody};
}
async function observeWinnerR8(state,observed){
  const {f}=state,polling=f.host.syncDocumentJobs(),list=await f.take();
  assert.equal(list.init.method,"GET");assert.equal(list.url,"/api/document-jobs");assert.equal(list.body,null);
  await f.reply(list,{jobs:[observed]});await polling;
}
function assertSingleApprovalR8(state){
  const {f,opened,unrelated}=state;
  assert.deepEqual(f.calls.filter(call=>call.body?.action==="execute").map(call=>({id:call.body.executionId,hash:call.body.approvedBindingHash})),[{id:opened.preview.executionId,hash:opened.preview.bindingHash}],"The winner handoff cannot submit a second approval");
  assert.equal(f.calls.filter(call=>call.body?.action==="quote").length,1,"Recovery cannot create a replacement preview");
  assert.ok(f.calls.every(call=>call.init.method==="GET"||["quote","execute","retrieve","resume"].includes(call.body?.action)));
  assert.deepEqual(f.host.events.get(),[]);assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
}
function assertWinnerContinuityR8(state,jobStatus){
  const {f,winnerId,reviewId,plan}=state,review=f.host.planningConsent.get();
  assert.ok(review,"The existing review must expose the winner, not require close and re-entry");
  assert.equal(review.id,reviewId);assert.equal(review.recoveryExecutionId??review.quote?.executionId,winnerId);
  assert.equal(review.working,false);assert.equal(review.submitted,true);assert.equal(review.replaceExecutionId,undefined);
  const current=f.host.documentJobs.get().find(item=>item.jobId===winnerId);
  assert.ok(current);assert.equal(current.status,jobStatus);
  const view=render(f);
  assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","action.cancel"].includes(button.label)),"A submitted review is read-only; it cannot offer Approve again");
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));
  if(jobStatus==="completed"){
    assert.deepEqual(current.result.structure,plan);assert.deepEqual(review.recoveredPlan,plan);
    assert.match(view.markup,/WINNER_PAID_PLAN_R8/u);
    if(state.request.canvasId)assert.deepEqual(f.host.adaptiveSuggestionSets.get()["doc-a"]?.find(item=>item.id===winnerId)?.structure,plan);
    else{assert.equal(f.host.knownPlanJob("doc-a"),winnerId);assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],plan);}
  }else{
    assert.equal(review.recoveredPlan,undefined);assert.equal(current.result?.structure,undefined);
    assert.doesNotMatch(view.markup,/WINNER_PAID_PLAN_R8/u);
  }
  assertSingleApprovalR8(state);return{review,view,current};
}
function assertWinnerReceiptR8(state,expectedQuote,jobStatus){
  const result=assertWinnerContinuityR8(state,jobStatus),{review,view}=result;
  assert.deepEqual(review.quote,expectedQuote,"Adopt the whole original winner disclosure, not only its execution ID");
  assert.deepEqual(review.request,state.request);
  assert.match(view.markup,/WINNER_PRIVATE_INPUT_R8/u);assert.match(view.markup,/winner-model-r8/u);assert.match(view.markup,/winner-source-r8/u);
  assert.match(view.markup,/context\.consent\.reservation/u);assert.match(view.markup,/context\.consent\.exactInput/u);assert.match(view.markup,/USD 0\.0080/u);
  assert.doesNotMatch(view.markup,/model-a|source-a/u);
  return result;
}
async function assertSubmittedFallbackR8(state){
  const {f,opened}=state,review=f.host.planningConsent.get();
  assert.ok(review);assert.equal(review.id,state.reviewId);assert.equal(review.working,false);assert.equal(review.submitted,true);
  assert.equal(review.recoveryExecutionId??review.quote?.executionId,opened.preview.executionId,"An invalid redirect cannot change the requested execution");
  assert.notEqual(review.quote?.executionId,state.winnerId);
  const view=render(f);
  assert.doesNotMatch(view.markup,/WINNER_PRIVATE_INPUT_R8|winner-model-r8|WINNER_PAID_PLAN_R8/u);
  assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview"].includes(button.label)));
  const retrieve=view.buttons.find(button=>["context.consent.reuse","planning.consent.retrieveExisting"].includes(button.label)&&!button.disabled);
  assert.ok(retrieve,"Uncertainty after submission must expose a free original lookup");
  retrieve.click();const lookup=await f.take();
  assert.equal(lookup.body.action,"retrieve","A's already-submitted quoted fallback must not send execute or an unbound resume");
  assert.equal(lookup.body.executionId,opened.preview.executionId);assert.equal(lookup.body.approvedBindingHash,opened.preview.bindingHash);
  lookup.gate.reject(new Error("Controlled free lookup transport interruption"));await turn();
  assertSingleApprovalR8(state);
}

// R9: a delayed A-to-B admission receipt cannot replace a newer terminal B.
// The released/held/settled shapes below are independently exercised through
// the real worker routes in assistant-runtime.test.mjs. Keep general feeds
// quote-free and continue using the existing serializer/Store/shell ports.
async function terminalWinnerSnapshotR9(state,status,budget){
  const {winnerId,request,pendingQuote,pendingJob}=state;
  const serialized=await adaptiveWorkerSerializationR7({
    executionId:winnerId,request,originalQuote:pendingQuote,originalPlan:undefined,
    body:{job:{...pendingJob,status,result:{planningReviewAvailable:true,planningStopBudget:budget,noAutomaticRetry:true}}},
  },{jobStatus:status});
  // safeResult omits live ledger metadata. Exercise the real no-output
  // certification branch which attaches it afterward; only DB read ports are
  // stubbed here, and the six routed tests verify their real returned values.
  const syntax=parse("../worker/document-jobs-api.ts");
  const declaration=name=>{const node=syntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node);return node.getText(syntax);};
  const consentedAdaptiveJob=()=>true,readAdaptivePlanningJobResult=async()=>null;
  const adaptiveStopBudget=async()=>budget,adaptivePlanningReviewAvailable=async()=>true;
  const certify=eval(stripTypeScriptTypes("(()=>{"+["parseResult","certifiedAdaptiveJob"].map(declaration).join("\n")+";return certifiedAdaptiveJob;})()"));
  const certified=await certify({}, {}, {status,result_json:JSON.stringify(serialized.scoped.result)},false,true);
  const terminal={...serialized.scoped,result:JSON.parse(certified.result_json)};
  assert.equal(terminal.status,status);assert.equal(Object.hasOwn(terminal.result,"quote"),false);
  assert.deepEqual(terminal.result.planningStopBudget,budget);
  return terminal;
}
const adaptiveTerminalBudgetsR9=[
  {reservationStatus:"released",billingStatus:"not-incurred"},
  {reservationStatus:"retained",billingStatus:"pending"},
  {reservationStatus:"settled",billingStatus:"settled"},
];
for(const canvasId of[null,"winner-board-r8"])for(const terminal of["canceled","failed"])for(const budget of adaptiveTerminalBudgetsR9){
  test("adaptive terminal winner R9: "+(canvasId?"Canvas":"Document")+" preserves "+terminal+" / "+budget.reservationStatus+" against an older pending redirect",{timeout:3000},async t=>{
    const state=await crossSessionWinnerFixtureR8(t,canvasId),{f,submitted,approving,winnerId}=state;
    await observeWinnerR8(state,state.pendingJob);
    const terminalJob=await terminalWinnerSnapshotR9(state,terminal,budget);
    await observeWinnerR8(state,terminalJob);
    assert.equal(f.host.documentJobs.get().find(job=>job.jobId===winnerId)?.status,terminal);
    await f.reply(submitted,state.pendingBody,202);await approving;
    const review=f.host.planningConsent.get(),current=f.host.documentJobs.get().find(job=>job.jobId===winnerId),view=render(f);
    assert.equal(current?.status,terminal,"An older successful identity handoff cannot turn a known stopped/failed winner back into running");
    assert.deepEqual(current.result.planningStopBudget,budget,"Keep the live terminal budget receipt, including a retained hold or settled charge");
    assert.equal(current.result.structure,undefined);
    assert.equal(review?.id,state.reviewId);assert.equal(review.working,false);assert.equal(review.submitted,true);
    assert.equal(review.recoveryExecutionId??review.quote?.executionId,winnerId);assert.equal(review.recoveredPlan,undefined);
    assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview"].includes(button.label)));
    const retrieve=view.buttons.find(button=>["context.consent.reuse","planning.consent.retrieveExisting"].includes(button.label)&&!button.disabled);
    assert.ok(retrieve,"Expose free original-winner receipt recovery, not a second approval");
    const retrieved=new Promise(resolve=>{const unsubscribe=f.host.subscribe(()=>{const current=f.host.planningConsent.get();if(current?.working===false&&current.quote?.executionId===winnerId){unsubscribe();resolve();}});});
    retrieve.click();const lookup=await f.take();
    assert.ok(["resume","retrieve"].includes(lookup.body.action));assert.equal(lookup.body.executionId,winnerId);
    if(lookup.body.action==="retrieve")assert.equal(lookup.body.approvedBindingHash,state.pendingQuote.bindingHash);
    const terminalQuote={...state.pendingQuote,status:budget.billingStatus==="pending"?"uncertain":"failed",canPrepareNew:false};
    await f.reply(lookup,{quote:terminalQuote,planningRequest:state.request,job:terminalJob,status:terminalQuote.status,error:"document_job_canceled"},409);await retrieved;
    assert.equal(f.host.documentJobs.get().find(job=>job.jobId===winnerId)?.status,terminal);
    assert.deepEqual(f.host.documentJobs.get().find(job=>job.jobId===winnerId)?.result.planningStopBudget,budget);
    assert.deepEqual(f.host.planningConsent.get().quote.privateInput,state.pendingQuote.privateInput);
    assert.equal(f.host.planningConsent.get().quote.maximumMicrousd,state.pendingQuote.maximumMicrousd);
    assertSingleApprovalR8(state);
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["quote","execute","GET","GET",lookup.body.action]);
  });
}

for(const canvasId of[null,"winner-board-r8"]){
  const surface=canvasId?"Canvas":"Document";
  for(const status of["reserved","submitting","uncertain","completed"])test("adaptive winner continuity R8: "+surface+" adopts the "+status+" cross-session winner discovered before its approval reply",{timeout:3000},async t=>{
    const state=await crossSessionWinnerFixtureR8(t,canvasId),{f,submitted,approving}=state;
    await observeWinnerR8(state,status==="completed"?state.completedJob:state.pendingJob);
    const expectedQuote=status==="completed"?state.completedQuote:{...state.pendingQuote,status};
    const body=status==="completed"?state.completedBody:{...state.pendingBody,quote:expectedQuote,status,error:"adaptive_execution_in_progress"};
    await f.reply(submitted,body,status==="completed"?200:status==="reserved"?202:409);await approving;
    assert.equal(await state.opened.decision,true,"The original authoring caller acknowledges reuse without waiting for the read-only review to close");
    const {view}=assertWinnerReceiptR8(state,expectedQuote,status==="completed"?"completed":"running");
    if(status==="completed")assert.ok(view.buttons.some(button=>button.label==="planning.consent.newPreview"&&!button.disabled));
    else assert.ok(view.buttons.some(button=>["context.consent.reuse","planning.consent.retrieveExisting"].includes(button.label)&&!button.disabled));
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["quote","execute","GET"]);
  });

  test("adaptive winner continuity R8: "+surface+" keeps B's newer completion and retrieves its full receipt after an older pending redirect",{timeout:3000},async t=>{
    const state=await crossSessionWinnerFixtureR8(t,canvasId),{f,submitted,approving,winnerId}=state;
    await observeWinnerR8(state,state.pendingJob);await observeWinnerR8(state,state.completedJob);
    await f.reply(submitted,state.pendingBody,202);await approving;
    const {view}=assertWinnerReceiptR8(state,state.pendingQuote,"completed");
    const retrieve=view.buttons.find(button=>["context.consent.reuse","planning.consent.retrieveExisting"].includes(button.label)&&!button.disabled);
    assert.ok(retrieve,"A retained completed plan with only a pending receipt must offer a same-review free receipt lookup");
    retrieve.click();const lookup=await f.take();
    assert.ok(["retrieve","resume"].includes(lookup.body.action));assert.equal(lookup.body.executionId,winnerId);
    if(lookup.body.action==="retrieve")assert.equal(lookup.body.approvedBindingHash,state.completedQuote.bindingHash);
    const {requestedExecutionId:_requested,reusedExecutionId:_reused,...body}=state.completedBody;
    await f.reply(lookup,body);await settleReplacementPreviewR13(f);
    const completed=assertWinnerReceiptR8(state,state.completedQuote,"completed");
    assert.ok(completed.view.buttons.some(button=>button.label==="planning.consent.newPreview"&&!button.disabled));
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["quote","execute","GET","GET",lookup.body.action]);
  });

  for(const field of["requestedExecutionId","reusedExecutionId"])test("adaptive winner continuity R8: "+surface+" rejects a wrong "+field+" while preserving the newer completed B",{timeout:3000},async t=>{
    const state=await crossSessionWinnerFixtureR8(t,canvasId),{f,submitted,approving,winnerId}=state;
    await observeWinnerR8(state,state.completedJob);
    await f.reply(submitted,{...state.completedBody,[field]:"wrong-execution-r8"});await approving;
    assert.equal(f.host.documentJobs.get().find(item=>item.jobId===winnerId)?.status,"completed");
    assert.deepEqual(f.host.documentJobs.get().find(item=>item.jobId===winnerId)?.result?.structure,state.plan);
    await assertSubmittedFallbackR8(state);
  });

  for(const observed of[false,true])for(const difference of[{documentId:"doc-b"},{requestKey:"wrong-request-key-r8"}])test("adaptive winner continuity R8: "+surface+" validates the "+(observed?"observed":"unobserved")+" redirected job "+Object.keys(difference)[0]+" before adopting any private receipt",{timeout:3000},async t=>{
    const state=await crossSessionWinnerFixtureR8(t,canvasId),{f,submitted,approving,winnerId}=state;
    if(observed)await observeWinnerR8(state,state.completedJob);
    await f.reply(submitted,{...state.completedBody,job:{...state.completedJob,...difference}});await approving;
    if(observed){assert.equal(f.host.documentJobs.get().find(item=>item.jobId===winnerId)?.status,"completed");assert.deepEqual(f.host.documentJobs.get().find(item=>item.jobId===winnerId)?.result?.structure,state.plan);}
    else assert.equal(f.host.documentJobs.get().find(item=>item.jobId===winnerId),undefined);
    await assertSubmittedFallbackR8(state);
  });

  test("adaptive winner continuity R8: "+surface+" cannot restore B's private completion withdrawn after A's approval began",{timeout:3000},async t=>{
    const state=await crossSessionWinnerFixtureR8(t,canvasId),{f,submitted,approving,winnerId}=state;
    await observeWinnerR8(state,state.completedJob);
    await observeWinnerR8(state,{...state.completedJob,result:{planningReviewAvailable:false,resultUnavailable:true}});
    await f.reply(submitted,state.completedBody);await approving;
    const review=f.host.planningConsent.get();assert.ok(review);assert.equal(review.id,state.reviewId);
    assert.equal(review.working,false);assert.equal(review.submitted,true);assert.equal(review.recoveredPlan,undefined);
    assert.notEqual(review.quote?.executionId,winnerId,"A withdrawn original disclosure cannot be revived by an older successful redirect");
    const identity=review.recoveryExecutionId??review.quote?.executionId;
    assert.ok([state.opened.preview.executionId,winnerId].includes(identity),"Preserve only an original content-free recovery identity");
    const view=render(f);assert.doesNotMatch(view.markup,/WINNER_PRIVATE_INPUT_R8|winner-model-r8|WINNER_PAID_PLAN_R8/u);
    assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview"].includes(button.label)));
    assert.ok(view.buttons.some(button=>["context.consent.reuse","planning.consent.retrieveExisting"].includes(button.label)&&!button.disabled));
    assert.equal(f.host.documentJobs.get().find(item=>item.jobId===winnerId)?.result?.structure,undefined);
    assert.equal(f.host.inspectionJob(winnerId)?.result?.structure,undefined);
    assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);
    assert.ok(!(f.host.adaptiveSuggestionSets.get()["doc-a"]??[]).some(item=>item.id===winnerId));
    assertSingleApprovalR8(state);
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["quote","execute","GET","GET"]);
  });
}


// Actual worker interleaving: retrieve captures B reserved/no result, B then
// completes and is independently certified, and its final private proposal is
// erased before ports.read. The legal response remains HTTP 202 with B's early
// reserved quote but a completed job marked unavailable. Negative evidence in
// that incoming job must win over an older cached completion.
for(const canvasId of[null,"winner-board-r8"]){
  test("adaptive incoming withdrawal R9: "+(canvasId?"Canvas":"Document")+" a valid redirect cannot prefer cached B over its incoming unavailable receipt",{timeout:3000},async t=>{
    const state=await crossSessionWinnerFixtureR8(t,canvasId),{f,submitted,approving,winnerId}=state;
    await observeWinnerR8(state,state.completedJob);
    assert.deepEqual(f.host.documentJobs.get().find(job=>job.jobId===winnerId)?.result?.structure,state.plan);
    const unavailable={...state.completedJob,result:{planningReviewAvailable:false,resultUnavailable:true}};
    await f.reply(submitted,{...state.pendingBody,job:unavailable,billingStatus:"pending",error:"adaptive_execution_in_progress"},202);
    await approving;
    const review=f.host.planningConsent.get(),view=render(f);
    assert.ok(review);assert.equal(review.id,state.reviewId);
    assert.equal(review.recoveryExecutionId,winnerId,"Keep the validated winner's content-free recovery identity");
    assert.equal(review.submitted,true);assert.equal(review.working,false);
    assert.equal(review.recoveredPlan,undefined,"Incoming unavailability cannot be overwritten by a cached completed plan");
    assert.equal(review.quote,null,"Do not repopulate the withdrawn private presentation while adopting its identity");
    assert.equal(f.host.documentJobs.get().find(job=>job.jobId===winnerId)?.result?.structure,undefined);
    assert.equal(f.host.documentJobs.get().find(job=>job.jobId===winnerId)?.result?.intent,undefined);
    assert.equal(f.host.inspectionJob(winnerId)?.result?.structure,undefined);
    assert.equal(f.host.pendingIntent(winnerId),undefined);
    assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);
    assert.ok(!(f.host.adaptiveSuggestionSets.get()["doc-a"]??[]).some(item=>item.id===winnerId));
    assert.doesNotMatch(view.markup,/WINNER_PRIVATE_INPUT_R8|winner-model-r8|WINNER_PAID_PLAN_R8/u);
    assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview"].includes(button.label)));
    const retrieve=view.buttons.find(button=>["context.consent.reuse","planning.consent.retrieveExisting"].includes(button.label)&&!button.disabled);
    assert.ok(retrieve,"Unavailability must leave free recovery, never a new purchase");
    assertSingleApprovalR8(state);
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["quote","execute","GET"]);
    retrieve.click();const lookup=await f.take();
    assert.ok(["resume","retrieve"].includes(lookup.body.action));assert.equal(lookup.body.executionId,winnerId);
    await f.reply(lookup,{error:"adaptive_result_unavailable",noAutomaticRetry:true},404);
    assert.equal(f.host.planningConsent.get().working,false);assert.equal(f.host.planningConsent.get().recoveredPlan,undefined);
    assertSingleApprovalR8(state);
  });
}

// A pending cross-session winner is not selected merely by appearing in the
// feed. Its withdrawal remains authoritative if a later supported page evicts
// its historical handle before requested-A/reused-B returns. The control differs
// only by that withdrawal; the entire page and its exact reads finish first.
async function withdrawalCapacityNeighborsR9(state,prefix,count){
  assert.ok(count<=adaptiveActivityCapacityR8());
  return Promise.all(Array.from({length:count},async(_,index)=>{
    const executionId=prefix+"-"+index;
    const request={...state.request,prompt:"Separate authorized pending intent "+executionId};
    request.requestKey=await adaptiveRequestKey(request);
    // Preserve the actual serialized approved-job envelope from the R8 fixture.
    return{...state.pendingJob,jobId:executionId,planningExecutionId:executionId,requestKey:request.requestKey,result:{planningReviewAvailable:true}};
  }));
}
async function settleWithdrawalCapacityReadsR9(f,pending,cursor,knownJobs){
  const known=new Map(knownJobs.map(job=>[job.jobId,job]));
  let settled=false;
  const completion=Promise.resolve(pending).finally(()=>{settled=true;});
  for(let iteration=0;iteration<80&&!settled;iteration++){
    while(cursor<f.calls.length){
      const call=await f.take();
      assert.equal(call,f.calls[cursor++],"Consume only this fixture's queued requests");
      assert.equal(call.init.method,"GET","Capacity recovery may inspect retained work, never purchase again");
      assert.equal(call.body,null);
      const match=/^\/api\/document-jobs\/([^/]+)\?inspection=1$/u.exec(call.url);
      assert.ok(match,"Every follow-up is an exact retained-job inspection");
      const job=known.get(decodeURIComponent(match[1]));
      assert.ok(job,"Only original authorized fixture identities may be inspected");
      await f.reply(call,{job});
    }
    if(!settled)await turn();
  }
  assert.equal(settled,true,"The ordinary page/read must fully settle before evaluating the delayed redirect");
  await completion;
}
for(const canvasId of[null,"winner-board-r8"])for(const withdrawn of[false,true]){
  test("adaptive withdrawal capacity R9: "+(canvasId?"Canvas":"Document")+" fully settled Activity page preserves "+(withdrawn?"the withdrawn winner barrier":"valid original winner reuse"),{timeout:8000},async t=>{
    const state=await crossSessionWinnerFixtureR8(t,canvasId),{f,winnerId}=state;
    const oldNeighbors=await withdrawalCapacityNeighborsR9(state,"previous-page-r9",29);
    const newNeighbors=await withdrawalCapacityNeighborsR9(state,"current-page-r9",adaptiveActivityCapacityR8());
    const initial=f.host.syncDocumentJobs(),initialList=await f.take();
    await f.reply(initialList,{jobs:[state.pendingJob,...oldNeighbors]});await initial;
    const outcomeJob=withdrawn?{...state.pendingJob,result:{planningReviewAvailable:false,resultUnavailable:true}}:state.pendingJob;
    const outcome=f.host.syncDocumentJobs(),outcomeList=await f.take();
    await f.reply(outcomeList,{jobs:[outcomeJob,...oldNeighbors]});await outcome;
    // This is the actual API-supported 120-row capacity, not a fictitious limit.
    const next=f.host.syncDocumentJobs(),nextList=await f.take(),cursor=f.calls.length;
    await f.reply(nextList,{jobs:newNeighbors});
    await settleWithdrawalCapacityReadsR9(f,next,cursor,[outcomeJob,...oldNeighbors,...newNeighbors]);
    assert.equal(f.host.documentJobs.get().length,adaptiveActivityCapacityR8());
    assert.equal(f.host.planningConsent.get().quote.executionId,state.opened.preview.executionId,"A's original approval is still in flight");
    // The old successful redirect now arrives after every newer page/inspection.
    const redirectCursor=f.calls.length;
    await f.reply(state.submitted,state.completedBody);
    await settleWithdrawalCapacityReadsR9(f,state.approving,redirectCursor,[outcomeJob,...oldNeighbors,...newNeighbors]);
    const review=f.host.planningConsent.get(),view=render(f);
    if(withdrawn){
      assert.equal(review.recoveredPlan,undefined,"Page churn cannot erase a post-start withdrawal barrier and revive the old completed reply");
      assert.notEqual(review.quote?.executionId,winnerId,"Do not republish B's withdrawn private quote");
      assert.equal(review.working,false);assert.equal(review.submitted,true);
      assert.ok([state.opened.preview.executionId,winnerId].includes(review.recoveryExecutionId??review.quote?.executionId),"Retain only a content-free original recovery identity");
      assert.doesNotMatch(view.markup,/WINNER_PRIVATE_INPUT_R8|WINNER_PAID_PLAN_R8|winner-model-r8/u);
      assert.equal(f.host.documentJobs.get().find(job=>job.jobId===winnerId)?.result?.structure,undefined);
      assert.equal(f.host.inspectionJob(winnerId)?.result?.structure,undefined);
      assert.ok(!(f.host.adaptiveSuggestionSets.get()["doc-a"]??[]).some(item=>item.id===winnerId));
      assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview"].includes(button.label)));
    }else{
      assertWinnerReceiptR8(state,state.completedQuote,"completed");
      assert.equal(await state.opened.decision,true);
    }
    assertSingleApprovalR8(state);
  });
}


// A completion from the general feed must not suppress a current exact read's
// explicit private-unavailability error. A newer deliberately recertified read
// is a different boundary and must remain authoritative.
for(const canvasId of[null,"original-board"]){
  const surface=canvasId?"Canvas":"Document";
  test("adaptive same-id withdrawal R9: "+surface+" explicit unavailable resume clears a newer background completion",{timeout:3000},async t=>{
    const state=await serializedPlanningCompletionFixtureR7(t,{canvasId,pendingReview:true}),{f,saved,unrelated,older,reading}=state;
    assert.equal(f.host.planningConsent.get().recoveredPlan.interpretation,saved.originalPlan.interpretation);
    await f.reply(older,{error:"adaptive_result_unavailable",noAutomaticRetry:true},404);await reading;
    assertInvalidatedPlanningReadR5(f,saved,unrelated);
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","resume","GET"]);
    assert.equal(f.calls.some(call=>call.body?.action==="quote"||call.body?.action==="execute"),false);
  });
  test("adaptive same-id withdrawal R9: "+surface+" older unavailable error cannot erase a newer deliberately recertified receipt",{timeout:3000},async t=>{
    const state=await serializedPlanningCompletionFixtureR7(t,{canvasId,pendingReview:true}),{f,saved,older,reading,serialized}=state;
    const newerReading=f.host.previewPlanningConsent(),newer=await f.take();
    assert.equal(newer.body.action,"resume");assert.equal(newer.body.executionId,saved.executionId);
    await f.reply(newer,{...saved.body,job:serialized.scoped});await newerReading;
    assert.equal(f.host.planningConsent.get().quote.status,"completed");
    assert.deepEqual(f.host.planningConsent.get().recoveredPlan,saved.originalPlan);
    const snapshot=()=>structuredClone({review:f.host.planningConsent.get(),jobs:f.host.documentJobs.get(),plans:f.host.adaptiveStructures.get(),suggestions:f.host.adaptiveSuggestionSets.get(),intent:f.host.pendingIntent(saved.executionId)});
    const before=snapshot();
    await f.reply(older,{error:"adaptive_result_unavailable",noAutomaticRetry:true},404);await reading;
    assert.deepEqual(snapshot(),before,"An older error must not overwrite the later exact authorized receipt");
    assert.match(render(f).markup,/Original paid interpretation — 原文\./u);assert.match(render(f).markup,/original-private-input/u);
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","resume","GET","resume"]);
    assert.equal(f.calls.some(call=>call.body?.action==="quote"||call.body?.action==="execute"),false);
  });
}

// R10: preserve the independently certified lifecycle/billing receipt, not
// merely a status rank. Both old and new rows remain failed. The existing real
// serializer/certifier fixture supplies the live planningStopBudget shape.
async function terminalInspectionFixtureR10(t,canvasId,{settled=true}={}){
  const context=await personalPlanningDetailFixtureR7(t,canvasId),{f,saved}=context;
  const base={winnerId:saved.executionId,request:saved.request,pendingQuote:saved.originalQuote,pendingJob:saved.originalJob};
  const oldBudget={reservationStatus:"retained",billingStatus:"pending"};
  const latestBudget=settled?{reservationStatus:"settled",billingStatus:"settled"}:oldBudget;
  const older=await terminalWinnerSnapshotR9(base,"failed",oldBudget);
  const latest=await terminalWinnerSnapshotR9(base,"failed",latestBudget);
  f.host.documentJobs.set([older]);
  assert.equal(older.status,"failed","The native Activity issue panel exposes Inspect request and receipt for this row");
  return{...context,older,latest,oldBudget,latestBudget};
}
async function readTerminalInspectionR10(f,job){
  const pending=f.host.loadDocumentJobDetail(job.jobId),call=await f.take();
  assert.equal(call.url,"/api/document-jobs/"+job.jobId+"?inspection=1");
  await f.reply(call,{job});return pending;
}
for(const canvasId of[null,"original-board"])for(const path of["detail","omitted-feed"])for(const settled of[false,true]){
  test("adaptive terminal inspection R10: "+(canvasId?"Canvas":"Document")+" "+path+" preserves "+(settled?"newer failed/settled billing":"unchanged failed/held billing"),{timeout:3000},async t=>{
    const {f,saved,older,latest,latestBudget}=await terminalInspectionFixtureR10(t,canvasId,{settled});
    let outcome;
    if(path==="detail"){
      const reading=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error})),oldRead=await f.take();
      const polling=f.host.syncDocumentJobs(),list=await f.take();
      await f.reply(list,{jobs:[latest]});await polling;
      assert.deepEqual(f.host.documentJobs.get()[0].result.planningStopBudget,latestBudget);
      await f.reply(oldRead,{job:older});outcome=await reading;
      assert.equal(f.host.documentJobs.get()[0].status,"failed");
      assert.deepEqual(f.host.documentJobs.get()[0].result.planningStopBudget,latestBudget,"An old exact detail cannot roll settled billing back to an unknown retained hold");
      if(f.host.inspectionJob(saved.executionId))assert.deepEqual(f.host.inspectionJob(saved.executionId).result.planningStopBudget,latestBudget);
      assert.equal(f.calls.length,2);
    }else{
      await readTerminalInspectionR10(f,older);
      // Start the native exact read while the failed Activity row is visible.
      const deliberate=f.host.loadDocumentJobDetail(saved.executionId),deliberateRead=await f.take();
      const polling=f.host.syncDocumentJobs(),list=await f.take();
      await f.reply(list,{jobs:[]});const omittedRead=await f.take();
      assert.equal(omittedRead.url,"/api/document-jobs/"+saved.executionId+"?inspection=1");
      await f.reply(deliberateRead,{job:latest});await deliberate;
      assert.deepEqual(f.host.inspectionJob(saved.executionId).result.planningStopBudget,latestBudget);
      await f.reply(omittedRead,{job:older});await polling;
      assert.deepEqual(f.host.documentJobs.get(),[],"An omitted inspection must not inject an unrelated page entry");
      assert.deepEqual(f.host.inspectionJob(saved.executionId)?.result.planningStopBudget,latestBudget,"An old omitted-page inspection cannot replace the newer exact financial receipt");
      assert.equal(f.calls.length,4);
    }
    if(outcome?.value)assert.deepEqual(outcome.value.result.planningStopBudget,latestBudget,"Do not return a receipt older than the current certified financial state");
    assert.ok(f.calls.every(call=>call.init.method==="GET"&&call.body===null),"All inspection and recovery remains free");
  });
}
for(const canvasId of[null,"original-board"]){
  const surface=canvasId?"Canvas":"Document";
  test("adaptive terminal inspection R10: "+surface+" still accepts a genuinely certified completed paid result after non-completed terminal progress",{timeout:3000},async t=>{
    const {f,saved,latest}=await terminalInspectionFixtureR10(t,canvasId);
    const completed=(await adaptiveWorkerSerializationR7(saved)).detail;
    const reading=f.host.loadDocumentJobDetail(saved.executionId),exact=await f.take();
    const polling=f.host.syncDocumentJobs(),list=await f.take();
    await f.reply(list,{jobs:[latest]});await polling;
    await f.reply(exact,{job:completed});
    assert.deepEqual(await reading,completed,"A later observed failure alone is not withdrawal of the actual paid completed result");
    assert.equal(f.host.documentJobs.get()[0].status,"completed");
    assert.deepEqual(f.host.inspectionJob(saved.executionId)?.result.structure,saved.originalPlan);
    assert.deepEqual(f.calls.map(call=>call.init.method),["GET","GET"]);
  });
  test("adaptive terminal inspection R10: "+surface+" exact private-unavailability still clears retained content after newer non-completed billing progress",{timeout:3000},async t=>{
    const {f,saved,unrelated}=await personalPlanningDetailFixtureR7(t,canvasId);
    const reviewing=f.host.reviewPlanningJob(saved.executionId),resume=await f.take();
    await f.reply(resume,saved.body);await reviewing;
    const base={winnerId:saved.executionId,request:saved.request,pendingQuote:saved.originalQuote,pendingJob:saved.originalJob};
    const held=await terminalWinnerSnapshotR9(base,"failed",{reservationStatus:"retained",billingStatus:"pending"});
    const settled=await terminalWinnerSnapshotR9(base,"failed",{reservationStatus:"settled",billingStatus:"settled"});
    const initial=f.host.syncDocumentJobs(),initialList=await f.take();await f.reply(initialList,{jobs:[held]});await initial;
    assert.deepEqual(f.host.planningConsent.get().recoveredPlan,saved.originalPlan);
    const reading=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error})),exact=await f.take();
    const polling=f.host.syncDocumentJobs(),list=await f.take();await f.reply(list,{jobs:[settled]});await polling;
    await f.reply(exact,{error:"adaptive_result_unavailable"},404);
    assert.equal((await reading).value,undefined);
    assertInvalidatedPlanningReadR5(f,saved,unrelated);
    assert.equal(f.calls.some(call=>call.body?.action==="quote"||call.body?.action==="execute"),false);
  });
  test("adaptive terminal inspection R10: "+surface+" aggregate completion cannot overwrite a newer exact billing receipt while sibling inspection waits",{timeout:3000},async t=>{
    const {f,saved,older,latest,oldBudget,latestBudget}=await terminalInspectionFixtureR10(t,canvasId);
    const siblingId="terminal-sibling-r10",siblingRequest={...saved.request,prompt:"Separate authorized sibling planning receipt"};
    siblingRequest.requestKey=await adaptiveRequestKey(siblingRequest);
    const sibling=await terminalWinnerSnapshotR9({winnerId:siblingId,request:siblingRequest,pendingQuote:{...saved.originalQuote,executionId:siblingId},pendingJob:{...older,jobId:siblingId,planningExecutionId:siblingId,requestKey:siblingRequest.requestKey}},"failed",oldBudget);
    f.host.documentJobs.set([older,sibling]);
    await readTerminalInspectionR10(f,older);await readTerminalInspectionR10(f,sibling);
    const deliberate=f.host.loadDocumentJobDetail(saved.executionId),deliberateRead=await f.take();
    const polling=f.host.syncDocumentJobs(),list=await f.take();await f.reply(list,{jobs:[]});
    const first=await f.take(),second=await f.take(),reads=new Map([first,second].map(call=>[decodeURIComponent(call.url.match(/\/api\/document-jobs\/([^/]+)\?inspection=1/u)[1]),call]));
    assert.equal(reads.size,2);assert.ok(reads.has(saved.executionId)&&reads.has(siblingId));
    await f.reply(reads.get(saved.executionId),{job:older});
    await f.reply(deliberateRead,{job:latest});await deliberate;
    assert.deepEqual(f.host.inspectionJob(saved.executionId).result.planningStopBudget,latestBudget);
    await f.reply(reads.get(siblingId),{job:sibling});await polling;
    assert.deepEqual(f.host.inspectionJob(saved.executionId).result.planningStopBudget,latestBudget);
    assert.deepEqual(f.host.documentJobs.get(),[]);
    assert.ok(f.calls.every(call=>call.init.method==="GET"&&call.body===null));
  });
}

// R11: denial status is usable before its body. Reuse actual Store handlers,
// worker serializers, and the existing renderer; native Response.json() supplies
// real empty/HTML parse failures, without any external request or provider.
function unreadableDenialResponseR11(status,bodyKind){
  return new Response(bodyKind==="empty"?"":"<!doctype html><title>Access denied</title>",{status,headers:{"content-type":"text/html"}});
}
function unreadableDenialSnapshotR11(f,saved){
  return structuredClone({review:f.host.planningConsent.get(),plans:f.host.adaptiveStructures.get(),suggestions:f.host.adaptiveSuggestionSets.get(),jobs:f.host.documentJobs.get(),detail:f.host.inspectionJob(saved.executionId),intent:f.host.pendingIntent(saved.executionId)});
}
async function unreadableDenialFixtureR11(t,canvasId,path){
  const pair=await personalPlanningDetailFixtureR7(t,canvasId),{f,saved}=pair;
  let reading;
  if(path==="retrieve"){
    const pending={...saved.originalJob,status:"running",completedAt:null,result:{planningReviewAvailable:true}};
    const pendingQuote={...saved.originalQuote,status:"reserved",canPrepareNew:false};
    f.host.documentJobs.set([pending]);
    const opening=f.host.reviewPlanningJob(saved.executionId),initial=await f.take();
    assert.equal(initial.body.action,"resume");
    await f.reply(initial,{quote:pendingQuote,planningRequest:saved.request,job:pending,status:"reserved"},202);await opening;
    assert.ok(render(f).buttons.some(button=>button.label==="context.consent.reuse"&&!button.disabled),"The real pending review exposes the bound Retrieve action");
    reading=f.host.approvePlanningConsent().then(value=>({value}),error=>({error}));
  }else{
    await showOriginalPlanningDetailR7(f,saved);
    if(path==="resume"){f.host.closePlanningConsent();reading=f.host.reviewPlanningJob(saved.executionId).then(value=>({value}),error=>({error}));}
    else reading=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error}));
  }
  const denied=await f.take();
  if(path==="detail"){assert.equal(denied.init.method,"GET");assert.equal(denied.url,"/api/document-jobs/"+saved.executionId+"?inspection=1");}
  else{assert.equal(denied.body.action,path);assert.equal(denied.body.executionId,saved.executionId);if(path==="retrieve")assert.equal(denied.body.approvedBindingHash,saved.originalQuote.bindingHash);}
  assert.equal(planningDetailHasPrivateBytesR7(f,saved),true);
  const serialized=await adaptiveWorkerSerializationR7(saved);
  return{...pair,path,reading,denied,serialized};
}
async function observeUnreadableDenialR11(pair,order){
  const {f,saved,serialized}=pair;
  if(order!=="current"){
    const polling=f.host.syncDocumentJobs(),list=await f.take();
    assert.equal(list.url,"/api/document-jobs");assert.equal(list.init.method,"GET");
    await f.reply(list,{jobs:[serialized.feed]});await polling;
  }
  if(order==="newer-deliberate"){
    const inspecting=f.host.loadDocumentJobDetail(saved.executionId),newer=await f.take();
    assert.equal(newer.url,"/api/document-jobs/"+saved.executionId+"?inspection=1");
    await f.reply(newer,{job:serialized.detail});
    assert.deepEqual((await inspecting).result.structure,saved.originalPlan);
  }
  return unreadableDenialSnapshotR11(f,saved);
}
function assertUnreadableDenialReadsOnlyR11(f,saved){
  for(const call of f.calls){
    if(call.init.method==="GET"){
      assert.ok(call.url==="/api/document-jobs"||call.url==="/api/document-jobs/"+saved.executionId+"?inspection=1");assert.equal(call.body,null);
    }else{
      assert.equal(call.url,"/api/document-jobs/adaptive");assert.ok(["resume","retrieve"].includes(call.body.action));assert.equal(call.body.executionId,saved.executionId);
      if(call.body.action==="retrieve")assert.equal(call.body.approvedBindingHash,saved.originalQuote.bindingHash);
    }
  }
  assert.deepEqual(f.host.events.get(),[]);
}
function assertUnreadableDenialClearedR11(pair){
  const {f,saved,unrelated}=pair,state=f.host.planningConsent.get(),view=render(f);
  assert.equal(planningDetailHasPrivateBytesR7(f,saved),false,"A current owned-read denial must clear private presentation even when its body cannot be decoded");
  assert.ok(state);assert.equal(state.recoveryExecutionId,saved.executionId);assert.equal(state.quote,null);assert.equal(state.recoveredPlan,undefined);assert.equal(state.replaceExecutionId,undefined);
  assert.equal(state.request.prompt,"");assert.equal(state.working,false);assert.equal(state.submitted,true);assert.equal(state.notice,"failed");
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.retrieveExisting"&&!button.disabled),"Keep exact free recovery available");
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));
  assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview","action.cancel"].includes(button.label)));
}
for(const canvasId of[null,"original-board"])for(const path of["detail","resume","retrieve"]){
  const surface=canvasId?"Canvas":"Document";
  // Fully cover the four status codes on detail; 403 exercises the equivalent
  // original resume/retrieve branch without multiplying identical route cases.
  for(const status of path==="detail"?[401,403,404,410]:[403])for(const bodyKind of["empty","unreadable"])for(const order of["current","incidental","newer-deliberate"]){
    test("adaptive unreadable denial R11: "+surface+" "+path+" "+status+" "+bodyKind+" after "+order,{timeout:5000},async t=>{
      const pair=await unreadableDenialFixtureR11(t,canvasId,path),{f,saved,denied,reading}=pair;
      const before=await observeUnreadableDenialR11(pair,order);
      denied.gate.resolve(unreadableDenialResponseR11(status,bodyKind));
      const outcome=await reading;
      assert.equal(outcome.value?.result?.structure,undefined);assert.equal(outcome.value?.result?.intent,undefined);assert.equal(outcome.value?.result?.quote,undefined);
      if(path==="detail")assert.ok(outcome.error,"An unavailable detail is never returned to its caller");
      if(order==="newer-deliberate"){
        assert.deepEqual(unreadableDenialSnapshotR11(f,saved),before,"An older denial cannot erase a genuinely newer deliberate certification");
        assert.equal(planningDetailHasPrivateBytesR7(f,saved),true);
        assert.deepEqual(f.host.planningConsent.get().recoveredPlan,saved.originalPlan);
      }else assertUnreadableDenialClearedR11(pair);
      assertUnreadableDenialReadsOnlyR11(f,saved);
    });
  }
}
for(const canvasId of[null,"original-board"])for(const status of[401,403,404,410])for(const bodyKind of["empty","unreadable"]){
  test("adaptive unreadable new-quote refusal R11: "+(canvasId?"Canvas":"Document")+" "+status+" "+bodyKind+" preserves its valid original paid view",{timeout:5000},async t=>{
    const {f,saved}=await displayedAdaptivePlan(t,{canvasId,reader:false}),before=unreadableDenialSnapshotR11(f,saved);
    const preparing=f.host.newPlanningPreview(),denied=await f.take();
    assert.equal(denied.body.action,"quote");assert.equal(denied.body.replaceExecutionId,saved.executionId);
    denied.gate.resolve(unreadableDenialResponseR11(status,bodyKind));await preparing;
    const state=f.host.planningConsent.get(),view=render(f);
    assert.deepEqual(state.quote,before.review.quote);assert.deepEqual(state.request,before.review.request);assert.deepEqual(state.recoveredPlan,saved.originalPlan);
    assert.deepEqual(f.host.adaptiveStructures.get(),before.plans);assert.deepEqual(f.host.adaptiveSuggestionSets.get(),before.suggestions);
    assert.deepEqual(f.host.documentJobs.get(),before.jobs);assert.equal(f.host.pendingIntent(saved.executionId),before.intent);
    assert.equal(state.recoveryExecutionId,saved.executionId);assert.equal(state.replaceExecutionId,undefined);assert.equal(state.working,false);assert.equal(state.submitted,true);assert.equal(state.notice,"failed");
    assert.match(view.markup,/Original paid interpretation|original-private-input/u);
    assert.ok(view.buttons.some(button=>button.label==="planning.consent.newPreview"&&!button.disabled));
    assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));
    assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","action.cancel"].includes(button.label)));
    assert.deepEqual(f.calls.map(call=>call.body?.action??call.init.method),["resume","quote"]);assert.equal(f.calls.some(call=>call.body?.action==="execute"),false);
  });
}

// R11: keep a newly certified, still-visible detail through an older omitted
// page's aggregate merge. Use the actual Canvas intent-card renderer and exact
// dismissal handler; formatting/icons/unrelated authoring actions are ports.
function liveCapacityCanvasR11(f,saved){
  const handlers=[],nothing=Symbol("nothing");
  const value=item=>Array.isArray(item)?item.map(value).join(""):typeof item==="function"?"__capacity_handler_"+(handlers.push(item)-1)+"__":item===nothing?"":String(item??"");
  const html=(parts,...values)=>parts.reduce((result,part,index)=>result+part+(index<values.length?value(values[index]):""),"");
  const icon=()=>"",blockTypeDefinition=type=>({label:type}),store=f.host;
  // Keep the actual disclosure scope and close guards alongside its renderer.
  // This card-only fixture does not mount Canvas or synthesize an active scope.
  const dockMembers=["#controlsScope","#currentControlsScope","#canEditCanvas","#closePopovers","#intentDock"]
    .map(name=>member(canvasSyntax,"CanvasApplication",name)).join("\n");
  const code='(class {store=store;i18n={system:source=>source,t:(key,fallback)=>fallback??key};#intent="";#intentSubmitting=false;#anchorDocumentId(){return saved.request.documentId;}#intentMatches(){return [];}#placeSource(){}#useSuggestion(){}#askIntent(){}render(){return this.#intentDock();}'+dockMembers+'})';
  const markup=new (eval(stripTypeScriptTypes(code)))().render(),cards=new Map();
  for(const match of markup.matchAll(/<article\b[^>]*data-suggestion-id=([^\s>]+)[^>]*>[\s\S]*?<\/article>/gu)){
    const handler=match[0].match(/<header>[\s\S]*?<button\b[^>]*@click=__capacity_handler_(\d+)__/u);
    assert.ok(handler,"The actual suggestion card has its exact dismissal control");
    cards.set(match[1],{markup:match[0],dismiss:handlers[Number(handler[1])]});
  }
  return{markup,cards};
}
async function liveDetailCapacityFixtureR11(t,{canvasId="original-board",neighbors=26,neighborDocumentId,neighborCanvasId}={}){
  const {f,saved,unrelated}=await personalPlanningDetailFixtureR7(t,canvasId);
  await showOriginalPlanningDetailR7(f,saved);f.host.closePlanningConsent();
  if(canvasId)f.host.canvasProjection.set({selectedCanvasId:canvasId});
  const original=await adaptiveWorkerSerializationR7(saved),others=[];
  for(let index=0;index<neighbors;index++){
    const id="live-capacity-neighbor-r11-"+index;
    const request={...saved.request,documentId:neighborDocumentId??saved.request.documentId,canvasId:neighborCanvasId??saved.request.canvasId,requestKey:"live-capacity-request-r11-"+index,prompt:"Unrelated retained intent "+index};
    const plan={...saved.originalPlan,interpretation:"Unrelated retained plan "+index};
    const quote={...saved.originalQuote,executionId:id,bindingHash:"live-capacity-binding-r11-"+index,documentId:request.documentId,canvasId:request.canvasId};
    const raw={...saved.body.job,jobId:id,planningExecutionId:id,documentId:request.documentId,canvasId:request.canvasId,requestKey:request.requestKey,result:{structure:plan,intent:request.prompt}};
    others.push((await adaptiveWorkerSerializationR7({executionId:id,request,originalQuote:quote,originalPlan:plan,body:{job:raw}})).scoped);
  }
  assert.ok(others.length+1<=adaptiveActivityCapacityR8(),"The entire case fits in one currently supported Activity page");
  let polling=f.host.syncDocumentJobs(),list=await f.take();
  assert.equal(list.init.method,"GET");await f.reply(list,{jobs:[original.scoped,...others]});await polling;
  const cursor=f.calls.length;polling=f.host.syncDocumentJobs();list=await f.take();
  assert.equal(list.init.method,"GET");await f.reply(list,{jobs:[]});
  // Only live references plus bounded history are inspected. Document's
  // selected original survives even when unrelated historical IDs are pruned.
  const count=f.calls.slice(cursor).filter(call=>call.url.endsWith("?inspection=1")).length,older=new Map();
  for(let index=0;index<count;index++){
    const call=await f.take();assert.equal(call.init.method,"GET");
    older.set(decodeURIComponent(call.url.split("/").at(-1).split("?")[0]),call);
  }
  assert.ok(older.has(saved.executionId));
  if(canvasId)assert.equal(older.size,others.length+1,"Every displayed Canvas suggestion is a live reference");
  const state={f,saved,unrelated,original,others,older,polling,settled:false};
  t.after(async()=>{await settleLiveCapacityR11(state);});
  const recovering=f.host.loadDocumentJobDetail(saved.executionId),fresh=await f.take();
  assert.equal(fresh.url,"/api/document-jobs/"+saved.executionId+"?inspection=1");
  await f.reply(fresh,{job:original.detail});
  assert.deepEqual((await recovering).result.structure,saved.originalPlan);
  assert.ok(f.host.inspectionJob(saved.executionId),"A newer deliberate exact read has certified this original detail");
  assertLiveCapacityR11(state);return state;
}
async function settleLiveCapacityR11(state){
  if(state.settled)return;
  const {f,saved,original,others,older}=state;
  await f.reply(older.get(saved.executionId),{job:original.detail});
  for(const job of others)if(older.has(job.jobId))await f.reply(older.get(job.jobId),{job});
  await state.polling;state.settled=true;
}
function assertLiveCapacityR11(state){
  const {f,saved,unrelated}=state;
  if(saved.request.canvasId){
    const card=liveCapacityCanvasR11(f,saved).cards.get(saved.executionId);
    assert.ok(card,"The just-recovered original must remain in the actual Canvas card renderer");
    assert.match(card.markup,/Original paid interpretation — 原文\./u);
  }else{
    assert.equal(f.host.knownPlanJob(saved.request.documentId),saved.executionId);
    assert.deepEqual(f.host.adaptiveStructures.get()[saved.request.documentId],saved.originalPlan);
  }
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
  assert.equal(f.host.planningConsent.get(),null,"A background merge must not reopen a closed review");
}
function assertCapacityReadsOnlyR11(state){
  const {f}=state;
  assert.deepEqual(f.calls.filter(call=>call.init.method!=="GET").map(call=>call.body.action),["resume"]);
  assert.ok(f.calls.every(call=>call.init.method==="GET"?call.body===null:call.body.action==="resume"));
  assert.deepEqual(f.host.events.get(),[]);
  assert.deepEqual(f.host.documentJobs.get(),[],"Exact recovery never fabricates a row in the omitted/paginated feed");
}
for(const [canvasId,neighbors]of[[null,26],["original-board",1],["original-board",25],["original-board",26]]){
  test("adaptive live detail capacity R11: "+(canvasId?"Canvas":"Document")+" preserves explicit recovery through "+neighbors+" neighboring results",{timeout:10000},async t=>{
    const state=await liveDetailCapacityFixtureR11(t,{canvasId,neighbors});
    await settleLiveCapacityR11(state);assertLiveCapacityR11(state);assertCapacityReadsOnlyR11(state);
    assert.ok(state.f.host.planningRecoveryEntries().some(item=>item.jobId===state.saved.executionId));
  });
}
test("adaptive live detail capacity R11: a later exact withdrawal still removes the live original before the older batch finishes",{timeout:10000},async t=>{
  const state=await liveDetailCapacityFixtureR11(t),{f,saved,original}=state;
  const withdrawing=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error})),request=await f.take();
  await f.reply(request,{job:{...original.detail,result:{planningReviewAvailable:false,resultUnavailable:true}}});
  const result=await withdrawing;assert.ok(result.error);assert.equal(result.value,undefined);
  assert.equal(liveCapacityCanvasR11(f,saved).cards.has(saved.executionId),false);
  await settleLiveCapacityR11(state);
  assert.equal(liveCapacityCanvasR11(f,saved).cards.has(saved.executionId),false,"Protecting live cache cannot resurrect an explicitly withdrawn card");
  assert.equal(f.host.inspectionJob(saved.executionId)?.result?.structure,undefined);
  assert.equal(f.host.pendingIntent(saved.executionId),undefined);
  assert.equal(f.host.planningConsent.get(),null);assertCapacityReadsOnlyR11(state);
});
test("adaptive live detail capacity R11: the actual dismissal control wins over the older aggregate",{timeout:10000},async t=>{
  const state=await liveDetailCapacityFixtureR11(t),{f,saved}=state;
  const card=liveCapacityCanvasR11(f,saved).cards.get(saved.executionId);assert.ok(card);
  card.dismiss();assert.equal(liveCapacityCanvasR11(f,saved).cards.has(saved.executionId),false);
  await settleLiveCapacityR11(state);
  assert.equal(liveCapacityCanvasR11(f,saved).cards.has(saved.executionId),false,"A retained private detail does not override the user's dismissal");
  assert.equal(f.host.planningConsent.get(),null);assertCapacityReadsOnlyR11(state);
});
for(const changed of["actor","permission"])test("adaptive live detail capacity R11: an older batch cannot republish into a changed "+changed+" scope",{timeout:10000},async t=>{
  const state=await liveDetailCapacityFixtureR11(t),{f,saved}=state,session=f.host.session.get();
  f.host.session.set(changed==="actor"?{...session,user:{...session.user,userId:"new-actor-r11"}}:{...session,permissionEpoch:"new-permission-r11"});
  // Model the already-adopted new scope's presentation port. This test checks
  // the old async readers, not the separate sign-in/bootstrap clearing path.
  const currentPlans={"doc-b":{interpretation:"CURRENT SCOPE PLAN R11"}};
  f.host.adaptiveStructures.set(currentPlans);f.host.adaptiveSuggestionSets.set({});f.host.notify();
  await settleLiveCapacityR11(state);
  assert.deepEqual(f.host.adaptiveStructures.get(),currentPlans);
  assert.deepEqual(f.host.adaptiveSuggestionSets.get(),{});
  assert.equal(liveCapacityCanvasR11(f,saved).cards.has(saved.executionId),false);
  assert.equal(f.host.planningConsent.get(),null);assertCapacityReadsOnlyR11(state);
});
test("adaptive live detail capacity R11: dismissed former-live details return to bounded history without resurrecting cards",{timeout:10000},async t=>{
  const state=await liveDetailCapacityFixtureR11(t),{f,saved,others}=state;
  await settleLiveCapacityR11(state);assertLiveCapacityR11(state);
  const cards=liveCapacityCanvasR11(f,saved).cards;
  assert.equal(cards.size,others.length+1);
  for(const card of cards.values())card.dismiss();
  assert.equal(liveCapacityCanvasR11(f,saved).cards.size,0);
  // A subsequent retained exact read is still free, but must not make all
  // unrelated historical private details permanently exempt from the cap.
  const last=others.at(-1),reading=f.host.loadDocumentJobDetail(last.jobId),request=await f.take();
  assert.equal(request.url,"/api/document-jobs/"+last.jobId+"?inspection=1");
  await f.reply(request,{job:last});await reading;
  const retained=[saved.executionId,...others.map(job=>job.jobId)].filter(id=>f.host.inspectionJob(id));
  assert.ok(retained.length<=24,"Only currently referenced details may exceed the 24-entry historical cache");
  assert.equal(liveCapacityCanvasR11(f,saved).cards.size,0,"An explicit inspection does not undo a dismissed suggestion");
  assertCapacityReadsOnlyR11(state);
});


// R13: an older denied A read must not turn a fresh B disclosure into an
// approvable empty-intent request. Reuse the actual Store/shell and the two
// server wire forms: complete R13 request, or legacy quote-only disclosure.
function replacementPlanningIdentityR13(body){
  return{projectId:body.projectId,documentId:body.documentId,canvasId:body.canvasId??null,
    prompt:body.prompt,locale:body.locale,sourceSurface:body.sourceSurface,
    projectScope:body.projectScope,requestKey:body.requestKey};
}
async function settleReplacementPreviewR13(f){
  if(!f.host.planningConsent.get()?.working)return;
  await new Promise(resolve=>{const unsubscribe=f.host.subscribe(()=>{
    if(!f.host.planningConsent.get()?.working){unsubscribe();resolve();}
  });});
}
function assertPredecessorPrivateGoneR13(f,saved,unrelated){
  assert.equal(f.host.pendingIntent(saved.executionId),undefined);
  assert.equal(f.host.inspectionJob(saved.executionId)?.result?.structure,undefined);
  assert.ok(!f.host.documentJobs.get().some(item=>item.jobId===saved.executionId&&item.result?.structure));
  assert.ok(!Object.values(f.host.adaptiveSuggestionSets.get()).flat().some(item=>item.id===saved.executionId));
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
  const review=f.host.planningConsent.get();
  assert.notEqual(review?.quote?.executionId,saved.executionId);
  assert.equal(review?.recoveredPlan,undefined);
  // The same user intent may legitimately appear in an independently certified
  // B request. A's old result, source disclosure and model are not that proof.
  assert.doesNotMatch(JSON.stringify({review,plans:f.host.adaptiveStructures.get(),
    suggestions:f.host.adaptiveSuggestionSets.get()}),
    /Original paid interpretation|original-private-input|original-paid-model/u);
}
for(const canvasId of[null,"original-board"])for(const intent of["same-intent","different-intent"])for(const wire of["complete-request","legacy-quote-only"]){
  test("adaptive replacement intent R13: "+(canvasId?"Canvas":"Document")+" "+intent+" "+wire+" after older A denial",{timeout:6000},async t=>{
    const {f,saved,unrelated}=await displayedAdaptivePlan(t,{canvasId,reader:false});
    const older=await missingAdaptiveRead(f,saved);
    let preparing,decision;
    if(intent==="same-intent")preparing=f.host.newPlanningPreview();
    else{
      f.host.closePlanningConsent();
      decision=f.host.structureAdaptive("Create a distinct launch checklist from this document — R13.",{
        documentId:saved.request.documentId,canvasId:canvasId??undefined,
        sourceSurface:saved.request.sourceSurface,projectScope:saved.request.projectScope,
        locale:saved.request.locale,
      });
    }
    const next=await f.take();
    assert.equal(next.body.action,"quote");
    assert.equal(next.body.replaceExecutionId,intent==="same-intent"?saved.executionId:undefined);
    const expected=replacementPlanningIdentityR13(next.body);
    assert.equal(expected.requestKey,await adaptiveRequestKey(expected));
    if(intent==="same-intent")assert.equal(expected.prompt,saved.request.prompt);
    else{assert.notEqual(expected.prompt,saved.request.prompt);assert.notEqual(expected.requestKey,saved.request.requestKey);}
    older.exact.gate.resolve(new Response("",{status:403}));await older.pending;
    assertPredecessorPrivateGoneR13(f,saved,unrelated);
    assert.equal(f.host.planningConsent.get().working,true,"The newer free preparation still owns its lifecycle");
    const preview=quote(expected,{executionId:"replacement-intent-r13",bindingHash:"b".repeat(64),
      models:["independently-prepared-model-r13"],sourceHash:"independently-prepared-source-r13",
      privateInput:{approved:"INDEPENDENT_B_DISCLOSURE_R13",scope:canvasId?"whole-project":"document",
        projectTitle:"Current project",documentTitle:"Current document",canvasTitle:canvasId?"Current board":null,
        blockCount:14,documentCount:1,requestKey:expected.requestKey}});
    await f.reply(next,{quote:preview,...(wire==="complete-request"?{planningRequest:expected}:{})});
    if(preparing)await preparing;else await settleReplacementPreviewR13(f);
    const state=f.host.planningConsent.get(),view=render(f);
    assertPredecessorPrivateGoneR13(f,saved,unrelated);
    assert.notEqual(state.notice,"uncertain","No approval has been submitted");
    assert.notEqual(state.quote?.status,"uncertain","A free disclosure is not an unknown purchase");
    const approve=view.buttons.find(button=>button.label==="planning.consent.approve"&&!button.disabled);
    if(intent==="same-intent"&&wire==="legacy-quote-only"){
      assert.equal(approve,undefined,"Without independent B intent proof, do not offer an empty-intent approval");
      assert.equal(state.quote,null);assert.equal(state.request.prompt,"");
      assert.equal(state.recoveryExecutionId,saved.executionId);assert.equal(state.working,false);
      assert.ok(view.buttons.some(button=>button.label==="planning.consent.retrieveExisting"&&!button.disabled));
      const calls=f.calls.length;await f.host.approvePlanningConsent();assert.equal(f.calls.length,calls);
      assert.equal(f.calls.some(call=>call.body?.action==="execute"),false);
    }else{
      assert.ok(approve,"A complete B contract or genuinely new user-authored intent remains usable");
      assert.equal(state.quote.executionId,preview.executionId);assert.equal(state.quote.status,"quoted");
      assert.deepEqual(state.request,expected);assert.equal(state.submitted,false);assert.equal(state.recoveryExecutionId,undefined);
      const approving=f.host.approvePlanningConsent(),attempt=await f.take(),captured=structuredClone(attempt.body);
      // Settle even a red-baseline request before asserting; no unresolved mock
      // execution or external provider work is left behind by a failed test.
      if(!captured.prompt?.trim())await f.reply(attempt,{error:"adaptive_intent_required",noAutomaticRetry:true},409);
      else{
        const pendingQuote={...preview,status:"reserved",canExecute:false};
        const pendingJob=job(expected,preview.executionId,{status:"queued",completedAt:null,
          planningExecutionId:preview.executionId,planningLocale:expected.locale,
          planningProjectScope:expected.projectScope,result:{planningReviewAvailable:true}});
        await f.reply(attempt,{quote:pendingQuote,planningRequest:expected,job:pendingJob,status:"reserved"},202);
      }
      await approving;
      assert.equal(captured.action,"execute");assert.equal(captured.executionId,preview.executionId);
      assert.equal(captured.approvedBindingHash,preview.bindingHash);
      assert.equal(captured.prompt,expected.prompt);assert.ok(captured.prompt.trim());
      assert.equal(captured.requestKey,await adaptiveRequestKey(captured));
      assert.equal(f.calls.filter(call=>call.body?.action==="execute").length,1);
      assertPredecessorPrivateGoneR13(f,saved,unrelated);
      assert.notEqual(f.host.planningConsent.get()?.notice,"uncertain");
    }
    f.host.closePlanningConsent();if(decision)await decision;
    assert.deepEqual(f.host.events.get(),[],"Suggestions never apply document or board decisions automatically");
    assert.equal(f.calls.filter(call=>call.body?.action==="quote").length,1,"Never repair this race with another quote");
  });
}

// R12: an exact result is one object's update, not a complete replacement for
// the currently paginated/scoped feed. Reuse the real Canvas card renderer,
// actual Store entry points, and the existing server serialization harness.
function exactRecoveryCardsR12(f,request){
  const previous=f.host.canvasProjection.get();
  try{
    // A synchronous presentation port renders the requested board/anchor.
    // It does not navigate, notify, mutate app data, or start another lookup.
    f.host.canvasProjection.set({...previous,selectedCanvasId:request.canvasId});
    return liveCapacityCanvasR11(f,{request}).cards;
  }finally{f.host.canvasProjection.set(previous);}
}
async function exactRecoveryPairR12(t,options={}){
  const state=await liveDetailCapacityFixtureR11(t,{neighbors:1,...options});
  await settleLiveCapacityR11(state);
  const other=state.others[0],otherRequest={...state.saved.request,documentId:other.documentId,canvasId:other.canvasId};
  assert.equal(state.f.host.documentJobs.get().length,0);
  assert.ok(exactRecoveryCardsR12(state.f,state.saved.request).has(state.saved.executionId));
  assert.ok(exactRecoveryCardsR12(state.f,otherRequest).has(other.jobId));
  return{...state,other,otherRequest};
}
async function resumeExactRecoveryR12(state,whileWaiting){
  const {f,saved,original}=state,reading=f.host.reviewPlanningJob(saved.executionId),request=await f.take();
  assert.equal(request.body.action,"resume");assert.equal(request.body.executionId,saved.executionId);
  try{await whileWaiting?.();}
  finally{await f.reply(request,{...saved.body,job:original.detail});assert.equal(await reading,true);}
  const review=f.host.planningConsent.get(),view=render(f);
  assert.equal(review.recoveryExecutionId,saved.executionId);assert.equal(review.working,false);
  assert.deepEqual(review.recoveredPlan,saved.originalPlan);assert.deepEqual(review.request,saved.request);
  assert.deepEqual(review.quote.privateInput,saved.originalQuote.privateInput);
  assert.deepEqual(review.quote.models,saved.originalQuote.models);
  assert.equal(review.quote.bindingHash,saved.originalQuote.bindingHash);
  assert.equal(review.quote.sourceHash,saved.originalQuote.sourceHash);
  assert.equal(review.quote.maximumMicrousd,saved.originalQuote.maximumMicrousd);
  assert.ok(!view.buttons.some(button=>button.label==="planning.consent.approve"));
}
function assertExactRecoverySiblingR12(state){
  const {f,saved,other,otherRequest}=state;
  assert.ok(exactRecoveryCardsR12(f,saved.request).has(saved.executionId));
  assert.ok(exactRecoveryCardsR12(f,otherRequest).has(other.jobId),"One completed receipt must not remove another still-authorized, exact-certified suggestion");
  assert.deepEqual(f.host.inspectionJob(other.jobId)?.result?.structure,other.result.structure);
  assert.ok(!f.host.documentJobs.get().some(job=>job.jobId===other.jobId),"Do not fabricate a paginated-feed row just to retain the unrelated card");
}
function assertExactRecoveryReadOnlyR12(state){
  assert.ok(state.f.calls.every(call=>call.init.method==="GET"||call.body?.action==="resume"));
  assert.equal(state.f.calls.some(call=>["quote","execute"].includes(call.body?.action)),false);
  assert.deepEqual(state.f.host.events.get(),[]);
}
for(const path of["direct-detail","resume","denial-then-resume"])test("adaptive exact recovery continuity R12: "+path+" keeps the other current Canvas card",{timeout:6000},async t=>{
  const state=await exactRecoveryPairR12(t),{f,saved,original}=state;
  if(path==="denial-then-resume"){
    const reading=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error})),denied=await f.take();
    denied.gate.resolve(unreadableDenialResponseR11(403,"unreadable"));assert.ok((await reading).error);
    assert.equal(exactRecoveryCardsR12(f,saved.request).has(saved.executionId),false);
    assert.ok(exactRecoveryCardsR12(f,state.otherRequest).has(state.other.jobId));
  }
  if(path==="direct-detail"){
    const reading=f.host.loadDocumentJobDetail(saved.executionId),request=await f.take();
    await f.reply(request,{job:original.detail});await reading;assert.equal(f.host.planningConsent.get(),null);
  }else await resumeExactRecoveryR12(state);
  assertExactRecoverySiblingR12(state);assertExactRecoveryReadOnlyR12(state);
});
for(const [label,options]of[
  ["other-board",{neighborCanvasId:"other-board-r12"}],
  ["other-document",{neighborDocumentId:"doc-b",neighborCanvasId:"other-document-board-r12"}],
])test("adaptive exact recovery continuity R12: reopening A preserves the distinct "+label+" live result",{timeout:6000},async t=>{
  const state=await exactRecoveryPairR12(t,options);
  assert.notEqual(state.other.canvasId,state.saved.request.canvasId);
  if(label==="other-document")assert.notEqual(state.other.documentId,state.saved.request.documentId);
  await resumeExactRecoveryR12(state);
  assertExactRecoverySiblingR12(state);assertExactRecoveryReadOnlyR12(state);
});
for(const outcome of["withdrawal","dismissal"])test("adaptive exact recovery continuity R12: a sibling's newer "+outcome+" still wins while A resumes",{timeout:6000},async t=>{
  const state=await exactRecoveryPairR12(t),{f,other,otherRequest}=state;
  await resumeExactRecoveryR12(state,async()=>{
    if(outcome==="withdrawal"){
      const reading=f.host.loadDocumentJobDetail(other.jobId).then(value=>({value}),error=>({error})),request=await f.take();
      await f.reply(request,{job:{...other,result:{planningReviewAvailable:false,resultUnavailable:true}}});
      assert.ok((await reading).error);
    }else{
      const card=exactRecoveryCardsR12(f,otherRequest).get(other.jobId);assert.ok(card);card.dismiss();
    }
    assert.equal(exactRecoveryCardsR12(f,otherRequest).has(other.jobId),false);
  });
  assert.equal(exactRecoveryCardsR12(f,otherRequest).has(other.jobId),false,"Target-local publication cannot resurrect an unrelated withdrawn or dismissed result");
  if(outcome==="withdrawal")assert.equal(f.host.inspectionJob(other.jobId)?.result?.structure,undefined);
  assertExactRecoveryReadOnlyR12(state);
});

async function redirectedSiblingFixtureR12(t){
  const state=await crossSessionWinnerFixtureR8(t,"winner-board-r8"),{f}=state;
  f.host.canvasProjection.set({selectedCanvasId:state.request.canvasId});
  const id="unrelated-redirect-sibling-r12";
  const request={...state.request,requestKey:"unrelated-redirect-request-r12",prompt:"Keep this separately approved earlier plan."};
  const plan={...state.plan,interpretation:"UNRELATED_REDIRECT_PLAN_R12"};
  const quote={...state.completedQuote,executionId:id,bindingHash:"unrelated-redirect-binding-r12"};
  const raw={...state.completedJob,jobId:id,planningExecutionId:id,requestKey:request.requestKey,result:{structure:plan,intent:request.prompt}};
  const other=(await adaptiveWorkerSerializationR7({executionId:id,request,originalQuote:quote,originalPlan:plan,body:{job:raw}})).scoped;
  let polling=f.host.syncDocumentJobs(),list=await f.take();
  await f.reply(list,{jobs:[state.pendingJob,other]});await polling;
  polling=f.host.syncDocumentJobs();list=await f.take();await f.reply(list,{jobs:[]});
  const reads=new Map();
  for(let index=0;index<2;index++){
    const call=await f.take();assert.equal(call.init.method,"GET");
    reads.set(decodeURIComponent(call.url.split("/").at(-1).split("?")[0]),call);
  }
  assert.ok(reads.has(state.winnerId));assert.ok(reads.has(other.jobId));
  await f.reply(reads.get(state.winnerId),{job:state.pendingJob});
  await f.reply(reads.get(other.jobId),{job:other});await polling;
  assert.deepEqual(f.host.documentJobs.get(),[]);
  assert.ok(exactRecoveryCardsR12(f,request).has(other.jobId));
  return{...state,other,otherRequest:request};
}
for(const status of["reserved","completed"])test("adaptive exact recovery continuity R12: "+status+" A-to-B winner handoff keeps the unrelated certified C",{timeout:6000},async t=>{
  const state=await redirectedSiblingFixtureR12(t),{f,submitted,approving,other,otherRequest}=state;
  const completed=status==="completed";
  await f.reply(submitted,completed?state.completedBody:state.pendingBody,completed?200:202);await approving;
  assert.equal(await state.opened.decision,true);
  assertWinnerReceiptR8(state,completed?state.completedQuote:state.pendingQuote,completed?"completed":"running");
  const cards=exactRecoveryCardsR12(f,otherRequest);
  assert.ok(cards.has(other.jobId),"Reusing another session's exact winner must not remove a separately retained paid plan");
  assert.equal(cards.has(state.winnerId),completed);
  assert.deepEqual(f.host.inspectionJob(other.jobId)?.result?.structure,other.result.structure);
  assert.ok(!f.host.documentJobs.get().some(job=>job.jobId===other.jobId));
  assertSingleApprovalR8(state);
});
// R12 baseline: eight pending-proof failures and eight completed-proof controls
// verified against immutable R11 Store SHA-256
// 6bb0d0a1d513cf3b8324f1860e464557f823cfe00b219b2c0883a23859e1f505.

const pendingReadPairsR12=[
  {older:"detail",newer:"resume"},
  {older:"omitted",newer:"detail"},
  {older:"resume",newer:"resume"},
  {older:"retrieve",newer:"detail"},
];
async function pendingReadWithdrawalFixtureR12(t,canvasId,pair){
  if(pair.older==="resume"||pair.older==="retrieve"){
    const state=await unreadableDenialFixtureR11(t,canvasId,pair.older);
    await observeUnreadableDenialR11(state,"incidental");
    return{...state,pair};
  }
  const state=await personalPlanningDetailFixtureR7(t,canvasId),{f,saved}=state;
  const serialized=await adaptiveWorkerSerializationR7(saved);
  let denied,reading;
  if(pair.older==="detail"){
    // Start from the failed Activity row where native Inspect is available,
    // before the incidental completed response exposes any private plan.
    reading=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error}));
    denied=await f.take();
    const polling=f.host.syncDocumentJobs(),list=await f.take();
    await f.reply(list,{jobs:[serialized.feed]});await polling;
  }else{
    await showOriginalPlanningDetailR7(f,saved);f.host.closePlanningConsent();
    // The positive request predates the omitted lookup. Its later response is
    // incidental completion, not the new deliberate request under test.
    const earlier=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error})),positive=await f.take();
    const omitted=await missingAdaptiveRead(f,saved);
    denied=omitted.exact;reading=omitted.pending.then(value=>({value}),error=>({error}));
    await f.reply(positive,{job:serialized.detail});assert.deepEqual((await earlier).value?.result?.structure,saved.originalPlan);
  }
  assert.equal(planningDetailHasPrivateBytesR7(f,saved),true);
  return{...state,serialized,denied,reading,pair};
}
async function startNewerPendingReadR12(state){
  const {f,saved,pair}=state;
  const raw=pair.newer==="detail"?f.host.loadDocumentJobDetail(saved.executionId):
    f.host.planningConsent.get()?f.host.previewPlanningConsent():f.host.reviewPlanningJob(saved.executionId);
  let finished=false;
  const reading=Promise.resolve(raw).then(value=>({value}),error=>({error})).finally(()=>{finished=true;});
  const request=await f.take();
  if(pair.newer==="resume"){
    assert.equal(request.body.action,"resume");assert.equal(request.body.executionId,saved.executionId);
    assert.equal(f.host.planningConsent.get().working,true);
  }else assert.equal(request.url,"/api/document-jobs/"+saved.executionId+"?inspection=1");
  const review=f.host.planningConsent.get();
  return{reading,request,finished:()=>finished,reviewId:review?.id,requestKey:review?.request.requestKey};
}
async function finishNewerPendingReadR12(state,newer){
  const {f,saved,serialized,pair}=state;
  await f.reply(newer.request,pair.newer==="detail"?{job:serialized.detail}:{...saved.body,job:serialized.detail});
  const outcome=await newer.reading;
  assert.equal(outcome.error,undefined,"The denial must not cancel or invalidate the newer original-ID read");
  if(pair.newer==="detail")assert.deepEqual(outcome.value?.result?.structure,saved.originalPlan);
  else{
    const review=f.host.planningConsent.get();
    assert.equal(review?.id,newer.reviewId);assert.equal(review.recoveryExecutionId,saved.executionId);
    assert.equal(review.working,false);assert.deepEqual(review.recoveredPlan,saved.originalPlan);
    assert.equal(review.quote?.executionId,saved.executionId);
  }
  assert.equal(planningDetailHasPrivateBytesR7(f,saved),true,"A successfully verified newer read may restore the original retained result");
  if(saved.request.canvasId)assert.deepEqual(f.host.adaptiveSuggestionSets.get()["doc-a"]?.find(item=>item.id===saved.executionId)?.structure,saved.originalPlan);
  else assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],saved.originalPlan);
}
for(const canvasId of[null,"original-board"])for(const pair of pendingReadPairsR12)for(const newerCompleted of[false,true]){
  test("adaptive pending-read withdrawal R12: "+(canvasId?"Canvas":"Document")+" older "+pair.older+" denial versus newer "+pair.newer+" "+(newerCompleted?"verified proof":"pending read"),{timeout:5000},async t=>{
    const state=await pendingReadWithdrawalFixtureR12(t,canvasId,pair),{f,saved,denied,reading}=state;
    const newer=await startNewerPendingReadR12(state);
    if(newerCompleted)await finishNewerPendingReadR12(state,newer);
    const before=unreadableDenialSnapshotR11(f,saved);
    let bodyReads=0;
    denied.gate.resolve({ok:false,status:403,json:async()=>{bodyReads++;throw new SyntaxError("Access denial body is deliberately unreadable");}});
    await reading;
    const privateStillVisible=planningDetailHasPrivateBytesR7(f,saved),during=structuredClone(f.host.planningConsent.get());
    assert.equal(bodyReads,0,"Known exact HTTP denial is evidence before JSON decoding");
    if(newerCompleted){
      assert.equal(privateStillVisible,true);
      assert.deepEqual(unreadableDenialSnapshotR11(f,saved),before,"Genuinely newer completed proof still fences the older denial");
    }else{
      const stillInFlight=!newer.finished();
      // Finish cleanup and independently test restoration before reporting the
      // frozen-R11 red assertion; no unresolved mock requests are left behind.
      await finishNewerPendingReadR12(state,newer);
      assert.equal(privateStillVisible,false,"Starting a newer lookup is not successful recertification: hide old private presentation after the known denial");
      assert.equal(stillInFlight,true,"Keep the newer exact lookup alive, not canceled or replaced");
      if(pair.newer==="resume"){
        assert.equal(during?.id,newer.reviewId);assert.equal(during.recoveryExecutionId,saved.executionId);
        assert.equal(during.request.requestKey,newer.requestKey);assert.equal(during.submitted,true);
        assert.equal(during.working,true,"The old response cannot take ownership of the newer read's busy lifecycle");
      }
    }
    assertUnreadableDenialReadsOnlyR11(f,saved);
    assert.equal(f.calls.some(call=>call.body?.action==="quote"||call.body?.action==="execute"),false,"Never repair a denied read by quoting or purchasing again");
  });
}
// R12 add-on baseline: four real Retrieve resurrection failures before the
// withdrawn-during-read fallback guard; four resume/detail controls passed.
// Pre-guard Store SHA-256: 62734516af9eead881d21e14efc7f7169920fcf99e51a2e7c7b86b2633b62966.

const pendingFailureCasesR12=[
  {canvasId:null,older:"detail",newer:"resume",failure:"transport"},
  {canvasId:"original-board",older:"detail",newer:"resume",failure:"non-JSON"},
  {canvasId:null,older:"omitted",newer:"detail",failure:"non-OK"},
  {canvasId:"original-board",older:"omitted",newer:"detail",failure:"missing-result"},
  {canvasId:null,older:"retrieve",newer:"retrieve",failure:"transport"},
  {canvasId:"original-board",older:"retrieve",newer:"retrieve",failure:"non-JSON"},
  {canvasId:null,older:"retrieve",newer:"retrieve",failure:"non-OK"},
  {canvasId:"original-board",older:"retrieve",newer:"retrieve",failure:"missing-quote"},
];
async function startPendingFailureReadR12(state){
  if(state.pair.newer!=="retrieve")return startNewerPendingReadR12(state);
  const {f,saved}=state,view=render(f);
  assert.ok(view.buttons.some(button=>button.label==="context.consent.reuse"&&!button.disabled),"Use the actual bound Retrieve entry, not a fabricated action");
  const reading=f.host.approvePlanningConsent().then(value=>({value}),error=>({error})),request=await f.take();
  assert.equal(request.body.action,"retrieve");assert.equal(request.body.executionId,saved.executionId);
  assert.equal(request.body.approvedBindingHash,saved.originalQuote.bindingHash);
  assert.equal(f.host.planningConsent.get().working,true);
  return{reading,request,reviewId:f.host.planningConsent.get().id};
}
async function failPendingReadR12(state,newer,failure){
  const {f,serialized}=state;
  if(failure==="transport")newer.request.gate.reject(new Error("Controlled original-read transport interruption"));
  else if(failure==="non-JSON")newer.request.gate.resolve({ok:true,status:200,json:async()=>{throw new SyntaxError("Controlled unreadable newer response");}});
  else if(failure==="non-OK")await f.reply(newer.request,{error:"fixture_original_read_unavailable"},502);
  else if(failure==="missing-quote")await f.reply(newer.request,{job:serialized.detail,status:"completed"});
  else await f.reply(newer.request,{});
  return newer.reading;
}
for(const specimen of pendingFailureCasesR12){
  test("adaptive pending-read failure R12: "+(specimen.canvasId?"Canvas":"Document")+" newer "+specimen.newer+" "+specimen.failure+" cannot revive withdrawn private state",{timeout:5000},async t=>{
    const state=await pendingReadWithdrawalFixtureR12(t,specimen.canvasId,specimen),{f,saved,denied,reading}=state;
    const newer=await startPendingFailureReadR12(state);
    denied.gate.resolve({ok:false,status:403,json:async()=>{throw new Error("The known older denial body must not be needed");}});
    await reading;
    assert.equal(planningDetailHasPrivateBytesR7(f,saved),false,"The preceding R12 repair must first hide the denied private state");
    if(specimen.newer!=="detail")assert.equal(f.host.planningConsent.get().working,true,"The original newer read still owns its lifecycle");
    await failPendingReadR12(state,newer,specimen.failure);
    const leaked=planningDetailHasPrivateBytesR7(f,saved),failedState=structuredClone(f.host.planningConsent.get());
    const failedMarkup=f.host.planningConsent.get()?render(f).markup:"";
    // Keep cleanup bounded and prove the next public action is a free lookup
    // of the same original identity, not a fresh quote or an approval.
    const retrying=f.host.planningConsent.get()?f.host.previewPlanningConsent():f.host.reviewPlanningJob(saved.executionId);
    const retry=await f.take();
    assert.equal(retry.body.action,"resume");assert.equal(retry.body.executionId,saved.executionId);
    assert.equal(Object.hasOwn(retry.body,"approvedBindingHash"),false);
    await f.reply(retry,{error:"adaptive_read_scope_denied"},403);await retrying;
    assert.equal(leaked,false,"A failed newer read cannot re-expose its captured pre-withdrawal quote, source, or intent");
    if(failedState){assert.equal(failedState.quote,null);assert.equal(failedState.recoveredPlan,undefined);assert.equal(failedState.working,false);assert.equal(failedState.recoveryExecutionId,saved.executionId);}
    assert.doesNotMatch(failedMarkup,/original-private-input|original-paid-model|Original paid interpretation|Preserve the original paid intent/u);
    assert.equal(planningDetailHasPrivateBytesR7(f,saved),false);
    assertUnreadableDenialReadsOnlyR11(f,saved);
    assert.equal(f.calls.some(call=>call.body?.action==="quote"||call.body?.action==="execute"),false);
  });
}

// R13: a free quote can return a fully verified, already-paid receipt. Its
// current access proof is distinct from permission to submit a new purchase.
// Drive the actual Store/shell and the actual worker's prior-paid wire branch;
// authority/database reads below are deterministic, in-memory ports only.
async function paidReuseWorkerBodyR13(saved,status){
  const syntax=parse("../worker/adaptive-planning.ts");
  const functionText=name=>{
    const node=syntax.statements.find(candidate=>ts.isFunctionDeclaration(candidate)&&candidate.name?.text===name);
    assert.ok(node,"Actual adaptive worker function exists: "+name);
    return node.getText(syntax).replace(/^export\s+/u,"");
  };
  const {adaptiveRequestLocale}=await import("../src/model/adaptive-request.ts");
  const record=value=>value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  const fail=code=>{throw new Error(code);},response=(body,httpStatus=200)=>Response.json(body,{status:httpStatus});
  const errorCode=error=>{throw error;},errorStatus=()=>500;
  const binding={projectId:saved.request.projectId,documentId:saved.request.documentId,canvasId:saved.request.canvasId};
  const authority={principal:{userId:"actor-a"},binding};
  const prepareDocumentAuthority=async(_request,_env,body,mode)=>{
    assert.equal(mode,"read");assert.equal(body.action,"quote");return authority;
  };
  const retained={binding,request:saved.request,preview:saved.originalQuote};
  const current={row:{execution_id:saved.executionId,status},billingStatus:status==="completed"?"settled":"held",result:status==="completed"?{
    executionId:saved.executionId,bindingHash:saved.originalQuote.bindingHash,sourceHash:saved.originalQuote.sourceHash,
    requestKey:saved.request.requestKey,structure:saved.originalPlan,intent:saved.request.prompt,noAutomaticRetry:true,
  }:null};
  const priorPlanningRequest=async(_env,actualAuthority,settings)=>{
    assert.equal(actualAuthority,authority);
    assert.equal(await adaptiveRequestKey({...actualAuthority.binding,...settings}),saved.request.requestKey);
    return{retained,current};
  };
  const canPrepareNewPlanning=()=>true;
  const preparedAdaptivePlanning=async()=>assert.fail("Paid reuse must stop at the existing verified receipt; do not prepare a purchase");
  const route=eval(stripTypeScriptTypes("(()=>{"+["settingsFor","originalPlanningRequest","handleAdaptivePlanning"].map(functionText).join("\n")+";return handleAdaptivePlanning;})()"));
  const result=await route(new Request("https://forma.invalid/api/document-jobs/adaptive",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...saved.request,action:"quote"})}),{},{});
  assert.equal(result.status,200);
  const body=await result.json();
  assert.equal(body.reused,true);assert.equal(body.executionId,saved.executionId);
  assert.equal(body.quote.status,status);assert.equal(body.quote.canExecute,false);
  assert.deepEqual(body.planningRequest,saved.request);
  assert.equal(Object.hasOwn(body,"job"),false,"The real prior-paid quote path has no job envelope");
  if(status==="uncertain"){
    assert.equal(Object.hasOwn(body,"bindingHash"),false);assert.equal(Object.hasOwn(body,"requestKey"),false);
    assert.equal(Object.hasOwn(body,"structure"),false,"An uncertain execution is not a fabricated completed plan");
  }
  return body;
}
async function paidReuseFixtureR13(t,canvasId,status="completed"){
  const f=fixture(t,"en",{polling:true}),saved=await retainedActivity(f,{reader:false,canvasId});
  if(canvasId){const session=f.host.session.get();f.host.session.set({...session,projectContext:{...session.projectContext,permissions:[...session.projectContext.permissions,"project.canvas.use"]}});}
  const unrelated={interpretation:"Unrelated document plan must remain"};
  f.host.adaptiveStructures.set({"doc-b":unrelated});
  saved.originalQuote={...saved.originalQuote,status,canPrepareNew:status==="completed",privateInput:{...saved.originalQuote.privateInput,requestKey:saved.request.requestKey,sourceHash:saved.originalQuote.sourceHash}};
  const retainedJob={...saved.originalJob,status:status==="completed"?"completed":"running",result:status==="completed"?{intent:saved.request.prompt,structure:saved.originalPlan,planningReviewAvailable:true}:{planningReviewAvailable:true}};
  f.host.documentJobs.set([retainedJob]);
  saved.body={quote:saved.originalQuote,planningRequest:saved.request,job:retainedJob,status,
    executionId:saved.executionId,bindingHash:saved.originalQuote.bindingHash,requestKey:saved.request.requestKey,
    ...(status==="uncertain"?{error:"adaptive_execution_in_progress",billingStatus:"held",noAutomaticRetry:true}:{})};
  const opening=f.host.reviewPlanningJob(saved.executionId),resume=await f.take();
  assert.equal(resume.body.action,"resume");await f.reply(resume,saved.body,status==="uncertain"?409:200);await opening;
  assert.equal(f.host.planningConsent.get().quote?.status,status);assert.match(render(f).markup,/original-private-input/u);
  return{f,saved,unrelated};
}
async function beginPaidReuseQuoteR13(t,canvasId,status="completed",{fresh=false}={}){
  const state=await paidReuseFixtureR13(t,canvasId,status),{f,saved}=state;
  const reading=f.host.loadDocumentJobDetail(saved.executionId).then(value=>({value}),error=>({error})),denied=await f.take();
  assert.equal(denied.url,"/api/document-jobs/"+saved.executionId+"?inspection=1");
  f.host.closePlanningConsent();
  f.host.projection.set({...f.host.projection.get(),documentId:saved.request.documentId});
  f.host.route.set(canvasId?"/canvas":"/document/doc-a/alpha");
  if(canvasId)f.host.canvasProjection.set({...f.host.canvasProjection.get(),selectedCanvasId:canvasId});
  const prompt=fresh?"Prepare a distinct, not-yet-purchased brief.":saved.request.prompt;
  const decision=f.host.structureAdaptive(prompt,{documentId:saved.request.documentId,canvasId:canvasId??undefined,sourceSurface:saved.request.sourceSurface,projectScope:saved.request.projectScope,locale:saved.request.locale});
  const quoting=await f.take();
  assert.equal(quoting.body.action,"quote");assert.equal(Object.hasOwn(quoting.body,"executionId"),false);
  assert.equal(Object.hasOwn(quoting.body,"replaceExecutionId"),false);assert.equal(Object.hasOwn(quoting.body,"approvedBindingHash"),false);
  if(fresh)assert.notEqual(quoting.body.requestKey,saved.request.requestKey);else assert.equal(quoting.body.requestKey,saved.request.requestKey);
  return{...state,reading,denied,decision,quoting};
}
async function finishPaidQuoteReplyR13(state,body,status=200){
  const {f,quoting}=state,reviewId=f.host.planningConsent.get()?.id,finished=deferred();
  const stop=f.host.subscribe(()=>{
    const current=f.host.planningConsent.get();
    if(current?.id!==reviewId||!current.working)finished.resolve();
  });
  try{await f.reply(quoting,body,status);await finished.promise;}finally{stop();}
}
function paidPresentationR13(f,saved){
  const review=f.host.planningConsent.get(),quote=review?.quote?.executionId===saved.executionId?review.quote:null;
  // The newly typed composer draft is not the old paid private receipt.
  return JSON.stringify({
    detail:f.host.inspectionJob(saved.executionId),job:f.host.documentJobs.get().find(item=>item.jobId===saved.executionId),
    plan:f.host.adaptiveStructures.get()[saved.request.documentId],
    suggestions:(f.host.adaptiveSuggestionSets.get()[saved.request.documentId]??[]).filter(item=>item.id===saved.executionId),
    intent:f.host.pendingIntent(saved.executionId),quote,
    recoveredPlan:review?.recoveryExecutionId===saved.executionId?review.recoveredPlan:undefined,
  });
}
function assertNoOldPaidPresentationR13(f,saved){
  assert.doesNotMatch(paidPresentationR13(f,saved),/Original paid interpretation|original-private-input|original-paid-model|Preserve the original paid intent/u);
}
async function denyOlderPaidReadR13(state){
  let bodyReads=0;
  state.denied.gate.resolve({ok:false,status:403,json:async()=>{bodyReads++;throw new SyntaxError("An older exact denial has no readable body");}});
  await state.reading;
  assert.equal(bodyReads,0,"Owned denial status must be handled before JSON decoding");
}
function assertPaidReuseReceiptR13(state,status){
  const {f,saved}=state,review=f.host.planningConsent.get(),view=render(f);
  assert.equal(review?.quote?.executionId,saved.executionId,"A successfully verified paid reuse remains inspectable");
  assert.equal(review.quote.status,status);assert.deepEqual(review.request,saved.request);
  assert.equal(review.submitted,true);assert.equal(review.working,false);
  assert.equal(review.quote.maximumMicrousd,saved.originalQuote.maximumMicrousd);
  assert.deepEqual(review.quote.models,saved.originalQuote.models);assert.deepEqual(review.quote.privateInput,saved.originalQuote.privateInput);
  assert.match(view.markup,/original-private-input/u);assert.match(view.markup,/original-paid-model/u);
  assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));
  assert.ok(!view.buttons.some(button=>button.label==="planning.consent.approve"||button.label==="action.cancel"));
  if(status==="uncertain")assert.equal(review.notice,"uncertain");
}
async function finishPaidReuseR13(state){
  const {f,saved,unrelated}=state;
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);
  assert.deepEqual(f.calls.map(call=>call.body?.action??"GET"),["resume","GET","quote"]);
  assert.equal(f.calls.some(call=>call.body?.action==="execute"),false,"No provider dispatch or purchase repairs a read");
  assert.equal(f.calls[0].body.executionId,saved.executionId);
  f.host.closePlanningConsent();await state.decision;
}
for(const canvasId of[null,"original-board"])for(const status of["completed","uncertain"])for(const order of["verified-before-denial","denial-while-pending"]){
  test("adaptive paid reuse certification R13: "+(canvasId?"Canvas":"Document")+" "+status+" "+order,{timeout:5000},async t=>{
    const state=await beginPaidReuseQuoteR13(t,canvasId,status),{f,saved,quoting}=state;
    const body=await paidReuseWorkerBodyR13(saved,status);
    if(order==="verified-before-denial"){
      await finishPaidQuoteReplyR13(state,body);assertPaidReuseReceiptR13(state,status);
      const before=structuredClone(f.host.planningConsent.get()),visible=paidPresentationR13(f,saved);
      await denyOlderPaidReadR13(state);
      assertPaidReuseReceiptR13(state,status);
      assert.deepEqual(f.host.planningConsent.get(),before,"Older failed access cannot erase newer successful paid proof");
      assert.equal(paidPresentationR13(f,saved),visible);
    }else{
      await denyOlderPaidReadR13(state);
      assertNoOldPaidPresentationR13(f,saved);
      assert.equal(f.host.planningConsent.get()?.working,true,"The newer free lookup still owns its pending lifecycle");
      await finishPaidQuoteReplyR13(state,body);
      assertPaidReuseReceiptR13(state,status);
    }
    await finishPaidReuseR13(state);
  });
}
const invalidPaidReuseBodiesR13=[
  ["missing-execution",body=>{delete body.executionId;}],
  ["wrong-execution",body=>{body.executionId="wrong-paid-execution";}],
  ["missing-original-request",body=>{delete body.planningRequest;}],
  ["wrong-original-request-key",body=>{body.planningRequest.requestKey="wrong-request-key";}],
  ["missing-reuse-evidence",body=>{delete body.reused;}],
  ["wrong-optional-binding",body=>{body.bindingHash="wrong-binding";}],
  ["failed-quote-http",()=>{},503],
];
for(const canvasId of[null,"original-board"])for(const[label,change,httpStatus=200]of invalidPaidReuseBodiesR13){
  test("adaptive paid reuse certification R13: "+(canvasId?"Canvas":"Document")+" "+label+" cannot certify an older paid view",{timeout:5000},async t=>{
    const state=await beginPaidReuseQuoteR13(t,canvasId),{f,saved,quoting}=state;
    const body=await paidReuseWorkerBodyR13(saved,"completed");change(body);
    await finishPaidQuoteReplyR13(state,body,httpStatus);
    await denyOlderPaidReadR13(state);
    assertNoOldPaidPresentationR13(f,saved);
    await finishPaidReuseR13(state);
  });
}
for(const canvasId of[null,"original-board"]){
  test("adaptive paid reuse certification R13: "+(canvasId?"Canvas":"Document")+" a fresh unsubmitted quote never certifies prior paid A",{timeout:5000},async t=>{
    const state=await beginPaidReuseQuoteR13(t,canvasId,"completed",{fresh:true}),{f,saved,quoting}=state;
    const {action,...planningRequest}=quoting.body;assert.equal(action,"quote");
    const fresh=quote(planningRequest,{executionId:"fresh-unsubmitted-B",bindingHash:"fresh-binding-B",sourceHash:"fresh-source-B"});
    await finishPaidQuoteReplyR13(state,{planningRequest,quote:fresh});
    assert.equal(f.host.planningConsent.get()?.quote?.executionId,fresh.executionId);
    await denyOlderPaidReadR13(state);
    assertNoOldPaidPresentationR13(f,saved);
    assert.equal(f.host.planningConsent.get()?.quote?.executionId,fresh.executionId,"A denial of A does not erase the separate valid new quote B");
    assert.equal(f.host.planningConsent.get().submitted,false);
    assert.deepEqual(f.host.planningConsent.get().request,planningRequest);
    await finishPaidReuseR13(state);
  });
}

// R13: execution HTTP409 is not an access denial when the exact original
// private receipt has passed the same current-authority/retention proof.
// The two negative cases fail against frozen R12 Store SHA-256
// b2df4cbe7169f1c7b1af99f269225e81f564d7dded410030b0deac57b5c3f054.
// R14: this is the forward-order counterpart to stale-receipt rejection.
// A newly certified original 409 receipt must publish its current accounting,
// not only its private quote. The routed tests prove these exact wire states.
function currentBillingBodyR14(saved,terminal,settled){
  const body=originalUncertainReceiptR13(saved);
  body.quote={...body.quote,status:settled?"failed":"uncertain"};
  body.status=body.quote.status;body.billingStatus=settled?"settled":"pending";
  body.error=settled?"provider_returned_invalid_json":terminal==="canceled"?"adaptive_canceled":"adaptive_force_failed";
  body.job={...body.job,status:terminal,result:{...body.job.result,
    planningStopBudget:settled?{reservationStatus:"settled",billingStatus:"settled"}:{reservationStatus:"retained",billingStatus:"pending"}}};
  return body;
}
for(const canvasId of[null,"original-board"])for(const terminal of["canceled","failed"])for(const action of["resume","retrieve"]){
  test("adaptive current billing receipt R14: "+(canvasId?"Canvas":"Document")+" "+terminal+" fresh "+action+" 409 publishes settled accounting",{timeout:6000},async t=>{
    const {f,saved,unrelated}=await personalPlanningDetailFixtureR7(t,canvasId);
    const oldBody=currentBillingBodyR14(saved,terminal,false),freshBody=currentBillingBodyR14(saved,terminal,true);
    const polling=f.host.syncDocumentJobs(),list=await f.take();await f.reply(list,{jobs:[oldBody.job]});await polling;
    await readTerminalInspectionR10(f,oldBody.job);
    assert.deepEqual(f.host.inspectionJob(saved.executionId).result.planningStopBudget,oldBody.job.result.planningStopBudget);
    let reading=f.host.reviewPlanningJob(saved.executionId),request=await f.take();
    assert.equal(request.body.action,"resume");
    if(action==="retrieve"){
      await f.reply(request,oldBody,409);await reading;
      assert.ok(render(f).buttons.some(button=>button.label==="context.consent.reuse"&&!button.disabled));
      reading=f.host.approvePlanningConsent();request=await f.take();
      assert.equal(request.body.action,"retrieve");assert.equal(request.body.approvedBindingHash,saved.originalQuote.bindingHash);
    }
    assert.equal(request.body.executionId,saved.executionId);
    await f.reply(request,freshBody,409);await reading;
    const current=f.host.documentJobs.get().find(job=>job.jobId===saved.executionId),cached=f.host.inspectionJob(saved.executionId);
    assert.equal(current?.status,terminal);
    assert.deepEqual(current.result.planningStopBudget,freshBody.job.result.planningStopBudget,
      "A fully validated newer receipt cannot leave Activity claiming the older retained hold");
    if(cached)assert.deepEqual(cached.result.planningStopBudget,freshBody.job.result.planningStopBudget,
      "Update or invalidate the stale detail rather than retain conflicting financial evidence");
    assert.equal(documentJobStopBudgetMessage(current.result.planningStopBudget),"Verified provider usage remains charged; no budget hold remains.");
    assert.equal(current.result.structure,undefined);
    const review=f.host.planningConsent.get(),view=render(f);
    assert.equal(review.working,false);assert.equal(review.quote.status,"failed");assert.equal(review.recoveredPlan,undefined);
    assert.deepEqual(review.quote.privateInput,saved.originalQuote.privateInput);
    assert.equal(review.quote.maximumMicrousd,saved.originalQuote.maximumMicrousd);
    assert.ok(view.buttons.some(button=>["context.consent.reuse","planning.consent.retrieveExisting"].includes(button.label)&&!button.disabled));
    assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview"].includes(button.label)));
    assert.deepEqual(f.host.documentJobs.get().map(job=>job.jobId),[saved.executionId]);
    assert.deepEqual(f.host.adaptiveStructures.get()["doc-b"],unrelated);assert.deepEqual(f.host.events.get(),[]);
    assert.ok(f.calls.every(call=>call.init.method==="GET"||["resume","retrieve"].includes(call.body?.action)),"Exact billing retrieval cannot initiate another purchase");
  });
}

function originalUncertainReceiptR13(saved) {
  const quote = {...saved.originalQuote, status: "uncertain", canPrepareNew: false};
  return {
    executionId: saved.executionId, bindingHash: quote.bindingHash,
    requestKey: saved.request.requestKey, planningRequest: saved.request, quote,
    job: {...saved.originalJob, status: "failed", result: {
      planningReviewAvailable: true, executionId: saved.executionId,
      bindingHash: quote.bindingHash, requestKey: saved.request.requestKey,
      planningStopBudget: {reservationStatus: "retained", billingStatus: "pending"},
    }},
    status: "uncertain", billingStatus: "pending", noAutomaticRetry: true,
    error: "adaptive_provider_usage_unverified",
  };
}
async function originalReceiptReadR13(t, canvasId) {
  const state = await personalPlanningDetailFixtureR7(t, canvasId), {f, saved} = state;
  // Start where native Activity Inspect and original-ID recovery coexist:
  // a failed job with its original execution still awaiting verified usage.
  const reading = f.host.loadDocumentJobDetail(saved.executionId).then(value => ({value}), error => ({error}));
  const older = await f.take();
  assert.equal(older.url, "/api/document-jobs/" + saved.executionId + "?inspection=1");
  const opening = f.host.reviewPlanningJob(saved.executionId), newer = await f.take();
  assert.equal(newer.body.action, "resume");
  assert.equal(newer.body.executionId, saved.executionId);
  assert.equal(Object.hasOwn(newer.body, "approvedBindingHash"), false);
  return {...state, reading, older, opening, newer};
}
async function releaseOlderReceiptDenialR13(state) {
  let bodyReads = 0;
  state.older.gate.resolve({ok: false, status: 403, json: async () => {
    bodyReads++;
    throw new SyntaxError("The known exact denial does not need a response body");
  }});
  await state.reading;
  assert.equal(bodyReads, 0);
}

// Frozen R14 Store 55cdc39a0da8ecd9fcb4fac5d3f9c2d8a13696512e637a37bbd160716271da2f
// and frozen shell: eight no-hold failures; sixteen settled/retained/unknown controls pass.

// R15: resolve only canonical no-hold pairs. "Not incurred" does not itself
// mean a reservation was released; retained and unknown evidence stay unresolved.
// Fixture provenance: actual Store/shell plus the R9 worker serializer/certifier
// with bounded ledger-read ports. Routed zero-POST contracts are tested separately.
const noHoldReceiptCasesR15 = [
  {name: "settled", budget: {reservationStatus: "settled", billingStatus: "settled"}, noHold: true},
  {name: "released", budget: {reservationStatus: "released", billingStatus: "not-incurred"}, noHold: true},
  {name: "not-reserved", budget: {reservationStatus: "not-reserved", billingStatus: "not-incurred"}, noHold: true},
  {name: "retained-not-incurred", budget: {reservationStatus: "retained", billingStatus: "not-incurred"}, noHold: false},
  {name: "retained-pending", budget: {reservationStatus: "retained", billingStatus: "pending"}, noHold: false},
  {name: "unknown", budget: {reservationStatus: "unknown", billingStatus: "unknown"}, noHold: false},
];
function noHoldOriginalBodyR15(saved, job, status) {
  const quote = {...saved.originalQuote, status, canPrepareNew: false};
  return {executionId: saved.executionId, bindingHash: quote.bindingHash,
    requestKey: saved.request.requestKey, planningRequest: saved.request, quote, job, status,
    billingStatus: status === "failed" ? "settled" : "pending", noAutomaticRetry: true,
    error: status === "failed" ? "adaptive_force_failed" : "adaptive_execution_in_progress"};
}
async function noHoldReceiptFixtureR15(t, canvasId, sample) {
  const state = await personalPlanningDetailFixtureR7(t, canvasId), {f, saved} = state;
  const current = await terminalWinnerSnapshotR9({
    winnerId: saved.executionId, request: saved.request,
    pendingQuote: saved.originalQuote, pendingJob: saved.originalJob,
  }, "failed", sample.budget);
  return {...state, current};
}
for (const canvasId of [null, "original-board"]) for (const sample of noHoldReceiptCasesR15) {
  for (const path of ["observer", "retrieve-transport"]) {
    test("adaptive no-hold receipt R15: " + (canvasId ? "Canvas" : "Document") + " " + path + " preserves " + sample.name, {timeout: 6000}, async t => {
      const {f, saved, current} = await noHoldReceiptFixtureR15(t, canvasId, sample);
      if (path === "observer") {
        // A native queued/running original can still have no reserved ledger
        // rows yet. Later terminal evidence may prove no reservation, a known
        // unused release, completed billing, or a genuinely remaining hold.
        const pending = {...saved.originalJob, status: "running", completedAt: null,
          result: {planningReviewAvailable: true}};
        f.host.documentJobs.set([pending]);
        const opening = f.host.reviewPlanningJob(saved.executionId), initial = await f.take();
        await f.reply(initial, noHoldOriginalBodyR15(saved, pending, "reserved"), 202);
        await opening;
        assert.match(render(f).markup, /context\.consent\.uncertain/u);
        const polling = f.host.syncDocumentJobs(), list = await f.take();
        await f.reply(list, {jobs: [current]});
        await polling;
      } else {
        f.host.documentJobs.set([current]);
        const opening = f.host.reviewPlanningJob(saved.executionId), initial = await f.take();
        await f.reply(initial, noHoldOriginalBodyR15(saved, current, sample.noHold ? "failed" : "uncertain"), 409);
        await opening;
        assert.deepEqual(f.host.documentJobs.get().find(job => job.jobId === saved.executionId).result.planningStopBudget, sample.budget);
        assert.ok(render(f).buttons.some(button => button.label === "context.consent.reuse" && !button.disabled));
        const reading = f.host.approvePlanningConsent(), request = await f.take();
        assert.equal(request.body.action, "retrieve");
        assert.equal(request.body.executionId, saved.executionId);
        assert.equal(request.body.approvedBindingHash, saved.originalQuote.bindingHash);
        request.gate.reject(new Error("Controlled original receipt retrieval interruption"));
        await reading;
      }
      const review = f.host.planningConsent.get(), view = render(f);
      assert.equal(review.working, false);
      assert.equal(review.quote?.executionId, saved.executionId);
      assert.equal(review.recoveryExecutionId, saved.executionId);
      assert.deepEqual(f.host.documentJobs.get().find(job => job.jobId === saved.executionId).result.planningStopBudget, sample.budget);
      if (sample.noHold) {
        assert.doesNotMatch(view.markup, /context\.consent\.uncertain/u,
          "Settled, released or never-reserved canonical evidence must not be relabeled as a held reservation");
      } else {
        assert.equal(review.notice, "uncertain");
        assert.match(view.markup, /context\.consent\.uncertain/u,
          "Retained/not-incurred, retained/pending and unknown are not proof that a hold disappeared");
      }
      const posts = f.calls.filter(call => call.init.method === "POST");
      assert.deepEqual(posts.map(call => call.body.action), path === "observer" ? ["resume"] : ["resume", "retrieve"]);
      for (const request of posts) assert.equal(request.body.executionId, saved.executionId);
      assert.deepEqual(f.host.events.get(), []);
      assert.equal(f.calls.some(call => call.body?.action === "quote" || call.body?.action === "execute"), false);
    });
  }
}

// Frozen R13 Store b7fdf15cc9ee8c89fdb4a58d987f4cc61a8b0612ac75628391649499ccc2967b:
// 16 held-status regression failures and 12 unchanged-held controls verified.

// R14: a current private-access proof is not permission to roll an older
// execution/billing snapshot over a newer terminal receipt. Reuse the R9/R10
// real serializer/certifier and R13 native paid-reuse wire fixtures.
async function terminalReceiptOrderFixtureR14(t, canvasId, status, settled) {
  const f = fixture(t, "en", {polling: true});
  const saved = await retainedActivity(f, {reader: false, canvasId});
  if (canvasId) {
    const session = f.host.session.get();
    f.host.session.set({...session, projectContext: {...session.projectContext,
      permissions: [...session.projectContext.permissions, "project.canvas.use"]}});
  }
  saved.originalQuote = {...saved.originalQuote, status: "uncertain", canPrepareNew: false,
    privateInput: {...saved.originalQuote.privateInput, requestKey: saved.request.requestKey,
      sourceHash: saved.originalQuote.sourceHash}};
  const oldBudget = {reservationStatus: "retained", billingStatus: "pending"};
  const latestBudget = settled ? {reservationStatus: "settled", billingStatus: "settled"} : oldBudget;
  const base = {winnerId: saved.executionId, request: saved.request,
    pendingQuote: saved.originalQuote, pendingJob: saved.originalJob};
  const older = await terminalWinnerSnapshotR9(base, status, oldBudget);
  const latest = await terminalWinnerSnapshotR9(base, status, latestBudget);
  const oldBody = originalUncertainReceiptR13(saved);
  oldBody.job = older;
  oldBody.error = status === "failed" ? "adaptive_force_failed" : "adaptive_canceled";
  f.host.documentJobs.set([older]);
  // Establish the existing terminal epoch before the read. An identical later
  // poll must remain neutral, rather than invalidating every retained read.
  const polling = f.host.syncDocumentJobs(), list = await f.take();
  await f.reply(list, {jobs: [older]});
  await polling;
  return {f, saved, older, latest, oldBody, latestBudget};
}
async function beginTerminalReceiptReadR14(state, action) {
  const {f, saved, oldBody} = state;
  if (action === "quote") {
    f.host.projection.set({...f.host.projection.get(), documentId: saved.request.documentId});
    f.host.route.set(saved.request.canvasId ? "/canvas" : "/document/doc-a/alpha");
    if (saved.request.canvasId) f.host.canvasProjection.set({selectedCanvasId: saved.request.canvasId});
    const decision = f.host.structureAdaptive(saved.request.prompt, {
      documentId: saved.request.documentId, canvasId: saved.request.canvasId ?? undefined,
      sourceSurface: saved.request.sourceSurface, projectScope: saved.request.projectScope,
      locale: saved.request.locale,
    });
    const call = await f.take();
    assert.equal(call.body.action, "quote");
    assert.equal(call.body.requestKey, saved.request.requestKey);
    assert.equal(Object.hasOwn(call.body, "executionId"), false);
    return {action, call, decision, body: await paidReuseWorkerBodyR13(saved, "uncertain"), httpStatus: 200};
  }
  if (action === "retrieve") {
    const opening = f.host.reviewPlanningJob(saved.executionId), initial = await f.take();
    await f.reply(initial, oldBody, 409);
    await opening;
    assert.ok(render(f).buttons.some(button => button.label === "context.consent.reuse" && !button.disabled));
  }
  const reading = action === "resume" ? f.host.reviewPlanningJob(saved.executionId) : f.host.approvePlanningConsent();
  const call = await f.take();
  assert.equal(call.body.action, action);
  assert.equal(call.body.executionId, saved.executionId);
  if (action === "retrieve") assert.equal(call.body.approvedBindingHash, saved.originalQuote.bindingHash);
  return {action, call, reading, body: oldBody, httpStatus: 409};
}
for (const canvasId of [null, "original-board"]) for (const status of ["failed", "canceled"]) {
  for (const action of ["resume", "retrieve", "quote"]) for (const settled of [false, true]) {
    test("adaptive terminal receipt order R14: " + (canvasId ? "Canvas" : "Document") + " " + status + " older " + action + " preserves " + (settled ? "newer settled billing" : "unchanged held billing"), {timeout: 6000}, async t => {
      const state = await terminalReceiptOrderFixtureR14(t, canvasId, status, settled);
      const {f, saved, latest, latestBudget} = state;
      const delayed = await beginTerminalReceiptReadR14(state, action);
      const polling = f.host.syncDocumentJobs(), list = await f.take();
      await f.reply(list, {jobs: [latest]});
      await polling;
      assert.deepEqual(f.host.documentJobs.get().find(job => job.jobId === saved.executionId).result.planningStopBudget, latestBudget);
      await f.reply(delayed.call, delayed.body, delayed.httpStatus);
      if (delayed.reading) await delayed.reading;
      else await settleReplacementPreviewR13(f);
      await turn();
      const review = structuredClone(f.host.planningConsent.get()), view = render(f);
      const current = f.host.documentJobs.get().find(job => job.jobId === saved.executionId);
      assert.equal(review.working, false, "Neither identical polling nor the older response may strand a read");
      assert.equal(current.status, status);
      assert.deepEqual(current.result.planningStopBudget, latestBudget);
      if (settled) {
        assert.doesNotMatch(view.markup, /context\.consent\.uncertain/u,
          "An older receipt must not assert 'Its reservation is held' after current ledgers are known settled");
      } else {
        assert.equal(review.notice, "uncertain");
        assert.equal(review.quote?.status, "uncertain");
        assert.equal(review.quote.executionId, saved.executionId);
        assert.deepEqual(review.quote.privateInput, saved.originalQuote.privateInput);
        assert.match(view.markup, /context\.consent\.uncertain/u);
      }
      assert.ok(!view.buttons.some(button => button.label === "planning.consent.approve" && !button.disabled));
      const posts = f.calls.filter(call => call.init.method === "POST");
      assert.deepEqual(posts.map(call => call.body.action), action === "retrieve" ? ["resume", "retrieve"] : [action]);
      for (const call of posts) {
        if (call.body.action !== "quote") assert.equal(call.body.executionId, saved.executionId);
        assert.notEqual(call.body.action, "execute", "Never buy again to repair financial presentation");
      }
      assert.deepEqual(f.host.events.get(), []);
      f.host.closePlanningConsent();
      if (delayed.decision) await delayed.decision;
    });
  }
}

for (const canvasId of [null, "original-board"]) for (const mode of ["observation-only", "repeat-retrieve-transport"]) {
  test("adaptive terminal receipt order R14: " + (canvasId ? "Canvas" : "Document") + " " + mode + " cannot reassert a settled reservation is held", {timeout: 6000}, async t => {
    const state = await terminalReceiptOrderFixtureR14(t, canvasId, "failed", true);
    const {f, saved, latest, latestBudget} = state;
    const opening = f.host.reviewPlanningJob(saved.executionId), initial = await f.take();
    await f.reply(initial, state.oldBody, 409);
    await opening;
    assert.match(render(f).markup, /context\.consent\.uncertain/u);
    const polling = f.host.syncDocumentJobs(), list = await f.take();
    await f.reply(list, {jobs: [latest]});
    await polling;
    assert.deepEqual(f.host.documentJobs.get().find(job => job.jobId === saved.executionId).result.planningStopBudget, latestBudget);
    if (mode === "repeat-retrieve-transport") {
      // First obtain the current original-ID failed/settled receipt through the
      // real Retrieve button; the next network failure is only a failed read.
      const refreshing = f.host.approvePlanningConsent(), fresh = await f.take();
      assert.equal(fresh.body.action, "retrieve");
      const currentBody = {...state.oldBody, status: "failed", billingStatus: "settled",
        error: "provider_returned_invalid_json", quote: {...state.oldBody.quote, status: "failed"}, job: latest};
      await f.reply(fresh, currentBody, 409);
      await refreshing;
      assert.equal(f.host.planningConsent.get().quote.status, "failed");
      assert.doesNotMatch(render(f).markup, /context\.consent\.uncertain/u);
      assert.ok(render(f).buttons.some(button => button.label === "context.consent.reuse" && !button.disabled));
      const retrying = f.host.approvePlanningConsent(), retry = await f.take();
      assert.equal(retry.body.action, "retrieve");
      assert.equal(retry.body.executionId, saved.executionId);
      assert.equal(retry.body.approvedBindingHash, saved.originalQuote.bindingHash);
      retry.gate.reject(new Error("Controlled original receipt retrieval interruption"));
      await retrying;
    }
    assert.equal(f.host.planningConsent.get().working, false);
    assert.equal(f.host.planningConsent.get().quote?.executionId, saved.executionId);
    assert.deepEqual(f.host.documentJobs.get().find(job => job.jobId === saved.executionId).result.planningStopBudget, latestBudget);
    assert.doesNotMatch(render(f).markup, /context\.consent\.uncertain/u,
      "A completed charge does not become a held reservation because a poll or later free read occurred");
    assert.deepEqual(f.calls.filter(call => call.init.method === "POST").map(call => call.body.action),
      mode === "observation-only" ? ["resume"] : ["resume", "retrieve", "retrieve"]);
    assert.equal(f.calls.some(call => call.body?.action === "execute" || call.body?.action === "quote"), false);
    assert.deepEqual(f.host.events.get(), []);
  });
}
for (const canvasId of [null, "original-board"]) {
  for (const outcome of ["uncertain", "completed"]) {
    test("adaptive uncertain receipt certification R13: " + (canvasId ? "Canvas" : "Document") + " newer " + outcome + " original receipt fences an older exact denial", {timeout: 5000}, async t => {
      const state = await originalReceiptReadR13(t, canvasId), {f, saved} = state;
      const body = outcome === "uncertain" ? originalUncertainReceiptR13(saved) : {
        ...saved.body, executionId: saved.executionId, bindingHash: saved.originalQuote.bindingHash,
        requestKey: saved.request.requestKey, billingStatus: "settled", noAutomaticRetry: true,
      };
      await f.reply(state.newer, body, outcome === "uncertain" ? 409 : 200);
      await state.opening;
      assert.deepEqual(f.host.planningConsent.get()?.quote, body.quote);
      assert.equal(f.host.planningConsent.get()?.working, false);
      assert.equal(planningDetailHasPrivateBytesR7(f, saved), true);
      const before = unreadableDenialSnapshotR11(f, saved);
      await releaseOlderReceiptDenialR13(state);
      assert.deepEqual(unreadableDenialSnapshotR11(f, saved), before,
        "A fully validated retained receipt is newer access proof even while its charge remains uncertain");
      if (outcome === "uncertain") {
        const view = render(f), review = f.host.planningConsent.get();
        assert.equal(review.notice, "uncertain");
        assert.equal(review.quote.status, "uncertain");
        assert.equal(review.recoveryExecutionId, saved.executionId);
        assert.equal(review.request.prompt, saved.request.prompt);
        assert.ok(view.buttons.some(button => button.label === "context.consent.reuse" && !button.disabled));
        assert.ok(!view.buttons.some(button => ["planning.consent.approve", "context.consent.preview", "planning.consent.newPreview"].includes(button.label)));
      }
      assertUnreadableDenialReadsOnlyR11(f, saved);
    });
  }
  for (const invalid of ["arbitrary-409", "missing-job", "mismatched-quote", "mismatched-request", "mismatched-job", "mismatched-binding", "missing-original-request", "unavailable"]) {
    test("adaptive uncertain receipt certification R13: " + (canvasId ? "Canvas" : "Document") + " " + invalid + " cannot certify private access", {timeout: 5000}, async t => {
      const state = await originalReceiptReadR13(t, canvasId), {f, saved} = state;
      let body = structuredClone(originalUncertainReceiptR13(saved));
      if (invalid === "arbitrary-409") body = {error: "fixture_unrelated_conflict", status: "uncertain"};
      if (invalid === "missing-job") delete body.job;
      if (invalid === "mismatched-quote") body.quote.documentId = "not-the-original-document";
      if (invalid === "mismatched-request") body.planningRequest.requestKey = "not-the-original-request";
      if (invalid === "mismatched-job") body.job.requestKey = "not-the-original-request";
      if (invalid === "mismatched-binding") body.bindingHash = "not-the-original-binding";
      if (invalid === "missing-original-request") delete body.planningRequest;
      if (invalid === "unavailable") {
        body.error = "adaptive_result_unavailable";
        body.job.result.planningReviewAvailable = false;
        body.job.result.resultUnavailable = true;
      }
      await f.reply(state.newer, body, 409);
      await state.opening;
      // Publish an incidental, correctly serialized completion after the bad
      // reply. Without this observable private result, an empty view would
      // make "not certified" pass vacuously. General feeds are deliberately
      // not a newer user-requested private-access proof.
      const serialized = await adaptiveWorkerSerializationR7(saved);
      const polling = f.host.syncDocumentJobs(), list = await f.take();
      await f.reply(list, {jobs: [serialized.feed]});
      await polling;
      assert.equal(planningDetailHasPrivateBytesR7(f, saved), true);
      await releaseOlderReceiptDenialR13(state);
      assert.equal(planningDetailHasPrivateBytesR7(f, saved), false,
        "An arbitrary, incomplete, mismatched or unavailable 409 must not fence the older exact denial");
      const review = f.host.planningConsent.get();
      assert.equal(review.quote, null);
      assert.equal(review.recoveredPlan, undefined);
      assert.equal(review.request.prompt, "");
      assert.equal(review.recoveryExecutionId, saved.executionId);
      assert.equal(review.working, false);
      assertUnreadableDenialReadsOnlyR11(f, saved);
    });
  }
}


// R15: an original failed/uncertain receipt is a read, not a successful new
// planning handoff. Reuse actual composer/Store/shell/Canvas methods, worker
// prior-paid responses, and real sanitized/certified job serialization.
// R14 SHA 55cdc39a0da8ecd9fcb4fac5d3f9c2d8a13696512e637a37bbd160716271da2f
// independently reproduced automatic review close and healthy-selection loss.
async function failedReceiptOriginR15(t,{canvasId=null,terminal="failed",settled=false,completed=false}={}){
  const state=await terminalReceiptOrderFixtureR14(t,canvasId,terminal,settled),{f,saved}=state;
  if(settled){
    const polling=f.host.syncDocumentJobs(),list=await f.take();
    await f.reply(list,{jobs:[state.latest]});await polling;
  }
  f.host.projection.set({...f.host.projection.get(),documentId:saved.request.documentId});
  f.host.route.set(canvasId?"/canvas":"/document/doc-a/alpha");
  if(canvasId)f.host.canvasProjection.set({selectedCanvasId:canvasId});
  const previousLocale=document.documentElement.lang;document.documentElement.lang=saved.request.locale;
  const entry=entryHost(f,canvasId?"canvas":"adaptive",saved.request.prompt);
  const origin={settled:false,value:undefined};
  const asking=Promise.resolve(entry.ask()).then(value=>{origin.settled=true;origin.value=value;return value;});
  t.after(async()=>{f.host.closePlanningConsent();await asking;document.documentElement.lang=previousLocale;});
  const quoteCall=await f.take();assert.equal(quoteCall.body.action,"quote");
  assert.equal(quoteCall.body.requestKey,saved.request.requestKey);
  assert.equal(quoteCall.body.executionId,undefined);assert.equal(quoteCall.body.replaceExecutionId,undefined);
  const status=completed?"completed":settled?"failed":"uncertain";
  const paidBody=await paidReuseWorkerBodyR13(saved,status);
  await f.reply(quoteCall,paidBody);await settleReplacementPreviewR13(f);
  const review=f.host.planningConsent.get(),view=render(f);
  assert.equal(review.quote.executionId,saved.executionId);assert.equal(review.submitted,true);
  assert.equal(review.recoveryExecutionId,undefined,"Exercise original-composer reuse, not the already-covered Activity resume path");
  assert.equal(origin.settled,false);assert.equal(entry.draft,saved.request.prompt);
  assert.ok(!view.buttons.some(button=>button.label==="planning.consent.approve"));
  return{...state,entry,origin,asking,reviewId:review.id,paidBody};
}
async function retrieveFromOriginR15(state,body,status=409){
  const {f,saved}=state,button=render(f).buttons.find(item=>item.label==="context.consent.reuse"&&!item.disabled);
  assert.ok(button,"Use the actual rendered free Retrieve action");button.click();
  const call=await f.take();assert.equal(call.body.action,"retrieve");
  assert.equal(call.body.executionId,saved.executionId);
  assert.equal(call.body.approvedBindingHash,saved.originalQuote.bindingHash);
  await f.reply(call,body,status);await settleReplacementPreviewR13(f);await turn();
  return call;
}
function assertReadOnlyOriginCallsR15(state){
  const {f,saved}=state;
  assert.deepEqual(f.calls.filter(call=>call.init.method==="POST").map(call=>[call.body.action,call.body.executionId]),
    [["quote",undefined],["retrieve",saved.executionId]]);
  assert.deepEqual(f.host.events.get(),[]);
}

for(const canvasId of[null,"original-board"])for(const terminal of["failed","canceled"])for(const settled of[false,true]){
  test("adaptive failed receipt continuity R15: "+(canvasId?"Canvas":"Document")+" "+terminal+" "+(settled?"settled":"uncertain-held")+" composer reuse stays in its exact review",{timeout:6000},async t=>{
    const state=await failedReceiptOriginR15(t,{canvasId,terminal,settled}),{f,saved,entry,origin}=state;
    const body=currentBillingBodyR14(saved,terminal,settled);
    body.job=settled?state.latest:state.older;
    await retrieveFromOriginR15(state,body);
    const current=f.host.documentJobs.get().find(job=>job.jobId===saved.executionId);
    assert.equal(current.status,terminal);assert.deepEqual(current.result.planningStopBudget,body.job.result.planningStopBudget);
    assert.equal(current.result.structure,undefined);assertReadOnlyOriginCallsR15(state);
    const review=f.host.planningConsent.get();
    assert.ok(review,"A valid failed receipt must remain visible; reading it is not a successful planning handoff");
    assert.equal(review.id,state.reviewId);assert.equal(review.recoveryExecutionId,saved.executionId);
    assert.equal(review.working,false);assert.equal(review.submitted,true);assert.equal(review.recoveredPlan,undefined);
    assert.deepEqual(review.request,saved.request);assert.deepEqual(review.quote,body.quote);
    assert.equal(origin.settled,false,"The original composer must not receive a fake successful handoff for a resultless failure");
    assert.equal(entry.draft,saved.request.prompt,"Do not clear the original Canvas composer merely because a failed receipt was read");
    const view=render(f);
    assert.match(view.markup,/original-private-input/u);
    assert.ok(view.buttons.some(button=>button.label==="context.consent.reuse"&&!button.disabled));
    assert.ok(view.buttons.some(button=>button.label==="planning.consent.closeReview"));
    assert.ok(!view.buttons.some(button=>["planning.consent.approve","context.consent.preview","planning.consent.newPreview"].includes(button.label)));
    if(settled)assert.doesNotMatch(view.markup,/context\.consent\.uncertain/u);
    else assert.match(view.markup,/context\.consent\.uncertain/u);
    if(canvasId)assert.equal(liveCapacityCanvasR11(f,saved).cards.has(saved.executionId),false,"A failure is not a fabricated Canvas suggestion");
    await view.buttons.find(button=>button.label==="planning.consent.closeReview").click();
    await state.asking;
    assert.equal(entry.draft,saved.request.prompt);
    if(canvasId)assert.equal(origin.value,false,"Explicit Close ends this read without clearing an unsuccessful original request");
  });
}

async function selectedHealthyPlanR15(t,{canvasId=null,terminal="failed",settled=false}={}){
  const state=await terminalReceiptOrderFixtureR14(t,canvasId,terminal,settled),{f,saved}=state;
  if(canvasId)f.host.canvasProjection.set({selectedCanvasId:canvasId});
  const siblings=await adaptiveCapacityNeighborsR8(saved,2),healthy=siblings[0];
  const healthyRequest={...saved.request,prompt:"Independent authorized planning intent 0",requestKey:healthy.requestKey};
  assert.equal(await adaptiveRequestKey(healthyRequest),healthy.requestKey);
  const healthyQuote={...saved.originalQuote,executionId:healthy.jobId,bindingHash:"capacity-binding-0",status:"completed",canPrepareNew:true};
  const polling=f.host.syncDocumentJobs(),list=await f.take();
  await f.reply(list,{jobs:[state.latest,...siblings]});await polling;
  const opening=f.host.reviewPlanningJob(healthy.jobId),request=await f.take();
  const healthyBody={executionId:healthy.jobId,bindingHash:healthyQuote.bindingHash,requestKey:healthyRequest.requestKey,
    planningRequest:healthyRequest,quote:healthyQuote,job:healthy,status:"completed",billingStatus:"settled"};
  await f.reply(request,healthyBody);await opening;
  const before={selected:f.host.knownPlanJob(saved.request.documentId),
    plan:structuredClone(f.host.adaptiveStructures.get()[saved.request.documentId]),
    cards:canvasId?[...liveCapacityCanvasR11(f,saved).cards.keys()].sort():[]};
  if(canvasId)assert.deepEqual(before.cards,siblings.map(job=>job.jobId).sort());
  else{assert.equal(before.selected,healthy.jobId);assert.deepEqual(before.plan,healthy.result.structure);}
  f.host.closePlanningConsent();
  return{...state,siblings,healthy,before};
}
function selectedPresentationR15(state){
  const {f,saved}=state;
  return{selected:f.host.knownPlanJob(saved.request.documentId),
    plan:structuredClone(f.host.adaptiveStructures.get()[saved.request.documentId]),
    cards:saved.request.canvasId?[...liveCapacityCanvasR11(f,saved).cards.keys()].sort():[]};
}
async function inspectResultlessWithHealthyPlanR15(state,body,httpStatus){
  const {f,saved,siblings}=state;
  const opening=f.host.reviewPlanningJob(saved.executionId),request=await f.take();
  assert.equal(request.body.action,"resume");assert.equal(request.body.executionId,saved.executionId);
  await f.reply(request,body,httpStatus);await opening;
  const afterRead=selectedPresentationR15(state);
  // Exercise the later incidental completed-B poll before asserting, so a bad
  // selection cannot be concealed by checking only the immediately open modal.
  const polling=f.host.syncDocumentJobs(),list=await f.take();
  await f.reply(list,{jobs:[body.job,...siblings]});await polling;
  const afterPoll=selectedPresentationR15(state);
  assert.equal(f.host.planningConsent.get()?.recoveryExecutionId,saved.executionId);
  assert.equal(f.host.planningConsent.get()?.recoveredPlan,undefined);
  assert.ok(render(f).buttons.some(button=>button.label==="context.consent.reuse"&&!button.disabled));
  assert.deepEqual(f.calls.filter(call=>call.init.method==="POST").map(call=>[call.body.action,call.body.executionId]),
    [["resume",state.healthy.jobId],["resume",saved.executionId]]);
  assert.deepEqual(f.host.events.get(),[]);
  assert.deepEqual(afterRead,state.before,"Reading resultless A must not replace or hide selected healthy B or its Canvas siblings");
  assert.deepEqual(afterPoll,state.before,"B's subsequent incidental poll must preserve the same selected healthy result");
}
for(const canvasId of[null,"original-board"])for(const terminal of["failed","canceled"])for(const settled of[false,true]){
  test("adaptive healthy selection R15: "+(canvasId?"Canvas siblings":"Document selected B")+" survives "+terminal+" A "+(settled?"settled":"uncertain-held")+" inspection and B polling",{timeout:6000},async t=>{
    const state=await selectedHealthyPlanR15(t,{canvasId,terminal,settled});
    const body=currentBillingBodyR14(state.saved,terminal,settled);body.job=state.latest;
    await inspectResultlessWithHealthyPlanR15(state,body,409);
  });
}
for(const canvasId of[null,"original-board"]){
  test("adaptive healthy selection R15: "+(canvasId?"Canvas siblings":"Document selected B")+" survives still-running A inspection and B polling",{timeout:6000},async t=>{
    const state=await selectedHealthyPlanR15(t,{canvasId,terminal:"running"}),{saved}=state;
    const pendingQuote={...saved.originalQuote,status:"reserved"};
    const pendingJob=await terminalWinnerSnapshotR9({winnerId:saved.executionId,request:saved.request,
      pendingQuote,pendingJob:saved.originalJob},"running",{reservationStatus:"retained",billingStatus:"pending"});
    const body={executionId:saved.executionId,bindingHash:pendingQuote.bindingHash,requestKey:saved.request.requestKey,
      planningRequest:saved.request,quote:pendingQuote,job:pendingJob,status:"reserved",
      billingStatus:"pending",error:"adaptive_execution_in_progress",noAutomaticRetry:true};
    await inspectResultlessWithHealthyPlanR15(state,body,202);
  });
}

for(const canvasId of[null,"original-board"]){
  test("adaptive completed reuse handoff R15: "+(canvasId?"Canvas":"Document")+" still selects its actual completed result",{timeout:6000},async t=>{
    const state=await failedReceiptOriginR15(t,{canvasId,completed:true}),{f,saved}=state;
    const originalQuote={...state.paidBody.quote,status:"completed",canPrepareNew:true};
    const completed={...saved,originalQuote,body:{job:{...saved.originalJob,status:"completed",
      result:{intent:saved.request.prompt,structure:saved.originalPlan,planningReviewAvailable:true}}}};
    const serialized=await adaptiveWorkerSerializationR7(completed);
    const body={executionId:saved.executionId,bindingHash:originalQuote.bindingHash,requestKey:saved.request.requestKey,
      planningRequest:saved.request,quote:originalQuote,job:serialized.detail,status:"completed",billingStatus:"settled"};
    await retrieveFromOriginR15(state,body,200);await state.asking;
    assert.equal(f.host.planningConsent.get(),null,"A genuine completed original result may finish its successful composer handoff");
    assert.equal(state.origin.settled,true);assertReadOnlyOriginCallsR15(state);
    if(canvasId){assert.equal(state.origin.value,true);assert.equal(state.entry.draft,"");
      assert.ok(liveCapacityCanvasR11(f,saved).cards.has(saved.executionId));}
    else{assert.equal(f.host.knownPlanJob(saved.request.documentId),saved.executionId);
      assert.deepEqual(f.host.adaptiveStructures.get()[saved.request.documentId],saved.originalPlan);}
  });
}

for(const kind of["adaptive","canvas"]){
  test("adaptive newly admitted handoff R15: "+kind+" keeps the legitimate pending queue handoff",{timeout:6000},async t=>{
    const f=fixture(t),draft="Keep the legitimate newly approved request.",entry=entryHost(f,kind,draft);
    const asking=entry.ask();t.after(async()=>{f.host.closePlanningConsent();await asking;});
    const first=await f.take(),{action,...request}=first.body;assert.equal(action,"quote");
    const preview=quote(request,{executionId:"new-pending-r15",bindingHash:"b".repeat(64)});
    await f.reply(first,{quote:preview,planningRequest:request});await settleReplacementPreviewR13(f);
    const approve=render(f).buttons.find(button=>button.label==="planning.consent.approve"&&!button.disabled);
    assert.ok(approve);approve.click();
    const execution=await f.take();assert.equal(execution.body.action,"execute");
    const pendingQuote={...preview,status:"reserved",canExecute:false};
    const pendingJob=job(request,preview.executionId,{status:"queued",completedAt:null,
      planningExecutionId:preview.executionId,planningProjectScope:request.projectScope,planningLocale:request.locale,
      result:{planningReviewAvailable:true}});
    await f.reply(execution,{executionId:preview.executionId,bindingHash:preview.bindingHash,requestKey:request.requestKey,
      quote:pendingQuote,planningRequest:request,job:pendingJob,status:"reserved"},202);
    await asking;
    assert.equal(f.host.planningConsent.get(),null,"A newly admitted queued request is not an old failed receipt");
    assert.equal(f.host.documentJobs.get()[0].status,"queued");
    if(kind==="canvas")assert.equal(entry.draft,"");
    else assert.equal(entry.draft,draft);
    assert.deepEqual(f.calls.map(call=>call.body.action),["quote","execute"]);
    assert.deepEqual(f.host.events.get(),[]);
  });
}

// Pre-ownership R15 Store 51272bdacf786124be400a21e9cf274a42c22533d6ab1418cbc8037bd73c9138
// reproduced the delivery/visibility regressions through its actual methods.
// R15: a read-only failed receipt never selects a resultless plan, but an
// accepted composer handoff still owns its eventual exact result. Keep that
// ownership separate from the plan currently displayed and from retained text.
async function pendingSelectionBaseR15(t) {
  const f=fixture(t,"en",{polling:true}),b=await retainedActivity(f,{reader:false});
  const bWire=(await adaptiveWorkerSerializationR7(b)).scoped;
  const reading=f.host.reviewPlanningJob(b.executionId),resume=await f.take();
  await f.reply(resume,{...b.body,executionId:b.executionId,bindingHash:b.originalQuote.bindingHash,requestKey:b.request.requestKey,job:bWire});
  await reading;f.host.closePlanningConsent();
  const session=f.host.session.get();
  f.host.session.set({...session,provider:{configured:true,plannerConfigured:true}});
  f.host.projection.set({...f.host.projection.get(),documentId:b.request.documentId});
  f.host.route.set("/document/doc-a/alpha/view/adaptive");
  assert.equal(f.host.knownPlanJob("doc-a"),b.executionId);
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],b.originalPlan);
  return{f,b,bWire};
}
async function pendingSelectionReceiptR15(state,id,{documentId="doc-a",request,preview}={}) {
  request??={projectId:"project-a",documentId,canvasId:null,sourceSurface:"adaptive",projectScope:false,locale:"en",prompt:"New deliberate path "+id,requestKey:""};
  if(!request.requestKey)request.requestKey=await adaptiveRequestKey(request);
  preview??=quote(request,{executionId:id,bindingHash:"binding-"+id,sourceHash:"source-"+id});
  const pendingQuote={...preview,status:"reserved",canExecute:false,canPrepareNew:false};
  const raw=job(request,id,{planningExecutionId:id,planningProjectScope:false,planningLocale:request.locale,status:"running",completedAt:null,result:{planningReviewAvailable:true}});
  const pending=(await adaptiveWorkerSerializationR7({executionId:id,request,originalQuote:pendingQuote,originalPlan:undefined,body:{job:raw}},{jobStatus:"running"})).scoped;
  const plan={...state.b.originalPlan,interpretation:"DELIBERATE COMPLETED PLAN "+id};
  const completedQuote={...preview,status:"completed",canExecute:false,canPrepareNew:true};
  const complete=(await adaptiveWorkerSerializationR7({executionId:id,request,originalQuote:completedQuote,originalPlan:plan,body:{job:{...raw,status:"completed",result:{intent:request.prompt,structure:plan}}}})).scoped;
  const envelope=(quote,job)=>({executionId:id,bindingHash:quote.bindingHash,requestKey:request.requestKey,planningRequest:request,quote,job,status:quote.status});
  return{id,request,preview,pendingQuote,pending,plan,completedQuote,complete,pendingBody:envelope(pendingQuote,pending),completedBody:envelope(completedQuote,complete)};
}
async function pendingSelectionHandoffR15(state,id,options={}) {
  const {f}=state,documentId=options.documentId??"doc-a";
  const opened=await open(f,"New deliberate path "+id,{documentId,canvasId:undefined,sourceSurface:"adaptive",projectScope:false,locale:"en"},{executionId:id,bindingHash:"binding-"+id,sourceHash:"source-"+id});
  const {action,...request}=opened.request.body;assert.equal(action,"quote");
  const a=await pendingSelectionReceiptR15(state,id,{documentId,request,preview:opened.preview});
  const control=render(f).buttons.find(button=>button.label==="planning.consent.approve");
  assert.ok(control&&!control.disabled);control.click();
  const execute=await f.take();assert.equal(execute.body.action,"execute");assert.equal(execute.body.executionId,id);
  assert.equal(execute.body.approvedBindingHash,opened.preview.bindingHash);
  await f.reply(execute,a.pendingBody,202);
  assert.equal(await opened.decision,true,"Only a confirmed live composer handoff is acknowledged");
  assert.equal(f.host.planningConsent.get(),null);
  return a;
}
async function pollPendingSelectionR15(state,jobs) {
  const polling=state.f.host.syncDocumentJobs(),list=await state.f.take();
  assert.equal(list.init.method,"GET");assert.equal(list.url,"/api/document-jobs");
  await state.f.reply(list,{jobs});await polling;
}
function assertWorkingPlanR15(state,id,plan,documentId="doc-a") {
  assert.equal(state.f.host.knownPlanJob(documentId),id);
  assert.deepEqual(state.f.host.adaptiveStructures.get()[documentId],plan);
}
function assertSelectionActionsR15(state,actions) {
  assert.deepEqual(state.f.calls.filter(call=>call.init.method!=="GET").map(call=>call.body.action),actions);
  assert.deepEqual(state.f.host.events.get(),[],"Selection and recovery do not apply authoring changes");
}
async function actualJobVisibilityR15(f,job,{visibility="visible"}={}) {
  const {documentJobMatchesSurface}=await import("../src/model/canvas-document-target.ts");
  const {isDocumentViewRoute,documentViewFromRoute,documentIdFromRoute}=await import("../src/model/routes.ts");
  const {canvasIdFromRoute}=await import("../src/canvas/routes.ts");
  const store=f.host,document={visibilityState:visibility};
  const code='(class {route=store.route;projection=store.projection;canvasProjection=store.canvasProjection;adaptiveStructures=store.adaptiveStructures;adaptiveSuggestionSets=store.adaptiveSuggestionSets;#adaptiveStructureJobIds={get:id=>store.knownPlanJob(id)};canvasPlanningDocumentId(){return store.canvasPlanningDocumentId();}visible(job){return this.#jobResultVisible(job);}'+
    member(storeSyntax,"FormaStore","adaptiveStructureFor")+member(storeSyntax,"FormaStore","adaptiveSuggestionSetsFor")+member(storeSyntax,"FormaStore","#jobResultVisible")+'})';
  return new(eval(stripTypeScriptTypes(code)))().visible(job);
}

test("adaptive pending selection R15: accepted A preserves healthy B until A completes, then displays the exact new result",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,b,bWire}=state;
  const a=await pendingSelectionHandoffR15(state,"owned-A-r15");
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  await pollPendingSelectionR15(state,[a.complete,bWire]);
  assertWorkingPlanR15(state,a.id,a.plan);
  assert.equal(f.host.planningConsent.get(),null,"A completion never reopens the already closed review");
  assertSelectionActionsR15(state,["resume","quote","execute"]);
});
test("adaptive pending selection R15: incidental polling of B does not revoke the newer accepted A intent",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),a=await pendingSelectionHandoffR15(state,"owned-A-r15");
  await pollPendingSelectionR15(state,[state.bWire,a.pending]);
  assertWorkingPlanR15(state,state.b.executionId,state.b.originalPlan);
  await pollPendingSelectionR15(state,[a.complete,state.bWire]);
  assertWorkingPlanR15(state,a.id,a.plan);
  assertSelectionActionsR15(state,["resume","quote","execute"]);
});
test("adaptive pending selection R15: an omitted pending A is recertified by its exact free read and selects on completion",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,b,bWire}=state;
  const a=await pendingSelectionHandoffR15(state,"owned-A-r15");
  const polling=f.host.syncDocumentJobs(),list=await f.take();
  await f.reply(list,{jobs:[bWire]});
  const exact=await f.take();assert.equal(exact.url,"/api/document-jobs/"+a.id+"?inspection=1");assert.equal(exact.init.method,"GET");
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  await f.reply(exact,{job:a.complete});await polling;
  assertWorkingPlanR15(state,a.id,a.plan);
  assert.deepEqual(f.host.documentJobs.get().map(job=>job.jobId),[b.executionId],"Exact recovery must not fabricate an omitted feed row");
  assert.equal(f.host.planningConsent.get(),null);
  assertSelectionActionsR15(state,["resume","quote","execute"]);
});
for(const status of["failed","canceled"])test("adaptive pending selection R15: "+status+" A keeps B and relinquishes automatic selection",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,b,bWire}=state,a=await pendingSelectionHandoffR15(state,"owned-A-r15");
  const stopped={...a.pending,status,result:{planningReviewAvailable:true},completedAt:"2026-08-27T00:06:00Z"};
  await pollPendingSelectionR15(state,[stopped,bWire]);assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  // A subsequent deliberate inspection may recertify a saved result. It is a
  // read, not permission to revive the canceled/failed automatic handoff.
  const reading=f.host.loadDocumentJobDetail(a.id),exact=await f.take();
  assert.equal(exact.url,"/api/document-jobs/"+a.id+"?inspection=1");
  await f.reply(exact,{job:a.complete});await reading;
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  assert.equal(f.host.planningConsent.get(),null);
  assertSelectionActionsR15(state,["resume","quote","execute"]);
});
test("adaptive pending selection R15: Activity inspection of pending A never claims the current document selection",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,b,bWire}=state,a=await pendingSelectionReceiptR15(state,"historical-A-r15");
  f.host.documentJobs.set([a.pending,bWire]);
  const reading=f.host.reviewPlanningJob(a.id),resume=await f.take();
  assert.equal(resume.body.action,"resume");await f.reply(resume,a.pendingBody,202);await reading;
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  f.host.closePlanningConsent();
  await pollPendingSelectionR15(state,[a.complete,bWire]);
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  assertSelectionActionsR15(state,["resume","resume"]);
});
for(const order of["older-first","newer-first"])test("adaptive pending selection R15: newer accepted C owns delivery when completions arrive "+order,{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{b,bWire}=state,a=await pendingSelectionHandoffR15(state,"owned-A-r15"),c=await pendingSelectionHandoffR15(state,"owned-C-r15");
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  if(order==="older-first"){
    await pollPendingSelectionR15(state,[a.complete,c.pending,bWire]);assertWorkingPlanR15(state,b.executionId,b.originalPlan);
    await pollPendingSelectionR15(state,[a.complete,c.complete,bWire]);
  }else{
    await pollPendingSelectionR15(state,[a.pending,c.complete,bWire]);assertWorkingPlanR15(state,c.id,c.plan);
    await pollPendingSelectionR15(state,[a.complete,c.complete,bWire]);
  }
  assertWorkingPlanR15(state,c.id,c.plan);
  assertSelectionActionsR15(state,["resume","quote","execute","quote","execute"]);
});
test("adaptive pending selection R15: explicitly reselecting completed B cancels A ownership, unlike incidental polling",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,b,bWire}=state,a=await pendingSelectionHandoffR15(state,"owned-A-r15");
  const reading=f.host.reviewPlanningJob(b.executionId),resume=await f.take();
  await f.reply(resume,{...b.body,executionId:b.executionId,bindingHash:b.originalQuote.bindingHash,requestKey:b.request.requestKey,job:bWire});await reading;f.host.closePlanningConsent();
  await pollPendingSelectionR15(state,[a.complete,bWire]);
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  assertSelectionActionsR15(state,["resume","quote","execute","resume"]);
});
test("adaptive pending selection R15: dismissing the working document plan prevents the outstanding handoff from resurfacing it",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,bWire}=state,a=await pendingSelectionHandoffR15(state,"owned-A-r15");
  f.host.dismissAdaptiveStructure("doc-a");
  assert.equal(f.host.knownPlanJob("doc-a"),undefined);assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);
  await pollPendingSelectionR15(state,[a.complete,bWire]);
  assert.equal(f.host.knownPlanJob("doc-a"),undefined);assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);
  assertSelectionActionsR15(state,["resume","quote","execute"]);
});
test("adaptive pending selection R15: a handoff in another document does not steal A ownership",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),a=await pendingSelectionHandoffR15(state,"owned-A-r15"),c=await pendingSelectionHandoffR15(state,"other-document-C-r15",{documentId:"doc-b"});
  await pollPendingSelectionR15(state,[a.complete,c.pending,state.bWire]);
  assertWorkingPlanR15(state,a.id,a.plan);
  await pollPendingSelectionR15(state,[a.complete,c.complete,state.bWire]);
  assertWorkingPlanR15(state,a.id,a.plan);assertWorkingPlanR15(state,c.id,c.plan,"doc-b");
  assertSelectionActionsR15(state,["resume","quote","execute","quote","execute"]);
});
test("adaptive pending selection R15: withdrawal clears A ownership even when a newer free inspection can recertify its result",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,b}=state,a=await pendingSelectionHandoffR15(state,"owned-A-r15");
  let reading=f.host.loadDocumentJobDetail(a.id).then(value=>({value}),error=>({error})),exact=await f.take();
  await f.reply(exact,{error:"project_access_required"},403);assert.ok((await reading).error);
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  reading=f.host.loadDocumentJobDetail(a.id);exact=await f.take();await f.reply(exact,{job:a.complete});await reading;
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  assertSelectionActionsR15(state,["resume","quote","execute"]);
});
test("adaptive pending selection R15: result visibility means the exact displayed document plan, not only its route",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,bWire}=state,a=await pendingSelectionHandoffR15(state,"owned-A-r15");
  assert.equal(await actualJobVisibilityR15(f,bWire),true,"The current working B is actually displayed");
  assert.equal(await actualJobVisibilityR15(f,a.complete),false,"A completed but not selected A must not be silently acknowledged as visible");
  await pollPendingSelectionR15(state,[a.complete,bWire]);
  assert.equal(await actualJobVisibilityR15(f,a.complete),true);
  assert.equal(await actualJobVisibilityR15(f,bWire),false);
  assert.equal(await actualJobVisibilityR15(f,a.complete,{visibility:"hidden"}),false);
  f.host.route.set("/document/doc-b/other/view/adaptive");
  assert.equal(await actualJobVisibilityR15(f,a.complete),false);
});
test("adaptive pending selection R15: Canvas visibility requires that exact live card and still respects dismissal",{timeout:7000},async t=>{
  const {f,saved}=await displayedAdaptivePlan(t,{canvasId:"original-board",reader:false});
  f.host.closePlanningConsent();f.host.canvasProjection.set({selectedCanvasId:"original-board"});f.host.route.set("/canvas/original-board");
  const wire=(await adaptiveWorkerSerializationR7(saved)).scoped;
  assert.equal(liveCapacityCanvasR11(f,saved).cards.has(saved.executionId),true);
  assert.equal(await actualJobVisibilityR15(f,wire),true);
  liveCapacityCanvasR11(f,saved).cards.get(saved.executionId).dismiss();
  assert.equal(await actualJobVisibilityR15(f,wire),false,"A dismissed card is not visible merely because its board is open");
});

test("adaptive pending selection R15: deliberate reuse of live paid A owns completion without another approval",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,b,bWire}=state,a=await pendingSelectionReceiptR15(state,"reused-live-A-r15");
  f.host.documentJobs.set([a.pending,bWire]);
  const decision=f.host.structureAdaptive(a.request.prompt,a.request),quoting=await f.take();
  assert.equal(quoting.body.action,"quote");assert.equal(quoting.body.requestKey,a.request.requestKey);
  await f.reply(quoting,{reused:true,executionId:a.id,planningRequest:a.request,quote:a.pendingQuote});
  await settleReplacementPreviewR13(f);
  const retrieve=render(f).buttons.find(button=>button.label==="context.consent.reuse");
  assert.ok(retrieve&&!retrieve.disabled);retrieve.click();
  const reading=await f.take();assert.equal(reading.body.action,"retrieve");assert.equal(reading.body.executionId,a.id);assert.equal(reading.body.approvedBindingHash,a.preview.bindingHash);
  await f.reply(reading,a.pendingBody,202);assert.equal(await decision,true);
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  await pollPendingSelectionR15(state,[a.complete,bWire]);assertWorkingPlanR15(state,a.id,a.plan);
  assertSelectionActionsR15(state,["resume","quote","retrieve"]);
});
test("adaptive pending selection R15: a valid reused winner keeps composer ownership after its read-only receipt closes",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,b,bWire}=state;
  const opened=await open(f,"New deliberate winner path",{documentId:"doc-a",sourceSurface:"adaptive",projectScope:false,locale:"en"},{executionId:"losing-request-A-r15"});
  const {action,...request}=opened.request.body;assert.equal(action,"quote");
  const winner=await pendingSelectionReceiptR15(state,"winning-request-W-r15",{request});
  const approving=f.host.approvePlanningConsent(),execute=await f.take();assert.equal(execute.body.action,"execute");
  await f.reply(execute,{...winner.pendingBody,requestedExecutionId:opened.preview.executionId,reusedExecutionId:winner.id},202);await approving;
  assert.equal(await opened.decision,true);assert.equal(f.host.planningConsent.get().recoveryExecutionId,winner.id);
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  f.host.closePlanningConsent();
  await pollPendingSelectionR15(state,[winner.complete,bWire]);assertWorkingPlanR15(state,winner.id,winner.plan);
  assertSelectionActionsR15(state,["resume","quote","execute"]);
});

test("adaptive pending selection R15: a superseded A cannot fill a blank document while the chosen C is pending or fails",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,bWire}=state;
  f.host.dismissAdaptiveStructure("doc-a");
  const a=await pendingSelectionHandoffR15(state,"blank-owned-A-r15"),c=await pendingSelectionHandoffR15(state,"blank-owned-C-r15");
  await pollPendingSelectionR15(state,[a.complete,c.pending,bWire]);
  assert.equal(f.host.knownPlanJob("doc-a"),undefined);assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);
  await pollPendingSelectionR15(state,[a.complete,{...c.pending,status:"failed",completedAt:"2026-08-27T00:07:00Z"},bWire]);
  assert.equal(f.host.knownPlanJob("doc-a"),undefined);assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);
});

test("adaptive pending selection R15: reselecting then dismissing B cannot revive the relinquished A handoff",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,b,bWire}=state,a=await pendingSelectionHandoffR15(state,"relinquished-A-r15");
  const reading=f.host.reviewPlanningJob(b.executionId),resume=await f.take();
  await f.reply(resume,{...b.body,executionId:b.executionId,bindingHash:b.originalQuote.bindingHash,requestKey:b.request.requestKey,job:bWire});await reading;f.host.closePlanningConsent();
  f.host.dismissAdaptiveStructure("doc-a");
  await pollPendingSelectionR15(state,[a.complete,bWire]);
  assert.equal(f.host.knownPlanJob("doc-a"),undefined);assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);
});

for(const boundary of["failed","withdrawn"])test("adaptive pending selection R15: "+boundary+" ownership on a blank document cannot revive from a later incidental completion",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,bWire}=state;
  f.host.dismissAdaptiveStructure("doc-a");
  const a=await pendingSelectionHandoffR15(state,"blank-"+boundary+"-A-r15");
  if(boundary==="failed")await pollPendingSelectionR15(state,[{...a.pending,status:"failed",completedAt:"2026-08-27T00:07:00Z"},bWire]);
  else{const reading=f.host.loadDocumentJobDetail(a.id).catch(()=>null),exact=await f.take();await f.reply(exact,{error:"project_access_required"},403);await reading;}
  await pollPendingSelectionR15(state,[a.complete,bWire]);
  assert.equal(f.host.knownPlanJob("doc-a"),undefined);assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);
});

// R16: locale invalidation may land after the user's approval/read started but
// before its HTTP response. Its original paid request remains inspectable;
// it cannot reacquire automatic working-plan/card selection or claim delivery.
async function localeSelectionBaseR16(t,canvasId){
  document.documentElement.lang="en";t.after(()=>{document.documentElement.lang="en";});
  if(!canvasId)return pendingSelectionBaseR15(t);
  const {f,saved:b}=await displayedAdaptivePlan(t,{canvasId,reader:false});
  const bWire=(await adaptiveWorkerSerializationR7(b)).scoped;
  f.host.closePlanningConsent();
  const session=f.host.session.get();
  f.host.session.set({...session,provider:{configured:true,plannerConfigured:true}});
  f.host.projection.set({...f.host.projection.get(),documentId:b.request.documentId});
  f.host.route.set("/canvas/"+canvasId);f.host.canvasProjection.set({selectedCanvasId:canvasId});
  return{f,b,bWire};
}
async function localeSelectionReceiptR16(state,id,request,preview){
  preview??=quote(request,{executionId:id,bindingHash:"binding-"+id,sourceHash:"source-"+id,models:["ORIGINAL-PAID-MODEL-"+id],
    privateInput:{approved:"ORIGINAL-PAID-INPUT-"+id,scope:request.canvasId?"whole-project":"document",projectTitle:"Original project",documentTitle:"Original document",canvasTitle:request.canvasId?"Original board":null,blockCount:14,documentCount:1,requestKey:request.requestKey,sourceHash:"source-"+id}});
  const pendingQuote={...preview,status:"reserved",canExecute:false,canPrepareNew:false};
  const raw=job(request,id,{planningExecutionId:id,planningProjectScope:request.projectScope,planningLocale:request.locale,status:"running",completedAt:null,result:{planningReviewAvailable:true}});
  const pending=(await adaptiveWorkerSerializationR7({executionId:id,request,originalQuote:pendingQuote,originalPlan:undefined,body:{job:raw}},{jobStatus:"running"})).scoped;
  const plan={...state.b.originalPlan,interpretation:"ORIGINAL-ENGLISH-PLAN-"+id};
  const completedQuote={...preview,status:"completed",canExecute:false,canPrepareNew:true};
  const complete=(await adaptiveWorkerSerializationR7({executionId:id,request,originalQuote:completedQuote,originalPlan:plan,body:{job:{...raw,status:"completed",result:{intent:request.prompt,structure:plan}}}})).scoped;
  const envelope=(quote,job)=>({executionId:id,bindingHash:quote.bindingHash,sourceHash:quote.sourceHash,requestKey:request.requestKey,planningRequest:request,quote,job,status:quote.status});
  return{id,request,preview,pendingQuote,pending,plan,completedQuote,complete,pendingBody:envelope(pendingQuote,pending),completedBody:envelope(completedQuote,complete),
    executionId:id,originalQuote:preview,originalPlan:plan,body:{job:complete}};
}
async function beginLocaleSelectionR16(t,canvasId,action,{quotePending=false}={}){
  const state=await localeSelectionBaseR16(t,canvasId),{f}=state;
  const origin={settled:false,accepted:undefined};
  const decision=f.host.structureAdaptive("The exact original English planning intent — R16.",{
    documentId:"doc-a",canvasId:canvasId??undefined,sourceSurface:canvasId?"canvas":"adaptive",projectScope:Boolean(canvasId),locale:"en",
  }).then(value=>{origin.settled=true;origin.accepted=value;return value;});
  const quoting=await f.take();assert.equal(quoting.body.action,"quote");
  const request=replacementPlanningIdentityR13(quoting.body);
  const a=await localeSelectionReceiptR16(state,"locale-origin-A-r16",request);
  const result={...state,a,action,decision,origin,quoting};
  if(quotePending)return result;
  await f.reply(quoting,action==="retrieve"?await paidReuseWorkerBodyR13(a,"reserved"):{planningRequest:request,quote:a.preview});
  await settleReplacementPreviewR13(f);
  const view=render(f),label=action==="execute"?"planning.consent.approve":"context.consent.reuse";
  assert.ok(view.buttons.some(button=>button.label===label&&!button.disabled));
  result.reading=f.host.approvePlanningConsent();result.call=await f.take();
  assert.equal(result.call.body.action,action);assert.equal(result.call.body.executionId,a.id);
  assert.equal(result.call.body.approvedBindingHash,a.preview.bindingHash);
  assert.equal(result.call.body.locale,"en");
  return result;
}
async function releaseLocaleSelectionR16(state,outcome){
  const {f,a}=state,redirect=outcome.startsWith("redirect-");
  const target=redirect?await localeSelectionReceiptR16(state,"locale-reused-W-r16",a.request):a;
  const completed=outcome.endsWith("completed"),body={...(completed?target.completedBody:target.pendingBody),
    ...(redirect?{requestedExecutionId:a.id,reusedExecutionId:target.id,reused:true}:{})};
  await f.reply(state.call,body,completed?200:202);await state.reading;
  await settleReplacementPreviewR13(f);
  return target;
}
function localeSelectionIsVisibleR16(state,target){
  const {f}=state;
  return target.request.canvasId
    ?Boolean(f.host.adaptiveSuggestionSets.get()[target.request.documentId]?.some(item=>item.id===target.id))
    :f.host.knownPlanJob(target.request.documentId)===target.id&&Boolean(f.host.adaptiveStructures.get()[target.request.documentId]);
}
function assertLocaleSelectionHiddenR16(state,target){
  assert.equal(localeSelectionIsVisibleR16(state,target),false,"A pre-change request must not automatically select its old-language result");
}
function assertOriginalLocaleReceiptR16(state,target){
  const current=state.f.host.documentJobs.get().find(job=>job.jobId===target.id)??state.f.host.inspectionJob(target.id);
  assert.ok(current,"The paid execution remains reachable");
  assert.equal(current.planningExecutionId,target.id);assert.equal(current.requestKey,target.request.requestKey);
  assert.equal(current.planningLocale,"en");assert.equal(target.request.locale,"en");
  const review=state.f.host.planningConsent.get();
  if(review?.quote?.executionId===target.id){
    assert.equal(review.request.locale,"en");assert.equal(review.request.prompt,target.request.prompt);
    assert.deepEqual(review.quote.models,target.preview.models);
    assert.deepEqual(review.quote.privateInput,target.preview.privateInput);
  }
}
async function freshExplicitLocaleReadR16(state,target){
  const {f}=state;
  f.host.closePlanningConsent();await state.decision;
  const reading=f.host.reviewPlanningJob(target.id),call=await f.take();
  assert.equal(call.body.action,"resume");assert.equal(call.body.executionId,target.id);
  assert.equal(call.body.locale,"en","A deliberate new read keeps the retained paid language; it does not relabel or repurchase");
  assert.equal(Object.hasOwn(call.body,"approvedBindingHash"),false);
  await f.reply(call,target.completedBody);await reading;
  assert.equal(localeSelectionIsVisibleR16(state,target),true,"A genuinely new explicit read after the locale event may select this original result");
  assert.deepEqual(f.host.planningConsent.get()?.recoveredPlan,target.plan);
  assert.deepEqual(f.host.planningConsent.get()?.quote?.privateInput,target.preview.privateInput);
  assert.deepEqual(f.host.planningConsent.get()?.request,target.request);
  assert.equal(document.documentElement.lang,"fr");
  assert.deepEqual(f.host.events.get(),[]);
}
function assertLocaleSelectionPurchaseCountR16(state,count){
  assert.equal(state.f.calls.filter(call=>call.body?.action==="execute").length,count,"Original retention and selection must not buy another plan");
  assert.deepEqual(state.f.host.events.get(),[]);
}
for(const canvasId of[null,"original-board"])for(const action of["execute","retrieve"]){
  const outcomes=action==="execute"?["pending","completed","redirect-pending","redirect-completed"]:["pending","completed"];
  for(const outcome of outcomes)test("adaptive locale selection R16: "+(canvasId?"Canvas":"Document")+" locale changes during "+action+" before "+outcome,{timeout:7000},async t=>{
    const state=await beginLocaleSelectionR16(t,canvasId,action),{f,bWire}=state;
    // The actual request already captured its read/selection clock. A delayed
    // catalog load may finish now; the native callback, not this test, revokes it.
    f.host.dispatchActualLocaleChangeR16("fr");
    const target=await releaseLocaleSelectionR16(state,outcome);
    assertLocaleSelectionHiddenR16(state,target);
    assert.equal(state.origin.settled,false,"A stale-language async receipt is recovery, not successful composer delivery");
    assertOriginalLocaleReceiptR16(state,target);
    await pollPendingSelectionR15(state,[target.complete,bWire]);
    assertLocaleSelectionHiddenR16(state,target);
    assertOriginalLocaleReceiptR16(state,target);
    await freshExplicitLocaleReadR16(state,target);
    assert.equal(state.origin.accepted,false,"Closing the stale recovery review retains the originating draft");
    assertLocaleSelectionPurchaseCountR16(state,action==="execute"?1:0);
  });
}
for(const canvasId of[null,"original-board"])for(const action of["execute","retrieve"])for(const change of["none","after-handoff"]){
  test("adaptive locale selection R16: "+(canvasId?"Canvas":"Document")+" "+action+" "+change+" control",{timeout:7000},async t=>{
    const state=await beginLocaleSelectionR16(t,canvasId,action),{f,bWire}=state;
    const target=await releaseLocaleSelectionR16(state,"pending");
    assert.equal(await state.decision,true,"A current-language confirmed handoff remains acknowledged");
    if(change==="after-handoff")f.host.dispatchActualLocaleChangeR16("fr");
    await pollPendingSelectionR15(state,[target.complete,bWire]);
    if(change==="none"){
      assert.equal(localeSelectionIsVisibleR16(state,target),true);
      assert.equal(document.documentElement.lang,"en");
    }else{
      assertLocaleSelectionHiddenR16(state,target);
      await freshExplicitLocaleReadR16(state,target);
    }
    assertOriginalLocaleReceiptR16(state,target);
    assertLocaleSelectionPurchaseCountR16(state,action==="execute"?1:0);
  });
}
for(const canvasId of[null,"original-board"])for(const action of["execute","retrieve"]){
  test("adaptive locale selection R16: "+(canvasId?"Canvas":"Document")+" quote still pending at locale change permits later explicit "+action,{timeout:7000},async t=>{
    const state=await beginLocaleSelectionR16(t,canvasId,action,{quotePending:true}),{f,a,quoting}=state;
    f.host.dispatchActualLocaleChangeR16("fr");
    await f.reply(quoting,action==="retrieve"?await paidReuseWorkerBodyR13(a,"reserved"):{planningRequest:a.request,quote:a.preview});
    await settleReplacementPreviewR13(f);
    assertLocaleSelectionHiddenR16(state,a);
    assert.equal(state.origin.settled,false);
    assert.equal(f.host.planningConsent.get()?.request.locale,"en");
    assert.deepEqual(f.host.planningConsent.get()?.quote?.privateInput,a.preview.privateInput);
    // This is a new explicit action after the actual locale callback, not the
    // old pre-change quote being treated as a new approval by the response path.
    state.reading=f.host.approvePlanningConsent();state.call=await f.take();
    assert.equal(state.call.body.action,action);assert.equal(state.call.body.executionId,a.id);
    await releaseLocaleSelectionR16(state,"completed");
    assert.equal(await state.decision,true);
    assert.equal(localeSelectionIsVisibleR16(state,a),true);
    assert.equal(document.documentElement.lang,"fr");
    assertOriginalLocaleReceiptR16(state,a);
    assertLocaleSelectionPurchaseCountR16(state,action==="execute"?1:0);
  });
}

// R16: signed paid planning may become the selected Document result only
// through an owned composer handoff or deliberate completed-result selection.
// Frozen R15 Store 17e5de39a5157fff21d9e0779e69cfaef33e06faf048ed51414e703f222d65b5
// reproduced historical A auto-selection after inspecting A and dismissing B.
async function unownedBlankDocumentR16(t){
  const f=fixture(t,"en",{polling:true}),b=await retainedActivity(f,{reader:false});
  // Reuse the valid plan template, not a displayed/resumed B. Before any public
  // read there is no selected result, recovery identity, or composer owner.
  f.host.documentJobs.set([]);f.host.adaptiveStructures.set({});f.host.adaptiveSuggestionSets.set({});
  f.host.projection.set({...f.host.projection.get(),documentId:"doc-a"});
  f.host.route.set("/document/doc-a/alpha/view/adaptive");
  assert.equal(f.host.knownPlanJob("doc-a"),undefined);
  assert.deepEqual(f.host.planningRecoveryEntries(),[]);
  return{f,b};
}
async function inspectUnownedPendingR16(state,a,jobs){
  const {f}=state;
  await pollPendingSelectionR15(state,jobs);
  const reading=f.host.reviewPlanningJob(a.id),resume=await f.take();
  assert.equal(resume.body.action,"resume");assert.equal(resume.body.executionId,a.id);
  await f.reply(resume,a.pendingBody,202);await reading;
  assert.equal(f.host.planningConsent.get().recoveryExecutionId,a.id);
  assert.equal(f.host.planningConsent.get().recoveredPlan,undefined);
  f.host.closePlanningConsent();
}
async function assertUnownedResultUnselectedR16(state,a,actions){
  const {f}=state;
  assert.equal(f.host.knownPlanJob("doc-a"),undefined,"A historical read is not ownership of the empty Document");
  assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined,"Completion must not undo the user's blank selection");
  assert.equal(f.host.planningConsent.get(),null);
  assert.deepEqual(f.host.documentJobs.get().find(job=>job.jobId===a.id)?.result?.structure,a.plan,
    "Keep the completed original available for deliberate free recovery, not erased or regenerated");
  assert.equal(await actualJobVisibilityR15(f,a.complete),false,"Route match alone cannot claim the unselected result is displayed");
  assertSelectionActionsR15(state,actions);
}
test("adaptive unowned selection R16: inspect pending A, close, dismiss selected B, then complete A keeps the Document blank",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,b,bWire}=state;
  const a=await pendingSelectionReceiptR15(state,"merely-inspected-A-r16");
  await inspectUnownedPendingR16(state,a,[a.pending,bWire]);
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  f.host.dismissAdaptiveStructure("doc-a");
  assert.equal(f.host.adaptiveStructures.get()["doc-a"],undefined);
  await pollPendingSelectionR15(state,[a.complete,bWire]);
  await assertUnownedResultUnselectedR16(state,a,["resume","resume"]);
});
for(const arrival of["inspected-pending","completed-first-discovery"]){
  test("adaptive unowned selection R16: initially blank Document with "+arrival+" paid A has no implicit owner",{timeout:7000},async t=>{
    const state=await unownedBlankDocumentR16(t),a=await pendingSelectionReceiptR15(state,"initially-blank-A-r16");
    if(arrival==="inspected-pending")await inspectUnownedPendingR16(state,a,[a.pending]);
    await pollPendingSelectionR15(state,[a.complete]);
    await assertUnownedResultUnselectedR16(state,a,arrival==="inspected-pending"?["resume"]:[]);
  });
}
test("adaptive unowned selection R16: merely inspected A completion keeps the still-selected healthy B",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{b,bWire}=state;
  const a=await pendingSelectionReceiptR15(state,"unowned-with-healthy-B-r16");
  await inspectUnownedPendingR16(state,a,[a.pending,bWire]);
  await pollPendingSelectionR15(state,[a.complete,bWire]);
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  assert.equal(await actualJobVisibilityR15(state.f,a.complete),false);
  assertSelectionActionsR15(state,["resume","resume"]);
});
test("adaptive unowned selection R16: genuine pending composer ownership still delivers A after preserving B",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{b,bWire}=state;
  const a=await pendingSelectionHandoffR15(state,"legitimate-owned-A-r16");
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  await pollPendingSelectionR15(state,[a.complete,bWire]);
  assertWorkingPlanR15(state,a.id,a.plan);
  assert.equal(await actualJobVisibilityR15(state.f,a.complete),true);
  assertSelectionActionsR15(state,["resume","quote","execute"]);
});
test("adaptive unowned selection R16: deliberate exact completed A recovery still selects after clearing B",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f,bWire}=state;
  const a=await pendingSelectionReceiptR15(state,"explicitly-recovered-A-r16");
  await inspectUnownedPendingR16(state,a,[a.pending,bWire]);
  f.host.dismissAdaptiveStructure("doc-a");
  await pollPendingSelectionR15(state,[a.complete,bWire]);
  // This positive control tests explicit recovery independently of the red
  // fallback assertion above; it must remain supported after removing it.
  const reading=f.host.reviewPlanningJob(a.id),resume=await f.take();
  assert.equal(resume.body.action,"resume");assert.equal(resume.body.executionId,a.id);
  assert.equal(Object.hasOwn(resume.body,"approvedBindingHash"),false);
  await f.reply(resume,a.completedBody);await reading;
  assertWorkingPlanR15(state,a.id,a.plan);
  assert.equal(f.host.planningConsent.get().recoveryExecutionId,a.id);
  assert.deepEqual(f.host.planningConsent.get().recoveredPlan,a.plan);
  assert.equal(await actualJobVisibilityR15(f,a.complete),true);
  f.host.closePlanningConsent();
  assertSelectionActionsR15(state,["resume","resume","resume"]);
});
test("adaptive unowned selection R16: the existing unsigned legacy completion retains its blank-Document fallback",{timeout:7000},async t=>{
  const state=await unownedBlankDocumentR16(t),{f}=state;
  const a=await pendingSelectionReceiptR15(state,"legacy-template-r16");
  // The established job() fixture has no consent marker: this is the old
  // unsigned display contract, not permission to dispatch an unapproved job.
  const legacy=job(a.request,"legacy-adaptive-r16",{status:"completed",
    result:{structure:{...a.plan,interpretation:"LEGACY_UNPURCHASED_FALLBACK_R16"},intent:a.request.prompt}});
  assert.equal(legacy.planningExecutionId,undefined);
  await pollPendingSelectionR15(state,[legacy]);
  assert.deepEqual(f.host.adaptiveStructures.get()["doc-a"],legacy.result.structure);
  assert.equal(f.host.knownPlanJob("doc-a"),undefined,"Do not pretend legacy fallback has a signed paid identity");
  assert.equal(await actualJobVisibilityR15(f,legacy),true);
  assertSelectionActionsR15(state,[]);
});



// R16: frozen R15 Store 17e5de39a5157fff21d9e0779e69cfaef33e06faf048ed51414e703f222d65b5
// revoked a confirmed delivery intent on a temporary inability to read private
// evidence. Keep only its content-free ownership; never keep unverified bytes.
async function uncertainSelectionReadR16(state,a,path) {
  const {f,bWire}=state;
  if(path==="detail"){
    const reading=f.host.loadDocumentJobDetail(a.id).then(value=>({value}),error=>({error}));
    const exact=await f.take();
    assert.equal(exact.url,"/api/document-jobs/"+a.id+"?inspection=1");
    return{reading,exact};
  }
  const reading=f.host.syncDocumentJobs(),list=await f.take();
  assert.equal(list.url,"/api/document-jobs");assert.equal(list.init.method,"GET");
  await f.reply(list,{jobs:[bWire]});
  const exact=await f.take();
  assert.equal(exact.url,"/api/document-jobs/"+a.id+"?inspection=1");
  return{reading,exact};
}
async function failUncertainSelectionReadR16(state,a,pending,failure) {
  const {f}=state,{exact}=pending;
  assert.equal(exact.init.method,"GET");assert.equal(exact.body,null);
  if(failure==="transport")exact.gate.reject(new Error("Controlled temporary original-status lookup outage"));
  else if(failure==="non-JSON")exact.gate.resolve({ok:true,status:200,json:async()=>{throw new SyntaxError("Controlled truncated status response");}});
  else if(failure==="private-false")await f.reply(exact,{job:{...a.pending,result:{planningReviewAvailable:false,resultUnavailable:true}}});
  else{
    const status=Number(failure.slice(4));let bodyReads=0;
    await f.reply(exact,{error:status===500?"temporary_status_lookup_failure":"project_access_required"},status,()=>{bodyReads++;});
    if(status===403||status===404)assert.equal(bodyReads,0,"An exact authorization/retention denial is decisive before reading its body");
  }
  return pending.reading;
}
function assertUncertainPrivateClearedR16(state,a) {
  const {f,b}=state;
  assertWorkingPlanR15(state,b.executionId,b.originalPlan);
  assert.equal(f.host.inspectionJob(a.id),undefined);
  assert.equal(f.host.pendingIntent(a.id),undefined,"Preserving content-free ownership must not preserve private intent text");
  const retained=f.host.documentJobs.get().find(job=>job.jobId===a.id);
  assert.equal(retained?.result?.structure,undefined);assert.equal(retained?.result?.intent,undefined);assert.equal(retained?.result?.quote,undefined);
  assert.equal(f.host.planningConsent.get(),null,"A failed background/status lookup must not open a new approval");
  const identity=f.host.planningRecoveryEntries().find(entry=>entry.jobId===a.id)??retained;
  assert.equal(identity?.planningExecutionId,a.id,"The original content-free recovery target remains reachable");
  assert.equal(identity.documentId,a.request.documentId);assert.equal(identity.requestKey,a.request.requestKey);
  assert.equal(Object.hasOwn(identity,"prompt"),false);assert.equal(Object.hasOwn(identity,"privateInput"),false);
}
async function completeUncertainSelectionReadR16(state,a,path) {
  const pending=await uncertainSelectionReadR16(state,a,path);
  await state.f.reply(pending.exact,{job:a.complete});
  const result=await pending.reading;
  if(path==="detail"){assert.equal(result.error,undefined);assert.deepEqual(result.value.result.structure,a.plan);}
  assert.equal(state.f.host.inspectionJob(a.id)?.status,"completed");
  assert.equal(state.f.host.planningConsent.get(),null);
  if(path==="omitted")assert.deepEqual(state.f.host.documentJobs.get().map(job=>job.jobId),[state.b.executionId],"An exact result is not a new row in the paginated feed");
}
for(const path of["omitted","detail"])for(const failure of["HTTP500","transport","non-JSON","HTTP403","HTTP404","private-false"]){
  const temporary=["HTTP500","transport","non-JSON"].includes(failure);
  test("adaptive uncertain lookup selection R16: "+path+" "+failure+" "+(temporary?"preserves the original delivery intent":"revokes delivery after explicit withdrawal"),{timeout:7000},async t=>{
    const state=await pendingSelectionBaseR15(t),a=await pendingSelectionHandoffR15(state,"original-owned-A-r16");
    const first=await uncertainSelectionReadR16(state,a,path);
    const failed=await failUncertainSelectionReadR16(state,a,first,failure);
    if(path==="detail")assert.ok(failed.error,"An unverified private read cannot return success");
    assertUncertainPrivateClearedR16(state,a);
    await completeUncertainSelectionReadR16(state,a,path);
    if(temporary){
      assertWorkingPlanR15(state,a.id,a.plan);
      assert.equal(await actualJobVisibilityR15(state.f,a.complete),true,"A fresh exact completion must honor the still-current affirmative handoff");
    }else{
      assertWorkingPlanR15(state,state.b.executionId,state.b.originalPlan);
      assert.equal(await actualJobVisibilityR15(state.f,a.complete),false,"Later free inspection cannot reactivate ownership revoked by a known denial");
    }
    assertSelectionActionsR15(state,["resume","quote","execute"]);
    assert.ok(state.f.calls.slice(3).every(call=>call.init.method==="GET"),"Status recovery neither requotes nor repeats the paid approval");
  });
}
for(const failure of["HTTP500","HTTP403"])test("adaptive uncertain lookup selection R16: older "+failure+" cannot erase a newer deliberately certified completion",{timeout:7000},async t=>{
  const state=await pendingSelectionBaseR15(t),{f}=state,a=await pendingSelectionHandoffR15(state,"original-owned-A-r16");
  const older=await uncertainSelectionReadR16(state,a,"omitted");
  // The newer exact read is actual private proof, not merely a newer pending
  // request. This boundary must remain intact when clear/revoke are separated.
  const newer=await uncertainSelectionReadR16(state,a,"detail");
  await f.reply(newer.exact,{job:a.complete});
  const verified=await newer.reading;assert.equal(verified.error,undefined);
  assertWorkingPlanR15(state,a.id,a.plan);
  await failUncertainSelectionReadR16(state,a,older,failure);
  assertWorkingPlanR15(state,a.id,a.plan);
  assert.equal(await actualJobVisibilityR15(f,a.complete),true);
  assert.equal(f.host.inspectionJob(a.id)?.status,"completed");
  assert.equal(f.host.planningConsent.get(),null);
  assert.deepEqual(f.host.documentJobs.get().map(job=>job.jobId),[state.b.executionId]);
  assertSelectionActionsR15(state,["resume","quote","execute"]);
});


// R16: changing direction is reversible only through a new confirmed original
// composer handoff. Reuse actual entry/Store/shell/worker/serializer methods;
// incidental recovery and merely opening/canceling a preview never re-arm it.
// Negative evidence captured from frozen R15 Store SHA
// 17e5de39a5157fff21d9e0779e69cfaef33e06faf048ed51414e703f222d65b5.
async function rearmedSelectionBaseR16(t,revocation){
  const state=await pendingSelectionBaseR15(t),{f}=state;
  const a=await pendingSelectionHandoffR15(state,"rearmed-A-r16");
  const c=revocation==="superseded"?await pendingSelectionHandoffR15(state,"superseding-C-r16"):null;
  if(revocation==="dismissed")f.host.dismissAdaptiveStructure("doc-a");
  const before={id:f.host.knownPlanJob("doc-a"),plan:structuredClone(f.host.adaptiveStructures.get()["doc-a"])};
  return{...state,a,c,revocation,before};
}
async function beginOriginalRearmR16(t,state,target=state.a){
  const {f}=state,entry=entryHost(f,"adaptive",target.request.prompt);
  const postCount=f.calls.filter(call=>call.init.method==="POST").length;
  const origin={settled:false,accepted:undefined};
  const actual=f.host.structureAdaptive;
  // Observe, but do not replace, the boolean result of the actual Store call.
  // Adaptive's real entry awaits it without returning that boolean itself.
  f.host.structureAdaptive=function(...args){
    return actual.apply(this,args).then(value=>{origin.accepted=value;return value;});
  };
  let asking;
  try{asking=Promise.resolve(entry.ask()).then(value=>{origin.settled=true;return value;});}
  finally{f.host.structureAdaptive=actual;}
  t.after(async()=>{f.host.closePlanningConsent();await asking;});
  const quoting=await f.take();
  assert.equal(quoting.body.action,"quote");assert.equal(quoting.body.requestKey,target.request.requestKey);
  assert.equal(quoting.body.executionId,undefined);assert.equal(quoting.body.replaceExecutionId,undefined);
  const paid=await paidReuseWorkerBodyR13({executionId:target.id,request:target.request,
    originalQuote:target.preview,originalPlan:target.plan},"reserved");
  await f.reply(quoting,paid);await settleReplacementPreviewR13(f);
  assert.equal(f.host.planningConsent.get().quote.executionId,target.id);
  assert.equal(f.host.planningConsent.get().recoveryExecutionId,undefined);
  assert.equal(origin.settled,false);assert.equal(origin.accepted,undefined);
  assert.equal(entry.draft,target.request.prompt);
  assert.ok(!render(f).buttons.some(button=>button.label==="planning.consent.approve"));
  return{entry,origin,asking,target,postCount};
}
async function clickOriginalRearmRetrieveR16(state,arm){
  const {f}=state,button=render(f).buttons.find(item=>item.label==="context.consent.reuse"&&!item.disabled);
  assert.ok(button,"The original composer must use its bound free Retrieve control");button.click();
  const call=await f.take();assert.equal(call.body.action,"retrieve");
  assert.equal(call.body.executionId,arm.target.id);assert.equal(call.body.approvedBindingHash,arm.target.preview.bindingHash);
  return call;
}
async function confirmOriginalRearmR16(t,state,target=state.a){
  const arm=await beginOriginalRearmR16(t,state,target);
  const call=await clickOriginalRearmRetrieveR16(state,arm);
  await state.f.reply(call,target.pendingBody,202);await arm.asking;
  assert.equal(arm.origin.settled,true);assert.equal(arm.origin.accepted,true,"Only this newly confirmed live handoff claims delivery");
  assert.equal(state.f.host.planningConsent.get(),null);
  assert.deepEqual(state.f.calls.filter(item=>item.init.method==="POST").slice(arm.postCount).map(item=>[item.body.action,item.body.executionId]),
    [["quote",undefined],["retrieve",target.id]],"Re-arm the existing execution without another approval/execute");
  assert.deepEqual(state.f.host.events.get(),[]);
  return arm;
}
function rearmedPresentationR16(state){
  return{id:state.f.host.knownPlanJob("doc-a"),plan:structuredClone(state.f.host.adaptiveStructures.get()["doc-a"])};
}
async function pollRearmedResultR16(state,{aComplete=true,cComplete=false}={}){
  await pollPendingSelectionR15(state,[aComplete?state.a.complete:state.a.pending,
    ...(state.c?[cComplete?state.c.complete:state.c.pending]:[]),state.bWire]);
}
async function assertRearmedDeliveredR16(state,target){
  assertWorkingPlanR15(state,target.id,target.plan);
  assert.equal(await actualJobVisibilityR15(state.f,target.complete),true,"The exact result promised by the latest confirmed composer handoff must actually be displayed");
  assert.equal(state.f.host.planningConsent.get(),null,"Delivery does not reopen another review");
  assert.deepEqual(state.f.host.events.get(),[]);
}
for(const[revocation,order]of[["none","A-first"],["superseded","A-first"],["superseded","C-first"],["dismissed","A-first"]]){
  test("adaptive original rearm R16: "+revocation+" live A is deliberately reused and delivered "+order,{timeout:7000},async t=>{
    const state=await rearmedSelectionBaseR16(t,revocation);
    await confirmOriginalRearmR16(t,state);
    assert.deepEqual(rearmedPresentationR16(state),state.before,"Keep the current working view until the reselected plan is actually ready");
    if(order==="C-first"){
      await pollRearmedResultR16(state,{aComplete:false,cComplete:true});
      assert.deepEqual(rearmedPresentationR16(state),state.before,"An older C completion cannot displace the newly chosen live A");
    }
    await pollRearmedResultR16(state,{cComplete:order==="C-first"});
    const first=rearmedPresentationR16(state);
    if(state.c)await pollRearmedResultR16(state,{cComplete:true});
    assert.deepEqual(first,{id:state.a.id,plan:state.a.plan},"A previous dismissal must not defeat the user's newly confirmed reuse");
    await assertRearmedDeliveredR16(state,state.a);
  });
}
test("adaptive original rearm R16: a later deliberate reuse of C supersedes rearmed A without buying either again",{timeout:7000},async t=>{
  const state=await rearmedSelectionBaseR16(t,"superseded");
  await confirmOriginalRearmR16(t,state,state.a);
  await confirmOriginalRearmR16(t,state,state.c);
  await pollRearmedResultR16(state);
  assert.deepEqual(rearmedPresentationR16(state),state.before,"The later confirmed C intent owns delivery, not rearmed A");
  await pollRearmedResultR16(state,{cComplete:true});
  await assertRearmedDeliveredR16(state,state.c);
  const actions=state.f.calls.filter(call=>call.init.method==="POST").map(call=>call.body.action);
  assert.deepEqual(actions,["resume","quote","execute","quote","execute","quote","retrieve","quote","retrieve"]);
});

for(const revocation of["superseded","dismissed"])for(const reading of["incidental-poll","exact-detail","Activity-pending"]){
  test("adaptive rearm boundary R16: "+reading+" alone respects "+revocation+" A",{timeout:7000},async t=>{
    const state=await rearmedSelectionBaseR16(t,revocation),{f,a}=state;
    const postCount=f.calls.filter(call=>call.init.method==="POST").length;
    if(reading==="exact-detail"){
      const inspecting=f.host.loadDocumentJobDetail(a.id),exact=await f.take();
      assert.equal(exact.url,"/api/document-jobs/"+a.id+"?inspection=1");
      await f.reply(exact,{job:a.complete});await inspecting;
    }else if(reading==="Activity-pending"){
      const inspecting=f.host.reviewPlanningJob(a.id),resume=await f.take();
      assert.equal(resume.body.action,"resume");assert.equal(resume.body.executionId,a.id);
      await f.reply(resume,a.pendingBody,202);await inspecting;f.host.closePlanningConsent();
    }
    await pollRearmedResultR16(state);
    assert.deepEqual(rearmedPresentationR16(state),state.before,"A read is not a renewed composer choice");
    assert.equal(await actualJobVisibilityR15(f,a.complete),false);
    const posts=f.calls.filter(call=>call.init.method==="POST").slice(postCount);
    assert.deepEqual(posts.map(call=>call.body.action),reading==="Activity-pending"?["resume"]:[]);
    if(state.c){await pollRearmedResultR16(state,{cComplete:true});await assertRearmedDeliveredR16(state,state.c);}
    assert.deepEqual(f.host.events.get(),[]);
  });
}
for(const revocation of["superseded","dismissed"]){
  test("adaptive rearm boundary R16: canceling a reused quote does not undo "+revocation+" A",{timeout:7000},async t=>{
    const state=await rearmedSelectionBaseR16(t,revocation),arm=await beginOriginalRearmR16(t,state),{f}=state;
    const close=render(f).buttons.find(button=>button.label==="planning.consent.closeReview");
    assert.ok(close);await close.click();await arm.asking;
    assert.equal(arm.origin.accepted,false);
    await pollRearmedResultR16(state);
    assert.deepEqual(rearmedPresentationR16(state),state.before);
    assert.deepEqual(f.calls.filter(call=>call.init.method==="POST").slice(arm.postCount).map(call=>call.body.action),["quote"]);
  });
  test("adaptive rearm boundary R16: Close before the reused receipt arrives keeps "+revocation+" A revoked",{timeout:7000},async t=>{
    const state=await rearmedSelectionBaseR16(t,revocation),arm=await beginOriginalRearmR16(t,state),{f}=state;
    const receipt=await clickOriginalRearmRetrieveR16(state,arm);
    const close=render(f).buttons.find(button=>button.label==="planning.consent.closeReview");
    assert.ok(close);await close.click();await arm.asking;
    assert.equal(arm.origin.accepted,false);
    await f.reply(receipt,state.a.pendingBody,202);await turn();
    await pollRearmedResultR16(state);
    assert.deepEqual(rearmedPresentationR16(state),state.before);
    assert.equal(f.host.planningConsent.get(),null);
    assert.deepEqual(f.calls.filter(call=>call.init.method==="POST").slice(arm.postCount).map(call=>call.body.action),["quote","retrieve"]);
  });
}
test("adaptive rearm boundary R16: a mismatched retained receipt never re-arms A or supersedes the valid C choice",{timeout:7000},async t=>{
  const state=await rearmedSelectionBaseR16(t,"superseded"),arm=await beginOriginalRearmR16(t,state),{f,a}=state;
  const receipt=await clickOriginalRearmRetrieveR16(state,arm);
  await f.reply(receipt,{...a.pendingBody,job:{...a.pending,requestKey:"unrelated-request-r16"}},202);
  await settleReplacementPreviewR13(f);await turn();
  assert.equal(arm.origin.settled,false);assert.equal(arm.origin.accepted,undefined);
  assert.equal(f.host.planningConsent.get()?.recoveredPlan,undefined);
  await render(f).buttons.find(button=>button.label==="planning.consent.closeReview").click();await arm.asking;
  assert.equal(arm.origin.accepted,false);
  await pollRearmedResultR16(state);assert.deepEqual(rearmedPresentationR16(state),state.before);
  await pollRearmedResultR16(state,{cComplete:true});await assertRearmedDeliveredR16(state,state.c);
});

// R17: a same-intent paid winner can enter the real Canvas feed before the
// initiating execute reply discloses its ID. Locale invalidation must cover
// that original request, not only IDs already known at the callback. Reuse
// the actual constructor callback, Store, worker serializer, and card renderer.
// Negative baseline: R16 Store SHA
// 7f373c1f399ac8fb64ba01ddc5693cadf997824f06c855c0e2fbd0863e9b3111.
async function feedFirstLocaleWinnerR17(t,{epoch="fr",reply="open",known=false}={}){
  const state=await beginLocaleSelectionR16(t,"original-board","execute");
  const target=known?state.a:await localeSelectionReceiptR16(state,"feed-first-paid-winner-r17",state.a.request);
  const result={...state,target,epoch,reply,responseFinished:false};
  t.after(async()=>{
    if(!result.responseFinished){result.responseFinished=true;result.call.gate.reject(new Error("Controlled R17 cleanup of delayed approval reply"));}
    result.f.host.closePlanningConsent();await result.reading;await result.decision;
  });
  if(epoch!=="none")state.f.host.dispatchActualLocaleChangeR16("fr");
  if(epoch==="fr-en")state.f.host.dispatchActualLocaleChangeR16("en");
  if(reply==="closed"){state.f.host.closePlanningConsent();assert.equal(await state.decision,false);}
  return result;
}
async function pollFeedFirstLocaleWinnerR17(state,{includeWinner=true,extraJobs=[]}={}){
  const{f,a,bWire,target}=state;
  const reading=f.host.syncDocumentJobs(),list=await f.take();
  assert.equal(list.url,"/api/document-jobs");assert.equal(list.init.method,"GET");
  const beforeExact=f.calls.length;
  await f.reply(list,{jobs:[...(includeWinner?[target.complete]:[]),...extraJobs,bWire]});await turn();
  // After a lost response, A is an exact recoverable approval ID but may have
  // no job: W won the atomic reuse. Feed omission must not invent another run.
  for(const captured of f.calls.slice(beforeExact)){
    const exact=await f.take();assert.equal(exact,captured);assert.equal(exact.init.method,"GET");
    assert.equal(exact.body,null);
    if(exact.url==="/api/document-jobs/"+target.id+"?inspection=1")await f.reply(exact,{job:target.complete});
    else{
      assert.notEqual(target.id,a.id);
      assert.equal(exact.url,"/api/document-jobs/"+a.id+"?inspection=1");
      await f.reply(exact,{error:"job_not_found"},404);
    }
  }
  await reading;
}
function feedFirstLocaleCardR17(state){
  const card=liveCapacityCanvasR11(state.f,state.target).cards.get(state.target.id);
  return{shown:Boolean(card),originalCopy:Boolean(card?.markup.includes(state.target.plan.interpretation))};
}
async function finishFeedFirstLocaleReplyR17(state){
  const{f,a,target}=state;state.responseFinished=true;
  if(state.reply==="lost")state.call.gate.reject(new Error("Controlled loss of original A-to-winner approval reply"));
  else await f.reply(state.call,{...target.completedBody,...(target.id===a.id?{}:{requestedExecutionId:a.id,reusedExecutionId:target.id,reused:true})});
  await state.reading;await turn();
}
function assertFeedFirstLocaleEvidenceR17(state){
  const{f,target}=state,current=f.host.documentJobs.get().find(job=>job.jobId===target.id)??f.host.inspectionJob(target.id);
  assert.ok(current,"Hidden presentation is not erased paid work");
  assert.equal(current.planningExecutionId,target.id);assert.equal(current.planningLocale,"en");
  assert.equal(current.requestKey,target.request.requestKey);assert.equal(current.documentId,target.request.documentId);
  assert.equal(current.canvasId,target.request.canvasId);assert.deepEqual(current.result.structure,target.plan);
  assert.equal(f.calls.filter(call=>call.body?.action==="execute").length,1,"Only the original mocked approval executes");
  assert.deepEqual(f.host.events.get(),[],"Presentation/recovery must not author canonical changes");
}
for(const epoch of["fr","fr-en"])for(const reply of["open","closed","lost"]){
  test("adaptive unknown winner locale R17: unknown W feed before "+reply+" original reply stays hidden through "+epoch+" epoch and repeat polling",{timeout:7000},async t=>{
    const state=await feedFirstLocaleWinnerR17(t,{epoch,reply});
    await pollFeedFirstLocaleWinnerR17(state);const first=feedFirstLocaleCardR17(state);
    await finishFeedFirstLocaleReplyR17(state);const afterReply=feedFirstLocaleCardR17(state);
    state.f.host.closePlanningConsent();assert.equal(await state.decision,false,"Stale-language recovery is not composer delivery");
    await pollFeedFirstLocaleWinnerR17(state);const second=feedFirstLocaleCardR17(state);
    await pollFeedFirstLocaleWinnerR17(state);const third=feedFirstLocaleCardR17(state);
    assertFeedFirstLocaleEvidenceR17(state);
    assert.deepEqual([first.shown,afterReply.shown,second.shown,third.shown],[false,false,false,false],
      "An unknown same-intent winner cannot bypass the old request's locale invalidation, even if its reply never arrives");
    assert.equal(document.documentElement.lang,epoch==="fr-en"?"en":"fr");
  });
}
for(const epoch of["fr","fr-en"])for(const reply of["open","closed","lost"]){
  test("adaptive unknown winner locale R17: known A "+reply+" reply control remains hidden across "+epoch,{timeout:7000},async t=>{
    const state=await feedFirstLocaleWinnerR17(t,{epoch,reply,known:true});
    await pollFeedFirstLocaleWinnerR17(state);const first=feedFirstLocaleCardR17(state);
    await finishFeedFirstLocaleReplyR17(state);
    state.f.host.closePlanningConsent();assert.equal(await state.decision,false);
    await pollFeedFirstLocaleWinnerR17(state);const after=feedFirstLocaleCardR17(state);
    assertFeedFirstLocaleEvidenceR17(state);
    assert.deepEqual([first.shown,after.shown],[false,false]);
  });
}
for(const reply of["open","closed","lost"]){
  test("adaptive unknown winner locale R17: no locale change preserves ordinary W discovery before "+reply+" reply",{timeout:7000},async t=>{
    const state=await feedFirstLocaleWinnerR17(t,{epoch:"none",reply});
    await pollFeedFirstLocaleWinnerR17(state);assert.deepEqual(feedFirstLocaleCardR17(state),{shown:true,originalCopy:true});
    await finishFeedFirstLocaleReplyR17(state);
    state.f.host.closePlanningConsent();await state.decision;
    await pollFeedFirstLocaleWinnerR17(state);assert.deepEqual(feedFirstLocaleCardR17(state),{shown:true,originalCopy:true});
    assertFeedFirstLocaleEvidenceR17(state);
  });
}
for(const epoch of["fr","fr-en"]){
  test("adaptive unknown winner locale R17: deliberate exact free W review after "+epoch+" displays its original paid language and receipt",{timeout:7000},async t=>{
    const state=await feedFirstLocaleWinnerR17(t,{epoch,reply:"lost"}),{f,target}=state;
    await pollFeedFirstLocaleWinnerR17(state);await finishFeedFirstLocaleReplyR17(state);
    f.host.closePlanningConsent();assert.equal(await state.decision,false);
    const prior=f.calls.length,reading=f.host.reviewPlanningJob(target.id),resume=await f.take();
    assert.equal(resume.body.action,"resume");assert.equal(resume.body.executionId,target.id);
    assert.equal(resume.body.locale,"en");assert.equal(Object.hasOwn(resume.body,"approvedBindingHash"),false);
    await f.reply(resume,target.completedBody);await reading;
    assert.deepEqual(f.host.planningConsent.get().request,target.request);
    assert.deepEqual(f.host.planningConsent.get().quote.privateInput,target.preview.privateInput);
    assert.deepEqual(f.host.planningConsent.get().quote.models,target.preview.models);
    assert.deepEqual(f.host.planningConsent.get().recoveredPlan,target.plan);
    assert.deepEqual(feedFirstLocaleCardR17(state),{shown:true,originalCopy:true});
    f.host.closePlanningConsent();await pollFeedFirstLocaleWinnerR17(state);
    assert.deepEqual(feedFirstLocaleCardR17(state),{shown:true,originalCopy:true},"Incidental polling must not undo the new explicit original-language choice");
    assert.deepEqual(f.calls.slice(prior).filter(call=>call.init.method==="POST").map(call=>call.body.action),["resume"]);
    assert.equal(document.documentElement.lang,epoch==="fr-en"?"en":"fr");assertFeedFirstLocaleEvidenceR17(state);
  });
}
for(const epoch of["fr","fr-en"])for(const path of["detail","omitted"]){
  test("adaptive unknown winner locale R17: incidental "+path+" proof cannot reactivate explicitly dismissed W after "+epoch,{timeout:7000},async t=>{
    const state=await feedFirstLocaleWinnerR17(t,{epoch,reply:"lost"}),{f,target}=state;
    await pollFeedFirstLocaleWinnerR17(state);await finishFeedFirstLocaleReplyR17(state);
    f.host.closePlanningConsent();await state.decision;
    // First make a genuine, new, exact original-language choice. Then execute
    // the actual rendered Dismiss control; subsequent evidence is only a read.
    const reviewing=f.host.reviewPlanningJob(target.id),resume=await f.take();
    assert.equal(resume.body.action,"resume");await f.reply(resume,target.completedBody);await reviewing;
    const card=liveCapacityCanvasR11(f,target).cards.get(target.id);assert.ok(card);card.dismiss();
    f.host.closePlanningConsent();assert.equal(feedFirstLocaleCardR17(state).shown,false);
    const prior=f.calls.length;
    if(path==="detail"){
      const reading=f.host.loadDocumentJobDetail(target.id),exact=await f.take();
      assert.equal(exact.url,"/api/document-jobs/"+target.id+"?inspection=1");
      await f.reply(exact,{job:target.complete});const result=await reading;assert.deepEqual(result.result.structure,target.plan);
    }else await pollFeedFirstLocaleWinnerR17(state,{includeWinner:false});
    assert.equal(feedFirstLocaleCardR17(state).shown,false);
    await pollFeedFirstLocaleWinnerR17(state);assert.equal(feedFirstLocaleCardR17(state).shown,false);
    assert.ok(f.calls.slice(prior).every(call=>call.init.method==="GET"));assertFeedFirstLocaleEvidenceR17(state);
  });
}

// A genuinely new explicit action after the locale boundary is different
// from an old reply arriving after it. The exact admitted ID may be shown;
// requestKey equality alone must not give a different historical plan that right.
async function currentEpochFeedWinnerR17(t,{epoch="fr",known=false}={}){
  const state=await beginLocaleSelectionR16(t,"original-board","execute",{quotePending:true}),{f,a}=state;
  f.host.dispatchActualLocaleChangeR16("fr");
  if(epoch==="fr-en")f.host.dispatchActualLocaleChangeR16("en");
  await f.reply(state.quoting,{planningRequest:a.request,quote:a.preview});await settleReplacementPreviewR13(f);
  const approve=render(f).buttons.find(button=>button.label==="planning.consent.approve"&&!button.disabled);assert.ok(approve);
  state.reading=f.host.approvePlanningConsent();state.call=await f.take();
  assert.equal(state.call.body.action,"execute");assert.equal(state.call.body.executionId,a.id);
  assert.equal(state.call.body.approvedBindingHash,a.preview.bindingHash);
  const target=known?a:await localeSelectionReceiptR16(state,"current-epoch-verified-winner-r17",a.request);
  const result={...state,target,epoch,reply:"open",responseFinished:false};
  t.after(async()=>{
    if(!result.responseFinished){result.responseFinished=true;result.call.gate.reject(new Error("Controlled R17 current-epoch cleanup"));}
    f.host.closePlanningConsent();await result.reading;await result.decision;
  });
  return result;
}
for(const epoch of["fr","fr-en"]){
  test("adaptive unknown winner locale R17: fresh explicit exact A handoff after "+epoch+" survives feed-first completion and lost reply",{timeout:7000},async t=>{
    const state=await currentEpochFeedWinnerR17(t,{epoch,known:true});state.reply="lost";
    await pollFeedFirstLocaleWinnerR17(state);assert.deepEqual(feedFirstLocaleCardR17(state),{shown:true,originalCopy:true});
    await finishFeedFirstLocaleReplyR17(state);state.f.host.closePlanningConsent();await state.decision;
    await pollFeedFirstLocaleWinnerR17(state);assert.deepEqual(feedFirstLocaleCardR17(state),{shown:true,originalCopy:true});
    assertFeedFirstLocaleEvidenceR17(state);
  });
  test("adaptive unknown winner locale R17: fully verified fresh A-to-W receipt after "+epoch+" permits W without relabeling its original language",{timeout:7000},async t=>{
    const state=await currentEpochFeedWinnerR17(t,{epoch});
    await finishFeedFirstLocaleReplyR17(state);assert.equal(await state.decision,true);
    assert.deepEqual(feedFirstLocaleCardR17(state),{shown:true,originalCopy:true});
    const review=state.f.host.planningConsent.get();assert.equal(review.recoveryExecutionId,state.target.id);
    assert.deepEqual(review.request,state.target.request);assert.deepEqual(review.quote.privateInput,state.target.preview.privateInput);
    state.f.host.closePlanningConsent();await pollFeedFirstLocaleWinnerR17(state);
    assert.deepEqual(feedFirstLocaleCardR17(state),{shown:true,originalCopy:true});assertFeedFirstLocaleEvidenceR17(state);
  });
  test("adaptive unknown winner locale R17: older same-key predecessor cannot inherit fresh A or verified W presentation after "+epoch,{timeout:7000},async t=>{
    const state=await currentEpochFeedWinnerR17(t,{epoch}),{f,a,target}=state;
    const predecessor=await localeSelectionReceiptR16(state,"different-paid-predecessor-r17",a.request);
    assert.equal(predecessor.request.requestKey,a.request.requestKey);
    assert.notEqual(predecessor.preview.sourceHash,a.preview.sourceHash);
    assert.notDeepEqual(predecessor.preview.models,a.preview.models);
    await pollFeedFirstLocaleWinnerR17({...state,target:predecessor});
    const predecessorBefore=feedFirstLocaleCardR17({...state,target:predecessor});
    await finishFeedFirstLocaleReplyR17(state);assert.equal(await state.decision,true);
    f.host.closePlanningConsent();await pollFeedFirstLocaleWinnerR17(state,{extraJobs:[predecessor.complete]});
    assert.deepEqual(feedFirstLocaleCardR17(state),{shown:true,originalCopy:true});
    assert.deepEqual([predecessorBefore.shown,feedFirstLocaleCardR17({...state,target:predecessor}).shown],[false,false],
      "Same intent is not proof of the chosen paid source/model/execution");
    assertFeedFirstLocaleEvidenceR17(state);
    assert.equal(f.host.documentJobs.get().find(job=>job.jobId===predecessor.id)?.planningExecutionId,predecessor.id);
    assert.notEqual(predecessor.id,target.id);
  });
}
test("adaptive unknown winner locale R17: current exact-A permission survives a full supported Activity page and omitted completion",{timeout:15000},async t=>{
  const state=await currentEpochFeedWinnerR17(t,{epoch:"fr",known:true}),{f,a,bWire}=state;
  state.responseFinished=true;await f.reply(state.call,a.pendingBody,202);await state.reading;
  assert.equal(await state.decision,true);assert.equal(f.host.planningConsent.get(),null);
  assert.equal(feedFirstLocaleCardR17(state).shown,false,"Pending A has no invented completed card");
  const saved={executionId:a.id,request:a.request,originalPlan:a.plan,originalQuote:a.completedQuote,originalJob:a.complete,body:a.completedBody};
  const neighbors=await adaptiveCapacityNeighborsR8(saved,adaptiveActivityCapacityR8()-1),page=[...neighbors,bWire];
  assert.equal(page.length,adaptiveActivityCapacityR8());assert.ok(!page.some(job=>job.jobId===a.id));
  for(const original of[a.pending,a.complete,a.complete]){
    const polling=f.host.syncDocumentJobs(),list=await f.take();assert.equal(list.url,"/api/document-jobs");
    const cursor=f.calls.length;await f.reply(list,{jobs:page});await turn();
    const reads=f.calls.slice(cursor);let foundOriginal=false;
    for(const recorded of reads){
      const exact=await f.take();assert.equal(exact,recorded);assert.equal(exact.init.method,"GET");
      assert.equal(exact.body,null);assert.equal(exact.url,"/api/document-jobs/"+a.id+"?inspection=1");
      foundOriginal=true;await f.reply(exact,{job:original});
    }
    await polling;assert.equal(foundOriginal,true,"Page churn must retain the exact permitted A recovery handle even before any card exists");
    assert.equal(feedFirstLocaleCardR17(state).shown,original.status==="completed");
    assert.equal(f.host.planningConsent.get(),null);assert.equal(f.host.documentJobs.get().length,page.length);
    assert.ok(!f.host.documentJobs.get().some(job=>job.jobId===a.id),"Exact recovery must not fabricate a feed row");
  }
  assert.deepEqual(feedFirstLocaleCardR17(state),{shown:true,originalCopy:true});
  assert.deepEqual(f.calls.filter(call=>call.init.method==="POST").map(call=>call.body.action),["resume","quote","execute"]);
  assertFeedFirstLocaleEvidenceR17(state);
});

// R18: drive the actual bootstrap and main as ES modules. Only the catalog,
// CSS and dynamic application component are deterministic ports. In particular,
// a top-level await must really delay the entry that constructs the existing
// actual-method Store fixture; tests never force that constructor ahead of it.
// Frozen R17 bootstrap SHA:
// 5ffc8f47aaadb61524adfc66ef8619a8b671fe336096b0dd59828511c6b2d052.
const bootstrapModuleUrlR18=source=>"data:text/javascript;base64,"+Buffer.from(source).toString("base64");
function replaceBootstrapSpecifierR18(source,specifier,replacement){
  const original=JSON.stringify(specifier);
  assert.ok(source.includes(original),"The production module still imports "+specifier);
  return source.replaceAll(original,JSON.stringify(replacement));
}
async function actualLocaleBootstrapR18(t,locale,{preference="saved",catalogFirst=false,catalogFailure=false}={}){
  const localizationSyntax=parse("../src/components/design-system/localization.ts");
  const actualFunctions=["canonicalLocale","formaLocaleFamily","localeDirection","safeTimeZone","setFormaLocale","initializeFormaLocale"].map(name=>{
    const node=localizationSyntax.statements.find(candidate=>ts.isFunctionDeclaration(candidate)&&candidate.name?.text===name);
    assert.ok(node,"Use the actual localization function "+name);
    return node.getText(localizationSyntax).replace(/^export\s+/u,"");
  }).join("\n");
  const {FORMA_SUPPORTED_LOCALES}=await import("../src/components/design-system/language-options.ts");
  const {applicationIdFromRoute}=await import("../src/platform/applications.ts");
  const storage=preference==="saved"?new Map([["forma:locale",locale]]):new Map();
  const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  const navigator={languages:preference==="browser"?[locale]:["en"]};
  const gate=deferred(),catalogStarted=deferred(),entry=deferred();
  const catalogFor=async requested=>{
    if(requested===locale){catalogStarted.resolve();return gate.promise;}
    return Object.freeze({...FORMA_DEFAULT_MESSAGES,...stopLocaleCatalogs[requested.split("-")[0]]});
  };
  const RTL_SCRIPTS=new Set(["Adlm","Arab","Hebr","Mand","Mend","Nkoo","Rohg","Samr","Syrc","Thaa"]);
  const timeZones=new Map(),subscribers=new Set(),STORAGE_KEY="forma:locale";
  let defaultTimeZone="",requestedRevision=0;
  let active={locale:"en",formatLocale:"en",direction:"ltr",timeZone:"UTC",messages:FORMA_DEFAULT_MESSAGES,revision:0};
  const initializer=eval(stripTypeScriptTypes("(function(){"+actualFunctions+";return {initializeFormaLocale,setFormaLocale};})()"));
  const previousLanguage=document.documentElement.lang,previousDirection=document.documentElement.dir;
  const previousDispatch=document.dispatchEvent,previousQuery=document.querySelector;
  document.documentElement.lang="en";document.documentElement.dir="ltr";
  const events=[];let f,entryLanguage="",entryModule="",released=false,evaluation;
  document.querySelector=()=>null;
  document.dispatchEvent=event=>{
    events.push({type:event.type,detail:event.detail,storeAlreadyStarted:Boolean(f)});
    if(f&&event.type==="forma-locale-change")f.host.dispatchActualLocaleChangeR16(event.detail.locale);
    return true;
  };
  const releaseCatalog=()=>{
    if(released)return;released=true;
    if(catalogFailure)gate.reject(new Error("Controlled initial locale catalog failure"));
    else gate.resolve(Object.freeze({...FORMA_DEFAULT_MESSAGES,...stopLocaleCatalogs[locale]}));
  };
  const portKey="__formaLocaleBootstrapR18_"+crypto.randomUUID().replaceAll("-","");
  const port={
    document,location:{pathname:"/canvas/original-board"},applicationIdFromRoute,
    initializeFormaLocale:()=>initializer.initializeFormaLocale(),
    enterApplication(module){
      assert.equal(f,undefined,"Only the actual selected dynamic application entry constructs Store");
      entryModule=module;entryLanguage=document.documentElement.lang;
      f=fixture(t,"en",{polling:true});entry.resolve(f);
    },
  };
  Object.defineProperty(globalThis,portKey,{configurable:true,value:port});
  t.after(async()=>{
    releaseCatalog();await evaluation?.catch(()=>{});
    if(f)f.host.closePlanningConsent();
    delete globalThis[portKey];
    document.documentElement.lang=previousLanguage;
    if(previousDirection===undefined)delete document.documentElement.dir;else document.documentElement.dir=previousDirection;
    if(previousDispatch===undefined)delete document.dispatchEvent;else document.dispatchEvent=previousDispatch;
    if(previousQuery===undefined)delete document.querySelector;else document.querySelector=previousQuery;
  });
  const portExpression="globalThis["+JSON.stringify(portKey)+"]";
  const localizationModule=bootstrapModuleUrlR18("export const initializeFormaLocale=()=>"+portExpression+".initializeFormaLocale();");
  const bootstrapText=readFileSync(new URL("../src/components/design-system/locale-bootstrap.ts",import.meta.url),"utf8");
  const bootstrapModule=bootstrapModuleUrlR18(stripTypeScriptTypes(replaceBootstrapSpecifierR18(bootstrapText,"./localization",localizationModule)));
  const applicationsModule=bootstrapModuleUrlR18("export const applicationIdFromRoute="+portExpression+".applicationIdFromRoute;");
  const emptyCss=bootstrapModuleUrlR18("export {};");
  let main=stripTypeScriptTypes(readFileSync(new URL("../src/main.ts",import.meta.url),"utf8"));
  for(const css of["./styles.css","./design-system.css","./responsive-foundation.css"])main=replaceBootstrapSpecifierR18(main,css,emptyCss);
  main=replaceBootstrapSpecifierR18(main,"./components/design-system/locale-bootstrap",bootstrapModule);
  main=replaceBootstrapSpecifierR18(main,"./platform/applications",applicationsModule);
  for(const module of["./apps/public-share/entry","./components/forma-platform-shell","./components/forma-shell"]){
    const applicationModule=bootstrapModuleUrlR18(portExpression+".enterApplication("+JSON.stringify(module)+");export {};");
    main=replaceBootstrapSpecifierR18(main,module,applicationModule);
  }
  main="const document="+portExpression+".document;const location="+portExpression+".location;\n"+main;
  if(catalogFirst)releaseCatalog();
  evaluation=import(bootstrapModuleUrlR18(main));
  await catalogStarted.promise;
  // Allow a non-awaited bootstrap to finish its real ES-module continuation.
  // All module dependencies here are in-memory; the catalog is the sole held port.
  for(let index=0;index<8;index++)await turn();
  const enteredBeforeCatalogRelease=Boolean(f)&&!released;
  releaseCatalog();await evaluation;await entry.promise;
  assert.equal(entryModule,"./components/forma-shell","The production Canvas route chooses its actual creative shell branch");
  return{f,locale,preference,catalogFirst,catalogFailure,events,entryLanguage,enteredBeforeCatalogRelease,
    get activeLocale(){return active.locale;},changeLocale:value=>initializer.setFormaLocale(value)};
}
async function retainedBootstrapPlanR18(state){
  const {f}=state;
  const original=await retainedActivity(f,{reader:false,canvasId:"original-board"});
  const locale=state.catalogFailure?"en":state.locale;
  const request={...original.request,locale,prompt:"Previously paid saved "+locale+" planning intent",requestKey:""};
  request.requestKey=await adaptiveRequestKey(request);
  const saved=await localeSelectionReceiptR16({f,b:original},"saved-bootstrap-"+locale+"-r18",request);
  f.host.documentJobs.set([]);f.host.adaptiveStructures.set({});f.host.adaptiveSuggestionSets.set({});
  const session=f.host.session.get();
  f.host.session.set({...session,projectContext:{...session.projectContext,permissions:[...session.projectContext.permissions,"project.canvas.use"]}});
  f.host.projection.set({...f.host.projection.get(),documentId:"doc-a"});
  f.host.route.set("/canvas/original-board");f.host.canvasProjection.set({selectedCanvasId:"original-board"});
  return saved;
}
async function pollBootstrapPlanR18(state,saved){
  const {f}=state,polling=f.host.syncDocumentJobs(),list=await f.take();
  assert.equal(list.url,"/api/document-jobs");assert.equal(list.init.method,"GET");
  await f.reply(list,{jobs:[saved.complete]});await polling;
}
function bootstrapPlanShownR18(state,saved){
  return liveCapacityCanvasR11(state.f,saved).cards.has(saved.id);
}
function assertBootstrapFreeR18(state,{recovery=false}={}){
  assert.deepEqual(state.f.host.events.get(),[]);
  assert.deepEqual(state.f.calls.filter(call=>call.init.method==="POST").map(call=>call.body.action),recovery?["resume"]:[]);
  assert.equal(state.f.calls.some(call=>["quote","execute"].includes(call.body?.action)),false);
}
for(const locale of["fr","ja","ar"])for(const preference of["saved","browser"])for(const catalogFirst of[false,true]){
  test("adaptive locale bootstrap R18: "+preference+" "+locale+" "+(catalogFirst?"catalog-first control":"delayed catalog")+" preserves initial paid Canvas discovery",{timeout:7000},async t=>{
    const state=await actualLocaleBootstrapR18(t,locale,{preference,catalogFirst});
    const saved=await retainedBootstrapPlanR18(state);
    await pollBootstrapPlanR18(state,saved);
    assert.equal(bootstrapPlanShownR18(state,saved),true,"Restoring a saved/browser locale is not a user dismissal of an existing paid plan");
    assert.equal(state.enteredBeforeCatalogRelease,false,"The actual main module must wait for its bootstrap dependency");
    assert.equal(state.entryLanguage,locale);assert.equal(state.activeLocale,locale);
    assert.equal(document.documentElement.lang,locale);assert.equal(saved.request.locale,locale);
    assert.deepEqual(state.events.map(event=>[event.type,event.storeAlreadyStarted]),[["forma-locale-change",false]]);
    assert.ok(state.f.host.documentJobs.get().some(job=>job.jobId===saved.id&&job.result?.structure));
    assertBootstrapFreeR18(state);
  });
}
for(const locale of["fr","ja","ar"]){
  test("adaptive locale bootstrap R18: unavailable "+locale+" initial catalog still starts a usable English application",{timeout:7000},async t=>{
    const state=await actualLocaleBootstrapR18(t,locale,{catalogFailure:true});
    const saved=await retainedBootstrapPlanR18(state);
    await pollBootstrapPlanR18(state,saved);
    assert.equal(state.entryLanguage,"en");assert.equal(state.activeLocale,"en");assert.equal(document.documentElement.lang,"en");
    assert.deepEqual(state.events.map(event=>event.type),["forma-locale-error"]);
    assert.equal(bootstrapPlanShownR18(state,saved),true,"English fallback is usable, not permanently blocked on the catalog");
    assertBootstrapFreeR18(state);
  });
  test("adaptive locale bootstrap R18: real post-start "+locale+" to English change still fences unknown historical work until exact free recovery",{timeout:7000},async t=>{
    const state=await actualLocaleBootstrapR18(t,locale,{catalogFirst:true}),saved=await retainedBootstrapPlanR18(state),{f}=state;
    // No initial feed has disclosed this original ID. Only the real subsequent
    // setter emits a post-start event; bootstrap ordering is not bypassed.
    await state.changeLocale("en");
    assert.equal(state.activeLocale,"en");assert.equal(document.documentElement.lang,"en");
    assert.deepEqual(state.events.map(event=>[event.type,event.storeAlreadyStarted]),[["forma-locale-change",false],["forma-locale-change",true]]);
    await pollBootstrapPlanR18(state,saved);
    assert.equal(bootstrapPlanShownR18(state,saved),false,"An unknown old-language paid result cannot bypass a genuine later language choice");
    const inspecting=f.host.loadDocumentJobDetail(saved.id),detail=await f.take();
    assert.equal(detail.url,"/api/document-jobs/"+saved.id+"?inspection=1");
    await f.reply(detail,{job:saved.complete});await inspecting;
    assert.equal(bootstrapPlanShownR18(state,saved),false,"Incidental private proof is not a renewed presentation choice");
    const reading=f.host.reviewPlanningJob(saved.id),resume=await f.take();
    assert.equal(resume.body.action,"resume");assert.equal(resume.body.executionId,saved.id);assert.equal(resume.body.locale,locale);
    await f.reply(resume,saved.completedBody);await reading;
    assert.equal(bootstrapPlanShownR18(state,saved),true);
    assert.deepEqual(f.host.planningConsent.get().request,saved.request);
    assert.deepEqual(f.host.planningConsent.get().quote.privateInput,saved.preview.privateInput);
    assert.deepEqual(f.host.planningConsent.get().quote.models,saved.preview.models);
    f.host.closePlanningConsent();await pollBootstrapPlanR18(state,saved);
    assert.equal(bootstrapPlanShownR18(state,saved),true,"The later deliberate original-language selection persists through ordinary polling");
    assert.equal(document.documentElement.lang,"en","Recovering paid work never relabels it as a new-language generation");
    assertBootstrapFreeR18(state,{recovery:true});
  });
}
