// Actual complete PlatformShell/Product/Delivery/PlatformAssistant/Panel/composer
// and the existing RAM Worker. Native ports are finite, not browser/AT evidence.
import assert from "node:assert/strict";
import test from "node:test";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { setLocale } from "./helpers/product-delivery-owner-choice-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { canonical, currentCreate, currentDelivery, platformDeliveryFixture } from "./helpers/product-platform-fragment-fixture.mjs";

const options = { concurrency: false, timeout: 45000 };
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, parent) => { for (let current = node; current; current = current.parent) if (current === parent) return true; return false; };
const core = f => ({ route: f.store.route.get(), events: structuredClone(f.store.events.get()),
  content: structuredClone(f.store.content.get()), head: f.store.head.get(), delivery: canonical(f),
  financial: financial(f.storeHost.worker), counts: f.storeHost.worker.counts() });
const dedicated = f => ({
  events: f.storeHost.worker.sqlite.prepare("SELECT * FROM platform_assistant_events ORDER BY sequence,event_id").all(),
  content: f.storeHost.worker.sqlite.prepare("SELECT * FROM platform_assistant_private_content ORDER BY content_id").all(),
  commits: f.storeHost.worker.sqlite.prepare("SELECT * FROM platform_assistant_commits ORDER BY commit_id").all(),
});
function emit(f, type, target) {
  for (const listener of [...(f.listeners.get(type) ?? [])]) listener({ type, target, currentTarget: ports.documentPort,
    preventDefault() {}, stopPropagation() {}, composedPath: () => [target, ports.documentPort] });
}
function gesture(f, node) {
  assert.ok(node?.isConnected && f.renderer.nodes.includes(node));
  emit(f, "pointerdown", node); ports.documentPort.activeElement = node; node.focus(); emit(f, "focusin", node);
}
async function reached(f, predicate, label) {
  await f.flush(); await untilScene(() => { f.draw(); return predicate(); }, label); await f.flush();
}
function currentPanel(f) {
  const owners = [...f.renderer.instances.values()].map(row => row.instance)
    .filter(owner => owner.tag === "forma-assistant-panel" && owner.isConnected && owner.parentElement === f.assistant);
  assert.equal(owners.length, 1); assert.equal(owners[0], f.panel); return owners[0];
}
function assertCore(f) {
  assert.deepEqual(core(f), f.initialCore, "No Creator, Delivery, provider or fiscal mutation belongs to Platform guidance navigation");
  assert.equal(f.platformSession.get(), f.initialSession); assert.deepEqual(f.external, []);
}
function verifyTurn(f) {
  const original = f.originalTurn; assert.ok(original?.ready);
  assert.equal(original.status, 201); assert.equal(original.turn.id, original.body.turnId);
  assert.equal(original.turn.user, original.body.message);
  assert.equal(original.turn.proposal?.kind, "navigate"); assert.equal(original.turn.proposal.route, "/product/insights");
  assert.equal(original.turn.proposal.turnId, original.body.turnId);
  assert.equal(original.turn.proposal.id, "platform-" + original.body.turnId);
  assert.deepEqual(f.assistantCalls.filter(call => call.method === "POST"), [original.call]);
  assert.equal(original.call.init, original.init); assert.equal(original.call.init.body, original.bytes);
  assert.equal(JSON.stringify(original.call.body), original.bytes);
  const rows = dedicated(f), before = original.before;
  assert.deepEqual(rows, original.saved, "The exact original dedicated history/content/commit remains unchanged");
  assert.equal(before.events.length, 0); assert.equal(before.content.length, 0); assert.equal(before.commits.length, 0);
  assert.equal(rows.events.length, 3); assert.equal(rows.content.length, 2); assert.equal(rows.commits.length, 1);
  assert.deepEqual(rows.events.map(row => row.event_type), ["PlatformChatMessageSent", "PlatformAssistantReasoned", "PlatformNavigationProposed"]);
  assert.deepEqual(rows.events.map(row => row.sequence), [1, 2, 3]);
  assert.equal(new Set(rows.events.map(row => row.event_id)).size, 3);
  for (const row of [...rows.events, ...rows.content]) {
    assert.equal(row.actor_user_id, f.initialSession.user.userId); assert.equal(row.audience, "product");
    assert.equal(row.route_family, "/product/delivery"); assert.equal(row.permission_epoch, f.initialSession.permissionEpoch);
  }
  for (const row of rows.events) assert.equal(row.turn_id, original.body.turnId);
  const user = rows.content.find(row => row.content_id === rows.events[0].content_id);
  const answer = rows.content.find(row => row.content_id === rows.events[1].content_id);
  assert.ok(user && answer && user !== answer); assert.equal(user.kind, "platform-chat-user");
  assert.equal(user.content, original.body.message); assert.equal(answer.kind, "platform-chat-assistant");
  assert.ok(answer.content.length); assert.equal(rows.events[1].reply_key, original.turn.reply.key);
  assert.deepEqual(JSON.parse(rows.events[1].proposal_json), original.turn.proposal);
  assert.deepEqual(JSON.parse(rows.events[2].proposal_json), original.turn.proposal);
  assert.equal(rows.events[2].content_id, null);
  assert.equal(rows.commits[0].commit_id, ["platform", f.initialSession.user.userId, "product", "/product/delivery", f.initialSession.permissionEpoch, original.body.turnId].join(":"));
  assert.equal(rows.commits[0].verified, 1); assertCore(f);
  return { turnId: original.body.turnId, eventIds: rows.events.map(row => row.event_id), commitId: rows.commits[0].commit_id };
}
async function page(t, locale = "en", contextRoute = "/product/delivery") {
  assert.ok(["/product/delivery", "/product/evaluation", "/product/evaluation/replay"].includes(contextRoute));
  let restore = () => {}; t.after(() => restore());
  const f = await platformDeliveryFixture(t), create = currentCreate(f);
  // Use the current authorized untouched Delivery form; no fabricated clean getter.
  const values = new Map(f.values(create.form)); assert.equal(values.get("title"), ""); assert.equal(values.get("evidence"), "");
  f.deliveryOwner = create.owner; f.deliveryForm = create.form;
  f.assistant = f.renderer.component("forma-platform-assistant"); f.panel = f.renderer.component("forma-assistant-panel");
  assert.ok(f.assistant.isConnected && f.assistant.parentElement === f.host); assert.equal(f.panel.parentElement, f.assistant);
  assert.equal(f.panel.open, false); assert.equal(f.panel.guidanceOnly, true);
  // The existing complete fixture registers the closed actual Panel. Its open
  // producer also requires this actual class, not a replacement textarea.
  const { FormaUiConversationComposer } = await ports.loadActual("src/components/design-system/conversation-composer.ts");
  f.renderer.registry["forma-ui-conversation-composer"] = FormaUiConversationComposer;
  // The original proposal performs actual pushState, then dispatches a native
  // popstate. Supply only the absent event/dispatch interfaces; history itself
  // stays the existing fixture setter and actual registered app listeners run.
  const nativeUndo = [], restoreNative = () => { for (const undo of nativeUndo.reverse()) undo(); };
  restore = restoreNative;
  const nativeProperty = (object, key, value) => {
    const before = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, { configurable: true, writable: true, value });
    nativeUndo.push(() => { if (before) Object.defineProperty(object, key, before); else delete object[key]; });
  };
  if (typeof globalThis.PopStateEvent !== "function") nativeProperty(globalThis, "PopStateEvent", class extends Event {
    constructor(type, init = {}) { super(type, init); this.state = init.state ?? null; }
  });
  if (typeof ports.windowPort.dispatchEvent !== "function") nativeProperty(ports.windowPort, "dispatchEvent", event => {
    assert.equal(event.type, "popstate", "only the actual original proposal's native history event is supplied here");
    for (const listener of [...(f.listeners.get(event.type) ?? [])]) listener.call(ports.windowPort, event);
    return !event.defaultPrevented;
  });
  if (locale !== "en") { setLocale(f, locale); for (const { instance } of f.renderer.instances.values()) instance.i18n = f.i18n; }
  f.assignments = []; f.newTabs = []; f.assistantCalls = []; f.dispatchPorts = new WeakSet(); f.originalTurn = null; f.completedContextReads = 0;
  f.nativeLocationAssign = path => { assert.equal(path, "/projects"); f.assignments.push(path); };
  f.initialSession = f.platformSession.get(); f.initialCore = core(f);
  let armed = null;
  f.armTurn = (message, gate = null) => {
    assert.equal(armed, null); assert.equal(f.originalTurn, null);
    armed = { message, gate, before: structuredClone(dedicated(f)) };
  };
  const previous = globalThis.fetch;
  const transport = async (input, init = {}) => {
    const url = new URL(String(input), "https://fixture.invalid");
    if (url.pathname !== "/api/platform/assistant") return previous(input, init);
    assert.equal(url.origin, "https://fixture.invalid"); assert.deepEqual([...url.searchParams], [["route", contextRoute]]);
    const method = init.method ?? "GET", headers = new Headers(init.headers), session = f.platformSession.get();
    assert.equal(headers.get("x-forma-assistant-audience"), session.audience);
    assert.equal(headers.get("x-forma-platform-permission-epoch"), session.permissionEpoch);
    assert.equal(headers.get("accept"), "application/json"); assert.ok(["GET", "POST"].includes(method));
    if (contextRoute !== "/product/delivery") assert.equal(method, "GET", "additional tool-link origins never send a Platform turn");
    const call = { url: url.pathname + url.search, method, init, body: init.body ? JSON.parse(init.body) : null };
    f.assistantCalls.push(call); f.calls.push({ url: call.url, method, body: call.body });
    let original = null;
    if (method === "POST") {
      assert.ok(armed && !f.originalTurn, "only one armed original native turn may mutate the dedicated Platform history");
      assert.deepEqual(Object.keys(call.body).sort(), ["locale", "message", "turnId"]);
      assert.equal(call.body.message, armed.message); assert.equal(call.body.locale, f.i18n.locale);
      assert.match(call.body.turnId, /^[a-zA-Z0-9_-]{8,80}$/u);
      original = { ...armed, call, init, bytes: init.body, body: structuredClone(call.body), ready: false, returned: false };
      f.originalTurn = original; armed = null;
    }
    const response = await f.storeHost.worker.request(call.url, init);
    assert.equal(response.status, method === "GET" ? 200 : 201, "the actual current platform authority and original RAM response must succeed");
    const payload = await response.clone().json(); assert.equal(response.bodyUsed, false);
    assert.equal(payload.context.scope.actorUserId, f.initialSession.user.userId);
    assert.equal(payload.context.scope.projectId, null); assert.equal(payload.context.scope.documentId, null);
    assert.equal(payload.context.surface.canonicalFamily, contextRoute);
    if (method === "GET") { assert.ok(Array.isArray(payload.turns)); f.completedContextReads += 1; f.lastContext = payload; return response; }
    original.response = response; original.status = response.status; original.turn = structuredClone(payload.turn);
    await f.storeHost.worker.drainBackground(); original.saved = dedicated(f); original.ready = true;
    try { verifyTurn(f); } catch (error) {
      const prototypes = value => Object.fromEntries(["events", "content", "commits"].map(key => [key,
        Array.isArray(value?.[key]) ? value[key].map(row => ({ prototype: Object.getPrototypeOf(row) === null ? "null" : "ordinary", keys: Object.keys(row) })) : null]));
      t.diagnostic("PLATFORM_ASSISTANT_ORIGINAL_OBSERVER_FAILURE " + JSON.stringify({ turnId: original.body.turnId,
        status: original.status, ready: original.ready, returned: original.returned, bodyUsed: response.bodyUsed,
        message: error.message, operator: error.operator, serializedEqual: JSON.stringify(error.actual) === JSON.stringify(error.expected),
        actual: prototypes(error.actual), expected: prototypes(error.expected) }));
      throw error; // Preserve the exact original observer failure and actual host catch behavior.
    }
    if (original.gate) await original.gate.promise;
    original.returned = true; return response; // Same original Response; no replacement ACK or request replay.
  };
  globalThis.fetch = transport; restore = () => { if (globalThis.fetch === transport) globalThis.fetch = previous; restoreNative(); };
  return f;
}
function button(f, owner, name) {
  f.draw(); const rows = f.tree().visible("button").filter(node => node.owner === owner && classed(node, name));
  assert.equal(rows.length, 1); assert.ok(rows[0].port.isConnected && !Object.hasOwn(rows[0].attributes, "disabled")); return rows[0];
}
async function open(f) {
  const panel = currentPanel(f), launcher = button(f, panel, "forma-assistant-launcher");
  const beforeReads = f.completedContextReads, beforeContext = panel.context;
  gesture(f, launcher.port); launcher.port.click();
  await reached(f, () => panel.open && Boolean(panel.context) && panel.context !== beforeContext
    && f.completedContextReads === beforeReads + 1, "the current Panel consumes its actual original Platform context read");
  const panels = f.tree().visible("section").filter(node => node.owner === panel && classed(node, "forma-assistant-panel"));
  assert.equal(panels.length, 1); assert.equal(panels[0].attributes["aria-modal"], "false");
  assert.equal(panel.context.scope.actorUserId, f.initialSession.user.userId); return panel;
}
async function close(f) {
  const panel = currentPanel(f), current = button(f, panel, "forma-assistant-close");
  gesture(f, current.port); current.port.click(); await f.flush(); assert.equal(currentPanel(f).open, false);
  assert.equal(f.tree().visible("textarea").filter(node => node.owner.tag === "forma-ui-conversation-composer").length, 0);
}
function composer(f) {
  f.draw(); const panel = currentPanel(f), instances = [...f.renderer.instances.values()].map(row => row.instance)
    .filter(owner => owner.tag === "forma-ui-conversation-composer" && owner.isConnected && owner.parentElement === panel);
  assert.equal(instances.length, 1); const owner = instances[0];
  const tree = f.tree(), fields = tree.visible("textarea").filter(node => node.owner === owner);
  assert.equal(fields.length, 1); assert.ok(fields[0].port.isConnected && !Object.hasOwn(fields[0].attributes, "disabled"));
  const forms = tree.visible("form").filter(node => node.owner === panel && classed(node, "forma-assistant-composer") && inside(fields[0], node));
  assert.equal(forms.length, 1); return { owner, panel, tree, field: fields[0], form: forms[0] };
}
async function type(f, raw) {
  const current = composer(f); gesture(f, current.field.port); current.field.port.value = raw;
  current.field.handlers.input.call(current.owner, { type: "input", target: current.field.port, currentTarget: current.field.port,
    preventDefault() {}, stopPropagation() {} });
  await f.flush(); const after = composer(f); assert.equal(after.owner, current.owner);
  assert.equal(after.owner.value, raw); assert.equal(after.field.port.value, raw); return after;
}
async function submitTurn(f, message, gate = null) {
  await type(f, message); f.armTurn(message.trim(), gate); const current = composer(f);
  const submitters = current.tree.visible("button").filter(node => node.owner === current.owner
    && node.attributes.type === "submit" && inside(node, current.form));
  assert.equal(submitters.length, 1); assert.ok(submitters[0].port.isConnected && !Object.hasOwn(submitters[0].attributes, "disabled"));
  gesture(f, submitters[0].port);
  // Same explicit native SubmitEvent contract as currentCreate/submitCurrent:
  // actual current form and enabled associated submitter, not #send extraction.
  current.form.handlers.submit.call(current.panel, { type: "submit", target: current.form.port,
    currentTarget: current.form.port, submitter: submitters[0].port, preventDefault() {}, stopPropagation() {} });
  await reached(f, () => Boolean(f.originalTurn?.ready), "the exact original native guidance turn commits in the real RAM Worker");
  if (!gate) await reached(f, () => currentPanel(f).pending === 0 && currentPanel(f).proposals.length === 1,
    "the current host consumes its original response and renders its real proposal");
  return verifyTurn(f);
}
function proposalButton(f) {
  f.draw(); const panel = currentPanel(f); assert.equal(panel.proposals.length, 1);
  const proposal = panel.proposals[0]; assert.deepEqual(proposal, f.originalTurn.turn.proposal);
  const tree = f.tree(), cards = tree.visible("article").filter(node => node.owner === panel && classed(node, "forma-assistant-proposal"));
  assert.equal(cards.length, 1);
  const rows = tree.visible("button").filter(node => node.owner === panel && inside(node, cards[0]) && node.text === f.i18n.t(proposal.key));
  assert.equal(rows.length, 1); assert.ok(rows[0].port.isConnected && !Object.hasOwn(rows[0].attributes, "disabled"));
  return { row: rows[0], proposal };
}
async function accept(f) {
  const { row, proposal } = proposalButton(f); gesture(f, row.port); row.port.click(); await f.flush(); return proposal;
}
async function navigate(f, kind, modified = false) {
  f.draw(); const rows = f.tree().visible("a").filter(node => kind === "task"
    ? node.owner.tag === "forma-ui-audience-navigation" && node.owner.parentElement === f.host && node.attributes.href === "/product/insights"
    : node.owner === f.host && classed(node, "brand") && node.attributes.href === "/projects");
  assert.equal(rows.length, 1); const row = rows[0], owner = row.owner;
  if (owner.tag === "forma-ui-audience-navigation" && !f.dispatchPorts.has(owner)) {
    const dispatch = owner.dispatchEvent;
    owner.dispatchEvent = function (event) { const result = dispatch.call(this, event); return event.cancelable && event.defaultPrevented ? false : result; };
    f.dispatchPorts.add(owner); // Only native cancelable dispatch's return contract; real parent handler stays current.
  }
  gesture(f, row.port);
  const event = { type: "click", target: row.port, currentTarget: row.port, button: 0,
    metaKey: modified, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, composedPath: () => [row.port, owner, f.host] };
  row.handlers.click?.call(owner, event);
  if (!event.defaultPrevented) {
    if (modified) f.newTabs.push(row.attributes.href);
    else { assert.equal(kind, "header"); f.nativeLocationAssign(row.attributes.href); }
  }
  await f.flush(); return event;
}
function refused(f, openExpected) {
  assert.equal(f.nativeHistoryLocation.pathname + f.nativeHistoryLocation.search, "/product/delivery");
  assert.deepEqual(f.assignments, []); assert.equal(currentPanel(f).open, openExpected);
  assert.ok(f.assistant.isConnected && f.assistant.parentElement === f.host);
  assert.equal(currentDelivery(f), f.deliveryOwner); assert.equal(currentCreate(f).form, f.deliveryForm);
  const rows = f.tree().visible("p").filter(node => node.owner === f.host && classed(node, "platform-departure-notice"));
  assert.equal(rows.length, 1); assert.equal(rows[0].attributes.role, "status");
  assert.equal(rows[0].text, f.i18n.t("next.lifecycle.assistantOwnsWork")); assertCore(f);
}
async function arrived(f, kind) {
  if (kind === "header") { assert.deepEqual(f.assignments, ["/projects"]); return; }
  await f.settle(); assert.equal(f.nativeHistoryLocation.pathname + f.nativeHistoryLocation.search, "/product/insights");
  assert.equal(f.assistant.isConnected, false); assert.equal(f.panel.isConnected, false); assert.equal(currentDelivery(f), null);
  const views = [...f.renderer.instances.values()].map(row => row.instance)
    .filter(owner => owner.tag === "forma-product-insights" && owner.isConnected);
  assert.equal(views.length, 1); assert.equal(views[0].parentElement.parentElement, f.host); assert.deepEqual(f.assignments, []);
}

