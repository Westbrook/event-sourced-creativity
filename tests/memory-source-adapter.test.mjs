import assert from "node:assert/strict";
import test from "node:test";
import { memoryPersistenceFixture,seedMemoryDocument } from "./helpers/memory-persistence.mjs";
import { memoryKey } from "../src/model/scoped-memory.ts";
import { MemorySourceAdapter } from "../worker/memory-source-adapter.ts";
import { MemoryShadowStore } from "../worker/memory-store.ts";

const fixture = (t,options) => { const state=memoryPersistenceFixture(options);t.after(()=>state.close());return state; };
const read = async (state,from={}) => state.adapter.evidence(await state.adapter.capture(state.identity,from));

test("default-off storage and source adapters perform no database or authority calls",async()=>{
  const forbidden=()=>{throw new Error("unexpected IO");};
  const db={prepare:forbidden,batch:forbidden},adapter=new MemorySourceAdapter(db,{authorize:forbidden,resolveEvent:forbidden});
  const store=new MemoryShadowStore(db,adapter),identity={actorUserId:"alice",custodianId:"org:alpha",targetScopeId:"document"};
  assert.equal(await adapter.capture(identity),null);
  assert.equal(await store.read(identity),null);
  assert.deepEqual(await store.maintain(identity),{erased:0,sourceReview:"unnecessary"});
});

test("canonical complete pages include trailing non-learning rows and actor-private final chat",async(t)=>{
  const state=fixture(t);const chat=seedMemoryDocument(state);const evidence=await read(state);
  assert.equal(evidence.scannedRows,9);
  assert.equal(evidence.sources.size,8);
  assert.equal(evidence.observations.length,6);
  assert.deepEqual(evidence.inventory.through,{"creative:owner":9});
  assert.equal(evidence.inventory.observationSources.length,6);
  assert.equal(evidence.sources.get(memoryKey(state.custodian,chat.first.assistant.id)).speaker,"assistant");
  assert.equal(evidence.sources.get(memoryKey(state.custodian,chat.first.assistant.id)).origin,"assistant");
  assert.equal(evidence.conversations[0].turns.length,4);
  assert.equal(evidence.conversations[0].completeFromStart,true);
  assert.equal(evidence.conversations[0].turns.every((turn)=>turn.source.actorUserId==="alice"),true);
  assert.equal(evidence.sources.values().next().value.streamId,"creative:owner");
  const repeat=await read(state,evidence.inventory.through);
  assert.deepEqual(repeat.inventory.observationSources,[]);
});

test("source capture tokens cannot be forged or mutated through returned evidence",async(t)=>{
  const state=fixture(t);state.addEvent();
  assert.throws(()=>state.adapter.evidence({kind:"issued-memory-source-capture"}),/unissued/);
  const capture=await state.adapter.capture(state.identity),evidence=state.adapter.evidence(capture);
  evidence.sources.clear();evidence.inventory.through[state.stream]=999;
  assert.equal(state.adapter.evidence(capture).sources.size,1);
  assert.equal(state.adapter.evidence(capture).inventory.through[state.stream],1);
});

test("production authority cannot enter the synthetic adapter",async(t)=>{
  const state=fixture(t);state.changeAuthority((value)=>{value.access.environment="production";});
  state.controls.queries.length=0;
  await assert.rejects(()=>read(state),/memory-source-access-denied/);
  assert.equal(state.controls.queries.some((sql)=>sql.includes("secret.private_json")),false);
});

test("project presentation cursors and rewind are not accepted as canonical streams",async(t)=>{
  const state=fixture(t);state.addEvent();
  await assert.rejects(()=>read(state,{"creative:owner":5}),/rewind/);
  state.changeAuthority((value)=>{value.streams[0].streamId="project:project-access";});
  await assert.rejects(()=>read(state),/invalid-canonical-memory-stream/);
});

test("missing ledger rows or pages fail without issuing a complete interval",async(t)=>{
  const state=fixture(t);seedMemoryDocument(state);
  state.sqlite.prepare("DELETE FROM events WHERE stream_id=? AND sequence=3").run(state.stream);
  await assert.rejects(()=>read(state),/noncanonical-memory-event/);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_shadow_watermarks").get().n,0);
});

test("events appended after the captured head are left for the next interval",async(t)=>{
  const state=fixture(t);state.addEvent();let appended=false;
  state.controls.afterBatch=(statements)=>{
    if(!appended&&statements[0]?.sql.startsWith("SELECT COALESCE(MAX(sequence)")){
      appended=true;state.addEvent({type:"ProviderRequestCompleted",actor:"worker:fixture"});
    }
  };
  const evidence=await read(state);
  assert.equal(evidence.inventory.through[state.stream],1);
  assert.equal(evidence.scannedRows,1);
  assert.equal(state.sqlite.prepare("SELECT MAX(sequence) AS head FROM events").get().head,2);
});

