import assert from "node:assert/strict";
import test,{after} from "node:test";
import { lifecyclePage, finishLifecycle, lifecycleOwner } from "./helpers/creative-next-action-navigation-fixture.mjs";

const originalFetch=globalThis.fetch;let external=0;
globalThis.fetch=async()=>{external++;throw Error("No external/provider transport in original-job promotion controls");};
after(()=>{assert.equal(external,0);globalThis.fetch=originalFetch;});

const jobAction=f=>{const value=f.actions().find(action=>action.target.kind==="job");assert.ok(value,"the actual resolver offers the original job");return value;};
const receipt=f=>f.components().find(component=>component.tag==="forma-generation-input-dialog"&&component.open);
const nativeDialog=(f,component)=>f.tree().visible("dialog").find(node=>node.owner===component&&node.port?.open
  &&node.attributes.class==="generation-input-dialog");

test("actual owned original-job inspection remains open for later normal input and closes deliberately",async t=>{
  const f=await lifecyclePage(t,{mode:"job"}),owner=lifecycleOwner(f);
  assert.equal(await finishLifecycle(f,f.open(jobAction(f),owner)),true);
  const component=receipt(f);assert.ok(component?.inspection);assert.ok(nativeDialog(f,component));
  const close=f.tree().visible("button").find(node=>node.owner===component&&node.attributes["aria-label"]==="Close generation inputs");assert.ok(close);
  // Once the existing opening reports arrival, its ordinary read controls must
  // not inherit the now-disposed one-gesture focus lease.
  f.native.emit("keydown",close.port);await f.settle();
  assert.equal(receipt(f),component);assert.ok(nativeDialog(f,component));assert.ok(component.inspection);
  await f.act(close);await f.settle();
  assert.equal(receipt(f),undefined);assert.equal(nativeDialog(f,component),undefined);
  f.sourceUnchanged();
});

for(const boundary of ["pointerdown","route-aba","source-revision"])test("actual original-job child vetoes "+boundary+" immediately before native promotion",async t=>{
  const f=await lifecyclePage(t,{mode:"job"}),owner=lifecycleOwner(f),chosen=jobAction(f);
  const render=f.renderer.value.bind(f.renderer),traceStart=f.trace.length;let entered=false,expectedSource=f.originalSource;
  f.renderer.value=function(value,component,...args){
    // Only the finite native-renderer boundary is deferred. The complete actual
    // child template and lifecycle run unchanged, including its native promotion.
    if(!entered&&component?.tag==="forma-generation-input-dialog"&&component.open){
      entered=true;
      if(boundary==="pointerdown")f.native.emit("pointerdown");
      else if(boundary==="route-aba"){const route=f.store.route.get();f.store.setRoute("/activity");f.store.setRoute(route);}
      else{
        f.appendEvent("BlockPropertyEdited",{block_id:"lifecycle-direction",property_path:"text",
          old_value:"Exact authored direction for this Document",new_value:"A newer authored source revision"});
        expectedSource=JSON.stringify(f.store.events.get());
      }
    }
    return render(value,component,...args);
  };
  assert.equal(await finishLifecycle(f,f.open(chosen,owner)),false);
  assert.equal(entered,true,"the actual original-job child was reached");
  assert.ok(!f.trace.slice(traceStart).some(value=>value==="open:generation-input-dialog"),
    "no transient stale showModal is allowed before the eventual false result");
  assert.equal(receipt(f),undefined);
  assert.equal(JSON.stringify(f.store.events.get()),expectedSource);
});

test("legacy public original-job opening without caller controls retains its existing semantics",async t=>{
  const f=await lifecyclePage(t,{mode:"job",route:"document"});
  const hosts=f.components().filter(component=>component.tag==="forma-document-artifacts"&&component.isConnected);
  assert.equal(hosts.length,1,"one actual existing Document result controller");
  assert.equal(await finishLifecycle(f,hosts[0].openJobById(f.jobId)),undefined,"legacy success does not acquire a new boolean contract");
  const component=receipt(f);assert.ok(component?.inspection);assert.ok(nativeDialog(f,component));
  const close=f.tree().visible("button").find(node=>node.owner===component&&node.attributes["aria-label"]==="Close generation inputs");assert.ok(close);
  f.native.emit("keydown",close.port);await f.settle();assert.ok(nativeDialog(f,component));
  await f.act(close);await f.settle();assert.equal(receipt(f),undefined);f.sourceUnchanged();
});
