// Reused Host R2 responsive helper declarations; complete current component methods remain actual.
// This finite native port does not establish physical browser focus, layout or touch delivery.
import assert from "node:assert/strict";
import { nothing as nativeImageNothing } from "lit";
import { PartType as NativeImagePartType } from "lit/directive.js";
import { getDirectiveClass as nativeImageDirectiveClass, isDirectiveResult as nativeImageDirective } from "lit/directive-helpers.js";
import { createCalmFullPage as createImageFullPage, calmFullPageNativePorts as imageNativePorts } from "./calm-full-page-fixture.mjs";

const IMAGE_RESPONSIVE_OPTIONS = { concurrency: false, timeout: 30_000 };

// The shared full-page renderer handles its existing cache/keyed/repeat parts.
// Evaluate the actual Image CHILD directive and wire its public section ref by
// the same explicit native-port method used in native-image-launcher.test.mjs.
// Do not replace the renderer, any production method, or the launcher factory.
function* imageHostTemplates(value) {
  if (Array.isArray(value)) { for (const child of value) yield* imageHostTemplates(child); return; }
  if (nativeImageDirective(value) && typeof value.values[0] === "function") return;
  for (let remaining = 8; nativeImageDirective(value); remaining--) {
    assert.ok(remaining > 0, "bounded actual Image child directive nesting");
    const Directive = nativeImageDirectiveClass(value);
    value = new Directive({ type: NativeImagePartType.CHILD }).render(...value.values);
  }
  if (!value || !Array.isArray(value.strings)) return;
  yield value;
  for (const child of value.values) yield* imageHostTemplates(child);
}

