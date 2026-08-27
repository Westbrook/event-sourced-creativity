import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import * as lit from "lit";
import { keyed } from "lit/directives/keyed.js";
import { ASSISTANT_CONTEXT_LIMITS } from "../src/model/conversation-context.ts";
import { contextConsentAction } from "../src/model/context-consent-state.ts";
import { ensureNativeModalDialog } from "../src/components/design-system/native-dialog.ts";
import { ASSISTANT_MESSAGES } from "../src/components/design-system/locales/assistant-messages.ts";

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
function fixture(locale = "en") {
  const emitted = [], trace = [], frames = [];
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
    "./conversation-composer.ts": {}, "./assistant-panel.css": {},
  };
  const exports = {};
  new Function("require", "exports", "customElements", "document", "window", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", panelCode)(
    name => { assert.ok(Object.hasOwn(dependencies, name), "explicit component port " + name); return dependencies[name]; },
    exports, { get: () => undefined, define() {} }, document, { addEventListener() {}, removeEventListener() {} },
    callback => { frames.push(callback); return frames.length; }, () => {}, () => ({ matches: true }),
  );
  const panel = new exports.FormaAssistantPanel();
  panel.open = true; panel.conversationScope = "scope-a"; panel.pageLabel = "Authored context — سياق 日本語";
  panel.canSpecialist = true; panel.models = [
    { id: "gpt-5.6-luna", maximumMicrousd: 15000, premiumApprovalRequired: false },
    { id: "gpt-5.6-terra", maximumMicrousd: 25000, premiumApprovalRequired: false },
    { id: "gpt-5.6-sol", maximumMicrousd: 45000, premiumApprovalRequired: true },
  ];
  panel.addEventListener("forma-assistant-specialist-close", event => { if (panel.specialist?.id === event.detail.reviewId) panel.specialist = null; });
  const f = { panel, i18n, emitted, trace, frames, dialog, field, document,
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
