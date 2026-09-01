import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { createCalmFullPage, calmFullPageNativePorts as ports, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { retainNativeSubmitForms } from "./helpers/deferred-focus-invokers.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { appendAuditEvent, readWorkspaceEvents } from "../worker/runtime.ts";
import { documentIdFromRoute, withDocumentInRoute } from "../src/model/routes.ts";
import { page as proposalPage, openSuggestion, currentHost, snapshot, control, begin, enteredOrTerminal,
  inProposal, receipts as proposalReceipts, applies as proposalApplies, eventRows as proposalEvents,
  settle as settleProposal } from "./helpers/adaptive-recovery-native-fixture.mjs";

// Six BASELINE-first actual Shell/owner controls. Complete Store and routed
// RAM Worker; native ports are not physical browser/AT evidence. No application
// method is replaced, no private draft is assigned, no facade is stubbed.
// First five cases use zero provider setup. Case six reuses the existing ONE
// deterministic original-plan setup response, then only an explicit FREE
// preview and original reads. No new provider invocation or Apply is allowed.
const options = { concurrency: false, timeout: 120000 };
const hasClass = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const under = (node, predicate) => { for (let at = node; at; at = at.parent) if (predicate(at)) return true; return false; };
const clientReceipts = worker => worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
const layerText = block => String(block.properties.artifact_markdown ?? block.properties.text ?? block.properties.label ?? block.handle);

async function drain(x) {
  let queues;
  for (let attempt = 0; attempt < 6; attempt++) {
    // Join original transports and already-scheduled Store RAF before the
    // unchanged full-page settle, then require actual current-queue quiescence.
    await x.resume.settleOriginalRequests();
    for (const [id, timer] of [...x.h.timers]) if (timer.delay === 16) { x.h.timers.delete(id); timer.callback(0); }
    await x.f.settle();
    await x.resume.settleOriginalRequests();
    await x.worker.drainBackground?.();
    const documents = [...new Set(x.f.components().filter(component => component.tag === "forma-output-requirements")
      .map(component => component.documentId).filter(Boolean))];
    queues = { transports: x.resume.pendingOriginalCount(), componentFrames: x.f.frames.size,
      storeFrames: [...x.h.timers.values()].filter(timer => timer.delay === 16).length,
      renderRequests: Number(x.f.requested),
      outputReads: documents.filter(id => ["loading", "refreshing"].includes(x.h.store.outputRequirements.resource(id).state)).length };
    if (Object.values(queues).every(value => value === 0)) break;
  }
  assert.deepEqual(queues, { transports: 0, componentFrames: 0, storeFrames: 0, renderRequests: 0, outputReads: 0 },
    "Actual original transports, current Output reads, native/Store frames and render requests are quiescent");
  assert.equal(x.resume.pendingOriginalCount(), 0);
}

// Bounded native range value sanitization, not application normalization.
// Root verified the WHATWG nearest-allowed-step / ties-up rule. This port only
// handles the actual Layers min=0/max=1/step=.05 controls. The existing renderer
// still owns primitive PropertyPart commit/retention and all template identity.
function installLayerRanges(t, f) {
  const collect = f.renderer.collect;
  f.renderer.collect = function(markup, owner) {
    const first = this.nodes.length, result = Reflect.apply(collect, this, [markup, owner]);
    if (owner?.tag === "forma-reality-layers") for (const node of this.nodes.slice(first)) {
      if (node.owner !== owner || node.tag !== "input" || node.attributes.type !== "range") continue;
      assert.equal(Number(node.attributes.min), 0); assert.equal(Number(node.attributes.max), 1);
      assert.equal(Number(node.attributes.step), .05);
      const normalize = input => {
        const parsed = Number(input), number = Number.isFinite(parsed) ? parsed : .5;
        return String(Math.round(Math.max(0, Math.min(1, number)) * 20) / 20);
      };
      let value = normalize(node.value);
      Object.defineProperty(node, "value", { configurable: true, get: () => value, set: next => { value = normalize(next); } });
      Object.defineProperty(node, "valueAsNumber", { configurable: true, get: () => Number(value), set: next => { value = normalize(next); } });
    }
    return result;
  };
  t.after(() => { f.renderer.collect = collect; });
}
async function native(t, x, tags) {
  await registerCalmFullPageComponents(x.f, ["forma-workspace", ...tags]);
  x.f.nativeHistoryLocation = x.h.location;
  x.f.native = installOutputNavigationFocusNative(t, x.f, ports);
  installLayerRanges(t, x.f);
  x.resume = observeActualSceneResumeReads(x.h); t.after(() => x.resume.restore());
  x.h.store.setRoute(x.h.store.route.get(), { replace: true }); // Join the actual finite History/Location before observation.
  await drain(x);
  assert.equal(x.f.host.tag, "forma-shell"); assert.equal(x.f.host.store, x.h.store);
}
// Upfront isolated RAM setup, reused from workspace-fallback-chat-ownership's
// real replay/impersonation schema. No session object or Assistant flag is
// fabricated; the real Worker supplies the effective account and policy.
async function actualAdaptiveFallbackWorker(worker) {
  const response = await worker.request("/api/session"); assert.equal(response.status, 200);
  const principal = await response.json(), actor = principal.user.userId, now = new Date().toISOString();
  assert.equal(principal.user.role, "admin"); assert.equal(actor, worker.owner);
  const userId = "adaptive-fallback-fictional", personaId = "adaptive-fallback-persona", actingId = "adaptive-fallback-acting";
  const streamId = "creative:" + userId;
  worker.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(userId, "adaptive-fallback@example.test", "Fictional Adaptive author", "creator", principal.policy.version, now, now, now);
  worker.sqlite.prepare("INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(personaId, "adaptive-fallback-replay", actor, userId, streamId, "Fictional Adaptive author", "ready", now, now);
  worker.sqlite.prepare("INSERT INTO impersonation_sessions(impersonation_id,actor_user_id,persona_id,fictional_user_id,replay_session_id,status,started_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(actingId, actor, personaId, userId, "adaptive-fallback-replay", "active", now, new Date(Date.now() + 3_600_000).toISOString());
  // Cookie only: no confirmation header or approval is supplied to later UI
  // requests. Per-interaction Worker policy remains intact.
  worker.setScopedHeaders({ cookie: "forma_impersonation=" + actingId });
  await appendAuditEvent(worker.env, streamId, "user:" + userId, "ProjectCreated", {
    project_id: worker.projectId, name: "Fictional Adaptive context",
  });
  await appendAuditEvent(worker.env, streamId, "user:" + userId, "DocumentCreated", {
    project_id: worker.projectId, document_id: worker.documentId, title: "Fictional Adaptive current document",
  });
  await appendAuditEvent(worker.env, streamId, "user:" + userId, "BlockCreated", {
    project_id: worker.projectId, document_id: worker.documentId, block_id: "scene-reuse-direction", type: "direction",
    handle: "direction/scene-reuse", position: "a", properties: { text: "The keeper checks the harbor.", weight: 1 },
  });
  const effectiveResponse = await worker.request("/api/session"); assert.equal(effectiveResponse.status, 200);
  const effective = await effectiveResponse.json();
  assert.equal(effective.user.userId, userId); assert.equal(effective.impersonation.actor.userId, actor);
  assert.equal(effective.impersonation.impersonationId, actingId); assert.equal(effective.policy.accepted, true);
  assert.equal(effective.assistant, undefined, "Actual Worker impersonation naturally exposes the fallback form");
  const sourceResponse = await worker.request("/api/events?after=0&limit=2000&content=1"); assert.equal(sourceResponse.status, 200);
  const source = await sourceResponse.json();
  assert.ok(source.events.length > 0 && source.events.every(event => event.streamId === streamId));
  assert.ok(source.events.some(event => event.type === "BlockCreated" && event.payload.block_id === "scene-reuse-direction"));
  return { ...worker, owner: userId, streamId, events: source.events,
    fallbackSetup: Object.freeze({ actor, userId, personaId, actingId, principalStreamId: worker.streamId }) };
}
async function cancelFictionalInitialRead(t, x) {
  const { workspaceLocalProposalCopy } = await import("../src/components/design-system/localized-workspace-proposal.ts");
  const { f, h, worker } = x, setup = worker.fallbackSetup; assert.ok(setup);
  assert.equal(h.store.session.get().user.userId, setup.userId);
  assert.equal(h.store.session.get().impersonation.impersonationId, setup.actingId);
  assert.equal(h.store.ui.impersonationConfirmOpen, true);
  assert.equal(h.store.ui.impersonationAction, workspaceLocalProposalCopy(f.i18n.locale).title,
    "Only the actual initial Workspace saved-change read may be declined here");
  const dialogs = f.tree().visible("dialog").filter(node => node.owner === f.host && hasClass(node, "impersonation-confirm-dialog"));
  assert.equal(dialogs.length, 1); const dialog = dialogs[0]; assert.equal(dialog.port.open, true);
  const label = f.i18n.t("impersonation.cancel", "Cancel — do nothing");
  const cancel = f.find("button", node => node.owner === f.host && node.text === label
    && under(node, parent => parent.port === dialog.port));
  assert.ok(cancel.port.isConnected); assert.equal(cancel.port.matches(":disabled"), false);
  const tables = ["events", "event_private_payloads", "event_client_receipts", "private_content", "authoring_commits"];
  const rows = () => Object.fromEntries(tables.map(table => [table, worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
  const original = rows(), money = financial(worker), start = h.requests.length;
  f.native.emit("pointerdown", cancel.port); f.native.focus(cancel.port);
  await f.act(cancel, "click", { button: 0 }); await drain(x);
  assert.equal(h.store.ui.impersonationConfirmOpen, false);
  assert.equal(f.tree().visible("dialog").filter(node => hasClass(node, "impersonation-confirm-dialog")).length, 0);
  assert.equal(h.requests.length, start, "Native Cancel declines the implicit read before dispatch; no confirmation header is manufactured");
  assert.deepEqual(rows(), original); assert.deepEqual(financial(worker), money);
  t.diagnostic("C_ADAPTIVE_FALLBACK_NATIVE_CANCEL " + JSON.stringify({ action: "initial saved-change read",
    actor: setup.actor, fictionalUser: setup.userId, nativeCancel: true, dispatched: 0, exactSourceAndFiscalRowsUnchanged: true }));
}
async function page(t, mode, { fictionalFallback = false } = {}) {
  let external = 0;
  t.mock.method(globalThis, "fetch", async () => { external++; assert.fail("No external/provider request"); });
  let worker = await createSceneCostFixture(1, "visual", { shared: false });
  if (fictionalFallback) { assert.equal(mode, "adaptive"); worker = await actualAdaptiveFallbackWorker(worker); }
  // Disclosed fixture setup through the existing server audit writer; not a
  // simulated user Save. Its genuine source .68 exercises native pristine .7.
  await appendAuditEvent(worker.env, worker.streamId, "user", "BlockWeightSet", {
    block_id: "scene-reuse-direction", weight: .68, previous_weight: 1, source_surface: "alternative-command-fixture"
  });
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  assert.equal("sceneGateForTest" in h.store, false);
  const initial = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get(), session: h.store.session.get() };
  const history = globalThis.history, money = financial(worker);
  globalThis.history = { pushState(_state, _title, path) {
    const url = new URL(path, "http://localhost");
    Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash, href: url.href });
  }, replaceState(...args) { this.pushState(...args); } };
  // Match the existing real-Worker fixture cleanup ordering: inspect ledgers
  // before the reused full-page helper closes its Store/SQLite resources.
  t.after(async () => {
    try {
      assert.equal(external, 0); assert.deepEqual(financial(worker), money);
      assert.equal(h.requests.filter(row => row.init.method === "POST" && (row.url === "/api/document-jobs"
        || /^\/api\/document-jobs\/[^/]+\/(?:run|dismiss|checkpoint)(?:[/?]|$)/u.test(row.url))).length, 0,
        "No generation, forbidden document-job continuation or paid request is exercised");
    } finally { globalThis.history = history; await h.close(); }
  });
  const f = await createCalmFullPage(t, { locale: "en", storeHost: h });
  // Restore ONLY the initial actual Worker state, removing the helper's
  // presentation sample. No Source/session reassignment after observation.
  h.store.events.set(initial.events); h.store.head.set(initial.head);
  h.store.content.set(initial.content); h.store.session.set(initial.session);
  const x = { h, f, worker, mode };
  await native(t, x, ["forma-reality-layers", "forma-adaptive-path"]);
  if (fictionalFallback) await cancelFictionalInitialRead(t, x);
  const projection = h.store.projection.get();
  h.store.setRoute(withDocumentInRoute("/studio/" + mode, worker.documentId, projection.documentTitle));
  await drain(x);
  const tag = mode === "layers" ? "forma-reality-layers" : "forma-adaptive-path";
  const owners = f.components().filter(owner => owner.tag === tag);
  assert.equal(owners.length, 1); x.owner = owners[0];
  assert.ok(x.owner.isConnected && x.owner.store === h.store);
  if (mode === "layers") {
    retainNativeSubmitForms(f, new Set([x.owner]), form => form.classList.contains("layer-inspector"));
    f.draw(); // Observe the first actual part before any original Save captures its form.
  }
  assert.equal(h.store.events.get().some(event => event.eventId.startsWith("synthetic-study-")), false);
  const block = h.store.projection.get().blocks.find(block => block.id === "scene-reuse-direction");
  assert.ok(block); assert.equal(block.properties.weight, .68); x.block = block;
  return x;
}
async function before(x) {
  await drain(x);
  const p = x.h.store.projection.get(), source = x.h.store.captureSourceOwnership(), auth = x.h.store.captureAuthorizationScope();
  assert.ok(x.h.store.sourceOwnershipActive(source) && x.h.store.authorizationScopeActive(auth));
  return { route: x.h.store.route.get(), projectId: p.projectId, documentId: p.documentId, title: p.documentTitle,
    source, auth, session: structuredClone(x.h.store.session.get()), events: structuredClone(x.h.store.events.get()),
    head: x.h.store.head.get(), requests: x.h.requests.length, history: await readWorkspaceEvents(x.worker.env, x.worker.streamId),
    receipts: clientReceipts(x.worker), money: financial(x.worker) };
}
async function unchanged(x, original, allowed = new Set()) {
  await drain(x);
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), original.history);
  assert.deepEqual(clientReceipts(x.worker), original.receipts); assert.deepEqual(financial(x.worker), original.money);
  assert.deepEqual(x.h.store.events.get(), original.events); assert.equal(x.h.store.head.get(), original.head);
  assert.deepEqual(x.h.store.session.get(), original.session);
  assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.auth));
  for (const row of x.h.requests.slice(original.requests)) {
    assert.ok((row.init.method ?? "GET") === "GET" || x.resume.isReadOnlyResume(row) || allowed.has(row),
      "Only actual GET, independently witnessed original read-only Resume or the one expressly allowed free preview: " + row.url);
  }
}
async function openWork(x) {
  const { f, h } = x, route = h.store.route.get(), start = h.requests.length;
  const trigger = f.find("button", node => node.owner === f.host && hasClass(node, "command-trigger"));
  assert.ok(trigger.port.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port); await f.act(trigger, "click", { button: 0 });
  const search = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search");
  const label = f.i18n.t("command.openNavigation", "Open {name}", { name: f.i18n.t("shell.navigation.work", "Work") });
  search.port.value = label; await f.act(search, "input");
  const menus = f.tree().visible("dialog").filter(node => node.owner === f.host && hasClass(node, "command-dialog"));
  assert.equal(menus.length, 1); assert.equal(menus[0].port.open, true);
  const choices = f.tree().visible("button").filter(node => node.owner === f.host && node.attributes.role === "option"
    && under(node, parent => hasClass(parent, "command-dialog"))
    && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label));
  assert.equal(choices.length, 1); const choice = choices[0];
  assert.ok(choice.port.isConnected); assert.equal(choice.port.matches(":disabled"), false);
  assert.equal(h.store.route.get(), route); assert.equal(h.requests.length, start, "Discovery is local");
  f.native.emit("pointerdown", choice.port); f.native.focus(choice.port);
  const focus = f.native.nativeFocus.length, scroll = f.native.nativeScroll.length;
  await f.act(choice, "click", { button: 0 }); await drain(x);
  return { start, focus, scroll };
}
async function openAdaptiveBaseline(t, x) {
  const { f, h } = x, source = h.store.captureSourceOwnership(), authority = h.store.captureAuthorizationScope();
  assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authority));
  const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.port.open);
  const commandBlocker = f.host.ownerDocument.querySelector("dialog[open],.output-requirement-form,.output-plan-review");
  t.diagnostic("C_ADAPTIVE_FALLBACK_ORDINARY_ENTRY " + JSON.stringify({
    liveModalCount: dialogs.length, commandBlocker: commandBlocker ? { tag: commandBlocker.tagName,
      className: commandBlocker.getAttribute("class"), connected: commandBlocker.isConnected, open: Boolean(commandBlocker.open) } : null,
    impersonationId: h.store.session.get()?.impersonation?.impersonationId, evidence: "current full-host controls; no modal or policy override"
  }));
  assert.equal(dialogs.length, 0, "Do not activate a background link through a current modal");
  const continuities = f.components().filter(element => element.tag === "forma-document-continuity" && element.store === h.store);
  assert.equal(continuities.length, 1); const continuity = continuities[0];
  assert.ok(continuity.isConnected); assert.equal(continuity.parentElement, x.owner);
  assert.equal(continuity.closest("forma-shell"), f.host); assert.ok(f.host.contains(continuity));
  const projection = h.store.projection.get(), target = withDocumentInRoute("/", projection.documentId, projection.documentTitle);
  const link = f.find("a", node => node.owner === continuity && node.attributes.href === target);
  assert.ok(link.port.isConnected && !link.hiddenBy); assert.equal(link.port.matches(":disabled"), false);
  assert.ok(link.text.includes("Open baseline"));
  f.native.emit("pointerdown", link.port); f.native.focus(link.port);
  const start = h.requests.length, focus = f.native.nativeFocus.length, scroll = f.native.nativeScroll.length;
  await f.act(link, "click", { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
  await drain(x); return { start, focus, scroll };
}
function refused(x, original, gesture) {
  assert.equal(x.h.store.route.get(), original.route, "Current command must not discard this actual lens's local work");
  assert.ok(x.owner.isConnected && x.f.components().includes(x.owner));
  assert.equal(x.h.requests.length, gesture.start, "No destination read or command on local refusal");
  assert.equal(x.f.native.nativeFocus.slice(gesture.focus).some(row => row.node.owner?.tag === "forma-workspace"), false);
  assert.equal(x.f.native.nativeScroll.length, gesture.scroll);
}
function arrived(x, original) {
  assert.equal(x.h.store.route.get(), withDocumentInRoute("/", original.documentId, original.title));
  assert.equal(documentIdFromRoute(x.h.store.route.get()), original.documentId);
  assert.equal(x.owner.isConnected, false, "Actual origin unmounted, not just a route string change");
  const work = x.f.tree().nodes.filter(node => node.tag === "forma-workspace" && node.component?.isConnected && !node.hiddenBy);
  assert.equal(work.length, 1); assert.equal(work[0].component.store, x.h.store);
}
async function input(x, node, value, eventName = "input") {
  assert.ok(node.port?.isConnected && !node.hiddenBy); assert.equal(node.port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", node.port); x.f.native.focus(node.port); node.port.value = value;
  if (typeof node.handlers[eventName] === "function") await x.f.act(node, eventName);
  else {
    // An ordinary native field without an application listener still owns
    // its live DOM value. This path never calls a private draft setter or
    // substitutes a Save implementation.
    x.f.native.emit(eventName, node.port); await x.f.settle();
  }
}
const layerField = (x, name) => x.f.find(name === "instructions" ? "textarea" : name === "subtype" ? "select" : "input",
  node => node.owner === x.owner && node.attributes.name === name && under(node, parent => hasClass(parent, "layer-inspector")));
async function selectLayer(x) {
  const button = x.f.find("button", node => node.owner === x.owner && hasClass(node, "layer-name")
    && node.children.some(child => typeof child !== "string" && child.tag === "b" && child.text === x.block.handle));
  await x.f.act(button); assert.equal(layerField(x, "handle").port.value, x.block.handle);
}
async function reviewDirection(x) {
  const button = x.f.find("button", node => node.owner === x.owner && under(node, parent => hasClass(parent, "decision-spine"))
    && node.children.some(child => typeof child !== "string" && child.tag === "span"
      && child.children.some(nested => typeof nested !== "string" && nested.tag === "b" && nested.text === x.f.i18n.system("Purpose"))));
  await x.f.act(button);
  assert.equal(x.f.find("textarea", node => node.owner === x.owner && node.attributes.id === "adaptive-custom").port.value, layerText(x.block));
}
async function openNewLayer(x) {
  const trigger = x.f.find("button", node => node.owner === x.owner && hasClass(node, "new-layer-button")
    && under(node, parent => hasClass(parent, "reality-shelf")));
  await x.f.act(trigger);
  const type = x.f.find("button", node => node.owner.tag === "forma-ui-choice-card" && node.owner.value === "direction"
    && under(node, parent => hasClass(parent, "layer-create-dialog")));
  await x.f.act(type);
}
const newField = (x, kind) => x.f.find(kind === "text" ? "textarea" : "input", node => node.owner === x.owner
  && under(node, parent => hasClass(parent, "layer-create-form"))
  && (kind === "text" || kind === "weight" ? kind === "text" || node.attributes.type === "range" : node.attributes.placeholder === "direction/…"));
async function closeNewLayer(x) {
  const button = x.f.find("button", node => node.owner === x.owner && node.text === x.f.i18n.system("Cancel")
    && under(node, parent => hasClass(parent, "layer-create-dialog")));
  await x.f.act(button);
  assert.equal(x.f.tree().visible("dialog").filter(node => hasClass(node, "layer-create-dialog")).length, 0);
}

test("C Layers command: populated native pristine form including .68 to .7 range can depart", options, async t => {
  const x = await page(t, "layers"); await selectLayer(x); const original = await before(x);
  assert.equal(layerField(x, "instructions").port.value, layerText(x.block));
  assert.equal(layerField(x, "weight").port.value, "0.7");
  await openWork(x); arrived(x, original); await unchanged(x, original);
});
test("C Layers command: current handle/instructions/subtype/weight edits refuse, exact native reverts permit departure", options, async t => {
  const x = await page(t, "layers"); await selectLayer(x); const original = await before(x);
  const select = layerField(x, "subtype"), options = x.f.tree().nodes.filter(node => node.tag === "option"
    && under(node, parent => parent.port === select.port)).map(node => String(node.attributes.value));
  const alternate = options.find(value => value !== select.port.value); assert.ok(alternate, "Actual current native subtype alternative");
  const edits = [["handle", x.block.handle + "-draft"], ["instructions", layerText(x.block) + " "], ["subtype", alternate], ["weight", "0.8"]];
  for (const [name, value] of edits) {
    const seed = layerField(x, name).port.value;
    await input(x, layerField(x, name), value, name === "subtype" ? "change" : "input");
    const gesture = await openWork(x); refused(x, original, gesture);
    assert.equal(layerField(x, name).port.value, value);
    await unchanged(x, original);
    await input(x, layerField(x, name), seed, name === "subtype" ? "change" : "input");
    assert.equal(layerField(x, name).port.value, seed);
  }
  await openWork(x); arrived(x, original); await unchanged(x, original);
});
test("C Layers command: closed New retains raw text/name/weight, current reopen and explicit reverts resolve", options, async t => {
  const x = await page(t, "layers"); await selectLayer(x); const original = await before(x);
  await openNewLayer(x); assert.equal(newField(x, "weight").port.value, "0.7");
  await input(x, newField(x, "text"), "  Unsaved new decision  ");
  await input(x, newField(x, "name"), "  New raw handle  "); await input(x, newField(x, "weight"), "0.8");
  await closeNewLayer(x); const gesture = await openWork(x); refused(x, original, gesture); await unchanged(x, original);
  await openNewLayer(x);
  assert.equal(newField(x, "text").port.value, "  Unsaved new decision  ");
  assert.equal(newField(x, "name").port.value, "  New raw handle  "); assert.equal(newField(x, "weight").port.value, "0.8");
  await input(x, newField(x, "text"), ""); await input(x, newField(x, "name"), "");
  await input(x, newField(x, "weight"), "0.7"); await closeNewLayer(x);
  await openWork(x); arrived(x, original); await unchanged(x, original);
});
test("C Adaptive command: actual Review seeds nonempty clean answer and permits departure", options, async t => {
  const x = await page(t, "adaptive"); await reviewDirection(x); const original = await before(x);
  await openWork(x); arrived(x, original); await unchanged(x, original);
});
test("C Adaptive command: current custom raw edit refuses and exact revert permits departure", options, async t => {
  const x = await page(t, "adaptive"); await reviewDirection(x); const original = await before(x);
  const custom = () => x.f.find("textarea", node => node.owner === x.owner && node.attributes.id === "adaptive-custom");
  await input(x, custom(), layerText(x.block) + " ");
  const gesture = await openWork(x); refused(x, original, gesture); assert.equal(custom().port.value, layerText(x.block) + " ");
  await input(x, custom(), layerText(x.block)); await unchanged(x, original);
  await openWork(x); arrived(x, original); await unchanged(x, original);
});
test("C Adaptive ordinary baseline: actual fictional Worker session exposes fallback; raw prompt refuses and exact clear resolves", options, async t => {
  const x = await page(t, "adaptive", { fictionalFallback: true }); await reviewDirection(x);
  const original = await before(x), setup = x.worker.fallbackSetup; assert.ok(setup);
  const session = x.h.store.session.get();
  assert.equal(session.user.userId, setup.userId); assert.equal(session.impersonation.actor.userId, setup.actor);
  assert.equal(session.impersonation.impersonationId, setup.actingId); assert.equal(session.policy.accepted, true);
  assert.equal(session.assistant, undefined);
  const tables = ["events", "event_private_payloads", "event_client_receipts", "replay_personas", "impersonation_sessions"];
  const rows = () => Object.fromEntries(tables.map(table => [table, x.worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
  const protectedRows = rows();
  // Require the actual current fallback posture. Do not disable an enabled
  // Assistant or call a hidden input to manufacture this path.
  const prompt = () => x.f.find("textarea", node => node.owner === x.owner && node.attributes.id === "adaptive-intent-prompt");
  assert.equal(prompt().port.value, ""); await input(x, prompt(), " ");
  const gesture = await openAdaptiveBaseline(t, x); refused(x, original, gesture); assert.equal(prompt().port.value, " ");
  await input(x, prompt(), ""); await openAdaptiveBaseline(t, x); arrived(x, original);
  await cancelFictionalInitialRead(t, x); await unchanged(x, original);
  assert.deepEqual(rows(), protectedRows, "Both original principal and fictional Source/private/receipt/persona rows remain unchanged");
  assert.equal(x.h.requests.some(row => row.init.method === "POST" && (row.url === "/api/context/adaptive/apply" || row.url === "/api/document-jobs")), false);
});
test("C Adaptive command: closed dirty proposal and held genuine free preview stay local; settled review can depart without Apply", options, async t => {
  const x = await proposalPage(t, false, "ja");
  await native(t, x, ["forma-adaptive-path"]); x.owner = currentHost(x);
  const original = await before(x), events = proposalEvents(x);
  await openSuggestion(x);
  const text = () => x.f.find("textarea", node => inProposal(node) && node.attributes.maxlength === "16000");
  const seed = text().port.value; assert.ok(seed);
  await input(x, text(), seed + " — retained local proposal");
  await x.f.act(control(x, "action.close")); await drain(x);
  let gesture = await openWork(x); refused(x, original, gesture);
  assert.equal(snapshot(x.owner).visible, false); await unchanged(x, original);
  await openSuggestion(x); assert.equal(text().port.value, seed + " — retained local proposal");
  await input(x, text(), seed); // Current real edit; preview, not equality alone, resolves controller dirty state.
  const entered = sceneDeferred(), gate = sceneDeferred();
  const hold = { action: "preview", entered, gate, record: null, release: () => gate.resolve() };
  x.holds.push(hold); x.gates.push(hold);
  const start = x.h.requests.length, pending = begin(x, control(x, "adaptive.changes.preview"));
  const record = await enteredOrTerminal(entered.promise, pending, "actual free-preview Worker response before original JSON delivery");
  assert.equal(record.status, 200); assert.equal(record.body.status, "review");
  assert.equal(record.body.preview.adaptiveReview.executionId, x.state.paidQuote.executionId);
  const previewRequests = x.h.requests.slice(start).filter(row => row.url === "/api/context/adaptive/apply" && row.body?.action === "preview");
  assert.equal(previewRequests.length, 1); const allowed = new Set(previewRequests);
  await x.f.act(control(x, "action.close")); assert.equal(snapshot(x.owner).busy, true);
  gesture = await openWork(x); refused(x, original, gesture); await unchanged(x, original, allowed);
  hold.release(); await pending; await settleProposal(x); await drain(x);
  assert.equal(snapshot(x.owner).visible, false); assert.equal(snapshot(x.owner).busy, false);
  assert.equal(snapshot(x.owner).phase, "review"); assert.equal(snapshot(x.owner).uncertain, false);
  assert.equal(snapshot(x.owner).canApply, true); assert.equal(snapshot(x.owner).preview.previewId, record.body.preview.previewId);
  assert.equal(proposalApplies(x).length, 0); assert.equal(proposalReceipts(x).length, 0); assert.deepEqual(proposalEvents(x), events);
  await openWork(x); arrived(x, original); await unchanged(x, original, allowed);
  assert.equal(x.state.calls.length, 1, "One disclosed finite provider seed only; zero new provider work");
  assert.equal(proposalApplies(x).length, 0);
});


// One healthy post-Add control, appended without changing the original six.
// It narrows Atomic 5f831's exact original-append/SAME-response contract to this
// one Layers invocation. No generic write exemption or replacement receipt.
test("C Layers command: acknowledged non-direction Add with chosen subtype is clean and can depart", options, async t => {
  const x = await page(t, "layers"); await selectLayer(x);
  const initial = await before(x), raw = "  Measured editorial atmosphere  ", text = raw.trim();
  await openNewLayer(x);
  const type = x.f.find("select", node => node.owner === x.owner && under(node, parent => hasClass(parent, "layer-create-form")));
  await input(x, type, "style", "change");
  const radios = x.f.tree().visible("input").filter(node => node.owner === x.owner && node.attributes.name === "new-layer-subtype"
    && under(node, parent => hasClass(parent, "layer-create-form")));
  const suggested = radios.find(node => node.port.checked); assert.ok(suggested, "Actual current suggested subtype radio");
  const chosen = radios.find(node => node.port.value !== suggested.port.value); assert.ok(chosen, "Actual non-suggested subtype choice");
  const subtype = chosen.port.value;
  assert.ok(chosen.port.isConnected); chosen.port.checked = true; await x.f.act(chosen, "change");
  const selectedRadio = x.f.tree().visible("input").filter(node => node.owner === x.owner && node.attributes.name === "new-layer-subtype" && node.port.checked);
  assert.equal(selectedRadio.length, 1); assert.equal(selectedRadio[0].port.value, subtype);
  await input(x, newField(x, "text"), raw);
  const name = x.f.find("input", node => node.owner === x.owner && node.attributes.placeholder === "style/…"
    && under(node, parent => hasClass(parent, "layer-create-form")));
  assert.equal(name.port.value, ""); assert.equal(newField(x, "weight").port.value, "0.7");
  await drain(x);

  const prior = x.h.transport; assert.equal(typeof prior, "function");
  let observed = null, writing = null, armed = false;
  x.h.transport = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") {
      if (writing) await writing; return prior(request);
    }
    assert.equal(armed, true, "Only this current visible native Add is armed");
    assert.equal(observed, null, "One original append, no retry");
    const init = request.init, bytes = init.body, body = request.body, payload = body.event?.payload;
    observed = { request, init, bytes, response: null, receipt: null };
    let release; writing = new Promise(resolve => { release = resolve; });
    try {
      await x.resume.settleOriginalRequests();
      assert.equal(x.h.store.route.get(), initial.route);
      assert.ok(x.h.store.sourceOwnershipActive(initial.source) && x.h.store.authorizationScopeActive(initial.auth));
      assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(body.action, "append"); assert.equal(body.clientId, "web:lit"); assert.equal(body.expectedSequence, initial.head);
      assert.equal(bytes, JSON.stringify(body)); assert.deepEqual(body.events, [body.event]);
      assert.match(payload.block_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
      assert.deepEqual(body.event, { type: "BlockCreated", payload: {
        block_id: payload.block_id, document_id: initial.documentId, type: "style", handle: "style/measured-editorial-atmosphere",
        position: "z" + String(initial.head + 1).padStart(5, "0"),
        properties: { text, subtype, weight: .68, authority: "authored", created_from: "reality-layers", activation_method: "custom-layer" }
      } });
      const response = await prior(request); assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
      assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]); assert.deepEqual(receipt.rejected, []);
      assert.equal(receipt.appended.length, 1); const event = receipt.appended[0];
      assert.equal(event.type, "BlockCreated"); assert.deepEqual(event.payload, payload);
      assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit"); assert.equal(event.streamId, x.worker.streamId);
      assert.equal(event.sequence, initial.head + 1); assert.equal(receipt.head, event.sequence);
      assert.equal(event.compensatesEventId, null); assert.equal(payload.client_event_id, undefined);
      await x.worker.drainBackground();
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...initial.history, event]);
      const row = x.worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(event.eventId);
      assert.ok(row); assert.equal(row.sequence, event.sequence); assert.equal(row.type, event.type);
      assert.deepEqual(JSON.parse(row.private_json), payload);
      assert.deepEqual(clientReceipts(x.worker), initial.receipts); assert.deepEqual(financial(x.worker), initial.money);
      observed.response = response; observed.receipt = receipt;
      assert.equal(request.init, init); assert.equal(request.init.body, bytes);
      return response; // SAME real response; no acknowledgment synthesized from the clone.
    } finally { writing = null; release(); }
  };
  t.after(() => { x.h.transport = prior; });
  const form = x.f.find("form", node => node.owner === x.owner && hasClass(node, "layer-create-form"));
  const add = x.f.find("button", node => node.owner === x.owner && node.text.includes(x.f.i18n.system("Add context"))
    && under(node, parent => parent.port === form.port));
  assert.ok(add.port.isConnected); assert.equal(add.port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", add.port); x.f.native.focus(add.port); armed = true;
  await x.f.act(form, "submit", { submitter: add.port }); armed = false; await drain(x);
  assert.ok(observed?.receipt); assert.equal(observed.response.bodyUsed, true, "Actual Store consumed the SAME original positive response");
  const event = observed.receipt.appended[0], blockId = event.payload.block_id;
  assert.deepEqual(x.h.store.events.get(), [...initial.events, event]); assert.equal(x.h.store.head.get(), event.sequence);
  assert.equal(x.h.store.route.get(), initial.route); assert.equal(x.owner.isConnected, true);
  assert.equal(x.f.tree().visible("dialog").filter(node => hasClass(node, "layer-create-dialog")).length, 0,
    "Successful Add actually closes the original New presentation");
  assert.equal(layerField(x, "handle").port.value, event.payload.handle);
  assert.equal(layerField(x, "instructions").port.value, text); assert.equal(layerField(x, "subtype").port.value, subtype);
  assert.equal(layerField(x, "weight").port.value, "0.7", "New selected canonical .68 inspector is pristine at native .7");
  const created = x.h.store.projection.get().blocks.find(block => block.id === blockId);
  assert.ok(created); assert.equal(created.type, "style"); assert.equal(created.properties.subtype, subtype);
  assert.equal(created.properties.weight, .68); assert.equal(created.properties.text, text);
  await x.h.store.refreshEvents({ fromStart: true }); await drain(x);
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...initial.history, event]);
  assert.deepEqual(x.h.store.events.get(), [...initial.events, event]); assert.equal(x.h.store.head.get(), event.sequence);
  assert.deepEqual(clientReceipts(x.worker), initial.receipts); assert.deepEqual(financial(x.worker), initial.money);
  assert.equal(x.h.requests.filter(row => row.url === "/api/events" && row.init.method === "POST").length, 1);
  assert.deepEqual(x.h.requests.slice(initial.requests).filter(row => (row.init.method ?? "GET") !== "GET"
    && row !== observed.request && !x.resume.isReadOnlyResume(row)), [], "No other write has a generic exemption");
  const acknowledged = await before(x);
  const gesture = await openWork(x);
  t.diagnostic("C_LAYERS_ACKNOWLEDGED_DEFAULT " + JSON.stringify({ nativeAddRequests: 1, originalWorkerStatus: 200,
    sameResponseConsumed: true, exactBlockId: blockId, selectedType: created.type, selectedSubtype: subtype,
    modalClosed: true, canonicalSavedWeight: .68, nativePristineWeight: .7, commandRequestStart: gesture.start,
    route: x.h.store.route.get(), originRoute: acknowledged.route, originConnected: x.owner.isConnected,
    evidence: "actual Shell/Layer native controls and one original RAM Worker append; no provider or physical-browser proof" }));
  arrived(x, acknowledged); await unchanged(x, acknowledged);
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...initial.history, event]);
  assert.equal(x.h.requests.filter(row => row.url === "/api/events" && row.init.method === "POST").length, 1);
  assert.equal(observed.request.init, observed.init); assert.equal(observed.request.init.body, observed.bytes);
});


