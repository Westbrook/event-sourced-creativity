import assert from "node:assert/strict";
import test from "node:test";
import { accountingPreviewForInspection, createGenerationAccountingReader, generationAccountingTarget } from "../src/model/generation-accounting-inspection.ts";

import { accountingTarget, inputInspection, accountingResponse, deferred } from "./helpers/generation-accounting-fixture.mjs";
const response = () => Response.json(accountingResponse());
const tick = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };

test("only failed/canceled personal administrator managed-video receipts expose the target", () => {
  const admission = { role: "admin", shared: false, impersonating: false };
  assert.deepEqual(generationAccountingTarget(inputInspection(), admission), accountingTarget);
  for (const patch of [{ role: "creator" }, { shared: true }, { impersonating: true }]) assert.equal(generationAccountingTarget(inputInspection(), { ...admission, ...patch }), null);
  for (const patch of [{ status: "running" }, { kind: "generate" }, { artifact_kind: "slides" }, { production_mode: "manual" }, { job_id: "https://external.invalid" }, { attempt_count: -1 }]) {
    const inspection = inputInspection(); Object.assign(inspection.receipt.job, patch); assert.equal(generationAccountingTarget(inspection, admission), null);
  }
});

test("an explicit read issues one fixed same-origin GET and returns only allowlisted diagnostics", async () => {
  const reader = createGenerationAccountingReader(), requests = []; assert.equal(reader.state().status, "idle"); assert.equal(requests.length, 0);
  const value = accountingResponse(); value.secret = "PRIVATE_TOP"; value.preview.raw = "PRIVATE_CHECKPOINT"; value.preview.calls[0].responseRef = "PRIVATE_RESPONSE"; value.preview.accounting.note = "PRIVATE_SERVER_TEXT";
  await reader.read(accountingTarget, { current: () => true, changed() {}, fetch: async (url, init, current) => { assert.equal(current(), true); requests.push({ url, init }); return Response.json(value); } });
  assert.equal(requests.length, 1); assert.equal(requests[0].url, "/api/admin/generation-accounting?jobId=job-1"); assert.equal(requests[0].init.method, "GET"); assert.equal(requests[0].init.cache, "no-store"); assert.ok(requests[0].init.signal instanceof AbortSignal);
  assert.equal(reader.state().status, "ready"); assert.equal(reader.state().preview.accounting.totalReceiptCostMicrousd, null);
  assert.doesNotMatch(JSON.stringify(reader.state()), /PRIVATE_|responseRef|raw|note/u);
});

test("wrong target, mutating capability, malformed receipt or inconsistent totals are unavailable", async () => {
  for (const alter of [p => { p.job.jobId = "another"; }, p => { p.job.documentId = "another"; }, p => { p.job.attemptCount = 2; }, p => { p.job.status = "completed"; }, p => { p.mutationAvailable = true; }, p => { p.providerCalls = 1; }, p => { p.ledgerWrites = 1; }, p => { p.accounting.proposedSettlementMicrousd = 0; }, p => { p.accounting.totalReceiptCostMicrousd = 0; }, p => { p.calls[0].costMicrousd = -1; }, p => { p.snapshotSha256 = "PRIVATE"; }, p => { p.accounting.recordedProviderCallCount = null; }]) {
    const value = accountingResponse(); alter(value.preview);
    assert.throws(() => accountingPreviewForInspection(value, accountingTarget), /accounting_preview_unavailable/u);
  }
});

test("accepted or unrecorded calls cannot masquerade as known/free or complete history in the UI", () => {
  for (const alter of [
    p => { p.calls[2].accountingReason = null; p.accounting.unresolvedCallCount = 0; p.accounting.allCallsKnown = true; p.accounting.totalReceiptCostMicrousd = 110000; },
    p => { p.calls[0].totalTokens = 149; },
    p => { p.calls[1].status = "rejected"; },
    p => { p.accounting.callHistoryReason = "recorded_call_count_unavailable"; },
  ]) { const value = accountingResponse(); alter(value.preview); assert.throws(() => accountingPreviewForInspection(value, accountingTarget), /accounting_preview_unavailable/u); }
  const partial = accountingResponse(); partial.preview.accounting.recordedProviderCallCount = null; partial.preview.accounting.callHistoryComplete = false; partial.preview.accounting.callHistoryReason = "recorded_call_count_unavailable";
  assert.equal(accountingPreviewForInspection(partial, accountingTarget).accounting.callHistoryComplete, false);
});

