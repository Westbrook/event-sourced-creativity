import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { createCalmFullPage, calmFullPageNativePorts as ports, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { installImageFormatNativeLifetime as cImageFrameNative } from "./helpers/image-format-native-lifetime.mjs";
import { retainDeferredFocusInvokers } from "./helpers/deferred-focus-invokers.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { readWorkspaceEvents } from "../worker/runtime.ts";
import { blockTypeDefinition, suggestedSubtype } from "../src/model/block-types.ts";
import { documentViewFromRoute, projectTaskDocumentIdFromRoute, withDocumentInRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";

// Complete current alternative/Shell/Store classes, actual isolated RAM Worker
// and existing native ports. No provider work, fake receipt or local-only Source
// seed. The shared renderer's study sample is removed by a genuine source read.
const cAlternativeOptions = { concurrency: false, timeout: 120000 };
const cAlternativeCheckpoint = (phase, detail = {}) => {
  if (process.env.FORMA_ALTERNATIVE_SETUP_TRACE === "1")
    process.stderr.write("C_ALTERNATIVE_CHECKPOINT " + JSON.stringify({ phase, at: Date.now(), ...detail }) + "\n");
};
cAlternativeCheckpoint("module-body-ready");
const cAlternativeClass = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
const cAlternativeInside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
const cAlternativeReceipts = worker => worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();

async function cAlternativeDrain(x) {
  cAlternativeCheckpoint("drain-start", { mode: x.mode, requests: x.h.requests.length });
  let queues;
  for (let step = 0; step < 8; step++) {
    // Reuse the established current-original queue order: join transport,
    // deliver only scheduled Store RAF, settle real current Output reads,
    // then observe quiescence instead of forcing unrelated extra redraws.
    cAlternativeCheckpoint("drain-originals-start", { mode: x.mode, step, transports: x.resume.pendingOriginalCount() });
    await x.resume.settleOriginalRequests();
    for (const [id, timer] of [...x.h.timers]) if (timer.delay === 16) { x.h.timers.delete(id); timer.callback(0); }
    cAlternativeCheckpoint("drain-settle-start", { mode: x.mode, step });
    await x.f.settle();
    await x.resume.settleOriginalRequests();
    cAlternativeCheckpoint("drain-background-start", { mode: x.mode, step });
    await x.worker.drainBackground();
    const documents = [...new Set(x.f.components().filter(component => component.tag === "forma-output-requirements")
      .map(component => component.documentId).filter(Boolean))];
    queues = { transports: x.resume.pendingOriginalCount(), componentFrames: x.f.frames.size,
      storeFrames: [...x.h.timers.values()].filter(timer => timer.delay === 16).length,
      renderRequests: Number(x.f.requested),
      outputReads: documents.filter(id => ["loading", "refreshing"].includes(x.h.store.outputRequirements.resource(id).state)).length };
    cAlternativeCheckpoint("drain-quiescence", { mode: x.mode, step, ...queues });
    if (Object.values(queues).every(value => value === 0)) break;
  }
  assert.deepEqual(queues, { transports: 0, componentFrames: 0, storeFrames: 0, renderRequests: 0, outputReads: 0 },
    "Actual original transports, current Output reads, native/Store frames and render requests are quiescent");
  assert.equal(x.resume.pendingOriginalCount(), 0);
}
async function cAlternativePage(t, mode, locale = "en") {
  let external = 0, verify = async () => {};
  cAlternativeCheckpoint("page-enter", { mode, locale, test: t.name });
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    external++;
    cAlternativeCheckpoint("blocked-global-fetch", { mode, locale, count: external, method: init.method ?? "GET", addressWithoutQuery: String(input).split("?")[0] });
    assert.fail("No external/provider request in alternative command controls");
  });
  // Register verification before the reused fixture's database close hook.
  t.after(async () => {
    cAlternativeCheckpoint("cleanup-verify-start", { mode, locale, external });
    await verify(); assert.equal(external, 0);
    cAlternativeCheckpoint("cleanup-verify-end", { mode, locale, external });
  });
  cAlternativeCheckpoint("worker-create-start", { mode, locale });
  const worker = await createSceneCostFixture(1, "visual", { shared: false });
  cAlternativeCheckpoint("worker-create-end", { mode, locale });
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  cAlternativeCheckpoint("store-create-end", { mode, locale, requests: h.requests.length });
  assert.equal(typeof h.store.sceneGateForTest, "undefined");
  const session = h.store.session.get(), priorHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
  Object.defineProperty(globalThis, "history", { configurable: true, writable: true, value: {
    pushState(_state, _title, path) { const next = new URL(path, "http://localhost"); Object.assign(h.location, { pathname: next.pathname, search: next.search, hash: next.hash }); },
    replaceState(...args) { this.pushState(...args); },
  } });
  t.after(() => { if (priorHistory) Object.defineProperty(globalThis, "history", priorHistory); else delete globalThis.history; });
  const resume = observeActualSceneResumeReads(h); t.after(() => resume.restore());
  cAlternativeCheckpoint("calm-create-start", { mode, locale });
  const f = await createCalmFullPage(t, { locale, storeHost: h });
  cAlternativeCheckpoint("calm-create-end", { mode, locale, requests: h.requests.length });
  // Restore the actual session (including its real Assistant setting), then
  // admit only the Worker-backed complete event source through the actual API.
  cAlternativeCheckpoint("actual-session-restore-start", { mode, locale, assistantEnabled: Boolean(session?.assistant?.enabled) });
  h.store.session.set(session);
  cAlternativeCheckpoint("actual-source-read-start", { mode, locale, external });
  await h.store.refreshEvents({ fromStart: true });
  cAlternativeCheckpoint("actual-source-read-end", { mode, locale, requests: h.requests.length, external });
  await registerCalmFullPageComponents(f, ["forma-context-board", "forma-guided-brief", "forma-activity"]);
  cAlternativeCheckpoint("cem-registration-end", { mode, locale });
  f.nativeHistoryLocation = h.location; f.native = installOutputNavigationFocusNative(t, f, ports);
  cAlternativeCheckpoint("native-focus-installed", { mode, locale });
  h.store.setRoute(withDocumentInRoute("/studio/" + mode, worker.documentId, h.store.projection.get().documentTitle));
  cAlternativeCheckpoint("alternative-route-set", { mode, locale });
  const x = { f, h, worker, resume, mode, after: callback => t.after(callback) }; await cAlternativeDrain(x);
  cImageFrameNative(x); // All actual ImageFormat descendants in this complete-family fixture, before any user action.
  cAlternativeCheckpoint("initial-alternative-drain-end", { mode, locale, external });
  const tag = mode === "board" ? "forma-context-board" : "forma-guided-brief";
  const owners = f.components().filter(owner => owner.tag === tag); assert.equal(owners.length, 1); x.owner = owners[0];
  assert.ok(x.owner.isConnected); assert.equal(x.owner.store, h.store); assert.equal(f.host.tag, "forma-shell");
  assert.equal(documentViewFromRoute(h.store.route.get()), mode);
  const projection = h.store.projection.get();
  assert.equal(projection.projectId, worker.projectId); assert.equal(projection.documentId, worker.documentId);
  assert.equal(h.store.events.get().some(event => event.eventId.startsWith("synthetic-study-")), false);
  assert.equal(projection.blocks.length, 1, "The actual fixture Document has only its authored direction");
  assert.equal(projection.blocks[0].id, "scene-reuse-direction"); assert.equal(projection.blocks[0].properties.text, "The keeper checks the harbor.");
  const outputs = f.components().filter(owner => owner.tag === "forma-output-requirements");
  assert.equal(outputs.length, 1); assert.equal(outputs[0].documentId, worker.documentId); assert.equal(outputs[0].store, h.store);
  x.children = f.components().filter(owner => ["forma-output-requirements", "forma-context-block", "forma-output-input-editor"].includes(owner.tag));
  for (const child of x.children) assert.ok(child.isConnected && child.store === h.store);
  const requests = h.requests.length; await cAlternativeDrain(x); assert.equal(h.requests.length, requests);
  const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
  assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
  x.before = { route: h.store.route.get(), source, authorization, projectId: projection.projectId, documentId: projection.documentId,
    events: structuredClone(h.store.events.get()), head: h.store.head.get(), session: structuredClone(h.store.session.get()),
    history: await readWorkspaceEvents(worker.env, worker.streamId), receipts: cAlternativeReceipts(worker), money: financial(worker) };
  verify = async () => cAlternativeNoWrites(x);
  cAlternativeCheckpoint("page-ready", { mode, locale, external });
  return x;
}
async function cAlternativeNoWrites(x) {
  await cAlternativeDrain(x);
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), x.before.history, "No new authoring/navigation/receipt event");
  assert.deepEqual(cAlternativeReceipts(x.worker), x.before.receipts); assert.deepEqual(financial(x.worker), x.before.money);
  assert.deepEqual(x.h.store.events.get(), x.before.events); assert.equal(x.h.store.head.get(), x.before.head);
  assert.deepEqual(x.h.store.session.get(), x.before.session);
  assert.ok(x.h.store.sourceOwnershipActive(x.before.source) && x.h.store.authorizationScopeActive(x.before.authorization));
  assert.equal(x.h.store.projection.get().projectId, x.before.projectId); assert.equal(x.h.store.projection.get().documentId, x.before.documentId);
  assert.deepEqual(x.h.requests.filter(request => (request.init.method ?? "GET") !== "GET" && !x.resume.isReadOnlyResume(request)
    && !x.boardAdds?.isWitnessed(request) && !x.guidedSave?.isWitnessed(request) && !x.frameSave?.isWitnessed(request)
    && !x.contextReview?.isWitnessed(request) && !x.studioCopy?.isWitnessed(request)), [],
    "Only exact witnessed original empty Resume reads, armed native Board Adds, the single Guided direction Save or one native frame Apply; no generic POST or generation exemption");
}
function cAlternativeOwned(x) {
  assert.ok(x.owner.isConnected && x.f.components().includes(x.owner)); assert.equal(x.owner.store, x.h.store);
  for (const child of x.children) assert.ok(child.isConnected && x.f.components().includes(child) && child.store === x.h.store);
}
async function cAlternativeCommand(x) {
  cAlternativeCheckpoint("command-enter", { mode: x.mode });
  cAlternativeOwned(x); const { f, h } = x, requestStart = h.requests.length, route = h.store.route.get();
  const trigger = f.find("button", node => node.owner === f.host && cAlternativeClass(node, "command-trigger"));
  assert.equal(trigger.port.matches(":disabled"), false); f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port);
  cAlternativeCheckpoint("command-trigger-start", { mode: x.mode });
  await f.act(trigger, "click", { button: 0 });
  cAlternativeCheckpoint("command-trigger-end", { mode: x.mode });
  const label = f.i18n.t("command.openNavigation", "Open {name}", { name: f.i18n.t("shell.navigation.activity", "Activity") });
  const search = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search"); search.port.value = label; await f.act(search, "input");
  const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === f.host && cAlternativeClass(node, "command-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  const choices = tree.visible("button").filter(node => node.owner === f.host && node.attributes.role === "option" && cAlternativeInside(node, dialogs[0])
    && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label));
  assert.equal(choices.length, 1); assert.ok(choices[0].port.isConnected); assert.equal(choices[0].port.matches(":disabled"), false);
  assert.equal(h.store.route.get(), route); assert.equal(h.requests.length, requestStart); cAlternativeOwned(x);
  f.native.emit("pointerdown", choices[0].port); f.native.focus(choices[0].port);
  const focus = f.native.nativeFocus.length, scroll = f.native.nativeScroll.length;
  cAlternativeCheckpoint("command-row-start", { mode: x.mode });
  await f.act(choices[0], "click", { button: 0 });
  cAlternativeCheckpoint("command-row-end", { mode: x.mode });
  await cAlternativeDrain(x);
  cAlternativeCheckpoint("command-end", { mode: x.mode });
  return { label, requestStart, focus, scroll };
}
function cAlternativeObservation(t, x, gesture, stage) {
  t.diagnostic("C_ALTERNATIVE_COMMAND_ORIGIN " + JSON.stringify({ mode: x.mode, locale: x.f.i18n.locale, stage, command: gesture.label,
    route: x.h.store.route.get(), originRoute: x.before.route, originalConnected: x.owner.isConnected,
    sourceAndExactHistoryUnchanged: true, eventReceiptsAndFinancialRowsUnchanged: true, authoringCommands: 0,
    evidence: "actual complete Shell/alternative/Store/isolated Worker and native ports; no browser geometry/provider certificate" }));
}
function cAlternativeDeparted(x) {
  assert.equal(x.h.store.route.get(), withProjectTaskDocumentInRoute("/activity", x.before.documentId, x.before.route));
  assert.equal(projectTaskDocumentIdFromRoute(x.h.store.route.get()), x.before.documentId); assert.equal(x.owner.isConnected, false);
  const destinations = x.f.tree().nodes.filter(node => node.tag === "forma-activity" && node.component?.isConnected && !node.hiddenBy);
  assert.equal(destinations.length, 1); assert.equal(destinations[0].component.store, x.h.store);
}
function cAlternativeRefused(x, gesture) {
  assert.equal(x.h.store.route.get(), x.before.route, "Actual current alternative raw work prevents command departure"); cAlternativeOwned(x);
  assert.equal(x.h.requests.length, gesture.requestStart); assert.equal(x.f.native.nativeScroll.length, gesture.scroll);
  assert.equal(x.f.native.nativeFocus.slice(gesture.focus).some(row => row.node.owner?.tag === "forma-activity"), false);
}
async function cAlternativeCloseMenu(x) {
  const dialogs = x.f.tree().visible("dialog").filter(node => node.owner === x.f.host && cAlternativeClass(node, "command-dialog"));
  assert.ok(dialogs.length <= 1); if (dialogs.length) await x.f.act(dialogs[0], "cancel", { cancelable: true }); await cAlternativeDrain(x);
}
async function cAlternativeValue(x, node, value, event = "input") {
  assert.ok(node.port.isConnected && !node.hiddenBy); assert.equal(node.port.matches(":disabled"), false);
  node.port.value = value; await x.f.act(node, event);
}
const cBoardText = x => x.f.find("input", node => node.owner === x.owner && node.attributes.id === "board-decision");
function cBoardSelects(x) {
  const tree = x.f.tree(), forms = tree.visible("form").filter(node => node.owner === x.owner && cAlternativeClass(node, "board-quick-add"));
  assert.equal(forms.length, 1); const fields = tree.visible("select").filter(node => node.owner === x.owner && cAlternativeInside(node, forms[0]));
  assert.equal(fields.length, 2); return fields;
}
function cBoardInitial(x) {
  const [type, subtype] = cBoardSelects(x); assert.equal(type.port.value, "subject", "Actual direction-only source leaves World as the next lane");
  assert.equal(subtype.port.value, suggestedSubtype("subject")); assert.equal(cBoardText(x).port.value, "");
  return { type: type.port.value, subtype: subtype.port.value };
}

test("C Context Board command origin / pristine actual suggested defaults", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board"); cBoardInitial(x);
  await x.h.store.refreshEvents({ fromStart: true }); await cAlternativeDrain(x); cBoardInitial(x);
  const gesture = await cAlternativeCommand(x); await cAlternativeNoWrites(x);
  cAlternativeObservation(t, x, gesture, "pristine-after-unchanged-actual-read"); cAlternativeDeparted(x);
});
test("C Context Board command origin / raw whitespace refuses then same-field clear resolves / ja", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board", "ja"), raw = " \n\t  "; cBoardInitial(x);
  await cAlternativeValue(x, cBoardText(x), raw); assert.equal(cBoardText(x).port.value, raw);
  const gesture = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeObservation(t, x, gesture, "raw-whitespace");
  cAlternativeRefused(x, gesture); assert.equal(cBoardText(x).port.value, raw); await cAlternativeCloseMenu(x);
  await cAlternativeValue(x, cBoardText(x), ""); const fresh = await cAlternativeCommand(x); await cAlternativeNoWrites(x);
  cAlternativeObservation(t, x, fresh, "explicit-clear"); cAlternativeDeparted(x);
});
test("C Context Board command origin / type and subtype intent resolve back to actual defaults", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board"), initial = cBoardInitial(x);
  await cAlternativeValue(x, cBoardSelects(x)[0], "direction", "change"); assert.equal(cBoardText(x).port.value, "");
  const typeGesture = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeObservation(t, x, typeGesture, "type-only");
  cAlternativeRefused(x, typeGesture); assert.equal(cBoardSelects(x)[0].port.value, "direction"); await cAlternativeCloseMenu(x);
  await cAlternativeValue(x, cBoardSelects(x)[0], initial.type, "change");
  const alternative = blockTypeDefinition(initial.type).subtypes.find(value => value !== initial.subtype); assert.ok(alternative);
  await cAlternativeValue(x, cBoardSelects(x)[1], alternative, "change");
  const subtypeGesture = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeObservation(t, x, subtypeGesture, "subtype-only");
  cAlternativeRefused(x, subtypeGesture); assert.equal(cBoardSelects(x)[1].port.value, alternative); await cAlternativeCloseMenu(x);
  await cAlternativeValue(x, cBoardSelects(x)[1], initial.subtype, "change"); cBoardInitial(x);
  const fresh = await cAlternativeCommand(x); await cAlternativeNoWrites(x);
  cAlternativeObservation(t, x, fresh, "defaults-restored-despite-sticky-selection-history"); cAlternativeDeparted(x);
});

function cGuidedField(x, type = "direction") {
  return x.f.find("textarea", node => node.owner === x.owner && node.attributes.id === "brief-" + type);
}
function cGuidedSubtype(x, type = "direction") {
  const tree = x.f.tree(), field = tree.visible("textarea").find(node => node.owner === x.owner && node.attributes.id === "brief-" + type); assert.ok(field);
  let section = field.parent; while (section && !cAlternativeClass(section, "guided-question")) section = section.parent; assert.ok(section);
  const fields = tree.visible("select").filter(node => node.owner === x.owner && cAlternativeInside(node, section)); assert.equal(fields.length, 1); return fields[0];
}
async function cGuidedStep(x, label) {
  const tree = x.f.tree(), navs = tree.visible("nav").filter(node => node.owner === x.owner && cAlternativeClass(node, "guided-step-nav")); assert.equal(navs.length, 1);
  const buttons = tree.visible("button").filter(node => node.owner === x.owner && cAlternativeInside(node, navs[0])
    && tree.visible("b").some(name => cAlternativeInside(name, node) && name.text === x.f.i18n.system(label)));
  assert.equal(buttons.length, 1); await x.f.act(buttons[0], "click", { button: 0 });
  const current = x.f.tree().visible("button").filter(node => node.owner === x.owner && node.attributes["aria-current"] === "step");
  assert.equal(current.length, 1); assert.ok(current[0].text.includes(x.f.i18n.system(label)));
}
function cGuidedInitial(x) {
  const block = x.h.store.projection.get().blocks.find(value => value.type === "direction"); assert.ok(block);
  const text = String(block.properties.artifact_markdown ?? block.properties.text ?? block.properties.label ?? "");
  const subtype = String(block.properties.subtype ?? suggestedSubtype("direction"));
  assert.ok(text.length > 0); assert.equal(cGuidedField(x).port.value, text); assert.equal(cGuidedSubtype(x).port.value, subtype);
  return { text, subtype };
}
test("C Guided Brief command origin / seeded nonempty hidden answers remain pristine after current read", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "guided"), initial = cGuidedInitial(x);
  await x.h.store.refreshEvents({ fromStart: true }); await cAlternativeDrain(x); assert.deepEqual(cGuidedInitial(x), initial);
  await cGuidedStep(x, "World"); assert.equal(x.f.tree().visible("textarea").some(node => node.attributes.id === "brief-direction"), false);
  const gesture = await cAlternativeCommand(x); await cAlternativeNoWrites(x);
  cAlternativeObservation(t, x, gesture, "pristine-hidden-seeded-answer"); cAlternativeDeparted(x);
});
test("C Guided Brief command origin / hidden earlier raw answer refuses then exact revert resolves / ja", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "guided", "ja"), initial = cGuidedInitial(x), raw = " \n\t  ";
  await cAlternativeValue(x, cGuidedField(x), raw); await cGuidedStep(x, "World");
  assert.equal(x.f.tree().visible("textarea").some(node => node.attributes.id === "brief-direction"), false);
  const gesture = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeObservation(t, x, gesture, "hidden-raw-whitespace");
  cAlternativeRefused(x, gesture); await cAlternativeCloseMenu(x); await cGuidedStep(x, "Purpose"); assert.equal(cGuidedField(x).port.value, raw);
  await cAlternativeValue(x, cGuidedField(x), initial.text); await cGuidedStep(x, "World");
  const fresh = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeObservation(t, x, fresh, "explicit-pristine-revert"); cAlternativeDeparted(x);
});
test("C Guided Brief command origin / hidden earlier subtype-only choice refuses then exact revert resolves", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "guided"), initial = cGuidedInitial(x);
  const alternative = blockTypeDefinition("direction").subtypes.find(value => value !== initial.subtype); assert.ok(alternative);
  await cAlternativeValue(x, cGuidedSubtype(x), alternative, "change"); assert.equal(cGuidedField(x).port.value, initial.text); await cGuidedStep(x, "World");
  const gesture = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeObservation(t, x, gesture, "hidden-subtype-only");
  cAlternativeRefused(x, gesture); await cAlternativeCloseMenu(x); await cGuidedStep(x, "Purpose");
  assert.equal(cGuidedSubtype(x).port.value, alternative); assert.equal(cGuidedField(x).port.value, initial.text);
  await cAlternativeValue(x, cGuidedSubtype(x), initial.subtype, "change"); await cGuidedStep(x, "World");
  const fresh = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeObservation(t, x, fresh, "explicit-subtype-revert"); cAlternativeDeparted(x);
});


