// Actual RAM Worker context-cookie selection, connected Settings/Store/Shell.
// The shared finite helper supplies native form lifetime/default reflection
// only; its Settings service/setup is never invoked by these two cases.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { assignmentPage, sceneDeferred, flushStoreFrames, responseBody, originalFetch, externalCount, libraryFocusFromRoute, artifactFocusOptionsFromRoute } from "./helpers/assigned-review-action-fixture.mjs";
import { projectTaskDocumentIdFromRoute } from "../src/model/routes.ts";
import { nativeFormLifetime, nativeDefaultProperties, ports } from "./helpers/workspace-settings-fragment-fixture.mjs";
import { registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";

const pause = () => new Promise(setImmediate);
async function until(check, message) {
  for (let turn = 0; turn < 120; turn++) { if (check()) return; await pause(); }
  assert.ok(check(), message);
}
const method = request => (request.init.method ?? "GET").toUpperCase();
const currentSettings = f => f.components().filter(owner => owner.isConnected && owner.tag === "forma-workspace-settings");
const currentOrganizationForms = (f, owner) => f.tree().visible("form")
  .filter(node => node.owner === owner && String(node.handlers.submit).includes("#submitOrganization"));
const snapshot = h => structuredClone({ events: h.store.events.get(), head: h.store.head.get(),
  content: h.store.content.get(), session: h.store.session.get() });

async function settingsContextPage(t, { entry = "cross-project", personalSource = false } = {}) {
  const cleanups = [], operations = [], previousFetch = globalThis.fetch;
  const ownedTest = { mock: t.mock, after(callback) { cleanups.push(callback); } };
  let q;
  t.after(async () => {
    try {
      if (q) {
        await until(() => operations.every(operation => !operation.requested || operation.finished), "Every dispatched original context finishes before fixture cleanup");
        await flushStoreFrames(q.h); await q.f.settle();
      }
    } finally {
      try { for (const cleanup of cleanups) await cleanup(); }
      finally { globalThis.fetch = previousFetch; }
    }
  });
  q = await assignmentPage(ownedTest, entry, { differentTargets: true, personalSource });
  const { h, f } = q;
  globalThis.fetch = (url, init) => {
    assert.ok(String(url).startsWith("/api/"), "Only the actual RAM Worker is reachable");
    return h.fetch(url, init);
  };
  await registerCalmFullPageComponents(f, ["forma-workspace-settings", "forma-projects"]);
  h.store.setRoute("/settings/workspaces"); await flushStoreFrames(h); await f.settle();
  const owners = currentSettings(f); assert.equal(owners.length, 1);
  const owner = owners[0]; assert.ok(owner instanceof f.renderer.registry["forma-workspace-settings"]);
  assert.equal(f.host.tag, "forma-shell"); assert.equal(owner.parentElement.tag, "forma-creative-application");
  assert.equal(h.store.session.get().user.role, "creator", "Actual reviewer identity may prepare a new organization name");
  if (entry === "cross-project") assert.equal(h.store.session.get().projectContext, undefined);
  else {
    assert.equal(h.store.session.get().projectContext.projectId, q.task.projectId);
    assert.equal(h.store.session.get().projectContext.projectAccessId, q.task.projectAccessId);
    assert.equal(h.store.projection.get().documentId, q.entryDocument);
  }
  // The existing nativeFormLifetime exclusively owns this Map; no second raw
  // field cache, fake FormData result, submitter, or application state is added.
  assert.equal(f.forms, undefined); f.forms = new Map();
  const focus = installOutputNavigationFocusNative(ownedTest, f, ports);
  const currentOwner = () => currentSettings(f)[0] ?? null;
  const native = nativeFormLifetime(f, { marker: "#submitOrganization" }, { owner: currentOwner });
  nativeDefaultProperties({ f, currentOwner });
  await f.settle();
  const form = native.current(); assert.equal(form.owner, owner);
  assert.deepEqual(native.raw(form.port), { name: "" });
  assert.equal(form.port.elements.namedItem("name").defaultValue, "");
  assert.equal(owner.captureCommandDeparture().blocked(), false, "Pristine actual Settings owner is not busy or dirty");
  const open = () => f.find("button", node => node.owner === currentOwner()
    && node.attributes["aria-label"] === "Open Assigned Project C");
  assert.ok(open().port.isConnected);
  const begin = h.store.beginProjectContextSelection;
  t.mock.method(h.store, "beginProjectContextSelection", function (...args) {
    const selection = begin.apply(this, args), operation = { requested: false, finished: false };
    operations.push(operation);
    const request = selection.request, finish = selection.finish;
    t.mock.method(selection, "request", function (...values) {
      operation.requested = true; return request.apply(this, values);
    });
    t.mock.method(selection, "finish", function (...values) {
      const pending = finish.apply(this, values);
      void pending.then(() => { operation.finished = true; }, () => { operation.finished = true; });
      return pending;
    });
    return selection;
  });
  return { ...q, owner, native, focus, form: form.port, open, operations, currentOwner };
}

for (const dirty of [false, true]) test("Workspace Settings actual shared-project opening / " + (dirty ? "unsent organization name" : "pristine"),
  { timeout: 40_000, concurrency: false }, async t => {
    const q = await settingsContextPage(t), { h, f, native, owner } = q;
    const name = "Newer unsent organization B";
    if (dirty) {
      assert.equal(native.fill({ name }).port, q.form);
      assert.equal(owner.captureCommandDeparture().blocked(), true, "The existing owner predicate sees the actual native raw field");
    }
    const original = snapshot(h), route = h.store.route.get(), source = h.store.captureSourceOwnership();
    const before = h.requests.length, button = q.open();
    q.focus.focus(button.port); await f.act(button);
    await until(() => q.operations.every(operation => !operation.requested || operation.finished), "Join the original context operation, not a replacement load");
    await flushStoreFrames(h); await f.settle();
    const requests = h.requests.slice(before), writes = requests.filter(request => !["GET", "HEAD", "OPTIONS"].includes(method(request)));
    const forms = currentOrganizationForms(f, q.currentOwner()), currentForm = forms[0]?.port;
    t.diagnostic("C_SETTINGS_ORIGINAL_CONTEXT " + JSON.stringify({ dirty, route: h.store.route.get(),
      project: h.store.session.get().projectContext?.projectId ?? null, sameOwner: q.currentOwner() === owner,
      sameForm: currentForm === q.form, originalConnected: q.form.isConnected,
      raw: currentForm ? native.raw(currentForm) : null, sourceActive: h.store.sourceOwnershipActive(source),
      requests: requests.map(request => ({ url: request.url, method: method(request) })),
      operations: q.operations.map(operation => ({ ...operation })) }));
    if (dirty) {
      assert.equal(writes.length, 0, "An unsent native organization name refuses project-context departure before any cookie mutation");
      assert.equal(requests.length, 0, "Refusal starts no extra read or command");
      assert.equal(h.store.route.get(), route); assert.equal(q.currentOwner(), owner);
      assert.equal(currentForm, q.form); assert.equal(q.form.isConnected, true);
      assert.deepEqual(native.raw(currentForm), { name });
      assert.deepEqual(snapshot(h), original); assert.equal(h.store.sourceOwnershipActive(source), true);
      assert.equal(owner.captureCommandDeparture().blocked(), true);
    } else {
      assert.equal(writes.length, 1);
      assert.equal(method(writes[0]), "POST");
      assert.equal(writes[0].url, "/api/workspaces/" + q.secondTask.organizationId + "/projects/" + q.secondTask.projectAccessId + "/context");
      assert.equal(h.store.route.get(), "/projects");
      assert.equal(h.store.session.get().projectContext.projectId, q.secondTask.projectId);
      assert.equal(h.store.session.get().projectContext.projectAccessId, q.secondTask.projectAccessId);
      assert.equal(h.store.projection.get().projectId, q.secondTask.projectId);
      assert.equal(h.store.sourceOwnershipActive(source), false);
      // One explicitly diagnostic read of the real browser-cookie port; this
      // is neither a fabricated session nor an acknowledgment of another write.
      const session = await responseBody(await q.nativeRequest({ url: "/api/session", init: {} }));
      assert.equal(session.projectContext.projectId, q.secondTask.projectId);
      assert.equal(session.projectContext.projectAccessId, q.secondTask.projectAccessId);
      assert.equal(q.viewerCalls.length, 0); assert.equal(h.store.error.get(), "");
    }
  });
// Separate ordinary Return/review entries; the original two OpenProject case
// bodies above retain their exact default cross-project setup and assertions.
// Separate account-lifetime controls. activatePrincipal is the existing
// native authentication port; every consumed session still comes from the
// actual RAM Worker, not an injected grant, role, or replacement response.
for (const differentAccount of [false, true]) test("Workspace Settings global name account lifetime / " + (differentAccount ? "different actual principal" : "same-account refresh"),
  { timeout: 40_000, concurrency: false }, async t => {
    const q = await settingsContextPage(t), { h, f, owner, native } = q;
    const name = "  Private unsent organization name for the original account  ";
    const original = snapshot(h), route = h.store.route.get(), source = h.store.captureSourceOwnership();
    const identity = session => [session.user.userId, session.impersonation?.actor.userId ?? session.user.userId,
      session.impersonation?.impersonationId ?? null, session.audience];
    const originalIdentity = identity(original.session), authority = h.store.captureAuthorizationScope().key;
    assert.equal(original.session.impersonation, null);
    assert.equal(original.session.projectContext, undefined);
    assert.notEqual(original.session.user.userId, q.w.owner, "Both actual pre-existing Worker accounts are distinct before the action");
    assert.equal(native.fill({ name }).port, q.form); await f.settle();
    assert.deepEqual(native.raw(q.form), { name });
    assert.equal(owner.captureCommandDeparture().blocked(), true);
    const physical = () => ({
      events: q.w.sqlite.prepare("SELECT * FROM events ORDER BY rowid").all(),
      privatePayloads: q.w.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY rowid").all(),
      privateContent: q.w.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(),
      receipts: q.w.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
    });
    const protectedRows = physical(), replies = [], prior = h.intercept;
    h.intercept = async request => {
      if (method(request) !== "GET" || request.url !== "/api/session") return prior?.(request);
      const response = await q.nativeRequest(request);
      replies.push({ status: response.status, body: await response.clone().json() });
      return response;
    };
    const before = h.requests.length;
    if (differentAccount) q.activatePrincipal({});
    const received = await h.store.refreshSession();
    await flushStoreFrames(h); await f.settle();
    assert.equal(replies.length, 1, "One original actual session read, without a replacement adoption or retry");
    assert.equal(replies[0].status, 200); assert.deepEqual(received, replies[0].body);
    const current = h.store.session.get(), active = identity(current), forms = currentOrganizationForms(f, q.currentOwner());
    assert.deepEqual(active, identity(replies[0].body), "Current identity is the actual consumed Worker session");
    assert.ok(["creator", "admin"].includes(current.user.role), "The real current account may prepare its own new organization name");
    assert.equal(current.impersonation, null); assert.equal(current.projectContext, undefined);
    assert.equal(forms.length, 1, "One actual current visible organization form after session adoption");
    const currentForm = forms[0].port, field = currentForm.elements.namedItem("name");
    assert.ok(currentForm.isConnected && field?.isConnected);
    assert.equal(field.defaultValue, "");
    const requests = h.requests.slice(before), writes = requests.filter(request => !["GET", "HEAD", "OPTIONS"].includes(method(request)));
    t.diagnostic("C_SETTINGS_ACCOUNT_FORM_LIFETIME " + JSON.stringify({ differentAccount,
      originalIdentity, currentIdentity: active, sessionStatus: replies[0].status,
      sameOwner: q.currentOwner() === owner, sameForm: currentForm === q.form,
      oldFormConnected: q.form.isConnected, currentRaw: native.raw(currentForm), currentNativeValue: field.value,
      originalSourceActive: h.store.sourceOwnershipActive(source), nativeResets: native.resets.length,
      route: h.store.route.get(), requests: requests.map(request => ({ url: request.url, method: method(request) })) }));
    assert.equal(writes.length, 0, "A session read neither submits the old name nor performs a context, organization or provider command");
    assert.equal(h.store.route.get(), route); assert.equal(q.viewerCalls.length, 0);
    assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), true);
    assert.deepEqual(physical(), protectedRows, "No authored/private/receipt rows change during either account read");
    if (differentAccount) {
      assert.equal(active[0], q.w.owner); assert.equal(active[1], q.w.owner);
      assert.notEqual(active[0], originalIdentity[0]); assert.notEqual(active[1], originalIdentity[1]);
      assert.equal(active[3], originalIdentity[3]);
      assert.notEqual(h.store.captureAuthorizationScope().key, authority);
      assert.equal(h.store.sourceOwnershipActive(source), false);
      const oldEventIds = new Set(original.events.map(event => event.eventId));
      assert.ok(h.store.events.get().every(event => !oldEventIds.has(event.eventId)), "The previous account's private event projection is retired");
      for (const reference of Object.keys(original.content)) assert.equal(Object.hasOwn(h.store.content.get(), reference), false);
      assert.deepEqual(native.raw(currentForm), { name: "" }, "A different real principal cannot inherit the original account's unsent native name");
      assert.equal(field.value, "");
      assert.equal(q.currentOwner().captureCommandDeparture().blocked(), false, "The new account does not inherit the previous account's unsent-work blocker");
    } else {
      assert.deepEqual(active, originalIdentity); assert.equal(h.store.captureAuthorizationScope().key, authority);
      assert.equal(h.store.sourceOwnershipActive(source), true);
      assert.equal(q.currentOwner(), owner); assert.equal(currentForm, q.form);
      assert.deepEqual(native.raw(currentForm), { name }); assert.equal(field.value, name);
      assert.equal(native.resets.length, 0, "A same-account read is not a local discard");
      assert.deepEqual(h.store.events.get(), original.events); assert.equal(h.store.head.get(), original.head);
      assert.deepEqual(h.store.content.get(), original.content);
      assert.equal(owner.captureCommandDeparture().blocked(), true);
    }
    assert.equal(h.store.error.get(), "");
  });
