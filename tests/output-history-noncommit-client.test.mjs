import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { OutputRequirementsClient } from "../src/state/output-requirements-client.ts";
import { snapshot as scopedSnapshot } from "./output-ui-source-harness.mjs";

// Reuse actual endpoint/isolated SQLite fixtures, not synthetic success receipts.
async function actualHistoryFixture() {
  const url = new URL("./output-scope-amendment-api.test.mjs", import.meta.url);
  const raw = readFileSync(url, "utf8"), tree = ts.createSourceFile(url.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
    || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
    || ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === "hooks.deregister")
    .map(node => node.getText(tree)).join("\n") + "\nexport { acceptedAmendment, seedLegacyReason, doc, project, owner };";
  url.search = "?output-history-noncommit-client-fixture";
  const imports = registerHooks({ load(request, context, next) {
    return request === url.href ? { format: "module", source, shortCircuit: true } : next(request, context);
  } });
  try { return await import(url.href); } finally { imports.deregister(); }
}
const actual = await actualHistoryFixture(), code = "output_scope_history_reason_unverified";
const exactHistory = () => ({ error: code, errorCode: code, errorValues: {} });
const originalFetch = globalThis.fetch;
let externalRequests = 0;
test.before(() => { globalThis.fetch = async () => { externalRequests++; throw new Error("output_history_test_external_request_forbidden"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(externalRequests, 0); });

async function actualClient(t) {
  const state = await actual.acceptedAmendment(t);
  actual.seedLegacyReason(state, state.plan.revisionId, "Retained invalid reason\u202e");
  const scope = { key: "actual-local-sqlite-author", projectId: actual.project }, calls = [];
  const client = new OutputRequirementsClient({
    captureScope: () => scope, scopeActive: captured => captured === scope,
    isSnapshot: (value, documentId, captured) => value?.schemaVersion === 1 && value.documentId === documentId
      && value.projectId === captured.projectId && value.scope?.actorUserId === actual.owner,
    fetch: async (path, init) => {
      const response = await state.send(path, init);
      calls.push({ method: init?.method ?? "GET", command: init?.body ? JSON.parse(init.body) : null, status: response.status });
      return response;
    },
    notify() {},
  });
  await client.ensure(actual.doc);
  return { state, client, calls, snapshot: client.resource(actual.doc).snapshot };
}

for (const allowPartial of [false, true]) test("actual SQLite history refusal is noncommit, then explicit FREE Confirm remains reachable / partial=" + allowPartial, async t => {
  const { state, client, calls, snapshot } = await actualClient(t), before = state.durableState();
  const denied = await client.command(actual.doc, { action: "export", expectedRevision: snapshot.revision,
    clientMutationId: "actual-history-original-export", planRevisionId: state.plan.revisionId, allowPartial }, "explicit package preparation");
  assert.equal(denied.status, "conflict"); assert.deepEqual(denied.body, exactHistory());
  assert.deepEqual(state.durableState(), before, "the actual refusal adds no event, command, manifest, job, or grant");
  assert.equal(client.retainedWrite(actual.doc), null, "only the exact precommit refusal releases its transport slot");
  assert.equal(calls.filter(call => call.method === "POST").length, 1, "no automatic follow-up or replacement ID");
  const result = await client.command(actual.doc, { action: "confirm", expectedRevision: snapshot.revision,
    clientMutationId: "actual-history-new-free-confirm", options: snapshot.confirmedPlan.confirmationOptions }, "explicit FREE confirmation");
  assert.equal(result.status, "saved"); assert.equal(calls.filter(call => call.method === "POST").length, 2);
  assert.equal(client.retainedWrite(actual.doc).clientMutationId, "actual-history-new-free-confirm");
  assert.equal(client.retainedWrite(actual.doc).status, "acknowledged");
  assert.ok(client.resource(actual.doc).snapshot.capabilities.limitationCodes.includes(code), "Confirm does not repair historical evidence");
  assert.equal(state.durableState().output_delivery_manifests, 0);
  assert.equal(state.durableState().document_jobs, 0); assert.equal(state.durableState().output_execution_grants, 0);
});

test("actual SQLite independent FREE Confirm keeps the same invalid history and zero paid work", async t => {
  const { state, client, calls, snapshot } = await actualClient(t);
  const result = await client.command(actual.doc, { action: "confirm", expectedRevision: snapshot.revision,
    clientMutationId: "actual-history-independent-confirm", options: snapshot.confirmedPlan.confirmationOptions }, "explicit FREE confirmation");
  assert.equal(result.status, "saved"); assert.equal(client.retainedWrite(actual.doc).status, "acknowledged");
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
  assert.ok(client.resource(actual.doc).snapshot.capabilities.limitationCodes.includes(code));
  assert.equal(state.durableState().output_delivery_manifests, 0);
  assert.equal(state.durableState().document_jobs, 0); assert.equal(state.durableState().output_execution_grants, 0);
});

// Remaining cases use the actual client with explicitly SYNTHETIC HTTP envelopes.
// They prove slot/dispatch inference only, not a server commit or private authority.
const documentId = "doc-a", originalId = "original-history-operation";
function simulatedCommit(command) {
  return { ok: true, replayed: false, appended: [], command: { action: command.action, eventId: "simulated-committed-event" },
    snapshot: scopedSnapshot(documentId, "2") };
}
function syntheticTransport(reply) {
  const scope = { key: "fixture-actor:project:1", projectId: "fixture-project" }, calls = [];
  const client = new OutputRequirementsClient({
    captureScope: () => scope, scopeActive: captured => captured === scope,
    isSnapshot: (value, document, captured) => value?.schemaVersion === 1 && value.documentId === document
      && value.projectId === captured.projectId && value.scope?.actorUserId === "fixture-actor",
    fetch: async (path, init) => {
      assert.equal(path, "/api/output-requirements"); assert.equal(init.method, "POST");
      const command = JSON.parse(init.body); calls.push(command);
      return calls.length === 1 ? reply(command) : Response.json(simulatedCommit(command));
    },
    notify() {},
  });
  return { client, calls };
}
const start = (client, action = "export") => client.command(documentId,
  { action, expectedRevision: "1", clientMutationId: originalId }, "SYNTHETIC original command");
const jsonError = (body, status = 409) => () => Response.json(body, { status });
const ambiguous = [
  ["bare history code", jsonError({ error: code })],
  ["original fixture extra-message history", jsonError({ error: code, message: "SYNTHETIC fixture: " + code })],
  ["extra message on exact history", jsonError({ ...exactHistory(), message: "not proof" })],
  ["extra key", jsonError({ ...exactHistory(), extra: true })],
  ["mismatched errorCode", jsonError({ ...exactHistory(), errorCode: "other_error" })],
  ["wrong code", jsonError({ error: "other_error", errorCode: "other_error", errorValues: {} })],
  ["nonempty errorValues", jsonError({ ...exactHistory(), errorValues: { count: 1 } })],
  ["array errorValues", jsonError({ ...exactHistory(), errorValues: [] })],
  ["null errorValues", jsonError({ ...exactHistory(), errorValues: null })],
  ["missing errorValues", jsonError({ error: code, errorCode: code })],
  ["500 with same fields", jsonError(exactHistory(), 500)],
  ["400 with same fields", jsonError(exactHistory(), 400)],
  ["410 without matched receipt", jsonError(exactHistory(), 410)],
  ["malformed JSON", () => new Response("{", { status: 409, headers: { "content-type": "application/json" } })],
  ["transport loss", () => { throw new Error("SYNTHETIC lost response"); }],
  ["malformed 200", () => Response.json({ snapshot: scopedSnapshot(documentId), command: { preflight: {} } })],
];
for (const [name, reply] of ambiguous) test("SYNTHETIC " + name + " retains the exact unknown original owner", async () => {
  const { client, calls } = syntheticTransport(reply); await start(client);
  const owner = client.retainedWrite(documentId);
  assert.equal(owner.clientMutationId, originalId); assert.equal(owner.action, "export"); assert.equal(owner.status, "unknown");
  assert.match(owner.digest, /^[a-f0-9]{64}$/u);
  const next = await client.command(documentId, { action: "confirm", expectedRevision: "1", clientMutationId: "different-new-operation" }, "SYNTHETIC explicit command");
  assert.equal(next.status, "not-attempted"); assert.equal(calls.length, 1); assert.deepEqual(client.retainedWrite(documentId), owner);
});
for (const action of ["save", "confirm", "preflight"]) test("SYNTHETIC history code for wrong action " + action + " never releases its owner", async () => {
  const { client, calls } = syntheticTransport(jsonError(exactHistory())); await start(client, action);
  const owner = client.retainedWrite(documentId); assert.equal(owner.status, "unknown"); assert.equal(owner.action, action);
  const next = await client.command(documentId, { action: "confirm", expectedRevision: "1", clientMutationId: "different-new-operation" }, "SYNTHETIC explicit command");
  assert.equal(next.status, "not-attempted"); assert.equal(calls.length, 1); assert.deepEqual(client.retainedWrite(documentId), owner);
});
for (const shape of ["bare", "typed"]) test("existing " + shape + " CAS noncommit proof still releases the original slot", async () => {
  const error = "output_revision_conflict";
  const { client, calls } = syntheticTransport(jsonError(shape === "bare" ? { error } : { error, errorCode: error, errorValues: {} }));
  assert.equal((await start(client, "confirm")).status, "conflict"); assert.equal(client.retainedWrite(documentId), null); assert.equal(calls.length, 1);
  assert.equal((await client.command(documentId, { action: "confirm", expectedRevision: "1", clientMutationId: "explicit-current-confirm" }, "SYNTHETIC explicit confirm")).status, "saved");
  assert.equal(calls.length, 2);
});
test("existing validation-before-commit proof remains unchanged", async () => {
  const { client, calls } = syntheticTransport(jsonError({ error: "invalid_output_requirement", issues: [] }, 400));
  assert.equal((await start(client, "save")).status, "invalid"); assert.equal(client.retainedWrite(documentId), null); assert.equal(calls.length, 1);
});
function privateAcknowledgment(status, mismatch = false) {
  const error = status === 410 ? "output_private_evidence_unavailable" : "output_execution_authority_revoked";
  return { ok: true, replayed: false, command: { action: "export", eventId: "original-canonical-event" }, appended: [], snapshot: null,
    privateUnavailable: true, receipt: { committed: true, clientMutationId: mismatch ? "unmatched-original-id" : originalId,
      action: "export", eventId: "original-canonical-event" }, errorCode: error, error };
}
for (const status of [403, 410]) test("SYNTHETIC matched committed " + status + " keeps the original acknowledgment", async () => {
  const { client, calls } = syntheticTransport(jsonError(privateAcknowledgment(status), status));
  const result = await start(client), owner = client.retainedWrite(documentId);
  assert.equal(result.status, status === 410 ? "saved" : "forbidden"); assert.equal(result.body, null); assert.equal(result.privateUnavailable, true);
  assert.equal(owner.clientMutationId, originalId); assert.equal(owner.status, "acknowledged");
  assert.deepEqual(owner.receipt, { committed: true, clientMutationId: originalId, action: "export", eventId: "original-canonical-event" });
  assert.deepEqual(result.receipt, owner.receipt); assert.equal(calls.length, 1);
});
test("SYNTHETIC unmatched committed 410 remains unknown and cannot be replaced", async () => {
  const { client, calls } = syntheticTransport(jsonError(privateAcknowledgment(410, true), 410));
  await start(client); const owner = client.retainedWrite(documentId);
  assert.equal(owner.clientMutationId, originalId); assert.equal(owner.status, "unknown"); assert.equal(owner.receipt, undefined);
  const next = await client.command(documentId, { action: "confirm", expectedRevision: "1", clientMutationId: "different-new-operation" }, "SYNTHETIC explicit command");
  assert.equal(next.status, "not-attempted"); assert.equal(calls.length, 1); assert.deepEqual(client.retainedWrite(documentId), owner);
});
