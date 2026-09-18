import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { createCalmFullPage, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { appendAuditEvent } from "../worker/runtime.ts";

const PROMPT = "Plan this board after I choose its planning document.";
const classed = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const counts = worker => Object.fromEntries(["events", "event_private_payloads", "document_jobs", "authoring_commits",
  "budget_reservations", "budget_counters", "cost_budget_reservations", "cost_budget_counters", "consequential_executions",
  "output_provider_calls", "output_operation_slots"].map(table => [table, worker.sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all()]));

async function currentBoard(t) {
  const worker = await createSceneCostFixture(1);
  worker.env.OPENAI_API_KEY = "";
  await appendAuditEvent(worker.env, worker.streamId, "user", "DocumentCreated", {
    project_id: worker.projectId, document_id: "B1-second-document", title: "Another deliberate planning document",
  });
  await appendAuditEvent(worker.env, worker.streamId, "user", "CanvasCreated", {
    project_id: worker.projectId, canvas_id: "B1-unassigned-board", name: "Board awaiting a planning choice",
  });
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  t.after(() => h.close());
  const original = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get(), session: h.store.session.get() };
  assert.ok(original.session.assistant?.enabled && original.session.policy.accepted);
  assert.ok(original.session.capabilities.includes("project.author"));
  assert.ok(original.session.capabilities.includes("project.canvas.use"));
  assert.ok(original.session.capabilities.includes("project.output.request"));
  assert.equal(original.session.canvas.access, true); assert.equal(original.session.provider.configured, false);
  const previousChannel = globalThis.BroadcastChannel; globalThis.BroadcastChannel = undefined;
  t.after(() => { globalThis.BroadcastChannel = previousChannel; });
  let external = 0; const reads = [], pendingReads = new Set();
  h.transport = request => {
    assert.equal(request.init.method ?? "GET", "GET", "missing-document path never dispatches a tool, consent, mutation or provider request");
    const pending = worker.request(request.url, request.init).then(response => {
      reads.push({ path: request.url, status: response.status }); return response;
    });
    pendingReads.add(pending); void pending.then(() => pendingReads.delete(pending), () => pendingReads.delete(pending));
    return pending;
  };
  t.mock.method(globalThis, "fetch", (input, init = {}) => {
    const address = new URL(String(input), "http://localhost");
    if (!["http://localhost", "https://fixture.invalid"].includes(address.origin) || !address.pathname.startsWith("/api/")) {
      external++; throw new Error("No external/provider request");
    }
    return h.fetch(address.pathname + address.search, init);
  });
  const f = await createCalmFullPage(t, { storeHost: h, assistant: true });
 // The generic native renderer reconstructs element ports each draw. Real
 // ResizeObserver only re-notifies a stable element when its size changes.
 // Keep that browser behavior at the fixture boundary, never in production.
 const resizeSeen=new WeakMap(),targets=f.resizeTargets;
 f.resizeTargets=new class extends Map{
  *[Symbol.iterator](){for(const [observer,node]of super[Symbol.iterator]()){
   if(String(node.attributes?.class??"").split(/\s+/u).includes("canvas-viewport")){
    const key=node.owner??node,parent=resizeSeen.get(key)??new Map(),box=node.getBoundingClientRect(),stamp=box.width+":"+box.height;
    if(parent.get("canvas-viewport")===stamp)continue;parent.set("canvas-viewport",stamp);resizeSeen.set(key,parent);
   }yield [observer,node];
  }}
 }(targets);
  // Restore the actual initialized Worker snapshot after the shared helper's
  // layout-only synthetic cards. No Store getter or authorization is replaced.
  h.store.events.set(original.events); h.store.head.set(original.head); h.store.content.set(original.content); h.store.session.set(original.session);
  h.store.route.set("/canvas/B1-unassigned-board/board-awaiting-a-planning-choice");
  await f.settle(); await Promise.all([...pendingReads]); await f.settle();
  assert.equal(h.store.canvasProjection.get().selectedCanvasId, "B1-unassigned-board");
  assert.equal(h.store.canvasProjection.get().items.length, 0);
  assert.ok(h.store.projection.get().documents.filter(row => row.projectId === worker.projectId).length >= 2);
  assert.equal(h.store.canvasPlanningDocumentId(), "", "no unique, selected or explicit planning document exists");
  assert.equal(h.store.routeDataReady(), true);
  const assistant = f.components().find(component => component.tag === "forma-creative-assistant");
  assert.ok(assistant?.isConnected);
  await f.act(f.find("button", node => classed(node, "forma-assistant-launcher")));
  await Promise.all([...pendingReads]); await f.settle();
  assert.ok(reads.some(read => read.path.startsWith("/api/assistant") && read.status === 200), "actual free Worker context read succeeds");
  await f.act(f.find("button", node => classed(node, "forma-assistant-mode") && node.text === f.i18n.t("assistant.mode.planBoard")));
  const panel = f.components().find(component => component.tag === "forma-assistant-panel");
  assert.ok(panel?.open && panel.modes.includes("plan-board")); assert.equal(panel.busyModes.includes("plan-board"), false);
  const native = installOutputNavigationFocusNative(t, f, ports); await f.settle();
  const field = f.find("textarea", node => classed(node, "forma-assistant-input"));
  assert.equal(Object.hasOwn(field.attributes, "disabled"), false);
  field.port.value = PROMPT; native.focus(field.port); await f.act(field, "input");
  const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope(), route = h.store.route.get();
  assert.ok(source && authorization && h.store.sourceOwnershipActive(source));
  const before = counts(worker), requestsBefore = h.requests.length;
  const frame = ports.windowPort.requestAnimationFrame, cancel = ports.windowPort.cancelAnimationFrame, held = new Map();
  ports.windowPort.requestAnimationFrame = callback => { const id = ++f.timerSequence; held.set(id, callback); return id; };
  ports.windowPort.cancelAnimationFrame = id => { if (!held.delete(id)) cancel(id); };
  t.after(() => { held.clear(); ports.windowPort.requestAnimationFrame = frame; ports.windowPort.cancelAnimationFrame = cancel; });
  const current = () => assistant.isConnected && panel.isConnected && panel.open && h.store.route.get() === route
    && h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization)
    && h.store.canvasPlanningDocumentId() === "";
  const release = async () => {
    const callbacks = [...held.values()]; held.clear(); for (const callback of callbacks) callback(0);
    // Let the actual async resolver continue before any unrelated redraw retires
    // the native focus records. This is the ordinary RAF->microtask ordering.
    await Promise.resolve(); await Promise.resolve();
  };
  return { f, h, worker, panel, native, held, release, current, before, requestsBefore, get external() { return external; } };
}

