import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { eventHandlers, snapshot as scopedSnapshot } from "./output-ui-source-harness.mjs";

// Reuse the real client, Store methods and complete Output controller fixtures.
// Only test registration is omitted; transport streams are explicit no-network ports.
async function declarations(file, names) {
  const url = new URL(file, import.meta.url), raw = readFileSync(url, "utf8");
  const tree = ts.createSourceFile(url.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
    || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
    || ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree).startsWith("assert."))
    .map(node => node.getText(tree)).join("\n") + "\nexport { " + names.join(",") + " };";
  url.search = "?output-private-certification-r3-fixture";
  const hook = registerHooks({ load(request, context, next) {
    return request === url.href ? { format: "module", source, shortCircuit: true } : next(request, context);
  } });
  try { return await import(url.href); } finally { hook.deregister(); }
}
const receipt = await declarations("./output-operation-receipt-privacy.test.mjs",
  ["fullFixture", "receiptFixture", "bodyGate", "hidden", "tick", "privateText"]);
const clientFixture = await declarations("./output-client-freshness.test.mjs",
  ["fixture", "start", "sample", "committed", "command", "assertHidden", "assertReceipt", "bodyGate", "privateError", "tick"]);
const delay = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const failureKinds = ["valid", "http-error", "malformed", "body-error", "wrong-scope"];
const isWrite = action => action === "command" || action === "upload";
function finishGate(gate, kind, value) {
  if (kind === "body-error") gate.fail();
  else gate.finish(kind === "malformed" ? "{" : kind === "http-error" ? { error: "service_unavailable" } : value);
}
function refreshButton(f) {
  const action = eventHandlers(f.host.controller.render(), "click").find(handler => handler.toString().includes("#refresh(true)"));
  assert.ok(action, "the real Refresh outputs control remains reachable during Check saved receipt");
  return action;
}

// Header observation is deliberately separate from requested order and body completion.
// A response whose 200 headers preceded a withdrawal cannot restore its delayed bytes.
// A newer, fully validated Output snapshot completed before the old denial still wins.
for (const status of [401, 403, 404, 410]) for (const headers of ["before-denial", "after-denial"]) for (const completion of failureKinds)
  test("actual receipt UI " + status + " versus Refresh headers " + headers + " / " + completion, async () => {
    const f = await receipt.fullFixture(), original = f.startUI();
    const gate = receipt.bodyGate(completion === "http-error" ? 500 : 200), response = delay();
    f.enqueueRead(headers === "before-denial" ? gate.response : response.promise);
    const refresh = refreshButton(f)(); await receipt.tick();
    assert.equal(f.effects.reads.length, f.initialReads + 1);
    f.request.resolve(Response.json({ error: "denied", message: receipt.privateText }, { status }));
    await original; receipt.hidden(f, status);
    const calls = f.effects.reads.length, duplicate = f.client.ensure("doc");
    assert.equal(f.effects.reads.length, calls, "retirement preserves the newer pending GET's deduplication");
    if (headers === "after-denial") { response.resolve(gate.response); await receipt.tick(); }
    const next = { ...structuredClone(f.privateSnapshot), revision: "verified-newer-output",
      ...(completion === "wrong-scope" ? { projectId: "foreign-project" } : {}) };
    finishGate(gate, completion, next);
    await Promise.all([refresh, duplicate]); f.render();
    if (completion === "valid" && headers === "after-denial") {
      assert.equal(f.client.resource("doc").snapshot.revision, "verified-newer-output");
      assert.notEqual(f.client.resource("doc").privateUnavailable, true);
      assert.ok(f.render().includes(receipt.privateText));
      assert.deepEqual(f.effects.jobs, f.heldJob);
    } else receipt.hidden(f, status);
    assert.equal(f.effects.requests.length, 1, "only the original receipt check");
    assert.equal(f.effects.reads.length, calls, "no automatic replacement read or generation");
  });

