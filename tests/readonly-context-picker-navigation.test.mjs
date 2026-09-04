import assert from "node:assert/strict";
import test from "node:test";
import { creativeEditorCommandPage } from "./helpers/creative-editor-command-fixture.mjs";
import { registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { libraryBlockEditorFromRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";

// Complete existing Shell/Editor/Store/native fixture and real isolated Worker.
// The opt-in source is a genuine separate project before the accounting floor;
// no Store projection, permission, app method or response is substituted.
const options = { concurrency: false, timeout: 120_000 };
const plain = { "item-type": "direction", "item-intent": "include", copy: "The keeper checks the harbor.", strength: "lead" };
const classed = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
const inside = (node, ancestor) => { for (let at = node; at; at = at.parent) if (at === ancestor) return true; return false; };

async function openEmptyPicker(x, mode) {
  const { f, h } = x, route = h.store.route.get(), requests = h.requests.length;
  const trigger = f.find("button", node => node.owner === mode && classed(node, "context-set-trigger"));
  assert.ok(trigger.port.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port);
  await f.act(trigger, "click", { button: 0 });
  let tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  const choices = tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && node.component?.isConnected && !node.hiddenBy && inside(node, dialogs[0]));
  assert.equal(choices.length, 2); assert.deepEqual(choices.map(node => node.component.value), ["create", "reuse"]);
  const reuse = choices.find(node => node.component.value === "reuse").component;
  const button = f.find("button", node => node.owner === reuse && node.attributes["data-choice-value"] === "reuse");
  assert.equal(reuse.closest("forma-studio-mode-nav"), mode); assert.equal(button.port.matches(":disabled"), false);
  const trace = f.trace.length; f.native.emit("pointerdown", button.port); f.native.focus(button.port);
  await f.act(button, "click", { button: 0 }); await x.settle();
  assert.ok(f.trace.slice(trace).includes("event:forma-action"), "Actual native choice emitted its existing semantic action");
  tree = f.tree(); dialogs = tree.visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  assert.equal(tree.visible("div").filter(node => node.owner === mode && classed(node, "context-set-picker-empty") && inside(node, dialogs[0])).length, 1);
  assert.equal(tree.visible("input").filter(node => inside(node, dialogs[0])).length, 0);
  assert.equal(tree.visible("textarea").filter(node => inside(node, dialogs[0])).length, 0);
  assert.equal(h.store.route.get(), route); assert.equal(h.requests.length, requests, "Read-only picker setup has no destination request");
  return dialogs[0];
}

for (const [state, locale] of [["clean", "en"], ["raw", "ja"]])
test("C ordinary empty reusable picker keeps sibling work / " + state + " / " + locale, options, async t => {
  const x = await creativeEditorCommandPage(t, locale, { emptyReusableContext: true }), { f, h, owner, native } = x;
  await registerCalmFullPageComponents(f, ["forma-library", "forma-library-block-editor", "forma-ui-choice-card"]); await x.settle();
  const projection = h.store.projection.get();
  assert.equal(projection.projectId, "empty-reusable-context-project");
  assert.equal(projection.documentId, "empty-reusable-context-document");
  assert.deepEqual(projection.libraryBlocks.map(block => block.id), [x.selected.id]);
  assert.equal(x.selected.scope, "document"); assert.deepEqual(projection.libraryArtifacts, []);
  assert.equal(projection.libraryOutputs.some(output => output.mediaUrl && !output.discarded), false);
  const modes = f.components().filter(element => element.tag === "forma-studio-mode-nav" && element.store === h.store);
  assert.equal(modes.length, 1); const mode = modes[0];
  assert.ok(mode.isConnected); assert.equal(mode.closest("forma-creative-editor"), owner);
  assert.equal(mode.closest("forma-shell"), f.host); assert.ok(f.host.contains(mode));
  assert.deepEqual(native.raw(), plain);
  const raw = { ...plain, copy: "  Unsent picker sibling B — 未保存\n  " };
  if (state === "raw") { assert.deepEqual(native.change({ copy: raw.copy }), raw); await f.settle(); }
  const originalForm = native.current().form;
  await openEmptyPicker(x, mode);
  const activate = async () => {
    const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog"));
    assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
    const links = tree.visible("a").filter(node => node.owner === mode && node.attributes.href === "/library/blocks/editor/new" && inside(node, dialogs[0]));
    assert.equal(links.length, 1); const link = links[0];
    assert.ok(link.port.isConnected && f.renderer.nodes.includes(link.port)); assert.equal(link.port.matches(":disabled"), false);
    f.native.emit("pointerdown", link.port); f.native.focus(link.port);
    const gesture = { focus: f.native.nativeFocus.length, scroll: f.native.nativeScroll.length, trace: f.trace.length };
    await f.act(link, "click", { button: 0, defaultPrevented: false }); await x.settle(); return gesture;
  };
  const before = await x.snapshot(), gesture = await activate(); await x.safety(before);
  t.diagnostic("C_READONLY_PICKER_DEPARTURE " + JSON.stringify({ state, locale, originalRoute: before.route, actualRoute: h.store.route.get(),
    originalEditorConnected: owner.isConnected, attributableRequests: h.requests.slice(before.requests).map(row => ({ method: row.init.method ?? "GET", url: row.url })),
    exactSourceHistoryReceiptsFiscalUnchanged: true, evidence: "actual empty-source project/Editor/choice/link/Store/Worker; no physical, provider or review proof" }));
  if (state === "raw") {
    assert.equal(h.store.route.get(), before.route, "A read-only picker cannot authorize discarding its sibling Editor draft");
    assert.equal(h.location.pathname + h.location.search + h.location.hash, before.route);
    assert.ok(owner.isConnected && mode.isConnected); assert.equal(native.current().form, originalForm); assert.deepEqual(native.raw(), raw);
    assert.equal(h.requests.length, before.requests); assert.equal(f.native.nativeScroll.length, gesture.scroll);
    assert.equal(f.native.nativeFocus.slice(gesture.focus).some(row => row.node.attributes?.id === "main-content"), false);
    const current = f.tree().visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog"));
    assert.equal(current.length, 1); assert.equal(current[0].port.open, true, "Refusal leaves the exact current picker presentation available");
    assert.equal(f.trace.slice(gesture.trace).some(value => value === "close:modal context-set-picker-dialog"), false,
      "Admission cannot be obtained by first closing its own picker");
    await f.act(current[0], "cancel", { cancelable: true }); await x.settle();
    assert.equal(f.tree().visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog")).length, 0);
    assert.deepEqual(native.raw(), raw, "Explicit picker Cancel does not consume sibling text");
    assert.deepEqual(await native.escape(), plain); assert.equal(native.current().form, originalForm);
    await openEmptyPicker(x, mode); const resolved = await x.snapshot(); await activate(); await x.safety(resolved);
  }
  const destination = withProjectTaskDocumentInRoute("/library/blocks/editor/new", h.worker.documentId, before.route);
  assert.equal(h.store.route.get(), destination); assert.equal(h.location.pathname + h.location.search + h.location.hash, destination);
  assert.deepEqual(libraryBlockEditorFromRoute(destination), { blockId: null });
  assert.equal(owner.isConnected, false); assert.equal(mode.isConnected, false); assert.equal(originalForm.isConnected, false);
  const editors = f.components().filter(element => element.tag === "forma-library-block-editor" && element.store === h.store);
  assert.equal(editors.length, 1); assert.ok(editors[0].isConnected); assert.equal(editors[0].blockId, null);
  assert.equal(f.tree().visible("dialog").filter(node => classed(node, "context-set-picker-dialog")).length, 0);
  assert.equal(h.store.ui.commandOpen, false); await x.safety(before);
});

// E11 copy only: the unchanged actual Shell/Editor/Store/isolated-Worker
// empty-project fixture reaches both current picker paragraphs. No artifact is
// injected, copied or generated; Audio support is a separate source observation.
// All original cases, declarations and native helpers above remain unchanged.
const E11_STUDIO_REUSE_COPY = {
  "en": {
    "subtitle": "Reuse a creative decision or a previous project output. Everything remains editable in this document.",
    "emptyHelp": "Create a reusable decision or generate a project output to reuse here."
  },
  "fr": {
    "subtitle": "Réutilisez une décision créative ou une création précédente du projet. Tout reste modifiable dans ce document.",
    "emptyHelp": "Créez une décision réutilisable ou générez une création du projet à réutiliser ici."
  },
  "ar": {
    "subtitle": "أعِد استخدام قرار إبداعي أو مخرج سابق للمشروع. يظل كل شيء قابلًا للتعديل في هذا المستند.",
    "emptyHelp": "أنشئ قرارًا قابلًا لإعادة الاستخدام أو ولّد مخرجًا للمشروع لإعادة استخدامه هنا."
  },
  "ja": {
    "subtitle": "クリエイティブな決定や、プロジェクトの以前の成果物を再利用できます。このドキュメント内のすべての内容を引き続き編集できます。",
    "emptyHelp": "再利用可能な決定を作成するか、ここで再利用するプロジェクトの成果物を生成しましょう。"
  }
};

for (const [locale, expected] of Object.entries(E11_STUDIO_REUSE_COPY))
test("E11 Studio reusable-context guidance is format-neutral without dispatch / " + locale, options, async t => {
  const x = await creativeEditorCommandPage(t, locale, { emptyReusableContext: true }), { f, h, owner, native } = x;
  await registerCalmFullPageComponents(f, ["forma-library", "forma-library-block-editor", "forma-ui-choice-card"]); await x.settle();
  assert.equal(f.i18n.locale, locale);
  const projection = h.store.projection.get();
  assert.equal(projection.projectId, "empty-reusable-context-project");
  assert.equal(projection.documentId, "empty-reusable-context-document");
  assert.deepEqual(projection.libraryBlocks.map(block => block.id), [x.selected.id]);
  assert.equal(x.selected.scope, "document"); assert.deepEqual(projection.libraryArtifacts, []);
  assert.equal(projection.libraryOutputs.some(output => output.mediaUrl && !output.discarded), false);
  const modes = f.components().filter(element => element.tag === "forma-studio-mode-nav" && element.store === h.store);
  assert.equal(modes.length, 1); const mode = modes[0];
  assert.ok(mode.isConnected && owner.isConnected); assert.equal(mode.closest("forma-creative-editor"), owner);
  assert.equal(mode.closest("forma-shell"), f.host); assert.ok(f.host.contains(mode)); assert.equal(mode.i18n.locale, locale);
  const originalForm = native.current().form;
  const raw = { ...plain, copy: "  Unsent reuse guidance " + locale + " — العربية 日本語\n  " };
  assert.deepEqual(native.change({ copy: raw.copy }), raw); await x.settle();
  const before = await x.snapshot();
  const acknowledgementsOwner = { authorizationKey: before.authority.key, actorUserId: h.store.session.get().user.userId,
    projectId: projection.projectId, sourceGeneration: before.source.generation };
  const ledger = {
    events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), content: JSON.stringify(h.store.content.get()),
    blocks: JSON.stringify(projection.libraryBlocks), artifacts: JSON.stringify(projection.libraryArtifacts),
    outputs: JSON.stringify(projection.libraryOutputs),
    acknowledgements: structuredClone(h.store.eventWriteAcknowledgments(acknowledgementsOwner)),
  };
  await openEmptyPicker(x, mode);
  const tree = f.tree();
  const dialogs = tree.visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog"));
  assert.equal(dialogs.length, 1); const dialog = dialogs[0]; assert.equal(dialog.port.open, true);
  const headers = tree.visible("header").filter(node => node.owner === mode && inside(node, dialog));
  assert.equal(headers.length, 1);
  const subtitles = tree.visible("p").filter(node => node.owner === mode && inside(node, headers[0]));
  assert.equal(subtitles.length, 1);
  const empty = tree.visible("div").filter(node => node.owner === mode && classed(node, "context-set-picker-empty") && inside(node, dialog));
  assert.equal(empty.length, 1);
  const helps = tree.visible("p").filter(node => node.owner === mode && inside(node, empty[0]));
  assert.equal(helps.length, 1);
  const destinations = tree.visible("a").filter(node => node.owner === mode && inside(node, empty[0]));
  assert.equal(destinations.length, 1); assert.equal(destinations[0].attributes.href, "/library/blocks/editor/new");
  assert.ok(destinations[0].port.isConnected); assert.equal(destinations[0].port.matches(":disabled"), false);
  const actual = { subtitle: subtitles[0].text, emptyHelp: helps[0].text };
  assert.ok(actual.subtitle.length > 0 && actual.emptyHelp.length > 0);
  await x.safety(before);
  assert.equal(h.store.route.get(), before.route); assert.equal(h.location.pathname + h.location.search + h.location.hash, before.route);
  assert.equal(native.current().form, originalForm); assert.deepEqual(native.raw(), raw);
  // Reacquire the current dialog after native.raw()'s real fixture draw, never a stale child port.
  const current = f.tree().visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog"));
  assert.equal(current.length, 1); assert.equal(current[0].port.open, true);
  await f.act(current[0], "cancel", { cancelable: true }); await x.settle();
  assert.equal(f.tree().visible("dialog").filter(node => node.owner === mode && classed(node, "context-set-picker-dialog")).length, 0);
  assert.ok(owner.isConnected && mode.isConnected); assert.equal(native.current().form, originalForm);
  assert.deepEqual(native.raw(), raw, "Picker Cancel preserves the exact unsent sibling draft");
  assert.deepEqual(await native.escape(), plain, "Only the existing explicit Editor Escape resets this local draft");
  assert.equal(native.current().form, originalForm); await x.settle(); await x.safety(before);
  assert.equal(h.store.route.get(), before.route); assert.equal(h.location.pathname + h.location.search + h.location.hash, before.route);
  assert.equal(h.requests.length, before.requests, "Read-only opening, inspection and explicit local cleanup send no request");
  assert.equal(JSON.stringify(h.store.events.get()), ledger.events); assert.equal(h.store.head.get(), ledger.head);
  assert.equal(JSON.stringify(h.store.content.get()), ledger.content);
  const after = h.store.projection.get();
  assert.equal(JSON.stringify(after.libraryBlocks), ledger.blocks); assert.equal(JSON.stringify(after.libraryArtifacts), ledger.artifacts);
  assert.equal(JSON.stringify(after.libraryOutputs), ledger.outputs);
  assert.deepEqual(h.store.eventWriteAcknowledgments(acknowledgementsOwner), ledger.acknowledgements);
  assert.equal(globalThis.fetch.mock.callCount(), 0, "No swallowed live/provider request");
  t.diagnostic("E11_STUDIO_REUSE_COPY " + JSON.stringify({ locale, actual,
    originalSourceHistoryReceiptsAndFiscalStateUnchanged: true, rawRetainedBeforeExplicitEscape: true,
    evidence: "actual empty-project Shell/Editor/native choice/Studio paragraphs; no audio-copy, browser geometry or AT proof" }));
  assert.deepEqual(actual, expected, "Both current Studio clauses describe reusable project outputs without an incomplete format list");
});


import { calmFullPageNativePorts as e11KeyPorts } from "./helpers/calm-full-page-fixture.mjs";

// One finite event-port regression. The fixture's stock act/emit helpers do not
// bubble. Observe its actual registrations without replacing any app callback,
// retain document/window capture identity, and route the current emitted path.
// This does not model native key dispatch, a UA cancel default or dialog return.
function observeE11PickerKeyPorts(t) {
  const { documentPort, windowPort } = e11KeyPorts;
  const original = { documentAdd: documentPort.addEventListener, documentRemove: documentPort.removeEventListener,
    windowAdd: windowPort.addEventListener, windowRemove: windowPort.removeEventListener };
  const registrations = []; let forwardingDocument = 0;
  const capture = options => typeof options === "boolean" ? options : Boolean(options?.capture);
  const record = (target, add, [type, callback, options]) => {
    if (type !== "keydown") return;
    const current = registrations.find(row => row.live && row.target === target && row.callback === callback && row.capture === capture(options));
    if (add && !current) registrations.push({ target, callback, capture: capture(options), options, live: true });
    if (!add && current) current.live = false;
  };
  windowPort.addEventListener = function (...args) {
    if (!forwardingDocument) record("window", true, args);
    return original.windowAdd.apply(this, args);
  };
  windowPort.removeEventListener = function (...args) {
    if (!forwardingDocument) record("window", false, args);
    return original.windowRemove.apply(this, args);
  };
  documentPort.addEventListener = function (...args) {
    record("document", true, args); forwardingDocument++;
    try { return original.documentAdd.apply(this, args); } finally { forwardingDocument--; }
  };
  documentPort.removeEventListener = function (...args) {
    record("document", false, args); forwardingDocument++;
    try { return original.documentRemove.apply(this, args); } finally { forwardingDocument--; }
  };
  t.after(() => {
    documentPort.addEventListener = original.documentAdd; documentPort.removeEventListener = original.documentRemove;
    windowPort.addEventListener = original.windowAdd; windowPort.removeEventListener = original.windowRemove;
  });
  return { registrations, dispatch(f, target, key, isComposing = false) {
    assert.ok(target.port?.isConnected && !target.hiddenBy && f.renderer.nodes.includes(target.port));
    const ancestors = []; for (let at = target; at; at = at.parent) ancestors.push(at);
    const node = row => row.port ?? row.component ?? (row.tag === "#root" ? row.owner : null);
    assert.ok(ancestors.some(row => node(row) === f.host), "current emitted ancestry reaches the original Shell");
    const path = ancestors.map(node).filter(Boolean).concat(f.native.document, windowPort);
    let stopped = false, immediate = false, stops = 0, prevents = 0, windowBubbles = 0, documentCaptures = 0;
    const event = { type: "keydown", key, isComposing, bubbles: true, cancelable: true, defaultPrevented: false,
      target: target.port, currentTarget: null, eventPhase: 0, composedPath: () => [...path],
      preventDefault() { prevents++; this.defaultPrevented = true; },
      stopPropagation() { stops++; stopped = true; },
      stopImmediatePropagation() { stops++; stopped = true; immediate = true; } };
    const invoke = (callback, owner) => typeof callback === "function" ? callback.call(owner, event) : callback.handleEvent(event);
    const deliver = (targetName, capturing) => {
      event.currentTarget = targetName === "document" ? f.native.document : windowPort;
      event.eventPhase = capturing ? 1 : 3;
      for (const row of registrations.filter(row => row.live && row.target === targetName && row.capture === capturing)) {
        if (!row.live || immediate) continue;
        assert.ok(!row.options?.once && !row.options?.signal, "this finite route has no once/signal registration semantics");
        if (targetName === "document" && capturing) documentCaptures++;
        if (targetName === "window" && !capturing) windowBubbles++;
        invoke(row.callback, event.currentTarget);
      }
    };
    deliver("window", true); if (!stopped) deliver("document", true);
    for (const row of ancestors) {
      if (stopped) break;
      const callback = row.handlers?.keydown;
      if (!callback) continue;
      assert.equal(Boolean(callback.capture), false, "current emitted ancestry uses ordinary keydown EventParts");
      event.currentTarget = node(row); event.eventPhase = row === target ? 2 : 3;
      invoke(callback, row.owner);
    }
    if (!stopped) deliver("document", false); if (!stopped) deliver("window", false);
    event.currentTarget = null; event.eventPhase = 0;
    return { stopped, stops, prevents, defaultPrevented: event.defaultPrevented, windowBubbles, documentCaptures };
  } };
}

test("E11 Studio picker Escape isolates the real Shell consumer in finite event ports", options, async t => {
  const keys = observeE11PickerKeyPorts(t);
  const x = await creativeEditorCommandPage(t, "en", { emptyReusableContext: true }), { f, h, owner, native } = x;
  await registerCalmFullPageComponents(f, ["forma-library", "forma-library-block-editor", "forma-ui-choice-card"]); await x.settle();
  assert.ok(f.host instanceof f.modules.get("src/components/forma-shell.ts").FormaShell);
  assert.equal(h.store.projection.get().projectId, "empty-reusable-context-project");
  assert.equal(h.store.projection.get().documentId, "empty-reusable-context-document");
  const modes = f.components().filter(element => element.tag === "forma-studio-mode-nav" && element.store === h.store);
  assert.equal(modes.length, 1); const mode = modes[0];
  assert.equal(mode.closest("forma-creative-editor"), owner); assert.equal(mode.closest("forma-shell"), f.host);
  assert.ok(keys.registrations.filter(row => row.live && row.target === "window" && !row.capture).length >= 2,
    "actual Shell and Studio connected callbacks registered their original Window key listeners");
  const raw = { ...plain, copy: "  Unsent Escape boundary — العربية 日本語\n  " };
  assert.deepEqual(native.change({ copy: raw.copy }), raw); await x.settle();
  const originalForm = native.current().form, before = await x.snapshot();
  const patchUi = h.store.patchUi;
  let notifications = 0; const unsubscribe = h.store.subscribe(() => { notifications++; }); t.after(unsubscribe);
  await openEmptyPicker(x, mode);
  assert.equal(h.store.planningConsent.get(), null); assert.equal(h.store.ui.commandOpen, false);
  assert.equal(h.store.ui.impersonationConfirmOpen, false);
  // Contained rows must share one wrapper tree; each f.find() constructs a new tree.
  const pickerTree = f.tree();
  const dialogs = pickerTree.visible("dialog").filter(row => row.owner === mode && classed(row, "context-set-picker-dialog"));
  assert.equal(dialogs.length, 1); const dialog = dialogs[0];
  const links = pickerTree.visible("a").filter(row => row.owner === mode && row.attributes.href === "/library/blocks/editor/new" && inside(row, dialog));
  assert.equal(links.length, 1); const link = links[0];
  f.native.focus(link.port);
  const observed = [];
  for (const [key, isComposing] of [["Escape", false], ["Escape", true], ["ArrowRight", false]]) {
    const count = notifications;
    const result = keys.dispatch(f, link, key, isComposing);
    observed.push({ key, isComposing, ...result, notifications: notifications - count });
    assert.equal(dialog.port.open, true, "finite key routing neither fabricates cancel nor manually closes the dialog");
  }
  assert.equal(observed[0].notifications, 0,
    "picker Escape must not reach Shell's unconditional patchUi/notify even when UI flags were already false");
  assert.deepEqual({ stops: observed[0].stops, prevents: observed[0].prevents, windowBubbles: observed[0].windowBubbles },
    { stops: 1, prevents: 0, windowBubbles: 0 });
  assert.equal(observed[0].defaultPrevented, false);
  for (const row of observed.slice(1)) {
    assert.equal(row.stopped, false); assert.equal(row.stops, 0); assert.equal(row.prevents, 0); assert.equal(row.defaultPrevented, false);
    assert.ok(row.windowBubbles >= 2, "unrelated/composing keys still reach the original eligible Window handlers");
    assert.equal(row.notifications, 0);
  }
  assert.equal(h.store.patchUi, patchUi, "the actual Store method was never substituted");
  assert.equal(h.store.route.get(), before.route); assert.equal(native.current().form, originalForm); assert.deepEqual(native.raw(), raw);
  // Separate delivery of the existing cancel EventPart is cleanup only. Native
  // Escape default/cancel ordering and real return remain browser obligations.
  const current = f.find("dialog", row => row.owner === mode && classed(row, "context-set-picker-dialog"));
  await f.act(current, "cancel", { cancelable: true }); await x.settle();
  assert.equal(f.tree().visible("dialog").filter(row => row.owner === mode && classed(row, "context-set-picker-dialog")).length, 0);
  assert.equal(native.current().form, originalForm); assert.deepEqual(native.raw(), raw);
  const trigger = f.find("button", row => row.owner === mode && classed(row, "context-set-trigger"));
  // Explicit positive-control setup, not a claim that native Cancel restored focus.
  f.native.focus(trigger.port);
  const count = notifications, outside = keys.dispatch(f, trigger, "Escape");
  assert.equal(outside.stopped, false); assert.equal(outside.prevents, 0); assert.ok(outside.windowBubbles >= 2);
  assert.equal(notifications - count, 1, "positive control: outside Escape still reaches the original Shell patchUi/notify consumer");
  assert.equal(h.store.patchUi, patchUi); assert.equal(h.store.route.get(), before.route);
  assert.equal(native.current().form, originalForm); assert.deepEqual(native.raw(), raw);
  await x.settle(); await x.safety(before);
  assert.equal(h.requests.length, before.requests); assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal(native.current().form, originalForm); assert.deepEqual(native.raw(), raw);
  t.diagnostic("E11_STUDIO_ESCAPE_FINITE_PORTS " + JSON.stringify({ observed, outside,
    actualStoreConsumerObservedWithoutReplacement: true, rawDraftAndSourceCustodyRetained: true,
    evidence: "current emitted EventParts + actual registered capture/bubble callbacks; no UA key dispatch, native cancel ordering, geometry, focus-return or modal-render dependency proof" }));
});
