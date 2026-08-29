import assert from "node:assert/strict";
import { sceneDeferred } from "./event-source-retirement-fixture.mjs";
import { awaitBoundary } from "./document-copy-recovery-host.mjs";
import { history, changes } from "./document-copy-continuity-host.mjs";

// Complete connected Project/Store + actual Worker/RAM SQLite. Only the named
// negative transport corruptions below replace a response, never a positive ACK.
const originalRead = (p, state) => ({ action: "resume", ...p.target, operationId: state.operationId });

function assertCorrectionLocked(p, original) {
  const state = p.h.store.documentCopyReview(p.target), count = p.calls().length;
  assert.ok(state); assert.equal(state.operationId, original.operationId); assert.equal(state.busy, false);
  assert.notEqual(state.issue, "document_duplicate_folder_unavailable");
  assert.equal(Boolean(p.byLabel("document.copy.revise")), false);
  assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
  assert.equal(p.h.store.beginDocumentCopyRevision(p.target, original.operationId), null);
  assert.equal(p.calls().length, count, "a locked correction cannot dispatch");
  assert.equal(state.previewId, ""); assert.equal(state.receipt, null); assert.equal(state.commitSubmitted, false);
  return state;
}

async function interruptRefusalRead(p, mode = "lost") {
  const { h, f, target } = p, original = h.store.documentCopyReview(target), before = history(p);
  const calls = [], count = p.calls().length;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "resume") return;
    assert.deepEqual(request.body, originalRead(p, original));
    const writes = changes(p), response = await h.worker.request(request.url, request.init), body = await response.clone().json();
    assert.equal(response.status, 200); assert.deepEqual(body, { status: "none" }); assert.equal(changes(p), writes);
    calls.push({ request: structuredClone(request.body), status: response.status, body, readOnly: true });
    if (mode === "lost") throw new Error("named lost reply after the actual exact read-only none");
    if (mode === "malformed-json") return new Response("{", { status: 200, headers: { "content-type": "application/json" } });
    if (mode === "array-none") return Response.json([{ status: "none" }]);
    if (mode === "extra-none") return Response.json({ status: "none", unrelated: true });
    if (mode === "wrong-status") return Response.json({ status: "none" }, { status: 202 });
    if (mode === "folder-error") return Response.json({ status: "not-applied", error: "document_duplicate_folder_unavailable" }, { status: 409 });
    assert.equal(mode, "server-error");
    return Response.json({ error: "named_transient_failure" }, { status: 500 });
  };
  try { await f.act(p.byLabel("action.close")); await f.act(p.open()); await p.join(); }
  finally { h.intercept = null; }
  assert.equal(calls.length, 1); assert.equal(p.calls().length, count + 1); assert.deepEqual(history(p), before);
  const state = assertCorrectionLocked(p, original);
  assert.deepEqual(state.revisedIntent, original.revisedIntent); assert.deepEqual(state.revisionDraft, original.revisionDraft);
  return { original, state, calls, before };
}

async function freshExactRead(p) {
  const { h, f, target } = p, original = h.store.documentCopyReview(target), before = history(p), count = p.calls().length;
  let observed = null;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "resume") return;
    assert.equal(observed, null); assert.deepEqual(request.body, originalRead(p, original));
    const writes = changes(p), response = await h.worker.request(request.url, request.init), body = await response.clone().json();
    assert.equal(response.status, 200); assert.deepEqual(body, { status: "none" }); assert.equal(changes(p), writes);
    observed = { request: structuredClone(request.body), status: response.status, body, readOnly: true };
    return response;
  };
  try { await f.act(p.byLabel("document.copy.check")); await p.join(); }
  finally { h.intercept = null; }
  assert.ok(observed); assert.equal(p.calls().length, count + 1); assert.deepEqual(history(p), before);
  return { state: h.store.documentCopyReview(target), observed };
}

async function holdExactRead(p) {
  const { h, f, target } = p, original = h.store.documentCopyReview(target);
  const entered = sceneDeferred(), release = sceneDeferred(); let observed = null, pending = null;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "resume") return;
    assert.equal(observed, null); assert.deepEqual(request.body, originalRead(p, original));
    const writes = changes(p), response = await h.worker.request(request.url, request.init), body = await response.clone().json();
    assert.equal(response.status, 200); assert.deepEqual(body, { status: "none" }); assert.equal(changes(p), writes);
    observed = { request: structuredClone(request.body), status: response.status, body, readOnly: true };
    response.json = async () => { entered.resolve(); await release.promise; return body; };
    return response;
  };
  try {
    await f.act(p.byLabel("document.copy.check")); pending = p.join();
    await awaitBoundary(entered, pending, "actual exact-original read JSON");
  } catch (error) { release.resolve(); if (pending) await pending; h.intercept = null; throw error; }
  return { original, observed, release, async finish() { release.resolve(); try { await pending; } finally { h.intercept = null; } } };
}

export { originalRead, assertCorrectionLocked, interruptRefusalRead, freshExactRead, holdExactRead };
