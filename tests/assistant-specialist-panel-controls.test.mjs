import { libraryBlockEditorFromRoute } from '../src/model/routes.ts';
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
    "../../model/routes.ts": {libraryBlockEditorFromRoute},
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
function d411Placement(t, controls = [], viewport = { width: 419.5, height: 398.5 }, nativeWindow, locale = "en") {
  const f = fixture(locale, nativeWindow), values = new Map(), writes = [], boxes = [], restore = [];
  const x = { f, controls, regions: [], alertRegions: [], queries: [], values, writes, boxes, hovered: false };
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
    const withShellAlert = withTaskRegions + ", .app-shell > .error-banner[role='alert']";
    x.queries.push(selector);
    if (selector === controlsOnly) return x.controls;
    if (selector === withTaskRegions) return [...x.controls, ...x.regions];
    assert.equal(selector, withShellAlert, "only the exact direct Shell alert extends the existing task-region query");
    return [...x.controls, ...x.regions, ...x.alertRegions];
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
const d420TaskRegionQuery = "a[href], button, input, textarea, select, summary, [role='button'], [contenteditable='true'], .output-requirement-warning, .output-recipe-entry, forma-ui-notice, .app-shell > .error-banner[role='alert']";

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
    const completed = x.run();
    assert.equal(completed.top, 740.5); assert.equal(completed.width, 44); assert.equal(completed.height, 44);
    assert.equal(x.f.panel.dataset.tightLauncher, "true");
    assert.equal(x.overlap(completed, [...x.controls.map(control => control.getBoundingClientRect()), paintedEntry]).length, 0,
      "the exhaustive search now uses the previously unexamined clear lower gap");
    // Explicit synthetic extension: occupy that lower gap so the original
    // hovered Account recovery and unsupported-paint refusal remain reachable.
    // Placement still runs normally; no offset, focus or marker is forced.
    x.controls.push(x.control(d411Rect(266, 733, 44, 59), { tagName: "BUTTON" }));
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
  shell.querySelector = selector => {
    if(selector === ':scope > forma-ui-audience-navigation.application-task-navigation[data-primary-navigation="true"]')return null;
    assert.ok(["#main-content",":scope > #main-content"].includes(selector)); return main;
  };
  main.querySelector = selector => { assert.equal(selector,"forma-deliver > .forma-deliver-page"); return null; };
  main.getAttribute = name => { assert.equal(name, "aria-busy"); return String(state.busy); };
  main.closest = selector => { assert.equal(selector, ".application-creative"); return shell; };
  // Ordinary-copy owners are a separate explicit port when a reserved-slot
  // counterexample falls back to floating placement; native queries stay strict.
  x.copyOwnerQueries = [];
  main.querySelectorAll = selector => {
    if (["forma-workspace-settings", "forma-library", "forma-reality-layers", "forma-project-contents", "forma-workspace", '.application-loading[role="status"]', "forma-document-generations"].includes(selector)) {
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
const fTerminalCopyOwner = '.application-loading[role="status"]';
const fTerminalCopySelector = ":scope > div > :is(b,p)";
const imageHistoryCopyOwner = "forma-document-generations";
const imageHistoryCopySelector = ":scope > section.document-generations > header > div:first-child > :is(.eyebrow,h2,p)";
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
const fLibraryWeightFormSelector = '.library-main > forma-library-block-editor > .library-block-editor > .library-block-editor-layout > .library-block-workbench > form.library-block-form';
const fLibraryWeightLabelSelector = ':scope > fieldset[aria-labelledby="library-block-content"] > label.library-weight';
const fLibraryWeightCopySelector = fLibraryWeightFormSelector + ' > fieldset[aria-labelledby="library-block-content"] > label.library-weight > output';
const fLibraryWeightLabelCopySelector = fLibraryWeightFormSelector + ' > fieldset[aria-labelledby="library-block-content"] > label.library-weight';
function e6CopyPlacement(t, { family = "forma-workspace-settings", locale = "en", viewport = { width: 320, height: 800 }, right = 310, top = 680, normalWidth = 137.1875 } = {}) {
  const x = d411Placement(t, [], viewport, undefined, locale), full = d411Rect(0, 0, viewport.width, viewport.height);
  const shell = x.ancestor(full), main = x.ancestor(full, { parentElement: shell });
  const surface = x.ancestor(full, { parentElement: main, isConnected: true });
  const selected = new Map(), familyQueries = [], allOwnerQueries = [], layersOwnerQueries = [], terminalOwnerQueries = [], imageOwnerQueries = [], copyQueries = [], allCopyQueries = [], fCopyQueries = [], fLabelQueries = [], rangeReads = [], detached = [], copyBoxReads = [];
  shell.getAttribute = name => { assert.equal(name, "data-layout-intent"); return "browse"; };
  shell.querySelectorAll = selector => { assert.equal(selector, "forma-assistant-panel"); return [x.f.panel]; };
  shell.querySelector = selector => {
    if(selector === ':scope > forma-ui-audience-navigation.application-task-navigation[data-primary-navigation="true"]')return null;
    assert.ok(["#main-content",":scope > #main-content"].includes(selector)); return main;
  };
  main.querySelector = selector => { assert.equal(selector,"forma-deliver > .forma-deliver-page"); return null; };
  main.getAttribute = name => { assert.equal(name, "aria-busy"); return "false"; };
  main.closest = selector => { assert.equal(selector, ".application-creative"); return shell; };
  main.querySelectorAll = selector => {
    // Preserve the original four-family ledger while retaining EVERY actual
    // query in allOwnerQueries. Each exact added owner has its own narrow port.
    allOwnerQueries.push(selector);
    if (selector === "forma-reality-layers") {
      layersOwnerQueries.push(selector); return selector === family ? [surface] : [];
    }
    if (selector === fTerminalCopyOwner) {
      terminalOwnerQueries.push(selector); return selector === family ? [surface] : [];
    }
    if (selector === imageHistoryCopyOwner) {
      imageOwnerQueries.push(selector); return selector === family ? [surface] : [];
    }
    assert.ok(e6CopyFamilies.includes(selector), "only separately declared copy-owner families are queried");
    familyQueries.push(selector); return selector === family ? [surface] : [];
  };
  surface.closest = selector => {
    if (selector === "#main-content") return main;
    assert.equal(selector, ".application-creative"); return shell;
  };
  surface.querySelectorAll = selector => {
    assert.ok((family === "forma-workspace" ? [e6HelpCopySelector, ...e6DocumentCopySelectors]
      : family === "forma-library" ? [...e11LibraryCopySelectors, fLibraryWeightCopySelector, fLibraryWeightLabelCopySelector]
      : family === fTerminalCopyOwner ? [fTerminalCopySelector]
      : family === imageHistoryCopyOwner ? [imageHistoryCopySelector]
      : family === "forma-reality-layers" ? e11LayersCopySelectors : e6SettingsCopySelectors).includes(selector),
      "copy selection remains restricted to the actual declared owner family");
    // Keep each original selector in its original ledger; the two new Library
    // copy admissions have distinct ledgers and a complete ordered census.
    allCopyQueries.push(selector);
    if (selector === fLibraryWeightCopySelector) fCopyQueries.push(selector);
    else if (selector === fLibraryWeightLabelCopySelector) fLabelQueries.push(selector);
    else copyQueries.push(selector);
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
      matches(query) { assert.equal(query, fLibraryWeightLabelCopySelector); return false; },
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
  x.selectWeightLabelForTest = label => {
    assert.equal(family, "forma-library"); assert.equal(label.tagName, "LABEL");
    assert.equal(selected.has(fLibraryWeightLabelCopySelector), false, "select the same associated label only once");
    selected.set(fLibraryWeightLabelCopySelector, [label]);
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
  const baseRun = x.run;
  x.run = () => {
    const start = allOwnerQueries.length, copyStart = allCopyQueries.length, box = baseRun();
    const actual = allOwnerQueries.slice(start);
    const expected = actual.length === 0 ? [] : actual.includes("forma-reality-layers")
      ? [e6CopyFamilies[0], e6CopyFamilies[1], "forma-reality-layers", e6CopyFamilies[2], e6CopyFamilies[3]] : [...e6CopyFamilies];
    if (actual.includes(fTerminalCopyOwner)) expected.push(fTerminalCopyOwner);
    if (actual.includes(imageHistoryCopyOwner)) expected.push(imageHistoryCopyOwner);
    assert.deepEqual(actual, expected, "every copy-fixture pass retains the exact empty, original-four, extended-five, terminal-six or Image-seven owner query sequence");
    if (family === "forma-library") {
      const actualCopy = allCopyQueries.slice(copyStart), added = fLibraryWeightCopySelector;
      const labelTail = actualCopy.includes(fLibraryWeightLabelCopySelector) ? [fLibraryWeightLabelCopySelector] : [];
      if (labelTail.length) assert.ok(actualCopy.includes(added), "the label admission follows the existing OUTPUT admission");
      assert.deepEqual(actualCopy, actualCopy.length ? [...e11LibraryCopySelectors, ...(actualCopy.includes(added) ? [added] : []), ...labelTail] : [],
        "the complete Library copy-query sequence retains its family and ordered additions, without skips, duplicates or hidden queries");
    }
    return box;
  };
  return Object.assign(x, { familyQueries, allOwnerQueries, layersOwnerQueries, terminalOwnerQueries, imageOwnerQueries, copyQueries, allCopyQueries, fCopyQueries, fLabelQueries, rangeReads, detached, copyBoxReads, surface, main, shell });
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


// E11 exercises the existing real Panel -> updated -> finite RAF path. The
// two FR cases use the R2 recorded target/native-focus/Ask rectangles. They
// are bounded geometry ports, not a renderer, full-page reconstruction,
// native zoom, hit-test or physical acceptance replay. Other geometry below
// is explicitly synthetic, including the narrower Range counterexamples.
const e11LibraryContentPrefix = '.library-main > forma-library-block-editor > .library-block-editor > .library-block-editor-layout > .library-block-workbench > form.library-block-form > fieldset[aria-labelledby="library-block-content"]';
const e11LibraryCopySelectors = [
  '.library-main > .page-header--library > .page-header-copy > :is(.eyebrow,h1,p)',
  '.library-body .section-heading > div > :is(.eyebrow,h2,p.section-note)',
  '.library-main > .library-body > section.lifecycle-next-actions > p.lifecycle-next-scope',
  '.library-main > .library-body > section.lifecycle-next-actions > p.muted[role="status"]',
  e11LibraryContentPrefix + ' > h3#library-block-content',
  e11LibraryContentPrefix + ' > forma-ui-rich-text.block-editor-copy > .ui-rich-text > :is(label.ui-rich-text-label,small:not(.ui-field-error))',
  '.library-main > .library-body > .library-content > section:has(> .section-heading > forma-ui-segmented-control.compact-segmented) > .family-empty[data-forma-empty-state] > :is(h3,p)',
  '.library-main > .library-body > .library-content > section > .library-output-grid > article.library-output > forma-output-card > article.output-card > .output-info > div:first-child',
];
const e11LibraryLabelBox = d411Rect(88.7578125, 147, 313.484375, 22.3984375);
const e11LibraryLabelRange = d411Rect(88.7578125, 148.5, 157.640625, 19);
const e11LibraryRecentBox = d411Rect(121.7578125, 261.4375, 247.484375, 102.375);
const e11LibraryRecentRanges = [
  d411Rect(160.96875, 262.9375, 169.0546875, 22),
  d411Rect(144.421875, 288.53125, 202.15625, 22),
  d411Rect(127.390625, 314.125, 236.2109375, 22),
  d411Rect(137.0625, 339.71875, 216.875, 22),
];
const e11LibraryRecentText = 'Les créations du projet apparaissent ici lorsqu’elles correspondent à la recherche et au filtre de collection actuels.';
function e11LibraryPlacement(t, { top = 119.3984375 } = {}) {
  const x = e6CopyPlacement(t, { family: 'forma-library', locale: 'fr',
    viewport: { width: 419, height: 398 }, right: 409, top, normalWidth: 199.171875 });
  x.surface.matches = selector => { assert.equal(selector, '.family-empty[data-forma-empty-state]'); return false; };
  x.surface.scrollTop = 0;
  x.f.panel.draftForTest = '  Garder cette question indépendante.  ';
  x.before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages, scroll: x.surface.scrollTop,
    draft: x.f.panel.draftForTest };
  return x;
}
function e11LibraryUnchanged(x, box, focused) {
  assert.equal(x.f.i18n.t('assistant.open'), 'Demander à Forma', 'the actual fixture translation closure is French');
  assert.equal(x.f.document.activeElement, focused);
  assert.equal(x.f.panel.draftForTest, x.before.draft);
  assert.equal(x.f.panel.tasks, x.before.tasks); assert.equal(x.f.panel.messages, x.before.messages);
  assert.equal(x.surface.scrollTop, x.before.scroll); assert.deepEqual(x.f.emitted, []);
  assert.equal(box.height, 44); assert.ok(box.width >= 44);
  assert.ok(box.top >= 8 && box.bottom <= 390.5); assert.ok(x.boxes.length <= 14);
  assert.deepEqual(x.queries, [d420TaskRegionQuery]); assert.deepEqual(x.familyQueries, e6CopyFamilies);
  assert.deepEqual(x.detached, x.rangeReads);
}
function e11LibraryEditor(t, { target = 'LABEL', defect = null } = {}) {
  const x = e11LibraryPlacement(t);
  class NativeLabel {}
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'HTMLLabelElement');
  Object.defineProperty(globalThis, 'HTMLLabelElement', { configurable: true, value: NativeLabel });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'HTMLLabelElement', previous); else delete globalThis.HTMLLabelElement; });
  const form = x.ancestor(d411Rect(72, 0, 347, 398), { parentElement: x.surface });
  const rich = x.ancestor(d411Rect(88.7578125, 147, 313.484375, 250), { parentElement: form });
  const field = x.control(d411Rect(88.7578125, 177.3984375, 313.484375, 164), {
    tagName: 'TEXTAREA', id: 'e11-library-content', value: '', isConnected: true, form, parentElement: rich,
    outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '3px',
    getAttribute(name) { assert.equal(name, 'aria-describedby'); return this.describedBy; },
    describedBy: 'unrelated-help e11-library-content-help final-help',
  });
  const label = Object.assign(new NativeLabel(), { tagName: 'LABEL', parentElement: rich,
    control: field, htmlFor: field.id, textContent: 'Contenu de Orientation' });
  rich.querySelector = selector => {
    if (selector === ':scope > textarea.ui-rich-text-input') return defect === 'missing-sibling' ? null : field;
    assert.equal(selector, ':scope > label.ui-rich-text-label'); return label;
  };
  // The SMALL uses a declared counterexample footprint at the label position;
  // R2 stopped at the label, so this is not a measured help-body claim.
  const copy = x.copy(e11LibraryCopySelectors[5], e11LibraryLabelBox, [e11LibraryLabelRange], {
    tagName: target, parentElement: rich, control: field, htmlFor: field.id,
    id: target === 'SMALL' ? field.id + '-help' : '',
    textContent: target === 'SMALL' ? 'La mise en forme Markdown est disponible.' : label.textContent,
  });
  const baseClosest = copy.closest;
  copy.closest = function(selector) { return selector === 'form.library-block-form' ? form : baseClosest.call(this, selector); };
  if (target === 'LABEL') {
    Object.setPrototypeOf(copy, NativeLabel.prototype);
    rich.querySelector = selector => {
      if (selector === ':scope > textarea.ui-rich-text-input') return defect === 'missing-sibling' ? null : field;
      assert.equal(selector, ':scope > label.ui-rich-text-label'); return defect === 'different-label' ? label : copy;
    };
  }
  const associatedLabel = target === 'LABEL' ? copy : label;
  if (defect === 'foreign-control') associatedLabel.control = {};
  if (defect === 'foreign-for') associatedLabel.htmlFor = 'other-field';
  if (defect === 'missing-id') field.id = '';
  if (defect === 'foreign-form') field.form = {};
  if (defect === 'foreign-help-id') copy.id = 'other-help';
  if (defect === 'foreign-description') field.describedBy = 'prefix-e11-library-content-help-suffix';
  x.controls.push(field); x.f.document.activeElement = field;
  return { x, field, form, rich, label: associatedLabel, copy };
}
function e11LibraryHistory(t) {
  const x = e11LibraryPlacement(t, { top: 346.5 });
  const empty = x.ancestor(d411Rect(88.7578125, 100, 313.484375, 280), { parentElement: x.surface,
    matches(selector) { assert.equal(selector, '.family-empty[data-forma-empty-state]'); return true; } });
  const copy = x.copy(e11LibraryCopySelectors[6], e11LibraryRecentBox, e11LibraryRecentRanges,
    { textContent: e11LibraryRecentText, parentElement: empty });
  // Actual R2 Recent focus has an inset outline; its body is unchanged by it.
  const focused = x.control(d411Rect(95.15625, 40.4453125, 89.1484375, 44), {
    tagName: 'BUTTON', type: 'button', pressed: 'true', parentElement: x.surface,
    outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '-3px',
  });
  x.controls.push(focused); x.f.document.activeElement = focused;
  return { x, copy, empty, focused };
}
test('E11 FR measured Library label and native textarea ring clear Ask together', { concurrency: false }, t => {
  const { x, field, label, copy } = e11LibraryEditor(t);
  const initial = x.launcher.getBoundingClientRect();
  assert.equal(x.overlap(initial, [e11LibraryLabelBox]).length, 1);
  assert.equal(x.overlap(initial, [e11LibraryLabelRange]).length, 1, 'the measured FR glyph collision is present in this input');
  const box = x.run(), ring = d411Rect(82.7578125, 171.3984375, 325.484375, 176);
  assert.equal(x.overlap(box, [e11LibraryLabelBox, ring]).length, 0,
    'the full current label box and current native textarea/ring must both be clear');
  assert.equal(box.bottom, 139, 'the label box, rather than its 1.5px-lower Range, sets the 8px clearance');
  assert.equal(box.width, 199.171875); assert.equal(box.left, 209.828125);
  assert.deepEqual(x.copyBoxReads, [copy]); assert.deepEqual(x.rangeReads, []);
  assert.equal(label.control, field); assert.equal(label.htmlFor, field.id); assert.equal(field.value, '');
  assert.deepEqual(x.copyQueries, e11LibraryCopySelectors); e11LibraryUnchanged(x, box, field);
});
test('E11 FR measured Library Recent help box clears Ask with native scope focus preserved', { concurrency: false }, t => {
  const { x, copy, focused } = e11LibraryHistory(t), initial = x.launcher.getBoundingClientRect();
  assert.equal(x.overlap(initial, [e11LibraryRecentBox]).length, 1);
  assert.equal(x.overlap(initial, [e11LibraryRecentRanges[3]]).length, 1, 'the measured fourth-line obstruction is present');
  const box = x.run();
  assert.equal(x.overlap(box, [e11LibraryRecentBox, focused.getBoundingClientRect()]).length, 0,
    'clear the full history-help box without changing the current native scope');
  assert.equal(box.bottom, 253.4375, 'the box top, not first-line Range top, controls clearance');
  assert.equal(box.width, 199.171875); assert.deepEqual(x.copyBoxReads, [copy]); assert.deepEqual(x.rangeReads, []);
  assert.equal(copy.textContent, e11LibraryRecentText); assert.equal(focused.pressed, 'true');
  assert.deepEqual(x.copyQueries, e11LibraryCopySelectors); e11LibraryUnchanged(x, box, focused);
});
for (const target of ['LABEL', 'SMALL']) test('E11 Library full associated box protects whitespace / ' + target, { concurrency: false }, t => {
  const { x, field, label, copy } = e11LibraryEditor(t, { target });
  // Deliberately narrower than the measured FR label Range: this synthetic
  // counterexample distinguishes the selected whole box from glyph coverage.
  copy.textNodes[0].fragments = [d411Rect(90, 148.5, 80, 19)];
  assert.equal(x.overlap(x.launcher.getBoundingClientRect(), copy.textNodes[0].fragments).length, 0);
  field.value = '  Café — العربية — 日本語  ';
  const box = x.run();
  assert.equal(x.overlap(box, [e11LibraryLabelBox]).length, 0);
  assert.equal(box.bottom, 139); assert.deepEqual(x.copyBoxReads, [copy]); assert.deepEqual(x.rangeReads, []);
  assert.equal(label.control, field); assert.equal(label.htmlFor, field.id);
  assert.equal(field.value, '  Café — العربية — 日本語  '); e11LibraryUnchanged(x, box, field);
});
for (const [target, defect] of [
  ['LABEL', 'missing-sibling'], ['LABEL', 'foreign-control'], ['LABEL', 'foreign-for'],
  ['LABEL', 'missing-id'], ['LABEL', 'foreign-form'], ['LABEL', 'different-label'],
  ['SMALL', 'foreign-help-id'], ['SMALL', 'foreign-description'],
]) test('E11 Library refuses unowned field copy / ' + defect, { concurrency: false }, t => {
  const { x, field } = e11LibraryEditor(t, { target, defect });
  const box = x.run();
  assert.equal(box.top, 119.3984375); assert.equal(x.overlap(box, [e11LibraryLabelBox]).length, 1,
    'rejected copy cannot become an obstacle through a foreign or missing native association');
  assert.deepEqual(x.copyBoxReads, []); assert.deepEqual(x.rangeReads, []);
  assert.equal(field.value, ''); e11LibraryUnchanged(x, box, field);
});
for (const defect of ['foreign-leaf', 'duplicate-owner', 'hidden-ancestor']) test('E11 Library retains current-owner copy gates / ' + defect, { concurrency: false }, t => {
  const { x, copy, focused } = e11LibraryHistory(t);
  if (defect === 'foreign-leaf') {
    const closest = copy.closest;
    copy.closest = function(selector) { return selector === 'forma-library' ? {} : closest.call(this, selector); };
  }
  if (defect === 'duplicate-owner') {
    const query = x.main.querySelectorAll, otherCurrentSurface = { ...x.surface };
    x.main.querySelectorAll = selector => { const result = query(selector); return selector === 'forma-library' ? [x.surface, otherCurrentSurface] : result; };
  }
  if (defect === 'hidden-ancestor') copy.hiddenAncestor = true;
  const box = x.run();
  assert.equal(box.top, 346.5); assert.equal(x.overlap(box, [e11LibraryRecentBox]).length, 1);
  assert.deepEqual(x.copyBoxReads, []); assert.deepEqual(x.rangeReads, []);
  e11LibraryUnchanged(x, box, focused);
});
test('E11 Library content and history headings retain Range geometry beside existing Library copy', { concurrency: false }, t => {
  const x = e11LibraryPlacement(t), raw = e11LibraryLabelBox;
  const parent = x.ancestor(raw, { parentElement: x.surface,
    matches(selector) { assert.equal(selector, '.family-empty[data-forma-empty-state]'); return false; } });
  const empty = x.ancestor(raw, { parentElement: x.surface,
    matches(selector) { assert.equal(selector, '.family-empty[data-forma-empty-state]'); return true; } });
  // These short, declared fragments leave whitespace beneath Ask. The history
  // H3 is deliberately inside the same empty card as the protected P family.
  const fragment = d411Rect(90, 148.5, 80, 19);
  const nodes = [
    x.copy(e11LibraryCopySelectors[0], raw, [fragment], { tagName: 'H1' }),
    x.copy(e11LibraryCopySelectors[4], raw, [fragment], { tagName: 'H3', parentElement: parent }),
    x.copy(e11LibraryCopySelectors[6], raw, [fragment], { tagName: 'H3', parentElement: empty }),
  ];
  const box = x.run();
  assert.equal(box.top, 119.3984375, 'heading whitespace is not upgraded to the full-box contract');
  assert.equal(x.overlap(box, [raw]).length, 1);
  assert.deepEqual(x.copyBoxReads, []); assert.deepEqual(x.rangeReads, nodes.map(node => node.textNodes[0]));
  assert.deepEqual(x.copyQueries, e11LibraryCopySelectors); e11LibraryUnchanged(x, box, null);
});
test('E11 Library empty help keeps the existing client clipping before obstacle placement', { concurrency: false }, t => {
  const { x, copy, empty, focused } = e11LibraryHistory(t);
  // Declared clip counterexample: only the first 8.5625px of the measured
  // paragraph body remains inside this 20px client. No raw parent box replaces it.
  const clip = x.ancestor(d411Rect(100, 250, 300, 20), { parentElement: x.surface, overflowY: 'hidden' });
  empty.parentElement = clip;
  const box = x.run(), visible = d411Rect(121.7578125, 261.4375, 247.484375, 8.5625);
  assert.equal(box.top, 346.5); assert.equal(x.overlap(box, [e11LibraryRecentBox]).length, 1);
  assert.equal(x.overlap(box, [visible]).length, 0, 'the raw, clipped-away body does not force an unnecessary move');
  assert.deepEqual(x.copyBoxReads, [copy]); assert.deepEqual(x.rangeReads, []);
  e11LibraryUnchanged(x, box, focused);
});
test('E11 an impossible Library full-box lane remains finite and visibly unresolved', { concurrency: false }, t => {
  const { x, copy, focused } = e11LibraryHistory(t), full = d411Rect(0, 0, 419, 398);
  copy.getBoundingClientRect = () => { x.copyBoxReads.push(copy); return full; };
  // The deliberately short fragment leaves a false lane if this protected P
  // were reduced to glyphs. Its full declared box leaves no possible placement.
  copy.textNodes[0].fragments = [d411Rect(20, 100, 40, 20)];
  const box = x.run();
  assert.equal(x.overlap(box, [full]).length, 1, 'finite fallback is not proof of clearance');
  // No lane exists, so the unchanged finite fallback retains the recorded
  // reset geometry (bottom390.5) rather than claiming a new in-bounds placement.
  assert.equal(box.width, 44); assert.equal(box.height, 44); assert.equal(box.bottom, 390.5);
  assert.deepEqual(x.copyBoxReads, [copy]); assert.deepEqual(x.rangeReads, []);
  e11LibraryUnchanged(x, box, focused);
});


// E11 Layers: the real Panel -> updated -> one finite RAF path with R3
// recorded LABEL/OUTPUT/range/Ask rectangles. Keep the measured 44px Ask
// footprint for every CSSOM read; this is not a reproduction of compact-mode
// transitions, all page peers, glyph paint, native zoom or full-page acceptance.
const e11LayersOwner = 'forma-reality-layers';
const e11LayersFormSelector = ':scope > .workspace-page.studio-alternative > .studio-main > .studio-subpage-body > .reality-editor[data-forma-content="primary"] > .layers-panel > form.layer-inspector[data-layer-inspector]';
const e11LayersCopySelectors = [
  e11LayersFormSelector + ' > label:has(> input[name="weight"][type="range"])',
  e11LayersFormSelector + ' > label:has(> input[name="weight"][type="range"]) > output',
];
const e11LayersMeasured = {
  en: { viewport: { width: 390, height: 844 }, right: 380, top: 637.609375,
    label: d411Rect(37, 646.109375, 316, 92), output: d411Rect(37, 666.109375, 316, 16),
    range: d411Rect(39, 688.109375, 316, 48), ring: d411Rect(33, 682.109375, 328, 60),
    labelText: 'Influence on the result ', labelRange: d411Rect(37, 647.109375, 103.828125, 14),
    outputRange: d411Rect(37, 667.109375, 20.890625, 14), name: 'Influence on the result',
    id: 'forma-layer-inspector-weight-4341bb5b-ad45-4658-b4a0-3fbb8cd31abc' },
  ar: { viewport: { width: 320, height: 800 }, right: 54, top: 623.1875,
    label: d411Rect(37, 630.6875, 246, 94), output: d411Rect(37, 651.6875, 246, 17),
    range: d411Rect(35, 674.6875, 246, 48), ring: d411Rect(29, 668.6875, 258, 60),
    labelText: 'التأثير في النتيجة ', labelRange: d411Rect(218.515625, 632.6875, 64.484375, 12),
    outputRange: d411Rect(260.90625, 653.6875, 22.09375, 12), name: 'التأثير في النتيجة',
    id: 'forma-layer-inspector-weight-3e8f42e4-8f05-4d49-9a64-c039a92e24ff' },
};
function e11LayersWeightPlacement(t, locale = 'en', defect = null) {
  const measured = e11LayersMeasured[locale];
  const x = e6CopyPlacement(t, { family: e11LayersOwner, locale, viewport: measured.viewport,
    right: measured.right, top: measured.top, normalWidth: 44 });
  class NativeForm {}
  class NativeLabel {}
  class NativeInput {}
  class NativeOutput {}
  const restore = [];
  for (const [key, value] of [['HTMLFormElement', NativeForm], ['HTMLLabelElement', NativeLabel],
    ['HTMLInputElement', NativeInput], ['HTMLOutputElement', NativeOutput]]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  t.after(() => { for (const undo of restore.reverse()) undo(); });
  // Form/source membership is a declared native-interface port. The recorded
  // copy/range boxes are retained without inventing other control rectangles.
  const form = Object.assign(new NativeForm(), x.ancestor(d411Rect(0, 0, measured.viewport.width, measured.viewport.height),
    { parentElement: x.surface, isConnected: true }), {
    key: 'e6-network-fourth-decision', getAttribute(name) { assert.equal(name, 'data-layer-inspector'); return this.key; },
  });
  const label = x.copy(e11LayersCopySelectors[0], measured.label, [measured.labelRange], {
    tagName: 'LABEL', parentElement: form, textContent: measured.labelText + '50%', htmlFor: measured.id,
  });
  Object.setPrototypeOf(label, NativeLabel.prototype);
  const output = x.copy(e11LayersCopySelectors[1], measured.output, [measured.outputRange], {
    tagName: 'OUTPUT', parentElement: label, form, textContent: '50%', value: '50%',
  });
  Object.setPrototypeOf(output, NativeOutput.prototype);
  const field = Object.assign(new NativeInput(), x.control(measured.range, {
    tagName: 'INPUT', type: 'range', name: 'weight', id: measured.id, value: '0.5', min: '0', max: '1', step: '.05',
    form, parentElement: label, previousElementSibling: output, labels: [label], isConnected: true,
    disabled: false, ariaLabel: measured.name, outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '3px',
  }));
  label.control = field;
  label.textNodes = [{ textContent: measured.labelText, parentElement: label, fragments: [measured.labelRange] }, ...output.textNodes];
  const forms = [form], formQueries = [], associationQueries = [];
  const baseQuery = x.surface.querySelectorAll;
  x.surface.querySelectorAll = selector => {
    if (selector === e11LayersFormSelector) { formQueries.push(selector); return forms; }
    return baseQuery(selector);
  };
  label.querySelectorAll = selector => {
    associationQueries.push(selector);
    if (selector === ':scope > input[name="weight"][type="range"]') return [field];
    assert.equal(selector, ':scope > output'); return [output];
  };
  if (defect === 'foreign-for') { label.htmlFor = 'other-field'; label.control = {}; field.labels = []; }
  if (defect === 'missing-id') { field.id = ''; label.control = null; field.labels = []; }
  if (defect === 'additional-label') field.labels = [label, Object.assign(new NativeLabel(), { htmlFor: field.id, control: field })];
  if (defect === 'foreign-range-form') field.form = new NativeForm();
  if (defect === 'foreign-output-form') output.form = new NativeForm();
  if (defect === 'multiple-current-forms') forms.push(Object.assign(new NativeForm(), form));
  if (defect === 'empty-form-key') form.key = '';
  if (defect === 'intervening-sibling') field.previousElementSibling = { tagName: 'SPAN', parentElement: label };
  if (defect === 'foreign-owner') for (const node of [label, output]) {
    const closest = node.closest;
    node.closest = function(selector) { return selector === e11LayersOwner ? {} : closest.call(this, selector); };
  }
  if (defect === 'hidden-ancestor') { label.hiddenAncestor = true; output.hiddenAncestor = true; }
  x.controls.push(field); x.f.document.activeElement = field;
  x.f.panel.draftForTest = '  Keep this independent Layers question.  ';
  const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages, draft: x.f.panel.draftForTest,
    value: field.value, output: output.value, text: output.textContent, label: label.textContent,
    key: form.key, formParent: form.parentElement, labelParent: label.parentElement,
    fieldParent: field.parentElement, outputParent: output.parentElement,
    fieldForm: field.form, outputForm: output.form, control: label.control, labels: field.labels,
    forValue: label.htmlFor, id: field.id, sibling: field.previousElementSibling };
  return { x, measured, form, label, output, field, forms, before, formQueries, associationQueries };
}
function e11LayersWeightUnchanged(state, box) {
  const { x, measured, field, label, output, form, before } = state;
  assert.equal(x.f.document.activeElement, field); assert.equal(field.getBoundingClientRect().height, 48);
  assert.equal(field.value, before.value); assert.equal(output.value, before.output); assert.equal(output.textContent, before.text);
  assert.equal(label.textContent, before.label); assert.equal(form.key, before.key);
  assert.equal(form.parentElement, before.formParent); assert.equal(label.parentElement, before.labelParent);
  assert.equal(field.parentElement, before.fieldParent); assert.equal(output.parentElement, before.outputParent);
  assert.equal(field.form, before.fieldForm); assert.equal(output.form, before.outputForm); assert.equal(label.control, before.control);
  assert.equal(field.labels, before.labels); assert.equal(label.htmlFor, before.forValue); assert.equal(field.id, before.id);
  assert.equal(field.previousElementSibling, before.sibling);
  assert.equal(x.f.panel.draftForTest, before.draft); assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
  assert.deepEqual(x.f.emitted, []); assert.equal(box.width, 44); assert.equal(box.height, 44);
  assert.ok(box.top >= 8 && box.bottom <= measured.viewport.height - 8); assert.ok(x.boxes.length <= 14);
  assert.deepEqual(x.queries, [d420TaskRegionQuery]); assert.deepEqual(x.detached, x.rangeReads);
}
for (const locale of ['en', 'ar']) test('E11 ' + locale + ' measured Layers weight boxes clear Ask while the current native range stays unchanged', { concurrency: false }, t => {
  const state = e11LayersWeightPlacement(t, locale), { x, measured, form, label, output, field } = state;
  const initial = x.launcher.getBoundingClientRect();
  assert.equal(x.overlap(initial, [measured.label, measured.output]).length, 2,
    'the recorded compact Ask body crosses both required copy boxes');
  assert.equal(x.overlap(initial, [measured.labelRange, measured.outputRange, measured.ring]).length, 0,
    'the measured glyph Ranges and range focus envelope do not themselves explain this copy-box obstruction');
  const box = x.run();
  assert.equal(x.overlap(box, [measured.label, measured.output, measured.ring]).length, 0,
    'protect the actual complete native LABEL/OUTPUT group as well as current range focus');
  assert.equal(box.bottom, measured.label.top - 8); assert.equal(box.left, measured.right - 44);
  assert.equal(label.control, field); assert.equal(label.htmlFor, field.id); assert.deepEqual(field.labels, [label]);
  assert.equal(field.form, form); assert.equal(output.form, form); assert.equal(field.previousElementSibling, output);
  assert.equal(field.ariaLabel, measured.name); assert.equal(form.key, 'e6-network-fourth-decision');
  assert.deepEqual(x.copyBoxReads, [label, output]); assert.deepEqual(x.rangeReads, []);
  assert.deepEqual(x.copyQueries, e11LayersCopySelectors);
  assert.deepEqual(x.allOwnerQueries, [e6CopyFamilies[0], e6CopyFamilies[1], e11LayersOwner, e6CopyFamilies[2], e6CopyFamilies[3], ...x.terminalOwnerQueries, ...x.imageOwnerQueries]);
  assert.deepEqual(x.layersOwnerQueries, [e11LayersOwner]); assert.deepEqual(x.familyQueries, e6CopyFamilies);
  assert.deepEqual(state.formQueries, [e11LayersFormSelector, e11LayersFormSelector]);
  assert.deepEqual(state.associationQueries, [':scope > input[name="weight"][type="range"]', ':scope > output', ':scope > input[name="weight"][type="range"]', ':scope > output']);
  e11LayersWeightUnchanged(state, box);
});
test('E11 Layers rejects copy outside its current native association', { concurrency: false }, () => {
  for (const defect of ['foreign-for', 'missing-id', 'additional-label', 'foreign-range-form', 'foreign-output-form',
    'multiple-current-forms', 'empty-form-key', 'intervening-sibling', 'foreign-owner', 'hidden-ancestor']) {
    const cleanup = [];
    try {
      // Each row gets its own actual component and native-interface ports;
      // restore globals completely before constructing the next row.
      const state = e11LayersWeightPlacement({ after: undo => cleanup.push(undo) }, 'en', defect), { x, measured } = state;
      const box = x.run();
      assert.equal(box.top, measured.top, defect);
      assert.equal(x.overlap(box, [measured.label, measured.output]).length, 2,
        defect + ': invalid ownership cannot supply a replacement copy obstacle');
      assert.deepEqual(x.copyBoxReads, [], defect); assert.deepEqual(x.rangeReads, [], defect);
      e11LayersWeightUnchanged(state, box);
    } finally { for (const undo of cleanup.reverse()) undo(); }
  }
});
test('E11 Layers copy does not acquire native authority to move a hovered Ask', { concurrency: false }, t => {
  const state = e11LayersWeightPlacement(t), { x, measured } = state;
  x.hovered = true;
  const box = x.run();
  assert.equal(x.overlap(box, [measured.label, measured.output]).length, 2);
  assert.equal(x.overlap(box, [measured.ring]).length, 0, 'the current native range is already clear');
  assert.deepEqual(x.writes, []); assert.deepEqual(x.allOwnerQueries, []); assert.deepEqual(x.layersOwnerQueries, []);
  assert.deepEqual(x.copyBoxReads, []); assert.deepEqual(x.rangeReads, []);
  e11LayersWeightUnchanged(state, box);
});


// E11 R4 compact-tail counterexamples. Native controls, current handle ring,
// weight LABEL and final compact Ask boxes below are retained R4 observations.
// Ordinary width160 is a declared CSSOM premise; no ordinary-width rectangle
// or per-iteration browser write instrumentation was retained. The inherited
// OUTPUT rectangle is an explicitly contained R3 premise inside the equal R4
// weight LABEL, so it cannot change the admitted obstacle union. These are
// finite source fixtures, not a reconstruction of actual browser iterations.
const e11CompactSnapshots = {
  ar: {...{"width":320,"height":800,"resetTop":680,"capturedTop":323.125,"capturedOffset":356.875,"clip":[17,-27.875,286,300],"protectIndex":12,"handleIndex":13,"weightIndex":16,"listCount":12,"handleEnvelope":[34,375.125,252,50],"handleLabel":[37,357.125,246,65],"weightLabel":[37,630.6875,246,94]}, rows: [
    {"tag":"BUTTON","className":null,"name":"نقل palette/dusk-warm إلى الأعلى","id":null,"box":[195,-16.875,44,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"نقل palette/dusk-warm إلى الأسفل","id":null,"box":[151,-16.875,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-visibility","name":"كتم reference/window-light","id":null,"box":[245,46.125,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-name","name":null,"id":null,"box":[80,46.125,160,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"نقل reference/window-light إلى الأعلى","id":null,"box":[195,96.125,44,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"نقل reference/window-light إلى الأسفل","id":null,"box":[151,96.125,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-remove","name":"إزالة reference/window-light","id":null,"box":[31,46.125,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-visibility","name":"كتم direction/nocturne","id":null,"box":[245,159.125,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-name","name":null,"id":null,"box":[80,159.125,160,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"نقل direction/nocturne إلى الأعلى","id":null,"box":[195,209.125,44,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"نقل direction/nocturne إلى الأسفل","id":null,"box":[151,209.125,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-remove","name":"إزالة direction/nocturne","id":null,"box":[31,159.125,44,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":null,"id":null,"box":[37,304.125,70.03125,44],"disabled":false},
    {"tag":"INPUT","className":null,"name":null,"id":null,"box":[37,378.125,246,44],"disabled":false},
    {"tag":"TEXTAREA","className":null,"name":null,"id":null,"box":[37,452.125,246,95.5625],"disabled":false},
    {"tag":"SELECT","className":null,"name":null,"id":null,"box":[37,577.6875,246,44],"disabled":false},
    {"tag":"INPUT","className":null,"name":"التأثير في النتيجة","id":"forma-layer-inspector-weight-1b76b431-e53f-4a26-bc95-d36efcb525da","box":[35,674.6875,246,48],"disabled":false},
    {"tag":"BUTTON","className":"button ghost compact","name":null,"id":null,"box":[199.375,734.6875,83.625,44],"disabled":false},
    {"tag":"BUTTON","className":"button ghost compact layer-inspector-discard","name":"تجاهل التغييرات غير المحفوظة — ⁨direction/synthetic-custody⁩","id":null,"box":[103.3125,784.6875,179.6875,44],"disabled":false}
  ]},
  en: {...{"width":390,"height":844,"resetTop":724,"capturedTop":345.359375,"capturedOffset":378.640625,"clip":[17,25.359375,356,270],"protectIndex":20,"handleIndex":21,"weightIndex":24,"listCount":20,"handleEnvelope":[34,397.359375,322,50],"handleLabel":[37,380.359375,316,64],"weightLabel":[37,646.109375,316,92]}, rows: [
    {"tag":"BUTTON","className":"layer-visibility","name":"Mute direction/synthetic-custody","id":null,"box":[31,40.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-name","name":null,"id":null,"box":[80,40.359375,135,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"Move direction/synthetic-custody up","id":null,"box":[221,40.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"Move direction/synthetic-custody down","id":null,"box":[265,40.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-remove","name":"Remove direction/synthetic-custody","id":null,"box":[315,40.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-visibility","name":"Mute palette/dusk-warm","id":null,"box":[31,104.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-name","name":null,"id":null,"box":[80,104.359375,135,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"Move palette/dusk-warm up","id":null,"box":[221,104.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"Move palette/dusk-warm down","id":null,"box":[265,104.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-remove","name":"Remove palette/dusk-warm","id":null,"box":[315,104.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-visibility","name":"Mute reference/window-light","id":null,"box":[31,168.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-name","name":null,"id":null,"box":[80,168.359375,135,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"Move reference/window-light up","id":null,"box":[221,168.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"Move reference/window-light down","id":null,"box":[265,168.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-remove","name":"Remove reference/window-light","id":null,"box":[315,168.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-visibility","name":"Mute direction/nocturne","id":null,"box":[31,232.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-name","name":null,"id":null,"box":[80,232.359375,135,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"Move direction/nocturne up","id":null,"box":[221,232.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":"Move direction/nocturne down","id":null,"box":[265,232.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":"layer-remove","name":"Remove direction/nocturne","id":null,"box":[315,232.359375,44,44],"disabled":false},
    {"tag":"BUTTON","className":null,"name":null,"id":null,"box":[272.328125,327.359375,80.671875,44],"disabled":false},
    {"tag":"INPUT","className":null,"name":null,"id":null,"box":[37,400.359375,316,44],"disabled":false},
    {"tag":"TEXTAREA","className":null,"name":null,"id":null,"box":[37,473.359375,316,90.75],"disabled":false},
    {"tag":"SELECT","className":null,"name":null,"id":null,"box":[37,593.109375,316,44],"disabled":false},
    {"tag":"INPUT","className":null,"name":"Influence on the result","id":"forma-layer-inspector-weight-a8ec99f8-a159-4e7b-8834-7aa29cb97557","box":[39,688.109375,316,48],"disabled":false},
    {"tag":"BUTTON","className":"button ghost compact","name":null,"id":null,"box":[37,748.109375,94.265625,44],"disabled":false},
    {"tag":"BUTTON","className":"button ghost compact layer-inspector-discard","name":"Discard unsaved changes — ⁨direction/synthetic-custody⁩","id":null,"box":[183.90625,748.109375,169.09375,44],"disabled":false},
    {"tag":"BUTTON","className":"button primary compact","name":null,"id":null,"box":[37,798.109375,103.109375,44],"disabled":false}
  ]}
};

function e11CompactSnapshotPlacement(t, locale = 'en') {
  const state = e11LayersWeightPlacement(t, locale), { x, field, label, output } = state;
  const measured = e11CompactSnapshots[locale];
  const rect = values => d411Rect(...values);
  const list = x.ancestor(rect(measured.clip), { overflowX: 'auto', overflowY: 'auto' });
  x.controls.length = 0;
  for (const [index, row] of measured.rows.entries()) {
    const control = index === measured.weightIndex ? field : x.control(rect(row.box), {
      tagName: row.tag, className: row.className, ariaLabel: row.name, disabled: row.disabled,
      parentElement: index < measured.listCount ? list : state.form,
    });
    if (index === measured.weightIndex) {
      field.id = row.id; label.htmlFor = row.id;
      assert.deepEqual(field.getBoundingClientRect(), rect(row.box));
    }
    x.controls.push(control);
  }
  const handle = x.controls[measured.handleIndex], protect = x.controls[measured.protectIndex];
  handle.name = 'handle'; handle.value = 'direction/synthetic-custody';
  handle.outlineStyle = 'solid'; handle.outlineWidth = '3px'; handle.outlineOffset = '0px';
  x.f.document.activeElement = handle;
  // The RTL lane is anchored at the recorded left edge, including in ordinary
  // mode. Its declared160px width reaches the recorded second-row arrows;
  // pretending ordinary mode also stayed44px would skip compact exhaustion.
  x.launcher.getBoundingClientRect = () => {
    const offset = Number.parseFloat(x.values.get('--forma-assistant-obstacle-offset') || '0');
    const compact = x.f.panel.dataset.compactLauncher === 'true', width = compact ? 44 : 160;
    const left = locale === 'ar' ? 10 : measured.width - 10 - width;
    let box = d411Rect(left, measured.resetTop - offset, width, 44);
    if (x.f.panel.dataset.tightLauncher === 'true' && state.nativeCompletionRead) {
      box = state.nativeCompletionRead(box);
    }
    x.boxes.push({ ...box, offset, compact });
    return box;
  };
  const captured = d411Rect(locale === 'ar' ? 10 : measured.width - 54, measured.capturedTop, 44, 44);
  const bounds = measured.rows.map((row, index) => {
    const box = rect(row.box);
    if (index === measured.handleIndex) return rect(measured.handleEnvelope);
    if (index >= measured.listCount) return box;
    const clip = rect(measured.clip), left = Math.max(box.left, clip.left), top = Math.max(box.top, clip.top);
    return d411Rect(left, top, Math.min(box.right, clip.right) - left, Math.min(box.bottom, clip.bottom) - top);
  });
  assert.deepEqual(state.measured.label, rect(measured.weightLabel));
  assert.ok(state.measured.output.left >= state.measured.label.left && state.measured.output.right <= state.measured.label.right
    && state.measured.output.top >= state.measured.label.top && state.measured.output.bottom <= state.measured.label.bottom,
  'the separately declared OUTPUT premise is contained by the observed R4 LABEL');
  const before = {
    controls: x.controls.map(control => ({ control, value: control.value, disabled: control.disabled, parent: control.parentElement })),
    draft: x.f.panel.draftForTest, tasks: x.f.panel.tasks, messages: x.f.panel.messages,
    id: field.id, labelFor: label.htmlFor, labels: field.labels, form: field.form, outputForm: output.form,
    control: label.control, previousSibling: field.previousElementSibling, output: output.value, labelText: label.textContent,
  };
  return Object.assign(state, { snapshot: measured, handle, protect, captured, bounds, before });
}

function e11CompactUnchanged(state, box, { queried = true, active = state.handle } = {}) {
  const { x, field, label, output, before, snapshot } = state;
  assert.equal(x.f.document.activeElement, active);
  for (const row of before.controls) {
    assert.equal(row.control.value, row.value); assert.equal(row.control.disabled, row.disabled);
    assert.equal(row.control.parentElement, row.parent);
  }
  assert.equal(field.id, before.id); assert.equal(label.htmlFor, before.labelFor); assert.equal(field.labels, before.labels);
  assert.equal(field.form, before.form); assert.equal(output.form, before.outputForm); assert.equal(label.control, before.control);
  assert.equal(field.previousElementSibling, before.previousSibling); assert.equal(output.value, before.output);
  assert.equal(label.textContent, before.labelText);
  assert.equal(x.f.panel.draftForTest, before.draft); assert.equal(x.f.panel.tasks, before.tasks);
  assert.equal(x.f.panel.messages, before.messages); assert.deepEqual(x.f.emitted, []);
  assert.deepEqual(x.queries, [d420TaskRegionQuery]);
  assert.deepEqual(x.copyQueries, queried ? e11LayersCopySelectors : []);
  assert.deepEqual(x.copyBoxReads, queried ? [label, output] : []);
  assert.deepEqual(x.allOwnerQueries, queried
    ? [e6CopyFamilies[0], e6CopyFamilies[1], e11LayersOwner, e6CopyFamilies[2], e6CopyFamilies[3], ...x.terminalOwnerQueries, ...x.imageOwnerQueries] : []);
  assert.deepEqual(x.rangeReads, []); assert.deepEqual(x.detached, []);
  assert.ok(['left', 'top', 'right', 'bottom', 'width', 'height'].every(key => Number.isFinite(box[key])));
  assert.equal(box.width, 44); assert.equal(box.height, 44);
  assert.equal(box.left, state.captured.left); assert.equal(box.right, state.captured.right);
  assert.ok(box.top >= 8 && box.bottom <= snapshot.height - 8);
  // Eight ordinary reads, compact check + four passes, one completion read,
  // one candidate readback and the fixture's returned rectangle remain finite.
  assert.ok(x.boxes.length <= 16, 'completion adds bounded readback, not another search/RAF loop');
}

for (const locale of ['en', 'ar']) test('E11 ' + locale + ' recorded compact exhaustion clears every current peer and weight copy', { concurrency: false }, t => {
  const state = e11CompactSnapshotPlacement(t, locale), { x, protect, captured, snapshot } = state;
  assert.equal(protect.tagName, 'BUTTON'); assert.equal(protect.disabled, false);
  assert.equal(x.overlap(captured, [protect.getBoundingClientRect()]).length, 1,
    'the retained compact body obstructs the eligible current Protect button');
  assert.equal(x.overlap(captured, [d411Rect(...snapshot.handleEnvelope)]).length, 0,
    'current native handle focus was already clear');
  assert.equal(snapshot.resetTop - snapshot.capturedOffset, captured.top);
  const box = x.run();
  // Keep this outcome before any new completion-marker assertion: ae456 must
  // fail for its real remaining Protect overlap, not a changed fixture port.
  assert.equal(x.overlap(box, [...state.bounds, state.measured.label, state.measured.output,
    d411Rect(...snapshot.handleLabel)]).length, 0,
  'after four compact writes the actual body must clear all sampled peers and designated copy');
  assert.equal(x.f.panel.dataset.compactLauncher, 'true'); assert.equal(x.f.panel.dataset.tightLauncher, 'true');
  assert.equal(box.top, locale === 'en' ? 279.859375 : 231.625,
    'use the nearest centered gap in this fixed finite snapshot');
  e11CompactUnchanged(state, box);
});

test('E11 compact completion preserves no-gap, uncertain-focus and ordinary-hover refusal', { concurrency: false }, () => {
  for (const mode of ['no-gap', 'uncertain-focus', 'hovered-unrelated-control']) {
    const cleanup = [];
    try {
      const state = e11CompactSnapshotPlacement({ after: undo => cleanup.push(undo) }), { x, snapshot } = state;
      if (mode === 'no-gap') {
        // Explicit synthetic stress: close only the available outside gaps.
        // These are extra declared native task regions, never R4 observations.
        x.regions.push(x.control(d411Rect(state.captured.left, -20, 44, state.protect.getBoundingClientRect().top + 20),
          { tagName: 'DETAILS', className: 'output-recipe-entry' }));
        x.regions.push(x.control(d411Rect(state.captured.left, state.measured.label.bottom, 44, snapshot.height + 20 - state.measured.label.bottom),
          { tagName: 'DIV', className: 'output-requirement-warning' }));
      }
      if (mode === 'uncertain-focus') state.handle.outlineStyle = 'auto';
      if (mode === 'hovered-unrelated-control') {
        x.f.panel.dataset.compactLauncher = 'true';
        x.values.set('--forma-assistant-obstacle-offset', `${snapshot.capturedOffset}px`);
        x.hovered = true;
      }
      const box = x.run();
      assert.deepEqual(box, state.captured, mode + ': retain the explicitly unresolved compact body');
      assert.equal(x.f.panel.dataset.tightLauncher, undefined);
      assert.equal(x.overlap(box, [state.protect.getBoundingClientRect()]).length, 1);
      if (mode === 'hovered-unrelated-control') assert.deepEqual(x.writes, [], 'an unrelated obstructed peer is not current-focus authority');
      e11CompactUnchanged(state, box, { queried: mode !== 'hovered-unrelated-control' });
    } finally { for (const undo of cleanup.reverse()) undo(); }
  }
});

test('E11 compact completion accepts bounded native rounding and restores rejected readbacks', { concurrency: false }, () => {
  for (const mode of ['rounded-inside-gap', 'outside-chosen-gap', 'inline-shift', 'size-change', 'nonfinite-top']) {
    const cleanup = [];
    try {
      const state = e11CompactSnapshotPlacement({ after: undo => cleanup.push(undo) }), { x, snapshot } = state;
      state.nativeCompletionRead = box => {
        if (mode === 'rounded-inside-gap') return d411Rect(box.left, box.top + .125, box.width, box.height);
        if (mode === 'outside-chosen-gap') return d411Rect(box.left, 9, box.width, box.height);
        if (mode === 'inline-shift') return d411Rect(box.left - 1, box.top, box.width, box.height);
        if (mode === 'size-change') return d411Rect(box.left, box.top, box.width, box.height + 1);
        return { ...box, top: NaN, bottom: NaN };
      };
      const box = x.run();
      if (mode === 'rounded-inside-gap') {
        assert.equal(box.top, 279.984375, 'native rounding within the chosen clear gap is retained');
        assert.equal(x.f.panel.dataset.tightLauncher, 'true');
        assert.equal(x.overlap(box, [...state.bounds, state.measured.label, state.measured.output]).length, 0);
      } else {
        assert.deepEqual(box, state.captured, mode + ': rejected layout restores the pre-completion body');
        assert.equal(x.values.get('--forma-assistant-obstacle-offset'), `${snapshot.capturedOffset}px`);
        assert.equal(x.f.panel.dataset.tightLauncher, undefined);
        assert.equal(x.overlap(box, [state.protect.getBoundingClientRect()]).length, 1,
          'restoration does not misreport the previously obstructed body as clear');
      }
      e11CompactUnchanged(state, box);
    } finally { for (const undo of cleanup.reverse()) undo(); }
  }
});

test('E11 compact completion chooses nearest free gaps with upward ties', { concurrency: false }, () => {
  for (const height of [836, 800]) {
    const cleanup = [];
    try {
      // Explicit synthetic boundary case: eight native44px peers leave only
      // two fitting gaps after compact exhaustion. No coordinates are R4 data.
      const x = d411Placement({ after: undo => cleanup.push(undo) }, [], { width: 300, height });
      for (const top of [140, 220, 300, 380, 460, 540, 620, 700]) {
        x.controls.push(x.control(d411Rect(246, top, 44, 44), { tagName: 'BUTTON', disabled: false }));
      }
      x.f.document.activeElement = x.controls[0];
      x.launcher.getBoundingClientRect = () => {
        const offset = Number.parseFloat(x.values.get('--forma-assistant-obstacle-offset') || '0');
        const compact = x.f.panel.dataset.compactLauncher === 'true', width = compact ? 44 : 160;
        const box = d411Rect(290 - width, 708 - offset, width, 44);
        x.boxes.push({ ...box, offset, compact }); return box;
      };
      const box = x.run();
      assert.equal(x.overlap(box).length, 0, 'complete the unresolved fourth-write collision');
      assert.equal(box.top, height === 836 ? 52 : 746,
        height === 836 ? 'equal-distance centers choose upward' : 'a closer downward gap outranks upward ordering');
      assert.equal(x.f.panel.dataset.tightLauncher, 'true'); assert.equal(x.f.panel.dataset.compactLauncher, 'true');
      assert.equal(x.f.document.activeElement, x.controls[0]); assert.deepEqual(x.f.emitted, []);
      assert.deepEqual(x.queries, [d420TaskRegionQuery]); assert.ok(x.boxes.length <= 16);
      assert.ok(box.top >= 8 && box.bottom <= height - 8); assert.equal(box.width, 44); assert.equal(box.height, 44);
    } finally { for (const undo of cleanup.reverse()) undo(); }
  }
});

function imageHistoryCopyPlacement(t) {
  // Exact layout boxes from Image R2 image-history-empty-focus at 1280x900.
  // This is a finite geometry regression, not full-page/native reconstruction.
  // In particular, the screenshot's heading words were NOT obscured: the
  // failed native contract protects the whole H2 layout box, not only glyphs.
  const x = e6CopyPlacement(t, { family: imageHistoryCopyOwner,
    viewport: { width: 1280, height: 900 }, right: 1264, top: 658.90625 });
  const headingBox = d411Rect(291.1875, 617.515625, 937.625, 49);
  const eyebrowBox = d411Rect(291.1875, 595.734375, 937.625, 16.1875);
  const oldPosition = d411Rect(1126.8125, 658.90625, 137.1875, 44);
  const collapse = x.control(d411Rect(291.1875, 783.484375, 131.90625, 44), {
    tagName: "BUTTON", outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "3px",
  });
  const ring = d411Rect(285.1875, 777.484375, 143.90625, 56);
  x.controls.push(collapse); x.f.document.activeElement = collapse;
  // Empty Range inputs make the distinction explicit: these exact admitted
  // copy nodes must supply their layout boxes, not invented glyph rectangles.
  const eyebrow = x.copy(imageHistoryCopySelector, eyebrowBox, [],
    { tagName: "P", className: "eyebrow", textContent: "Image history" });
  const heading = x.copy(imageHistoryCopySelector, headingBox, [],
    { tagName: "H2", textContent: "Generations for your Document" });
  x.f.panel.draftForTest = "  Preserve independent unsent direction.  ";
  const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages, owner: x.f.panel.parentElement };
  const unchanged = () => {
    assert.equal(x.f.document.activeElement, collapse);
    assert.equal(x.f.panel.draftForTest, "  Preserve independent unsent direction.  ");
    assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
    assert.equal(x.f.panel.parentElement, before.owner); assert.deepEqual(x.f.emitted, []);
    assert.deepEqual(x.queries, [d420TaskRegionQuery]); assert.ok(x.boxes.length <= 16);
  };
  return { x, heading, eyebrow, headingBox, eyebrowBox, oldPosition, ring, unchanged };
}

test("Image full-history copy boxes and focused Collapse share finite launcher placement", { concurrency: false }, t => {
  const { x, heading, eyebrow, headingBox, eyebrowBox, oldPosition, ring, unchanged } = imageHistoryCopyPlacement(t);
  assert.equal(x.overlap(oldPosition, [headingBox]).length, 1, "retain the measured H2 layout-box failure");
  assert.equal(x.overlap(oldPosition, [ring, eyebrowBox]).length, 0);
  const box = x.run();
  // First after actual placement: six-family source fails on obstruction,
  // not fixture query admission or a new-owner assertion.
  assert.equal(x.overlap(box, [headingBox, eyebrowBox, ring]).length, 0,
    "clear full-history heading/eyebrow boxes without obstructing Collapse focus");
  unchanged(); assert.ok(box.top >= 8 && box.bottom <= 892);
  assert.deepEqual(x.copyBoxReads, [eyebrow, heading]);
  assert.deepEqual(x.rangeReads, []); assert.deepEqual(x.detached, []);
  assert.deepEqual(x.copyQueries, [imageHistoryCopySelector]);
  assert.deepEqual(x.imageOwnerQueries, [imageHistoryCopyOwner]);
});

for (const mode of ["hidden", "foreign", "duplicate", "compact-unmatched"]) {
  test(`Image ${mode} copy cannot supply full-history placement obstacles`, { concurrency: false }, t => {
    const { x, heading, eyebrow, headingBox, oldPosition, unchanged } = imageHistoryCopyPlacement(t);
    if (mode === "hidden") { heading.hiddenAncestor = true; eyebrow.hiddenAncestor = true; }
    else if (mode === "foreign") {
      const foreignOwner = {};
      for (const element of [heading, eyebrow]) {
        const closest = element.closest.bind(element);
        element.closest = selector => selector === imageHistoryCopyOwner ? foreignOwner : closest(selector);
      }
    } else if (mode === "duplicate") {
      const query = x.main.querySelectorAll;
      x.main.querySelectorAll = selector => {
        const selected = query(selector);
        return selector === imageHistoryCopyOwner ? [x.surface, { ...x.surface }] : selected;
      };
    } else {
      // The actual selector is deliberately direct full-history structure;
      // compact/canvas/rail headers supply no matching nodes through this port.
      const query = x.surface.querySelectorAll;
      x.surface.querySelectorAll = selector => { query(selector); return []; };
    }
    const box = x.run();
    assert.deepEqual(box, oldPosition);
    assert.equal(x.overlap(box, [headingBox]).length, 1, "excluded copy is not misreported as protected");
    assert.deepEqual(x.copyBoxReads, []); assert.deepEqual(x.rangeReads, []); assert.deepEqual(x.detached, []);
    unchanged();
  });
}

function fTerminalCopyPlacement(t) {
  // R3 recorded this FR200 viewport, ordinary launcher width/base position,
  // both Retry bodies and the main Retry ring. Main-copy Range rectangles were
  // NOT recorded. The four fragments below are declared finite counterexample
  // inputs within the pictured text region, not measured glyphs/native replay.
  const x = e6CopyPlacement(t, { family: fTerminalCopyOwner, locale: "fr",
    viewport: { width: 419, height: 398 }, right: 409, top: 346.5, normalWidth: 199.171875 });
  const mainRetry = x.control(d411Rect(104, 297.7578125, 283, 44), { tagName: "BUTTON",
    outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "3px" });
  const bannerRetry = x.control(d411Rect(210.5234375, 128.5859375, 69.9453125, 21.1953125), { tagName: "BUTTON" });
  const ring = d411Rect(98, 291.7578125, 295, 56);
  x.controls.push(mainRetry, bannerRetry); x.f.document.activeElement = mainRetry;
  const copyOwner = x.ancestor(d411Rect(104, 190, 283, 160), { parentElement: x.surface });
  const fragments = [
    d411Rect(104, 202, 276, 19),
    d411Rect(104, 232, 272, 20), d411Rect(104, 256, 250, 20), d411Rect(104, 280, 192, 12),
  ];
  const heading = x.copy(fTerminalCopySelector, d411Rect(104, 190, 283, 40), [fragments[0]],
    { tagName: "B", parentElement: copyOwner, textContent: "Ce document est indisponible." });
  const body = x.copy(fTerminalCopySelector, d411Rect(104, 226, 283, 72), fragments.slice(1),
    { parentElement: copyOwner, textContent: "L’adresse demandée a été conservée. Réessayez pour vérifier ; aucun nouveau document n’a été créé." });
  x.f.panel.draftForTest = "  Preserve separate unsent guidance.  ";
  const before = { tasks: x.f.panel.tasks, messages: x.f.panel.messages, owner: x.f.panel.parentElement };
  const unchanged = () => {
    assert.equal(x.f.document.activeElement, mainRetry);
    assert.equal(x.f.panel.draftForTest, "  Preserve separate unsent guidance.  ");
    assert.equal(x.f.panel.tasks, before.tasks); assert.equal(x.f.panel.messages, before.messages);
    assert.equal(x.f.panel.parentElement, before.owner); assert.deepEqual(x.f.emitted, []);
  };
  return { x, mainRetry, bannerRetry, ring, fragments, heading, body, unchanged };
}

test("F terminal Shell copy and native Retry share the existing finite launcher placement", { concurrency: false }, t => {
  const { x, mainRetry, bannerRetry, ring, fragments, heading, body, unchanged } = fTerminalCopyPlacement(t);
  const oldPosition = d411Rect(209.828125, 239.7578125, 199.171875, 44);
  assert.equal(x.overlap(oldPosition, [ring, bannerRetry.getBoundingClientRect()]).length, 0,
    "the retained R3 counterexample clears both native actions");
  assert.ok(x.overlap(oldPosition, fragments).length > 0,
    "the same old position still covers the declared terminal explanation");
  const box = x.run();
  // Deliberately first after actual placement: old five-family source must fail
  // text overlap, not fixture query admission or a missing new-owner receipt.
  assert.equal(x.overlap(box, [...fragments, ring, bannerRetry.getBoundingClientRect()]).length, 0,
    "clear terminal heading/explanation and the focused native Retry together");
  unchanged(); assert.equal(x.f.document.activeElement, mainRetry);
  assert.ok(box.top >= 8 && box.bottom <= 390); assert.ok(x.boxes.length <= 16);
  assert.deepEqual(x.rangeReads, [heading.textNodes[0], body.textNodes[0]]);
  assert.deepEqual(x.detached, x.rangeReads);
  assert.deepEqual(x.copyQueries, [fTerminalCopySelector]);
  assert.deepEqual(x.terminalOwnerQueries, [fTerminalCopyOwner]);
  assert.deepEqual(x.queries, [d420TaskRegionQuery]);
});

test("F hidden or duplicate terminal copy cannot supply current placement obstacles", { concurrency: false }, () => {
  for (const mode of ["hidden", "duplicate"]) {
    const cleanup = [];
    try {
      const { x, fragments, heading, body, unchanged } = fTerminalCopyPlacement({ after: undo => cleanup.push(undo) });
      if (mode === "hidden") { heading.hiddenAncestor = true; body.hiddenAncestor = true; }
      else {
        const query = x.main.querySelectorAll;
        x.main.querySelectorAll = selector => {
          const selected = query(selector);
          return selector === fTerminalCopyOwner ? [x.surface, { ...x.surface }] : selected;
        };
      }
      const box = x.run();
      assert.deepEqual(box, d411Rect(209.828125, 239.7578125, 199.171875, 44));
      assert.ok(x.overlap(box, fragments).length > 0, "excluded copy is not misreported as protected");
      assert.deepEqual(x.rangeReads, []); assert.deepEqual(x.detached, []);
      assert.deepEqual(x.queries, [d420TaskRegionQuery]); unchanged();
      assert.ok(x.boxes.length <= 16);
    } finally { for (const undo of cleanup.reverse()) undo(); }
  }
});

test("F measured R4 Shell alert and terminal copy remain clear together at native Retry focus", { concurrency: false }, t => {
  const { x, bannerRetry, ring, heading, body, unchanged } = fTerminalCopyPlacement(t);
  // R4 report SHA256 98ba8b6ba956e809e3a4cbcf7de6cf6811870cd9560c1dc1084d0f20d47be5fa:
  // f-main-copy-main-focus supplies these actual Range bounds. Retain the
  // helper's declared ancestor ports; replace only this case's text fragments.
  // The earlier declared-input terminal-copy tests remain unchanged.
  const fragments = [
    d411Rect(104, 198.46875, 235.96875, 22),
    d411Rect(104, 228.0625, 241.4921875, 19),
    d411Rect(104, 250.4609375, 259.7890625, 19),
    d411Rect(104, 272.859375, 147.40625, 19),
  ];
  heading.textNodes[0].fragments = [fragments[0]];
  body.textNodes[0].fragments = fragments.slice(1);
  // f-banner-main-focus supplies the cohesive alert and its two body lines;
  // f-main-retry-arrival supplies the failed normal launcher and Retry ring.
  const alertBox = d411Rect(72, 48, 347, 111.78125);
  const alertBody = [
    d411Rect(81, 84.1953125, 322.203125, 16.5),
    d411Rect(81, 103.390625, 231.3125, 16.5),
  ];
  x.alertRegions.push(x.control(alertBox, { tagName: "DIV", className: "error-banner" }));
  const failedPosition = d411Rect(209.828125, 76.5859375, 199.171875, 44);
  assert.equal(x.overlap(failedPosition, [...fragments, ring, bannerRetry.getBoundingClientRect()]).length, 0,
    "R4 clears terminal copy and both actions but not the upstream alert");
  assert.equal(x.overlap(failedPosition, alertBody).length, 2,
    "the retained failed launcher intersects both observed alert body lines");
  const box = x.run();
  // First after placement: current source admits its old query and receives
  // no new alert port, so its negative baseline fails on actual obstruction.
  assert.equal(x.overlap(box, [alertBox, ...fragments, ring, bannerRetry.getBoundingClientRect()]).length, 0,
    "protect the complete alert without trading away terminal text or native Retry focus");
  assert.equal(x.f.panel.dataset.compactLauncher, "true");
  assert.equal(box.width, 44); assert.equal(box.height, 44);
  assert.ok(box.top >= 8 && box.bottom <= 390); assert.ok(x.boxes.length <= 16);
  unchanged();
  assert.deepEqual(x.rangeReads, [heading.textNodes[0], body.textNodes[0]]);
  assert.deepEqual(x.detached, x.rangeReads);
  assert.deepEqual(x.queries, [d420TaskRegionQuery]);
});


// Library weight copy regression controls, retained from the accepted F donor.
// Declared in-memory boxes/associations exercise actual Panel placement;
// native Japanese geometry and browser focus remain separately verified.
function fCopyOmissionPlacement(t, kind, { top = 650, value = '0.65' } = {}) {
  assert.equal(kind, 'weight', 'this focused fixture admits Library weight only');
  const family = 'forma-library';
  const selector = fLibraryWeightCopySelector;
  const x = e6CopyPlacement(t, { family, viewport: { width: 320, height: 800 }, right: 310, top, normalWidth: 44 });
  const calls = [], formQueries = [], associationQueries = [];
  const form = x.ancestor(d411Rect(16, 0, 288, 800), { tagName: 'FORM', isConnected: true, parentElement: x.surface });
  const raw = d411Rect(33, 650, 254, 40);
  const fragment = d411Rect(40, 655, 80, 18);
  let parent, copy, field, focused, ring, label, output, forms, labels, outputs, fields;
  const native = {};
  const action = name => ({ focus: () => calls.push('focus-' + name), click: () => calls.push('click-' + name) });
  {
    // The paired Library source gives the range a stable id and an explicit
    // visible label. OUTPUT references that same range without owning the label.
    for (const key of ['HTMLFormElement', 'HTMLLabelElement', 'HTMLInputElement', 'HTMLOutputElement']) {
      const previous = Object.getOwnPropertyDescriptor(globalThis, key), Type = class {};
      native[key] = Type;
      Object.defineProperty(globalThis, key, { configurable: true, value: Type });
      t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
    }
    Object.setPrototypeOf(form, native.HTMLFormElement.prototype);
    const fieldset = x.ancestor(d411Rect(33, 620, 254, 140), { tagName: 'FIELDSET', parentElement: form });
    label = Object.assign(new native.HTMLLabelElement(), x.ancestor(d411Rect(33, 640, 254, 114), {
      tagName: 'LABEL', className: 'library-weight', isConnected: true, parentElement: fieldset,
      htmlFor: 'f-library-weight', textContent: 'Default influence',
    }));
    parent = label;
    copy = x.copy(selector, raw, [fragment], { tagName: 'OUTPUT', parentElement: label, form, textContent: Math.round(Number(value) * 100) + '%' });
    Object.setPrototypeOf(copy, native.HTMLOutputElement.prototype);
    output = copy;
    // A normal OUTPUT value setter also replaces its text. Keep them coupled
    // except in the explicitly named interface-defense counterexample below.
    Object.defineProperty(output, 'value', { configurable: true, get() { return this.textContent; }, set(next) {
      this.textContent = String(next); this.textNodes[0].textContent = this.textContent;
    } });
    field = Object.assign(new native.HTMLInputElement(), x.control(d411Rect(33, 700, 254, 44), {
      tagName: 'INPUT', type: 'range', id: 'f-library-weight', ariaLabel: 'Default influence',
      isConnected: true, min: '0', max: '1', step: '.05', value,
      form, parentElement: label, previousElementSibling: output, labels: [label], disabled: false,
      outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '3px', ...action('range'),
    }));
    label.control = field; output.labels = []; output.htmlFor = [field.id];
    forms = [form]; labels = [label]; outputs = [output]; fields = [field];
    const query = x.surface.querySelectorAll;
    x.surface.querySelectorAll = querySelector => {
      if (querySelector === fLibraryWeightFormSelector) { formQueries.push(querySelector); return forms; }
      return query(querySelector);
    };
    form.querySelectorAll = querySelector => { assert.equal(querySelector, fLibraryWeightLabelSelector); associationQueries.push(querySelector); return labels; };
    label.querySelectorAll = querySelector => {
      associationQueries.push(querySelector);
      if (querySelector === ':scope > output') return outputs;
      assert.equal(querySelector, ':scope > input[type="range"]'); return fields;
    };
    focused = field; ring = d411Rect(27, 694, 266, 56); x.controls.push(field);
  }
  x.f.document.activeElement = focused; x.surface.scrollTop = 17;
  x.f.panel.draftForTest = '  Preserve the independent unsent Assistant question.  ';
  const state = { x, kind, family, selector, raw, fragment, parent, form, copy, field, focused, ring,
    label, output, forms, labels, outputs, fields, native, calls, formQueries, associationQueries };
  state.snapshot = () => ({ focus: x.f.document.activeElement, fieldValue: field.value, text: copy.textContent,
    draft: x.f.panel.draftForTest, tasks: x.f.panel.tasks, messages: x.f.panel.messages, scope: x.f.panel.conversationScope,
    owner: x.f.panel.parentElement, scroll: x.surface.scrollTop, copyParent: copy.parentElement, fieldParent: field.parentElement,
    fieldForm: field.form, outputForm: output?.form, outputValue: output?.value, outputLabels: output?.labels,
    fieldLabels: field.labels, fieldId: field.id, fieldName: field.ariaLabel, labelText: label?.textContent,
    labelFor: label?.htmlFor, outputFor: output?.htmlFor,
    control: label?.control, sibling: field.previousElementSibling, min: field.min, max: field.max, step: field.step });
  state.before = state.snapshot();
  return state;
}

function fCopyOmissionUnchanged(state, box) {
  const { x } = state;
  assert.deepEqual(state.snapshot(), state.before, 'placement preserves native focus, raw values, association, scope and independent guidance');
  assert.deepEqual(state.calls, []); assert.deepEqual(x.f.emitted, []);
  assert.equal(box.width, 44); assert.equal(box.height, 44); assert.ok(box.top >= 8 && box.bottom <= 792);
  assert.ok(x.boxes.length <= 16); assert.deepEqual(x.queries, [d420TaskRegionQuery]);
  assert.deepEqual(x.detached, x.rangeReads);
}

function fCopyOmissionQueries(state, requireAdmission = true) {
  const { x, selector } = state;
  const base = e11LibraryCopySelectors;
  const added = requireAdmission ? [selector] : x.fCopyQueries;
  assert.ok(added.length === 0 || added.length === 1 && added[0] === selector);
  assert.deepEqual(x.copyQueries, base); assert.deepEqual(x.fCopyQueries, added);
  assert.deepEqual(x.fLabelQueries, x.fLabelQueries.length ? [fLibraryWeightLabelCopySelector] : []);
  assert.deepEqual(x.allCopyQueries, [...base, ...added, ...x.fLabelQueries], 'the complete family and each exact optional F admission retain their order');
}

function fWeightLabelTextPlacement(t, {
  direct = [{ text: 'Default influence', fragments: [d411Rect(244, 650, 43, 18)] }],
  outputBox = d411Rect(40, 650, 80, 40),
} = {}) {
  const state = fCopyOmissionPlacement(t, 'weight'), { x, label, output, field } = state;
  const labelRaw = d411Rect(33, 600, 254, 154), fieldset = label.parentElement;
  fieldset.getBoundingClientRect = () => d411Rect(33, 592, 254, 168);
  fieldset.clientWidth = 254; fieldset.clientHeight = 168;
  label.clientWidth = labelRaw.width; label.clientHeight = labelRaw.height;
  label.getBoundingClientRect = () => { x.copyBoxReads.push(label); return labelRaw; };
  output.getBoundingClientRect = () => { x.copyBoxReads.push(output); return outputBox; };
  state.raw = outputBox;
  label.matches = selector => { assert.equal(selector, fLibraryWeightLabelCopySelector); return true; };
  const closest = function(selector) {
    if (selector === 'forma-library') return x.surface;
    assert.ok(["[hidden], [inert], [aria-hidden='true']", "[hidden], [inert], [aria-hidden='true'], script, style, svg, .forma-icon",
      ':modal, :popover-open'].includes(selector));
    if (selector.startsWith('[hidden]')) {
      if (this.hiddenAncestor) return this;
      for (let node = this.parentElement; node; node = node.parentElement) if (node.hiddenAncestor) return node;
    }
    return null;
  };
  label.closest = closest; output.closest = closest;
  const textNode = (text, fragments, parent) => ({
    nodeType: 3, textContent: text, fragments, parentNode: parent, parentElement: parent,
  });
  const directNodes = direct.map(({ text, fragments }) => textNode(text, fragments, label));
  const whitespace = textNode(' \n  ', [d411Rect(244, 650, 43, 18)], label);
  const comment = { nodeType: 8, textContent: 'Lit marker, not visible text', fragments: [d411Rect(40, 632, 80, 12)], parentNode: label, parentElement: label };
  const nested = x.ancestor(d411Rect(33, 632, 254, 58), {
    nodeType: 1, tagName: 'SPAN', parentNode: label, parentElement: label, textContent: 'Separate nested text', closest,
  });
  const nestedText = textNode(nested.textContent, [d411Rect(40, 632, 80, 12)], nested);
  nested.childNodes = [nestedText];
  output.nodeType = 1; output.parentNode = label; field.nodeType = 1; field.parentNode = label;
  Object.assign(output.textNodes[0], { nodeType: 3, parentNode: output });
  label.childNodes = [...directNodes, whitespace, comment, output, field, nested];
  // A real SHOW_TEXT traversal would also visit the OUTPUT and nested SPAN.
  // Keep that complete inventory distinct so a generic descendant walk cannot
  // masquerade as the required direct-TEXT-only traversal.
  label.textNodes = [...directNodes, whitespace, output.textNodes[0], nestedText];
  Object.defineProperty(label, 'textContent', { configurable: true, get() {
    return directNodes.map(node => node.textContent).join('') + whitespace.textContent + output.textContent + nested.textContent;
  } });
  x.selectWeightLabelForTest(label);
  const snapshot = state.snapshot;
  state.snapshot = () => ({ ...snapshot(), directText: directNodes.map(node => node.textContent),
    childOrder: [...label.childNodes], descendantTextInventory: [...label.textNodes],
    nestedText: nestedText.textContent, commentText: comment.textContent });
  Object.assign(state, { directNodes, whitespace, comment, nested, nestedText, labelRaw, outputBox });
  state.before = state.snapshot();
  return state;
}

function fWeightLabelQueries(state, requireLabel = true) {
  fCopyOmissionQueries(state);
  assert.deepEqual(state.x.fLabelQueries, requireLabel || state.x.fLabelQueries.length ? [fLibraryWeightLabelCopySelector] : []);
}

test('F Library explicitly labelled range and associated OUTPUT protect the whole percentage box at current values', { concurrency: false }, () => {
  for (const value of ['0', '0.65', '1']) {
    const cleanup = [];
    try {
      const state = fCopyOmissionPlacement({ after: undo => cleanup.push(undo) }, 'weight', { value });
      const { x, raw, fragment, ring, output, field, label, form } = state;
      const initial = x.launcher.getBoundingClientRect();
      assert.equal(x.overlap(initial, [raw]).length, 1); assert.equal(x.overlap(initial, [fragment, ring]).length, 0);
      const box = x.run();
      assert.equal(x.overlap(box, [raw, ring, ...x.controls.map(control => control.getBoundingClientRect())]).length, 0,
        'clear full percentage copy without altering the current named native range');
      assert.equal(box.bottom, 642); assert.deepEqual(x.copyBoxReads, [output]); assert.deepEqual(x.rangeReads, []);
      assert.equal(label.control, field); assert.equal(label.htmlFor, field.id); assert.deepEqual(field.labels, [label]);
      assert.equal(field.ariaLabel, label.textContent); assert.deepEqual(output.labels, []); assert.deepEqual(output.htmlFor, [field.id]);
      assert.equal(output.form, form); assert.equal(field.form, form); assert.equal(field.previousElementSibling, output);
      assert.equal(output.value, Math.round(Number(value) * 100) + '%');
      assert.deepEqual(state.formQueries, [fLibraryWeightFormSelector]);
      assert.deepEqual(state.associationQueries, [fLibraryWeightLabelSelector, ':scope > output', ':scope > input[type="range"]']);
      fCopyOmissionQueries(state); fCopyOmissionUnchanged(state, box);
    } finally { for (const undo of cleanup.reverse()) undo(); }
  }
});

test('F Library OUTPUT refuses duplicate, indirect or foreign native associations', { concurrency: false }, () => {
  for (const defect of ['untyped-form', 'untyped-label', 'untyped-output', 'untyped-range', 'disconnected-label', 'disconnected-range',
    'duplicate-form', 'duplicate-label', 'foreign-label', 'no-direct-output', 'duplicate-output', 'no-direct-range', 'duplicate-range',
    'foreign-output-form', 'foreign-range-form', 'intervening-sibling', 'label-controls-output', 'additional-range-label', 'foreign-range-label',
    'missing-range-id', 'foreign-label-for', 'missing-output-for', 'foreign-output-for', 'additional-output-for', 'foreign-output']) {
    const cleanup = [];
    try {
      const state = fCopyOmissionPlacement({ after: undo => cleanup.push(undo) }, 'weight');
      const { x, form, label, output, field, forms, labels, outputs, fields, raw } = state;
      if (defect === 'untyped-form') Object.setPrototypeOf(form, Object.prototype);
      if (defect === 'untyped-label') Object.setPrototypeOf(label, Object.prototype);
      if (defect === 'untyped-output') Object.setPrototypeOf(output, Object.prototype);
      if (defect === 'untyped-range') Object.setPrototypeOf(field, Object.prototype);
      if (defect === 'disconnected-label') label.isConnected = false;
      if (defect === 'disconnected-range') field.isConnected = false;
      const other = node => Object.assign(Object.create(Object.getPrototypeOf(node)), node);
      if (defect === 'duplicate-form') forms.push(other(form));
      if (defect === 'duplicate-label') labels.push(other(label));
      if (defect === 'foreign-label') labels[0] = other(label);
      if (defect === 'no-direct-output') outputs.length = 0;
      if (defect === 'duplicate-output') outputs.push(other(output));
      if (defect === 'no-direct-range') fields.length = 0;
      if (defect === 'duplicate-range') fields.push(other(field));
      if (defect === 'foreign-output-form') output.form = {};
      if (defect === 'foreign-range-form') field.form = {};
      if (defect === 'intervening-sibling') field.previousElementSibling = {};
      if (defect === 'label-controls-output') label.control = output;
      if (defect === 'additional-range-label') field.labels = [label, other(label)];
      if (defect === 'foreign-range-label') field.labels = [other(label)];
      if (defect === 'missing-range-id') field.id = '';
      if (defect === 'foreign-label-for') label.htmlFor = 'other-range';
      if (defect === 'missing-output-for') output.htmlFor = [];
      if (defect === 'foreign-output-for') output.htmlFor = ['other-range'];
      if (defect === 'additional-output-for') output.htmlFor = [field.id, 'other-range'];
      if (defect === 'foreign-output') outputs[0] = other(output);
      state.before = state.snapshot();
      const box = x.run();
      assert.equal(x.overlap(box, [raw]).length, 1, defect + ': a refused association cannot silently grant copy coverage');
      assert.equal(box.top, 650); assert.deepEqual(x.copyBoxReads, []); assert.deepEqual(x.rangeReads, []);
      fCopyOmissionQueries(state, false); fCopyOmissionUnchanged(state, box);
    } finally { for (const undo of cleanup.reverse()) undo(); }
  }
});

test('F Library percentage rejects stale display and declared invalid range-interface states', { concurrency: false }, () => {
  // Stale percentage updates both OUTPUT value/text, as the native interface
  // does. Invalid strings/bounds and a split value/text port below are explicit
  // defensive-interface stress, not claims about settled native range values.
  for (const defect of ['stale-percentage', 'wrong-min', 'wrong-max', 'wrong-step', 'empty', 'not-finite', 'below', 'above', 'split-output-interface']) {
    const cleanup = [];
    try {
      const state = fCopyOmissionPlacement({ after: undo => cleanup.push(undo) }, 'weight'), { x, output, field, raw } = state;
      if (defect === 'stale-percentage') output.value = '60%';
      if (defect === 'wrong-min') field.min = '-1';
      if (defect === 'wrong-max') field.max = '2';
      if (defect === 'wrong-step') field.step = '.1';
      if (defect === 'empty') field.value = '  ';
      if (defect === 'not-finite') field.value = 'NaN';
      if (defect === 'below') field.value = '-0.05';
      if (defect === 'above') field.value = '1.05';
      // Keep the display consistent with each invalid scalar so rejection must
      // come from trim/finite/bounds guards, not a coincident stale percentage.
      if (['empty', 'not-finite', 'below', 'above'].includes(defect)) output.value = Math.round(Number(field.value) * 100) + '%';
      if (defect === 'split-output-interface') { Object.defineProperty(output, 'value', { configurable: true, value: '65%' }); output.textContent = '60%'; }
      state.before = state.snapshot();
      const box = x.run();
      assert.equal(x.overlap(box, [raw]).length, 1, defect); assert.equal(box.top, 650);
      assert.deepEqual(x.copyBoxReads, []); assert.deepEqual(x.rangeReads, []);
      fCopyOmissionQueries(state, false); fCopyOmissionUnchanged(state, box);
    } finally { for (const undo of cleanup.reverse()) undo(); }
  }
});

test('F weight label whitespace, comments and nested descendants do not become a whole-row copy obstacle', { concurrency: false }, () => {
  for (const mode of ['row-whitespace', 'nested-text', 'comment-text', 'clipped-direct-text']) {
    const cleanup = [];
    try {
      const direct = [{ text: 'Default influence', fragments: [d411Rect(40, 616, 80, 18)] }];
      const state = fWeightLabelTextPlacement({ after: undo => cleanup.push(undo) }, { direct });
      const { x, label, labelRaw, output, outputBox, directNodes, nestedText, comment, ring } = state;
      const collision = d411Rect(244, 650, 43, 18);
      if (mode === 'nested-text') nestedText.fragments = [collision];
      if (mode === 'comment-text') comment.fragments = [collision];
      if (mode === 'clipped-direct-text') {
        directNodes[0].fragments = [collision];
        // Declared client clipping retains only x33..233 of this row. The
        // colliding direct text lies entirely outside that actual clip port.
        label.overflowX = 'hidden'; label.clientWidth = 200;
      }
      state.before = state.snapshot();
      const initial = x.launcher.getBoundingClientRect();
      assert.equal(x.overlap(initial, [labelRaw]).length, 1); assert.equal(x.overlap(initial, [outputBox, ring]).length, 0);
      if (mode === 'nested-text') assert.equal(x.overlap(initial, nestedText.fragments).length, 1);
      if (mode === 'comment-text') assert.equal(x.overlap(initial, comment.fragments).length, 1);
      const box = x.run();
      assert.deepEqual(box, initial, mode + ': unadmitted or clipped text does not relocate Ask');
      fWeightLabelQueries(state, false);
      assert.deepEqual(x.rangeReads, x.fLabelQueries.length ? directNodes : []);
      assert.deepEqual(x.copyBoxReads.filter(node => node !== label), [output]);
      if (mode !== 'clipped-direct-text') assert.deepEqual(x.copyBoxReads, [output], 'do not read a duplicate whole-label box');
      assert.equal(x.rangeReads.includes(nestedText), false); assert.equal(x.rangeReads.includes(comment), false);
      assert.equal(x.rangeReads.includes(output.textNodes[0]), false); assert.equal(x.rangeReads.includes(state.whitespace), false);
      fCopyOmissionUnchanged(state, box);
    } finally { for (const undo of cleanup.reverse()) undo(); }
  }
});

test('F weight label text cannot authorize hovered Ask movement or become native focus authority', { concurrency: false }, t => {
  const state = fWeightLabelTextPlacement(t), { x, label, directNodes, outputBox, ring } = state;
  const fragments = directNodes.flatMap(node => node.fragments);
  x.hovered = true;
  const box = x.run();
  assert.equal(x.overlap(box, fragments).length, 1); assert.equal(x.overlap(box, [outputBox, ring]).length, 0);
  assert.deepEqual(x.writes, []); assert.deepEqual(x.allOwnerQueries, []); assert.deepEqual(x.allCopyQueries, []);
  assert.deepEqual(x.copyBoxReads, []); assert.deepEqual(x.rangeReads, []); fCopyOmissionUnchanged(state, box);
  // Deliberately defensive nonnative activeElement port, not a claim that a
  // native LABEL receives focus from Tab in the real editor.
  x.f.document.activeElement = label; state.before = state.snapshot();
  assert.deepEqual(x.run(), box); assert.deepEqual(x.writes, []); assert.deepEqual(x.allOwnerQueries, []);
  fCopyOmissionUnchanged(state, box);
});

test('F weight direct label text alone and every wrapped fragment clear Ask with the named range unchanged', { concurrency: false }, () => {
  const variants = [
    [{ text: 'Default influence', fragments: [d411Rect(244, 650, 43, 18)] }],
    [{ text: 'Default influence', fragments: [d411Rect(40, 650, 80, 18), d411Rect(244, 672, 43, 18)] }],
    [{ text: 'Default ', fragments: [d411Rect(40, 650, 80, 18)] }, { text: 'influence', fragments: [d411Rect(244, 674, 43, 18)] }],
  ];
  for (const direct of variants) {
    const cleanup = [];
    try {
      const state = fWeightLabelTextPlacement({ after: undo => cleanup.push(undo) }, { direct });
      const { x, directNodes, outputBox, output, ring, label, field } = state;
      const fragments = directNodes.flatMap(node => node.fragments), initial = x.launcher.getBoundingClientRect();
      assert.equal(x.overlap(initial, fragments).length, 1, 'only the direct label text supplies the initial copy collision');
      assert.equal(x.overlap(initial, [outputBox, ring, field.getBoundingClientRect()]).length, 0);
      const box = x.run();
      // Geometry comes first: the preserved OUTPUT-only source leaves this
      // label collision, independently of the added selector/traversal ledger.
      assert.equal(x.overlap(box, [...fragments, outputBox, ring, ...x.controls.map(control => control.getBoundingClientRect())]).length, 0,
        'clear every direct text fragment together with the entire OUTPUT and native focus envelope');
      fWeightLabelQueries(state);
      assert.deepEqual(x.rangeReads, directNodes); assert.deepEqual(x.copyBoxReads, [output]);
      assert.equal(label.control, field); assert.equal(field.ariaLabel, 'Default influence');
      assert.deepEqual(field.labels, [label]); assert.deepEqual(output.htmlFor, [field.id]);
      assert.deepEqual(state.formQueries, [fLibraryWeightFormSelector, fLibraryWeightFormSelector]);
      assert.deepEqual(state.associationQueries, [
        fLibraryWeightLabelSelector, ':scope > output', ':scope > input[type="range"]',
        fLibraryWeightLabelSelector, ':scope > output', ':scope > input[type="range"]',
      ]);
      fCopyOmissionUnchanged(state, box);
    } finally { for (const undo of cleanup.reverse()) undo(); }
  }
});

test('F weight relanding clears direct label text as well as the whole OUTPUT and native ring', { concurrency: false }, t => {
  const state = fWeightLabelTextPlacement(t, {
    direct: [{ text: 'Default influence', fragments: [d411Rect(244, 612, 43, 18)] }],
    outputBox: d411Rect(33, 650, 254, 40),
  });
  const { x, directNodes, outputBox, output, ring } = state;
  const fragments = directNodes.flatMap(node => node.fragments), initial = x.launcher.getBoundingClientRect();
  assert.equal(x.overlap(initial, [outputBox]).length, 1); assert.equal(x.overlap(initial, [...fragments, ring]).length, 0);
  const outputOnlyDestination = d411Rect(266, 598, 44, 44);
  assert.equal(x.overlap(outputOnlyDestination, [outputBox, ring]).length, 0);
  assert.equal(x.overlap(outputOnlyDestination, fragments).length, 1, 'the declared upstream label defeats an OUTPUT-only destination');
  const box = x.run();
  assert.equal(x.overlap(box, [...fragments, outputBox, ring, ...x.controls.map(control => control.getBoundingClientRect())]).length, 0);
  fWeightLabelQueries(state); assert.deepEqual(x.rangeReads, directNodes); assert.deepEqual(x.copyBoxReads, [output]);
  fCopyOmissionUnchanged(state, box);
});

test('F weight direct label copy retains current-owner, connected OUTPUT, association and value guards', { concurrency: false }, () => {
  for (const defect of ['foreign-label-owner', 'hidden-label', 'hidden-label-text', 'busy-main', 'duplicate-owner', 'foreign-main',
    'disconnected-label', 'disconnected-output', 'untyped-label', 'untyped-output', 'duplicate-form', 'duplicate-label',
    'no-direct-output', 'duplicate-output', 'no-direct-range', 'duplicate-range', 'label-controls-output', 'foreign-label-for',
    'foreign-range-label', 'foreign-output-for', 'intervening-sibling', 'foreign-output-form', 'stale-percentage', 'invalid-current-value']) {
    const cleanup = [];
    try {
      const state = fWeightLabelTextPlacement({ after: undo => cleanup.push(undo) });
      const { x, label, output, field, forms, labels, outputs, fields, directNodes, outputBox, ring } = state;
      if (defect === 'foreign-label-owner') { const closest = label.closest; label.closest = function(selector) { return selector === 'forma-library' ? {} : closest.call(this, selector); }; }
      if (defect === 'hidden-label') label.hiddenAncestor = true;
      if (defect === 'hidden-label-text') label.visibility = 'hidden';
      if (defect === 'busy-main') x.main.getAttribute = name => { assert.equal(name, 'aria-busy'); return 'true'; };
      if (defect === 'duplicate-owner') { const query = x.main.querySelectorAll; x.main.querySelectorAll = selector => { const found = query(selector); return selector === 'forma-library' ? [x.surface, { ...x.surface }] : found; }; }
      if (defect === 'foreign-main') { const closest = x.surface.closest; x.surface.closest = selector => selector === '#main-content' ? {} : closest(selector); }
      if (defect === 'disconnected-label') label.isConnected = false;
      if (defect === 'disconnected-output') output.isConnected = false;
      if (defect === 'untyped-label') Object.setPrototypeOf(label, Object.prototype);
      if (defect === 'untyped-output') Object.setPrototypeOf(output, Object.prototype);
      const other = node => Object.assign(Object.create(Object.getPrototypeOf(node)), node);
      if (defect === 'duplicate-form') forms.push(other(state.form));
      if (defect === 'duplicate-label') labels.push(other(label));
      if (defect === 'no-direct-output') outputs.length = 0;
      if (defect === 'duplicate-output') outputs.push(other(output));
      if (defect === 'no-direct-range') fields.length = 0;
      if (defect === 'duplicate-range') fields.push(other(field));
      if (defect === 'label-controls-output') label.control = output;
      if (defect === 'foreign-label-for') label.htmlFor = 'another-range';
      if (defect === 'foreign-range-label') field.labels = [other(label)];
      if (defect === 'foreign-output-for') output.htmlFor = ['another-range'];
      if (defect === 'intervening-sibling') field.previousElementSibling = {};
      if (defect === 'foreign-output-form') output.form = {};
      if (defect === 'stale-percentage') output.value = '60%';
      if (defect === 'invalid-current-value') { field.value = '1.05'; output.value = '105%'; }
      state.before = state.snapshot();
      const fragments = directNodes.flatMap(node => node.fragments), initial = x.launcher.getBoundingClientRect();
      assert.equal(x.overlap(initial, fragments).length, 1); assert.equal(x.overlap(initial, [outputBox, ring]).length, 0);
      const box = x.run();
      assert.equal(box.top, 650, defect); assert.equal(x.overlap(box, fragments).length, 1, defect + ': refusal is not copy-clearance evidence');
      assert.deepEqual(x.rangeReads, [], defect + ': no refused label text is measured');
      assert.equal(x.copyBoxReads.includes(label), false, defect + ': no whole-label fallback');
      fCopyOmissionUnchanged(state, box);
    } finally { for (const undo of cleanup.reverse()) undo(); }
  }
});

// Retained browse-lane geometry helper reuse only. The current complete panel
// class above remains the code under test; these ports are synthetic CSSOM.
// F Comparison reuses the Studio/native-frame fixture. The original touch
// copy, image and action rectangles below are retained observations; the new
// navigation cell and its five reflowed links are declared CSSOM inputs, not
// browser paint, native text fit or a replay of the private failed placement.
const libraryOutputCopySelector = ".library-main > .library-body > .library-content > section > .library-output-grid > article.library-output > forma-output-card > article.output-card > .output-info > div:first-child";
const fBrowseHostSelector = ':scope > forma-ui-audience-navigation.application-task-navigation[data-primary-navigation="true"]';
function fBrowseSlot(t, { rtl = false, coarse = false, rail = false } = {}) {
  const x = e3StudioSlot(t, { rtl, coarse }), shell = x.main.parentElement;
  const host = x.host, nav = host.querySelector('.studio-mode-nav');
  const state = Object.assign(x.state, { intent: 'browse', eligible: true, top: 733, width: 320,
    vertical: false, foreign: false, labelOverflow: false, targetNarrow: false, linkCount: 5,
    rail, railWidth: 72, railHeight: 350.5, viewportWidth: 419, navFullHeight: false, malformedRows: false,
    borderLeft: 0, borderRight: 1, borderTop: 0, borderBottom: 0,
    paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 8, launcherShift: 0,
    visual: { height: 398.5, scale: 1, offsetTop: 0, offsetLeft: 0 } });
  if (rail) {
    state.top = 48;
    // The existing D411 teardown restores these globals. These are the saved
    // layout/visual viewport inputs, not a browser zoom or viewport mutation.
    globalThis.innerWidth = 419; globalThis.innerHeight = 398;
    x.f.nativeWindow.visualViewport = state.visual;
  }
  const size = () => state.coarse ? 48 : 44;
  const reserved = () => x.f.panel.dataset.browseSlot === 'true';
  const hostBox = () => state.rail
    ? d411Rect(state.rtl ? state.viewportWidth - state.railWidth : 0, state.top, state.railWidth, state.railHeight)
    : d411Rect(0, state.top, state.width, 67);
  const railContentWidth = () => state.railWidth - state.borderLeft - state.borderRight - state.paddingLeft - state.paddingRight;
  const railNavHeight = () => state.railHeight - state.borderTop - state.borderBottom - state.paddingTop - state.paddingBottom - size() - 8;
  const navBox = () => state.rail
    ? d411Rect(hostBox().left + state.borderLeft + state.paddingLeft, state.top + state.borderTop + state.paddingTop,
      railContentWidth(), state.navFullHeight ? state.railHeight : railNavHeight())
    : d411Rect(reserved() && state.rtl ? size() + 16 : 0,
      state.top + 1, state.width - (reserved() ? size() + 16 : 0), 66);
  host.parentElement = shell; host.getBoundingClientRect = hostBox;
  nav.parentElement = host; nav.getBoundingClientRect = navBox;
  const list = x.ancestor(navBox(), { parentElement: nav, isConnected: true });
  const links = Array.from({ length: 5 }, (_, index) => {
    const li = x.ancestor(navBox(), { parentElement: list, tagName: 'LI' });
    const link = x.control(d411Rect(0, 0, 1, 1), { tagName: 'A', parentElement: li, isConnected: true });
    link.getBoundingClientRect = () => {
      const box = navBox(), width = (box.width - 16) / 5;
      if (state.rail) {
        const height = (box.height - 16 - 8) / 5;
        return d411Rect(box.left + 8, box.top + 8 + index * (height + 2),
          state.targetNarrow ? 43 : box.width - 16, height);
      }
      return d411Rect(box.left + 4 + (state.rtl ? 4 - index : index) * (width + 2), box.top,
        state.targetNarrow ? 43 : width, box.height);
    };
    Object.defineProperties(link, {
      clientWidth: { get: () => Math.round(link.getBoundingClientRect().width) },
      scrollWidth: { get: () => Math.round(link.getBoundingClientRect().width) + Number(state.labelOverflow) },
      clientHeight: { get: () => state.rail ? Math.round(link.getBoundingClientRect().height) : 66 },
      scrollHeight: { get: () => state.rail ? Math.round(link.getBoundingClientRect().height) : 66 },
    });
    return link;
  });
  shell.querySelectorAll = selector => selector === 'forma-assistant-panel' ? [x.f.panel]
    : (assert.equal(selector, fBrowseHostSelector), state.duplicate ? [host, host] : [host]);
  host.closest = selector => selector === '.application-creative' ? state.foreign ? {} : shell
    : (assert.equal(selector, "[hidden], [inert], [aria-hidden='true']"), state.hidden ? shell : null);
  host.querySelectorAll = selector => (assert.equal(selector, ':scope > .ui-audience-navigation'), [nav]);
  nav.querySelectorAll = selector => (assert.equal(selector, ':scope > .ui-audience-navigation-list'), [list]);
  list.querySelectorAll = selector => (assert.equal(selector, ':scope > li > a[href]'), links.slice(0, state.linkCount));
  const style = getComputedStyle;
  globalThis.getComputedStyle = element => ({ ...style(element),
    ...(element === x.f.panel ? { getPropertyValue: name => name === '--forma-assistant-browse-slot' && state.eligible ? state.rail ? 'rail' : '1' : '0' } : {}),
    ...(element === host ? { display: reserved() ? 'grid' : 'block',
      gridTemplateColumns: state.vertical ? '56px' : `${state.width - size() - 16}px ${size()}px`,
      columnGap: '8px', paddingLeft: state.rtl ? '8px' : '0px', paddingRight: state.rtl ? '0px' : '8px',
      transform: state.transform, overflowY: state.clip ? 'hidden' : 'visible',
      borderTopLeftRadius: state.radius ?? '0px',
      ...(state.rail ? { gridTemplateColumns: `${railContentWidth()}px`,
        gridTemplateRows: state.malformedRows ? `${railNavHeight()}px` : `${railNavHeight()}px ${size()}px`, rowGap: '8px',
        borderLeftWidth: `${state.borderLeft}px`, borderRightWidth: `${state.borderRight}px`,
        borderTopWidth: `${state.borderTop}px`, borderBottomWidth: `${state.borderBottom}px`,
        paddingLeft: `${state.paddingLeft}px`, paddingRight: `${state.paddingRight}px`,
        paddingTop: `${state.paddingTop}px`, paddingBottom: `${state.paddingBottom}px` } : {}) } : {}),
  });
  const fallbackBox = x.launcher.getBoundingClientRect;
  x.launcher.getBoundingClientRect = () => x.f.panel.dataset.browseLauncher === 'true'
    ? d411Rect(Number(x.values.get('--forma-assistant-browse-left')?.replace('px', '')),
      Number(x.values.get('--forma-assistant-browse-top')?.replace('px', '')) + state.launcherShift,
      Number(x.values.get('--forma-assistant-browse-size')?.replace('px', '')),
      Number(x.values.get('--forma-assistant-browse-size')?.replace('px', '')))
    : fallbackBox();
  // Existing Library whole-copy ownership is retained, not a new selector.
  // RTL is a declared horizontal mirror of this LTR saved scene, not a second
  // observed failure. Navigation order stays unchanged in either direction.
  const scene = (left, top, width, height) => d411Rect(state.rail && state.rtl
    ? state.viewportWidth - left - width : left, top, width, height);
  const library = x.ancestor(d411Rect(0, -1606, 320, 3728), { parentElement: x.main, isConnected: true });
  library.closest = selector => selector === '#main-content' ? x.main
    : (assert.equal(selector, '.application-creative'), shell);
  const copyBox = state.rail ? scene(105.7578125, 58.3046875, 279.484375, 109.09375)
    : d411Rect(33, 259.578125, 254, 108.578125);
  const copy = x.ancestor(copyBox, { parentElement: library, isConnected: true, tagName: 'DIV',
    textContent: 'Take 1 · 80 × 60 · Latency 1.1s. Decide whether to pin, save, export, or record what should change next time.' });
  copy.closest = selector => selector === 'forma-library' ? library : null;
  copy.matches = selector => (assert.equal(selector, libraryOutputCopySelector), true);
  library.querySelectorAll = selector => selector === libraryOutputCopySelector ? [copy] : [];
  const mainQuery = x.main.querySelectorAll;
  x.main.querySelectorAll = selector => selector === 'forma-library' ? [library] : mainQuery(selector);
  const more = x.control(state.rail ? scene(273.875, 177.3984375, 111.3671875, 44)
    : d411Rect(175.625, 378.15625, 111.375, 44), {
    tagName: 'BUTTON', outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '3px' });
  const observed = state.rail ? [scene(91.7578125, -305.6953125, 307.484375, 352),
    scene(104.7578125, 249.9921875, 281.484375, 44), scene(104.7578125, 301.9921875, 281.484375, 44),
    scene(88.7578125, 377.9921875, 313.484375, 264.078125)] : [d411Rect(19, -104.421875, 282, 352), d411Rect(32, 450.75, 256, 44),
    d411Rect(32, 502.75, 256, 44), d411Rect(16, 578.75, 288, 264.0625)];
  x.controls.splice(0, x.controls.length, ...observed.map(box => x.control(box, { tagName: 'BUTTON' })), more, ...links);
  x.regions.length = 0; x.f.document.activeElement = more;
  return Object.assign(x, { state, shell, nav, list, links, more, copyBox, scene,
    expectedBrowse: () => state.rail
      ? d411Rect(hostBox().left + state.borderLeft + state.paddingLeft + (railContentWidth() - size()) / 2,
        hostBox().bottom - state.borderBottom - state.paddingBottom - size(), size(), size())
      : d411Rect(state.rtl ? 8 : state.width - size() - 8,
      state.top + 1 + (66 - size()) / 2, size(), size()) });
}

// Synthetic CSSOM reflow over the existing complete-class F fixture. Only the
// LTR pre-reservation rectangles are saved native observations; the marker-driven
// resize, RTL mirror and native quantization below are explicit regression inputs,
// not a browser layout, paint, focus-ring or accessibility acceptance claim.
function fBrowseReservedLane(t, options = {}) {
  const x = fBrowseSlot(t, options), { panel } = x.f, owner = panel.parentElement;
  const property = '--forma-assistant-browse-lane-base-inset';
  Object.assign(x.state, { eligible: false, laneAvailable: true, laneBase: 0, laneGap: 10,
    laneQuantization: 0, laneWidthExtra: 0, copyOverflow: false, displacedFocus: false,
    mainHidden: false, panelHidden: false, foreignOwner: false, mismatchedDirection: false });
  const size = () => x.state.coarse ? 48 : 44;
  const reserved = () => panel.dataset.browseLane === 'true';
  // At the declared 16px root size the actual rule's max(.625rem, .5rem, 0px)
  // is 10px. The separate enlarged-safe-inset case explicitly supplies 40px.
  // Default cases retain the CSS's actual 64/68px strip.
  const strip = () => size() + 2 * x.state.laneGap;
  const mainValues = new Map(), priorities = new Map(), mainWrites = [];
  x.main.style = {
    getPropertyValue: name => mainValues.get(name) ?? '',
    getPropertyPriority: name => priorities.get(name) ?? '',
    setProperty(name, value, priority = '') {
      mainWrites.push({ name, value, priority }); mainValues.set(name, value); priorities.set(name, priority);
    },
    removeProperty(name) { const value = mainValues.get(name) ?? ''; mainValues.delete(name); priorities.delete(name); return value; },
  };
  x.main.isConnected = true; owner.parentElement = x.shell;
  x.launcher.assistantOwned = true; // The same direct native child satisfies the existing contains port.
  owner.matches = selector => selector === 'forma-creative-assistant' && !x.state.foreignOwner;
  const hiddenSelector = "[hidden], [inert], [aria-hidden='true']";
  const panelClosest = panel.closest, mainClosest = x.main.closest;
  panel.closest = selector => selector === hiddenSelector ? x.state.panelHidden ? owner : null : panelClosest(selector);
  x.main.closest = selector => selector === hiddenSelector ? x.state.mainHidden ? x.shell : null : mainClosest(selector);
  const previousStyle = getComputedStyle;
  globalThis.getComputedStyle = element => {
    const style = previousStyle(element);
    return { ...style,
      ...(element === panel ? { direction: x.state.mismatchedDirection ? x.state.rtl ? 'ltr' : 'rtl' : style.direction,
        getPropertyValue: name => name === '--forma-assistant-browse-lane-available'
          ? x.state.laneAvailable ? '1' : '0' : style.getPropertyValue(name) } : {}),
      ...(element === x.main ? { borderTopWidth: '0px', borderBottomWidth: '0px',
        paddingLeft: `${x.state.rtl ? x.state.laneBase + (reserved() ? strip() : 0) : 0}px`,
        paddingRight: `${x.state.rtl ? 0 : x.state.laneBase + (reserved() ? strip() : 0)}px` } : {}),
    };
  };
  const library = x.main.querySelectorAll('forma-library')[0];
  const copy = library.querySelectorAll(libraryOutputCopySelector)[0];
  const rawCopy = copy.getBoundingClientRect(), copyText = copy.textContent;
  const mainControls = x.controls.filter(control => !x.links.includes(control));
  const rawControls = mainControls.map(control => control.getBoundingClientRect());
  const controlReads = [], copyReads = [];
  const mirror = box => x.state.rtl ? d411Rect(320 - box.right, box.top, box.width, box.height) : box;
  mainControls.forEach((control, index) => {
    control.getBoundingClientRect = () => {
      const raw = rawControls[index];
      // The native More retains its full target width; only its inline position
      // moves. Other main boxes reflow in the narrowed content area. The five
      // real navigation links are outside main and are never rewritten here.
      let box = reserved() ? control === x.more
        ? d411Rect(raw.left - strip(), x.state.displacedFocus ? -100 : raw.top, raw.width, raw.height)
        : d411Rect(raw.left, raw.top, raw.width - strip(), raw.height) : raw;
      box = mirror(box); controlReads.push({ control, reserved: reserved(), box }); return box;
    };
  });
  copy.getBoundingClientRect = () => {
    const box = reserved() && x.state.copyOverflow ? d411Rect(0, 0, 320, 800)
      : mirror(reserved() ? d411Rect(rawCopy.left, rawCopy.top, rawCopy.width - strip(), rawCopy.height) : rawCopy);
    copyReads.push({ reserved: reserved(), box }); return box;
  };
  const previousLauncherBox = x.launcher.getBoundingClientRect;
  x.launcher.getBoundingClientRect = () => {
    // The later native cell position rule wins if both markers briefly coexist
    // during recovery; clearing the lane then revalidates that actual cell.
    if (panel.dataset.browseLauncher === 'true' || panel.dataset.studioLauncher === 'true') return previousLauncherBox();
    if (reserved()) return d411Rect(
      Number.parseFloat(x.values.get('--forma-assistant-browse-lane-left') ?? '8px') + x.state.laneQuantization,
      Number.parseFloat(x.values.get('--forma-assistant-browse-lane-top') ?? '8px'), size() + x.state.laneWidthExtra, size());
    const raw = previousLauncherBox(), width = panel.dataset.compactLauncher === 'true' ? size() : raw.width;
    return mirror(d411Rect(310 - width, raw.top, width, size()));
  };
  return Object.assign(x, { property, mainValues, priorities, mainWrites, mainControls, rawControls,
    rawCopy, copy, copyText, controlReads, copyReads, size, strip,
    assertLane(box) {
      assert.equal(panel.dataset.browseLane, 'true');
      assert.equal(panel.dataset.browseSlot, undefined); assert.equal(panel.dataset.browseLauncher, undefined);
      assert.equal(box.width, size()); assert.equal(box.height, size());
      const padding = x.state.laneBase + strip();
      const contentEdge = x.state.rtl ? padding : 320 - padding;
      assert.ok(x.state.rtl ? box.left >= 8 && box.right <= contentEdge - 8
        : box.left >= contentEdge + 8 && box.right <= 312, 'the whole native button has at least eight pixels on each side');
      assert.ok(box.top >= 63 && box.bottom <= 792);
      assert.equal(x.main.style.getPropertyValue(property), `${x.state.laneBase}px`);
      assert.equal(x.main.style.getPropertyPriority(property), '');
      assert.equal(copy.textContent, copyText); assert.equal(copy.parentElement, library);
      assert.deepEqual(x.links, x.controls.slice(-5)); x.custody();
    },
    assertRetired() {
      assert.equal(panel.dataset.browseLane, undefined);
      for (const name of ['left', 'top']) assert.equal(x.values.has('--forma-assistant-browse-lane-' + name), false);
    },
  });
}

// Case-local current-document ports for the retained helper. No browser focus,
// scrolling or CSS layout is implemented here: geometry changes remain explicit.
function r3BrowseReservedLane(t, options = {}) {
  const x = fBrowseReservedLane(t, options), document = x.f.document, view = x.f.nativeWindow;
  view.location = { href: 'https://fixture.invalid/library/project-a' };
  view.innerWidth = innerWidth; view.innerHeight = innerHeight;
  view.getComputedStyle = element => getComputedStyle(element);
  document.defaultView = view; document.location = view.location;
  x.main.contains = element => {
    for (let node = element; node; node = node.parentElement) if (node === x.main) return true;
    return false;
  };
  document.body = { isConnected: true }; document.documentElement = { isConnected: true };
  document.hasFocus = () => x.state.foreground !== false;
  document.visibilityState = 'visible';
  for (const node of [x.f.panel, x.f.panel.parentElement, x.shell, x.main, ...x.controls]) node.ownerDocument = document;
  const events = new EventTarget(), listeners = new Map();
  document.addEventListener = (name, callback, options) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
    events.addEventListener(name, callback, typeof options === 'boolean' ? { capture: options } : options);
  };
  document.removeEventListener = (name, callback, options) => {
    listeners.get(name)?.delete(callback);
    events.removeEventListener(name, callback, typeof options === 'boolean' ? { capture: options } : options);
  };
  const scrolls = [], focusCalls = [], nativeState = { revealed: false, readsAfterScroll: 0 };
  const beforeElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  class NativeElementPort {}
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, writable: true, value: NativeElementPort });
  t.after(() => {
    if (beforeElement) Object.defineProperty(globalThis, 'HTMLElement', beforeElement);
    else delete globalThis.HTMLElement;
  });
  const setInset = x.main.style.setProperty;
  x.main.style.setProperty = (name, value, priority = '') => {
    setInset(name, value, priority);
    if (name === x.property) x.onReservation?.();
  };
  const nativeFocus = ({ before = d411Rect(90, 700, 180, 44), after = d411Rect(80, 785, 112, 44) } = {}) => {
    const focused = x.more;
    Object.setPrototypeOf(focused, NativeElementPort.prototype);
    focused.isConnected = true; focused.ownerDocument = document; focused.parentElement = x.main;
    focused.matches = selector => {
      if (selector === 'a[href], button, input, textarea, select, summary') return true;
      if (selector === ':focus-visible') return nativeState.focusVisible !== false;
      if (selector === ':disabled') return nativeState.disabled === true;
      assert.fail('unexpected native focus selector ' + selector);
    };
    const closest = focused.closest;
    focused.closest = selector => selector === '#main-content' ? x.main : closest.call(focused, selector);
    focused.getBoundingClientRect = () => {
      if (scrolls.length) nativeState.readsAfterScroll++;
      const box = x.f.panel.dataset.browseLane === 'true' ? after : before;
      return nativeState.revealed ? d411Rect(box.left, 700, box.width, box.height) : box;
    };
    focused.getClientRects = () => { x.beforeRevealRead?.(); return [focused.getBoundingClientRect()]; };
    focused.focus = () => { focusCalls.push(focused); assert.fail('placement must not call focus'); };
    focused.scrollIntoView = options => {
      scrolls.push({ control: focused, options, lane: x.f.panel.dataset.browseLane });
      x.onScroll?.();
      if (nativeState.scrollError) throw new Error('declared native scroll failure');
      nativeState.revealed = true;
    };
    document.activeElement = focused;
    return focused;
  };
  return Object.assign(x, { document, view, scrolls, focusCalls, nativeState, nativeFocus,
    dispatchDocumentGesture: name => events.dispatchEvent(new Event(name)),
    assertLeaseDisposed() {
      assert.equal([...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0), 0);
      assert.deepEqual(focusCalls, []); assert.deepEqual(x.f.emitted, []);
    } });
}

const r3LaneCase = 'Assistant stable browse: ';
test(r3LaneCase + 'compact RTL main reserves before first traversal even when an ordinary floating gap is clear', { concurrency: false }, t => {
  const x = r3BrowseReservedLane(t, { rtl: true, coarse: true }), listeners = new Map();
  // Deliberately clear the initial floating gap. These are synthetic ports,
  // not additional native observations attached to the retained donor scene.
  x.rawControls[3] = d411Rect(16, 560, 288, 44);
  x.document.activeElement = x.document.body;
  x.f.nativeWindow.addEventListener = (name, callback) => listeners.set(name, callback);
  x.f.nativeWindow.removeEventListener = (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); };
  x.f.nativeWindow.matchMedia = () => new EventTarget();
  x.f.panel.connectedCallback();
  x.state.laneAvailable = false;
  const temporary = x.run(); x.assertRetired();
  assert.equal(x.overlap(temporary, [x.copy.getBoundingClientRect(), ...x.controls.map(control => control.getBoundingClientRect())]).length, 0);
  assert.equal(x.f.panel.dataset.compactLauncher, undefined, 'the ordinary floating path succeeds without exhausting a compact search');
  x.state.laneAvailable = true;
  const held = x.run(); x.assertLane(held);
  assert.equal(x.document.activeElement, x.document.body, 'reserve before any main control receives keyboard focus');
  const activations = x.mainWrites.length, padding = getComputedStyle(x.main).paddingLeft, width = x.copy.getBoundingClientRect().width;
  for (const index of [1, 2, 3]) {
    const focused = x.mainControls[index];
    Object.assign(focused, { outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '3px' });
    if (index === 3) x.rawControls[index] = d411Rect(16, 530, 288, 274);
    x.document.activeElement = focused;
    listeners.get('focusin')(); listeners.get('scroll')();
    assert.equal(x.f.frames.length, 1); x.f.frames.shift()(0); assert.equal(x.f.frames.length, 0);
    assert.deepEqual(x.launcher.getBoundingClientRect(), held); x.assertLane(held);
    assert.equal(x.document.activeElement, focused);
    assert.equal(getComputedStyle(x.main).paddingLeft, padding); assert.equal(x.copy.getBoundingClientRect().width, width);
    assert.equal(x.mainWrites.length, activations); assert.deepEqual(x.focuses, []); assert.deepEqual(x.scrolls, []);
  }
  x.f.panel.disconnectedCallback(); x.assertRetired(); assert.equal(listeners.size, 0); x.assertLeaseDisposed(); x.custody();
});

test(r3LaneCase + 'page focus at the viewport edge retains an inline-clear main lane without accepting unknown or overlapping paint', { concurrency: false }, t => {
  const x = r3BrowseReservedLane(t, { coarse: true }), listeners = new Map();
  x.f.nativeWindow.addEventListener = (name, callback) => listeners.set(name, callback);
  x.f.nativeWindow.removeEventListener = (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); };
  x.f.nativeWindow.matchMedia = () => new EventTarget();
  x.f.panel.connectedCallback();
  const held = x.run(), launcher = x.launcher; x.assertLane(held);
  // R16's saved anchor was y746.046875..1010.109375 before native scroll
  // 1790 -> 2000. Model that viewport-edge body and its known 3px + 3px
  // outline in the existing CSSOM ports; this is not native scroll or paint.
  const focused = x.control(d411Rect(16, 536.046875, 220, 264.0625), {
    tagName: 'A', parentElement: x.main, outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '3px',
  });
  x.controls.splice(x.controls.length - x.links.length, 0, focused);
  const ring = d411Rect(10, 530.046875, 232, 276.0625);
  assert.ok(ring.bottom > innerHeight); assert.ok(ring.right < held.left);
  const copy = x.copy.getBoundingClientRect(), padding = getComputedStyle(x.main).paddingRight;
  const activations = x.mainWrites.length;
  x.f.document.activeElement = focused;
  for (const event of ['focusin', 'scroll', 'focusin']) {
    listeners.get(event)(); assert.equal(x.f.frames.length, 1); x.f.frames.shift()(0);
    assert.equal(x.f.frames.length, 0);
    assert.deepEqual(x.launcher.getBoundingClientRect(), held); x.assertLane(held);
    assert.equal(x.launcher, launcher); assert.equal(x.f.document.activeElement, focused);
    assert.deepEqual(x.copy.getBoundingClientRect(), copy);
    assert.equal(getComputedStyle(x.main).paddingRight, padding);
    assert.equal(x.mainWrites.length, activations, 'keyboard travel must not clear and reacquire the main reservation');
    assert.deepEqual(x.focuses, []);
  }
  x.f.document.activeElement = launcher;
  listeners.get('focusin')(); assert.equal(x.f.frames.length, 1); x.f.frames.shift()(0);
  assert.deepEqual(x.launcher.getBoundingClientRect(), held); x.assertLane(held);
  assert.equal(x.f.document.activeElement, launcher); assert.deepEqual(x.focuses, []);

  // Inline separation never makes an automatic outline exactly measurable.
  focused.outlineStyle = 'auto'; x.f.document.activeElement = focused;
  listeners.get('focusin')(); assert.equal(x.f.frames.length, 1); x.f.frames.shift()(0);
  x.assertRetired(); assert.equal(x.f.document.activeElement, focused); assert.deepEqual(x.focuses, []);

  focused.outlineStyle = 'solid'; x.f.document.activeElement = x.more;
  const restored = x.run(); x.assertLane(restored);
  // The body only touches the lane edge, but its six-pixel focus envelope
  // actually overlaps. The same placement flow must still retire this lane.
  focused.getBoundingClientRect = () => d411Rect(restored.left - 12, restored.top + 6, 12, 44);
  assert.equal(x.overlap(restored, [focused.getBoundingClientRect()]).length, 0);
  assert.equal(x.overlap(restored, [d411Rect(restored.left - 18, restored.top, 24, 56)]).length, 1);
  x.f.document.activeElement = focused;
  listeners.get('focusin')(); assert.equal(x.f.frames.length, 1); x.f.frames.shift()(0);
  x.assertRetired(); assert.equal(x.f.document.activeElement, focused); assert.deepEqual(x.focuses, []);
  x.f.panel.disconnectedCallback(); assert.equal(listeners.size, 0); x.custody();
});

test(r3LaneCase + 'main lane retains open/close custody and restores its prior main value and priority on disconnect', { concurrency: false }, async t => {
  const x = r3BrowseReservedLane(t), listeners = new Map(), pointer = new EventTarget();
  x.main.style.setProperty(x.property, '7px', 'important');
  x.f.nativeWindow.addEventListener = (name, callback) => listeners.set(name, callback);
  x.f.nativeWindow.removeEventListener = (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); };
  x.f.nativeWindow.matchMedia = query => (assert.equal(query, '(pointer: coarse)'), pointer);
  x.f.panel.connectedCallback(); x.assertLane(x.run());
  x.f.panel.open = true; x.f.panel.updated(new Map([['open', false]])); await Promise.resolve();
  for (const frame of x.f.frames.splice(0)) frame(0);
  assert.equal(x.f.panel.dataset.browseLane, 'true'); assert.equal(x.mainValues.get(x.property), '0px');
  x.state.coarse = true; pointer.dispatchEvent(new Event('change'));
  assert.equal(x.f.frames.length, 1); x.f.frames.shift()(0);
  assert.equal(x.f.panel.dataset.browseLane, 'true', 'the live open owner retains its reserved main padding');
  x.f.panel.open = false; x.f.panel.updated(new Map([['open', true]])); await Promise.resolve();
  for (const frame of x.f.frames.splice(0)) frame(0);
  x.assertLane(x.launcher.getBoundingClientRect());
  assert.equal(x.focuses.length, 1); assert.equal(x.f.document.activeElement, x.launcher);
  assert.deepEqual(x.focuses[0].box, x.launcher.getBoundingClientRect());
  x.f.panel.disconnectedCallback(); x.assertRetired();
  assert.equal(x.mainValues.get(x.property), '7px'); assert.equal(x.priorities.get(x.property), 'important');
  assert.equal(listeners.size, 0); x.custody();
});

test(r3LaneCase + 'a reflowed copy overflow or displaced current focus cannot receive reserved-lane clearance', { concurrency: false }, () => {
  for (const defect of ['copy-overflow', 'displaced-focus']) {
    const cleanup = [];
    try {
      const x = r3BrowseReservedLane({ after: undo => cleanup.push(undo) }), focused = x.more;
      x.state.copyOverflow = defect === 'copy-overflow'; x.state.displacedFocus = defect === 'displaced-focus';
      x.run(); x.assertRetired();
      assert.equal(x.queries.length, 3, 'initial sample, failed reserved sample and one final unreserved fallback; no reserve/clear loop');
      assert.ok(x.copyReads.some(row => row.reserved), 'retain fresh copy evidence even on refusal');
      if (defect === 'displaced-focus') assert.ok(x.controlReads.some(row => row.control === focused && row.reserved && row.box.bottom < 0),
        'the focused native owner remains recorded even when it falls out of the visible obstacle set');
      assert.equal(x.mainValues.has(x.property), false);
      assert.equal(x.f.document.activeElement, focused); assert.deepEqual(x.focuses, []); x.custody();
    } finally { for (const undo of cleanup.reverse()) undo(); }
  }
});

test(r3LaneCase + 'repeated scroll, focus and transition events cannot reactivate the same rejected main reservation', { concurrency: false }, t => {
  const x = r3BrowseReservedLane(t), listeners = new Map();
  x.f.nativeWindow.addEventListener = (name, callback) => listeners.set(name, callback);
  x.f.nativeWindow.removeEventListener = (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); };
  x.f.nativeWindow.matchMedia = query => (assert.equal(query, '(pointer: coarse)'), new EventTarget());
  let mainTop = 63;
  x.main.getBoundingClientRect = () => d411Rect(0, mainTop, 320, 737);
  x.state.displacedFocus = true; x.f.panel.connectedCallback();
  const activations = () => x.mainWrites.filter(row => row.name === x.property).length;
  x.run(); x.assertRetired(); assert.equal(activations(), 1); assert.equal(x.queries.length, 3);
  for (const name of ['scroll', 'focusin', 'transitionend', 'scroll', 'focusin', 'transitionend']) {
    // Top-only scroll changes do not change the rejected width/height/focus key.
    mainTop -= 0.125;
    const copyStart = x.copyReads.length; x.queries.length = 0;
    listeners.get(name)(); listeners.get(name)();
    assert.equal(x.f.frames.length, 1, 'the retained scheduler coalesces duplicate native events');
    x.f.frames.shift()(0);
    assert.equal(x.f.frames.length, 0); x.assertRetired();
    assert.equal(activations(), 1, name + ': no new width reservation or reserve/clear cycle');
    assert.equal(x.queries.length, 1, 'only one ordinary floating qualification occurs');
    assert.ok(x.copyReads.length > copyStart);
    assert.ok(x.copyReads.slice(copyStart).every(row => !row.reserved));
    assert.equal(x.f.document.activeElement, x.more); assert.deepEqual(x.focuses, []); x.custody();
  }
  // A genuinely different visible native focus owner changes the refusal key.
  // The formerly focused More still moves offscreen in this synthetic reflow;
  // it cannot be misrepresented as the current focus that now must remain visible.
  x.f.document.activeElement = x.mainControls[1];
  x.assertLane(x.run()); assert.equal(activations(), 2); assert.equal(x.queries.length, 2);
  assert.equal(x.f.document.activeElement, x.mainControls[1]); assert.deepEqual(x.focuses, []);
  x.f.panel.disconnectedCallback(); x.assertRetired(); assert.equal(listeners.size, 0); x.custody();
});

test(r3LaneCase + 'late readiness reveals the previously complete exact native main control once', { concurrency: false }, t => {
  const x = r3BrowseReservedLane(t, { rtl: true, coarse: true }), focused = x.nativeFocus();
  x.state.busy = true; x.run(); x.assertRetired(); assert.deepEqual(x.scrolls, []);
  x.state.busy = false;
  const held = x.run(); x.assertLane(held);
  assert.deepEqual(x.scrolls, [{ control: focused, options: { block: 'nearest', inline: 'nearest', behavior: 'instant' }, lane: 'true' }]);
  assert.equal(x.document.activeElement, focused); assert.ok(x.nativeState.readsAfterScroll > 0, 'the existing placement collector rechecks after scrolling');
  const revealed = focused.getBoundingClientRect();
  assert.ok(revealed.top >= 6 && revealed.bottom <= innerHeight - 6);
  assert.equal(x.overlap(held, [d411Rect(revealed.left - 6, revealed.top - 6, revealed.width + 12, revealed.height + 12)]).length, 0);
  const writes = x.mainWrites.length;
  x.run(); assert.equal(x.scrolls.length, 1); assert.equal(x.mainWrites.length, writes);
  x.assertLeaseDisposed(); x.custody();
});

for (const mode of ['prior-partial', 'post-overheight', 'already-visible']) test(r3LaneCase + 'late reveal stays bounded / ' + mode, { concurrency: false }, t => {
  const x = r3BrowseReservedLane(t, { rtl: true, coarse: true });
  const before = mode === 'prior-partial' ? d411Rect(90, 785, 180, 44) : d411Rect(90, 700, 180, 44);
  const after = mode === 'post-overheight' ? d411Rect(80, 0, 112, 810)
    : mode === 'already-visible' ? d411Rect(80, 700, 112, 44) : d411Rect(80, 785, 112, 44);
  const focused = x.nativeFocus({ before, after });
  x.state.busy = true; x.run(); x.state.busy = false;
  x.run(); assert.deepEqual(x.scrolls, []); assert.equal(x.document.activeElement, focused);
  if (mode === 'prior-partial') x.assertRetired();
  else x.assertLane(x.launcher.getBoundingClientRect());
  x.assertLeaseDisposed(); x.custody();
});

for (const change of ['route', 'context', 'scope', 'focus', 'disconnected', 'gesture', 'direction', 'posture']) test(r3LaneCase + 'late reveal rejects changed ownership / ' + change, { concurrency: false }, t => {
  const x = r3BrowseReservedLane(t, { rtl: true, coarse: true }), focused = x.nativeFocus();
  const other = x.mainControls[1];
  x.state.busy = true; x.run(); x.state.busy = false;
  x.beforeRevealRead = () => {
    if (change === 'direction') x.state.rtl = false;
    if (change === 'posture') x.state.short = true;
  };
  x.onReservation = () => {
    if (change === 'route') x.view.location.href = 'https://fixture.invalid/library/project-b';
    if (change === 'context') x.f.panel.context = { route: '/library/project-b' };
    if (change === 'scope') x.f.panel.conversationScope = 'scope-b';
    if (change === 'focus') x.document.activeElement = other;
    if (change === 'disconnected') focused.isConnected = false;
    if (change === 'gesture') x.dispatchDocumentGesture('keydown');
  };
  x.run(); assert.deepEqual(x.scrolls, []);
  assert.equal(x.document.activeElement, change === 'focus' ? other : focused);
  x.assertLeaseDisposed();
  assert.deepEqual(x.focuses, []); assert.deepEqual(x.f.emitted, []);
});

for (const mode of ['scroll-error', 'focus-reentry']) test(r3LaneCase + 'native scroll failure or reentry still revalidates without retry / ' + mode, { concurrency: false }, t => {
  const x = r3BrowseReservedLane(t, { rtl: true, coarse: true }), focused = x.nativeFocus();
  const other = x.mainControls[1];
  x.state.busy = true; x.run(); x.state.busy = false;
  if (mode === 'scroll-error') x.nativeState.scrollError = true;
  else x.onScroll = () => { x.document.activeElement = other; };
  x.run();
  assert.equal(x.scrolls.length, 1); assert.equal(x.scrolls[0].control, focused);
  assert.equal(x.document.activeElement, mode === 'focus-reentry' ? other : focused);
  assert.ok(x.nativeState.readsAfterScroll > 0, 'the actual placement collector still runs after the native operation');
  x.run(); assert.equal(x.scrolls.length, 1, 'settled validation never retries the scroll');
  x.assertLeaseDisposed(); x.custody();
});

for (const change of ['main-replacement', 'owner-replacement', 'owner-withdrawal', 'route', 'direction', 'posture']) test(r3LaneCase + 'accepted stable ownership retires before own-focus freeze / ' + change, { concurrency: false }, t => {
  const x = r3BrowseReservedLane(t, { rtl: true, coarse: true }), owner = x.f.panel.parentElement;
  x.main.style.setProperty(x.property, '7px', 'important');
  const held = x.run(); x.assertLane(held);
  const launcher = x.launcher, reservations = () => x.mainWrites.filter(row => row.name === x.property && row.priority === '').length;
  const before = reservations();
  x.document.activeElement = launcher; x.hovered = true;
  let replacement;
  if (change === 'main-replacement') {
    replacement = x.ancestor(d411Rect(0, 63, 320, 737), { parentElement: x.shell, isConnected: true, ownerDocument: x.document,
      getAttribute: name => (assert.equal(name, 'aria-busy'), 'false'),
      closest: selector => selector === '.application-creative' ? x.shell
        : (assert.equal(selector, "[hidden], [inert], [aria-hidden='true']"), null),
      style: { getPropertyValue: () => 'replacement-owned', getPropertyPriority: () => 'important',
        setProperty() { assert.fail('retirement must not write the replacement main'); },
        removeProperty() { assert.fail('retirement must not remove replacement-owned style'); } },
    });
    x.shell.querySelector = selector => (assert.equal(selector, ':scope > #main-content'), replacement);
  }
  if (change === 'owner-replacement') x.f.panel.parentElement = { ...owner, parentElement: x.shell, ownerDocument: x.document };
  if (change === 'owner-withdrawal') owner.parentElement = null;
  if (change === 'route') x.view.location.href = 'https://fixture.invalid/library/project-b';
  if (change === 'direction') x.state.rtl = false;
  if (change === 'posture') x.state.short = true;
  x.run(); x.assertRetired();
  assert.equal(x.mainValues.get(x.property), '7px'); assert.equal(x.priorities.get(x.property), 'important');
  assert.equal(reservations(), before, 'own-focus retirement does not acquire another width reservation');
  assert.equal(x.launcher, launcher); assert.equal(x.document.activeElement, launcher);
  assert.deepEqual(x.focuses, []); assert.deepEqual(x.scrolls, []); assert.deepEqual(x.f.emitted, []);
  if (replacement) assert.equal(replacement.style.getPropertyValue(x.property), 'replacement-owned');
  x.assertLeaseDisposed();
});
