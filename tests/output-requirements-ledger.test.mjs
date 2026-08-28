import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerOutputSourceImports, outputTestDatabase } from "./output-server-test-helpers.mjs";

const hooks = registerOutputSourceImports();
const { ensureSchema, makeEvent, appendEvents, streamHead } = await import("../worker/runtime.ts");
const { ensureOutputRequirementsSchema, commitOutputCommand, readOutputCommand, claimOutputProviderCall, settleOutputProviderCall, outputScopeAuthority, outputSourceEpochAssertion, outputAssertionStatements } = await import("../worker/output-requirements-ledger.ts");
hooks.deregister();

const scope = { kind: "personal", key: "personal:owner:project", ownerUserId: "owner", actorUserId: "owner", projectId: "project", documentId: "document", organizationId: null, projectAccessId: null, contextId: null };
async function fixture() {
  const value = outputTestDatabase();
  await ensureSchema(value.env);
  await ensureOutputRequirementsSchema(value.env);
  const now = new Date().toISOString();
  value.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,created_at,updated_at) VALUES('owner','owner@example.test','Owner','creator','pilot-2026-08-10',?,?)").run(now, now);
  return value;
}
function command(env, { key = "command-1", digest = "digest-1", head = 0, assertions = [], sidecars } = {}) {
  return commitOutputCommand(env, { scope, permission: "author", expectedHead: head, expectedProjectHead: 0, key, digest, action: "confirm", events: [{ type: "OutputPlanConfirmed", payload: { document_id: "document", project_id: "project", confirmed_plan: { secret: "PRIVATE CREATIVE REQUIREMENT" } } }], assertions, buildSidecars: sidecars });
}

test("command, private event and receipt are one transaction; public metadata never copies requirement prose", async () => {
  const state = await fixture();
  const saved = await command(state.env);
  assert.equal(saved.replayed, false);
  assert.equal(await streamHead(state.env, "creative:owner"), 1);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands").get().count, 1);
  assert.equal(state.sqlite.prepare("SELECT payload FROM events").get().payload.includes("PRIVATE CREATIVE REQUIREMENT"), false);
  assert.equal(state.sqlite.prepare("SELECT private_json FROM event_private_payloads").get().private_json.includes("PRIVATE CREATIVE REQUIREMENT"), true);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
});

test("zero-row sidecar assertion rolls back preceding event, private body, command and successful sidecars", async () => {
  const state = await fixture();
  state.sqlite.exec("CREATE TABLE mutable_sidecar(id TEXT PRIMARY KEY, value INTEGER)");
  await assert.rejects(command(state.env, { sidecars: () => ({ statements: [state.env.DB.prepare("INSERT INTO mutable_sidecar VALUES('first',1)"), state.env.DB.prepare("UPDATE mutable_sidecar SET value=2 WHERE id='missing'")], assertions: [{ sql: "EXISTS(SELECT 1 FROM mutable_sidecar WHERE id='missing' AND value=2)" }] }) }), /output_revision_or_authority_changed/u);
  for (const table of ["events", "event_private_payloads", "output_commands", "mutable_sidecar", "output_atomic_assertions"]) assert.equal(state.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
});

test("stale heads and changed consent leave every command table untouched", async () => {
  const state = await fixture();
  await appendEvents(state.env, [makeEvent("creative:owner", 0, "user:owner", "test", "unrelated", "DocumentRenamed", { document_id: "document", project_id: "project", title: "Changed" })]);
  await assert.rejects(command(state.env), /output_revision_or_authority_changed/u);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands").get().count, 0);
  state.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id='owner'").run();
  await assert.rejects(command(state.env, { head: 1 }), /output_revision_or_authority_changed/u);
  assert.equal(await streamHead(state.env, "creative:owner"), 1);
});

test("identical lost-response replay returns original receipt after completion; same key with different content conflicts", async () => {
  const state = await fixture();
  const first = await command(state.env);
  const replay = await command(state.env, { head: 500 });
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.eventId, first.receipt.eventId);
  await assert.rejects(command(state.env, { digest: "different" }), /mutation_key_reused_with_different_content/u);
  assert.equal(await streamHead(state.env, "creative:owner"), 1);
  state.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-08-28' WHERE private_event_id=?").run(first.receipt.eventId);
  await assert.rejects(readOutputCommand(state.env, scope, "command-1", "digest-1"), /original_command_content_unavailable/u);
  assert.equal(await streamHead(state.env, "creative:owner"), 1, "redaction is a replay tombstone, not permission to execute again");
});

