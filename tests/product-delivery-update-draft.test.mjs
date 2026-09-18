import test from "node:test";
import assert from "node:assert/strict";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { fixture, hold, assertOriginalWrite, observe, endpoint, grantManager, enterManager } from "./helpers/product-delivery-update-draft-fixture.mjs";

// All twelve baseline bodies are retained byte-for-byte; only imports/fixture extraction differ.
for (const stage of ["headers", "json", "report"]) for (const edited of [false, true])
  test("Product Delivery PATCH " + stage + " " + (edited ? "retains newer raw B" : "healthy unchanged A"), async t => {
    const x = await fixture(t), { f, row, draftA, draftB } = x, boundary = hold(f, stage);
    const pending = f.submitUpdate(row);
    try {
      await untilScene(boundary.entered, "The actual PATCH reaches its selected delivery boundary.");
      f.draw(); assert.equal(Object.hasOwn(row.saveButton.attributes, "disabled"), true);
      if (edited) f.editUpdate(row, draftB);
      const writes = row.commits.length;
      f.draw(); f.draw();
      assert.equal(row.commits.length, writes, "Actual Lit does not recommit unchanged bound model values during pending draws.");
      assert.deepEqual(f.updateValues(row), edited ? draftB : draftA, "The newer native input is genuinely present before release.");
    } finally { boundary.gate.resolve(); await pending; }
    f.draw(); assertOriginalWrite(x);
    const current = f.updateRow(draftA.title), actual = f.updateValues(current);
    observe(stage + (edited ? "-edited" : "-healthy"), x, { ...boundary.evidence(), currentForm: current.id,
      sameForm: current.form === row.form, actual, desired: edited ? draftB : draftA });
    assert.equal(current.form === row.form, true, "Same original row retains its native form without reordering.");
    assert.deepEqual(actual, edited ? draftB : draftA, "An acknowledged A must not erase later unsubmitted raw B.");
    assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), false);
  });

for (const edited of [false, true]) test("Product Delivery reordered PATCH " + (edited ? "retains B with its original decision" : "healthy current values follow rows"), async t => {
  const x = await fixture(t, true), { f, row, draftA, draftB } = x, boundary = hold(f, "report");
  const beforeRowIds = f.updateRows().map(item => ({ native: item.id, title: item.boundTitle }));
  const pending = f.submitUpdate(row);
  try {
    await untilScene(boundary.entered, "The real refreshed report is held before its new sort order is published.");
    if (edited) f.editUpdate(row, draftB);
    f.draw(); assert.deepEqual(f.updateValues(row), edited ? draftB : draftA);
  } finally { boundary.gate.resolve(); await pending; }
  f.draw(); assertOriginalWrite(x); const current = f.updateRow(draftA.title), actual = f.updateValues(current);
  assert.equal(current.index, 0, "The actual failed status moves original A ahead of its running companion.");
  observe(edited ? "reorder-edited" : "reorder-healthy", x, { beforeRowIds,
    afterRowIds: f.updateRows().map(item => ({ native: item.id, title: item.boundTitle })),
    currentForm: current.id, sameForm: current.form === row.form, actual, desired: edited ? draftB : draftA });
  assert.deepEqual(actual, edited ? draftB : draftA, "Raw B belongs to the exact decision, not the old numeric row position.");
  assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), false);
});

for (const retirement of ["pathname", "principal", "denial"]) test("Product Delivery late PATCH cannot publish across " + retirement + " retirement", async t => {
  const x = await fixture(t), { f, row, draftB } = x, boundary = hold(f, "headers");
  const pending = f.submitUpdate(row); let current = null, denialStatus = null;
  try {
    await untilScene(boundary.entered, "Actual A is committed before old-owner retirement.");
    f.editUpdate(row, draftB); f.draw();
    if (retirement === "pathname") {
      f.store.route.set("/product/insights"); f.emitWindow("popstate"); f.draw();
    } else if (retirement === "principal") {
      const next = await grantManager(f, "patch-draft-next-manager"); await enterManager(f, next);
      current = f.updateRow(x.draftA.title);
      f.editUpdate(current, { title: "New principal unsent C", evidence: "New principal raw evidence C" }); f.draw();
      assert.equal(current.form === row.form, false);
    } else {
      f.storeHost.worker.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE grant_id=?")
        .run(new Date().toISOString(), x.manager.grantId);
      const deliver = f.deliver;
      f.deliver = async (call, response) => {
        if (call.url === endpoint && call.method === "GET") denialStatus = response.status;
        return deliver(call, response);
      };
      await f.refresh(); f.draw(); assert.equal(denialStatus, 403, "Actual Worker capability denial, not a finite response replacement.");
      assert.ok(f.platformSession.get().capabilities.includes("product.delivery.manage"), "Cached client grant does not override the real report denial.");
    }
    assert.equal(row.form.isConnected, false, "The old private update form is withdrawn.");
  } finally { boundary.gate.resolve(); await pending; }
  const markup = f.draw(); assertOriginalWrite(x);
  const shown = f.updateRows();
  observe("retirement-" + retirement, x, { denialStatus, currentRows: shown.length,
    currentPrincipal: f.platformSession.get()?.user.userId ?? null, savedNotice: markup.includes(f.i18n.t("delivery.saved")) });
  assert.doesNotMatch(markup, /Delivery decision saved\./, "The late original response cannot announce success in a retired owner.");
  if (current) {
    assert.equal(f.updateRow(x.draftA.title).form === current.form, true);
    assert.equal(f.updateValues(current).title, "New principal unsent C");
    assert.equal(f.updateValues(current).evidence, "New principal raw evidence C");
    assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), false);
  } else assert.equal(shown.length, 0);
});


test("Product Delivery acknowledged PATCH keeps raw B across unavailable and restored current report", async t => {
  const x = await fixture(t), { f, row, draftA, draftB } = x;
  const gate = sceneDeferred(); let held = false, unavailable = false;
  f.deliver = async (call, response) => {
    if (!held && call.method === "PATCH") {
      assert.equal(response.status, 200); held = true; await gate.promise;
    } else if (held && !unavailable && call.method === "GET" && call.url === endpoint) {
      assert.equal(response.status, 200, "The actual authorized follow-up report existed before its finite HTTP delivery fault.");
      unavailable = true; return Response.json({ error: "temporary_update_report_delivery" }, { status: 503 });
    }
    return response;
  };
  const pending = f.submitUpdate(row);
  try {
    await untilScene(() => held, "The actual committed PATCH is held before its positive response reaches the host.");
    f.editUpdate(row, draftB); f.draw(); assert.deepEqual(f.updateValues(row), draftB);
  } finally { gate.resolve(); await pending; }
  const failedMarkup = f.draw(), removedDuringUnavailable = !row.form.isConnected;
  assert.equal(unavailable, true); assertOriginalWrite(x);
  f.deliver = undefined; await f.refresh(); f.draw();
  const current = f.updateRow(draftA.title), actual = f.updateValues(current);
  assertOriginalWrite(x);
  observe("unavailable-report-edited", x, { reportDeliveryStatus: 503, removedDuringUnavailable,
    failedMarkupHasSavedNotice: failedMarkup.includes(f.i18n.t("delivery.saved")),
    restoredForm: current.id, sameForm: current.form === row.form, actual, desired: draftB });
  assert.equal(current.form === row.form, true, "Same-owner temporary report delivery cannot replace the original native draft.");
  assert.deepEqual(actual, draftB, "A fresh GET restores visibility but is neither an acknowledgment nor permission to overwrite raw B.");
  assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), false);
});
