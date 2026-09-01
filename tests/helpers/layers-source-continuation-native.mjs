import assert from "node:assert/strict";
import { createCalmFullPage, registerCalmFullPageComponents, calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./output-navigation-focus-native.mjs";
import { retainNativeSubmitForms } from "./deferred-focus-invokers.mjs";
import { observeActualSceneResumeReads } from "./actual-scene-resume-read.mjs";
import { withDocumentInRoute } from "../../src/model/routes.ts";

const hasClass=(node,name)=>String(node.attributes?.class??"").split(/\s+/u).includes(name);
const inside=(node,parent)=>{for(let at=node;at;at=at.parent)if(at===parent)return true;return false;};
const eventPost=request=>request.url==="/api/events"&&request.init.method==="POST";
const blockText=block=>String(block.properties.artifact_markdown??block.properties.text??block.properties.label??block.handle);

// Only the four existing Layers copy continuations use this actual native host.
// The original test still owns the real Store method, delivered Worker result,
// post-result hold, genuine 403/recovery and unchanged financial/no-job guards.
export async function layersSourceContinuationHost(t,h){
  const {projectId,documentId}=h.store.projection.get(),session=h.store.session.get();
  const anchor=h.store.projection.get().blocks.find(block=>block.id==="scene-reuse-direction");
  assert.ok(anchor&&anchor.projectId===projectId&&anchor.documentId===documentId);
  const requestStart=h.requests.length,resume=observeActualSceneResumeReads(h);t.after(()=>resume.restore());
  const f=await createCalmFullPage(t,{storeHost:h});
  // Same upfront setup as the existing native Studio Source helper: remove
  // its presentation sample through the actual original Worker read. No
  // Source, session or projection is assigned during the measured operation.
  h.store.session.set(session);await h.store.refreshEvents({fromStart:true});
  await registerCalmFullPageComponents(f,["forma-reality-layers"]);
  f.nativeHistoryLocation=h.location;f.native=installOutputNavigationFocusNative(t,f,ports);
  const owners={has:owner=>owner?.tag==="forma-reality-layers"&&owner.isConnected&&owner.store===h.store};
  retainNativeSubmitForms(f,owners,form=>form.classList.contains("layer-inspector"));
  h.store.setRoute(withDocumentInRoute("/studio/layers",documentId,h.store.projection.get().documentTitle));
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
  await drain();
  assert.equal(f.host.tag,"forma-shell");assert.equal(f.host.store,h.store);
  assert.equal(h.store.projection.get().projectId,projectId);assert.equal(h.store.projection.get().documentId,documentId);
  assert.equal(h.store.events.get().some(event=>event.eventId.startsWith("synthetic-study-")),false);
  for(const request of h.requests.slice(requestStart))assert.ok((request.init.method??"GET")==="GET"||resume.isReadOnlyResume(request),
    "Native Layers setup allows only original GET or exact independently certified read-only Resume");
  const current=()=>{
    const found=f.components().filter(owner=>owner.tag==="forma-reality-layers"&&owner.isConnected);
    assert.equal(found.length,1);assert.equal(found[0].store,h.store);assert.equal(found[0].closest("forma-shell"),f.host);return found[0];
  };
  const inspect=()=>{
    const owner=current(),tree=f.tree(),forms=tree.visible("form").filter(node=>node.owner===owner&&hasClass(node,"layer-inspector"));
    assert.equal(forms.length,1,"The actual current Layers inspector must be rendered");const form=forms[0];
    assert.ok(form.port?.isConnected);assert.equal(form.port.closest("forma-reality-layers"),owner);
    const selectedId=form.attributes["data-layer-inspector"],blocks=h.store.projection.get().blocks.filter(block=>block.id===selectedId);
    assert.equal(blocks.length,1);const selected=blocks[0];
    assert.equal(selected.projectId,projectId);assert.equal(selected.documentId,documentId);
    const fields=Object.fromEntries(["handle","instructions","subtype","weight"].map(name=>{
      const values=tree.nodes.filter(node=>node.owner===owner&&node.attributes?.name===name&&!node.hiddenBy
        &&["input","textarea","select"].includes(node.tag)&&inside(node,form));
      assert.equal(values.length,1);assert.ok(values[0].port?.isConnected);assert.equal(values[0].port.closest("form"),form.port);
      return[name,values[0]];
    }));
    const options=tree.nodes.filter(node=>node.tag==="option"&&inside(node,fields.subtype)).map(node=>({
      value:String(node.attributes.value??node.text),nativeSelected:typeof node.port?.selected==="boolean"?node.port.selected:null}));
    const evidence={selectedId,ownerConnected:owner.isConnected,sameStore:owner.store===h.store,formConnected:form.port.isConnected,
      handleMatches:fields.handle.port.value===selected.handle,instructionsMatch:fields.instructions.port.value===blockText(selected),
      subtypeValue:fields.subtype.port.value,canonicalSubtype:selected.properties.subtype??null,emittedOptions:options,
      nativeSelectedIndex:typeof fields.subtype.port.selectedIndex==="number"?fields.subtype.port.selectedIndex:null,
      weightValue:fields.weight.port.value,canonicalWeight:selected.properties.weight??.5};
    return{owner,tree,form,selected,fields,evidence};
  };
  const click=node=>{
    assert.ok(node.port?.isConnected&&node.owner?.isConnected&&!node.hiddenBy);assert.equal(node.port.matches(":disabled"),false);
    assert.equal(typeof node.handlers.click,"function");assert.equal(node.port.handlers.click,node.handlers.click);
    f.native.emit("pointerdown",node.port);f.native.focus(node.port);
    return node.handlers.click.call(node.owner,{type:"click",button:0,target:node.port,currentTarget:node.port,
      defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}});
  };
  let sourceId="",beforeCopyIds=null,lastEntry=null;
  const prepare=async input=>{
    await drain();
    if(input.blockId!==undefined){assert.equal(input.selected,"original-selection");sourceId=input.blockId;}
    else assert.equal(input.selected,"new-selection");
    assert.ok(sourceId);
    // The old alternatives bridge ignored text and used invented selection
    // strings. Select an actual current object instead: original copy source,
    // then the genuine direction after Source recovery (not the pending copy).
    const id=input.blockId!==undefined?sourceId:anchor.id;
    const targets=h.store.projection.get().blocks.filter(block=>block.id===id);assert.equal(targets.length,1);const target=targets[0];
    if(input.blockId===undefined){
      assert.ok(beforeCopyIds);
      const copied=h.store.projection.get().blocks.filter(block=>!beforeCopyIds.has(block.id)&&block.properties.copied_from_block_id===sourceId);
      assert.equal(copied.length,1,"The original committed copy is present after the independent Source read");
      assert.notEqual(target.id,copied[0].id,"The fresh native selection differs from the held completion's target");
    }
    const before=inspect(),actions=before.tree.visible("button").filter(node=>node.owner===before.owner&&hasClass(node,"layer-name")
      &&node.children.some(child=>typeof child==="object"&&child.tag==="b"&&child.text===target.handle));
    assert.equal(h.store.projection.get().blocks.filter(block=>block.handle===target.handle).length,1);
    assert.equal(actions.length,1);const posts=h.requests.filter(eventPost).length;
    await click(actions[0]);await drain();const after=inspect();
    t.diagnostic("C_LAYERS_SOURCE_SELECTION "+JSON.stringify({phase:input.blockId!==undefined?"initial":"recovered",targetId:id,before:before.evidence,after:after.evidence}));
    assert.equal(after.selected.id,id,"The genuine native selection must reach the intended current object before Copy continuation evidence");
    assert.equal(h.requests.filter(eventPost).length,posts,"Native selection does not save or append");
  };
  const invoke=async(name,value)=>{
    assert.equal(name,"copy");assert.equal(value.id,sourceId);const view=inspect();
    assert.equal(view.selected.id,sourceId);assert.deepEqual(view.selected.sourceEvents,value.sourceEvents);
    assert.deepEqual(view.selected.properties,value.properties);
    const actions=view.tree.visible("button").filter(node=>node.owner===view.owner&&inside(node,view.form)
      &&node.text==="Make a copy"&&node.attributes.type==="button");
    assert.equal(actions.length,1);beforeCopyIds=new Set(h.store.projection.get().blocks.map(block=>block.id));
    const expectedSubtype=String(view.selected.properties.subtype??view.evidence.emittedOptions[0]?.value??"");
    const matchingOptionCount=view.evidence.emittedOptions.filter(option=>option.value===expectedSubtype).length;
    lastEntry={before:view.evidence,expectedSubtype,matchingOptionCount,handlerReturned:false,returnType:null};
    t.diagnostic("C_LAYERS_SOURCE_COPY_CONTROL "+JSON.stringify(lastEntry));
    assert.equal(view.evidence.subtypeValue,expectedSubtype,"Native subtype prerequisite: the current value must equal the existing canonical subtype or its emitted default");
    assert.equal(matchingOptionCount,1,"Native subtype prerequisite: the reported current value is not represented by one emitted option; no copy admission can be certified");
    const original=click(actions[0]);assert.equal(typeof original?.then,"function","The actual Make a copy handler returns its original Promise");
    const result=await original;lastEntry.handlerReturned=true;lastEntry.returnType=result===undefined?"undefined":typeof result;
    t.diagnostic("C_LAYERS_SOURCE_COPY_RETURN "+JSON.stringify(lastEntry));
    await drain();return result;
  };
  const awaitOriginalEntry=async(entered,pending)=>{
    const reached=await Promise.race([entered.then(()=>true),pending.then(()=>false)]);
    t.diagnostic("C_LAYERS_SOURCE_COPY_ENTRY "+JSON.stringify({enteredOriginalStoreResult:reached,...lastEntry}));
    assert.equal(reached,true,"Actual native Make a copy completed without reaching the original Store result; this is an entry prerequisite, not a held-response failure");
  };
  const component=current();
  for(const name of["fixturePrepare","fixtureInvoke","fixtureState"])assert.equal(typeof component[name],"undefined");
  Object.assign(component,{fixturePrepare:prepare,fixtureInvoke:invoke,fixtureState:()=>({selected:inspect().selected.id})});
  return{component,frame:f,bind:()=>ports.bindFixture(f),awaitOriginalEntry};
}