for (const first of ["read", "command", "upload", "download"]) for (const status of [401, 403, 404, 410])
  for (const replacement of ["read", "command", "upload", "download"]) for (const headers of ["before-denial", "after-denial"])
    test("actual client " + first + status + " / pending " + replacement + " headers " + headers, async () => {
      const f = clientFixture.fixture(); await f.warm();
      const originalHeaders = delay(); f.enqueue(originalHeaders.promise);
      const original = clientFixture.start(f, first);
      await clientFixture.tick(); // Bind the first FIFO reply to its actual dispatch before queuing a replacement.
      if (isWrite(first) && isWrite(replacement)) {
        // A same-Document second mutation is deliberately not dispatched while
        // the original remains pending. It cannot own a second private response.
        const owner = f.client.retainedWrite("doc-a"), calls = f.calls.length;
        try {
          const result = await clientFixture.start(f, replacement);
          assert.equal(result.status, "not-attempted");
          assert.equal(f.calls.length, calls, "no second POST or consumption of an invented response");
          assert.deepEqual(f.client.retainedWrite("doc-a"), owner);
        } finally {
          originalHeaders.resolve(Response.json(clientFixture.privateError(status), { status }));
          await original;
        }
        clientFixture.assertHidden(f, status);
        assert.equal(f.client.retainedWrite("doc-a").clientMutationId, owner.clientMutationId);
        assert.equal(f.client.retainedWrite("doc-a").status, "unknown");
        assert.equal(f.calls.length, calls);
        return;
      }
      const gate = clientFixture.bodyGate(), nextHeaders = delay();
      f.enqueue(headers === "before-denial" ? gate.response : nextHeaders.promise);
      const pending = clientFixture.start(f, replacement); await clientFixture.tick();
      originalHeaders.resolve(Response.json(clientFixture.privateError(status), { status }));
      await original; clientFixture.assertHidden(f, status);
      const calls = f.calls.length;
      const duplicate = replacement === "read" ? f.client.ensure("doc-a") : Promise.resolve();
      assert.equal(f.calls.length, calls, "no duplicate pending read");
      if (headers === "after-denial") { nextHeaders.resolve(gate.response); await clientFixture.tick(); }
      gate.finish(replacement === "read" ? clientFixture.sample("replacement")
        : replacement === "download" ? "owned-file-bytes"
        : clientFixture.committed(replacement === "upload" ? "adopt" : "save", "replacement"));
      const [result] = await Promise.all([pending, duplicate]);
      if (headers === "after-denial" && replacement !== "download") {
        assert.equal(f.client.resource("doc-a").snapshot.revision, "replacement");
        assert.notEqual(f.client.resource("doc-a").privateUnavailable, true);
      } else {
        clientFixture.assertHidden(f, status);
        if (replacement !== "read") assert.equal(result.body, null, "retired byte bodies do not escape through a mutation or download result");
        if (replacement === "command" || replacement === "upload") clientFixture.assertReceipt(result, replacement === "upload" ? "adopt" : "save");
      }
      assert.equal(f.calls.length, calls);
    });

for (const first of ["read", "command", "upload", "download"]) for (const status of [401, 403, 404, 410])
  for (const replacement of ["command", "upload"])
    test((isWrite(first) ? "same-Document second " + replacement + " is not-attempted behind old " : "fully certified newer " + replacement + " protects Output against old ") + first + status, async () => {
      const f = clientFixture.fixture(); await f.warm();
      const oldHeaders = delay(); f.enqueue(oldHeaders.promise); const old = clientFixture.start(f, first);
      await clientFixture.tick();
      if (isWrite(first)) {
        const owner = f.client.retainedWrite("doc-a"), calls = f.calls.length;
        try {
          const result = await clientFixture.start(f, replacement);
          assert.equal(result.status, "not-attempted");
          assert.equal(f.calls.length, calls);
          assert.deepEqual(f.client.retainedWrite("doc-a"), owner);
        } finally {
          oldHeaders.resolve(Response.json(clientFixture.privateError(status), { status }));
          await old;
        }
        clientFixture.assertHidden(f, status);
        assert.equal(f.client.retainedWrite("doc-a").clientMutationId, owner.clientMutationId);
        assert.equal(f.client.retainedWrite("doc-a").status, "unknown");
        assert.equal(f.calls.length, calls);
        return;
      }
      f.enqueue(Response.json(clientFixture.committed(replacement === "upload" ? "adopt" : "save", "already-certified")));
      await clientFixture.start(f, replacement);
      const resource = f.client.resource("doc-a");
      oldHeaders.resolve(Response.json(clientFixture.privateError(status), { status })); await old;
      assert.equal(f.client.resource("doc-a"), resource);
      assert.equal(resource.snapshot.revision, "already-certified"); assert.notEqual(resource.privateUnavailable, true);
    });

for (const headers of ["before-denial", "after-denial"]) test("repeated A403/B410 preserves C pending identity and the stronger known denial / " + headers, async () => {
  const f = clientFixture.fixture(); await f.warm();
  const aHeaders = delay(), bHeaders = delay(), cHeaders = delay(), cBody = clientFixture.bodyGate();
  f.enqueue(aHeaders.promise); const a = clientFixture.start(f, "read");
  f.enqueue(bHeaders.promise); const b = clientFixture.start(f, "read");
  f.enqueue(headers === "before-denial" ? cBody.response : cHeaders.promise); const c = clientFixture.start(f, "read");
  await clientFixture.tick();
  aHeaders.resolve(Response.json(clientFixture.privateError(403), { status: 403 })); await a;
  clientFixture.assertHidden(f, 403); const revision = f.client.resource("doc-a").privateRevision;
  bHeaders.resolve(Response.json(clientFixture.privateError(410), { status: 410 })); await b;
  clientFixture.assertHidden(f, 403);
  assert.ok(f.client.resource("doc-a").privateRevision > revision);
  const calls = f.calls.length, duplicate = f.client.ensure("doc-a");
  assert.equal(f.calls.length, calls);
  if (headers === "after-denial") { cHeaders.resolve(cBody.response); await clientFixture.tick(); }
  cBody.finish(clientFixture.sample("c-verified")); await Promise.all([c, duplicate]);
  if (headers === "before-denial") clientFixture.assertHidden(f, 403);
  else { assert.equal(f.client.resource("doc-a").snapshot.revision, "c-verified"); assert.notEqual(f.client.resource("doc-a").accessLost, true); }
  assert.equal(f.calls.length, calls);
});

