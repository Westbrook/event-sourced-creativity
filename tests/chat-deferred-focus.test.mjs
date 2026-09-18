// Actual Shell/Chat/ChoiceCard/ConversationComposer and existing RAM Store.
// The countercontrol is a same-turn newer native interaction before the finite
// update microtask; no promise is held or replaced. It is an ownership contract,
// not evidence that a later physical user task interleaves with ordinary Lit.
import assert from "node:assert/strict";
import test from "node:test";
import { createCalmFullPage, registerCalmFullPageComponents, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { withDocumentInRoute } from "../src/model/routes.ts";
import { blockTypeDefinition } from "../src/model/block-types.ts";

const classed = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
async function chatPage(t) {
  const external = t.mock.method(globalThis, "fetch", async () => assert.fail("No external or provider request in local Chat focus controls"));
  const f = await createCalmFullPage(t), h = f.storeHost;
  // Same finite History/Location port as navigationPage and mountedFallback.
  // Only the actual Store's push/replace calls publish a subsequent URL here;
  // this does not set its route, bypass its origin guard, or grant authority.
  const previousHistory = globalThis.history, historyCalls = [];
  const updateLocation = route => {
    const url = new URL(route, h.location.origin);
    Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash });
  };
  updateLocation(f.store.route.get()); f.nativeHistoryLocation = h.location;
  globalThis.history = {
    pushState(_state, _title, route) { historyCalls.push({ method: "pushState", route }); updateLocation(route); },
    replaceState(_state, _title, route) { historyCalls.push({ method: "replaceState", route }); updateLocation(route); },
  };
  t.after(() => { globalThis.history = previousHistory; });
  await registerCalmFullPageComponents(f, ["forma-chat-studio"]);
  const native = installOutputNavigationFocusNative(t, f, ports), projection = f.store.projection.get();
  const href = withDocumentInRoute("/studio/chat", projection.documentId, projection.documentTitle);
  // Current main groups native view links under the View popover. Open that
  // actual disclosure before following its actual Chat link.
  const menus = f.components().filter(component => component.tag === "forma-ui-popover"
    && component.parentElement?.tag === "forma-studio-mode-nav" && classed(component, "studio-view-menu"));
  assert.equal(menus.length, 1); const menu = menus[0];
  const trigger = f.find("button", node => node.owner === menu && classed(node, "ui-popover-trigger"));
  native.emit("pointerdown", trigger.port); native.focus(trigger.port); trigger.port.click(); await f.settle();
  const link = f.find("a", node => node.owner === menu && node.attributes["data-studio-view"] === "chat" && node.attributes.href === href);
  // Observe only this actual link's original public navigation call. Preserve
  // its exact return Promise, scheduler, owner checks, and all focus assertions.
  const routeBefore = f.store.route.get(), navigationCalls = [], navigateFrom = f.host.navigateFrom;
  const navigationObserver = t.mock.method(f.host, "navigateFrom", function (...args) {
    const call = { origin: args[0]?.tag, exactOwner: args[0] === menu.parentElement, sameHost: this === f.host, settled: false };
    navigationCalls.push(call);
    const pending = Reflect.apply(navigateFrom, this, args);
    void Promise.resolve(pending).then(value => { call.settled = true; call.result = value; },
      error => { call.settled = true; call.error = String(error?.message ?? error); });
    return pending;
  });
  native.emit("pointerdown", link.port); native.focus(link.port); await f.act(link, "click", { button: 0 });
  await f.settle();
  const owners = f.components().filter(owner => owner.tag === "forma-chat-studio" && owner.isConnected);
  navigationObserver.mock.restore();
  t.diagnostic("C_CHAT_MOUNT_PREREQUISITE " + JSON.stringify({ routeBefore, requested: href,
    routeAfter: f.store.route.get(), routeReady: f.store.routeDataReady(), sourceCurrent: f.store.sourceOwnershipActive(f.store.captureSourceOwnership()),
    registered: typeof f.renderer.registry["forma-chat-studio"], navigationCalls, connectedChatOwners: owners.length,
    connectedOwners: f.components().map(owner => owner.tag), commandOpen: f.store.ui.commandOpen,
    currentToast: f.store.ui.toast, componentFrames: f.frames.size,
    storeFrames: [...h.timers.values()].filter(timer => timer.delay === 16).length }));
  assert.equal(owners.length, 1); const owner = owners[0];
  assert.ok(owner instanceof f.renderer.registry["forma-chat-studio"]); assert.equal(owner.store, f.store);
  assert.equal(f.store.route.get(), href);
  assert.ok(historyCalls.some(call => call.route === href), "The actual Store committed this URL through native History");
  assert.equal(h.location.pathname + h.location.search + h.location.hash, href);
  const field = () => f.find("textarea", node => node.attributes.id === "creative-chat-message"
    && node.owner.tag === "forma-ui-conversation-composer" && node.owner.parentElement === owner);
  const toggle = () => f.find("button", node => node.owner === owner && classed(node, "chat-result-toggle"));
  assert.equal(field().port.matches(":disabled"), false); assert.equal(field().port.value, "");
  return { f, h, owner, native, external, field, toggle };
}

