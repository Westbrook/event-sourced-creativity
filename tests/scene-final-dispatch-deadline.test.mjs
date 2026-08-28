import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";

/** Schedule expiry after observePaid's final synchronous check but before its caller resumes. */
function clockAfterCheckpoint(t, expiresAt, expired) {
  const initial=Date.now();let now=initial,scheduled=false,crossed=false;
  t.mock.method(Date,"now",()=>{
    const stack=new Error().stack??"";
    if(!scheduled&&/at requireSceneCostDeadline[^\n]*\n\s+at (?:Object\.)?observePaid/u.test(stack)){
      scheduled=true;
      queueMicrotask(()=>{now=expired?Date.parse(expiresAt)+1:initial+1;crossed=true;});
    }
    return now;
  });
  return{get scheduled(){return scheduled;},get crossed(){return crossed;}};
}

function provider(t,{uncertain=false}={}){
  const calls=[];
  t.mock.method(globalThis,"fetch",async(url,init)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    const request=JSON.parse(init.body),input=JSON.parse(request.input);calls.push({request,input,at:Date.now()});
    if(uncertain)throw new TypeError("Connection lost after the paid POST could have reached its provider");
    const scenes=input.production?.assigned_scenes??[{title:"The harbor keeper",action:"The keeper checks harbor position 1."}];
    const items=scenes.map(scene=>({title:scene.title,body:scene.action,notes:"Preserve the authored harbor.",image_prompt:"",
      context_group_ids:input.combined_context_plan.map(group=>group.context_key),slide:null}));
    return Response.json({id:"final-dispatch-"+calls.length,model:"gpt-5.6-terra",
      output_text:JSON.stringify({title:"The harbor scene",summary:"One authored moment.",content_markdown:items.map(item=>item.body).join("\n\n"),presentation:null,items}),
      usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
  });
  return calls;
}

for(const medium of ["visual","audio"])for(const mode of ["manual","managed"]){
  for(const expired of [true,false]){
    test(mode+" "+medium+" Scene final adapter continuation "+(expired?"refuses expired source before fetch":"allows a still-valid deadline"),async t=>{
      const f=await createSceneCostFixture(1,medium,{depth:mode==="managed"}),calls=provider(t);
      try{
        const expiresAt=new Date(Date.now()+60_000).toISOString();
        f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(expiresAt,f.contentRef);
        const inspected=await f.preview({productionMode:mode});assert.equal(inspected.response.status,200);
        const approved=await f.approve(inspected.body.sceneCostPreview,{productionMode:mode});assert.equal(approved.response.status,202);
        const clock=clockAfterCheckpoint(t,expiresAt,expired);
        const result=await f.run();assert.equal(clock.scheduled,true);assert.equal(clock.crossed,true);
        assert.equal(calls.length,expired?0:1);
        assert.equal(result.body.job.status,expired?"failed":"completed",result.body.job.error);
        assert.equal(f.counts().document_jobs,1);
        if(expired){
          const checkpoint=JSON.parse(f.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(f.requestId).result_json);
          const receipts=Object.values(checkpoint.providerSubmissions??{});
          assert.equal(receipts.length,1);assert.equal(receipts[0].status,"rejected");assert.equal(receipts[0].costMicrousd,0);
          const holds=f.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE owner_id=? AND operation='document-render:scene'").all(f.owner);
          assert.equal(holds.length,1);assert.equal(holds[0].status,"released");assert.equal(holds[0].used_microusd,0);
          const original=await f.preview();assert.equal(original.body.job.jobId,f.requestId);assert.equal(original.body.sceneCostExisting.preview.bindingHash,inspected.body.sceneCostPreview.bindingHash);
        }else{
          assert.ok(calls[0].at<Date.parse(expiresAt));assert.equal(result.body.job.result.generationReceipt.actual_provider_call_count,1);
        }
      }finally{f.close();}
    });
  }
}

for(const mode of ["manual","managed"]){
  test(mode+" Scene network loss after dispatch remains uncertain and is never relabeled as a zero-cost refusal",async t=>{
    const f=await createSceneCostFixture(1,"audio"),calls=provider(t,{uncertain:true});
    try{
      const preview=(await f.preview({productionMode:mode})).body.sceneCostPreview;
      await f.approve(preview,{productionMode:mode});const result=await f.run();
      assert.equal(calls.length,1);assert.equal(result.body.job.status,"failed");
      const checkpoint=JSON.parse(f.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(f.requestId).result_json);
      const receipts=Object.values(checkpoint.providerSubmissions??{});assert.equal(receipts.length,1);assert.equal(receipts[0].status,"pending");assert.equal(receipts[0].costMicrousd,undefined);
      const hold=f.sqlite.prepare("SELECT status,used_microusd FROM cost_budget_reservations WHERE owner_id=? AND operation='document-render:scene'").get(f.owner);
      assert.equal(hold.status,"executing");assert.equal(hold.used_microusd,0);
      assert.equal(result.body.job.result.generationReceipt.provider_submission_uncertain,true);
      const retained=await f.preview();assert.equal(retained.body.job.jobId,f.requestId);assert.equal(calls.length,1);
    }finally{f.close();}
  });
}
