import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { installMemoryJobTestSchema,installMemoryTestSchema,memoryJobMigrationHash,memoryMigrationHash,
  memoryPersistenceFixture,memoryTestDatabase,seedMemoryDocument } from "./helpers/memory-persistence.mjs";
import { MemoryReviewJobs } from "../worker/memory-review-jobs.ts";
import { deriveMemoryReview,MEMORY_REVIEW_RECIPE } from "../worker/memory-review-recipe.ts";
import { memoryConversationCoverage } from "../src/model/memory-conversation.ts";

const execute=promisify(execFile);
const count=(state,table)=>state.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const currentJob=(state)=>state.sqlite.prepare("SELECT * FROM memory_shadow_jobs WHERE actor_user_id=? AND custodian_id=? ORDER BY admitted_at DESC LIMIT 1").get(state.actor,state.custodian);
const schedule=(state)=>state.sqlite.prepare("SELECT * FROM memory_shadow_schedules WHERE actor_user_id=? AND custodian_id=?").get(state.actor,state.custodian);
const publication=(statements)=>statements.some((statement)=>statement.sql.startsWith("INSERT INTO memory_shadow_reviews("));
function fixture(t,options={},jobOptions={}) {
  const state=memoryPersistenceFixture(options);installMemoryJobTestSchema(state.sqlite);t.after(()=>state.close());
  return {...state,jobs:new MemoryReviewJobs(state.adapter,state.store,jobOptions)};
}
async function prepared(t,options={},jobOptions={}) {
  const state=fixture(t,options,jobOptions);seedMemoryDocument(state);
  assert.equal((await state.jobs.register(state.identity,{timeZone:"America/New_York"})).status,"registered");return state;
}
async function leaseFor(jobs,identity) {
  const lease=await jobs.claim(identity);assert.equal(lease.kind,"issued-memory-review-lease");return lease;
}
async function complete(state) {
  assert.equal((await state.jobs.admit(state.identity)).status,"admitted");
  const lease=await leaseFor(state.jobs,state.identity);assert.equal((await state.jobs.execute(lease)).status,"completed");return lease;
}

