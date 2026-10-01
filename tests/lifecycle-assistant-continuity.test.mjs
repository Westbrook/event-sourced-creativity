// Mounted CreativeAssistant/Panel/Workspace/Store with the existing routed RAM
// Worker. No provider is configured; only genuine reads and exact quick-edit
// resume are admitted. This is not physical browser, AT or production evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createCalmFullPage, calmFullPageNativePorts as ports, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { installImageFormatNativeLifetime } from "./helpers/image-format-native-lifetime.mjs";
import { creativeNextActions } from "../src/model/workspace-intelligence.ts";
import { nextActionFacts } from "../src/state/next-action-context.ts";
import { withDocumentInRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";
import { appendAuditEvent, readWorkspaceEvents } from "../worker/runtime.ts";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";

const options = { concurrency: false, timeout: 45_000 };
const classed = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, ancestor) => { for (let at = node; at; at = at.parent) if (at === ancestor) return true; return false; };
const assertFormatAlternatives = (tree, dialog) => {
  // Fixed CreativeMedium contract: image plus the seven document artifact kinds;
  // keep this oracle independent of the renderer and its imported kind list.
  const values = tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && inside(node, dialog))
    .map(node => node.component?.value).sort();
  assert.deepEqual(values, ["audio", "image", "model3d", "scene", "short_story", "slides", "storyboard", "video"],
    "all existing format alternatives remain exactly once; no format is automatically submitted");
};
// Match f.find's exactly-one-visible contract within one explicit snapshot.
// fullPageTree nodes are new objects on each call; parent identity is local.
const findIn = (tree, tag, predicate) => {
  const found = tree.visible(tag).filter(predicate);
  assert.equal(found.length, 1, "one visible " + tag + " matches predicate"); return found[0];
};
const RAW = "  My unsent question still belongs here — 保留  ";

