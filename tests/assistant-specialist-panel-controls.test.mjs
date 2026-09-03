import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import * as lit from "lit";
import { keyed } from "lit/directives/keyed.js";
import { ASSISTANT_CONTEXT_LIMITS } from "../src/model/conversation-context.ts";
import { contextConsentAction } from "../src/model/context-consent-state.ts";
import { ensureNativeModalDialog } from "../src/components/design-system/native-dialog.ts";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { ASSISTANT_MESSAGES } from "../src/components/design-system/locales/assistant-messages.ts";

const focusImports = registerOutputSourceImports();
const { captureOutputNavigationFocus } = await import("../src/components/output-navigation-focus.ts");
focusImports.deregister();

// Actual production panel class and consequential preview renderer, with only
// native dialog/focus/frame and localized application inputs supplied in memory.
// These tests make no provider calls and are not browser or accessibility certification.
const read = relative => fs.readFileSync(new URL("../" + relative, import.meta.url), "utf8");
const panelPath = "src/components/design-system/assistant-panel.ts";
const panelSource = read(panelPath);
const panelTree = ts.createSourceFile(panelPath, panelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const panelClass = panelTree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaAssistantPanel");
const sourceWithProbe = panelSource.slice(0, panelClass.end - 1)
  + "\nset draftForTest(value: string){this.#draft=value;}get draftForTest(){return this.#draft;}\n"
  + panelSource.slice(panelClass.end - 1);
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const panelCode = compile(sourceWithProbe), previewCode = compile(read("src/components/consequential-preview.ts"));
const interpolate = (template, values) => template.replace(/\{(\w+)\}/gu, (_, key) => String(values[key] ?? ""));
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const unescape = value => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

function quote(id = "a", overrides = {}) {
  return {
    executionId: "execution-" + id, bindingHash: id.repeat(64), operation: "assistant-specialist", status: "quoted",
    actorLabel: "Exact actor", workspaceId: null, period: "2026-08", projectId: "project-a", documentId: "document-a", canvasId: null,
    blockId: "", sourceHash: "source-" + id, provider: "openai", models: ["gpt-5.6-luna"], maximumMicrousd: 15000,
    maximumTokens: 1600, providerCalls: 1, searchCalls: 0, publicQuery: "", privateInput: { original: "Every authored source sentence remains intact." },
    expiresAt: new Date(Date.now() + 600000).toISOString(), providerAvailable: true, budgetAvailable: true,
    availableMicrousd: 100000, canExecute: true, unavailableReasons: [], ...overrides,
  };
}
function review(kind = "approve", id = "a", overrides = {}) {
  const preview = quote(id, kind === "run-approved" ? { status: "reserved" }
    : kind === "retrieve" ? { status: "completed", canExecute: false } : kind === "refresh" ? { canExecute: false } : {});
  const task = kind === "run-approved" || kind === "retrieve" ? {
    id: preview.executionId, executionId: preview.executionId, bindingHash: preview.bindingHash, turnId: "turn-" + id,
    kind: "clarify", model: preview.models[0], status: kind === "retrieve" ? "completed" : "queued",
    estimatedMicrousd: 15000, canExecute: kind === "run-approved", submission: kind === "retrieve" ? "settled" : "not-submitted",
  } : kind === "resume" ? { id: preview.executionId, executionId: preview.executionId, turnId: "turn-" + id, status: "needs-review", recoveryOnly: true } : null;
  return {
    id: "review-" + id, scope: "scope-a", turnId: "turn-" + id, executionId: preview.executionId,
    quote: kind === "resume" ? null : preview, task,
    originalRequest: kind === "resume" ? null : { turnId: "turn-" + id, route: "/document/document-a", projectId: preview.projectId,
      documentId: preview.documentId, canvasId: preview.canvasId, selectedItemIds: [], locale: "en",
      model: preview.models[0], taskKind: "clarify", sourceHash: preview.sourceHash, conversationTurnIds: ["turn-" + id] },
    working: false, stopping: false, retrievalOnly: kind !== "approve", selectedModel: preview.models[0], notice: "", resultReply: null,
    ...(kind === "refresh" ? { unusedExecution: true } : {}), ...overrides,
  };
}
function fixture(locale = "en", nativeWindow = { addEventListener() {}, removeEventListener() {} }) {
  const emitted = [], trace = [], frames = [], cancelledFrames = [];
  // Opt-in Node EventTarget ports need the DOM Boolean capture overload.
  // Preserve the caller's callback and add options; old Window stubs are unchanged.
  const windowPort = nativeWindow instanceof EventTarget ? {
    addEventListener: (type, listener, options) => nativeWindow.addEventListener(type, listener, options),
    removeEventListener: (type, listener, options) => nativeWindow.removeEventListener(type, listener,
      typeof options === "boolean" ? { capture: options } : options),
  } : nativeWindow;
  let modals = [];
  const i18n = {
    locale, number: value => new Intl.NumberFormat(locale).format(value), system: value => value,
    t: (key, fallback = "", values = {}) => interpolate((ASSISTANT_MESSAGES[locale][key] ?? fallback) || key, values),
  };
  const document = {
    activeElement: null,
    querySelector: selector => selector === "dialog:modal" ? modals.at(-1) ?? null : null,
    querySelectorAll: selector => selector === "dialog:modal" ? modals : [],
  };
  const field = { value: "", focus: () => trace.push("focus-input") };
  const heading = { focus: () => trace.push("focus-heading") };
  const dialog = {
    open: false, hasAttribute: () => true, matches: selector => selector === ":modal" && modals.includes(dialog),
    showModal() { this.open = true; modals = [dialog]; trace.push("native-modal"); },
    close() { this.open = false; modals = modals.filter(item => item !== dialog); trace.push("close-dialog"); },
    removeAttribute() { this.open = false; }, setAttribute() { this.open = true; },
  };
  class Base extends EventTarget {
    i18n = i18n; isConnected = true; updateComplete = Promise.resolve();
    style = { removeProperty() {}, setProperty() {}, getPropertyValue: () => "0" }; dataset = {};
    requestUpdate() {} connectedCallback() {} disconnectedCallback() {} willUpdate() {} updated() {}
    querySelector(selector) { return selector === ".forma-assistant-specialist" ? dialog : selector === ".forma-assistant-input" ? field
      : selector === ".forma-assistant-header [data-assistant-heading]" ? heading : null; }
    querySelectorAll() { return []; }
    dispatchEvent(event) { emitted.push({ type: event.type, detail: event.detail }); return super.dispatchEvent(event); }
  }
  const previewExports = {};
  new Function("require", "exports", previewCode)(name => { assert.equal(name, "lit"); return lit; }, previewExports);
  const dependencies = {
    lit, "lit/directives/keyed.js": { keyed }, "../../model/conversation-context.ts": { ASSISTANT_CONTEXT_LIMITS },
    "../../model/context-consent-state.ts": { contextConsentAction },
    "../presentational-element.ts": { FormaPresentationalElement: Base }, "../icons.ts": { icon: () => lit.nothing },
    "../consequential-preview.ts": previewExports, "./native-dialog.ts": { ensureNativeModalDialog },
    "../output-navigation-focus.ts": { captureOutputNavigationFocus },
    "./conversation-composer.ts": {}, "./assistant-panel.css": {},
  };
  const exports = {};
  new Function("require", "exports", "customElements", "document", "window", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", panelCode)(
    name => { assert.ok(Object.hasOwn(dependencies, name), "explicit component port " + name); return dependencies[name]; },
    exports, { get: () => undefined, define() {} }, document, windowPort,
    callback => { frames.push(callback); return frames.length; }, id => { cancelledFrames.push(id); }, () => ({ matches: true }),
  );
  const panel = new exports.FormaAssistantPanel();
  panel.open = true; panel.conversationScope = "scope-a"; panel.pageLabel = "Authored context — سياق 日本語";
  panel.canSpecialist = true; panel.models = [
    { id: "gpt-5.6-luna", maximumMicrousd: 15000, premiumApprovalRequired: false },
    { id: "gpt-5.6-terra", maximumMicrousd: 25000, premiumApprovalRequired: false },
    { id: "gpt-5.6-sol", maximumMicrousd: 45000, premiumApprovalRequired: true },
  ];
  panel.addEventListener("forma-assistant-specialist-close", event => { if (panel.specialist?.id === event.detail.reviewId) panel.specialist = null; });
  const f = { panel, i18n, emitted, trace, frames, cancelledFrames, nativeWindow, dialog, field, document,
    setReview(state) { if (dialog.open) dialog.close(); panel.specialist = state; panel.updated(new Map([["specialist", undefined]])); emitted.length = 0; },
    topModal(other) { modals = other ? [dialog, other] : [dialog]; },
    clearEvents() { emitted.length = 0; },
    async flushFocus() { await Promise.resolve(); for (const frame of frames.splice(0)) frame(); },
  };
  f.render = () => {
    const refs = [];
    const val = value => {
      if (value == null || value === lit.nothing || typeof value === "boolean") return "";
      if (Array.isArray(value)) return value.map(val).join("");
      if (value?._$litDirective$ === keyed("", null)._$litDirective$) return val(value.values[1]);
      if (!value?.strings) return escape(value);
      let text = "";
      for (let i = 0; i < value.strings.length; i++) {
        text += value.strings[i];
        if (i < value.values.length) {
          if (text.lastIndexOf("<") > text.lastIndexOf(">")) text += "__binding_" + (refs.push(value.values[i]) - 1) + "__";
          else text += val(value.values[i]);
        }
      }
      return text;
    };
    const markup = val(panel.render());
    const resolve = value => /^__binding_\d+__$/u.test(value) ? refs[Number(value.match(/\d+/u)[0])] : value;
    const attributes = raw => {
      const attrs = {};
      for (const [, name, double, single, bare] of raw.matchAll(/([.?@\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu)) attrs[name] = resolve(double ?? single ?? bare ?? "");
      return attrs;
    };
    const buttons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)].map(([, raw, label]) => {
      const attrs = attributes(raw);
      return { label: unescape(label.replace(/<[^>]+>/gu, "")).trim(), attrs, disabled: Boolean(attrs["?disabled"]),
        click: attrs["@click"], accessibleName: attrs["aria-label"], node: { isConnected: true } };
    });
    const selects = [...markup.matchAll(/<label>([\s\S]*?)<select\b([^>]*)>([\s\S]*?)<\/select>[\s\S]*?<\/label>/gu)].map(([, label, raw]) => {
      const attrs = attributes(raw);
      return { label: unescape(label.replace(/<[^>]+>/gu, "")).trim(), attrs, disabled: Boolean(attrs["?disabled"]),
        change: attrs["@change"], accessibleName: attrs["aria-label"] };
    });
    const modalRaw = markup.match(/<dialog\b([^>]*)>/u)?.[1] ?? "", modalAttrs = attributes(modalRaw);
    return { markup, text: unescape(markup.replace(/<[^>]+>/gu, "")), buttons, selects,
      modalCancel: modalAttrs["@cancel"], modalClose: modalAttrs["@close"], modalKeydown: modalAttrs["@keydown"] };
  };
  f.button = (rendered, key) => {
    const found = rendered.buttons.find(button => button.label === i18n.t(key));
    assert.ok(found, "actual localized control " + key); return found;
  };
  return f;
}
const actionKey = kind => kind === "approve" ? "assistant.specialist.approve" : kind === "run-approved" ? "assistant.specialist.runApproved" : "assistant.specialist.retrieve";

for (const locale of ["en", "fr", "ar", "ja"]) {
  for (const kind of ["approve", "run-approved", "retrieve", "model"]) test(locale + ": a captured " + kind + " control cannot act on a replacement review", () => {
    const f = fixture(locale), previous = review(kind === "model" ? "approve" : kind);
    f.setReview(previous);
    const old = f.render(), captured = kind === "model" ? old.selects[0].change : f.button(old, actionKey(kind)).click;
    f.button(old, "assistant.specialist.close").click(); f.setReview(review(kind === "run-approved" ? "run-approved" : "approve", "b"));
    f.panel.draftForTest = "Never discard this unfinished guidance draft.\n".repeat(50);
    f.render(); f.clearEvents();
    captured({ currentTarget: { value: "gpt-5.6-sol" } });
    assert.deepEqual(f.emitted, [], "no action or model event may inherit the replacement request");
    assert.equal(f.panel.specialist.turnId, "turn-b");
    assert.equal(f.panel.draftForTest, "Never discard this unfinished guidance draft.\n".repeat(50));
  });
  test(locale + ": every reasoning-depth accessible name starts with its complete visible localized label", () => {
    const f = fixture(locale); f.setReview(review()); const select = f.render().selects[0];
    assert.ok(select.accessibleName.startsWith(select.label), JSON.stringify({ visible: select.label, accessible: select.accessibleName }));
    assert.ok(select.accessibleName.includes("\u2068turn-a\u2069"));
    assert.ok(select.accessibleName.includes("\u2068" + f.panel.pageLabel + "\u2069"));
  });
  test(locale + ": unsigned legacy rows never describe a historical estimate as approved", () => {
    const f = fixture(locale);
    f.panel.tasks = [{ id: "legacy-task", turnId: "legacy-turn", kind: "clarify", model: "gpt-5.6-luna", status: "needs-review",
      error: "assistant_legacy_approval_required", estimatedMicrousd: 15000 }];
    const before = structuredClone(f.panel.tasks), rendered = f.render();
    assert.ok(!rendered.text.includes(f.i18n.t("assistant.task.estimatedCost", "", { amount: new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(0.015) })));
    assert.deepEqual(f.panel.tasks, before);
    assert.deepEqual(f.emitted, []);
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test(locale + ": every current modal action emits its exact captured semantic control", () => {
    for (const kind of ["approve", "run-approved", "retrieve", "resume", "refresh"]) {
      const f = fixture(locale), state = review(kind); f.setReview(state);
      const key = kind === "refresh" ? "assistant.specialist.refresh" : actionKey(kind);
      const button = f.button(f.render(), key); assert.equal(button.disabled, false); button.click();
      assert.deepEqual(f.emitted, [{ type: "forma-assistant-specialist-action", detail: {
        reviewId: state.id, turnId: state.turnId, executionId: state.executionId,
        bindingHash: state.quote?.bindingHash ?? state.task?.bindingHash ?? "",
        action: kind === "refresh" ? "quote" : kind,
        ...(kind === "refresh" ? { model: state.originalRequest.model } : {}),
      } }]);
      assert.equal(f.panel.specialist, state, "the store-independent panel does not execute, buy, or replace a request");
    }
  });

  test(locale + ": a current model choice emits only a captured free-quote intention", () => {
    const f = fixture(locale), state = review(); f.setReview(state);
    f.render().selects[0].change({ currentTarget: { value: "gpt-5.6-sol" } });
    assert.deepEqual(f.emitted, [{ type: "forma-assistant-specialist-model", detail: {
      reviewId: state.id, turnId: state.turnId, executionId: state.executionId, bindingHash: state.quote.bindingHash,
      action: "quote", model: "gpt-5.6-sol",
    } }]);
    f.clearEvents(); f.render().selects[0].change({ currentTarget: { value: "unenrolled-model" } });
    assert.deepEqual(f.emitted, []);
  });

  test(locale + ": all modal, transcript, and model names preserve complete visible labels before isolated identity", () => {
    const f = fixture(locale), context = "\u2068" + f.panel.pageLabel + "\u2069";
    const assertName = control => {
      assert.ok(control.accessibleName.startsWith(control.label), JSON.stringify({ visible: control.label, accessible: control.accessibleName }));
      assert.ok(control.accessibleName.includes(context));
      assert.match(control.accessibleName, /\u2068(?:execution|turn)-a\u2069/u);
    };
    f.panel.messages = [{ id: "message", role: "assistant", text: "Saved guidance", savedTurnId: "turn-a", canReviewSpecialist: true }];
    assertName(f.button(f.render(), "assistant.specialist.review"));
    for (const kind of ["approve", "run-approved", "retrieve", "resume", "refresh"]) {
      f.setReview(review(kind));
      const rendered = f.render();
      for (const control of rendered.buttons.filter(button => button.label && button.accessibleName && button.attrs.class !== "icon-button forma-assistant-close")) assertName(control);
      for (const select of rendered.selects) assertName(select);
    }
    f.panel.specialist = null; f.panel.messages = []; f.panel.tasks = [review("retrieve").task];
    assertName(f.button(f.render(), "assistant.specialist.retrieve"));
  });

  test(locale + ": signed tasks retain approved-cost wording and unsigned references disclose unverified approval", () => {
    const f = fixture(locale), signed = review("run-approved").task;
    f.panel.tasks = [signed];
    const amount = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(0.015);
    const approved = f.i18n.t("assistant.task.estimatedCost", "", { amount });
    assert.ok(f.render().text.includes(approved));
    assert.ok(!f.render().text.includes(f.i18n.t("assistant.task.approvalUnverified")));
    for (const change of [{ executionId: undefined }, { id: "unsigned-legacy" }, { bindingHash: undefined }, { bindingHash: "not-a-signed-binding" },
      { error: "assistant_legacy_approval_required" }]) {
      const task = { ...signed, ...change }, before = structuredClone(task); f.panel.tasks = [task];
      const rendered = f.render();
      assert.ok(!rendered.text.includes(approved));
      assert.ok(rendered.text.includes(f.i18n.t("assistant.task.historicalEstimate", "", { amount })));
      assert.ok(rendered.text.includes(f.i18n.t("assistant.task.approvalUnverified")));
      assert.deepEqual(task, before, "wording cannot rewrite estimates, reservations, status, or spend");
    }
    assert.deepEqual(f.emitted, []);
  });

  test(locale + ": free refresh needs a complete positive unused proof, never error or submission hints", () => {
    const f = fixture(locale), present = () => f.render().buttons.some(button => button.label === f.i18n.t("assistant.specialist.refresh"));
    const cases = [
      state => { delete state.unusedExecution; }, state => { state.unusedExecution = false; }, state => { state.unusedExecution = "true"; },
      state => { state.unusedExecution = 1; }, state => { state.working = true; }, state => { state.notice = "uncertain"; },
      state => { state.notice = "lookupFailed"; }, state => { state.notice = "denied"; }, state => { state.retrievalOnly = false; },
      state => { state.quote = null; }, state => { state.quote.status = "reserved"; }, state => { state.quote.bindingHash = "unverified"; },
      state => { state.quote.executionId = "execution-b"; }, state => { state.originalRequest = null; },
      state => { state.originalRequest.turnId = "turn-b"; }, state => { state.originalRequest.model = "gpt-5.6-sol"; },
      state => { state.originalRequest.sourceHash = "other-source"; }, state => { state.originalRequest.documentId = "other-document"; },
      state => { state.originalRequest.canvasId = "other-board"; }, state => { state.task = review("run-approved").task; },
      state => { state.task = { id: "execution-b", executionId: "execution-b", turnId: "turn-b", status: "needs-review", recoveryOnly: true }; },
      state => { state.resultReply = "Existing recorded result"; }, state => { state.resultReply = ""; },
      state => { state.unusedExecution = undefined; state.quote.status = "quoted"; state.task = { ...review("run-approved").task, submission: "not-submitted" }; },
    ];
    for (const mutate of cases) { const state = review("refresh"); mutate(state); f.setReview(state); assert.equal(present(), false); }
    const valid = review("refresh", "a", { task: { id: "execution-a", executionId: "execution-a", turnId: "turn-a", bindingHash: "a".repeat(64), status: "needs-review", recoveryOnly: true } });
    f.setReview(valid); assert.equal(present(), true, "a same-request content-free host reference is not a backend execution");
    f.panel.canSpecialist = false; assert.equal(present(), false);
    assert.deepEqual(f.emitted, []);
  });

  test(locale + ": captured identity is a value snapshot even if the old view object is mutated", () => {
    for (const mutate of [
      state => { state.id = "review-b"; }, state => { state.turnId = "turn-b"; },
      state => { state.executionId = "execution-b"; }, state => { state.quote.bindingHash = "b".repeat(64); },
    ]) {
      const f = fixture(locale), state = review(); f.setReview(state);
      const approve = f.button(f.render(), "assistant.specialist.approve").click;
      mutate(state); approve(); assert.deepEqual(f.emitted, []);
    }
  });

  test(locale + ": stale semantic intent cannot become another action even with unchanged identity", () => {
    for (const kind of ["approve", "run-approved", "retrieve", "refresh", "model"]) {
      const f = fixture(locale), state = review(kind === "model" ? "approve" : kind); f.setReview(state);
      const rendered = f.render(), control = kind === "model" ? rendered.selects[0].change
        : f.button(rendered, kind === "refresh" ? "assistant.specialist.refresh" : actionKey(kind)).click;
      if (kind === "approve" || kind === "model") { state.retrievalOnly = true; state.quote.status = "reserved"; state.task = review("run-approved").task; }
      else if (kind === "run-approved") { state.task.canExecute = false; state.quote.canExecute = false; state.quote.status = "completed"; }
      else if (kind === "retrieve") { state.retrievalOnly = false; state.quote.status = "quoted"; state.quote.canExecute = true; state.task = null; }
      else state.unusedExecution = false;
      control({ currentTarget: { value: "gpt-5.6-sol" } }); assert.deepEqual(f.emitted, []);
    }
  });

  test(locale + ": native readiness, current scope, visibility, and a competing modal fence captured controls", () => {
    for (const boundary of ["closed", "disconnected", "scope", "working", "foreign-modal", "not-modal", "permission"]) {
      const f = fixture(locale); f.setReview(review());
      const approve = f.button(f.render(), "assistant.specialist.approve").click;
      if (boundary === "closed") f.panel.open = false;
      else if (boundary === "disconnected") f.panel.isConnected = false;
      else if (boundary === "scope") f.panel.conversationScope = "scope-b";
      else if (boundary === "working") f.panel.specialist.working = true;
      else if (boundary === "foreign-modal") f.topModal({ open: true });
      else if (boundary === "not-modal") f.dialog.close();
      else f.panel.canSpecialist = false;
      approve(); assert.deepEqual(f.emitted, []);
    }
    const reader = fixture(locale); reader.setReview(review("retrieve")); reader.panel.readOnly = true; reader.panel.canSpecialist = false;
    fButton(reader, "assistant.specialist.retrieve").click();
    assert.equal(reader.emitted[0].detail.action, "retrieve", "current read-only recovery never needs purchase authority");
  });

  test(locale + ": native dismissal still keeps the draft and obsolete close or Escape cannot dismiss a replacement", async () => {
    const f = fixture(locale), draft = "Preserve the complete unfinished draft.\n".repeat(60);
    f.panel.draftForTest = draft; f.setReview(review());
    const old = f.render();
    f.button(old, "assistant.specialist.close").click();
    assert.equal(f.panel.specialist, null); assert.equal(f.panel.draftForTest, draft);
    await f.flushFocus();
    assert.ok(f.trace.includes("focus-heading"));
    f.setReview(review("approve", "b")); f.trace.length = 0; f.clearEvents();
    const event = { preventDefault() {}, stopPropagation() {}, key: "Escape", isComposing: false, currentTarget: { open: false } };
    old.modalClose(event); old.modalCancel(event); old.modalKeydown(event); await f.flushFocus();
    assert.equal(f.panel.specialist.id, "review-b"); assert.deepEqual(f.emitted, []); assert.deepEqual(f.trace, []);
    const current = f.render(); current.modalKeydown(event); await f.flushFocus();
    assert.equal(f.panel.specialist, null); assert.equal(f.panel.draftForTest, draft);
  });

  test(locale + ": Stop keeps its existing exact task contract and cannot inherit another approved request", () => {
    const f = fixture(locale), state = review("run-approved");
    state.quote.providerAvailable = false; state.quote.expiresAt = "2000-01-01T00:00:00Z"; state.quote.canExecute = false; state.task.canExecute = false;
    f.setReview(state);
    const stop = f.button(f.render(), "assistant.specialist.stop"); assert.equal(stop.disabled, false);
    stop.click(); assert.deepEqual(f.emitted, [{ type: "forma-assistant-task", detail: { task: state.task, action: "cancel" } }]);
    f.setReview(review("run-approved", "b")); stop.click(); assert.deepEqual(f.emitted, []);
  });

  test(locale + ": a failed lookup notice does not relabel certified settlement or offer unproved refresh", () => {
    const f = fixture(locale), state = review("retrieve", "a", { notice: "lookupFailed" }); f.setReview(state);
    const rendered = f.render();
    assert.ok(rendered.text.includes(f.i18n.t("assistant.specialist.lookupFailed")));
    assert.ok(rendered.text.includes(f.i18n.t("assistant.specialist.settled")));
    assert.ok(!rendered.text.includes(f.i18n.t("assistant.specialist.billingUnknown")));
    assert.ok(!rendered.buttons.some(button => button.label === f.i18n.t("assistant.specialist.refresh")));
    assert.equal(state.task.submission, "settled"); assert.equal(state.quote.status, "completed");
  });
}
function fButton(fixture, key) { return fixture.button(fixture.render(), key); }

// D411 exercises the existing complete panel class through its ordinary
// updated -> queued RAF -> private placement path. These are explicitly
// synthetic native geometry inputs, not a DOM/CSS renderer or production
// artifact reconstruction. CSS offset ownership is gated separately.
function d411Rect(left, top, width, height) {
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height };
}
function d411Placement(t, controls = [], viewport = { width: 419.5, height: 398.5 }, nativeWindow) {
  const f = fixture("en", nativeWindow), values = new Map(), writes = [], boxes = [], restore = [];
  const x = { f, controls, regions: [], queries: [], values, writes, boxes, hovered: false };
  const setGlobal = (key, value) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    restore.push(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  };
  t.after(() => { for (const undo of restore.reverse()) undo(); });
  setGlobal("innerWidth", viewport.width);
  setGlobal("innerHeight", viewport.height);
  setGlobal("getComputedStyle", element => ({
    opacity: element.opacity ?? "1",
    visibility: element.visibility ?? "visible", pointerEvents: element.pointerEvents ?? "auto",
    overflowX: element.overflowX ?? "visible", overflowY: element.overflowY ?? "visible",
    transform: element.transform ?? "none", translate: element.translate ?? "none",
    rotate: element.rotate ?? "none", scale: element.scale ?? "none", perspective: element.perspective ?? "none",
    outlineStyle: element.outlineStyle ?? "none", outlineWidth: element.outlineWidth ?? "0px",
    outlineOffset: element.outlineOffset ?? "0px", boxShadow: element.boxShadow ?? "none",
    zoom: element.zoom ?? "1", filter: element.filter ?? "none",
  }));
  f.panel.open = false;
  f.panel.style = {
    setProperty(name, value) { values.set(name, value); writes.push([name, value]); },
    getPropertyValue(name) { return values.get(name) ?? ""; },
    removeProperty(name) { values.delete(name); },
  };
  f.panel.contains = element => Boolean(element?.assistantOwned);
  const launcher = {
    matches: selector => selector === ":hover" && x.hovered,
    contains: element => element === launcher,
    getBoundingClientRect() {
      const offset = Number.parseFloat(values.get("--forma-assistant-obstacle-offset") || "0");
      const width = f.panel.dataset.compactLauncher === "true" ? 44 : 137.1875;
      const box = d411Rect(409.5 - width, 346.5 - offset, width, 44);
      boxes.push({ ...box, offset, compact: f.panel.dataset.compactLauncher === "true" });
      return box;
    },
  };
  const query = f.panel.querySelector.bind(f.panel);
  f.panel.querySelector = selector => selector === ".forma-assistant-launcher" ? launcher : query(selector);
  f.document.querySelectorAll = selector => {
    if (selector === "dialog:modal") return [];
    const controlsOnly = "a[href], button, input, textarea, select, summary, [role='button'], [contenteditable='true']";
    const withTaskRegions = controlsOnly + ", .output-requirement-warning, .output-recipe-entry, forma-ui-notice";
    x.queries.push(selector);
    if (selector === controlsOnly) return x.controls;
    assert.equal(selector, withTaskRegions, "only the explicit existing-region successor query is an added native port");
    return [...x.controls, ...x.regions];
  };
  x.launcher = launcher;
  x.control = (rect, properties = {}) => ({
    tagName: "TEXTAREA", parentElement: null, getBoundingClientRect: () => rect,
    closest(selector) {
      if (selector === "[hidden], [inert], [aria-hidden='true']") return this.hiddenAncestor ? {} : null;
      assert.equal(selector, ":modal, :popover-open", "only the existing native top-layer boundary is an added port");
      return this.topLayer ?? null;
    }, ...properties,
  });
  x.ancestor = (rect, properties = {}) => ({
    parentElement: null, clientLeft: 0, clientTop: 0, clientWidth: rect.width, clientHeight: rect.height,
    getBoundingClientRect: () => rect, ...properties,
  });
  x.run = () => {
    boxes.length = 0; writes.length = 0; x.queries.length = 0;
    f.panel.updated(new Map());
    assert.equal(f.frames.length, 1, "the unchanged panel schedules its real placement callback");
    f.frames.shift()(0);
    assert.equal(f.frames.length, 0, "one finite placement pass does not schedule a polling loop");
    return launcher.getBoundingClientRect();
  };
  x.overlap = (box, rectangles = x.controls.map(control => control.getBoundingClientRect())) => rectangles.filter(obstacle => {
    return box.left < obstacle.right && box.right > obstacle.left && box.top < obstacle.bottom && box.bottom > obstacle.top;
  });
  return x;
}

test("D411 actual panel keeps ordinary short moves, exact field focus and unsent guidance unchanged", { concurrency: false }, t => {
  const x = d411Placement(t), obstacle = x.control(d411Rect(300, 365, 90, 25));
  x.controls.push(obstacle); x.f.document.activeElement = obstacle;
  x.f.panel.draftForTest = "  Preserve this unsent guidance.  ";
  const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages };
  const box = x.run();
  assert.equal(x.overlap(box).length, 0);
  assert.equal(box.bottom, 357, "the original eight-pixel obstacle gap remains");
  assert.equal(x.f.panel.dataset.compactLauncher, undefined);
  assert.equal(x.f.document.activeElement, obstacle);
  assert.equal(x.f.panel.draftForTest, "  Preserve this unsent guidance.  ");
  assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
  assert.deepEqual(x.f.emitted, []);
});

test("D411 actual panel clears a tall focused field and the next upstream control rather than stopping at the old travel cap", { concurrency: false }, t => {
  const x = d411Placement(t);
  // The field uses the observed D411 rectangle. The extra upstream control is
  // explicitly synthetic: it verifies another obstacle is reconsidered.
  const field = x.control(d411Rect(101, 251.51171875, 282, 138));
  const upstream = x.control(d411Rect(300, 195, 100, 44), { tagName: "BUTTON" });
  x.controls.push(field, upstream); x.f.document.activeElement = field;
  const box = x.run();
  assert.equal(x.f.document.activeElement, field);
  assert.deepEqual(x.f.emitted, []);
  assert.equal(x.overlap(box).length, 0, "the actual routine must clear every intersecting control, not just the initial textarea");
  assert.ok(box.top >= 8 && box.bottom <= 390.5);
  assert.equal(box.bottom, 187, "the second control still owns eight pixels of clearance");
  assert.ok(boxesOver128(x), "a viewport-safe move beyond 128px is required by this input");
});

test("D411 actual compact fallback uses the same predicted viewport bound and clears successive obstacles", { concurrency: false }, t => {
  const x = d411Placement(t);
  // This lane-only synthetic control makes the wider normal launcher unable
  // to move up; the existing 44px compact lane does not intersect it.
  const normalLane = x.control(d411Rect(275, 0, 65, 398.5), { tagName: "BUTTON" });
  const field = x.control(d411Rect(101, 251.51171875, 282, 138));
  const upstream = x.control(d411Rect(370, 180, 39.5, 60), { tagName: "BUTTON" });
  x.controls.push(normalLane, field, upstream); x.f.document.activeElement = field;
  const box = x.run();
  assert.equal(x.f.panel.dataset.compactLauncher, "true", "reuse the existing compact posture instead of inventing another position owner");
  assert.equal(box.width, 44); assert.equal(box.height, 44);
  assert.equal(x.f.document.activeElement, field); assert.deepEqual(x.f.emitted, []);
  assert.equal(x.overlap(box).length, 0, "compact fallback must recheck all controls after each move");
  assert.ok(box.top >= 8 && box.bottom <= 390.5);
  assert.equal(box.bottom, 172);
  assert.ok(boxesOver128(x));
});

test("D411 placement keeps an impossible vertical lane bounded and finite instead of moving the launcher offscreen", { concurrency: false }, t => {
  const x = d411Placement(t), full = x.control(d411Rect(0, 0, 419.5, 398.5));
  x.controls.push(full); x.f.document.activeElement = full;
  const box = x.run();
  assert.ok(box.top >= 8 && box.bottom <= 390.5);
  assert.ok(x.boxes.length <= 14, "retain the existing eight normal and four compact attempt budgets");
  assert.equal(x.f.document.activeElement, full); assert.deepEqual(x.f.emitted, []);
  assert.equal(x.overlap(box).length, 1, "this explicit no-space counterexample is not misreported as clear");
});

// D428 explicitly supersedes the old overlapping-current-focus hover policy
// with the Account-return witness. Noncolliding hover and own-focus still freeze.
test("D411 noncolliding launcher hover and its own current focus still freeze placement without stealing page focus", { concurrency: false }, t => {
  const x = d411Placement(t), field = x.control(d411Rect(101, 100, 282, 44));
  x.controls.push(field); x.values.set("--forma-assistant-obstacle-offset", "32px");
  x.f.panel.dataset.compactLauncher = "true"; x.f.document.activeElement = field; x.hovered = true;
  assert.equal(x.overlap(x.launcher.getBoundingClientRect()).length, 0,
    "the retained ordinary-hover freeze now has an explicitly noncolliding current focus");
  x.run(); assert.deepEqual(x.writes, []); assert.equal(x.values.get("--forma-assistant-obstacle-offset"), "32px");
  assert.equal(x.f.document.activeElement, field);
  x.hovered = false; x.f.document.activeElement = x.launcher;
  x.run(); assert.deepEqual(x.writes, []); assert.equal(x.values.get("--forma-assistant-obstacle-offset"), "32px");
  assert.equal(x.f.document.activeElement, x.launcher); assert.deepEqual(x.f.emitted, []);
});

// D428 explicitly replaces only the former disabled-control exclusion with
// the actual Save-row avoidance witness below; all other boundaries remain.
test("D411 hidden, private-host and noninteractive geometry exclusions remain unchanged", { concurrency: false }, t => {
  const x = d411Placement(t), full = d411Rect(0, 0, 419.5, 398.5);
  x.controls.push(
    x.control(full, { hiddenAncestor: true }),
    x.control(full, { assistantOwned: true }), x.control(full, { visibility: "hidden" }),
    x.control(full, { pointerEvents: "none" }), x.control(d411Rect(0, 0, 0, 398.5)),
    x.control(d411Rect(500, 0, 44, 44)), x.control(d411Rect(0, 500, 44, 44)),
  );
  const box = x.run();
  assert.equal(box.top, 346.5); assert.equal(box.bottom, 390.5);
  assert.equal(x.f.panel.dataset.compactLauncher, undefined);
  assert.deepEqual(x.f.emitted, []);
});
function boxesOver128(x) { return x.boxes.some(box => box.offset > 128); }


test("D411 measured 28-control arrangement clears every painted obstacle without phantom scrolled controls", { concurrency: false }, t => {
  const x = d411Placement(t, [], { width: 419, height: 398 });
  // Numeric ports below come from D411-live-assistant-obstacles-20260901.json
  // SHA256 8868602a391222a9a1f72f82cb463a053a6368b24b004d7511c5b9fe94666378.
  // They are not a reconstructed DOM or browser rendering. The normal 137.1875px
  // launcher width is an explicit synthetic port; the captured compact width is 44px.
  const app = x.ancestor(d411Rect(0, 0, 420, 399), { overflowX: "clip", overflowY: "clip" });
  const main = x.ancestor(d411Rect(0, 48, 420, 351), { parentElement: app, overflowX: "clip", overflowY: "clip" });
  const workspace = x.ancestor(d411Rect(72, 48, 348, 351), { parentElement: main, overflowX: "clip", overflowY: "clip" });
  const audience = x.ancestor(d411Rect(0, 48, 71, 351), { parentElement: app, overflowX: "auto", overflowY: "auto" });
  const nav = x.ancestor(d411Rect(72, 145, 340, 40), { parentElement: workspace, overflowX: "auto", overflowY: "auto" });
  const families = x.ancestor(d411Rect(78, 153, 327, 44), { parentElement: nav, overflowX: "auto", overflowY: "auto" });
  const links = x.ancestor(d411Rect(-137.46875, 191, 759, 60), { parentElement: nav, overflowX: "auto", overflowY: "auto" });
  const tasks = x.ancestor(d411Rect(72, 193, 348, 44), { parentElement: workspace, overflowX: "auto", overflowY: "auto" });
  const grid = x.ancestor(d411Rect(72, 243.5, 348, 155), { parentElement: workspace, overflowX: "clip", overflowY: "clip" });
  const context = x.ancestor(d411Rect(72, 243.5, 340, 154), { parentElement: grid, overflowX: "auto", overflowY: "auto" });
  // A final null means wholly clipped. A final rectangle is an explicit expected
  // intersection derived from captured raw/client bounds; absent means the raw rectangle.
  const rows = [
    ["BUTTON", 8, 1.5, 44, 44, app],
    ["BUTTON", 58, 1.5, 170.65234375, 44, app],
    ["SELECT", 239.9921875, 1.5, 75.5078125, 44, app],
    ["BUTTON", 319.5, 1.5, 44, 44, app],
    ["BUTTON", 367.5, 1.5, 44, 44, app],
    ["A", 4, 48, 63, 68.5, audience],
    ["A", 4, 118.5, 63, 68.5, audience],
    ["A", 4, 189, 63, 68.5, audience],
    ["A", 4, 259.5, 63, 68.5, audience],
    ["A", 4, 330, 63, 68.5, audience, d411Rect(4, 330, 63, 68)],
    ["BUTTON", 76, 50.5, 44, 50, workspace],
    ["BUTTON", 303.140625, 50, 28, 44, workspace],
    ["BUTTON", 88.77734375, 98, 44, 44, workspace],
    ["BUTTON", 192.77734375, 98, 114.23046875, 44, workspace],
    ["A", 78, 153, 51.55078125, 44, families, d411Rect(78, 153, 51.55078125, 32)],
    ["A", 131.55078125, 153, 56.5234375, 44, families, d411Rect(131.55078125, 153, 56.5234375, 32)],
    ["A", 190.07421875, 153, 65.40234375, 44, families, d411Rect(190.07421875, 153, 65.40234375, 32)],
    ["A", -32.79296875, 199, 119.19140625, 44, links, null],
    ["A", 89.59765625, 199, 104.78125, 44, links, null],
    ["A", 197.578125, 199, 110.8046875, 44, links, null],
    ["A", 311.58203125, 199, 115.91796875, 44, links, null],
    ["BUTTON", 219, 245, 46, 44, nav, null],
    ["BUTTON", 219, 291, 46, 44, nav, null],
    ["BUTTON", 88, 193, 61.80078125, 44, tasks],
    ["BUTTON", 153.80078125, 193, 130.3125, 44, tasks],
    ["BUTTON", 288.11328125, 193, 132.2421875, 44, tasks, d411Rect(288.11328125, 193, 130.88671875, 44)],
    ["INPUT", 101, 112.51171875, 282, 44, context, null],
    ["TEXTAREA", 101, 251.51171875, 282, 138, context],
  ];
  const visible = [];
  for (const [tagName, left, top, width, height, parentElement, painted] of rows) {
    const raw = d411Rect(left, top, width, height);
    x.controls.push(x.control(raw, { tagName, parentElement }));
    if (painted !== null) visible.push(painted ?? raw);
  }
  const field = x.controls[27];
  field.value = "  Keep the exact unsent original request.  ";
  x.f.document.activeElement = field;
  assert.equal(x.controls.length, 28);
  assert.equal(visible.length, 21, "retain each recorded wholly or partially painted control");
  assert.equal(x.controls[26].getBoundingClientRect().bottom < context.getBoundingClientRect().top, true,
    "the package input is raw-viewport eligible but entirely outside its own scrollport");
  assert.equal(links.getBoundingClientRect().top > nav.getBoundingClientRect().bottom, true,
    "the nested links have an empty actual ancestor intersection");
  const box = x.run();
  assert.equal(x.f.document.activeElement, field);
  assert.equal(field.value, "  Keep the exact unsent original request.  ");
  assert.deepEqual(x.f.emitted, []);
  assert.equal(x.overlap(box, visible).length, 0, "all measured painted obstacles, not just the focused field, must remain clear");
  assert.equal(x.f.panel.dataset.compactLauncher, "true");
  assert.equal(box.width, 44); assert.equal(box.height, 44);
  assert.equal(box.top, 141); assert.equal(box.bottom, 185, "Assigned review retains the existing eight-pixel gap");
  assert.equal(x.values.get("--forma-assistant-obstacle-offset"), "205.5px");
  assert.ok(box.top >= 8 && box.bottom <= 390.5);
  assert.ok(x.overlap(box).includes(x.controls[26].getBoundingClientRect()), "the valid free gap may overlap the unpainted raw package-input rectangle");
});

test("D411 partial vertical clipping uses client borders and does not clip an overflow-visible horizontal axis", { concurrency: false }, t => {
  const x = d411Placement(t);
  const scrollport = x.ancestor(d411Rect(0, 337, 84, 56), {
    clientLeft: 2, clientTop: 3, clientWidth: 80, clientHeight: 50, overflowX: "visible", overflowY: "clip",
  });
  const field = x.control(d411Rect(300, 320, 90, 70), { parentElement: scrollport });
  x.controls.push(field); x.f.document.activeElement = field;
  const box = x.run();
  assert.equal(x.f.document.activeElement, field); assert.deepEqual(x.f.emitted, []);
  assert.equal(box.bottom, 332, "use the visible y=340 client edge, not raw y=320 or the border-box edge");
  assert.equal(x.overlap(box, [d411Rect(300, 340, 90, 50)]).length, 0);
  assert.equal(x.values.get("--forma-assistant-obstacle-offset"), "58.5px");
});

test("D411 horizontal clipping retains a partial control, drops only the fully clipped peer and leaves visible overflow vertical", { concurrency: false }, t => {
  const x = d411Placement(t);
  const scrollport = x.ancestor(d411Rect(0, 0, 367, 24), {
    clientLeft: 2, clientTop: 2, clientWidth: 363, clientHeight: 20, overflowX: "clip", overflowY: "visible",
  });
  const partial = x.control(d411Rect(340, 370, 50, 20), { parentElement: scrollport });
  const hidden = x.control(d411Rect(370, 340, 40, 25), { parentElement: scrollport });
  x.controls.push(partial, hidden); x.f.document.activeElement = partial;
  const box = x.run();
  assert.equal(x.f.document.activeElement, partial); assert.deepEqual(x.f.emitted, []);
  assert.equal(box.bottom, 362, "the painted x=340..365 portion keeps its gap; the hidden x=370 peer must not push it again");
  assert.equal(x.overlap(box, [d411Rect(340, 370, 25, 20)]).length, 0);
  assert.equal(x.values.get("--forma-assistant-obstacle-offset"), "28.5px");
});

test("D411 native modal and popover boundaries keep their own clip but not outer clips or transforms", { concurrency: false }, t => {
  const x = d411Placement(t);
  const outer = x.ancestor(d411Rect(0, 0, 100, 100), {
    overflowX: "hidden", overflowY: "hidden", transform: "matrix(2, 0, 0, 2, 0, 0)",
  });
  for (const nativeKind of ["modal", "popover"]) {
    const topLayer = x.ancestor(d411Rect(290, 340, 110, 56), {
      parentElement: outer, clientLeft: 2, clientTop: 3, clientWidth: 106, clientHeight: 50,
      overflowX: "auto", overflowY: "auto", nativeKind,
    });
    const field = x.control(d411Rect(300, 330, 90, 60), { parentElement: topLayer, topLayer });
    x.controls.splice(0, x.controls.length, field); x.f.document.activeElement = field;
    const box = x.run();
    assert.equal(x.f.document.activeElement, field); assert.deepEqual(x.f.emitted, []);
    assert.equal(box.bottom, 335, nativeKind + " clips at its own client y=343, not its outer normal-flow ancestor");
    assert.equal(x.overlap(box, [d411Rect(300, 343, 90, 47)]).length, 0);
  }
  const promotedControl = x.control(d411Rect(300, 350, 90, 40), { tagName: "BUTTON", parentElement: outer });
  promotedControl.topLayer = promotedControl;
  x.controls.splice(0, x.controls.length, promotedControl); x.f.document.activeElement = promotedControl;
  const box = x.run();
  assert.equal(box.bottom, 342, "a control that is itself in the native top layer has no outside clipping ancestor");
  assert.equal(x.f.document.activeElement, promotedControl); assert.deepEqual(x.f.emitted, []);
});

test("D411 transformed ancestor chains retain prior raw-box behavior instead of mixing transformed bounds and client sizes", { concurrency: false }, t => {
  const x = d411Placement(t);
  const transformed = x.ancestor(d411Rect(0, 0, 419, 398));
  const inner = x.ancestor(d411Rect(0, 0, 100, 100), { parentElement: transformed, overflowX: "clip", overflowY: "clip" });
  const field = x.control(d411Rect(300, 350, 90, 40), { parentElement: inner });
  x.controls.push(field); x.f.document.activeElement = field;
  const transforms = { transform: "matrix(2, 0, 0, 2, 0, 0)", translate: "10px 0px", rotate: "10deg", scale: "2", perspective: "500px" };
  for (const [property, value] of Object.entries(transforms)) {
    for (const key of Object.keys(transforms)) transformed[key] = "none";
    transformed[property] = value;
    const box = x.run();
    assert.equal(x.f.document.activeElement, field); assert.deepEqual(x.f.emitted, []);
    assert.equal(box.bottom, 342, property + ": preserve the former conservative raw rectangle even after a lower empty clip");
    assert.equal(x.overlap(box).length, 0);
  }
});

// D420 reuses the same actual panel/RAF path and explicit native geometry ports.
// The three Document cases use measured raw/visible rectangles from
// D420-current-document-focus-and-critical-copy-20260901.json, SHA256
// 2463d265c6af03d627fef12a64f4e4511d9d3ba87ce6fc4fe203e9c9b730cd26.
// Each is a bounded scene subset, not a reconstructed DOM, Card journey,
// stylesheet renderer, keyboard test, or proof that an entire long entry fits.
// Noncontrol regions are supplied ONLY to the exact successor query.
const d420TaskRegionQuery = "a[href], button, input, textarea, select, summary, [role='button'], [contenteditable='true'], .output-requirement-warning, .output-recipe-entry, forma-ui-notice";

test("D420 actual placement clears the measured Cancel decision heading as well as Keep and Discard", { concurrency: false }, t => {
  const x = d411Placement(t, [], { width: 419, height: 398 });
  const context = x.ancestor(d411Rect(72, 243.5, 340, 154), { overflowX: "auto", overflowY: "auto" });
  const keep = x.control(d411Rect(114, 298.53125, 256, 44), { tagName: "BUTTON", parentElement: context });
  const discard = x.control(d411Rect(114, 350.53125, 256, 44), { tagName: "BUTTON", parentElement: context });
  const warning = x.control(d411Rect(101, 251.93359375, 282, 155.59765625), {
    tagName: "DIV", className: "output-requirement-warning", parentElement: context,
  });
  const heading = d411Rect(114, 264.93359375, 256, 21.59765625);
  const paintedWarning = d411Rect(101, 251.93359375, 282, 145.56640625);
  assert.ok(read("src/components/forma-output-requirement-card.ts")
    .includes('<div class="output-requirement-warning"><h4>${this.#t("discardTitle")}</h4>'),
  "the existing decision owner includes its heading, not only its action buttons");
  x.controls.push(keep, discard); x.regions.push(warning); x.f.document.activeElement = keep;
  x.f.panel.draftForTest = "  Keep this unsent assistant guidance.  ";
  const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages };
  assert.equal(x.controls.includes(warning), false, "a DIV is not an old-query native control");
  const box = x.run();
  assert.equal(x.f.document.activeElement, keep);
  assert.equal(x.f.panel.draftForTest, "  Keep this unsent assistant guidance.  ");
  assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
  assert.deepEqual(x.f.emitted, []);
  assert.equal(x.overlap(box).length, 0, "clear native controls before evaluating the decision copy");
  assert.ok(box.top >= 8 && box.bottom <= 390.5);
  assert.equal(x.overlap(box, [heading]).length, 0, "Cancel's visible decision heading must not be obscured by Ask Forma");
  assert.equal(x.overlap(box, [paintedWarning]).length, 0, "protect only the painted part of the existing warning owner");
  assert.deepEqual(x.queries, [d420TaskRegionQuery]);
});

