import assert from "node:assert/strict";
import test,{after} from "node:test";
import { lifecyclePage, finishLifecycle, lifecycleOwner, activateLifecycle } from "./helpers/creative-next-action-navigation-fixture.mjs";
const originalFetch=globalThis.fetch;let external=0;
globalThis.fetch=async()=>{external++;throw Error("No external/provider transport in lifecycle opening controls");};
after(()=>{assert.equal(external,0);globalThis.fetch=originalFetch;});
const classed=(node,value)=>String(node.attributes?.class??"").split(/\s/u).includes(value);
const action=(f,kind)=>{const found=f.actions().find(value=>value.target.kind===kind);assert.ok(found,"actual resolver offers "+kind);return found;};
const dialogs=f=>f.tree().visible("dialog").filter(value=>value.port?.open);

test("actual context continuation opens only the existing empty-Document composer and retains later text",async t=>{
  const f=await lifecyclePage(t,{mode:"context"}),owner=lifecycleOwner(f);
  assert.equal(await finishLifecycle(f,f.open(action(f,"context"),owner)),true);
  const dialog=dialogs(f).find(value=>classed(value,"block-composer-dialog"));assert.ok(dialog);
  const direction=f.tree().visible("button").find(value=>value.attributes["data-choice-value"]==="direction");assert.ok(direction);
  await f.act(direction);
  const text=f.tree().visible("textarea").find(value=>value.owner===dialog.owner);assert.ok(text);
  text.port.value="A deliberate new unsent decision";await f.act(text,"input");
  f.native.emit("keydown",text.port);await f.settle();
  assert.ok(dialogs(f).some(value=>classed(value,"block-composer-dialog")));
  assert.ok(f.tree().visible("textarea").some(value=>value.port?.value==="A deliberate new unsent decision"));
  f.sourceUnchanged();
});

for(const boundary of["pointerdown","keydown","source","route-aba","caller"])test("actual opening refuses newer "+boundary+" before the queued destination render",async t=>{
  const f=await lifecyclePage(t),owner=lifecycleOwner(f),chosen=action(f,"configure");
  const pending=f.open(chosen,owner);
  if(boundary==="pointerdown"||boundary==="keydown")f.native.emit(boundary);
  else if(boundary==="caller")owner.retire();
  else if(boundary==="route-aba"){const route=f.store.route.get();f.store.setRoute("/activity");f.store.setRoute(route);}
  else f.appendEvent("BlockPropertyEdited",{block_id:"lifecycle-direction",property_path:"text",old_value:"Exact authored direction for this Document",new_value:"Newer explicit source"});
  assert.equal(await finishLifecycle(f,pending),false);
  assert.equal(dialogs(f).filter(value=>classed(value,"next-format-dialog")).length,0,"no stale native promotion even if route was committed");
});

test("a captured descriptor cannot become another Document or drop sourceGeneration",async t=>{
  const f=await lifecyclePage(t),chosen=action(f,"configure"),owner=lifecycleOwner(f);
  const events=JSON.stringify(f.store.events.get()),route=f.store.route.get();
  for(const target of[{...chosen.target,documentId:"not-the-current-document"},{...chosen.target,sourceGeneration:undefined},{...chosen.target,canvasId:"not-a-document-scope"}])
    assert.equal(await finishLifecycle(f,f.open({...chosen,target},owner)),false);
  assert.equal(f.store.route.get(),route);assert.equal(JSON.stringify(f.store.events.get()),events);
});


for(const medium of["image","slides","short_story","storyboard","scene","video","audio"])test("actual explicit "+medium+" choice reuses its existing configuration and retains healthy editing ownership",async t=>{
  const f=await lifecyclePage(t),owner=lifecycleOwner(f);assert.equal(await finishLifecycle(f,f.open(action(f,"configure"),owner)),true);
  const card=f.tree().visible("button").find(value=>value.attributes["data-choice-value"]===medium);assert.ok(card);
  activateLifecycle(f,card);for(let attempt=0;attempt<8;attempt++)await f.settle();
  const dialog=dialogs(f).find(value=>classed(value,medium==="image"?"generation-details-dialog":"document-artifact-create"));assert.ok(dialog);
  const firstField=f.tree().visible("input").find(value=>value.owner===dialog.owner)??f.tree().visible("button").find(value=>value.owner===dialog.owner);
  assert.ok(firstField);f.native.emit("keydown",firstField.port);await f.settle();
  assert.ok(dialogs(f).some(value=>classed(value,medium==="image"?"generation-details-dialog":"document-artifact-create")));
  assert.equal(f.store.projection.get().documentId,f.documentId);f.sourceUnchanged();
});