async function mounted(t, locale, { canvas = false } = {}) {
  const h = await createSceneStoreHost({ count: 1, exposeSceneTestAccessors: false }); t.after(() => h.close());
  const worker = h.worker; worker.env.OPENAI_API_KEY = "";
  const canvasId = "assistant-lifecycle-handoff-board";
  if (canvas) {
    // Existing board-lifecycle fixture admission: seed only this RAM actor's
    // internal-admin role, then read real Canvas permission from the Worker.
    worker.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(worker.owner);
    await appendAuditEvent(worker.env, worker.streamId, "user", "CanvasCreated", {
      project_id: worker.projectId, canvas_id: canvasId, name: "Assistant handoff board",
    });
    await h.store.refreshEvents();
    const previousChannel = globalThis.BroadcastChannel; globalThis.BroadcastChannel = undefined;
    t.after(() => { globalThis.BroadcastChannel = previousChannel; });
  }
  const sessionResponse = await worker.request("/api/session"); assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert.equal(session.assistant?.enabled, true); assert.equal(session.policy.accepted, true);
  assert.equal(session.provider.configured, false); assert.ok(session.capabilities.includes("project.author"));
  const original = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get() };
  const pending = new Set(), reads = []; let external = 0;
  h.transport = request => {
    const method = request.init.method ?? "GET";
    const resume = request.url === "/api/workspace/quick-edit" && method === "POST"
      && request.body?.action === "resume" && request.body.projectId === h.store.projection.get().projectId
      && request.body.documentId === h.store.projection.get().documentId
      && JSON.stringify(Object.keys(request.body).sort()) === JSON.stringify(["action", "documentId", "projectId"]);
    assert.ok(method === "GET" || resume, "local recommendations cannot submit chat, approval, generation, export or a plan");
    const reply = worker.request(request.url, request.init).then(response => {
      reads.push({ path: request.url, method, status: response.status, resume }); return response;
    });
    pending.add(reply); void reply.then(() => pending.delete(reply), () => pending.delete(reply)); return reply;
  };
  t.mock.method(globalThis, "fetch", (input, init = {}) => {
    const url = new URL(String(input), "http://localhost");
    if (!["http://localhost", "https://fixture.invalid"].includes(url.origin) || !url.pathname.startsWith("/api/")) {
      external++; throw Error("No external/provider request in lifecycle recommendation test");
    }
    return h.fetch(url.pathname + url.search, init);
  });
  const previousHistory = globalThis.history;
  const locate = route => { const url = new URL(route, "http://localhost"); Object.assign(h.location,
    { pathname: url.pathname, search: url.search, hash: url.hash, href: url.href }); };
  globalThis.history = { pushState(_state, _title, route) { locate(route); }, replaceState(_state, _title, route) { locate(route); } };
  t.after(() => { globalThis.history = previousHistory; });
  const f = await createCalmFullPage(t, { locale, assistant: true, storeHost: h });
  // Restore the exact initialized Worker content after the helper's explicitly
  // synthetic layout sample, before any audited recommendation gesture.
  h.store.events.set(original.events); h.store.head.set(original.head); h.store.content.set(original.content);
  h.store.session.set(session); locate(h.store.route.get());
  const dispatch = h.window.dispatchEvent;
  h.window.dispatchEvent = function (event) {
    const result = dispatch.call(this, event);
    for (const handler of [...(f.listeners.get(event.type) ?? [])]) handler(event);
    return result;
  };
  t.after(() => { h.window.dispatchEvent = dispatch; });
  const settle = async () => { for (let step = 0; step < 4; step++) { await Promise.all([...pending]); await f.settle(); } };
  await settle(); assert.deepEqual(h.store.events.get(), original.events); assert.ok(h.store.routeDataReady());
  const native = installOutputNavigationFocusNative(t, f, ports); await settle();
  if (canvas) {
    // Complete the same real CEM transitive registry used by the board fixture
    // before transition callbacks can synchronously inspect the new hierarchy.
    const definitions = JSON.parse(fs.readFileSync(new URL("../custom-elements.json", import.meta.url), "utf8"));
    const byTag = new Map(definitions.modules.flatMap(module => (module.declarations ?? []).filter(value => value.tagName)
      .map(value => [value.tagName, { file: module.path, name: value.name }]))), registered = new Set();
    async function register(tag) {
      if (registered.has(tag)) return; registered.add(tag);
      const entry = byTag.get(tag); assert.ok(entry, "actual registered component " + tag);
      if (!f.renderer.registry[tag]) f.renderer.registry[tag] = (await ports.loadActual(entry.file))[entry.name];
      for (const child of new Set([...fs.readFileSync(new URL("../" + entry.file, import.meta.url), "utf8")
        .matchAll(/<(forma-[\w-]+)(?=[\s>])/gu)].map(match => match[1]))) await register(child);
    }
    for (const tag of ["forma-canvas-application", "forma-workspace"]) await register(tag);
    assert.equal(session.canvas.access, true); assert.ok(session.capabilities.includes("project.canvas.use"));
    // Reuse the existing finite Canvas ResizeObserver rule; no geometry claim.
    const resizeSeen = new WeakMap();
    f.resizeTargets = new class extends Map {
      *[Symbol.iterator]() { for (const [observer, node] of super[Symbol.iterator]()) {
        if (classed(node, "canvas-viewport")) {
          const owner = node.owner ?? node, box = node.getBoundingClientRect(), stamp = box.width + ":" + box.height;
          if (resizeSeen.get(owner) === stamp) continue; resizeSeen.set(owner, stamp);
        }
        yield [observer, node];
      } }
    }(f.resizeTargets);
    assert.equal(await h.store.transitionWorkspace("/canvas/" + canvasId + "/assistant-handoff-board"), true);
    assert.equal(h.store.chooseCanvasPlanningDocument(worker.documentId), true, "Explicit original planning Document, not a first-document guess");
    await settle();
    assert.ok(reads.some(row => row.path === "/api/session?audience=canvas" && row.status === 200));
    const wrapper = f.components().filter(value => value.tag === "forma-canvas-application");
    const board = f.components().filter(value => value.tag === "forma-canvas-surface");
    assert.equal(wrapper.length, 1); assert.equal(board.length, 1);
    assert.ok(board[0].isConnected); assert.strictEqual(board[0].closest("forma-canvas-application"), wrapper[0]);
    assert.equal(h.store.canvasProjection.get().selectedCanvasId, canvasId);
    assert.equal(h.store.canvasPlanningDocumentId(), worker.documentId);
  }
  const assistant = f.components().find(component => component.tag === "forma-creative-assistant");
  const panel = f.components().find(component => component.tag === "forma-assistant-panel" && component.parentElement === assistant);
  assert.ok(assistant?.isConnected && panel?.isConnected);
  const launcher = f.find("button", node => node.owner === panel && classed(node, "forma-assistant-launcher"));
  native.emit("pointerdown", launcher.port); native.focus(launcher.port); await f.act(launcher); await settle();
  assert.equal(panel.open, true);
  assert.ok(reads.some(row => row.path.startsWith("/api/assistant?") && row.status === 200), "actual authorized free context read");
  const source = h.store.captureSourceOwnership(), authority = h.store.captureAuthorizationScope(), route = h.store.route.get();
  assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authority));
  const before = structuredClone({ events: h.store.events.get(), content: h.store.content.get(), head: h.store.head.get() });
  const messages = structuredClone(panel.messages), tasks = structuredClone(panel.tasks);
  t.after(() => {
    assert.deepEqual({ events: h.store.events.get(), content: h.store.content.get(), head: h.store.head.get() }, before);
    assert.equal(external, 0);
    assert.equal(h.requests.some(row => row.url.startsWith("/api/assistant") && row.init.method === "POST"), false);
    assert.equal(h.requests.some(row => row.url.startsWith("/api/document-jobs") && row.init.method === "POST"), false);
  });
  const group = (tree = f.tree()) => {
    const continuation = findIn(tree, "div", value => value.owner === panel && classed(value, "forma-assistant-continuation"));
    return findIn(tree, "section", node => classed(node, "lifecycle-next-actions") && inside(node, continuation));
  };
  const actions = () => creativeNextActions(nextActionFacts(h.store, h.store.projection.get().documentId, null, { lifecycle: true }));
  const cardFor = action => {
    const index = actions().findIndex(value => JSON.stringify(value) === JSON.stringify(action)); assert.ok(index >= 0);
    const tree = f.tree(), container = group(tree);
    const cards = tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && inside(node, container));
    assert.ok(cards[index]); return findIn(tree, "button", node => inside(node, cards[index]));
  };
  return { h, f, worker, native, assistant, panel, source, authority, route, before, messages, tasks, settle, group, actions, cardFor, reads, canvasId };
}

