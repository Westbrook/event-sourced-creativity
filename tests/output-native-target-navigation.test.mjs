import assert from "node:assert/strict";
import nativeTest from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { calmFullPageNativePorts } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { captureOutputNavigation } from "../src/model/output-navigation.ts";

// Reuse the complete existing full-page Canvas fixture declarations. Only its
// test-registration suffix is excluded; no component or Store method is replaced.
const fixtureFile = new URL("./outcome-desk-canvas-navigation.test.mjs", import.meta.url);
const fixtureSource = readFileSync(fixtureFile, "utf8");
const marker = 'for(const locale of["en","fr","ar","ja"])test';
assert.ok(fixtureSource.indexOf(marker) > 0);
const fixtureUrl = fixtureFile.href + "?native-target-orientation";
const fixtureHook = registerHooks({ load(url, context, next) {
  return url === fixtureUrl ? { format: "module", source: fixtureSource.slice(0, fixtureSource.indexOf(marker))
    + "\nexport {canvasPage};\n", shortCircuit: true } : next(url, context);
} });
const { canvasPage } = await import(fixtureUrl).finally(() => fixtureHook.deregister());
const test = (name, run) => nativeTest(name, async t => {
  try { return await run(t); } catch (error) {
    if (typeof error?.stack === "string") error.stack = error.stack.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu, "full-class-fixture");
    throw error;
  }
});
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const locales = ["en", "fr", "ar", "ja"];
const isolate = value => "\u2068" + value + "\u2069";
const noCommands = f => assert.deepEqual(f.storeHost.requests.filter(row => (row.init.method ?? "GET") !== "GET"
  && !f.isReadOnlyResume?.(row)), [], "navigation adds no authored, preflight, grant, acceptance or provider command");
const runRows = f => f.tree().visible("input").filter(row => row.owner?.tag === "forma-output-requirements"
  && row.attributes.type === "checkbox" && row.handlers.change?.toString().includes("#changeRunSelection"));
const checked = f => runRows(f).map(row => [row.attributes["aria-label"], row.port.checked]);
function contextName(f, snapshot, target) {
  const position = snapshot.confirmedPlan.plan.targets.findIndex(row => row.id === target.id);
  const requirement = snapshot.requirements.findIndex(row => row.blockId === target.requirement_id);
  assert.ok(position >= 0 && requirement >= 0);
  const targetContext = f.i18n.t("output.delivery.contextTarget", "Target {number}: {name}",
    { number: f.i18n.number(position + 1), name: isolate(target.label) });
  const row = snapshot.requirements[requirement];
  const requirementContext = f.i18n.t("output.delivery.contextRequirement", "Requirement {number}: {name}",
    { number: f.i18n.number(requirement + 1), name: isolate(row.spec.label) });
  return { targetContext, requirementContext };
}
function namedTarget(f, snapshot, target, focused, section) {
  assert.ok(focused, "an actual native element was focused");
  assert.equal(focused.getAttribute(section === "native" ? "data-output-run-target" : "data-output-target"), target.id,
    "the requested target identity, not the first target or a document-global section");
  const name = section === "native" ? focused.getAttribute("aria-label")
    : f.tree().nodes.find(row => row.attributes.id === focused.getAttribute("aria-labelledby"))?.attributes["aria-label"];
  assert.equal(typeof name, "string");
  const context = contextName(f, snapshot, target);
  const document = f.store.projection.get().documents.find(row => row.id === snapshot.documentId);
  assert.ok(name.includes(isolate(document.title)), "existing exact Document name remains");
  assert.ok(name.includes(context.requirementContext), "existing requirement context remains");
  assert.ok(name.includes(context.targetContext), "localized target ordinal distinguishes duplicate authored labels");
  if (section === "native") {
    assert.equal(focused.tag, "input"); assert.equal(focused.getAttribute("type"), "checkbox");
    assert.equal(focused.getAttribute("class"), "output-run-target");
  }
  return name;
}
async function duplicateLabels(f) {
  // Fixture setup only: existing in-memory adapter executes its actual domain
  // inspection and plan compilation. These are not real authoring/approval or
  // generation requests. Gesture accounting starts after this explicit setup.
  let snapshot = f.adapter.snapshot(f.documentId);
  const spec = structuredClone(snapshot.requirements[0].spec);
  for (const deliverable of spec.deliverables) deliverable.label = "SAME authored image · هدف · 対象";
  const saved = await f.adapter.fetch("/api/output-requirements", { method: "POST", body: JSON.stringify({
    action: "save", documentId: f.documentId, blockId: snapshot.requirements[0].blockId, spec,
    expectedRevision: snapshot.revision, clientMutationId: "native-target-label-fixture-save",
  }) });
  assert.equal(saved.status, 200); snapshot = (await saved.json()).snapshot;
  const confirmed = await f.adapter.fetch("/api/output-requirements", { method: "POST", body: JSON.stringify({
    action: "confirm", documentId: f.documentId, expectedRevision: snapshot.revision,
    clientMutationId: "native-target-label-fixture-confirm", options: snapshot.confirmedPlan.confirmationOptions,
  }) });
  assert.equal(confirmed.status, 200); await confirmed.json();
  const resource = await f.store.outputRequirements.ensure(f.documentId, { force: true });
  assert.equal(resource.state, "ready"); await f.settle();
}
function actionFor(f, section) {
  const actions = f.tree().visible("button").filter(row => String(row.attributes["data-choice-value"] ?? "").includes(":output:" + section + ":"));
  assert.equal(actions.length, 1, "one explicit current native/inspect action"); return actions[0];
}

