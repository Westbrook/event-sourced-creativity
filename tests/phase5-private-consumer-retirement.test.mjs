import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import {registerHooks} from "node:module";
import {setTimeout as setWatchdog,clearTimeout as clearWatchdog} from "node:timers";
import {sceneDeferred,untilScene} from "./helpers/scene-cost-store-host.mjs";
// A missing expected callback must fail this case, not hold the whole file open.
// Native test deadlines also bound setup and the post-entry continuation.
async function expectEntry(t,entry,operation,label){
 let timer,onAbort;
 const failure=()=>new Error("Phase5 "+label+": expected entry was not observed within 30 seconds");
 const expired=new Promise((_,reject)=>{
  timer=setWatchdog(()=>reject(failure()),30_000);
  onAbort=()=>reject(new Error("Phase5 "+label+": case canceled before expected entry"));
  t.signal.addEventListener("abort",onAbort,{once:true});
  if(t.signal.aborted)onAbort();
 });
 const candidates=[entry,expired];
 // Native card Save dispatches an event synchronously and returns void. Its
 // real downstream callback is still required, under the same finite watchdog.
 try{
  if(operation!==undefined){
   assert.equal(typeof operation?.then,"function","expected actual async operation: "+label);
   candidates.push(Promise.resolve(operation).then(
    ()=>{throw new Error("Phase5 "+label+": initiating operation completed before expected entry");},
    cause=>{throw new Error("Phase5 "+label+": initiating operation rejected before expected entry",{cause});}));
  }
  return await Promise.race(candidates);
 }finally{clearWatchdog(timer);t.signal.removeEventListener("abort",onAbort);}
}
function heldFixtureGate(t){
 const gate=sceneDeferred();
 // Observe cancellation even if an earlier assertion prevented the callback
 // from reaching its gate. Callers still await the original rejecting promise.
 void gate.promise.catch(()=>{});
 t.after(()=>gate.reject(new Error("Phase5 held fixture response canceled during case cleanup")));
 return gate;
}
async function fixtureDeclarations(file,names){
 const url=new URL(file,import.meta.url),raw=fs.readFileSync(url,"utf8"),tree=ts.createSourceFile(url.pathname,raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 let source=tree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)).map(node=>node.getFullText(tree)).join("\n")+"\nexport {"+names.join(",")+"};";
 if(file==="./assistant-specialist-consent-host.test.mjs"){
  // This donor's document is lexical to fixture(), not the ambient global.
  // Retain its real query/activeElement ports and native EventTarget semantics.
  const start="  const document = {",end="    activeElement: null,\n  };";
  assert.equal(source.split(start).length,2,"one existing assistant document port");
  assert.equal(source.split(end).length,2,"one existing assistant document end");
  source=source.replace(start,"  const document = Object.assign(new EventTarget(), {")
   .replace(end,"    activeElement: null, visibilityState: \"visible\",\n  });");
  // Complete the current Host/Panel lexical dependencies through the donor's
  // existing actual-module boundary; no substitute navigation or Memory logic.
  source+="\nconst {navigateInApp,navigationPresentationClosing}=await lifecyclePorts.loadActual(\"src/components/command-departure.ts\");"
   +"\nconst {captureOutputNavigationFocus}=await lifecyclePorts.loadActual(\"src/components/output-navigation-focus.ts\");"
   +"\nconst {personalMemoryMessage}=await lifecyclePorts.loadActual(\"src/components/design-system/locales/personal-memory-messages.ts\");"
   +"\nconst {parseMemoryAnswerPresentation}=await lifecyclePorts.loadActual(\"src/model/memory-answer.ts\");"
   +"\nconst {createMemoryElapsed}=await lifecyclePorts.loadActual(\"src/model/memory-lifetime.ts\");\n";
 }
 url.search="?phase5-private-consumer-existing-fixture";
 const hook=registerHooks({load(request,context,next){return request===url.href?{format:"module",source,shortCircuit:true}:next(request,context);}});
 try{return await import(url.href);}finally{hook.deregister();}
}