for (const action of ["prepare", "close-result"]) for (const newer of [false, true])
  test("C Chat deferred " + action + " / " + (newer ? "same-turn newer native interaction wins" : "healthy current focus"),
    { concurrency: false, timeout: 45_000 }, async t => {
      const x = await chatPage(t), { f, h, owner, native } = x;
      let control;
      if (action === "prepare") {
        control = f.find("button", node => node.owner.tag === "forma-ui-choice-card" && node.owner.parentElement === owner
          && node.attributes["data-choice-value"] === "direction");
        assert.equal(control.port.matches(":disabled"), false);
      } else {
        const show = x.toggle(); native.emit("pointerdown", show.port); native.focus(show.port); await f.act(show);
        assert.equal(x.toggle().attributes["aria-expanded"], true);
        control = f.find("button", node => node.owner === owner && classed(node, "chat-result-close"));
      }
      const baseline = { events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get(),
        route: f.store.route.get(), session: f.store.session.get(), source: f.store.captureSourceOwnership(),
        authority: f.store.captureAuthorizationScope(), requests: h.requests.length, financial: financial(h.worker) };
      assert.ok(control.port.isConnected); native.emit("pointerdown", control.port); native.focus(control.port);
      const pending = f.act(control);
      const later = action === "prepare" ? x.toggle() : x.field();
      assert.ok(later.port.isConnected); assert.equal(later.port.matches(":disabled"), false);
      if (newer) { native.emit("pointerdown", later.port); native.focus(later.port); }
      const mark = native.nativeFocus.length; await pending; await f.settle();
      const late = native.nativeFocus.slice(mark).filter(row => row.node.owner === owner || row.node.owner.parentElement === owner);
      t.diagnostic(JSON.stringify({ action, newer, lateFocus: late.map(row => ({ tag: row.node.tag,
        id: row.node.attributes.id ?? null, class: row.node.attributes.class ?? null })),
        boundary: "actual native listener; same-turn intervention; unchanged finite update scheduler" }));
      if (newer) assert.equal(late.length, 0, "old deferred presentation cannot overwrite newer native focus");
      else {
        assert.equal(late.length, 1);
        if (action === "prepare") assert.equal(late[0].node.attributes.id, "creative-chat-message");
        else assert.ok(classed(late[0].node, "chat-result-toggle"));
      }
      assert.equal(x.field().port.value, action === "prepare" ? f.i18n.system(blockTypeDefinition("direction").prompt) : "");
      if (action === "close-result") assert.equal(x.toggle().attributes["aria-expanded"], false);
      assert.equal(owner.isConnected, true); assert.equal(owner.store, f.store);
      assert.equal(f.store.route.get(), baseline.route); assert.equal(f.store.session.get(), baseline.session);
      assert.ok(f.store.sourceOwnershipActive(baseline.source)); assert.ok(f.store.authorizationScopeActive(baseline.authority));
      assert.equal(f.store.events.get(), baseline.events); assert.equal(f.store.content.get(), baseline.content); assert.equal(f.store.head.get(), baseline.head);
      assert.equal(h.requests.length, baseline.requests); assert.deepEqual(financial(h.worker), baseline.financial);
      assert.equal(x.external.mock.callCount(), 0);
    });

