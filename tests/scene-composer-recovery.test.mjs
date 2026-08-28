
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { isSceneSafeUnusedProof } from "../src/model/scene-cost-consent.ts";
import { reserveCostBudget } from "../worker/pilot-policy.ts";
import { createSceneStoreHost, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";

// Reuse the actual full component/LocaleController fixture without registering its separate test suite.
// The only extension loads the real input-dialog component; no production method is substituted.
const fixtureUrl=new URL("./scene-cost-composer.test.mjs",import.meta.url);
const fixtureSource=fs.readFileSync(fixtureUrl,"utf8"),fixtureTree=ts.createSourceFile(fixtureUrl.pathname,fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let fixtureModule=fixtureTree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)
  ||ts.isExpressionStatement(node)&&ts.isBinaryExpression(node.expression)&&node.expression.left.getText(fixtureTree)==="fixtureModule")
  .map(node=>node.getFullText(fixtureTree)).join("\n");
fixtureModule=fixtureModule.replace("export { fixture, DocumentArtifacts, FormaLocaleController, FORMA_DEFAULT_MESSAGES, localeCatalogs }","export { fixture, DocumentArtifacts, FormaLocaleController, FORMA_DEFAULT_MESSAGES, localeCatalogs, loadActual }")
  .replace("const {fixture,DocumentArtifacts,FormaLocaleController,FORMA_DEFAULT_MESSAGES,localeCatalogs}=","const {fixture,DocumentArtifacts,FormaLocaleController,FORMA_DEFAULT_MESSAGES,localeCatalogs,loadActual}=");
fixtureModule+="\nexport { action, enabled, createButton, invoke, settle, syntheticJob, appendDocument, sceneJobs, loadActual };\n";
const fixtureModuleUrl=new URL("./scene-composer-recovery-fixture.mjs",import.meta.url).href;
const fixtureHook=registerHooks({resolve(specifier,context,next){return specifier===fixtureModuleUrl?{url:fixtureModuleUrl,shortCircuit:true}:next(specifier,context);},
  load(url,context,next){return url===fixtureModuleUrl?{format:"module",source:fixtureModule,shortCircuit:true}:next(url,context);}});
