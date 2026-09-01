// Complete Deliver/Shell/Store/Output classes and the existing synthetic Output
// domain/native ports. This is not a Worker/SQL, provider, CSS or AT certificate.
import assert from "node:assert/strict";
import test from "node:test";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { FIXTURE_DOCUMENT_IDS } from "./output-controller-fixture-model.mjs";
import { creativeNextActions } from "../src/model/workspace-intelligence.ts";
import { nextActionFacts } from "../src/state/next-action-context.ts";
import { documentIdFromRoute } from "../src/model/routes.ts";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";

const options = { concurrency: false, timeout: 45_000 };
const classed = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, ancestor) => { for (let at = node; at; at = at.parent) if (at === ancestor) return true; return false; };
const findIn = (tree, tag, predicate) => { const found = tree.visible(tag).filter(predicate); assert.equal(found.length, 1, "one visible " + tag + " matches predicate"); return found[0]; };
const group = (f, tree = f.tree()) => findIn(tree, "section", node => node.owner.tag === "forma-deliver" && classed(node, "lifecycle-next-actions"));
const cards = (f, tree = f.tree()) => { const shown = group(f, tree); return tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && inside(node, shown)); };
async function deliverPage(t, settings) {
  // An unavailable actual client read has unknown scope. Omitted source
  // verification alone does not erase an otherwise known plan denominator.
  const f = await createOutputReachabilityPage(t, { ...settings, authoredSource: true, unavailable: settings.state === "unknown" });
  // Reuse the exact native history/location port of the reference-opening fixture.
  // The full Store commits history before publishing its new route.
  const previousHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
  Object.defineProperty(globalThis, "history", { configurable: true, writable: true, value: {
    pushState(_state, _title, path) { const next = new URL(path, "http://localhost"); Object.assign(f.storeHost.location, { pathname: next.pathname, search: next.search, hash: next.hash }); },
    replaceState(...args) { this.pushState(...args); },
  } });
  t.after(() => { if (previousHistory) Object.defineProperty(globalThis, "history", previousHistory); else delete globalThis.history; });
  if (settings.state === "unknown") for (const id of FIXTURE_DOCUMENT_IDS) {
    const resource = f.store.outputRequirements.resource(id);
    assert.equal(resource.state, "unavailable"); assert.equal(resource.snapshot, null);
  }
  return f;
}
const noCommands = f => assert.deepEqual(f.storeHost.requests.filter(row => (row.init.method ?? "GET") !== "GET" && !f.isReadOnlyResume(row)), []);
const snapshots = f => JSON.stringify(FIXTURE_DOCUMENT_IDS.map(id => f.adapter.snapshot(id)));
const facts = f => nextActionFacts(f.store, f.store.projection.get().documentId, null, { lifecycle: true });
const cardFor = (f, action) => {
  const values = creativeNextActions(facts(f)), index = values.findIndex(value => JSON.stringify(value) === JSON.stringify(action));
  const tree = f.tree();
  assert.ok(index >= 0); const card = cards(f, tree)[index]; assert.ok(card);
  return findIn(tree, "button", node => inside(node, card));
};

