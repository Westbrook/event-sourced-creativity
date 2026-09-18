// B2 server-admission boundary: actual current form-built intake and routed
// Worker/RAM SQLite. Role edits below are explicit fixture setup, not a claim
// that a lower-role browser exposes the creation control. No provider runs.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import { AUTHORED, createProjectIntakeFixture, captureUnsentIntake, assertComplete } from "./helpers/project-intake-fixture.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";

const options = { concurrency: false, timeout: 45_000 };
const cookies = [
  { name: "absent", value: null },
  { name: "empty", value: "forma_project_context=" },
  // decodeURIComponent throws; the actual project-context reader returns "".
  { name: "malformed-percent", value: "forma_project_context=%E0%A4%A" },
];
const lowerRoles = ["viewer", "agent"];
const allowedRoles = ["creator", "admin"];
const rows = (x, table) => x.worker.sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all();
const optionalRows = (x, table) => x.worker.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
  ? rows(x, table) : null;
function snapshot(x) {
  return {
    events: rows(x, "events"),
    privatePayloads: rows(x, "event_private_payloads"),
    privateContent: rows(x, "private_content"),
    receipts: rows(x, "event_client_receipts"),
    resourceScopes: optionalRows(x, "project_resource_scopes"),
    retentionScopes: optionalRows(x, "private_content_retention_scopes"),
    financial: financial(x.worker),
    // Preserve the established helper and additionally cover the current table
    // name rather than relying on its legacy optional consequential_steps row.
    executionSteps: optionalRows(x, "consequential_execution_steps"),
  };
}
function assignFixtureRole(x, role) {
  assert.ok([...allowedRoles, ...lowerRoles].includes(role));
  const previous = x.worker.sqlite.prepare("SELECT role,updated_at FROM users WHERE user_id=?").get(x.worker.owner);
  assert.ok(previous);
  x.worker.sqlite.prepare("UPDATE users SET role=?,updated_at=? WHERE user_id=?")
    .run(role, new Date().toISOString(), x.worker.owner);
  assert.equal(x.worker.sqlite.prepare("SELECT role FROM users WHERE user_id=?").get(x.worker.owner).role, role);
  return () => x.worker.sqlite.prepare("UPDATE users SET role=?,updated_at=? WHERE user_id=?")
    .run(previous.role, previous.updated_at, x.worker.owner);
}
async function send(x, events, intakeAction, cookie = null) {
  const headers = { "content-type": "application/json", ...(cookie === null ? {} : { cookie }) };
  const response = await x.worker.request("/api/events", {
    method: "POST", headers, body: JSON.stringify({ action: "project_intake", intakeAction, events }),
  });
  return { response, body: await response.json() };
}
const complete = (events, result) => assertComplete({ body: { events }, status: result.response.status, reply: result.body });
function assertFiscal(before, after) {
  assert.deepEqual(after.financial, before.financial, "all existing job/reservation/counter/provider/execution rows are unchanged");
  assert.deepEqual(after.executionSteps, before.executionSteps, "current consequential execution-step table is unchanged");
}
function deny(t, before, after, result, detail) {
  assertFiscal(before, after);
  const disclosesAuthoredInput = Object.values(AUTHORED).some(value => JSON.stringify(result.body).includes(value));
  const observation = {
    ...detail, status: result.response.status, error: result.body.error ?? null,
    appended: Array.isArray(result.body.appended) ? result.body.appended.length : 0,
    eventsDelta: after.events.length - before.events.length,
    privatePayloadDelta: after.privatePayloads.length - before.privatePayloads.length,
    receiptDelta: after.receipts.length - before.receipts.length,
    protectedRowsUnchanged: isDeepStrictEqual(after, before), disclosesAuthoredInput,
  };
  t.diagnostic(JSON.stringify(observation));
  assert.deepEqual({
    status: result.response.status, appendedPresent: Object.hasOwn(result.body, "appended"),
    protectedRowsUnchanged: observation.protectedRowsUnchanged, disclosesAuthoredInput,
  }, { status: 403, appendedPresent: false, protectedRowsUnchanged: true, disclosesAuthoredInput: false },
  "a lower-role personal intake must be denied without creating or disclosing the private original");
}

