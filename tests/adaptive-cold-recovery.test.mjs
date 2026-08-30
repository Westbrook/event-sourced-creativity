import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import ts from "typescript";
import { createSceneStoreHost, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { accountCachePort, financial } from "./helpers/event-source-retirement-fixture.mjs";
import { withDocumentInRoute } from "../src/model/routes.ts";

// Additive regression controls; the original eleven/nine cases remain unchanged.
// Actual complete Store + actual RAM Worker + the real public controller factory.
// This is not a full mounted-host/browser/AT claim. Every fixture has exactly TWO
// existing deterministic setup responses, then zero new provider/execute calls.
// No document-job run, Dismiss or checkpoint request is permitted.
const API="/api/context/adaptive/apply",NATIVE="/api/document-jobs/adaptive";
const sha=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function definitions(file,names){
  const url=new URL(file,import.meta.url),source=readFileSync(url,"utf8");
  const tree=ts.createSourceFile(url.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length,0);
  const declarations=tree.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)
    ||ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)
    ||ts.isExpressionStatement(node)&&node.getText(tree)==="hooks.deregister();")
    .map(node=>node.getFullText(tree)).join("\n");
  const fixtureUrl=new URL(url);fixtureUrl.search="?phase8-cold-recovery-controls-r1";
  const hook=registerHooks({load(request,context,next){
    return request===fixtureUrl.href?{format:"module",source:declarations+"\nexport { "+names.join(",")+" };\n",shortCircuit:true}:next(request,context);
  }});
  try{return await import(fixtureUrl.href);}finally{hook.deregister();}
}
const routed=await definitions("./assistant-runtime.test.mjs",[
  "phase8Fixture","quoteAdaptiveConsent","executeAdaptiveConsent","adaptiveJob",
  "phase8Preview","phase8PaidEvidence","main170Phase8Ledgers"
]);
const {createAdaptiveProposalReview}=await import("../src/components/adaptive-proposal-review.ts");
const model=await definitions("./adaptive-proposal-host.test.mjs",["fixture"]);
const observation=value=>console.log("ADAPTIVE_COLD_CONTROL "+JSON.stringify(value));
const events=x=>x.state.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();
const receipts=x=>x.state.sqlite.prepare("SELECT * FROM authoring_commits ORDER BY preview_id").all();
const source=(x,id)=>x.h.store.adaptiveProposalSource(x.state.scope.documentId,x.state.scope.canvasId,id);
const calls=x=>x.h.requests.filter(row=>row.url===API);
const pending=(x,promise)=>{x.pending.add(promise);promise.then(()=>x.pending.delete(promise),()=>x.pending.delete(promise));return promise;};
async function entered(hold,work,label){
  const result=await Promise.race([hold.entered.promise.then(()=>true),work.then(()=>false)]);
  assert.equal(result,true,label+": reached actual await, not an assumed delay");
}
function holdBody(x){
  const value={entered:sceneDeferred(),gate:sceneDeferred(),record:null,jsonReturned:false,release(){this.gate.resolve();}};
  x.hold=value;x.gates.push(value);return value;
}
function currentController(x){
  return createAdaptiveProposalReview(x.h.store,()=>({...x.state.scope}),()=>{},()=>"Explicit original read");
}
function assertReview(x,controller){
  assert.equal(controller.phase,"review",controller.notice);
  assert.equal(controller.executionId,x.second.executionId);
  assert.equal(controller.bindingHash,x.second.bindingHash);
  assert.equal(controller.preview?.previewId,x.preview.previewId);
  assert.equal(controller.handle?.approvalHash,x.preview.approvalHash);
  assert.equal(controller.originals.length>0,true);
  assert.equal(controller.canApply,true);
  assert.equal(calls(x).filter(row=>row.body.action==="apply").length,0);
}
function assertWithheld(x,controller){
  assert.equal(controller.preview,null);assert.equal(controller.receipt,null);
  assert.equal(controller.originals.length,0);assert.equal(controller.canApply,false);
  assert.equal(controller.phase,"unavailable");
  assert.equal(calls(x).filter(row=>row.body.action==="apply"||row.body.action==="preview").length,0);
}
async function retireSource(x){
  const old=x.h.store.captureSourceOwnership();
  x.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),x.contextId);
  await assert.rejects(x.h.store.refreshEvents(),/403/u);
  assert.equal(x.h.store.sourceOwnershipActive(old),false);
  x.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(x.contextId);
  await x.h.store.refreshEvents();
  assert.equal(x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership()),true);
  assert.equal(x.h.store.sourceOwnershipActive(old),false);
  return old;
}
async function withdrawOriginal(x,id){
  const token=x.h.store.captureSourceOwnership(),before=source(x,id)?.withdrawalRevision??0,start=x.nativeRows.length;
  assert.equal(x.h.store.sourceOwnershipActive(token),true);
  x.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),x.contextId);
  try{await assert.rejects(x.h.store.loadAdaptiveProposalOriginal(id),/planning_result_unavailable/u);}
  finally{x.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(x.contextId);}
  const returned=x.nativeRows.slice(start);
  assert.equal(returned.length,1);assert.equal(returned[0].request.action,"resume");
  assert.equal(returned[0].request.executionId,id);assert.equal(returned[0].status,403);
  assert.equal(x.h.store.sourceOwnershipActive(token),true,"per-original denial does not fabricate a Source-generation retirement");
  assert.equal(source(x,id).withdrawalRevision>before,true);
  return source(x,id).withdrawalRevision;
}
async function fixture(t,canvas){
  const denied=t.mock.method(globalThis,"fetch",async()=>assert.fail("No external/provider transport"));
  accountCachePort(t);
  const state=await routed.phase8Fixture({shared:true,canvas});
  const x={state,canvas,pending:new Set(),gates:[],nativeRows:[],responses:[],hold:null,h:null,ready:false};
  t.after(async()=>{
    for(const gate of x.gates)gate.release();
    await Promise.allSettled([...x.pending]);
    try{
      assert.equal(denied.mock.callCount(),0);
      if(x.ready){
        assert.equal(state.calls.length,2,"exactly two deterministic setup responses; zero new generation");
        assert.equal(sha(financial(x.worker)),x.financial);
        assert.equal(sha(routed.main170Phase8Ledgers(state)),x.ledgers);
        for(const [quote,before]of x.paid)assert.equal(sha(routed.phase8PaidEvidence({...state,paidQuote:quote})),before);
        assert.equal(sha(events(x)),x.events);assert.equal(sha(receipts(x)),x.receipts);
        assert.equal(x.h.requests.filter(row=>row.url===NATIVE&&row.body?.action==="execute").length,0);
        assert.equal(calls(x).filter(row=>row.body?.action==="apply"||row.body?.action==="preview").length,0);
      }
    }finally{await x.h?.close();await state.cleanup();state.sqlite.close();}
  });
  x.first=state.paidQuote;
  // Exact existing two-original setup from assistant-runtime.test.mjs: a new
  // deliberate fixture intent, actual quote/execute, actual completion.
  const body={...state.paidBody,prompt:"A deliberately different later planning request."};
  x.second=await routed.quoteAdaptiveConsent(state,body,state.headers);
  assert.notEqual(x.second.executionId,x.first.executionId);
  const executed=await routed.executeAdaptiveConsent(state,x.second,body,state.headers);
  assert.equal(executed.status,202);await state.drainBackground();
  assert.equal(routed.adaptiveJob(state,x.second.executionId).status,"completed");
  assert.equal(state.calls.length,2);
  state.paidQuote=x.second;globalThis.fetch=denied;
  // Only the second original has a free saved human preview, so default read
  // identity is unambiguous. We never forge a preview, hash, receipt or job.
  x.preview=(await routed.phase8Preview(state)).preview;
  const rows=state.sqlite.prepare("SELECT context_id FROM project_context_sessions WHERE project_access_id=? AND principal_user_id=? AND revoked_at IS NULL").all(state.projectAccessId,state.owner);
  assert.equal(rows.length,1);x.contextId=rows[0].context_id;
  x.worker={...state,projectId:state.scope.projectId,documentId:state.scope.documentId,streamId:state.stream,events:[],
    contentRef:"unused-cold-fixture-fallback",content:"",requestId:"unused-scene-port",payload:{workflowSources:[]},close(){},
    request(url,init={}){
      const headers=new Headers(state.headers);new Headers(init.headers).forEach((value,key)=>headers.set(key,value));
      return state.request(url,{...init,headers});
    }};
  x.h=await createSceneStoreHost({workerFixture:x.worker});
  x.h.store.route.set(canvas?"/canvas/"+state.scope.canvasId+"/cold-original?view=list"
    :withDocumentInRoute("/studio/adaptive",state.scope.documentId,x.h.store.projection.get().documentTitle));
  if(canvas)assert.equal(x.h.store.chooseCanvasPlanningDocument(state.scope.documentId),true);
  x.h.transport=async row=>{
    assert.doesNotMatch(row.url,/^\/api\/document-jobs\/[^/]+\/(?:run|dismiss|checkpoint)(?:[/?]|$)/u);
    const response=await x.worker.request(row.url,row.init);
    if(row.url===NATIVE)x.nativeRows.push({request:structuredClone(row.body),status:response.status});
    if(row.url!==API)return response;
    const record={request:structuredClone(row.body),status:response.status,body:await response.clone().json()};
    x.responses.push(record);
    const held=x.hold;
    if(!held||row.body.action!=="resume")return response;
    x.hold=null;held.record=record;const json=response.json.bind(response);
    return new Proxy(response,{get(target,key){
      if(key==="json")return async()=>{held.entered.resolve();await held.gate.promise;const body=await json();held.jsonReturned=true;return body;};
      const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
    }});
  };
  await x.h.store.syncDocumentJobs();
  for(const quote of[x.first,x.second]){
    await x.h.store.loadAdaptiveProposalOriginal(quote.executionId);
    assert.equal(source(x,quote.executionId)?.readable,true);
  }
  x.authority=x.h.store.captureAuthorizationScope();
  await retireSource(x);
  const one=source(x,x.first.executionId),two=source(x,x.second.executionId);
  assert.ok(one&&two);assert.equal(one.withdrawalRevision>0,true);assert.equal(two.withdrawalRevision>0,true);
  assert.notEqual(one.withdrawalRevision,two.withdrawalRevision,"existing global clock orders both historical withdrawals");
  assert.equal(one.bindingHash,null);assert.equal(two.bindingHash,null);
  const read=x.h.store.captureAdaptiveProposalRead();
  assert.ok(read);assert.equal(read.current(),true);assert.equal(read.revision>=Math.max(one.withdrawalRevision,two.withdrawalRevision),true);
  assert.equal(x.h.store.authorizationScopeActive(x.authority),true);
  x.financial=sha(financial(x.worker));x.ledgers=sha(routed.main170Phase8Ledgers(state));
  x.paid=[x.first,x.second].map(quote=>[quote,sha(routed.phase8PaidEvidence({...state,paidQuote:quote}))]);
  x.events=sha(events(x));x.receipts=sha(receipts(x));x.ready=true;
  return x;
}

