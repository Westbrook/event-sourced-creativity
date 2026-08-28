import assert from "node:assert/strict";
import test from "node:test";
import { createPilotSceneFixture, scenePilotProvider } from "./helpers/scene-pilot-fixture.mjs";
import { createPolicyStoppedSceneFixture, policyMutation, policyFinancialSnapshot, policyOriginalRow, policyWitnessRow, updatePolicyWitness, updatePolicyCheckpoint, policyFinalRead, setPolicyCohort } from "./helpers/scene-policy-stop-fixture.mjs";
import { sceneCostFixtureProof } from "./helpers/scene-cost-fixture.mjs";
import { isSceneSafeUnusedProof } from "../src/model/scene-cost-consent.ts";
import { generationExecutionSummary } from "../src/model/generation-execution-evidence.ts";
import { documentGenerationInputInspection as generationInputs } from "../src/model/generation-inputs.ts";
import { clearPresentationServerOwnedCheckpointFields, presentationServerOwnedCheckpointField } from "../src/model/generation-budget.ts";

const noProvider=t=>t.mock.method(globalThis,"fetch",async()=>assert.fail("No provider is authorized in this proof/read test"));
const typedStop=job=>{
  assert.equal(job.status,"failed");assert.equal(job.errorDetail.code,"scene_paid_authority_changed");assert.equal(job.errorDetail.httpStatus,403);
  assert.equal(job.errorDetail.category,"access");assert.equal(job.errorDetail.scope,"project");assert.equal(job.errorDetail.action,"check_project");
  assert.equal(job.errorDetail.retryable,false);assert.equal(job.errorDetail.requestId,null);assert.equal(job.attemptCount,1);
};
const exactProof=(f,read)=>{
  assert.equal(read.response.status,200,JSON.stringify(read.body));
  const existing=read.body.sceneCostExisting,proof=existing.safeUnused,job=read.body.job;
  assert.ok(isSceneSafeUnusedProof(proof),JSON.stringify(read.body));assert.equal(proof.reason,"policy-stopped-before-dispatch");
  for(const [key,value] of Object.entries({requestId:f.requestId,actorUserId:f.actorUserId,projectId:f.projectId,documentId:f.documentId,bindingHash:f.originalPreview.bindingHash,
    jobStatus:"failed",jobUpdatedAt:job.updatedAt,attemptCount:1}))assert.equal(proof[key],value,key);
  assert.equal(existing.preview.bindingHash,f.originalPreview.bindingHash);assert.equal(job.jobId,f.requestId);assert.equal(job.leaseExpiresAt,null);
  assert.doesNotMatch(JSON.stringify(proof),/harbor|keeper|input_ref|reservation_id|scene_policy_stop|scenePolicyStopSummary/u);
  return proof;
};
const exactReceipt=(receipt,calls,cost=calls*1400)=>{
  assert.equal(receipt.actual_provider_call_count,calls);assert.equal(receipt.actual_planner_call_count,calls);assert.equal(receipt.actual_media_call_count,0);
  assert.equal(receipt.provider_request_status,calls?"submitted":"not_submitted");assert.equal(receipt.source_transmission_status,calls?"transmitted":"not_transmitted");
  assert.equal(receipt.settled_cost_microusd,cost);assert.equal(receipt.reservation_status,cost?"settled":"released");
  assert.equal(receipt.unresolved_provider_call_count,0);assert.equal(receipt.provider_submission_uncertain,false);assert.equal(receipt.provider_call_breakdown_complete,true);
};
const sourceReceipt=f=>f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(f.checkpoint().generationReceipt.input_ref);
const originContext=f=>{const row=policyOriginalRow(f);return{jobId:row.job_id,correlationId:row.correlation_id,bindingHash:f.originalPreview.bindingHash,attemptCount:row.attempt_count,status:row.status};};
async function unchangedRead(f,expected=true){
  const original=policyOriginalRow(f),finance=policyFinancialSnapshot(f),writes=f.controls.writes.length;
  const value=await f.preview();
  if(expected)exactProof(f,value);else{assert.equal(value.response.status,200,JSON.stringify(value.body));assert.equal(value.body.sceneCostExisting.safeUnused,null);}
  assert.deepEqual(policyOriginalRow(f),original);assert.deepEqual(policyFinancialSnapshot(f),finance);assert.equal(f.controls.writes.length,writes);
  return value;
}
async function caseTransaction(f,run){
  f.sqlite.exec("SAVEPOINT policy_negative");
  try{return await run();}finally{f.controls.beforeRead=null;f.controls.afterRead=null;f.controls.beforeRun=null;f.controls.beforeBatch=null;f.sqlite.exec("ROLLBACK TO policy_negative");f.sqlite.exec("RELEASE policy_negative");}
}
function copyLedger(f,table,changes){
  const row=f.sqlite.prepare("SELECT * FROM "+table+" LIMIT 1").get(),value={...row,reservation_id:"foreign-proof-"+crypto.randomUUID(),...changes},keys=Object.keys(value);
  f.sqlite.prepare("INSERT INTO "+table+"("+keys.join(",")+") VALUES("+keys.map(()=>"?").join(",")+")").run(...keys.map(key=>value[key]));
}
function copyAudit(f,changes={}){
  const row=f.sqlite.prepare("SELECT * FROM events WHERE correlation_id=? AND type='BudgetReleased'").get(f.requestId+":attempt:1");
  const value={...row,event_id:"extra-proof-"+crypto.randomUUID(),sequence:f.sqlite.prepare("SELECT MAX(sequence) AS seq FROM events WHERE stream_id=?").get(f.streamId).seq+1,...changes},keys=Object.keys(value);
  f.sqlite.prepare("INSERT INTO events("+keys.join(",")+") VALUES("+keys.map(()=>"?").join(",")+")").run(...keys.map(key=>value[key]));
}