const {createSceneComposer:baseSceneComposer,action,enabled,createButton,invoke,settle,appendDocument,sceneJobs,loadActual}=await import(fixtureModuleUrl);
fixtureHook.deregister();
const {GenerationInputDialog}=await loadActual("src/components/generation-input-dialog.ts");
const noProviders=t=>{const mock=t.mock.method(globalThis,"fetch",async()=>assert.fail("No external or provider network is permitted"));t.after(()=>assert.equal(mock.mock.callCount(),0,"no provider or external request was attempted"));return mock;};
const paidRequests=h=>h.requests.filter(request=>request.url==="/api/document-jobs"&&request.body?.payload?.sceneCostConsent);
const composerDialog=f=>f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class==="document-artifact-create");
const receiptComponent=f=>f.renderer.component("forma-generation-input-dialog");
// Normal actions wait for their observable completion, not a fixed number of event-loop turns.
// Deliberately pending actions still use invoke/settle directly and keep their original gates.
async function untilScene(check,message="Scene asynchronous boundary"){
  const deadline=performance.now()+5_000;
  while(!check()&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1));
  assert.ok(check(),message);
}
async function waitForSceneUi(f,check,message){
  await untilScene(()=>{f.draw();return check();},message);
}
const checkControl=f=>action(f,"scene.cost.check")??action(f,"scene.cost.inspect");
const sceneIdle=f=>waitForSceneUi(f,()=>enabled(checkControl(f)),"the normal Scene check finishes, including an unavailable result");
const sceneSubmitted=f=>waitForSceneUi(f,()=>!composerDialog(f)?.open,"the normal admitted Scene submission finishes");
const receiptReady=f=>waitForSceneUi(f,()=>Boolean(receiptComponent(f)?.open),"the normal owned Scene receipt finishes opening");
async function createSceneComposer(t,options){
  const f=await baseSceneComposer(t,options),check=f.check;
  f.check=async()=>{await sceneIdle(f);await check();await sceneIdle(f);};
  return f;
}
function withReceipt(f){f.renderer.registry["forma-generation-input-dialog"]=GenerationInputDialog;f.draw();return f;}
function captureSubmit(f){return f.renderer.handler(f.host,"form",node=>node.attributes.class==="document-artifact-dialog","submit");}
async function openKind(f,kind,documentId=f.host.documentId||f.state.documentId){
  assert.equal(await f.host.openRender(kind,documentId,{current:()=>f.state.canRead}),true);f.host.configurePresentationForTest("manual",1);f.draw();
}
async function invokeReceipt(f){const button=action(f,"scene.cost.receipt");assert.ok(button,"actual named original-input action");await invoke(f,button);await settle(f);}
function closeSchedule(f,timing){
  const dialog=composerDialog(f);assert.ok(dialog?.open);
  if(timing==="synchronous")return()=>{};
  const handler=dialog.handlers.close,tick=f.tick;let pending=false;
  const flush=()=>{if(!pending)return;pending=false;const current=composerDialog(f)??dialog;current.open=false;handler.call(f.host,{target:current,currentTarget:current});};
  dialog.close=()=>{if(!dialog.open)return;dialog.open=false;pending=true;};
  if(timing==="queued")f.tick=async()=>{const result=await tick();flush();return result;};
  return flush;
}
async function originalScene(t,{locale="en",shared=false,status="running",timing="synchronous"}={}){
  noProviders(t);const h=await createSceneStoreHost({count:1,shared});t.after(()=>h.close());
  const f=withReceipt(await createSceneComposer(t,{locale,storeHost:h,workflow:true}));await f.openScene();await f.check();await f.submit();
  await untilScene(()=>h.worker.counts().document_jobs===1);await sceneSubmitted(f);await settle(f);
  const id=paidRequests(h)[0].body.payload.sceneRequestId;
  h.worker.sqlite.prepare("UPDATE document_jobs SET status=?,completed_at=? WHERE job_id=?").run(status,["completed","failed","partial","canceled"].includes(status)?new Date().toISOString():null,id);
  await f.openScene();await f.check();
  assert.ok(action(f,"scene.cost.receipt"));const flushClose=closeSchedule(f,timing);
  return{h,f,id,flushClose};
}

for(const locale of ["en","fr","ar","ja"])test(`Scene recovery ${locale}: stale Short-story submit cannot adopt a newly verified Scene approval`,async t=>{
  noProviders(t);const h=await createSceneStoreHost({count:1});t.after(()=>h.close());
  const f=await createSceneComposer(t,{locale,storeHost:h,workflow:true});
  await openKind(f,"short_story",h.request.documentId);const stale=captureSubmit(f);await f.closeScene();
  await f.openScene();await f.check();assert.equal(enabled(createButton(f)),true);
  await stale();await settle(f);
  assert.equal(paidRequests(h).length,0,"a different rendered format cannot dispatch this Scene");
  assert.equal(h.worker.counts().document_jobs,0);assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
  await f.submit();await untilScene(()=>h.worker.counts().document_jobs===1);await sceneSubmitted(f);
  assert.equal(paidRequests(h).length,1,"the current exact Scene form retains its approval action");
});

for(const timing of ["synchronous","queued"])test(`Scene recovery: actual ${timing} composer close hands the exact original job to the actual input dialog`,async t=>{
  const {h,f,id,flushClose}=await originalScene(t,{timing});
  await invokeReceipt(f);flushClose();await settle(f);await receiptReady(f);
  const receipt=receiptComponent(f);assert.ok(receipt?.open,"the actual input-dialog component opens after activation");
  assert.equal(receipt.inspection.receipt.job.job_id,id);
  assert.ok(f.renderer.ownNodes(receipt,"dialog").some(node=>node.open));
  assert.equal(composerDialog(f)?.open??false,false);assert.equal(paidRequests(h).length,1);
});

