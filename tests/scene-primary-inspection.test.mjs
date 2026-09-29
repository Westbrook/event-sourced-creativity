import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { pendingCheckpoint } from "./helpers/scene-pilot-fixture.mjs";
import frMessages from "../src/components/design-system/locales/fr.ts";
import enMessages from "../src/components/design-system/locales/system-en.ts";

// Real R5 composer, Store, Worker, LocaleController and input component. Only
// test registration is omitted; no production method or read is substituted.
const fixtureUrl=new URL("./scene-policy-stop-guidance.test.mjs",import.meta.url);
const fixtureSource=fs.readFileSync(fixtureUrl,"utf8"),tree=ts.createSourceFile(fixtureUrl.pathname,fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const source=tree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)
  ||ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(tree)==="hook.deregister")
  .map(node=>node.getFullText(tree)).join("\n")
  +"\nexport {policyComposer,failureCard,controls,text,copy,copyReceiptEvidence,inspectFailure,receiptComponent,receiptReady,closeReceipt,settle,invoke,untilScene,pilotStatus,recertifySession,action,sceneIdle,sceneSubmitted,paidRequests,jobRow,loadActual};\n";
const fixtureModuleUrl=new URL("./scene-primary-inspection-fixture.mjs",import.meta.url).href;
const hook=registerHooks({resolve(specifier,context,next){return specifier===fixtureModuleUrl?{url:fixtureModuleUrl,shortCircuit:true}:next(specifier,context);},
  load(url,context,next){return url===fixtureModuleUrl?{format:"module",source,shortCircuit:true}:next(url,context);}});
const {policyComposer,failureCard,controls,text,copy,copyReceiptEvidence,inspectFailure,receiptComponent,receiptReady,closeReceipt,settle,invoke,untilScene,pilotStatus,recertifySession,action,sceneIdle,sceneSubmitted,paidRequests,jobRow,loadActual}=await import(fixtureModuleUrl);
hook.deregister();
const {FormaLocaleController,FORMA_DEFAULT_MESSAGES}=await loadActual("src/components/design-system/localization.ts");
function changeLocale(f){
  const locale=f.i18n.locale==="en"?"fr":"en",previous=f.i18n;
  const controller=new FormaLocaleController({addController(){},requestUpdate(){},dispatchEvent(event){
    event.callback({locale,formatLocale:locale,direction:"ltr",timeZone:"UTC",messages:{...FORMA_DEFAULT_MESSAGES,...(locale==="fr"?frMessages:enMessages)},revision:3},()=>{});return true;
  }});
  controller.hostConnected();previous.hostDisconnected();f.i18n=controller;f.host.i18n=controller;f.locale=locale;f.draw();
}
const contextPattern={en:"Document {document} · request {request}",fr:"Document {document} · demande {request}",ar:"المستند {document} · الطلب {request}",ja:"ドキュメント {document} · リクエスト {request}"};
const contextName=(locale,document,id)=>contextPattern[locale].replace("{document}","\u2068"+document+"\u2069").replace("{request}","\u2068"+id+"\u2069");

const primary=f=>failureCard(f).buttons.find(button=>button.attributes.class==="button primary compact");
const inputOpen=f=>Boolean(receiptComponent(f)?.open);
const composer=f=>f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class==="document-artifact-create");
const inspectionPath=id=>"/api/document-jobs/"+encodeURIComponent(id)+"?inspection=1";
const privatePath=id=>"/api/document-jobs/"+encodeURIComponent(id)+"/private-receipt";
async function start(f,button=primary(f)){
  assert.ok(button);const completion=Promise.resolve(button.handlers.click.call(f.host,{target:button,currentTarget:button}));
  await settle(f);return{completion};
}
async function fixture(t,options){
  const current=await policyComposer(t,options);
  const {worker,h}=current;
  // Relative component requests use the same actual source Worker. Every
  // external/provider request after the zero-dispatch stop is forbidden.
  t.mock.method(globalThis,"fetch",async(url,init)=>{assert.ok(String(url).startsWith("/api/"),"no provider or external network");return worker.request(String(url),init);});
  // A real dialog retains its node and native open state while Lit updates the
  // same component/template. Only this native node port is extended: later
  // events consult that node's CURRENT listener, including a queued old close.
  const f=current.f,collect=f.renderer.collect;
  f.renderer.collect=function(markup,owner){
    const first=this.nodes.length;collect.call(this,markup,owner);
    for(let index=first;index<this.nodes.length;index++){
      const node=this.nodes[index];
      if(node.tag!=="dialog"||node.attributes.class!=="generation-input-dialog")continue;
      const previous=this.previousNodes?.find(candidate=>candidate.owner===owner&&candidate.tag==="dialog"
        &&candidate.attributes.class===node.attributes.class);
      if(previous){
        for(const key of ["attributes","properties","handlers","full","value","checked"])previous[key]=node[key];
        this.nodes[index]=previous;
      }
    }
  };
  h.intercept=null;assert.equal(current.calls.length,0);return current;
}
async function warmPersonal(h,id,{detail=true}={}){
  const retained=JSON.parse(h.worker.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(id).result_json).generationReceipt.input_ref;
  if(detail)await h.store.loadDocumentJobDetail(id);
  await h.store.ensurePrivateContent(retained);
  assert.equal(typeof h.store.content.get()[retained],"string");return{retained,raw:h.store.content.get()[retained]};
}
function noPrivate(f,privateSource=""){
  assert.equal(inputOpen(f),false,"no private input dialog is published before a fresh owned read");
  assert.equal(Boolean(receiptComponent(f)?.inspection?.receipt?.job),false,"a closed dialog must not retain the old job receipt either");
  if(privateSource)assert.equal(f.host.markup.includes(privateSource),false,"old private bytes are not rendered");
}
function names(f){
  return[...f.host.markup.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gu)]
    .filter(([,raw])=>String(f.renderer.attrs(raw).attributes.class??"").split(/\s+/u).includes("document-artifact-failure-card"))
    .map(([,raw,body])=>{const button=controls(f,body,"button").find(item=>item.attributes.class==="button primary compact");
      const heading=body.match(/<h3\b([^>]*)>([\s\S]*?)<\/h3>/u);
      return{body,attributes:f.renderer.attrs(raw).attributes,button,heading:heading?{...f.renderer.attrs(heading[1]),text:text(heading[2])}:null};});
}

