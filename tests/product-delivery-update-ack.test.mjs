// Root's exact Worker interleave regression: one uncontested A, later different C,
// and later equal C. No UI, provider, production or D1 expression-depth claim.
// The helper and all three case bodies below are preserved from the root-executed
// d67853f6d7886ecadf16a69ee6ed530ce5982c463daa35fc7409966cd87e477f baseline.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";

const ENDPOINT = "/api/portfolio/product/delivery";
const observations = [];
const originalFetch = globalThis.fetch;
let providerAttempts = 0;
globalThis.fetch = async () => {
  providerAttempts += 1;
  throw new Error("Provider/network transport is forbidden in the Delivery update acknowledgment regression.");
};
// Permanent tests omit the TMP historical source hashes. The unchanged guard
// call at each case boundary now asserts the file's actual no-network boundary.
function guard(stage) {
  assert.equal(providerAttempts, 0, stage + ": no provider/network request");
}
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(providerAttempts, 0);
  assert.equal(observations.length, 3, "All three exact Worker cases produced their complete observation.");
});

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
const rows = (f, sql, ...args) => f.sqlite.prepare(sql).all(...args);
const decision = (f, id) => f.sqlite.prepare("SELECT * FROM delivery_decisions WHERE decision_id=?").get(id);
const updateEvents = f => rows(f, "SELECT * FROM events WHERE stream_id='platform:product-delivery' AND type='ProductDeliveryDecisionUpdated' ORDER BY sequence");
const createEvents = f => rows(f, "SELECT * FROM events WHERE stream_id='platform:product-delivery' AND type='ProductDeliveryDecisionCreated' ORDER BY sequence");
const receipts = f => rows(f, "SELECT * FROM event_client_receipts WHERE stream_id='platform:product-delivery' ORDER BY client_event_id");
const moneyTables = ["document_jobs", "budget_reservations", "budget_counters", "cost_budget_reservations",
  "cost_budget_counters", "output_provider_calls", "output_operation_slots", "consequential_executions", "consequential_steps"];
function finances(f) {
  return Object.fromEntries(moneyTables.map(table => [table,
    f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
      ? rows(f, 'SELECT * FROM "' + table + '" ORDER BY rowid') : null]));
}
function safeShape(row) {
  return { decisionId: row.decision_id, title: row.title, audience: row.audience, status: row.status,
    owner: row.owner_display_name, ownerUserId: row.owner_user_id, evidence: row.evidence,
    dependencyIds: JSON.parse(row.dependency_ids_json), createdAt: row.created_at, updatedAt: row.updated_at };
}
function assertFields(row, body) {
  assert.equal(row.decision_id, body.decisionId);
  assert.equal(row.title, body.title.trim());
  assert.equal(row.evidence, body.evidence.trim());
  assert.equal(row.owner_user_id, body.ownerUserId);
  assert.equal(row.status, body.status);
}

// This observes the original DB await in appendAuditEvent -> appendEvents.
// No Worker function, statement, row, authority decision, or response is replaced.
function holdOriginalAudit(f, id) {
  const gate = deferred(), entered = deferred();
  let captured = null, eligibleBatches = 0;
  const previous = f.controls.beforeBatch;
  assert.equal(previous, null, "Reuse the fixture's existing unused beforeBatch port.");
  f.controls.beforeBatch = async statements => {
    const exact = statements.some(statement =>
      /^INSERT INTO event_write_stage\b/u.test(statement.sql)
      && statement.values[1] === "platform:product-delivery"
      && statement.values[11] === "ProductDeliveryDecisionUpdated");
    if (!exact) return;
    eligibleBatches += 1;
    if (captured) return; // C and A's real contention retry must remain ordinary.
    const row = decision(f, id);
    assert.ok(row, "A's real decision exists before its audit batch.");
    captured = { row, statementCount: statements.length,
      stream: statements.find(statement => statement.values[11] === "ProductDeliveryDecisionUpdated").values[1] };
    entered.resolve(captured);
    await gate.promise; // This awaits the fixture's real DB.batch boundary.
  };
  return { entered: entered.promise, release: gate.resolve, captured: () => captured,
    batches: () => eligibleBatches, restore() { f.controls.beforeBatch = previous; } };
}