const kinds=["short_story","slides","storyboard","video","audio","scene"];
for(const locale of ["en","fr","ar","ja"])test(`Scene recovery ${locale}: every rendered format and same-kind replacement keeps its own submit opening`,async t=>{
  for(const from of kinds)for(const to of from==="scene"?kinds:[from,"scene"]){
    const f=await createSceneComposer(t,{locale});await openKind(f,from);if(from==="scene")await f.check();
    const old=captureSubmit(f);await f.closeScene();await openKind(f,to);if(to==="scene")await f.check();
    await old();await settle(f);assert.equal(f.calls.filter(call=>call.action==="submit").length,0,from+" → "+to);
    const current=captureSubmit(f);await current();await settle(f);
    assert.equal(f.calls.filter(call=>call.action==="submit").length,1,"current "+to+" remains usable");
    assert.equal(f.calls.find(call=>call.action==="submit").kind,to);
  }
});

for(const locale of ["en","fr","ar","ja"])test(`Scene recovery ${locale}: closed, unauthorized and disconnected captured forms cannot submit`,async t=>{
  for(const boundary of ["close","native-close-pending","read","document","disconnect"]){
    const f=await createSceneComposer(t,{locale});await openKind(f,"short_story");const submit=captureSubmit(f);
    if(boundary==="close")await f.closeScene();
    if(boundary==="native-close-pending")composerDialog(f).open=false;
    if(boundary==="read")f.withdraw();
    if(boundary==="document"){appendDocument(f,"B");f.state.documentId="B";f.host.documentId="B";f.changed=new Map([["documentId","A"]]);f.draw();}
    if(boundary==="disconnect"){f.host.disconnectedCallback();f.host.isConnected=false;}
    await submit();assert.equal(f.calls.filter(call=>call.action==="submit").length,0,boundary);
  }
});

async function closeReceipt(f){
  const receipt=receiptComponent(f);assert.ok(receipt?.open);
  const done=f.renderer.ownNodes(receipt,"button").find(node=>node.attributes.class==="button primary");assert.ok(done);
  done.handlers.click.call(receipt,{target:done,currentTarget:done});await f.flush();
  assert.equal(receiptComponent(f)?.open??false,false);
}
for(const locale of ["en","fr","ar","ja"])for(const shared of [false,true])for(const timing of ["synchronous","queued"])
test(`Scene receipt ${locale}/${shared?"shared":"personal"}/${timing}: all seven original statuses open the actual exact input dialog`,async t=>{
  const {h,f,id}=await originalScene(t,{locale,shared,status:"queued"});
  for(const [index,status] of sceneJobs.entries()){
    if(index){await f.openScene();await f.check();}
    h.worker.sqlite.prepare("UPDATE document_jobs SET status=?,completed_at=? WHERE job_id=?").run(status,["completed","failed","partial","canceled"].includes(status)?new Date().toISOString():null,id);
    await f.check();const before=h.worker.counts(),paid=paidRequests(h).length;
    const flush=closeSchedule(f,timing);await invokeReceipt(f);flush();await settle(f);await receiptReady(f);
    const receipt=receiptComponent(f);assert.ok(receipt?.open,status+" actual component opens");
    assert.equal(receipt.inspection.receipt.job.job_id,id);assert.equal(receipt.inspection.receipt.job.status,status);
    assert.equal(receipt.inspection.receipt.job.document_id,h.request.documentId);
    assert.ok(f.renderer.ownNodes(receipt,"dialog").some(node=>node.open),"real child native modal port opens");
    assert.ok(f.renderer.ownNodes(receipt,"textarea").some(node=>node.attributes.class==="generation-input-receipt"&&JSON.parse(node.value).job.job_id===id));
    assert.equal(composerDialog(f)?.open??false,false);assert.deepEqual(h.worker.counts(),before);assert.equal(paidRequests(h).length,paid);
    await closeReceipt(f);
  }
  assert.equal(paidRequests(h).length,1);assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
});

