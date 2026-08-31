import assert from "node:assert/strict";
import fs from "node:fs";
import { createCalmFullPage, calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";
import { createSceneStoreHost } from "./scene-cost-store-host.mjs";
import { installOutputNavigationFocusNative } from "./output-navigation-focus-native.mjs";
import { nextActionFacts } from "../../src/state/next-action-context.ts";
import { creativeNextActions } from "../../src/model/workspace-intelligence.ts";
import { financial } from "./event-source-retirement-fixture.mjs";
import { isOutputFixtureReadOnlyResume } from "./output-reachability-fixture.mjs";

// Full existing classes and actual Store. These explicitly synthetic projection
// cases exercise opening/currentness, not Worker custody or physical layout.
export async function lifecyclePage(t,{route="/projects",mode="configure",locale="en",jobResult=null,storeHost:providedStoreHost=null}={}){
  const h=providedStoreHost??await createSceneStoreHost({exposeSceneTestAccessors:false});
  const jobId="lifecycle-original-job";
  if(mode==="job"){
    const now=new Date().toISOString(),expires=new Date(Date.now()+3600_000).toISOString(),w=h.worker;
    // Same explicit failed-job fixture shape as activity-private-note-pending; no provider execution is asserted.
    w.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,expires_at,updated_at) VALUES(?,?,?,?,?,'failed','activity',?,1,'{}','{}','source_fidelity_validation_failed',1,?,?,?,?,?)")
      .run(jobId,w.owner,w.streamId,w.documentId,"render_document",jobId,now,now,now,expires,now);
    // Opt-in fixture receipt, before any page/source/fiscal baseline. Existing
    // callers still seed the same empty result and use the unchanged Worker.
    if(jobResult!==null)w.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?")
      .run(JSON.stringify(jobResult),jobId);
  }
  // Register the existing financial audit before the shared page's close hook.
  // Keep the actual host identity; only test cleanup ordering changes.
  let verifyOpening=()=>{};
  t.after(()=>verifyOpening());
  const f=await createCalmFullPage(t,{locale,storeHost:h}),store=f.store,documentId=store.projection.get().documentId,projectId=store.projection.get().projectId;
  const base=store.events.get().filter(event=>["ProjectCreated","DocumentCreated"].includes(event.type));
  store.events.set(base);store.head.set(base.at(-1)?.sequence??0);store.content.set({});store.documentJobs.set([]);
  if(mode!=="context")f.appendEvent("BlockCreated",{block_id:"lifecycle-direction",type:"direction",handle:"direction/exact",position:"a",
    properties:{text:"Exact authored direction for this Document",weight:1,authority:"authored"}});
  if(mode==="library")f.appendEvent("BlockCreated",{block_id:"lifecycle-library",scope:"library",type:"direction",handle:"direction/library-exact",position:"b",
    properties:{text:"Exact reusable block",weight:1,authority:"authored"}});
  const previousHistory=globalThis.history;
  globalThis.history={pushState(_state,_title,value){const next=new URL(value,"http://localhost");Object.assign(h.location,{pathname:next.pathname,search:next.search,hash:next.hash});},
    replaceState(...args){this.pushState(...args);}};
  t.after(()=>{globalThis.history=previousHistory;});
  const native=installOutputNavigationFocusNative(t,f,ports);
  const definitions=JSON.parse(fs.readFileSync(new URL("../../custom-elements.json",import.meta.url),"utf8"));
  const byTag=new Map(definitions.modules.flatMap(module=>(module.declarations??[]).filter(value=>value.tagName)
    .map(value=>[value.tagName,{file:module.path,name:value.name}])));
  const registered=new Set();
  async function register(tag){
    if(registered.has(tag))return;registered.add(tag);
    const entry=byTag.get(tag);assert.ok(entry,"existing actual component "+tag);
    // An existing parent registration still needs its actual literal children.
    if(!f.renderer.registry[tag])f.renderer.registry[tag]=(await ports.loadActual(entry.file))[entry.name];
    for(const child of new Set([...fs.readFileSync(new URL("../../"+entry.file,import.meta.url),"utf8").matchAll(/<(forma-[\w-]+)(?=[\s>])/gu)].map(match=>match[1])))await register(child);
  }
  for(const tag of["forma-workspace","forma-library","forma-projects","forma-activity","forma-output-visual"])await register(tag);
  // Initial fixture study output is not an obligation in this new synthetic projection.
  // The actual client remains unchanged and its empty current resource comes from the actual Worker.
  store.outputRequirements.clear();
  store.setRoute(route==="document"?"/document/"+documentId:route);
  if(mode==="job")await store.syncDocumentJobs();
  await f.settle();
  const module=await ports.loadActual("src/components/creative-next-action-navigation.ts");
  const sourceBefore=JSON.stringify(store.events.get()),moneyBefore=financial(h.worker);
  verifyOpening=()=>{assert.deepEqual(financial(h.worker),moneyBefore,"opening never submits or reserves provider work");
    assert.deepEqual(h.requests.filter(row=>(row.init.method??"GET")!=="GET"
      &&!isOutputFixtureReadOnlyResume(row,{projectId,documentId})),[],"only the existing exact free resume read may use POST");};
  return Object.assign(f,{native,documentId,projectId,jobId,
    actions:()=>creativeNextActions(nextActionFacts(store,documentId,null,{lifecycle:true})),
    open:(action,owner)=>module.openCreativeNextActionDestination(store,native.document,action,owner),
    originalSource:sourceBefore,
    sourceUnchanged(){assert.equal(JSON.stringify(store.events.get()),sourceBefore);},
  });
}
export async function finishLifecycle(f,pending){
  let complete=false,value,error;Promise.resolve(pending).then(result=>{value=result;complete=true;},caught=>{error=caught;complete=true;});
  for(let attempt=0;attempt<32&&!complete;attempt++){
    await f.settle();
    for(const [id,timer] of [...f.storeHost.timers])if(timer.delay===16){f.storeHost.timers.delete(id);timer.callback(0);}
    await new Promise(setImmediate);
  }
  assert.equal(complete,true,"bounded genuine render/RAF opening settled");if(error)throw error;return value;
}
export function lifecycleOwner(f){
  const route=f.store.route.get(),origin=f.components().find(value=>["forma-projects","forma-library","forma-activity","forma-workspace"].includes(value.tag));
  assert.ok(origin);let retained=true;
  return {origin,retire:()=>{retained=false;},originCurrent:()=>retained&&origin.isConnected&&f.store.route.get()===route,
    navigationCurrent:()=>retained};
}
export function lifecycleButton(f,id){
  const rows=f.tree().visible("button").filter(value=>value.attributes["data-choice-value"]===id
    &&(()=>{for(let at=value.parent;at;at=at.parent)if(String(at.attributes?.class??"").split(/\s/u).includes("lifecycle-next-actions"))return true;return false;})());
  assert.equal(rows.length,1,"one scoped actual next-step button");return rows[0];
}
export function activateLifecycle(f,node){
  assert.ok(node.port&&!node.hiddenBy&&!Object.hasOwn(node.attributes,"disabled"));
  node.handlers.click.call(node.owner,{target:node.port,currentTarget:node.port,preventDefault(){},stopPropagation(){}});
}
export {ports};
