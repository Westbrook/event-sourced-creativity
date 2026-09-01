import assert from "node:assert/strict";
import { createCalmFullPage, registerCalmFullPageComponents, calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./output-navigation-focus-native.mjs";
import { installImageFormatNativeLifetime } from "./image-format-native-lifetime.mjs";
import { observeActualSceneResumeReads } from "./actual-scene-resume-read.mjs";
import { withDocumentInRoute } from "../../src/model/routes.ts";

const hasClass=(node,name)=>String(node.attributes.class??"").split(/\s+/u).includes(name);
const inside=(node,parent)=>{for(let at=node;at;at=at.parent)if(at===parent)return true;return false;};

// Navigation-only migration of the old direct-private-handler Source fixture.
// The existing complete Shell/Guided/Store/Worker and native renderer own every
// control; no navigateFrom/current/Source method is substituted.
export async function navigationSourceContinuationHost(t,h,action){
  assert.ok(action==="context"||action==="previous");
  const documentId=h.store.projection.get().documentId,projectId=h.store.projection.get().projectId;
  const original=h.store.projection.get().libraryBlocks.find(block=>block.id==="scene-reuse-direction");
  assert.ok(original);
  if(action==="context"){
    assert.equal(original.scope,"document");
    // The real reusable picker lists standalone Library roots, not arbitrary
    // document-private blocks. Preserve this exact original block ID and text
    // through an explicitly accounted, actual Worker-backed setup rehome.
    const rows=await h.store.append({type:"BlockRehomed",payload:{block_id:original.id,project_id:projectId,from_project_id:original.projectId,scope:"library"}});
    assert.equal(rows.length,1);assert.equal(rows[0].type,"BlockRehomed");
    assert.deepEqual(rows[0].payload,{block_id:original.id,project_id:projectId,from_project_id:original.projectId,scope:"library"});
    const current=h.store.projection.get().libraryBlocks.find(block=>block.id===original.id);
    assert.equal(current.scope,"library");assert.equal(current.documentId,"");assert.deepEqual(current.properties,original.properties);
  }
  const session=h.store.session.get(),resume=observeActualSceneResumeReads(h);t.after(()=>resume.restore());
  const f=await createCalmFullPage(t,{storeHost:h});
  h.store.session.set(session);await h.store.refreshEvents({fromStart:true});
  await registerCalmFullPageComponents(f,["forma-guided-brief"]);
  f.nativeHistoryLocation=h.location;f.native=installOutputNavigationFocusNative(t,f,ports);
  h.store.setRoute(withDocumentInRoute("/studio/guided",documentId,h.store.projection.get().documentTitle));
  const x={f,h,worker:h.worker,resume,after:callback=>t.after(callback)};
  const drain=async()=>{
    let queues;
    for(let step=0;step<8;step++){
      await resume.settleOriginalRequests();
      for(const[id,timer]of [...h.timers])if(timer.delay===16){h.timers.delete(id);timer.callback(0);}
      await f.settle();await resume.settleOriginalRequests();await h.worker.drainBackground();
      const documents=[...new Set(f.components().filter(child=>child.tag==="forma-output-requirements").map(child=>child.documentId).filter(Boolean))];
      queues={transports:resume.pendingOriginalCount(),componentFrames:f.frames.size,
        storeFrames:[...h.timers.values()].filter(timer=>timer.delay===16).length,renderRequests:Number(f.requested),
        outputReads:documents.filter(id=>["loading","refreshing"].includes(h.store.outputRequirements.resource(id).state)).length};
      if(Object.values(queues).every(value=>value===0))break;
    }
    assert.deepEqual(queues,{transports:0,componentFrames:0,storeFrames:0,renderRequests:0,outputReads:0});
  };
  await drain();installImageFormatNativeLifetime(x);
  const mode=()=>{
    const found=f.components().filter(child=>child.tag==="forma-studio-mode-nav");
    assert.equal(found.length,1);assert.ok(found[0].isConnected);assert.equal(found[0].store,h.store);
    assert.equal(found[0].closest("forma-shell"),f.host);return found[0];
  };
  const nativeClick=async node=>{
    assert.ok(node.port?.isConnected);assert.equal(node.port.matches(":disabled"),false);
    f.native.emit("pointerdown",node.port);f.native.focus(node.port);
    await f.act(node,"click",{button:0});await drain();
  };
  const prepare=async input=>{
    await drain();const owner=mode();
    if(input.blockId!==undefined)assert.equal(input.blockId,original.id);
    const currentTree=f.tree(),open=currentTree.visible("dialog").filter(node=>node.owner===owner&&hasClass(node,"context-set-picker-dialog"));
    assert.ok(open.length<=1);
    if(open.length){
      const close=currentTree.visible("button").filter(node=>node.owner===owner&&hasClass(node,"modal-close")&&inside(node,open[0]));
      assert.equal(close.length,1,"One actual current picker Close in the same native tree");
      await nativeClick(close[0]);
    }
    await nativeClick(f.find("button",node=>node.owner===owner&&hasClass(node,"context-set-trigger")));
    let tree=f.tree(),dialog=tree.visible("dialog").filter(node=>node.owner===owner&&hasClass(node,"context-set-picker-dialog"));
    assert.equal(dialog.length,1);assert.equal(dialog[0].port.open,true);
    const choices=tree.nodes.filter(node=>node.tag==="forma-ui-choice-card"&&node.component?.isConnected&&!node.hiddenBy&&inside(node,dialog[0]));
    assert.deepEqual(choices.map(node=>node.component.value),["create","reuse"]);
    const choice=choices.find(node=>node.component.value==="reuse").component;
    await nativeClick(f.find("button",node=>node.owner===choice&&node.attributes["data-choice-value"]==="reuse"));
    tree=f.tree();dialog=tree.visible("dialog").filter(node=>node.owner===owner&&hasClass(node,"context-set-picker-dialog"));
    assert.equal(dialog.length,1);assert.equal(dialog[0].port.open,true);
  };
  const invoke=async(name,value)=>{
    assert.equal(name,action);const owner=mode(),tree=f.tree();
    const dialogs=tree.visible("dialog").filter(node=>node.owner===owner&&hasClass(node,"context-set-picker-dialog"));
    assert.equal(dialogs.length,1);assert.equal(dialogs[0].port.open,true);
    const source=action==="context"?h.store.projection.get().libraryBlocks.find(block=>block.id===value)
      :h.store.projection.get().libraryArtifacts.find(artifact=>artifact.id===value);
    assert.ok(source);if(action==="context")assert.equal(source.scope,"library");
    const label=action==="context"?source.handle:source.title;
    const cards=tree.visible("article").filter(node=>node.owner===owner&&inside(node,dialogs[0])
      &&tree.visible("h3").some(heading=>inside(heading,node)&&heading.text===label));
    assert.equal(cards.length,1);
    const buttons=tree.visible("button").filter(node=>node.owner===owner&&inside(node,cards[0]));
    assert.equal(buttons.length,1);assert.equal(buttons[0].text,f.i18n.system(action==="context"?"Add block":"Use & edit"));
    await nativeClick(buttons[0]);
  };
  const component=mode();
  for(const name of["fixturePrepare","fixtureInvoke","fixtureState"])assert.equal(typeof component[name],"undefined");
  // Test-only compatibility methods never supply application currentness.
  // After genuine Source retirement, preparation/readback uses the actual
  // newly mounted current owner; the held original handler stays on its child.
  Object.assign(component,{fixturePrepare:prepare,fixtureInvoke:invoke,fixtureState:()=>{
    const current=f.components().filter(child=>child.tag==="forma-studio-mode-nav");
    assert.equal(current.length,1);assert.equal(current[0].store,h.store);
    const dialogs=f.tree().visible("dialog").filter(node=>node.owner===current[0]&&hasClass(node,"context-set-picker-dialog"));
    assert.ok(dialogs.length<=1);return{open:dialogs.length===1&&dialogs[0].port.open};
  }});
  assert.equal(h.store.projection.get().projectId,projectId);assert.equal(h.store.projection.get().documentId,documentId);
  assert.equal(h.store.events.get().some(event=>event.eventId.startsWith("synthetic-study-")),false);
  return{component,frame:f,bind:()=>ports.bindFixture(f)};
}