test("actual Platform Assistant clean current context permits the native Insights task", options, async t => {
  const f = await page(t); await open(f); const before = dedicated(f); assert.deepEqual(before, { events: [], content: [], commits: [] });
  await navigate(f, "task"); await arrived(f, "task"); assertCore(f); assert.deepEqual(dedicated(f), before);
  assert.equal(f.assistantCalls.filter(call => call.method === "POST").length, 0);
});

for (const [locale, kind] of [["en", "task"], ["ja", "header"]])
  test("actual Platform Assistant collapsed raw input refuses ordinary " + kind + " until explicit clear / " + locale, options, async t => {
    const f = await page(t, locale), raw = "  Unsent Platform question 文書\nنور  "; await open(f); await type(f, raw);
    assert.equal(f.panel.commandDepartureBlocked, true); await close(f); const rows = dedicated(f);
    if (kind === "header") {
      const event = await navigate(f, kind, true); assert.equal(event.defaultPrevented, false);
      assert.deepEqual(f.newTabs, ["/projects"]); assert.deepEqual(f.assignments, []);
    }
    const calls = f.calls.length; await navigate(f, kind); assertCore(f); assert.deepEqual(dedicated(f), rows);
    t.diagnostic("PLATFORM_ASSISTANT_RAW_DEPARTURE " + JSON.stringify({ locale, kind, path: f.nativeHistoryLocation.pathname,
      assignments: f.assignments, originalAssistantConnected: f.assistant.isConnected, additionalRequests: f.calls.length - calls }));
    refused(f, false); assert.equal(f.calls.length, calls); assert.equal(f.assistantCalls.filter(call => call.method === "POST").length, 0);
    await open(f); assert.equal(composer(f).field.port.value, raw); await type(f, ""); await close(f);
    assert.equal(f.panel.commandDepartureBlocked, false); await navigate(f, kind); await arrived(f, kind);
    assertCore(f); assert.deepEqual(dedicated(f), rows);
  });

