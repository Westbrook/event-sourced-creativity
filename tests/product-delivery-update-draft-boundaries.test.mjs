import test from "node:test";
import assert from "node:assert/strict";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { fixture, hold, assertOriginalWrite, observe, endpoint, calls, updates, receipts, money, grantManager } from "./helpers/product-delivery-update-draft-fixture.mjs";

// Additional controls are separate from the preserved baseline matrix.
  test("Product Delivery saving A preserves a different dirty decision through the same reordered report", async t => {
    const x = await fixture(t, true), { f, row, draftA, draftB } = x;
    const companion = f.updateRow("Companion milestone");
    const companionDraft = { ...f.updateValues(companion), title: "Other row unsent C", evidence: "Other row raw C\n文書", status: "failed" };
    f.editUpdate(companion, companionDraft);
    const companionRevision = companion.form.getAttribute("data-delivery-revision"), boundary = hold(f, "report"), pending = f.submitUpdate(row);
    try {
      await untilScene(boundary.entered, "A's actual update and reordered report arrive.");
      f.editUpdate(row, draftB); f.draw();
    } finally { boundary.gate.resolve(); await pending; }
    f.draw(); assertOriginalWrite(x);
    const current = f.updateRow(draftA.title), other = f.updateRow("Companion milestone");
    observe("other-row-dirty", x, { originalFormRetained: current.form === row.form, companionFormRetained: other.form === companion.form,
      originalDraft: f.updateValues(current), companionDraft: f.updateValues(other), companionRevision });
    assert.equal(current.form === row.form, true); assert.equal(other.form === companion.form, true);
    assert.deepEqual(f.updateValues(current), draftB); assert.deepEqual(f.updateValues(other), companionDraft);
    assert.equal(other.form.getAttribute("data-delivery-revision"), companionRevision);
  });

  for (const edited of [false, true]) test("Product Delivery foreign revision " + (edited ? "keeps raw B until explicit discard" : "refreshes only pristine values"), async t => {
    const x = await fixture(t), { f, row, draftB, before } = x;
    await f.reloadUpdate(row); // Actual explicit discard first establishes a pristine control.
    if (edited) f.editUpdate(row, draftB);
    const originalRevision = row.form.getAttribute("data-delivery-revision");
    const manager = await grantManager(f, "patch-foreign-writer");
    const old = f.decisions().find(item => item.decision_id === x.originalId);
    const foreign = { decisionId: x.originalId, expectedUpdatedAt: old.updated_at, title: "Other writer's saved decision",
      evidence: "Actual other writer evidence", ownerUserId: f.storeHost.worker.owner, status: "superseded" };
    let response, body;
    try {
      // Independent authorized RAM HTTP writer; no fake report, updatedAt or row.
      response = await f.storeHost.worker.request(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(foreign) });
      assert.equal(response.status, 200); body = await response.json(); assert.equal(body.decision.decisionId, x.originalId);
    } finally { f.storeHost.worker.setScopedHeaders(x.manager.headers); }
    assert.equal(f.platformSession.get().user.userId, x.manager.id);
    await f.refresh(); f.draw(); const current = f.updateRow(foreign.title), actual = f.updateValues(current);
    observe(edited ? "foreign-dirty" : "foreign-pristine", x, { foreignPrincipal: manager.id, foreignStatus: response.status,
      originalRevision, currentRevision: current.form.getAttribute("data-delivery-revision"), serverRevision: body.decision.updatedAt,
      sameForm: current.form === row.form, actual });
    assert.equal(current.form === row.form, true);
    assert.equal(calls(f, "PATCH").length, before.patches, "The current user's draft was never automatically submitted.");
    assert.deepEqual(f.creationEvents(), before.creations); assert.deepEqual(receipts(f), before.receipts); assert.deepEqual(money(f), before.money);
    if (!edited) {
      assert.deepEqual(actual, { title: foreign.title, evidence: foreign.evidence, ownerUserId: foreign.ownerUserId, status: foreign.status });
      assert.equal(current.form.getAttribute("data-delivery-revision"), body.decision.updatedAt);
      assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), false);
    } else {
      assert.deepEqual(actual, draftB);
      assert.equal(current.form.getAttribute("data-delivery-revision"), originalRevision, "A current GET must not rebase dirty B onto another writer.");
      assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), true);
      const retained = current.fields.get("status").description.options.filter(option => option.value === draftB.status);
      assert.equal(retained.length, 1); assert.equal(retained[0].disabled, true); assert.equal(retained[0].selected, true);
      assert.ok(current.saveNode); current.saveNode.click();
      assert.equal(calls(f, "PATCH").length, before.patches, "The actual disabled Save control cannot submit a stale draft.");
      await f.reloadUpdate(current);
      assert.deepEqual(f.updateValues(current), { title: foreign.title, evidence: foreign.evidence, ownerUserId: foreign.ownerUserId, status: foreign.status });
      assert.equal(current.form.getAttribute("data-delivery-revision"), body.decision.updatedAt);
      f.editUpdate(current, { title: "Explicit update after discarding old B" }); await f.submitUpdate(current);
      assert.equal(calls(f, "PATCH").length, before.patches + 1);
      assert.equal(calls(f, "PATCH").at(-1).body.expectedUpdatedAt, body.decision.updatedAt);
      assert.equal(f.decisions().find(item => item.decision_id === x.originalId).title, "Explicit update after discarding old B");
    }
    assert.equal(calls(f, "POST").length, before.posts); assert.deepEqual(f.external, []);
  });

  test("Product Delivery a mismatched positive PATCH body and later real GET cannot advance dirty B's original revision", async t => {
    const x = await fixture(t), { f, row, draftB, before } = x, gate = sceneDeferred();
    const revision = row.form.getAttribute("data-delivery-revision"); let held = false;
    f.deliver = async (call, response) => {
      if (!held && call.method === "PATCH") {
        assert.equal(response.status, 200); const body = await response.json();
        assert.equal(body.decision.decisionId, x.originalId);
        held = true; await gate.promise;
        return Response.json({ ...body, decision: { ...body.decision, decisionId: "mismatched-original" } }, { status: 200 });
      }
      return response;
    };
    const pending = f.submitUpdate(row);
    try { await untilScene(() => held, "Actual successful PATCH before a finite identity-corrupted delivered body."); f.editUpdate(row, draftB); f.draw(); }
    finally { gate.resolve(); await pending; }
    f.draw(); assertOriginalWrite(x);
    assert.equal(row.form.getAttribute("data-delivery-revision"), revision);
    assert.equal(calls(f, "GET").length, before.gets, "A malformed response does not automatically recover or acknowledge itself.");
    f.deliver = undefined; await f.refresh(); f.draw(); const current = f.updateRow(x.draftA.title);
    observe("mismatched-ack", x, { actual: f.updateValues(current), originalRevision: revision,
      currentRevision: current.form.getAttribute("data-delivery-revision"), savedNotice: f.draw().includes(f.i18n.t("delivery.saved")) });
    assert.equal(current.form === row.form, true); assert.deepEqual(f.updateValues(current), draftB);
    assert.equal(current.form.getAttribute("data-delivery-revision"), revision);
    assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), true);
    assert.doesNotMatch(f.draw(), /Delivery decision saved\./);
    assertOriginalWrite(x);
  });


