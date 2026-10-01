import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { publicEventPayload } from "../worker/event-privacy.ts";
import { nativeMemorySavedOutputsSchemaQuery, nativeMemorySavedOutputsQuery, nativeMemorySavedOutputsValue } from "../worker/memory-native-saved-outputs.ts";
import { parseMemorySavedOutputs } from "../src/model/memory-saved-outputs.ts";

// Actual helper SQL against ordinary in-memory Node SQLite and the genuine
// public-envelope projection. No Worker, provider, object store or native run.
globalThis.fetch=async()=>{throw new Error("external_fetch_forbidden");};
const iso=time=>new Date(time).toISOString();
function fixture(t,{shared=false}={}) {
  const db=new DatabaseSync(":memory:");t.after(()=>db.close());
  db.exec(`CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,sequence INTEGER,type TEXT,actor TEXT,client_id TEXT,
    correlation_id TEXT,causation_id TEXT,compensates_event_id TEXT,recorded_at TEXT,payload TEXT);
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,project_id TEXT,document_id TEXT,private_json TEXT,redacted_at TEXT);
    CREATE TABLE memory_live_sources(enrollment_id TEXT,event_id TEXT,sequence INTEGER,expires_at TEXT);
    CREATE TABLE memory_live_enrollments(enrollment_id TEXT,actor_user_id TEXT,owner_user_id TEXT,organization_id TEXT,project_access_id TEXT,
      project_id TEXT,document_id TEXT,permission_epoch TEXT,policy_version TEXT,revision INTEGER,cursor_sequence INTEGER,enrolled_at TEXT,expires_at TEXT,retention_days INTEGER,recall_enabled INTEGER);
    CREATE TABLE document_jobs(job_id TEXT,owner_id TEXT,stream_id TEXT,document_id TEXT,kind TEXT,status TEXT,correlation_id TEXT,requested_sequence INTEGER,expires_at TEXT,attempt_count INTEGER);
    CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,grant_id TEXT,plan_revision_id TEXT,target_id TEXT,target_contract_digest TEXT,
      source_digest TEXT,route_digest TEXT,job_id TEXT,status TEXT,outcome_event_id TEXT);
    CREATE TABLE output_execution_grants(scope_key TEXT,grant_id TEXT,plan_revision_id TEXT,actor_user_id TEXT,status TEXT,authorization_event_id TEXT,expires_at TEXT);
    CREATE TABLE output_plan_revisions(scope_key TEXT,plan_revision_id TEXT,owner_user_id TEXT,organization_id TEXT,project_access_id TEXT,project_id TEXT,document_id TEXT,scope_kind TEXT,source_digest TEXT);
    CREATE TABLE output_plan_targets(scope_key TEXT,plan_revision_id TEXT,target_id TEXT,target_contract_digest TEXT,media_kind TEXT,selected INTEGER);
    CREATE TABLE output_native_storage_writes(scope_key TEXT,slot_id TEXT,storage_key TEXT,content_sha256 TEXT,publication_event_id TEXT,status TEXT,write_acknowledged INTEGER);
    CREATE TABLE project_event_scopes(event_id TEXT,source_stream_id TEXT,source_sequence INTEGER,organization_id TEXT,project_access_id TEXT,project_id TEXT,owner_user_id TEXT,actor_user_id TEXT);
    CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT,organization_id TEXT,project_access_id TEXT,project_id TEXT,owner_user_id TEXT,actor_user_id TEXT,visibility TEXT,source_event_id TEXT);
    CREATE TABLE private_content(content_id TEXT,owner_id TEXT,kind TEXT,content TEXT,expires_at TEXT,redacted_at TEXT);
    CREATE TABLE private_content_retention_scopes(content_id TEXT,organization_id TEXT,project_access_id TEXT,project_id TEXT,actor_user_id TEXT,assigned_expires_at TEXT);`);
  const now=Date.now(),checkedAt=iso(now),until=iso(now+60_000),expires=iso(now+86_400_000),actor="alice",owner=shared?"owner":actor,stream="creative:"+owner;
  const e={enrollment_id:"enrollment",actor_user_id:actor,owner_user_id:owner,organization_id:shared?"org":null,project_access_id:shared?"access":null,
    project_id:"project",document_id:"document",permission_epoch:"epoch",policy_version:"personal-memory-v2",revision:1,
    enrolled_at:iso(now-86_400_000),expires_at:expires,retention_days:30,cursor_sequence:100};
  db.prepare("INSERT INTO memory_live_enrollments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)").run(e.enrollment_id,actor,owner,e.organization_id,e.project_access_id,e.project_id,e.document_id,e.permission_epoch,e.policy_version,e.revision,e.cursor_sequence,e.enrolled_at,e.expires_at,e.retention_days);
  const scope=shared?"project:org:access":"personal:alice:project",generation="generation",objectId="object-native",storageKey="media/"+owner+"/native.png";
  const at=sequence=>iso(now-600_000+sequence*1000);
  const add=(eventId,sequence,type,payload,{actor:sourceActor="user:"+actor,client="server:document-job:generate",correlation="job:attempt:1",causation=null,scoped=shared}={})=>{
    const split=publicEventPayload(eventId,payload,true);
    db.prepare("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(eventId,stream,sequence,type,sourceActor,client,correlation,causation,null,at(sequence),JSON.stringify(split.payload));
    db.prepare("INSERT INTO event_private_payloads VALUES(?,?,?,?,?,NULL)").run(eventId,owner,payload.project_id??null,payload.document_id??null,split.privateJson);
    if(scoped)db.prepare("INSERT INTO project_event_scopes VALUES(?,?,?,?,?,?,?,?)").run(eventId,stream,sequence,"org","access","project",owner,actor);
  };
  const resource=(kind,key,sourceEventId,visibility="collaborative_output")=>db.prepare("INSERT INTO project_resource_scopes VALUES(?,?,?,?,?,?,?,?,?)")
    .run(kind,key,"org","access","project",owner,actor,visibility,sourceEventId);
  const base={project_id:"project",document_id:"document",actor_user_id:actor};
  add("queued",2,shared?"ProjectDocumentJobQueued":"OutputOperationJobQueued",{...base,job_id:"job",kind:"generate",output_slot_id:"slot",output_grant_id:"grant"},
    {client:"server:output-requirements",correlation:"command"});
  add("authorized",3,"OutputExecutionAuthorized",{...base,grant_id:"grant",plan_revision_id:"plan",source_digest:"digest",
    authorized_targets:[{job_id:"job",operation_slot_id:"slot",target_id:"target",route_digest:"route"}]},{client:"server:output-requirements",correlation:"command"});
  const generatedBase={generation_id:generation,document_id:"document",quality:"high",purpose:"final"};
  add("requested",4,"GenerationRequested",generatedBase,{actor:shared?"user:"+actor:"user"});
  add("compiled",5,"ContextCompiled",{...generatedBase,project_id:"project",context_hash:"context-hash",compiled_snapshot:{document:{id:"document"},privateText:"never returned"}},
    {actor:"worker:compiler",causation:"requested"});
  add("completed",6,"GenerationCompleted",{...generatedBase,object_id:objectId,object_ids:[objectId],simulation:false,prompt_ref:"prompt",output_ref:"output",
    content_expires_at:expires,media_url:"/api/media/"+encodeURIComponent(storageKey),source_content_hash:"a".repeat(64),context_hash:"context-hash",title:"secret generated title"},
    {actor:"worker:generator",causation:"compiled"});
  add("save",8,"ObjectSaved",{...base,object_id:objectId},{actor:shared?"user:"+actor:"user",client:"web:lit",correlation:"save-command"});
  const sources=[{eventId:"save",sequence:8,type:"ObjectSaved",blockId:null,recordedAt:at(8),validUntil:expires}];
  db.prepare("INSERT INTO memory_live_sources VALUES(?,?,?,?)").run(e.enrollment_id,"save",8,expires);
  db.prepare("INSERT INTO document_jobs VALUES(?,?,?,?,?,?,?,?,?,1)").run("job",actor,stream,"document","generate","completed","job:attempt:1",2,expires);
  db.prepare("INSERT INTO output_operation_slots VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(scope,"slot","grant","plan","target","contract","digest","route","job","succeeded","completed");
  db.prepare("INSERT INTO output_execution_grants VALUES(?,?,?,?,?,?,?)").run(scope,"grant","plan",actor,"completed","authorized",iso(now-100_000));
  db.prepare("INSERT INTO output_plan_revisions VALUES(?,?,?,?,?,?,?,?,?)").run(scope,"plan",owner,e.organization_id,e.project_access_id,"project","document",shared?"project":"personal","digest");
  db.prepare("INSERT INTO output_plan_targets VALUES(?,?,?,?,?,1)").run(scope,"plan","target","contract","image");
  db.prepare("INSERT INTO output_native_storage_writes VALUES(?,?,?,?,?,'written',1)").run(scope,"slot",storageKey,"a".repeat(64),"completed");
  for(const [key,kind] of [["output","provider-output"],["prompt","prompt"]]){
    db.prepare("INSERT INTO private_content VALUES(?,?,?,?,?,NULL)").run(key,actor,kind,"never return output or prompt bytes",expires);
    if(shared){resource("content",key,null,"actor_private");db.prepare("INSERT INTO private_content_retention_scopes VALUES(?,?,?,?,?,?)").run(key,"org","access","project",actor,expires);}
  }
  if(shared){resource("job","job","queued","actor_private");resource("output",objectId,"completed");resource("media",storageKey,"completed");}
  const q={joins:"FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id "+
    "JOIN (SELECT ? AS actor,? AS scope,? AS project,? AS document,? AS org,? AS access) native",
    condition:"event.stream_id=? AND (event.actor=? OR native.org IS NULL AND event.actor='user') AND json_extract(event.payload,'$.project_id')=native.project AND json_extract(event.payload,'$.document_id')=native.document",
    bindings:[actor,scope,"project","document",e.organization_id,e.project_access_id,stream,"user:"+actor]};
  const rows=()=>{const query=nativeMemorySavedOutputsQuery(e,q,sources);return db.prepare(query.sql).all(...query.bindings);};
  const read=()=>nativeMemorySavedOutputsValue(rows(),e,sources,checkedAt,until);
  const raw=(eventId,change)=>{const current=JSON.parse(db.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(eventId).private_json);change(current);db.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(current),eventId);};
  return{db,e,q,sources,rows,read,raw,add,resource,now,checkedAt,until,expires,at,stream,objectId,storageKey};
}

for(const shared of [false,true])test("native saved outputs: "+(shared?"shared":"personal")+" exact native image references survive expired historical action grant",t=>{
  const f=fixture(t,{shared}),query=nativeMemorySavedOutputsSchemaQuery();assert.equal(f.db.prepare(query.sql).get().ready,1);
  const result=f.read();assert.ok(result);assert.deepEqual(result.value.outputs,[{sourceIndexes:[0],origin:"native-generated-output",independentEvidence:false,generatedAt:f.at(6)}]);
  assert.equal(result.validUntil,f.until);assert.equal(result.value.inferredPreferences,false);assert.equal(result.value.coverage.completeHistory,false);
  assert.doesNotMatch(JSON.stringify(result),/secret|bytes|context-hash|object-native|generation|media|prompt|output_ref/u);
  assert.deepEqual(f.read(),result,"repeat read cannot multiply evidence or renew expiry");
});

test("native saved outputs: coalesces save pin and export for one completion without expanding parent sources",t=>{
  const f=fixture(t);
  for(const [eventId,type,sequence] of [["pin","ObjectPinned",9],["export","ObjectExported",10]]){
    f.add(eventId,sequence,type,{project_id:"project",document_id:"document",object_id:f.objectId},{actor:"user",client:"web:lit",correlation:eventId});
    f.sources.push({eventId,type,sequence,blockId:null,recordedAt:f.at(sequence),validUntil:f.expires});
    f.db.prepare("INSERT INTO memory_live_sources VALUES(?,?,?,?)").run(f.e.enrollment_id,eventId,sequence,f.expires);
  }
  const result=f.read();assert.ok(result);assert.deepEqual(result.value.outputs[0].sourceIndexes,[0,1,2]);assert.equal(result.value.coverage.certifiedOutputCount,1);
  f.sources.splice(1);assert.deepEqual(f.read().value.outputs[0].sourceIndexes,[0]);
});

const negatives=[
  ["no slot","DELETE FROM output_operation_slots"], ["failed slot","UPDATE output_operation_slots SET status='failed'"],
  ["different output actor","UPDATE document_jobs SET owner_id='other'"], ["foreign document","UPDATE document_jobs SET document_id='elsewhere'"],
  ["foreign project","UPDATE output_plan_revisions SET project_id='elsewhere'"], ["wrong native scope key","UPDATE output_operation_slots SET scope_key='personal:other:project'"],
  ["different grant actor","UPDATE output_execution_grants SET actor_user_id='other'"], ["revoked grant","UPDATE output_execution_grants SET status='revoked'"],
  ["wrong target contract","UPDATE output_plan_targets SET target_contract_digest='other'"], ["wrong media kind","UPDATE output_plan_targets SET media_kind='document'"],
  ["unacknowledged storage","UPDATE output_native_storage_writes SET write_acknowledged=0"], ["deleted storage metadata","UPDATE output_native_storage_writes SET status='deleted'"],
  ["malformed retained hash metadata","UPDATE output_native_storage_writes SET content_sha256='legacy'"],
  ["mismatched retained hash metadata","UPDATE output_native_storage_writes SET content_sha256=replace(content_sha256,'a','b')"],
  ["withdrawn publication","UPDATE output_native_storage_writes SET publication_event_id=NULL"], ["missing raw output","DELETE FROM private_content WHERE content_id='output'"],
  ["redacted prompt","UPDATE private_content SET redacted_at='redacted' WHERE content_id='prompt'"], ["wrong output private owner","UPDATE private_content SET owner_id='other' WHERE content_id='output'"],
  ["withdrawn compile private envelope","DELETE FROM event_private_payloads WHERE private_event_id='compiled'"], ["redacted request envelope","UPDATE event_private_payloads SET redacted_at='redacted' WHERE private_event_id='requested'"],
  ["enrollment revision drift","UPDATE memory_live_enrollments SET revision=2"], ["enrollment epoch drift","UPDATE memory_live_enrollments SET permission_epoch='other'"],
  ["enrollment custody drift","UPDATE memory_live_enrollments SET owner_user_id='other'"], ["enrollment recall disabled","UPDATE memory_live_enrollments SET recall_enabled=0"],
  ["remembered identity drift","UPDATE memory_live_sources SET sequence=9"], ["forgotten source","DELETE FROM memory_live_sources"],
  ["ambiguous slot for job","INSERT INTO output_operation_slots SELECT * FROM output_operation_slots"], ["ambiguous storage receipt","INSERT INTO output_native_storage_writes SELECT * FROM output_native_storage_writes"],
  ["source before enrollment","UPDATE memory_live_enrollments SET enrolled_at='2999-01-01T00:00:00.000Z'"]
];
for(const [name,sql] of negatives)test("native saved outputs: omits "+name,t=>{const f=fixture(t);assert.ok(f.read());f.db.exec(sql);assert.equal(f.read(),null);});

for(const [name,mutate] of [
  ["raw document contradiction",f=>f.raw("completed",p=>p.document_id="foreign")],
  ["malformed output metadata",f=>f.raw("completed",p=>p.output_ref={id:"output"})],
  ["raw simulation",f=>f.raw("completed",p=>p.simulation=true)],
  ["raw replay",f=>f.raw("compiled",p=>p.replay_session_id="replay")],
  ["wrong context continuity",f=>f.raw("completed",p=>p.context_hash="different")],
  ["wrong snapshot document",f=>f.raw("compiled",p=>p.compiled_snapshot.document.id="different")],
  ["wrong queue slot",f=>f.raw("queued",p=>p.output_slot_id="different")],
  ["wrong queue grant",f=>f.raw("queued",p=>p.output_grant_id="different")],
  ["wrong authorized job",f=>f.raw("authorized",p=>p.authorized_targets[0].job_id="different")],
  ["duplicate authorized member",f=>f.raw("authorized",p=>p.authorized_targets.push(p.authorized_targets[0]))],
  ["oversized retained metadata",f=>f.raw("compiled",p=>p.extra="x".repeat(131072))],
  ["duplicate JSON key",f=>f.db.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id='completed'").run('{"document_id":"foreign",'+f.db.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id='completed'").get().private_json.slice(1))],
  ["wrong current media metadata",f=>f.raw("completed",p=>p.media_url="/api/media/foreign")],
  ["malformed raw JSON",f=>f.db.exec("UPDATE event_private_payloads SET private_json='{' WHERE private_event_id='compiled'")],
  ["nonobject authorized target",f=>f.raw("authorized",p=>p.authorized_targets=["not-an-object"])]
])test("native saved outputs: omits "+name,t=>{const f=fixture(t);assert.ok(f.read());mutate(f);assert.equal(f.read(),null);});

