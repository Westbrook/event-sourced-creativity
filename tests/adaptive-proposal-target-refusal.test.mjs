// Permanent target-refusal regression: original target-r2 eight case bodies
// plus additive actual Worker correction, final-proof and winner controls.
// Historical r1 had an incorrect original-read POST count and a real shared
// BlockRestored403; r2 preserves that history and uses deliberate Create there.
// Four desired-continuation cases plus four unchanged healthy/unknown controls.
// Four new cases use the complete Store/public controller factory and actual
// routed RAM Worker. Two existing postcommit-unknown controls below are copied
// byte-exact from the current receipt-truth suite and retain its hybrid fixture.
// No product methods, source tokens, response bodies or acknowledgments are invented.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { accountCachePort, financial } from "./helpers/event-source-retirement-fixture.mjs";
import { withDocumentInRoute } from "../src/model/routes.ts";
import { routed, canonical, view, verifyOriginalCommit, fixture, checkOriginal } from "./helpers/adaptive-proposal-receipt-truth-fixture.mjs";
const {createAdaptiveProposalReview}=await import("../src/components/adaptive-proposal-review.ts");
const API="/api/context/adaptive/apply",PROPOSAL="/suggested_blocks/0",TARGET="adaptive-noop-authored-subject";
const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const previewRows=state=>state.sqlite.prepare("SELECT content_id,content,redacted_at FROM private_content WHERE kind='authoring-preview' ORDER BY content_id").all();
const presented=controller=>({...view(controller),visible:controller.visible,busy:controller.busy,notice:controller.notice,
  executionId:controller.executionId,bindingHash:controller.bindingHash,previewId:controller.preview?.previewId??null,
  originalCount:controller.originals.length,selectionDigest:digest(controller.selections())});