async function unusedOriginal(t,{locale="en",shared=false,failed=false}={}){
  noProviders(t);const h=await createSceneStoreHost({count:9,shared,medium:shared?"audio":"visual"});t.after(()=>h.close());
  const f=withReceipt(await createSceneComposer(t,{locale,storeHost:h,workflow:true,medium:shared?"audio":"visual"}));
  await f.openScene();await f.check();await f.submit();await untilScene(()=>h.worker.counts().document_jobs===1);await sceneSubmitted(f);await settle(f);
  const id=paidRequests(h)[0].body.payload.sceneRequestId;
  const expiry=h.worker.sqlite.prepare("SELECT expires_at FROM private_content WHERE content_id=?").get(h.worker.contentRef).expires_at;
  if(failed){
    h.worker.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00Z' WHERE content_id=?").run(h.worker.contentRef);
    const terminal=await h.worker.run(id);assert.equal(terminal.response.status,200);assert.equal(terminal.body.job.status,"failed");assert.equal(terminal.body.job.attemptCount,1);
  }else{
    const response=await h.worker.request("/api/document-jobs/"+encodeURIComponent(id)+"/cancel",{method:"POST"});
    assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).job.status,"canceled");
  }
  h.store.documentJobs.set([]);const reads=[];
  h.intercept=async request=>{
    if(request.url!=="/api/document-jobs"||request.body?.payload?.sceneCostPreview!==true)return;
    const response=await h.worker.request(request.url,request.init);reads.push({request,body:await response.clone().json()});return response;
  };
  await f.openScene();await f.fill("audience","A deliberately new audience");await f.check();
  assert.ok(isSceneSafeUnusedProof(reads.at(-1)?.body.sceneCostExisting?.safeUnused));assert.ok(action(f,"scene.cost.new"));
  return{h,f,id,reads,repair(){h.worker.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(expiry,h.worker.contentRef);}};
}
for(const locale of ["en","fr","ar","ja"])for(const shared of [false,true])for(const failed of [false,true])
test(`Scene continuation ${locale}/${shared?"shared":"personal"}/${failed?"source failure":"canceled"}: fresh unused proof → explicit new free plan → separate Create`,async t=>{
  const {h,f,id,reads,repair}=await unusedOriginal(t,{locale,shared,failed});
  assert.ok(f.visible().includes(f.i18n.t("scene.cost.unused")));assert.equal(enabled(createButton(f)),false);
  const old=h.worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(id),before=reads.length;
  await invoke(f,action(f,"scene.cost.new"));await untilScene(()=>reads.length===before+2,"fresh original read and new free preparation complete");await settle(f);await sceneIdle(f);
  assert.equal(reads.length,before+2,"one fresh original certification and one new free preparation");
  assert.equal(reads[before].request.body.payload.sceneRequestId,id);
  assert.ok(isSceneSafeUnusedProof(reads[before].body.sceneCostExisting?.safeUnused));
  const nextId=reads.at(-1).request.body.payload.sceneRequestId;assert.notEqual(nextId,id);
  assert.equal(h.worker.counts().document_jobs,1);assert.equal(paidRequests(h).length,1);
  assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(id),old);
  if(failed){
    assert.equal(enabled(createButton(f)),false,"unavailable new sources are not an approval");
    assert.ok(f.visible().includes(f.i18n.t("scene.cost.unavailable")));
    repair();await h.store.refreshEvents();await f.check();assert.equal(reads.at(-1).request.body.payload.sceneRequestId,nextId,"new unsubmitted ID survives source repair");
  }
  if(action(f,"scene.cost.refreshSources")){const beforeRefresh=reads.length;await invoke(f,action(f,"scene.cost.refreshSources"));await settle(f);await sceneIdle(f);assert.equal(reads.length,beforeRefresh,"Document refresh is not an implicit Scene check");await f.check();assert.equal(reads.at(-1).request.body.payload.sceneRequestId,nextId);}
  assert.equal(enabled(createButton(f)),true);assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
  assert.equal(reads.at(-1).body.sceneCostPreview.requestId,nextId);
  await f.submit();await untilScene(()=>h.worker.counts().document_jobs===2);await sceneSubmitted(f);await settle(f);
  assert.equal(paidRequests(h).length,2);assert.equal(paidRequests(h)[1].body.payload.sceneRequestId,nextId);
  assert.equal(paidRequests(h)[1].body.payload.sceneCostConsent.confirmed,true);
  assert.equal(Object.hasOwn(paidRequests(h)[1].body.payload,"safeUnused"),false,"unused proof is never paid approval");
  assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(id),old,"original remains canonically inspectable");
});