// Two additive current-control cases. Reuse the same full Shell/Store/Worker
// fixture and request/receipt/fiscal assertions; do not replace a host method.
function currentLayerExit(x, label) {
  return x.f.find("button", node => node.owner === x.owner
    && under(node, parent => parent.tag === "main" && hasClass(parent, "reality-stage"))
    && (label === "Review the full document"
      ? under(node, parent => parent.tag === "footer" && parent.parent?.tag === "main" && hasClass(parent.parent, "reality-stage"))
        && node.text.includes(x.f.i18n.system(label))
      : under(node, parent => hasClass(parent, "editor-toolbar"))
        && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === x.f.i18n.system(label))));
}
async function activateLayerExit(x, label) {
  const node = currentLayerExit(x, label);
  assert.ok(node.port.isConnected && x.owner.isConnected);
  assert.equal(node.port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", node.port); x.f.native.focus(node.port);
  const gesture = { start: x.h.requests.length, focus: x.f.native.nativeFocus.length, scroll: x.f.native.nativeScroll.length };
  await x.f.act(node, "click", { button: 0 }); await drain(x);
  return gesture;
}
async function currentOrdinaryRouteMappings() {
  // Source coverage only for the identical Adaptive route callers. This is
  // not a substituted renderer or an assertion that those controls were used.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/components/forma-studio-editor-alternatives.ts", import.meta.url), "utf8");
  const currentRender = name => {
    const owner = source.indexOf("export class " + name + " extends AlternativeStudio {");
    assert.ok(owner >= 0, "Exact current alternative class");
    const start = source.indexOf("  override render() {", owner), end = source.indexOf("  legacyRender(){", start);
    assert.ok(start > owner && end > start, "Current render and separately named legacy body are distinct");
    return source.slice(start, end);
  };
  const layers = currentRender("FormaRealityLayers"), adaptive = currentRender("FormaAdaptivePath");
  assert.ok(source.includes('const navigateAlternativeView=(origin:AlternativeStudio,path:string)=>navigateInApp(origin,navigation=>navigation.route(path));'));
  const mappings = [
    ["Layers Plan", layers, '<button @click=${() => navigateAlternativeView(this, "/studio/board")}>${icon("grid")}<span>Plan</span></button>'],
    ["Layers Write", layers, '<button @click=${() => navigateAlternativeView(this, "/")}>${icon("edit")}<span>Write</span></button>'],
    ["Layers footer", layers, '@click=${() => navigateAlternativeView(this, "/")}>Review the full document ${icon("arrow")}'],
    ["Adaptive ready review", adaptive, '<button class="button secondary" @click=${() => navigateAlternativeView(this, "/")}>Review full document</button>'],
    ["Adaptive supporting decision", adaptive, '<li><button @click=${() => navigateAlternativeView(this, "/")}><span><b>'],
  ];
  for (const [name, render, exact] of mappings) assert.ok(render.includes(exact), name + " keeps its exact current target through the same ordinary admission");
  assert.equal((layers.match(/navigateAlternativeView\(this,/gu) ?? []).length, 3);
  assert.equal((adaptive.match(/navigateAlternativeView\(this,/gu) ?? []).length, 2);
  assert.equal(layers.includes("this.store.setRoute("), false);
  assert.equal(adaptive.includes("this.store.setRoute("), false);
}

test("C Layers ordinary navigation: pristine Plan reaches the exact same-document Board", options, async t => {
  const x = await page(t, "layers"); await selectLayer(x);
  await registerCalmFullPageComponents(x.f, ["forma-context-board"]); await drain(x);
  const original = await before(x);
  assert.equal(layerField(x, "instructions").port.value, layerText(x.block));
  assert.equal(layerField(x, "weight").port.value, "0.7");
  await activateLayerExit(x, "Plan");
  assert.equal(x.h.store.route.get(), withDocumentInRoute("/studio/board", original.documentId, original.title));
  assert.equal(documentIdFromRoute(x.h.store.route.get()), original.documentId);
  assert.equal(x.owner.isConnected, false, "Actual Layer owner was replaced, not just its route string");
  const boards = x.f.tree().nodes.filter(node => node.tag === "forma-context-board" && node.component?.isConnected && !node.hiddenBy);
  assert.equal(boards.length, 1); assert.equal(boards[0].component.store, x.h.store);
  assert.equal(x.h.store.projection.get().documentId, original.documentId);
  await unchanged(x, original);
});

test("C Layers ordinary navigation: Plan Write and footer retain raw work; exact revert permits Write", options, async t => {
  const x = await page(t, "layers"); await selectLayer(x);
  await registerCalmFullPageComponents(x.f, ["forma-context-board"]); await drain(x);
  const original = await before(x), seed = layerField(x, "instructions").port.value, raw = seed + " — unsent current Layer edit";
  assert.equal(seed, layerText(x.block));
  await input(x, layerField(x, "instructions"), raw);
  for (const label of ["Plan", "Write", "Review the full document"]) {
    const gesture = await activateLayerExit(x, label);
    refused(x, original, gesture);
    assert.equal(x.f.native.nativeFocus.slice(gesture.focus)
      .some(row => ["forma-context-board", "forma-workspace"].includes(row.node.owner?.tag)), false,
      "No destination focus after a current raw-work refusal");
    assert.equal(layerField(x, "instructions").port.value, raw, label + " retains the exact live native value");
    assert.deepEqual(x.h.store.projection.get().blocks.find(block => block.id === x.block.id), x.block);
    await unchanged(x, original);
  }
  await input(x, layerField(x, "instructions"), seed);
  assert.equal(layerField(x, "instructions").port.value, seed);
  await activateLayerExit(x, "Write"); arrived(x, original); await unchanged(x, original);
  await currentOrdinaryRouteMappings();
});

// C167 known-original manual answer custody only. Reuse this actual Adaptive
// page/Store/Worker and original Resume observer; never enter paid suggestions,
// planning, Apply, generation, document-job continuation or a replay fixture.
const cAdaptiveManualField = x => x.f.find("textarea", node => node.owner === x.owner && node.attributes.id === "adaptive-custom");
function cAdaptiveManualDecision(x) {
  const tree = x.f.tree(), active = tree.visible("button").filter(node => node.owner === x.owner && hasClass(node, "active")
    && under(node, parent => hasClass(parent, "decision-spine")));
  assert.equal(active.length, 1);
  const label = tree.visible("b").filter(node => under(node, parent => parent === active[0]));
  assert.equal(label.length, 1); return label[0].text;
}
function cAdaptiveManualSubmit(x) {
  const tree = x.f.tree(), forms = tree.visible("form").filter(node => node.owner === x.owner && hasClass(node, "adaptive-custom"));
  assert.equal(forms.length, 1); assert.ok(forms[0].port.isConnected && x.f.renderer.nodes.includes(forms[0].port));
  assert.equal(typeof forms[0].handlers.submit, "function"); assert.equal(forms[0].port.handlers.submit, forms[0].handlers.submit);
  const buttons = tree.visible("button").filter(node => node.owner === x.owner
    && under(node, parent => parent === forms[0]) && String(node.attributes.type ?? "submit").toLowerCase() === "submit");
  assert.equal(buttons.length, 1); assert.ok(buttons[0].port.isConnected && x.f.renderer.nodes.includes(buttons[0].port));
  assert.equal(buttons[0].attributes.form, undefined); assert.equal(buttons[0].handlers.click, undefined);
  assert.equal(buttons[0].port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", buttons[0].port); x.f.native.focus(buttons[0].port);
  return x.f.act(forms[0], "submit", { submitter: buttons[0].port });
}
function cAdaptiveObserveManualAnswer(x, original, raw, holdOriginal) {
  assert.equal(x.mode, "adaptive"); assert.equal(cAdaptiveManualField(x).port.value, raw);
  assert.equal(cAdaptiveManualDecision(x), x.f.i18n.system("Purpose"));
  assert.equal(x.block.id, "scene-reuse-direction"); assert.equal(x.block.type, "direction");
  assert.equal(x.block.properties.subtype, undefined, "actual fixture has no extra subtype write");
  assert.equal(x.block.properties.source_artifact_id, undefined); assert.equal(x.block.properties.source_output_id, undefined);
  assert.ok(raw.trim() && raw.trim() !== layerText(x.block));
  const expected = { type: "BlockPropertyEdited", payload: { block_id: x.block.id, property_path: "text",
    old_value: layerText(x.block), new_value: raw.trim(), source_surface: "adaptive-path" } };
  const prior = x.h.transport, entered = sceneDeferred(), delivery = sceneDeferred();
  let record = null, writing = null;
  const witnessed = request => Boolean(record?.receipt && request === record.request
    && request.init === record.init && request.init.body === record.bytes && record.response.status === 200);
  const transport = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") {
      if (writing) await writing; return prior(request);
    }
    assert.equal(record, null, "exactly one original manual answer, never retry or a generic authoring exemption");
    const init = request.init, bytes = init.body, body = request.body;
    record = { request, init, bytes, response: null, receipt: null, held: false, released: false, error: null };
    let release; writing = new Promise(resolve => { release = resolve; });
    try {
      await x.resume.settleOriginalRequests();
      assert.equal(x.h.store.route.get(), original.route);
      assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.auth));
      assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(body.action, "append"); assert.equal(body.clientId, "web:lit"); assert.equal(body.expectedSequence, original.head);
      assert.equal(bytes, JSON.stringify(body)); assert.deepEqual(body.event, expected); assert.deepEqual(body.events, [expected]);
      const response = await prior(request); assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
      assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]); assert.deepEqual(receipt.rejected, []);
      assert.equal(receipt.appended.length, 1); const event = receipt.appended[0];
      assert.equal(event.type, expected.type); assert.deepEqual(event.payload, expected.payload);
      assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit"); assert.equal(event.streamId, x.worker.streamId);
      assert.equal(event.sequence, original.head + 1); assert.equal(receipt.head, event.sequence); assert.equal(event.compensatesEventId, null);
      assert.equal(event.payload.client_event_id, undefined);
      await x.worker.drainBackground();
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...original.history, event]);
      const row = x.worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(event.eventId);
      assert.ok(row); assert.equal(row.sequence, event.sequence); assert.equal(row.type, event.type);
      assert.deepEqual(JSON.parse(row.private_json), expected.payload);
      assert.deepEqual(clientReceipts(x.worker), original.receipts); assert.deepEqual(financial(x.worker), original.money);
      record.response = response; record.receipt = receipt;
      assert.equal(request.init, init); assert.equal(request.init.body, bytes);
      if (holdOriginal) {
        // Finish the original prior transport/SQL proof before holding only
        // delivery of this SAME response; unrelated current reads still settle.
        writing = null; release(); record.held = true; entered.resolve(record); await delivery.promise;
      }
      return response;
    } catch (error) { record.error = error; entered.resolve(record); throw error; }
    finally { writing = null; release(); }
  };
  x.h.transport = transport;
  return {
    entered: entered.promise,
    async assertHeld() {
      assert.ok(holdOriginal && record); assert.ifError(record.error); assert.equal(record.held, true);
      assert.equal(record.released, false); assert.equal(record.response.status, 200); assert.equal(record.response.bodyUsed, false);
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...original.history, ...record.receipt.appended]);
      assert.deepEqual(x.h.store.events.get(), original.events); assert.equal(x.h.store.head.get(), original.head);
      assert.deepEqual(clientReceipts(x.worker), original.receipts); assert.deepEqual(financial(x.worker), original.money);
      assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.auth));
      assert.deepEqual(x.h.requests.slice(original.requests).filter(request => (request.init.method ?? "GET") !== "GET"
        && !x.resume.isReadOnlyResume(request) && !witnessed(request)), []);
    },
    release() { if (record) record.released = true; delivery.resolve(); },
    async accept() {
      assert.ok(record); assert.ifError(record.error); assert.ok(witnessed(record.request));
      assert.equal(record.response.bodyUsed, true, "the actual Store consumed the SAME original Worker200");
      const events = [...original.events, ...record.receipt.appended], history = [...original.history, ...record.receipt.appended];
      assert.deepEqual(x.h.store.events.get(), events); assert.equal(x.h.store.head.get(), record.receipt.head);
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), history);
      const accepted = { ...original, events, history, head: record.receipt.head }, allowed = new Set([record.request]);
      await unchanged(x, accepted, allowed);
      assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
      const block = x.h.store.projection.get().blocks.find(value => value.id === x.block.id);
      assert.ok(block); assert.equal(block.documentId, original.documentId); assert.equal(block.projectId, original.projectId);
      assert.equal(layerText(block), raw.trim());
      return { accepted, allowed, event: record.receipt.appended[0] };
    },
    restore() { if (x.h.transport === transport) x.h.transport = prior; },
  };
}