// Existing precise Board receipt observer, reused by one explicit Guided-only
// control. Its default Board contract is unchanged; neither opt-in permits an
// unarmed request, another event shape, replay or a replacement response.
function cBoardObserveNativeAdds(x, { guidedDirectionSave = false, holdOriginal = false, boardOriginalHold = false } = {}) {
  assert.equal(x.mode, guidedDirectionSave ? "guided" : "board");
  assert.ok(!holdOriginal || guidedDirectionSave, "Original-response holding is opt-in only for the exact Guided Save");
  assert.ok(!boardOriginalHold || !guidedDirectionSave && !holdOriginal, "The separate Board opt-in holds only its exact armed native Add");
  const heldOriginal = holdOriginal || boardOriginalHold;
  const { h, worker, resume } = x, prior = h.transport, records = [], proofs = new WeakMap();
  const original = { history: structuredClone(x.before.history), events: structuredClone(x.before.events), head: x.before.head };
  let armed = null, canonicalWrite = null;
  const witness = request => {
    const proof = proofs.get(request);
    return Boolean(proof && request.init === proof.init && request.init.body === proof.bytes && proof.response.status === 200);
  };
  h.transport = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") {
      if (canonicalWrite) await canonicalWrite;
      return prior(request);
    }
    const a = armed; assert.ok(a, guidedDirectionSave ? "Only the armed genuine Guided direction Save is allowed" : "Only a currently armed genuine Board Add is allowed");
    assert.equal(a.request, null, "One original dispatch per native action, without retry or synthetic events");
    a.request = request; a.init = request.init; a.bytes = request.init.body;
    let release; canonicalWrite = new Promise(resolve => { release = resolve; });
    try {
      await resume.settleOriginalRequests();
      const body = request.body, payload = body.event?.payload;
      assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(body.action, "append"); assert.equal(body.clientId, "web:lit"); assert.equal(body.expectedSequence, a.head);
      assert.equal(body.events.length, 1); assert.deepEqual(body.events[0], body.event); assert.equal(a.bytes, JSON.stringify(body));
      if (guidedDirectionSave) {
        assert.equal(records.length, 0, "This opt-in permits exactly one original Guided edit");
        assert.deepEqual(body.event, a.event, "Only the exact current direction text edit from native Save is admitted");
      } else {
        assert.match(payload.block_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
        assert.deepEqual(body.event, { type: "BlockCreated", payload: {
          block_id: payload.block_id, document_id: x.before.documentId, type: a.type,
          handle: a.type + "/" + a.type + "-board-evidence", position: "z" + String(a.head + 1).padStart(5, "0"),
          properties: { text: a.text, subtype: a.subtype, weight: .65, authority: "authored", created_from: "context-board" },
        } });
      }
      assert.equal(h.store.route.get(), x.before.route); assert.ok(h.store.sourceOwnershipActive(x.before.source));
      assert.ok(h.store.authorizationScopeActive(x.before.authorization));
      const response = await prior(request); assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
      assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]);
      assert.deepEqual(receipt.rejected, []); assert.equal(receipt.appended.length, 1);
      const event = receipt.appended[0]; assert.equal(event.type, guidedDirectionSave ? "BlockPropertyEdited" : "BlockCreated"); assert.deepEqual(event.payload, payload);
      assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit"); assert.equal(event.streamId, worker.streamId);
      assert.equal(event.sequence, a.head + 1); assert.equal(receipt.head, event.sequence); assert.equal(event.compensatesEventId, null);
      assert.equal(event.payload.client_event_id, undefined, "No invented durable receipt key on the existing Board append");
      await worker.drainBackground();
      assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...a.history, event]);
      const row = worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(event.eventId);
      assert.ok(row); assert.equal(row.sequence, event.sequence); assert.equal(row.type, event.type); assert.deepEqual(JSON.parse(row.private_json), payload);
      assert.deepEqual(cAlternativeReceipts(worker), x.before.receipts); assert.deepEqual(financial(worker), x.before.money);
      a.response = response; a.receipt = receipt; records.push(a);
      proofs.set(request, { init: a.init, bytes: a.bytes, response });
      assert.equal(request.init, a.init); assert.equal(request.init.body, a.bytes);
      if (heldOriginal) {
        // Canonical work and its proof are finished. Hold only delivery of the
        // SAME original response; current independent reads remain available.
        canonicalWrite = null; release(); a.held = true;
        await a.deliveryGate;
      }
      return response;
    } finally { canonicalWrite = null; release(); }
  };
  const observed = {
    records, original, isWitnessed: witness,
    async arm(type, subtype) {
      assert.equal(guidedDirectionSave, false, "The Guided-only opt-in cannot arm a Board Add");
      assert.equal(armed, null); await cAlternativeDrain(x);
      const text = type + " board evidence";
      assert.equal(cBoardText(x).port.value, "  " + text + "  ");
      assert.deepEqual(cBoardSelects(x).map(node => node.port.value), [type, subtype]);
      let releaseDelivery;
      const deliveryGate = boardOriginalHold ? new Promise(resolve => { releaseDelivery = resolve; }) : null;
      armed = { type, subtype, text, head: h.store.head.get(), history: await readWorkspaceEvents(worker.env, worker.streamId), request: null,
        ...(boardOriginalHold ? { deliveryGate, releaseDelivery, held: false, released: false } : {}) };
      return armed;
    },
    async armGuidedDirection(raw) {
      assert.equal(guidedDirectionSave, true); assert.equal(armed, null); assert.equal(records.length, 0);
      await cAlternativeDrain(x); cAlternativeOwned(x);
      const projection = h.store.projection.get(), block = projection.blocks.find(value => value.id === "scene-reuse-direction");
      assert.equal(projection.blocks.length, 1); assert.ok(block); assert.equal(block.type, "direction");
      assert.equal(block.documentId, x.before.documentId); assert.equal(block.projectId, x.before.projectId);
      assert.equal(block.properties.source_artifact_id, undefined); assert.equal(block.properties.source_output_id, undefined);
      assert.equal(cGuidedField(x).port.value, raw); assert.notEqual(raw, raw.trim()); assert.ok(raw.trim());
      assert.notEqual(block.properties.text, raw.trim(), "The genuine Save must dispatch an edit, not the already-matches path");
      assert.equal(cGuidedSubtype(x).port.value, String(block.properties.subtype ?? suggestedSubtype("direction")));
      for (const type of ["audience", "message"]) {
        assert.equal(cGuidedField(x, type).port.value, ""); assert.equal(cGuidedSubtype(x, type).port.value, suggestedSubtype(type));
      }
      const event = { type: "BlockPropertyEdited", payload: { block_id: block.id, property_path: "text",
        old_value: block.properties.text, new_value: raw.trim(), source_surface: "guided-brief" } };
      let releaseDelivery;
      const deliveryGate = holdOriginal ? new Promise(resolve => { releaseDelivery = resolve; }) : null;
      armed = { event, raw, head: h.store.head.get(), history: await readWorkspaceEvents(worker.env, worker.streamId), request: null,
        deliveryGate, releaseDelivery, held: false, released: false };
      return armed;
    },
    async reachedOriginal(a) {
      assert.equal(heldOriginal, true); assert.equal(armed, a);
      await untilScene(() => a.held, "The exact original " + (guidedDirectionSave ? "Guided" : "Board") + " Worker200 must reach its delivery hold");
      await observed.assertOriginalHeld(a);
    },
    async assertOriginalHeld(a) {
      assert.equal(heldOriginal, true); assert.equal(armed, a); assert.equal(a.held, true); assert.equal(a.released, false);
      assert.equal(records.length, 1); assert.equal(a.response.status, 200); assert.equal(a.response.bodyUsed, false);
      assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...original.history, ...a.receipt.appended]);
      assert.deepEqual(h.store.events.get(), original.events); assert.equal(h.store.head.get(), original.head);
      assert.deepEqual(cAlternativeReceipts(worker), x.before.receipts); assert.deepEqual(financial(worker), x.before.money);
      assert.ok(h.store.sourceOwnershipActive(x.before.source) && h.store.authorizationScopeActive(x.before.authorization));
      assert.deepEqual(h.requests.filter(request => (request.init.method ?? "GET") !== "GET"
        && !resume.isReadOnlyResume(request) && !witness(request)), []);
    },
    releaseOriginal(a) {
      assert.equal(heldOriginal, true); assert.equal(armed, a);
      if (a.released) return;
      a.released = true; a.releaseDelivery();
    },
    async accept(a) {
      assert.equal(armed, a); assert.ok(a.receipt); assert.equal(a.response.bodyUsed, true, "Actual Store consumed the same positive response");
      const events = [...original.events, ...records.flatMap(record => record.receipt.appended)];
      const history = [...original.history, ...records.flatMap(record => record.receipt.appended)];
      assert.deepEqual(h.store.events.get(), events); assert.equal(h.store.head.get(), a.receipt.head);
      assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), history);
      assert.equal(new Set(records.map(record => record.receipt.appended[0].payload.block_id)).size, records.length);
      // Advance only this fixture's expected baseline after exact original
      // Worker receipt + canonical/private row + current Store publication.
      x.before.events = structuredClone(events); x.before.history = structuredClone(history); x.before.head = a.receipt.head;
      armed = null; await cAlternativeNoWrites(x);
    },
    restore() { h.transport = prior; },
  };
  if (guidedDirectionSave) { assert.equal(x.guidedSave, undefined); x.guidedSave = observed; }
  else { assert.equal(x.boardAdds, undefined); x.boardAdds = observed; }
  return observed;
}
async function cBoardSubmitNativeAdd(x, observed, type, subtype) {
  await cAlternativeValue(x, cBoardSelects(x)[0], type, "change");
  await cAlternativeValue(x, cBoardSelects(x)[1], subtype, "change");
  await cAlternativeValue(x, cBoardText(x), "  " + type + " board evidence  ");
  const a = await observed.arm(type, subtype), tree = x.f.tree();
  const forms = tree.visible("form").filter(node => node.owner === x.owner && cAlternativeClass(node, "board-quick-add"));
  assert.equal(forms.length, 1);
  const buttons = tree.visible("button").filter(node => node.owner === x.owner && cAlternativeInside(node, forms[0])
    && node.text.includes(x.f.i18n.system("Add context")));
  assert.equal(buttons.length, 1); assert.ok(buttons[0].port.isConnected); assert.equal(buttons[0].port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", buttons[0].port); x.f.native.focus(buttons[0].port);
  await x.f.act(forms[0], "submit", { submitter: buttons[0].port });
  await cAlternativeDrain(x); await observed.accept(a); assert.equal(cBoardText(x).port.value, "");
  assert.equal(x.owner.isConnected, true); assert.equal(x.h.store.route.get(), x.before.route);
  return a;
}
test("C Context Board command origin / all lanes after genuine Add retain a clean category and subtype", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board"), observed = cBoardObserveNativeAdds(x); t.after(() => observed.restore());
  cBoardInitial(x);
  for (const type of ["subject", "composition", "format"]) await cBoardSubmitNativeAdd(x, observed, type, suggestedSubtype(type));
  const lastSubtype = blockTypeDefinition("reference").subtypes.find(value => value !== suggestedSubtype("reference")); assert.ok(lastSubtype);
  await cBoardSubmitNativeAdd(x, observed, "reference", lastSubtype);
  assert.equal(observed.records.length, 4);
  assert.deepEqual([...new Set(x.h.store.projection.get().blocks.map(block => blockTypeDefinition(block.type).group))].sort(),
    ["intent", "scene", "craft", "constraint", "evidence"].sort());
  const blocks = x.f.components().filter(owner => owner.tag === "forma-context-block");
  assert.equal(blocks.length, 5); for (const block of blocks) assert.ok(block.isConnected && block.store === x.h.store);
  assert.deepEqual(new Set(blocks.map(owner => owner.block.id)), new Set(x.h.store.projection.get().blocks.map(block => block.id)));
  assert.deepEqual(cBoardSelects(x).map(node => node.port.value), ["reference", lastSubtype],
    "With no missing lane, the real clean form retains the last acknowledged category and nondefault subtype");
  await x.h.store.refreshEvents({ fromStart: true }); await cAlternativeDrain(x);
  assert.deepEqual(cBoardSelects(x).map(node => node.port.value), ["reference", lastSubtype]); assert.equal(cBoardText(x).port.value, "");
  // A genuine type excursion and exact native restoration must not turn the
  // existing sticky selection flag into an irreversible command veto.
  await cAlternativeValue(x, cBoardSelects(x)[0], "subject", "change");
  await cAlternativeValue(x, cBoardSelects(x)[0], "reference", "change");
  await cAlternativeValue(x, cBoardSelects(x)[1], lastSubtype, "change");
  const rawBeforeDeparture = cBoardText(x).port.value;
  const gesture = await cAlternativeCommand(x); await cAlternativeNoWrites(x);
  assert.equal(observed.records.length, 4); assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 4);
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...observed.original.history, ...observed.records.flatMap(record => record.receipt.appended)]);
  assert.deepEqual(cAlternativeReceipts(x.worker), x.before.receipts); assert.deepEqual(financial(x.worker), x.before.money);
  t.diagnostic("C_BOARD_ALL_LANES " + JSON.stringify({ originalAddRequests: 4, originalWorker200: 4, exactBlockCreated: 4,
    rawAfterAcknowledgment: rawBeforeDeparture, lastType: "reference", lastSubtype,
    command: gesture.label, route: x.h.store.route.get(), source: "actual isolated Worker/native Board Add; no provider operation" }));
  cAlternativeDeparted(x);
});

// DocumentContinuity is genuinely rendered in Guided, not in CreativeEditor.
// Reuse the existing full Guided fixture and raw-answer resolution unchanged.
for (const [state, locale] of [["clean", "en"], ["raw", "ja"]])
test("C DocumentContinuity actual Guided baseline / " + state + " / " + locale, cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "guided", locale), { f, h, owner } = x, initial = cGuidedInitial(x);
  await registerCalmFullPageComponents(f, ["forma-workspace"]); await cAlternativeDrain(x);
  const continuities = f.components().filter(element => element.tag === "forma-document-continuity" && element.store === h.store);
  assert.equal(continuities.length, 1); const continuity = continuities[0];
  assert.ok(continuity.isConnected); assert.equal(continuity.parentElement, owner);
  assert.equal(continuity.closest("forma-shell"), f.host); assert.ok(f.host.contains(continuity));
  const destination = withDocumentInRoute("/", x.before.documentId, h.store.projection.get().documentTitle);
  const link = () => f.find("a", node => node.owner === continuity && node.attributes.href === destination);
  const activate = async () => {
    const current = link(); assert.ok(current.port.isConnected && f.renderer.nodes.includes(current.port));
    assert.equal(current.port.matches(":disabled"), false); assert.equal(typeof current.handlers.click, "function");
    assert.equal(h.store.ui.commandOpen, false);
    f.native.emit("pointerdown", current.port); f.native.focus(current.port);
    const gesture = { focus: f.native.nativeFocus.length, scroll: f.native.nativeScroll.length, requests: h.requests.length };
    await f.act(current, "click", { button: 0, defaultPrevented: false }); await cAlternativeDrain(x); return gesture;
  };
  const raw = "  Unsent actual Guided baseline B — 未保存\n  ";
  if (state === "raw") await cAlternativeValue(x, cGuidedField(x), raw);
  const part = cGuidedField(x).propertyParts.value, gesture = await activate(); await cAlternativeNoWrites(x);
  t.diagnostic("C_DOCUMENT_CONTINUITY_BASELINE " + JSON.stringify({ state, locale, before: x.before.route, after: h.store.route.get(),
    originalGuidedConnected: owner.isConnected, requests: h.requests.slice(gesture.requests).map(row => ({ method: row.init.method ?? "GET", url: row.url })),
    originalHistoryReceiptAndFiscalUnchanged: true, evidence: "actual native Guided/baseline/Store/Worker; no physical or provider claim" }));
  if (state === "raw") {
    assert.equal(h.store.route.get(), x.before.route, "The real Open baseline link cannot discard the current Guided answer");
    assert.equal(h.location.pathname + h.location.search + h.location.hash, x.before.route); cAlternativeOwned(x);
    assert.ok(continuity.isConnected); assert.equal(cGuidedField(x).propertyParts.value, part);
    assert.equal(cGuidedField(x).port.value, raw); assert.equal(cGuidedField(x).properties.value, raw);
    assert.equal(cGuidedSubtype(x).port.value, initial.subtype); assert.equal(h.requests.length, gesture.requests);
    assert.equal(f.native.nativeScroll.length, gesture.scroll);
    assert.equal(f.native.nativeFocus.slice(gesture.focus).some(row => row.node.attributes?.id === "main-content"), false);
    await cAlternativeValue(x, cGuidedField(x), initial.text); assert.deepEqual(cGuidedInitial(x), initial);
    await activate(); await cAlternativeNoWrites(x);
  }
  assert.equal(h.store.route.get(), destination); assert.equal(h.location.pathname + h.location.search + h.location.hash, destination);
  assert.equal(owner.isConnected, false); assert.equal(continuity.isConnected, false);
  const workspaces = f.components().filter(element => element.tag === "forma-workspace" && element.store === h.store);
  assert.equal(workspaces.length, 1); assert.ok(workspaces[0].isConnected);
  const title = f.tree().visible("h1").filter(node => node.owner === workspaces[0]); assert.equal(title.length, 1);
  assert.equal(title[0].text, h.store.projection.get().documentTitle);
  assert.equal(h.store.ui.commandOpen, false); await cAlternativeNoWrites(x);
});

// Prospective healthy-path guard: a real acknowledged Save is clean work even
// when its trimmed canonical value differs from the originally entered padding.
// It does not assert how the implementation represents the saved raw draft.
test("C Guided Brief command origin / genuine padded Save and hidden acknowledged section permit fresh departure", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "guided"), initial = cGuidedInitial(x);
  const observed = cBoardObserveNativeAdds(x, { guidedDirectionSave: true }); t.after(() => observed.restore());
  const raw = " \nA purpose saved through the actual current Guided form. \t ";
  assert.notEqual(raw.trim(), initial.text); await cAlternativeValue(x, cGuidedField(x), raw);
  const a = await observed.armGuidedDirection(raw), tree = x.f.tree(), formId = "guided-brief-" + x.before.documentId;
  const forms = tree.visible("form").filter(node => node.owner === x.owner && node.attributes.id === formId);
  assert.equal(forms.length, 1); assert.ok(forms[0].port.isConnected); assert.equal(typeof forms[0].handlers.submit, "function");
  const buttons = tree.visible("button").filter(node => node.owner === x.owner && node.attributes.type === "submit"
    && node.attributes.form === formId && node.text.includes(x.f.i18n.system("Save & continue")));
  assert.equal(buttons.length, 1); assert.ok(buttons[0].port.isConnected); assert.equal(buttons[0].port.matches(":disabled"), false);
  assert.equal(cGuidedField(x).attributes.form, formId);
  x.f.native.emit("pointerdown", buttons[0].port); x.f.native.focus(buttons[0].port);
  await x.f.act(forms[0], "submit", { submitter: buttons[0].port });
  await cAlternativeDrain(x); await observed.accept(a);
  assert.equal(observed.records.length, 1); assert.equal(a.response.status, 200); assert.equal(a.response.bodyUsed, true);
  assert.equal(x.h.store.ui.toast, x.f.i18n.system("{section} saved to the document.", { section: x.f.i18n.system("Purpose") }),
    "An unchanged acknowledged section retains its ordinary localized success notice");
  assert.deepEqual(a.receipt.appended.map(event => ({ type: event.type, payload: event.payload })), [a.event]);
  assert.deepEqual(x.h.store.projection.get().blocks.map(block => ({ id: block.id, text: block.properties.text })),
    [{ id: "scene-reuse-direction", text: raw.trim() }]);
  assert.equal(x.h.store.route.get(), x.before.route); cAlternativeOwned(x);
  const afterSave = x.f.tree(), current = afterSave.visible("button").filter(node => node.owner === x.owner && node.attributes["aria-current"] === "step");
  assert.equal(current.length, 1); assert.ok(current[0].text.includes(x.f.i18n.system("World")), "The genuine Save itself advances to the next section");
  assert.equal(afterSave.visible("textarea").some(node => node.owner === x.owner && node.attributes.id === "brief-direction"), false,
    "The acknowledged Purpose answer is now in the hidden earlier step");
  // The receipt was verified before this read; a GET is never substituted for ACK.
  await x.h.store.refreshEvents({ fromStart: true }); await cAlternativeDrain(x); await cAlternativeNoWrites(x);
  const gesture = await cAlternativeCommand(x); await cAlternativeNoWrites(x);
  assert.equal(observed.records.length, 1);
  assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...observed.original.history, ...a.receipt.appended]);
  assert.deepEqual(cAlternativeReceipts(x.worker), x.before.receipts); assert.deepEqual(financial(x.worker), x.before.money);
  t.diagnostic("C_GUIDED_SAVED_PADDING " + JSON.stringify({ originalSaveRequests: 1, originalWorker200: 1, exactTextEdits: 1,
    normalizedCanonicalText: raw.trim(), acknowledgedSectionHidden: true, command: gesture.label, route: x.h.store.route.get(),
    source: "actual isolated Worker/native Guided Save and Shell command; no generic POST, provider or physical-geometry claim" }));
  cAlternativeDeparted(x);
});


