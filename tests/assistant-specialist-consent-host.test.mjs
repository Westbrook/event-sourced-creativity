import assert from "node:assert/strict";
import { installSourceOwnershipPort } from "./helpers/source-ownership-port.mjs";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes, createRequire } from "node:module";
import ts from "typescript";
import { pathToFileURL } from "node:url";
import { keyed } from "lit/directives/keyed.js";
import { assistantInteractionForSurface, assistantSurfaceForRoute } from "../src/model/assistant-route-policy.ts";
import { withDocumentInRoute } from "../src/model/routes.ts";
import { contextConsentAction } from "../src/model/context-consent-state.ts";
import { ensureNativeModalDialog } from "../src/components/design-system/native-dialog.ts";
import { ASSISTANT_CONTEXT_LIMITS } from "../src/model/conversation-context.ts";
import { ASSISTANT_MESSAGES } from "../src/components/design-system/locales/assistant-messages.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const syntax = (path) => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const hostSyntax = syntax("../src/components/forma-creative-assistant.ts");
const panelSyntax = syntax("../src/components/design-system/assistant-panel.ts");
const previewSyntax = syntax("../src/components/consequential-preview.ts");
const classText = (source, name, base, extra) => {
  const node = source.statements.find((item) => ts.isClassDeclaration(item) && item.name?.text === name);
  assert.ok(node, "actual production class " + name);
  const body = node.getText(source).replace(/^export /u, "").replace(/extends \w+/u, "extends " + base);
  return "(" + body.slice(0, -1) + extra + "})";
};
const cell = (initial) => { let value = initial; return { get: () => value, set: (next) => { value = next; } }; };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(setImmediate);
const sampleTurn = (id = "turn-a", text = "Help me clarify this idea", reply = "Free guidance") => ({
  id, user: text, reply: { text: reply }, proposal: null, proposals: [],
  originalRequest: { schema: 1, turnId: id, route: "/document/doc-a/alpha", projectId: "project-a", documentId: "doc-a", canvasId: null, selectedItemIds: [], locale: "en" },
});
const proposal = (turnId = "turn-a", id = "proposal-a") => ({ id, turnId, kind: "context.create", key: "assistant.action.createDecision", summary: "Review this exact suggestion" });
const savedTask = (overrides = {}) => ({
  id: "task-a", turnId: "turn-a", kind: "clarify", model: "gpt-5.6-luna", status: "running",
  estimatedMicrousd: 15000, executionId: "approval-a", bindingHash: "hash-a", submission: "submitting", ...overrides,
});

// Real host methods and real renderer, isolated from the DOM, network, providers,
// and persistent storage. These are not native-browser accessibility evidence.
function fixture(t, locale = "en") {
  const calls = [], queue = [], takers = [], events = [], trace = [], frames = [];
  let selected = [], modal = null, panel, recoveryControls = [];
  const context = {
    surface: assistantSurfaceForRoute("/document/doc-a/alpha"), documentTitle: "Alpha original",
    scope: { actorUserId: "actor-a", organizationId: null, projectAccessId: null, projectId: "project-a", documentId: "doc-a" },
    selectedItems: [], decisionAtoms: [], totals: { decisions: 0, outputs: 0, outputsByKind: {} },
  };
  const session = cell({
    user: { userId: "actor-a" }, impersonation: null, permissionEpoch: "epoch-a",
    policy: { version: "policy-a", accepted: true }, canvas: { access: true },
    capabilities: ["project.read", "project.author", "project.output.request", "project.canvas.use"],
    assistant: { enabled: true, phase: "actions", capabilities: ["project.assistant.read", "project.assistant.propose"],
      models: [
        { id: "gpt-5.6-luna", maximumMicrousd: 15000, premiumApprovalRequired: false },
        { id: "gpt-5.6-sol", maximumMicrousd: 45000, premiumApprovalRequired: true },
      ] },
    provider: { configured: true, plannerConfigured: true }, costBudgets: { period: "2026-08", user: { limit: 100000 } },
  });
  const fetch = (url, init = {}) => {
    const target = new URL(String(url));
    assert.equal(target.origin, "https://forma.invalid");
    assert.ok(target.pathname === "/api/assistant" || target.pathname === "/api/assistant/specialist"
      || /^\/api\/assistant\/tasks\/[A-Za-z0-9_-]+\/cancel$/u.test(target.pathname), "only exact mocked assistant endpoints");
    const gate = deferred(), call = { url: target, init, body: init.body ? JSON.parse(init.body) : null, gate };
    calls.push(call); if (takers.length) takers.shift()(call); else queue.push(call);
    return gate.promise;
  };
  const store = {
    session, projection: cell({ projectId: "project-a", documentId: "doc-a" }), route: cell("/document/doc-a/alpha"),
    planningConsent: cell(null), canvasPlanningDocumentId: () => "doc-a",
    captureAuthorizationScope: () => ({ key: JSON.stringify([session.get()?.user.userId, session.get()?.permissionEpoch, session.get()?.projectContext?.projectAccessId]), shared: Boolean(session.get()?.projectContext) }),
    guardedFetch: (url, init, action) => { trace.push(["guarded", action]); return fetch(url, init); },
    documentJobActive: () => false, adaptiveStructureFor: () => null, adaptiveSuggestionSetsFor: () => [],
    refreshEvents: async () => { throw new Error("Free Send/retrieval must not mutate or refresh creative output"); },
    refreshSession: async () => {}, toast: (message) => trace.push(["toast", message]), setRoute: (route) => store.route.set(route),
  };
  installSourceOwnershipPort(store);
  const document = {
    querySelectorAll: (selector) => selector.includes("canvas-item.selected") ? selected.map((id) => ({ dataset: { canvasItemId: id } }))
      : selector === "dialog:modal" ? (modal ? [modal] : []) : [],
    querySelector: (selector) => selector === "dialog:modal" ? modal : null,
    activeElement: null,
  };
  const location = { origin: "https://forma.invalid" };
  const window = Object.assign(new EventTarget(), { clearTimeout: () => {}, setTimeout: () => 1, confirm: () => { throw new Error("No legacy reconciliation"); } });
  const requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  const cancelAnimationFrame = () => {};
  const matchMedia = () => ({ matches: true });
  const icon = () => "";
  const handlers = [], nothing = Symbol("nothing");
  const value = (item) => item === nothing ? "" : item?._$litDirective$ === keyed("", null)._$litDirective$ ? value(item.values[1]) : Array.isArray(item) ? item.map(value).join("")
    : typeof item === "function" ? "__handler_" + (handlers.push(item) - 1) + "__" : String(item ?? "");
  const html = (parts, ...values) => parts.reduce((out, part, index) => out + part + (index < values.length ? value(values[index]) : ""), "");
  const i18n = {
    locale, number: (value) => new Intl.NumberFormat(locale).format(value),
    system: (value) => value,
    t: (key, fallback = "", values = {}) => (ASSISTANT_MESSAGES[locale][key] ?? fallback ?? key).replace(/\{(\w+)\}/gu, (_, id) => String(values[id] ?? "")) || key,
  };
  const previewNode = previewSyntax.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "consequentialPreview");
  const consequentialPreview = eval(stripTypeScriptTypes("(" + previewNode.getText(previewSyntax).replace(/^export /u, "") + ")"));
  const runNode = panelSyntax.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "assistantApprovedRequestCanRun");
  const assistantApprovedRequestCanRun = eval(stripTypeScriptTypes("(" + runNode.getText(panelSyntax).replace(/^export /u, "") + ")"));
  const stopNode = panelSyntax.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "assistantApprovedRequestCanStop");
  const assistantApprovedRequestCanStop = eval(stripTypeScriptTypes("(" + stopNode.getText(panelSyntax).replace(/^export /u, "") + ")"));
  const field = { value: "", focus: () => trace.push(["focus-input"]) };
  const transcript = { scrollTop: 0, scrollHeight: 1_200 };
  const heading = { focus: () => trace.push(["focus-heading"]) };
  const opener = { isConnected: true, dataset: { assistantTurnId: "turn-a" }, focus: () => trace.push(["focus-opener"]) };
  const dialog = {
    open: false, hasAttribute: () => true, matches: (selector) => selector === ":modal" && modal === dialog,
    showModal() { dialog.open = true; modal = dialog; trace.push(["native-modal"]); },
    close() { dialog.open = false; if (modal === dialog) modal = null; trace.push(["close-dialog"]); },
    removeAttribute() { dialog.open = false; }, setAttribute() { dialog.open = true; },
  };
  class Base extends EventTarget {
    store = store; i18n = i18n; isConnected = true; updateComplete = Promise.resolve();
    style = { removeProperty() {}, setProperty() {}, getPropertyValue() { return "0"; } }; dataset = {};
    requestUpdate() {} connectedCallback() {} disconnectedCallback() {} willUpdate() {} updated() {}
    querySelector(selector) {
      return selector === "forma-assistant-panel" ? panel : selector === ".forma-assistant-input" ? field
        : selector === ".forma-assistant-specialist" ? dialog
        : selector === ".forma-assistant-transcript" ? transcript
        : selector === ".forma-assistant-header [data-assistant-heading]" ? heading : null;
    }
    querySelectorAll(selector) { return selector === "[data-assistant-recovery]" ? recoveryControls : []; }
    dispatchEvent(event) { events.push([event.type, event.detail]); return super.dispatchEvent(event); }
  }
  const Host = eval(stripTypeScriptTypes(classText(hostSyntax, "FormaCreativeAssistant", "Base", `
    async openForTest() { this.#open = true; return this.#load(); }
    closeForTest() { this.#open = false; this.#specialist = null; this.#reviewRevision += 1; }
    sendForTest(message) { return this.#send({ message }); }
    loadForTest() { return this.#load(); }
    retryForTest() { return this.#deliverGuidance(); }
    reviewForTest(detail) { return this.#reviewSpecialist(detail); }
    requestForTest(action, model) { return this.#requestSpecialist(action, model); }
    proposalForTest(detail) { return this.#proposal(detail); }
    actionForTest(control) { return this.#specialistAction(control); }
    taskForTest(detail) { return this.#task(detail); }
    closeReviewForTest(reviewId) { return this.#closeSpecialist(reviewId); }
    eligibleForTest(turnId = "turn-a") { return this.#canSpecialist(turnId); }
    canRequestForTest() { return this.#canSpecialist(); }
    runApprovedForTest() { if (assistantApprovedRequestCanRun(this.#specialist, this.#canSpecialist())) return this.#requestSpecialist("execute"); }
    retentionForTest(turnId, executionId) { return this.#retentionVersion(turnId, executionId); }
    scopeForTest() { return this.#scope(); }
    snapshotForTest() { return { messages: this.#messages, turns: this.#turns, proposals: this.#proposals, tasks: this.#tasks, guidance: this.#guidance, specialist: this.#specialist, context: this.#context }; }
  `)));
  const Panel = eval(stripTypeScriptTypes(classText(panelSyntax, "FormaAssistantPanel", "Base", `
    specialistTemplateForTest() { return this.#specialistView(); }
    set draftForTest(value) { this.#draft = value; }
    get draftForTest() { return this.#draft; }
    submitForTest() { this.#submit({ preventDefault() {} }); }
    updateForTest(changed = new Map()) { this.willUpdate(changed); this.updated(changed); }
    modeForTest(mode) { this.#drafts.set(this.#activeMode, this.#draft); this.#activeMode = mode; this.#draft = this.#drafts.get(mode) ?? ""; }
  `)));
  const host = new Host(); panel = new Panel(); panel.open = true; panel.retainGuidanceDraft = true;
  panel.addEventListener("forma-assistant-message", (event) => { if (!event.detail.mode) void host.sendForTest(event.detail.message); });
  panel.addEventListener("forma-assistant-specialist-review", (event) => void host.reviewForTest(event.detail));
  panel.addEventListener("forma-assistant-specialist-close", (event) => host.closeReviewForTest(event.detail.reviewId));
  const deliverHostEvent = (name, event) => {
    const offset = handlers.length, markup = host.render();
    const index = markup.match(new RegExp("@" + name + "=__handler_(\\d+)__", "u"))?.[1];
    const handler = handlers[Number(index)]; handlers.length = offset;
    assert.equal(typeof handler, "function", "actual host template owns " + name);
    return handler(event);
  };
  panel.addEventListener("forma-assistant-specialist-action", (event) => deliverHostEvent("forma-assistant-specialist-action", event));
  panel.addEventListener("forma-assistant-task", (event) => void host.taskForTest(event.detail));
  panel.addEventListener("forma-assistant-specialist-model", (event) => deliverHostEvent("forma-assistant-specialist-model", event));
  panel.addEventListener("forma-assistant-guidance-recovery", (event) => event.detail.action === "check" ? void host.loadForTest() : void host.retryForTest());
  t.after(() => host.disconnectedCallback());
  const f = {
    host, panel, store, session, calls, trace, events, context, dialog, opener, field, transcript, frames, window,
    select(ids) { selected = ids; }, topModal(value) { modal = value; },
    hideRecoveryControls() { recoveryControls = []; },
    flushFrames() { for (const frame of frames.splice(0)) frame(); },
    take: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => takers.push(resolve)),
    async reply(call, payload, status = 200, beforeJson = () => {}) {
      call.gate.resolve({ ok: status >= 200 && status < 300, status, json: async () => { await beforeJson(); return payload; } }); await tick();
    },
    async reject(call) { call.gate.reject(new Error("Lost response")); await tick(); },
    async open(turns = [sampleTurn()], tasks = []) {
      const loading = host.openForTest(), call = await f.take(); assert.equal(call.body, null);
      await f.reply(call, { context, turns, tasks }); await loading; return call;
    },
    render({ deferLifecycle = false } = {}) {
      const state = host.snapshotForTest(), previousScope = panel.conversationScope, previousMessages = panel.messages;
      // Obtain the real host's scoped props without creating an alternate controller.
      host.render();
      const fresh = host.snapshotForTest();
      Object.assign(panel, { context: fresh.context, messages: fresh.messages, proposals: fresh.proposals, tasks: fresh.tasks,
        specialist: fresh.specialist, canSpecialist: host.canRequestForTest(), models: session.get()?.assistant?.models ?? [],
        guidanceDelivery: fresh.guidance?.status ?? "", conversationScope: host.scopeForTest(),
        readOnly: !(session.get()?.projectContext?.permissions ?? session.get()?.capabilities ?? []).includes("project.author") });
      const update = () => panel.updateForTest(new Map([["specialist", state.specialist], ["guidanceDelivery", ""], ...(previousMessages !== panel.messages ? [["messages", previousMessages]] : []), ...(previousScope !== panel.conversationScope ? [["conversationScope", previousScope || undefined]] : [])]));
      if (!deferLifecycle) update();
      handlers.length = 0;
      const markup = panel.render();
      const buttons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)].map(([, attrs, label]) => ({
        label: label.replace(/<[^>]+>/gu, "").trim(), attrs, disabled: /\?disabled=true\b/u.test(attrs),
        click: handlers[Number(attrs.match(/@click=__handler_(\d+)__/u)?.[1])],
      }));
      for (const node of recoveryControls) node.isConnected = false;
      recoveryControls = [];
      for (const button of buttons) if (button.attrs.includes("data-assistant-recovery")) {
        const id = (name) => button.attrs.match(new RegExp(name + "=([^\\s>]+)", "u"))?.[1] ?? "";
        const node = { isConnected: true, disabled: button.disabled,
          dataset: { assistantTurnId: id("data-assistant-turn-id"), assistantExecutionId: id("data-assistant-execution-id") },
          focus: () => trace.push(["focus-recovery", node.dataset.assistantTurnId, node.dataset.assistantExecutionId]) };
        button.node = node; recoveryControls.push(node);
      }
      return { markup, buttons, update,
        mainKeydown: handlers[Number(markup.match(/<section class="forma-assistant-panel"[^>]*@keydown=__handler_(\d+)__/u)?.[1])],
        cancel: handlers[Number(markup.match(/<dialog[^>]*@cancel=__handler_(\d+)__/u)?.[1])],
        nativeClose: handlers[Number(markup.match(/<dialog[^>]*@close=__handler_(\d+)__/u)?.[1])],
        dialogKeydown: handlers[Number(markup.match(/<dialog[^>]*@keydown=__handler_(\d+)__/u)?.[1])],
        selects: [...markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gu)].map(([, attrs, options]) => ({
          attrs, options, disabled: /\?disabled=true\b/u.test(attrs), value: attrs.match(/\.value=([^\s>]+)/u)?.[1],
          change: handlers[Number(attrs.match(/@change=__handler_(\d+)__/u)?.[1])],
        })),
      };
    },
  };
  return f;
}
function preview(overrides = {}) {
  return {
    executionId: "approval-a", bindingHash: "hash-a", operation: "assistant-specialist", status: "quoted",
    actorLabel: "Actor A", workspaceId: null, period: "2026-08", projectId: "project-a", documentId: "doc-a",
    canvasId: null, blockId: "", sourceHash: "original-source", provider: "openai", models: ["gpt-5.6-luna"],
    maximumMicrousd: 15000, maximumTokens: 1600, providerCalls: 1, searchCalls: 0, publicQuery: "",
    privateInput: { original: "Complete original source", protected: "Keep exactly this sentence." },
    expiresAt: new Date(Date.now() + 600000).toISOString(), providerAvailable: true, budgetAvailable: true,
    availableMicrousd: 100000, canExecute: true, unavailableReasons: [], ...overrides,
  };
}
function specialistResponse(quote = preview(), overrides = {}) {
  return {
    turnId: "turn-a", executionId: quote.executionId, quote, noAutomaticRetry: true,
    originalRequest: {
      turnId: "turn-a", route: "/document/doc-a/alpha", projectId: quote.projectId, documentId: quote.documentId,
      canvasId: quote.canvasId, selectedItemIds: [], locale: "en", model: quote.models[0], taskKind: "clarify",
      sourceHash: quote.sourceHash, conversationTurnIds: ["turn-a"],
    }, ...overrides,
  };
}
function certifiedCompletedTask(reply = "Currently retained original paid result") {
  const response = specialistResponse(preview({ status: "completed", canExecute: false }));
  return savedTask({ status: "completed", submission: "settled", canExecute: false, certifiedCompleted: true,
    completedReview: { turnId: response.turnId, executionId: response.executionId, quote: response.quote,
      originalRequest: response.originalRequest, result: { reply: { text: reply }, sourceStatus: "original-approved-source" } },
  });
}

async function review(f, overrides = {}) {
  const opening = f.host.reviewForTest({ turnId: "turn-a" }), call = await f.take();
  assert.equal(call.url.pathname, "/api/assistant/specialist");
  assert.deepEqual(call.body, { action: "quote", turnId: "turn-a" });
  await f.reply(call, specialistResponse(preview(overrides))); await opening;
  return call;
}

test("actual free Send retains its draft and ID through lost delivery; retries and GET do not duplicate turns or proposals", async (t) => {
  const f = fixture(t); await f.open([]);
  f.panel.draftForTest = "  My original free question  "; f.panel.submitForTest();
  const first = await f.take();
  assert.deepEqual(Object.keys(first.body).sort(), ["locale", "message", "turnId"]);
  assert.equal(first.body.message, "My original free question");
  assert.equal(f.panel.draftForTest, "  My original free question  ");
  await f.reject(first);
  assert.equal(f.host.snapshotForTest().guidance.status, "uncertain");
  f.panel.draftForTest = "A different unfinished draft";
  const retrying = f.host.retryForTest(), retry = await f.take();
  assert.deepEqual(retry.body, first.body);
  assert.equal(f.host.snapshotForTest().messages.filter((message) => message.role === "user").length, 1);
  const turn = { ...sampleTurn(first.body.turnId, first.body.message), proposals: [proposal(first.body.turnId)] };
  await f.reply(retry, { context: f.context, turn }); await retrying;
  assert.equal(f.panel.draftForTest, "A different unfinished draft");
  assert.equal(f.host.snapshotForTest().guidance, null);
  const loading = f.host.loadForTest(), get = await f.take(); await f.reply(get, { context: f.context, turns: [turn], tasks: [] }); await loading;
  assert.equal(f.host.snapshotForTest().messages.length, 2);
  assert.equal(f.host.snapshotForTest().proposals.length, 1);
  assert.equal(f.calls.filter((call) => call.url.pathname.endsWith("/specialist")).length, 0);
});

test("actual free Send GET reconciliation clears only the acknowledged draft and never starts a fresh turn", async (t) => {
  const f = fixture(t); await f.open([]);
  f.panel.draftForTest = "Keep this free question"; f.panel.submitForTest();
  const first = await f.take(); await f.reject(first);
  const checking = f.host.loadForTest(), get = await f.take();
  await f.reply(get, { context: f.context, turns: [sampleTurn(first.body.turnId, first.body.message)], tasks: [] }); await checking;
  assert.equal(f.panel.draftForTest, ""); assert.equal(f.host.snapshotForTest().guidance, null);
  assert.equal(f.calls.filter((call) => call.init.method === "POST").length, 1);
});

test("actual free Send refuses a mismatched turn identity and an older POST cannot overwrite a newer GET", async (t) => {
  const f = fixture(t); await f.open([]);
  const sending = f.host.sendForTest("Original"), post = await f.take();
  await f.reply(post, { context: f.context, turn: sampleTurn("someone-else", "Original") }); await sending;
  assert.equal(f.host.snapshotForTest().guidance.status, "uncertain");
  assert.equal(f.host.snapshotForTest().turns.length, 0);
  const retrying = f.host.retryForTest(), retry = await f.take();
  const checking = f.host.loadForTest(), newerGet = await f.take();
  await f.reply(newerGet, { context: f.context, turns: [], tasks: [] }); await checking;
  await f.reply(retry, { context: f.context, turn: sampleTurn(retry.body.turnId, retry.body.message, "Potentially stale private response") }); await retrying;
  assert.equal(f.host.snapshotForTest().turns.length, 0);
  const reconcile = await f.take(); assert.equal(reconcile.body, null);
  await f.reply(reconcile, { context: f.context, turns: [sampleTurn(retry.body.turnId, retry.body.message, "Currently certified response")], tasks: [] });
  assert.equal(f.host.snapshotForTest().turns[0].reply.text, "Currently certified response");
  assert.equal(f.calls.filter((call) => call.init.method === "POST").length, 2);
});

test("actual host clears private state on principal, capability, custody, route and selection changes even when closed", async (t) => {
  for (const change of [
    (f) => f.session.set({ ...f.session.get(), user: { userId: "actor-b" } }),
    (f) => f.session.set({ ...f.session.get(), impersonation: { impersonationId: "different-principal" } }),
    (f) => f.session.set({ ...f.session.get(), capabilities: ["project.read"] }),
    (f) => f.session.set({ ...f.session.get(), projectContext: { organizationId: "org-b", projectAccessId: "access-b", projectId: "project-a", permissions: ["project.read"] } }),
    (f) => f.store.route.set("/document/doc-b/beta"),
  ]) {
    const f = fixture(t); await f.open(); await review(f); f.host.closeForTest();
    change(f); f.host.render();
    const state = f.host.snapshotForTest();
    assert.deepEqual(state.messages, []); assert.deepEqual(state.tasks, []); assert.equal(state.specialist, null); assert.equal(state.context, null);
  }
  const f = fixture(t); f.store.route.set("/canvas/board-a/alpha"); f.select(["item-a"]); await f.open();
  f.host.closeForTest(); f.select(["item-b"]); f.host.render(); assert.deepEqual(f.host.snapshotForTest().messages, []);
});

test("personal readers and global pages never infer purchase authority or select a first document", async (t) => {
  for (const setup of [
    (f) => f.session.set({ ...f.session.get(), capabilities: ["project.read"] }),
    (f) => f.store.route.set("/projects"),
    (f) => f.store.route.set("/canvas/board-a/alpha"),
  ]) {
    const f = fixture(t); setup(f); await f.open(); const before = f.calls.length;
    assert.equal(f.host.eligibleForTest(), false);
    await f.host.reviewForTest({ turnId: "turn-a" });
    assert.equal(f.calls.length, before);
    assert.equal(f.render().buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.review"]), false);
  }
});

test("free specialist preview discloses unavailable budget/provider and keeps all model controls outside Send", async (t) => {
  const f = fixture(t); await f.open(); await review(f, { providerAvailable: false, budgetAvailable: false, availableMicrousd: 0, canExecute: false, unavailableReasons: ["pilot-unavailable"] });
  const rendered = f.render();
  assert.match(rendered.markup, /Complete original source/u);
  assert.match(rendered.markup, /Keep exactly this sentence/u);
  assert.match(rendered.markup, /original-source/u);
  assert.equal(rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.approve"]).disabled, true);
  const composer = rendered.markup.match(/<form class="forma-assistant-composer"[\s\S]*?<\/form>/u)?.[0] ?? "";
  assert.doesNotMatch(composer, /<select|premiumApproval|checkbox/u);
  assert.match(composer, /Send provides free guidance/u);
  const before = f.calls.length; f.host.actionForTest(recoveryR2Control(f)); await tick(); assert.equal(f.calls.length, before);
});

test("one exact approval creates no duplicate execute; completion replaces the original reply and proposals", async (t) => {
  const f = fixture(t); await f.open([{ ...sampleTurn(), proposals: [proposal()] }]); await review(f);
  f.host.actionForTest(recoveryR2Control(f)); const execute = await f.take(); f.host.actionForTest(recoveryR2Control(f));
  assert.deepEqual(execute.body, { action: "execute", turnId: "turn-a", executionId: "approval-a", approvedBindingHash: "hash-a" });
  const running = savedTask();
  await f.reply(execute, specialistResponse(preview({ status: "reserved" }), { task: running }), 202);
  f.host.actionForTest(recoveryR2Control(f)); const retrieve = await f.take();
  assert.deepEqual(retrieve.body, { ...execute.body, action: "retrieve" });
  const completedTurn = { ...sampleTurn("turn-a", sampleTurn().user, "Original paid specialist reply"), proposals: [proposal("turn-a", "specialist-proposal")] };
  await f.reply(retrieve, specialistResponse(preview({ status: "completed" }), { task: savedTask({ status: "completed", submission: "settled" }), turn: completedTurn }));
  const state = f.host.snapshotForTest();
  assert.equal(state.turns.length, 1); assert.equal(state.messages.length, 2); assert.equal(state.turns[0].reply.text, completedTurn.reply.text);
  assert.deepEqual(state.proposals.map((item) => item.id), ["specialist-proposal"]);
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1);
  assert.equal(state.specialist.retrievalOnly, true);
});

test("lost specialist execution is retrieval-only and cannot be silently replaced or escalated", async (t) => {
  const f = fixture(t); await f.open(); await review(f);
  f.host.actionForTest(recoveryR2Control(f)); const execute = await f.take(); await f.reject(execute);
  const state = f.host.snapshotForTest().specialist;
  assert.equal(state.executionId, "approval-a"); assert.equal(state.quote.status, "uncertain"); assert.equal(state.retrievalOnly, true);
  const before = f.calls.length; await f.host.requestForTest("quote", "gpt-5.6-sol"); assert.equal(f.calls.length, before);
  const rendered = f.render();
  assert.equal(rendered.buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.approve"]), false);
  assert.doesNotMatch(rendered.markup.match(/<dialog[\s\S]*?<\/dialog>/u)?.[0] ?? "", /<select/u);
  f.host.actionForTest(recoveryR2Control(f)); const retrieve = await f.take(); assert.equal(retrieve.body.action, "retrieve"); assert.equal(retrieve.body.executionId, "approval-a");
  await f.reply(retrieve, specialistResponse(preview({ status: "uncertain" }), { task: savedTask({ status: "needs-review", submission: "uncertain" }) }));
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1);
});

test("closing during execution never cancels; late response leads only to durable GET recovery", async (t) => {
  const f = fixture(t); await f.open(); await review(f);
  f.host.actionForTest(recoveryR2Control(f)); const execute = await f.take();
  f.host.closeReviewForTest(); const earlyGet = await f.take();
  assert.equal(earlyGet.body, null); await f.reply(earlyGet, { context: f.context, turns: [sampleTurn()], tasks: [] });
  await f.reply(execute, specialistResponse(preview({ status: "reserved" }), { task: savedTask() }), 202);
  const recoveryGet = await f.take(); assert.equal(recoveryGet.body, null);
  await f.reply(recoveryGet, { context: f.context, turns: [sampleTurn()], tasks: [savedTask()] });
  assert.equal(f.host.snapshotForTest().specialist, null);
  assert.equal(f.host.snapshotForTest().tasks[0].executionId, "approval-a");
  assert.equal(f.calls.some((call) => /cancel|reconcile/u.test(call.url.pathname)), false);
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1);
});

