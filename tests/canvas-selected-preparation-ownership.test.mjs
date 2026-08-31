import assert from "node:assert/strict";
import test from "node:test";
import { options, BOARD, OTHER_DOCUMENT, classed, drain, reached, dialogs, boardPage, ports, sceneDeferred } from "./helpers/board-lifecycle-navigation-fixture.mjs";
import { nextActionFacts } from "../src/state/next-action-context.ts";
import { creativeActionSourceRevision, creativeNextActions, creativeNextTargetAvailable } from "../src/model/workspace-intelligence.ts";

function boardOwner(f){const route=f.store.route.get(),source=f.store.captureSourceOwnership(),authorization=f.store.captureAuthorizationScope();
  const selected=JSON.stringify(f.store.canvasPlanningSelection.get()),documentId=f.store.canvasPlanningDocumentId();let current=true;
  return{origin:f.canvas,retire:()=>{current=false;},originCurrent:()=>current&&f.canvas.isConnected&&f.store.route.get()===route
    &&f.store.sourceOwnershipActive(source)&&f.store.authorizationScopeActive(authorization)
    &&f.store.canvasProjection.get().selectedCanvasId===BOARD&&JSON.stringify(f.store.canvasPlanningSelection.get())===selected
    &&f.store.canvasPlanningDocumentId()===documentId,navigationCurrent:()=>current};}
async function selectedTarget(f,kind){
  if(kind==="compare")for(const[index,canvasId]of[[0,BOARD],[1,BOARD],[2,"lifecycle-other-board"]]){
    const id="selected-compare-"+index;
    await f.external("GenerationCompleted",{document_id:f.documentId,canvas_id:canvasId,generation_id:id,object_ids:[id],
      title:id,provider:"in-memory-saved-metadata",model_id:"fixture-saved-image",media_url:"/api/media/"+id,media_type:"image/png",image_width:640,image_height:480});
    await f.external("ObjectSaved",{document_id:f.documentId,object_id:id});
  }
  await drain(f,2);const facts=nextActionFacts(f.store,f.documentId,null,{lifecycle:true});
  const scope={projectId:facts.projectId,documentId:facts.documentId,canvasId:null,authorityKey:facts.authorityKey,sourceGeneration:facts.sourceGeneration};
  const target=kind==="compare"?{...scope,kind,outputIds:["selected-compare-1","selected-compare-0"]}
    :kind==="configure"?{...scope,kind,medium:"audio",sourceRevision:creativeActionSourceRevision(facts)}
      :{...scope,kind,sourceRevision:creativeActionSourceRevision(facts)};
  assert.ok(creativeNextTargetAvailable(target,facts),"an actual current exact selection is available");
  assert.equal(creativeNextActions(facts).some(row=>JSON.stringify(row.target)===JSON.stringify(target)),false,
    "the selected target is deliberately not one of the Document's current recommendations");
  return target;
}
async function finish(f,pending){let done=false,value,error;Promise.resolve(pending).then(result=>{done=true;value=result;},failure=>{done=true;error=failure;});
  await reached(f,()=>done,"the same real selected opening promise completes");if(error)throw error;return value;}