for(const status of [403,404,410])test("Scene primary personal: warm detail and private cache cannot bypass fresh "+status,async t=>{
  const {h,f,id,worker,calls}=await fixture(t,{shared:false});const warm=await warmPersonal(h,id);await settle(f);
  const before=worker.counts(),row=jobRow(worker,id),requests=h.requests.length;let denied=0,bodyReads=0;
  h.intercept=async request=>request.url===inspectionPath(id)?(denied++,{ok:false,status,json:async()=>{bodyReads++;throw new Error("denial body must not be needed");}}):undefined;
  const {completion}=await start(f);await completion;await settle(f);
  assert.equal(denied,1,"even a warm exact job requires a new server read");assert.equal(bodyReads,0);
  noPrivate(f);assert.equal(h.store.content.get()[warm.retained],warm.raw,"the shared Store cache is not the presentation authority");
  assert.equal(h.store.ui.toast,f.i18n.t("scene.cost.unavailable"));
  assert.deepEqual(worker.counts(),before);assert.deepEqual(jobRow(worker,id),row);assert.equal(calls.length,0);
  assert.equal(h.requests.slice(requests).every(request=>!request.init?.method||request.init.method==="GET"),true);
});

test("Scene primary personal: cold detail with warm private bytes stays empty through pending read and denial",async t=>{
  const {h,f,id,worker}=await fixture(t,{shared:false});const warm=await warmPersonal(h,id,{detail:false});await settle(f);
  const gate=sceneDeferred(),entered=sceneDeferred();t.after(()=>gate.resolve(Response.json({error:"not_available"},{status:404})));
  h.intercept=async request=>{if(request.url===inspectionPath(id)){entered.resolve();return gate.promise;}};
  const {completion}=await start(f);await entered.promise;
  const pendingOpen=inputOpen(f),pendingText=receiptComponent(f)?.inspection?.prompt??"";
  gate.resolve(Response.json({error:"not_available"},{status:404}));await completion;await settle(f);
  assert.equal(pendingOpen,false,"cached source must not appear while the exact lookup is pending");
  assert.equal(pendingText,"");noPrivate(f);assert.equal(h.store.content.get()[warm.retained],warm.raw);
  assert.equal(worker.counts().document_jobs,1);
});

test("Scene primary shared: a late private receipt cannot overlay a newer Short-story composer",async t=>{
  const {h,f,id}=await fixture(t,{shared:true}),gate=sceneDeferred(),entered=sceneDeferred();let retained;
  t.after(()=>gate.resolve(retained));
  h.intercept=async request=>{if(request.url===privatePath(id)){const response=await h.worker.request(request.url,request.init);retained=await response.json();entered.resolve();return{ok:true,status:200,json:()=>gate.promise};}};
  const {completion}=await start(f);await entered.promise;const pendingOpen=inputOpen(f);
  assert.equal(await f.host.openRender("short_story",h.request.documentId,{current:()=>f.state.canRead}),true);f.draw();
  const startTrace=f.trace.length;assert.ok(composer(f)?.open);
  gate.resolve(retained);await completion;await settle(f);
  noPrivate(f);assert.equal(pendingOpen,false,"the earlier pending lookup has no private placeholder");assert.ok(composer(f)?.open,"the newer composer remains open");
  assert.equal(f.trace.slice(startTrace).some(value=>value==="open:generation-input-dialog"||value.startsWith("focus:")),false,"late private completion cannot steal focus");
});