test("reader re-entry retrieves the original paid source without current key, model, budget, month or authoring access", async (t) => {
  const f = fixture(t);
  f.session.set({ ...f.session.get(), capabilities: ["project.read"], provider: { configured: false, plannerConfigured: false },
    assistant: { ...f.session.get().assistant, models: [] }, costBudgets: { period: "2026-09", user: { limit: 0 } } });
  f.context.documentTitle = "Current title after source changed";
  await f.open([sampleTurn()], [savedTask({ status: "needs-review", submission: "uncertain" })]);
  const opening = f.host.reviewForTest({ turnId: "turn-a", task: f.host.snapshotForTest().tasks[0] }), resume = await f.take();
  assert.deepEqual(resume.body, { action: "resume", turnId: "turn-a", executionId: "approval-a" });
  const original = preview({ status: "completed", period: "2026-08", models: ["retired-original-model"], providerAvailable: false, budgetAvailable: false, canExecute: false, expiresAt: "2020-01-01T00:00:00Z" });
  await f.reply(resume, specialistResponse(original, { task: savedTask({ model: "retired-original-model", status: "completed", submission: "settled" }),
    turn: { ...sampleTurn("turn-a", sampleTurn().user, "Retained original answer"), proposals: [proposal()] } })); await opening;
  const rendered = f.render();
  assert.match(rendered.markup, /Retained original answer/u); assert.match(rendered.markup, /retired-original-model/u);
  assert.match(rendered.markup, /2026-08/u); assert.match(rendered.markup, /Complete original source/u);
  const retrieve = rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.retrieve"]);
  assert.ok(retrieve); assert.equal(retrieve.disabled, false);
  assert.equal(rendered.buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.approve"]), false);
  assert.equal(rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.action.createDecision"]).disabled, true);
  assert.equal(f.calls.some((call) => call.body?.action === "execute" || call.body?.action === "quote"), false);
});

test("cross-session winner replaces the whole preview and exact recovery handle without autoapproval", async (t) => {
  const f = fixture(t); await f.open(); await review(f);
  f.host.actionForTest(recoveryR2Control(f)); const execute = await f.take();
  const winner = preview({ executionId: "approval-winner", bindingHash: "hash-winner", status: "reserved", privateInput: { original: "Winner original source" } });
  await f.reply(execute, specialistResponse(winner, { requestedExecutionId: "approval-a", reusedExecutionId: "approval-winner", winnerExecutionId: "approval-winner",
    task: savedTask({ executionId: "approval-winner", bindingHash: "hash-winner", id: "winner-task" }) }));
  assert.equal(f.host.snapshotForTest().specialist.notice, "redirected");
  assert.equal(f.host.snapshotForTest().specialist.quote.privateInput.original, "Winner original source");
  f.host.actionForTest(recoveryR2Control(f)); const retrieve = await f.take();
  assert.deepEqual(retrieve.body, { action: "retrieve", turnId: "turn-a", executionId: "approval-winner", approvedBindingHash: "hash-winner" });
  await f.reply(retrieve, specialistResponse(winner, { task: savedTask({ executionId: "approval-winner", bindingHash: "hash-winner", id: "winner-task" }) }));
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1);
});

test("wrong-turn, wrong-scope, unexpected-model and unproved-winner responses never expose private result bytes", async (t) => {
  for (const mismatch of [
    (payload) => ({ ...payload, turnId: "different-turn" }),
    (payload) => ({ ...payload, quote: { ...payload.quote, projectId: "different-project" } }),
    (payload) => ({ ...payload, requestedExecutionId: "different-request", executionId: "winner", quote: { ...payload.quote, executionId: "winner", privateInput: { secret: "UNAUTHORIZED-BYTES" } } }),
  ]) {
    const f = fixture(t); await f.open(); await review(f);
    f.host.actionForTest(recoveryR2Control(f)); const execute = await f.take();
    await f.reply(execute, mismatch(specialistResponse(preview({ status: "completed" }), { result: { reply: "UNAUTHORIZED-BYTES", sourceStatus: "original-approved-source" } })));
    assert.equal(f.host.snapshotForTest().specialist.notice, "uncertain");
    assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /UNAUTHORIZED-BYTES/u);
  }
  const f = fixture(t); await f.open(); await review(f);
  const changing = f.host.requestForTest("quote", "gpt-5.6-sol"), quoteCall = await f.take();
  await f.reply(quoteCall, specialistResponse(preview({ models: ["gpt-5.6-luna"] }))); await changing;
  assert.equal(f.host.snapshotForTest().specialist.quote, null);
  assert.equal(f.host.snapshotForTest().specialist.notice, "failed");
});

test("authority changes during JSON decode and late GETs after private-result denial cannot resurrect cached evidence", async (t) => {
  const f = fixture(t); await f.open();
  const opening = f.host.reviewForTest({ turnId: "turn-a" }), quoting = await f.take();
  await f.reply(quoting, specialistResponse(), 200, () => { f.session.set({ ...f.session.get(), permissionEpoch: "revoked" }); }); await opening;
  f.host.render(); assert.equal(f.host.snapshotForTest().specialist, null);
  assert.deepEqual(f.host.snapshotForTest().messages, []);
  const currentGet = await f.take();
  await f.reply(currentGet, { context: f.context, turns: [sampleTurn()], tasks: [savedTask()] });
  const reviewing = f.host.reviewForTest({ turnId: "turn-a", task: f.host.snapshotForTest().tasks[0] }), resume = await f.take();
  await f.reply(resume, specialistResponse(preview({ status: "completed" }), { task: savedTask({ status: "completed", submission: "settled" }) })); await reviewing;
  const loading = f.host.loadForTest(), oldGet = await f.take();
  f.host.actionForTest(recoveryR2Control(f)); const retrieval = await f.take(); await f.reply(retrieval, { error: "assistant_execution_unavailable", retentionUnavailable: true }, 404);
  await f.reply(oldGet, { context: f.context, turns: [sampleTurn("turn-a", "private user", "STALE-CACHED-BYTES")], tasks: [savedTask()] }); await loading;
  assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /STALE-CACHED-BYTES|Complete original source/u);
  assert.equal(f.host.snapshotForTest().specialist.notice, "unavailable");
});

