// Four baseline cases for ordinary Activity context departures. Reuse the
// complete existing reviewer/Worker/cookie/Store/Shell fixture; do not approve,
// request changes, generate, retry, dismiss or replace a navigation result.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { assignmentPage, sceneDeferred, flushStoreFrames, responseBody, originalFetch, externalCount,
  libraryFocusFromRoute, artifactFocusOptionsFromRoute } from "./helpers/assigned-review-action-fixture.mjs";
import { calmFullPageNativePorts as ports, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { readWorkspaceEvents } from "../worker/runtime.ts";
import { foldEvents } from "../src/model/events.ts";
import { projectTaskDocumentIdFromRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";

after(() => { assert.equal(externalCount(), 0); globalThis.fetch = originalFetch; });
const method = row => String(row.init.method ?? "GET").toUpperCase();
const inside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
const one = (rows, message) => { assert.equal(rows.length, 1, message); return rows[0]; };
const taskKeys = ["id", "organizationId", "projectAccessId", "projectId", "documentId", "artifactId", "artifactKind",
  "revision", "contentSha256", "artifactTitle", "documentTitle", "projectName", "organizationName"];
const snapshot = h => structuredClone({ events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get(), session: h.store.session.get() });

async function finish(q, pending) {
  let done = false, result, error;
  Promise.resolve(pending).then(value => { result = value; done = true; }, caught => { error = caught; done = true; });
  for (let turn = 0; turn < 32 && !done; turn++) { await flushStoreFrames(q.h); await q.f.settle(); await new Promise(setImmediate); }
  assert.ok(done, "The original current Activity/Store/Library operation settles under existing native frames");
  if (error) throw error;
  return result;
}

async function activityContextPage(t) {
  const cleanups = [], calls = [], previousFetch = globalThis.fetch;
  const ownedTest = { mock: t.mock, after(callback) { cleanups.push(callback); } };
  let q, resume;
  t.after(async () => {
    try {
      if (q) {
        await finish(q, Promise.allSettled(calls.map(call => call.pending)));
        await finish(q, Promise.allSettled(q.viewerCalls.map(call => call.pending)));
        await flushStoreFrames(q.h); await q.f.settle(); await resume?.settleOriginalRequests();
      }
    } finally {
      resume?.restore();
      try { for (const cleanup of cleanups) await cleanup(); } finally { globalThis.fetch = previousFetch; }
    }
  });
  q = await assignmentPage(ownedTest, "same-document", { personalSource: true });
  const { h, f } = q;
  await registerCalmFullPageComponents(f, ["forma-activity", "forma-library", "forma-projects", "forma-workspace"]);
  const native = installOutputNavigationFocusNative(ownedTest, f, ports);
  await flushStoreFrames(h); await f.settle(); await h.store.syncReviewInbox(); await f.settle();
  resume = observeActualSceneResumeReads(h);
  const owner = one(f.components().filter(value => value.tag === "forma-activity" && value.isConnected), "one actual current Activity owner");
  assert.equal(owner.closest("forma-shell"), f.host); assert.equal(f.host.tag, "forma-shell");
  assert.equal(owner.store, h.store); assert.equal(f.host.store, h.store);
  assert.equal(h.store.session.get().projectContext.projectAccessId, q.task.projectAccessId);
  assert.ok(h.store.session.get().projectContext.permissions.includes("project.review.approve"));
  assert.equal(h.store.projection.get().documentId, q.entryDocument);
  assert.notEqual(q.secondTask.id, q.task.id); assert.equal(q.secondTask.documentId, q.task.documentId);
  const reviewRow = task => {
    const tree = f.tree(), panel = one(tree.nodes.filter(row => row.component?.tag === "forma-activity-issue-panel"
      && row.component.isConnected && row.component.review?.id === task.id), "one exact current assigned-review child");
    assert.equal(panel.component.store, h.store);
    for (const key of taskKeys) assert.equal(panel.component.review[key], task[key], "current exact task retains " + key);
    const card = one(tree.visible("article").filter(row => row.owner === owner && inside(panel, row)), "one current full assigned-review card");
    const open = one(tree.visible("button").filter(row => row.owner === owner && inside(row, card) && row.attributes.class === "button primary"), "one original Open assigned review control");
    assert.equal(open.text, f.i18n.t("activity.openReview", "Open assigned review"));
    assert.equal(open.attributes["aria-label"], f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", { action: open.text, name: card.attributes["aria-label"] }));
    assert.ok(card.text.includes(task.artifactTitle) && card.text.includes(task.documentTitle));
    const field = one(tree.visible("textarea").filter(row => row.owner === panel.component && inside(row, card)), "one actual sibling review-note field");
    assert.ok(field.port?.isConnected && !field.hiddenBy && !field.port.matches(":disabled") && !field.port.readOnly);
    assert.equal(field.attributes["aria-label"], f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", {
      action: f.i18n.t("activity.issue.reviewNote", "Describe the required changes"), name: panel.component.reviewContext.name,
    }));
    return { panel: panel.component, card, open, field };
  };
  const sibling = reviewRow(q.secondTask);
  assert.equal(sibling.field.port.value, ""); assert.equal(sibling.panel.navigationBlocked, false);
  assert.equal(owner.captureCommandDeparture().blocked(), false);
  const personalStream = "creative:" + h.store.session.get().user.userId;
  const personalEvents = await readWorkspaceEvents(q.w.env, personalStream), personal = foldEvents(personalEvents, Infinity);
  assert.equal(personal.projectId, "assigned-personal-project-a"); assert.equal(personal.documentId, "assigned-personal-document-a");
  assert.ok(personal.documents.some(row => row.id === personal.documentId && row.projectId === personal.projectId && !row.removed));
  return { ...q, calls, resume, native, owner, reviewRow, sibling, personalStream, personalEvents, personal };
}

for (const entry of ["assigned-review", "view-all"]) for (const dirty of [false, true])
  test("Activity ordinary " + entry + " departure / " + (dirty ? "raw sibling review note" : "pristine"),
    { timeout: 60000, concurrency: false }, async t => {
      const q = await activityContextPage(t), { h, f, owner } = q;
      const raw = "  Exact unsent sibling review note B — 保持するメモ  ";
      if (dirty) {
        q.sibling.field.port.value = raw; await f.act(q.sibling.field, "input");
        const current = q.reviewRow(q.secondTask);
        assert.equal(current.panel, q.sibling.panel); assert.equal(current.field.port.value, raw);
        assert.equal(current.panel.navigationBlocked, true); assert.equal(owner.captureCommandDeparture().blocked(), true);
      }
      const before = snapshot(h), route = h.store.route.get(), source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
      assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      const history = await readWorkspaceEvents(q.w.env, q.w.streamId), money = financial(q.w);
      const privateRows = q.w.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all();
      const receiptRows = q.w.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
      const methodName = entry === "assigned-review" ? "openAssignedReview" : "leaveProjectContext", original = h.store[methodName];
      t.mock.method(h.store, methodName, function(...args) {
        if (entry === "assigned-review") for (const key of taskKeys) assert.equal(args[0][key], q.task[key], "original Store receives exact " + key);
        const call = { result: undefined }; q.calls.push(call);
        call.pending = original.apply(this, args); // Observe/join the unchanged original, never fabricate its result.
        void call.pending.then(result => { call.result = result; }, error => { call.error = String(error); });
        return call.pending;
      });
      const button = entry === "assigned-review" ? q.reviewRow(q.task).open : f.find("button", row => row.owner === owner
        && row.text === f.i18n.t("activity.viewAllAssignments", "View all my assigned reviews"));
      assert.equal(button.attributes.type, "button"); assert.ok(button.port.isConnected); assert.equal(button.port.matches(":disabled"), false);
      const start = h.requests.length;
      q.native.emit("pointerdown", button.port); q.native.focus(button.port); await f.act(button, "click", { button: 0 });
      for (let turn = 0; !dirty && !q.calls.length && turn < 32; turn++) { await flushStoreFrames(h); await f.settle(); }
      await finish(q, Promise.all(q.calls.map(call => call.pending)));
      await flushStoreFrames(h); await f.settle();
      await finish(q, Promise.all(q.viewerCalls.map(call => call.pending)));
      await flushStoreFrames(h); await f.settle(); await q.resume.settleOriginalRequests(); await q.w.drainBackground();
      const requests = h.requests.slice(start), mutations = requests.filter(row => !["GET", "HEAD", "OPTIONS"].includes(method(row)) && !q.resume.isReadOnlyResume(row));
      t.diagnostic("ACTIVITY_CURRENT_CONTEXT_DEPARTURE " + JSON.stringify({ entry, dirty, route: h.store.route.get(),
        sourceActive: h.store.sourceOwnershipActive(source), sameOwner: owner.isConnected,
        siblingConnected: q.sibling.panel.isConnected, rawRetained: f.tree().visible("textarea").some(row => row.owner === q.sibling.panel && row.port?.value === (dirty ? raw : "")),
        calls: q.calls.map(call => ({ result: call.result ?? null, error: call.error ?? null })),
        viewers: q.viewerCalls.map(call => ({ id: call.id, result: call.result ?? null })),
        requests: requests.map(row => ({ method: method(row), path: row.url })) }));
      assert.deepEqual(await readWorkspaceEvents(q.w.env, q.w.streamId), history, "No source, result, review decision or navigation event is authored by these same-Document entries");
      assert.deepEqual(await readWorkspaceEvents(q.w.env, q.personalStream), q.personalEvents, "The existing personal source is not fabricated or rewritten");
      assert.deepEqual(financial(q.w), money); assert.deepEqual(q.w.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), privateRows);
      assert.deepEqual(q.w.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), receiptRows);
      assert.equal(h.requests.slice(start).filter(row => row.url.startsWith("/api/document-jobs") && method(row) !== "GET").length, 0);
      if (dirty) {
        assert.equal(mutations.length, 0, "An actual unsent sibling note refuses before a context-cookie mutation");
        assert.equal(requests.length, 0); assert.equal(q.calls.length, 0); assert.equal(q.viewerCalls.length, 0);
        assert.equal(h.store.route.get(), route); assert.ok(owner.isConnected && q.sibling.panel.isConnected);
        const retained = q.reviewRow(q.secondTask);
        assert.equal(retained.panel, q.sibling.panel); assert.equal(retained.field.port.value, raw);
        assert.equal(retained.panel.navigationBlocked, true); assert.equal(owner.captureCommandDeparture().blocked(), true);
        assert.deepEqual(snapshot(h), before); assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      } else {
        assert.equal(q.calls.length, 1); assert.equal(q.calls[0].result, true);
        assert.equal(mutations.length, 1, "One deliberate context command, no approval, replacement or unproved Resume");
        const response = await responseBody(await q.nativeRequest({ url: "/api/session", init: {} }));
        if (entry === "view-all") {
          assert.equal(method(mutations[0]), "DELETE"); assert.equal(mutations[0].url, "/api/workspaces/context");
          assert.equal(response.projectContext, undefined); assert.equal(h.store.session.get().projectContext, undefined);
          const expected = withProjectTaskDocumentInRoute("/activity", q.personal.documentId);
          assert.equal(h.store.route.get(), expected); assert.equal(projectTaskDocumentIdFromRoute(expected), q.personal.documentId);
          assert.equal(h.store.projection.get().projectId, q.personal.projectId); assert.equal(h.store.projection.get().documentId, q.personal.documentId);
          assert.equal(h.store.sourceOwnershipActive(source), false); assert.equal(q.viewerCalls.length, 0);
          const arrived = one(f.components().filter(value => value.tag === "forma-activity" && value.isConnected), "actual personal Activity destination");
          assert.equal(arrived.store, h.store); assert.ok(h.store.reviewInbox.get().some(task => task.id === q.task.id), "All assignments remain available under the actual personal session");
        } else {
          assert.equal(method(mutations[0]), "POST"); assert.equal(mutations[0].url, "/api/workspaces/" + q.task.organizationId + "/projects/" + q.task.projectAccessId + "/context");
          assert.equal(response.projectContext.projectAccessId, q.task.projectAccessId); assert.equal(h.store.session.get().projectContext.projectAccessId, q.task.projectAccessId);
          assert.deepEqual(libraryFocusFromRoute(h.store.route.get()), { kind: "artifact", id: q.task.artifactId });
          assert.deepEqual(artifactFocusOptionsFromRoute(h.store.route.get()), { expectedRevision: q.task.revision, expectedContentSha256: q.task.contentSha256, intent: "review" });
          assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), q.entryDocument, "Exact same-project Work return stays bound to the real original Document");
          assert.equal(q.viewerCalls.length, 1); const viewer = q.viewerCalls[0];
          assert.equal(viewer.id, q.task.artifactId); assert.equal(viewer.result, true); assert.ok(viewer.owner.isConnected);
          assert.equal(viewer.owner.documentId, q.task.documentId); assert.equal(viewer.owner.querySelector(".document-artifact-view")?.open, true);
          assert.match(f.tree().root.text, /EXACT_ASSIGNED_B_BODY/);
        }
        assert.equal(h.store.error.get(), "");
      }
    });