test("Scene receipt: shared original omitted from the activity feed still opens through the existing exact private receipt",async t=>{
  const {h,f,id}=await originalScene(t,{shared:true});h.store.documentJobs.set([]);await f.check();
  assert.ok(action(f,"scene.cost.receipt"));await invokeReceipt(f);await receiptReady(f);
  const receipt=receiptComponent(f);assert.ok(receipt?.open,"omitted-feed original is inspectable");
  assert.equal(receipt.inspection.receipt.job.job_id,id);assert.equal(h.store.documentJobs.get().length,0,"inspection does not fabricate feed membership");
  assert.equal(paidRequests(h).length,1);assert.equal(h.worker.counts().cost_budget_reservations,0);
});
test("Scene receipt: cached personal private input stays closed while a new exact read is pending or denied",async t=>{
  const {h,f,id}=await originalScene(t);await h.store.loadDocumentJobDetail(id);await invokeReceipt(f);await receiptReady(f);
  const first=receiptComponent(f);assert.ok(first?.inspection.retained);const privateSource="The keeper checks the harbor.";assert.ok(JSON.stringify(first.inspection.receipt).includes(privateSource));
  await closeReceipt(f);h.store.documentJobs.set([]);await f.openScene();await f.check();
  const gate=sceneDeferred(),entered=sceneDeferred();
  h.intercept=async request=>{if(request.url==="/api/document-jobs/"+encodeURIComponent(id)+"?inspection=1"){entered.resolve();return gate.promise;}};
  await invokeReceipt(f);await entered.promise;
  const pending=receiptComponent(f),flashed=Boolean(pending?.open&&JSON.stringify(pending.inspection?.receipt).includes(privateSource));
  gate.resolve(Response.json({error:"private_receipt_unavailable"},{status:403}));await settle(f);
  assert.equal(flashed,false,"unrecertified cached private input must not flash");
  assert.equal(receiptComponent(f)?.open??false,false,"denial cannot restore the cached presentation");
  assert.equal(paidRequests(h).length,1);
});

for(const locale of ["en","fr","ar","ja"])test(`Scene recovery ${locale}: changing a format within one opening cannot reuse its earlier submit callback`,async t=>{
  for(const [from,to] of [["short_story","slides"],["slides","short_story"],["storyboard","short_story"],["video","short_story"],["audio","short_story"],["scene","short_story"],["short_story","scene"]]){
    const f=await createSceneComposer(t,{locale});await openKind(f,from);if(from==="scene")await f.check();const stale=captureSubmit(f);
    const radio=f.renderer.ownNodes(f.host,"input").find(node=>node.attributes.name==="artifact-kind"&&node.attributes.value===to);assert.ok(radio);
    radio.handlers.change.call(f.host,{target:radio,currentTarget:radio});await f.flush();if(to==="scene")await f.check();
    await stale();await settle(f);assert.equal(f.calls.filter(call=>call.action==="submit").length,0,from+" → "+to+" within the same opening");
    await f.submit();await settle(f);assert.equal(f.calls.filter(call=>call.action==="submit").length,1,"current "+to+" positive control");
  }
});