test("actual nested native review preserves the authored draft, topmost Escape and opener focus", async (t) => {
  const f = fixture(t); await f.open(); f.panel.draftForTest = "Keep my unfinished question";
  let rendered = f.render();
  rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.review"]).click({ currentTarget: f.opener });
  const quoting = await f.take(); await f.reply(quoting, specialistResponse());
  rendered = f.render();
  assert.equal(f.dialog.matches(":modal"), true);
  assert.match(rendered.markup, /<dialog[^>]*aria-labelledby=[^ ]+[^>]*aria-describedby=/u);
  const before = f.events.length;
  rendered.mainKeydown({ key: "Escape", isComposing: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(f.events.length, before);
  rendered.dialogKeydown({ key: "Escape", isComposing: true, stopPropagation() { throw new Error("IME is not dismissal"); } });
  rendered.cancel({ preventDefault() {}, stopPropagation() {} });
  const reload = await f.take(); await f.reply(reload, { context: f.context, turns: [sampleTurn()], tasks: [] });
  f.render(); await tick(); for (const frame of f.frames.splice(0)) frame();
  assert.equal(f.host.snapshotForTest().specialist, null);
  assert.equal(f.panel.draftForTest, "Keep my unfinished question");
  assert.ok(f.trace.some(([kind]) => kind === "focus-opener"));
  assert.equal(f.calls.some((call) => call.body?.action === "execute"), false);
});

test("actual specialist keydown Escape closes the topmost review without relying on a native cancel event", async (t) => {
  const f = fixture(t); await f.open(); f.panel.draftForTest = "Keep this unfinished question";
  let rendered = f.render();
  rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.review"]).click({ currentTarget: f.opener });
  const quoting = await f.take(); await f.reply(quoting, specialistResponse());
  rendered = f.render();
  let prevented = 0, stopped = 0;
  rendered.dialogKeydown({ key: "Escape", isComposing: false, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  assert.equal(f.host.snapshotForTest().specialist, null, "Escape itself closes the review; no synthetic cancel is supplied");
  assert.equal(prevented, 1); assert.equal(stopped, 1);
  const reload = await f.take(); await f.reply(reload, { context: f.context, turns: [sampleTurn()], tasks: [] });
  f.render(); await tick(); for (const frame of f.frames.splice(0)) frame();
  assert.equal(f.panel.draftForTest, "Keep this unfinished question");
  assert.ok(f.trace.some(([kind]) => kind === "focus-opener"));
  assert.equal(f.calls.some((call) => call.body?.action === "execute"), false);
});

test("model choice only regenerates a free exact preview and deep-reasoning approval is the sole paid action", async (t) => {
  const f = fixture(t); await f.open(); await review(f);
  const changing = f.host.requestForTest("quote", "gpt-5.6-sol"), quoteCall = await f.take();
  assert.deepEqual(quoteCall.body, { action: "quote", turnId: "turn-a", model: "gpt-5.6-sol" });
  assert.equal(f.host.snapshotForTest().specialist.quote, null);
  const waiting = f.render(); assert.match(waiting.markup, /<select[^>]*value=gpt-5.6-sol[^>]*disabled=true/u);
  assert.doesNotMatch(waiting.markup, /Complete original source/u);
  await f.reply(quoteCall, specialistResponse(preview({ models: ["gpt-5.6-sol"], maximumMicrousd: 45000 }))); await changing;
  const rendered = f.render();
  assert.match(rendered.markup, /deep-reasoning model requires your explicit approval/u);
  assert.match(rendered.markup, /USD 0\.045/u);
  assert.doesNotMatch(rendered.markup, /type="checkbox"/u);
  assert.equal(f.calls.some((call) => call.body?.action === "execute"), false);
});

for (const locale of ["fr", "ar", "ja"]) test("actual " + locale + " review/task rendering keeps truthful retained-hold warnings and distinct recovery names", async (t) => {
  const f = fixture(t, locale), first = savedTask({ id: "task-a", status: "canceled", submission: "uncertain" });
  await f.open([sampleTurn(), sampleTurn("turn-b", "Other question")], [first, savedTask({ id: "task-b", turnId: "turn-b", executionId: "approval-b", status: "completed", submission: "settled" })]);
  const opening = f.host.reviewForTest({ turnId: first.turnId, task: first }), resume = await f.take();
  await f.reply(resume, specialistResponse(preview({ status: "uncertain" }), { task: first })); await opening;
  const rendered = f.render(), catalog = ASSISTANT_MESSAGES[locale];
  assert.ok(rendered.markup.includes(catalog["assistant.specialist.billingUnknown"]));
  assert.ok(rendered.markup.includes(catalog["assistant.specialist.canceled"]));
  assert.ok(rendered.markup.includes(catalog["assistant.specialist.settled"]));
  assert.doesNotMatch(rendered.markup, /Billing is not yet confirmed|Request canceled before|No provider submission/u);
  const recovery = rendered.buttons.filter((button) => button.label === catalog["assistant.specialist.retrieve"]);
  assert.equal(recovery.length, 3);
  assert.ok(recovery.some((button) => button.attrs.includes("task-a")));
  assert.ok(recovery.some((button) => button.attrs.includes("task-b")));
  assert.ok(recovery.some((button) => button.attrs.includes("approval-a")));
  assert.equal(new Set(recovery.map((button) => button.attrs.match(/aria-label=([\s\S]*?) @click=/u)?.[1])).size, 3);
  assert.equal(rendered.buttons.some((button) => button.label === catalog["assistant.task.cancel"] || button.label === catalog["assistant.task.reconcile"]), false);
});

test("native-modal failure disables paid approval and expired previews cannot be approved", async (t) => {
  const f = fixture(t); await f.open(); await review(f);
  f.dialog.showModal = () => { throw new Error("No top layer"); };
  let rendered = f.render();
  assert.equal(rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.approve"]).disabled, true);
  const before = f.calls.length;
  rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.approve"]).click();
  assert.equal(f.calls.length, before);
  f.host.snapshotForTest().specialist.quote.expiresAt = "2020-01-01T00:00:00Z";
  f.dialog.showModal = () => f.topModal(f.dialog);
  rendered = f.render();
  assert.equal(rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.approve"]).disabled, true);
});

test("new review surfaces preserve 44px controls, bounded overflow and all locale placeholder contracts", () => {
  const styles = read("../src/components/design-system/assistant-panel.css");
  assert.match(styles, /\.forma-assistant-specialist summary\s*\{\s*min-block-size:\s*2\.75rem/u);
  assert.match(styles, /\.forma-assistant-specialist\s*\{[\s\S]*?--forma-keyboard-offset[\s\S]*?overflow: auto/u);
  assert.match(styles, /\.forma-assistant-specialist footer\s*\{[^}]*flex-wrap: wrap/u);
  const english = ASSISTANT_MESSAGES.en;
  for (const [locale, catalog] of Object.entries(ASSISTANT_MESSAGES)) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(english).sort());
    for (const [key, source] of Object.entries(english)) {
      const fields = (value) => [...value.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]).sort();
      assert.deepEqual(fields(catalog[key]), fields(source), locale + ":" + key);
    }
  }
});

test("non-JSON privacy denials clear cached quotes before body decoding", async (t) => {
  const f = fixture(t); await f.open([sampleTurn()], [savedTask()]);
  const opening = f.host.reviewForTest({ turnId: "turn-a", task: f.host.snapshotForTest().tasks[0] }), resume = await f.take();
  await f.reply(resume, specialistResponse(preview({ status: "completed" }), { task: savedTask({ status: "completed", submission: "settled" }) })); await opening;
  f.host.actionForTest(recoveryR2Control(f)); const retrieval = await f.take();
  let decoded = false;
  retrieval.gate.resolve({ ok: false, status: 403, json: async () => { decoded = true; throw new Error("HTML denial"); } });
  await tick(); assert.equal(decoded, false);
  assert.equal(f.host.snapshotForTest().specialist.quote, null);
  assert.equal(f.host.snapshotForTest().specialist.originalRequest, null);
  assert.deepEqual(f.host.snapshotForTest().messages, []);
});

test("absence from a filtered feed is not withdrawal of a valid pending quote or original input", async (t) => {
  const f = fixture(t); await f.open(); await review(f, { status: "reserved" });
  const checking = f.host.loadForTest(), get = await f.take();
  await f.reply(get, { context: f.context, turns: [], tasks: [] }); await checking;
  assert.equal(f.host.snapshotForTest().specialist.quote.status, "reserved");
  assert.equal(f.host.snapshotForTest().specialist.quote.privateInput.original, "Complete original source");
  assert.equal(f.host.snapshotForTest().specialist.notice, "");
  assert.equal(f.host.snapshotForTest().specialist.resultReply, null);
});

test("server scope denial scrubs both prior private evidence and an authored composer draft", async (t) => {
  for (const operation of ["get", "send", "specialist"]) {
    const f = fixture(t); await f.open(); f.render(); f.panel.draftForTest = "Private draft in a revoked workspace";
    let running, call;
    if (operation === "get") { running = f.host.loadForTest(); call = await f.take(); }
    else if (operation === "send") { running = f.host.sendForTest(f.panel.draftForTest); call = await f.take(); }
    else { running = f.host.reviewForTest({ turnId: "turn-a" }); call = await f.take(); }
    await f.reply(call, operation === "specialist" ? { error: "assistant_read_scope_denied", retentionUnavailable: true } : { error: "project_access_revoked" }, 403); await running;
    assert.equal(f.panel.draftForTest, "");
    assert.equal(f.host.snapshotForTest().context, null);
    assert.equal(f.host.snapshotForTest().turns.length, 0);
    assert.equal(f.host.snapshotForTest().guidance, null);
    assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /Private draft in a revoked workspace|Free guidance/u);
  }
});

test("a dismissed saved-turn suggestion does not reappear when another free turn is merged", async (t) => {
  const f = fixture(t), navigation = { ...proposal(), kind: "navigate", route: "/activity" };
  await f.open([{ ...sampleTurn(), proposals: [navigation] }]);
  await f.host.proposalForTest({ proposal: navigation, action: "dismiss" });
  assert.equal(f.host.snapshotForTest().proposals.length, 0);
  const sending = f.host.sendForTest("Another free question"), post = await f.take();
  await f.reply(post, { context: f.context, turn: sampleTurn(post.body.turnId, post.body.message) }); await sending;
  assert.equal(f.host.snapshotForTest().proposals.length, 0);
  assert.equal(f.host.snapshotForTest().turns.length, 2);
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 0);
});

test("closed review survives filtered feeds and a transient exact retrieval using identity only", async (t) => {
  const f = fixture(t), task = savedTask({ status: "completed", submission: "settled", error: "Do not retain private diagnostic source" });
  await f.open([sampleTurn("turn-a", sampleTurn().user, "Original retained specialist result")], [task]);
  const opening = f.host.reviewForTest({ turnId: "turn-a", task }), resume = await f.take();
  await f.reply(resume, specialistResponse(preview({ status: "completed" }), { task, turn: sampleTurn("turn-a", sampleTurn().user, "Original retained specialist result") })); await opening;
  f.host.closeReviewForTest(); const filtered = await f.take();
  await f.reply(filtered, { context: f.context, turns: [], tasks: [] });
  let reference = f.host.snapshotForTest().tasks[0];
  assert.deepEqual(Object.keys(reference).sort(), ["bindingHash", "executionId", "id", "recoveryOnly", "status", "turnId"]);
  assert.equal(reference.executionId, "approval-a"); assert.equal(reference.status, "recovery");
  let rendered = f.render();
  assert.ok(rendered.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.recoveryStatus"]));
  assert.doesNotMatch(rendered.markup, /Original retained specialist result|gpt-5.6-luna|Maximum approved cost|Do not retain private/u);
  const retrying = f.host.reviewForTest({ turnId: reference.turnId, task: reference }), failed = await f.take();
  assert.deepEqual(failed.body, { action: "resume", turnId: "turn-a", executionId: "approval-a" });
  await f.reply(failed, { error: "temporary_lookup_failure" }, 503); await retrying;
  assert.equal(f.host.snapshotForTest().specialist.executionId, "approval-a");
  f.host.closeReviewForTest(); const filteredAgain = await f.take();
  await f.reply(filteredAgain, { context: f.context, turns: [], tasks: [] });
  reference = f.host.snapshotForTest().tasks[0];
  const recovering = f.host.reviewForTest({ turnId: reference.turnId, task: reference }), recovered = await f.take();
  assert.deepEqual(recovered.body, failed.body);
  await f.reply(recovered, specialistResponse(preview({ status: "completed" }), { task, turn: sampleTurn("turn-a", sampleTurn().user, "Original retained specialist result") })); await recovering;
  assert.equal(f.host.snapshotForTest().turns[0].reply.text, "Original retained specialist result");
  assert.equal(f.calls.some((call) => call.body?.action === "execute" || call.body?.action === "quote"), false);
});

test("ordinary new-purchase denial preserves a separately retained result and the authored draft", async (t) => {
  for (const status of [403, 409, 503]) {
    const f = fixture(t), old = sampleTurn("turn-a", "Original question", "Previously retained paid answer");
    await f.open([old, sampleTurn("turn-b", "A new question")], [savedTask({ status: "completed", submission: "settled" })]);
    f.render(); f.panel.draftForTest = "Another unfinished question";
    const opening = f.host.reviewForTest({ turnId: "turn-b" }), quote = await f.take();
    await f.reply(quote, { error: "assistant_model_or_budget_denied", submission: "not-submitted" }, status); await opening;
    assert.equal(f.host.snapshotForTest().turns[0].reply.text, "Previously retained paid answer");
    assert.equal(f.host.snapshotForTest().tasks[0].submission, "settled");
    assert.equal(f.panel.draftForTest, "Another unfinished question");
    assert.equal(f.host.snapshotForTest().specialist.notice, "denied");
  }
});

test("explicit contract withdrawal while replacing a preview scrubs old content but keeps its exact identity", async (t) => {
  const f = fixture(t); await f.open(); await review(f);
  const replacing = f.host.requestForTest("quote", "gpt-5.6-sol"), replacement = await f.take();
  await f.reply(replacement, { error: "assistant_existing_task_unavailable", retentionUnavailable: true, turnId: "turn-a", executionId: "approval-a" }, 409); await replacing;
  const state = f.host.snapshotForTest();
  assert.equal(state.specialist.quote, null); assert.equal(state.specialist.originalRequest, null); assert.equal(state.specialist.resultReply, null);
  assert.equal(state.specialist.notice, "unavailable");
  assert.equal(state.tasks[0].executionId, "approval-a");
  assert.deepEqual(Object.keys(state.tasks[0]).sort(), ["bindingHash", "executionId", "id", "recoveryOnly", "status", "turnId"]);
  assert.doesNotMatch(JSON.stringify(state), /Complete original source|Keep exactly this sentence|Free guidance/u);
});

test("explicit retained-result withdrawal is different from a valid pending response with no result", async (t) => {
  const f = fixture(t); await f.open([sampleTurn("turn-a", "Original question", "Old retained private result")], [savedTask({ status: "completed", submission: "settled" })]);
  const opening = f.host.reviewForTest({ turnId: "turn-a", task: f.host.snapshotForTest().tasks[0] }), resume = await f.take();
  await f.reply(resume, specialistResponse(preview({ status: "completed" }), { task: savedTask({ status: "completed", submission: "settled" }),
    recoveryError: "assistant_result_unavailable", retainedResultUnavailable: true })); await opening;
  assert.equal(f.host.snapshotForTest().specialist.quote, null);
  assert.equal(f.host.snapshotForTest().specialist.notice, "unavailable");
  assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /Old retained private result|Complete original source/u);
  assert.equal(f.host.snapshotForTest().tasks[0].executionId, "approval-a");
});

test("transient exact lookup keeps identity without presenting old task financial status as current", async (t) => {
  const f = fixture(t); await f.open([sampleTurn()], [savedTask({ status: "completed", submission: "settled" })]);
  const opening = f.host.reviewForTest({ turnId: "turn-a", task: f.host.snapshotForTest().tasks[0] }), resume = await f.take();
  await f.reply(resume, { error: "temporary_lookup_failure" }, 503); await opening;
  const state = f.host.snapshotForTest();
  assert.equal(state.specialist.task.recoveryOnly, true);
  assert.deepEqual(Object.keys(state.tasks[0]).sort(), ["bindingHash", "executionId", "id", "recoveryOnly", "status", "turnId"]);
  const rendered = f.render();
  assert.ok(rendered.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.billingUnknown"]));
  assert.doesNotMatch(rendered.markup, /Verified provider usage is settled|Maximum approved cost|gpt-5.6-luna/u);
});

test("a newer explicit list withdrawal invalidates a resume already decoding, while later deliberate retrieval is allowed", async (t) => {
  const f = fixture(t); await f.open([sampleTurn()], [savedTask()]);
  const resuming = f.host.reviewForTest({ turnId: "turn-a", task: f.host.snapshotForTest().tasks[0] }), oldResume = await f.take();
  const decoding = deferred();
  oldResume.gate.resolve({ ok: true, status: 200, json: async () => {
    await decoding.promise;
    return specialistResponse(preview({ status: "completed" }), { task: savedTask({ status: "completed", submission: "settled" }),
      turn: sampleTurn("turn-a", sampleTurn().user, "STALE-PAID-PRIVATE-BYTES") });
  } });
  await tick();
  const before = f.host.retentionForTest("turn-a", "approval-a");
  const loading = f.host.loadForTest(), newerList = await f.take();
  await f.reply(newerList, { context: f.context, turns: [sampleTurn()], tasks: [savedTask({ retentionUnavailable: true, error: "assistant_execution_unavailable" })] }); await loading;
  assert.notEqual(f.host.retentionForTest("turn-a", "approval-a"), before);
  assert.equal(f.host.snapshotForTest().specialist.notice, "unavailable");
  decoding.resolve(); await resuming;
  assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /STALE-PAID-PRIVATE-BYTES|Complete original source/u);
  assert.equal(f.host.snapshotForTest().specialist.executionId, "approval-a");
  f.host.actionForTest(recoveryR2Control(f)); const freshRead = await f.take();
  assert.deepEqual(freshRead.body, { action: "retrieve", turnId: "turn-a", executionId: "approval-a", approvedBindingHash: "hash-a" });
  await f.reply(freshRead, specialistResponse(preview({ status: "completed" }), { task: savedTask({ status: "completed", submission: "settled" }),
    turn: sampleTurn("turn-a", sampleTurn().user, "Freshly certified original result") }));
  assert.equal(f.host.snapshotForTest().turns[0].reply.text, "Freshly certified original result");
  assert.equal(f.calls.some((call) => call.body?.action === "execute"), false);
});

test("withdrawal of another execution does not invalidate an unrelated active result", async (t) => {
  const f = fixture(t), otherTask = savedTask({ id: "task-b", turnId: "turn-b", executionId: "approval-b", bindingHash: "hash-b" });
  await f.open([sampleTurn(), sampleTurn("turn-b", "Other original question")], [savedTask(), otherTask]);
  const resuming = f.host.reviewForTest({ turnId: "turn-b", task: otherTask }), resume = await f.take();
  const loading = f.host.loadForTest(), list = await f.take();
  await f.reply(list, { context: f.context, turns: [sampleTurn(), sampleTurn("turn-b", "Other original question")],
    tasks: [savedTask({ retainedResultUnavailable: true, recoveryError: "assistant_result_unavailable" }), otherTask] }); await loading;
  assert.equal(f.host.snapshotForTest().specialist.turnId, "turn-b"); assert.equal(f.host.snapshotForTest().specialist.working, true);
  const result = specialistResponse(preview({ executionId: "approval-b", bindingHash: "hash-b", status: "completed" }));
  result.turnId = "turn-b"; result.originalRequest.turnId = "turn-b"; result.originalRequest.conversationTurnIds = ["turn-b"];
  result.task = { ...otherTask, status: "completed", submission: "settled" };
  result.turn = sampleTurn("turn-b", "Other original question", "Valid unrelated original result");
  await f.reply(resume, result); await resuming;
  assert.equal(f.host.snapshotForTest().specialist.resultReply.text, "Valid unrelated original result");
  assert.equal(f.host.snapshotForTest().turns.some((turn) => turn.id === "turn-a"), false);
});

test("GET and resume never run a queued approval; only its separate explicit Run sends the original ID/hash", async (t) => {
  const f = fixture(t), queued = savedTask({ status: "queued", submission: "not-submitted", canExecute: false });
  await f.open([sampleTurn()], [queued]);
  assert.equal(f.render().buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.runApproved"]), false);
  const resuming = f.host.reviewForTest({ turnId: "turn-a", task: queued }), resume = await f.take();
  const runnable = { ...queued, canExecute: true };
  await f.reply(resume, specialistResponse(preview({ status: "reserved", canExecute: true, budgetAvailable: false, availableMicrousd: 0 }), { task: runnable })); await resuming;
  const rendered = f.render(), run = rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.runApproved"]);
  assert.ok(run); assert.equal(run.disabled, false);
  assert.ok(rendered.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.runApprovedDetail"]));
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 0);
  run.click(); run.click();
  const execute = await f.take();
  assert.deepEqual(execute.body, { action: "execute", turnId: "turn-a", executionId: "approval-a", approvedBindingHash: "hash-a" });
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1);
  await f.reply(execute, specialistResponse(preview({ status: "submitting", canExecute: false }), { task: savedTask({ status: "running", submission: "submitting", canExecute: false }) }), 202);
  assert.equal(f.render().buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.runApproved"]), false);
  const before = f.calls.length; await f.host.runApprovedForTest(); assert.equal(f.calls.length, before);
  assert.equal(f.calls.some((call) => call.body?.action === "quote"), false);
});

test("approved continuation fails closed for unknown usage, terminal state, missing proof, expired approval and readers", async (t) => {
  const cases = [
    { task: { submission: "uncertain" } }, { task: { submission: "submitting" } },
    { task: { submission: "usage-recorded" } }, { task: { submission: "settled" } },
    { task: { submission: undefined } }, { task: { canExecute: false } },
    { task: { canExecute: undefined } }, { task: { status: "completed" } },
    { task: { status: "failed" } }, { quote: { canExecute: false } },
    { quote: { providerAvailable: false } }, { quote: { status: "uncertain" } },
    { quote: { status: "completed" } }, { quote: { expiresAt: "2000-01-01T00:00:00Z" } },
    { reader: true },
  ];
  for (const scenario of cases) {
    const f = fixture(t), queued = savedTask({ status: "queued", submission: "not-submitted", canExecute: true, ...scenario.task });
    if (scenario.reader) f.session.set({ ...f.session.get(), capabilities: ["project.read"] });
    await f.open([sampleTurn()], [queued]);
    const resuming = f.host.reviewForTest({ turnId: "turn-a", task: queued }), resume = await f.take();
    await f.reply(resume, specialistResponse(preview({ status: "reserved", canExecute: true, ...scenario.quote }), { task: queued })); await resuming;
    assert.equal(f.render().buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.runApproved"]), false, JSON.stringify(scenario));
    const before = f.calls.length; await f.host.runApprovedForTest(); assert.equal(f.calls.length, before, JSON.stringify(scenario));
  }
});

test("ordinary Retrieve stays free even when the original queued approval is runnable", async (t) => {
  const f = fixture(t), queued = savedTask({ status: "queued", submission: "not-submitted", canExecute: true });
  await f.open([sampleTurn()], [queued]);
  const resuming = f.host.reviewForTest({ turnId: "turn-a", task: queued }), resume = await f.take();
  await f.reply(resume, specialistResponse(preview({ status: "reserved", canExecute: true }), { task: queued })); await resuming;
  f.host.actionForTest(recoveryR2Control(f)); const retrieve = await f.take();
  assert.equal(retrieve.body.action, "retrieve");
  await f.reply(retrieve, specialistResponse(preview({ status: "reserved", canExecute: true }), { task: queued }));
  assert.equal(f.calls.some((call) => call.body?.action === "execute"), false);
});

test("saved-turn specialist review uses the original document view rather than the currently displayed view", async (t) => {
  const f = fixture(t), turn = sampleTurn();
  turn.originalRequest.route = "/document/doc-a/alpha/view/editor";
  f.store.route.set("/document/doc-a/alpha/view/adaptive");
  await f.open([turn]);
  const opening = f.host.reviewForTest({ turnId: turn.id }), quote = await f.take();
  assert.equal(quote.url.searchParams.get("route"), turn.originalRequest.route);
  const response = specialistResponse(); response.originalRequest.route = turn.originalRequest.route;
  await f.reply(quote, response); await opening;
  assert.equal(f.host.snapshotForTest().specialist.quote.executionId, "approval-a");
  assert.equal(f.host.snapshotForTest().specialist.originalRequest.route, turn.originalRequest.route);
  f.host.actionForTest(recoveryR2Control(f)); const execute = await f.take();
  assert.equal(execute.url.searchParams.get("route"), turn.originalRequest.route);
  await f.reply(execute, { error: "fixture_not_submitted", submission: "not-submitted" }, 409);
});

test("saved Canvas selection is reused after selection/view changes; current selection never silently replaces it", async (t) => {
  const f = fixture(t), turn = sampleTurn();
  turn.originalRequest = { schema: 1, turnId: turn.id, route: "/canvas/board-a/alpha", projectId: "project-a",
    documentId: null, canvasId: "board-a", selectedItemIds: ["original-card"], locale: "en" };
  f.store.route.set("/canvas/board-a/alpha/view/compare"); f.select(["different-current-card"]);
  f.store.canvasPlanningDocumentId = (ids) => ids?.length === 1 && ids[0] === "original-card" ? "doc-a" : "";
  f.context.surface = assistantSurfaceForRoute(f.store.route.get()); f.context.scope.documentId = null;
  await f.open([turn]);
  assert.equal(f.host.eligibleForTest(), true);
  const opening = f.host.reviewForTest({ turnId: turn.id }), quote = await f.take();
  assert.equal(quote.url.searchParams.get("route"), turn.originalRequest.route);
  assert.deepEqual(quote.url.searchParams.getAll("selected"), ["original-card"]);
  const response = specialistResponse(preview({ canvasId: "board-a" }));
  response.originalRequest.route = turn.originalRequest.route; response.originalRequest.selectedItemIds = ["original-card"];
  await f.reply(quote, response); await opening;
  assert.equal(f.host.snapshotForTest().specialist.quote.documentId, "doc-a");
  assert.deepEqual(f.host.snapshotForTest().specialist.originalRequest.selectedItemIds, ["original-card"]);
});

test("legacy or mismatched saved-turn scope cannot be silently replaced with the current page for a purchase", async (t) => {
  for (const original of [undefined, { ...sampleTurn().originalRequest, documentId: "doc-b", route: "/document/doc-b/beta" },
    { ...sampleTurn().originalRequest, projectId: "other-project" }]) {
    const f = fixture(t); await f.open([{ ...sampleTurn(), originalRequest: original }]);
    const before = f.calls.length; await f.host.reviewForTest({ turnId: "turn-a" });
    assert.equal(f.calls.length, before);
    assert.equal(f.render().buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.review"]), false);
  }
});

test("native Close/Escape restores a re-created button for the same recovered execution", async (t) => {
  const f = fixture(t), task = savedTask();
  await f.open([sampleTurn()], [task]);
  let rendered = f.render();
  const original = rendered.buttons.find((button) => button.node?.dataset.assistantExecutionId === "approval-a");
  original.click({ currentTarget: original.node });
  const resume = await f.take(); f.render();
  assert.equal(original.node.isConnected, false);
  await f.reply(resume, specialistResponse(preview({ status: "completed" }), { task: savedTask({ id: "canonical-task", status: "completed", submission: "settled" }), turn: sampleTurn("turn-a", sampleTurn().user, "Original recovered reply") }));
  rendered = f.render(); rendered.cancel({ preventDefault() {}, stopPropagation() {} });
  const reload = await f.take(); f.render(); await tick(); f.flushFrames();
  assert.ok(f.trace.some(([kind, turnId, executionId]) => kind === "focus-recovery" && turnId === "turn-a" && executionId === "approval-a"));
  assert.equal(f.trace.some(([kind]) => kind === "focus-input"), false);
  await f.reply(reload, { context: f.context, turns: [sampleTurn()], tasks: [savedTask({ id: "canonical-task", status: "completed", submission: "settled" })] });
});

test("native recovery dismissal falls back to the stable heading when the same-turn button is no longer rendered", async (t) => {
  const f = fixture(t); await f.open();
  let rendered = f.render(), original = rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.review"]);
  assert.match(rendered.markup, /<h2[^>]*data-assistant-heading[^>]*tabindex="-1"/u);
  original.click({ currentTarget: original.node });
  const quote = await f.take(); await f.reply(quote, specialistResponse()); rendered = f.render();
  rendered.cancel({ preventDefault() {}, stopPropagation() {} }); const reload = await f.take();
  await f.reply(reload, { context: f.context, turns: [], tasks: [] });
  f.render(); await tick(); f.flushFrames();
  assert.ok(f.trace.some(([kind]) => kind === "focus-heading"));
  assert.equal(f.trace.some(([kind]) => kind === "focus-input"), false);
});

test("recovery focus restoration does not cross a new modal, route or authorization scope", async (t) => {
  for (const change of [
    (f) => f.topModal({ differentModal: true }),
    (f) => { f.store.route.set("/document/doc-b/beta"); f.render(); },
    (f) => { f.session.set({ ...f.session.get(), permissionEpoch: "new-epoch" }); f.render(); },
  ]) {
    const f = fixture(t); await f.open([sampleTurn()], [savedTask()]);
    let rendered = f.render(); const original = rendered.buttons.find((button) => button.node?.dataset.assistantExecutionId === "approval-a");
    original.click({ currentTarget: original.node }); const resume = await f.take();
    await f.reply(resume, specialistResponse(preview({ status: "completed" }), { task: savedTask({ status: "completed", submission: "settled" }) }));
    rendered = f.render(); rendered.cancel({ preventDefault() {}, stopPropagation() {} });
    const reload = await f.take(); await f.reply(reload, { context: f.context, turns: [sampleTurn()], tasks: [savedTask()] });
    f.render(); change(f); await tick(); f.flushFrames();
    assert.equal(f.trace.some(([kind]) => ["focus-input", "focus-heading", "focus-opener", "focus-recovery"].includes(kind)), false);
  }
});

test("normal free-composer opening still restores input focus outside a specialist review", async (t) => {
  const f = fixture(t); await f.open([]);
  f.panel.updateForTest(new Map([["open", false]])); await tick();
  assert.ok(f.trace.some(([kind]) => kind === "focus-input"));
});

test("a newer submitted task receipt prevents an older resume from re-enabling approved Run", async (t) => {
  const f = fixture(t), queued = savedTask({ status: "queued", submission: "not-submitted", canExecute: false });
  await f.open([sampleTurn()], [queued]);
  const resuming = f.host.reviewForTest({ turnId: "turn-a", task: queued }), oldResume = await f.take(), decoding = deferred();
  oldResume.gate.resolve({ ok: true, status: 200, json: async () => {
    await decoding.promise;
    return specialistResponse(preview({ status: "reserved", canExecute: true }), { task: { ...queued, canExecute: true } });
  } }); await tick();
  const loading = f.host.loadForTest(), newer = await f.take();
  await f.reply(newer, { context: f.context, turns: [sampleTurn()], tasks: [savedTask({ status: "running", submission: "uncertain", canExecute: false })] }); await loading;
  decoding.resolve(); await resuming;
  assert.equal(f.host.snapshotForTest().specialist.task.submission, "uncertain");
  assert.equal(f.host.snapshotForTest().specialist.executionId, "approval-a");
  assert.equal(f.render().buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.runApproved"]), false);
  const before = f.calls.length; await f.host.runApprovedForTest(); assert.equal(f.calls.length, before);
});

for (const locale of ["fr", "ar", "ja"]) test("actual " + locale + " approved-run action localizes the existing-charge disclosure and exact accessible name", async (t) => {
  const f = fixture(t, locale), queued = savedTask({ status: "queued", submission: "not-submitted", canExecute: true });
  await f.open([sampleTurn()], [queued]);
  const resuming = f.host.reviewForTest({ turnId: "turn-a", task: queued }), resume = await f.take();
  await f.reply(resume, specialistResponse(preview({ status: "reserved", canExecute: true }), { task: queued })); await resuming;
  const rendered = f.render(), catalog = ASSISTANT_MESSAGES[locale];
  const run = rendered.buttons.find((button) => button.label === catalog["assistant.specialist.runApproved"]);
  assert.ok(run); assert.equal(run.disabled, false);
  assert.ok(rendered.markup.includes(catalog["assistant.specialist.runApprovedDetail"]));
  assert.ok(run.attrs.includes("approval-a")); assert.ok(run.attrs.includes("Alpha original"));
  assert.equal(run.label.includes("Run approved request"), false);
  run.click(); const execute = await f.take();
  assert.deepEqual(execute.body, { action: "execute", turnId: "turn-a", executionId: "approval-a", approvedBindingHash: "hash-a" });
  await f.reply(execute, { error: "fixture_not_submitted", submission: "not-submitted" }, 409);
  assert.ok(f.render().markup.includes(catalog["assistant.specialist.denied"]));
});

test("a native close event only closes the captured current review after the dialog is actually closed", async (t) => {
  const f = fixture(t); await f.open(); await review(f);
  const rendered = f.render(), reviewId = f.host.snapshotForTest().specialist.id, before = f.calls.length;
  assert.equal(f.dialog.open, true);
  rendered.nativeClose({ currentTarget: f.dialog });
  assert.equal(f.host.snapshotForTest().specialist.id, reviewId);
  assert.equal(f.calls.length, before, "a queued old close while the dialog is open does nothing");
  f.dialog.close();
  const closes = f.trace.filter(([kind]) => kind === "close-dialog").length;
  rendered.nativeClose({ currentTarget: f.dialog });
  const reload = await f.take();
  assert.equal(f.host.snapshotForTest().specialist, null);
  assert.equal(f.trace.filter(([kind]) => kind === "close-dialog").length, closes, "native close does not close again");
  assert.deepEqual(f.events.find(([type]) => type === "forma-assistant-specialist-close")?.[1], { reviewId });
  const after = f.calls.length;
  rendered.nativeClose({ currentTarget: f.dialog });
  assert.equal(f.calls.length, after, "duplicate queued native close cannot reload or purchase");
  await f.reply(reload, { context: f.context, turns: [sampleTurn()], tasks: [] });
  f.render(); await tick(); f.flushFrames();
  assert.ok(f.trace.some(([kind]) => kind === "focus-recovery"));
});

test("queued close and cancel from an earlier review cannot dismiss a newer review before or after its props render", async (t) => {
  const f = fixture(t); await f.open([sampleTurn(), sampleTurn("turn-b")]); await review(f);
  const old = f.render(), originalId = f.host.snapshotForTest().specialist.id;
  old.cancel({ preventDefault() {}, stopPropagation() {} });
  const reload = await f.take();
  await f.reply(reload, { context: f.context, turns: [sampleTurn(), sampleTurn("turn-b")], tasks: [] });
  // The host has opened the next review but Lit has not yet updated the old panel props.
  const reopening = f.host.reviewForTest({ turnId: "turn-b" }), quote = await f.take();
  const newId = f.host.snapshotForTest().specialist.id, before = f.calls.length;
  assert.notEqual(newId, originalId);
  assert.equal(f.panel.specialist.id, originalId);
  old.nativeClose({ currentTarget: { open: false } });
  old.cancel({ preventDefault() {}, stopPropagation() {} });
  assert.equal(f.host.snapshotForTest().specialist.id, newId);
  assert.equal(f.calls.length, before, "captured review ID protects the host before the panel rerenders");
  f.render();
  old.nativeClose({ currentTarget: f.dialog });
  old.nativeClose({ currentTarget: { open: false } });
  old.cancel({ preventDefault() {}, stopPropagation() {} });
  assert.equal(f.host.snapshotForTest().specialist.id, newId);
  assert.equal(f.calls.length, before);
  const response = specialistResponse(preview({ executionId: "approval-b", bindingHash: "hash-b" }), { turnId: "turn-b" });
  response.originalRequest.turnId = "turn-b"; response.originalRequest.conversationTurnIds = ["turn-b"];
  await f.reply(quote, response); await reopening;
  assert.equal(f.host.snapshotForTest().specialist.id, newId);
  f.render(); await tick(); f.flushFrames();
  assert.equal(f.trace.some(([kind]) => ["focus-input", "focus-heading", "focus-opener", "focus-recovery"].includes(kind)), false);
});

test("ordinary pending feed changes do not invalidate an exact read or discard its later certified result", async (t) => {
  const f = fixture(t), queued = savedTask({ status: "queued", submission: "not-submitted", canExecute: false });
  await f.open([sampleTurn()], [queued]);
  const resuming = f.host.reviewForTest({ turnId: "turn-a", task: queued }), oldResume = await f.take(), decoding = deferred();
  const version = f.host.retentionForTest("turn-a", "approval-a");
  oldResume.gate.resolve({ ok: true, status: 200, json: async () => {
    await decoding.promise;
    return specialistResponse(preview({ status: "completed", canExecute: false }), {
      task: savedTask({ status: "completed", submission: "settled", canExecute: false }),
      turn: sampleTurn("turn-a", sampleTurn().user, "Verified paid result after ordinary progress"),
    });
  } }); await tick();
  const loading = f.host.loadForTest(), newer = await f.take();
  await f.reply(newer, { context: f.context, turns: [sampleTurn()], tasks: [savedTask({ status: "running", submission: "submitting", canExecute: false })] }); await loading;
  assert.equal(f.host.retentionForTest("turn-a", "approval-a"), version);
  assert.equal(f.host.snapshotForTest().specialist.working, true, "ordinary progress must not stop the in-flight exact read");
  decoding.resolve(); await resuming;
  const result = f.host.snapshotForTest().specialist;
  assert.equal(result.working, false);
  assert.equal(result.quote.status, "completed");
  assert.equal(result.resultReply.text, "Verified paid result after ordinary progress");
  assert.equal(result.task.submission, "settled");
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 0);
});

test("an unchanged identity-only pending feed leaves exact queued-approval retrieval running", async (t) => {
  const f = fixture(t), queued = savedTask({ status: "queued", submission: "not-submitted", canExecute: false });
  await f.open([sampleTurn()], [queued]);
  const resuming = f.host.reviewForTest({ turnId: "turn-a", task: queued }), resume = await f.take(), decoding = deferred();
  const version = f.host.retentionForTest("turn-a", "approval-a");
  resume.gate.resolve({ ok: true, status: 200, json: async () => {
    await decoding.promise;
    return specialistResponse(preview({ status: "reserved", canExecute: true }), { task: { ...queued, canExecute: true } });
  } }); await tick();
  const loading = f.host.loadForTest(), newer = await f.take();
  await f.reply(newer, { context: f.context, turns: [sampleTurn()], tasks: [{ ...queued }] }); await loading;
  assert.equal(f.host.retentionForTest("turn-a", "approval-a"), version);
  assert.equal(f.host.snapshotForTest().specialist.working, true);
  decoding.resolve(); await resuming;
  assert.ok(f.render().buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.runApproved"]));
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 0);
});

test("an exact completed feed certificate supersedes older running and failed resumes immediately without copying chat text", async (t) => {
  for (const staleStatus of ["running", "failed"]) {
    const f = fixture(t), task = savedTask();
    await f.open([sampleTurn()], [task]);
    const resuming = f.host.reviewForTest({ turnId: "turn-a", task }), oldResume = await f.take(), decoding = deferred();
    const version = f.host.retentionForTest("turn-a", "approval-a");
    oldResume.gate.resolve({ ok: true, status: 200, json: async () => {
      await decoding.promise;
      return specialistResponse(preview({ status: staleStatus === "running" ? "reserved" : "failed", canExecute: false }), {
        task: savedTask({ status: staleStatus, submission: staleStatus === "failed" ? "uncertain" : "submitting", canExecute: false }),
      });
    } }); await tick();
    const loading = f.host.loadForTest(), newer = await f.take(), certificate = certifiedCompletedTask();
    await f.reply(newer, { context: f.context, turns: [sampleTurn("turn-a", sampleTurn().user, "Old copied conversation reply")], tasks: [certificate] }); await loading;
    const current = f.host.snapshotForTest().specialist;
    assert.equal(current.working, false, "terminal certificate reconciles the open modal immediately");
    assert.equal(current.quote.status, "completed");
    assert.equal(current.quote.canExecute, false);
    assert.equal(current.resultReply.text, "Currently retained original paid result");
    assert.notEqual(current.resultReply.text, f.host.snapshotForTest().turns[0].reply.text, "copied chat text is not the certificate");
    assert.deepEqual(current.quote.privateInput, certificate.completedReview.quote.privateInput);
    assert.notEqual(f.host.retentionForTest("turn-a", "approval-a"), version);
    const receipt = JSON.stringify(current);
    decoding.resolve(); await resuming;
    assert.equal(JSON.stringify(f.host.snapshotForTest().specialist), receipt, "older running/failed receipt cannot replace verified completion");
    assert.equal(f.render().buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.runApproved"]), false);
    const checking = f.host.requestForTest("retrieve"), get = await f.take();
    assert.deepEqual(get.body, { action: "retrieve", turnId: "turn-a", executionId: "approval-a", approvedBindingHash: "hash-a" });
    await f.reply(get, { ...specialistResponse(certificate.completedReview.quote), task: certificate, result: certificate.completedReview.result }); await checking;
    assert.equal(f.host.snapshotForTest().specialist.resultReply.text, certificate.completedReview.result.reply.text);
    assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 0);
  }
});

test("completed status, copied replies and mismatched certificate fields cannot certify a paid review", async (t) => {
  for (const change of [
    (task) => { delete task.certifiedCompleted; delete task.completedReview; },
    (task) => { delete task.completedReview; },
    (task) => { task.certifiedCompleted = false; },
    (task) => { task.completedReview.quote.bindingHash = "different-hash"; },
    (task) => { task.completedReview.executionId = "different-execution"; },
    (task) => { task.completedReview.turnId = "different-turn"; },
    (task) => { task.completedReview.result.sourceStatus = "copied-conversation"; },
    (task) => { task.completedReview.quote.canExecute = true; },
    (task) => { task.completedReview.originalRequest.sourceHash = "different-source"; },
    (task) => { task.completedReview.quote.projectId = "another-project"; },
  ]) {
    const f = fixture(t), task = savedTask();
    await f.open([sampleTurn()], [task]);
    const resuming = f.host.reviewForTest({ turnId: "turn-a", task }), resume = await f.take(), decoding = deferred();
    const version = f.host.retentionForTest("turn-a", "approval-a");
    resume.gate.resolve({ ok: true, status: 200, json: async () => {
      await decoding.promise;
      return specialistResponse(preview({ status: "reserved", canExecute: false }), { task: savedTask() });
    } }); await tick();
    const certificate = certifiedCompletedTask("Must not be treated as certified"); change(certificate);
    const loading = f.host.loadForTest(), get = await f.take();
    await f.reply(get, { context: f.context, turns: [sampleTurn("turn-a", sampleTurn().user, "A copied completed-looking reply")], tasks: [certificate] }); await loading;
    assert.equal(f.host.retentionForTest("turn-a", "approval-a"), version);
    assert.equal(f.host.snapshotForTest().specialist.working, true);
    assert.equal(f.host.snapshotForTest().specialist.resultReply, null);
    decoding.resolve(); await resuming;
    assert.equal(f.host.snapshotForTest().specialist.quote.status, "reserved");
    assert.equal(f.host.snapshotForTest().specialist.resultReply, null);
  }
});

test("explicit retention withdrawal wins synchronously over a conflicting completed certificate without auxiliary refresh", async (t) => {
  const f = fixture(t), task = savedTask(); await f.open([sampleTurn()], [task]);
  const resuming = f.host.reviewForTest({ turnId: "turn-a", task }), resume = await f.take();
  const certificate = certifiedCompletedTask("Private paid bytes that must disappear");
  await f.reply(resume, { ...specialistResponse(certificate.completedReview.quote), task: certificate, result: certificate.completedReview.result }); await resuming;
  const version = f.host.retentionForTest("turn-a", "approval-a");
  let refreshes = 0;
  f.store.refreshSession = () => { refreshes += 1; return new Promise(() => {}); };
  const loading = f.host.loadForTest(), get = await f.take();
  await f.reply(get, { context: f.context, turns: [sampleTurn("turn-a", sampleTurn().user, "Private paid bytes that must disappear")],
    tasks: [{ ...certificate, retentionUnavailable: true }] }); await loading;
  assert.notEqual(f.host.retentionForTest("turn-a", "approval-a"), version);
  assert.equal(refreshes, 0);
  assert.equal(f.host.snapshotForTest().specialist.working, false);
  assert.equal(f.host.snapshotForTest().specialist.quote, null);
  assert.equal(f.host.snapshotForTest().specialist.originalRequest, null);
  assert.equal(f.host.snapshotForTest().specialist.resultReply, null);
  assert.equal(JSON.stringify(f.host.snapshotForTest()).includes("Private paid bytes that must disappear"), false);
  assert.deepEqual(Object.keys(f.host.snapshotForTest().tasks[0]).sort(), ["bindingHash", "executionId", "id", "recoveryOnly", "status", "turnId"]);
});

test("a complete GET still decoding cannot merge after a newer exact-retention withdrawal", async (t) => {
  const f = fixture(t), task = savedTask(); await f.open([sampleTurn()], [task]);
  const resuming = f.host.reviewForTest({ turnId: "turn-a", task }), resume = await f.take();
  await f.reply(resume, specialistResponse(preview({ status: "reserved" }), { task })); await resuming;
  const staleLoad = f.host.loadForTest(), staleGet = await f.take(), decoding = deferred();
  staleGet.gate.resolve({ ok: true, status: 200, json: async () => {
    await decoding.promise;
    return { context: f.context, turns: [sampleTurn("turn-a", sampleTurn().user, "Old private copied reply")],
      tasks: [certifiedCompletedTask("Old paid completion that is no longer retained")] };
  } }); await tick();
  const reading = f.host.requestForTest("retrieve"), newer = await f.take();
  await f.reply(newer, { turnId: "turn-a", executionId: "approval-a", error: "assistant_execution_unavailable", retentionUnavailable: true }, 404); await reading;
  const snapshot = JSON.stringify(f.host.snapshotForTest()), version = f.host.retentionForTest("turn-a", "approval-a");
  decoding.resolve(); await staleLoad;
  assert.equal(JSON.stringify(f.host.snapshotForTest()), snapshot);
  assert.equal(f.host.retentionForTest("turn-a", "approval-a"), version);
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 0);
});

function winnerContinuityReceipt(status = "reserved") {
  const quote = preview({ executionId: "approval-b", bindingHash: "hash-b", status,
    sourceHash: "winner-original-source", models: ["gpt-5.6-sol"], maximumMicrousd: 45000,
    period: "2026-07", expiresAt: "2026-07-31T23:59:59.000Z", providerAvailable: false,
    canExecute: false, privateInput: { original: "Winner B original private source", protected: "Winner B protected sentence" } });
  const response = specialistResponse(quote, { task: savedTask({ id: "task-b", executionId: "approval-b",
    bindingHash: "hash-b", model: "gpt-5.6-sol", estimatedMicrousd: 45000, canExecute: false,
    status: status === "completed" ? "completed" : "running", submission: status === "completed" ? "settled" : "submitting" }) });
  response.originalRequest = { ...response.originalRequest, route: "/document/doc-a/alpha/view/compare", locale: "ja",
    conversationTurnIds: ["earlier-original-turn", "turn-a"] };
  if (status === "completed") response.result = { reply: { text: "Certified winner B paid answer" }, sourceStatus: "original-approved-source" };
  return response;
}

function winnerContinuityTask(status = "reserved") {
  const response = winnerContinuityReceipt(status);
  return status === "completed" ? { ...response.task, certifiedCompleted: true,
    completedReview: { turnId: response.turnId, executionId: response.executionId, quote: response.quote,
      originalRequest: response.originalRequest, result: response.result } } : response.task;
}

async function decodingOriginalApproval(f, response) {
  const executing = f.host.requestForTest("execute"), call = await f.take(), decoding = deferred();
  assert.deepEqual(call.body, { action: "execute", turnId: "turn-a", executionId: "approval-a", approvedBindingHash: "hash-a" });
  call.gate.resolve({ ok: true, status: 200, json: async () => { await decoding.promise; return response; } });
  await tick();
  return { call, async release() { decoding.resolve(); await executing; } };
}

function originalToWinnerResponse(status = "reserved") {
  return { ...winnerContinuityReceipt(status), requestedExecutionId: "approval-a",
    reusedExecutionId: "approval-b", winnerExecutionId: "approval-b" };
}

test("winner continuity: a pending same-turn B feed preserves valid A-to-B redirect and the full original B review", async (t) => {
  const f = fixture(t); await f.open(); await review(f);
  const pending = await decodingOriginalApproval(f, originalToWinnerResponse());
  const before = f.host.retentionForTest("turn-a", "approval-a");
  const loading = f.host.loadForTest(), get = await f.take();
  await f.reply(get, { context: f.context, turns: [sampleTurn()], tasks: [winnerContinuityTask()] }); await loading;
  assert.equal(f.host.snapshotForTest().specialist.executionId, "approval-a");
  assert.equal(f.host.snapshotForTest().specialist.working, true);
  assert.equal(f.host.retentionForTest("turn-a", "approval-a"), before);
  await pending.release();
  const state = f.host.snapshotForTest().specialist, original = winnerContinuityReceipt();
  assert.equal(state.executionId, "approval-b"); assert.equal(state.notice, "redirected");
  assert.equal(state.retrievalOnly, true); assert.equal(state.working, false);
  assert.deepEqual(state.quote, original.quote); assert.deepEqual(state.originalRequest, original.originalRequest);
  assert.equal(state.task.id, "task-b"); assert.equal(state.task.model, "gpt-5.6-sol");
  assert.equal(f.host.snapshotForTest().tasks.filter((task) => task.executionId === "approval-b").length, 1);
  assert.equal(f.host.snapshotForTest().tasks.some((task) => task.executionId === "approval-a"), false);
  const calls = f.calls.length; await f.host.requestForTest("execute"); await f.host.runApprovedForTest(); await f.host.requestForTest("quote", "gpt-5.6-sol");
  assert.equal(f.calls.length, calls, "winner reuse never requires or permits a second approval");
  f.host.actionForTest(recoveryR2Control(f)); const retrieve = await f.take();
  assert.deepEqual(retrieve.body, { action: "retrieve", turnId: "turn-a", executionId: "approval-b", approvedBindingHash: "hash-b" });
  await f.reply(retrieve, winnerContinuityReceipt("completed"));
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1);
});

test("winner continuity: newer certified B completion survives an older pending A-to-B redirect and copied old turn", async (t) => {
  const f = fixture(t); await f.open(); await review(f);
  const response = originalToWinnerResponse();
  response.turn = { ...sampleTurn("turn-a", sampleTurn().user, "Older pending copied reply"),
    proposals: [proposal("turn-a", "obsolete-pending-proposal")] };
  const pending = await decodingOriginalApproval(f, response);
  const loading = f.host.loadForTest(), get = await f.take();
  const freshTurn = { ...sampleTurn("turn-a", sampleTurn().user, "Current canonical conversation carrier"),
    proposals: [proposal("turn-a", "current-winner-proposal")] }, certificate = winnerContinuityTask("completed");
  await f.reply(get, { context: f.context, turns: [freshTurn], tasks: [certificate] }); await loading;
  await pending.release();
  const state = f.host.snapshotForTest().specialist;
  assert.equal(state.executionId, "approval-b"); assert.equal(state.quote.status, "completed");
  assert.deepEqual(state.quote, certificate.completedReview.quote);
  assert.deepEqual(state.originalRequest, certificate.completedReview.originalRequest);
  assert.equal(state.resultReply.text, "Certified winner B paid answer");
  assert.notEqual(state.resultReply.text, freshTurn.reply.text, "paid result is the certificate, not copied chat");
  assert.equal(state.task.submission, "settled"); assert.equal(state.task.certifiedCompleted, true);
  assert.equal(state.working, false); assert.equal(state.retrievalOnly, true);
  assert.equal(f.host.snapshotForTest().turns[0].reply.text, freshTurn.reply.text);
  assert.deepEqual(f.host.snapshotForTest().proposals.map((item) => item.id), ["current-winner-proposal"]);
  const calls = f.calls.length; await f.host.runApprovedForTest(); await f.host.requestForTest("execute");
  assert.equal(f.calls.length, calls); assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1);
  assert.equal(f.render().buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.runApproved"]), false);
});

test("winner continuity: a completed B redirect following a pending B feed stays an original result, never a second purchase", async (t) => {
  const f = fixture(t); await f.open(); await review(f);
  const pending = await decodingOriginalApproval(f, originalToWinnerResponse("completed"));
  const loading = f.host.loadForTest(), get = await f.take();
  await f.reply(get, { context: f.context, turns: [sampleTurn()], tasks: [winnerContinuityTask()] }); await loading;
  await pending.release();
  const state = f.host.snapshotForTest().specialist;
  assert.equal(state.executionId, "approval-b"); assert.equal(state.quote.status, "completed");
  assert.equal(state.resultReply.text, "Certified winner B paid answer");
  assert.equal(state.quote.maximumMicrousd, 45000); assert.equal(state.quote.period, "2026-07");
  assert.equal(state.quote.providerAvailable, false); assert.equal(state.originalRequest.locale, "ja");
  assert.equal(state.notice, "redirected"); assert.equal(state.retrievalOnly, true);
  const calls = f.calls.length; await f.host.requestForTest("execute");
  assert.equal(f.calls.length, calls); assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1);
});

test("winner continuity: withdrawal of A or same-turn B after A starts blocks a stale B private redirect", async (t) => {
  for (const executionId of ["approval-a", "approval-b"]) {
    const f = fixture(t); await f.open(); await review(f);
    const pending = await decodingOriginalApproval(f, originalToWinnerResponse("completed"));
    const deniedTask = executionId === "approval-b" ? winnerContinuityTask() : savedTask();
    const loading = f.host.loadForTest(), get = await f.take();
    await f.reply(get, { context: f.context, turns: [sampleTurn()], tasks: [{ ...deniedTask, retentionUnavailable: true }] }); await loading;
    const version = f.host.retentionForTest("turn-a", "approval-a");
    await pending.release();
    const state = f.host.snapshotForTest().specialist;
    assert.equal(state.executionId, executionId); assert.equal(state.notice, "unavailable");
    assert.equal(state.quote, null); assert.equal(state.resultReply, null); assert.equal(state.originalRequest, null);
    assert.equal(state.working, false); assert.equal(f.host.retentionForTest("turn-a", "approval-a"), version);
    assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /Winner B original private source|Certified winner B paid answer/u);
    assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1);
    if (executionId === "approval-b") {
      // A later deliberate read captures the post-withdrawal epoch; it is not a replacement purchase.
      f.host.actionForTest(recoveryR2Control(f)); const retrieve = await f.take();
      assert.deepEqual(retrieve.body, { action: "retrieve", turnId: "turn-a", executionId: "approval-b", approvedBindingHash: "hash-b" });
      await f.reply(retrieve, winnerContinuityReceipt("completed"));
      assert.equal(f.host.snapshotForTest().specialist.resultReply.text, "Certified winner B paid answer");
      assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1);
    }
  }
});

