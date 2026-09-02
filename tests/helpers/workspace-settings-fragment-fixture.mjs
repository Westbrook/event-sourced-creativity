// Complete current Creator Shell/CreativeApplication/WorkspaceSettings/Store.
// Reuse the existing finite Settings service and native form lifecycle. This
// models native default/history delivery; it is not a physical browser claim.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";
import { within } from "./workspace-policy-native-fixture.mjs";

const sourceUrl = new URL("../workspace-settings-draft-completion.test.mjs", import.meta.url);
const source = fs.readFileSync(sourceUrl, "utf8");
const digest = value => createHash("sha256").update(value).digest("hex");
assert.equal(digest(source), "6f2d6589efdd196a958fb00991c585b904b5458faec503656d30966f0167dd39",
  "exact locale checkpoints plus equivalent Boolean native identity diagnostics");
const tsModule = await import(new URL("../../node_modules/typescript/lib/typescript.js", import.meta.url));
const ts = tsModule.default ?? tsModule;
const tree = ts.createSourceFile(sourceUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(tree.parseDiagnostics.length, 0);
const registersTest = node => ts.isCallExpression(node) && node.expression.getText(tree) === "test"
  || Boolean(ts.forEachChild(node, registersTest));
const firstTests = tree.statements.find(registersTest);
assert.ok(firstTests, "cut before the first old test-registration statement");
// Retain the existing try/finally that imports and releases its fixture hook;
// filtering declarations alone would omit that genuine initialization.
const prefix = source.slice(0, firstTests.getFullStart())
  + "\nexport {setup,nativeFormLifetime,cases,originalNotice,visibleNotice,endpoint,settingsPath};\n";
sourceUrl.search = "b3-workspace-fragment-declarations-r1";
const loader = registerHooks({ load(url, context, next) {
  return url === sourceUrl.href ? { format: "module", source: prefix, shortCircuit: true } : next(url, context);
} });
let reused;
try { reused = await import(sourceUrl.href); } finally { loader.deregister(); }
const { setup, nativeFormLifetime, cases, originalNotice, visibleNotice, endpoint, settingsPath } = reused;
const invitation = cases.find(value => value.id === "invitation");
assert.ok(invitation);

const currentSettings = f => [...f.renderer.instances.values()].map(record => record.instance)
  .find(owner => owner.isConnected && owner.tag === "forma-workspace-settings") ?? null;
const method = request => (request.init.method ?? "GET").toUpperCase();
const hasClass = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);

// Finite native property reflection over the current emitted controls only.
// The original nativeFormLifetime remains the sole raw FormData/retained-form
// owner. No second raw cache, private field, handler replacement or invented
// initial value is used. Controlled policies keep their real Lit parts below.
export function nativeDefaultProperties(x) {
  const { f } = x, draw = f.draw;
  f.draw = () => {
    const markup = draw(), owner = x.currentOwner(), rows = f.tree().nodes;
    for (const form of rows.filter(node => node.tag === "form" && node.owner === owner
      && (hasClass(node, "workspace-settings-form") || Object.hasOwn(node.attributes, "data-workspace-review"))
      && !Object.hasOwn(node.attributes, "data-workspace-policy"))) {
      const controls = rows.filter(node => within(node, form) && ["input", "select", "textarea", "button", "fieldset", "output", "object"].includes(node.tag));
      const elements = controls.map(node => node.port);
      elements.namedItem = name => elements.find(node => node.getAttribute("name") === name || node.getAttribute("id") === name) ?? null;
      form.port.elements = elements;
      for (const field of controls.filter(node => ["input", "select", "textarea"].includes(node.tag))) {
        const node = field.port, name = field.attributes.name ?? "";
        node.name = name; node.type = field.attributes.type ?? (field.tag === "input" ? "text" : field.tag);
        node.readOnly = Object.hasOwn(field.attributes, "readonly");
        if (field.tag === "select") {
          const choices = rows.filter(row => row.tag === "option" && within(row, field));
          assert.equal(rows.some(row => row.tag === "optgroup" && within(row, field)), false, "These current raw forms have no unmodeled optgroup");
          assert.equal(Object.hasOwn(field.properties, "value"), false, "A raw selector has no controlled value binding");
          node.multiple = Object.hasOwn(field.attributes, "multiple");
          assert.equal(node.multiple, false, "This finite raw-form supplement is size-one select only");
          node.options = choices.map(choice => choice.port);
          const explicit = choices.filter(choice => Object.hasOwn(choice.attributes, "selected"));
          const defaultChoice = explicit.at(-1) ?? choices.find(choice => !Object.hasOwn(choice.attributes, "disabled"));
          const current = f.forms.get(form.port);
          if (!current?.has(name)) node.value = String(defaultChoice?.attributes.value ?? defaultChoice?.text ?? "");
          for (const choice of choices) {
            choice.port.value = String(choice.attributes.value ?? choice.text);
            choice.port.defaultSelected = Object.hasOwn(choice.attributes, "selected");
            Object.defineProperty(choice.port, "selected", { configurable: true, get: () => node.value === choice.port.value });
          }
        } else {
          node.defaultValue = String(field.attributes.value ?? (field.tag === "textarea" ? field.text : ""));
          node.defaultChecked = Object.hasOwn(field.attributes, "checked");
          if (!f.forms.get(form.port)?.has(name) && !Object.hasOwn(field.properties, "value")) node.value = node.defaultValue;
        }
      }
    }
    return markup;
  };
  f.draw();
}