// Representative embedded navigation, using the existing complete Board,
// ContextBlock, EventInspector, Shell and actual Store/isolated Worker fixture.
// location.assign is only a native boundary observation: it does not mount an
// Engineering application or manufacture a route/handoff/authorization result.
function cEmbeddedNativeLocation(t, x) {
  const calls = [], location = x.h.location, original = Object.getOwnPropertyDescriptor(location, "assign");
  Object.defineProperty(location, "assign", { configurable: true, writable: true, value(path) {
    assert.equal(this, location); assert.equal(path, "/engineering/events");
    assert.ok(x.h.store.sourceOwnershipActive(x.before.source) && x.h.store.authorizationScopeActive(x.before.authorization));
    calls.push(String(path));
  } });
  t.after(() => { if (original) Object.defineProperty(location, "assign", original); else delete location.assign; });
  return calls;
}
async function cEmbeddedOpenHistory(x) {
  assert.ok(x.h.store.session.get().capabilities.includes("engineering.events.read"),
    "The existing actual local-bootstrap session already has Engineering access; no capability is invented");
  const blocks = x.f.components().filter(owner => owner.tag === "forma-context-block"
    && owner.block.id === "scene-reuse-direction" && owner.surface === "board");
  assert.equal(blocks.length, 1); assert.ok(blocks[0].isConnected && blocks[0].store === x.h.store);
  const why = x.f.find("button", node => node.owner === blocks[0] && cAlternativeClass(node, "why-button"));
  x.f.native.emit("pointerdown", why.port); x.f.native.focus(why.port); await x.f.act(why, "click", { button: 0 });
  await cAlternativeDrain(x);
  assert.equal(x.h.store.ui.inspectorOpen, true);
  assert.equal(x.h.store.ui.selectedEventId, blocks[0].block.sourceEvents.at(-1));
  const inspectors = x.f.components().filter(owner => owner.tag === "forma-event-inspector");
  assert.equal(inspectors.length, 1); assert.ok(inspectors[0].isConnected && inspectors[0].store === x.h.store);
  return inspectors[0];
}
async function cEmbeddedOpenEngineering(x, inspector) {
  const details = x.f.find("details", node => node.owner === inspector && cAlternativeClass(node, "provenance-technical"));
  if (!details.port.open) {
    const summary = x.f.find("summary", node => node.owner === inspector && node.parent?.port === details.port);
    assert.ok(summary.port.isConnected); assert.equal(summary.handlers.click, undefined);
    x.f.native.emit("pointerdown", summary.port); x.f.native.focus(summary.port);
    // Existing finite native-summary default: toggle this current connected
    // details node only, without a Lit draw, application callback or command.
    details.port.open = true;
  }
  const label = x.f.i18n.t("workspace.provenance.engineering", "Open Engineering Diagnostics");
  const button = x.f.find("button", node => {
    if (node.owner !== inspector || !node.text.includes(label)) return false;
    for (let parent = node.parent; parent; parent = parent.parent) if (parent.port === details.port) return true;
    return false;
  });
  assert.ok(button.port.isConnected); assert.equal(button.port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", button.port); x.f.native.focus(button.port);
  const requestStart = x.h.requests.length;
  await x.f.act(button, "click", { button: 0 }); await cAlternativeDrain(x);
  return requestStart;
}

test("C embedded EventInspector navigation / pristine actual Why reaches only the exact Engineering native boundary", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board"); cBoardInitial(x);
  const calls = cEmbeddedNativeLocation(t, x), inspector = await cEmbeddedOpenHistory(x);
  const requestStart = await cEmbeddedOpenEngineering(x, inspector); await cAlternativeNoWrites(x);
  assert.deepEqual(calls, ["/engineering/events"]);
  assert.equal(x.h.requests.length, requestStart, "The native cross-application boundary creates no fixture API request");
  assert.equal(x.h.store.route.get(), x.before.route, "This observation does not fake loading the destination app");
  t.diagnostic("C_EMBEDDED_ENGINEERING_NATIVE_BOUNDARY " + JSON.stringify({ case: "pristine", assignments: calls.length,
    sourceAndFiscalUnchanged: true, destinationApplicationMounted: false, physicalBrowserClaim: false }));
});

test("C embedded EventInspector navigation / another current Board raw field refuses; exact clear permits native departure", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board"), raw = "  Unsent Board decision before inspecting history  "; cBoardInitial(x);
  const calls = cEmbeddedNativeLocation(t, x);
  await cAlternativeValue(x, cBoardText(x), raw);
  const inspector = await cEmbeddedOpenHistory(x), requestStart = await cEmbeddedOpenEngineering(x, inspector);
  await cAlternativeNoWrites(x);
  t.diagnostic("C_EMBEDDED_ENGINEERING_NATIVE_BOUNDARY " + JSON.stringify({ case: "raw", assignments: calls.length,
    sameSource: x.h.store.route.get() === x.before.route, sourceAndFiscalUnchanged: true,
    destinationApplicationMounted: false, physicalBrowserClaim: false }));
  assert.deepEqual(calls, [], "A real embedded link must not request native departure while its current parent owns raw work");
  assert.equal(x.h.requests.length, requestStart); cAlternativeOwned(x);
  assert.ok(inspector.isConnected); assert.equal(x.h.store.ui.inspectorOpen, true);
  assert.equal(cBoardText(x).port.value, raw);
  await cAlternativeValue(x, cBoardText(x), ""); cBoardInitial(x);
  await cEmbeddedOpenEngineering(x, inspector); await cAlternativeNoWrites(x);
  assert.deepEqual(calls, ["/engineering/events"], "Only the new explicit click after clearing raw work may reach the native boundary");
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/components/context-block.ts", import.meta.url), "utf8");
  assert.ok(source.includes('@click=${()=>navigateInApp(this,navigation=>navigation.route("/library"))}'),
    "The governed Library caller uses the same admission; this is source-only, not a fabricated package/binding exercise");
});


// One explicit, separate same-principal API writer changes canonical Source;
// the untouched current Guided host learns it only through its actual GET.
async function cGuidedAdvancePristineCanonical(x, text) {
  await cAlternativeDrain(x); cAlternativeOwned(x);
  const { h, worker } = x, block = h.store.projection.get().blocks.find(value => value.id === "scene-reuse-direction");
  assert.ok(block); assert.equal(block.type, "direction"); assert.equal(block.documentId, x.before.documentId);
  assert.equal(block.projectId, x.before.projectId); assert.notEqual(block.properties.text, text);
  const original = { events: structuredClone(x.before.events), history: structuredClone(x.before.history), head: x.before.head };
  const input = { type: "BlockPropertyEdited", payload: { block_id: block.id, property_path: "text",
    old_value: block.properties.text, new_value: text, source_surface: "guided-pristine-source-control" } };
  const body = { action: "append", clientId: "web:guided-source-control", expectedSequence: original.head, event: input, events: [input] };
  const init = worker.json(body), bytes = init.body, requests = h.requests.length;
  assert.equal(x.resume.pendingOriginalCount(), 0);
  const response = await worker.request("/api/events", init);
  assert.equal(response.status, 200, await response.clone().text()); assert.equal(response.bodyUsed, false);
  const receipt = await response.json(); assert.equal(response.bodyUsed, true);
  assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]);
  assert.deepEqual(receipt.rejected, []); assert.equal(receipt.appended.length, 1);
  const event = receipt.appended[0];
  assert.equal(event.type, input.type); assert.deepEqual(event.payload, input.payload);
  assert.equal(event.actor, "user"); assert.equal(event.clientId, body.clientId); assert.equal(event.streamId, worker.streamId);
  assert.equal(event.sequence, original.head + 1); assert.equal(receipt.head, event.sequence);
  assert.equal(event.compensatesEventId, null); assert.equal(event.payload.client_event_id, undefined);
  assert.equal(init.body, bytes); assert.equal(bytes, JSON.stringify(body)); await worker.drainBackground();
  assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...original.history, event]);
  const row = worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(event.eventId);
  assert.ok(row); assert.equal(row.sequence, event.sequence); assert.equal(row.type, input.type);
  assert.deepEqual(JSON.parse(row.private_json), input.payload);
  assert.deepEqual(cAlternativeReceipts(worker), x.before.receipts); assert.deepEqual(financial(worker), x.before.money);
  assert.deepEqual(h.store.events.get(), original.events); assert.equal(h.store.head.get(), original.head);
  assert.equal(h.requests.length, requests, "The separate actual API writer is not a current-host Save or synthetic local publication");
  assert.ok(h.store.sourceOwnershipActive(x.before.source) && h.store.authorizationScopeActive(x.before.authorization));
  await h.store.refreshEvents({ fromStart: true }); await cAlternativeDrain(x);
  assert.deepEqual(h.store.events.get(), [...original.events, event]); assert.equal(h.store.head.get(), receipt.head);
  assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...original.history, event]);
  assert.equal(h.store.projection.get().blocks.find(value => value.id === block.id).properties.text, text);
  assert.equal(h.store.route.get(), x.before.route); cAlternativeOwned(x);
  // Update only the existing fixture expectation after exact canonical proof
  // and actual current Source publication, with no application receipt inferred.
  x.before.events = structuredClone(h.store.events.get()); x.before.history = [...original.history, event]; x.before.head = receipt.head;
  await cAlternativeNoWrites(x);
  return { original, event, responseStatus: response.status };
}
test("C Guided Brief command origin / untouched hidden answer follows same-Document canonical refresh", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "guided"), initial = cGuidedInitial(x);
  await cGuidedStep(x, "World");
  assert.equal(x.f.tree().visible("textarea").some(node => node.owner === x.owner && node.attributes.id === "brief-direction"), false);
  const text = "The same current document now protects the harbor at sunrise.";
  const observed = await cGuidedAdvancePristineCanonical(x, text);
  await cGuidedStep(x, "Purpose");
  const rawAfterRead = cGuidedField(x).port.value, subtypeAfterRead = cGuidedSubtype(x).port.value;
  assert.equal(x.h.store.projection.get().documentId, x.before.documentId); assert.equal(x.owner.isConnected, true);
  await cGuidedStep(x, "World");
  const gesture = await cAlternativeCommand(x); await cAlternativeNoWrites(x);
  assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 0,
    "The current Guided host did not Save, replay or replace the separate acknowledged canonical edit");
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...observed.original.history, observed.event]);
  t.diagnostic("C_GUIDED_PRISTINE_REFRESH " + JSON.stringify({ originalSeparateApiWrites: 1, originalWorker200: observed.responseStatus,
    sourceText: text, nativeUntouchedTextAfterCurrentRead: rawAfterRead, nativeSubtypeAfterRead: subtypeAfterRead,
    originalDocument: x.before.documentId, route: x.h.store.route.get(), command: gesture.label,
    sameSourceAuthorizationHistoryAndFiscalVerified: true,
    evidence: "separate authorized request under the same fixture principal, actual Worker and current GET; not a second-human or native Save claim" }));
  assert.equal(rawAfterRead, text, "A pristine answer follows the current canonical value without remounting this Document");
  assert.equal(subtypeAfterRead, initial.subtype); cAlternativeDeparted(x);
});


// Additional phase controls preserve the exact same original Worker response.
// No application callback, local state or Store method is replaced.
function cGuidedStartNativeSectionSave(x) {
  const tree = x.f.tree(), id = "guided-brief-" + x.before.documentId;
  const forms = tree.visible("form").filter(node => node.owner === x.owner && node.attributes.id === id);
  assert.equal(forms.length, 1); assert.ok(forms[0].port.isConnected); assert.equal(typeof forms[0].handlers.submit, "function");
  const buttons = tree.visible("button").filter(node => node.owner === x.owner && node.attributes.type === "submit"
    && node.attributes.form === id && node.text.includes(x.f.i18n.system("Save & continue")));
  assert.equal(buttons.length, 1); assert.ok(buttons[0].port.isConnected); assert.equal(buttons[0].port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", buttons[0].port); x.f.native.focus(buttons[0].port);
  return x.f.act(forms[0], "submit", { submitter: buttons[0].port });
}
function cGuidedCurrentStep(x) {
  const current = x.f.tree().visible("button").filter(node => node.owner === x.owner && node.attributes["aria-current"] === "step");
  assert.equal(current.length, 1); return current[0].text;
}
test("C Guided Brief original Save / acknowledged A keeps newer B visible in the current section", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "guided"), observed = cBoardObserveNativeAdds(x, { guidedDirectionSave: true, holdOriginal: true });
  t.after(() => observed.restore()); cGuidedInitial(x);
  const rawA = "  Original A saved while the current Guided answer stays editable.  ", rawB = " \nNewer B remains an unsent answer. \t ";
  await cAlternativeValue(x, cGuidedField(x), rawA); const a = await observed.armGuidedDirection(rawA);
  const saving = cGuidedStartNativeSectionSave(x);
  try {
    await observed.reachedOriginal(a); await cAlternativeValue(x, cGuidedField(x), rawB);
    assert.equal(cGuidedField(x).port.value, rawB); assert.ok(cGuidedCurrentStep(x).includes(x.f.i18n.system("Purpose")));
    await observed.assertOriginalHeld(a);
  } finally {
    observed.releaseOriginal(a); await saving; await cAlternativeDrain(x); await observed.accept(a);
  }
  const completionNotice = x.h.store.ui.toast;
  const stepAfterAck = cGuidedCurrentStep(x), after = x.f.tree().visible("textarea")
    .filter(node => node.owner === x.owner && node.attributes.id === "brief-direction");
  assert.ok(after.length <= 1); const visibleRawAfterAck = after[0]?.port.value ?? null;
  if (!after.length) await cGuidedStep(x, "Purpose");
  const retainedRaw = cGuidedField(x).port.value;
  const refused = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeRefused(x, refused);
  assert.equal(cGuidedField(x).port.value, rawB); await cAlternativeCloseMenu(x);
  await cAlternativeValue(x, cGuidedField(x), rawA.trim());
  const fresh = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeDeparted(x);
  assert.equal(observed.records.length, 1);
  assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
  t.diagnostic("C_GUIDED_HELD_NEWER " + JSON.stringify({ originalWorker200: 1, originalTextEdits: 1, stepAfterAck,
    visibleRawAfterAck, retainedRawAfterPublicReveal: retainedRaw, completionNotice, explicitResolutionCommand: fresh.label,
    exactOriginalHistoryReceiptAndFiscalVerified: true, evidence: "actual original response held after real Worker commit; no replay or provider" }));
  assert.equal(retainedRaw, rawB, "Only B is unsent; the exact original A is acknowledged");
  assert.ok(stepAfterAck.includes(x.f.i18n.system("Purpose")), "The original completion must not advance away from newer input");
  assert.equal(visibleRawAfterAck, rawB, "Newer B stays visibly editable without a corrective step revisit");
  assert.equal(completionNotice, x.f.i18n.t("guided.save.newerEditsKept", "The earlier submission was saved. Your newer edits are still here."),
    "The actual completion notice distinguishes acknowledged A from the newer B that was not submitted");
});
test("C Guided Brief original Save / restoring known canonical raw still blocks pending departure until ACK", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "guided"), initial = cGuidedInitial(x);
  const observed = cBoardObserveNativeAdds(x, { guidedDirectionSave: true, holdOriginal: true }); t.after(() => observed.restore());
  const rawA = "  Original A has committed but its exact acknowledgment is still held.  ";
  await cAlternativeValue(x, cGuidedField(x), rawA); const a = await observed.armGuidedDirection(rawA);
  const saving = cGuidedStartNativeSectionSave(x); let pending;
  try {
    await observed.reachedOriginal(a); await cAlternativeValue(x, cGuidedField(x), initial.text);
    assert.equal(cGuidedField(x).port.value, initial.text);
    const gesture = await cAlternativeCommand(x); await observed.assertOriginalHeld(a);
    pending = { route: x.h.store.route.get(), originalConnected: x.owner.isConnected,
      requests: x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length,
      command: gesture.label };
  } finally {
    observed.releaseOriginal(a); await saving; await cAlternativeDrain(x); await observed.accept(a);
  }
  assert.equal(observed.records.length, 1);
  t.diagnostic("C_GUIDED_HELD_RESTORE " + JSON.stringify({ pending, originRoute: x.before.route,
    originalWorker200: 1, exactOriginalResponseConsumedAfterRelease: a.response.bodyUsed,
    exactOriginalHistoryReceiptAndFiscalVerified: true, evidence: "pending admission, not raw inequality or inferred GET acknowledgment" }));
  assert.equal(pending.requests, 1); assert.equal(pending.route, x.before.route, "A real original Save remains pending even when visible raw equals the known canonical seed");
  assert.equal(pending.originalConnected, true); cAlternativeOwned(x);
  const fresh = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeDeparted(x);
  assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
  assert.ok(fresh.label);
});
test("C Guided Brief original Save / padded already-matches action performs no write and permits fresh departure / ja", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "guided", "ja"), initial = cGuidedInitial(x), raw = " \n" + initial.text + " \t ";
  await cAlternativeValue(x, cGuidedField(x), raw); assert.equal(cGuidedField(x).port.value, raw);
  await cGuidedStartNativeSectionSave(x); await cAlternativeDrain(x); await cAlternativeNoWrites(x);
  assert.equal(x.h.store.ui.toast, x.f.i18n.system("{section} already matches the document.", { section: x.f.i18n.system("Purpose") }),
    "A deliberate no-dispatch Save retains the existing localized already-matches notice");
  assert.ok(cGuidedCurrentStep(x).includes(x.f.i18n.system("World")));
  const fresh = await cAlternativeCommand(x); await cAlternativeNoWrites(x);
  assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 0);
  t.diagnostic("C_GUIDED_ALREADY_MATCHES " + JSON.stringify({ nativeSave: true, authoringRequests: 0,
    canonicalTextUnchanged: initial.text, route: x.h.store.route.get(), command: fresh.label,
    exactOriginalHistoryReceiptAndFiscalUnchanged: true, evidence: "deliberate current no-op Save; no receipt or ACK invented" }));
  cAlternativeDeparted(x);
});

// Actual noncompact GenerationActions in Board's existing full
// DocumentGenerations contains the compact native ImageFormat disclosure.
// These cases exercise that genuine child; no mode, controller or Source is replaced.


