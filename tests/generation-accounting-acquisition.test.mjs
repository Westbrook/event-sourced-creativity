import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { accountingPreviewForInspection } from "../src/model/generation-accounting-inspection.ts";
import { previewGenerationAccounting } from "../worker/generation-accounting-preview.ts";
import { createGenerationAccountingHandler } from "../worker/generation-accounting-api.ts";

const originalFetch = globalThis.fetch;
let attemptedNetworkCalls = 0;
globalThis.fetch = async () => { attemptedNetworkCalls++; throw new Error("Network forbidden in acquisition fixture"); };
after(() => { globalThis.fetch = originalFetch; assert.equal(attemptedNetworkCalls, 0); });

const now = Date.now(); // Isolated synthetic setup; no retained live counters or account are fabricated.
const stamp = new Date(now - 1000).toISOString();
const actor = { userId: "owner", streamId: "creative:owner", role: "admin", access: { identityPolicyDeniedCustody: false }, authorizationSnapshot: { updatedAt: stamp, rawEpoch: "epoch-1" } };
const clone = value => JSON.parse(JSON.stringify(value));
const checkpoint = () => ({
  providerSubmissionProtocol: 1, reservationId: "token-1", costReservationId: "cost-1", costReservationPeriod: "2026-08", plannerResponseId: "resp-planner",
  generationReceipt: { actual_provider_call_count: 3 },
  providerSubmissions: {
    "client-plan": { clientRequestId: "client-plan", provider: "openai", operation: "planning", model: "gpt-5.6-terra", status: "completed", providerRequestId: "resp-planner", costMicrousd: 54660, inputTokens: 13230, outputTokens: 2350, totalTokens: 15580, responseRef: "PRIVATE_RESPONSE_REF", pricingReceipt: { secret: "PRIVATE_PRICING" } },
    "client-anchor": { clientRequestId: "client-anchor", provider: "fal", operation: "image", model: "ideogram/v4", unitId: "continuity-anchor", status: "completed", providerRequestId: "fal-anchor", costMicrousd: 43824, inputTokens: 0, outputTokens: 0, totalTokens: 0, prompt: "PRIVATE_ANCHOR_PROMPT" },
    "client-video": { clientRequestId: "client-video", provider: "fal", operation: "video", model: "bytedance/seedance-2.0/reference-to-video", unitId: "scene:scene-003", status: "accepted", providerRequestId: "fal-video", providerUrl: "https://private.invalid" },
  },
  productionAnchor: { sceneId: "scene-003", providerJobId: "fal-anchor", providerSubmissionId: "client-anchor", costMicrousd: 43824, mediaUrl: "/api/media/PRIVATE_MEDIA" },
  productionSceneReceipts: { "scene-003": { sceneId: "scene-003", providerJobId: "fal-video", providerSubmissionId: "client-video", status: "submitted", durationSeconds: 15 } },
  snapshot: { source: "PRIVATE_SOURCE" },
});

