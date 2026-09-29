// Separate actual-host/Worker controls; not rewrites of the original ten.
// Synthetic fixture metadata changes, finite native options/submit boundary.
import assert from "node:assert/strict";
import test from "node:test";
import { productDeliveryFixture, snapshot, setLocale, seedExistingFixtureHistory,
  endpoint, nativeCreateSelection, seedDependencies } from "./helpers/product-delivery-create-selection-fixture.mjs";

const posts = f => f.calls.filter(call => call.url === endpoint && call.method === "POST");
const rawA = { title: "  Explicit current create A 文書  ", audience: "product", evidence: "  Original evidence A  " };
const rawB = { title: "  Preserved later draft B 文書  ", audience: "product", evidence: "  Later evidence B\nنور  " };
async function fixture(t, locale = "en") {
  const f = await productDeliveryFixture(t); setLocale(f, locale);
  const seeded = seedExistingFixtureHistory(f, locale, false), dependencies = seedDependencies(f, seeded, locale);
  await f.refresh(); const native = nativeCreateSelection(f); native.fillRaw(rawA);
  return { f, seeded, dependencies, native, original: snapshot(f), db: f.storeHost.worker.sqlite };
}
function safe(f, original) {
  const current = snapshot(f);
  assert.deepEqual(current.money, original.money); assert.deepEqual(current.source, original.source);
  assert.deepEqual(current.session, original.session); assert.deepEqual(current.platformSession, original.platformSession);
  assert.deepEqual(current.authorization, original.authorization); assert.deepEqual(current.grants, original.grants);
  assert.equal(f.calls.some(call => !["GET", "POST"].includes(call.method)), false); assert.deepEqual(f.external, []);
}
function missingOwner(db, id) { db.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(id); }
function missingDependency(db, id) { db.prepare("DELETE FROM delivery_decisions WHERE decision_id=?").run(id); }

test("Create current native owner/dependency choices still produce one actual original receipt", async t => {
  const { f, seeded, dependencies, native, original } = await fixture(t);
  native.choose("ownerUserId", [seeded.people[2].userId]); native.choose("dependencies", [dependencies[0].decision_id]);
  const action = await native.activateCreate(); assert.equal(action.dispatched, true); assert.equal(action.noValidate, false);
  assert.equal(posts(f).length, 1); assert.equal(f.creationEvents().length, 1); assert.equal(snapshot(f).receipts.length, 1);
  assert.equal(f.decisions().length, original.decisions.length + 1); assert.equal(f.formResets, 1);
  assert.equal(posts(f)[0].body.ownerUserId, seeded.people[2].userId);
  assert.deepEqual(posts(f)[0].body.dependencyIds, [dependencies[0].decision_id]);
  assert.equal(posts(f)[0].body.title, rawA.title.trim()); assert.equal(f.committed[0].status, 201);
  assert.equal(native.observation().raw.title, ""); safe(f, original);
});

for (const mode of ["owner-only", "dependency-only"]) test("Create independently blocks and deliberately reconciles " + mode, async t => {
  const { f, seeded, dependencies, native, original, db } = await fixture(t, "ja");
  const owner = seeded.people[2].userId, dependency = dependencies[2].decision_id;
  native.fillRaw(rawB); native.choose("ownerUserId", [owner]); native.choose("dependencies", [dependency]);
  if (mode === "owner-only") missingOwner(db, owner); else missingDependency(db, dependency);
  await f.refresh(); const blocked = native.observation();
  assert.deepEqual(blocked.selectors.ownerUserId.selected, [owner]); assert.deepEqual(blocked.selectors.dependencies.selected, [dependency]);
  assert.equal(blocked.submitEnabled, false); assert.equal((await native.activateCreate()).dispatched, false);
  const calls = f.calls.length;
  if (mode === "owner-only") {
    assert.equal(blocked.selectors.ownerUserId.options.find(option => option.value === owner).disabled, true);
    assert.equal(blocked.selectors.dependencies.options.find(option => option.value === dependency).disabled, false);
    native.choose("ownerUserId", [""]);
  } else {
    assert.equal(blocked.selectors.ownerUserId.options.find(option => option.value === owner).disabled, false);
    assert.equal(blocked.selectors.dependencies.options.find(option => option.value === dependency).disabled, true);
    native.removeUnavailableDependencies();
  }
  const reconciled = native.observation(); assert.equal(reconciled.actionable, true); assert.deepEqual(reconciled.raw, rawB);
  assert.deepEqual(reconciled.selectors.ownerUserId.selected, [mode === "owner-only" ? "" : owner]);
  assert.deepEqual(reconciled.selectors.dependencies.selected, mode === "owner-only" ? [dependency] : []);
  assert.equal(f.calls.length, calls); assert.equal(posts(f).length, 0); assert.equal(f.creationEvents().length, 0);
  assert.equal(snapshot(f).receipts.length, 0); assert.equal(f.formResets, 0); safe(f, original);
});

