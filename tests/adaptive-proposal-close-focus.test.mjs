// Permanent regressions for current-control Close and deferred focus ownership.
// Run with the project's existing no-provider deterministic test boundary.
// Complete current Canvas/Popover/controller/renderer, with the existing finite
// DOM, Store and free-read ports. No Worker, provider, physical input or AT claim.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";
import { canvasFocusFromRoute, withCanvasFocus } from "../src/canvas/routes.ts";

const fixtureURL = new URL("./canvas-calm-controls-host.test.mjs", import.meta.url);
const original = await readFile(fixtureURL, "utf8");
const tree = ts.createSourceFile(fixtureURL.pathname, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const first = tree.statements.findIndex(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === "test");
assert.ok(first > 0);
const names = ["ownedPopover", "openOwnedPopover", "organizeEvent", "runPortHandler"];
const helpers = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(helpers.length, names.length);
const declarationSource = [...tree.statements.slice(0, first), ...helpers].map(node => node.getFullText(tree)).join("\n")
  + "\nexport {fixture,openOwnedPopover,organizeEvent,runPortHandler,documentPort,loadActual};\n";
const declarationURL = new URL(fixtureURL); declarationURL.search = "?adaptive-close-focus-current-controls";
const hook = registerHooks({ load(url, context, next) {
  return url === declarationURL.href ? {format:"module",source:declarationSource,shortCircuit:true} : next(url, context);
} });
let actual;
try { actual = await import(declarationURL.href); } finally { hook.deregister(); }
const {fixture,openOwnedPopover,organizeEvent,runPortHandler,documentPort,loadActual} = actual;
const {AdaptiveProposalReviewController} = await loadActual("src/components/adaptive-proposal-review.ts");
const dialog = f => f.native("dialog", node => node.classList.contains("adaptive-proposal-dialog"));
const focusCount = f => f.trace.filter(value => value.startsWith("focus:")).length;
const counts = f => Object.fromEntries(["pointerdown","keydown","focusin"].map(type => [type,(f.listeners.get(type) ?? []).length]));
const drain = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

function setup(t, locale) {
  const network = t.mock.method(globalThis, "fetch", async () => assert.fail("No network or provider is permitted."));
  const f = fixture({populated:true,documentCount:2,chosen:"document-0",locale});
  documentPort.activeElement = documentPort.body;
  t.after(() => {
    f.host.isConnected = false; f.host.disconnectedCallback();
    for (const {instance} of f.renderer.instances.values()) if (instance.isConnected) {
      instance.isConnected = false; instance.disconnectedCallback();
    }
    f.i18n.hostDisconnected();
    assert.equal(network.mock.callCount(), 0);
  });
  return f;
}

async function openCurrentEmptyReview(f) {
  const owned = openOwnedPopover(f, "canvas-view-menu");
  const button = f.native("button", node => node.handlers.click?.name === "#resumeProposalReview");
  assert.ok(button?.isConnected && owned.panel.matches(":popover-open"));
  const wrapper = button.closest(".canvas-view-actions");
  assert.ok(wrapper?.handlers.click, "the actual View capture handler is installed");
  button.focus();
  const event = organizeEvent("click", button, {currentTarget:wrapper});
  runPortHandler(wrapper.handlers.click, wrapper.owner, event);
  assert.equal(event.immediateStopped, false);
  assert.equal(owned.panel.matches(":popover-open"), false);
  const opener = documentPort.activeElement;
  assert.equal(opener === owned.trigger, true, "native View capture returns focus before the target opens review");
  f.state.replies.push({status:"none"});
  event.currentTarget = button;
  await runPortHandler(button.handlers.click, button.owner, event);
  for (let index = 0; index < 30 && (!f.proposalReview?.visible || f.proposalReview.busy || !dialog(f)?.open); index++) await f.flush();
  assert.equal(f.proposalReview instanceof AdaptiveProposalReviewController, true);
  assert.equal(f.proposalReview.synchronize, AdaptiveProposalReviewController.prototype.synchronize);
  assert.equal(f.proposalReview.suspend, AdaptiveProposalReviewController.prototype.suspend);
  assert.equal(dialog(f)?.open, true);
  assert.equal(f.proposalReview.notice, "adaptive.changes.none");
  assert.equal(f.proposalReview.receipt, null);
  assert.equal(f.proposalReview.handle, null);
  assert.equal(f.proposalReview.canPreview, false);
  assert.equal(f.proposalReview.canApply, false);
  assert.deepEqual(f.proposalReview.originals, []);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0].url, "/api/context/adaptive/apply");
  assert.equal(f.state.requests[0].body.action, "resume");
  await drain();
  return opener;
}