test("actual Platform Assistant original Worker proposal permits clean authorized navigation without another turn", options, async t => {
  const f = await page(t); await open(f); const receipt = await submitTurn(f, "Open insights");
  assert.equal(f.originalTurn.response.bodyUsed, true); assert.equal(f.panel.commandDepartureBlocked, false);
  await accept(f); await arrived(f, "task"); assert.deepEqual(verifyTurn(f), receipt);
});

test("actual Platform Assistant proposal refuses newer raw B without consuming it, then deliberate clear accepts that same original", options, async t => {
  const f = await page(t, "ja"); await open(f); const receipt = await submitTurn(f, "Open insights");
  const raw = "  Newer unsent question B 文書\nنور  "; await type(f, raw); const calls = f.calls.length;
  const proposal = await accept(f); assert.deepEqual(verifyTurn(f), receipt);
  t.diagnostic("PLATFORM_ASSISTANT_PROPOSAL_DEPARTURE " + JSON.stringify({ path: f.nativeHistoryLocation.pathname,
    originalProposalId: proposal.id, originalAssistantConnected: f.assistant.isConnected, additionalRequests: f.calls.length - calls }));
  refused(f, true); assert.equal(f.calls.length, calls); assert.equal(f.panel.proposals.length, 1); assert.equal(f.panel.proposals[0], proposal);
  assert.equal(composer(f).field.port.value, raw); await type(f, ""); assert.equal(proposalButton(f).proposal, proposal);
  await accept(f); await arrived(f, "task"); assert.deepEqual(verifyTurn(f), receipt);
});

test("actual Platform Assistant held original turn owns task departure until its exact response settles", options, async t => {
  const f = await page(t), gate = sceneDeferred(); await open(f); let receipt;
  try {
    receipt = await submitTurn(f, "Open insights", gate); assert.equal(f.originalTurn.returned, false);
    assert.equal(f.originalTurn.response.bodyUsed, false); assert.equal(currentPanel(f).pending, 1);
    assert.equal(composer(f).field.port.value, ""); assert.equal(f.panel.commandDepartureBlocked, false,
      "The current host pending turn, not an invented Panel raw flag, owns this boundary");
    const calls = f.calls.length; await navigate(f, "task"); assert.deepEqual(verifyTurn(f), receipt);
    t.diagnostic("PLATFORM_ASSISTANT_PENDING_DEPARTURE " + JSON.stringify({ receipt, path: f.nativeHistoryLocation.pathname,
      originalAssistantConnected: f.assistant.isConnected, additionalRequests: f.calls.length - calls }));
    refused(f, true); assert.equal(f.calls.length, calls); assert.equal(f.panel.pending, 1);
  } finally {
    gate.resolve(); await reached(f, () => Boolean(f.originalTurn?.returned), "the same original turn Response is released");
  }
  await reached(f, () => currentPanel(f).pending === 0 && currentPanel(f).proposals.length === 1,
    "the original current Platform turn settles");
  assert.equal(f.originalTurn.response.bodyUsed, true); assert.equal(f.panel.commandDepartureBlocked, false);
  await navigate(f, "task"); await arrived(f, "task"); assert.deepEqual(verifyTurn(f), receipt);
});

// Additive direct-caller baseline. These actual Product leaves share the
// existing complete PlatformShell/Assistant/native ports and original RAM
// Worker. Bare-anchor defaults below record a requested hard navigation only;
// they do not manufacture a destination document, unload, or browser result.
const platformToolLinks = Object.freeze([
  { id: "Evaluation fictional replay", locale: "en", origin: "/product/evaluation", originTag: "forma-product-evaluation",
    target: "/product/evaluation/replay", targetTag: "forma-synthetic-replay", label: "evaluation.syntheticReplay" },
  { id: "Evaluation adapter contracts", locale: "ja", origin: "/product/evaluation", originTag: "forma-product-evaluation",
    target: "/product/evaluation/adapters", targetTag: "forma-product-adapter-preview", label: "evaluation.adapterPreview" },
  { id: "Evaluation approved replay", locale: "en", origin: "/product/evaluation", originTag: "forma-product-evaluation",
    target: "/product/evaluation/actual", targetTag: "forma-actual-replay", label: "evaluation.actualReplay" },
  { id: "Synthetic Replay approved replay", locale: "ja", origin: "/product/evaluation/replay", originTag: "forma-synthetic-replay",
    target: "/product/evaluation/actual", targetTag: "forma-actual-replay", label: "evaluation.actualReplay" },
]);
const platformToolRoute = f => f.nativeHistoryLocation.pathname + f.nativeHistoryLocation.search;
const platformToolJournal = f => Object.fromEntries([
  ["events", "SELECT * FROM events ORDER BY rowid"],
  ["sessions", "SELECT * FROM replay_sessions ORDER BY session_id"],
  ["operations", "SELECT * FROM replay_session_operations ORDER BY session_id"],
  ["approvals", "SELECT * FROM replay_approvals ORDER BY approval_id"],
].map(([name, sql]) => [name, f.storeHost.worker.sqlite.prepare(sql).all()]));

function platformToolOwner(f, tag) {
  const rows = [...f.renderer.instances.values()].map(row => row.instance)
    .filter(owner => owner.tag === tag && owner.isConnected);
  assert.equal(rows.length, 1, "one actual current Product leaf: " + tag);
  const owner = rows[0]; assert.ok(owner instanceof f.renderer.registry[tag]);
  assert.equal(owner.parentElement?.tag, "forma-product-application");
  assert.ok(owner.parentElement.isConnected); assert.equal(owner.parentElement.parentElement, f.host);
  assert.equal(owner.closest("forma-platform-shell"), f.host); return owner;
}

function platformToolReady(f, path, tag) {
  if (platformToolRoute(f) !== path) return false;
  const tree = f.tree(), main = tree.visible("main").filter(node => node.owner === f.host
    && node.attributes.id === "main-content" && node.attributes["aria-busy"] === "false");
  const owner = [...f.renderer.instances.values()].map(row => row.instance).find(item => item.tag === tag && item.isConnected);
  if (main.length !== 1 || !owner) return false;
  const expected = tag === "forma-synthetic-replay" ? "synthetic-replay"
    : tag === "forma-actual-replay" ? "actual-replay" : "role-evidence";
  if (!tree.visible("section").some(node => node.owner === owner && classed(node, expected) && inside(node, main[0]))) return false;
  if (tag === "forma-synthetic-replay") return true;
  const endpoint = tag === "forma-actual-replay" ? "/api/replay-sessions" : "/api/portfolio/product/evaluation";
  return f.toolReads.some(read => read.origin === path && read.url === endpoint && read.response?.bodyUsed);
}

function platformToolEffects(f, historyRows) {
  assertCore(f); assert.deepEqual(platformToolJournal(f), f.toolJournalBefore,
    "Original Worker history, replay sessions, operations and approvals are unchanged");
  assert.deepEqual(dedicated(f), historyRows, "No Platform turn, private message or commit is created by a tool link");
  assert.equal(f.originalTurn, null); assert.ok(f.calls.every(call => call.method === "GET"));
  assert.ok(f.assistantCalls.every(call => call.method === "GET"));
  assert.deepEqual(f.assignments, []); assert.deepEqual(f.external, []);
}