function imageNativeEvent(target, extra = {}) {
  return { type: "click", target, currentTarget: target, isTrusted: true, button: 0,
    defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
}

function imageLauncherMount(f, previous = null) {
  const templates = [...imageHostTemplates(f.shell.renderNativeImage(f.workspace))];
  const template = templates.find(value => value.strings.join("").includes('class="native-image-launcher"'));
  assert.ok(template, "the actual host supplies an admitted launcher template");
  const refs = template.values.filter(value => nativeImageDirective(value) && typeof value.values[0] === "function");
  assert.equal(refs.length, 1, "the original launcher supplies one section ref");
  const region = previous?.region ?? imageNativePorts.documentPort.createElement("section");
  const buttons = previous?.buttons ?? Array.from({ length: 3 }, () => imageNativePorts.documentPort.createElement("button"));
  if (!previous) {
    region.isConnected = true; region.parentElement = f.workspace;
    region.remove = () => { region.isConnected = false; region.parentElement = null; };
    for (const button of buttons) { button.isConnected = true; button.parentElement = region; }
    region.children = buttons;
  }
  const disabled = template.values.filter((_value, index) => template.strings[index].endsWith("?disabled="));
  buttons[0].disabled = disabled[0]; buttons[1].disabled = disabled[1]; buttons[2].disabled = false;
  const clicks = template.values.filter((_value, index) => template.strings[index].endsWith("@click="));
  assert.equal(clicks.length, 3, "actual Create, Check, Close handlers");
  refs[0].values[0](region);
  return { region, buttons, clicks, template,
    activate(index) { return clicks[index](imageNativeEvent(buttons[index], { pointerType: "touch" })); } };
}

async function imageResponsiveFixture(t) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Native Image responsive tests cannot use an external API or provider"));
  const { documentPort, windowPort } = imageNativePorts;
  const oldVisibility = documentPort.visibilityState;
  documentPort.visibilityState = "visible";
  t.after(() => { documentPort.visibilityState = oldVisibility; });

  // Unlike the older shared native port's alias, Document and Window listeners
  // are different native targets here. Retain exact original callbacks so a
  // queued callback can still be delivered after its listener was removed.
  const documentListeners = new Map(), windowListeners = new Map();
  const add = (map, type, listener) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(listener);
  };
  const remove = (map, type, listener) => map.get(type)?.delete(listener);
  t.mock.method(documentPort, "addEventListener", (type, listener) => add(documentListeners, type, listener));
  t.mock.method(documentPort, "removeEventListener", (type, listener) => remove(documentListeners, type, listener));
  const addWindow = windowPort.addEventListener.bind(windowPort), removeWindow = windowPort.removeEventListener.bind(windowPort);
  t.mock.method(windowPort, "addEventListener", (type, listener, options) => { add(windowListeners, type, listener); addWindow(type, listener, options); });
  t.mock.method(windowPort, "removeEventListener", (type, listener, options) => { remove(windowListeners, type, listener); removeWindow(type, listener, options); });
  const f = await createImageFullPage(t);
  f.shell = f.host;
  const workspaces = f.components().filter(value => value.tag === "forma-workspace");
  assert.equal(workspaces.length, 1, "the full page contains one actual Document Workspace");
  f.workspace = workspaces[0];
  f.actions = () => f.workspace.querySelector("forma-generation-actions");
  assert.ok(f.actions(), "the actual personal Workspace renders GenerationActions");
  assert.equal(f.actions().store, f.store);
  f.openings = [];
  const open = f.shell.openNativeImage;
  t.mock.method(f.shell, "openNativeImage", function(origin, setup, presentation) {
    const opening = Reflect.apply(open, this, [origin, setup, presentation]);
    f.openings.push({ origin, setup, presentation, opening });
    return opening;
  });
  f.entry = (actions = f.actions()) => {
    const node = f.renderer.ownNodes(actions, "button").find(value => value.classList.contains("native-image-entry"));
    assert.ok(node, "actual GenerationActions Image entry");
    assert.equal(typeof node.handlers.click, "function");
    return { node, activate: () => node.handlers.click.call(actions, imageNativeEvent(node, { pointerType: "touch" })) };
  };
  f.pane = name => {
    const node = f.renderer.ownNodes(f.workspace, "button").find(value => value.attributes["data-workbench-pane"] === name);
    assert.ok(node, "actual Workspace pane " + name);
    node.handlers.click.call(f.workspace, imageNativeEvent(node, { pointerType: "touch" }));
  };
  f.resize = width => {
    const observations = [...f.resizeTargets].filter(([_observer, node]) => node.owner === f.workspace && node.classList?.contains("studio-main"));
    assert.equal(observations.length, 1, "the actual Workspace observes its own studio container");
    const [observer, node] = observations[0];
    observer.callback([{ target: node, contentRect: { width } }]);
  };
  f.artifact = open => {
    const artifacts = f.components().find(value => value.tag === "forma-document-artifacts" && value.parentElement === f.workspace && value.source === "document");
    assert.ok(artifacts, "the actual Workspace artifact-gallery event owner");
    const type = open ? "document-artifact-viewer-open" : "document-artifact-close";
    assert.equal(typeof artifacts.eventBindings[type], "function");
    artifacts.dispatchEvent({ type, target: artifacts, currentTarget: artifacts });
  };
  f.imagePageListeners = { document: documentListeners, window: windowListeners };
  f.deliver = (target, type, extra = {}, originals = null) => {
    const owner = target === "document" ? documentPort : windowPort;
    const callbacks = originals ?? [...(f.imagePageListeners[target].get(type) ?? [])];
    for (const callback of callbacks) callback.call(owner, { type, target: owner, currentTarget: owner, ...extra });
    return callbacks;
  };
  f.openImage = () => {
    f.draw();
    const entry = f.entry();
    assert.equal(Object.hasOwn(entry.node.attributes, "disabled"), false, "Image entry is enabled before an explicit opening");
    const count = f.openings.length; entry.activate();
    assert.equal(f.openings.length, count + 1, "one explicit GA action reaches the existing Shell owner");
    const record = f.openings.at(-1);
    assert.ok(record.opening, "the real Store grants this current personal Document lifetime");
    assert.equal(record.presentation.current(), true);
    return { ...record, entry, mounted: imageLauncherMount(f) };
  };
  f.pane("result"); f.draw();
  return f;
}

function assertImageRetiredBeforeRender(f, opening) {
  assert.equal(opening.presentation.current(), false, "the exact original presentation is revoked before any render/current discovery");
  assert.equal(opening.mounted.region.hidden, true, "the original launcher was synchronously hidden");
  assert.equal(opening.mounted.region.isConnected, false, "the original launcher was synchronously removed");
  assert.equal(f.shell.renderNativeImage(f.workspace), nativeImageNothing, "the Shell cannot present the retired opening");
}


export { IMAGE_RESPONSIVE_OPTIONS, imageResponsiveFixture, imageNativePorts, imageNativeEvent, imageLauncherMount, assertImageRetiredBeforeRender };
