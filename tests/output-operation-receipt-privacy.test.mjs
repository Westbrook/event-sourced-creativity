import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { controllerFixture, eventHandlers } from "./output-ui-source-harness.mjs";
import { outputOperationSupportReceipt } from "../src/components/output-operation-support-receipt.ts";

// Reuse the original eleven receipt fixtures and actual Store/client field.
// Only test registration is omitted; production methods and HTTP parsing stay real.
async function fixtureDeclarations(file, names, namespace) {
  const url = new URL(file, import.meta.url), raw = readFileSync(url, "utf8");
  const tree = ts.createSourceFile(url.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
    || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
    || ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree).startsWith("assert."))
    .map(node => node.getText(tree)).join("\n") + "\nexport { " + names.join(",") + " };";
  url.search = "?" + namespace;
  const hooks = registerHooks({ load(request, context, nextLoad) {
    return request === url.href ? { format: "module", source, shortCircuit: true } : nextLoad(request, context);
  } });
  try { return await import(url.href); } finally { hooks.deregister(); }
}
const receiptFixture = await fixtureDeclarations("./output-operation-receipt-store.test.mjs", ["fixture", "body", "response", "job", "deferred"], "receipt-privacy-r2-fixture");
let waitForOriginalDispatch = () => new Promise(resolve => setImmediate(resolve));
const tick = () => waitForOriginalDispatch();
const privateText = "PRIVATE_RECEIPT_SOURCE_NOT_AN_ACCOUNTING_RECORD";
function bodyGate(status = 200) {
  let controller, finished = false;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  return {
    response: new Response(stream, { status, headers: { "content-type": "application/json" } }),
    finish(value) { if (finished) return; finished = true; controller.enqueue(new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value))); controller.close(); },
    fail() { if (finished) return; finished = true; controller.error(new Error("test body transport failed")); },
  };
}
const originalFetch = globalThis.fetch;
let providerCalls = 0;
test.before(() => { globalThis.fetch = async () => { providerCalls++; throw new Error("receipt_privacy_network_forbidden"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(providerCalls, 0); });

async function fullFixture() {
  const f = await receiptFixture.fixture(), client = f.store.outputRequirements;
  const privateSnapshot = structuredClone(f.resource.snapshot);
  privateSnapshot.requirements[0].content = privateText;
  privateSnapshot.requirements[0].spec.original_text = privateText;
  privateSnapshot.scope.kind = "personal";
  const accounting = { usedMicrousd: 0, exposedMicrousd: 500000, maximumMicrousd: 500000, usedCalls: 0, pendingCalls: 1, maximumCalls: 1 };
  Object.assign(privateSnapshot.grants[0], accounting, { status: "active" });
  Object.assign(privateSnapshot.grants[0].operations[0], accounting);
  f.enqueueRead(Response.json(privateSnapshot)); await client.ensure("doc", { force: true });
  f.resource = client.resource("doc");
  f.effects.jobs = [{ ...receiptFixture.job(), result: { artifactKind: "slides", outputGrantId: "grant", outputSlotId: "slot" } }];
  const heldJob = structuredClone(f.effects.jobs), technical = outputOperationSupportReceipt(f.resource.snapshot, "grant", "slot", f.effects.jobs);
  assert.ok(technical); assert.ok(!technical.includes(privateText));
  const parsedReceipt = JSON.parse(technical);
  assert.equal(parsedReceipt.operation.accounting.unresolvedExposure, 500000);
  assert.equal(parsedReceipt.operation.accounting.unresolvedCalls, 1);
  const operations = [];
  const port = { ...f.store, reconcileOutputOperationReceipt: (...args) => {
    const promise = f.store.reconcileOutputOperationReceipt(...args); operations.push(promise); return promise;
  } };
  const host = await controllerFixture(port);
  host.controller.documentId = "doc"; host.controller.willUpdate(new Map());
  f.state.onNotify = () => host.controller.willUpdate(new Map());
  const render = () => { host.controller.willUpdate(new Map()); return JSON.stringify(host.controller.render()); };
  assert.ok(render().includes(privateText), "the initial private text is actually rendered");
  const startUI = () => {
    const action = eventHandlers(host.controller.render(), "click").find(value => value.toString().includes("#checkOperationReceipt"));
    assert.ok(action, "the actual original receipt control remains reachable");
    return action();
  };
  return { ...f, client, host, operations, heldJob, technical, privateSnapshot, initialReads: f.effects.reads.length, render, startUI };
}
function hidden(f, status) {
  const resource = f.client.resource("doc");
  assert.equal(resource.snapshot, null);
  assert.equal(resource.privateUnavailable, true);
  assert.equal(resource.accessLost, status !== 410, "retained evidence loss is not project access loss");
  assert.ok(!JSON.stringify(resource).includes(privateText));
  assert.ok(!f.render().includes(privateText), "actual full controller hides denied private source");
  assert.deepEqual(f.effects.jobs, f.heldJob, "receipt denial cannot release, replace or rewrite existing job/accounting evidence");
  assert.equal(JSON.parse(f.technical).operation.accounting.unresolvedCalls, 1);
}
async function refresh(f, revision, options = {}) {
  const next = { ...structuredClone(f.privateSnapshot), ...options, revision };
  f.enqueueRead(Response.json(next));
  return f.client.ensure("doc", { force: true });
}

for (const status of [401, 403, 404, 410]) for (const completion of ["pending", "valid", "malformed", "body-error"])
  test("actual controller→Store→client receipt " + status + " retires at headers before " + completion + " body", async () => {
    const f = await fullFixture(), gate = bodyGate(status), ui = f.startUI();
    f.request.resolve(gate.response);
    try {
      await tick(); hidden(f, status);
      assert.equal(gate.response.bodyUsed, false, "receipt denial does not need an error body");
      assert.equal(f.effects.reads.length, f.initialReads, "denial does not silently request a replacement read");
      const outcome = await f.operations[0];
      assert.equal(outcome.status, status === 410 ? "unavailable" : "forbidden");
      assert.equal(f.effects.requests.length, 1);
    } finally {
      if (completion === "body-error") gate.fail();
      else gate.finish(completion === "malformed" ? privateText : { error: "denied", message: privateText });
      await ui;
    }
    hidden(f, status);
  });

for (const status of [401, 403, 404, 410]) test("receipt " + status + " stays private through an explicit failed GET, then only a current exact 200 restores it", async () => {
  const f = await fullFixture(), pending = f.start();
  f.request.resolve(Response.json({ error: "denied", message: privateText }, { status }));
  await pending; hidden(f, status);
  f.enqueueRead(Response.json({ error: "service_unavailable", message: privateText }, { status: 500 }));
  await f.client.ensure("doc", { force: true }); hidden(f, status);
  await refresh(f, "recovered-current");
  assert.equal(f.client.resource("doc").state, "ready");
  assert.equal(f.client.resource("doc").snapshot.revision, "recovered-current");
  assert.notEqual(f.client.resource("doc").privateUnavailable, true);
  assert.ok(f.render().includes(privateText));
  assert.equal(f.effects.requests.length, 1); assert.equal(f.effects.reads.length, f.initialReads + 2);
});

for (const status of [401, 403, 404, 410]) test("newer valid Output snapshot defeats an older receipt " + status + " denial", async () => {
  const f = await fullFixture(), pending = f.start();
  await refresh(f, "newer-authorized");
  const notifications = f.effects.notifications;
  let parsed = 0;
  f.request.resolve({ status, ok: false, json: async () => { parsed++; return { error: "denied", message: privateText }; } });
  await pending;
  assert.equal(parsed, 0);
  assert.equal(f.client.resource("doc").snapshot.revision, "newer-authorized");
  assert.ok(f.render().includes(privateText));
  assert.equal(f.effects.notifications, notifications);
  assert.deepEqual(f.effects.jobs, f.heldJob);
});

for (const status of [401, 403, 404, 410]) test("newer private withdrawal cannot be undone by an older successful receipt body after " + status, async () => {
  const f = await fullFixture(), gate = bodyGate(), pending = f.start();
  f.request.resolve(gate.response); await tick();
  f.enqueueRead(Response.json({ error: "denied" }, { status })); await f.client.ensure("doc", { force: true });
  hidden(f, status); const reads = f.effects.reads.length;
  gate.finish(receiptFixture.body()); await pending;
  hidden(f, status); assert.equal(f.effects.reads.length, reads);
});

for (const status of [200, 403]) test("a newer external receipt owns its own version over an older " + status + " response", async () => {
  const f = await fullFixture(), old = f.start(), next = receiptFixture.deferred();
  f.enqueueReceipt(next.promise); const latest = f.start();
  next.resolve(Response.json({ ...receiptFixture.body(), job: { ...receiptFixture.job(), updatedAt: "newer-terminal" } }));
  assert.deepEqual(await latest, { status: "known", reconciled: true, refreshed: true });
  const notifications = f.effects.notifications, reads = f.effects.reads.length;
  f.request.resolve(status === 200 ? Response.json({ ...receiptFixture.body(), job: { ...receiptFixture.job(), updatedAt: "older-terminal" } }) : Response.json({ error: "denied" }, { status }));
  await old;
  assert.equal(f.effects.jobs[0].updatedAt, "newer-terminal");
  assert.equal(f.client.resource("doc").state, "ready");
  assert.equal(f.effects.notifications, notifications); assert.equal(f.effects.reads.length, reads);
});

for (const boundary of ["scope", "project", "sign-out", "aba"]) for (const status of [200, 403])
  test("former " + boundary + " receipt " + status + " cannot mutate the current scope or its pending read", async () => {
    const f = await fullFixture(), old = f.start();
    f.state.scope = boundary === "sign-out" ? "" : "scope-b";
    if (boundary === "project") f.state.projectId = "other-project";
    f.client.resource("doc");
    if (boundary === "aba" || boundary === "sign-out") { f.state.scope = "scope-a"; f.client.resource("doc"); }
    const gate = bodyGate(), next = { ...structuredClone(f.privateSnapshot), projectId: f.state.projectId, revision: "new-scope" };
    f.enqueueRead(gate.response); const reading = f.client.ensure("doc", { force: true });
    const reads = f.effects.reads.length, notifications = f.effects.notifications;
    f.request.resolve(status === 200 ? Response.json(receiptFixture.body()) : Response.json({ error: "denied", message: privateText }, { status }));
    await old;
    assert.equal(f.effects.notifications, notifications); assert.deepEqual(f.effects.jobs, f.heldJob);
    const shared = f.client.ensure("doc");
    assert.equal(f.effects.reads.length, reads, "old receipt cannot delete newer read deduplication");
    gate.finish(next); await Promise.all([reading, shared]);
    assert.equal(f.client.resource("doc").snapshot.revision, "new-scope");
  });

test("a non-authoritative receipt 500 is not a withdrawal or an excuse for an automatic retry", async () => {
  const f = await fullFixture(), pending = f.start();
  f.request.resolve(new Response("{", { status: 500 }));
  assert.equal((await pending).status, "unavailable");
  assert.ok(f.render().includes(privateText)); assert.notEqual(f.client.resource("doc").privateUnavailable, true);
  assert.equal(f.effects.reads.length, f.initialReads); assert.equal(f.effects.requests.length, 1);
});

test("a synchronous newer read started by refresh notification cannot be adopted by the old receipt", async () => {
  const f = await fullFixture(), pending = f.start();
  let nextRead = null, armed = true;
  const latest = { ...structuredClone(f.privateSnapshot), revision: "notification-owned" };
  const older = { ...structuredClone(f.privateSnapshot), revision: "receipt-old" };
  f.enqueueRead(Response.json(latest), Response.json(older));
  f.state.onNotify = () => {
    f.host.controller.willUpdate(new Map());
    if (armed && f.client.resource("doc").state === "refreshing") { armed = false; nextRead = f.client.ensure("doc", { force: true }); }
  };
  f.request.resolve(Response.json(receiptFixture.body()));
  await pending; await nextRead;
  assert.equal(f.client.resource("doc").snapshot.revision, "notification-owned");
  assert.deepEqual(f.effects.jobs, f.heldJob, "the old receipt may not publish merely because a newer read succeeded");
});



const writeFixture = await fixtureDeclarations("./output-client-freshness.test.mjs",
  ["fixture", "sample", "start", "command", "assertHidden", "assertReceipt", "secret", "tick"], "committed-private-receipt-r2-fixture");
// The same real transport-entry barrier as its paired write fixture. Receipt-only
// reads retain their original header boundary; no private response body is awaited.
waitForOriginalDispatch = writeFixture.tick;
function privateAcknowledgment(action, status = 410) {
  const code = status === 410 ? "output_private_evidence_unavailable" : "output_execution_authority_revoked";
  return { ok: true, replayed: false, command: { action, eventId: "canonical-output-event" }, appended: [], snapshot: null,
    privateUnavailable: true, receipt: { committed: true, clientMutationId: writeFixture.command.clientMutationId, action, eventId: "canonical-output-event" }, errorCode: code, error: code };
}
for (const mode of ["command", "upload"]) for (const status of [401, 403, 410])
  test("exact committed " + mode + " " + status + " keeps only its original acknowledgment after immediate private retirement", async () => {
    const f = writeFixture.fixture(); await f.warm();
    const gate = bodyGate(status); f.enqueue(gate.response);
    const pending = writeFixture.start(f, mode);
    await tick(); writeFixture.assertHidden(f, status);
    const action = mode === "upload" ? "adopt" : "save";
    gate.finish(privateAcknowledgment(action, status));
    const result = await pending; writeFixture.assertHidden(f, status);
    assert.equal(result.status, status === 410 ? "saved" : "forbidden");
    assert.equal(result.privateUnavailable, true); writeFixture.assertReceipt(result, action);
    assert.equal(f.calls.length, 2); assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  });

const malformedAcknowledgments = {
  "not-ok": value => { value.ok = false; },
  "missing-replayed": value => { delete value.replayed; },
  "missing-receipt": value => { delete value.receipt; },
  "not-committed": value => { value.receipt.committed = false; },
  "wrong-key": value => { value.receipt.clientMutationId = "another-request"; },
  "wrong-action": value => { value.receipt.action = "authorize"; },
  "wrong-command-action": value => { value.command.action = "authorize"; },
  "wrong-event": value => { value.receipt.eventId = "another-event"; },
  "invalid-event": value => { value.command.eventId = value.receipt.eventId = "private source with spaces"; },
  "numeric-event": value => { value.command.eventId = value.receipt.eventId = 123; },
  "missing-error": value => { delete value.error; },
  "wrong-error": value => { value.error = "service_unavailable"; },
  "wrong-error-code": value => { value.errorCode = "output_revision_conflict"; },
  "appended-private": value => { value.appended = [{ privateSource: privateText }]; },
  "snapshot-private": value => { value.snapshot = writeFixture.sample(); },
  "wrong-private-flag": value => { value.privateUnavailable = false; },
  "extra-private-body": value => { value.message = privateText; },
  "extra-private-command": value => { value.command.source = privateText; },
  "extra-private-receipt": value => { value.receipt.source = privateText; },
};
for (const mode of ["command", "upload"]) for (const status of [403, 410]) for (const [label, mutate] of Object.entries(malformedAcknowledgments))
  test("forged or incomplete " + mode + " " + status + " " + label + " cannot claim a committed receipt", async () => {
    const f = writeFixture.fixture(); await f.warm();
    const value = privateAcknowledgment(mode === "upload" ? "adopt" : "save", status); mutate(value);
    f.enqueue(Response.json(value, { status }));
    const result = await writeFixture.start(f, mode);
    writeFixture.assertHidden(f, status);
    assert.equal(result.receipt, undefined);
    assert.ok(!JSON.stringify(result).includes(privateText)); assert.ok(!JSON.stringify(result).includes(writeFixture.secret));
    assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  });

for (const status of [200, 404, 409, 500]) test("a private committed envelope on HTTP " + status + " is not the supported safe acknowledgment protocol", async () => {
  const f = writeFixture.fixture(); await f.warm();
  f.enqueue(Response.json(privateAcknowledgment("save"), { status }));
  const result = await writeFixture.start(f, "command");
  assert.equal(result.receipt, undefined);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});

for (const status of [403, 410]) for (const boundary of ["permission", "project", "aba"])
  test("old " + status + " committed acknowledgment cannot cross a " + boundary + " epoch", async () => {
    const f = writeFixture.fixture(); await f.warm();
    const gate = bodyGate(status); f.enqueue(gate.response); const old = writeFixture.start(f, "command");
    await tick(); writeFixture.assertHidden(f, status);
    f.setScope({ key: "new-permission", projectId: boundary === "project" ? "other-project" : "fixture-project" });
    f.client.resource("doc-a");
    if (boundary === "aba") { f.setScope({ key: "fixture-actor:project:1", projectId: "fixture-project" }); f.client.resource("doc-a"); }
    f.enqueue(Response.json(writeFixture.sample("new-owned", boundary === "project" ? "other-project" : "fixture-project")));
    await f.client.ensure("doc-a", { force: true });
    const current = f.client.resource("doc-a");
    gate.finish(privateAcknowledgment("save", status));
    const result = await old;
    assert.equal(result.status, "forbidden"); assert.equal(result.receipt, undefined);
    assert.equal(f.client.resource("doc-a"), current);
    assert.equal(current.snapshot.revision, "new-owned");
  });

for (const status of [403, 410]) test("late original " + status + " acknowledgment may retain its content-free ID but cannot retire a newer valid snapshot", async () => {
  const f = writeFixture.fixture(); await f.warm();
  const gate = bodyGate(status); f.enqueue(gate.response); const old = writeFixture.start(f, "command");
  await tick(); writeFixture.assertHidden(f, status);
  f.enqueue(Response.json(writeFixture.sample("new-valid")));
  await f.client.ensure("doc-a", { force: true });
  const current = f.client.resource("doc-a");
  gate.finish(privateAcknowledgment("save", status));
  const result = await old; writeFixture.assertReceipt(result);
  assert.equal(f.client.resource("doc-a"), current);
  assert.equal(current.snapshot.revision, "new-valid");
  assert.notEqual(current.privateUnavailable, true); assert.notEqual(current.accessLost, true);
});

for (const mode of ["save", "upload"]) for (const status of [403, 410])
  test("actual Store " + mode + " preserves exact committed " + status + " receipt without a duplicate mutation or private body", async () => {
    const f = writeFixture.fixture(); await f.warm();
    const action = mode === "upload" ? "adopt" : "save";
    f.enqueue(Response.json(privateAcknowledgment(action, status), { status }));
    if (status === 410) f.enqueue(Response.json({ error: "service_unavailable", message: writeFixture.secret }, { status: 500 }));
    const result = mode === "save"
      ? await f.store.outputRequirementCommand({ ...writeFixture.command, documentId: "doc-a", blockId: "requirement-doc-a" })
      : await f.store.uploadOutputAsset("doc-a", new File(["owned"], "owned.png"), "1", writeFixture.command.clientMutationId, true);
    writeFixture.assertHidden(f, status); writeFixture.assertReceipt(result, action);
    assert.equal(result.status, status === 410 ? "saved" : "forbidden");
    assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  });

test("withholding an already recognized acknowledgment always projects its four content-free fields", async () => {
  const f = writeFixture.fixture(); await f.warm();
  const receipt = { ...privateAcknowledgment("save").receipt, source: privateText };
  const result = f.client.withholdCommandBody("doc-a", { status: "saved", body: null, receipt, privateUnavailable: true }, { clientMutationId: writeFixture.command.clientMutationId, action: "save" });
  writeFixture.assertReceipt(result);
  assert.deepEqual(Object.keys(result.receipt).sort(), ["action", "clientMutationId", "committed", "eventId"]);
  assert.ok(!JSON.stringify(result).includes(privateText));
});

test("an invalid external Document start neither fetches nor retires an authorized view", async () => {
  const f = await fullFixture(), before = f.client.resource("doc"), reads = f.effects.reads.length, notifications = f.effects.notifications;
  assert.equal(f.client.beginExternalRead(""), null);
  assert.equal(f.client.resource("doc"), before);
  assert.equal(f.effects.reads.length, reads); assert.equal(f.effects.notifications, notifications);
});

test("an external receipt denial retires already-pending bytes without changing an unknown hold", async () => {
  const f = await fullFixture(), bytes = receiptFixture.deferred();
  f.enqueueRead({ status: 200, ok: true, headers: new Headers(), blob: () => bytes.promise });
  const download = f.client.download("doc", "/api/output-requirements/assets/exact-file?documentId=doc");
  await tick();
  const checking = f.start(); f.request.resolve(Response.json({ error: "denied" }, { status: 403 }));
  await checking; hidden(f, 403);
  bytes.resolve(new Blob([privateText]));
  const result = await download;
  assert.equal(result.status, "forbidden"); assert.equal(result.body, null);
  hidden(f, 403);
});


for (const presentation of ["disconnected", "another-document"]) for (const status of [401, 403, 404, 410])
  test("current receipt " + status + " retires only its resource after presentation becomes " + presentation, async () => {
    const f = await fullFixture();
    let other = null;
    if (presentation === "another-document") {
      const snapshot = structuredClone(f.privateSnapshot);
      snapshot.documentId = "other-doc";
      snapshot.requirements[0].content = "OTHER_DOCUMENT_PRIVATE_STAYS_CURRENT";
      snapshot.requirements[0].spec.original_text = "OTHER_DOCUMENT_PRIVATE_STAYS_CURRENT";
      f.enqueueRead(Response.json(snapshot));
      await f.client.ensure("other-doc", { force: true });
      other = f.client.resource("other-doc");
    }
    const ui = f.startUI();
    if (presentation === "disconnected") f.host.controller.disconnectedCallback();
    else { f.host.controller.documentId = "other-doc"; f.host.controller.willUpdate(new Map()); }
    const reads = f.effects.reads.length;
    f.request.resolve(new Response("{", { status }));
    await ui;
    const resource = f.client.resource("doc");
    assert.equal(resource.snapshot, null);
    assert.equal(resource.privateUnavailable, true);
    assert.equal(resource.accessLost, status !== 410);
    assert.equal(f.effects.reads.length, reads, "presentation movement cannot trigger a replacement read");
    assert.deepEqual(f.effects.jobs, f.heldJob, "resource retirement cannot rewrite held accounting");
    if (other) {
      assert.equal(f.client.resource("other-doc"), other, "a different Document resource is not globally retired");
      assert.ok(f.render().includes("OTHER_DOCUMENT_PRIVATE_STAYS_CURRENT"));
    }
  });