for(const canvas of[false,true])test("cold actual two-original read ignores a later unrelated withdrawal: "+(canvas?"Canvas":"Document"),async t=>{
  const x=await fixture(t,canvas),controller=currentController(x),read=x.h.store.captureAdaptiveProposalRead(),hold=holdBody(x);
  const work=pending(x,controller.resume());await entered(hold,work,"actual default Resume JSON");
  assert.equal(hold.record.status,200);assert.equal(hold.record.body.preview.previewId,x.preview.previewId);
  assert.deepEqual(Object.keys(hold.record.request).sort(),["action","canvasId","documentId","projectId"]);
  const revision=await withdrawOriginal(x,x.first.executionId);
  assert.equal(revision>read.revision,true);assert.equal(source(x,x.second.executionId).withdrawalRevision<=read.revision,true);
  hold.release();await work;assertReview(x,controller);
  observation({kind:"unrelated-newer-withdrawal",canvas,captured:read.revision,withdrawal:revision,returnedOriginalExact:true,setupResponses:2,newResponses:0});
});

test("cold exact-original withdrawal during actual JSON withholds then a deliberate Check recovers",async t=>{
  const x=await fixture(t,false),controller=currentController(x),read=x.h.store.captureAdaptiveProposalRead(),hold=holdBody(x);
  const work=pending(x,controller.resume());await entered(hold,work,"actual default Resume JSON");
  const revision=await withdrawOriginal(x,x.second.executionId);assert.equal(revision>read.revision,true);
  hold.release();await work;assertWithheld(x,controller);
  await controller.resume();assertReview(x,controller);
  observation({kind:"exact-withdrawal-json",captured:read.revision,withdrawal:revision,explicitReadRecovers:true});
});

