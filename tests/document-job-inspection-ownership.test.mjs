// Complete actual DocumentArtifacts + GenerationInputDialog, full Store and
// routed RAM Worker. Only existing native rendering and delivery timing are ports.
// Prepared only: no test, compiler, provider or SQL execution by the author.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import {registerHooks} from "node:module";
import {financial} from "./helpers/event-source-retirement-fixture.mjs";

// Reuse the exact existing declarations, never register that other test suite,
// replace a production method, or handcraft a parallel inspection implementation.
const recoveryUrl=new URL("./scene-composer-recovery.test.mjs",import.meta.url);
const recoverySource=fs.readFileSync(recoveryUrl,"utf8");
const recoveryTree=ts.createSourceFile(recoveryUrl.pathname,recoverySource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const recoveryDeclarations=recoveryTree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)
  ||ts.isExpressionStatement(node)&&ts.isBinaryExpression(node.expression)&&node.expression.left.getText(recoveryTree)==="fixtureModule"
  ||ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(recoveryTree)==="fixtureHook.deregister");
const recoveryModule=recoveryDeclarations.map(node=>node.getFullText(recoveryTree)).join("\n")
  +"\nexport {originalScene,receiptComponent,settle,untilScene,sceneDeferred,loadActual};\n";
const recoveryModuleUrl=new URL("./document-job-inspection-ownership-fixture.mjs",import.meta.url).href;
const recoveryHook=registerHooks({
  resolve(specifier,context,next){return specifier===recoveryModuleUrl?{url:recoveryModuleUrl,shortCircuit:true}:next(specifier,context);},
  load(url,context,next){return url===recoveryModuleUrl?{format:"module",source:recoveryModule,shortCircuit:true}:next(url,context);},
});
const {originalScene,receiptComponent,settle,untilScene,sceneDeferred,loadActual}=await import(recoveryModuleUrl);
recoveryHook.deregister();
const {captureOutputNavigationFocus}=await loadActual("src/components/output-navigation-focus.ts");
const options={concurrency:false,timeout:45000};
const state=x=>({route:x.h.store.route.get(),source:x.h.store.captureSourceOwnership().generation,
  inspectionJob:receiptComponent(x.f)?.inspection?.receipt?.job?.job_id??null,open:Boolean(receiptComponent(x.f)?.open)});