for (const locale of ["en", "ja"]) {
  test("mounted Assistant derives local current-Document choices outside its conversation " + locale, options, async t => {
    const x = await mounted(t, locale), { f, panel } = x, p = x.h.store.projection.get();
    const tree = f.tree(), group = x.group(tree), log = findIn(tree, "div", node => node.owner === panel && node.attributes.role === "log");
    assert.equal(inside(group, log), false); assert.equal(inside(log, group), false);
    assert.deepEqual(tree.visible("bdi").filter(node => inside(node, group)).map(node => node.text), [p.projectName, p.documentTitle]);
    const cards = tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && inside(node, group));
    assert.equal(cards.length, x.actions().length); assert.ok(cards.length >= 1 && cards.length <= 3);
    assert.equal(cards.filter(node => node.attributes["data-primary"] === "true").length, 1);
    assert.ok(x.actions().every(action => action.target.documentId === p.documentId && action.target.sourceGeneration === x.source.generation));
    await x.settle(); assert.deepEqual(panel.messages, x.messages); assert.deepEqual(panel.tasks, x.tasks);
    assert.equal(x.h.store.route.get(), x.route); assert.equal(panel.navigationBlocked, false);
  });

  test("mounted Assistant recommendation updates do not acknowledge or erase an unsent draft " + locale, options, async t => {
    const x = await mounted(t, locale), { f, panel } = x;
    const field = () => f.find("textarea", node => classed(node, "forma-assistant-input"));
    const current = field(); current.port.value = RAW; x.native.emit("keydown", current.port); x.native.focus(current.port); await f.act(current, "input");
    assert.equal(panel.navigationBlocked, true);
    const blockedTree = f.tree(), blockedGroup = x.group(blockedTree);
    const fieldset = findIn(blockedTree, "fieldset", node => node.owner === panel && inside(blockedGroup, node));
    assert.equal(Object.hasOwn(fieldset.attributes, "disabled"), true);
    assert.equal(Object.hasOwn(field().attributes, "disabled"), false);
    await x.h.store.refreshEvents(); await x.settle();
    assert.equal(field().properties.value, RAW); assert.equal(x.h.store.route.get(), x.route);
    assert.deepEqual(panel.messages, x.messages); assert.deepEqual(panel.tasks, x.tasks);
    const cleared = field(); cleared.port.value = ""; await f.act(cleared, "input");
    assert.equal(panel.navigationBlocked, false);
    const clearedTree = f.tree(), clearedGroup = x.group(clearedTree);
    assert.equal(Object.hasOwn(findIn(clearedTree, "fieldset", node => node.owner === panel && inside(clearedGroup, node)).attributes, "disabled"), false);
    assert.ok(x.h.store.sourceOwnershipActive(x.source));
  });

  test("mounted Assistant next-step click opens exact free preparation without sending a message " + locale, options, async t => {
    const x = await mounted(t, locale), { f, panel } = x, p = x.h.store.projection.get();
    const action = x.actions().find(value => value.target.kind === "configure");
    assert.ok(action && action.target.medium === null, "the unchanged fixture has no explicit medium; all supported choices stay deliberate");
    const button = x.cardFor(action); x.native.emit("pointerdown", button.port); x.native.focus(button.port); await f.act(button);
    for (let step = 0; step < 8 && !f.tree().visible("dialog").some(node => classed(node, "next-format-dialog")); step++) await x.settle();
    const tree = f.tree(), dialog = findIn(tree, "dialog", node => classed(node, "next-format-dialog"));
    assert.equal(dialog.owner.tag, "forma-workspace"); assert.ok(dialog.port.open);
    assert.equal(x.h.store.projection.get().projectId, p.projectId); assert.equal(x.h.store.projection.get().documentId, p.documentId);
    assertFormatAlternatives(tree, dialog); assert.equal(panel.open, true, "no fake accepted-tool close is used for navigation");
    assert.deepEqual(panel.messages, x.messages); assert.deepEqual(panel.tasks, x.tasks);
    const close = findIn(tree, "button", node => node.owner === dialog.owner && inside(node, dialog) && node.text === f.i18n.t("action.close"));
    await f.act(close); await x.settle();
    assert.equal(f.tree().visible("dialog").some(node => classed(node, "next-format-dialog")), false);
    assert.equal(x.h.store.route.get(), withDocumentInRoute("/", p.documentId, p.documentTitle)); assert.equal(panel.open, true);
  });
}

// Paired complete current-host handoff labels. The desired naming assertion is
// last: a setup/permission/arrival failure is never counted as a label failure.
for (const locale of ["en", "ja"]) for (const canvas of [false, true])
test("mounted " + (canvas ? "Canvas" : "Creator") + " Assistant announces exact preparation destination " + locale, options, async t => {
  const x = await mounted(t, locale, { canvas }), { f, panel } = x, p = x.h.store.projection.get();
  const money = financial(x.worker), resume = observeActualSceneResumeReads(x.h), first = x.h.requests.length;
  t.after(() => resume.restore());
  const action = x.actions().find(value => value.target.kind === "configure"); assert.ok(action);
  assert.equal(action.target.documentId, p.documentId); assert.equal(action.target.projectId, p.projectId);
  assert.equal(action.target.canvasId, null); assert.equal(action.target.sourceGeneration, x.source.generation);
  assert.equal(action.target.authorityKey, x.authority.key);
  const tree = f.tree(), group = x.group(tree);
  const button = findIn(tree, "button", node => inside(node, group) && node.attributes["data-choice-value"] === action.id);
  const label = findIn(tree, "strong", node => inside(node, button)).text;
  const nativeName = button.attributes["aria-label"] ?? button.text;
  assert.equal(button.owner.tag, "forma-ui-choice-card"); assert.ok(button.port.isConnected);
  assert.equal(button.owner.label, label); assert.ok(nativeName.includes(label));
  assert.equal(panel.navigationBlocked, false);
  x.native.emit("pointerdown", button.port); x.native.focus(button.port); await f.act(button);
  for (let step = 0; step < 16; step++) {
    await x.settle();
    for (const [id, timer] of [...x.h.timers]) if (timer.delay === 16) { x.h.timers.delete(id); timer.callback(0); }
    await resume.settleOriginalRequests();
    if (f.tree().visible("dialog").some(node => classed(node, "next-format-dialog") && node.port?.open)) break;
  }
  await x.settle(); await resume.settleOriginalRequests();
  const arrival = f.tree(), dialog = findIn(arrival, "dialog", node => classed(node, "next-format-dialog") && node.port?.open);
  assert.equal(dialog.owner.tag, "forma-workspace");
  assert.equal(x.h.store.route.get(), withDocumentInRoute("/", p.documentId, p.documentTitle));
  assert.equal(x.h.store.projection.get().projectId, p.projectId); assert.equal(x.h.store.projection.get().documentId, p.documentId);
  assertFormatAlternatives(arrival, dialog);
  assert.deepEqual({ events: x.h.store.events.get(), content: x.h.store.content.get(), head: x.h.store.head.get() }, x.before);
  assert.deepEqual(financial(x.worker), money);
  assert.deepEqual(x.h.requests.slice(first).filter(row => (row.init.method ?? "GET") !== "GET" && !resume.isReadOnlyResume(row)), [],
    "No mutation beyond an original exact 200/none zero-SQL-change Resume read");
  if (canvas) assert.ok(x.reads.some(row => row.path === "/api/session?audience=creative" && row.status === 200),
    "The original Canvas action rechecks actual receiving Creator authority");
  t.diagnostic(JSON.stringify({ origin: x.route, label, nativeName, destination: x.h.store.route.get(),
    actualDialog: dialog.attributes.class, documentId: p.documentId }));
  const suffix = " · " + f.i18n.t("next.exact.creatorWorkspace", "Creator Workspace");
  assert.equal(label.endsWith(suffix), canvas, "Only a Canvas-origin Creator-only action announces the application handoff");
  assert.equal(nativeName.includes(suffix), canvas, "Native name retains the same visible destination");
});