async function cImageFrame(x) {
  const children = x.f.components().filter(element => element.tag === "forma-image-format-editor"
    && element.parentElement?.tag === "forma-generation-actions" && element.parentElement.source === "board");
  assert.equal(children.length, 1); const child = children[0];
  assert.ok(child.isConnected && child.store === x.h.store); assert.equal(child.compact, true);
  assert.equal(child.parentElement.compact, false);
  cImageFrameNative(x, child);
  const details = x.f.find("details", node => node.owner === child && cAlternativeClass(node, "image-format-control"));
  if (!details.port.open) {
    const summary = x.f.find("summary", node => node.owner === child && node.parent?.port === details.port);
    assert.ok(summary.port.isConnected); assert.equal(summary.handlers.click, undefined);
    x.f.native.emit("pointerdown", summary.port); x.f.native.focus(summary.port);
    details.port.open = true; // Explicit current native summary default; not an app callback.
  }
  const form = x.f.find("form", node => node.owner === child && cAlternativeClass(node, "image-format-form"));
  const field = name => x.f.find("input", node => node.owner === child && node.attributes.name === name);
  assert.ok(form.port.isConnected); assert.ok(field("width").port.isConnected && field("height").port.isConnected);
  return { child, details: details.port, form: () => x.f.find("form", node => node.owner === child && cAlternativeClass(node, "image-format-form")), field };
}
async function cImageFrameRaw(x, frame, name, value) {
  const node = frame.field(name); assert.equal(node.attributes.type, "number");
  assert.equal(node.port.matches(":disabled"), false); assert.equal(node.handlers.input, undefined);
  x.f.native.emit("pointerdown", node.port); x.f.native.focus(node.port);
  node.port.value = value; x.f.native.emit("input", node.port); await x.f.settle();
  assert.equal(frame.field(name).port.value, value, "Real native field retains its current raw value without an application input handler");
}

test("C ImageFormat ordinary custody / populated current dimensions and unchanged custom selector are pristine", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board"), frame = await cImageFrame(x); cBoardInitial(x);
  assert.equal(frame.field("width").port.value, "1536"); assert.equal(frame.field("height").port.value, "1024");
  const preset = x.f.find("select", node => node.owner === frame.child && node.attributes.name === "preset");
  assert.equal(preset.port.value, "3:2"); preset.port.value = "custom";
  await x.f.act(preset, "change");
  assert.equal(frame.field("width").port.value, "1536"); assert.equal(frame.field("height").port.value, "1024");
  await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeDeparted(x);
});

test("C ImageFormat ordinary custody / closed disclosure retains raw width; exact canonical revert permits departure", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board"), frame = await cImageFrame(x); cBoardInitial(x);
  await cImageFrameRaw(x, frame, "width", "1600");
  const raw = frame.field("width").port;
  const summary = x.f.find("summary", node => node.owner === frame.child && node.parent?.port === frame.details);
  assert.equal(summary.handlers.click, undefined); x.f.native.emit("pointerdown", summary.port); x.f.native.focus(summary.port);
  frame.details.open = false; // Same native summary close; the exact child/form remain connected, not removed.
  assert.ok(raw.isConnected && frame.child.isConnected);
  assert.equal(x.f.tree().visible("input").filter(node => node.owner === frame.child).length, 0);
  const gesture = await cAlternativeCommand(x); await cAlternativeNoWrites(x);
  cAlternativeRefused(x, gesture); assert.ok(frame.child.isConnected && raw.isConnected); assert.equal(raw.value, "1600");
  const reopened = await cImageFrame(x); assert.equal(reopened.child, frame.child); assert.equal(reopened.field("width").port, raw);
  await cImageFrameRaw(x, reopened, "width", "1536");
  await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeDeparted(x);
});

test("C ImageFormat ordinary custody / held original Apply stays owned after actual current GET matches fields", cAlternativeOptions, async t => {
  const { sceneDeferred, untilScene } = await import("./helpers/scene-cost-store-host.mjs");
  const { normalizeImageFormat, documentImageFormat } = await import("../src/model/image-format.ts");
  const x = await cAlternativePage(t, "board"), frame = await cImageFrame(x); cBoardInitial(x);
  const { h, worker } = x, prior = h.transport, release = sceneDeferred(), proofs = new WeakMap();
  const original = { events: structuredClone(x.before.events), history: structuredClone(x.before.history), head: x.before.head };
  const expectedFormat = normalizeImageFormat({ dimensions: { width: 1600, height: 1024, unit: "px" } });
  let record = null, jsonStarted = false, jsonReleased = false, submission;
  x.frameSave = { isWitnessed(request) {
    const proof = proofs.get(request);
    return Boolean(proof && request.init === proof.init && request.init.body === proof.bytes && proof.response.status === 200);
  } };
  h.transport = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") return prior(request);
    assert.equal(record, null, "One exact original native Apply, never a replacement or retry");
    const body = request.body, payload = body.event?.payload, init = request.init, bytes = request.init.body;
    assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
    assert.equal(body.action, "append"); assert.equal(body.clientId, "web:lit"); assert.equal(body.expectedSequence, original.head);
    assert.equal(body.events.length, 1); assert.deepEqual(body.events[0], body.event); assert.equal(bytes, JSON.stringify(body));
    assert.match(payload.block_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
    assert.deepEqual(body.event, { type: "BlockCreated", payload: {
      block_id: payload.block_id, document_id: x.before.documentId, project_id: x.before.projectId, type: "format",
      handle: "format/25x16", position: "p0001", properties: {
        text: "Create for a 25:16 frame at 1600 × 1024 pixels.", subtype: "Resolution", weight: 1, intent: "include",
        authority: "authored", image_format: expectedFormat, created_from: "board"
      }
    } });
    assert.ok(h.store.sourceOwnershipActive(x.before.source) && h.store.authorizationScopeActive(x.before.authorization));
    record = { request, init, bytes, response: null, receipt: null };
    const response = await prior(request); assert.equal(response.status, 200, await response.clone().text());
    const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
    assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]);
    assert.deepEqual(receipt.rejected, []); assert.equal(receipt.appended.length, 1);
    const event = receipt.appended[0]; assert.equal(event.type, "BlockCreated"); assert.deepEqual(event.payload, payload);
    assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit"); assert.equal(event.streamId, worker.streamId);
    assert.equal(event.sequence, original.head + 1); assert.equal(receipt.head, event.sequence);
    assert.equal(event.compensatesEventId, null); assert.equal(event.payload.client_event_id, undefined);
    await worker.drainBackground();
    assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...original.history, event]);
    const row = worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(event.eventId);
    assert.ok(row); assert.equal(row.sequence, event.sequence); assert.equal(row.type, event.type); assert.deepEqual(JSON.parse(row.private_json), payload);
    assert.deepEqual(cAlternativeReceipts(worker), x.before.receipts); assert.deepEqual(financial(worker), x.before.money);
    record.response = response; record.receipt = receipt; proofs.set(request, { init, bytes, response });
    const json = response.json.bind(response);
    response.json = async () => { assert.equal(jsonStarted, false); jsonStarted = true; await release.promise; jsonReleased = true; return json(); };
    return response; // Same original Worker response; only its body delivery is held.
  };
  try {
    await cImageFrameRaw(x, frame, "width", "1600");
    const form = frame.form(), submit = x.f.find("button", node => node.owner === frame.child && node.attributes.type === "submit");
    assert.ok(form.port.isConnected && submit.port.isConnected); assert.equal(submit.port.matches(":disabled"), false);
    x.f.native.emit("pointerdown", submit.port); x.f.native.focus(submit.port);
    submission = x.f.act(form, "submit", { submitter: submit.port });
    await untilScene(() => Boolean(record?.receipt && jsonStarted), "Original real Worker 200 exists; actual Apply still awaits its original body");
    assert.equal(jsonReleased, false); assert.equal(record.response.bodyUsed, false);
    // A separate genuine current source read supplies the same committed frame
    // while Apply still owns its earlier acknowledgment. No field is edited disabled.
    await h.store.refreshEvents({ fromStart: true }); await cAlternativeDrain(x);
    const expectedEvents = [...original.events, ...record.receipt.appended], expectedHistory = [...original.history, ...record.receipt.appended];
    assert.deepEqual(h.store.events.get(), expectedEvents); assert.equal(h.store.head.get(), record.receipt.head);
    assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), expectedHistory);
    const current = documentImageFormat(h.store.projection.get().blocks);
    assert.equal(current.blockId, record.receipt.appended[0].payload.block_id); assert.deepEqual(current.format, expectedFormat);
    x.before.events = structuredClone(expectedEvents); x.before.history = structuredClone(expectedHistory); x.before.head = record.receipt.head;
    assert.equal(frame.field("width").port.value, "1600"); assert.equal(frame.field("height").port.value, "1024");
    assert.equal(frame.field("width").port.matches(":disabled"), true, "Actual existing pending Apply still disables its fields");
    const gesture = await cAlternativeCommand(x); await cAlternativeNoWrites(x);
    t.diagnostic("C_IMAGE_FORMAT_PENDING_ORIGINAL " + JSON.stringify({ originalWorkerStatus: record.response.status,
      originalEventId: record.receipt.appended[0].eventId, originalBlockId: current.blockId, exactCurrentRead: true,
      originalBodyDelivered: jsonReleased, currentFieldMatchesCanonical: true, route: h.store.route.get(), origin: x.before.route,
      writes: 1, unchangedFiscalAndClientReceipts: true, evidence: "actual full host/current fields/Worker 200 and separate source read; no provider or physical claim" }));
    cAlternativeRefused(x, gesture); assert.ok(frame.child.isConnected); assert.equal(jsonReleased, false);
    release.resolve(); await submission; await cAlternativeDrain(x);
    assert.equal(jsonReleased, true); assert.equal(record.response.bodyUsed, true);
    assert.equal(frame.field("width").port.matches(":disabled"), false);
    assert.equal(h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
    const settledCustody = cImageFrameSettledCustody(x);
    t.diagnostic("C_IMAGE_FORMAT_SETTLED_CUSTODY_BEFORE " + JSON.stringify(settledCustody()));
    await cAlternativeCommand(x); await cAlternativeNoWrites(x);
    t.diagnostic("C_IMAGE_FORMAT_SETTLED_CUSTODY_AFTER " + JSON.stringify(settledCustody()));
    cAlternativeDeparted(x);
  } finally {
    release.resolve(); if (submission) await submission; h.transport = prior;
  }
});

// Observe public, read-only departure predicates across the existing command;
// no new draw, request, app accessor, field edit or expected-result assertion.
function cImageFrameSettledCustody(x) {
  const read = run => { try { return { value: run() }; } catch (error) { return { error: String(error) }; } };
  const records = x.f.components().filter(element => element === x.owner || element.tag === "forma-image-format-editor")
    .map(element => ({ element, form: element.querySelector(".image-format-form"), capture: element.captureCommandDeparture() }));
  return () => ({ route: x.h.store.route.get(), originalBodyAlreadySettled: true,
    sourceCurrent: x.h.store.sourceOwnershipActive(x.before.source),
    owners: records.map(({ element, form, capture }) => {
      const currentForm = element.querySelector(".image-format-form");
      return { tag: element.tag, compact: element.compact ?? null, surface: element.surface ?? null,
        blockId: element.block?.id ?? null, originalFrame: element === x.imageFormatNative.owner,
        connected: element.isConnected, captureCurrent: read(() => capture.current()), blocked: read(() => capture.blocked()),
        formPresent: Boolean(currentForm), originalFormConnected: Boolean(form?.isConnected), formIsOriginal: currentForm === form,
        nativeElementsPresent: Boolean(currentForm?.elements),
        width: read(() => currentForm?.elements?.namedItem("width")?.value ?? null),
        height: read(() => currentForm?.elements?.namedItem("height")?.value ?? null),
        literalFields: x.f.renderer.ownNodes(element, "input").filter(node => ["width", "height"].includes(node.attributes.name))
          .map(node => ({ name: node.attributes.name, value: node.value, connected: node.isConnected, disabled: node.matches(":disabled") })) };
    }) });
}

// The actual same-template failure dialog remains one native node across a
// refusal toast redraw. Do not reacquire a different report or change its
// visibility, handlers, resource identity, child state or opening decisions.
function cGenerationFailureDialogNative(x, owner) {
  if (x.generationFailureDialogNative) { assert.equal(x.generationFailureDialogNative, owner); return; }
  assert.ok(owner.isConnected && owner.tag === "forma-generation-actions" && owner.store === x.h.store);
  const { f } = x, draw = f.renderer.draw.bind(f.renderer), value = f.renderer.value.bind(f.renderer), collect = f.renderer.collect.bind(f.renderer);
  let drawing = false, description = null, retained = null, seen = false;
  const retire = () => { if (retained) { retained.node.isConnected = false; retained.node.parentElement = null; retained = null; } };
  f.renderer.value = (part, current, path, caches) => {
    if (drawing && current === owner && part?.strings && /^\s*<dialog\b/u.test(part.strings[0])
      && /class="modal generation-failures-dialog"/u.test(part.strings[0])) description = { path, strings: part.strings };
    return value(part, current, path, caches);
  };
  f.renderer.collect = (markup, current) => {
    const start = f.renderer.nodes.length; collect(markup, current);
    if (!drawing || current !== owner || !description) return;
    const dialogs = f.renderer.nodes.slice(start).filter(node => node.tag === "dialog" && node.classList.contains("generation-failures-dialog"));
    assert.equal(dialogs.length, 1); const fresh = dialogs[0];
    assert.equal(Object.hasOwn(fresh.properties, "open"), false);
    assert.equal(Object.hasOwn(fresh.attributes, "open"), false, "Actual report lets its existing modal setup own open state");
    const same = retained && retained.node.isConnected && retained.store === owner.store
      && retained.path === description.path && retained.strings === description.strings;
    if (!same) { retire(); retained = { ...description, store: owner.store, node: fresh }; }
    const node = retained.node, open = node.open;
    for (const property of ["full", "handlers", "properties", "propertyParts"]) node[property] = fresh[property];
    node.attributes = { ...fresh.attributes }; node.parentElement = owner; node.isConnected = true;
    Object.defineProperty(node, "open", { configurable: true,
      get: () => Object.hasOwn(node.attributes, "open"),
      set: on => { if (on) node.attributes.open = ""; else delete node.attributes.open; } });
    node.open = open;
    const index = f.renderer.nodes.indexOf(fresh); assert.ok(index >= 0); f.renderer.nodes[index] = node;
    if (fresh !== node) fresh.isConnected = false;
    seen = true;
  };
  f.renderer.draw = (...args) => {
    drawing = true; description = null; seen = false;
    try { return draw(...args); }
    finally {
      drawing = false;
      if (!seen || !owner.isConnected || !retained || !f.renderer.nodes.includes(retained.node)) retire();
    }
  };
  x.generationFailureDialogNative = owner;
  f.draw();
}

