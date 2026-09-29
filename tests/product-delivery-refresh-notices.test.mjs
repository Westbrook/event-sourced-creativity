import test from "node:test";
import assert from "node:assert/strict";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { productDeliveryFixture } from "./helpers/product-delivery-native-fixture.mjs";
import { fixture, assertOriginalWrite, endpoint, calls, updates, receipts, money } from "./helpers/product-delivery-update-draft-fixture.mjs";

// Additive notice controls. Actual complete host, session and RAM Worker;
// only positive-response delivery faults/timing and native form events are ports.
// This file does not alter the existing twelve baseline or six boundary bodies.
async function acknowledgedUpdateWithUnavailableReport(t) {
  const x = await fixture(t), { f, row, draftB } = x;
  const gate = sceneDeferred(); let entered = false, faulted = false;
  f.deliver = async (call, response) => {
    if (!entered && call.url === endpoint && call.method === "PATCH") {
      assert.equal(response.status, 200); entered = true; await gate.promise;
    } else if (entered && !faulted && call.url === endpoint && call.method === "GET") {
      assert.equal(response.status, 200, "Actual authorized report exists before the finite delivery fault.");
      faulted = true; return Response.json({ error: "notice_report_delivery_unavailable" }, { status: 503 });
    }
    return response;
  };
  const pending = f.submitUpdate(row);
  try {
    await untilScene(() => entered, "The original actual PATCH is committed before its positive response.");
    f.editUpdate(row, draftB); f.draw();
  } finally { gate.resolve(); await pending; }
  const markup = f.draw();
  assert.equal(faulted, true); assertOriginalWrite(x);
  assert.ok(markup.includes(f.i18n.t("delivery.savedRefreshFailed")));
  assert.equal(row.form.isConnected, true); assert.equal(row.hidden && row.inert, true);
  assert.deepEqual(f.updateValues(row), draftB);
  assert.equal(row.form.getAttribute("data-delivery-revision"), f.decisions().find(item => item.decision_id === x.originalId).updated_at);
  f.deliver = undefined; return x;
}

for (const outcome of ["success", "denial"]) test("Product Delivery acknowledged update refresh warning " + outcome, async t => {
  const x = await acknowledgedUpdateWithUnavailableReport(t), { f, row, draftA, draftB } = x;
  const acknowledgedRevision = row.form.getAttribute("data-delivery-revision");
  let readStatus = null;
  if (outcome === "denial") {
    f.storeHost.worker.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE grant_id=?")
      .run(new Date().toISOString(), x.manager.grantId);
  }
  f.deliver = async (call, response) => {
    if (call.url === endpoint && call.method === "GET") readStatus = response.status;
    return response;
  };
  await f.refresh(); const markup = f.draw(); assertOriginalWrite(x);
  const warning = markup.includes(f.i18n.t("delivery.savedRefreshFailed"));
  const draftKept = markup.includes(f.i18n.t("delivery.updateSavedDraftKept"));
  console.log("PRODUCT_REFRESH_NOTICE_OBSERVATION " + JSON.stringify({ case: outcome, readStatus, warning, draftKept,
    originalId: x.originalId, originalFormConnected: row.form.isConnected, patches: calls(f, "PATCH").length - x.before.patches }));
  if (outcome === "success") {
    assert.equal(readStatus, 200);
    const current = f.updateRow(draftA.title);
    assert.equal(current.form === row.form, true); assert.equal(current.hidden || current.inert, false);
    assert.deepEqual(f.updateValues(current), draftB); assert.equal(current.form.getAttribute("data-delivery-revision"), acknowledgedRevision);
    assert.equal(current.form.getAttribute("data-delivery-dirty"), "true");
    assert.equal(warning, false, "A later current successful Refresh retires the obsolete refresh-failed warning.");
    assert.equal(draftKept, true, "Restore the original ACK's exact completion: newer raw B remains unsubmitted.");
  } else {
    assert.equal(readStatus, 403, "Real Worker capability denial, not a synthetic negative response.");
    assert.equal(row.form.isConnected, false); assert.equal(f.updateRows().length, 0);
    assert.equal(draftKept, false); assert.equal(markup.includes(f.i18n.t("delivery.saved")), false);
    assert.equal(warning, true, "Denial cannot turn the earlier warning into a current success announcement.");
    assert.ok(!markup.includes(draftB.title.trim()) && !markup.includes(draftB.evidence.trim()));
  }
});