test("cold exact-original withdrawal during the actual selection digest withholds then Check recovers",async t=>{
  const x=await fixture(t,true),controller=currentController(x),body=holdBody(x),digestGate={entered:sceneDeferred(),gate:sceneDeferred(),release(){this.gate.resolve();}};
  x.gates.push(digestGate);let once=false;
  const real=crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle,"digest",async(algorithm,bytes)=>{
    let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{/* Non-selection digests pass through unchanged. */}
    if(!once&&body.jsonReturned&&value?.version==="human-adaptive-proposal-v1"&&value.executionId===x.second.executionId){
      once=true;digestGate.entered.resolve();await digestGate.gate.promise;
    }
    return real(algorithm,bytes);
  });
  const read=x.h.store.captureAdaptiveProposalRead(),work=pending(x,controller.resume());
  await entered(body,work,"actual default Resume JSON");body.release();
  await entered(digestGate,work,"real selection digest after actual body");
  const revision=await withdrawOriginal(x,x.second.executionId);assert.equal(revision>read.revision,true);
  digestGate.release();await work;assertWithheld(x,controller);
  await controller.resume();assertReview(x,controller);
  observation({kind:"exact-withdrawal-digest",actualDigestReturnedUnchanged:true,explicitReadRecovers:true});
});

