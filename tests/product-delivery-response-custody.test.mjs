import test from "node:test";
import assert from "node:assert/strict";
import { fixture, hold, assertOriginalWrite, endpoint, grantManager } from "./helpers/product-delivery-update-draft-fixture.mjs";
import { untilScene } from "./helpers/scene-cost-store-host.mjs";

// Separate admission/lifetime controls for the response-custody repair.
// Actual host/session/RAM Worker; finite native and HTTP timing ports only.
test("Product Delivery positive PATCH body retains its owner through a parallel unavailable report", async t => {
  const x = await fixture(t), { f, row, draftA, draftB } = x, boundary = hold(f, "json");
  const oldBase = row.form.getAttribute("data-delivery-revision"), deliver = f.deliver;
  let failedRead = false;
  f.deliver = async (call, response) => {
    if (!failedRead && call.url === endpoint && call.method === "GET") {
      assert.equal(response.status, 200); failedRead = true;
      return Response.json({ error: "finite_report_during_patch_body" }, { status: 503 });
    }
    return deliver(call, response);
  };
  const pending = f.submitUpdate(row);
  try {
    await untilScene(boundary.entered, "Real positive PATCH headers arrived and its original body is held.");
    f.editUpdate(row, draftB); f.draw(); await f.refresh(); f.draw();
    assert.equal(failedRead, true); assert.equal(row.form.isConnected, true); assert.equal(row.hidden && row.inert, true);
    assert.deepEqual(f.updateValues(row), draftB); assert.equal(row.form.getAttribute("data-delivery-revision"), oldBase);
  } finally { boundary.gate.resolve(); await pending; }
  const markup = f.draw(), current = f.updateRow(draftA.title), canonical = f.decisions().find(item => item.decision_id === x.originalId);
  assertOriginalWrite(x);
  console.log("PRODUCT_RESPONSE_CUSTODY_CONTROL " + JSON.stringify({ case: "held-json", originalId: x.originalId,
    ...boundary.evidence(), sameForm: current.form === row.form, originalBase: oldBase,
    retainedBase: current.form.getAttribute("data-delivery-revision"), canonicalBase: canonical.updated_at,
    completion: markup.includes(f.i18n.t("delivery.updateSavedDraftKept")) }));
  assert.equal(boundary.evidence().jsonCalls, 1); assert.equal(current.form === row.form, true);
  assert.deepEqual(f.updateValues(current), draftB); assert.equal(current.form.getAttribute("data-delivery-revision"), canonical.updated_at);
  assert.ok(markup.includes(f.i18n.t("delivery.updateSavedDraftKept")));
  assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), false);
});

test("Product Delivery actual report denial then restoration cannot revive an old positive PATCH owner", async t => {
  const x = await fixture(t), { f, row, draftA, draftB } = x, boundary = hold(f, "headers"), deliver = f.deliver;
  const statuses = []; let restored = null, restoredDraft = null;
  f.deliver = async (call, response) => {
    if (call.url === endpoint && call.method === "GET") statuses.push(response.status);
    return deliver(call, response);
  };
  const pending = f.submitUpdate(row);
  try {
    await untilScene(boundary.entered, "A really committed before its original positive response was held.");
    f.editUpdate(row, draftB); f.draw();
    f.storeHost.worker.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE grant_id=?")
      .run(new Date().toISOString(), x.manager.grantId);
    await f.refresh(); f.draw();
    assert.deepEqual(statuses, [403]); assert.equal(row.form.isConnected, false); assert.equal(f.updateRows().length, 0);
    assert.ok(f.platformSession.get().capabilities.includes("product.delivery.manage"), "Cached client capability cannot defeat real report denial.");
    f.storeHost.worker.sqlite.prepare("UPDATE capability_grants SET status='active',revoked_at=NULL WHERE grant_id=?").run(x.manager.grantId);
    await f.refresh(); f.draw(); assert.deepEqual(statuses, [403, 200]);
    restored = f.updateRow(draftA.title); assert.equal(restored.form === row.form, false);
    restoredDraft = { ...f.updateValues(restored), title: "Restored current owner's unsent C", evidence: "Only the new owned form's raw C" };
    f.editUpdate(restored, restoredDraft); f.draw();
  } finally { boundary.gate.resolve(); await pending; }
  const markup = f.draw(), current = f.updateRow(draftA.title); assertOriginalWrite(x);
  console.log("PRODUCT_RESPONSE_CUSTODY_CONTROL " + JSON.stringify({ case: "actual403-restored-before-ack",
    originalId: x.originalId, statuses, oldFormConnected: row.form.isConnected, retainedRestoredForm: current.form === restored.form,
    saved: markup.includes(f.i18n.t("delivery.saved")), completion: markup.includes(f.i18n.t("delivery.updateSavedDraftKept")) }));
  assert.equal(row.form.isConnected, false); assert.equal(current.form === restored.form, true);
  assert.deepEqual(f.updateValues(current), restoredDraft);
  assert.ok(!markup.includes(f.i18n.t("delivery.saved")) && !markup.includes(f.i18n.t("delivery.updateSavedDraftKept")));
  assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), false);
});