test("a client envelope cannot override actor/custody, source identity or speaker",async(t)=>{
  const state=fixture(t);
  state.addEvent({payload:{actor_user_id:"bob",scopeId:"other-document",independentEvidence:true}});
  await assert.rejects(()=>read(state),/contradictory-memory-source-scope/);
});

test("forged provenance fields cannot remove assisted/copy/synthetic taint",async(t)=>{
  const state=fixture(t);
  const row=state.addEvent({payload:{source_surface:"assistant",origin:{synthetic:false},independentEvidence:true,contentHash:"forged",value:"PRIVATE_SENTINEL"}});
  const evidence=await read(state),source=evidence.sources.get(memoryKey(state.custodian,row.id));
  assert.equal(source.origin,"assistant");assert.equal(source.independentEvidence,false);assert.equal(source.synthetic,true);
  assert.notEqual(source.contentHash,"forged");
  assert.equal(JSON.stringify(evidence.observations).includes("PRIVATE_SENTINEL"),false);
});

test("unresolved lineage stays non-independent and source grants are checked before private reads",async(t)=>{
  const state=fixture(t);state.addEvent({binding:{lineageResolved:false}});
  assert.equal((await read(state)).observations[0].independentEvidence,false);
  state.changeAuthority((value)=>{value.access.grants.find((grant)=>grant.scopeId==="block").canRead=false;});
  state.controls.queries.length=0;
  const denied=await read(state);
  assert.equal(denied.sources.size,0);
  assert.equal(state.controls.queries.some((sql)=>sql.includes("secret.private_json")),false);
});

test("wrong project event custody is rejected before selecting its private envelope",async(t)=>{
  const state=fixture(t),row=state.addEvent();
  state.sqlite.prepare("UPDATE project_event_scopes SET organization_id='beta' WHERE event_id=?").run(row.id);
  state.controls.queries.length=0;
  await assert.rejects(()=>read(state),/memory-event-custody-mismatch/);
  assert.equal(state.controls.queries.some((sql)=>sql.includes("secret.private_json")),false);
});

test("redacted envelopes have no public-payload fallback and old conversation gaps remain visible",async(t)=>{
  const state=fixture(t),first=state.addChat("first"),second=state.addChat("second");
  state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?")
    .run(state.clock.now,first.user.id);
  state.changeBinding(first.assistant.id,(value)=>{value.status="unavailable";});
  const evidence=await read(state),conversation=evidence.conversations[0];
  assert.equal(conversation.completeFromStart,false);
  assert.equal(conversation.turns.some((turn)=>turn.source.id===first.user.id),false);
  assert.equal(conversation.turns.some((turn)=>turn.source.id===second.user.id),true);
});

test("unavailable chat bindings cannot turn a truncated history into completeFromStart",async(t)=>{
  const state=fixture(t),first=state.addChat("first");state.addChat("second");
  for(const event of [first.user,first.assistant])state.changeBinding(event.id,(value)=>{value.status="unavailable";});
  const evidence=await read(state);
  assert.equal(evidence.conversations[0].turns.length,2);
  assert.equal(evidence.conversations[0].completeFromStart,false);
});

test("unmigrated legacy text is blocked instead of copied into memory",async(t)=>{
  const state=fixture(t),row=state.addEvent();
  state.sqlite.prepare("UPDATE events SET payload=? WHERE event_id=?").run(JSON.stringify({text:"LEGACY_PRIVATE_TEXT"}),row.id);
  await assert.rejects(()=>read(state),/unmigrated-memory-source-envelope/);
});

test("private chat cannot use another actor's content or another tenant's resource receipt",async(t)=>{
  const state=fixture(t),chat=state.addChat("one");
  state.sqlite.prepare("UPDATE private_content SET owner_id='bob' WHERE content_id=?").run(chat.userRef);
  await assert.rejects(()=>read(state),/memory-chat-content-custody/);
  state.sqlite.prepare("UPDATE private_content SET owner_id='alice' WHERE content_id=?").run(chat.userRef);
  state.sqlite.prepare("UPDATE project_resource_scopes SET organization_id='beta' WHERE resource_id=?").run(chat.userRef);
  state.controls.queries.length=0;
  await assert.rejects(()=>read(state),/memory-chat-tenant-custody/);
  assert.equal(state.controls.queries.some((sql)=>sql.startsWith("SELECT owner_id,kind,content,")),false);
});