test("job migration is separate, repeatable, fingerprinted and rolls back partial installation",(t)=>{
  const state=memoryPersistenceFixture();t.after(()=>state.close());
  assert.equal(state.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='memory_shadow_jobs'").get(),undefined);
  assert.equal(installMemoryJobTestSchema(state.sqlite),true);assert.equal(installMemoryJobTestSchema(state.sqlite),false);
  assert.equal(installMemoryTestSchema(state.sqlite),false);
  assert.equal(state.sqlite.prepare("SELECT migration_hash FROM memory_shadow_schema").get().migration_hash,memoryMigrationHash);
  assert.equal(state.sqlite.prepare("SELECT migration_hash FROM memory_shadow_job_schema").get().migration_hash,memoryJobMigrationHash);
  state.sqlite.prepare("UPDATE memory_shadow_job_schema SET migration_hash='drift'").run();
  assert.throws(()=>installMemoryJobTestSchema(state.sqlite),/fingerprint mismatch/);
  const broken=memoryTestDatabase();t.after(()=>broken.close());installMemoryTestSchema(broken.sqlite);
  broken.sqlite.prepare("CREATE TABLE memory_shadow_jobs(preserved TEXT)").run();
  assert.throws(()=>installMemoryJobTestSchema(broken.sqlite),/already exists/);
  assert.equal(broken.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='memory_shadow_schedules'").get(),undefined);
  assert.equal(broken.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='memory_shadow_job_schema'").get(),undefined);
  assert.equal(broken.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='memory_shadow_schema'").get().name,"memory_shadow_schema");
});

test("default-off orchestration performs no DB or authority calls and leases cannot be forged",async(t)=>{
  const state=fixture(t,{mode:"off"});state.controls.queries.length=0;
  assert.equal((await state.jobs.register(state.identity)).status,"disabled");
  assert.equal((await state.jobs.admit(state.identity)).status,"disabled");
  assert.equal((await state.jobs.claim(state.identity)).status,"disabled");assert.equal(await state.jobs.tick(),null);
  await assert.rejects(()=>state.jobs.execute({kind:"issued-memory-review-lease"}),/unissued-memory-review-lease/);
  assert.deepEqual(state.controls.queries,[]);
});

test("registration does not grant learning, and a paused scope remains discoverable for cleanup",async(t)=>{
  const state=fixture(t);
  state.changeAuthority((value)=>{for(const grant of value.access.grants)grant.purposes=["recall"];});
  await assert.rejects(()=>state.jobs.register(state.identity),/memory-registration-learning-denied/);
  assert.equal(count(state,"memory_shadow_schedules"),0);
  assert.equal((await state.jobs.register(state.identity,{enabled:false})).status,"registered");
  assert.equal((await state.jobs.admit(state.identity)).status,"paused");
  state.changeAuthority((value)=>{value.access.enabled=false;});
  assert.equal((await state.jobs.register(state.identity,{enabled:false})).status,"existing");
  assert.equal(count(state,"memory_shadow_schedules"),1);
  state.sqlite.prepare("DELETE FROM memory_shadow_job_schema").run();
  await assert.rejects(()=>state.jobs.tick(),/unsupported-memory-job-schema/);
});

test("concurrent admission reserves exactly one immutable plan and no published progress",async(t)=>{
  const state=await prepared(t),other=new MemoryReviewJobs(state.adapter,state.store);
  const results=await Promise.all([state.jobs.admit(state.identity),other.admit(state.identity)]);
  assert.deepEqual(results.map((row)=>row.status).sort(),["admitted","existing"]);
  assert.equal(results[0].jobId,results[1].jobId);assert.equal(count(state,"memory_shadow_jobs"),1);
  assert.equal(count(state,"memory_shadow_watermarks"),0);assert.equal(count(state,"memory_shadow_private_bodies"),0);
  const job=currentJob(state),plan=JSON.parse(job.plan_json);
  assert.equal(job.status,"queued");assert.equal(job.attempts,0);assert.equal(job.max_attempts,3);
  assert.deepEqual(plan.through,{[state.stream]:9});assert.equal(schedule(state).last_local_day,"2026-09-02");
  assert.equal(job.plan_json.includes("Please keep the chart"),false);
  const details=state.sqlite.prepare("EXPLAIN QUERY PLAN SELECT * FROM memory_shadow_jobs WHERE actor_user_id=? AND custodian_id=? AND scope_id=? AND recipe_version=? AND status IN ('queued','running','retry')")
    .all(state.actor,state.custodian,"document",MEMORY_REVIEW_RECIPE).map((row)=>row.detail).join(" ");
  assert.match(details,/memory_shadow_one_active_review/);
});

test("failed admission rolls back its nightly slot and boundary-crossing admission is rejected",async(t)=>{
  for(const boundary of ["write","clock"]){
    const state=await prepared(t),initial=state.clock.now;let injected=false;
    state.controls.beforeStatement=(sql)=>{if(!injected&&sql.startsWith("INSERT INTO memory_shadow_jobs(")){
      injected=true;if(boundary==="clock")state.clock.now="2026-09-02T09:00:00.000Z";else throw new Error("private failure text");
    }};
    await assert.rejects(()=>state.jobs.admit(state.identity),/memory-job-write-rejected/);assert.equal(injected,true);
    assert.equal(count(state,"memory_shadow_jobs"),0);assert.equal(schedule(state).last_admitted_at,null);
    state.controls.beforeStatement=null;state.clock.now=initial;
    assert.equal((await state.jobs.admit(state.identity)).status,"admitted");
  }
});

test("new admission requires the local quiet window and new human activity",async(t)=>{
  const state=fixture(t);state.addEvent({type:"ProviderRequestCompleted",actor:"worker:fixture"});
  await state.jobs.register(state.identity,{timeZone:"America/New_York"});
  assert.equal((await state.jobs.admit(state.identity)).status,"no-activity");assert.equal(schedule(state).last_local_day,null);
  state.clock.now="2026-09-02T16:00:00.000Z";state.addEvent();
  assert.equal((await state.jobs.admit(state.identity)).status,"outside-window");assert.equal(count(state,"memory_shadow_jobs"),0);
  const fallback=fixture(t,{clock:{now:"2026-09-02T02:00:00.000Z"}});fallback.addEvent();
  await fallback.jobs.register(fallback.identity,{timeZone:"not/a-zone"});assert.equal(schedule(fallback).time_zone,"UTC");
  assert.equal((await fallback.jobs.admit(fallback.identity)).status,"admitted");
});

test("clock rewind and repeated DST hour do not create another nightly review",async(t)=>{
  const state=fixture(t,{clock:{now:"2026-11-01T05:20:00.000Z"}});
  state.changeAuthority((value)=>{value.access.enrollmentExpiresAt="2026-12-01T00:00:00.000Z";
    for(const grant of value.access.grants)grant.expiresAt="2026-12-01T00:00:00.000Z";});
  state.addEvent({at:"2026-10-31T14:00:00.000Z",binding:{expiresAt:"2026-12-01T00:00:00.000Z"}});
  await state.jobs.register(state.identity,{timeZone:"America/New_York"});await complete(state);
  state.clock.now="2026-11-01T06:20:00.000Z";
  state.addEvent({at:"2026-11-01T05:30:00.000Z",binding:{expiresAt:"2026-12-01T00:00:00.000Z"}});
  assert.equal((await state.jobs.admit(state.identity)).status,"throttled");
  state.clock.now="2026-11-01T04:20:00.000Z";
  await assert.rejects(()=>state.jobs.admit(state.identity),/memory-clock-rewind/);assert.equal(count(state,"memory_shadow_jobs"),1);
});

test("competing claims yield one token; expiry changes the token and fences stale workers",async(t)=>{
  const state=await prepared(t),other=new MemoryReviewJobs(state.adapter,state.store);await state.jobs.admit(state.identity);
  const claims=await Promise.all([state.jobs.claim(state.identity),other.claim(state.identity)]);
  const index=claims.findIndex((row)=>row.kind);assert.notEqual(index,-1);assert.equal(claims[1-index].status,"busy");
  const winner=index===0?state.jobs:other,old=claims[index],oldToken=currentJob(state).lease_token;
  state.clock.now="2026-09-02T06:01:01.000Z";const fresh=await leaseFor(state.jobs,state.identity);
  assert.notEqual(currentJob(state).lease_token,oldToken);assert.equal(currentJob(state).attempts,2);
  state.controls.queries.length=0;
  assert.equal((await winner.execute(old)).status,"lease-lost");
  assert.equal(state.controls.queries.some((sql)=>sql.includes("FROM private_content")),false);
  assert.equal((await state.jobs.execute(fresh)).status,"completed");assert.equal(count(state,"memory_shadow_reviews"),1);
});

test("lease renewal does not stale its own source snapshot and cannot extend forever",async(t)=>{
  const state=await prepared(t);let lease;
  const jobs=new MemoryReviewJobs(state.adapter,state.store,{derive:async(input)=>{
    const before=state.sqlite.prepare("SELECT generation FROM memory_shadow_partitions").get();
    state.clock.now="2026-09-02T06:00:30.000Z";await jobs.renew(lease);
    assert.deepEqual(state.sqlite.prepare("SELECT generation FROM memory_shadow_partitions").get(),before);
    return deriveMemoryReview(input);
  }});
  await jobs.admit(state.identity);lease=await leaseFor(jobs,state.identity);
  assert.equal((await jobs.execute(lease)).status,"completed");
  const limited=await prepared(t);await limited.jobs.admit(limited.identity);const token=await leaseFor(limited.jobs,limited.identity);
  for(const seconds of [55,110,165,220,275]){
    limited.clock.now=new Date(Date.parse("2026-09-02T06:00:00.000Z")+seconds*1000).toISOString();await limited.jobs.renew(token);
  }
  assert.equal(currentJob(limited).lease_expires_at,"2026-09-02T06:05:00.000Z");limited.clock.now="2026-09-02T06:05:00.000Z";
  await assert.rejects(()=>limited.jobs.renew(token),/invalid-memory-publication-deadline|renewal-limit/);
});

test("saved admission cutoff resumes during daytime and leaves later activity for the next night",async(t)=>{
  const state=await prepared(t);await state.jobs.admit(state.identity);const original=currentJob(state).plan_json;
  state.addEvent({at:"2026-09-02T08:00:00.000Z"});state.clock.now="2026-09-02T16:00:00.000Z";
  const restarted=new MemoryReviewJobs(state.adapter,state.store),lease=await leaseFor(restarted,state.identity);
  assert.equal((await restarted.execute(lease)).status,"completed");assert.equal(currentJob(state).plan_json,original);
  assert.equal(state.sqlite.prepare("SELECT sequence FROM memory_shadow_watermarks").get().sequence,9);
  assert.equal(count(state,"memory_shadow_observations"),6);
  state.clock.now="2026-09-03T06:00:00.000Z";await complete(state);
  assert.equal(state.sqlite.prepare("SELECT sequence FROM memory_shadow_watermarks").get().sequence,10);
});

for(const fragment of ["UPDATE memory_shadow_jobs SET status='completed'","INSERT INTO memory_shadow_watermarks(",
  "INSERT INTO memory_shadow_reviews(","UPDATE memory_shadow_partitions SET generation"]){
  test(`publication and job completion roll back together when ${fragment} fails`,async(t)=>{
    const state=await prepared(t);await state.jobs.admit(state.identity);const lease=await leaseFor(state.jobs,state.identity);let failed=false;
    state.controls.beforeStatement=(sql)=>{if(!failed&&sql.startsWith(fragment)){failed=true;throw new Error("injected private detail");}};
    assert.equal((await state.jobs.execute(lease)).status,"retry");assert.equal(failed,true);
    for(const table of ["memory_shadow_private_bodies","memory_shadow_records","memory_shadow_watermarks","memory_shadow_reviews","memory_shadow_sources"])
      assert.equal(count(state,table),0,table);
    assert.equal(currentJob(state).status,"retry");assert.equal(currentJob(state).failure_code,"source-unavailable");
    assert.equal(count(state,"memory_shadow_atomic_guards"),0);
  });
}

for(const boundary of ["batch","body","completion","final-cas"]){
  test(`lease expiry at publication ${boundary} cannot publish bodies or advance a watermark`,async(t)=>{
    const state=await prepared(t);await state.jobs.admit(state.identity);const lease=await leaseFor(state.jobs,state.identity);let crossed=false;
    const cross=()=>{crossed=true;state.clock.now="2026-09-02T06:01:00.000Z";};
    if(boundary==="batch")state.controls.beforeBatch=(statements)=>{if(publication(statements))cross();};
    else state.controls.beforeStatement=(sql)=>{
      if(!crossed&&((boundary==="body"&&sql.startsWith("INSERT INTO memory_shadow_private_bodies"))
        ||(boundary==="completion"&&sql.startsWith("UPDATE memory_shadow_jobs SET status='completed'"))
        ||(boundary==="final-cas"&&sql.startsWith("UPDATE memory_shadow_partitions SET generation"))))cross();
    };
    assert.equal((await state.jobs.execute(lease)).status,"lease-lost");assert.equal(crossed,true);
    assert.equal(count(state,"memory_shadow_private_bodies"),0);assert.equal(count(state,"memory_shadow_reviews"),0);
    assert.equal(count(state,"memory_shadow_watermarks"),0);assert.equal(currentJob(state).status,"running");
    state.controls.beforeBatch=null;state.controls.beforeStatement=null;
    assert.equal((await state.jobs.execute(await leaseFor(state.jobs,state.identity))).status,"completed");
  });
}

test("retries persist backoff and the admitted attempt limit across worker replacement",async(t)=>{
  let calls=0;const state=await prepared(t,{}, {maxAttempts:2,retryMs:1000,derive:async()=>{calls++;throw new Error("secret source prose");}});
  await state.jobs.admit(state.identity);
  assert.equal((await state.jobs.execute(await leaseFor(state.jobs,state.identity))).status,"retry");
  assert.equal((await state.jobs.claim(state.identity)).status,"backoff");state.clock.now="2026-09-02T06:00:01.000Z";
  const replacement=new MemoryReviewJobs(state.adapter,state.store,{maxAttempts:5,derive:async()=>{calls++;throw new Error("another secret");}});
  assert.equal((await replacement.execute(await leaseFor(replacement,state.identity))).status,"failed");assert.equal(calls,2);
  assert.equal(currentJob(state).max_attempts,2);assert.equal(currentJob(state).failure_code,"worker-failed");
  assert.equal(JSON.stringify(currentJob(state)).includes("secret"),false);assert.equal((await replacement.claim(state.identity)).status,"idle");
  state.clock.now="2026-09-03T06:00:00.000Z";
  assert.equal((await replacement.admit(state.identity)).status,"failed");assert.equal(count(state,"memory_shadow_jobs"),1);
});

test("a second night creates only new immutable snapshots and restores consumption and rolling coverage",async(t)=>{
  const state=await prepared(t);const lease=await complete(state),before=await state.store.read(state.identity,MEMORY_REVIEW_RECIPE);
  assert.equal(before.records.length,8);const metadata=state.sqlite.prepare("SELECT record_id,metadata_json FROM memory_shadow_records ORDER BY record_id").all();
  state.addEvent({at:"2026-09-02T14:00:00.000Z"});state.addChat("turn-3","Retain the source caption.","The source caption can stay.");
  state.clock.now="2026-09-03T06:00:00.000Z";await complete(state);
  const after=await state.store.read(state.identity,MEMORY_REVIEW_RECIPE);
  assert.equal(after.records.length,12);assert.equal(after.observations.length,8);assert.equal(after.consumption.length,2);
  for(const old of metadata)assert.equal(state.sqlite.prepare("SELECT metadata_json FROM memory_shadow_records WHERE record_id=?").get(old.record_id).metadata_json,old.metadata_json);
  const coverage=await memoryConversationCoverage({inventory:after.conversations[0],segments:after.segments,recentLimit:2},after.sources,after.access,after.graph,after.suppressions);
  assert.equal(coverage.continuous,true);assert.equal(coverage.omittedTurnIds.length,0);assert.equal(coverage.summarizedTurnIds.length,4);
  state.controls.queries.length=0;assert.equal((await state.jobs.execute(lease)).status,"completed");
  assert.equal(state.controls.queries.some((sql)=>sql.includes("FROM private_content")),false);
});

test("authority withdrawal during derivation prevents publication and later claims cancel the job",async(t)=>{
  const state=await prepared(t),jobs=new MemoryReviewJobs(state.adapter,state.store,{derive:async(input)=>{
    const output=await deriveMemoryReview(input);state.changeAuthority((value)=>{value.access.enabled=false;value.access.fence.permission++;});return output;
  }});
  await jobs.admit(state.identity);assert.equal((await jobs.execute(await leaseFor(jobs,state.identity))).status,"retry");
  assert.equal(count(state,"memory_shadow_private_bodies"),0);assert.equal(count(state,"memory_shadow_watermarks"),0);
  state.clock.now="2026-09-02T06:01:00.000Z";assert.equal((await jobs.claim(state.identity)).status,"cancelled");
});

test("forgetting between derivation and publication invalidates the captured job without resurrecting lineage",async(t)=>{
  const state=await prepared(t);await complete(state);state.addEvent();state.clock.now="2026-09-03T06:00:00.000Z";
  let forgotten;
  const jobs=new MemoryReviewJobs(state.adapter,state.store,{derive:async(input)=>{
    const output=await deriveMemoryReview(input),view=await state.store.read(state.identity,MEMORY_REVIEW_RECIPE);
    forgotten=view.records.find((record)=>record.kind==="workflow-pattern");
    await state.store.forget(await state.store.capture(state.identity,MEMORY_REVIEW_RECIPE,"recall"),forgotten.id);return output;
  }});
  await jobs.admit(state.identity);assert.equal((await jobs.execute(await leaseFor(jobs,state.identity))).status,"retry");
  assert.equal(count(state,"memory_shadow_reviews"),1);assert.equal(state.sqlite.prepare("SELECT sequence FROM memory_shadow_watermarks").get().sequence,9);
  assert.equal(state.sqlite.prepare("SELECT state FROM memory_shadow_records WHERE record_id=?").get(forgotten.id).state,"erased");
  const remaining=await state.store.read(state.identity,MEMORY_REVIEW_RECIPE);
  assert.equal(remaining.records.some((record)=>record.sources.some((source)=>forgotten.sources.some((old)=>old.lineageId===source.lineageId))),false);
  state.clock.now="2026-09-03T06:01:00.000Z";
  assert.equal((await jobs.execute(await leaseFor(jobs,state.identity))).status,"cancelled");
});

test("job identity snapshots and lease ownership isolate actors and custodians",async(t)=>{
  const alpha=await prepared(t);await alpha.jobs.admit(alpha.identity);
  const bob=memoryPersistenceFixture({database:alpha,actor:"bob",owner:"bob-owner"});bob.addEvent();
  const bobJobs=new MemoryReviewJobs(bob.adapter,bob.store);await bobJobs.register(bob.identity,{timeZone:"America/New_York"});await bobJobs.admit(bob.identity);
  const beta=memoryPersistenceFixture({database:alpha,custodian:"org:beta",owner:"beta-owner"});beta.addEvent({id:"beta-event"});
  const betaJobs=new MemoryReviewJobs(beta.adapter,beta.store);await betaJobs.register(beta.identity,{timeZone:"America/New_York"});await betaJobs.admit(beta.identity);
  const mutable={...alpha.identity};let changed=false;
  alpha.controls.beforeStatement=()=>{if(!changed){changed=true;Object.assign(mutable,bob.identity);}};
  const aliceLease=await leaseFor(alpha.jobs,mutable);alpha.controls.beforeStatement=null;
  assert.equal(currentJob(alpha).status,"running");assert.equal(currentJob(bob).status,"queued");assert.equal(currentJob(beta).status,"queued");
  const bobLease=await leaseFor(bobJobs,bob.identity),betaLease=await leaseFor(betaJobs,beta.identity);
  await assert.rejects(()=>bobJobs.execute(aliceLease),/unissued-memory-review-lease/);
  await alpha.jobs.register(alpha.identity,{timeZone:"America/New_York",enabled:false});
  assert.equal((await alpha.jobs.execute(aliceLease)).status,"lease-lost");
  assert.equal((await bobJobs.execute(bobLease)).status,"completed");assert.equal((await betaJobs.execute(betaLease)).status,"completed");
  assert.equal(alpha.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_shadow_private_bodies WHERE actor_user_id='alice' AND custodian_id='org:alpha'").get().n,0);
});

test("pausing a schedule cancels its job and fences an already issued lease",async(t)=>{
  const state=await prepared(t);await state.jobs.admit(state.identity);const lease=await leaseFor(state.jobs,state.identity);
  assert.equal((await state.jobs.register(state.identity,{timeZone:"America/New_York",enabled:false})).status,"updated");
  assert.equal(currentJob(state).status,"cancelled");assert.equal(currentJob(state).failure_code,"schedule-changed");
  assert.equal((await state.jobs.execute(lease)).status,"lease-lost");assert.equal(count(state,"memory_shadow_private_bodies"),0);
});

test("pause and re-enable can resume the same plan next night without resetting its attempts",async(t)=>{
  const state=await prepared(t);await state.jobs.admit(state.identity);const lease=await leaseFor(state.jobs,state.identity),original=currentJob(state);
  await state.jobs.register(state.identity,{timeZone:"America/New_York",enabled:false});
  await state.jobs.register(state.identity,{timeZone:"America/New_York",enabled:true});
  assert.equal((await state.jobs.admit(state.identity)).status,"throttled");
  state.clock.now="2026-09-03T06:00:00.000Z";assert.equal((await state.jobs.admit(state.identity)).status,"admitted");
  assert.equal(count(state,"memory_shadow_jobs"),1);assert.equal(currentJob(state).job_id,original.job_id);
  assert.equal(currentJob(state).attempts,1);assert.equal(currentJob(state).max_attempts,3);
  assert.equal((await state.jobs.execute(lease)).status,"lease-lost");
  assert.equal((await state.jobs.execute(await leaseFor(state.jobs,state.identity))).status,"completed");
});

test("valid Unicode-heavy conversation chunks stay within the UTF-8 body limit on successive nights",async(t)=>{
  const state=fixture(t);
  for(let index=0;index<9;index++)state.addChat(`unicode-${index}`,"🙂".repeat(160),"🙂".repeat(160));
  await state.jobs.register(state.identity,{timeZone:"America/New_York"});await complete(state);
  const before=await state.store.read(state.identity,MEMORY_REVIEW_RECIPE);
  assert.equal(before.segments.length,2);assert.equal(before.segments.reduce((sum,segment)=>sum+segment.covered.length,0),16);
  assert.equal(before.segments.every((segment)=>new TextEncoder().encode(segment.record.body).byteLength<=8192),true);
  state.addChat("unicode-next","🙂".repeat(160),"🙂".repeat(160));state.clock.now="2026-09-03T06:00:00.000Z";await complete(state);
  assert.equal(count(state,"memory_shadow_reviews"),2);
  assert.equal((await state.store.read(state.identity,MEMORY_REVIEW_RECIPE)).segments.every((segment)=>new TextEncoder().encode(segment.record.body).byteLength<=8192),true);
});

test("the maximum valid source batch has publication headroom for its derived workflow record",async(t)=>{
  const state=fixture(t);
  for(let index=0;index<128;index++)state.addEvent({episodeId:`independent-session-${index}`});
  await state.jobs.register(state.identity,{timeZone:"America/New_York"});await complete(state);
  assert.equal(count(state,"memory_shadow_sources"),128);assert.equal(count(state,"memory_shadow_observations"),128);
  assert.equal(count(state,"memory_shadow_records"),129);assert.equal(count(state,"memory_shadow_private_bodies"),129);
  assert.equal(currentJob(state).attempts,1);assert.equal(state.sqlite.prepare("SELECT sequence FROM memory_shadow_watermarks").get().sequence,128);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_shadow_dependencies").get().n,256);
});

test("daytime opt-out cleanup still runs for paused scopes without reading source prose",async(t)=>{
  const state=await prepared(t);const first=await state.jobs.tick("synthetic-scheduled");assert.equal(first.completed,1);
  await state.jobs.register(state.identity,{timeZone:"America/New_York",enabled:false});
  state.changeAuthority((value)=>{value.access.enabled=false;});state.clock.now="2026-09-02T16:00:00.000Z";state.controls.queries.length=0;
  const result=await state.jobs.tick();assert.equal(result.maintenanceErased,8);assert.equal(result.admitted,0);
  assert.equal(count(state,"memory_shadow_private_bodies"),0);assert.equal(schedule(state).maintenance_status,"complete");
  assert.equal(state.controls.queries.some((sql)=>/\b(?:FROM|JOIN) (?:private_content|event_private_payloads)\b/u.test(sql)),false);
  const receipts=state.sqlite.prepare("SELECT trigger_kind,status FROM memory_shadow_review_runs ORDER BY started_at").all();
  assert.deepEqual(receipts.map((row)=>[row.trigger_kind,row.status]),[["synthetic-scheduled","completed"],["manual","completed"]]);
});

test("expired memory is erased even when pending chat defers source-dependent maintenance",async(t)=>{
  const state=await prepared(t);state.changeBinding("alice-event-1",(value)=>{value.expiresAt="2026-09-02T07:00:00.000Z";});
  await state.jobs.tick();state.clock.now="2026-09-02T16:00:00.000Z";
  state.addChat("pending");state.sqlite.prepare("UPDATE assistant_turns SET status='running' WHERE turn_id='pending'").run();
  const result=await state.jobs.tick();assert.equal(result.maintenanceErased,1);assert.equal(result.maintenanceDeferred,1);
  assert.equal(count(state,"memory_shadow_private_bodies"),7);assert.equal(schedule(state).maintenance_status,"deferred");
  assert.equal(count(state,"memory_shadow_jobs"),1);
});

test("a scope schedule race cannot prevent privacy cleanup of later registered scopes",async(t)=>{
  const alpha=await prepared(t);await complete(alpha);
  const beta=memoryPersistenceFixture({database:alpha,custodian:"org:beta",owner:"beta-owner"});beta.addEvent({id:"beta-event"});
  const betaJobs=new MemoryReviewJobs(beta.adapter,beta.store);await betaJobs.register(beta.identity,{timeZone:"America/New_York"});
  await betaJobs.admit(beta.identity);await betaJobs.execute(await leaseFor(betaJobs,beta.identity));
  alpha.changeAuthority((value)=>{value.access.enabled=false;});beta.changeAuthority((value)=>{value.access.enabled=false;});
  alpha.clock.now="2026-09-02T16:00:00.000Z";let raced=false;
  alpha.controls.beforeBatch=(statements)=>{
    if(!raced&&statements.some((statement)=>statement.sql.startsWith("UPDATE memory_shadow_schedules SET last_maintenance_at="))){
      raced=true;alpha.sqlite.prepare("UPDATE memory_shadow_schedules SET revision=revision+1,review_enabled=0 WHERE custodian_id='org:alpha'").run();
    }
  };
  const result=await alpha.jobs.tick();assert.equal(raced,true);assert.equal(result.maintenanceErased,9);
  assert.equal(result.maintenanceDeferred,1);assert.equal(count(alpha,"memory_shadow_private_bodies"),0);
  assert.equal(schedule(beta).maintenance_status,"complete");
});

test("run receipts describe actual invocations, retain interrupted runs and bound terminal history",async(t)=>{
  const state=fixture(t);await assert.rejects(()=>state.jobs.tick("hosted-cron"),/invalid-memory-run-trigger/);
  const insert=state.sqlite.prepare("INSERT INTO memory_shadow_review_runs(run_id,trigger_kind,started_at,status) VALUES(?,'manual',?,?)");
  insert.run("interrupted","2026-09-01T01:00:00.000Z","running");
  for(let index=0;index<140;index++)insert.run(`old-${index}`,"2026-09-01T02:00:00.000Z","completed");
  const result=await state.jobs.tick();assert.equal(result.registeredScopes,0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_shadow_review_runs WHERE status!='running'").get().n,128);
  assert.equal(state.sqlite.prepare("SELECT status FROM memory_shadow_review_runs WHERE run_id='interrupted'").get().status,"running");
  assert.equal(state.sqlite.prepare("SELECT status FROM memory_shadow_review_runs WHERE run_id=?").get(result.runId).status,"completed");
});

test("an unconfirmed run-completion write is recorded as an error rather than a successful invocation",async(t)=>{
  const state=fixture(t);let failed=false;
  state.controls.beforeStatement=(sql)=>{if(!failed&&sql.startsWith("UPDATE memory_shadow_review_runs SET status='completed'")){
    failed=true;throw new Error("private database diagnostic");
  }};
  await assert.rejects(()=>state.jobs.tick(),/memory-job-write-rejected/);assert.equal(failed,true);
  const row=state.sqlite.prepare("SELECT * FROM memory_shadow_review_runs").get();assert.equal(row.status,"error");
  assert.equal(JSON.stringify(row).includes("private database diagnostic"),false);
});

for(const boundary of ["admission","claim","commit"]){
  test(`a process exit after ${boundary} recovers from the durable job without duplicate publication`,async(t)=>{
    const directory=mkdtempSync(join(tmpdir(),"forma-memory-job-crash-")),path=join(directory,"synthetic.sqlite");
    t.after(()=>rmSync(directory,{recursive:true,force:true}));
    const helper=new URL("./helpers/memory-persistence.mjs",import.meta.url).href,jobsModule=new URL("../worker/memory-review-jobs.ts",import.meta.url).href;
    const script=`import {memoryPersistenceFixture,installMemoryJobTestSchema,seedMemoryDocument} from ${JSON.stringify(helper)};
      import {MemoryReviewJobs} from ${JSON.stringify(jobsModule)};
      globalThis.fetch=()=>{throw new Error("Offline fixture only");};
      const state=memoryPersistenceFixture({path:process.argv[1]});installMemoryJobTestSchema(state.sqlite);seedMemoryDocument(state);
      const jobs=new MemoryReviewJobs(state.adapter,state.store);await jobs.register(state.identity,{timeZone:"America/New_York"});
      state.controls.afterBatch=(statements)=>{
        const target=${JSON.stringify(boundary)};
        if(statements.some((row)=>target==="admission"?row.sql.startsWith("INSERT INTO memory_shadow_jobs(")
          :target==="claim"?row.sql.startsWith("UPDATE memory_shadow_jobs SET status='running'")
          :row.sql.startsWith("UPDATE memory_shadow_jobs SET status='completed'")))process.exit(0);
      };
      await jobs.admit(state.identity);const lease=await jobs.claim(state.identity);await jobs.execute(lease);process.exit(7);`;
    await execute(process.execPath,["--experimental-strip-types","--input-type=module","-e",script,path],{env:{},timeout:20000,maxBuffer:100000});
    const state=fixture(t,{path,clock:{now:"2026-09-02T16:00:00.000Z"}});state.addEvent({at:"2026-09-02T12:00:00.000Z"});
    const result=await state.jobs.tick();assert.equal(result.completed,boundary==="commit"?0:1);
    assert.equal(count(state,"memory_shadow_reviews"),1);assert.equal(count(state,"memory_shadow_private_bodies"),8);
    assert.equal(currentJob(state).status,"completed");assert.equal(state.sqlite.prepare("SELECT sequence FROM memory_shadow_watermarks").get().sequence,9);
  });
}

test("the review-job evaluator reproduces its checked report with no inherited credentials",async()=>{
  const script=new URL("../scripts/evaluate-memory-review-jobs.mjs",import.meta.url);
  const {stdout}=await execute(process.execPath,["--experimental-strip-types",script.pathname],{env:{},timeout:20000,maxBuffer:100000});
  const expected=JSON.parse(readFileSync(new URL("../docs/forma-memory-review-jobs-evaluation-2026-09-02.json",import.meta.url),"utf8"));
  assert.deepEqual(JSON.parse(stdout),expected);
  await assert.rejects(()=>execute(process.execPath,["--experimental-strip-types",script.pathname,"--live"],{env:{},timeout:20000,maxBuffer:100000}),/bundled synthetic fixture/);
});
