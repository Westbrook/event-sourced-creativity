import assert from "node:assert/strict";
import test from "node:test";
import { productDeliveryFixture } from "./helpers/product-delivery-native-fixture.mjs";
import { fullPageTree } from "./helpers/calm-full-page-fixture.mjs";

// Actual complete ProductDelivery/RoleDashboard/session and real RAM Worker.
// This file adds only a FINITE required-value submission boundary, driven by
// the actual rendered form/button attributes and the existing FormData port.
// It is not a browser, native validation UI, or DOM-persistence certificate.
// No handler is dispatched when that boundary reports a missing required value.
const draft = { title: "Original valid milestone", audience: "product", evidence: "Original evidence", ownerUserId: "", dependencies: [] };
const posts = f => f.calls.filter(call => call.url === "/api/portfolio/product/delivery" && call.method === "POST");
const receiptRows = f => f.storeHost.worker.sqlite.prepare("SELECT * FROM event_client_receipts WHERE stream_id='platform:product-delivery' ORDER BY client_event_id").all();
const within = (node, ancestor) => { for (let current = node.parent; current; current = current.parent) if (current === ancestor) return true; return false; };

async function activateCurrentCreate(f, retainedForm) {
  f.draw(); const tree = fullPageTree(f);
  const forms = tree.visible("form").filter(node => node.owner === f.host && String(node.handlers.submit).includes("#create"));
  assert.equal(forms.length, 1, "one actual current create form"); const form = forms[0];
  const buttons = tree.visible("button").filter(node => within(node, form) && node.attributes.type === "submit");
  assert.equal(buttons.length, 1, "the current original-save button, not a row update"); const button = buttons[0];
  assert.equal(retainedForm.owner === form.owner, true); assert.equal(retainedForm.isConnected, true);
  assert.equal(f.host.contains(retainedForm), true); assert.equal(typeof form.handlers.submit, "function");
  assert.equal(form.hiddenBy, null); assert.equal(Object.hasOwn(form.attributes, "inert"), false);
  assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
  const fields = tree.nodes.filter(node => within(node, form) && ["input", "select", "textarea"].includes(node.tag));
  const required = fields.filter(node => Object.hasOwn(node.attributes, "required") && !Object.hasOwn(node.attributes, "disabled"));
  assert.deepEqual(required.map(node => node.attributes.name), ["title", "audience"], "exact existing required controls");
  // The existing fixture owns raw values in this native FormData port. Do not
  // replace its form, call f.form() again, or fabricate a successful response.
  const values = new FormData(retainedForm);
  const missing = required.filter(node => !String(values.get(node.attributes.name) ?? "").length).map(node => node.attributes.name);
  const formNoValidate = Object.hasOwn(form.attributes, "novalidate") || form.properties.noValidate === true;
  const buttonNoValidate = Object.hasOwn(button.attributes, "formnovalidate") || button.properties.formNoValidate === true;
  const observed = { missing, formNoValidate, buttonNoValidate, dispatched: false, buttonText: button.text };
  if (!formNoValidate && !buttonNoValidate && missing.length) return observed;
  observed.dispatched = true;
  await form.handlers.submit.call(form.owner, { target: retainedForm, currentTarget: retainedForm, submitter: button.port,
    preventDefault() {}, stopPropagation() {} });
  return observed;
}