async function submitCurrentPlanBoard(x) {
  const { f, native } = x, submit = f.find("button", node => classed(node, "forma-assistant-send"));
  const form = f.find("form", node => classed(node, "forma-assistant-composer"));
  assert.ok(submit.port.isConnected && form.port.isConnected);
  assert.equal(Object.hasOwn(submit.attributes, "disabled"), false, "current native submit is genuinely enabled");
  const mode = f.find("button", node => classed(node, "forma-assistant-mode") && node.attributes["aria-pressed"] === "true");
  assert.equal(mode.text, f.i18n.t("assistant.mode.planBoard"));
  native.emit("pointerdown", submit.port); native.focus(submit.port);
  // Same synchronous current button/form native-default port as the established
  // full mounted workspace assistant handoff tests. No obsolete listener is used.
  let prevented = false;
  submit.handlers.click.call(submit.owner, { target: submit.port, currentTarget: submit.port,
    preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, false);
  form.handlers.submit.call(form.owner, { target: form.port, currentTarget: form.port, submitter: submit.port,
    preventDefault() {}, stopPropagation() {} });
  await f.settle();
  const resolverFrames = () => [...x.held.values()].filter(callback => /\bresolve\(\)/u.test(String(callback)));
  await untilScene(() => resolverFrames().length > 0, "actual immediate-false resolver reaches its native frame wait");
  assert.equal(resolverFrames().length, 1, "one actual promise-resolution RAF; incidental native layout frames remain separate and unmodified");
  assert.equal(x.h.store.ui.toast, f.i18n.t("next.exact.chooseDocument", "Choose a document"), "the actual caller reached its missing-document branch");
  assert.equal(x.h.store.planningConsent.get(), null); assert.ok(x.current());
  assert.equal(x.native.document.querySelector("dialog:modal"), null);
  const field = f.find("textarea", node => classed(node, "forma-assistant-input"));
  assert.equal(field.properties.value, PROMPT); assert.equal(Object.hasOwn(field.attributes, "disabled"), false);
}

for (const gesture of ["none", "pointer", "keyboard"]) test("B1 actual missing-document tool rejection respects newer " + gesture + " focus", { timeout: 30_000, concurrency: false }, async t => {
  const x = await currentBoard(t), { f, native } = x;
  await submitCurrentPlanBoard(x);
  let chosen = null;
  if (gesture !== "none") {
    const language = f.find("select", node => node.owner?.tag === "forma-ui-language-picker");
    assert.equal(Object.hasOwn(language.attributes, "disabled"), false); assert.ok(language.port.isConnected);
    native.emit(gesture === "pointer" ? "pointerdown" : "keydown", language.port); native.focus(language.port);
    chosen = language.port; assert.equal(native.document.activeElement, chosen);
  }
  assert.ok(x.current(), "the user did not change source, authority, route, panel, draft or planning target");
  const beforeFocus = native.nativeFocus.length;
  await x.release();
  const late = native.nativeFocus.slice(beforeFocus), composerFocus = late.filter(row => classed(row.node, "forma-assistant-input"));
  assert.ok(x.current()); assert.deepEqual(counts(x.worker), x.before, "no source, job, receipt or financial effect");
  assert.ok(x.h.requests.slice(x.requestsBefore).every(request => (request.init.method ?? "GET") === "GET"));
  assert.equal(x.external, 0); assert.equal(x.held.size, 0);
  console.log("B1_PANEL_DEFAULT_FOCUS " + JSON.stringify({ gesture, actualCaller: "missing-document", currentEnabledPlanBoard: true,
    sourceAndAuthorityCurrent: x.current(), planningDocument: x.h.store.canvasPlanningDocumentId(), modal: false,
    lateFocus: late.map(row => ({ tag: row.node.tag, class: row.node.attributes?.class ?? "" })),
    newerFocusPreserved: chosen ? native.document.activeElement === chosen : null, providerRequests: x.external }));
  if (gesture === "none") assert.equal(composerFocus.length, 1, "healthy rejected-tool continuation restores the current enabled composer");
  else {
    assert.equal(composerFocus.length, 0, "an immediate rejection cannot reclaim focus after a newer ordinary gesture");
    assert.equal(native.document.activeElement, chosen);
  }
});
