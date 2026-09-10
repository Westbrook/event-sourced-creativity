import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Controlled source tests, NOT browser/paint/Tab/Escape/AT proof. Only the named
// production methods and the real focus lease execute; no app/worker/test-family
// imports, network, generation, persistence, fixture restoration or file writes.
// Once copied to tests/, the default root is the repository. For this external
// proposal only, set FORMA_SLIDES_FOCUS_SOURCE_ROOT to the canonical checkout.
const root = process.env.FORMA_SLIDES_FOCUS_SOURCE_ROOT
  ? resolve(process.env.FORMA_SLIDES_FOCUS_SOURCE_ROOT)
  : fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(resolve(root, "package.json"));
const ts = require("typescript");
const parse = (path) => ts.createSourceFile(path, readFileSync(resolve(root, path), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const source = parse("src/components/document-artifacts.ts");
const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "DocumentArtifacts");
assert.ok(declaration, "actual DocumentArtifacts class exists");
const names = ["showSlidesViewingDialog", "showSlidesEvidence", "openArtifact", "showArtifactIntent", "syncViewerPopovers"];
const methods = names.map(name => {
  const node = declaration.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(source) === `#${name}`);
  assert.ok(node, `actual #${name} method exists`);
  return node.getText(source);
}).join("\n");
const leaseSource = parse("src/components/output-navigation-focus.ts");
const leaseNode = leaseSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "captureOutputNavigationFocus");
assert.ok(leaseNode, "actual focus lease exists");
// Rename only PrivateIdentifier AST nodes to externally supplied ports. Strings,
// selectors, guards, awaits and control flow are not rewritten or replicated.
const renamePrivate = context => {
  const visit = node => ts.isPrivateIdentifier(node)
    ? ts.factory.createIdentifier(`_${node.text.slice(1)}`)
    : ts.visitEachChild(node, visit, context);
  return node => ts.visitNode(node, visit);
};
const compiled = ts.transpileModule(`${leaseNode.getText(leaseSource).replace(/^export\s+/, "")}\nclass Subject {\n${methods}\n}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  transformers: { before: [renamePrivate] },
  reportDiagnostics: true,
});
assert.deepEqual((compiled.diagnostics ?? []).filter(value => value.category === ts.DiagnosticCategory.Error), [], "selected source parses");
const makeSubject = new Function("document", "HTMLElement", "CustomEvent", "ensureModalDialog", "documentArtifactRevision", "artifactDeliveryFor", "fetch",
  `${compiled.outputText}\nreturn { Subject, captureOutputNavigationFocus };`);
const deferred = () => {
  let resolvePromise, reject;
  const promise = new Promise((yes, no) => { resolvePromise = yes; reject = no; });
  return { promise, resolve: resolvePromise, reject };
};
class Events {
  listeners = new Map();
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, target = this) { for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ type, target }); }
  count() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0); }
}
class ElementPort extends Events {
  isConnected = true; disabled = false; attrs = new Map(); focusCalls = 0;
  constructor(owner) { super(); this.ownerDocument = owner; }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  matches(selector) { return selector === ":disabled" && this.disabled; }
  focus() { this.focusCalls++; this.ownerDocument.activeElement = this; this.ownerDocument.emit("focusin", this); }
}
function fixture(mode = "slideshow") {
  const f = { route: "/document/one", sourceCurrent: true, authorized: true, revision: 1,
    mode, ensureCalls: 0, hiddenGeometryReads: 0, updateCalls: 0, triggerClicks: 0, closeCalls: 0, dialogCloseCalls: 0, sideEffects: [] };
  const doc = new Events(); doc.defaultView = new Events(); doc.visibilityState = "visible"; doc.focused = true; doc.hasFocus = () => doc.focused;
  doc.body = new ElementPort(doc); doc.documentElement = new ElementPort(doc);
  const opener = new ElementPort(doc), header = new ElementPort(doc); doc.activeElement = opener;
  const dialog = new ElementPort(doc); dialog.open = false; dialog.modal = false;
  dialog.matches = selector => selector === ":modal" && dialog.modal;
  dialog.close = () => { if (dialog.open) { f.dialogCloseCalls++; dialog.open = false; dialog.modal = false; dialog.emit("close"); } };
  const deck = new ElementPort(doc); deck.updateComplete = Promise.resolve(); deck.closest = selector => selector === "dialog" ? dialog : null;
  const stage = new ElementPort(doc), next = new ElementPort(doc), reading = new ElementPort(doc), present = new ElementPort(doc);
  stage.setAttribute("tabindex", "-1");
  for (const target of [stage, next, reading, present]) target.getClientRects = () => {
    if (!dialog.open) f.hiddenGeometryReads++;
    return dialog.open && !f.zeroGeometry ? [{}] : [];
  };
  deck.querySelector = selector => selector === ".presentation-deck-stage" ? (f.mode !== "list" ? stage : null)
    : selector === ".presentation-deck-stage nav > button:not(:disabled)" ? (f.mode === "slideshow" ? next : null)
    : selector === ".presentation-deck-reading-toggle" ? (f.mode === "single" ? reading : null)
    : selector === ".presentation-deck-list-header > button" ? (f.mode === "list" ? present : null) : null;
  const menu = new ElementPort(doc), trigger = new ElementPort(doc), panel = new ElementPort(doc), content = new ElementPort(doc);
  menu.updateComplete = Promise.resolve(); panel.open = false; panel.matches = selector => selector === ":popover-open" && panel.open;
  trigger.click = () => { f.triggerClicks++; if (f.clickThrows) throw new Error("withheld popover"); panel.open = true; };
  menu.querySelector = selector => ({ ".ui-popover-trigger": trigger, ".ui-popover-panel": panel, ".artifact-viewer-details": content })[selector] ?? null;
  menu.close = () => { f.closeCalls++; panel.open = false; };
  f.currentDialog = dialog; f.currentDeck = deck;
  dialog.querySelector = selector => selector === "forma-presentation-deck" ? f.currentDeck : selector === ".artifact-viewer-evidence-popover" ? menu : null;
  const forbidden = () => { throw new Error("No network or write port is available in this test"); };
  const { Subject, captureOutputNavigationFocus } = makeSubject(doc, ElementPort, class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }, value => {
    f.ensureCalls++; assert.equal(value, dialog, "only the exact current dialog may open");
    const target = [stage, next, reading, present].find(element => element.getAttribute("autofocus") !== null);
    if (f.ensureThrows) throw new Error("native open rejected");
    dialog.open = true; dialog.modal = true; (target ?? header).focus(); f.afterNativeOpen?.(); return true;
  }, () => f.revision, () => ({ releaseAllowed: true }), forbidden);
  const host = new Subject();
  const artifact = { id: "slides-one", kind: "slides", title: "Harbor", documentId: "one", sequence: 1, sourceEventId: "event-one", contentRef: "retained-one" };
  const bytes = { "retained-one": "exact retained slide bytes" };
  f.binding = { content_sha256: "a".repeat(64), artifact_revision: 1 };
  const slot = get => ({ get });
  Object.assign(host, {
    isConnected: true, ownerDocument: doc, updateComplete: Promise.resolve(), source: "document", documentId: "one",
    _activeId: artifact.id, _editingId: "", _savingEdit: false, _viewerFocused: false, _nativeStoryIntentRevision: 0,
    _viewerCurrent: () => f.sourceCurrent, _viewDialog: () => f.currentDialog, _currentDeliveryBinding: () => f.binding,
    _closeViewerPopovers: () => menu.close(), _artifactBinding: async () => f.binding,
    _privateSourceCurrent: () => { const route = f.route; return () => f.sourceCurrent && f.route === route; },
    retireNativeShortStory() {}, requestUpdate() { f.updateCalls++; }, dispatchEvent() {},
    querySelector: selector => selector === ".artifact-viewer-evidence-popover" ? menu : null,
    store: { route: slot(() => f.route), events: slot(() => []), content: slot(() => bytes),
      projection: slot(() => ({ libraryArtifacts: [artifact] })), session: slot(() => ({ projectContext: null })),
      captureAuthorizationScope: () => ({ key: "owned-scope" }), authorizationScopeActive: () => f.authorized,
      ensurePrivateContent: forbidden, hot: forbidden, toast: forbidden, ui: { instrumentation: false } },
  });
  Object.assign(f, { host, doc, opener, header, dialog, deck, stage, next, reading, present, menu, trigger, panel, content, artifact, bytes,
    capture: () => captureOutputNavigationFocus(doc) });
  return f;
}
async function view(f) {
  const lease = f.capture();
  try { return await f.host._showSlidesViewingDialog(f.dialog, () => f.sourceCurrent, lease); }
  finally { lease.dispose(); }
}
function noLeaseLeaks(f) { assert.equal(f.doc.count(), 0); assert.equal(f.doc.defaultView.count(), 0); }

test("closed dialog has no target boxes: actual helper opens natively before geometry and cleans autofocus", async () => {
  const f = fixture(); assert.equal(f.stage.getClientRects().length, 0); f.hiddenGeometryReads = 0;
  assert.equal(await view(f), true); assert.equal(f.ensureCalls, 1); assert.equal(f.hiddenGeometryReads, 0);
  assert.equal(f.doc.activeElement, f.stage); assert.equal(f.stage.focusCalls, 1); assert.equal(f.next.focusCalls, 0); assert.equal(f.dialog.matches(":modal"), true);
  assert.equal(f.stage.getAttribute("autofocus"), null); assert.equal(f.stage.getAttribute("tabindex"), "-1"); noLeaseLeaks(f);
});
for (const [mode, expected] of [["single", "stage"], ["list", "present"]]) test(`${mode} uses its existing stable target without changing remembered mode`, async () => {
  const f = fixture(mode); assert.equal(await view(f), true); assert.equal(f.doc.activeElement, f[expected]); assert.equal(f.mode, mode); noLeaseLeaks(f);
});
for (const nextDisabled of [false, true]) test(`initial content focus is independent of Next being ${nextDisabled ? "disabled" : "enabled"}`, async () => {
  const f = fixture(); f.next.disabled = nextDisabled;
  assert.equal(await view(f), true); assert.equal(f.doc.activeElement, f.stage); assert.equal(f.next.focusCalls, 0);
  assert.equal(f.stage.matches(":disabled"), false); assert.equal(f.stage.getAttribute("tabindex"), "-1"); noLeaseLeaks(f);
});
test("remembered reading posture uses the same content target without activating its toggle", async () => {
  const f = fixture("reading"); assert.equal(await view(f), true); assert.equal(f.doc.activeElement, f.stage);
  assert.equal(f.reading.focusCalls, 0); assert.equal(f.mode, "reading"); noLeaseLeaks(f);
});
test("list's disabled Present target refuses native opening", async () => {
  const f = fixture("list"); f.present.disabled = true;
  assert.equal(await view(f), false); assert.equal(f.ensureCalls, 0); assert.equal(f.present.getAttribute("autofocus"), null); noLeaseLeaks(f);
});
for (const throws of [false, true]) test(`autofocus prior value restored when native opening ${throws ? "throws" : "succeeds"}`, async () => {
  const f = fixture(); f.stage.setAttribute("autofocus", "original"); f.ensureThrows = throws;
  assert.equal(await view(f), !throws); assert.equal(f.stage.getAttribute("autofocus"), "original"); noLeaseLeaks(f);
});
test("rejected deck render never opens or leaves autofocus", async () => {
  const f = fixture(), gate = deferred(); f.deck.updateComplete = gate.promise;
  const pending = view(f); gate.reject(new Error("render rejected"));
  assert.equal(await pending, false); assert.equal(f.ensureCalls, 0); assert.equal(f.stage.getAttribute("autofocus"), null); noLeaseLeaks(f);
});
const interruptedView = {
  key: f => f.doc.emit("keydown"), pointer: f => f.doc.emit("pointerdown"),
  focus: f => f.header.focus(), route: f => { f.route = "/document/other"; },
  deck: f => { f.currentDeck = new ElementPort(f.doc); }, dialog: f => { f.currentDialog = new ElementPort(f.doc); },
  source: f => { f.sourceCurrent = false; }, edit: f => { f.host._editingId = f.artifact.id; },
  detached: f => { f.deck.isConnected = false; }, hidden: f => { f.doc.visibilityState = "hidden"; },
};
for (const [name, interrupt] of Object.entries(interruptedView)) test(`pending exact deck refuses after ${name} interruption`, async () => {
  const f = fixture(), gate = deferred(); f.deck.updateComplete = gate.promise;
  const pending = view(f); interrupt(f); const afterMove = f.doc.activeElement; gate.resolve();
  assert.equal(await pending, false); assert.equal(f.ensureCalls, 0); assert.equal(f.doc.activeElement, afterMove);
  assert.equal(f.stage.getAttribute("autofocus"), null); noLeaseLeaks(f);
});

test("actual ordinary-open wrapper focuses content and retires lease while preserving close return", async () => {
  const f = fixture(); assert.equal(await f.host._openArtifact(f.artifact), true);
  assert.equal(f.doc.activeElement, f.stage); assert.equal(f.host._viewerOpening, false); assert.equal(f.stage.getAttribute("autofocus"), null); noLeaseLeaks(f);
  f.dialog.close(); assert.equal(f.doc.activeElement, f.opener); assert.equal(f.opener.focusCalls, 1);
});
// These ports test cleanup/identity guards, not browser-native close focus policy.
// In particular, no stub pretends that removing `open` closes the modal top layer.
for (const [name, invalidate] of Object.entries({
  geometry: f => { f.zeroGeometry = true; },
  movedFocus: f => f.header.focus(),
  route: f => { f.route = "/document/other"; },
  source: f => { f.sourceCurrent = false; },
  auth: f => { f.authorized = false; },
})) test(`post-native-open ${name} failure closes only the still-owned modal before clearing state`, async () => {
  const f = fixture(); let afterMove;
  f.afterNativeOpen = () => { invalidate(f); afterMove = f.doc.activeElement; };
  assert.equal(await f.host._openArtifact(f.artifact), false);
  assert.equal(f.ensureCalls, 1); assert.equal(f.dialogCloseCalls, 1);
  assert.equal(f.dialog.open, false); assert.equal(f.dialog.matches(":modal"), false);
  assert.equal(f.doc.activeElement, afterMove); assert.equal(f.opener.focusCalls, 0, "failed open does not invoke the old manual return-focus listener");
  assert.equal(f.dialog.count(), 0); assert.equal(f.stage.getAttribute("autofocus"), null);
  assert.equal(f.host._activeId, ""); assert.equal(f.host._viewerCurrent, null); assert.equal(f.host._viewerOpening, false); noLeaseLeaks(f);
});
for (const replacement of ["dialog", "owner"]) test(`post-native-open failure never closes a replacement ${replacement} or manually steals its focus`, async () => {
  const f = fixture(), replacementControl = new ElementPort(f.doc), replacementOwner = () => true;
  const replacementDialog = new ElementPort(f.doc); replacementDialog.open = true;
  let replacementCloses = 0; replacementDialog.close = () => { replacementCloses++; };
  f.afterNativeOpen = () => {
    if (replacement === "dialog") f.currentDialog = replacementDialog;
    else { f.host._viewerCurrent = replacementOwner; f.host._viewerOpening = false; f.host._activeId = "replacement"; }
    replacementControl.focus();
  };
  assert.equal(await f.host._openArtifact(f.artifact), false);
  assert.equal(f.dialogCloseCalls, 0); assert.equal(replacementCloses, 0); assert.equal(replacementDialog.open, true);
  assert.equal(f.doc.activeElement, replacementControl); assert.equal(f.opener.focusCalls, 0); assert.equal(f.dialog.count(), 0);
  assert.equal(f.stage.getAttribute("autofocus"), null);
  if (replacement === "owner") { assert.equal(f.host._viewerCurrent, replacementOwner); assert.equal(f.host._activeId, "replacement"); }
  noLeaseLeaks(f);
});
const interruptedOpening = {
  key: f => f.doc.emit("keydown"), pointer: f => f.doc.emit("pointerdown"),
  focus: f => f.header.focus(), blur: f => f.doc.defaultView.emit("blur"),
  hide: f => { f.doc.visibilityState = "hidden"; f.doc.emit("visibilitychange"); },
  source: f => { f.sourceCurrent = false; }, auth: f => { f.authorized = false; },
  route: f => { f.route = "/document/other"; }, revision: f => { f.revision++; },
  bytes: f => { f.bytes["retained-one"] = "changed bytes"; },
};
for (const [name, interrupt] of Object.entries(interruptedOpening)) test(`ordinary-open guard cancels ${name} during binding and clears owned opening state`, async () => {
  const f = fixture(), gate = deferred(); f.host._artifactBinding = () => gate.promise;
  const pending = f.host._openArtifact(f.artifact); assert.ok(f.doc.count() > 0);
  interrupt(f); const afterMove = f.doc.activeElement; gate.resolve(f.binding);
  assert.equal(await pending, false); assert.equal(f.ensureCalls, 0); assert.equal(f.doc.activeElement, afterMove);
  assert.equal(f.host._activeId, ""); assert.equal(f.host._viewerCurrent, null); assert.equal(f.host._viewerOpening, false);
  assert.equal(f.host._viewerReturnFocus, undefined); assert.equal(f.host._deliveryBinding, null); noLeaseLeaks(f);
});
test("rejected private binding propagates but always cleans the ordinary-open lease/state", async () => {
  const f = fixture(); f.host._artifactBinding = async () => { throw new Error("binding unavailable"); };
  await assert.rejects(f.host._openArtifact(f.artifact), /binding unavailable/);
  assert.equal(f.ensureCalls, 0); assert.equal(f.host._viewerOpening, false); assert.equal(f.host._activeId, ""); noLeaseLeaks(f);
});
for (const intent of ["inspect", "review", "export"]) test(`explicit ${intent} opening retains its separate intent, never ordinary Slides autofocus`, async () => {
  const f = fixture(), calls = []; f.host._showArtifactIntent = async (artifact, value) => { calls.push([artifact, value]); return true; };
  assert.equal(await f.host._openArtifact(f.artifact, () => true, 1, { intent }), true);
  assert.deepEqual(calls, [[f.artifact, intent]]); assert.equal(f.doc.activeElement, f.header); assert.equal(f.stage.focusCalls, 0); assert.equal(f.next.focusCalls, 0); noLeaseLeaks(f);
});
test("non-Slides missing dialog preserves legacy clearing without taking the new focus path", async () => {
  const f = fixture(); f.artifact.kind = "short_story"; f.currentDialog = null;
  assert.equal(await f.host._openArtifact(f.artifact), false); assert.equal(f.host._viewerOpening, false); assert.equal(f.ensureCalls, 0); noLeaseLeaks(f);
});

test("explicit inspect dispatch opens native evidence with one final lease-owned focus transfer", async () => {
  const f = fixture(); f.dialog.open = true; f.dialog.modal = true; f.host._viewerFocused = true;
  assert.equal(await f.host._showArtifactIntent(f.artifact, "inspect"), true);
  assert.equal(f.host._viewerFocused, false); assert.equal(f.triggerClicks, 1); assert.equal(f.trigger.focusCalls, 0);
  assert.equal(f.content.focusCalls, 1); assert.equal(f.doc.activeElement, f.content); assert.equal(f.panel.open, true); assert.equal(f.ensureCalls, 0); noLeaseLeaks(f);
});
const interruptedEvidence = {
  key: f => f.doc.emit("keydown"), focus: f => f.header.focus(), route: f => { f.route = "/document/other"; },
  binding: f => { f.binding = { ...f.binding }; }, viewer: f => { f.host._viewerCurrent = () => true; },
  selection: f => { f.host._activeId = "another"; }, closed: f => { f.dialog.open = false; }, detached: f => { f.menu.isConnected = false; },
};
for (const [name, interrupt] of Object.entries(interruptedEvidence)) test(`explicit evidence cancels ${name} while the actual menu render is pending`, async () => {
  const f = fixture(), gate = deferred(); f.dialog.open = true; f.menu.updateComplete = gate.promise;
  const pending = f.host._showSlidesEvidence(f.artifact);
  await Promise.resolve(); interrupt(f); const afterMove = f.doc.activeElement; gate.resolve();
  assert.equal(await pending, false); assert.equal(f.triggerClicks, 0); assert.equal(f.content.focusCalls, 0); assert.equal(f.doc.activeElement, afterMove); noLeaseLeaks(f);
});
for (const failure of ["render", "click", "focus"]) test(`explicit evidence cleans lease after ${failure} exception`, async () => {
  const f = fixture(), gate = deferred(); f.dialog.open = true;
  if (failure === "render") f.menu.updateComplete = gate.promise;
  if (failure === "click") f.clickThrows = true;
  if (failure === "focus") f.content.focus = () => { throw new Error("focus rejected"); };
  const pending = f.host._showSlidesEvidence(f.artifact);
  if (failure === "render") { await Promise.resolve(); gate.reject(new Error("render rejected")); }
  assert.equal(await pending, false); noLeaseLeaks(f);
});
for (const mode of ["focus", "edit"]) test(`current evidence popover closes on ${mode}, even with unchanged route/source scope`, () => {
  const f = fixture(); f.host._syncViewerPopovers(); f.closeCalls = 0; f.panel.open = true;
  if (mode === "focus") f.host._viewerFocused = true; else f.host._editingId = f.artifact.id;
  f.host._syncViewerPopovers(); assert.equal(f.closeCalls, 1); assert.equal(f.panel.open, false);
});
