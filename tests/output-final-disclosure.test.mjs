import assert from "node:assert/strict";
import test from "node:test";
import { outputReadModelFixture } from "./output-read-model-fixture.mjs";
import { instrumentD1Contract } from "./output-d1-test-contract.mjs";
import { enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
const hooks = registerOutputSourceImports();
const { default: worker } = await import("../worker/index.ts");
const { appendAuditEvent } = await import("../worker/runtime.ts");
const { OutputRequirementsClient } = await import("../src/state/output-requirements-client.ts");
hooks.deregister();

const BASE = "/api/output-requirements";
const post = body => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const tables = ["document_jobs", "output_execution_grants", "output_operation_slots", "output_operation_routes", "output_provider_calls",
  "budget_reservations", "budget_counters", "cost_budget_reservations", "cost_budget_counters"];
const financial = f => Object.fromEntries(tables.map(table => [table, f.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all().map(row => ({ ...row }))]));
const originalFetch = globalThis.fetch;
let networkCalls = 0;
test.before(() => { globalThis.fetch = async () => { networkCalls++; throw new Error("output_disclosure_tests_never_call_network"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0); });

async function fixture(t, options = {}) {
  const f = await outputReadModelFixture(options.count ?? 2, { shared: options.shared ?? false, grants: options.grants ?? true, ...options });
  const pending = [], requests = [];
  f.request = async (path = BASE + "?documentId=" + f.scope.documentId, init = {}) => {
    f.counters.reset();
    const response = await worker.fetch(new Request("http://localhost" + path, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers ?? {})), ...f.requestHeaders } }),
      f.env, { waitUntil(promise) { pending.push(promise); } });
    while (pending.length) await Promise.all(pending.splice(0));
    requests.push({ status: response.status, d1: f.counters.db, media: f.counters.r2List + f.counters.r2Head + f.counters.r2Get, total: f.counters.total });
    return response;
  };
  assert.equal((await f.request()).status, 200, "the original actual Worker read is live");
  const d1 = instrumentD1Contract(f), depth = enforceD1ExpressionDepth(f);
  f.native = { d1, depth, requests };
  f.commandBody = (action, extra = {}) => ({ documentId: f.scope.documentId, action,
    expectedRevision: "output:" + f.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get("creative:" + f.scope.ownerUserId).head,
    clientMutationId: "disclosure-" + action + "-" + (requests.length + 1), ...extra });
  t.after(async () => {
    while (pending.length) await Promise.all(pending.splice(0));
    depth.assertVerified(); assert.deepEqual(d1.violations, []);
    assert.ok(d1.maximumBindings <= 100); assert.ok(d1.maximumSqlBytes <= 100_000); assert.ok(d1.maximumFunctionArguments <= 32);
    for (const request of requests) assert.ok(request.total <= 50, JSON.stringify(request));
    t.diagnostic(JSON.stringify({ nativeDepth: 100, queryShapes: depth.records.length, maximumBindings: d1.maximumBindings,
      maximumSqlBytes: d1.maximumSqlBytes, maximumRowBytes: d1.maximumRowBytes, maximumBindingCalls: Math.max(...requests.map(request => request.total)) }));
    depth.restore(); f.sqlite.close();
  });
  return f;
}

