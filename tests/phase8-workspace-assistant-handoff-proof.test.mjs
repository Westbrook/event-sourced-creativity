// Permanent regressions for the mounted assistant quick-edit review handoff.
// Newer pane/focus choices win; uninterrupted requests retain the original review.
// All application classes, Store and Worker remain physical source. Only the
// existing finite native ports and delivery of a real free Response are controlled.
import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as deadline, clearTimeout as clearDeadline } from "node:timers";
import { createCalmFullPage, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { createSceneStoreHost, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { workspaceLocalProposalCopy } from "../src/components/design-system/localized-workspace-proposal.ts";
import { validWorkspaceQuickEditEvents } from "../src/model/workspace-local-proposal.ts";

const PREFIX = "full mounted assistant quick-edit handoff ";
const FAILURE = "newer_current_workspace_choice_must_own_the_handoff";
const PROMPT = "Add one decision: preserve the current harbor context.";
const classed = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, predicate) => {
  for (let current = node; current; current = current.parent) if (predicate(current)) return true;
  return false;
};
const inReview = node => inside(node, current => classed(current, "document-quick-edit-review"));
const focusIdentity = node => node ? {
  tag: node.tag, id: node.getAttribute?.("id") ?? null,
  owner: node.owner?.tag ?? null, class: node.getAttribute?.("class") ?? "",
  pane: node.getAttribute?.("data-workbench-pane") ?? null,
} : null;

async function join(promise, label, milliseconds = 10_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = deadline(() => reject(new Error("Prerequisite deadline: " + label)), milliseconds);
    })]);
  } finally { clearDeadline(timer); }
}

function sourceAndMoney(worker) {
  // Existing initialized fixture tables only. No production schema discovery.
  const tables = ["events", "event_private_payloads", "authoring_commits", "document_jobs",
    "budget_reservations", "budget_counters", "cost_budget_reservations", "cost_budget_counters",
    "output_provider_calls", "output_operation_slots", "consequential_executions", "consequential_execution_steps"];
  return Object.fromEntries(tables.map(table => [table, worker.sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all()]));
}

