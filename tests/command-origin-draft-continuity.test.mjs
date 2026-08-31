import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createProjectIntakeFixture } from "./helpers/project-intake-fixture.mjs";
import { assignmentPage, originalFetch, externalCount } from "./helpers/assigned-review-action-fixture.mjs";
import { calmFullPageNativePorts as ports, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { readWorkspaceEvents } from "../worker/runtime.ts";
import { documentIdFromRoute, withDocumentInRoute } from "../src/model/routes.ts";

// Existing complete native hosts/Store/isolated Worker only. These six controls
// do not submit intake, approval, correction, note, provider or paid commands.
// Memberships/artifacts in assignmentPage are explicit synthetic setup records;
// current session/inbox/content responses are produced by the actual RAM Worker.
after(() => { assert.equal(externalCount(), 0); globalThis.fetch = originalFetch; });
const cCommandDraftOptions = { concurrency: false, timeout: 120000 };
const cCommandDraftClass = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
const cCommandDraftInside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
const cCommandDraftReceipts = worker => worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();

async function cCommandDraftDrain(x) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await x.f.settle();
    for (const [id, timer] of [...x.h.timers]) if (timer.delay === 16) { x.h.timers.delete(id); timer.callback(0); }
    await x.resume.settleOriginalRequests(); await new Promise(setImmediate);
  }
  await x.f.settle(); await x.resume.settleOriginalRequests(); await x.worker.drainBackground();
  assert.equal(x.resume.pendingOriginalCount(), 0);
}
async function cCommandDraftNative(t, x) {
  await registerCalmFullPageComponents(x.f, ["forma-workspace"]);
  x.f.nativeHistoryLocation = x.h.location;
  x.f.native = installOutputNavigationFocusNative(t, x.f, ports);
  x.resume = observeActualSceneResumeReads(x.h); t.after(() => x.resume.restore());
  await cCommandDraftDrain(x);
  const start = x.h.requests.length; await cCommandDraftDrain(x);
  assert.equal(x.h.requests.length, start, "Original setup requests settle before command-origin accounting");
  assert.equal(x.f.host.tag, "forma-shell"); assert.equal(x.f.host.store, x.h.store);
  assert.ok(x.f.host.isConnected && x.owner.isConnected);
  return x;
}
async function cCommandDraftBefore(x) {
  await cCommandDraftDrain(x);
  const projection = x.h.store.projection.get();
  assert.ok(projection.documents.some(row => row.id === projection.documentId && row.projectId === projection.projectId && !row.removed));
  const source = x.h.store.captureSourceOwnership(), authorization = x.h.store.captureAuthorizationScope();
  assert.ok(x.h.store.sourceOwnershipActive(source) && x.h.store.authorizationScopeActive(authorization));
  return { route: x.h.store.route.get(), projectId: projection.projectId, documentId: projection.documentId,
    documentTitle: projection.documentTitle, source, authorization, session: JSON.stringify(x.h.store.session.get()),
    events: JSON.stringify(x.h.store.events.get()), head: x.h.store.head.get(), requests: x.h.requests.length,
    history: await readWorkspaceEvents(x.worker.env, x.worker.streamId), receipts: cCommandDraftReceipts(x.worker), money: financial(x.worker) };
}
async function cCommandDraftNoWrites(x, before) {
  await cCommandDraftDrain(x);
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), before.history, "No navigation, intake, review, correction, note or source event is appended");
  assert.deepEqual(cCommandDraftReceipts(x.worker), before.receipts); assert.deepEqual(financial(x.worker), before.money);
  assert.equal(JSON.stringify(x.h.store.events.get()), before.events); assert.equal(x.h.store.head.get(), before.head);
  assert.equal(JSON.stringify(x.h.store.session.get()), before.session);
  assert.ok(x.h.store.sourceOwnershipActive(before.source) && x.h.store.authorizationScopeActive(before.authorization));
  assert.equal(x.h.store.projection.get().projectId, before.projectId); assert.equal(x.h.store.projection.get().documentId, before.documentId);
  assert.deepEqual(x.h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET"
    && !x.resume.isReadOnlyResume(request)), [], "Only independently witnessed original free Resume reads may use POST");
}
async function cCommandDraftOpenWork(x) {
  const { f, h } = x, route = h.store.route.get(), requests = h.requests.length;
  const trigger = f.find("button", node => node.owner === f.host && cCommandDraftClass(node, "command-trigger"));
  assert.ok(trigger.port.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port);
  await f.act(trigger, "click", { button: 0 });
  const label = f.i18n.t("command.openNavigation", "Open {name}", { name: f.i18n.t("shell.navigation.work", "Work") });
  const search = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search");
  assert.equal(search.port.matches(":disabled"), false); search.port.value = label;
  await f.act(search, "input");
  const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === f.host && cCommandDraftClass(node, "command-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  const options = tree.visible("button").filter(node => node.owner === f.host && cCommandDraftInside(node, dialogs[0])
    && node.attributes.role === "option" && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label));
  assert.equal(options.length, 1, "One actual localized Open Work row, not a supplied target or private command callback");
  const option = options[0]; assert.ok(option.port.isConnected && f.renderer.nodes.includes(option.port));
  assert.equal(option.port.matches(":disabled"), false);
  assert.equal(h.store.route.get(), route); assert.equal(h.requests.length, requests, "Opening and searching the command menu is local");
  f.native.emit("pointerdown", option.port); f.native.focus(option.port);
  const focus = f.native.nativeFocus.length, scroll = f.native.nativeScroll.length;
  await f.act(option, "click", { button: 0 }); await cCommandDraftDrain(x);
  return { label, focus, scroll, requestStart: requests };
}
async function cCommandDraftCloseMenu(x) {
  const menus = x.f.tree().visible("dialog").filter(node => node.owner === x.f.host && cCommandDraftClass(node, "command-dialog"));
  assert.ok(menus.length <= 1);
  if (menus.length) await x.f.act(menus[0], "cancel", { cancelable: true }); // Current native cancel event, not a hidden editor activation.
  await cCommandDraftDrain(x);
}
function cCommandDraftDeparture(x, before) {
  assert.equal(x.h.store.route.get(), withDocumentInRoute("/", before.documentId, before.documentTitle));
  assert.equal(documentIdFromRoute(x.h.store.route.get()), before.documentId);
  assert.equal(x.owner.isConnected, false, "Healthy navigation really leaves the original routed owner");
  const workspaces = x.f.tree().nodes.filter(node => node.tag === "forma-workspace" && node.component?.isConnected && !node.hiddenBy);
  assert.equal(workspaces.length, 1); assert.equal(workspaces[0].component.store, x.h.store);
  assert.equal(x.f.tree().visible("dialog").filter(node => cCommandDraftClass(node, "command-dialog")).length, 0);
}
function cCommandDraftRefusal(x, before, gesture) {
  assert.equal(x.h.store.route.get(), before.route, "A command cannot discard the exact current owner's raw work");
  assert.ok(x.owner.isConnected && x.f.components().includes(x.owner));
  assert.equal(x.h.requests.length, gesture.requestStart, "Dirty command refusal starts no destination read or command");
  assert.equal(x.f.native.nativeFocus.slice(gesture.focus).some(row => row.node.owner?.tag === "forma-workspace"), false);
  assert.equal(x.f.native.nativeScroll.length, gesture.scroll);
}
function cCommandDraftDiagnostic(t, x, before, gesture, raw, kind, mode) {
  t.diagnostic("C_COMMAND_ORIGIN_DRAFT " + JSON.stringify({ kind, mode, locale: x.f.i18n.locale, command: gesture.label,
    sourceProjectId: before.projectId, sourceDocumentId: before.documentId, rawAtGesture: raw,
    routeUnchanged: x.h.store.route.get() === before.route, originalOwnerConnected: x.owner.isConnected,
    attributableRequests: x.h.requests.slice(gesture.requestStart).map(row => ({ method: row.init.method ?? "GET", url: row.url })),
    exactSourceHistoryAndReceiptsUnchanged: true, allFinancialRowsUnchanged: true, newDispatches: 0,
    evidence: "actual Shell/native current controls and real isolated Worker; no physical browser or provider proof" }));
}
async function cCommandProjectType(x, raw) {
  for (const [label, value] of [[x.f.i18n.t("projects.projectName", "Project name"), raw.name], [x.f.i18n.system("Document name"), raw.documentTitle]]) {
    const node = x.field(label); assert.ok(node.port.isConnected); assert.equal(node.port.matches(":disabled"), false);
    node.port.value = value; await x.f.act(node, "input");
  }
  const objective = x.objective(); assert.ok(objective.port.isConnected); assert.equal(objective.port.matches(":disabled"), false);
  objective.port.value = raw.objective; await x.f.act(objective, "input");
  assert.deepEqual(x.visible().draft, raw);
}
async function cCommandProjectClose(x) {
  const tree = x.f.tree(), forms = tree.visible("form").filter(node => node.owner === x.owner && node.attributes.class === "modal-card wide");
  assert.equal(forms.length, 1);
  const buttons = tree.visible("button").filter(node => node.owner === x.owner && cCommandDraftInside(node, forms[0])
    && node.parent?.tag === "footer" && node.attributes.type === "button" && node.text === x.f.i18n.t("action.cancel", "Cancel"));
  assert.equal(buttons.length, 1); await x.f.act(buttons[0], "click", { button: 0 });
  assert.equal(x.visible().modal, false); assert.equal(x.dispatches.length, 0);
}
async function cCommandProjectReopen(x) {
  await cCommandDraftCloseMenu(x);
  const button = x.f.find("button", node => node.owner.tag === "forma-ui-button" && node.owner.parentElement === x.owner
    && node.owner.label === x.f.i18n.t("projects.new", "New project"));
  assert.ok(button.port.isConnected); assert.equal(button.port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", button.port); x.f.native.focus(button.port);
  await x.f.act(button, "click", { button: 0 }); assert.equal(x.visible().modal, true);
}

for (const [locale, mode] of [["en", "clean"], ["ja", "raw"], ["ja", "resolve"]])
test("C Projects closed raw intake command origin / " + locale + " / " + mode, cCommandDraftOptions, async t => {
  const x = await createProjectIntakeFixture(t, { locale }); await cCommandDraftNative(t, x);
  const empty = { name: "", documentTitle: "", objective: "" };
  const raw = mode === "clean" ? empty : { name: "  Retained command project B  ", documentTitle: " \t ", objective: " \n\t  " };
  await cCommandProjectType(x, raw); await cCommandProjectClose(x);
  const before = await cCommandDraftBefore(x), gesture = await cCommandDraftOpenWork(x);
  await cCommandDraftNoWrites(x, before); assert.equal(x.dispatches.length, 0);
  cCommandDraftDiagnostic(t, x, before, gesture, raw, "projects-closed-intake", mode);
  if (mode === "clean") { cCommandDraftDeparture(x, before); return; }
  cCommandDraftRefusal(x, before, gesture);
  assert.equal(x.visible().modal, false, "Refusal does not silently reopen the closed intake");
  await cCommandProjectReopen(x); assert.deepEqual(x.visible().draft, raw, "Reopening the actual current form reveals the exact retained whitespace");
  if (mode === "raw") { await cCommandProjectClose(x); await cCommandDraftNoWrites(x, before); return; }
  await cCommandProjectType(x, empty); await cCommandProjectClose(x);
  const fresh = await cCommandDraftOpenWork(x); await cCommandDraftNoWrites(x, before);
  assert.equal(fresh.label, gesture.label); cCommandDraftDeparture(x, before); assert.equal(x.dispatches.length, 0);
});

function cCommandActivityField(x) {
  return x.f.find("textarea", node => node.owner === x.panel && node.attributes.maxlength === "500" && node.attributes.rows === "2");
}
async function cCommandActivityType(x, value) {
  const node = cCommandActivityField(x); assert.ok(node.port.isConnected); assert.equal(node.port.matches(":disabled"), false);
  assert.equal(Object.hasOwn(node.attributes, "readonly"), false); node.port.value = value; await x.f.act(node, "input");
  assert.equal(cCommandActivityField(x).port.value, value);
}
for (const mode of ["clean", "raw", "resolve"])
test("C Activity exact review-note command origin / en / " + mode, cCommandDraftOptions, async t => {
  const q = await assignmentPage(t, "same-document"), { f, h } = q;
  const owners = f.components().filter(value => value.tag === "forma-activity"); assert.equal(owners.length, 1);
  const panels = f.components().filter(value => value.tag === "forma-activity-issue-panel" && value.review?.id === q.task.id);
  assert.equal(panels.length, 1);
  const x = { ...q, worker: q.w, owner: owners[0], panel: panels[0] }; await cCommandDraftNative(t, x);
  assert.equal(f.i18n.locale, "en", "The existing assignment fixture is genuinely English; no ignored locale option is claimed");
  assert.ok(x.panel.isConnected && x.panel.store === h.store); assert.equal(x.panel.closest("forma-activity"), x.owner);
  assert.equal(x.panel.review.id, q.task.id); assert.equal(x.panel.review.artifactId, q.artifactId);
  assert.equal(x.panel.review.contentSha256, q.hash); assert.equal(h.store.projection.get().documentId, q.targetDocument);
  const raw = mode === "clean" ? "" : " \n\t  "; // Whitespace alone is still a current raw note, not permission to depart.
  await cCommandActivityType(x, raw);
  const before = await cCommandDraftBefore(x), gesture = await cCommandDraftOpenWork(x);
  await cCommandDraftNoWrites(x, before); assert.equal(q.viewerCalls.length, 0);
  cCommandDraftDiagnostic(t, x, before, gesture, raw, "activity-review-note", mode);
  if (mode === "clean") { cCommandDraftDeparture(x, before); return; }
  cCommandDraftRefusal(x, before, gesture); assert.ok(x.panel.isConnected);
  assert.equal(cCommandActivityField(x).port.value, raw); assert.equal(x.panel.review.id, q.task.id);
  if (mode === "raw") return;
  await cCommandDraftCloseMenu(x); await cCommandActivityType(x, "");
  const fresh = await cCommandDraftOpenWork(x); await cCommandDraftNoWrites(x, before);
  assert.equal(fresh.label, gesture.label); cCommandDraftDeparture(x, before); assert.equal(q.viewerCalls.length, 0);
});

// Ordinary page-owned controls share the command-origin admission contract.
// These four cases reuse the complete existing Worker/native fixtures above;
// no replacement Store method, permissions, draft getter or receipt is used.
async function cPageShortcutClick(x, target) {
  const node = target(); assert.ok(node.port.isConnected && x.f.renderer.nodes.includes(node.port));
  assert.equal(node.hiddenBy, null); assert.equal(node.port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", node.port); x.f.native.focus(node.port);
  const gesture = { requestStart: x.h.requests.length, focus: x.f.native.nativeFocus.length, scroll: x.f.native.nativeScroll.length };
  await x.f.act(node, "click", { button: 0, defaultPrevented: false }); await cCommandDraftDrain(x);
  return gesture;
}
function cPageShortcutRefused(x, before, gesture) {
  assert.equal(x.h.store.route.get(), before.route, "A direct page shortcut cannot consume the current raw owner");
  assert.equal(x.h.location.pathname + x.h.location.search + x.h.location.hash, before.route);
  assert.ok(x.owner.isConnected && x.f.components().includes(x.owner));
  assert.equal(x.h.requests.length, gesture.requestStart);
  assert.equal(x.f.native.nativeFocus.slice(gesture.focus).some(row => row.node.attributes?.id === "main-content"), false);
  assert.equal(x.f.native.nativeScroll.length, gesture.scroll);
}
function cPageShortcutArrived(x, route, tag) {
  assert.equal(x.h.store.route.get(), route); assert.equal(x.owner.isConnected, false);
  assert.equal(x.h.location.pathname + x.h.location.search + x.h.location.hash, route);
  const owners = x.f.tree().nodes.filter(node => node.tag === tag && node.component?.isConnected && !node.hiddenBy);
  assert.equal(owners.length, 1); assert.equal(owners[0].component.store, x.h.store);
}
function cPageShortcutObserve(t, x, before, kind, raw) {
  t.diagnostic("C_ORDINARY_PAGE_SHORTCUT " + JSON.stringify({ kind, locale: x.f.i18n.locale,
    origin: before.route, route: x.h.store.route.get(), projectId: before.projectId, documentId: before.documentId,
    originalOwnerConnected: x.owner.isConnected, raw, evidence: "actual current page/native control/Store and RAM Worker; no provider or physical claim" }));
}

for (const [locale, mode] of [["en", "clean"], ["ja", "raw-resolve"]])
test("C ordinary Projects contents shortcut / " + locale + " / " + mode, cCommandDraftOptions, async t => {
  const x = await createProjectIntakeFixture(t, { locale }); await cCommandDraftNative(t, x);
  await registerCalmFullPageComponents(x.f, ["forma-project-contents"]); await cCommandDraftDrain(x);
  const empty = { name: "", documentTitle: "", objective: "" };
  const raw = mode === "clean" ? empty : { name: "  Shortcut project B  ", documentTitle: " \t未送信  ", objective: " \n\t  " };
  await cCommandProjectType(x, raw); await cCommandProjectClose(x);
  const target = () => {
    const tree = x.f.tree(), cards = tree.visible("article").filter(node => node.owner === x.owner
      && cCommandDraftClass(node, "project-card") && cCommandDraftClass(node, "current"));
    assert.equal(cards.length, 1);
    t.diagnostic("C_PROJECT_CONTENTS_EMITTED_LOCALE " + JSON.stringify({
      locale: x.f.i18n.locale, ownerLocale: x.owner.i18n.locale,
      ownerConnected: x.owner.isConnected, currentCardCount: cards.length,
      expected: x.f.i18n.system("View project contents"),
      catalogExpected: x.f.i18n.messages["system.auto.190an4p.21"],
      footerButtons: tree.visible("button").filter(node => node.owner === x.owner
        && cCommandDraftInside(node, cards[0]) && node.parent?.tag === "footer").map(node => ({
          text: node.text, ariaLabel: node.attributes["aria-label"] ?? null,
          localizedText: x.f.i18n.system(node.text),
          connected: Boolean(node.port?.isConnected),
          current: Boolean(node.port && x.f.renderer.nodes.includes(node.port)),
          disabled: Boolean(node.port?.matches(":disabled")),
        })),
      evidence: "actual emitted full-page native controls; direct-render fixture, not production update or physical locale evidence",
    }));
    // This existing native fixture invokes render(), not the production
    // FormaPresentationalElement.update static-template localization wrapper.
    // Keep its emitted control label exact; the catalog check is separate.
    assert.equal(x.f.i18n.system("View project contents"), locale === "ja" ? "プロジェクトの内容を表示" : "View project contents");
    const buttons = tree.visible("button").filter(node => node.owner === x.owner && cCommandDraftInside(node, cards[0])
      && node.parent?.tag === "footer" && node.text === "View project contents");
    assert.equal(buttons.length, 1); return buttons[0];
  };
  const before = await cCommandDraftBefore(x), gesture = await cPageShortcutClick(x, target);
  await cCommandDraftNoWrites(x, before); assert.equal(x.dispatches.length, 0);
  cPageShortcutObserve(t, x, before, "projects-contents-" + mode, raw);
  if (mode !== "clean") {
    cPageShortcutRefused(x, before, gesture); assert.equal(x.visible().modal, false);
    await cCommandProjectReopen(x); assert.deepEqual(x.visible().draft, raw);
    await cCommandProjectType(x, empty); await cCommandProjectClose(x);
    await cPageShortcutClick(x, target); await cCommandDraftNoWrites(x, before);
  }
  cPageShortcutArrived(x, "/studio/project", "forma-project-contents"); assert.equal(x.dispatches.length, 0);
});

for (const mode of ["clean", "raw-resolve"])
test("C ordinary Activity deliverables shortcut / en / " + mode, cCommandDraftOptions, async t => {
  const q = await assignmentPage(t, "same-document"), { f, h } = q;
  const owners = f.components().filter(value => value.tag === "forma-activity"), panels = f.components()
    .filter(value => value.tag === "forma-activity-issue-panel" && value.review?.id === q.task.id);
  assert.equal(owners.length, 1); assert.equal(panels.length, 1);
  const x = { ...q, worker: q.w, owner: owners[0], panel: panels[0] }; await cCommandDraftNative(t, x);
  await registerCalmFullPageComponents(f, ["forma-deliver"]); await cCommandDraftDrain(x);
  assert.equal(x.panel.store, h.store); assert.equal(x.panel.closest("forma-activity"), x.owner);
  assert.equal(x.panel.review.id, q.task.id); assert.equal(x.panel.review.artifactId, q.artifactId);
  assert.equal(x.panel.review.contentSha256, q.hash); assert.equal(h.store.projection.get().documentId, q.targetDocument);
  const raw = mode === "clean" ? "" : " \n\t  "; await cCommandActivityType(x, raw);
  const target = () => f.find("a", node => node.owner === x.owner && node.text === f.i18n.t("activity.openDeliverables", "View deliverables"));
  const destination = target().attributes.href;
  assert.equal(new URL(destination, "https://fixture.invalid").pathname, "/deliver");
  assert.equal(new URL(destination, "https://fixture.invalid").searchParams.get("document"), q.targetDocument);
  const before = await cCommandDraftBefore(x), gesture = await cPageShortcutClick(x, target);
  await cCommandDraftNoWrites(x, before); assert.equal(q.viewerCalls.length, 0);
  cPageShortcutObserve(t, x, before, "activity-deliverables-" + mode, raw);
  if (mode !== "clean") {
    cPageShortcutRefused(x, before, gesture); assert.ok(x.panel.isConnected);
    assert.equal(cCommandActivityField(x).port.value, raw); assert.equal(x.panel.review.id, q.task.id);
    await cCommandActivityType(x, ""); await cPageShortcutClick(x, target); await cCommandDraftNoWrites(x, before);
  }
  cPageShortcutArrived(x, destination, "forma-deliver"); assert.equal(q.viewerCalls.length, 0);
});


// C221 actual Projects footer -> same-current-project Canvas transition. Reuse
// the complete existing host/Worker seed; no new project, board, job or provider.
// The original session GET is held outside its completed real Worker response,
// then the SAME Response is delivered. A session read is never a write ACK.
import { sceneDeferred as cProjectsCanvasDeferred, untilScene as cProjectsCanvasUntil } from "./helpers/project-intake-fixture.mjs";
import { isOutputFixtureReadOnlyResume as cProjectsCanvasResumeRequest } from "./helpers/output-reachability-fixture.mjs";

const cProjectsCanvasPrivate = x => ({
  content: x.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all(),
  payloads: x.worker.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all(),
});
async function cProjectsCanvasPage(t) {
  const x = await createProjectIntakeFixture(t, { locale: "en" }); await cCommandDraftNative(t, x);
  await registerCalmFullPageComponents(x.f, ["forma-canvas-application", "forma-canvas-surface"]);
  assert.strictEqual(x.f.renderer.registry["forma-canvas-application"], x.f.modules.get("src/apps/canvas/entry.ts").FormaCanvasApplication);
  assert.strictEqual(x.f.renderer.registry["forma-canvas-surface"], x.f.modules.get("src/canvas/canvas-application.ts").CanvasApplication);
  // Exact existing Canvas native prerequisite from the current PC/Outcome Desk
  // fixtures: one-tab capability plus one notification per unchanged viewport
  // size. No Store, application callback, route or timer is replaced.
  const previousChannel = globalThis.BroadcastChannel; globalThis.BroadcastChannel = undefined;
  t.after(() => { globalThis.BroadcastChannel = previousChannel; });
  const resizeSeen = new WeakMap(), targets = x.f.resizeTargets;
  x.f.resizeTargets = new class extends Map {
    *[Symbol.iterator]() { for (const [observer, node] of super[Symbol.iterator]()) {
      if (node.owner?.tag === "forma-canvas-surface" && node.owner.store === x.h.store
        && String(node.attributes?.class ?? "").split(/\s+/u).includes("canvas-viewport")) {
        const key = node.owner, parent = resizeSeen.get(key) ?? new Map();
        const box = node.getBoundingClientRect(), stamp = box.width + ":" + box.height;
        if (parent.get("canvas-viewport") === stamp) continue;
        parent.set("canvas-viewport", stamp); resizeSeen.set(key, parent);
      }
      yield [observer, node];
    } }
  }(targets);
  assert.equal(x.h.store.session.get().projectContext, undefined);
  assert.equal(x.h.store.session.get().canvas.access, true, "The original real Worker session enables this exact footer control");
  assert.equal(x.h.store.route.get(), "/projects");
  return x;
}
function cProjectsCanvasButton(x) {
  const { f, h, owner } = x, tree = f.tree(), projection = h.store.projection.get();
  assert.ok(owner.isConnected && owner.store === h.store && f.components().includes(owner));
  const project = projection.projects.find(row => row.id === projection.projectId); assert.ok(project);
  const cards = tree.visible("article").filter(node => node.owner === owner
    && cCommandDraftClass(node, "project-card") && cCommandDraftClass(node, "current"));
  assert.equal(cards.length, 1);
  const headings = tree.visible("h2").filter(node => node.owner === owner && cCommandDraftInside(node, cards[0]));
  assert.equal(headings.length, 1); assert.equal(headings[0].text, project.name);
  const name = f.i18n.t("projects.openCanvasNamed", "Open in Canvas: {name}", { name: "\u2068" + project.name + "\u2069" });
  const buttons = tree.visible("button").filter(node => node.owner === owner && node.parent?.tag === "footer"
    && cCommandDraftInside(node, cards[0]) && node.text === f.i18n.t("projects.openCanvas", "Open in Canvas")
    && node.attributes["aria-label"] === name);
  assert.equal(buttons.length, 1, "One exact actual current-project footer button, not a supplied route executor");
  const node = buttons[0]; assert.equal(node.hiddenBy, null);
  assert.ok(node.port.isConnected && f.renderer.nodes.includes(node.port)); assert.equal(node.port.owner, owner);
  assert.equal(node.port.matches(":disabled"), false); assert.equal(typeof node.handlers.click, "function");
  assert.equal(f.tree().visible("dialog").filter(dialog => dialog.port.open).length, 0);
  return node;
}
function cProjectsCanvasObserve(t, x, before) {
  const { h } = x, prior = h.transport, gate = cProjectsCanvasDeferred(), pending = new Set(), errors = [];
  assert.equal(typeof prior, "function", "Preserve the existing original free-Resume observer");
  let row = null;
  const observe = async request => {
    const method = request.init.method ?? "GET";
    if (method !== "GET") assert.ok(cProjectsCanvasResumeRequest(request,
      { projectId: before.projectId, documentId: before.documentId }), "No navigation/authoring/job POST; only the existing exact free Resume candidate");
    const response = await prior(request);
    if (method !== "GET") assert.ok(x.resume.isReadOnlyResume(request), "The unchanged original observer must certify zero-change Resume, not an endpoint exemption");
    if (request.url !== "/api/session?audience=canvas") return response;
    assert.equal(row, null, "One original audience session request");
    assert.equal(method, "GET"); assert.equal(request.body, null);
    assert.deepEqual(request.init, { cache: "no-store", credentials: "same-origin" });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.clone().json(); assert.equal(response.bodyUsed, false);
    const originalSession = JSON.parse(before.session);
    assert.equal(body.audience, "canvas"); assert.equal(body.canvas.access, true);
    assert.equal(body.user.userId, originalSession.user.userId);
    assert.equal(body.permissionEpoch, originalSession.permissionEpoch);
    assert.deepEqual(body.projectContext, originalSession.projectContext);
    assert.deepEqual(body.provider, originalSession.provider, "No provider configuration is invented for the navigation");
    row = { request, init: request.init, response, body, delivered: false };
    await gate.promise;
    assert.equal(request.init, row.init); assert.equal(response.bodyUsed, false);
    row.delivered = true; return response;
  };
  const transport = request => {
    const original = observe(request); pending.add(original);
    void original.then(() => pending.delete(original), error => { errors.push(error); pending.delete(original); });
    return original;
  };
  h.transport = transport;
  const restore = () => { if (h.transport === transport) h.transport = prior; };
  t.after(() => { gate.resolve(); restore(); });
  return { get row() { return row; }, release: () => gate.resolve(), restore,
    async reached() { await cProjectsCanvasUntil(() => Boolean(row) || errors.length > 0, "Actual original Canvas session response reached"); assert.deepEqual(errors, []); assert.ok(row); return row; },
    async join() { while (pending.size) await Promise.allSettled([...pending]); assert.deepEqual(errors, []); },
  };
}
async function cProjectsCanvasNoWrites(x, before) {
  await x.worker.drainBackground();
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), before.history,
    "Same-current-project opening emits no ProjectOpened, DocumentOpened, creation or other event");
  assert.deepEqual(cCommandDraftReceipts(x.worker), before.receipts);
  assert.deepEqual(financial(x.worker), before.money); assert.deepEqual(cProjectsCanvasPrivate(x), before.private);
  assert.equal(JSON.stringify(x.h.store.events.get()), before.events); assert.equal(x.h.store.head.get(), before.head);
  assert.equal(x.h.store.projection.get().projectId, before.projectId);
  assert.equal(x.h.store.projection.get().documentId, before.documentId);
  assert.equal(x.dispatches.length, 0, "The actual retained intake is never submitted");
  for (const request of x.h.requests.slice(before.requests)) if ((request.init.method ?? "GET") !== "GET")
    assert.ok(x.resume.isReadOnlyResume(request), "No extra write or provider action follows the read");
}
async function cProjectsCanvasJoin(t, x, before) {
  const observed = cProjectsCanvasObserve(t, x, before), node = cProjectsCanvasButton(x);
  x.f.native.emit("pointerdown", node.port); x.f.native.focus(node.port);
  let completed = false;
  const action = x.f.act(node, "click", { button: 0, defaultPrevented: false });
  void action.then(() => { completed = true; }, () => { completed = true; });
  let completedBeforeRelease = null;
  try {
    const row = await observed.reached();
    completedBeforeRelease = completed; // Diagnostic only: f.act also joins the finite renderer.
    assert.equal(x.h.store.route.get(), before.route); assert.ok(x.owner.isConnected);
    assert.equal(JSON.stringify(x.h.store.session.get()), before.session);
    assert.ok(x.h.store.sourceOwnershipActive(before.source) && x.h.store.authorizationScopeActive(before.authorization));
    assert.equal(row.delivered, false); await cProjectsCanvasNoWrites(x, before);
    observed.release(); await action; await observed.join(); await cCommandDraftDrain(x); await observed.join();
    assert.equal(row.delivered, true); assert.equal(row.response.bodyUsed, true, "Store consumes the SAME original Response");
    await cProjectsCanvasNoWrites(x, before);
    const originalSession = JSON.parse(before.session);
    assert.deepEqual(x.h.store.session.get(), { ...row.body, audience: originalSession.audience },
      "The real session is applied with the existing cross-workspace audience retention, not treated as an ACK");
    assert.ok(x.h.store.sourceOwnershipActive(before.source) && x.h.store.authorizationScopeActive(before.authorization),
      "Same actor, permission epoch and retained audience keep this original Source current");
    t.diagnostic("C_PROJECTS_CANVAS_JOIN " + JSON.stringify({ mode: t.name, completedBeforeRelease,
      originalStatus: row.response.status, originalResponseConsumed: row.response.bodyUsed,
      route: x.h.store.route.get(), ownerConnected: x.owner.isConnected,
      projectUnchanged: x.h.store.projection.get().projectId === before.projectId,
      documentUnchanged: x.h.store.projection.get().documentId === before.documentId,
      attributableRequests: x.h.requests.slice(before.requests).map(request => ({ method: request.init.method ?? "GET", url: request.url })),
      historyPrivateReceiptsAndFinancialUnchanged: true, intakeDispatches: x.dispatches.length,
      evidence: "actual native footer/complete Shell/Store and original isolated Worker response; finite DOM, not physical browser or provider proof" }));
    cPageShortcutArrived(x, "/canvas", "forma-canvas-surface");
    const entries = x.f.components().filter(value => value.tag === "forma-canvas-application" && value.isConnected);
    assert.equal(entries.length, 1); assert.equal(entries[0].store, x.h.store);
    const canvas = x.f.components().filter(value => value.tag === "forma-canvas-surface" && value.isConnected);
    assert.equal(canvas.length, 1); assert.equal(canvas[0].parentElement, entries[0]);
    const receipt = x.h.store.captureWorkspaceNavigationFocus("/canvas");
    assert.ok(receipt && receipt.routeCurrent(), "The actual Store committed this original navigation receipt");
    assert.equal(x.h.store.canvasProjection.get().projectId, before.projectId);
  } finally {
    observed.release(); await Promise.allSettled([action]); await observed.join(); observed.restore();
  }
}
for (const mode of ["clean", "raw-resolve"])
test("C Projects current-project Canvas footer joins original session / en / " + mode, cCommandDraftOptions, async t => {
  const x = await cProjectsCanvasPage(t), empty = { name: "", documentTitle: "", objective: "" };
  const raw = mode === "clean" ? empty : { name: "  Retained Canvas intake B  ", documentTitle: " \t ", objective: " \n\t  " };
  await cCommandProjectType(x, raw); await cCommandProjectClose(x);
  cProjectsCanvasButton(x);
  const before = { ...await cCommandDraftBefore(x), private: cProjectsCanvasPrivate(x) };
  assert.equal(x.owner.captureCommandDeparture().blocked(), mode !== "clean");
  if (mode !== "clean") {
    const gesture = await cPageShortcutClick(x, () => cProjectsCanvasButton(x));
    await cCommandDraftNoWrites(x, before); await cProjectsCanvasNoWrites(x, before);
    cPageShortcutRefused(x, before, gesture);
    assert.equal(x.visible().modal, false, "The refusal does not reopen an intake without the user");
    await cCommandProjectReopen(x); assert.deepEqual(x.visible().draft, raw, "Exact raw strings, including empty-looking values, are retained");
    await cCommandProjectType(x, empty); await cCommandProjectClose(x);
    assert.equal(x.owner.captureCommandDeparture().blocked(), false);
    await cCommandDraftNoWrites(x, before); await cProjectsCanvasNoWrites(x, before);
    assert.equal(x.h.requests.length, before.requests, "Reopen, exact native clear and close create no request");
  }
  await cProjectsCanvasJoin(t, x, before);
});