function planEvent(f) { return f.sqlite.prepare("SELECT confirmed_event_id FROM output_plan_revisions WHERE scope_key=? AND plan_revision_id=?").get(f.scope.key, f.plan.revisionId).confirmed_event_id; }
function exactCommand(f, body) { return f.sqlite.prepare("SELECT * FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=?").get(f.scope.key, f.scope.actorUserId, body.clientMutationId); }
function armInventory(f, change) {
  const media = f.env.MEDIA, original = media.list.bind(media);
  let count = 0;
  media.list = async options => {
    const result = await original(options);
    if (!count) { count++; await change(); }
    return result;
  };
  return () => assert.equal(count, 1, "the mutation happened after the retained private read, during actual MEDIA inventory");
}
function armFinalRead(f, { before, after } = {}) {
  const db = f.env.DB; let count = 0;
  f.env.DB = new Proxy(db, { get(target, key) {
    if (key === "batch") return async statements => {
      const final = statements.some(statement => String(statement.sql ?? statement.original?.sql ?? "").includes("LEFT JOIN output_plan_revisions current"));
      if (final && !count) { count++; await before?.(); }
      const result = await target.batch(statements);
      if (final && count === 1) { count++; after?.(); }
      return result;
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  return () => assert.equal(count, 2, "the exact final disclosure batch ran after all earlier reads");
}
async function denied(response, status, { committed, replayed } = {}) {
  assert.equal(response.status, status, "current Output response must withhold private content at the specified boundary");
  assert.match(response.headers.get("cache-control"), /no-store/u);
  const body = await response.json();
  if (!committed) {
    assert.equal(body.snapshot, undefined); assert.equal(body.confirmedPlan, undefined); assert.equal(body.command, undefined); assert.equal(body.receipt, undefined);
    assert.deepEqual(Object.keys(body).sort(), ["error", "errorCode", "errorValues"]);
  } else {
    assert.deepEqual(Object.keys(body).sort(), ["appended", "command", "error", "errorCode", "ok", "privateUnavailable", "receipt", "replayed", "snapshot"]);
    assert.equal(body.ok, true); assert.equal(body.replayed, replayed); assert.equal(body.privateUnavailable, true);
    assert.equal(body.snapshot, null); assert.deepEqual(body.appended, []);
    assert.deepEqual(body.command, { action: committed.action, eventId: committed.event_id });
    assert.deepEqual(body.receipt, { committed: true, clientMutationId: committed.command_key, action: committed.action, eventId: committed.event_id });
    const code = status === 401 || status === 403 ? "output_execution_authority_revoked" : "output_private_evidence_unavailable";
    assert.equal(body.error, code); assert.equal(body.errorCode, code);
  }
  return body;
}

for (const shared of [false, true]) test("Output final disclosure: current actual GET keeps the full assignment and exact financial observations / shared=" + shared, async t => {
  const f = await fixture(t, { shared }), before = financial(f);
  const response = await f.request(), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.confirmedPlan.plan.targets.length, 2); assert.equal(body.grants.length, 1);
  assert.equal(body.grants[0].usedMicrousd, 400); assert.equal(body.grants[0].exposedMicrousd, 1000); assert.equal(body.grants[0].pendingCalls, 1);
  assert.equal("assertions" in body, false); assert.equal("deadlineMs" in body, false);
  assert.deepEqual(financial(f), before);
});

for (const shared of [false, true]) for (const change of ["redacted", "erased", "changed", "project-custody", "document-custody", "owner-custody", "plan-row"]) {
  test("Output final disclosure: actual GET refuses " + change + " after inventory / shared=" + shared, async t => {
    const f = await fixture(t, { shared }), before = financial(f), eventId = planEvent(f);
    const fired = armInventory(f, () => {
      if (change === "redacted") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), eventId);
      else if (change === "erased") f.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(eventId);
      else if (change === "changed") f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.confirmed_plan.plan.targets[0].label','Changed retained private label') WHERE private_event_id=?").run(eventId);
      else if (change === "project-custody") f.sqlite.prepare("UPDATE event_private_payloads SET project_id='different-project' WHERE private_event_id=?").run(eventId);
      else if (change === "document-custody") f.sqlite.prepare("UPDATE event_private_payloads SET document_id='different-document' WHERE private_event_id=?").run(eventId);
      else if (change === "owner-custody") f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='different-owner' WHERE private_event_id=?").run(eventId);
      else f.sqlite.prepare("UPDATE output_plan_revisions SET source_digest='different-current-source' WHERE confirmed_event_id=?").run(eventId);
    });
    await denied(await f.request(), 410); fired(); assert.deepEqual(financial(f), before);
  });
}

for (const boundary of ["inventory", "final-read"]) test("Output final disclosure: actual shared GET rechecks selected-session revocation at " + boundary, async t => {
  const f = await fixture(t, { shared: true }), before = financial(f);
  const change = () => f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), f.contextId);
  const fired = boundary === "inventory" ? armInventory(f, change) : armFinalRead(f, { before: change });
  await denied(await f.request(), 403); fired(); assert.deepEqual(financial(f), before);
});