for(const locale of ["en","fr","ar","ja"])test(`Scene continuation ${locale}: an expired offered New action performs a fresh free certification, not a dead click or stale approval`,async t=>{
  const {h,f,id,reads}=await unusedOriginal(t,{locale});const offered=action(f,"scene.cost.new"),old=reads.at(-1).body.sceneCostExisting.safeUnused;
  const NativeDate=Date,clock=Date.parse(old.expiresAt)+1;
  t.mock.method(globalThis,"Date",class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}});t.mock.method(Date,"now",()=>clock);
  assert.equal(Date.now(),clock);assert.equal(new Date().getTime(),clock);
  assert.equal(isSceneSafeUnusedProof(old),false);f.draw();assert.equal(action(f,"scene.cost.new"),undefined);
  const before=reads.length;await invoke(f,offered);await untilScene(()=>reads.length===before+2);await settle(f);await sceneIdle(f);
  const fresh=reads[before].body.sceneCostExisting.safeUnused;assert.ok(isSceneSafeUnusedProof(fresh));assert.equal(fresh.requestId,id);
  assert.ok(Date.parse(fresh.verifiedAt)>Date.parse(old.verifiedAt));assert.notEqual(reads.at(-1).request.body.payload.sceneRequestId,id);
  assert.equal(enabled(createButton(f)),true);assert.equal(paidRequests(h).length,1);assert.equal(h.worker.counts().document_jobs,1);
  assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
});

for(const locale of ["en","fr","ar","ja"])test(`Scene continuation ${locale}: fresh unknown, missing and held evidence never replaces a canceled original`,async t=>{
  const {h,f,id,reads}=await unusedOriginal(t,{locale});const original=h.worker.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(id).result_json;
  for(const boundary of ["missing","unknown","held"]){
    if(boundary!=="missing"){h.worker.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(original,id);await f.check();}
    const offered=action(f,"scene.cost.new");assert.ok(offered);const before=reads.length;
    if(boundary==="held"){
      const held=await reserveCostBudget(h.worker.env,h.worker.owner,1,{maximumMicrousd:1,allowUserOverage:false,streamId:h.worker.streamId,correlationId:id,operation:"document-render:scene"});assert.equal(held.ok,true);
    }else{
      const checkpoint=JSON.parse(original);if(boundary==="missing")delete checkpoint.providerSubmissionProtocol;else checkpoint.providerSubmissions={planning:{status:"unknown"}};
      h.worker.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),id);
    }
    const finance=h.worker.counts();await invoke(f,offered);await untilScene(()=>reads.length===before+1);await settle(f);await sceneIdle(f);
    assert.equal(reads.at(-1).body.sceneCostExisting.safeUnused,null,boundary);assert.equal(reads.at(-1).request.body.payload.sceneRequestId,id);
    assert.equal(action(f,"scene.cost.new"),undefined);assert.ok(f.visible().includes(f.i18n.t("scene.cost.recoveryChanged")));
    assert.equal(f.visible().includes(f.i18n.t("scene.cost.unused")),false);assert.equal(enabled(createButton(f)),false);
    assert.deepEqual(h.worker.counts(),finance);assert.equal(paidRequests(h).length,1);
  }
  await f.closeScene();await f.openScene();await f.check();assert.equal(reads.at(-1).request.body.payload.sceneRequestId,id);
});

for(const boundary of ["close","replacement","route","document","authority","source"])test(`Scene continuation: ${boundary} while fresh eligibility is pending cannot allocate or approve changed work`,async t=>{
  const {h,f,id,reads}=await unusedOriginal(t);const offered=action(f,"scene.cost.new"),entered=sceneDeferred(),body=sceneDeferred();
  let responseBody;const previous=h.intercept;
  h.intercept=async request=>{if(request.url==="/api/document-jobs"&&request.body?.payload?.sceneCostPreview===true){
    const response=await previous(request);responseBody=await response.json();entered.resolve();return{ok:true,status:200,json:()=>body.promise};
  }};
  await invoke(f,offered);await entered.promise;
  if(boundary==="close")await f.closeScene();
  if(boundary==="replacement")await openKind(f,"short_story",h.request.documentId);
  if(boundary==="route")h.store.route.set("/library");
  if(boundary==="document"){f.host.documentId="other-document";f.changed=new Map([["documentId",h.request.documentId]]);}
  if(boundary==="authority"){h.setSession({permissionEpoch:"withdrawn-current-epoch"});f.withdraw();}
  if(boundary==="source")h.changeText();
  f.draw();body.resolve(responseBody);await settle(f);
  assert.equal(reads.length,2,"only the original initial lookup and its fresh eligibility read");
  assert.equal(reads.at(-1).request.body.payload.sceneRequestId,id);assert.equal(paidRequests(h).length,1);assert.equal(h.worker.counts().document_jobs,1);
  assert.equal(action(f,"scene.cost.new"),undefined);assert.equal(f.visible().includes(f.i18n.t("scene.cost.unused")),false);
});