async function noOpFixture(t,mode){
  const denied=t.mock.method(globalThis,"fetch",async()=>assert.fail("No external/provider request is permitted"));
  accountCachePort(t);let seededEventId=null;
  // The independently authored target is added through the real event endpoint
  // BEFORE the reused fixture obtains its one deterministic paid-original seed.
  // This is fixture setup, never an Apply, an invented receipt or a no-op result.
  const state=await routed.main170Phase8Fixture(mode,false,async seed=>{
    const response=await seed.request("/api/events",{method:"POST",headers:{...seed.headers,"content-type":"application/json"},
      body:JSON.stringify({action:"append",event:{type:"BlockCreated",payload:{
        project_id:seed.body.projectId,document_id:seed.body.documentId,scope:"document",block_id:TARGET,
        type:"subject",handle:"subject/noop-authored",position:"zz-noop-authored",
        properties:{label:"Existing authored subject",text:"Already agreed subject wording.",subtype:"Hero subject",weight:.75,authority:"authored"}
      }}})});
    assert.equal(response.status,200);
    const returned=await response.json(),event=returned.appended?.find(row=>row.type==="BlockCreated"&&row.payload?.block_id===TARGET);
    assert.ok(event);assert.equal(typeof event.eventId,"string");seededEventId=event.eventId;
  });
  assert.equal(state.calls.length,1,"one existing deterministic fixture response; not a live provider call");
  globalThis.fetch=denied;
  const paidBefore=routed.phase8PaidEvidence(state),ledgersBefore=routed.main170Phase8Ledgers(state);
  const worker={...state,projectId:state.scope.projectId,documentId:state.scope.documentId,streamId:state.stream,
    events:[],contentRef:"unused-noop-fixture-fallback",content:"",requestId:"unused-scene-port",payload:{workflowSources:[]},close(){},
    request(url,init={}){
      const headers=new Headers(state.headers);new Headers(init.headers).forEach((value,key)=>headers.set(key,value));
      return state.request(url,{...init,headers});
    }};
  let h;const calls=[];
  t.after(async()=>{
    try{
      assert.equal(denied.mock.callCount(),0);routed.phase8AssertNoPayment(state,paidBefore);
      assert.equal(digest(routed.main170Phase8Ledgers(state)),digest(ledgersBefore));
    }finally{await h?.close();await state.cleanup();state.sqlite.close();}
  });
  h=await createSceneStoreHost({workerFixture:worker});
  h.store.route.set(withDocumentInRoute("/studio/adaptive",state.scope.documentId,h.store.projection.get().documentTitle));
  h.transport=async row=>{
    assert.doesNotMatch(row.url,/^\/api\/document-jobs\/[^/]+\/(?:run|dismiss|checkpoint)(?:[/?]|$)/u);
    const response=await worker.request(row.url,row.init);
    if(row.url===API){
      const body=await response.clone().json();
      calls.push({command:structuredClone(row.body),http:response.status,status:body.status??null,error:body.error??null,
        previewId:body.preview?.previewId??null,receiptId:body.status==="applied"?body.previewId:null});
    }
    return response;
  };
  await h.store.syncDocumentJobs();
  await h.store.loadAdaptiveProposalOriginal(state.paidQuote.executionId);
  const source=h.store.adaptiveProposalSource(state.scope.documentId,null,state.paidQuote.executionId);
  assert.equal(source?.readable,true);assert.equal(source.executionId,state.paidQuote.executionId);
  assert.equal(source.bindingHash,state.paidQuote.bindingHash);
  const sourceOwner=h.store.captureSourceOwnership(),authorization=h.store.captureAuthorizationScope();
  assert.equal(h.store.sourceOwnershipActive(sourceOwner),true);assert.equal(h.store.authorizationScopeActive(authorization),true);
  const controller=createAdaptiveProposalReview(h.store,()=>({documentId:state.scope.documentId,canvasId:null}),()=>{},()=>"Explicit free proposal review");
  controller.open(state.paidQuote.executionId,[PROPOSAL]);
  assert.equal(controller.canEdit,true);assert.equal(controller.canPreview,true);
  const target=controller.targets(PROPOSAL).find(row=>row.id===TARGET);
  assert.ok(target,"the actual public eligible-target list contains the independently authored target");
  assert.equal(target.type,"subject");assert.equal(target.scope,"document");assert.equal(target.documentId,state.scope.documentId);
  assert.equal(h.store.events.get().some(row=>row.eventId===seededEventId&&row.type==="BlockCreated"&&row.payload.block_id===TARGET),true);
  controller.update(PROPOSAL,"targetBlockId",target.id);
  for(const key of["label","text","subtype"]){
    assert.equal(typeof target.properties[key],"string");assert.equal(target.properties[key].trim().length>0,true);
    controller.update(PROPOSAL,key,target.properties[key]);
  }
  assert.equal(controller.canPreview,true);assert.equal(controller.handle,null);assert.equal(controller.uncertain,false);
  assert.equal(previewRows(state).length,0,"fixture has never prepared an authoring preview");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
  const before=canonical(state),money=financial(worker);
  const unchanged=()=>{
    assert.equal(digest(canonical(state)),digest(before),"free preparation/Check creates no canonical event or receipt");
    assert.equal(digest(financial(worker)),digest(money));
    assert.equal(h.store.sourceOwnershipActive(sourceOwner),true);
    assert.equal(h.store.authorizationScopeActive(authorization),true);
    assert.equal(calls.filter(row=>row.command.action==="apply").length,0);
  };
  return{state,h,controller,calls,target,sourceOwner,authorization,unchanged};
}


