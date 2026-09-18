import nodeTest from "node:test";
import assert from "node:assert/strict";
import { confirmationFixture, deferred as fixtureDeferred, until } from "./themed-confirmation-native.mjs";
import { fullPageTree } from "./calm-full-page-fixture.mjs";

// Complete current Replay and existing native confirmation ports. Every
// command-shaped Replay/persona response is finite and local; only the original
// bootstrap session GET reaches the existing Worker fixture. Native trust,
// timing and navigation are ports, not physical activation or provider evidence.
// The root test runner must use its no-provider preload and serial execution.
let activeCallbackCase;
function deferred() {
  const gate = fixtureDeferred(), state = activeCallbackCase;
  assert.ok(state, "deferred native/HTTP ports belong to one serial test");
  state.gates.add(gate);
  const resolve = gate.resolve, reject = gate.reject;
  gate.resolve = value => { state.gates.delete(gate); resolve(value); };
  gate.reject = error => { state.gates.delete(gate); reject(error); };
  gate.promise.catch(() => {}); // cleanup rejection is still observed by original awaiters
  return gate;
}
function test(name, body) {
  return nodeTest(name, { timeout: 15_000 }, async t => {
    assert.equal(activeCallbackCase, undefined, "root runs this file serially");
    const state = { gates: new Set(), pending: new Set(), fixture: null };
    activeCallbackCase = state;
    let deadline;
    const expired = new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Finite callback case exceeded 10 seconds")), 10_000); });
    const work = Promise.resolve().then(() => body(t));
    try { await Promise.race([work, expired]); }
    finally {
      clearTimeout(deadline);
      try {
        for (const gate of [...state.gates]) gate.reject(new Error("Finite callback test is closing; unresolved fixture gate retired"));
        let cleanupDeadline;
        try {
          await Promise.race([
            Promise.allSettled([work, ...state.pending]),
            new Promise((_, reject) => { cleanupDeadline = setTimeout(() => reject(new Error("Finite callback cleanup exceeded 2 seconds")), 2_000); }),
          ]);
        } finally { clearTimeout(cleanupDeadline); }
        const f = state.fixture;
        if (f?.renderer) {
          for (const node of f.renderer.ownNodes(f.host, "dialog")) if (node.open) node.emit("cancel");
          while (f.replay.closes.length) f.replay.closes.shift()();
          f.draw();
        }
      } finally { activeCallbackCase = undefined; }
    }
  });
}

const PRIVATE = Object.freeze({ title: "B3 callback original private title", summary: "B3 callback original private summary",
  phrase: "B3_CALLBACK_FINITE_APPROVAL_ONLY", estimate: 987_654_321, seed: "B3_PRIVATE_RETRY_SEED_OLD",
  persona: "B3 original fictional persona", nextPersona: "B3 newer fictional persona" });
const DENIAL = Object.freeze({ error: "insufficient_role", required: "admin", role: "creator" });
const configuration = () => ({ enabled: true, configured: true, approvalPhrase: PRIVATE.phrase, confirmationVersion: "finite-version-no-authority",
  cost: { estimate: { authorizationMicrousd: 1_000_000, estimatedMicrousd: 500_000, operations: 1 }, fitsReplayStructure: true, fitsWorkspace: true, requiresUserOverride: false } });
const estimateBody = () => ({ cost: { ...configuration().cost, estimate: { authorizationMicrousd: PRIVATE.estimate, estimatedMicrousd: 123_456, operations: 7 } } });
const persona = (next = false) => ({ personaId: next ? "finite-persona-B" : "finite-persona-A", displayName: next ? PRIVATE.nextPersona : PRIVATE.persona,
  status: "ready", route: next ? "/document/finite-fictional-B" : "/document/finite-fictional-A", eventCount: 12 });
const row = kind => ({ sessionId: "callback-owned-A", status: kind === "failed" ? "failed" : "complete", title: PRIVATE.title,
  summary: PRIVATE.summary, eventCount: 12, imageCount: 2, createdAt: "2026-08-27T00:00:00.000Z", error: null,
  persona: kind === "persona" ? persona() : null, usage: {} });
const retryBody = () => ({ retry: { seed: PRIVATE.seed, eventCount: 321, providerCoverage: "finite-coverage", studyTypes: ["finite-study"],
  experienceProfile: "finite-profile", releasedMicrousd: 0, budgetSettled: true } });