test("racing identical commands commit one operation and one event", async () => {
  const state = await fixture();
  const outcomes = await Promise.all([command(state.env), command(state.env)]);
  assert.equal(outcomes.filter((value) => !value.replayed).length, 1);
  assert.equal(outcomes[0].receipt.eventId, outcomes[1].receipt.eventId);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands").get().count, 1);
});

async function operationFixture() {
  const state = await fixture();
  const { env, sqlite } = state;
  const now = new Date().toISOString(), later = new Date(Date.now() + 60_000).toISOString();
  const saved = await command(env);
  const event = saved.receipt.eventId;
  sqlite.prepare("INSERT INTO output_plan_revisions(scope_key,scope_kind,owner_user_id,project_id,document_id,plan_revision_id,plan_id,revision,confirmed_event_id,requirements_digest,source_digest,resolver_version,source_head,target_count,created_at) VALUES(?,'personal','owner','project','document','plan','document',1,?,'req','source','v1',0,1,?)").run(scope.key, event, now);
  sqlite.prepare("INSERT INTO output_plan_targets VALUES(?,'plan','target','contract','slides',1,1,0)").run(scope.key);
  sqlite.prepare("INSERT INTO output_preflights VALUES(?,'preflight','plan','owner','terms',?,?,?)").run(scope.key, event, later, now);
  sqlite.prepare("INSERT INTO output_execution_grants(scope_key,grant_id,plan_revision_id,actor_user_id,payer_user_id,context_id,preflight_id,authorization_event_id,maximum_microusd,maximum_calls,status,expires_at,created_at) VALUES(?,'grant','plan','owner','owner',NULL,'preflight',?,100,2,'active',?,?)").run(scope.key, event, later, now);
  sqlite.prepare("INSERT INTO output_operation_slots(scope_key,slot_id,grant_id,plan_revision_id,target_id,target_contract_digest,source_digest,provider,model,route_digest,job_id,cost_reservation_id,token_reservation_id,maximum_microusd,maximum_calls,maximum_tokens,status,created_at,updated_at) VALUES(?,'slot','grant','plan','target','contract','source','openai','test-model','route','job','cost','tokens',100,2,1000,'queued',?,?)").run(scope.key, now, now);
  for (const stage of ["initial", "repair"]) sqlite.prepare("INSERT INTO output_operation_routes VALUES(?,'slot',?,'openai','test-model',1)").run(scope.key, stage);
  return state;
}
const call = (stage, extra = {}) => ({ scope, slotId: "slot", jobId: "job", callKey: stage, clientRequestId: `request-${stage}`, requestDigest: `digest-${stage}`, provider: "openai", model: "test-model", routeDigest: "route", stageKey: stage, maximumMicrousd: 60, expectedHead: 1, sourceDigest: "source", assertions: [{ sql: "1=1" }], ...extra });

test("provider claim reserves a durable logical slot before dispatch and blocks uncertain retry/cost overrun", async () => {
  const state = await operationFixture();
  let networkCalls = 0;
  const dispatch = async (input) => { const claimed = await claimOutputProviderCall(state.env, input); if (claimed.claimed) networkCalls++; return claimed; };
  assert.equal((await dispatch(call("initial"))).claimed, true);
  assert.equal((await dispatch(call("initial"))).claimed, false);
  await assert.rejects(dispatch(call("repair")), /output_provider_call_not_authorized/u);
  assert.equal(networkCalls, 1);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_provider_calls").get().count, 1);
  await settleOutputProviderCall(state.env, { scopeKey: scope.key, slotId: "slot", callKey: "initial", clientRequestId: "request-initial", usedMicrousd: null, status: "uncertain" });
  assert.equal((await dispatch(call("initial"))).claimed, false, "unknown external acceptance is consumed authority");
  assert.equal(networkCalls, 1);
});