async function inspectionFixture(t,{shared=false,status="running",generic=false}={}){
  // Existing originalScene makes one real RAM admission, runs no provider, then
  // assigns the requested public status in fixture SQLite. It does not establish
  // a real provider failure, completion or financial reconciliation.
  const x=await originalScene(t,{shared,status}),{h,f}=x;let id=x.id;
  await f.closeScene();await settle(f);
  if(generic){
    // A second, different format is admitted by the real current Worker only as
    // fixture setup. No /run, provider or synthetic successful receipt is used.
    const response=await h.worker.request("/api/document-jobs",h.worker.json({kind:"render_document",documentId:h.request.documentId,
      sourceSurface:"document",payload:{artifactKind:"short_story",productionMode:"manual",itemCount:1,requestKey:"generic-inspection-"+crypto.randomUUID()}}));
    const body=await response.json();assert.equal(response.status,202,body.error);assert.ok(body.job);
    assert.equal(body.job.result.artifactKind,"short_story");id=body.job.jobId;status=body.job.status;
    h.store.documentJobs.set([body.job,...h.store.documentJobs.get().filter(job=>job.jobId!==id)]);
  }
  const dispatch=h.window.dispatchEvent;
  h.window.dispatchEvent=function(event){
    const result=dispatch.call(this,event);
    for(const listener of [...(f.listeners.get(event.type)??[])])listener(event);
    return result;
  };
  const before=financial(h.worker),posts=h.requests.filter(row=>row.init.method==="POST").length;
  const eventIds=h.worker.sqlite.prepare("SELECT event_id FROM events WHERE stream_id=? ORDER BY sequence").all(h.worker.streamId);
  t.after(()=>{h.window.dispatchEvent=dispatch;});
  const noMutation=()=>{
    assert.deepEqual(financial(h.worker),before,"Inspection leaves all original job/reservation/provider/execution rows unchanged");
    assert.equal(h.requests.filter(row=>row.init.method==="POST").length,posts,"No Retry, Dismiss, Apply, generation or automatic preparation");
    assert.deepEqual(h.worker.sqlite.prepare("SELECT event_id FROM events WHERE stream_id=? ORDER BY sequence").all(h.worker.streamId),eventIds);
  };
  const path="/api/document-jobs/"+encodeURIComponent(id)+(shared?"/private-receipt":"?inspection=1");
  return{...x,id,path,shared,status,generic,noMutation,receiptReads:()=>h.requests.filter(row=>row.url===path).length};
}
async function withInspection(t,configuration,run){
  const x=await inspectionFixture(t,configuration);
  try{await run(x);}finally{x.noMutation();}
}
function hold(x,boundary){
  const entered=sceneDeferred(),gate=sceneDeferred();let reached=false,bodyStatus=null;
  let restore=()=>{};
  if(boundary==="ready"){
    const tick=x.f.tick;
    x.f.tick=async(owner,...args)=>{
      if(!reached&&owner===x.f.host){reached=true;entered.resolve();await gate.promise;}
      return tick(owner,...args);
    };
    restore=()=>{x.f.tick=tick;};
  }else if(boundary==="workbench"){
    // The reduced Scene host has an existing native workspace update port,
    // not a mounted FormaWorkspace renderer. Bind this hold to the exact owner
    // resolved by the real reveal method and its actual public dispatch.
    const workspace=x.f.host.closest("forma-workspace");
    assert.ok(workspace);assert.equal(workspace===x.f.workspace,true);
    const update=Object.getOwnPropertyDescriptor(workspace,"updateComplete");
    assert.equal(typeof update?.get,"function");assert.equal(update.configurable,true);
    const reveals=()=>x.f.trace.filter(row=>row==="event:document-artifact-open").length;
    const before=reveals();let pending;
    Object.defineProperty(workspace,"updateComplete",{...update,get(){
      assert.equal(this===workspace,true,"the exact native workspace owns this update");
      assert.equal(reveals(),before+1,"the actual reveal dispatch precedes its workspace update");
      // #revealWorkbenchPane checks then awaits this getter. Both reads must
      // join the same pending native update, not start two independent ticks.
      if(!pending){reached=true;entered.resolve();pending=gate.promise.then(()=>update.get.call(workspace));}
      return pending;
    }});
    restore=()=>{Object.defineProperty(workspace,"updateComplete",update);};
  }else{
    const previous=x.h.intercept;
    x.h.intercept=async request=>{
      if(reached||request.url!==x.path)return previous?.(request);
      const response=await x.h.worker.request(request.url,request.init);
      assert.equal(response.status,200,"The actual exact private inspection is authorized before delay");
      bodyStatus=response.status;
      if(boundary==="headers"){reached=true;entered.resolve();await gate.promise;return response;}
      const json=response.json.bind(response);
      response.json=async()=>{const body=await json();reached=true;entered.resolve();await gate.promise;return body;};
      return response; // Same Worker Response and exact original JSON.
    };
  }
  return{entered,release:()=>{try{restore();}finally{gate.resolve();}},reached:()=>reached,status:()=>bodyStatus};
}
async function retireSource(x){
  const previous=x.h.worker.env.FORMA_PILOT_COHORT_ID,original=x.h.store.captureSourceOwnership();
  x.h.worker.env.FORMA_PILOT_COHORT_ID="missing-inspection-fixture-cohort";
  try{await assert.rejects(x.h.store.refreshEvents(),/403/);}
  finally{
    if(previous===undefined)delete x.h.worker.env.FORMA_PILOT_COHORT_ID;
    else x.h.worker.env.FORMA_PILOT_COHORT_ID=previous;
  }
  await x.h.store.refreshEvents();
  assert.equal(x.h.store.sourceOwnershipActive(original),false,"Genuine 403 then 200 cannot reactivate the old branded Source");
  assert.equal(x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership()),true);
}

for(const shared of [false,true])for(const status of ["running","failed"])
test("caller-owned exact original job inspection is read-only: "+(shared?"shared/":"personal/")+status,options,t=>withInspection(t,{shared,status},async x=>{
  const before=x.receiptReads();
  assert.equal(await x.f.host.openJobById(x.id,{current:()=>true}),true,"Boolean certifies presentation only");
  await settle(x.f);
  const inspected=receiptComponent(x.f);
  assert.ok(inspected?.open);assert.equal(inspected.inspection.receipt.job.job_id,x.id);
  assert.equal(inspected.inspection.receipt.job.status,status);
  assert.equal(x.receiptReads(),before+1,"A deliberate current inspection reads the exact original once");
  assert.ok(JSON.stringify(inspected.inspection).includes("The keeper checks the harbor."),"Real retained original inputs, not rebuilt current values");
}));

for(const shared of [false,true])test("already-retired caller does not reveal or read an original: "+(shared?"shared":"personal"),options,t=>withInspection(t,{shared},async x=>{
  const before=x.receiptReads(),reveals=x.f.trace.filter(row=>row==="event:document-artifact-open").length;
  assert.equal(await x.f.host.openJobById(x.id,{current:()=>false}),false);
  await settle(x.f);assert.equal(x.receiptReads(),before);assert.equal(Boolean(receiptComponent(x.f)?.inspection),false);
  assert.equal(x.f.trace.filter(row=>row==="event:document-artifact-open").length,reveals);
}));

