import assert from "node:assert/strict";
import test from "node:test";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { FIXTURE_DOCUMENT_IDS } from "./output-controller-fixture-model.mjs";
import { calmFullPageNativePorts as ports, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { projectTaskDocumentIdFromRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";

// Complete current Deliver/Shell/Store, retained keyed Output controllers/client and actual Output domain
// functions. Session, HTTP, native DOM and Resume are finite fixture ports, NOT
// durable Worker authority, SQL/fiscal, provider, browser geometry or AT proof.
// Only the explicitly submitted free Confirm may mutate the finite domain.
const cDeliverCommandOptions = { concurrency: false, timeout: 60000 };
const cDeliverCommandClass = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
const cDeliverCommandInside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
const cDeliverCommandSnapshots = f => FIXTURE_DOCUMENT_IDS.map(id => f.adapter.snapshot(id));
const cDeliverCommandButton = (f, owner, key) => f.find("button", node => node.owner === owner && node.text === f.i18n.t(key));
const cDeliverCommandRetained = f => f.store.outputRequirements.retainedWrite(f.commandOutputOwner.documentId);
const cDeliverCommandReview = (f, tree = f.tree()) => tree.visible("section").filter(node => node.owner === f.commandOutputOwner && cDeliverCommandClass(node, "output-plan-review"));

async function cDeliverCommandDrain(f) {
  for (let step = 0; step < 8; step++) {
    await f.settle();
    for (const [id, timer] of [...f.storeHost.timers]) if (timer.delay === 16) { f.storeHost.timers.delete(id); timer.callback(0); }
    await new Promise(setImmediate);
  }
  await f.settle();
}
async function cDeliverCommandPage(t, locale = "en") {
  const f = await createOutputReachabilityPage(t, { state: "confirmed", surface: "deliver", locale, authoredSource: true });
  await registerCalmFullPageComponents(f, ["forma-activity"]);
  const previousHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
  Object.defineProperty(globalThis, "history", { configurable: true, writable: true, value: {
    pushState(_state, _title, path) { const next = new URL(path, "http://localhost"); Object.assign(f.storeHost.location, { pathname: next.pathname, search: next.search, hash: next.hash }); },
    replaceState(...args) { this.pushState(...args); },
  } });
  t.after(() => { if (previousHistory) Object.defineProperty(globalThis, "history", previousHistory); else delete globalThis.history; });
  f.nativeHistoryLocation = f.storeHost.location;
  f.native = installOutputNavigationFocusNative(t, f, ports);
  // The reusable fixture seeds route through its signal. Join its existing
  // native location through the public Store route API before any observation.
  f.store.setRoute(f.store.route.get(), { replace: true }); await cDeliverCommandDrain(f);
  const shown = f.tree().nodes.filter(node => node.tag === "forma-deliver" && node.component?.isConnected && !node.hiddenBy);
  assert.equal(shown.length, 1); f.commandDeliverOwner = shown[0].component;
  assert.ok(f.host.isConnected && f.commandDeliverOwner.isConnected); assert.equal(f.host.tag, "forma-shell");
  assert.equal(f.commandDeliverOwner.store, f.store);
  const owners = f.outputControllers(); assert.equal(owners.length, FIXTURE_DOCUMENT_IDS.length);
  assert.deepEqual(owners.map(owner => owner.documentId).sort(), [...FIXTURE_DOCUMENT_IDS].sort());
  f.commandControllers = owners.map(controller => ({ controller, documentId: controller.documentId, blockId: controller.blockId, surface: controller.surface }));
  const currentDocumentId = f.store.projection.get().documentId;
  assert.ok(FIXTURE_DOCUMENT_IDS.includes(currentDocumentId));
  assert.equal(projectTaskDocumentIdFromRoute(f.store.route.get()), currentDocumentId);
  // Deliberately own the other Document: protecting only the current Document
  // would not protect Deliver's retained keyed controller collection.
  f.commandOutputOwner = owners.find(owner => owner.documentId !== currentDocumentId);
  assert.ok(f.commandOutputOwner); assert.notEqual(f.commandOutputOwner.documentId, currentDocumentId);
  for (const owner of owners) {
    assert.equal(owner.surface, "deliver"); assert.ok(!owner.blockId);
    assert.equal(f.store.outputRequirements.resource(owner.documentId).state, "ready");
    assert.equal(f.store.outputRequirements.retainedWrite(owner.documentId), null);
  }
  cDeliverCommandOwned(f);
  const requests = f.storeHost.requests.length; await cDeliverCommandDrain(f);
  assert.equal(f.storeHost.requests.length, requests, "Initial actual reads settle before accounting");
  const source = f.store.captureSourceOwnership(), authorization = f.store.captureAuthorizationScope();
  assert.ok(f.store.sourceOwnershipActive(source) && f.store.authorizationScopeActive(authorization));
  f.commandBefore = { route: f.store.route.get(), projectId: f.store.projection.get().projectId, documentId: currentDocumentId, source, authorization,
    events: structuredClone(f.store.events.get()), backingEvents: structuredClone(f.storeHost.worker.events), head: f.store.head.get(),
    session: structuredClone(f.store.session.get()), snapshots: cDeliverCommandSnapshots(f), jobs: structuredClone(f.store.documentJobs.get()),
    requests, commits: f.outputRecords.filter(row => row.type === "fixture-commit").length };
  return f;
}
function cDeliverCommandOwned(f) {
  assert.ok(f.commandDeliverOwner.isConnected && f.components().includes(f.commandDeliverOwner));
  assert.equal(f.commandDeliverOwner.store, f.store);
  const current = f.outputControllers(); assert.equal(current.length, f.commandControllers.length);
  for (const owned of f.commandControllers) {
    assert.ok(current.includes(owned.controller), "The exact retained keyed Output controller survives the current Deliver interaction");
    assert.ok(owned.controller.isConnected); assert.equal(owned.controller.store, f.store);
    assert.equal(owned.controller.closest("forma-deliver"), f.commandDeliverOwner);
    assert.equal(owned.controller.documentId, owned.documentId); assert.equal(owned.controller.blockId, owned.blockId);
    assert.equal(owned.controller.surface, owned.surface);
  }
}
async function cDeliverCommandInvariants(f, original = null) {
  await cDeliverCommandDrain(f); const before = f.commandBefore;
  assert.deepEqual(f.storeHost.worker.events, before.backingEvents, "No backing Source event is appended");
  assert.deepEqual(f.store.events.get(), before.events); assert.equal(f.store.head.get(), before.head);
  assert.deepEqual(f.store.session.get(), before.session, "Synthetic authority and budget fixtures stay unchanged");
  assert.deepEqual(f.store.documentJobs.get(), before.jobs);
  assert.ok(f.store.sourceOwnershipActive(before.source) && f.store.authorizationScopeActive(before.authorization));
  assert.equal(f.store.projection.get().projectId, before.projectId); assert.equal(f.store.projection.get().documentId, before.documentId);
  for (const owner of f.commandControllers) if (owner.documentId !== f.commandOutputOwner.documentId)
    assert.equal(f.store.outputRequirements.retainedWrite(owner.documentId), null, "No unrelated retained controller acquires a mutation");
  const actual = cDeliverCommandSnapshots(f), expected = original?.snapshots ?? before.snapshots;
  assert.deepEqual(actual, expected, "Command search, navigation and local resolution do not mutate the finite domain");
  for (let index = 0; index < actual.length; index++) for (const key of ["grants", "assets", "results"])
    assert.deepEqual(actual[index][key], before.snapshots[index][key], "No fictional " + key + " changed; this is not SQL evidence");
  const writes = f.storeHost.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET" && !f.isReadOnlyResume(row));
  assert.deepEqual(writes, original ? [original.request] : [], "Only the exact original free Confirm; no resend, save, preflight, grant, run or event POST");
  const commits = f.outputRecords.filter(row => row.type === "fixture-commit").slice(before.commits);
  if (!original) { assert.deepEqual(commits, []); return; }
  assert.equal(original.request.init, original.init); assert.equal(original.init.body, original.bytes);
  assert.equal(original.request.body.clientMutationId, original.body.clientMutationId);
  assert.equal(commits.length, 1); assert.deepEqual(commits[0].detail, {
    documentId: f.commandOutputOwner.documentId, action: "confirm", revision: original.response.snapshot.revision,
    clientMutationId: original.body.clientMutationId,
  });
}
async function cDeliverCommandOpenPlan(f) {
  cDeliverCommandOwned(f);
  await f.act(cDeliverCommandButton(f, f.commandOutputOwner, "output.delivery.reviewPlan"));
  assert.equal(cDeliverCommandReview(f).length, 1); cDeliverCommandOwned(f);
}
async function cDeliverCommandClosePlan(f) {
  await f.act(cDeliverCommandButton(f, f.commandOutputOwner, "output.delivery.cancel")); await cDeliverCommandDrain(f);
  assert.equal(cDeliverCommandReview(f).length, 0); cDeliverCommandOwned(f);
  assert.equal(f.tree().visible("section").filter(node => cDeliverCommandClass(node, "output-plan-review")).length, 0);
  assert.equal(f.tree().visible("form").filter(node => cDeliverCommandClass(node, "output-requirement-form")).length, 0);
}
async function cDeliverCommandHeldConfirm(f) {
  await cDeliverCommandOpenPlan(f);
  const confirm = cDeliverCommandButton(f, f.commandOutputOwner, "output.delivery.confirm");
  assert.equal(confirm.port.matches(":disabled"), false, "The real current free Confirm submitter is enabled");
  const tree = f.tree(), review = cDeliverCommandReview(f, tree)[0];
  const forms = tree.visible("form").filter(node => node.owner === f.commandOutputOwner && cDeliverCommandInside(node, review));
  assert.equal(forms.length, 1);
  const gate = sceneDeferred(), fetchFixture = f.adapter.fetch; let original = null;
  f.adapter.fetch = async (path, init = {}) => {
    const response = await fetchFixture(path, init);
    if (path === "/api/output-requirements" && init.method === "POST" && JSON.parse(init.body).action === "confirm") {
      assert.equal(original, null, "One original Confirm delivery is held"); assert.equal(response.status, 200);
      const body = JSON.parse(init.body), reply = await response.clone().json();
      assert.equal(body.documentId, f.commandOutputOwner.documentId); assert.equal(reply.ok, true); assert.equal(reply.replayed, false);
      assert.equal(reply.command.action, "confirm"); assert.equal(reply.snapshot.documentId, body.documentId); assert.deepEqual(reply.appended, []);
      const requests = f.storeHost.requests.filter(row => row.init === init); assert.equal(requests.length, 1);
      original = { request: requests[0], init, bytes: init.body, body, response: reply, snapshots: cDeliverCommandSnapshots(f) };
      await gate.promise; throw new Error("Finite committed original Confirm response delivery lost");
    }
    return response;
  };
  const sending = f.act(forms[0], "submit");
  const release = async () => { gate.resolve(); try { await sending; } finally { f.adapter.fetch = fetchFixture; } await cDeliverCommandDrain(f); };
  try {
    await untilScene(() => original !== null, "The actual finite-domain original Confirm commits before delivery is held");
    await cDeliverCommandDrain(f);
    const pending = cDeliverCommandRetained(f); assert.equal(pending?.status, "pending");
    assert.equal(pending.action, "confirm"); assert.equal(pending.clientMutationId, original.body.clientMutationId);
    assert.equal(pending.expectedRevision, original.body.expectedRevision); assert.ok(pending.digest);
    await cDeliverCommandInvariants(f, original);
    return { original, pending, release };
  } catch (error) { await release(); throw error; }
}
async function cDeliverCommandUnknown(f) {
  const held = await cDeliverCommandHeldConfirm(f); await held.release();
  const write = cDeliverCommandRetained(f);
  assert.deepEqual(write, { ...held.pending, status: "unknown" }, "Only delivered-receipt status changes; no read manufactures an ACK");
  return { ...held, write };
}
async function cDeliverCommandActivity(f) {
  cDeliverCommandOwned(f);
  const route = f.store.route.get(), requestStart = f.storeHost.requests.length;
  const trigger = f.find("button", node => node.owner === f.host && cDeliverCommandClass(node, "command-trigger"));
  assert.ok(trigger.port.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port); await f.act(trigger, "click", { button: 0 });
  const label = f.i18n.t("command.openNavigation", "Open {name}", { name: f.i18n.t("shell.navigation.activity", "Activity") });
  const search = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search");
  search.port.value = label; await f.act(search, "input");
  const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === f.host && cDeliverCommandClass(node, "command-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  const rows = tree.visible("button").filter(node => node.owner === f.host && node.attributes.role === "option" && cDeliverCommandInside(node, dialogs[0])
    && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label));
  assert.equal(rows.length, 1, "One actual localized Open Activity command, not a supplied callback");
  assert.ok(rows[0].port.isConnected); assert.equal(rows[0].port.matches(":disabled"), false);
  assert.equal(f.store.route.get(), route); assert.equal(f.storeHost.requests.length, requestStart, "Search itself is local");
  cDeliverCommandOwned(f);
  f.native.emit("pointerdown", rows[0].port); f.native.focus(rows[0].port);
  const focus = f.native.nativeFocus.length, scroll = f.native.nativeScroll.length;
  await f.act(rows[0], "click", { button: 0 }); await cDeliverCommandDrain(f);
  return { label, requestStart, focus, scroll };
}
function cDeliverCommandObserve(t, f, kind, gesture) {
  t.diagnostic("C_DELIVER_COMMAND_ORIGIN " + JSON.stringify({ kind, locale: f.i18n.locale, command: gesture.label,
    currentDocumentId: f.commandBefore.documentId, originalDocumentId: f.commandOutputOwner.documentId,
    route: f.store.route.get(), originRoute: f.commandBefore.route,
    deliverConnected: f.commandDeliverOwner.isConnected, originalOwnerConnected: f.commandOutputOwner.isConnected,
    capturedControllerIds: f.commandControllers.map(owned => owned.documentId),
    exactControllersStillPresent: f.commandControllers.every(owned => f.outputControllers().includes(owned.controller)),
    retainedWrite: cDeliverCommandRetained(f),
    finiteCommits: f.outputRecords.filter(row => row.type === "fixture-commit").slice(f.commandBefore.commits).map(row => row.detail),
    evidence: "actual classes/current native controls and finite Output-domain response; synthetic session/Resume/budgets, no Worker/SQL/provider certificate" }));
}
function cDeliverCommandDeparted(f) {
  assert.equal(f.store.route.get(), withProjectTaskDocumentInRoute("/activity", f.commandBefore.documentId, f.commandBefore.route));
  assert.equal(projectTaskDocumentIdFromRoute(f.store.route.get()), f.commandBefore.documentId);
  assert.equal(f.commandDeliverOwner.isConnected, false, "The real Deliver host was left, not merely hidden");
  for (const owned of f.commandControllers) assert.equal(owned.controller.isConnected, false, "Every original keyed controller was retired by genuine departure");
  assert.equal(f.tree().nodes.filter(node => node.tag === "forma-deliver" && node.component?.isConnected).length, 0);
  const activities = f.tree().nodes.filter(node => node.tag === "forma-activity" && node.component?.isConnected && !node.hiddenBy);
  assert.equal(activities.length, 1); assert.equal(activities[0].component.store, f.store);
}
function cDeliverCommandRefused(f, gesture) {
  assert.equal(f.store.route.get(), f.commandBefore.route, "Pending or newer local work prevents the actual command departure");
  cDeliverCommandOwned(f);
  assert.equal(f.storeHost.requests.length, gesture.requestStart, "Refusal starts no destination read or second command");
  assert.equal(f.native.nativeFocus.slice(gesture.focus).some(row => row.node.owner?.tag === "forma-activity"), false);
  assert.equal(f.native.nativeScroll.length, gesture.scroll);
}
async function cDeliverCommandCloseMenu(f) {
  const dialogs = f.tree().visible("dialog").filter(node => node.owner === f.host && cDeliverCommandClass(node, "command-dialog"));
  assert.ok(dialogs.length <= 1); if (dialogs.length) await f.act(dialogs[0], "cancel", { cancelable: true });
  await cDeliverCommandDrain(f);
}

test("C Deliver command origin / quiet retained controllers permit exact current Activity departure", cDeliverCommandOptions, async t => {
  const f = await cDeliverCommandPage(t);
  for (const owned of f.commandControllers) assert.equal(owned.controller.navigationBlocked, false);
  const gesture = await cDeliverCommandActivity(f); await cDeliverCommandInvariants(f);
  cDeliverCommandObserve(t, f, "quiet-ready", gesture); cDeliverCommandDeparted(f); assert.equal(cDeliverCommandRetained(f), null);
});

test("C Deliver command origin / other Document settled unknown Confirm permits departure after Cancel", cDeliverCommandOptions, async t => {
  const f = await cDeliverCommandPage(t), original = await cDeliverCommandUnknown(f);
  await cDeliverCommandClosePlan(f);
  assert.equal(f.commandOutputOwner.navigationBlocked, true, "Existing preparation guard remains conservative; no new facade API is assumed");
  const gesture = await cDeliverCommandActivity(f); await cDeliverCommandInvariants(f, original.original);
  assert.deepEqual(cDeliverCommandRetained(f), original.write, "Departure does not acknowledge, replace or discard the original transport identity");
  cDeliverCommandObserve(t, f, "settled-unknown-clean", gesture); cDeliverCommandDeparted(f);
});

test("C Deliver command origin / other Document closed raw B blocks until explicit Discard / ja", cDeliverCommandOptions, async t => {
  const f = await cDeliverCommandPage(t, "ja"), original = await cDeliverCommandUnknown(f), raw = " \t保留する未送信の計画 B\n  ";
  const amendment = () => f.find("textarea", node => node.owner === f.commandOutputOwner && node.attributes.rows === "2");
  const field = amendment(); assert.equal(field.port.matches(":disabled"), false); field.port.value = raw; await f.act(field, "input");
  assert.equal(amendment().port.value, raw); await cDeliverCommandClosePlan(f);
  const gesture = await cDeliverCommandActivity(f); await cDeliverCommandInvariants(f, original.original);
  assert.deepEqual(cDeliverCommandRetained(f), original.write); cDeliverCommandObserve(t, f, "closed-newer-plan", gesture);
  cDeliverCommandRefused(f, gesture); await cDeliverCommandCloseMenu(f); await cDeliverCommandOpenPlan(f);
  assert.equal(amendment().port.value, raw, "Cancel only hid B; the same current owner retains exact raw whitespace");
  const discard = cDeliverCommandButton(f, f.commandOutputOwner, "output.delivery.planDiscard");
  assert.equal(discard.port.matches(":disabled"), false); await f.act(discard);
  assert.equal(amendment().port.value, ""); await cDeliverCommandClosePlan(f);
  assert.equal(f.commandOutputOwner.navigationBlocked, true, "Unknown metadata still protects preparation, not settled departure");
  const fresh = await cDeliverCommandActivity(f); await cDeliverCommandInvariants(f, original.original);
  assert.deepEqual(cDeliverCommandRetained(f), original.write); cDeliverCommandObserve(t, f, "explicit-discard-then-fresh-command", fresh); cDeliverCommandDeparted(f);
});

test("C Deliver command origin / other Document pending Confirm still blocks after Cancel", cDeliverCommandOptions, async t => {
  const f = await cDeliverCommandPage(t), held = await cDeliverCommandHeldConfirm(f);
  try {
    await cDeliverCommandClosePlan(f); assert.equal(cDeliverCommandRetained(f)?.status, "pending");
    const gesture = await cDeliverCommandActivity(f); await cDeliverCommandInvariants(f, held.original);
    assert.deepEqual(cDeliverCommandRetained(f), held.pending); cDeliverCommandObserve(t, f, "pending-after-cancel", gesture); cDeliverCommandRefused(f, gesture);
  } finally { await held.release(); }
  const unknown = { ...held.pending, status: "unknown" }; assert.deepEqual(cDeliverCommandRetained(f), unknown);
  await cDeliverCommandCloseMenu(f); const fresh = await cDeliverCommandActivity(f);
  await cDeliverCommandInvariants(f, held.original); assert.deepEqual(cDeliverCommandRetained(f), unknown);
  cDeliverCommandObserve(t, f, "settled-after-pending-refusal", fresh); cDeliverCommandDeparted(f);
});

// ProjectContents' surface="project" is a summary, not another Output editor.
// Reuse the full Deliver fixture and its genuine finite-domain Confirm producer;
// do not set a child's surface, replace a getter, or manufacture a raw draft.
async function cProjectOverviewPage(t, locale = "en") {
  const f = await cDeliverCommandPage(t, locale);
  await registerCalmFullPageComponents(f, ["forma-project-contents"]);
  await cDeliverCommandDrain(f); await cDeliverCommandInvariants(f);
  return f;
}
async function cProjectOverviewGesture(f) {
  cDeliverCommandOwned(f);
  const rails = f.components().filter(owner => owner.tag === "forma-project-rail"
    && owner.closest("forma-deliver") === f.commandDeliverOwner);
  assert.equal(rails.length, 1); assert.equal(rails[0].store, f.store);
  const link = f.find("a", node => node.owner === rails[0] && cDeliverCommandClass(node, "rail-project-switch"));
  assert.equal(link.attributes.href, "/studio/project"); assert.ok(link.port.isConnected);
  assert.equal(link.port.matches(":disabled"), false);
  f.native.emit("pointerdown", link.port); f.native.focus(link.port);
  const gesture = { requestStart: f.storeHost.requests.length, focus: f.native.nativeFocus.length, scroll: f.native.nativeScroll.length };
  await f.act(link, "click", { button: 0 }); await cDeliverCommandDrain(f);
  return gesture;
}
function cProjectSummaryOwned(f) {
  const summary = f.projectSummary;
  assert.ok(summary.owner.isConnected && f.components().includes(summary.owner));
  assert.equal(summary.owner.store, f.store);
  const current = f.outputControllers(); assert.equal(current.length, summary.controllers.length);
  for (const owned of summary.controllers) {
    assert.ok(current.includes(owned.controller), "Keep the exact current summary instance, not another Document's controller");
    assert.ok(owned.controller.isConnected); assert.equal(owned.controller.store, f.store);
    assert.equal(owned.controller.closest("forma-project-contents"), summary.owner);
    assert.equal(owned.controller.documentId, owned.documentId); assert.equal(owned.controller.blockId, owned.blockId);
    assert.equal(owned.controller.surface, owned.surface);
  }
}
function cProjectSummaryArrived(f) {
  assert.equal(f.store.route.get(), "/studio/project");
  assert.equal(projectTaskDocumentIdFromRoute(f.store.route.get()), null, "The actual overview link has no claimed Document query");
  assert.equal(f.commandDeliverOwner.isConnected, false);
  for (const owned of f.commandControllers) assert.equal(owned.controller.isConnected, false);
  const tree = f.tree(), shown = tree.nodes.filter(node => node.tag === "forma-project-contents" && node.component?.isConnected && !node.hiddenBy);
  assert.equal(shown.length, 1); const owner = shown[0].component;
  assert.equal(owner.store, f.store); assert.ok(f.host.isConnected);
  const controllers = f.outputControllers(); assert.equal(controllers.length, FIXTURE_DOCUMENT_IDS.length);
  assert.deepEqual(controllers.map(controller => controller.documentId).sort(), [...FIXTURE_DOCUMENT_IDS].sort());
  assert.equal(f.store.projection.get().projectId, f.commandBefore.projectId);
  assert.ok(FIXTURE_DOCUMENT_IDS.includes(f.store.projection.get().documentId), "Use the real overview fold; do not force the previous selected Document");
  f.projectSummary = { owner, route: f.store.route.get(), projectId: f.store.projection.get().projectId,
    documentId: f.store.projection.get().documentId,
    controllers: controllers.map(controller => ({ controller, documentId: controller.documentId, blockId: controller.blockId, surface: controller.surface })) };
  cProjectSummaryOwned(f);
  for (const controller of controllers) {
    assert.equal(controller.surface, "project"); assert.equal(controller.blockId, "");
    assert.equal(f.store.outputRequirements.resource(controller.documentId).state, "ready");
    const nodes = tree.nodes.filter(node => node.owner === controller && !node.hiddenBy);
    assert.equal(nodes.filter(node => ["form", "input", "select"].includes(node.tag)).length, 0, "Summary has no raw editor, Confirm, upload or paid form");
    assert.ok(nodes.filter(node => node.tag === "textarea").every(node => Object.hasOwn(node.attributes, "readonly")), "Any visible transport receipt is readonly, not a staged draft");
    assert.ok(nodes.some(node => node.tag === "p" && node.text === f.i18n.t("output.delivery.projectScope")), "The actual summary explains where editing belongs");
    assert.equal(f.commandControllers.some(owned => owned.controller === controller), false, "The old Deliver child is genuinely retired, not rebound as the summary");
  }
}
async function cProjectSummaryInvariants(f, original = null) {
  await cDeliverCommandDrain(f); const before = f.commandBefore, summary = f.projectSummary;
  assert.deepEqual(f.storeHost.worker.events, before.backingEvents); assert.deepEqual(f.store.events.get(), before.events);
  assert.equal(f.store.head.get(), before.head); assert.deepEqual(f.store.session.get(), before.session);
  assert.deepEqual(f.store.documentJobs.get(), before.jobs);
  assert.ok(f.store.sourceOwnershipActive(before.source) && f.store.authorizationScopeActive(before.authorization));
  assert.equal(f.store.projection.get().projectId, summary.projectId); assert.equal(f.store.projection.get().documentId, summary.documentId);
  const snapshots = cDeliverCommandSnapshots(f); assert.deepEqual(snapshots, original?.snapshots ?? before.snapshots);
  for (let index = 0; index < snapshots.length; index++) for (const key of ["grants", "assets", "results"])
    assert.deepEqual(snapshots[index][key], before.snapshots[index][key], "No finite " + key + " changed; not a Worker/SQL assertion");
  for (const id of FIXTURE_DOCUMENT_IDS) if (id !== f.commandOutputOwner.documentId)
    assert.equal(f.store.outputRequirements.retainedWrite(id), null);
  const writes = f.storeHost.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET" && !f.isReadOnlyResume(row));
  assert.deepEqual(writes, original ? [original.request] : [], "Only the same explicit free Confirm; no resend, grant, run or event POST");
  const commits = f.outputRecords.filter(row => row.type === "fixture-commit").slice(before.commits);
  if (!original) { assert.deepEqual(commits, []); return; }
  assert.equal(original.request.init, original.init); assert.equal(original.init.body, original.bytes);
  assert.equal(original.request.body.clientMutationId, original.body.clientMutationId);
  assert.equal(commits.length, 1); assert.deepEqual(commits[0].detail, {
    documentId: f.commandOutputOwner.documentId, action: "confirm", revision: original.response.snapshot.revision,
    clientMutationId: original.body.clientMutationId,
  });
}
async function cProjectSummaryCommand(f) {
  cProjectSummaryOwned(f);
  const route = f.store.route.get(), requestStart = f.storeHost.requests.length;
  const trigger = f.find("button", node => node.owner === f.host && cDeliverCommandClass(node, "command-trigger"));
  assert.ok(trigger.port.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port); await f.act(trigger, "click", { button: 0 });
  const label = f.i18n.t("command.openNavigation", "Open {name}", { name: f.i18n.t("shell.navigation.activity", "Activity") });
  const search = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search");
  search.port.value = label; await f.act(search, "input");
  const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === f.host && cDeliverCommandClass(node, "command-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  const rows = tree.visible("button").filter(node => node.owner === f.host && node.attributes.role === "option" && cDeliverCommandInside(node, dialogs[0])
    && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label));
  assert.equal(rows.length, 1); assert.ok(rows[0].port.isConnected); assert.equal(rows[0].port.matches(":disabled"), false);
  assert.equal(f.store.route.get(), route); assert.equal(f.storeHost.requests.length, requestStart, "Summary command search is local");
  cProjectSummaryOwned(f);
  f.native.emit("pointerdown", rows[0].port); f.native.focus(rows[0].port);
  await f.act(rows[0], "click", { button: 0 }); await cDeliverCommandDrain(f);
  assert.equal(f.store.route.get(), withProjectTaskDocumentInRoute("/activity", f.projectSummary.documentId, f.projectSummary.route));
  assert.equal(projectTaskDocumentIdFromRoute(f.store.route.get()), f.projectSummary.documentId);
  assert.equal(f.projectSummary.owner.isConnected, false);
  for (const owned of f.projectSummary.controllers) assert.equal(owned.controller.isConnected, false);
  const activities = f.tree().nodes.filter(node => node.tag === "forma-activity" && node.component?.isConnected && !node.hiddenBy);
  assert.equal(activities.length, 1); assert.equal(activities[0].component.store, f.store);
}
function cProjectOverviewObserve(t, f, kind) {
  t.diagnostic("C_PROJECT_OVERVIEW_OUTPUT " + JSON.stringify({ kind, locale: f.i18n.locale,
    route: f.store.route.get(), originalRoute: f.commandBefore.route, originalDocumentId: f.commandOutputOwner.documentId,
    currentDocumentId: f.store.projection.get().documentId, deliverConnected: f.commandDeliverOwner.isConnected,
    projectContentsConnected: f.components().filter(owner => owner.tag === "forma-project-contents").length,
    children: f.outputControllers().map(owner => ({ documentId: owner.documentId, blockId: owner.blockId, surface: owner.surface })),
    retained: cDeliverCommandRetained(f), commits: f.outputRecords.filter(row => row.type === "fixture-commit").slice(f.commandBefore.commits).map(row => row.detail),
    evidence: "actual Shell/Deliver/Rail/ProjectContents/Output and finite domain/native ports; no Worker authority, SQL/fiscal, provider or physical certificate" }));
}

