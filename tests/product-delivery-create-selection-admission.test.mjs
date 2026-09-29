// Separate defensive submit-event contract, not an ordinary disabled-button
// click, physical browser proof, or additional observed user-origin incident.
// Reuse the actual rendered public submit handler through the existing port.
import assert from "node:assert/strict";
import test from "node:test";
import { fullPageTree } from "./helpers/calm-full-page-fixture.mjs";
import { productDeliveryFixture, snapshot, seedExistingFixtureHistory,
  nativeCreateSelection, seedDependencies } from "./helpers/product-delivery-create-selection-fixture.mjs";

for (const retired of [false, true]) test("Create finite invalid submit contract " + (retired ? "retires old form refusal" : "publishes only for current form"), async t => {
  const f = await productDeliveryFixture(t), seeded = seedExistingFixtureHistory(f, "en", false);
  const dependencies = seedDependencies(f, seeded, "en"); await f.refresh();
  const native = nativeCreateSelection(f);
  native.fillRaw({ title: "Valid title with an unavailable choice", audience: "product", evidence: "Retained raw evidence" });
  native.choose("ownerUserId", [seeded.people[2].userId]); native.choose("dependencies", [dependencies[0].decision_id]);
  f.storeHost.worker.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(seeded.people[2].userId);
  await f.refresh(); assert.equal(native.observation().submitEnabled, false);
  const form = native.current().form, before = snapshot(f), calls = f.calls.length;
  const guidance = f.i18n.t("delivery.createSelectionsUnavailable", "Choose a current owner and remove unavailable dependencies before adding a new decision.");
  assert.equal(fullPageTree(f).visible("p").some(node => node.attributes.role === "alert" && node.text === guidance), false);
  if (retired) {
    f.store.route.set("/product/evaluation"); f.emitWindow("popstate");
    // Observe the existing committed DOM before its scheduled render; never
    // force a detached control connected or call a private component method.
    assert.equal(form.isConnected, true); assert.equal(f.host.contains(form), true);
  }
  // Deliberately a finite submit-event boundary, not activation of the disabled
  // button. Native submit events/programmatic submission still need admission.
  await f.submit(form); f.draw();
  const alerts = fullPageTree(f).visible("p").filter(node => node.attributes.role === "alert" && node.text === guidance);
  assert.equal(alerts.length, retired ? 0 : 1);
  assert.equal(f.calls.length, calls); assert.equal(f.calls.some(call => call.method !== "GET"), false);
  assert.equal(f.creationEvents().length, 0); assert.equal(snapshot(f).receipts.length, 0);
  assert.equal(f.formResets, 0); assert.deepEqual(f.external, []);
  const expected = structuredClone(before); if (retired) expected.route = "/product/evaluation";
  assert.deepEqual(snapshot(f), expected);
  if (retired) { assert.equal(form.isConnected, false); assert.equal(native.retained(), null); }
  else assert.equal(native.current().form === form, true);
});