for (const clear of [false, true]) test(`Product original Retry crosses finite validation with ${clear ? "cleared" : "valid"} newer unsent title`, { concurrency: false }, async t => {
  const f = await productDeliveryFixture(t), form = f.form(), money = f.financial(); f.fill(form, draft);
  f.loseNextCreate = "transport";
  const firstActivation = await activateCurrentCreate(f, form);
  assert.equal(firstActivation.dispatched, true); assert.equal(firstActivation.formNoValidate, false); assert.equal(firstActivation.buttonNoValidate, false);
  assert.equal(f.committed.length, 1); assert.equal(f.committed[0].status, 201); assert.equal(f.decisions().length, 1);
  assert.equal(f.creationEvents().length, 1); assert.equal(f.formResets, 0);
  const original = posts(f)[0].body, receipt = f.committed[0].receipt, receipts = receiptRows(f);
  assert.ok(receipt.receipt?.eventId, "actual Worker receipt exists before ACK delivery is lost");
  const newer = { ...draft, title: clear ? "" : "Newer valid but unsubmitted milestone" }; f.fill(form, newer);
  const beforeRetry = f.values(form), retried = await activateCurrentCreate(f, form);
  assert.equal(retried.formNoValidate, false, "never bypass validation for the whole Create form");
  assert.match(retried.buttonText, /Retry original save/u);
  assert.deepEqual(retried.missing, clear ? ["title"] : []);
  console.log("PRODUCT_DELIVERY_RETRY_VALIDITY " + JSON.stringify({ clear, initialWorkerStatus: f.committed[0].status,
    ...retried, postCount: posts(f).length, canonicalDecisions: f.decisions().length, canonicalEvents: f.creationEvents().length,
    resets: f.formResets, rawDraftPreserved: JSON.stringify(f.values(form)) === JSON.stringify(beforeRetry) }));
  assert.equal(retried.dispatched, true, "explicit original Retry must not validate newer fields that it does not submit");
  assert.equal(posts(f).length, 2); assert.deepEqual(posts(f)[1].body, original);
  assert.equal(f.committed.length, 2); assert.deepEqual(f.committed[1].receipt, receipt);
  assert.deepEqual(receiptRows(f), receipts); assert.equal(f.decisions().length, 1); assert.equal(f.creationEvents().length, 1);
  assert.equal(f.formResets, 0); assert.deepEqual(f.values(form), beforeRetry); assert.deepEqual(f.financial(), money); assert.deepEqual(f.external, []);
  if (clear) {
    const freshInvalid = await activateCurrentCreate(f, form);
    assert.equal(freshInvalid.formNoValidate, false); assert.equal(freshInvalid.buttonNoValidate, false);
    assert.equal(freshInvalid.dispatched, false, "after the original ACK, empty new Create is again invalid");
    assert.equal(posts(f).length, 2); assert.equal(f.decisions().length, 1); assert.deepEqual(f.values(form), beforeRetry);
  }
});

test("Product fresh invalid Create is blocked before the real handler and can then be corrected", { concurrency: false }, async t => {
  const f = await productDeliveryFixture(t), form = f.form(), money = f.financial(); f.fill(form, { ...draft, title: "" });
  const values = f.values(form), invalid = await activateCurrentCreate(f, form);
  assert.deepEqual(invalid.missing, ["title"]); assert.equal(invalid.formNoValidate, false); assert.equal(invalid.buttonNoValidate, false);
  assert.equal(invalid.dispatched, false); assert.equal(posts(f).length, 0); assert.equal(f.committed.length, 0);
  assert.equal(f.decisions().length, 0); assert.equal(f.creationEvents().length, 0); assert.deepEqual(receiptRows(f), []);
  assert.equal(f.formResets, 0); assert.deepEqual(f.values(form), values);
  f.fill(form, draft); const corrected = await activateCurrentCreate(f, form);
  assert.equal(corrected.dispatched, true); assert.equal(corrected.buttonNoValidate, false);
  assert.equal(posts(f).length, 1); assert.equal(f.committed[0].status, 201); assert.equal(f.decisions().length, 1);
  assert.equal(f.creationEvents().length, 1); assert.equal(f.formResets, 1); assert.deepEqual(f.financial(), money); assert.deepEqual(f.external, []);
  console.log("PRODUCT_DELIVERY_RETRY_VALIDITY " + JSON.stringify({ freshInvalid: true, invalid, correctedDispatched: corrected.dispatched,
    canonicalDecisions: f.decisions().length, canonicalEvents: f.creationEvents().length, postCount: posts(f).length }));
});
