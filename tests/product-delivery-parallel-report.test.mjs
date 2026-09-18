import test from "node:test";
import assert from "node:assert/strict";
import { fixture, assertOriginalWrite, endpoint, calls, updates, receipts, money } from "./helpers/product-delivery-update-draft-fixture.mjs";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";

// These five bodies are byte-identical to the separately pinned standalone
// causal proof. Actual RAM Worker; finite HTTP delivery/native event ports only.
const observe = record => console.log("PRODUCT_PARALLEL_REPORT_OBSERVATION " + JSON.stringify(record));

for (const reportStatus of [200, 503]) test("Product Delivery held positive PATCH survives parallel report " + reportStatus, async t => {
  const x = await fixture(t), { f, row, draftA, draftB } = x;
  const gate = sceneDeferred(), oldBase = row.form.getAttribute("data-delivery-revision");
  let entered = false, parallelRead = false, actualReply = null;
  f.deliver = async (call, response) => {
    if (!entered && call.url === endpoint && call.method === "PATCH") {
      assert.equal(response.status, 200);
      actualReply = (await response.clone().json()).decision;
      assert.equal(actualReply.decisionId, x.originalId);
      entered = true; await gate.promise;
    } else if (entered && !parallelRead && call.url === endpoint && call.method === "GET") {
      assert.equal(response.status, 200, "The actual authorized report exists before any finite delivery fault.");
      parallelRead = true;
      if (reportStatus === 503) return Response.json({ error: "finite_parallel_report_unavailable" }, { status: 503 });
    }
    return response;
  };
  const pending = f.submitUpdate(row);
  let duringRead;
  try {
    await untilScene(() => entered, "Actual A committed; its positive PATCH response is held.");
    f.editUpdate(row, draftB); f.draw();
    await f.refresh(); const markup = f.draw(); // The actual current dashboard Refresh remains available during Save.
    assert.equal(parallelRead, true); assertOriginalWrite(x);
    assert.equal(row.form.isConnected, true); assert.deepEqual(f.updateValues(row), draftB);
    assert.equal(row.form.getAttribute("data-delivery-revision"), oldBase, "A parallel GET is not the held PATCH acknowledgement.");
    assert.equal(markup.includes(f.i18n.t("delivery.saved")), false);
    assert.equal(markup.includes(f.i18n.t("delivery.updateSavedDraftKept")), false);
    assert.equal(row.hidden || row.inert, reportStatus === 503);
    duringRead = { hidden: row.hidden, inert: row.inert, base: row.form.getAttribute("data-delivery-revision") };
  } finally { gate.resolve(); await pending; }
  const afterMarkup = f.draw(), afterAck = { base: row.form.getAttribute("data-delivery-revision"),
    completion: afterMarkup.includes(f.i18n.t("delivery.updateSavedDraftKept")) };
  assertOriginalWrite(x);
  f.deliver = undefined; await f.refresh(); const restoredMarkup = f.draw();
  const current = f.updateRow(draftA.title), restored = {
    base: current.form.getAttribute("data-delivery-revision"),
    completion: restoredMarkup.includes(f.i18n.t("delivery.updateSavedDraftKept")),
    sameForm: current.form === row.form, saveDisabled: Object.hasOwn(current.saveButton.attributes, "disabled")
  };
  assertOriginalWrite(x);
  observe({ case: "parallel-report-" + reportStatus, originalId: x.originalId, actualPatchStatus: 200,
    finiteReportDeliveryStatus: reportStatus, oldBase, actualAcknowledgedRevision: actualReply.updatedAt, duringRead, afterAck, restored });
  assert.equal(restored.sameForm, true); assert.deepEqual(f.updateValues(current), draftB);
  assert.equal(afterAck.base, actualReply.updatedAt, "The still-owned exact positive PATCH, not a later GET, acknowledges A's base.");
  assert.equal(restored.base, actualReply.updatedAt);
  assert.equal(afterAck.completion, true); assert.equal(restored.completion, true);
  assert.equal(restored.saveDisabled, false, "B remains deliberately editable after known A and a healthy current report.");
});