function fixture({ result = checkpoint(), request = {}, status = "failed" } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE document_jobs(job_id TEXT PRIMARY KEY,owner_id TEXT,stream_id TEXT,document_id TEXT,kind TEXT,status TEXT,correlation_id TEXT,request_json TEXT,result_json TEXT,attempt_count INTEGER,started_at TEXT,completed_at TEXT,lease_expires_at TEXT,expires_at TEXT,updated_at TEXT);
    CREATE TABLE budget_reservations(reservation_id TEXT PRIMARY KEY,owner_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,period TEXT,reserved_tokens INTEGER,used_tokens INTEGER,status TEXT,settled_at TEXT,updated_at TEXT);
    CREATE TABLE cost_budget_reservations(reservation_id TEXT PRIMARY KEY,owner_id TEXT,workspace_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,period TEXT,reserved_microusd INTEGER,used_microusd INTEGER,status TEXT,settled_at TEXT,updated_at TEXT);
    CREATE TABLE budget_counters(scope TEXT,scope_id TEXT,period TEXT,used_tokens INTEGER,reserved_tokens INTEGER,hard_limit_tokens INTEGER,updated_at TEXT,PRIMARY KEY(scope,scope_id,period));
    CREATE TABLE cost_budget_counters(scope TEXT,scope_id TEXT,period TEXT,used_microusd INTEGER,reserved_microusd INTEGER,hard_limit_microusd INTEGER,updated_at TEXT,PRIMARY KEY(scope,scope_id,period));
    CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,correlation_id TEXT,type TEXT,payload TEXT,occurred_at TEXT);
    CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT);
    CREATE TABLE project_budget_reservation_scopes(reservation_id TEXT);
    CREATE TABLE pilot_cost_reservation_scopes(reservation_id TEXT);
    CREATE TABLE output_operation_slots(job_id TEXT,token_reservation_id TEXT,cost_reservation_id TEXT);
    CREATE TABLE consequential_execution_steps(token_reservation_id TEXT,cost_reservation_id TEXT);
    CREATE TABLE budget_hold_dispositions(job_id TEXT,token_reservation_id TEXT,cost_reservation_id TEXT);
  `);
  sqlite.prepare("INSERT INTO document_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("job-1", "owner", "creative:owner", "doc-1", "render_document", status, "job-1:attempt:1", JSON.stringify({ artifactKind: "video", productionMode: "managed", prompt: "PRIVATE_REQUEST", ...request }), JSON.stringify(result), 1, stamp, stamp, null, new Date(now + 86400000).toISOString(), stamp);
  sqlite.prepare("INSERT INTO budget_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("token-1", "owner", "creative:owner", "job-1:attempt:1", "document-render:video", "2026-08", 152000, 0, "active", null, stamp);
  sqlite.prepare("INSERT INTO cost_budget_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run("cost-1", "owner", "forma", "creative:owner", "job-1:attempt:1", "document-render:video", "2026-08", 19644000, 0, "executing", null, stamp);
  for (const [scope, scopeId] of [["user", "owner"], ["workspace", "forma"]]) {
    sqlite.prepare("INSERT INTO budget_counters VALUES(?,?,?,?,?,?,?)").run(scope, scopeId, "2026-08", 300, 152000, 1000000, stamp);
    sqlite.prepare("INSERT INTO cost_budget_counters VALUES(?,?,?,?,?,?,?)").run(scope, scopeId, "2026-08", 777, 19644000, 100000000, stamp);
  }
  sqlite.prepare("INSERT INTO events VALUES(?,?,?,?,?,?)").run("reserve-event", "creative:owner", "job-1:attempt:1", "BudgetReserved", JSON.stringify({ reservation_id: "token-1", cost_reservation_id: "cost-1", reserved_tokens: 152000, reserved_microusd: 19644000, secret: "PRIVATE_AUDIT_SOURCE" }), stamp);
  const reads = [];
  let beforeBatch;
  class Prepared {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Prepared(this.sql, values); }
    execute(first = false) {
      assert.match(this.sql, /^\s*SELECT\b/u, "Only SELECT reaches the application database adapter");
      reads.push(this.sql);
      const statement = sqlite.prepare(this.sql);
      return first ? statement.get(...this.values) ?? null : { results: statement.all(...this.values), success: true, meta: { changes: 0 } };
    }
    async first() { return this.execute(true); }
    async run() { throw new Error("Mutation forbidden"); }
    async all() { return this.execute(false); }
  }
  const env = { DB: {
    prepare: sql => new Prepared(sql),
    async batch(statements) {
      beforeBatch?.();
      assert.ok(statements.length === 8);
      sqlite.exec("BEGIN");
      try { const values = statements.map(statement => statement.execute()); sqlite.exec("COMMIT"); return values; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } };
  return { sqlite, env, reads, beforeBatch: callback => { beforeBatch = callback; },
    snapshot: () => sqlite.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all().map(row => [row.name, row.sql, row.name.startsWith("sqlite_") ? null : sqlite.prepare(`SELECT * FROM ${row.name} ORDER BY rowid`).all()]) };
}

const target = { jobId: "job-1", documentId: "doc-1", attemptCount: 1, status: "failed" };
const inspect = preview => accountingPreviewForInspection({ preview }, target);
const read = f => previewGenerationAccounting(f.env, actor, "job-1", now);
const event = (f, payload, { id = "prior", correlation = "other-job:attempt:2", stream = "creative:owner", type = "GenerationUsageRecorded", at = stamp } = {}) =>
  f.sqlite.prepare("INSERT INTO events VALUES(?,?,?,?,?,?)").run(id, stream, correlation, type, typeof payload === "string" ? payload : JSON.stringify(payload), at);
function earlierLedgers(f, { owner = "owner", stream = "creative:owner", correlation = "other-job:attempt:2", period = "2026-07", tokenStatus = "settled", costStatus = "settled", usedTokens = 15580, usedMicrousd = 98484 } = {}) {
  f.sqlite.prepare("INSERT INTO budget_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("token-old", owner, stream, correlation, "document-render:video", period, 152000, usedTokens, tokenStatus, stamp, stamp);
  f.sqlite.prepare("INSERT INTO cost_budget_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run("cost-old", owner, "forma", stream, correlation, "document-render:video", period, 19644000, usedMicrousd, costStatus, stamp, stamp);
}
const usage = () => ({ provider_job_id: "fal-video", reservation_id: "token-old", cost_reservation_id: "cost-old", total_tokens: 15580, cost_microusd: 98484, private: "PRIVATE_PRIOR" });
function unchanged(f, before, preview) {
  assert.deepEqual(f.snapshot(), before, "SELECT-only reader must leave every synthetic row/schema unchanged");
  assert.equal(f.reads.length, 9);
  assert.equal(preview.mutationAvailable, false);
  assert.equal(preview.providerCalls, 0); assert.equal(preview.ledgerWrites, 0);
  assert.equal(preview.acquisition.mutationAvailable, false);
  assert.equal(preview.acquisition.proposedSettlementMicrousd, null);
  assert.equal(preview.acquisition.proposedSettlementTokens, null);
  assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_|private.invalid|request_json|result_json|pricingReceipt|responseRef|mediaUrl/u);
}
test("actual-shape August receipt: scoped absence observation and conditional arithmetic, never settlement or global unpaid", async () => {
  const f = fixture(), before = f.snapshot(), p = await read(f), a = p.acquisition;
  unchanged(f, before, p);
  assert.equal(p.calls.find(call => call.operation === "video").status, "accepted");
  assert.equal(p.reservations.dollars.status, "executing");
  assert.equal(a.binding.period, "2026-08");
  assert.equal(a.binding.ownerId, "owner"); assert.equal(a.binding.streamId, "creative:owner");
  assert.deepEqual(a.unresolvedReasons, ["external_billing_adjudication_not_acquired"]);
  assert.deepEqual(a.coverageLimitations, ["global_prior_use_not_established", "other_job_per_call_allocation_not_acquired"]);
  assert.equal(a.priorUsage.globalPriorUseEstablished, false); assert.equal(a.priorUsage.rowsRead, 0);
  assert.equal(a.prepaid.request.anchor.state, "absent");
  assert.equal(a.prepaid.checkpoint.sceneIds.state, "absent");
  assert.deepEqual(a.conditionalArithmetic, {
    basis: "hypothetical_exact_zero_and_no_prior_payment_not_established", period: "2026-08",
    receiptSubtotalMicrousd: 98484, hypotheticalVideoMicrousd: 0, hypotheticalTotalMicrousd: 98484,
    hypotheticalUnusedMicrousd: 19545516, plannerInputTokens: 13230, plannerOutputTokens: 2350,
    hypotheticalTotalTokens: 15580, hypotheticalUnusedTokens: 136420,
  });
  assert.deepEqual(inspect(p).acquisition, a);
  assert.match(f.reads.at(-1), /\$\.provider_job_id/u);
  assert.doesNotMatch(f.reads.at(-1), /provider_request_id/u);
});
test("unchanged DB observation digests stable across observation times; source/marker/prior changes alter them", async () => {
  const f = fixture(), one = await read(f), two = await previewGenerationAccounting(f.env, actor, "job-1", now + 1);
  assert.equal(one.snapshotSha256, two.snapshotSha256); assert.equal(one.acquisition.evidenceSha256, two.acquisition.evidenceSha256);
  assert.notEqual(one.observedAt, two.observedAt);
  event(f, { provider_job_id: "fal-anchor", cost_microusd: 0 });
  const three = await read(f);
  assert.notEqual(one.snapshotSha256, three.snapshotSha256); assert.notEqual(one.acquisition.evidenceSha256, three.acquisition.evidenceSha256);
  const altered = await read(fixture({ request: { productionPrepaidAnchor: false } }));
  assert.notEqual(one.snapshotSha256, altered.snapshotSha256);
});
for (const source of ["request", "checkpoint"]) {
  for (const [key, value] of [["productionPrepaidAnchor", true], ["productionPrepaidSceneIds", ["scene-003"]], ["prepaidProviderCostMicrousd", 43824]]) {
    test(`positive ${source}.${key}: observation retained, arithmetic withheld`, async () => {
      const options = source === "request" ? { request: { [key]: value } } : { result: { ...checkpoint(), [key]: value } };
      const f = fixture(options), before = f.snapshot(), p = await read(f);
      unchanged(f, before, p);
      assert.ok(p.acquisition.unresolvedReasons.includes("prepaid_marker_present"));
      assert.equal(p.acquisition.conditionalArithmetic, null);
      assert.deepEqual(inspect(p).acquisition, p.acquisition);
    });
  }
  for (const [key, value] of [["productionPrepaidAnchor", ["true"]], ["productionPrepaidAnchor", null], ["productionPrepaidSceneIds", {}], ["productionPrepaidSceneIds", ["scene-003", "scene-003"]], ["productionPrepaidSceneIds", ["PRIVATE text"]], ["prepaidProviderCostMicrousd", -1], ["prepaidProviderCostMicrousd", 0.5], ["prepaidProviderCostMicrousd", Number.MAX_SAFE_INTEGER + 1]]) {
    test(`malformed ${source}.${key} ${JSON.stringify(value)}: no false absence`, async () => {
      const options = source === "request" ? { request: { [key]: value } } : { result: { ...checkpoint(), [key]: value } };
      const p = await read(fixture(options));
      assert.ok(p.acquisition.unresolvedReasons.includes("prepaid_marker_malformed")); assert.equal(p.acquisition.conditionalArithmetic, null);
      assert.doesNotMatch(JSON.stringify(p), /PRIVATE text/u);
      assert.deepEqual(inspect(p).acquisition, p.acquisition);
    });
  }
}
test("explicit false/empty/zero markers are distinct from absence and preserve hypothetical eligibility", async () => {
  const markers = { productionPrepaidAnchor: false, productionPrepaidSceneIds: [], prepaidProviderCostMicrousd: 0 };
  const p = await read(fixture({ request: markers, result: { ...checkpoint(), ...markers } }));
  for (const source of Object.values(p.acquisition.prepaid)) {
    assert.deepEqual(source.anchor, { state: "value", value: false });
    assert.deepEqual(source.sceneIds, { state: "value", value: [] });
    assert.deepEqual(source.providerCostMicrousd, { state: "value", value: 0 });
  }
  assert.ok(p.acquisition.conditionalArithmetic); assert.deepEqual(inspect(p).acquisition, p.acquisition);
});
for (const [field, value, match] of [["provider_job_id", "fal-video", "provider_job_id"], ["provider_job_id", "fal-anchor", "provider_job_id"], ["planner_response_id", "resp-planner", "planner_response_id"]]) {
  test(`actual writer identity ${field}:${value} joins both owned earlier-period ledgers without deduction`, async () => {
    const f = fixture(); earlierLedgers(f); event(f, { ...usage(), provider_job_id: undefined, [field]: value });
    const before = f.snapshot(), p = await read(f), a = p.acquisition, row = a.priorUsage.rows[0];
    unchanged(f, before, p);
    assert.deepEqual(row.matchedBy, [match]); assert.equal(row.tokenLedger.state, "observed"); assert.equal(row.dollarLedger.state, "observed");
    assert.equal(row.tokenLedger.period, "2026-07"); assert.equal(row.dollarLedger.used, 98484);
    assert.equal(a.conditionalArithmetic, null); assert.ok(a.unresolvedReasons.includes("prior_usage_observed"));
    assert.equal(a.binding.period, "2026-08"); assert.equal(p.accounting.knownReceiptCostMicrousd, 98484);
    assert.deepEqual(inspect(p).acquisition, a);
  });
}
for (const selector of ["job_id", "job_attempt_correlation", "reservation_id", "cost_reservation_id"]) {
  test(`same-job selector ${selector} catches prior activity independently of provider IDs`, async () => {
    const f = fixture();
    event(f, selector === "job_id" ? { job_id: "job-1" } : selector === "reservation_id" ? { reservation_id: "token-1" } : selector === "cost_reservation_id" ? { cost_reservation_id: "cost-1" } : {},
      { correlation: selector === "job_attempt_correlation" ? "job-1:attempt:9" : "other-job:attempt:2" });
    const p = await read(f);
    assert.ok(p.acquisition.priorUsage.rows[0].matchedBy.includes(selector));
    assert.equal(p.acquisition.conditionalArithmetic, null);
    assert.ok(p.acquisition.unresolvedReasons.includes("prior_usage_join_unresolved"));
  });
}
test("unknown provider_request_id and another stream are not mislabeled covered/unpaid", async () => {
  const f = fixture();
  event(f, { provider_request_id: "fal-video", cost_microusd: 123 });
  event(f, usage(), { id: "foreign", stream: "creative:foreign" });
  const p = await read(f);
  assert.equal(p.acquisition.priorUsage.rowsRead, 0);
  assert.equal(p.acquisition.priorUsage.globalPriorUseEstablished, false);
  assert.ok(p.acquisition.coverageLimitations.includes("global_prior_use_not_established"));
  assert.equal(p.acquisition.proposedSettlementMicrousd, null);
});
for (const [label, modify, expected] of [
  ["missing token", f => f.sqlite.exec("DELETE FROM budget_reservations WHERE reservation_id='token-old'"), "missing"],
  ["foreign owner", f => f.sqlite.exec("UPDATE budget_reservations SET owner_id='foreign' WHERE reservation_id='token-old'"), "missing"],
  ["foreign stream", f => f.sqlite.exec("UPDATE budget_reservations SET stream_id='creative:foreign' WHERE reservation_id='token-old'"), "binding_conflict"],
  ["wrong correlation", f => f.sqlite.exec("UPDATE budget_reservations SET correlation_id='wrong' WHERE reservation_id='token-old'"), "binding_conflict"],
  ["wrong operation", f => f.sqlite.exec("UPDATE budget_reservations SET operation='other' WHERE reservation_id='token-old'"), "binding_conflict"],
  ["malformed month", f => f.sqlite.exec("UPDATE budget_reservations SET period='2026-99' WHERE reservation_id='token-old'"), "binding_conflict"],
  ["malformed status", f => f.sqlite.exec("UPDATE budget_reservations SET status='unknown' WHERE reservation_id='token-old'"), "binding_conflict"],
  ["negative usage", f => f.sqlite.exec("UPDATE budget_reservations SET used_tokens=-1 WHERE reservation_id='token-old'"), "binding_conflict"],
  ["active nonzero usage", f => f.sqlite.exec("UPDATE budget_reservations SET status='active' WHERE reservation_id='token-old'"), "binding_conflict"],
]) {
  test(`prior ${label}: no foreign ledger fields and no arithmetic`, async () => {
    const f = fixture(); earlierLedgers(f); modify(f); event(f, usage());
    const before = f.snapshot(), p = await read(f), a = p.acquisition;
    unchanged(f, before, p);
    assert.deepEqual(a.priorUsage.rows[0].tokenLedger, { state: expected, reservationId: "token-old" });
    assert.equal(a.priorUsage.rows[0].dollarLedger.state, "observed");
    assert.ok(a.unresolvedReasons.includes("prior_usage_join_unresolved")); assert.equal(a.conditionalArithmetic, null);
    assert.deepEqual(inspect(p).acquisition, a);
  });
}
test("token and dollar ledgers independent: missing cost, wrong workspace and unreferenced markers", async () => {
  for (const edit of ["DELETE FROM cost_budget_reservations WHERE reservation_id='cost-old'", "UPDATE cost_budget_reservations SET workspace_id='other' WHERE reservation_id='cost-old'"]) {
    const f = fixture(); earlierLedgers(f); f.sqlite.exec(edit); event(f, usage());
    const p = await read(f);
    assert.equal(p.acquisition.priorUsage.rows[0].tokenLedger.state, "observed");
    assert.notEqual(p.acquisition.priorUsage.rows[0].dollarLedger.state, "observed");
    assert.equal(p.acquisition.conditionalArithmetic, null);
  }
  const f = fixture(); event(f, { provider_job_id: "fal-video", cost_microusd: 0 });
  const p = await read(f);
  assert.deepEqual(p.acquisition.priorUsage.rows[0].tokenLedger, { state: "not_referenced", reservationId: null });
  assert.ok(p.acquisition.unresolvedReasons.includes("prior_usage_observed")); assert.equal(p.acquisition.conditionalArithmetic, null);
});
for (const [label, payload, options] of [
  ["oversize", { provider_job_id: "fal-video", private: "x".repeat(66000) }, {}],
  ["negative amount", { provider_job_id: "fal-video", cost_microusd: -1 }, {}],
  ["fractional amount", { provider_job_id: "fal-video", cost_microusd: 0.5 }, {}],
  ["null amount", { provider_job_id: "fal-video", cost_microusd: null }, {}],
  ["array identity", { provider_job_id: "fal-video", reservation_id: ["token-old"] }, {}],
  ["malformed timestamp", { provider_job_id: "fal-video" }, { at: "not-a-date" }],
  ["malformed JSON owned attempt", "{", { correlation: "job-1:attempt:7" }],
  ["array payload owned attempt", "[]", { correlation: "job-1:attempt:7" }],
]) {
  test(`malformed prior ${label}: bounded unresolved observation without raw payload`, async () => {
    const f = fixture(); event(f, payload, options);
    const p = await read(f), a = p.acquisition;
    assert.equal(a.priorUsage.rowsRead, 1); assert.equal(a.priorUsage.malformedRows, 1); assert.deepEqual(a.priorUsage.rows, []);
    assert.ok(a.unresolvedReasons.includes("prior_usage_evidence_malformed")); assert.equal(a.conditionalArithmetic, null);
    assert.deepEqual(inspect(p).acquisition, a);
  });
}
test("33rd row is a truncation sentinel, only 32 returned; no all-period completeness inference", async () => {
  const f = fixture(); for (let i = 0; i < 35; i++) event(f, { provider_job_id: "fal-video" }, { id: `event-${i.toString().padStart(3, "0")}` });
  const before = f.snapshot(), p = await read(f), a = p.acquisition;
  unchanged(f, before, p);
  assert.equal(a.priorUsage.rowsRead, 33); assert.equal(a.priorUsage.rows.length, 32); assert.equal(a.priorUsage.truncated, true);
  assert.ok(a.unresolvedReasons.includes("prior_usage_truncated")); assert.equal(a.conditionalArithmetic, null);
  assert.deepEqual(inspect(p).acquisition, a);
});
test("existing exact original ownership/counters, scope and final job snapshot refusal remain intact", async () => {
  for (const edit of [
    "UPDATE budget_reservations SET owner_id='other'",
    "UPDATE cost_budget_reservations SET period='2026-09'",
    "UPDATE cost_budget_counters SET reserved_microusd=0",
    "DELETE FROM budget_counters WHERE scope='workspace'",
    "INSERT INTO budget_hold_dispositions VALUES('job-1','token-1','cost-1')",
  ]) {
    const f = fixture(); f.sqlite.exec(edit); const before = f.snapshot();
    await assert.rejects(read(f)); assert.deepEqual(f.snapshot(), before);
  }
  const f = fixture(); f.beforeBatch(() => f.sqlite.exec("UPDATE document_jobs SET updated_at='changed'"));
  await assert.rejects(read(f), e => e.code === "accounting_snapshot_changed");
});
test("narrow R2 refusal remains visible for missing anchor binding; no fictional null-anchor arithmetic", async () => {
  const result = checkpoint(); delete result.productionAnchor.sceneId;
  const p = await read(fixture({ result }));
  assert.equal(p.acquisition.conditionalArithmetic, null);
  assert.deepEqual(p.acquisition.plannerRefusalReasons, ["anchor_scene_binding_unverified"]);
  assert.deepEqual(inspect(p).acquisition, p.acquisition);
});
test("missing new-query schema is refused without repair or initialization", async () => {
  const f = fixture(); f.sqlite.exec("ALTER TABLE budget_reservations RENAME COLUMN owner_id TO unsupported_owner");
  const before = f.snapshot();
  const api = createGenerationAccountingHandler(async () => ({ user: actor, response: null }));
  const response = await api(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1"), f.env);
  assert.equal(response.status, 503); assert.deepEqual(f.snapshot(), before);
});
test("unchanged API: no mutation/query authority, denied preflight touches no DB; final revoke suppresses acquired evidence", async () => {
  const f = fixture(), before = f.snapshot();
  let checks = 0;
  const api = createGenerationAccountingHandler(async () => ++checks === 1 ? { user: actor, response: null } : { user: null, response: Response.json({ error: "revoked" }, { status: 403 }) });
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "HEAD"])
    assert.equal((await api(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1", { method }), f.env)).status, 405);
  assert.equal((await api(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1&providerCost=0"), f.env)).status, 400);
  assert.equal(checks, 0); assert.equal(f.reads.length, 0);
  const response = await api(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1"), f.env);
  assert.equal(response.status, 403); assert.doesNotMatch(await response.text(), /acquisition|fal-video|token-1/u);
  assert.equal(checks, 2); assert.deepEqual(f.snapshot(), before);
  const denied = createGenerationAccountingHandler(async () => ({ user: null, response: Response.json({ error: "denied" }, { status: 403 }) }));
  const noRead = fixture(); await denied(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1"), noRead.env);
  assert.equal(noRead.reads.length, 0);
});
test("final authority epoch change withholds evidence; stable response remains private/no-store", async () => {
  let checks = 0; const f = fixture();
  const changed = createGenerationAccountingHandler(async () => ({ user: ++checks === 1 ? actor : { ...actor, authorizationSnapshot: { ...actor.authorizationSnapshot, rawEpoch: "changed" } }, response: null }));
  const response = await changed(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1"), f.env);
  assert.equal(response.status, 409); assert.doesNotMatch(await response.text(), /acquisition/u);
  const stable = createGenerationAccountingHandler(async () => ({ user: actor, response: null }));
  const good = await stable(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1"), f.env);
  assert.equal(good.status, 200); assert.equal(good.headers.get("cache-control"), "private, no-store");
  assert.ok(inspect((await good.json()).preview).acquisition);
});
test("client preserves allowlisted evidence, discards unknown private extensions and keeps legacy response compatibility", async () => {
  const p = await read(fixture()), clean = inspect(p);
  p.acquisition.secret = "PRIVATE_SECRET"; p.acquisition.prepaid.request.anchor.secret = "PRIVATE_SECRET";
  p.acquisition.binding.source = "PRIVATE_SOURCE"; p.acquisition.conditionalArithmetic.source = "PRIVATE_SOURCE";
  assert.deepEqual(inspect(p), clean);
  delete p.acquisition;
  assert.equal("acquisition" in inspect(p), false);
});
const tamperCases = [
  ["version", a => { a.version = 2; }],
  ["authority", a => { a.mutationAvailable = true; }],
  ["settlement", a => { a.proposedSettlementMicrousd = 98484; }],
  ["global assertion", a => { a.priorUsage.globalPriorUseEstablished = true; }],
  ["coverage omission", a => { a.coverageLimitations = []; }],
  ["missing external adjudication", a => { a.unresolvedReasons = []; }],
  ["array enum", a => { a.prepaid.request.anchor.state = ["absent"]; }],
  ["malformed marker disguise", a => { a.prepaid.request.anchor = { state: "absent", value: false }; }],
  ["owner mismatch", a => { a.binding.ownerId = "foreign"; a.binding.streamId = "creative:foreign"; }],
  ["snapshot mismatch", a => { a.snapshotSha256 = "0".repeat(64); }],
  ["non-hash digest", a => { a.evidenceSha256 = "PRIVATE_SOURCE"; }],
  ["truncation mismatch", a => { a.priorUsage.truncated = true; }],
  ["rows mismatch", a => { a.priorUsage.rowsRead = 1; }],
  ["row bound", a => { a.priorUsage.rowsRead = 34; }],
  ["unearned positive-marker arithmetic", a => { a.prepaid.request.anchor = { state: "value", value: true }; }],
  ["unsafe integer", a => { a.conditionalArithmetic.hypotheticalTotalTokens = Number.MAX_SAFE_INTEGER + 1; }],
  ["wrong dollars", a => { a.conditionalArithmetic.hypotheticalTotalMicrousd++; }],
  ["wrong token model", a => { a.conditionalArithmetic.plannerInputTokens++; }],
  ["wrong original period", a => { a.binding.period = "2026-09"; }],
  ["refusal prose", a => { a.plannerRefusalReasons = ["PRIVATE freeform source"]; }],
];
for (const [label, tamper] of tamperCases) test(`client refuses ${label}`, async () => {
  const p = await read(fixture()); tamper(p.acquisition);
  assert.throws(() => inspect(p), /accounting_preview_unavailable/u);
});
test("client ledger state and observed identity field bounds fail closed", async () => {
  const f = fixture(); earlierLedgers(f); event(f, usage());
  const p = await read(f);
  for (const mutate of [
    a => { a.priorUsage.rows[0].tokenLedger.reservationId = "foreign"; },
    a => { a.priorUsage.rows[0].tokenLedger.state = ["observed"]; },
    a => { a.priorUsage.rows[0].matchedBy = ["provider_request_id"]; },
    a => { a.priorUsage.rows[0].amounts.cost_microusd = -1; },
    a => { a.priorUsage.rows[0].providerJobId = "PRIVATE freeform"; },
    a => { a.priorUsage.rows.push(clone(a.priorUsage.rows[0])); a.priorUsage.rowsRead++; },
  ]) { const copy = clone(p); mutate(copy.acquisition); assert.throws(() => inspect(copy), /accounting_preview_unavailable/u); }
});