for(const medium of ["visual","audio"])for(const mode of ["manual","managed"])for(const boundary of ["after-claim","pending"]){
  test(mode+" "+medium+" "+boundary+" policy stop permits only explicit fresh preparation and separate approval",async t=>{
    const calls=scenePilotProvider(t),f=await createPolicyStoppedSceneFixture({medium,mode,count:mode==="manual"?1:9,boundary});
    try{
      typedStop(f.stopped.body.job);assert.equal(calls.length,0);exactReceipt(f.checkpoint().generationReceipt,0);
      assert.equal(f.cost()[0].status,"released");assert.equal(f.tokens()[0].status,"released");assert.equal(f.cost()[0].used_microusd,0);assert.equal(f.tokens()[0].used_tokens,0);
      assert.equal(Object.values(f.checkpoint().providerSubmissions).length,boundary==="pending"?1:0);
      const audit=JSON.parse(policyWitnessRow(f).private_json).scene_policy_stop;assert.equal(audit.stage,boundary==="pending"?"after-pending":"before-pending");
      assert.equal(audit.job_id,f.requestId);assert.equal(audit.binding_hash,f.originalPreview.bindingHash);assert.equal(audit.used_tokens,0);assert.equal(audit.used_microusd,0);
      const sourceBefore=sourceReceipt(f),original=policyOriginalRow(f),finance=policyFinancialSnapshot(f);
      await unchangedRead(f);assert.equal(f.counts().document_jobs,1);
      const repeated=await f.approve(f.originalPreview);assert.equal(repeated.body.job.jobId,f.requestId);assert.equal(repeated.body.sceneCostExisting.safeUnused,null);assert.equal(calls.length,0);
      await setPolicyCohort(f,"active");await f.request("/api/events?after=0&limit=2000&content=0");
      await unchangedRead(f);
      const id="explicit-policy-next-"+crypto.randomUUID(),options={sceneRequestId:id,audience:"Deliberately changed audience"};
      const prepared=await f.preview(options);assert.equal(prepared.response.status,200,JSON.stringify(prepared.body));
      assert.equal(prepared.body.sceneCostPreview.requestId,id);assert.notEqual(prepared.body.sceneCostPreview.bindingHash,f.originalPreview.bindingHash);assert.equal(f.counts().document_jobs,1);assert.equal(calls.length,0);
      const wrong=await f.approve(f.originalPreview,options);assert.ok(wrong.response.status>=400);assert.equal(f.counts().document_jobs,1);
      const created=await f.approve(prepared.body.sceneCostPreview,options);assert.equal(created.response.status,202,JSON.stringify(created.body));assert.equal(created.body.job.jobId,id);assert.equal(calls.length,0);
      const response=await f.request("/api/document-jobs/"+id+"/run",f.json({})),finished=await response.json();
      assert.equal(finished.job.status,"completed",JSON.stringify(finished));assert.equal(calls.length,prepared.body.sceneCostPreview.providerCallCount);
      assert.ok(calls.length<=prepared.body.sceneCostPreview.maximumProviderCallCount);assert.equal(f.counts().document_jobs,2);
      assert.deepEqual(policyOriginalRow(f),original);assert.deepEqual(sourceReceipt(f),sourceBefore);
      for(const table of ["budget_reservations","cost_budget_reservations","pilot_cost_reservation_scopes"])
        for(const row of finance[table])assert.deepEqual(f.sqlite.prepare("SELECT * FROM "+table+" WHERE reservation_id=?").get(row.reservation_id),row,"original settled accounting is immutable");
    }finally{f.close();}
  });
}

for(const [scope,options] of [["enrolled editor",{member:true}],["cookie-free owner",{cookieFree:true}]]){
  test(scope+" retains exact current safe-unused policy-stop custody",async t=>{
    noProvider(t);const f=await createPolicyStoppedSceneFixture(options);
    try{
      const proof=exactProof(f,await unchangedRead(f));assert.equal(proof.contextSessionId,options.cookieFree?null:f.contextId);
      assert.equal(proof.actorUserId,f.actorUserId);
      const resource=f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?").get(f.requestId);
      assert.equal(resource.actor_user_id,f.actorUserId);assert.equal(resource.owner_user_id,f.owner);assert.equal(resource.visibility,"actor_private");
      assert.equal(f.stopped.body.job.result.generationReceipt,undefined,"project feeds stay redacted");
    }finally{f.close();}
  });
}