async function platformToolPage(t, spec) {
  let restore = () => {}; t.after(() => restore());
  const f = await page(t, spec.locale, spec.origin);
  f.toolSpec = spec; f.toolReads = []; f.toolNativeRequests = []; f.toolNewTabs = [];
  f.toolJournalBefore = platformToolJournal(f);
  assert.deepEqual(f.toolJournalBefore.sessions, []); assert.deepEqual(f.toolJournalBefore.operations, []);
  assert.deepEqual(f.toolJournalBefore.approvals, [], "No saved or approved replay is invented to expose these navigation controls");
  const definitions = [
    ["forma-product-evaluation", "src/apps/product/evaluation.ts", "FormaProductEvaluation"],
    ["forma-synthetic-replay", "src/apps/product/synthetic-replay.ts", "FormaSyntheticReplay"],
    ["forma-product-adapter-preview", "src/apps/product/adapter-preview.ts", "FormaProductAdapterPreview"],
    ["forma-actual-replay", "src/apps/product/actual-replay.ts", "FormaActualReplay"],
  ];
  for (const [tag, file, name] of definitions) {
    const module = await ports.loadActual(file); assert.equal(typeof module[name], "function");
    f.renderer.registry[tag] = module[name];
  }
  const previous = globalThis.fetch;
  const transport = async (input, init = {}) => {
    const url = new URL(String(input), "https://fixture.invalid");
    assert.equal(url.origin, "https://fixture.invalid");
    assert.equal(init.method ?? "GET", "GET", "These direct-caller cases authorize no turn, simulation, approval, persona or provider operation");
    assert.equal(init.body, undefined);
    if (!["/api/portfolio/product/evaluation", "/api/replay-sessions"].includes(url.pathname)) return previous(input, init);
    assert.equal(url.search, ""); assert.equal(init.credentials, "same-origin");
    const read = { url: url.pathname, method: "GET", body: null, init, origin: platformToolRoute(f) };
    f.calls.push({ url: read.url, method: read.method, body: null }); f.toolReads.push(read);
    const response = await f.storeHost.worker.request(read.url, init);
    assert.equal(response.status, 200, "The unchanged RAM Worker admits the current real Product read");
    const payload = await response.clone().json(); assert.equal(response.bodyUsed, false);
    if (read.url === "/api/replay-sessions") {
      assert.deepEqual(payload.sessions, []); assert.equal(typeof payload.liveGeneration?.enabled, "boolean");
      assert.equal(typeof payload.liveGeneration?.configured, "boolean");
    } else { assert.ok(payload.report && Array.isArray(payload.report.evidence) && Array.isArray(payload.report.metrics)); }
    read.response = response; return response; // Exact original Response, not a synthetic ready report.
  };
  globalThis.fetch = transport; restore = () => { if (globalThis.fetch === transport) globalThis.fetch = previous; };
  const initialAssistant = f.assistant, initialPanel = f.panel;
  // Clean fixture-origin setup only: the existing native Location setter and
  // actual registered Shell popstate/load run before any Assistant input.
  // Synthetic Replay is not a task-strip row; no synthetic task is dispatched.
  history.pushState({}, "", spec.origin);
  ports.windowPort.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  await reached(f, () => platformToolReady(f, spec.origin, spec.originTag), "the actual requested Product origin and its original report are ready");
  f.toolOrigin = platformToolOwner(f, spec.originTag);
  assert.equal(currentDelivery(f), null); assert.equal(f.deliveryOwner.isConnected, false);
  assert.equal(initialAssistant.isConnected, false); assert.equal(initialPanel.isConnected, false);
  const assistants = [...f.renderer.instances.values()].map(row => row.instance)
    .filter(owner => owner.tag === "forma-platform-assistant" && owner.isConnected && owner.parentElement === f.host);
  assert.equal(assistants.length, 1); f.assistant = assistants[0];
  const panels = [...f.renderer.instances.values()].map(row => row.instance)
    .filter(owner => owner.tag === "forma-assistant-panel" && owner.isConnected && owner.parentElement === f.assistant);
  assert.equal(panels.length, 1); f.panel = panels[0];
  assert.ok(f.assistant instanceof f.renderer.registry["forma-platform-assistant"]);
  assert.ok(f.panel instanceof f.renderer.registry["forma-assistant-panel"]);
  assert.equal(f.assistant.route, spec.origin); assert.equal(currentPanel(f).open, false);
  assert.equal(f.panel.guidanceOnly, true); assert.equal(f.platformSession.get().user.role, "admin");
  for (const capability of ["evaluation.synthetic.read", "evaluation.qualification.read", "evaluation.actual.run"])
    assert.ok(f.platformSession.get().capabilities.includes(capability), "actual current Product authority: " + capability);
  assert.equal(f.assistantCalls.length, 0, "clean origin setup has not opened or sent an Assistant turn");
  assertCore(f); assert.deepEqual(platformToolJournal(f), f.toolJournalBefore); return f;
}

function platformToolAnchor(f) {
  f.draw(); const spec = f.toolSpec, owner = platformToolOwner(f, spec.originTag), tree = f.tree();
  assert.equal(owner, f.toolOrigin); assert.equal(platformToolRoute(f), spec.origin);
  const anchors = tree.visible("a").filter(node => node.owner === owner && node.attributes.href === spec.target);
  assert.equal(anchors.length, 1); const anchor = anchors[0];
  const containers = tree.visible(spec.originTag === "forma-product-evaluation" ? "nav" : "section")
    .filter(node => node.owner === owner && classed(node, spec.originTag === "forma-product-evaluation" ? "evaluation-tools" : "synthetic-replay")
      && inside(anchor, node));
  assert.equal(containers.length, 1); assert.equal(anchor.text, f.i18n.t(spec.label));
  assert.ok(anchor.port.isConnected && f.renderer.nodes.includes(anchor.port));
  assert.equal(Object.hasOwn(anchor.attributes, "disabled"), false); assert.equal(anchor.attributes.target, undefined);
  assert.equal(anchor.attributes.download, undefined); return anchor;
}

async function activatePlatformTool(f, modified = false) {
  const row = platformToolAnchor(f); gesture(f, row.port);
  const event = { type: "click", target: row.port, currentTarget: row.port, button: 0,
    metaKey: modified, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
    composedPath: () => [row.port, row.owner, row.owner.parentElement, f.host, ports.documentPort] };
  if (row.handlers.click) row.handlers.click.call(row.owner, event);
  if (!event.defaultPrevented) {
    if (modified) f.toolNewTabs.push(row.attributes.href);
    else f.toolNativeRequests.push(row.attributes.href);
  }
  await f.flush(); return event;
}

async function platformToolArrived(t, f, event, readsBefore) {
  const spec = f.toolSpec;
  if (!event.defaultPrevented) {
    assert.deepEqual(f.toolNativeRequests, [spec.target]); assert.equal(platformToolRoute(f), spec.origin);
    assert.equal(platformToolOwner(f, spec.originTag), f.toolOrigin); assert.equal(f.calls.length, readsBefore);
    t.diagnostic("PLATFORM_TOOL_LINK_HEALTHY " + JSON.stringify({ id: spec.id, mode: "exact-native-hard-navigation-request",
      target: spec.target, destinationMounted: false }));
    return; // Native hard navigation observation, not proof of the new document or unload.
  }
  assert.deepEqual(f.toolNativeRequests, []);
  await reached(f, () => platformToolReady(f, spec.target, spec.targetTag), "the admitted same-app link reaches its actual target leaf");
  const target = platformToolOwner(f, spec.targetTag);
  assert.notEqual(target, f.toolOrigin); assert.equal(f.toolOrigin.isConnected, false);
  assert.equal(f.assistant.isConnected, false); assert.equal(f.panel.isConnected, false);
  assert.equal(f.nativeHistoryLocation.hash, "");
  t.diagnostic("PLATFORM_TOOL_LINK_HEALTHY " + JSON.stringify({ id: spec.id, mode: "admitted-current-Product-leaf",
    target: spec.target, destinationMounted: true, additionalReads: f.calls.length - readsBefore }));
}