test("Product Delivery query departure retires a retained unavailable-form PATCH owner", async t => {
  const x = await fixture(t), { f, row, draftB } = x, boundary = hold(f, "headers"), deliver = f.deliver;
  // Opt into the existing native URL port so this query reaches location.search.
  // The default flat fixture intentionally exposes pathname only.
  f.nativeUrlParts = true;
  let failedRead = false;
  f.deliver = async (call, response) => {
    if (!failedRead && call.url === endpoint && call.method === "GET") {
      assert.equal(response.status, 200); failedRead = true;
      return Response.json({ error: "finite_report_before_query_departure" }, { status: 503 });
    }
    return deliver(call, response);
  };
  const pending = f.submitUpdate(row);
  try {
    await untilScene(boundary.entered, "Actual committed A remains held before the finite report failure.");
    f.editUpdate(row, draftB); f.draw(); await f.refresh(); f.draw();
    assert.equal(row.form.isConnected, true); assert.equal(row.hidden && row.inert, true);
    f.store.route.set("/product/delivery?current-task=another"); f.emitWindow("popstate"); f.draw();
    assert.equal(row.form.isConnected, false); assert.equal(f.updateRows().length, 0);
  } finally { boundary.gate.resolve(); await pending; }
  const markup = f.draw(); assertOriginalWrite(x);
  console.log("PRODUCT_RESPONSE_CUSTODY_CONTROL " + JSON.stringify({ case: "query-departure", originalId: x.originalId,
    oldFormConnected: row.form.isConnected, rows: f.updateRows().length, saved: markup.includes(f.i18n.t("delivery.saved")) }));
  assert.equal(f.updateRows().length, 0);
  assert.ok(!markup.includes(f.i18n.t("delivery.saved")) && !markup.includes(f.i18n.t("delivery.updateSavedDraftKept")));
});

test("Product Delivery a current read-only successor cannot inherit old PATCH publication or edit admission", async t => {
  const x = await fixture(t), { f, row, draftA, draftB } = x, boundary = hold(f, "headers");
  const pending = f.submitUpdate(row); let successor;
  try {
    await untilScene(boundary.entered, "Original manager's actual A commits before the principal change.");
    f.editUpdate(row, draftB); f.draw();
    successor = await grantManager(f, "patch-read-only-successor");
    f.storeHost.worker.sqlite.prepare("UPDATE capability_grants SET capability='product.delivery.read' WHERE grant_id=?").run(successor.grantId);
    f.platformSession.reset(); f.draw();
    const session = await f.platformSession.load("product");
    assert.equal(session.user.userId, successor.id); assert.ok(session.capabilities.includes("product.delivery.read"));
    assert.equal(session.capabilities.includes("product.delivery.manage"), false);
    await untilScene(() => f.draw().includes(f.i18n.t("delivery.readOnly")), "The actual read-only principal's current report is mounted.");
    assert.equal(row.form.isConnected, false); assert.equal(f.updateRows().length, 0);
    assert.equal(f.renderer.ownNodes(f.host, "form").length, 0, "Real current read-only reporting offers neither Create nor Update controls.");
  } finally { boundary.gate.resolve(); await pending; }
  const markup = f.draw(); assertOriginalWrite(x);
  console.log("PRODUCT_RESPONSE_CUSTODY_CONTROL " + JSON.stringify({ case: "read-only-successor", originalId: x.originalId,
    principal: f.platformSession.get().user.userId, manage: f.platformSession.get().capabilities.includes("product.delivery.manage"),
    forms: f.renderer.ownNodes(f.host, "form").length, saved: markup.includes(f.i18n.t("delivery.saved")) }));
  assert.ok(markup.includes(draftA.title)); assert.ok(markup.includes(f.i18n.t("delivery.readOnly")));
  assert.equal(f.renderer.ownNodes(f.host, "form").length, 0);
  assert.ok(!markup.includes(draftB.title.trim()) && !markup.includes(draftB.evidence.trim()));
  assert.ok(!markup.includes(f.i18n.t("delivery.saved")) && !markup.includes(f.i18n.t("delivery.updateSavedDraftKept")));
});
