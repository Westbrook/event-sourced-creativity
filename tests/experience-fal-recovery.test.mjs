import assert from "node:assert/strict";
import test from "node:test";
import { createOutputFalImageContract, captureOutputFalImageRequest, restoreOutputFalImageRequest } from "../worker/output-fal-image-contract.ts";
import { readOutputFalImageResult, falImageProviderReceipt } from "../worker/fal-image-adapter.ts";

// No DB/admission or completed provider response is fabricated. The only fetch
// attempted is intercepted and throws, proving the reader's first GET boundary.
async function capture(){
  const contract=createOutputFalImageContract("ideogram/v4","1024x1024");
  return captureOutputFalImageRequest(contract,contract.model,{prompt:"A copper lamp.",expansion_model:"Large",image_size:{width:1024,height:1024},
    rendering_speed:"QUALITY",acceleration:"none",num_images:1,sync_mode:false,enable_safety_checker:true,output_format:"png"},contract,"original-call");
}
test("recovery rebinds exact original bytes and rejects mutated, reformatted or digest-mismatched input",async()=>{
  const c=await capture();
  assert.deepEqual(await restoreOutputFalImageRequest(c.contract,c.body,c.attempt.clientRequestId,c.attempt.requestDigest),c);
  for(const body of [c.body+" ",c.body.replace("copper","silver"),JSON.stringify(JSON.parse(c.body),null,2),"[]","x".repeat(32769)])
    await assert.rejects(restoreOutputFalImageRequest(c.contract,body,c.attempt.clientRequestId,c.attempt.requestDigest));
  await assert.rejects(restoreOutputFalImageRequest({...c.contract,outputFormat:"jpeg"},c.body,c.attempt.clientRequestId,c.attempt.requestDigest));
  await assert.rejects(restoreOutputFalImageRequest(c.contract,c.body,c.attempt.clientRequestId,"0".repeat(64)));
});
test("recovery rejects missing authority and noncanonical receipt before any read",async()=>{
  const c=await capture(),receipt=falImageProviderReceipt(c.contract.model,"recorded-request"),before=globalThis.fetch;let reads=0;
  globalThis.fetch=()=>{reads++;throw new Error("forbidden");};
  try{
    const env={FAL_KEY:"inert-key-presence"};
    await assert.rejects(readOutputFalImageResult(env,c,receipt,{}));
    for(const changed of [{...receipt,providerStatusUrl:receipt.providerStatusUrl+"?secret=1"},{...receipt,model:"ideogram/v4/fast"},{...receipt,extra:true}])
      await assert.rejects(readOutputFalImageResult(env,c,changed,{assertCurrent:async()=>{}}),/receipt_mismatch/);
    await assert.rejects(readOutputFalImageResult(env,c,receipt,{assertCurrent:async()=>{throw new Error("custody_revoked");}}),/custody_revoked/);
    assert.equal(reads,0);
  }finally{globalThis.fetch=before;}
});
test("recovery starts only an explicit canonical GET with redirects denied, no POST or automatic retry",async()=>{
  const c=await capture(),receipt=falImageProviderReceipt(c.contract.model,"recorded-request"),before=globalThis.fetch;const order=[];
  globalThis.fetch=async(url,init)=>{order.push("read");assert.equal(url,receipt.providerStatusUrl);assert.equal(init.method,"GET");assert.equal(init.redirect,"error");assert.equal(init.body,undefined);throw new Error("transport_stopped");};
  try{
    await assert.rejects(readOutputFalImageResult({FAL_KEY:"inert-key-presence"},c,receipt,{assertCurrent:async()=>{order.push("guard");}}));
    assert.deepEqual(order,["guard","read"]);
  }finally{globalThis.fetch=before;}
});

test("existing progress and finish SQL preserve the privately retained checkpoint across stale row writes",async()=>{
  const {DatabaseSync}=await import("node:sqlite"),{readFile}=await import("node:fs/promises");
  const source=await readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8");
  // Execute the two production SQL expressions, not a reimplementation. This is
  // metadata-only merge coverage, not a fabricated admission/provider journey.
  for(const name of ["persistedResult","outputResultAssignment"]){
    const expression=source.match(new RegExp(`const ${name}=row\\.output_slot_id\\?"([^"\\n]+)"`))?.[1];assert.ok(expression);
    const db=new DatabaseSync(":memory:");
    try{
      db.exec("CREATE TABLE document_jobs(result_json TEXT)");
      const checkpoint={version:"output-fal-checkpoint-v1",requestRef:"private-request",planningRef:"private-plan"};
      db.prepare("INSERT INTO document_jobs VALUES(?)").run(JSON.stringify({outputFalCheckpoint:checkpoint,providerSubmissions:{},stage:"prior"}));
      db.prepare(`UPDATE document_jobs SET result_json=${expression}`).run(JSON.stringify({stage:"saving",outputFalCheckpoint:{requestRef:"stale"}}));
      const stored=JSON.parse(db.prepare("SELECT result_json FROM document_jobs").get().result_json);
      assert.deepEqual(stored.outputFalCheckpoint,checkpoint);assert.equal(stored.stage,"saving");
    }finally{db.close();}
  }
});