function emit(f, type, extra = {}) {
  ports.bindFixture(f); const target = extra.target ?? ports.documentPort.activeElement;
  const listeners = [...(f.listeners.get(type) ?? [])];
  for (const listener of listeners) listener({ type, target, preventDefault() {}, stopPropagation() {},
    composedPath: () => target ? [target, ports.documentPort] : [ports.documentPort], ...extra });
  return listeners.length;
}
function focus(f, node) {
  assert.ok(node?.isConnected); node.focus(); emit(f, "focusin", { target: node });
}

export async function workspaceFragmentFixture(t) {
  // This is the existing invitation setup, including its finite, exact201 and
  // public event fixtures. No raw draft or write exists at this setup transition.
  const cleanups = [], setupTest = { mock: t.mock, after(callback) { cleanups.push(callback); } };
  const x = await setup(setupTest, invitation), { f, service } = x;
  let oldModules = [], oldTitle;
  t.after(async () => {
    try { for (const cleanup of cleanups) await cleanup(); }
    finally {
      for (const [key, had, value] of oldModules) { if (had) ports.moduleCache.set(key, value); else ports.moduleCache.delete(key); }
      if (oldTitle) Object.defineProperty(ports.documentPort, "title", oldTitle); else delete ports.documentPort.title;
    }
  });
  assert.equal(service.writes.length, 0); assert.equal(service.pending, 0);
  f.disconnect();
  f.nativeHistoryLocation = f.storeHost.location;
  assert.equal(f.nativeHistoryLocation.href, "http://localhost" + f.store.route.get());
  const shellPath = "src/components/forma-shell.ts", performancePath = "src/performance.ts";
  oldModules = [shellPath, performancePath].map(key => [key, ports.moduleCache.has(key), ports.moduleCache.get(key)]);
  oldTitle = Object.getOwnPropertyDescriptor(ports.documentPort, "title");
  Object.defineProperty(ports.documentPort, "title", { configurable: true, writable: true, value: "Workspace — Forma" });
  // Existing Product full-platform fixture's observation-only performance port.
  // Source/session/authority, route commits and every component remain actual.
  f.populations = []; f.completions = [];
  ports.moduleCache.set(performancePath, { beginRoutePopulation: path => f.populations.push(path),
    completeRoutePopulation: path => f.completions.push(path), recordPopulationSource() {} });
  ports.moduleCache.delete(shellPath);
  const { FormaShell } = await ports.loadActual(shellPath);
  const { FormaCreativeApplication } = await ports.loadActual("src/apps/creative/entry.ts");
  const { FormaWorkspaceSettings } = await ports.loadActual("src/components/forma-workspace-settings.ts");
  const { FormaAttentionObserver } = await ports.loadActual("src/components/forma-attention-observer.ts");
  const navigation = await ports.loadActual("src/components/design-system/navigation.ts");
  const { FormaUiLanguagePicker } = await ports.loadActual("src/components/design-system/language-picker.ts");
  const { FormaUiSwitch } = await ports.loadActual("src/components/design-system/forms.ts");
  const { FormaUiCopyButton } = await ports.loadActual("src/components/design-system/feedback.ts");
  const { FormaUiCluster } = await ports.loadActual("src/components/design-system/layout.ts");
  const { localizeTemplateResult } = await ports.loadActual("src/components/design-system/localized-template.ts");
  f.renderer = new ports.RendererPort(f, { "forma-creative-application": FormaCreativeApplication,
    "forma-workspace-settings": FormaWorkspaceSettings, "forma-attention-observer": FormaAttentionObserver,
    "forma-ui-workspace-switcher": navigation.FormaUiWorkspaceSwitcher,
    "forma-ui-audience-navigation": navigation.FormaUiAudienceNavigation,
    "forma-ui-language-picker": FormaUiLanguagePicker, "forma-ui-switch": FormaUiSwitch,
    "forma-ui-copy-button": FormaUiCopyButton, "forma-ui-cluster": FormaUiCluster });
  const renderValue = f.renderer.value;
  f.renderer.value = function(value, ...rest) { return renderValue.call(this, localizeTemplateResult(value, f.i18n), ...rest); };
  // Exact native field/reset/focus hooks from settingsFixture, now attached to
  // the full hierarchy's renderer. No application listener is replaced.
  const collect = f.renderer.collect.bind(f.renderer);
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length; collect(markup, owner);
    for (const node of f.renderer.nodes.slice(start)) {
      node.disabled = Object.hasOwn(node.attributes, "disabled");
      node.select = () => { f.trace.push("select:" + node.value); };
      node.reset = () => { f.forms.delete(node); f.trace.push("form-reset"); };
      node.focus = () => {
        assert.ok(node.isConnected, "Native focus target is connected");
        ports.documentPort.activeElement = node; f.focusCalls.push(node); emit(f, "focusin", { target: node });
      };
    }
  };
  f.host = new FormaShell(); f.host.tag = "forma-shell"; f.host.attributes = {}; f.host.isConnected = true;
  f.doc.body.append(f.host);
  x.native = nativeFormLifetime(f, invitation, { owner: () => currentSettings(f) });
  // Same finite Settings turns; additionally deliver the existing native RAFs
  // needed by the newly mounted real Shell. No larger settle threshold.
  f.flush = async (turns = 12) => { for (let step = 0; step < turns; step++) {
    await new Promise(setImmediate); f.draw();
    const frames = [...f.frames.values()]; f.frames.clear(); for (const callback of frames) await callback();
  } };
  f.host.connectedCallback(); f.draw(); await f.flush();
  const owner = currentSettings(f);
  assert.equal(f.host instanceof FormaShell, true); assert.equal(owner instanceof FormaWorkspaceSettings, true);
  assert.equal(owner.parentElement instanceof FormaCreativeApplication, true);
  assert.equal(owner.parentElement.parentElement, f.host);
  assert.equal(f.store.session.get().assistant?.enabled, undefined, "unchanged finite Settings session does not enable Assistant");
  assert.equal(f.store.ui.attentionCapture, false, "unchanged existing preference has no passive capture");
  assert.equal(service.pending, 0); assert.equal(service.writes.length, 0);
  x.native.current(); x.owner = owner;
  x.currentOwner = () => currentSettings(f);
  x.entry = invitation;
  x.notice = () => visibleNotice(f);
  x.saved = () => originalNotice(f, invitation);
  x.currentForms = () => f.tree().visible("form").filter(node => node.owner === currentSettings(f)
    && String(node.handlers.submit).includes(invitation.marker));
  x.observation = form => {
    const forms = x.currentForms(), current = forms[0]?.port;
    const notices = f.tree().visible("p").filter(node => node.attributes.role === "status"
      && String(node.attributes.class).split(/\s+/u).includes("workspace-settings-notice"));
    assert.ok(notices.length <= 1, "at most one actual Settings completion status");
    return { route: f.store.route.get(), sameOwner: currentSettings(f) === owner,
      formCount: forms.length, sameForm: current === form, originalConnected: form.isConnected,
      raw: current ? x.native.raw(current) : null, notice: notices[0]?.text ?? null,
      invitationVisible: f.values().some(value => value.includes("finite-original-token-A")),
      pending: service.pending, gets: service.requests.filter(request => method(request) === "GET").length,
      commands: service.writes.length };
  };
  return x;
}