test("an unresolved previous provider call blocks same-target repair even when substantial money remains", async () => {
  const state = await operationFixture();
  await claimOutputProviderCall(state.env, call("initial", { maximumMicrousd: 30 }));
  await assert.rejects(claimOutputProviderCall(state.env, call("repair", { maximumMicrousd: 30 })), /output_provider_call_not_authorized/u);
  await settleOutputProviderCall(state.env, { scopeKey: scope.key, slotId: "slot", callKey: "initial", clientRequestId: "request-initial", usedMicrousd: null, status: "uncertain" });
  await assert.rejects(claimOutputProviderCall(state.env, call("repair", { maximumMicrousd: 30 })), /output_provider_call_not_authorized/u);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_provider_calls").get().count, 1);
});

test("true settlement is idempotent; bounded repair consumes its own route, and late overage is recorded without clamping", async () => {
  const state = await operationFixture();
  await claimOutputProviderCall(state.env, call("initial"));
  const first = { scopeKey: scope.key, slotId: "slot", callKey: "initial", clientRequestId: "request-initial", usedMicrousd: 20, status: "settled" };
  assert.equal((await settleOutputProviderCall(state.env, first)).replayed, false);
  assert.equal((await settleOutputProviderCall(state.env, first)).replayed, true);
  await claimOutputProviderCall(state.env, call("repair"));
  await settleOutputProviderCall(state.env, { ...first, callKey: "repair", clientRequestId: "request-repair", usedMicrousd: 120 });
  assert.equal(state.sqlite.prepare("SELECT SUM(used_microusd) AS cost FROM output_provider_calls").get().cost, 140);
  assert.equal(state.sqlite.prepare("SELECT status FROM output_execution_grants").get().status, "exceeded");
  assert.equal((await claimOutputProviderCall(state.env, call("repair"))).claimed, false);
  await assert.rejects(settleOutputProviderCall(state.env, { ...first, usedMicrousd: 5 }), /provider_settlement_conflict/u);
});

test("identical concurrent settlements and a lost settlement acknowledgement replay the exact receipt", async () => {
  const state = await operationFixture();
  await claimOutputProviderCall(state.env, call("initial"));
  const input = { scopeKey: scope.key, slotId: "slot", callKey: "initial", clientRequestId: "request-initial", usedMicrousd: 20, status: "settled", providerResponseId: "provider-response-one" };
  const concurrent = await Promise.all([settleOutputProviderCall(state.env, input), settleOutputProviderCall(state.env, input)]);
  assert.deepEqual(concurrent.map((result) => result.replayed).sort(), [false, true]);
  assert.equal(state.sqlite.prepare("SELECT SUM(used_microusd) AS cost FROM output_provider_calls").get().cost, 20);
  await assert.rejects(settleOutputProviderCall(state.env, { ...input, usedMicrousd: 21 }), /provider_settlement_conflict/u);
  await assert.rejects(settleOutputProviderCall(state.env, { ...input, providerResponseId: "different-response" }), /provider_settlement_conflict/u);
  await assert.rejects(settleOutputProviderCall(state.env, { ...input, status: "uncertain", usedMicrousd: null }), /provider_settlement_conflict/u);
  await claimOutputProviderCall(state.env, call("repair"));
  const batch = state.env.DB.batch.bind(state.env.DB);
  state.env.DB.batch = async (statements) => { const result = await batch(statements); if (statements.some((statement) => /UPDATE output_provider_calls SET used_microusd/u.test(statement.sql))) throw new Error("settled but acknowledgement lost"); return result; };
  assert.deepEqual(await settleOutputProviderCall(state.env, { ...input, callKey: "repair", clientRequestId: "request-repair", providerResponseId: "provider-response-two" }), { replayed: true });
  assert.equal(state.sqlite.prepare("SELECT SUM(used_microusd) AS cost FROM output_provider_calls").get().cost, 40);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
});