// Additive command-origin controls use the existing actual Assistant fixture.
// No pending request, private state, permission or native input default is seeded.
async function settleAssistantCommand(x, resume) {
  let queues;
  for (let step = 0; step < 4; step++) {
    // This observer retains every original transport Promise, not just the
    // Resume requests it may later certify. Joining never starts a request.
    await resume.settleOriginalRequests();
    for (const [id, timer] of [...x.h.timers]) if (timer.delay === 16) {
      x.h.timers.delete(id); timer.callback(0);
    }
    // The existing full-page settle already drains native component frames
    // and joins each mounted Output resource. Avoid nesting it four times.
    await x.f.settle(); await resume.settleOriginalRequests();
    queues = { transports: resume.pendingOriginalCount(), componentFrames: x.f.frames.size,
      storeFrames: [...x.h.timers.values()].filter(timer => timer.delay === 16).length,
      renderRequests: Number(x.f.requested) };
    if (Object.values(queues).every(value => value === 0)) break;
  }
  assert.deepEqual(queues, { transports: 0, componentFrames: 0, storeFrames: 0, renderRequests: 0 },
    "Current transport, actual scheduled frames and render requests must be quiescent before outcome assertions");
}
async function openLibraryFromCurrentCommand(x, resume, checkpoint) {
  const { f, native, panel } = x;
  assert.equal(panel.open, false, "the Assistant is collapsed through its actual Close control");
  const opener = f.find("button", node => node.owner === f.host && classed(node, "command-trigger"));
  checkpoint("command-opening");
  native.emit("pointerdown", opener.port); native.focus(opener.port); await f.act(opener); await x.settle();
  checkpoint("command-opened");
  assert.ok(f.tree().visible("dialog").some(node => node.owner === f.host && classed(node, "command-dialog") && node.port?.open));
  const label = f.i18n.t("command.openLibrary", "Open reusable library");
  const row = f.find("button", node => node.owner === f.host && node.attributes.role === "option"
    && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label));
  assert.equal(row.attributes.type, "button"); assert.equal(row.attributes.tabindex, "-1");
  assert.ok(row.port.isConnected && !row.hiddenBy);
  native.emit("pointerdown", row.port); native.focus(row.port);
  const traceStart = f.trace.length;
  const openerFocus = [], pushDescriptor = Object.getOwnPropertyDescriptor(native.nativeFocus, "push"), push = native.nativeFocus.push;
  // Observe only the already-issued finite native focus call. Do not focus,
  // reconnect or substitute a port, and leave the original strict oracle below.
  native.nativeFocus.push = function (...calls) {
    for (const call of calls) if (call.node?.owner === f.host && classed(call.node, "command-trigger")) {
      const current = f.renderer.nodes.filter(node => node.owner === f.host && classed(node, "command-trigger"));
      openerFocus.push({ node: call.node, connectedAtCall: Boolean(call.node.isConnected),
        currentAtCall: current.includes(call.node), currentCountAtCall: current.length, capturedAtCall: call.node === opener.port });
    }
    return push.apply(this, calls);
  };
  checkpoint("command-chosen");
  try { await f.act(row); checkpoint("command-activation-returned"); await settleAssistantCommand(x, resume); }
  finally { if (pushDescriptor) Object.defineProperty(native.nativeFocus, "push", pushDescriptor); else delete native.nativeFocus.push; }
  checkpoint("command-settled");
  return { opener, openerFocus, promoted: f.trace.slice(traceStart).filter(value => value.startsWith("open:")) };
}