async function finishSettingsOpening(q, pending) {
  let done = false, value, error;
  pending.then(result => { value = result; done = true; }, caught => { error = caught; done = true; });
  for (let turn = 0; turn < 32 && !done; turn++) {
    await flushStoreFrames(q.h); await q.f.settle(); await pause();
  }
  assert.ok(done, "The original current Settings/Store/Library operation settles under existing native frames");
  if (error) throw error;
  return value;
}
function settingsReviewButton(q) {
  return q.f.find("button", node => {
    if (node.owner !== q.currentOwner() || node.text !== "Open exact output") return false;
    let item = node.parent; while (item && item.tag !== "li") item = item.parent;
    return item?.text.includes(q.task.artifactTitle + " · revision " + q.task.revision);
  });
}
for (const entry of ["return", "review"]) for (const dirty of [false, true])
  test("Workspace Settings actual " + entry + " opening / " + (dirty ? "unsent organization name" : "pristine"),
    { timeout: 40_000, concurrency: false }, async t => {
      const q = await settingsContextPage(t, { entry: "same-document", personalSource: true }), { h, f, owner, native } = q;
      const name = "Newer unsent organization B";
      if (dirty) {
        assert.equal(native.fill({ name }).port, q.form);
        assert.equal(owner.captureCommandDeparture().blocked(), true);
      }
      const original = snapshot(h), route = h.store.route.get(), source = h.store.captureSourceOwnership();
      const calls = [], methodName = entry === "return" ? "leaveProjectContext" : "openAssignedReview", operation = h.store[methodName];
      t.mock.method(h.store, methodName, function (...args) {
        if (entry === "review") for (const key of ["id", "organizationId", "projectAccessId", "projectId", "documentId", "artifactId", "revision", "contentSha256"])
          assert.equal(args[0][key], q.task[key], "The actual current review control retains exact " + key);
        const call = { result: undefined }; calls.push(call);
        call.pending = operation.apply(this, args);
        void call.pending.then(value => { call.result = value; }, error => { call.error = String(error); });
        return call.pending;
      });
      // Resolve the current control after every setup/field update has settled;
      // never dispatch a captured pre-transition native node.
      await f.settle();
      const before = h.requests.length, button = entry === "return"
        ? f.find("button", node => node.owner === q.currentOwner() && node.text === "Return to my projects")
        : settingsReviewButton(q);
      q.focus.focus(button.port); await f.act(button);
      await finishSettingsOpening(q, Promise.all(calls.map(call => call.pending)));
      await until(() => q.operations.every(record => !record.requested || record.finished), "The original context selection finishes before observation");
      await flushStoreFrames(h); await f.settle();
      await finishSettingsOpening(q, Promise.all(q.viewerCalls.map(call => call.pending)));
      await f.settle();
      const requests = h.requests.slice(before), writes = requests.filter(request => !["GET", "HEAD", "OPTIONS"].includes(method(request)));
      const forms = currentOrganizationForms(f, q.currentOwner()), currentForm = forms[0]?.port;
      t.diagnostic("C_SETTINGS_RETURN_REVIEW " + JSON.stringify({ entry, dirty, route: h.store.route.get(),
        project: h.store.session.get().projectContext?.projectId ?? null, sameOwner: q.currentOwner() === owner,
        sameForm: currentForm === q.form, originalConnected: q.form.isConnected,
        raw: currentForm ? native.raw(currentForm) : null, sourceActive: h.store.sourceOwnershipActive(source),
        calls: calls.map(call => ({ result: call.result ?? null, error: call.error ?? null })),
        viewers: q.viewerCalls.map(call => ({ id: call.id, result: call.result ?? null, error: call.error ?? null,
          documentId: call.owner.documentId, connected: call.owner.isConnected,
          open: call.owner.querySelector(".document-artifact-view")?.open ?? false })),
        requests: requests.map(request => ({ url: request.url, method: method(request) })) }));
      if (dirty) {
        assert.equal(writes.length, 0, "Unsent native name refuses the actual " + entry + " departure before any cookie command");
        assert.equal(requests.length, 0); assert.equal(calls.length, 0);
        assert.equal(h.store.route.get(), route); assert.equal(q.currentOwner(), owner);
        assert.equal(currentForm, q.form); assert.equal(q.form.isConnected, true);
        assert.deepEqual(native.raw(currentForm), { name });
        assert.deepEqual(snapshot(h), original); assert.equal(h.store.sourceOwnershipActive(source), true);
        assert.equal(owner.captureCommandDeparture().blocked(), true); assert.equal(q.viewerCalls.length, 0);
      } else {
        assert.equal(calls.length, 1); assert.equal(calls[0].result, true);
        assert.equal(writes.length, 1);
        assert.equal(method(writes[0]), entry === "return" ? "DELETE" : "POST");
        assert.equal(writes[0].url, entry === "return" ? "/api/workspaces/context"
          : "/api/workspaces/" + q.task.organizationId + "/projects/" + q.task.projectAccessId + "/context");
        const session = await responseBody(await q.nativeRequest({ url: "/api/session", init: {} }));
        if (entry === "return") {
          assert.equal(h.store.route.get(), "/projects");
          assert.equal(h.store.session.get().projectContext, undefined); assert.equal(session.projectContext, undefined);
          assert.equal(h.store.projection.get().projectId, "assigned-personal-project-a", "The explicit existing personal-source fixture is restored");
          assert.equal(h.store.sourceOwnershipActive(source), false); assert.equal(q.viewerCalls.length, 0);
        } else {
          assert.equal(session.projectContext.projectId, q.task.projectId);
          assert.equal(session.projectContext.projectAccessId, q.task.projectAccessId);
          assert.equal(h.store.session.get().projectContext.projectAccessId, q.task.projectAccessId);
          assert.deepEqual(libraryFocusFromRoute(h.store.route.get()), { kind: "artifact", id: q.task.artifactId });
          assert.deepEqual(artifactFocusOptionsFromRoute(h.store.route.get()),
            { expectedRevision: q.task.revision, expectedContentSha256: q.task.contentSha256, intent: "review" });
          assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), q.entryDocument, "Valid same-project Work return is preserved");
          assert.equal(q.viewerCalls.length, 1, "The existing exact route owns one original viewer, not a replacement");
          const viewer = q.viewerCalls[0];
          assert.equal(viewer.result, true); assert.equal(viewer.owner.documentId, q.task.documentId);
          assert.equal(viewer.owner.isConnected, true); assert.equal(viewer.owner.querySelector(".document-artifact-view")?.open, true);
          assert.match(f.tree().root.text, /EXACT_ASSIGNED_B_BODY/);
        }
        assert.equal(h.store.error.get(), "");
      }
    });
