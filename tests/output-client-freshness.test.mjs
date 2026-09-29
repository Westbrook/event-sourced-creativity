import assert from "node:assert/strict";
import { installSourceOwnershipPort } from "./helpers/source-ownership-port.mjs";
import test from "node:test";
import { OutputRequirementsClient } from "../src/state/output-requirements-client.ts";
import { controllerFixture, loadStoreMethods, snapshot, startSave, startUpload } from "./output-ui-source-harness.mjs";

// Actual client + actual Store method/controller sources, with owned synthetic HTTP bodies.
// These are not native-browser, live-provider, database-migration, or authorization certification.
const actualStore = await loadStoreMethods();
// Digest preparation is asynchronous. Observe the actual original POST entry,
// never a guessed delay or a replacement response, before asserting header state.
const preparingDispatches = new Set();
const tick = async () => { await Promise.all([...preparingDispatches].map(entry => entry.promise)); await new Promise(resolve => setImmediate(resolve)); };
function afterOriginalDispatch(state, identity, invoke) {
  let resolve, reject, entered = false;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  const entry = { promise, matches: call => {
    if (call.method !== "POST" || call.path !== identity.path) return false;
    if (identity.action === "adopt") return new Headers(call.headers).get("x-output-client-mutation-id") === identity.clientMutationId;
    const body = JSON.parse(call.body);
    return body.documentId === "doc-a" && body.action === identity.action && body.clientMutationId === identity.clientMutationId;
  },
    enter() { entered = true; resolve(); preparingDispatches.delete(entry); state.dispatchEntries.delete(entry); } };
  preparingDispatches.add(entry); state.dispatchEntries.add(entry);
  return Promise.resolve().then(invoke).then(result => {
    if (!entered) {
      if (result?.status !== "not-attempted") { const error = new Error("Transport barrier requires the exact POST entry or its terminal not-attempted result"); reject(error); throw error; }
      resolve();
    }
    return result;
  }, error => { if (!entered) reject(error); throw error; }).finally(() => { preparingDispatches.delete(entry); state.dispatchEntries.delete(entry); });
}
const secret = "PRIVATE-OUTPUT-WORDING-NOT-A-RECEIPT";
const command = { action: "save", expectedRevision: "1", clientMutationId: "original-output-operation", spec: { original_text: secret } };
const sample = (revision = "1", projectId = "fixture-project") => {
  const value = snapshot("doc-a", revision); value.projectId = projectId;
  value.requirements[0].content = secret; value.requirements[0].spec.original_text = secret;
  return value;
};
const committed = (action = "save", revision = "2") => ({
  ok: true, replayed: false, command: { action, eventId: "canonical-output-event", preflight: { privateSource: secret } },
  appended: [{ payload: { privateSource: secret } }], snapshot: sample(revision),
});
function bodyGate(status = 200) {
  let controller, ended = false;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  return {
    response: new Response(stream, { status, headers: { "content-type": "application/json" } }),
    finish(value) { if (ended) return; ended = true; controller.enqueue(new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value))); controller.close(); },
    fail() { if (ended) return; ended = true; controller.error(new Error("response body transport failed")); },
  };
}
function fixture() {
  let scope = { key: "fixture-actor:project:1", projectId: "fixture-project" };
  const replies = [], calls = [], publications = [];
  const client = new OutputRequirementsClient({
    captureScope: () => scope,
    scopeActive: (captured) => captured.key === scope?.key && captured.projectId === scope?.projectId,
    isSnapshot: (value, documentId, captured) => Boolean(value?.schemaVersion === 1 && value.documentId === documentId
      && value.projectId === captured.projectId && value.scope?.actorUserId === "fixture-actor" && typeof value.revision === "string"),
    fetch: async (path, init) => {
      calls.push({ path, method: init?.method ?? "GET", body: init?.body, headers: init?.headers });
      for (const entry of [...state.dispatchEntries]) if (entry.matches(calls.at(-1))) entry.enter();
      assert.ok(replies.length, "every HTTP request must be explicitly supplied; no automatic retry or provider route");
      const response = replies.shift();
      if (response instanceof Error) throw response;
      return response;
    },
    notify: () => { publications.push(client.resource("doc-a")); state.onNotify?.(); },
  });
  const state = {
    client, calls, publications, dispatchEntries: new Set(), enqueue: (...values) => replies.push(...values), setScope: (next) => { scope = next; },
    warm: async () => { replies.push(Response.json(sample())); await client.ensure("doc-a"); },
  };
  state.store = {
    captureAuthorizationScope: () => scope ? { ...scope, shared: true } : null,
    authorizationScopeActive: (captured) => Boolean(captured && captured.key === scope?.key && captured.projectId === scope?.projectId),
    outputRequirements: client, refreshEvents: async () => {},
  };
  installSourceOwnershipPort(state.store);
  state.store.outputRequirementCommand = (value, options) => afterOriginalDispatch(state, { path: "/api/output-requirements", action: value.action, clientMutationId: value.clientMutationId }, () => actualStore.outputRequirementCommand.call(state.store, value, options));
  state.store.uploadOutputAsset = (...args) => afterOriginalDispatch(state, { path: "/api/output-requirements/assets?documentId=" + encodeURIComponent(args[0]), action: "adopt", clientMutationId: args[3] }, () => actualStore.uploadOutputAsset.call(state.store, ...args));
  return state;
}
const start = (state, action) => action === "read" ? state.client.ensure("doc-a", { force: true })
  : action === "command" ? afterOriginalDispatch(state, { path: "/api/output-requirements", action: command.action, clientMutationId: command.clientMutationId }, () => state.client.command("doc-a", command, "save requirements"))
  : action === "upload" ? afterOriginalDispatch(state, { path: "/api/output-requirements/assets?documentId=doc-a", action: "adopt", clientMutationId: command.clientMutationId }, () => state.client.upload("doc-a", new Blob(["owned bytes"]), { "x-output-client-mutation-id": command.clientMutationId }))
  : state.client.download("doc-a", "/api/output-requirements/assets/exact-file?documentId=doc-a");