for (const spec of platformToolLinks) {
  test("actual Platform tool link clean departure / " + spec.id + " / " + spec.locale, options, async t => {
    const f = await platformToolPage(t, spec); await open(f); await close(f);
    const rows = dedicated(f); assert.deepEqual(rows, { events: [], content: [], commits: [] });
    assert.equal(f.panel.commandDepartureBlocked, false); const reads = f.calls.length;
    const event = await activatePlatformTool(f); await platformToolArrived(t, f, event, reads); platformToolEffects(f, rows);
  });

  test("actual Platform tool link collapsed raw refuses then explicit clear departs / " + spec.id + " / " + spec.locale, options, async t => {
    const f = await platformToolPage(t, spec), raw = "  Unsent tool question 文書\nنور  ";
    await open(f); await type(f, raw); assert.equal(f.panel.commandDepartureBlocked, true); await close(f);
    const rows = dedicated(f); assert.deepEqual(rows, { events: [], content: [], commits: [] });
    const reads = f.calls.length, populations = f.populations.length;
    const modified = await activatePlatformTool(f, true); assert.equal(modified.defaultPrevented, false);
    assert.deepEqual(f.toolNewTabs, [spec.target]); assert.deepEqual(f.toolNativeRequests, []);
    assert.equal(platformToolRoute(f), spec.origin); assert.equal(f.calls.length, reads); assert.equal(f.populations.length, populations);
    assert.equal(platformToolOwner(f, spec.originTag), f.toolOrigin); assert.equal(currentPanel(f).open, false);
    const event = await activatePlatformTool(f); platformToolEffects(f, rows);
    t.diagnostic("PLATFORM_TOOL_LINK_RAW " + JSON.stringify({ id: spec.id, defaultPrevented: event.defaultPrevented,
      nativeRequests: f.toolNativeRequests, path: platformToolRoute(f), originalLeafConnected: f.toolOrigin.isConnected,
      originalAssistantConnected: f.assistant.isConnected, additionalReads: f.calls.length - reads }));
    assert.deepEqual(f.toolNativeRequests, [], "An unmodified current link may not request a new document while its actual Assistant retains raw work");
    assert.equal(event.defaultPrevented, true); assert.equal(platformToolRoute(f), spec.origin);
    assert.equal(f.calls.length, reads); assert.equal(f.populations.length, populations);
    assert.equal(platformToolOwner(f, spec.originTag), f.toolOrigin); assert.equal(currentPanel(f).open, false);
    assert.ok(f.assistant.isConnected && f.assistant.parentElement === f.host); assert.equal(f.panel.commandDepartureBlocked, true);
    const notices = f.tree().visible("p").filter(node => node.owner === f.host && classed(node, "platform-departure-notice"));
    assert.equal(notices.length, 1); assert.equal(notices[0].attributes.role, "status");
    assert.equal(notices[0].text, f.i18n.t("next.lifecycle.assistantOwnsWork"));
    await open(f); assert.equal(composer(f).field.port.value, raw); await type(f, ""); await close(f);
    assert.equal(f.panel.commandDepartureBlocked, false); const clearReads = f.calls.length;
    const fresh = await activatePlatformTool(f); await platformToolArrived(t, f, fresh, clearReads); platformToolEffects(f, rows);
  });
}

// C167 additive Knowledge caller pair. Reuse the complete Platform/Assistant
// fixture above, the actual Knowledge/Lab classes and original RAM responses.
// The existing module-delivery port is finite. Static diagnostic images retain
// that Worker's original unavailable-asset response; pixel analysis is not a gate.
const knowledgeFocalOrigin = "/knowledge/patterns";
const knowledgeFocalTarget = "/knowledge/focal-points";
const knowledgeFocalRoute = f => f.nativeHistoryLocation.pathname + f.nativeHistoryLocation.search;
function knowledgeFocalOwner(f, tag) {
  const rows = [...f.renderer.instances.values()].map(row => row.instance)
    .filter(owner => owner.tag === tag && owner.isConnected);
  assert.equal(rows.length, 1, "one actual current Knowledge owner: " + tag);
  const owner = rows[0]; assert.ok(owner instanceof f.renderer.registry[tag]);
  const application = tag === "forma-knowledge-application" ? owner : owner.parentElement;
  assert.equal(application.tag, "forma-knowledge-application"); assert.equal(application.parentElement, f.host);
  assert.equal(owner.closest("forma-platform-shell"), f.host); return owner;
}
function knowledgeFocalReady(f, path) {
  if (knowledgeFocalRoute(f) !== path || f.platformSession.get()?.audience !== "knowledge") return false;
  const tree = f.tree(), main = tree.visible("main").filter(node => node.owner === f.host
    && node.attributes.id === "main-content" && node.attributes["aria-busy"] === "false");
  if (main.length !== 1) return false;
  const tag = path === knowledgeFocalOrigin ? "forma-design-system-lab" : "forma-focal-point-lab";
  return tree.visible("h1").some(node => node.owner.tag === tag && node.owner.isConnected && inside(node, main[0])
    && node.text === f.i18n.t(path === knowledgeFocalOrigin ? "knowledge.patternsHeading" : "knowledge.focal.heading"));
}
async function knowledgeFocalPage(t, locale, reverse = false) {
  let restore = () => {}, f;
  t.after(async () => {
    if (f?.knowledgeReads) {
      await untilScene(() => f.knowledgeReads.every(row => row.settled), "original Knowledge reads settle before the inherited Worker closes");
      await f.storeHost.worker.drainBackground();
    }
    restore();
  });
  f = await page(t, locale); const productSession = f.initialSession;
  f.knowledgeSpec = reverse
    ? { origin: knowledgeFocalTarget, target: knowledgeFocalOrigin, originTag: "forma-focal-point-lab", targetTag: "forma-design-system-lab", label: "knowledge.focal.return" }
    : { origin: knowledgeFocalOrigin, target: knowledgeFocalTarget, originTag: "forma-design-system-lab", targetTag: "forma-focal-point-lab", label: "knowledge.focal.open" };
  const beforeApplication = f.assistant, beforePanel = f.panel;
  for (const [tag, path, name] of [
    ["forma-knowledge-application", "src/apps/knowledge/entry.ts", "FormaKnowledgeApplication"],
    ["forma-design-system-lab", "src/components/forma-design-system-lab.ts", "FormaDesignSystemLab"],
    ["forma-focal-point-lab", "src/components/forma-focal-point-lab.ts", "FormaFocalPointLab"],
    ["forma-ui-badge", "src/components/design-primitives.ts", "FormaUiBadge"],
  ]) {
    const module = await ports.loadActual(path); assert.equal(typeof module[name], "function");
    f.renderer.registry[tag] = module[name];
  }
  f.knowledgeReads = []; f.knowledgeNativeRequests = []; f.knowledgeNewTabs = [];
  f.knowledgeJournal = platformToolJournal(f);
  const previous = globalThis.fetch;
  const transport = async (input, init = {}) => {
    const url = new URL(String(input), "https://fixture.invalid");
    assert.equal(url.origin, "https://fixture.invalid"); assert.equal(init.method ?? "GET", "GET");
    assert.equal(init.body, undefined, "Knowledge navigation never sends a turn, write, approval or provider request");
    const sessionRead = url.pathname === "/api/session" && url.search === "?audience=knowledge";
    const contextRead = url.pathname === "/api/platform/assistant";
    const assetRead = /^\/focal-point-lab\/children-in-park-0[123]\.png$/u.test(url.pathname) && url.search === "";
    assert.ok(sessionRead || contextRead || assetRead, "only exact original Knowledge session/context and local diagnostic-asset reads");
    const row = { url: url.pathname + url.search, method: "GET", body: null, init, settled: false };
    f.calls.push({ url: row.url, method: row.method, body: null }); f.knowledgeReads.push(row);
    if (contextRead) {
      assert.deepEqual([...url.searchParams], [["route", f.knowledgeSpec.origin]]);
      const headers = new Headers(init.headers);
      assert.equal(headers.get("x-forma-assistant-audience"), "knowledge");
      assert.equal(headers.get("x-forma-platform-permission-epoch"), f.platformSession.get().permissionEpoch);
      assert.equal(headers.get("accept"), "application/json"); f.assistantCalls.push(row);
    }
    try {
      const response = await f.storeHost.worker.request(row.url, init); row.response = response;
      if (assetRead) {
        assert.equal(knowledgeFocalRoute(f), knowledgeFocalTarget, "only the actual Focal leaf requests these local assets");
        assert.equal(response.status, 404, "the existing RAM asset binding is unavailable; no image-success envelope is substituted");
      } else {
        assert.equal(response.status, 200, "the original RAM Worker admits this exact Knowledge read");
        const payload = await response.clone().json(); assert.equal(response.bodyUsed, false); row.payload = payload;
        if (sessionRead) {
          assert.equal(payload.audience, "knowledge"); assert.equal(payload.user.userId, productSession.user.userId);
          assert.equal(payload.user.role, "admin"); assert.ok(payload.capabilities.includes("design.catalog.read"));
          assert.equal(payload.assistant?.enabled, true); assert.equal(payload.assistant.host, "platform");
        } else {
          assert.equal(payload.context.scope.actorUserId, f.initialSession.user.userId);
          assert.equal(payload.context.scope.projectId, null); assert.equal(payload.context.scope.documentId, null);
          assert.equal(payload.context.surface.canonicalFamily, f.knowledgeSpec.origin); assert.deepEqual(payload.turns, []);
          f.completedContextReads += 1; f.lastContext = payload;
        }
      }
      return response; // Exact original response; no synthetic session, grant, GET body or ACK.
    } finally { row.settled = true; }
  };
  globalThis.fetch = transport; restore = () => { if (globalThis.fetch === transport) globalThis.fetch = previous; };
  // Pristine initial-origin setup only. Existing finite native History delivers
  // popstate to the real Shell; session adoption stays its real asynchronous load.
  history.pushState({}, "", f.knowledgeSpec.origin);
  ports.windowPort.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  await reached(f, () => knowledgeFocalReady(f, f.knowledgeSpec.origin), "the actual authorized Knowledge origin is ready");
  assert.equal(beforeApplication.isConnected, false); assert.equal(beforePanel.isConnected, false);
  assert.equal(currentDelivery(f), null); assert.equal(f.deliveryOwner.isConnected, false);
  f.knowledgeApplication = knowledgeFocalOwner(f, "forma-knowledge-application");
  f.knowledgeLab = knowledgeFocalOwner(f, f.knowledgeSpec.originTag);
  if (!reverse) assert.equal(f.knowledgeLab.view, "patterns");
  f.knowledgeLinkOwner = reverse ? f.knowledgeLab : f.knowledgeApplication;
  const assistants = [...f.renderer.instances.values()].map(row => row.instance)
    .filter(owner => owner.tag === "forma-platform-assistant" && owner.isConnected && owner.parentElement === f.host);
  assert.equal(assistants.length, 1); f.assistant = assistants[0];
  const panels = [...f.renderer.instances.values()].map(row => row.instance)
    .filter(owner => owner.tag === "forma-assistant-panel" && owner.isConnected && owner.parentElement === f.assistant);
  assert.equal(panels.length, 1); f.panel = panels[0]; assert.equal(currentPanel(f).open, false);
  assert.equal(f.assistant.route, f.knowledgeSpec.origin); assert.equal(f.panel.guidanceOnly, true);
  const sessions = f.knowledgeReads.filter(row => row.url === "/api/session?audience=knowledge");
  assert.equal(sessions.length, 1); assert.equal(sessions[0].response.bodyUsed, true);
  f.initialSession = f.platformSession.get(); assert.deepEqual(f.initialSession, sessions[0].payload);
  assert.equal(f.assistantCalls.length, 0); assertCore(f); return f;
}
function knowledgeFocalAnchor(f) {
  f.draw(); const owner = knowledgeFocalOwner(f, f.knowledgeLinkOwner.tag), tree = f.tree();
  assert.equal(owner, f.knowledgeLinkOwner); assert.equal(knowledgeFocalRoute(f), f.knowledgeSpec.origin);
  const rows = tree.visible("a").filter(node => node.owner === owner && node.attributes.href === f.knowledgeSpec.target);
  assert.equal(rows.length, 1); const row = rows[0];
  const reverse = f.knowledgeSpec.origin === knowledgeFocalTarget;
  const sections = tree.visible(reverse ? "header" : "section").filter(node => node.owner === owner
    && (reverse ? classed(node, "page-header") : node.attributes["aria-labelledby"] === "knowledge-focal-link-heading") && inside(row, node));
  assert.equal(sections.length, 1); assert.equal(row.text, f.i18n.t(f.knowledgeSpec.label));
  assert.ok(row.port.isConnected && f.renderer.nodes.includes(row.port));
  assert.equal(row.attributes.target, undefined); assert.equal(row.attributes.download, undefined);
  assert.ok(f.platformSession.get().capabilities.includes("design.catalog.read")); return row;
}
async function activateKnowledgeFocal(f, { modified = false, prevented = false } = {}) {
  const row = knowledgeFocalAnchor(f); gesture(f, row.port);
  const event = { type: "click", target: row.port, currentTarget: row.port, button: 0,
    metaKey: modified, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: prevented,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
    composedPath: () => [row.port, row.owner, row.owner.parentElement, f.host, ports.documentPort] };
  // Invoke only this current emitted native anchor's actual EventPart, matching
  // the established Product link port above. No application method is replaced.
  row.handlers.click?.call(row.owner, event);
  if (!event.defaultPrevented) (modified ? f.knowledgeNewTabs : f.knowledgeNativeRequests).push(row.attributes.href);
  await f.flush(); return event;
}
function knowledgeFocalEffects(f, rows) {
  assertCore(f); assert.deepEqual(platformToolJournal(f), f.knowledgeJournal);
  assert.deepEqual(dedicated(f), rows, "No Platform private message, event or commit is created");
  assert.equal(f.originalTurn, null); assert.ok(f.calls.every(row => row.method === "GET"));
  assert.ok(f.assistantCalls.every(row => row.method === "GET")); assert.equal(f.formResets, 0);
}
async function knowledgeFocalArrived(t, f, event, readsBefore) {
  if (!event.defaultPrevented) {
    assert.deepEqual(f.knowledgeNativeRequests, [f.knowledgeSpec.target]);
    assert.equal(knowledgeFocalRoute(f), f.knowledgeSpec.origin);
    assert.ok(f.calls.slice(readsBefore).every(row => row.url.startsWith("/focal-point-lab/")), "only the existing origin can retry its unavailable local images");
    assert.equal(knowledgeFocalOwner(f, "forma-knowledge-application"), f.knowledgeApplication);
    t.diagnostic("KNOWLEDGE_FOCAL_CLEAN " + JSON.stringify({ mode: "exact-native-hard-navigation-request", target: f.knowledgeSpec.target,
      destinationMounted: false }));
    await untilScene(() => f.knowledgeReads.every(row => row.settled), "the original visible leaf finishes its finite reads"); return;
  }
  assert.deepEqual(f.knowledgeNativeRequests, []);
  await reached(f, () => knowledgeFocalReady(f, f.knowledgeSpec.target), "the admitted link reaches the real current destination heading");
  const leaf = knowledgeFocalOwner(f, f.knowledgeSpec.targetTag); assert.ok(leaf.isConnected);
  assert.equal(f.knowledgeLab.isConnected, false); assert.equal(f.assistant.isConnected, false); assert.equal(f.panel.isConnected, false);
  await untilScene(() => f.knowledgeReads.every(row => row.settled), "all original Knowledge reads finish before fixture cleanup");
  assert.equal(f.nativeHistoryLocation.hash, "");
  t.diagnostic("KNOWLEDGE_FOCAL_CLEAN " + JSON.stringify({ mode: "admitted-current-Knowledge-leaf", target: f.knowledgeSpec.target,
    destinationMounted: true, pixelAnalysis: "unavailable-original-RAM-assets", additionalReads: f.calls.length - readsBefore }));
}

