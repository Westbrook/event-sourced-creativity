import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { combinedContextGroups } from "../src/model/combined-context.ts";
import { parseDocumentArtifactContent, documentArtifactValidationIssues } from "../src/model/document-artifacts.ts";
import { createPilotSceneFixture, pendingCheckpoint, scenePilotProvider } from "./helpers/scene-pilot-fixture.mjs";
import { sceneCostFixtureProof } from "./helpers/scene-cost-fixture.mjs";

function zeroNewSpend(f,calls) {
  assert.equal(calls.length,0);assert.equal(f.counts().document_jobs,1);
  assert.equal(f.cost().length,1);assert.equal(f.cost()[0].status,"released");assert.equal(f.cost()[0].used_microusd,0);
  assert.equal(f.tokens().length,1);assert.equal(f.tokens()[0].status,"released");assert.equal(f.tokens()[0].used_tokens,0);
  for(const receipt of Object.values(f.checkpoint().providerSubmissions??{})){assert.equal(receipt.status,"rejected");assert.equal(receipt.costMicrousd,0);}
}
function fixedOriginal(f,preview) {
  const fixed=f.fixed();assert.equal(fixed.length,f.cohort?1:0);
  if(f.cohort){assert.equal(fixed[0].cohort_id,f.cohort.cohortId);assert.equal(fixed[0].organization_id,f.sharing.organizationId);assert.equal(fixed[0].actor_user_id,f.actorUserId);assert.equal(fixed[0].reservation_id,f.cost()[0].reservation_id);}
  assert.equal(f.cost()[0].period,preview.period);assert.equal(f.cost()[0].owner_id,f.actorUserId);
  assert.equal(f.cost()[0].reserved_microusd,preview.maximumMicrousd);
}
function pendingMutation(f,mutate,{at=1}={}) {
  const seen=new Set();let changed=false;
  f.controls.beforeRun=async statement=>{
    const checkpoint=pendingCheckpoint(statement);if(!checkpoint||changed)return;
    const pending=checkpoint.entries.find(entry=>entry.status==="pending");
    if(seen.has(pending.clientRequestId))return;seen.add(pending.clientRequestId);
    if(seen.size!==at)return;changed=true;await mutate();
  };
  return{get changed(){return changed;},get seen(){return seen.size;}};
}

for(const medium of ["visual","audio"])for(const mode of ["manual","managed"]) {
  for(const [scope,options] of [
    ["personal without pilot",{pilot:false,shared:false}],
    ["scoped without pilot",{pilot:false,shared:true}],
    ["selected cohort owner",{}],
    ["selected enrolled editor",{member:true}],
    ["cookie-free owner original",{cookieFree:true}],
  ])test(mode+" "+medium+" paid Scene preserves "+scope,async t=>{
    const f=await createPilotSceneFixture({count:mode==="manual"?1:9,medium,mode,...options}),calls=scenePilotProvider(t);
    try{
      const preview=await f.admit();if(options.cookieFree)assert.equal(preview.contextSessionId,null);
      const result=await f.run();assert.equal(result.body.job.status,"completed",JSON.stringify(result.body));
      assert.equal(calls.length,preview.providerCallCount);assert.ok(calls.length<=preview.maximumProviderCallCount);
      assert.ok(f.checkpoint().generationReceipt.settled_cost_microusd<=preview.maximumMicrousd);
      fixedOriginal(f,preview);assert.equal(f.cost()[0].status,"settled");
      const retained=await f.preview();assert.equal(retained.response.status,200);assert.equal(retained.body.job.jobId,f.requestId);
      assert.equal(retained.body.sceneCostExisting.preview.bindingHash,preview.bindingHash);assert.equal(calls.length,preview.providerCallCount);
      if(f.sharing){const job=f.sqlite.prepare("SELECT actor_user_id,visibility FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=?").get(f.requestId);assert.equal(job.actor_user_id,f.actorUserId);assert.equal(job.visibility,"actor_private");}
    }finally{f.close();}
  });
}