for(const kind of["context","configure","compare"])test("restricted explicit "+kind+" keeps exact selected intent while default recommendation API still refuses it",options,async t=>{
  const f=await boardPage(t),target=await selectedTarget(f,kind),owner=boardOwner(f),module=await ports.loadActual("src/components/creative-next-action-navigation.ts");
  const before=JSON.stringify(f.store.events.get()),route=f.store.route.get(),requests=f.storeHost.requests.length;
  const action={id:kind==="context"?"add-context":kind==="compare"?"compare-images":"configure-output",label:"",reason:"",title:"",priority:0,evidence:0,target};
  assert.equal(await finish(f,module.openCreativeNextActionDestination(f.store,f.native.document,action,owner)),false);
  assert.equal(f.store.route.get(),route);assert.equal(f.storeHost.requests.length,requests);assert.equal(dialogs(f).length,0);
  assert.equal(typeof module.openSelectedCreativePreparationDestination,"function","the separately restricted entry exists only in the candidate");
  assert.equal(await finish(f,module.openSelectedCreativePreparationDestination(f.store,f.native.document,target,owner)),true);
  assert.equal(f.canvas.isConnected,false);assert.equal(f.store.projection.get().documentId,f.documentId);
  const name=kind==="context"?"block-composer-dialog":kind==="configure"?"document-artifact-create":"comparison-modal";
  const dialog=dialogs(f).find(value=>classed(value,name));assert.ok(dialog,"actual existing native selected destination");
  if(kind==="compare")assert.equal(f.store.ui.comparisonOutputIds,target.outputIds.join("|"));
  if(kind==="configure"){
    const radios=f.tree().visible("input").filter(value=>value.owner===dialog.owner&&value.attributes.name==="artifact-kind");
    assert.ok(radios.length>1,"actual existing format controls, not only a label match");
    assert.deepEqual(radios.filter(value=>value.port?.checked).map(value=>value.attributes.value),["audio"],
      "the explicit Audio choice is the sole checked native format and is not replaced");
  }
  const node=f.tree().visible("button").find(value=>value.owner===dialog.owner);assert.ok(node?.port);
  f.native.emit("keydown",node.port);await drain(f,2);assert.ok(dialogs(f).some(value=>classed(value,name)),"normal editing survives disposal of opening focus");
  assert.equal(JSON.stringify(f.store.events.get()),before);await f.sourceUnchanged();
});
for(const boundary of["source","selection"])test("restricted selected preparation refuses a retired original board "+boundary,options,async t=>{
  const f=await boardPage(t),target=await selectedTarget(f,"configure"),owner=boardOwner(f),module=await ports.loadActual("src/components/creative-next-action-navigation.ts");
  assert.equal(typeof module.openSelectedCreativePreparationDestination,"function");const entered=sceneDeferred(),release=sceneDeferred();
  f.storeHost.intercept=async request=>{if(request.url!=="/api/session?audience=creative")return;const response=await f.storeHost.worker.request(request.url,request.init);assert.equal(response.status,200);entered.resolve();await release.promise;return response;};
  const pending=module.openSelectedCreativePreparationDestination(f.store,f.native.document,target,owner);await entered.promise;
  if(boundary==="source")await f.external("BlockPropertyEdited",{document_id:f.documentId,block_id:"scene-reuse-direction",property_path:"text",new_value:"Current source after explicit selection"});
  else assert.equal(f.store.chooseCanvasPlanningDocument(OTHER_DOCUMENT),true);
  const route=f.store.route.get(),start=f.trace.length;release.resolve();assert.equal(await finish(f,pending),false);
  assert.equal(f.store.route.get(),route);assert.equal(dialogs(f).length,0);
  assert.equal(f.trace.slice(start).some(value=>value.startsWith("open:")&&/next-format-dialog|document-artifact-create|generation-details-dialog/u.test(value)),false);
  await f.sourceUnchanged();
});

test("restricted preparation entry rejects non-preparation runtime values before navigation",options,async t=>{
  const f=await boardPage(t),module=await ports.loadActual("src/components/creative-next-action-navigation.ts");
  assert.equal(typeof module.openSelectedCreativePreparationDestination,"function");
  const actual=creativeNextActions(nextActionFacts(f.store,f.documentId,null,{lifecycle:true}))
    .find(row=>!["context","configure","compare"].includes(row.target.kind));assert.ok(actual);
  const route=f.store.route.get(),requests=f.storeHost.requests.length,events=JSON.stringify(f.store.events.get());let ownerCalls=0;
  const owner={originCurrent:()=>{ownerCalls++;return true;},navigationCurrent:()=>{ownerCalls++;return true;}};
  // Real non-preparation recommendation plus malformed JS input: the type-only
  // union must not become an any-target recommendation bypass at runtime.
  for(const target of[actual.target,null])assert.equal(await module.openSelectedCreativePreparationDestination(f.store,f.native.document,target,owner),false);
  assert.equal(ownerCalls,0);assert.equal(f.store.route.get(),route);assert.equal(f.storeHost.requests.length,requests);
  assert.equal(JSON.stringify(f.store.events.get()),events);assert.equal(dialogs(f).length,0);await f.sourceUnchanged();
});
