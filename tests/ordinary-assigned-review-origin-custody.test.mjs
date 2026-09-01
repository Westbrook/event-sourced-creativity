import assert from "node:assert/strict";
import test, { after } from "node:test";
import { assignmentPage, flushStoreFrames, frames, libraryFocusFromRoute, artifactFocusOptionsFromRoute,
  originalFetch, externalCount } from "./helpers/assigned-review-action-fixture.mjs";
import { calmFullPageNativePorts as ports, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { libraryBlockEditorFromRoute, projectTaskDocumentIdFromRoute, withDocumentInRoute } from "../src/model/routes.ts";

// Complete Shell/Workspace/Library/Store plus the existing isolated RAM Worker.
// projectAuthor is explicit pre-baseline membership setup, not a session/grant
// replacement. The independently authored current review is never approved here.
after(() => { assert.equal(externalCount(), 0); globalThis.fetch = originalFetch; });
const options = { timeout: 120_000, concurrency: false };
const pause = () => new Promise(setImmediate);
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
function within(node, name) {
  for (let at = node.parent; at; at = at.parent) if (classed(at, name)) return true;
  return false;
}
const method = request => String(request.init.method ?? "GET").toUpperCase();
const snapshot = h => structuredClone({ events: h.store.events.get(), head: h.store.head.get(),
  content: h.store.content.get(), session: h.store.session.get() });

async function finish(q, pending) {
  let done = false, value, error;
  pending.then(result => { value = result; done = true; }, caught => { error = caught; done = true; });
  for (let turn = 0; turn < 32 && !done; turn++) {
    await flushStoreFrames(q.h); await q.f.settle(); await pause();
  }
  assert.ok(done, "The original actual control/Store/native viewer operation settles under existing finite frames");
  if (error) throw error;
  return value;
}
async function drain(q) {
  for (let turn = 0; turn < 8; turn++) {
    await flushStoreFrames(q.h); await q.f.settle();
    await q.resume.settleOriginalRequests(); await q.w.drainBackground();
    const requests = q.h.requests.length;
    await pause();
    if (q.resume.pendingOriginalCount() === 0 && frames(q.h).length === 0
      && q.f.frames.size === 0 && !q.f.requested && q.h.requests.length === requests) return;
  }
  assert.fail("Already-started transports and actual component/Store frames must quiesce before observation");
}
async function complete(q, activation) {
  await finish(q, activation);
  await finish(q, Promise.all(q.storeCalls.map(call => call.pending)));
  await finish(q, Promise.all(q.navigationCalls.map(call => call.pending)));
  await drain(q);
  await finish(q, Promise.all(q.viewerCalls.map(call => call.pending)));
  await drain(q);
}
function observeOriginal(t, target, name, calls, inspect = () => {}) {
  const original = target[name]; assert.equal(typeof original, "function");
  t.mock.method(target, name, function (...args) {
    inspect(args);
    const call = {}; calls.push(call);
    call.pending = original.apply(this, args);
    void call.pending.then(value => { call.result = value; call.settled = true; },
      error => { call.error = String(error); call.settled = true; });
    return call.pending; // Every argument and the exact public Promise are forwarded.
  });
}

async function ordinaryReviewPage(t, surface) {
  const cleanups = [], previousFetch = globalThis.fetch;
  const ownedTest = { mock: t.mock, after(callback) { cleanups.push(callback); } };
  let q;
  t.after(async () => {
    try {
      if (q?.resume) {
        await finish(q, Promise.allSettled([...q.storeCalls, ...q.navigationCalls, ...q.viewerCalls].map(call => call.pending)));
        await drain(q);
      }
    } finally {
      try { q?.resume?.restore(); for (const cleanup of cleanups) await cleanup(); }
      finally { globalThis.fetch = previousFetch; }
    }
  });
  q = await assignmentPage(ownedTest, "same-document", { projectAuthor: true });
  const { h, f } = q;
  q.storeCalls = []; q.navigationCalls = [];
  globalThis.fetch = (url, init) => {
    assert.ok(String(url).startsWith("/api/"), "Only the original isolated Worker transport is reachable");
    return h.fetch(url, init);
  };
  q.resume = observeActualSceneResumeReads(h);
  await registerCalmFullPageComponents(f, ["forma-workspace", "forma-library"]);
  f.nativeHistoryLocation = h.location;
  q.focus = installOutputNavigationFocusNative(ownedTest, f, ports);
  const tag = surface === "workspace" ? "forma-workspace" : "forma-library";
  q.currentOwner = () => {
    const current = f.components().filter(owner => owner.tag === tag && owner.isConnected);
    assert.ok(current.length <= 1, "At most one current same-Store routed owner");
    return current[0] ?? null;
  };
  // Declared initial route only: source/session/content remain the actual
  // Worker records restored by assignmentPage; no private owner is constructed.
  const title = h.store.projection.get().documentTitle;
  h.store.setRoute(surface === "workspace" ? withDocumentInRoute("/", q.entryDocument, title)
    : "/library?document=" + encodeURIComponent(q.entryDocument));
  await drain(q);
  q.owner = q.currentOwner(); assert.ok(q.owner);
  assert.ok(q.owner instanceof f.renderer.registry[tag]); assert.equal(q.owner.store, h.store);
  assert.equal(f.host.tag, "forma-shell"); assert.equal(q.owner.closest("forma-shell"), f.host);
  const session = h.store.session.get(), context = session.projectContext;
  assert.notEqual(session.user.userId, q.w.owner, "The reviewer is not the source/result author");
  assert.equal(context.role, "editor"); assert.equal(context.projectId, q.task.projectId);
  assert.equal(context.projectAccessId, q.task.projectAccessId);
  assert.ok(context.permissions.includes("project.author") && context.permissions.includes("project.review.approve"),
    "Both rights are derived by the real Worker from explicit fixture membership/reviewAccess setup");
  assert.equal(h.store.projection.get().documentId, q.task.documentId);
  assert.ok(h.store.events.get().some(event => event.type === "DocumentRenderCompleted"
    && event.payload.artifact_id === q.task.artifactId && event.payload.requested_by_user_id === q.w.owner));

  // Reuse the established C72 Library native ancestry correction. The generic
  // finite first-class query can return its section for this compound selector.
  // Resolve only actual emitted inputs; this org-member reviewer has none.
  const previousQuery = f.renderer.query;
  const query = function (owner, selector) {
    if (owner?.tag !== "forma-library" || selector !== ".library-organization-context form.workspace-settings-form input")
      return Reflect.apply(previousQuery, this, [owner, selector]);
    const inputs = f.tree().nodes.filter(node => {
      if (node.owner !== owner || node.tag !== "input") return false;
      let form = node.parent; while (form && form.tag !== "form") form = form.parent;
      if (!form || !classed(form, "workspace-settings-form")) return false;
      for (let at = form.parent; at; at = at.parent)
        if (at.owner === owner && classed(at, "library-organization-context")) return true;
      return false;
    });
    assert.equal(inputs.length, 0, "The actual org-member reviewer emits no publisher inputs; no raw value/default is invented");
    return inputs.map(node => node.port);
  };
  f.renderer.query = query;
  ownedTest.after(() => { if (f.renderer.query === query) f.renderer.query = previousQuery; });

  if (surface === "workspace") {
    const pane = f.find("button", node => node.owner === q.owner && node.attributes["data-workbench-pane"] === "review");
    q.focus.emit("pointerdown", pane.port); q.focus.focus(pane.port); await f.act(pane); await drain(q);
  }
  assert.equal(q.owner.captureCommandDeparture().blocked(), false, "The unchanged actual owner admits ordinary navigation");
  observeOriginal(t, h.store, "openAssignedReview", q.storeCalls, args => {
    for (const key of ["id", "organizationId", "projectAccessId", "projectId", "documentId", "artifactId", "revision", "contentSha256"])
      assert.equal(args[0][key], q.task[key], "The current native review control retains exact " + key);
  });
  observeOriginal(t, f.host, "navigateFrom", q.navigationCalls);
  q.reviewButton = () => f.find("button", node => {
    if (node.owner !== q.currentOwner()) return false;
    if (surface === "workspace") {
      if (!within(node, "document-workbench-review") || node.text !== f.i18n.t("activity.openReview", "Open assigned review")) return false;
      let article = node.parent; while (article && article.tag !== "article") article = article.parent;
      return article?.children.some(child => typeof child !== "string" && child.tag === "b" && child.text === q.task.artifactTitle);
    }
    if (!within(node, "library-assigned-reviews") || node.text !== f.i18n.system("Open assigned output")) return false;
    let row = node.parent; while (row && row.tag !== "li") row = row.parent;
    return row?.text.includes(q.task.artifactTitle + " · revision " + q.task.revision);
  });
  assert.ok(q.reviewButton().port.isConnected);
  if (surface === "library") {
    q.priorityCount = f.tree().visible("button").filter(node => node.owner === q.owner && within(node, "library-review-priority")).length;
    assert.equal(f.tree().visible("button").filter(node => node.owner === q.owner && within(node, "library-assigned-reviews")).length, 3);
  }
  return q;
}

async function invokeReview(q) {
  await drain(q);
  const button = q.reviewButton(); assert.equal(button.port.matches(":disabled"), false);
  q.focus.emit("pointerdown", button.port); q.focus.focus(button.port);
  const before = { route: q.h.store.route.get(), state: snapshot(q.h), requests: q.h.requests.length,
    source: q.h.store.captureSourceOwnership(), authority: q.h.store.captureAuthorizationScope(),
    focus: q.focus.nativeFocus.length, scroll: q.focus.nativeScroll.length };
  assert.ok(q.h.store.sourceOwnershipActive(before.source) && q.h.store.authorizationScopeActive(before.authority));
  await complete(q, q.f.act(button, "click", { button: 0 }));
  return before;
}
function diagnose(t, q, before, surface, dirty) {
  t.diagnostic("C_ORDINARY_REVIEW_ORIGIN " + JSON.stringify({ surface, dirty, priorityCount: q.priorityCount ?? null,
    currentRoute: q.h.store.route.get(), sameOwner: q.currentOwner() === q.owner,
    sourceCurrent: q.h.store.sourceOwnershipActive(before.source),
    storeCalls: q.storeCalls.map(call => ({ result: call.result ?? null, error: call.error ?? null })),
    navigationCalls: q.navigationCalls.map(call => ({ result: call.result ?? null, error: call.error ?? null })),
    viewers: q.viewerCalls.map(call => ({ id: call.id, result: call.result ?? null,
      documentId: call.owner.documentId, connected: call.owner.isConnected,
      open: call.owner.querySelector(".document-artifact-view")?.open ?? false })),
    requests: q.h.requests.slice(before.requests).map(request => ({ method: method(request), url: request.url,
      witnessedReadOnlyResume: q.resume.isReadOnlyResume(request) })),
    evidence: "actual native-control/Worker behavior only; no physical browser, AT or geometry claim" }));
}
function assertRefused(q, before) {
  assert.equal(q.storeCalls.length, 0, "Raw current owner refuses the actual review control before its context request");
  assert.equal(q.h.requests.length, before.requests, "Refusal starts no destination read or command");
  assert.equal(q.h.store.route.get(), before.route); assert.equal(q.currentOwner(), q.owner);
  assert.ok(q.owner.isConnected); assert.deepEqual(snapshot(q.h), before.state);
  assert.ok(q.h.store.sourceOwnershipActive(before.source) && q.h.store.authorizationScopeActive(before.authority));
  assert.equal(q.viewerCalls.length, 0); assert.equal(q.owner.captureCommandDeparture().blocked(), true);
  assert.equal(q.focus.nativeFocus.length, before.focus, "Refusal does not move native focus to a destination");
  assert.equal(q.focus.nativeScroll.length, before.scroll);
}
function assertArrival(q, before) {
  assert.equal(q.storeCalls.length, 1); assert.equal(q.storeCalls[0].result, true);
  const writes = q.h.requests.slice(before.requests).filter(request => !["GET", "HEAD", "OPTIONS"].includes(method(request))
    && !q.resume.isReadOnlyResume(request));
  assert.equal(writes.length, 1, "Only the requested exact context handshake; any Resume exemption needs its existing read-only proof");
  assert.equal(method(writes[0]), "POST");
  assert.equal(writes[0].url, "/api/workspaces/" + q.task.organizationId + "/projects/" + q.task.projectAccessId + "/context");
  const context = q.h.store.session.get().projectContext;
  assert.equal(context.organizationId, q.task.organizationId); assert.equal(context.projectAccessId, q.task.projectAccessId);
  assert.equal(context.projectId, q.task.projectId);
  assert.deepEqual(libraryFocusFromRoute(q.h.store.route.get()), { kind: "artifact", id: q.task.artifactId });
  assert.deepEqual(artifactFocusOptionsFromRoute(q.h.store.route.get()),
    { expectedRevision: q.task.revision, expectedContentSha256: q.task.contentSha256, intent: "review" });
  assert.equal(projectTaskDocumentIdFromRoute(q.h.store.route.get()), q.entryDocument);
  assert.equal(q.viewerCalls.length, 1, "One original exact viewer; a successful Store route alone is insufficient");
  const call = q.viewerCalls[0]; assert.equal(call.result, true); assert.equal(call.owner.documentId, q.task.documentId);
  assert.equal(call.owner.isConnected, true); assert.equal(call.owner.querySelector(".document-artifact-view")?.open, true);
  assert.match(q.f.tree().root.text, /EXACT_ASSIGNED_B_BODY/); assert.equal(q.h.store.error.get(), "");
}

for (const dirty of [false, true]) test("Ordinary Workspace review control retains origin / " + (dirty ? "raw document name" : "pristine"), options, async t => {
  const q = await ordinaryReviewPage(t, "workspace"), { f } = q;
  const raw = "  Unsent Document B — kept by its original rename form  ";
  const field = () => f.find("input", node => node.owner === q.owner && node.attributes.id === "document-title-input");
  if (dirty) {
    const rename = f.find("button", node => node.owner === q.owner && node.attributes.title === "Rename document");
    await f.act(rename); const input = field(); assert.equal(input.port.matches(":disabled"), false);
    input.port.value = raw; await f.act(input, "input"); await drain(q);
    assert.equal(field().port.value, raw); assert.equal(q.owner.captureCommandDeparture().blocked(), true);
  }
  const before = await invokeReview(q); diagnose(t, q, before, "workspace", dirty);
  if (!dirty) { assertArrival(q, before); return; }
  assertRefused(q, before); assert.equal(field().port.value, raw, "Exact whitespace and newer name remain in the actual form");
  const cancel = f.find("button", node => node.owner === q.owner && within(node, "document-title-editor")
    && node.attributes.type === "button" && node.text === f.i18n.system("Cancel"));
  await f.act(cancel); await drain(q);
  assert.equal(f.tree().visible("input").filter(node => node.owner === q.owner && node.attributes.id === "document-title-input").length, 0);
  assert.equal(q.owner.captureCommandDeparture().blocked(), false, "Actual Cancel resolves only the local rename; no manual owner reset");
  assert.deepEqual(snapshot(q.h), before.state); assert.equal(q.h.requests.length, before.requests);
  const fresh = await invokeReview(q); assertArrival(q, fresh);
});

for (const dirty of [false, true]) test("Ordinary Library review queue retains origin / " + (dirty ? "cached raw reusable block" : "pristine cached editor"), options, async t => {
  const q = await ordinaryReviewPage(t, "library"), { f } = q;
  const raw = "  direction/unsent-library-B  ";
  const newBlock = () => f.find("button", node => node.owner === q.owner && node.attributes["data-context-controls-id"] === "__new__");
  await f.act(newBlock()); await drain(q);
  assert.deepEqual(libraryBlockEditorFromRoute(q.h.store.route.get()), { blockId: null });
  const editors = f.components().filter(owner => owner.tag === "forma-library-block-editor" && owner.isConnected);
  assert.equal(editors.length, 1); const editor = editors[0]; assert.equal(editor.blockId, null);
  assert.equal(editor.closest("forma-library"), q.owner); assert.equal(editor.navigationBlocked, false);
  const field = () => f.find("input", node => node.owner === editor && node.attributes.maxlength === "96");
  assert.equal(field().port.matches(":disabled"), false); assert.equal(field().port.value, "");
  if (dirty) { const input = field(); input.port.value = raw; await f.act(input, "input"); await drain(q); assert.equal(field().port.value, raw); }
  assert.equal(editor.navigationBlocked, dirty, "The existing editor fingerprint, not a second draft cache, owns this raw field");
  const back = () => f.find("button", node => node.owner === editor && node.text === f.i18n.system("Back to Library"));
  await f.act(back()); await drain(q);
  assert.equal(libraryBlockEditorFromRoute(q.h.store.route.get()), null);
  assert.equal(q.currentOwner(), q.owner); assert.equal(editor.isConnected, false, "Actual Back cache-detaches the editable child");
  assert.equal(editor.navigationBlocked, dirty); assert.equal(q.owner.captureCommandDeparture().blocked(), dirty);
  const before = await invokeReview(q); diagnose(t, q, before, "library", dirty);
  if (!dirty) { assertArrival(q, before); return; }
  assertRefused(q, before); assert.equal(editor.navigationBlocked, true);
  await f.act(newBlock()); await drain(q);
  assert.equal(f.components().find(owner => owner.tag === "forma-library-block-editor" && owner.isConnected), editor,
    "The same cached actual editor is reopened, not reconstructed from a supplied draft");
  assert.equal(field().port.value, raw);
  const input = field(); input.port.value = ""; await f.act(input, "input"); await drain(q);
  assert.equal(editor.navigationBlocked, false, "Deliberately restoring the one changed field to its actual initial value resolves the draft");
  await f.act(back()); await drain(q); assert.equal(q.owner.captureCommandDeparture().blocked(), false);
  assert.deepEqual(snapshot(q.h), before.state); assert.equal(q.h.requests.length, before.requests);
  const fresh = await invokeReview(q); assertArrival(q, fresh);
});