for (const shared of [false, true]) test("Output final disclosure: exact private proof is evaluated at the final SQL boundary / shared=" + shared, async t => {
  const f = await fixture(t, { shared }), before = financial(f);
  const fired = armFinalRead(f, { before: () => f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), planEvent(f)) });
  await denied(await f.request(), 410); fired(); assert.deepEqual(financial(f), before);
});

for (const shared of [false, true]) test("Output final disclosure: an unrelated later source event cannot validate an older response / shared=" + shared, async t => {
  const f = await fixture(t, { shared }), before = financial(f);
  const fired = armInventory(f, () => appendAuditEvent(f.env, "creative:" + f.scope.ownerUserId, "user", "BlockPropertyEdited",
    { project_id: f.scope.projectId, document_id: f.scope.documentId, block_id: "source", property_path: "text", new_value: "Current source requires a fresh read." }));
  await denied(await f.request(), 409); fired(); assert.deepEqual(financial(f), before);
});

for (const shared of [false, true]) for (const replayed of [false, true]) for (const change of ["unchanged", "command-redacted", "command-changed", "command-custody", "plan-redacted", ...(shared ? ["session-revoked"] : [])]) {
  test("Output final disclosure: " + (replayed ? "replayed" : "fresh") + " command " + change + " / shared=" + shared, async t => {
    const f = await fixture(t, { shared, grants: false });
    const command = f.commandBody("preflight", { planRevisionId: f.plan.revisionId, targetIds: [f.plan.plan.targets[0].id] });
    if (replayed) { const initial = await f.request(BASE, post(command)); assert.equal(initial.status, 200, await initial.clone().text()); }
    const before = financial(f); let retained;
    const fired = armInventory(f, () => {
      retained = exactCommand(f, command); assert.ok(retained, "the canonical command committed before the disclosure boundary");
      if (change === "command-redacted") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), retained.event_id);
      else if (change === "command-changed") f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.preflight.targets[0].transferDescription','Different retained private provider disclosure') WHERE private_event_id=?").run(retained.event_id);
      else if (change === "command-custody") f.sqlite.prepare("UPDATE event_private_payloads SET project_id='different-project' WHERE private_event_id=?").run(retained.event_id);
      else if (change === "plan-redacted") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), planEvent(f));
      else if (change === "session-revoked") f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), f.contextId);
    });
    const response = await f.request(BASE, post(command)); fired(); assert.ok(retained);
    if (change === "unchanged") {
      const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.replayed, replayed);
      assert.ok(body.command.preflight); assert.equal(body.command.eventId, retained.event_id);
      assert.equal("requestDigest" in body.command, false); assert.equal("assertions" in body.snapshot, false);
    } else {
      await denied(response, change === "session-revoked" ? 403 : 410, { committed: retained, replayed });
      assert.deepEqual(exactCommand(f, command), retained, "withholding private details does not replace, roll back, or recreate the original command");
    }
    assert.deepEqual(financial(f), before);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=?").get(f.scope.key, f.scope.actorUserId, command.clientMutationId).n, 1);
  });
}

