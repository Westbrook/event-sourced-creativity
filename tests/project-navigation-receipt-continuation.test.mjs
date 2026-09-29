import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { canvasQueueDatabase, canvasQueueTurn } from "./helpers/canvas-source-queue-host.mjs";
import { AccountCacheIndexedDbFixture } from "./helpers/account-cache-indexeddb-fixture.mjs";

// Reuse the complete actual Store/Worker navigation fixture without registering
// its cases twice. Neither its authority nor its append implementation is replaced.
const fixtureUrl = new URL("./project-navigation-continuity.test.mjs", import.meta.url);
const fixtureSource = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = tree.statements.filter(node => ts.isImportDeclaration(node)
  || ts.isFunctionDeclaration(node) && node.name?.text === "navigationFixture"
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ["TASKS", "navigationTypes"].includes(declaration.name.getText(tree))));
assert.equal(declarations.filter(node => ts.isFunctionDeclaration(node)).length, 1);
const helperUrl = new URL("./__navigation_receipt_fixture.mjs", import.meta.url).href;
const helperSource = declarations.map(node => node.getFullText(tree)).join("\n") + "\nexport { navigationFixture, sceneDeferred };";
const hooks = registerHooks({
  resolve(specifier, context, next) { return specifier === helperUrl ? { url: helperUrl, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === helperUrl ? { format: "module", source: helperSource, shortCircuit: true } : next(url, context); },
});
let helpers;
try { helpers = await import(helperUrl); } finally { hooks.deregister(); }
const { navigationFixture, sceneDeferred } = helpers;

function nativeStorage(t) {
  const queue = canvasQueueDatabase(), cache = new AccountCacheIndexedDbFixture();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: {
    open: (name, version) => name === "canvas-offline-queue-v1" ? queue.indexedDB.open(name, version) : cache.indexedDB.open(name, version),
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "indexedDB", previous); else delete globalThis.indexedDB; });
  return queue;
}
const projectPost = request => request.url === "/api/events" && request.init.method === "POST";
function observeAppend(t, h) {
  const values = [], original = h.store.appendWithReceipt.bind(h.store);
  t.mock.method(h.store, "appendWithReceipt", async (...args) => {
    const result = await original(...args); values.push({ input: args[0], result }); return result;
  });
  return values;
}
async function turns() { for (let index = 0; index < 8; index++) await canvasQueueTurn(); }

for (const storage of ["missing", "committed"]) for (const newer of ["different", "aba"])
test("owned navigation denial retires private feedback with " + storage + " storage / " + newer, async t => {
  let database;
  if (storage === "committed") database = nativeStorage(t);
  else {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"); delete globalThis.indexedDB;
    t.after(() => { if (previous) Object.defineProperty(globalThis, "indexedDB", previous); });
  }
  const h = await navigationFixture(t), entered = sceneDeferred(), release = sceneDeferred();
  t.after(() => release.resolve());
  const session = JSON.stringify(h.store.session.get()), before = (await h.history()).filter(event => event.type === "ProjectOpened").length;
  h.store.setRoute(h.deep);
  h.intercept = async request => {
    if (!projectPost(request)) return;
    entered.resolve(); await release.promise;
    // An explicit denied-header transport port, not a fabricated server receipt.
    return Response.json({ error: "navigation_test_denied" }, { status: 403 });
  };
  const pending = h.store.openProject(h.b, "/deliver");
  await entered.promise; h.exact(h.b, h.bd);
  h.store.setRoute("/document/" + h.ad + "/newer-a");
  if (newer === "aba") h.store.setRoute("/deliver?document=" + h.bd);
  await h.store.syncDocumentFromRoute();
  const route = h.store.route.get(); h.store.patchUi({ toast: "Newer private feedback" });
  release.resolve(); assert.equal(await pending, false); await turns();
  assert.equal(h.store.route.get(), route); assert.equal(JSON.stringify(h.store.session.get()), session);
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), false);
  assert.deepEqual(h.store.events.get(), []); assert.deepEqual(h.store.optimisticEvents.get(), []);
  assert.deepEqual(h.store.content.get(), {}); assert.equal(h.store.projection.get().projectId, "");
  assert.equal((await h.history()).filter(event => event.type === "ProjectOpened").length, before);
  assert.equal(h.requests.filter(projectPost).length, 1);
  if (storage === "committed") {
    assert.ok(database.transactions.some(transaction => transaction.mode === "readwrite" && transaction.completed));
    assert.equal(h.store.ui.toast, "");
  } else assert.equal(h.store.ui.toast, "Canvas sync is paused in this page. Device storage could not confirm removal of private draft bodies or retention of the pause after reload. Do not retry the original changes.");
});