test("winner continuity: sixteen supported eight-task feeds cannot evict the active approval or its recovered winner handle", async (t) => {
  const f = fixture(t); await f.open(); await review(f);
  const pending = await decodingOriginalApproval(f, originalToWinnerResponse());
  let lastTasks = [], lastTurns = [];
  for (let batch = 0; batch < 16; batch += 1) {
    lastTasks = Array.from({ length: 8 }, (_, index) => batch === 0 && index === 0 ? winnerContinuityTask()
      : savedTask({ id: "page-task-" + batch + "-" + index, executionId: "page-execution-" + batch + "-" + index,
        turnId: "page-turn-" + batch + "-" + index, bindingHash: "page-hash-" + batch + "-" + index,
        status: "completed", submission: "settled", canExecute: false }));
    lastTurns = lastTasks.slice(-ASSISTANT_CONTEXT_LIMITS.turns).map((task) => sampleTurn(task.turnId));
    const loading = f.host.loadForTest(), get = await f.take();
    await f.reply(get, { context: f.context, turns: lastTurns, tasks: lastTasks }); await loading;
    const state = f.host.snapshotForTest();
    assert.equal(state.specialist.executionId, "approval-a");
    assert.equal(state.specialist.quote.bindingHash, "hash-a");
    assert.equal(state.specialist.working, true);
    assert.equal(state.tasks.filter((task) => task.executionId === "approval-a").length, 1);
  }
  assert.equal(f.host.snapshotForTest().tasks.length, 129);
  const knownWinner = f.host.snapshotForTest().tasks.find((task) => task.executionId === "approval-b");
  assert.deepEqual(Object.keys(knownWinner).sort(), ["bindingHash", "executionId", "id", "recoveryOnly", "status", "turnId"]);
  await pending.release();
  assert.equal(f.host.snapshotForTest().specialist.executionId, "approval-b");
  assert.equal(f.host.snapshotForTest().tasks.length, 128);
  assert.equal(f.host.snapshotForTest().tasks.filter((task) => task.executionId === "approval-b").length, 1);
  let rendered = f.render();
  rendered.cancel({ preventDefault() {}, stopPropagation() {} });
  const closedFeed = await f.take();
  await f.reply(closedFeed, { context: f.context, turns: lastTurns, tasks: lastTasks });
  rendered = f.render(); await tick(); f.flushFrames();
  const recovery = rendered.buttons.find((button) => button.node?.dataset.assistantExecutionId === "approval-b");
  assert.ok(recovery, "the exact winner is reachable even after its original turn and task fall outside the bounded feed");
  assert.equal(recovery.disabled, false);
  recovery.click({ currentTarget: recovery.node }); const resume = await f.take();
  assert.deepEqual(resume.body, { action: "resume", turnId: "turn-a", executionId: "approval-b" });
  await f.reply(resume, winnerContinuityReceipt("completed"));
  assert.equal(f.host.snapshotForTest().specialist.resultReply.text, "Certified winner B paid answer");
  assert.equal(f.calls.filter((call) => call.body?.action === "quote").length, 1);
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1);
});

test("stop ordering: a newer cached completion cannot mask an already-started exact read's explicit withdrawal", async (t) => {
  for (const stage of ["headers", "json"]) {
    const f = fixture(t), task = savedTask({ id: "approval-a" }); await f.open([sampleTurn()], [task]);
    const opening = f.host.reviewForTest({ turnId: "turn-a", task }), first = await f.take();
    await f.reply(first, specialistResponse(preview({ status: "reserved", canExecute: false }), { task })); await opening;
    const reading = f.host.requestForTest("retrieve"), negative = await f.take(), decoding = deferred();
    const denial = { turnId: "turn-a", executionId: "approval-a", error: "assistant_execution_unavailable", retentionUnavailable: true };
    if (stage === "json") {
      negative.gate.resolve({ ok: true, status: 200, json: async () => { await decoding.promise; return denial; } }); await tick();
    }
    const loading = f.host.loadForTest(), completedFeed = await f.take();
    await f.reply(completedFeed, { context: f.context, turns: [sampleTurn()],
      tasks: [{ ...certifiedCompletedTask("Completion later withdrawn"), id: "approval-a" }] }); await loading;
    assert.equal(f.host.snapshotForTest().specialist.quote.status, "completed");
    if (stage === "headers") await f.reply(negative, denial, 404); else decoding.resolve();
    await reading;
    const state = f.host.snapshotForTest().specialist;
    assert.equal(state.quote, null); assert.equal(state.resultReply, null); assert.equal(state.notice, "unavailable");
    assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /Completion later withdrawn/u);
  }
});

test("stop ordering: newer canceled or failed task receipts cannot be overwritten by an older pending exact read", async (t) => {
  for (const status of ["canceled", "failed", "needs-review"]) {
    const f = fixture(t), task = savedTask({ id: "approval-a" }); await f.open([sampleTurn()], [task]);
    const opening = f.host.reviewForTest({ turnId: "turn-a", task }), first = await f.take();
    await f.reply(first, specialistResponse(preview({ status: "reserved", canExecute: false }), { task })); await opening;
    const reading = f.host.requestForTest("retrieve"), pending = await f.take(), decoding = deferred();
    pending.gate.resolve({ ok: true, status: 200, json: async () => { await decoding.promise;
      return specialistResponse(preview({ status: "reserved", canExecute: false }), { task }); } }); await tick();
    const loading = f.host.loadForTest(), terminalFeed = await f.take();
    const terminal = { ...task, status, submission: status === "canceled" ? "not-submitted" : "uncertain", canExecute: false };
    await f.reply(terminalFeed, { context: f.context, turns: [sampleTurn()], tasks: [terminal] }); await loading;
    const afterFeed = f.host.snapshotForTest().specialist;
    decoding.resolve(); await reading;
    assert.equal(afterFeed.working, false, "the current terminal receipt settles the open request indicator");
    assert.equal(f.host.snapshotForTest().specialist.task.status, status);
    assert.equal(f.host.snapshotForTest().specialist.task.submission, terminal.submission);
    assert.equal(f.host.snapshotForTest().specialist.working, false);
    const count = f.calls.length; await f.host.runApprovedForTest(); assert.equal(f.calls.length, count);
  }
});

test("stop ordering: a later GET withdrawal clears an earlier-started exact read even when that read completes last", async (t) => {
  const f = fixture(t), task = savedTask({ id: "approval-a" }); await f.open([sampleTurn()], [task]);
  const opening = f.host.reviewForTest({ turnId: "turn-a", task }), first = await f.take();
  await f.reply(first, specialistResponse(preview({ status: "reserved", canExecute: false }), { task })); await opening;
  // Request order, not arrival order: this positive exact read predates the negative GET.
  const reading = f.host.requestForTest("retrieve"), completed = await f.take();
  const loading = f.host.loadForTest(), negativeGet = await f.take(), decoding = deferred();
  negativeGet.gate.resolve({ ok: true, status: 200, json: async () => { await decoding.promise;
    return { context: f.context, turns: [sampleTurn()], tasks: [{ ...task, retentionUnavailable: true }] }; } }); await tick();
  await f.reply(completed, specialistResponse(preview({ status: "completed", canExecute: false }), {
    task: { ...task, status: "completed", submission: "settled" },
    result: { reply: "Private completion that an explicit withdrawal must clear", sourceStatus: "original-approved-source" },
  })); await reading;
  decoding.resolve(); await loading;
  assert.equal(f.host.snapshotForTest().specialist.quote, null);
  assert.equal(f.host.snapshotForTest().specialist.resultReply, null);
  assert.equal(f.host.snapshotForTest().specialist.notice, "unavailable");
});

test("stop ordering: a duplicate old withdrawal cannot erase a later deliberately recertified result", async (t) => {
  const f = fixture(t), task = savedTask({ id: "approval-a" }); await f.open([sampleTurn()], [task]);
  const opening = f.host.reviewForTest({ turnId: "turn-a", task }), first = await f.take();
  await f.reply(first, specialistResponse(preview({ status: "reserved", canExecute: false }), { task })); await opening;
  const olderLoad = f.host.loadForTest(), oldNegative = await f.take(), decoding = deferred();
  const unavailable = { context: f.context, turns: [], tasks: [{ ...task, retentionUnavailable: true }] };
  oldNegative.gate.resolve({ ok: true, status: 200, json: async () => { await decoding.promise; return unavailable; } }); await tick();
  const newerLoad = f.host.loadForTest(), newNegative = await f.take();
  await f.reply(newNegative, unavailable); await newerLoad;
  const reading = f.host.requestForTest("retrieve"), fresh = await f.take();
  await f.reply(fresh, specialistResponse(preview({ status: "completed", canExecute: false }), {
    task: { ...task, status: "completed", submission: "settled" },
    result: { reply: "Deliberately recertified current result", sourceStatus: "original-approved-source" },
  })); await reading;
  const receipt = JSON.stringify(f.host.snapshotForTest().specialist);
  decoding.resolve(); await olderLoad;
  assert.equal(JSON.stringify(f.host.snapshotForTest().specialist), receipt);
  assert.equal(f.host.snapshotForTest().specialist.resultReply, "Deliberately recertified current result");
});

// These three public shapes were captured from the actual routed SQLite cancel
// fixture: unused-held, submitted/unknown, and late completed. No refund proof is public.
function signedStopReceipt(kind) {
  const completed = kind === "completed", unused = kind === "unused";
  return specialistResponse(preview({ status: completed ? "completed" : unused ? "failed" : "uncertain",
    maximumMicrousd: 3674, canExecute: false }), {
    task: savedTask({ id: "approval-a", estimatedMicrousd: 3674, status: completed ? "completed" : "canceled",
      submission: completed ? "settled" : unused ? "not-submitted" : "uncertain", canExecute: false }),
    ...(completed ? { result: { reply: "Original paid result after stop", sourceStatus: "original-approved-source",
      billingStatus: "settled", maximumMicrousd: 3674, accountedMicrousd: 560 } } : {}),
  });
}

async function approvedStopReview(f, { taskStatus = "running", submission = "submitting", quote = {}, originalRequest = {}, turn = sampleTurn() } = {}) {
  const task = savedTask({ id: "approval-a", estimatedMicrousd: 3674, status: taskStatus, submission, canExecute: false });
  await f.open([turn], [task]);
  const opening = f.host.reviewForTest({ turnId: turn.id, task }), read = await f.take();
  const response = specialistResponse(preview({ status: "reserved", maximumMicrousd: 3674, canExecute: false, ...quote }), { task });
  response.originalRequest = { ...response.originalRequest, ...originalRequest };
  await f.reply(read, response); await opening;
  return task;
}

test("approved Stop uses the exact existing empty-body route and actual receipt shapes without assuming cancellation is free", async (t) => {
  for (const kind of ["unused", "submitted", "completed"]) {
    const f = fixture(t), task = await approvedStopReview(f, kind === "unused" ? { taskStatus: "queued", submission: "not-submitted" } : {});
    f.panel.draftForTest = "Keep this unfinished free question";
    const original = f.host.snapshotForTest().specialist, rendered = f.render();
    const stop = rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]);
    assert.ok(stop); assert.equal(stop.disabled, false); assert.ok(stop.attrs.includes("approval-a")); assert.ok(stop.attrs.includes("Alpha original"));
    assert.ok(rendered.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.stopDetail"]));
    stop.click(); const cancel = await f.take();
    assert.equal(cancel.url.pathname, "/api/assistant/tasks/approval-a/cancel");
    assert.equal(cancel.url.searchParams.get("route"), original.originalRequest.route);
    assert.equal(cancel.url.searchParams.get("projectId"), original.originalRequest.projectId);
    assert.equal(cancel.init.method, "POST"); assert.equal(cancel.init.body, undefined); assert.equal(cancel.body, null);
    assert.equal(cancel.init.headers["content-type"], undefined, "the existing cancel handler rejects bodies");
    assert.equal(f.host.snapshotForTest().specialist.stopping, true);
    const stoppingView = f.render();
    assert.ok(stoppingView.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.stopping"]));
    assert.equal(stoppingView.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"])?.disabled, true);
    const count = f.calls.length; stop.click(); await f.host.taskForTest({ task, action: "cancel" }); assert.equal(f.calls.length, count);
    await f.reply(cancel, signedStopReceipt(kind));
    const state = f.host.snapshotForTest().specialist, after = f.render();
    assert.equal(state.id, original.id); assert.equal(state.executionId, original.executionId);
    assert.equal(state.quote.bindingHash, original.quote.bindingHash);
    assert.equal(state.working, false); assert.equal(state.stopping, false); assert.equal(state.retrievalOnly, true);
    assert.equal(f.panel.draftForTest, "Keep this unfinished free question");
    assert.equal(state.task.status, kind === "completed" ? "completed" : "canceled");
    assert.equal(state.task.submission, kind === "completed" ? "settled" : kind === "unused" ? "not-submitted" : "uncertain");
    assert.ok(after.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist." + (kind === "completed" ? "settled" : kind === "unused" ? "notSubmitted" : "billingUnknown")]));
    if (kind !== "completed") {
      assert.ok(after.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.canceled"]));
      assert.equal(after.markup.includes(ASSISTANT_MESSAGES.en["assistant.task.canceled"]), false);
    } else {
      assert.equal(state.resultReply, "Original paid result after stop");
      assert.equal(after.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.canceled"]), false);
    }
    assert.equal(after.buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]), false);
    assert.equal(f.calls.filter((call) => call.url.pathname.endsWith("/cancel")).length, 1);
    assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 0);
  }
});

test("approved Stop remains available without a provider key, current budget, current month, current model or unexpired purchase", async (t) => {
  const f = fixture(t);
  f.session.set({ ...f.session.get(), provider: { configured: false, plannerConfigured: false },
    costBudgets: { period: "2099-01", user: { limit: 0 } }, assistant: { ...f.session.get().assistant, models: [] } });
  await approvedStopReview(f, { quote: { providerAvailable: false, budgetAvailable: false, period: "2026-07", expiresAt: "2026-07-31T00:00:00.000Z" } });
  const stop = f.render().buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]);
  assert.ok(stop); assert.equal(stop.disabled, false);
  stop.click(); const cancel = await f.take();
  await f.reply(cancel, signedStopReceipt("submitted"));
  assert.equal(f.host.snapshotForTest().specialist.task.submission, "uncertain");
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 0);
});

test("approved Stop requires a verified original review, exact owned task and current author/output authority", async (t) => {
  for (const capabilities of [["project.read"], ["project.read", "project.author"], ["project.read", "project.output.request"]]) {
    const f = fixture(t); f.session.set({ ...f.session.get(), capabilities });
    const task = await approvedStopReview(f);
    assert.equal(f.render().buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]), false);
    const before = f.calls.length; await f.host.taskForTest({ task, action: "cancel" }); await f.host.requestForTest("stop");
    assert.equal(f.calls.length, before);
  }
  for (const status of ["completed", "canceled", "failed", "needs-review", "reconciled", "recovery"]) {
    const f = fixture(t), task = await approvedStopReview(f, { taskStatus: status, quote: { status: status === "completed" ? "completed" : "uncertain" } });
    assert.equal(f.render().buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]), false);
    const before = f.calls.length; await f.host.taskForTest({ task, action: "cancel" }); assert.equal(f.calls.length, before);
  }
  const f = fixture(t), task = savedTask({ id: "approval-a" }); await f.open([sampleTurn()], [task]);
  let before = f.calls.length; await f.host.taskForTest({ task, action: "cancel" }); assert.equal(f.calls.length, before, "identity-only GET is not stop authority");
  const opening = f.host.reviewForTest({ turnId: "turn-a", task }), resume = await f.take();
  await f.reply(resume, specialistResponse(preview({ status: "reserved", canExecute: false }), { task })); await opening;
  before = f.calls.length;
  for (const mismatch of [{ ...task, id: "another-task" }, { ...task, executionId: "another-execution" }, { ...task, bindingHash: "another-hash" }, { ...task, turnId: "another-turn" }]) {
    await f.host.taskForTest({ task: mismatch, action: "cancel" });
  }
  await f.host.taskForTest({ task, action: "reconcile" });
  assert.equal(f.calls.length, before, "stopping never routes another task or enables actor-self billing reconciliation");
});