for(const kind of ["short_story","scene"])for(const timing of ["before-render","after-render"])
test(`Scene composer: old ${kind} close/submit callbacks cannot dismiss a newer opening ${timing}`,async t=>{
  const f=await createSceneComposer(t);await openKind(f,kind);if(kind==="scene")await f.check();
  const staleSubmit=captureSubmit(f),old=composerDialog(f),oldClose=old.handlers.close;
  const closeButton=f.renderer.ownNodes(f.host,"button").find(node=>node.attributes.class==="icon-button"&&node.handlers.click);
  assert.ok(closeButton);const close=closeButton.handlers.click;
  if(timing==="before-render"){const draw=f.draw;let fired=false;f.draw=()=>{if(!fired){fired=true;old.open=false;oldClose.call(f.host,{target:old,currentTarget:old});}return draw();};}
  await openKind(f,kind);if(kind==="scene")await f.check();
  const current=composerDialog(f);assert.ok(current?.open);
  oldClose.call(f.host,{target:current,currentTarget:current});await close.call(f.host,{currentTarget:closeButton});await staleSubmit();await settle(f);
  assert.ok(composerDialog(f)?.open,"late old dismiss cannot close the replacement");
  assert.equal(f.calls.filter(call=>call.action==="submit").length,0);
  assert.equal(enabled(createButton(f)),true);await f.submit();await settle(f);assert.equal(f.calls.filter(call=>call.action==="submit").length,1);
});

for(const shared of [false,true])for(const phase of ["handoff","read"])for(const boundary of ["replacement","route","document","authority"])
test(`Scene receipt ${shared?"shared":"personal"}: ${boundary} during ${phase} prevents late private restoration`,async t=>{
  const {h,f,id}=await originalScene(t,{shared});const entered=sceneDeferred(),gate=sceneDeferred();let responseBody;
  if(phase==="handoff"){
    const tick=f.tick;let first=true;f.tick=async()=>{if(first){first=false;entered.resolve();await gate.promise;}return tick();};
  }else{
    h.intercept=async request=>{if(request.url==="/api/document-jobs/"+encodeURIComponent(id)+"?inspection=1"){
      const response=await h.worker.request(request.url,request.init);responseBody=await response.json();entered.resolve();return{ok:true,status:200,json:()=>gate.promise};
    }};
  }
  await invokeReceipt(f);await entered.promise;assert.equal(receiptComponent(f)?.open??false,false,"no private placeholder while awaiting owned read");
  if(boundary==="replacement")await openKind(f,"short_story",h.request.documentId);
  if(boundary==="route")h.store.route.set("/library");
  if(boundary==="document"){f.host.documentId="other-document";f.changed=new Map([["documentId",h.request.documentId]]);}
  if(boundary==="authority"){h.setSession({permissionEpoch:"withdrawn-current-epoch"});f.withdraw();}
  f.draw();gate.resolve(responseBody);await settle(f);
  assert.equal(receiptComponent(f)?.open??false,false);assert.equal(paidRequests(h).length,1);
  if(boundary==="replacement")assert.ok(composerDialog(f)?.open,"new opening is preserved");
});