test("D420 actual placement clears the measured retained-entry capability caveat after Discard", { concurrency: false }, t => {
  const x = d411Placement(t, [], { width: 419, height: 398 });
  const context = x.ancestor(d411Rect(72, 243.5, 340, 154), { overflowX: "auto", overflowY: "auto" });
  const review = x.control(d411Rect(88, 289.11328125, 308, 62.796875), { tagName: "BUTTON", parentElement: context });
  const entry = x.control(d411Rect(88, -354.44921875, 308, 867.15234375), {
    tagName: "DETAILS", className: "output-recipe-entry", open: true, parentElement: context,
  });
  // The paragraph's raw y=133.125..261.11328125 is mostly above the scrollport.
  const paintedCaveat = d411Rect(88, 243.5, 308, 17.61328125);
  const paintedEntry = d411Rect(88, 243.5, 308, 154);
  const source = read("src/components/forma-output-requirements.ts");
  assert.ok(source.includes('<details class="output-recipe-entry"'));
  assert.ok(source.includes('<p>${this.#recipeMessage("limitation")}</p><button type="submit"'));
  x.controls.push(review); x.regions.push(entry); x.f.document.activeElement = review;
  x.f.panel.draftForTest = "  Do not turn these notes into an approved request.  ";
  assert.equal(x.controls.includes(entry), false);
  const box = x.run();
  assert.equal(x.f.document.activeElement, review); assert.equal(entry.open, true);
  assert.equal(x.f.panel.draftForTest, "  Do not turn these notes into an approved request.  ");
  assert.deepEqual(x.f.emitted, []);
  assert.equal(x.overlap(box).length, 0, "the wrapped 62.796875px Review control remains clear");
  assert.ok(box.top >= 8 && box.bottom <= 390.5);
  assert.equal(x.overlap(box, [paintedCaveat]).length, 0, "the currently visible capability limitation remains readable");
  assert.equal(x.overlap(box, [paintedEntry]).length, 0, "reserve the visible entry intersection, not its full 867px raw height");
  assert.deepEqual(x.queries, [d420TaskRegionQuery]);
});