for (const state of ["unchanged", "newer", "pending-restored"])
test("C Adaptive manual original Save / " + state, options, async t => {
  const x = await page(t, "adaptive"); await reviewDirection(x); const original = await before(x);
  const rawA = "  The actual original purpose A remains one authored decision.  ";
  const rawB = " \nNewer manual answer B remains unsent — 保留\t ";
  await input(x, cAdaptiveManualField(x), rawA);
  const observed = cAdaptiveObserveManualAnswer(x, original, rawA, state !== "unchanged");
  t.after(() => observed.restore());
  const saving = cAdaptiveManualSubmit(x); let pending, proof;
  try {
    if (state === "unchanged") await saving;
    else {
      await enteredOrTerminal(observed.entered, saving, "actual original manual answer Worker200 delivery hold");
      await observed.assertHeld();
      if (state === "newer") {
        await input(x, cAdaptiveManualField(x), rawB);
        assert.equal(cAdaptiveManualField(x).port.value, rawB);
        assert.equal(cAdaptiveManualDecision(x), x.f.i18n.system("Purpose"));
      } else {
        const projected = x.h.store.projection.get().blocks.find(block => block.id === x.block.id);
        const canonical = layerText(x.block);
        assert.equal(canonical, "The keeper checks the harbor.", "the original actual fixture Source value, not a fabricated optimistic A");
        assert.ok(projected); assert.equal(layerText(projected), canonical, "the held original response has not published A into current canonical text");
        await input(x, cAdaptiveManualField(x), canonical);
        assert.equal(cAdaptiveManualField(x).port.value, canonical);
        const gesture = await openWork(x); await observed.assertHeld();
        pending = { route: x.h.store.route.get(), connected: x.owner.isConnected,
          requestDelta: x.h.requests.length - gesture.start, scrollDelta: x.f.native.nativeScroll.length - gesture.scroll };
      }
      await observed.assertHeld();
    }
  } finally {
    observed.release(); await saving; await drain(x); proof = await observed.accept();
  }
  const actual = x.owner.isConnected ? { raw: cAdaptiveManualField(x).port.value, decision: cAdaptiveManualDecision(x) } : null;
  t.diagnostic("C_ADAPTIVE_MANUAL_ORIGINAL " + JSON.stringify({ state, actual, pending,
    originalWorker200: 1, exactOriginalTextEdit: proof.event.eventId, exactHistoryPrivatePayloadReceiptAndFiscalVerified: true,
    source: "actual current native unpaid answer; no paid suggestion, Apply, generation or document-job probe" }));
  if (state === "newer") {
    assert.equal(x.h.store.route.get(), original.route); assert.ok(x.owner.isConnected);
    assert.equal(actual.raw, rawB, "original A must not clear the newer unsent manual Adaptive answer");
    assert.equal(actual.decision, x.f.i18n.system("Purpose"), "original A must not conceal B by advancing to another decision");
    const gesture = await openWork(x); refused(x, proof.accepted, gesture); await unchanged(x, proof.accepted, proof.allowed);
    assert.equal(cAdaptiveManualField(x).port.value, rawB);
    await input(x, cAdaptiveManualField(x), rawA.trim());
  } else if (state === "pending-restored") {
    assert.equal(pending.route, original.route, "restoring the actual canonical value does not release the original pending answer");
    assert.equal(pending.connected, true); assert.equal(pending.requestDelta, 0); assert.equal(pending.scrollDelta, 0);
    assert.ok(x.owner.isConnected);
  } else {
    assert.equal(actual.raw, ""); assert.equal(actual.decision, x.f.i18n.system("Audience"),
      "unchanged acknowledged A retains the existing next-decision progression");
  }
  await openWork(x); arrived(x, proof.accepted); await unchanged(x, proof.accepted, proof.allowed);
  assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
});