// Store contract boundary, not an additional native permission proof. Invoke
// the original public refresh unchanged; hold only its already-applied result
// before the original Settings caller resumes and attempts its route commit.
for (const superseded of [false, true]) test("Workspace Settings post-adoption selection contract / " + (superseded ? "newer same-route original" : "healthy held return"),
  { timeout: 40_000, concurrency: false }, async t => {
    const applied = sceneDeferred(), releaseOriginal = sceneDeferred(), newerEntered = sceneDeferred(), releaseNewer = sceneDeferred();
    t.after(() => { releaseOriginal.resolve(); releaseNewer.resolve(); });
    const q = await settingsContextPage(t), { h, f } = q;
    const originalRoute = h.store.route.get(), originalSession = h.store.session.get(), originalSource = h.store.captureSourceOwnership();
    const originalTarget = q.secondTask, newerTarget = q.task;
    const originalPath = "/api/workspaces/" + originalTarget.organizationId + "/projects/" + originalTarget.projectAccessId + "/context";
    const newerPath = "/api/workspaces/" + newerTarget.organizationId + "/projects/" + newerTarget.projectAccessId + "/context";
    assert.notEqual(originalPath, newerPath); assert.notEqual(originalTarget.projectId, newerTarget.projectId);
    const begin = h.store.beginProjectContextSelection; let selections = 0, refreshCalls = 0, originalApplied;
    t.mock.method(h.store, "beginProjectContextSelection", function (...args) {
      const selection = begin.apply(this, args);
      if (++selections === 1) {
        const refresh = selection.refreshSession;
        t.mock.method(selection, "refreshSession", async function (...values) {
          refreshCalls++;
          const result = await refresh.apply(this, values);
          originalApplied = result; applied.resolve();
          await releaseOriginal.promise; return result;
        });
      }
      return selection;
    });
    const prior = h.intercept;
    h.intercept = async request => {
      if (method(request) !== "POST" || request.url !== newerPath) return prior?.(request);
      newerEntered.resolve(); await releaseNewer.promise;
      return q.nativeRequest(request);
    };
    let newer = null, newerPending = null, newerFinished = false;
    const before = h.requests.length;
    try {
      const button = q.open(); q.focus.focus(button.port); await f.act(button);
      await finishSettingsOpening(q, applied.promise);
      assert.equal(refreshCalls, 1); assert.equal(originalApplied, h.store.session.get());
      assert.equal(originalApplied.projectContext.organizationId, originalTarget.organizationId);
      assert.equal(originalApplied.projectContext.projectAccessId, originalTarget.projectAccessId);
      assert.equal(originalApplied.projectContext.projectId, originalTarget.projectId);
      assert.equal(h.store.route.get(), originalRoute); assert.equal(h.store.sourceOwnershipActive(originalSource), false);
      assert.equal(q.operations[0].finished, false);
      const appliedSource = h.store.captureSourceOwnership(); assert.equal(h.store.sourceOwnershipActive(appliedSource), true);
      if (superseded) {
        // A real newer Store context selection, with its actual Worker response
        // still pending. No handoff/current predicate or response is fabricated.
        newer = h.store.beginProjectContextSelection(); newerPending = newer.request(newerTarget);
        await finishSettingsOpening(q, newerEntered.promise);
        assert.equal(newer.current(), true); assert.equal(newer.sourceCurrent(), true);
        assert.equal(h.store.route.get(), originalRoute); assert.equal(h.store.session.get(), originalApplied);
      }
      releaseOriginal.resolve();
      await until(() => q.operations[0].finished, "The original Settings selection finishes before observing its attempted commit");
      await flushStoreFrames(h); await f.settle();
      t.diagnostic("C_SETTINGS_PRECOMMIT_SELECTION " + JSON.stringify({ superseded, refreshCalls, selections,
        route: h.store.route.get(), originalRoute, originalProject: originalTarget.projectId,
        currentProject: h.store.session.get().projectContext?.projectId ?? null,
        originalFinished: q.operations[0].finished, newerCurrent: newer?.current() ?? null,
        originalAppliedSourceActive: h.store.sourceOwnershipActive(appliedSource),
        requests: h.requests.slice(before).map(request => ({ url: request.url, method: method(request) })) }));
      if (superseded) {
        assert.equal(h.store.route.get(), originalRoute, "The older applied session cannot overtake a newer same-route selection at route commit");
        assert.equal(newer.current(), true, "Older UI completion must not cancel the legitimate newer selection");
        assert.equal(newer.sourceCurrent(), true);
        assert.equal(h.store.session.get().projectContext.projectAccessId, originalTarget.projectAccessId);
        assert.equal(h.store.sourceOwnershipActive(appliedSource), true);
        releaseNewer.resolve();
        const response = await newerPending; assert.ok(response); assert.equal(response.status, 200);
        assert.ok(response.headers.get("set-cookie"), "The newer original Worker response owns its real cookie");
        const body = await responseBody(response);
        assert.equal(body.organizationId, newerTarget.organizationId); assert.equal(body.projectAccessId, newerTarget.projectAccessId);
        assert.equal(body.projectId, newerTarget.projectId);
        assert.ok(await newer.refreshSession()); await newer.finish(); newerFinished = true;
        await h.store.refreshEvents({ fromStart: true }); await flushStoreFrames(h); await f.settle();
        assert.equal(h.store.route.get(), originalRoute, "Cookie reconciliation is not a replacement UI navigation");
        assert.equal(h.store.session.get().projectContext.projectId, newerTarget.projectId);
        assert.equal(h.store.session.get().projectContext.projectAccessId, newerTarget.projectAccessId);
        assert.equal(h.store.sourceOwnershipActive(appliedSource), false);
        assert.ok(h.store.events.get().length > 0);
        assert.ok(h.store.events.get().every(event => event.streamId === "project:" + newerTarget.projectAccessId));
      } else {
        assert.equal(h.store.route.get(), "/projects"); assert.equal(h.store.projection.get().projectId, originalTarget.projectId);
        assert.equal(h.store.session.get().projectContext.projectAccessId, originalTarget.projectAccessId);
        assert.equal(h.store.sourceOwnershipActive(appliedSource), true);
      }
      const writes = h.requests.slice(before).filter(request => !["GET", "HEAD", "OPTIONS"].includes(method(request)));
      assert.deepEqual(writes.map(request => [method(request), request.url]), superseded
        ? [["POST", originalPath], ["POST", newerPath]] : [["POST", originalPath]]);
      assert.equal(h.store.session.get().user.userId, originalSession.user.userId);
      assert.equal(q.native.resets.length, 0); assert.equal(q.viewerCalls.length, 0); assert.equal(h.store.error.get(), "");
    } finally {
      releaseOriginal.resolve(); releaseNewer.resolve();
      if (newer) { await newerPending.catch(() => undefined); if (!newerFinished) await newer.finish(); }
    }
  });
