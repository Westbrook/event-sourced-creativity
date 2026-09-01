import assert from "node:assert/strict";
import { createCalmFullPage, registerCalmFullPageComponents, calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./output-navigation-focus-native.mjs";
import { installManualOutputNativeLifetime } from "./manual-output-native-lifetime.mjs";
import { observeActualSceneResumeReads } from "./actual-scene-resume-read.mjs";
import { documentIdFromRoute, withDocumentInRoute } from "../../src/model/routes.ts";

const classed=(node,name)=>String(node.attributes.class??"").split(/\s+/u).includes(name);
const inside=(node,parent)=>{for(let at=node;at;at=at.parent)if(at===parent)return true;return false;};

// Only the two legacy PromptFan entrypoints migrate. Same original Store,
// Worker, argument/Promise observer, Source denial/recovery and financial gates.
export async function promptFanSourceContinuationHost(t,h){
  const documentId=h.worker.documentId,projectId=h.worker.projectId,outputId="source-continuation-image",fanId="source-continuation-fan";
  const original=h.store.projection.get().libraryOutputs.find(value=>value.id===outputId);
  assert.ok(original?.mediaUrl);assert.equal(original.promptFanId,fanId);assert.equal(original.promptTechnique,"prose");
  const session=h.store.session.get(),resume=observeActualSceneResumeReads(h);t.after(()=>resume.restore());
  const f=await createCalmFullPage(t,{storeHost:h});
  h.store.session.set(session);await h.store.refreshEvents({fromStart:true});
  await registerCalmFullPageComponents(f,["forma-library","forma-workspace"]);
  f.nativeHistoryLocation=h.location;f.native=installOutputNavigationFocusNative(t,f,ports);
  h.store.setRoute(withDocumentInRoute("/",documentId,h.store.projection.get().documentTitle));
  let native=null;
  const drain=async()=>{
    let queues;
    for(let step=0;step<8;step++){
      await resume.settleOriginalRequests();
      for(const[id,timer]of [...h.timers])if(timer.delay===16){h.timers.delete(id);timer.callback(0);}
      await f.settle();await native?.settle();await resume.settleOriginalRequests();await h.worker.drainBackground();
      const documents=[...new Set(f.components().filter(child=>child.tag==="forma-output-requirements").map(child=>child.documentId).filter(Boolean))];
      queues={transports:resume.pendingOriginalCount(),componentFrames:f.frames.size,
        storeFrames:[...h.timers.values()].filter(timer=>timer.delay===16).length,renderRequests:Number(f.requested),
        outputReads:documents.filter(id=>["loading","refreshing"].includes(h.store.outputRequirements.resource(id).state)).length};
      if(Object.values(queues).every(value=>value===0))break;
    }
    assert.deepEqual(queues,{transports:0,componentFrames:0,storeFrames:0,renderRequests:0,outputReads:0});
  };
  const click=async node=>{
    assert.ok(node.port?.isConnected);assert.equal(node.hiddenBy,null);assert.equal(node.port.matches(":disabled"),false);
    f.native.emit("pointerdown",node.port);f.native.focus(node.port);
    await f.act(node,"click",{button:0});await drain();
  };
  await drain();
  await click(f.find("a",node=>node.owner.tag==="forma-ui-audience-navigation"
    &&new URL(node.attributes.href,"https://fixture.invalid").pathname==="/library"));
  const currentFan=(required=true)=>{
    const owners=f.components().filter(child=>child.tag==="forma-prompt-fan-review"&&child.isConnected&&child.store===h.store
      &&child.fanId===fanId&&child.closest("forma-library")?.isConnected);
    assert.ok(owners.length<=1);if(required)assert.equal(owners.length,1);
    if(owners[0])assert.equal(owners[0].closest("forma-shell"),f.host);
    return owners[0]??null;
  };
  native=installManualOutputNativeLifetime(t,{f,h,ports,dialogOwner:owner=>owner.tag==="forma-prompt-fan-review"
    &&owner.fanId===fanId&&owner.closest("forma-library")?.isConnected
    &&owner.closest("forma-library")?.store===h.store});
  const prepare=async input=>{
    await drain();const owner=currentFan();
    if(input.blockId!==undefined)assert.equal(input.blockId,outputId);
    const tree=f.tree(),dialogs=tree.visible("dialog").filter(node=>node.owner===owner&&classed(node,"prompt-fan-dialog"));
    assert.ok(dialogs.length<=1);
    if(dialogs.length){
      const close=tree.visible("button").filter(node=>node.owner===owner&&inside(node,dialogs[0])
        &&node.attributes["aria-label"]===f.i18n.system("Close prompt fan comparison"));
      assert.equal(close.length,1);await click(close[0]);
    }
    await click(f.find("button",node=>node.owner===owner&&classed(node,"prompt-fan-review-trigger")));
    const opened=f.tree().visible("dialog").filter(node=>node.owner===owner&&classed(node,"prompt-fan-dialog"));
    assert.equal(opened.length,1);assert.equal(opened[0].port.open,true);
  };
  const invoke=async(name,value)=>{
    assert.equal(name,"copy");assert.equal(value.id,outputId);assert.equal(value.mediaUrl,original.mediaUrl);
    const owner=currentFan(),tree=f.tree(),source=h.store.captureSourceOwnership();
    assert.ok(source&&h.store.sourceOwnershipActive(source));
    const dialogs=tree.visible("dialog").filter(node=>node.owner===owner&&classed(node,"prompt-fan-dialog"));
    assert.equal(dialogs.length,1);assert.equal(dialogs[0].port.open,true);
    const actions=tree.visible("button").filter(node=>node.owner===owner&&inside(node,dialogs[0])
      &&node.attributes["aria-label"]==="Use and edit the Prose image as input");
    assert.equal(actions.length,1);await click(actions[0]);
    if(h.store.sourceOwnershipActive(source)){
      const copies=h.store.projection.get().libraryBlocks.filter(block=>block.documentId===documentId&&block.properties.source_output_id===outputId);
      assert.equal(copies.length,1);assert.equal(documentIdFromRoute(h.store.route.get()),documentId);
      assert.equal(h.store.ui.editingBlockId,copies[0].id,"Healthy native entry opens the actual original editable input");
    }
  };
  const component=currentFan();
  for(const name of["fixturePrepare","fixtureInvoke","fixtureState"])assert.equal(typeof component[name],"undefined");
  // Compatibility names expose only actual native entry/readback. No private
  // field/method, current predicate, handler or Store implementation is replaced.
  Object.assign(component,{fixturePrepare:prepare,fixtureInvoke:invoke,fixtureState:()=>{
    const owner=currentFan(false);if(!owner)return{open:false};
    const dialogs=f.tree().visible("dialog").filter(node=>node.owner===owner&&classed(node,"prompt-fan-dialog"));
    assert.ok(dialogs.length<=1);return{open:dialogs.length===1&&dialogs[0].port.open};
  }});
  assert.equal(h.store.projection.get().projectId,projectId);assert.equal(h.store.projection.get().documentId,documentId);
  assert.equal(h.store.events.get().some(event=>event.eventId.startsWith("synthetic-study-")),false);
  return{component,frame:f,bind:()=>ports.bindFixture(f)};
}