// Preserve the four native current/raw cases above. This pair observes the
// original public load result, then lets a real same-Source load supersede it.
for (const superseded of [false, true]) test("Activity View all completed-load ownership / " + (superseded ? "newer same-source load" : "healthy held completion"),
  { timeout: 60000, concurrency: false }, async t => {
    const firstCompleted = sceneDeferred(), releaseFirst = sceneDeferred(), newerBody = sceneDeferred();
    const releaseNewerBody = sceneDeferred(), releaseNewerRoute = sceneDeferred();
    t.after(() => { releaseFirst.resolve(); releaseNewerBody.resolve(); releaseNewerRoute.resolve(); });
    const q = await activityContextPage(t), { h, f, owner } = q;
    const originalSource = h.store.captureSourceOwnership(), actor = h.store.session.get().user.userId;
    const history = await readWorkspaceEvents(q.w.env, q.w.streamId), money = financial(q.w);
    const privateRows = q.w.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all();
    const receiptRows = q.w.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
    const leave = h.store.leaveProjectContext;
    t.mock.method(h.store, "leaveProjectContext", function (...args) {
      const call = { result: undefined }; q.calls.push(call); call.pending = leave.apply(this, args);
      void call.pending.then(value => { call.result = value; }, error => { call.error = String(error); });
      return call.pending;
    });
    const load = h.store.load; let loadCalls = 0;
    t.mock.method(h.store, "load", function (...args) {
      const index = ++loadCalls, pending = load.apply(this, args);
      if (index !== 1) return pending;
      return pending.then(async value => { firstCompleted.resolve(); await releaseFirst.promise; return value; });
    });
    const prior = h.intercept; let holdNewerSession = false, newerBodies = 0;
    h.intercept = async request => {
      if (!holdNewerSession || method(request) !== "GET" || request.url !== "/api/session") return prior?.(request);
      holdNewerSession = false;
      const response = await q.nativeRequest(request); assert.equal(response.status, 200);
      const actual = await response.clone().json(); assert.equal(actual.user.userId, actor); assert.equal(actual.projectContext, undefined);
      const json = response.json.bind(response);
      Object.defineProperty(response, "json", { value: async () => {
        newerBodies++; newerBody.resolve(); await releaseNewerBody.promise; return json();
      } });
      return response;
    };
    let newerLoad = null, activation;
    const start = h.requests.length;
    try {
      const button = f.find("button", row => row.owner === owner
        && row.text === f.i18n.t("activity.viewAllAssignments", "View all my assigned reviews"));
      assert.ok(button.port.isConnected && !button.hiddenBy && !button.port.matches(":disabled"));
      q.native.emit("pointerdown", button.port); q.native.focus(button.port);
      activation = f.act(button, "click", { button: 0 });
      await finish(q, firstCompleted.promise);
      assert.equal(loadCalls, 1); assert.equal(q.calls.length, 1);
      assert.equal(h.store.session.get().projectContext, undefined); assert.equal(h.store.session.get().user.userId, actor);
      assert.equal(h.store.sourceOwnershipActive(originalSource), false); assert.equal(h.store.loading.get(), false);
      const heldRoute = h.store.route.get(), personalSource = h.store.captureSourceOwnership();
      assert.equal(h.store.sourceOwnershipActive(personalSource), true);
      assert.ok(h.store.events.get().length > 0, "The first load really published authorized personal events before its result is held");
      if (superseded) {
        holdNewerSession = true;
        newerLoad = h.store.load({ routeHandoff: releaseNewerRoute.promise });
        await finish(q, newerBody.promise);
        assert.equal(loadCalls, 2); assert.equal(newerBodies, 1); assert.equal(h.store.loading.get(), true);
        assert.equal(h.store.route.get(), heldRoute); assert.equal(h.store.sourceOwnershipActive(personalSource), true);
      }
      releaseFirst.resolve();
      await finish(q, Promise.all(q.calls.map(call => call.pending))); await finish(q, activation);
      await flushStoreFrames(h); await f.settle();
      t.diagnostic("C_ACTIVITY_VIEW_ALL_LOAD_OWNER " + JSON.stringify({ superseded, loadCalls, newerBodies,
        heldRoute, currentRoute: h.store.route.get(), originalResult: q.calls[0].result ?? null,
        personalSourceActive: h.store.sourceOwnershipActive(personalSource), newerLoadPending: h.store.loading.get(),
        requests: h.requests.slice(start).map(request => ({ url: request.url, method: method(request) })) }));
      if (superseded) {
        assert.equal(h.store.route.get(), heldRoute, "The older load completion cannot commit a destination while a newer same-Source load is pending");
        assert.equal(q.calls[0].result, false); assert.equal(h.store.loading.get(), true);
        releaseNewerBody.resolve(); await finish(q, newerLoad);
        assert.equal(h.store.sourceOwnershipActive(personalSource), true); assert.equal(h.store.session.get().projectContext, undefined);
        assert.equal(h.store.session.get().user.userId, actor);
        assert.equal(foldEvents(h.store.events.get(), Infinity).documentId, q.personal.documentId);
        assert.equal(h.store.route.get(), heldRoute, "Only the new load's independently held route callbacks remain; the old View-all did not move it");
      } else {
        assert.equal(q.calls[0].result, true);
        assert.equal(h.store.route.get(), withProjectTaskDocumentInRoute("/activity", q.personal.documentId));
        assert.equal(h.store.projection.get().documentId, q.personal.documentId);
        assert.equal(h.store.projection.get().projectId, q.personal.projectId);
      }
      await q.resume.settleOriginalRequests();
      const mutations = h.requests.slice(start).filter(row => !["GET", "HEAD", "OPTIONS"].includes(method(row)) && !q.resume.isReadOnlyResume(row));
      assert.deepEqual(mutations.map(row => [method(row), row.url]), [["DELETE", "/api/workspaces/context"]]);
      assert.equal(q.viewerCalls.length, 0); assert.equal(h.store.error.get(), "");
      assert.deepEqual(await readWorkspaceEvents(q.w.env, q.w.streamId), history);
      assert.deepEqual(await readWorkspaceEvents(q.w.env, q.personalStream), q.personalEvents);
      assert.deepEqual(financial(q.w), money); assert.deepEqual(q.w.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), privateRows);
      assert.deepEqual(q.w.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), receiptRows);
    } finally {
      releaseFirst.resolve(); releaseNewerBody.resolve(); releaseNewerRoute.resolve();
      if (newerLoad) await finish(q, newerLoad);
      if (activation) await finish(q, activation);
      await flushStoreFrames(h); await f.settle();
    }
  });
