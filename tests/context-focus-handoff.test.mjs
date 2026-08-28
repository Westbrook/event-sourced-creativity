import assert from "node:assert/strict";
import test from "node:test";
import { calmFullPageNativePorts, createCalmFullPage } from "./helpers/calm-full-page-fixture.mjs";
import { outputInputDraft } from "../src/model/output-authoring.ts";
import { documentContextBlockRoute } from "../src/model/routes.ts";
import { untilScene } from "./helpers/scene-cost-store-host.mjs";
import { contextFocusFixture, contextFocusDeferred } from "./helpers/context-focus-continuity-fixture.mjs";


for (const mode of ["authorization", "permission", "rejected-update"]) test("Context focus continuity: retires " + mode + " without reviving an old opening", async t => {
  const { f, native, toggle } = await contextFocusFixture(t, "en");
  const block = toggle().owner, deferred = contextFocusDeferred(t, block);
  await f.act(toggle());
  const newer = f.tree().visible("select").find(node => node.owner?.tag === "forma-ui-language-picker").port;
  native.focus(newer);
  if (mode === "authorization") f.store.session.set({ ...f.store.session.get(), permissionEpoch: "context-new-scope" });
  else if (mode === "permission") {
    const session = f.store.session.get();
    f.store.session.set({ ...session, capabilities: ["project.read"] });
  }
  const calls = native.nativeFocus.length;
  if (mode === "rejected-update") deferred.first.reject(Error("Native update was superseded"));
  else deferred.first.resolve(true);
  await f.settle();
  assert.equal(native.nativeFocus.length, calls);
  assert.equal(native.document.activeElement === newer, true);
});


for (const locale of ["en", "ar"]) test("Context focus continuity: " + locale + " remount cannot invent a new editor focus gesture", async t => {
  const { f, native, toggle } = await contextFocusFixture(t, locale);
  await f.act(toggle());
  const originalRoute = f.store.route.get(), old = toggle().owner, previousHistory = globalThis.history;
  globalThis.history = {
    pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(f.storeHost.location, { pathname: url.pathname, search: url.search, hash: url.hash }); },
    replaceState(...args) { this.pushState(...args); },
  };
  t.after(() => { globalThis.history = previousHistory; });
  f.store.setRoute("/library"); await f.settle();
  assert.equal(old.isConnected, false);
  const field = f.tree().visible("select").find(node => node.owner?.tag === "forma-ui-language-picker").port;
  native.focus(field); const count = native.nativeFocus.length;
  f.store.setRoute(originalRoute); await f.settle();
  assert.equal(native.nativeFocus.length, count, "old editingBlockId is not a new user focus request");
  assert.equal(native.document.activeElement === field, true);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("Context focus continuity: " + locale + " explicit Store reveal still focuses its existing editor", async t => {
  const { f, native } = await contextFocusFixture(t, locale);
  const host = f.storeHost, originalQuery = host.document.querySelector, originalCSS = globalThis.CSS;
  host.document.querySelector = selector => calmFullPageNativePorts.documentPort.querySelector(selector);
  globalThis.CSS = { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/gu, character => "\\" + character.codePointAt(0).toString(16) + " ") };
  t.after(() => { host.document.querySelector = originalQuery; globalThis.CSS = originalCSS; });
  const before = JSON.stringify(f.store.events.get()), existingTimers = new Set(host.timers.keys()), requests = host.requests.length;
  assert.equal(await f.store.revealOutputInput("synthetic-1", f.store.projection.get().documentId), true);
  await f.settle();
  assert.equal(f.store.ui.editingBlockId, "synthetic-1");
  const frames = [...host.timers].filter(([id, timer]) => !existingTimers.has(id) && timer.delay === 16);
  assert.equal(frames.length, 1, "the original Store reveal owns its native frame");
  for (const [id, timer] of frames) { host.timers.delete(id); timer.callback(); }
  assert.equal(native.document.activeElement?.tag, "textarea", "the original explicit Store handoff still focuses the real editor");
  assert.equal(native.document.activeElement?.closest("forma-context-block")?.block.id, "synthetic-1");
  assert.equal(JSON.stringify(f.store.events.get()), before); assert.equal(host.requests.length, requests);
});