// All target changes below are separate, authorized /api/events requests. The
// controller uses its ordinary current Store refresh and public form methods.
// A missing preview is an observation here, never client permission to retry.
async function targetEvent(f,type){
  const response=await f.state.request("/api/events",{method:"POST",
    headers:{...f.state.headers,"content-type":"application/json"},
    body:JSON.stringify({action:"append",event:{type,payload:{project_id:f.state.scope.projectId,
      document_id:f.state.scope.documentId,block_id:f.target.id,source_surface:"manual"}}})});
  const body=await response.json();
  console.log("P8_TARGET_EVENT_OBSERVATION "+JSON.stringify({mode:f.observedMode,kind:f.observedKind,type,
    http:response.status,error:body.error??null,blockId:f.target.id,projectId:f.state.scope.projectId,
    documentId:f.state.scope.documentId,ownership:ownershipView(f)}));
  assert.equal(response.status,200,JSON.stringify(body));
  const event=body.appended?.find(row=>row.type===type&&row.payload?.block_id===f.target.id);
  assert.ok(event);assert.equal(typeof event.eventId,"string");return event.eventId;
}
function ownershipView(f){
  const c=f.controller,scope=c.ports.scope(),source=f.h.store.captureSourceOwnership();
  const original=f.h.store.adaptiveProposalSource(f.state.scope.documentId,null,c.executionId);
  return{...presented(c),actorUserId:scope?.actorUserId??null,projectId:scope?.projectId??null,documentId:scope?.documentId??null,
    canvasId:scope?.canvasId??null,scopeKeyDigest:digest(scope?.key??null),sourceGeneration:source?.generation??null,
    originalSourceActive:f.h.store.sourceOwnershipActive(f.sourceOwner),authorizationActive:f.h.store.authorizationScopeActive(f.authorization),
    originalReadable:original?.readable??false,withdrawalRevision:original?.withdrawalRevision??null,
    targetEligible:c.targets(PROPOSAL).some(block=>block.id===f.target.id)};
}
for(const mode of["personal","shared"]){
  for(const kind of["removed","locked"])test("desired target-withdrawal continuation "+mode+"/"+kind+(mode==="shared"&&kind==="removed"
    ?": removed target stays removed; current owner can deliberately choose Create after the refused initial Preview"
    :": current original remains correctable after an initial pre-storage refusal"),async t=>{
    const f=await noOpFixture(t,mode),c=f.controller;
    f.observedMode=mode;f.observedKind=kind;
    const createInsteadOfRestore=mode==="shared"&&kind==="removed";
    c.update(PROPOSAL,"text",f.target.properties.text+" A deliberate target edit.");
    const selected=structuredClone(c.selections()),original=ownershipView(f),money=financial(f.state);
    assert.equal(original.originalReadable,true);assert.equal(original.targetEligible,true);assert.equal(c.canPreview,true);
    assert.equal(c.handle,null);assert.equal(c.uncertain,false);assert.equal(previewRows(f.state).length,0);
    const queue=f.h.modules.get("src/sync/canvas-offline-queue.ts")?.canvasOfflineQueue;
    assert.ok(queue,"observe the actual Store's existing queue export, without adding an accessor or queue operation");
    const queueSpies=["enqueueBatch","enqueue","retireSource","reconcileRetired","removeBatch","remove","clearPersonalOwner"]
      .map(name=>t.mock.method(queue,name));
    const knownOriginal=f.h.store.documentJobs.get().find(job=>job.jobId===original.executionId);
    assert.ok(knownOriginal);
    const expectedOriginalRead={projectId:f.state.scope.projectId,documentId:knownOriginal.documentId,canvasId:knownOriginal.canvasId??null,
      sourceSurface:knownOriginal.sourceSurface,projectScope:knownOriginal.planningProjectScope,locale:knownOriginal.planningLocale,
      requestKey:knownOriginal.requestKey,prompt:"",action:"resume",executionId:original.executionId};
    const responses=[],transport=f.h.transport;
    f.h.transport=async row=>{
      const command=row.body?structuredClone(row.body):null,dispatch=ownershipView(f);
      const response=await transport(row);
      let originalReply=null;
      if(row.url==="/api/document-jobs/adaptive"&&row.init.method==="POST"){
        const body=await response.clone().json(),quote=body.quote;
        originalReply={quote:quote?{operation:quote.operation,status:quote.status,executionId:quote.executionId,bindingHash:quote.bindingHash,
          projectId:quote.projectId,documentId:quote.documentId,canvasId:quote.canvasId??null}:null,error:body.error??null};
      }
      responses.push({url:row.url,method:row.init.method??"GET",command,status:response.status,originalReply,dispatch});
      return response;
    };
    console.log("P8_TARGET_PHASE_OBSERVATION "+JSON.stringify({mode,kind,phase:"before-target-change",state:original}));
    const withdrawnEvent=await targetEvent(f,kind==="removed"?"BlockRemoved":"BlockLocked");
    await f.h.store.refreshEvents();
    // Re-read the SAME paid original through the public exact source bridge.
    // No private denial, new paid execution or inferred source token is used.
    await f.h.store.loadAdaptiveProposalOriginal(original.executionId);c.synchronize();
    const withdrawn=ownershipView(f);
    console.log("P8_TARGET_PHASE_OBSERVATION "+JSON.stringify({mode,kind,phase:"current-source-after-target-change",state:withdrawn}));
    assert.equal(withdrawn.targetEligible,false);assert.equal(withdrawn.originalReadable,true);
    assert.equal(withdrawn.originalSourceActive,true);assert.equal(withdrawn.authorizationActive,true);
    assert.equal(withdrawn.sourceGeneration,original.sourceGeneration);
    assert.equal(withdrawn.withdrawalRevision,original.withdrawalRevision);
    assert.equal(withdrawn.scopeKeyDigest,original.scopeKeyDigest);
    assert.equal(withdrawn.executionId,original.executionId);assert.equal(withdrawn.bindingHash,original.bindingHash);
    assert.deepEqual(c.selections(),selected);assert.equal(c.canPreview,true,"retained ordinary form still offers Preview");
    const beforePreview=canonical(f.state);
    await c.request("preview");const refused=f.calls.at(-1),afterRefusal=ownershipView(f);
    console.log("P8_TARGET_PHASE_OBSERVATION "+JSON.stringify({mode,kind,phase:"after-real-preview-before-refusal-assertions",
      reply:{http:refused.http,error:refused.error,status:refused.status},state:afterRefusal}));
    assert.equal(refused.command.action,"preview");assert.equal(refused.http,409);
    assert.equal(refused.error,kind==="removed"?"adaptive_changes_target_unavailable":"adaptive_changes_target_protected",
      "reach the actual model target refusal, not an injected protocol envelope");
    assert.deepEqual(refused.command.selections,selected);assert.equal(refused.previewId,null);
    assert.equal(previewRows(f.state).length,0);assert.deepEqual(canonical(f.state),beforePreview);
    // The immutable r1 shared/removed BlockRestored request really returned403.
    // Do not bypass it: this separately named r2 branch keeps that target removed.
    const restoredEvent=createInsteadOfRestore?null:await targetEvent(f,kind==="removed"?"BlockRestored":"BlockUnlocked");
    await f.h.store.refreshEvents();await f.h.store.loadAdaptiveProposalOriginal(original.executionId);c.synchronize();
    const restored=ownershipView(f);
    console.log("P8_TARGET_PHASE_OBSERVATION "+JSON.stringify({mode,kind,phase:createInsteadOfRestore?"removed-target-still-removed-current-read":"restored-target-current-read",state:restored}));
    assert.equal(restored.targetEligible,!createInsteadOfRestore);assert.equal(restored.originalReadable,true);
    assert.equal(restored.originalSourceActive,true);assert.equal(restored.authorizationActive,true);
    assert.equal(restored.scopeKeyDigest,original.scopeKeyDigest);assert.equal(restored.sourceGeneration,original.sourceGeneration);
    assert.equal(restored.withdrawalRevision,original.withdrawalRevision);
    const afterExternalEvents=canonical(f.state),checks=[];
    for(let index=0;index<2;index++){
      await c.resume();const read=f.calls.at(-1);assert.equal(read.command.action,"resume");
      assert.equal(read.http,200);assert.equal(read.status,"none");checks.push(ownershipView(f));
      assert.deepEqual(canonical(f.state),afterExternalEvents);
    }
    c.close();assert.equal(c.visible,false);c.open(original.executionId,[PROPOSAL]);
    const reopened=ownershipView(f),correction=f.target.properties.text+" Human correction after current source returned.";
    if(createInsteadOfRestore)c.update(PROPOSAL,"targetBlockId","");
    c.update(PROPOSAL,"text",correction);const correctionAccepted=c.selections()[0].edit?.text===correction;
    const targetCorrectionAccepted=!createInsteadOfRestore||!c.selections()[0].targetBlockId;
    if(correctionAccepted&&c.canPreview)await c.request("preview");
    const corrected=ownershipView(f),queueCalls=queueSpies.reduce((n,spy)=>n+spy.mock.callCount(),0);
    const originalReadPosts=responses.filter(row=>row.url.startsWith("/api/document-jobs")&&row.method==="POST");
    // Emit before the old prerequisite assertions, so a prerequisite failure
    // remains distinguishable from the desired liveness assertions below.
    console.log("P8_TARGET_WITHDRAWAL_OBSERVATION "+JSON.stringify({mode,kind,original,withdrawn,afterRefusal,restored,checks,reopened,corrected,
      scenario:createInsteadOfRestore?"target-stays-removed-deliberate-Create":"authorized-restore-or-unlock",
      reply:{http:refused.http,error:refused.error,status:refused.status},correctionAccepted,targetCorrectionAccepted,externalEvents:[withdrawnEvent,restoredEvent],
      commands:f.calls.map(row=>row.command.action),queueMutationCalls:queueCalls,
      queueMethodCounts:queueSpies.map((spy,index)=>({method:["enqueueBatch","enqueue","retireSource","reconcileRetired","removeBatch","remove","clearPersonalOwner"][index],calls:spy.mock.callCount()})),
      authoringReceipts:afterExternalEvents.authoring_commits.length,privatePreviewRows:previewRows(f.state).length,newProviderResponses:f.state.calls.length-1,
      currentReadResponses:responses.filter(row=>row.url!==API),
      qualification:"complete Store/public controller and actual RAM Worker; two explicit exact-original resume reads are not new jobs; shared removed target is NOT restored; missing rows do not certify global non-use"}));
    assert.equal(c.executionId,original.executionId);assert.equal(c.bindingHash,original.bindingHash);
    assert.deepEqual(canonical(f.state),afterExternalEvents);assert.deepEqual(financial(f.state),money);
    assert.equal(f.calls.filter(row=>row.command.action==="apply").length,0);assert.equal(queueCalls,0);
    assert.equal(responses.some(row=>[401,403,404,410].includes(row.status)),false,"no source/authority/private-denial sequence");
    // Correct only r1's false equation of all document-jobs POSTs with writes.
    // Both calls are explicitly requested above; extra endpoints/actions/IDs fail.
    assert.equal(originalReadPosts.length,2,"exactly the two deliberately requested original reads, no new job command");
    for(const read of originalReadPosts){
      assert.equal(read.url,"/api/document-jobs/adaptive");assert.deepEqual(read.command,expectedOriginalRead);
      assert.equal(read.status,200);assert.equal(read.dispatch.originalSourceActive,true);
      assert.equal(read.dispatch.authorizationActive,true);assert.equal(read.dispatch.sourceGeneration,original.sourceGeneration);
      assert.equal(read.dispatch.scopeKeyDigest,original.scopeKeyDigest);
      assert.equal(read.dispatch.projectId,original.projectId);assert.equal(read.dispatch.documentId,original.documentId);
      assert.equal(read.originalReply.error,null);
      assert.deepEqual(read.originalReply.quote,{operation:"adaptive-structure",status:"completed",executionId:original.executionId,
        bindingHash:original.bindingHash,projectId:original.projectId,documentId:original.documentId,canvasId:null});
    }
    assert.equal(reopened.canEdit,true,"desired continuation: this current same-owner original should allow a deliberate correction after its specifically refused initial Preview");
    assert.equal(correctionAccepted,true);assert.equal(targetCorrectionAccepted,true);assert.equal(corrected.phase,"review");assert.equal(c.canApply,true);
    assert.equal(c.preview.adaptiveReview.executionId,original.executionId);assert.equal(c.preview.adaptiveReview.bindingHash,original.bindingHash);
    assert.equal(c.preview.adaptiveReview.selections[0].targetBlockId,createInsteadOfRestore?undefined:f.target.id);
    if(createInsteadOfRestore){
      assert.equal(f.h.store.projection.get().libraryBlocks.some(block=>block.id===f.target.id),false,"the active projection intentionally omits removed blocks");
      const lifecycle=canonical(f.state).events.filter(row=>["BlockRemoved","BlockRestored"].includes(row.type)&&JSON.parse(row.payload).block_id===f.target.id);
      assert.deepEqual(lifecycle.map(row=>[row.event_id,row.type]),[[withdrawnEvent,"BlockRemoved"]],"the actual original removal remains canonical with no restoration");
      assert.equal(c.preview.events[0].type,"BlockCreated","Create is only a separate free plan; no Apply or restoration is made");
    }
  });

  test("healthy changed-value free preparation "+mode+": exact eligible target yields a real review without Apply",async t=>{
    const f=await noOpFixture(t,mode),c=f.controller,changed=f.target.properties.text+" A deliberate new refinement.";
    c.update(PROPOSAL,"text",changed);assert.equal(c.canPreview,true);
    await c.request("preview");const returned=f.calls.at(-1);f.unchanged();
    assert.equal(returned.command.action,"preview");assert.equal(returned.http,200);assert.equal(returned.status,"review");
    assert.equal(c.phase,"review",c.notice);assert.equal(c.uncertain,false);assert.equal(c.canApply,true);
    assert.equal(c.preview?.adaptiveReview.executionId,f.state.paidQuote.executionId);
    assert.equal(c.preview?.adaptiveReview.bindingHash,f.state.paidQuote.bindingHash);
    assert.equal(c.preview?.adaptiveReview.selections[0].targetBlockId,f.target.id);
    assert.equal(c.preview.events.length,1);assert.equal(c.preview.events[0].type,"BlockPropertyEdited");
    assert.equal(c.preview.events[0].payload.block_id,f.target.id);assert.equal(c.preview.events[0].payload.property_path,"text");
    assert.equal(c.preview.events[0].payload.old_value,f.target.properties.text);assert.equal(c.preview.events[0].payload.new_value,changed);
    const rows=previewRows(f.state);assert.equal(rows.length,1);assert.equal(rows[0].content_id,c.preview.previewId);
    assert.equal(JSON.parse(rows[0].content).approvalHash,c.handle.approvalHash);
    console.log("P8_NOOP_OBSERVATION "+JSON.stringify({case:"changed-value-healthy",mode,state:presented(c),
      privatePreviewRows:rows.length,commands:f.calls.map(row=>row.command.action),canonicalWrites:0,applyRequests:0,
      newProviderResponses:f.state.calls.length-1}));
  });
}