for (const status of [500, 503]) test("Product Delivery committed PATCH delivered as finite " + status + " remains unconfirmed", async t => {
  const x = await fixture(t), { f, row, draftA, draftB } = x, gate = sceneDeferred();
  const oldBase = row.form.getAttribute("data-delivery-revision");
  let entered = false, actualReply = null;
  f.deliver = async (call, response) => {
    if (!entered && call.url === endpoint && call.method === "PATCH") {
      assert.equal(response.status, 200);
      actualReply = (await response.clone().json()).decision;
      assert.equal(actualReply.decisionId, x.originalId);
      entered = true; await gate.promise;
      // Finite gateway/HTTP-delivery fault after genuine Worker 200.
      // This is not an observation that the actual Worker returned 5xx.
      return Response.json({ error: "finite_patch_gateway_unavailable" }, { status });
    }
    return response;
  };
  const pending = f.submitUpdate(row);
  try {
    await untilScene(() => entered, "Real A committed before the explicitly finite 5xx delivery.");
    f.editUpdate(row, draftB); f.draw();
  } finally { gate.resolve(); await pending; }
  const beforeMarkup = f.draw();
  const unknownText = f.i18n.t("delivery.updateUnknown");
  const beforeRead = { unknown: beforeMarkup.includes(unknownText),
    definiteFailure: beforeMarkup.includes(f.i18n.t("delivery.failed")),
    saved: beforeMarkup.includes(f.i18n.t("delivery.saved")),
    draftCompletion: beforeMarkup.includes(f.i18n.t("delivery.updateSavedDraftKept")),
    base: row.form.getAttribute("data-delivery-revision") };
  assertOriginalWrite(x); assert.equal(calls(f, "GET").length, x.before.gets, "A non-ACK response must not automatically read or retry.");
  f.deliver = undefined; await f.refresh(); const markup = f.draw(), current = f.updateRow(draftA.title);
  const afterRead = { unknown: markup.includes(unknownText),
    definiteFailure: markup.includes(f.i18n.t("delivery.failed")),
    saved: markup.includes(f.i18n.t("delivery.saved")),
    draftCompletion: markup.includes(f.i18n.t("delivery.updateSavedDraftKept")),
    base: current.form.getAttribute("data-delivery-revision") };
  assertOriginalWrite(x);
  observe({ case: "finite-patch-status-" + status, originalId: x.originalId, actualPatchStatus: 200,
    finiteDeliveredStatus: status, actualCommittedRevision: actualReply.updatedAt, oldBase, beforeRead, afterRead });
  assert.equal(current.form === row.form, true); assert.deepEqual(f.updateValues(current), draftB);
  assert.deepEqual(beforeRead, { unknown: true, definiteFailure: false, saved: false, draftCompletion: false, base: oldBase });
  assert.deepEqual(afterRead, beforeRead, "A later real GET is not an acknowledgement or rebase of the uncertain PATCH.");
  assert.notEqual(actualReply.updatedAt, oldBase);
  assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), true, "Dirty B still needs explicit revision reconciliation; no exact PATCH replay was invented.");
});

test("Product Delivery genuine Worker 409 remains a known no-write revision refusal", async t => {
  const x = await fixture(t), { f, row, draftA, draftB, before } = x;
  const original = before.decisions.find(item => item.decision_id === x.originalId);
  const foreign = { decisionId: x.originalId, expectedUpdatedAt: original.updated_at,
    title: "Independent writer's current decision", evidence: "Current independent writer evidence",
    ownerUserId: f.storeHost.worker.owner, status: "running" };
  // A separate actual authorized HTTP writer advances the canonical revision;
  // the mounted form intentionally has not read that new revision yet.
  const foreignResponse = await f.storeHost.worker.request(endpoint, { method: "PATCH",
    headers: { "content-type": "application/json" }, body: JSON.stringify(foreign) });
  assert.equal(foreignResponse.status, 200);
  const foreignReply = await foreignResponse.json();
  const foreignRows = f.decisions(), foreignEvents = updates(f);
  const gate = sceneDeferred(); let entered = false, refusal = null;
  f.deliver = async (call, response) => {
    if (!entered && call.url === endpoint && call.method === "PATCH") {
      assert.equal(response.status, 409);
      refusal = await response.clone().json();
      assert.equal(refusal.error, "delivery_decision_revision_conflict");
      entered = true; await gate.promise;
    }
    return response;
  };
  const pending = f.submitUpdate(row);
  try {
    await untilScene(() => entered, "The actual stale revision is refused before its attempted A write.");
    f.editUpdate(row, draftB); f.draw();
  } finally { gate.resolve(); await pending; }
  const beforeMarkup = f.draw(), oldBase = row.form.getAttribute("data-delivery-revision");
  f.deliver = undefined; await f.refresh(); const markup = f.draw(), current = f.updateRow(foreign.title);
  const posture = { conflict: markup.includes(f.i18n.t("delivery.conflict")),
    unknown: markup.includes(f.i18n.t("delivery.updateUnknown")),
    saved: markup.includes(f.i18n.t("delivery.saved")),
    sameForm: current.form === row.form, base: current.form.getAttribute("data-delivery-revision") };
  observe({ case: "actual-worker-409", originalId: x.originalId, actualStatus: 409, error: refusal.error,
    originalRevision: original.updated_at, independentRevision: foreignReply.decision.updatedAt, posture,
    attemptedPatches: calls(f, "PATCH").length - before.patches, actualUpdateEvents: updates(f).length - before.updates });
  assert.ok(beforeMarkup.includes(f.i18n.t("delivery.conflict")));
  assert.equal(posture.conflict, true); assert.equal(posture.unknown, false); assert.equal(posture.saved, false);
  assert.equal(posture.sameForm, true); assert.deepEqual(f.updateValues(current), draftB);
  assert.equal(oldBase, original.updated_at); assert.equal(posture.base, oldBase);
  assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), true);
  assert.deepEqual(calls(f, "PATCH").at(-1).body, { decisionId: x.originalId, ...draftA, expectedUpdatedAt: oldBase });
  assert.equal(calls(f, "PATCH").length, before.patches + 1);
  assert.deepEqual(f.decisions(), foreignRows); assert.deepEqual(updates(f), foreignEvents);
  assert.equal(foreignEvents.length, before.updates + 1, "Only the independent writer committed; the stale attempted A added no update.");
  assert.equal(calls(f, "POST").length, before.posts); assert.deepEqual(f.creationEvents(), before.creations);
  assert.deepEqual(receipts(f), before.receipts); assert.deepEqual(money(f), before.money); assert.deepEqual(f.external, []);
});