// The original response is genuinely positive. Its JSON delivery alone waits;
// no replacement body/cookie, second mutation, or early UI handoff is supplied.
for (const newerRaw of [false, true]) test("Workspace Settings OpenProject held positive body / " + (newerRaw ? "newer native name" : "unchanged owner"),
  { timeout: 40_000, concurrency: false }, async t => {
    const entered = sceneDeferred(), release = sceneDeferred();
    // Release before the existing fixture's original-operation cleanup joins.
    t.after(() => release.resolve());
    const q = await settingsContextPage(t), { h, f, native, owner } = q;
    const target = q.secondTask, route = h.store.route.get(), session = h.store.session.get();
    const source = h.store.captureSourceOwnership(), authority = h.store.captureAuthorizationScope().key;
    const original = snapshot(h), name = "  Newer unsent organization B while the original context body waits  ";
    const path = "/api/workspaces/" + target.organizationId + "/projects/" + target.projectAccessId + "/context";
    const prior = h.intercept; let commands = 0, bodyReads = 0, positive;
    h.intercept = async request => {
      if (method(request) !== "POST" || request.url !== path) return prior?.(request);
      commands++; assert.equal(commands, 1);
      const response = await q.nativeRequest(request);
      assert.equal(response.status, 200); assert.ok(response.headers.get("set-cookie"));
      positive = await response.clone().json();
      assert.equal(positive.organizationId, target.organizationId);
      assert.equal(positive.projectAccessId, target.projectAccessId); assert.equal(positive.projectId, target.projectId);
      assert.ok(positive.permissions.includes("project.read"));
      const json = response.json.bind(response);
      Object.defineProperty(response, "json", { value: async () => {
        bodyReads++; entered.resolve(); await release.promise; return json();
      } });
      return response;
    };
    const before = h.requests.length, button = q.open();
    q.focus.focus(button.port); const activation = f.act(button);
    await finishSettingsOpening(q, entered.promise); await activation;
    assert.equal(commands, 1); assert.equal(bodyReads, 1);
    assert.equal(h.store.session.get(), session); assert.deepEqual(snapshot(h), original);
    assert.equal(h.store.route.get(), route); assert.equal(h.store.sourceOwnershipActive(source), true);
    assert.equal(q.operations.length, 1); assert.equal(q.operations[0].finished, false);
    if (newerRaw) {
      assert.equal(native.fill({ name }).port, q.form); await f.settle();
      const current = native.current(); assert.equal(current.owner, owner); assert.equal(current.port, q.form);
      assert.equal(q.form.isConnected, true); assert.deepEqual(native.raw(q.form), { name });
      assert.deepEqual(snapshot(h), original); assert.equal(h.store.sourceOwnershipActive(source), true);
    }
    release.resolve();
    await until(() => q.operations.every(operation => !operation.requested || operation.finished), "The original positive context body/selection settles");
    await flushStoreFrames(h); await f.settle();
    const afterOriginal = { route: h.store.route.get(), project: h.store.session.get().projectContext?.projectId ?? null,
      sameForm: currentOrganizationForms(f, q.currentOwner())[0]?.port === q.form,
      notices: f.tree().visible("p").filter(node => String(node.attributes.class ?? "").split(/\s+/u)
        .includes("workspace-settings-notice")).map(node => node.text) };
    const live = await responseBody(await q.nativeRequest({ url: "/api/session", init: {} }));
    assert.equal(live.projectContext.organizationId, target.organizationId);
    assert.equal(live.projectContext.projectAccessId, target.projectAccessId); assert.equal(live.projectContext.projectId, target.projectId);
    // A deliberate ordinary current-source read must remain coherent even if
    // the original navigation was refused. This read is never a write ACK.
    await h.store.refreshEvents({ fromStart: true }); await flushStoreFrames(h); await f.settle();
    const currentSession = h.store.session.get(), requests = h.requests.slice(before);
    const writes = requests.filter(request => !["GET", "HEAD", "OPTIONS"].includes(method(request)));
    const rows = h.store.events.get(), currentSource = h.store.captureSourceOwnership();
    t.diagnostic("C_SETTINGS_HELD_POSITIVE_BODY " + JSON.stringify({ newerRaw, commands, bodyReads,
      positive: { organizationId: positive.organizationId, projectAccessId: positive.projectAccessId, projectId: positive.projectId },
      afterOriginal, route: h.store.route.get(), currentProject: currentSession.projectContext?.projectId ?? null,
      originalSourceActive: h.store.sourceOwnershipActive(source), currentSourceActive: h.store.sourceOwnershipActive(currentSource),
      streams: [...new Set(rows.map(event => event.streamId))], rows: rows.length,
      nativeFormResets: native.resets.length, viewerCalls: q.viewerCalls.length, diagnosticNativeSessionReads: 1,
      requests: requests.map(request => ({ url: request.url, method: method(request) })) }));
    assert.equal(commands, 1); assert.equal(bodyReads, 1); assert.equal(writes.length, 1);
    assert.equal(writes[0].url, path); assert.equal(method(writes[0]), "POST");
    assert.equal(currentSession.user.userId, session.user.userId);
    assert.equal(currentSession.projectContext.organizationId, target.organizationId);
    assert.equal(currentSession.projectContext.projectAccessId, target.projectAccessId);
    assert.equal(currentSession.projectContext.projectId, target.projectId);
    assert.notEqual(h.store.captureAuthorizationScope().key, authority);
    assert.equal(h.store.sourceOwnershipActive(source), false); assert.equal(h.store.sourceOwnershipActive(currentSource), true);
    assert.ok(rows.some(event => event.payload.project_id === target.projectId));
    assert.ok(rows.every(event => event.streamId === "project:" + target.projectAccessId), "No original personal stream is mixed into the adopted shared source");
    assert.equal(q.viewerCalls.length, 0); assert.equal(native.resets.length, 0);
    if (newerRaw) {
      assert.equal(afterOriginal.route, route, "A positive context ACK does not authorize departure after newer raw input");
      assert.equal(h.store.route.get(), route, "Privacy reconciliation cannot adopt the refused UI route");
      assert.ok(!afterOriginal.notices.some(text => text.includes(owner.i18n.t("workspace.admin.projectOpened", "Shared project opened."))),
        "A true context ACK is not a successful Open notice after refused UI adoption");
      // This unsent name belongs to the same account's global Settings form,
      // not the retired project's private catalogs or one-time credentials.
      assert.equal(currentSession.impersonation?.actor.userId ?? currentSession.user.userId,
        session.impersonation?.actor.userId ?? session.user.userId);
      assert.equal(currentSession.impersonation?.impersonationId ?? null, session.impersonation?.impersonationId ?? null);
      assert.equal(currentSession.audience, session.audience);
      const retainedOwner = q.currentOwner(), retainedForms = currentOrganizationForms(f, retainedOwner);
      assert.equal(retainedOwner, owner); assert.equal(retainedForms.length, 1);
      assert.equal(retainedForms[0].port, q.form); assert.equal(q.form.isConnected, true);
      assert.equal(q.form.closest("[hidden],[inert]"), null);
      assert.deepEqual(native.raw(q.form), { name }, "The exact newer global name survives without restoring the retired project Source");
      assert.equal(native.resets.length, 0);
    } else {
      assert.equal(afterOriginal.route, "/projects"); assert.equal(h.store.route.get(), "/projects");
      assert.equal(h.store.projection.get().projectId, target.projectId);
    }
  });