for(const locale of ["en","fr","ar","ja"])test("Scene primary "+locale+": exact request names preserve the visible phrase and bidirectional identity",async t=>{
  const {h,f,id}=await fixture(t,{locale,shared:false});const cards=names(f);assert.equal(cards.length,1);
  const card=cards[0],label=card.button.attributes["aria-label"],heading=card.heading.attributes["aria-label"];
  assert.ok(label?.startsWith(copy(locale,3)+" · "));assert.ok(heading?.startsWith(card.heading.text+" · "));
  for(const name of [label,heading]){assert.ok(name.includes("\u2068"+id+"\u2069"));assert.ok(name.includes("\u2068"+h.request.documentId+"\u2069"));}
  assert.equal(label,copy(locale,3)+" · "+contextName(locale,h.request.documentId,id));
  assert.equal(card.button.text,copy(locale,3));assert.ok(card.body.includes(id),"the exact request is also visible");
  const component=await inspectFailure(f,failureCard(f));assert.equal(component.inspection.receipt.job.job_id,id);
  await copyReceiptEvidence(f,component,structuredClone(component.inspection));
});


for(const locale of ["en","fr","ar","ja"])for(const shared of [false,true])
test("Scene primary "+locale+"/"+(shared?"shared":"personal")+": fresh denial or erased private input never reuses an earlier receipt",async t=>{
  const {worker,h,f,id,calls}=await fixture(t,{locale,shared});
  const original=await inspectFailure(f,failureCard(f)),expected=structuredClone(original.inspection);await closeReceipt(f);
  const reference=JSON.parse(jobRow(worker,id).result_json).generationReceipt.input_ref;assert.equal(typeof reference,"string");
  const stored=worker.sqlite.prepare("SELECT redacted_at,expires_at FROM private_content WHERE content_id=?").get(reference);assert.ok(stored);
  if(!shared)await warmPersonal(h,id);await settle(f);
  for(const boundary of [401,403,404,410,"erased","expired"])await t.test(String(boundary),async()=>{
    let denied=0,bodyReads=0;
    if(boundary==="erased")worker.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(),reference);
    if(boundary==="expired")worker.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(new Date(Date.now()-1000).toISOString(),reference);
    h.intercept=async request=>{
      const privateRead=shared?request.url===privatePath(id):request.url.startsWith("/api/events?")&&request.url.includes("content=1");
      return typeof boundary==="number"&&privateRead?(denied++,{ok:false,status:boundary,json:async()=>{bodyReads++;throw new Error("denial is already in the headers");}}):undefined;
    };
    const counts=worker.counts(),row=jobRow(worker,id),cache=structuredClone(h.store.content.get()),feed=structuredClone(h.store.documentJobs.get()),requestCount=h.requests.length;
    try{
      const {completion}=await start(f);await completion;await settle(f);noPrivate(f);
      assert.equal(h.store.ui.toast,f.i18n.t("scene.cost.unavailable"));
      if(typeof boundary==="number"){assert.equal(denied,1);assert.equal(bodyReads,0);}
      assert.equal(h.requests[requestCount].url,inspectionPath(id),"the exact current job is inspected even when its metadata was warm");
      assert.deepEqual(h.store.content.get(),cache);assert.deepEqual(h.store.documentJobs.get(),feed,"fresh inspection has no feed cache write");
      assert.deepEqual(worker.counts(),counts);assert.deepEqual(jobRow(worker,id),row);assert.equal(calls.length,0);assert.equal(paidRequests(h).length,1);
      assert.equal(h.requests.slice(requestCount).every(request=>!request.init?.method||request.init.method==="GET"),true);
    }finally{
      h.intercept=null;worker.sqlite.prepare("UPDATE private_content SET redacted_at=?,expires_at=? WHERE content_id=?").run(stored.redacted_at,stored.expires_at,reference);
    }
    const recovered=await inspectFailure(f,failureCard(f));assert.deepEqual(recovered.inspection,expected,"a deliberate current read still opens the original immutable receipt");
    await copyReceiptEvidence(f,recovered,expected);await closeReceipt(f);
  });
});