test("fresh provider claims and settlements each use one guarded binding call, while replay still checks the canonical receipt", async () => {
  const state = await operationFixture(), original = state.env.DB;
  const counts = { batches: 0, reads: 0 };
  const wrap = (statement) => new Proxy(statement, { get(target, key) {
    if (key === "bind") return (...values) => wrap(target.bind(...values));
    if (["first", "all", "run"].includes(String(key))) return (...values) => { counts.reads++; return target[key](...values); };
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } });
  state.env.DB = { prepare(sql) { return wrap(original.prepare(sql)); }, async batch(statements) { counts.batches++; return original.batch(statements); } };
  assert.equal((await claimOutputProviderCall(state.env, call("initial"))).claimed, true);
  assert.deepEqual(counts, { batches: 1, reads: 0 });
  const input = { scopeKey: scope.key, slotId: "slot", callKey: "initial", clientRequestId: "request-initial", usedMicrousd: 20, status: "settled", providerResponseId: "stable-response" };
  assert.equal((await settleOutputProviderCall(state.env, input)).replayed, false);
  assert.deepEqual(counts, { batches: 2, reads: 0 });
  assert.equal((await claimOutputProviderCall(state.env, call("initial"))).claimed, false);
  assert.deepEqual(counts, { batches: 3, reads: 1 });
  assert.equal((await settleOutputProviderCall(state.env, input)).replayed, true);
  assert.deepEqual(counts, { batches: 4, reads: 2 });
  await assert.rejects(claimOutputProviderCall(state.env, call("initial", { requestDigest: "different-request" })), /provider_call_key_collision/u);
  await assert.rejects(settleOutputProviderCall(state.env, { ...input, callKey: "missing" }), /output_provider_call_missing/u);
  assert.equal(state.sqlite.prepare("SELECT SUM(used_microusd) AS cost FROM output_provider_calls").get().cost, 20);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
});

test("HTTP settlement caller revocation at commit cannot mutate or replay a receipt, while the provider observer remains source-free", async () => {
  const state = await operationFixture();
  await claimOutputProviderCall(state.env, call("initial"));
  const input = { scopeKey: scope.key, slotId: "slot", callKey: "initial", clientRequestId: "request-initial", usedMicrousd: 20, status: "settled", providerResponseId: "provider-response" };
  const assertions = [outputScopeAuthority(scope, "read"), { sql: "EXISTS(SELECT 1 FROM output_operation_slots slot JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id WHERE slot.scope_key=? AND slot.slot_id=? AND slot.job_id=? AND grant_row.actor_user_id=?)", bindings: [scope.key, "slot", "job", "owner"] }];
  const batch = state.env.DB.batch.bind(state.env.DB);
  let revoked = false;
  state.env.DB.batch = async (statements) => {
    if (!revoked && statements.some((statement) => /UPDATE output_provider_calls SET used_microusd/u.test(statement.sql))) {
      revoked = true;
      state.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id='owner'").run();
    }
    return batch(statements);
  };
  await assert.rejects(settleOutputProviderCall(state.env, { ...input, assertions }), (error) => error.code === "output_execution_authority_revoked" && error.status === 403);
  assert.equal(revoked, true);
  assert.deepEqual({ ...state.sqlite.prepare("SELECT status,used_microusd FROM output_provider_calls").get() }, { status: "pending", used_microusd: null });
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
  state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=?").run(new Date().toISOString());
  state.sqlite.prepare("UPDATE output_execution_grants SET status='revoked',expires_at='2000-01-01T00:00:00.000Z'").run();
  assert.deepEqual(await settleOutputProviderCall(state.env, input), { replayed: false }, "known provider accounting still settles after source, caller consent and execution authority disappear");
  await assert.rejects(settleOutputProviderCall(state.env, { ...input, assertions }), /output_execution_authority_revoked/u);
  assert.equal(state.sqlite.prepare("SELECT SUM(used_microusd) AS cost FROM output_provider_calls").get().cost, 20);
  state.sqlite.prepare("UPDATE users SET consent_version='pilot-2026-08-10' WHERE user_id='owner'").run();
  assert.deepEqual(await settleOutputProviderCall(state.env, { ...input, assertions }), { replayed: true }, "current caller can reconcile the exact terminal receipt without source or live generation permission");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
});

