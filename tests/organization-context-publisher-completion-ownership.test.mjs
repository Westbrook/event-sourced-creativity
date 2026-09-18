// Prepared, not author-executed. Public complete Store + real RAM Worker responses.
// Only delivery of the original Response.json result is held; no success is supplied.
import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {createSceneCostFixture,createSceneStoreHost,sceneDeferred,readWorkspaceEvents,financial} from "./helpers/event-source-retirement-fixture.mjs";

const options={concurrency:false,timeout:45000};
const pause=()=>new Promise(resolve=>setImmediate(resolve));
const digest=value=>createHash("sha256").update(value).digest("hex");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const selected=["scene-reuse-direction"];
const nextActor={"oai-authenticated-user-id":"publisher-completion-next-actor","oai-authenticated-user-email":"publisher-completion-next-actor@example.test"};
const immutableTables=["events","event_private_payloads","event_client_receipts","private_content",
  "organization_context_packages","organization_context_package_versions","organization_context_package_contents",
  "organization_context_package_sources","organization_audit_events","project_context_package_bindings","project_notifications"];
const tables=(worker,names)=>Object.fromEntries(names.map(name=>[name,worker.sqlite.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));
const privateTables=["event_private_payloads","event_client_receipts","private_content"];
const view=h=>structuredClone({session:h.store.session.get(),events:h.store.events.get(),content:h.store.content.get(),head:h.store.head.get(),
  replay:h.store.replayEvents.get(),packages:h.store.organizationContextPackages.get(),bindings:h.store.organizationContextBindings.get(),
  versions:h.store.organizationContextVersions.get(),toast:h.store.ui.toast,route:h.store.route.get(),
  project:h.store.projection.get().projectId,document:h.store.projection.get().documentId});

async function fixture(t,method,boundary){
  t.mock.method(globalThis,"fetch",async()=>assert.fail("No external network or provider call is authorized by this fixture"));
  const worker=await createSceneCostFixture(1,"visual",{shared:true});
  const originalHeaders={...worker.sharing.headers};
  // Prime the genuine next account before the fiscal baseline, without changing
  // the original Store owner. This preserves every lazy zero-use budget row.
  worker.setScopedHeaders(nextActor);
  const initialized=await worker.request("/api/session");assert.equal(initialized.status,200);
  assert.equal((await initialized.json()).user.userId,nextActor["oai-authenticated-user-id"]);
  await worker.drainBackground();worker.setScopedHeaders(originalHeaders);
  const h=await createSceneStoreHost({workerFixture:worker,exposeSceneTestAccessors:false});
  const state={records:[],syncCalls:[],errors:[],fetches:0,entered:null,original:null,settled:false,returned:undefined};
  const release=sceneDeferred(),jsonEntry=sceneDeferred();
  const base="/api/workspaces/"+worker.sharing.organizationId+"/context-packages";
  const name="Original publisher completion "+method+" "+boundary;
  const original={authorization:h.store.captureAuthorizationScope(),source:h.store.captureSourceOwnership(),head:h.store.head.get(),name};
  assert.equal(h.store.session.get().user.userId,worker.owner);
  assert.equal(h.store.session.get().projectContext.organizationId,worker.sharing.organizationId);
  assert.equal(h.store.session.get().projectContext.projectAccessId,worker.sharing.projectAccessId);
  assert.equal(h.store.projection.get().documentId,worker.documentId);
  assert.equal(h.store.session.get().projectContext.managedPilot,false,"Ordinary owner-publisher contract; not independent controlled-pilot approval evidence");
  assert.ok(h.store.authorizationScopeActive(original.authorization)&&h.store.sourceOwnershipActive(original.source));
  const requestBody={name,description:"",sourceProjectAccessId:worker.sharing.projectAccessId,documentId:worker.documentId,
    blockIds:selected,expectedSourceHead:original.head,sourceRightsConfirmed:false,sourceNonSensitiveConfirmed:false};
  let draft=null;
  if(method==="approve"){
    // A real existing draft, created by the ordinary entitled owner. The actual
    // Worker permits its owner to publish outside a controlled pilot; no UI
    // independent-review eligibility or managed-pilot approval is claimed.
    const response=await worker.request(base,worker.json(requestBody));assert.equal(response.status,201,await response.clone().text());
    draft=await response.json();assert.equal(draft.status,"draft");await worker.drainBackground();
  }
  const beforeMoney=financial(worker),beforePrivate=tables(worker,privateTables),beforeHistory=await readWorkspaceEvents(worker.env,worker.streamId);
  const originalSync=h.store.syncOrganizationContextPackages;
  t.mock.method(h.store,"syncOrganizationContextPackages",function(...args){
    const call={authorization:this.captureAuthorizationScope(),actor:this.session.get()?.user.userId,args};state.syncCalls.push(call);
    const promise=Reflect.apply(originalSync,this,args);call.promise=promise;return promise;
  });
  h.transport=async request=>{
    state.fetches++;
    try{
      const methodName=(request.init.method??"GET").toUpperCase();
      assert.ok(!request.url.startsWith("/api/document-jobs"),"No job inspection, retry, dispatch or protected job family is invoked");
      if(!["GET","HEAD"].includes(methodName)){
        assert.equal(methodName,"POST");
        assert.ok(request.url===base&&method==="create"||request.url.startsWith(base+"/")&&request.url.endsWith("/publish"),"Only this original package write may be dispatched");
      }
      const response=await worker.request(request.url,request.init);
      const record={request,response,status:response.status,body:null};state.records.push(record);
      const finalPublish=methodName==="POST"&&request.url.startsWith(base+"/")&&request.url.endsWith("/publish");
      const draftCreate=methodName==="POST"&&request.url===base;
      const catalog=methodName==="GET"&&request.url===base;
      if(finalPublish||draftCreate||catalog){
        const originalJson=response.json;
        Object.defineProperty(response,"json",{configurable:true,value:function(...args){
          assert.equal(this,response,"Original native Response receiver is preserved");
          const pending=Reflect.apply(originalJson,this,args);
          return pending.then(async body=>{
            record.body=body;
            if(draftCreate)draft=body;
            if(!state.entered&&(boundary==="body"&&finalPublish||boundary==="catalog"&&catalog)){
              assert.equal(response.status,200,"The held result is a genuine positive response");
              if(finalPublish)assert.equal(body.status,"published");else assert.ok(Array.isArray(body.packages));
              state.entered=record;jsonEntry.resolve(record);await release.promise;
            }
            return body; // Same actual parsed object, with no field or status replacement.
          }).catch(error=>{state.errors.push(error);throw error;});
        }});
      }
      return response; // Same actual Worker Response, not a reconstructed success.
    }catch(error){state.errors.push(error);throw error;}
    finally{state.fetches--;}
  };
  // Reject the Scene helper's inherited synthetic job transport before it can run.
  h.intercept=request=>{assert.ok(!request.url.startsWith("/api/document-jobs"),"This test does not use any job transport");};
  const settle=async()=>{
    let stable=0,previous=-1;
    for(let turn=0;turn<120;turn++){
      await pause();const count=h.requests.length;
      stable=state.fetches===0&&count===previous?stable+1:0;previous=count;
      if(stable===6){await worker.drainBackground();return;}
    }
    assert.fail("Actual read/background requests did not quiesce");
  };
  t.after(async()=>{
    release.resolve();
    try{
      if(state.original)await state.original;
      await settle();assert.deepEqual(financial(worker),beforeMoney,"All nine full fiscal tables remain exactly unchanged");
      assert.equal(h.requests.filter(row=>row.url.startsWith("/api/document-jobs")).length,0);
    }finally{await h.close();}
  });
  const invoke=()=>{
    state.original=method==="create"
      ?h.store.createOrganizationContextPackage(name,"",selected,false,false)
      :h.store.approveOrganizationContextPackage(draft.packageId,draft.versionId,worker.sharing.organizationId);
    state.original.then(value=>{state.settled=true;state.returned=value;},error=>{state.settled=true;state.errors.push(error);});
    return state.original;
  };
  const verifyOriginal=async()=>{
    assert.equal(state.errors.length,0,state.errors[0]?.stack);
    const writes=state.records.filter(row=>(row.request.init.method??"GET")==="POST");
    assert.equal(writes.length,method==="create"?2:1,"One exact original sequence, no retry or replacement package");
    if(method==="create"){
      assert.equal(writes[0].status,201);assert.equal(writes[0].body,draft);
      assert.deepEqual(writes[0].request.body,requestBody);assert.equal(writes[0].request.init.body,JSON.stringify(requestBody));
    }
    assert.ok(draft);assert.match(draft.packageId,uuid);assert.match(draft.versionId,uuid);assert.notEqual(draft.packageId,draft.versionId);
    assert.equal(draft.version,1);assert.equal(draft.blockCount,1);assert.match(draft.contentSha256,/^[a-f0-9]{64}$/u);
    const published=writes.at(-1);
    assert.equal(published.request.url,base+"/"+draft.packageId+"/versions/"+draft.versionId+"/publish");
    assert.equal(published.request.init.body,undefined);assert.equal(published.request.body,null);assert.equal(published.status,200);
    assert.equal(published.body.status,"published");
    for(const key of ["packageId","versionId","version","contentSha256"])assert.equal(published.body[key],draft[key]);
    const packageRow=worker.sqlite.prepare("SELECT * FROM organization_context_packages WHERE package_id=? AND organization_id=?").get(draft.packageId,worker.sharing.organizationId);
    const version=worker.sqlite.prepare("SELECT * FROM organization_context_package_versions WHERE version_id=? AND package_id=?").get(draft.versionId,draft.packageId);
    const content=worker.sqlite.prepare("SELECT * FROM organization_context_package_contents WHERE version_id=?").get(draft.versionId);
    assert.equal(packageRow.name,name);assert.equal(packageRow.created_by_user_id,worker.owner);
    assert.equal(version.status,"published");assert.equal(version.approved_by_user_id,worker.owner);assert.equal(version.created_by_user_id,worker.owner);
    assert.equal(version.source_project_access_id,worker.sharing.projectAccessId);assert.equal(version.source_document_id,worker.documentId);
    assert.equal(version.content_sha256,draft.contentSha256);assert.equal(digest(content.content_json),draft.contentSha256);
    const snapshot=JSON.parse(content.content_json);
    assert.equal(snapshot.organizationId,worker.sharing.organizationId);assert.equal(snapshot.sourceProjectAccessId,worker.sharing.projectAccessId);
    assert.equal(snapshot.sourceDocumentId,worker.documentId);assert.equal(snapshot.sourceHead,original.head);
    assert.deepEqual(snapshot.blocks.map(block=>block.sourceBlockId),selected);assert.equal(snapshot.blocks[0].properties.text,"The keeper checks the harbor.");
    const history=await readWorkspaceEvents(worker.env,worker.streamId);
    assert.deepEqual(history.slice(0,beforeHistory.length),beforeHistory,"Every preceding canonical event retains exact body and order");
    const expected=[...(method==="create"?[["OrganizationContextPackageCreated","context-package",draft.packageId],["OrganizationContextPackageVersionDrafted","context-package-version",draft.versionId]]:[]),
      ["OrganizationContextPackageVersionPublished","context-package-version",draft.versionId]];
    const added=history.slice(beforeHistory.length);assert.equal(added.length,expected.length);
    for(const [index,event]of added.entries()){
      const [type,kind,id]=expected[index];
      assert.deepEqual(Object.keys(event).sort(),["actor","causationId","clientId","compensatesEventId","correlationId","eventId","occurredAt","payload","recordedAt","schemaVersion","sequence","streamId","type"].sort());
      assert.equal(event.type,type);assert.equal(event.streamId,worker.streamId);assert.equal(event.actor,"user:"+worker.owner);assert.equal(event.clientId,"server:workspace");
      assert.equal(event.sequence,(beforeHistory.at(-1)?.sequence??0)+index+1);assert.equal(event.schemaVersion,1);
      assert.equal(event.causationId,null);assert.equal(event.compensatesEventId,null);assert.match(event.eventId,uuid);assert.match(event.correlationId,uuid);
      assert.equal(Number.isFinite(Date.parse(event.occurredAt)),true);assert.equal(event.recordedAt,event.occurredAt);
      assert.deepEqual(event.payload,{organization_id:worker.sharing.organizationId,resource_kind:kind,resource_id:id});
    }
    assert.equal(new Set(history.map(event=>event.eventId)).size,history.length);
    const audit=worker.sqlite.prepare("SELECT actor_user_id,action,resource_id FROM organization_audit_events WHERE resource_id IN (?,?) ORDER BY action").all(draft.packageId,draft.versionId);
    assert.deepEqual(audit.map(row=>row.action),["OrganizationContextPackageCreated","OrganizationContextPackageVersionDrafted","OrganizationContextPackageVersionPublished"]);
    assert.ok(audit.every(row=>row.actor_user_id===worker.owner));
    const afterPrivate=tables(worker,privateTables);
    assert.deepEqual(afterPrivate.event_client_receipts,beforePrivate.event_client_receipts,"Every existing client receipt remains unchanged");
    assert.deepEqual(afterPrivate.private_content,beforePrivate.private_content,"Every original private content row remains unchanged");
    const previousPayloads=beforePrivate.event_private_payloads,currentPayloads=afterPrivate.event_private_payloads;
    assert.deepEqual(currentPayloads.slice(0,previousPayloads.length),previousPayloads,"Every preceding private payload row retains every exact field and byte");
    const auditPayloads=currentPayloads.slice(previousPayloads.length);
    assert.equal(auditPayloads.length,added.length,"Only the independently asserted original audit suffix may add private payload rows");
    assert.deepEqual(auditPayloads.map(row=>row.private_event_id),added.map(event=>event.eventId),"Exactly one private row belongs to each original audit event, in the same order");
    for(const [index,row]of auditPayloads.entries()){
      const event=added[index];
      assert.deepEqual(Object.keys(row).sort(),["private_event_id","owner_id","project_id","document_id","private_json","created_at","redacted_at"].sort());
      assert.equal(row.private_event_id,event.eventId);assert.equal(row.owner_id,worker.owner);
      assert.equal(row.project_id,null);assert.equal(row.document_id,null);
      assert.equal(row.private_json,JSON.stringify(event.payload),"Exact org/resource bytes from the already asserted original event; no arbitrary private-row exception");
      assert.equal(row.created_at,event.recordedAt);assert.equal(row.redacted_at,null);
    }
    assert.deepEqual(financial(worker),beforeMoney,"No reservation, charge, job, provider call or consequential execution changes");
    return {packageId:draft.packageId,versionId:draft.versionId,contentSha256:draft.contentSha256,auditTypes:added.map(event=>event.type),canonical:tables(worker,immutableTables)};
  };
  return{h,worker,state,original,base,release,settle,invoke,verifyOriginal,jsonEntry};
}

for(const method of ["create","approve"])
for(const boundary of ["body","catalog"])
for(const retire of [false,true])test("publisher original completion "+method+" / "+boundary+" / "+(retire?"retired real principal":"healthy same owner"),options,async t=>{
  const f=await fixture(t,method,boundary),{h,worker,state}=f;
  const pending=f.invoke();
  // Observe the actual validated original JSON-entry event, or its original
  // operation's settlement. The existing 45-second test deadline is unchanged.
  await Promise.race([f.jsonEntry.promise,pending]);
  assert.equal(state.errors.length,0,state.errors[0]?.stack);assert.ok(state.entered,"The test must reach its exact held boundary, not a swallowed setup error");
  assert.equal(state.settled,false);assert.ok(h.store.authorizationScopeActive(f.original.authorization));
  const originalReceipt=await f.verifyOriginal();
  if(retire){
    worker.setScopedHeaders(nextActor);
    const session=await h.store.refreshSession();
    assert.equal(session.user.userId,nextActor["oai-authenticated-user-id"]);
    assert.equal(h.store.session.get(),session,"Actual session adoption, no replacement Store atom");
    assert.equal(Boolean(session.projectContext),false);
    assert.equal(h.store.authorizationScopeActive(f.original.authorization),false);
    assert.equal(h.store.sourceOwnershipActive(f.original.source),false);
    await f.settle();
    assert.equal(h.store.events.get().length,0);assert.equal(Object.keys(h.store.content.get()).length,0);
    assert.equal(h.store.organizationContextPackages.get().length,0);
  }
  const current=view(h),syncAtBoundary=state.syncCalls.length;
  f.release.resolve();const returned=await pending;await f.settle();
  const afterReceipt=await f.verifyOriginal();assert.deepEqual(afterReceipt,originalReceipt,"The same original and all canonical/private/receipt rows survive completion unchanged");
  assert.equal(returned,true,"Genuine parsed original publication ACK remains true even if its UI owner retired");
  t.diagnostic(JSON.stringify({method,boundary,retire,returned,packageId:originalReceipt.packageId,versionId:originalReceipt.versionId,
    actualPublishRequests:state.records.filter(row=>row.request.url.endsWith("/publish")).length,
    syncAtBoundary,syncAfter:state.syncCalls.length,originalAuthorityCurrent:h.store.authorizationScopeActive(f.original.authorization),
    toastBefore:current.toast,toastAfter:h.store.ui.toast,canonicalAndNineFiscalTablesUnchanged:true}));
  if(retire){
    assert.deepEqual(view(h),current,"Old acknowledged publisher must not publish feedback, catalog or private state into the new owner");
    assert.equal(state.syncCalls.length,syncAtBoundary,"A retired original completion must not start a new owner's catalog work");
  }else{
    assert.ok(h.store.authorizationScopeActive(f.original.authorization)&&h.store.sourceOwnershipActive(f.original.source));
    assert.equal(state.syncCalls.length,1,"The current original gets its normal one catalog continuation");
    assert.equal(state.syncCalls[0].actor,worker.owner);
    assert.equal(h.store.ui.toast,"Organization context version 1 was published. Following documents must explicitly accept the update.");
    const item=h.store.organizationContextPackages.get().find(row=>row.id===originalReceipt.packageId);
    assert.ok(item);assert.equal(item.versionId,originalReceipt.versionId);assert.equal(item.version,1);assert.equal(item.contentSha256,originalReceipt.contentSha256);
  }
});