test("C Project overview Output boundary / clean actual summaries permit a fresh command departure", cDeliverCommandOptions, async t => {
  const f = await cProjectOverviewPage(t);
  await cProjectOverviewGesture(f); cProjectSummaryArrived(f); await cProjectSummaryInvariants(f);
  for (const owned of f.projectSummary.controllers) assert.equal(owned.controller.commandDepartureBlocked, false);
  cProjectOverviewObserve(t, f, "clean-summary"); await cProjectSummaryCommand(f); await cProjectSummaryInvariants(f);
  assert.equal(cDeliverCommandRetained(f), null);
});

test("C Project overview Output boundary / closed unknown original remains inspectable without a departure lock / ja", cDeliverCommandOptions, async t => {
  const f = await cProjectOverviewPage(t, "ja"), original = await cDeliverCommandUnknown(f);
  await cDeliverCommandClosePlan(f); await cDeliverCommandInvariants(f, original.original);
  await cProjectOverviewGesture(f); cProjectSummaryArrived(f); await cProjectSummaryInvariants(f, original.original);
  assert.deepEqual(cDeliverCommandRetained(f), original.write);
  const originals = f.projectSummary.controllers.filter(owned => owned.documentId === original.original.body.documentId);
  assert.equal(originals.length, 1); assert.equal(originals[0].controller.navigationBlocked, true);
  assert.equal(originals[0].controller.commandDepartureBlocked, false, "Settled metadata protects preparation, not departure from a clean summary");
  cProjectOverviewObserve(t, f, "closed-unknown-summary"); await cProjectSummaryCommand(f); await cProjectSummaryInvariants(f, original.original);
  assert.deepEqual(cDeliverCommandRetained(f), original.write, "A new summary and departure never fabricate acknowledgment or replacement");
});