for (const locale of ["en", "ja"]) for (const state of ["clean", "raw"])
test("C command origin retains collapsed Assistant work / " + state + " / " + locale, { ...options, timeout: 120_000 }, async t => {
  const started = Date.now();
  const checkpoint = phase => t.diagnostic(JSON.stringify({ kind: "Assistant-command-phase", locale, state, phase,
    at: new Date().toISOString(), elapsedMs: Date.now() - started }));
  checkpoint("mounting");
  const x = await mounted(t, locale), { f, native, panel, assistant } = x;
  checkpoint("mounted");
  // The shared current CEM registrar loads actual Library descendants before
  // synchronous native focus queries; it does not replace any component.
  checkpoint("registrar-start");
  await registerCalmFullPageComponents(f, ["forma-library"]); await x.settle();
  checkpoint("registrar-settled");
  const before = { projectId: x.h.store.projection.get().projectId, documentId: x.h.store.projection.get().documentId,
    scope: panel.conversationScope, messages: structuredClone(panel.messages), tasks: structuredClone(panel.tasks) };
  const resume = observeActualSceneResumeReads(x.h); t.after(() => resume.restore());
  const first = x.h.requests.length, money = financial(x.worker);
  const field = () => f.find("textarea", node => classed(node, "forma-assistant-input"));
  const collapse = async () => {
    checkpoint("collapse-start");
    const button = f.find("button", node => node.owner === panel && classed(node, "forma-assistant-close"));
    native.emit("pointerdown", button.port); native.focus(button.port); await f.act(button); await x.settle();
    checkpoint("collapse-settled");
    assert.equal(panel.open, false); assert.ok(panel.isConnected && assistant.isConnected);
    assert.equal(f.tree().visible("textarea").some(node => classed(node, "forma-assistant-input")), false);
  };
  const current = () => {
    assert.ok(x.h.store.sourceOwnershipActive(x.source) && x.h.store.authorizationScopeActive(x.authority));
    assert.equal(x.h.store.projection.get().projectId, before.projectId);
    assert.equal(x.h.store.projection.get().documentId, before.documentId);
    assert.ok(ports.ElementPort.hasStoreIdentity(assistant, x.h.store));
    assert.strictEqual(f.components().find(value => value.tag === "forma-assistant-panel" && value.parentElement === assistant), panel);
  };
  const quiet = () => {
    assert.deepEqual({ events: x.h.store.events.get(), content: x.h.store.content.get(), head: x.h.store.head.get() }, x.before);
    assert.deepEqual(financial(x.worker), money);
    assert.deepEqual(x.h.requests.slice(first).filter(row => (row.init.method ?? "GET") !== "GET" && !resume.isReadOnlyResume(row)), [],
      "No chat, generation, Apply, approval or other write; only certified original free Resume is admissible");
  };
  assert.equal(field().port.value, "", "observe the actual initial input; do not manufacture its default");
  assert.equal(panel.navigationBlocked, false);
  if (state === "raw") {
    const input = field(); native.emit("keydown", input.port); native.focus(input.port);
    input.port.value = RAW; await f.act(input, "input");
    assert.equal(field().port.value, RAW); assert.equal(panel.navigationBlocked, true);
  }
  await collapse(); current(); assert.equal(panel.navigationBlocked, state === "raw");
  const attempt = await openLibraryFromCurrentCommand(x, resume, checkpoint); quiet();
  t.diagnostic(JSON.stringify({ kind: "collapsed-Assistant-command-origin", locale, state,
    origin: x.route, route: x.h.store.route.get(), blocked: panel.navigationBlocked,
    assistantOpen: panel.open, promoted: attempt.promoted, requests: x.h.requests.length - first }));
  if (state === "raw") {
    assert.equal(x.h.store.route.get(), x.route, "a collapsed live draft still vetoes departure");
    current(); assert.equal(panel.conversationScope, before.scope);
    assert.equal(panel.navigationBlocked, true); assert.equal(panel.open, false);
    assert.equal(x.h.store.ui.commandOpen, false); assert.deepEqual(attempt.promoted, []);
    assert.deepEqual(panel.messages, before.messages); assert.deepEqual(panel.tasks, before.tasks);
    const currentOpener = f.find("button", node => node.owner === f.host && classed(node, "command-trigger"));
    const active = native.document.activeElement, describe = node => ({ tag: node?.tag ?? null, owner: node?.owner?.tag ?? null,
      className: node?.attributes?.class ?? null, name: node?.attributes?.["aria-label"] ?? null,
      connected: Boolean(node?.isConnected), present: f.renderer.nodes.includes(node) });
    t.diagnostic(JSON.stringify({ kind: "Assistant-command-opener-native-identity", locale,
      captured: describe(attempt.opener.port), current: describe(currentOpener.port), active: describe(active),
      activeIsCaptured: active === attempt.opener.port, activeIsCurrent: active === currentOpener.port,
      actualFocusCalls: attempt.openerFocus.map(({ node, ...observed }) => ({ ...observed,
        connectedNow: Boolean(node.isConnected), presentNow: f.renderer.nodes.includes(node), activeNow: node === active })),
      evidence: "pass-through observation of existing native focus calls and literal-port retirement; no physical focus claim" }));
    assert.strictEqual(native.document.activeElement, currentOpener.port, "untouched refusal restores only the current original command opener");
    const launcher = f.find("button", node => node.owner === panel && classed(node, "forma-assistant-launcher"));
    native.emit("pointerdown", launcher.port); native.focus(launcher.port); await f.act(launcher); await x.settle();
    checkpoint("assistant-reopened");
    current(); assert.equal(panel.open, true); assert.equal(field().port.value, RAW, "reopening exposes the exact retained raw draft");
    const input = field(); native.emit("keydown", input.port); native.focus(input.port);
    input.port.value = ""; await f.act(input, "input");
    checkpoint("native-clear-settled");
    assert.equal(field().port.value, ""); assert.equal(panel.navigationBlocked, false);
    await collapse(); current(); quiet();
    await openLibraryFromCurrentCommand(x, resume, checkpoint);
  }
  const destination = new URL(x.h.store.route.get(), "http://localhost");
  assert.equal(destination.pathname, "/library"); assert.deepEqual(destination.searchParams.getAll("document"), [before.documentId]);
  assert.equal(x.h.store.ui.commandOpen, false); assert.equal(panel.open, false);
  const libraries = f.components().filter(value => value.tag === "forma-library");
  assert.equal(libraries.length, 1); assert.ok(libraries[0].isConnected && ports.ElementPort.hasStoreIdentity(libraries[0], x.h.store));
  current(); quiet();
  checkpoint("case-complete");
});