test("C Knowledge Focal native link / clean Assistant permits its exact authorized destination", options, async t => {
  const f = await knowledgeFocalPage(t, "en"); await open(f); await close(f);
  const rows = dedicated(f); assert.deepEqual(rows, { events: [], content: [], commits: [] });
  assert.equal(f.panel.commandDepartureBlocked, false); const reads = f.calls.length;
  const event = await activateKnowledgeFocal(f); await knowledgeFocalArrived(t, f, event, reads); knowledgeFocalEffects(f, rows);
});

test("C Knowledge Focal native link / collapsed raw is retained until native reopen-clear and fresh departure", options, async t => {
  const f = await knowledgeFocalPage(t, "ja"), raw = "  Unsent Knowledge question 文書\nنور  ";
  await open(f); await type(f, raw); assert.equal(f.panel.commandDepartureBlocked, true); await close(f);
  const rows = dedicated(f), reads = f.calls.length, populations = f.populations.length;
  assert.deepEqual(rows, { events: [], content: [], commits: [] });
  const modified = await activateKnowledgeFocal(f, { modified: true }); assert.equal(modified.defaultPrevented, false);
  assert.deepEqual(f.knowledgeNewTabs, [knowledgeFocalTarget]); assert.deepEqual(f.knowledgeNativeRequests, []);
  const prevented = await activateKnowledgeFocal(f, { prevented: true }); assert.equal(prevented.defaultPrevented, true);
  assert.deepEqual(f.knowledgeNativeRequests, []); assert.equal(knowledgeFocalRoute(f), knowledgeFocalOrigin);
  assert.equal(f.calls.length, reads); assert.equal(f.populations.length, populations);
  const event = await activateKnowledgeFocal(f); knowledgeFocalEffects(f, rows);
  t.diagnostic("KNOWLEDGE_FOCAL_RAW " + JSON.stringify({ defaultPrevented: event.defaultPrevented,
    nativeRequests: f.knowledgeNativeRequests, path: knowledgeFocalRoute(f), originalAssistantConnected: f.assistant.isConnected,
    originalApplicationConnected: f.knowledgeApplication.isConnected, additionalReads: f.calls.length - reads }));
  assert.deepEqual(f.knowledgeNativeRequests, [], "An ordinary link must not request another document while its current Assistant retains unsent work");
  assert.equal(event.defaultPrevented, true); assert.equal(knowledgeFocalRoute(f), knowledgeFocalOrigin);
  assert.equal(f.calls.length, reads); assert.equal(f.populations.length, populations);
  assert.equal(knowledgeFocalOwner(f, "forma-knowledge-application"), f.knowledgeApplication);
  assert.equal(currentPanel(f).open, false); assert.equal(f.panel.commandDepartureBlocked, true);
  const notices = f.tree().visible("p").filter(node => node.owner === f.host && classed(node, "platform-departure-notice"));
  assert.equal(notices.length, 1); assert.equal(notices[0].attributes.role, "status");
  assert.equal(notices[0].text, f.i18n.t("next.lifecycle.assistantOwnsWork"));
  await open(f); assert.equal(composer(f).field.port.value, raw); await type(f, ""); await close(f);
  assert.equal(f.panel.commandDepartureBlocked, false); const clearReads = f.calls.length;
  const fresh = await activateKnowledgeFocal(f); await knowledgeFocalArrived(t, f, fresh, clearReads); knowledgeFocalEffects(f, rows);
});


test("C Knowledge Return native link / clean Assistant permits the exact Patterns destination", options, async t => {
  const f = await knowledgeFocalPage(t, "en", true); await open(f); await close(f);
  const rows = dedicated(f); assert.deepEqual(rows, { events: [], content: [], commits: [] });
  assert.equal(f.panel.commandDepartureBlocked, false); const reads = f.calls.length;
  const event = await activateKnowledgeFocal(f); await knowledgeFocalArrived(t, f, event, reads); knowledgeFocalEffects(f, rows);
});