after(() => { assert.equal(externalCount(), 0); globalThis.fetch = originalFetch; });


// Shell Return is outside Settings' own action row. It must admit every actual
// connected origin before requesting the same real context-cookie deletion.
function shellSharedReturnButton(q) {
  const tree = q.f.tree(), shell = q.f.host;
  assert.ok(shell.isConnected && shell.tag === "forma-shell" && shell.store === q.h.store);
  const banners = tree.visible("aside").filter(node => node.owner === shell
    && String(node.attributes.class ?? "").split(/\s+/u).includes("workspace-shared-banner"));
  assert.equal(banners.length, 1, "One actual current Shell shared-context banner");
  const buttons = tree.visible("button").filter(node => {
    if (node.owner !== shell || node.text !== shell.i18n.t("workspace.admin.leaveSharedProject", "Return to my projects")) return false;
    for (let at = node.parent; at; at = at.parent) if (at === banners[0]) return true;
    return false;
  });
  assert.equal(buttons.length, 1); const button = buttons[0];
  assert.equal(button.hiddenBy, null); assert.equal(button.port.matches(":disabled"), false);
  assert.ok(button.port.isConnected && q.f.renderer.nodes.includes(button.port));
  assert.equal(typeof button.handlers.click, "function"); return button;
}

for (const dirty of [false, true]) test("Shell shared-banner Return admits the actual origin before context deletion / "
  + (dirty ? "unsent native organization name" : "pristine"),
  { timeout: 40_000, concurrency: false }, async t => {
    const q = await settingsContextPage(t, { entry: "same-document", personalSource: true }), { h, f, native, owner } = q;
    const name = "  Unsent account-owned name B from the Shell Return boundary — 未保存  ";
    if (dirty) assert.equal(native.fill({ name }).port, q.form);
    assert.equal(owner.captureCommandDeparture().blocked(), dirty);
    await f.settle();
    const original = snapshot(h), route = h.store.route.get(), source = h.store.captureSourceOwnership();
    const authorization = h.store.captureAuthorizationScope();
    assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
    const cookieBefore = await responseBody(await q.nativeRequest({ url: "/api/session", init: {} }));
    assert.equal(cookieBefore.user.userId, original.session.user.userId);
    assert.equal(cookieBefore.projectContext.projectAccessId, q.task.projectAccessId);
    assert.equal(cookieBefore.projectContext.projectId, q.task.projectId);
    assert.equal(h.store.ui.commandOpen, false);
    assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);

    const calls = [], leave = h.store.leaveProjectContext;
    t.mock.method(h.store, "leaveProjectContext", function (...args) {
      const call = { result: undefined }; calls.push(call);
      call.pending = leave.apply(this, args);
      void call.pending.then(value => { call.result = value; }, error => { call.error = String(error); });
      return call.pending;
    });
    // Reacquire after setup and its real diagnostic session read. The native
    // focus/pointer checks must never be bypassed for a captured old button.
    await f.settle(); const before = h.requests.length, button = shellSharedReturnButton(q);
    q.focus.emit("pointerdown", button.port); q.focus.focus(button.port); await f.act(button);
    await finishSettingsOpening(q, Promise.all(calls.map(call => call.pending)));
    await until(() => q.operations.every(operation => !operation.requested || operation.finished),
      "The original Shell Return context selection finishes before observation");
    await flushStoreFrames(h); await f.settle();
    const requests = h.requests.slice(before), writes = requests.filter(request => !["GET", "HEAD", "OPTIONS"].includes(method(request)));
    const forms = currentOrganizationForms(f, q.currentOwner()), currentForm = forms[0]?.port;
    // This same real browser-cookie read is observational, not an application
    // session adoption, a replacement response or a write acknowledgment.
    const cookieAfter = await responseBody(await q.nativeRequest({ url: "/api/session", init: {} }));
    assert.equal(cookieAfter.user.userId, original.session.user.userId);
    assert.equal(q.viewerCalls.length, 0); assert.equal(native.resets.length, 0);
    t.diagnostic("C_SHELL_SHARED_RETURN " + JSON.stringify({ dirty, route: h.store.route.get(),
      cookieProject: cookieAfter.projectContext?.projectId ?? null,
      localProject: h.store.session.get().projectContext?.projectId ?? null,
      sameShell: f.host === button.owner && f.host.isConnected, sameOwner: q.currentOwner() === owner,
      sameForm: currentForm === q.form, raw: currentForm ? native.raw(currentForm) : null,
      originalSourceActive: h.store.sourceOwnershipActive(source),
      calls: calls.map(call => ({ result: call.result ?? null, error: call.error ?? null })),
      operations: q.operations.map(operation => ({ ...operation })),
      requests: requests.map(request => ({ url: request.url, method: method(request) })),
      diagnosticCookieReads: 2, evidence: "actual Shell/Settings/Store/RAM Worker and finite native form; no physical or simulated authorization claim" }));
    if (dirty) {
      assert.equal(writes.length, 0, "Shell Return must refuse before any shared-context cookie mutation");
      assert.equal(requests.length, 0); assert.equal(calls.length, 0); assert.equal(q.operations.length, 0);
      assert.deepEqual(cookieAfter.projectContext, cookieBefore.projectContext);
      assert.equal(h.store.route.get(), route); assert.equal(q.currentOwner(), owner);
      assert.equal(currentForm, q.form); assert.equal(q.form.isConnected, true);
      assert.deepEqual(native.raw(currentForm), { name }); assert.deepEqual(snapshot(h), original);
      assert.equal(h.store.sourceOwnershipActive(source), true); assert.equal(h.store.authorizationScopeActive(authorization), true);
      assert.equal(owner.captureCommandDeparture().blocked(), true);
      assert.equal(shellSharedReturnButton(q).owner, f.host);
      assert.equal(h.store.ui.commandOpen, false);
      assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
    } else {
      assert.equal(calls.length, 1); assert.equal(calls[0].result, true);
      assert.equal(q.operations.length, 1); assert.equal(q.operations[0].requested, true); assert.equal(q.operations[0].finished, true);
      assert.equal(writes.length, 1); assert.equal(method(writes[0]), "DELETE");
      assert.equal(writes[0].url, "/api/workspaces/context"); assert.equal(writes[0].init.credentials, "same-origin");
      assert.equal(writes[0].init.body, undefined);
      assert.equal(cookieAfter.projectContext, undefined); assert.equal(h.store.session.get().projectContext, undefined);
      assert.equal(h.store.session.get().user.userId, original.session.user.userId);
      assert.equal(h.store.route.get(), "/projects");
      assert.equal(h.location.pathname + h.location.search + h.location.hash, "/projects");
      assert.equal(h.store.projection.get().projectId, "assigned-personal-project-a");
      assert.equal(h.store.sourceOwnershipActive(source), false);
      const destination = h.store.captureSourceOwnership(); assert.equal(h.store.sourceOwnershipActive(destination), true);
      assert.equal(h.store.routeDataReady("/projects"), true);
      assert.equal(currentSettings(f).length, 0);
      assert.equal(f.components().filter(component => component.tag === "forma-projects" && component.isConnected && component.store === h.store).length, 1);
      assert.equal(h.store.error.get(), "");
    }
  });