const originalFixtureRead = fs.readFileSync.bind(fs);
const probeSource = (value,name) => {
 const tree=ts.createSourceFile(name,value,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),owner=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text===name);
 assert.ok(owner,"complete actual class for state-only evidence");
 const has=field=>owner.members.some(member=>member.name?.getText(tree)===field);
 const probe=name==="FormaOutputRequirements"
 ? `retirementStateForTest(){return{editors:[...this.#editors],planning:this.#planning,preflight:this.#preflight,inspection:this.#nativeInspection,file:this.#file,packageParts:this.#packageParts,packageRelease:this.#packageRelease,urls:[...this.#downloadUrls],uncertain:this.#uncertainCommand,uploadId:this.#uploadCommandId,uploadRevision:this.#uploadRevision,uploadReceipt:${has("#uploadReceipt")?"this.#uploadReceipt":"null"},busy:this.#busy};}`
 : "retirementStateForTest(){return{session:this.#session,cache:[...this.#cache],parseProposal:this.#parseProposal};}";
 const result=value.slice(0,owner.end-1)+"\n"+probe+"\n"+value.slice(owner.end-1);
 const next=ts.createSourceFile(name,result,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS).statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text===name);
 assert.deepEqual(next.members.filter(member=>member.name?.getText()!=="retirementStateForTest").map(member=>member.getText()),owner.members.map(member=>member.getText()),"every actual production field and method unchanged by state probe");
 return result;
};
fs.readFileSync=(file,...args)=>{
 const value=originalFixtureRead(file,...args),path=String(file);
 if(typeof value!=="string")return value;
 if(path.endsWith("/src/components/forma-output-requirements.ts"))return probeSource(value,"FormaOutputRequirements");
 if(path.endsWith("/src/components/forma-output-requirement-card.ts"))return probeSource(value,"FormaOutputRequirementCard");
 if(path.endsWith("/tests/presentation-guidance-accessibility.test.mjs")){
  // Supply only the native Lit changed-property bookkeeping omitted by the old
  // renderer port. Production willUpdate handlers are not replaced or invoked
  // as cleanup substitutes; they receive the actual changed snapshot property.
  assert.ok(value.includes("Object.assign(instance, props.properties);"));
  return value.replace("requestUpdate() { this.fixture.requested = true; }",
    'requestUpdate(name,previous) { this.fixture.requested = true; if(name){this.nativeChangedProperties??=new Map();if(!this.nativeChangedProperties.has(name))this.nativeChangedProperties.set(name,previous);} }')
   .replace("Object.assign(instance, props.properties);","const changedProperties=new Map(Object.entries(props.properties).filter(([key,value])=>instance[key]!==value).map(([key])=>[key,instance[key]])); Object.assign(instance, props.properties);")
   .replace("instance.willUpdate?.(new Map());","instance.willUpdate?.(changedProperties);");
 }
 return value;
};
let existing;
try { existing=await fixtureDeclarations("./output-source-refresh.test.mjs",["sourceFixture","workers","sourcePath","outputPath","ui"]); }
finally { fs.readFileSync=originalFixtureRead; }

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function sourceFixture(t,options){
 const f=await existing.sourceFixture(t,options),draw=f.draw;
 f.draw=()=>{
  for(const {instance} of f.renderer.instances.values())if(instance.nativeChangedProperties?.size){
   const changed=instance.nativeChangedProperties;instance.nativeChangedProperties=new Map();instance.willUpdate?.(changed);
  }
  return draw();
 };
 const retired=event=>{for(const handler of f.listeners.get("forma-event-source-retired")??[])handler(event);};
 f.storeHost.window.addEventListener("forma-event-source-retired",retired);
 t.after(()=>f.storeHost.window.removeEventListener("forma-event-source-retired",retired));
 return f;
}
const sourcePath=request=>request.url.startsWith("/api/events?")&&(request.init.method??"GET")==="GET";
test("a current generic source denial retires the actual warm Output client and complete controller",{timeout:60_000},async t=>{
 const f=await sourceFixture(t,{retained:true});
 await f.refresh();await f.flush();f.draw();
 const doc=existing.workers.doc,initial=f.store.outputRequirements.resource(doc).snapshot;
 assert.ok(initial&&initial.requirements[0].content);
 const content=initial.requirements[0].content,scope=f.store.captureAuthorizationScope().key;
 assert.ok(f.visible().includes(content),"actual existing private requirement text is visible before denial");
 let denied=0;f.storeHost.intercept=request=>sourcePath(request)?(denied++,new Response("{",{status:403})):undefined;
 await f.store.refreshEvents().catch(()=>{});await tick();f.draw();
 const resource=f.store.outputRequirements.resource(doc);
 assert.equal(f.store.captureAuthorizationScope()?.key,scope,"source retirement does not forge real authorization");
 assert.equal(denied,1);assert.equal(resource.snapshot,null,"general source403 must hide cached Output private data");
 assert.ok(!f.visible().includes(content),"mounted complete Output controller must hide retired private text");
});
test("a pending old Output body cannot publish after source denial followed by an actual fresh source restoration",{timeout:60_000},async t=>{
 const f=await sourceFixture(t,{retained:true});await f.refresh();await f.flush();f.draw();
 const doc=existing.workers.doc,saved=structuredClone(f.store.outputRequirements.resource(doc).snapshot);
 const pendingBody=heldFixtureGate(t),entered=sceneDeferred();let outputReads=0,sourceDenials=0;
 f.storeHost.intercept=request=>existing.outputPath(request)?(outputReads++,{status:200,ok:true,headers:new Headers(),json:async()=>{entered.resolve();return pendingBody.promise;}})
  :sourcePath(request)?(sourceDenials++,new Response("{",{status:403})):undefined;
 const old=f.store.outputRequirements.ensure(doc,{force:true});await expectEntry(t,entered.promise,old,"old Output response body");
 await f.store.refreshEvents().catch(()=>{});
 f.storeHost.intercept=undefined;await f.store.refreshEvents();await tick();
 const before=f.store.outputRequirements.resource(doc);
 pendingBody.resolve({...saved,revision:"old-output-after-source-recovery"});await old;f.draw();
 const after=f.store.outputRequirements.resource(doc);
 assert.ok(f.store.projection.get().documents.some(row=>row.id===doc));assert.notEqual(before.snapshot?.revision,"old-output-after-source-recovery");
 assert.equal(outputReads,1);assert.equal(sourceDenials,1);
 assert.notEqual(after.snapshot?.revision,"old-output-after-source-recovery","a restored source does not make the older private response current");
});
const assistantExisting=await fixtureDeclarations("./assistant-specialist-consent-host.test.mjs",["fixture","sampleTurn","savedTask","preview","specialistResponse"]);
async function actualSourceAssistant(t,{selected=true,quoted=false}={}){
 const source=await sourceFixture(t,{retained:selected,selected});if(selected)await source.refresh();await source.flush();source.draw();
 source.store.route.set("/document/"+existing.workers.doc+"/retirement-proof");
 const a=assistantExisting.fixture(t);a.host.store=source.store;a.host.connectedCallback();
 t.after(()=>{a.host.closeForTest();for(const call of a.calls)call.gate.reject(new Error("Phase5 assistant response canceled during case cleanup"));});
 const retireAssistant=event=>a.window.dispatchEvent(event);source.storeHost.window.addEventListener("forma-event-source-retired",retireAssistant);t.after(()=>source.storeHost.window.removeEventListener("forma-event-source-retired",retireAssistant));
 const assistantTransport=request=>new URL(request.url,"https://forma.invalid").pathname.startsWith("/api/assistant")?a.store.guardedFetch(new URL(request.url,"https://forma.invalid"),request.init,"free existing specialist receipt"):undefined;
 source.storeHost.intercept=assistantTransport;source.assistantTransport=assistantTransport;
 Object.assign(a.context.scope,{projectId:existing.workers.project,documentId:existing.workers.doc,actorUserId:source.store.session.get().user.userId});
 const turn=assistantExisting.sampleTurn();turn.originalRequest={...turn.originalRequest,projectId:existing.workers.project,documentId:existing.workers.doc,route:source.store.route.get()};
 const task=assistantExisting.savedTask({id:"approval-a"});
 // The unchanged donor open() steps, exposed here only to observe its loading
 // promise if the real host refuses the expected GET.
 const loading=a.host.openForTest(),initialCall=await expectEntry(t,a.take(),loading,"assistant initial GET");
 assert.equal(initialCall.body,null);
 await a.reply(initialCall,{context:a.context,turns:[turn],tasks:quoted?[]:[task]});await loading;
 const opening=a.host.reviewForTest({turnId:turn.id,...(quoted?{}:{task})}),call=await expectEntry(t,a.take(),opening,"assistant "+(quoted?"quote":"resume")+" request");
 assert.equal(call.body.action,quoted?"quote":"resume","only a free preview or existing exact FREE specialist lookup");
 const payload=assistantExisting.specialistResponse(assistantExisting.preview({status:quoted?"quoted":"uncertain",canExecute:quoted,projectId:existing.workers.project,documentId:existing.workers.doc}),quoted?{}:{task});
 payload.originalRequest.route=source.store.route.get();
 await a.reply(call,payload);await opening;
 assert.ok(a.host.snapshotForTest().specialist.quote.privateInput);
 a.host.render();assert.equal(a.host.snapshotForTest().specialist?.executionId,payload.executionId,"healthy same-route actual render retains original review");
 return{source,a,payload};
}
test("actual assistant keeps only original recovery IDs after a generic source403",{timeout:60_000},async t=>{
 const {source,a}=await actualSourceAssistant(t),before=a.host.snapshotForTest().specialist;
 source.storeHost.intercept=request=>sourcePath(request)?new Response("{",{status:403}):source.assistantTransport(request);
 await source.store.refreshEvents().catch(()=>{});a.host.render();
 const after=a.host.snapshotForTest();
 assert.equal(after.tasks.find(row=>row.executionId===before.executionId)?.bindingHash,"hash-a");
 assert.equal(after.specialist?.executionId,before.executionId,"original execution must remain recoverable");
 assert.equal(after.specialist?.quote,null,"a source denial must retire private specialist input");
 assert.equal(after.turns.length,0,"source-owned transcript bytes retire");
});
test("actual assistant older exact response cannot restore private bytes after actual source restoration",{timeout:60_000},async t=>{
 const {source,a,payload}=await actualSourceAssistant(t);
 const pending=a.host.requestForTest("resume"),call=await expectEntry(t,a.take(),pending,"older assistant resume request"),entered=sceneDeferred(),body=heldFixtureGate(t);
 call.gate.resolve({status:200,ok:true,json:async()=>{entered.resolve();return body.promise;}});await expectEntry(t,entered.promise,pending,"older assistant resume body");
 source.storeHost.intercept=request=>sourcePath(request)?new Response("{",{status:403}):source.assistantTransport(request);
 await source.store.refreshEvents().catch(()=>{});
 source.storeHost.intercept=source.assistantTransport;await source.store.refreshEvents();
 body.resolve({...payload,quote:{...payload.quote,privateInput:{old:"OLDER_PRIVATE_ASSISTANT_INPUT"}}});await pending;
 const state=a.host.snapshotForTest();
 assert.deepEqual(a.calls.map(row=>row.body?.action??"get"),["get","resume","resume"],"no replacement purchase or automatic retry");
 assert.equal(state.specialist?.executionId,payload.executionId);
 assert.ok(!JSON.stringify(state).includes("OLDER_PRIVATE_ASSISTANT_INPUT"),"no old exact body publishes after restored source");
});
const {png}=await import("./output-asset-fixtures.mjs");
const {instrumentD1Contract}=await import("./output-d1-test-contract.mjs");
const {enforceD1ExpressionDepth}=await import("./helpers/d1-expression-depth.mjs");
const {inheritRuntimeSchemaReadiness}=await import("../worker/runtime.ts");
// Contract instrumentation preserves the initialized SQLite binding, not its
// object identity. Inherit only the runtime's proven readiness before depth checks.
const formEvent=node=>({currentTarget:node,target:node,preventDefault(){},stopPropagation(){}});
const nodes=(f,owner,tag)=>f.renderer.ownNodes(owner,tag);
async function warm(t,locale="en"){
 const f=await sourceFixture(t,{retained:true,locale});await f.refresh();await f.flush();f.draw();
 assert.ok(f.controller.retirementStateForTest,"actual complete controller with state-only evidence getter");
 return f;
}
function cardFor(f){const card=[...f.renderer.instances.values()].map(row=>row.instance).find(value=>value.tag==="forma-output-requirement-card"&&value.isConnected);assert.ok(card);return card;}
async function openCard(f){
 const card=cardFor(f),button=nodes(f,card,"button").find(node=>node.handlers.click?.name==="#open");assert.ok(button);
 await button.handlers.click.call(card,formEvent(button));await f.flush();
 assert.ok(card.retirementStateForTest().session,"healthy existing Edit creates a real draft");return card;
}
async function openPlan(f){
 const button=nodes(f,f.controller,"button").find(node=>node.handlers.click?.toString().includes("#openPlan"));assert.ok(button);
 await button.handlers.click.call(f.controller,formEvent(button));await f.flush();
 assert.ok(f.controller.retirementStateForTest().planning);
}
function actualOutput(f,request){
 const url=new URL(request.url,"http://localhost");
 assert.ok(url.pathname==="/api/output-requirements"||url.pathname.startsWith("/api/output-requirements/assets")||url.pathname.startsWith("/api/output-requirements/deliveries"),"only existing Output route");
 const headers=new Headers(request.init.headers);headers.set("cookie",f.db.cookie);
 return existing.workers.handleOutputRequirements(new Request("http://localhost"+url.pathname+url.search,{...request.init,headers}),f.db.env,url.pathname,{waitUntil(){assert.fail("No background/provider execution");}});
}
async function retire(f,status=403){
 const prior=f.storeHost.intercept;f.storeHost.intercept=request=>sourcePath(request)?new Response("{",{status}):prior?.(request);
 await f.store.refreshEvents().catch(()=>{});await f.flush();f.draw();
 assert.equal(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),false);
 assert.equal(f.store.outputRequirements.resource(existing.workers.doc).snapshot,null);
 return prior;
}
function bookkeeping(f){
 const names=f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name).filter(name=>/budget|reservation|document_jobs|assistant_tasks|consequential_/u.test(name));
 return Object.fromEntries(names.map(name=>[name,f.db.sqlite.prepare('SELECT * FROM "'+name+'"').all()]));
}
async function stage(f,action){
 if(action==="confirm"){
  await openPlan(f);const form=nodes(f,f.controller,"form").find(node=>node.handlers.submit?.name==="#confirm");assert.ok(form);
  return()=>form.handlers.submit.call(f.controller,formEvent(form));
 }
 if(action==="save"){
  const card=await openCard(f),field=nodes(f,card,"input").find(node=>node.attributes.name==="packageLabel");assert.ok(field);
  field.value="PRIVATE_NEW_REQUIREMENT_LABEL";field.handlers.input.call(card,{currentTarget:field,target:field,isComposing:false});await f.flush();
  const form=nodes(f,card,"form").find(node=>node.handlers.submit);assert.ok(form);
  return()=>form.handlers.submit.call(card,formEvent(form));
 }
 assert.equal(action,"adopt");
 const file=nodes(f,f.controller,"input").find(node=>node.attributes.type==="file");assert.ok(file);
 file.handlers.change.call(f.controller,{target:{files:[new File([png({width:2,height:2})],"PRIVATE_OWNED_UPLOAD.png",{type:"image/png"})]}});
 const form=nodes(f,f.controller,"form").find(node=>node.handlers.submit?.name==="#upload");assert.ok(form);
 const rights=nodes(f,f.controller,"input").find(node=>node.attributes.type==="checkbox"&&node.handlers.change?.toString().includes("#rightsConfirmed"));assert.ok(rights);
 rights.handlers.change.call(f.controller,{currentTarget:{checked:true},target:{checked:true}});await f.flush();
 assert.ok(f.controller.retirementStateForTest().file);return()=>form.handlers.submit.call(f.controller,formEvent(form));
}
for(const locale of["en","fr","ar","ja"])test("source403 clears real raw card and plan editors, retaining localized recovery: "+locale,{timeout:60_000},async t=>{
 const f=await warm(t,locale),card=await openCard(f);
 const field=nodes(f,card,"textarea").find(node=>node.attributes.name==="originalText");assert.ok(field);
 field.value="PRIVATE_UNSAVED_PROSE";field.handlers.input.call(card,{currentTarget:field,target:field,isComposing:false});await f.flush();
 assert.equal(card.retirementStateForTest().session.originalText,"PRIVATE_UNSAVED_PROSE");
 await openPlan(f);assert.ok(JSON.stringify(f.controller.retirementStateForTest().planning).includes("One image"));
 const before=bookkeeping(f);await retire(f);
 const state=f.controller.retirementStateForTest();
 assert.equal(state.planning,null);assert.deepEqual(state.editors,[]);assert.equal(state.file,null);assert.equal(state.preflight,null);
 assert.equal(card.retirementStateForTest().session,null,"actual changed snapshot clears the child private edit owner");
 assert.deepEqual(card.retirementStateForTest().cache,[]);assert.equal(card.retirementStateForTest().parseProposal,null);
 assert.ok(!f.visible().includes("PRIVATE_UNSAVED_PROSE"));assert.ok(!f.visible().includes("One image at"));
 assert.ok(!f.visible().includes("output_client_scope_changed"),"machine code itself is never displayed");
 const labels=await existing.ui.loadActual("src/components/design-system/locales/output-delivery-runtime-messages.ts"),descriptor=labels.outputDeliveryMessageDescriptor("output_client_scope_changed");
 assert.ok(f.visible().includes(f.i18n.t(descriptor.id,labels.FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.en[descriptor.id],descriptor.values)),"existing localized withdrawal notice");
 assert.deepEqual(bookkeeping(f),before);assert.equal(f.storeHost.requests.filter(row=>row.init.method==="POST").length,0);
});
for(const action of["save","confirm","adopt"])for(const restore of[false,true])test("actual "+action+" acknowledgment survives source retirement"+(restore?" and later restored source":""),{timeout:60_000},async t=>{
 const f=await warm(t),before=bookkeeping(f),originalDb=f.db.env.DB,contract=instrumentD1Contract(f.db);
 inheritRuntimeSchemaReadiness(originalDb,f.db.env.DB);
 const depth=enforceD1ExpressionDepth(f.db);
 const bodyGate=heldFixtureGate(t),entered=sceneDeferred();let original=null,wire=null,writes=0;
 f.storeHost.intercept=async request=>{
  if(request.init.method!=="POST")return undefined;
  try{
  writes++;assert.equal(writes,1,"no automatic write/retry");
  const response=await actualOutput(f,request);assert.equal(response.status,200,await response.clone().text());
  wire=await response.json();original={request,wire};
  return{ok:true,status:200,headers:response.headers,json:async()=>{entered.resolve();return bodyGate.promise;}};
  }catch(error){entered.reject(error);throw error;}
 };
 const submit=await stage(f,action),pending=submit();await expectEntry(t,entered.promise,pending,action+" acknowledgment body");
 const owner=f.controller.retirementStateForTest();
 const id=action==="save"?owner.editors[0][1].clientMutationId:action==="adopt"?owner.uploadId:owner.uncertain.id;
 const requestId=action==="adopt"?new Headers(original.request.init.headers).get("x-output-client-mutation-id"):original.request.body.clientMutationId;
 assert.equal(id,requestId);assert.ok(id);
 assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE event_id=?").get(wire.command.eventId).count,1,"actual canonical original event committed");
 const prior=await retire(f),retired=f.controller.retirementStateForTest();
 if(action==="confirm"){assert.equal(retired.uncertain.id,id);assert.match(retired.uncertain.signature,/^[a-f0-9]{64}$/u);assert.ok(!JSON.stringify(retired.uncertain).includes("One image"));}
 if(action==="save")assert.equal(retired.editors[0][1].clientMutationId,id);
 if(action==="adopt"){assert.equal(retired.uploadId,id);assert.equal(retired.file,null);}
 if(restore){f.storeHost.intercept=undefined;await f.store.refreshEvents();assert.equal(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),true);}
 else f.storeHost.intercept=prior;
 bodyGate.resolve(wire);await pending;await f.flush();
 const after=f.controller.retirementStateForTest(),ack=action==="save"?after.editors[0][1].receipt:action==="adopt"?after.uploadReceipt:after.uncertain.receipt;
 assert.deepEqual(ack,{committed:true,clientMutationId:id,action,eventId:wire.command.eventId},"same canonical acknowledgment is retained before private continuation");
 assert.equal(f.store.outputRequirements.resource(existing.workers.doc).snapshot,null,"older successful body cannot republish source");
 assert.ok(!JSON.stringify(after).includes("PRIVATE_NEW_REQUIREMENT_LABEL"));assert.equal(after.file,null);assert.equal(after.planning,null);
 assert.equal(writes,1);assert.deepEqual(bookkeeping(f),before,"free saves/uploads/plan confirmation create no paid holds or jobs");
 assert.deepEqual(contract.violations,[]);depth.assertVerified();depth.restore();
});

