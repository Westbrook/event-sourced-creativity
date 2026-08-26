import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DURABLE_WORK_RETENTION_END,
  loadPrivateContent,
  loadPrivateProviderResponse,
  privateContentRetentionClass,
  storePrivateContent,
} from "../worker/pilot-policy.ts";
import { authoritativeCreativeContext, ContextIntegrityError } from "../worker/context-authority.ts";
import { validateArtifactReview } from "../worker/artifact-review.ts";
import { projectAnalyticsPayload } from "../worker/analytics-api.ts";
import { appendEvents, appendEventsWithClientReceipts, ensureSchema, makeEvent, readEventPage, StaleSequenceError, sweepExpiredPrivateContent } from "../worker/runtime.ts";
import { publicEventPayload } from "../worker/event-privacy.ts";
import { migrateLegacyEventPayloads } from "../worker/event-privacy-migration.ts";
import { artifactReviewState, assessCreativeContext } from "../src/model/context-health.ts";
import { foldEvents } from "../src/model/events.ts";
import {
  legacyOwnerMediaNamespace,
  mediaKeyMatchesOwnerNamespace,
  ownerMediaNamespace,
} from "../src/model/media-ownership.ts";

test("local encryption-root setup is private, idempotent, permission-safe, and rejects malformed existing secrets",()=>{
  const temporary=mkdtempSync(join(tmpdir(),"forma-encryption-root-")),script=fileURLToPath(new URL("../scripts/setup-local-encryption-root.mjs",import.meta.url)),file=join(temporary,".env.local");
  try{
    const run=()=>spawnSync(process.execPath,[script],{cwd:temporary,encoding:"utf8"});
    writeFileSync(file,"EXISTING_LOCAL_SETTING=preserved\n",{mode:0o644});
    const first=run();assert.equal(first.status,0,first.stderr);
    const initial=readFileSync(file,"utf8"),root=initial.match(/^FORMA_ENCRYPTION_ROOT_KEY=([a-f0-9]{64})$/m)?.[1];assert.ok(root);
    assert.match(initial,/^EXISTING_LOCAL_SETTING=preserved$/m);assert.doesNotMatch(first.stdout,new RegExp(root));assert.equal(statSync(file).mode&0o777,0o600);
    chmodSync(file,0o644);const repeated=run();assert.equal(repeated.status,0,repeated.stderr);assert.equal(readFileSync(file,"utf8"),initial,"re-running local setup must never silently rotate the root protecting historical recovery snapshots");assert.equal([...readFileSync(file,"utf8").matchAll(/^FORMA_ENCRYPTION_ROOT_KEY=/gm)].length,1);assert.equal(statSync(file).mode&0o777,0o600);
    writeFileSync(file,"FORMA_ENCRYPTION_ROOT_KEY=not-a-valid-development-root\n",{mode:0o600});const malformed=run();assert.notEqual(malformed.status,0);assert.match(malformed.stderr,/existing local development encryption root is invalid/i);assert.equal(readFileSync(file,"utf8"),"FORMA_ENCRYPTION_ROOT_KEY=not-a-valid-development-root\n");
  }finally{rmSync(temporary,{recursive:true,force:true});}
});

function contentDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,redacted_at TEXT)");
  sqlite.exec("CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT,actor_user_id TEXT,owner_user_id TEXT,visibility TEXT)");
  sqlite.exec("CREATE TABLE private_content_retention_scopes(content_id TEXT PRIMARY KEY)");

  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    execute(kind) {
      const statement = sqlite.prepare(this.sql);
      if (kind === "first") return statement.get(...this.values) ?? null;
      if (kind === "all") return { results: statement.all(...this.values), success: true, meta: { changes: 0 } };
      const result = statement.run(...this.values);
      return { results: [], success: true, meta: { changes: Number(result.changes ?? 0) } };
    }
    async all() { return this.execute("all"); }
    async first() { return this.execute("first"); }
    async run() { return this.execute("run"); }
  }

  return {
    sqlite,
    env: {
      FORMA_RETENTION_DAYS: "1",
      DB: {
        prepare(sql) { return new Statement(sql); },
        async batch(statements) {
          sqlite.exec("BEGIN");
          try {
            const results = statements.map((statement) => statement.execute(/^\s*SELECT/i.test(statement.sql) ? "all" : "run"));
            sqlite.exec("COMMIT");
            return results;
          } catch (error) {
            sqlite.exec("ROLLBACK");
            throw error;
          }
        },
      },
    },
  };
}

function governedEventDatabase({ triggerInclusiveChanges = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    execute(kind) {
      const prepared = sqlite.prepare(this.sql);
      if (kind === "first") return prepared.get(...this.values) ?? null;
      if (kind === "all") return { results: prepared.all(...this.values), success: true, meta: { changes: 0 } };
      const before = triggerInclusiveChanges ? Number(sqlite.prepare("SELECT total_changes() AS count").get().count) : 0;
      const executed = prepared.run(...this.values);
      const changes = triggerInclusiveChanges
        ? Number(sqlite.prepare("SELECT total_changes() AS count").get().count) - before
        : Number(executed.changes ?? 0);
      return { results: [], success: true, meta: { changes } };
    }
    async first() { return this.execute("first"); }
    async all() { return this.execute("all"); }
    async run() { return this.execute("run"); }
  }
  const DB = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = statements.map((statement) => statement.execute(/^\s*(?:SELECT|WITH)/i.test(statement.sql) ? "all" : "run"));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, env: { DB } };
}

const event = (sequence, type, payload, actor = "user") => ({
  eventId: `event-${sequence}`,
  streamId: "creative:owner",
  sequence,
  occurredAt: "2026-08-23T12:00:00.000Z",
  recordedAt: "2026-08-23T12:00:00.000Z",
  actor,
  clientId: "test",
  correlationId: `correlation-${sequence}`,
  causationId: null,
  compensatesEventId: null,
  schemaVersion: 1,
  type,
  payload,
});

