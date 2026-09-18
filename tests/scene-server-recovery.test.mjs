import assert from "node:assert/strict";
import test from "node:test";
import { createUnusedSceneFixture } from "./helpers/scene-unused-fixture.mjs";
import { createSceneCostFixture, sceneCostFixtureProof } from "./helpers/scene-cost-fixture.mjs";
import { isSceneSafeUnusedProof } from "../src/model/scene-cost-consent.ts";
import { appendAuditEvent } from "../worker/runtime.ts";
import { reserveBudget, reserveCostBudget, claimCostBudgetReservation, settleBudget, settleCostBudget, releaseBudget, releaseCostBudget } from "../worker/pilot-policy.ts";

const noProvider=t=>t.mock.method(globalThis,"fetch",async()=>{assert.fail("Scene inspection/continuation must not contact a provider");});
const financialSnapshot=f=>Object.fromEntries(["budget_reservations","cost_budget_reservations","budget_counters","cost_budget_counters"].map(table=>[table,f.sqlite.prepare("SELECT * FROM "+table+" ORDER BY rowid").all()]));
const exactProof=(f,result)=>{
  assert.equal(result.response.status,200,JSON.stringify(result.body));
  const existing=result.body.sceneCostExisting,proof=existing.safeUnused,job=result.body.job;
  assert.equal(existing.requestId,f.requestId);assert.equal(job.jobId,f.requestId);assert.ok(isSceneSafeUnusedProof(proof));
  assert.equal(proof.requestId,f.requestId);assert.equal(proof.actorUserId,f.owner);assert.equal(proof.projectId,f.projectId);assert.equal(proof.documentId,f.documentId);
  assert.equal(proof.bindingHash,f.originalPreview.bindingHash);assert.equal(existing.preview.bindingHash,f.originalPreview.bindingHash);
  assert.equal(proof.jobStatus,job.status);assert.equal(proof.jobUpdatedAt,job.updatedAt);assert.equal(proof.attemptCount,job.attemptCount);assert.equal(job.leaseExpiresAt,null);
  assert.doesNotMatch(JSON.stringify(proof),/keeper|harbor|facts|snapshot|reservationId|content_ref/u);
  return proof;
};
const finalProofRead=statement=>statement.sql.startsWith("SELECT 1 AS current WHERE")&&statement.sql.includes("json_array(job_id,owner_id")&&statement.sql.includes("json_group_array(json_array(event_id")&&statement.sql.includes("NOT EXISTS(SELECT 1 FROM budget_reservations");
async function reserveOriginal(f,{cost=false,correlation=f.requestId,used=false,foreign=false}={}){
  const context={streamId:f.streamId,correlationId:correlation,operation:"document-render:scene"};
  if(cost){
    const result=await reserveCostBudget(f.env,f.owner,10_000,{...context,reservationId:"unused-cost-"+crypto.randomUUID(),maximumMicrousd:10_000,allowUserOverage:false});
    assert.equal(result.ok,true);assert.equal(await claimCostBudgetReservation(f.env,f.owner,result.reservationId),true);
    if(used)await settleCostBudget(f.env,f.owner,result.reservationId,1_400);
    if(foreign)f.sqlite.prepare("UPDATE cost_budget_reservations SET owner_id='foreign-ledger-owner',stream_id='creative:foreign-ledger-owner' WHERE reservation_id=?").run(result.reservationId);
  }else{
    const result=await reserveBudget(f.env,f.owner,1000,context);assert.equal(result.ok,true);
    if(used)await settleBudget(f.env,f.owner,result.reservationId,150);
    if(foreign)f.sqlite.prepare("UPDATE budget_reservations SET owner_id='foreign-ledger-owner',stream_id='creative:foreign-ledger-owner' WHERE reservation_id=?").run(result.reservationId);
  }
}