for(const selected of[true,false])for(const status of[401,403,404])test("assistant original IDs survive actual "+status+" source retirement: "+(selected?"selected current project":"cookie-free owner"),{timeout:60_000},async t=>{
 const {source,a,payload}=await actualSourceAssistant(t,{selected}),original=a.host.snapshotForTest().specialist;
 const authority=source.store.captureAuthorizationScope().key;
 await retire(source,status);a.host.render();
 const retired=a.host.snapshotForTest();
 assert.equal(source.store.captureAuthorizationScope().key,authority);
 assert.equal(retired.specialist.executionId,original.executionId);assert.equal(retired.specialist.task.bindingHash,"hash-a");
 assert.equal(retired.specialist.quote,null);assert.equal(retired.specialist.originalRequest,null);assert.equal(retired.specialist.resultReply,null);
 assert.deepEqual(retired.turns,[]);assert.deepEqual(retired.messages,[]);
 const count=a.calls.length;
 await a.host.requestForTest("execute");await a.host.requestForTest("quote");await a.host.sendForTest("no new private request");
 assert.equal(a.calls.length,count,"withdrawal cannot initiate a new command or purchase");
 const recovery=a.host.requestForTest("resume"),call=await expectEntry(t,a.take(),recovery,"retired assistant resume request");
 assert.deepEqual(call.body,{action:"resume",turnId:"turn-a",executionId:"approval-a"});
 await a.reply(call,payload);await recovery;
 const recovered=a.host.snapshotForTest().specialist;
 assert.equal(recovered.executionId,"approval-a");assert.equal(recovered.task.bindingHash,"hash-a");
 assert.equal(recovered.working,false);assert.equal(recovered.quote,null,"a source-inactive exact lookup retains metadata only");
 assert.equal(recovered.retrievalOnly,true);
});
for(const corruption of["none","wrong-turn","wrong-execution","wrong-hash","wrong-task","body-error"])test("late original specialist receipt after source403: "+corruption,{timeout:60_000},async t=>{
 const {source,a,payload}=await actualSourceAssistant(t,{quoted:true}),gate=heldFixtureGate(t),entered=sceneDeferred();
 const executing=a.host.requestForTest("execute"),call=await expectEntry(t,a.take(),executing,"original assistant execute request");assert.equal(call.body.action,"execute");
 call.gate.resolve({status:200,ok:true,json:async()=>{entered.resolve();return gate.promise;}});await expectEntry(t,entered.promise,executing,"original assistant execute body");
 await retire(source);a.host.render();
 const before=a.host.snapshotForTest().specialist;assert.equal(before.executionId,"approval-a");assert.equal(before.task.bindingHash,"hash-a");
 const task=assistantExisting.savedTask({id:"approval-a",status:"completed",submission:"settled"});
 const body={...payload,quote:{...payload.quote,status:"completed",canExecute:false},task,result:{reply:{text:"PRIVATE_SETTLED_SPECIALIST_REPLY"},sourceStatus:"original-approved-source"}};
 if(corruption==="wrong-turn")body.turnId="foreign-turn";
 if(corruption==="wrong-execution")body.executionId="foreign-execution";
 if(corruption==="wrong-hash"){body.quote.bindingHash="foreign-hash";body.task.bindingHash="foreign-hash";}
 if(corruption==="wrong-task")body.task.id="foreign-task";
 if(corruption==="body-error")gate.reject(new Error("Lost original body"));else gate.resolve(body);
 await executing;
 const after=a.host.snapshotForTest();assert.equal(after.specialist.executionId,"approval-a");assert.equal(after.specialist.task.bindingHash,"hash-a");
 assert.equal(after.specialist.quote,null);assert.equal(after.specialist.originalRequest,null);assert.equal(after.specialist.resultReply,null);assert.equal(after.specialist.working,false);
 assert.ok(!JSON.stringify(after).includes("PRIVATE_SETTLED_SPECIALIST_REPLY"));
 const receipt=after.tasks.find(task=>task.executionId==="approval-a");
 assert.equal(receipt.submission,corruption==="none"?"settled":undefined,"only the exact original matched response acknowledges its settlement");
 assert.equal(receipt.recoveryOnly,true);assert.equal(receipt.canExecute,false);
 assert.deepEqual(a.calls.map(row=>row.body?.action??"get"),["get","quote","execute"],"no follow-up paid/read execution");
});