test("actual current rights blocker reaches that exact native source article, not a first-document fallback",async t=>{
  const f=await lifecyclePage(t),owner=lifecycleOwner(f);
  f.appendEvent("BlockPropertyEdited",{block_id:"lifecycle-direction",property_path:"rights_expires_at",new_value:"2020-01-01T00:00:00Z"});
  const currentDocument=f.store.projection.get().documents.find(value=>value.id===f.documentId);
  f.appendEvent("DocumentCreated",{document_id:"same-named-other-document",title:currentDocument.title});
  await f.settle();const chosen=action(f,"source-block"),source=JSON.stringify(f.store.events.get());
  assert.equal(chosen.target.blockId,"lifecycle-direction");assert.equal(chosen.target.documentId,f.documentId);
  const opened=await finishLifecycle(f,f.open(chosen,owner));
  const active=f.native.document.activeElement;
  const articles=f.tree().visible("article").filter(row=>row.attributes["data-block-id"]===chosen.target.blockId);
  const describe=node=>({
    present:Boolean(node),tag:node?.tagName??null,blockId:node?.getAttribute?.("data-block-id")??null,
    connectedNow:Boolean(node?.isConnected),activeNow:Boolean(node)&&node===active,
    currentArticleNow:Boolean(node)&&articles.some(row=>row.port===node),
    ownerTag:node?.owner?.tag??null,ownerBlockId:node?.owner?.block?.id??null,
    ownerDocumentId:node?.owner?.block?.documentId??null,
  });
  t.diagnostic(JSON.stringify({
    diagnostic:"c19-rights-source-block-opening",opened,
    route:f.store.route.get(),documentId:f.store.projection.get().documentId,
    expectedBlockId:chosen.target.blockId,expectedDocumentId:chosen.target.documentId,
    active:describe(active),currentArticleCount:articles.length,
    currentArticles:articles.map(row=>({portPresent:Boolean(row.port),...describe(row.port)})),
    nativeFocus:f.native.nativeFocus.map(row=>({...describe(row.node),previousConnectedAtFocus:row.previousConnected})),
    nativeScroll:f.native.nativeScroll.map(row=>describe(row.node)),
  }));
  assert.equal(opened,true);
  assert.equal(f.native.document.activeElement?.getAttribute("data-block-id"),"lifecycle-direction");
  assert.equal(f.store.projection.get().documentId,f.documentId);
  assert.equal(JSON.stringify(f.store.events.get()),source);
});

test("actual original-job child-render boundary cannot promote after a newer gesture",async t=>{
  const f=await lifecyclePage(t,{mode:"job"}),owner=lifecycleOwner(f),chosen=action(f,"job");
  const render=f.renderer.value.bind(f.renderer),traceStart=f.trace.length;let entered=false;
  f.renderer.value=function(value,component,...args){
    // Native renderer timing port only: preserve the actual child's complete
    // template and lifecycle method; deliver the newer gesture before its DOM promotion.
    if(!entered&&component?.tag==="forma-generation-input-dialog"&&component.open){entered=true;f.native.emit("keydown");}
    return render(value,component,...args);
  };
  const opened=await finishLifecycle(f,f.open(chosen,owner));
  assert.equal(entered,true,"the actual original-job child was reached");
  assert.equal(opened,false);
  assert.ok(!f.trace.slice(traceStart).some(value=>value==="open:generation-input-dialog"),
    "an eventual false return cannot excuse transient stale native promotion");
  f.sourceUnchanged();
});