test("caller-guarded settlement handles concurrent and lost-acknowledgement exact replay without bypassing an actor assertion", async () => {
  const state = await operationFixture();
  await claimOutputProviderCall(state.env, call("initial"));
  const input = { scopeKey: scope.key, slotId: "slot", callKey: "initial", clientRequestId: "request-initial", usedMicrousd: 20, status: "settled", providerResponseId: "provider-response", assertions: [outputScopeAuthority(scope, "read")] };
  const concurrent = await Promise.all([settleOutputProviderCall(state.env, input), settleOutputProviderCall(state.env, input)]);
  assert.deepEqual(concurrent.map((result) => result.replayed).sort(), [false, true]);
  await assert.rejects(settleOutputProviderCall(state.env, { ...input, assertions: [{ sql: "?=?", bindings: ["owner", "different-actor"] }] }), /output_execution_authority_revoked/u);
  await assert.rejects(settleOutputProviderCall(state.env, { ...input, usedMicrousd: 21 }), /provider_settlement_conflict/u);
  await claimOutputProviderCall(state.env, call("repair"));
  const batch = state.env.DB.batch.bind(state.env.DB);
  let lost = false;
  state.env.DB.batch = async (statements) => {
    const value = await batch(statements);
    if (!lost && statements.some((statement) => /UPDATE output_provider_calls SET used_microusd/u.test(statement.sql))) { lost = true; throw new Error("settled but acknowledgement lost"); }
    return value;
  };
  assert.deepEqual(await settleOutputProviderCall(state.env, { ...input, callKey: "repair", clientRequestId: "request-repair", providerResponseId: "provider-response-two" }), { replayed: true });
  assert.equal(lost, true);
  assert.equal(state.sqlite.prepare("SELECT SUM(used_microusd) AS cost FROM output_provider_calls").get().cost, 40);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
});

test("a grant that expires while its D1 transaction is waiting cannot admit a provider call", async () => {
  const state = await operationFixture();
  state.sqlite.prepare("UPDATE output_execution_grants SET expires_at=?").run(new Date(Date.now() + 100).toISOString());
  const batch = state.env.DB.batch.bind(state.env.DB);
  state.env.DB.batch = async (statements) => { if (statements.some((statement) => /INSERT INTO output_provider_calls/u.test(statement.sql))) await new Promise((resolve) => setTimeout(resolve, 160)); return batch(statements); };
  await assert.rejects(claimOutputProviderCall(state.env, call("initial")), /output_provider_call_not_authorized/u);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_provider_calls").get().count, 0);
  assert.equal(state.sqlite.prepare("SELECT status FROM output_operation_slots").get().status, "queued");
});

test("semantic source proofs tolerate read history but reject title, pin, requirement, or unowned operation changes", async () => {
  for (const type of ["DocumentRenamed", "ObjectPinned", "BlockPropertyEdited", "OutputPlanConfirmed", "DocumentRenderCompleted", "DocumentRenderFailed"]) {
    const state = await operationFixture();
    const proof = outputSourceEpochAssertion(scope, { head: 1, sourceDigest: "source" });
    await appendEvents(state.env, [makeEvent("creative:owner", 0, "user:owner", "test", "read-history", "DocumentOpened", { project_id: "project", document_id: "document" })]);
    await state.env.DB.batch(outputAssertionStatements(state.env, proof));
    await appendEvents(state.env, [makeEvent("creative:owner", 0, "user:owner", "test", "unowned-job", type, { project_id: "project", document_id: "document", block_id: "source", property_path: "text", new_value: "changed", new_title: "changed", object_id: "pin" })]);
    await assert.rejects(state.env.DB.batch(outputAssertionStatements(state.env, proof)), /CHECK constraint failed/u, type);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
  }
});

test("only registry audit metadata from this exact admitted job may cross a retained source epoch", async () => {
  const state = await operationFixture();
  state.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,requested_at,expires_at,updated_at) VALUES('job','owner','creative:owner','document','generate','running','outputs','job:attempt:1',1,'{}','now','later','now')").run();
  const proof = outputSourceEpochAssertion(scope, { head: 1, sourceDigest: "source" });
  for (const type of ["ModelRegistered", "AdapterVersioned", "CapabilityDeclared"]) {
    await appendEvents(state.env, [makeEvent("creative:owner", 0, "worker:registry", "test", "job:attempt:1", type, { model_id: "owned-route" })]);
    await state.env.DB.batch(outputAssertionStatements(state.env, proof));
  }
  await appendEvents(state.env, [makeEvent("creative:owner", 0, "worker:document", "test", "job:attempt:1", "DocumentRenderFailed", { document_id: "document", error_code: "invalid_generated_slides" })]);
  await state.env.DB.batch(outputAssertionStatements(state.env, proof));
  await appendEvents(state.env, [makeEvent("creative:owner", 0, "user:owner", "test", "job:attempt:1", "ModelRegistered", { model_id: "not-registry" })]);
  await assert.rejects(state.env.DB.batch(outputAssertionStatements(state.env, proof)), /CHECK constraint failed/u);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
});