test("cancel synchronously erases state; late headers or rejection cannot promote or report to a closed owner", async () => {
  for (const outcome of ["response", "error"]) {
    const gate = deferred(), reader = createGenerationAccountingReader(); let changes = 0, signal;
    const pending = reader.read(accountingTarget, { current: () => true, changed: () => { changes++; }, fetch: async (_url, init) => { signal = init.signal; return gate.promise; } });
    assert.equal(reader.state().status, "loading"); reader.cancel(); assert.equal(reader.state().status, "idle"); assert.equal(signal.aborted, true);
    if (outcome === "response") gate.resolve(response()); else gate.reject(new Error("PRIVATE_FAILURE"));
    await pending; assert.deepEqual(reader.state(), { status: "idle", preview: null }); assert.equal(changes, 1);
  }
});

test("a same-job reopen has a new owner and cannot receive the old operation's completion", async () => {
  const gate = deferred(), reader = createGenerationAccountingReader();
  const old = reader.read(accountingTarget, { current: () => true, changed() {}, fetch: async () => gate.promise });
  reader.cancel();
  const newer = accountingResponse(); newer.preview.snapshotSha256 = "d".repeat(64);
  await reader.read(accountingTarget, { current: () => true, changed() {}, fetch: async () => Response.json(newer) });
  gate.resolve(response()); await old;
  assert.equal(reader.state().preview.snapshotSha256, "d".repeat(64));
});

test("route, authorization, inspection and caller-current retirement suppress deferred body promotion", async () => {
  for (const change of ["route", "auth", "inspection", "caller"]) {
    const reader = createGenerationAccountingReader(); let current = true, stream, canceled = 0, changes = 0;
    const body = new ReadableStream({ start(controller) { stream = controller; }, cancel() { canceled++; } });
    const pending = reader.read(accountingTarget, { current: () => current, changed() { changes++; }, fetch: async () => new Response(body, { headers: { "content-type": "application/json" } }) });
    await tick(); current = false;
    stream.enqueue(new TextEncoder().encode(JSON.stringify(accountingResponse()))); stream.close(); await pending;
    assert.equal(reader.state().status, "idle", change); assert.equal(changes, 1, change); assert.ok(canceled <= 1);
  }
});

test("stale or throwing ownership refuses dispatch; stale ready data is erased when read", async () => {
  const reader = createGenerationAccountingReader(); let requests = 0;
  for (const current of [() => false, () => { throw new Error("retired"); }]) await reader.read(accountingTarget, { current, changed() {}, fetch: async () => { requests++; return response(); } });
  assert.equal(requests, 0);
  let current = true; await reader.read(accountingTarget, { current: () => current, changed() {}, fetch: async () => response() });
  assert.equal(reader.state().status, "ready"); current = false; assert.equal(reader.state().status, "idle");
});

test("failed, HTML, malformed, oversized and unexpected stream responses show only generic unavailable state", async () => {
  for (const responseFactory of [() => Response.json({ error: "PRIVATE_FAILURE" }, { status: 403 }), () => new Response("PRIVATE_HTML", { headers: { "content-type": "text/html" } }), () => new Response("PRIVATE_BAD_JSON", { headers: { "content-type": "application/json" } }), () => new Response("x".repeat(262145), { headers: { "content-type": "application/json" } }), () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "262145" } })]) {
    const reader = createGenerationAccountingReader(); await reader.read(accountingTarget, { current: () => true, changed() {}, fetch: async () => responseFactory() });
    assert.deepEqual(reader.state(), { status: "unavailable", preview: null });
  }
});

test("an unavailable read can be explicitly repeated without buying or settling anything", async () => {
  const reader = createGenerationAccountingReader(); let requests = 0;
  const ports = { current: () => true, changed() {}, fetch: async () => { requests++; return requests === 1 ? Response.json({}, { status: 503 }) : response(); } };
  await reader.read(accountingTarget, ports); assert.equal(reader.state().status, "unavailable");
  await reader.read(accountingTarget, ports); assert.equal(reader.state().status, "ready"); assert.equal(requests, 2);
});