for (const mode of ["healthy", "C-different", "C-equal"]) {
  test("Product Delivery exact PATCH A reply with " + mode, { timeout: 20000, concurrency: false }, async t => {
    guard("CASE " + mode);
    const f = await createSceneCostFixture(1, "visual", { depth: false });
    t.after(() => f.close());
    const calls = [];
    const request = async (method, body) => {
      assert.ok(["GET", "POST", "PATCH"].includes(method));
      const init = { method, ...(body === undefined ? {} : {
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) };
      const call = { method, body: body === undefined ? null : JSON.parse(init.body) };
      calls.push(call);
      const response = await f.request(ENDPOINT, init);
      call.status = response.status;
      return response;
    };
    const seed = { requestId: crypto.randomUUID(), title: "Existing exact milestone",
      audience: "product", status: "planned", evidence: "Initial evidence", ownerUserId: f.owner, dependencyIds: [] };
    const created = await request("POST", seed);
    assert.equal(created.status, 201, await created.clone().text());
    const createdBody = await created.json();
    assert.ok(createdBody.decision?.decisionId, "The existing receipt-backed create returns its actual decision.");
    const id = createdBody.decision.decisionId, original = decision(f, id);
    assert.ok(original);
    const before = { money: finances(f), receipts: receipts(f), creates: createEvents(f),
      updateEvents: updateEvents(f).length, privateContent: rows(f, "SELECT * FROM private_content ORDER BY content_id") };
    const bodyA = { decisionId: id, title: "Update A", evidence: "Evidence A", ownerUserId: f.owner,
      status: "running", expectedUpdatedAt: original.updated_at };
    const boundary = holdOriginalAudit(f, id);
    const pendingA = request("PATCH", bodyA);
    let captured, readA, bodyC = null, responseC = null, replyC = null, responseA, replyA;
    try {
      captured = await Promise.race([boundary.entered,
        pendingA.then(() => { throw new Error("A returned before the intended real audit boundary."); })]);
      assertFields(captured.row, bodyA);
      assert.ok(Date.parse(captured.row.updated_at) > Date.parse(original.updated_at));
      assert.equal(updateEvents(f).length, before.updateEvents, "A's UPDATE is committed but its audit is not yet appended.");
      // A second current client obtains its real revision by the ordinary authorized report.
      // The healthy control also reads this same report; no timestamp is fabricated.
      const read = await request("GET");
      assert.equal(read.status, 200, await read.clone().text());
      const report = await read.json();
      readA = report.report?.decisions?.find(item => item.decisionId === id);
      assert.deepEqual(readA, safeShape(captured.row), "The exact current report exposes A's committed row.");
      if (mode !== "healthy") {
        bodyC = { ...bodyA, expectedUpdatedAt: readA.updatedAt,
          ...(mode === "C-different" ? { title: "Later current C", evidence: "Later evidence C" } : {}) };
        responseC = await request("PATCH", bodyC);
        assert.equal(responseC.status, 200, await responseC.clone().text());
        replyC = await responseC.json();
        assertFields(decision(f, id), bodyC);
        assert.equal(replyC.decision.updatedAt, decision(f, id).updated_at);
        assert.ok(Date.parse(replyC.decision.updatedAt) > Date.parse(captured.row.updated_at));
        assert.equal(updateEvents(f).length, before.updateEvents + 1, "C completes its own real audit while A is paused.");
      }
    } finally {
      boundary.release();
      // Settle the original request before dropping the DB hook or closing SQLite.
      // This is the already-started request, never a retry, replay or new mutation.
      responseA = await pendingA;
      replyA = await responseA.json();
      boundary.restore();
    }
    await f.drainBackground();
    assert.equal(responseA.status, 200);
    assert.deepEqual(finances(f), before.money, "No job, provider-accounting, reservation or spending change.");
    assert.deepEqual(receipts(f), before.receipts, "Original create receipts remain byte-equivalent.");
    assert.deepEqual(createEvents(f), before.creates, "Original create event remains byte-equivalent.");
    assert.deepEqual(rows(f, "SELECT * FROM private_content ORDER BY content_id"), before.privateContent,
      "No private original/source mutation.");
    assert.equal(calls.filter(call => call.method === "POST").length, 1, "Setup creates exactly one original.");
    assert.equal(calls.filter(call => call.method === "PATCH").length, mode === "healthy" ? 1 : 2,
      "Only deliberate A and, where requested, deliberate C writes.");
    assert.equal(updateEvents(f).length - before.updateEvents, mode === "healthy" ? 1 : 2);
    const final = decision(f, id);
    assertFields(final, bodyC ?? bodyA);
    assert.equal(final.updated_at, replyC?.decision.updatedAt ?? captured.row.updated_at,
      "A's later response does not write over C's canonical winner.");
    const expectedA = safeShape(captured.row);
    const observation = { mode, originalId: id, originalRevision: original.updated_at,
      submittedA: bodyA, actualCommittedA: expectedA, currentReadA: readA,
      submittedC: bodyC, responseC: responseC?.status ?? null, actualReplyC: replyC,
      responseA: responseA.status, actualReplyA: replyA, canonical: safeShape(final),
      exactAReply: JSON.stringify(replyA.decision) === JSON.stringify(expectedA),
      auditBatchesSeen: boundary.batches(),
      updateEvents: updateEvents(f).length - before.updateEvents,
      patchCalls: calls.filter(call => call.method === "PATCH").length,
      createReceiptsUnchanged: true, financialTablesUnchanged: moneyTables.length,
      privateContentUnchanged: true,
      providerBoundary: "Mandatory fail-on-unmocked-fetch preload; root must verify terminal output.",
      limits: "Actual routed Worker/SQLite; finite DB await pause; no browser, Delivery UI, physical client, production or whole-freeze claim." };
    observations.push(observation);
    console.log("DELIVERY_UPDATE_ACK_OBSERVATION " + JSON.stringify(observation));
    assert.deepEqual(replyA.decision, expectedA,
      "A's positive PATCH reply must identify A's exact successful UPDATE, not C's later mutable row.");
  });
}