// C170 known-original New/Add custody. Reuse the existing full Layers page,
// native form/range ports and exact original Worker proof; no new fixture,
// paid path, generation, job continuation, retry or unknown-save recovery.
function cLayerOriginalForm(x) {
  const tree = x.f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === x.owner && hasClass(node, "layer-create-dialog"));
  assert.equal(dialogs.length, 1); assert.ok(dialogs[0].port.open && dialogs[0].port.isConnected);
  const forms = tree.visible("form").filter(node => node.owner === x.owner && hasClass(node, "layer-create-form")
    && under(node, parent => parent === dialogs[0]));
  assert.equal(forms.length, 1); const form = forms[0];
  assert.ok(form.port.isConnected && x.f.renderer.nodes.includes(form.port));
  assert.equal(typeof form.handlers.submit, "function"); assert.equal(form.port.handlers.submit, form.handlers.submit);
  const field = (tag, predicate = () => true) => {
    const nodes = tree.visible(tag).filter(node => node.owner === x.owner && under(node, parent => parent === form) && predicate(node));
    assert.equal(nodes.length, 1); assert.ok(nodes[0].port.isConnected && !nodes[0].port.matches(":disabled")); return nodes[0];
  };
  const type = field("select"), text = field("textarea"), name = field("input", node => node.attributes.placeholder === "direction/…");
  const weight = field("input", node => node.attributes.type === "range");
  const selected = field("input", node => node.attributes.name === "new-layer-subtype" && node.port.checked);
  assert.equal(type.port.value, "direction");
  return { tree, dialog: dialogs[0], form, type, text, name, weight, selected };
}
function cLayerOriginalSubmit(x) {
  const view = cLayerOriginalForm(x), buttons = view.tree.visible("button").filter(node => node.owner === x.owner
    && under(node, parent => parent === view.form) && String(node.attributes.type ?? "submit").toLowerCase() === "submit");
  assert.equal(buttons.length, 1); const button = buttons[0];
  assert.ok(button.port.isConnected && x.f.renderer.nodes.includes(button.port));
  assert.equal(button.port.matches(":disabled"), false); assert.equal(button.attributes.form, undefined);
  assert.equal(button.handlers.click, undefined, "the actual form submit is the sole native Add default action");
  x.f.native.emit("pointerdown", button.port); x.f.native.focus(button.port);
  return x.f.act(view.form, "submit", { submitter: button.port });
}
function cLayerObserveOriginalCreate(x, original, raw, subtype, holdOriginal) {
  assert.equal(x.mode, "layers"); const view = cLayerOriginalForm(x);
  assert.equal(view.text.port.value, raw); assert.equal(view.name.port.value, "");
  assert.equal(view.weight.port.value, "0.7"); assert.equal(view.selected.port.value, subtype);
  const prior = x.h.transport, entered = sceneDeferred(), delivery = sceneDeferred();
  let record = null, writing = null;
  const witnessed = request => Boolean(record?.receipt && request === record.request && request.init === record.init
    && request.init.body === record.bytes && record.response.status === 200);
  const transport = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") {
      if (writing) await writing; return prior(request);
    }
    assert.equal(record, null, "one actual original Add, no retry or general POST exemption");
    const init = request.init, bytes = init.body, body = request.body, payload = body.event?.payload;
    record = { request, init, bytes, response: null, receipt: null, held: false, released: false, error: null };
    let release; writing = new Promise(resolve => { release = resolve; });
    try {
      await x.resume.settleOriginalRequests();
      assert.equal(x.h.store.route.get(), original.route);
      assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.auth));
      assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(body.action, "append"); assert.equal(body.clientId, "web:lit"); assert.equal(body.expectedSequence, original.head);
      assert.equal(bytes, JSON.stringify(body)); assert.deepEqual(body.events, [body.event]);
      assert.match(payload.block_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
      assert.deepEqual(body.event, { type: "BlockCreated", payload: {
        block_id: payload.block_id, document_id: original.documentId, type: "direction", handle: "direction/earlier-layer-a",
        position: "z" + String(original.head + 1).padStart(5, "0"), properties: { text: raw.trim(), subtype, weight: .68,
          authority: "authored", created_from: "reality-layers", activation_method: "custom-layer" }
      } });
      const response = await prior(request); assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
      assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]); assert.deepEqual(receipt.rejected, []);
      assert.equal(receipt.appended.length, 1); const event = receipt.appended[0];
      assert.equal(event.type, "BlockCreated"); assert.deepEqual(event.payload, payload);
      assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit"); assert.equal(event.streamId, x.worker.streamId);
      assert.equal(event.sequence, original.head + 1); assert.equal(receipt.head, event.sequence);
      assert.equal(event.compensatesEventId, null); assert.equal(payload.client_event_id, undefined);
      await x.worker.drainBackground();
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...original.history, event]);
      const row = x.worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(event.eventId);
      assert.ok(row); assert.equal(row.sequence, event.sequence); assert.equal(row.type, event.type);
      assert.deepEqual(JSON.parse(row.private_json), payload);
      assert.deepEqual(clientReceipts(x.worker), original.receipts); assert.deepEqual(financial(x.worker), original.money);
      record.response = response; record.receipt = receipt;
      assert.equal(request.init, init); assert.equal(request.init.body, bytes);
      if (holdOriginal) {
        // The original prior transport has completed. Only delivery of its
        // exact response is held, so unrelated current read settling is real.
        writing = null; release(); record.held = true; entered.resolve(record); await delivery.promise;
      }
      return response;
    } catch (error) { record.error = error; entered.resolve(record); throw error; }
    finally { writing = null; release(); }
  };
  x.h.transport = transport;
  return {
    entered: entered.promise,
    async assertHeld() {
      assert.ok(holdOriginal && record); assert.ifError(record.error); assert.equal(record.held, true);
      assert.equal(record.released, false); assert.equal(record.response.status, 200); assert.equal(record.response.bodyUsed, false);
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...original.history, ...record.receipt.appended]);
      assert.deepEqual(x.h.store.events.get(), original.events); assert.equal(x.h.store.head.get(), original.head);
      assert.deepEqual(clientReceipts(x.worker), original.receipts); assert.deepEqual(financial(x.worker), original.money);
      assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.auth));
      assert.deepEqual(x.h.requests.slice(original.requests).filter(request => (request.init.method ?? "GET") !== "GET"
        && !x.resume.isReadOnlyResume(request) && !witnessed(request)), []);
    },
    release() { if (record) record.released = true; delivery.resolve(); },
    async accept() {
      assert.ok(record); assert.ifError(record.error); assert.ok(witnessed(record.request));
      assert.equal(record.response.bodyUsed, true, "actual Store consumed the SAME original positive response");
      const event = record.receipt.appended[0], events = [...original.events, event], history = [...original.history, event];
      assert.deepEqual(x.h.store.events.get(), events); assert.equal(x.h.store.head.get(), record.receipt.head);
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), history);
      const accepted = { ...original, events, history, head: record.receipt.head }, allowed = new Set([record.request]);
      await unchanged(x, accepted, allowed);
      assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
      const block = x.h.store.projection.get().blocks.find(value => value.id === event.payload.block_id);
      assert.ok(block); assert.equal(block.documentId, original.documentId); assert.equal(block.projectId, original.projectId);
      assert.equal(block.type, "direction"); assert.equal(block.handle, event.payload.handle);
      assert.equal(layerText(block), raw.trim()); assert.equal(block.properties.subtype, subtype); assert.equal(block.properties.weight, .68);
      return { accepted, allowed, event, block };
    },
    restore() { if (x.h.transport === transport) x.h.transport = prior; },
  };
}

for (const state of ["unchanged", "newer-same-open", "newer-reopened"])
test("C Layers original New Add / " + state, options, async t => {
  const x = await page(t, "layers"); await selectLayer(x); const original = await before(x);
  const rawA = "  Earlier layer A  ", rawB = " \nNewer layer B remains unsent — 保留\t ", nameB = "  direction/raw-B  ";
  await openNewLayer(x); const first = cLayerOriginalForm(x), subtype = first.selected.port.value;
  assert.equal(first.text.port.value, ""); assert.equal(first.name.port.value, ""); assert.equal(first.weight.port.value, "0.7");
  await input(x, newField(x, "text"), rawA); await drain(x);
  const observed = cLayerObserveOriginalCreate(x, original, rawA, subtype, state !== "unchanged");
  t.after(() => observed.restore()); const saving = cLayerOriginalSubmit(x);
  try {
    if (state === "unchanged") await saving;
    else {
      await enteredOrTerminal(observed.entered, saving, "actual original Layers Add Worker200 delivery hold");
      await observed.assertHeld();
      if (state === "newer-reopened") {
        await closeNewLayer(x); await drain(x); await observed.assertHeld();
        // Native Cancel closes only this presentation; the dispatched A is
        // still held and committed. A real New/type gesture opens the next one.
        await openNewLayer(x); assert.equal(cLayerOriginalForm(x).text.port.value, rawA);
      }
      await input(x, newField(x, "text"), rawB); await input(x, newField(x, "name"), nameB);
      await input(x, newField(x, "weight"), "0.8");
      const current = cLayerOriginalForm(x);
      assert.equal(current.text.port.value, rawB); assert.equal(current.name.port.value, nameB);
      assert.equal(current.weight.port.value, "0.8"); assert.equal(current.selected.port.value, subtype);
      await observed.assertHeld();
    }
  } finally { observed.release(); await saving; await drain(x); }
  const proof = await observed.accept(), dialogs = x.f.tree().visible("dialog")
    .filter(node => node.owner === x.owner && hasClass(node, "layer-create-dialog"));
  t.diagnostic("C_LAYERS_ORIGINAL_CREATE " + JSON.stringify({ state, currentDialogCount: dialogs.length,
    originalWorker200: 1, exactCommittedBlock: proof.block.id, originalResponseConsumed: true,
    historyPrivatePayloadReceiptAndFiscalVerified: true, cancelledPresentationNotOperation: state === "newer-reopened",
    evidence: "actual current Layers native form and one original unpaid Worker append; not physical browser evidence" }));
  assert.equal(x.h.store.route.get(), original.route); assert.ok(x.owner.isConnected && x.f.components().includes(x.owner));
  if (state === "unchanged") {
    assert.equal(dialogs.length, 0, "unchanged A closes its original New presentation");
    assert.equal(layerField(x, "handle").port.value, proof.block.handle);
    assert.equal(layerField(x, "instructions").port.value, rawA.trim());
    assert.equal(layerField(x, "subtype").port.value, subtype); assert.equal(layerField(x, "weight").port.value, "0.7");
    await openNewLayer(x); const fresh = cLayerOriginalForm(x);
    assert.equal(fresh.text.port.value, ""); assert.equal(fresh.name.port.value, ""); assert.equal(fresh.weight.port.value, "0.7");
    await closeNewLayer(x);
  } else {
    assert.equal(dialogs.length, 1, "original A must not close the current newer New presentation");
    const current = cLayerOriginalForm(x);
    assert.equal(current.text.port.value, rawB, "original A must not erase newer raw Layers text");
    assert.equal(current.name.port.value, nameB); assert.equal(current.weight.port.value, "0.8");
    assert.equal(current.selected.port.value, subtype);
    await closeNewLayer(x); const gesture = await openWork(x); refused(x, proof.accepted, gesture);
    await unchanged(x, proof.accepted, proof.allowed); await openNewLayer(x);
    assert.equal(newField(x, "text").port.value, rawB); assert.equal(newField(x, "name").port.value, nameB);
    assert.equal(newField(x, "weight").port.value, "0.8");
    await input(x, newField(x, "text"), ""); await input(x, newField(x, "name"), "");
    await input(x, newField(x, "weight"), "0.7"); await closeNewLayer(x);
  }
  await openWork(x); arrived(x, proof.accepted); await unchanged(x, proof.accepted, proof.allowed);
  assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
});

// The later control is inside the same already-open native modal. This does
// not hold updateComplete or activate the inert background, submit, or preview.
for (const newer of [false, true]) test(
  "C Layers type choice opening / " + (newer ? "same-turn newer modal control wins" : "healthy current textarea focus"),
  options, async t => {
    const x = await page(t, "layers"), { f, h, owner } = x, original = await before(x);
    const extra = { content: structuredClone(h.store.content.get()),
      privateContent: x.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all(),
      privateEvents: x.worker.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all() };
    const trigger = f.find("button", node => node.owner === owner && hasClass(node, "new-layer-button")
      && under(node, parent => hasClass(parent, "reality-shelf")));
    assert.ok(trigger.port.isConnected && !trigger.hiddenBy); assert.equal(trigger.port.matches(":disabled"), false);
    f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port); await f.act(trigger); await drain(x);
    const dialogs = f.tree().visible("dialog").filter(node => node.owner === owner && hasClass(node, "layer-create-dialog"));
    assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
    const type = f.find("button", node => node.owner.tag === "forma-ui-choice-card" && node.owner.value === "direction"
      && under(node, parent => parent.port === dialogs[0].port));
    assert.ok(type.port.isConnected && !type.hiddenBy); assert.equal(type.port.matches(":disabled"), false);
    f.native.emit("pointerdown", type.port); f.native.focus(type.port);
    const pending = f.act(type); pending.catch(() => {});
    let mark;
    try {
      const later = f.find("button", node => node.owner === owner && hasClass(node, "modal-close")
        && node.attributes["aria-label"] === "Close new decision dialog"
        && under(node, parent => parent.port === dialogs[0].port));
      assert.ok(later.port.isConnected && !later.hiddenBy); assert.equal(later.port.matches(":disabled"), false);
      assert.equal(dialogs[0].port.open, true, "Newer target is inside the same live modal, never its background");
      if (newer) { f.native.emit("pointerdown", later.port); f.native.focus(later.port); }
      mark = f.native.nativeFocus.length;
    } finally { await pending; }
    await drain(x);
    const late = f.native.nativeFocus.slice(mark).filter(row => row.node.owner === owner);
    const currentDialogs = f.tree().visible("dialog").filter(node => node.owner === owner && hasClass(node, "layer-create-dialog"));
    t.diagnostic("C_LAYERS_TYPE_OPEN_FOCUS " + JSON.stringify({ newer, lateFocus: late.map(row => ({
      tag: row.node.tag, id: row.node.attributes.id ?? null })), nativeTarget: "same-modal Close button (focus only)",
      boundary: "actual type ChoiceCard listener; same-turn native gesture; unchanged finite scheduler, not physical timing" }));
    assert.equal(currentDialogs.length, 1); assert.equal(currentDialogs[0].port.open, true);
    assert.equal(newField(x, "text").port.value, ""); assert.equal(newField(x, "name").port.value, "");
    assert.equal(newField(x, "weight").port.value, "0.7");
    assert.equal(h.store.route.get(), original.route); assert.ok(owner.isConnected && owner.store === h.store);
    await unchanged(x, original); assert.equal(h.requests.length, original.requests);
    assert.deepEqual(h.store.content.get(), extra.content);
    assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all(), extra.privateContent);
    assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all(), extra.privateEvents);
    if (newer) assert.equal(late.length, 0, "Earlier type choice must not focus over the newer same-modal interaction");
    else { assert.equal(late.length, 1); assert.equal(late[0].node.tag, "textarea"); }
    await closeNewLayer(x); await unchanged(x, original);
  });