for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["text", "structured"]) for (const boundary of ["post-render", "same-frame"]) test("Context focus continuity: " + locale + " " + kind + " same-ID reveal " + boundary + " retains the exact draft", async t => {
  const { f, native, toggle } = await contextFocusFixture(t, locale, false, kind);
  await f.act(toggle());
  const block = toggle().owner, child = f.components().find(component => component.tag === "forma-output-input-editor" && component.block.id === "synthetic-0");
  const field = f.find("textarea", node => kind === "structured" ? node.owner === child && node.properties.value === "Original structured summary" : node.owner === block);
  const draft = "UNSENT SAME-ID DRAFT — العربية 日本語 👩🏽‍💻\n".repeat(30);
  await f.act(field, "input", { target: { value: draft }, currentTarget: { value: draft } });
  const fullDraft = child?.draft ?? draft, events = JSON.stringify(f.store.events.get());
  const host = f.storeHost, query = host.document.querySelector, css = globalThis.CSS;
  host.document.querySelector = selector => calmFullPageNativePorts.documentPort.querySelector(selector);
  globalThis.CSS = { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/gu, character => "\\" + character.codePointAt(0).toString(16) + " ") };
  t.after(() => { host.document.querySelector = query; globalThis.CSS = css; });
  const timerIds = new Set(host.timers.keys()), requestCount = host.requests.length;
  if (boundary === "post-render") {
    await f.act(toggle());
    assert.equal(f.tree().visible("div").some(row => row.owner === block && row.attributes.class === "context-controls-panel"), false, "ordinary close stays closed");
  } else {
    const close = toggle();
    close.handlers.click.call(close.owner, { target: close.port, currentTarget: close.port, preventDefault() {}, stopPropagation() {} });
  }
  assert.equal(f.store.ui.editingBlockId, "", "only the closed editor's current request is retired");
  assert.equal(await f.store.revealOutputInput("synthetic-0", f.store.projection.get().documentId), true);
  await f.settle();
  assert.equal(f.tree().visible("div").some(row => row.owner === block && row.attributes.class === "context-controls-panel"), true);
  assert.equal(f.store.ui.editingBlockId, "synthetic-0");
  if (child) {
    assert.equal(f.components().find(component => component.tag === "forma-output-input-editor" && component.block.id === "synthetic-0"), child);
    assert.deepEqual(child.draft, fullDraft);
  } else assert.equal(f.find("textarea", node => node.owner === block).properties.value, draft);
  const frames = [...host.timers].filter(([id, timer]) => !timerIds.has(id) && timer.delay === 16);
  assert.equal(frames.length, 1);
  for (const [id, timer] of frames) { host.timers.delete(id); timer.callback(); }
  assert.equal(native.document.activeElement?.tag, "textarea", "the explicit existing Store reveal reaches an editor field");
  assert.equal(native.document.activeElement?.closest("forma-context-block")?.block.id, "synthetic-0");
  assert.equal(JSON.stringify(f.store.events.get()), events, "close/reveal never saves retained text");
  assert.equal(host.requests.length, requestCount, "no replacement request, provider or queue action");
});

test("Context focus continuity: closing old Controls does not clear another editor's request", async t => {
  const { f, toggle } = await contextFocusFixture(t, "en");
  await f.act(toggle());
  const close = toggle();
  f.store.patchUi({ editingBlockId: "synthetic-1" });
  close.handlers.click.call(close.owner, { target: close.port, currentTarget: close.port, preventDefault() {}, stopPropagation() {} });
  assert.equal(f.store.ui.editingBlockId, "synthetic-1");
  await f.settle();
});


// These re-entry races use the complete Store, including its own reveal,
// authorization, append pipeline, merge, and focus lease. Only the existing
// in-memory HTTP port delays the exact explicitly submitted authoring receipt.
function contextFocusSaveOwner(f) {
  return f.components().find(component => component.tag === "forma-context-block" && component.block.id === "synthetic-0");
}

function contextFocusSaveRead(f) {
  const block = contextFocusSaveOwner(f), kind = f.contextFocusKind;
  if (kind === "structured") return block.querySelector("forma-output-input-editor")?.draft ?? null;
  if (kind === "text") return f.tree().visible("textarea").find(node => node.owner === block)?.properties.value ?? null;
  const rich = block.querySelector("forma-ui-rich-text");
  const inputs = f.tree().visible("input").filter(node => node.owner === block && node.handlers.input);
  return rich ? { text: rich.value, label: inputs[0]?.properties.value, palette: inputs.slice(1).map(node => node.properties.value) } : null;
}