test("approved Stop uses retained Canvas route and selection, not whatever the user currently has selected", async (t) => {
  const f = fixture(t);
  f.store.route.set("/canvas/board-a/alpha/view/compare"); f.select(["current-other-card"]);
  f.context.surface = assistantSurfaceForRoute(f.store.route.get()); f.context.scope.documentId = null;
  const original = { schema: 1, turnId: "turn-a", route: "/canvas/board-a/alpha", projectId: "project-a",
    documentId: null, canvasId: "board-a", selectedItemIds: ["original-card"], locale: "en" };
  await approvedStopReview(f, { turn: { ...sampleTurn(), originalRequest: original }, quote: { canvasId: "board-a" },
    originalRequest: { route: original.route, canvasId: "board-a", selectedItemIds: original.selectedItemIds } });
  const stop = f.render().buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]);
  assert.ok(stop); stop.click(); const cancel = await f.take();
  assert.equal(cancel.url.pathname, "/api/assistant/tasks/approval-a/cancel");
  assert.equal(cancel.url.searchParams.get("route"), original.route);
  assert.deepEqual(cancel.url.searchParams.getAll("selected"), ["original-card"]);
  const response = signedStopReceipt("submitted"); response.quote.canvasId = "board-a";
  response.originalRequest = { ...response.originalRequest, route: original.route, canvasId: "board-a", selectedItemIds: original.selectedItemIds };
  await f.reply(cancel, response);
  assert.equal(f.host.snapshotForTest().specialist.task.status, "canceled");
});

test("lost Stop delivery stays unknown until exact retrieval; it never reports a free cancellation or retries the stop", async (t) => {
  const f = fixture(t); await approvedStopReview(f);
  f.panel.draftForTest = "Keep this draft after a lost stop";
  const stop = f.render().buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]);
  stop.click(); const cancel = await f.take(); await f.reject(cancel);
  const state = f.host.snapshotForTest().specialist, rendered = f.render();
  assert.equal(state.notice, "stopUnconfirmed"); assert.equal(state.executionId, "approval-a");
  assert.equal(state.task.recoveryOnly, true); assert.equal(state.task.status, "recovery"); assert.equal(state.working, false);
  assert.equal(f.panel.draftForTest, "Keep this draft after a lost stop");
  assert.ok(rendered.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.stopUnconfirmed"]));
  assert.ok(rendered.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.billingUnknown"]));
  assert.equal(rendered.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.canceled"]), false);
  assert.equal(rendered.buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]), false);
  stop.click(); assert.equal(f.calls.filter((call) => call.url.pathname.endsWith("/cancel")).length, 1);
  f.host.actionForTest(recoveryR2Control(f)); const retrieve = await f.take();
  assert.deepEqual(retrieve.body, { action: "retrieve", turnId: "turn-a", executionId: "approval-a", approvedBindingHash: "hash-a" });
  await f.reply(retrieve, signedStopReceipt("submitted"));
  assert.equal(f.host.snapshotForTest().specialist.task.status, "canceled");
  assert.equal(f.host.snapshotForTest().specialist.task.submission, "uncertain");
  assert.equal(f.calls.filter((call) => call.url.pathname.endsWith("/cancel")).length, 1);
});

test("Stop rejection or an unrelated receipt cannot claim cancellation or expose another request", async (t) => {
  for (const reply of [
    { status: 409, value: { error: "assistant_task_already_started" } },
    { status: 200, value: { ...signedStopReceipt("submitted"), turnId: "other-turn" } },
    { status: 200, value: { ...signedStopReceipt("submitted"), task: { ...signedStopReceipt("submitted").task, id: "other-task" } } },
  ]) {
    const f = fixture(t); await approvedStopReview(f);
    const stop = f.render().buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]);
    stop.click(); const cancel = await f.take(); await f.reply(cancel, reply.value, reply.status);
    const state = f.host.snapshotForTest().specialist;
    assert.equal(state.executionId, "approval-a"); assert.equal(state.notice, "stopUnconfirmed");
    assert.equal(state.task.recoveryOnly, true); assert.notEqual(state.task.status, "canceled");
    assert.equal(f.calls.filter((call) => call.url.pathname.endsWith("/cancel")).length, 1);
  }
});

for (const locale of ["fr", "ar", "ja"]) test("actual " + locale + " Stop control and unknown-held receipt are localized without changing the route contract", async (t) => {
  const f = fixture(t, locale); await approvedStopReview(f);
  f.panel.draftForTest = "Unfinished " + locale;
  const catalog = ASSISTANT_MESSAGES[locale], rendered = f.render();
  const stop = rendered.buttons.find((button) => button.label === catalog["assistant.specialist.stop"]);
  assert.ok(stop); assert.equal(stop.disabled, false);
  assert.ok(stop.attrs.includes("approval-a")); assert.ok(stop.attrs.includes("Alpha original"));
  assert.ok(rendered.markup.includes(catalog["assistant.specialist.stopDetail"]));
  assert.equal(stop.label.includes("Stop approved request"), false);
  stop.click(); const cancel = await f.take();
  assert.equal(cancel.init.body, undefined); assert.equal(cancel.url.pathname, "/api/assistant/tasks/approval-a/cancel");
  await f.reply(cancel, signedStopReceipt("submitted"));
  const after = f.render();
  assert.ok(after.markup.includes(catalog["assistant.specialist.canceled"]));
  assert.ok(after.markup.includes(catalog["assistant.specialist.billingUnknown"]));
  assert.equal(after.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.billingUnknown"]), false);
  assert.equal(after.markup.includes(catalog["assistant.task.canceled"]), false);
  assert.equal(f.panel.draftForTest, "Unfinished " + locale);
});

test("the Stop button fails closed when a native modal cannot be opened", async (t) => {
  const f = fixture(t); await approvedStopReview(f);
  f.dialog.showModal = () => { throw new Error("No native modal"); };
  const rendered = f.render(), stop = rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]);
  assert.ok(stop); assert.equal(stop.disabled, true);
  const count = f.calls.length; stop.click(); assert.equal(f.calls.length, count);
});

test("Stop ordering: a verified late paid completion can supersede a cancellation feed without another purchase", async (t) => {
  const f = fixture(t); await approvedStopReview(f);
  const stop = f.render().buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]);
  stop.click(); const cancel = await f.take(), decoding = deferred(), receipt = signedStopReceipt("completed");
  receipt.turn = sampleTurn("turn-a", sampleTurn().user, "Copied turn text is not the paid receipt");
  cancel.gate.resolve({ ok: true, status: 200, json: async () => { await decoding.promise; return receipt; } }); await tick();
  const loading = f.host.loadForTest(), canceledFeed = await f.take();
  await f.reply(canceledFeed, { context: f.context, turns: [sampleTurn()], tasks: [signedStopReceipt("submitted").task] }); await loading;
  assert.equal(f.host.snapshotForTest().specialist.task.status, "canceled");
  decoding.resolve(); await tick();
  const state = f.host.snapshotForTest().specialist;
  assert.equal(state.quote.status, "completed"); assert.equal(state.task.status, "completed"); assert.equal(state.task.submission, "settled");
  assert.equal(state.resultReply, "Original paid result after stop");
  assert.equal(state.working, false); assert.equal(state.stopping, false);
  assert.equal(f.calls.filter((call) => call.url.pathname.endsWith("/cancel")).length, 1);
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 0);
});

test("Stop ordering: an older canceled receipt cannot replace a newer certified completed feed", async (t) => {
  const f = fixture(t); await approvedStopReview(f);
  f.render().buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]).click();
  const cancel = await f.take(), decoding = deferred();
  cancel.gate.resolve({ ok: true, status: 200, json: async () => { await decoding.promise; return signedStopReceipt("submitted"); } }); await tick();
  const loading = f.host.loadForTest(), completeFeed = await f.take();
  const receipt = signedStopReceipt("completed");
  const task = { ...receipt.task, certifiedCompleted: true, completedReview: {
    turnId: receipt.turnId, executionId: receipt.executionId, quote: receipt.quote, originalRequest: receipt.originalRequest, result: receipt.result } };
  await f.reply(completeFeed, { context: f.context, turns: [sampleTurn()], tasks: [task] }); await loading;
  const current = JSON.stringify(f.host.snapshotForTest().specialist);
  decoding.resolve(); await tick();
  assert.equal(JSON.stringify(f.host.snapshotForTest().specialist), current);
  assert.equal(f.host.snapshotForTest().specialist.resultReply, "Original paid result after stop");
});

test("Stop ordering: explicit result withdrawal is consumed even after a completion feed, and keeps the author's draft", async (t) => {
  const f = fixture(t); await approvedStopReview(f); f.panel.draftForTest = "Keep authored draft on result withdrawal";
  f.render().buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]).click();
  const cancel = await f.take(), decoding = deferred();
  cancel.gate.resolve({ ok: true, status: 200, json: async () => { await decoding.promise;
    return { ...signedStopReceipt("completed"), retainedResultUnavailable: true, recoveryError: "assistant_result_unavailable" }; } }); await tick();
  const loading = f.host.loadForTest(), completeFeed = await f.take();
  await f.reply(completeFeed, { context: f.context, turns: [sampleTurn()], tasks: [{ ...certifiedCompletedTask(), id: "approval-a" }] }); await loading;
  decoding.resolve(); await tick();
  const state = f.host.snapshotForTest().specialist;
  assert.equal(state.quote, null); assert.equal(state.resultReply, null); assert.equal(state.originalRequest, null);
  assert.equal(state.notice, "unavailable"); assert.equal(state.stopping, false);
  assert.equal(f.panel.draftForTest, "Keep authored draft on result withdrawal");
});

test("Stop ordering: a late paid response cannot reappear after a newer retention withdrawal", async (t) => {
  const f = fixture(t); await approvedStopReview(f);
  f.render().buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]).click();
  const cancel = await f.take(), decoding = deferred();
  cancel.gate.resolve({ ok: true, status: 200, json: async () => { await decoding.promise; return signedStopReceipt("completed"); } }); await tick();
  const loading = f.host.loadForTest(), negative = await f.take();
  await f.reply(negative, { context: f.context, turns: [sampleTurn()],
    tasks: [{ ...signedStopReceipt("submitted").task, retentionUnavailable: true }] }); await loading;
  decoding.resolve(); await tick();
  const state = f.host.snapshotForTest().specialist;
  assert.equal(state.quote, null); assert.equal(state.resultReply, null); assert.equal(state.notice, "unavailable");
  assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /Original paid result after stop/u);
});

test("Stop read-scope denial clears cached private content before decoding a body", async (t) => {
  const f = fixture(t); await approvedStopReview(f); f.panel.draftForTest = "Private draft must be cleared after scope denial";
  f.render().buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]).click();
  const cancel = await f.take(); let decoded = false;
  cancel.gate.resolve({ ok: false, status: 403, json: async () => { decoded = true; throw new Error("No JSON"); } }); await tick();
  const state = f.host.snapshotForTest();
  assert.equal(decoded, false); assert.equal(state.context, null);
  assert.equal(state.specialist.quote, null); assert.equal(state.specialist.resultReply, null);
  assert.equal(f.panel.draftForTest, "");
});

test("closing during Stop keeps a durable exact handle and only reads the eventual server state", async (t) => {
  const f = fixture(t); await approvedStopReview(f); f.panel.draftForTest = "Keep draft after closing a stop";
  let rendered = f.render();
  rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]).click();
  const cancel = await f.take();
  rendered = f.render(); rendered.cancel({ preventDefault() {}, stopPropagation() {} });
  const firstRead = await f.take();
  await f.reply(firstRead, { context: f.context, turns: [sampleTurn()], tasks: [savedTask({ id: "approval-a" })] });
  f.render();
  await f.reply(cancel, signedStopReceipt("submitted"));
  const recoveryRead = await f.take(); assert.equal(recoveryRead.body, null);
  await f.reply(recoveryRead, { context: f.context, turns: [sampleTurn()], tasks: [signedStopReceipt("submitted").task] });
  assert.equal(f.host.snapshotForTest().specialist, null);
  assert.equal(f.panel.draftForTest, "Keep draft after closing a stop");
  const recovery = f.render().buttons.find((button) => button.node?.dataset.assistantExecutionId === "approval-a");
  assert.ok(recovery); recovery.click({ currentTarget: recovery.node }); const resume = await f.take();
  assert.deepEqual(resume.body, { action: "resume", turnId: "turn-a", executionId: "approval-a" });
  await f.reply(resume, signedStopReceipt("submitted"));
  assert.equal(f.host.snapshotForTest().specialist.task.status, "canceled");
  assert.equal(f.host.snapshotForTest().specialist.task.submission, "uncertain");
  assert.equal(f.calls.filter((call) => call.url.pathname.endsWith("/cancel")).length, 1);
  assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 0);
});

test("an old Stop button cannot cancel a newer review before or after the panel receives its new props", async (t) => {
  const f = fixture(t); await approvedStopReview(f);
  let rendered = f.render(), oldStop = rendered.buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]);
  rendered.cancel({ preventDefault() {}, stopPropagation() {} });
  const closedRead = await f.take(), taskB = savedTask({ id: "approval-b", executionId: "approval-b", bindingHash: "hash-b", turnId: "turn-b" });
  await f.reply(closedRead, { context: f.context, turns: [sampleTurn(), sampleTurn("turn-b")], tasks: [taskB] });
  const opening = f.host.reviewForTest({ turnId: "turn-b", task: taskB }), resume = await f.take(), before = f.calls.length;
  oldStop.click(); assert.equal(f.calls.length, before, "host rejects the old captured task before Lit props update");
  f.render(); oldStop.click(); assert.equal(f.calls.length, before, "panel rejects the old review ID after props update");
  const response = specialistResponse(preview({ status: "reserved", executionId: "approval-b", bindingHash: "hash-b" }), { turnId: "turn-b", task: taskB });
  response.originalRequest.turnId = "turn-b";
  await f.reply(resume, response); await opening;
  f.render(); oldStop.click(); assert.equal(f.calls.length, before);
  assert.equal(f.host.snapshotForTest().specialist.executionId, "approval-b");
  assert.equal(f.calls.some((call) => call.url.pathname.endsWith("/cancel")), false);
});

test("a retained canonical completion survives a later pending lookup but never an explicit withdrawal", async (t) => {
  const f = fixture(t); await approvedStopReview(f);
  f.render().buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]).click();
  const cancel = await f.take(); await f.reply(cancel, signedStopReceipt("completed"));
  const reading = f.host.requestForTest("retrieve"), pending = await f.take();
  await f.reply(pending, specialistResponse(preview({ status: "reserved", maximumMicrousd: 3674, canExecute: false }), {
    task: savedTask({ id: "approval-a", estimatedMicrousd: 3674, status: "running", submission: "submitting", canExecute: false }),
  })); await reading;
  assert.equal(f.host.snapshotForTest().specialist.quote.status, "completed");
  assert.equal(f.host.snapshotForTest().specialist.task.status, "completed");
  assert.equal(f.host.snapshotForTest().specialist.resultReply, "Original paid result after stop");
  const checking = f.host.requestForTest("retrieve"), negative = await f.take();
  await f.reply(negative, { ...signedStopReceipt("completed"), retainedResultUnavailable: true,
    recoveryError: "assistant_result_unavailable" }); await checking;
  assert.equal(f.host.snapshotForTest().specialist.quote, null);
  assert.equal(f.host.snapshotForTest().specialist.resultReply, null);
  assert.equal(f.host.snapshotForTest().specialist.notice, "unavailable");
});

test("Stop responses cannot restore private data or drafts across an authorization change", async (t) => {
  const f = fixture(t); await approvedStopReview(f); f.panel.draftForTest = "Former actor private draft";
  f.render().buttons.find((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]).click();
  const cancel = await f.take(), decoding = deferred();
  cancel.gate.resolve({ ok: true, status: 200, json: async () => { await decoding.promise; return signedStopReceipt("completed"); } }); await tick();
  f.session.set({ ...f.session.get(), permissionEpoch: "new-authority-epoch" }); f.render();
  const currentRead = await f.take(); await f.reply(currentRead, { context: f.context, turns: [], tasks: [] });
  decoding.resolve(); await tick();
  assert.equal(f.host.snapshotForTest().specialist, null);
  assert.equal(f.panel.draftForTest, "");
  assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /Original paid result after stop|Former actor private draft/u);
  assert.equal(f.calls.filter((call) => call.url.pathname.endsWith("/cancel")).length, 1);
});


// R4 request-order regressions remain in place. R5 strengthens the pending case:
// dispatch establishes ordering, but only accepted exact evidence certifies privacy.
async function readOrderFixture(t, surface) {
  const f = fixture(t), canvas = surface === "Canvas";
  const original = { ...sampleTurn().originalRequest,
    ...(canvas ? { route: "/canvas/board-a/alpha", documentId: null, canvasId: "board-a", selectedItemIds: ["read-order-card"] } : {}) };
  if (canvas) {
    f.store.route.set("/canvas/board-a/alpha/view/compare"); f.select(original.selectedItemIds);
    f.context.surface = assistantSurfaceForRoute(f.store.route.get()); f.context.scope.documentId = null;
  }
  const turn = { ...sampleTurn(), originalRequest: original };
  const task = savedTask({ id: "approval-a", canExecute: false });
  const response = (completed = false) => {
    const result = specialistResponse(preview({ canvasId: original.canvasId, status: completed ? "completed" : "reserved", canExecute: false }),
      { task: { ...task, status: completed ? "completed" : "running", submission: completed ? "settled" : "submitting" },
        ...(completed ? { result: { reply: "Canonical exact result for " + surface, sourceStatus: "original-approved-source" } } : {}) });
    result.originalRequest = { ...result.originalRequest, route: original.route, selectedItemIds: original.selectedItemIds };
    return result;
  };
  const completion = response(true);
  const certificate = { ...completion.task, certifiedCompleted: true, completedReview: {
    turnId: completion.turnId, executionId: completion.executionId, quote: completion.quote,
    originalRequest: completion.originalRequest, result: completion.result,
  } };
  await f.open([turn], [task]);
  const opening = f.host.reviewForTest({ turnId: turn.id, task }), initial = await f.take();
  assert.equal(initial.body.action, "resume");
  await f.reply(initial, response()); await opening;
  f.panel.draftForTest = "Keep the unfinished " + surface + " question";
  const feed = async (tasks = [certificate]) => {
    const reading = f.host.loadForTest(), get = await f.take();
    assert.equal(get.body, null);
    await f.reply(get, { context: f.context, turns: [turn], tasks }); await reading;
  };
  const assertSafe = () => {
    assert.equal(f.panel.draftForTest, "Keep the unfinished " + surface + " question");
    for (const call of f.calls.filter((item) => item.body)) {
      assert.ok(["resume", "retrieve"].includes(call.body.action), "only deliberate free exact reads, never a purchase");
      assert.equal(call.body.turnId, turn.id); assert.equal(call.body.executionId, task.executionId);
      assert.equal(call.url.searchParams.get("route"), original.route);
      assert.deepEqual(call.url.searchParams.getAll("selected"), original.selectedItemIds);
      if (call.body.action === "retrieve") assert.equal(call.body.approvedBindingHash, task.bindingHash);
    }
  };
  return { ...f, turn, task, response, completion, certificate, feed, assertSafe };
}
// Typed HTTP-200 withdrawals retain the delayed-JSON race coverage. Exact
// HTTP-404/410 denials now withdraw at headers and are separately tested before
// any JSON decoder runs; a body pause must not postpone those negative proofs.
const readOrderDenials = [
  { kind: "missing-consent", stage: "headers", status: 404 },
  { kind: "missing-consent", stage: "headers", status: 410 },
  { kind: "missing-consent", stage: "json", status: 200 },
  { kind: "missing-result", stage: "headers", status: 200 },
  { kind: "missing-result", stage: "json", status: 200 },
  { kind: "read-denied", stage: "headers", status: 403 },
];
function readOrderDenial(f, kind) {
  return { turnId: f.turn.id, executionId: f.task.executionId,
    ...(kind === "missing-result" ? { retainedResultUnavailable: true, recoveryError: "assistant_result_unavailable" }
      : { retentionUnavailable: true, error: kind === "read-denied" ? "assistant_read_scope_denied" : "assistant_execution_unavailable" }) };
}
async function holdReadOrderDenial(f, call, variant, payload = readOrderDenial(f, variant.kind)) {
  const decoded = deferred();
  if (variant.stage === "json") {
    call.gate.resolve({ ok: variant.status < 400, status: variant.status,
      json: async () => { await decoded.promise; return payload; } }); await tick();
  }
  return async () => {
    if (variant.stage === "json") { decoded.resolve(); await tick(); }
    else if (variant.status === 403) {
      call.gate.resolve({ ok: false, status: 403, json: async () => { throw new Error("403 must be consumed without decoding private body"); } }); await tick();
    } else await f.reply(call, payload, variant.status);
  };
}
function assertReadOrderCompletion(f, id) {
  const state = f.host.snapshotForTest().specialist;
  assert.equal(state.id, id); assert.equal(state.executionId, f.task.executionId);
  assert.equal(state.quote.status, "completed"); assert.equal(state.quote.bindingHash, f.task.bindingHash);
  assert.equal(state.resultReply, f.completion.result.reply); assert.equal(state.notice, "");
  assert.equal(state.working, false); assert.equal(state.stopping, false);
  assert.equal(state.task.certifiedCompleted, true);
  assert.deepEqual(state.task.completedReview.result, f.completion.result);
}

for (const surface of ["Document", "Canvas"]) {
  test("read order " + surface + ": newer deliberate exact recertification survives an older API denial without a prior withdrawal", async (t) => {
    for (const variant of readOrderDenials) for (const oldAction of ["resume", "retrieve"]) for (const newAction of ["resume", "retrieve"]) {
      const f = await readOrderFixture(t, surface), id = f.host.snapshotForTest().specialist.id;
      const oldRead = f.host.requestForTest(oldAction), negative = await f.take();
      const release = await holdReadOrderDenial(f, negative, variant);
      await f.feed();
      assertReadOrderCompletion(f, id);
      // GET cleared busy, but only this successfully certified newer exact read
      // supersedes the older negative. No withdrawal has occurred in this fixture.
      const newRead = f.host.requestForTest(newAction), fresh = await f.take();
      await f.reply(fresh, f.completion); await newRead;
      const recertified = JSON.stringify(f.host.snapshotForTest());
      await release(); await oldRead;
      assert.equal(JSON.stringify(f.host.snapshotForTest()), recertified, variant.kind + "/" + variant.stage + "/" + oldAction + "→" + newAction);
      assertReadOrderCompletion(f, id); f.assertSafe();
    }
  });

  test("read order " + surface + ": newer deliberate exact recertification survives an older GET denial without a prior withdrawal", async (t) => {
    for (const stage of ["headers", "json"]) for (const action of ["resume", "retrieve"]) {
      const f = await readOrderFixture(t, surface), id = f.host.snapshotForTest().specialist.id;
      const oldRead = f.host.loadForTest(), negative = await f.take();
      const release = await holdReadOrderDenial(f, negative, { kind: "missing-consent", stage, status: 200 },
        { context: f.context, turns: [], tasks: [{ ...f.task, retentionUnavailable: true }] });
      const newRead = f.host.requestForTest(action), fresh = await f.take();
      await f.reply(fresh, f.completion); await newRead;
      const recertified = JSON.stringify(f.host.snapshotForTest());
      await release(); await oldRead;
      assert.equal(JSON.stringify(f.host.snapshotForTest()), recertified, stage + "/" + action);
      assertReadOrderCompletion(f, id); f.assertSafe();
    }
  });

  test("read order " + surface + ": incidental GET completion alone never hides an exact read denial", async (t) => {
    for (const variant of readOrderDenials) for (const action of ["resume", "retrieve"]) {
      const f = await readOrderFixture(t, surface), id = f.host.snapshotForTest().specialist.id;
      const reading = f.host.requestForTest(action), negative = await f.take();
      const release = await holdReadOrderDenial(f, negative, variant);
      await f.feed(); assertReadOrderCompletion(f, id);
      await release(); await reading;
      const state = f.host.snapshotForTest().specialist;
      assert.equal(state.quote, null); assert.equal(state.resultReply, null); assert.equal(state.notice, "unavailable");
      assert.equal(state.task.recoveryOnly, true); assert.equal(state.executionId, f.task.executionId);
      assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /Canonical exact result|Complete original source/u);
      if (variant.kind === "read-denied") {
        assert.equal(f.host.snapshotForTest().context, null); assert.equal(f.panel.draftForTest, "");
      } else f.assertSafe();
    }
  });

  test("read order " + surface + ": a later GET denial clears an earlier exact read even if the positive completes after GET dispatch", async (t) => {
    for (const stage of ["headers", "json"]) for (const action of ["resume", "retrieve"]) {
      const f = await readOrderFixture(t, surface);
      const olderPositive = f.host.requestForTest(action), positive = await f.take();
      const newerNegative = f.host.loadForTest(), negative = await f.take();
      const release = await holdReadOrderDenial(f, negative, { kind: "missing-consent", stage, status: 200 },
        { context: f.context, turns: [], tasks: [{ ...f.task, retentionUnavailable: true }] });
      await f.reply(positive, f.completion); await olderPositive;
      assert.equal(f.host.snapshotForTest().specialist.resultReply, f.completion.result.reply);
      await release(); await newerNegative;
      assert.equal(f.host.snapshotForTest().specialist.quote, null);
      assert.equal(f.host.snapshotForTest().specialist.resultReply, null);
      assert.equal(f.host.snapshotForTest().specialist.notice, "unavailable"); f.assertSafe();
    }
  });

  test("read order " + surface + ": completion of an earlier exact read does not supersede a later exact denial", async (t) => {
    for (const variant of readOrderDenials) {
      const f = await readOrderFixture(t, surface);
      const olderPositive = f.host.requestForTest("resume"), positive = await f.take();
      await f.feed();
      const newerNegative = f.host.requestForTest("retrieve"), negative = await f.take();
      const release = await holdReadOrderDenial(f, negative, variant);
      // This is only an arrival, not a new deliberate read boundary.
      await f.reply(positive, f.completion); await olderPositive;
      assert.equal(f.host.snapshotForTest().specialist.resultReply, f.completion.result.reply);
      await release(); await newerNegative;
      assert.equal(f.host.snapshotForTest().specialist.quote, null);
      assert.equal(f.host.snapshotForTest().specialist.resultReply, null);
      assert.equal(f.host.snapshotForTest().specialist.notice, "unavailable");
      if (variant.kind !== "read-denied") f.assertSafe();
    }
  });

  test("read order " + surface + ": a newer current negative still invalidates an already-started positive read", async (t) => {
    const f = await readOrderFixture(t, surface);
    const reading = f.host.requestForTest("retrieve"), positive = await f.take(), decoded = deferred();
    positive.gate.resolve({ ok: true, status: 200, json: async () => { await decoded.promise; return f.completion; } }); await tick();
    await f.feed([{ ...f.task, retentionUnavailable: true }]);
    assert.equal(f.host.snapshotForTest().specialist.notice, "unavailable");
    decoded.resolve(); await reading;
    assert.equal(f.host.snapshotForTest().specialist.quote, null);
    assert.equal(f.host.snapshotForTest().specialist.resultReply, null);
    assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /Canonical exact result|Complete original source/u);
    f.assertSafe();
  });
}