async function mountedWorkspace(t, locale) {
  const h = await createSceneStoreHost({ count: 1 });
  t.after(() => h.close());
  const worker = h.worker;
  // Isolated fixture configuration only: this free path needs no provider key.
  worker.env.OPENAI_API_KEY = "";
  const sessionResponse = await worker.request("/api/session");
  assert.equal(sessionResponse.status, 200);
  const actualSession = await sessionResponse.json();
  assert.ok(actualSession.assistant?.enabled, "actual session exposes this assistant entry");
  assert.ok(actualSession.capabilities.includes("project.author"));
  assert.equal(Boolean(actualSession.projectContext), false);
  assert.equal(actualSession.provider.configured, false);
  const original = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get() };
  const release = sceneDeferred(), entered = sceneDeferred(), resolved = sceneDeferred();
  const previews = [], reads = [], toolRequests = [], resolutions = [];
  let holding = false, delivered = 0, externalAttempts = 0;
  const pendingReads = new Set();
  h.transport = request => {
    const method = request.init.method ?? "GET";
    assert.ok(method === "GET" || request.url === "/api/workspace/quick-edit"
      && ["resume", "preview"].includes(request.body?.action), "no Apply, paid action, event append or job operation");
    const pending = (async () => {
      const response = await worker.request(request.url, request.init);
      if (request.url === "/api/workspace/quick-edit" && request.body?.action === "preview") {
        const body = await response.clone().json();
        previews.push({ request, response, status: response.status, body });
        assert.equal(response.status, 200, "real free Worker preview succeeds before handoff assertions");
        assert.equal(body.status, "not-applied");
        assert.ok(body.preview?.previewId);
        if (holding) { entered.resolve(previews.at(-1)); await release.promise; }
        delivered++;
      } else reads.push({ path: request.url, method, status: response.status });
      return response; // The same actual Response; no replacement body or quote.
    })();
    if (!(holding && request.url === "/api/workspace/quick-edit" && request.body?.action === "preview")) {
      pendingReads.add(pending);
      void pending.then(() => pendingReads.delete(pending), () => pendingReads.delete(pending));
    }
    return pending;
  };
  t.mock.method(globalThis, "fetch", (input, init = {}) => {
    const address = new URL(String(input), "http://localhost");
    if (!["http://localhost", "https://fixture.invalid"].includes(address.origin) || !address.pathname.startsWith("/api/")) {
      externalAttempts++; throw new Error("No external/provider request in mounted handoff proof");
    }
    return h.fetch(address.pathname + address.search, init);
  });

  const f = await createCalmFullPage(t, { locale, assistant: true, storeHost: h });
  // Initial setup only. The shared full-page helper emits synthetic14 layout
  // data; restore the exact existing Worker snapshot and real session before
  // any audited assistant gesture. No production method is replaced.
  h.store.events.set(original.events); h.store.head.set(original.head); h.store.content.set(original.content);
  h.store.session.set(actualSession);
  await f.settle();
  await join(Promise.all([...pendingReads]), "mounted initial exact reads");
  await f.settle();
  assert.deepEqual(h.store.events.get(), original.events);
  assert.equal(h.store.session.get(), actualSession);
  assert.ok(h.store.routeDataReady());
  const workspace = f.components().find(component => component.tag === "forma-workspace");
  const assistant = f.components().find(component => component.tag === "forma-creative-assistant");
  assert.ok(workspace?.isConnected && assistant?.isConnected, "actual full Shell descendants are mounted");

  // Complete only the native window dispatch port missing from this existing
  // renderer. The current production listener receives the real cancelable
  // CustomEvent, and its original resolve callback is observed then forwarded.
  const previousDispatch = Object.getOwnPropertyDescriptor(ports.windowPort, "dispatchEvent");
  Object.defineProperty(ports.windowPort, "dispatchEvent", { configurable: true, value(event) {
    if (event.type === "forma-assistant-tool-request") {
      assert.equal(event.detail.mode, "quick-edit");
      const detail = event.detail, originalResolve = detail.resolve;
      toolRequests.push(detail);
      detail.resolve = accepted => { resolutions.push(accepted); originalResolve(accepted); resolved.resolve(accepted); };
    }
    for (const listener of [...(f.listeners.get(event.type) ?? [])]) listener.call(ports.windowPort, event);
    return !event.defaultPrevented;
  } });
  t.after(() => { if (previousDispatch) Object.defineProperty(ports.windowPort, "dispatchEvent", previousDispatch); else delete ports.windowPort.dispatchEvent; });

  await f.act(f.find("button", node => classed(node, "forma-assistant-launcher")));
  await join(Promise.all([...pendingReads]), "actual assistant context GET");
  await f.settle();
  assert.ok(reads.some(read => read.path.startsWith("/api/assistant") && read.status === 200), "current assistant context comes from the real Worker");
  await f.act(f.find("button", node => classed(node, "forma-assistant-mode")
    && node.text === f.i18n.t("assistant.mode.quickEdit")));
  // Lazy conversation descendants are now actual registered classes before the
  // existing full-tree native selector/focus port is installed.
  const native = installOutputNavigationFocusNative(t, f, ports);
  await f.settle();
  const field = f.find("textarea", node => classed(node, "forma-assistant-input"));
  field.port.value = PROMPT;
  native.focus(field.port);
  await f.act(field, "input");
  const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
  assert.ok(source && authorization && h.store.sourceOwnershipActive(source));
  const route = h.store.route.get(), projectId = h.store.projection.get().projectId, documentId = h.store.projection.get().documentId;
  const before = sourceAndMoney(worker), storeEvents = structuredClone(h.store.events.get()), storeHead = h.store.head.get();
  const requestStart = h.requests.length;
  const current = () => workspace.isConnected && assistant.isConnected && h.store.route.get() === route
    && h.store.projection.get().projectId === projectId && h.store.projection.get().documentId === documentId
    && h.store.captureAuthorizationScope()?.key === authorization.key && h.store.sourceOwnershipActive(source);
  const pane = () => f.tree().nodes.find(node => node.owner === workspace && Object.hasOwn(node.attributes, "data-workbench-mode"))?.attributes["data-workbench-mode"];
  const button = value => f.find("button", node => node.owner === workspace && node.attributes["data-workbench-pane"] === value);
  assert.equal(pane(), "write", "normal current Write posture before the gesture");
  assert.equal(previews.length, 0);
  holding = true;
  t.after(() => release.resolve());
  return { h, f, worker, workspace, assistant, native, previews, reads, toolRequests, resolutions, entered, release, resolved,
    before, storeEvents, storeHead, requestStart, current, pane, button, get delivered() { return delivered; }, get externalAttempts() { return externalAttempts; } };
}