// Three additional known-original boundaries, separate from the reached C172
// cases. Existing helpers, cases, opening pairs and timeouts stay unchanged.
function cAdaptiveMissingOriginal(x, original, raw) {
  assert.equal(x.mode, "adaptive"); assert.equal(cAdaptiveManualDecision(x), x.f.i18n.system("Audience"));
  assert.equal(cAdaptiveManualField(x).port.value, raw);
  const blocks = x.h.store.projection.get().blocks;
  assert.equal(blocks.some(block => block.type === "audience"), false, "actual first unanswered question, not a seeded Review");
  const choices = x.f.components().filter(owner => owner.tag === "forma-ui-choice-card" && owner.value === "audience:0");
  assert.equal(choices.length, 1); assert.ok(choices[0].isConnected);
  assert.equal(choices[0].detail, x.f.i18n.system("Audience") + " · " + x.f.i18n.system("Primary audience"));
  const related = blocks.map(block => block.id), prior = x.h.transport, entered = sceneDeferred(), delivery = sceneDeferred();
  let record = null, writing = null;
  const witnessed = request => Boolean(record?.receipt && request === record.request && request.init === record.init
    && request.init.body === record.bytes && record.response.status === 200);
  const transport = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") {
      if (writing) await writing; return prior(request);
    }
    assert.equal(record, null, "exactly one original unanswered manual decision");
    const init = request.init, bytes = init.body, body = request.body, payload = body.event?.payload;
    record = { request, init, bytes, response: null, receipt: null, error: null, released: false };
    let release; writing = new Promise(resolve => { release = resolve; });
    try {
      await x.resume.settleOriginalRequests(); assert.equal(x.h.store.route.get(), original.route);
      assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.auth));
      assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(body.action, "append"); assert.equal(body.clientId, "web:lit"); assert.equal(body.expectedSequence, original.head);
      assert.equal(bytes, JSON.stringify(body)); assert.deepEqual(body.events, [body.event]);
      assert.match(payload.block_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
      assert.deepEqual(body.event, { type: "BlockCreated", payload: {
        block_id: payload.block_id, document_id: original.documentId, type: "audience", handle: "audience/first-audience-a",
        position: "z" + String(original.head + 1).padStart(5, "0"), properties: { text: raw.trim(), subtype: "Primary audience",
          weight: .7, authority: "authored", created_from: "adaptive-path", related_block_ids: related }
      } });
      const response = await prior(request); assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
      assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]); assert.deepEqual(receipt.rejected, []);
      assert.equal(receipt.appended.length, 1); const event = receipt.appended[0];
      assert.equal(event.type, "BlockCreated"); assert.deepEqual(event.payload, payload);
      assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit"); assert.equal(event.streamId, x.worker.streamId);
      assert.equal(event.sequence, original.head + 1); assert.equal(receipt.head, event.sequence);
      assert.equal(event.compensatesEventId, null); assert.equal(payload.client_event_id, undefined);
      await x.worker.drainBackground();
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...original.history, event]);
      const row = x.worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(event.eventId);
      assert.ok(row); assert.equal(row.sequence, event.sequence); assert.equal(row.type, event.type);
      assert.deepEqual(JSON.parse(row.private_json), payload);
      assert.deepEqual(clientReceipts(x.worker), original.receipts); assert.deepEqual(financial(x.worker), original.money);
      assert.equal(request.init, init); assert.equal(request.init.body, bytes);
      record.response = response; record.receipt = receipt;
      writing = null; release(); entered.resolve(record); await delivery.promise;
      return response; // SAME original response, never a replacement acknowledgment.
    } catch (error) { record.error = error; entered.resolve(record); throw error; }
    finally { writing = null; release(); }
  };
  x.h.transport = transport;
  return {
    entered: entered.promise,
    async assertHeld() {
      assert.ok(record); assert.ifError(record.error); assert.equal(record.released, false);
      assert.equal(record.response.status, 200); assert.equal(record.response.bodyUsed, false);
      assert.deepEqual(x.h.store.events.get(), original.events); assert.equal(x.h.store.head.get(), original.head);
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...original.history, ...record.receipt.appended]);
      assert.deepEqual(clientReceipts(x.worker), original.receipts); assert.deepEqual(financial(x.worker), original.money);
      assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.auth));
      assert.deepEqual(x.h.requests.slice(original.requests).filter(request => (request.init.method ?? "GET") !== "GET"
        && !x.resume.isReadOnlyResume(request) && !witnessed(request)), []);
    },
    release() { if (record) record.released = true; delivery.resolve(); },
    async accept() {
      assert.ok(record); assert.ifError(record.error); assert.ok(witnessed(record.request)); assert.equal(record.response.bodyUsed, true);
      const event = record.receipt.appended[0], accepted = { ...original, events: [...original.events, event],
        history: [...original.history, event], head: record.receipt.head }, allowed = new Set([record.request]);
      await unchanged(x, accepted, allowed);
      const block = x.h.store.projection.get().blocks.find(value => value.id === event.payload.block_id);
      assert.ok(block); assert.equal(block.projectId, original.projectId); assert.equal(block.documentId, original.documentId);
      assert.equal(block.type, "audience"); assert.equal(layerText(block), raw.trim());
      assert.equal(block.properties.subtype, "Primary audience"); assert.deepEqual(block.properties.related_block_ids, related);
      assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
      return { accepted, allowed, block, event };
    },
    restore() { if (x.h.transport === transport) x.h.transport = prior; },
  };
}

test("C Adaptive first unanswered manual Save / newer answer retains its original question", options, async t => {
  const x = await page(t, "adaptive"), original = await before(x);
  assert.equal(cAdaptiveManualDecision(x), x.f.i18n.system("Audience")); assert.equal(cAdaptiveManualField(x).port.value, "");
  const rawA = "  First audience A  ", rawB = " \nNewer audience B — not an answer about reality\t ";
  await input(x, cAdaptiveManualField(x), rawA);
  const observed = cAdaptiveMissingOriginal(x, original, rawA); t.after(() => observed.restore());
  const saving = cAdaptiveManualSubmit(x);
  try {
    await enteredOrTerminal(observed.entered, saving, "actual first unanswered Audience Worker200 delivery hold");
    await observed.assertHeld(); await input(x, cAdaptiveManualField(x), rawB);
    assert.equal(cAdaptiveManualField(x).port.value, rawB); assert.equal(cAdaptiveManualDecision(x), x.f.i18n.system("Audience"));
    await observed.assertHeld();
  } finally { observed.release(); await saving; await drain(x); }
  const proof = await observed.accept(), actual = { raw: cAdaptiveManualField(x).port.value, question: cAdaptiveManualDecision(x) };
  t.diagnostic("C_ADAPTIVE_UNANSWERED_ORIGINAL " + JSON.stringify({ actual, exactOriginalBlock: proof.block.id,
    originalWorker200: 1, originalHistoryPrivateReceiptSourceAndFiscalVerified: true, setup: "actual initial unanswered Audience, no Review or paid path" }));
  assert.equal(x.h.store.route.get(), original.route); assert.ok(x.owner.isConnected);
  assert.equal(actual.question, x.f.i18n.system("Audience"), "A must not move the retained B under a different question");
  assert.equal(actual.raw, rawB, "A must not erase the newer answer to that original question");
  const gesture = await openWork(x); refused(x, proof.accepted, gesture); await unchanged(x, proof.accepted, proof.allowed);
  assert.equal(cAdaptiveManualField(x).port.value, rawB);
  await input(x, cAdaptiveManualField(x), layerText(proof.block));
  await openWork(x); arrived(x, proof.accepted); await unchanged(x, proof.accepted, proof.allowed);
});

test("C Layers original New Add / cleared closed form remains owned until original response", options, async t => {
  const x = await page(t, "layers"); await selectLayer(x); const original = await before(x), rawA = "  Earlier layer A  ";
  await openNewLayer(x); const subtype = cLayerOriginalForm(x).selected.port.value;
  await input(x, newField(x, "text"), rawA); await drain(x);
  const observed = cLayerObserveOriginalCreate(x, original, rawA, subtype, true); t.after(() => observed.restore());
  const saving = cLayerOriginalSubmit(x); let pending;
  try {
    await enteredOrTerminal(observed.entered, saving, "actual Layers original response before native clear and Cancel");
    await observed.assertHeld(); await input(x, newField(x, "text"), "");
    assert.equal(newField(x, "text").port.value, ""); assert.equal(newField(x, "name").port.value, "");
    assert.equal(newField(x, "weight").port.value, "0.7"); await closeNewLayer(x);
    await observed.assertHeld(); const gesture = await openWork(x); await observed.assertHeld();
    pending = { route: x.h.store.route.get(), connected: x.owner.isConnected,
      requests: x.h.requests.length - gesture.start, scroll: x.f.native.nativeScroll.length - gesture.scroll };
  } finally { observed.release(); await saving; await drain(x); }
  const proof = await observed.accept();
  t.diagnostic("C_LAYERS_PENDING_CLEAN_ORIGINAL " + JSON.stringify({ pending, originalWorker200: 1,
    exactOriginalBlock: proof.block.id, originalHistoryPrivateReceiptSourceAndFiscalVerified: true }));
  assert.equal(pending.route, original.route, "clearing and closing New does not cancel its dispatched original Add");
  assert.equal(pending.connected, true); assert.equal(pending.requests, 0); assert.equal(pending.scroll, 0);
  assert.equal(x.f.tree().visible("dialog").filter(node => hasClass(node, "layer-create-dialog")).length, 0);
  await openWork(x); arrived(x, proof.accepted); await unchanged(x, proof.accepted, proof.allowed);
});

test("C Layers original New Add / native short-name-only ABA retains the current presentation", options, async t => {
  const x = await page(t, "layers"); await selectLayer(x); const original = await before(x), rawA = "  Earlier layer A  ";
  await openNewLayer(x); const subtype = cLayerOriginalForm(x).selected.port.value;
  await input(x, newField(x, "text"), rawA); await drain(x);
  const observed = cLayerObserveOriginalCreate(x, original, rawA, subtype, true); t.after(() => observed.restore());
  const saving = cLayerOriginalSubmit(x);
  try {
    await enteredOrTerminal(observed.entered, saving, "actual Layers original response before short-name-only ABA");
    await observed.assertHeld(); await input(x, newField(x, "name"), "  newer name B  ");
    assert.equal(newField(x, "name").port.value, "  newer name B  ");
    await input(x, newField(x, "name"), "");
    assert.equal(newField(x, "name").port.value, ""); assert.equal(newField(x, "text").port.value, rawA);
    assert.equal(newField(x, "weight").port.value, "0.7"); await observed.assertHeld();
  } finally { observed.release(); await saving; await drain(x); }
  const proof = await observed.accept(), dialogs = x.f.tree().visible("dialog")
    .filter(node => node.owner === x.owner && hasClass(node, "layer-create-dialog"));
  t.diagnostic("C_LAYERS_NAME_ABA_ORIGINAL " + JSON.stringify({ dialogs: dialogs.length, originalWorker200: 1,
    exactOriginalBlock: proof.block.id, originalHistoryPrivateReceiptSourceAndFiscalVerified: true, onlyNewerFieldEvents: "short name B then empty A" }));
  assert.equal(x.h.store.route.get(), original.route); assert.ok(x.owner.isConnected);
  assert.equal(dialogs.length, 1, "the native short-name edit intent must not be consumed by the earlier Add");
  assert.equal(newField(x, "text").port.value, rawA); assert.equal(newField(x, "name").port.value, "");
  assert.equal(newField(x, "weight").port.value, "0.7");
  await input(x, newField(x, "text"), ""); await closeNewLayer(x);
  await openWork(x); arrived(x, proof.accepted); await unchanged(x, proof.accepted, proof.allowed);
});

test("C Adaptive first unanswered manual Save / unchanged answer advances exactly once", options, async t => {
  const x = await page(t, "adaptive"), original = await before(x), rawA = "  First audience A  ";
  assert.equal(cAdaptiveManualDecision(x), x.f.i18n.system("Audience")); assert.equal(cAdaptiveManualField(x).port.value, "");
  assert.equal(x.h.store.projection.get().blocks.some(block => block.type === "subject"), false,
    "actual next missing decision is Reality after this Audience");
  await input(x, cAdaptiveManualField(x), rawA);
  const observed = cAdaptiveMissingOriginal(x, original, rawA); t.after(() => observed.restore());
  const saving = cAdaptiveManualSubmit(x);
  try {
    await enteredOrTerminal(observed.entered, saving, "actual unchanged first Audience Worker200 delivery hold");
    await observed.assertHeld(); assert.equal(cAdaptiveManualField(x).port.value, rawA);
    assert.equal(cAdaptiveManualDecision(x), x.f.i18n.system("Audience"));
  } finally { observed.release(); await saving; await drain(x); }
  const proof = await observed.accept();
  assert.equal(x.h.store.route.get(), original.route); assert.ok(x.owner.isConnected);
  assert.equal(cAdaptiveManualField(x).port.value, ""); assert.equal(cAdaptiveManualDecision(x), x.f.i18n.system("Reality"),
    "unchanged original A clears and advances to the actual next missing question once");
  t.diagnostic("C_ADAPTIVE_UNANSWERED_HEALTHY " + JSON.stringify({ originalWorker200: 1, exactOriginalBlock: proof.block.id,
    from: "Audience", to: "Reality", originalHistoryPrivateReceiptSourceAndFiscalVerified: true }));
  await openWork(x); arrived(x, proof.accepted); await unchanged(x, proof.accepted, proof.allowed);
});


// C190 local object selection is not a route handoff. Reuse the actual Layers
// host, native form/range ports and exact original Add observer; no new renderer.
async function c190LayerSelectionTarget(t, x) {
  const original = await before(x), raw = "  Earlier layer A  ";
  await openNewLayer(x); const subtype = cLayerOriginalForm(x).selected.port.value;
  await input(x, newField(x, "text"), raw); await drain(x);
  const observed = cLayerObserveOriginalCreate(x, original, raw, subtype, false);
  t.after(() => observed.restore());
  let proof;
  try {
    await cLayerOriginalSubmit(x); await drain(x); proof = await observed.accept();
  } finally { observed.restore(); }
  // This is declared genuine setup, not a zero-write user selection or an
  // invented second projection row. The existing observer verified its sole ACK.
  assert.notEqual(proof.block.id, x.block.id); assert.equal(proof.block.type, "direction");
  assert.equal(proof.block.handle, "direction/earlier-layer-a");
  await selectLayer(x); await drain(x);
  assert.equal(layerField(x, "instructions").port.value, layerText(x.block));
  return proof.block;
}

function c190LayerInspector(x) {
  const tree = x.f.tree(), selected = tree.visible("button").filter(node => node.owner === x.owner
    && hasClass(node, "layer-name") && under(node, parent => parent.tag === "li" && hasClass(parent, "selected")));
  assert.equal(selected.length, 1, "The actual Decision stack exposes exactly one current selected object");
  const labels = selected[0].children.filter(child => typeof child !== "string" && child.tag === "b");
  assert.equal(labels.length, 1);
  const blocks = x.h.store.projection.get().blocks.filter(block => block.handle === labels[0].text);
  assert.equal(blocks.length, 1, "The visible selected name names one genuine current source block");
  const forms = tree.visible("form").filter(node => node.owner === x.owner && hasClass(node, "layer-inspector"));
  assert.equal(forms.length, 1); const form = forms[0];
  assert.ok(form.port.isConnected && x.f.renderer.nodes.includes(form.port));
  assert.equal(form.port.closest("forma-reality-layers"), x.owner);
  assert.equal(typeof form.handlers.submit, "function"); assert.equal(form.port.handlers.submit, form.handlers.submit);
  const fields = Object.fromEntries(["handle", "instructions", "subtype", "weight"].map(name => {
    const values = tree.nodes.filter(node => node.owner === x.owner && node.attributes?.name === name
      && ["input", "textarea", "select"].includes(node.tag) && !node.hiddenBy && under(node, parent => parent === form));
    assert.equal(values.length, 1); const field = values[0];
    assert.ok(field.port.isConnected && x.f.renderer.nodes.includes(field.port));
    assert.equal(field.port.matches(":disabled"), false); assert.equal(field.port.closest("form"), form.port);
    return [name, field];
  }));
  return { tree, selected: blocks[0], form, fields };
}