// C167: actual sibling-owner departure, not a new renderer or an invocation of
// private application handlers. Reuse the mounted Assistant/Shell/RAM Worker,
// its original-read transport and the existing ImageFormat native lifetime.
async function lifecycleSiblingPage(t, locale, surface) {
  const x = await mounted(t, locale), { f, h, native, panel } = x;
  const resume = observeActualSceneResumeReads(h); t.after(() => resume.restore());
  installImageFormatNativeLifetime({ f, h, after: callback => t.after(callback) });
  await registerCalmFullPageComponents(f, ["forma-guided-brief", "forma-projects", "forma-workspace"]);
  const activate = async node => {
    assert.ok(node.port.isConnected && !node.port.matches(":disabled"), "actual current enabled native control");
    native.emit("pointerdown", node.port); native.focus(node.port);
    await f.act(node, "click", { button: 0 }); await x.settle();
  };
  const toggle = async open => {
    assert.notEqual(panel.open, open, "use the currently available native open/close control");
    await activate(f.find("button", node => node.owner === panel
      && classed(node, open ? "forma-assistant-launcher" : "forma-assistant-close")));
    assert.equal(panel.open, open); assert.ok(panel.isConnected && x.assistant.isConnected);
  };
  await toggle(false);
  const p = h.store.projection.get(), expected = surface === "guided"
    ? withDocumentInRoute("/studio/guided", p.documentId, p.documentTitle)
    : withProjectTaskDocumentInRoute("/projects", p.documentId, h.store.route.get());
  let entry;
  if (surface === "guided") {
    // Reuse the accepted native View disclosure gesture before selecting its
    // exact Guided anchor; do not bypass Shell admission or install a route.
    const modes = f.components().filter(component => component.tag === "forma-studio-mode-nav"
      && component.isConnected && component.store === h.store);
    assert.equal(modes.length, 1); assert.equal(modes[0].closest("forma-shell"), f.host);
    const menus = f.components().filter(component => component.tag === "forma-ui-popover"
      && component.parentElement === modes[0] && classed(component, "studio-view-menu"));
    assert.equal(menus.length, 1); const menu = menus[0];
    assert.ok(menu.isConnected && menu instanceof f.renderer.registry["forma-ui-popover"]);
    assert.equal(menu.store, h.store);
    const trigger = f.find("button", node => node.owner === menu && classed(node, "ui-popover-trigger"));
    assert.ok(trigger.port.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
    assert.equal(trigger.attributes["aria-expanded"], "false"); assert.equal(typeof trigger.attributes.popovertarget, "string");
    const currentRoute = h.store.route.get(), source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
    assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
    native.emit("pointerdown", trigger.port); native.focus(trigger.port); trigger.port.click();
    await x.settle();
    assert.equal(h.store.route.get(), currentRoute, "opening View preserves the exact current route before sibling departure");
    assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
    assert.ok(modes[0].isConnected && menu.isConnected && menu.parentElement === modes[0]);
    const tree = f.tree(), panels = tree.visible("section").filter(node => node.owner === menu && node.attributes.popover === "auto");
    assert.equal(panels.length, 1); assert.equal(panels[0].port.matches(":popover-open"), true);
    const currentTrigger = findIn(tree, "button", node => node.owner === menu && classed(node, "ui-popover-trigger"));
    assert.equal(currentTrigger.attributes.popovertarget, panels[0].attributes.id);
    assert.equal(currentTrigger.attributes["aria-controls"], panels[0].attributes.id);
    assert.equal(currentTrigger.attributes["aria-expanded"], "true");
    const links = tree.visible("a").filter(node => node.owner === menu && inside(node, panels[0])
      && Object.hasOwn(node.attributes, "data-studio-view"));
    assert.deepEqual(links.map(node => node.attributes["data-studio-view"]), ["document", "board", "guided", "layers", "adaptive", "editor", "chat"]);
    const guided = links.filter(node => node.attributes["data-studio-view"] === "guided"
      && node.attributes.href === expected && node.text === f.i18n.system("Guided brief"));
    assert.equal(guided.length, 1); entry = guided[0];
    assert.equal(typeof entry.handlers.click, "function"); assert.equal(entry.port.handlers.click, entry.handlers.click);
  } else {
    entry = f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
      && node.attributes.href === expected);
  }
  await activate(entry); assert.equal(h.store.route.get(), expected, "actual public entry reached the exact original Document route");
  const owners = f.components().filter(owner => owner.tag === (surface === "guided" ? "forma-guided-brief" : "forma-projects"));
  assert.equal(owners.length, 1); const owner = owners[0];
  assert.ok(owner.isConnected && ports.ElementPort.hasStoreIdentity(owner, h.store));
  assert.equal(owner.captureCommandDeparture().blocked(), false, "the actual populated surface begins clean");
  await toggle(true);
  assert.equal(panel.navigationBlocked, false); assert.equal(panel.commandDepartureBlocked, false);
  const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
  assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
  await resume.settleOriginalRequests(); await x.settle(); await workerQuiet();
  const snapshot = { route: h.store.route.get(), projectId: h.store.projection.get().projectId,
    documentId: h.store.projection.get().documentId, events: structuredClone(h.store.events.get()),
    content: structuredClone(h.store.content.get()), head: h.store.head.get(),
    history: await readWorkspaceEvents(x.worker.env, x.worker.streamId), money: financial(x.worker),
    receipts: x.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
    requests: h.requests.length, scope: panel.conversationScope,
    messages: structuredClone(panel.messages), tasks: structuredClone(panel.tasks) };
  async function workerQuiet() { await x.worker.drainBackground(); await resume.settleOriginalRequests(); }
  const quiet = async () => {
    await x.settle(); await workerQuiet();
    assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), snapshot.history);
    assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), snapshot.receipts);
    assert.deepEqual(financial(x.worker), snapshot.money);
    assert.deepEqual({ events: h.store.events.get(), content: h.store.content.get(), head: h.store.head.get() },
      { events: snapshot.events, content: snapshot.content, head: snapshot.head });
    assert.deepEqual(h.requests.slice(snapshot.requests).filter(row => (row.init.method ?? "GET") !== "GET"
      && !resume.isReadOnlyResume(row)), [], "only exact original-response and database-certified Resume is a read");
    assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
    assert.equal(h.store.projection.get().projectId, snapshot.projectId);
    assert.equal(h.store.projection.get().documentId, snapshot.documentId);
  };
  const configure = () => {
    const action = x.actions().find(value => value.target.kind === "configure");
    assert.ok(action && action.target.medium === null, "actual current resolver offers the existing free format chooser");
    assert.equal(action.target.projectId, snapshot.projectId); assert.equal(action.target.documentId, snapshot.documentId);
    assert.equal(action.target.sourceGeneration, source.generation);
    return action;
  };
  const ordinaryCard = action => {
    const tree = f.tree(), group = findIn(tree, "section", node => node.owner === owner && classed(node, "lifecycle-next-actions"));
    const cards = tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && inside(node, group));
    const choices = cards.filter(node => node.component?.value === action.id); assert.equal(choices.length, 1);
    return findIn(tree, "button", node => inside(node, choices[0]));
  };
  const assistantField = () => {
    const tree = f.tree(), form = findIn(tree, "form", node => node.owner === panel && classed(node, "forma-assistant-composer"));
    const composer = findIn(tree, "forma-ui-conversation-composer", node => node.owner === panel
      && inside(node, form) && classed(node, "forma-assistant-shared-composer"));
    assert.ok(composer.component?.isConnected && composer.component.closest("forma-assistant-panel") === panel);
    const input = findIn(tree, "textarea", node => node.owner === composer.component
      && inside(node, composer) && classed(node, "forma-assistant-input"));
    assert.ok(form.port.isConnected && input.port.isConnected && !input.port.matches(":disabled"),
      "actual current nested composer owns the enabled native field");
    return input;
  };
  const healthyArrival = async () => {
    await quiet();
    assert.equal(h.store.route.get(), withDocumentInRoute("/", snapshot.documentId, h.store.projection.get().documentTitle));
    const tree = f.tree(), dialog = findIn(tree, "dialog", node => classed(node, "next-format-dialog"));
    assert.equal(dialog.owner.tag, "forma-workspace"); assert.ok(dialog.port.isConnected && dialog.port.open);
    assert.ok(ports.ElementPort.hasStoreIdentity(dialog.owner, h.store));
    assertFormatAlternatives(tree, dialog);
    const close = findIn(tree, "button", node => node.owner === dialog.owner && inside(node, dialog)
      && node.text === f.i18n.t("action.close"));
    await activate(close); await quiet();
    assert.equal(f.tree().visible("dialog").some(node => classed(node, "next-format-dialog")), false);
  };
  return { ...x, owner, source, authorization, snapshot, activate, toggle, quiet, configure, ordinaryCard, assistantField, healthyArrival };
}