const privateError = (status) => ({ error: status === 410 ? "output_private_evidence_unavailable" : "output_action_not_authorized", snapshot: sample(), message: secret });
const assertHidden = (state, status) => {
  const value = state.client.resource("doc-a");
  assert.equal(value.snapshot, null); assert.equal(value.privateUnavailable, true);
  assert.equal(value.accessLost, status !== 410, "retired evidence is not a revoked project permission");
  assert.ok(!JSON.stringify(value).includes(secret));
};
const assertReceipt = (result, action = "save", mutationId = command.clientMutationId) => {
  assert.equal(result.body, null);
  assert.deepEqual(result.receipt, { committed: true, clientMutationId: mutationId, action, eventId: "canonical-output-event" });
  assert.ok(!JSON.stringify(result).includes(secret), "the acknowledgment contains no source, appended events, or old snapshot");
};

for (const action of ["read", "command", "upload", "download"]) for (const status of [401, 403, 404, 410]) {
  for (const completion of ["valid", "malformed", "body-error"]) test(`actual ${action} ${status}: private cache clears at headers before ${completion} body`, async () => {
    const state = fixture(); await state.warm();
    const gate = bodyGate(status); state.enqueue(gate.response);
    const operation = start(state, action); await tick();
    assertHidden(state, status);
    if (completion === "body-error") gate.fail(); else gate.finish(completion === "malformed" ? secret : privateError(status));
    const result = await operation;
    assertHidden(state, status);
    assert.ok(!JSON.stringify(result).includes(secret));
    if (action !== "read" && status !== 410) assert.equal(result.status, "forbidden");
    if (action !== "read" && status === 410) assert.notEqual(result.status, "forbidden");
    assert.equal(state.calls.length, 2);
  });
}