test("actual Fal paid fetch follows the final gate without an optional-reader-guard microtask gap",async()=>{
  const {readFile}=await import("node:fs/promises"),{stripTypeScriptTypes}=await import("node:module");
  const {submitOutputFalImageRequest}=await import("../worker/output-fal-image-contract.ts");
  const source=await readFile(new URL("../worker/fal-image-adapter.ts",import.meta.url),"utf8");
  const start=source.indexOf("async function falJson("),end=source.indexOf("\nfunction trustedFalQueueUrl",start);
  assert.ok(start>=0&&end>start);
  // Execute the actual private transport function, with only its error
  // dependencies inert. No successful provider response is manufactured.
  const transport=new Function("fetch","ProviderRequestError","classifyProviderFailure","falError",
    stripTypeScriptTypes(source.slice(start,end))+";return falJson;");
  const order=[],stopped=new Error("transport_stopped");
  const falJson=transport((url,init)=>{order.push("fetch");assert.equal(init.method,"POST");throw stopped;},
    class extends Error{constructor(){super("transport_stopped");}},()=>({}),()=>stopped);
  const c=await capture();
  await assert.rejects(submitOutputFalImageRequest(c,{beforeAttempt(){},checkpoint(){},pending(){},
    beforeDispatch(){order.push("gate");queueMicrotask(()=>order.push("microtask"));}},
    body=>falJson({},"https://queue.fal.run/ideogram/v4",{method:"POST",body},"")),/transport_stopped/);
  assert.deepEqual(order,["gate","fetch","microtask"]);
});

async function recoveryBatchSeam(){
  const {readFile}=await import("node:fs/promises"),{stripTypeScriptTypes}=await import("node:module");
  const source=await readFile(new URL("../worker/output-fal-recovery.ts",import.meta.url),"utf8");
  const start=source.indexOf("async function acknowledgedRecoveryBatch"),end=source.indexOf("/** Explicit recovery",start);
  assert.ok(start>=0&&end>start);
  const checked=new Function("reject",stripTypeScriptTypes(source.slice(start,end))+";return acknowledgedRecoveryBatch;")(code=>{throw new Error(code);});
  return{source,checked,stripTypeScriptTypes};
}
test("original recovery requires every indexed batch acknowledgement and never retries an unknown commit",async()=>{
  const {checked}=await recoveryBatchSeam(),statements=[{},{}],ok=()=>({success:true,results:[]});
  const good=[ok(),{success:true,results:[{original:"retained"}]}];
  assert.deepEqual(await checked({batch:async()=>good},statements),good);
  const sparse=[ok(),ok()];delete sparse[0];
  const inherited=Object.create({success:true});inherited.results=[];
  let getters=0;const accessor=[ok(),ok()];Object.defineProperty(accessor,"0",{get(){getters++;return ok();}});
  const errorAccessor={success:true,results:[]};Object.defineProperty(errorAccessor,"error",{get(){getters++;return undefined;}});
  const bad=[undefined,null,{},[],[ok()],[ok(),ok(),ok()],sparse,[{success:false,results:[]},ok()],
    [{success:true,error:"failed guard",results:[]},ok()],[{success:true},ok()],
    [{success:true,results:{}},ok()],[{success:true,results:Array(1)},ok()],
    [{success:true,results:[null]},ok()],[{success:true,results:[[]]},ok()],
    [inherited,ok()],accessor,[errorAccessor,ok()]];
  for(const response of bad){
    let calls=0,next=0;
    await assert.rejects(async()=>{await checked({batch:async()=>{calls++;return response;}},statements);next++;},/output_fal_recovery_ack_unavailable/);
    assert.equal(calls,1);assert.equal(next,0);
  }
  assert.equal(getters,0);
  const lost=new Error("lost acknowledgement after possible commit");let calls=0;
  await assert.rejects(checked({batch:async()=>{calls++;throw lost;}},statements),error=>error===lost);
  assert.equal(calls,1,"No retry or assertion that the transaction did not commit");
});
test("actual recovery currentness gate stops the original GET after malformed batch acknowledgements",async()=>{
  const {source,checked,stripTypeScriptTypes}=await recoveryBatchSeam();
  const expression=source.match(/const assertCurrent=(async\(\)=>\{[^\n]+\});/u)?.[1];assert.ok(expression);
  assert.match(source,/const results=await acknowledgedRecoveryBatch<T>\(env.DB,/u);
  assert.match(source,/await acknowledgedRecoveryBatch\(env.DB,\[\.\.\.assertions\.flatMap/u,"Lease claim is qualified");
  assert.match(source,/await acknowledgedRecoveryBatch\(env.DB,\[\.\.\.live\(\)\.flatMap/u,"Original receipt write is qualified");
  assert.equal((source.match(/env\.DB\.batch/g)||[]).length,0,"No unchecked batch remains in original recovery");
  const c=await capture(),receipt=falImageProviderReceipt(c.contract.model,"recorded-request"),before=globalThis.fetch;
  let fetches=0;globalThis.fetch=()=>{fetches++;throw new Error("must not reach provider");};
  try{
    for(const result of [[{success:true,results:[]}],[{success:false,results:[]},{success:true,results:[]}],Array(2)]){
      let calls=0;
      const current=new Function("signal","acknowledgedRecoveryBatch","env","live","outputAssertionStatements",`return ${stripTypeScriptTypes(expression)};`)(
        new AbortController().signal,checked,{DB:{batch:async()=>{calls++;return result;}}},()=>[{}],()=>[{},{}]);
      await assert.rejects(readOutputFalImageResult({FAL_KEY:"inert-key-presence"},c,receipt,{assertCurrent:current}),/output_fal_recovery_ack_unavailable/);
      assert.equal(calls,1);assert.equal(fetches,0);
    }
  }finally{globalThis.fetch=before;}
});