for (const lifetime of ["session", "license"]) for (const cross of [false, true]) test("Output final disclosure: synchronous " + lifetime + " expiry after the last awaited proof / cross=" + cross, async t => {
  const f = await fixture(t, { shared: lifetime === "session" }), RealDate = globalThis.Date, deadline = RealDate.now() + 60_000;
  let offset = 0;
  if (lifetime === "session") f.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE context_id=?").run(new RealDate(deadline).toISOString(), f.contextId);
  else await appendAuditEvent(f.env, "creative:" + f.scope.ownerUserId, "user", "BlockPropertyEdited",
    { project_id: f.scope.projectId, document_id: f.scope.documentId, block_id: "source", property_path: "license_expires_at", new_value: new RealDate(deadline).toISOString() });
  const before = financial(f);
  t.mock.property(globalThis, "Date", class extends RealDate { constructor(...values) { super(...(values.length ? values : [RealDate.now() + offset])); } static now() { return RealDate.now() + offset; } });
  const fired = armFinalRead(f, { after: () => { assert.ok(Date.now() < deadline, "SQL executed while the selected proof was live"); if (cross) queueMicrotask(() => { offset = deadline - RealDate.now() + 1; }); } });
  const response = await f.request(); fired();
  if (cross) await denied(response, lifetime === "session" ? 403 : 410);
  else { const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.confirmedPlan.plan.targets.length, 2); }
  assert.deepEqual(financial(f), before);
});

test("Output final disclosure: canonical receipt mismatch never manufactures an acknowledgement", async t => {
  const f = await fixture(t, { grants: false }), command = f.commandBody("preflight", { planRevisionId: f.plan.revisionId, targetIds: [f.plan.plan.targets[0].id] });
  assert.equal((await f.request(BASE, post(command))).status, 200);
  const before = financial(f);
  const fired = armInventory(f, () => {
    const receipt = exactCommand(f, command);
    f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), receipt.event_id);
    f.sqlite.prepare("UPDATE output_commands SET request_digest='different-digest' WHERE scope_key=? AND actor_user_id=? AND command_key=?").run(f.scope.key, f.scope.actorUserId, command.clientMutationId);
  });
  await denied(await f.request(BASE, post(command)), 410); fired(); assert.deepEqual(financial(f), before);
});

async function prepareNativeAuthorization(f) {
  Object.assign(f.env, { OPENAI_API_KEY: "mock-output-disclosure-no-network", OPENAI_MODEL: "gpt-5.6-terra", OPENAI_IMAGE_MODEL: "gpt-image-2" });
  const request = f.commandBody("preflight", { planRevisionId: f.plan.revisionId, targetIds: [f.plan.plan.targets[0].id] });
  const response = await f.request(BASE, post(request)), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.command.preflight.targets[0].available, true);
  const quote = body.command.preflight;
  return f.commandBody("authorize", { preflightId: quote.id, termsDigest: quote.termsDigest, maximumMicrousd: quote.maximumMicrousd, explicitAuthorization: true });
}

for (const shared of [false, true]) for (const phase of ["GET", "fresh-commit"]) for (const change of ["plan-redacted", ...(shared ? ["session-revoked"] : [])]) {
  test("Output final disclosure: real original queued job and held budgets survive " + phase + "/" + change + "/shared=" + shared, async t => {
    const f = await fixture(t, { shared, grants: false, count: 1 }), authorization = await prepareNativeAuthorization(f);
    if (phase === "GET") {
      const response = await f.request(BASE, post(authorization)); assert.equal(response.status, 200, await response.clone().text());
    }
    let retained, before;
    const fired = armInventory(f, () => {
      retained = exactCommand(f, authorization); assert.ok(retained);
      before = financial(f);
      assert.equal(before.document_jobs.length, 1); assert.equal(before.document_jobs[0].status, "queued");
      assert.equal(before.cost_budget_reservations.length, 1); assert.equal(before.cost_budget_reservations[0].status, "active");
      assert.equal(before.cost_budget_reservations[0].reserved_microusd, authorization.maximumMicrousd);
      assert.equal(before.cost_budget_reservations[0].used_microusd, 0);
      assert.equal(before.budget_reservations[0].status, "active"); assert.ok(before.budget_reservations[0].reserved_tokens > 0);
      if (change === "plan-redacted") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), planEvent(f));
      else f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), f.contextId);
    });
    const response = phase === "GET" ? await f.request() : await f.request(BASE, post(authorization)); fired();
    await denied(response, change === "session-revoked" ? 403 : 410, phase === "GET" ? {} : { committed: retained, replayed: false });
    assert.deepEqual(financial(f), before, "no background retry, reservation release, reconciliation, new job or financial rewrite");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_provider_calls").get().n, 0);
    assert.deepEqual(exactCommand(f, authorization), retained);
  });
}