for (const response of [
  () => Response.json({ error: "service_unavailable" }, { status: 503 }),
  () => new Response("{", { status: 503 }),
  () => new Error("transport unavailable"),
  () => Response.json({ schemaVersion: 999, documentId: "doc-a" }),
]) test("non-authoritative refresh failure keeps the authorized last-known denominator, never an empty completed plan", async () => {
  const state = fixture(); await state.warm(); state.enqueue(response());
  const result = await start(state, "read");
  assert.equal(result.state, "unavailable"); assert.equal(result.snapshot.revision, "1");
  assert.equal(result.snapshot.summary.required_obligations, 1);
  assert.equal(result.snapshot.summary.delivery_ready, false);
  assert.notEqual(result.privateUnavailable, true); assert.notEqual(result.accessLost, true);
});

for (const status of [403, 410]) test(`a ${status} withdrawal survives pending, failed and wrong-scope reads until an owned valid recovery`, async () => {
  const state = fixture(); await state.warm();
  state.enqueue(Response.json(privateError(status), { status })); await start(state, "read"); assertHidden(state, status);
  const gate = bodyGate(); state.enqueue(gate.response); const reading = start(state, "read"); await tick(); assertHidden(state, status);
  gate.fail(); await reading; assertHidden(state, status);
  for (const response of [Response.json({ error: "service_unavailable" }, { status: 503 }), Response.json(sample("wrong", "foreign-project"))]) {
    state.enqueue(response); await start(state, "read"); assertHidden(state, status);
  }
  state.enqueue(Response.json(sample("recovered"))); await start(state, "read");
  const recovered = state.client.resource("doc-a");
  assert.equal(recovered.state, "ready"); assert.equal(recovered.snapshot.revision, "recovered");
  assert.notEqual(recovered.privateUnavailable, true); assert.notEqual(recovered.accessLost, true);
  assert.equal(state.calls.length, 6, "recovery consists only of these explicit reads");
});

for (const action of ["read", "command", "upload", "download"]) for (const status of [401, 403, 404, 410]) {
  test(`older ${action} success cannot return private data after newer ${status} headers`, async () => {
    const state = fixture(); await state.warm();
    const old = bodyGate(); state.enqueue(old.response); const pendingOld = start(state, action); await tick();
    const denied = bodyGate(status); state.enqueue(denied.response); const pendingDenial = start(state, "read"); await tick(); assertHidden(state, status);
    old.finish(action === "read" ? sample("old-private") : action === "download" ? secret : committed(action === "upload" ? "adopt" : "save"));
    const result = await pendingOld; assertHidden(state, status);
    if (action === "command" || action === "upload") {
      assertReceipt(result, action === "upload" ? "adopt" : "save");
      assert.equal(result.status, status === 410 ? "saved" : "forbidden");
    } else assert.ok(!JSON.stringify(result).includes(secret));
    denied.finish(privateError(status)); await pendingDenial; assertHidden(state, status);
    assert.equal(state.calls.length, 3);
  });
}

for (const action of ["read", "command", "upload", "download"]) for (const status of [403, 410]) {
  for (const order of ["old-headers-first", "old-headers-last"]) test(`newer valid read owns cache over ${action} ${status} with ${order}`, async () => {
    const state = fixture(); await state.warm();
    const old = bodyGate(status);
    let releaseHeaders;
    state.enqueue(order === "old-headers-first" ? old.response : new Promise((resolve) => { releaseHeaders = resolve; }));
    const oldRequest = start(state, action); await tick();
    if (order === "old-headers-first") assertHidden(state, status);
    state.enqueue(Response.json(sample("new-owned"))); await start(state, "read");
    if (releaseHeaders) releaseHeaders(old.response);
    old.finish(privateError(status)); await oldRequest;
    const current = state.client.resource("doc-a");
    assert.equal(current.state, "ready"); assert.equal(current.snapshot.revision, "new-owned");
    assert.notEqual(current.accessLost, true); assert.notEqual(current.privateUnavailable, true);
  });
}