const fullPage=await import("./helpers/calm-full-page-fixture.mjs");
async function fullSourceShell(t,locale="en"){
 const base=await warm(t,locale),h=base.storeHost,events=h.store.events.get(),content=h.store.content.get(),head=h.store.head.get(),session=h.store.session.get();
 base.controller.disconnectedCallback();base.controller.isConnected=false;
 h.worker.streamId=events[0].streamId;
 const rootRead=fs.readFileSync.bind(fs);
 fs.readFileSync=(file,...args)=>{
  const value=rootRead(file,...args),name=String(file);
  if(typeof value!=="string")return value;
  return name.endsWith("/src/components/forma-output-requirements.ts")?probeSource(value,"FormaOutputRequirements"):
   name.endsWith("/src/components/forma-output-requirement-card.ts")?probeSource(value,"FormaOutputRequirementCard"):value;
 };
 let f;try{f=await fullPage.createCalmFullPage(t,{storeHost:h,locale});}finally{fs.readFileSync=rootRead;}
 h.store.events.set(events);h.store.content.set(content);h.store.head.set(head);h.store.session.set(session);h.store.route.set("/document/"+existing.workers.doc+"/retirement-proof");
 await f.settle();f.draw();f.db=base.db;f.storeHost=h;
 f.findController=()=>f.components().find(component=>component.tag==="forma-output-requirements"&&!component.blockId&&component.documentId===existing.workers.doc);
 f.controller=f.findController();assert.ok(f.controller);assert.ok(f.controller.retirementStateForTest);
 const forward=event=>{for(const handler of f.listeners.get("forma-event-source-retired")??[])handler(event);};
 h.window.addEventListener("forma-event-source-retired",forward);t.after(()=>h.window.removeEventListener("forma-event-source-retired",forward));
 return f;
}
async function revokeFullSource(f){
 f.db.sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id=?").run(new Date().toISOString(),f.db.organizationId,existing.workers.owner);
 const before=f.storeHost.requests.length;await f.store.refreshEvents().catch(()=>{});await f.settle();f.draw();
 assert.ok(f.storeHost.requests.slice(before).some(sourcePath),"actual Store general source GET was requested");
 assert.equal(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),false);
 assert.equal(f.store.outputRequirements.resource(existing.workers.doc).snapshot,null);
 assert.equal(f.components().filter(component=>component.tag==="forma-output-requirements").length,0,"actual source-empty parent removes every Output owner");
}
async function restoreFullSource(f){
 f.db.sqlite.prepare("UPDATE organization_memberships SET status='active',revoked_at=NULL WHERE organization_id=? AND user_id=?").run(f.db.organizationId,existing.workers.owner);
 await f.store.refreshEvents();await f.settle();f.draw();
 assert.equal(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),true);
 f.controller=f.findController();assert.ok(f.controller,"the actual parent creates a new Output owner after its fresh authorized source200");
 await f.store.outputRequirements.ensure(existing.workers.doc,{force:true});await f.settle();f.draw();
}
async function fullStageSave(f){
 const card=cardFor(f),open=nodes(f,card,"button").find(node=>node.handlers.click?.name==="#open");assert.ok(open);
 await open.handlers.click.call(card,formEvent(open));await f.settle();
 const field=nodes(f,card,"input").find(node=>node.attributes.name==="packageLabel");assert.ok(field,"actual current native editor");
 field.value="PRIVATE_NEW_REQUIREMENT_LABEL";field.handlers.input.call(card,{currentTarget:field,target:field,isComposing:false});await f.settle();
 const form=nodes(f,card,"form").find(node=>node.handlers.submit);assert.ok(form);
 return()=>form.handlers.submit.call(card,formEvent(form));
}
for(const action of["save","confirm","adopt"])for(const late of["committed","lost"])test("actual Shell retains original "+action+" transport ID across genuine source403 and fresh200: "+late,{timeout:60_000},async t=>{
 const f=await fullSourceShell(t),h=f.storeHost,doc=existing.workers.doc,paidBefore=bookkeeping(f);
 const originalDb=f.db.env.DB,contract=instrumentD1Contract(f.db);
 inheritRuntimeSchemaReadiness(originalDb,f.db.env.DB);
 const depth=enforceD1ExpressionDepth(f.db);
 const gate=heldFixtureGate(t),entered=sceneDeferred();let wire=null,writes=0,sourceStatus=[];
 h.intercept=async request=>{
  if(sourcePath(request)){const response=await h.worker.request(request.url,request.init);sourceStatus.push(response.status);return response;}
  if(request.init.method!=="POST")return undefined;
  try{
  writes++;assert.equal(writes,1,"no replacement or automatic write");
  const response=await actualOutput(f,request);assert.equal(response.status,200,await response.clone().text());wire=await response.json();
  return{ok:true,status:200,headers:response.headers,json:async()=>{entered.resolve();await gate.promise;if(late==="lost")throw new Error("deliberately lost original response");return wire;}};
  }catch(error){entered.reject(error);throw error;}
 };
 const submit=action==="save"?await fullStageSave(f):await stage(f,action),pending=submit();await expectEntry(t,entered.promise,pending,"Shell "+action+" response body");
 const original=h.store.outputRequirements.retainedWrite?.(doc);
 assert.ok(original,"existing Store-owned transport retains original ID before its component can unmount");
 assert.equal(original.status,"pending");assert.equal(original.action,action);assert.match(original.digest,/^[a-f0-9]{64}$/u);
 assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE event_id=?").get(wire.command.eventId).count,1);
 const oldControllers=f.components().filter(component=>component.tag==="forma-output-requirements");
 await revokeFullSource(f);
 assert.equal(sourceStatus.at(-1),403,"the real Worker, not a substituted denial body, rejected revoked membership");
 for(const owner of oldControllers){assert.equal(owner.isConnected,false);assert.equal(owner.retirementStateForTest().planning,null);}
 const retired=h.store.outputRequirements.retainedWrite(doc);
 assert.equal(retired.clientMutationId,original.clientMutationId);assert.equal(retired.sourceRetired,true);
 assert.ok(!JSON.stringify(retired).includes("PRIVATE_"));assert.ok(!JSON.stringify(retired).includes("One image"));
 await restoreFullSource(f);assert.equal(sourceStatus.at(-1),200);
 assert.notEqual(f.controller,oldControllers.find(owner=>!owner.blockId),"full parent reentry is a new controller, not the old mounted fixture");
 const recovery=h.store.outputRequirements.retainedWrite(doc);assert.equal(recovery.clientMutationId,original.clientMutationId);assert.equal(recovery.status,"pending");
 const receiptField=nodes(f,f.controller,"textarea").find(node=>node.attributes.readonly!==undefined&&String(node.properties.value).includes(original.clientMutationId));
 assert.ok(receiptField,"original ID is reachable through existing localized technical receipt UI after reentry");
 const before=f.storeHost.requests.filter(row=>row.init.method==="POST").length;
 const different=await stage(f,"confirm");await different();await f.settle();
 assert.equal(f.storeHost.requests.filter(row=>row.init.method==="POST").length,before,"new reentry cannot dispatch a different body or allocate a replacement owner");
 assert.equal(h.store.outputRequirements.retainedWrite(doc).clientMutationId,original.clientMutationId);
 gate.resolve();await pending;await untilScene(()=>h.store.outputRequirements.retainedWrite(doc)?.status!=="pending");await f.settle();f.draw();
 const final=h.store.outputRequirements.retainedWrite(doc);assert.equal(final.clientMutationId,original.clientMutationId);assert.equal(final.digest,original.digest);
 assert.equal(final.status,late==="committed"?"acknowledged":"unknown");
 if(late==="committed")assert.deepEqual(final.receipt,{committed:true,clientMutationId:original.clientMutationId,action,eventId:wire.command.eventId});
 else{assert.equal(final.receipt,undefined);await different();await f.settle();assert.equal(h.store.outputRequirements.retainedWrite(doc).clientMutationId,original.clientMutationId);}
 assert.equal(writes,1);assert.deepEqual(bookkeeping(f),paidBefore,"no new paid hold, release, generation, or assistant work");
 assert.deepEqual(contract.violations,[]);depth.assertVerified();depth.restore();
});