test("D420 actual placement clears the measured recipe-not-content caveat when Clear returns to its still-open summary", { concurrency: false }, t => {
  const x = d411Placement(t, [], { width: 419, height: 398 });
  const context = x.ancestor(d411Rect(72, 243.5, 340, 154), { overflowX: "auto", overflowY: "auto" });
  const summary = x.control(d411Rect(88, 298.55078125, 308, 44), { tagName: "SUMMARY", parentElement: context });
  const entry = x.control(d411Rect(88, 298.55078125, 308, 742.359375), {
    tagName: "DETAILS", className: "output-recipe-entry", open: true, parentElement: context,
  });
  // Only y=342.55078125..397.5 of the raw 76.79296875px hint is painted.
  const paintedHint = d411Rect(88, 342.55078125, 308, 54.94921875);
  const paintedEntry = d411Rect(88, 298.55078125, 308, 98.94921875);
  const source = read("src/components/forma-output-requirements.ts");
  assert.ok(source.includes('</summary><p>${this.#recipeMessage("hint")}</p>'));
  assert.ok(source.includes("this.#clearRecipePresentation(); this.#recipeEntryOpen = entryOpen;"),
    "the actual Clear path preserves native entry openness");
  x.controls.push(summary); x.regions.push(entry); x.f.document.activeElement = summary;
  x.f.panel.draftForTest = "  Independent unsent assistant guidance.  ";
  assert.equal(x.controls.includes(entry), false);
  const box = x.run();
  assert.equal(x.f.document.activeElement, summary); assert.equal(entry.open, true);
  assert.equal(x.f.panel.draftForTest, "  Independent unsent assistant guidance.  ");
  assert.deepEqual(x.f.emitted, []);
  assert.equal(x.overlap(box).length, 0, "a clear summary alone is not a clear explanatory passage");
  assert.ok(box.top >= 8 && box.bottom <= 390.5);
  assert.equal(x.overlap(box, [paintedHint]).length, 0, "the visible recipe/plan/permission caveat remains readable");
  assert.equal(x.overlap(box, [paintedEntry]).length, 0);
  assert.deepEqual(x.queries, [d420TaskRegionQuery]);
});