for(const medium of ["visual","audio"])for(const callsBefore of [0,1,2]){
  test("personal "+medium+" returned job/list/detail/input preserves "+callsBefore+" genuine calls and excludes only local stop",async t=>{
    const calls=scenePilotProvider(t,{duplicateAcrossPages:callsBefore===2});
    const f=await createPolicyStoppedSceneFixture({medium,pilot:false,shared:false,at:callsBefore+1,
      mutate(f){f.sqlite.prepare("UPDATE budget_counters SET hard_limit_tokens=1 WHERE scope='user' AND scope_id=?").run(f.actorUserId);}});
    try{
      typedStop(f.stopped.body.job);assert.equal(calls.length,callsBefore);exactReceipt(f.checkpoint().generationReceipt,callsBefore);
      exactReceipt(f.stopped.body.job.result.generationReceipt,callsBefore);
      const raw=JSON.stringify(f.checkpoint().providerSubmissions),row=policyOriginalRow(f),finance=policyFinancialSnapshot(f);
      const currentResponse=await f.request("/api/document-jobs/"+f.requestId),current=await currentResponse.json();assert.equal(currentResponse.status,200);
      exactReceipt(current.job.result.generationReceipt,callsBefore);
      const listResponse=await f.request("/api/document-jobs?scope=all&document="+f.documentId),list=await listResponse.json();assert.equal(listResponse.status,200);
      const listed=list.jobs.find(job=>job.jobId===f.requestId);assert.ok(listed);exactReceipt(listed.result.generationReceipt,callsBefore);
      const original=await f.preview();assert.equal(original.response.status,200);exactReceipt(original.body.job.result.generationReceipt,callsBefore);
      if(callsBefore)assert.equal(original.body.sceneCostExisting.safeUnused,null);else exactProof(f,original);
      const input=sourceReceipt(f),visible=generationInputs(current.job,[],{[input.content_id]:input.content});
      exactReceipt(visible.receipt.generation_receipt,callsBefore);assert.equal(visible.receipt.generation_receipt.provider_contacted,callsBefore>0);
      for(const value of [current,list,original.body,visible])assert.doesNotMatch(JSON.stringify(value),/scenePolicyStopSummary|scene-policy-stop-summary-v1|stopped_client_request_id|evidence_sha256/u);
      assert.equal(JSON.stringify(f.checkpoint().providerSubmissions),raw);assert.deepEqual(policyOriginalRow(f),row);assert.deepEqual(policyFinancialSnapshot(f),finance);
    }finally{f.close();}
  });
}

for(const medium of ["visual","audio"])for(const repair of [false,true]){
  test(medium+" prior paid "+(repair?"adapter repair":"next page")+" retains verified usage and never becomes unused",async t=>{
    const calls=scenePilotProvider(t,{badFirst:repair}),f=await createPolicyStoppedSceneFixture({medium,at:2});
    try{
      assert.equal(calls.length,1);typedStop(f.stopped.body.job);exactReceipt(f.checkpoint().generationReceipt,1);
      assert.equal(f.cost()[0].used_microusd,1400);assert.equal(f.tokens()[0].used_tokens,200);
      assert.equal(Object.values(f.checkpoint().providerSubmissions).filter(value=>value.status==="completed").length,1);
      await unchangedRead(f,false);await setPolicyCohort(f,"active");await unchangedRead(f,false);
      assert.equal(f.counts().document_jobs,1);assert.equal(calls.length,1);
    }finally{f.close();}
  });
}

for(const status of [403,422]){
  test("provider-side "+status+" with matching internal-looking code is still a real call, never server-unused",async t=>{
    let calls=0;t.mock.method(globalThis,"fetch",async url=>{assert.equal(String(url),"https://api.openai.com/v1/responses");calls++;
      return Response.json({error:{code:"scene_paid_authority_changed",message:"Current project access policy stopped this request.",scene_policy_stop:{stage:"after-pending"},scenePolicyStopSummary:{version:"scene-policy-stop-summary-v1"}}},{status});});
    const f=await createPilotSceneFixture();
    try{
      await f.admit();const stopped=await f.run();assert.equal(stopped.body.job.status,"failed");assert.equal(calls,1);
      const checkpoint=f.checkpoint();assert.equal(checkpoint.scenePolicyStopSummary,undefined);assert.equal(checkpoint.generationReceipt.actual_provider_call_count,1);
      assert.equal(checkpoint.generationReceipt.provider_request_status,"submitted");assert.equal(checkpoint.generationReceipt.source_transmission_status,"transmitted");
      assert.equal(JSON.parse(policyWitnessRow(f).private_json).scene_policy_stop,undefined);
      assert.equal((await f.preview()).body.sceneCostExisting.safeUnused,null);
    }finally{f.close();}
  });
}

for(const mode of ["manual","managed"]){
  test(mode+" unknown provider submission cannot become a policy-stop continuation",async t=>{
    let f;const calls=scenePilotProvider(t,{uncertainAt:mode==="manual"?1:2,beforeReply(index){if(index===(mode==="manual"?1:2))f.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run(f.cohort.cohortId);}});
    f=await createPilotSceneFixture({mode,count:mode==="manual"?1:9});
    try{
      await f.admit();await f.run();assert.equal(f.cost()[0].status,"executing");assert.equal(f.checkpoint().scenePolicyStopSummary,undefined);
      assert.equal(Object.values(f.checkpoint().providerSubmissions).filter(value=>value.status==="pending").length,1);
      const before=policyFinancialSnapshot(f),row=policyOriginalRow(f),read=await f.preview();assert.equal(read.response.status,200);assert.equal(read.body.sceneCostExisting.safeUnused,null);
      assert.deepEqual(policyFinancialSnapshot(f),before);assert.deepEqual(policyOriginalRow(f),row);assert.equal(calls.length,mode==="manual"?1:2);
    }finally{f.close();}
  });
}