for(const [name,sql] of [
  ["missing completion custody","DELETE FROM project_event_scopes WHERE event_id='completed'"],
  ["wrong completion sequence custody","UPDATE project_event_scopes SET source_sequence=7 WHERE event_id='completed'"],
  ["repointed job anchor","UPDATE project_resource_scopes SET source_event_id='other' WHERE resource_kind='job'"],
  ["wrong output custodian","UPDATE project_resource_scopes SET owner_user_id='other' WHERE resource_kind='output'"],
  ["missing output custody","DELETE FROM project_resource_scopes WHERE resource_kind='output'"],
  ["repointed media custody","UPDATE project_resource_scopes SET source_event_id='other' WHERE resource_kind='media'"],
  ["foreign private content","UPDATE project_resource_scopes SET project_access_id='foreign' WHERE resource_kind='content'"],
  ["missing assigned retention","DELETE FROM private_content_retention_scopes WHERE content_id='output'"],
  ["ambiguous resource","INSERT INTO project_resource_scopes SELECT * FROM project_resource_scopes WHERE resource_kind='output'"]
])test("native saved outputs: shared "+name,t=>{const f=fixture(t,{shared:true});assert.ok(f.read());f.db.exec(sql);assert.equal(f.read(),null);});

test("native saved outputs: valid bounded zero differs from unavailable legacy retention lineage",t=>{
  const f=fixture(t);f.sources.length=0;const zero=f.read();assert.ok(zero);assert.equal(zero.value.coverage.certifiedOutputCount,0);
  const schema=nativeMemorySavedOutputsSchemaQuery();f.db.exec("DROP TABLE output_native_storage_writes");assert.equal(f.db.prepare(schema.sql).get().ready,0);
});
test("native saved outputs: all current dependency deadlines remain absolute after database delivery",t=>{
  const f=fixture(t,{shared:true}),rows=f.rows();assert.equal(rows.length,1);
  for(const field of ["remembered_expires_at","job_expires_at","content_expires_at","output_expires_at","prompt_expires_at","output_assigned_expires_at","prompt_assigned_expires_at"]){
    const current=structuredClone(rows);current[0][field]=iso(f.now+1000);
    assert.equal(nativeMemorySavedOutputsValue(current,f.e,f.sources,f.checkedAt,f.until).validUntil,iso(f.now+1000));
    assert.equal(nativeMemorySavedOutputsValue(current,f.e,f.sources,iso(f.now+1001),f.until),null,field);
  }
});
test("native saved outputs: ambiguous canonical object and wrong causal chain are not repaired from mutable metadata",t=>{
  const f=fixture(t);assert.ok(f.read());f.add("other-completion",7,"GenerationCompleted",{document_id:"document",object_id:f.objectId,object_ids:[f.objectId]},
    {actor:"worker:generator",causation:"compiled",correlation:"other"});assert.equal(f.read(),null);
});
test("native saved outputs: malformed result bounds and selections fail closed",t=>{
  const f=fixture(t),rows=f.rows();assert.ok(f.read());
  for(const input of [null,[null],Array(1),Array(65).fill(rows[0]),[{...rows[0],object_id:"x".repeat(241)}],[{...rows[0],media_url:"x".repeat(140000)}]])assert.equal(nativeMemorySavedOutputsValue(input,f.e,f.sources,f.checkedAt,f.until),null);
  for(const refs of [Array(1),[...f.sources,...f.sources],Array(65).fill(f.sources[0])])assert.throws(()=>nativeMemorySavedOutputsQuery(f.e,f.q,refs));
  assert.equal(nativeMemorySavedOutputsValue(rows,f.e,f.sources,f.checkedAt,iso(f.now+60_001)),null);
});