// One explicitly seeded historical failure, then actual current Worker GET and
// full report controls. The seed is not a provider execution or paid receipt.
async function cGenerationReport(x) {
  cImageFrameNative(x); // Every actual ImageFormat owner, including this pristine report fixture.
  const { h, worker, f } = x, jobId = "fixture-historical-source-review", now = new Date().toISOString();
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  const detail = { code: "content_policy_violation", category: "safety", scope: "request", action: "edit_request",
    message: "Safety check stopped the fixture-only request.", retryable: false, retryAfterMs: null, requestId: null, httpStatus: null,
    riskCategories: ["fixture-source-review"], contributingBlockIds: ["scene-reuse-direction"], contributingReferenceIds: [] };
  const request = { documentRevision: h.store.documentGenerationRevision(), promptTechnique: "prose", productionMode: "manual" };
  worker.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,notified_at,expires_at,updated_at) VALUES(?,?,?,?,?,'failed','board',?,?,?,?,?,1,?,?,?,?,?,?)")
    .run(jobId, worker.owner, worker.streamId, worker.documentId, "generate", "fixture:historical-source-review:1", x.before.head,
      JSON.stringify(request), JSON.stringify({ stage: "failed", errorDetail: detail }), "content_policy_violation",
      now, now, now, now, expires, now);
  const rows = () => worker.sqlite.prepare("SELECT * FROM document_jobs ORDER BY rowid").all(), originalRows = rows();
  // Only this disclosed historical fixture row changes the setup baseline.
  // The subsequent real read and all user actions must leave every row exact.
  x.before.money = financial(worker);
  const start = h.requests.length, prior = h.transport, delivered = [];
  h.transport = async input => {
    const response = await prior(input);
    if (/^\/api\/document-jobs(?:[?]|$)/u.test(input.url)) {
      assert.equal(input.init.method ?? "GET", "GET"); assert.equal(response.status, 200);
      delivered.push({ input, response, body: await response.clone().json() });
    }
    return response; // Same original HTTP response; observation adds clone latency only.
  };
  try { await h.store.syncDocumentJobs(); await cAlternativeDrain(x); } finally { h.transport = prior; }
  const reads = h.requests.slice(start).filter(row => /^\/api\/document-jobs(?:[?]|$)/u.test(row.url));
  assert.equal(reads.length, 1); assert.equal(reads[0].init.method ?? "GET", "GET");
  assert.equal(delivered.length, 1); assert.equal(delivered[0].input, reads[0]); assert.equal(delivered[0].response.bodyUsed, true);
  assert.ok(delivered[0].body.jobs.some(row => row.jobId === jobId && row.documentId === x.before.documentId));
  const job = h.store.documentJobs.get().find(row => row.jobId === jobId); assert.ok(job);
  assert.equal(job.status, "failed"); assert.equal(job.kind, "generate"); assert.equal(job.documentId, x.before.documentId);
  assert.deepEqual(job.errorDetail?.contributingBlockIds, ["scene-reuse-direction"]);
  assert.equal(job.moderationPromptRef, null); assert.deepEqual(rows(), originalRows);
  assert.equal(h.store.ui.instrumentation, false, "This native-port case does not fabricate a telemetry dispatch");
  const generations = f.components().filter(owner => owner.tag === "forma-generation-actions" && owner.source === "board");
  assert.equal(generations.length, 1); const generation = generations[0];
  assert.ok(generation.isConnected && generation.store === h.store); assert.equal(generation.compact, false);
  cGenerationFailureDialogNative(x, generation);
  await cAlternativeNoWrites(x); return { generation, job, rows, originalRows };
}
async function cGenerationOpenFailure(x, report) {
  const trigger = x.f.find("button", node => node.owner === report.generation && cAlternativeClass(node, "generation-failure-trigger"));
  assert.ok(trigger.port.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", trigger.port); x.f.native.focus(trigger.port);
  await x.f.act(trigger, "click", { button: 0 }); await cAlternativeDrain(x);
  const dialog = x.f.find("dialog", node => node.owner === report.generation && cAlternativeClass(node, "generation-failures-dialog"));
  assert.equal(dialog.port.open, true); assert.ok(dialog.port.isConnected); return dialog;
}
async function cGenerationContextLink(t, x, report, dialog) {
  const { documentContextBlockRoute } = await import("../src/model/routes.ts");
  const target = documentContextBlockRoute(x.before.documentId, x.h.store.projection.get().documentTitle, "scene-reuse-direction");
  const link = x.f.find("a", node => node.owner === report.generation && node.attributes.href === target
    && (() => { for (let at = node.parent; at; at = at.parent) if (at.port === dialog.port) return true; return false; })());
  assert.ok(link.port.isConnected); assert.equal(link.port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", link.port); x.f.native.focus(link.port);
  const requestStart = x.h.requests.length;
  await x.f.act(link, "click", { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
  await cAlternativeDrain(x); await cAlternativeNoWrites(x); assert.deepEqual(report.rows(), report.originalRows);
  t.diagnostic("C_GENERATION_READONLY_REPORT_CALLER " + JSON.stringify({ jobId: report.job.jobId,
    actualCurrentJobRead: true, historicalFailureFixture: true, target, currentRoute: x.h.store.route.get(),
    originalReportOpen: dialog.port.open, originalOwnerConnected: x.owner.isConnected, requestsAfterClick: x.h.requests.length - requestStart,
    providerExecutions: 0, exactSourceJobClientReceiptsAndFiscalRowsUnchanged: true,
    evidence: "actual full report/Store/Worker current read and native ports; no provider failure, paid receipt or physical-browser certificate" }));
  return target;
}
function cGenerationContextArrived(x, target) {
  assert.equal(x.h.store.route.get(), target); assert.equal(x.h.store.projection.get().documentId, x.before.documentId);
  assert.equal(x.h.store.ui.focusBlockId, "scene-reuse-direction"); assert.equal(x.h.store.ui.editingBlockId, "");
  assert.equal(x.owner.isConnected, false);
  const work = x.f.components().filter(owner => owner.tag === "forma-workspace" && owner.isConnected);
  assert.equal(work.length, 1); assert.equal(work[0].store, x.h.store);
}

test("C Generation read-only report caller / healthy actual failure link reaches exact current context", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board"), report = await cGenerationReport(x); cBoardInitial(x);
  const dialog = await cGenerationOpenFailure(x, report), target = await cGenerationContextLink(t, x, report, dialog);
  assert.equal(dialog.port.open, false); cGenerationContextArrived(x, target);
});

test("C Generation read-only report caller / another actual raw frame refuses before Close; explicit revert and fresh link resolve", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board"), report = await cGenerationReport(x), frame = await cImageFrame(x); cBoardInitial(x);
  await cImageFrameRaw(x, frame, "width", "1600"); const raw = frame.field("width").port;
  const dialog = await cGenerationOpenFailure(x, report); await cGenerationContextLink(t, x, report, dialog);
  assert.equal(x.h.store.route.get(), x.before.route, "Read-only report identity cannot waive another current raw child");
  assert.ok(x.owner.isConnected && report.generation.isConnected && frame.child.isConnected && raw.isConnected);
  assert.equal(dialog.port.open, true, "Refusal occurs before report cleanup"); assert.equal(raw.value, "1600");
  const closeTree = x.f.tree(), currentDialogs = closeTree.visible("dialog").filter(node => node.owner === report.generation
    && cAlternativeClass(node, "generation-failures-dialog"));
  t.diagnostic("C_GENERATION_REPORT_CLOSE_ANCESTRY " + JSON.stringify({ originalOpen: dialog.port.open,
    originalConnected: dialog.port.isConnected, currentDialogs: currentDialogs.map(node => ({ sameOriginal: node.port === dialog.port,
      connected: node.port.isConnected, open: node.port.open, className: node.attributes.class })),
    visibleCloseButtons: closeTree.visible("button").filter(node => node.owner === report.generation && cAlternativeClass(node, "modal-close"))
      .map(node => { const ancestors = []; for (let at = node.parent; at; at = at.parent) if (at.tag === "dialog")
        ancestors.push({ sameOriginal: at.port === dialog.port, currentDialogIndex: currentDialogs.findIndex(row => row.port === at.port),
          connected: Boolean(at.port?.isConnected), open: at.port?.open, className: at.attributes.class });
        return { connected: node.port.isConnected, label: node.attributes["aria-label"], ancestors }; }),
    evidence: "read-only current tree inspection; no redraw, recapture, control substitution or assertion change" }));
  const close = x.f.find("button", node => node.owner === report.generation && cAlternativeClass(node, "modal-close")
    && (() => { for (let at = node.parent; at; at = at.parent) if (at.port === dialog.port) return true; return false; })());
  x.f.native.emit("pointerdown", close.port); x.f.native.focus(close.port);
  await x.f.act(close, "click", { button: 0 }); await cAlternativeDrain(x);
  assert.equal(dialog.port.open, false); assert.ok(frame.child.isConnected); assert.equal(raw.value, "1600");
  await cImageFrameRaw(x, frame, "width", "1536");
  const fresh = await cGenerationOpenFailure(x, report), target = await cGenerationContextLink(t, x, report, fresh);
  assert.equal(fresh.port.open, false); cGenerationContextArrived(x, target);
});

// One real native Board Add establishes the existing canonical Format target.
// Only that exact original setup receipt advances the pre-existing observer's
// baseline. The later native numeric-equivalent Apply must perform no write.
test("C ImageFormat ordinary custody / exact existing frame permits departure after numeric-equivalent no-op Apply", cAlternativeOptions, async t => {
  const { documentImageFormat, imageFormatLabel, normalizeImageFormat } = await import("../src/model/image-format.ts");
  const x = await cAlternativePage(t, "board"), observed = cBoardObserveNativeAdds(x);
  t.after(() => observed.restore()); cBoardInitial(x);
  const setup = await cBoardSubmitNativeAdd(x, observed, "format", suggestedSubtype("format"));
  assert.equal(observed.records.length, 1); assert.equal(setup.response.status, 200); assert.equal(setup.response.bodyUsed, true);
  const selected = documentImageFormat(x.h.store.projection.get().blocks);
  const target = x.h.store.projection.get().blocks.find(block => block.id === selected.blockId);
  assert.ok(target); assert.equal(target.id, setup.receipt.appended[0].payload.block_id);
  assert.equal(target.type, "format"); assert.equal(target.documentId, x.before.documentId); assert.equal(target.projectId, x.before.projectId);
  assert.equal(target.locked, false); assert.equal(target.properties.image_format, undefined,
    "The real Board-created Format uses the same canonical default dimensions as the existing renderer");
  assert.deepEqual(selected.format.dimensions, { width: 1536, height: 1024, unit: "px" });
  const frame = await cImageFrame(x), width = frame.field("width").port, height = frame.field("height").port;
  assert.equal(width.value, "1536"); assert.equal(height.value, "1024");
  const boundary = { requests: x.h.requests.length, history: structuredClone(x.before.history), events: structuredClone(x.before.events),
    head: x.before.head, receipts: cAlternativeReceipts(x.worker), money: financial(x.worker) };
  // A global live/default overwrite is not a valid no-op repair: genuinely
  // different raw B must first survive a normal redraw and refused command.
  await cImageFrameRaw(x, frame, "width", "1600");
  assert.equal(new FormData(frame.form().port).get("width"), "1600");
  const dirty = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeRefused(x, dirty);
  assert.equal(frame.field("width").port, width); assert.equal(width.value, "1600");
  assert.equal(new FormData(frame.form().port).get("width"), "1600");
  await cAlternativeCloseMenu(x);
  // The user deliberately replaces B with equivalent numeric spellings, then
  // submits the actual existing form. No private handler or raw state is set.
  await cImageFrameRaw(x, frame, "width", "01536");
  await cImageFrameRaw(x, frame, "height", "01024");
  const form = frame.form(), submit = x.f.find("button", node => node.owner === frame.child && node.attributes.type === "submit");
  const originalFields = [...new FormData(form.port).entries()];
  assert.deepEqual(originalFields, [["preset", "3:2"], ["width", "01536"], ["height", "01024"]]);
  assert.deepEqual(normalizeImageFormat({ dimensions: { width: Number(width.value), height: Number(height.value), unit: "px" } }), selected.format);
  assert.ok(form.port.isConnected && submit.port.isConnected && frame.child.isConnected);
  assert.equal(submit.port.matches(":disabled"), false); assert.equal(submit.text, x.f.i18n.system("Apply frame"));
  assert.equal(frame.field("width").port, width); assert.equal(frame.field("height").port, height);
  const beforeApplyRequests = x.h.requests.length;
  x.f.native.emit("pointerdown", submit.port); x.f.native.focus(submit.port);
  await x.f.act(form, "submit", { submitter: submit.port }); await cAlternativeDrain(x); await cAlternativeNoWrites(x);
  const afterApplyFields = [...new FormData(frame.form().port).entries()], completionNotice = x.h.store.ui.toast;
  assert.equal(frame.form().port, form.port, "The same current native form owns the no-op completion");
  assert.equal(frame.field("width").port, width); assert.equal(frame.field("height").port, height);
  assert.equal(width.matches(":disabled"), false); assert.equal(height.matches(":disabled"), false);
  assert.deepEqual(documentImageFormat(x.h.store.projection.get().blocks), selected);
  assert.deepEqual(x.h.store.events.get(), boundary.events); assert.equal(x.h.store.head.get(), boundary.head);
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), boundary.history);
  assert.deepEqual(cAlternativeReceipts(x.worker), boundary.receipts); assert.deepEqual(financial(x.worker), boundary.money);
  assert.equal(observed.records.length, 1, "Only the separately certified original setup Add exists");
  assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
  assert.deepEqual(x.h.requests.slice(beforeApplyRequests).filter(request => (request.init.method ?? "GET") !== "GET"
    && !x.resume.isReadOnlyResume(request)), [], "The exact numeric-equivalent Apply did not dispatch an event or another command");
  assert.equal(completionNotice, x.f.i18n.system("Output frame set to {format}.", { format: imageFormatLabel(selected.format) }));
  const fresh = await cAlternativeCommand(x); await cAlternativeNoWrites(x);
  t.diagnostic("C_IMAGE_FORMAT_NUMERIC_NOOP " + JSON.stringify({ setupWorkerStatus: setup.response.status,
    setupEventId: setup.receipt.appended[0].eventId, originalFormatBlockId: selected.blockId,
    rawFieldsBeforeApply: originalFields, rawFieldsAfterApply: afterApplyFields, completionNotice,
    canonicalFormatUnchanged: selected.format, noOpAuthoringRequests: 0, noOpHistoryReceiptAndFiscalUnchanged: true,
    genuineRawBRetainedBeforeDeliberateResolution: true, command: fresh.label, route: x.h.store.route.get(), origin: x.before.route,
    evidence: "actual current native Apply and FormData; existing Format established by exact real Worker Add; no-op is not ACK/provider/browser evidence" }));
  cAlternativeDeparted(x);
});

// Real current Output draft plus a deliberately historical server-held context
// review. This setup is not a generated/paid proposal or execution certificate.
// Resume and Apply below still use the original authorized Worker endpoint.
async function cContextOutputReviewSetup(x) {
  const { parseOutputRequirement } = await import("../src/model/output-requirements.ts");
  const { prepareContextAuthority } = await import("../worker/context-authoring-authority.ts");
  const { storeAuthoringPreview } = await import("../worker/authoring-commits.ts");
  const { worker, h } = x, blockId = "context-shortcut-original-output";
  const OutputCard = x.f.renderer.registry["forma-output-requirement-card"];
  assert.equal(typeof OutputCard, "function", "The complete actual Output card class is registered");
  // Install before this target's first collect. Participation is exact current
  // scope; native identity still comes only from the original unique EventPart
  // and owner, never the label, target ID, or an activeElement reassignment.
  retainDeferredFocusInvokers(x.f, { has: owner => owner instanceof OutputCard
    && owner.tag === "forma-output-requirement-card" && owner.store === h.store
    && owner.snapshot?.requirementId === blockId && owner.snapshot.scope.documentId === x.before.documentId
    && owner.snapshot.scope.projectId === x.before.projectId
    && owner.snapshot.scope.authorizationScopeKey === x.before.authorization.key });
  const before = { ...x.before }, get = await worker.request("/api/output-requirements?documentId=" + encodeURIComponent(worker.documentId));
  assert.equal(get.status, 200); const current = await get.json();
  const spec = parseOutputRequirement({ id: blockId, Type: "Output", Subtype: "Social media image",
    Content: 'Create one image at aspect ratio "1:1".' }).spec;
  for (const variant of spec.deliverables[0].format_variants) variant.quantity = { kind: "exact", unit: "image", value: 1 };
  const response = await worker.request("/api/output-requirements", worker.json({ action: "save", documentId: worker.documentId,
    blockId, spec, expectedRevision: current.revision, clientMutationId: "context-shortcut-output-setup" }));
  assert.equal(response.status, 200, await response.clone().text()); const saved = await response.json();
  assert.equal(saved.ok, true); assert.equal(saved.command.action, "save"); assert.ok(saved.appended.length > 0);
  assert.equal(saved.appended.filter(event => event.type === "BlockCreated" && event.payload.block_id === blockId).length, 1);
  assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...before.history, ...saved.appended]);
  assert.deepEqual(financial(worker), before.money, "Dedicated authored Output setup is not a job, grant, confirmation or provider execution");
  await h.store.refreshEvents({ fromStart: true }); await cAlternativeDrain(x);
  const target = h.store.projection.get().blocks.find(block => block.id === blockId);
  assert.ok(target); assert.equal(target.type, "output"); assert.equal(target.scope, "document");
  assert.equal(target.documentId, before.documentId); assert.equal(target.projectId, before.projectId);
  const scope = { projectId: before.projectId, documentId: before.documentId, blockId, canvasId: null };
  const prepared = await prepareContextAuthority(new Request("http://localhost/api/context/apply", worker.json(scope)), worker.env, scope, "author");
  assert.ok(!(prepared instanceof Response)); assert.equal(prepared.target.id, blockId); assert.equal(prepared.target.type, "output");
  assert.equal(prepared.principal.userId, worker.owner); assert.equal(prepared.binding.streamId, worker.streamId);
  const direction = h.store.projection.get().blocks.find(block => block.id === "scene-reuse-direction"); assert.ok(direction);
  const executionId = "fixture-historical-context-selection", proposalId = "existing-direction";
  const selection = { executionId, proposalId, bindingHash: "a".repeat(64) };
  const proposal = { key: executionId + ":" + proposalId, executionId, proposalId, research: {
    id: proposalId, area: "related", blockId: direction.id, type: direction.type,
    subtype: String(direction.properties.subtype ?? suggestedSubtype(direction.type)), label: "Existing authored direction",
    text: String(direction.properties.text), reason: "Historical saved selection of this existing authored block.",
    scope: "document", distance: 0, sourceUrl: null, imageUrl: null, license: null, attribution: null,
  } };
  const plan = { operation: "context-proposal", binding: prepared.binding, sourceHead: prepared.sourceHead,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    events: [{ type: "BlockRelationAdded", payload: { project_id: scope.projectId, document_id: scope.documentId, scope: "document",
      relation_id: "fixture-historical-output-direction-link", from_block_id: blockId, to_block_id: direction.id,
      kind: "context_contains", properties: { member_order: 0 } } }],
    changes: [{ kind: "link", label: "Existing Output", text: String(direction.properties.text), sourceId: blockId, targetId: direction.id }],
    review: { sourceText: spec.original_text, proposals: [proposal], selections: [selection] }, result: { blockIds: [], relationCount: 1 } };
  const preview = await storeAuthoringPreview(worker.env, prepared.principal, plan);
  assert.equal(preview.blockId, blockId); assert.deepEqual(preview.review, plan.review);
  assert.deepEqual(financial(worker), before.money, "Historical review setup does not create a claimed execution or paid receipt");
  assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...before.history, ...saved.appended]);
  assert.deepEqual(h.store.events.get().map(event => event.eventId), [...before.events, ...saved.appended].map(event => event.eventId));
  x.before.events = structuredClone(h.store.events.get()); x.before.head = h.store.head.get();
  x.before.history = structuredClone([...before.history, ...saved.appended]); x.before.receipts = cAlternativeReceipts(worker);
  const privateRows = () => worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all();
  const commitRows = () => worker.sqlite.prepare("SELECT * FROM authoring_commits ORDER BY rowid").all();
  const originalPrivateRows = privateRows(), originalCommitRows = commitRows(), proofs = new WeakMap(), observations = [], observerErrors = [];
  const prior = h.transport;
  const transport = async request => {
    if (request.url !== "/api/context/apply" || request.body?.blockId !== blockId) return prior(request);
    try {
    const action = request.body.action, init = request.init, body = init.body;
    assert.ok(action === "resume" || action === "apply", "Only this original retained review read or exact refused Apply is admitted");
    assert.equal(init.method, "POST");
    assert.deepEqual(request.body, { action, ...scope, ...(action === "apply" ? { previewId: preview.previewId, approvalHash: preview.approvalHash } : {}) });
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    const changes = worker.sqlite.prepare("SELECT total_changes() AS n").get().n;
    const original = await prior(request), result = await original.clone().json();
    assert.equal(request.init, init); assert.equal(request.init.body, body);
    assert.equal(worker.sqlite.prepare("SELECT total_changes() AS n").get().n, changes,
      "The observed original Context response has zero SQL changes, not merely no authored events");
    assert.deepEqual(privateRows(), originalPrivateRows); assert.deepEqual(commitRows(), originalCommitRows);
    if (action === "resume") {
      // The retained review is present, but the original read reports its
      // uncommitted outcome as not-applied; it is not an authored receipt.
      assert.equal(original.status, 200); assert.equal(result.status, "not-applied"); assert.equal(result.stale, false);
      assert.deepEqual(result.preview, preview);
    } else {
      assert.equal(original.status, 409); assert.equal(result.status, "not-applied");
      assert.equal(result.error, "output_requirement_endpoint_required"); assert.equal(result.blockId, blockId);
      assert.equal(result.previewId, preview.previewId); assert.match(result.message, /Output requirements editor/u);
    }
    observations.push({ request, response: original, result, action }); proofs.set(request, { init, body });
    return original; // Same original Worker Response; a clone is observation, not a replacement ACK.
    } catch (error) {
      // Context's real recovery handler catches transport errors. Preserve and
      // surface this exact test-observer failure; it is not a missing response.
      observerErrors.push(error); throw error;
    }
  };
  h.transport = transport; x.after(() => { if (h.transport === transport) h.transport = prior; });
  const isWitnessed = request => { const proof = proofs.get(request); return Boolean(proof && request.init === proof.init && request.init.body === proof.body); };
  x.contextReview = { isWitnessed };
  // Finite native descendant lookup for the exact selector used by the real
  // Output shortcut. Other selectors retain the existing renderer/native port.
  const query = x.f.renderer.query.bind(x.f.renderer);
  const outputQuery = (owner, selector) => {
    if (selector !== ".output-requirement-header button" || owner?.tag !== "forma-output-requirement-card") return query(owner, selector);
    const tree = x.f.tree(), headers = tree.nodes.filter(node => node.owner === owner && cAlternativeClass(node, "output-requirement-header"));
    assert.equal(headers.length, 1);
    return tree.nodes.filter(node => node.owner === owner && node.tag === "button" && cAlternativeInside(node, headers[0])).map(node => {
      assert.ok(node.port && node.port.isConnected);
      // Native textContent comes from this actual current emitted button,
      // never an expected translation or a manufactured Edit control.
      node.port.textContent = node.text; return node.port;
    });
  };
  x.f.renderer.query = outputQuery; x.after(() => { if (x.f.renderer.query === outputQuery) x.f.renderer.query = query; });
  const owners = x.f.components().filter(owner => owner.tag === "forma-context-intelligence" && owner.block?.id === blockId);
  assert.equal(owners.length, 1); const owner = owners[0];
  assert.ok(owner.isConnected); assert.equal(owner.store, h.store); assert.equal(owner.surface, "guided");
  assert.equal(owner.closest("forma-guided-brief"), x.owner); assert.equal(owner.closest("forma-shell"), x.f.host);
  await cAlternativeNoWrites(x);
  return { owner, target, preview, observations, isWitnessed, observerErrors,
    unchanged() { assert.deepEqual(privateRows(), originalPrivateRows); assert.deepEqual(commitRows(), originalCommitRows); } };
}