const contradictions=[
  ["missing native witness",f=>updatePolicyWitness(f,p=>{delete p.scene_policy_stop;})],
  ["caller-looking witness",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop={code:"scene_paid_authority_changed",used_tokens:0,used_microusd:0};})],
  ["unknown witness version",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.version="caller-stop-v9";})],
  ["extra witness field",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.trustMe=true;})],
  ["wrong original job",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.job_id="another-original";})],
  ["wrong original attempt",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.attempt_correlation_id=f.requestId+":attempt:0";})],
  ["wrong actor",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.actor_user_id="other-actor";})],
  ["wrong document",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.document_id="another-document";})],
  ["wrong project",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.project_id="another-project";})],
  ["different binding",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.binding_hash="0".repeat(64);})],
  ["different current source",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.source_hash="0".repeat(64);})],
  ["different human request",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.request_hash="0".repeat(64);})],
  ["wrong stopped unit",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.client_request_id="not-this-stopped-call";})],
  ["wrong stage",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.stage="before-pending";})],
  ["wrong original cost ledger",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.cost_reservation_id="missing-ledger";})],
  ["wrong billed cohort",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.pilot_cohort_id="different-cohort";})],
  ["wrong custody",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.organization_id="different-organization";})],
  ["unparseable stop time",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.stopped_at="not-an-instant";})],
  ["stop predates execution",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.stopped_at="2000-01-01T00:00:00.000Z";})],
  ["future stop time",f=>updatePolicyWitness(f,p=>{p.scene_policy_stop.stopped_at="2999-01-01T00:00:00.000Z";})],
  ["redacted audit",f=>f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),policyWitnessRow(f).private_event_id)],
  ["additional user-produced audit",f=>copyAudit(f,{actor:"user:"+f.actorUserId})],
  ["additional wrong audit client",f=>copyAudit(f,{client_id:"client:forged"})],
  ["additional wrong audit causation",f=>copyAudit(f,{causation_id:null})],
  ["foreign private audit custody",f=>f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='another-owner' WHERE private_event_id=?").run(policyWitnessRow(f).private_event_id)],
  ["missing submission protocol",f=>updatePolicyCheckpoint(f,c=>{delete c.providerSubmissionProtocol;})],
  ["null submission map",f=>updatePolicyCheckpoint(f,c=>{c.providerSubmissions=null;})],
  ["array submission map",f=>updatePolicyCheckpoint(f,c=>{c.providerSubmissions=[];})],
  ["malformed extra observer",f=>updatePolicyCheckpoint(f,c=>{c.providerSubmissions.malformed=null;})],
  ["legacy uncertainty",f=>updatePolicyCheckpoint(f,c=>{c.providerSubmissionLegacyUncertain=true;})],
  ...["pending","accepted","completed"].map(status=>["stopped unit became "+status,f=>updatePolicyCheckpoint(f,c=>{Object.values(c.providerSubmissions)[0].status=status;})]),
  ["rejected provider response ID",f=>updatePolicyCheckpoint(f,c=>{Object.values(c.providerSubmissions)[0].providerRequestId="provider-really-replied";})],
  ["rejected positive cost",f=>updatePolicyCheckpoint(f,c=>{Object.values(c.providerSubmissions)[0].costMicrousd=1400;})],
  ["rejected missing exact cost",f=>updatePolicyCheckpoint(f,c=>{delete Object.values(c.providerSubmissions)[0].costMicrousd;})],
  ["unknown receipt cost",f=>updatePolicyCheckpoint(f,c=>{c.generationReceipt.settled_cost_microusd=null;})],
  ["positive receipt cost",f=>updatePolicyCheckpoint(f,c=>{c.generationReceipt.settled_cost_microusd=1;})],
  ["unknown original call count",f=>updatePolicyCheckpoint(f,c=>{c.generationReceipt.actual_provider_call_count=null;})],
  ["positive original call count",f=>updatePolicyCheckpoint(f,c=>{c.generationReceipt.actual_provider_call_count=1;})],
  ["transmitted source",f=>updatePolicyCheckpoint(f,c=>{c.generationReceipt.source_transmission_status="transmitted";})],
  ["unknown submission receipt",f=>updatePolicyCheckpoint(f,c=>{c.generationReceipt.provider_request_status="submission_unknown";})],
  ["planner response",f=>updatePolicyCheckpoint(f,c=>{c.plannerResponseId="known-response";})],
  ["zero-looking planner usage",f=>updatePolicyCheckpoint(f,c=>{c.plannerUsage={inputTokens:0,outputTokens:0,totalTokens:0};})],
  ["new active lease",f=>f.sqlite.prepare("UPDATE document_jobs SET lease_expires_at=? WHERE job_id=?").run(new Date(Date.now()+60000).toISOString(),f.requestId)],
  ["later attempt count",f=>f.sqlite.prepare("UPDATE document_jobs SET attempt_count=2 WHERE job_id=?").run(f.requestId)],
  ["different failure cause",f=>f.sqlite.prepare("UPDATE document_jobs SET error_message='operator-forced-failure' WHERE job_id=?").run(f.requestId)],
  ["unconfirmed original approval",f=>f.sqlite.prepare("UPDATE document_jobs SET request_json=json_set(request_json,'$.sceneCostConsent.confirmed',json('false')) WHERE job_id=?").run(f.requestId)],
  ["missing retained private binding",f=>f.sqlite.prepare("UPDATE private_content SET content=json_remove(content,'$.scene_cost_binding_hash') WHERE content_id=?").run(sourceReceipt(f).content_id)],
  ["changed original private input",f=>f.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.document_snapshot.facts[0].properties.text','Replaced') WHERE content_id=?").run(sourceReceipt(f).content_id)],
  ["expired original private input",f=>f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00Z' WHERE content_id=?").run(sourceReceipt(f).content_id)],
  ["redacted original private input",f=>f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(),sourceReceipt(f).content_id)],
  ["changed native managed plan",f=>updatePolicyCheckpoint(f,c=>{c.productionPlan.scenes[0].action="Changed";})],
  ["unknown existing private input",f=>f.sqlite.prepare("UPDATE document_jobs SET request_json='{}' WHERE job_id=?").run(f.requestId)],
  ["erased expired private detail",f=>f.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00Z',request_json='{}',result_json=NULL WHERE job_id=?").run(f.requestId)],
];
test("safe-unused policy proof requires every original canonical witness and receipt term",async t=>{
  noProvider(t);const f=await createPolicyStoppedSceneFixture();
  try{
    await unchangedRead(f);
    for(const [name,change] of contradictions)await t.test(name,()=>caseTransaction(f,async()=>{await change(f);await unchangedRead(f,false);}));
    await unchangedRead(f);
  }finally{f.close();}
});


test("native canonical audit fields cannot be replaced by incoming-looking stop metadata",async t=>{
  noProvider(t);const f=await createPolicyStoppedSceneFixture();
  try{
    const eventId=policyWitnessRow(f).private_event_id;
    for(const column of ["actor","client_id","causation_id"])assert.throws(()=>f.sqlite.prepare("UPDATE events SET "+column+"='forged' WHERE event_id=?").run(eventId),/events are append-only/u);
    await unchangedRead(f);
  }finally{f.close();}
});

test("complete all-attempt token/cost/audit families cannot hide earlier or foreign evidence",async t=>{
  noProvider(t);const f=await createPolicyStoppedSceneFixture();
  try{
    for(const table of ["budget_reservations","cost_budget_reservations"]){
      const unit=table==="budget_reservations"?"tokens":"microusd";
      for(const status of ["reserved","executing","settled"])await t.test(table+" "+status,()=>caseTransaction(f,async()=>{
        f.sqlite.prepare("UPDATE "+table+" SET status=? WHERE reservation_id=?").run(status,f.checkpoint()[unit==="tokens"?"reservationId":"costReservationId"]);await unchangedRead(f,false);
      }));
      for(const field of ["owner_id","stream_id","correlation_id","period"])await t.test(table+" changed "+field,()=>caseTransaction(f,async()=>{
        f.sqlite.prepare("UPDATE "+table+" SET "+field+"='foreign-or-old' WHERE reservation_id=?").run(f.checkpoint()[unit==="tokens"?"reservationId":"costReservationId"]);await unchangedRead(f,false);
      }));
      await t.test(table+" used positive",()=>caseTransaction(f,async()=>{f.sqlite.prepare("UPDATE "+table+" SET used_"+unit+"=1").run();await unchangedRead(f,false);}));
      await t.test(table+" missing original",()=>caseTransaction(f,async()=>{f.sqlite.prepare("DELETE FROM "+table).run();await unchangedRead(f,false);}));
      for(const suffix of ["",":attempt:0",":attempt:9",":unrecognized:future"])await t.test(table+" extra foreign "+(suffix||"original"),()=>caseTransaction(f,async()=>{
        copyLedger(f,table,{correlation_id:f.requestId+suffix,owner_id:"different-owner",stream_id:"creative:different-owner",status:"released",["used_"+unit]:0});
        await unchangedRead(f,false);
      }));
    }
    for(const type of ["GenerationUsageRecorded","JobAttemptInterrupted","BudgetReleased"])await t.test("older "+type+" without current matching ledger",()=>caseTransaction(f,async()=>{
      copyAudit(f,{type,correlation_id:f.requestId+":attempt:0"});await unchangedRead(f,false);
    }));
    for(const table of ["project_budget_reservation_scopes","pilot_cost_reservation_scopes"])await t.test("missing exact "+table,()=>caseTransaction(f,async()=>{
      f.sqlite.prepare("DELETE FROM "+table).run();await unchangedRead(f,false);
    }));
    await unchangedRead(f);
  }finally{f.close();}
});

test("incoming markers/receipts are rejected, including an internal-looking user event",async t=>{
  noProvider(t);const f=await createPolicyStoppedSceneFixture();
  try{
    const certificate=f.checkpoint().scenePolicyStopSummary,witness=JSON.parse(policyWitnessRow(f).private_json).scene_policy_stop;
    for(const key of ["scenePolicyStopSummary","scenePolicyStop","scenePolicyStopWitness","scene_policy_stop","safeUnused","generationReceipt","generation_receipt"]){
      for(const existing of [false,true])await t.test(key+(existing?" existing":" fresh"),async()=>{
        const before=f.counts(),finance=policyFinancialSnapshot(f),id=existing?f.requestId:"forged-scene-"+crypto.randomUUID();
        const read=await f.preview({sceneRequestId:id,[key]:certificate});assert.equal(read.response.status,400);assert.equal(read.body.error,"scene_policy_stop_server_owned");
        const submit=await f.approve(f.originalPreview,{sceneRequestId:id,[key]:certificate});assert.equal(submit.response.status,400);
        assert.deepEqual(f.counts(),before);assert.deepEqual(policyFinancialSnapshot(f),finance);
      });
    }
    assert.equal(presentationServerOwnedCheckpointField({scenePolicyStopSummary:certificate}),"scenePolicyStopSummary");
    const legacy={scenePolicyStopSummary:certificate,artifactKind:"scene",audience:"Preserved"};clearPresentationServerOwnedCheckpointFields(legacy);assert.deepEqual(legacy,{artifactKind:"scene",audience:"Preserved"});
    const before=f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BudgetReleased'").get().n;
    const forged=await f.request("/api/events",f.json({action:"batch",actor:"worker:policy",clientId:"server:document-job:render_document",correlationId:"forged-outside-original",
      events:[{actor:"worker:policy",type:"BudgetReleased",payload:{artifact_kind:"scene",job_id:f.requestId,document_id:f.documentId,project_id:f.projectId,scene_policy_stop:witness}}]}));
    const body=await forged.json();assert.ok(forged.status>=400||body.rejected?.some(value=>value.reason==="event_not_permitted_for_user"),JSON.stringify(body));
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BudgetReleased'").get().n,before);
    await unchangedRead(f);
  }finally{f.close();}
});

for(const mutation of ["row-attempt","row-lease","row-request","row-status","private-input","witness","token-ledger","cost-ledger","older-audit","authority","selected-context","custody"]){
  test("free policy proof final snapshot rejects "+mutation+" after preparation",async t=>{
    noProvider(t);const f=await createPolicyStoppedSceneFixture();let seen=false;
    try{
      f.controls.beforeRead=async statement=>{
        if(seen||!policyFinalRead(statement))return;seen=true;
        if(mutation==="row-attempt")f.sqlite.prepare("UPDATE document_jobs SET attempt_count=2 WHERE job_id=?").run(f.requestId);
        else if(mutation==="row-lease")f.sqlite.prepare("UPDATE document_jobs SET lease_expires_at=? WHERE job_id=?").run(new Date(Date.now()+60000).toISOString(),f.requestId);
        else if(mutation==="row-request")f.sqlite.prepare("UPDATE document_jobs SET request_json=request_json||' ' WHERE job_id=?").run(f.requestId);
        else if(mutation==="row-status")f.sqlite.prepare("UPDATE document_jobs SET status='running' WHERE job_id=?").run(f.requestId);
        else if(mutation==="private-input")f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(sourceReceipt(f).content_id);
        else if(mutation==="witness")updatePolicyWitness(f,p=>{p.scene_policy_stop.used_tokens=1;});
        else if(mutation==="token-ledger")f.sqlite.prepare("UPDATE budget_reservations SET used_tokens=1").run();
        else if(mutation==="cost-ledger")f.sqlite.prepare("UPDATE cost_budget_reservations SET used_microusd=1").run();
        else if(mutation==="older-audit")copyAudit(f,{type:"GenerationUsageRecorded",correlation_id:f.requestId+":attempt:0"});
        else if(mutation==="authority")f.sqlite.prepare("UPDATE users SET updated_at='2999-01-01T00:00:00Z' WHERE user_id=?").run(f.actorUserId);
        else if(mutation==="selected-context")f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),f.contextId);
        else f.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id='different-owner' WHERE resource_kind='content' AND resource_id=?").run(sourceReceipt(f).content_id);
      };
      const writes=f.controls.writes.length,result=await f.preview();assert.equal(seen,true);assert.ok(result.response.status>=400,JSON.stringify(result.body));
      assert.equal(result.body.sceneCostExisting,undefined);assert.equal(f.controls.writes.length,writes);
    }finally{f.close();}
  });
}