for (const locale of ["en", "ja"]) test("C lifecycle sibling admission: raw Guided survives clean Assistant Configure, then deliberate restore " + locale,
  { ...options, timeout: 120_000 }, async t => {
    const x = await lifecycleSiblingPage(t, locale, "guided"), { f, h, owner, panel } = x;
    await x.toggle(false);
    const field = () => f.find("textarea", node => node.owner === owner && node.attributes.id === "brief-direction");
    const original = field().port.value, sourceBlock = h.store.projection.get().blocks.find(block => block.type === "direction");
    assert.ok(sourceBlock); assert.equal(original, String(sourceBlock.properties.text)); assert.ok(original.length > 0);
    const form = f.find("form", node => node.owner === owner && node.attributes.id === field().attributes.form);
    assert.ok(form.port.isConnected && field().port.isConnected);
    const raw = "  Keep this actual Guided answer — 未保存\n ";
    const input = field(); x.native.emit("keydown", input.port); x.native.focus(input.port);
    input.port.value = raw; await f.act(input, "input"); await x.settle();
    assert.equal(field().port.value, raw); assert.equal(owner.captureCommandDeparture().blocked(), true);
    await x.toggle(true); assert.equal(panel.navigationBlocked, false);
    const action = x.configure(), target = JSON.stringify(action.target);
    await x.activate(x.cardFor(action)); await x.quiet();
    t.diagnostic("C_LIFECYCLE_SIBLING_ORIGIN " + JSON.stringify({ locale, origin: "Guided", control: "Assistant Configure",
      sourceCurrent: h.store.sourceOwnershipActive(x.source), currentRoute: h.store.route.get(), originalRoute: x.snapshot.route,
      underlyingOwnerConnected: owner.isConnected, assistantOpen: panel.open, exactReadHistoryReceiptFiscal: true }));
    assert.equal(h.store.route.get(), x.snapshot.route, "clean Assistant must not abandon its sibling's unsaved Guided answer");
    assert.ok(owner.isConnected && f.components().includes(owner)); assert.equal(field().port.value, raw);
    assert.equal(panel.open, true); assert.equal(panel.conversationScope, x.snapshot.scope);
    assert.deepEqual(panel.messages, x.snapshot.messages); assert.deepEqual(panel.tasks, x.snapshot.tasks);
    assert.equal(f.tree().visible("dialog").some(node => classed(node, "next-format-dialog")), false);
    lifecycleRefusalNotice(x, "next.lifecycle.currentWorkOpen");
    await x.toggle(false);
    const restore = field(); x.native.emit("keydown", restore.port); x.native.focus(restore.port);
    restore.port.value = original; await f.act(restore, "input"); await x.settle();
    assert.equal(field().port.value, original); assert.equal(owner.captureCommandDeparture().blocked(), false);
    await x.toggle(true); const fresh = x.configure(); assert.equal(JSON.stringify(fresh.target), target);
    await x.activate(x.cardFor(fresh)); await x.healthyArrival();
  });