// Reuse the corrected six-case fixture's exact GET/session setup, extended only
// by this finite command allowlist and native form/dialog/navigation observation.
async function replayCallbacks(t, kind = "failed") {
  const state = activeCallbackCase;
  const f = await confirmationFixture(t, { application: true });
  state.fixture = f;
  const track = value => {
    const pending = Promise.resolve(value);
    state.pending.add(pending);
    pending.then(() => state.pending.delete(pending), () => state.pending.delete(pending));
    return value;
  };
  const click = f.click;
  f.click = (...args) => track(click(...args));
  f.store.route.set("/product/evaluation/actual");
  f.replay = { row: row(kind), gets: [], posts: [], onGet: null, postHandlers: new Map(), navigation: [], closes: [], shows: [], forwarded: [] };
  f.nativeLocationAssign = value => { assert.match(value, /^\/document\/finite-fictional-[AB]$/u); f.replay.navigation.push(value); };
  const POST = new Map([
    ["/api/replay-sessions/estimate", () => Response.json(estimateBody())],
    ["/api/replay-sessions/callback-owned-A/persona", () => Response.json({ prepared: true })],
    ["/api/replay-sessions/callback-owned-A/retry", () => Response.json(retryBody())],
    ["/api/impersonation", () => Response.json({ route: "/document/finite-fictional-A" })],
    ["/api/replay-sessions/approval", () => Response.json({ approvalId: "finite-approval-NOT-A-REAL-GRANT" })],
    ["/api/replay-sessions", () => Response.json({ session: row("complete") })],
  ]);
  f.transport.handler = async request => {
    if (request.method === "GET" && request.url === "/api/session?audience=product") {
      f.replay.forwarded.push(request.url); return f.storeHost.worker.request(request.url);
    }
    if (request.method === "GET" && request.url === "/api/replay-sessions") {
      f.replay.gets.push(request); return f.replay.onGet ? f.replay.onGet(request) : Response.json({ sessions: [f.replay.row], liveGeneration: configuration() });
    }
    assert.equal(request.method, "POST", "no DELETE, PATCH or unlisted service forwarding");
    assert.ok(POST.has(request.url), "exact finite POST port: " + request.url);
    const call = { ...request, body: request.init.body ? JSON.parse(request.init.body) : null };
    f.replay.posts.push(call);
    return f.replay.postHandlers.has(request.url) ? f.replay.postHandlers.get(request.url)(call) : POST.get(request.url)(call);
  };
  const session = await f.platform.platformSession.load("product");
  assert.equal(session.audience, "product"); assert.equal(session.user.role, "admin");
  await f.mount("src/apps/product/actual-replay.ts", "FormaActualReplay", "forma-actual-replay");
  await until(() => f.draw().includes(PRIVATE.title), "actual Replay adopts finite private list/configuration");

  // Exact emitted ancestry/named controls extend the existing RendererPort;
  // no application method, private state, response or authority is replaced.
  const draw = f.draw;
  const matches = (node, selector) => selector.split(",").some(part => {
    const s = part.trim(); if (s === "*") return true;
    const tag = s.match(/^[a-z][\w-]*/u)?.[0], cls = s.match(/\.([\w-]+)/u)?.[1];
    const attribute = s.match(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/u);
    return (!tag || node.tag === tag) && (!cls || String(node.attributes.class ?? "").split(/\s+/u).includes(cls))
      && (!attribute || Object.hasOwn(node.attributes, attribute[1]) && (attribute[2] === undefined || String(node.attributes[attribute[1]]) === attribute[2]));
  });
  const within = (node, parent) => { let p = node.parentElement; const seen = new Set(); while (p) { assert.ok(!seen.has(p), "finite native ancestry is acyclic"); seen.add(p); if (p === parent) return true; p = p.parentElement; } return false; };
  let retainedNodes = new Map();
  const sameValue = (left, right) => Object.is(left, right);
  f.draw = () => {
    const markup = draw(), tree = fullPageTree(f, markup); f.tree = tree;
    // The shared tree's first-token lookup is sufficient for unique controls,
    // but repeated literal <label>/<p> tokens need occurrence-accurate ports
    // before constructing native form ancestry. No application node is invented.
    const byToken = new Map();
    for (const raw of f.renderer.nodes) { const queue = byToken.get(raw.full) ?? []; queue.push(raw); byToken.set(raw.full, queue); }
    for (const entry of tree.nodes) {
      assert.ok(entry.port, "every actual emitted native element has a renderer port");
      const raw = byToken.get(entry.port.full)?.shift();
      assert.ok(raw && raw.owner === entry.owner, "reuse the exact next emitted occurrence and owning component");
      entry.port = raw;
    }
    assert.ok([...byToken.values()].every(queue => queue.length === 0), "no emitted native port is omitted or reused twice");
    const nextNodes = new Map(), replacements = new Map(), counts = new Map();
    tree.root.nativePath = "host";
    // Preserve the native lifetime of an unchanged emitted template element.
    // A branch absent from a draw retires its ports; later openings get new ones.
    for (const entry of tree.nodes) if (entry.port) {
      const raw = entry.port, parentPath = entry.parent.nativePath ?? "host";
      const identity = JSON.stringify([raw.tag,
        ...["id", "class", "name", "type", "aria-labelledby"].map(name => raw.attributes[name] ?? ""),
        ...Object.entries(raw.handlers).map(([name, handler]) => [name, String(handler)])]);
      const base = parentPath + "/" + identity, ordinal = counts.get(base) ?? 0;
      counts.set(base, ordinal + 1); entry.nativePath = base + ":" + ordinal;
      let node = retainedNodes.get(entry.nativePath);
      if (!node) {
        node = raw;
        node.nativeListeners = new Map();
        node.declaredAttributes = {};
        node.declaredProperties = {};
        node.modal = false;
      }
      const attributes = { ...node.attributes };
      for (const name of new Set([...Object.keys(node.declaredAttributes), ...Object.keys(raw.attributes)])) {
        if (!sameValue(node.declaredAttributes[name], raw.attributes[name])
          || Object.hasOwn(node.declaredAttributes, name) !== Object.hasOwn(raw.attributes, name)) {
          if (Object.hasOwn(raw.attributes, name)) attributes[name] = raw.attributes[name];
          else delete attributes[name];
        }
      }
      // First mount initializes all literal native attributes; later renders
      // only update changed bindings. Static "open" cannot undo close()/showModal().
      if (!retainedNodes.has(entry.nativePath)) Object.assign(attributes, raw.attributes);
      const properties = { ...raw.properties };
      for (const [name, value] of Object.entries(properties)) {
        if (!sameValue(node.declaredProperties[name], value)) node[name] = value;
      }
      node.attributes = attributes; node.properties = properties; node.handlers = raw.handlers;
      node.full = raw.full; node.owner = raw.owner; node.fixture = f;
      node.declaredAttributes = { ...raw.attributes }; node.declaredProperties = properties;
      node.textContent = entry.text; node.isConnected = true;
      node.disabled = Object.hasOwn(attributes, "disabled");
      node.classList = { contains: name => String(node.attributes.class ?? "").split(/\s+/u).includes(name) };
      node.getAttribute = name => node.attributes[name] ?? null;
      node.hasAttribute = name => Object.hasOwn(node.attributes, name);
      node.setAttribute = (name, value) => { node.attributes[name] = String(value); };
      node.removeAttribute = name => { delete node.attributes[name]; if (name === "open") node.modal = false; };
      node.focus = () => f.focus(node);
      node.addEventListener = (name, handler) => {
        const listeners = node.nativeListeners.get(name) ?? new Set(); listeners.add(handler); node.nativeListeners.set(name, listeners);
      };
      node.removeEventListener = (name, handler) => node.nativeListeners.get(name)?.delete(handler);
      node.emit = (type, extra = {}) => {
        const event = { type, currentTarget: node, target: node, isTrusted: false, defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
        node.handlers[type]?.call(node.owner, event);
        for (const listener of [...(node.nativeListeners.get(type) ?? [])]) listener(event);
        if (type === "cancel" && !event.defaultPrevented && node.tag === "dialog") node.close();
        return event;
      };
      if (node.tag === "dialog") {
        Object.defineProperty(node, "open", { configurable: true,
          get: () => Object.hasOwn(node.attributes, "open"),
          set: value => { if (value) node.attributes.open = ""; else { delete node.attributes.open; node.modal = false; } } });
        node.matches = selector => selector === ":modal" ? Boolean(node.isConnected && node.modal && node.open) : matches(node, selector);
        node.showModal = () => { node.open = true; node.modal = true; f.replay.shows.push(node); };
        node.close = () => {
          if (!node.open) return;
          node.open = false;
          const event = { type: "close", currentTarget: node, target: node, isTrusted: false, preventDefault() {} };
          const callback = node.handlers.close, listeners = [...(node.nativeListeners.get("close") ?? [])];
          f.replay.closes.push(() => { callback?.call(node.owner, event); for (const listener of listeners) listener(event); });
        };
      }
      replacements.set(raw, node); nextNodes.set(entry.nativePath, node); entry.port = node;
    }
    for (const entry of tree.nodes) if (entry.port) {
      const node = entry.port;
      node.parentElement = entry.parent?.port ?? f.host;
      node.children = entry.children.filter(child => typeof child !== "string" && child.port).map(child => child.port);
      node.querySelectorAll = selector => f.renderer.nodes.filter(child => within(child, node) && matches(child, selector));
      node.querySelector = selector => node.querySelectorAll(selector)[0] ?? null;
    }
    for (const [key, node] of retainedNodes) if (!nextNodes.has(key)) { node.isConnected = false; node.parentElement = null; node.modal = false; }
    retainedNodes = nextNodes;
    f.renderer.nodes = f.renderer.nodes.map(node => replacements.get(node) ?? node);
    f.host.children = tree.root.children.filter(child => typeof child !== "string" && child.port).map(child => child.port);
    f.host.querySelectorAll = selector => f.renderer.nodes.filter(node => node.owner === f.host && matches(node, selector));
    f.host.querySelector = selector => f.host.querySelectorAll(selector)[0] ?? null;
    return markup;
  };
  f.tick = async () => {
    if (f.holdUpdate) { const gate = f.holdUpdate; f.holdUpdate = null; f.updateWaits = (f.updateWaits ?? 0) + 1; await gate.promise; }
    f.draw(); return true;
  };
  f.draw();
  assert.equal(f.renderer.ownNodes(f.host, "input").find(node => node.attributes.name === "phrase")?.attributes.placeholder, PRIVATE.phrase);
  const fields = new WeakMap();
  t.mock.method(globalThis, "FormData", function NativeFormData(form) {
    assert.ok(fields.has(form), "only the actual selected emitted form can be read");
    const entries = fields.get(form).filter(node => !node.disabled && (node.attributes.type !== "checkbox" || node.checked))
      .map(node => [node.attributes.name, String(node.value)]);
    return { get: name => entries.find(([key]) => key === name)?.[1] ?? null, getAll: name => entries.filter(([key]) => key === name).map(([, value]) => value) };
  });
  f.form = (method, values) => {
    f.draw();
    const forms = f.renderer.ownNodes(f.host, "form").filter(node => node.handlers.submit?.toString().includes(method));
    assert.equal(forms.length, 1, "one actual current " + method + " form");
    const form = forms[0], inputs = f.renderer.nodes.filter(node => ["input", "textarea", "select"].includes(node.tag) && within(node, form) && node.attributes.name);
    fields.set(form, inputs);
    for (const [name, value] of Object.entries(values)) {
      const input = inputs.find(node => node.attributes.name === name); assert.ok(input, "actual named control " + name);
      if (input.attributes.type === "checkbox") input.checked = value === input.value;
      else input.value = value;
    }
    return form;
  };
  f.submit = (method, values, trusted = true) => {
    const form = f.form(method, values), submitters = f.renderer.ownNodes(f.host, "button").filter(node => within(node, form) && node.attributes.type === "submit");
    assert.equal(submitters.length, 1); const button = submitters[0]; assert.equal(button.disabled, false);
    button.focus(); button.handlers.click.call(button.owner, { type: "click", currentTarget: button, target: button, isTrusted: trusted, preventDefault() {} });
    return track(form.handlers.submit.call(form.owner, { type: "submit", currentTarget: form, target: form, submitter: button, isTrusted: trusted, preventDefault() {} }));
  };
  f.refresh = () => f.click(f.control("#load"));
  f.startDenial = async () => {
    const gate = deferred(); f.replay.onGet = () => gate.promise;
    const before = f.replay.gets.length, pending = f.refresh();
    await until(() => f.replay.gets.length === before + 1, "ordinary Refresh precedes any persona modal and holds its exact list response");
    return async () => { f.replay.onGet = null; gate.resolve(Response.json(DENIAL, { status: 403 })); await pending; f.draw(); };
  };
  f.personaDialog = () => f.renderer.ownNodes(f.host, "dialog").find(node => node.classList.contains("actual-persona-confirmation")) ?? null;
  f.postCount = url => f.replay.posts.filter(call => call.url === url).length;
  await f.storeHost.worker.drainBackground();
  const writes = structuredClone(f.storeHost.worker.controls.writes), source = JSON.stringify({ events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get() });
  f.storeHost.transport = request => assert.fail("No Store/Worker command is admitted by callback fixture: " + request.url);
  t.after(() => {
    assert.deepEqual(f.replay.forwarded, ["/api/session?audience=product"]);
    assert.deepEqual(f.storeHost.worker.controls.writes, writes, "finite callback ports add no fixture database write after bootstrap");
    assert.equal(JSON.stringify({ events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get() }), source);
    assert.deepEqual(f.transport.external, []);
    t.diagnostic(JSON.stringify({ finitePosts: f.replay.posts.map(({ url, body }) => ({ url, body })), finiteGets: f.replay.gets.length,
      observedNavigation: f.replay.navigation, workerWritesUnchanged: true, realReplayOrPersonaRequests: 0, realProviders: 0,
      evidence: "complete Replay/native controls with finite HTTP; modeled trusted events; not physical activation or financial settlement" }));
  });
  return f;
}

export { test, deferred, until, replayCallbacks, PRIVATE, estimateBody, persona, row, retryBody };