async function submitCurrentAssistant(x) {
  const { f, native } = x;
  const submit = f.find("button", node => classed(node, "forma-assistant-send"));
  assert.equal(Object.hasOwn(submit.attributes, "disabled"), false);
  const form = f.find("form", node => classed(node, "forma-assistant-composer"));
  assert.ok(inside(submit, node => node.tag === "form" && node.port === form.port), "current submitter belongs to this current form");
  assert.ok(submit.port.isConnected && form.port.isConnected);
  // Native default submit port: click and its form default run synchronously,
  // before any render can replace either listener. Both are current production
  // handlers from the mounted hierarchy, never a retained obsolete callback.
  native.emit("pointerdown", submit.port); native.focus(submit.port);
  let prevented = false;
  const event = { target: submit.port, currentTarget: submit.port,
    preventDefault() { prevented = true; }, stopPropagation() {} };
  assert.equal(typeof submit.handlers.click, "function");
  submit.handlers.click.call(submit.owner, event);
  assert.equal(prevented, false);
  assert.equal(typeof form.handlers.submit, "function");
  form.handlers.submit.call(form.owner, { target: form.port, currentTarget: form.port, submitter: submit.port,
    preventDefault() {}, stopPropagation() {} });
  await f.settle();
  const observed = await join(x.entered.promise, "real free preview response held at delivery");
  assert.equal(x.toolRequests.length, 1);
  assert.equal(x.toolRequests[0].message, PROMPT);
  assert.equal(x.toolRequests[0].mode, "quick-edit");
  assert.equal(x.resolutions.length, 0);
  assert.equal(x.delivered, 0);
  assert.equal(observed.request.body.prompt, PROMPT);
  assert.equal(observed.request.body.projectId, x.h.store.projection.get().projectId);
  assert.equal(observed.request.body.documentId, x.h.store.projection.get().documentId);
  assert.equal(observed.body.preview.localReview.operationId, observed.request.body.operationId);
  assert.equal(observed.body.preview.localReview.prompt, PROMPT);
  assert.equal(observed.body.preview.localReview.origin, "rule-based");
  assert.equal(observed.body.preview.localReview.providerCalls, 0);
  assert.equal(validWorkspaceQuickEditEvents(observed.body.preview.events), true);
  assert.ok(x.current());
}

