// Actual full Shell/ProjectContents/Store and RAM Worker assignment/context.
// A real modal forbids background activation: B is entered AFTER the original
// clean review request, never by clicking through an already-open dialog.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { assignmentPage, sceneDeferred, flushStoreFrames, originalFetch, externalCount,
  libraryFocusFromRoute, artifactFocusOptionsFromRoute } from "./helpers/assigned-review-action-fixture.mjs";
import { registerCalmFullPageComponents, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { projectTaskDocumentIdFromRoute } from "../src/model/routes.ts";
import { readWorkspaceEvents } from "../worker/runtime.ts";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";

const pause = () => new Promise(setImmediate);
const method = request => (request.init.method ?? "GET").toUpperCase();
const authoredRows = rows => rows.filter(row => !["DocumentOpened", "ProjectOpened"].includes(row.type));
const sameTask = (actual, expected) => {
  for (const key of ["id", "organizationId", "projectAccessId", "projectId", "documentId", "artifactId", "revision", "contentSha256"])
    assert.equal(actual[key], expected[key], "The actual review preserves exact " + key);
};
async function settleOriginal(q, pending) {
  let done = false, value, failure;
  pending.then(result => { value = result; done = true; }, error => { failure = error; done = true; });
  for (let turn = 0; turn < 48 && !done; turn++) {
    await flushStoreFrames(q.h); await q.f.settle(); await pause();
  }
  assert.ok(done, "The original current operation settles using existing native frames");
  if (failure) throw failure;
  return value;
}
function currentOwner(q) {
  const owners = q.f.components().filter(owner => owner.tag === "forma-project-contents" && owner.isConnected);
  assert.ok(owners.length <= 1, "No substitute or duplicate ProjectContents owner");
  return owners[0] ?? null;
}
function currentName(q, required = true) {
  const owner = currentOwner(q), tree = q.f.tree();
  const dialogs = tree.visible("dialog").filter(node => node.owner === owner
    && String(node.attributes.class ?? "").split(/\s+/u).includes("new-document-dialog"));
  const fields = tree.visible("input").filter(node => node.owner === owner && node.attributes.maxlength === "80"
    && dialogs.some(dialog => { for (let parent = node.parent; parent; parent = parent.parent) if (parent === dialog) return true; return false; }));
  assert.ok(fields.length <= 1);
  if (required) { assert.equal(dialogs.length, 1); assert.equal(fields.length, 1); assert.ok(dialogs[0].port.open); }
  return fields[0] ?? null;
}
function reviewButton(q) {
  const owner = currentOwner(q), tree = q.f.tree();
  assert.ok(owner, "The actual current ProjectContents is mounted");
  assert.equal(tree.visible("dialog").filter(node => node.port?.open).length, 0,
    "Never activate an inert background review behind a native modal");
  const buttons = tree.visible("button").filter(node => {
    if (node.owner !== owner || node.text !== q.f.i18n.t("activity.openReview", "Open assigned review")) return false;
    let item = node.parent; while (item && item.tag !== "li") item = item.parent;
    return item?.text.includes(q.task.artifactTitle) && item.text.includes(q.task.documentTitle);
  });
  assert.equal(buttons.length, 1); return buttons[0];
}
async function activate(q, node, event = "click") {
  assert.ok(node.port?.isConnected); assert.equal(node.port.matches(":disabled"), false);
  q.native.emit("pointerdown", node.port); q.native.focus(node.port);
  await q.f.act(node, event);
}
async function projectReviewPage(t) {
  const cleanups = [], previousFetch = globalThis.fetch;
  const ownedTest = { mock: t.mock, after(callback) { cleanups.push(callback); } };
  let q;
  t.after(async () => {
    try {
      if (q) {
        await settleOriginal(q, Promise.all((q.reviewCalls ?? []).map(call => call.pending)));
        await settleOriginal(q, Promise.all((q.viewerCalls ?? []).map(call => call.pending)));
      }
    } finally {
      try { for (const cleanup of cleanups) await cleanup(); }
      finally { globalThis.fetch = previousFetch; }
    }
  });
  q = await assignmentPage(ownedTest, "different-document", { projectAuthor: true });
  const { h, f } = q;
  globalThis.fetch = (url, init) => { assert.ok(String(url).startsWith("/api/")); return h.fetch(url, init); };
  await registerCalmFullPageComponents(f, ["forma-project-contents"]);
  h.store.setRoute("/studio/project"); await flushStoreFrames(h); await f.settle();
  q.owner = currentOwner(q); assert.ok(q.owner instanceof f.renderer.registry["forma-project-contents"]);
  assert.equal(q.owner.parentElement.tag, "forma-creative-application");
  assert.equal(f.host.tag, "forma-shell");
  // The inherited dialog port returns an unset fixture.workspace as undefined;
  // normalize only nullish absence, then independently check actual ancestry.
  assert.equal(q.owner.closest("forma-workspace") ?? null, null);
  for (let ancestor = q.owner.parentElement; ancestor; ancestor = ancestor.parentElement)
    assert.notEqual(ancestor.tag, "forma-workspace", "The current actual component tree has no Workspace parent");
  assert.equal(h.store.session.get().projectContext.role, "editor", "Real pre-baseline membership enables the native author control");
  assert.ok(h.store.session.get().projectContext.permissions.includes("project.author"));
  assert.ok(h.store.session.get().projectContext.permissions.includes("project.review.approve"));
  assert.equal(h.store.projection.get().projectId, q.task.projectId);
  // Overview is project-level, not the prior Activity's Document-addressed route.
  const overview = h.store.projection.get(), overviewDocument = overview.documents.find(document => document.id === overview.documentId);
  assert.ok(overviewDocument && !overviewDocument.removed, "The current Overview Document has its exact readable backing record");
  assert.equal(overviewDocument.projectId, q.task.projectId); q.overviewDocumentId = overviewDocument.id;
  assert.equal(q.overviewDocumentId, q.targetDocument, "This fixture's unaddressed Overview selects actual B, not the earlier Activity address A");
  assert.equal(h.store.route.get(), "/studio/project");
  assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), null, "No fabricated Document query is attributed to Overview");
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), true);
  assert.equal(h.store.reviewInbox.get().filter(task => task.id === q.task.id).length, 1);
  q.native = installOutputNavigationFocusNative(ownedTest, f, ports);
  q.reviewCalls = []; const original = h.store.openAssignedReview;
  t.mock.method(h.store, "openAssignedReview", function (...args) {
    sameTask(args[0], q.task);
    const call = { pending: null, done: false }; q.reviewCalls.push(call);
    call.pending = original.apply(this, args);
    void call.pending.then(value => { call.result = value; call.done = true; }, error => { call.error = String(error); call.done = true; });
    return call.pending; // One original invocation/promise, never a success substitute.
  });
  await f.settle(); reviewButton(q); return q;
}
async function assertExactArrival(q) {
  await settleOriginal(q, Promise.all(q.reviewCalls.map(call => call.pending)));
  await settleOriginal(q, Promise.all(q.viewerCalls.map(call => call.pending))); await q.f.settle();
  assert.deepEqual(libraryFocusFromRoute(q.h.store.route.get()), { kind: "artifact", id: q.task.artifactId });
  assert.deepEqual(artifactFocusOptionsFromRoute(q.h.store.route.get()), {
    expectedRevision: q.task.revision, expectedContentSha256: q.task.contentSha256, intent: "review" });
  assert.equal(projectTaskDocumentIdFromRoute(q.h.store.route.get()), q.overviewDocumentId, "The original Overview return Document is preserved");
  assert.equal(q.viewerCalls.length, 1); const viewer = q.viewerCalls[0];
  assert.equal(viewer.id, q.task.artifactId); assert.equal(viewer.result, true);
  assert.equal(viewer.owner.documentId, q.task.documentId); assert.equal(viewer.owner.isConnected, true);
  assert.equal(viewer.owner.querySelector(".document-artifact-view")?.open, true);
  assert.match(q.f.tree().root.text, /EXACT_ASSIGNED_B_BODY/u);
}