function c190LayerSelectionAction(x, target, surface) {
  const tree = x.f.tree(), blocks = x.h.store.projection.get().blocks;
  assert.equal(blocks.filter(block => block.id === target.id && block.handle === target.handle).length, 1);
  let actions;
  if (surface === "layer-name") {
    actions = tree.visible("button").filter(node => node.owner === x.owner && hasClass(node, "layer-name")
      && node.children.some(child => typeof child !== "string" && child.tag === "b" && child.text === target.handle));
  } else {
    assert.equal(surface, "canvas-context"); assert.equal(target.type, "direction");
    const active = blocks.filter(block => Number(block.properties.weight ?? .5) > 0).slice(0, 8);
    const subtype = String(target.properties.subtype);
    assert.ok(active.some(block => block.id === target.id));
    assert.deepEqual(active.filter(block => block.type === target.type && block.properties.subtype === subtype)
      .map(block => block.id), [target.id], "The real preview's displayed subtype is unambiguous in this fixture");
    actions = tree.visible("button").filter(node => node.owner === x.owner
      && under(node, parent => hasClass(parent, "canvas-context"))
      && node.children.some(child => typeof child !== "string" && child.tag === "span"
        && child.text === x.f.i18n.system(subtype)));
  }
  assert.equal(actions.length, 1); const action = actions[0];
  assert.ok(action.port.isConnected && x.f.renderer.nodes.includes(action.port));
  assert.equal(action.port.closest("forma-reality-layers"), x.owner);
  assert.equal(action.port.matches(":disabled"), false);
  assert.equal(typeof action.handlers.click, "function"); assert.equal(action.port.handlers.click, action.handlers.click);
  return action;
}

async function c190ChooseLayer(x, target, surface) {
  const action = c190LayerSelectionAction(x, target, surface);
  x.f.native.emit("pointerdown", action.port); x.f.native.focus(action.port);
  const requests = x.h.requests.length;
  await x.f.act(action, "click", { button: 0, defaultPrevented: false }); await drain(x);
  assert.equal(x.h.requests.length, requests, "A local object selection neither reads nor writes the Worker");
}

for (const surface of ["layer-name", "canvas-context"])
test("C Layers local selection / " + surface + " / raw inspector stays until explicit native revert", options, async t => {
  const x = await page(t, "layers"); await selectLayer(x);
  const target = await c190LayerSelectionTarget(t, x), original = await before(x);
  const first = c190LayerInspector(x);
  assert.equal(first.selected.id, x.block.id); assert.notEqual(first.selected.id, target.id);
  assert.equal(first.fields.instructions.port.value, layerText(x.block));
  const defaults = Object.fromEntries(Object.entries(first.fields).map(([name, field]) => [name, field.port.value]));
  const raw = " \nUnsubmitted current inspector A — 保持\t ";
  assert.equal(typeof first.fields.instructions.handlers.input, "function");
  assert.equal(typeof first.fields.instructions.handlers.change, "function", "Current listeners track local intent, not implicit Save");
  await input(x, first.fields.instructions, raw); await drain(x);
  await input(x, c190LayerInspector(x).fields.instructions, raw, "change"); await drain(x);
  assert.equal(x.h.requests.length, original.requests, "Actual input and change listeners neither read nor save");
  assert.equal(c190LayerInspector(x).fields.instructions.port.value, raw);
  await unchanged(x, original);

  await c190ChooseLayer(x, target, surface);
  // Canonical, original Source/auth, receipt and financial proof precedes the
  // desired selection/raw oracle; a source-only suspicion is not a test result.
  await unchanged(x, original);
  assert.equal(x.h.store.route.get(), original.route);
  assert.ok(x.owner.isConnected && x.f.components().includes(x.owner) && x.owner.store === x.h.store);
  const retained = c190LayerInspector(x);
  t.diagnostic("C_LAYERS_LOCAL_SELECTION " + JSON.stringify({ surface, originalBlockId: x.block.id,
    requestedBlockId: target.id, observedSelectedBlockId: retained.selected.id,
    requestsAfterSetup: x.h.requests.length - original.requests,
    sourceHistoryReceiptAndFiscalExact: true, actualNativeControl: true, physicalOrProviderClaim: false }));
  assert.equal(retained.selected.id, x.block.id, "Selecting another object must not replace the current unsent inspector");
  assert.equal(retained.fields.instructions.port.value, raw, "The exact unsent native instructions remain under original A");
  for (const name of ["handle", "subtype", "weight"]) assert.equal(retained.fields[name].port.value, defaults[name]);

  // Existing native exact revert, not an invented Discard control or autosave.
  await input(x, retained.fields.instructions, defaults.instructions); await drain(x);
  assert.equal(c190LayerInspector(x).fields.instructions.port.value, defaults.instructions);
  await c190ChooseLayer(x, target, surface); await unchanged(x, original);
  const arrived = c190LayerInspector(x);
  assert.equal(arrived.selected.id, target.id, "A fresh clean selection reaches the exact genuine target B");
  assert.equal(arrived.fields.handle.port.value, target.handle);
  assert.equal(arrived.fields.instructions.port.value, layerText(target));
  assert.equal(arrived.fields.subtype.port.value, target.properties.subtype);
  assert.equal(x.h.store.route.get(), original.route);
  assert.equal(x.h.requests.length, original.requests, "Both refused and fresh local selections are zero-request");
});


// C190 additional preset controls. These start in the actual fallback inspector,
// without selecting a layer or creating a replacement owner before admission.
const c190Preset = Object.freeze({ id: "quiet-confidence", type: "direction", subtype: "Emotional outcome",
  label: "Quiet confidence", text: "Create quiet confidence without feeling passive or over-resolved" });
function c190PresetAddAction(x) {
  const tree = x.f.tree(), cards = tree.visible("article").filter(node => node.owner === x.owner
    && under(node, parent => hasClass(parent, "reality-list"))
    && tree.visible("b").some(label => label.owner === x.owner && label.text === x.f.i18n.system(c190Preset.label)
      && under(label, parent => parent === node)));
  assert.equal(cards.length, 1); const card = cards[0];
  const buttons = tree.visible("button").filter(node => node.owner === x.owner
    && under(node, parent => parent === card) && node.text === x.f.i18n.system("Add"));
  assert.equal(buttons.length, 1); const button = buttons[0];
  assert.ok(button.port.isConnected && x.f.renderer.nodes.includes(button.port));
  assert.equal(button.port.closest("forma-reality-layers"), x.owner);
  assert.equal(button.port.matches(":disabled"), false);
  assert.equal(typeof button.handlers.click, "function"); assert.equal(button.port.handlers.click, button.handlers.click);
  return button;
}
function c190StartPresetAdd(x) {
  const action = c190PresetAddAction(x);
  x.f.native.emit("pointerdown", action.port); x.f.native.focus(action.port);
  return x.f.act(action, "click", { button: 0, defaultPrevented: false });
}

// Exact one-preset counterpart to the existing New/Add observer, not a general
// POST exemption. The original response is cloned for proof and returned intact.
function c190ObservePresetAdd(x, original, holdOriginal) {
  const prior = x.h.transport, entered = sceneDeferred(), delivery = sceneDeferred();
  let record = null, writing = null;
  const witnessed = request => Boolean(record?.receipt && request === record.request && request.init === record.init
    && request.init.body === record.bytes && record.response.status === 200);
  const transport = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") {
      if (writing) await writing; return prior(request);
    }
    assert.equal(record, null, "One exact original preset Add, no retry or generic write exemption");
    const init = request.init, bytes = init.body, body = request.body, payload = body.event?.payload;
    record = { request, init, bytes, response: null, receipt: null, held: false, released: false, error: null };
    let release; writing = new Promise(resolve => { release = resolve; });
    try {
      await x.resume.settleOriginalRequests();
      assert.equal(x.h.store.route.get(), original.route);
      assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.auth));
      assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(body.action, "append"); assert.equal(body.clientId, "web:lit"); assert.equal(body.expectedSequence, original.head);
      assert.equal(bytes, JSON.stringify(body)); assert.deepEqual(body.events, [body.event]);
      assert.match(payload.block_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
      assert.deepEqual(body.event, { type: "BlockCreated", payload: {
        block_id: payload.block_id, document_id: original.documentId, type: "direction", handle: "direction/quiet-confidence",
        position: "z" + String(original.head + 1).padStart(5, "0"), properties: {
          text: x.f.i18n.system(c190Preset.text), subtype: "Emotional outcome", weight: .68, authority: "authored",
          reality_id: "quiet-confidence", created_from: "reality-layers", activation_method: "button"
        }
      } });
      const response = await prior(request); assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
      assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]); assert.deepEqual(receipt.rejected, []);
      assert.equal(receipt.appended.length, 1); const event = receipt.appended[0];
      assert.equal(event.type, "BlockCreated"); assert.deepEqual(event.payload, payload);
      assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit"); assert.equal(event.streamId, x.worker.streamId);
      assert.equal(event.sequence, original.head + 1); assert.equal(receipt.head, event.sequence);
      assert.equal(event.compensatesEventId, null); assert.equal(payload.client_event_id, undefined);
      await x.worker.drainBackground();
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...original.history, event]);
      const row = x.worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(event.eventId);
      assert.ok(row); assert.equal(row.sequence, event.sequence); assert.equal(row.type, event.type);
      assert.deepEqual(JSON.parse(row.private_json), payload);
      assert.deepEqual(clientReceipts(x.worker), original.receipts); assert.deepEqual(financial(x.worker), original.money);
      record.response = response; record.receipt = receipt;
      assert.equal(request.init, init); assert.equal(request.init.body, bytes);
      if (holdOriginal) {
        writing = null; release(); record.held = true; entered.resolve(record); await delivery.promise;
      }
      return response;
    } catch (error) { record.error = error; entered.resolve(record); throw error; }
    finally { writing = null; release(); }
  };
  x.h.transport = transport;
  return {
    entered: entered.promise, started: () => Boolean(record),
    async assertHeld() {
      assert.ok(holdOriginal && record); assert.ifError(record.error); assert.equal(record.held, true);
      assert.equal(record.released, false); assert.equal(record.response.status, 200); assert.equal(record.response.bodyUsed, false);
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...original.history, ...record.receipt.appended]);
      assert.deepEqual(x.h.store.events.get(), original.events); assert.equal(x.h.store.head.get(), original.head);
      assert.deepEqual(clientReceipts(x.worker), original.receipts); assert.deepEqual(financial(x.worker), original.money);
      assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.auth));
      assert.deepEqual(x.h.requests.slice(original.requests).filter(request => (request.init.method ?? "GET") !== "GET"
        && !x.resume.isReadOnlyResume(request) && !witnessed(request)), []);
    },
    release() { if (record) record.released = true; delivery.resolve(); },
    async accept() {
      assert.ok(record); assert.ifError(record.error); assert.ok(witnessed(record.request));
      assert.equal(record.response.bodyUsed, true, "The actual Store consumed the same original preset response");
      const event = record.receipt.appended[0], events = [...original.events, event], history = [...original.history, event];
      assert.deepEqual(x.h.store.events.get(), events); assert.equal(x.h.store.head.get(), record.receipt.head);
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), history);
      const accepted = { ...original, events, history, head: record.receipt.head }, allowed = new Set([record.request]);
      await unchanged(x, accepted, allowed);
      assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
      const block = x.h.store.projection.get().blocks.find(value => value.id === event.payload.block_id);
      assert.ok(block); assert.equal(block.documentId, original.documentId); assert.equal(block.projectId, original.projectId);
      assert.equal(block.type, "direction"); assert.equal(block.handle, "direction/quiet-confidence");
      assert.deepEqual(block.properties, event.payload.properties);
      return { accepted, allowed, event, block };
    },
    restore() { if (x.h.transport === transport) x.h.transport = prior; },
  };
}
const c190InspectorValues = view => Object.fromEntries(Object.entries(view.fields).map(([name, field]) => [name, field.port.value]));
async function c190DiscardInspector(x, original, defaults) {
  const view = c190LayerInspector(x), action = x.f.i18n.t("workspace.admin.discardPolicy", "Discard unsaved changes");
  const buttons = view.tree.visible("button").filter(node => node.owner === x.owner
    && hasClass(node, "layer-inspector-discard") && under(node, parent => parent === view.form));
  assert.equal(buttons.length, 1, "The current inspector offers an explicit visible local Discard");
  const button = buttons[0]; assert.equal(button.text, action); assert.equal(button.attributes.type, "button");
  assert.equal(button.attributes["aria-label"], x.f.i18n.t("artifact.delivery.namedAction", "{action} — {name}",
    { action, name: "\u2068" + view.selected.handle + "\u2069" }));
  assert.ok(button.port.isConnected && x.f.renderer.nodes.includes(button.port));
  assert.equal(button.port.matches(":disabled"), false); assert.equal(button.port.closest("form"), view.form.port);
  assert.equal(typeof button.handlers.click, "function"); assert.equal(button.port.handlers.click, button.handlers.click);
  const requests = x.h.requests.length;
  x.f.native.emit("pointerdown", button.port); x.f.native.focus(button.port);
  await x.f.act(button, "click", { button: 0, defaultPrevented: false }); await drain(x);
  const current = c190LayerInspector(x);
  assert.equal(current.selected.id, original.id); assert.deepEqual(c190InspectorValues(current), defaults);
  assert.equal(x.h.requests.length, requests, "Discard restores native canonical fields without a request or implicit Save");
}

test("C Layers preset Add / dirty initial fallback requires explicit current inspector Discard", options, async t => {
  const x = await page(t, "layers"), original = await before(x), first = c190LayerInspector(x);
  assert.equal(first.selected.id, x.block.id, "No preceding selection: the actual initial fallback owns this inspector");
  assert.equal(x.h.store.projection.get().blocks.length, 1);
  const defaults = c190InspectorValues(first), subtypes = first.tree.nodes.filter(node => node.tag === "option"
    && under(node, parent => parent === first.fields.subtype)).map(node => String(node.attributes.value));
  const alternate = subtypes.find(value => value !== defaults.subtype); assert.ok(alternate);
  const raw = { handle: "  unsent inspector handle A  ", instructions: "", subtype: alternate, weight: "0.8" };
  for (const [name, value] of Object.entries(raw))
    await input(x, c190LayerInspector(x).fields[name], value, name === "subtype" ? "change" : "input");
  await drain(x); assert.deepEqual(c190InspectorValues(c190LayerInspector(x)), raw);
  const observed = c190ObservePresetAdd(x, original, false); t.after(() => observed.restore());
  await c190StartPresetAdd(x); await drain(x);
  // Account for the current erroneous original append before asserting refusal.
  // On a repaired path, no original exists and the old unchanged proof applies.
  const unwanted = observed.started() ? await observed.accept() : null;
  if (!unwanted) await unchanged(x, original);
  t.diagnostic("C_LAYERS_PRESET_INITIAL_RAW " + JSON.stringify({ actualOriginal200: unwanted ? 1 : 0,
    originalBlockId: x.block.id, appendedBlockId: unwanted?.block.id ?? null,
    exactOriginalHistoryPrivateReceiptSourceAndFiscalVerified: true, physicalOrProviderClaim: false }));
  assert.equal(observed.started(), false, "Preset Add must refuse before dispatch while the fallback inspector is raw");
  assert.equal(x.h.requests.length, original.requests); assert.equal(x.h.store.route.get(), original.route);
  const retained = c190LayerInspector(x);
  assert.equal(retained.selected.id, x.block.id); assert.deepEqual(c190InspectorValues(retained), raw);

  await c190DiscardInspector(x, x.block, defaults); await unchanged(x, original);
  await c190StartPresetAdd(x); await drain(x); const proof = await observed.accept();
  const selected = c190LayerInspector(x);
  assert.equal(selected.selected.id, proof.block.id, "A fresh clean preset Add remains useful and selects its exact committed decision");
  assert.equal(selected.fields.handle.port.value, proof.block.handle);
  assert.equal(selected.fields.instructions.port.value, layerText(proof.block));
  assert.equal(x.h.store.route.get(), original.route); await unchanged(x, proof.accepted, proof.allowed);
});

test("C Layers preset Add / held original preserves newer initial inspector before deliberate selection", options, async t => {
  const x = await page(t, "layers"), original = await before(x), first = c190LayerInspector(x);
  assert.equal(first.selected.id, x.block.id, "The genuine initial fallback, not a test-selected replacement");
  assert.equal(x.h.store.projection.get().blocks.length, 1);
  const defaults = c190InspectorValues(first), raw = " \nNewer initial inspector A stays here — 未保存\t ";
  const observed = c190ObservePresetAdd(x, original, true); t.after(() => observed.restore());
  const pending = c190StartPresetAdd(x);
  try {
    await enteredOrTerminal(observed.entered, pending, "actual preset Worker200 before original delivery");
    await observed.assertHeld();
    await input(x, c190LayerInspector(x).fields.instructions, raw); await drain(x);
    assert.equal(c190LayerInspector(x).selected.id, x.block.id);
    assert.equal(c190LayerInspector(x).fields.instructions.port.value, raw);
    await observed.assertHeld();
  } finally { observed.release(); await pending; await drain(x); }
  const proof = await observed.accept(), retained = c190LayerInspector(x);
  t.diagnostic("C_LAYERS_PRESET_NEWER_RAW " + JSON.stringify({ actualOriginal200: 1,
    originalBlockId: x.block.id, committedBlockId: proof.block.id, observedSelectedBlockId: retained.selected.id,
    exactOriginalHistoryPrivateReceiptSourceAndFiscalVerified: true, physicalOrProviderClaim: false }));
  assert.equal(x.h.store.route.get(), original.route); assert.ok(x.owner.isConnected);
  assert.equal(retained.selected.id, x.block.id, "Original positive Add cannot replace the newer fallback inspector");
  assert.equal(retained.fields.instructions.port.value, raw);
  for (const name of ["handle", "subtype", "weight"]) assert.equal(retained.fields[name].port.value, defaults[name]);

  await c190DiscardInspector(x, x.block, defaults); await unchanged(x, proof.accepted, proof.allowed);
  await c190ChooseLayer(x, proof.block, "layer-name"); await unchanged(x, proof.accepted, proof.allowed);
  const selected = c190LayerInspector(x);
  assert.equal(selected.selected.id, proof.block.id, "Explicit resolution followed by a fresh exact selection reaches committed B");
  assert.equal(selected.fields.handle.port.value, proof.block.handle);
  assert.equal(selected.fields.instructions.port.value, layerText(proof.block));
});