test("D420 actual placement protects the existing shared notice host and rechecks a native control above it", { concurrency: false }, t => {
  const x = d411Placement(t);
  // Explicit synthetic host geometry: this is not a captured Notice screenshot.
  const control = x.control(d411Rect(300, 300, 90, 44), { tagName: "BUTTON" });
  const notice = x.control(d411Rect(300, 350, 90, 40), { tagName: "FORMA-UI-NOTICE" });
  const source = read("src/components/design-system/feedback.ts");
  assert.ok(source.includes("export class FormaUiNotice extends FormaSlottedElement"));
  assert.ok(source.includes('class="ui-notice-copy"'));
  assert.ok(read("src/components/design-system/slotted-element.ts").includes(":host(forma-ui-notice)"),
    "select the existing block host, not an internal shadow .ui-notice selector");
  x.controls.push(control); x.regions.push(notice); x.f.document.activeElement = control;
  x.f.panel.draftForTest = "  Keep the current guidance.  ";
  assert.equal(x.controls.includes(notice), false);
  const box = x.run();
  assert.equal(x.f.document.activeElement, control);
  assert.equal(x.f.panel.draftForTest, "  Keep the current guidance.  ");
  assert.deepEqual(x.f.emitted, []);
  assert.equal(x.overlap(box).length, 0, "a move around the notice must still reconsider the native button");
  assert.ok(box.top >= 8 && box.bottom <= 390.5);
  assert.equal(x.overlap(box, [notice.getBoundingClientRect()]).length, 0, "the shared notice host is an obstacle even without an interactive descendant");
  assert.deepEqual(x.queries, [d420TaskRegionQuery]);
});

test("D420 a native closed entry stays summary-sized and hidden or wholly clipped old regions do not spend the free lane", { concurrency: false }, t => {
  const x = d411Placement(t);
  // Healthy synthetic native ports, not a claim that the measured Clear entry was closed.
  const summaryRect = d411Rect(88, 298.55078125, 308, 44);
  const summary = x.control(summaryRect, { tagName: "SUMMARY" });
  const closed = x.control(summaryRect, { tagName: "DETAILS", className: "output-recipe-entry", open: false });
  const formerScrollport = x.ancestor(d411Rect(72, 100, 340, 60), { overflowX: "auto", overflowY: "auto" });
  const clipped = x.control(d411Rect(88, 300, 308, 96), {
    tagName: "DIV", className: "output-requirement-warning", parentElement: formerScrollport,
  });
  const hidden = x.control(d411Rect(0, 0, 419.5, 398.5), { tagName: "FORMA-UI-NOTICE", hiddenAncestor: true });
  x.controls.push(summary); x.regions.push(closed, clipped, hidden); x.f.document.activeElement = summary;
  x.f.panel.draftForTest = "  A separate unsent draft.  ";
  assert.equal(closed.getBoundingClientRect(), summaryRect);
  assert.ok(x.regions.every(region => !x.controls.includes(region)));
  assert.ok(clipped.getBoundingClientRect().top > formerScrollport.getBoundingClientRect().bottom);
  const box = x.run();
  assert.equal(x.f.document.activeElement, summary); assert.equal(closed.open, false);
  assert.equal(x.f.panel.draftForTest, "  A separate unsent draft.  ");
  assert.deepEqual(x.f.emitted, []);
  assert.equal(x.overlap(box).length, 0);
  assert.equal(x.overlap(box, [summaryRect]).length, 0);
  assert.equal(box.top, 346.5); assert.equal(box.bottom, 390.5);
  assert.equal(x.f.panel.dataset.compactLauncher, undefined);
  assert.equal(x.values.get("--forma-assistant-obstacle-offset"), "0px");
  assert.equal(x.queries.length, 1, "both explicitly supported old/new query ports remain finite");
});

// D428 reuses the complete panel/RAF path and its bounded native geometry port.
// Visible body inputs are from the real R4 narrow-320 document-01-entry report,
// SHA256 29ef8d75279d7aeb71321fd8282f27300c43c6d0d52dd329f8381b8d353718ee.
// Header/task focus and hover changes are explicitly finite stress inputs:
// no actual browser focus, scroll, hit order, or stylesheet paint is simulated.
for (const focusKind of ["entry", "header", "task", "hovered-neighbor"]) test(
  "D428 tight compact lane keeps R4 Account and current focus paint clear / " + focusKind,
  { concurrency: false }, t => {
    const x = d411Placement(t, [], { width: 320, height: 800 });
    // The existing narrow CSS base is 800 - 66px bottom navigation - 10px inset.
    // The wider normal width is the existing explicit synthetic port, not a
    // newly asserted R4 normal-launcher measurement.
    x.launcher.getBoundingClientRect = () => {
      const offset = Number.parseFloat(x.values.get("--forma-assistant-obstacle-offset") || "0");
      const width = x.f.panel.dataset.compactLauncher === "true" ? 44 : 137.1875;
      const box = d411Rect(310 - width, 680 - offset, width, 44);
      x.boxes.push({ ...box, offset, compact: x.f.panel.dataset.compactLauncher === "true" });
      return box;
    };
    const rows = [
      ["BUTTON", 8, 9.5, 44, 44],
      ["BUTTON", 58, 9.5, 170.640625, 44],
      ["SELECT", 158.40625, 9.5, 57.59375, 44],
      ["BUTTON", 220, 9.5, 44, 44],
      ["BUTTON", 268, 9.5, 44, 44],
      ["A", 4, 734, 60.796875, 66],
      ["A", 66.796875, 734, 60.796875, 66],
      ["A", 129.59375, 734, 60.796875, 66],
      ["A", 192.390625, 734, 60.796875, 66],
      ["A", 255.1875, 734, 60.796875, 66],
      ["A", 12, 67.5, 110.46875, 44],
      ["BUTTON", 130.46875, 67.5, 177.53125, 44],
      ["BUTTON", 116.140625, 119, 21.46875, 44],
      ["BUTTON", 145.609375, 119, 44, 44],
      ["BUTTON", 197.609375, 119, 44, 44],
      ["BUTTON", 249.609375, 119, 54, 44],
      ["A", 6, 174, 51.5625, 39],
      ["A", 59.5625, 174, 56.53125, 39],
      ["A", 118.09375, 174, 65.40625, 39],
      ["BUTTON", 16, 214, 61.8125, 44],
      ["BUTTON", 81.8125, 214, 130.3125, 44],
      ["BUTTON", 216.125, 214, 103.875, 44],
      ["SELECT", 16, 360.953125, 273, 44],
      ["INPUT", 36, 486.734375, 18, 18],
      ["TEXTAREA", 16, 573.328125, 273, 94.78125],
    ];
    for (const [tagName, left, top, width, height] of rows)
      x.controls.push(x.control(d411Rect(left, top, width, height), { tagName }));
    const context = x.ancestor(d411Rect(0, 259, 305, 474), { overflowX: "auto", overflowY: "auto" });
    const entry = x.control(d411Rect(16, 166.984375, 273, 943.84375), {
      tagName: "DETAILS", className: "output-recipe-entry", open: true, parentElement: context,
    });
    const paintedEntry = d411Rect(16, 259, 273, 474), header = x.controls[15], task = x.controls[21], field = x.controls[24];
    x.regions.push(entry);
    for (const control of [header, task, field]) Object.assign(control, {
      outlineStyle: "solid", outlineWidth: "3px", outlineOffset: control === field ? "0px" : "3px",
    });
    field.value = "  Preserve this exact output request.  ";
    x.f.panel.draftForTest = "  Keep this separate unsent guidance.  ";
    const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages };
    const focused = focusKind === "header" ? header : focusKind === "task" ? task : field;
    x.f.document.activeElement = focused;
    const extent = focused === field ? 3 : 6, raw = focused.getBoundingClientRect();
    const envelope = d411Rect(raw.left - extent, raw.top - extent, raw.width + 2 * extent, raw.height + 2 * extent);
    const box = x.run();
    assert.equal(x.controls.length, 25); assert.equal(x.regions.length, 1); assert.equal(entry.open, true);
    assert.equal(x.f.document.activeElement, focused);
    assert.equal(field.value, "  Preserve this exact output request.  ");
    assert.equal(x.f.panel.draftForTest, "  Keep this separate unsent guidance.  ");
    assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
    assert.deepEqual(x.f.emitted, []); assert.deepEqual(x.queries, [d420TaskRegionQuery]);
    assert.equal(box.left, 266); assert.equal(box.width, 44); assert.equal(box.height, 44);
    assert.ok(box.top >= 8 && box.bottom <= 724);
    assert.equal(x.overlap(box).length, 0, "Account remains an obstacle, not an exemption at the top-bound stop");
    assert.equal(x.overlap(box, [paintedEntry, envelope]).length, 0, "keep both task copy and actual focused-outline inputs clear");
    assert.equal(x.f.panel.dataset.tightLauncher, "true");
    assert.ok(box.top >= 163 && box.bottom <= 214, "use the available compact gap without entering the title's left edge");
    if (focusKind !== "hovered-neighbor") return;

    x.f.document.activeElement = x.launcher;
    const held = x.run();
    assert.deepEqual(held, box); assert.deepEqual(x.writes, [], "the tight launcher's own focus still freezes placement");
    x.f.document.activeElement = field; x.hovered = true;
    assert.deepEqual(x.run(), box); assert.deepEqual(x.writes, [], "ordinary hover stays stationary without a focus conflict");
    for (const newer of [header, task]) {
      const previous = x.launcher.getBoundingClientRect(), r = newer.getBoundingClientRect();
      const ring = d411Rect(r.left - 6, r.top - 6, r.width + 12, r.height + 12);
      assert.equal(x.overlap(previous, [ring]).length, 1, "the newer focused ring genuinely conflicts before its bounded correction");
      x.f.document.activeElement = newer;
      const moved = x.run();
      assert.equal(x.f.document.activeElement, newer); assert.equal(x.hovered, true);
      assert.equal(x.overlap(moved, [...x.controls.map(control => control.getBoundingClientRect()), paintedEntry, ring]).length, 0);
      assert.ok(Math.abs(moved.top - previous.top) <= 6, "a newer page focus needs a small correction, not another placement owner");
      assert.equal(x.f.panel.dataset.tightLauncher, "true");
      assert.deepEqual(x.run(), moved); assert.deepEqual(x.writes, [], "a settled hovered position must not jitter");
    }
    assert.equal(field.value, "  Preserve this exact output request.  ");
    assert.equal(x.f.panel.draftForTest, "  Keep this separate unsent guidance.  ");
    assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
    assert.deepEqual(x.f.emitted, []);
  });

// The old lane remains explicitly unresolved when the current focus paint
// cannot be bounded. These synthetic inputs are guard discriminators, not
// transformed/filtered pixels, a shadow DOM renderer, or a browser fixture.
for (const paint of ["own-transform", "own-zoom", "own-filter", "ancestor-zoom", "ancestor-filter", "shadow-active", "uncollected-focus"]) test(
  "D428 tight gap is not certified from unsupported current focus / " + paint,
  { concurrency: false }, t => {
    const x = d411Placement(t);
    const focused = x.control(d411Rect(300, 119, 90, 44), {
      tagName: "BUTTON", outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "3px",
    });
    x.controls.push(
      x.control(d411Rect(300, 0, 90, 111.5), { tagName: "BUTTON" }),
      focused,
      x.control(d411Rect(300, 214, 90, 184), { tagName: "BUTTON" }),
    );
    if (paint === "own-transform") focused.transform = "matrix(2, 0, 0, 2, 0, 0)";
    if (paint === "own-zoom") focused.zoom = "2";
    if (paint === "own-filter") focused.filter = "blur(4px)";
    if (paint === "ancestor-zoom" || paint === "ancestor-filter") {
      const ancestor = x.ancestor(d411Rect(0, 0, 419.5, 398.5));
      if (paint === "ancestor-zoom") ancestor.zoom = "2";
      else ancestor.filter = "drop-shadow(0 0 6px black)";
      focused.parentElement = ancestor;
    }
    if (paint === "shadow-active") focused.shadowRoot = { activeElement: { tagName: "INPUT" } };
    const owner = paint === "uncollected-focus"
      ? x.control(d411Rect(300, 119, 90, 44), { tagName: "DIV", tabIndex: 0 }) : focused;
    x.f.document.activeElement = owner;
    x.f.panel.draftForTest = "  Preserve unsent guidance when focus geometry is unassessed.  ";
    const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages };
    const box = x.run();
    assert.equal(x.controls.length, 3); assert.equal(x.regions.length, 0);
    assert.equal(x.f.document.activeElement, owner);
    assert.equal(x.f.panel.draftForTest, "  Preserve unsent guidance when focus geometry is unassessed.  ");
    assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
    assert.deepEqual(x.f.emitted, []); assert.deepEqual(x.queries, [d420TaskRegionQuery]);
    assert.equal(box.width, 44); assert.equal(box.height, 44);
    assert.equal(x.f.panel.dataset.tightLauncher, undefined,
      "unsupported current focus cannot authorize the new tight placement");
    assert.ok(x.overlap(box).length > 0,
      "retain the explicitly unresolved ordinary lane; do not manufacture a safe-paint result");
  });