for(const boundary of ["proof-ttl","selected-authority","month"]){
  test("policy proof "+boundary+" expiry after the final SQL await cannot enable New",async t=>{
    noProvider(t);const f=await createPolicyStoppedSceneFixture();let seen=false;
    try{
      const now=Date.now();
      f.controls.afterRead=async(statement,value)=>{
        if(seen||!policyFinalRead(statement))return;seen=true;assert.equal(value.current,1);
        const next=boundary==="selected-authority"?Date.parse(f.sqlite.prepare("SELECT expires_at FROM project_context_sessions WHERE context_id=?").get(f.contextId).expires_at)+1:
          boundary==="month"?Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()+1,1):now+60000;
        t.mock.method(Date,"now",()=>next);
      };
      const before=policyFinancialSnapshot(f),result=await f.preview();assert.equal(seen,true);
      assert.ok(result.response.status>=400||result.body.sceneCostExisting?.safeUnused===null);assert.deepEqual(policyFinancialSnapshot(f),before);
    }finally{f.close();}
  });
}

for(const change of ["row-attempt","row-lease","row-request","audit","ledger"]){
  test("terminal historical certificate CAS includes "+change+" through the last await",async t=>{
    noProvider(t);const f=await createPilotSceneFixture();let mutated=false,stopped=false;
    try{
      await f.admit();const pause=policyMutation(f,()=>setPolicyCohort(f,"paused")),observe=f.controls.beforeRun;
      f.controls.beforeRun=async statement=>{
        await observe(statement);stopped=pause.changed;
        if(mutated||!statement.sql.startsWith("UPDATE document_jobs SET result_json=")||!statement.sql.includes("json_array(job_id,owner_id")||!statement.sql.includes("project_budget_reservation_scopes"))return;
        mutated=true;
        if(change==="row-attempt")f.sqlite.prepare("UPDATE document_jobs SET attempt_count=2 WHERE job_id=?").run(f.requestId);
        else if(change==="row-lease")f.sqlite.prepare("UPDATE document_jobs SET lease_expires_at=? WHERE job_id=?").run(new Date(Date.now()+60000).toISOString(),f.requestId);
        else if(change==="row-request")f.sqlite.prepare("UPDATE document_jobs SET request_json=request_json||' ' WHERE job_id=?").run(f.requestId);
        else if(change==="audit")updatePolicyWitness(f,p=>{delete p.scene_policy_stop;});
        else f.sqlite.prepare("UPDATE cost_budget_reservations SET used_microusd=1").run();
      };
      await f.run();assert.equal(stopped,true);assert.equal(mutated,true);assert.equal(f.checkpoint().scenePolicyStopSummary,undefined);
      assert.notEqual(f.checkpoint().generationReceipt.actual_provider_call_count,0);
      const result=await f.preview();assert.ok(result.response.status>=400||result.body.sceneCostExisting?.safeUnused===null);
    }finally{f.close();}
  });
}