const policyChanges=[
  ["cohort pause",f=>f.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run(f.cohort.cohortId)],
  ["cohort close",f=>f.sqlite.prepare("UPDATE pilot_cohorts SET status='closed' WHERE cohort_id=?").run(f.cohort.cohortId)],
  ["cohort expiry",f=>f.sqlite.prepare("UPDATE pilot_cohorts SET ends_at=? WHERE cohort_id=?").run(new Date(Date.now()-1_000).toISOString(),f.cohort.cohortId)],
  ["future cohort start",f=>f.sqlite.prepare("UPDATE pilot_cohorts SET starts_at=? WHERE cohort_id=?").run(new Date(Date.now()+60_000).toISOString(),f.cohort.cohortId)],
  ["participant revocation",f=>f.sqlite.prepare("UPDATE pilot_participants SET status='revoked',revoked_at=? WHERE participant_id=?").run(new Date().toISOString(),f.participantId),true],
  ["participant reviewer-only",f=>f.sqlite.prepare("UPDATE pilot_participants SET role='reviewer' WHERE participant_id=?").run(f.participantId),true],
];
for(const mode of ["manual","managed"])for(const boundary of ["after-claim","pending"])for(const [name,change,member] of policyChanges) {
  test(mode+" Scene "+name+" at "+boundary+" is definitively not dispatched",async t=>{
    const f=await createPilotSceneFixture({count:mode==="manual"?1:9,mode,member:!!member}),calls=scenePilotProvider(t);
    try{
      const preview=await f.admit();let changed=false;
      f.controls.beforeRun=async statement=>{
        if(changed||!statement.sql.startsWith("UPDATE document_jobs SET result_json="))return;
        const cost=f.cost()[0];if(cost?.status!=="executing")return;
        if(boundary==="pending"&&!pendingCheckpoint(statement))return;
        changed=true;change(f);
      };
      const result=await f.run();assert.equal(changed,true);assert.ok(["failed","canceled"].includes(result.body.job.status),JSON.stringify(result.body));
      zeroNewSpend(f,calls);fixedOriginal(f,preview);
      assert.equal(f.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='pilot_user' AND scope_id=? AND period=?").get(f.actorUserId,"pilot:"+f.cohort.cohortId).reserved_microusd,0);
    }finally{f.close();}
  });
}

const capChanges=[
  ["current participant policy",f=>f.sqlite.prepare("UPDATE pilot_cohorts SET participant_cap_microusd=1000000 WHERE cohort_id=?").run(f.cohort.cohortId)],
  ["current organization policy",f=>f.sqlite.prepare("UPDATE pilot_cohorts SET organization_cap_microusd=1000000 WHERE cohort_id=?").run(f.cohort.cohortId)],
  ["fixed participant counter",f=>f.sqlite.prepare("UPDATE cost_budget_counters SET hard_limit_microusd=1000000 WHERE scope='pilot_user' AND scope_id=? AND period=?").run(f.actorUserId,"pilot:"+f.cohort.cohortId)],
  ["fixed organization counter",f=>f.sqlite.prepare("UPDATE cost_budget_counters SET hard_limit_microusd=1000000 WHERE scope='pilot_org' AND scope_id=? AND period=?").run(f.cohort.cohortId,"pilot:"+f.cohort.cohortId)],
  ["workspace cost policy",f=>f.sqlite.prepare("UPDATE budget_scope_policies SET microusd_limit=1000000 WHERE scope='workspace' AND scope_id=?").run(f.sharing.organizationId)],
  ["workspace token policy",f=>f.sqlite.prepare("UPDATE budget_scope_policies SET token_limit=1 WHERE scope='workspace' AND scope_id=?").run(f.sharing.organizationId)],
  ["account cost counter",f=>f.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd WHERE scope='user' AND scope_id=?").run(f.actorUserId)],
  ["global cost counter",f=>f.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd WHERE scope='workspace' AND scope_id='forma'").run()],
  ["workspace cost counter",f=>f.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd WHERE scope='workspace' AND scope_id=?").run(f.sharing.organizationId)],
  ["account token counter",f=>f.sqlite.prepare("UPDATE budget_counters SET used_tokens=hard_limit_tokens WHERE scope='user' AND scope_id=?").run(f.actorUserId)],
  ["global token counter",f=>f.sqlite.prepare("UPDATE budget_counters SET used_tokens=hard_limit_tokens WHERE scope='workspace' AND scope_id='forma'").run()],
  ["workspace token counter",f=>f.sqlite.prepare("UPDATE budget_counters SET used_tokens=hard_limit_tokens WHERE scope='workspace' AND scope_id=?").run(f.sharing.organizationId)],
];
for(const medium of ["visual","audio"])for(const [name,change] of capChanges)test(medium+" Scene rechecks "+name+" after pending bookkeeping",async t=>{
  const f=await createPilotSceneFixture({medium}),calls=scenePilotProvider(t);
  try{
    const preview=await f.admit(),interleaved=pendingMutation(f,()=>change(f));
    const result=await f.run();assert.equal(interleaved.changed,true);assert.equal(result.body.job.status,"failed");
    zeroNewSpend(f,calls);fixedOriginal(f,preview);
  }finally{f.close();}
});

for(const medium of ["visual","audio"])for(const mode of ["manual","managed"])for(const boundary of ["final-sql","adapter-continuation"]) {
  for(const expires of [true,false])test(mode+" "+medium+" cohort deadline "+boundary+" "+(expires?"expires":"remains current"),async t=>{
    const f=await createPilotSceneFixture({count:mode==="manual"?1:9,medium,mode}),calls=scenePilotProvider(t);
    try{
      const initial=Date.now(),endsAt=new Date(initial+60_000).toISOString();let now=initial,scheduled=false,crossed=false;
      f.sqlite.prepare("UPDATE pilot_cohorts SET ends_at=? WHERE cohort_id=?").run(endsAt,f.cohort.cohortId);
      const preview=await f.admit();
      t.mock.method(Date,"now",()=>{
        if(boundary==="adapter-continuation"&&!scheduled&&/at requireSceneCostDeadline[^\n]*\n\s+at (?:Object\.)?observePaid/u.test(new Error().stack??"")){
          scheduled=true;queueMicrotask(()=>{now=expires?Date.parse(endsAt)+1:initial+1;crossed=true;});
        }
        return now;
      });
      f.controls.afterRead=async(statement,row)=>{
        if(boundary!=="final-sql"||crossed||!statement.sql.startsWith("SELECT 1 AS current,")||!f.checkpoint().providerSubmissions
          ||!Object.values(f.checkpoint().providerSubmissions).some(receipt=>receipt.status==="pending"))return;
        assert.equal(row.current,1);assert.equal(row.pilot_ends_at,endsAt);scheduled=true;crossed=true;now=expires?Date.parse(endsAt)+1:initial+1;
      };
      const result=await f.run();assert.equal(scheduled,true);assert.equal(crossed,true);
      if(expires){zeroNewSpend(f,calls);assert.equal(result.body.job.status,"failed");}
      else{assert.equal(result.body.job.status,"completed",result.body.job.error);assert.equal(calls.length,preview.providerCallCount);assert.ok(calls.every(call=>call.at<Date.parse(endsAt)));}
      fixedOriginal(f,preview);
    }finally{f.close();}
  });
}

for(const [name,change] of [
  ["source private bytes",f=>f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(),f.contentRef)],
  ["selected context",f=>f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(),f.contextId)],
  ["current consent",f=>f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.actorUserId)],
  ["original content custody",f=>f.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").run(f.contentRef)],
])test("paid final snapshot includes "+name+" as well as the pinned cohort",async t=>{
  const f=await createPilotSceneFixture(),calls=scenePilotProvider(t);let changed=false;
  try{
    await f.admit();f.controls.beforeRead=async statement=>{
      if(changed||!statement.sql.startsWith("SELECT 1 AS current,")||!Object.values(f.checkpoint().providerSubmissions??{}).some(receipt=>receipt.status==="pending"))return;
      changed=true;change(f);
    };
    const result=await f.run();assert.equal(changed,true);assert.ok(["failed","canceled"].includes(result.body.job.status));
    if(name==="current consent"){
      assert.equal(calls.length,0);assert.equal(f.counts().document_jobs,1);
      assert.equal(f.cost()[0].status,"executing");assert.equal(f.cost()[0].used_microusd,0);
      assert.equal(Object.values(f.checkpoint().providerSubmissions).filter(receipt=>receipt.status==="pending").length,1,
        "withdrawn write authority cannot be used to rewrite an unconfirmed retained checkpoint");
    }else zeroNewSpend(f,calls);
  }finally{f.close();}
});

for(const medium of ["visual","audio"])for(const kind of ["next-page","adapter-repair"])test(medium+" "+kind+" keeps earlier verified usage when its cohort pauses",async t=>{
  const f=await createPilotSceneFixture({medium}),calls=scenePilotProvider(t,{badFirst:kind==="adapter-repair"});
  try{
    const preview=await f.admit(),interleaved=pendingMutation(f,()=>f.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run(f.cohort.cohortId),{at:2});
    const result=await f.run();assert.equal(interleaved.changed,true,"a genuine second provider attempt reached the pending checkpoint");
    assert.equal(calls.length,1);assert.equal(result.body.job.status,"failed");fixedOriginal(f,preview);
    const entries=Object.values(f.checkpoint().providerSubmissions);assert.equal(entries.length,2);
    assert.equal(entries.filter(entry=>entry.status==="completed").length,1);assert.equal(entries.filter(entry=>entry.status==="rejected"&&entry.costMicrousd===0).length,1);
    assert.equal(f.cost()[0].status,"settled");assert.equal(f.cost()[0].used_microusd,1400);assert.equal(f.tokens()[0].used_tokens,200);
    const original=await f.preview();assert.equal(original.response.status,200);assert.equal(original.body.job.jobId,f.requestId);assert.equal(original.body.sceneCostExisting.preview.bindingHash,preview.bindingHash);
    assert.equal(calls.length,1);
  }finally{f.close();}
});

test("a newly activated pilot cannot adopt a no-pilot reservation that was already claimed",async t=>{
  const f=await createPilotSceneFixture({pilot:false,shared:true}),calls=scenePilotProvider(t);let configured=null;
  try{
    await f.admit();const interleaved=pendingMutation(f,async()=>{
      const response=await f.asOwner("/api/workspaces/"+f.sharing.organizationId+"/pilot",f.json({maxParticipants:3}));assert.equal(response.status,201);
      configured=await response.json();
    });
    const result=await f.run();assert.equal(interleaved.changed,true);assert.equal(result.body.job.status,"failed");
    zeroNewSpend(f,calls);assert.equal(f.fixed().length,0);
    const counter=f.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='pilot_org' AND scope_id=?").get(configured.cohortId);
    assert.equal(counter.used_microusd,0);assert.equal(counter.reserved_microusd,0);
  }finally{f.close();}
});

test("a successor cohort never inherits the already claimed original cohort charge",async t=>{
  const f=await createPilotSceneFixture(),calls=scenePilotProvider(t);let successor=null;
  try{
    const preview=await f.admit(),interleaved=pendingMutation(f,async()=>{
      const closed=await f.asOwner("/api/workspaces/"+f.sharing.organizationId+"/pilot",{...f.json({status:"closed"}),method:"PATCH"});assert.equal(closed.status,200);
      const created=await f.asOwner("/api/workspaces/"+f.sharing.organizationId+"/pilot",f.json({maxParticipants:3}));assert.equal(created.status,201);
      successor=await created.json();
    });
    const result=await f.run();assert.equal(interleaved.changed,true);assert.equal(result.body.job.status,"failed");
    zeroNewSpend(f,calls);fixedOriginal(f,preview);assert.notEqual(successor.cohortId,f.cohort.cohortId);
    for(const cohort of [f.cohort,successor]){const counter=f.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='pilot_org' AND scope_id=?").get(cohort.cohortId);assert.equal(counter.used_microusd,0);assert.equal(counter.reserved_microusd,0);}
  }finally{f.close();}
});

for(const mode of ["manual","managed"])test(mode+" paused original inspection never clears unknown provider holds",async t=>{
  let f;const calls=scenePilotProvider(t,{uncertainAt:mode==="manual"?1:2,beforeReply(index){if(index===(mode==="manual"?1:2))f.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run(f.cohort.cohortId);}});
  f=await createPilotSceneFixture({mode,count:mode==="manual"?1:9});
  try{
    const preview=await f.admit();const result=await f.run();assert.equal(result.body.job.status,"failed");
    assert.equal(calls.length,mode==="manual"?1:2);assert.equal(f.cost()[0].status,"executing");fixedOriginal(f,preview);
    const costBefore=f.cost(),tokensBefore=f.tokens(),fixedBefore=f.fixed(),countersBefore=f.sqlite.prepare("SELECT * FROM cost_budget_counters ORDER BY scope,scope_id,period").all();
    const original=await f.preview();assert.equal(original.response.status,200);assert.equal(original.body.job.jobId,f.requestId);
    assert.equal(original.body.sceneCostExisting.preview.bindingHash,preview.bindingHash);assert.equal(original.body.sceneCostExisting.safeUnused,null);
    assert.deepEqual(f.cost(),costBefore);assert.deepEqual(f.tokens(),tokensBefore);assert.deepEqual(f.fixed(),fixedBefore);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM cost_budget_counters ORDER BY scope,scope_id,period").all(),countersBefore);
    assert.equal(Object.values(f.checkpoint().providerSubmissions).filter(receipt=>receipt.status==="pending").length,1);
    if(mode==="managed"){assert.equal(Object.values(f.checkpoint().providerSubmissions).find(receipt=>receipt.status==="completed").costMicrousd,1400);}
  }finally{f.close();}
});

test("paused pilot free quote and exact unused original inspection need no new paid entitlement",async t=>{
  const f=await createPilotSceneFixture();t.mock.method(globalThis,"fetch",async()=>assert.fail("No provider during free inspection"));
  try{
    await f.admit();const paused=await f.asOwner("/api/workspaces/"+f.sharing.organizationId+"/pilot",{...f.json({status:"paused"}),method:"PATCH"});assert.equal(paused.status,200);
    const canceled=await f.request("/api/document-jobs/"+f.requestId+"/cancel",f.json({}));assert.equal(canceled.status,200);
    await f.request("/api/events?after=0&limit=2000&content=0");const writes=f.controls.writes.length;
    const retained=await f.preview();assert.equal(retained.response.status,200);assert.equal(retained.body.job.jobId,f.requestId);assert.ok(retained.body.sceneCostExisting.safeUnused);
    const fresh=await f.preview({sceneRequestId:"fresh-paused-scene-inspection"});assert.equal(fresh.response.status,200);assert.ok(fresh.body.sceneCostPreview);
    assert.equal(f.controls.writes.length,writes);assert.equal(f.counts().cost_budget_reservations,0);assert.equal(f.counts().budget_reservations,0);
  }finally{f.close();}
});


for(const medium of ["visual","audio"])for(const changed of [true,false])test(medium+" managed whole-work repair "+(changed?"blocks new spend after pause":"uses the same original claim"),async t=>{
  const f=await createPilotSceneFixture({medium}),calls=scenePilotProvider(t,{duplicateAcrossPages:true});
  try{
    const preview=await f.admit();let seen=0;
    const interleaved=pendingMutation(f,()=>{seen++;if(changed)f.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run(f.cohort.cohortId);},{at:3});
    const result=await f.run();assert.equal(interleaved.changed,true);assert.equal(seen,1,"two valid initial pages reached actual managed whole-work repair");
    assert.equal(calls.length,changed?2:3);assert.equal(result.body.job.status,changed?"failed":"completed");
    if(!changed)assert.ok(calls[2].input.production.page.repair_issues.length>0,"the real managed repair page was dispatched");
    fixedOriginal(f,preview);assert.equal(f.cost()[0].status,"settled");assert.equal(f.cost()[0].used_microusd,1400*calls.length);
    assert.equal(f.tokens()[0].used_tokens,200*calls.length);assert.ok(calls.length<=preview.maximumProviderCallCount);
  }finally{f.close();}
});

for(const medium of ["visual","audio"])test("manual "+medium+" repair rechecks the claimed pilot after its pending checkpoint",async t=>{
  const f=await createPilotSceneFixture({medium,mode:"manual",count:1}),calls=scenePilotProvider(t,{missingFirstItem:true});
  try{
    const preview=await f.admit(),interleaved=pendingMutation(f,()=>f.sqlite.prepare("UPDATE pilot_cohorts SET status='paused' WHERE cohort_id=?").run(f.cohort.cohortId),{at:2});
    const result=await f.run();assert.equal(interleaved.changed,true);assert.equal(result.body.job.status,"failed");
    assert.equal(calls.length,1);assert.equal(f.cost()[0].used_microusd,1400);assert.equal(f.tokens()[0].used_tokens,200);
    fixedOriginal(f,preview);
  }finally{f.close();}
});

test("membership in a different pilot does not move this unmanaged workspace reservation",async t=>{
  const f=await createPilotSceneFixture({pilot:false,shared:true}),calls=scenePilotProvider(t);
  try{
    const created=await f.asOwner("/api/workspaces",f.json({name:"Unrelated controlled organization"}));assert.equal(created.status,201);
    const organizationId=(await created.json()).organizationId;
    const configured=await f.asOwner("/api/workspaces/"+organizationId+"/pilot",f.json({maxParticipants:3}));assert.equal(configured.status,201);
    const cohort=(await configured.json()).cohortId;
    await f.request("/api/events?after=0&limit=2000&content=0");
    const preview=await f.admit(),result=await f.run();assert.equal(result.body.job.status,"completed",JSON.stringify(result.body));
    assert.equal(calls.length,2);fixedOriginal(f,preview);
    const counter=f.sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='pilot_org' AND scope_id=?").get(cohort);
    assert.equal(counter.used_microusd,0);assert.equal(counter.reserved_microusd,0);
  }finally{f.close();}
});


for(const medium of ["visual","audio"])test("manual "+medium+" current participant cap is checked after pending",async t=>{
  const f=await createPilotSceneFixture({medium,mode:"manual",count:1}),calls=scenePilotProvider(t);
  try{
    const preview=await f.admit(),interleaved=pendingMutation(f,()=>f.sqlite.prepare("UPDATE pilot_cohorts SET participant_cap_microusd=500000 WHERE cohort_id=?").run(f.cohort.cohortId));
    const result=await f.run();assert.equal(interleaved.changed,true);assert.equal(result.body.job.status,"failed");zeroNewSpend(f,calls);fixedOriginal(f,preview);
  }finally{f.close();}
});

for(const medium of ["visual","audio"])test(medium+" exact remaining caps count the original hold only once",async t=>{
  const f=await createPilotSceneFixture({medium}),calls=scenePilotProvider(t);
  try{
    const preview=await f.admit(),interleaved=pendingMutation(f,()=>{
      const held=f.cost()[0].reserved_microusd,tokens=f.tokens()[0].reserved_tokens;
      f.sqlite.prepare("UPDATE pilot_cohorts SET participant_cap_microusd=?,organization_cap_microusd=? WHERE cohort_id=?").run(held,held,f.cohort.cohortId);
      f.sqlite.prepare("UPDATE cost_budget_counters SET hard_limit_microusd=? WHERE reserved_microusd=?").run(held,held);
      f.sqlite.prepare("UPDATE budget_counters SET hard_limit_tokens=? WHERE reserved_tokens=?").run(tokens,tokens);
      f.sqlite.prepare("UPDATE budget_scope_policies SET token_limit=?,microusd_limit=? WHERE scope='workspace' AND scope_id=?").run(tokens,held,f.sharing.organizationId);
    });
    const result=await f.run();assert.equal(interleaved.changed,true);assert.equal(result.body.job.status,"completed",JSON.stringify(result.body));
    assert.equal(calls.length,2);fixedOriginal(f,preview);assert.equal(f.cost()[0].used_microusd,2800);
  }finally{f.close();}
});

for(const medium of ["visual","audio"])for(const kind of ["next-page","adapter-repair","whole-work-repair"])test(medium+" "+kind+" expiry preserves verified earlier charges",async t=>{
  const f=await createPilotSceneFixture({medium}),calls=scenePilotProvider(t,{badFirst:kind==="adapter-repair",duplicateAcrossPages:kind==="whole-work-repair"});
  try{
    const preview=await f.admit(),earlier=kind==="whole-work-repair"?2:1;
    const interleaved=pendingMutation(f,()=>f.sqlite.prepare("UPDATE pilot_cohorts SET ends_at=? WHERE cohort_id=?").run(new Date(Date.now()-1000).toISOString(),f.cohort.cohortId),{at:earlier+1});
    const result=await f.run();assert.equal(interleaved.changed,true);assert.equal(result.body.job.status,"failed");assert.equal(calls.length,earlier);
    fixedOriginal(f,preview);assert.equal(f.cost()[0].status,"settled");assert.equal(f.cost()[0].used_microusd,1400*earlier);
    assert.equal(f.tokens()[0].used_tokens,200*earlier);
  }finally{f.close();}
});


for(const medium of ["visual","audio"])test(medium+" actual cached paid-plan branch does not invoke new provider hooks (not paused native recovery)",async t=>{
  const f=await createPilotSceneFixture({medium,mode:"manual",count:1}),calls=scenePilotProvider(t);
  try{
    const preview=await f.admit();let checkpoint=null;
    f.controls.beforeRun=()=>{const retained=f.checkpoint();if(retained.artifactPlan&&retained.plannerResponseId)checkpoint=structuredClone(retained);};
    assert.equal((await f.run()).body.job.status,"completed");assert.equal(calls.length,1);
    assert.ok(checkpoint,"the real paid draft was durably checkpointed before local completion");
    const cachedPlan=parseDocumentArtifactContent(JSON.stringify(checkpoint.artifactPlan));
    assert.ok(checkpoint.plannerResponseId);assert.ok(cachedPlan);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='GenerationUsageRecorded' AND json_extract(payload,'$.planner_response_id')=?").get(checkpoint.plannerResponseId).count,1);
    const retainedInput=f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact-input' AND redacted_at IS NULL").get(checkpoint.generationReceipt.input_ref,f.actorUserId);
    assert.ok(retainedInput);const input=JSON.parse(retainedInput.content);
    assert.equal(input.scene_request_id,f.requestId);assert.equal(input.scene_cost_binding_hash,preview.bindingHash);
    const artifactValidationOptions={itemCount:1,contextGroupIds:combinedContextGroups(input.production_workflow_snapshot??input.document_snapshot).map(group=>group.id)};
    assert.deepEqual(documentArtifactValidationIssues("scene",cachedPlan,artifactValidationOptions),[]);
    const source=readFileSync(new URL("../worker/events-api.ts",import.meta.url),"utf8");
    const tree=ts.createSourceFile("events-api.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let branch=null;
    function visit(node){if(ts.isIfStatement(node)&&node.expression.getText(tree).startsWith("cachedPlan&&!documentArtifactValidationIssues("))branch=node;ts.forEachChild(node,visit);}
    visit(tree);assert.ok(branch,"exercise the actual cached-plan/provider branch");
    const actual=ts.transpileModule("async function cached(){let plan;"+branch.getText(tree)+";return plan;}",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
    let hooks=0;const forbidden=()=>{hooks++;throw new Error("A retained plan must not invoke a new provider hook");};
    const factory=new Function("cachedPlan","artifactKind","artifactValidationOptions","documentArtifactValidationIssues","guardDocumentPlanningSpend","observePaid","sceneDispatchDeadline","generateManagedArtifactDraft","generateDocumentArtifact",actual+";return cached;");
    const invoke=factory(cachedPlan,"scene",artifactValidationOptions,documentArtifactValidationIssues,forbidden,forbidden,forbidden,forbidden,forbidden);
    assert.equal(await invoke(),cachedPlan);assert.equal(hooks,0);assert.equal(calls.length,1);
    // This branch proof deliberately does not override the earlier, pre-existing paused-pilot
    // admission / legacy reservation-recovery limitations of a native retry.
  }finally{f.close();}
});

test("paid Scene fixture SQL remains within native D1 limits",()=>{
  assert.ok(sceneCostFixtureProof.fixtures>0);assert.ok(sceneCostFixtureProof.nativeQueries.size>0);
  assert.ok(sceneCostFixtureProof.maximumBindings<=100);assert.ok(sceneCostFixtureProof.maximumBindings>=84,"the real scoped pilot reservation path was exercised");
});
