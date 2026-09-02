import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { outputTestDatabase } from "../output-server-test-helpers.mjs";
import { memoryFixture } from "./scoped-memory.mjs";
import { createMemoryRecord, memoryKey } from "../../src/model/scoped-memory.ts";
import { memoryWorkflowPatterns } from "../../src/model/memory-observations.ts";
import { createMemoryConversationSegment } from "../../src/model/memory-conversation.ts";
import { publicEventPayload } from "../../worker/event-privacy.ts";
import { MemorySourceAdapter } from "../../worker/memory-source-adapter.ts";
import { MemoryShadowStore } from "../../worker/memory-store.ts";
import { MemoryBoundaryError } from "../../worker/memory-sql.ts";
import { planMemoryReview } from "../../worker/memory-shadow.ts";

const migration = readFileSync(new URL("../../db/memory-shadow/0001_shadow_memory.sql",import.meta.url),"utf8");
export const memoryMigrationHash = createHash("sha256").update(migration).digest("hex");
const jobMigration = readFileSync(new URL("../../db/memory-shadow/0002_review_jobs.sql",import.meta.url),"utf8");
export const memoryJobMigrationHash = createHash("sha256").update(jobMigration).digest("hex");

/** Separate marker: installing the original store never implicitly installs jobs. */
export function installMemoryJobTestSchema(sqlite) {
  if(sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='memory_shadow_job_schema'").get()){
    const rows=sqlite.prepare("SELECT * FROM memory_shadow_job_schema").all();
    assert.equal(rows.length,1);assert.equal(rows[0].version,1);assert.equal(rows[0].isolation,"synthetic-only");
    assert.equal(rows[0].migration_hash,memoryJobMigrationHash,"Memory job migration fingerprint mismatch");return false;
  }
  sqlite.exec("BEGIN IMMEDIATE");
  try{
    for(const statement of jobMigration.split("--> statement-breakpoint").map((text)=>text.trim()).filter(Boolean))sqlite.prepare(statement).run();
    sqlite.prepare("INSERT INTO memory_shadow_job_schema VALUES(1,?,'synthetic-only')").run(memoryJobMigrationHash);
    sqlite.exec("COMMIT");return true;
  }catch(error){sqlite.exec("ROLLBACK");throw error;}
}

/** The app never imports this installer. Only explicit isolated test databases reach it. */
export function installMemoryTestSchema(sqlite) {
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_shadow_schema'").get();
  if (exists) {
    const rows = sqlite.prepare("SELECT * FROM memory_shadow_schema").all();
    assert.equal(rows.length,1,"Unknown memory schema");
    assert.equal(rows[0].version,1,"Unknown memory schema");
    assert.equal(rows[0].isolation,"synthetic-only","Not an isolated memory database");
    assert.equal(rows[0].migration_hash,memoryMigrationHash,"Memory migration fingerprint mismatch");
    return false;
  }
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const statement of migration.split("--> statement-breakpoint").map((text) => text.trim()).filter(Boolean)) sqlite.prepare(statement).run();
    sqlite.prepare("INSERT INTO memory_shadow_schema(version,migration_hash,isolation) VALUES(1,?,'synthetic-only')").run(memoryMigrationHash);
    sqlite.exec("COMMIT");
    return true;
  } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
}

/** Reuse the project's genuine SQLite/D1 transaction harness; hooks never log bindings. */
export function memoryTestDatabase(path = ":memory:") {
  const base = outputTestDatabase(path), controls = { queries: [], beforeBatch: null, afterBatch: null, beforeStatement: null };
  const originalPrepare = base.DB.prepare.bind(base.DB), originalBatch = base.DB.batch.bind(base.DB);
  class Statement {
    constructor(sql,bindings = []) { this.sql=sql;this.bindings=bindings; }
    bind(...bindings) { assert.ok(bindings.length<=100,"D1 binding limit");return new Statement(this.sql,bindings); }
    execute(kind) {
      controls.queries.push(this.sql);
      controls.beforeStatement?.(this.sql,this.bindings);
      return originalPrepare(this.sql).bind(...this.bindings).execute(kind);
    }
    async first() { return this.execute("first"); }
    async all() { return this.execute("all"); }
    async run() { return this.execute("run"); }
  }
  const DB = { prepare(sql) { return new Statement(sql); }, async batch(statements) {
    await controls.beforeBatch?.(statements);
    const result = await originalBatch(statements);
    await controls.afterBatch?.(statements);
    return result;
  } };
  return { sqlite: base.sqlite,DB,controls,close() { base.sqlite.close(); } };
}