for (const locale of locales) for (const labels of ["distinct", "duplicate"]) for (const section of ["inspect", "native"]) {
  test(locale + " exact native destination / " + labels + " labels / " + section, async t => {
    const f = await canvasPage(t, { locale, state: "multi-target" });
    if (labels === "duplicate") await duplicateLabels(f);
    const snapshot = f.outputSnapshot();
    const eligible = snapshot.confirmedPlan.plan.targets.filter(target => target.selected && !target.blocking_issues.length);
    assert.equal(eligible.length, 2);
    if (labels === "duplicate") assert.equal(eligible[0].label, eligible[1].label);
    else assert.notEqual(eligible[0].label, eligible[1].label);
    const target = eligible.at(-1);
    assert.notEqual(target.id, eligible[0].id);
    await f.selectOutput("target", target.id);
    const before = JSON.stringify(snapshot), events = JSON.stringify(f.store.events.get()), records = f.outputRecords.length;
    const native = installOutputNavigationFocusNative(t, f, calmFullPageNativePorts);
    await f.act(actionFor(f, section)); await f.finish();
    assert.equal(f.canvas.isConnected, false, "the deliberate Canvas-to-Document handoff still succeeds");
    const name = namedTarget(f, snapshot, target, native.document.activeElement, section);
    const rows = runRows(f);
    assert.equal(rows.length, snapshot.confirmedPlan.plan.targets.length);
    assert.deepEqual(rows.map(row => row.port.checked), snapshot.confirmedPlan.plan.targets.map(row => row.selected));
    assert.equal(new Set(rows.map(row => row.attributes["aria-label"])).size, rows.length, "same-name targets retain distinct contextual names");
    assert.equal(JSON.stringify(f.outputSnapshot()), before); assert.equal(JSON.stringify(f.store.events.get()), events);
    assert.equal(f.outputRecords.slice(records).filter(row => row.type === "fixture-commit").length, 0);
    assert.equal(f.outputControllers().filter(controller => !controller.blockId).length, 1); noCommands(f);
    t.diagnostic(JSON.stringify({ locale, labels, section, targetId: target.id, focusedName: name,
      unchangedRunSelection: true, commandsAfterGesture: 0, browserOrWorkerAuthorityClaim: false }));
  });
}