async function cContextOutputRefusal(x, review) {
  const { f } = x;
  const begin = f.find("button", node => node.owner === review.owner && node.text.includes(f.i18n.t("context.intelligence.decompose")));
  assert.ok(begin.port.isConnected); assert.equal(begin.port.matches(":disabled"), false);
  f.native.emit("pointerdown", begin.port); f.native.focus(begin.port); await f.act(begin, "click", { button: 0 }); await cAlternativeDrain(x);
  assert.ifError(review.observerErrors[0]);
  assert.equal(review.observations.length, 1); assert.equal(review.observations[0].action, "resume");
  assert.equal(review.observations[0].response.bodyUsed, true);
  const apply = f.find("button", node => node.owner === review.owner && node.attributes["data-context-review-action"] === "apply");
  assert.equal(apply.port.matches(":disabled"), false); assert.ok(apply.port.isConnected);
  f.native.emit("pointerdown", apply.port); f.native.focus(apply.port); await f.act(apply, "click", { button: 0 }); await cAlternativeDrain(x);
  assert.ifError(review.observerErrors[0]);
  assert.deepEqual(review.observations.map(row => [row.action, row.response.status]), [["resume", 200], ["apply", 409]]);
  assert.ok(review.observations.every(row => row.response.bodyUsed && review.isWitnessed(row.request)));
  review.unchanged(); await cAlternativeNoWrites(x);
}
async function cContextOutputShortcut(x, review) {
  const { f, h } = x, tree = f.tree();
  const dialogs = tree.visible("dialog").filter(node => node.owner === review.owner && cAlternativeClass(node, "context-intelligence-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  const buttons = tree.visible("button").filter(node => node.owner === review.owner && cAlternativeInside(node, dialogs[0])
    && node.text === f.i18n.t("output.requirement.edit"));
  assert.equal(buttons.length, 1); const button = buttons[0];
  assert.ok(button.port.isConnected); assert.equal(button.port.matches(":disabled"), false);
  f.native.emit("pointerdown", button.port); f.native.focus(button.port);
  const before = { requests: h.requests.length, route: h.store.route.get(), focus: f.native.nativeFocus.length,
    scroll: f.native.nativeScroll.length, trace: f.trace.length };
  await f.act(button, "click", { button: 0 }); await cAlternativeDrain(x);
  return before;
}

for (const [state, locale] of [["clean", "en"], ["raw", "ja"]])
test("C Context Output refusal shortcut preserves Guided sibling / " + state + " / " + locale, cAlternativeOptions, async t => {
  const { documentContextBlockRoute } = await import("../src/model/routes.ts");
  const x = await cAlternativePage(t, "guided", locale), { f, h, owner } = x, initial = cGuidedInitial(x);
  const review = await cContextOutputReviewSetup(x), raw = "  Unsent Guided answer B — 未保存\n ";
  if (state === "raw") { await cAlternativeValue(x, cGuidedField(x), raw); await cGuidedStep(x, "World"); }
  await cContextOutputRefusal(x, review);
  const gesture = await cContextOutputShortcut(x, review); await cAlternativeNoWrites(x); review.unchanged();
  const destination = documentContextBlockRoute(x.before.documentId, h.store.projection.get().documentTitle, review.target.id);
  t.diagnostic("C_CONTEXT_OUTPUT_OWN_PRESENTATION " + JSON.stringify({ state, locale, destination, actualRoute: h.store.route.get(),
    originalContextStatuses: review.observations.map(row => row.response.status), originalGuidedConnected: owner.isConnected,
    originalEventHistoryPrivateReviewClientReceiptsAndFiscalUnchanged: true, providerExecutions: 0,
    evidence: "actual whole Shell/Guided/Context controls, dedicated authored Output setup and historical review; original Worker Resume200/Apply409, not a provider or browser certificate" }));
  if (state === "raw") {
    assert.equal(h.store.route.get(), gesture.route, "Edit Output cannot discard the sibling Guided answer before admission");
    assert.ok(owner.isConnected && review.owner.isConnected); assert.equal(h.requests.length, gesture.requests);
    assert.equal(f.native.nativeScroll.length, gesture.scroll);
    assert.equal(f.native.nativeFocus.slice(gesture.focus).some(row => row.node.owner?.tag === "forma-output-requirement-card"), false);
    const dialog = f.find("dialog", node => node.owner === review.owner && cAlternativeClass(node, "context-intelligence-dialog"));
    assert.equal(dialog.port.open, true, "Refusal must leave the current owned review and its exact shortcut available");
    assert.equal(f.trace.slice(gesture.trace).some(value => value.startsWith("close:") && value.includes("context-intelligence-dialog")), false);
    await f.act(dialog, "cancel", { cancelable: true }); await cAlternativeDrain(x);
    await cGuidedStep(x, "Purpose"); assert.equal(cGuidedField(x).port.value, raw);
    await cAlternativeValue(x, cGuidedField(x), initial.text); assert.deepEqual(cGuidedInitial(x), initial);
    const resume = f.find("button", node => node.owner === review.owner && node.text.includes(f.i18n.t("context.controls.resumeResearch")));
    f.native.emit("pointerdown", resume.port); f.native.focus(resume.port); await f.act(resume, "click", { button: 0 }); await cAlternativeDrain(x);
    assert.equal(review.observations.length, 2, "Resuming the local owned refusal does not dispatch another Context operation");
    await cContextOutputShortcut(x, review); await cAlternativeNoWrites(x); review.unchanged();
  }
  assert.equal(h.store.route.get(), destination); assert.equal(owner.isConnected, false);
  const cards = f.components().filter(component => component.tag === "forma-output-requirement-card" && component.snapshot?.requirementId === review.target.id);
  assert.equal(cards.length, 1); const card = cards[0];
  assert.ok(card.isConnected); assert.equal(card.store, h.store); assert.equal(card.snapshot.scope.documentId, x.before.documentId);
  assert.equal(card.snapshot.scope.projectId, x.before.projectId); assert.equal(card.snapshot.scope.authorizationScopeKey, x.before.authorization.key);
  assert.equal(card.snapshot.canEdit, true); assert.equal(Boolean(card.readOnlyReason), false);
  const edit = f.find("button", node => node.owner === card && node.text === f.i18n.t("output.requirement.edit"));
  assert.equal(edit.port.matches(":disabled"), false);
  t.diagnostic("C_CONTEXT_OUTPUT_NATIVE_EDIT " + JSON.stringify({ state, locale, route: h.store.route.get(),
    currentEdit: { tag: edit.port.tagName, connected: edit.port.isConnected, owner: edit.owner?.tag },
    activeIsCurrentEdit: f.native.document.activeElement === edit.port,
    nativeFocus: f.native.nativeFocus.slice(gesture.focus).map(row => ({ tag: row.node.tagName, id: row.node.getAttribute?.("id"),
      owner: row.node.owner?.tag, connected: row.node.isConnected, sameCard: row.node.owner === card, sameCurrentEdit: row.node === edit.port })),
    boundary: "observation of actual native focus records only; original exact-current Edit assertion remains unchanged" }));
  assert.ok(f.native.nativeFocus.some(row => row.node === edit.port), "The original healthy shortcut reaches the exact current native Edit action");
  assert.equal(h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 0);
  assert.equal(review.observations.length, 2); await cAlternativeNoWrites(x); review.unchanged();
});

// The original copy can commit independently of its picker presentation. These
// cases use the current full Guided/Shell/Store and exactly one real append.
async function cStudioReusePage(t, kind, locale) {
  const x = await cAlternativePage(t, "guided", locale), { worker, h, f } = x;
  if (kind === "block") {
    const { appendAuditEvent } = await import("../worker/runtime.ts");
    const before = { ...x.before }, id = "studio-picker-reusable-direction";
    const event = await appendAuditEvent(worker.env, worker.streamId, "user", "BlockCreated", {
      project_id: worker.projectId, scope: "library", block_id: id, type: "direction", handle: "direction/picker-original",
      position: "l-picker-original", properties: { label: "Original reusable direction", text: "Keep the exact original reusable wording.",
        weight: .65, authority: "authored" },
    });
    assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...before.history, event]);
    assert.deepEqual(cAlternativeReceipts(worker), before.receipts); assert.deepEqual(financial(worker), before.money);
    await h.store.refreshEvents({ fromStart: true }); await cAlternativeDrain(x);
    assert.deepEqual(h.store.events.get().map(row => row.eventId), [...before.events, event].map(row => row.eventId));
    x.before.events = structuredClone(h.store.events.get()); x.before.head = h.store.head.get();
    x.before.history = structuredClone([...before.history, event]);
    x.reuseSource = h.store.projection.get().libraryBlocks.find(block => block.id === id);
    assert.ok(x.reuseSource); assert.equal(x.reuseSource.scope, "library");
    assert.deepEqual(h.store.projection.get().libraryBlockRelations.filter(row => row.fromBlockId === id), []);
  } else {
    assert.equal(kind, "artifact"); x.reuseSource = h.store.projection.get().libraryArtifacts.find(artifact => artifact.id === "saved-scene-story");
    assert.ok(x.reuseSource); assert.equal(x.reuseSource.kind, "short_story"); assert.equal(x.reuseSource.documentId, worker.documentId);
    assert.equal(h.store.projection.get().blocks.some(block => block.properties.source_artifact_id === x.reuseSource.id), false);
    assert.equal(await h.store.ensurePrivateContent(x.reuseSource.contentRef), worker.content, "The existing real private body is available before the deliberate copy");
  }
  const modes = f.components().filter(owner => owner.tag === "forma-studio-mode-nav"); assert.equal(modes.length, 1);
  x.reuseMode = modes[0]; assert.ok(x.reuseMode.isConnected); assert.equal(x.reuseMode.store, h.store);
  assert.equal(x.reuseMode.closest("forma-guided-brief"), x.owner); assert.equal(x.reuseMode.closest("forma-shell"), f.host);
  await cAlternativeNoWrites(x); return x;
}
async function cStudioReusePicker(x, choose = true) {
  const { f } = x, mode = x.reuseMode;
  const trigger = f.find("button", node => node.owner === mode && cAlternativeClass(node, "context-set-trigger"));
  assert.ok(trigger.port.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port); await f.act(trigger, "click", { button: 0 });
  if (choose) {
    const tree = f.tree(), dialog = tree.visible("dialog").find(node => node.owner === mode && cAlternativeClass(node, "context-set-picker-dialog"));
    assert.ok(dialog?.port.open);
    const choices = tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && node.component?.isConnected && !node.hiddenBy && cAlternativeInside(node, dialog));
    assert.deepEqual(choices.map(node => node.component.value), ["create", "reuse"]);
    const reuse = choices.find(node => node.component.value === "reuse").component;
    const button = f.find("button", node => node.owner === reuse && node.attributes["data-choice-value"] === "reuse");
    assert.equal(button.port.matches(":disabled"), false); f.native.emit("pointerdown", button.port); f.native.focus(button.port);
    const trace = f.trace.length; await f.act(button, "click", { button: 0 });
    assert.ok(f.trace.slice(trace).includes("event:forma-action"));
  }
  await cAlternativeDrain(x);
  const dialog = f.find("dialog", node => node.owner === mode && cAlternativeClass(node, "context-set-picker-dialog"));
  assert.equal(dialog.port.open, true); return dialog;
}
function cStudioReuseButton(x, kind) {
  const { f } = x, tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === x.reuseMode && cAlternativeClass(node, "context-set-picker-dialog"));
  assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
  const articles = tree.visible("article").filter(node => node.owner === x.reuseMode && cAlternativeInside(node, dialogs[0])
    && tree.visible("h3").some(heading => cAlternativeInside(heading, node) && heading.text === (kind === "block" ? x.reuseSource.handle : x.reuseSource.title)));
  assert.equal(articles.length, 1);
  const buttons = tree.visible("button").filter(node => node.owner === x.reuseMode && cAlternativeInside(node, articles[0]));
  assert.equal(buttons.length, 1); assert.equal(buttons[0].text, f.i18n.system(kind === "block" ? "Add block" : "Use & edit"));
  assert.ok(buttons[0].port.isConnected); assert.equal(buttons[0].port.matches(":disabled"), false); return buttons[0];
}
async function cStudioObserveOriginalCopy(x, kind, hold) {
  const { artifactContextEvents } = await import("../src/model/output-context.ts");
  const { parseDocumentArtifactContent } = await import("../src/model/document-artifacts.ts");
  const { h, worker, resume } = x, prior = h.transport, proofs = new WeakMap();
  const original = { events: structuredClone(x.before.events), history: structuredClone(x.before.history), head: x.before.head };
  let releaseDelivery, releaseWrite, writePending = null, record = null, armed = true, released = !hold;
  const gate = hold ? new Promise(resolve => { releaseDelivery = resolve; }) : Promise.resolve();
  const witness = request => { const proof = proofs.get(request); return Boolean(proof && request.init === proof.init && request.init.body === proof.bytes); };
  const transport = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") {
      if (writePending) await writePending;
      return prior(request);
    }
    assert.equal(armed, true, "One original append for this exact native picker copy; no second dispatch or retry"); armed = false;
    record = { request, init: request.init, bytes: request.init.body, response: null, receipt: null, held: false };
    writePending = new Promise(resolve => { releaseWrite = resolve; });
    try {
      await resume.settleOriginalRequests();
      const body = request.body, event = body.event, payload = event?.payload;
      assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(body.action, "append"); assert.equal(body.clientId, "web:lit"); assert.equal(body.expectedSequence, original.head);
      assert.deepEqual(body.events, [event]); assert.equal(event.type, "BlockCreated");
      for (const id of [payload.block_id, payload.properties.context_set_id]) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
      assert.equal(payload.properties.context_set_root_id, payload.block_id); assert.equal(payload.document_id, x.before.documentId);
      assert.equal(payload.properties.created_from, "document-view-context-picker");
      if (kind === "block") {
        const source = x.reuseSource;
        assert.deepEqual(event, { type: "BlockCreated", payload: { block_id: payload.block_id, document_id: x.before.documentId,
          type: source.type, handle: source.handle + "-copy-" + String(original.head + 1).padStart(3, "0"),
          position: "z" + String(original.head + 1).padStart(6, "0"), properties: { ...source.properties, authority: "authored",
            copied_from_block_id: source.id, copied_as_context_set: false, context_set_id: payload.properties.context_set_id,
            context_set_root_id: payload.block_id, combined_context_memberships: [], semantic_isolation: false, created_from: "document-view-context-picker" } } });
      } else {
        const ids = [payload.properties.context_set_id, payload.block_id]; let at = 0;
        const expected = artifactContextEvents(x.reuseSource, { documentId: x.before.documentId, projectId: x.before.projectId,
          sourceSurface: "document-view-context-picker", content: parseDocumentArtifactContent(worker.content),
          positionStart: original.head + 1, idFactory: () => { assert.ok(at < ids.length); return ids[at++]; } });
        assert.equal(at, 2); assert.deepEqual(expected.events, [event]); assert.deepEqual(expected.blockIds, [payload.block_id]);
        assert.equal(payload.properties.artifact_markdown, JSON.parse(worker.content).content_markdown);
        assert.equal(payload.properties.source_artifact_id, x.reuseSource.id); assert.equal(payload.properties.source_artifact_content_ref, worker.contentRef);
      }
      assert.equal(h.store.route.get(), x.before.route); assert.ok(h.store.sourceOwnershipActive(x.before.source) && h.store.authorizationScopeActive(x.before.authorization));
      const response = await prior(request); assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
      assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]); assert.deepEqual(receipt.rejected, []);
      assert.equal(receipt.appended.length, 1); const committed = receipt.appended[0];
      assert.equal(committed.type, event.type); assert.deepEqual(committed.payload, event.payload);
      assert.equal(committed.actor, "user"); assert.equal(committed.clientId, "web:lit"); assert.equal(committed.streamId, worker.streamId);
      assert.equal(committed.sequence, original.head + 1); assert.equal(receipt.head, committed.sequence); assert.equal(committed.compensatesEventId, null);
      await worker.drainBackground(); assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...original.history, committed]);
      const row = worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(committed.eventId);
      assert.ok(row); assert.equal(row.sequence, committed.sequence); assert.equal(row.type, event.type); assert.deepEqual(JSON.parse(row.private_json), payload);
      assert.deepEqual(cAlternativeReceipts(worker), x.before.receipts); assert.deepEqual(financial(worker), x.before.money);
      record.response = response; record.receipt = receipt; proofs.set(request, { init: record.init, bytes: record.bytes });
      assert.equal(witness({ ...request }), false); assert.equal(request.init.body, record.bytes);
      writePending = null; releaseWrite(); record.held = hold; await gate;
      return response;
    } finally { writePending = null; releaseWrite(); }
  };
  h.transport = transport;
  const observed = { isWitnessed: witness, record: () => record,
    release() { if (!released) { released = true; releaseDelivery(); } },
    async reached() { await untilScene(() => Boolean(record?.receipt && record.held), "The exact original picker copy Worker200 is held before delivery");
      assert.equal(released, false); assert.equal(record.response.bodyUsed, false);
      assert.deepEqual(h.store.events.get(), original.events); assert.equal(h.store.head.get(), original.head);
      assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...original.history, ...record.receipt.appended]); },
    async accept() { assert.ok(record?.receipt); assert.equal(record.response.bodyUsed, true); assert.ok(witness(record.request));
      const expected = [...original.events, ...record.receipt.appended];
      assert.deepEqual(h.store.events.get(), expected); assert.equal(h.store.head.get(), record.receipt.head);
      assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), [...original.history, ...record.receipt.appended]);
      assert.deepEqual(cAlternativeReceipts(worker), x.before.receipts); assert.deepEqual(financial(worker), x.before.money);
      assert.equal(h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
      x.before.events = structuredClone(expected); x.before.history = structuredClone([...original.history, ...record.receipt.appended]);
      x.before.head = record.receipt.head; await cAlternativeNoWrites(x); return record.receipt.appended[0]; },
    restore() { if (h.transport === transport) h.transport = prior; } };
  x.studioCopy = observed; return observed;
}

for (const kind of ["block", "artifact"]) for (const state of ["healthy", "newer-picker"])
test("C Studio reuse original ACK / " + kind + " / " + state, cAlternativeOptions, async t => {
  const { documentContextBlockRoute } = await import("../src/model/routes.ts");
  const x = await cStudioReusePage(t, kind, state === "healthy" ? "en" : "ja"), initial = cGuidedInitial(x);
  const { f, h, owner } = x, mode = x.reuseMode, observed = await cStudioObserveOriginalCopy(x, kind, state !== "healthy");
  t.after(() => observed.restore()); await cStudioReusePicker(x);
  const button = cStudioReuseButton(x, kind); f.native.emit("pointerdown", button.port); f.native.focus(button.port);
  const pending = f.act(button, "click", { button: 0 });
  const raw = "  New Guided answer B while original copy is unresolved — 未保存\n ";
  let newer = null;
  try {
    if (state !== "healthy") {
      await observed.reached();
      const original = f.find("dialog", node => node.owner === mode && cAlternativeClass(node, "context-set-picker-dialog"));
      await f.act(original, "cancel", { cancelable: true }); await cAlternativeDrain(x);
      assert.equal(observed.record().response.bodyUsed, false, "Closing a presentation is not cancellation of the dispatched copy");
      await cAlternativeValue(x, cGuidedField(x), raw); assert.equal(cGuidedField(x).port.value, raw);
      await cStudioReusePicker(x, false);
      newer = { route: h.store.route.get(), focus: f.native.nativeFocus.length, scroll: f.native.nativeScroll.length, requests: h.requests.length };
      assert.equal(f.tree().nodes.filter(node => node.tag === "forma-ui-choice-card" && node.component?.isConnected && !node.hiddenBy).length, 2);
      observed.release();
    }
    await pending; await cAlternativeDrain(x); const committed = await observed.accept();
    const copied = h.store.projection.get().blocks.find(block => block.id === committed.payload.block_id); assert.ok(copied);
    assert.equal(copied.documentId, x.before.documentId); assert.equal(copied.projectId, x.before.projectId);
    assert.equal(h.store.ui.focusBlockId, copied.id, "Existing Store copy publication remains its original acknowledged effect");
    t.diagnostic("C_STUDIO_REUSE_ACK_OWNER " + JSON.stringify({ kind, state, originalWorkerStatus: observed.record().response.status,
      originalEventId: committed.eventId, originalCopiedBlockId: copied.id, currentRoute: h.store.route.get(), originRoute: x.before.route,
      exactOriginalHistoryPrivatePayloadReceiptsAndFiscal: true, originalCopyBodyDelivered: observed.record().response.bodyUsed,
      evidence: "actual full Guided/Shell/picker and original Worker copy receipt; native Cancel is not server cancellation; no browser/provider certificate" }));
    if (newer) {
      assert.equal(h.store.route.get(), newer.route, "Original copy ACK cannot reveal over the later picker and Guided intent");
      assert.ok(owner.isConnected && mode.isConnected); assert.equal(cGuidedField(x).port.value, raw);
      const dialog = f.find("dialog", node => node.owner === mode && cAlternativeClass(node, "context-set-picker-dialog"));
      assert.equal(dialog.port.open, true, "Original ACK cannot close the newer picker presentation");
      const choices = f.tree().nodes.filter(node => node.tag === "forma-ui-choice-card" && node.component?.isConnected && !node.hiddenBy);
      assert.deepEqual(choices.map(node => node.component.value), ["create", "reuse"]);
      assert.equal(f.native.nativeScroll.length, newer.scroll); assert.equal(f.native.nativeFocus.slice(newer.focus).some(row => row.node.owner?.tag === "forma-output-input-editor"), false);
      assert.deepEqual(h.requests.slice(newer.requests).filter(request => (request.init.method ?? "GET") !== "GET" && !x.resume.isReadOnlyResume(request)), []);
      await f.act(dialog, "cancel", { cancelable: true }); await cAlternativeDrain(x);
      assert.equal(cGuidedField(x).port.value, raw); await cAlternativeValue(x, cGuidedField(x), initial.text);
    } else {
      assert.equal(f.tree().visible("dialog").filter(node => node.owner === mode && cAlternativeClass(node, "context-set-picker-dialog")).length, 0);
      if (kind === "block") { assert.equal(h.store.route.get(), x.before.route); assert.ok(owner.isConnected && mode.isConnected); }
      else {
        assert.equal(h.store.route.get(), documentContextBlockRoute(x.before.documentId, h.store.projection.get().documentTitle, copied.id));
        assert.equal(owner.isConnected, false); assert.equal(mode.isConnected, false); assert.equal(h.store.ui.editingBlockId, copied.id);
        const editors = f.components().filter(child => child.tag === "forma-output-input-editor" && child.block?.id === copied.id);
        assert.equal(editors.length, 1); assert.ok(editors[0].isConnected); assert.equal(editors[0].store, h.store);
      }
    }
    await cAlternativeNoWrites(x);
  } finally { observed.release(); await pending; }
});

