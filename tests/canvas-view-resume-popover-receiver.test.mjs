// Permanent regression: Canvas View listeners retain their declaration receiver.
// Installed Lit dispatch is exercised at the shared Popover's native controls.
// Full existing Canvas/Popover/controller fixture, unchanged. Only native event
// dispatch below uses installed Lit EventPart and the actual consuming Popover.
// Synthetic finite DOM/Store/free-read ports; no native browser/AT/Worker proof.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { fixture, documentPort, loadActual } from "./helpers/canvas-focus-repair-host.mjs";

// Resolve through the installed lit package: pnpm does not expose lit-html at
// root/node_modules/lit-html. No dependency is installed or copied into the app.
const requireHere = createRequire(import.meta.url);
const requireLit = createRequire(requireHere.resolve("lit"));
function installedRoot(name) {
  let folder = path.dirname(requireLit.resolve(name));
  for (let level = 0; level < 4; level++) {
    const manifest = path.join(folder, "package.json");
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, "utf8")).name === name) return folder;
    folder = path.dirname(folder);
  }
  assert.fail("Resolved installed package has no matching manifest: " + name);
}
const htmlRoot = installedRoot("lit-html");
const elementRoot = installedRoot("lit-element");
assert.equal(JSON.parse(fs.readFileSync(path.join(htmlRoot, "package.json"), "utf8")).version, "3.3.3");
const nodeHtml = fs.readFileSync(path.join(htmlRoot, "node/development/lit-html.js"), "utf8");
const browserHtml = fs.readFileSync(path.join(htmlRoot, "development/lit-html.js"), "utf8");
const eventMethod = source => {
  const tree = ts.createSourceFile("installed-lit-html.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const owner = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "EventPart");
  assert.ok(owner, "installed EventPart class");
  const method = owner.members.find(node => node.name?.getText(tree) === "handleEvent");
  assert.ok(method, "installed EventPart.handleEvent");
  return method.getText(tree);
};
assert.equal(eventMethod(nodeHtml), eventMethod(browserHtml), "installed Node/browser listener dispatch is byte-identical");
assert.match(eventMethod(browserHtml), /this\._\$committedValue\.call\(this\.options\?\.host \?\? this\.element, event\)/u);
const elementSource = fs.readFileSync(path.join(elementRoot, "development/lit-element.js"), "utf8");
assert.match(elementSource, /this\.renderOptions = \{ host: this \}/u);
assert.match(elementSource, /render\(value, this\.renderRoot, this\.renderOptions\)/u);
const { _$LH: { EventPart } } = await import(pathToFileURL(path.join(htmlRoot, "node/development/private-ssr-support.js")).href);
assert.equal(EventPart.prototype.handleEvent.toString(), eventMethod(nodeHtml), "invoke the actual installed implementation");
const { FormaUiPopover } = await loadActual("src/components/design-system/feedback.ts");
const { AdaptiveProposalReviewController } = await loadActual("src/components/adaptive-proposal-review.ts");

function event(type, target, extra = {}) {
  return { type, target, currentTarget: target, defaultPrevented: false, immediateStopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
    stopImmediatePropagation() { this.immediateStopped = true; },
    composedPath: () => [target], ...extra };
}

// The part registers itself with the existing finite native addEventListener
// port, then receives the event. No callback is rebound to its declaration owner.
function dispatchLit(node, host, value) {
  const handler = node.handlers[value.type];
  assert.ok(typeof handler === "function" || typeof handler?.handleEvent === "function");
  const part = new EventPart(node, value.type, ["", ""], { _$isConnected: true }, { host });
  part._$setValue(handler);
  assert.equal(node.listeners[value.type], part, "actual EventPart installed on the emitted native node");
  value.currentTarget = node;
  part.handleEvent(value);
}

function view(f) {
  const menu = f.renderer.query(f.host, "forma-ui-popover").find(node => node.attributes.class === "canvas-view-menu");
  assert.ok(menu instanceof FormaUiPopover);
  const panel = f.renderer.ownNodes(menu, "section").find(node => node.attributes.popover === "auto");
  const trigger = f.renderer.ownNodes(menu, "button").find(node => node.attributes.popovertarget === panel?.attributes.id);
  assert.ok(panel && trigger);
  assert.equal(panel.owner, menu); assert.equal(trigger.owner, menu);
  return { menu, panel, trigger };
}

function openView(f) {
  let owned = view(f);
  owned.trigger.focus();
  dispatchLit(owned.trigger, owned.menu, event("click", owned.trigger));
  // Existing finite declarative-popover default action; not browser evidence.
  owned.panel.showPopover(); f.draw(); owned = view(f);
  assert.equal(owned.panel.matches(":popover-open"), true);
  return owned;
}

function action(f, owned, kind) {
  const buttons = f.renderer.ownNodes(owned.menu, "button").filter(node => kind === "resume"
    ? node.handlers.click?.name === "#resumeProposalReview"
    : node.handlers.click?.toString().includes("#openArrangement()") && !node.handlers.click?.toString().includes("#retrieveArrangement()"));
  assert.equal(buttons.length, 1, "one actual consuming-Popover " + kind + " control");
  const button = buttons[0];
  assert.equal(button.owner, owned.menu); assert.notEqual(button.owner, f.host);
  assert.equal(button.closest("forma-ui-popover"), owned.menu);
  assert.equal(button.disabled, false);
  return button;
}

function activateViewAction(f, owned, button) {
  const wrapper = button.closest(".canvas-view-actions");
  assert.ok(wrapper?.handlers.click);
  assert.equal(wrapper.owner, owned.menu);
  assert.equal(wrapper.handlers.click.capture, true);
  const value = event("click", button);
  // Native capture precedes the target listener, including its route guard.
  dispatchLit(wrapper, owned.menu, value);
  const result = { value, targetReached: false,
    closedBeforeTarget: !owned.panel.matches(":popover-open"),
    triggerFocusedBeforeTarget: documentPort.activeElement === owned.trigger, error: null };
  if (!value.immediateStopped) {
    result.targetReached = true;
    try { dispatchLit(button, owned.menu, value); }
    catch (error) { result.error = error; }
  }
  return result;
}

function setup(t, locale) {
  // The existing one-document fixture yields exactly two Canvas cards.
  // Do not introduce receipts, planning sources, or authored application events.
  const f = fixture({ populated: true, documentCount: 1, chosen: "document-0", locale });
  documentPort.activeElement = documentPort.body;
  assert.equal(f.store.canvasProjection.get().items.length, 2);
  assert.ok(f.proposalReview instanceof AdaptiveProposalReviewController);
  assert.equal(f.proposalReview.resume, AdaptiveProposalReviewController.prototype.resume);
  t.after(() => {
    f.host.isConnected = false; f.host.disconnectedCallback();
    for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) {
      instance.isConnected = false; instance.disconnectedCallback();
    }
    f.i18n.hostDisconnected();
    assert.equal(f.canvasIntervals.size, 0);
  });
  return f;
}