for (const locale of locales) test(locale + " focusing an existing unchecked native target does not alter local run choices", async t => {
  const f = await createOutputReachabilityPage(t, { locale, state: "multi-target" });
  const snapshot = f.outputSnapshot(), eligible = snapshot.confirmedPlan.plan.targets.filter(row => row.selected);
  const target = eligible.at(-1), position = snapshot.confirmedPlan.plan.targets.findIndex(row => row.id === target.id);
  const rows = runRows(f); assert.equal(rows.length, snapshot.confirmedPlan.plan.targets.length);
  rows[position].port.checked = false; await f.act(rows[position], "change");
  const before = checked(f), source = JSON.stringify(f.outputSnapshot()), events = JSON.stringify(f.store.events.get());
  assert.equal(before[position][1], false); assert.ok(before.some(row => row[1]));
  const native = installOutputNavigationFocusNative(t, f, calmFullPageNativePorts);
  const controller = f.outputControllers().find(row => !row.blockId), scope = f.store.captureAuthorizationScope(), route = f.store.route.get();
  const reference = captureOutputNavigation(snapshot, scope.key, "target", target.id); assert.ok(reference);
  const opening = controller.focusOutputReference(reference, { section: "native",
    current: () => f.store.route.get() === route && f.store.authorizationScopeActive(scope) });
  await f.settle(); assert.equal(await opening, true); await f.settle();
  namedTarget(f, snapshot, target, native.document.activeElement, "native");
  assert.equal(native.document.activeElement.checked, false, "focus is not implicit selection");
  assert.deepEqual(checked(f), before); assert.equal(JSON.stringify(f.outputSnapshot()), source);
  assert.equal(JSON.stringify(f.store.events.get()), events); noCommands(f);
});

for (const locale of locales) for (const change of ["selection", "authority", "route", "modal"]) {
  test(locale + " exact native destination yields to newer " + change + " during the real session read", async t => {
    const f = await canvasPage(t, { locale, state: "multi-target" });
    const targets = f.outputSnapshot().confirmedPlan.plan.targets.filter(row => row.selected), target = targets.at(-1);
    await f.selectOutput("target", target.id);
    const native = installOutputNavigationFocusNative(t, f, calmFullPageNativePorts);
    const entered = deferred(), release = deferred(), originalRoute = f.store.route.get(), events = JSON.stringify(f.store.events.get());
    f.storeHost.intercept = async request => {
      if (!request.url.startsWith("/api/session?")) return;
      entered.resolve(); await release.promise; return Response.json(f.navigationSession);
    };
    const opening = f.act(actionFor(f, "native")); await entered.promise;
    if (change === "selection") await f.selectOutput("target", targets[0].id);
    else if (change === "authority") f.store.session.set({ ...f.store.session.get(), permissionEpoch: "newer-native-target-authority" });
    else if (change === "route") { f.store.setRoute(originalRoute + "&newer=orientation"); await f.settle(); }
    else await f.act(f.find("button", row => String(row.attributes.class ?? "").includes("canvas-sources-toggle")));
    const route = f.store.route.get(), history = f.navigationHistory.length;
    release.resolve(); await opening; await f.finish();
    assert.equal(f.store.route.get(), route); assert.equal(f.navigationHistory.length, history);
    assert.equal(native.nativeFocus.filter(row => String(row.node.attributes?.class ?? "").startsWith("output-")).length, 0);
    assert.equal(native.nativeScroll.filter(row => String(row.node.attributes?.class ?? "").startsWith("output-")).length, 0);
    assert.equal(JSON.stringify(f.store.events.get()), events);
    if (change === "modal") assert.ok(f.tree().visible("dialog").some(row => String(row.attributes.class ?? "").includes("canvas-add-dialog")));
    for (const name of ["focusin", "pointerdown", "keydown"]) assert.equal(
      (f.listeners.get(name) ?? []).filter(listener => ["focusChanged", "interrupt"].includes(listener.name)).length, 0,
      "the original handoff releases its interaction listeners");
    noCommands(f);
  });
}