for (const outcome of ["lost", "success"]) test("actual Project " + outcome + " keeps its original receipt and correct local view", async t => {
  const h = await navigationFixture(t); h.store.setRoute(h.deep); h.store.setRoute("/library");
  const previous = h.store.route.get(), source = h.store.captureSourceOwnership(), receipts = observeAppend(t, h);
  const before = (await h.history()).filter(event => event.type === "ProjectOpened").length;
  let canonical;
  h.intercept = async request => {
    if (!projectPost(request)) return;
    const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 200);
    canonical = await response.clone().json();
    if (outcome === "lost") throw Error("Lost original response after its actual commit");
    return response;
  };
  assert.equal(await h.store.openProject(h.b, "/deliver"), outcome === "success");
  const result = receipts[0].result, events = await h.history(), committed = canonical.appended.filter(event => event.type === "ProjectOpened");
  assert.equal(committed.length, 1); assert.equal(events.filter(event => event.eventId === committed[0].eventId).length, 1);
  assert.equal(events.filter(event => event.type === "ProjectOpened").length, before + 1);
  assert.equal(h.requests.filter(projectPost).length, 1); assert.equal(h.store.sourceOwnershipActive(source), true);
  if (outcome === "lost") {
    assert.equal(result.publication, "none"); assert.equal(result.acknowledgment.outcome, "unconfirmed");
    assert.deepEqual(result.acknowledgment.committed, []);
    assert.equal(h.store.route.get(), previous); h.exact();
    const retained = h.store.eventWriteAcknowledgments(result.acknowledgment.owner);
    assert.equal(retained.length, 1); assert.equal(retained[0].observationId, result.acknowledgment.observationId);
    assert.equal(retained[0].outcome, "unconfirmed");
    assert.equal(h.store.ui.toast, "The original change is unconfirmed. It has not been resubmitted.");
    await h.store.refreshEvents(); h.exact();
    assert.equal(h.requests.filter(projectPost).length, 1, "Returning the local view never resubmits its original change");
  } else {
    assert.equal(result.publication, "published"); assert.equal(result.acknowledgment.outcome, "observed");
    assert.equal(result.acknowledgment.committed[0].eventId, committed[0].eventId); h.exact(h.b, h.bd);
  }
});

for (const outcome of ["acknowledged", "lost"]) test("actual current-source withdrawal never restores a Project view / " + outcome, async t => {
  nativeStorage(t);
  const h = await navigationFixture(t), entered = sceneDeferred(), release = sceneDeferred(), receipts = observeAppend(t, h);
  t.after(() => release.resolve());
  h.store.setRoute(h.deep); h.store.setRoute("/library");
  let canonical;
  h.intercept = async request => {
    if (!projectPost(request)) return;
    const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 200);
    canonical = await response.clone().json(); entered.resolve(); await release.promise;
    if (outcome === "lost") throw Error("Original response was lost after source withdrawal");
    return response;
  };
  const pending = h.store.openProject(h.b, "/deliver"); await entered.promise;
  const route = h.store.route.get();
  h.worker.env.FORMA_PILOT_COHORT_ID = "synthetic-unavailable-navigation-cohort";
  await assert.rejects(h.store.refreshEvents(), /403/u);
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), false);
  release.resolve(); assert.equal(await pending, outcome === "acknowledged"); await turns();
  const result = receipts[0].result;
  assert.equal(result.publication, "withheld"); assert.deepEqual(result.appended, []);
  assert.equal(result.acknowledgment.privateUnavailable, true);
  assert.equal(result.acknowledgment.outcome, outcome === "acknowledged" ? "observed" : "unconfirmed");
  assert.deepEqual(result.acknowledgment.committed.map(event => event.eventId), outcome === "acknowledged" ? canonical.appended.map(event => event.eventId) : []);
  assert.equal(h.store.route.get(), route); assert.deepEqual(h.store.events.get(), []); assert.deepEqual(h.store.content.get(), {});
  assert.equal(h.store.projection.get().projectId, ""); assert.equal(h.requests.filter(projectPost).length, 1);
  assert.equal((await h.history()).filter(event => event.type === "ProjectOpened" && event.payload.project_id === h.b).length, 1);
});