const chatMemoryCopy = {
  recall: "Recall this document’s memory", check: "Check this recall request", retry: "Retry this same recall request", dismiss: "Dismiss recalled view",
};
const chatMemoryControl = (x, name) => x.f.find("button", node => node.owner === x.owner && node.text === chatMemoryCopy[name]);
const chatMemoryRequests = x => x.h.requests.filter(request => request.body?.payload?.memoryMode === "recall" || request.url.includes("?memoryMode=recall"));
const chatMemoryViews = x => x.f.tree().visible("blockquote").filter(node => node.owner === x.owner);
function chatMemoryEnvelope(x, request, leaseMs = 60_000) {
  const requestId = request.body?.payload?.requestId ?? decodeURIComponent(request.url.split("/")[3].split("?")[0]);
  const checkedAt = Date.now();
  return { job: { jobId: requestId, documentId: x.f.store.projection.get().documentId, kind: "chat", sourceSurface: "chat", memoryMode: "recall" },
    memory: { version: "native-document-job-memory-v1", jobId: requestId, turnId: "synthetic-memory-turn", locale: "en",
      text: "Historical Memory <not a command> & not an ordinary chat.", checkedAt: new Date(checkedAt).toISOString(), validUntil: new Date(checkedAt + leaseMs).toISOString() },
    noAutomaticRetry: true };
}
async function memoryChatPage(t) {
  const x = await chatPage(t); x.h.document.visibilityState = "visible"; await x.f.settle();
  assert.equal(chatMemoryRequests(x).length, 0, "Mounting, ordinary view navigation and rendering do not recall Memory");
  assert.equal(chatMemoryViews(x).length, 0);
  return x;
}

test("Chat Memory explicit recall is lease-only and preserves the unsent ordinary draft", { concurrency: false, timeout: 45_000 }, async t => {
  const x = await memoryChatPage(t), { f, h } = x;
  const field = x.field(); field.port.value = "Unsent ordinary creative draft"; await f.act(field, "input");
  const before = { events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get(), financial: financial(h.worker), storage: [...h.storage] };
  h.intercept = request => request.body?.payload?.memoryMode === "recall" ? Response.json(chatMemoryEnvelope(x, request)) : undefined;
  await f.act(chatMemoryControl(x, "recall"));
  assert.equal(chatMemoryRequests(x).length, 1); assert.equal(chatMemoryViews(x).length, 1);
  assert.equal(chatMemoryViews(x)[0].text, "Historical Memory <not a command> & not an ordinary chat.");
  assert.equal(f.tree().nodes.filter(node => node.tag === "not").length, 0, "Recalled text is escaped, never interpreted as markup");
  assert.equal(x.field().port.value, "Unsent ordinary creative draft");
  assert.equal(f.store.events.get(), before.events); assert.equal(f.store.content.get(), before.content); assert.equal(f.store.head.get(), before.head);
  assert.deepEqual(financial(h.worker), before.financial); assert.deepEqual([...h.storage], before.storage);
  await f.settle(); assert.equal(chatMemoryRequests(x).length, 1, "Rendering does not refresh a lease");
  await f.act(chatMemoryControl(x, "dismiss")); assert.equal(chatMemoryViews(x).length, 0);
  assert.equal(chatMemoryRequests(x).length, 1); assert.equal(x.external.mock.callCount(), 0);
});