for(const [field,value] of [["canvas_id","canvas"],["context_set_id","context"],["report_space","scout"],["replay_session_id","replay"],
  ["mock_data_source","mock"],["fictional_user_id","fictional"],["origin",{synthetic:true}],["synthetic",true]])
  test("native saved outputs: immutable "+field+" cannot be laundered by deleting the private marker",t=>{
    const f=fixture(t);assert.ok(f.read());
    const payload=JSON.parse(f.db.prepare("SELECT payload FROM events WHERE event_id='compiled'").get().payload);payload[field]=value;
    f.db.prepare("UPDATE events SET payload=? WHERE event_id='compiled'").run(JSON.stringify(payload));
    f.raw("compiled",p=>delete p[field]);assert.equal(f.read(),null);
  });
test("native saved outputs: mutable index rebinding cannot substitute another job's immutable generation chain",t=>{
  const f=fixture(t);assert.ok(f.read());
  // The historical queue remains job, but all index fields are made to agree
  // with a different valid same-owner/document generation correlation.
  f.db.exec("UPDATE events SET correlation_id='other-job:attempt:1' WHERE event_id IN('requested','compiled','completed'); UPDATE document_jobs SET correlation_id='other-job:attempt:1'");
  assert.equal(f.read(),null);
});
for(const [name,sql] of [
  ["causation mismatch","UPDATE events SET causation_id='queued' WHERE event_id='compiled'"],
  ["wrong request actor","UPDATE events SET actor='user:other' WHERE event_id='requested'"],
  ["wrong native client","UPDATE events SET client_id='web:lit' WHERE event_id='compiled'"],
  ["retained object discarded","INSERT INTO events SELECT 'discard',stream_id,9,'ObjectDiscarded','user','web:lit','discard',NULL,NULL,recorded_at,payload FROM events WHERE event_id='save'"],
  ["extra matching compile","INSERT INTO events SELECT 'duplicate-compile',stream_id,7,type,actor,client_id,correlation_id,causation_id,compensates_event_id,recorded_at,payload FROM events WHERE event_id='compiled'"],
  ["wrong current attempt","UPDATE document_jobs SET attempt_count=2"],
  ["noninteger current attempt","UPDATE document_jobs SET attempt_count=1.5"],
  ["expired job metadata","UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z'"],
  ["expired output content","UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id='output'"]
])test("native saved outputs: omits "+name,t=>{const f=fixture(t);assert.ok(f.read());f.db.exec(sql);assert.equal(f.read(),null);});
test("native saved outputs: immutable content deadline is not renewed by mutable metadata",t=>{
  const f=fixture(t),payload=JSON.parse(f.db.prepare("SELECT payload FROM events WHERE event_id='completed'").get().payload);
  payload.content_expires_at=iso(f.now+1000);f.db.prepare("UPDATE events SET payload=? WHERE event_id='completed'").run(JSON.stringify(payload));
  f.raw("completed",p=>p.content_expires_at=payload.content_expires_at);
  const rows=f.rows();assert.equal(nativeMemorySavedOutputsValue(rows,f.e,f.sources,f.checkedAt,f.until).validUntil,payload.content_expires_at);
  assert.equal(nativeMemorySavedOutputsValue(rows,f.e,f.sources,iso(f.now+1001),f.until),null);
});
test("native saved outputs: unknown overloaded or older-wire action stays an explicitly incomplete window",t=>{
  const f=fixture(t);f.add("legacy",9,"ObjectSaved",{project_id:"project",document_id:"document",object_id:"ordinary-block"},{actor:"user",client:"web:lit",correlation:"legacy"});
  f.sources.push({eventId:"legacy",sequence:9,type:"ObjectSaved",blockId:null,recordedAt:f.at(9),validUntil:f.expires});
  f.db.prepare("INSERT INTO memory_live_sources VALUES(?,?,?,?)").run(f.e.enrollment_id,"legacy",9,f.expires);
  const result=f.read();assert.ok(result);assert.equal(result.value.coverage.selectedRetentionActionCount,2);assert.equal(result.value.coverage.certifiedOutputCount,1);
  assert.equal(result.value.coverage.completeHistory,false);assert.deepEqual(result.value.outputs[0].sourceIndexes,[0]);
  f.sources.splice(0,1);assert.equal(f.read(),null,"selected activity without native proof is unavailable, not zero");
});
test("native saved outputs: descriptor excludes extra enrollment and selection properties",t=>{
  const f=fixture(t);f.e.extra="private enrollment notes";f.sources[0].extra="private source notes";
  const query=nativeMemorySavedOutputsQuery(f.e,f.q,f.sources);assert.doesNotMatch(JSON.stringify(query),/private enrollment notes|private source notes/u);
  assert.ok(query.bindings.length<100);assert.ok(query.sql.length<90_000);assert.ok(f.read());
});

for(const [name,mutate] of [
  ["unknown field",v=>v.text="secret"],["wrong version",v=>v.version="future"],["preference claim",v=>v.inferredPreferences=true],
  ["complete-history claim",v=>v.coverage.completeHistory=true],["asserted count",v=>v.coverage.certifiedOutputCount=99],
  ["off-window index",v=>v.outputs[0].sourceIndexes=[1]],["duplicate index",v=>v.outputs[0].sourceIndexes=[0,0]],
  ["sparse indices",v=>v.outputs[0].sourceIndexes=Array(1)],["coerced index",v=>v.outputs[0].sourceIndexes=["0"]],
  ["independence claim",v=>v.outputs[0].independentEvidence=true],["private object ID",v=>v.outputs[0].objectId="hidden"],
  ["future generation",v=>v.outputs[0].generatedAt="2999-01-01T00:00:00.000Z"],["known zero with selected retention",v=>{v.outputs=[];v.coverage.certifiedOutputCount=0;}]
])test("saved output parser: rejects "+name,t=>{const f=fixture(t),value=f.read().value;mutate(value);assert.equal(parseMemorySavedOutputs(value,f.sources,{checkedAt:f.checkedAt,validUntil:f.until}),null);});
