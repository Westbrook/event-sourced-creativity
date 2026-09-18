import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { previewGenerationAccounting } from "../worker/generation-accounting-preview.ts";
import { createGenerationAccountingHandler } from "../worker/generation-accounting-api.ts";

const now = Date.now();
const stamp = new Date(now - 1000).toISOString();
const actor = { userId: "owner", streamId: "creative:owner", role: "admin", access: { identityPolicyDeniedCustody: false }, authorizationSnapshot: { updatedAt: stamp, rawEpoch: "epoch-1" } };
const checkpoint = () => ({
  providerSubmissionProtocol: 1, reservationId: "token-1", costReservationId: "cost-1", costReservationPeriod: "2026-08", plannerResponseId: "resp-planner",
  generationReceipt: { actual_provider_call_count: 3 },
  providerSubmissions: {
    "client-plan": { clientRequestId: "client-plan", provider: "openai", operation: "planning", model: "gpt-5.6-terra", status: "completed", providerRequestId: "resp-planner", costMicrousd: 30000, inputTokens: 100, outputTokens: 50, totalTokens: 150, responseRef: "PRIVATE_RESPONSE_REF", pricingReceipt: { secret: "PRIVATE_PRICING" } },
    "client-anchor": { clientRequestId: "client-anchor", provider: "fal", operation: "image", model: "fal-ai/ideogram/v4", unitId: "continuity-anchor", status: "completed", providerRequestId: "fal-anchor", costMicrousd: 80000, inputTokens: 0, outputTokens: 0, totalTokens: 0, prompt: "PRIVATE_ANCHOR_PROMPT" },
    "client-video": { clientRequestId: "client-video", provider: "fal", operation: "video", model: "bytedance/seedance-2.0/reference-to-video", unitId: "scene:scene-003", status: "accepted", providerRequestId: "fal-video", providerUrl: "https://private.invalid" },
  },
  productionAnchor: { providerJobId: "fal-anchor", mediaUrl: "/api/media/PRIVATE_MEDIA" },
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
  sqlite.prepare("INSERT INTO budget_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("token-1", "owner", "creative:owner", "job-1:attempt:1", "document-render:video", "2026-08", 1000, 0, "active", null, stamp);
  sqlite.prepare("INSERT INTO cost_budget_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run("cost-1", "owner", "forma", "creative:owner", "job-1:attempt:1", "document-render:video", "2026-08", 19644000, 0, "executing", null, stamp);
  for (const [scope, scopeId] of [["user", "owner"], ["workspace", "forma"]]) {
    sqlite.prepare("INSERT INTO budget_counters VALUES(?,?,?,?,?,?,?)").run(scope, scopeId, "2026-08", 300, 1000, 1000000, stamp);
    sqlite.prepare("INSERT INTO cost_budget_counters VALUES(?,?,?,?,?,?,?)").run(scope, scopeId, "2026-08", 777, 19644000, 100000000, stamp);
  }
  sqlite.prepare("INSERT INTO events VALUES(?,?,?,?,?,?)").run("reserve-event", "creative:owner", "job-1:attempt:1", "BudgetReserved", JSON.stringify({ reservation_id: "token-1", cost_reservation_id: "cost-1", reserved_tokens: 1000, reserved_microusd: 19644000, secret: "PRIVATE_AUDIT_SOURCE" }), stamp);
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
      assert.equal(statements.length, 8);
      sqlite.exec("BEGIN");
      try { const values = statements.map(statement => statement.execute()); sqlite.exec("COMMIT"); return values; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } };
  return { sqlite, env, reads, beforeBatch: callback => { beforeBatch = callback; },
    snapshot: () => sqlite.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all().map(row => [row.name, row.sql, row.name.startsWith("sqlite_") ? null : sqlite.prepare(`SELECT * FROM ${row.name} ORDER BY rowid`).all()]) };
}

test("accepted failed video remains unknown; completed preparation costs and original period remain inspectable without writes", async () => {
  const f = fixture(), before = f.snapshot();
  const preview = await previewGenerationAccounting(f.env, actor, "job-1", now);
  assert.equal(preview.accounting.knownReceiptCostMicrousd, 110000);
  assert.equal(preview.accounting.totalReceiptCostMicrousd, null);
  assert.equal(preview.accounting.proposedSettlementMicrousd, null);
  assert.equal(preview.accounting.unresolvedCallCount, 1);
  assert.equal(preview.calls[2].accountingReason, "accepted_call_billing_unresolved");
  assert.equal(preview.reservations.dollars.reservedMicrousd, 19644000);
  assert.equal(preview.reservations.dollars.usedMicrousd, 0);
  assert.equal(preview.reservations.dollars.status, "executing");
  assert.equal(preview.reservations.period, "2026-08");
  assert.equal(preview.providerCalls, 0); assert.equal(preview.ledgerWrites, 0); assert.equal(preview.mutationAvailable, false);
  assert.match(preview.snapshotSha256, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_|private\.invalid|responseRef|pricingReceipt|request_json|result_json/u);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.reads.length, 9);
});

test("repeated read has a stable evidence digest; no screenshot/request parameter can resolve accepted billing", async () => {
  const f = fixture();
  const one = await previewGenerationAccounting(f.env, actor, "job-1", now);
  const two = await previewGenerationAccounting(f.env, actor, "job-1", now + 1);
  assert.equal(one.snapshotSha256, two.snapshotSha256);
  const api = createGenerationAccountingHandler(async () => ({ user: actor, response: null }));
  const response = await api(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1&costMicrousd=0"), f.env);
  assert.equal(response.status, 400);
});

test("no mutation HTTP method or duplicate/extra parameter is supported", async () => {
  let authCalls = 0;
  const api = createGenerationAccountingHandler(async () => { authCalls++; throw new Error("Unexpected auth"); });
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) assert.equal((await api(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1", { method }), {})).status, 405);
  for (const query of ["", "jobId=", "jobId=job-1&jobId=job-2", "jobId=job-1&apply=true", "jobId=%3Cscript%3E"]) assert.equal((await api(new Request(`https://forma.invalid/api/admin/generation-accounting?${query}`), {})).status, 400);
  assert.equal(authCalls, 0);
});

test("authentication refusal touches no job data; revocation discards a completed preview", async () => {
  const f = fixture();
  const denied = createGenerationAccountingHandler(async () => ({ user: null, response: Response.json({ error: "denied" }, { status: 403 }) }));
  assert.equal((await denied(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1"), f.env)).status, 403);
  assert.equal(f.reads.length, 0);
  let checks = 0;
  const revoked = createGenerationAccountingHandler(async () => ++checks === 1 ? { user: actor, response: null } : { user: null, response: Response.json({ error: "revoked" }, { status: 403 }) });
  const response = await revoked(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1"), f.env);
  assert.equal(response.status, 403); assert.doesNotMatch(await response.text(), /fal-video|reservationId/u);
});

test("authority snapshot change rejects the return; valid response is private and no-store", async () => {
  const f = fixture(); let checks = 0;
  const changed = createGenerationAccountingHandler(async () => ({ user: ++checks === 1 ? actor : { ...actor, authorizationSnapshot: { ...actor.authorizationSnapshot, rawEpoch: "epoch-2" } }, response: null }));
  assert.equal((await changed(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1"), f.env)).status, 409);
  const stable = createGenerationAccountingHandler(async () => ({ user: actor, response: null }));
  const response = await stable(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1"), f.env);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("non-admin, fictional, shared, other payer and missing authority are denied before reads", async () => {
  for (const patch of [{ role: "viewer" }, { fictional: true }, { projectExecution: {} }, { billingUserId: "other" }, { streamId: "creative:other" }, { authorizationSnapshot: null }, { access: { identityPolicyDeniedCustody: true } }]) {
    const f = fixture();
    await assert.rejects(previewGenerationAccounting(f.env, { ...actor, ...patch }, "job-1", now), error => error.status === 403);
    assert.equal(f.reads.length, 0);
  }
});

test("other owner, nonterminal, expired, leased, non-video and non-managed jobs are not admitted", async () => {
  for (const statement of ["UPDATE document_jobs SET owner_id='other'", "UPDATE document_jobs SET status='running'", "UPDATE document_jobs SET expires_at='2000-01-01'", "UPDATE document_jobs SET lease_expires_at='2099-01-01'", "UPDATE document_jobs SET completed_at=NULL", "UPDATE document_jobs SET request_json='{}'"]) {
    const f = fixture(); f.sqlite.exec(statement);
    await assert.rejects(previewGenerationAccounting(f.env, actor, "job-1", now));
  }
});

test("project, pilot, native Output, consequential and administrative dispositions stay outside scope", async () => {
  for (const statement of ["INSERT INTO project_resource_scopes VALUES('job','job-1')", "INSERT INTO project_resource_scopes VALUES('document','doc-1')", "INSERT INTO project_budget_reservation_scopes VALUES('token-1')", "INSERT INTO pilot_cost_reservation_scopes VALUES('cost-1')", "INSERT INTO output_operation_slots VALUES('job-1','token-1','cost-1')", "INSERT INTO consequential_execution_steps VALUES('token-1','cost-1')", "INSERT INTO budget_hold_dispositions VALUES('job-1','token-1','cost-1')"]) {
    const f = fixture(); f.sqlite.exec(statement); const before = f.snapshot();
    await assert.rejects(previewGenerationAccounting(f.env, actor, "job-1", now), error => error.code === "accounting_personal_unscoped_only");
    assert.deepEqual(f.snapshot(), before);
  }
});

test("changed job snapshot rejects all accounting observations", async () => {
  const f = fixture(); f.beforeBatch(() => f.sqlite.exec("UPDATE document_jobs SET updated_at='changed'"));
  await assert.rejects(previewGenerationAccounting(f.env, actor, "job-1", now), error => error.code === "accounting_snapshot_changed");
});

test("reservation ownership, attempt/month and counter inconsistencies fail closed", async () => {
  for (const statement of ["UPDATE budget_reservations SET owner_id='other'", "UPDATE cost_budget_reservations SET correlation_id='job-1:attempt:2'", "UPDATE cost_budget_reservations SET period='2026-09'", "UPDATE cost_budget_reservations SET workspace_id='shared'", "UPDATE budget_reservations SET used_tokens=1", "UPDATE cost_budget_reservations SET used_microusd=-1", "UPDATE cost_budget_counters SET reserved_microusd=0", "DELETE FROM budget_counters WHERE scope='workspace'"]) {
    const f = fixture(); f.sqlite.exec(statement);
    await assert.rejects(previewGenerationAccounting(f.env, actor, "job-1", now));
  }
});

test("malformed and ambiguous calls do not become a total", async () => {
  for (const change of [r => { r.providerSubmissions = null; }, r => { r.providerSubmissions["client-anchor"].providerRequestId = "fal-video"; }, r => { r.providerSubmissions["client-plan"].costMicrousd = -1; }, r => { r.providerSubmissions["client-plan"].costMicrousd = 0.5; }, r => { r.providerSubmissions["client-video"].status = "rejected"; r.providerSubmissions["client-video"].costMicrousd = 5; }, r => { r.providerSubmissions["client-plan"].model = "PRIVATE MODEL TEXT"; }]) {
    const result = checkpoint(); change(result); const f = fixture({ result });
    await assert.rejects(previewGenerationAccounting(f.env, actor, "job-1", now));
  }
  const result = checkpoint(); delete result.providerSubmissions["client-plan"].costMicrousd;
  const preview = await previewGenerationAccounting(fixture({ result }).env, actor, "job-1", now);
  assert.equal(preview.accounting.totalReceiptCostMicrousd, null);
  assert.equal(preview.accounting.knownReceiptCostMicrousd, 80000);
});

test("prior planner token/dollar audit observations stay independent and are not automatically deducted", async () => {
  const f = fixture();
  f.sqlite.prepare("INSERT INTO events VALUES(?,?,?,?,?,?)").run("outside-plan", "creative:owner", "prior-attempt", "GenerationUsageRecorded", JSON.stringify({ planner_response_id: "resp-planner", total_tokens: 150, planner_tokens: 150, cost_microusd: 0, planner_cost_microusd: 0 }), stamp);
  const preview = await previewGenerationAccounting(f.env, actor, "job-1", now);
  assert.equal(preview.audits.length, 2);
  assert.equal(preview.audits.find(row => row.eventId === "outside-plan").amounts.total_tokens, 150);
  assert.equal(preview.audits.find(row => row.eventId === "outside-plan").amounts.planner_cost_microusd, 0);
  assert.equal(preview.accounting.proposedSettlementMicrousd, null);
});

test("audit read limit and missing schema fail closed without repairs", async () => {
  const f = fixture();
  for (let index = 0; index < 100; index++) f.sqlite.prepare("INSERT INTO events VALUES(?,?,?,?,?,?)").run(`audit-${index}`, "creative:owner", "job-1:attempt:1", "BudgetReleased", "{}", stamp);
  await assert.rejects(previewGenerationAccounting(f.env, actor, "job-1", now), error => error.code === "accounting_audit_evidence_limit");
  const missing = fixture(); missing.sqlite.exec("DROP TABLE budget_hold_dispositions");
  const before = missing.snapshot();
  const handler = createGenerationAccountingHandler(async () => ({ user: actor, response: null }));
  assert.equal((await handler(new Request("https://forma.invalid/api/admin/generation-accounting?jobId=job-1"), missing.env)).status, 503);
  assert.deepEqual(missing.snapshot(), before);
});

test("retained media observations are source-free and missing call history cannot be reported complete", async () => {
  const result = checkpoint();
  result.productionAnchor.costMicrousd = 80000;
  result.productionSceneReceipts = { "scene-003": { sceneId: "scene-003", providerJobId: "fal-video", status: "submitted", durationSeconds: 15, videoInputReceipt: { prompt: "PRIVATE_SCENE" } } };
  const preview = await previewGenerationAccounting(fixture({ result }).env, actor, "job-1", now);
  assert.equal(preview.retainedMedia[0].matchedCallId, "client-anchor");
  assert.equal(preview.retainedMedia[1].matchedCallId, "client-video");
  assert.equal(preview.retainedMedia[1].durationSeconds, 15);
  assert.doesNotMatch(JSON.stringify(preview.retainedMedia), /PRIVATE_|videoInputReceipt|mediaUrl/u);
  result.providerSubmissions["client-video"] = { ...result.providerSubmissions["client-video"], status: "completed", costMicrousd: 0 };
  result.generationReceipt.actual_provider_call_count = 4;
  const missing = await previewGenerationAccounting(fixture({ result }).env, actor, "job-1", now);
  assert.equal(missing.accounting.callHistoryComplete, false);
  assert.equal(missing.accounting.allCallsKnown, false);
  assert.equal(missing.accounting.totalReceiptCostMicrousd, null);
});

test("conflicting retained anchor cost and missing identity remain explicit unresolved history", async () => {
  const result = checkpoint(); result.productionAnchor.costMicrousd = 90000;
  const conflict = await previewGenerationAccounting(fixture({ result }).env, actor, "job-1", now);
  assert.equal(conflict.retainedMedia[0].accountingReason, "media_call_cost_conflict");
  assert.equal(conflict.accounting.callHistoryComplete, false);
  result.productionAnchor.providerJobId = "another-anchor";
  const missing = await previewGenerationAccounting(fixture({ result }).env, actor, "job-1", now);
  assert.equal(missing.retainedMedia[0].accountingReason, "media_call_receipt_missing");
});

test("oversized financial event fails closed without returning its source text", async () => {
  const f = fixture(); f.sqlite.prepare("UPDATE events SET payload=?").run(JSON.stringify({ private: "s".repeat(66000) }));
  await assert.rejects(previewGenerationAccounting(f.env, actor, "job-1", now), error => error.code === "accounting_retained_evidence_unavailable");
});

test("absent or null recorded call count never establishes complete accounting history", async () => {
  for (const count of [undefined, null]) {
    const result = checkpoint();
    result.providerSubmissions["client-video"].status = "completed";
    result.providerSubmissions["client-video"].costMicrousd = 0;
    if (count === undefined) delete result.generationReceipt.actual_provider_call_count;
    else result.generationReceipt.actual_provider_call_count = count;
    const preview = await previewGenerationAccounting(fixture({ result }).env, actor, "job-1", now);
    assert.equal(preview.accounting.callHistoryComplete, false);
    assert.equal(preview.accounting.callHistoryReason, "recorded_call_count_unavailable");
    assert.equal(preview.accounting.allCallsKnown, false);
    assert.equal(preview.accounting.totalReceiptCostMicrousd, null);
  }
});

test("every supplied media identity must agree; a known client ID cannot conceal a conflicting provider ID", async () => {
  const variants = [
    { providerSubmissionId: "client-anchor", providerJobId: "unknown-provider" },
    { providerSubmissionId: "unknown-client", providerJobId: "fal-anchor" },
    { providerSubmissionId: "client-anchor", providerJobId: "fal-video" },
  ];
  for (const variant of variants) {
    const result = checkpoint(); Object.assign(result.productionAnchor, variant);
    const preview = await previewGenerationAccounting(fixture({ result }).env, actor, "job-1", now);
    assert.equal(preview.retainedMedia[0].matchedCallId, null);
    assert.equal(preview.retainedMedia[0].accountingReason, "media_call_identity_conflict");
    assert.equal(preview.accounting.callHistoryComplete, false);
  }
});

test("anchor and scene receipts cannot borrow each other's provider operations", async () => {
  const result = checkpoint();
  Object.assign(result.productionAnchor, { providerSubmissionId: "client-video", providerJobId: "fal-video" });
  result.productionSceneReceipts = { "scene-003": { sceneId: "scene-003", providerSubmissionId: "client-anchor", providerJobId: "fal-anchor", status: "submitted", durationSeconds: 15 } };
  const preview = await previewGenerationAccounting(fixture({ result }).env, actor, "job-1", now);
  assert.equal(preview.retainedMedia[0].accountingReason, "media_call_operation_conflict");
  assert.equal(preview.retainedMedia[1].accountingReason, "media_call_operation_conflict");
  assert.equal(preview.accounting.callHistoryComplete, false);
});