async function contextFocusSaveInput(f, node, value) {
  assert.ok(node && typeof node.handlers.input === "function", "real editable input exists");
  assert.ok(!Object.hasOwn(node.attributes, "disabled"), "draft fields remain editable while a save is pending");
  await f.act(node, "input", { target: { value }, currentTarget: { value } });
}

async function contextFocusSaveType(f, mark) {
  const block = contextFocusSaveOwner(f), kind = f.contextFocusKind;
  if (kind === "text") {
    await contextFocusSaveInput(f, f.find("textarea", node => node.owner === block), mark + " — 日本語 العربية café 👩🏽‍💻\n".repeat(35));
  } else if (kind === "image") {
    const rich = block.querySelector("forma-ui-rich-text");
    await contextFocusSaveInput(f, f.find("textarea", node => node.owner === rich), mark + " — full image direction\nالعربية 日本語");
    const inputs = () => f.tree().visible("input").filter(node => node.owner === block && node.handlers.input);
    await contextFocusSaveInput(f, inputs()[0], mark + " — image title العربية 日本語");
    await contextFocusSaveInput(f, inputs()[1], mark === "B" ? "#000000" : "#f0e1d2");
    await contextFocusSaveInput(f, inputs()[2], mark === "B" ? "#ffffff" : "#102030");
  } else {
    const workbench = block.querySelector("forma-output-input-editor");
    const own = tag => f.tree().visible(tag).filter(node => node.owner === workbench && node.attributes.class !== "ui-rich-text-input");
    await contextFocusSaveInput(f, own("input")[0], mark + " — story title العربية 日本語");
    await contextFocusSaveInput(f, own("textarea")[0], mark + " — complete summary\n".repeat(30));
    const rich = workbench.querySelector("forma-ui-rich-text");
    await contextFocusSaveInput(f, f.find("textarea", node => node.owner === rich), mark + " — complete manuscript\n".repeat(35));
    for (let index = 1; index < own("input").length; index++) await contextFocusSaveInput(f, own("input")[index], mark + " — chapter " + index);
    for (let index = 1; index < own("textarea").length; index++) await contextFocusSaveInput(f, own("textarea")[index], mark + " — structured field " + index + "\nالعربية 日本語");
  }
  return structuredClone(contextFocusSaveRead(f));
}

function contextFocusSaveCommitted(f, draft) { return f.contextFocusKind === "text" ? draft.trim() : draft; }

function contextFocusSaveSaved(f) {
  const block = f.store.projection.get().libraryBlocks.find(row => row.id === "synthetic-0"), properties = block.properties;
  return f.contextFocusKind === "structured" ? outputInputDraft(block)
    : f.contextFocusKind === "image" ? { text: properties.text, label: properties.label, palette: properties.output_palette } : properties.text;
}

function contextFocusSaveDefer(t, f) {
  const host = f.storeHost, original = host.intercept, requests = [];
  host.intercept = request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") return original?.(request);
    const gate = Promise.withResolvers(), submitted = structuredClone(request.body.events);
    requests.push({ gate, submitted });
    return gate.promise;
  };
  t.after(() => { host.intercept = original; });
  return requests;
}

function contextFocusSaveSubmit(f) {
  const block = contextFocusSaveOwner(f), form = f.find("form", node => node.owner === block && String(node.attributes.class).split(/\s/u).includes("block-editor"));
  assert.equal(typeof form.handlers.submit, "function", "actual parent Save handler");
  form.handlers.submit.call(block, { preventDefault() {} });
}