test("historical summary is not current safe-unused authority and never removes the raw local observation",async t=>{
  noProvider(t);const f=await createPolicyStoppedSceneFixture({pilot:false,shared:false,
    mutate(f){f.sqlite.prepare("UPDATE budget_counters SET hard_limit_tokens=1 WHERE scope='user' AND scope_id=?").run(f.actorUserId);}});
  try{
    const original=policyOriginalRow(f),raw=JSON.stringify(f.checkpoint().providerSubmissions);
    updatePolicyWitness(f,p=>{delete p.scene_policy_stop;});
    const detail=await (await f.request("/api/document-jobs/"+f.requestId)).json();exactReceipt(detail.job.result.generationReceipt,0);
    const current=await f.preview();assert.equal(current.response.status,200);assert.equal(current.body.sceneCostExisting.safeUnused,null);
    assert.equal(JSON.stringify(f.checkpoint().providerSubmissions),raw);assert.deepEqual(policyOriginalRow(f),original);
  }finally{f.close();}
});

test("summary certificate requires original server row/receipt/unit and cannot suppress other paid or unknown submissions",async t=>{
  noProvider(t);const f=await createPolicyStoppedSceneFixture();
  try{
    const input=f.checkpoint(),identity=originContext(f),failure=input.errorDetail,original=JSON.stringify(input);
    assert.equal(generationExecutionSummary(input,failure).actual_provider_call_count,1,"a bare marker is not enough without actual server row context");
    assert.equal(generationExecutionSummary(input,failure,identity).actual_provider_call_count,0);
    for(const change of [
      context=>{context.jobId="other";},context=>{context.correlationId=f.requestId+":attempt:2";},context=>{context.attemptCount=2;},context=>{context.status="running";},context=>{context.bindingHash="0".repeat(64);},
    ]){const altered={...identity};change(altered);assert.equal(generationExecutionSummary(input,failure,altered).actual_provider_call_count,1);}
    for(const change of [
      c=>{delete c.scenePolicyStopSummary;},c=>{c.scenePolicyStopSummary=true;},c=>{c.scenePolicyStopSummary.extra=1;},c=>{c.scenePolicyStopSummary.version="caller";},
      c=>{c.scenePolicyStopSummary.input_ref="other";},c=>{c.scenePolicyStopSummary.source_snapshot_sha256="0".repeat(64);},c=>{c.scenePolicyStopSummary.stopped_client_request_id="other";},
      c=>{c.scenePolicyStopSummary.evidence_sha256="not-a-digest";},c=>{Object.values(c.providerSubmissions)[0].providerRequestId="real-provider-response";},
    ]){const altered=structuredClone(input);change(altered);assert.equal(generationExecutionSummary(altered,failure,identity).actual_provider_call_count,1);}
    for(const status of ["pending","accepted","completed"]){
      const altered=structuredClone(input);altered.providerSubmissions.additional={clientRequestId:"additional",provider:"openai",operation:"planning",model:input.generationReceipt.model,status,
        ...(status==="completed"?{providerRequestId:"additional-paid",costMicrousd:1400,inputTokens:100,outputTokens:100,totalTokens:200}:{})};
      const summary=generationExecutionSummary(altered,failure,identity);
      assert.equal(summary.actual_provider_call_count,status==="pending"?0:1);
      if(status==="pending"){assert.equal(summary.unresolved_provider_call_count,1);assert.equal(summary.provider_submission_uncertain,true);assert.equal(summary.provider_request_status,"submission_unknown");assert.equal(summary.source_transmission_status,"unknown");}
      else{assert.equal(summary.provider_request_status,"submitted");assert.equal(summary.source_transmission_status,"transmitted");}
      if(status!=="completed"){assert.equal(summary.settled_cost_microusd,null);assert.notEqual(summary.reservation_status,"released");}
    }
    for(const malformed of [null,{clientRequestId:"additional",status:"made-up"},{clientRequestId:"additional",provider:"openai",operation:"planning",model:input.generationReceipt.model,status:"made-up"}]){
      const altered=structuredClone(input);altered.providerSubmissions.additional=malformed;
      const summary=generationExecutionSummary(altered,failure,identity);assert.equal(summary.provider_submission_uncertain,true);assert.equal(summary.provider_request_status,"submission_unknown");
      assert.equal(summary.settled_cost_microusd,null);assert.notEqual(summary.reservation_status,"released");
      assert.equal(summary.actual_provider_call_count,0);assert.equal(summary.actual_planner_call_count,0);assert.equal(summary.source_transmission_status,"unknown");assert.equal(summary.unresolved_provider_call_count,null);
      altered.providerSubmissions["known-pending"]={clientRequestId:"known-pending",provider:"openai",operation:"planning",model:input.generationReceipt.model,status:"pending"};
      const mixed=generationExecutionSummary(altered,failure,identity);assert.equal(mixed.actual_provider_call_count,0);assert.equal(mixed.source_transmission_status,"unknown");assert.equal(mixed.unresolved_provider_call_count,null);assert.equal(mixed.provider_submission_uncertain,true);
    }
    const legacy=structuredClone(input);legacy.providerSubmissionLegacyUncertain=true;
    assert.equal(generationExecutionSummary(legacy,failure,identity).provider_submission_uncertain,true);
    const typedOnly=structuredClone(input);delete typedOnly.scenePolicyStopSummary;
    assert.equal(generationExecutionSummary(typedOnly,failure,identity).actual_provider_call_count,1);
    assert.equal(JSON.stringify(input),original);
  }finally{f.close();}
});