// Minimal column-compatible SOURCE fixture, not a replacement application migration.
const SOURCE_SCHEMA = [
  `CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT,recorded_at TEXT,actor TEXT,
    client_id TEXT,correlation_id TEXT,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER,type TEXT,payload TEXT,UNIQUE(stream_id,sequence))`,
  "CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,project_id TEXT,document_id TEXT,private_json TEXT,created_at TEXT,redacted_at TEXT)",
  "CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,created_at TEXT,expires_at TEXT,redacted_at TEXT)",
  `CREATE TABLE assistant_turns(actor_user_id TEXT,scope_key TEXT,turn_id TEXT,user_content_ref TEXT,assistant_content_ref TEXT,status TEXT,
    project_id TEXT,document_id TEXT,PRIMARY KEY(actor_user_id,scope_key,turn_id))`,
  "CREATE TABLE assistant_specialist_tasks(task_id TEXT PRIMARY KEY,actor_user_id TEXT,scope_key TEXT,turn_id TEXT,status TEXT)",
  "CREATE TABLE event_client_receipts(stream_id TEXT,client_event_id TEXT,event_id TEXT,sequence INTEGER,created_at TEXT,PRIMARY KEY(stream_id,client_event_id))",
  "CREATE TABLE assistant_action_commits(commit_id TEXT PRIMARY KEY,verified INTEGER,created_at TEXT)",
  `CREATE TABLE project_event_scopes(event_id TEXT PRIMARY KEY,project_access_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,
    source_stream_id TEXT,source_sequence INTEGER,project_sequence INTEGER,actor_user_id TEXT,created_at TEXT)`,
  `CREATE TABLE project_resource_scopes(project_access_id TEXT,resource_kind TEXT,resource_id TEXT,organization_id TEXT,project_id TEXT,
    owner_user_id TEXT,visibility TEXT,source_event_id TEXT,actor_user_id TEXT,created_at TEXT,PRIMARY KEY(project_access_id,resource_kind,resource_id))`,
  `CREATE TABLE private_content_retention_scopes(content_id TEXT PRIMARY KEY,organization_id TEXT,project_access_id TEXT,project_id TEXT,
    actor_user_id TEXT,classification TEXT,policy_version INTEGER,assigned_expires_at TEXT,created_at TEXT)`,
  "CREATE TABLE fixture_memory_authority(actor_user_id TEXT,custodian_id TEXT,authority_json TEXT,PRIMARY KEY(actor_user_id,custodian_id))",
  "CREATE TABLE fixture_memory_bindings(actor_user_id TEXT,custodian_id TEXT,event_id TEXT,binding_json TEXT,PRIMARY KEY(actor_user_id,custodian_id,event_id))",
];