test("a stale completed command retains its exact acknowledgment without returning its old snapshot over a newer valid read", async () => {
  const state = fixture(); await state.warm();
  const old = bodyGate(); state.enqueue(old.response); const writing = start(state, "command"); await tick();
  state.enqueue(Response.json(sample("new-owned"))); await start(state, "read");
  old.finish(committed()); const result = await writing;
  assert.equal(result.status, "saved"); assertReceipt(result);
  assert.equal(state.client.resource("doc-a").snapshot.revision, "new-owned");
});

for (const change of ["permission", "project", "sign-out-return"]) test(`pending denied body cannot publish into ${change} scope or delete its owned pending read`, async () => {
  const state = fixture(); await state.warm();
  const old = bodyGate(403); state.enqueue(old.response); const oldRequest = start(state, "read"); await tick(); assertHidden(state, 403);
  state.setScope(change === "sign-out-return" ? null : { key: "fixture-actor:project:2", projectId: change === "project" ? "other-project" : "fixture-project" });
  assert.equal(state.client.resource("doc-a").snapshot, null);
  if (change === "sign-out-return") state.setScope({ key: "fixture-actor:project:1", projectId: "fixture-project" });
  const next = bodyGate(); state.enqueue(next.response); const nextRequest = start(state, "read"); await tick();
  old.fail(); await oldRequest;
  const sameRequest = state.client.ensure("doc-a");
  assert.equal(state.calls.length, 3, "the stale finally must not remove the newer read's deduplication entry");
  next.finish(sample("new-scope", change === "project" ? "other-project" : "fixture-project"));
  await Promise.all([nextRequest, sameRequest]);
  assert.equal(state.client.resource("doc-a").snapshot.revision, "new-scope");
});

for (const action of ["save", "upload"]) for (const status of [401, 403, 404, 410]) for (const completion of ["valid", "malformed", "body-error"]) {
  test(`actual Store ${action}: known commit then GET${status} ${completion} keeps only the original acknowledgment`, async () => {
    const state = fixture(); await state.warm();
    const gate = bodyGate(status), canonicalAction = action === "upload" ? "adopt" : "save";
    state.enqueue(Response.json(committed(canonicalAction)), gate.response);
    const pending = action === "save"
      ? state.store.outputRequirementCommand({ ...command, documentId: "doc-a", blockId: "requirement-doc-a" })
      : state.store.uploadOutputAsset("doc-a", new File(["owned"], "owned.png"), "1", command.clientMutationId, true);
    await tick(); assertHidden(state, status);
    if (completion === "body-error") gate.fail(); else gate.finish(completion === "malformed" ? secret : privateError(status));
    const result = await pending; assertHidden(state, status); assertReceipt(result, canonicalAction);
    assert.equal(result.status, status === 410 ? "saved" : "forbidden");
    assert.equal(state.calls.filter((call) => call.method === "POST").length, 1, "unavailable private details do not resubmit the committed operation");
    const sent = state.calls.find((call) => call.method === "POST");
    assert.equal(action === "save" ? JSON.parse(sent.body).clientMutationId : new Headers(sent.headers).get("x-output-client-mutation-id"), command.clientMutationId);
  });
}

for (const action of ["save", "upload"]) test(`actual controller→Store→client ${action}:410 pending hides prior text and known commit cannot trigger duplicate creation`, async () => {
  const state = fixture(); await state.warm();
  const controller = await controllerFixture(state.store);
  const gate = bodyGate(410), canonicalAction = action === "upload" ? "adopt" : "save";
  state.enqueue(Response.json(committed(canonicalAction)), gate.response);
  const operation = action === "save" ? startSave(controller) : startUpload(controller);
  await tick(); assertHidden(state, 410); controller.controller.willUpdate(new Map());
  assert.ok(!JSON.stringify(controller.controller.render()).includes(secret), "actual controller renders no denied cached wording");
  gate.finish(secret); await operation; controller.controller.willUpdate(new Map());
  assert.ok(!JSON.stringify(controller.controller.render()).includes(secret));
  assert.equal(state.calls.filter((call) => call.method === "POST").length, 1);
  if (action === "upload") assert.equal(controller.effects.uploadResets, 1, "known committed adoption is completed, not restaged for another upload");
  assert.equal(controller.effects.downloads, 0);
});