test("Chat Memory lost ACK uses only explicit same-ID retry and explicit read recovery", { concurrency: false, timeout: 45_000 }, async t => {
  const x = await memoryChatPage(t), { f, h } = x;
  const requestMark = h.requests.length;
  let count = 0;
  h.intercept = request => {
    if (request.body?.payload?.memoryMode === "recall") {
      count += 1;
      if (count === 1) return Response.json({ error: "memory_job_submission_unconfirmed", jobId: request.body.payload.requestId, noAutomaticRetry: true }, { status: 202 });
      return Response.json({ job: chatMemoryEnvelope(x, request).job, pending: true, noAutomaticRetry: true }, { status: 202 });
    }
    if (request.url.includes("?memoryMode=recall")) return Response.json(chatMemoryEnvelope(x, request));
  };
  await f.act(chatMemoryControl(x, "recall")); await f.settle();
  assert.equal(chatMemoryRequests(x).length, 1); assert.equal(chatMemoryViews(x).length, 0);
  await f.act(chatMemoryControl(x, "retry"));
  const two = chatMemoryRequests(x); assert.equal(two.length, 2); assert.deepEqual(two[0].body, two[1].body);
  await f.act(chatMemoryControl(x, "check"));
  const three = chatMemoryRequests(x); assert.equal(three.length, 3); assert.equal(three[2].init.method, "GET");
  assert.equal(three[2].url, `/api/document-jobs/${two[0].body.payload.requestId}?memoryMode=recall`);
  assert.equal(chatMemoryViews(x).length, 1);
  assert.equal(h.requests.some(request => /\/run$/u.test(request.url)), false);
  assert.equal(h.requests.slice(requestMark).filter(request => request.init.method === "POST").every(request => request.body?.payload?.memoryMode === "recall"), true);
  assert.equal(x.external.mock.callCount(), 0);
});

test("Chat Memory failed recall never submits the paid creative composer", { concurrency: false, timeout: 45_000 }, async t => {
  const x = await memoryChatPage(t), { f, h } = x;
  const field = x.field(); field.port.value = "Keep this draft"; await f.act(field, "input");
  const requestMark = h.requests.length;
  h.intercept = request => request.body?.payload?.memoryMode === "recall" ? Response.json({ error: "unavailable" }, { status: 503 }) : undefined;
  await f.act(chatMemoryControl(x, "recall")); await f.settle();
  assert.equal(chatMemoryRequests(x).length, 1); assert.equal(chatMemoryViews(x).length, 0);
  assert.ok(chatMemoryControl(x, "retry")); assert.equal(x.field().port.value, "Keep this draft");
  assert.equal(h.requests.slice(requestMark).filter(request => request.init.method === "POST").every(request => request.body?.payload?.memoryMode === "recall"), true);
  assert.equal(x.external.mock.callCount(), 0);
});

for (const retirement of ["visibility", "authorization", "route", "disconnect"]) test(
  "Chat Memory discards a late response after " + retirement, { concurrency: false, timeout: 45_000 }, async t => {
    const x = await memoryChatPage(t), { f, h, owner } = x;
    let respond, dispatched;
    const seen = new Promise(resolve => { dispatched = resolve; });
    h.intercept = request => {
      if (request.body?.payload?.memoryMode !== "recall") return undefined;
      dispatched(request); return new Promise(resolve => { respond = () => resolve(Response.json(chatMemoryEnvelope(x, request))); });
    };
    const action = f.act(chatMemoryControl(x, "recall")); const request = await seen;
    if (retirement === "visibility") { h.document.visibilityState = "hidden"; x.native.emit("visibilitychange", h.document); }
    if (retirement === "authorization") { const session = f.store.session.get(); f.store.session.set({ ...session, user: { ...session.user, userId: "another-synthetic-actor" } }); }
    if (retirement === "route") f.store.route.set(f.store.route.get() + "?changed=1");
    if (retirement === "disconnect") { owner.isConnected = false; owner.disconnectedCallback(); }
    await f.settle(); respond(); await action; await f.settle();
    assert.equal(chatMemoryViews(x).length, 0); assert.equal(chatMemoryRequests(x).length, 1);
    if (retirement === "visibility" || retirement === "disconnect") assert.equal(request.init.signal.aborted, true);
    assert.equal(x.external.mock.callCount(), 0);
  });

