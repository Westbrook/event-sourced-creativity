// Prepared, not author-executed. Public complete Store + actual RAM Worker.
// Only delivery of the original catalog Response.json result is held.
import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {createSceneCostFixture,createSceneStoreHost,sceneDeferred,readWorkspaceEvents,financial} from "./helpers/event-source-retirement-fixture.mjs";

const options={concurrency:false,timeout:45000};
const pause=()=>new Promise(resolve=>setImmediate(resolve));
const digest=value=>createHash("sha256").update(value).digest("hex");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const nextActor={"oai-authenticated-user-id":"binding-completion-next-actor","oai-authenticated-user-email":"binding-completion-next-actor@example.test"};
const selected=["scene-reuse-direction"];
const privateTables=["event_private_payloads","event_client_receipts","private_content"];
const packageTables=["organization_context_packages","organization_context_package_versions","organization_context_package_contents","organization_context_package_sources"];
const immutableTables=["events",...privateTables,...packageTables,"organization_audit_events","project_context_package_bindings","project_context_package_members","project_notifications","project_event_scopes","project_resource_scopes"];
const tables=(worker,names)=>Object.fromEntries(names.map(name=>[name,worker.sqlite.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));
const view=h=>structuredClone({session:h.store.session.get(),events:h.store.events.get(),content:h.store.content.get(),head:h.store.head.get(),
  replay:h.store.replayEvents.get(),packages:h.store.organizationContextPackages.get(),bindings:h.store.organizationContextBindings.get(),
  versions:h.store.organizationContextVersions.get(),toast:h.store.ui.toast,route:h.store.route.get(),
  project:h.store.projection.get().projectId,document:h.store.projection.get().documentId});
const documentView=h=>{const {packages,bindings,versions,...current}=view(h);return current;};

async function fixture(t,action){
  t.mock.method(globalThis,"fetch",async()=>assert.fail("No external network or provider call is authorized by this fixture"));
  const worker=await createSceneCostFixture(1,"visual",{shared:true}),share=worker.sharing;
  const oldHistory=globalThis.history;
  let h=null,release=null,state=null,settle=null,beforeMoney=null;
  t.after(async()=>{
    release?.resolve();
    try{
      if(state?.original)await state.original;
      if(settle)await settle();else await worker.drainBackground();
      if(beforeMoney)assert.deepEqual(financial(worker),beforeMoney,"All nine complete fiscal tables remain unchanged");
      if(h)assert.equal(h.requests.filter(row=>row.url.startsWith("/api/document-jobs")).length,0);
    }finally{globalThis.history=oldHistory;if(h)await h.close();else worker.close();}
  });
  const originalHeaders={...share.headers};
  // Genuine account initialization precedes the full nine-table baseline. It
  // never assigns the new account to the original Store or grants it a role.
  worker.setScopedHeaders(nextActor);
  const initialized=await worker.request("/api/session");assert.equal(initialized.status,200);
  assert.equal((await initialized.json()).user.userId,nextActor["oai-authenticated-user-id"]);
  await worker.drainBackground();worker.setScopedHeaders(originalHeaders);
  const otherDocument="binding-completion-other-document";
  const authored=await worker.request("/api/events",worker.json({action:"append",event:{type:"DocumentCreated",payload:{project_id:worker.projectId,document_id:otherDocument,title:"Another current document"}}}));
  assert.equal(authored.status,200,await authored.clone().text());
  const authoredBody=await authored.json();assert.equal(authoredBody.appended.length,1);
  assert.equal(authoredBody.appended[0].payload.document_id,otherDocument);
  const base="/api/workspaces/"+share.organizationId+"/context-packages";
  const name="Original binding completion "+action;
  const sourceRequest={sourceProjectAccessId:share.projectAccessId,documentId:worker.documentId,blockIds:selected,sourceRightsConfirmed:false,sourceNonSensitiveConfirmed:false};
  const created=await worker.request(base,worker.json({name,description:"",...sourceRequest}));
  assert.equal(created.status,201,await created.clone().text());const first=await created.json();
  assert.equal(first.status,"draft");assert.equal(first.version,1);
  const publish=async draft=>{
    const response=await worker.request(base+"/"+draft.packageId+"/versions/"+draft.versionId+"/publish",{method:"POST"});
    assert.equal(response.status,200,await response.clone().text());const body=await response.json();
    assert.equal(body.status,"published");
    for(const key of ["packageId","versionId","version","contentSha256"])assert.equal(body[key],draft[key]);
    return body;
  };
  await publish(first);
  let initialBinding=null,latest=first;
  if(action!=="adopt"){
    const response=await worker.request(base+"/"+first.packageId+"/adopt",worker.json({projectAccessId:share.projectAccessId,documentId:worker.documentId,versionId:first.versionId,updateMode:"follow-approved"}));
    assert.equal(response.status,201,await response.clone().text());initialBinding=await response.json();
    assert.match(initialBinding.bindingId,uuid);assert.equal(initialBinding.appended.length,1);
  }
  if(action==="accept"){
    // A genuine new immutable version of the same original decision. Its
    // adoption updates the binding and exact per-block version provenance;
    // it is not a supplied success or a claim of edited source text.
    const response=await worker.request(base+"/"+first.packageId+"/versions",worker.json(sourceRequest));
    assert.equal(response.status,201,await response.clone().text());latest=await response.json();
    assert.equal(latest.version,2);assert.equal(latest.packageId,first.packageId);assert.notEqual(latest.versionId,first.versionId);
    await publish(latest);
  }
  await worker.drainBackground();
  h=await createSceneStoreHost({workerFixture:worker,exposeSceneTestAccessors:false});
  // Reuse the existing finite native history port. The Document control below
  // calls the real public setRoute method; no projection or event is replaced.
  globalThis.history={pushState(_state,_title,route){const url=new URL(route,"http://localhost");Object.assign(h.location,{pathname:url.pathname,search:url.search,hash:url.hash,href:url.href});},replaceState(...args){this.pushState(...args);}};
  h.intercept=request=>{assert.ok(!request.url.startsWith("/api/document-jobs"),"No job inspection, retry, dispatch or inherited synthetic job transport is used");};
  // The inherited bare /studio URL is not a Document/task route. Select the
  // actual original through the existing Library Document-context contract.
  h.store.setRoute("/library?document="+encodeURIComponent(worker.documentId));
  await h.store.syncOrganizationContextPackages();await worker.drainBackground();
  const original={authorization:h.store.captureAuthorizationScope(),source:h.store.captureSourceOwnership(),head:h.store.head.get(),name,
    projectId:h.store.projection.get().projectId,documentId:h.store.projection.get().documentId};
  assert.equal(h.store.session.get().user.userId,worker.owner);
  assert.equal(h.store.session.get().projectContext.organizationId,share.organizationId);
  assert.equal(h.store.session.get().projectContext.projectAccessId,share.projectAccessId);
  assert.equal(h.store.session.get().projectContext.managedPilot,false,"Existing unmanaged owner contract, not independent controlled-pilot approval evidence");
  assert.equal(original.projectId,worker.projectId);assert.equal(original.documentId,worker.documentId);
  assert.ok(h.store.projection.get().documents.some(row=>row.id===otherDocument&&row.projectId===worker.projectId&&!row.removed));
  assert.ok(h.store.authorizationScopeActive(original.authorization)&&h.store.sourceOwnershipActive(original.source));
  const item=h.store.organizationContextPackages.get().find(row=>row.id===first.packageId);
  assert.ok(item);assert.equal(item.versionId,latest.versionId);
  const bindingBefore=initialBinding?worker.sqlite.prepare("SELECT * FROM project_context_package_bindings WHERE binding_id=?").get(initialBinding.bindingId):null;
  if(initialBinding){
    const binding=h.store.organizationContextBindings.get().find(row=>row.id===initialBinding.bindingId);
    assert.ok(binding);assert.equal(binding.documentId,worker.documentId);assert.equal(binding.projectAccessId,share.projectAccessId);
    assert.equal(binding.organizationId,share.organizationId);assert.equal(binding.packageId,first.packageId);
    assert.equal(binding.versionId,first.versionId);assert.equal(binding.updateMode,"follow-approved");
    assert.equal(binding.pendingVersionId,action==="accept"?latest.versionId:null);
  }
  beforeMoney=financial(worker);const beforePrivate=tables(worker,privateTables),beforePackages=tables(worker,packageTables);
  const beforeHistory=await readWorkspaceEvents(worker.env,worker.streamId),beforeAudit=tables(worker,["organization_audit_events"]).organization_audit_events;
  const beforeMembers=tables(worker,["project_context_package_members"]).project_context_package_members;
  state={records:[],syncCalls:[],errors:[],fetches:0,entered:null,original:null,settled:false,returned:undefined};
  release=sceneDeferred();const jsonEntry=sceneDeferred();
  const originalSync=h.store.syncOrganizationContextPackages;
  t.mock.method(h.store,"syncOrganizationContextPackages",function(...args){
    const call={authorization:this.captureAuthorizationScope(),actor:this.session.get()?.user.userId,args};state.syncCalls.push(call);
    const promise=Reflect.apply(originalSync,this,args);call.promise=promise;return promise;
  });
  const endpoint=base+"/"+first.packageId+(action==="adopt"?"/adopt":"/bindings/"+initialBinding.bindingId);
  const requestBody=action==="adopt"?{projectAccessId:share.projectAccessId,documentId:worker.documentId,versionId:first.versionId,updateMode:"pinned",expectedProjectHead:original.head}
    :action==="accept"?{action:"accept",versionId:latest.versionId,expectedProjectHead:original.head}:{action:"policy",updateMode:"pinned"};
  h.transport=async request=>{
    state.fetches++;
    try{
      const method=(request.init.method??"GET").toUpperCase();
      assert.ok(!request.url.startsWith("/api/document-jobs"));
      if(!["GET","HEAD"].includes(method)){
        assert.equal(request.url,endpoint,"Only the exact original binding operation may write");
        assert.equal(method,action==="adopt"?"POST":"PATCH");
      }
      const response=await worker.request(request.url,request.init);
      const record={request,response,status:response.status,receipt:null,parsed:null,jsonCalls:0};state.records.push(record);
      const write=method==="POST"||method==="PATCH",catalog=method==="GET"&&request.url===base;
      if(write)record.receipt=await response.clone().json();
      if(write||catalog){
        const originalJson=response.json;
        Object.defineProperty(response,"json",{configurable:true,value:function(...args){
          assert.equal(this,response,"The original native Response receiver is unchanged");record.jsonCalls++;
          return Reflect.apply(originalJson,this,args).then(async body=>{
            record.parsed=body;if(write)assert.deepEqual(body,record.receipt,"The caller parses the actual original receipt bytes");
            if(catalog&&!state.entered){
              assert.equal(response.status,200);assert.ok(Array.isArray(body.packages));
              assert.ok(body.packages.some(row=>row.id===first.packageId));
              state.entered=record;jsonEntry.resolve(record);await release.promise;
            }
            return body; // Same parsed object; no replacement response or ACK.
          }).catch(error=>{state.errors.push(error);throw error;});
        }});
      }
      return response;
    }catch(error){state.errors.push(error);throw error;}
    finally{state.fetches--;}
  };
  settle=async()=>{
    let stable=0,previous=-1;
    for(let turn=0;turn<120;turn++){
      await pause();const count=h.requests.length;
      stable=state.fetches===0&&count===previous?stable+1:0;previous=count;
      if(stable===6){await worker.drainBackground();return;}
    }
    assert.fail("Actual read/background requests did not quiesce");
  };
  const invoke=()=>{
    state.original=action==="adopt"?h.store.adoptOrganizationContextPackage(first.packageId,first.versionId,"pinned")
      :action==="accept"?h.store.acceptOrganizationContextPackageUpdate(first.packageId,initialBinding.bindingId,latest.versionId)
      :h.store.setOrganizationContextPackageUpdateMode(first.packageId,initialBinding.bindingId,"pinned");
    state.original.then(value=>{state.settled=true;state.returned=value;},error=>{state.settled=true;state.errors.push(error);});
    return state.original;
  };
  const verifyOriginal=async()=>{
    assert.equal(state.errors.length,0,state.errors[0]?.stack);
    const writes=state.records.filter(row=>["POST","PATCH"].includes(row.request.init.method));
    assert.equal(writes.length,1,"One exact original operation; no repeat, replacement binding or new publication");
    const written=writes[0],receipt=written.receipt;
    assert.equal(written.request.url,endpoint);assert.deepEqual(written.request.body,requestBody);
    assert.equal(written.request.init.body,JSON.stringify(requestBody));assert.equal(written.status,action==="adopt"?201:200);
    assert.equal(written.jsonCalls,action==="policy"?0:1,"Policy retains its existing positive-header contract; other callers parse the original ACK once");
    assert.match(receipt.bindingId,uuid);if(initialBinding)assert.equal(receipt.bindingId,initialBinding.bindingId);
    const binding=worker.sqlite.prepare("SELECT * FROM project_context_package_bindings WHERE binding_id=?").get(receipt.bindingId);
    assert.ok(binding);assert.equal(binding.organization_id,share.organizationId);assert.equal(binding.project_access_id,share.projectAccessId);
    assert.equal(binding.project_id,worker.projectId);assert.equal(binding.document_id,worker.documentId);
    assert.equal(binding.package_id,first.packageId);assert.equal(binding.version_id,latest.versionId);
    assert.equal(binding.update_mode,action==="accept"?"follow-approved":"pinned");assert.equal(binding.pending_version_id,null);
    assert.equal(binding.created_by_user_id,worker.owner);assert.equal(binding.status,"active");assert.ok(Number.isFinite(Date.parse(binding.updated_at)));
    if(bindingBefore)assert.deepEqual({...binding},{...bindingBefore,version_id:latest.versionId,update_mode:action==="accept"?"follow-approved":"pinned",pending_version_id:null,updated_at:binding.updated_at},"Every SQLite column/value is compared; only the native row prototype is not a domain field");
    else assert.equal(binding.created_at,binding.updated_at);
    assert.deepEqual(tables(worker,packageTables),beforePackages,"Existing immutable package/version/content/source rows are not rewritten by binding completion");
    const content=worker.sqlite.prepare("SELECT content_json FROM organization_context_package_contents WHERE version_id=?").get(latest.versionId);
    assert.equal(digest(content.content_json),latest.contentSha256);const snapshot=JSON.parse(content.content_json);
    assert.equal(snapshot.organizationId,share.organizationId);assert.equal(snapshot.sourceProjectAccessId,share.projectAccessId);
    assert.equal(snapshot.sourceDocumentId,worker.documentId);assert.deepEqual(snapshot.blocks.map(block=>block.sourceBlockId),selected);
    assert.equal(snapshot.blocks[0].properties.text,"The keeper checks the harbor.");
    const members=tables(worker,["project_context_package_members"]).project_context_package_members;
    let member;
    if(action==="adopt"){
      assert.deepEqual(members.slice(0,beforeMembers.length),beforeMembers);assert.equal(members.length,beforeMembers.length+1);member=members.at(-1);
      assert.match(member.target_block_id,uuid);
      assert.deepEqual({...member},{binding_id:receipt.bindingId,organization_id:share.organizationId,source_block_id:selected[0],target_block_id:member.target_block_id,content_sha256:snapshot.blocks[0].contentSha256},"All member columns, not a filtered SQL projection");
      assert.equal(receipt.packageId,first.packageId);assert.equal(receipt.versionId,first.versionId);assert.equal(receipt.version,1);
      assert.equal(receipt.updateMode,"pinned");assert.deepEqual(receipt.rejected,[]);assert.equal(receipt.appended.length,1);assert.equal(receipt.head,original.head+1);
    }else{
      assert.deepEqual(members,beforeMembers,"Exact original member mapping and digest are unchanged");member=members.find(row=>row.binding_id===receipt.bindingId);
      assert.ok(member);
      if(action==="accept"){assert.equal(receipt.versionId,latest.versionId);assert.equal(receipt.version,2);assert.equal(receipt.changedEventCount,1);}
      else assert.deepEqual(receipt,{bindingId:initialBinding.bindingId,updateMode:"pinned"});
    }
    const history=await readWorkspaceEvents(worker.env,worker.streamId);
    assert.deepEqual(history.slice(0,beforeHistory.length),beforeHistory,"Every preceding canonical event retains exact body/order");
    const added=history.slice(beforeHistory.length),auditType=action==="adopt"?"OrganizationContextPackageAdopted":action==="accept"?"OrganizationContextPackageVersionAccepted":"OrganizationContextPackageBindingPolicyUpdated";
    assert.deepEqual(added.map(event=>event.type),[...(action==="policy"?[]:[action==="adopt"?"BlockCreated":"BlockPropertyEdited"]),auditType]);
    for(const [index,event]of added.entries()){
      assert.equal(event.streamId,worker.streamId);assert.equal(event.actor,"user:"+worker.owner);assert.match(event.eventId,uuid);assert.match(event.correlationId,uuid);
      assert.equal(event.sequence,(beforeHistory.at(-1)?.sequence??0)+index+1);assert.equal(event.schemaVersion,1);
      assert.equal(event.causationId,null);assert.equal(event.compensatesEventId,null);assert.equal(event.recordedAt,event.occurredAt);
      assert.ok(Number.isFinite(Date.parse(event.recordedAt)));
      if(event.type===auditType){
        assert.equal(event.clientId,"server:workspace");
        assert.deepEqual(event.payload,{organization_id:share.organizationId,resource_kind:"context-package-binding",resource_id:receipt.bindingId});
      }else{
        assert.equal(event.clientId,"project:"+worker.owner);
        if(action==="adopt"){
          assert.deepEqual(event.payload,{project_id:worker.projectId,document_id:worker.documentId,block_id:member.target_block_id,type:snapshot.blocks[0].type,handle:snapshot.blocks[0].handle,position:snapshot.blocks[0].position,scope:"document",properties:{...snapshot.blocks[0].properties,organization_context_package_id:first.packageId,organization_context_package_version_id:first.versionId,organization_context_package_binding_id:receipt.bindingId,organization_context_source_block_id:selected[0]}});
          assert.deepEqual(receipt.appended[0],{...event,streamId:"project:"+share.projectAccessId,sequence:original.head+1},"Original public append receipt identifies the same canonical event in its actual project stream");
        }else assert.deepEqual(event.payload,{project_id:worker.projectId,document_id:worker.documentId,block_id:member.target_block_id,property_path:"organization_context_package_version_id",old_value:first.versionId,new_value:latest.versionId});
      }
    }
    assert.equal(new Set(history.map(event=>event.eventId)).size,history.length);
    const audit=tables(worker,["organization_audit_events"]).organization_audit_events;
    assert.deepEqual(audit.slice(0,beforeAudit.length),beforeAudit);assert.equal(audit.length,beforeAudit.length+1);
    const row=audit.at(-1);assert.match(row.audit_id,uuid);assert.equal(row.organization_id,share.organizationId);assert.equal(row.actor_user_id,worker.owner);
    assert.equal(row.action,auditType);assert.equal(row.resource_kind,"context-package-binding");assert.equal(row.resource_id,receipt.bindingId);
    assert.equal(row.detail_json,JSON.stringify(action==="adopt"?{version:1,blockCount:1}:action==="accept"?{previousVersion:1,version:2,changedBlockCount:1}:{updateMode:"pinned"}));
    const afterPrivate=tables(worker,privateTables);
    assert.deepEqual(afterPrivate.event_client_receipts,beforePrivate.event_client_receipts);
    assert.deepEqual(afterPrivate.private_content,beforePrivate.private_content,"No original private content is replaced");
    const prefix=beforePrivate.event_private_payloads,suffix=afterPrivate.event_private_payloads.slice(prefix.length);
    assert.deepEqual(afterPrivate.event_private_payloads.slice(0,prefix.length),prefix,"Every old private row and byte remains intact");
    assert.deepEqual(suffix.map(row=>row.private_event_id),added.map(event=>event.eventId),"Only the independently validated original event suffix adds one private row per event");
    for(const [index,row]of suffix.entries()){
      const event=added[index];assert.deepEqual(Object.keys(row).sort(),["private_event_id","owner_id","project_id","document_id","private_json","created_at","redacted_at"].sort());
      assert.equal(row.owner_id,worker.owner);assert.equal(row.project_id,event.payload.project_id??null);assert.equal(row.document_id,event.payload.document_id??null);
      assert.equal(row.private_json,JSON.stringify(event.payload));assert.equal(row.created_at,event.recordedAt);assert.equal(row.redacted_at,null);
    }
    assert.deepEqual(financial(worker),beforeMoney,"Every row/column in all nine fiscal tables is unchanged");
    return{bindingId:receipt.bindingId,packageId:first.packageId,versionId:latest.versionId,contentSha256:latest.contentSha256,eventIds:added.map(event=>event.eventId),canonical:tables(worker,immutableTables)};
  };
  return{h,worker,state,original,base,otherDocument,release,jsonEntry,settle,invoke,verifyOriginal};
}

for(const action of ["adopt","accept","policy"])
for(const successor of ["healthy","real-principal","other-document"])test("context binding original completion "+action+" / final catalog / "+successor,options,async t=>{
  const f=await fixture(t,action),{h,worker,state}=f,pending=f.invoke();
  // Synchronize on the actual validated original catalog JSON-entry event, or
  // the actual operation settling. Never substitute a success or extend time.
  await Promise.race([f.jsonEntry.promise,pending]);
  assert.equal(state.errors.length,0,state.errors[0]?.stack);assert.ok(state.entered,"The original operation reaches the held final catalog");
  assert.equal(state.entered.jsonCalls,1);assert.equal(state.settled,false);
  assert.ok(h.store.authorizationScopeActive(f.original.authorization)&&h.store.sourceOwnershipActive(f.original.source));
  const receipt=await f.verifyOriginal();
  if(successor==="real-principal"){
    worker.setScopedHeaders(nextActor);const session=await h.store.refreshSession();
    assert.equal(session.user.userId,nextActor["oai-authenticated-user-id"]);assert.equal(h.store.session.get(),session);
    assert.equal(Boolean(session.projectContext),false);assert.equal(h.store.authorizationScopeActive(f.original.authorization),false);
    assert.equal(h.store.sourceOwnershipActive(f.original.source),false);await f.settle();
    assert.equal(h.store.events.get().length,0);assert.equal(Object.keys(h.store.content.get()).length,0);
    assert.equal(h.store.organizationContextPackages.get().length,0);
  }else if(successor==="other-document"){
    h.store.setRoute("/library?document="+encodeURIComponent(f.otherDocument));
    assert.equal(h.store.projection.get().documentId,f.otherDocument);assert.equal(h.store.projection.get().projectId,worker.projectId);
    assert.equal(new URL(h.store.route.get(),"http://localhost").searchParams.get("document"),f.otherDocument);
    assert.ok(h.store.authorizationScopeActive(f.original.authorization)&&h.store.sourceOwnershipActive(f.original.source),"A same-principal/project Document switch does not retire organization authorization or Source");
    assert.equal(h.store.session.get().projectContext.projectAccessId,worker.sharing.projectAccessId);await f.settle();
  }
  const current=view(h),currentDocument=documentView(h),syncAtBoundary=state.syncCalls.length;
  f.release.resolve();const returned=await pending;await f.settle();
  assert.deepEqual(await f.verifyOriginal(),receipt,"The same original binding, immutable versions, canonical/private events, mappings and fiscal rows survive completion");
  assert.equal(returned,true,"A genuine original ACK remains true; feedback retirement is not failed/not-sent persistence");
  assert.equal(state.syncCalls.length,1);assert.equal(syncAtBoundary,1);assert.equal(state.syncCalls[0].actor,worker.owner);
  t.diagnostic(JSON.stringify({action,successor,returned,bindingId:receipt.bindingId,versionId:receipt.versionId,originalEventIds:receipt.eventIds,
    writeCount:state.records.filter(row=>["POST","PATCH"].includes(row.request.init.method)).length,syncAtBoundary,syncAfter:state.syncCalls.length,
    originalAuthorityCurrent:h.store.authorizationScopeActive(f.original.authorization),originalSourceCurrent:h.store.sourceOwnershipActive(f.original.source),
    currentDocument:h.store.projection.get().documentId,toastBefore:current.toast,toastAfter:h.store.ui.toast,canonicalAndNineFiscalTablesUnchanged:true}));
  if(successor==="real-principal")assert.deepEqual(view(h),current,"The old acknowledged binding may not publish catalog, private state or feedback into the new principal");
  else if(successor==="other-document"){
    // This already-issued catalog remains an authorized org/project read. It
    // may refresh that shared catalog, but cannot certify this different Doc.
    assert.deepEqual(documentView(h),currentDocument,"The original binding completion may not change or claim success for the different current Document");
    const originalBinding=h.store.organizationContextBindings.get().find(row=>row.id===receipt.bindingId);
    assert.ok(originalBinding);assert.equal(originalBinding.documentId,worker.documentId);assert.equal(originalBinding.versionId,receipt.versionId);
    assert.equal(h.store.organizationContextBindings.get().some(row=>row.documentId===f.otherDocument),false);
  }else{
    assert.ok(h.store.authorizationScopeActive(f.original.authorization)&&h.store.sourceOwnershipActive(f.original.source));
    assert.equal(h.store.projection.get().documentId,worker.documentId);
    assert.equal(h.store.ui.toast,action==="adopt"?"The approved context version is pinned to this document.":action==="accept"?"Published organization context version 2 was applied. Review any affected finished outputs again.":"This document is pinned to its current context version.");
    const binding=h.store.organizationContextBindings.get().find(row=>row.id===receipt.bindingId);
    assert.ok(binding);assert.equal(binding.documentId,worker.documentId);assert.equal(binding.versionId,receipt.versionId);
    assert.equal(binding.updateMode,action==="accept"?"follow-approved":"pinned");assert.equal(binding.pendingVersionId,null);
  }
});

// New read-only witness. Setup is the unchanged actual binding fixture above;
// its original mutation driver is deliberately never invoked in this family.
const catalogCache=h=>structuredClone({packages:h.store.organizationContextPackages.get(),bindings:h.store.organizationContextBindings.get(),versions:h.store.organizationContextVersions.get()});
const catalogSource=h=>{const current=documentView(h);delete current.toast;return current;};
const emptyCatalog={packages:[],bindings:[],versions:{}};

for(const mode of ["current-403","temporary-503","older-403-newer-complete-200"])test("organization catalog current read / "+mode,options,async t=>{
  const f=await fixture(t,"policy"),{h,worker}=f;
  await f.settle();
  const initial=catalogCache(h),sourceBefore=catalogSource(h),canonicalBefore=tables(worker,immutableTables),moneyBefore=financial(worker);
  assert.equal(initial.packages.length,1);assert.equal(initial.bindings.length,1);
  const item=initial.packages[0],binding=initial.bindings[0],version=initial.versions[item.versionId];
  assert.equal(item.name,f.original.name);assert.equal(binding.packageId,item.id);assert.equal(binding.documentId,worker.documentId);
  assert.equal(binding.versionId,item.versionId);assert.equal(version.blocks[0].properties.text,"The keeper checks the harbor.");
  assert.ok(h.store.authorizationScopeActive(f.original.authorization)&&h.store.sourceOwnershipActive(f.original.source));
  assert.equal(worker.env.FORMA_PILOT_COHORT_ID,undefined);assert.equal(worker.env.FORMA_ADMIN_EMAILS,undefined);
  const floor=h.requests.length,prior=h.transport,records=[],entered=sceneDeferred(),bodyEntry=sceneDeferred(),bodyGate=sceneDeferred(),headerGate=sceneDeferred();
  let first=null,read=null,active=0;
  const allowed=new Set([f.base,f.base+"/"+item.id+"/bindings",f.base+"/"+item.id+"/versions/"+item.versionId]);
  const noEffects=async()=>{
    await worker.drainBackground();
    assert.deepEqual(tables(worker,immutableTables),canonicalBefore,"Read denial/recovery does not rewrite any canonical, private, package, binding, audit, member or resource row");
    assert.deepEqual(financial(worker),moneyBefore,"Every row/column in all nine fiscal tables remains exact");
    assert.deepEqual(catalogSource(h),sourceBefore,"An organization-catalog refusal does not retire unrelated current Document/Source/session state");
    assert.ok(h.store.authorizationScopeActive(f.original.authorization)&&h.store.sourceOwnershipActive(f.original.source));
    assert.equal(f.state.original,null,"No original binding mutation or pretend positive write ACK is invoked by this read witness");
    assert.equal(h.requests.slice(floor).filter(row=>(row.init.method??"GET")!=="GET").length,0);
    assert.equal(h.requests.some(row=>row.url.startsWith("/api/document-jobs")),false,"No protected job read, Dismiss, retry, dispatch or equivalent");
  };
  h.transport=async request=>{
    assert.equal((request.init.method??"GET").toUpperCase(),"GET","This family admits no post-setup write");
    assert.ok(allowed.has(request.url),"Only the actual root catalog and its exact current binding/version reads are needed");
    active++;
    try{
      const selected=request.url===f.base&&first===null;
      let response,workerStatus,workerBody;
      if(selected&&mode!=="temporary-503"){
        // Actual requireUser denial, using the existing configured-cohort gate.
        // No rows, role grants, session/projection or membership are assigned.
        worker.env.FORMA_PILOT_COHORT_ID="catalog-denial-isolated-missing-cohort";
        try{response=await worker.request(request.url,request.init);}finally{delete worker.env.FORMA_PILOT_COHORT_ID;}
        workerStatus=response.status;workerBody=await response.clone().json();
        assert.equal(workerStatus,403);assert.deepEqual(workerBody,{error:"pilot_participant_required"});
      }else{
        response=await worker.request(request.url,request.init);workerStatus=response.status;
        assert.equal(workerStatus,200,await response.clone().text());
        if(selected){
          workerBody=await response.clone().json();assert.ok(Array.isArray(workerBody.packages)&&workerBody.packages.some(value=>value.id===item.id));
          // Only the temporary-failure control is finite HTTP503. The Worker
          // actually authorized this read; this is explicitly NOT revocation.
          response=Response.json({error:"fixture_temporary_catalog_failure"},{status:503});
        }
      }
      const record={request,response,workerStatus,workerBody,status:response.status,jsonCalls:0,parsed:null,delivered:false};records.push(record);
      if(selected){
        first=record;const originalJson=response.json;
        Object.defineProperty(response,"json",{configurable:true,value:function(...args){
          assert.equal(this,response,"The selected original Response/json receiver is unchanged");record.jsonCalls++;
          return Reflect.apply(originalJson,this,args).then(async body=>{record.parsed=body;bodyEntry.resolve(record);await bodyGate.promise;return body;});
        }});
        entered.resolve(record);
        if(mode==="older-403-newer-complete-200")await headerGate.promise;
      }
      record.delivered=true;return response;
    }finally{active--;}
  };
  try{
    read=h.store.syncOrganizationContextPackages();
    await Promise.race([entered.promise,read]);assert.ok(first,"The existing public catalog method reaches its real selected HTTP response");
    let atHeaders,newerComplete=null;
    if(mode==="older-403-newer-complete-200"){
      assert.equal(first.delivered,false);assert.equal(first.jsonCalls,0);
      await h.store.syncOrganizationContextPackages();assert.equal(active,1,"Only the original older header delivery remains held");
      newerComplete=catalogCache(h);assert.deepEqual(newerComplete,initial,"A genuinely completed newer catalog and exact child reads remain authorized");
      assert.equal(records.filter(row=>row.request.url===f.base&&row.status===200).length,1);
      headerGate.resolve();await Promise.race([bodyEntry.promise,read]);atHeaders=catalogCache(h);
    }else{
      await Promise.race([bodyEntry.promise,read]);atHeaders=catalogCache(h);
    }
    assert.equal(first.delivered,true);await noEffects();
    bodyGate.resolve();await read;assert.equal(active,0);
    const afterBody=catalogCache(h);await noEffects();
    // A fresh genuine authorized read is the recovery control. It is read-only,
    // not a claim that the earlier denial or an unknown write was successful.
    await h.store.syncOrganizationContextPackages();assert.equal(active,0);
    const recovered=catalogCache(h);assert.deepEqual(recovered,initial);await noEffects();
    assert.equal(records.filter(row=>row.request.url===f.base).length,mode==="older-403-newer-complete-200"?3:2);
    assert.equal(records.filter(row=>row.request.url.endsWith("/bindings")).length,mode==="older-403-newer-complete-200"?2:1);
    assert.equal(records.filter(row=>row.request.url.includes("/versions/")).length,mode==="older-403-newer-complete-200"?2:1);
    assert.equal(first.workerStatus,mode==="temporary-503"?200:403);
    t.diagnostic("C_ORGANIZATION_CATALOG_READ "+JSON.stringify({mode,status:first.status,workerStatus:first.workerStatus,
      originalJsonCalls:first.jsonCalls,atHeaders:{packages:atHeaders.packages.length,bindings:atHeaders.bindings.length,versions:Object.keys(atHeaders.versions).length},
      afterBody:{packages:afterBody.packages.length,bindings:afterBody.bindings.length,versions:Object.keys(afterBody.versions).length},
      newerCompleted:Boolean(newerComplete),freshRecoveryExact:true,currentSourceRetained:true,canonicalPrivateFiscalExact:true,writes:0,physicalOrProductionIncidentClaim:false}));
    if(mode==="current-403"){
      assert.deepEqual(atHeaders,emptyCatalog,"A current known catalog403 withdraws its private catalog before its held JSON body completes");
      assert.deepEqual(afterBody,emptyCatalog,"Completing that original denial must not retain or restore its old private catalog");
      assert.equal(first.jsonCalls,0,"Known current denial does not need to parse a body to withdraw private catalog data");
    }else{
      assert.deepEqual(atHeaders,initial,mode==="temporary-503"?"A temporary503 is not revocation":"An older denial cannot erase the genuinely completed newer exact catalog");
      assert.deepEqual(afterBody,initial);
    }
  }finally{
    headerGate.resolve();bodyGate.resolve();if(read)await read;
    delete worker.env.FORMA_PILOT_COHORT_ID;h.transport=prior;
  }
});

test("organization catalog current read / pending-newer-version-after-403",options,async t=>{
  const f=await fixture(t,"policy"),{h,worker}=f;await f.settle();
  const initial=catalogCache(h),sourceBefore=catalogSource(h),canonicalBefore=tables(worker,immutableTables),moneyBefore=financial(worker);
  assert.equal(initial.packages.length,1);assert.equal(initial.bindings.length,1);
  const item=initial.packages[0],binding=initial.bindings[0],version=initial.versions[item.versionId];
  assert.equal(item.name,f.original.name);assert.equal(binding.packageId,item.id);assert.equal(binding.documentId,worker.documentId);
  assert.equal(binding.versionId,item.versionId);assert.equal(version.blocks[0].properties.text,"The keeper checks the harbor.");
  assert.ok(h.store.authorizationScopeActive(f.original.authorization)&&h.store.sourceOwnershipActive(f.original.source));
  assert.equal(worker.env.FORMA_PILOT_COHORT_ID,undefined);assert.equal(worker.env.FORMA_ADMIN_EMAILS,undefined);
  const floor=h.requests.length,prior=h.transport,records=[],entered=sceneDeferred(),headerGate=sceneDeferred(),childEntry=sceneDeferred(),childGate=sceneDeferred();
  const bindingUrl=f.base+"/"+item.id+"/bindings",versionUrl=f.base+"/"+item.id+"/versions/"+item.versionId,allowed=new Set([f.base,bindingUrl,versionUrl]);
  let first=null,child=null,older=null,newer=null,newerSettled=false,active=0;
  const noEffects=async()=>{
    await worker.drainBackground();
    assert.deepEqual(tables(worker,immutableTables),canonicalBefore,"Every canonical/private/package/binding/audit/member/resource row stays exact across pending read retirement");
    assert.deepEqual(financial(worker),moneyBefore,"Every row/column in all nine fiscal tables remains exact");
    assert.deepEqual(catalogSource(h),sourceBefore,"Catalog-only denial does not retire unrelated current Document/Source/session state");
    assert.ok(h.store.authorizationScopeActive(f.original.authorization)&&h.store.sourceOwnershipActive(f.original.source));
    assert.equal(f.state.original,null);assert.equal(h.requests.slice(floor).filter(row=>(row.init.method??"GET")!=="GET").length,0);
    assert.equal(h.requests.some(row=>row.url.startsWith("/api/document-jobs")),false,"No protected job read, Dismiss, retry, dispatch or equivalent");
  };
  h.transport=async request=>{
    assert.equal((request.init.method??"GET").toUpperCase(),"GET");assert.ok(allowed.has(request.url));active++;
    try{
      const selected=request.url===f.base&&first===null;let response;
      if(selected){
        worker.env.FORMA_PILOT_COHORT_ID="catalog-denial-isolated-missing-cohort";
        try{response=await worker.request(request.url,request.init);}finally{delete worker.env.FORMA_PILOT_COHORT_ID;}
        assert.equal(response.status,403);assert.deepEqual(await response.clone().json(),{error:"pilot_participant_required"});
      }else{
        response=await worker.request(request.url,request.init);assert.equal(response.status,200,await response.clone().text());
      }
      const record={request,response,status:response.status,jsonCalls:0,parsed:null,delivered:false};records.push(record);
      if(selected){
        first=record;const originalJson=response.json;
        Object.defineProperty(response,"json",{configurable:true,value:function(...args){
          assert.equal(this,response);record.jsonCalls++;return Reflect.apply(originalJson,this,args);
        }});
        entered.resolve(record);await headerGate.promise;
      }else if(request.url===versionUrl&&child===null){
        const detail=await response.clone().json();assert.equal(detail.versionId,item.versionId);
        assert.equal(detail.snapshot.sourceDocumentId,worker.documentId);assert.equal(detail.snapshot.blocks[0].properties.text,"The keeper checks the harbor.");
        child=record;const originalJson=response.json;
        Object.defineProperty(response,"json",{configurable:true,value:function(...args){
          assert.equal(this,response,"The newer actual child keeps its original Response/json receiver");record.jsonCalls++;
          return Reflect.apply(originalJson,this,args).then(async body=>{record.parsed=body;assert.deepEqual(body,detail);childEntry.resolve(record);await childGate.promise;return body;});
        }});
      }
      record.delivered=true;return response;
    }finally{active--;}
  };
  try{
    older=h.store.syncOrganizationContextPackages();await Promise.race([entered.promise,older]);
    assert.ok(first,"The older genuine403 is ready, but has not delivered its headers");assert.equal(first.delivered,false);assert.equal(first.jsonCalls,0);
    newer=h.store.syncOrganizationContextPackages().then(value=>{newerSettled=true;return value;});
    await Promise.race([childEntry.promise,newer]);assert.ok(child,"The newer genuine200 collection reaches its exact held version body");
    assert.equal(child.status,200);assert.equal(child.delivered,true);assert.equal(child.jsonCalls,1);assert.equal(newerSettled,false);
    assert.equal(active,1,"Only the older catalog header transport remains held; the newer child body is separately pending");
    assert.deepEqual(catalogCache(h),initial);await noEffects();
    headerGate.resolve();await older;const atDenial=catalogCache(h);assert.equal(first.delivered,true);assert.equal(newerSettled,false);await noEffects();
    childGate.resolve();await newer;assert.equal(active,0);const afterChild=catalogCache(h);await noEffects();
    await h.store.syncOrganizationContextPackages();assert.equal(active,0);assert.deepEqual(catalogCache(h),initial);await noEffects();
    assert.deepEqual(records.filter(row=>row.request.url===f.base).map(row=>row.status),[403,200,200]);
    assert.equal(records.filter(row=>row.request.url===bindingUrl).length,2);assert.equal(records.filter(row=>row.request.url===versionUrl).length,2);
    assert.equal(child.jsonCalls,1);assert.equal(child.parsed.versionId,item.versionId);
    t.diagnostic("C_ORGANIZATION_CATALOG_PENDING_CHILD "+JSON.stringify({originalStatus:first.status,originalJsonCalls:first.jsonCalls,newerRootStatus:200,childStatus:child.status,childJsonCalls:child.jsonCalls,
      atDenial:{packages:atDenial.packages.length,bindings:atDenial.bindings.length,versions:Object.keys(atDenial.versions).length},
      afterChild:{packages:afterChild.packages.length,bindings:afterChild.bindings.length,versions:Object.keys(afterChild.versions).length},
      newerWasPendingAtDenial:true,freshRecoveryExact:true,currentSourceRetained:true,canonicalPrivateFiscalExact:true,writes:0,physicalOrProductionIncidentClaim:false}));
    assert.deepEqual(atDenial,emptyCatalog,"An issued newer child is not completed root-catalog authority and cannot shield the older current403");
    assert.deepEqual(afterChild,emptyCatalog,"The already-issued newer child cannot republish a catalog retired while its exact body was pending");
    assert.equal(first.jsonCalls,0,"Known current denial withdraws its scoped catalog at headers, without a JSON prerequisite");
  }finally{
    headerGate.resolve();childGate.resolve();await Promise.allSettled([older,newer].filter(Boolean));
    delete worker.env.FORMA_PILOT_COHORT_ID;h.transport=prior;
  }
});