test("stage provider/model, source, authority and scope are rechecked before any network dispatch", async () => {
  const state = await operationFixture();
  for (const altered of [{ provider: "unapproved" }, { model: "unapproved" }, { routeDigest: "changed" }, { stageKey: "third" }, { sourceDigest: "changed" }, { jobId: "foreign" }, { scope: { ...scope, key: "foreign" } }]) {
    await assert.rejects(claimOutputProviderCall(state.env, call("initial", altered)), /output_provider_call_not_authorized/u);
  }
  state.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id='owner'").run();
  await assert.rejects(claimOutputProviderCall(state.env, call("initial")), /output_provider_call_not_authorized/u);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_provider_calls").get().count, 0);
});

test("database rejects duplicate initial work across independent grants and cross-scope target references", async () => {
  const state = await operationFixture();
  const source = state.sqlite.prepare("SELECT * FROM output_operation_slots").get();
  const columns = Object.keys(source);
  const duplicate = { ...source, slot_id: "second", job_id: "second-job", cost_reservation_id: "second-cost", token_reservation_id: "second-tokens" };
  assert.throws(() => state.sqlite.prepare(`INSERT INTO output_operation_slots(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map((key) => duplicate[key])), /UNIQUE constraint failed/u);
  assert.throws(() => state.sqlite.prepare("INSERT INTO output_plan_targets VALUES('foreign','plan','target','contract','image',1,1,0)").run(), /FOREIGN KEY constraint failed/u);
});

test("personal scope cannot fall back to an owner account after project custody is registered", async () => {
  const state = await fixture();
  state.sqlite.prepare("INSERT INTO organization_projects(project_access_id,organization_id,project_id,owner_user_id,status,created_at,updated_at) VALUES('access','org','project','owner','active','now','now')").run();
  const guard = outputScopeAuthority(scope, "author");
  assert.equal(await state.env.DB.prepare(`SELECT 1 WHERE (${guard.sql})`).bind(...guard.bindings).first(), null);
  await assert.rejects(command(state.env), /output_revision_or_authority_changed/u);
});

test("database constraints reject fractional counts and money instead of trusting INTEGER affinity", async () => {
  const state = await operationFixture();
  for (const sql of ["UPDATE output_plan_revisions SET revision=1.5", "UPDATE output_plan_revisions SET target_count=1.5", "UPDATE output_operation_slots SET maximum_calls=1.5", "UPDATE output_operation_slots SET maximum_microusd=1.5", "UPDATE output_execution_grants SET maximum_microusd=1.5", "UPDATE output_plan_targets SET ordinal=0.5"]) assert.throws(() => state.sqlite.prepare(sql).run(), /CHECK constraint failed/u, sql);
});

test("forward SQL migration creates the same scoped tables and foreign keys on a real SQLite database", async () => {
  const state = outputTestDatabase();
  const migration = await readFile(new URL("../drizzle/0018_output_requirements.sql", import.meta.url), "utf8");
  state.sqlite.exec("CREATE TABLE events(event_id TEXT PRIMARY KEY); CREATE TABLE document_jobs(job_id TEXT PRIMARY KEY)");
  state.sqlite.exec(migration);
  const tables = state.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'output_%'").all().map((row) => row.name);
  assert.ok(tables.includes("output_operation_routes"));
  assert.ok(tables.includes("output_plan_fulfillments"));
  assert.ok(tables.includes("output_native_storage_writes"));
  assert.ok(state.sqlite.prepare("PRAGMA table_info(output_execution_grants)").all().some((row) => row.name === "context_id"));
  assert.ok(state.sqlite.prepare("PRAGMA foreign_key_list(output_plan_fulfillments)").all().some((row) => row.table === "output_target_acceptances"));
  assert.ok(state.sqlite.prepare("PRAGMA foreign_key_list(output_native_storage_writes)").all().some((row) => row.from === "publication_event_id" && row.table === "events"));
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_execution_grants").get().count, 0, "a migration cannot create spending authority");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, 0);
});
