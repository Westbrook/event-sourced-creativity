import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import worker from "../dist/server/index.js";
import { falImageProviderReceipt } from "../worker/fal-image-adapter.ts";
import { generateCreativeImage } from "../worker/image-adapter.ts";

const workspaceRoot=new URL("../",import.meta.url).href;
const sourceResolution=registerHooks({resolve(specifier,context,nextResolve){
  const workspaceSource=typeof context.parentURL==="string"&&context.parentURL.startsWith(workspaceRoot)&&!context.parentURL.includes("/node_modules/");
  return nextResolve(workspaceSource&&specifier.startsWith(".")&&!/\.[a-z0-9]+$/iu.test(specifier)?`${specifier}.ts`:specifier,context);
}});
const [{handleDocumentJobs},{handleEvents}]=await Promise.all([import("../worker/document-jobs-api.ts"),import("../worker/events-api.ts")]).finally(()=>sourceResolution.deregister());

const providerEnv={OPENAI_API_KEY:"moderation-test-key",FAL_KEY:"private-fal-test-key",FORMA_IMAGE_PROVIDER:"fal-ideogram"};
const source={facts:[{block_id:"owned-source",type:"subject",intent:"include",properties:{text:"an adult designer arranging abstract blank cards",weight:1}}]};
const direction={title:"Owned storyboard frame",scene:"An adult designer arranges abstract blank cards around one shared context."};
const moderation=()=>Response.json({id:"modr-storyboard-durability",model:"omni-moderation-latest",results:[{flagged:false,categories:{},category_scores:{}}]});
const queueBase="https://queue.fal.run/ideogram/v4/fast";
const queueApplication="https://queue.fal.run/ideogram/v4";
const receiptFor=(requestId="owned-frame-request-1")=>({provider:"fal",model:"ideogram/v4/fast",providerRequestId:requestId,providerStatusUrl:`${queueApplication}/requests/${requestId}/status`,providerResponseUrl:`${queueApplication}/requests/${requestId}`,providerCancelUrl:`${queueApplication}/requests/${requestId}/cancel`});

test("derives canonical application-scoped Fal queues from trusted local model and accepted request identity only",()=>{
  assert.deepEqual(falImageProviderReceipt("ideogram/v4/fast","owned-frame-request-1"),receiptFor());
  assert.deepEqual(falImageProviderReceipt("ideogram/v4/image-to-image","owned-frame-request-1"),{...receiptFor(),model:"ideogram/v4/image-to-image"});
  assert.deepEqual(falImageProviderReceipt("workflows/owner/application/fast","owned-frame-request-1"),{
    provider:"fal",model:"workflows/owner/application/fast",providerRequestId:"owned-frame-request-1",
    providerStatusUrl:"https://queue.fal.run/workflows/owner/application/requests/owned-frame-request-1/status",
    providerResponseUrl:"https://queue.fal.run/workflows/owner/application/requests/owned-frame-request-1",
    providerCancelUrl:"https://queue.fal.run/workflows/owner/application/requests/owned-frame-request-1/cancel",
  });
  for(const invalidId of ["","../foreign-frame","foreign?id=1","submitted","pending","unknown","x".repeat(201)]){
    assert.throws(()=>falImageProviderReceipt("ideogram/v4/fast",invalidId),(error)=>error.detail?.code==="fal_provider_returned_invalid_request_id",invalidId);
  }
  for(const invalidModel of ["ideogram","ideogram/../other","https://attacker.invalid/steal","ideogram/v4?leak=1","ideogram//fast"]){
    assert.throws(()=>falImageProviderReceipt(invalidModel,"owned-frame-request-1"),(error)=>error.detail?.code==="fal_provider_receipt_mismatch",invalidModel);
  }
});