test("healthy exact native confirmation retry reuses the real command and never creates another event",{timeout:60_000},async t=>{
 const f=await warm(t),before=bookkeeping(f),originalDb=f.db.env.DB,contract=instrumentD1Contract(f.db);
 inheritRuntimeSchemaReadiness(originalDb,f.db.env.DB);
 const depth=enforceD1ExpressionDepth(f.db),requests=[];
 let eventId="";
 f.storeHost.intercept=async request=>{
  if(request.init.method!=="POST")return undefined;
  requests.push(request);const response=await actualOutput(f,request);assert.equal(response.status,200,await response.clone().text());
  const body=await response.json();eventId ||= body.command.eventId;assert.equal(body.command.eventId,eventId);
  if(requests.length===1)return{status:200,ok:true,headers:response.headers,json:async()=>{throw new Error("the real committed response was lost");}};
  assert.equal(body.replayed,true);return Response.json(body);
 };
 await(await stage(f,"confirm"))();await f.flush();
 const original=f.store.outputRequirements.retainedWrite(existing.workers.doc);
 assert.equal(original.status,"unknown");assert.equal(original.sourceRetired,undefined);
 const retryForm=nodes(f,f.controller,"form").find(node=>node.handlers.submit?.name==="#confirm");assert.ok(retryForm,"original uncertain review stays open for a deliberate exact retry");
 await retryForm.handlers.submit.call(f.controller,formEvent(retryForm));await f.flush();
 assert.equal(requests.length,2);assert.equal(requests[0].body.clientMutationId,original.clientMutationId);
 assert.equal(requests[1].body.clientMutationId,original.clientMutationId);assert.deepEqual(requests[1].body,requests[0].body);
 assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands WHERE command_key=?").get(original.clientMutationId).count,1);
 assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE event_id=?").get(eventId).count,1);
 const final=f.store.outputRequirements.retainedWrite(existing.workers.doc);assert.equal(final.status,"acknowledged");assert.equal(final.receipt.eventId,eventId);
 assert.deepEqual(bookkeeping(f),before);assert.deepEqual(contract.violations,[]);depth.assertVerified();depth.restore();
});
for(const locale of["en","fr","ar","ja"])test("neutral no-dispatch reply releases the actual card waiting state without discarding newer typing: "+locale,{timeout:60_000},async t=>{
 const f=await warm(t,locale),before=bookkeeping(f);let writes=0;
 f.storeHost.intercept=async request=>{
  if(request.init.method!=="POST")return undefined;writes++;assert.equal(writes,1);
  const response=await actualOutput(f,request);assert.equal(response.status,200,await response.clone().text());
  return{status:200,ok:true,headers:response.headers,json:async()=>{throw new Error("original real save response lost");}};
 };
 const card=cardFor(f);await(await stage(f,"save"))();
 await untilScene(()=>f.store.outputRequirements.retainedWrite(existing.workers.doc)?.status==="unknown");await f.flush();f.draw();
 const original=f.store.outputRequirements.retainedWrite(existing.workers.doc);
 const field=nodes(f,card,"input").find(node=>node.attributes.name==="packageLabel");assert.ok(field);
 field.value="PRIVATE_NEWER_HUMAN_DRAFT";field.handlers.input.call(card,{currentTarget:field,target:field,isComposing:false});await f.flush();
 const form=nodes(f,card,"form").find(node=>node.handlers.submit);assert.ok(form);
 form.handlers.submit.call(card,formEvent(form));await f.flush();f.draw();
 const editor=f.controller.retirementStateForTest().editors.find(([id])=>id===card.snapshot.requirementId)?.[1];assert.equal(editor.status,"not-attempted");
 assert.equal(card.retirementStateForTest().session.label,"PRIVATE_NEWER_HUMAN_DRAFT","new typing remains only in its original editor");
 const current=nodes(f,card,"input").find(node=>node.attributes.name==="packageLabel");assert.ok(current);assert.notEqual(current.properties.disabled,true,"actual matched no-dispatch reply stops waiting");
 const cancel=nodes(f,card,"button").find(node=>node.handlers.click?.name==="#cancel");assert.ok(cancel);assert.notEqual(cancel.properties.disabled,true);
 assert.deepEqual(f.store.outputRequirements.retainedWrite(existing.workers.doc),original);assert.equal(writes,1);assert.deepEqual(bookkeeping(f),before);
 const labels=await existing.ui.loadActual("src/components/design-system/locales/output-delivery-runtime-messages.ts"),descriptor=labels.outputDeliveryMessageDescriptor("output_client_write_not_attempted");
 assert.ok(f.visible().includes(f.i18n.t(descriptor.id,labels.FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.en[descriptor.id],descriptor.values)));
 assert.ok(!f.visible().includes("output_client_write_not_attempted"));
});


