import assert from "node:assert/strict";
import { installSourceOwnershipPort } from "./helpers/source-ownership-port.mjs";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  cardEditorState, controllerFixture, loadStoreMethods, snapshot, sourceRoot, startSave, startUpload,
} from "./output-ui-source-harness.mjs";

const { OutputRequirementsClient } = await import(pathToFileURL(resolve(sourceRoot, "src/state/output-requirements-client.ts")).href);
const actual = await loadStoreMethods();

// This transport-only success envelope is simulated; actual committed events and
// genuine authorization withdrawal are exercised by the full Store/Worker suite.
function simulatedCommittedOutputEnvelope(path, init, current) {
  const upload = path.startsWith("/api/output-requirements/assets?");
  const command = upload ? { action: "adopt", clientMutationId: new Headers(init.headers).get("x-output-client-mutation-id") } : JSON.parse(init.body);
  assert.ok(typeof command.clientMutationId === "string" && command.clientMutationId.length > 0, "response belongs to the original dispatched command");
  return { ok: true, replayed: false, command: { action: command.action, eventId: "fixture-committed-output-event" }, appended: [], snapshot: current };
}
function realTransportFixture(mode) {
  const calls = [];
  let current = snapshot("doc-a", "1");
  const commandSnapshot = snapshot("doc-a", "2");
  const scope = { key: "fixture-actor:project:1", projectId: "fixture-project" };
  const client = new OutputRequirementsClient({
    captureScope: () => scope,
    scopeActive: (captured) => captured.key === scope.key && captured.projectId === scope.projectId,
    isSnapshot: (value, documentId) => value?.documentId === documentId && typeof value?.revision === "string",
    notify() {},
    fetch: async (path, init) => {
      const method = init?.method ?? "GET";
      calls.push({ path, method });
      if (method === "GET") return mode === "revoked-after-save" && calls.some((call) => call.method === "POST") ? Response.json({ error: "project_access_revoked" }, { status: 403 }) : Response.json(current);
      current = commandSnapshot;
      return mode === "conflict"
        ? Response.json({ error: "output_revision_conflict" }, { status: 409 })
        : mode === "malformed" ? Response.json({ snapshot: current, command: { receipt: "known-committed" } })
        : Response.json(simulatedCommittedOutputEnvelope(path, init, current));
    },
  });
  let hydrationAttempts = 0;
  const store = {
    captureAuthorizationScope: () => ({ key: scope.key, shared: false }),
    authorizationScopeActive: () => true,
    outputRequirements: client,
    refreshEvents: async () => { hydrationAttempts += 1; throw new Error("fixture event hydration unavailable after commit"); },
  };
  installSourceOwnershipPort(store);
  store.outputRequirementCommand = (...args) => actual.outputRequirementCommand.call(store, ...args);
  store.uploadOutputAsset = (...args) => actual.uploadOutputAsset.call(store, ...args);
  return { client, calls, store, get hydrationAttempts() { return hydrationAttempts; } };
}

test("actual store + client: committed save survives failed event hydration and is not submitted again", async () => {
  const fixture = realTransportFixture("saved");
  await fixture.client.ensure("doc-a");
  const controller = await controllerFixture(fixture.store);
  await startSave(controller);
  assert.equal(fixture.hydrationAttempts, 1);
  assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(fixture.calls.filter((call) => call.method === "GET").length, 2, "read current scope after the committed mutation");
  assert.equal(fixture.client.resource("doc-a").snapshot.revision, "2");
  assert.equal(cardEditorState(controller.controller).status, "saved", "host reply must leave saving, so the card can close its matching draft");
  assert.equal(cardEditorState(controller.controller).clientMutationId, "fixture-save-operation");
});

test("actual store + client: committed upload survives failed event hydration without another upload", async () => {
  const fixture = realTransportFixture("saved");
  await fixture.client.ensure("doc-a");
  const controller = await controllerFixture(fixture.store);
  await startUpload(controller);
  assert.equal(fixture.hydrationAttempts, 1);
  assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(fixture.client.resource("doc-a").snapshot.revision, "2");
  assert.equal(controller.effects.uploadResets, 1, "known committed upload completes its form instead of leaving it stuck");
});

test("actual store + client: code-only 409 forces a GET before presenting latest comparison data", async () => {
  const fixture = realTransportFixture("conflict");
  await fixture.client.ensure("doc-a");
  const controller = await controllerFixture(fixture.store);
  await startSave(controller);
  const editor = cardEditorState(controller.controller);
  assert.equal(editor.status, "conflict");
  assert.equal(editor.latest.revision, "2", "latest cannot be the stale pre-conflict cache");
  assert.equal(fixture.client.resource("doc-a").snapshot.revision, "2");
  assert.equal(fixture.hydrationAttempts, 0, "a rejected mutation is not described as committed history");
  assert.deepEqual(fixture.calls.map((call) => call.method), ["GET", "POST", "GET"]);
});

test("actual store + client: upload conflict refreshes current revision without re-uploading", async () => {
  const fixture = realTransportFixture("conflict");
  await fixture.client.ensure("doc-a");
  const response = await fixture.store.uploadOutputAsset("doc-a", new File(["owned"], "owned.png"), "1", "same-upload", true);
  assert.equal(response.status, "conflict");
  assert.equal(fixture.client.resource("doc-a").snapshot.revision, "2");
  assert.deepEqual(fixture.calls.map((call) => call.method), ["GET", "POST", "GET"]);
});

for (const action of ["save", "upload"]) test(`actual store + client: ${action} receipt does not resurface private data after access is revoked during hydration`, async () => {
  const fixture = realTransportFixture("revoked-after-save");
  await fixture.client.ensure("doc-a");
  const response = action === "save"
    ? await fixture.store.outputRequirementCommand({ action: "save", documentId: "doc-a", blockId: "output-a", expectedRevision: "1", clientMutationId: "same-save", spec: {} })
    : await fixture.store.uploadOutputAsset("doc-a", new File(["owned"], "owned.png"), "1", "same-upload", true);
  assert.equal(response.status, "forbidden");
  assert.equal(response.body, null);
  assert.equal(fixture.client.resource("doc-a").snapshot, null);
  assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 1);
});

test("old partial simulated command envelope is not a canonical acknowledgment", async () => {
  const fixture = realTransportFixture("malformed"); await fixture.client.ensure("doc-a");
  const original = { action: "save", documentId: "doc-a", blockId: "output-a", expectedRevision: "1", clientMutationId: "original-malformed-output", spec: {} };
  const result = await fixture.store.outputRequirementCommand(original);
  assert.equal(result.status, "unavailable"); assert.equal(result.receipt, undefined);
  const retained = fixture.client.retainedWrite("doc-a");
  assert.equal(retained.clientMutationId, original.clientMutationId); assert.equal(retained.status, "unknown"); assert.equal(retained.receipt, undefined);
  assert.equal(fixture.hydrationAttempts, 0); assert.equal(fixture.calls.filter(call => call.method === "POST").length, 1);
  const different = await fixture.store.outputRequirementCommand({ ...original, clientMutationId: "different-output-operation", spec: { label: "different request" } });
  assert.equal(different.status, "not-attempted"); assert.equal(different.body, null); assert.equal(different.receipt, undefined);
  assert.deepEqual(fixture.client.retainedWrite("doc-a"), retained); assert.equal(fixture.calls.filter(call => call.method === "POST").length, 1, "no automatic replay or replacement");
});