test("assigned retention cannot be extended by a longer private-content deadline",async(t)=>{
  const state=fixture(t),chat=state.addChat("one");
  state.sqlite.prepare("UPDATE private_content_retention_scopes SET assigned_expires_at=? WHERE content_id=?")
    .run("2026-09-03T00:00:00.000Z",chat.userRef);
  const evidence=await read(state);
  assert.equal(evidence.sources.get(memoryKey(state.custodian,chat.user.id)).expiresAt,"2026-09-03T00:00:00.000Z");
  state.clock.now="2026-09-03T06:00:00.000Z";
  assert.equal((await read(state)).sources.has(memoryKey(state.custodian,chat.user.id)),false);
});

test("a completed turn with a queued specialist is not final conversation evidence",async(t)=>{
  const state=fixture(t);state.addChat("one");
  state.sqlite.prepare("INSERT INTO assistant_specialist_tasks VALUES(?,?,?,?,?)").run("task-1",state.actor,state.scopeKey,"one","queued");
  await assert.rejects(()=>read(state),/pending-or-ambiguous-memory-turn/);
});

function finishSpecialist(state,chat) {
  state.sqlite.prepare("INSERT INTO assistant_specialist_tasks VALUES(?,?,?,?,?)").run("task-1",state.actor,state.scopeKey,chat.conversation.turnId,"completed");
  state.sqlite.prepare("UPDATE private_content SET content='Final specialist chart recommendation.' WHERE content_id=?").run(chat.answerRef);
  const event=state.addEvent({type:"AssistantReasoned",scopeId:"document",correlation:"new-specialist-correlation",
    payload:{turn_id:chat.conversation.turnId,content_ref:chat.answerRef,operation:"creative-chat"},binding:{conversation:chat.conversation}});
  state.sqlite.prepare("INSERT INTO event_client_receipts VALUES(?,?,?,?,?)")
    .run(state.stream,`assistant-specialist:${state.actor}:task-1:0`,event.id,event.sequence,state.clock.now);
  state.sqlite.prepare("INSERT INTO assistant_action_commits VALUES('task:task-1',1,?)").run(state.clock.now);
  return event;
}

test("completed specialist text binds to the new event, never the overwritten interim reply",async(t)=>{
  const state=fixture(t),chat=state.addChat("one"),final=finishSpecialist(state,chat);
  const evidence=await read(state),turns=evidence.conversations[0].turns;
  assert.equal(turns.length,2);
  assert.equal(evidence.sources.has(memoryKey(state.custodian,chat.assistant.id)),false);
  assert.equal(turns.find((turn)=>turn.role==="assistant").source.id,final.id);
  assert.match(turns.find((turn)=>turn.role==="assistant").text,/Final specialist/);
  state.sqlite.prepare("DELETE FROM assistant_action_commits").run();
  await assert.rejects(()=>read(state),/unverified-specialist-memory-answer/);
});

test("specialist completion after head capture cannot backdate its overwritten answer",async(t)=>{
  const state=fixture(t),chat=state.addChat("one");let changed=false;
  state.controls.afterBatch=(statements)=>{
    if(!changed&&statements[0]?.sql.startsWith("SELECT COALESCE(MAX(sequence)")){
      changed=true;finishSpecialist(state,chat);
    }
  };
  await assert.rejects(()=>read(state),/unresolved-or-future-memory-answer/);
});

test("exact content and permission guards catch changes during async source capture",async(t)=>{
  const state=fixture(t),chat=state.addChat("one");let changed=false;
  state.controls.beforeBatch=(statements)=>{
    if(!changed&&statements.length>10&&statements[0].sql.startsWith("SELECT CASE WHEN")){
      changed=true;state.sqlite.prepare("UPDATE private_content SET content='Different answer' WHERE content_id=?").run(chat.answerRef);
    }
  };
  await assert.rejects(()=>read(state),/stale-memory-source-snapshot/);
});

test("denied and forgotten attention is not available as hidden source support",async(t)=>{
  const state=fixture(t),row=state.addEvent({type:"AttentionEpisodeObserved",payload:{
    capture_version:"attention-v2",surface:"document",context:"document-editor",terminal_type:"page_hidden",
    started_at:"2026-09-01T14:00:00.000Z",ended_at:"2026-09-01T14:01:00.000Z",expires_at:"2026-09-15T14:01:00.000Z",
    active_ms:30000,idle_ms:30000,visible_refs:["block"],
  }});
  assert.equal((await read(state)).sources.size,0);
  state.changeAuthority((value)=>{value.attention={allowed:true,expiresAt:"2026-10-01T00:00:00.000Z",forgottenThrough:{}};});
  assert.equal((await read(state)).sources.get(memoryKey(state.custodian,row.id)).independentEvidence,false);
  state.changeAuthority((value)=>{value.attention.forgottenThrough[state.stream]=row.sequence;});
  assert.equal((await read(state)).sources.size,0);
});