test("one Document write owner fences a second real preflight while allowing its authorized read, then its separate explicit command",{timeout:60_000},async t=>{
 const f=await warm(t),doc=existing.workers.doc,before=bookkeeping(f),originalDb=f.db.env.DB,contract=instrumentD1Contract(f.db);
 inheritRuntimeSchemaReadiness(originalDb,f.db.env.DB);
 const depth=enforceD1ExpressionDepth(f.db);
 const gate=heldFixtureGate(t),entered=sceneDeferred(),requests=[];let firstBody;
 f.storeHost.intercept=async request=>{
  if(request.init.method!=="POST")return undefined;requests.push(request);
  try{
  const response=await actualOutput(f,request);assert.equal(response.status,200,await response.clone().text());
  const body=await response.json();
  if(requests.length===1){firstBody=body;return{status:200,ok:true,headers:response.headers,json:async()=>{entered.resolve();await gate.promise;return body;}};}
  return Response.json(body);
  }catch(error){entered.reject(error);throw error;}
 };
 const pending=(await stage(f,"confirm"))();await expectEntry(t,entered.promise,pending,"first native confirmation body");
 const original=f.store.outputRequirements.retainedWrite(doc);
 const observed=await f.store.outputRequirements.ensure(doc,{force:true});assert.equal(observed.state,"ready");assert.ok(observed.snapshot.confirmedPlan);
 assert.equal(f.store.outputRequirements.retainedWrite(doc).clientMutationId,original.clientMutationId);
 const next={action:"preflight",documentId:doc,expectedRevision:observed.snapshot.revision,clientMutationId:"separate-explicit-preflight",planRevisionId:observed.snapshot.confirmedPlan.revisionId,targetIds:observed.snapshot.confirmedPlan.plan.targets.filter(target=>target.selected).map(target=>target.id)};
 const withheld=await f.store.outputRequirementCommand(next);
 assert.equal(withheld.status,"not-attempted");assert.equal(withheld.receipt,undefined);assert.equal(requests.length,1);
 assert.equal(f.store.outputRequirements.retainedWrite(doc).clientMutationId,original.clientMutationId);
 gate.resolve();await pending;await f.flush();
 assert.equal(f.store.outputRequirements.retainedWrite(doc).receipt.eventId,firstBody.command.eventId);
 const sent=await f.store.outputRequirementCommand(next);
 assert.equal(sent.status,"saved");assert.equal(requests.length,2);assert.equal(requests[1].body.clientMutationId,next.clientMutationId);
 assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands WHERE command_key=?").get(original.clientMutationId).count,1);
 assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands WHERE command_key=?").get(next.clientMutationId).count,1);
 assert.equal(f.store.outputRequirements.retainedWrite(doc).status,"acknowledged");assert.deepEqual(bookkeeping(f),before);
 assert.deepEqual(contract.violations,[]);depth.assertVerified();depth.restore();
});
for(const kind of["stale-revision","atomic-rollback"])test("only real "+kind+" noncommit proof releases the original slot for a new explicit edit",{timeout:60_000},async t=>{
 const f=await warm(t),doc=existing.workers.doc,initial=f.store.outputRequirements.resource(doc).snapshot,before=bookkeeping(f);
 const originalDb=f.db.env.DB,contract=instrumentD1Contract(f.db);
 inheritRuntimeSchemaReadiness(originalDb,f.db.env.DB);
 const depth=enforceD1ExpressionDepth(f.db);let requests=0;
 const command={action:"save",documentId:doc,expectedRevision:kind==="stale-revision"?"output:"+String(Number(initial.revision.slice("output:".length))-1):initial.revision,clientMutationId:"positively-rejected-edit",blockId:initial.requirements[0].blockId,spec:initial.requirements[0].spec};
 if(kind==="atomic-rollback")f.db.sqlite.exec("CREATE TEMP TRIGGER reject_current_output_write BEFORE INSERT ON output_commands WHEN NEW.command_key='positively-rejected-edit' BEGIN SELECT RAISE(ABORT,'CHECK constraint failed'); END");
 f.storeHost.intercept=request=>{if(request.init.method!=="POST")return undefined;requests++;return actualOutput(f,request);};
 const denied=await f.store.outputRequirementCommand(command);
 assert.equal(denied.status,"conflict");assert.equal(denied.body.error,kind==="stale-revision"?"output_revision_conflict":"output_revision_or_authority_changed");
 assert.equal(f.store.outputRequirements.retainedWrite(doc),null,"exact noncommit protocol, not status alone, releases the slot");
 assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands WHERE command_key=?").get(command.clientMutationId).count,0);
 const latest=f.store.outputRequirements.resource(doc).snapshot;
 const accepted=await f.store.outputRequirementCommand({...command,expectedRevision:latest.revision,clientMutationId:"new-explicit-accepted-edit"});
 assert.equal(accepted.status,"saved");assert.equal(requests,2);
 assert.equal(f.store.outputRequirements.retainedWrite(doc).clientMutationId,"new-explicit-accepted-edit");assert.equal(f.store.outputRequirements.retainedWrite(doc).status,"acknowledged");
 assert.deepEqual(bookkeeping(f),before);assert.deepEqual(contract.violations,[]);depth.assertVerified();depth.restore();
});