for (const surface of ["Document", "Canvas"]) {
  test("read order " + surface + ": an older denial hides private bytes without replacing the pending exact read", async (t) => {
    for (const endpoint of ["api", "get"]) {
      const f = await readOrderFixture(t, surface);
      const older = endpoint === "api" ? f.host.requestForTest("resume") : f.host.loadForTest(), negative = await f.take();
      const release = await holdReadOrderDenial(f, negative, { kind: "missing-consent", stage: "json", status: 200 },
        endpoint === "api" ? readOrderDenial(f, "missing-consent")
          : { context: f.context, turns: [], tasks: [{ ...f.task, retentionUnavailable: true }] });
      if (endpoint === "api") await f.feed();
      const newer = f.host.requestForTest("retrieve"), positive = await f.take();
      const pending = f.host.snapshotForTest().specialist;
      assert.equal(pending.working, true);
      await release(); await older;
      const hidden = f.host.snapshotForTest().specialist;
      assert.equal(hidden.id, pending.id); assert.equal(hidden.scope, pending.scope);
      assert.equal(hidden.turnId, pending.turnId); assert.equal(hidden.executionId, pending.executionId);
      assert.equal(hidden.working, true); assert.equal(hidden.stopping, false);
      assert.equal(hidden.quote, null); assert.equal(hidden.originalRequest, null); assert.equal(hidden.resultReply, null);
      assert.equal(hidden.task.bindingHash, f.task.bindingHash); assert.equal(hidden.task.recoveryOnly, true);
      assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /Canonical exact result|Complete original source/u);
      assert.equal(f.panel.draftForTest, "Keep the unfinished " + surface + " question");
      await f.reply(positive, f.completion); await newer;
      assertReadOrderCompletion(f, f.host.snapshotForTest().specialist.id); f.assertSafe();
    }
  });

  test("read order " + surface + ": deliberate refresh of another exact target does not suppress this target's GET denial", async (t) => {
    const f = await readOrderFixture(t, surface);
    const otherTurn = { ...sampleTurn("turn-b", "Another saved request"), originalRequest: { ...f.turn.originalRequest, turnId: "turn-b" } };
    const otherTask = savedTask({ id: "approval-b", executionId: "approval-b", bindingHash: "hash-b", turnId: "turn-b", canExecute: false });
    const otherQuote = { ...f.completion.quote, executionId: "approval-b", bindingHash: "hash-b", privateInput: { original: "Other exact source" } };
    const otherResponse = { ...f.completion, turnId: "turn-b", executionId: "approval-b", quote: otherQuote,
      originalRequest: { ...f.completion.originalRequest, turnId: "turn-b", conversationTurnIds: ["turn-b"] },
      task: { ...otherTask, status: "completed", submission: "settled" },
      result: { reply: "Other exact canonical result", sourceStatus: "original-approved-source" } };
    const listing = f.host.loadForTest(), populated = await f.take();
    await f.reply(populated, { context: f.context, turns: [f.turn, otherTurn], tasks: [f.certificate, otherTask] }); await listing;
    const older = f.host.loadForTest(), negative = await f.take();
    const release = await holdReadOrderDenial(f, negative, { kind: "missing-consent", stage: "json", status: 200 },
      { context: f.context, turns: [], tasks: [{ ...f.task, retentionUnavailable: true }] });
    const refreshingOther = f.host.reviewForTest({ turnId: "turn-b", task: otherTask }), otherRead = await f.take();
    assert.equal(otherRead.body.action, "resume"); assert.equal(otherRead.body.executionId, "approval-b");
    await f.reply(otherRead, otherResponse); await refreshingOther;
    await release(); await older;
    const state = f.host.snapshotForTest();
    assert.equal(state.specialist.executionId, "approval-b"); assert.equal(state.specialist.resultReply, otherResponse.result.reply);
    assert.equal(state.tasks.find((task) => task.executionId === "approval-a").recoveryOnly, true);
    assert.equal(state.turns.some((turn) => turn.id === "turn-a"), false);
    assert.doesNotMatch(JSON.stringify(state), /Canonical exact result|Complete original source/u);
    assert.ok(f.calls.filter((call) => call.body).every((call) => ["resume", "retrieve"].includes(call.body.action)));
    assert.equal(f.panel.draftForTest, "Keep the unfinished " + surface + " question");
  });

  test("read order " + surface + ": scope-level authorization denial is never bypassed by a newer per-execution refresh", async (t) => {
    for (const variant of [{ endpoint: "get", status: 403 }, { endpoint: "get", status: 401 }, { endpoint: "api", status: 401 }]) {
      const f = await readOrderFixture(t, surface);
      const older = variant.endpoint === "get" ? f.host.loadForTest() : f.host.requestForTest("resume"), negative = await f.take();
      if (variant.endpoint === "api") await f.feed();
      const deliberate = f.host.requestForTest("retrieve"), exact = await f.take();
      await f.reply(exact, f.completion); await deliberate;
      assert.equal(f.host.snapshotForTest().specialist.resultReply, f.completion.result.reply);
      negative.gate.resolve({ ok: false, status: variant.status,
        json: async () => { throw new Error("scope denial must clear before reading response bytes"); } }); await older;
      const state = f.host.snapshotForTest();
      assert.equal(state.specialist, null); assert.equal(state.context, null); assert.deepEqual(state.tasks, []);
      assert.doesNotMatch(JSON.stringify(state), /Canonical exact result|Complete original source/u);
      assert.equal(f.panel.draftForTest, "");
    }
  });
}


for (const surface of ["Document", "Canvas"]) test("pending proof audit " + surface + ": an old exact 403 hides incidental private completion until the newer resume actually certifies it", async (t) => {
  const f = await readOrderFixture(t, surface), id = f.host.snapshotForTest().specialist.id;
  const oldRead = f.host.requestForTest("resume"), denied = await f.take();
  const release = await holdReadOrderDenial(f, denied, { kind: "read-denied", stage: "headers", status: 403 });
  await f.feed(); assertReadOrderCompletion(f, id);
  const newerRead = f.host.requestForTest("resume"), fresh = await f.take();
  assert.equal(fresh.body.executionId, f.task.executionId);
  const pending = f.host.snapshotForTest().specialist;
  assert.equal(pending.working, true);
  await release(); await oldRead;
  const hidden = f.host.snapshotForTest().specialist;
  assert.equal(hidden.quote, null, "starting a read is not a successful privacy certificate");
  assert.equal(hidden.resultReply, null);
  assert.equal(hidden.originalRequest, null);
  assert.equal(hidden.id, pending.id); assert.equal(hidden.executionId, pending.executionId);
  assert.equal(hidden.working, true, "the fresh pending exact read is not cancelled by hiding private presentation");
  assert.equal(hidden.stopping, false);
  assert.doesNotMatch(f.render().markup, /Canonical exact result|Complete original source/u);
  assert.equal(f.panel.draftForTest, "Keep the unfinished " + surface + " question");
  await f.reply(fresh, f.completion); await newerRead;
  assertReadOrderCompletion(f, id); f.assertSafe();
});


function assertPendingProofHidden(f, pending) {
  const state = f.host.snapshotForTest(), hidden = state.specialist;
  assert.equal(hidden.id, pending.id); assert.equal(hidden.scope, pending.scope);
  assert.equal(hidden.turnId, pending.turnId); assert.equal(hidden.executionId, pending.executionId);
  assert.equal(hidden.task.executionId, pending.executionId); assert.equal(hidden.task.bindingHash, f.task.bindingHash);
  assert.equal(hidden.working, true); assert.equal(hidden.stopping, false);
  assert.equal(hidden.quote, null); assert.equal(hidden.originalRequest, null); assert.equal(hidden.resultReply, null);
  assert.equal(hidden.task.recoveryOnly, true);
  assert.doesNotMatch(JSON.stringify(state), /Canonical exact result|Complete original source/u);
  const rendered = f.render();
  assert.doesNotMatch(rendered.markup, /Canonical exact result|Complete original source/u);
  assert.ok(!rendered.buttons.some((button) => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.stop"]));
  assert.equal(f.panel.draftForTest, "Keep the unfinished " + f.surface + " question");
}
async function pendingProofFixture(t, surface, options = {}) {
  const f = await readOrderFixture(t, surface); f.surface = surface;
  const variant = options.denial ?? { endpoint: "api", kind: "read-denied", stage: "headers", status: 403, action: "resume" };
  const oldRead = variant.endpoint === "get" ? f.host.loadForTest() : f.host.requestForTest(variant.action ?? "resume"), negative = await f.take();
  const payload = variant.endpoint === "get"
    ? { context: f.context, turns: [f.turn], tasks: [{ ...f.task, ...(variant.kind === "missing-result" ? { retainedResultUnavailable: true } : { retentionUnavailable: true }) }] }
    : readOrderDenial(f, variant.kind);
  const releaseOld = await holdReadOrderDenial(f, negative, variant, payload);
  await f.feed();
  const freshRead = f.host.requestForTest(options.action ?? "resume"), fresh = await f.take();
  const pending = f.host.snapshotForTest().specialist;
  return { ...f, fresh, freshRead, pending, async denyOlder() { await releaseOld(); await oldRead; } };
}

for (const surface of ["Document", "Canvas"]) {
  test("pending proof " + surface + ": every older per-execution denial hides private presentation until the exact newer response finishes validation", async (t) => {
    const negatives = [
      ...readOrderDenials.flatMap((variant) => ["resume", "retrieve"].map((action) => ({ ...variant, endpoint: "api", action }))),
      ...["headers", "json"].flatMap((stage) => ["missing-consent", "missing-result"].map((kind) => ({ endpoint: "get", stage, kind, status: 200 }))),
    ];
    for (const denial of negatives) for (const action of ["resume", "retrieve"]) for (const stage of ["headers", "json"]) {
      const f = await pendingProofFixture(t, surface, { denial, action }), decoded = deferred();
      if (stage === "json") {
        f.fresh.gate.resolve({ ok: true, status: 200, json: async () => { await decoded.promise; return f.completion; } }); await tick();
      }
      await f.denyOlder(); assertPendingProofHidden(f, f.pending);
      // A later incidental feed still is not successful completion of the newer
      // user-directed read and cannot leak the previous private receipt again.
      await f.feed(); assertPendingProofHidden(f, f.pending);
      if (stage === "json") { decoded.resolve(); await tick(); }
      else await f.reply(f.fresh, f.completion);
      await f.freshRead; assertReadOrderCompletion(f, f.pending.id); f.assertSafe();
    }
  });

  test("pending proof " + surface + ": a completion feed after the newer read starts cannot make that pending read unresolvable", async (t) => {
    const f = await pendingProofFixture(t, surface);
    await f.feed(); assert.equal(f.host.snapshotForTest().specialist.working, false, "the incidental terminal feed is the existing lifecycle boundary");
    await f.denyOlder(); assertPendingProofHidden(f, f.pending);
    await f.reply(f.fresh, f.completion); await f.freshRead;
    assertReadOrderCompletion(f, f.pending.id); f.assertSafe();
  });

  test("pending proof " + surface + ": failed or invalid fresh reads never restore private bytes captured before the older denial", async (t) => {
    for (const outcome of ["transport", "json", "identity", "http", "missing-consent", "missing-result"]) {
      const f = await pendingProofFixture(t, surface); await f.feed(); await f.denyOlder();
      assertPendingProofHidden(f, f.pending);
      if (outcome === "transport") await f.reject(f.fresh);
      else if (outcome === "json") {
        f.fresh.gate.resolve({ ok: true, status: 200, json: async () => { throw new Error("Truncated fresh response"); } }); await tick();
      } else if (outcome === "identity") await f.reply(f.fresh, { ...f.completion, executionId: "different-private-execution" });
      else if (outcome === "http") await f.reply(f.fresh, { ...f.completion, error: "temporarily_unavailable" }, 503);
      else await f.reply(f.fresh, readOrderDenial(f, outcome), outcome === "missing-consent" ? 404 : 200);
      await f.freshRead;
      let state = f.host.snapshotForTest().specialist;
      assert.equal(state.id, f.pending.id); assert.equal(state.executionId, f.task.executionId);
      assert.equal(state.working, false); assert.equal(state.stopping, false);
      assert.equal(state.quote, null); assert.equal(state.originalRequest, null); assert.equal(state.resultReply, null);
      assert.equal(state.task.bindingHash, f.task.bindingHash);
      await f.feed();
      assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /Canonical exact result|Complete original source/u);
      assert.doesNotMatch(f.render().markup, /Canonical exact result|Complete original source/u);
      assert.equal(f.panel.draftForTest, "Keep the unfinished " + surface + " question");
      const retry = f.host.requestForTest("retrieve"), exact = await f.take();
      assert.equal(exact.body.executionId, f.task.executionId); assert.equal(exact.body.approvedBindingHash, f.task.bindingHash);
      await f.reply(exact, f.completion); await retry;
      assertReadOrderCompletion(f, f.pending.id); f.assertSafe();
    }
  });

  test("pending proof " + surface + ": a fresh pending receipt can restore only its newly certified contract, not the old completed result", async (t) => {
    const f = await pendingProofFixture(t, surface); await f.denyOlder(); assertPendingProofHidden(f, f.pending);
    const currentReceipt = f.response();
    currentReceipt.quote.privateInput = { original: "Freshly re-read original contract" };
    await f.reply(f.fresh, currentReceipt); await f.freshRead;
    const state = f.host.snapshotForTest().specialist;
    assert.equal(state.id, f.pending.id); assert.equal(state.executionId, f.task.executionId);
    assert.equal(state.quote.status, "reserved"); assert.equal(state.quote.privateInput.original, "Freshly re-read original contract");
    assert.equal(state.task.status, "running"); assert.equal(state.resultReply, null); assert.equal(state.working, false);
    assert.doesNotMatch(f.render().markup, /Canonical exact result|Complete original source/u); f.assertSafe();
  });

  test("pending proof " + surface + ": inherited incidental completion is not new exact-result certification", async (t) => {
    const f = await pendingProofFixture(t, surface);
    await f.reply(f.fresh, f.response()); await f.freshRead;
    assertReadOrderCompletion(f, f.pending.id);
    await f.denyOlder();
    const state = f.host.snapshotForTest().specialist;
    assert.equal(state.quote, null); assert.equal(state.resultReply, null); assert.equal(state.working, false);
    assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /Canonical exact result|Complete original source/u);
    assert.equal(f.panel.draftForTest, "", "a current read-scope denial still clears a draft when no newer pending read remains");
  });

  test("pending proof " + surface + ": a current scope denial from the newer lookup still clears private state and manual drafts", async (t) => {
    for (const status of [401, 403]) {
      const f = await pendingProofFixture(t, surface); await f.denyOlder(); assertPendingProofHidden(f, f.pending);
      f.fresh.gate.resolve({ ok: false, status, json: async () => { throw new Error("Scope denial must be consumed before private body decoding"); } });
      await f.freshRead;
      const state = f.host.snapshotForTest();
      assert.equal(state.context, null); assert.equal(f.panel.draftForTest, "");
      assert.doesNotMatch(JSON.stringify(state), /Canonical exact result|Complete original source/u);
      if (status === 401) assert.equal(state.specialist, null);
      else { assert.equal(state.specialist.working, false); assert.equal(state.specialist.quote, null); assert.equal(state.specialist.resultReply, null); }
      assert.ok(f.calls.filter((call) => call.body).every((call) => ["resume", "retrieve"].includes(call.body.action)));
    }
  });
}

function recoveryR2Control(f, action, overrides = {}) {
  const state = f.host.snapshotForTest().specialist;
  return { action: action ?? (state.retrievalOnly || !state.quote || state.quote.status !== "quoted"
      ? state.quote?.bindingHash || state.task?.bindingHash ? "retrieve" : "resume" : "approve"),
    reviewId: state.id, turnId: state.turnId, executionId: state.executionId,
    bindingHash: state.quote?.bindingHash ?? state.task?.bindingHash ?? "", ...overrides };
}
function recoveryR2Surface(t, surface, locale = "en", canonicalHash = false) {
  const f = fixture(t, locale), canvas = surface === "Canvas";
  const route = canvas ? "/canvas/board-a/alpha" : "/document/doc-a/alpha";
  const selection = canvas ? ["exact-original-card"] : [];
  if (canvas) { f.store.route.set(route + "/view/compare"); f.select(selection); f.context.surface = assistantSurfaceForRoute(f.store.route.get()); f.context.scope.documentId = null; }
  const turn = (id = "turn-a") => ({ ...sampleTurn(id), originalRequest: {
    ...sampleTurn(id).originalRequest, route, selectedItemIds: selection, documentId: canvas ? null : "doc-a", canvasId: canvas ? "board-a" : null, locale } });
  const response = (id = "turn-a", quoteValues = {}, values = {}) => {
    const suffix = id.slice("turn-".length), quote = preview({ executionId: "approval-" + suffix, bindingHash: canonicalHash ? suffix.repeat(64) : "hash-" + suffix, canvasId: canvas ? "board-a" : null, ...quoteValues });
    const result = specialistResponse(quote, { turnId: id, ...values });
    result.originalRequest = { ...result.originalRequest, turnId: id, route, selectedItemIds: selection, locale, conversationTurnIds: [id] };
    return result;
  };
  return { ...f, turn, response, route, selection };
}

for (const surface of ["Document", "Canvas"]) for (const locale of ["en", "fr", "ar", "ja"]) {
  test("host R2 " + surface + "/" + locale + ": captured A controls cannot act on B before or after new panel props", async (t) => {
    for (const action of ["approve", "run-approved", "retrieve", "resume"]) for (const rerender of [false, true]) {
      const f = recoveryR2Surface(t, surface, locale), catalog = ASSISTANT_MESSAGES[locale];
      const task = savedTask({ id: "approval-a", ...(action === "resume" ? { bindingHash: undefined, status: "recovery", recoveryOnly: true, submission: undefined }
        : action === "run-approved" ? { status: "queued", submission: "not-submitted", canExecute: true } : {}) });
      await f.open([f.turn(), f.turn("turn-b")], action === "approve" ? [] : [task]);
      const opening = f.host.reviewForTest({ turnId: "turn-a", ...(action === "approve" ? {} : { task }) }), original = await f.take();
      if (action === "resume") await f.reply(original, { error: "temporary_read_failure" }, 503);
      else await f.reply(original, f.response("turn-a", action === "approve" ? {} : { status: "reserved" }, action === "approve" ? {} : { task }));
      await opening;
      const captured = recoveryR2Control(f, action), controls = f.render();
      const label = catalog[action === "approve" ? "assistant.specialist.approve" : action === "run-approved" ? "assistant.specialist.runApproved" : "assistant.specialist.retrieve"];
      const button = controls.buttons.find((item) => item.label === label && !item.attrs.includes("data-assistant-recovery"));
      assert.ok(button && !button.disabled, action + " was a real enabled original control");
      f.host.closeReviewForTest(); const feed = await f.take();
      await f.reply(feed, { context: f.context, turns: [f.turn(), f.turn("turn-b")], tasks: action === "approve" ? [] : [task] });
      const openingB = f.host.reviewForTest({ turnId: "turn-b" }), quoteB = await f.take();
      await f.reply(quoteB, f.response("turn-b")); await openingB;
      if (rerender) f.render();
      const before = f.calls.length;
      button.click(); await tick();
      assert.equal(f.calls.length, before, "captured " + action + " cannot become B execute or any B request");
      await f.host.actionForTest(captured);
      assert.equal(f.calls.length, before, "host independently refuses the stale tuple even if an event is delivered");
      assert.equal(f.host.snapshotForTest().specialist.executionId, "approval-b");
      f.render();
      f.host.actionForTest(recoveryR2Control(f, "approve"));
      const approved = await f.take();
      assert.deepEqual(approved.body, { action: "execute", turnId: "turn-b", executionId: "approval-b", approvedBindingHash: "hash-b" });
      await f.reply(approved, f.response("turn-b", { status: "reserved", canExecute: false }, { task: savedTask({
        id: "approval-b", turnId: "turn-b", executionId: "approval-b", bindingHash: "hash-b",
      }) }));
      assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1);
    }
  });

  test("host R2 " + surface + "/" + locale + ": free semantic retrieve never becomes approval of its same quoted identity", async (t) => {
    const f = recoveryR2Surface(t, surface, locale); await f.open([f.turn()]);
    const opening = f.host.reviewForTest({ turnId: "turn-a" }), quote = await f.take();
    await f.reply(quote, f.response()); await opening;
    const reading = f.host.actionForTest(recoveryR2Control(f, "retrieve")), exact = await f.take();
    assert.deepEqual(exact.body, { action: "retrieve", turnId: "turn-a", executionId: "approval-a", approvedBindingHash: "hash-a" });
    await f.reply(exact, f.response("turn-a", { canExecute: false }, { unusedExecution: true })); await reading;
    assert.equal(f.calls.some((call) => call.body?.action === "execute"), false);
  });
}

for (const surface of ["Document", "Canvas"]) {
  test("host R2 " + surface + ": only exact typed unused proof permits an explicit free refresh and separate approval", async (t) => {
    for (const failure of ["lost-before-worker", "provider-unavailable", "source-changed"]) {
      const f = recoveryR2Surface(t, surface); await f.open([f.turn()]);
      const opening = f.host.reviewForTest({ turnId: "turn-a" }), quote = await f.take();
      await f.reply(quote, f.response()); await opening; f.render(); f.panel.draftForTest = "Keep my unused request draft";
      const executing = f.host.requestForTest("execute"), execute = await f.take();
      if (failure === "lost-before-worker") await f.reject(execute);
      else await f.reply(execute, { error: failure === "provider-unavailable" ? "assistant_provider_unavailable" : "assistant_consent_source_changed" }, failure === "provider-unavailable" ? 503 : 409);
      await executing;
      const resuming = f.host.requestForTest("resume"), resume = await f.take();
      await f.reply(resume, f.response("turn-a", { canExecute: false }, { unusedExecution: true })); await resuming;
      const unused = f.host.snapshotForTest().specialist;
      assert.equal(unused.unusedExecution, true); assert.equal(unused.retrievalOnly, true); assert.equal(unused.task, null);
      const before = f.calls.length; await f.host.requestForTest("execute"); await f.host.runApprovedForTest();
      assert.equal(f.calls.length, before, "the proof is not purchase permission");
      const refreshing = f.host.actionForTest(recoveryR2Control(f, "quote", { model: "gpt-5.6-luna" })), fresh = await f.take();
      assert.deepEqual(fresh.body, { action: "quote", turnId: "turn-a", model: "gpt-5.6-luna" });
      assert.equal(fresh.url.searchParams.get("route"), f.route); assert.deepEqual(fresh.url.searchParams.getAll("selected"), f.selection);
      await f.reply(fresh, f.response("turn-a", { executionId: "fresh-approved-source", bindingHash: "fresh-hash", sourceHash: "changed-current-source" })); await refreshing;
      const updated = f.host.snapshotForTest().specialist;
      assert.equal(updated.retrievalOnly, false); assert.equal(updated.quote.sourceHash, "changed-current-source");
      assert.equal(updated.executionId, "fresh-approved-source"); assert.equal(updated.unusedExecution, false);
      assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1, "free refresh does not autoapprove");
      const approval = f.host.actionForTest(recoveryR2Control(f, "approve")), paid = await f.take();
      assert.deepEqual(paid.body, { action: "execute", turnId: "turn-a", executionId: "fresh-approved-source", approvedBindingHash: "fresh-hash" });
      await f.reply(paid, f.response("turn-a", { executionId: "fresh-approved-source", bindingHash: "fresh-hash", sourceHash: "changed-current-source", status: "reserved", canExecute: false },
        { task: savedTask({ id: "fresh-approved-source", executionId: "fresh-approved-source", bindingHash: "fresh-hash" }) })); await approval;
      assert.equal(f.panel.draftForTest, "Keep my unused request draft");
    }
  });

  test("host R2 " + surface + ": identical terminal feed does not discard its in-flight exact review", async (t) => {
    for (const status of ["needs-review", "canceled", "failed", "reconciled"]) {
      const f = recoveryR2Surface(t, surface), task = savedTask({ id: "approval-a", status, submission: "uncertain", canExecute: false });
      await f.open([f.turn()], [task]);
      const opening = f.host.reviewForTest({ turnId: "turn-a", task }), exact = await f.take();
      const loading = f.host.loadForTest(), feed = await f.take();
      await f.reply(feed, { context: f.context, turns: [f.turn()], tasks: [{ ...task, error: "Different untrusted diagnostic text" }] }); await loading;
      assert.equal(f.host.snapshotForTest().specialist.working, true, "same lifecycle/accounting tuple is not newer evidence");
      await f.reply(exact, f.response("turn-a", { status: "uncertain", canExecute: false }, { task })); await opening;
      const state = f.host.snapshotForTest().specialist;
      assert.equal(state.working, false); assert.equal(state.quote.bindingHash, "hash-a"); assert.equal(state.task.status, status);
      assert.equal(f.calls.some((call) => call.body?.action === "execute" || call.body?.action === "quote"), false);
    }
  });

  test("host R2 " + surface + ": a failed exact lookup preserves certified completion and settlement without claiming a new read", async (t) => {
    for (const failure of ["transport", "503-json", "503-html", "200-truncated"]) {
      const f = await readOrderFixture(t, surface);
      const reading = f.host.requestForTest("retrieve"), initial = await f.take();
      await f.reply(initial, f.completion); await reading;
      const previous = f.host.snapshotForTest().specialist;
      const checking = f.host.requestForTest("resume"), failed = await f.take();
      if (failure === "transport") await f.reject(failed);
      else if (failure === "503-json") await f.reply(failed, { error: "unavailable" }, 503);
      else { failed.gate.resolve({ ok: failure === "200-truncated", status: failure === "200-truncated" ? 200 : 503,
        json: async () => { throw new Error("No complete JSON"); } }); await tick(); }
      await checking;
      const state = f.host.snapshotForTest().specialist;
      assert.equal(state.notice, "lookupFailed"); assert.equal(state.quote.status, "completed");
      assert.equal(state.task.submission, "settled"); assert.equal(state.task.certifiedCompleted, true);
      assert.deepEqual(state.task.completedReview, previous.task.completedReview);
      assert.equal(state.resultReply, previous.resultReply); assert.equal(state.quote.canExecute, false);
      assert.equal(state.working, false); f.assertSafe();
      const revoked = f.host.requestForTest("retrieve"), denied = await f.take();
      await f.reply(denied, { retentionUnavailable: true }, 404); await revoked;
      assert.equal(f.host.snapshotForTest().specialist.quote, null); assert.equal(f.host.snapshotForTest().specialist.resultReply, null);
    }
  });

  test("host R2 " + surface + ": requested Sol preview adopts an already-admitted signed Luna winner read-only", async (t) => {
    const f = recoveryR2Surface(t, surface); await f.open([f.turn()]);
    const opening = f.host.reviewForTest({ turnId: "turn-a" }), initial = await f.take();
    await f.reply(initial, f.response()); await opening;
    const changing = f.host.requestForTest("quote", "gpt-5.6-sol"), quote = await f.take();
    const receipt = f.response("turn-a", { status: "completed", canExecute: false, period: "2026-07" }, {
      reused: true, task: savedTask({ id: "approval-a", status: "completed", submission: "settled", canExecute: false }),
      result: { sourceStatus: "original-approved-source", reply: "Original paid Luna result, not the requested Sol purchase" },
    });
    await f.reply(quote, receipt); await changing;
    const state = f.host.snapshotForTest().specialist;
    assert.equal(state.quote.models[0], "gpt-5.6-luna"); assert.equal(state.quote.period, "2026-07");
    assert.equal(state.resultReply, receipt.result.reply); assert.equal(state.retrievalOnly, true); assert.equal(state.task.certifiedCompleted, true);
    assert.equal(state.notice, "redirected");
    const before = f.calls.length; await f.host.requestForTest("execute"); await f.host.runApprovedForTest();
    assert.equal(f.calls.length, before);
    const recovering = f.host.actionForTest(recoveryR2Control(f, "retrieve")), exact = await f.take();
    assert.equal(exact.body.action, "retrieve"); assert.equal(exact.body.executionId, "approval-a");
    await f.reply(exact, receipt); await recovering;
    assert.equal(f.calls.some((call) => call.body?.action === "execute"), false);
  });

  test("host R2 " + surface + ": exact 404 and 410 privacy denials scrub before body decoding", async (t) => {
    for (const action of ["resume", "retrieve", "stop"]) for (const status of [404, 410]) {
      const f = await readOrderFixture(t, surface);
      if (action !== "stop") {
        const receipt = f.host.requestForTest("retrieve"), completed = await f.take();
        await f.reply(completed, f.completion); await receipt;
      }
      const reading = f.host.requestForTest(action), denial = await f.take();
      let decoded = false;
      denial.gate.resolve({ ok: false, status, json: async () => { decoded = true; throw new Error("non-JSON privacy denial"); } });
      await reading;
      assert.equal(decoded, false); assert.equal(f.host.snapshotForTest().specialist.quote, null);
      assert.equal(f.host.snapshotForTest().specialist.originalRequest, null); assert.equal(f.host.snapshotForTest().specialist.resultReply, null);
      assert.equal(f.host.snapshotForTest().specialist.notice, "unavailable");
      assert.equal(f.host.snapshotForTest().specialist.executionId, "approval-a");
      assert.equal(f.panel.draftForTest, "Keep the unfinished " + surface + " question", "retention failure is not a global authoring denial");
    }
  });
}