async function secondPolicyJob({worker,h,f}){
  if(worker.sharing)await pilotStatus(worker,"active");
  else worker.sqlite.prepare("UPDATE budget_counters SET hard_limit_tokens=1000000 WHERE scope='user' AND scope_id=?").run(worker.actorUserId);
  await recertifySession(h);await f.openScene();await f.check();
  const next=action(f,"scene.cost.new");assert.ok(next,"the existing server-certified unused continuation is explicit");
  await invoke(f,next);await sceneIdle(f);const before=worker.counts().document_jobs;
  await f.submit();await untilScene(()=>worker.counts().document_jobs===before+1);await sceneSubmitted(f);
  const id=paidRequests(h).at(-1).body.payload.sceneRequestId;let paused=false;
  worker.controls.beforeRun=async statement=>{if(paused||!pendingCheckpoint(statement))return;paused=true;
    if(worker.sharing)worker.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run(worker.cohort.cohortId);
    else worker.sqlite.prepare("UPDATE budget_counters SET hard_limit_tokens=1 WHERE scope='user' AND scope_id=?").run(worker.actorUserId);
  };
  const response=await worker.request("/api/document-jobs/"+encodeURIComponent(id)+"/run",worker.json({})),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.job.errorDetail.code,"scene_paid_authority_changed");assert.equal(paused,true);
  await h.store.syncDocumentJobs();await settle(f);return id;
}
for(const locale of ["en","fr","ar","ja"])for(const shared of [false,true])
test("Scene primary "+locale+"/"+(shared?"shared":"personal")+": two same-title cards name and open only their own exact request",async t=>{
  const current=await fixture(t,{locale,shared}),{h,f,id,worker,calls}=current,second=await secondPolicyJob(current);
  const rendered=names(f);assert.equal(rendered.length,2);assert.equal(new Set(rendered.map(card=>card.heading.text)).size,1,"the visible guidance remains the same");
  assert.equal(new Set(rendered.map(card=>card.button.attributes["aria-label"])).size,2);
  assert.equal(new Set(rendered.map(card=>card.heading.attributes["aria-label"])).size,2);
  const refreshedAt=new Date(Date.parse(jobRow(worker,id).updated_at)+1).toISOString();
  worker.sqlite.prepare("UPDATE document_jobs SET updated_at=? WHERE job_id=?").run(refreshedAt,id);
  const originalFeed=h.store.documentJobs.get().find(job=>job.jobId===id);assert.notEqual(originalFeed.updatedAt,refreshedAt);
  let freshVersionSeen=false;
  h.intercept=async request=>{if(request.url===inspectionPath(id)){const response=await worker.request(request.url,request.init),body=await response.clone().json();assert.equal(body.job.updatedAt,refreshedAt);freshVersionSeen=true;return response;}};
  const snapshots=[id,second].map(request=>jobRow(worker,request)),counts=worker.counts();
  for(const requestId of [id,second]){
    const card=names(f).find(item=>item.button.attributes["aria-label"]?.includes("\u2068"+requestId+"\u2069"));assert.ok(card);
    const context=contextName(locale,h.request.documentId,requestId);
    assert.equal(card.button.attributes["aria-label"],copy(locale,3)+" · "+context);
    assert.equal(card.heading.attributes["aria-label"],copy(locale,0)+" · "+context);
    assert.ok(text(card.body).includes(context),"visible context is localized and bidi-isolated too");
    const {completion}=await start(f,card.button);await completion;await receiptReady(f);
    const component=receiptComponent(f);assert.equal(component.inspection.receipt.job.job_id,requestId);
    assert.equal(component.inspection.receipt.job.document_id,h.request.documentId);
    await copyReceiptEvidence(f,component,structuredClone(component.inspection));await closeReceipt(f);
  }
  assert.equal(freshVersionSeen,true,"a legitimate newer receipt for the same exact request is accepted");
  assert.deepEqual([id,second].map(request=>jobRow(worker,request)),snapshots);assert.deepEqual(worker.counts(),counts);assert.equal(calls.length,0);
  assert.equal(paidRequests(h).length,2,"inspection never adds a paid request");
});

for(const shared of [false,true])for(const boundary of ["composer","viewer","route","document","authorization","locale","disconnect","dismiss"])
test("Scene primary "+(shared?"shared":"personal")+": "+boundary+" supersedes a pending exact read without private publication or focus theft",async t=>{
  const {worker,h,f,id}=await fixture(t,{shared}),gate=sceneDeferred(),entered=sceneDeferred();let retained;
  t.after(()=>gate.resolve(retained));
  h.intercept=async request=>{if(request.url===inspectionPath(id)){const response=await worker.request(request.url,request.init);retained=await response.json();entered.resolve();return{ok:true,status:200,json:()=>gate.promise};}};
  const {completion}=await start(f);await entered.promise;const pendingOpen=inputOpen(f);
  if(boundary==="composer")assert.equal(await f.host.openRender("short_story",h.request.documentId,{current:()=>f.state.canRead}),true);
  if(boundary==="viewer")assert.equal(await f.host.openArtifactById(h.request.workflowSources[0].outputId),true);
  if(boundary==="route")h.store.route.set("/library");
  if(boundary==="document"){f.host.documentId="another-document";f.changed=new Map([["documentId",h.request.documentId]]);}
  if(boundary==="authorization"){h.setSession({permissionEpoch:"withdrawn-current-epoch"});f.withdraw();}
  if(boundary==="locale")changeLocale(f);
  if(boundary==="disconnect"){f.host.disconnectedCallback();f.host.isConnected=false;}
  if(boundary==="dismiss")assert.equal(await h.store.dismissDocumentJobFailure(id),true);
  f.draw();const startTrace=f.trace.length;
  gate.resolve(retained);await completion;await settle(f);
  assert.equal(pendingOpen,false);noPrivate(f);
  assert.equal(f.trace.slice(startTrace).some(value=>value==="open:generation-input-dialog"||value.startsWith("focus:")),false);
  if(boundary==="composer")assert.ok(composer(f)?.open);
  if(boundary==="viewer")assert.ok(f.renderer.ownNodes(f.host,"dialog").some(node=>node.attributes.class==="document-artifact-view"&&node.open));
  assert.equal(worker.counts().document_jobs,1);assert.equal(paidRequests(h).length,1);
});

