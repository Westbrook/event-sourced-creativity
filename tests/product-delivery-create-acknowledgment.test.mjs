import test from "node:test";
import assert from "node:assert/strict";
import { productDeliveryFixture } from "./helpers/product-delivery-native-fixture.mjs";

// Unexecuted baseline, not an acceptance record. The two lost-positive-ACK
// cases intentionally demand one row; current source is expected to fail that
// domain assertion after all real-commit and unchanged-form prerequisites pass.
const draft = { title: "Arbitrary launch milestone · 日本語", audience: "product", evidence: "A retained acceptance note", ownerUserId: "", dependencies: [] };

test("ProductDelivery ordinary create has one real row, audit event, reset and no provider work", async (t) => {
  const f = await productDeliveryFixture(t), before = f.financial(), form = f.form(); f.fill(form, draft);
  await f.submit(form);
  assert.equal(f.committed.length, 1); assert.equal(f.committed[0].status, 201);
  assert.equal(f.decisions().length, 1); assert.equal(f.creationEvents().length, 1); assert.equal(f.formResets, 1);
  assert.equal(f.decisions()[0].title, draft.title); assert.equal(f.decisions()[0].evidence, draft.evidence);
  assert.deepEqual(f.financial(), before); assert.deepEqual(f.external, []);
});

for (const fault of ["transport", "body"]) test(`ProductDelivery unchanged same-form retry after lost positive ${fault} ACK keeps one canonical milestone`, async (t) => {
  const f = await productDeliveryFixture(t), before = f.financial(), form = f.form(); f.fill(form, draft);
  const originalValues = f.values(form); f.loseNextCreate = fault;
  await f.submit(form);
  assert.equal(f.committed.length, 1, "real Worker returned positive create acknowledgment before the HTTP port lost it");
  assert.equal(f.committed[0].status, 201); assert.equal(f.decisions().length, 1); assert.equal(f.creationEvents().length, 1);
  assert.equal(f.formResets, 0); assert.deepEqual(f.values(form), originalValues, "same actual form and unchanged intent remain");
  const originalId = f.decisions()[0].decision_id;
  await f.submit(form);
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 2, "the user explicitly retries the same form");
  assert.equal(f.formResets, 1, "the second positive response reached the real host");
  assert.deepEqual(f.financial(), before); assert.deepEqual(f.external, []);
  console.log("PRODUCT_DELIVERY_ACK_BASELINE " + JSON.stringify({ fault, committedResponses: f.committed.length,
    originalId, canonicalIds: f.decisions().map((row) => row.decision_id), creationEvents: f.creationEvents().length, sameForm: true }));
  assert.equal(f.decisions().length, 1, "lost acknowledgment retry must not create another arbitrary milestone");
  assert.equal(f.decisions()[0].decision_id, originalId); assert.equal(f.creationEvents().length, 1);
});

test("ProductDelivery a separately entered identical milestone remains an intentional new create", async (t) => {
  const f = await productDeliveryFixture(t), form = f.form(); f.fill(form, draft); await f.submit(form);
  f.fill(form, draft); await f.submit(form);
  assert.equal(f.decisions().length, 2, "do not deduplicate legitimate milestones by title or content");
  assert.notEqual(f.decisions()[0].decision_id, f.decisions()[1].decision_id); assert.equal(f.creationEvents().length, 2); assert.equal(f.formResets, 2);
});