test("C Project overview Output boundary / pending original is refused at the prior owner, then settled unknown may arrive", cDeliverCommandOptions, async t => {
  const f = await cProjectOverviewPage(t), held = await cDeliverCommandHeldConfirm(f);
  try {
    await cDeliverCommandClosePlan(f); await cDeliverCommandInvariants(f, held.original);
    assert.deepEqual(cDeliverCommandRetained(f), held.pending);
    const gesture = await cProjectOverviewGesture(f);
    cProjectOverviewObserve(t, f, "pending-overview-attempt");
    cDeliverCommandRefused(f, gesture); await cDeliverCommandInvariants(f, held.original);
    assert.deepEqual(cDeliverCommandRetained(f), held.pending);
    assert.equal(f.components().filter(owner => owner.tag === "forma-project-contents").length, 0);
  } finally { await held.release(); }
  const unknown = { ...held.pending, status: "unknown" }; assert.deepEqual(cDeliverCommandRetained(f), unknown);
  await cProjectOverviewGesture(f); cProjectSummaryArrived(f); await cProjectSummaryInvariants(f, held.original);
  cProjectOverviewObserve(t, f, "settled-after-prior-owner-refusal");
  await cProjectSummaryCommand(f); await cProjectSummaryInvariants(f, held.original);
  assert.deepEqual(cDeliverCommandRetained(f), unknown);
});