test("C Knowledge Return native link / collapsed raw is retained until native reopen-clear and fresh departure", options, async t => {
  const f = await knowledgeFocalPage(t, "ja", true), raw = "  Unsent return question 文書\nنور  ";
  await open(f); await type(f, raw); assert.equal(f.panel.commandDepartureBlocked, true); await close(f);
  const rows = dedicated(f), populations = f.populations.length;
  assert.deepEqual(rows, { events: [], content: [], commits: [] });
  const before = f.knowledgeReads.filter(row => !row.url.startsWith("/focal-point-lab/"));
  const modified = await activateKnowledgeFocal(f, { modified: true }); assert.equal(modified.defaultPrevented, false);
  assert.deepEqual(f.knowledgeNewTabs, [knowledgeFocalOrigin]); assert.deepEqual(f.knowledgeNativeRequests, []);
  const prevented = await activateKnowledgeFocal(f, { prevented: true }); assert.equal(prevented.defaultPrevented, true);
  assert.deepEqual(f.knowledgeNativeRequests, []); assert.equal(knowledgeFocalRoute(f), knowledgeFocalTarget);
  const event = await activateKnowledgeFocal(f); knowledgeFocalEffects(f, rows);
  t.diagnostic("KNOWLEDGE_RETURN_RAW " + JSON.stringify({ defaultPrevented: event.defaultPrevented,
    nativeRequests: f.knowledgeNativeRequests, path: knowledgeFocalRoute(f), originalAssistantConnected: f.assistant.isConnected,
    originalApplicationConnected: f.knowledgeApplication.isConnected }));
  assert.deepEqual(f.knowledgeNativeRequests, [], "Return is an ordinary guarded link, not browser Back or permission to lose raw work");
  assert.equal(event.defaultPrevented, true); assert.equal(knowledgeFocalRoute(f), knowledgeFocalTarget);
  assert.equal(f.populations.length, populations);
  assert.deepEqual(f.knowledgeReads.filter(row => !row.url.startsWith("/focal-point-lab/")), before,
    "The raw refusal makes no new session/context read; current unavailable local assets are not navigation or permission evidence");
  assert.equal(knowledgeFocalOwner(f, "forma-knowledge-application"), f.knowledgeApplication);
  assert.equal(knowledgeFocalOwner(f, "forma-focal-point-lab"), f.knowledgeLab);
  assert.equal(currentPanel(f).open, false); assert.equal(f.panel.commandDepartureBlocked, true);
  const notices = f.tree().visible("p").filter(node => node.owner === f.host && classed(node, "platform-departure-notice"));
  assert.equal(notices.length, 1); assert.equal(notices[0].attributes.role, "status");
  assert.equal(notices[0].text, f.i18n.t("next.lifecycle.assistantOwnsWork"));
  await open(f); assert.equal(composer(f).field.port.value, raw); await type(f, ""); await close(f);
  assert.equal(f.panel.commandDepartureBlocked, false); const clearReads = f.calls.length;
  const fresh = await activateKnowledgeFocal(f); await knowledgeFocalArrived(t, f, fresh, clearReads); knowledgeFocalEffects(f, rows);
});