for(const shared of [false,true])for(const closeNewer of [false,true])
test("Scene primary "+(shared?"shared":"personal")+": a newer exact input "+(closeNewer?"dismissal":"opening")+" owns the view after old completion",async t=>{
  const current=await fixture(t,{shared}),{worker,h,f,id}=current,second=await secondPolicyJob(current);
  const gate=sceneDeferred(),entered=sceneDeferred();let retained,held=false;
  t.after(()=>gate.resolve(retained));
  h.intercept=async request=>{if(!held&&request.url===inspectionPath(id)){held=true;const response=await worker.request(request.url,request.init);retained=await response.json();entered.resolve();return{ok:true,status:200,json:()=>gate.promise};}};
  const first=names(f).find(card=>card.button.attributes["aria-label"]?.includes(id));assert.ok(first);
  const {completion}=await start(f,first.button);await entered.promise;noPrivate(f);
  const secondAction=names(f).find(card=>card.button.attributes["aria-label"]?.includes(second));assert.ok(secondAction);
  await invoke(f,secondAction.button);await receiptReady(f);
  const secondInspection=structuredClone(receiptComponent(f).inspection);assert.equal(secondInspection.receipt.job.job_id,second);
  if(closeNewer)await closeReceipt(f);const startTrace=f.trace.length;
  gate.resolve(retained);await completion;await settle(f);
  if(closeNewer)noPrivate(f);else assert.deepEqual(receiptComponent(f).inspection,secondInspection);
  assert.equal(f.trace.slice(startTrace).some(value=>value==="open:generation-input-dialog"||value.startsWith("focus:")),false);
  assert.equal(paidRequests(h).length,2);assert.equal(worker.counts().document_jobs,2);
});


for(const shared of [false,true])test("Scene primary "+(shared?"shared":"personal")+": a captured old receipt close cannot dismiss the newer owned receipt",async t=>{
  const current=await fixture(t,{shared}),{h,f,id}=current,second=await secondPolicyJob(current);
  const first=names(f).find(card=>card.button.attributes["aria-label"]?.includes(id));assert.ok(first);
  await invoke(f,first.button);await receiptReady(f);const old=receiptComponent(f);
  const close=f.renderer.ownNodes(old,"button").find(button=>button.attributes.class==="button primary");assert.ok(close);
  await closeReceipt(f);
  const next=names(f).find(card=>card.button.attributes["aria-label"]?.includes(second));assert.ok(next);
  await invoke(f,next.button);await receiptReady(f);const expected=structuredClone(receiptComponent(f).inspection),requests=h.requests.length;
  await close.handlers.click.call(old,{target:close,currentTarget:close});await settle(f);
  assert.equal(receiptComponent(f)?.open,true,"an old close belongs only to its earlier receipt");
  assert.deepEqual(receiptComponent(f).inspection,expected);assert.equal(expected.receipt.job.job_id,second);
  assert.equal(h.requests.length,requests);await closeReceipt(f);noPrivate(f);
});

for(const shared of [false,true])for(const reused of [false,true])
test("Scene primary "+(shared?"shared":"personal")+": a queued native close cannot dismiss a newer "+(reused?"reused-node":"owned")+" receipt",async t=>{
  const current=await fixture(t,{shared}),{h,f,id}=current,second=await secondPolicyJob(current);
  const first=names(f).find(card=>card.button.attributes["aria-label"]?.includes(id));assert.ok(first);
  await invoke(f,first.button);await receiptReady(f);const old=receiptComponent(f);
  const oldNode=f.renderer.ownNodes(old,"dialog")[0];assert.ok(oldNode?.open);
  const queued=[];
  oldNode.close=()=>{if(!oldNode.open)return;oldNode.open=false;
    queued.push(()=>oldNode.handlers.close.call(old,{target:oldNode,currentTarget:oldNode}));};
  if(reused){
    // Native close queues its event. The existing public exact-input path
    // replaces the job in the same child before that event is delivered.
    oldNode.close();await f.host.openJobById(second);await settle(f);await receiptReady(f);
  }else{
    await closeReceipt(f);
    const next=names(f).find(card=>card.button.attributes["aria-label"]?.includes(second));assert.ok(next);
    await invoke(f,next.button);await receiptReady(f);
  }
  assert.equal(queued.length,1);const newer=receiptComponent(f),newerNode=f.renderer.ownNodes(newer,"dialog")[0];
  assert.equal(newer===old,reused,"actual component identity follows the selected production branch");
  assert.equal(newerNode===oldNode,reused,"a reused native node receives its current handler, not a captured parent callback");
  const expected=structuredClone(newer.inspection),requests=h.requests.length,trace=f.trace.length;
  assert.equal(expected.receipt.job.job_id,second);assert.ok(newerNode.open);
  queued.shift()();await settle(f);
  assert.equal(receiptComponent(f)?.open,true,"the queued earlier native close cannot close B");
  assert.deepEqual(receiptComponent(f).inspection,expected);assert.equal(h.requests.length,requests);
  assert.equal(f.trace.slice(trace).some(value=>value.startsWith("focus:")),false);
  // A genuine close of the current dialog still dismisses that receipt.
  const active=receiptComponent(f),node=f.renderer.ownNodes(active,"dialog")[0];node.open=false;
  node.handlers.close.call(active,{target:node,currentTarget:node});await settle(f);noPrivate(f);
});