for (const locale of ["en", "ja"]) for (const interruption of ["none", "result", "focus"]) {
  test(PREFIX + JSON.stringify({ locale, interruption }), { timeout: 30_000, concurrency: false }, async t => {
    const x = await mountedWorkspace(t, locale), { f, h, native } = x;
    try {
      await submitCurrentAssistant(x);
      if (interruption === "result") {
        const result = x.button("result");
        native.emit("pointerdown", result.port); native.focus(result.port);
        await f.act(result);
        assert.equal(x.pane(), "result", "ordinary current Result click changes the pane before reply delivery");
      } else if (interruption === "focus") {
        const language = f.find("select", node => node.owner?.tag === "forma-ui-language-picker");
        native.emit("keydown", language.port); native.focus(language.port);
        assert.equal(native.document.activeElement, language.port, "a current ordinary focus choice, without changing locale");
      }
      assert.ok(x.current(), "no source, route, actor or destination change is manufactured");
      const focusBefore = native.nativeFocus.length, beforeIdentity = focusIdentity(native.document.activeElement);
      x.release.resolve();
      const accepted = await join(x.resolved.promise, "the original assistant tool resolves after its real preview");
      await f.settle();
      assert.equal(x.resolutions.length, 1);
      assert.equal(x.delivered, 1);
      assert.ok(x.current());
      const afterPane = x.pane(), lateFocus = native.nativeFocus.slice(focusBefore).map(row => focusIdentity(row.node));
      const reviewFocus = lateFocus.filter(row => row.class.split(/\s+/u).includes("document-quick-edit-review"));
      const body = x.previews[0].body;
      const stored = x.worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=? AND kind='authoring-preview'").get(body.preview.previewId);
      assert.ok(stored, "the actual original free preview is retained on the server");
      const saved = JSON.parse(stored.content);
      assert.equal(saved.approvalHash, body.preview.approvalHash);
      assert.equal(saved.plan.localReview.operationId, x.previews[0].request.body.operationId);
      assert.equal(saved.state, "review");
      assert.deepEqual(sourceAndMoney(x.worker), x.before, "source events, receipts and financial rows remain exact");
      assert.deepEqual(h.store.events.get(), x.storeEvents); assert.equal(h.store.head.get(), x.storeHead);
      const posts = h.requests.slice(x.requestStart).filter(row => (row.init.method ?? "GET") !== "GET");
      assert.deepEqual(posts.map(row => [row.url, row.body?.action]), [["/api/workspace/quick-edit", "preview"]]);
      assert.equal(x.externalAttempts, 0);
      const desired = interruption === "none" ? accepted === true && afterPane === "write" && reviewFocus.length > 0
        : afterPane === (interruption === "result" ? "result" : "write") && lateFocus.length === 0;
      // Fresh deliberate re-entry remains useful without generating another
      // preview or accepting any change. It is not an automatic handoff license.
      if (afterPane !== "write") await f.act(x.button("write"));
      const draft = f.find("textarea", node => node.owner === x.workspace && inReview(node));
      assert.equal(draft.properties.value, PROMPT);
      const accept = f.find("button", node => inReview(node) && node.text === workspaceLocalProposalCopy(locale).accept);
      assert.equal(Object.hasOwn(accept.attributes, "disabled"), false, "separate explicit acceptance remains available, never invoked");
      assert.equal(x.previews.length, 1);
      console.log("WORKSPACE_HANDOFF_OBSERVATION " + JSON.stringify({ locale, interruption, actualFullMountedHierarchy: true,
        currentAssistantSubmit: true, actualWorkerStatus: x.previews[0].status, operationId: x.previews[0].request.body.operationId,
        previewId: body.preview.previewId, approvalHash: body.preview.approvalHash, exactOwnerSourceRoute: x.current(),
        deliveredResponses: x.delivered, toolResolutions: x.resolutions.length, accepted, paneBeforeReply: interruption === "result" ? "result" : "write",
        paneAfterReply: afterPane, focusBeforeReply: beforeIdentity, lateFocus, reviewFocusEffects: reviewFocus.length,
        desiredContinuation: desired, explicitReentryRetainsOriginal: true, separateApplyAvailable: true,
        previewRequests: 1, applyRequests: 0, eventReceiptFinancialRowsUnchanged: true, externalTransportAttempts: x.externalAttempts }));
      assert.equal(desired, true, interruption === "none" ? "healthy_original_workspace_handoff_must_show_and_focus_review" : FAILURE);
    } finally { x.release.resolve(); }
  });
}