for (const later of [false, true]) test("Product Delivery normalized A " + (later ? "retains and labels actual later B" : "does not invent later edits"), async t => {
  const x = await fixture(t), { f, row, before, draftB } = x;
  const rawA = { ...x.draftA, title: "  " + x.draftA.title + "  ", evidence: "  " + x.draftA.evidence + "  " };
  f.editUpdate(row, rawA); const boundary = hold(f, "report"), pending = f.submitUpdate(row);
  try {
    await untilScene(boundary.entered, "Real normalized PATCH acknowledgment precedes the held report.");
    if (later) f.editUpdate(row, draftB);
    f.draw(); assert.deepEqual(f.updateValues(row), later ? draftB : rawA);
  } finally { boundary.gate.resolve(); await pending; }
  const markup = f.draw(), current = f.updateRow(x.draftA.title), actual = f.updateValues(current);
  const original = before.decisions.find(item => item.decision_id === x.originalId);
  assert.deepEqual(calls(f, "PATCH").at(-1).body, { decisionId: x.originalId, ...rawA, expectedUpdatedAt: original.updated_at });
  const saved = f.decisions().find(item => item.decision_id === x.originalId);
  assert.equal(saved.title, rawA.title.trim()); assert.equal(saved.evidence, rawA.evidence.trim());
  assert.equal(saved.owner_user_id, rawA.ownerUserId); assert.equal(saved.status, rawA.status);
  assert.equal(calls(f, "PATCH").length, before.patches + 1); assert.equal(updates(f).length, before.updates + 1);
  assert.equal(calls(f, "POST").length, before.posts); assert.deepEqual(f.creationEvents(), before.creations);
  assert.deepEqual(receipts(f), before.receipts); assert.deepEqual(money(f), before.money); assert.deepEqual(f.external, []);
  const newerNotice = markup.includes(f.i18n.t("delivery.updateSavedDraftKept"));
  observe(later ? "normalization-later" : "normalization-unchanged", x, { actual, newerNotice, sameForm: current.form === row.form });
  assert.equal(current.form === row.form, true); assert.deepEqual(actual, later ? draftB : x.draftA);
  assert.equal(newerNotice, later, "Only actual retained later input can produce the newer-fields notice.");
});