for(const restore of[false,true])test("actual source ownership captured before digest prevents a late dispatch"+(restore?" even after fresh source200":""),{timeout:60_000},async t=>{
 const f=await warm(t),doc=existing.workers.doc,snapshot=f.store.outputRequirements.resource(doc).snapshot,before=bookkeeping(f);
 const digest=crypto.subtle.digest.bind(crypto.subtle),gate=heldFixtureGate(t),entered=sceneDeferred();let held=false,posts=0;
 t.mock.method(crypto.subtle,"digest",async(...args)=>{const value=await digest(...args);if(!held){held=true;entered.resolve();await gate.promise;}return value;});
 f.storeHost.intercept=async request=>{if(request.init.method==="POST"){posts++;return actualOutput(f,request);}return undefined;};
 const pending=f.store.outputRequirementCommand({action:"save",documentId:doc,blockId:snapshot.requirements[0].blockId,spec:snapshot.requirements[0].spec,expectedRevision:snapshot.revision,clientMutationId:"digest-prepared-original"});
 await expectEntry(t,entered.promise,pending,"captured source command digest");
 f.db.sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id=?").run(new Date().toISOString(),f.db.organizationId,existing.workers.owner);
 await f.store.refreshEvents().catch(()=>{});
 assert.equal(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),false);
 if(restore){f.db.sqlite.prepare("UPDATE organization_memberships SET status='active',revoked_at=NULL WHERE organization_id=? AND user_id=?").run(f.db.organizationId,existing.workers.owner);await f.store.refreshEvents();assert.equal(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),true);}
 gate.resolve();const result=await pending;
 assert.equal(result.status,"not-attempted");assert.equal(result.receipt,undefined);assert.equal(posts,0);
 assert.equal(f.store.outputRequirements.retainedWrite(doc),null,"an unsubmitted digest never becomes an unknown attempted operation");
 assert.deepEqual(bookkeeping(f),before);
});
test("unknown actual upload binds every original byte and header; only its unchanged explicit retry can recover",{timeout:60_000},async t=>{
 const f=await warm(t),doc=existing.workers.doc,snapshot=f.store.outputRequirements.resource(doc).snapshot,requests=[],before=bookkeeping(f);
 const file=new File([png({width:2,height:2})],"PRIVATE_ORIGINAL_UPLOAD.png",{type:"image/png"});let originalWire;
 f.storeHost.intercept=async request=>{
  if(request.init.method!=="POST")return undefined;requests.push(request);const response=await actualOutput(f,request);assert.equal(response.status,200,await response.clone().text());
  const body=await response.json();originalWire ||= body;
  if(requests.length===1)return{status:200,ok:true,headers:response.headers,json:async()=>{throw new Error("lost original upload acknowledgment");}};
  assert.equal(body.replayed,true);assert.equal(body.command.eventId,originalWire.command.eventId);return Response.json(body);
 };
 const first=await f.store.uploadOutputAsset(doc,file,snapshot.revision,"original-exact-upload",true);
 assert.equal(first.status,"unavailable");const original=f.store.outputRequirements.retainedWrite(doc);assert.equal(original.status,"unknown");
 assert.ok(!JSON.stringify(original).includes("PRIVATE_ORIGINAL_UPLOAD"));assert.ok(!JSON.stringify(original).includes("image/png"));
 for(const changed of["bytes","filename","mime","rights","revision"]){
  const headers=new Headers(requests[0].init.headers);
  if(changed==="filename")headers.set("x-output-filename","PRIVATE_DIFFERENT_FILE.png");
  if(changed==="mime")headers.set("content-type","image/jpeg");
  if(changed==="rights")headers.set("x-output-rights-confirmed","false");
  if(changed==="revision")headers.set("x-output-expected-revision","output:"+String(Number(snapshot.revision.slice("output:".length))+1));
  const blocked=await f.store.outputRequirements.upload(doc,changed==="bytes"?new Blob([png({width:3,height:2})]):file,headers);
  assert.equal(blocked.status,"not-attempted",changed);assert.equal(requests.length,1,changed);assert.deepEqual(f.store.outputRequirements.retainedWrite(doc),original);
 }
 const recovered=await f.store.uploadOutputAsset(doc,file,snapshot.revision,"original-exact-upload",true);
 assert.equal(recovered.status,"saved");assert.equal(requests.length,2);assert.equal(f.store.outputRequirements.retainedWrite(doc).status,"acknowledged");
 assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands WHERE command_key=?").get(original.clientMutationId).count,1);
 assert.deepEqual(bookkeeping(f),before);
});
test("true sign-out and return clears content-free Output ownership and cannot adopt its old held response",{timeout:60_000},async t=>{
 const f=await warm(t),doc=existing.workers.doc,session=f.store.session.get(),gate=heldFixtureGate(t),entered=sceneDeferred();let posts=0,wire;
 f.storeHost.intercept=async request=>{
  if(request.init.method!=="POST")return undefined;posts++;
  try{
  const response=await actualOutput(f,request);assert.equal(response.status,200,await response.clone().text());wire=await response.json();
  return{status:200,ok:true,headers:response.headers,json:async()=>{entered.resolve();await gate.promise;return wire;}};
  }catch(error){entered.reject(error);throw error;}
 };
 const pending=(await stage(f,"confirm"))();await expectEntry(t,entered.promise,pending,"sign-out confirmation body");assert.ok(f.store.outputRequirements.retainedWrite(doc));
 f.store.session.set(null);assert.equal(f.store.outputRequirements.retainedWrite(doc),null);
 f.store.session.set(session);gate.resolve();await pending;await f.flush();
 assert.equal(f.store.outputRequirements.retainedWrite(doc),null);assert.equal(f.store.outputRequirements.resource(doc).snapshot,null);assert.equal(posts,1);
});


function nativeDownloadAnchors(t, owner) {
 const document=fullPage.calmFullPageNativePorts.documentPort,create=document.createElement.bind(document),clicked=[],removed=[];
 t.mock.method(document,"createElement",(tag,...args)=>{
  const node=create(tag,...args);
  if(String(tag).toLowerCase()==="a"){
   node.click=function(){assert.equal(this.parentElement,owner,"the native download anchor is attached to its exact existing controller");clicked.push({href:this.href,download:this.download});};
   node.remove=function(){const parent=this.parentElement;if(parent)parent.children=parent.children.filter(child=>child!==this);this.parentElement=null;removed.push(this);};
  }
  return node;
 });
 return{clicked,removed};
}

async function inspectedFileFixture(t){
 const f=await fullSourceShell(t);let posts=0,downloads=0;
 f.storeHost.intercept=async request=>{
  if(request.init.method==="POST"){posts++;return actualOutput(f,request);}
  if(request.url.startsWith("/api/output-requirements/assets/")){downloads++;return actualOutput(f,request);}
  return undefined;
 };
 await(await stage(f,"confirm"))();await f.flush();
 await(await stage(f,"adopt"))();await f.flush();
 const snapshot=f.store.outputRequirements.resource(existing.workers.doc).snapshot;assert.ok(snapshot.assets[0]);
 const bound=await f.store.outputRequirementCommand({action:"bind",documentId:existing.workers.doc,expectedRevision:snapshot.revision,clientMutationId:"exact-owned-file-match",planRevisionId:snapshot.confirmedPlan.revisionId,targetId:snapshot.confirmedPlan.plan.targets[0].id,assetId:snapshot.assets[0].id});
 assert.equal(bound.status,"saved");await f.flush();f.draw();
 const download=nodes(f,f.controller,"button").find(node=>node.handlers.click?.toString().includes("#download(asset.downloadUrl)"));
 assert.ok(download,"existing exact-file review button");assert.notEqual(download.properties.disabled,true);
 return{f,download,counts:()=>({posts,downloads})};
}
test("a completed exact-file download object URL is revoked by actual generic source403",{timeout:60_000},async t=>{
 const{f,download,counts}=await inspectedFileFixture(t),anchors=nativeDownloadAnchors(t,f.controller),created=[],revoked=[],create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),before=bookkeeping(f);
 t.mock.method(URL,"createObjectURL",blob=>{const url=create(blob);created.push(url);return url;});
 t.mock.method(URL,"revokeObjectURL",url=>{revoked.push(url);revoke(url);});
 await download.handlers.click.call(f.controller,formEvent(download));await f.flush();
 assert.equal(created.length,1);assert.deepEqual(f.controller.retirementStateForTest().urls,created);
 assert.equal(anchors.clicked.length,1);assert.equal(anchors.clicked[0].href,created[0]);assert.equal(anchors.removed.length,1);assert.equal(anchors.removed[0].parentElement,null);
 f.db.sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id=?").run(new Date().toISOString(),f.db.organizationId,existing.workers.owner);
 await f.store.refreshEvents().catch(()=>{});await f.flush();f.draw();
 assert.deepEqual(revoked,created);assert.deepEqual(f.controller.retirementStateForTest().urls,[]);assert.equal(f.controller.retirementStateForTest().file,null);
 assert.equal(counts().posts,3);assert.equal(counts().downloads,1);assert.deepEqual(bookkeeping(f),before);
});
test("held exact-file bytes cannot create an object URL after actual403 and fresh authorized200",{timeout:60_000},async t=>{
 const{f,download,counts}=await inspectedFileFixture(t),gate=heldFixtureGate(t),entered=sceneDeferred(),prior=f.storeHost.intercept,created=[],before=bookkeeping(f);
 t.mock.method(URL,"createObjectURL",()=>{created.push("not-allowed");return"blob:should-not-be-created";});
 f.storeHost.intercept=async request=>{
  if(!request.url.startsWith("/api/output-requirements/assets/"))return prior(request);
  try{
  const response=await prior(request);assert.equal(response.status,200);
  return{status:200,ok:true,headers:response.headers,blob:async()=>{entered.resolve();await gate.promise;return response.blob();}};
  }catch(error){entered.reject(error);throw error;}
 };
 const pending=download.handlers.click.call(f.controller,formEvent(download));await expectEntry(t,entered.promise,pending,"exact-file download body");
 f.db.sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id=?").run(new Date().toISOString(),f.db.organizationId,existing.workers.owner);
 await f.store.refreshEvents().catch(()=>{});assert.equal(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),false);
 f.db.sqlite.prepare("UPDATE organization_memberships SET status='active',revoked_at=NULL WHERE organization_id=? AND user_id=?").run(f.db.organizationId,existing.workers.owner);
 await f.store.refreshEvents();await f.store.outputRequirements.ensure(existing.workers.doc,{force:true});assert.equal(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),true);
 gate.resolve();await pending;await f.flush();
 assert.deepEqual(created,[]);assert.deepEqual(f.controller.retirementStateForTest().urls,[]);assert.equal(counts().posts,3);assert.equal(counts().downloads,1);assert.deepEqual(bookkeeping(f),before);
});


