import test from "node:test";
import assert from "node:assert/strict";
import { productDeliveryFixture } from "./helpers/product-delivery-native-fixture.mjs";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";

const draft = { title: "First arbitrary milestone", audience: "product", evidence: "First evidence", ownerUserId: "", dependencies: [] };
const posts = f => f.calls.filter(call => call.method === "POST");
async function holdPositive(f) {
  const entered = sceneDeferred(), gate = sceneDeferred(); let held = false;
  f.deliver = async (call, response) => {
    if (!held && call.method === "POST" && response.ok) { held = true; entered.resolve(); await gate.promise; }
    return response;
  };
  return { entered, gate };
}

test("ProductDelivery double submission while one actual create is pending sends exactly one request", async t => {
  const f = await productDeliveryFixture(t), form = f.form(); f.fill(form, draft); const hold = await holdPositive(f);
  const pending = f.submit(form); await hold.entered.promise; await f.submit(form);
  assert.equal(posts(f).length, 1); assert.equal(f.decisions().length, 1); assert.equal(f.formResets, 0);
  hold.gate.resolve(); await pending; assert.equal(f.formResets, 1); assert.equal(f.creationEvents().length, 1);
});

test("ProductDelivery a late genuine create receipt preserves edits made during that request", async t => {
  const f = await productDeliveryFixture(t), form = f.form(); f.fill(form, draft); const hold = await holdPositive(f);
  const pending = f.submit(form); await hold.entered.promise; const edited = { ...draft, title: "Later unsent draft" }; f.fill(form, edited); const editedValues = f.values(form);
  hold.gate.resolve(); await pending;
  assert.equal(f.formResets, 0); assert.equal(f.decisions()[0].title, draft.title); assert.deepEqual(f.values(form), editedValues);
  assert.match(f.draw(), /edited draft remains unsubmitted/);
  await f.submit(form); assert.equal(f.decisions().length, 2); assert.notEqual(posts(f)[0].body.requestId, posts(f)[1].body.requestId);
});

for (const fault of ["transport", "body"]) test(`ProductDelivery edited draft after lost ${fault} ACK retries only the exact original request`, async t => {
  const f = await productDeliveryFixture(t), form = f.form(); f.fill(form, draft); f.loseNextCreate = fault; await f.submit(form);
  const first = posts(f)[0].body, edited = { ...draft, title: "A separate edited milestone" }; f.fill(form, edited);
  await f.submit(form);
  assert.deepEqual(posts(f)[1].body, first); assert.equal(f.decisions().length, 1); assert.equal(f.decisions()[0].title, draft.title);
  assert.equal(f.formResets, 0); assert.equal(new Map(f.values(form)).get("title"), edited.title); assert.match(f.draw(), /edited draft remains unsubmitted/);
  await f.submit(form); assert.notEqual(posts(f)[2].body.requestId, first.requestId); assert.equal(f.decisions().length, 2); assert.equal(f.formResets, 1);
});

test("ProductDelivery an initial explicit before-write refusal allows a corrected draft", async t => {
  const f = await productDeliveryFixture(t), form = f.form(); f.fill(form, { ...draft, title: "   " }); await f.submit(form);
  assert.equal(f.decisions().length, 0); assert.equal(f.formResets, 0);
  f.fill(form, draft); await f.submit(form);
  assert.equal(f.decisions().length, 1); assert.equal(f.formResets, 1); assert.notEqual(posts(f)[0].body.requestId, posts(f)[1].body.requestId);
});

for (const malformed of ["wrong request", "wrong actor", "wrong hash", "wrong acknowledgment", "array body"]) test(`ProductDelivery ${malformed} positive response cannot settle the original save`, async t => {
  const f = await productDeliveryFixture(t), form = f.form(); f.fill(form, draft); let changed = false;
  f.deliver = async (call, response) => {
    if (call.method !== "POST" || changed || !response.ok) return response; changed = true;
    const body = await response.json(); assert.ok(body.receipt, "real Worker positive receipt before transport corruption");
    if (malformed === "wrong request") body.receipt.requestId = crypto.randomUUID();
    if (malformed === "wrong actor") body.receipt.actorUserId = "different-real-principal";
    if (malformed === "wrong hash") body.receipt.requestDigest = "0".repeat(64);
    if (malformed === "wrong acknowledgment") body.decision.title = "A transport-substituted title";
    return Response.json(malformed === "array body" ? [] : body, { status: 201 });
  };
  await f.submit(form); assert.equal(changed, true); assert.equal(f.formResets, 0); assert.equal(f.decisions().length, 1);
  assert.match(f.draw(), /Retry original save/); await f.submit(form);
  assert.equal(f.formResets, 1); assert.equal(f.decisions().length, 1); assert.deepEqual(posts(f)[0].body, posts(f)[1].body);
});