test("cold default read never adopts a Source token after denial and same-authority restoration",async t=>{
  const x=await fixture(t,false),controller=currentController(x),read=x.h.store.captureAdaptiveProposalRead(),hold=holdBody(x);
  const work=pending(x,controller.resume());await entered(hold,work,"actual default Resume JSON");
  await retireSource(x);assert.equal(read.current(),false);
  assert.equal(x.h.store.captureAdaptiveProposalRead().current(),true);
  assert.equal(x.h.store.authorizationScopeActive(x.authority),true);
  hold.release();await work;assertWithheld(x,controller);
  await controller.resume();assertReview(x,controller);
  observation({kind:"source-aba",oldCurrent:false,freshCurrent:true,sameAuthority:true,explicitReadRecovers:true});
});

test("cold captured deadline is not extended by an actual same-key session renewal",async t=>{
  const x=await fixture(t,true),deadline=Date.now()+2000;
  x.state.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE context_id=?").run(new Date(deadline).toISOString(),x.contextId);
  await x.h.store.refreshSession();
  let now=deadline-1000;t.mock.method(Date,"now",()=>now);
  const authority=x.h.store.captureAuthorizationScope(),controller=currentController(x),read=x.h.store.captureAdaptiveProposalRead(),hold=holdBody(x);
  assert.ok(read);assert.equal(read.current(),true);
  const work=pending(x,controller.resume());await entered(hold,work,"actual default Resume JSON");
  now=deadline+1;
  x.state.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE context_id=?").run(new Date(deadline+60000).toISOString(),x.contextId);
  await x.h.store.refreshSession();
  assert.equal(x.h.store.captureAuthorizationScope().key,authority.key);
  assert.equal(read.current(),false);assert.equal(x.h.store.captureAdaptiveProposalRead().current(),true);
  hold.release();await work;assertWithheld(x,controller);
  await controller.resume();assertReview(x,controller);
  observation({kind:"captured-expiry",sameAuthority:true,capturedCurrent:false,freshCurrent:true,explicitReadRecovers:true});
});

// FINITE MODEL NEGATIVES ONLY. These are deliberately malformed adapter ports,
// never a user incident, server response, positive Source proof or real receipt.
for(const mode of["missing","null","negative","fractional","nonfinite","missing-current","not-current"])
test("finite malformed cold capture fails closed before dispatch: "+mode,async()=>{
  const f=model.fixture({readable:false});
  const values={
    null:null,negative:{revision:-1,current:()=>true},fractional:{revision:0.5,current:()=>true},
    nonfinite:{revision:Number.NaN,current:()=>true},"missing-current":{revision:0},"not-current":{revision:0,current:()=>false}
  };
  if(mode==="missing")delete f.ports.captureRead;else f.ports.captureRead=()=>values[mode];
  await f.controller.resume();
  assert.equal(f.calls.length,0);assert.equal(f.controller.preview,null);assert.equal(f.controller.receipt,null);
  assert.equal(f.controller.executionId,"");assert.equal(f.controller.bindingHash,"");
  assert.equal(f.controller.canApply,false);assert.equal(f.controller.phase,"unavailable");
  observation({kind:"finite-malformed-capture",mode,dispatches:0,positiveAuthorityClaim:false});
});
