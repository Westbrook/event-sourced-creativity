// Additional current-write controls for the same full Platform fragment fixture.
// Real Worker201 held after commit; native history/form ports, not browser proof.
import assert from "node:assert/strict";
import test from "node:test";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { originalDraft, rawDraft, posts, values, canonical, currentDelivery, currentCreate, submitCurrent, historyDelivery, platformDeliveryFixture } from "./helpers/product-platform-fragment-fixture.mjs";

for (const outcome of ["positive", "lost"]) test("Product full Platform Skip during original pending create: " + outcome, { concurrency: false, timeout: 45000 }, async t => {
  const f = await platformDeliveryFixture(t), owner = currentDelivery(f), form = currentCreate(f).form;
  const money = f.financial(), counts = f.storeHost.worker.counts(), gate = sceneDeferred(); let held = false;
  f.fill(form, originalDraft);
  f.deliver = async (call, response) => {
    if (!held && call.url === "/api/portfolio/product/delivery" && call.method === "POST" && response.ok) {
      held = true;
      assert.equal(response.status, 201); assert.ok(f.committed.at(-1)?.receipt.receipt?.eventId);
      await gate.promise;
      if (outcome === "lost") throw new TypeError("The real committed original response is lost after the finite history boundary");
    }
    return response;
  };
  const pending = submitCurrent(f); let original, originalReceipt, before;
  try {
    await untilScene(() => held, "the actual committed original acknowledgment enters the finite hold");
    assert.equal(f.committed.length, 1); assert.equal(f.decisions().length, 1); assert.equal(f.creationEvents().length, 1);
    original = structuredClone(posts(f)[0].body); originalReceipt = structuredClone(f.committed[0].receipt); before = canonical(f);
    f.fill(form, rawDraft); f.draw();
    const traversal = await historyDelivery(f, "#main-content", { skip: true }), currentForm = f.form();
    const ownerNow = currentDelivery(f), button = f.tree().visible("button").find(node => node.owner === ownerNow
      && node.attributes.type === "submit" && node.attributes.class === "button primary");
    assert.ok(button, "the actual current create form exposes its own submit button");
    console.log("PRODUCT_PLATFORM_FRAGMENT_PENDING " + JSON.stringify({ outcome, traversal,
      sameOwner: ownerNow === owner, sameForm: currentForm === form, oldFormConnected: form.isConnected,
      currentDraft: values(f, currentForm), pendingButton: button.text, disabled: Object.hasOwn(button.attributes, "disabled"),
      posts: posts(f).length, canonicalEvents: f.creationEvents().length, originalRequestId: original.requestId }));
    assert.equal(ownerNow === owner, true); assert.equal(currentForm === form, true); assert.equal(form.isConnected, true);
    assert.deepEqual(values(f, currentForm), { title: rawDraft.title, evidence: rawDraft.evidence });
    assert.equal(button.text, f.i18n.t("delivery.saving", "Saving…")); assert.equal(Object.hasOwn(button.attributes, "disabled"), true);
    assert.equal(posts(f).length, 1); assert.deepEqual(canonical(f), before);
  } finally { gate.resolve(); await pending; }
  const current = currentCreate(f);
  assert.equal(current.owner === owner, true); assert.equal(current.form === form, true);
  assert.deepEqual(values(f, current.form), { title: rawDraft.title, evidence: rawDraft.evidence });
  assert.equal(f.formResets, 0); assert.equal(posts(f).length, 1); assert.deepEqual(canonical(f), before);
  if (outcome === "lost") {
    assert.equal(current.button.text, f.i18n.t("delivery.retryOriginal", "Retry original save"));
    await submitCurrent(f);
    assert.equal(posts(f).length, 2); assert.deepEqual(posts(f)[1].body, original);
    assert.deepEqual(f.committed.at(-1).receipt, originalReceipt); assert.deepEqual(canonical(f), before);
    assert.deepEqual(values(f, currentCreate(f).form), { title: rawDraft.title, evidence: rawDraft.evidence });
  } else assert.equal(current.button.text, f.i18n.t("delivery.add", "Add delivery decision"));
  assert.equal(f.formResets, 0); assert.deepEqual(f.financial(), money); assert.deepEqual(f.storeHost.worker.counts(), counts);
  assert.deepEqual(f.external, []);
});