// Initial admission is distinct from newer work appearing after a dispatched
// copy. This case starts with actual raw Guided work and uses the same exact
// one-original-copy observer for either the erroneous baseline or the fresh,
// deliberately resolved healthy gesture.
test("C Studio artifact reuse admits before dispatch and retains pre-existing Guided raw / ja", cAlternativeOptions, async t => {
  const { documentContextBlockRoute } = await import("../src/model/routes.ts");
  const x = await cStudioReusePage(t, "artifact", "ja"), initial = cGuidedInitial(x);
  const { f, h, owner } = x, mode = x.reuseMode, observed = await cStudioObserveOriginalCopy(x, "artifact", false);
  t.after(() => observed.restore());
  const raw = "  Existing Guided answer before Use & edit — 未保存\n ";
  await cAlternativeValue(x, cGuidedField(x), raw); assert.equal(cGuidedField(x).port.value, raw);
  await cStudioReusePicker(x);
  const button = cStudioReuseButton(x, "artifact");
  f.native.emit("pointerdown", button.port); f.native.focus(button.port);
  const before = { route: h.store.route.get(), requests: h.requests.length, scroll: f.native.nativeScroll.length,
    focus: f.native.nativeFocus.length, trace: f.trace.length };
  await f.act(button, "click", { button: 0 }); await cAlternativeDrain(x);
  // Account for a genuinely dispatched erroneous original before the desired
  // refusal assertion; never erase its committed event to make teardown pass.
  const erroneous = observed.record() ? await observed.accept() : null;
  if (!erroneous) await cAlternativeNoWrites(x);
  t.diagnostic("C_STUDIO_REUSE_INITIAL_ADMISSION " + JSON.stringify({
    locale: "ja", originalRoute: before.route, actualRoute: h.store.route.get(),
    erroneousOriginalWorkerStatus: observed.record()?.response?.status ?? null,
    erroneousOriginalEventId: erroneous?.eventId ?? null, originalGuidedConnected: owner.isConnected,
    originalSourceActive: h.store.sourceOwnershipActive(x.before.source),
    exactHistoryPrivatePayloadReceiptsAndFiscalAccounted: true,
    evidence: "actual current Guided raw and native picker action; same original Worker observer if wrongly dispatched; no synthetic receipt or browser/provider proof",
  }));
  assert.equal(h.store.route.get(), before.route, "Pre-existing Guided raw must refuse destructive Use & edit before dispatch");
  assert.equal(observed.record(), null, "A refused initial gesture must not dispatch the original copy");
  assert.equal(h.requests.length, before.requests); assert.equal(f.native.nativeScroll.length, before.scroll);
  assert.ok(owner.isConnected && mode.isConnected); assert.equal(owner.store, h.store); assert.equal(mode.store, h.store);
  assert.equal(cGuidedField(x).port.value, raw);
  const dialog = f.find("dialog", node => node.owner === mode && cAlternativeClass(node, "context-set-picker-dialog"));
  assert.equal(dialog.port.open, true, "Initial refusal leaves the actual reusable picker open");
  assert.equal(f.trace.slice(before.trace).some(value => value.startsWith("close:") && value.includes("context-set-picker-dialog")), false);
  assert.equal(f.native.nativeFocus.slice(before.focus).some(row => row.node.owner?.tag === "forma-output-input-editor"), false);
  assert.equal(cStudioReuseButton(x, "artifact").port.matches(":disabled"), false);
  await cAlternativeNoWrites(x);

  // Resolve only the real local Guided field; Cancel is presentation cleanup,
  // not cancellation of a server operation (none was dispatched).
  await f.act(dialog, "cancel", { cancelable: true }); await cAlternativeDrain(x);
  assert.equal(cGuidedField(x).port.value, raw);
  await cAlternativeValue(x, cGuidedField(x), initial.text); assert.deepEqual(cGuidedInitial(x), initial);
  await cStudioReusePicker(x);
  const fresh = cStudioReuseButton(x, "artifact");
  f.native.emit("pointerdown", fresh.port); f.native.focus(fresh.port);
  await f.act(fresh, "click", { button: 0 }); await cAlternativeDrain(x);
  const committed = await observed.accept(), copied = h.store.projection.get().blocks.find(block => block.id === committed.payload.block_id);
  assert.ok(copied); assert.equal(copied.documentId, x.before.documentId); assert.equal(copied.projectId, x.before.projectId);
  assert.equal(h.store.route.get(), documentContextBlockRoute(x.before.documentId, h.store.projection.get().documentTitle, copied.id));
  assert.equal(h.store.ui.focusBlockId, copied.id); assert.equal(h.store.ui.editingBlockId, copied.id);
  assert.equal(owner.isConnected, false); assert.equal(mode.isConnected, false);
  const editors = f.components().filter(child => child.tag === "forma-output-input-editor" && child.block?.id === copied.id);
  assert.equal(editors.length, 1); assert.ok(editors[0].isConnected); assert.equal(editors[0].store, h.store);
  assert.equal(h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1,
    "Only the fresh deliberately resolved gesture dispatched its one exact original copy");
  await cAlternativeNoWrites(x);
});

// Board Add is an original one-event write, not a recovery/GET acknowledgment.
// The separate false-default hold option leaves all existing Guided controls
// and the existing multi-Add healthy Board observer contract unchanged.
function cBoardStartOriginalAdd(x) {
  const tree = x.f.tree(), forms = tree.visible("form")
    .filter(node => node.owner === x.owner && cAlternativeClass(node, "board-quick-add"));
  assert.equal(forms.length, 1); assert.ok(forms[0].port.isConnected);
  assert.equal(typeof forms[0].handlers.submit, "function");
  assert.ok(x.f.renderer.nodes.includes(forms[0].port));
  assert.equal(forms[0].port.handlers.submit, forms[0].handlers.submit);
  const buttons = tree.visible("button").filter(node => node.owner === x.owner && cAlternativeInside(node, forms[0])
    && String(node.attributes.type ?? "submit").toLowerCase() === "submit");
  assert.equal(buttons.length, 1); assert.ok(buttons[0].port.isConnected);
  assert.ok(x.f.renderer.nodes.includes(buttons[0].port));
  assert.equal(buttons[0].attributes.form, undefined, "the native default submit belongs to this actual enclosing form");
  assert.equal(buttons[0].handlers.click, undefined, "no competing application click replaces the actual form submission");
  assert.equal(buttons[0].port.matches(":disabled"), false);
  process.stderr.write("C_BOARD_CURRENT_NATIVE_SUBMIT " + JSON.stringify({ locale: x.f.i18n.locale,
    emittedText: buttons[0].text, emittedType: buttons[0].attributes.type ?? null,
    defaultType: "submit", currentNativeFormAndButton: true }) + "\n");
  x.f.native.emit("pointerdown", buttons[0].port); x.f.native.focus(buttons[0].port);
  return x.f.act(forms[0], "submit", { submitter: buttons[0].port });
}
async function cBoardOriginalInput(x, value) {
  const field = cBoardText(x); x.f.native.emit("pointerdown", field.port); x.f.native.focus(field.port);
  await cAlternativeValue(x, field, value); assert.equal(cBoardText(x).port.value, value);
}
function cBoardAssertExactOriginal(x, observed, a) {
  assert.equal(observed.records.length, 1); assert.equal(a.response.status, 200); assert.equal(a.response.bodyUsed, true);
  const event = a.receipt.appended[0], block = x.h.store.projection.get().blocks.find(value => value.id === event.payload.block_id);
  assert.equal(event.type, "BlockCreated"); assert.ok(block); assert.equal(block.projectId, x.before.projectId);
  assert.equal(block.documentId, x.before.documentId); assert.equal(block.type, a.type);
  assert.equal(block.properties.text, a.text); assert.equal(block.properties.subtype, a.subtype);
  assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
  return event;
}

test("C Context Board original Add / unchanged A clears current input and permits fresh departure", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board"), initial = cBoardInitial(x);
  const observed = cBoardObserveNativeAdds(x); t.after(() => observed.restore());
  const a = await cBoardSubmitNativeAdd(x, observed, initial.type, initial.subtype);
  cBoardAssertExactOriginal(x, observed, a); cAlternativeOwned(x);
  assert.equal(cBoardText(x).port.value, "");
  assert.deepEqual(cBoardSelects(x).map(node => node.port.value), ["composition", suggestedSubtype("composition")],
    "The healthy acknowledged Add retains the real next-lane suggestion");
  const fresh = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeDeparted(x);
  t.diagnostic("C_BOARD_ORIGINAL_ADD " + JSON.stringify({ state: "unchanged", originalWorker200: 1,
    exactBlockCreated: 1, command: fresh.label, exactHistoryPrivatePayloadReceiptAndFiscalVerified: true }));
});

test("C Context Board original Add / acknowledged A preserves newer raw B and selection / ja", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board", "ja"), initial = cBoardInitial(x);
  const observed = cBoardObserveNativeAdds(x, { boardOriginalHold: true }); t.after(() => observed.restore());
  const rawA = "  " + initial.type + " board evidence  ", rawB = " \nNewer Board decision B — 未保存\t ";
  await cBoardOriginalInput(x, rawA); const a = await observed.arm(initial.type, initial.subtype);
  const saving = cBoardStartOriginalAdd(x), newerType = "reference";
  const newerSubtype = blockTypeDefinition(newerType).subtypes.find(value => value !== suggestedSubtype(newerType)); assert.ok(newerSubtype);
  let focusBeforeAck, fieldPart;
  try {
    await observed.reachedOriginal(a);
    await cAlternativeValue(x, cBoardSelects(x)[0], newerType, "change");
    await cAlternativeValue(x, cBoardSelects(x)[1], newerSubtype, "change");
    await cBoardOriginalInput(x, rawB);
    fieldPart = cBoardText(x).propertyParts.value; focusBeforeAck = x.h.store.ui.focusBlockId;
    await observed.assertOriginalHeld(a);
  } finally {
    observed.releaseOriginal(a); await saving; await cAlternativeDrain(x); await observed.accept(a);
  }
  const original = cBoardAssertExactOriginal(x, observed, a), after = cBoardText(x);
  t.diagnostic("C_BOARD_ORIGINAL_ADD " + JSON.stringify({ state: "newer", originalWorker200: 1,
    exactBlockCreated: 1, originalBlockId: original.payload.block_id, currentRaw: after.port.value,
    currentSelectors: cBoardSelects(x).map(node => node.port.value), focusBeforeAck, focusAfterAck: x.h.store.ui.focusBlockId,
    exactHistoryPrivatePayloadReceiptAndFiscalVerified: true }));
  assert.equal(x.h.store.route.get(), x.before.route); cAlternativeOwned(x);
  assert.equal(after.port.value, rawB, "The original Add acknowledgment must not erase the newer unsent Board decision");
  assert.equal(after.properties.value, rawB); assert.equal(after.propertyParts.value, fieldPart);
  assert.deepEqual(cBoardSelects(x).map(node => node.port.value), [newerType, newerSubtype],
    "The earlier Add must not replace the newer category or starting point with its next-lane suggestion");
  assert.equal(x.h.store.ui.focusBlockId, focusBeforeAck, "The earlier Add must not request focus over the newer native edit");
  const refused = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeRefused(x, refused);
  assert.equal(cBoardText(x).port.value, rawB); await cAlternativeCloseMenu(x);
  await cBoardOriginalInput(x, "");
  await cAlternativeValue(x, cBoardSelects(x)[0], initial.type, "change");
  await cAlternativeValue(x, cBoardSelects(x)[1], initial.subtype, "change");
  const fresh = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeDeparted(x);
  assert.ok(fresh.label); cBoardAssertExactOriginal(x, observed, a);
});

test("C Context Board original Add / restoring empty defaults still owns pending departure until ACK", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "board"), initial = cBoardInitial(x);
  const observed = cBoardObserveNativeAdds(x, { boardOriginalHold: true }); t.after(() => observed.restore());
  // Deliberately choose and restore the actual category. This is a real clean
  // selection, not a private sticky-flag change or a synthetic pending default.
  await cAlternativeValue(x, cBoardSelects(x)[0], "reference", "change");
  await cAlternativeValue(x, cBoardSelects(x)[0], initial.type, "change");
  await cBoardOriginalInput(x, "  " + initial.type + " board evidence  ");
  const a = await observed.arm(initial.type, initial.subtype), saving = cBoardStartOriginalAdd(x);
  let pending;
  try {
    await observed.reachedOriginal(a); await cBoardOriginalInput(x, "");
    assert.deepEqual(cBoardSelects(x).map(node => node.port.value), [initial.type, initial.subtype]);
    const gesture = await cAlternativeCommand(x); await observed.assertOriginalHeld(a);
    pending = { route: x.h.store.route.get(), originalConnected: x.owner.isConnected,
      requestDelta: x.h.requests.length - gesture.requestStart, scrollDelta: x.f.native.nativeScroll.length - gesture.scroll,
      command: gesture.label, toast: x.h.store.ui.toast };
  } finally {
    observed.releaseOriginal(a); await saving; await cAlternativeDrain(x); await observed.accept(a);
  }
  cBoardAssertExactOriginal(x, observed, a);
  t.diagnostic("C_BOARD_ORIGINAL_ADD " + JSON.stringify({ state: "pending-restored", pending,
    originRoute: x.before.route, originalWorker200: 1, originalConsumedAfterRelease: a.response.bodyUsed,
    exactHistoryPrivatePayloadReceiptAndFiscalVerified: true }));
  assert.equal(pending.route, x.before.route, "An original Board Add remains pending even after explicit restoration of empty defaults");
  assert.equal(pending.originalConnected, true); assert.equal(pending.requestDelta, 0); assert.equal(pending.scrollDelta, 0);
  assert.equal(pending.toast, x.f.i18n.t("next.lifecycle.currentWorkOpen")); cAlternativeOwned(x);
  assert.equal(cBoardText(x).port.value, "");
  const fresh = await cAlternativeCommand(x); await cAlternativeNoWrites(x); cAlternativeDeparted(x);
  assert.ok(fresh.label); cBoardAssertExactOriginal(x, observed, a);
});

// Same-turn current-interaction contract over the existing complete Board.
// No held/replaced updateComplete, new renderer, Add or physical-task claim.
for (const newer of [false, true]) test(
  "C Board Prepare opening / " + (newer ? "same-turn newer native select wins" : "healthy current input focus"),
  cAlternativeOptions, async t => {
    const x = await cAlternativePage(t, "board"), { f, h, owner } = x, initial = cBoardInitial(x);
    const extra = { requests: h.requests.length, content: structuredClone(h.store.content.get()),
      privateContent: x.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all(),
      privateEvents: x.worker.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all() };
    const tree = f.tree(), actions = tree.nodes.filter(node => node.owner === owner && cAlternativeClass(node, "next-best-action"));
    assert.equal(actions.length, 1);
    const buttons = tree.visible("button").filter(node => node.owner === owner && node.text === "Prepare this decision"
      && cAlternativeInside(node, actions[0]));
    assert.equal(buttons.length, 1); const prepare = buttons[0];
    assert.ok(prepare.port.isConnected && !prepare.hiddenBy); assert.equal(prepare.port.matches(":disabled"), false);
    assert.equal(f.tree().visible("dialog").filter(node => node.port.open).length, 0);
    f.native.emit("pointerdown", prepare.port); f.native.focus(prepare.port);
    const pending = f.act(prepare); pending.catch(() => {});
    let mark;
    try {
      const later = cBoardSelects(x)[0];
      assert.ok(later.port.isConnected && !later.hiddenBy); assert.equal(later.port.matches(":disabled"), false);
      assert.equal(later.port.value, initial.type);
      if (newer) { f.native.emit("pointerdown", later.port); f.native.focus(later.port); }
      mark = f.native.nativeFocus.length;
    } finally { await pending; }
    await cAlternativeDrain(x);
    const late = f.native.nativeFocus.slice(mark).filter(row => row.node.owner === owner);
    t.diagnostic("C_BOARD_PREPARE_FOCUS " + JSON.stringify({ newer, lateFocus: late.map(row => ({
      tag: row.node.tag, id: row.node.attributes.id ?? null })), nativeTarget: "current Block type select",
      boundary: "actual listener and same-turn newer native gesture; unchanged finite scheduler, not physical timing" }));
    assert.equal(h.store.route.get(), x.before.route); cAlternativeOwned(x);
    assert.equal(cBoardText(x).port.value, "");
    assert.deepEqual(cBoardSelects(x).map(node => node.port.value), [initial.type, initial.subtype]);
    await cAlternativeNoWrites(x); assert.equal(h.requests.length, extra.requests);
    assert.deepEqual(h.store.content.get(), extra.content);
    assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all(), extra.privateContent);
    assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all(), extra.privateEvents);
    if (newer) assert.equal(late.length, 0, "Earlier Prepare must not focus over the newer native select interaction");
    else {
      assert.equal(late.length, 1); assert.equal(late[0].node.tag, "input");
      assert.equal(late[0].node.attributes.id, "board-decision");
    }
  });

// One explicit native-modal witness. The existing five Studio copy controls,
// their original Worker observer and every older test body remain unchanged.
// This port models only actual showModal's previous-focus slot and synchronous
// close restoration on this exact Studio dialog, not generic open reflection,
// autofocus selection, native top-layer layout or a complete event-loop model.
async function cStudioPreviousFocusPort(t, x) {
  const { ensureNativeModalDialog } = await import("../src/components/design-system/native-dialog.ts");
  const { f, h } = x, owner = x.reuseMode, parent = owner.parentElement;
  const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
  const projection = h.store.projection.get(), originalCollect = f.renderer.collect;
  const originalEnsure = ports.modalPort.ensureModalDialog;
  const openings = [], closings = [];
  let retained = null;
  const scope = () => owner.isConnected && owner.store === h.store && owner.parentElement === parent
    && h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization)
    && h.store.projection.get().projectId === projection.projectId
    && h.store.projection.get().documentId === projection.documentId;
  // Reuse the existing literal native click EventPart adapter. It looks back
  // only one committed draw and never transfers activeElement to another node.
  retainDeferredFocusInvokers(f, new Set([owner]));
  const collect = f.renderer.collect.bind(f.renderer);
  const native = node => {
    const originalMatches = node.matches.bind(node), originalClose = node.close.bind(node);
    const originalRemove = node.removeAttribute.bind(node);
    const state = { node, modal: false, previous: null };
    node.matches = selector => selector === ":modal" ? state.modal : originalMatches(selector);
    node.removeAttribute = name => { originalRemove(name); if (name === "open") node.open = false; };
    node.showModal = () => {
      assert.ok(scope() && node.isConnected && f.renderer.nodes.includes(node));
      assert.equal(node.open, false); assert.equal(state.modal, false);
      // Read the actual focused native control at this real promotion call.
      // No expected opener, replacement element or private UI field is assigned.
      state.previous = f.native.document.activeElement;
      state.modal = true; node.open = true; node.setAttribute("open", "");
      openings.push({ dialog: node, previous: state.previous, route: h.store.route.get() });
    };
    node.close = () => {
      if (!node.open) return;
      // This actual picker has click/cancel handlers but no close callback.
      // Refuse a future source shape that would need a queued-event extension.
      assert.equal(node.handlers.close, undefined); assert.equal(node.listeners?.close, undefined);
      const previous = state.previous, wasModal = state.modal, from = f.native.document.activeElement;
      state.previous = null; state.modal = false;
      const restore = Boolean(previous && (wasModal || node.contains(from)));
      originalClose(); node.removeAttribute("open");
      if (restore) previous.focus({ preventScroll: true });
      closings.push({ dialog: node, previous, from, wasModal, restore,
        after: f.native.document.activeElement, route: h.store.route.get(),
        previousConnected: Boolean(previous?.isConnected),
        previousInCommittedTree: Boolean(previous && f.renderer.nodes.includes(previous)) });
    };
    return state;
  };
  const nextCollect = (markup, currentOwner) => {
    const start = f.renderer.nodes.length, result = collect(markup, currentOwner);
    if (currentOwner !== owner) return result;
    const dialogs = f.renderer.nodes.slice(start).filter(node => node.tag === "dialog"
      && cAlternativeClass(node, "context-set-picker-dialog"));
    assert.ok(dialogs.length <= 1);
    if (!scope() || !dialogs.length) { retained = null; return result; }
    const fresh = dialogs[0], token = fresh.full.match(/\s@cancel=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u);
    const binding = token ? f.renderer.bindings[Number(token[1])] : null;
    assert.ok(binding && binding.owner === owner && typeof binding.part === "string"
      && typeof binding.value === "function" && binding.value === fresh.handlers.cancel);
    assert.equal(Object.hasOwn(fresh.attributes, "open"), false);
    const previous = retained?.node;
    if (previous?.isConnected && retained.part === binding.part
      && (f.renderer.previousNodes ?? []).includes(previous)) {
      const open = previous.open;
      for (const key of ["full", "properties", "propertyParts", "handlers", "value", "checked", "committedValue"])
        previous[key] = fresh[key];
      previous.attributes = { ...fresh.attributes }; previous.parentElement = owner;
      previous.open = open; if (open) previous.setAttribute("open", "");
      f.renderer.nodes[f.renderer.nodes.indexOf(fresh)] = previous; fresh.isConnected = false;
    } else retained = { ...native(fresh), part: binding.part };
    return result;
  };
  f.renderer.collect = nextCollect;
  const ensure = function(dialog) {
    if (dialog?.owner !== owner || !cAlternativeClass(dialog, "context-set-picker-dialog"))
      return Reflect.apply(originalEnsure, this, [dialog]);
    assert.ok(scope()); assert.equal(retained?.node, dialog);
    return ensureNativeModalDialog(dialog);
  };
  ports.modalPort.ensureModalDialog = ensure;
  t.after(() => {
    if (ports.modalPort.ensureModalDialog === ensure) ports.modalPort.ensureModalDialog = originalEnsure;
    if (f.renderer.collect === nextCollect) f.renderer.collect = originalCollect;
    retained = null;
  });
  await cAlternativeDrain(x);
  return { openings, closings };
}

