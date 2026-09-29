import assert from "node:assert/strict";
import { calmFullPageNativePorts as ports } from "./calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./output-navigation-focus-native.mjs";

// Reuse workspaceFragmentFixture's actual Shell/CreativeApplication composition
// around these two existing finite scenarios, not its invitation-only service.
// No navigation method, owner admission, request or route commit is replaced.
export async function withSettingsShellFixture(t, create) {
  const cleanups = [], setupTest = { mock: t.mock, after(callback) { cleanups.push(callback); } };
  let f, shell, oldTitle, titleChanged = false, oldModules = [];
  t.after(async () => {
    try {
      if (f) {
        ports.bindFixture(f);
        for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) {
          instance.isConnected = false; instance.disconnectedCallback();
        }
        if (shell?.isConnected) { shell.isConnected = false; shell.disconnectedCallback(); }
      }
      for (const cleanup of cleanups) await cleanup();
    } finally {
      for (const [key, had, value] of oldModules) {
        if (had) ports.moduleCache.set(key, value); else ports.moduleCache.delete(key);
      }
      if (titleChanged) {
        if (oldTitle) Object.defineProperty(ports.documentPort, "title", oldTitle);
        else delete ports.documentPort.title;
      }
    }
  });
  f = await create(setupTest);
  const original = structuredClone({ route: f.store.route.get(), events: f.store.events.get(),
    head: f.store.head.get(), content: f.store.content.get(), session: f.store.session.get(),
    authority: f.store.captureAuthorizationScope()?.key, writes: f.service.writes });
  assert.equal(f.service.pending, 0); assert.equal(f.service.writes.length, 0); assert.equal(f.dialog(), null);
  f.host.isConnected = false; f.host.disconnectedCallback();
  for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) {
    instance.isConnected = false; instance.disconnectedCallback();
  }
  for (const node of f.renderer.nodes) node.isConnected = false;
  f.nativeHistoryLocation = f.storeHost.location;
  const shellPath = "src/components/forma-shell.ts", performancePath = "src/performance.ts";
  oldModules = [shellPath, performancePath].map(key => [key, ports.moduleCache.has(key), ports.moduleCache.get(key)]);
  oldTitle = Object.getOwnPropertyDescriptor(ports.documentPort, "title");
  Object.defineProperty(ports.documentPort, "title", { configurable: true, writable: true, value: "Workspace — Forma" });
  titleChanged = true;
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
  const { FormaUiStack } = await ports.loadActual("src/components/design-system/layout.ts");
  const { localizeTemplateResult } = await ports.loadActual("src/components/design-system/localized-template.ts");
  f.renderer = new ports.RendererPort(f, { ...f.renderer.registry,
    "forma-creative-application": FormaCreativeApplication, "forma-workspace-settings": FormaWorkspaceSettings,
    "forma-attention-observer": FormaAttentionObserver, "forma-ui-workspace-switcher": navigation.FormaUiWorkspaceSwitcher,
    "forma-ui-audience-navigation": navigation.FormaUiAudienceNavigation, "forma-ui-language-picker": FormaUiLanguagePicker,
    "forma-ui-stack": FormaUiStack });
  const renderValue = f.renderer.value;
  f.renderer.value = function(value, ...rest) { return renderValue.call(this, localizeTemplateResult(value, f.i18n), ...rest); };
  // Use the same existing native raw-data map, including the confirmation
  // fixture's fields map. No second form cache or new submitted value exists.
  if (!f.forms) f.forms = f.fields;
  assert.ok(f.forms instanceof WeakMap); f.focusCalls ??= [];
  const collect = f.renderer.collect.bind(f.renderer);
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length; collect(markup, owner);
    for (const node of f.renderer.nodes.slice(start)) {
      node.disabled = Object.hasOwn(node.attributes, "disabled");
      node.select = () => { f.trace.push("select:" + node.value); };
      node.reset = () => { f.forms.delete(node); f.trace.push("form-reset"); };
      node.focus = () => {
        assert.ok(node.isConnected, "Native focus target is connected");
        ports.documentPort.activeElement = node; f.focusCalls.push(node); f.emitWindow("focusin", { target: node });
      };
    }
  };
  shell = new FormaShell(); shell.tag = "forma-shell"; shell.attributes = {}; shell.isConnected = true;
  f.host = shell; f.doc.body.append(shell);
  f.draw = () => {
    ports.bindFixture(f); if (!shell.isConnected) return "";
    for (const node of f.renderer.nodes) node.isConnected = false;
    f.requested = false; return f.renderer.draw(shell);
  };
  // The existing twelve turns now also deliver the real mounted Shell's RAFs,
  // exactly as workspaceFragmentFixture. Do not substitute a direct route call.
  f.flush = async (turns = 12) => {
    for (let step = 0; step < turns; step++) {
      await new Promise(setImmediate); f.draw();
      const frames = [...f.frames.values()]; f.frames.clear();
      for (const callback of frames) await callback();
    }
  };
  shell.connectedCallback(); f.draw(); await f.flush();
  const currentOwner = () => {
    const owners = [...f.renderer.instances.values()].map(record => record.instance)
      .filter(owner => owner.isConnected && owner.tag === "forma-workspace-settings");
    assert.ok(owners.length <= 1, "One current Settings owner in the actual Shell");
    return owners[0] ?? null;
  };
  // The focus bridge joins this Store document to the existing native DOM.
  // Dialog construction must use that same original factory, not the
  // Store-only ElementPort that intentionally lacks native modal methods.
  const storeDocument = f.storeHost.document;
  if (storeDocument !== ports.documentPort) {
    const previousCreate = Object.getOwnPropertyDescriptor(storeDocument, "createElement");
    Object.defineProperty(storeDocument, "createElement", { configurable: true, writable: true,
      value: (...args) => ports.documentPort.createElement(...args) });
    setupTest.after(() => {
      if (previousCreate) Object.defineProperty(storeDocument, "createElement", previousCreate);
      else delete storeDocument.createElement;
    });
  }
  installOutputNavigationFocusNative(setupTest, f, ports);
  // Defer the existing declaration-only helper import until fixture creation;
  // its policy/whole-read declaration chain also imports this assembly module.
  const { nativeDefaultProperties } = await import("./workspace-settings-fragment-fixture.mjs");
  nativeDefaultProperties({ f, currentOwner }); await f.flush();
  const owner = currentOwner();
  assert.ok(owner instanceof FormaWorkspaceSettings && owner.parentElement instanceof FormaCreativeApplication);
  assert.equal(owner.parentElement.parentElement, shell); assert.equal(owner.closest("forma-shell"), shell);
  assert.equal(owner.store, f.store); assert.equal(shell.store, f.store);
  assert.equal(f.store.session.get().assistant?.enabled, undefined); assert.equal(f.store.ui.attentionCapture, false);
  assert.equal(f.service.pending, 0); assert.deepEqual({ route: f.store.route.get(), events: f.store.events.get(),
    head: f.store.head.get(), content: f.store.content.get(), session: f.store.session.get(),
    authority: f.store.captureAuthorizationScope()?.key, writes: f.service.writes }, original);
  return f;
}