for (const mutation of ["ok", "replayed", "action", "event", "document", "project", "actor"]) {
  test(`a withheld malformed/mismatched ${mutation} response is not promoted to canonical commit evidence`, async () => {
    const state = fixture(); await state.warm();
    const old = bodyGate(); state.enqueue(old.response); const writing = start(state, "command"); await tick();
    state.enqueue(Response.json(privateError(410), { status: 410 })); await start(state, "read");
    const body = committed();
    if (mutation === "ok") body.ok = false;
    if (mutation === "replayed") delete body.replayed;
    if (mutation === "action") body.command.action = "authorize";
    if (mutation === "event") body.command.eventId = "../not-an-event";
    if (mutation === "document") body.snapshot.documentId = "foreign-document";
    if (mutation === "project") body.snapshot.projectId = "foreign-project";
    if (mutation === "actor") body.snapshot.scope.actorUserId = "foreign-actor";
    old.finish(body); const result = await writing;
    assert.equal(result.status, "unavailable"); assert.equal(result.body, null); assert.equal(result.receipt, undefined);
    assertHidden(state, 410); assert.equal(state.calls.filter((call) => call.method === "POST").length, 1);
  });
}

test("a genuine lost response keeps the supplied operation identity and only an explicit replay recovers its known receipt", async () => {
  const state = fixture(); await state.warm(); state.enqueue(new Error("response lost after dispatch"));
  const first = await start(state, "command");
  assert.equal(first.status, "unavailable"); assert.equal(first.receipt, undefined);
  await tick(); assert.equal(state.calls.filter((call) => call.method === "POST").length, 1);
  state.enqueue(Response.json({ ...committed(), replayed: true }));
  const recovered = await start(state, "command");
  assert.equal(recovered.status, "saved"); assert.equal(recovered.body.replayed, true);
  const commands = state.calls.filter((call) => call.method === "POST").map((call) => JSON.parse(call.body));
  assert.deepEqual(commands, [commands[0], commands[0]], "explicit replay preserves ID, revision, authored text, and action without rebasing");
  assert.deepEqual(commands[0], { ...command, documentId: "doc-a" }, "no retirement flag or acknowledgment is serialized into a new command");
});

test("valid but unsupported and unknown Output state remains unknown rather than private denial or invented completion", async () => {
  const state = fixture(), value = sample("unknown-supported-read");
  value.requirements[0].status = "unsupported"; value.requirements[0].spec = null;
  value.requirements[0].preserved = { schema_version: 999, original_text: secret };
  value.summary.scope_known = false; value.summary.required_obligations = null; value.summary.delivery_ready = false;
  value.sourceVerification.status = "unavailable";
  state.enqueue(Response.json(value)); const result = await start(state, "read");
  assert.equal(result.state, "ready"); assert.notEqual(result.privateUnavailable, true);
  assert.equal(result.snapshot.summary.required_obligations, null); assert.equal(result.snapshot.summary.delivery_ready, false);
  assert.deepEqual(result.snapshot.requirements[0].preserved, value.requirements[0].preserved);
});

for (const action of ["read", "command"]) test(`a synchronous permission withdrawal during ${action} publication cannot return the retired private snapshot`, async () => {
  const state = fixture(); await state.warm();
  state.onNotify = () => { if (state.client.resource("doc-a").snapshot?.revision === "2") state.setScope(null); };
  state.enqueue(Response.json(action === "read" ? sample("2") : committed()));
  const result = await start(state, action);
  assert.equal(state.client.resource("doc-a").snapshot, null);
  assert.ok(!JSON.stringify(result).includes(secret));
  if (action === "command") assert.equal(result.status, "forbidden");
});