function contextHistory() {
  return [
    event(1, "ProjectCreated", { project_id: "project-approved", name: "Approved" }),
    event(2, "DocumentCreated", { project_id: "project-approved", document_id: "document-approved", title: "Approved brief" }),
    event(3, "BlockCreated", { project_id: "project-approved", document_id: "document-approved", block_id: "direction-approved", type: "direction", handle: "direction/approved", position: "a1", properties: { text: "The real approved objective", weight: .8, authority: "authored" } }),
    event(4, "BlockCreated", { project_id: "project-approved", document_id: "document-approved", block_id: "boundary-approved", type: "exclusion", handle: "exclusion/approved", position: "a2", properties: { text: "Never reveal customer account numbers", intent: "prohibit", weight: 1, authority: "authored" } }),
    event(5, "ProjectCreated", { project_id: "project-foreign", name: "Foreign" }),
    event(6, "DocumentCreated", { project_id: "project-foreign", document_id: "document-foreign", title: "Foreign brief" }),
    event(7, "BlockCreated", { project_id: "project-foreign", document_id: "document-foreign", block_id: "direction-foreign", type: "direction", handle: "direction/foreign", position: "a1", properties: { text: "FOREIGN TENANT PRIVATE INSTRUCTIONS", weight: .9 } }),
  ];
}