// C190 bounded Knowledge locale-link baseline. One top-level case, two fresh
// complete Platform hosts. This extends the existing native request journal;
// it never performs a public-page load, fabricates unload, or sends a turn.
const cKnowledgeLocaleOrigin = "/knowledge/landing-pages";
const cKnowledgeLocaleTarget = "/welcome/en";
async function cKnowledgeLocalePage(t) {
  const entryPath = "src/apps/knowledge/entry.ts";
  const hadEntry = ports.moduleCache.has(entryPath), previousEntry = ports.moduleCache.get(entryPath);
  t.after(() => {
    if (hadEntry) ports.moduleCache.set(entryPath, previousEntry); else ports.moduleCache.delete(entryPath);
  });
  // Same declared literal-module port as surface-load-focus-host's actual
  // landing profile. The original initializer, not a replacement render, sets
  // the module-local catalog function before this pristine route is mounted.
  ports.moduleCache.delete(entryPath);
  const catalog = await ports.loadActual("src/apps/knowledge/landing-pages.ts");
  const application = await ports.loadActual(entryPath, new Map([["./landing-pages", catalog]]));
  assert.equal(typeof application.loadKnowledgeRoute, "function");
  await application.loadKnowledgeRoute(cKnowledgeLocaleOrigin);
  const f = await knowledgeFocalPage(t, "ja");
  const { FormaUiCard } = await ports.loadActual("src/components/design-system/layout.ts");
  assert.equal(typeof FormaUiCard, "function"); f.renderer.registry["forma-ui-card"] = FormaUiCard;
  assert.equal(f.renderer.registry["forma-knowledge-application"], application.FormaKnowledgeApplication);
  const priorApplication = f.knowledgeApplication, priorAssistant = f.assistant, priorPanel = f.panel;
  f.knowledgeSpec = { origin: cKnowledgeLocaleOrigin, target: cKnowledgeLocaleTarget };
  // Reach the catalog through its actual clean task control. The unchanged
  // finite route-module loader is observation-only; initialization above is
  // the exact additional module prerequisite this inline leaf needs.
  f.draw();
  const tasks = f.tree().visible("a").filter(row => row.owner.tag === "forma-ui-audience-navigation"
    && row.owner.parentElement === f.host && row.attributes.href === cKnowledgeLocaleOrigin);
  assert.equal(tasks.length, 1); const task = tasks[0], owner = task.owner;
  assert.ok(task.port?.isConnected); assert.equal(typeof task.handlers.click, "function");
  if (!f.dispatchPorts.has(owner)) {
    const dispatch = owner.dispatchEvent;
    owner.dispatchEvent = function (event) {
      const result = dispatch.call(this, event); return event.cancelable && event.defaultPrevented ? false : result;
    };
    f.dispatchPorts.add(owner); // Existing cancelable CustomEvent return contract, not admission.
  }
  gesture(f, task.port);
  const taskEvent = { type: "click", target: task.port, currentTarget: task.port, button: 0,
    metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  task.handlers.click.call(owner, taskEvent); assert.equal(taskEvent.defaultPrevented, true);
  await reached(f, () => {
    const tree = f.tree(), main = tree.visible("main").find(row => row.owner === f.host
      && row.attributes.id === "main-content" && row.attributes["aria-busy"] === "false");
    return knowledgeFocalRoute(f) === cKnowledgeLocaleOrigin && main
      && tree.visible("h1").some(row => row.owner.tag === "forma-knowledge-application"
        && row.text === f.i18n.t("knowledge.landing.heading") && inside(row, main));
  }, "the actual Knowledge task renders its original initialized landing catalog");
  assert.equal(priorApplication.isConnected, false); assert.equal(priorAssistant.isConnected, false);
  assert.equal(priorPanel.isConnected, false);
  f.knowledgeApplication = knowledgeFocalOwner(f, "forma-knowledge-application");
  assert.ok(f.knowledgeApplication instanceof application.FormaKnowledgeApplication);
  const assistants = [...f.renderer.instances.values()].map(row => row.instance)
    .filter(instance => instance.tag === "forma-platform-assistant" && instance.isConnected && instance.parentElement === f.host);
  assert.equal(assistants.length, 1); f.assistant = assistants[0];
  const panels = [...f.renderer.instances.values()].map(row => row.instance)
    .filter(instance => instance.tag === "forma-assistant-panel" && instance.isConnected && instance.parentElement === f.assistant);
  assert.equal(panels.length, 1); f.panel = panels[0];
  assert.equal(currentPanel(f).open, false); assert.equal(f.assistant.route, cKnowledgeLocaleOrigin);
  assert.equal(f.platformSession.get(), f.initialSession); assert.equal(f.assistantCalls.length, 0);
  f.localeDefaults = []; f.localeAssignments = [];
  f.nativeLocationAssign = path => {
    assert.equal(path, cKnowledgeLocaleTarget, "only the exact public locale destination may be requested by this action");
    f.localeAssignments.push(path); // Actual PlatformShell location.assign, still no browser unload.
  };
  assertCore(f); return f;
}
function cKnowledgeLocaleAnchor(f, kind = "locale") {
  f.draw(); const tree = f.tree(), application = knowledgeFocalOwner(f, "forma-knowledge-application");
  assert.equal(application, f.knowledgeApplication); assert.equal(knowledgeFocalRoute(f), cKnowledgeLocaleOrigin);
  const cards = tree.visible("forma-ui-card").filter(row => row.owner === application && row.properties.value === "generic");
  assert.equal(cards.length, 1); const card = cards[0];
  assert.ok(card.component?.isConnected && card.component.parentElement === application);
  assert.ok(card.component instanceof f.renderer.registry["forma-ui-card"]);
  const headings = tree.visible("h2").filter(row => row.attributes.id === "knowledge-landing-overview" && inside(row, card));
  assert.equal(headings.length, 1); assert.equal(headings[0].text, "The Quiet Coast");
  const navs = tree.visible("nav").filter(row => classed(row, "knowledge-landing-pages__locales") && inside(row, card));
  assert.equal(navs.length, 1); assert.equal(navs[0].attributes["aria-labelledby"], headings[0].attributes.id);
  const rows = tree.visible("a").filter(row => inside(row, card) && (kind === "locale"
    ? inside(row, navs[0]) && row.attributes.href === cKnowledgeLocaleTarget && row.attributes.lang === "en"
    : row.attributes.target === "_blank" && classed(row, "button")));
  assert.equal(rows.length, 1); const row = rows[0];
  assert.equal(row.attributes.download, undefined); assert.equal(Object.hasOwn(row.attributes, "disabled"), false);
  if (kind === "locale") {
    assert.equal(row.attributes.target, undefined); assert.equal(row.attributes.dir, "ltr");
    assert.equal(row.text, "English"); assert.equal(row.attributes["aria-current"], undefined);
  } else {
    assert.equal(row.attributes.href, "/welcome/ja"); assert.equal(row.attributes.rel, "noopener");
    assert.equal(row.attributes["aria-describedby"], "knowledge-landing-overview-new-tab");
  }
  // Card uses real shadow slots. The finite fullPageTree does not model slot
  // distribution and may label authored children as Card-owned. Read the
  // ORIGINAL emitted native author record, without changing any tree, parent,
  // focus, handler, visibility or admission method.
  const nativeRows = f.renderer.ownNodes(application, "a").filter(node =>
    Object.keys(node.attributes).length === Object.keys(row.attributes).length
    && Object.entries(row.attributes).every(([key, value]) => node.attributes[key] === value)
    && Object.keys(node.handlers).length === Object.keys(row.handlers).length
    && Object.entries(row.handlers).every(([key, value]) => node.handlers[key] === value));
  assert.equal(nativeRows.length, 1, "one exact current Knowledge-authored native anchor matches this emitted slot position");
  const port = nativeRows[0];
  const token = port.full.match(/\shref=(?:"|')?__bound_(\d+)__(?:"|')?(?=[\s>])/u);
  assert.ok(token, "the original authored href binding is present");
  const binding = f.renderer.bindings[Number(token[1])];
  assert.equal(binding.owner, application); assert.equal(binding.value, row.attributes.href);
  assert.equal(typeof binding.part, "string"); assert.ok(binding.part.length);
  assert.ok(port.isConnected && f.renderer.nodes.includes(port)); assert.equal(port.owner, application);
  assert.equal(Object.getPrototypeOf(port) === ports.ElementPort.prototype, true);
  assert.equal(port.parentElement === application, true, "The literal port keeps its original renderer-authored parent");
  assert.equal(application.parentElement === f.host && f.host.contains(port), true);
  if (kind === "locale") {
    const clickToken = port.full.match(/\s@click=(?:"|')?__bound_(\d+)__(?:"|')?(?=[\s>])/u);
    assert.ok(clickToken, "the actual current locale click EventPart is emitted");
    const click = f.renderer.bindings[Number(clickToken[1])];
    assert.equal(click.owner, application); assert.equal(click.value, port.handlers.click);
    assert.equal(typeof click.value, "function"); assert.equal(typeof click.part, "string"); assert.ok(click.part.length);
  }
  assert.equal(ports.ElementPort.prototype.closest.call(port, "forma-knowledge-application") === application, true,
    "The existing native component walk sees the original Knowledge ancestor");
  port.closest = ports.ElementPort.prototype.closest;
  assert.equal(port.closest("forma-knowledge-application") === application, true,
    "The same current literal anchor must expose that actual native ancestor");
  assert.equal(port.closest("forma-platform-shell") === f.host, true);
  assert.equal(port.closest("forma-platform-assistant"), null, "A sibling cannot become a native ancestor");
  assert.equal(port.closest("forma-product-application"), null, "The retired Product owner is not an ancestor");
  // This finite target-only delivery is honest only while no emitted ancestor
  // owns a click callback. A future delegated implementation needs its actual
  // ancestry delivery prerequisite, never an invented successful target call.
  for (let parent = row.parent; parent; parent = parent.parent)
    assert.equal(parent.handlers?.click, undefined, "no ancestor click EventPart is omitted");
  assert.equal(port.listeners?.click, undefined, "no imperative target click listener is omitted");
  return { row, port, application };
}
async function cActivateKnowledgeLocale(f, { kind = "locale", modified = false, prevented = false } = {}) {
  const { row, port, application } = cKnowledgeLocaleAnchor(f, kind); gesture(f, port);
  const event = { type: "click", target: port, currentTarget: port, button: 0,
    metaKey: modified, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: prevented,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  if (port.handlers.click) {
    assert.equal(typeof port.handlers.click, "function"); port.handlers.click.call(application, event);
  }
  if (!event.defaultPrevented) f.localeDefaults.push({ href: row.attributes.href,
    disposition: modified || row.attributes.target === "_blank" ? "new-context" : "same-context" });
  // This is the existing finite anchor-default observation. Do not call
  // history/location, dispatch a fake navigation, or mount a public destination.
  await f.flush(); return event;
}
function cKnowledgeLocaleEffects(f, rows) {
  knowledgeFocalEffects(f, rows); assert.equal(f.calls.some(row => row.method !== "GET"), false);
  assert.equal(f.knowledgeReads.some(row => !["/api/session?audience=knowledge",
    "/api/platform/assistant?route=%2Fknowledge%2Flanding-pages"].includes(row.url)), false);
  assert.ok(f.knowledgeReads.every(row => row.settled && row.response?.bodyUsed));
}
function cKnowledgeLocaleRequested(t, f, event, reads, populations) {
  assert.equal(knowledgeFocalRoute(f), cKnowledgeLocaleOrigin);
  assert.equal(f.calls.length, reads); assert.equal(f.populations.length, populations);
  assert.equal(knowledgeFocalOwner(f, "forma-knowledge-application"), f.knowledgeApplication);
  if (event.defaultPrevented) {
    assert.deepEqual(f.localeDefaults.filter(row => row.disposition === "same-context"), []);
    assert.deepEqual(f.localeAssignments, [cKnowledgeLocaleTarget]);
  } else {
    assert.deepEqual(f.localeDefaults.filter(row => row.disposition === "same-context"),
      [{ href: cKnowledgeLocaleTarget, disposition: "same-context" }]);
    assert.deepEqual(f.localeAssignments, []);
  }
  t.diagnostic("KNOWLEDGE_LOCALE_CLEAN " + JSON.stringify({ target: cKnowledgeLocaleTarget,
    mode: event.defaultPrevented ? "actual-PlatformShell-location-request" : "native-anchor-default-request",
    destinationMounted: false, publicFetch: false, physicalUnload: false }));
}

test("C Knowledge locale link / clean request and collapsed raw refusal until explicit clear use the same public destination", options, async t => {
  // A recorded clean hard-navigation request is not a real retained page.
  // Use a fresh complete host for the raw branch, not fabricated return/history.
  for (const phase of ["clean", "raw"]) {
    const cleanups = [], fixtureTest = { after(callback) { cleanups.push(callback); }, diagnostic(value) { t.diagnostic(value); } };
    try {
      const f = await cKnowledgeLocalePage(fixtureTest); await open(f);
      const rows = dedicated(f); assert.deepEqual(rows, { events: [], content: [], commits: [] });
      if (phase === "clean") {
        assert.equal(composer(f).field.port.value, ""); await close(f);
        assert.equal(f.panel.commandDepartureBlocked, false);
        const reads = f.calls.length, populations = f.populations.length;
        const event = await cActivateKnowledgeLocale(f);
        cKnowledgeLocaleRequested(t, f, event, reads, populations); cKnowledgeLocaleEffects(f, rows);
        continue;
      }
      const raw = "  Unsent locale question 文書\nنور  ";
      await type(f, raw); assert.equal(f.panel.commandDepartureBlocked, true); await close(f);
      const reads = f.calls.length, populations = f.populations.length;
      const modified = await cActivateKnowledgeLocale(f, { modified: true }); assert.equal(modified.defaultPrevented, false);
      const blank = await cActivateKnowledgeLocale(f, { kind: "blank" }); assert.equal(blank.defaultPrevented, false);
      assert.deepEqual(f.localeDefaults, [{ href: cKnowledgeLocaleTarget, disposition: "new-context" },
        { href: "/welcome/ja", disposition: "new-context" }]);
      const prevented = await cActivateKnowledgeLocale(f, { prevented: true }); assert.equal(prevented.defaultPrevented, true);
      assert.deepEqual(f.localeAssignments, []); assert.equal(f.calls.length, reads); assert.equal(f.populations.length, populations);
      assert.equal(currentPanel(f).open, false); assert.equal(f.panel.commandDepartureBlocked, true);
      const beforeDefaults = f.localeDefaults.slice(), event = await cActivateKnowledgeLocale(f);
      cKnowledgeLocaleEffects(f, rows);
      t.diagnostic("KNOWLEDGE_LOCALE_RAW " + JSON.stringify({ defaultPrevented: event.defaultPrevented,
        defaults: f.localeDefaults, assignments: f.localeAssignments, route: knowledgeFocalRoute(f),
        originalApplicationConnected: f.knowledgeApplication.isConnected, originalAssistantConnected: f.assistant.isConnected }));
      assert.deepEqual(f.localeDefaults, beforeDefaults, "Raw work must refuse a same-tab locale departure before any native request");
      assert.deepEqual(f.localeAssignments, []); assert.equal(event.defaultPrevented, true);
      assert.equal(knowledgeFocalRoute(f), cKnowledgeLocaleOrigin); assert.equal(f.calls.length, reads);
      assert.equal(f.populations.length, populations); assert.equal(knowledgeFocalOwner(f, "forma-knowledge-application"), f.knowledgeApplication);
      assert.equal(currentPanel(f).open, false); assert.equal(f.panel.commandDepartureBlocked, true);
      const notices = f.tree().visible("p").filter(row => row.owner === f.host && classed(row, "platform-departure-notice"));
      assert.equal(notices.length, 1); assert.equal(notices[0].attributes.role, "status");
      assert.equal(notices[0].text, f.i18n.t("next.lifecycle.assistantOwnsWork"));
      await open(f); assert.equal(composer(f).field.port.value, raw); await type(f, ""); await close(f);
      assert.equal(f.panel.commandDepartureBlocked, false);
      const clearReads = f.calls.length, clearPopulations = f.populations.length;
      const fresh = await cActivateKnowledgeLocale(f);
      cKnowledgeLocaleRequested(t, f, fresh, clearReads, clearPopulations); cKnowledgeLocaleEffects(f, rows);
    } finally {
      // Same ordered cleanup contract as the reused complete fixture, before
      // the next independent host changes any global native/module port.
      for (const cleanup of cleanups) await cleanup();
    }
  }
});