for (const surface of ["Document", "Canvas"]) {
  test("host R2 " + surface + ": unused recovery survives close, filtered feeds and lost free refresh using identity only", async (t) => {
    const f = recoveryR2Surface(t, surface); await f.open([f.turn()]);
    const opening = f.host.reviewForTest({ turnId: "turn-a" }), quote = await f.take(); await f.reply(quote, f.response()); await opening;
    const executing = f.host.requestForTest("execute"), execute = await f.take(); await f.reject(execute); await executing;
    const checking = f.host.requestForTest("resume"), unused = await f.take();
    await f.reply(unused, f.response("turn-a", { canExecute: false }, { unusedExecution: true })); await checking;
    f.host.closeReviewForTest(); const omitted = await f.take();
    await f.reply(omitted, { context: f.context, turns: [], tasks: [] });
    const reference = f.host.snapshotForTest().tasks[0];
    assert.deepEqual(Object.keys(reference).sort(), ["bindingHash", "executionId", "id", "recoveryOnly", "status", "turnId"]);
    const reopening = f.host.reviewForTest({ turnId: reference.turnId, task: reference }), exact = await f.take();
    assert.deepEqual(exact.body, { action: "resume", turnId: "turn-a", executionId: "approval-a" });
    assert.notEqual(f.host.snapshotForTest().specialist.unusedExecution, true, "a content-free handle is not a current unused proof");
    await f.reply(exact, f.response("turn-a", { canExecute: false }, { unusedExecution: true })); await reopening;
    const before = f.calls.length;
    await f.host.actionForTest(recoveryR2Control(f, "approve"));
    await f.host.actionForTest(recoveryR2Control(f, "run-approved"));
    await f.host.actionForTest(recoveryR2Control(f, "quote", { model: "gpt-5.6-sol" }));
    assert.equal(f.calls.length, before, "unused proof cannot approve or choose a different model");
    const refreshing = f.host.actionForTest(recoveryR2Control(f, "quote")), fresh = await f.take();
    assert.equal(fresh.body.model, "gpt-5.6-luna");
    assert.equal(fresh.url.searchParams.get("route"), f.route, "resolved original route survives omitted saved turns");
    assert.deepEqual(fresh.url.searchParams.getAll("selected"), f.selection);
    await f.reject(fresh); await refreshing;
    const failed = f.host.snapshotForTest().specialist;
    assert.equal(failed.executionId, "approval-a"); assert.equal(failed.quote, null);
    assert.equal(failed.originalRequest, null); assert.equal(failed.resultReply, null); assert.notEqual(failed.unusedExecution, true);
    assert.equal(failed.task.recoveryOnly, true); assert.equal(failed.task.bindingHash, "hash-a");
    f.host.closeReviewForTest(); const closed = await f.take(); await f.reply(closed, { context: f.context, turns: [], tasks: [] });
    const known = f.host.snapshotForTest().tasks[0];
    const retrying = f.host.reviewForTest({ turnId: known.turnId, task: known }), retried = await f.take();
    assert.deepEqual(retried.body, exact.body);
    await f.reply(retried, f.response("turn-a", { canExecute: false }, { unusedExecution: true })); await retrying;
    assert.equal(f.host.snapshotForTest().specialist.unusedExecution, true);
    assert.equal(f.calls.filter((call) => call.body?.action === "quote").length, 2, "reopen never makes a new preview automatically");
    assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, 1, "lost original attempt remains the only attempted execution");
  });

  test("host R2 " + surface + ": no status, missing task, malformed marker or denied read substitutes for an exact unused proof", async (t) => {
    const variants = [
      { change: (p) => { delete p.unusedExecution; } },
      { change: (p) => { p.unusedExecution = "true"; } },
      { change: (p) => { p.task = savedTask({ id: "approval-a", status: "queued", submission: "not-submitted" }); } },
      { change: (p) => { p.quote.status = "uncertain"; } },
      { change: (p) => { p.quote.canExecute = true; } },
      { change: (p) => { p.quote.bindingHash = "different-original-hash"; } },
      { change: (p) => { p.result = { sourceStatus: "original-approved-source", reply: "Not an unused response" }; } },
      { change: (p) => { p.error = "lookup_unavailable"; }, status: 503 },
    ];
    for (const variant of variants) {
      const f = recoveryR2Surface(t, surface), reference = savedTask({ id: "approval-a", status: "recovery", recoveryOnly: true, submission: undefined });
      await f.open([f.turn()], [reference]);
      const opening = f.host.reviewForTest({ turnId: "turn-a", task: reference }), exact = await f.take();
      const payload = f.response("turn-a", { canExecute: false }, { unusedExecution: true }); variant.change(payload);
      await f.reply(exact, payload, variant.status ?? 200); await opening;
      const state = f.host.snapshotForTest().specialist;
      assert.notEqual(state.unusedExecution, true);
      const before = f.calls.length;
      await f.host.actionForTest(recoveryR2Control(f, "quote", { model: "gpt-5.6-luna" }));
      await f.host.actionForTest(recoveryR2Control(f, "approve"));
      assert.equal(f.calls.length, before);
      assert.equal(f.calls.some((call) => call.body?.action === "quote" || call.body?.action === "execute"), false);
    }
  });

  test("host R2 " + surface + ": model-mismatched fresh or unsigned reuse cannot certify a specialist winner", async (t) => {
    for (const change of [
      (p) => { delete p.reused; },
      (p) => { p.reused = false; },
      (p) => { p.task.id = "unsigned-legacy-task"; },
      (p) => { p.task.bindingHash = "wrong-binding"; },
      (p) => { p.task.recoveryOnly = true; },
      (p) => { p.originalRequest.route += "/different-original"; },
      (p) => { p.originalRequest.selectedItemIds = ["different-card"]; },
      (p) => { p.task.turnId = "turn-b"; },
    ]) {
      const f = recoveryR2Surface(t, surface); await f.open([f.turn()]);
      const opening = f.host.reviewForTest({ turnId: "turn-a" }), initial = await f.take(); await f.reply(initial, f.response()); await opening;
      const changing = f.host.requestForTest("quote", "gpt-5.6-sol"), quote = await f.take();
      const receipt = f.response("turn-a", { status: "completed", canExecute: false }, { reused: true,
        task: savedTask({ id: "approval-a", status: "completed", submission: "settled" }),
        result: { sourceStatus: "original-approved-source", reply: "UNVERIFIED-WINNER" } });
      change(receipt); await f.reply(quote, receipt); await changing;
      assert.equal(f.host.snapshotForTest().specialist.notice, "failed");
      assert.doesNotMatch(JSON.stringify(f.host.snapshotForTest()), /UNVERIFIED-WINNER/u);
      assert.equal(f.calls.some((call) => call.body?.action === "execute"), false);
    }
  });

  test("host R2 " + surface + ": malformed and stale host control identities are rejected independently of presentation", async (t) => {
    const f = recoveryR2Surface(t, surface); await f.open([f.turn()]);
    const opening = f.host.reviewForTest({ turnId: "turn-a" }), quote = await f.take(); await f.reply(quote, f.response()); await opening;
    const valid = recoveryR2Control(f, "approve"), before = f.calls.length;
    for (const invalid of [
      undefined, {}, { ...valid, reviewId: "different-review" }, { ...valid, turnId: "turn-b" },
      { ...valid, executionId: "approval-b" }, { ...valid, bindingHash: "hash-b" },
      { ...valid, action: "execute" }, { ...valid, action: "run-approved" },
    ]) await f.host.actionForTest(invalid);
    assert.equal(f.calls.length, before);
    const changing = f.host.actionForTest(recoveryR2Control(f, "quote", { model: "gpt-5.6-sol" })), fresh = await f.take();
    await f.reply(fresh, f.response("turn-a", { executionId: "approval-model-b", bindingHash: "model-b-hash", models: ["gpt-5.6-sol"] })); await changing;
    const changed = f.calls.length; await f.host.actionForTest(valid);
    assert.equal(f.calls.length, changed, "same modal with a replaced preview must reject its old approval");
    assert.equal(f.calls.some((call) => call.body?.action === "execute"), false);
  });
}

for (const surface of ["Document", "Canvas"]) for (const locale of ["en", "fr", "ar", "ja"]) {
  test("host R2 " + surface + "/" + locale + ": rendered unused refresh is free and failed settled lookup keeps its localized original receipt", async (t) => {
    const f = recoveryR2Surface(t, surface, locale, true), hash = "a".repeat(64), catalog = ASSISTANT_MESSAGES[locale];
    await f.open([f.turn()]);
    const opening = f.host.reviewForTest({ turnId: "turn-a" }), quote = await f.take();
    await f.reply(quote, f.response()); await opening; f.render(); f.panel.draftForTest = "Keep this exact localized draft";
    const executing = f.host.requestForTest("execute"), execute = await f.take(); await f.reject(execute); await executing;
    const checking = f.host.requestForTest("resume"), unused = await f.take();
    await f.reply(unused, f.response("turn-a", { canExecute: false }, { unusedExecution: true })); await checking;
    const rendered = f.render(), refresh = rendered.buttons.find((button) => button.label === catalog["assistant.specialist.refresh"]);
    assert.ok(refresh && !refresh.disabled, "a certified unused original request has an explicit free refresh");
    assert.match(refresh.attrs, /approval-a/u);
    const before = f.calls.filter((call) => call.body?.action === "execute").length;
    refresh.click(); const fresh = await f.take();
    assert.deepEqual(fresh.body, { action: "quote", turnId: "turn-a", model: "gpt-5.6-luna" });
    assert.equal(fresh.url.searchParams.get("route"), f.route); assert.deepEqual(fresh.url.searchParams.getAll("selected"), f.selection);
    const receipt = f.response("turn-a", { status: "completed", canExecute: false, period: "2026-07" }, {
      reused: true, task: savedTask({ id: "approval-a", bindingHash: hash, status: "completed", submission: "settled", canExecute: false }),
      result: { sourceStatus: "original-approved-source", reply: "Original independently admitted paid result" },
    });
    await f.reply(fresh, receipt);
    assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, before, "a discovered paid winner is not reapproved");
    const current = f.render();
    assert.ok(!current.buttons.some((button) => button.label === catalog["assistant.specialist.approve"] || button.label === catalog["assistant.specialist.refresh"]));
    const retrieve = current.buttons.find((button) => button.label === catalog["assistant.specialist.retrieve"] && !button.attrs.includes("data-assistant-recovery"));
    assert.ok(retrieve && !retrieve.disabled);
    retrieve.click(); const failed = await f.take(); assert.equal(failed.body.action, "retrieve"); assert.equal(failed.body.approvedBindingHash, hash);
    await f.reply(failed, { error: "assistant_status_lookup_temporarily_unavailable" }, 503);
    const state = f.host.snapshotForTest().specialist, after = f.render();
    assert.equal(state.quote.status, "completed"); assert.equal(state.quote.period, "2026-07");
    assert.equal(state.task.submission, "settled"); assert.equal(state.task.certifiedCompleted, true);
    assert.equal(state.notice, "lookupFailed"); assert.equal(state.resultReply, receipt.result.reply);
    assert.ok(after.markup.includes(catalog["assistant.specialist.lookupFailed"]));
    assert.ok(after.markup.includes(catalog["assistant.specialist.settled"]));
    assert.ok(!after.markup.includes(catalog["assistant.specialist.billingUnknown"]));
    assert.equal(f.panel.draftForTest, "Keep this exact localized draft");
    assert.equal(f.calls.filter((call) => call.body?.action === "execute").length, before);
  });
}

function unusedR3Models() {
  return [
    { id: "gpt-5.6-terra", maximumMicrousd: 40000, premiumApprovalRequired: false },
    { id: "gpt-5.6-sol", maximumMicrousd: 100000, premiumApprovalRequired: true },
  ];
}
async function unusedR3Fixture(t, surface, locale, access = "personal-author") {
  const f = recoveryR2Surface(t, surface, locale, true), shared = access.startsWith("shared"), author = access.endsWith("author");
  const capabilities = author ? ["project.read", "project.author", "project.output.request", "project.canvas.use"] : ["project.read", "project.canvas.use"];
  f.session.set({ ...f.session.get(), capabilities, assistant: { ...f.session.get().assistant, models: author ? unusedR3Models() : [] },
    ...(shared ? { projectContext: { organizationId: "organization-a", projectAccessId: "grant-a", projectId: "project-a",
      role: author ? "editor" : "viewer", permissions: capabilities, expiresAt: new Date(Date.now() + 3600000).toISOString() } } : {}) });
  const reference = { id: "approval-a", turnId: "turn-a", executionId: "approval-a", bindingHash: "a".repeat(64), status: "recovery", recoveryOnly: true };
  await f.open([f.turn()], [reference]);
  const opening = f.host.reviewForTest({ turnId: "turn-a", task: reference }), exact = await f.take();
  assert.deepEqual(exact.body, { action: "resume", turnId: "turn-a", executionId: "approval-a" });
  const original = f.response("turn-a", { canExecute: false }, { unusedExecution: true });
  await f.reply(exact, original); await opening;
  f.render(); f.panel.draftForTest = "Preserve this complete " + surface + " / " + locale + " draft.\n".repeat(10);
  const finances = structuredClone(f.session.get().costBudgets), taskCount = f.calls.length;
  const assertFree = () => {
    assert.equal(f.calls.some(call => call.body && !["resume", "retrieve", "quote"].includes(call.body.action)), false, "no execution, cancellation, reconciliation or provider request");
    assert.deepEqual(f.session.get()?.costBudgets, finances, "no client budget mutation");
    assert.equal(f.trace.some(item => item[0] === "toast"), false);
  };
  return { ...f, original, reference, assertFree, taskCount };
}

for (const surface of ["Document", "Canvas"]) for (const locale of ["en", "fr", "ar", "ja"]) {
  test("unused model R3 " + surface + "/" + locale + ": original unavailable Luna retains an explicit free refresh", async t => {
    const f = await unusedR3Fixture(t, surface, locale), catalog = ASSISTANT_MESSAGES[locale];
    const rendered = f.render(), refresh = rendered.buttons.find(button => button.label === catalog["assistant.specialist.refresh"]);
    assert.ok(refresh && !refresh.disabled, "the original model's removal from enrollment must not strand a verified unused request");
    assert.equal(rendered.selects.length, 0, "a different model is not silently selected before the original free preview");
    assert.equal(f.host.snapshotForTest().specialist.quote.canExecute, false);
    const before = f.calls.length;
    refresh.click();
    assert.equal(f.calls.length, before + 1, "the actual panel event reaches a free host quote");
    const call = await f.take();
    assert.deepEqual(call.body, { action: "quote", turnId: "turn-a", model: "gpt-5.6-luna" });
    assert.equal(call.url.searchParams.get("route"), f.route);
    assert.deepEqual(call.url.searchParams.getAll("selected"), f.selection);
    await f.reply(call, f.response("turn-a", { canExecute: false, unavailableReasons: ["assistant_model_model_not_allowed"] }));
    f.assertFree();
  });

  test("unused model R3 " + surface + "/" + locale + ": the host independently permits only original-model free inspection", async t => {
    const f = await unusedR3Fixture(t, surface, locale);
    const before = f.calls.length, refreshing = f.host.actionForTest(recoveryR2Control(f, "quote", { model: "gpt-5.6-luna" }));
    assert.equal(f.calls.length, before + 1, "the host must not conflate a proof-gated free preview with model purchase enrollment");
    const call = await f.take(); assert.equal(call.body.model, "gpt-5.6-luna");
    await f.reply(call, f.response("turn-a", { canExecute: false, unavailableReasons: ["assistant_model_model_not_allowed"] })); await refreshing;
    f.assertFree();
  });

  for (const access of ["personal-author", "personal-reader", "shared-author", "shared-reader"]) {
    test("unused model R3 " + surface + "/" + locale + "/" + access + ": exact unused evidence has truthful localized financial copy", async t => {
      const f = await unusedR3Fixture(t, surface, locale, access), catalog = ASSISTANT_MESSAGES[locale], rendered = f.render();
      assert.equal(f.host.snapshotForTest().specialist.unusedExecution, true);
      assert.equal(f.host.snapshotForTest().specialist.task, null);
      assert.ok(!rendered.markup.includes(catalog["assistant.specialist.billingUnknown"]), "verified absence for this exact request must not be contradicted by generic pending billing");
      assert.ok(catalog["assistant.specialist.unusedFinancial"] && rendered.markup.includes(catalog["assistant.specialist.unusedFinancial"]));
      if (access.endsWith("reader")) assert.equal(rendered.buttons.some(button => button.label === catalog["assistant.specialist.refresh"] || button.label === catalog["assistant.specialist.approve"]), false);
      f.assertFree();
    });
  }
}

function unusedR3Button(f, rendered, key) {
  const button = rendered.buttons.find(item => item.label === ASSISTANT_MESSAGES[f.panel.i18n.locale][key]
    && !item.attrs.includes("data-assistant-recovery"));
  assert.ok(button, "actual localized modal control " + key);
  return button;
}
async function unusedR3Preview(f, quoteValues = {}) {
  unusedR3Button(f, f.render(), "assistant.specialist.refresh").click();
  const call = await f.take();
  assert.deepEqual(call.body, { action: "quote", turnId: "turn-a", model: "gpt-5.6-luna" });
  assert.equal(f.host.snapshotForTest().specialist.unusedExecution, false, "a new free preview consumes the current unused certificate");
  const response = f.response("turn-a", { executionId: "new-luna-preview", bindingHash: "b".repeat(64), sourceHash: "current-authored-source",
    canExecute: false, unavailableReasons: ["assistant_model_model_not_allowed"], ...quoteValues });
  await f.reply(call, response);
  return { call, response };
}