for (const locale of ["en", "ja"]) test("C lifecycle sibling admission: Projects Configure retains collapsed Assistant raw, then deliberate clear " + locale,
  { ...options, timeout: 120_000 }, async t => {
    const x = await lifecycleSiblingPage(t, locale, "projects"), { f, h, owner, panel } = x;
    const field = x.assistantField;
    assert.equal(field().port.value, ""); assert.equal(owner.captureCommandDeparture().blocked(), false);
    const input = field(); x.native.emit("keydown", input.port); x.native.focus(input.port);
    input.port.value = RAW; await f.act(input, "input"); await x.settle();
    assert.equal(field().port.value, RAW); assert.equal(panel.commandDepartureBlocked, true);
    await x.toggle(false); assert.ok(panel.isConnected); assert.equal(panel.commandDepartureBlocked, true);
    const action = x.configure(), target = JSON.stringify(action.target);
    await x.activate(x.ordinaryCard(action)); await x.quiet();
    t.diagnostic("C_LIFECYCLE_SIBLING_ORIGIN " + JSON.stringify({ locale, origin: "Projects", control: "Projects Configure",
      sourceCurrent: h.store.sourceOwnershipActive(x.source), currentRoute: h.store.route.get(), originalRoute: x.snapshot.route,
      originalOwnerConnected: owner.isConnected, assistantOpen: panel.open, exactReadHistoryReceiptFiscal: true }));
    assert.equal(h.store.route.get(), x.snapshot.route, "ordinary recommendation must not abandon collapsed Assistant work");
    assert.ok(owner.isConnected && f.components().includes(owner)); assert.ok(panel.isConnected);
    assert.equal(panel.open, false); assert.equal(panel.commandDepartureBlocked, true);
    assert.equal(panel.conversationScope, x.snapshot.scope);
    assert.deepEqual(panel.messages, x.snapshot.messages); assert.deepEqual(panel.tasks, x.snapshot.tasks);
    assert.equal(f.tree().visible("dialog").some(node => classed(node, "next-format-dialog")), false);
    lifecycleRefusalNotice(x, "next.lifecycle.assistantOwnsWork");
    await x.toggle(true); assert.equal(field().port.value, RAW, "actual reopen exposes the retained native draft");
    const clear = field(); x.native.emit("keydown", clear.port); x.native.focus(clear.port);
    clear.port.value = ""; await f.act(clear, "input"); await x.settle();
    assert.equal(field().port.value, ""); assert.equal(panel.commandDepartureBlocked, false);
    await x.toggle(false); const fresh = x.configure(); assert.equal(JSON.stringify(fresh.target), target);
    await x.activate(x.ordinaryCard(fresh)); await x.healthyArrival();
  });

// C167 bounded non-departure control: the full URL and actual Workspace stay
// identical. A collapsed sibling draft is retained; preparation is not a Save.
test("C lifecycle same-URL Workspace Configure preserves collapsed Assistant raw", { ...options, timeout: 120_000 }, async t => {
  const x = await lifecycleSiblingPage(t, "en", "projects"), { f, h, panel } = x;
  await x.activate(x.ordinaryCard(x.configure())); await x.healthyArrival();
  const route = h.store.route.get(), workspace = f.components().filter(owner => owner.tag === "forma-workspace");
  assert.equal(workspace.length, 1); const owner = workspace[0];
  assert.ok(owner.isConnected && ports.ElementPort.hasStoreIdentity(owner, h.store));
  assert.equal(route, withDocumentInRoute("/", x.snapshot.documentId, h.store.projection.get().documentTitle));
  assert.equal(owner.captureCommandDeparture().blocked(), false);
  if (!panel.open) await x.toggle(true);
  const field = x.assistantField;
  const input = field(); x.native.emit("keydown", input.port); x.native.focus(input.port);
  input.port.value = RAW; await f.act(input, "input"); await x.settle();
  assert.equal(field().port.value, RAW); assert.equal(panel.commandDepartureBlocked, true);
  await x.toggle(false);
  const scope = panel.conversationScope, messages = structuredClone(panel.messages), tasks = structuredClone(panel.tasks);
  const action = x.configure(), target = JSON.stringify(action.target), tree = f.tree();
  const group = findIn(tree, "section", node => node.owner === owner && classed(node, "lifecycle-next-actions"));
  const cards = tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && inside(node, group)
    && node.component?.value === action.id);
  assert.equal(cards.length, 1);
  await x.activate(findIn(tree, "button", node => inside(node, cards[0]))); await x.quiet();
  assert.equal(h.store.route.get(), route, "preparation does not normalize or replace the complete current route");
  assert.ok(owner.isConnected && f.components().includes(owner), "the same actual Workspace remains mounted");
  assert.equal(panel.open, false); assert.equal(panel.commandDepartureBlocked, true);
  assert.equal(panel.conversationScope, scope); assert.deepEqual(panel.messages, messages); assert.deepEqual(panel.tasks, tasks);
  assert.equal(JSON.stringify(x.configure().target), target);
  const opened = f.tree(), dialog = findIn(opened, "dialog", node => node.owner === owner && classed(node, "next-format-dialog"));
  assert.ok(dialog.port.isConnected && dialog.port.open);
  assertFormatAlternatives(opened, dialog);
  await x.activate(findIn(opened, "button", node => node.owner === owner && inside(node, dialog)
    && node.text === f.i18n.t("action.close"))); await x.quiet();
  assert.equal(h.store.route.get(), route); assert.ok(owner.isConnected && f.components().includes(owner));
  await x.toggle(true); assert.equal(field().port.value, RAW, "native reopen exposes exactly the untouched sibling draft");
  const clear = field(); x.native.emit("keydown", clear.port); x.native.focus(clear.port);
  clear.port.value = ""; await f.act(clear, "input"); await x.settle(); await x.quiet();
  assert.equal(field().port.value, ""); assert.equal(panel.commandDepartureBlocked, false);
});

// C170 explicit new-case reporting oracle; no old receipt or route assertion is
// replaced. A real current-work refusal must keep its visible recovery guidance.
function lifecycleRefusalNotice({ f, h }, key) {
  const expected = f.i18n.t(key);
  assert.equal(h.store.ui.toast, expected, "the genuine shared refusal reason is not overwritten by generic unavailable copy");
  const tree = f.tree(), notice = findIn(tree, "div", node => node.owner.tag === "forma-shell"
    && classed(node, "toast") && node.attributes.role === "status");
  assert.ok(notice.port.isConnected); assert.equal(notice.attributes["aria-live"], "polite");
  assert.equal(notice.text, expected, "the current native status exposes the exact localized recovery guidance");
}