test("a completed write notification cannot retarget its private response into a newer pending read", async () => {
  const state = fixture(); await state.warm();
  const gate = bodyGate(); let newer, started = false;
  state.onNotify = () => {
    if (started || state.client.resource("doc-a").snapshot?.revision !== "2") return;
    started = true; state.enqueue(gate.response); newer = start(state, "read");
  };
  state.enqueue(Response.json(committed()));
  const result = await start(state, "command");
  assert.equal(result.status, "saved"); assertReceipt(result);
  assert.equal(state.client.resource("doc-a").state, "refreshing");
  gate.finish(sample("3")); await newer;
  assert.equal(state.client.resource("doc-a").snapshot.revision, "3");
});

for (const action of ["read", "command", "upload", "download"]) test(`later ${action} 503 cannot reintroduce private error-body fields after withdrawal`, async () => {
  const state = fixture(); await state.warm();
  state.enqueue(Response.json(privateError(410), { status: 410 })); await start(state, "read");
  state.enqueue(Response.json({ error: "service_unavailable", message: secret, snapshot: sample() }, { status: 503 }));
  const result = await start(state, action);
  assertHidden(state, 410);
  assert.ok(!JSON.stringify(result).includes(secret));
  if (action !== "read") assert.equal(result.status, "unavailable");
});

test("a byte response cannot alone restore a withdrawn requirement snapshot, but a valid owned read enables the explicit download", async () => {
  const state = fixture(); await state.warm();
  state.enqueue(Response.json(privateError(410), { status: 410 })); await start(state, "read");
  state.enqueue(new Response(secret)); const withheld = await start(state, "download");
  assert.equal(withheld.status, "unavailable"); assert.equal(withheld.body, null); assertHidden(state, 410);
  state.enqueue(Response.json(sample("recovered"))); await start(state, "read");
  state.enqueue(new Response("checked current bytes")); const current = await start(state, "download");
  assert.equal(current.status, "saved"); assert.equal(await current.body.blob.text(), "checked current bytes");
});

test("withdrawing one Document does not clear another authorized Document's requirements", async () => {
  const state = fixture(); await state.warm();
  const other = sample("other-current"); other.documentId = "doc-b";
  state.enqueue(Response.json(other)); await state.client.ensure("doc-b");
  state.enqueue(Response.json(privateError(403), { status: 403 })); await start(state, "read");
  assertHidden(state, 403);
  assert.equal(state.client.resource("doc-b").state, "ready");
  assert.equal(state.client.resource("doc-b").snapshot.revision, "other-current");
});

test("denial then a newer valid snapshot cannot revive bytes already in flight before the withdrawal", async () => {
  const state = fixture(); await state.warm();
  const old = bodyGate(); state.enqueue(old.response); const downloading = start(state, "download"); await tick();
  state.enqueue(Response.json(privateError(410), { status: 410 })); await start(state, "read"); assertHidden(state, 410);
  state.enqueue(Response.json(sample("recovered"))); await start(state, "read");
  old.finish(secret); const result = await downloading;
  assert.equal(result.status, "unavailable"); assert.equal(result.body, null);
  assert.equal(state.client.resource("doc-a").snapshot.revision, "recovered");
});

for (const action of ["command", "upload", "download"]) for (const status of [403, 410]) {
  test(`older ${action} ${status} malformed error body cannot disclose retired text after a newer valid read`, async () => {
    const state = fixture(); await state.warm();
    const old = bodyGate(status); state.enqueue(old.response); const pending = start(state, action); await tick();
    state.enqueue(Response.json(sample("new-owned"))); await start(state, "read");
    old.finish(secret + "-OLD-ERROR"); const result = await pending;
    assert.ok(!JSON.stringify(result).includes(secret + "-OLD-ERROR"));
    assert.equal(state.client.resource("doc-a").snapshot.revision, "new-owned");
    assert.notEqual(state.client.resource("doc-a").privateUnavailable, true);
  });
}