function boundedSceneJobPage(h,id,inspect){
  const page={omit:true,rewrite:null,reads:0};
  h.intercept=async request=>{
    const url=new URL(request.url,"http://localhost");
    if(url.pathname==="/api/document-jobs"&&(!request.init?.method||request.init.method==="GET")){
      const response=await h.worker.request(request.url,request.init),body=await response.json();
      assert.equal(response.status,200);assert.ok(Array.isArray(body.jobs));page.reads++;
      // Model a bounded list page at the HTTP port. The actual Store performs
      // the sync; exact job/private routes remain the real source Worker.
      const jobs=body.jobs.filter(job=>!page.omit||job.jobId!==id).map(job=>job.jobId===id&&page.rewrite?page.rewrite(job):job);
      return Response.json({...body,jobs});
    }
    return inspect?.(request);
  };
  return page;
}
async function syncScenePage(h,f,page){
  const before=page.reads;await h.store.syncDocumentJobs();await settle(f);
  assert.equal(page.reads,before+1,"the actual Store consumed one current list response");
}
async function exactSceneStillReadable(h,id){
  const response=await h.worker.request(inspectionPath(id));assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.job.jobId,id);assert.equal(body.job.documentId,h.request.documentId);
  return body.job;
}
for(const locale of ["en","fr","ar","ja"])for(const shared of [false,true])for(const pending of [false,true])
test("Scene bounded feed "+locale+"/"+(shared?"shared":"personal")+"/"+(pending?"pending":"open")+": omission is not withdrawal of the exact authorized receipt",async t=>{
  const {h,f,id,worker,calls}=await fixture(t,{locale,shared}),authority=h.store.captureAuthorizationScope();
  if(!shared)await warmPersonal(h,id);
  const cache=structuredClone(h.store.content.get()),counts=worker.counts(),row=jobRow(worker,id),gate=sceneDeferred(),entered=sceneDeferred();let body;
  t.after(()=>gate.resolve(body));
  const page=boundedSceneJobPage(h,id,pending?async request=>{
    if(request.url===inspectionPath(id)){const response=await worker.request(request.url,request.init);assert.equal(response.status,200);body=await response.json();entered.resolve();return{ok:true,status:200,json:()=>gate.promise};}
  }:undefined);
  const {completion}=await start(f);
  let expected;
  if(pending){await entered.promise;noPrivate(f);}
  else{await completion;await receiptReady(f);expected=structuredClone(receiptComponent(f).inspection);}
  const trace=f.trace.length;await syncScenePage(h,f,page);
  assert.equal(h.store.documentJobs.get().some(job=>job.jobId===id),false);
  assert.deepEqual(h.store.captureAuthorizationScope(),authority);assert.equal(h.store.authorizationScopeActive(authority),true);
  await exactSceneStillReadable(h,id);
  if(pending){noPrivate(f);gate.resolve(body);await completion;await settle(f);}
  assert.equal(inputOpen(f),true,"the same exact owned read survives absence from a bounded list");
  const input=receiptComponent(f);assert.equal(input.inspection.receipt.job.job_id,id);
  if(expected)assert.deepEqual(input.inspection,expected,"the open original receipt remains byte-for-byte the same");
  await copyReceiptEvidence(f,input,structuredClone(input.inspection));
  if(!pending)assert.equal(f.trace.slice(trace).some(value=>value==="open:generation-input-dialog"||value.startsWith("focus:")),false);
  assert.deepEqual(h.store.content.get(),cache,"the private response is not merged into the global cache");
  assert.equal(h.store.documentJobs.get().some(job=>job.jobId===id),false,"inspection never fabricates feed membership");
  assert.deepEqual(worker.counts(),counts);assert.deepEqual(jobRow(worker,id),row);
  assert.equal(calls.length,0);assert.equal(paidRequests(h).length,1);
  await closeReceipt(f);noPrivate(f);
});