// Genuine empty-Document setup before observation, using the same audit writer
// and actual Store read as the existing finite fixtures. No projection override.
async function c190EnterEmptyLayersDocument(x) {
  const prior = await before(x), documentId = "c190-empty-layer-document", title = "C190 empty layer document";
  assert.equal(x.h.store.projection.get().documents.some(value => value.id === documentId), false);
  const event = await appendAuditEvent(x.worker.env, x.worker.streamId, "user", "DocumentCreated", {
    project_id: prior.projectId, document_id: documentId, title });
  await x.worker.drainBackground();
  assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...prior.history, event]);
  assert.deepEqual(clientReceipts(x.worker), prior.receipts); assert.deepEqual(financial(x.worker), prior.money);
  await x.h.store.refreshEvents({ fromStart: true });
  x.h.store.setRoute(withDocumentInRoute("/studio/layers", documentId, title)); await drain(x);
  const owners = x.f.components().filter(owner => owner.tag === "forma-reality-layers"
    && owner.isConnected && owner.store === x.h.store);
  assert.equal(owners.length, 1); x.owner = owners[0];
  assert.equal(x.owner.closest("forma-shell"), x.f.host);
  assert.equal(x.h.store.projection.get().projectId, prior.projectId);
  assert.equal(x.h.store.projection.get().documentId, documentId);
  assert.equal(x.h.store.projection.get().blocks.length, 0);
  assert.deepEqual(x.h.store.events.get(), [...prior.events, event]); assert.equal(x.h.store.head.get(), event.sequence);
  const tree = x.f.tree();
  assert.equal(tree.visible("form").filter(node => node.owner === x.owner && hasClass(node, "layer-inspector")).length, 0);
  assert.equal(tree.visible("button").filter(node => node.owner === x.owner && hasClass(node, "layer-name")).length, 0);
  assert.deepEqual(clientReceipts(x.worker), prior.receipts); assert.deepEqual(financial(x.worker), prior.money);
  return { documentId, title, event };
}

test("C Layers empty document / first original Create adopts its exact result and clears only its current draft", options, async t => {
  const x = await page(t, "layers"), setup = await c190EnterEmptyLayersDocument(x), original = await before(x);
  assert.equal(original.documentId, setup.documentId); assert.equal(x.h.store.projection.get().blocks.length, 0);
  await openNewLayer(x); const subtype = cLayerOriginalForm(x).selected.port.value, raw = "  Earlier layer A  ";
  await input(x, newField(x, "text"), raw); await drain(x);
  const observed = cLayerObserveOriginalCreate(x, original, raw, subtype, true); t.after(() => observed.restore());
  const pending = cLayerOriginalSubmit(x);
  try {
    await enteredOrTerminal(observed.entered, pending, "actual first empty-Document Create Worker200 before delivery");
    await observed.assertHeld(); assert.equal(x.h.store.projection.get().blocks.length, 0);
    assert.equal(cLayerOriginalForm(x).text.port.value, raw);
  } finally { observed.release(); await pending; await drain(x); }
  const proof = await observed.accept();
  assert.equal(x.h.store.route.get(), original.route); assert.ok(x.owner.isConnected);
  assert.deepEqual(x.h.store.projection.get().blocks.map(block => block.id), [proof.block.id]);
  t.diagnostic("C_LAYERS_EMPTY_FIRST_CREATE " + JSON.stringify({ emptyDocumentId: setup.documentId,
    firstBlockId: proof.block.id, originalWorker200: 1, sourceHistoryPrivateReceiptAndFiscalExact: true,
    setup: "genuine audit DocumentCreated and actual read before observation", physicalOrProviderClaim: false }));
  const tree = x.f.tree();
  assert.equal(tree.visible("dialog").filter(node => node.owner === x.owner && hasClass(node, "layer-create-dialog")).length, 0,
    "A healthy first Create closes only its unchanged original draft");
  assert.equal(c190LayerInspector(x).selected.id, proof.block.id);
  assert.equal(c190LayerInspector(x).fields.instructions.port.value, raw.trim());
  await openNewLayer(x);
  assert.equal(cLayerOriginalForm(x).text.port.value, "");
  assert.equal(cLayerOriginalForm(x).name.port.value, "");
  assert.equal(cLayerOriginalForm(x).weight.port.value, "0.7");
  await closeNewLayer(x); await unchanged(x, proof.accepted, proof.allowed);
});


// One exact ordinary inspector Save. No paid/proposal branch or generic batch
// allowance; canonical A and a newer native B are deliberately separate owners.
function c190InspectorFormData(t, x) {
  const NativeFormData = globalThis.FormData;
  class InspectorFormData extends NativeFormData {
    constructor(...args) {
      const form = args[0];
      if (form?.owner !== x.owner || form.tag !== "form" || !form.classList.contains("layer-inspector")) {
        super(...args); return;
      }
      const tree = x.f.tree(), forms = tree.visible("form").filter(node => node.owner === x.owner && hasClass(node, "layer-inspector"));
      assert.equal(args.length, 1); assert.equal(forms.length, 1); assert.equal(forms[0].port, form);
      assert.ok(form.isConnected && x.f.renderer.nodes.includes(form));
      const fields = tree.nodes.filter(node => node.owner === x.owner && ["input", "textarea", "select"].includes(node.tag)
        && node.attributes.name && under(node, parent => parent === forms[0]) && !node.port.matches(":disabled"));
      assert.deepEqual(fields.map(node => node.attributes.name), ["handle", "instructions", "subtype", "weight"]);
      for (const field of fields) {
        assert.ok(field.port.isConnected && x.f.renderer.nodes.includes(field.port));
        assert.equal(field.port.closest("form"), form); assert.equal(typeof field.port.value, "string");
      }
      super(); for (const field of fields) this.append(field.attributes.name, field.port.value);
    }
  }
  globalThis.FormData = InspectorFormData;
  t.after(() => { if (globalThis.FormData === InspectorFormData) globalThis.FormData = NativeFormData; });
}
function c190StartInspectorSave(x) {
  const view = c190LayerInspector(x), actions = view.tree.visible("button").filter(node => node.owner === x.owner
    && under(node, parent => parent === view.form) && String(node.attributes.type ?? "submit").toLowerCase() === "submit");
  assert.equal(actions.length, 1); const action = actions[0];
  assert.equal(action.text, x.f.i18n.system("Save decision"));
  assert.ok(action.port.isConnected && x.f.renderer.nodes.includes(action.port));
  assert.equal(action.port.closest("form"), view.form.port); assert.equal(action.port.matches(":disabled"), false);
  assert.equal(action.attributes.form, undefined); assert.equal(action.handlers.click, undefined,
    "The sole native Save default dispatches the actual current form's submit handler");
  x.f.native.emit("pointerdown", action.port); x.f.native.focus(action.port);
  return x.f.act(view.form, "submit", { submitter: action.port });
}
function c190ObserveInspectorSave(x, original, block, raw) {
  assert.equal(x.mode, "layers"); assert.equal(block.id, "scene-reuse-direction");
  assert.equal(block.type, "direction"); assert.equal(block.locked, false);
  assert.equal(block.properties.text, "The keeper checks the harbor.");
  assert.equal(block.properties.weight, .68); assert.equal(block.properties.intent, undefined);
  assert.equal(block.properties.subtype, undefined);
  assert.equal(block.properties.source_artifact_id, undefined); assert.equal(block.properties.source_output_id, undefined);
  const view = c190LayerInspector(x);
  assert.equal(view.selected.id, block.id); assert.equal(view.fields.instructions.port.value, raw);
  assert.equal(view.fields.handle.port.value, block.handle); assert.equal(view.fields.subtype.port.value, "Campaign goal");
  assert.equal(view.fields.weight.port.value, "0.7", "The original canonical .68 remains its genuine native .7");
  const expected = [
    { type: "BlockPropertyEdited", payload: { block_id: block.id, property_path: "text",
      old_value: block.properties.text, new_value: raw.trim(), source_surface: "reality-layers" } },
    { type: "BlockPropertyEdited", payload: { block_id: block.id, property_path: "intent",
      old_value: "include", new_value: "include", source_surface: "reality-layers" } },
    { type: "BlockWeightSet", payload: { block_id: block.id, weight: .7, previous_weight: .68, source_surface: "reality-layers" } },
  ];
  const prior = x.h.transport, entered = sceneDeferred(), delivery = sceneDeferred();
  let record = null, writing = null;
  const witnessed = request => Boolean(record?.receipt && request === record.request && request.init === record.init
    && request.init.body === record.bytes && record.response.status === 200);
  const transport = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") {
      if (writing) await writing; return prior(request);
    }
    assert.equal(record, null, "Exactly one original inspector batch; input and resolution never submit another write");
    const init = request.init, bytes = init.body, body = request.body;
    record = { request, init, bytes, response: null, receipt: null, held: false, released: false, error: null };
    let release; writing = new Promise(resolve => { release = resolve; });
    try {
      await x.resume.settleOriginalRequests();
      assert.equal(x.h.store.route.get(), original.route);
      assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.auth));
      assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(body.action, "batch"); assert.equal(body.clientId, "web:lit"); assert.equal(body.expectedSequence, original.head);
      assert.equal(bytes, JSON.stringify(body)); assert.deepEqual(body.event, expected[0]); assert.deepEqual(body.events, expected);
      const response = await prior(request); assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
      assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]); assert.deepEqual(receipt.rejected, []);
      assert.equal(receipt.appended.length, expected.length);
      assert.equal(new Set(receipt.appended.map(event => event.eventId)).size, expected.length);
      for (const [index, event] of receipt.appended.entries()) {
        assert.equal(event.type, expected[index].type); assert.deepEqual(event.payload, expected[index].payload);
        assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit"); assert.equal(event.streamId, x.worker.streamId);
        assert.equal(event.sequence, original.head + index + 1); assert.equal(event.compensatesEventId, null);
        assert.equal(event.payload.client_event_id, undefined); assert.ok(event.eventId && event.correlationId);
      }
      assert.equal(receipt.head, original.head + expected.length); await x.worker.drainBackground();
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...original.history, ...receipt.appended]);
      for (const event of receipt.appended) {
        const row = x.worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(event.eventId);
        assert.ok(row); assert.equal(row.sequence, event.sequence); assert.equal(row.type, event.type);
        assert.deepEqual(JSON.parse(row.private_json), event.payload);
      }
      assert.deepEqual(clientReceipts(x.worker), original.receipts); assert.deepEqual(financial(x.worker), original.money);
      record.response = response; record.receipt = receipt;
      assert.equal(request.init, init); assert.equal(request.init.body, bytes);
      writing = null; release(); record.held = true; entered.resolve(record); await delivery.promise;
      return response;
    } catch (error) { record.error = error; entered.resolve(record); throw error; }
    finally { writing = null; release(); }
  };
  x.h.transport = transport;
  return {
    entered: entered.promise,
    async assertHeld() {
      assert.ok(record); assert.ifError(record.error); assert.equal(record.held, true); assert.equal(record.released, false);
      assert.equal(record.response.status, 200); assert.equal(record.response.bodyUsed, false);
      assert.deepEqual(await readWorkspaceEvents(x.worker.env, x.worker.streamId), [...original.history, ...record.receipt.appended]);
      assert.deepEqual(x.h.store.events.get(), original.events); assert.equal(x.h.store.head.get(), original.head);
      assert.deepEqual(clientReceipts(x.worker), original.receipts); assert.deepEqual(financial(x.worker), original.money);
      assert.ok(x.h.store.sourceOwnershipActive(original.source) && x.h.store.authorizationScopeActive(original.auth));
      assert.deepEqual(x.h.requests.slice(original.requests).filter(request => (request.init.method ?? "GET") !== "GET"
        && !x.resume.isReadOnlyResume(request) && !witnessed(request)), []);
    },
    release() { if (record) record.released = true; delivery.resolve(); },
    async accept() {
      assert.ok(record); assert.ifError(record.error); assert.ok(witnessed(record.request));
      assert.equal(record.response.bodyUsed, true, "The actual Store consumed the same original successful batch response");
      const appended = record.receipt.appended, accepted = { ...original, events: [...original.events, ...appended],
        history: [...original.history, ...appended], head: record.receipt.head }, allowed = new Set([record.request]);
      await unchanged(x, accepted, allowed);
      assert.equal(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 1);
      const current = x.h.store.projection.get().blocks.find(value => value.id === block.id); assert.ok(current);
      assert.equal(current.documentId, original.documentId); assert.equal(current.projectId, original.projectId);
      assert.equal(current.type, block.type); assert.equal(current.handle, block.handle);
      assert.deepEqual(current.properties, { ...block.properties, text: raw.trim(), intent: "include", weight: .7 });
      assert.deepEqual(current.sourceEvents, [...block.sourceEvents, ...appended.map(event => event.eventId)]);
      return { accepted, allowed, appended, block: current };
    },
    restore() { if (x.h.transport === transport) x.h.transport = prior; },
  };
}

test("C Layers Save decision / original A commits while newer native B remains until local Discard", options, async t => {
  const x = await page(t, "layers"); c190InspectorFormData(t, x); await selectLayer(x);
  const original = await before(x), first = c190LayerInspector(x);
  assert.equal(first.selected.id, x.block.id);
  const part = first.fields.instructions.propertyParts.value; assert.equal(typeof part, "string");
  const rawA = "  Saved inspector A keeps the harbor quiet.  ", rawB = " \nNewer inspector B is still unsent — 保留\t ";
  const inputs = x.h.requests.length;
  await input(x, first.fields.instructions, rawA); await drain(x);
  assert.equal(x.h.requests.length, inputs, "Typing A does not implicitly Save");
  await unchanged(x, original);
  const submitted = c190InspectorValues(c190LayerInspector(x));
  const observed = c190ObserveInspectorSave(x, original, x.block, rawA); t.after(() => observed.restore());
  const pending = c190StartInspectorSave(x);
  try {
    await enteredOrTerminal(observed.entered, pending, "actual original inspector batch200 before delivery");
    await observed.assertHeld();
    const current = c190LayerInspector(x), requests = x.h.requests.length;
    assert.equal(current.selected.id, x.block.id); assert.equal(current.fields.instructions.port.value, rawA);
    assert.equal(current.fields.instructions.propertyParts.value, part);
    await input(x, current.fields.instructions, rawB); await drain(x);
    const newer = c190LayerInspector(x);
    assert.equal(newer.selected.id, x.block.id); assert.equal(newer.fields.instructions.port.value, rawB);
    assert.equal(newer.fields.instructions.propertyParts.value, part);
    assert.equal(x.h.requests.length, requests, "Typing B does not send a second write or a read");
    await observed.assertHeld();
  } finally { observed.release(); await pending; await drain(x); }
  // Prove all real effects before the desired native continuation assertion.
  const proof = await observed.accept(), retained = c190LayerInspector(x);
  t.diagnostic("C_LAYERS_SAVE_NEWER_RAW " + JSON.stringify({ originalWorker200: 1, exactBatchEvents: proof.appended.length,
    selectedBlockId: retained.selected.id, canonicalA: layerText(proof.block) === rawA.trim(),
    newerRawRetained: retained.fields.instructions.port.value === rawB,
    samePropertyPart: retained.fields.instructions.propertyParts.value === part,
    sourceHistoryPrivateReceiptAndFiscalExact: true, physicalOrProviderClaim: false }));
  assert.equal(x.h.store.route.get(), original.route); assert.ok(x.owner.isConnected && x.owner.store === x.h.store);
  assert.equal(retained.selected.id, x.block.id);
  assert.equal(retained.fields.instructions.propertyParts.value, part, "Original ACK keeps this exact owner's actual rendered field part");
  assert.equal(retained.fields.instructions.port.value, rawB, "Canonical A cannot replace newer unsent native B");
  for (const name of ["handle", "subtype", "weight"]) assert.equal(retained.fields[name].port.value, submitted[name]);
  const canonical = { ...submitted, instructions: rawA.trim() };
  await c190DiscardInspector(x, proof.block, canonical); await unchanged(x, proof.accepted, proof.allowed);
  const gesture = await openWork(x); await unchanged(x, proof.accepted, proof.allowed); arrived(x, proof.accepted);
  assert.equal(x.h.requests.slice(gesture.start).filter(request => request.url === "/api/events" && request.init.method === "POST").length, 0,
    "Resolved native work permits a fresh useful Work arrival without another Save");
});