for(const mode of["personal","shared"]){
  test("desired safety " + mode + ": postcommit receipt-read failure cannot certify not-applied or clear uncertainty", async t => {
    const f = await fixture(t, mode); f.boundary.arm(f.preview);
    await f.controller.request("apply");
    const failed = f.calls.at(-1), presented = view(f.controller), committed = canonical(f.state);
    assert.equal(f.boundary.evidence.failures, 1); const original = verifyOriginalCommit(f.state, f.preview);
    assert.equal(failed.command.action, "apply"); assert.equal(failed.command.previewId, original.previewId);
    assert.deepEqual(presented.handle, { previewId: original.previewId, approvalHash: original.approvalHash });
    assert.equal(f.controller.receipt, null, "do not invent a client receipt from SQL observation");
    await checkOriginal(f); assert.deepEqual(canonical(f.state), committed);
    assert.deepEqual(f.calls.map(call => call.command.action), ["preview", "apply", "retrieve"], "no automatic retry, new preview or second Apply");
    console.log("P8_RECEIPT_OBSERVATION " + JSON.stringify({ case: "postcommit-throw", mode, failed, presented, original,
      recoveredOriginal: true, duplicateEvents: 0, duplicateReceipts: 0, read: f.boundary.evidence }));
    assert.notEqual(failed.status, "not-applied", "a verified original commit cannot become not-applied because its read failed");
    assert.equal(presented.uncertain, true, "the actual controller must retain uncertainty until the original receipt is read");
    assert.equal(presented.canEdit, false); assert.equal(presented.canPreview, false);
  });
}