async function contextFocusSaveAcknowledge(f, request) {
  const head = f.store.head.get();
  const appended = request.submitted.map((input, index) => ({
    ...structuredClone(input), eventId: "context-continuity-ack-" + (head + index + 1), sequence: head + index + 1,
    streamId: f.storeHost.worker.streamId, occurredAt: "2026-08-27T00:00:00Z", recordedAt: "2026-08-27T00:00:00Z",
    actor: "user", correlationId: "context-continuity-explicit-save",
  }));
  request.gate.resolve(Response.json({ appended, head: head + appended.length }));
  await untilScene(() => f.store.busy.get() === "", "original append acknowledgement completes before any next render");
  await new Promise(setImmediate);
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["text", "image", "structured"]) for (const mode of ["same-copy", "new-copy"]) test("context continuity: " + locale + " " + kind + " same-frame reveal before Save acknowledgement " + mode, async t => {
  const { f, toggle } = await contextFocusFixture(t, locale, false, kind, createCalmFullPage);
  const projection = f.store.projection.get();
  f.store.route.set(documentContextBlockRoute(projection.documentId, projection.documentTitle, "synthetic-0"));
  await f.settle();
  const routeAtSave = f.store.route.get(), transportStart = f.storeHost.requests.length;
  await f.act(toggle());
  const a = await contextFocusSaveType(f, "A"), requests = contextFocusSaveDefer(t, f);
  contextFocusSaveSubmit(f);
  await untilScene(() => requests.length === 1, "exact original Save is pending at the HTTP port");
  assert.equal(requests.length, 1);
  const draft = mode === "new-copy" ? await contextFocusSaveType(f, "B") : a;
  const block = contextFocusSaveOwner(f), close = toggle(), host = f.storeHost;
  const deferred = contextFocusDeferred(t, block);
  const originalQuery = host.document.querySelector, originalCSS = globalThis.CSS, existingTimers = new Set(host.timers.keys());
  host.document.querySelector = selector => calmFullPageNativePorts.documentPort.querySelector(selector);
  globalThis.CSS = { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/gu, character => "\\" + character.codePointAt(0).toString(16) + " ") };
  t.after(() => { host.document.querySelector = originalQuery; globalThis.CSS = originalCSS; });
  close.handlers.click.call(block, { target: close.port, currentTarget: close.port, preventDefault() {}, stopPropagation() {} });
  assert.equal(f.store.ui.editingBlockId, "");
  const reveal = f.store.revealOutputInput("synthetic-0", f.store.projection.get().documentId);
  assert.equal(f.store.ui.editingBlockId, "synthetic-0", "fresh reveal is synchronous before the next component render");
  const submitted = structuredClone(requests[0].submitted);
  await contextFocusSaveAcknowledge(f, requests[0]); await reveal;
  assert.equal(f.store.route.get(), routeAtSave, "ordinary receipt does not incidentally retire the editor through slug correction");
  assert.equal(contextFocusSaveOwner(f), block, "the same actual native editor owns this race");
  assert.equal(f.store.ui.editingBlockId, "synthetic-0", "ack A must not retire the newer explicit reveal before rendering");
  deferred.first.resolve(true);
  await f.settle();
  assert.deepEqual(contextFocusSaveRead(f), draft);
  assert.deepEqual(contextFocusSaveSaved(f), contextFocusSaveCommitted(f, a));
  assert.deepEqual(requests[0].submitted, submitted, "acknowledgement and newer draft never mutate the submitted A bytes");
  const frames = [...host.timers].filter(([id, timer]) => !existingTimers.has(id) && timer.delay === 16);
  assert.equal(frames.length, 1, "only the existing explicit Store handoff was requested");
  assert.equal(requests.length, 1, "the newer draft is never automatically saved");
  contextFocusSaveSubmit(f);
  if (mode === "new-copy") {
    await untilScene(() => requests.length === 2, "B has its own explicit Save");
    assert.equal(requests.length, 2);
    await contextFocusSaveAcknowledge(f, requests[1]);
    assert.deepEqual(contextFocusSaveSaved(f), contextFocusSaveCommitted(f, draft));
  } else {
    await new Promise(setImmediate);
    assert.equal(requests.length, 1, "unchanged saved bytes need no duplicate append");
  }
  assert.deepEqual(host.requests.slice(transportStart).filter(request => request.init.method && request.init.method !== "GET").map(request => request.url), requests.map(() => "/api/events"), "only the explicitly requested draft appends use transport after fixture setup");
});