for(const phase of ["handoff","read"])test(`Scene receipt: a newer actual output viewer supersedes the old ${phase} without being closed`,async t=>{
  const {h,f,id}=await originalScene(t);const entered=sceneDeferred(),gate=sceneDeferred();let responseBody;
  if(phase==="handoff"){const tick=f.tick;let first=true;f.tick=async()=>{if(first){first=false;entered.resolve();await gate.promise;}return tick();};}
  else h.intercept=async request=>{if(request.url==="/api/document-jobs/"+encodeURIComponent(id)+"?inspection=1"){const response=await h.worker.request(request.url,request.init);responseBody=await response.json();entered.resolve();return{ok:true,status:200,json:()=>gate.promise};}};
  await invokeReceipt(f);await entered.promise;
  const artifactId=h.request.workflowSources[0].outputId;assert.equal(await f.host.openArtifactById(artifactId),true);
  gate.resolve(responseBody);await settle(f);
  assert.equal(receiptComponent(f)?.open??false,false);
  assert.ok(f.renderer.ownNodes(f.host,"dialog").some(node=>node.attributes.class==="document-artifact-view"&&node.open));
  assert.equal(paidRequests(h).length,1);
});
for(const shared of [false,true])test(`Scene receipt ${shared?"shared":"personal"}: the existing direct job action remains a positive control`,async t=>{
  const {h,f,id}=await originalScene(t,{shared});await f.closeScene();await f.host.openJobById(id);await settle(f);
  assert.ok(receiptComponent(f)?.open);assert.equal(receiptComponent(f).inspection.receipt.job.job_id,id);
  assert.equal(paidRequests(h).length,1);await closeReceipt(f);
});

for(const shared of [false,true])test(`Scene receipt ${shared?"shared":"personal"}: an older generic read cannot overwrite a newer Scene-owned receipt`,async t=>{
  const {h,f,id}=await originalScene(t,{shared,status:"running"});await f.closeScene();
  const entered=sceneDeferred(),gate=sceneDeferred();let first=true,responseBody;
  const oldPath="/api/document-jobs/"+encodeURIComponent(id)+(shared?"/private-receipt":"?inspection=1");
  h.intercept=async request=>{if(first&&request.url===oldPath){first=false;const response=await h.worker.request(request.url,request.init);responseBody=await response.json();entered.resolve();return{ok:true,status:200,json:()=>gate.promise};}};
  const older=f.host.openJobById(id);await entered.promise;
  h.worker.sqlite.prepare("UPDATE document_jobs SET status='committing',updated_at=? WHERE job_id=?").run(new Date().toISOString(),id);
  await f.openScene();await f.check();await invokeReceipt(f);await receiptReady(f);
  assert.equal(receiptComponent(f)?.inspection.receipt.job.status,"committing");
  gate.resolve(responseBody);await older;await settle(f);
  assert.equal(receiptComponent(f)?.inspection.receipt.job.status,"committing","late generic read cannot replace the fresh owned receipt");
  assert.equal(paidRequests(h).length,1);
});

test("Scene normal completion boundary: repaired shared source waits for the actual response without another action",async t=>{
  const {h,f,id,reads,repair}=await unusedOriginal(t,{shared:true,failed:true});
  await invoke(f,action(f,"scene.cost.new"));await untilScene(()=>reads.length===3);await sceneIdle(f);
  assert.ok(f.visible().includes(f.i18n.t("scene.cost.unavailable")));
  const nextId=reads.at(-1).request.body.payload.sceneRequestId;assert.notEqual(nextId,id);
  repair();await h.store.refreshEvents();const previous=h.intercept,entered=sceneDeferred(),gate=sceneDeferred();let response;
  h.intercept=async request=>{
    const result=await previous(request);
    if(request.body?.payload?.sceneCostPreview&&request.body.payload.sceneRequestId===nextId){response=result;entered.resolve();return gate.promise;}
    return result;
  };
  let resolved=false;const checking=f.check().then(()=>{resolved=true;});await entered.promise;
  await settle(f);await settle(f);
  const early={resolved,checking:f.visible().includes(f.i18n.t("scene.cost.checking")),enabled:enabled(createButton(f)),reads:reads.length,paid:paidRequests(h).length};
  gate.resolve(response);await checking;await sceneIdle(f);
  assert.equal(early.resolved,false,"normal check cannot advance while its successful response is still pending");
  assert.equal(early.checking,true);assert.equal(early.enabled,false);
  assert.equal(f.visible().includes(f.i18n.t("scene.cost.checking")),false);assert.equal(enabled(createButton(f)),true);
  assert.equal(reads.length,early.reads,"the same response completes without another check");
  assert.equal(paidRequests(h).length,early.paid);assert.equal(early.paid,1);assert.equal(h.worker.counts().document_jobs,1);
  assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
});