test("unbranded source-retirement details cannot clear the current actual Output editor",{timeout:60_000},async t=>{
 const f=await warm(t),card=await openCard(f),before=card.retirementStateForTest().session,source=f.store.captureSourceOwnership();
 const copied={authorization:source.authorization,generation:source.generation};
 assert.equal(f.store.sourceOwnershipScopeActive(copied),false,"the actual Store owns the token, not matching client fields");
 const event=new CustomEvent("forma-event-source-retired",{detail:{source:copied,generation:source.generation+1,status:403}});
 for(const handler of f.listeners.get(event.type)??[])handler(event);
 await f.flush();assert.equal(card.retirementStateForTest().session,before);assert.equal(f.store.sourceOwnershipActive(source),true);
});
test("an old branded retirement event cannot erase the new authorized editor after source recovery",{timeout:60_000},async t=>{
 const f=await warm(t);let previous=null;
 const capture=event=>{previous=event.detail;};existing.ui.windowPort.addEventListener("forma-event-source-retired",capture);t.after(()=>existing.ui.windowPort.removeEventListener("forma-event-source-retired",capture));
 f.db.sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id=?").run(new Date().toISOString(),f.db.organizationId,existing.workers.owner);
 await f.store.refreshEvents().catch(()=>{});assert.ok(previous);
 f.db.sqlite.prepare("UPDATE organization_memberships SET status='active',revoked_at=NULL WHERE organization_id=? AND user_id=?").run(f.db.organizationId,existing.workers.owner);
 await f.store.refreshEvents();await f.store.outputRequirements.ensure(existing.workers.doc,{force:true});await f.flush();f.draw();
 const card=await openCard(f),before=card.retirementStateForTest().session;
 assert.equal(f.store.sourceOwnershipActive(previous.source),false);
 const event=new CustomEvent("forma-event-source-retired",{detail:previous});
 for(const handler of f.listeners.get(event.type)??[])handler(event);
 await f.flush();assert.equal(card.retirementStateForTest().session,before);assert.equal(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),true);
});

for(const action of["confirm","adopt"])for(const moved of[true,false])test("real client "+action+" digest "+(moved?"must not dispatch after actual Shell route departure":"keeps the still-current native operation working"),{timeout:60_000},async t=>{
 const f=await fullSourceShell(t),doc=existing.workers.doc,digest=crypto.subtle.digest.bind(crypto.subtle),gate=heldFixtureGate(t),entered=sceneDeferred();
 let held=false,posts=0;
 t.mock.method(crypto.subtle,"digest",async(...args)=>{
  const value=await digest(...args);let parsed=null;try{parsed=JSON.parse(new TextDecoder().decode(args[1]));}catch{/* Other digest inputs are not JSON request descriptors. */}
  const original=parsed?.documentId===doc&&(action==="adopt"?parsed?.method==="POST"&&parsed?.path==="/api/output-requirements/assets?documentId="+doc:parsed?.action===action&&typeof parsed?.clientMutationId==="string");
  if(!held&&original){held=true;entered.resolve();await gate.promise;}
  return value;
 });
 f.storeHost.intercept=request=>{if(request.init.method!=="POST")return undefined;posts++;return actualOutput(f,request);};
 const original=f.controller,pending=(await stage(f,action))();await expectEntry(t,entered.promise,pending,"Shell "+action+" client digest");
 const prepared=original.retirementStateForTest();assert.ok(action==="adopt"?prepared.uploadId:prepared.uncertain?.id,"controller prepared its own original ID before the client digest await");
 assert.equal(f.store.outputRequirements.retainedWrite(doc),null,"the transport is still before claim/dispatch");
 const source=f.store.captureSourceOwnership();assert.equal(f.store.sourceOwnershipActive(source),true);
 if(moved){f.store.route.set("/projects");await f.settle();assert.equal(original.isConnected,false);}
 assert.equal(f.store.sourceOwnershipActive(source),true,"route departure alone does not fake an authorization/source retirement");
 gate.resolve();await pending;await f.settle();
 assert.equal(posts,moved?0:1,"only an actually current original view may dispatch after digest preparation");
 assert.equal(f.store.outputRequirements.retainedWrite(doc)?.status,moved?undefined:"acknowledged");
});
test("closing the original native plan during client digest prevents submission while retaining its local choices",{timeout:60_000},async t=>{
 const f=await fullSourceShell(t),doc=existing.workers.doc,digest=crypto.subtle.digest.bind(crypto.subtle),gate=heldFixtureGate(t),entered=sceneDeferred();let held=false,posts=0;
 t.mock.method(crypto.subtle,"digest",async(...args)=>{
  const value=await digest(...args);let parsed=null;try{parsed=JSON.parse(new TextDecoder().decode(args[1]));}catch{/* Other digest inputs are not JSON request descriptors. */}
  if(!held&&parsed?.documentId===doc&&parsed?.action==="confirm"){held=true;entered.resolve();await gate.promise;}return value;
 });
 f.storeHost.intercept=request=>{if(request.init.method!=="POST")return undefined;posts++;return actualOutput(f,request);};
 const pending=(await stage(f,"confirm"))();await expectEntry(t,entered.promise,pending,"cancelable native plan digest");await f.settle();
 const before=f.controller.retirementStateForTest(),form=nodes(f,f.controller,"form").find(node=>node.handlers.submit?.name==="#confirm");assert.ok(form);
 const cancel=nodes(f,f.controller,"button").find(node=>node.handlers.click?.toString().includes("() => this.#closePlan()"));assert.ok(cancel,"actual native Cancel control");
 await cancel.handlers.click.call(f.controller,formEvent(cancel));await f.settle();
 assert.equal(f.controller.isConnected,true);assert.equal(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),true);
 gate.resolve();await pending;await f.settle();
 assert.equal(posts,0);assert.equal(f.store.outputRequirements.retainedWrite(doc),null);
 assert.deepEqual(f.controller.retirementStateForTest().planning,before.planning,"the original view retains all unsent human choices despite normal immutable render refreshes");
 assert.equal(f.controller.retirementStateForTest().uncertain,null);assert.equal(f.controller.retirementStateForTest().busy,"");
});