for(const shared of [false,true])test("Scene bounded feed "+(shared?"shared":"personal")+": a stale initial card still requires a current visible exact failure",async t=>{
  const {h,f,id}=await fixture(t,{shared}),old=primary(f),page=boundedSceneJobPage(h,id);
  await syncScenePage(h,f,page);await exactSceneStillReadable(h,id);assert.equal(h.store.documentJobs.get().some(job=>job.jobId===id),false);
  const reads=h.requests.length;const{completion}=await start(f,old);await completion;await settle(f);
  assert.equal(h.requests.length,reads,"an absent initial card cannot start a new read");noPrivate(f);
});

const sceneNegativeRows={
  document:job=>({...job,documentId:"different-current-document"}),
  kind:job=>({...job,kind:"compile"}),
  result:job=>({...job,result:{...job.result,artifactKind:"slides"}}),
  state:job=>({...job,status:"completed"}),
  dismissed:job=>({...job,dismissedAt:new Date().toISOString()}),
};
for(const shared of [false,true])for(const pending of [false,true])for(const [boundary,rewrite]of Object.entries(sceneNegativeRows))
test("Scene bounded feed "+(shared?"shared":"personal")+"/"+(pending?"pending":"open")+": reintroduced "+boundary+" contradiction is not an omission",async t=>{
  const {h,f,id,worker,calls}=await fixture(t,{shared}),scope=h.store.captureAuthorizationScope(),gate=sceneDeferred(),entered=sceneDeferred();let body;
  t.after(()=>gate.resolve(body));
  const page=boundedSceneJobPage(h,id,pending?async request=>{
    if(request.url===inspectionPath(id)){const response=await worker.request(request.url,request.init);assert.equal(response.status,200);body=await response.json();entered.resolve();return{ok:true,status:200,json:()=>gate.promise};}
  }:undefined);
  const{completion}=await start(f);
  if(pending)await entered.promise;else{await completion;await receiptReady(f);}
  await syncScenePage(h,f,page);assert.equal(h.store.documentJobs.get().some(job=>job.jobId===id),false);
  if(!pending)assert.equal(inputOpen(f),true,"omission itself is allowed before testing a known contradiction");
  page.omit=false;page.rewrite=rewrite;await syncScenePage(h,f,page);
  const known=h.store.documentJobs.get().find(job=>job.jobId===id);assert.ok(known,"a same-ID row is present, not filtered out as absence");
  assert.equal(h.store.authorizationScopeActive(scope),true,"the rejection comes from known current request evidence, not a changed scope");
  noPrivate(f);
  // Once explicit negative evidence revoked the old opening, another omission
  // cannot revive it. Only a new deliberate authorized action may open a view.
  page.omit=true;await syncScenePage(h,f,page);const trace=f.trace.length;
  if(pending){gate.resolve(body);await completion;await settle(f);}
  noPrivate(f);assert.equal(f.trace.slice(trace).some(value=>value==="open:generation-input-dialog"||value.startsWith("focus:")),false);
  assert.equal(calls.length,0);assert.equal(paidRequests(h).length,1);await exactSceneStillReadable(h,id);
});

for(const shared of [false,true])for(const pending of [false,true])for(const boundary of ["access","session","route","locale","composer","viewer","disconnect"])
test("Scene bounded feed "+(shared?"shared":"personal")+"/"+(pending?"pending":"open")+": "+boundary+" still owns revocation after omission",async t=>{
  const {h,f,id,worker,calls}=await fixture(t,{shared}),gate=sceneDeferred(),entered=sceneDeferred();let body;
  t.after(()=>gate.resolve(body));
  const page=boundedSceneJobPage(h,id,pending?async request=>{
    if(request.url===inspectionPath(id)){const response=await worker.request(request.url,request.init);assert.equal(response.status,200);body=await response.json();entered.resolve();return{ok:true,status:200,json:()=>gate.promise};}
  }:undefined);
  const{completion}=await start(f);
  if(pending)await entered.promise;else{await completion;await receiptReady(f);}
  await syncScenePage(h,f,page);assert.equal(h.store.documentJobs.get().some(job=>job.jobId===id),false);
  if(!pending)assert.equal(inputOpen(f),true);
  if(boundary==="access"){
    const session=h.store.session.get();
    h.setSession({permissionEpoch:"read-access-withdrawn",...(shared?{projectContext:{...session.projectContext,permissions:[]}}:{capabilities:[]})});
  }
  if(boundary==="session")h.store.session.set(null);
  if(boundary==="route")h.store.route.set("/library");
  if(boundary==="locale")changeLocale(f);
  if(boundary==="composer")assert.equal(await f.host.openRender("short_story",h.request.documentId,{current:()=>f.state.canRead}),true);
  if(boundary==="viewer")assert.equal(await f.host.openArtifactById(h.request.workflowSources[0].outputId),true);
  if(boundary==="disconnect"){f.host.disconnectedCallback();f.host.isConnected=false;}
  f.draw();const trace=f.trace.length;
  if(pending){gate.resolve(body);await completion;await settle(f);}
  noPrivate(f);assert.equal(f.trace.slice(trace).some(value=>value==="open:generation-input-dialog"||value.startsWith("focus:")),false);
  if(boundary==="composer")assert.ok(composer(f)?.open);
  if(boundary==="viewer")assert.ok(f.renderer.ownNodes(f.host,"dialog").some(node=>node.attributes.class==="document-artifact-view"&&node.open));
  assert.equal(calls.length,0);assert.equal(paidRequests(h).length,1);
});