const dialog = (f, className) => f.renderer.ownNodes(f.host, "dialog").find(node => node.classList.contains(className));
const stateProof = f => ({ events: JSON.stringify(f.state.events), selection: [...f.state.selected] });
function noAuthoring(f, before) {
  assert.equal(JSON.stringify(f.state.events), before.events);
  assert.deepEqual(f.state.selected, before.selection);
  assert.equal(f.state.batches.length, 0);
  assert.equal(f.proposalReview.receipt, null);
  assert.equal(f.proposalReview.handle, null);
  assert.deepEqual(f.proposalReview.originals, []);
}
function observation(t, f, locale, kind, result) {
  t.diagnostic("P8_VIEW_RECEIVER " + JSON.stringify({ locale, kind,
    consumingHost: "FormaUiPopover", eventPart: "installed-lit-html-3.3.3",
    targetReached: result.targetReached, closedBeforeTarget: result.closedBeforeTarget,
    triggerFocusedBeforeTarget: result.triggerFocusedBeforeTarget,
    error: result.error ? { name: result.error.name, message: result.error.message } : null,
    reviewVisible: f.proposalReview.visible, freeReads: f.state.requests.length,
    adaptiveDialogOpen: Boolean(dialog(f, "adaptive-proposal-dialog")?.open),
    arrangementDialogOpen: Boolean(dialog(f, "canvas-outcome-arrangement-dialog")?.open),
    finitePortsOnly: true }));
}