test("C Studio original modal opener survives its exact copied-input destination commit", cAlternativeOptions, async t => {
  const { documentContextBlockRoute } = await import("../src/model/routes.ts");
  const x = await cStudioReusePage(t, "artifact", "en"), { f, h, owner } = x, mode = x.reuseMode;
  const modal = await cStudioPreviousFocusPort(t, x), observed = await cStudioObserveOriginalCopy(x, "artifact", true);
  t.after(() => observed.restore());
  const opener = f.find("button", node => node.owner === mode && cAlternativeClass(node, "context-set-trigger"));
  assert.equal(opener.port.matches(":disabled"), false); assert.equal(opener.hiddenBy, null);
  const dialog = await cStudioReusePicker(x);
  assert.equal(modal.openings.length, 1, "One real promotion persists through the same picker template update");
  assert.equal(modal.openings[0].dialog, dialog.port); assert.equal(modal.openings[0].previous, opener.port);
  assert.equal(modal.openings[0].route, x.before.route); assert.equal(dialog.port.matches(":modal"), true);
  assert.ok(opener.port.isConnected && f.renderer.nodes.includes(opener.port));
  assert.equal(mode.querySelector(".context-set-trigger"), opener.port);
  assert.equal(opener.port.closest("forma-studio-mode-nav"), mode); assert.equal(opener.port.closest("forma-shell"), f.host);
  const action = cStudioReuseButton(x, "artifact");
  assert.notEqual(action.port, opener.port); assert.ok(dialog.port.contains(action.port));
  f.native.emit("pointerdown", action.port); f.native.focus(action.port);
  assert.equal(f.native.document.activeElement, action.port, "The original lease starts inside the picker, not at the opener");
  const pending = f.act(action, "click", { button: 0 });
  try {
    await observed.reached();
    assert.equal(observed.record().response.status, 200); assert.equal(observed.record().response.bodyUsed, false);
    assert.equal(modal.closings.length, 0); assert.equal(dialog.port.open, true);
    assert.equal(mode.querySelector(".context-set-picker-dialog"), dialog.port);
    assert.equal(f.native.document.activeElement, action.port); assert.ok(opener.port.isConnected);
    assert.equal(h.store.route.get(), x.before.route);
    observed.release(); await pending; await cAlternativeDrain(x);
    // Account for the real original append before asserting the desired arrival.
    const committed = await observed.accept(), copied = h.store.projection.get().blocks.find(block => block.id === committed.payload.block_id);
    assert.ok(copied); assert.equal(copied.documentId, x.before.documentId); assert.equal(copied.projectId, x.before.projectId);
    assert.equal(copied.properties.source_artifact_id, x.reuseSource.id);
    assert.equal(copied.properties.artifact_markdown, JSON.parse(x.worker.content).content_markdown);
    assert.equal(modal.closings.length, 1); const close = modal.closings[0];
    assert.equal(close.dialog, dialog.port); assert.equal(close.previous, opener.port); assert.equal(close.from, action.port);
    assert.equal(close.wasModal, true); assert.equal(close.restore, true); assert.equal(close.after, opener.port);
    assert.equal(close.previousConnected, true); assert.equal(close.previousInCommittedTree, true); assert.equal(close.route, x.before.route);
    t.diagnostic("C_STUDIO_NATIVE_ORIGINAL_OPENER " + JSON.stringify({
      originalWorkerStatus: observed.record().response.status, originalEventId: committed.eventId, copiedBlockId: copied.id,
      actualShowModalPreviousFocus: true, originalInsideActionAtCapture: true, originalConnectedOpenerRestoredInsideClose: true,
      originRoute: x.before.route, actualRoute: h.store.route.get(), editingBlockId: h.store.ui.editingBlockId,
      exactOriginalHistoryPrivatePayloadReceiptsAndFiscal: true,
      boundary: "actual full Studio/Guided/Shell/Store and held original RAM Worker; finite native previous-focus slot only, no browser/top-layer/autofocus/provider claim",
    }));
    const destination = documentContextBlockRoute(x.before.documentId, h.store.projection.get().documentTitle, copied.id);
    assert.equal(h.store.route.get(), destination); assert.equal(h.location.pathname + h.location.search + h.location.hash, destination);
    assert.equal(owner.isConnected, false); assert.equal(mode.isConnected, false);
    assert.equal(h.store.ui.focusBlockId, copied.id); assert.equal(h.store.ui.editingBlockId, copied.id,
      "Native restoration to the original opener must not retire the same copied-input arrival");
    const tree = f.tree(), blocks = tree.nodes.filter(node => node.tag === "forma-context-block" && node.component?.isConnected
      && node.component.store === h.store && node.component.block?.id === copied.id && node.component.surface === "document");
    assert.equal(blocks.length, 1); const block = blocks[0];
    assert.equal(block.component.block.documentId, x.before.documentId); assert.equal(block.component.block.projectId, x.before.projectId);
    assert.equal(block.component.readOnly, false);
    const panels = tree.visible("form").filter(node => node.owner === block.component && cAlternativeInside(node, block)
      && cAlternativeClass(node, "block-editor"));
    assert.equal(panels.length, 1);
    const fields = tree.visible("textarea").filter(node => cAlternativeInside(node, panels[0]));
    assert.ok(fields.length > 0); const field = fields.find(node => node.port.closest("forma-ui-rich-text")) ?? fields[0];
    assert.ok(field.port.isConnected && f.renderer.nodes.includes(field.port)); assert.equal(field.hiddenBy, null);
    assert.equal(field.port.matches(":disabled"), false); assert.equal(Boolean(field.port.readOnly), false);
    assert.equal(field.port.closest("forma-context-block"), block.component); assert.equal(field.port.closest(".block-editor"), panels[0].port);
    const editors = f.components().filter(child => child.tag === "forma-output-input-editor" && child.block?.id === copied.id);
    assert.equal(editors.length, 1); assert.ok(editors[0].isConnected); assert.equal(editors[0].store, h.store);
    const fieldPart = field.port.propertyParts?.value; assert.equal(typeof fieldPart, "string");
    const focused = f.native.nativeFocus.filter(row => row.node.tagName === "TEXTAREA"
      && row.node.owner === field.owner && row.node.propertyParts?.value === fieldPart);
    assert.ok(focused.length > 0, "The original arrival actually focuses the copied editor's exact native field part");
    assert.ok(focused.every(row => row.node.owner.closest("forma-context-block") === block.component));
    t.diagnostic("C_STUDIO_NATIVE_COPIED_FIELD_FOCUS " + JSON.stringify({ calls: focused.length,
      currentOwnerAndFieldPart: true, finalPortAlsoRecorded: focused.some(row => row.node === field.port),
      boundary: "read-only actual nativeFocus records at invocation plus current enabled field; no final-node remap or physical focus claim" }));
    await cAlternativeNoWrites(x);
  } finally { observed.release(); await pending; }
});

test("C Guided Brief saved subtype / retained story option stays representable without rewriting context", cAlternativeOptions, async t => {
  const x = await cStudioReusePage(t, "artifact", "en"), { f, h } = x, originalOwner = x.owner;
  assert.equal(cGuidedField(x, "message").port.value, "");
  const observed = await cStudioObserveOriginalCopy(x, "artifact", false); t.after(() => observed.restore());
  // Reuse the actual current picker gesture and unchanged original Worker
  // observer. The fixture's historical story is not provider-generated here.
  await cStudioReusePicker(x);
  const use = cStudioReuseButton(x, "artifact");
  f.native.emit("pointerdown", use.port); f.native.focus(use.port); await f.act(use, "click", { button: 0 });
  await cAlternativeDrain(x); const committed = await observed.accept();
  const saved = h.store.projection.get().blocks.find(block => block.id === committed.payload.block_id); assert.ok(saved);
  assert.equal(saved.type, "message"); assert.equal(saved.documentId, x.before.documentId);
  assert.equal(saved.projectId, x.before.projectId); assert.equal(saved.properties.subtype, "Narrative source");
  assert.equal(saved.properties.source_artifact_id, x.reuseSource.id);
  assert.equal(saved.properties.source_artifact_content_ref, x.reuseSource.contentRef);
  assert.equal(saved.properties.artifact_markdown, JSON.parse(x.worker.content).content_markdown);
  assert.equal(h.store.projection.get().blocks.filter(block => block.type === "message").length, 1);
  assert.equal(originalOwner.isConnected, false);
  const modes = f.components().filter(component => component.tag === "forma-studio-mode-nav"
    && component.isConnected && component.store === h.store);
  assert.equal(modes.length, 1); assert.equal(modes[0].closest("forma-shell"), f.host);
  // E3 keeps this exact Guided destination in the existing native View
  // disclosure. Reuse its real trigger/default before querying visible links.
  const menus = f.components().filter(component => component.tag === "forma-ui-popover"
    && component.parentElement === modes[0] && cAlternativeClass(component, "studio-view-menu"));
  assert.equal(menus.length, 1); const menu = menus[0]; assert.ok(menu.isConnected);
  const trigger = f.find("button", node => node.owner === menu && cAlternativeClass(node, "ui-popover-trigger"));
  assert.equal(trigger.attributes["aria-expanded"], "false"); assert.equal(trigger.port.matches(":disabled"), false);
  assert.equal(typeof trigger.attributes.popovertarget, "string");
  const currentRoute = h.store.route.get();
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port); trigger.port.click();
  await cAlternativeDrain(x);
  assert.equal(h.store.route.get(), currentRoute, "opening View does not navigate or consume the copied-input destination");
  assert.ok(modes[0].isConnected && menu.isConnected && menu.parentElement === modes[0]);
  const returnTree = f.tree(), panels = returnTree.visible("section")
    .filter(node => node.owner === menu && node.attributes.popover === "auto");
  assert.equal(panels.length, 1); assert.equal(panels[0].port.matches(":popover-open"), true);
  const currentTrigger = f.find("button", node => node.owner === menu && cAlternativeClass(node, "ui-popover-trigger"));
  assert.equal(currentTrigger.attributes.popovertarget, panels[0].attributes.id);
  assert.equal(currentTrigger.attributes["aria-expanded"], "true");
  const links = returnTree.visible("a").filter(node => node.owner === menu && cAlternativeInside(node, panels[0])
    && node.attributes["data-studio-view"] === "guided" && node.attributes.href === x.before.route
    && node.text === f.i18n.system("Guided brief"));
  assert.equal(links.length, 1); const link = links[0];
  assert.ok(link.port.isConnected); assert.equal(link.port.matches(":disabled"), false);
  assert.equal(typeof link.handlers.click, "function"); assert.equal(link.port.handlers.click, link.handlers.click);
  f.native.emit("pointerdown", link.port); f.native.focus(link.port); await f.act(link, "click", { button: 0 });
  await cAlternativeDrain(x); await cAlternativeNoWrites(x);
  assert.equal(h.store.route.get(), x.before.route);
  const owners = f.components().filter(component => component.tag === "forma-guided-brief" && component.isConnected);
  assert.equal(owners.length, 1); const owner = owners[0]; assert.notEqual(owner, originalOwner);
  assert.equal(owner.store, h.store); assert.equal(owner.closest("forma-shell"), f.host);
  x.owner = owner; // Reacquire only the actual newly rendered Guided owner.
  const view = () => {
    const tree = f.tree(), fields = tree.visible("textarea").filter(node => node.owner === owner && node.attributes.id === "brief-message");
    assert.equal(fields.length, 1); const field = fields[0]; let question = field.parent;
    while (question && !cAlternativeClass(question, "guided-question")) question = question.parent;
    assert.ok(question);
    const selects = tree.visible("select").filter(node => node.owner === owner && cAlternativeInside(node, question));
    assert.equal(selects.length, 1); const select = selects[0];
    for (const node of [field, select]) {
      assert.ok(node.port.isConnected && !node.hiddenBy); assert.equal(node.port.closest("forma-guided-brief"), owner);
      assert.equal(node.attributes.form, "guided-brief-" + x.before.documentId);
      assert.equal(node.port.matches(":disabled"), false);
    }
    assert.equal(typeof select.handlers.change, "function"); assert.equal(select.port.handlers.change, select.handlers.change);
    const options = tree.nodes.filter(node => node.tag === "option" && cAlternativeInside(node, select));
    return { field, select, options, values: options.map(node => String(node.attributes.value ?? node.text)) };
  };
  await cAlternativeNoWrites(x);
  const seeded = view(), raw = saved.properties.artifact_markdown, subtype = saved.properties.subtype;
  assert.equal(seeded.field.port.value, raw); assert.equal(seeded.select.port.value, subtype);
  const departure = owner.captureCommandDeparture();
  t.diagnostic("C_GUIDED_SAVED_SUBTYPE_NATIVE_OPTION " + JSON.stringify({
    originalWorkerStatus: observed.record().response.status, originalEventId: committed.eventId,
    copiedBlockId: saved.id, storedSubtype: subtype, currentValue: seeded.select.port.value,
    emittedOptions: seeded.values, matchingOptionCount: seeded.values.filter(value => value === subtype).length,
    selectedIndex: typeof seeded.select.port.selectedIndex === "number" ? seeded.select.port.selectedIndex : null,
    nativeOptionSelectedness: seeded.options.map(node => typeof node.port?.selected === "boolean" ? node.port.selected : null),
    sameCurrentGuidedOwner: true, originalSourceCurrent: h.store.sourceOwnershipActive(x.before.source),
    actualPrivateGuard: { current: departure.current(), blocked: departure.blocked() },
    originalHistoryPrivatePayloadReceiptsAndFiscalVerified: true,
    boundary: "actual original native picker copy and fresh current Guided options; finite selectedness is disclosed, no provider or blanket false-dirty/navigation claim",
  }));
  assert.equal(seeded.values.filter(value => value === subtype).length, 1,
    "The actual saved Narrative source subtype must have one native Starting point option");
  const catalog = blockTypeDefinition("message").subtypes;
  assert.ok(catalog.every(value => seeded.values.includes(value)), "Every existing catalog choice remains available");
  assert.equal(new Set(seeded.values).size, seeded.values.length);
  // Dispatch the actual change handler for the already-represented saved
  // option; this native no-op must not normalize or save the copied context.
  const unchanged = view(); assert.equal(unchanged.values.filter(value => value === subtype).length, 1);
  await cAlternativeValue(x, unchanged.select, subtype, "change"); await cAlternativeNoWrites(x);
  await cGuidedStep(x, "World"); await cGuidedStep(x, "Purpose");
  await h.store.refreshEvents({ fromStart: true }); await cAlternativeDrain(x); await cAlternativeNoWrites(x);
  const restored = view(); assert.equal(restored.select.port.value, subtype); assert.equal(restored.field.port.value, raw);
  assert.equal(restored.values.filter(value => value === subtype).length, 1);
  assert.deepEqual(h.store.projection.get().blocks.find(block => block.id === saved.id), saved,
    "Native no-op choice and current read do not normalize the original copied block");
  assert.equal(h.store.route.get(), x.before.route);
});

test("C Guided Brief native catalog choice / changed value retains its emitted option identity and unsaved work", cAlternativeOptions, async t => {
  const x = await cAlternativePage(t, "guided", "en"), { f, h, owner } = x, initial = cGuidedInitial(x);
  const view = () => {
    const tree = f.tree(), fields = tree.visible("textarea").filter(node => node.owner === owner && node.attributes.id === "brief-direction");
    assert.equal(fields.length, 1); const field = fields[0]; let question = field.parent;
    while (question && !cAlternativeClass(question, "guided-question")) question = question.parent;
    assert.ok(question);
    const selects = tree.visible("select").filter(node => node.owner === owner && cAlternativeInside(node, question));
    assert.equal(selects.length, 1); const select = selects[0];
    assert.ok(select.port.isConnected && field.port.isConnected); assert.equal(select.port.closest("forma-guided-brief"), owner);
    assert.equal(select.attributes.form, "guided-brief-" + x.before.documentId);
    assert.equal(select.port.matches(":disabled"), false);
    assert.equal(select.port.handlers.change, select.handlers.change); assert.equal(typeof select.handlers.change, "function");
    const options = tree.nodes.filter(node => node.tag === "option" && node.owner === owner && cAlternativeInside(node, select));
    return { field, select, options };
  };
  const optionBinding = (view, value) => {
    const rows = view.options.filter(node => String(node.attributes.value ?? node.text) === value);
    assert.equal(rows.length, 1); const node = rows[0]; assert.ok(node.port.isConnected);
    // Observe the actual emitted AttributePart identity. This does not create
    // native selectedness, remap a DOM node or stand in for browser behavior.
    const token = node.port.full.match(/\svalue=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u); assert.ok(token);
    const binding = f.renderer.bindings[Number(token[1])]; assert.equal(binding.owner, owner);
    assert.equal(binding.value, value); assert.equal(typeof binding.part, "string");
    return { node, part: binding.part };
  };
  const choose = async value => {
    const current = view(); optionBinding(current, value);
    f.native.emit("pointerdown", current.select.port); f.native.focus(current.select.port);
    await cAlternativeValue(x, current.select, value, "change"); await cAlternativeNoWrites(x);
  };
  await cAlternativeNoWrites(x);
  const current = view(), catalog = blockTypeDefinition("direction").subtypes;
  const different = catalog.find(value => value !== initial.subtype); assert.ok(different);
  assert.equal(current.select.port.value, initial.subtype);
  const originalChoice = optionBinding(current, different), sourceChoice = optionBinding(current, initial.subtype);
  const before = { requests: h.requests.length, route: h.store.route.get() };
  await choose(different);
  let selected = view(), selectedBinding = optionBinding(selected, different);
  assert.equal(selected.select.port.value, different); assert.equal(selected.field.port.value, initial.text);
  assert.equal(selectedBinding.part, originalChoice.part,
    "The actually chosen catalog value must retain its own emitted option part, not reuse another value's list position");
  const departure = owner.captureCommandDeparture();
  assert.equal(departure.current(), true); assert.equal(departure.blocked(), true);
  const raw = "  A newer unsaved Guided answer while the selected catalog role remains exact. 未保存\n ";
  await cAlternativeValue(x, selected.field, raw); await cAlternativeNoWrites(x);
  selected = view(); selectedBinding = optionBinding(selected, different);
  assert.equal(selected.field.port.value, raw); assert.equal(selected.select.port.value, different);
  assert.equal(selectedBinding.part, originalChoice.part);
  t.diagnostic("C_GUIDED_DIFFERENT_CATALOG_OPTION " + JSON.stringify({
    originalSubtype: initial.subtype, chosenSubtype: different, currentValue: selected.select.port.value,
    sameActualGuidedOwner: owner.isConnected && owner.store === h.store, chosenEmittedOptionPartRetained: true,
    selectedIndex: typeof selected.select.port.selectedIndex === "number" ? selected.select.port.selectedIndex : null,
    optionSelectedness: typeof selectedBinding.node.port.selected === "boolean" ? selectedBinding.node.port.selected : null,
    originalSourceHistoryReceiptsAndFiscalUnchanged: true, addedEventPosts: 0,
    boundary: "actual native change and unchanged raw field with emitted option binding identity; not native IDL/DOM identity, physical keyboard, focus or locale proof",
  }));
  await cAlternativeValue(x, selected.field, initial.text); await cAlternativeNoWrites(x);
  await choose(initial.subtype);
  const restored = view(); assert.equal(restored.field.port.value, initial.text); assert.equal(restored.select.port.value, initial.subtype);
  assert.equal(optionBinding(restored, initial.subtype).part, sourceChoice.part);
  const clean = owner.captureCommandDeparture(); assert.equal(clean.current(), true); assert.equal(clean.blocked(), false);
  assert.equal(h.store.route.get(), before.route);
  assert.deepEqual(h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET" && !x.resume.isReadOnlyResume(request)), []);
  await cAlternativeNoWrites(x);
});
