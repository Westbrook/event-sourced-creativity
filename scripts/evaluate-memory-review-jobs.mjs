import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { installMemoryJobTestSchema,memoryJobMigrationHash,memoryMigrationHash,memoryPersistenceFixture,seedMemoryDocument } from "../tests/helpers/memory-persistence.mjs";
import { MemoryReviewJobs } from "../worker/memory-review-jobs.ts";
import { MEMORY_REVIEW_RECIPE } from "../worker/memory-review-recipe.ts";
import { memoryConversationCoverage } from "../src/model/memory-conversation.ts";

// A self-contained offline evaluation: no supplied databases, credentials,
// runtime initializer, provider, live authorization or scheduler configuration.
assert.equal(process.argv.length,2,"This evaluator only runs its bundled synthetic fixture.");
globalThis.fetch=()=>{throw new Error("Network access is forbidden in the offline memory evaluator");};
const execute=promisify(execFile),directory=await mkdtemp(join(tmpdir(),"forma-memory-job-evaluation-")),path=join(directory,"synthetic.sqlite");
let state=null,report;
const close=()=>{state?.close();state=null;};
const rowCount=(table)=>state.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
try {
  state=memoryPersistenceFixture({path});installMemoryJobTestSchema(state.sqlite);seedMemoryDocument(state);
  const initialJobs=new MemoryReviewJobs(state.adapter,state.store);
  await initialJobs.register(state.identity,{timeZone:"America/New_York"});
  const admitted=await initialJobs.admit(state.identity);assert.equal(admitted.status,"admitted");
  const claimed=await initialJobs.claim(state.identity);assert.equal(claimed.kind,"issued-memory-review-lease");
  const initial=state.sqlite.prepare("SELECT plan_json,attempts,max_attempts FROM memory_shadow_jobs").get();
  assert.equal(rowCount("memory_shadow_watermarks"),0);assert.equal(rowCount("memory_shadow_private_bodies"),0);close();

  // A new process has an empty environment. It reclaims the expired lease during
  // daytime, appends a new event, and exits immediately AFTER the atomic commit,
  // before execute() receives its database acknowledgement.
  const helper=new URL("../tests/helpers/memory-persistence.mjs",import.meta.url).href;
  const jobsModule=new URL("../worker/memory-review-jobs.ts",import.meta.url).href;
  const script=`import assert from "node:assert/strict";
    import {memoryPersistenceFixture,installMemoryJobTestSchema} from ${JSON.stringify(helper)};
    import {MemoryReviewJobs} from ${JSON.stringify(jobsModule)};
    globalThis.fetch=()=>{throw new Error("Offline fixture only");};
    const state=memoryPersistenceFixture({path:process.argv[1],clock:{now:"2026-09-02T16:00:00.000Z"}});
    installMemoryJobTestSchema(state.sqlite);state.addEvent({at:"2026-09-02T12:00:00.000Z"});
    const jobs=new MemoryReviewJobs(state.adapter,state.store),lease=await jobs.claim(state.identity);
    assert.equal(lease.kind,"issued-memory-review-lease");
    state.controls.afterBatch=(statements)=>{
      if(statements.some((row)=>row.sql.startsWith("UPDATE memory_shadow_jobs SET status='completed'")))process.exit(0);
    };
    await jobs.execute(lease);process.exit(7);`;
  await execute(process.execPath,["--experimental-strip-types","--input-type=module","-e",script,path],{env:{},timeout:20000,maxBuffer:100000});

  state=memoryPersistenceFixture({path,clock:{now:"2026-09-02T16:00:00.000Z"}});installMemoryJobTestSchema(state.sqlite);
  const recovered=state.sqlite.prepare("SELECT * FROM memory_shadow_jobs").get();
  assert.equal(recovered.status,"completed");assert.equal(recovered.attempts,2);assert.equal(recovered.plan_json,initial.plan_json);
  assert.equal(rowCount("memory_shadow_reviews"),1);assert.equal(rowCount("memory_shadow_private_bodies"),8);
  assert.equal(state.sqlite.prepare("SELECT sequence FROM memory_shadow_watermarks").get().sequence,9);
  const first=await state.store.read(state.identity,MEMORY_REVIEW_RECIPE);assert.equal(first.records.length,8);
  let unexpectedDerivations=0;
  const replayJobs=new MemoryReviewJobs(state.adapter,state.store,{derive:async()=>{unexpectedDerivations++;throw new Error("Completed work must not rederive");}});
  const replay=await replayJobs.tick("manual");assert.equal(replay.completed,0);assert.equal(unexpectedDerivations,0);

  state.addChat("turn-3","Keep the original source caption.","I can preserve the source caption.");
  state.clock.now="2026-09-03T06:00:00.000Z";
  const jobs=new MemoryReviewJobs(state.adapter,state.store),secondRun=await jobs.tick("synthetic-scheduled");
  assert.equal(secondRun.admitted,1);assert.equal(secondRun.completed,1);
  const second=await state.store.read(state.identity,MEMORY_REVIEW_RECIPE);assert.equal(second.records.length,12);
  for(const record of first.records)assert.deepEqual(second.records.find((candidate)=>candidate.id===record.id),record);
  const coverage=await memoryConversationCoverage({inventory:second.conversations[0],segments:second.segments,recentLimit:2},second.sources,second.access,second.graph,second.suppressions);
  assert.equal(coverage.continuous,true);assert.equal(coverage.summarizedTurnIds.length,4);
  const secondCutoff=state.sqlite.prepare("SELECT sequence FROM memory_shadow_watermarks").get().sequence;assert.equal(secondCutoff,12);
  state.clock.now="2026-09-04T06:00:00.000Z";
  const idle=await jobs.admit(state.identity);assert.equal(idle.status,"no-activity");assert.equal(rowCount("memory_shadow_jobs"),2);

  state.clock.now="2026-09-04T16:00:00.000Z";
  await jobs.register(state.identity,{timeZone:"America/New_York",enabled:false});
  state.changeAuthority((value)=>{value.access.enabled=false;value.access.fence.permission++;});state.controls.queries.length=0;
  const cleanup=await jobs.tick("manual");assert.equal(cleanup.maintenanceErased,12);assert.equal(cleanup.admitted,0);
  const privateSourceReads=state.controls.queries.filter((sql)=>/\b(?:FROM|JOIN) (?:private_content|event_private_payloads)\b/u.test(sql)).length;
  assert.equal(privateSourceReads,0);assert.equal(rowCount("memory_shadow_private_bodies"),0);
  const upsertIntents=state.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_shadow_index_outbox WHERE operation='upsert'").get().n;
  assert.equal(upsertIntents,0);
  const triggers=state.sqlite.prepare("SELECT trigger_kind,status FROM memory_shadow_review_runs ORDER BY started_at").all();
  assert.equal(triggers.every((row)=>row.status==="completed"),true);
  report={
    schemaVersion:1,mode:"offline-synthetic-sqlite",recipe:MEMORY_REVIEW_RECIPE,
    storeMigrationHash:memoryMigrationHash,jobMigrationHash:memoryJobMigrationHash,
    defaultActivation:"off",productionActivationImplemented:false,hostedScheduleConfigured:false,hostedNoTrafficRunVerified:false,
    admission:{localTimeZone:"America/New_York",capturedCutoff:JSON.parse(initial.plan_json).through,
      jobs:1,publishedWatermarksBeforeExecution:0,privateBodiesBeforeExecution:0,maxAttempts:initial.max_attempts},
    recovery:{separateCredentialFreeProcess:true,expiredLeaseReclaimed:true,attempts:recovered.attempts,
      ranOutsideQuietWindow:true,exactPlanPreserved:true,appendedEventDeferred:true,processExitAfterCommitBeforeAcknowledgement:true,
      status:recovered.status,committedReviewsAfterRecovery:1,restoredRecords:first.records.length,unexpectedDerivations},
    recurrence:{secondNightCompleted:secondRun.completed,committedReviews:rowCount("memory_shadow_reviews"),
      capturedCutoff:{[state.stream]:secondCutoff},records:second.records.length,existingSnapshotsUnchanged:true,
      persistedObservations:second.observations.length,idleAdmission:idle.status},
    conversation:{method:"extractive-v1",summarizedTurns:coverage.summarizedTurnIds.length,recentTurns:coverage.recentTurnIds.length,
      omittedTurns:coverage.omittedTurnIds.length,continuous:coverage.continuous},
    consumption:second.consumption.map(({target,episodes,outcomes,actions})=>({kind:target.kind,episodes,outcomes,actions})),
    cleanup:{ranDuringDaytime:true,reviewPaused:true,enrollmentDisabled:true,recordsErased:cleanup.maintenanceErased,
      privateBodyRows:rowCount("memory_shadow_private_bodies"),upsertIntents,privateSourceReads,admitted:cleanup.admitted},
    runReceipts:{actualInvocations:triggers.length,triggers:triggers.map((row)=>row.trigger_kind),allCompleted:true},
    uiChanges:0,remoteDatabaseCalls:0,providerCalls:0,
    limitations:["Synthetic authority and temporary SQLite only; no real-user ingestion or enrollment",
      "No shared runtime hooks, active migration, UI, assistant-context change or deployment",
      "Explicit test invocations are not a configured or verified unattended hosted schedule",
      "Extractive immutable snapshots, not a semantic personal profile or vector recall",
      "Bounded fixture scale: 32 registered scopes, 512 scanned event rows, 128 sources, 1024 retained metadata rows per partition",
      "Logical current-row erasure; tombstones and job/source-reference receipts remain; no backup erasure claim"],
  };
} finally {close();await rm(directory,{recursive:true,force:true});}
process.stdout.write(JSON.stringify(report,null,2)+"\n");