// R6 actual failures are retained in D428-a11y-full-rebuilt-r6/report.json,
// SHA256 8d1608b0ac663e1da4d4472584c48f1802fb6f081d2c3d380ba93e2299d6fecb.
// Reuse a right-lane subset of its visible native bodies, not a page renderer.
// The skip-link's declared final translate is a finite computed-style input;
// actual CSS cascade, native Tab, focus paint and hit order remain browser gates.
for (const journey of ["disabled-save", "skip-return"]) test(
  "D428 actual panel preserves readable disabled actions and native skip return / " + journey,
  { concurrency: false }, t => {
    const x = d411Placement(t, [], { width: 320, height: 800 });
    x.launcher.getBoundingClientRect = () => {
      const offset = Number.parseFloat(x.values.get("--forma-assistant-obstacle-offset") || "0");
      const width = x.f.panel.dataset.compactLauncher === "true" ? 44 : 137.1875;
      const box = d411Rect(310 - width, 680 - offset, width, 44);
      x.boxes.push({ ...box, offset, compact: x.f.panel.dataset.compactLauncher === "true" });
      return box;
    };
    for (const [tagName, left, top, width, height] of [
      ["BUTTON", 268, 9.5, 44, 44],
      ["BUTTON", 220, 9.5, 44, 44],
      ["BUTTON", 130.46875, 67.5, 177.53125, 44],
      ["BUTTON", 249.609375, 119, 54, 44],
      ["A", 118.09375, 174, 65.40625, 39],
      ["BUTTON", 216.125, 214, 103.875, 44],
    ]) x.controls.push(x.control(d411Rect(left, top, width, height), { tagName }));
    const context = x.ancestor(d411Rect(0, 259, 305, 474), {
      overflowX: "auto", overflowY: "auto", scrollTop: journey === "disabled-save" ? 4740 : 0,
    });
    const scrollBefore = context.scrollTop;
    x.f.panel.draftForTest = "  Preserve the independent Assistant draft.  ";
    const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages };
    if (journey === "disabled-save") {
      const save = x.control(d411Rect(29, 294.15625, 247, 44), {
        tagName: "BUTTON", disabled: true, textContent: "Save requirements", parentElement: context,
      });
      const cancel = x.control(d411Rect(29, 346.15625, 247, 44), { tagName: "BUTTON", parentElement: context });
      const keep = x.control(d411Rect(42, 474.34375, 221, 44), {
        tagName: "BUTTON", parentElement: context, outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "3px",
      });
      const discard = x.control(d411Rect(42, 526.34375, 221, 44), { tagName: "BUTTON", parentElement: context });
      const warning = x.control(d411Rect(29, 406.15625, 247, 177.1875), {
        tagName: "DIV", className: "output-requirement-warning", parentElement: context,
      });
      x.controls.push(save, cancel, keep, discard,
        x.control(d411Rect(0, 629.34375, 305, 97.59375), { tagName: "BUTTON", parentElement: context }),
        x.control(d411Rect(0, 726.9375, 305, 124.1875), { tagName: "BUTTON", parentElement: context }));
      x.regions.push(warning);
      x.f.document.activeElement = keep;
      const box = x.run();
      assert.equal(x.f.document.activeElement, keep); assert.equal(save.disabled, true);
      assert.equal(save.textContent, "Save requirements"); assert.equal(context.scrollTop, scrollBefore);
      assert.equal(x.f.panel.draftForTest, "  Preserve the independent Assistant draft.  ");
      assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
      assert.deepEqual(x.f.emitted, []); assert.deepEqual(x.queries, [d420TaskRegionQuery]);
      assert.ok(box.width >= 44); assert.equal(box.height, 44);
      assert.ok(box.top >= 8 && box.bottom <= 724);
      assert.equal(x.overlap(box, [save.getBoundingClientRect()]).length, 0,
        "the genuinely disabled Save label is still visible UI, not free overlay space");
      assert.equal(x.overlap(box).length, 0);
      assert.equal(x.overlap(box, [warning.getBoundingClientRect()]).length, 0);
      return;
    }

    const field = x.control(d411Rect(16, 573.328125, 273, 94.78125), {
      tagName: "TEXTAREA", parentElement: context, value: "  Keep the exact output request.  ",
      outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "0px",
    });
    const entry = x.control(d411Rect(16, 166.984375, 273, 943.84375), {
      tagName: "DETAILS", className: "output-recipe-entry", open: true, parentElement: context,
    });
    x.controls.push(field); x.regions.push(entry); x.f.document.activeElement = field;
    const initial = x.run();
    assert.equal(x.f.panel.dataset.tightLauncher, "true");
    assert.equal(initial.width, 44); assert.equal(initial.height, 44);
    assert.equal(x.overlap(initial, [...x.controls.map(control => control.getBoundingClientRect()), d411Rect(16, 259, 273, 474)]).length, 0);
    const styles = read("src/design-system.css");
    const base = styles.match(/\.skip-link\s*\{([^}]+)\}/u)?.[1];
    const focused = styles.match(/\.skip-link:focus\s*\{\s*translate:\s*([^;]+);\s*\}/u)?.[1];
    assert.ok(base?.includes("translate: 0 -150%;"), "the existing offscreen unfocused link remains unchanged");
    assert.ok(focused, "read the real focused skip-link declaration, not an injected repair value");
    // Explicit small native rectangle input, not an R6 skip-link measurement.
    // The actual R6 fifth reverse-Tab screenshot establishes the focused link.
    const skip = x.control(d411Rect(12, 12, 184, 44), {
      tagName: "A", className: "skip-link", href: "#main-content", translate: focused.trim(),
      outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "3px",
    });
    x.controls.push(skip); x.f.document.activeElement = skip;
    const afterSkip = x.run(), skipMarker = x.f.panel.dataset.tightLauncher;
    assert.equal(x.f.document.activeElement, skip); assert.deepEqual(x.queries, [d420TaskRegionQuery]);
    x.f.document.activeElement = x.launcher;
    const afterOwn = x.run();
    assert.equal(x.f.document.activeElement, x.launcher);
    assert.deepEqual(x.writes, [], "native launcher focus still freezes its current placement");
    assert.equal(field.value, "  Keep the exact output request.  "); assert.equal(entry.open, true);
    assert.equal(context.scrollTop, scrollBefore);
    assert.equal(x.f.panel.draftForTest, "  Preserve the independent Assistant draft.  ");
    assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
    assert.deepEqual(x.f.emitted, []);
    assert.deepEqual({ afterSkip, afterOwn, skipMarker, ownMarker: x.f.panel.dataset.tightLauncher },
      { afterSkip: initial, afterOwn: initial, skipMarker: "true", ownMarker: "true" },
      "the declared focused skip posture must not demote a clear tight launcher into the top-bound collision before own-focus freezes it");
  });

// R8 records a clear tight launcher, a non-tight top-bound fallback while
// Account is open, then an obstructed focused Avatar after Escape. Report:
// c57bcaeef41bd1d4d2e3d7df65949b284aaa5d4e648bde553b0ea3d9f39632c1.
// Reuse that visible right-lane subset and the original complete panel/RAF
// port. The temporary top-layer button below is a declared synthetic blocker,
// not a measured R8 popover: it causes the observed fallback through the real
// routine without asserting why that intermediate browser placement happened.
for (const paint of ["bounded", "unsupported"]) test(
  "D428 current Account focus can recover a hovered non-tight fallback / " + paint,
  { concurrency: false }, t => {
    const x = d411Placement(t, [], { width: 320, height: 800 });
    x.launcher.getBoundingClientRect = () => {
      const offset = Number.parseFloat(x.values.get("--forma-assistant-obstacle-offset") || "0");
      const width = x.f.panel.dataset.compactLauncher === "true" ? 44 : 137.1875;
      const box = d411Rect(310 - width, 680 - offset, width, 44);
      x.boxes.push({ ...box, offset, compact: x.f.panel.dataset.compactLauncher === "true" });
      return box;
    };
    for (const [tagName, left, top, width, height] of [
      ["BUTTON", 268, 9.5, 44, 44],
      ["BUTTON", 220, 9.5, 44, 44],
      ["BUTTON", 130.46875, 67.5, 177.53125, 44],
      ["BUTTON", 249.609375, 119, 54, 44],
      ["A", 118.09375, 174, 65.40625, 39],
      ["BUTTON", 216.125, 214, 103.875, 44],
    ]) x.controls.push(x.control(d411Rect(left, top, width, height), { tagName }));
    const account = x.controls[0], accountRing = d411Rect(262, 3.5, 56, 56);
    Object.assign(account, { outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "3px" });
    const context = x.ancestor(d411Rect(0, 259, 305, 474), { overflowX: "auto", overflowY: "auto", scrollTop: 0 });
    const field = x.control(d411Rect(16, 573.328125, 273, 94.78125), {
      tagName: "TEXTAREA", parentElement: context, value: "  Keep the exact output request.  ",
      outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "0px",
    });
    const entry = x.control(d411Rect(16, 166.984375, 273, 943.84375), {
      tagName: "DETAILS", className: "output-recipe-entry", open: true, parentElement: context,
    });
    const paintedEntry = d411Rect(16, 259, 273, 474);
    let popupOpen = false;
    const popup = x.ancestor(d411Rect(8, 52, 304, 681), { overflowX: "hidden", overflowY: "auto" });
    const popupBody = d411Rect(266, 163, 44, 51);
    const popupButton = x.control(popupBody, {
      tagName: "BUTTON", parentElement: popup, topLayer: popup,
      outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "3px",
      getBoundingClientRect: () => popupOpen ? popupBody : d411Rect(0, 0, 0, 0),
    });
    x.controls.push(field, popupButton); x.regions.push(entry);
    x.f.panel.draftForTest = "  Keep the independent Assistant draft.  ";
    const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages, scrollTop: context.scrollTop };
    x.f.document.activeElement = field;
    const initial = x.run();
    assert.equal(initial.top, 166.5); assert.equal(initial.width, 44); assert.equal(initial.height, 44);
    assert.equal(x.f.panel.dataset.tightLauncher, "true");
    assert.equal(x.overlap(initial, [...x.controls.map(control => control.getBoundingClientRect()), paintedEntry]).length, 0);

    popupOpen = true; x.f.document.activeElement = popupButton;
    const fallback = x.run();
    assert.equal(fallback.top, 15.5); assert.equal(fallback.width, 44); assert.equal(fallback.height, 44);
    assert.equal(x.f.panel.dataset.compactLauncher, "true"); assert.equal(x.f.panel.dataset.tightLauncher, undefined);
    assert.equal(x.overlap(fallback, [account.getBoundingClientRect()]).length, 1,
      "the actual routine, not a forced offset or dataset, reaches the bad return posture");
    assert.equal(x.f.document.activeElement, popupButton);
    // The R8 click point is inside this fallback. Declaring hover only after
    // closing the top layer does not pretend to implement browser hit testing.
    assert.ok(290 > fallback.left && 290 < fallback.right && 31.5 > fallback.top && 31.5 < fallback.bottom);
    popupOpen = false; x.f.document.activeElement = account; x.hovered = true;
    if (paint === "unsupported") account.filter = "blur(4px)";
    const returned = x.run(), returnedMarker = x.f.panel.dataset.tightLauncher, returnWrites = [...x.writes];
    assert.equal(x.f.document.activeElement, account); assert.equal(x.hovered, true);
    assert.equal(popupOpen, false); assert.equal(popupButton.getBoundingClientRect().width, 0);
    assert.equal(account.outlineWidth, "3px"); assert.equal(account.outlineOffset, "3px");
    const returnQueries = [...x.queries];

    // A later noncolliding page focus must not move either retained posture;
    // launcher focus also stays an unconditional freeze, including a known
    // unresolved posture in the unsupported-paint counterexample.
    account.filter = "none"; x.f.document.activeElement = field;
    assert.equal(x.overlap(returned, [field.getBoundingClientRect()]).length, 0);
    const settled = x.run();
    assert.deepEqual(settled, returned); assert.deepEqual(x.writes, []);
    assert.equal(x.f.document.activeElement, field); assert.equal(x.hovered, true);
    x.f.document.activeElement = x.launcher;
    const owned = x.run();
    assert.deepEqual(owned, returned); assert.deepEqual(x.writes, []); assert.equal(x.f.document.activeElement, x.launcher);
    assert.equal(field.value, "  Keep the exact output request.  "); assert.equal(entry.open, true);
    assert.equal(context.scrollTop, before.scrollTop); assert.equal(x.f.panel.open, false);
    assert.equal(x.f.panel.draftForTest, "  Keep the independent Assistant draft.  ");
    assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
    assert.deepEqual(x.f.emitted, []);
    t.diagnostic("D428 Account return " + JSON.stringify({
      paint, initial, fallback, returned, returnedMarker, returnQueries, returnWriteCount: returnWrites.length,
    }));
    if (paint === "unsupported") {
      assert.deepEqual(returned, fallback); assert.deepEqual(returnWrites, []);
      assert.equal(returnedMarker, undefined);
      assert.equal(x.overlap(returned, [account.getBoundingClientRect(), accountRing]).length, 2,
        "an unbounded current focus is still explicitly unresolved, not newly certified clear");
      return;
    }
    assert.equal(x.overlap(returned, [...x.controls.map(control => control.getBoundingClientRect()), paintedEntry, accountRing]).length, 0,
      "measurable current Account focus outranks an incidental hover in every compact posture");
    assert.deepEqual(returned, initial); assert.equal(returnedMarker, "true");
    assert.deepEqual(returnQueries, [d420TaskRegionQuery]);
    assert.ok(returnWrites.length > 0);
  });

// D428 declares a native-window transition completion and changed control
// rectangles after the first ordinary placement. It does not simulate CSS
// interpolation, DOM event propagation, UA focus, or the R28 transition timing.
test("D428 completed layout transition remeasures settled controls through the existing coalesced frame", { concurrency: false }, t => {
  const nativeWindow = new EventTarget();
  const x = d411Placement(t, [], { width: 419.5, height: 398.5 }, nativeWindow);
  x.f.panel.connectedCallback();
  t.after(() => x.f.panel.disconnectedCallback());
  const field = x.control(d411Rect(16, 80, 240, 80), { value: "  Retain the exact native field.  " });
  let actionBox = d411Rect(300, 268, 90, 44);
  const action = x.control(actionBox, { tagName: "BUTTON", getBoundingClientRect: () => actionBox });
  x.controls.push(field, action);
  x.f.document.activeElement = field;
  x.f.panel.draftForTest = "  Retain independent Assistant guidance.  ";
  const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages, fieldValue: field.value };
  const initial = x.run();
  assert.equal(x.overlap(initial).length, 0);
  assert.equal(initial.top, 346.5);
  assert.equal(initial.width, 137.1875);
  assert.equal(x.f.frames.length, 0);

  // Only the declared control rectangle changes, after the earlier RAF.
  // No updated(), test focus, forced launcher offset, or polling follows it.
  actionBox = d411Rect(300, 360, 90, 30);
  assert.equal(x.overlap(initial).length, 1, "the settled action now intersects the earlier healthy placement");
  x.writes.length = 0; x.queries.length = 0;
  nativeWindow.dispatchEvent(Object.assign(new Event("transitionend", { bubbles: true }), { propertyName: "grid-template-columns" }));
  nativeWindow.dispatchEvent(Object.assign(new Event("transitionend", { bubbles: true }), { propertyName: "grid-template-columns" }));
  const queued = x.f.frames.length;
  for (const callback of x.f.frames.splice(0)) callback(0);
  const returned = x.launcher.getBoundingClientRect();
  const queries = [...x.queries];

  // A repeated terminal event may measure, but cannot start a frame loop or
  // keep changing a settled position. Existing placement guards still own it.
  nativeWindow.dispatchEvent(new Event("transitionend", { bubbles: true }));
  const repeatedQueued = x.f.frames.length;
  for (const callback of x.f.frames.splice(0)) callback(0);
  const steady = x.launcher.getBoundingClientRect();
  assert.deepEqual(steady, returned);
  assert.equal(x.f.frames.length, 0);
  assert.equal(x.f.document.activeElement, field);
  assert.equal(field.value, before.fieldValue);
  assert.equal(action.getBoundingClientRect(), actionBox);
  assert.equal(x.f.panel.open, false);
  assert.equal(x.f.panel.draftForTest, "  Retain independent Assistant guidance.  ");
  assert.equal(x.f.panel.tasks, before.tasks);
  assert.equal(x.f.panel.messages, before.messages);
  assert.deepEqual(x.f.emitted, []);
  assert.deepEqual(x.f.trace, []);
  t.diagnostic("D428 transition completion " + JSON.stringify({ initial, returned, steady, queued, repeatedQueued }));
  assert.equal(x.overlap(returned).length, 0, "the terminal layout event must clear the newly settled action");
  assert.equal(queued, 1, "two terminal events share the existing pending placement frame");
  assert.equal(repeatedQueued, 1);
  assert.equal(queries.length, 1, "one frame performs the existing control query once");
});

test("D428 layout terminal listener preserves open, hover and own-focus guards and retires with its native lifecycle", { concurrency: false }, t => {
  const nativeWindow = new EventTarget();
  const x = d411Placement(t, [], { width: 419.5, height: 398.5 }, nativeWindow);
  const field = x.control(d411Rect(16, 80, 240, 80), { value: "  Keep the page field.  " });
  const action = x.control(d411Rect(300, 360, 90, 30), { tagName: "BUTTON" });
  x.controls.push(field, action);
  x.f.panel.draftForTest = "  Keep the Assistant draft.  ";
  const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages };
  x.f.panel.connectedCallback();
  t.after(() => x.f.panel.disconnectedCallback());
  const held = x.launcher.getBoundingClientRect();

  x.f.document.activeElement = x.launcher;
  nativeWindow.dispatchEvent(new Event("transitionend", { bubbles: true }));
  nativeWindow.dispatchEvent(new Event("resize"));
  assert.equal(x.f.frames.length, 1, "terminal and existing resize events coalesce");
  for (const callback of x.f.frames.splice(0)) callback(0);
  assert.deepEqual(x.launcher.getBoundingClientRect(), held);
  assert.deepEqual(x.writes, []);
  assert.equal(x.f.document.activeElement, x.launcher);

  x.f.document.activeElement = field; x.hovered = true;
  nativeWindow.dispatchEvent(new Event("transitionend", { bubbles: true }));
  nativeWindow.dispatchEvent(new Event("scroll"));
  assert.equal(x.f.frames.length, 1);
  for (const callback of x.f.frames.splice(0)) callback(0);
  assert.deepEqual(x.launcher.getBoundingClientRect(), held);
  assert.deepEqual(x.writes, []);
  assert.equal(x.overlap(held, [field.getBoundingClientRect()]).length, 0);
  assert.equal(x.overlap(held, [action.getBoundingClientRect()]).length, 1,
    "noncolliding current focus preserves hover even when an unrelated action remains unresolved");

  x.f.panel.open = true;
  nativeWindow.dispatchEvent(new Event("transitionend", { bubbles: true }));
  nativeWindow.dispatchEvent(new Event("resize"));
  assert.equal(x.f.frames.length, 0, "an open Assistant does not schedule launcher placement");
  x.f.panel.open = false;
  nativeWindow.dispatchEvent(new Event("resize"));
  assert.equal(x.f.frames.length, 1);
  const pending = [...x.f.frames];
  x.f.panel.disconnectedCallback();
  assert.deepEqual(x.f.cancelledFrames, [1], "the existing native RAF port receives cancellation of the pending frame");
  // The finite recorder witnesses cancellation but does not execute that
  // cancelled callback. Real browser cancellation remains the native gate.
  for (const type of ["transitionend", "resize", "scroll", "focusin"]) nativeWindow.dispatchEvent(new Event(type));
  assert.deepEqual(x.f.frames, pending, "disconnect removes listeners; no new callback is appended");
  assert.deepEqual(x.writes, []);
  assert.equal(x.f.document.activeElement, field);
  assert.equal(field.value, "  Keep the page field.  ");
  assert.equal(x.f.panel.draftForTest, "  Keep the Assistant draft.  ");
  assert.equal(x.f.panel.tasks, before.tasks);
  assert.equal(x.f.panel.messages, before.messages);
  assert.deepEqual(x.f.emitted, []);
  assert.deepEqual(x.f.trace, []);
});