for(const shared of [false,true])test("Scene bounded feed "+(shared?"shared":"personal")+": dismissal after omission stays closed on a later positive page",async t=>{
  const {h,f,id}=await fixture(t,{shared}),page=boundedSceneJobPage(h,id);
  await invoke(f,primary(f));await receiptReady(f);await syncScenePage(h,f,page);
  assert.equal(inputOpen(f),true);await closeReceipt(f);noPrivate(f);
  const trace=f.trace.length;page.omit=false;await syncScenePage(h,f,page);await exactSceneStillReadable(h,id);
  noPrivate(f);assert.equal(f.trace.slice(trace).some(value=>value==="open:generation-input-dialog"||value.startsWith("focus:")),false);
  const recovered=await inspectFailure(f,failureCard(f));assert.equal(recovered.inspection.receipt.job.job_id,id,"a new deliberate current action still works");
});

for(const shared of [false,true])test("Scene bounded feed "+(shared?"shared":"personal")+": real exact 404 after omission defeats warm private cache",async t=>{
  const {h,f,id,worker,calls}=await fixture(t,{shared}),gate=sceneDeferred(),entered=sceneDeferred();let exactStatus;
  if(!shared)await warmPersonal(h,id);
  const cache=structuredClone(h.store.content.get());t.after(()=>gate.resolve());
  const page=boundedSceneJobPage(h,id,async request=>{
    if(request.url===inspectionPath(id)){entered.resolve();await gate.promise;const response=await worker.request(request.url,request.init);exactStatus=response.status;return response;}
  });
  const{completion}=await start(f);await entered.promise;await syncScenePage(h,f,page);noPrivate(f);
  await exactSceneStillReadable(h,id);
  // The exact source Worker now knows the job is absent; this is distinct from
  // a missing list row and must not fall back to any earlier private bytes.
  worker.sqlite.prepare("DELETE FROM document_jobs WHERE job_id=?").run(id);
  gate.resolve();await completion;await settle(f);
  assert.equal(exactStatus,404);noPrivate(f);assert.equal(h.store.ui.toast,f.i18n.t("scene.cost.unavailable"));
  assert.deepEqual(h.store.content.get(),cache);assert.equal(calls.length,0);assert.equal(paidRequests(h).length,1);
});

for(const shared of [false,true])for(const pending of [false,true])
test("Scene bounded feed "+(shared?"shared":"personal")+"/"+(pending?"pending":"open")+": a newer exact receipt owns the view despite the missing older row",async t=>{
  const current=await fixture(t,{shared}),{h,f,id,worker,calls}=current,second=await secondPolicyJob(current);
  const gate=sceneDeferred(),entered=sceneDeferred();let body;t.after(()=>gate.resolve(body));
  const page=boundedSceneJobPage(h,id,pending?async request=>{
    if(request.url===inspectionPath(id)){const response=await worker.request(request.url,request.init);assert.equal(response.status,200);body=await response.json();entered.resolve();return{ok:true,status:200,json:()=>gate.promise};}
  }:undefined);
  const first=names(f).find(card=>card.button.attributes["aria-label"]?.includes(id));assert.ok(first);
  const{completion}=await start(f,first.button);
  if(pending)await entered.promise;else{await completion;await receiptReady(f);}
  await syncScenePage(h,f,page);assert.equal(h.store.documentJobs.get().some(job=>job.jobId===id),false);
  if(pending){
    const next=names(f).find(card=>card.button.attributes["aria-label"]?.includes(second));assert.ok(next);
    await invoke(f,next.button);
  }else await f.host.openJobById(second);
  await settle(f);await receiptReady(f);const expected=structuredClone(receiptComponent(f).inspection),trace=f.trace.length;
  assert.equal(expected.receipt.job.job_id,second);
  if(pending){gate.resolve(body);await completion;await settle(f);}
  assert.deepEqual(receiptComponent(f).inspection,expected);
  assert.equal(f.trace.slice(trace).some(value=>value==="open:generation-input-dialog"||value.startsWith("focus:")),false);
  assert.equal(calls.length,0);assert.equal(paidRequests(h).length,2);
});