for (const locale of ["en", "ja"]) {
  test(locale + " Resume opens actual empty review when Lit dispatches with its consuming Popover", async t => {
    const f = setup(t, locale), before = stateProof(f), owned = openView(f), button = action(f, owned, "resume");
    button.focus();
    // Existing deterministic free-read port. This is an empty read, never a
    // forged preview, receipt, successful authoring response, or provider call.
    f.state.replies.push({ status: "none" });
    const result = activateViewAction(f, owned, button);
    for (let step = 0; step < 30 && !result.error && (!f.proposalReview.visible || f.proposalReview.busy || !dialog(f, "adaptive-proposal-dialog")?.open); step++) await f.flush();
    noAuthoring(f, before); observation(t, f, locale, "resume", result);
    assert.equal(result.closedBeforeTarget, true); assert.equal(result.triggerFocusedBeforeTarget, true);
    assert.equal(result.targetReached, true); assert.equal(result.value.immediateStopped, false);
    assert.equal(result.error, null, "the current Resume callback must retain the Canvas receiver through Popover rendering");
    assert.equal(f.proposalReview.visible, true); assert.equal(f.proposalReview.busy, false);
    assert.equal(dialog(f, "adaptive-proposal-dialog")?.open, true);
    assert.equal(f.proposalReview.notice, "adaptive.changes.none");
    assert.equal(f.proposalReview.canPreview, false); assert.equal(f.proposalReview.canApply, false);
    assert.equal(f.state.requests.length, 1);
    assert.deepEqual(f.state.requests[0], { url: "/api/context/adaptive/apply",
      body: { action: "resume", projectId: "p", documentId: "document-0", canvasId: "board-a" } });
    assert.ok(f.proposalSourceReads.length > 0);
    assert.ok(f.proposalSourceReads.every(read => read.documentId === "document-0" && read.canvasId === "board-a"));
  });

  test(locale + " existing Arrange action opens its actual dialog with the same Popover Lit receiver", async t => {
    const f = setup(t, locale), before = stateProof(f), owned = openView(f), button = action(f, owned, "arrange");
    button.focus();
    const result = activateViewAction(f, owned, button);
    await f.flush();
    noAuthoring(f, before); observation(t, f, locale, "arrange", result);
    assert.equal(result.closedBeforeTarget, true); assert.equal(result.triggerFocusedBeforeTarget, true);
    assert.equal(result.targetReached, true); assert.equal(result.error, null);
    assert.equal(dialog(f, "canvas-outcome-arrangement-dialog")?.open, true);
    assert.equal(f.proposalReview.visible, false);
    assert.equal(f.state.requests.length, 0);
  });

  for (const kind of ["resume", "arrange"]) test(locale + " route-superseded View capture prevents the " + kind + " target", async t => {
    const f = setup(t, locale), before = stateProof(f), owned = openView(f), button = action(f, owned, kind);
    button.focus();
    const desiredFocus = documentPort.activeElement;
    // Existing finite route port: route changes before the next renderer pass.
    f.route = f.store.route.get() + "?view=list";
    const result = activateViewAction(f, owned, button);
    observation(t, f, locale, "route-superseded-" + kind, result);
    assert.equal(result.targetReached, false); assert.equal(result.error, null);
    assert.equal(result.value.immediateStopped, true); assert.equal(result.value.defaultPrevented, true);
    assert.equal(result.closedBeforeTarget, true); assert.equal(result.triggerFocusedBeforeTarget, false);
    assert.equal(documentPort.activeElement, desiredFocus, "the stale action does not restore focus over current focus");
    await f.flush();
    noAuthoring(f, before);
    assert.equal(f.proposalReview.visible, false);
    assert.equal(f.renderer.query(f.host, "dialog[open]").length, 0);
    assert.equal(f.state.requests.length, 0); assert.equal(f.proposalSourceReads.length, 0);
  });
}