test("Create correction removes only missing dependencies and submits only the deliberate reconciled choices", async t => {
  const { f, seeded, dependencies, native, original, db } = await fixture(t);
  const owner = seeded.people[2].userId, keep = dependencies[0].decision_id, missing = dependencies[2].decision_id;
  native.fillRaw(rawB); native.choose("ownerUserId", [owner]); native.choose("dependencies", [keep, missing]);
  missingOwner(db, owner); missingDependency(db, missing); await f.refresh();
  const blocked = native.observation(); assert.equal(blocked.submitEnabled, false);
  assert.deepEqual(blocked.selectors.dependencies.selected.sort(), [keep, missing].sort());
  native.choose("ownerUserId", [""]); assert.equal(native.observation().submitEnabled, false);
  const calls = f.calls.length; native.removeUnavailableDependencies();
  const reconciled = native.observation(); assert.deepEqual(reconciled.raw, rawB);
  assert.deepEqual(reconciled.selectors.dependencies.selected, [keep]); assert.deepEqual(reconciled.selectors.ownerUserId.selected, [""]);
  assert.equal(reconciled.actionable, true); assert.equal(f.calls.length, calls);
  assert.equal((await native.activateCreate()).dispatched, true);
  assert.equal(posts(f).length, 1); assert.equal(posts(f)[0].body.ownerUserId, f.platformSession.get().user.userId);
  assert.deepEqual(posts(f)[0].body.dependencyIds, [keep]); assert.equal(posts(f)[0].body.title, rawB.title.trim());
  assert.equal(f.creationEvents().length, 1); assert.equal(snapshot(f).receipts.length, 1); assert.equal(f.formResets, 1); safe(f, original);
});

test("Create uncertain original Retry ignores invalid newer selections and title without rebasing the original", async t => {
  const { f, seeded, dependencies, native, original, db } = await fixture(t, "ja");
  native.choose("ownerUserId", [""]); native.choose("dependencies", [dependencies[0].decision_id]);
  f.loseNextCreate = "transport"; assert.equal((await native.activateCreate()).dispatched, true);
  assert.equal(posts(f).length, 1); assert.equal(f.creationEvents().length, 1); assert.equal(f.formResets, 0);
  const originalRequest = structuredClone(posts(f)[0].body), originalDecision = f.committed[0].receipt.decision.decisionId;
  const later = { ...rawB, title: "" }, owner = seeded.people[2].userId, dependency = dependencies[2].decision_id;
  native.fillRaw(later); native.choose("ownerUserId", [owner]); native.choose("dependencies", [dependency]);
  missingOwner(db, owner); missingDependency(db, dependency); await f.refresh();
  const retry = native.observation(); assert.equal(posts(f).length, 1, "A GET never acknowledges or retries the original.");
  assert.equal(retry.submitEnabled, true); assert.equal(retry.requiredFieldsValid, false);
  assert.deepEqual(retry.selectors.ownerUserId.selected, [owner]); assert.deepEqual(retry.selectors.dependencies.selected, [dependency]);
  assert.ok(f.renderer.markup.includes(f.i18n.t("delivery.retryOriginal", "Retry original save")));
  const action = await native.activateCreate(); assert.equal(action.dispatched, true); assert.equal(action.noValidate, true); assert.deepEqual(action.missing, ["title"]);
  assert.equal(posts(f).length, 2); assert.deepEqual(posts(f)[1].body, originalRequest);
  assert.equal(f.committed.at(-1).receipt.decision.decisionId, originalDecision);
  assert.equal(f.decisions().filter(row => row.decision_id === originalDecision).length, 1);
  assert.equal(f.creationEvents().length, 1); assert.equal(snapshot(f).receipts.length, 1); assert.equal(f.formResets, 0);
  const after = native.observation(); assert.deepEqual(after.raw, later); assert.equal(after.submitEnabled, false);
  assert.deepEqual(after.selectors.ownerUserId.selected, [owner]); assert.deepEqual(after.selectors.dependencies.selected, [dependency]);
  assert.ok(f.renderer.markup.includes(f.i18n.t("delivery.originalSavedDraftKept", "The original milestone is saved. Your edited draft remains unsubmitted.")));
  assert.equal(Object.hasOwn(native.current().submit.attributes, "formnovalidate"), false); safe(f, original);
});