for (const newerRaw of [false, true]) test("ProjectContents exact review held positive body / " +
  (newerRaw ? "new ordinary document name survives" : "unchanged owner reaches the original viewer"),
  { concurrency: false, timeout: 30_000 }, async t => {
    const entered = sceneDeferred(), release = sceneDeferred(); t.after(() => release.resolve());
    const q = await projectReviewPage(t), { h, f, owner } = q;
    const route = h.store.route.get(), source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
    const money = financial(q.w), canonical = await readWorkspaceEvents(q.w.env, q.w.streamId);
    const path = "/api/workspaces/" + q.task.organizationId + "/projects/" + q.task.projectAccessId + "/context";
    const prior = h.intercept; let commands = 0, bodyReads = 0, armed = true, positive;
    h.intercept = async request => {
      if (!armed || request.url !== path || method(request) !== "POST") return prior?.(request);
      commands++; assert.equal(commands, 1);
      const response = await q.nativeRequest(request);
      assert.equal(response.status, 200); assert.ok(response.headers.get("set-cookie"));
      positive = await response.clone().json();
      assert.equal(positive.projectId, q.task.projectId); assert.equal(positive.projectAccessId, q.task.projectAccessId);
      assert.equal(positive.organizationId, q.task.organizationId);
      assert.ok(positive.permissions.includes("project.author")); assert.ok(positive.permissions.includes("project.review.approve"));
      const json = response.json.bind(response);
      Object.defineProperty(response, "json", { value: async () => { bodyReads++; entered.resolve(); await release.promise; return json(); } });
      return response;
    };
    const before = h.requests.length;
    const activation = activate(q, reviewButton(q)); await settleOriginal(q, entered.promise); await activation;
    assert.equal(q.reviewCalls.length, 1); assert.equal(q.reviewCalls[0].done, false);
    assert.equal(commands, 1); assert.equal(bodyReads, 1); assert.equal(h.store.route.get(), route);
    assert.equal(currentOwner(q), owner); assert.equal(h.store.sourceOwnershipActive(source), true);
    const raw = "  New document B — 元の入力を保持  ";
    if (newerRaw) {
      const create = f.find("button", node => node.owner === owner && node.text === f.i18n.system("New document"));
      await activate(q, create);
      const field = currentName(q); assert.equal(Object.hasOwn(field.attributes, "readonly"), false);
      q.native.emit("pointerdown", field.port); q.native.focus(field.port);
      field.port.value = raw; await f.act(field, "input");
      assert.equal(currentName(q).port.value, raw); assert.equal(q.reviewCalls[0].done, false);
      assert.equal(commands, 1, "Typing B neither submits a new document nor starts another context selection");
    }
    const afterB = h.requests.length; release.resolve();
    await settleOriginal(q, q.reviewCalls[0].pending);
    await settleOriginal(q, Promise.all(q.viewerCalls.map(call => call.pending))); await f.settle();
    await h.store.refreshEvents({ fromStart: true }); await flushStoreFrames(h); await f.settle();
    const writes = h.requests.slice(before).filter(request => !["GET", "HEAD", "OPTIONS"].includes(method(request)));
    const current = currentName(q, false);
    t.diagnostic("C_PROJECT_CONTENTS_REVIEW " + JSON.stringify({ newerRaw, commands, bodyReads,
      originalResult: q.reviewCalls[0].result, originalDone: q.reviewCalls[0].done,
      route: h.store.route.get(), sameOwner: currentOwner(q) === owner, ownerConnected: owner.isConnected,
      raw: current?.port.value ?? null, viewerCalls: q.viewerCalls.length,
      writes: writes.map(request => ({ url: request.url, method: method(request) })),
      evidence: "Actual original Worker context200/cookie and connected native controls; no initial-modal background click, provider or physical claim" }));
    assert.equal(commands, 1); assert.equal(bodyReads, 1); assert.equal(writes.length, 1); assert.equal(writes[0].url, path);
    assert.deepEqual(financial(q.w), money);
    assert.deepEqual(authoredRows(await readWorkspaceEvents(q.w.env, q.w.streamId)), authoredRows(canonical),
      "No authoring, copy, approval, result or financial event; existing normal navigation receipts are not creation acknowledgments");
    assert.equal(h.store.captureAuthorizationScope().key, authorization.key);
    assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), true);
    if (!newerRaw) { assert.equal(q.reviewCalls[0].result, true); await assertExactArrival(q); return; }
    assert.equal(h.requests.slice(afterB).filter(request => method(request) === "POST" && request.url === path).length, 0,
      "There is one original context write before B, never a new write after B");
    assert.equal(h.store.route.get(), route, "The old review must not replace the newer ordinary document-name form");
    assert.equal(currentOwner(q), owner); assert.equal(owner.isConnected, true); assert.equal(current?.port.value, raw);
    assert.equal(q.reviewCalls[0].result, false); assert.equal(q.viewerCalls.length, 0);
    // Explicit local discard is a new gesture, not an automatic resume/retry.
    const close = f.find("button", node => node.owner === owner
      && String(node.attributes.class ?? "").split(/\s+/u).includes("modal-close"));
    await activate(q, close); assert.equal(currentName(q, false), null); armed = false;
    await activate(q, reviewButton(q)); assert.equal(q.reviewCalls.length, 2);
    await settleOriginal(q, q.reviewCalls[1].pending);
    assert.equal(q.reviewCalls[1].result, true); await assertExactArrival(q);
    assert.equal(h.requests.slice(before).filter(request => method(request) === "POST" && request.url === path).length, 2,
      "Only the original and the deliberate fresh review selected a context");
    assert.deepEqual(financial(q.w), money);
    assert.deepEqual(authoredRows(await readWorkspaceEvents(q.w.env, q.w.streamId)), authoredRows(canonical));
  });
after(() => { globalThis.fetch = originalFetch; assert.equal(externalCount(), 0); });