// R28 supplied the native INPUT/LABEL rectangles. The auxiliary Export box
// and base launcher position are declared finite geometry inputs, not extra
// measured R28 controls. Association/style ports do not reconstruct the DOM,
// CSS, native focus delivery, or complete production obstacle coverage.
function d428FileLabelPorts(t, x) {
  class NativeFileInput {}
  class NativeFileLabel {}
  for (const [name, value] of [["HTMLInputElement", NativeFileInput], ["HTMLLabelElement", NativeFileLabel]]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
  }
  const input = Object.assign(new NativeFileInput(), x.control(d411Rect(245, 300.40625, 1, 1), {
    tagName: "INPUT", type: "file", isConnected: true, opacity: "0", value: "", files: Object.freeze([]),
  }));
  const label = Object.assign(new NativeFileLabel(), x.control(d411Rect(88.7578125, 278.90625, 313.484375, 44), {
    tagName: "LABEL", isConnected: true, className: "button secondary file-button",
    outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "3px",
  }));
  input.parentElement = label; input.labels = [label]; label.control = input;
  label.matches = selector => {
    assert.equal(selector, "label.button.file-button", "only the existing native file-label primitive is admitted");
    return true;
  };
  label.querySelectorAll = selector => {
    assert.equal(selector, "input,button,select,textarea,output,meter,progress", "explicit sole-labelable native association");
    return [input];
  };
  const exported = x.control(d411Rect(88.7578125, 330.90625, 313.484375, 44), { tagName: "BUTTON" });
  x.controls.push(input, exported);
  x.launcher.getBoundingClientRect = () => {
    const offset = Number.parseFloat(x.values.get("--forma-assistant-obstacle-offset") || "0");
    const width = x.f.panel.dataset.compactLauncher === "true" ? 44 : 137.1875;
    const box = d411Rect(409 - width, 346.5 - offset, width, 44);
    x.boxes.push({ ...box, offset, compact: x.f.panel.dataset.compactLauncher === "true" });
    return box;
  };
  return { input, label, exported };
}

test("D428 actual panel avoids the current native file input's uniquely owned label paint", { concurrency: false }, t => {
  const x = d411Placement(t), { input, label, exported } = d428FileLabelPorts(t, x);
  const ring = d411Rect(82.7578125, 272.90625, 325.484375, 56);
  x.f.document.activeElement = input;
  x.f.panel.draftForTest = "  Keep independent unsent Assistant guidance.  ";
  const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages, files: input.files };
  const box = x.run();
  assert.equal(input.parentElement, label); assert.equal(input.labels.length, 1);
  assert.equal(input.labels[0], label); assert.equal(label.control, input);
  assert.equal(input.getBoundingClientRect().width, 1); assert.equal(input.opacity, "0");
  assert.equal(label.getBoundingClientRect().height, 44);
  assert.equal(label.outlineWidth, "3px"); assert.equal(label.outlineOffset, "3px");
  assert.equal(x.f.document.activeElement, input); assert.equal(input.value, ""); assert.equal(input.files, before.files);
  assert.equal(x.f.panel.draftForTest, "  Keep independent unsent Assistant guidance.  ");
  assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
  assert.deepEqual(x.f.emitted, []); assert.deepEqual(x.queries, [d420TaskRegionQuery]);
  assert.ok(x.boxes.length <= 14, "the existing finite placement budgets remain");
  assert.equal(x.overlap(box, [ring, exported.getBoundingClientRect()]).length, 0,
    "protect the label and its active ring, not merely the transparent one-pixel native input");
  assert.equal(box.bottom, 264.90625, "retain the existing eight-pixel gap beyond the actual label ring");
  x.hovered = true;
  assert.deepEqual(x.run(), box); assert.deepEqual(x.writes, [], "a clear hovered launcher stays stationary");
  assert.equal(x.f.document.activeElement, input); assert.deepEqual(x.f.emitted, []);
});

test("D428 actual panel cannot borrow a file label belonging to a different native input", { concurrency: false }, t => {
  const x = d411Placement(t), { input, label, exported } = d428FileLabelPorts(t, x);
  // A label with an explicit foreign association does not belong to its nested
  // input. This declared native association is not a complete page paint claim.
  input.labels = []; label.control = { tagName: "INPUT", type: "file" };
  x.f.document.activeElement = input;
  x.f.panel.draftForTest = "  Retain guidance under an unrelated label.  ";
  const box = x.run();
  assert.equal(input.labels.length, 0); assert.notEqual(label.control, input);
  assert.equal(x.f.document.activeElement, input); assert.equal(input.value, "");
  assert.equal(x.f.panel.draftForTest, "  Retain guidance under an unrelated label.  ");
  assert.deepEqual(x.f.emitted, []); assert.deepEqual(x.queries, [d420TaskRegionQuery]);
  assert.equal(x.overlap(box, [input.getBoundingClientRect(), exported.getBoundingClientRect()]).length, 0);
  assert.equal(box.bottom, 322.90625, "retain ordinary control geometry rather than adopting a foreign label");
  assert.equal(x.overlap(box, [label.getBoundingClientRect()]).length, 1,
    "the unrelated-label area is deliberately unresolved by this narrow association contract");
});

// Reuse the complete Panel/D411 native-frame fixture. These inputs declare a
// current Studio grid cell and its native client boxes; they are NOT a CSS
// renderer, the complete R2 page, browser hit testing, or route/Source proof.
// R2's real no-space receipt and the unchanged full-Shell contribution matrix
// remain separate evidence. The CSS contract below lives in assistant-shell.
function e3StudioSlot(t, { rtl = false, coarse = false, short = false } = {}) {
  const x = d411Placement(t, [], { width: 320, height: 800 });
  const state = { reserved: true, rtl, coarse, short, intent: "workbench", present: true,
    connected: true, busy: false, hidden: false, duplicate: false, top: 166, clip: false, transform: "none" };
  const size = () => state.coarse ? 48 : 44, height = () => size() + 9;
  const hostBox = () => d411Rect(0, state.top, 320, height());
  const navBox = () => state.reserved
    ? d411Rect(state.rtl ? size() + 16 : 0, state.top, 320 - size() - 16, height())
    : hostBox();
  const shell = x.ancestor(d411Rect(0, 0, 320, 800));
  const main = x.ancestor(d411Rect(0, 63, 320, 737));
  const stack = x.ancestor(d411Rect(0, 119, 320, 100));
  const host = x.ancestor(hostBox()), nav = x.ancestor(navBox());
  main.parentElement = shell; stack.parentElement = main; host.parentElement = stack; nav.parentElement = host;
  host.getBoundingClientRect = hostBox; nav.getBoundingClientRect = navBox;
  Object.defineProperty(host, "isConnected", { get: () => state.connected });
  Object.defineProperty(nav, "clientWidth", { get: () => navBox().width });
  Object.defineProperty(nav, "clientHeight", { get: () => navBox().height });
  shell.getAttribute = name => name === "data-layout-intent" ? state.intent
    : name === "data-nav-posture" ? state.short ? "rail" : "compact"
    : name === "data-short-height" ? String(state.short) : null;
  shell.querySelectorAll = selector => {
    assert.equal(selector, "forma-assistant-panel", "only actual floating-panel membership is supplied");
    return state.present ? [x.f.panel] : [];
  };
  shell.querySelector = selector => { assert.equal(selector, "#main-content"); return main; };
  main.getAttribute = name => { assert.equal(name, "aria-busy"); return String(state.busy); };
  main.closest = selector => { assert.equal(selector, ".application-creative"); return shell; };
  // Ordinary-copy owners are a separate explicit port when a reserved-slot
  // counterexample falls back to floating placement; native queries stay strict.
  x.copyOwnerQueries = [];
  main.querySelectorAll = selector => {
    if (["forma-workspace-settings", "forma-library", "forma-project-contents", "forma-workspace"].includes(selector)) {
      x.copyOwnerQueries.push(selector); return [];
    }
    assert.equal(selector, "forma-studio-mode-nav");
    return state.connected ? state.duplicate ? [host, otherHost] : [host] : [];
  };
  host.closest = selector => {
    if (selector === "#main-content") return main;
    if (selector === ".application-creative") return shell;
    if (selector === ".studio-header-stack") return stack;
    assert.equal(selector, "[hidden], [inert], [aria-hidden='true']"); return state.hidden ? stack : null;
  };
  const otherHost = x.ancestor(hostBox(), { isConnected: true, parentElement: stack, closest: host.closest });
  host.querySelector = selector => { assert.equal(selector, ".studio-mode-nav"); return nav; };
  nav.closest = selector => { assert.equal(selector, "forma-studio-mode-nav"); return host; };
  const owner = {
    matches: selector => selector === "forma-creative-assistant",
    closest(selector) { assert.equal(selector, ".application-creative"); return shell; },
  };
  x.f.panel.parentElement = owner;
  x.f.panel.closest = selector => { assert.equal(selector, ".application-creative"); return shell; };
  const baseStyle = getComputedStyle;
  // D411 already restores the original global descriptor in its own teardown.
  // This case-local extension supplies only the explicit CSSOM/client inputs.
  globalThis.getComputedStyle = element => ({ ...baseStyle(element), display: "block", visibility: "visible",
    opacity: "1", clipPath: "none", maskImage: "none", direction: state.rtl ? "rtl" : "ltr",
    borderTopLeftRadius: "0px", borderTopRightRadius: "0px", borderBottomLeftRadius: "0px", borderBottomRightRadius: "0px",
    borderLeftWidth: "0px", borderRightWidth: "0px", paddingLeft: "0px", paddingRight: "0px",
    getPropertyValue: () => "0px",
    ...(element === host ? { display: state.reserved ? "grid" : "block", gridTemplateColumns: `${320 - size() - 16}px ${size()}px`,
      columnGap: "8px", paddingLeft: state.rtl ? "8px" : "0px", paddingRight: state.rtl ? "0px" : "8px",
      getPropertyValue: name => name === "--forma-assistant-studio-slot" && state.reserved ? "1" : "0" } : {}),
    ...(element === nav ? { overflowX: "auto", overflowY: "hidden" } : {}),
    ...(element === main ? { overflowY: state.clip ? "clip" : "visible", transform: state.transform,
      borderTopLeftRadius: state.radius ?? "0px" } : {}),
  });
  main.clientHeight = 737;
  const account = x.control(d411Rect(268, 9.5, 44, 44), { tagName: "BUTTON" });
  const field = x.control(d411Rect(16, 576.328125, 273, 94.78125));
  // Keep the native raw box. The unchanged production collector performs its
  // own clipping through the declared current nav client rectangle.
  const view = x.control(d411Rect(192.5, 170, 195.21875, 44), { tagName: "BUTTON", parentElement: nav });
  x.controls.push(account, x.control(d411Rect(130.46875, 67.5, 177.53125, 44), { tagName: "BUTTON" }),
    x.control(d411Rect(249.609375, 119, 70.390625, 44), { tagName: "BUTTON" }), view,
    x.control(d411Rect(216.125, 219, 103.875, 44), { tagName: "BUTTON" }), field,
    x.control(d411Rect(255.1875, 734, 60.796875, 66), { tagName: "A" }));
  x.regions.push(x.control(d411Rect(16, 264, 273, 469), { tagName: "DETAILS" }));
  x.launcher.isConnected = true;
  x.launcher.getBoundingClientRect = () => {
    const dock = x.f.panel.dataset.studioLauncher === "true";
    const offset = Number.parseFloat(x.values.get("--forma-assistant-obstacle-offset") || "0");
    const width = dock ? Number.parseFloat(x.values.get("--forma-assistant-studio-size"))
      : x.f.panel.dataset.compactLauncher === "true" ? 44 : 137.1875;
    const box = dock ? d411Rect(Number.parseFloat(x.values.get("--forma-assistant-studio-left")),
      Number.parseFloat(x.values.get("--forma-assistant-studio-top")), width, width)
      : d411Rect(310 - width, 680 - offset, width, 44);
    x.boxes.push({ ...box, offset, compact: x.f.panel.dataset.compactLauncher === "true" }); return box;
  };
  const focuses = [];
  x.launcher.focus = () => { x.f.document.activeElement = x.launcher; focuses.push({ box: x.launcher.getBoundingClientRect(),
    dock: x.f.panel.dataset.studioLauncher, offset: x.values.get("--forma-assistant-obstacle-offset") }); };
  x.f.document.activeElement = field;
  const raw = "  Preserve this unsent Studio question — 保留  ";
  x.f.panel.draftForTest = raw;
  const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages, scope: x.f.panel.conversationScope };
  const custody = () => {
    assert.equal(x.f.panel.draftForTest, raw); assert.equal(x.f.panel.tasks, before.tasks);
    assert.equal(x.f.panel.messages, before.messages); assert.equal(x.f.panel.conversationScope, before.scope);
    assert.deepEqual(x.f.emitted, []); assert.equal(x.f.panel.parentElement, owner);
  };
  const expected = () => d411Rect(state.rtl ? 8 : 312 - size(), state.top + 4.5, size(), size());
  return Object.assign(x, { state, host, main, field, account, focuses, custody, expected });
}

for (const configuration of [{ rtl: false, coarse: false, short: false }, { rtl: true, coarse: true, short: true }]) {
  test("E3 same native Assistant occupies its explicit Studio utility cell " + JSON.stringify(configuration), { concurrency: false }, t => {
    const x = e3StudioSlot(t, configuration), focused = x.f.document.activeElement;
    const box = x.run();
    x.custody(); assert.equal(x.f.document.activeElement, focused); assert.deepEqual(x.focuses, []);
    assert.equal(x.host.isConnected, true); assert.equal(x.state.present, true);
    assert.equal(x.overlap(box, [x.account.getBoundingClientRect()]).length, 0);
    assert.deepEqual(box, x.expected(), "use the real reserved-cell input rather than another incidental floating gap");
    assert.equal(x.f.panel.dataset.studioLauncher, "true"); assert.equal(x.f.panel.dataset.compactLauncher, "true");
    assert.equal(x.f.panel.dataset.tightLauncher, "true");
    assert.deepEqual(x.queries, [], "a current reserved cell needs no floating collision search");
  });
}

test("E3 current Studio cell follows layout under its own hover and native focus without searching or refocusing", { concurrency: false }, t => {
  const x = e3StudioSlot(t); x.hovered = true; x.f.document.activeElement = x.launcher;
  x.state.top = 180; const first = x.run();
  x.state.top = 204; const second = x.run();
  x.custody(); assert.equal(x.f.document.activeElement, x.launcher); assert.deepEqual(x.focuses, []);
  assert.deepEqual(first, d411Rect(268, 184.5, 44, 44)); assert.deepEqual(second, x.expected());
  assert.deepEqual(x.queries, []); assert.equal(x.f.panel.dataset.studioLauncher, "true");
});

test("E3 docking retires the previous floating offset before an owned-focus host departure", { concurrency: false }, t => {
  const x = e3StudioSlot(t); x.state.reserved = false;
  const floating = x.run(), previousOffset = x.values.get("--forma-assistant-obstacle-offset");
  assert.ok(Number.parseFloat(previousOffset) > 0, "the original finite floating routine really established an offset");
  assert.equal(x.f.panel.dataset.studioLauncher, undefined);
  x.state.reserved = true; const docked = x.run();
  const dockOffset = x.values.get("--forma-assistant-obstacle-offset");
  x.f.document.activeElement = x.launcher; x.hovered = true; x.state.connected = false;
  const retired = x.run();
  x.custody(); assert.equal(x.f.document.activeElement, x.launcher); assert.deepEqual(x.focuses, []);
  assert.deepEqual(docked, x.expected());
  assert.equal(x.f.panel.dataset.studioLauncher, undefined);
  for (const name of ["left", "top", "size"]) assert.equal(x.values.has("--forma-assistant-studio-" + name), false);
  assert.deepEqual(x.queries, [], "the original floating own-focus freeze still runs after dock cleanup");
  assert.equal(dockOffset, undefined, "a successful dock must retire, not cache, the prior viewport's floating offset");
  assert.equal(x.values.has("--forma-assistant-obstacle-offset"), false);
  assert.equal(retired.top, 680); assert.notEqual(retired.top, floating.top);
});