for (const shared of [false, true]) test("Output final disclosure: 1000 targets and three retained plan revisions remain complete, not source-proof capacity / shared=" + shared, async t => {
  const f = await fixture(t, { shared, grants: false, count: 1000 }), before = financial(f);
  const original = await (await f.request()).json(), revisions = [original.confirmedPlan.revisionId];
  for (let count = 0; count < 2; count++) {
    const response = await f.request(BASE, post(f.commandBody("confirm"))), body = await response.json();
    assert.equal(response.status, 200, JSON.stringify({ error: body.error, privateUnavailable: body.privateUnavailable }));
    assert.equal(body.snapshot.confirmedPlan.plan.targets.length, 1000);
    assert.equal(body.snapshot.sourceRevision, original.sourceRevision, "Output history is not creative source facts or source-hash input");
    assert.equal(body.snapshot.sourceVerification.status, "verified");
    assert.equal(body.snapshot.sourceVerification.capacity.referenceCount, 0);
    assert.equal(body.snapshot.sourceVerification.capacity.distinctObjectCount, 0);
    assert.equal(body.snapshot.permissions.canAuthor, true, "legitimate complete reads are not narrowed by a false 1MB proof cap");
    revisions.push(body.snapshot.confirmedPlan.revisionId);
  }
  assert.equal(new Set(revisions).size, 3); assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_plan_revisions WHERE scope_key=?").get(f.scope.key).n, 3);
  assert.deepEqual(financial(f), before); assert.ok(f.native.d1.maximumRowBytes > 1_000_000, "the real full-size retained plan is exercised, not a small substitute");
});

for (const lifetime of ["session", "license"]) for (const cross of [false, true]) test("Output final disclosure: complete JSON encoding precedes the last " + lifetime + " deadline check / cross=" + cross, async t => {
  const f = await fixture(t, { shared: lifetime === "session" }), RealDate = globalThis.Date, deadline = RealDate.now() + 60_000;
  let offset = 0, finalProof = false, encodings = 0;
  if (lifetime === "session") f.sqlite.prepare("UPDATE project_context_sessions SET expires_at=? WHERE context_id=?").run(new RealDate(deadline).toISOString(), f.contextId);
  else await appendAuditEvent(f.env, "creative:" + f.scope.ownerUserId, "user", "BlockPropertyEdited",
    { project_id: f.scope.projectId, document_id: f.scope.documentId, block_id: "source", property_path: "license_expires_at", new_value: new RealDate(deadline).toISOString() });
  const before = financial(f), stringify = JSON.stringify;
  t.mock.property(globalThis, "Date", class extends RealDate { constructor(...values) { super(...(values.length ? values : [RealDate.now() + offset])); } static now() { return RealDate.now() + offset; } });
  const fired = armFinalRead(f, { after: () => { assert.ok(Date.now() < deadline); finalProof = true; } });
  t.mock.method(JSON, "stringify", function(value, ...args) {
    const encoded = Reflect.apply(stringify, JSON, [value, ...args]);
    if (finalProof && value?.documentId === f.scope.documentId && value?.confirmedPlan?.plan?.targets) {
      encodings++; assert.ok(Date.now() < deadline, "the final SQL proof was live before response encoding");
      if (cross) offset = deadline - RealDate.now() + 1;
    }
    return encoded;
  });
  const response = await f.request(); fired(); assert.equal(encodings, 1);
  if (cross) await denied(response, lifetime === "session" ? 403 : 410);
  else { const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.confirmedPlan.plan.targets.length, 2); }
  assert.deepEqual(financial(f), before);
});