for(const shared of [false,true])for(const medium of ["visual","audio"])for(const reason of ["cancel","source-expired"]){
  test((shared?"shared":"personal")+" "+medium+" "+reason+" proves original unused before explicit new quote and separate approval",async t=>{
    noProvider(t);const f=await createUnusedSceneFixture({shared,medium,reason});
    try{
      const original=f.originalRow(),finance=financialSnapshot(f),writes=f.controls.writes.length;
      const proof=exactProof(f,await f.preview({audience:"A deliberately changed audience"}));
      assert.equal(proof.reason,reason==="cancel"?"canceled-before-start":"source-unavailable-before-dispatch");
      assert.equal(proof.contextSessionId,f.sharing?.contextId??null);assert.equal(f.controls.writes.length,writes);
      assert.deepEqual(f.originalRow(),original);assert.deepEqual(financialSnapshot(f),finance);
      assert.equal(f.checkpoint().generationReceipt.actual_provider_call_count,null,"null historical call counts are not rewritten as zero");
      const repeated=await f.approve(f.originalPreview);assert.equal(repeated.body.job.jobId,f.requestId);assert.equal(repeated.body.sceneCostExisting.safeUnused,null,"approval retries do not issue continuation permission");
      f.repairSource();if(shared)await f.request("/api/events?after=0&limit=2000&content=0");
      const nextId="explicit-next-"+crypto.randomUUID(),changed={sceneRequestId:nextId,audience:"A deliberately changed audience"};
      const next=await f.preview(changed);assert.equal(next.response.status,200,JSON.stringify(next.body));assert.equal(next.body.sceneCostPreview.requestId,nextId);
      assert.equal(f.counts().document_jobs,1,"free new preparation cannot create a second job");
      assert.notEqual(next.body.sceneCostPreview.bindingHash,f.originalPreview.bindingHash);
      const staleApproval=await f.approve(f.originalPreview,changed);assert.ok(staleApproval.response.status>=400);assert.equal(f.counts().document_jobs,1);
      const approved=await f.approve(next.body.sceneCostPreview,changed);assert.equal(approved.response.status,202,JSON.stringify(approved.body));assert.equal(approved.body.job.jobId,nextId);
      assert.equal(f.counts().document_jobs,2);assert.deepEqual(f.originalRow(),original);assert.deepEqual(financialSnapshot(f),finance);
    }finally{f.close();}
  });
}

test("cookie-free tenant owner retains exact custody through one admission, anchor and original inspection",async t=>{
  noProvider(t);const f=await createSceneCostFixture(9,"audio",{shared:true,depth:true});
  try{
    await f.request("/api/events?after=0&limit=2000&content=0");f.setScopedHeaders({});
    const before=financialSnapshot(f),inspected=await f.preview();assert.equal(inspected.response.status,200,JSON.stringify(inspected.body));
    assert.equal(inspected.body.sceneCostPreview.contextSessionId,null);assert.deepEqual(financialSnapshot(f),before);
    const admitted=await f.approve(inspected.body.sceneCostPreview);assert.equal(admitted.response.status,202,JSON.stringify(admitted.body));
    const admittedFinance=financialSnapshot(f);
    for(const table of ["budget_counters","cost_budget_counters"]){
      for(const row of before[table])assert.deepEqual(admittedFinance[table].find(candidate=>candidate.scope===row.scope&&candidate.scope_id===row.scope_id&&candidate.period===row.period),row);
      for(const row of admittedFinance[table])assert.equal(table==="budget_counters"?row.used_tokens+row.reserved_tokens:row.used_microusd+row.reserved_microusd,0,"lazy tenant policy rows do not reserve or spend");
    }
    assert.deepEqual(admittedFinance.budget_reservations,[]);assert.deepEqual(admittedFinance.cost_budget_reservations,[]);
    const resource=f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?").get(f.requestId);
    assert.equal(resource.project_access_id,f.sharing.projectAccessId);assert.equal(resource.organization_id,f.sharing.organizationId);assert.equal(resource.project_id,f.projectId);
    assert.equal(resource.owner_user_id,f.owner);assert.equal(resource.actor_user_id,f.owner);assert.equal(resource.visibility,"actor_private");
    const anchor=f.sqlite.prepare("SELECT type,actor,payload FROM events WHERE event_id=?").get(resource.source_event_id);
    assert.equal(anchor.type,"ProjectDocumentJobQueued");assert.equal(anchor.actor,"user:"+f.owner);assert.equal(JSON.parse(anchor.payload).job_id,f.requestId);
    const original=f.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(f.requestId),writes=f.controls.writes.length;
    const existing=await f.preview({audience:"Changed but not purchased"});assert.equal(existing.response.status,200,JSON.stringify(existing.body));
    assert.equal(existing.body.job.jobId,f.requestId);assert.equal(existing.body.sceneCostExisting.preview.bindingHash,inspected.body.sceneCostPreview.bindingHash);assert.equal(existing.body.sceneCostExisting.safeUnused,null);
    assert.equal(existing.body.job.result.generationReceipt,undefined,"tenant receipt remains actor-private behind the explicit receipt path");
    assert.equal(f.controls.writes.length,writes);assert.deepEqual(financialSnapshot(f),admittedFinance);assert.equal(f.counts().document_jobs,1);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(f.requestId),original);
    const repeat=await f.approve(inspected.body.sceneCostPreview);assert.equal(repeat.response.status,202);assert.equal(repeat.body.job.jobId,f.requestId);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?").get(f.requestId).count,1);
  }finally{f.close();}
});