for (const locale of ["en", "ja"]) {
  test("Deliver lifecycle names only the current Document and keeps every keyed controller " + locale, options, async t => {
    const f = await deliverPage(t, { state: "confirmed", surface: "deliver", locale });
    const p = f.store.projection.get(), controllers = f.outputControllers(), before = snapshots(f), events = structuredClone(f.store.events.get());
    assert.equal(controllers.length, FIXTURE_DOCUMENT_IDS.length);
    const tree = f.tree(), shown = group(f, tree), names = tree.visible("bdi").filter(node => inside(node, shown)).map(node => node.text);
    assert.deepEqual(names, [p.projectName, p.documents.find(row => row.id === p.documentId).title]);
    const expected = creativeNextActions(facts(f)); assert.ok(expected.length > 0 && expected.length <= 3);
    assert.equal(cards(f).length, expected.length);
    assert.equal(cards(f).filter(node => node.attributes["data-primary"] === "true").length, 1);
    assert.ok(expected.every(action => action.target.documentId === p.documentId && action.target.projectId === p.projectId));
    const results = findIn(tree, "section", node => node.attributes["aria-label"] === f.i18n.t("artifact.delivery.resultsSection"));
    assert.equal(inside(shown, results), false);
    for (const controller of controllers) assert.equal(controller.isConnected, true);
    await f.settle(); assert.deepEqual(f.outputControllers(), controllers);
    assert.equal(snapshots(f), before); assert.deepEqual(f.store.events.get(), events); noCommands(f);
  });

  test("Deliver lifecycle preserves unknown scope instead of claiming zero owed " + locale, options, async t => {
    const f = await deliverPage(t, { state: "unknown", surface: "deliver", locale });
    const current = facts(f), before = snapshots(f), events = structuredClone(f.store.events.get());
    assert.ok(current.lifecycle.output.scopeKnown !== true || current.lifecycle.output.state !== "ready");
    assert.ok(creativeNextActions(current).length > 0, "known authored requirement has an explicit current inspection destination");
    assert.ok(group(f).text.includes(f.i18n.t("next.lifecycle.scopeUnknown")));
    assert.equal(f.outputControllers().length, FIXTURE_DOCUMENT_IDS.length);
    assert.equal(snapshots(f), before); assert.deepEqual(f.store.events.get(), events); noCommands(f);
  });

  test("Deliver lifecycle refuses to discard a different Document's current Output draft " + locale, options, async t => {
    const f = await deliverPage(t, { state: "confirmed", surface: "deliver", locale });
    const currentId = f.store.projection.get().documentId, controllers = f.outputControllers(), instances = f.outputCards();
    const card = instances.find(value => value.snapshot.scope.documentId !== currentId); assert.ok(card);
    const edit = f.find("button", node => node.owner === card && node.text === f.i18n.t("output.requirement.edit"));
    await f.act(edit);
    const field = f.find("textarea", node => node.owner === card && node.attributes.name === "originalText");
    const draft = "Keep this other Document's exact unsent requirement — 保留";
    field.port.value = draft; await f.act(field, "input");
    const owner = controllers.find(value => value.documentId === card.snapshot.scope.documentId);
    assert.equal(owner.navigationBlocked, true, "existing controller exposes its current owner, not a copied draft");
    const before = snapshots(f), events = structuredClone(f.store.events.get()), route = f.store.route.get();
    const chosen = creativeNextActions(facts(f))[0]; assert.ok(chosen);
    await f.act(cardFor(f, chosen));
    assert.equal(f.store.route.get(), route); assert.equal(f.store.projection.get().documentId, currentId);
    assert.equal(f.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
    assert.deepEqual(f.outputControllers(), controllers); assert.deepEqual(f.outputCards(), instances);
    assert.equal(f.find("textarea", node => node.owner === card && node.attributes.name === "originalText").port.value, draft);
    const form = f.find("form", node => node.owner === card && classed(node, "output-requirement-form"));
    assert.ok(form.port.isConnected, "the original Save/Cancel owner remains open");
    assert.equal(snapshots(f), before); assert.deepEqual(f.store.events.get(), events); noCommands(f);
  });

  test("Deliver current recommendation delegates to the exact original Output destination " + locale, options, async t => {
    const f = await deliverPage(t, { state: "confirmed", surface: "deliver", locale });
    const native = installOutputNavigationFocusNative(t, f, ports); await f.settle();
    const next = creativeNextActions(facts(f)), chosen = next.find(action => action.target.kind === "canonical-output"
      && !action.target.refresh && ["inspect", "native"].includes(action.target.section));
    assert.ok(chosen, "existing current fixture offers a specific admitted Output reference");
    const reference = chosen.target.reference, before = snapshots(f), events = structuredClone(f.store.events.get());
    const button = cardFor(f, chosen); native.emit("pointerdown", button.port); native.focus(button.port);
    await f.act(button);
    for (let step = 0; step < 8; step++) { await f.settle(); if (native.document.activeElement?.closest?.("forma-output-requirements")) break; }
    assert.equal(documentIdFromRoute(f.store.route.get()), reference.documentId);
    const destination = f.outputControllers().filter(controller => controller.surface === "document" && controller.documentId === reference.documentId
      && (reference.kind === "requirement" ? controller.blockId === reference.blockId : !controller.blockId));
    assert.equal(destination.length, 1); assert.equal(native.document.activeElement?.closest?.("forma-output-requirements"), destination[0]);
    const focused = native.document.activeElement;
    const identity = reference.kind === "requirement" ? ["data-output-requirement", reference.blockId]
      : reference.kind === "result" ? ["data-output-result", reference.resultId]
      : reference.kind === "operation" ? ["data-output-operation", reference.operationId]
      : chosen.target.section === "native" ? ["data-output-run-target", reference.targetId] : ["data-output-target", reference.targetId];
    assert.equal(focused.getAttribute(identity[0]), identity[1], "not merely a successful route or generic heading");
    assert.equal(snapshots(f), before); assert.deepEqual(f.store.events.get(), events); noCommands(f);
  });
}