for (const fault of ["transport", "malformed"]) test("Product Delivery older report cannot acknowledge a newer " + fault + " PATCH", async t => {
  const x = await acknowledgedUpdateWithUnavailableReport(t), { f, row, draftA, draftB, before } = x;
  const gate = sceneDeferred(); let oldReadEntered = false, lostPositive = false;
  f.deliver = async (call, response) => {
    if (!oldReadEntered && call.url === endpoint && call.method === "GET") {
      assert.equal(response.status, 200); oldReadEntered = true; await gate.promise;
    } else if (call.url === endpoint && call.method === "PATCH") {
      assert.equal(response.status, 200); lostPositive = true;
      if (fault === "transport") throw new TypeError("The real newer committed PATCH response was lost");
      const body = await response.json(); assert.equal(body.decision.decisionId, x.originalId);
      return Response.json({ ...body, decision: { ...body.decision, decisionId: "finite-mismatched-ack" } }, { status: 200 });
    }
    return response;
  };
  const oldRead = f.refresh(); let acknowledgedRevision;
  try {
    await untilScene(() => oldReadEntered, "An older current recovery report is genuinely held.");
    await f.refresh(); f.draw(); // A separately completed current read restores visibility, not a new write ACK.
    const current = f.updateRow(draftA.title);
    assert.equal(current.form === row.form, true); assert.deepEqual(f.updateValues(current), draftB);
    acknowledgedRevision = current.form.getAttribute("data-delivery-revision");
    await f.submitUpdate(current); f.draw();
    assert.equal(lostPositive, true);
    assert.equal(current.form.getAttribute("data-delivery-revision"), acknowledgedRevision);
  } finally { gate.resolve(); await oldRead; }
  let markup = f.draw();
  const unknownText = f.i18n.t("delivery.updateUnknown", "The submitted update is unconfirmed. Refresh current evidence to inspect the decision. Your retained fields have not been submitted again.");
  const beforeRead = { unknown: markup.includes(unknownText), definiteFailure: markup.includes(f.i18n.t("delivery.failed")),
    saved: markup.includes(f.i18n.t("delivery.saved")), oldCompletion: markup.includes(f.i18n.t("delivery.updateSavedDraftKept")) };
  f.deliver = undefined; await f.refresh(); markup = f.draw();
  const canonical = f.decisions().find(item => item.decision_id === x.originalId);
  const current = f.updateRow(draftB.title.trim());
  console.log("PRODUCT_REFRESH_NOTICE_OBSERVATION " + JSON.stringify({ case: "newer-" + fault, beforeRead,
    unknownAfterRead: markup.includes(unknownText), originalId: x.originalId, sameForm: current.form === row.form,
    acknowledgedRevision, retainedRevision: current.form.getAttribute("data-delivery-revision"), canonicalRevision: canonical.updated_at }));
  assert.deepEqual(beforeRead, { unknown: true, definiteFailure: false, saved: false, oldCompletion: false },
    "An older read cannot overwrite the newer unknown or describe a lost positive ACK as definitely failed.");
  assert.ok(markup.includes(unknownText)); assert.ok(!markup.includes(f.i18n.t("delivery.saved")));
  assert.equal(current.form === row.form, true); assert.deepEqual(f.updateValues(current), draftB);
  assert.equal(current.form.getAttribute("data-delivery-revision"), acknowledgedRevision);
  assert.notEqual(canonical.updated_at, acknowledgedRevision);
  assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), true, "A GET cannot acknowledge or rebase the unknown dirty update.");
  assert.equal(canonical.title, draftB.title.trim()); assert.equal(canonical.evidence, draftB.evidence.trim());
  assert.equal(canonical.owner_user_id, draftB.ownerUserId); assert.equal(canonical.status, draftB.status);
  assert.deepEqual(calls(f, "PATCH").at(-1).body, { decisionId: x.originalId, ...draftB, expectedUpdatedAt: acknowledgedRevision });
  assert.equal(calls(f, "PATCH").length, before.patches + 2); assert.equal(updates(f).length, before.updates + 2);
  assert.equal(calls(f, "POST").length, before.posts); assert.deepEqual(f.creationEvents(), before.creations);
  assert.deepEqual(receipts(f), before.receipts); assert.deepEqual(money(f), before.money); assert.deepEqual(f.external, []);
});