for(const boundary of ["ready","workbench","headers","json"])for(const retirement of ["caller","route","source"])
test("caller-owned exact inspection rejects "+retirement+" retirement during "+boundary,options,t=>withInspection(t,{shared:boundary==="headers"||boundary==="json",status:boundary==="headers"||boundary==="json"?"failed":"running"},async x=>{
  const gate=hold(x,boundary),before=x.receiptReads();let caller=true,result;
  const opening=x.f.host.openJobById(x.id,{current:()=>caller});
  try{
    await untilScene(gate.reached,"Actual "+boundary+" inspection boundary reached");
    if(retirement==="caller")caller=false;
    if(retirement==="route")x.h.store.route.set("/library");
    if(retirement==="source")await retireSource(x);
  }finally{gate.release();result=await opening;}
  await settle(x.f);
  t.diagnostic(JSON.stringify({boundary,retirement,reached:gate.reached(),status:gate.status(),result,view:state(x)}));
  assert.equal(result,false);assert.equal(Boolean(receiptComponent(x.f)?.inspection),false);
  assert.equal(x.receiptReads()-before,boundary==="ready"||boundary==="workbench"?0:1);
  if(retirement==="route")assert.equal(x.h.store.route.get(),"/library","Old completion never navigates back");
}));

for(const retirement of ["caller","route"])test("presented exact job inspection retains consumer ownership, not the completed focus lease: "+retirement,options,t=>withInspection(t,{},async x=>{
  const lease=captureOutputNavigationFocus(x.h.document);
  let opening=true,owned=true;
  const current=()=>owned&&(!opening||lease.current());
  assert.equal(await x.f.host.openJobById(x.id,{current}),true);
  opening=false;lease.dispose();assert.equal(lease.current(),false);
  await settle(x.f);
  const inspected=receiptComponent(x.f);assert.ok(inspected?.open);
  const receipt=JSON.stringify(inspected.inspection.receipt,null,2);
  await x.f.click("Copy receipt");await settle(x.f);
  assert.equal(x.f.clipboard.at(-1),receipt,"Actual inspector interaction remains useful after navigation focus ownership ends");
  assert.equal(receiptComponent(x.f)===inspected,true);assert.equal(inspected.open,true);
  if(retirement==="caller")owned=false;else x.h.store.route.set("/library");
  x.f.draw();await settle(x.f);
  assert.equal(Boolean(receiptComponent(x.f)?.inspection),false,"Later consumer/route retirement still clears private inspection");
}));

for(const shared of [false,true])test("generic exact original inspection preserves legacy cache semantics without a freshness claim: "+(shared?"shared":"personal"),options,t=>withInspection(t,{shared,generic:true},async x=>{
  const before=x.receiptReads();
  assert.equal(await x.f.host.openJobById(x.id,{current:()=>true}),true);await settle(x.f);
  const inspected=receiptComponent(x.f);assert.ok(inspected?.open);
  assert.equal(inspected.inspection.receipt.job.job_id,x.id);assert.equal(inspected.inspection.receipt.job.status,x.status);
  assert.equal(x.receiptReads(),before+1,"First exact generic inspection uses its existing original read");
  const original=JSON.stringify(inspected.inspection);
  await x.f.click("Done");await settle(x.f);
  const reads=x.receiptReads();assert.equal(await x.f.host.openJobById(x.id,{current:()=>true}),true);await settle(x.f);
  assert.equal(JSON.stringify(receiptComponent(x.f).inspection),original,"Same original context, not new approval/status evidence");
  assert.equal(x.receiptReads(),reads+(shared?1:0),"Personal exact updatedAt cache and shared actor-private read retain original semantics");
}));

for(const shared of [false,true])for(const retirement of ["caller","source"])
test("generic original inspection fences "+retirement+" across actual private JSON: "+(shared?"shared":"personal"),options,t=>withInspection(t,{shared,generic:true},async x=>{
  const gate=hold(x,"json");let caller=true,result;
  const pending=x.f.host.openJobById(x.id,{current:()=>caller});
  try{
    await untilScene(gate.reached,"Actual generic original response reached JSON delivery");
    if(retirement==="caller")caller=false;else await retireSource(x);
  }finally{gate.release();result=await pending;}
  await settle(x.f);
  assert.equal(gate.status(),200);assert.equal(result,false);
  assert.equal(Boolean(receiptComponent(x.f)?.inspection),false,"No late private inspector publication");
}));