export async function workspaceHistoryDelivery(x, destination, { skip = false } = {}) {
  const { f } = x; f.draw();
  const old = new URL(f.nativeHistoryLocation.href), next = new URL(destination, old), beforeRoute = f.store.route.get();
  let main;
  if (skip) {
    const anchor = f.find("a", node => node.owner === f.host && node.attributes.class === "skip-link");
    assert.equal(destination, anchor.attributes.href); assert.equal(anchor.attributes.href, "#main-content");
    assert.equal(anchor.handlers.click, undefined, "activate the current native Skip anchor, not a saved callback");
    assert.ok(anchor.port.isConnected && f.renderer.nodes.includes(anchor.port));
    main = f.find("main", node => node.owner === f.host && node.attributes.id === "main-content");
    assert.equal(main.attributes.tabindex, "-1");
    assert.equal(next.pathname + next.search, old.pathname + old.search); assert.notEqual(next.hash, old.hash);
    focus(f, anchor.port); emit(f, "keydown", { target: anchor.port, key: "Enter" }); anchor.port.click();
    assert.equal(f.store.route.get(), beforeRoute, "the renderer has no fabricated anchor-routing callback");
  }
  // B2's finite native Location setter + explicit browser-history delivery.
  // pushState here does not claim to emit either history event itself.
  history.pushState({}, "", next.pathname + next.search + next.hash);
  assert.equal(f.store.route.get(), beforeRoute, "native location alone does not mutate the Store route");
  const popstate = emit(f, "popstate", { state: null });
  assert.equal(popstate, 1, "the mounted complete Creator Shell owns its actual history handler");
  const hashchange = old.hash === next.hash ? 0 : emit(f, "hashchange", { oldURL: old.href, newURL: next.href });
  if (main) focus(f, main.port);
  await f.flush();
  assert.equal(f.store.route.get(), next.pathname + next.search + next.hash);
  return { from: old.pathname + old.search + old.hash, to: f.store.route.get(), popstate, hashchange,
    anchorHref: skip ? "#main-content" : null, nativeFocus: main?.attributes.id ?? null };
}

export { ports, invitation, endpoint, settingsPath, method, nativeFormLifetime };