for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["text", "image"]) for (const change of ["no-op-render", "metadata-only"]) test("Context focus continuity: " + locale + " " + kind + " owned Close survives " + change, async t => {
  const { f, native, toggle } = await contextFocusFixture(t, locale, false, kind);
  await f.act(toggle());
  const block = toggle().owner, original = structuredClone(contextFocusSaveRead(f));
  const events = f.store.events.get().length, requests = f.storeHost.requests.length;
  const deferred = contextFocusDeferred(t, block);
  await f.act(toggle());
  if (change === "metadata-only") f.appendEvent("BlockRenamed", {
    block_id: block.block.id, old_handle: block.block.handle,
    new_handle: "Current readable handle — العربية 日本語", reason: "user",
  });
  else block.requestUpdate();
  await f.settle(); block.requestUpdate(); await f.settle();
  const calls = native.nativeFocus.length;
  deferred.first.resolve(true); await f.settle();
  assert.equal(native.nativeFocus.length, calls + 1, "an unchanged draft render does not retire the current Close gesture");
  assert.ok(String(native.document.activeElement?.attributes?.class).includes("context-controls-toggle"));
  assert.equal(f.store.ui.editingBlockId, "");
  assert.equal(f.tree().visible("form").some(row => row.owner === block && String(row.attributes.class).includes("block-editor")), false);
  await f.act(toggle());
  assert.deepEqual(contextFocusSaveRead(f), original, "metadata and no-op renders preserve all untouched ordinary/image values");
  assert.equal(f.store.events.get().length, events + (change === "metadata-only" ? 1 : 0), "only the explicitly seeded metadata event was added");
  assert.equal(f.storeHost.requests.length, requests, "rendering, Close and re-entry never create a save or lookup");
});

for (const locale of ["en", "fr", "ar", "ja"]) for (const next of ["same-frame-reveal", "cancel-return", "new-close-return"]) test("Context focus continuity: " + locale + " old Close cannot replace " + next, async t => {
  const { f, native, toggle } = await contextFocusFixture(t, locale);
  const projection = f.store.projection.get();
  f.store.route.set(documentContextBlockRoute(projection.documentId, projection.documentTitle, "synthetic-0"));
  await f.settle(); await f.act(toggle());
  const block = toggle().owner, draft = await contextFocusSaveType(f, "RETAINED");
  const route = f.store.route.get(), events = JSON.stringify(f.store.events.get()), requests = f.storeHost.requests.length;
  const deferred = contextFocusDeferred(t, block), close = toggle();
  close.handlers.click.call(block, { target: close.port, currentTarget: close.port, preventDefault() {}, stopPropagation() {} });
  assert.equal(f.store.ui.editingBlockId, "");
  const reveal = f.store.revealOutputInput("synthetic-0", projection.documentId);
  assert.equal(f.store.ui.editingBlockId, "synthetic-0", "the new explicit request is visible before the old Close callback");
  assert.equal(await reveal, true);
  let currentReturn = null;
  if (next !== "same-frame-reveal") {
    await f.settle();
    currentReturn = deferred.next();
    const action = next === "cancel-return"
      ? f.find("button", node => node.owner === block && node.attributes.type === "button" && node.attributes.class === "button ghost")
      : toggle();
    await f.act(action);
    assert.equal(f.store.ui.editingBlockId, "", "the new action may deliberately return the request to its earlier value");
  }
  const calls = native.nativeFocus.length;
  deferred.first.resolve(true); await f.settle();
  assert.equal(native.nativeFocus.length, calls, "the earlier Close never focuses through a newer same-ID request or request ABA");
  assert.equal(f.store.route.get(), route, "this race is not fenced by incidental navigation");
  if (currentReturn) {
    currentReturn.resolve(true); await f.settle();
    assert.equal(native.nativeFocus.length, calls + 1, "the newer explicit Cancel or Close retains its ordinary focus return");
    assert.ok(String(native.document.activeElement?.attributes?.class).includes(next === "cancel-return" ? "block-copy" : "context-controls-toggle"));
    if (next === "new-close-return") { await f.act(toggle()); assert.deepEqual(contextFocusSaveRead(f), draft); }
  } else {
    assert.deepEqual(contextFocusSaveRead(f), draft);
    const frames = [...f.storeHost.timers].filter(([, timer]) => timer.delay === 16);
    assert.equal(frames.length, 1, "the newer exact Store reveal retains its own pending frame");
    for (const [id, timer] of frames) { f.storeHost.timers.delete(id); timer.callback(); }
    assert.equal(native.document.activeElement?.tag, "textarea");
    assert.equal(native.document.activeElement?.closest("forma-context-block")?.block.id, "synthetic-0");
  }
  assert.equal(JSON.stringify(f.store.events.get()), events, "no request ordering gesture saves a retained draft");
  assert.equal(f.storeHost.requests.length, requests, "no retry, lookup, provider or command is introduced");
});