for (const role of [...allowedRoles, ...lowerRoles]) for (const cookie of cookies) {
  test("B2 intake principal minimum survives context-cookie shape " + JSON.stringify({ role, cookie: cookie.name }),
    options, async t => {
      const x = await createProjectIntakeFixture(t), events = await captureUnsentIntake(x);
      const restore = assignFixtureRole(x, role);
      try {
        const before = snapshot(x), result = await send(x, events, "commit", cookie.value), after = snapshot(x);
        if (lowerRoles.includes(role)) {
          if (cookie.name === "absent") {
            assert.equal(result.body.error, "insufficient_role", "healthy normal route already requires creator");
            assert.equal(result.body.required, "creator"); assert.equal(result.body.role, role);
          }
          deny(t, before, after, result, { role, cookie: cookie.name, action: "commit" });
          return;
        }
        complete(events, result); assertFiscal(before, after);
        assert.equal(after.events.length - before.events.length, 4);
        assert.equal(after.privatePayloads.length - before.privatePayloads.length, 4);
        assert.equal(after.receipts.length - before.receipts.length, 4);
        assert.deepEqual(after.events.slice(0, before.events.length), before.events);
        assert.deepEqual(after.privatePayloads.slice(0, before.privatePayloads.length), before.privatePayloads);
        assert.deepEqual(after.privateContent, before.privateContent);
        assert.deepEqual(after.resourceScopes, before.resourceScopes);
        assert.deepEqual(after.retentionScopes, before.retentionScopes);
        const check = await send(x, events, "check", cookie.value);
        complete(events, check); assert.deepEqual(check.body.appended, result.body.appended);
        assert.deepEqual(snapshot(x), after, "authorized exact Check neither re-appends nor alters the original");
        t.diagnostic(JSON.stringify({ role, cookie: cookie.name, committed: result.response.status,
          checked: check.response.status, originalEvents: 4, originalReceipts: 4, exactSameOriginal: true }));
      } finally { restore(); }
    });
}

// Nonempty decoded invalid context is a distinct healthy refusal. Do not
// conflate a missing opaque selection with a decode error returning no context.
for (const role of lowerRoles) {
  test("B2 intake rejects a nonempty unissued context token " + role, options, async t => {
    const x = await createProjectIntakeFixture(t), events = await captureUnsentIntake(x);
    const restore = assignFixtureRole(x, role);
    try {
      const before = snapshot(x), result = await send(x, events, "commit", "forma_project_context=unissued-intake-context");
      assert.equal(result.body.error, "project_access_revoked");
      assert.ok(String(result.response.headers.get("set-cookie")).startsWith("forma_project_context=;"));
      deny(t, before, snapshot(x), result, { role, cookie: "nonempty-unissued", action: "commit" });
    } finally { restore(); }
  });
}

for (const role of lowerRoles) for (const cookie of cookies) {
  test("B2 exact original intake Check respects a later lower principal role " + JSON.stringify({ role, cookie: cookie.name }),
    options, async t => {
      const x = await createProjectIntakeFixture(t), events = await captureUnsentIntake(x);
      const restoreInitial = assignFixtureRole(x, "creator");
      try {
        const original = await send(x, events, "commit"); complete(events, original);
        const before = snapshot(x), restoreCreator = assignFixtureRole(x, role);
        let refused, after;
        try {
          refused = await send(x, events, "check", cookie.value);
          after = snapshot(x);
        } finally { restoreCreator(); }
        // A fresh currently authorized exact Check is a healthy control. It
        // must return the original, never reconstruct or replace it.
        const recovered = await send(x, events, "check"); complete(events, recovered);
        assert.deepEqual(recovered.body.appended, original.body.appended);
        assert.deepEqual(snapshot(x), before, "downgrade and restored-authority read leave every original record untouched");
        if (cookie.name === "absent") {
          assert.equal(refused.body.error, "insufficient_role"); assert.equal(refused.body.required, "creator");
        }
        deny(t, before, after, refused, { role, cookie: cookie.name, action: "check",
          originalWasCommitted: true, restoredCheck: recovered.response.status, exactSameOriginal: true });
      } finally { restoreInitial(); }
    });
}

// Existing SQL snapshot-role equality is a separate positive safety control:
// role changes after initial admission must still abort the whole append.
for (const role of lowerRoles) {
  test("B2 intake transaction still rejects a principal role downgrade " + role, options, async t => {
    const x = await createProjectIntakeFixture(t), events = await captureUnsentIntake(x);
    const restoreInitial = assignFixtureRole(x, "creator"), before = snapshot(x);
    let reached = false, restoreCreator = () => {};
    x.worker.controls.beforeBatch = async statements => {
      if (!reached && statements.some(statement => statement.sql.includes("VALUES(?,?,CASE WHEN")
          && statement.sql.includes("event_client_receipts"))) {
        reached = true; restoreCreator = assignFixtureRole(x, role);
      }
    };
    try {
      const result = await send(x, events, "commit");
      x.worker.controls.beforeBatch = null;
      assert.equal(reached, true); assert.equal(result.body.error, "project_intake_authority_changed");
      deny(t, before, snapshot(x), result, { role, cookie: "absent", action: "commit", atOriginalAppend: true });
    } finally { x.worker.controls.beforeBatch = null; restoreCreator(); restoreInitial(); }
  });
}