function closeWithPendingRender(f) {
  const current = dialog(f);
  const button = f.native("button", node => node.closest("dialog") === current && node.parentElement?.tag === "header");
  assert.ok(button?.isConnected && current?.open);
  let resolve;
  const pending = new Promise(yes => { resolve = yes; });
  const tick = f.tick;
  f.tick = () => pending;
  button.focus();
  runPortHandler(button.handlers.click, button.owner, organizeEvent("click", button));
  f.draw();
  assert.equal(f.proposalReview.visible, false);
  assert.equal(Boolean(dialog(f)?.open), false);
  return {async settle() { resolve(true); await drain(); f.tick = tick; }};
}

const changes = ["current", "newer-focus", "route", "authority", "other-dialog", "new-presentation"];
for (const locale of ["en", "ja"]) for (const change of changes)
  test(locale + " actual empty-review Close respects " + change + " ownership", async t => {
    const f = setup(t, locale), opener = await openCurrentEmptyReview(f);
    const events = JSON.stringify(f.state.events), requests = JSON.stringify(f.state.requests), observers = counts(f);
    const route = f.store.route.get(), scope = f.proposalReview.ports.scope()?.key, presentation = f.proposalReview.presentationId;
    const pending = closeWithPendingRender(f);
    if (change === "newer-focus") {
      const next = f.native("button", node => node.classList.contains("canvas-focus-toggle"));
      assert.ok(next?.isConnected); next.focus();
      assert.equal(f.store.route.get(), route);
      assert.equal(f.proposalReview.ports.scope()?.key, scope);
      assert.equal(f.proposalReview.presentationId, presentation);
      assert.equal(f.proposalReview.receipt, null);
    } else if (change === "route") {
      assert.equal(f.host.closest("forma-shell"), null, "this Close unit retains its declared standalone host");
      await f.click("button", node => node.classList.contains("canvas-focus-toggle"));
      assert.equal(f.store.route.get(), route, "the actual standalone Focus button cannot admit navigation without a Shell");
      assert.equal(JSON.stringify(f.state.events), events);
      assert.equal(JSON.stringify(f.state.requests), requests);
      assert.equal(f.state.batches.length, 0);
      // External route interruption through the ORIGINAL finite Store port,
      // not this refused click's default or a successful navigation receipt.
      // This unit no longer claims positive Focus-button navigation.
      const externalRoute = withCanvasFocus(route, !canvasFocusFromRoute(route));
      assert.notEqual(externalRoute, route);
      f.store.setRoute(externalRoute); f.draw();
      assert.equal(f.store.route.get(), externalRoute, "the declared external route premise was applied exactly");
      t.diagnostic(JSON.stringify({routePremise:"external finite Store",standaloneFocusNavigation:"refused",routeBefore:route,routeAfter:externalRoute}));
      assert.notEqual(f.store.route.get(), route);
    } else if (change === "authority") {
      f.state.authorization = "actor-b"; f.draw();
    } else if (change === "other-dialog") {
      await f.sources();
      assert.equal(f.renderer.query(f.host,"dialog[open]").length, 1);
    } else if (change === "new-presentation") {
      f.proposalReview.reopen(); f.draw();
      assert.notEqual(f.proposalReview.presentationId, presentation);
    }
    const desired = change === "current" ? opener : documentPort.activeElement;
    const before = focusCount(f);
    await pending.settle();
    t.diagnostic(JSON.stringify({locale,change,focusPreserved:documentPort.activeElement === desired,
      delayedFocusEffects:focusCount(f)-before,expectedEffects:change === "current" ? 1 : 0,
      freeReads:f.state.requests.length,eventsUnchanged:JSON.stringify(f.state.events) === events,
      receiptIsNull:f.proposalReview.receipt === null,nativePortOnly:true}));
    assert.equal(documentPort.activeElement === desired, true, "an older Close cannot take focus from a newer current control");
    assert.equal(focusCount(f)-before, change === "current" ? 1 : 0);
    assert.equal(JSON.stringify(f.state.events), events);
    assert.equal(JSON.stringify(f.state.requests), requests);
    assert.equal(f.state.batches.length, 0);
    assert.deepEqual(counts(f), observers, "Close disposes all temporary focus observers");
  });

