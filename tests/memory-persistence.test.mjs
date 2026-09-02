import assert from "node:assert/strict";
import { mkdtempSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import {
  draftMemoryReview,installMemoryTestSchema,memoryMigrationHash,memoryPersistenceFixture,memoryTestDatabase,seedMemoryDocument,
} from "./helpers/memory-persistence.mjs";
import { createMemoryRecord,memoryKey } from "../src/model/scoped-memory.ts";
import { memoryConversationCoverage } from "../src/model/memory-conversation.ts";
import { assembleMemoryShadow,planMemoryReview } from "../worker/memory-shadow.ts";

const fixture=(t,options)=>{const state=memoryPersistenceFixture(options);t.after(()=>state.close());return state;};
const count=(state,table)=>state.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const storedRecord=(state,id)=>state.sqlite.prepare("SELECT * FROM memory_shadow_records WHERE actor_user_id=? AND custodian_id=? AND record_id=?").get(state.actor,state.custodian,id);
const isCommit=(statements)=>statements[0]?.sql.startsWith("INSERT INTO memory_shadow_atomic_guards");
const execute=promisify(execFile);

test("the isolated migration is repeatable and leaves existing application objects untouched",(t)=>{
  const db=memoryTestDatabase();t.after(()=>db.close());
  db.sqlite.prepare("CREATE TABLE preserved(id TEXT PRIMARY KEY,value TEXT)").run();
  db.sqlite.prepare("INSERT INTO preserved VALUES('one','keep')").run();
  assert.equal(installMemoryTestSchema(db.sqlite),true);
  assert.equal(installMemoryTestSchema(db.sqlite),false);
  assert.equal(db.sqlite.prepare("SELECT value FROM preserved").get().value,"keep");
  assert.equal(db.sqlite.prepare("SELECT migration_hash FROM memory_shadow_schema").get().migration_hash,memoryMigrationHash);
  const objects=db.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name!='preserved'").all();
  assert.equal(objects.every((row)=>row.name.startsWith("memory_shadow_")),true);
  db.sqlite.prepare("UPDATE memory_shadow_schema SET migration_hash='wrong'").run();
  assert.throws(()=>installMemoryTestSchema(db.sqlite),/fingerprint mismatch/);
});

test("an interrupted migration rolls back instead of leaving partial memory tables",(t)=>{
  const db=memoryTestDatabase();t.after(()=>db.close());
  db.sqlite.prepare("CREATE TABLE memory_shadow_sources(unrelated TEXT)").run();
  assert.throws(()=>installMemoryTestSchema(db.sqlite),/already exists/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='memory_shadow_schema'").get().n,0);
  assert.equal(db.sqlite.prepare("PRAGMA table_info(memory_shadow_sources)").all()[0].name,"unrelated");
});

test("view/edit/chat memory, coverage, consumption and review progress survive close/reopen",async(t)=>{
  const dir=mkdtempSync(join(tmpdir(),"forma-memory-persist-")),path=join(dir,"isolated.sqlite");
  let state=memoryPersistenceFixture({path});t.after(()=>{state.close();rmSync(dir,{recursive:true,force:true});});
  seedMemoryDocument(state);const draft=await draftMemoryReview(state);
  assert.equal((await state.store.publish(draft)).status,"committed");
  const before=await state.store.read(state.identity);assert.equal(before.records.length,8);
  state.close();state=memoryPersistenceFixture({path});
  const after=await state.store.read(state.identity);
  assert.deepEqual(after.records,before.records);
  assert.deepEqual(after.consumption,before.consumption);
  assert.deepEqual(after.inventory.from,{"creative:owner":9});
  const coverage=await memoryConversationCoverage({inventory:after.conversations[0],segments:after.segments,recentLimit:2},after.sources,after.access,after.graph,after.suppressions);
  assert.equal(coverage.continuous,true);assert.equal(coverage.summarizedTurnIds.length,2);assert.equal(coverage.recentTurnIds.length,2);
  const context={task:"Keep the approved heading",capabilities:["read"]};
  const recall=assembleMemoryShadow({mode:"shadow",context,query:"chart edit",...after});
  assert.equal(recall.context,context);assert.ok(recall.references.length>0);
  assert.ok(recall.bytes<=16384);
  const idle=await planMemoryReview({mode:"shadow",...after,processed:after.inventory.from,recipeVersion:"document-memory-v1",timeZone:"America/New_York"});
  assert.equal(idle.status,"no-activity");
});

for(const fragment of ["INSERT INTO memory_shadow_sources","INSERT INTO memory_shadow_private_bodies","INSERT INTO memory_shadow_dependencies",
  "INSERT INTO memory_shadow_index_outbox","INSERT INTO memory_shadow_reviews","UPDATE memory_shadow_partitions SET generation"]){
  test(`publication rolls back every write when ${fragment} fails`,async(t)=>{
    const state=fixture(t);seedMemoryDocument(state);const draft=await draftMemoryReview(state);let failed=false;
    state.controls.beforeStatement=(sql)=>{if(!failed&&sql.startsWith(fragment)){failed=true;throw new Error("injected_private_failure");}};
    await assert.rejects(()=>state.store.publish(draft),/memory-commit-rejected/);
    for(const table of ["memory_shadow_sources","memory_shadow_records","memory_shadow_private_bodies","memory_shadow_dependencies",
      "memory_shadow_segments","memory_shadow_watermarks","memory_shadow_reviews","memory_shadow_index_outbox","memory_shadow_partitions","memory_shadow_atomic_guards"])
      assert.equal(count(state,table),0,table);
  });
}

test("same-capture, restarted and ambiguous-acknowledgement retries are idempotent",async(t)=>{
  const state=fixture(t);seedMemoryDocument(state);const draft=await draftMemoryReview(state);let lost=false;
  state.controls.afterBatch=(statements)=>{if(!lost&&isCommit(statements)){lost=true;throw new Error("lost acknowledgement");}};
  assert.equal((await state.store.publish(draft)).status,"already-committed");
  assert.equal((await state.store.publish(draft)).status,"already-committed");
  const fresh=await state.store.capture(state.identity);
  assert.equal((await state.store.publish({...draft,capture:fresh})).status,"already-committed");
  assert.equal(count(state,"memory_shadow_reviews"),1);
  assert.equal(count(state,"memory_shadow_private_bodies"),draft.records.length);
  const changed=structuredClone(draft.records);changed[0].body="Conflicting output";
  await assert.rejects(()=>state.store.publish({...draft,records:changed,capture:fresh}),/conflicting-memory-review/);
});

test("concurrent identical publishers reconcile one commit without duplicated records",async(t)=>{
  const state=fixture(t);seedMemoryDocument(state);
  const left=await draftMemoryReview(state),right=await draftMemoryReview(state);
  const result=await Promise.all([state.store.publish(left),state.store.publish(right)]);
  assert.deepEqual(result.map((row)=>row.status).sort(),["already-committed","committed"]);
  assert.equal(count(state,"memory_shadow_reviews"),1);
  assert.equal(count(state,"memory_shadow_atomic_guards"),0);
});

test("source erasure and permission changes between draft and commit reject all writes",async(t)=>{
  for(const kind of ["source","permission"]){
    const state=memoryPersistenceFixture();t.after(()=>state.close());const chat=seedMemoryDocument(state);const draft=await draftMemoryReview(state);let changed=false;
    state.controls.beforeBatch=(statements)=>{if(changed||!isCommit(statements))return;changed=true;
      if(kind==="source")state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(state.clock.now,chat.first.userRef);
      else state.changeAuthority((value)=>{value.access.fence.permission++;value.access.enabled=false;});
    };
    await assert.rejects(()=>state.store.publish(draft),/memory-commit-rejected/);
    assert.equal(count(state,"memory_shadow_records"),0);assert.equal(count(state,"memory_shadow_watermarks"),0);
  }
});

test("a mutation after private-body writes is caught by final transaction guards",async(t)=>{
  const state=fixture(t);seedMemoryDocument(state);const draft=await draftMemoryReview(state);let changed=false;
  state.controls.beforeStatement=(sql)=>{if(!changed&&sql.startsWith("INSERT INTO memory_shadow_private_bodies")){
    changed=true;state.changeAuthority((value)=>{value.access.fence.policy++;});
  }};
  await assert.rejects(()=>state.store.publish(draft),/memory-commit-rejected/);
  assert.equal(count(state,"memory_shadow_private_bodies"),0);assert.equal(count(state,"memory_shadow_watermarks"),0);
});

test("summary text cannot be committed with unrelated dependency refs or an altered method",async(t)=>{
  const state=fixture(t);seedMemoryDocument(state);const draft=await draftMemoryReview(state);
  const altered=structuredClone(draft.segments[0]);altered.record.sources=[draft.records[0].sources[0]];
  const records=draft.records.map((record)=>record.id===altered.record.id?altered.record:record);
  await assert.rejects(()=>state.store.publish({...draft,records,segments:[altered]}),/unbound-memory-segment-sources/);
  const badMethod=structuredClone(draft.segments[0]);badMethod.method="semantic-unverified";
  await assert.rejects(()=>state.store.publish({...draft,segments:[badMethod]}),/unbound-memory-segment-sources/);
  const unbound=draft.records.map((record)=>record.kind==="conversation-summary"?{...record,body:"Unsupported summary text"}:record);
  for(const segments of [[],undefined])await assert.rejects(()=>state.store.publish({...draft,records:unbound,segments}),/memory-summary-coverage-required/);
  assert.equal(count(state,"memory_shadow_records"),0);
});

test("database-time deadlines reject publication at batch entry, during writes and at the final CAS",async(t)=>{
  const deadline="2026-09-02T06:00:01.000Z";
  for(const boundary of ["batch","body","generation"]){
    for(const kind of ["source","record","enrollment","grant"]){
      const state=memoryPersistenceFixture();t.after(()=>state.close());seedMemoryDocument(state);
      if(kind==="source")state.changeBinding("alice-event-1",(binding)=>{binding.expiresAt=deadline;});
      if(kind==="enrollment")state.changeAuthority((value)=>{value.access.enrollmentExpiresAt=deadline;});
      if(kind==="grant")state.changeAuthority((value)=>{value.access.grants.find((grant)=>grant.scopeId==="document").expiresAt=deadline;});
      const draft=await draftMemoryReview(state);
      if(kind==="record")draft.records[0].expiresAt=deadline;
      let changed=false;
      const expire=()=>{changed=true;state.clock.now=deadline;};
      state.controls.beforeBatch=(statements)=>{if(!changed&&boundary==="batch"&&isCommit(statements))expire();};
      state.controls.beforeStatement=(sql)=>{if(!changed&&((boundary==="body"&&sql.startsWith("INSERT INTO memory_shadow_private_bodies"))
        ||(boundary==="generation"&&sql.startsWith("UPDATE memory_shadow_partitions SET generation"))))expire();};
      await assert.rejects(()=>state.store.publish(draft),/memory-commit-rejected/,`${boundary}/${kind}`);
      for(const table of ["memory_shadow_private_bodies","memory_shadow_observations","memory_shadow_reviews","memory_shadow_watermarks","memory_shadow_index_outbox","memory_shadow_partitions"])
        assert.equal(count(state,table),0,`${boundary}/${kind}/${table}`);
    }
  }
});

test("forget is durable, body-erasing, copied-lineage suppressing, and cannot be undone by replay",async(t)=>{
  const dir=mkdtempSync(join(tmpdir(),"forma-memory-forget-")),path=join(dir,"isolated.sqlite");
  let state=memoryPersistenceFixture({path});t.after(()=>{state.close();rmSync(dir,{recursive:true,force:true});});
  seedMemoryDocument(state);const draft=await draftMemoryReview(state);await state.store.publish(draft);
  const pattern=draft.records.find((row)=>row.kind==="workflow-pattern"),originalLineage=pattern.sources[0].lineageId;
  const result=await state.store.forget(await state.store.capture(state.identity),pattern.id);
  assert.equal(result.erased,4);assert.equal(result.privacyGeneration,1);
  assert.equal(storedRecord(state,pattern.id).state,"erased");
  assert.equal((await state.store.publish(draft)).status,"already-committed");
  state.close();state=memoryPersistenceFixture({path});
  assert.equal((await state.store.read(state.identity)).records.some((row)=>row.sources.some((source)=>pattern.sources.some((old)=>old.id===source.id))),false);
  const copy=state.addEvent({lineageId:originalLineage,payload:{copied_from_block_id:"block"}});
  const captured=await state.store.capture(state.identity),evidence=state.store.evidence(captured);
  assert.equal(evidence.sources.get(memoryKey(state.custodian,copy.id)).state,"erased");
  assert.equal(evidence.observations.some((row)=>row.eventId===copy.id),false);
  const forgottenSource=state.sqlite.prepare("SELECT source_json FROM memory_shadow_sources WHERE source_id=?").get(pattern.sources[0].id);
  const revived={...JSON.parse(forgottenSource.source_json),state:"active"};
  assert.throws(()=>state.sqlite.prepare("UPDATE memory_shadow_sources SET state='active',source_json=? WHERE source_id=?")
    .run(JSON.stringify(revived),revived.id),/retired_memory_source/);
  const again=await state.store.forget(await state.store.capture(state.identity),pattern.id);
  assert.equal(again.erased,0);assert.equal(again.privacyGeneration,1);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_shadow_index_outbox WHERE operation='upsert' AND record_id=?").get(pattern.id).n,0);
});

test("erasure failure rolls back suppression, body removal and purge intents together",async(t)=>{
  const state=fixture(t);seedMemoryDocument(state);const draft=await draftMemoryReview(state);await state.store.publish(draft);
  const summary=draft.segments[0].record;let failed=false;
  state.controls.beforeStatement=(sql)=>{if(!failed&&sql.startsWith("DELETE FROM memory_shadow_private_bodies")){failed=true;throw new Error("injected erasure failure");}};
  await assert.rejects(async()=>state.store.forget(await state.store.capture(state.identity),summary.id),/memory-commit-rejected/);
  assert.equal(storedRecord(state,summary.id).state,"active");
  assert.equal(count(state,"memory_shadow_suppressions"),0);
  assert.equal((await state.store.read(state.identity)).records.some((row)=>row.id===summary.id),true);
});

test("flattened summary/digest dependencies invalidate together while unrelated memory remains",async(t)=>{
  const state=fixture(t),chat=seedMemoryDocument(state),draft=await draftMemoryReview(state),summary=draft.segments[0].record;
  const derived={...summary,id:"digest:summary",kind:"episode",claimKey:"digest:summary"};
  await state.store.publish({...draft,records:[...draft.records,derived]});
  state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(state.clock.now,chat.first.userRef);
  const view=await state.store.read(state.identity);
  assert.equal(view.records.some((row)=>[summary.id,derived.id].includes(row.id)),false);
  assert.equal(view.records.some((row)=>row.kind==="workflow-pattern"),true);
  assert.equal((await state.store.maintain(state.identity)).erased,3);
  for(const id of [summary.id,derived.id]){
    assert.equal(storedRecord(state,id).state,"erased");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_shadow_private_bodies WHERE record_id=?").get(id).n,0);
  }
});

test("moved and removed scope dependencies retain historical document membership for cleanup",async(t)=>{
  for(const kind of ["move","remove"]){
    const state=memoryPersistenceFixture();t.after(()=>state.close());seedMemoryDocument(state);const draft=await draftMemoryReview(state);await state.store.publish(draft);
    state.changeAuthority((value)=>{
      value.access.fence.ancestry++;
      if(kind==="move")value.scopes.find((scope)=>scope.id==="block").parentId="other-document";
      else value.scopes=value.scopes.filter((scope)=>scope.id!=="block");
    });
    // All old records are fenced out; cleanup must include block descendants even after relocation.
    await state.store.maintain(state.identity);
    assert.equal(storedRecord(state,"workflow:block:edit").state,"erased");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_shadow_private_bodies WHERE record_id='workflow:block:edit'").get().n,0);
  }
});

test("fresh maintenance after opt-out or grant expiry does not read source prose",async(t)=>{
  for(const kind of ["opt-out","expiry","revoked"]){
    const state=memoryPersistenceFixture();t.after(()=>state.close());seedMemoryDocument(state);await state.store.publish(await draftMemoryReview(state));
    state.changeAuthority((value)=>{
      if(kind==="opt-out")value.access.enabled=false;
      if(kind==="expiry")value.access.enrollmentExpiresAt=state.clock.now;
      if(kind==="revoked")value.access.grants.find((grant)=>grant.scopeId==="document").canRead=false;
    });
    await assert.rejects(()=>state.store.read(state.identity),/memory-source-access-denied/);
    state.controls.queries.length=0;
    assert.equal((await state.store.maintain(state.identity)).erased,8);
    assert.equal(count(state,"memory_shadow_private_bodies"),0);
    assert.equal(state.controls.queries.some((sql)=>/\b(?:FROM|JOIN) (?:private_content|event_private_payloads)\b/u.test(sql)),false);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_shadow_index_outbox WHERE operation='upsert'").get().n,0);
  }
});

test("read rechecks the clock after awaited bodies and returns no expired text or consumption",async(t)=>{
  const state=fixture(t);seedMemoryDocument(state);await state.store.publish(await draftMemoryReview(state));let changed=false;
  state.controls.beforeBatch=(statements)=>{if(!changed&&statements.some((statement)=>statement.sql.startsWith("SELECT body FROM memory_shadow_private_bodies"))){
    changed=true;state.clock.now="2026-10-02T06:00:00.000Z";
  }};
  const view=await state.store.read(state.identity);
  assert.deepEqual(view.records,[]);assert.deepEqual(view.observations,[]);assert.deepEqual(view.consumption,[]);
  assert.equal(view.conversations.every((conversation)=>conversation.turns.length===0),true);
  assert.equal(view.sources.size,0);
});

test("source expiry prevents publication and maintenance works with no new activity",async(t)=>{
  const state=fixture(t);seedMemoryDocument(state);const draft=await draftMemoryReview(state);
  state.clock.now="2026-10-02T06:00:00.000Z";
  await assert.rejects(()=>state.store.publish(draft),/ineligible-memory-publication/);
  assert.equal(count(state,"memory_shadow_reviews"),0);
  state.clock.now="2026-09-02T06:00:00.000Z";await state.store.publish(draft);
  state.clock.now="2026-10-02T06:00:00.000Z";
  assert.equal((await state.store.maintain(state.identity)).erased,8);
  assert.equal(count(state,"memory_shadow_private_bodies"),0);
});

test("deadline cleanup persists even when a pending chat defers source-dependent maintenance",async(t)=>{
  for(const allExpired of [true,false]){
    const state=memoryPersistenceFixture();t.after(()=>state.close());seedMemoryDocument(state);
    const rows=state.sqlite.prepare("SELECT event_id FROM fixture_memory_bindings").all();
    for(const {event_id} of allExpired?rows:rows.slice(0,1))state.changeBinding(event_id,(binding)=>{binding.expiresAt="2026-09-03T00:00:00.000Z";});
    await state.store.publish(await draftMemoryReview(state));
    state.addChat("pending");
    state.sqlite.prepare("UPDATE assistant_turns SET status='running' WHERE turn_id='pending'").run();
    state.clock.now="2026-09-03T06:00:00.000Z";state.controls.queries.length=0;
    const result=await state.store.maintain(state.identity);
    assert.deepEqual(result,{erased:allExpired?8:1,sourceReview:allExpired?"unnecessary":"deferred"});
    assert.equal(count(state,"memory_shadow_private_bodies"),allExpired?0:7);
    if(allExpired)assert.equal(state.controls.queries.some((sql)=>/\b(?:FROM|JOIN) (?:private_content|event_private_payloads)\b/u.test(sql)),false);
  }
});

test("mutating a caller identity during async capture cannot select another actor's same-ID body",async(t)=>{
  const alice=fixture(t);alice.addEvent();const a=await draftMemoryReview(alice);
  a.records=[{...a.records[0],id:"same-id",body:"Alice private memory"}];a.segments=[];await alice.store.publish(a);
  const bob=memoryPersistenceFixture({database:alice,actor:"bob",owner:"bob-owner"});bob.addEvent();const b=await draftMemoryReview(bob);
  b.records=[{...b.records[0],id:"same-id",body:"Bob private memory"}];b.segments=[];await bob.store.publish(b);
  const mutable={...alice.identity},authorize=alice.authority.authorize.bind(alice.authority);
  alice.authority.authorize=async(request,now)=>{const result=await authorize(request,now);mutable.actorUserId="bob";return result;};
  const view=await alice.store.read(mutable);
  assert.deepEqual(view.records.map((record)=>record.body),["Alice private memory"]);
});

test("summary bodies never appear in source mirrors, metadata, coverage, review receipts or index intents",async(t)=>{
  const state=fixture(t);state.addEvent();state.addChat("sentinel","USER_PRIVATE_SENTINEL","ASSISTANT_PRIVATE_SENTINEL");
  const draft=await draftMemoryReview(state);await state.store.publish(draft);
  const tables=state.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'memory_shadow_%' AND name!='memory_shadow_private_bodies'").all();
  for(const {name} of tables)assert.equal(/USER_PRIVATE_SENTINEL|ASSISTANT_PRIVATE_SENTINEL/u.test(JSON.stringify(state.sqlite.prepare(`SELECT * FROM ${name}`).all())),false,name);
  assert.match(JSON.stringify(state.sqlite.prepare("SELECT body FROM memory_shadow_private_bodies").all()),/USER_PRIVATE_SENTINEL/);
});

test("watermarks are independent for different derivation recipes",async(t)=>{
  const state=fixture(t);state.addEvent();const first=await draftMemoryReview(state);await state.store.publish(first);
  const second=await draftMemoryReview(state,{recipe:"new-recipe-v2"});
  assert.deepEqual(second.evidence.inventory.from,{});
  assert.equal(second.plan.recipeVersion,"new-recipe-v2");
  await state.store.publish({...second,records:[],segments:[]});
  assert.equal(count(state,"memory_shadow_watermarks"),2);
});

test("successful writes cannot exceed the readable partition capacity",async(t)=>{
  const state=fixture(t);state.addEvent();const draft=await draftMemoryReview(state);await state.store.publish(draft);
  const template=JSON.parse(storedRecord(state,draft.records[0].id).metadata_json);
  for(let index=1;index<1024;index++){
    const record={...template,id:`capacity-${index}`};
    state.sqlite.prepare("INSERT INTO memory_shadow_records VALUES(?,?,?,?,?,?,?,?)")
      .run(state.actor,state.custodian,record.id,record.scopeId,record.version,record.state,record.expiresAt,JSON.stringify(record));
  }
  state.addEvent();const capture=await state.store.capture(state.identity),evidence=state.store.evidence(capture);
  const decision=await planMemoryReview({mode:"shadow",...evidence,processed:evidence.inventory.from,recipeVersion:"document-memory-v1",timeZone:"America/New_York"});
  const record=createMemoryRecord({id:"one-too-many",version:1,scopeId:"block",kind:"episode",claimKey:"new",
    body:"New bounded record",sources:[...evidence.sources.values()].slice(-1)},evidence.access,evidence.graph);
  await assert.rejects(()=>state.store.publish({capture,plan:decision.plan,records:[record]}),/memory-partition-capacity/);
  assert.equal(count(state,"memory_shadow_records"),1024);
  assert.ok(await state.store.capture(state.identity));
});

test("learning may be disabled while authorized recall remains read-only",async(t)=>{
  const state=fixture(t);seedMemoryDocument(state);await state.store.publish(await draftMemoryReview(state));
  state.changeAuthority((value)=>{for(const grant of value.access.grants)grant.purposes=["recall"];});
  const view=await state.store.read(state.identity);assert.equal(view.records.length,8);
  await assert.rejects(()=>state.store.capture(state.identity),/memory-source-access-denied/);
  assert.equal((await state.store.maintain(state.identity)).erased,0);
  assert.equal(count(state,"memory_shadow_reviews"),1);
  assert.equal(count(state,"memory_shadow_private_bodies"),8);
});

test("learn-only consent permits private consolidation and replay without enabling recall",async(t)=>{
  const state=fixture(t),chat=seedMemoryDocument(state);
  state.changeAuthority((value)=>{for(const grant of value.access.grants)grant.purposes=["learn"];});
  const draft=await draftMemoryReview(state);assert.equal(draft.segments.length,1);
  assert.equal((await state.store.publish(draft)).status,"committed");
  assert.equal((await state.store.publish(draft)).status,"already-committed");
  await assert.rejects(()=>state.store.read(state.identity),/memory-source-access-denied/);
  assert.equal((await state.store.maintain(state.identity)).erased,0);
  assert.equal(count(state,"memory_shadow_private_bodies"),8);
  state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(state.clock.now,chat.first.userRef);
  assert.equal((await state.store.maintain(state.identity)).erased,2);
  await assert.rejects(()=>state.store.read(state.identity),/memory-source-access-denied/);
});

test("a new document review does not erase child memory whose learning permission was withdrawn",async(t)=>{
  const state=fixture(t);seedMemoryDocument(state);await state.store.publish(await draftMemoryReview(state));
  state.changeAuthority((value)=>{value.access.grants.find((grant)=>grant.scopeId==="block").purposes=["recall"];});
  state.addEvent({type:"DocumentOpened",scopeId:"document"});
  const draft=await draftMemoryReview(state);await state.store.publish({...draft,records:[],segments:[]});
  assert.equal((await state.store.read(state.identity)).records.filter((record)=>record.scopeId==="block").length,4);
  assert.equal(storedRecord(state,"workflow:block:edit").state,"active");
  await assert.rejects(()=>state.store.prune(draft.capture),/memory-recall-capture-required/);
  assert.equal((await state.store.maintain(state.identity)).erased,0);
});

test("same resource and record IDs across custodians do not cross-read or cross-forget",async(t)=>{
  const alpha=fixture(t);alpha.addEvent();const a=await draftMemoryReview(alpha);
  a.records=[{...a.records[0],id:"same-record",body:"Alpha memory"}];await alpha.store.publish(a);
  const beta=memoryPersistenceFixture({database:alpha,custodian:"org:beta",owner:"beta-owner"});beta.addEvent({id:"beta-event"});
  const b=await draftMemoryReview(beta);b.records=[{...b.records[0],id:"same-record",body:"Beta memory"}];await beta.store.publish(b);
  await alpha.store.forget(await alpha.store.capture(alpha.identity),"same-record");
  assert.deepEqual((await alpha.store.read(alpha.identity)).records,[]);
  assert.deepEqual((await beta.store.read(beta.identity)).records.map((record)=>record.body),["Beta memory"]);
});

test("attention-derived stored memory becomes unavailable on separate attention withdrawal",async(t)=>{
  for(const withdrawal of ["denied","expired","forgotten"]){
    const state=memoryPersistenceFixture();t.after(()=>state.close());state.addEvent();
    state.changeAuthority((value)=>{value.attention={allowed:true,expiresAt:"2026-10-01T00:00:00.000Z",forgottenThrough:{}};});
    const attention=state.addEvent({type:"AttentionEpisodeObserved",payload:{
      capture_version:"attention-v2",surface:"document",context:"document-editor",terminal_type:"page_hidden",
      started_at:"2026-09-01T14:00:00.000Z",ended_at:"2026-09-01T14:01:00.000Z",expires_at:"2026-09-15T14:01:00.000Z",
      active_ms:30000,idle_ms:30000,visible_refs:["block"],
    }});
    await state.store.publish(await draftMemoryReview(state));
    assert.equal((await state.store.read(state.identity)).records.some((row)=>row.sources.some((ref)=>ref.id===attention.id)),true);
    state.changeAuthority((value)=>{
      if(withdrawal==="denied")value.attention.allowed=false;
      if(withdrawal==="expired")value.attention.expiresAt=state.clock.now;
      if(withdrawal==="forgotten")value.attention.forgottenThrough[state.stream]=attention.sequence;
    });
    assert.equal((await state.store.read(state.identity)).records.some((row)=>row.sources.some((ref)=>ref.id===attention.id)),false);
    state.addChat("pending");state.sqlite.prepare("UPDATE assistant_turns SET status='running' WHERE turn_id='pending'").run();
    assert.deepEqual(await state.store.maintain(state.identity),{erased:1,sourceReview:"deferred"});
    assert.equal(storedRecord(state,`episode:${attention.id}`).state,"erased");
  }
});

test("a real process exit after commit but before acknowledgement survives restart and replay",async(t)=>{
  const dir=mkdtempSync(join(tmpdir(),"forma-memory-crash-")),path=join(dir,"isolated.sqlite");
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const helper=new URL("./helpers/memory-persistence.mjs",import.meta.url).href;
  const script=`import { memoryPersistenceFixture,seedMemoryDocument,draftMemoryReview } from ${JSON.stringify(helper)};
    const state=memoryPersistenceFixture({path:process.argv[1]});seedMemoryDocument(state);
    const draft=await draftMemoryReview(state);
    state.controls.afterBatch=(statements)=>{if(statements[0]?.sql.startsWith("INSERT INTO memory_shadow_atomic_guards"))process.exit(0);};
    await state.store.publish(draft);process.exit(7);`;
  await execute(process.execPath,["--experimental-strip-types","--input-type=module","-e",script,path],{env:{},timeout:20000,maxBuffer:100000});
  const state=memoryPersistenceFixture({path});
  try{
    const view=await state.store.read(state.identity);assert.equal(view.records.length,8);
    const plan=JSON.parse(state.sqlite.prepare("SELECT plan_json FROM memory_shadow_reviews").get().plan_json);
    const result=await state.store.publish({capture:await state.store.capture(state.identity),plan,records:view.records,segments:view.segments});
    assert.equal(result.status,"already-committed");assert.equal(count(state,"memory_shadow_reviews"),1);
  }finally{state.close();}
});

test("the persistence evaluator reproduces its checked report without inherited credentials",async()=>{
  const script=new URL("../scripts/evaluate-memory-persistence.mjs",import.meta.url);
  const {stdout}=await execute(process.execPath,["--experimental-strip-types",script.pathname],{env:{},timeout:20000,maxBuffer:100000});
  const expected=JSON.parse(readFileSync(new URL("../docs/forma-memory-persistence-evaluation-2026-09-02.json",import.meta.url),"utf8"));
  assert.deepEqual(JSON.parse(stdout),expected);
  await assert.rejects(()=>execute(process.execPath,["--experimental-strip-types",script.pathname,"--database=live"],{env:{},timeout:20000,maxBuffer:100000}),/bundled synthetic fixture/);
});