for (const surface of ["Document", "Canvas"]) for (const locale of ["en", "fr", "ar", "ja"]) {
  for (const model of ["gpt-5.6-terra", "gpt-5.6-sol"]) test("unused model R3 " + surface + "/" + locale + ": " + model + " needs a separate explicit preview and approval", async t => {
    const f = await unusedR3Fixture(t, surface, locale, model.endsWith("sol") ? "shared-author" : "personal-author"), catalog = ASSISTANT_MESSAGES[locale];
    const originalDraft = f.panel.draftForTest, originalControl = recoveryR2Control(f, "quote", { model: "gpt-5.6-luna" });
    const oldRefresh = unusedR3Button(f, f.render(), "assistant.specialist.refresh").click;
    const { response: original } = await unusedR3Preview(f);
    const quoted = f.render(), select = quoted.selects[0], disabled = unusedR3Button(f, quoted, "assistant.specialist.approve");
    assert.ok(select && !select.disabled, "currently permitted models remain explicit choices");
    assert.equal(select.value, "gpt-5.6-luna", "the selected original stays visible, never replaced by the first enrolled model");
    const originalOption = select.options.match(/<option value=gpt-5\.6-luna\b([^>]*)>([\s\S]*?)<\/option>/u);
    assert.ok(originalOption); assert.match(originalOption[1], /\bdisabled\b/u); assert.match(originalOption[1], /\bselected\b/u);
    const unavailable = catalog["assistant.specialist.modelUnavailable"].replace("{model}", catalog["assistant.model.luna"]);
    assert.ok(originalOption[2].includes(unavailable));
    assert.match(select.options, /value=gpt-5\.6-terra/u); assert.match(select.options, /value=gpt-5\.6-sol/u);
    assert.ok(disabled.disabled); const before = f.calls.length;
    disabled.click(); await f.host.actionForTest(recoveryR2Control(f, "approve")); await f.host.runApprovedForTest();
    oldRefresh(); await f.host.actionForTest(originalControl);
    assert.equal(f.calls.length, before, "disabled original approval and stale refresh cannot execute or requote");
    assert.equal(f.host.snapshotForTest().specialist.retrievalOnly, false);
    assert.equal(f.host.snapshotForTest().specialist.unusedExecution, false);
    assert.ok(!quoted.markup.includes(catalog["assistant.specialist.unusedFinancial"]), "the old no-reservation certificate cannot describe this new preview");
    const oldSelector = select.change;
    select.change({ currentTarget: { value: model } });
    const choosing = await f.take();
    assert.deepEqual(choosing.body, { action: "quote", turnId: "turn-a", model });
    assert.equal(choosing.url.searchParams.get("route"), f.route);
    assert.deepEqual(choosing.url.searchParams.getAll("selected"), f.selection);
    const chosen = f.response("turn-a", { executionId: "new-permitted-preview", bindingHash: "c".repeat(64),
      sourceHash: "later-legitimate-authored-source", models: [model], canExecute: true });
    await f.reply(choosing, chosen);
    f.assertFree();
    const current = f.render(), currentState = f.host.snapshotForTest().specialist;
    assert.equal(current.selects[0].value, model);
    assert.equal(currentState.quote.sourceHash, "later-legitimate-authored-source", "new authored changes receive their own exact preview");
    assert.equal(currentState.originalRequest.turnId, original.turnId);
    assert.deepEqual(currentState.originalRequest.selectedItemIds, original.originalRequest.selectedItemIds);
    assert.equal(currentState.unusedExecution, false);
    const settledCount = f.calls.length;
    oldSelector({ currentTarget: { value: "gpt-5.6-luna" } }); oldRefresh();
    await f.host.actionForTest(originalControl);
    assert.equal(f.calls.length, settledCount, "replaced preview controls remain exactly bound");
    const approve = unusedR3Button(f, current, "assistant.specialist.approve");
    assert.equal(approve.disabled, false);
    approve.click(); const execution = await f.take();
    assert.deepEqual(execution.body, { action: "execute", turnId: "turn-a", executionId: "new-permitted-preview", approvedBindingHash: "c".repeat(64) });
    // This isolated UI positive control reaches only the mocked endpoint; no task,
    // provider work, financial reservation or authored mutation is performed.
    await f.reply(execution, { error: "test_purchase_not_admitted", submission: "not-submitted" }, 409);
    assert.equal(f.calls.filter(call => call.body?.action === "execute").length, 1, "only the separate explicit approval requests execution");
    assert.equal(f.calls.filter(call => call.body?.action === "quote").length, 2);
    assert.equal(f.panel.draftForTest, originalDraft);
  });

  test("unused model R3 " + surface + "/" + locale + ": missing, failed and mismatched exact reads cannot certify no spending", async t => {
    for (const mutation of [
      payload => { delete payload.unusedExecution; },
      payload => { payload.unusedExecution = "true"; },
      payload => { payload.quote.canExecute = true; },
      payload => { payload.quote.status = "uncertain"; },
      payload => { payload.quote.bindingHash = "d".repeat(64); },
      payload => { payload.originalRequest.sourceHash = "wrong-original-source"; },
      payload => { payload.task = savedTask({ id: "approval-a", bindingHash: "a".repeat(64), status: "queued", submission: "not-submitted" }); },
      payload => { payload.result = { sourceStatus: "original-approved-source", reply: "A result is not an unused proof" }; },
    ]) {
      const f = await unusedR3Fixture(t, surface, locale);
      const checking = f.host.requestForTest("retrieve"), call = await f.take(), response = structuredClone(f.original);
      mutation(response); await f.reply(call, response); await checking;
      const state = f.host.snapshotForTest().specialist, rendered = f.render(), catalog = ASSISTANT_MESSAGES[locale];
      assert.notEqual(state.unusedExecution, true);
      assert.ok(!rendered.markup.includes(catalog["assistant.specialist.unusedFinancial"]));
      assert.equal(rendered.buttons.some(button => button.label === catalog["assistant.specialist.refresh"]), false);
      const before = f.calls.length;
      await f.host.actionForTest(recoveryR2Control(f, "quote", { model: "gpt-5.6-luna" }));
      assert.equal(f.calls.length, before); f.assertFree();
    }
    for (const failure of ["transport", "503", "malformed-json"]) {
      const f = await unusedR3Fixture(t, surface, locale), checking = f.host.requestForTest("retrieve"), call = await f.take();
      if (failure === "transport") await f.reject(call);
      else if (failure === "503") await f.reply(call, { unusedExecution: true, error: "not_a_certificate" }, 503);
      else { call.gate.resolve({ ok: true, status: 200, json: async () => { throw new Error("truncated read"); } }); await tick(); }
      await checking;
      const rendered = f.render(), catalog = ASSISTANT_MESSAGES[locale];
      assert.equal(f.host.snapshotForTest().specialist.unusedExecution, false);
      assert.ok(!rendered.markup.includes(catalog["assistant.specialist.unusedFinancial"]));
      assert.ok(rendered.markup.includes(catalog["assistant.specialist.billingUnknown"]));
      assert.equal(rendered.buttons.some(button => button.label === catalog["assistant.specialist.refresh"]), false);
      f.assertFree();
    }
  });

  test("unused model R3 " + surface + "/" + locale + ": the unused certificate is current and exact, never a persistent recovery hint", async t => {
    const f = await unusedR3Fixture(t, surface, locale), catalog = ASSISTANT_MESSAGES[locale];
    const other = { ...f.reference, id: "approval-b", executionId: "approval-b", turnId: "turn-b", bindingHash: "b".repeat(64), unusedExecution: true };
    const loading = f.host.loadForTest(), feed = await f.take();
    await f.reply(feed, { context: f.context, turns: [f.turn()], tasks: [other] }); await loading;
    const first = f.render(), article = first.markup.match(/<article class="forma-assistant-task" data-task-id=approval-b[\s\S]*?<\/article>/u)?.[0];
    assert.ok(article?.includes(catalog["assistant.specialist.billingUnknown"]));
    assert.ok(!article.includes(catalog["assistant.specialist.unusedFinancial"]), "another row cannot borrow this request's financial evidence");
    f.host.closeReviewForTest(); const closed = await f.take(); await f.reply(closed, { context: f.context, turns: [], tasks: [] });
    const outside = f.render();
    assert.ok(!outside.markup.includes(catalog["assistant.specialist.unusedFinancial"]));
    const reference = f.host.snapshotForTest().tasks.find(task => task.executionId === "approval-a");
    assert.ok(reference?.recoveryOnly);
    assert.equal(Object.hasOwn(reference, "unusedExecution"), false);
    const opening = f.host.reviewForTest({ turnId: reference.turnId, task: reference }), exact = await f.take();
    assert.deepEqual(exact.body, { action: "resume", turnId: "turn-a", executionId: "approval-a" });
    const pending = f.render();
    assert.ok(!pending.markup.includes(catalog["assistant.specialist.unusedFinancial"]));
    assert.equal(pending.buttons.some(button => button.label === catalog["assistant.specialist.refresh"]), false);
    await f.reply(exact, f.original); await opening;
    assert.ok(f.render().markup.includes(catalog["assistant.specialist.unusedFinancial"]));
    f.assertFree();
  });

  test("unused model R3 " + surface + "/" + locale + ": failed free refresh clears the certificate and keeps the retained original request ID", async t => {
    for (const failure of ["transport", "503", "invalid-source", "invalid-selection", "invalid-turn", "invalid-document", "invalid-hash"]) {
      const f = await unusedR3Fixture(t, surface, locale), catalog = ASSISTANT_MESSAGES[locale], draft = f.panel.draftForTest;
      unusedR3Button(f, f.render(), "assistant.specialist.refresh").click(); const call = await f.take();
      if (failure === "transport") await f.reject(call);
      else if (failure === "503") await f.reply(call, { error: "new_free_preview_unconfirmed", unusedExecution: true }, 503);
      else {
        const response = f.response("turn-a", { executionId: "unverified-preview", bindingHash: "b".repeat(64), canExecute: false });
        if (failure === "invalid-source") response.originalRequest.sourceHash = "not-this-source";
        if (failure === "invalid-selection") response.originalRequest.selectedItemIds = ["different-saved-item"];
        if (failure === "invalid-turn") response.originalRequest.turnId = "turn-b";
        if (failure === "invalid-document") response.quote.documentId = "document-b";
        if (failure === "invalid-hash") response.quote.bindingHash = "";
        await f.reply(call, response);
      }
      const state = f.host.snapshotForTest().specialist, rendered = f.render();
      assert.equal(state.executionId, "approval-a");
      assert.equal(state.unusedExecution, false, "neither a failed free quote nor an error-body marker restores unused proof");
      assert.ok(!rendered.markup.includes(catalog["assistant.specialist.unusedFinancial"]));
      assert.equal(rendered.buttons.some(button => button.label === catalog["assistant.specialist.refresh"]), false);
      assert.equal(f.host.snapshotForTest().tasks.find(task => task.executionId === "approval-a")?.bindingHash, "a".repeat(64));
      assert.equal(f.panel.draftForTest, draft);
      f.assertFree();
    }
  });
}

for (const surface of ["Document", "Canvas"]) {
  test("unused model R3 " + surface + ": read evidence survives model unenrollment but new-model quotes still require current enrollment", async t => {
    const f = await unusedR3Fixture(t, surface, "en"), catalog = ASSISTANT_MESSAGES.en;
    f.session.set({ ...f.session.get(), assistant: { ...f.session.get().assistant, models: [] } });
    const current = f.render();
    assert.ok(current.markup.includes(catalog["assistant.specialist.unusedFinancial"]));
    assert.ok(current.buttons.some(button => button.label === catalog["assistant.specialist.refresh"]));
    await unusedR3Preview(f);
    assert.equal(f.render().selects.length, 0, "no ungranted model is advertised");
    const before = f.calls.length;
    await f.host.actionForTest(recoveryR2Control(f, "quote", { model: "gpt-5.6-terra" }));
    assert.equal(f.calls.length, before, "only the proven original model has the free-inspection exception");
    f.assertFree();
  });

  test("unused model R3 " + surface + ": captured free refresh cannot survive an authority, route or request-identity change", async t => {
    const mutations = [
      f => f.session.set({ ...f.session.get(), permissionEpoch: "epoch-b" }),
      f => f.session.set({ ...f.session.get(), user: { userId: "actor-b" } }),
      f => f.session.set({ ...f.session.get(), capabilities: ["project.read"] }),
      f => f.session.set({ ...f.session.get(), projectContext: { projectId: "project-a", projectAccessId: "other-grant",
        organizationId: "other-organization", permissions: ["project.read"], role: "viewer", expiresAt: new Date(Date.now() + 3600000).toISOString() } }),
      f => f.session.set({ ...f.session.get(), policy: { ...f.session.get().policy, accepted: false } }),
      f => f.session.set({ ...f.session.get(), assistant: { ...f.session.get().assistant, enabled: false } }),
      f => f.store.route.set(surface === "Canvas" ? "/canvas/board-b/beta" : "/document/doc-b/beta"),
      f => f.host.disconnectedCallback(),
      ...(surface === "Canvas" ? [f => f.select(["different-selection"])] : []),
    ];
    for (const mutate of mutations) {
      const f = await unusedR3Fixture(t, surface, "en"), captured = unusedR3Button(f, f.render(), "assistant.specialist.refresh").click;
      const detail = recoveryR2Control(f, "quote", { model: "gpt-5.6-luna" }), before = f.calls.filter(call => call.body).length;
      mutate(f); await f.host.actionForTest(detail);
      const rendered = f.render(); captured();
      assert.equal(f.calls.filter(call => call.body).length, before, "the host rejects the old intention before render, and the updated panel rejects its captured callback; a fresh scoped GET is still allowed");
      assert.ok(!rendered.markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.unusedFinancial"]));
      f.assertFree();
    }
    for (const key of ["reviewId", "turnId", "executionId", "bindingHash"]) {
      const f = await unusedR3Fixture(t, surface, "en"), before = f.calls.length;
      await f.host.actionForTest(recoveryR2Control(f, "quote", { [key]: "other-request", model: "gpt-5.6-luna" }));
      assert.equal(f.calls.length, before); f.assertFree();
    }
    for (const access of ["personal-reader", "shared-reader"]) {
      const f = await unusedR3Fixture(t, surface, "en", access), before = f.calls.length;
      await f.host.actionForTest(recoveryR2Control(f, "quote", { model: "gpt-5.6-luna" }));
      await f.host.actionForTest(recoveryR2Control(f, "approve"));
      assert.equal(f.calls.length, before);
      assert.ok(f.render().markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.unusedFinancial"]));
      f.assertFree();
    }
  });

  test("unused model R3 " + surface + ": exact privacy withdrawal and late JSON cannot restore an unused financial claim", async t => {
    for (const status of [401, 403, 404, 410]) {
      const f = await unusedR3Fixture(t, surface, "en"), captured = unusedR3Button(f, f.render(), "assistant.specialist.refresh").click;
      const checking = f.host.requestForTest("retrieve"), call = await f.take();
      let decoded = false;
      call.gate.resolve({ ok: false, status, json: async () => { decoded = true; return { unusedExecution: true }; } });
      await checking;
      assert.equal(decoded, false, "privacy status is consumed before an untrusted body");
      const before = f.calls.length; captured();
      assert.equal(f.calls.length, before);
      assert.notEqual(f.host.snapshotForTest().specialist?.unusedExecution, true);
      assert.ok(!f.render().markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.unusedFinancial"]));
      f.assertFree();
    }
    const f = await unusedR3Fixture(t, surface, "en");
    unusedR3Button(f, f.render(), "assistant.specialist.refresh").click(); const call = await f.take();
    await f.reply(call, f.response("turn-a", { privateInput: { original: "LATE_PRIVATE_SOURCE" }, canExecute: false }), 200,
      () => f.session.set({ ...f.session.get(), permissionEpoch: "withdrawn-after-json-start" }));
    assert.ok(!f.render().markup.includes("LATE_PRIVATE_SOURCE"));
    assert.ok(!f.render().markup.includes(ASSISTANT_MESSAGES.en["assistant.specialist.unusedFinancial"]));
    f.assertFree();
  });
}

class ReentryMemoryNode extends EventTarget {
  constructor(nodeType, scene = null, tagName = "") {
    super(); this.nodeType = nodeType; this.scene = scene; this.tagName = tagName;
    this.children = []; this.parentNode = null; this.open = false;
  }
  get isConnected() { return Boolean(this.root || this.parentNode?.isConnected); }
  get nextSibling() { const siblings = this.parentNode?.children ?? []; return siblings[siblings.indexOf(this) + 1] ?? null; }
  insertBefore(node, before) {
    if (node.nodeType === 11) { for (const child of [...node.children]) this.insertBefore(child, before); return node; }
    node.remove(); const at = before ? this.children.indexOf(before) : this.children.length;
    assert.ok(at >= 0); this.children.splice(at, 0, node); node.parentNode = this; return node;
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    if (this.tagName === "DIALOG" && this.isConnected && this.open) this.scene.f.topModal(null);
    this.parentNode = null;
  }
  cloneNode(deep) {
    const clone = new ReentryMemoryNode(this.nodeType, this.scene, this.tagName);
    if (deep) for (const child of this.children) clone.insertBefore(child.cloneNode(true), null);
    return clone;
  }
  hasAttribute(name) { return name === "aria-labelledby" || name === "open" && this.open; }
  setAttribute(name) { if (name === "open") this.open = true; }
  removeAttribute(name) { if (name === "open") this.open = false; }
  matches(selector) { return selector === ":modal" && this.isConnected && this.open; }
  showModal() { assert.equal(this.isConnected, true); this.open = true; this.scene.f.topModal(this); }
  close() {
    if (!this.open) return;
    this.open = false; this.scene.f.topModal(null);
    // Model native close delivery as a later task addressed to this element.
    this.scene.queued.push(() => this.dispatchEvent(new Event("close")));
  }
}
const reentryMemoryDocument = {
  nodeType: 9, children: [],
  createComment: () => new ReentryMemoryNode(8),
  createTextNode: () => new ReentryMemoryNode(3),
  importNode: (node, deep) => node.cloneNode(deep),
  createTreeWalker(root) {
    return { currentNode: root, nextNode() {
      if (this.currentNode.children?.length) return this.currentNode = this.currentNode.children[0];
      let next = this.currentNode;
      while (next && !next.nextSibling) next = next.parentNode;
      return next ? this.currentNode = next.nextSibling : null;
    } };
  },
};
let reentryLit;
async function reentryLitRuntime() {
  if (reentryLit) return reentryLit;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: reentryMemoryDocument });
  try {
    const require = createRequire(import.meta.resolve("lit"));
    const url = pathToFileURL(require.resolve("lit-html"));
    url.searchParams.set("assistant-reentry-test", "native-element-ownership");
    reentryLit = await import(url.href);
    return reentryLit;
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else delete globalThis.document;
  }
}
async function reentryNativeScene(f) {
  const runtime = await reentryLitRuntime(), scene = { f, queued: [], runtime };
  const container = new ReentryMemoryNode(1, scene, "SECTION"); container.root = true;
  const fragment = new ReentryMemoryNode(11, scene);
  fragment.insertBefore(new ReentryMemoryNode(1, scene, "DIALOG"), null);
  // Use real Lit ChildPart, TemplateInstance and EventPart behavior without an
  // HTML parser: this compiled one-element fixture binds the actual component's
  // cancel/close/keydown callbacks. Its template identity is stable, exactly as
  // the production dialog literal is stable across consecutive review renders.
  const template = { el: { content: fragment }, parts: ["cancel", "close", "keydown"].map(name => ({
    type: 1, index: 0, name, strings: ["", ""], ctor: runtime._$LH.U,
  })) };
  const query = f.panel.querySelector.bind(f.panel);
  scene.dialog = () => container.children.find(node => node.tagName === "DIALOG") ?? null;
  f.panel.querySelector = selector => selector === ".forma-assistant-specialist" ? scene.dialog() : query(selector);
  scene.commit = () => {
    const view = f.render({ deferLifecycle: true }), actual = f.panel.specialistTemplateForTest();
    const compiled = { _$litType$: template, values: [view.cancel, view.nativeClose, view.dialogKeydown] };
    // Preserve the actual component's directive and key, if any. The test does
    // not decide whether ownership should be keyed; production render does.
    const result = typeof actual === "symbol" ? runtime.nothing : actual?._$litDirective$
      ? { ...actual, values: [actual.values[0], compiled] } : compiled;
    runtime.render(result, container, { creationScope: reentryMemoryDocument });
    view.update(); return view;
  };
  return scene;
}
function reentryEscape(dialog) {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperties(event, { key: { value: "Escape" }, isComposing: { value: false } });
  dialog.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true, "user Escape remains handled synchronously");
}

for (const surface of ["Document", "Canvas"]) test("native R3 " + surface + ": a queued native cancel remains owned by the dismissed review across a coalesced Lit render", async (t) => {
  const f = recoveryR2Surface(t, surface), scene = await reentryNativeScene(f);
  await f.open([f.turn()]); scene.commit();
  const opening = f.host.reviewForTest({ turnId: "turn-a" }), first = await f.take();
  await f.reply(first, f.response()); await opening;
  const view = scene.commit(), oldDialog = scene.dialog();
  const oldId = f.host.snapshotForTest().specialist.id;
  f.panel.draftForTest = "Keep the native re-entry draft";
  // The pending UA event belongs to A's element, not whichever review may be
  // rendered when it is eventually dispatched. This is distinct from invoking
  // a previously captured JavaScript callback, which existing tests cover.
  const lateNativeCancel = () => oldDialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  reentryEscape(oldDialog);
  assert.equal(f.host.snapshotForTest().specialist, null); assert.equal(oldDialog.open, false);
  const closeFeed = await f.take();
  const opener = view.buttons.find(button => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.review"]);
  opener.click({ currentTarget: opener.node ?? f.opener });
  const quoted = await f.take(), newId = f.host.snapshotForTest().specialist.id;
  assert.notEqual(newId, oldId);
  // Deliberately coalesce A->closed->B before the next DOM commit. Lit must
  // isolate the native element, not merely capture B's current callback/ID.
  scene.commit();
  const newDialog = scene.dialog();
  for (const dispatch of scene.queued.splice(0)) dispatch();
  assert.equal(f.host.snapshotForTest().specialist?.id, newId, "the existing late-close guard still preserves B");
  lateNativeCancel();
  assert.equal(f.host.snapshotForTest().specialist?.id, newId, "A's queued native cancel must not dismiss B");
  assert.notEqual(newDialog, oldDialog, "each review owns a different native event target");
  assert.equal(newDialog.open, true);
  await f.reply(closeFeed, { context: f.context, turns: [f.turn()], tasks: [] });
  await f.reply(quoted, f.response()); scene.commit();
  assert.equal(scene.dialog(), newDialog, "quote delivery within the same review does not replace its dialog");
  assert.equal(f.host.snapshotForTest().specialist.quote.executionId, "approval-a");
  assert.equal(f.panel.draftForTest, "Keep the native re-entry draft");
  reentryEscape(newDialog);
  assert.equal(f.host.snapshotForTest().specialist, null, "a fresh Escape on B still dismisses immediately");
  const finalFeed = await f.take(); await f.reply(finalFeed, { context: f.context, turns: [f.turn()], tasks: [] }); scene.commit();
  assert.equal(scene.dialog(), null);
  assert.equal(f.calls.filter(call => call.body?.action === "quote").length, 2);
  assert.equal(f.calls.some(call => call.body?.action === "execute"), false);
});

for (const surface of ["Document", "Canvas"]) for (const locale of ["en", "fr", "ar", "ja"]) {
  test("native R4 " + surface + "/" + locale + ": an unchanged close feed preserves the first re-entry target", async (t) => {
    const f = recoveryR2Surface(t, surface, locale), scene = await reentryNativeScene(f);
    const turns = [f.turn(), f.turn("turn-b")];
    await f.open(turns); scene.commit(); await tick();
    const opening = f.host.reviewForTest({ turnId: "turn-a" }), first = await f.take();
    await f.reply(first, f.response()); await opening; scene.commit(); await tick();
    f.panel.draftForTest = "Keep the unsubmitted draft"; f.field.value = f.panel.draftForTest;
    f.transcript.scrollTop = 240;
    reentryEscape(scene.dialog());
    const closeFeed = await f.take(); scene.commit(); await tick();
    assert.equal(f.transcript.scrollTop, 240, "dismissing the review does not move the underlying target");
    const previousMessages = f.panel.messages;
    await f.reply(closeFeed, { context: f.context, turns: [f.turn(), f.turn("turn-b")], tasks: [] });
    const view = scene.commit(); await tick();
    assert.notEqual(f.panel.messages, previousMessages, "the actual GET rebuilds a fresh message array");
    assert.deepEqual(f.panel.messages, previousMessages, "this feed does not change the displayed messages");
    assert.equal(f.transcript.scrollTop, 240, "an unchanged read must not move Review before pointer activation");
    const opener = view.buttons.find(button => button.label === ASSISTANT_MESSAGES[locale]["assistant.specialist.review"]
      && button.attrs.includes("data-assistant-turn-id=turn-a"));
    assert.ok(opener && !opener.disabled);
    opener.click({ currentTarget: opener.node ?? f.opener });
    assert.ok(f.host.snapshotForTest().specialist, "the first intended opener activation reaches the host");
    const quoted = await f.take(); assert.equal(quoted.body.action, "quote");
    await f.reply(quoted, f.response()); scene.commit(); f.flushFrames();
    assert.equal(scene.dialog().open, true);
    assert.equal(f.host.snapshotForTest().specialist.executionId, "approval-a");
    assert.equal(f.panel.draftForTest, "Keep the unsubmitted draft");
    assert.equal(f.field.value, "Keep the unsubmitted draft");
    assert.equal(f.calls.filter(call => call.body?.action === "quote").length, 2);
    assert.equal(f.calls.some(call => call.body?.action === "execute"), false);
  });

  test("native R4 " + surface + "/" + locale + ": only a semantic message change scrolls the transcript", async (t) => {
    const f = recoveryR2Surface(t, surface, locale);
    const original = { ...f.turn(), reply: { key: "assistant.page", values: { page: "Original", unused: "ignored-a" }, text: "Not displayed" } };
    await f.open([original]); f.render(); await tick();
    assert.equal(f.transcript.scrollTop, f.transcript.scrollHeight, "initial messages retain the existing scroll-to-latest behavior");
    f.panel.draftForTest = "Draft survives independent refresh";
    f.transcript.scrollTop = 120;
    const identical = { ...f.turn(), reply: { text: "Still not displayed", values: { unused: "ignored-b", page: "Original" }, key: "assistant.page" } };
    let loading = f.host.loadForTest(), feed = await f.take();
    await f.reply(feed, { context: f.context, turns: [identical], tasks: [] }); await loading; f.render(); await tick();
    assert.equal(f.transcript.scrollTop, 120, "property order and unused reply metadata do not change rendered text");

    loading = f.host.loadForTest(); feed = await f.take();
    await f.reply(feed, { context: f.context, turns: [identical, f.turn("turn-b")], tasks: [] }); await loading; f.render(); await tick();
    assert.equal(f.transcript.scrollTop, f.transcript.scrollHeight, "a new saved turn still scrolls to its message");
    f.transcript.scrollTop = 180;
    const sameIds = f.panel.messages.map(message => message.id);
    const changedReply = { ...identical, reply: { key: "assistant.page", values: { page: "Changed original reply" } } };
    loading = f.host.loadForTest(); feed = await f.take();
    await f.reply(feed, { context: f.context, turns: [changedReply, f.turn("turn-b")], tasks: [] }); await loading; f.render(); await tick();
    assert.deepEqual(f.panel.messages.map(message => message.id), sameIds);
    assert.equal(f.transcript.scrollTop, f.transcript.scrollHeight, "changed translated reply text scrolls even when all IDs are unchanged");

    f.transcript.scrollTop = 210;
    const plainReply = { ...changedReply, reply: { text: "A genuinely changed plain-text reply" } };
    loading = f.host.loadForTest(); feed = await f.take();
    await f.reply(feed, { context: f.context, turns: [plainReply, f.turn("turn-b")], tasks: [] }); await loading; f.render(); await tick();
    assert.equal(f.transcript.scrollTop, f.transcript.scrollHeight, "plain-text changes retain the same behavior");
    assert.equal(f.panel.draftForTest, "Draft survives independent refresh");
    assert.equal(f.calls.some(call => call.body), false, "read-only refreshes never create a specialist request");
  });
}

for (const surface of ["Document", "Canvas"]) for (const closeAction of ["Escape", "cancel", "Close"]) {
  test("native R4 " + surface + "/" + closeAction + ": a queued child readiness update cannot resurrect the dismissed review", async (t) => {
    const f = recoveryR2Surface(t, surface), scene = await reentryNativeScene(f);
    await f.open([f.turn()]); scene.commit(); await tick();
    const opening = f.host.reviewForTest({ turnId: "turn-a" }), first = await f.take();
    await f.reply(first, f.response()); await opening;
    const childUpdates = [];
    f.panel.requestUpdate = () => childUpdates.push(() => f.panel.updateForTest(new Map()));
    const view = scene.commit(), oldDialog = scene.dialog(), oldId = f.host.snapshotForTest().specialist.id;
    assert.equal(childUpdates.length, 1, "the actual native readiness transition schedules the child update");
    f.panel.draftForTest = "Keep pending-update draft";
    if (closeAction === "Escape") reentryEscape(oldDialog);
    else if (closeAction === "cancel") {
      const event = new Event("cancel", { cancelable: true }); oldDialog.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    } else view.buttons.find(button => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.close"]).click();
    assert.equal(f.host.snapshotForTest().specialist, null);
    assert.equal(f.panel.specialist.id, oldId, "host state clears before the child's next prop commit");
    assert.equal(oldDialog.open, false);
    const closeFeed = await f.take();
    // This is the already-requested child's actual updated() method, while the
    // DOM and child prop still belong to A. It is not a new user-open request.
    childUpdates.shift()();
    assert.equal(oldDialog.open, false, "readiness must not undo explicit dismissal");
    assert.equal(typeof f.panel.specialistTemplateForTest(), "symbol", "a stale prop cannot rerender dismissed private content");
    const opener = view.buttons.find(button => button.label === ASSISTANT_MESSAGES.en["assistant.specialist.review"]);
    const competingModal = { open: true };
    f.topModal(competingModal); const beforeBlocked = f.calls.length;
    opener.click({ currentTarget: opener.node ?? f.opener });
    assert.equal(f.calls.length, beforeBlocked, "another native modal still blocks the opener");
    f.topModal(null);
    opener.click({ currentTarget: opener.node ?? f.opener });
    assert.ok(f.host.snapshotForTest().specialist, "the first unblocked activation opens the new review");
    const quoted = await f.take(), newId = f.host.snapshotForTest().specialist.id;
    assert.notEqual(newId, oldId); scene.commit(); const newDialog = scene.dialog();
    for (const dispatch of scene.queued.splice(0)) dispatch();
    oldDialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    assert.equal(f.host.snapshotForTest().specialist.id, newId, "dismissed native events never clear the newer review");
    await f.reply(closeFeed, { context: f.context, turns: [f.turn()], tasks: [] });
    await f.reply(quoted, f.response()); scene.commit(); f.flushFrames();
    assert.equal(scene.dialog(), newDialog); assert.equal(newDialog.open, true);
    assert.equal(f.panel.draftForTest, "Keep pending-update draft");
    reentryEscape(newDialog);
    assert.equal(f.host.snapshotForTest().specialist, null, "the newer review still honors a fresh user Escape");
    const finalFeed = await f.take(); await f.reply(finalFeed, { context: f.context, turns: [f.turn()], tasks: [] }); scene.commit();
    assert.equal(scene.dialog(), null);
    assert.equal(f.calls.filter(call => call.body?.action === "quote").length, 2);
    assert.equal(f.calls.some(call => call.body?.action === "execute"), false);
  });
}