// Additional native-default-action controls for the same production helper.
// These three additional controls isolate the shared helper's native-close port.
// They do NOT claim physical browser behavior or a complete Canvas activation.
// The controller is the actual empty/free review, never a fabricated success.
const {closeAdaptiveProposalDialog} = await loadActual("src/components/adaptive-proposal-dialog.ts");
for (const change of ["native-return", "newer-focus-after-native-return", "native-return-then-invoker-removed"])
  test("shared Close default-action port: " + change, async t => {
    const f = setup(t, "en"), opener = await openCurrentEmptyReview(f);
    const observers = counts(f), events = JSON.stringify(f.state.events), requests = JSON.stringify(f.state.requests);
    const fallback = f.host.querySelector(".canvas-viewport,.canvas-stage-shell");
    const currentControl = f.native("button", node => node.classList.contains("canvas-focus-toggle"));
    assert.ok(fallback?.isConnected && currentControl?.isConnected && opener?.isConnected);
    let resolve;
    const updateComplete = new Promise(yes => { resolve = yes; });
    // Native boundary port, not a replacement of any production method or prototype.
    const nativeDialog = {open:true, close() { this.open=false; opener.focus(); }};
    const nativeHost = {isConnected:true, ownerDocument:documentPort, updateComplete,
      querySelector:selector => selector === ".adaptive-proposal-dialog" ? nativeDialog
        : selector === "dialog[open]" && nativeDialog.open ? nativeDialog : null};
    closeAdaptiveProposalDialog(nativeHost, f.proposalReview, opener, () => fallback);
    assert.equal(nativeDialog.open, false);
    assert.equal(documentPort.activeElement === opener, true, "native Close completed its own synchronous focus return");
    assert.equal(f.proposalReview.visible, false);
    let desired = opener;
    if (change === "newer-focus-after-native-return") { currentControl.focus(); desired=currentControl; }
    if (change === "native-return-then-invoker-removed") {
      // Explicit finite native detachment, not a fabricated authoring/source change.
      opener.isConnected=false; documentPort.activeElement=documentPort.body; desired=fallback;
    }
    const before=focusCount(f);
    resolve(true); await drain();
    t.diagnostic(JSON.stringify({change,focusPreserved:documentPort.activeElement===desired,
      delayedFocusEffects:focusCount(f)-before,sharedHelperDefaultActionPortOnly:true}));
    assert.equal(documentPort.activeElement === desired, true);
    if(change === "newer-focus-after-native-return") assert.equal(focusCount(f)-before,0);
    assert.deepEqual(counts(f), observers);
    assert.equal(JSON.stringify(f.state.events),events);
    assert.equal(JSON.stringify(f.state.requests),requests);
    assert.equal(f.proposalReview.receipt,null);
  });