test("Chat Memory expiry retires the display without polling or writing ordinary history", { concurrency: false, timeout: 45_000 }, async t => {
  const x = await memoryChatPage(t), { f, h } = x;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  h.intercept = request => request.body?.payload?.memoryMode === "recall" ? Response.json(chatMemoryEnvelope(x, request)) : undefined;
  await f.act(chatMemoryControl(x, "recall")); assert.equal(chatMemoryViews(x).length, 1);
  t.mock.timers.tick(60_001); await f.settle();
  assert.equal(chatMemoryViews(x).length, 0); assert.equal(chatMemoryRequests(x).length, 1);
  assert.ok(f.tree().visible("p").some(node => node.owner === x.owner && node.text.includes("recalled reply expired")));
});

test("Chat excludes document-job Memory origin events from ordinary typed-chat history", { concurrency: false, timeout: 45_000 }, async t => {
  const x = await memoryChatPage(t), { f } = x;
  const actor = f.store.session.get().user.userId;
  f.appendEvent("ChatMessageSent", { actor_user_id: actor, operation: "document-job-memory", turn_id: "memory-event-turn", content_ref: "memory-prompt-ref" });
  f.appendEvent("AssistantReasoned", { actor_user_id: actor, operation: "document-job-memory", turn_id: "memory-event-turn", content_ref: "memory-response-ref" });
  f.appendEvent("ChatMessageSent", { actor_user_id: actor, operation: "creative-chat", turn_id: "ordinary-event-turn", content_ref: "ordinary-prompt-ref" });
  f.store.content.set({ ...f.store.content.get(), "memory-prompt-ref": "Synthetic historical Memory request", "memory-response-ref": "Synthetic historical Memory answer", "ordinary-prompt-ref": "Ordinary typed question" });
  await f.settle();
  const lines = f.tree().visible("article").filter(node => node.owner === x.owner && classed(node, "chat-line"));
  assert.equal(lines.some(node => node.text.includes("historical Memory")), false);
  assert.equal(lines.some(node => node.text.includes("Ordinary typed question")), true);
  assert.equal(chatMemoryRequests(x).length, 0); assert.equal(chatMemoryViews(x).length, 0);
});

test("Chat generic job feed neither drives, acknowledges nor presents marked Memory jobs", { concurrency: false, timeout: 45_000 }, async t => {
  const x = await memoryChatPage(t), { f, h } = x;
  const jobId = "33333333-3333-4333-8333-333333333333", stamp = new Date().toISOString();
  let status = "queued";
  h.intercept = request => {
    if (request.url.startsWith("/api/document-jobs") && (!request.init.method || request.init.method === "GET"))
      return Response.json({ jobs: [{ jobId, documentId: f.store.projection.get().documentId, projectId: f.store.projection.get().projectId,
        kind: "chat", sourceSurface: "chat", memoryMode: "recall", status, requestedAt: stamp, updatedAt: stamp,
        result: { text: "Do not hydrate this uncertified generic Memory text" }, notifiedAt: null, parentJobId: null }] });
  };
  const before = { events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get(), financial: financial(h.worker) };
  for (const phase of ["queued", "running", "completed"]) {
    status = phase; await f.store.syncDocumentJobs(); await f.settle();
    assert.equal(f.store.documentJobActive("chat"), false);
    assert.equal(f.store.documentJobs.get().some(job => job.jobId === jobId), false);
    assert.equal(x.field().port.matches(":disabled"), false);
  }
  assert.equal(chatMemoryViews(x).length, 0); assert.equal(chatMemoryRequests(x).length, 0);
  assert.equal(h.requests.some(request => request.url.includes(jobId) && request.init.method === "POST"), false);
  assert.equal(f.store.events.get(), before.events); assert.equal(f.store.content.get(), before.content); assert.equal(f.store.head.get(), before.head);
  assert.deepEqual(financial(h.worker), before.financial); assert.equal(x.external.mock.callCount(), 0);
});