test("actual local digest failure restores the original Project view without inventing submission", async t => {
  const h = await navigationFixture(t); h.store.setRoute(h.deep); h.store.setRoute("/library");
  const previous = h.store.route.get(), receipts = observeAppend(t, h), originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  h.store.patchUi({ toast: "Current unrelated feedback" });
  let rejected = 0;
  t.mock.method(crypto.subtle, "digest", async (algorithm, bytes) => {
    let value; try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* Other cryptographic calls remain actual. */ }
    if (value?.events?.[0]?.type === "ProjectOpened") { rejected++; throw Error("Synthetic local SHA failure before dispatch"); }
    return originalDigest(algorithm, bytes);
  });
  assert.equal(await h.store.openProject(h.b, "/deliver"), false);
  assert.equal(rejected, 1); assert.equal(h.requests.filter(projectPost).length, 0);
  assert.equal(receipts[0].result.acknowledgment.outcome, "not-attempted");
  assert.deepEqual(receipts[0].result.acknowledgment.committed, []);
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), true);
  assert.equal(h.store.route.get(), previous); h.exact();
  assert.equal(h.store.ui.toast, "Current unrelated feedback", "No-dispatch admission feedback is not relabeled uncertain");
});

test("actual scoped capacity denial restores the Project view and keeps all original unknown observations", async t => {
  const h = await navigationFixture(t), gate = sceneDeferred(); t.after(() => gate.resolve());
  h.store.setRoute(h.deep); h.store.setRoute("/library");
  const previous = h.store.route.get(), receipts = observeAppend(t, h);
  h.store.sceneGateForTest("append", gate.promise);
  let posts = 0;
  h.intercept = async request => { if (projectPost(request)) { posts++; throw Error("Synthetic original transport outcome unknown"); } };
  // Existing bounded admission and its real pipeline own all 32 originals.
  // Transport loss is not a fabricated server or financial receipt.
  const pending = Array.from({ length: 32 }, (_, index) => h.store.appendWithReceipt({
    type: "DocumentOpened", payload: { document_id: h.ad, client_event_id: "retained-navigation-" + index },
  }, { silent: true }));
  const result = await h.store.openProject(h.b, "/deliver");
  assert.equal(result, false); assert.equal(posts, 0, "The denied Project invocation never reaches dispatch");
  const blocked = receipts.find(value => value.input.type === "ProjectOpened").result;
  assert.equal(blocked.acknowledgment.outcome, "not-attempted"); assert.deepEqual(blocked.acknowledgment.committed, []);
  const returnedRoute = h.store.route.get();
  const notice = "Too many original changes await confirmation. No new change was sent.";
  assert.equal(h.store.ui.toast, notice);
  gate.resolve(); const originals = await Promise.all(pending);
  assert.equal(posts, 32); assert.ok(originals.every(value => value.acknowledgment.outcome === "unconfirmed"));
  h.store.setRoute(previous);
  const retained = h.store.eventWriteAcknowledgments(originals[0].acknowledgment.owner);
  assert.equal(retained.length, 32);
  assert.deepEqual(retained.map(value => value.observationId).sort(), originals.map(value => value.acknowledgment.observationId).sort());
  assert.ok(retained.every(value => value.outcome === "unconfirmed"));
  assert.equal(returnedRoute, previous); h.exact();
  assert.equal((await h.history()).filter(event => event.type === "ProjectOpened" && event.payload.project_id === h.b).length, 0);
});

test("an expired actual selected-context deadline prevents any Project route restoration or dispatch", async t => {
  const h = await navigationFixture(t, { shared: true });
  h.store.setRoute(h.deep); h.store.setRoute("/library");
  const route = h.store.route.get(), session = JSON.stringify(h.store.session.get()), source = h.store.captureSourceOwnership();
  const expiry = Date.parse(h.store.session.get().projectContext.expiresAt); assert.ok(Number.isFinite(expiry));
  t.mock.method(Date, "now", () => expiry + 1);
  assert.equal(h.store.sourceOwnershipScopeActive(source), true, "Only original receipt ownership survives the signed deadline");
  assert.equal(h.store.sourceOwnershipActive(source), false);
  assert.equal(await h.store.openProject(h.a, "/deliver"), false);
  assert.equal(h.store.route.get(), route); assert.equal(JSON.stringify(h.store.session.get()), session);
  assert.equal(h.requests.filter(projectPost).length, 0);
});