for (const shared of [false, true]) for (const replayed of [false, true]) for (const change of ["plan-redacted", ...(shared ? ["session-revoked"] : [])]) {
  test("Output final disclosure: actual client consumes the exact server withheld receipt / " + change + "/replayed=" + replayed + "/shared=" + shared, async t => {
    const f = await fixture(t, { shared, grants: false }), captured = { key: f.scope.key + ":client", projectId: f.scope.projectId };
    let client, writes = 0, checkedHeaders = 0;
    client = new OutputRequirementsClient({
      captureScope: () => captured, scopeActive: scope => scope === captured, notify() {},
      isSnapshot: (value, documentId, scope) => Boolean(value && value.documentId === documentId && value.projectId === scope.projectId && typeof value.revision === "string"),
      fetch: async (path, init) => {
        if (init?.method === "POST") writes++;
        const response = await f.request(String(path), init);
        if (response.status === 403 || response.status === 410) {
          const original = response.json.bind(response);
          response.json = async () => {
            checkedHeaders++; assert.equal(client.resource(f.scope.documentId).snapshot, null, "the real client retires private bytes from headers before parsing the receipt");
            return original();
          };
        }
        return response;
      },
    });
    assert.equal((await client.ensure(f.scope.documentId)).state, "ready");
    const command = f.commandBody("preflight", { planRevisionId: f.plan.revisionId, targetIds: [f.plan.plan.targets[0].id] });
    if (replayed) assert.equal((await client.command(f.scope.documentId, command, "review original requirements")).status, "saved");
    const before = financial(f), previousWrites = writes;
    const fired = armInventory(f, () => {
      assert.ok(exactCommand(f, command));
      if (change === "plan-redacted") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), planEvent(f));
      else f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), f.contextId);
    });
    const result = await client.command(f.scope.documentId, command, "review original requirements"), retained = exactCommand(f, command);
    fired(); assert.equal(checkedHeaders, 1); assert.equal(writes, previousWrites + 1, "one original request, never an automatic retry");
    assert.equal(result.status, change === "session-revoked" ? "forbidden" : "saved");
    assert.equal(result.body, null); assert.equal(result.privateUnavailable, true);
    assert.deepEqual(result.receipt, { committed: true, clientMutationId: command.clientMutationId, action: command.action, eventId: retained.event_id });
    assert.equal(client.resource(f.scope.documentId).snapshot, null); assert.equal(client.resource(f.scope.documentId).privateUnavailable, true);
    assert.deepEqual(financial(f), before); assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE scope_key=? AND command_key=?").get(f.scope.key, command.clientMutationId).n, 1);
  });
}

for (const shared of [false, true]) for (const change of ["unchanged", "owner_user_id", "storage_key", "source_digest", "created_by_user_id"]) {
  test("Output final disclosure: standalone exact asset pins its original " + change + " after MEDIA read / shared=" + shared, async t => {
    const f = await fixture(t, { shared }), asset = f.assets[0], before = financial(f), originalGet = f.env.MEDIA.get.bind(f.env.MEDIA);
    let reads = 0;
    f.env.MEDIA.get = async (...args) => {
      const object = await originalGet(...args);
      if (!reads++) {
        if (change !== "unchanged") f.sqlite.prepare("UPDATE output_assets SET " + change + "=? WHERE scope_key=? AND asset_id=?").run("different-" + change, f.scope.key, asset.id);
      }
      return object;
    };
    const response = await f.request(BASE + "/assets/" + asset.id + "?documentId=" + f.scope.documentId);
    assert.equal(reads, 1, "standalone disclosure reuses the original exact object, not a whole-inventory read");
    if (change === "unchanged") {
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get("x-output-sha256"), asset.inspection.sha256);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), f.media.get(asset.key).bytes);
    } else {
      const body = await denied(response, 410); assert.equal(body.errorCode, "output_private_evidence_unavailable");
      assert.notEqual(response.headers.get("content-type"), asset.inspection.mimeType);
    }
    assert.deepEqual(financial(f), before);
  });
}
