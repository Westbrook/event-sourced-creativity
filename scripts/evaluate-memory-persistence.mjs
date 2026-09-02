import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  draftMemoryReview,memoryMigrationHash,memoryPersistenceFixture,seedMemoryDocument,
} from "../tests/helpers/memory-persistence.mjs";
import { memoryDigest,memoryKey } from "../src/model/scoped-memory.ts";

// No supplied paths, credentials, live data, provider options or network calls.
assert.equal(process.argv.length,2,"This evaluator only runs its bundled synthetic fixture.");
globalThis.fetch=()=>{throw new Error("Network access is forbidden in the offline memory evaluator");};
const execute=promisify(execFile),directory=await mkdtemp(join(tmpdir(),"forma-memory-evaluation-")),path=join(directory,"synthetic.sqlite");
let state=null,report;
const close=()=>{state?.close();state=null;};
try {
  state=memoryPersistenceFixture({path});seedMemoryDocument(state);
  const draft=await draftMemoryReview(state),published=await state.store.publish(draft);
  assert.equal(published.status,"committed");
  const before=await state.store.read(state.identity);
  const beforeDigest=await memoryDigest(JSON.stringify({records:before.records,consumption:before.consumption}));
  const workflow=before.records.find((record)=>record.kind==="workflow-pattern");assert.ok(workflow);
  close();

  // The child has no inherited environment and reconstructs everything from the
  // temporary database. Its stdout contains counts/hashes, never summary prose.
  const helper=new URL("../tests/helpers/memory-persistence.mjs",import.meta.url).href;
  const scoped=new URL("../src/model/scoped-memory.ts",import.meta.url).href;
  const conversation=new URL("../src/model/memory-conversation.ts",import.meta.url).href;
  const shadow=new URL("../worker/memory-shadow.ts",import.meta.url).href;
  const script=`import assert from "node:assert/strict";
    import {memoryPersistenceFixture} from ${JSON.stringify(helper)};
    import {memoryDigest} from ${JSON.stringify(scoped)};
    import {memoryConversationCoverage} from ${JSON.stringify(conversation)};
    import {assembleMemoryShadow,planMemoryReview} from ${JSON.stringify(shadow)};
    globalThis.fetch=()=>{throw new Error("Offline evaluator");};
    const state=memoryPersistenceFixture({path:process.argv[1]});
    try {
      const view=await state.store.read(state.identity);
      const coverage=await memoryConversationCoverage({inventory:view.conversations[0],segments:view.segments,recentLimit:2},view.sources,view.access,view.graph,view.suppressions);
      const context={task:"Keep the approved heading",capabilities:["read"]};
      const preview=assembleMemoryShadow({mode:"shadow",context,query:"chart edit",...view});
      assert.equal(preview.context,context);
      const idle=await planMemoryReview({mode:"shadow",...view,processed:view.inventory.from,recipeVersion:"document-memory-v1",timeZone:"America/New_York"});
      const plan=JSON.parse(state.sqlite.prepare("SELECT plan_json FROM memory_shadow_reviews").get().plan_json);
      const replay=await state.store.publish({capture:await state.store.capture(state.identity),plan,records:view.records,segments:view.segments});
      assert.equal(replay.status,"already-committed");
      process.stdout.write(JSON.stringify({
        digest:await memoryDigest(JSON.stringify({records:view.records,consumption:view.consumption})),
        records:view.records.length,reviewRows:state.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_shadow_reviews").get().n,
        cursor:view.inventory.from,replay:replay.status,idle:idle.status,
        consumption:view.consumption.map(({target,episodes,outcomes,actions})=>({kind:target.kind,episodes,outcomes,actions})),
        conversation:{method:view.segments[0].method,summarizedTurns:coverage.summarizedTurnIds.length,recentTurns:coverage.recentTurnIds.length,
          omittedTurns:coverage.omittedTurnIds.length,continuous:coverage.continuous},
        recall:{method:preview.retrieval,selected:preview.references.length,serializedBytes:preview.bytes,maxBytes:16384,currentContextUnchanged:preview.context===context}
      }));
    } finally {state.close();}`;
  const child=await execute(process.execPath,["--experimental-strip-types","--input-type=module","-e",script,path],
    {env:{},timeout:20000,maxBuffer:100000});
  const reopened=JSON.parse(child.stdout);
  assert.equal(reopened.digest,beforeDigest);assert.equal(reopened.records,8);
  assert.equal(reopened.reviewRows,1);assert.equal(reopened.idle,"no-activity");
  assert.equal(reopened.conversation.continuous,true);assert.ok(reopened.recall.selected>0);

  state=memoryPersistenceFixture({path});
  const forgotten=await state.store.forget(await state.store.capture(state.identity,"document-memory-v1","recall"),workflow.id);
  assert.equal(forgotten.erased,4);close();
  state=memoryPersistenceFixture({path});
  const afterForget=await state.store.read(state.identity);
  assert.equal(afterForget.records.length,4);
  assert.equal(afterForget.records.some((record)=>record.sources.some((source)=>workflow.sources.some((old)=>old.id===source.id))),false);
  const copy=state.addEvent({lineageId:workflow.sources[0].lineageId,payload:{copied_from_block_id:"block"}});
  const capture=await state.store.capture(state.identity),evidence=state.store.evidence(capture);
  assert.equal(evidence.sources.get(memoryKey(state.custodian,copy.id)).state,"erased");
  assert.equal(evidence.observations.some((observation)=>observation.eventId===copy.id),false);
  state.changeAuthority((value)=>{value.access.enabled=false;value.access.fence.permission++;});
  await assert.rejects(()=>state.store.read(state.identity),/memory-source-access-denied/);
  state.controls.queries.length=0;
  const revoked=await state.store.maintain(state.identity);
  assert.equal(revoked.erased,4);
  const privateBodyRows=state.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_shadow_private_bodies").get().n;
  const upsertIntents=state.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_shadow_index_outbox WHERE operation='upsert'").get().n;
  const privateSourceReads=state.controls.queries.filter((sql)=>/\b(?:FROM|JOIN) (?:private_content|event_private_payloads)\b/u.test(sql)).length;
  assert.equal(privateBodyRows,0);assert.equal(upsertIntents,0);assert.equal(privateSourceReads,0);

  report={
    schemaVersion:1,mode:"offline-synthetic-sqlite",fixtureTime:before.access.now,migrationHash:memoryMigrationHash,
    defaultActivation:"off",productionActivationImplemented:false,
    normalizedInteractions:{total:draft.evidence.observations.length,
      nonChat:draft.evidence.observations.filter((row)=>row.eventType!=="ChatMessageSent").length,
      privateChat:draft.evidence.observations.filter((row)=>row.eventType==="ChatMessageSent").length},
    sourceInterval:{scannedRows:draft.evidence.scannedRows,eligibleSources:draft.evidence.sources.size,capturedCutoff:reopened.cursor},
    persistence:{engine:"SQLite through D1-compatible local harness",temporaryFile:true,readInSeparateProcess:true,
      recordsRestored:reopened.records,recordsAndConsumptionUnchanged:true,committedReviews:reopened.reviewRows,replay:reopened.replay,idleAdmission:reopened.idle},
    consumption:reopened.consumption,conversation:reopened.conversation,recall:reopened.recall,
    forgetting:{dependentRecordsErased:forgotten.erased,privacyGeneration:forgotten.privacyGeneration,survivesReopen:true,copiedLineageSuppressed:true},
    revocation:{remainingRecordsErased:revoked.erased,privateBodyRows,upsertIntents,privateSourceReads,sourceReview:revoked.sourceReview},
    localMemoryWrites:true,remoteDatabaseCalls:0,providerCalls:0,
    limitations:["Synthetic policy resolver only; no live authority or event ingestion",
      "Local SQLite verification, not a deployed D1 or index test",
      "Extractive summaries and lexical recall, not evaluated semantic models",
      "No durable job admission, scheduler, provider budget or index consumer",
      "Logical current-row erasure; body-free tombstones remain and backup restoration is not implemented",
      "No serving-path, UI, shared migration or deployment changes"],
  };
} finally {close();await rm(directory,{recursive:true,force:true});}
process.stdout.write(JSON.stringify(report,null,2)+"\n");
