import assert from "node:assert/strict";

// Explicit opt-in finite native port, not an application/currentness authority.
// Extends the existing same-EventPart literal retention with the queued native
// close delivery needed by original-lease reuse. Other native nodes are untouched.
// The inherited modalPort only flips open. This port does not invent showModal's
// previous-focus slot or synchronous native restoration from an open-IDL change.
export function installManualOutputNativeLifetime(t,{f,h,ports,dialogOwner,searchOwner=()=>false,routeEvents=false}){
  const draw=f.renderer.draw.bind(f.renderer),collect=f.renderer.collect.bind(f.renderer);
  const records=new Map(),seen=new Set(),openers=new Map(),seenOpeners=new Set(),tasks=new Map(),deliveries=[],routeDeliveries=[],errors=[],dispatches=new Map(),holds=new Set();
  let drawing=false,disposed=false,nextClose=null,openerDiagnosticCount=0;
  const classed=(node,name)=>String(node.attributes.class??"").split(/\s+/u).includes(name);
  const classes={"forma-document-artifacts":"document-artifact-view","forma-prompt-fan-review":"prompt-fan-dialog","forma-generation-actions":"generation-details-dialog"};
  const retire=owner=>{const record=records.get(owner);if(record)record.node.isConnected=false;records.delete(owner);};
  const binding=(node,event,required=true)=>{
    const token=[...node.full.matchAll(/\s@(close|input|click)=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/gu)].find(value=>value[1]===event);
    const value=token?f.renderer.bindings[Number(token[2])]:null;
    if(!required&&(!value||value.owner!==node.owner||typeof value.value!=="function"))return null;
    assert.ok(value&&value.owner===node.owner&&typeof value.part==="string"
      &&typeof value.value==="function"&&value.value===node.handlers[event],"Actual current native EventPart owns this literal");
    return value.part;
  };
  const openerCurrent=record=>{
    const projection=h.store.projection.get(),artifact=projection.libraryArtifacts.find(value=>value.id===record.artifactId);
    return record.owner.isConnected&&record.owner.store===h.store&&record.parent===record.owner.parentElement
      &&projection.projectId===record.projectId
      &&projection.documents.some(value=>value.id===record.documentId&&value.projectId===record.projectId&&!value.removed)
      &&(record.hostDocumentId===null||record.owner.documentId===record.hostDocumentId)
      &&h.store.captureAuthorizationScope()?.key===record.authority
      &&h.store.captureSourceOwnership()?.generation===record.generation
      &&artifact?.documentId===record.documentId&&artifact.sequence===record.sequence
      &&artifact.sourceEventId===record.sourceEventId&&artifact.contentRef===record.contentRef;
  };
  const retainCurrentOpeners=(owner,start)=>{
    const freshNodes=f.renderer.nodes.slice(start);
    for(const record of openers.values()){
      if(record.owner===owner)record.diagnosticCollected=true;
      if(record.owner!==owner||!openerCurrent(record))continue;
      const matches=freshNodes.filter(node=>node.tag===record.node.tag&&binding(node,"click",false)===record.part);
      record.diagnosticMatches=matches.length;
      record.diagnosticSameHref=record.href===undefined?null:freshNodes.filter(node=>node.owner===owner
        &&node.tag===record.node.tag&&typeof node.handlers.click==="function"&&node.attributes.href===record.href).length;
      record.diagnosticMatchedHref=matches.length===1&&record.href!==undefined?matches[0].attributes.href===record.href:null;
      assert.ok(matches.length<=1,"One exact original opener EventPart, never a same-label substitute");
      if(!matches.length||!record.node.isConnected)continue;
      const fresh=matches[0],node=record.node;
      if(record.href!==undefined&&fresh.attributes.href!==record.href)continue;
      for(const key of["full","properties","propertyParts","handlers","value","checked","committedValue"])node[key]=fresh[key];
      node.attributes={...fresh.attributes};node.parentElement=owner;node.isConnected=true;
      f.renderer.nodes[f.renderer.nodes.indexOf(fresh)]=node;fresh.isConnected=false;seenOpeners.add(node);
    }
  };
  const queue=callback=>{
    let resolve;const promise=new Promise(done=>{resolve=done;});
    const id=setImmediate(async()=>{
      try{if(!disposed){ports.bindFixture(f);await callback();}}catch(error){errors.push(error);}finally{tasks.delete(id);resolve();}
    });
    tasks.set(id,{promise,resolve});return promise;
  };
  const nativeDispatch=owner=>{
    if(owner.tag!=="forma-document-artifacts"||dispatches.has(owner))return;
    const descriptor=Object.getOwnPropertyDescriptor(owner,"dispatchEvent"),original=owner.dispatchEvent;
    assert.equal(original,ports.ElementPort.prototype.dispatchEvent,"Only the inherited finite DOM dispatch primitive is extended");
    const dispatch=function(event){
      if(event.type!=="document-artifact-close")return Reflect.apply(original,this,[event]);
      const target=Object.getOwnPropertyDescriptor(event,"target"),current=Object.getOwnPropertyDescriptor(event,"currentTarget");
      Object.defineProperties(event,{target:{configurable:true,value:this},currentTarget:{configurable:true,value:this}});
      try{return Reflect.apply(original,this,[event]);}finally{
        if(target)Object.defineProperty(event,"target",target);else delete event.target;
        if(current)Object.defineProperty(event,"currentTarget",current);else delete event.currentTarget;
      }
    };
    owner.dispatchEvent=dispatch;dispatches.set(owner,{descriptor,dispatch});
  };
  const nativeDialog=(node,owner)=>{
    const listeners=[],add=node.addEventListener.bind(node),remove=node.removeEventListener.bind(node);
    // First creation occurs before the actual component's opening listener.
    assert.equal(node.listeners?.close,undefined,"No registered close callback may be dropped during native setup");
    node.addEventListener=(type,callback,options={})=>{
      if(type!=="close")return add(type,callback,options);
      const capture=typeof options==="boolean"?options:Boolean(options.capture),once=typeof options==="object"&&Boolean(options.once);
      if(!callback||listeners.some(value=>value.callback===callback&&value.capture===capture))return;
      listeners.push({callback,capture,once});
    };
    node.removeEventListener=(type,callback,options={})=>{
      if(type!=="close")return remove(type,callback,options);
      const capture=typeof options==="boolean"?options:Boolean(options.capture);
      const index=listeners.findIndex(value=>value.callback===callback&&value.capture===capture);
      if(index>=0)listeners.splice(index,1);
    };
    node.close=()=>{
      if(disposed||!node.open)return;
      node.open=false;node.removeAttribute("open");f.trace.push("close:"+node.attributes.class);
      const hold=nextClose?.node===node?nextClose:null;
      if(hold){nextClose=null;hold.reached.resolve();}
      void queue(async()=>{
        if(hold){await hold.release.promise;holds.delete(hold);if(disposed)return;ports.bindFixture(f);}
        let immediate=false;const event={type:"close",target:node,currentTarget:node,eventPhase:2,bubbles:false,cancelable:false,
          stopPropagation(){},stopImmediatePropagation(){immediate=true;},preventDefault(){}};
        const trace={node,owner,capture:0,target:0,ordinary:0,zeroTasks:0};deliveries.push(trace);
        const originalTimers=new Set(f.timers.keys());
        const invoke=async entry=>{
          if(immediate||!listeners.includes(entry))return;
          if(entry.once)node.removeEventListener("close",entry.callback,entry.capture);
          try{if(typeof entry.callback==="function")entry.callback.call(node,event);else entry.callback.handleEvent(event);}
          catch(error){errors.push(error);}
          // A UA-delivered callback can checkpoint microtasks with no outer
          // script dispatchEvent frame. This intentionally catches R2's flaw.
          await Promise.resolve();
        };
        for(const entry of [...listeners].filter(value=>value.capture)){trace.capture++;await invoke(entry);}
        if(!immediate&&node.handlers.close){trace.target++;try{node.handlers.close.call(owner,event);}catch(error){errors.push(error);}await Promise.resolve();}
        for(const entry of [...listeners].filter(value=>!value.capture)){trace.ordinary++;await invoke(entry);}
        // Reuse the existing timer port's exact newly scheduled timer0. Do not
        // invoke a substitute, run future timers, or flush unrelated old work.
        for(const[id,timer]of [...f.timers])if(!originalTimers.has(id)&&timer.delay===0){
          trace.zeroTasks++;void queue(()=>{if(f.timers.get(id)!==timer)return;f.timers.delete(id);timer.callback();});
        }
      });
    };
  };
  f.renderer.collect=(markup,owner)=>{
    const start=f.renderer.nodes.length;collect(markup,owner);if(!drawing)return;
    retainCurrentOpeners(owner,start);
    const dialog=Boolean(classes[owner?.tag]&&owner.store===h.store&&dialogOwner(owner));
    const search=owner?.tag==="forma-ui-search"&&owner.parentElement?.isConnected&&owner.parentElement.store===h.store&&searchOwner(owner);
    if(!dialog&&!search)return;
    if(dialog)nativeDispatch(owner);
    const matches=f.renderer.nodes.slice(start).filter(node=>dialog?node.tag==="dialog"&&classed(node,classes[owner.tag])
      :node.tag==="input"&&node.attributes.type==="search");
    assert.ok(matches.length<=1);if(!matches.length)return;
    const fresh=matches[0],part=binding(fresh,dialog?"close":"input"),property=dialog?null:fresh.propertyParts.value;
    if(search)assert.equal(typeof property,"string");
    if(dialog)assert.equal(Object.hasOwn(fresh.attributes,"open"),false);
    const named=dialog&&owner.tag==="forma-document-artifacts";
    if(named)assert.equal(Object.hasOwn(fresh.attributes,"aria-label"),false);
    const authority=h.store.captureAuthorizationScope()?.key,source=h.store.captureSourceOwnership();assert.ok(authority&&source);
    const previous=records.get(owner),same=previous?.node.isConnected&&previous.part===part&&previous.property===property
      &&previous.store===h.store&&previous.authority===authority&&previous.generation===source.generation&&previous.parent===owner.parentElement;
    if(same){
      const node=previous.node,open=node.open,label=node.getAttribute("aria-label");
      for(const key of["full","properties","propertyParts","handlers","value","checked","committedValue"])node[key]=fresh[key];
      node.attributes={...fresh.attributes};node.parentElement=owner;node.isConnected=true;
      if(dialog){node.open=open;if(named&&label!==null)node.setAttribute("aria-label",label);}else node.open=fresh.open;
      f.renderer.nodes[f.renderer.nodes.indexOf(fresh)]=node;fresh.isConnected=false;
    }else{
      retire(owner);if(dialog)nativeDialog(fresh,owner);
      records.set(owner,{node:fresh,part,property,store:h.store,authority,generation:source.generation,parent:owner.parentElement});
    }
    seen.add(owner);
  };
  f.renderer.draw=(...args)=>{
    seen.clear();seenOpeners.clear();drawing=true;
    for(const record of openers.values()){
      record.diagnosticCollected=false;record.diagnosticMatches=null;
      record.diagnosticSameHref=null;record.diagnosticMatchedHref=null;
    }
    try{return draw(...args);}finally{drawing=false;const present=new Set(f.renderer.nodes);
      for(const[owner,record]of records)if(!seen.has(owner)||!present.has(record.node)||!owner.isConnected)retire(owner);
      for(const[node,record]of openers)if(!seenOpeners.has(node)||!present.has(node)||!openerCurrent(record)){
        if(record.owner.tag==="forma-library"&&openerDiagnosticCount++<4){
          const projection=h.store.projection.get(),artifact=projection.libraryArtifacts.find(value=>value.id===record.artifactId);
          t.diagnostic("C_LIBRARY_ARTIFACT_OPENER_RETIREMENT "+JSON.stringify({
            ownerCollected:record.diagnosticCollected,matchedClickParts:record.diagnosticMatches,
            sameHrefClickCandidates:record.diagnosticSameHref,sameHrefAtMatchedPart:record.diagnosticMatchedHref,
            seenAsOriginal:seenOpeners.has(node),originalPresent:present.has(node),originalConnected:node.isConnected,
            ownerConnected:record.owner.isConnected,sameParent:record.parent===record.owner.parentElement,
            sameStore:record.owner.store===h.store,sameProject:projection.projectId===record.projectId,
            originalDocumentPresent:projection.documents.some(value=>value.id===record.documentId&&value.projectId===record.projectId&&!value.removed),
            sameHostDocument:record.hostDocumentId===null||record.owner.documentId===record.hostDocumentId,
            sameAuthority:h.store.captureAuthorizationScope()?.key===record.authority,
            sameSource:h.store.captureSourceOwnership()?.generation===record.generation,
            sameCanonicalArtifact:artifact?.documentId===record.documentId&&artifact.sequence===record.sequence
              &&artifact.sourceEventId===record.sourceEventId&&artifact.contentRef===record.contentRef,
            routeChanged:h.store.route.get()!==record.diagnosticRoute,libraryOutputsSelected:h.store.ui.libraryView==="outputs",
            originalScopeCurrent:openerCurrent(record),
          }));
        }
        node.isConnected=false;openers.delete(node);
      }
    }
  };
  const forward=event=>{
    const callbacks=[...(f.listeners.get("forma-route-changed")??[])];
    routeDeliveries.push({event,path:event.detail?.path,storeRoute:h.store.route.get(),callbacks:callbacks.length});
    for(const handler of callbacks)handler(event);
  };
  if(routeEvents)h.window.addEventListener("forma-route-changed",forward);
  t.after(()=>{disposed=true;if(routeEvents)h.window.removeEventListener("forma-route-changed",forward);
    for(const hold of holds)hold.release.resolve();holds.clear();nextClose=null;
    for(const[id,task]of tasks){clearImmediate(id);task.resolve();}tasks.clear();
    for(const[owner,{descriptor,dispatch}]of dispatches)if(owner.dispatchEvent===dispatch){if(descriptor)Object.defineProperty(owner,"dispatchEvent",descriptor);else delete owner.dispatchEvent;}
    openers.clear();
    for(const owner of records.keys())retire(owner);f.renderer.draw=draw;f.renderer.collect=collect;
    if(errors.length)throw new AggregateError(errors,"Actual native close callback errors");
  });
  const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
  return{deliveries,routeDeliveries,pendingCloseCount:()=>tasks.size,
    retainArtifactOpener(node,artifactId){
      const owner=node?.owner,artifact=h.store.projection.get().libraryArtifacts.find(value=>value.id===artifactId);
      assert.ok(node?.isConnected&&f.renderer.nodes.includes(node)&&owner?.isConnected&&owner.store===h.store);
      assert.ok(owner.tag==="forma-document-artifacts"&&node.tag==="button"
        ||owner.tag==="forma-library"&&node.tag==="a"&&classed(node,"library-artifact-open"));
      const projectId=h.store.projection.get().projectId;
      assert.ok(artifact&&h.store.projection.get().documents.some(value=>value.id===artifact.documentId&&value.projectId===projectId&&!value.removed));
      const source=h.store.captureSourceOwnership(),authority=h.store.captureAuthorizationScope()?.key;
      assert.ok(source&&authority);const part=binding(node,"click");
      const previous=openers.get(node);
      if(previous){assert.equal(previous.artifactId,artifactId);assert.equal(previous.part,part);assert.ok(openerCurrent(previous));return;}
      openers.set(node,{node,owner,parent:owner.parentElement,part,authority,generation:source.generation,projectId,
        diagnosticRoute:h.store.route.get(),
        hostDocumentId:owner.tag==="forma-document-artifacts"?owner.documentId:null,
        artifactId,documentId:artifact.documentId,sequence:artifact.sequence,sourceEventId:artifact.sourceEventId,
        contentRef:artifact.contentRef,href:owner.tag==="forma-library"?node.attributes.href:undefined});
    },
    holdNextClose(node){
      assert.equal(nextClose,null);assert.ok(node?.isConnected&&node.open&&[...records.values()].some(record=>record.node===node));
      const hold={node,reached:deferred(),release:deferred()};nextClose=hold;holds.add(hold);
      return{reached:hold.reached.promise,release:()=>hold.release.resolve()};
    },
    async settle(){while(tasks.size)await Promise.all([...tasks.values()].map(value=>value.promise));if(errors.length)throw new AggregateError(errors,"Actual native close callback errors");},
  };
}