test("ProductDelivery a verified creation remains saved when the following actual report delivery fails", async t => {
  const f = await productDeliveryFixture(t), form = f.form(); f.fill(form, draft); let failed = false;
  f.deliver = async (call, response) => {
    if (!failed && call.method === "GET" && call.url === "/api/portfolio/product/delivery" && f.committed.length) {
      assert.equal(response.status, 200, "the actual authorized report existed before its finite HTTP failure"); failed = true;
      return Response.json({ error: "temporary_report_delivery" }, { status: 503 });
    }
    return response;
  };
  await f.submit(form); assert.equal(failed, true); assert.equal(f.formResets, 1); assert.equal(f.decisions().length, 1);
  assert.match(f.draw(), /milestone is saved, but current delivery evidence could not be refreshed/);
  assert.doesNotMatch(f.draw(), /original save is unconfirmed|Retry original save/);
  await f.refresh(); assert.match(f.draw(), /First arbitrary milestone/); assert.equal(posts(f).length, 1);
});

for (const retirement of ["route ABA", "principal ABA", "disconnect"]) test(`ProductDelivery ${retirement} retires a pending create publication without claiming no commit`, async t => {
  const f = await productDeliveryFixture(t), form = f.form(); f.fill(form, draft); const hold = await holdPositive(f);
  const pending = f.submit(form); await hold.entered.promise;
  if (retirement === "route ABA") {
    f.store.route.set("/product/insights"); f.emitWindow("popstate"); f.store.route.set("/product/delivery"); f.emitWindow("popstate");
  } else if (retirement === "principal ABA") {
    f.platformSession.reset(); await f.platformSession.load("product");
  } else { f.host.isConnected = false; f.host.disconnectedCallback(); }
  hold.gate.resolve(); await pending;
  assert.equal(f.decisions().length, 1, "withdrawal is not cancellation of the already committed Worker write");
  assert.equal(f.formResets, 0); assert.equal(new Map(f.values(form)).get("title"), draft.title);
  assert.equal(posts(f).length, 1); assert.doesNotMatch(f.renderer.value(f.host.render(), f.host, "retired-observation"), /Delivery decision saved\.|original milestone is saved/);
});

test("ProductDelivery retired A cannot clear B's pending ownership or publish A's saved notice", async t => {
  const f = await productDeliveryFixture(t), oldForm = f.form(); f.fill(oldForm, draft);
  const first = await holdPositive(f), oldPending = f.submit(oldForm); await first.entered.promise;
  f.platformSession.reset(); await f.platformSession.load("product");
  await untilScene(() => f.draw().includes("delivery-decision-form"), "fresh actual Product report after the session lifetime changed");
  const newForm = f.form(); f.fill(newForm, { ...draft, title: "Independent B" });
  const second = await holdPositive(f), newPending = f.submit(newForm); await second.entered.promise;
  first.gate.resolve(); await oldPending; assert.equal(f.formResets, 0);
  await f.submit(newForm); assert.equal(posts(f).length, 2, "B remains the only pending operation after late A finally");
  assert.match(f.draw(), /Saving…/); second.gate.resolve(); await newPending;
  assert.equal(f.formResets, 1); assert.equal(f.decisions().length, 2); assert.notEqual(posts(f)[0].body.requestId, posts(f)[1].body.requestId);
});

test("ProductDelivery an unknown original cannot become a new request after a later denial-shaped response", async t => {
  const f = await productDeliveryFixture(t), form = f.form(); f.fill(form, draft); f.loseNextCreate = "transport"; await f.submit(form);
  let denied = false;
  f.deliver = async (call, response) => {
    if (!denied && call.method === "POST") { denied = true; assert.equal(response.status, 201);
      return Response.json({ error: "eligible_delivery_owner_required", createDisposition: "rejected_before_write" }, { status: 403 }); }
    return response;
  };
  f.fill(form, { ...draft, title: "Unsubmitted correction" }); await f.submit(form); assert.equal(f.formResets, 0);
  await f.submit(form); assert.equal(posts(f).length, 3); assert.ok(posts(f).every(call => call.body.requestId === posts(f)[0].body.requestId));
  assert.ok(posts(f).every(call => call.body.title === draft.title)); assert.equal(f.decisions().length, 1); assert.equal(f.formResets, 0);
});