function databaseFixture(){
  const sqlite=new DatabaseSync(":memory:");
  class Statement{
    constructor(sql,values=[]){this.sql=sql;this.values=values;}
    bind(...values){return new Statement(this.sql,values);}
    execute(kind){const statement=sqlite.prepare(this.sql);if(kind==="first")return statement.get(...this.values)??null;if(kind==="all")return{results:statement.all(...this.values),success:true,meta:{changes:0}};return{results:[],success:true,meta:{changes:Number(statement.run(...this.values).changes)}};}
    async first(){return this.execute("first");}
    async all(){return this.execute("all");}
    async run(){return this.execute("run");}
  }
  const DB={prepare(sql){return new Statement(sql);},async batch(statements){sqlite.exec("BEGIN");try{const result=statements.map((statement)=>statement.execute(/^\s*(?:SELECT|WITH)/iu.test(statement.sql)?"all":"run"));sqlite.exec("COMMIT");return result;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  const env={...providerEnv,DB,OPENAI_MODEL:"gpt-5.6-terra",ASSETS:{fetch:async()=>new Response(null,{status:404})},MEDIA:{put:async()=>undefined,get:async()=>null}};
  return{sqlite,env};
}

test("durably receives the full owner-scoped Fal queue receipt before any queue poll or image retrieval",async()=>{
  const previousFetch=globalThis.fetch;const calls=[];const receipts=[];let releaseCheckpoint;const checkpointWritten=new Promise((resolve)=>{releaseCheckpoint=resolve;});
  globalThis.fetch=async(url,init={})=>{
    const address=String(url);calls.push(address);
    if(address.endsWith("/moderations"))return moderation();
    if(address===queueBase&&init.method==="POST")return Response.json({request_id:"owned-frame-request-1",status:"COMPLETED",status_url:receiptFor().providerStatusUrl,response_url:receiptFor().providerResponseUrl,cancel_url:receiptFor().providerCancelUrl});
    if(address===receiptFor().providerResponseUrl){assert.equal(receipts.length,1,"the complete accepted-provider receipt must already be durable");return Response.json({images:[{url:"https://cdn.fal.media/owned-storyboard.jpg",content_type:"image/jpeg",width:1024,height:1024}]});}
    if(address==="https://cdn.fal.media/owned-storyboard.jpg")return new Response("owner-private-image",{headers:{"content-type":"image/jpeg"}});
    throw new Error(`unexpected provider request ${address}`);
  };
  try{
    const pending=generateCreativeImage(providerEnv,"owner-1",source,direction,{quality:"low",size:"1024x1024",onProviderReceipt:async(receipt)=>{receipts.push(receipt);await checkpointWritten;}});
    await new Promise(setImmediate);
    assert.deepEqual(receipts,[receiptFor()]);
    assert.equal(calls.includes(receiptFor().providerResponseUrl),false,"paid queue work must wait until its accepted receipt is durably checkpointed");
    assert.doesNotMatch(JSON.stringify(receipts[0]),/private-fal-test-key|adult designer|owned-source/u,"provider support receipts cannot leak credentials or private source context");
    releaseCheckpoint();
    const image=await pending;
    assert.equal(image.providerRequestId,"owned-frame-request-1");
    assert.equal(calls.filter((address)=>address===queueBase).length,1);
  }finally{releaseCheckpoint();globalThis.fetch=previousFetch;}
});

test("resumes the exact accepted storyboard-frame queue without submitting a second paid request",async()=>{
  const previousFetch=globalThis.fetch;const calls=[];const receipts=[];let failedPoll=false;
  globalThis.fetch=async(url,init={})=>{
    const address=String(url);calls.push({address,method:init.method??"GET",authorization:new Headers(init.headers).get("authorization")});
    if(address.endsWith("/moderations"))return moderation();
    if(address===queueBase&&init.method==="POST")return Response.json({request_id:"owned-frame-request-1",status:"IN_QUEUE"});
    if(address===`${receiptFor().providerStatusUrl}?logs=1`){if(!failedPoll){failedPoll=true;throw new TypeError("network connection interrupted after Fal accepted the image");}return Response.json({request_id:"owned-frame-request-1",status:"COMPLETED"});}
    if(address===receiptFor().providerResponseUrl)return Response.json({images:[{url:"https://cdn.fal.media/recovered-storyboard.jpg",content_type:"image/jpeg",width:1024,height:1024}]});
    if(address==="https://cdn.fal.media/recovered-storyboard.jpg")return new Response("recovered-private-image",{headers:{"content-type":"image/jpeg"}});
    throw new Error(`unexpected provider request ${address}`);
  };
  try{
    await assert.rejects(()=>generateCreativeImage(providerEnv,"owner-1",source,direction,{quality:"low",size:"1024x1024",onProviderReceipt:(receipt)=>receipts.push(receipt)}),(error)=>error.detail.category==="network"&&error.detail.requestId==="owned-frame-request-1");
    assert.deepEqual(receipts,[receiptFor()]);
    const stages=[];const resumed=await generateCreativeImage(providerEnv,"owner-1",source,direction,{quality:"low",size:"1024x1024",providerReceipt:receipts[0],onProviderReceipt:(receipt)=>receipts.push(receipt),onStage:(stage)=>stages.push(stage)});
    assert.equal(resumed.providerRequestId,"owned-frame-request-1");
    assert.equal(calls.filter((call)=>call.address===queueBase&&call.method==="POST").length,1,"resuming an already-paid frame must never submit a duplicate paid image");
    assert.equal(calls.filter((call)=>call.address===`${receiptFor().providerStatusUrl}?logs=1`).length,2);
    assert.ok(stages.includes("provider-resume"));
    assert.equal(stages.includes("provider-submit"),false);
    assert.ok(calls.filter((call)=>call.address.startsWith("https://queue.fal.run/")).every((call)=>call.authorization==="Key private-fal-test-key"));
  }finally{globalThis.fetch=previousFetch;}
});

test("durably checkpoints the canonical accepted request before rejecting any hostile provider-supplied queue location",async()=>{
  const previousFetch=globalThis.fetch;
  const malicious=[
    {status_url:"https://attacker.invalid/ideogram/v4/requests/owned-frame-request-1/status"},
    {status_url:`${queueApplication}/requests/someone-elses-frame/status`},
    {response_url:"https://queue.fal.run@attacker.invalid/ideogram/v4/requests/owned-frame-request-1"},
    {response_url:`${queueApplication}/requests/owned-frame-request-1/other`},
    {cancel_url:`${queueApplication}/requests/someone-elses-frame/cancel`},
  ];
  try{
    for(const supplied of malicious){
      const calls=[];const receipts=[];
      globalThis.fetch=async(url,init={})=>{
        const address=String(url);calls.push(address);
        if(address.endsWith("/moderations"))return moderation();
        if(address===queueBase&&init.method==="POST")return Response.json({request_id:"owned-frame-request-1",status:"COMPLETED",...supplied});
        throw new Error(`unsafe provider request escaped validation: ${address}`);
      };
      await assert.rejects(()=>generateCreativeImage(providerEnv,"owner-1",source,direction,{quality:"low",size:"1024x1024",onProviderReceipt:(receipt)=>receipts.push(receipt)}),(error)=>error.detail?.code==="fal_provider_returned_untrusted_queue_url"&&error.detail.requestId==="owned-frame-request-1",JSON.stringify(supplied));
      assert.deepEqual(receipts,[receiptFor()],"the accepted paid request identity must already be durable before an optional hostile hint is rejected");
      assert.equal(calls.filter((address)=>address===queueBase).length,1,"a malformed provider hint must never submit a second paid frame");
      assert.equal(calls.some((address)=>!address.endsWith("/moderations")&&address!==queueBase),false,"provider credentials never follow an untrusted hint");
    }
  }finally{globalThis.fetch=previousFetch;}
});

test("rejects foreign hosts, unrelated Fal request paths, credential-bearing URLs, and changed models without another paid request",async()=>{
  const previousFetch=globalThis.fetch;
  const invalid=[
    {providerStatusUrl:"https://attacker.invalid/requests/owned-frame-request-1/status"},
    {providerStatusUrl:`${queueApplication}/requests/someone-elses-frame/status`},
    {providerStatusUrl:`${queueBase}/requests/someone-elses-frame/status`},
    {providerResponseUrl:"https://queue.fal.run@attacker.invalid/ideogram/v4/requests/owned-frame-request-1"},
    {providerResponseUrl:`${queueApplication}/requests/owned-frame-request-1/foreign`},
    {model:"ideogram/v4"},
    {providerRequestId:"../foreign-frame"},
  ];
  try{
    for(const override of invalid){
      const calls=[];
      globalThis.fetch=async(url)=>{const address=String(url);calls.push(address);if(address.endsWith("/moderations"))return moderation();throw new Error(`unsafe request reached ${address}`);};
      await assert.rejects(()=>generateCreativeImage(providerEnv,"owner-1",source,direction,{quality:"low",size:"1024x1024",providerReceipt:{...receiptFor(),...override}}),(error)=>["fal_provider_returned_untrusted_queue_url","fal_provider_receipt_mismatch","fal_provider_returned_invalid_request_id"].includes(error.detail?.code));
      assert.equal(calls.some((address)=>!address.endsWith("/moderations")),false,"forged receipts must neither leak Fal credentials nor initiate paid work");
    }
  }finally{globalThis.fetch=previousFetch;}
});

test("stops when Fal acknowledges an image without a durable request identifier",async()=>{
  const previousFetch=globalThis.fetch;let submissions=0;
  globalThis.fetch=async(url,init={})=>{if(String(url).endsWith("/moderations"))return moderation();if(String(url)===queueBase&&init.method==="POST"){submissions+=1;return Response.json({status:"IN_QUEUE"});}throw new Error("unexpected automatic recovery");};
  try{
    await assert.rejects(()=>generateCreativeImage(providerEnv,"owner-1",source,direction,{quality:"low",size:"1024x1024"}),(error)=>error.detail.code==="fal_provider_returned_no_request_id"&&error.detail.retryable===false&&error.detail.action==="contact_support");
    assert.equal(submissions,1,"unknown provider acceptance must never be resolved by an automatic second charge");
  }finally{globalThis.fetch=previousFetch;}
});

test("rejects forged storyboard recovery receipts and queue URLs at both public admission boundaries",async()=>{
  const {sqlite,env}=databaseFixture();
  assert.equal((await worker.fetch(new Request("http://localhost/api/session"),env,{waitUntil(){}})).status,200);
  sqlite.prepare("UPDATE users SET consent_version=?").run("pilot-2026-08-10");
  assert.equal((await worker.fetch(new Request("http://localhost/api/events?after=0&limit=100&content=0"),env,{waitUntil(){}})).status,200);
  for(const forged of [
    {providerJobId:"someone-elses-paid-frame"},
    {providerStatusUrl:"https://attacker.invalid/steal-fal-credentials"},
    {providerResponseUrl:`${queueBase}/requests/someone-elses-frame/response`},
    {providerRequestId:"forged-frame-support-id"},
    {storyboardProviderSubmission:"confirmed"},
    {storyboardProviderRequestedAt:"2026-08-25T00:00:00.000Z"},
    {storyboardProviderAcceptedAt:"2026-08-25T00:00:00.000Z"},
    {reservationId:"another-owners-budget-reservation"},
    {artifactPlan:{items:[]}},
  ]){
    const payload={artifactKind:"storyboard",productionMode:"manual",itemCount:1,paidMediaConfirmed:true,...forged};
    const admitted=await handleDocumentJobs(new Request("http://localhost/api/document-jobs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind:"render_document",documentId:"doc-atmosphere",payload})}),env);
    assert.equal(admitted.status,400,JSON.stringify(await admitted.clone().json()));
    assert.equal((await admitted.json()).error,"media_recovery_state_server_owned");
    const direct=await handleEvents(new Request("http://localhost/api/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"render_document",documentId:"doc-atmosphere",...payload})}),env);
    assert.equal(direct.status,400,JSON.stringify(await direct.clone().json()));
    assert.equal((await direct.json()).error,"media_recovery_state_server_owned");
  }
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count),0);
});
