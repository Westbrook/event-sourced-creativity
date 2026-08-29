import assert from "node:assert/strict";
import { getHeapStatistics } from "node:v8";
const previousFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = (...args) => { networkAttempts++; return previousFetch(...args); };
export const { fixture, intent, preview, apply, retrieve, pauseClaim, retained, changes,
  canonicalState, financialState, assertFree, actor } = await import("./canvas-expired-disposition-fixture.mjs");
export const { pauseOperationLookup } = await import("./authoring-disclosure-boundary.mjs");
export const { sweepExpiredPrivateContent } = await import("../../worker/runtime.ts");
export const json = async response => ({ http: response.status, body: await response.json() });
export const receiptCount = state => Number(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n);
export const arrangementCount = state => Number(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='CanvasArrangementCreated'").get().n);
export const privateRows = state => state.sqlite.prepare("SELECT rowid AS originalRowid,* FROM private_content WHERE kind='authoring-preview' ORDER BY rowid").all();

// The same actual source-change/known-refusal setup as the immutable12-case
// observation. No Worker handler, authority guard, or response is replaced.
export async function refused(state) {
  const original = await intent(state), before = canonicalState(state);
  const changed = await state.request("/api/events", { method: "POST",
    headers: { ...state.headers, "content-type": "application/json" },
    body: JSON.stringify({ action: "append", event: { type: "BlockPropertyEdited", payload: {
      project_id: state.projectId, block_id: "arrangement-source-0", property_path: "text",
      old_value: "Existing authored direction 0", new_value: "Actual authorized source change before initial free preview",
    } } }) });
  assert.equal(changed.status, 200, await changed.clone().text());
  const reply = await state.call({ ...original, action: "preview" });
  assert.equal(reply.status, 409); assert.deepEqual(await reply.json(), {
    error: "canvas_arrangement_source_changed", providerCalls: 0, maximumMicrousd: 0,
  });
  assert.equal(privateRows(state).length, 0); assert.equal(receiptCount(state), 0);
  assert.ok(canonicalState(state).events.length > before.events.length);
  const current = await intent(state, { operationId: original.operationId, recipeId: original.recipeId,
    name: original.name, selectedItemIds: original.selectedItemIds });
  assert.equal(current.operationId, original.operationId);
  assert.notEqual(current.expectedSourceRevision, original.expectedSourceRevision);
  return current;
}
export async function eraseThroughActualRetention(state, id) {
  state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(id);
  const processed = await sweepExpiredPrivateContent(state.env), row = retained(state, id);
  assert.ok(processed >= 1); assert.equal(row.content, ""); assert.ok(row.redacted_at);
}
export function finish(label, observations) {
  globalThis.fetch = previousFetch;
  assert.equal(networkAttempts, 0);
  console.log(label + " " + JSON.stringify({ observations, networkAttempts,
    heapSizeLimit: getHeapStatistics().heap_size_limit, nodeVersion: process.version,
    nativeDepth100: true }));
}