// One original Save without a later edit. The exact response/effects are proved
// before the desired same-native-form and current clean-field continuation.
test("C Layers Save decision / healthy original A keeps its native form and permits fresh Work", options, async t => {
  const x = await page(t, "layers"); c190InspectorFormData(t, x); await selectLayer(x);
  const original = await before(x), first = c190LayerInspector(x);
  assert.equal(first.selected.id, x.block.id);
  const rawA = "  Saved inspector A keeps the harbor quiet.  ", requests = x.h.requests.length;
  await input(x, first.fields.instructions, rawA); await drain(x);
  assert.equal(x.h.requests.length, requests, "Typing does not submit a Save or read");
  await unchanged(x, original);
  const submitted = c190LayerInspector(x), form = submitted.form.port;
  const values = c190InspectorValues(submitted), part = submitted.fields.instructions.propertyParts.value;
  assert.equal(typeof part, "string"); assert.equal(values.instructions, rawA);
  assert.strictEqual(form.owner, x.owner); assert.equal(form.isConnected, true);
  const observed = c190ObserveInspectorSave(x, original, x.block, rawA); t.after(() => observed.restore());
  const pending = c190StartInspectorSave(x); let heldForm = null;
  try {
    await enteredOrTerminal(observed.entered, pending, "healthy original inspector batch200 before delivery");
    await observed.assertHeld();
    await x.f.settle(); // Ordinary real renderer updates while the original body remains held.
    const held = c190LayerInspector(x); heldForm = held.form.port;
    assert.equal(held.selected.id, x.block.id); assert.equal(held.fields.instructions.port.value, rawA);
    assert.equal(held.fields.instructions.propertyParts.value, part);
    await observed.assertHeld();
  } finally { observed.release(); await pending; await drain(x); }
  const proof = await observed.accept(), current = c190LayerInspector(x);
  t.diagnostic("C_LAYERS_HEALTHY_NATIVE_FORM " + JSON.stringify({ originalWorker200: 1, exactBatchEvents: proof.appended.length,
    sameFormWhileHeld: heldForm === form, sameCurrentFormAfterAck: current.form.port === form,
    originalConnected: form.isConnected, canonicalA: layerText(proof.block) === rawA.trim(),
    currentRawCanonical: current.fields.instructions.port.value === rawA.trim(),
    sourceHistoryPrivateReceiptAndFiscalExact: true, physicalOrProviderClaim: false }));
  assert.equal(x.h.store.route.get(), original.route); assert.ok(x.owner.isConnected && x.owner.store === x.h.store);
  assert.equal(current.selected.id, x.block.id);
  assert.strictEqual(heldForm, form, "A same-template native form remains the original while its exact Save is held");
  assert.strictEqual(current.form.port, form, "Original ACK does not replace the actual keyed form");
  assert.equal(form.isConnected, true); assert.ok(x.f.renderer.nodes.includes(form));
  assert.equal(form.closest("forma-reality-layers"), x.owner);
  assert.equal(current.fields.instructions.propertyParts.value, part);
  assert.equal(current.fields.instructions.port.value, rawA.trim(), "A genuinely current positive Save leaves a clean canonical field");
  for (const name of ["handle", "subtype", "weight"]) assert.equal(current.fields[name].port.value, values[name]);
  assert.deepEqual(Object.fromEntries(new FormData(form)), { ...values, instructions: rawA.trim() });
  await unchanged(x, proof.accepted, proof.allowed);
  const gesture = await openWork(x); await unchanged(x, proof.accepted, proof.allowed); arrived(x, proof.accepted);
  assert.equal(x.h.requests.slice(gesture.start).filter(request => request.url === "/api/events" && request.init.method === "POST").length, 0,
    "The same original Save leaves no false dirty veto and requires no second write");
});


// One actual applied-receipt departure. The reused fixture creates ONE
// deterministic in-memory planning response before this measured free path;
// it is not zero-generation setup and never contacts a real provider.
import { preview as cAppliedResultPreview, explicitApply as cAppliedResultApply,
  openResume as cAppliedResultResume, receiptIdentity as cAppliedResultReceiptIdentity } from "./helpers/adaptive-recovery-native-fixture.mjs";
import { canonical as cAppliedResultCanonical, verifyOriginalCommit as cAppliedResultOriginal }
  from "./helpers/adaptive-proposal-receipt-truth-fixture.mjs";
import { documentContextBlockRoute as cAppliedResultRoute, documentContextBlockFromRoute as cAppliedResultBlock }
  from "../src/model/routes.ts";

function cAppliedResultAssistantReads(t, x) {
  // Same exact GET-only bridge as the current full Navigation Assistant cases.
  // Original Worker responses and Promises pass through; no auth/body default.
  const previous = globalThis.fetch, pending = new Set(), reads = [], errors = [];
  const bridge = (input, init = {}) => {
    const url = new URL(String(input), "https://fixture.invalid");
    if (url.origin !== "https://fixture.invalid" || url.pathname !== "/api/assistant") return previous(input, init);
    assert.equal(init.method ?? "GET", "GET"); assert.equal(init.body, undefined);
    const row = { url: url.pathname + url.search, status: null }; reads.push(row);
    const original = x.h.fetch(row.url, init);
    pending.add(original); void original.then(response => { row.status = response.status; pending.delete(original); },
      error => { errors.push(error); pending.delete(original); });
    return original;
  };
  globalThis.fetch = bridge;
  t.after(() => { if (globalThis.fetch === bridge) globalThis.fetch = previous; });
  return { reads, pending: () => pending.size, async settle() {
    while (pending.size) await Promise.allSettled([...pending]);
    assert.deepEqual(errors, []); assert.ok(reads.every(row => row.status === 200));
  } };
}
async function cAppliedResultSettle(x, reads) {
  for (let step = 0; step < 4; step++) {
    await reads.settle(); await drain(x); await reads.settle();
    if (!reads.pending() && !x.f.requested && !x.f.frames.size) return;
  }
  assert.equal(reads.pending(), 0); assert.equal(x.f.requested, false); assert.equal(x.f.frames.size, 0);
}
async function cAppliedResultClick(x, reads, node) {
  assert.ok(node.port?.isConnected && node.owner?.isConnected && !node.hiddenBy);
  assert.equal(node.port.matches(":disabled"), false); assert.equal(typeof node.handlers.click, "function");
  assert.equal(node.port.handlers.click, node.handlers.click);
  x.f.native.emit("pointerdown", node.port); x.f.native.focus(node.port);
  await x.f.act(node, "click", { button: 0 }); await cAppliedResultSettle(x, reads);
}
function cAppliedResultAssistantField(x, panel) {
  const tree = x.f.tree(), forms = tree.visible("form").filter(node => node.owner === panel && hasClass(node, "forma-assistant-composer"));
  assert.equal(forms.length, 1); const form = forms[0];
  const composers = tree.nodes.filter(node => node.component?.tag === "forma-ui-conversation-composer"
    && node.component.isConnected && hasClass(node, "forma-assistant-shared-composer") && under(node, parent => parent === form));
  assert.equal(composers.length, 1); const composer = composers[0].component;
  const fields = tree.visible("textarea").filter(node => node.owner === composer && hasClass(node, "forma-assistant-input")
    && under(node, parent => parent === form));
  assert.equal(fields.length, 1); const field = fields[0];
  assert.ok(field.port.isConnected && x.f.renderer.nodes.includes(field.port));
  assert.equal(field.port.closest("forma-ui-conversation-composer"), composer);
  assert.equal(composer.closest("forma-assistant-panel"), panel);
  assert.equal(field.port.matches(":disabled"), false); assert.equal(typeof field.handlers.input, "function");
  return field;
}
function cAppliedResultControl(x, id) {
  const tree = x.f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === x.owner && hasClass(node, "adaptive-proposal-dialog"));
  assert.equal(dialogs.length, 1); const dialog = dialogs[0]; assert.equal(dialog.port.open, true);
  const buttons = tree.visible("button").filter(node => node.owner === x.owner
    && node.text === x.f.i18n.t("adaptive.changes.openBlock") + " · " + id
    && under(node, parent => parent === dialog) && under(node, parent => hasClass(parent, "adaptive-proposal-result")));
  assert.equal(buttons.length, 1); assert.equal(buttons[0].attributes.type, "button");
  const button = buttons[0], token = button.port.full.match(/\s@click=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u);
  assert.ok(token, "The actual result control carries its original native click EventPart");
  const binding = x.f.renderer.bindings[Number(token[1])];
  assert.equal(binding.owner, x.owner); assert.equal(binding.value, button.handlers.click);
  assert.equal(typeof binding.part, "string");
  return { dialog, button, clickPart: binding.part };
}

test("C Adaptive applied result / raw sibling Assistant stays until explicit clear and fresh exact block opening", options, async t => {
  const x = await proposalPage(t, false, "en");
  const afterPlanningSetup = x.h.requests.length;
  await native(t, x, ["forma-adaptive-path", "forma-creative-assistant"]); x.owner = currentHost(x);
  const reads = cAppliedResultAssistantReads(t, x), preview = await cAppliedResultPreview(x);
  const receipt = await cAppliedResultApply(x), original = cAppliedResultOriginal(x.state, preview);
  assert.equal(receipt.previewId, original.previewId); assert.equal(receipt.approvalHash, original.approvalHash);
  assert.equal(receipt.executionId, x.state.paidQuote.executionId); assert.equal(receipt.bindingHash, x.state.paidQuote.bindingHash);
  assert.equal(receipt.blockIds.length, 1); const blockId = receipt.blockIds[0];
  assert.equal(preview.changes.length, 1); assert.equal(preview.changes[0].targetId, blockId);
  assert.equal(proposalApplies(x).length, 1); assert.equal(proposalReceipts(x).length, 1);
  assert.equal(x.responses.at(-1).status, 200); assert.equal(x.responses.at(-1).body.status, "applied");
  assert.equal(snapshot(x.owner).phase, "applied"); cAppliedResultControl(x, blockId);
  await cAppliedResultClick(x, reads, control(x, "action.close"));
  assert.equal(snapshot(x.owner).visible, false); assert.equal(snapshot(x.owner).phase, "applied");

  const session = x.h.store.session.get(); assert.equal(session.assistant.enabled, true); assert.equal(session.policy.accepted, true);
  const assistants = x.f.components().filter(owner => owner.tag === "forma-creative-assistant" && owner.isConnected && owner.store === x.h.store);
  assert.equal(assistants.length, 1); const assistant = assistants[0]; assert.equal(assistant.closest("forma-shell"), x.f.host);
  const panels = x.f.components().filter(owner => owner.tag === "forma-assistant-panel" && owner.isConnected
    && owner.closest("forma-creative-assistant") === assistant);
  assert.equal(panels.length, 1); const panel = panels[0]; assert.equal(panel.open, false);
  const launcher = () => x.f.find("button", node => node.owner === panel && hasClass(node, "forma-assistant-launcher"));
  const collapse = () => x.f.find("button", node => node.owner === panel && hasClass(node, "forma-assistant-close"));
  await cAppliedResultClick(x, reads, launcher()); assert.equal(panel.open, true);
  assert.ok(reads.reads.length > 0, "The actual Assistant read passed through the existing RAM Worker");
  assert.equal(cAppliedResultAssistantField(x, panel).port.value, ""); assert.equal(panel.commandDepartureBlocked, false);
  const scope = panel.conversationScope, departure = assistant.captureCommandDeparture(); assert.equal(departure.current(), true);
  const floor = await before(x), canonical = cAppliedResultCanonical(x.state);
  const privateRows = x.state.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all();
  const allowed = new Set(), raw = " \nKeep this unsent Assistant direction — 保留\t ";
  const noEffects = async () => {
    await cAppliedResultSettle(x, reads); await unchanged(x, floor, allowed);
    assert.deepEqual(cAppliedResultCanonical(x.state), canonical);
    assert.deepEqual(x.state.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all(), privateRows);
    assert.deepEqual(cAppliedResultOriginal(x.state, preview), original);
    assert.equal(proposalApplies(x).length, 1); assert.equal(proposalReceipts(x).length, 1); assert.equal(x.state.calls.length, 1);
    assert.equal(x.h.requests.slice(afterPlanningSetup).filter(row => row.init.method === "POST"
      && /^\/api\/document-jobs(?:[/?]|$)/u.test(row.url)).length, 0, "No new planning execution or document-job command after the declared original seed");
    for (const table of ["assistant_turns", "assistant_action_proposals", "assistant_action_commits", "assistant_specialist_tasks"])
      assert.equal(x.state.sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 0, "No Assistant send or tool request: " + table);
  };
  const resumeExact = async () => {
    const requests = x.h.requests.length, responses = x.responses.length;
    await cAppliedResultResume(x); await cAppliedResultSettle(x, reads);
    const rows = x.h.requests.slice(requests).filter(row => row.url === "/api/context/adaptive/apply");
    assert.equal(rows.length, 1); const row = rows[0];
    assert.deepEqual(row.body, { action: "retrieve", projectId: x.state.scope.projectId, documentId: x.state.scope.documentId,
      canvasId: null, previewId: receipt.previewId, approvalHash: receipt.approvalHash });
    const returned = x.responses.slice(responses); assert.equal(returned.length, 1);
    assert.equal(returned[0].status, 200); assert.equal(returned[0].body.status, "applied");
    for (const key of ["previewId", "approvalHash", "executionId", "bindingHash", "selectionKey", "blockIds", "canvasItemIds", "relationCount"])
      assert.deepEqual(returned[0].body[key], receipt[key]);
    allowed.add(row); assert.equal(currentHost(x), x.owner); assert.equal(snapshot(x.owner).phase, "applied");
    assert.deepEqual(cAppliedResultReceiptIdentity(snapshot(x.owner).receipt), cAppliedResultReceiptIdentity(receipt));
    return cAppliedResultControl(x, blockId);
  };

  await input(x, cAppliedResultAssistantField(x, panel), raw); await cAppliedResultSettle(x, reads);
  assert.equal(cAppliedResultAssistantField(x, panel).port.value, raw); assert.equal(panel.commandDepartureBlocked, true);
  await cAppliedResultClick(x, reads, collapse()); assert.equal(panel.open, false);
  assert.equal(panel.conversationScope, scope); assert.equal(departure.current(), true); assert.equal(departure.blocked(), true);
  const action = await resumeExact(); await noEffects();
  const currentAction = cAppliedResultControl(x, blockId);
  assert.equal(currentAction.clickPart, action.clickPart, "After the no-effect redraw, reacquire the same actual result EventPart");
  await cAppliedResultClick(x, reads, currentAction.button); await noEffects();
  t.diagnostic("C_ADAPTIVE_APPLIED_SIBLING " + JSON.stringify({ originalWorkerStatus: 200, previewId: receipt.previewId,
    originalBlockId: blockId, routeBefore: floor.route, routeAfter: x.h.store.route.get(),
    originConnected: x.owner.isConnected, exactOriginalReceiptHistoryPrivateAndFiscal: true,
    fixturePlanningResponses: x.state.calls.length, realProviderOrPhysicalClaim: false }));
  assert.equal(x.h.store.route.get(), floor.route, "The applied-result button must admit sibling work before closing its receipt presentation");
  assert.equal(x.h.location.pathname + x.h.location.search + x.h.location.hash, floor.route);
  assert.equal(currentHost(x), x.owner); assert.equal(snapshot(x.owner).visible, true);
  assert.equal(snapshot(x.owner).phase, "applied");
  assert.deepEqual(cAppliedResultReceiptIdentity(snapshot(x.owner).receipt), cAppliedResultReceiptIdentity(receipt));
  cAppliedResultControl(x, blockId);
  assert.ok(assistant.isConnected && panel.isConnected); assert.equal(panel.open, false);
  assert.equal(panel.conversationScope, scope); assert.equal(departure.current(), true); assert.equal(departure.blocked(), true);
  assert.equal(x.h.store.ui.toast, x.f.i18n.t("next.lifecycle.assistantOwnsWork"));

  await cAppliedResultClick(x, reads, control(x, "action.close"));
  await cAppliedResultClick(x, reads, launcher());
  assert.equal(cAppliedResultAssistantField(x, panel).port.value, raw);
  await input(x, cAppliedResultAssistantField(x, panel), ""); await cAppliedResultSettle(x, reads);
  assert.equal(cAppliedResultAssistantField(x, panel).port.value, ""); assert.equal(panel.commandDepartureBlocked, false);
  await cAppliedResultClick(x, reads, collapse()); await noEffects();
  const fresh = await resumeExact(); await noEffects();
  const currentFresh = cAppliedResultControl(x, blockId);
  assert.equal(currentFresh.clickPart, fresh.clickPart, "The deliberate clear tail also activates the current original EventPart");
  await cAppliedResultClick(x, reads, currentFresh.button); await noEffects();
  const destination = cAppliedResultRoute(floor.documentId, floor.title, blockId);
  assert.equal(x.h.store.route.get(), destination); assert.equal(cAppliedResultBlock(destination), blockId);
  assert.equal(x.h.location.pathname + x.h.location.search + x.h.location.hash, destination);
  assert.equal(x.owner.isConnected, false);
  const targets = x.f.components().filter(owner => owner.tag === "forma-context-block" && owner.isConnected
    && owner.store === x.h.store && owner.block?.id === blockId && owner.block.documentId === floor.documentId);
  assert.equal(targets.length, 1); assert.equal(targets[0].block.projectId, floor.projectId);
  const tree = x.f.tree(); assert.equal(tree.visible("article").filter(node => node.owner === targets[0]
    && node.attributes["data-block-id"] === blockId).length, 1);
});
