import assert from "node:assert/strict";
import test from "node:test";
import { registerScalingSourceImports } from "./output-read-model-test-helpers.mjs";
const hooks = registerScalingSourceImports();
const { outputReadModelFixture, outputReadModelOwner: owner, outputReadModelDocument: documentId, outputReadModelBase: base } = await import("./output-read-model-fixture.mjs");
const { handleOutputRequirements } = await import("../worker/output-requirements-api.ts");
const { outputDocumentExecutionBridge } = await import("../worker/output-document-execution.ts");
hooks.deregister();

async function fixture(context, { revokeBeforeCommit = false, failChildInsert = false } = {}) {
  context.mock.method(globalThis, "fetch", async () => { throw new Error("admission_source_order_network_forbidden"); });
  const f = await outputReadModelFixture(1, { grants: false, shared: true, pageSize: 1_000 });
  context.after(() => f.sqlite.close());
  Object.assign(f.env, { OPENAI_API_KEY: "transport-test-only", OPENAI_MODEL: "gpt-5.6-terra", OPENAI_IMAGE_MODEL: "gpt-image-2" });
  f.sqlite.exec("CREATE TABLE output_test_source_authority(id TEXT PRIMARY KEY, current INTEGER NOT NULL); INSERT INTO output_test_source_authority VALUES('source',1);");
  let preparedCalls = 0, sidecarCalls = 0, grantBatches = 0, mutation = 0;
  let capturedSourceAssertions = [];
  const sourceOnly = { sql: "EXISTS(SELECT 1 FROM output_test_source_authority WHERE id='source' AND current=1)", bindings: [] };
  const bridge = { ...outputDocumentExecutionBridge, async prepareAdmission(input) {
    preparedCalls++;
    assert.ok(input.governanceWitness, "the real API issues an opaque proof only after its final source read validates");
    const prepared = await outputDocumentExecutionBridge.prepareAdmission(input);
    assert.ok(prepared.sourceAssertions?.length, "the real bridge preserves every checked governance assertion");
    capturedSourceAssertions = prepared.sourceAssertions;
    const expectedHead = Number(f.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(`creative:${owner}`).n);
    const sourceHead = { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? /* admission-source-order */", bindings: [`creative:${owner}`, expectedHead] };
    return { ...prepared, sourceAssertions: [...prepared.sourceAssertions, sourceOnly, sourceHead], buildStatements(events) {
      sidecarCalls++;
      const native = prepared.buildStatements(events);
      const sourceProofs = new Set(prepared.sourceAssertions.map(value => JSON.stringify(value)));
      assert.ok(native.assertions.every(value => !sourceProofs.has(JSON.stringify(value))), "source proofs must not be rechecked after this transaction appends its own audit events");
      assert.ok(native.assertions.length > 0, "job and reservation assertions remain after their inserts");
      return native;
    } };
  } };
  const originalBatch = f.DB.batch.bind(f.DB);
  f.DB.batch = async statements => {
    if (statements.some(statement => /^INSERT INTO output_execution_grants/u.test(statement.sql))) {
      grantBatches++;
      const firstEvent = statements.findIndex(statement => /INSERT INTO event_write_stage/u.test(statement.sql));
      const lastEvent = statements.findLastIndex(statement => /INSERT INTO event_write_stage/u.test(statement.sql));
      assert.ok(firstEvent > 0 && lastEvent >= firstEvent);
      for (const assertion of [...capturedSourceAssertions, sourceOnly]) {
        const checks = statements.map((statement, index) => ({ statement, index })).filter(({ statement }) => statement.sql.includes(assertion.sql));
        assert.equal(checks.length, 1, "the complete captured source assertion is retained exactly once");
        assert.ok(checks[0].index < firstEvent, "source authority is checked before any event body is written");
      }
      assert.ok(statements.findIndex(statement => /admission-source-order/u.test(statement.sql)) < firstEvent);
      assert.ok(statements.findIndex(statement => /^INSERT INTO document_jobs/u.test(statement.sql)) > lastEvent);
      if (revokeBeforeCommit) f.sqlite.prepare("UPDATE output_test_source_authority SET current=0 WHERE id='source'").run();
    }
    return originalBatch(statements);
  };
  if (failChildInsert) f.sqlite.exec("CREATE TRIGGER output_test_reject_job BEFORE INSERT ON document_jobs BEGIN SELECT RAISE(ABORT,'injected_child_insert_failure'); END;");
  const request = (body) => handleOutputRequirements(new Request(`http://localhost${base}`, { method: "POST", headers: { "content-type": "application/json", ...f.requestHeaders }, body: JSON.stringify(body) }), f.env, base, { waitUntil() { throw new Error("unexpected_dispatch"); } }, bridge);
  const send = body => request({ documentId, expectedRevision: `output:${f.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(`creative:${owner}`).n}`, clientMutationId: `source-order-${++mutation}`, ...body });
  const preflight = await send({ action: "preflight", planRevisionId: f.plan.revisionId, targetIds: [f.plan.plan.targets[0].id] });
  assert.equal(preflight.status, 200, await preflight.clone().text());
  const offer = (await preflight.json()).command.preflight;
  assert.ok(offer.targets.every(target => target.available), JSON.stringify(offer));
  const body = { documentId, expectedRevision: `output:${f.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(`creative:${owner}`).n}`, clientMutationId: "source-order-authorize", action: "authorize", preflightId: offer.id, termsDigest: offer.termsDigest, maximumMicrousd: offer.maximumMicrousd, explicitAuthorization: true };
  return { ...f, request, body, counts: () => ({ preparedCalls, sidecarCalls, grantBatches }), offer };
}

function assertNoAdmission(f) {
  for (const table of ["document_jobs", "output_execution_grants", "output_operation_slots", "budget_reservations", "cost_budget_reservations"])
    assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  for (const [table, field] of [["budget_counters", "reserved_tokens"], ["cost_budget_counters", "reserved_microusd"]])
    assert.equal(f.sqlite.prepare(`SELECT COALESCE(SUM(${field}),0) AS n FROM ${table}`).get().n, 0, table);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type IN('OutputExecutionAuthorized','ProjectDocumentJobQueued')").get().n, 0);
}

test("native authorization checks complete captured source proofs before its own events, then checks all admitted resources", async context => {
  const f = await fixture(context);
  const response = await f.request(f.body);
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.deepEqual(f.counts(), { preparedCalls: 1, sidecarCalls: 1, grantBatches: 1 });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs WHERE status='queued'").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_operation_slots WHERE status='authorized'").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT SUM(reserved_microusd) AS n FROM cost_budget_reservations WHERE status='active'").get().n, f.offer.maximumMicrousd);
  const replay = await f.request(f.body);
  assert.equal(replay.status, 200, await replay.clone().text());
  const replayed = await replay.json();
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.command.grantId, result.command.grantId);
  assert.deepEqual(f.counts(), { preparedCalls: 1, sidecarCalls: 1, grantBatches: 1 });
});

test("a captured source precondition revoked after preparation rolls back the whole native admission", async context => {
  const f = await fixture(context, { revokeBeforeCommit: true });
  const response = await f.request(f.body);
  assert.equal(response.status, 409, await response.clone().text());
  assert.deepEqual(f.counts(), { preparedCalls: 1, sidecarCalls: 1, grantBatches: 1 });
  assertNoAdmission(f);
});

test("moving source assertions before native events does not weaken atomic rollback when a child insert fails", async context => {
  const f = await fixture(context, { failChildInsert: true });
  const response = await f.request(f.body);
  assert.ok(response.status >= 400, await response.clone().text());
  assert.deepEqual(f.counts(), { preparedCalls: 1, sidecarCalls: 1, grantBatches: 1 });
  assertNoAdmission(f);
});