for (const change of ["permission", "project", "sign-out-return", "aba"]) for (const action of ["read", "command", "upload", "download"])
  test("old " + action + " denial cannot retire the new " + change + " epoch's pending private view", async () => {
    const f = clientFixture.fixture(); await f.warm();
    const headers = delay(); f.enqueue(headers.promise); const old = clientFixture.start(f, action);
    await clientFixture.tick(); // The old request must capture/enter its original scope, not the replacement epoch.
    const originalScope = { key: "fixture-actor:project:1", projectId: "fixture-project" };
    const newerScope = { key: "fixture-actor:project:2", projectId: change === "project" ? "other-project" : "fixture-project" };
    f.setScope(change === "sign-out-return" ? null : newerScope); f.client.resource("doc-a");
    if (change === "sign-out-return" || change === "aba") { f.setScope(originalScope); f.client.resource("doc-a"); }
    const projectId = change === "project" ? "other-project" : "fixture-project";
    f.enqueue(Response.json(clientFixture.sample("current-epoch", projectId))); await clientFixture.start(f, "read");
    const gate = clientFixture.bodyGate(); f.enqueue(gate.response); const pending = clientFixture.start(f, "read"); await clientFixture.tick();
    const resource = f.client.resource("doc-a"), publications = f.publications.length;
    headers.resolve(Response.json(clientFixture.privateError(403), { status: 403 })); await old;
    assert.equal(f.client.resource("doc-a"), resource); assert.equal(f.publications.length, publications);
    const calls = f.calls.length, duplicate = f.client.ensure("doc-a"); assert.equal(f.calls.length, calls);
    gate.finish(clientFixture.sample("current-epoch-finished", projectId)); await Promise.all([pending, duplicate]);
    assert.equal(f.client.resource("doc-a").snapshot.revision, "current-epoch-finished");
  });


// Preserve genuine parallel-mutation privacy coverage with two separate actual
// client Document owners. HTTP bodies remain explicitly synthetic test ports.
for (const first of ["command", "upload"]) for (const status of [401, 403, 404, 410])
  for (const replacement of ["command", "upload"])
    test("certified separate-Document " + replacement + " survives original " + first + status + " without replacing its owner", async () => {
      const f = clientFixture.fixture(); await f.warm();
      const headers = delay(); f.enqueue(headers.promise);
      const original = clientFixture.start(f, first); await clientFixture.tick();
      const owner = f.client.retainedWrite("doc-a"), nextId = "independent-doc-b-operation", next = scopedSnapshot("doc-b", "already-certified");
      next.requirements[0].content = clientFixture.sample().requirements[0].content;
      next.requirements[0].spec.original_text = next.requirements[0].content;
      const body = { ...clientFixture.committed(replacement === "upload" ? "adopt" : "save", "already-certified"), snapshot: next };
      f.enqueue(Response.json(body));
      let resource;
      try {
        const result = replacement === "command"
          ? await f.client.command("doc-b", { ...clientFixture.command, clientMutationId: nextId }, "SYNTHETIC independent Document write")
          : await f.client.upload("doc-b", new Blob(["owned bytes"]), { "x-output-client-mutation-id": nextId });
        assert.equal(result.status, "saved");
        resource = f.client.resource("doc-b");
        assert.equal(resource.snapshot.documentId, "doc-b"); assert.equal(resource.snapshot.revision, "already-certified");
        assert.equal(f.client.retainedWrite("doc-b").clientMutationId, nextId);
        assert.equal(f.client.retainedWrite("doc-b").status, "acknowledged");
        assert.deepEqual(f.client.retainedWrite("doc-a"), owner, "another Document never replaces the original write owner");
      } finally {
        headers.resolve(Response.json(clientFixture.privateError(status), { status })); await original;
      }
      clientFixture.assertHidden(f, status);
      assert.equal(f.client.resource("doc-b"), resource);
      assert.equal(resource.snapshot.revision, "already-certified"); assert.notEqual(resource.privateUnavailable, true);
      assert.equal(f.client.retainedWrite("doc-a").clientMutationId, owner.clientMutationId);
      assert.equal(f.client.retainedWrite("doc-a").status, "unknown");
      assert.equal(f.client.retainedWrite("doc-b").clientMutationId, nextId);
      assert.equal(f.calls.filter(call => call.method === "POST").length, 2, "one explicit operation per Document; no replay or third request");
    });