test("an actual completed zero-token provider call remains transmitted and cannot become unused",async t=>{
  const calls=scenePilotProvider(t),send=globalThis.fetch;
  t.mock.method(globalThis,"fetch",async(...args)=>{const response=await send(...args),body=await response.json();body.usage={input_tokens:0,output_tokens:0,total_tokens:0};return Response.json(body);});
  const f=await createPolicyStoppedSceneFixture({at:2});
  try{
    assert.equal(calls.length,1);exactReceipt(f.checkpoint().generationReceipt,1,0);
    assert.equal(f.cost()[0].status,"released");assert.equal(f.cost()[0].used_microusd,0);assert.equal(f.tokens()[0].used_tokens,0);
    await unchangedRead(f,false);
    assert.equal(Object.values(f.checkpoint().providerSubmissions).filter(value=>value.status==="completed").length,1);
  }finally{f.close();}
});


test("malformed and known-pending evidence preserves an earlier real paid response and settled amount",async t=>{
  const calls=scenePilotProvider(t),f=await createPolicyStoppedSceneFixture({at:2});
  try{
    assert.equal(calls.length,1);const input=f.checkpoint(),before=JSON.stringify(input),identity=originContext(f);
    const altered=structuredClone(input);
    altered.providerSubmissions["known-pending"]={clientRequestId:"known-pending",provider:"openai",operation:"planning",model:input.generationReceipt.model,status:"pending"};
    altered.providerSubmissions["malformed"]={clientRequestId:"malformed",provider:"openai",operation:"planning",model:input.generationReceipt.model,status:"made-up"};
    const summary=generationExecutionSummary(altered,altered.errorDetail,identity);
    assert.equal(summary.actual_provider_call_count,1);assert.equal(summary.actual_planner_call_count,1);assert.equal(summary.source_transmission_status,"transmitted");
    assert.equal(summary.provider_request_status,"submission_unknown");assert.equal(summary.unresolved_provider_call_count,null);assert.equal(summary.provider_submission_uncertain,true);
    assert.equal(summary.settled_cost_microusd,1400);assert.equal(summary.reservation_status,"unknown");
    assert.equal(f.cost()[0].used_microusd,1400);assert.equal(f.tokens()[0].used_tokens,200);assert.equal(JSON.stringify(input),before);
  }finally{f.close();}
});

test("policy-stop proof fixtures execute real SQL within D1 depth100 and100 bindings",()=>{
  assert.ok(sceneCostFixtureProof.fixtures>0);assert.ok(sceneCostFixtureProof.nativeQueries.size>0);assert.ok(sceneCostFixtureProof.maximumBindings<=100);
  console.log("Scene policy-stop native D1 proof",JSON.stringify({fixtures:sceneCostFixtureProof.fixtures,queries:sceneCostFixtureProof.nativeQueries.size,maximumBindings:sceneCostFixtureProof.maximumBindings}));
});