test("finished deliverables and exact input receipts survive prompt-retention cleanup without restoring expired work", async () => {
  const { sqlite, env } = contentDatabase();
  const now = new Date().toISOString();
  const expired = new Date(Date.now() - 60_000).toISOString();
  const insert = sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)");
  insert.run("expired-prompt", "owner", "prompt", "DELETE ME", now, expired);
  insert.run("expired-historical-output", "owner", "document-artifact", "DO NOT ERASE OR RESURRECT", now, expired);
  insert.run("expired-historical-input", "owner", "document-artifact-input", "DO NOT ERASE OR RESURRECT INPUT", now, expired);
  insert.run("foreign-prompt", "another-owner", "prompt", "ANOTHER ACCOUNT", now, expired);

  const artifact = await storePrivateContent(env, "owner", "document-artifact", "PAID FINISHED WORK");
  const input = await storePrivateContent(env, "owner", "document-artifact-input", "EXACT APPROVED INPUT");
  const prompt = await storePrivateContent(env, "owner", "prompt", "SHORT-LIVED PROMPT");

  assert.equal(artifact.expiresAt, DURABLE_WORK_RETENTION_END);
  assert.notEqual(input.expiresAt, DURABLE_WORK_RETENTION_END, "sensitive provider receipts have their own finite evidence policy");
  assert.ok(Date.parse(input.expiresAt)-Date.now()>360*86_400_000);
  assert.notEqual(prompt.expiresAt, DURABLE_WORK_RETENTION_END);
  assert.equal(privateContentRetentionClass("document-artifact"), "durable-work");
  assert.equal(privateContentRetentionClass("document-artifact-input"), "governed-evidence");
  assert.equal(privateContentRetentionClass("prompt"), "transient-private");
  const cleanedPrompt = sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id='expired-prompt'").get();
  assert.equal(cleanedPrompt.content, "");
  assert.ok(cleanedPrompt.redacted_at);
  assert.deepEqual({ ...sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id='expired-historical-output'").get() }, { content: "DO NOT ERASE OR RESURRECT", redacted_at: null });
  const expiredEvidence=sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id='expired-historical-input'").get();
  assert.equal(expiredEvidence.content, "");
  assert.ok(expiredEvidence.redacted_at, "expired private input receipts are erased independently of durable outputs");
  assert.equal(sqlite.prepare("SELECT content FROM private_content WHERE content_id='foreign-prompt'").get().content, "ANOTHER ACCOUNT");

  const visible = await loadPrivateContent(env, "owner");
  assert.equal(visible[artifact.contentId], "PAID FINISHED WORK");
  assert.equal(visible[input.contentId], "EXACT APPROVED INPUT");
  assert.equal(visible["expired-historical-output"], undefined, "expired historical work is never silently resurrected");
});

test("retained provider responses remain server-only, owner-bound, and subject to private retention",async()=>{
  const {sqlite,env}=contentDatabase();
  const secret="SERVER_ONLY_PAID_PRESENTATION_RESPONSE_9137";
  const stored=await storePrivateContent(env,"owner","provider-response",secret);
  assert.equal(privateContentRetentionClass("provider-response"),"transient-private");
  assert.equal((await loadPrivateContent(env,"owner"))[stored.contentId],undefined,"ordinary browser content hydration never receives provider responses");
  assert.equal((await loadPrivateProviderResponse(env,"owner",stored.contentId))?.content,secret);
  assert.equal(await loadPrivateProviderResponse(env,"another-owner",stored.contentId),null,"another actor cannot replay a paid response");
  sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(new Date(Date.now()-1000).toISOString(),stored.contentId);
  assert.equal(await loadPrivateProviderResponse(env,"owner",stored.contentId),null,"expired provider output cannot be replayed");
});

test("immutable events preserve operational identifiers while authored nested context stays owner-scoped and erasable", async () => {
  const { sqlite, env } = governedEventDatabase();
  await ensureSchema(env);
  const sentinel = "STRICTLY PRIVATE CUSTOMER EVIDENCE 4819";
  const original = makeEvent("creative:owner", 0, "user", "test", "correlation", "BlockCreated", {
    project_id: "project-approved", document_id: "document-approved", block_id: "block-private", type: "direction",
    handle: "direction/customer-secret", properties: { text: sentinel, nested: { note: `${sentinel} nested` } },
  });
  const canvas = makeEvent("creative:owner", 0, "user", "test", "correlation", "CanvasTextApplied", {
    project_id: "project-approved", canvas_id: "board-1", item_id: "item-1", operation: { ops: [{ ins: { chars: sentinel } }] },
  });
  await appendEvents(env, [original, canvas]);
  const immutable = sqlite.prepare("SELECT payload FROM events ORDER BY sequence").all().map((row) => String(row.payload));
  assert.ok(immutable.every((payload) => !payload.includes(sentinel)));
  assert.deepEqual(JSON.parse(immutable[0]).block_id, "block-private");
  assert.deepEqual(sqlite.prepare("SELECT owner_id FROM event_private_payloads ORDER BY created_at").all().map((row) => row.owner_id), ["owner", "owner"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM event_write_stage").get().count, 0);

  const readable = await readEventPage(env, "creative:owner");
  assert.equal(readable[0].payload.properties.text, sentinel);
  assert.equal(readable[1].payload.operation.ops[0].ins.chars, sentinel);
  sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=? AND owner_id=?").run(new Date().toISOString(), original.eventId, "owner");
  const erased = await readEventPage(env, "creative:owner");
  assert.equal(erased[0].eventId, original.eventId);
  assert.equal(erased[0].payload.properties, undefined);
  assert.equal(erased[1].payload.operation.ops[0].ins.chars, sentinel);
  assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT payload FROM events").all()), new RegExp(sentinel));
});

test("event appends accept trigger-inclusive D1 change counts without replaying committed identities", async () => {
  const { sqlite, env } = governedEventDatabase({ triggerInclusiveChanges: true });
  await ensureSchema(env);
  const streamId = "creative:owner";
  const request = makeEvent(streamId, 0, "user", "test", "render-attempt", "DocumentRenderRequested", {
    document_id: "document-approved", artifact_id: "artifact-approved", artifact_kind: "slides", audience: "Private audience",
  });
  const reserved = makeEvent(streamId, 0, "worker:policy", "test", "render-attempt", "BudgetReserved", {
    document_id: "document-approved", artifact_id: "artifact-approved", reservation_id: "reservation-approved", reserved_tokens: 32_000,
  });

  await appendEvents(env, [request, reserved]);

  assert.deepEqual(sqlite.prepare("SELECT event_id,sequence FROM events ORDER BY sequence").all().map((row) => ({ ...row })), [
    { event_id: request.eventId, sequence: 1 },
    { event_id: reserved.eventId, sequence: 2 },
  ]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM event_private_payloads").get().count, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM event_write_stage").get().count, 0);
  assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT payload FROM events").all()), /Private audience/);

  const stale = makeEvent(streamId, 0, "user", "test", "stale-attempt", "DocumentOpened", { document_id: "document-approved" });
  await assert.rejects(() => appendEvents(env, [stale], { expectedHead: 1 }), (error) => {
    assert.ok(error instanceof StaleSequenceError);
    assert.equal(error.expected, 1);
    assert.equal(error.head, 2);
    return true;
  });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count, 2);

  const authored = makeEvent(streamId, 0, "user", "test", "authored-attempt", "BlockCreated", {
    document_id: "document-approved", block_id: "block-private", properties: { text: "Private authored decision" },
  });
  await appendEventsWithClientReceipts(env, [authored], ["client-authored-once"]);
  await appendEventsWithClientReceipts(env, [authored], ["client-authored-once"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE event_id=?").get(authored.eventId).count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM event_client_receipts WHERE client_event_id=?").get("client-authored-once").count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM event_write_stage").get().count, 0);
});

test("public operational projection preserves accounting, collaboration, and phantom-attention contracts", () => {
  const split = publicEventPayload("private-event", {
    reservation_id: "reservation-1", cost_reservation_id: "cost-1", reserved_tokens: 400, operation: "document-render:short_story", period: "2026-08",
    capture_version: "attention-v1", terminal_type: "idle_timeout", terminal_ref: "", active_ms: 30_000, idle_ms: 30_000,
    surface: "studio", context: "studio-overview", visible_refs: [], friction_score: 0, outcome_weight: 0,
    actor_user_id:"owner-1",customer_id:"CUSTOMERSECRET4819",patient_ids:"PATIENTSECRET4820",
    source_block_versions: [{ block_id: "block-1", version: 2, text: "SECRET SOURCE" }], properties: { text: "PRIVATE PROMPT" },
  });
  assert.equal(split.payload.reservation_id, "reservation-1");
  assert.equal(split.payload.operation, "document-render:short_story");
  assert.equal(split.payload.terminal_ref, undefined, "unsafe unbounded string projections are never retained");
  assert.deepEqual(split.payload.visible_refs, []);
  assert.equal(split.payload.actor_user_id,"owner-1");
  assert.equal(split.payload.customer_id,undefined);
  assert.equal(split.payload.patient_ids,undefined);
  assert.deepEqual(split.payload.source_block_versions, [{ block_id: "block-1", version: 2 }]);
  assert.doesNotMatch(JSON.stringify(split.payload), /PRIVATE PROMPT|SECRET SOURCE|CUSTOMERSECRET4819|PATIENTSECRET4820/);
  assert.match(split.privateJson, /PRIVATE PROMPT|SECRET SOURCE|CUSTOMERSECRET4819|PATIENTSECRET4820/);
});

test("historical privacy migration closes unknown public identifier leaks without rewriting existing private evidence",async()=>{
  const {sqlite,env}=governedEventDatabase();
  await ensureSchema(env);
  const original={project_id:"project-safe",document_id:"document-safe",block_id:"block-safe",customer_id:"CUSTOMERSECRET4819",patient_ids:"PATIENTSECRET4820"};
  const event=makeEvent("creative:owner",1,"user","legacy-client","legacy-correlation","BlockPropertyEdited",original);
  const leaked={...original,_private_ref:event.eventId},privateJson=JSON.stringify(original);
  const insert=sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  insert.run(event.eventId,event.streamId,event.sequence,event.occurredAt,event.recordedAt,event.actor,event.clientId,event.correlationId,event.causationId,event.compensatesEventId,event.schemaVersion,event.type,JSON.stringify(leaked));
  sqlite.prepare("INSERT INTO event_private_payloads(private_event_id,owner_id,project_id,document_id,private_json,created_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(event.eventId,"owner","project-safe","document-safe",privateJson,event.occurredAt);
  const row=sqlite.prepare("SELECT rowid,event_id FROM events WHERE event_id=?").get(event.eventId),before=await readEventPage(env,event.streamId);
  assert.deepEqual(await migrateLegacyEventPayloads(env),{migratedEvents:1,eventCount:1});
  assert.deepEqual(sqlite.prepare("SELECT rowid,event_id FROM events WHERE event_id=?").get(event.eventId),row);
  assert.doesNotMatch(sqlite.prepare("SELECT payload FROM events WHERE event_id=?").get(event.eventId).payload,/CUSTOMERSECRET4819|PATIENTSECRET4820|customer_id|patient_ids/);
  assert.equal(sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(event.eventId).private_json,privateJson);
  assert.deepEqual(await readEventPage(env,event.streamId),before);
  assert.deepEqual(await migrateLegacyEventPayloads(env),{migratedEvents:0,eventCount:1});

  const erased=makeEvent(event.streamId,2,"user","legacy-client","legacy-correlation","BlockPropertyEdited",{project_id:"project-safe",customer_id:"ALREADY_ERASED_4821"});
  insert.run(erased.eventId,erased.streamId,erased.sequence,erased.occurredAt,erased.recordedAt,erased.actor,erased.clientId,erased.correlationId,erased.causationId,erased.compensatesEventId,erased.schemaVersion,erased.type,JSON.stringify({...erased.payload,_private_ref:erased.eventId}));
  sqlite.prepare("INSERT INTO event_private_payloads(private_event_id,owner_id,project_id,document_id,private_json,created_at,redacted_at) VALUES(?,?,?,?,?,?,?)")
    .run(erased.eventId,"owner","project-safe",null,"",erased.occurredAt,new Date().toISOString());
  assert.deepEqual(await migrateLegacyEventPayloads(env),{migratedEvents:1,eventCount:2});
  const redacted=sqlite.prepare("SELECT private_json,redacted_at FROM event_private_payloads WHERE private_event_id=?").get(erased.eventId);
  assert.equal(redacted.private_json,"");assert.ok(redacted.redacted_at);
  assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT payload FROM events").all()),/ALREADY_ERASED_4821/);
});

test("historical privacy migration preserves SQLite rowids, event identities, client receipts, project cursors, and exact folds", async () => {
  const { sqlite, env } = governedEventDatabase();
  await ensureSchema(env);
  const legacy = makeEvent("creative:owner", 1, "user", "legacy-client", "legacy-correlation", "BlockCreated", {
    project_id: "project-legacy", document_id: "document-legacy", block_id: "legacy-block", type: "direction", handle: "direction/legacy", properties: { text: "HISTORIC CUSTOMER SECRET" },
  });
  sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(legacy.eventId,legacy.streamId,legacy.sequence,legacy.occurredAt,legacy.recordedAt,legacy.actor,legacy.clientId,legacy.correlationId,legacy.causationId,legacy.compensatesEventId,legacy.schemaVersion,legacy.type,JSON.stringify(legacy.payload));
  sqlite.prepare("INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at) VALUES(?,?,?,?,?)").run(legacy.streamId,"legacy-receipt",legacy.eventId,1,legacy.occurredAt);
  sqlite.prepare("INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(legacy.eventId,"access-1","organization-1","project-legacy","owner",legacy.streamId,1,1,"owner",legacy.occurredAt);
  const newer = makeEvent("creative:owner", 0, "user", "new-client", "new-correlation", "BlockPropertyEdited", { project_id: "project-legacy", document_id: "document-legacy", block_id: "legacy-block", property_path: "text", old_value: "HISTORIC CUSTOMER SECRET", new_value: "CURRENT CUSTOMER SECRET" });
  await appendEvents(env, [newer]);
  const previous = await readEventPage(env, legacy.streamId);
  const rowIds = sqlite.prepare("SELECT rowid,event_id FROM events ORDER BY rowid").all();

  const migrated = await migrateLegacyEventPayloads(env);
  assert.equal(migrated.eventCount, 2);
  assert.equal(migrated.migratedEvents, 1);
  assert.deepEqual(sqlite.prepare("SELECT rowid,event_id FROM events ORDER BY rowid").all(), rowIds);
  assert.equal(sqlite.prepare("SELECT event_id FROM event_client_receipts WHERE client_event_id='legacy-receipt'").get().event_id, legacy.eventId);
  assert.equal(sqlite.prepare("SELECT event_id FROM project_event_scopes WHERE project_sequence=1").get().event_id, legacy.eventId);
  assert.deepEqual(await readEventPage(env, legacy.streamId), previous);
  assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT payload FROM events").all()), /HISTORIC CUSTOMER SECRET|CURRENT CUSTOMER SECRET/);
  await appendEvents(env, [makeEvent(legacy.streamId, 0, "user", "after", "after", "BlockPropertyEdited", { block_id: "legacy-block", new_value: "LATER PRIVATE SECRET" })]);
  assert.equal((await readEventPage(env, legacy.streamId)).length, 3, "the protected trigger remains operational after the table swap");
  assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT payload FROM events").all()), /PRIVATE SECRET/);
  assert.deepEqual(await migrateLegacyEventPayloads(env),{migratedEvents:0,eventCount:3},"a completed historical migration remains idempotent as new events arrive");
});

test("historical privacy migration covers overlooked and unknown authored event families without relying on an event-name allowlist", async () => {
  const { sqlite, env } = governedEventDatabase();
  await ensureSchema(env);
  const families = [
    ["PreferenceAuthored", { value: "PRIVATE PREFERENCE 5901" }],
    ["CollectionCreated", { name: "PRIVATE COLLECTION 5902" }],
    ["CollectionRenamed", { new_name: "PRIVATE COLLECTION NAME 5903" }],
    ["DocumentForked", { title: "PRIVATE DOCUMENT TITLE 5904" }],
    ["ChipEdited", { new_value: "PRIVATE CHIP VALUE 5905" }],
    ["ObservationJudged", { note: "PRIVATE JUDGMENT 5906" }],
    ["FutureUncataloguedEvent", { customer_note: "PRIVATE FUTURE FIELD 5907" }],
  ];
  const insert = sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const [index, [type, fields]] of families.entries()) {
    const event = makeEvent("creative:owner", index + 1, "user", "legacy", "legacy", type, { project_id: "private-project", ...fields });
    insert.run(event.eventId,event.streamId,event.sequence,event.occurredAt,event.recordedAt,event.actor,event.clientId,event.correlationId,event.causationId,event.compensatesEventId,event.schemaVersion,event.type,JSON.stringify(event.payload));
  }
  const original = await readEventPage(env,"creative:owner");
  assert.deepEqual(await migrateLegacyEventPayloads(env), { migratedEvents: families.length, eventCount: families.length });
  assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT payload FROM events").all()), /PRIVATE (?:PREFERENCE|COLLECTION|DOCUMENT|CHIP|JUDGMENT|FUTURE)/);
  assert.deepEqual(await readEventPage(env,"creative:owner"), original, "migration preserves the exact readable history until explicit owner-scoped erasure");
  assert.equal(sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE owner_id=?").run(new Date().toISOString(),"owner").changes, families.length);
  assert.doesNotMatch(JSON.stringify(await readEventPage(env,"creative:owner")), /PRIVATE (?:PREFERENCE|COLLECTION|DOCUMENT|CHIP|JUDGMENT|FUTURE)/);
});

test("bounded global retention cleanup physically erases expired evidence for inactive accounts without touching durable work", async () => {
  const {sqlite,env}=governedEventDatabase();
  await ensureSchema(env);
  const now=new Date().toISOString(),expired=new Date(Date.now()-60_000).toISOString(),future=new Date(Date.now()+60_000).toISOString();
  const insert=sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)");
  insert.run("inactive-prompt","inactive-owner","prompt","EXPIRED INACTIVE PRIVATE PROMPT",now,expired);
  insert.run("inactive-evidence","another-inactive-owner","document-artifact-input","EXPIRED INACTIVE SOURCE EVIDENCE",now,expired);
  insert.run("durable-expired","inactive-owner","document-artifact","PRESERVE FINISHED DELIVERABLE",now,expired);
  insert.run("active-evidence","inactive-owner","document-artifact-input","CURRENT SOURCE EVIDENCE",now,future);
  assert.equal(await sweepExpiredPrivateContent(env,1),1,"one run respects the bounded work limit");
  assert.equal(await sweepExpiredPrivateContent(env,100),1,"later traffic cleans evidence owned by another inactive account");
  assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT content FROM private_content").all()),/EXPIRED INACTIVE/);
  assert.equal(sqlite.prepare("SELECT content FROM private_content WHERE content_id='durable-expired'").get().content,"PRESERVE FINISHED DELIVERABLE");
  assert.equal(sqlite.prepare("SELECT content FROM private_content WHERE content_id='active-evidence'").get().content,"CURRENT SOURCE EVIDENCE");
  assert.equal(await sweepExpiredPrivateContent(env),0);
});

test("project events automatically notify only active teammates without copying authored customer content", async () => {
  const { sqlite, env } = governedEventDatabase();
  await ensureSchema(env);
  const now = new Date().toISOString();
  sqlite.prepare("INSERT INTO organizations(organization_id,name,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)").run("org-1","Organization","owner","active",now,now);
  const member=sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)");
  member.run("membership-owner","org-1","owner","owner","active","owner",now,now,now);
  member.run("membership-editor","org-1","teammate","member","active","owner",now,now,now);
  sqlite.prepare("INSERT INTO organization_projects(project_access_id,project_id,organization_id,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run("access-1","project-1","org-1","owner","active",now,now);
  sqlite.prepare("INSERT INTO project_memberships(membership_id,project_access_id,project_id,organization_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run("project-editor","access-1","project-1","org-1","teammate","editor","active","owner",now,now);
  const change=makeEvent("creative:owner",0,"user:owner","web","followup","BlockCreated",{project_id:"project-1",document_id:"document-1",block_id:"block-1",type:"direction",properties:{text:"NEVER COPY THIS CONFIDENTIAL BRIEF"}});
  await appendEvents(env,[change]);
  const insert=sqlite.prepare("INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
  insert.run(change.eventId,"access-1","org-1","project-1","owner","creative:owner",1,1,"owner",now);
  const notifications=sqlite.prepare("SELECT recipient_user_id,kind,message,expires_at FROM project_notifications").all();
  assert.equal(notifications.length,1);
  assert.equal(notifications[0].recipient_user_id,"teammate");
  assert.equal(notifications[0].kind,"context_changed");
  assert.ok(Date.parse(notifications[0].expires_at)>Date.now());
  assert.doesNotMatch(JSON.stringify(notifications),/CONFIDENTIAL BRIEF/);

  sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE user_id='teammate'").run(now);
  const another=makeEvent("creative:owner",0,"user:owner","web","followup","ArtifactReviewRequested",{project_id:"project-1",document_id:"document-1",artifact_id:"artifact-1"});
  await appendEvents(env,[another]);
  insert.run(another.eventId,"access-1","org-1","project-1","owner","creative:owner",2,2,"owner",now);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM project_notifications").get().count,1,"revoked teammates never receive later project signals");
});

test("owner namespaces remain injective while proven historical object keys stay readable", () => {
  const first = "team:a";
  const second = "team/a";
  assert.equal(legacyOwnerMediaNamespace(first), legacyOwnerMediaNamespace(second), "historical prefixes were lossy");
  assert.notEqual(ownerMediaNamespace(first), ownerMediaNamespace(second), "new owner namespaces cannot collide");
  assert.equal(mediaKeyMatchesOwnerNamespace(`${ownerMediaNamespace(first)}/example.pdf`, first), true);
  assert.equal(mediaKeyMatchesOwnerNamespace(`${ownerMediaNamespace(second)}/example.pdf`, first), false);
  assert.equal(mediaKeyMatchesOwnerNamespace(`${legacyOwnerMediaNamespace(first)}/historical.png`, first), true);
});

test("generation context rebuilds real instructions and omitted exclusion boundaries from authorized history", () => {
  const trusted = authoritativeCreativeContext(contextHistory(), {
    documentId: "document-approved",
    projectId: "project-approved",
    snapshot: { facts: [{ block_id: "direction-approved", properties: { text: "FORGED CLIENT INSTRUCTIONS", authority: "admin" } }] },
  });

  assert.equal(trusted.projection.documentId, "document-approved");
  assert.equal(trusted.snapshot.facts.find((fact) => fact.block_id === "direction-approved").properties.text, "The real approved objective");
  assert.equal(trusted.snapshot.facts.find((fact) => fact.block_id === "boundary-approved").properties.text, "Never reveal customer account numbers");
  assert.doesNotMatch(JSON.stringify(trusted.snapshot), /FORGED CLIENT|FOREIGN TENANT/);
  assert.deepEqual(trusted.sourceBlockVersions, [{ block_id: "direction-approved", version: 1 }, { block_id: "boundary-approved", version: 1 }]);
  assert.ok(trusted.documentRevision);
});

test("generation rejects cross-project block claims and spoofed source revisions before processing", () => {
  assert.throws(() => authoritativeCreativeContext(contextHistory(), {
    documentId: "document-approved",
    projectId: "project-approved",
    snapshot: { facts: [{ block_id: "direction-foreign" }] },
  }), (error) => error instanceof ContextIntegrityError && error.code === "context_block_not_authorized");

  assert.throws(() => authoritativeCreativeContext(contextHistory(), {
    documentId: "document-approved",
    projectId: "project-approved",
    sourceBlockVersions: [{ block_id: "direction-approved", version: 999 }],
  }), (error) => error instanceof ContextIntegrityError && error.code === "context_source_version_mismatch");

  assert.throws(() => authoritativeCreativeContext(contextHistory(), {
    documentId: "document-approved",
    projectId: "project-approved",
    snapshot: { facts: [{ block_id: "direction-approved", properties: { media_url: "/api/media/another-projects-private-file" } }] },
  }), (error) => error instanceof ContextIntegrityError && error.code === "context_source_not_authorized", "an authorized block identifier cannot smuggle a foreign source or protected pixels into paid generation");

  assert.throws(() => authoritativeCreativeContext(contextHistory(), {
    documentId: "document-foreign",
    projectId: "project-approved",
  }), (error) => error instanceof ContextIntegrityError && error.code === "document_not_found");
});

test("formalized Canvas selections cannot omit prohibitions or select another project's context", () => {
  const history = [
    ...contextHistory(),
    event(8, "CanvasCreated", { project_id: "project-approved", canvas_id: "approved-board", name: "Board" }),
    event(9, "CanvasItemPlaced", { canvas_id: "approved-board", item_id: "approved-item", source_kind: "block", source_id: "direction-approved", title: "Direction" }),
    event(10, "ContextSetFormalized", { canvas_id: "approved-board", context_set_id: "approved-selection", item_ids: ["approved-item"], name: "Approved selection", as_of_sequence: 9 }),
  ];
  const trusted = authoritativeCreativeContext(history, {
    documentId: "document-approved",
    projectId: "project-approved",
    canvasId: "approved-board",
    contextSetId: "approved-selection",
    snapshot: { facts: [{ block_id: "direction-approved", properties: { text: "FORGED" } }] },
  });

  assert.deepEqual(trusted.snapshot.facts.map((fact) => fact.block_id).sort(), ["boundary-approved", "direction-approved"]);
  assert.equal(trusted.snapshot.canvas.canvas_id, "approved-board");
  assert.equal(trusted.snapshot.canvas.context_set_id, "approved-selection");
  assert.throws(() => authoritativeCreativeContext(history, {
    documentId: "document-approved",
    projectId: "project-approved",
    canvasId: "approved-board",
    contextSetId: "another-project-selection",
  }), (error) => error instanceof ContextIntegrityError && error.code === "canvas_context_not_authorized");
});

test("context health explains missing decisions, unlicensed evidence, expired rights, and contradictory boundaries", () => {
  const history = [
    ...contextHistory(),
    event(8, "BlockCreated", { project_id: "project-approved", document_id: "document-approved", block_id: "reference-unlicensed", type: "reference", handle: "reference/unlicensed", properties: { label: "Vendor brief.pdf", reference_id: "reference-no-rights", source_mime_type: "application/pdf", license_expires_at: "2026-01-01T00:00:00.000Z", weight: .8 } }),
    event(9, "BlockCreated", { project_id: "project-approved", document_id: "document-approved", block_id: "contradiction", type: "subject", handle: "subject/contradiction", properties: { text: "Include customer account numbers", weight: .8 } }),
  ];
  const projection = foldEvents(history, Number.POSITIVE_INFINITY, "document-approved", "project-approved");
  const health = assessCreativeContext(projection, history, Date.parse("2026-08-23T00:00:00.000Z"));
  assert.equal(health.state, "incomplete");
  assert.ok(health.issues.some((issue) => issue.id === "missing-audience"));
  assert.ok(health.issues.some((issue) => issue.id === "source-rights-reference-unlicensed"));
  assert.ok(health.issues.some((issue) => issue.id === "source-expired-reference-unlicensed"));
  assert.ok(health.issues.some((issue) => issue.id === "source-excerpt-reference-unlicensed"));
  assert.ok(health.issues.some((issue) => issue.id.startsWith("contradiction-")));
  assert.ok(health.score < 60);
});

test("organization-grounded reference decisions stop generation when their explicit rights expiration has passed",()=>{
  const history=[...contextHistory(),
    event(8,"RightsAsserted",{reference_id:"licensed-reference",rights_class:"owned_or_licensed"}),
    event(9,"BlockCreated",{project_id:"project-approved",document_id:"document-approved",block_id:"reference-rights-expired",type:"reference",handle:"reference/expired-rights",properties:{label:"Licensed policy source",reference_id:"licensed-reference",rights_expires_at:"2026-08-01T00:00:00.000Z",text:"Approved source evidence",weight:.8}}),
  ];
  const projection=foldEvents(history,Number.POSITIVE_INFINITY,"document-approved","project-approved");
  const health=assessCreativeContext(projection,history,Date.parse("2026-08-23T00:00:00.000Z"));
  assert.ok(health.issues.some((issue)=>issue.id==="source-expired-reference-rights-expired"&&issue.severity==="blocking"));
});

test("an output review is auditable and immediately loses approval when an exact source decision changes", () => {
  const request = event(8, "DocumentRenderRequested", { artifact_id: "artifact-approved", document_id: "document-approved", source_block_versions: [{ block_id: "direction-approved", version: 1 }, { block_id: "boundary-approved", version: 1 }] });
  const completed = event(9, "DocumentRenderCompleted", { artifact_id: "artifact-approved", artifact_kind: "short_story", document_id: "document-approved", title: "Result" }, "worker:renderer");
  const review = event(10, "ArtifactReviewRequested", { artifact_id: "artifact-approved", document_id: "document-approved" }, "user:review-requester");
  const approved = event(11, "ArtifactApproved", { artifact_id: "artifact-approved", document_id: "document-approved" }, "user:approver");
  const base = [...contextHistory(), request, completed];
  const artifact = { id: "artifact-approved", documentId: "document-approved", sequence: 9 };
  const blocks = foldEvents(base, Number.POSITIVE_INFINITY, "document-approved", "project-approved").blocks;
  assert.equal(artifactReviewState(artifact, blocks, base).status, "draft");
  assert.equal(artifactReviewState(artifact, blocks, [...base, review]).status, "in-review");
  assert.deepEqual(artifactReviewState(artifact, blocks, [...base, review, approved]), { status: "approved", label: "Approved", changedBlockIds: [], reviewedAt: approved.occurredAt, reviewer: "user:approver" });
  const corrected=event(12,"DocumentArtifactEdited",{artifact_id:"artifact-approved",document_id:"document-approved",revision:1},"user:editor");
  assert.equal(artifactReviewState(artifact,blocks,[...base,review,approved,corrected]).status,"draft","a finished-output correction immediately invalidates the preceding approval");

  const changed = event(12, "BlockPropertyEdited", { block_id: "direction-approved", property_path: "text", old_value: "The real approved objective", new_value: "A materially different approved objective" });
  const updated = [...base, review, approved, changed];
  const updatedBlocks = foldEvents(updated, Number.POSITIVE_INFINITY, "document-approved", "project-approved").blocks;
  assert.deepEqual(artifactReviewState(artifact, updatedBlocks, updated), { status: "stale", label: "Approval expired · context changed", changedBlockIds: ["direction-approved"], reviewedAt: approved.occurredAt, reviewer: "user:approver" });

  const added=event(12,"BlockCreated",{project_id:"project-approved",document_id:"document-approved",block_id:"new-confidentiality-boundary",type:"exclusion",handle:"exclusion/new",position:"a3",properties:{text:"Never publish unreleased financial data",intent:"prohibit",weight:1}});
  const expanded=[...base,review,approved,added];
  const expandedBlocks=foldEvents(expanded,Number.POSITIVE_INFINITY,"document-approved","project-approved").blocks;
  assert.equal(artifactReviewState(artifact,expandedBlocks,expanded).status,"stale","a newly authored mandatory exclusion invalidates prior approval");
  assert.deepEqual(artifactReviewState(artifact,expandedBlocks,expanded).changedBlockIds,["new-confidentiality-boundary"]);

  const visibleCompleted=event(9,"DocumentRenderCompleted",{artifact_id:"artifact-approved",artifact_kind:"short_story",document_id:"document-approved",project_id:"project-approved",source_block_versions:[{block_id:"direction-approved",version:1},{block_id:"boundary-approved",version:1}]},"worker:renderer");
  const collaboratorHistory=[...contextHistory(),visibleCompleted,review,approved,added];
  const collaboratorBlocks=foldEvents(collaboratorHistory,Number.POSITIVE_INFINITY,"document-approved","project-approved").blocks;
  assert.equal(artifactReviewState(artifact,collaboratorBlocks,collaboratorHistory).status,"stale","project collaborators can inspect safe source versions even without private render-request events");
});

test("server-owned review state rejects unauthorized, self-approved, stale, forged, and cross-document approvals",()=>{
  const source=[...contextHistory(),
    event(8,"DocumentRenderRequested",{artifact_id:"artifact-approved",document_id:"document-approved",project_id:"project-approved",source_block_versions:[{block_id:"direction-approved",version:1},{block_id:"boundary-approved",version:1}]},"user:creator"),
    event(9,"DocumentRenderCompleted",{artifact_id:"artifact-approved",artifact_kind:"short_story",document_id:"document-approved",project_id:"project-approved",requested_by_user_id:"creator",source_block_versions:[{block_id:"direction-approved",version:1},{block_id:"boundary-approved",version:1}]},"worker:renderer"),
    event(10,"ArtifactReviewRequested",{artifact_id:"artifact-approved",document_id:"document-approved",project_id:"project-approved"},"user:creator"),
  ];
  const payload={artifact_id:"artifact-approved",document_id:"document-approved",source_block_versions:[{block_id:"direction-approved",version:1},{block_id:"boundary-approved",version:1}]};
  const input={type:"ArtifactApproved",payload,events:source,actorUserId:"reviewer",projectId:"project-approved",canApprove:true,independentReviewer:true};
  assert.equal(validateArtifactReview(input).ok,true);
  const exact={...input,payload:{...payload,artifact_revision:0,content_sha256:"approved-body"},expectedArtifactRevision:0,expectedContentSha256:"approved-body"};
  assert.equal(validateArtifactReview(exact).ok,true,"an independent review can bind the exact approved output bytes");
  assert.equal(validateArtifactReview({...exact,payload:{...exact.payload,artifact_revision:1}}).code,"stale_review_context");
  assert.equal(validateArtifactReview({...exact,payload:{...exact.payload,content_sha256:"different-body"}}).code,"stale_review_context");
  assert.equal(validateArtifactReview({...exact,payload}).code,"stale_review_context","a governed review must not omit exact output custody");
  assert.equal(validateArtifactReview({...input,canApprove:false}).code,"artifact_reviewer_required");
  assert.equal(validateArtifactReview({...input,actorUserId:"creator"}).code,"artifact_independent_reviewer_required");
  assert.equal(validateArtifactReview({...input,events:source.slice(0,-1)}).code,"artifact_review_request_required");
  assert.equal(validateArtifactReview({...input,payload:{...payload,document_id:"document-foreign"}}).code,"artifact_document_mismatch");
  assert.equal(validateArtifactReview({...input,payload:{...payload,source_block_versions:[{block_id:"direction-approved",version:900}]}}).code,"artifact_review_versions_mismatch");
  const changed=event(11,"BlockPropertyEdited",{block_id:"direction-approved",property_path:"text",new_value:"Changed instruction"});
  assert.equal(validateArtifactReview({...input,events:[...source,changed]}).code,"artifact_source_stale");
  const edited=event(11,"DocumentArtifactEdited",{artifact_id:"artifact-approved",document_id:"document-approved",revision:1},"user:editor");
  assert.equal(validateArtifactReview({...input,events:[...source,edited]}).code,"artifact_review_request_required","an old review request cannot authorize a newly edited deliverable");
  const requestedAgain=event(12,"ArtifactReviewRequested",{artifact_id:"artifact-approved",document_id:"document-approved",project_id:"project-approved"},"user:requester");
  assert.equal(validateArtifactReview({...input,events:[...source,edited,requestedAgain],actorUserId:"editor"}).code,"artifact_independent_reviewer_required","the contributor who changed the deliverable cannot approve it");
  assert.equal(validateArtifactReview({...input,events:[...source,edited,requestedAgain]}).ok,true,"an independent designated reviewer can approve a freshly submitted correction");
});

test("paid context rejects missing or expired rights and contradictory mandatory decisions before spending",()=>{
  const unlicensed=[...contextHistory(),event(8,"BlockCreated",{project_id:"project-approved",document_id:"document-approved",block_id:"source",type:"reference",handle:"reference/source",properties:{reference_id:"unlicensed",label:"Restricted source",weight:1}})];
  assert.throws(()=>authoritativeCreativeContext(unlicensed,{documentId:"document-approved",projectId:"project-approved"}),(error)=>error instanceof ContextIntegrityError&&error.code==="context_source_rights_required");

  const expired=[...contextHistory(),event(8,"RightsAsserted",{reference_id:"licensed",rights_class:"owned_or_licensed"}),event(9,"BlockCreated",{project_id:"project-approved",document_id:"document-approved",block_id:"source",type:"reference",handle:"reference/source",properties:{reference_id:"licensed",label:"Expired source",license_expires_at:"2026-01-01T00:00:00.000Z",weight:1}})];
  assert.throws(()=>authoritativeCreativeContext(expired,{documentId:"document-approved",projectId:"project-approved"}),(error)=>error instanceof ContextIntegrityError&&error.code==="context_source_rights_expired");

  const audioSource={project_id:"project-approved",document_id:"document-approved",block_id:"audio-source",type:"audio",handle:"audio/source",properties:{reference_id:"audio-licensed",label:"Private soundtrack",media_url:"/api/media/private.mp3",inform_generation:true,weight:1}};
  const classlessAudio=[...contextHistory(),event(8,"RightsAsserted",{reference_id:"audio-licensed"}),event(9,"BlockCreated",audioSource)];
  assert.throws(()=>authoritativeCreativeContext(classlessAudio,{documentId:"document-approved",projectId:"project-approved"}),(error)=>error instanceof ContextIntegrityError&&error.code==="context_source_rights_required","audio must never inherit a legacy classless reference-rights receipt");
  const licensedAudio=[...contextHistory(),event(8,"RightsAsserted",{reference_id:"audio-licensed",rights_class:"licensed"}),event(9,"BlockCreated",audioSource)];
  assert.doesNotThrow(()=>authoritativeCreativeContext(licensedAudio,{documentId:"document-approved",projectId:"project-approved"}));

  const contradiction=[...contextHistory(),event(8,"BlockCreated",{project_id:"project-approved",document_id:"document-approved",block_id:"contradiction",type:"subject",handle:"subject/contradiction",properties:{text:"Include customer account numbers",weight:1}})];
  assert.throws(()=>authoritativeCreativeContext(contradiction,{documentId:"document-approved",projectId:"project-approved"}),(error)=>error instanceof ContextIntegrityError&&error.code==="context_decisions_contradict");
});

test("operational analytics preserves metrics without storing authored prose, source media, or provider failures", () => {
  const secret = "STRICTLY CONFIDENTIAL CUSTOMER MATERIAL";
  const created = projectAnalyticsPayload("BlockCreated", { project_id: "project", document_id: "document", block_id: "block", type: "direction", handle: secret, properties: { text: secret, nested: { secret }, media_url: "https://private.example.test/source", authority: "authored", weight: .8, active: true } });
  const artifact = projectAnalyticsPayload("DocumentRenderCompleted", { artifact_id: "artifact", artifact_kind: "slides", title: secret, items: [{ body: secret }], media_url: "https://private.example.test/output", latency_ms: 1234 });
  const failure = projectAnalyticsPayload("GenerationFailed", { generation_id: "generation", error_message: `quota exhausted: ${secret}`, request_payload: secret });
  const attention = projectAnalyticsPayload("AttentionEpisodeObserved", { episode_id: "episode", active_ms: 90_000, expires_at: "2099-01-01T00:00:00.000Z", context: "document-editor", visible_refs: [secret] });

  assert.doesNotMatch(JSON.stringify([created, artifact, failure, attention]), /STRICTLY CONFIDENTIAL|private\.example/);
  assert.equal(created.properties.weight, .8);
  assert.equal(created.properties.active, true);
  assert.equal(artifact.latency_ms, 1234);
  assert.equal(failure.error_category, "quota");
  assert.equal(attention.expires_at, "2099-01-01T00:00:00.000Z");
});