// Additional actual Worker controls. Intentional concurrency/retention changes
// are RAM fixture actions, never fake server acknowledgments or live data.
const selectionReadSQL="SELECT preview_id,approval_hash,result_json FROM authoring_commits\n    WHERE(actor_user_id,operation,project_id,document_id,COALESCE(canvas_id,''),block_id,verified,";
function atRead(t,state,predicate,phase,callback){
  const prepare=state.env.DB.prepare,evidence={entered:0,rows:0};
  state.env.DB.prepare=function(sql){
    const statement=prepare.call(this,sql);if(!predicate(sql))return statement;
    const bind=statement.bind;statement.bind=(...values)=>{
      const bound=bind.call(statement,...values),first=bound.first;
      bound.first=async(...args)=>{
        const selected=evidence.entered===0;if(selected)evidence.entered++;
        if(selected&&phase==="before")await callback(null,values);
        const row=await first.apply(bound,args);if(row)evidence.rows++;
        if(selected&&phase==="after")await callback(row,values);
        return row;
      };return bound;
    };return statement;
  };
  t.after(()=>{state.env.DB.prepare=prepare;});return evidence;
}
async function withdrawTarget(f,mode,kind){
  f.observedMode=mode;f.observedKind=kind;
  await targetEvent(f,kind==="removed"?"BlockRemoved":"BlockLocked");
  await f.h.store.refreshEvents();await f.h.store.loadAdaptiveProposalOriginal(f.controller.executionId);f.controller.synchronize();
  assert.equal(f.controller.targets(PROPOSAL).some(block=>block.id===f.target.id),false);
  assert.equal(f.h.store.adaptiveProposalSource(f.state.scope.documentId,null,f.controller.executionId)?.readable,true);
  assert.equal(f.h.store.sourceOwnershipActive(f.sourceOwner),true);
  assert.equal(f.h.store.authorizationScopeActive(f.authorization),true);
}
for(const mode of["personal","shared"]){
  for(const kind of["removed","locked"])test("target refusal "+mode+"/"+kind+": deliberate Create correction previews then separately applies one exact original receipt",async t=>{
    const f=await noOpFixture(t,mode),c=f.controller,original={executionId:c.executionId,bindingHash:c.bindingHash};
    c.update(PROPOSAL,"text",f.target.properties.text+" Retained human edit.");const selected=structuredClone(c.selections());
    await withdrawTarget(f,mode,kind);const before=canonical(f.state),money=financial(f.state);
    await c.request("preview");assert.equal(f.calls.at(-1).http,409);assert.equal(f.calls.at(-1).status,"preview-not-created");
    assert.equal(f.calls.at(-1).error,kind==="removed"?"adaptive_changes_target_unavailable":"adaptive_changes_target_protected");
    assert.equal(c.notice,"adaptive.changes.targetRefused");assert.equal(c.canEdit,true);assert.equal(c.canApply,false);
    assert.equal(c.handle,null);assert.equal(c.preview,null);assert.deepEqual(c.selections(),selected);
    assert.deepEqual(canonical(f.state),before);assert.equal(previewRows(f.state).length,0);
    c.update(PROPOSAL,"targetBlockId","");const correction="  New decision from the same paid original.\nHuman target correction.  ";
    c.update(PROPOSAL,"text",correction);assert.equal(c.selections()[0].targetBlockId,undefined);
    assert.equal(c.selections()[0].edit.text,correction);assert.equal(c.executionId,original.executionId);assert.equal(c.bindingHash,original.bindingHash);
    await c.request("preview");assert.equal(c.phase,"review",c.notice);assert.equal(c.canApply,true);const preview=structuredClone(c.preview);
    assert.equal(preview.adaptiveReview.executionId,original.executionId);assert.equal(preview.adaptiveReview.bindingHash,original.bindingHash);
    assert.equal(preview.adaptiveReview.selections[0].targetBlockId,undefined);
    assert.equal(preview.events.length,1);assert.equal(preview.events[0].type,"BlockCreated");
    assert.equal(preview.events[0].payload.properties.text,correction);
    assert.deepEqual(canonical(f.state),before);assert.deepEqual(financial(f.state),money);
    assert.deepEqual(f.calls.map(row=>row.command.action),["preview","preview"],"neither refusal nor correction automatically applies");
    await c.request("apply");assert.equal(c.phase,"applied",c.notice);const committed=verifyOriginalCommit(f.state,preview);
    assert.equal(c.receipt.previewId,committed.previewId);assert.equal(c.receipt.approvalHash,committed.approvalHash);
    assert.equal(canonical(f.state).authoring_commits.length,before.authoring_commits.length+1);
    assert.equal(canonical(f.state).events.length,before.events.length+preview.events.length);
    const target=f.h.store.projection.get().libraryBlocks.find(block=>block.id===f.target.id);
    if(kind==="removed"){
      assert.equal(target,undefined,"the active projection intentionally omits the still-removed original target");
      const lifecycle=rows=>rows.filter(row=>["BlockRemoved","BlockRestored"].includes(row.type)&&JSON.parse(row.payload).block_id===f.target.id);
      const originalRemoval=lifecycle(before.events);assert.equal(originalRemoval.at(-1)?.type,"BlockRemoved");
      assert.deepEqual(lifecycle(canonical(f.state).events),originalRemoval,"the original canonical removal is unchanged after separate Create/Apply");
    }else assert.equal(target?.locked,true,"the original locked target is not silently unlocked/edited");
    const after=canonical(f.state);await c.request("retrieve");assert.equal(c.phase,"applied");assert.deepEqual(canonical(f.state),after);
    assert.deepEqual(verifyOriginalCommit(f.state,preview),committed);assert.deepEqual(financial(f.state),money);
    assert.deepEqual(f.calls.map(row=>row.command.action),["preview","preview","apply","retrieve"]);
    console.log("P8_TARGET_CONTROL "+JSON.stringify({case:"corrected-explicit-apply",mode,kind,previewId:committed.previewId,
      eventIds:committed.eventIds,receiptCount:1,explicitApplyRequests:1,newProviderResponses:f.state.calls.length-1}));
  });

  test("target refusal "+mode+": older different-selection private review stays byte-exact",async t=>{
    const f=await noOpFixture(t,mode),c=f.controller;
    c.update(PROPOSAL,"text",f.target.properties.text+" Older saved edit.");await c.request("preview");
    assert.equal(c.phase,"review",c.notice);const older=previewRows(f.state);assert.equal(older.length,1);
    c.update(PROPOSAL,"text",f.target.properties.text+" A different human draft.");const selected=structuredClone(c.selections());
    await withdrawTarget(f,mode,"locked");const before=canonical(f.state);await c.request("preview");
    assert.equal(f.calls.at(-1).error,"adaptive_changes_target_protected");assert.equal(f.calls.at(-1).status,"preview-not-created");
    assert.equal(c.canEdit,true);assert.equal(c.handle,null);assert.equal(c.canApply,false);assert.deepEqual(c.selections(),selected);
    assert.deepEqual(previewRows(f.state),older);assert.deepEqual(canonical(f.state),before);
    console.log("P8_TARGET_CONTROL "+JSON.stringify({case:"older-review-retained",mode,privatePreviewRows:1,authoringReceipts:0}));
  });

  test("target refusal "+mode+": a real canonical winner after the first null read wins over a newly protected target",async t=>{
    const f=await noOpFixture(t,mode),c=f.controller;
    c.update(PROPOSAL,"text",f.target.properties.text+" The original winning edit.");await c.request("preview");
    assert.equal(c.phase,"review",c.notice);const preview=structuredClone(c.preview);let applied=null;
    f.observedMode=mode;f.observedKind="locked-after-original-commit";
    const read=atRead(t,f.state,sql=>sql.startsWith(selectionReadSQL),"after",async(row,values)=>{
      assert.equal(row,null,"observe the actual initial null selection read");assert.equal(values[6],preview.adaptiveReview.selectionKey);
      const response=await routed.phase8Request(f.state,{action:"apply",previewId:preview.previewId,approvalHash:preview.approvalHash});
      applied=await response.json();assert.equal(response.status,200,JSON.stringify(applied));assert.equal(applied.status,"applied");
      verifyOriginalCommit(f.state,preview);await targetEvent(f,"BlockLocked");
    });
    await c.request("preview");assert.equal(read.entered,1);assert.ok(applied);
    const committed=verifyOriginalCommit(f.state,preview);assert.equal(f.calls.at(-1).status,"applied");
    assert.equal(c.phase,"applied",c.notice);assert.equal(c.receipt.previewId,committed.previewId);assert.equal(c.receipt.approvalHash,committed.approvalHash);
    assert.equal(c.uncertain,false);assert.equal(c.canPreview,false);assert.equal(c.canApply,false);
    assert.equal(previewRows(f.state).length,1);assert.equal(canonical(f.state).authoring_commits.length,1);
    assert.equal(f.h.store.projection.get().libraryBlocks.find(block=>block.id===f.target.id)?.locked,true);
    console.log("P8_TARGET_CONTROL "+JSON.stringify({case:"canonical-winner-before-target-refusal",mode,previewId:committed.previewId,
      receiptCount:1,eventIds:committed.eventIds,noNewPreview:true}));
  });

  for(const change of["source-head","authority","paid-retention"])test("target refusal final snapshot "+mode+": "+change+" change cannot certify continuation",async t=>{
    const f=await noOpFixture(t,mode),c=f.controller;c.update(PROPOSAL,"text",f.target.properties.text+" Retained draft.");
    await withdrawTarget(f,mode,"locked");const before=canonical(f.state);let restore=()=>{},introduced=null;
    const read=atRead(t,f.state,sql=>sql.startsWith("SELECT 1 AS adaptive_authoring_no_changes_current WHERE "),"before",async()=>{
      if(change==="source-head")introduced=await targetEvent(f,"BlockUnlocked");
      else if(change==="authority"){
        const user=f.state.sqlite.prepare("SELECT role,updated_at FROM users WHERE user_id=?").get(f.state.owner);assert.ok(user);
        f.state.sqlite.prepare("UPDATE users SET role='viewer',updated_at=? WHERE user_id=?").run(new Date(Date.now()+1000).toISOString(),f.state.owner);
        restore=()=>f.state.sqlite.prepare("UPDATE users SET role=?,updated_at=? WHERE user_id=?").run(user.role,user.updated_at,f.state.owner);
      }else{
        const row=f.state.sqlite.prepare("SELECT content_id,expires_at FROM private_content WHERE content_id=(SELECT result_ref FROM consequential_executions WHERE execution_id=?)").get(f.state.paidQuote.executionId);assert.ok(row);
        f.state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(row.content_id);
        restore=()=>f.state.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(row.expires_at,row.content_id);
      }
    });
    try{
      await c.request("preview");assert.equal(read.entered,1);assert.equal(f.calls.at(-1).status,"unavailable");
      assert.notEqual(c.notice,"adaptive.changes.targetRefused");assert.equal(c.uncertain,true);assert.equal(c.canEdit,false);
      assert.equal(c.canPreview,false);assert.equal(c.canApply,false);assert.equal(c.handle,null);assert.equal(previewRows(f.state).length,0);
      assert.deepEqual(canonical(f.state).authoring_commits,before.authoring_commits);
      if(change==="source-head"){const events=canonical(f.state).events;assert.equal(events.length,before.events.length+1);assert.equal(events.at(-1).event_id,introduced);}
      else assert.deepEqual(canonical(f.state),before);
      console.log("P8_TARGET_CONTROL "+JSON.stringify({case:"final-current-snapshot",mode,change,status:f.calls.at(-1).status,
        privatePreviewRows:0,authoringReceipts:0,intentionalConcurrentEvent:introduced}));
    }finally{restore();}
  });
}
