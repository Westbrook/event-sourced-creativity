// No-op preparation regression: six original case expressions remain unchanged.
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

for(const mode of["personal","shared"]){
  test("desired no-op preparation liveness "+mode+": exact equal target can be corrected after current Checks and Close/reopen",async t=>{
    const f=await noOpFixture(t,mode),c=f.controller;
    const selected=structuredClone(c.selections()),original={executionId:c.executionId,bindingHash:c.bindingHash};
    assert.equal(selected.length,1);assert.equal(selected[0].targetBlockId,f.target.id);
    for(const key of["label","text","subtype"])assert.equal(selected[0].edit[key],f.target.properties[key]);
    await c.request("preview");
    const refused=f.calls.at(-1),afterPreview=presented(c);
    assert.equal(refused.command.action,"preview");assert.equal(refused.http,409);
    assert.equal(refused.error,"adaptive_changes_no_changes","actual model refusal, not an injected error");
    assert.equal(refused.previewId,null);assert.deepEqual(refused.command.selections,selected);
    assert.equal(previewRows(f.state).length,0);f.unchanged();
    const checks=[];
    for(let index=0;index<2;index++){
      await c.resume();const returned=f.calls.at(-1);
      assert.equal(returned.command.action,"resume");assert.equal(returned.http,200);assert.equal(returned.status,"none");
      assert.deepEqual(Object.keys(returned.command).sort(),["action","canvasId","documentId","projectId"]);
      checks.push(presented(c));f.unchanged();
    }
    c.close();assert.equal(c.visible,false);c.open(original.executionId,[PROPOSAL]);
    const reopened=presented(c);assert.equal(c.visible,true);
    assert.equal(c.executionId,original.executionId);assert.equal(c.bindingHash,original.bindingHash);
    assert.equal(previewRows(f.state).length,0);assert.deepEqual(c.selections(),selected);
    // Invoke only the same public input callback used by the current form.
    // Whether its editability guard accepts it is the observation under test.
    const correction=f.target.properties.text+" A deliberate new refinement.";
    c.update(PROPOSAL,"text",correction);
    const correctionAccepted=c.selections()[0].edit?.text===correction;
    if(correctionAccepted&&c.canPreview)await c.request("preview");
    const corrected=presented(c);f.unchanged();
    console.log("P8_NOOP_OBSERVATION "+JSON.stringify({case:"no-op-continuation",mode,original,
      reply:{http:refused.http,error:refused.error,status:refused.status},afterPreview,checks,reopened,
      correctionAccepted,corrected,commands:f.calls.map(row=>row.command.action),
      authoringPrivateRows:previewRows(f.state).length,canonicalWrites:0,applyRequests:0,newProviderResponses:f.state.calls.length-1,
      qualification:"no prior preview in this isolated fixture; missing rows are observation, never a global unused-operation certificate"}));
    assert.equal(reopened.canEdit,true,"desired liveness: exact known no-change preparation must not strand current human editing");
    assert.equal(correctionAccepted,true);assert.equal(corrected.phase,"review");
    assert.equal(c.preview?.adaptiveReview.executionId,original.executionId);
    assert.equal(c.preview?.adaptiveReview.bindingHash,original.bindingHash);
    assert.equal(c.preview?.adaptiveReview.selections[0].targetBlockId,f.target.id);
    assert.equal(c.preview?.events.some(row=>row.type==="BlockPropertyEdited"&&row.payload.block_id===f.target.id&&row.payload.new_value===correction),true);
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

// Exact current committed-unknown safety registration, expanded for both modes.
// Existing actual Worker/read-fault and hybrid controller fixture are unchanged;
// these are not counted as new complete-Store or mounted-host evidence.
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


// Additional controls use real routed preparation; response-corruption cases
// are deliberately synthetic client protocol negatives, not Worker behavior.
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
function replaceReply(t,f,action,transform){
  const transport=f.h.transport,evidence={entered:0};
  f.h.transport=async row=>{
    const response=await transport(row);
    if(row.url!==API||row.body?.action!==action)return response;
    evidence.entered++;const body=await response.clone().json();
    return transform(response,body,row.body);
  };
  t.after(()=>{f.h.transport=transport;});return evidence;
}
const typedNoChange=selectionKey=>({error:"adaptive_changes_no_changes",status:"preview-not-created",selectionKey,noPayment:true,noAutomaticRetry:true});

for(const mode of["personal","shared"]){
  test("no-op boundary "+mode+": current same-selection review is reused, not replaced",async t=>{
    const f=await noOpFixture(t,mode),c=f.controller;
    c.update(PROPOSAL,"text",f.target.properties.text+" One current edit.");await c.request("preview");
    assert.equal(c.phase,"review",c.notice);const preview=structuredClone(c.preview),before=previewRows(f.state);
    await c.request("preview");
    assert.equal(c.phase,"review",c.notice);assert.equal(c.preview.previewId,preview.previewId);
    assert.equal(c.preview.approvalHash,preview.approvalHash);assert.deepEqual(previewRows(f.state),before);
    assert.equal(c.canApply,true);f.unchanged();
  });

  test("no-op boundary "+mode+": older different-selection review stays byte-exact while the human draft can change",async t=>{
    const f=await noOpFixture(t,mode),c=f.controller,selected=structuredClone(c.selections());
    c.update(PROPOSAL,"text",f.target.properties.text+" Older different edit.");await c.request("preview");
    assert.equal(c.phase,"review",c.notice);const older=previewRows(f.state);assert.equal(older.length,1);
    c.update(PROPOSAL,"text",f.target.properties.text);await c.request("preview");
    assert.equal(f.calls.at(-1).status,"preview-not-created");assert.equal(c.notice,"adaptive.changes.noChanges");
    assert.equal(c.uncertain,false);assert.equal(c.canEdit,true);assert.equal(c.canApply,false);assert.equal(c.handle,null);
    assert.deepEqual(c.selections(),selected);assert.deepEqual(previewRows(f.state),older);
    c.update(PROPOSAL,"text",f.target.properties.text+" A separate corrected draft.");await c.request("preview");
    assert.equal(c.phase,"review",c.notice);assert.notEqual(c.preview.previewId,older[0].content_id);
    assert.deepEqual(previewRows(f.state).find(row=>row.content_id===older[0].content_id),older[0]);
    f.unchanged();
  });

  test("no-op boundary "+mode+": a human correction previews freely then applies only after a separate explicit action",async t=>{
    const f=await noOpFixture(t,mode),c=f.controller;
    const original={executionId:c.executionId,bindingHash:c.bindingHash};
    await c.request("preview");assert.equal(f.calls.at(-1).status,"preview-not-created");
    assert.equal(c.canEdit,true);assert.equal(c.canApply,false);assert.equal(c.handle,null);
    c.update(PROPOSAL,"text",f.target.properties.text+" Deliberately corrected and separately approved.");
    await c.request("preview");assert.equal(c.phase,"review",c.notice);assert.equal(c.canApply,true);
    const preview=structuredClone(c.preview);f.unchanged();
    assert.equal(preview.adaptiveReview.executionId,original.executionId);
    assert.equal(preview.adaptiveReview.bindingHash,original.bindingHash);
    assert.equal(preview.adaptiveReview.selections[0].targetBlockId,f.target.id);
    assert.deepEqual(f.calls.map(row=>row.command.action),["preview","preview"]);
    await c.request("apply");const committed=verifyOriginalCommit(f.state,preview);
    assert.equal(c.phase,"applied",c.notice);assert.equal(c.uncertain,false);
    assert.equal(c.receipt.previewId,committed.previewId);assert.equal(c.receipt.approvalHash,committed.approvalHash);
    assert.equal(c.canPreview,false);assert.equal(c.canApply,false);
    const beforeRead=canonical(f.state);await c.request("retrieve");
    assert.equal(c.phase,"applied");assert.deepEqual(canonical(f.state),beforeRead);
    assert.deepEqual(verifyOriginalCommit(f.state,preview),committed);
    assert.deepEqual(f.calls.map(row=>row.command.action),["preview","preview","apply","retrieve"]);
    console.log("P8_NOOP_CONTROL "+JSON.stringify({case:"corrected-explicit-apply",mode,previewId:committed.previewId,
      receiptCount:1,eventIds:committed.eventIds,explicitApplyRequests:1,newProviderResponses:f.state.calls.length-1}));
  });

  test("no-op boundary "+mode+": real canonical winner after the first null selection read is returned unchanged",async t=>{
    const f=await noOpFixture(t,mode),c=f.controller;
    c.update(PROPOSAL,"text",f.target.properties.text+" The exact winning edit.");await c.request("preview");
    assert.equal(c.phase,"review",c.notice);const preview=structuredClone(c.preview);let applied=null;
    const read=atRead(t,f.state,sql=>sql.startsWith(selectionReadSQL),"after",async(row,values)=>{
      assert.equal(row,null,"hold an actual null read, never fabricate absence");
      assert.equal(values[6],preview.adaptiveReview.selectionKey);
      const response=await routed.phase8Request(f.state,{action:"apply",previewId:preview.previewId,approvalHash:preview.approvalHash});
      applied=await response.json();assert.equal(response.status,200,JSON.stringify(applied));
      assert.equal(applied.status,"applied");assert.equal(applied.previewId,preview.previewId);
      verifyOriginalCommit(f.state,preview);
    });
    // The pre-existing current review can commit while this new Preview's
    // initial null read is held. Its subsequent source build sees that edit.
    await c.request("preview");assert.equal(read.entered,1);assert.ok(applied);
    const committed=verifyOriginalCommit(f.state,preview);
    assert.equal(f.calls.at(-1).status,"applied");assert.equal(c.phase,"applied",c.notice);
    assert.equal(c.receipt.previewId,committed.previewId);assert.equal(c.receipt.approvalHash,committed.approvalHash);
    assert.equal(c.uncertain,false);assert.equal(c.canPreview,false);
    assert.equal(previewRows(f.state).length,1);
    console.log("P8_NOOP_CONTROL "+JSON.stringify({case:"winner-after-real-null",mode,previewId:committed.previewId,
      receiptCount:1,eventIds:committed.eventIds,noNewPreview:true}));
  });

  for(const change of["source-head","authority","paid-retention"]){
    test("no-op final snapshot "+mode+": "+change+" change prevents a stale continuation",async t=>{
      const f=await noOpFixture(t,mode),c=f.controller;let restore=()=>{},introduced=null;
      const original=canonical(f.state);
      const read=atRead(t,f.state,sql=>sql.startsWith("SELECT 1 AS adaptive_authoring_no_changes_current WHERE "),"before",async()=>{
        if(change==="source-head"){
          const response=await f.state.request("/api/events",{method:"POST",headers:{...f.state.headers,"content-type":"application/json"},
            body:JSON.stringify({action:"append",event:{type:"BlockPropertyEdited",payload:{
              project_id:f.state.scope.projectId,document_id:f.state.scope.documentId,block_id:f.target.id,
              property_path:"text",old_value:f.target.properties.text,new_value:f.target.properties.text+" Concurrent authored change."
            }}})});
          const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
          introduced=body.appended?.find(row=>row.type==="BlockPropertyEdited"&&row.payload?.block_id===f.target.id)?.eventId;
          assert.equal(typeof introduced,"string");
        }else if(change==="authority"){
          const user=f.state.sqlite.prepare("SELECT role,updated_at FROM users WHERE user_id=?").get(f.state.owner);
          assert.ok(user);f.state.sqlite.prepare("UPDATE users SET role='viewer',updated_at=? WHERE user_id=?").run(new Date(Date.now()+1000).toISOString(),f.state.owner);
          restore=()=>f.state.sqlite.prepare("UPDATE users SET role=?,updated_at=? WHERE user_id=?").run(user.role,user.updated_at,f.state.owner);
        }else{
          const row=f.state.sqlite.prepare("SELECT content_id,expires_at FROM private_content WHERE content_id=(SELECT result_ref FROM consequential_executions WHERE execution_id=?)")
            .get(f.state.paidQuote.executionId);assert.ok(row);
          f.state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(row.content_id);
          // Only the intentional RAM retention mutation is restored for the
          // unchanged fixture's no-payment teardown; no product recovery runs.
          restore=()=>f.state.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(row.expires_at,row.content_id);
        }
      });
      try{
        await c.request("preview");assert.equal(read.entered,1);
        assert.equal(f.calls.at(-1).status,"unavailable");assert.notEqual(c.notice,"adaptive.changes.noChanges");
        assert.equal(c.uncertain,true);assert.equal(c.canPreview,false);assert.equal(c.canApply,false);assert.equal(c.handle,null);
        assert.equal(previewRows(f.state).length,0);
        assert.deepEqual(canonical(f.state).authoring_commits,original.authoring_commits);
        if(change==="source-head"){
          const events=canonical(f.state).events;assert.equal(events.length,original.events.length+1);
          assert.equal(events.at(-1).event_id,introduced);
        }else assert.deepEqual(canonical(f.state),original);
        console.log("P8_NOOP_CONTROL "+JSON.stringify({case:"final-current-snapshot",mode,change,
          status:f.calls.at(-1).status,privatePreviewRows:0,authoringReceipts:0,intentionalConcurrentEvent:introduced}));
      }finally{restore();}
    });
  }
}

const corruptions=[
 ["wrong-selection-key",body=>({...body,selectionKey:"0".repeat(64)}),409],
 ["wrong-error",body=>({...body,error:"adaptive_changes_other"}),409],
 ["generic-status",body=>({...body,status:"unavailable"}),409],
 ["missing-noPayment",({noPayment,...body})=>{void noPayment;return body;},409],
 ["automatic-retry-field",body=>({...body,noAutomaticRetry:false}),409],
 ["extra-private-field",body=>({...body,preview:{privateText:"SYNTHETIC_MALFORMED_FIELD"}}),409],
 ["wrong-http",body=>body,200],
];
for(const[name,mutate,status]of corruptions)test("synthetic no-op response corruption: "+name+" cannot unlock editing",async t=>{
  const f=await noOpFixture(t,"personal"),c=f.controller;
  const control=replaceReply(t,f,"preview",async(response,body)=>{
    assert.equal(response.status,409);assert.equal(body.status,"preview-not-created");
    return Response.json(mutate(body),{status});
  });
  await c.request("preview");assert.equal(control.entered,1);f.unchanged();
  assert.equal(c.uncertain,true);assert.equal(c.canEdit,false);assert.equal(c.canPreview,false);
  assert.equal(c.canApply,false);assert.equal(c.handle,null);assert.notEqual(c.notice,"adaptive.changes.noChanges");
});

for(const action of["apply","retrieve","resume"])test("synthetic no-op response on "+action+" is never preparation permission",async t=>{
  const f=await noOpFixture(t,"personal"),c=f.controller;
  c.update(PROPOSAL,"text",f.target.properties.text+" Guarded existing review.");await c.request("preview");
  assert.equal(c.phase,"review",c.notice);const preview=structuredClone(c.preview);
  const control=replaceReply(t,f,action,async(response)=>{
    assert.equal(response.status,200);
    return Response.json(typedNoChange(preview.adaptiveReview.selectionKey),{status:409});
  });
  await c.request(action);assert.equal(control.entered,1);
  assert.equal(c.uncertain,true);assert.equal(c.canPreview,false);assert.equal(c.canEdit,false);
  assert.deepEqual(c.handle,{previewId:preview.previewId,approvalHash:preview.approvalHash});
  assert.notEqual(c.notice,"adaptive.changes.noChanges");
  if(action==="apply")verifyOriginalCommit(f.state,preview);else f.unchanged();
});

for(const interruption of["suspend","owner-removed"])test("late genuine no-op reply cannot revive "+interruption+" ownership",async t=>{
  const f=await noOpFixture(t,"personal"),c=f.controller;
  const control=replaceReply(t,f,"preview",async(response,body)=>{
    assert.equal(response.status,409);assert.equal(body.status,"preview-not-created");
    if(interruption==="suspend")c.suspend();else{f.h.store.session.set(null);c.synchronize();}
    return response;
  });
  await c.request("preview");assert.equal(control.entered,1);
  assert.equal(c.uncertain,true);assert.equal(c.canEdit,false);assert.equal(c.canPreview,false);
  assert.equal(c.canApply,false);assert.equal(c.handle,null);assert.equal(c.visible,false);
  assert.notEqual(c.notice,"adaptive.changes.noChanges");assert.equal(previewRows(f.state).length,0);
});