for (const edited of [false, true]) test("Product Delivery create refresh warning restores " + (edited ? "the retained-draft completion" : "the unchanged completion"), async t => {
  const f = await productDeliveryFixture(t), form = f.form(), gate = sceneDeferred();
  const draftA = { title: "Original acknowledged create", audience: "product", evidence: "Original create evidence",
    ownerUserId: f.storeHost.worker.owner, dependencies: [] };
  const draftB = { ...draftA, title: "Newer create fields remain unsubmitted", evidence: "Newer private raw create fields" };
  const before = { posts: calls(f, "POST").length, patches: calls(f, "PATCH").length, money: money(f), decisions: f.decisions().length };
  let entered = false, faulted = false;
  f.deliver = async (call, response) => {
    if (!entered && call.url === endpoint && call.method === "POST") {
      assert.equal(response.status, 201); entered = true; await gate.promise;
    } else if (entered && !faulted && call.url === endpoint && call.method === "GET") {
      assert.equal(response.status, 200); faulted = true;
      return Response.json({ error: "notice_create_report_delivery_unavailable" }, { status: 503 });
    }
    return response;
  };
  f.fill(form, draftA); const pending = f.submit(form);
  try {
    await untilScene(() => entered, "Actual original create receipt exists before delivered acknowledgment.");
    if (edited) f.fill(form, draftB); // Existing finite FormData input port; no detached handler or private method.
  } finally { gate.resolve(); await pending; }
  const failedMarkup = f.draw(); assert.equal(faulted, true);
  assert.ok(failedMarkup.includes(f.i18n.t("delivery.savedRefreshFailed")));
  const committed = f.decisions(); const eventSnapshot = f.creationEvents(), receiptSnapshot = receipts(f);
  assert.equal(committed.length, before.decisions + 1);
  assert.equal(committed.filter(item => item.title === draftA.title).length, 1);
  assert.equal(committed.filter(item => item.title === draftB.title).length, 0);
  f.deliver = undefined; await f.refresh(); const markup = f.draw();
  const completion = f.i18n.t(edited ? "delivery.originalSavedDraftKept" : "delivery.saved");
  console.log("PRODUCT_REFRESH_NOTICE_OBSERVATION " + JSON.stringify({ case: edited ? "create-edited" : "create-unchanged",
    warning: markup.includes(f.i18n.t("delivery.savedRefreshFailed")), completion: markup.includes(completion),
    committedCount: committed.length, posts: calls(f, "POST").length - before.posts }));
  assert.ok(!markup.includes(f.i18n.t("delivery.savedRefreshFailed")));
  assert.ok(markup.includes(completion), "Restore the existing receipt-backed Create completion, not a generic GET acknowledgment.");
  assert.deepEqual(f.decisions(), committed); assert.deepEqual(f.creationEvents(), eventSnapshot); assert.deepEqual(receipts(f), receiptSnapshot);
  assert.equal(calls(f, "POST").length, before.posts + 1); assert.equal(calls(f, "PATCH").length, before.patches);
  assert.deepEqual(money(f), before.money); assert.deepEqual(f.external, []);
});
