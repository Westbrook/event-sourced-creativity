import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { createHash } from "node:crypto";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { sceneCostRequestHash, sceneCostRequestDescription } from "../src/model/scene-cost-consent.ts";
import { appendAuditEvent } from "../worker/runtime.ts";
import { storePrivateContent } from "../worker/pilot-policy.ts";
import { productionWorkflows, recommendProductionWorkflow, DOCUMENT_PRODUCTION_WORKFLOW_EVENT } from "../src/model/production-workflow.ts";

// Reuse the frozen full-component/real-LocaleController fixture declarations in RAM.
// Test registration is omitted; no component method or production dependency is replaced.
const fixtureUrl=new URL("./presentation-guidance-accessibility.test.mjs",import.meta.url);
const fixtureText=fs.readFileSync(fixtureUrl,"utf8"),fixtureTree=ts.createSourceFile(fixtureUrl.pathname,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fixtureDeclarations=fixtureTree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isClassDeclaration(node)||ts.isFunctionDeclaration(node)
  ||ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(fixtureTree)==="registerHooks");
let fixtureModule=fixtureDeclarations.map(node=>node.getFullText(fixtureTree)).join("\n");
fixtureModule=fixtureModule.replace(/(from\s+|import\s*\()(["'])([^"']+)\2/gu,(_match,prefix,quote,specifier)=>prefix+JSON.stringify(specifier.startsWith(".")?new URL(specifier,fixtureUrl).href:specifier.startsWith("node:")?specifier:import.meta.resolve(specifier)));
fixtureModule=fixtureModule.replaceAll('import.meta.resolve("vite")',JSON.stringify(import.meta.resolve("vite"))).replaceAll("import.meta.url",JSON.stringify(fixtureUrl.href));
fixtureModule=fixtureModule.replace("configurePresentationForTest(mode: ProductionMode, count: number) { this.#productionMode = mode; this.#itemCount = count; }","configurePresentationForTest(mode: ProductionMode, count: number) { this.#productionMode = mode; this.#itemCount = count; } configureSceneWorkflowForTest(workflowId: string, stageId: string) { this.#activeWorkflowId=workflowId; this.#activeWorkflowStageId=stageId; this.#workflowDocumentScope=this.#projection().projectId+':'+this.#targetDocumentId(); this.#productionMode='managed'; }");
fixtureModule+="\nexport { fixture, DocumentArtifacts, FormaLocaleController, FORMA_DEFAULT_MESSAGES, localeCatalogs };\n";
const {fixture,DocumentArtifacts,FormaLocaleController,FORMA_DEFAULT_MESSAGES,localeCatalogs}=await import("data:text/javascript;base64,"+Buffer.from(fixtureModule).toString("base64"));
const sceneJobs=["queued","running","committing","completed","failed","partial","canceled"];
const sceneTypeLabels={"en":"Scene type","fr":"Type de scène","ar":"نوع المشهد","ja":"シーンの種類"};
const sceneSingularPlans={"en":"{count} planned written scene · {medium} · {mode}","fr":"{count} scène écrite prévue · {medium} · {mode}","ar":"{count} مشهد مكتوب مخطط له · {medium} · {mode}","ja":"予定された文章シーン{count}件 · {medium} · {mode}"};

function localeFor(f,locale){
  const previous=f.i18n;
  const controller=new FormaLocaleController({addController(){},requestUpdate(){},dispatchEvent(event){
    event.callback({locale,formatLocale:locale,direction:locale==="ar"?"rtl":"ltr",timeZone:"UTC",messages:{...FORMA_DEFAULT_MESSAGES,...localeCatalogs[locale]},revision:2},()=>{});return true;
  }});
  controller.hostConnected();previous?.hostDisconnected();f.i18n=controller;f.host.i18n=controller;f.locale=locale;return controller;
}
const action=(f,key)=>f.buttons().find(button=>button.text===f.i18n.t(key));
const enabled=button=>Boolean(button&&!Object.hasOwn(button.attributes,"disabled"));
const createButton=f=>f.renderer.ownNodes(f.host,"button").find(node=>node.attributes.class==="button primary");
async function invoke(f,button){
  assert.ok(button,"actual rendered button");await button.handlers.click.call(f.host,{currentTarget:{},preventDefault(){},stopPropagation(){}});await f.flush();
}
async function settle(f){for(let i=0;i<8;i++){await new Promise(setImmediate);f.draw();}}
// Normal enabled checks finish when the rendered free-check control is ready,
// including a verified unavailable result. Disabled and pending-race activations
// remain nonblocking; the latter use the unchanged invoke/settle helpers.
async function sceneCheckComplete(f){
  const current=()=>{f.draw();return enabled(action(f,"scene.cost.check")??action(f,"scene.cost.inspect"));};
  const deadline=performance.now()+5_000;
  while(!current()&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1));
  assert.ok(current(),"the normal Scene free check finishes after its actual response");
}
function appendDocument(f,id){
  const sequence=f.state.events.length+1;
  f.state.events.push({eventId:"extra-document-"+id,streamId:"stream",sequence,actor:"user:owner",correlationId:"fixture",occurredAt:"2026-08-27T00:00:00Z",type:"DocumentCreated",payload:{project_id:"p",document_id:id,title:"Document "+id}});
}
function syntheticJob(request,status="queued"){return{jobId:request.requestId,documentId:request.documentId,kind:"render_document",status,result:{artifactKind:"scene"},progress:0,sourceSurface:"document",createdAt:"2026-08-27T00:00:00Z"};}

export async function createSceneComposer(t,{locale="en",storeHost=null,workflow=false,count=9,medium="visual"}={}){
  const f=fixture(t,{locale,facts:[{id:"scene-direction",type:"direction",text:"A keeper follows the harbor bell."}]});
  f.calls=[];f.scene={sourceRevision:0,count,medium,lookup:null,submit:null,refresh:null,plannerConfigured:true,model:"gpt-5.6-terra",epoch:"epoch-1"};
  if(storeHost){
    f.store=storeHost.store;f.host.store=f.store;
    f.host.documentId=storeHost.request.documentId;
  }else{
    const previousSession=f.store.session.get;
    f.store.session.get=()=>({...previousSession(),permissionEpoch:f.scene.epoch,policy:{accepted:true,version:"v1"},provider:{...previousSession().provider,plannerConfigured:f.scene.plannerConfigured,plannerModel:f.scene.model}});
    f.store.captureSceneCostSource=request=>{
      const fingerprint=()=>JSON.stringify([f.state.authorization,f.state.canRead,f.state.canRequest,f.state.documentId,f.scene.sourceRevision,f.scene.model,f.scene.plannerConfigured,f.scene.epoch,new Date().toISOString().slice(0,7),sceneCostRequestDescription(request)]);
      const original=fingerprint();return()=>f.state.canRead&&fingerprint()===original;
    };
    f.previewFor=async request=>({version:"scene-cost-v1",requestId:request.requestId,actorUserId:"owner",projectId:"p",documentId:request.documentId,contextSessionId:null,
      permissionEpoch:f.scene.epoch,period:new Date().toISOString().slice(0,7),requestHash:await sceneCostRequestHash(request),sourceHash:"a".repeat(64),provider:"openai",model:f.scene.model,
      sceneMedium:request.sceneMedium??"visual",productionMode:request.productionMode??"manual",itemCount:f.scene.count,reusedSourceCount:1,
      providerCallCount:request.productionMode==="managed"?Math.ceil(f.scene.count/8):1,maximumProviderCallCount:request.productionMode==="managed"?Math.ceil(f.scene.count/8)*4:2,
      maximumMicrousd:(request.productionMode==="managed"?Math.ceil(f.scene.count/8):1)*1_000_000,bindingHash:"b".repeat(64)});
    f.store.previewSceneCost=async(request,options={})=>{
      f.calls.push({action:"quote",request:structuredClone(request),current:options.current});
      const inspection=f.scene.lookup?await f.scene.lookup(request,options):{requestId:request.requestId,preview:await f.previewFor(request),job:null};
      return inspection;
    };
    f.store.renderDocumentArtifact=async(kind,options)=>{
      f.calls.push({action:"submit",kind,options});
      if(f.scene.submit)return f.scene.submit(options);
      options.onDispatch?.();options.onResult?.({requestId:options.sceneRequestId,preview:options.sceneCostConsent&&Object.fromEntries(Object.entries(options.sceneCostConsent).filter(([key])=>key!=="confirmed")),job:syntheticJob({requestId:options.sceneRequestId,documentId:options.documentId}),reused:false,attemptSubmission:"submitted"});return true;
    };
    f.store.refreshEvents=async()=>{f.calls.push({action:"refresh"});if(f.scene.refresh)await f.scene.refresh();f.scene.sourceRevision++;};
    f.store.loadDocumentJobDetail=async id=>{f.calls.push({action:"detail",id});return syntheticJob({requestId:id,documentId:f.state.documentId},"running");};
  }
  f.openScene=async({mode="managed",selectedMedium=medium,documentId=storeHost?.request.documentId??f.state.documentId}={})=>{
    assert.equal(await f.host.openRender("scene",documentId,{sceneMedium:selectedMedium,current:()=>f.state.canRead}),true);
    f.host.configurePresentationForTest(mode,6);
    if(workflow&&storeHost)f.host.configureSceneWorkflowForTest(storeHost.request.workflowId,storeHost.request.workflowStageId);
    f.draw();
  };
  f.check=async()=>{const button=action(f,"scene.cost.check")??action(f,"scene.cost.inspect"),waitForResponse=enabled(button);await invoke(f,button);await settle(f);if(waitForResponse)await sceneCheckComplete(f);};
  f.closeScene=async()=>{const dialog=f.renderer.ownNodes(f.host,"dialog").find(node=>node.attributes.class==="document-artifact-create");assert.ok(dialog);dialog.close();await f.flush();};
  f.fill=async(field,value)=>{const node=f.renderer.ownNodes(f.host,"input").find(input=>input.attributes.name===field);assert.ok(node);node.value=value;node.handlers.input.call(f.host,{target:node,currentTarget:node});await f.flush();};
  f.changeMedium=async value=>{const node=f.renderer.ownNodes(f.host,"input").find(input=>input.attributes.name==="artifact-scene-medium"&&input.attributes.value===value);assert.ok(node);await node.handlers.change.call(f.host,{target:node,currentTarget:node});await f.flush();};
  f.changeMode=async value=>{const node=f.renderer.ownNodes(f.host,"input").find(input=>input.attributes.name==="artifact-production-mode"&&input.attributes.value===value);assert.ok(node);node.handlers.change.call(f.host,{target:node,currentTarget:node});await f.flush();};
  f.remount=()=>{f.host.disconnectedCallback();f.host.isConnected=false;f.draw();const next=new DocumentArtifacts();next.store=f.store;next.i18n=f.i18n;next.documentId=f.state.documentId;next.launcherOnly=true;next.isConnected=true;f.host=next;next.connectedCallback();f.draw();};
  return f;
}

for(const locale of ["en","fr","ar","ja"])for(const medium of ["visual","audio"])test(`Scene composer ${locale}/${medium}: exact 1/9/17 plans preserve automatic requested count and one explicit approval`,async t=>{
  for(const count of [1,9,17]){
    const f=await createSceneComposer(t,{locale,medium,count});await f.openScene();
    assert.equal(enabled(createButton(f)),false);assert.ok(f.visible().includes(f.i18n.t("scene.cost.priceUnavailable")));
    const mediumField=f.renderer.ownNodes(f.host,"fieldset").find(node=>node.attributes.class==="artifact-scene-medium");
    assert.equal(mediumField?.attributes["aria-label"],sceneTypeLabels[locale]);
    assert.ok(f.renderer.markup.includes("<legend>"+sceneTypeLabels[locale]+"</legend>"));
    assert.equal(f.calls.length,0);await f.check();
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].request.itemCount,undefined);
    assert.ok(f.visible().includes(f.i18n.t(count===1?"scene.cost.planOne":"scene.cost.plan","",{count:f.i18n.number(count),medium:f.i18n.t("scene.medium."+medium),mode:f.i18n.t("scene.cost.managed")})));
    if(count===1)assert.ok(f.visible().includes(sceneSingularPlans[locale].replace("{count}",f.i18n.number(count)).replace("{medium}",f.i18n.t("scene.medium."+medium)).replace("{mode}",f.i18n.t("scene.cost.managed"))));
    assert.ok(f.visible().includes(f.i18n.number(Math.ceil(count/8),{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:6})));
    assert.equal(enabled(createButton(f)),true);
    await f.submit();await settle(f);
    const admitted=f.calls.find(call=>call.action==="submit");assert.ok(admitted);assert.equal(admitted.options.itemCount,undefined);
    assert.equal(admitted.options.sceneCostConsent.confirmed,true);assert.equal(admitted.options.sceneRequestId,f.calls[0].request.requestId);
    assert.equal(f.calls.filter(call=>call.action==="submit").length,1);
  }
});


for(const locale of ["en","fr","ar","ja"])test(`Scene composer ${locale}: form changes and captured old approval cannot purchase a later draft`,async t=>{
  const f=await createSceneComposer(t,{locale});await f.openScene();await f.check();
  const oldSubmit=f.renderer.handler(f.host,"form",node=>node.attributes.class==="document-artifact-dialog","submit");
  const firstId=f.calls[0].request.requestId;
  await f.fill("audience","A different audience");assert.equal(enabled(createButton(f)),false);
  await oldSubmit();await settle(f);assert.equal(f.calls.filter(call=>call.action==="submit").length,0);
  await f.check();assert.equal(f.calls.at(-1).request.requestId,firstId);
  const audienceQuote=f.calls.at(-1);assert.equal(audienceQuote.request.audience,"A different audience");
  await f.changeMedium("audio");assert.equal(enabled(createButton(f)),false);
  await f.check();assert.equal(f.calls.at(-1).request.requestId,firstId);assert.equal(f.calls.at(-1).request.sceneMedium,"audio");
  await f.changeMode("manual");await f.check();assert.equal(f.calls.at(-1).request.requestId,firstId);
  assert.equal(f.calls.at(-1).request.itemCount,undefined);
  await f.submit();await settle(f);assert.equal(f.calls.filter(call=>call.action==="submit").length,1);
});

for(const locale of ["en","fr","ar","ja"])test(`Scene composer ${locale}: an old admitted request is an original receipt, never the edited draft's approval`,async t=>{
  const f=await createSceneComposer(t,{locale});await f.openScene();await f.check();
  const request=f.calls[0].request,original=await f.previewFor(request);
  f.scene.submit=async options=>{options.onDispatch();options.onResult({requestId:options.sceneRequestId,preview:null,job:null,reused:false,attemptSubmission:"unknown"});return false;};
  await f.submit();await settle(f);assert.equal(enabled(createButton(f)),false);
  await f.changeMedium("audio");await f.fill("tone","Different current tone");f.scene.count=17;
  f.scene.lookup=async current=>({requestId:current.requestId,preview:original,job:syntheticJob(current,"running")});
  await f.check();
  assert.ok(f.visible().includes(f.i18n.t("scene.cost.original")));
  assert.ok(f.visible().includes(f.i18n.t("scene.cost.plan","",{count:f.i18n.number(9),medium:f.i18n.t("scene.medium.visual"),mode:f.i18n.t("scene.cost.managed")})));
  assert.ok(f.visible().includes(f.i18n.t("scene.cost.originalCeiling","",{amount:f.i18n.number(2,{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:6})})));
  assert.equal(enabled(createButton(f)),false);assert.equal(action(f,"scene.cost.new"),undefined);
  assert.equal(f.calls.filter(call=>call.action==="submit").length,1);
});

for(const locale of ["en","fr","ar","ja"])test(`Scene composer ${locale}: only fresh completed original status permits explicit New, including expired details`,async t=>{
  for(const status of sceneJobs)for(const retained of [false,true]){
    const f=await createSceneComposer(t,{locale});await f.openScene();
    f.scene.lookup=async request=>({requestId:request.requestId,preview:retained?await f.previewFor(request):null,job:syntheticJob(request,status)});
    await f.check();const originalId=f.calls[0].request.requestId;
    assert.equal(Boolean(action(f,"scene.cost.new")),status==="completed");
    assert.equal(enabled(createButton(f)),false);
    if(!retained)assert.ok(f.visible().includes(f.i18n.t("scene.cost.detailsUnavailable")));
    if(status==="completed"){
      let reads=0;f.scene.lookup=async request=>{
        reads++;
        return request.requestId===originalId?{requestId:originalId,preview:retained?await f.previewFor(request):null,job:syntheticJob(request,"completed")}:{requestId:request.requestId,preview:await f.previewFor(request),job:null};
      };
      await invoke(f,action(f,"scene.cost.new"));await settle(f);
      assert.equal(reads,2,"one fresh completion proof then one new free quote");
      assert.notEqual(f.calls.at(-1).request.requestId,originalId);
      assert.equal(enabled(createButton(f)),true);
      assert.equal(f.calls.filter(call=>call.action==="submit").length,0);
    }else{
      await f.closeScene();await f.openScene();await f.check();
      assert.equal(f.calls.at(-1).request.requestId,originalId);
    }
  }
});

for(const locale of ["en","fr","ar","ja"])test(`Scene composer ${locale}: missing planner still permits free exact reading, but never paid Create`,async t=>{
  const f=await createSceneComposer(t,{locale});f.scene.plannerConfigured=false;
  await f.openScene();await f.check();
  assert.equal(enabled(createButton(f)),false);assert.ok(f.visible().includes(f.i18n.t("lab.unavailable")));
  assert.ok(f.visible().includes(f.i18n.t("generation.contactAdministrator")));
  await f.submit();await settle(f);assert.equal(f.calls.filter(call=>call.action==="submit").length,0);
  f.scene.lookup=async request=>({requestId:request.requestId,preview:null,job:syntheticJob(request,"running")});
  await f.check();assert.ok(action(f,"scene.cost.receipt"));assert.equal(enabled(createButton(f)),false);
});

test("Scene composer: close and route remount retain A independently of B and late A cannot clear B's busy owner",async t=>{
  const f=await createSceneComposer(t);await f.openScene();await f.check();const firstId=f.calls[0].request.requestId;
  const waits=[];
  f.scene.submit=async options=>{const gate=sceneDeferred();waits.push({gate,options});options.onDispatch();await gate.promise;options.onResult({requestId:options.sceneRequestId,preview:null,job:null,reused:false,attemptSubmission:"unknown"});return false;};
  await f.submit();await untilScene(()=>waits.length===1);
  await f.closeScene();appendDocument(f,"B");f.state.documentId="B";f.host.documentId="B";f.remount();await f.openScene();await f.check();
  const secondId=f.calls.filter(call=>call.action==="quote").at(-1).request.requestId;assert.notEqual(secondId,firstId);
  await f.submit();await untilScene(()=>waits.length===2);
  waits[0].gate.resolve();await settle(f);assert.equal(enabled(createButton(f)),false,"late A must not release B's pending submission");
  assert.equal(enabled(action(f,"scene.cost.inspect")??action(f,"scene.cost.check")),false);
  waits[1].gate.resolve();await settle(f);await f.closeScene();f.state.documentId="A";f.host.documentId="A";f.remount();await f.openScene();await f.check();
  assert.equal(f.calls.filter(call=>call.action==="quote").at(-1).request.requestId,firstId);
});

for(const boundary of ["close","source","authority","document","model","locale"])test(`Scene composer: ${boundary} withdrawal during free read discards private quote and stale controls`,async t=>{
  const f=await createSceneComposer(t);await f.openScene();const gate=sceneDeferred(),entered=sceneDeferred();
  f.scene.lookup=async request=>{entered.resolve();await gate.promise;return{requestId:request.requestId,preview:await f.previewFor(request),job:null};};
  await invoke(f,action(f,"scene.cost.check"));await entered.promise;
  if(boundary==="close")await f.closeScene();
  else if(boundary==="source"){f.scene.sourceRevision++;f.draw();}
  else if(boundary==="authority")f.withdraw();
  else if(boundary==="document"){appendDocument(f,"B");f.state.documentId="B";f.host.documentId="B";f.draw();}
  else if(boundary==="model"){f.scene.model="gpt-5.6-sol";f.draw();}
  else{localeFor(f,"fr");f.draw();}
  gate.resolve();await settle(f);
  assert.ok(!f.visible().includes(f.i18n.t("scene.cost.ready")));assert.equal(f.calls.filter(call=>call.action==="submit").length,0);
  assert.equal(enabled(createButton(f)),false);
});

test("Scene composer: source-index repair uses normal refresh and separate exact free reinspection, retaining the original ID",async t=>{
  const f=await createSceneComposer(t);await f.openScene();
  f.scene.lookup=async()=>{throw new Error("project_source_index_stale");};await f.check();
  const original=f.calls[0].request.requestId;assert.ok(action(f,"scene.cost.refreshSources"));
  await invoke(f,action(f,"scene.cost.refreshSources"));await settle(f);
  assert.equal(f.calls.filter(call=>call.action==="refresh").length,1);assert.equal(f.calls.filter(call=>call.action==="quote").length,1);
  f.scene.lookup=null;await f.check();assert.equal(f.calls.at(-1).request.requestId,original);assert.equal(enabled(createButton(f)),true);
});

test("Scene composer: 32 retained destinations bound new admissions without evicting any original handle",async t=>{
  const f=await createSceneComposer(t);let original="";
  for(let index=0;index<32;index++){
    const id=index?"D"+index:"A";if(index)appendDocument(f,id);f.state.documentId=id;f.host.documentId=id;
    await f.openScene();await f.check();if(index===0)original=f.calls.at(-1).request.requestId;await f.closeScene();
  }
  appendDocument(f,"over-capacity");f.state.documentId="over-capacity";f.host.documentId="over-capacity";await f.openScene();await f.check();
  assert.equal(f.calls.filter(call=>call.action==="quote").length,32);assert.ok(f.visible().includes(f.i18n.t("scene.cost.capacity")));assert.equal(enabled(createButton(f)),false);
  await f.closeScene();f.state.documentId="A";f.host.documentId="A";await f.openScene();await f.check();
  assert.equal(f.calls.filter(call=>call.action==="quote").length,33);assert.equal(f.calls.at(-1).request.requestId,original);assert.equal(enabled(createButton(f)),true);
});

for(const [index,locale]of ["en","fr","ar","ja"].entries())test(`Scene composer ${locale}: full component to full Store to actual Worker retains reused nine-part cost and request identity`,async t=>{
  t.mock.method(globalThis,"fetch",async()=>assert.fail("No provider or external network is permitted"));
  const h=await createSceneStoreHost({count:9,medium:index%2?"audio":"visual",shared:index>=2});t.after(()=>h.close());
  const f=await createSceneComposer(t,{locale,storeHost:h,workflow:true,medium:index%2?"audio":"visual"});await f.openScene();
  assert.equal(enabled(createButton(f)),false);await f.check();
  const free=h.requests.filter(request=>request.body?.payload?.sceneCostPreview);
  assert.equal(free.length,1);assert.equal(free[0].body.payload.itemCount,undefined);
  assert.equal(free[0].body.payload.workflowId,h.request.workflowId);assert.equal(free[0].body.payload.workflowStageId,h.request.workflowStageId);
  assert.deepEqual(free[0].body.payload.workflowSources,h.request.workflowSources);
  assert.equal(enabled(createButton(f)),true);assert.ok(f.visible().includes(f.i18n.number(2,{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:6})));
  assert.equal(h.worker.counts().document_jobs,0);assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
  await f.submit();await untilScene(()=>h.worker.counts().document_jobs===1);await settle(f);
  const paid=h.requests.filter(request=>request.body?.payload?.sceneCostConsent);
  assert.equal(paid.length,1);assert.equal(paid[0].body.payload.sceneRequestId,free[0].body.payload.sceneRequestId);
  assert.equal(paid[0].body.payload.sceneCostConsent.itemCount,9);assert.equal(paid[0].body.payload.itemCount,undefined);
  assert.equal(paid[0].body.payload.sceneCostConsent.providerCallCount,2);assert.equal(paid[0].body.payload.sceneCostConsent.maximumProviderCallCount,8);
  assert.equal(paid[0].body.payload.sceneCostConsent.maximumMicrousd,2_000_000);
  assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
});

async function seedRegenerableScene(h){
  const {env,owner,streamId,projectId,documentId}=h.worker;
  const content=JSON.stringify({title:"Saved Scene",summary:"Original written Scene",content_markdown:"The keeper hears the harbor bell.",presentation:null,
    items:[{title:"Original Scene",body:"The keeper hears the harbor bell.",notes:"Preserve the authored direction.",image_prompt:"",context_group_ids:[],slide:null}]});
  const stored=await storePrivateContent(env,owner,"document-artifact",content);
  const completed=await appendAuditEvent(env,streamId,"worker:renderer","DocumentRenderCompleted",{project_id:projectId,document_id:documentId,artifact_id:"saved-regeneration-scene",artifact_kind:"scene",title:"Saved Scene",summary:"Original written Scene",
    content_ref:stored.contentId,source_block_versions:[{block_id:"scene-reuse-direction",version:1}],item_count:1,items:[{id:"saved-scene-part",title:"Original Scene"}],scene_medium:"visual"});
  const workflow=recommendProductionWorkflow({id:h.request.workflowId,documentId,projectId,target:"video",approvalRequired:false});
  const story=workflow.stages.find(stage=>stage.format==="short_story"),scene=workflow.stages.find(stage=>stage.format==="scene");
  story.enabled=true;story.source=structuredClone(h.worker.workflow.stages[0].source);
  scene.enabled=true;scene.sceneMedium="visual";
  scene.source={outputKind:"artifact",outputId:"saved-regeneration-scene",format:"scene",documentId,sourceEventId:completed.eventId,revision:0,contentSha256:createHash("sha256").update(content).digest("hex"),approvalRequired:false,allowTextGuidance:false};
  await appendAuditEvent(env,streamId,"user",DOCUMENT_PRODUCTION_WORKFLOW_EVENT,{workflow_id:workflow.id,document_id:documentId,project_id:projectId,target_kind:workflow.target,workflow});
  await h.store.refreshEvents();
  h.request.workflowStageId=scene.id;
  const stage=()=>productionWorkflows(h.store.events.get(),documentId,projectId).find(candidate=>candidate.id===workflow.id).stages.find(candidate=>candidate.id===scene.id);
  return{stage,source:structuredClone(scene.source),workflow};
}
async function openSceneRegeneration(f){
  f.host.launcherOnly=false;f.draw();
  const button=f.buttons().find(candidate=>candidate.text.startsWith("Regenerate")&&/scene/iu.test(candidate.text));
  assert.ok(button,"actual selected Scene Regenerate action");
  await invoke(f,button);await untilScene(()=>f.renderer.ownNodes(f.host,"dialog").some(node=>node.attributes.class==="document-artifact-create"&&node.open));
  f.host.configurePresentationForTest("managed",6);f.draw();
}

test("Scene composer: actual regeneration Close after HTTP cannot restore the old source over its dispatched original request",async t=>{
  t.mock.method(globalThis,"fetch",async()=>assert.fail("No provider or external network is permitted"));
  const h=await createSceneStoreHost({count:9});t.after(()=>h.close());const original=await seedRegenerableScene(h);
  const f=await createSceneComposer(t,{storeHost:h,workflow:true});await openSceneRegeneration(f);
  assert.equal(original.stage().source,null);await f.check();assert.equal(enabled(createButton(f)),true);
  const gate=sceneDeferred(),entered=sceneDeferred();
  h.intercept=async request=>{
    if(request.url!=="/api/document-jobs"||!request.body?.payload?.sceneCostConsent)return;
    entered.resolve();await gate.promise;return h.worker.request(request.url,request.init);
  };
  try{
    await f.submit();await entered.promise;await f.closeScene();await settle(f);
    assert.equal(h.store.documentJobs.get().length,0,"the admission response is still pending, so the feed is not protection");
    assert.equal(original.stage().source,null,"dispatch owns regeneration; native Close must not restore its old workflow source");
  }finally{gate.resolve();await settle(f);}
  await untilScene(()=>h.worker.counts().document_jobs===1);
  assert.equal(original.stage().source,null);assert.equal(h.requests.filter(request=>request.body?.payload?.sceneCostConsent).length,1);
  assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
});

for(const boundary of ["append","navigation"])test(`Scene composer: actual regeneration Close before ${boundary} completes restores its source without HTTP admission`,async t=>{
  t.mock.method(globalThis,"fetch",async()=>assert.fail("No provider or external network is permitted"));
  const h=await createSceneStoreHost({count:9});t.after(()=>h.close());const original=await seedRegenerableScene(h);
  const f=await createSceneComposer(t,{storeHost:h,workflow:true});await openSceneRegeneration(f);await f.check();
  const gate=sceneDeferred();h.store.sceneGateForTest(boundary,gate.promise);
  await f.submit();await f.closeScene();gate.resolve();await settle(f);
  await untilScene(()=>original.stage().source!==null);
  assert.deepEqual(original.stage().source,original.source);assert.equal(h.requests.filter(request=>request.body?.payload?.sceneCostConsent).length,0);
  assert.equal(h.worker.counts().document_jobs,0);assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
});

test("Scene composer: a late dispatched regeneration A cannot consume or restore newly opened regeneration B",async t=>{
  t.mock.method(globalThis,"fetch",async()=>assert.fail("No provider or external network is permitted"));
  const h=await createSceneStoreHost({count:9});t.after(()=>h.close());const original=await seedRegenerableScene(h);
  const f=await createSceneComposer(t,{storeHost:h,workflow:true});await openSceneRegeneration(f);await f.check();
  const gate=sceneDeferred(),entered=sceneDeferred();
  h.intercept=async request=>{
    if(request.url!=="/api/document-jobs"||!request.body?.payload?.sceneCostConsent)return;
    const response=await h.worker.request(request.url,request.init);assert.equal(response.status,202);entered.resolve();await gate.promise;return response;
  };
  await f.submit();await entered.promise;await f.closeScene();
  const workflow={...structuredClone(original.workflow),id:"second-regeneration-workflow"};
  await appendAuditEvent(h.worker.env,h.worker.streamId,"user",DOCUMENT_PRODUCTION_WORKFLOW_EVENT,{workflow_id:workflow.id,document_id:workflow.documentId,project_id:workflow.projectId,target_kind:workflow.target,workflow});
  await h.store.refreshEvents();
  f.host.configureSceneWorkflowForTest(workflow.id,h.request.workflowStageId);
  await openSceneRegeneration(f);
  const replacement=()=>productionWorkflows(h.store.events.get(),workflow.documentId,workflow.projectId).find(candidate=>candidate.id===workflow.id).stages.find(candidate=>candidate.id===h.request.workflowStageId);
  assert.equal(replacement().source,null);
  gate.resolve();await settle(f);
  assert.equal(replacement().source,null,"old A completion must not touch B's still-editable regeneration");
  await f.closeScene();await untilScene(()=>replacement().source!==null);
  assert.deepEqual(replacement().source,original.source,"B's unsubmitted rollback must remain intact");
  assert.equal(original.stage().source,null);assert.equal(h.worker.counts().document_jobs,1);
  assert.equal(h.requests.filter(request=>request.body?.payload?.sceneCostConsent).length,1);
});

for(const locale of ["en","fr","ar","ja"])test(`Scene composer ${locale}: a failed fresh completion read scrubs old receipt and never rotates its original request`,async t=>{
  const f=await createSceneComposer(t,{locale});await f.openScene();
  f.scene.lookup=async request=>({requestId:request.requestId,preview:await f.previewFor(request),job:syntheticJob(request,"completed")});
  await f.check();const originalId=f.calls[0].request.requestId;
  assert.ok(action(f,"scene.cost.new"));f.scene.lookup=async()=>{throw new Error("scene_cost_unavailable");};
  await invoke(f,action(f,"scene.cost.new"));await settle(f);
  assert.equal(action(f,"scene.cost.new"),undefined);assert.equal(action(f,"scene.cost.receipt"),undefined);
  assert.ok(!f.visible().includes("gpt-5.6-terra"));assert.equal(enabled(createButton(f)),false);
  await f.closeScene();await f.openScene();await f.check();
  assert.equal(f.calls.at(-1).request.requestId,originalId);assert.equal(f.calls.filter(call=>call.action==="submit").length,0);
});

test("Scene composer: a thrown post-dispatch failure retains the exact handle without an unhandled retry or paid approval",async t=>{
  const f=await createSceneComposer(t);await f.openScene();await f.check();const original=f.calls[0].request.requestId;
  f.scene.submit=async options=>{options.onDispatch();throw new Error("transport unavailable");};
  await f.submit();await settle(f);assert.equal(enabled(createButton(f)),false);
  await f.closeScene();await f.openScene();await f.check();assert.equal(f.calls.at(-1).request.requestId,original);
  assert.equal(f.calls.filter(call=>call.action==="submit").length,1);
});

test("Scene composer: malformed or wrong-scope replies never become approval, and retain the same exact handle",async t=>{
  for(const change of [
    preview=>({...preview,actorUserId:"another-reader"}),preview=>({...preview,projectId:"another-project"}),
    preview=>({...preview,documentId:"another-document"}),preview=>({...preview,requestId:"another-request"}),
    preview=>({...preview,requestHash:"c".repeat(64)}),preview=>({...preview,contextSessionId:"unexpected-shared-context"}),
    preview=>({...preview,permissionEpoch:"withdrawn-epoch"}),preview=>({...preview,period:"2000-01"}),
    preview=>({...preview,model:"unobserved-model"}),preview=>({...preview,maximumMicrousd:-1}),
  ]){
    const f=await createSceneComposer(t);await f.openScene();
    f.scene.lookup=async request=>({requestId:request.requestId,preview:change(await f.previewFor(request)),job:null});
    await f.check();const id=f.calls[0].request.requestId;
    assert.equal(enabled(createButton(f)),false);assert.ok(f.visible().includes(f.i18n.t("scene.cost.unavailable")));
    await f.submit();assert.equal(f.calls.filter(call=>call.action==="submit").length,0);
    f.scene.lookup=null;await f.check();assert.equal(f.calls.at(-1).request.requestId,id);assert.equal(enabled(createButton(f)),true);
  }
});
test("Scene composer: withdrawn personal purchase permission invalidates approval and retains its handle for fresh authorized reopening",async t=>{
  const f=await createSceneComposer(t);await f.openScene();await f.check();const original=f.calls[0].request.requestId;
  const oldSubmit=f.renderer.handler(f.host,"form",node=>node.attributes.class==="document-artifact-dialog","submit");
  const oldCheck=action(f,"scene.cost.check")??action(f,"scene.cost.inspect");assert.ok(oldCheck);
  f.state.canRequest=false;f.draw();
  assert.equal(f.renderer.ownNodes(f.host,"form").some(node=>node.attributes.class==="document-artifact-dialog"),false,"Phase4 removes the inactive creation form after permission invalidation");
  assert.equal(enabled(createButton(f)),false);await oldSubmit();assert.equal(f.calls.filter(call=>call.action==="submit").length,0);
  f.scene.lookup=async request=>({requestId:request.requestId,preview:await f.previewFor(request),job:syntheticJob(request,"completed")});
  await invoke(f,oldCheck);assert.equal(action(f,"scene.cost.new"),undefined);assert.equal(f.calls.filter(call=>call.action==="submit").length,0);
  assert.equal(f.calls.filter(call=>call.action==="quote").length,1,"a detached old Check cannot restart the closed configuration");
  assert.equal(f.renderer.ownNodes(f.host,"dialog").some(node=>node.attributes.class==="document-artifact-create"),false);
  f.state.canRequest=true;await f.openScene();await f.check();
  assert.equal(f.calls.at(-1).request.requestId,original);assert.ok(action(f,"scene.cost.receipt"));assert.ok(action(f,"scene.cost.new"));
});

for(const locale of ["en","fr","ar","ja"])test(`Scene type label ${locale}: the actual workflow selector uses the same scoped term without changing generic Medium`,async t=>{
  t.mock.method(globalThis,"fetch",async()=>assert.fail("No provider or external network is permitted"));
  const h=await createSceneStoreHost({count:1});t.after(()=>h.close());
  const f=await createSceneComposer(t,{locale,storeHost:h,workflow:true});
  f.host.launcherOnly=false;f.draw();
  assert.ok(f.renderer.markup.includes('<label class="production-workflow-source production-workflow-scene-medium"><span>'+sceneTypeLabels[locale]+"</span>"));
  if(locale==="fr")assert.equal(f.i18n.t("evaluation.preview.medium"),"Moyenne","generic evaluation Medium is unchanged");
  assert.equal(h.requests.filter(request=>request.body?.payload?.sceneCostConsent||request.body?.payload?.sceneCostPreview).length,0);
  assert.equal(h.worker.counts().document_jobs,0);assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
});

for(const locale of ["en","fr","ar","ja"])test(`Scene plan grammar ${locale}: original 1/9/17 descriptors remain read-only receipts`,async t=>{
  for(const count of [1,9,17]){
    const f=await createSceneComposer(t,{locale,count});await f.openScene();
    f.scene.lookup=async request=>({requestId:request.requestId,preview:await f.previewFor(request),job:syntheticJob(request,"running")});
    await f.check();
    assert.ok(f.visible().includes(f.i18n.t("scene.cost.original")));
    assert.ok(f.visible().includes(f.i18n.t(count===1?"scene.cost.planOne":"scene.cost.plan","",{count:f.i18n.number(count),medium:f.i18n.t("scene.medium.visual"),mode:f.i18n.t("scene.cost.managed")})));
    assert.equal(enabled(createButton(f)),false);assert.equal(action(f,"scene.cost.new"),undefined);
    await f.submit();assert.equal(f.calls.filter(call=>call.action==="submit").length,0);
  }
});

for(const locale of ["en","fr","ar","ja"])test(`Scene viewer type ${locale}: exact retained output metadata uses the scoped label without generation`,async t=>{
  t.mock.method(globalThis,"fetch",async()=>assert.fail("No provider or external network is permitted"));
  const h=await createSceneStoreHost({count:1});t.after(()=>h.close());await seedRegenerableScene(h);
  const f=await createSceneComposer(t,{locale,storeHost:h,workflow:true});
  assert.equal(await f.host.openArtifactById("saved-regeneration-scene",{expectedRevision:0}),true);
  await settle(f);
  assert.ok(f.renderer.ownNodes(f.host,"dialog").some(node=>node.attributes.class==="document-artifact-view"&&node.open));
  assert.ok(f.renderer.markup.includes('<p class="artifact-scene-configuration"><b>'+sceneTypeLabels[locale]+"</b>"));
  assert.ok(f.visible().includes(f.i18n.t("scene.variant.visual")));
  assert.ok(f.visible().includes("The keeper hears the harbor bell."),"retained authored text stays unchanged");
  if(locale==="fr")assert.equal(f.i18n.t("evaluation.preview.medium"),"Moyenne");
  assert.equal(h.requests.filter(request=>request.body?.payload?.sceneCostConsent||request.body?.payload?.sceneCostPreview).length,0);
  assert.equal(h.worker.counts().document_jobs,0);assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
});

test("Scene composer normal completion: Arabic shared nine-part check waits for its actual free response",async t=>{
  const network=t.mock.method(globalThis,"fetch",async()=>assert.fail("No provider or external network is permitted"));
  t.after(()=>assert.equal(network.mock.callCount(),0));
  const h=await createSceneStoreHost({count:9,medium:"visual",shared:true});t.after(()=>h.close());
  const f=await createSceneComposer(t,{locale:"ar",storeHost:h,workflow:true,medium:"visual"});await f.openScene();
  const gate=sceneDeferred(),entered=sceneDeferred();t.after(()=>gate.resolve());
  let responseReturned=false,checkResolved=false,preview;
  h.intercept=async request=>{
    if(!request.body?.payload?.sceneCostPreview)return;
    const response=await h.worker.request(request.url,request.init),body=await response.json();
    assert.equal(response.status,200);preview=body.sceneCostPreview;
    return{ok:true,status:200,json:async()=>{entered.resolve();await gate.promise;responseReturned=true;return body;}};
  };
  const checking=f.check().then(()=>{checkResolved=true;});await entered.promise;
  // Deliberately hold the SAME successful response beyond the old finite-turn
  // fixture boundary; this does not delay, mutate, or retry production methods.
  for(let index=0;index<20;index++){await new Promise(setImmediate);f.draw();}
  const pending={checkResolved,responseReturned,checking:f.visible().includes(f.i18n.t("scene.cost.checking")),createEnabled:enabled(createButton(f))};
  gate.resolve();await checking;await sceneCheckComplete(f);
  assert.deepEqual(pending,{checkResolved:false,responseReturned:false,checking:true,createEnabled:false});
  assert.equal(enabled(createButton(f)),true,"the same response finishes without another user action or request");
  const free=h.requests.filter(request=>request.body?.payload?.sceneCostPreview);
  assert.equal(free.length,1);assert.equal(free[0].body.payload.itemCount,undefined);
  assert.equal(free[0].body.payload.workflowId,h.request.workflowId);
  assert.equal(free[0].body.payload.workflowStageId,h.request.workflowStageId);
  assert.deepEqual(free[0].body.payload.workflowSources,h.request.workflowSources);
  assert.equal(preview.requestId,free[0].body.payload.sceneRequestId);
  assert.equal(preview.itemCount,9);assert.equal(preview.providerCallCount,2);
  assert.equal(preview.maximumProviderCallCount,8);assert.equal(preview.maximumMicrousd,2_000_000);
  assert.ok(f.visible().includes(f.i18n.number(2,{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:6})));
  assert.equal(h.requests.filter(request=>request.body?.payload?.sceneCostConsent).length,0,"free inspection never becomes approval");
  assert.equal(h.worker.counts().document_jobs,0);assert.equal(h.worker.counts().budget_reservations,0);assert.equal(h.worker.counts().cost_budget_reservations,0);
});