test("cookie-free current owner may read a genuinely canceled tenant original without a selected-session fiction",async t=>{
  noProvider(t);const f=await createUnusedSceneFixture({shared:true});
  try{
    f.setScopedHeaders({});const proof=exactProof(f,await f.preview());
    assert.equal(proof.contextSessionId,null);assert.notEqual(f.originalPreview.contextSessionId,null);
  }finally{f.close();}
});

const contradicted=[
  ["missing submission protocol",f=>f.updateCheckpoint(c=>{delete c.providerSubmissionProtocol;})],
  ["null submission protocol",f=>f.updateCheckpoint(c=>{c.providerSubmissionProtocol=null;})],
  ["future unrecognized protocol",f=>f.updateCheckpoint(c=>{c.providerSubmissionProtocol=2;})],
  ["missing provider map",f=>f.updateCheckpoint(c=>{delete c.providerSubmissions;})],
  ["null provider map",f=>f.updateCheckpoint(c=>{c.providerSubmissions=null;})],
  ["array provider map",f=>f.updateCheckpoint(c=>{c.providerSubmissions=[];})],
  ["malformed provider map",f=>f.updateCheckpoint(c=>{c.providerSubmissions={unparseable:null};})],
  ...["pending","accepted","completed","rejected"].map(status=>["nonempty "+status+" provider evidence",f=>f.updateCheckpoint(c=>{c.providerSubmissions={original:{clientRequestId:"original",provider:"openai",operation:"planning",model:"gpt-5.6-terra",status,costMicrousd:0}};})]),
  ["legacy uncertainty",f=>f.updateCheckpoint(c=>{c.providerSubmissionLegacyUncertain=true;})],
  ["known planner response",f=>f.updateCheckpoint(c=>{c.plannerResponseId="already-received";})],
  ["zero-looking planner accounting",f=>f.updateCheckpoint(c=>{c.plannerUsage={totalTokens:0};})],
  ["missing referenced ledger",f=>f.updateCheckpoint(c=>{c.costReservationId="missing-old-ledger";})],
  ["positive historical call count",f=>f.updateCheckpoint(c=>{c.generationReceipt.actual_provider_call_count=1;})],
  ["missing historical call field",f=>f.updateCheckpoint(c=>{delete c.generationReceipt.actual_provider_call_count;})],
  ["submitted receipt",f=>f.updateCheckpoint(c=>{c.generationReceipt.provider_request_status="submitted";})],
  ["unknown transmission",f=>f.updateCheckpoint(c=>{c.generationReceipt.source_transmission_status="unknown";})],
  ["unknown settled cost",f=>f.updateCheckpoint(c=>{c.generationReceipt.settled_cost_microusd=null;})],
  ["positive settled cost",f=>f.updateCheckpoint(c=>{c.generationReceipt.settled_cost_microusd=1;})],
  ["reported execution hold",f=>f.updateCheckpoint(c=>{c.generationReceipt.reservation_status="executing";})],
  ["active lease on terminal row",f=>f.sqlite.prepare("UPDATE document_jobs SET lease_expires_at=? WHERE job_id=?").run(new Date(Date.now()+60_000).toISOString(),f.requestId)],
  ["older attempt history",f=>f.sqlite.prepare("UPDATE document_jobs SET attempt_count=2 WHERE job_id=?").run(f.requestId)],
  ["started canceled job",f=>f.sqlite.prepare("UPDATE document_jobs SET started_at=requested_at WHERE job_id=?").run(f.requestId)],
  ["different cancellation cause",f=>f.sqlite.prepare("UPDATE document_jobs SET error_message='force_failed_by_admin' WHERE job_id=?").run(f.requestId)],
  ["native cancellation with failed audit persistence",()=>{}, {beforeTerminal:f=>{f.controls.beforeBatch=async statements=>{if(statements.some(statement=>statement.sql.includes("INSERT INTO event_write_stage")&&statement.values[11]==="JobCanceled"))throw new Error("in-memory cancellation audit unavailable");};}}],
  ["contradictory cancellation actor audit",f=>appendAuditEvent(f.env,f.streamId,"user:someone-else","JobCanceled",{job_id:f.requestId,document_id:f.documentId,kind:"render_document",previous_status:"queued",released_reservation_count:0,requested_by:f.owner},f.requestId)],
  ["redacted cancellation witness",f=>f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id IN(SELECT event_id FROM events WHERE correlation_id=? AND type='JobCanceled')").run(new Date().toISOString(),f.requestId)],
  ["missing original private binding",f=>f.sqlite.prepare("UPDATE private_content SET content=json_remove(content,'$.scene_cost_binding_hash') WHERE content_id=?").run(f.sourceReceipt().content_id)],
  ["replaced original private binding",f=>f.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.scene_cost_binding_hash',?) WHERE content_id=?").run("0".repeat(64),f.sourceReceipt().content_id)],
  ["changed original private source",f=>f.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.document_snapshot.facts[0].properties.text','Changed original') WHERE content_id=?").run(f.sourceReceipt().content_id)],
  ["expired original private input",f=>f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00Z' WHERE content_id=?").run(f.sourceReceipt().content_id)],
  ["redacted original private input",f=>f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(),f.sourceReceipt().content_id)],
  ["different original approval",f=>f.sqlite.prepare("UPDATE document_jobs SET request_json=json_set(request_json,'$.sceneCostConsent.confirmed',json('false')) WHERE job_id=?").run(f.requestId)],
  ["expired durable private details",f=>f.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00Z',request_json='{}',result_json=NULL WHERE job_id=?").run(f.requestId)],
];
for(const [name,change,options]of contradicted){
  test("safe-unused proof is absent for "+name,async t=>{
    noProvider(t);const f=await createUnusedSceneFixture(options);
    try{
      await change(f);const row=f.originalRow(),finance=financialSnapshot(f),writes=f.controls.writes.length;
      const inspected=await f.preview();assert.equal(inspected.response.status,200,JSON.stringify(inspected.body));assert.equal(inspected.body.sceneCostExisting.safeUnused,null);
      assert.equal(inspected.body.job.jobId,f.requestId);assert.equal(f.controls.writes.length,writes);assert.deepEqual(f.originalRow(),row);assert.deepEqual(financialSnapshot(f),finance);
    }finally{f.close();}
  });
}

for(const cost of [false,true])for(const suffix of ["",":attempt:0",":attempt:9"]){
  test((cost?"cost":"token")+" ledger in "+(suffix||"original correlation")+" blocks continuation without changing its accounting",async t=>{
    noProvider(t);const f=await createUnusedSceneFixture({reason:"source-expired"});
    try{
      await reserveOriginal(f,{cost,correlation:f.requestId+suffix,foreign:suffix===":attempt:9"});
      const finance=financialSnapshot(f),writes=f.controls.writes.length,inspected=await f.preview();
      assert.equal(inspected.response.status,200,JSON.stringify(inspected.body));assert.equal(inspected.body.sceneCostExisting.safeUnused,null);
      assert.deepEqual(financialSnapshot(f),finance);assert.equal(f.controls.writes.length,writes);
    }finally{f.close();}
  });
}
for(const cost of [false,true]){
  test("verified "+(cost?"spend":"tokens")+" in an older attempt cannot be hidden by the zero-looking current terminal",async t=>{
    noProvider(t);const f=await createUnusedSceneFixture({reason:"source-expired"});
    try{
      await reserveOriginal(f,{cost,correlation:f.requestId+":attempt:0",used:true});
      const before=financialSnapshot(f),inspected=await f.preview();assert.equal(inspected.response.status,200,JSON.stringify(inspected.body));assert.equal(inspected.body.sceneCostExisting.safeUnused,null);assert.deepEqual(financialSnapshot(f),before);
    }finally{f.close();}
  });
}


for(const cost of [false,true]){
  test("released zero-usage "+(cost?"cost":"token")+" ledger is not a complete never-submitted proof",async t=>{
    noProvider(t);const f=await createUnusedSceneFixture({reason:"source-expired"});
    try{
      await reserveOriginal(f,{cost,correlation:f.requestId+":attempt:0"});
      const table=cost?"cost_budget_reservations":"budget_reservations",reservation=f.sqlite.prepare("SELECT * FROM "+table+" LIMIT 1").get();
      if(cost)await releaseCostBudget(f.env,f.owner,reservation.reservation_id);else await releaseBudget(f.env,f.owner,reservation.reservation_id);
      const released=f.sqlite.prepare("SELECT * FROM "+table+" LIMIT 1").get();assert.equal(released.status,"released");
      assert.equal(cost?released.used_microusd:released.used_tokens,0);
      const finance=financialSnapshot(f),result=await f.preview();assert.equal(result.response.status,200,JSON.stringify(result.body));assert.equal(result.body.sceneCostExisting.safeUnused,null);assert.deepEqual(financialSnapshot(f),finance);
    }finally{f.close();}
  });
}

test("older usage audit is disqualifying even when the current first-attempt correlation has no events",async t=>{
  noProvider(t);const f=await createUnusedSceneFixture({reason:"source-expired"});
  try{
    await appendAuditEvent(f.env,f.streamId,"worker:policy","GenerationUsageRecorded",{job_id:f.requestId,document_id:f.documentId,operation:"document-render:scene",cost_microusd:1400,total_tokens:200},f.requestId+":attempt:0");
    const writes=f.controls.writes.length,inspected=await f.preview();assert.equal(inspected.response.status,200,JSON.stringify(inspected.body));assert.equal(inspected.body.sceneCostExisting.safeUnused,null);assert.equal(f.controls.writes.length,writes);
  }finally{f.close();}
});

for(const mutation of ["row-lease","row-attempt","row-status","private-content","audit","token-hold","cost-hold","authority"]){
  test("final exact proof snapshot rejects "+mutation+" arriving after preparation",async t=>{
    noProvider(t);const f=await createUnusedSceneFixture();let intercepted=false;
    try{
      f.controls.beforeRead=async statement=>{
        if(intercepted||!finalProofRead(statement))return;intercepted=true;
        if(mutation==="row-lease")f.sqlite.prepare("UPDATE document_jobs SET lease_expires_at=? WHERE job_id=?").run(new Date(Date.now()+60_000).toISOString(),f.requestId);
        else if(mutation==="row-attempt")f.sqlite.prepare("UPDATE document_jobs SET attempt_count=1 WHERE job_id=?").run(f.requestId);
        else if(mutation==="row-status")f.sqlite.prepare("UPDATE document_jobs SET status='running' WHERE job_id=?").run(f.requestId);
        else if(mutation==="private-content")f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(f.sourceReceipt().content_id);
        else if(mutation==="audit")await appendAuditEvent(f.env,f.streamId,"worker:policy","GenerationUsageRecorded",{job_id:f.requestId,document_id:f.documentId,operation:"document-render:scene",cost_microusd:1,total_tokens:1},f.requestId+":attempt:old");
        else if(mutation==="authority")f.sqlite.prepare("UPDATE users SET updated_at=? WHERE user_id=?").run("2099-01-01T00:00:00Z",f.owner);
        else await reserveOriginal(f,{cost:mutation==="cost-hold",correlation:f.requestId+":attempt:old"});
      };
      const result=await f.preview();assert.equal(intercepted,true);assert.ok(result.response.status>=400,JSON.stringify(result.body));assert.equal(result.body.error,"scene_cost_authority_changed");assert.equal(result.body.sceneCostExisting,undefined);
    }finally{f.close();}
  });
}

for(const change of ["selected-session","tenant-membership","source-receipt-custody"]){
  test("shared final current authority prevents "+change+" from authorizing new preparation",async t=>{
    noProvider(t);const f=await createUnusedSceneFixture({shared:true});let intercepted=false;
    try{
      f.controls.beforeRead=async statement=>{
        if(intercepted||!finalProofRead(statement))return;intercepted=true;
        if(change==="selected-session")f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),f.sharing.contextId);
        else if(change==="tenant-membership")f.sqlite.prepare("UPDATE organization_memberships SET revoked_at=? WHERE organization_id=? AND user_id=?").run(new Date().toISOString(),f.sharing.organizationId,f.owner);
        else f.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id='different-current-actor' WHERE resource_kind='content' AND resource_id=?").run(f.sourceReceipt().content_id);
      };
      const result=await f.preview();assert.equal(intercepted,true);assert.ok(result.response.status>=400);assert.equal(result.body.sceneCostExisting,undefined);
    }finally{f.close();}
  });
}

test("a certificate that expires during the final SQL await is not returned as current",async t=>{
  noProvider(t);const f=await createUnusedSceneFixture();let intercepted=false;
  try{
    const now=Date.now();f.controls.afterRead=async(statement,value)=>{
      if(intercepted||!finalProofRead(statement))return;assert.equal(value.current,1);intercepted=true;t.mock.method(Date,"now",()=>now+60_000);
    };
    const result=await f.preview();assert.equal(intercepted,true);assert.equal(result.response.status,200,JSON.stringify(result.body));assert.equal(result.body.sceneCostExisting.safeUnused,null);assert.equal(result.body.job.jobId,f.requestId);
  }finally{f.close();}
});

test("the proof validator rejects incomplete, contradictory, stale and cross-month descriptors",async t=>{
  noProvider(t);const f=await createUnusedSceneFixture();
  try{
    const proof=exactProof(f,await f.preview()),now=Date.parse(proof.verifiedAt)+1;
    for(const change of [
      p=>{delete p.evidenceHash;},p=>{p.extra=true;},p=>{p.bindingHash="bad";},p=>{p.evidenceHash=null;},p=>{p.attemptCount=1;},
      p=>{p.jobStatus="completed";},p=>{p.reason="status-is-zero";},p=>{p.contextSessionId=4;},p=>{p.verifiedAt="not a date";},
      p=>{p.jobUpdatedAt=new Date(now+1).toISOString();},p=>{p.expiresAt=new Date(now).toISOString();},
      p=>{p.expiresAt=new Date(Date.parse(p.verifiedAt)+30_001).toISOString();},
    ]){const candidate={...proof};change(candidate);assert.equal(isSceneSafeUnusedProof(candidate,now),false);}
    assert.equal(isSceneSafeUnusedProof(proof,Date.parse(proof.verifiedAt)-1),false);
    assert.equal(isSceneSafeUnusedProof(proof,Date.parse(proof.expiresAt)),false);
    assert.equal(isSceneSafeUnusedProof(proof,NaN),false);
    const month={...proof,jobUpdatedAt:"2026-08-31T23:59:50.000Z",verifiedAt:"2026-08-31T23:59:59.000Z",expiresAt:"2026-09-01T00:00:10.000Z"};
    assert.equal(isSceneSafeUnusedProof(month,Date.parse("2026-09-01T00:00:00.000Z")),false);
  }finally{f.close();}
});

test("actually transmitted uncertain Scene retains its original job and both budget holds",async t=>{
  let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;throw new Error("in-memory lost provider response");});
  const f=await createSceneCostFixture(1,"visual",{depth:true});
  try{
    const preview=(await f.preview()).body.sceneCostPreview;await f.approve(preview);const failed=await f.run();
    assert.equal(calls,1);assert.equal(failed.body.job.status,"failed");const finance=financialSnapshot(f),writes=f.controls.writes.length;
    assert.ok(finance.budget_reservations.some(row=>row.status==="active"));assert.ok(finance.cost_budget_reservations.some(row=>row.status==="executing"));
    const original=await f.preview();assert.equal(original.response.status,200,JSON.stringify(original.body));assert.equal(original.body.job.jobId,f.requestId);assert.equal(original.body.sceneCostExisting.safeUnused,null);
    assert.equal(calls,1);assert.equal(f.controls.writes.length,writes);assert.deepEqual(financialSnapshot(f),finance);
  }finally{f.close();}
});

test.after(()=>{
  assert.ok(sceneCostFixtureProof.fixtures>0);assert.ok(sceneCostFixtureProof.nativeQueries.size>0);assert.ok(sceneCostFixtureProof.maximumBindings<=100);
  console.log("Scene recovery native D1 proof",JSON.stringify({fixtures:sceneCostFixtureProof.fixtures,queries:sceneCostFixtureProof.nativeQueries.size,maximumBindings:sceneCostFixtureProof.maximumBindings}));
});