for (const retirement of ["hidden", "offscreen", "clipped", "transformed", "disconnected", "duplicate", "busy", "posture"]) {
  test("E3 invalid Studio anchor cannot retain a docked coordinate / " + retirement, { concurrency: false }, t => {
    const x = e3StudioSlot(t); const first = x.run();
    x.f.document.activeElement = x.launcher; x.hovered = true;
    if (retirement === "hidden") x.state.hidden = true;
    if (retirement === "offscreen") x.state.top = -60;
    if (retirement === "clipped") { x.state.clip = true; x.main.clientHeight = 100; }
    if (retirement === "transformed") x.state.transform = "matrix(1, 0, 0, 1, 0, 0)";
    if (retirement === "disconnected") x.state.connected = false;
    if (retirement === "duplicate") x.state.duplicate = true;
    if (retirement === "busy") x.state.busy = true;
    if (retirement === "posture") x.state.intent = "browse";
    x.run();
    x.custody(); assert.equal(x.f.document.activeElement, x.launcher); assert.deepEqual(x.focuses, []);
    assert.deepEqual(first, d411Rect(268, 170.5, 44, 44), "this retirement began with an actual successful placement by the complete class");
    assert.equal(x.f.panel.dataset.studioLauncher, undefined);
    for (const name of ["left", "top", "size"]) assert.equal(x.values.has("--forma-assistant-studio-" + name), false);
    assert.equal(x.values.has("--forma-assistant-obstacle-offset"), false);
    assert.deepEqual(x.queries, []); assert.deepEqual(x.writes, []);
  });
}

test("E3 close remeasures the current Studio cell before the one existing native return-focus", { concurrency: false }, async t => {
  const x = e3StudioSlot(t); x.run();
  x.f.panel.open = true; x.f.panel.updated(new Map([["open", false]]));
  await Promise.resolve();
  assert.equal(x.f.panel.dataset.studioLauncher, undefined, "the open panel is never constrained by dock coordinates");
  assert.equal(x.f.frames.length, 0, "opening does not add a launcher RAF");
  x.state.top = 210; x.f.panel.open = false;
  x.f.panel.updated(new Map([["open", true]])); await Promise.resolve();
  for (const callback of x.f.frames.splice(0)) callback(0);
  x.custody(); assert.equal(x.focuses.length, 1, "reuse the existing close focus operation exactly once");
  assert.equal(x.f.document.activeElement, x.launcher);
  assert.deepEqual(x.focuses[0].box, x.expected(), "native return-focus must see the current cell, before its own-focus freeze");
  assert.equal(x.focuses[0].dock, "true");
  assert.equal(x.focuses[0].offset, undefined);
});

test("E3 an unsupported rounded or unknown clipping corner releases the cell without claiming arc clearance", { concurrency: false }, t => {
  const x = e3StudioSlot(t), observations = [];
  x.state.clip = true;
  for (const radius of ["12px", "unknown-corner"]) {
    x.state.radius = "0px";
    const before = x.run();
    x.f.document.activeElement = x.launcher; x.hovered = true; x.state.radius = radius;
    x.run();
    x.custody(); assert.equal(x.f.document.activeElement, x.launcher); assert.deepEqual(x.focuses, []);
    observations.push({ radius, before, marker: x.f.panel.dataset.studioLauncher,
      coordinates: ["left", "top", "size"].map(name => x.values.has("--forma-assistant-studio-" + name)),
      offset: x.values.has("--forma-assistant-obstacle-offset"), queries: [...x.queries], writes: [...x.writes] });
  }
  for (const observed of observations) {
    assert.deepEqual(observed.before, x.expected(), "the same clipped rectangle with zero-radius inputs first admits the cell");
    assert.equal(observed.marker, undefined, observed.radius);
    assert.deepEqual(observed.coordinates, [false, false, false]); assert.equal(observed.offset, false);
    assert.deepEqual(observed.queries, []); assert.deepEqual(observed.writes, []);
  }
});


// E6 uses the existing real Panel -> updated -> finite RAF placement fixture.
// Only these copy-owner/CSSOM/Range ports are new. Native control queries and
// every D411/D420/D428/Studio assertion above remain unchanged. Numbers marked
// measured come from copy69-baseline-r1; these cases are not a DOM renderer,
// complete-page reconstruction, native zoom, paint order or acceptance replay.
const e6CopyFamilies = ["forma-workspace-settings", "forma-library", "forma-project-contents", "forma-workspace"];
const e6SettingsCopySelectors = [
  ".page-header-copy > :is(.eyebrow,h1,p)",
  'section[aria-labelledby="workspace-invitations-heading"] > :is(h2,p)',
  'section[aria-labelledby="workspace-organizations-heading"] > :is(h2,p)',
  'section[aria-labelledby="workspace-projects-heading"] > :is(h2,p)',
  'section[aria-labelledby="workspace-organizations-heading"] > form.workspace-settings-form > label:has(> input[name="name"])',
];
const e6HelpCopySelector = '#document-context-panel [data-output-recipe-draft] > forma-output-requirement-card .output-requirement-card > form.output-requirement-form > label.output-requirement-field:has(> textarea[name="originalText"]) > small:not(.output-requirement-error)';
const e6DocumentCopyPrefix = '#document-context-panel [data-output-recipe-draft] > forma-output-requirement-card .output-requirement-card > form.output-requirement-form';
const e6DocumentCopySelectors = [
  e6DocumentCopyPrefix + ' > p.output-requirement-note:first-child',
  e6DocumentCopyPrefix + ' > p.output-requirement-note:first-child + p:not([class])',
  e6DocumentCopyPrefix + ' > label.output-requirement-field:has(> :is(input[name="packageLabel"],textarea[name="originalText"])) > :is(span,small:not(.output-requirement-error))',
];
const e6DocumentFieldSelector = ':scope > input[name="packageLabel"], :scope > textarea[name="originalText"]';
function e6CopyPlacement(t, { family = "forma-workspace-settings", viewport = { width: 320, height: 800 }, right = 310, top = 680, normalWidth = 137.1875 } = {}) {
  const x = d411Placement(t, [], viewport), full = d411Rect(0, 0, viewport.width, viewport.height);
  const shell = x.ancestor(full), main = x.ancestor(full, { parentElement: shell });
  const surface = x.ancestor(full, { parentElement: main, isConnected: true });
  const selected = new Map(), familyQueries = [], copyQueries = [], rangeReads = [], detached = [], copyBoxReads = [];
  shell.getAttribute = name => { assert.equal(name, "data-layout-intent"); return "browse"; };
  shell.querySelectorAll = selector => { assert.equal(selector, "forma-assistant-panel"); return [x.f.panel]; };
  shell.querySelector = selector => { assert.equal(selector, "#main-content"); return main; };
  main.getAttribute = name => { assert.equal(name, "aria-busy"); return "false"; };
  main.closest = selector => { assert.equal(selector, ".application-creative"); return shell; };
  main.querySelectorAll = selector => {
    assert.ok(e6CopyFamilies.includes(selector), "only separately declared copy-owner families are queried");
    familyQueries.push(selector); return selector === family ? [surface] : [];
  };
  surface.closest = selector => {
    if (selector === "#main-content") return main;
    assert.equal(selector, ".application-creative"); return shell;
  };
  surface.querySelectorAll = selector => {
    assert.ok((family === "forma-workspace" ? [e6HelpCopySelector, ...e6DocumentCopySelectors] : e6SettingsCopySelectors).includes(selector),
      "copy selection remains restricted to the actual declared owner family");
    copyQueries.push(selector);
    // Retain the old exact help query for a meaningful pre-runtime baseline;
    // the new union selects that same original node, not a duplicate fixture.
    return selector === e6DocumentCopySelectors[2]
      ? [...(selected.get(e6HelpCopySelector) ?? []), ...(selected.get(selector) ?? [])] : selected.get(selector) ?? [];
  };
  x.f.panel.parentElement = { matches: selector => selector === "forma-creative-assistant",
    closest: selector => { assert.equal(selector, ".application-creative"); return shell; } };
  x.f.panel.closest = selector => { assert.equal(selector, ".application-creative"); return shell; };
  const baseStyle = getComputedStyle;
  globalThis.getComputedStyle = element => ({ ...baseStyle(element), display: element.display ?? "block",
    clipPath: element.clipPath ?? "none", maskImage: element.maskImage ?? "none" });
  const previousFilter = Object.getOwnPropertyDescriptor(globalThis, "NodeFilter");
  Object.defineProperty(globalThis, "NodeFilter", { configurable: true, value: { SHOW_TEXT: 4 } });
  t.after(() => { if (previousFilter) Object.defineProperty(globalThis, "NodeFilter", previousFilter); else delete globalThis.NodeFilter; });
  x.f.document.createTreeWalker = (element, kind) => {
    assert.equal(kind, 4); let index = 0;
    return { nextNode: () => element.textNodes[index++] ?? null };
  };
  x.f.document.createRange = () => {
    let current;
    return { selectNodeContents(node) { current = node; rangeReads.push(node); },
      getClientRects() { assert.ok(current); return current.fragments; }, detach() { detached.push(current); } };
  };
  x.copy = (selector, raw, fragments, properties = {}) => {
    const element = x.control(raw, { tagName: "P", textContent: "Existing authored copy", isConnected: true, parentElement: surface,
      closest(query) {
        if (query === family) return surface;
        assert.ok(["[hidden], [inert], [aria-hidden='true']", "[hidden], [inert], [aria-hidden='true'], script, style, svg, .forma-icon",
          ":modal, :popover-open"].includes(query));
        return query.startsWith("[hidden]") && this.hiddenAncestor ? {} : null;
      }, ...properties });
    element.getBoundingClientRect = () => { copyBoxReads.push(element); return raw; };
    element.textNodes = [{ textContent: element.textContent, parentElement: element, fragments }];
    selected.set(selector, [...(selected.get(selector) ?? []), element]); return element;
  };
  x.replaceOriginalHelpForTest = node => {
    selected.set(e6HelpCopySelector, [node]);
    selected.set(e6DocumentCopySelectors[2], (selected.get(e6DocumentCopySelectors[2]) ?? []).filter(item => item !== node));
  };
  x.launcher.getBoundingClientRect = () => {
    const offset = Number.parseFloat(x.values.get("--forma-assistant-obstacle-offset") || "0");
    const width = x.f.panel.dataset.compactLauncher === "true" ? 44 : normalWidth;
    const box = d411Rect(right - width, top - offset, width, 44);
    x.boxes.push({ ...box, offset, compact: x.f.panel.dataset.compactLauncher === "true" }); return box;
  };
  return Object.assign(x, { familyQueries, copyQueries, rangeReads, detached, copyBoxReads, surface, main, shell });
}
function e6MeasuredSettings(x) {
  // Exact narrow320 Create body and two ordinary text fragments from
  // copy-settings-02-ranges-0. Other page controls are not reconstructed here.
  const focused = x.control(d411Rect(33, 585.84375, 144.15625, 44), { tagName: "BUTTON",
    outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "3px" });
  x.controls.push(focused); x.f.document.activeElement = focused;
  const heading = d411Rect(33, 680.84375, 215.984375, 27);
  const firstLine = d411Rect(33, 723.234375, 253.84375, 22);
  const h2 = x.copy(e6SettingsCopySelectors[3], d411Rect(33, 683.84375, 254, 22.390625), [heading],
    { tagName: "H2", textContent: "Projects shared with you" });
  x.copy(e6SettingsCopySelectors[3], d411Rect(33, 722.234375, 254, 51.1875), [firstLine],
    { textContent: "No projects have been shared with you." });
  return { focused, h2, fragments: [heading, firstLine], ring: d411Rect(27, 579.84375, 156.15625, 56) };
}
test("E6 actual Settings fragments and current Create ring get a feasible finite lane without changing guidance", { concurrency: false }, t => {
  const x = e6CopyPlacement(t), { focused, fragments, ring } = e6MeasuredSettings(x);
  x.f.panel.draftForTest = "  Keep this unsent guidance.  ";
  const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages };
  const box = x.run();
  assert.equal(x.overlap(box, [...fragments, ring]).length, 0, "clear the measured ordinary text and native ring together");
  assert.ok(box.top >= 8 && box.bottom <= 792); assert.ok(x.boxes.length <= 14);
  assert.equal(x.f.document.activeElement, focused); assert.equal(x.f.panel.draftForTest, "  Keep this unsent guidance.  ");
  assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages); assert.deepEqual(x.f.emitted, []);
  assert.deepEqual(x.queries, [d420TaskRegionQuery]); assert.deepEqual(x.familyQueries, e6CopyFamilies);
  assert.equal(x.rangeReads.length, 2); assert.deepEqual(x.detached, x.rangeReads);
});
test("E6 ordinary-copy whitespace and pointer transparency do not substitute a parent box or erase text", { concurrency: false }, t => {
  const x = e6CopyPlacement(t), raw = d411Rect(16, 680, 288, 40);
  // Declared short text leaves whitespace under the launcher; a parent-box
  // collector would unnecessarily move it. Then an explicit pointer-none text
  // fragment enters that lane and must still count as paint.
  const text = x.copy(e6SettingsCopySelectors[3], raw, [d411Rect(16, 684, 90, 24)]);
  assert.equal(x.run().top, 680, "empty heading width is not a text obstacle");
  text.pointerEvents = "none";
  text.textNodes[0].fragments = [d411Rect(180, 684, 100, 24)];
  const box = x.run();
  assert.equal(x.overlap(box, text.textNodes[0].fragments).length, 0, "pointer-events:none does not erase visible ordinary text");
  assert.equal(box.bottom, 676); assert.deepEqual(x.f.emitted, []);
});
test("E6 copy-only overlap cannot override current native hover refusal or become focus authority", { concurrency: false }, t => {
  const x = e6CopyPlacement(t), { focused, h2, fragments } = e6MeasuredSettings(x);
  x.hovered = true;
  const box = x.run();
  assert.ok(x.overlap(box, fragments).length > 0, "this explicit hovered copy collision remains unresolved");
  assert.deepEqual(x.writes, []); assert.deepEqual(x.familyQueries, []); assert.deepEqual(x.rangeReads, []);
  assert.equal(x.f.document.activeElement, focused);
  // Explicit synthetic nonnative-focus stress: selecting copy must not grant
  // the exactly measured native-control authority used by hovered recovery.
  x.f.document.activeElement = h2;
  assert.deepEqual(x.run(), box); assert.deepEqual(x.writes, []); assert.deepEqual(x.familyQueries, []);
  assert.equal(x.f.document.activeElement, h2); assert.deepEqual(x.f.emitted, []);
});
test("E6 an impossible ordinary-copy lane stays finite and visibly unresolved", { concurrency: false }, t => {
  const x = e6CopyPlacement(t), full = d411Rect(0, 0, 320, 800);
  x.copy(e6SettingsCopySelectors[3], full, [full]);
  const box = x.run();
  assert.ok(box.top >= 8 && box.bottom <= 792); assert.ok(x.boxes.length <= 14);
  assert.equal(x.overlap(box, [full]).length, 1, "bounded fallback is not a false clearance claim");
  assert.deepEqual(x.f.emitted, []); assert.equal(x.f.document.activeElement, null);
});
function e6DocumentHelpPlacement(t, foreign = false) {
  const x = e6CopyPlacement(t, { family: "forma-workspace", viewport: { width: 419, height: 398 }, right: 409, top: 346.5 });
  class NativeLabel {}
  const previous = Object.getOwnPropertyDescriptor(globalThis, "HTMLLabelElement");
  Object.defineProperty(globalThis, "HTMLLabelElement", { configurable: true, value: NativeLabel });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "HTMLLabelElement", previous); else delete globalThis.HTMLLabelElement; });
  // Field body/outline and visible help extent are from actual03-original-help
  // at200%. The one-fragment Range port is explicitly declared inside that
  // measured extent; it is not claimed as a captured glyph/line rectangle.
  const field = x.control(d411Rect(101, 200.984375, 281.5, 138), { id: "original-field", isConnected: true,
    outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "3px",
    getAttribute(name) { assert.equal(name, "aria-describedby"); return "original-field-help"; } });
  const label = Object.assign(new NativeLabel(), x.ancestor(d411Rect(101, 176, 281.5, 222), { parentElement: x.surface }),
    { control: foreign ? {} : field, htmlFor: field.id,
      querySelector(selector) {
        assert.ok([':scope > textarea[name="originalText"]', e6DocumentFieldSelector].includes(selector)); return field;
      } });
  field.parentElement = label; x.controls.push(field); x.f.document.activeElement = field;
  const fragment = d411Rect(101, 346.984375, 281.5, 50.515625);
  const help = x.copy(e6HelpCopySelector, fragment, [fragment], { tagName: "SMALL", id: "original-field-help", parentElement: label });
  return { x, NativeLabel, field, label, fragment, help };
}
for (const foreign of [false, true]) test("E6 associated Document help keeps native field ownership / " + (foreign ? "foreign label refused" : "current label"), { concurrency: false }, t => {
  const { x, field, label, fragment, help } = e6DocumentHelpPlacement(t, foreign);
  const box = x.run();
  assert.equal(x.f.document.activeElement, field); assert.equal(label.htmlFor, field.id); assert.equal(help.id, "original-field-help");
  assert.equal(x.overlap(box, [fragment]).length, foreign ? 1 : 0,
    foreign ? "do not borrow a foreign label's help" : "protect the associated visible help without transferring focus");
  assert.equal(x.rangeReads.length + x.copyBoxReads.length, foreign ? 0 : 1); assert.deepEqual(x.detached, x.rangeReads);
  assert.deepEqual(x.queries, [d420TaskRegionQuery]); assert.deepEqual(x.f.emitted, []); assert.ok(x.boxes.length <= 14);
});