// Same finite-domain original as the four retained-Output command controls;
// the new gesture is Deliver's own current Review activity link.
async function cDeliverShortcutGesture(f) {
  cDeliverCommandOwned(f);
  const link = f.find("a", node => node.owner === f.commandDeliverOwner && node.text === f.i18n.t("deliver.reviewActivity", "Review activity"));
  const destination = withProjectTaskDocumentInRoute("/activity", f.commandBefore.documentId, f.store.route.get());
  assert.equal(link.attributes.href, destination); assert.ok(link.port.isConnected && f.renderer.nodes.includes(link.port));
  assert.equal(link.port.matches(":disabled"), false);
  f.native.emit("pointerdown", link.port); f.native.focus(link.port);
  const gesture = { label: link.text, requestStart: f.storeHost.requests.length,
    focus: f.native.nativeFocus.length, scroll: f.native.nativeScroll.length };
  await f.act(link, "click", { button: 0, defaultPrevented: false }); await cDeliverCommandDrain(f);
  return gesture;
}
test("C ordinary Deliver Activity shortcut permits closed settled unknown original / ja", cDeliverCommandOptions, async t => {
  const f = await cDeliverCommandPage(t, "ja"), original = await cDeliverCommandUnknown(f);
  await cDeliverCommandClosePlan(f);
  const gesture = await cDeliverShortcutGesture(f); await cDeliverCommandInvariants(f, original.original);
  assert.deepEqual(cDeliverCommandRetained(f), original.write);
  cDeliverCommandObserve(t, f, "ordinary-activity-settled-unknown", gesture); cDeliverCommandDeparted(f);
});
test("C ordinary Deliver Activity shortcut protects pending original, then permits its settled unknown / en", cDeliverCommandOptions, async t => {
  const f = await cDeliverCommandPage(t), held = await cDeliverCommandHeldConfirm(f);
  try {
    await cDeliverCommandClosePlan(f); assert.deepEqual(cDeliverCommandRetained(f), held.pending);
    const gesture = await cDeliverShortcutGesture(f); await cDeliverCommandInvariants(f, held.original);
    cDeliverCommandObserve(t, f, "ordinary-activity-pending", gesture); cDeliverCommandRefused(f, gesture);
    assert.deepEqual(cDeliverCommandRetained(f), held.pending);
  } finally { await held.release(); }
  const unknown = { ...held.pending, status: "unknown" }; assert.deepEqual(cDeliverCommandRetained(f), unknown);
  const fresh = await cDeliverShortcutGesture(f); await cDeliverCommandInvariants(f, held.original);
  assert.deepEqual(cDeliverCommandRetained(f), unknown);
  cDeliverCommandObserve(t, f, "ordinary-activity-after-settlement", fresh); cDeliverCommandDeparted(f);
});