export function memoryPersistenceFixture(options = {}) {
  const database = options.database ?? memoryTestDatabase(options.path), { sqlite,DB,controls } = database;
  installMemoryTestSchema(sqlite);
  if (!sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='fixture_memory_authority'").get()) for (const statement of SOURCE_SCHEMA) sqlite.prepare(statement).run();
  const actor = options.actor ?? "alice",custodian = options.custodian ?? "org:alpha",owner = options.owner ?? "owner";
  const identity = { actorUserId: actor,custodianId: custodian,targetScopeId: "document" },stream = `creative:${owner}`;
  const fixture = memoryFixture({ actorUserId: actor,targetScopeId: "document",custodianId: custodian });
  const clock = options.clock ?? options.database?.clock ?? { now: "2026-09-02T06:00:00.000Z" };
  sqlite.function("memory_fixture_now",{deterministic:false},()=>clock.now);
  const organization = custodian.startsWith("org:") ? custodian.slice(4) : null;
  const projectAccess = organization ? `project-access:${organization}` : null;
  const projectId = "nested-project",documentId="document",scopeKey=JSON.stringify([organization??"",projectAccess??"",projectId,documentId]);
  const authorityRow = { access: { ...fixture.access,custodianId: custodian },
    scopes: fixture.scopes.filter((row) => row.custodianId === "org:alpha").map((row) => ({ ...row,custodianId: custodian })),
    streams: [{ streamId: stream,ownerUserId: owner }] };
  authorityRow.access.grants=authorityRow.access.grants.map((grant) => ({ ...grant,custodianId: custodian }));
  if (!sqlite.prepare("SELECT 1 FROM fixture_memory_authority WHERE actor_user_id=? AND custodian_id=?").get(actor,custodian))
    sqlite.prepare("INSERT INTO fixture_memory_authority VALUES(?,?,?)").run(actor,custodian,JSON.stringify(authorityRow));
  const authority = {
    async authorize(request,now) {
      const row=await DB.prepare("SELECT authority_json FROM fixture_memory_authority WHERE actor_user_id=? AND custodian_id=?")
        .bind(request.actorUserId,request.custodianId).first();
      if (!row) throw new MemoryBoundaryError("memory-source-access-denied");
      const value=JSON.parse(row.authority_json);
      return { ...value,access: { ...value.access,now,targetScopeId: request.targetScopeId },guard: {
        condition: "EXISTS(SELECT 1 FROM fixture_memory_authority WHERE actor_user_id=? AND custodian_id=? AND authority_json=?)",
        bindings: [request.actorUserId,request.custodianId,row.authority_json],
      } };
    },
    async resolveEvent(header,snapshot) {
      const row=await DB.prepare("SELECT binding_json FROM fixture_memory_bindings WHERE actor_user_id=? AND custodian_id=? AND event_id=?")
        .bind(snapshot.access.actorUserId,snapshot.access.custodianId,header.event_id).first();
      if (!row) throw new MemoryBoundaryError("unresolved-memory-event-binding");
      const value=JSON.parse(row.binding_json);
      return { ...value,guard: { condition: "EXISTS(SELECT 1 FROM fixture_memory_bindings WHERE actor_user_id=? AND custodian_id=? AND event_id=? AND binding_json=?)",
        bindings: [snapshot.access.actorUserId,snapshot.access.custodianId,header.event_id,row.binding_json] } };
    },
  };
  const adapter = new MemorySourceAdapter(DB,authority,{ mode: options.mode ?? "synthetic-shadow",clock: () => clock.now,
    databaseClock:"julianday(memory_fixture_now())",pageSize: options.pageSize ?? 3 });
  const store = new MemoryShadowStore(DB,adapter);
  const changeAuthority = (change) => {
    const row=sqlite.prepare("SELECT authority_json FROM fixture_memory_authority WHERE actor_user_id=? AND custodian_id=?").get(actor,custodian);
    const value=JSON.parse(row.authority_json);change(value);
    sqlite.prepare("UPDATE fixture_memory_authority SET authority_json=? WHERE actor_user_id=? AND custodian_id=?").run(JSON.stringify(value),actor,custodian);
  };
  const changeBinding = (eventId,change) => {
    const row=sqlite.prepare("SELECT binding_json FROM fixture_memory_bindings WHERE actor_user_id=? AND custodian_id=? AND event_id=?").get(actor,custodian,eventId);
    const value=JSON.parse(row.binding_json);change(value);
    sqlite.prepare("UPDATE fixture_memory_bindings SET binding_json=? WHERE actor_user_id=? AND custodian_id=? AND event_id=?").run(JSON.stringify(value),actor,custodian,eventId);
  };
  function addEvent(input = {}) {
    const sequence=Number(sqlite.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS next FROM events WHERE stream_id=?").get(stream).next);
    const id=input.id??`${actor}-event-${sequence}`,type=input.type??"BlockPropertyEdited";
    const at=input.at??"2026-09-01T14:00:00.000Z", scopeId=input.scopeId??"block";
    const payload={ project_id:projectId,document_id:documentId,actor_user_id:actor,block_id:scopeId,...input.payload };
    const split=publicEventPayload(id,payload,true);
    sqlite.prepare("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,stream,sequence,at,at,input.actor??`user:${actor}`,
      "synthetic-fixture",input.correlation??id,input.causation??null,input.compensates??null,1,type,JSON.stringify(split.payload));
    sqlite.prepare("INSERT INTO event_private_payloads VALUES(?,?,?,?,?,?,NULL)").run(id,owner,projectId,documentId,split.privateJson,at);
    const binding={ status:"available",actorUserId:actor,custodianId:custodian,scopeId,scopeVersion:1,revision:`event-r${sequence}`,
      projectId,documentId,organizationId:organization,projectAccessId:projectAccess,visibility:"actor",expiresAt:"2026-10-01T00:00:00.000Z",
      origin:"user",lineageId:input.lineageId??id,independentEvidence:true,synthetic:true,lineageResolved:true,
      outcomeId:input.outcomeId??id,episodeId:input.episodeId??`episode-${sequence}`,
      targets:[{ id:scopeId,scopeId,revision:"r1",kind:scopeId==="document"?"document":"block" }],...input.binding };
    sqlite.prepare("INSERT INTO fixture_memory_bindings VALUES(?,?,?,?)").run(actor,custodian,id,JSON.stringify(binding));
    if (organization) sqlite.prepare("INSERT INTO project_event_scopes VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id,projectAccess,organization,projectId,owner,stream,sequence,sequence,actor,at);
    return { id,sequence,binding,payload };
  }
  function addChat(turnId,userText="Please keep the chart labels concise.",assistantText="I suggest shortening the chart labels.") {
    const userRef=`${actor}:${turnId}:user`,answerRef=`${actor}:${turnId}:assistant`;
    for (const [id,kind,text] of [[userRef,"chat-user",userText],[answerRef,"chat-assistant",assistantText]]) {
      sqlite.prepare("INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)").run(id,actor,kind,text,"2026-09-01T14:00:00.000Z","2026-09-30T00:00:00.000Z");
      if (organization) {
        sqlite.prepare("INSERT INTO project_resource_scopes VALUES(?,'content',?,?,?,?,'actor_private',NULL,?,?)")
          .run(projectAccess,id,organization,projectId,owner,actor,"2026-09-01T14:00:00.000Z");
        sqlite.prepare("INSERT INTO private_content_retention_scopes VALUES(?,?,?,?,?,'transient-private',1,?,?)")
          .run(id,organization,projectAccess,projectId,actor,"2026-09-30T00:00:00.000Z","2026-09-01T14:00:00.000Z");
      }
    }
    sqlite.prepare("INSERT INTO assistant_turns VALUES(?,?,?,?,?,'completed',?,?)").run(actor,scopeKey,turnId,userRef,answerRef,projectId,documentId);
    const conversation={ conversationId:`conversation:${actor}:${documentId}`,scopeKey,turnId };
    const user=addEvent({ type:"ChatMessageSent",scopeId:"document",correlation:`chat:${actor}:${turnId}`,
      payload:{ turn_id:turnId,content_ref:userRef },binding:{ conversation } });
    const assistant=addEvent({ type:"AssistantReasoned",scopeId:"document",correlation:`chat:${actor}:${turnId}`,causation:user.id,
      payload:{ turn_id:turnId,content_ref:answerRef,operation:"creative-chat" },binding:{ conversation } });
    return { user,assistant,userRef,answerRef,conversation };
  }
  return { ...database,controls,identity,clock,authority,adapter,store,actor,custodian,owner,stream,scopeKey,organization,projectAccess,
    changeAuthority,changeBinding,addEvent,addChat };
}

export function seedMemoryDocument(state) {
  state.addEvent({ type:"DocumentOpened",scopeId:"document" });
  for (let index=0;index<3;index++) state.addEvent({ episodeId:`editing-session-${index}`,payload:{ property:"text",value:`synthetic edit ${index}` } });
  const first=state.addChat("turn-1"),second=state.addChat("turn-2","Keep the approved heading unchanged.","I can preserve that heading.");
  state.addEvent({ type:"ProviderRequestCompleted",actor:"worker:fixture",payload:{ tokens:12 } });
  return { first,second };
}

export async function draftMemoryReview(state,options = {}) {
  const capture=await state.store.capture(state.identity,options.recipe??"document-memory-v1");assert.ok(capture);
  const evidence=state.store.evidence(capture);
  const decision=await planMemoryReview({ mode:"shadow",...evidence,processed:evidence.inventory.from,
    recipeVersion:options.recipe??"document-memory-v1",timeZone:"America/New_York" });
  assert.equal(decision.status,"planned");
  const records=evidence.observations.map((observation) => createMemoryRecord({ id:`episode:${observation.eventId}`,version:1,
    scopeId:observation.scopeId,kind:"episode",claimKey:`outcome:${observation.outcomeId}`,
    body:`Observed ${observation.action} on ${observation.targets[0].kind}; historical activity, not a preference.`,
    sources:[evidence.sources.get(memoryKey(observation.custodianId,observation.source.id))] },evidence.access,evidence.graph));
  for (const pattern of memoryWorkflowPatterns(evidence)) records.push(createMemoryRecord({ id:`workflow:${pattern.scopeId}:${pattern.action}`,version:1,
    scopeId:pattern.scopeId,kind:"workflow-pattern",claimKey:pattern.claimKey,
    body:`Repeated ${pattern.action} activity: ${pattern.independentOutcomes} independent outcomes across ${pattern.episodeCount} episodes.`,
    sources:pattern.sourceIds.map((id)=>evidence.sources.get(memoryKey(state.custodian,id))) },evidence.access,evidence.graph));
  const segments=[];
  for (const inventory of evidence.conversations) {
    const segment=await createMemoryConversationSegment({ id:`summary:${inventory.conversationId}`,version:1,
      inventory:{ ...inventory,turns:inventory.turns.slice(0,2) } },evidence.sources,evidence.access,evidence.graph);
    if (segment) { segments.push(segment);records.push(segment.record); }
  }
  assert.ok(records.every(Boolean));
  return { capture,plan:decision.plan,records,segments,evidence };
}