// These adjacent text Range inputs are explicitly declared counterexamples:
// copy69-ask-candidate-r1 captured the native03 field/ring/help/client bounds,
// but did not measure packageLabel help, intro paragraphs or label glyphs.
for (const foreign of [false, true]) test("E6 package label help stays separate from original request focus / " + (foreign ? "foreign label refused" : "both associated helps"), { concurrency: false }, t => {
  const { x, NativeLabel, field, label, fragment } = e6DocumentHelpPlacement(t);
  const context = x.ancestor(d411Rect(72, 142.5, 340, 255), { parentElement: x.surface, overflowX: "auto", overflowY: "auto", scrollTop: 2377.5 });
  label.parentElement = context;
  const packageField = x.control(d411Rect(101, 92, 281.5, 44), { tagName: "INPUT", name: "packageLabel", id: "package-field", value: "Executive deck",
    getAttribute(name) { assert.equal(name, "aria-describedby"); return "package-field-help"; } });
  const packageLabel = Object.assign(new NativeLabel(), x.ancestor(d411Rect(101, 66, 281.5, 105), { parentElement: context }),
    { control: foreign ? {} : packageField, htmlFor: packageField.id,
      querySelector(selector) { assert.equal(selector, e6DocumentFieldSelector); return packageField; } });
  packageField.parentElement = packageLabel; x.controls.push(packageField);
  const packageFragment = d411Rect(101, 147, 281.5, 24);
  const packageHelp = x.copy(e6DocumentCopySelectors[2], packageFragment, [packageFragment],
    { tagName: "SMALL", id: "package-field-help", parentElement: packageLabel, textContent: "Original wording is preserved separately." });
  x.f.panel.draftForTest = "  Keep independent unsent guidance.  ";
  const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages, scroll: context.scrollTop };
  const box = x.run(), ring = d411Rect(95, 194.984375, 293.5, 150);
  assert.equal(x.overlap(box, [fragment, ring]).length, 0, "retain original request body/ring/help protection together");
  assert.equal(x.overlap(box, [packageFragment]).length, foreign ? 1 : 0,
    foreign ? "a foreign label cannot supply this help" : "clear the newly covered package-label help too");
  assert.equal(x.copyBoxReads.includes(packageHelp) || x.rangeReads.includes(packageHelp.textNodes[0]), !foreign);
  assert.equal(x.f.document.activeElement, field); assert.equal(packageField.value, "Executive deck");
  assert.equal(x.f.panel.draftForTest, "  Keep independent unsent guidance.  ");
  assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages); assert.equal(context.scrollTop, before.scroll);
  assert.deepEqual(x.detached, x.rangeReads); assert.deepEqual(x.queries, [d420TaskRegionQuery]);
  assert.deepEqual(x.f.emitted, []); assert.ok(box.top >= 8 && box.bottom <= 390); assert.ok(x.boxes.length <= 14);
});
test("E6 current Document intro and field label fragments remain ordinary copy beside the focused original field", { concurrency: false }, t => {
  const { x, field, label, fragment } = e6DocumentHelpPlacement(t);
  const texts = [
    x.copy(e6DocumentCopySelectors[0], d411Rect(101, 90, 281.5, 24), [d411Rect(101, 90, 281.5, 24)], { textContent: "This local interpretation is a proposal." }),
    x.copy(e6DocumentCopySelectors[1], d411Rect(101, 118, 281.5, 24), [d411Rect(101, 118, 281.5, 24)], { textContent: "Changes are not saved." }),
    x.copy(e6DocumentCopySelectors[2], d411Rect(101, 170, 281.5, 22), [d411Rect(101, 170, 281.5, 22)],
      { tagName: "SPAN", parentElement: label, textContent: "Original request" }),
  ];
  const box = x.run();
  assert.equal(x.overlap(box, [fragment, d411Rect(95, 194.984375, 293.5, 150), ...texts.flatMap(node => node.textNodes[0].fragments)]).length, 0);
  assert.ok(texts.every(node => x.copyBoxReads.includes(node) || x.rangeReads.includes(node.textNodes[0])),
    "both direct paragraphs and the associated span participate in the admitted current editor regions");
  assert.equal(x.f.document.activeElement, field); assert.deepEqual(x.detached, x.rangeReads);
  assert.deepEqual(x.queries, [d420TaskRegionQuery]); assert.deepEqual(x.f.emitted, []); assert.ok(x.boxes.length <= 14);
});
for (const foreign of [false, true]) test("E6 implicit Settings label is copy beside its native input / " + (foreign ? "foreign form refused" : "current form"), { concurrency: false }, t => {
  // This finite port declares integer innerHeight398. Its normal/compact reset
  // starts at height -8 -44; the recorded CSS layout height398.5 is distinct.
  const viewport = { width: 419, height: 398 };
  const x = e6CopyPlacement(t, { viewport, right: 409, top: viewport.height - 8 - 44, normalWidth: 199.171875 });
  class NativeLabel {}
  const previous = Object.getOwnPropertyDescriptor(globalThis, "HTMLLabelElement");
  Object.defineProperty(globalThis, "HTMLLabelElement", { configurable: true, value: NativeLabel });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "HTMLLabelElement", previous); else delete globalThis.HTMLLabelElement; });
  // Exact FR200 candidate ranges-1 native bodies, label parent box and selected
  // H2/P fragments. The label's text-only Range is declared within its measured
  // 74.390625px body; parent whitespace/input area is never substituted for it.
  const form = x.ancestor(d411Rect(105.7578125, 146.7109375, 279.484375, 130.390625), { parentElement: x.surface });
  const name = x.control(d411Rect(105.7578125, 177.1015625, 279.484375, 44), { tagName: "INPUT", name: "name", value: "", form: foreign ? {} : form });
  const create = x.control(d411Rect(105.7578125, 233.1015625, 195.125, 44), { tagName: "BUTTON", outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "3px", parentElement: form });
  const textRange = d411Rect(105.7578125, 148, 265, 22);
  const label = x.copy(e6SettingsCopySelectors[4], d411Rect(105.7578125, 146.7109375, 279.484375, 74.390625), [textRange],
    { tagName: "LABEL", parentElement: form, control: name, textContent: "Nom de la nouvelle organisation",
      querySelector(selector) { assert.equal(selector, ':scope > input[name="name"]'); return name; } });
  Object.setPrototypeOf(label, NativeLabel.prototype); name.parentElement = label;
  x.controls.push(name, create); x.f.document.activeElement = create;
  const copyInputs = [
    [2, "H2", d411Rect(105.7578125, 41.125, 279.484375, 22.3984375), [d411Rect(105.7578125, 38.125, 156.1875, 27.5)]],
    [2, "P", d411Rect(105.7578125, 79.5234375, 279.484375, 51.1875), [d411Rect(105.7578125, 81.0234375, 261.8515625, 22), d411Rect(105.7578125, 106.6171875, 96.9765625, 22)]],
    [3, "H2", d411Rect(105.7578125, 331.1015625, 279.484375, 22.3984375), [d411Rect(105.7578125, 328.1015625, 236.1875, 27.5)]],
    [3, "P", d411Rect(105.7578125, 369.5, 279.484375, 51.1875), [d411Rect(105.7578125, 371, 246.625, 22), d411Rect(105.7578125, 396.59375, 39.234375, 22)]],
  ];
  for (const [index, tagName, raw, fragments] of copyInputs) x.copy(e6SettingsCopySelectors[index], raw, fragments, { tagName });
  const box = x.run();
  assert.equal(x.overlap(box, [name.getBoundingClientRect(), d411Rect(99.7578125, 227.1015625, 207.125, 56), ...copyInputs.flatMap(input => input[3])]).length, 0);
  assert.equal(x.overlap(box, [textRange]).length, foreign ? 1 : 0, "implicit label text contributes only under its actual native control/form association");
  assert.equal(x.rangeReads.includes(label.textNodes[0]), !foreign);
  assert.equal(x.f.document.activeElement, create); assert.equal(name.value, "");
  assert.deepEqual(x.detached, x.rangeReads); assert.deepEqual(x.queries, [d420TaskRegionQuery]);
  assert.deepEqual(x.f.emitted, []); assert.ok(box.top >= 8 && box.bottom <= 390); assert.ok(x.boxes.length <= 14);
});

test("E6 measured Document200 editor boxes use the existing clipped compact header lane", { concurrency: false }, t => {
  const { x, NativeLabel, field, label } = e6DocumentHelpPlacement(t);
  // Exact body/client inputs from copy69-adjacent-candidate-r1 Document03.
  // Clip ports below represent the recorded native client rectangles. They do
  // not substitute the raw, partly clipped Change view button for its paint.
  Object.assign(x.shell, x.ancestor(d411Rect(0, 0, 419, 398.5), { overflowX: "clip", overflowY: "clip" }));
  Object.assign(x.main, x.ancestor(d411Rect(0, 48, 419, 350.5), { parentElement: x.shell, overflowX: "clip", overflowY: "clip" }));
  const workspace = x.ancestor(d411Rect(72, 48, 347, 350.5), { parentElement: x.surface, overflowX: "clip", overflowY: "clip" });
  const studio = x.ancestor(d411Rect(72, 109, 347, 289.5), { parentElement: workspace, overflowX: "auto", overflowY: "auto", scrollTop: 117.5 });
  const nav = x.ancestor(d411Rect(72, 88.5, 287, 52), { parentElement: studio, overflowX: "auto", overflowY: "auto" });
  const grid = x.ancestor(d411Rect(72, 142.5, 347, 256), { parentElement: studio, overflowX: "clip", overflowY: "clip" });
  const context = x.ancestor(d411Rect(72, 142.5, 340, 255), { parentElement: grid, overflowX: "auto", overflowY: "auto", scrollTop: 2377.5 });
  const switcher = x.ancestor(d411Rect(59, -1.5, 173, 50), { parentElement: x.shell, overflowX: "auto", overflowY: "auto" });
  const audience = x.ancestor(d411Rect(0, 48, 71, 350.5), { parentElement: x.shell, overflowX: "auto", overflowY: "auto" });
  label.parentElement = context;
  const clips = { shell: x.shell, workspace, nav, context, switcher, audience };
  const recordedControls = [
    ["BUTTON", [8, 1.5, 44, 44], [8, 1.5, 44, 44], "shell"],
    ["A", [62, 1.5, 153.875, 44], [62, 1.5, 153.875, 44], "switcher"],
    ["A", [217.875, 1.5, 72.6640625, 44], [217.875, 1.5, 14.125, 44], "switcher"],
    ["SELECT", [239.3828125, 1.5, 75.6171875, 44], [239.3828125, 1.5, 75.6171875, 44], "shell"],
    ["BUTTON", [319, 1.5, 44, 44], [319, 1.5, 44, 44], "shell"],
    ["BUTTON", [367, 1.5, 44, 44], [367, 1.5, 44, 44], "shell"],
    ["A", [4, 48, 63, 68.5], [4, 48, 63, 68.5], "audience"],
    ["A", [4, 118.5, 63, 68.5], [4, 118.5, 63, 68.5], "audience"],
    ["A", [4, 189, 63, 68.5], [4, 189, 63, 68.5], "audience"],
    ["A", [4, 259.5, 63, 68.5], [4, 259.5, 63, 68.5], "audience"],
    ["A", [4, 330, 63, 68.5], [4, 330, 63, 68], "audience"],
    ["BUTTON", [156.734375, 56, 177.5234375, 44], [156.734375, 56, 177.5234375, 44], "workspace"],
    ["A", [78, 92.5, 51.5546875, 44], [78, 109, 51.5546875, 27.5], "nav"],
    ["A", [131.5546875, 92.5, 56.5234375, 44], [131.5546875, 109, 56.5234375, 27.5], "nav"],
    ["A", [190.078125, 92.5, 65.40625, 44], [190.078125, 109, 65.40625, 27.5], "nav"],
    ["BUTTON", [264.484375, 92.5, 195.2109375, 44], [264.484375, 109, 94.515625, 27.5], "nav"],
    ["TEXTAREA", [101, 200.984375, 281.5, 138], [101, 200.984375, 281.5, 138], "context"],
  ];
  const visibleControls = recordedControls.map(([, , visible]) => d411Rect(...visible));
  let view;
  for (const [index, [tagName, raw, , clip]] of recordedControls.entries()) {
    if (tagName === "TEXTAREA") continue; // The same measured, focused field already exists.
    const control = x.control(d411Rect(...raw), { tagName, parentElement: clips[clip] });
    x.controls.push(control); if (index === 15) view = control;
  }
  // Only the label association is supplied for the wholly clipped package
  // input; no unmeasured package-input rectangle is invented or admitted.
  const packageField = { id: "package-field", value: "Executive deck",
    getAttribute(name) { assert.equal(name, "aria-describedby"); return "package-field-help"; } };
  const packageLabel = Object.assign(new NativeLabel(), x.ancestor(d411Rect(0, 0, 0, 0), { parentElement: context }),
    { control: packageField, htmlFor: packageField.id,
      querySelector(selector) { assert.equal(selector, e6DocumentFieldSelector); return packageField; } });
  const recordedRegions = [
    ["originalHelp", 2, "SMALL", [101, 346.984375, 281.5, 63], "This local interpretation is a proposal. Inspect and edit it before confirming; no provider is contacted."],
    ["proposal", 0, "P", [101, -127.390625, 281.5, 77.1875], "Proposed requirements \u2014 not yet saved"],
    ["dirty", 1, "P", [101, -34.203125, 281.5, 51.1875], "Local edits do not change saved completion or approval."],
    ["packageLabel", 2, "SPAN", [101, 32.984375, 281.5, 21], "Purpose or package name"],
    ["packageHelp", 2, "SMALL", [101, 113.984375, 281.5, 42], "Names can contain up to 240 characters. Original wording is preserved separately."],
    ["originalLabel", 2, "SPAN", [101, 171.984375, 281.5, 21], "Original request"],
  ];
  // Replace the existing help port with its full measured63px body. The narrow
  // text Ranges below are declared counterexamples, not captured glyph metrics:
  // the protected box contract must hold even when its right edge is whitespace.
  const existingHelp = x.copyBoxReads; assert.deepEqual(existingHelp, []);
  const regionNodes = recordedRegions.map(([key, selectorIndex, tagName, raw, textContent]) => {
    const bounds = d411Rect(...raw), parentElement = key.startsWith("package") ? packageLabel : key.startsWith("original") ? label : context;
    const properties = { tagName, parentElement, textContent };
    if (key === "originalHelp") properties.id = field.id + "-help";
    if (key === "packageHelp") properties.id = packageField.id + "-help";
    return x.copy(e6DocumentCopySelectors[selectorIndex], bounds, [d411Rect(bounds.left, bounds.top, 190, bounds.height)], properties);
  });
  // The generic setup's original help remains a distinct associated node only
  // in its old exact selector. Remove that one source alias for this measured
  // six-node editor so neither baseline nor candidate gets a duplicate region.
  x.replaceOriginalHelpForTest(regionNodes[0]);
  const rawGuidance = "  Preserve this independent Document question.  ";
  x.f.panel.draftForTest = rawGuidance;
  const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages, context: context.scrollTop, studio: studio.scrollTop };
  const box = x.run(), ring = d411Rect(95, 194.984375, 293.5, 150);
  const visibleRegions = recordedRegions.map(([, , , raw]) => {
    const r = d411Rect(...raw), top = Math.max(r.top, 142.5), bottom = Math.min(r.bottom, 397.5);
    return d411Rect(r.left, top, r.width, bottom - top);
  }).filter(r => r.height > 0);
  assert.equal(x.controls.length, 17); assert.equal(recordedRegions.length, 6); assert.equal(visibleRegions.length, 3);
  assert.equal(x.overlap(box, [...visibleControls, ...visibleRegions, ring]).length, 0,
    "the current native field, all17 recorded visible controls and all6 admitted editor boxes share one clear bounded placement");
  assert.equal(box.left, 365); assert.equal(box.width, 44); assert.equal(box.height, 44);
  assert.ok(box.top >= 8 && box.bottom <= 390); assert.ok(x.boxes.length <= 14);
  assert.equal(x.overlap(box, [view.getBoundingClientRect()]).length, 1, "the raw Change view box really crosses this lane");
  assert.equal(x.overlap(box, [visibleControls[15]]).length, 0, "its recorded client-clipped paint ends at359");
  assert.ok(regionNodes.every(node => x.copyBoxReads.includes(node)), "all6 owned boxes are read, including the3 fully clipped regions");
  assert.equal(x.rangeReads.length, 0, "only Document's existing box contract changes; no glyph proxy is used here");
  assert.equal(x.f.document.activeElement, field); assert.equal(packageField.value, "Executive deck");
  assert.equal(x.f.panel.draftForTest, rawGuidance); assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
  assert.equal(context.scrollTop, before.context); assert.equal(studio.scrollTop, before.studio);
  assert.deepEqual(x.queries, [d420TaskRegionQuery]); assert.deepEqual(x.f.emitted, []);
});
