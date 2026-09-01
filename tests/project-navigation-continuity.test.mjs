import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { appendAuditEvent, readWorkspaceEvents, readIntelligenceEvents } from "../worker/runtime.ts";
import { artifactFocusOptionsFromRoute, libraryFocusFromRoute, documentIdFromRoute, projectTaskDocumentIdFromRoute, withProjectTaskDocumentInRoute, withDocumentInRoute, libraryFocusRoute, libraryBlockEditorRoute } from "../src/model/routes.ts";
import { creativeCreationHref } from "../src/platform/applications.ts";
import { artifactDeliveryFor } from "../src/state/artifact-delivery-context.ts";
import { createCalmFullPage, fullPageTree as cLibraryPackageFullPageTree, calmFullPageNativePorts as ports, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { installImageFormatNativeLifetime } from "./helpers/image-format-native-lifetime.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { isOutputFixtureReadOnlyResume } from "./helpers/output-reachability-fixture.mjs";
import { commandDiscoveryCopy } from "../src/components/design-system/locales/command-discovery-messages.ts";
import { DOCUMENT_ARTIFACT_KINDS, documentArtifactDefinition } from "../src/model/document-artifacts.ts";

test("unavailable task href fallback preserves exact ordered values and never overrides explicit destinations or selections", () => {
  const values = ["", " unknown\u00a0", "known", "known"], source = new URL("/deliver", "https://fixture.invalid");
  for (const value of values) source.searchParams.append("document", value);
  const origin = source.pathname + source.search;
  for (const destination of ["/library?scope=kept#preview", "/activity", "/library/artifact/a/title", "/library/blocks/editor/new", "/canvas/library"]) {
    const result = withProjectTaskDocumentInRoute(destination, "", origin), parsed = new URL(result, "https://fixture.invalid");
    assert.deepEqual(parsed.searchParams.getAll("document"), values); assert.equal(projectTaskDocumentIdFromRoute(result), "");
    assert.equal(documentIdFromRoute(result), null, "Unavailable view addresses never narrow the existing job/feed parser");
    if (destination.includes("scope")) { assert.equal(parsed.searchParams.get("scope"), "kept"); assert.equal(parsed.hash, "#preview"); }
  }
  const explicit = "/library?document=chosen&document=#existing";
  assert.equal(withProjectTaskDocumentInRoute(explicit, "", origin), explicit, "An explicit destination retains even its ambiguity");
  assert.equal(projectTaskDocumentIdFromRoute(withProjectTaskDocumentInRoute("/deliver", "chosen", origin)), "chosen");
  assert.equal(projectTaskDocumentIdFromRoute(withProjectTaskDocumentInRoute("/deliver", "")), null, "An explicit empty-Project selection can clear context");
  assert.equal(withProjectTaskDocumentInRoute("/projects", "", origin), "/projects");
  for (const route of [libraryFocusRoute("artifact", "exact", "name", origin), libraryBlockEditorRoute("exact", origin)])
    assert.deepEqual(new URL(route, "https://fixture.invalid").searchParams.getAll("document"), values, "Actual Library subroute builders retain invalidity/order");
});

const TASKS = ["/deliver", "/library", "/activity"];
const navigationTypes = new Set(["ProjectOpened", "DocumentOpened"]);
async function navigationFixture(t, { shared = false, reader = false, briefReceiptAccounting = false, sessionDraftReceiptAccounting = false, ordinaryBlankReceiptAccounting = false, briefIgnoreReceiptAccounting = false, libraryImportReceiptAccounting = false, libraryPublisherAuditAccounting = false, libraryNextVersionAuditAccounting = false, libraryPackageReorderAuditAccounting = false, libraryEditorSaveReceiptAccounting = false, libraryEditorActionReceiptAccounting = false } = {}) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No live network/provider in project navigation"));
  const worker = await createSceneCostFixture(1, "visual", { shared });
  const a = worker.projectId, ad = worker.documentId, otherA = "navigation-second-document-a", b = "navigation-project-b", bd = "navigation-document-b";
  await appendAuditEvent(worker.env, worker.streamId, "user", "DocumentCreated", { project_id: a, document_id: otherA, title: "Another A Document" });
  await appendAuditEvent(worker.env, worker.streamId, "user", "ProjectCreated", { project_id: b, name: "Historical project B" });
  await appendAuditEvent(worker.env, worker.streamId, "user", "DocumentCreated", { project_id: b, document_id: bd, title: "Historical Document B" });
  for (let index = 0; index < 3; index++) await appendAuditEvent(worker.env, worker.streamId, "worker:renderer", "DocumentRenderCompleted", {
    project_id: b, document_id: bd, artifact_id: "navigation-b-slides-" + index, artifact_kind: "slides", title: "Historical B Slides " + index, items: [], source_block_versions: [],
  });
  if (reader) {
    assert.equal(shared, true);
    const actor = "navigation-reader", email = "navigation-reader@local.forma", now = new Date().toISOString(), share = worker.sharing;
    worker.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)").run(actor, email, "Navigation reader", now, now, now);
    worker.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,'member','active',?,?,?,?)").run("navigation-reader-org", share.organizationId, actor, worker.owner, now, now, now);
    worker.sqlite.prepare("INSERT INTO project_memberships(membership_id,organization_id,project_access_id,project_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'viewer','active',?,?,?)").run("navigation-reader-project", share.organizationId, share.projectAccessId, a, actor, worker.owner, now, now);
    const identity = { "oai-authenticated-user-id": actor, "oai-authenticated-user-email": email };
    worker.setScopedHeaders(identity);
    const selected = await worker.request("/api/workspaces/" + share.organizationId + "/projects/" + share.projectAccessId + "/context", { method: "POST" });
    assert.equal(selected.status, 200, await selected.clone().text());
    worker.setScopedHeaders({ ...identity, cookie: selected.headers.get("set-cookie").split(";")[0] });
  }
  const h = await createSceneStoreHost({ workerFixture: worker });
  const previous = globalThis.history;
  globalThis.history = {
    pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash }); },
    replaceState(...args) { this.pushState(...args); },
  };
  t.after(() => { globalThis.history = previous; });
  h.store.loading.set(false);
  h.a = a; h.ad = ad; h.otherA = otherA; h.b = b; h.bd = bd;
  h.deep = withDocumentInRoute("/", ad, "Exact original A");
  h.history = () => readWorkspaceEvents(worker.env, worker.streamId);
  h.counts = () => Object.fromEntries(Object.keys(worker.counts()).map(table => [table, worker.sqlite.prepare('SELECT * FROM "' + table + '"').all()]));
  const accounting = h.counts(); let authored = (await h.history()).filter(event => !navigationTypes.has(event.type));
  h.external = async (type, payload) => {
    await appendAuditEvent(worker.env, worker.streamId, "user", type, payload);
    authored = (await h.history()).filter(event => !navigationTypes.has(event.type));
  };
  if (briefReceiptAccounting) h.briefReceipts = fSessionReceiptAccounting(t, h, async appended => {
    const expected = [...authored, ...appended];
    assert.deepEqual((await h.history()).filter(event => !navigationTypes.has(event.type)), expected,
      "Only the exact already-verified Worker brief receipt enters this opt-in expected history");
    authored = expected;
  });
  if (sessionDraftReceiptAccounting) h.sessionDraftReceipts = fSessionDraftReceiptAccounting(t, h, async appended => {
    const expected = [...authored, ...appended];
    assert.deepEqual((await h.history()).filter(event => !navigationTypes.has(event.type)), expected,
      "Only the exact already-verified Worker blank/intent receipt enters this separate opt-in history");
    authored = expected;
  });
  if (ordinaryBlankReceiptAccounting) h.ordinaryBlankReceipts = fSessionOrdinaryBlankAccounting(t, h, async appended => {
    const expected = [...authored, ...appended];
    assert.deepEqual((await h.history()).filter(event => !navigationTypes.has(event.type)), expected,
      "Only the new deliberately requested ordinary blank receipt enters this separate opt-in history");
    authored = expected;
  });
  if (briefIgnoreReceiptAccounting) h.briefIgnoreReceipts = cSessionIgnoreReceiptAccounting(t, h, async appended => {
    const expected = [...authored, ...appended];
    assert.deepEqual((await h.history()).filter(event => !navigationTypes.has(event.type)), expected,
      "Only the exact separately witnessed Ignore receipt enters this opt-in history");
    authored = expected;
  });
  if (libraryImportReceiptAccounting) h.libraryImportReceipts = cLibraryImportReceiptAccounting(t, h, async appended => {
    const expected = [...authored, ...appended];
    assert.deepEqual((await h.history()).filter(event => !navigationTypes.has(event.type)), expected,
      "Only the exact separately witnessed one-copy Library import receipt enters this opt-in history");
    authored = expected;
  });
  if (libraryEditorSaveReceiptAccounting) h.libraryEditorSaveReceipts = cLibraryEditorSaveReceiptAccounting(t, h, async appended => {
    const expected = [...authored, ...appended];
    assert.deepEqual((await h.history()).filter(event => !navigationTypes.has(event.type)), expected,
      "Only the separately verified exact original Library rename Save enters this opt-in history");
    authored = expected;
  });
  if (libraryEditorActionReceiptAccounting) h.libraryEditorActionReceipts = cLibraryEditorActionReceiptAccounting(t, h, async appended => {
    const expected = [...authored, ...appended];
    assert.deepEqual((await h.history()).filter(event => !navigationTypes.has(event.type)), expected,
      "Only the separately verified exact original Library Fork or Remove enters this opt-in history");
    authored = expected;
  });
  if (libraryPublisherAuditAccounting) {
    assert.equal(shared, true); assert.equal(reader, false);
    h.libraryPublisherAudits = cLibraryPublisherAuditAccounting(h, async appended => {
      const expected = [...authored, ...appended];
      assert.deepEqual((await h.history()).filter(event => !navigationTypes.has(event.type)), expected,
        "Only the exact original package response audit events enter this opt-in expected history");
      authored = expected;
    });
  }
  if (libraryNextVersionAuditAccounting) {
    assert.equal(libraryPublisherAuditAccounting, true, "The existing package is genuinely created/accounted first");
    h.libraryNextVersionAudits = cLibraryPublisherAuditAccounting(h, async appended => {
      const expected = [...authored, ...appended];
      assert.deepEqual((await h.history()).filter(event => !navigationTypes.has(event.type)), expected,
        "Only the exact original next-version response audit events enter this opt-in expected history");
      authored = expected;
    }, { nextVersion: true });
  }
  if (libraryPackageReorderAuditAccounting) {
    assert.equal(libraryNextVersionAuditAccounting, true, "Reorder setup is limited to the existing exact-version fixture");
    h.libraryReorderAudits = cLibraryPublisherAuditAccounting(h, async appended => {
      const expected = [...authored, ...appended];
      assert.deepEqual((await h.history()).filter(event => !navigationTypes.has(event.type)), expected,
        "Only one separately dispatched exact create-B response's three audit events extend this reorder history");
      authored = expected;
    });
  }
  t.after(async () => {
    try {
    assert.deepEqual(h.counts(), accounting, "Every existing job/reservation/counter row is unchanged");
    assert.deepEqual((await h.history()).filter(event => !navigationTypes.has(event.type)), authored, "Navigation never edits source, result, approval or paid state");
    } finally { await h.close(); }
  });
  h.exact = (project = a, document = ad) => {
    const p = h.store.projection.get();
    assert.equal(p.projectId, project); assert.equal(p.documentId, document);
    const href = creativeCreationHref(p, (id, title) => withDocumentInRoute("/", id, title));
    assert.equal(documentIdFromRoute(href), document, "Work returns to the exact originating Document");
    return p;
  };
  return h;
}

test("task context has a separate parser and carries only its exact Document through Library builders", () => {
  for (const task of [...TASKS, "/library/artifact/a/name", "/library/blocks/editor/new", "/canvas/library", "/canvas/library/output/a"]) {
    const route = withProjectTaskDocumentInRoute(task + "?scope=kept#preview", "document A");
    assert.equal(documentIdFromRoute(route), null, "Existing Document-view/job scope stays unchanged");
    assert.equal(projectTaskDocumentIdFromRoute(route), "document A");
    assert.equal(new URL(route, "https://fixture.invalid").searchParams.get("scope"), "kept");
    assert.equal(new URL(route, "https://fixture.invalid").hash, "#preview");
  }
  for (const route of ["/projects", "/canvas/projects", "/canvas/board-a", "/settings", "/sessions", "/share/token", "/document/a"]) {
    assert.equal(withProjectTaskDocumentInRoute(route, "a"), route);
    assert.equal(projectTaskDocumentIdFromRoute(route + "?document=a"), null);
  }
  assert.equal(projectTaskDocumentIdFromRoute("/deliver"), null);
  assert.equal(projectTaskDocumentIdFromRoute("/deliver?document="), "");
  assert.equal(projectTaskDocumentIdFromRoute("/deliver?document=a&document=b"), "");
  assert.equal(libraryFocusRoute("artifact", "artifact-a", "A", "/library?scope=kept&document=doc-a#preview"), "/library/artifact/artifact-a/a?document=doc-a");
  assert.equal(libraryBlockEditorRoute("block-a", "/canvas/library?scope=kept&document=doc-a#preview"), "/canvas/library/blocks/editor/block-a?document=doc-a");
  assert.equal(libraryFocusRoute("block", "block-a", "", "/canvas/library?scope=kept#preview"), "/canvas/library/block/block-a", "Legacy unrelated-state behavior is not widened");
});

for (const custody of ["personal", "shared-owner", "shared-reader"]) for (const task of TASKS)
test("actual Store/Worker deep link retains exact Project and Document through " + task + " / " + custody, async t => {
  const h = await navigationFixture(t, { shared: custody !== "personal", reader: custody === "shared-reader" });
  if (custody === "shared-reader") {
    assert.equal(h.store.session.get().projectContext.role, "viewer");
    assert.equal(h.store.session.get().projectContext.permissions.includes("project.author"), false);
  }
  h.store.setRoute(h.deep); await h.store.syncDocumentFromRoute(); h.exact();
  h.store.setRoute(task); h.exact();
  assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), h.ad);
  await h.store.refreshEvents(); h.exact();
  assert.equal(h.requests.filter(row => row.init.method === "POST").length, 0, "Task navigation is read-only for owners and readers");
});

for (const action of ["current-document", "current-project", "another-document", "explicit-project"])
test("actual navigation selection " + action + " does not inherit a different project's Document", async t => {
  const h = await navigationFixture(t);
  h.store.setRoute(h.deep); h.exact();
  if (action === "current-document") assert.equal(await h.store.openDocument(h.ad, "/deliver", "navigation-test"), true);
  else if (action === "current-project") assert.equal(await h.store.openProject(h.a, "/deliver"), true);
  else if (action === "another-document") { assert.equal(await h.store.openDocument(h.otherA), true); h.store.setRoute("/deliver"); }
  else { assert.equal(await h.store.openProject(h.b, "/deliver"), true); h.exact(h.b, h.bd); return; }
  h.exact(h.a, action === "another-document" ? h.otherA : h.ad);
});

for (const query of ["missing", "", "scene-reuse-document&document=navigation-document-b"])
test("claimed unavailable/ambiguous task Document never transiently renders history B: " + query, async t => {
  const h = await navigationFixture(t);
  h.store.setRoute("/deliver?document=" + query);
  assert.equal(h.store.projection.get().projectId, ""); assert.equal(h.store.projection.get().libraryArtifacts.length, 0);
  await h.store.syncDocumentFromRoute();
  assert.equal(h.store.route.get(), "/projects");
  assert.match(h.store.ui.toast, /That document is no longer available/u);
});

test("explicit Project selection replaces an inherited task context, never another project's Work target", async t => {
  const h = await navigationFixture(t); h.store.setRoute(h.deep);
  assert.equal(await h.store.openProject(h.b, "/deliver?document=" + encodeURIComponent(h.ad) + "#ready"), true);
  h.exact(h.b, h.bd); assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), h.bd);
  assert.equal(new URL(h.store.route.get(), "https://fixture.invalid").hash, "#ready");
});

test("exact decoded task IDs never alias whitespace or Unicode variants to a different Document", async t => {
  const h = await navigationFixture(t);
  for (const id of [" " + h.ad, h.ad + " ", "\u00a0" + h.ad, h.ad + "\u2003", h.ad + "\u200b"]) {
    const href = withProjectTaskDocumentInRoute("/deliver", id);
    assert.equal(projectTaskDocumentIdFromRoute(href), id);
    h.store.route.set(href);
    assert.equal(h.store.projection.get().projectId, "");
    assert.equal(h.store.projection.get().libraryArtifacts.length, 0);
  }
  assert.equal(projectTaskDocumentIdFromRoute("/deliver/unknown?document=" + h.ad), null);
  assert.equal(projectTaskDocumentIdFromRoute("/activity/unknown?document=" + h.ad), null);
  assert.equal(projectTaskDocumentIdFromRoute("/library/unknown?document=" + h.ad), null);
  for (const suffix of ["artifact/a/title/extra", "artifact//a", "blocks/editor/a/extra", "blocks/editor/"])
    assert.equal(projectTaskDocumentIdFromRoute("/library/" + suffix + "?document=" + h.ad), null, "Only existing Library route families accept task context");
  assert.equal(projectTaskDocumentIdFromRoute("/canvas/board-a?document=" + h.ad), null);
});

for (const shared of [false, true]) test("cold task URL and fresh Store retain its exact authorized Project and Document / shared=" + shared, async t => {
  const h = await navigationFixture(t, { shared });
  const fresh = await createSceneStoreHost({ workerFixture: { ...h.worker, close() {} } });
  t.after(() => fresh.close());
  fresh.store.loading.set(false);
  fresh.store.route.set("/deliver?document=" + encodeURIComponent(h.ad));
  assert.equal(fresh.store.projection.get().projectId, h.a);
  assert.equal(fresh.store.projection.get().documentId, h.ad);
  await fresh.store.refreshEvents(); await fresh.store.syncDocumentFromRoute();
  assert.equal(fresh.store.projection.get().documentId, h.ad);
  assert.equal(fresh.requests.filter(row => row.init.method === "POST").length, 0);
});
test("cold legacy bare task route still uses established history and invents no project context", async t => {
  const h = await navigationFixture(t); h.store.route.set("/deliver");
  h.exact(h.b, h.bd); assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), null);
});
for (const reader of [false, true]) test("foreign shared task Document is empty before current synchronization / reader=" + reader, async t => {
  const h = await navigationFixture(t, { shared: true, reader });
  h.store.setRoute("/library?document=" + h.bd);
  assert.equal(h.store.projection.get().projectId, "");
  assert.deepEqual(h.store.projection.get().libraryArtifacts, []);
  assert.equal(await h.store.openDocument(h.bd, "/deliver"), false);
  await h.store.syncDocumentFromRoute(); assert.equal(h.store.route.get(), "/projects");
  assert.equal(h.requests.filter(row => row.init.method === "POST").length, 0);
});
for (const shared of [false, true]) test("fresh removal never substitutes history Project B under the old task address / shared=" + shared, async t => {
  const h = await navigationFixture(t, { shared });
  h.store.setRoute(h.deep); h.store.setRoute("/deliver"); h.exact();
  await h.external("DocumentRemoved", { project_id: h.a, document_id: h.ad, fallback_document_id: h.otherA });
  await h.store.refreshEvents();
  assert.equal(h.store.projection.get().projectId, "");
  assert.equal(h.store.projection.get().libraryArtifacts.length, 0);
  await h.store.syncDocumentFromRoute(); assert.equal(h.store.route.get(), "/projects");
});
test("a fresh denied/expired selected context cannot turn a task address into permission", async t => {
  const h = await navigationFixture(t, { shared: true, reader: true });
  h.store.setRoute("/deliver?document=" + h.ad); h.exact();
  const session = h.store.session.get();
  for (const context of [
    { ...session.projectContext, permissions: [] },
    { ...session.projectContext, expiresAt: new Date(Date.now() - 1).toISOString() },
    { ...session.projectContext, projectId: h.b },
  ]) {
    h.store.session.set({ ...session, projectContext: context });
    assert.equal(h.store.projection.get().projectId, "");
    assert.deepEqual(h.store.projection.get().libraryArtifacts, []);
  }
  h.store.session.set(null); assert.equal(h.store.projection.get().projectId, "");
});
for (const destination of ["/", "/deliver"]) test("explicit empty Project does not inherit the previous Document / " + destination, async t => {
  const h = await navigationFixture(t), empty = "navigation-empty-project";
  await h.external("ProjectCreated", { project_id: empty, name: "Empty chosen project" });
  await h.store.refreshEvents(); h.store.setRoute(h.deep);
  assert.equal(await h.store.openProject(empty, destination), true);
  assert.equal(h.store.projection.get().projectId, empty); assert.equal(h.store.projection.get().documentId, "");
});

for (const outcome of ["denied", "lost", "success"]) for (const newer of ["different", "aba"])
test("late Project " + outcome + " cannot restore or retarget a newer " + newer + " navigation", async t => {
  const h = await navigationFixture(t), entered = sceneDeferred(), release = sceneDeferred();
  h.store.setRoute(h.deep); const before = (await h.history()).filter(event => event.type === "ProjectOpened").length;
  h.intercept = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") return;
    entered.resolve(); await release.promise;
    if (outcome === "denied") return Response.json({ error: "navigation_test_denied" }, { status: 403 });
    const response = await h.worker.request(request.url, request.init);
    if (outcome === "lost") throw Error("Lost acknowledgment after the real navigation commit");
    return response;
  };
  const pending = h.store.openProject(h.b, "/deliver");
  await entered.promise; h.exact(h.b, h.bd);
  h.store.setRoute(withDocumentInRoute("/", h.ad, "Newer A"));
  if (newer === "aba") h.store.setRoute("/deliver?document=" + h.bd);
  await h.store.syncDocumentFromRoute(); // The actual Shell synchronizes each new route before later responses settle.
  const route = h.store.route.get(), toast = "Newer view owns feedback"; h.store.patchUi({ toast });
  release.resolve(); assert.equal(await pending, outcome === "success");
  assert.equal(h.store.route.get(), route);
  if (outcome === "denied") {
    // A still-owned source denial retires private UI even after a newer local route.
    assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), false);
    assert.deepEqual(h.store.events.get(), []); assert.deepEqual(h.store.optimisticEvents.get(), []);
    assert.deepEqual(h.store.content.get(), {}); assert.equal(h.store.projection.get().projectId, "");
    assert.equal(h.store.ui.toast, "Canvas sync is paused in this page. Device storage could not confirm removal of private draft bodies or retention of the pause after reload. Do not retry the original changes.");
  } else assert.equal(h.store.ui.toast, toast);
  const count = (await h.history()).filter(event => event.type === "ProjectOpened").length;
  assert.equal(count - before, outcome === "denied" ? 0 : 1, "Already committed original navigation is retained, never duplicated or called canceled");
  assert.equal(h.requests.filter(row => row.init.method === "POST").length, 1);
});
test("owned lost Project acknowledgment preserves its one server history receipt and safe original return address", async t => {
  const h = await navigationFixture(t); h.store.setRoute(h.deep); h.store.setRoute("/library");
  h.intercept = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") return;
    const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 200);
    throw Error("Lost navigation response, not a cancellation receipt");
  };
  assert.equal(await h.store.openProject(h.b, "/deliver"), false, "No client acknowledgment is invented");
  h.exact(); assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), h.ad);
  assert.equal((await h.history()).filter(event => event.type === "ProjectOpened" && event.payload.project_id === h.b).length, 1);
  await h.store.refreshEvents(); h.exact();
  assert.equal(h.requests.filter(row => row.init.method === "POST").length, 1);
});
for (const guard of ["current", "focus"]) test("lost caller " + guard + " prevents Project, Document and task navigation before dispatch", async t => {
  const h = await navigationFixture(t); h.store.setRoute(h.deep); const route = h.store.route.get(), count = h.requests.length;
  const options = guard === "current" ? { current: () => false } : { focus: { current: () => false } };
  assert.equal(await h.store.openProject(h.b, "/deliver", options), false);
  assert.equal(await h.store.openDocument(h.otherA, "/library", "test", options), false);
  h.store.setRoute("/deliver", options);
  assert.equal(h.store.route.get(), route); assert.equal(h.requests.length, count); h.exact();
});
for (const change of ["none", "route", "aba", "authority", "owner"])
test("Canvas Library transition captures exact task origin and refuses newer " + change, async t => {
  const h = await navigationFixture(t), entered = sceneDeferred(), release = sceneDeferred();
  h.store.setRoute(h.deep);
  const session = structuredClone(h.store.session.get()); session.canvas.access = true;
  h.store.session.set(session); let owned = true;
  h.intercept = async request => {
    if (request.url === "/api/session?audience=canvas") { entered.resolve(); await release.promise; return Response.json({ ...session, audience: "canvas" }); }
  };
  const pending = h.store.transitionWorkspace("/canvas/library", { current: () => owned });
  await entered.promise;
  if (change === "route" || change === "aba") {
    h.store.setRoute(withDocumentInRoute("/", h.bd, "Newer B"));
    if (change === "aba") h.store.setRoute(h.deep);
  } else if (change === "authority") h.store.session.set({ ...session, permissionEpoch: "newer-current-authority" });
  else if (change === "owner") owned = false;
  const previous = h.store.route.get(); release.resolve();
  assert.equal(await pending, change === "none");
  if (change === "none") { assert.equal(h.store.route.get(), "/canvas/library?document=" + h.ad); h.exact(); }
  else assert.equal(h.store.route.get(), previous);
  if (change === "authority") assert.equal(h.store.session.get().permissionEpoch, "newer-current-authority");
  assert.equal(h.requests.filter(row => row.init.method === "POST").length, 0);
});

function taskTimers(h) { return [...h.timers].filter(([, value]) => String(value.callback).includes("#projectTaskExpiry")); }
function fireTaskTimer(h, entry) { assert.ok(entry, "one real owned task expiry timer"); h.timers.delete(entry[0]); entry[1].callback(); }
async function finiteTaskClock(t, h, lifetime = 60_000) {
  let now = Date.now(), deadline = now + lifetime;
  t.mock.method(Date, "now", () => now);
  const session = h.store.session.get();
  h.store.session.set({ ...session, projectContext: { ...session.projectContext, expiresAt: new Date(deadline).toISOString() } });
  return { get now() { return now; }, deadline, advance(value) { now = value; } };
}
for (const entry of ["cold", "commit"]) test("owned " + entry + " task expiry invalidates a warm Computed without changing signed fields or doing HTTP", async t => {
  const h = await navigationFixture(t, { shared: true, reader: true }), clock = await finiteTaskClock(t, h);
  const route = "/deliver?document=" + h.ad;
  if (entry === "cold") { h.store.route.set(route); await h.store.syncDocumentFromRoute(); }
  else h.store.setRoute(route);
  const session = h.store.session.get(), bytes = JSON.stringify(session), projection = h.exact(), requests = h.requests.length;
  assert.equal(taskTimers(h).length, 1);
  clock.advance(clock.deadline + 1);
  assert.equal(h.store.projection.get(), projection, "The test really warmed the non-reactive time dependency");
  fireTaskTimer(h, taskTimers(h)[0]);
  assert.equal(h.store.projection.get().projectId, ""); assert.equal(h.store.projection.get().libraryArtifacts.length, 0);
  assert.notEqual(h.store.session.get(), session, "Only a dependency publication occurred");
  assert.equal(JSON.stringify(h.store.session.get()), bytes, "All signed values, capabilities, budgets and exact expiry are unchanged");
  assert.equal(h.store.route.get(), route); assert.equal(h.requests.length, requests); assert.equal(taskTimers(h).length, 0);
});
test("task deadline timer clamps long delays and rearms early firing without publishing authority", async t => {
  const h = await navigationFixture(t, { shared: true }), maximum = 2_147_483_647, clock = await finiteTaskClock(t, h, maximum + 5000);
  h.store.setRoute("/deliver?document=" + h.ad);
  const session = h.store.session.get(), first = taskTimers(h)[0], requests = h.requests.length;
  assert.equal(first[1].delay, maximum);
  clock.advance(clock.now + maximum);
  fireTaskTimer(h, first); h.exact();
  assert.equal(h.store.session.get(), session); assert.equal(taskTimers(h).length, 1); assert.equal(taskTimers(h)[0][1].delay, 5000);
  const early = taskTimers(h)[0]; fireTaskTimer(h, early);
  assert.equal(h.store.session.get(), session); assert.equal(taskTimers(h).length, 1);
  clock.advance(clock.deadline); fireTaskTimer(h, taskTimers(h)[0]);
  assert.equal(h.store.projection.get().projectId, ""); assert.equal(JSON.stringify(h.store.session.get()), JSON.stringify(session));
  assert.equal(h.requests.length, requests);
});
for (const replacement of ["route", "aba", "scope", "actor", "expiry", "personal"])
test("late old task timer cannot clear or publish over a newer " + replacement + " owner", async t => {
  const h = await navigationFixture(t, { shared: true }), clock = await finiteTaskClock(t, h);
  const route = "/deliver?document=" + h.ad;
  h.store.setRoute(route); const old = taskTimers(h)[0], previous = h.store.session.get();
  if (replacement === "route") h.store.setRoute("/projects");
  else if (replacement === "aba") { h.store.setRoute("/library?document=" + h.otherA); h.store.setRoute(route); }
  else {
    const next = replacement === "scope" ? { ...previous, permissionEpoch: "new-scope" }
      : replacement === "actor" ? { ...previous, user: { ...previous.user, userId: "replacement-actor" } }
      : replacement === "expiry" ? { ...previous, projectContext: { ...previous.projectContext, expiresAt: new Date(clock.deadline + 10_000).toISOString() } }
      : { ...previous, projectContext: undefined };
    h.store.session.set(next); h.store.setRoute(route);
  }
  const current = h.store.session.get(), currentTimers = taskTimers(h).map(([id]) => id), currentRoute = h.store.route.get();
  old[1].callback();
  assert.equal(h.store.session.get(), current); assert.equal(h.store.route.get(), currentRoute);
  assert.deepEqual(taskTimers(h).map(([id]) => id), currentTimers, "The obsolete callback cannot clear the replacement timer");
  if (replacement === "route" || replacement === "personal") assert.equal(currentTimers.length, 0);
  else assert.equal(currentTimers.length, 1);
});
for (const expiry of ["invalid", "2000-01-01T00:00:00Z"]) test("cold " + expiry + " task deadline remains empty, never history B or a new permission", async t => {
  const h = await navigationFixture(t, { shared: true }), previous = h.store.session.get();
  const session = { ...previous, projectContext: { ...previous.projectContext, expiresAt: expiry } };
  h.store.session.set(session); h.store.route.set("/deliver?document=" + h.ad);
  const bytes = JSON.stringify(session), requests = h.requests.length;
  await h.store.syncDocumentFromRoute();
  assert.equal(h.store.projection.get().projectId, ""); assert.deepEqual(h.store.projection.get().libraryArtifacts, []);
  assert.equal(h.store.route.get(), "/deliver?document=" + h.ad);
  assert.equal(JSON.stringify(h.store.session.get()), bytes); assert.equal(taskTimers(h).length, 0); assert.equal(h.requests.length, requests);
});
for (const shared of [false, true]) test("retired private result bytes do not erase the authorized navigation identity / shared=" + shared, async t => {
  const h = await navigationFixture(t, { shared });
  h.worker.sqlite.prepare("UPDATE private_content SET redacted_at=?,content='' WHERE content_id=?").run(new Date().toISOString(), h.worker.contentRef);
  h.store.setRoute(h.deep); h.store.setRoute("/deliver");
  await h.store.refreshEvents(); h.exact();
  assert.equal(h.store.projection.get().libraryArtifacts[0].id, "saved-scene-story", "Metadata is not a private-body/release proof");
  assert.equal(h.requests.filter(row => row.init.method === "POST").length, 0);
});

test("a cold bare task and removing its Document query cannot resurrect an expired shared Project", async t => {
  const h = await navigationFixture(t, { shared: true, reader: true }), clock = await finiteTaskClock(t, h);
  h.store.route.set("/deliver"); await h.store.syncDocumentFromRoute();
  const initial = h.store.projection.get(), bytes = JSON.stringify(h.store.session.get()), requests = h.requests.length;
  assert.equal(initial.projectId, h.a); assert.equal(taskTimers(h).length, 1);
  clock.advance(clock.deadline); fireTaskTimer(h, taskTimers(h)[0]);
  assert.equal(h.store.projection.get().projectId, "");
  h.store.setRoute("/deliver?document=" + h.ad);
  assert.equal(h.store.projection.get().projectId, "");
  h.store.setRoute("/deliver"); await h.store.syncDocumentFromRoute();
  assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), h.ad, "An in-app task switch preserves the unavailable address");
  h.store.route.set("/deliver"); await h.store.syncDocumentFromRoute(); // A fresh raw URL may deliberately omit the query.
  assert.equal(h.store.projection.get().projectId, ""); assert.equal(h.store.projection.get().documentId, "");
  assert.equal(h.store.route.get(), "/deliver"); assert.equal(taskTimers(h).length, 0);
  assert.equal(JSON.stringify(h.store.session.get()), bytes); assert.equal(h.requests.length, requests);
});
test("an actual pending session read cannot suppress the existing task deadline before its new authority arrives", async t => {
  const h = await navigationFixture(t, { shared: true }), clock = await finiteTaskClock(t, h);
  h.store.setRoute("/deliver?document=" + h.ad); h.exact();
  const bytes = JSON.stringify(h.store.session.get()), old = taskTimers(h)[0], entered = sceneDeferred(), release = sceneDeferred();
  let returned;
  h.intercept = async request => {
    if (request.url !== "/api/session") return;
    const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 200);
    returned = await response.clone().json(); entered.resolve(); await release.promise; return response;
  };
  const pending = h.store.refreshSession(); await entered.promise;
  clock.advance(clock.deadline + 1); fireTaskTimer(h, old);
  const expired = h.store.projection.get(), expiredSession = JSON.stringify(h.store.session.get());
  release.resolve(); await pending;
  assert.equal(expired.projectId, "", "A pending unverified session read cannot extend the last published authority");
  assert.deepEqual(expired.libraryArtifacts, []); assert.equal(expiredSession, bytes, "Expiry changes no signed field");
  assert.deepEqual(h.store.session.get(), returned, "Only the actual later server response renews the session");
  h.exact(); assert.equal(taskTimers(h).length, 1); assert.equal(h.requests.filter(row => row.init.method === "POST").length, 0);
});
test("actual session renewal replaces the task timer and preserves every returned signed field", async t => {
  const h = await navigationFixture(t, { shared: true }), clock = await finiteTaskClock(t, h);
  h.store.setRoute("/library?document=" + h.ad); h.exact();
  const old = taskTimers(h)[0]; let returned;
  h.intercept = async request => {
    if (request.url !== "/api/session") return;
    const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 200);
    returned = await response.clone().json(); return response;
  };
  await h.store.refreshSession();
  const current = h.store.session.get(), timers = taskTimers(h).map(([id]) => id);
  assert.deepEqual(current, returned); assert.equal(timers.length, 1); assert.notEqual(timers[0], old[0]);
  clock.advance(clock.deadline + 1); old[1].callback();
  assert.equal(h.store.session.get(), current); assert.deepEqual(taskTimers(h).map(([id]) => id), timers); h.exact();
  assert.equal(h.requests.filter(row => row.init.method === "POST").length, 0);
});
for (const change of ["route", "aba", "session-renewal", "session-aba"])
test("unguarded Canvas Library completion cannot move newer actual " + change + " ownership", async t => {
  const h = await navigationFixture(t, { shared: true }), entered = sceneDeferred(), release = sceneDeferred();
  h.store.setRoute(h.deep);
  const session = structuredClone(h.store.session.get()); session.canvas.access = true;
  h.store.session.set(session);
  h.intercept = async request => {
    if (request.url === "/api/session?audience=canvas") { entered.resolve(); await release.promise; return Response.json({ ...session, audience: "canvas" }); }
  };
  const pending = h.store.transitionWorkspace("/canvas/library");
  await entered.promise;
  if (change === "route" || change === "aba") {
    h.store.setRoute(withDocumentInRoute("/", h.otherA, "Newer A Document"));
    if (change === "aba") h.store.setRoute(h.deep);
  } else if (change === "session-renewal") {
    await h.store.refreshSession();
  } else {
    h.worker.setScopedHeaders({}); await h.store.refreshSession();
    assert.equal(h.store.session.get().projectContext, undefined, "The actual server returned the owner's personal context");
    h.worker.setScopedHeaders(h.worker.sharing.headers); await h.store.refreshSession(); await h.store.refreshEvents();
    assert.equal(h.store.session.get().projectContext.projectId, h.a);
  }
  const route = h.store.route.get(), current = h.store.session.get();
  release.resolve(); assert.equal(await pending, false);
  assert.equal(h.store.route.get(), route); assert.equal(h.store.session.get(), current);
  assert.equal(h.requests.filter(row => row.init.method === "POST").length, 0);
});

for (const outcome of ["denied", "malformed", "transport"]) for (const change of ["none", "session-renewal", "session-aba", "owner"])
test("late Canvas " + outcome + " cannot replace feedback after newer " + change, async t => {
  const h = await navigationFixture(t, { shared: true }), entered = sceneDeferred(), release = sceneDeferred();
  h.store.setRoute(h.deep); let owned = true;
  const session = structuredClone(h.store.session.get()); session.canvas.access = true; h.store.session.set(session);
  h.intercept = async request => {
    if (request.url !== "/api/session?audience=canvas") return;
    entered.resolve(); await release.promise;
    if (outcome === "transport") throw Error("Old workspace transport failed");
    return outcome === "denied" ? Response.json({ error: "Old workspace denial" }, { status: 403 }) : new Response("not JSON");
  };
  const pending = h.store.transitionWorkspace("/canvas/library", change === "owner" ? { current: () => owned } : {});
  await entered.promise;
  if (change === "session-renewal") await h.store.refreshSession();
  else if (change === "session-aba") {
    h.worker.setScopedHeaders({}); await h.store.refreshSession();
    h.worker.setScopedHeaders(h.worker.sharing.headers); await h.store.refreshSession(); await h.store.refreshEvents();
  } else if (change === "owner") owned = false;
  const route = h.store.route.get(), current = h.store.session.get(), toast = "The current view owns this feedback"; h.store.patchUi({ toast });
  release.resolve(); assert.equal(await pending, false);
  assert.equal(h.store.route.get(), route); assert.equal(h.store.session.get(), current);
  if (change === "none") assert.notEqual(h.store.ui.toast, toast, "An owned original failure still reports its actual error");
  else assert.equal(h.store.ui.toast, toast);
  assert.equal(h.requests.filter(row => row.init.method === "POST").length, 0);
});

async function navigationPage(t, locale, { nativePreparation = false, ...fixtureOptions } = {}) {
  const h = await navigationFixture(t, fixtureOptions), events = h.store.events.get(), head = h.store.head.get(), content = h.store.content.get();
  h.navigationResumeReads = observeActualSceneResumeReads(h); t.after(() => h.navigationResumeReads.restore());
  const f = await createCalmFullPage(t, { locale, storeHost: h });
  // Reuse the full actual Shell/route/nested renderer, then restore this test's
  // actual Worker records instead of treating the 14-block presentation sample as source proof.
  h.store.events.set(events); h.store.head.set(head); h.store.content.set(content);
  h.store.setRoute(h.deep); await h.store.syncDocumentFromRoute(); await f.settle();
  if (nativePreparation) {
    // Only the command-preparation cases need activeElement/focusin semantics.
    // Register their real literal children before a synchronous native query.
    await registerCalmFullPageComponents(f, ["forma-workspace"]);
    f.native = installOutputNavigationFocusNative(t, f, ports);
    await f.settle();
  }
  installImageFormatNativeLifetime({ f, h, after: callback => t.after(callback) });
  f.navigationHost = h;
  f.task = pathname => f.find("a", node => node.owner.tag === "forma-ui-audience-navigation" && new URL(node.attributes.href, "https://fixture.invalid").pathname === pathname);
  return f;
}
async function openDiscoverySearch(f,query){
  await f.act(f.find("button",node=>node.owner.tag==="forma-shell"&&String(node.attributes.class).includes("command-trigger")));
  const input=f.find("input",node=>node.attributes.id==="command-search");
  input.port.value=query;await f.act(input,"input");return input;
}
for(const locale of ["en","fr","ar","ja"]){
  test("command discovery / "+locale+" / a newly inserted matching document cannot steal the active exact result",async t=>{
    const f=await navigationPage(t,locale),h=f.navigationHost;
    const before=h.requests.length;await openDiscoverySearch(f,"Another A Document");
    assert.equal(h.requests.length,before,"typing and opening search do not fetch private objects");
    const option=f.find("button",node=>node.attributes.role==="option"&&node.text.includes("Another A Document"));
    await f.act(option,"mouseenter");
    await h.external("DocumentRenamed",{document_id:h.ad,old_title:"One current authored direction",new_title:"Another A Document"});
    await h.store.refreshEvents();await f.settle();
    assert.equal(f.tree().visible("button").filter(node=>node.attributes.role==="option"&&node.text.includes("Another A Document")&&node.children.some(child=>typeof child!=="string"&&child.tag==="small"&&child.text.startsWith(commandDiscoveryCopy(locale).document+" · "))).length,2);
    const form=f.find("form",node=>String(node.attributes.class).split(/\s+/u).includes("command-card"));
    await f.act(form,"submit");await f.settle();
    assert.equal(h.store.projection.get().documentId,h.otherA,"active identity survives a changed list index");
    assert.equal(documentIdFromRoute(h.store.route.get()),h.otherA);
    assert.equal(h.requests.some(row=>row.init.method==="POST"&&row.url.startsWith("/api/document-jobs")),false);
  });
  test("command discovery / "+locale+" / composing Enter cannot activate; a removed active object is not replaced",async t=>{
    const f=await navigationPage(t,locale),h=f.navigationHost;
    const input=await openDiscoverySearch(f,"Another A Document"),route=h.store.route.get();
    await f.act(input,"compositionstart");
    await f.act(f.find("form",node=>String(node.attributes.class).split(/\s+/u).includes("command-card")),"submit");
    assert.equal(h.store.route.get(),route);assert.ok(f.tree().visible("input").some(node=>node.attributes.id==="command-search"));
    input.port.value="Another A Document";await f.act(input,"compositionend");
    await h.external("DocumentRemoved",{document_id:h.otherA,fallback_document_id:h.ad});
    await h.store.refreshEvents();await f.settle();
    await f.act(f.find("form",node=>String(node.attributes.class).split(/\s+/u).includes("command-card")),"submit");
    assert.equal(h.store.route.get(),route);assert.equal(h.store.projection.get().documentId,h.ad);
    assert.equal(h.requests.some(row=>row.init.method==="POST"&&row.url.startsWith("/api/document-jobs")),false);
  });
  test("command discovery / "+locale+" / generic preparation opens the existing seven-format chooser without dispatch",async t=>{
    const f=await navigationPage(t,locale,{nativePreparation:true}),h=f.navigationHost,copy=commandDiscoveryCopy(locale),events=await h.history();
    await openDiscoverySearch(f,copy.prepare);
    await f.act(f.find("button",node=>node.attributes.role==="option"&&node.text.includes(copy.prepare)));
    await f.settle();
    const tree=f.tree(),dialogs=tree.visible("dialog").filter(node=>node.owner.tag==="forma-workspace"&&node.owner.isConnected&&node.port?.isConnected&&String(node.attributes.class).split(/\s+/u).includes("next-format-dialog"));
    assert.equal(dialogs.length,1);const dialog=dialogs[0];
    assert.ok(dialog,"the actual Workspace chooser is mounted");
    const inDialog=node=>{for(let current=node;current;current=current.parent)if(current===dialog)return true;return false;};
    const kinds=tree.nodes.filter(node=>node.tag==="forma-ui-choice-card"&&node.component?.isConnected&&!node.hiddenBy&&inDialog(node));
    assert.equal(kinds.length,7);
    assert.deepEqual(await h.history(),events,"preparation does not author source or approve a job");
    assert.equal(h.requests.some(row=>row.init.method==="POST"&&row.url.startsWith("/api/document-jobs")),false);
  });
}
for(const medium of ["image",...DOCUMENT_ARTIFACT_KINDS])test("command discovery / explicit "+medium+" opens only its existing settings",async t=>{
  const f=await navigationPage(t,"en",{nativePreparation:true}),h=f.navigationHost,copy=commandDiscoveryCopy("en"),events=await h.history();
  const label=copy.prepareFormat.replace("{format}",medium==="image"?f.i18n.t("artifact.image.label","Image"):f.i18n.system(documentArtifactDefinition(medium).label));
  await openDiscoverySearch(f,label);
  await f.act(f.find("button",node=>node.attributes.role==="option"&&node.text.includes(label)));
  await f.settle();
  assert.ok(f.native.nativeFocus.some(({node})=>node.owner?.tag==="forma-workspace"
    &&node.attributes["data-workbench-pane"]==="result"&&node.attributes["aria-pressed"]==="true"),
    "the actual requested preparation focused its current selected Result control");
  const className=medium==="image"?"generation-details-dialog":"document-artifact-create";
  const dialog=f.tree().nodes.find(node=>node.tag==="dialog"&&String(node.attributes.class).split(/\s+/u).includes(className)&&!node.hiddenBy);
  assert.ok(dialog,"exact existing preparation dialog is visible");
  if(medium!=="image"){
    const chosen=f.tree().nodes.filter(node=>node.tag==="input"&&node.attributes.name==="artifact-kind"&&node.port.checked);
    assert.deepEqual(chosen.map(node=>node.attributes.value),[medium]);
  }
  assert.equal(h.store.projection.get().documentId,h.ad);assert.deepEqual(await h.history(),events);
  assert.equal(h.requests.some(row=>row.init.method==="POST"&&row.url.startsWith("/api/document-jobs")),false);
});
for (const locale of ["en", "fr", "ar", "ja"]) test("actual " + locale + " full Shell task links, commands and focused Activity retain exact origin", async t => {
  const f = await navigationPage(t, locale), h = f.navigationHost;
  for (const task of ["/deliver", "/library"]) {
    const anchor = f.task(task), href = anchor.attributes.href;
    assert.equal(projectTaskDocumentIdFromRoute(href), h.ad, "Real native href carries context for reload/new-tab");
    const before = h.store.route.get();
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
      let prevented = 0;
      await f.act(anchor, "click", { button: 0, [modifier]: true, preventDefault() { prevented++; } });
      assert.equal(h.store.route.get(), before); assert.equal(prevented, 0, "Native modified activation is not intercepted");
    }
    await f.act(anchor, "click", { button: 0 }); h.exact();
    assert.ok(f.components().some(component => component.tag === (task === "/deliver" ? "forma-deliver" : "forma-library")), "Real routed destination is mounted");
    assert.equal(f.tree().root.text.includes("Historical B Slides"), false);
    assert.equal(f.tree().root.text.includes("Historical project B"), false);
    const work = f.task("/document/" + h.ad + "/one-current-authored-direction");
    assert.equal(documentIdFromRoute(work.attributes.href), h.ad);
    for (const link of f.tree().nodes.filter(node => node.tag === "a" && node.owner.tag === "forma-project-rail" && String(node.attributes.href ?? "").startsWith("/library")))
      assert.equal(projectTaskDocumentIdFromRoute(link.attributes.href), h.ad, "Actual Rail Library links agree, including closed native navigation");
    await f.act(work, "click", { button: 0 }); h.exact();
  }
  const trigger = f.find("button", node => node.owner.tag === "forma-shell" && String(node.attributes.class).includes("command-trigger"));
  await f.act(trigger);
  const label = f.i18n.t("command.openNavigation", "Open {name}", { name: f.i18n.t("shell.navigation.deliver", "Deliver") });
  await f.act(f.find("button", node => node.attributes.role === "option" && node.text.includes(label)));
  assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), h.ad); h.exact();
  h.store.setRoute(withDocumentInRoute("/focus", h.ad, "One current authored direction")); await f.settle();
  const focused = f.find("button", node => String(node.attributes.class).split(/\s+/u).includes("document-focus-activity"));
  await f.act(focused); assert.equal(h.store.route.get(), "/activity?document=" + h.ad); h.exact();
  const deliver = f.find("a", node => node.owner.tag === "forma-activity" && new URL(node.attributes.href, "https://fixture.invalid").pathname === "/deliver");
  assert.equal(projectTaskDocumentIdFromRoute(deliver.attributes.href), h.ad);
  let prevented = 0; const prior = h.store.route.get();
  await f.act(deliver, "click", { button: 0, metaKey: true, preventDefault() { prevented++; } });
  assert.equal(prevented, 0); assert.equal(h.store.route.get(), prior);
  await f.act(deliver, "click", { button: 0 }); h.exact();
  assert.equal(h.requests.filter(row => row.init.method === "POST" && !h.navigationResumeReads.isReadOnlyResume(row)).length, 0, "All real component→Store actions are navigation or free reads only");
});

for (const shared of [false, true]) test("task-to-task navigation retains an unavailable original address instead of substituting current history / shared=" + shared, async t => {
  const h = await navigationFixture(t, { shared });
  h.store.setRoute(h.deep); h.store.setRoute("/deliver"); h.exact();
  await h.external("DocumentRemoved", { project_id: h.a, document_id: h.ad, fallback_document_id: h.otherA });
  await h.store.refreshEvents(); assert.equal(h.store.projection.get().projectId, "");
  h.store.setRoute("/library");
  assert.equal(h.store.projection.get().projectId, "", "A task switch cannot convert unavailable original evidence into historical Project/Document selection");
  assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), h.ad);
});

for (const state of ["removed", "unknown", "duplicate"]) test("actual Shell native href and cold Store keep the " + state + " original task unavailable", async t => {
  const f = await navigationPage(t, "en"), h = f.navigationHost;
  let values = [h.ad];
  h.store.setRoute("/deliver");
  if (state === "removed") {
    await h.external("DocumentRemoved", { project_id: h.a, document_id: h.ad, fallback_document_id: h.otherA });
    await h.store.refreshEvents();
  } else {
    values = state === "unknown" ? ["missing original\u00a0"] : [h.ad, "", h.bd];
    const url = new URL("/deliver", "https://fixture.invalid"); for (const value of values) url.searchParams.append("document", value);
    h.store.route.set(url.pathname + url.search);
  }
  await f.settle(); assert.equal(h.store.projection.get().projectId, "");
  const anchor = f.task("/library"), href = anchor.attributes.href, route = h.store.route.get();
  assert.deepEqual(new URL(href, "https://fixture.invalid").searchParams.getAll("document"), values, "The actual native href cannot drop its unavailable return address");
  for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
    let prevented = 0; await f.act(anchor, "click", { button: 0, [modifier]: true, preventDefault() { prevented++; } });
    assert.equal(prevented, 0); assert.equal(h.store.route.get(), route);
  }
  const fresh = await createSceneStoreHost({ workerFixture: { ...h.worker, close() {} } }); t.after(() => fresh.close());
  fresh.store.loading.set(false); fresh.store.route.set(href);
  assert.equal(fresh.store.projection.get().projectId, "", "Opening that href in a fresh Store never renders history B");
  assert.equal(fresh.store.projection.get().libraryArtifacts.length, 0);
  assert.equal(fresh.requests.filter(row => row.init.method === "POST").length, 0);
  await f.act(anchor, "click", { button: 0 });
  if (h.store.route.get() !== "/projects") {
    assert.deepEqual(new URL(h.store.route.get(), "https://fixture.invalid").searchParams.getAll("document"), values);
    assert.equal(h.store.projection.get().projectId, "");
  }
  assert.equal(h.requests.filter(row => row.init.method === "POST" && !h.navigationResumeReads.isReadOnlyResume(row)).length, 0);
});

for (const outcome of ["pending-expiry", "success", "transport-failure", "new-commit", "new-commit-aba"])
test("actual shared Worker task deadline remains owned across " + outcome + " handoff", async t => {
  const h = await navigationFixture(t, { shared: true }), deadline = Date.parse(h.store.session.get().projectContext.expiresAt);
  let now = deadline - 1000; t.mock.method(Date, "now", () => now);
  h.store.setRoute("/deliver?document=" + h.ad); h.exact();
  const originalSession = h.store.session.get(), bytes = JSON.stringify(originalSession), old = taskTimers(h)[0];
  const entered = sceneDeferred(), release = sceneDeferred(); let returned;
  h.intercept = async request => {
    if (request.url !== "/api/session?audience=canvas") return;
    const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 200, await response.clone().text());
    returned = await response.clone().json(); assert.equal(returned.canvas.access, true, "Actual current Worker permits this free workspace handoff");
    entered.resolve(); await release.promise;
    if (outcome === "transport-failure") throw Error("The actual free session response was lost");
    return response;
  };
  const pending = h.store.transitionWorkspace("/canvas/library"); await entered.promise;
  let expired, expiredSession;
  if (outcome === "pending-expiry") {
    now = deadline + 1; fireTaskTimer(h, taskTimers(h)[0]);
    expired = h.store.projection.get(); expiredSession = JSON.stringify(h.store.session.get());
  } else if (outcome.startsWith("new-commit")) {
    h.store.setRoute("/activity?document=" + h.otherA);
    if (outcome === "new-commit-aba") h.store.setRoute("/deliver?document=" + h.ad);
    const current = h.store.session.get(), timers = taskTimers(h).map(([id]) => id);
    old[1].callback(); assert.equal(h.store.session.get(), current);
    assert.deepEqual(taskTimers(h).map(([id]) => id), timers, "An obsolete callback cannot clear the new route's deadline owner");
  }
  const route = h.store.route.get(); release.resolve(); const moved = await pending;
  if (outcome === "pending-expiry") {
    assert.equal(expired.projectId, "", "Starting a handoff is not renewed authority or a committed new route");
    assert.deepEqual(expired.libraryArtifacts, []); assert.equal(expiredSession, bytes);
    assert.equal(h.store.projection.get().projectId, "", "An expired response is not a fresh source permission");
  } else {
    assert.equal(moved, outcome === "success");
    if (outcome === "success") {
      assert.equal(h.store.route.get(), "/canvas/library?document=" + h.ad); h.exact();
      assert.deepEqual(h.store.session.get(), { ...returned, audience: originalSession.audience }, "Only the existing handoff's documented audience rule changes the returned session");
    } else {
      assert.equal(h.store.route.get(), route); assert.equal(h.store.session.get(), originalSession);
      h.exact(h.a, outcome === "new-commit" ? h.otherA : h.ad);
    }
    assert.equal(taskTimers(h).length, 1, "There is still exactly one owned deadline after the handoff outcome");
    const current = h.store.session.get(), timers = taskTimers(h).map(([id]) => id);
    if (outcome !== "transport-failure") { old[1].callback(); assert.equal(h.store.session.get(), current); assert.deepEqual(taskTimers(h).map(([id]) => id), timers); }
    now = deadline + 1; fireTaskTimer(h, taskTimers(h)[0]);
    assert.equal(h.store.projection.get().projectId, ""); assert.deepEqual(h.store.projection.get().libraryArtifacts, []);
    assert.equal(JSON.stringify(h.store.session.get()), JSON.stringify(current), "Deadline invalidation never fabricates fresh signed session fields");
  }
  assert.equal(h.requests.filter(row => row.init.method === "POST").length, 0);
});


// Real secondary links use the existing full Shell, complete Store, Worker and
// SQLite fixture. Native window/History ports are not a browser certificate.
async function secondaryNavigationDeliver(t, locale) {
  const f = await navigationPage(t, locale), h = f.navigationHost;
  await f.act(f.task("/deliver"), "click", { button: 0 }); h.exact();
  assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), h.ad);
  assert.ok(f.components().some(component => component.tag === "forma-deliver"));
  return f;
}

async function secondaryNavigationColdTab(t, f, href) {
  const h = f.navigationHost, cold = await createSceneStoreHost({ workerFixture: { ...h.worker, close() {} } });
  cold.navigationResumeReads = observeActualSceneResumeReads(cold); t.after(() => cold.navigationResumeReads.restore());
  const events = cold.store.events.get(), head = cold.store.head.get(), content = cold.store.content.get();
  const previousHistory = globalThis.history;
  globalThis.history = {
    pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(cold.location, { pathname: url.pathname, search: url.search, hash: url.hash }); },
    replaceState(...args) { this.pushState(...args); },
  };
  try {
    const page = await createCalmFullPage(t, { locale: f.locale, storeHost: cold });
    // Replace only the fixture's synthetic presentation sample with the real
    // captured Worker records. A new native URL must not inherit Store.setRoute.
    cold.store.events.set(events); cold.store.head.set(head); cold.store.content.set(content); cold.store.route.set(href);
    await cold.store.syncDocumentFromRoute(); await page.settle();
    assert.equal(cold.requests.filter(row => row.init.method === "POST" && !cold.navigationResumeReads.isReadOnlyResume(row)).length, 0);
    const projection = cold.store.projection.get();
    return { route: cold.store.route.get(), projectId: projection.projectId, documentId: projection.documentId,
      historicalBVisible: page.tree().root.text.includes("Historical project B"),
      bSlidesVisible: page.tree().root.text.includes("Historical B Slides"),
      artifacts: projection.libraryArtifacts.map(item => item.id), outputs: projection.libraryOutputs.map(item => item.id) };
  } finally { globalThis.history = previousHistory; await f.settle(); }
}

const secondaryNavigationHeader = f => f.find("a", node => node.owner.tag === "forma-deliver" && node.text.includes(f.i18n.t("deliver.reviewActivity", "Review activity")));
const secondaryNavigationNoPosts = h => assert.equal(h.requests.filter(row => row.init.method === "POST" && !h.navigationResumeReads.isReadOnlyResume(row)).length, 0, "Navigation sends no source, approval, job or financial mutation");

async function secondaryNavigationNativeGuards(f, findLink) {
  const h = f.navigationHost, before = h.store.route.get();
  for (const input of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }, { defaultPrevented: true }]) {
    let prevented = 0;
    await f.act(findLink(), "click", { button: 0, ...input, preventDefault() { prevented++; } });
    assert.equal(prevented, 0, "Native modified, non-primary or already-handled activation is not intercepted");
    assert.equal(h.store.route.get(), before, "The foreground window stays on its current route");
  }
}

function secondaryNavigationArtifactOptions(h, focus) {
  if (focus.kind !== "artifact") return null;
  const artifact = h.store.projection.get().libraryArtifacts.find(item => item.id === focus.id);
  assert.ok(artifact);
  const delivery = artifactDeliveryFor(h.store, artifact);
  return { expectedRevision: delivery.revision, intent: delivery.intent,
    ...(delivery.contentSha256 ? { expectedContentSha256: delivery.contentSha256 } : {}) };
}

for (const locale of ["en", "fr", "ar", "ja"]) test("secondary navigation / " + locale + " / Deliver activity link keeps native and ordinary context", async t => {
  const f = await secondaryNavigationDeliver(t, locale), h = f.navigationHost, history = await h.history();
  await f.act(secondaryNavigationHeader(f), "click", { button: 0 }); h.exact();
  assert.equal(h.store.route.get(), "/activity?document=" + h.ad, "Existing ordinary navigation remains exact");
  await f.act(f.task("/deliver"), "click", { button: 0 });
  await secondaryNavigationNativeGuards(f, () => secondaryNavigationHeader(f));
  const href = secondaryNavigationHeader(f).attributes.href, cold = await secondaryNavigationColdTab(t, f, href);
  assert.equal(projectTaskDocumentIdFromRoute(href), h.ad);
  assert.equal(cold.projectId, h.a); assert.equal(cold.documentId, h.ad);
  assert.equal(cold.historicalBVisible, false); assert.equal(cold.bSlidesVisible, false);
  secondaryNavigationNoPosts(h); assert.deepEqual(await h.history(), history);
});

for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["artifact", "output"])
test("secondary navigation / " + locale + " / Deliver exact " + kind + " preview and footer survive a cold tab", async t => {
  const f = await secondaryNavigationDeliver(t, locale), h = f.navigationHost, history = await h.history();
  const findLink = () => f.find("a", node => node.owner.tag === "forma-deliver" && String(node.attributes.class).split(/\s+/u).includes("forma-deliver-preview")
    && libraryFocusFromRoute(node.attributes.href)?.kind === kind && (kind === "artifact" || libraryFocusFromRoute(node.attributes.href)?.id === "object-nocturne-02"));
  const href = findLink().attributes.href, focus = libraryFocusFromRoute(href), options = secondaryNavigationArtifactOptions(h, focus);
  const sameItem = f.tree().visible("a").filter(node => node.owner.tag === "forma-deliver" && libraryFocusFromRoute(node.attributes.href)?.id === focus.id);
  assert.equal(sameItem.length, 2); assert.ok(sameItem.every(node => node.attributes.href === href), "Preview and footer name the same exact item and intent");
  assert.deepEqual(artifactFocusOptionsFromRoute(href), options, "The native address carries the actual current delivery evidence");
  await secondaryNavigationNativeGuards(f, findLink);
  const cold = await secondaryNavigationColdTab(t, f, href);
  assert.equal(projectTaskDocumentIdFromRoute(href), h.ad);
  assert.equal(cold.projectId, h.a); assert.equal(cold.documentId, h.ad);
  assert.equal(cold.historicalBVisible, false); assert.equal(cold.bSlidesVisible, false);
  assert.equal((kind === "artifact" ? cold.artifacts : cold.outputs).includes(focus.id), true);
  assert.deepEqual(libraryFocusFromRoute(cold.route), focus); assert.deepEqual(artifactFocusOptionsFromRoute(cold.route), options);
  await f.act(findLink(), "click", { button: 0 }); h.exact();
  assert.deepEqual(libraryFocusFromRoute(h.store.route.get()), focus); assert.deepEqual(artifactFocusOptionsFromRoute(h.store.route.get()), options);
  secondaryNavigationNoPosts(h); assert.deepEqual(await h.history(), history);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("secondary navigation / " + locale + " / actual Activity ready-artifact native link keeps the original project", async t => {
  const f = await navigationPage(t, locale), h = f.navigationHost;
  await f.act(f.task("/activity"), "click", { button: 0 }); h.exact();
  const history = await h.history(), findLink = () => f.find("a", node => node.owner.tag === "forma-activity" && libraryFocusFromRoute(node.attributes.href)?.kind === "artifact");
  const href = findLink().attributes.href, focus = libraryFocusFromRoute(href), options = secondaryNavigationArtifactOptions(h, focus);
  assert.deepEqual(artifactFocusOptionsFromRoute(href), options);
  await secondaryNavigationNativeGuards(f, findLink);
  const cold = await secondaryNavigationColdTab(t, f, href);
  assert.equal(projectTaskDocumentIdFromRoute(href), h.ad);
  assert.equal(cold.projectId, h.a); assert.equal(cold.documentId, h.ad);
  assert.equal(cold.historicalBVisible, false); assert.equal(cold.bSlidesVisible, false); assert.ok(cold.artifacts.includes(focus.id));
  assert.deepEqual(libraryFocusFromRoute(cold.route), focus); assert.deepEqual(artifactFocusOptionsFromRoute(cold.route), options);
  await f.act(findLink(), "click", { button: 0 }); h.exact();
  assert.deepEqual(libraryFocusFromRoute(h.store.route.get()), focus); assert.deepEqual(artifactFocusOptionsFromRoute(h.store.route.get()), options);
  secondaryNavigationNoPosts(h); assert.deepEqual(await h.history(), history);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("secondary navigation / " + locale + " / empty Deliver retains its existing exact current-Document action", async t => {
  const f = await navigationPage(t, locale), h = f.navigationHost, project = "navigation-empty-project", document = "navigation-empty-document";
  await h.external("ProjectCreated", { project_id: project, name: "Empty original project" });
  await h.external("DocumentCreated", { project_id: project, document_id: document, title: "Empty original Document" });
  await h.external("ProjectOpened", { project_id: h.b, previous_project_id: project });
  await h.external("DocumentOpened", { document_id: h.bd, previous_document_id: document });
  await h.store.refreshEvents(); h.store.setRoute(withDocumentInRoute("/", document, "Empty original Document")); await h.store.syncDocumentFromRoute(); await f.settle();
  h.exact(project, document); const history = await h.history();
  await f.act(f.task("/deliver"), "click", { button: 0 }); h.exact(project, document);
  await f.act(f.find("button", node => node.owner.tag === "forma-deliver" && node.text === f.i18n.t("deliver.return", "Open the current document")));
  h.exact(project, document); assert.equal(documentIdFromRoute(h.store.route.get()), document);
  const requestCount = h.requests.length, settled = await h.navigationResumeReads.settleOriginalRequests();
  await f.settle();
  assert.equal(h.requests.length, requestCount, "Settling existing original reads does not issue another request");
  assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0, "The exact response evidence has finished before request accounting");
  assert.ok(settled.every(({ request, status, responseStatus }) => status === "fulfilled"
    && ((request.init.method ?? "GET") === "GET" || responseStatus === 200 && h.navigationResumeReads.isReadOnlyResume(request))),
  "Every settled non-GET is the original current-dispatch read with an actual exact200:none response and unchanged SQL counter");
  secondaryNavigationNoPosts(h); assert.deepEqual(await h.history(), history);
});


// Ordinary Chat is a separate real command origin, not Workspace's fallback Ask.
// Reuse the existing complete Shell/Store/Worker and native composer contracts;
// no message is submitted and the original navigation accounting is unchanged.
function cChatCommandControls(x, raw) {
  const { f, h, owner } = x, tree = f.tree();
  assert.ok(owner.isConnected && f.components().includes(owner));
  assert.ok(owner.store === h.store);
  const forms = tree.visible("form").filter(node => node.owner === owner && fObjectClassed(node, "chat-composer"));
  const fields = tree.visible("textarea").filter(node => node.attributes.id === "creative-chat-message"
    && node.owner.tag === "forma-ui-conversation-composer" && node.owner.parentElement === owner);
  assert.equal(forms.length, 1); assert.equal(fields.length, 1);
  const form = forms[0], field = fields[0], composer = field.owner;
  const Constructor = f.modules.get("src/components/design-system/conversation-composer.ts")?.FormaUiConversationComposer;
  assert.equal(typeof Constructor, "function"); assert.ok(composer instanceof Constructor);
  assert.ok(composer.isConnected && composer.parentElement === owner);
  assert.ok(c19NamingWithin(field, form), "The actual composer field belongs to this Chat form in one current tree");
  for (const node of [form, field]) assert.ok(node.port?.isConnected && f.renderer.nodes.includes(node.port));
  assert.equal(field.port.matches(":disabled"), false); assert.equal(Object.hasOwn(field.attributes, "disabled"), false);
  assert.equal(typeof field.handlers.input, "function");
  assert.equal(composer.value, raw); assert.equal(field.properties.value, raw); assert.equal(field.port.value, raw);
  return { form, field, composer };
}
async function cChatCommandType(x, before, value) {
  const { field } = cChatCommandControls(x, before);
  x.f.native.emit("pointerdown", field.port); x.f.native.focus(field.port);
  field.port.value = value; await x.f.act(field, "input");
  return cChatCommandControls(x, value);
}
async function cChatCommandAttempt(x) {
  const { f, h } = x, copy = commandDiscoveryCopy(f.locale), beforeRequests = h.requests.length;
  const trigger = f.find("button", node => node.owner === f.host && fObjectClassed(node, "command-trigger"));
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port);
  await openDiscoverySearch(f, copy.prepare);
  const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.port?.open);
  assert.equal(dialogs.length, 1); assert.ok(dialogs[0].owner === f.host && fObjectClassed(dialogs[0], "command-dialog"));
  const options = tree.visible("button").filter(node => node.owner === f.host && node.attributes.role === "option"
    && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === copy.prepare));
  assert.equal(options.length, 1, "One exact current-Document preparation command, not the first generic match");
  const option = options[0], hints = option.children.filter(child => typeof child !== "string" && child.tag === "small");
  assert.equal(hints.length, 1);
  assert.equal(hints[0].text, [h.store.projection.get().documentTitle, h.store.projection.get().projectName, copy.preparing].join(" · "));
  assert.ok(option.port?.isConnected && f.renderer.nodes.includes(option.port));
  assert.equal(option.port.matches(":disabled"), false);
  assert.equal(h.requests.length, beforeRequests, "Search neither submits Chat nor reads a destination");
  f.native.emit("pointerdown", option.port); f.native.focus(option.port);
  await f.act(option, "click", { button: 0 }); await cSessionCommandSettle(f);
  assert.equal(h.store.ui.commandOpen, false);
}
function cChatCommandArrived(x, beforeRoute) {
  const { f, h, owner } = x;
  assert.equal(owner.isConnected, false); assert.notEqual(h.store.route.get(), beforeRoute);
  assert.equal(h.store.route.get(), withDocumentInRoute("/", h.ad, h.store.projection.get().documentTitle));
  h.exact(); const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.port?.open);
  assert.equal(dialogs.length, 1);
  const chooser = dialogs[0]; assert.ok(fObjectClassed(chooser, "next-format-dialog"));
  assert.equal(chooser.owner.tag, "forma-workspace"); assert.ok(chooser.owner.isConnected && chooser.owner.store === h.store);
  assert.equal(tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && node.component?.isConnected
    && !node.hiddenBy && c19NamingWithin(node, chooser)).length, 7);
}
for (const locale of ["en", "ja"]) for (const changed of [false, true]) test(
  "C ordinary Chat command departure / " + locale + " / " + (changed ? "raw then deliberate clear" : "clean"),
  { concurrency: false, timeout: 45_000 }, async t => {
    const f = await navigationPage(t, locale, { nativePreparation: true }), h = f.navigationHost;
    await registerCalmFullPageComponents(f, ["forma-chat-studio"]);
    const chatHref = withDocumentInRoute("/studio/chat", h.ad, h.store.projection.get().documentTitle);
    const link = f.find("a", node => node.owner.tag === "forma-studio-mode-nav" && node.attributes.href === chatHref);
    assert.ok(link.port.isConnected); f.native.emit("pointerdown", link.port); f.native.focus(link.port);
    await f.act(link, "click", { button: 0 }); await cSessionCommandSettle(f);
    const owners = f.components().filter(component => component.tag === "forma-chat-studio");
    assert.equal(owners.length, 1); const owner = owners[0];
    const Constructor = f.modules.get("src/components/forma-chat-studio.ts")?.FormaChatStudio;
    assert.equal(typeof Constructor, "function"); assert.ok(owner instanceof Constructor && owner.isConnected);
    assert.equal(h.store.route.get(), chatHref); h.exact();
    const x = { f, h, owner };
    cChatCommandControls(x, "");
    const raw = locale === "ja" ? "  未送信のチャット原稿 B\n  " : "  Unsent ordinary Chat draft B\n  ";
    if (changed) await cChatCommandType(x, "", raw);
    cChatCommandControls(x, changed ? raw : "");
    await cSessionCommandSettle(f);
    const before = { route: h.store.route.get(), source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(),
      events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), history: await h.history(), counts: h.counts(),
      receipts: h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
      requests: h.requests.length };
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    const unchanged = async () => {
      await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
      assert.deepEqual(await h.history(), before.history); assert.deepEqual(h.counts(), before.counts);
      assert.equal(JSON.stringify(h.store.events.get()), before.events); assert.equal(h.store.head.get(), before.head);
      assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), before.receipts);
      assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization)); h.exact();
      assert.deepEqual(h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET"
        && !h.navigationResumeReads.isReadOnlyResume(request)), [], "No chat admission, new work, source write or approval");
    };
    await cChatCommandAttempt(x); await unchanged();
    t.diagnostic("C_ORDINARY_CHAT_COMMAND " + JSON.stringify({ locale, changed, originalChatConnected: owner.isConnected,
      sameRoute: h.store.route.get() === before.route, requests: h.requests.length - before.requests,
      canonicalReceiptsAndFiscalUnchanged: true, physicalBrowserClaim: false }));
    if (changed) {
      assert.equal(h.store.route.get(), before.route, "A current command cannot consume ordinary Chat raw input");
      cChatCommandControls(x, raw);
      assert.equal(h.requests.length, before.requests, "Dirty refusal issues no destination request");
      assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
      assert.equal(h.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
      await cChatCommandType(x, raw, "");
      await cChatCommandAttempt(x); await unchanged();
      cChatCommandArrived(x, before.route);
      t.diagnostic("C_ORDINARY_CHAT_CLEAR " + JSON.stringify({ locale, actualComposerClear: true,
        freshGestureReachedExactChooser: true, canonicalReceiptsAndFiscalUnchanged: true }));
    } else cChatCommandArrived(x, before.route);
  });

// C19 naming baseline: append-only complete Shell controls over the existing
// Store/Worker fixture. Metadata is declared RAM setup, not generated media.
// Enter below delivers current combobox keydown plus native implicit-submit
// default through the existing form port; it is not a physical browser claim.
const c19NamingPresentationKey = value => value.replace(/[\u2066-\u2069]/gu, "").normalize("NFC").replace(/\s+/gu, " ").trim();
const c19NamingWithin = (node, ancestor) => { for (let current = node; current; current = current.parent) if (current === ancestor) return true; return false; };
const c19NamingVisibleText = node => typeof node === "string" ? node : node.hiddenBy ? "" : node.children.map(c19NamingVisibleText).join(" ");
function c19NamingOptions(f) {
  const tree = f.tree(), lists = tree.visible("div").filter(node => node.attributes.id === "command-results");
  assert.equal(lists.length, 1); const list = lists[0];
  return tree.visible("button").filter(node => node.owner === f.host && node.attributes.role === "option"
    && String(node.attributes.class).split(/\s+/u).includes("command-row")
    && c19NamingWithin(node, list));
}
function c19NamingRows(f, kind, copy) {
  const prefix = (kind === "document" ? copy.document : copy.saved) + " · ";
  return c19NamingOptions(f).filter(node => node.children.some(child => typeof child !== "string"
    && child.tag === "small" && c19NamingPresentationKey(c19NamingVisibleText(child)).startsWith(prefix)));
}
function c19NamingCurrent(f, node) {
  assert.equal(node.hiddenBy, null, "The complete chosen row is structurally visible");
  assert.equal(node.owner, f.host, "The actual current Shell owns this control");
  assert.ok(node.port?.isConnected && f.renderer.nodes.includes(node.port), "Use the current connected native port, not an earlier render's callback");
}
async function c19NamingOpen(f, query, kind, expectedCount) {
  const h = f.navigationHost, copy = commandDiscoveryCopy(f.locale);
  await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
  const source = h.store.captureSourceOwnership(), authority = h.store.captureAuthorizationScope(), before = h.requests.length;
  assert.ok(authority && h.store.authorizationScopeActive(authority));
  assert.ok(source && h.store.sourceOwnershipActive(source));
  await openDiscoverySearch(f, query);
  assert.equal(h.requests.length, before, "Opening and typing names issue no additional request");
  assert.ok(h.store.authorizationScopeActive(authority) && h.store.sourceOwnershipActive(source), "The original current authority/source still owns this opening");
  const rows = c19NamingRows(f, kind, copy); assert.equal(rows.length, expectedCount);
  for (const row of rows) c19NamingCurrent(f, row);
  return { rows, names: rows.map(row => c19NamingVisibleText(row).replace(/\s+/gu, " ").trim()), authority };
}
async function c19NamingActivate(f, row, method, documentId) {
  c19NamingCurrent(f, row);
  f.c19Navigation.expect(documentId);
  if (method === "click") { await f.act(row, "click", { button: 0 }); return; }
  const targetId = row.attributes.id;
  for (let step = 0; step < 40; step++) {
    const active = c19NamingOptions(f).find(node => String(node.attributes["aria-selected"]) === "true");
    if (active?.attributes.id === targetId) break;
    const input = f.find("input", node => node.attributes.id === "command-search");
    await f.act(input, "keydown", { key: "ArrowDown", isComposing: false });
  }
  const selected = c19NamingOptions(f).filter(node => String(node.attributes["aria-selected"]) === "true");
  assert.equal(selected.length, 1); assert.equal(selected[0].attributes.id, targetId, "Current Arrow keys select the exact displayed row");
  c19NamingCurrent(f, selected[0]);
  const input = f.find("input", node => node.attributes.id === "command-search"), before = f.store.route.get();
  assert.equal(input.attributes["aria-activedescendant"], targetId);
  await f.act(input, "keydown", { key: "Enter", isComposing: false });
  assert.equal(f.store.route.get(), before, "The combobox handler itself does not bypass the native form default");
  await f.act(f.find("form", node => String(node.attributes.class).split(/\s+/u).includes("command-card")), "submit");
}
async function c19NamingArrived(f, documentId, outputId = null) {
  const h = f.navigationHost;
  const arrived = () => outputId ? libraryFocusFromRoute(h.store.route.get())?.kind === "output"
    && libraryFocusFromRoute(h.store.route.get())?.id === outputId
    && projectTaskDocumentIdFromRoute(h.store.route.get()) === documentId : documentIdFromRoute(h.store.route.get()) === documentId;
  for (let step = 0; step < 8 && !arrived(); step++) await f.settle();
  assert.ok(arrived(), "The actual command reaches the exact current target route"); await f.settle();
  h.exact(h.a, documentId); assert.equal(h.store.ui.commandOpen, false);
  if (!outputId) {
    assert.ok(f.components().some(component => component.tag === "forma-workspace" && component.store === h.store), "The exact Document's actual Workspace is mounted");
    return h.store.route.get();
  }
  const focusedRoute = h.store.route.get();
  const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => String(node.attributes.class).split(/\s+/u).includes("library-focus-dialog")
    && node.attributes["aria-labelledby"] === "output-focus-title");
  assert.equal(dialogs.length, 1); const dialog = dialogs[0];
  assert.ok(f.components().some(component => component.tag === "forma-output-card" && component.primary === true
    && component.output?.id === outputId && component.output.documentId === documentId), "The real focused output card receives that exact saved output");
  const closes = tree.visible("button").filter(node => node.owner.tag === "forma-library" && c19NamingWithin(node, dialog)
    && String(node.attributes.class).split(/\s+/u).includes("modal-close"));
  assert.equal(closes.length, 1); assert.ok(f.renderer.nodes.includes(closes[0].port)); await f.act(closes[0]);
  assert.equal(libraryFocusFromRoute(h.store.route.get()), null, "The actual preview Close restores ordinary command reachability");
  return focusedRoute;
}

// Only the eight C19 naming fixtures opt in. Observe original navigation
// responses and place their original Resume read after that exact write.
// This deliberately serializes transport timing; it never replays a request,
// substitutes a response, or changes the shared Resume classifier.
function c19ObserveNavigationReceipts(t, f, expectedDocumentIds) {
  const h = f.navigationHost, prior = h.transport, proofs = new WeakMap(), records = [];
  assert.equal(typeof prior, "function", "Retain the existing original-response Resume observer");
  const expected = [...expectedDocumentIds]; assert.ok(expected.length >= 2 && expected.length <= 3); assert.equal(new Set(expected).size, expected.length);
  let armed = null, inFlight = null;
  const isOriginalNavigation = request => {
    const proof = proofs.get(request);
    return Boolean(proof && request.url === "/api/events" && request.init === proof.init
      && request.init.method === "POST" && request.init.body === proof.bytes
      && JSON.stringify(request.body) === proof.bytes);
  };
  const observe = async (request, record) => {
    const init = request.init, bytes = init.body, envelope = JSON.parse(bytes);
    assert.deepEqual(Object.keys(envelope).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
    assert.equal(envelope.action, "append"); assert.equal(envelope.clientId, "web:lit");
    assert.deepEqual(envelope.event, record.event); assert.deepEqual(envelope.events, [record.event]);
    assert.ok(h.store.authorizationScopeActive(record.authority) && h.store.sourceOwnershipActive(record.source));
    assert.equal(h.store.projection.get().projectId, record.projectId);
    const history = await h.history(), financial = h.counts();
    assert.equal(envelope.expectedSequence, history.at(-1)?.sequence, "One exact current original navigation, not a stale/replayed append");
    const response = await prior(request);
    assert.equal(response.status, 200, "Certify only the original actual successful response");
    const receipt = await response.clone().json();
    assert.equal(response.bodyUsed, false, "The same original response remains available to the Store");
    assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]);
    assert.deepEqual(receipt.rejected, []); assert.equal(receipt.appended.length, 1);
    const event = receipt.appended[0];
    assert.equal(event.type, "DocumentOpened"); assert.deepEqual(event.payload, record.event.payload);
    assert.equal(event.streamId, h.worker.streamId); assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit");
    assert.ok(typeof event.eventId === "string" && event.eventId.length);
    assert.equal(event.sequence, envelope.expectedSequence + 1); assert.equal(receipt.head, event.sequence);
    await h.worker.drainBackground();
    assert.deepEqual(await h.history(), [...history, event], "Actual Worker history gains exactly this returned navigation event and nothing else");
    assert.deepEqual(h.counts(), financial, "Every job/reservation/counter row is unchanged across this exact navigation");
    assert.equal(request.init, init); assert.equal(request.init.body, bytes); assert.equal(JSON.stringify(request.body), bytes);
    assert.ok(h.store.authorizationScopeActive(record.authority) && h.store.sourceOwnershipActive(record.source));
    proofs.set(request, { init, bytes }); record.receipt = { eventId: event.eventId, sequence: event.sequence, head: receipt.head, status: response.status };
    assert.equal(isOriginalNavigation({ ...request }), false, "A cloned request row cannot inherit the original receipt proof");
    return response;
  };
  const transport = request => {
    if (request.url === "/api/events" && request.init.method === "POST") {
      assert.ok(armed && !armed.request && !inFlight, "Only one explicitly armed current DocumentOpened is permitted");
      const record = armed; armed = null; record.request = request; inFlight = record;
      const pending = observe(request, record); record.pending = pending;
      pending.then(() => { if (inFlight === record) inFlight = null; }, () => { if (inFlight === record) inFlight = null; });
      return pending;
    }
    const record = inFlight;
    if (record && isOutputFixtureReadOnlyResume(request, { projectId: record.projectId, documentId: record.documentId })) {
      const init = request.init, bytes = init.body;
      record.queuedResumes++;
      return record.pending.then(() => {
        assert.equal(request.init, init); assert.equal(request.init.body, bytes);
        assert.ok(h.store.authorizationScopeActive(record.authority) && h.store.sourceOwnershipActive(record.source));
        assert.equal(h.store.projection.get().projectId, record.projectId); assert.equal(h.store.projection.get().documentId, record.documentId);
        // The unchanged observer now starts its own zero-change measurement.
        // It must still certify this exact original 200:none response itself.
        return prior(request);
      });
    }
    return prior(request);
  };
  h.transport = transport;
  const restore = () => { if (h.transport === transport) h.transport = prior; };
  t.after(() => { restore(); h.navigationResumeReads.restore(); });
  return {
    expect(documentId) {
      assert.equal(armed, null); assert.equal(inFlight, null); assert.equal(documentId, expected[records.length]);
      const projection = h.store.projection.get(), authority = h.store.captureAuthorizationScope(), source = h.store.captureSourceOwnership();
      assert.ok(authority && h.store.authorizationScopeActive(authority) && source && h.store.sourceOwnershipActive(source));
      assert.equal(h.store.session.get()?.projectContext == null, true, "This fixture observes the existing personal navigation-history path");
      assert.notEqual(documentId, projection.documentId);
      assert.ok(projection.documents.some(document => document.id === documentId && document.projectId === projection.projectId));
      armed = { projectId: projection.projectId, documentId, authority, source, request: null, pending: null, receipt: null, queuedResumes: 0,
        event: { type: "DocumentOpened", payload: { document_id: documentId, previous_document_id: projection.documentId, source_surface: "command-menu" } } };
      records.push(armed);
    },
    isOriginalNavigation,
    async verify() {
      assert.equal(armed, null, "Every expected gesture dispatched its original navigation");
      assert.equal(records.length, expected.length, "Every expected exact target has one original navigation receipt");
      for (const record of records) { assert.ok(record.pending); await record.pending; assert.ok(record.receipt && isOriginalNavigation(record.request)); }
      assert.equal(inFlight, null);
      assert.deepEqual(h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST"), records.map(record => record.request), "No extra event request or retry is exempted");
      return records.map(record => ({ documentId: record.documentId, previousDocumentId: record.event.payload.previous_document_id,
        ...record.receipt, queuedOriginalResumes: record.queuedResumes }));
    },
    restore,
  };
}
async function c19NamingNoEffects(f, history, authority) {
  const h = f.navigationHost;
  const navigationReceipts = await f.c19Navigation.verify();
  await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
  assert.equal(h.store.captureAuthorizationScope()?.key, authority.key);
  assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0);
  const identifier = value => typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/u.test(value) ? value : "[redacted]";
  const ids = value => Object.fromEntries(["projectId", "project_id", "documentId", "document_id", "objectId", "object_id", "outputId", "output_id", "artifactId", "artifact_id", "blockId", "block_id", "generationId", "generation_id", "operationId", "requestId"]
    .filter(key => value && Object.hasOwn(value, key)).map(key => [key, identifier(value[key])]));
  const path = value => {
    const pathname = new URL(value, "https://fixture.invalid").pathname;
    return /^\/api\/(?:events(?:\/batch)?|workspace\/quick-edit|session|output-requirements|document-jobs)$/u.test(pathname) ? pathname : "/api/[other path redacted]";
  };
  const body = value => {
    const events = Array.isArray(value?.events) ? value.events : Array.isArray(value) ? value : value?.type ? [value] : [];
    return { ...ids(value), ...(typeof value?.action === "string" ? { action: ["resume", "preview", "apply", "check"].includes(value.action) ? value.action : "[other]" } : {}),
      events: events.map(event => ({ type: typeof event?.type === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(event.type) ? event.type : "[redacted]", ...ids(event?.payload) })) };
  };
  // Diagnostic only: no query strings, headers, cookies, tokens, raw content,
  // response bodies or global classifier changes. All assertions below remain.
  console.log("C19_NO_EFFECTS_DIAGNOSTIC", JSON.stringify({ locale: f.locale,
    posts: h.requests.filter(request => request.init.method === "POST").map(request => ({ method: "POST", path: path(request.url),
      body: body(request.body), certifiedOriginalResume: h.navigationResumeReads.isReadOnlyResume(request) })),
    resumeObservations: h.navigationResumeReads.observations().map(value => ({ method: value.method === "POST" ? "POST" : "[other]", path: path(value.url),
      scope: ids(value.scope), body: body(value.body), dispatchOwned: value.dispatchOwned, responseStatus: value.responseStatus,
      responseStatusValue: value.responseStatusValue === "none" ? "none" : value.responseStatusValue == null ? null : "[other]",
      exactNone: value.exactNone, sqliteChangesBefore: value.sqliteChangesBefore, sqliteChangesAfter: value.sqliteChangesAfter,
      sqliteUnchanged: value.sqliteUnchanged, inputUnchanged: value.inputUnchanged, classified: value.classified,
      clonedOuterRowClassified: value.clonedOuterRowClassified, readError: value.readError === null ? null : "[present]" })) }));
  console.log("C19_NAVIGATION_RECEIPTS", JSON.stringify(navigationReceipts));
  assert.equal(h.requests.filter(request => (request.init.method ?? "GET") !== "GET"
    && !h.navigationResumeReads.isReadOnlyResume(request) && !f.c19Navigation.isOriginalNavigation(request)).length, 0,
  "Every non-GET is its original certified free Resume or one exact acknowledged DocumentOpened; no other mutation is permitted");
  assert.deepEqual((await h.history()).filter(event => !navigationTypes.has(event.type)),
    history.filter(event => !navigationTypes.has(event.type)), "No source, output, approval or paid event is added by any current command");
  f.c19Navigation.restore();
  // navigationFixture's existing after hook independently compares every
  // original job/reservation/counter row, not only totals.
}

for (const locale of ["en", "ja"]) for (const collision of [false, true]) {
  test("C19 full Shell document naming / " + locale + " / " + (collision ? "NFC-equivalent exact targets" : "distinct-name healthy control"), async t => {
    const f = await navigationPage(t, locale), h = f.navigationHost;
    const ids = ["c19-name-document-a", "c19-name-document-b"];
    const titles = collision ? ["C19 Café", "C19 Cafe\u0301"] : ["C19 Café north", "C19 Café south"];
    for (let index = 0; index < ids.length; index++) await h.external("DocumentCreated", {
      project_id: h.a, document_id: ids[index], title: titles[index], handle: "c19-document-" + index,
    });
    await h.store.refreshEvents(); await f.settle(); h.exact();
    const documents = h.store.projection.get().documents.filter(document => ids.includes(document.id));
    assert.deepEqual([...documents.map(document => document.id)].sort(), [...ids].sort());
    for (let index = 0; index < ids.length; index++) assert.equal(documents.find(document => document.id === ids[index]).title, titles[index], "The actual projection preserves each legitimate authored spelling");
    const history = await h.history(), authority = h.store.captureAuthorizationScope(), observations = []; let names;
    f.c19Navigation = c19ObserveNavigationReceipts(t, f, documents.map(document => document.id));
    // Display order is used solely to exercise each actual bound command.
    // Human distinguishability is asserted separately after all exact routes.
    for (let index = 0; index < documents.length; index++) {
      const opening = await c19NamingOpen(f, "C19 cafe", "document", documents.length);
      names ??= opening.names; assert.deepEqual(opening.names, names, "Ordinary reopen preserves the complete current labels");
      const method = index === 0 ? "click" : "Enter", document = documents[index];
      await c19NamingActivate(f, opening.rows[index], method, document.id);
      await c19NamingArrived(f, document.id);
      observations.push({ method, expectedDocumentId: document.id, route: h.store.route.get(), visibleRow: opening.names[index] });
    }
    await c19NamingNoEffects(f, history, authority);
    t.diagnostic("C19_DOCUMENT_NAMING " + JSON.stringify({ locale, collision, names, observations, sourceAndAuthority: "current", effects: "navigation/free-read only" }));
    assert.equal(new Set(names.map(c19NamingPresentationKey)).size, ids.length,
      "Distinct exact documents need distinct complete visible command names after NFC/isolate/whitespace presentation comparison");
  });

  test("C19 full Shell saved-output naming / " + locale + " / " + (collision ? "composed context suffix" : "distinct-context healthy control"), async t => {
    const f = await navigationPage(t, locale), h = f.navigationHost, copy = commandDiscoveryCopy(locale);
    const documentIds = ["c19-scope-document-a", "c19-scope-document-b", "c19-scope-document-c"];
    const outputIds = ["c19-scope-image-a", "c19-scope-image-b", "c19-scope-image-c"];
    const titles = collision ? ["C19 context", "C19 context", "C19 context · " + copy.reference + " " + outputIds[0]]
      : ["C19 context north", "C19 context south", "C19 context east"];
    for (let index = 0; index < documentIds.length; index++) {
      await h.external("DocumentCreated", { project_id: h.a, document_id: documentIds[index], title: titles[index], handle: "c19-scope-" + index });
      await h.external("GenerationCompleted", {
        project_id: h.a, document_id: documentIds[index], generation_id: "c19-declared-saved-" + index, object_ids: [outputIds[index]],
        title: "C19 saved result", provider: "in-memory-saved-metadata", model_id: "fixture-saved-image",
        media_url: "/api/media/" + outputIds[index], media_type: "image/png", image_width: 640, image_height: 480,
      });
      await h.external("ObjectSaved", { project_id: h.a, document_id: documentIds[index], object_id: outputIds[index] });
    }
    await h.store.refreshEvents(); await f.settle(); h.exact();
    const outputs = h.store.projection.get().libraryOutputs.filter(output => outputIds.includes(output.id));
    assert.deepEqual([...outputs.map(output => output.id)].sort(), [...outputIds].sort());
    for (let index = 0; index < outputIds.length; index++) {
      const output = outputs.find(value => value.id === outputIds[index]);
      assert.equal(output.documentId, documentIds[index]); assert.equal(output.title, "C19 saved result"); assert.equal(output.saved, true);
      assert.equal(h.store.projection.get().libraryOutputs.filter(value => value.documentId === documentIds[index]).length, 1, "Each fresh document has one take; take numbering is not a confounding discriminator");
      assert.equal(h.store.projection.get().documents.find(document => document.id === documentIds[index]).title, titles[index]);
    }
    const history = await h.history(), authority = h.store.captureAuthorizationScope(), observations = []; let names;
    f.c19Navigation = c19ObserveNavigationReceipts(t, f, outputs.map(output => output.documentId));
    for (let index = 0; index < outputs.length; index++) {
      const opening = await c19NamingOpen(f, "C19 saved result", "image", outputs.length);
      names ??= opening.names; assert.deepEqual(opening.names, names);
      const method = index === 1 ? "Enter" : "click", output = outputs[index];
      await c19NamingActivate(f, opening.rows[index], method, output.documentId);
      const route = await c19NamingArrived(f, output.documentId, output.id);
      observations.push({ method, route, expectedDocumentId: output.documentId, expectedOutputId: output.id,
        visibleRow: opening.names[index], exactFocusedCard: true });
    }
    await c19NamingNoEffects(f, history, authority);
    t.diagnostic("C19_OUTPUT_NAMING " + JSON.stringify({ locale, collision, names, observations, sourceAndAuthority: "current", effects: "navigation/free-read only" }));
    assert.equal(new Set(names.map(c19NamingPresentationKey)).size, outputIds.length,
      "A composed ID suffix must not alias another authored document context in the complete visible output choice");
  });
}


// Missing explicit-command interruption coverage. The original seven-format
// and four-locale chooser cases above remain the main healthy opening baseline.
async function finishCommandPreparation(f, pending) {
  let done=false,value,error;
  Promise.resolve(pending).then(result=>{done=true;value=result;},failure=>{done=true;error=failure;});
  for(let attempt=0;attempt<32&&!done;attempt++){
    await f.settle();
    for(const[id,timer]of [...f.storeHost.timers])if(timer.delay===16){
      f.storeHost.timers.delete(id);timer.callback(0);
    }
    await new Promise(setImmediate);
  }
  assert.equal(done,true,"the original command reached its bounded native update/RAF boundary");
  if(error)throw error;return value;
}
for(const [locale,boundary]of [["ja","healthy"],["en","pointerdown"],["ja","focus"],["en","authority"],["ja","document"]])
test("command discovery / native explicit Audio ownership / "+locale+" / "+boundary,
  {concurrency:false,timeout:30_000},async t=>{
    const release=sceneDeferred(),entered=sceneDeferred();let restore=()=>{};
    // Release the native barrier before the underlying page/Worker cleanup.
    t.after(()=>{release.resolve();restore();});
    const f=await navigationPage(t,locale,{nativePreparation:true}),h=f.navigationHost,copy=commandDiscoveryCopy(locale);
    const events=(await h.history()).filter(event=>!navigationTypes.has(event.type));
    const source=h.store.captureSourceOwnership(),authority=h.store.captureAuthorizationScope();
    assert.ok(h.store.sourceOwnershipActive(source)&&h.store.authorizationScopeActive(authority));
    const label=copy.prepareFormat.replace("{format}",f.i18n.system(documentArtifactDefinition("audio").label));
    await openDiscoverySearch(f,label);
    const row=f.find("button",node=>node.attributes.role==="option"
      &&node.children.some(child=>typeof child!=="string"&&child.tag==="span"&&child.text===label));
    const tick=f.tick;let held=false,workspace=null;
    f.tick=async owner=>{
      const result=await tick(owner);
      if(!held&&owner.tag==="forma-workspace"&&owner.isConnected&&owner===f.host.querySelector("forma-workspace")
        &&owner.store===h.store&&!h.store.ui.commandOpen&&h.store.projection.get().documentId===h.ad){
        const pane=owner.querySelector('[data-workbench-pane="result"]');
        if(pane?.isConnected&&pane.getAttribute("aria-pressed")==="true"){
          held=true;workspace=owner;entered.resolve();await release.promise;
        }
      }
      return result;
    };
    restore=()=>{f.tick=tick;};
    const traceStart=f.trace.length,activation=f.act(row);
    await finishCommandPreparation(f,entered.promise);
    assert.equal(held,true,"the actual Workspace committed Result before its native focus/promotion");
    assert.ok(workspace?.isConnected&&workspace.store===h.store);
    assert.equal(h.store.ui.commandOpen,false);
    assert.equal(f.tree().visible("dialog").filter(node=>/generation-details-dialog|document-artifact-create|next-format-dialog/u.test(String(node.attributes.class))).length,0);
    let moved=null;
    if(boundary==="pointerdown"||boundary==="focus"){
      const trigger=f.find("button",node=>node.owner===f.host&&String(node.attributes.class).split(/\s+/u).includes("command-trigger"));
      assert.ok(trigger.port.isConnected&&!trigger.hiddenBy);
      moved=trigger.port;
      if(boundary==="focus")f.native.focus(moved);
      else f.native.emit("pointerdown",moved);
    }else if(boundary==="authority"){
      h.store.session.set({...h.store.session.get(),permissionEpoch:"newer-command-preparation-owner"});
      assert.equal(h.store.authorizationScopeActive(authority),false,"the original Store authority is genuinely retired");
    }else if(boundary==="document"){
      h.store.setRoute(withDocumentInRoute("/",h.otherA,"Another A Document"));
      await h.store.syncDocumentFromRoute();await f.settle();
      h.exact(h.a,h.otherA);
    }
    const route=h.store.route.get(),session=h.store.session.get();
    const documentId=h.store.projection.get().documentId,focusCount=f.native.nativeFocus.length;
    release.resolve();await finishCommandPreparation(f,activation);
    const tree=f.tree(),dialogs=tree.visible("dialog").filter(node=>node.port?.open
      &&/generation-details-dialog|document-artifact-create|next-format-dialog/u.test(String(node.attributes.class)));
    const promotions=f.trace.slice(traceStart).filter(value=>value.startsWith("open:")
      &&/generation-details-dialog|document-artifact-create|next-format-dialog/u.test(value));
    assert.equal(h.store.route.get(),route);assert.equal(h.store.session.get(),session);
    assert.equal(h.store.projection.get().documentId,documentId);
    assert.deepEqual((await h.history()).filter(event=>!navigationTypes.has(event.type)),events,
      "only an explicit native route selection may add a navigation receipt; authored/approval source is unchanged");
    await h.navigationResumeReads.settleOriginalRequests();
    assert.equal(h.requests.filter(request=>(request.init.method??"GET")!=="GET"
      &&!h.navigationResumeReads.isReadOnlyResume(request)).length,0,
      "free preparation has no command, generation, approval or paid dispatch");
    t.diagnostic("COMMAND_EXPLICIT_NATIVE "+JSON.stringify({locale,boundary,held,documentId,route,
      promoted:promotions,dialogs:dialogs.length,resultFocus:f.native.nativeFocus.some(({node})=>
        node.owner?.tag==="forma-workspace"&&node.attributes["data-workbench-pane"]==="result")}));
    if(boundary!=="healthy"){
      assert.deepEqual(promotions,[],"a stale opening must not transiently promote any preparation dialog");
      assert.equal(dialogs.length,0);assert.equal(f.native.nativeFocus.length,focusCount,"old opening cannot steal newer focus");
      if(boundary==="focus")assert.equal(f.native.document.activeElement,moved);
      return;
    }
    assert.equal(dialogs.length,1);assert.ok(String(dialogs[0].attributes.class).split(/\s+/u).includes("document-artifact-create"));
    assert.equal(dialogs[0].owner.store,h.store);
    const radios=tree.visible("input").filter(node=>node.owner===dialogs[0].owner&&node.attributes.name==="artifact-kind");
    assert.ok(radios.length>1);assert.deepEqual(radios.filter(node=>node.port.checked).map(node=>node.attributes.value),["audio"]);
    assert.ok(f.native.nativeFocus.slice(focusCount).some(({node})=>node.owner===workspace
      &&node.attributes["data-workbench-pane"]==="result"&&node.attributes["aria-pressed"]==="true"));
  });


// F intelligence reach only: complete current Shell/Store and CEM-loaded route
// hosts through the existing navigationPage and exact command control. Native
// ports and Worker data are RAM fixtures, not a browser/adoption certificate.
const F_INTELLIGENCE_ENTRIES = [
  { id: "sessions", key: "command.openSessions", label: "Resume a previous creative session",
    path: "/sessions", tag: "forma-sessions", file: "src/components/forma-sessions.ts", name: "FormaSessions" },
  { id: "scout", key: "command.runScout", label: "Run a bounded scout report",
    path: "/scout", tag: "forma-scout", file: "src/components/forma-scout.ts", name: "FormaScout" },
  { id: "memory", key: "command.reviewMemory", label: "Review taste and time memory",
    path: "/memory", tag: "forma-memory", file: "src/components/forma-memory.ts", name: "FormaMemory" },
];
const fIntelligenceOptions = { concurrency: false, timeout: 45_000 };
const fIntelligenceLabel = (f, entry) => f.i18n.t(entry.key, entry.label);
const fIntelligenceRows = f => f.tree().visible("button").filter(node =>
  node.owner === f.host && node.attributes.role === "option");
const fIntelligenceRowHasLabel = (node, label) => node.children.some(child =>
  typeof child !== "string" && child.tag === "span" && child.text === label);
async function fIntelligenceBaseline(f) {
  const h = f.navigationHost;
  await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
  return { history: await h.history(), counts: h.counts(), requests: h.requests.length,
    source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(),
    actor: h.store.session.get().user.userId, origin: h.store.route.get(),
    projection: { projectId: h.store.projection.get().projectId, documentId: h.store.projection.get().documentId } };
}
async function fIntelligenceNoCommands(f, before) {
  const h = f.navigationHost;
  await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
  assert.deepEqual(await h.history(), before.history, "Reach/local input does not append navigation, source or approval events");
  assert.deepEqual(h.counts(), before.counts, "The existing job and three budget-table rows stay exact");
  const writes = h.requests.slice(before.requests).filter(row =>
    (row.init.method ?? "GET") !== "GET" && !h.navigationResumeReads.isReadOnlyResume(row));
  assert.deepEqual(writes, [], "No run, Save, session operation, preference, promotion, condition, chat or provider submission");
  assert.equal(h.store.session.get().user.userId, before.actor);
  assert.ok(h.store.authorizationScopeActive(before.authorization));
}
async function fIntelligenceChoose(f, entry) {
  const label = fIntelligenceLabel(f, entry);
  await openDiscoverySearch(f, label);
  const rows = fIntelligenceRows(f).filter(node => fIntelligenceRowHasLabel(node, label));
  assert.equal(rows.length, 1, "One exact current localized command row");
  assert.ok(rows[0].port.isConnected && f.renderer.nodes.includes(rows[0].port));
  await f.act(rows[0]);
  assert.equal(f.store.ui.commandOpen, false);
  assert.equal(f.store.route.get(), entry.path, "The command navigates; it does not run the named operation");
}

for (const locale of ["en", "ja"]) for (const entry of F_INTELLIGENCE_ENTRIES)
test("F intelligence command arrival / " + locale + " / " + entry.id, fIntelligenceOptions, async t => {
  const f = await navigationPage(t, locale), h = f.navigationHost, before = await fIntelligenceBaseline(f);
  assert.equal(h.store.session.get().projectContext, undefined, "The unchanged fixture supplies a current personal owner");
  assert.ok(h.store.sourceOwnershipActive(before.source));
  if (locale !== "en") assert.notEqual(fIntelligenceLabel(f, entry), entry.label);
  await fIntelligenceChoose(f, entry);
  const owners = f.components().filter(owner => owner.tag === entry.tag);
  assert.equal(owners.length, 1);
  const owner = owners[0], Constructor = f.modules.get(entry.file)?.[entry.name];
  assert.equal(typeof Constructor, "function", "The existing CEM loader resolved the complete current route class");
  assert.ok(owner instanceof Constructor && owner.isConnected);
  assert.equal(owner.store, h.store);
  assert.equal(h.store.routeDataReady(entry.path), true);
  assert.ok(h.store.sourceOwnershipActive(before.source));
  // These routes are account intelligence, not Document task URLs. Observe
  // their existing projection; do not invent a new same-Document route grant.
  const currentProjection = { projectId: h.store.projection.get().projectId,
    documentId: h.store.projection.get().documentId };
  let localValue;
  if (entry.id === "scout") {
    const field = () => f.find("select", node => node.owner === owner);
    assert.ok(field().port.isConnected); field().port.value = "2";
    await f.act(field(), "change");
    assert.equal(field().properties.value, "2"); localValue = "2";
  } else {
    const field = () => entry.id === "sessions"
      ? f.find("textarea", node => node.owner === owner && node.attributes.id === "session-intent-statement")
      : f.find("input", node => node.owner === owner && String(node.attributes.maxlength) === "120");
    const raw = "  F local unsubmitted " + entry.id + " — 文書\n";
    const current = field(); assert.ok(current.port.isConnected);
    assert.equal(Object.hasOwn(current.attributes, "disabled"), false);
    current.port.value = raw; await f.act(current, "input");
    assert.equal(field().properties.value, raw); localValue = raw;
  }
  await f.settle();
  assert.ok(owner.isConnected && f.components().includes(owner));
  assert.equal(h.store.route.get(), entry.path);
  assert.ok(h.store.sourceOwnershipActive(before.source));
  await fIntelligenceNoCommands(f, before);
  t.diagnostic("F_INTELLIGENCE_REACH " + JSON.stringify({ locale, entry: entry.id,
    origin: before.origin, route: h.store.route.get(), originalProjection: before.projection,
    currentProjection, actualHost: entry.tag, currentLocalField: true, localValue,
    commandActivations: ["open-search", "activate-exact-row"], operationSubmitted: false }));
});

for (const locale of ["en", "ja"])
test("F intelligence commands stay absent in existing shared context / " + locale, fIntelligenceOptions, async t => {
  // Optional helper argument reuses navigationFixture's existing real shared
  // owner setup. No invented capability, role, cookie or success response.
  const f = await navigationPage(t, locale, { shared: true }), h = f.navigationHost;
  const context = h.store.session.get().projectContext;
  assert.ok(context && context.projectId === h.a);
  assert.ok(context.permissions.includes("project.read"));
  const before = await fIntelligenceBaseline(f); assert.ok(h.store.sourceOwnershipActive(before.source));
  await openDiscoverySearch(f, "");
  assert.equal(h.store.ui.commandOpen, true);
  for (const entry of F_INTELLIGENCE_ENTRIES)
    assert.equal(fIntelligenceRows(f).some(node => fIntelligenceRowHasLabel(node, fIntelligenceLabel(f, entry))), false);
  const work = f.i18n.t("command.openNavigation", "Open {name}", { name: f.i18n.t("shell.navigation.work", "Work") });
  assert.ok(fIntelligenceRows(f).some(node => fIntelligenceRowHasLabel(node, work)), "Authorized ordinary navigation still exists");
  assert.equal(h.store.route.get(), before.origin);
  assert.ok(h.store.sourceOwnershipActive(before.source));
  assert.equal(h.store.session.get().projectContext, context);
  assert.equal(f.components().some(owner => F_INTELLIGENCE_ENTRIES.some(entry => entry.tag === owner.tag)), false);
  await fIntelligenceNoCommands(f, before);
});

for (const locale of ["en", "ja"])
test("F intelligence static navigation cannot expose a denied current Source / " + locale, fIntelligenceOptions, async t => {
  const f = await navigationPage(t, locale), h = f.navigationHost, before = await fIntelligenceBaseline(f);
  assert.ok(h.store.sourceOwnershipActive(before.source));
  // Reuse the actual missing-cohort GET denial pattern already exercised by
  // project-intake-source-owner-lifetime. It is not a replacement HTTP error
  // or a new grant, and the prior environment value is restored exactly.
  const env = h.worker.env, key = "FORMA_PILOT_COHORT_ID", had = Object.hasOwn(env, key), previous = env[key];
  const intercept = h.intercept, pending = new Set(), denied = [];
  env[key] = "synthetic-missing-f-intelligence-cohort";
  h.intercept = request => {
    if (!request.url.startsWith("/api/events?") || (request.init.method ?? "GET") !== "GET")
      return intercept?.(request);
    const original = (async () => {
      const response = await h.worker.request(request.url, request.init);
      assert.equal(response.status, 403);
      assert.equal((await response.clone().json()).error, "pilot_participant_required");
      denied.push(request); return response; // SAME actual response after observation.
    })();
    pending.add(original);
    original.then(() => pending.delete(original), () => pending.delete(original));
    return original;
  };
  try {
    await assert.rejects(h.store.refreshEvents({ fromStart: true }), /Event stream returned 403/u);
    await f.settle(); assert.ok(denied.length > 0, "A current actual Worker denial was reached");
    assert.equal(h.store.sourceOwnershipActive(before.source), false);
    assert.ok(h.store.authorizationScopeActive(before.authorization), "Source retirement is not a fabricated actor change");
    for (const entry of F_INTELLIGENCE_ENTRIES) {
      // Static navigation may remain offered while Source is unavailable.
      // The contract is no private host/adoption, not a blanket absent command.
      await fIntelligenceChoose(f, entry);
      await Promise.all([...pending]); await f.settle();
      assert.equal(h.store.routeDataReady(entry.path), false);
      assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), false);
      assert.equal(f.components().some(owner => F_INTELLIGENCE_ENTRIES.some(value => value.tag === owner.tag)), false);
      const main = f.find("main", node => node.attributes.id === "main-content");
      assert.equal(main.attributes["aria-busy"], "true");
      assert.equal(h.store.eventView.get().length, 0);
      assert.deepEqual(h.store.content.get(), {});
    }
    await fIntelligenceNoCommands(f, before);
    t.diagnostic("F_INTELLIGENCE_SOURCE_NEGATIVE " + JSON.stringify({ locale, deniedReads: denied.length,
      routes: F_INTELLIGENCE_ENTRIES.map(entry => entry.path), actualHostCount: 0,
      originalAuthorityCurrent: h.store.authorizationScopeActive(before.authorization), operationSubmitted: false }));
  } finally {
    await Promise.all([...pending]);
    h.intercept = intercept;
    if (had) env[key] = previous; else delete env[key];
  }
});


// F exact saved-object commands. This is declared RAM content/event setup and
// the unchanged complete Shell/Store/Worker/native path, not generated-media proof.
import { storePrivateContent as fObjectStorePrivateContent } from "../worker/pilot-policy.ts";
import { documentArtifactRevision as fObjectArtifactRevision } from "../src/model/document-artifacts.ts";
const fObjectClassed=(node,name)=>String(node.attributes?.class??"").split(/\s+/u).includes(name);
async function fObjectNoEffects(f,history,authority){
  const h=f.navigationHost;
  await h.navigationResumeReads.settleOriginalRequests();await f.settle();
  assert.equal(h.store.captureAuthorizationScope()?.key,authority.key);
  assert.deepEqual(await h.history(),history,"opening, Close and return do not author source, approval or export receipts");
  assert.equal(h.requests.filter(request=>(request.init.method??"GET")!=="GET"
    &&!h.navigationResumeReads.isReadOnlyResume(request)).length,0,
    "only original certified free reads are allowed; no generation, Save, approval, export or paid command");
}
async function fObjectArtifact(t,kind,locale){
  const f=await navigationPage(t,locale,{nativePreparation:true}),h=f.navigationHost;
  await registerCalmFullPageComponents(f,["forma-library"]);
  await h.navigationResumeReads.settleOriginalRequests();await f.settle();
  // Same actual private-content producer and completed-event shape as the
  // existing scene-cost/assigned-review fixtures. No supplied ready snapshot.
  const id="f-command-"+kind,title="F exact saved "+kind,marker="F_EXACT_PRIVATE_"+kind;
  const item={title:"Retained "+kind,body:marker,notes:"Original retained evidence",image_prompt:"",context_group_ids:[],slide:null};
  const bytes=JSON.stringify({title,summary:"Exact saved-object fixture",content_markdown:marker,presentation:null,items:[item]});
  const stored=await fObjectStorePrivateContent(h.worker.env,h.worker.owner,"document-artifact",bytes);
  await h.external("DocumentRenderCompleted",{project_id:h.a,document_id:h.ad,artifact_id:id,artifact_kind:kind,
    title,summary:"Exact saved-object fixture",content_ref:stored.contentId,item_count:1,
    items:[{id:id+"-part",title:item.title}],source_block_versions:[{block_id:"scene-reuse-direction",version:1}],
    requested_by_user_id:h.worker.owner});
  await h.store.refreshEvents();await f.settle();
  const artifact=h.store.projection.get().libraryArtifacts.find(value=>value.id===id);
  assert.ok(artifact,"the actual current Source contains this saved artifact");
  assert.equal(artifact.kind,kind);assert.equal(artifact.documentId,h.ad);assert.equal(artifact.contentRef,stored.contentId);
  assert.equal(fObjectArtifactRevision(h.store.events.get(),id),0);h.exact();
  // A genuine current private read proves bytes are available before any
  // command; warm content is not manufactured or installed into the Store.
  assert.equal(await h.store.ensurePrivateContent(stored.contentId,{force:true}),bytes);await f.settle();
  assert.equal(h.store.content.get()[stored.contentId],bytes);
  const {DocumentArtifacts}=await ports.loadActual("src/components/document-artifacts.ts");
  const original=DocumentArtifacts.prototype.openArtifactById,calls=[];
  t.mock.method(DocumentArtifacts.prototype,"openArtifactById",function(artifactId,options){
    const pending=original.call(this,artifactId,options);
    if(artifactId===id){
      const call={owner:this,artifactId,options,pending,settled:false,result:undefined,error:null};calls.push(call);
      pending.then(result=>{call.settled=true;call.result=result;},error=>{call.settled=true;call.error=error;});
    }
    return pending; // The exact original Promise, no substituted result/current predicate.
  });
  return{f,h,id,kind,title,marker,bytes,contentRef:stored.contentId,artifact,calls};
}
async function fObjectArtifactArrived(q,t){
  const {f,h,id,kind,title,calls}=q,history=await h.history(),authority=h.store.captureAuthorizationScope();
  const opening=await c19NamingOpen(f,title,"artifact",1);c19NamingCurrent(f,opening.rows[0]);
  const trace=f.trace.length;
  await finishCommandPreparation(f,f.act(opening.rows[0], "click", {button:0}));
  assert.deepEqual(libraryFocusFromRoute(h.store.route.get()),{kind:"artifact",id});
  assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()),h.ad);
  assert.deepEqual(artifactFocusOptionsFromRoute(h.store.route.get()),{expectedRevision:0,intent:"inspect"});
  const libraries=f.components().filter(owner=>owner.tag==="forma-library"&&owner.store===h.store);
  assert.equal(libraries.length,1);assert.ok(libraries[0].isConnected);h.exact();
  assert.equal(calls.length,1,"the actual Library invokes its existing exact viewer once");
  const call=calls[0];
  assert.equal(call.owner.store,h.store);assert.equal(call.owner.source,"library");assert.equal(call.owner.documentId,h.ad);
  assert.equal(call.options.expectedRevision,0);assert.equal(call.options.intent,"inspect");
  const result=await finishCommandPreparation(f,call.pending);await f.settle();
  await fObjectNoEffects(f,history,authority);
  const tree=f.tree(),dialogs=tree.visible("dialog").filter(node=>node.owner===call.owner
    &&node.port?.open&&fObjectClassed(node,"document-artifact-view"));
  assert.equal(h.store.content.get()[q.contentRef],q.bytes);
  t.diagnostic("F_EXACT_ARTIFACT_COMMAND "+JSON.stringify({locale:f.locale,kind,id,route:h.store.route.get(),
    currentDocument:h.store.projection.get().documentId,currentLibrary:libraries[0].isConnected,
    calls:calls.length,settled:call.settled,returned:result,error:call.error?String(call.error.name):null,
    dialogs:dialogs.length,promoted:f.trace.slice(trace).filter(value=>value==="open:document-artifact-view"),
    exactPrivateBytes:true,sourceAndFiscal:"unchanged"}));
  assert.equal(result,true,"a command route is not success until the original exact viewer opens");
  assert.equal(dialogs.length,1);assert.equal(dialogs[0].attributes["data-artifact-kind"],kind);
  assert.ok(dialogs[0].text.includes(title),"the connected viewer identifies this exact artifact");
  // Close the actual viewer, then use the existing visible Work return. No
  // setter or direct openArtifactById call substitutes for either gesture.
  const closes=tree.visible("button").filter(node=>node.owner===call.owner&&c19NamingWithin(node,dialogs[0])
    &&node.attributes["aria-label"]===f.i18n.t("action.close","Close"));
  assert.equal(closes.length,1);assert.ok(closes[0].port?.isConnected&&f.renderer.nodes.includes(closes[0].port));
  await f.act(closes[0]);await f.settle();
  assert.equal(f.tree().visible("dialog").filter(node=>fObjectClassed(node,"document-artifact-view")&&node.port?.open).length,0);
  const work=f.task("/document/"+h.ad+"/one-current-authored-direction");
  assert.equal(documentIdFromRoute(work.attributes.href),h.ad);
  await f.act(work,"click",{button:0});h.exact();
  assert.equal(documentIdFromRoute(h.store.route.get()),h.ad);
  assert.ok(f.components().some(owner=>owner.tag==="forma-workspace"&&owner.store===h.store));
  await fObjectNoEffects(f,history,authority);
}
for(const[kind,locale]of [["short_story","en"],["scene","ja"],["slides","en"],["storyboard","ja"],["video","en"],["audio","ja"]])
test("F exact object command / "+locale+" / saved "+kind+" reaches its actual viewer and returns",
  {concurrency:false,timeout:30_000},async t=>{await fObjectArtifactArrived(await fObjectArtifact(t,kind,locale),t);});


// Conditional arrival boundaries for the ordinary artifact-command lease.
// These require its original public viewer to reach a real native await; a
// pre-fix refusal before that barrier is a prerequisite, not a new incident.
for(const[locale,boundary]of [["en","healthy"],["en","pointerdown"],["ja","focus"],["en","authority"],["ja","other-route"],["ja","stale-revision"]])
test("C exact artifact command delayed arrival / "+locale+" / "+boundary,
  {concurrency:false,timeout:30_000},async t=>{
    const release=sceneDeferred(),entered=sceneDeferred();let restore=()=>{};
    t.after(()=>{release.resolve();restore();});
    const q=await fObjectArtifact(t,"short_story",locale),{f,h,calls,id}=q;
    let history=await h.history();
    const originalAuthority=h.store.captureAuthorizationScope(),originalSource=h.store.captureSourceOwnership();
    assert.ok(h.store.authorizationScopeActive(originalAuthority)&&h.store.sourceOwnershipActive(originalSource));
    const opening=await c19NamingOpen(f,q.title,"artifact",1),tick=f.tick;
    let held=false;
    f.tick=async owner=>{
      const result=await tick(owner),call=calls.find(value=>value.owner===owner&&!value.settled);
      if(!held&&call&&owner.isConnected&&owner.store===h.store&&owner.source==="library"
        &&owner===f.host.querySelector("forma-library")?.querySelector("forma-document-artifacts")){
        held=true;entered.resolve();await release.promise;
      }
      return result;
    };
    restore=()=>{f.tick=tick;};
    const traceStart=f.trace.length,activation=f.act(opening.rows[0],"click",{button:0});
    await finishCommandPreparation(f,Promise.race([entered.promise,activation]));
    t.diagnostic("C_ARTIFACT_ARRIVAL_BOUNDARY "+JSON.stringify({locale,boundary,held,
      calls:calls.length,settled:calls[0]?.settled??false,returned:calls[0]?.result??null}));
    assert.equal(held,true,"the original exact viewer reaches its genuine pre-promotion updateComplete");
    assert.equal(calls.length,1);
    const call=calls[0],initialRoute=h.store.route.get();
    assert.deepEqual(libraryFocusFromRoute(initialRoute),{kind:"artifact",id});
    assert.deepEqual(artifactFocusOptionsFromRoute(initialRoute),{expectedRevision:0,intent:"inspect"});
    assert.equal(call.artifactId,id);assert.equal(call.owner.documentId,h.ad);assert.equal(call.options.expectedRevision,0);
    assert.equal(f.tree().visible("dialog").filter(node=>fObjectClassed(node,"document-artifact-view")).length,0);
    assert.equal(f.trace.slice(traceStart).includes("open:document-artifact-view"),false,
      "the finite barrier precedes even transient native viewer promotion");
    let moved=null;
    if(boundary==="pointerdown"||boundary==="focus"){
      const trigger=f.find("button",node=>node.owner===f.host&&fObjectClassed(node,"command-trigger"));
      assert.ok(trigger.port.isConnected&&f.renderer.nodes.includes(trigger.port));moved=trigger.port;
      if(boundary==="focus")f.native.focus(moved);else f.native.emit("pointerdown",moved);
    }else if(boundary==="authority"){
      h.store.session.set({...h.store.session.get(),permissionEpoch:"newer-artifact-command-owner"});
      assert.equal(h.store.authorizationScopeActive(originalAuthority),false);
    }else if(boundary==="other-route"){
      h.store.setRoute("/activity?document="+h.otherA);await h.store.syncDocumentFromRoute();await f.settle();
      h.exact(h.a,h.otherA);assert.equal(new URL(h.store.route.get(),"https://fixture.invalid").pathname,"/activity");
    }else if(boundary==="stale-revision"){
      await h.navigationResumeReads.settleOriginalRequests();
      // Declared concurrent RAM revision metadata through the existing audit
      // producer/read path. This is not an artifact-edit acceptance certificate.
      await h.external("DocumentArtifactEdited",{project_id:h.a,document_id:h.ad,artifact_id:id,
        content_ref:q.contentRef,revision:1,changed_fields:["notes"],source_surface:"finite-concurrent-revision"});
      await h.store.refreshEvents();await f.settle();
      assert.equal(fObjectArtifactRevision(h.store.events.get(),id),1);
      assert.equal(h.store.projection.get().libraryArtifacts.find(value=>value.id===id)?.contentRef,q.contentRef);
      history=await h.history();
    }
    const route=h.store.route.get(),session=h.store.session.get(),documentId=h.store.projection.get().documentId;
    const authority=h.store.captureAuthorizationScope(),focusCount=f.native.nativeFocus.length;
    release.resolve();await finishCommandPreparation(f,activation);
    let result,error=null;
    try{result=await finishCommandPreparation(f,call.pending);}catch(caught){error=caught;}
    await fObjectNoEffects(f,history,authority);
    const dialogs=f.tree().visible("dialog").filter(node=>fObjectClassed(node,"document-artifact-view")&&node.port?.open);
    const promotions=f.trace.slice(traceStart).filter(value=>value==="open:document-artifact-view");
    assert.equal(calls.length,1,"interruption does not launch a replacement viewer or repeat the original");
    assert.equal(h.store.route.get(),route);assert.equal(h.store.session.get(),session);
    assert.equal(h.store.projection.get().documentId,documentId);
    t.diagnostic("C_ARTIFACT_ARRIVAL_RESULT "+JSON.stringify({locale,boundary,id,held,result:result??null,
      error:error?String(error.message):null,dialogs:dialogs.length,promotions,route,documentId}));
    if(boundary!=="healthy"){
      if(boundary==="stale-revision")assert.ok(result===false&&!error
        ||error?.message==="The requested output changed before it opened.","only the existing exact revision refusal is accepted");
      else{assert.equal(error,null);assert.equal(result,false);}
      assert.deepEqual(promotions,[],"a later final refusal cannot excuse transient stale publication");
      assert.equal(dialogs.length,0);assert.equal(f.native.nativeFocus.length,focusCount);
      if(boundary==="focus")assert.equal(f.native.document.activeElement,moved);
      return;
    }
    assert.equal(error,null);assert.equal(result,true);assert.equal(dialogs.length,1);
    assert.equal(dialogs[0].owner,call.owner);assert.equal(dialogs[0].attributes["data-artifact-kind"],"short_story");
    assert.equal(h.store.content.get()[q.contentRef],q.bytes);
    const button=f.tree().visible("button").find(node=>node.owner===call.owner&&fObjectClassed(node,"artifact-viewer-focus-toggle"));
    assert.ok(button?.port.isConnected);f.native.emit("keydown",button.port);await f.settle();
    assert.equal(f.tree().visible("dialog").filter(node=>node.owner===call.owner
      &&fObjectClassed(node,"document-artifact-view")&&node.port?.open).length,1,
      "disposing an admitted opening's focus lease does not close current authorized inspection");
    await fObjectNoEffects(f,history,authority);
  });


// Opt-in receipt accounting, not permission to ignore arbitrary POSTs. Like
// c19ObserveNavigationReceipts, this observes a clone, awaits it, and returns
// the SAME Worker response; the observation intentionally adds finite latency.
// The original cleanup still compares the complete non-navigation history.
function fSessionReceiptAccounting(t, h, admit) {
  const prior = h.transport, proofs = new WeakMap(), records = [];
  let armed = null;
  const original = request => prior ? prior(request) : h.worker.request(request.url, request.init);
  const exact = request => {
    const proof = proofs.get(request);
    return Boolean(proof && request.init === proof.init && request.url === "/api/events"
      && request.init.method === "POST" && request.init.body === proof.bytes
      && JSON.stringify(request.body) === proof.bytes);
  };
  const execute = async (request, record) => {
    record.request = request;
    const init = request.init, bytes = init.body, input = JSON.parse(bytes);
    assert.ok(h.requests.includes(request), "The actual Store transport dispatched this exact request object");
    assert.equal(h.store.route.get(), record.route);
    assert.equal(h.store.session.get().user.userId, record.actor);
    assert.equal(h.store.session.get().projectContext == null, true);
    assert.ok(h.store.authorizationScopeActive(record.authorization) && h.store.sourceOwnershipActive(record.source));
    assert.deepEqual({ projectId: h.store.projection.get().projectId, documentId: h.store.projection.get().documentId }, record.scope);
    const history = await h.history(), financial = h.counts();
    // compose_brief reads the actual sessions profile, which includes canonical
    // ComparisonOpened witnesses excluded from the workspace cleanup profile.
    // Read that same original corpus; never rewrite IDs or accept absent refs.
    const referenceHistory = record.kind === "compose"
      ? await readIntelligenceEvents(h.worker.env, h.worker.streamId) : history;
    if (record.kind === "compose") {
      const workspaceIds = new Set(history.map(event => event.eventId));
      assert.deepEqual(referenceHistory.filter(event => workspaceIds.has(event.eventId)), history,
        "The intelligence witness corpus contains the exact unchanged workspace history");
    }
    assert.equal(input.expectedSequence, history.at(-1).sequence);
    if (record.kind === "compose") {
      assert.deepEqual(Object.keys(input).sort(), ["action", "clientId", "expectedSequence"]);
      assert.equal(input.action, "compose_brief"); assert.equal(input.clientId, "web:sessions");
    } else {
      assert.deepEqual(Object.keys(input).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(input.action, "append"); assert.equal(input.clientId, "web:lit");
      assert.deepEqual(input.event, record.event); assert.deepEqual(input.events, [record.event]);
    }
    const response = await original(request), returned = await response.clone().json();
    assert.equal(response.status, 200, "Only the actual successful original response can be accounted");
    assert.equal(response.bodyUsed, false);
    assert.deepEqual(returned.rejected, []); assert.ok(Array.isArray(returned.appended));
    const appended = returned.appended;
    if (record.kind === "compose") {
      assert.deepEqual(Object.keys(returned).sort(), ["appended", "briefComposed", "eligibility", "head", "rejected"]);
      assert.equal(returned.briefComposed, true); assert.equal(returned.eligibility.eligible, true);
      const composed = appended[0]; assert.equal(composed.type, "BriefComposed");
      assert.equal(composed.actor, "worker:brief"); assert.equal(composed.payload.as_of.sequence, input.expectedSequence);
      assert.equal(composed.payload.composition.mode, "deterministic");
      assert.equal(composed.payload.composition.cost_usd, 0);
      assert.equal(composed.payload.composition.input_tokens, 0); assert.equal(composed.payload.composition.output_tokens, 0);
      const items = composed.payload.items; assert.ok(items.length >= 1 && items.length <= 3);
      assert.equal(appended.length, items.length + 1);
      for (const [index, item] of items.entries()) {
        const presented = appended[index + 1]; assert.equal(presented.type, "BriefItemPresented");
        assert.equal(presented.actor, "user"); assert.equal(presented.causationId, composed.eventId);
        assert.deepEqual(presented.payload, { brief_id: composed.payload.brief_id, item_id: item.item_id,
          rank: item.rank, brief_size: items.length, presentation_mode: "rendered-or-reading-order",
          destination: item.destination, document_view: item.destination.document_view ?? null });
        assert.ok(item.source_event_refs.length > 0);
        for (const id of item.source_event_refs) {
          assert.equal(typeof id, "string"); assert.ok(id && !id.startsWith("event:"));
          const witnesses = referenceHistory.filter(event => event.eventId === id);
          assert.equal(witnesses.length, 1, "Every plain source ID resolves to one actual canonical intelligence event");
          assert.equal(witnesses[0].streamId, h.worker.streamId);
          assert.ok(witnesses[0].sequence <= input.expectedSequence);
        }
      }
    } else {
      assert.deepEqual(Object.keys(returned).sort(), ["appended", "head", "rejected"]);
      assert.equal(appended.length, 1); assert.equal(appended[0].type, "BriefItemAccepted");
      assert.equal(appended[0].actor, "user"); assert.deepEqual(appended[0].payload, record.event.payload);
    }
    for (const [index, event] of appended.entries()) {
      assert.equal(event.streamId, h.worker.streamId); assert.equal(event.clientId, input.clientId);
      assert.ok(event.eventId && event.correlationId); assert.equal(event.sequence, input.expectedSequence + index + 1);
    }
    assert.equal(returned.head, appended.at(-1).sequence);
    await h.worker.drainBackground();
    assert.deepEqual(await h.history(), [...history, ...appended], "Canonical sequence/content equals exactly this original Worker receipt");
    assert.deepEqual(h.counts(), financial);
    assert.equal(request.init, init); assert.equal(request.init.body, bytes); assert.equal(JSON.stringify(request.body), bytes);
    assert.equal(h.store.session.get().user.userId, record.actor);
    assert.ok(h.store.authorizationScopeActive(record.authorization) && h.store.sourceOwnershipActive(record.source));
    await admit(appended);
    proofs.set(request, { init, bytes });
    assert.equal(exact({ ...request }), false, "Another request row cannot inherit an original receipt");
    record.receipt = { status: response.status, appended, head: returned.head };
    record.originalResponse = response;
    if (record.gate) await record.gate.promise;
    record.delivered = true;
    return response;
  };
  const transport = request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") return original(request);
    assert.ok(armed && !armed.request, "Only an explicitly armed compose/accept gesture can dispatch a brief command");
    const record = armed; armed = null;
    const pending = execute(request, record);
    record.pending = pending;
    pending.catch(error => { record.error = error; });
    return pending;
  };
  h.transport = transport;
  t.after(() => { for (const record of records) record.gate?.resolve(); if (h.transport === transport) h.transport = prior; });
  return {
    arm(kind, event = null, hold = false) {
      assert.equal(armed, null); assert.ok(records.every(record => record.delivered));
      assert.ok(kind === "compose" || kind === "accept");
      const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
      assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      assert.equal(h.store.route.get(), "/sessions");
      armed = { kind, event, source, authorization, route: h.store.route.get(), actor: h.store.session.get().user.userId,
        scope: { projectId: h.store.projection.get().projectId, documentId: h.store.projection.get().documentId },
        gate: hold ? sceneDeferred() : null, request: null, receipt: null, delivered: false, error: null };
      records.push(armed); return armed;
    },
    async reached(record) {
      await untilScene(() => Boolean(record.receipt || record.error), "The actual brief command must reach its original Worker receipt");
      if (record.error) throw record.error;
      assert.ok(record.receipt && exact(record.request)); return record.receipt;
    },
    isOriginal: exact,
    appended: () => records.flatMap(record => record.receipt?.appended ?? []),
    records: () => [...records],
  };
}



// F Sessions reach: actual Shell/Sessions/Store plus the existing RAM Worker.
// This family follows the immutable F intelligence-command arrivals append.
// No provider execution, output pixels, browser focus or adoption is certified.
const F_SESSION_CASES = [
  { locale: "en", kind: "thread", view: "context-block", label: "Open thread" },
  { locale: "ja", kind: "collection", view: "collection", label: "Open collection" },
  { locale: "en", kind: "comparison", view: "comparison", label: "Open comparison" },
  { locale: "ja", kind: "document", view: "document", label: "Continue work" },
];

async function fSessionPage(t, locale, kind = "thread", { eligible = true, ...fixtureOptions } = {}) {
  const f = await navigationPage(t, locale, { nativePreparation: true, briefReceiptAccounting: true, ...fixtureOptions }), h = f.navigationHost;
  await registerCalmFullPageComponents(f, ["forma-sessions", "forma-library", "forma-workspace"]);
  // Real RAM history setup, never a fabricated BriefComposed response. Saved
  // image metadata reuses the C19 original navigation fixture convention;
  // no image generation/pixels or provider receipt is implied.
  if (kind === "comparison") {
    for (const [index, id] of ["f-session-image-a", "f-session-image-b"].entries())
      await h.external("GenerationCompleted", { project_id: h.a, document_id: h.otherA,
        generation_id: "f-session-existing-" + index, object_ids: [id], title: "F existing comparison " + index,
        provider: "in-memory-saved-metadata", model_id: "fixture-saved-image", media_url: "/api/media/" + id,
        media_type: "image/png", image_width: 640, image_height: 480 });
    await h.external("ComparisonOpened", { document_id: h.otherA, object_ids: ["f-session-image-a", "f-session-image-b"], source_surface: "studio" });
  }
  if (kind === "document") {
    await h.external("IntentDeclared", { project_id: h.a, document_id: h.otherA, scope_ref: h.otherA,
      intent_id: "f-session-existing-intent", statement_ref: "f-session-opaque-existing-statement", expected_output_kind: "context" });
    await h.external("SessionClosed", { session_id: "f-session-intent-before", snapshot_ref: { document_id: h.otherA, project_id: h.a, head: (await h.history()).at(-1).sequence } });
  }
  await h.external("ProjectOpened", { project_id: h.a });
  await h.external("DocumentOpened", { document_id: h.ad, source_surface: "f-session-history-setup" });
  if (eligible) {
    for (let index = 0; index < 3; index++) {
      await h.external("SessionOpened", { session_id: "f-session-closed-" + index });
      await h.external("SessionClosed", { session_id: "f-session-closed-" + index,
        snapshot_ref: { project_id: h.a, document_id: h.ad, head: (await h.history()).at(-1).sequence } });
    }
    await h.external("SessionOpened", { session_id: "f-session-current" });
  }
  await h.store.refreshEvents({ fromStart: true }); await f.settle(); h.exact();
  assert.equal(h.store.events.get().some(event => event.type === "BriefComposed"), false);
  const before = await fIntelligenceBaseline(f);
  await fIntelligenceChoose(f, F_INTELLIGENCE_ENTRIES[0]);
  const owner = f.components().find(component => component.tag === "forma-sessions");
  assert.ok(owner && owner instanceof f.modules.get("src/components/forma-sessions.ts").FormaSessions && owner.isConnected);
  assert.equal(owner.store, h.store); assert.equal(h.store.projection.get().documentId, h.ad);
  assert.equal(f.tree().visible("button").some(node => node.owner === owner && node.attributes["data-target-ref"]), false);
  return { f, h, owner, before };
}

async function fSessionPrepare(x, kind) {
  const { f, h, owner } = x;
  const compose = h.briefReceipts.arm("compose");
  await f.act(f.find("button", node => node.owner === owner && node.text === f.i18n.system("Find where to continue")));
  const receipt = await h.briefReceipts.reached(compose), brief = receipt.appended[0].payload;
  assert.equal(h.store.projection.get().brief.brief_id, brief.brief_id);
  const item = brief.items.find(value => value.item_type === (kind === "document" ? "intent" : kind));
  assert.ok(item, "Actual deterministic composition includes the intended eligible candidate");
  const button = f.find("button", node => node.owner === owner
    && node.attributes["data-target-ref"] === item.destination.ref_id
    && node.attributes["data-destination-view"] === item.destination.view);
  assert.ok(button.port.isConnected && f.renderer.nodes.includes(button.port));
  assert.equal(button.attributes.title, f.i18n.system("Resume {title}", { title: item.title }));
  const event = { type: "BriefItemAccepted", payload: { brief_id: brief.brief_id, item_id: item.item_id,
    rank: item.rank, brief_size: brief.items.length, destination: item.destination } };
  return { item, button, event };
}

async function fSessionFinishOriginalTimers(f) {
  await f.settle();
  // Deliver only already-scheduled ordinary zero-delay native tasks once;
  // never call a private handler, create a destination or rerun an old task.
  for (const [id, timer] of [...f.timers]) if (timer.delay === 0) {
    f.timers.delete(id); timer.callback();
  }
  await f.settle();
}

async function fSessionNoExtraEffects(x) {
  const { f, h, before } = x;
  await h.navigationResumeReads.settleOriginalRequests(); await f.settle(); await h.worker.drainBackground();
  assert.deepEqual(await h.history(), [...before.history, ...h.briefReceipts.appended()], "Only exact original composition/presentation/acceptance receipts were appended");
  assert.deepEqual(h.counts(), before.counts, "The actual job/reservation/counter rows are unchanged");
  assert.deepEqual(h.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET"
    && !h.navigationResumeReads.isReadOnlyResume(row) && !h.briefReceipts.isOriginal(row)), [],
  "No hidden new draft, execution, approval, save, export or provider operation accompanies acceptance");
  assert.equal(h.store.session.get().user.userId, before.actor); assert.ok(h.store.authorizationScopeActive(before.authorization));
}

for (const entry of F_SESSION_CASES)
test("F Sessions exact accepted destination / " + entry.locale + " / " + entry.kind, fIntelligenceOptions, async t => {
  const x = await fSessionPage(t, entry.locale, entry.kind), { f, h } = x;
  const choice = await fSessionPrepare(x, entry.kind), destination = choice.item.destination;
  assert.equal(destination.view, entry.view); assert.equal(choice.button.text, f.i18n.system(entry.label));
  if (entry.kind === "document" || entry.kind === "comparison") {
    assert.equal(destination.document_id, h.otherA); assert.notEqual(destination.document_id, h.store.projection.get().documentId);
  } else if (entry.kind === "thread") assert.equal(destination.ref_id, "scene-reuse-direction");
  else assert.equal(destination.ref_id, "collection-studio", "Reuse the existing Worker-seeded populated collection");
  const accepted = h.briefReceipts.arm("accept", choice.event, true);
  const pending = f.act(choice.button);
  try {
    const receipt = await h.briefReceipts.reached(accepted);
    assert.equal(receipt.appended[0].payload.item_id, choice.item.item_id);
    assert.equal(accepted.delivered, false); assert.equal(h.store.route.get(), "/sessions", "Committed receipt alone cannot navigate before the original response arrives");
    accepted.gate.resolve(); await pending; await fSessionFinishOriginalTimers(f);
  } finally { accepted.gate.resolve(); await pending; }
  await fSessionNoExtraEffects(x);
  assert.equal(new URL(h.store.route.get(), "https://fixture.invalid").pathname,
    new URL(destination.route, "https://fixture.invalid").pathname);
  if (destination.document_id) {
    assert.equal(documentIdFromRoute(h.store.route.get()), destination.document_id);
    assert.equal(h.store.projection.get().documentId, destination.document_id);
    assert.equal(f.components().filter(component => component.tag === "forma-workspace").length, 1);
  }
  if (entry.kind === "thread") {
    assert.equal(h.store.ui.focusBlockId, destination.ref_id);
    assert.ok(f.find("article", node => node.attributes["data-block-id"] === destination.ref_id).port.isConnected);
  } else if (entry.kind === "collection") {
    assert.equal(h.store.ui.focusCollectionId, destination.ref_id);
    const filter = f.find("div", node => node.owner.tag === "forma-library" && node.attributes.class === "collection-filter");
    assert.ok(filter.text.includes("studio-launch"));
    // The actual collection LI lacks tabindex and the rail may be collapsed.
    // Visible exact filtering, not the fixture's permissive focus(), is proof.
  } else if (entry.kind === "comparison") {
    assert.deepEqual(h.store.ui.comparisonOutputIds.split("|"), destination.object_ids);
    const modal = f.find("dialog", node => String(node.attributes.class).split(/\s+/u).includes("comparison-modal"));
    assert.equal(modal.port.open, true);
    const outputs = f.components().filter(component => component.tag === "forma-output-visual"
      && component.closest(".comparison-modal") === modal.port).map(component => component.output.id);
    assert.deepEqual(outputs, destination.object_ids, "The actual native comparison contains exactly the two original sides");
  } else assert.equal(h.store.ui.compareOpen, false);
  t.diagnostic("F_SESSIONS_DESTINATION " + JSON.stringify({ locale: entry.locale, kind: entry.kind,
    originalDocument: h.ad, destination, accepted: accepted.receipt.appended.map(event => ({ eventId: event.eventId, sequence: event.sequence })),
    route: h.store.route.get(), sourceCurrent: h.store.sourceOwnershipActive(x.before.source), executionSubmitted: false }));
});

for (const interruption of [{ locale: "en", kind: "route" }, { locale: "ja", kind: "source" }])
test("F Sessions original accepted reply respects current " + interruption.kind + " / " + interruption.locale, fIntelligenceOptions, async t => {
  const x = await fSessionPage(t, interruption.locale), { f, h, owner } = x;
  const choice = await fSessionPrepare(x, "thread"), accepted = h.briefReceipts.arm("accept", choice.event, true);
  const pending = f.act(choice.button);
  let expectedRoute, restorePolicy = () => {};
  try {
    await h.briefReceipts.reached(accepted); assert.equal(accepted.delivered, false);
    if (interruption.kind === "route") {
      await f.act(f.task("/activity"), "click", { button: 0 }); expectedRoute = h.store.route.get();
      assert.equal(new URL(expectedRoute, "https://fixture.invalid").pathname, "/activity");
      assert.ok(h.store.sourceOwnershipActive(x.before.source));
    } else {
      const env = h.worker.env, key = "FORMA_PILOT_COHORT_ID", had = Object.hasOwn(env, key), previous = env[key];
      const prior = h.intercept; let denied = 0;
      env[key] = "synthetic-missing-f-session-cohort";
      restorePolicy = () => { h.intercept = prior; if (had) env[key] = previous; else delete env[key]; };
      h.intercept = async request => {
        if (!request.url.startsWith("/api/events?") || (request.init.method ?? "GET") !== "GET") return prior?.(request);
        const response = await h.worker.request(request.url, request.init);
        assert.equal(response.status, 403); assert.equal((await response.clone().json()).error, "pilot_participant_required");
        denied++; return response;
      };
      await assert.rejects(h.store.refreshEvents({ fromStart: true }), /Event stream returned 403/u); await f.settle();
      assert.ok(denied > 0); assert.equal(h.store.sourceOwnershipActive(x.before.source), false);
      expectedRoute = h.store.route.get(); assert.equal(expectedRoute, "/sessions");
    }
    assert.equal(owner.isConnected, false, "The actual previous Sessions owner is no longer mounted");
    accepted.gate.resolve(); await pending; await f.settle();
    const afterAckRoute = h.store.route.get(), afterAckBlock = h.store.ui.focusBlockId;
    const originalTimers = [...f.timers].filter(([, timer]) => timer.delay === 0).map(([id]) => id);
    let newerFocus = null;
    if (interruption.kind === "route") {
      // A second ordinary navigation deliberately returns to the same visible
      // Document. This must not revive the previous Sessions opening's queued
      // global-selector task. Use actual navigation anchors, not route setters.
      await f.act(f.task("/library"), "click", { button: 0 });
      const work = f.tree().visible("a").filter(node => node.owner.tag === "forma-ui-audience-navigation"
        && documentIdFromRoute(node.attributes.href) === h.ad);
      assert.equal(work.length, 1); await f.act(work[0], "click", { button: 0 }); await f.settle();
      assert.equal(h.store.projection.get().documentId, h.ad);
      assert.ok(f.find("article", node => node.attributes["data-block-id"] === choice.item.destination.ref_id).port.isConnected);
      newerFocus = f.find("button", node => node.owner.tag === "forma-workspace" && node.attributes["data-workbench-pane"] === "write").port;
      f.native.focus(newerFocus);
    }
    const focusBefore = f.native.nativeFocus.length, scrollBefore = f.native.nativeScroll.length;
    for (const id of originalTimers) {
      const timer = f.timers.get(id); if (!timer) continue;
      f.timers.delete(id); timer.callback();
    }
    const lateFocus = f.native.nativeFocus.slice(focusBefore), lateScroll = f.native.nativeScroll.slice(scrollBefore);
    const newerFocusKept = !newerFocus || f.native.document.activeElement === newerFocus;
    await fSessionNoExtraEffects(x);
    t.diagnostic("F_SESSIONS_INTERRUPTION " + JSON.stringify({ ...interruption, expectedRoute, afterAckRoute, afterAckBlock, route: h.store.route.get(),
      originalAcceptance: accepted.receipt.appended[0].eventId, acceptanceDelivered: accepted.delivered,
      sourceCurrent: h.store.sourceOwnershipActive(x.before.source), originalAuthorityCurrent: h.store.authorizationScopeActive(x.before.authorization),
      originalQueuedTasks: originalTimers.length, newerFocusKept,
      lateFocusEffects: lateFocus.map(row => row.node.attributes["data-block-id"] ?? row.node.attributes.class ?? row.node.tag),
      lateScrollEffects: lateScroll.map(row => row.node.attributes["data-block-id"] ?? row.node.attributes.class ?? row.node.tag) }));
    assert.equal(afterAckRoute, expectedRoute, "An original acceptance receipt cannot overrule a newer route or retired Source");
    assert.equal(afterAckBlock, "", "The retired original host cannot publish its old focus target");
    assert.equal(lateFocus.some(row => row.node.attributes["data-block-id"] === choice.item.destination.ref_id), false);
    assert.equal(lateScroll.some(row => row.node.attributes["data-block-id"] === choice.item.destination.ref_id), false);
    assert.equal(newerFocusKept, true, "A queued native task cannot refocus a later exact-Document visit");
    if (interruption.kind === "source") {
      assert.equal(h.store.eventView.get().length, 0); assert.deepEqual(h.store.content.get(), {});
      assert.equal(f.components().some(component => component.tag === "forma-sessions" || component.tag === "forma-workspace"), false);
    }
  } finally { accepted.gate.resolve(); await pending; restorePolicy(); }
});

for (const empty of [{ locale: "en", eligible: true }, { locale: "ja", eligible: false }])
test("F Sessions empty unprepared history / " + empty.locale + " / " + (empty.eligible ? "eligible deliberate preparation" : "ineligible control"), fIntelligenceOptions, async t => {
  const x = await fSessionPage(t, empty.locale, "thread", empty), { f, h, owner } = x;
  const compose = f.find("button", node => node.owner === owner && node.text === f.i18n.system("Find where to continue"));
  assert.equal(Object.hasOwn(compose.attributes, "disabled"), !empty.eligible);
  assert.equal(h.store.projection.get().brief, null);
  assert.equal(h.briefReceipts.records().length, 0);
  assert.equal(f.tree().visible("button").some(node => node.owner === owner && node.attributes["data-target-ref"]), false);
  assert.equal(f.tree().visible("h3").some(node => node.owner === owner && node.text === f.i18n.system(empty.eligible
    ? "Your recent work is ready to revisit" : "A little more history will help")), true);
  assert.ok(f.find("textarea", node => node.owner === owner && node.attributes.id === "session-intent-statement").port.isConnected);
  await fSessionNoExtraEffects(x);
  assert.ok(h.store.sourceOwnershipActive(x.before.source)); assert.equal(h.store.route.get(), "/sessions");
});


// Six additive current-control cases. Actual Shell/Sessions/Store and RAM
// Worker; finite native/HTTP ports, not browser or provider evidence.
// This observer is separate from the unchanged compose/accept receipt port.
function fSessionDraftReceiptAccounting(t, h, admit) {
  const prior = h.transport, proofs = new WeakMap(), records = [];
  let armed = null;
  const original = request => prior ? prior(request) : h.worker.request(request.url, request.init);
  const exact = request => {
    const proof = proofs.get(request);
    return Boolean(proof && request.init === proof.init && request.url === "/api/events"
      && request.init.method === "POST" && request.init.body === proof.bytes
      && JSON.stringify(request.body) === proof.bytes);
  };
  const privateRows = () => h.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all();
  const execute = async (request, record) => {
    record.request = request;
    const init = request.init, bytes = init.body, input = JSON.parse(bytes);
    assert.ok(h.requests.includes(request));
    assert.equal(h.store.route.get(), "/sessions");
    assert.equal(h.store.session.get().user.userId, record.actor);
    assert.equal(h.store.session.get().projectContext == null, true);
    assert.ok(h.store.authorizationScopeActive(record.authorization) && h.store.sourceOwnershipActive(record.source));
    assert.deepEqual({ projectId: h.store.projection.get().projectId, documentId: h.store.projection.get().documentId }, record.scope);
    const history = await h.history(), financial = h.counts(), privateBefore = privateRows();
    assert.equal(input.expectedSequence, history.at(-1).sequence);
    if (record.kind === "blank") {
      assert.deepEqual(Object.keys(input).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(input.action, "batch"); assert.equal(input.clientId, "web:lit");
      assert.equal(input.events.length, 2); assert.deepEqual(input.event, input.events[0]);
      const id = input.events[1].payload.document_id;
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
      assert.equal(history.some(event => event.type === "DocumentCreated" && event.payload.document_id === id), false);
      assert.deepEqual(input.events, [
        { type: "EmptyCanvasChosen", payload: { session_id: record.sessionId, brief_id: record.briefId, new_document_id: id } },
        { type: "DocumentCreated", payload: { document_id: id, handle: "document-" + id.slice(0, 8), title: record.text, entry_surface: "blank-canvas" } },
      ]);
      record.documentId = id;
    } else {
      assert.deepEqual(input, { action: "declare_intent", expectedSequence: history.at(-1).sequence,
        clientId: "web:sessions", statement: record.text, deadline: null });
    }
    // Dispatch only this exact armed batch/intent to the same real Worker.
    // Sending it through the separate brief observer would incorrectly widen
    // that observer's compose/accept contract. All other traffic uses prior.
    const response = await h.worker.request(request.url, request.init), returned = await response.clone().json();
    assert.equal(response.status, 200, "Observe a genuine original positive Worker response before holding or losing its delivery");
    assert.equal(response.bodyUsed, false);
    assert.deepEqual(Object.keys(returned).sort(), ["appended", "head", "rejected"]);
    assert.deepEqual(returned.rejected, []);
    const appended = returned.appended; assert.ok(Array.isArray(appended));
    assert.equal(appended.length, record.kind === "blank" ? 2 : 1);
    for (const [index, event] of appended.entries()) {
      assert.equal(event.streamId, h.worker.streamId); assert.equal(event.actor, "user");
      assert.equal(event.clientId, input.clientId); assert.ok(event.eventId && event.correlationId);
      assert.equal(event.sequence, input.expectedSequence + index + 1);
      if (record.kind === "blank") {
        assert.equal(event.type, input.events[index].type); assert.deepEqual(event.payload, input.events[index].payload);
      }
    }
    assert.equal(returned.head, appended.at(-1).sequence);
    await h.worker.drainBackground();
    assert.deepEqual(await h.history(), [...history, ...appended], "Full canonical history equals this exact original receipt");
    assert.deepEqual(h.counts(), financial);
    if (record.kind === "blank") assert.deepEqual(privateRows(), privateBefore);
    else {
      const event = appended[0]; assert.equal(event.type, "IntentDeclared");
      assert.deepEqual(Object.keys(event.payload).sort(), ["content_expires_at", "deadline", "scope_ref", "statement_ref"]);
      assert.equal(event.payload.scope_ref, record.scope.documentId); assert.equal(event.payload.deadline, null);
      const rows = privateRows(), retained = rows.find(row => row.content_id === event.payload.statement_ref);
      assert.ok(retained); assert.equal(retained.owner_id, record.actor); assert.equal(retained.kind, "intent");
      assert.equal(retained.content, record.text); assert.equal(retained.redacted_at, null);
      assert.equal(retained.expires_at, event.payload.content_expires_at);
      assert.deepEqual(rows.filter(row => row.content_id !== retained.content_id), privateBefore);
      assert.equal(rows.length, privateBefore.length + 1);
    }
    assert.equal(request.init, init); assert.equal(request.init.body, bytes); assert.equal(JSON.stringify(request.body), bytes);
    assert.equal(h.store.session.get().user.userId, record.actor);
    assert.ok(h.store.authorizationScopeActive(record.authorization) && h.store.sourceOwnershipActive(record.source));
    await admit(appended);
    proofs.set(request, { init, bytes }); assert.equal(exact({ ...request }), false);
    record.receipt = { status: response.status, appended, head: returned.head };
    record.originalResponse = response;
    await record.gate.promise;
    if (record.loseAcknowledgement) {
      record.deliveryFault = true;
      throw new TypeError("Finite lost positive Sessions intent response");
    }
    record.delivered = true;
    return response;
  };
  const transport = request => {
    if (request.url !== "/api/events" || request.init.method !== "POST"
      || !["batch", "declare_intent"].includes(request.body?.action)) return original(request);
    assert.ok(armed && !armed.request, "Only one explicitly armed current blank/intent gesture may dispatch");
    const record = armed; armed = null;
    record.pending = execute(request, record);
    record.pending.catch(error => { if (!record.deliveryFault) record.error = error; });
    return record.pending;
  };
  h.transport = transport;
  t.after(() => { for (const record of records) record.gate.resolve(); if (h.transport === transport) h.transport = prior; });
  return {
    arm(kind, text, { loseAcknowledgement = false } = {}) {
      assert.equal(armed, null); assert.equal(records.length, 0, "This family has one original customer submission, never a retry");
      assert.ok(kind === "blank" || kind === "intent"); assert.ok(text && text === text.trim());
      assert.equal(loseAcknowledgement && kind !== "intent", false);
      const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
      assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      assert.equal(h.store.route.get(), "/sessions");
      armed = { kind, text, source, authorization, actor: h.store.session.get().user.userId,
        scope: { projectId: h.store.projection.get().projectId, documentId: h.store.projection.get().documentId },
        sessionId: h.store.projection.get().currentSessionId, briefId: h.store.projection.get().brief?.brief_id,
        loseAcknowledgement, gate: sceneDeferred(), request: null, receipt: null, delivered: false, error: null };
      if (kind === "blank") assert.ok(armed.sessionId && armed.briefId);
      records.push(armed); return armed;
    },
    async reached(record) {
      await untilScene(() => Boolean(record.receipt || record.error), "The actual Sessions submission reaches its exact original Worker receipt");
      if (record.error) throw record.error;
      assert.ok(record.receipt && exact(record.request)); return record.receipt;
    },
    isOriginal: exact,
    appended: () => records.flatMap(record => record.receipt?.appended ?? []),
    records: () => [...records],
  };
}

const fSessionDraftClass = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
function fSessionBlankNative(t, x) {
  const { f, owner } = x, prior = f.renderer.query;
  const selected = [];
  const query = function(currentOwner, selector) {
    if (currentOwner !== owner || selector !== ".blank-document-form input") return prior.call(this, currentOwner, selector);
    // The shared finite query port has no descendant-selector/input.select
    // implementation. Resolve this one native call from one current tree;
    // do not return a lookalike form or replace the production callback.
    const tree = f.tree(), forms = tree.visible("form").filter(node => node.owner === owner && fSessionDraftClass(node, "blank-document-form"));
    assert.ok(forms.length <= 1);
    const fields = tree.visible("input").filter(node => node.owner === owner && node.attributes.id === "blank-document-name"
      && node.parent === forms[0]);
    assert.ok(fields.length <= 1);
    return fields.map(({ port }) => {
      assert.ok(port.isConnected && f.renderer.nodes.includes(port));
      port.select = function() {
        assert.ok(this.isConnected && f.renderer.nodes.includes(this));
        this.selectionStart = 0; this.selectionEnd = String(this.value ?? "").length;
        selected.push(this);
      };
      return port;
    });
  };
  f.renderer.query = query;
  t.after(() => { if (f.renderer.query === query) f.renderer.query = prior; });
  return selected;
}
const fSessionDraftField = (x, kind) => x.f.find(kind === "blank" ? "input" : "textarea", node => node.owner === x.owner
  && node.attributes.id === (kind === "blank" ? "blank-document-name" : "session-intent-statement"));
const fSessionDraftForm = (x, kind) => x.f.find("form", node => node.owner === x.owner
  && fSessionDraftClass(node, kind === "blank" ? "blank-document-form" : "intent-card"));
async function fSessionDraftType(x, kind, raw) {
  const input = fSessionDraftField(x, kind);
  assert.ok(input.port.isConnected && x.f.renderer.nodes.includes(input.port));
  input.port.value = raw; await x.f.act(input, "input");
  assert.equal(fSessionDraftField(x, kind).port.value, raw);
}
async function fSessionDraftEffects(x, record) {
  const { f, h, before } = x;
  await h.navigationResumeReads.settleOriginalRequests(); await f.settle(); await h.worker.drainBackground();
  assert.deepEqual(await h.history(), [...before.history, ...h.briefReceipts.appended(), ...h.sessionDraftReceipts.appended()]);
  assert.deepEqual(h.counts(), before.counts, "All actual job/reservation/counter rows stay exact");
  assert.deepEqual(h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET"
    && !h.navigationResumeReads.isReadOnlyResume(request) && !h.briefReceipts.isOriginal(request)
    && !h.sessionDraftReceipts.isOriginal(request)), [], "No extra creation, intent, provider, paid or approval command");
  assert.equal(h.sessionDraftReceipts.records().length, 1);
  assert.equal(h.requests.filter(request => h.sessionDraftReceipts.isOriginal(request)).length, 1);
  assert.equal(h.store.session.get().user.userId, before.actor);
  assert.ok(h.store.authorizationScopeActive(before.authorization));
  assert.ok(h.store.sourceOwnershipActive(record.source));
}

for (const completion of ["unchanged", "newer-name", "newer-route"])
test("F Sessions blank original completion / " + completion, fIntelligenceOptions, async t => {
  const x = await fSessionPage(t, "en", "thread", { sessionDraftReceiptAccounting: true }), { f, h, owner } = x;
  const selected = fSessionBlankNative(t, x);
  await fSessionPrepare(x, "thread");
  await f.act(f.find("button", node => node.owner === owner && fSessionDraftClass(node, "blank-choice")));
  assert.equal(selected.length, 1, "The original deferred native input selection ran on its actual current field");
  const originalRaw = "  Original blank A  ", newerRaw = "  Unsubmitted blank B  ";
  await fSessionDraftType(x, "blank", originalRaw);
  const original = h.sessionDraftReceipts.arm("blank", originalRaw.trim());
  const form = fSessionDraftForm(x, "blank"), pending = f.act(form, "submit");
  let expectedRoute = "/sessions";
  try {
    const receipt = await h.sessionDraftReceipts.reached(original);
    await f.settle();
    assert.equal(original.delivered, false); assert.equal(h.store.route.get(), "/sessions");
    assert.equal(h.store.events.get().some(event => event.eventId === receipt.appended[1].eventId), false,
      "Canonical commit is not an acknowledgement published by the client");
    if (completion === "newer-name") await fSessionDraftType(x, "blank", newerRaw);
    if (completion === "newer-route") {
      await registerCalmFullPageComponents(f, ["forma-activity"]);
      f.nativeHistoryLocation = h.location;
      const held = { ...x, a: original }; await cBlankCommandPendingPresentation(held);
      const beforeRequests = h.requests.length, beforeEvents = JSON.stringify(h.store.events.get()), beforeHead = h.store.head.get();
      const activity = f.task("/activity"), destination = activity.attributes.href;
      assert.equal(destination, withProjectTaskDocumentInRoute("/activity", h.ad, "/sessions"));
      f.native.emit("pointerdown", activity.port); f.native.focus(activity.port);
      await f.act(activity, "click", { button: 0 }); await cBlankCommandPendingPresentation(held);
      assert.equal(h.store.route.get(), "/sessions", "Ordinary navigation cannot discard the still-pending original");
      assert.ok(owner.isConnected); assert.equal(fSessionDraftField(x, "blank").port.value, originalRaw);
      assert.equal(h.requests.length, beforeRequests); assert.equal(JSON.stringify(h.store.events.get()), beforeEvents);
      assert.equal(h.store.head.get(), beforeHead); assert.equal(original.delivered, false);
      assert.equal(h.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
      // The original late-response case needs an EXTERNAL newer route, not an
      // in-app departure now deliberately refused. Reuse the existing native
      // Location port and actual Shell popstate handler; no app method override.
      assert.equal(f.native.listeners("popstate"), 1); ports.bindFixture(f);
      history.pushState({}, "", destination);
      assert.equal(h.store.route.get(), "/sessions", "Native history change alone does not call Store");
      assert.equal(h.location.pathname + h.location.search + h.location.hash, destination);
      f.native.emit("popstate"); assert.equal(h.store.route.get(), destination);
      await f.settle(); expectedRoute = h.store.route.get();
      assert.equal(new URL(expectedRoute, "https://fixture.invalid").pathname, "/activity");
      assert.equal(owner.isConnected, false); assert.ok(h.store.sourceOwnershipActive(original.source));
    }
    original.gate.resolve(); await pending; await fSessionFinishOriginalTimers(f);
    await fSessionDraftEffects(x, original);
    const fields = f.tree().visible("input").filter(node => node.owner === owner && node.attributes.id === "blank-document-name");
    t.diagnostic("F_SESSIONS_BLANK_COMPLETION " + JSON.stringify({ completion, originalDocumentId: original.documentId,
      canonicalTitle: receipt.appended[1].payload.title, originalEvents: receipt.appended.map(event => ({ id: event.eventId, sequence: event.sequence })),
      expectedRoute, route: h.store.route.get(), originalOwnerConnected: owner.isConnected,
      currentBlankFields: fields.length, raw: fields[0]?.port.value ?? null, originalReceiptDelivered: original.delivered,
      providerOrExtraCommand: false }));
    if (completion === "unchanged") {
      assert.equal(documentIdFromRoute(h.store.route.get()), original.documentId);
      assert.equal(h.store.projection.get().documentId, original.documentId);
      assert.equal(fields.length, 0, "An unchanged original successful name is consumed once");
    } else {
      assert.equal(h.store.route.get(), expectedRoute, "The old blank completion cannot override the current route or abandon a newer name");
      if (completion === "newer-name") {
        assert.equal(owner.isConnected, true); assert.equal(fields.length, 1);
        assert.equal(fields[0].port.value, newerRaw, "Newer raw B remains unsubmitted, even though A consumed the original brief");
      }
    }
  } finally { original.gate.resolve(); await pending; }
});

for (const completion of ["unchanged", "newer-statement", "lost-positive-response"])
test("F Sessions intent original completion / " + completion, fIntelligenceOptions, async t => {
  const x = await fSessionPage(t, "en", "thread", { sessionDraftReceiptAccounting: true }), { f, h } = x;
  const originalRaw = "  Follow the original intention A.  ", newerRaw = "  Keep the unsubmitted intention B.  ";
  await fSessionDraftType(x, "intent", originalRaw);
  const original = h.sessionDraftReceipts.arm("intent", originalRaw.trim(), { loseAcknowledgement: completion === "lost-positive-response" });
  const pending = f.act(fSessionDraftForm(x, "intent"), "submit");
  try {
    const receipt = await h.sessionDraftReceipts.reached(original), eventId = receipt.appended[0].eventId;
    await f.settle();
    assert.equal(original.delivered, false); assert.equal(h.store.route.get(), "/sessions");
    assert.equal(h.store.events.get().some(event => event.eventId === eventId), false);
    const saving = f.find("button", node => node.owner === x.owner && node.text === f.i18n.system("Recording privately…"));
    assert.equal(Object.hasOwn(saving.attributes, "disabled"), true);
    if (completion === "newer-statement") await fSessionDraftType(x, "intent", newerRaw);
    original.gate.resolve(); await pending; await f.settle();
    await fSessionDraftEffects(x, original);
    const input = fSessionDraftField(x, "intent"), published = h.store.events.get().some(event => event.eventId === eventId);
    t.diagnostic("F_SESSIONS_INTENT_COMPLETION " + JSON.stringify({ completion, eventId, sequence: receipt.head,
      originalWorkerStatus: receipt.status, delivered: original.delivered, finiteDeliveryFault: Boolean(original.deliveryFault),
      raw: input.port.value, route: h.store.route.get(), originalOwnerConnected: x.owner.isConnected,
      originalEventPublished: published, busy: h.store.busy.get(), providerOrExtraCommand: false }));
    assert.equal(h.store.route.get(), "/sessions"); assert.equal(x.owner.isConnected, true);
    assert.equal(h.store.busy.get(), ""); assert.equal(published, completion !== "lost-positive-response");
    assert.equal(input.port.value, completion === "unchanged" ? "" : completion === "newer-statement" ? newerRaw : originalRaw,
      "Only an acknowledged unchanged original may clear: newer B and unconfirmed A remain raw and unsubmitted");
  } finally { original.gate.resolve(); await pending; }
});


// F decision reach only: the existing complete navigationPage, actual Shell,
// ContextBlock and LibraryBlockEditor. No new renderer or method replacement.
const F_DECISION_REACH = [
  { locale: "en", scope: "document", method: "click", boundary: "healthy" },
  { locale: "en", scope: "document", method: "click", boundary: "source" },
  { locale: "ja", scope: "library", method: "Enter", boundary: "healthy" },
  { locale: "ja", scope: "library", method: "Enter", boundary: "removed-original" },
];
function fDecisionOne(f, tree, tag, predicate, message) {
  const rows = tree.visible(tag).filter(predicate);
  assert.equal(rows.length, 1, message);
  assert.ok(rows[0].port?.isConnected && f.renderer.nodes.includes(rows[0].port),
    "The chosen control belongs to the current complete native hierarchy");
  return rows[0];
}
async function fDecisionPage(t, entry) {
  const f = await navigationPage(t, entry.locale, { nativePreparation: true }), h = f.navigationHost;
  // Register actual CEM descendants before navigation/focus can inspect them.
  await registerCalmFullPageComponents(f, ["forma-workspace", "forma-library"]);
  await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
  const id = entry.scope === "document" ? "scene-reuse-direction" : "f-current-reusable-decision";
  if (entry.scope === "library") {
    await h.external("BlockCreated", { project_id: h.a, scope: "library", block_id: id,
      type: "direction", handle: "direction/f-current-reusable", position: "l-f-reach",
      properties: { label: "再利用する現在の決定", text: "  F exact reusable wording — 海辺\nKeep this original line.  ",
        weight: 0.65, authority: "authored" } });
    await h.store.refreshEvents({ fromStart: true }); await f.settle();
  }
  h.exact();
  const block = h.store.projection.get().libraryBlocks.find(value => value.id === id);
  assert.ok(block && !block.removed); assert.equal(block.scope, entry.scope); assert.equal(block.projectId, h.a);
  if (entry.scope === "document") assert.equal(block.documentId, h.ad);
  const before = await fIntelligenceBaseline(f);
  assert.equal(h.store.session.get().projectContext, undefined);
  assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
  const permissions = h.store.session.get().capabilities;
  assert.ok(permissions.includes("project.read") && permissions.includes("project.author"),
    "Use the existing real personal owner, never a broadened fixture permission");
  return { f, h, entry, block: structuredClone(block), before };
}
async function fDecisionCommand(x) {
  const { f, h, block, entry, before } = x, copy = commandDiscoveryCopy(entry.locale);
  const requests = h.requests.length, name = String(block.properties.label ?? block.handle);
  await openDiscoverySearch(f, block.handle);
  assert.equal(h.requests.length, requests, "Current contextual discovery performs no additional request");
  const rows = c19NamingOptions(f).filter(node => node.children.some(child => typeof child !== "string"
    && child.tag === "small" && c19NamingPresentationKey(c19NamingVisibleText(child)).startsWith(copy.decision + " · ")));
  assert.equal(rows.length, 1, "The complete visible category and exact handle identify one current decision");
  const row = rows[0]; c19NamingCurrent(f, row);
  const presented = c19NamingPresentationKey(c19NamingVisibleText(row));
  assert.ok(presented.includes(copy.open.replace("{name}", name)));
  assert.ok(presented.includes(block.handle) && presented.includes(h.store.projection.get().projectName));
  if (entry.scope === "document") assert.ok(presented.includes(h.store.projection.get().documentTitle));
  assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
  if (entry.method === "click") await finishCommandPreparation(f, f.act(row, "click", { button: 0 }));
  else {
    await f.act(row, "mouseenter");
    const input = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search");
    assert.equal(input.attributes["aria-activedescendant"], row.attributes.id);
    const route = h.store.route.get();
    await f.act(input, "keydown", { key: "Enter", isComposing: false });
    assert.equal(h.store.route.get(), route, "The key handler does not replace the native form-submit default");
    await finishCommandPreparation(f, f.act(f.find("form", node => node.owner === f.host
      && fObjectClassed(node, "command-card")), "submit"));
  }
  await f.settle(); h.exact(); assert.equal(h.store.ui.commandOpen, false);
  assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === block.id), block,
    "Discovery selects the original source identity; it neither copies nor edits it");
}
async function fDecisionEditor(x) {
  const { f, h, block, entry } = x, name = String(block.properties.label ?? block.handle);
  if (entry.scope === "document") {
    assert.equal(documentIdFromRoute(h.store.route.get()), h.ad);
    assert.equal(new URL(h.store.route.get(), "https://fixture.invalid").hash, "#context=" + encodeURIComponent(block.id));
    assert.equal(h.store.ui.focusBlockId, block.id);
    let tree = f.tree();
    const host = fDecisionOne(f, tree, "forma-context-block", node => node.component?.block?.id === block.id
      && node.component.surface === "document", "One exact current Document decision owns its controls");
    const owner = host.component;
    assert.ok(owner instanceof f.modules.get("src/components/context-block.ts").ContextBlock);
    assert.equal(owner.store, h.store);
    const toggle = fDecisionOne(f, tree, "button", node => node.owner === owner
      && fObjectClassed(node, "context-controls-toggle"), "The selected decision visibly offers Controls");
    assert.equal(toggle.text, f.i18n.t("context.controls.named", "Controls for {name}", { name: "\u2068" + name + "\u2069" }));
    assert.equal(toggle.attributes["aria-expanded"], "false");
    await finishCommandPreparation(f, f.act(toggle));
    tree = f.tree();
    const panel = fDecisionOne(f, tree, "div", node => node.owner === owner
      && node.attributes.id === "context-controls-document-" + block.id && node.attributes.role === "region",
    "Controls opens this exact decision's complete editor region");
    assert.equal(panel.attributes["aria-label"], toggle.text);
    const field = fDecisionOne(f, tree, "textarea", node => node.owner === owner
      && node.attributes.id === "block-copy-" + block.id && c19NamingWithin(node, panel),
    "The complete original content is available in the actual editable native field");
    assert.equal(field.port.value, block.properties.text); assert.equal(field.port.matches(":disabled"), false);
    assert.equal(h.store.ui.editingBlockId, block.id);
    const save = fDecisionOne(f, tree, "button", node => node.owner === owner
      && node.attributes.type === "submit" && c19NamingWithin(node, panel), "The current full editor retains Save");
    assert.equal(save.port.matches(":disabled"), false);
    return { owner, field, panel };
  }
  assert.deepEqual(libraryFocusFromRoute(h.store.route.get()), { kind: "block", id: block.id });
  assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), h.ad);
  let tree = f.tree();
  const preview = fDecisionOne(f, tree, "dialog", node => node.owner.tag === "forma-library"
    && fObjectClassed(node, "library-focus-dialog") && node.attributes["aria-labelledby"] === "block-focus-title",
  "The exact reusable decision arrives in its current native preview");
  assert.equal(preview.port.open, true);
  const heading = fDecisionOne(f, tree, "h2", node => node.attributes.id === "block-focus-title"
    && c19NamingWithin(node, preview), "The preview visibly names its exact original decision");
  assert.equal(heading.text, name);
  const previewBlock = fDecisionOne(f, tree, "forma-context-block", node => c19NamingWithin(node, preview)
    && node.component?.block?.id === block.id, "The original saved decision, not a substitute, owns the preview");
  assert.equal(previewBlock.component.readOnly, true);
  const controls = fDecisionOne(f, tree, "button", node => node.owner === preview.owner
    && c19NamingWithin(node, preview)
    && node.text === f.i18n.t("context.controls.named", "Controls for {name}", { name: "\u2068" + name + "\u2069" }),
  "One contextual Controls action reaches the original reusable editor");
  const editorRoute = libraryBlockEditorRoute(block.id, h.store.route.get());
  await finishCommandPreparation(f, f.act(controls));
  assert.equal(h.store.route.get(), editorRoute); tree = f.tree();
  assert.equal(tree.visible("dialog").filter(node => fObjectClassed(node, "library-focus-dialog")).length, 0);
  const editor = fDecisionOne(f, tree, "forma-library-block-editor", node => node.component?.blockId === block.id,
    "One exact full reusable editor is currently mounted");
  const owner = editor.component;
  assert.ok(owner instanceof f.modules.get("src/components/library-block-editor.ts").LibraryBlockEditor);
  assert.equal(owner.store, h.store);
  const form = fDecisionOne(f, tree, "form", node => node.owner === owner && fObjectClassed(node, "library-block-form"),
    "The actual reusable editor supplies its complete current form");
  const identity = fDecisionOne(f, tree, "fieldset", node => node.owner === owner
    && node.attributes["aria-labelledby"] === "library-block-identity" && c19NamingWithin(node, form),
  "Editable identity belongs to this exact saved block");
  const handle = fDecisionOne(f, tree, "input", node => c19NamingWithin(node, identity)
    && String(node.attributes.maxlength) === "96", "The exact original handle is visible in the native field");
  assert.equal(handle.port.value, block.handle); assert.equal(handle.port.matches(":disabled"), false);
  const rich = fDecisionOne(f, tree, "forma-ui-rich-text", node => c19NamingWithin(node, form)
    && fObjectClassed(node, "block-editor-copy"), "Use the actual shared full-content editor");
  const field = fDecisionOne(f, tree, "textarea", node => node.owner === rich.component
    && c19NamingWithin(node, form), "The shared editor's native textarea is currently reachable");
  assert.equal(rich.component.value, block.properties.text);
  assert.equal(field.port.value, block.properties.text); assert.equal(field.port.matches(":disabled"), false);
  const save = fDecisionOne(f, tree, "button", node => node.owner === owner && c19NamingWithin(node, form)
    && node.text === f.i18n.system("Save changes"), "The actual reusable editor retains its Save command");
  assert.equal(save.port.matches(":disabled"), false);
  return { owner, field, form };
}
async function fDecisionReturnToWork(x) {
  const { f, h, block } = x;
  const work = f.tree().visible("a").filter(node => node.owner.tag === "forma-ui-audience-navigation"
    && documentIdFromRoute(node.attributes.href) === h.ad);
  assert.equal(work.length, 1); assert.ok(work[0].port.isConnected);
  await finishCommandPreparation(f, f.act(work[0], "click", { button: 0 }));
  h.exact(); assert.equal(documentIdFromRoute(h.store.route.get()), h.ad);
  assert.ok(f.components().some(owner => owner.tag === "forma-workspace" && owner.store === h.store && owner.isConnected));
  assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === block.id), block);
}
for (const entry of F_DECISION_REACH)
test("F exact decision command/editor reach / " + entry.locale + " / " + entry.scope + " / " + entry.boundary,
  fIntelligenceOptions, async t => {
    const x = await fDecisionPage(t, entry), { f, h, block, before } = x;
    await fDecisionCommand(x); const opened = await fDecisionEditor(x);
    await fIntelligenceNoCommands(f, before);
    if (entry.boundary === "source") {
      const env = h.worker.env, key = "FORMA_PILOT_COHORT_ID", had = Object.hasOwn(env, key), previous = env[key];
      const prior = h.intercept, pending = new Set(), denied = [];
      env[key] = "synthetic-missing-f-decision-cohort";
      h.intercept = request => {
        if (!request.url.startsWith("/api/events?") || (request.init.method ?? "GET") !== "GET") return prior?.(request);
        const original = (async () => {
          const response = await h.worker.request(request.url, request.init);
          assert.equal(response.status, 403);
          assert.equal((await response.clone().json()).error, "pilot_participant_required");
          denied.push(request); return response;
        })();
        pending.add(original); original.then(() => pending.delete(original), () => pending.delete(original)); return original;
      };
      try {
        await assert.rejects(h.store.refreshEvents({ fromStart: true }), /Event stream returned 403/u);
        await f.settle(); assert.ok(denied.length > 0);
        assert.equal(h.store.sourceOwnershipActive(before.source), false);
        assert.ok(h.store.authorizationScopeActive(before.authorization), "Only Source was withdrawn, not the actor");
        assert.equal(opened.owner.isConnected, false);
        assert.equal(f.tree().visible("textarea").some(node => node.attributes.id === "block-copy-" + block.id), false);
        assert.equal(h.store.eventView.get().length, 0); assert.deepEqual(h.store.content.get(), {});
        await openDiscoverySearch(f, block.handle);
        assert.equal(c19NamingOptions(f).some(node => c19NamingPresentationKey(c19NamingVisibleText(node)).includes(block.handle)), false);
        await fIntelligenceNoCommands(f, before);
      } finally {
        await Promise.all([...pending]); h.intercept = prior;
        if (had) env[key] = previous; else delete env[key];
      }
    } else if (entry.boundary === "removed-original") {
      const route = h.store.route.get(), removal = { block_id: block.id, scope: "library", reason: "declared-f-concurrent-removal" };
      await h.external("BlockRemoved", removal);
      const declared = await h.history();
      assert.equal(declared.length, before.history.length + 1); assert.deepEqual(declared.slice(0, -1), before.history);
      assert.equal(declared.at(-1).type, "BlockRemoved"); assert.deepEqual(declared.at(-1).payload, removal);
      await h.store.refreshEvents({ fromStart: true }); await f.settle();
      assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
      assert.equal(h.store.route.get(), route, "An unavailable original does not silently select a different editor route");
      assert.equal(h.store.projection.get().libraryBlocks.some(value => value.id === block.id), false);
      assert.ok(h.store.projection.get().libraryBlocks.some(value => value.id === "scene-reuse-direction"),
        "Another authorized decision remains, but cannot substitute for the removed identity");
      const tree = f.tree();
      assert.equal(tree.visible("form").filter(node => node.owner === opened.owner && fObjectClassed(node, "library-block-form")).length, 0);
      const unavailable = f.i18n.t("context.controls.unavailable",
        "That saved decision is no longer available. Return to the Library to choose another.");
      assert.ok(tree.visible("p").some(node => node.owner === opened.owner && node.text === unavailable));
      const back = fDecisionOne(f, tree, "button", node => node.owner === opened.owner
        && node.text === f.i18n.t("context.controls.backLibrary", "Back to Library"), "The unavailable original has a current return action");
      await f.act(back); await openDiscoverySearch(f, block.handle);
      assert.equal(c19NamingOptions(f).some(node => c19NamingPresentationKey(c19NamingVisibleText(node)).includes(block.handle)), false);
      await fIntelligenceNoCommands(f, { ...before, history: declared });
    } else {
      if (entry.scope === "document") {
        const focusStart = f.native.nativeFocus.length;
        const currentField = fDecisionOne(f, f.tree(), "textarea", node => node.owner === opened.owner
          && node.attributes.id === "block-copy-" + block.id, "Escape uses the current connected native editor field");
        await finishCommandPreparation(f, f.act(currentField, "keydown", { key: "Escape", isComposing: false }));
        const tree = f.tree();
        const toggle = fDecisionOne(f, tree, "button", node => node.owner === opened.owner
          && fObjectClassed(node, "context-controls-toggle"), "Escape returns to this decision's current Controls toggle");
        assert.equal(toggle.attributes["aria-expanded"], "false"); assert.equal(h.store.ui.editingBlockId, "");
        assert.equal(tree.visible("textarea").some(node => node.owner === opened.owner), false);
        assert.ok(f.native.nativeFocus.slice(focusStart).some(({ node }) => node.owner === opened.owner
          && node.attributes["aria-controls"] === "context-controls-document-" + block.id),
        "The finite native return-focus port targets the original decision, not a sibling");
        await f.act(f.task("/library"), "click", { button: 0 });
        assert.equal(h.store.route.get(), withProjectTaskDocumentInRoute("/library", h.ad),
          "The actual primary Library click must leave the Document before Work returns to it");
      } else {
        const tree = f.tree(), header = fDecisionOne(f, tree, "header", node => node.owner === opened.owner
          && fObjectClassed(node, "library-block-editor-header"), "Use the exact current reusable editor header");
        // This finite child.render() port does not run the inherited
        // FormaPresentationalElement.update static-copy localization wrapper.
        // Select its exact authored literal here; do not claim JA static-copy
        // rendering coverage or change the real current Back handler/destination.
        const back = fDecisionOne(f, tree, "button", node => node.owner === opened.owner
          && c19NamingWithin(node, header) && node.text === "Back to Library", "The actual full editor retains its Close/return action");
        await finishCommandPreparation(f, f.act(back));
        assert.equal(new URL(h.store.route.get(), "https://fixture.invalid").pathname, "/library");
        assert.equal(f.tree().visible("form").filter(node => fObjectClassed(node, "library-block-form")).length, 0);
      }
      await fDecisionReturnToWork(x);
      await fIntelligenceNoCommands(f, before);
    }
    t.diagnostic("F_DECISION_REACH " + JSON.stringify({ ...entry, originalId: block.id, projectId: block.projectId,
      originalDocumentId: block.documentId, currentDocumentId: h.store.projection.get().documentId,
      actualEditor: entry.scope === "document" ? "forma-context-block" : "forma-library-block-editor",
      route: h.store.route.get(), sourceCurrent: h.store.sourceOwnershipActive(before.source),
      originalAuthorityCurrent: h.store.authorizationScopeActive(before.authorization), userCommandSubmitted: false }));
  });


// Six additive controls for the conditional Sessions draft repair. The six
// original baseline bodies and their exact brief/draft observers stay intact.
function fSessionOrdinaryBlankAccounting(t, h, admit) {
  const prior = h.transport, original = request => prior ? prior(request) : h.worker.request(request.url, request.init);
  let record = null;
  const isOriginal = request => Boolean(record?.receipt && request === record.request
    && request.init === record.init && request.init.body === record.bytes && JSON.stringify(request.body) === record.bytes);
  const execute = async request => {
    assert.ok(record && !record.request, "Exactly one separately deliberate ordinary blank creation is armed");
    record.request = request; record.init = request.init; record.bytes = request.init.body;
    assert.ok(h.requests.includes(request)); assert.equal(h.store.route.get(), "/sessions");
    assert.equal(h.store.session.get().user.userId, record.actor); assert.equal(h.store.session.get().projectContext == null, true);
    assert.ok(h.store.sourceOwnershipActive(record.source) && h.store.authorizationScopeActive(record.authorization));
    assert.equal(h.store.projection.get().projectId, record.projectId);
    const before = await h.history(), financial = h.counts(), input = request.body;
    assert.deepEqual(Object.keys(input).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
    assert.equal(input.action, "batch"); assert.equal(input.clientId, "web:lit"); assert.equal(input.expectedSequence, before.at(-1).sequence);
    assert.equal(input.events.length, 2); assert.deepEqual(input.event, input.events[0]);
    const id = input.events[0].payload.document_id;
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
    assert.equal(before.some(event => event.type === "DocumentCreated" && event.payload.document_id === id), false);
    assert.deepEqual(input.events, [
      { type: "DocumentCreated", payload: { document_id: id, handle: "document-" + id.slice(0, 8), title: record.title, project_id: record.projectId } },
      { type: "EmptyCanvasChosen", payload: { project_id: record.projectId, document_id: id, source_surface: "sessions" } },
    ], "The new ordinary action carries neither consumed brief/session metadata nor A's original document ID");
    const response = await h.worker.request(request.url, request.init), body = await response.clone().json();
    assert.equal(response.status, 200); assert.equal(response.bodyUsed, false);
    assert.deepEqual(Object.keys(body).sort(), ["appended", "head", "rejected"]); assert.deepEqual(body.rejected, []);
    assert.equal(body.appended.length, 2);
    for (const [index, event] of body.appended.entries()) {
      assert.equal(event.type, input.events[index].type); assert.deepEqual(event.payload, input.events[index].payload);
      assert.equal(event.streamId, h.worker.streamId); assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit");
      assert.ok(event.eventId && event.correlationId); assert.equal(event.sequence, input.expectedSequence + index + 1);
    }
    assert.equal(body.head, body.appended[1].sequence); await h.worker.drainBackground();
    assert.deepEqual(await h.history(), [...before, ...body.appended]); assert.deepEqual(h.counts(), financial);
    assert.equal(request.init.body, record.bytes); assert.equal(JSON.stringify(request.body), record.bytes);
    assert.ok(h.store.sourceOwnershipActive(record.source) && h.store.authorizationScopeActive(record.authorization));
    await admit(body.appended);
    record.receipt = { appended: body.appended, head: body.head }; record.documentId = id;
    assert.equal(isOriginal({ ...request }), false);
    await record.gate.promise; return response;
  };
  const transport = request => {
    if (request.url !== "/api/events" || request.init.method !== "POST" || request.body?.action !== "batch"
      || request.body?.events?.[0]?.type !== "DocumentCreated") return original(request);
    const pending = execute(request); pending.catch(error => { if (record) record.error = error; }); return pending;
  };
  h.transport = transport;
  t.after(() => { record?.gate.resolve(); if (h.transport === transport) h.transport = prior; });
  return {
    arm(title) {
      assert.equal(record, null); assert.equal(h.store.route.get(), "/sessions");
      record = { title, projectId: h.store.projection.get().projectId, actor: h.store.session.get().user.userId,
        source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(), gate: sceneDeferred() };
      return record;
    },
    async reached() {
      await untilScene(() => Boolean(record?.receipt || record?.error), "The new deliberate ordinary blank reaches its own real Worker receipt");
      if (record.error) throw record.error;
      assert.ok(isOriginal(record.request)); return record.receipt;
    },
    isOriginal,
  };
}

async function fSessionContinuationPage(t, locale, ordinary = false) {
  const x = await fSessionPage(t, locale, "thread", { sessionDraftReceiptAccounting: true, ordinaryBlankReceiptAccounting: ordinary });
  x.blankSelections = fSessionBlankNative(t, x); await fSessionPrepare(x, "thread");
  await x.f.act(x.f.find("button", node => node.owner === x.owner && fSessionDraftClass(node, "blank-choice")));
  return x;
}

test("F Sessions confirmed A keeps B for a new deliberate ordinary blank / ja", fIntelligenceOptions, async t => {
  const x = await fSessionContinuationPage(t, "ja", true), { f, h } = x;
  await fSessionDraftType(x, "blank", "  Original A  ");
  const a = h.sessionDraftReceipts.arm("blank", "Original A"), pendingA = f.act(fSessionDraftForm(x, "blank"), "submit");
  try {
    await h.sessionDraftReceipts.reached(a); await f.settle();
    await fSessionDraftType(x, "blank", "  New deliberate B  ");
    a.gate.resolve(); await pendingA; await fSessionDraftEffects(x, a);
    assert.equal(h.store.route.get(), "/sessions"); assert.equal(h.store.projection.get().brief, null);
    assert.equal(fSessionDraftField(x, "blank").port.value, "  New deliberate B  ");
    const label = f.i18n.t("sessions.blank.createAnother", "Create another blank document");
    assert.notEqual(label, "Create another blank document", "The new action uses the actual Japanese registry");
    const button = f.find("button", node => node.owner === x.owner && node.text === label);
    assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
    const beforeB = h.requests.length, b = h.ordinaryBlankReceipts.arm("New deliberate B");
    const pendingB = f.act(fSessionDraftForm(x, "blank"), "submit");
    try {
      const receipt = await h.ordinaryBlankReceipts.reached(); assert.notEqual(b.documentId, a.documentId);
      await f.settle();
      assert.equal(f.tree().visible("p").some(node => node.owner === x.owner
        && node.text === f.i18n.t("sessions.blank.originalCreated", "The original document was created. This name has not been used to create another document.")), false,
      "A real committed B whose response is held is not described as an unsent name");
      assert.equal(h.requests.slice(beforeB).filter(row => row.init.method === "POST").length, 1);
      b.gate.resolve(); await pendingB; await f.settle(); await h.navigationResumeReads.settleOriginalRequests();
      assert.equal(documentIdFromRoute(h.store.route.get()), b.documentId);
      assert.deepEqual(await h.history(), [...x.before.history, ...h.briefReceipts.appended(), ...a.receipt.appended, ...receipt.appended]);
      assert.deepEqual(h.counts(), x.before.counts);
      assert.deepEqual(h.requests.slice(x.before.requests).filter(row => (row.init.method ?? "GET") !== "GET"
        && !h.navigationResumeReads.isReadOnlyResume(row) && !h.briefReceipts.isOriginal(row)
        && !h.sessionDraftReceipts.isOriginal(row) && !h.ordinaryBlankReceipts.isOriginal(row)), []);
      t.diagnostic("F_SESSIONS_ORDINARY_BLANK " + JSON.stringify({ originalA: a.documentId, newB: b.documentId,
        distinctOriginals: true, ordinaryEvents: receipt.appended.map(event => event.type), route: h.store.route.get(), extraCommands: 0 }));
    } finally { b.gate.resolve(); await pendingB; }
  } finally { a.gate.resolve(); await pendingA; }
});

test("F Sessions unconfirmed original blank cannot enable a new ordinary creation / en", fIntelligenceOptions, async t => {
  const x = await fSessionContinuationPage(t, "en"), { f, h } = x;
  const raw = "  Unconfirmed original A  "; await fSessionDraftType(x, "blank", raw);
  const a = h.sessionDraftReceipts.arm("blank", raw.trim()), prior = h.transport; let lost = 0;
  h.transport = async request => {
    const response = await prior(request);
    if (h.sessionDraftReceipts.isOriginal(request)) {
      assert.equal(response, a.originalResponse); assert.equal(response.status, 200); lost++;
      throw new TypeError("Finite lost positive blank response after actual commitment");
    }
    return response;
  };
  const pending = f.act(fSessionDraftForm(x, "blank"), "submit");
  try {
    await h.sessionDraftReceipts.reached(a); a.gate.resolve(); await pending; await f.settle();
    await fSessionDraftEffects(x, a); assert.equal(lost, 1); assert.equal(h.store.route.get(), "/sessions");
    assert.equal(fSessionDraftField(x, "blank").port.value, raw);
    assert.equal(f.tree().visible("button").some(node => node.owner === x.owner && node.text === f.i18n.t("sessions.blank.createAnother", "Create another blank document")), false);
    const tree = f.tree(), forms = tree.visible("form").filter(node => node.owner === x.owner && fSessionDraftClass(node, "blank-document-form"));
    assert.equal(forms.length, 1); const form = forms[0];
    assert.equal(tree.visible("p").some(node => node.owner === x.owner && node.text === f.i18n.t("sessions.blank.unconfirmed",
      "This creation is unconfirmed; it has not been sent again.") + " " + f.i18n.t("next.sessions.recoveryLifetime")), true);
    assert.equal(tree.visible("button").some(node => node.owner === x.owner && node.text === f.i18n.t("sessions.blank.discard", "Discard name")), true);
    assert.equal(tree.visible("button").some(node => node.owner === x.owner && node.text === f.i18n.system("Cancel")), false,
      "Discarding a local name is not cancellation of an already dispatched original");
    const submit = tree.visible("button").filter(node => node.owner === x.owner && node.attributes.type === "submit"
      && node.parent?.parent === form);
    assert.equal(submit.length, 0, "Unconfirmed creation now offers Check instead of a non-actionable Create");
    assert.equal(tree.visible("button").filter(node => node.owner === x.owner && fSessionDraftClass(node, "blank-original-check")
      && !node.port.matches(":disabled")).length, 1);
    const before = h.requests.length;
    await f.act(form, "submit");
    assert.equal(h.requests.length, before, "The existing native form handler also refuses; this is a finite submit-contract check, not a claimed user-origin disabled click");
    assert.equal(h.store.events.get().some(event => event.eventId === a.receipt.appended[1].eventId), false);
    t.diagnostic("F_SESSIONS_UNKNOWN_BLANK " + JSON.stringify({ actualCommittedDocument: a.documentId, clientAcknowledged: false,
      rawRetained: true, ordinaryAction: false, extraCommands: 0 }));
  } finally { a.gate.resolve(); await pending; h.transport = prior; }
});

test("F Sessions raw edit A-B-A remains a newer blank draft / fr", fIntelligenceOptions, async t => {
  const kind = "blank", locale = "fr", x = await fSessionContinuationPage(t, locale);
  const { f, h } = x, raw = "  Exact original A  "; await fSessionDraftType(x, kind, raw);
  const a = h.sessionDraftReceipts.arm(kind, raw.trim()), pending = f.act(fSessionDraftForm(x, kind), "submit");
  try {
    await h.sessionDraftReceipts.reached(a); await f.settle();
    await fSessionDraftType(x, kind, "  Intermediate newer B  "); await fSessionDraftType(x, kind, raw);
    a.gate.resolve(); await pending; await fSessionDraftEffects(x, a);
    assert.equal(h.store.route.get(), "/sessions"); assert.equal(fSessionDraftField(x, kind).port.value, raw);
    assert.equal(h.store.events.get().some(event => event.eventId === a.receipt.appended.at(-1).eventId), true);
    t.diagnostic("F_SESSIONS_RAW_ABA " + JSON.stringify({ kind, locale, originalAcknowledged: true, newerRawRetained: true, extraCommands: 0 }));
  } finally { a.gate.resolve(); await pending; }
});

test("F Sessions blank acknowledgement keeps a newer same-page intent interaction / ar", fIntelligenceOptions, async t => {
  const x = await fSessionContinuationPage(t, "ar"), { f, h } = x;
  await fSessionDraftType(x, "blank", "Original A");
  f.native.focus(fSessionDraftField(x, "blank").port);
  const a = h.sessionDraftReceipts.arm("blank", "Original A"), pending = f.act(fSessionDraftForm(x, "blank"), "submit");
  try {
    await h.sessionDraftReceipts.reached(a); await f.settle();
    const intent = fSessionDraftField(x, "intent"), focusBefore = f.native.nativeFocus.length;
    f.native.focus(intent.port);
    assert.equal(f.native.nativeFocus[focusBefore].node, intent.port, "The existing native focus/focusin port delivered a real newer connected target");
    const raw = "  A newer intention B, not submitted.  "; await fSessionDraftType(x, "intent", raw);
    a.gate.resolve(); await pending; await fSessionDraftEffects(x, a);
    assert.equal(h.store.route.get(), "/sessions"); assert.equal(x.owner.isConnected, true);
    assert.equal(fSessionDraftField(x, "intent").port.value, raw);
    assert.equal(f.tree().visible("input").some(node => node.owner === x.owner && node.attributes.id === "blank-document-name"), false,
      "The acknowledged unchanged A field may clear independently of navigation ownership");
    assert.equal(h.store.ui.toast, f.i18n.system("{title} created as a blank document.", { title: "Original A" }));
    t.diagnostic("F_SESSIONS_SAME_PAGE_INTERACTION " + JSON.stringify({ originalDocument: a.documentId,
      originalAcknowledged: true, newerIntentRetained: true, route: h.store.route.get(), extraCommands: 0 }));
  } finally { a.gate.resolve(); await pending; }
});

test("F Sessions intent acknowledgement merges behind an already-current same-owner read", fIntelligenceOptions, async t => {
  const x = await fSessionPage(t, "en", "thread", { sessionDraftReceiptAccounting: true }), { f, h } = x;
  await fSessionDraftType(x, "intent", "Original intent A");
  const a = h.sessionDraftReceipts.arm("intent", "Original intent A"), pending = f.act(fSessionDraftForm(x, "intent"), "submit");
  try {
    const receipt = await h.sessionDraftReceipts.reached(a), original = receipt.appended[0];
    assert.deepEqual(await h.history(), [...x.before.history, original]);
    await h.external("DocumentRenamed", { document_id: h.ad, new_title: "Later authorized title C" });
    const history = await h.history(), later = history.at(-1);
    assert.equal(later.type, "DocumentRenamed"); assert.equal(later.sequence, original.sequence + 1);
    assert.deepEqual(history.slice(0, -1), [...x.before.history, original]);
    await h.store.refreshEvents({ fromStart: true }); await f.settle();
    assert.ok(h.store.sourceOwnershipActive(a.source) && h.store.authorizationScopeActive(a.authorization));
    const currentEvents = structuredClone(h.store.events.get()), head = h.store.head.get();
    assert.equal(currentEvents.filter(event => event.eventId === original.eventId).length, 1);
    assert.equal(currentEvents.some(event => event.eventId === later.eventId), true); assert.equal(head, later.sequence);
    assert.equal(a.delivered, false, "The independent current GET did not deliver A's held command acknowledgement");
    assert.equal(fSessionDraftField(x, "intent").port.value, "Original intent A");
    a.gate.resolve(); await pending; await f.settle(); await h.worker.drainBackground();
    t.diagnostic("F_SESSIONS_INTENT_READ_AHEAD " + JSON.stringify({ original: original.eventId, later: later.eventId,
      originalSequence: original.sequence, readHead: head, currentHead: h.store.head.get(),
      localOriginalCopies: h.store.events.get().filter(event => event.eventId === original.eventId).length }));
    assert.deepEqual(h.store.events.get(), currentEvents, "The actual later source remains ordered with one original A");
    assert.equal(h.store.head.get(), head, "A's older positive acknowledgement cannot regress the current head");
    assert.equal(fSessionDraftField(x, "intent").port.value, "");
    assert.deepEqual(await h.history(), history); assert.deepEqual(h.counts(), x.before.counts);
    assert.deepEqual(h.requests.slice(x.before.requests).filter(row => (row.init.method ?? "GET") !== "GET"
      && !h.navigationResumeReads.isReadOnlyResume(row) && !h.sessionDraftReceipts.isOriginal(row)), []);
  } finally { a.gate.resolve(); await pending; }
});

test("F Sessions same-resource fragment keeps both drafts and admits a fresh exact gesture", fIntelligenceOptions, async t => {
  const x = await fSessionContinuationPage(t, "en"), { f, h } = x;
  const blank = "  Unsent blank B  ", intent = "  Unsent intent C  ";
  await fSessionDraftType(x, "blank", blank); await fSessionDraftType(x, "intent", intent);
  const owner = x.owner, route = h.store.route.get(); assert.equal(route, "/sessions");
  let forwarded = 0;
  const forward = event => {
    // Store and components use two existing native window ports. Deliver the
    // SAME actual Store route event to the component port as one browser
    // window would; no application method or event body is replaced.
    forwarded++;
    for (const handler of [...(f.listeners.get("forma-route-changed") ?? [])]) handler(event);
  };
  h.window.addEventListener("forma-route-changed", forward);
  t.after(() => h.window.removeEventListener("forma-route-changed", forward));
  h.store.setRoute(route + "#main-content"); await f.settle();
  assert.equal(forwarded, 1); assert.equal(h.store.route.get(), "/sessions#main-content");
  assert.equal(owner.isConnected, true); assert.equal(f.components().find(component => component.tag === "forma-sessions"), owner);
  assert.equal(fSessionDraftField(x, "blank").port.value, blank); assert.equal(fSessionDraftField(x, "intent").port.value, intent);
  // Explicit local discard then a NEW current preparation uses the full
  // fragment route of this gesture, not the long-lived draft owner's old URL.
  await f.act(f.find("button", node => node.owner === owner && fSessionDraftClass(node, "blank-document-discard")));
  const selected = x.blankSelections.length;
  await f.act(f.find("button", node => node.owner === owner && fSessionDraftClass(node, "blank-choice")));
  assert.equal(x.blankSelections.length, selected + 1);
  assert.equal(fSessionDraftField(x, "blank").port.value, "Untitled study");
  assert.equal(fSessionDraftField(x, "intent").port.value, intent);
  assert.equal(h.sessionDraftReceipts.records().length, 0); await fSessionNoExtraEffects(x);
  t.diagnostic("F_SESSIONS_FRAGMENT_CUSTODY " + JSON.stringify({ route: h.store.route.get(), sameOwner: true,
    bothDraftsKeptBeforeExplicitDiscard: true, freshGestureSelected: true, submittedCreationsOrIntents: 0,
    evidence: "actual Store route event plus finite shared-window/native selection ports; not physical Skip behavior" }));
});

// Additive continuation ownership controls. Complete existing Shell/Sessions/
// Store/RAM Worker; current native ports, not browser or physical-focus proof.
for (const locale of ["en", "ja"]) for (const boundary of ["healthy", "newer-focus-before-ack", "route-aba-after-handoff"])
test("C Sessions original destination focus ownership / " + locale + " / " + boundary, fIntelligenceOptions, async t => {
  const x = await fSessionPage(t, locale), { f, h, owner } = x;
  if (locale === "ja" && boundary === "healthy") {
    const originalMedia = ports.windowPort.matchMedia;
    ports.windowPort.matchMedia = query => query === "(prefers-reduced-motion: reduce)"
      ? { ...originalMedia(query), matches: true } : originalMedia(query);
    t.after(() => { ports.windowPort.matchMedia = originalMedia; });
    assert.equal(ports.windowPort.matchMedia("(prefers-reduced-motion: reduce)").matches, true);
  }
  const choice = await fSessionPrepare(x, "thread"), destination = choice.item.destination;
  assert.equal(destination.view, "context-block"); assert.equal(destination.document_id, h.ad);
  assert.equal(destination.ref_id, "scene-reuse-direction");
  const accepted = h.briefReceipts.arm("accept", choice.event, true), pending = f.act(choice.button);
  try {
    await h.briefReceipts.reached(accepted);
    assert.equal(accepted.delivered, false); assert.equal(h.store.route.get(), "/sessions");
    assert.equal(accepted.receipt.appended[0].payload.item_id, choice.item.item_id);
    assert.ok(owner.isConnected && h.store.sourceOwnershipActive(x.before.source));
    let newerFocus = null;
    if (boundary === "newer-focus-before-ack") {
      const field = f.find("textarea", node => node.owner === owner && node.attributes.id === "session-intent-statement");
      assert.equal(field.port.matches(":disabled"), false);
      newerFocus = field.port; f.native.focus(newerFocus);
      assert.ok(newerFocus.isConnected && f.native.document.activeElement === newerFocus,
        "A real enabled current Sessions field receives the newer focus before ACK");
    }
    accepted.gate.resolve(); await pending; await f.settle();
    const afterAckRoute = h.store.route.get(), afterAckBlock = h.store.ui.focusBlockId;
    const originalTimers = [...f.timers].filter(([, timer]) => timer.delay === 0).map(([id]) => id);
    const currentSource = h.store.sourceOwnershipActive(x.before.source);
    const currentAuthority = h.store.authorizationScopeActive(x.before.authorization);
    assert.ok(currentSource && currentAuthority, "These focus/route cases do not withdraw Source or authority");
    if (boundary === "route-aba-after-handoff") {
      assert.equal(documentIdFromRoute(afterAckRoute), destination.document_id,
        "Healthy original ACK first reaches its exact Document before interruption");
      assert.equal(afterAckBlock, destination.ref_id); assert.equal(owner.isConnected, false);
      assert.ok(f.find("article", node => node.attributes["data-block-id"] === destination.ref_id).port.isConnected);
      await f.act(f.task("/activity"), "click", { button: 0 });
      assert.equal(new URL(h.store.route.get(), "https://fixture.invalid").pathname, "/activity");
      const work = f.tree().visible("a").filter(node => node.owner.tag === "forma-ui-audience-navigation"
        && documentIdFromRoute(node.attributes.href) === destination.document_id);
      assert.equal(work.length, 1); await f.act(work[0], "click", { button: 0 });
      assert.equal(h.store.route.get(), afterAckRoute, "The real Work link returns to the same exact route A");
      assert.equal(h.store.projection.get().documentId, destination.document_id);
      assert.ok(f.find("article", node => node.attributes["data-block-id"] === destination.ref_id).port.isConnected);
      // No artificial pointer/focus event or route setter is used. Ordinary
      // navigation (including its own native focus) supplies the real ABA.
    }
    const focusBefore = f.native.nativeFocus.length, scrollBefore = f.native.nativeScroll.length;
    for (const id of originalTimers) {
      const timer = f.timers.get(id); if (!timer) continue;
      f.timers.delete(id); timer.callback();
    }
    const effects = {
      focus: f.native.nativeFocus.slice(focusBefore).filter(row => row.node.attributes["data-block-id"] === destination.ref_id),
      scroll: f.native.nativeScroll.slice(scrollBefore).filter(row => row.node.attributes["data-block-id"] === destination.ref_id),
    };
    const focusedOriginal = f.native.document.activeElement?.getAttribute?.("data-block-id") === destination.ref_id;
    await fSessionNoExtraEffects(x);
    t.diagnostic("C_SESSIONS_DESTINATION_FOCUS " + JSON.stringify({ locale, boundary, afterAckRoute, afterAckBlock,
      route: h.store.route.get(), originalAcceptance: accepted.receipt.appended[0].eventId,
      originalQueuedTasks: originalTimers.length, sourceCurrent: currentSource, authorityCurrent: currentAuthority,
      originalFocusEffects: effects.focus.length, originalScrollEffects: effects.scroll.length, focusedOriginal,
      newerFieldFocusedBeforeAck: Boolean(newerFocus), executionSubmitted: false }));
    if (boundary === "healthy") {
      assert.equal(documentIdFromRoute(afterAckRoute), destination.document_id); assert.equal(afterAckBlock, destination.ref_id);
      assert.equal(effects.focus.length, 1, "An uninterrupted original handoff still focuses its exact current native article once");
      assert.equal(effects.scroll.length, 1, "An uninterrupted original handoff still reveals its exact native article once");
      assert.equal(focusedOriginal, true);
      if (locale === "ja") assert.equal(effects.scroll[0].args[0].behavior, "auto",
        "The exact healthy reveal honors the actual finite reduced-motion preference");
    } else {
      assert.equal(effects.focus.length, 0, "The old task cannot focus this original target after a newer interaction");
      assert.equal(effects.scroll.length, 0, "The old task cannot scroll this original target after a newer interaction");
      if (boundary === "newer-focus-before-ack") {
        assert.equal(afterAckRoute, "/sessions", "A positive acceptance is not permission to leave a newer current field");
        assert.equal(afterAckBlock, ""); assert.ok(owner.isConnected);
        assert.ok(f.find("textarea", node => node.owner === owner && node.attributes.id === "session-intent-statement").port.isConnected);
      } else assert.equal(h.store.route.get(), afterAckRoute);
    }
  } finally { accepted.gate.resolve(); await pending; }
});

// Disclosed native geometry only, borrowing the existing ProjectRail fixture's
// rect/viewport convention. The complete renderer, controls, focus and Store
// are unchanged. This is a 1440px finite port, not measured browser geometry.
async function cSessionWideNative(t, f) {
  const nativeWindow = ports.windowPort, nativeDocument = ports.documentPort;
  const oldDraw = f.draw, oldRect = f.host.getBoundingClientRect;
  assert.equal(nativeWindow.innerWidth, 790, "The unchanged full-page fixture begins at its disclosed default width");
  assert.equal(oldRect.call(f.host).width, 790);
  let committedShell = null;
  const railClosest = new Map();
  const saved = { width: nativeWindow.innerWidth, clientWidth: nativeDocument.documentElement.clientWidth,
    visualWidth: nativeWindow.visualViewport.width, media: nativeWindow.matchMedia };
  const rect = height => ({ left: 0, top: 0, right: 1440, bottom: height, width: 1440, height });
  nativeWindow.innerWidth = 1440; nativeWindow.visualViewport.width = 1440; nativeDocument.documentElement.clientWidth = 1440;
  nativeWindow.matchMedia = query => query === "(max-width: 47.99rem)" || query === "(max-width: 75rem), (max-height: 37.5rem)"
    ? { media: query, matches: false, addEventListener() {}, removeEventListener() {} } : saved.media(query);
  f.host.getBoundingClientRect = () => rect(882);
  f.draw = () => {
    const markup = oldDraw();
    const tree = f.tree(), shells = tree.visible("div").filter(node => node.owner === f.host
      && String(node.attributes.class ?? "").split(/\s+/u).includes("app-shell"));
    assert.equal(shells.length, 1, "One actual committed Shell owns the native geometry");
    committedShell = shells[0].port; committedShell.getBoundingClientRect = () => rect(882);
    for (const rail of f.components().filter(component => component.tag === "forma-project-rail")) {
      const row = tree.nodes.find(node => node.component === rail);
      let ancestor = row?.parent; while (ancestor && ancestor !== shells[0]) ancestor = ancestor.parent;
      assert.equal(ancestor, shells[0]); assert.equal(rail.store, f.store);
      if (railClosest.has(rail)) continue;
      const original = rail.closest, descriptor = Object.getOwnPropertyDescriptor(rail, "closest");
      railClosest.set(rail, { original, descriptor });
      // Reuse project-rail-native-fixture's exact committed native ancestor.
      // During willUpdate the shared focus port cannot reconstruct literal
      // ancestry; other selectors and every real component handler stay intact.
      rail.closest = selector => selector === ".app-shell" && rail.isConnected
        ? committedShell : original.call(rail, selector);
    }
    return markup;
  };
  t.after(() => {
    for (const [rail, { descriptor }] of railClosest) {
      if (descriptor) Object.defineProperty(rail, "closest", descriptor); else delete rail.closest;
    }
    f.draw = oldDraw; f.host.getBoundingClientRect = oldRect; nativeWindow.innerWidth = saved.width;
    nativeWindow.matchMedia = saved.media; nativeWindow.visualViewport.width = saved.visualWidth;
    nativeDocument.documentElement.clientWidth = saved.clientWidth;
  });
  await f.settle();
}

test("C Sessions collection handoff focuses its exact existing native button / ja", fIntelligenceOptions, async t => {
  const x = await fSessionPage(t, "ja", "collection"), { f, h } = x;
  await cSessionWideNative(t, f);
  // Establish the real expanded-rail preference before the acceptance gesture.
  // Opening a rail after ACK would be a newer interaction, not a healthy control.
  await f.act(f.task("/library"), "click", { button: 0 });
  const shell = f.find("div", node => node.owner === f.host
    && String(node.attributes.class ?? "").split(/\s+/u).includes("app-shell")).port;
  const rails = f.components().filter(component => component.tag === "forma-project-rail");
  assert.equal(rails.length, 1); assert.equal(rails[0].store, h.store); assert.ok(rails[0].isConnected);
  assert.equal(rails[0].closest(".app-shell"), shell, "The same native ancestor is available to render and the current click");
  assert.equal(shell.getBoundingClientRect().width, 1440); assert.equal(f.host.getBoundingClientRect().width, 1440);
  assert.equal(shell.getAttribute("data-nav-posture"), "expanded");
  assert.equal(ports.windowPort.matchMedia("(max-width: 47.99rem)").matches, false);
  assert.equal(ports.windowPort.matchMedia("(max-width: 75rem), (max-height: 37.5rem)").matches, false);
  const toggle = () => f.find("button", node => node.owner.tag === "forma-project-rail"
    && String(node.attributes.class).split(/\s+/u).includes("rail-collapse-toggle"));
  const expanded = () => {
    // This finite native port retains a Lit-bound boolean before DOM string
    // reflection. Qualify only this exact attribute; never coerce absent or
    // arbitrary application state, or replace the shared native getter.
    const raw = toggle().port.getAttribute("aria-expanded");
    assert.ok(raw === true || raw === false || raw === "true" || raw === "false");
    return String(raw);
  };
  if (expanded() === "true") await f.act(toggle(), "click", { button: 0 });
  assert.equal(expanded(), "false");
  await f.act(toggle(), "click", { button: 0 });
  assert.equal(expanded(), "true"); assert.equal(h.store.ui.projectRailCollapsed, false);
  assert.equal(f.tree().visible("forma-collection-tree").length, 1);
  await fIntelligenceChoose(f, F_INTELLIGENCE_ENTRIES[0]);
  x.owner = f.components().find(component => component.tag === "forma-sessions");
  assert.ok(x.owner?.isConnected && x.owner instanceof f.modules.get("src/components/forma-sessions.ts").FormaSessions);
  assert.equal(x.owner.store, h.store);
  const choice = await fSessionPrepare(x, "collection"), destination = choice.item.destination;
  assert.equal(destination.ref_id, "collection-studio");
  const accepted = h.briefReceipts.arm("accept", choice.event, true), pending = f.act(choice.button);
  try {
    await h.briefReceipts.reached(accepted); accepted.gate.resolve(); await pending; await f.settle();
    assert.equal(new URL(h.store.route.get(), "https://fixture.invalid").pathname, "/library");
    assert.equal(h.store.ui.focusCollectionId, destination.ref_id);
    const tree = f.tree(), rows = tree.visible("li").filter(node => node.attributes["data-collection-id"] === destination.ref_id);
    assert.equal(rows.length, 1); const row = rows[0], owner = row.owner;
    assert.equal(owner.tag, "forma-collection-tree"); assert.equal(owner.store, h.store); assert.ok(owner.isConnected);
    const buttons = tree.visible("button").filter(node => node.owner === owner
      && String(node.attributes.class).split(/\s+/u).includes("tree-name") && node.port.closest("[data-collection-id]") === row.port);
    assert.equal(buttons.length, 1); const button = buttons[0];
    assert.equal(button.port.tagName, "BUTTON"); assert.equal(button.attributes.type, "button");
    assert.equal(button.port.matches(":disabled"), false); assert.equal(button.attributes["aria-current"], "true");
    assert.equal(button.attributes.title, f.i18n.system("Filter project contents to {handle}", { handle: "studio-launch" }));
    assert.equal(button.port.closest("forma-collection-tree"), owner);
    const focusBefore = f.native.nativeFocus.length, scrollBefore = f.native.nativeScroll.length;
    for (const [id, timer] of [...f.timers]) if (timer.delay === 0) { f.timers.delete(id); timer.callback(); }
    const focus = f.native.nativeFocus.slice(focusBefore), scroll = f.native.nativeScroll.slice(scrollBefore);
    const focused = f.native.document.activeElement === button.port;
    await fSessionNoExtraEffects(x);
    t.diagnostic("C_SESSIONS_COLLECTION_NATIVE " + JSON.stringify({ locale: "ja", viewportPort: 1440, expandedBeforeAccept: true,
      originalCollection: destination.ref_id, originalAcceptance: accepted.receipt.appended[0].eventId,
      buttonFocus: focus.filter(value => value.node === button.port).length, rowFocus: focus.filter(value => value.node === row.port).length,
      buttonScroll: scroll.filter(value => value.node === button.port).length, focused, executionSubmitted: false }));
    assert.equal(focus.filter(value => value.node === button.port).length, 1, "The original current collection's native button receives focus");
    assert.equal(scroll.filter(value => value.node === button.port).length, 1);
    assert.equal(focus.some(value => value.node === row.port), false, "A non-focusable LI is not the focus target");
    assert.equal(focused, true);
  } finally { accepted.gate.resolve(); await pending; }
});

test("C Sessions original removed target cannot navigate after its real acceptance / en", fIntelligenceOptions, async t => {
  const x = await fSessionPage(t, "en"), { f, h, owner } = x;
  const choice = await fSessionPrepare(x, "thread"), destination = choice.item.destination;
  const accepted = h.briefReceipts.arm("accept", choice.event, true), pending = f.act(choice.button);
  try {
    await h.briefReceipts.reached(accepted); assert.equal(accepted.delivered, false);
    const beforeRemoval = await h.history();
    assert.deepEqual(beforeRemoval, [...x.before.history, ...h.briefReceipts.appended()]);
    await h.external("BlockRemoved", { block_id: destination.ref_id, document_id: destination.document_id, project_id: h.a });
    const history = await h.history(), removed = history.at(-1);
    assert.equal(removed.type, "BlockRemoved"); assert.equal(removed.payload.block_id, destination.ref_id);
    assert.equal(removed.sequence, beforeRemoval.at(-1).sequence + 1); assert.deepEqual(history.slice(0, -1), beforeRemoval);
    await h.store.refreshEvents({ fromStart: true }); await f.settle();
    assert.ok(owner.isConnected && h.store.sourceOwnershipActive(x.before.source) && h.store.authorizationScopeActive(x.before.authorization));
    assert.equal(h.store.projection.get().libraryBlocks.some(value => value.id === destination.ref_id), false);
    assert.equal(h.store.route.get(), "/sessions"); assert.equal(accepted.delivered, false);
    accepted.gate.resolve(); await pending; await fSessionFinishOriginalTimers(f);
    await h.navigationResumeReads.settleOriginalRequests(); await f.settle(); await h.worker.drainBackground();
    assert.deepEqual(await h.history(), history, "Only the original exact receipts and explicitly observed external removal exist");
    assert.deepEqual(h.counts(), x.before.counts);
    assert.deepEqual(h.requests.slice(x.before.requests).filter(row => (row.init.method ?? "GET") !== "GET"
      && !h.navigationResumeReads.isReadOnlyResume(row) && !h.briefReceipts.isOriginal(row)), []);
    assert.equal(h.store.events.get().filter(event => event.eventId === accepted.receipt.appended[0].eventId).length, 1);
    assert.equal(h.store.events.get().filter(event => event.eventId === removed.eventId).length, 1);
    t.diagnostic("C_SESSIONS_REMOVED_DESTINATION " + JSON.stringify({ originalTarget: destination.ref_id,
      originalAcceptance: accepted.receipt.appended[0].eventId, removed: removed.eventId, route: h.store.route.get(),
      sourceCurrent: h.store.sourceOwnershipActive(x.before.source), originalAuthorityCurrent: h.store.authorizationScopeActive(x.before.authorization),
      focusBlock: h.store.ui.focusBlockId, executionSubmitted: false }));
    assert.equal(h.store.route.get(), "/sessions", "An accepted original does not authorize arrival at a removed target");
    assert.equal(h.store.ui.focusBlockId, ""); assert.ok(owner.isConnected);
  } finally { accepted.gate.resolve(); await pending; }
});

// Separate default-false opt-in for one exact Not now gesture. The original
// compose/accept receipt observer and all of its admission rules are unchanged.
function cSessionIgnoreReceiptAccounting(t, h, admit) {
  const prior = h.transport, original = request => prior ? prior(request) : h.worker.request(request.url, request.init);
  let record = null;
  const exact = request => Boolean(record?.receipt && request === record.request && request.init === record.init
    && request.url === "/api/events" && request.init.method === "POST" && request.init.body === record.bytes
    && JSON.stringify(request.body) === record.bytes);
  const execute = async request => {
    assert.ok(record && !record.request, "One separately armed exact Ignore request");
    record.request = request; record.init = request.init; record.bytes = request.init.body;
    assert.ok(h.requests.includes(request)); assert.equal(h.store.route.get(), record.route);
    assert.equal(h.store.session.get().user.userId, record.actor); assert.equal(h.store.session.get().projectContext == null, true);
    assert.ok(h.store.sourceOwnershipActive(record.source) && h.store.authorizationScopeActive(record.authorization));
    assert.deepEqual({ projectId: h.store.projection.get().projectId, documentId: h.store.projection.get().documentId }, record.scope);
    const history = await h.history(), financial = h.counts(), input = JSON.parse(record.bytes);
    assert.deepEqual(Object.keys(input).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
    assert.equal(input.action, "append"); assert.equal(input.clientId, "web:lit");
    assert.equal(input.expectedSequence, history.at(-1).sequence);
    assert.equal(record.event.type, "BriefItemIgnored"); assert.deepEqual(input.event, record.event); assert.deepEqual(input.events, [record.event]);
    const response = await h.worker.request(request.url, request.init), body = await response.clone().json();
    assert.equal(response.status, 200); assert.equal(response.bodyUsed, false);
    assert.deepEqual(Object.keys(body).sort(), ["appended", "head", "rejected"]); assert.deepEqual(body.rejected, []);
    assert.equal(body.appended.length, 1); const event = body.appended[0];
    assert.equal(event.type, "BriefItemIgnored"); assert.deepEqual(event.payload, record.event.payload);
    assert.equal(event.streamId, h.worker.streamId); assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit");
    assert.ok(event.eventId && event.correlationId); assert.equal(event.sequence, input.expectedSequence + 1); assert.equal(body.head, event.sequence);
    await h.worker.drainBackground(); assert.deepEqual(await h.history(), [...history, event]); assert.deepEqual(h.counts(), financial);
    assert.equal(request.init, record.init); assert.equal(request.init.body, record.bytes); assert.equal(JSON.stringify(request.body), record.bytes);
    assert.ok(h.store.sourceOwnershipActive(record.source) && h.store.authorizationScopeActive(record.authorization));
    assert.equal(h.store.session.get().user.userId, record.actor); await admit([event]);
    record.receipt = { appended: [event], head: body.head }; record.originalResponse = response;
    assert.equal(exact({ ...request }), false); assert.equal(exact({ ...request, init: { ...request.init } }), false);
    return response;
  };
  const transport = request => {
    if (request.url !== "/api/events" || request.init.method !== "POST" || request.body?.action !== "append"
      || request.body?.event?.type !== "BriefItemIgnored") return original(request);
    const pending = execute(request); pending.catch(error => { if (record) record.error = error; }); return pending;
  };
  h.transport = transport;
  t.after(() => { if (h.transport === transport) h.transport = prior; });
  return {
    arm(event) {
      assert.equal(record, null); assert.equal(event.type, "BriefItemIgnored"); assert.equal(h.store.route.get(), "/sessions");
      record = { event: structuredClone(event), route: h.store.route.get(), actor: h.store.session.get().user.userId,
        source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(),
        scope: { projectId: h.store.projection.get().projectId, documentId: h.store.projection.get().documentId } };
      return record;
    },
    receipt() {
      if (record?.error) throw record.error;
      assert.ok(record?.request, "The current enabled Not now dispatches its exact original Ignore, even when its navigation target is unavailable");
      assert.ok(record.receipt && exact(record.request)); return record.receipt;
    },
    isOriginal: exact,
  };
}

for (const boundary of ["healthy", "removed-target"])
test("C Sessions Not now keeps exact dismissal available / en / " + boundary, fIntelligenceOptions, async t => {
  const x = await fSessionPage(t, "en", "thread", { briefIgnoreReceiptAccounting: true }), { f, h, owner } = x;
  const choice = await fSessionPrepare(x, "thread"), beforeItems = structuredClone(h.store.projection.get().brief.items);
  assert.ok(beforeItems.length > 1, "Other original suggestions make individual dismissal distinct from Dismiss suggestions");
  const composedHistory = await h.history(); assert.deepEqual(composedHistory, [...x.before.history, ...h.briefReceipts.appended()]);
  if (boundary === "removed-target") {
    await h.external("BlockRemoved", { block_id: choice.item.destination.ref_id, document_id: h.ad, project_id: h.a });
    const changed = await h.history(), removed = changed.at(-1);
    assert.deepEqual(changed.slice(0, -1), composedHistory); assert.equal(removed.type, "BlockRemoved");
    assert.equal(removed.payload.block_id, choice.item.destination.ref_id); assert.equal(removed.sequence, composedHistory.at(-1).sequence + 1);
    await h.store.refreshEvents({ fromStart: true }); await f.settle();
    assert.equal(h.store.projection.get().libraryBlocks.some(value => value.id === choice.item.destination.ref_id), false);
  }
  assert.ok(owner.isConnected && h.store.sourceOwnershipActive(x.before.source) && h.store.authorizationScopeActive(x.before.authorization));
  assert.deepEqual(h.store.projection.get().brief.items, beforeItems, "A removed target does not itself remove the stored suggestion row");
  const tree = f.tree(), target = tree.visible("button").filter(node => node.owner === owner
    && node.attributes["data-target-ref"] === choice.item.destination.ref_id && node.attributes["data-destination-view"] === "context-block");
  assert.equal(target.length, 1); const actions = target[0].parent, row = actions.parent;
  assert.equal(row.tag, "article"); assert.ok(String(row.attributes.class).split(/\s+/u).includes("brief-block"));
  const ignores = tree.visible("button").filter(node => node.owner === owner && node.parent === actions && node.text === "Not now");
  assert.equal(ignores.length, 1); assert.ok(ignores[0].port.isConnected); assert.equal(ignores[0].port.matches(":disabled"), false);
  const before = await h.history(), route = h.store.route.get(), selection = {
    block: h.store.ui.focusBlockId, collection: h.store.ui.focusCollectionId, compare: h.store.ui.compareOpen,
  };
  const event = { ...choice.event, type: "BriefItemIgnored" }, original = h.briefIgnoreReceipts.arm(event);
  await f.act(ignores[0]); const receipt = h.briefIgnoreReceipts.receipt();
  await h.navigationResumeReads.settleOriginalRequests(); await f.settle(); await h.worker.drainBackground();
  assert.equal(original.originalResponse.status, 200); assert.deepEqual(await h.history(), [...before, ...receipt.appended]);
  assert.deepEqual(h.counts(), x.before.counts);
  assert.deepEqual(h.requests.slice(x.before.requests).filter(request => (request.init.method ?? "GET") !== "GET"
    && !h.navigationResumeReads.isReadOnlyResume(request) && !h.briefReceipts.isOriginal(request) && !h.briefIgnoreReceipts.isOriginal(request)), []);
  assert.equal(h.store.projection.get().brief.brief_id, choice.event.payload.brief_id);
  assert.deepEqual(h.store.projection.get().brief.items, beforeItems.filter(item => item.item_id !== choice.item.item_id));
  assert.equal(f.tree().visible("button").some(node => node.owner === owner && node.attributes["data-target-ref"] === choice.item.destination.ref_id), false);
  assert.equal(h.store.route.get(), route); assert.equal(route, "/sessions");
  assert.deepEqual({ block: h.store.ui.focusBlockId, collection: h.store.ui.focusCollectionId, compare: h.store.ui.compareOpen }, selection);
  assert.ok(owner.isConnected && h.store.sourceOwnershipActive(x.before.source) && h.store.authorizationScopeActive(x.before.authorization));
  t.diagnostic("C_SESSIONS_IGNORE_ORIGINAL " + JSON.stringify({ boundary, originalTarget: choice.item.destination.ref_id,
    originalIgnore: receipt.appended[0].eventId, preservedOtherItems: beforeItems.length - 1, route, navigation: false, executionSubmitted: false }));
});


// One additive current-source boundary. A real original Worker receipt is
// held while an independently read canonical removal becomes current.
test("F Sessions confirmed blank whose original was removed cannot navigate / ja", fIntelligenceOptions, async t => {
  const x = await fSessionContinuationPage(t, "ja"), { f, h, owner } = x;
  const title = "Removed original A"; await fSessionDraftType(x, "blank", title);
  const a = h.sessionDraftReceipts.arm("blank", title), pending = f.act(fSessionDraftForm(x, "blank"), "submit");
  try {
    const receipt = await h.sessionDraftReceipts.reached(a), created = receipt.appended.find(event => event.type === "DocumentCreated");
    assert.ok(created); assert.equal(created.payload.document_id, a.documentId); assert.equal(a.delivered, false);
    const beforeRemoval = await h.history();
    assert.deepEqual(beforeRemoval, [...x.before.history, ...h.briefReceipts.appended(), ...receipt.appended]);
    await h.external("DocumentRemoved", { project_id: h.a, document_id: a.documentId, fallback_document_id: h.ad });
    const history = await h.history(), removal = history.at(-1);
    assert.equal(removal.type, "DocumentRemoved"); assert.equal(removal.payload.document_id, a.documentId);
    assert.equal(removal.sequence, created.sequence + 1); assert.deepEqual(history.slice(0, -1), beforeRemoval);
    await h.store.refreshEvents({ fromStart: true }); await f.settle();
    assert.ok(owner.isConnected && h.store.sourceOwnershipActive(a.source) && h.store.authorizationScopeActive(a.authorization));
    assert.equal(h.store.projection.get().projectId, h.a);
    assert.equal(h.store.projection.get().documents.some(value => value.id === a.documentId), false);
    assert.equal(h.store.events.get().filter(event => event.eventId === created.eventId).length, 1);
    assert.equal(h.store.events.get().filter(event => event.eventId === removal.eventId).length, 1);
    assert.equal(h.store.head.get(), removal.sequence);
    assert.equal(a.delivered, false, "The current source read did not deliver the original held command acknowledgement");
    assert.equal(h.store.route.get(), "/sessions"); assert.equal(fSessionDraftField(x, "blank").port.value, title);
    a.gate.resolve(); await pending; await f.settle(); await h.worker.drainBackground();
    t.diagnostic("F_SESSIONS_REMOVED_BLANK " + JSON.stringify({ original: a.documentId, originalCreation: created.eventId,
      removal: removal.eventId, originalAcknowledgementDelivered: a.delivered, route: h.store.route.get(),
      originalCurrentlyAvailable: h.store.projection.get().documents.some(value => value.id === a.documentId),
      sourceCurrent: h.store.sourceOwnershipActive(a.source), authorityCurrent: h.store.authorizationScopeActive(a.authorization),
      notice: h.store.ui.toast }));
    assert.equal(a.delivered, true);
    assert.equal(h.store.route.get(), "/sessions", "Confirmed creation does not authorize a removed original or another Document fallback");
    assert.ok(owner.isConnected);
    assert.equal(h.store.projection.get().documents.some(value => value.id === a.documentId), false);
    assert.equal(f.tree().visible("form").some(node => node.owner === owner && fSessionDraftClass(node, "blank-document-form")), false,
      "The acknowledged unchanged name is consumed, not offered as replacement creation");
    assert.equal(f.tree().visible("button").some(node => node.owner === owner
      && node.text === f.i18n.t("sessions.blank.createAnother", "Create another blank document")), false);
    const confirmed = f.i18n.system("{title} created as a blank document.", { title });
    const unavailable = f.i18n.system("That document is no longer available.");
    assert.notEqual(unavailable, "That document is no longer available.", "Reuse the existing Japanese unavailable-document message");
    assert.equal(h.store.ui.toast, confirmed + " " + unavailable);
    assert.deepEqual(await h.history(), history); assert.deepEqual(h.counts(), x.before.counts);
    assert.equal(h.store.events.get().filter(event => event.eventId === created.eventId).length, 1);
    assert.equal(h.store.events.get().filter(event => event.eventId === removal.eventId).length, 1);
    assert.equal(h.store.head.get(), removal.sequence);
    assert.equal(h.sessionDraftReceipts.records().length, 1);
    assert.deepEqual(h.requests.slice(x.before.requests).filter(row => (row.init.method ?? "GET") !== "GET"
      && !h.navigationResumeReads.isReadOnlyResume(row) && !h.briefReceipts.isOriginal(row)
      && !h.sessionDraftReceipts.isOriginal(row)), [], "No replacement creation, provider or paid command");
  } finally { a.gate.resolve(); await pending; }
});


// One finite native selection boundary, not a claim that input.select() moves
// physical browser focus. The existing actual updateComplete port is delayed;
// no Sessions method, source result or control is substituted.
test("F Sessions deferred blank selection yields to a newer same-page focus / en", fIntelligenceOptions, async t => {
  const release = sceneDeferred(); let restore = () => {};
  t.after(() => { release.resolve(); restore(); });
  const x = await fSessionPage(t, "en"), { f, h, owner } = x;
  const selected = fSessionBlankNative(t, x); await fSessionPrepare(x, "thread");
  const tick = f.tick; let held = false, returned = false;
  f.tick = async currentOwner => {
    const result = await tick(currentOwner);
    if (!held && currentOwner === owner && owner.isConnected
      && f.tree().visible("input").some(node => node.owner === owner && node.attributes.id === "blank-document-name")) {
      held = true; await release.promise; returned = true;
    }
    return result;
  };
  restore = () => { f.tick = tick; };
  const choice = f.find("button", node => node.owner === owner && fSessionDraftClass(node, "blank-choice"));
  f.native.focus(choice.port);
  const pending = f.act(choice);
  try {
    await untilScene(() => held, "The original blank gesture reaches its genuine deferred native update boundary");
    assert.equal(selected.length, 0); assert.equal(returned, false);
    assert.equal(fSessionDraftField(x, "blank").port.value, "Untitled study");
    const newer = fSessionDraftField(x, "intent").port, focusBefore = f.native.nativeFocus.length;
    assert.ok(newer.isConnected && !newer.matches(":disabled"));
    f.native.focus(newer);
    assert.equal(f.native.document.activeElement, newer); assert.equal(f.native.nativeFocus[focusBefore].node, newer);
    assert.equal(fSessionDraftField(x, "intent").port.value, "", "No name or intent edit is needed for this newer interaction");
    assert.equal(h.store.route.get(), "/sessions");
    assert.ok(h.store.sourceOwnershipActive(x.before.source) && h.store.authorizationScopeActive(x.before.authorization));
    release.resolve(); await pending; await f.settle();
    assert.equal(returned, true); await fSessionNoExtraEffects(x);
    t.diagnostic("F_SESSIONS_PREPARE_SELECTION " + JSON.stringify({ originalUpdateReached: held, originalUpdateReturned: returned,
      newerNativeFocusDelivered: true, deferredSelectCalls: selected.length, route: h.store.route.get(),
      submittedCreationsOrIntents: 0, evidence: "actual host plus finite update/focus/selection ports; not physical focus movement" }));
    assert.equal(selected.length, 0, "The original deferred selection cannot select the blank name after a newer current field took focus");
    assert.equal(h.store.route.get(), "/sessions"); assert.ok(owner.isConnected);
    assert.equal(fSessionDraftField(x, "blank").port.value, "Untitled study");
    assert.equal(fSessionDraftField(x, "intent").port.value, "");
  } finally { release.resolve(); restore(); await pending; }
});


// The guarded Library task entry retains its disposed route-owner record.
// Current ordinary artifact-card admission transfers its own fresh gesture to
// the Store. It must replace, never revive or borrow, the disposed entry lease.
// Reuse the original viewer Promise and finite native update boundary; do not
// claim a Sessions ready-artifact producer or held HTTP.
for (const boundary of ["healthy", "newer-field"])
test("C ordinary Library delayed artifact opening / en / " + boundary,
  { concurrency: false, timeout: 30_000 }, async t => {
    const release = sceneDeferred(), entered = sceneDeferred(); let restore = () => {}, restoreTrace = () => {};
    t.after(() => { release.resolve(); restore(); restoreTrace(); });
    const q = await fObjectArtifact(t, "short_story", "en"), { f, h, id, calls } = q;
    await finishCommandPreparation(f, f.act(f.task("/library"), "click", { button: 0 }));
    const library = f.components().find(owner => owner.tag === "forma-library" && owner.store === h.store);
    assert.ok(library?.isConnected); h.exact();
    assert.equal(libraryFocusFromRoute(h.store.route.get()), null);
    const entryNavigation = h.store.captureWorkspaceNavigationFocus(h.store.route.get());
    assert.ok(entryNavigation, "The actual guarded task entry transferred its one original route-focus lease");
    assert.equal(entryNavigation.current(), false, "A retained disposed entry record is not current permission");
    assert.equal(entryNavigation.focus.current(), false, "The completed task entry disposed its lease before the fresh artifact gesture");
    assert.equal(calls.length, 0);
    const listenerCounts = () => Object.fromEntries(["pointerdown", "keydown", "focusin"].map(type => [type, f.native.listeners(type)]));
    const originalListeners = listenerCounts(), history = await h.history(), counts = h.counts();
    const authorization = h.store.captureAuthorizationScope(), source = h.store.captureSourceOwnership();
    const card = f.find("a", node => node.owner === library && fObjectClassed(node, "library-artifact-open")
      && libraryFocusFromRoute(node.attributes.href)?.id === id);
    f.native.focus(card.port);
    // Observe, never replace, the existing modalPort's trace. Its entries mean
    // false -> true on a literal port; RendererPort creates new ports on each
    // draw. Keep raw entries and prove their precise owner/continuation below.
    const modalObservations = [], oldPush = Object.getOwnPropertyDescriptor(f.trace, "push"), push = f.trace.push;
    f.trace.push = function (...values) {
      for (const value of values) if (value === "open:document-artifact-view") {
        const candidates = f.renderer.nodes.filter(node => node.tag === "dialog" && node.owner?.tag === "forma-document-artifacts"
          && node.owner.source === "library" && fObjectClassed(node, "document-artifact-view") && node.open);
        const node = candidates.length === 1 ? candidates[0] : null, previous = modalObservations.at(-1)?.node ?? null;
        const original = calls.findLast(call => call.owner === node?.owner && call.artifactId === id);
        modalObservations.push({ node, owner: node?.owner, pending: original?.pending, candidates: candidates.length,
          connected: Boolean(node?.isConnected), open: Boolean(node?.open), previous,
          previousConnected: previous?.isConnected ?? null, previousOpen: previous?.open ?? null, route: h.store.route.get() });
      }
      return Reflect.apply(push, this, values);
    };
    restoreTrace = () => { if (oldPush) Object.defineProperty(f.trace, "push", oldPush); else delete f.trace.push; };
    const assertModalPortContinuation = (records, original, start) => {
      const entries = f.trace.slice(start).filter(value => value === "open:document-artifact-view");
      assert.equal(records.length, entries.length, "Every raw modalPort entry has an unfiltered native-port observation");
      assert.equal(new Set(records.map(record => record.owner)).size, 1, "One actual viewer owner, not repeated application openings");
      assert.equal(new Set(records.map(record => record.pending)).size, 1, "Every entry belongs to the same original public viewer Promise");
      assert.ok(records.every(record => record.owner === original.owner && record.pending === original.pending
        && record.candidates === 1 && record.connected && record.open && record.route === h.store.route.get()));
      assert.equal(new Set(records.map(record => record.node)).size, records.length, "Each literal port is opened only once");
      assert.equal(records.filter(record => record.previous === null).length, 1, "One first entry into this original viewer");
      assert.ok(records.slice(1).every(record => record.previous !== record.node
        && record.previousConnected === false && record.previousOpen === true),
        "Later entries replace still-open but retired literal ports, not a native close/reopen cycle");
      assert.deepEqual(f.trace.slice(start).filter(value => value === "close:document-artifact-view"), [],
        "No actual native-port close is hidden by the redraw-continuation diagnosis");
      assert.equal(records.at(-1).node, original.owner.querySelector(".document-artifact-view"));
    };
    const tick = f.tick; let held = false;
    f.tick = async owner => {
      const result = await tick(owner), call = calls.find(value => value.owner === owner && !value.settled);
      if (!held && call && owner.isConnected && owner.store === h.store && owner.source === "library"
        && owner === library.querySelector("forma-document-artifacts")) {
        held = true; entered.resolve(); await release.promise;
      }
      return result;
    };
    restore = () => { f.tick = tick; };
    const traceStart = f.trace.length, activation = f.act(card, "click", { button: 0 });
    let ownFocus = Promise.resolve(), moved = null;
    try {
      await finishCommandPreparation(f, Promise.race([entered.promise, activation]));
      assert.equal(held, true, "The existing exact viewer reached its real updateComplete before native promotion");
      assert.equal(calls.length, 1);
      const call = calls[0], route = h.store.route.get(), pendingListeners = listenerCounts();
      assert.deepEqual(libraryFocusFromRoute(route), { kind: "artifact", id });
      assert.equal(projectTaskDocumentIdFromRoute(route), h.ad);
      assert.equal(artifactFocusOptionsFromRoute(route), null, "Use the ordinary card's existing route, not a synthesized command");
      const openingNavigation = h.store.captureWorkspaceNavigationFocus(route);
      assert.ok(openingNavigation?.routeCurrent(), "The actual card owns this exact Store-issued artifact-route receipt");
      assert.notEqual(openingNavigation.focus, entryNavigation.focus, "The card does not revive or borrow the disposed task-entry lease");
      assert.strictEqual(h.store.captureWorkspaceNavigationFocus(route, openingNavigation.focus)?.focus, openingNavigation.focus);
      assert.equal(h.store.captureWorkspaceNavigationFocus(route, entryNavigation.focus), null, "The disposed entry lease is not this artifact opening");
      assert.equal(call.owner.documentId, h.ad); assert.equal(call.artifactId, id); assert.equal(call.settled, false);
      assert.equal(f.trace.slice(traceStart).includes("open:document-artifact-view"), false);
      assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      if (boundary === "newer-field") {
        const search = f.find("input", node => node.owner.tag === "forma-ui-search" && node.owner.parentElement === library);
        assert.ok(search.port.isConnected && f.renderer.nodes.includes(search.port) && !search.port.matches(":disabled"));
        moved = search.port; f.native.focus(moved);
        assert.equal(f.native.document.activeElement, moved);
      } else {
        // Observe the original Promise, not a replacement viewer result. Native
        // focus in its own actually opened dialog is allowed before cleanup.
        ownFocus = call.pending.then(opened => {
          if (!opened) return;
          const button = f.find("button", node => node.owner === call.owner && fObjectClassed(node, "artifact-viewer-focus-toggle"));
          assert.equal(button.port.closest("dialog"), call.owner.querySelector(".document-artifact-view"));
          assert.equal(button.port.closest("dialog")?.open, true);
          assert.deepEqual(listenerCounts(), pendingListeners);
          f.native.focus(button.port);
          assert.deepEqual(listenerCounts(), pendingListeners, "Its exact own-dialog focus does not interrupt the pending local opening");
        });
        void ownFocus.catch(() => {});
      }
      const focusBefore = f.native.nativeFocus.length;
      release.resolve(); await finishCommandPreparation(f, activation);
      const opened = await finishCommandPreparation(f, call.pending); await ownFocus; await f.settle();
      await fObjectNoEffects(f, history, authorization); assert.deepEqual(h.counts(), counts); h.exact();
      assert.equal(h.store.route.get(), route); assert.equal(h.store.content.get()[q.contentRef], q.bytes);
      assert.equal(fObjectArtifactRevision(h.store.events.get(), id), 0); assert.equal(calls.length, 1);
      assert.deepEqual(listenerCounts(), originalListeners, "The locally owned opening lease is gone after settlement");
      const dialogs = f.tree().visible("dialog").filter(node => node.owner === call.owner
        && fObjectClassed(node, "document-artifact-view") && node.port?.open);
      const promotions = f.trace.slice(traceStart).filter(value => value === "open:document-artifact-view");
      t.diagnostic("C_LIBRARY_LOCAL_ARTIFACT_OPENING " + JSON.stringify({ boundary, held, originalArtifact: id,
        inheritedLease: false, opened, dialogs: dialogs.length, promotions: promotions.length,
        promotionMeaning: "raw modalPort false-to-true entries; not physical showModal count",
        distinctLiteralPorts: new Set(modalObservations.map(record => record.node)).size,
        retiredStillOpenPredecessors: modalObservations.filter(record => record.previousConnected === false && record.previousOpen === true).length,
        newerCurrentFieldFocused: Boolean(moved), pendingListeners, settledListeners: listenerCounts(),
        route, sourceAndFiscalUnchanged: true, exactPrivateBytes: true, executionSubmitted: false }));
      if (boundary === "newer-field") {
        assert.equal(opened, false); assert.deepEqual(promotions, []); assert.equal(dialogs.length, 0);
        assert.equal(f.native.nativeFocus.length, focusBefore, "No delayed viewer or main focus overrides the newer current field");
        assert.equal(f.native.document.activeElement, moved);
        assert.equal(f.tree().root.text.includes(f.i18n.t("artifact.delivery.exactChanged",
          "This exact output revision is no longer available. No review or export was performed.")), false,
          "A newer field is not evidence that the original output revision disappeared");
        assert.equal(modalObservations.length, 0, "The withdrawn original produced no transient native-port opening");
        // Only after every zero-old-effects assertion, make another actual
        // current card gesture. Same URL must not strand the quiet withdrawal.
        const retryCard = f.find("a", node => node.owner === library && fObjectClassed(node, "library-artifact-open")
          && libraryFocusFromRoute(node.attributes.href)?.id === id);
        assert.equal(retryCard.attributes.href, route);
        const retryTrace = f.trace.length;
        f.native.emit("pointerdown", retryCard.port); f.native.focus(retryCard.port);
        await finishCommandPreparation(f, f.act(retryCard, "click", { button: 0 }));
        assert.equal(calls.length, 2, "Only this new deliberate same-card gesture starts a second viewer opening");
        assert.equal(calls[0], call); assert.equal(call.result, false, "The withdrawn first Promise remains false");
        const retry = calls[1]; assert.notEqual(retry.pending, call.pending);
        assert.equal(retry.owner, call.owner); assert.equal(retry.artifactId, id);
        assert.equal(await finishCommandPreparation(f, retry.pending), true); await f.settle();
        await fObjectNoEffects(f, history, authorization); assert.deepEqual(h.counts(), counts); h.exact();
        assert.equal(h.store.route.get(), route);
        const retryNavigation = h.store.captureWorkspaceNavigationFocus(route);
        assert.ok(retryNavigation?.routeCurrent(), "The deliberate same-card retry owns its exact new Store route receipt");
        assert.notEqual(retryNavigation.focus, openingNavigation.focus, "The retry cannot revive the withdrawn first opening lease");
        assert.notEqual(retryNavigation.focus, entryNavigation.focus, "The retry cannot borrow the disposed task-entry lease");
        assert.strictEqual(h.store.captureWorkspaceNavigationFocus(route, retryNavigation.focus)?.focus, retryNavigation.focus);
        assert.equal(h.store.captureWorkspaceNavigationFocus(route, openingNavigation.focus), null);
        assert.equal(h.store.captureWorkspaceNavigationFocus(route, entryNavigation.focus), null);
        assert.equal(h.store.content.get()[q.contentRef], q.bytes); assert.equal(fObjectArtifactRevision(h.store.events.get(), id), 0);
        assert.equal(calls.length, 2); assert.deepEqual(listenerCounts(), originalListeners);
        const retriedDialogs = f.tree().visible("dialog").filter(node => node.owner === retry.owner
          && fObjectClassed(node, "document-artifact-view") && node.port?.open);
        assert.equal(retriedDialogs.length, 1); assertModalPortContinuation(modalObservations, retry, retryTrace);
        t.diagnostic("C_LIBRARY_EXPLICIT_SAME_CARD_RETRY " + JSON.stringify({ sameRoute: true, originalArtifact: id,
          originalWithdrawn: call.result === false, deliberateViewerCalls: calls.length, retryReturned: retry.result,
          currentDialogs: retriedDialogs.length, rawModalPortEntries: modalObservations.length,
          sourceAndFiscalUnchanged: true, exactPrivateBytes: true, executionSubmitted: false }));
      } else {
        assert.equal(opened, true); assert.equal(dialogs.length, 1); assertModalPortContinuation(modalObservations, call, traceStart);
        const button = f.find("button", node => node.owner === call.owner && fObjectClassed(node, "artifact-viewer-focus-toggle"));
        f.native.emit("keydown", button.port); await f.act(button); await f.settle();
        assert.equal(f.tree().visible("dialog").filter(node => node.owner === call.owner
          && fObjectClassed(node, "document-artifact-view") && node.port?.open).length, 1,
          "Normal current viewer interaction remains owned after the opening lease ends");
        await fObjectNoEffects(f, history, authorization);
      }
    } finally { release.resolve(); restore(); await activation; await ownFocus; restoreTrace(); }
  });


// C unknown blank continuation: actual current Sessions/Store and the existing
// RAM Worker. The original positive batch is observed, then its delivery alone
// is lost. Checks use original full GET responses; a found Document is never a
// replacement batch receipt. No provider/physical-browser evidence is claimed.
import { readEventPageWithHead as cUnknownBlankCanonicalPage } from "../worker/runtime.ts";

async function cUnknownBlankPage(t, locale) {
  const x = await fSessionContinuationPage(t, locale), { f, h } = x;
  const raw = "  Exact original study — 原本  ";
  await fSessionDraftType(x, "blank", raw);
  const a = h.sessionDraftReceipts.arm("blank", raw.trim()), prior = h.transport;
  let lost = 0;
  h.transport = async request => {
    const response = await prior(request);
    if (h.sessionDraftReceipts.isOriginal(request)) {
      assert.equal(response, a.originalResponse); assert.equal(response.status, 200); lost++;
      throw new TypeError("Finite loss of the original positive blank response");
    }
    return response;
  };
  const pending = f.act(fSessionDraftForm(x, "blank"), "submit");
  try {
    await h.sessionDraftReceipts.reached(a); a.gate.resolve(); await pending; await f.settle();
    await fSessionDraftEffects(x, a);
    assert.equal(lost, 1); assert.equal(a.receipt.appended.length, 2);
    assert.equal(a.receipt.appended[1].payload.document_id, a.documentId);
    assert.equal(h.store.route.get(), "/sessions");
    assert.equal(h.store.events.get().some(event => event.eventId === a.receipt.appended[1].eventId), false);
    assert.equal(fSessionDraftField(x, "blank").port.value, raw);
  } finally { a.gate.resolve(); await pending; h.transport = prior; }
  const acknowledgmentOwner = { authorizationKey: x.before.authorization.key, actorUserId: x.before.actor,
    projectId: h.a, sourceGeneration: x.before.source.generation };
  const unconfirmed = () => {
    const receipts = h.store.eventWriteAcknowledgments(acknowledgmentOwner).filter(value => value.action === "batch");
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].outcome, "unconfirmed");
    assert.deepEqual(receipts[0].committed, [], "A later GET is not the lost batch acknowledgment");
    return receipts[0];
  };
  unconfirmed();
  return { ...x, a, raw, unconfirmed };
}
const cBlankButton = (x, name) => x.f.find("button", node => node.owner === x.owner && fSessionDraftClass(node, name));
const cBlankOpen = x => x.f.tree().visible("button").filter(node => node.owner === x.owner && fSessionDraftClass(node, "blank-original-open"));
const cBlankStatus = (x, key) => x.f.tree().visible("p").some(node => node.owner === x.owner
  && node.attributes.role === "status" && node.text === x.f.i18n.t(key) + " " + x.f.i18n.t("next.sessions.recoveryLifetime"));
async function cBlankAct(x, button) {
  assert.ok(button.port.isConnected && x.f.renderer.nodes.includes(button.port));
  assert.equal(button.port.matches(":disabled"), false, "Only a current enabled native control is activated");
  x.f.native.emit("pointerdown", button.port); x.f.native.focus(button.port);
  await x.f.act(button, "click", { button: 0 }); await x.f.settle();
}
function cBlankRecoveryPresentation(x) {
  const { f, h, owner, a } = x, tree = f.tree();
  const inside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
  const forms = tree.visible("form").filter(node => node.owner === owner && fSessionDraftClass(node, "blank-document-form"));
  assert.equal(forms.length, 1, "Even after Discard, the original recovery keeps the existing real form layout owner");
  const form = forms[0]; assert.ok(form.port.isConnected && f.renderer.nodes.includes(form.port));
  const buttons = tree.visible("button").filter(node => node.owner === owner && inside(node, form));
  const status = tree.visible("p").filter(node => node.owner === owner && inside(node, form) && node.attributes.role === "status");
  assert.equal(status.length, 1, "One current status, not repeated simultaneous uncertainty regions");
  assert.ok(buttons.length >= 1 && buttons.length <= 3, "Check/Open and optional Discard never accumulate a Create control");
  assert.deepEqual(buttons.filter(node => node.attributes.type === "submit"), []);
  const check = buttons.filter(node => fSessionDraftClass(node, "blank-original-check"));
  const open = buttons.filter(node => fSessionDraftClass(node, "blank-original-open"));
  assert.equal(check.length, 1); assert.ok(open.length <= 1);
  const original = h.store.projection.get().documents.find(value => value.id === a.documentId && value.projectId === h.a && !value.removed);
  const title = "\u2068" + (original?.title ?? x.raw.trim()) + "\u2069";
  assert.equal(check[0].text.trim(), f.i18n.t("sessions.blank.checkOriginal", "Check original: {title}", { title }));
  if (open.length) {
    assert.equal(open[0].text.trim(), f.i18n.t("sessions.blank.openOriginal", "Open original: {title}", { title }));
    assert.equal(fSessionDraftClass(open[0], "primary"), true);
    assert.equal(fSessionDraftClass(check[0], "secondary"), true);
  } else assert.equal(fSessionDraftClass(check[0], "primary"), true);
  const fields = tree.visible("input").filter(node => node.owner === owner && inside(node, form) && node.attributes.id === "blank-document-name");
  assert.ok(fields.length <= 1);
  assert.equal(buttons.filter(node => fSessionDraftClass(node, "blank-document-discard")).length, fields.length,
    "Discard exists only while the current raw name exists; no hidden substitute input is retained");
}

async function cBlankNoEffects(x, history) {
  const { f, h, before, a } = x;
  await h.navigationResumeReads.settleOriginalRequests(); await f.settle(); await h.worker.drainBackground();
  assert.deepEqual(await h.history(), history, "Check/Open add no DocumentCreated, DocumentOpened, acceptance or other event");
  assert.deepEqual(h.counts(), before.counts);
  assert.equal(h.sessionDraftReceipts.records().length, 1);
  assert.equal(h.requests.filter(request => h.sessionDraftReceipts.isOriginal(request)).length, 1);
  assert.deepEqual(h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET"
    && !h.navigationResumeReads.isReadOnlyResume(request) && !h.briefReceipts.isOriginal(request)
    && !h.sessionDraftReceipts.isOriginal(request)), []);
  assert.equal(a.receipt.appended[1].payload.document_id, a.documentId);
  if (x.owner.isConnected && h.store.sourceOwnershipActive(x.before.source)) cBlankRecoveryPresentation(x);
}
// Observe one already-armed full GET only; no response/URL blanket exemption.
// A clone is read before the SAME original response is returned (finite latency).
function cBlankReadPort(t, x) {
  const { h } = x, prior = h.intercept, records = [];
  let armed = null;
  const intercept = async request => {
    if (!armed || !request.url.startsWith("/api/events?") || (request.init.method ?? "GET") !== "GET")
      return prior?.(request);
    const record = armed; armed = null; record.request = request;
    const url = new URL(request.url, "https://fixture.invalid");
    assert.equal(url.searchParams.get("after"), "0");
    assert.equal(url.searchParams.get("content"), "1");
    assert.equal(url.searchParams.get("profile"), null, "The existing complete full profile, not a filtered history");
    assert.ok(h.requests.includes(request)); assert.equal(request.init.body, undefined);
    const before = await h.history(), counts = h.counts();
    const canonical = record.failure ? null : await cUnknownBlankCanonicalPage(h.worker.env, h.worker.streamId, 0, 5000);
    const inherited = record.failure ? undefined : await prior?.(request);
    const response = record.failure ? Response.json({ error: "finite_read_unavailable" }, { status: 503 })
      : inherited ?? await h.worker.request(request.url, request.init);
    record.response = response; record.status = response.status;
    if (!record.failure) {
      assert.equal(response.status, 200);
      record.body = await response.clone().json();
      assert.ok(Array.isArray(record.body.events)); assert.equal(record.body.hasMore, false);
      assert.equal(response.bodyUsed, false);
      assert.equal(canonical.hasMore, false, "This bounded actual history fits the existing full page; no omitted page is assumed");
      for (const key of ["events", "head", "nextAfter", "hasMore"])
        assert.deepEqual(record.body[key], canonical[key], "The original full GET matches its actual full canonical page, not the filtered workspace view");
    } else assert.equal(response.status, 503, "Declared finite GET failure, never a fabricated successful read");
    assert.deepEqual(await h.history(), before); assert.deepEqual(h.counts(), counts);
    record.entered.resolve();
    if (record.gate) await record.gate.promise;
    record.delivered = true; return response;
  };
  h.intercept = intercept;
  t.after(() => { for (const record of records) record.gate?.resolve(); if (h.intercept === intercept) h.intercept = prior; });
  return {
    arm({ hold = false, failure = false } = {}) {
      assert.equal(armed, null);
      const record = { entered: sceneDeferred(), gate: hold ? sceneDeferred() : null, failure, request: null,
        response: null, body: null, delivered: false }; records.push(record); armed = record; return record;
    },
    records,
  };
}

// Additive command admission for the existing original blank owner. The
// current native controls and original Worker receipt ports remain unchanged.
function cBlankCommandField(x, raw, part = null) {
  const { f, owner } = x, tree = f.tree();
  const fields = tree.visible("input").filter(node => node.owner === owner && node.attributes.id === "blank-document-name");
  if (raw === null) { assert.equal(fields.length, 0, "Explicit local Discard removes the real name field"); return null; }
  assert.equal(fields.length, 1); const field = fields[0];
  assert.ok(owner.isConnected && field.port.isConnected && f.renderer.nodes.includes(field.port));
  assert.equal(field.port.owner, owner); assert.equal(field.port.matches(":disabled"), false);
  assert.equal(typeof field.handlers.input, "function"); assert.equal(typeof field.propertyParts.value, "string");
  if (part !== null) assert.equal(field.propertyParts.value, part, "Same current owner/template value part, not a replacement field");
  assert.equal(field.properties.value, raw); assert.equal(field.port.value, raw);
  return field.propertyParts.value;
}
// This is a presentation-only boundary while one proven original response is
// deliberately held. It does not call or relax the all-transport quiescence
// oracle; the unchanged strict join runs only after that same gate is released.
async function cBlankCommandPendingPresentation(x) {
  const { f, h, a } = x;
  assert.equal(a.delivered, false); assert.equal(a.receipt.status, 200);
  assert.deepEqual(h.sessionDraftReceipts.records(), [a]);
  assert.equal(h.sessionDraftReceipts.isOriginal(a.request), true);
  for (let attempt = 0; attempt < 8; attempt++) {
    await f.settle();
    for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
    await new Promise(setImmediate);
  }
  await f.settle(); await h.worker.drainBackground();
  assert.equal(a.delivered, false, "The real original positive response remains held, not settled or cancelled");
  assert.equal(h.navigationResumeReads.pendingOriginalCount(), 1,
    "Exactly the known original batch remains pending; this is not transport quiescence");
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 16).length, 0);
  assert.equal(f.frames.size, 0); assert.equal(f.requested, false);
}
async function cBlankCommandDeparture(t, x, state, raw, blocked) {
  const { f, h, owner, a } = x, locale = f.locale;
  assert.equal(h.store.route.get(), "/sessions"); assert.equal(owner.store, h.store);
  assert.equal(fSessionDraftField(x, "intent").port.value, "", "No independent intent confounds this blank-owner case");
  const part = cBlankCommandField(x, raw), history = await h.history(), counts = h.counts();
  const source = h.store.captureSourceOwnership(), authority = h.store.captureAuthorizationScope();
  const documentId = h.store.projection.get().documentId, title = h.store.projection.get().documentTitle;
  if (state === "discarded-B") {
    assert.equal(documentId, a.documentId, "The genuine full Check selected the exact original blank in the canonical projection");
    assert.equal(title, a.receipt.appended[1].payload.title);
    assert.equal(h.store.projection.get().blocks.length, 0, "The actual original blank is still empty; do not borrow the former Document's choices");
  } else { assert.equal(documentId, h.ad); assert.notEqual(documentId, a.documentId); }
  assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authority));
  const present = () => state === "pending-A" ? cBlankCommandPendingPresentation(x) : cSessionCommandSettle(f);
  await present();
  const requestsAt = h.requests.length, localEvents = JSON.stringify(h.store.events.get()), head = h.store.head.get();
  const trigger = f.find("button", node => node.owner === f.host && fObjectClassed(node, "command-trigger"));
  assert.ok(trigger.port.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port);
  const copy = commandDiscoveryCopy(locale); await openDiscoverySearch(f, copy.prepare);
  cBlankCommandField(x, raw, part);
  assert.equal(h.requests.length, requestsAt, "Opening/searching the palette does not read or replace the original blank");
  const row = f.find("button", node => node.owner === f.host && node.attributes.role === "option"
    && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === copy.prepare));
  assert.ok(row.port.isConnected && f.renderer.nodes.includes(row.port)); assert.equal(row.port.matches(":disabled"), false);
  const hint = row.children.filter(child => typeof child !== "string" && child.tag === "small");
  assert.equal(hint.length, 1); assert.equal(hint[0].text, [title, h.store.projection.get().projectName, copy.preparing].join(" · "));
  f.native.emit("pointerdown", row.port); f.native.focus(row.port);
  const focusAt = f.native.nativeFocus.length, scrollAt = f.native.nativeScroll.length;
  await f.act(row, "click", { button: 0 }); await present();
  const requests = h.requests.slice(requestsAt), tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.port?.open);
  assert.equal(h.store.ui.commandOpen, false);
  assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authority));
  assert.deepEqual(await h.history(), history); assert.deepEqual(h.counts(), counts);
  assert.equal(h.sessionDraftReceipts.records().length, 1);
  assert.equal(h.requests.filter(request => h.sessionDraftReceipts.isOriginal(request)).length, 1);
  assert.deepEqual(requests.filter(request => (request.init.method ?? "GET") !== "GET" && !h.navigationResumeReads.isReadOnlyResume(request)), [],
    "No replacement creation, intent, approval or provider command; only certified original free Resume may be POST");
  t.diagnostic("C_SESSIONS_BLANK_COMMAND_DEPARTURE " + JSON.stringify({ state, locale, originalDocumentId: a.documentId,
    receiptObservedByFixture: a.receipt.appended.map(event => event.eventId), originalDelivered: a.delivered,
    currentDocumentId: documentId, pendingOriginalTransports: h.navigationResumeReads.pendingOriginalCount(),
    route: h.store.route.get(), sessionsConnected: owner.isConnected, expectedBlocked: blocked, rawLength: raw?.length ?? null,
    dialogs: dialogs.map(node => node.attributes.class), subsequentRequests: requests.map(request => ({ url: request.url, method: request.init.method ?? "GET" })),
    evidence: "actual Shell/Sessions/Store/Worker receipt and finite current native ports; no physical-input or replacement-write claim" }));
  if (blocked) {
    assert.equal(h.store.route.get(), "/sessions", "Current pending/newer blank work must veto this departing command");
    assert.ok(owner.isConnected); assert.strictEqual(f.components().find(value => value.tag === "forma-sessions"), owner);
    cBlankCommandField(x, raw, part); assert.equal(dialogs.length, 0); assert.equal(requests.length, 0);
    assert.equal(JSON.stringify(h.store.events.get()), localEvents); assert.equal(h.store.head.get(), head);
    assert.equal(f.native.nativeFocus.slice(focusAt).some(call => call.node.owner?.tag === "forma-workspace"), false);
    assert.equal(f.native.nativeScroll.length, scrollAt);
  } else {
    assert.equal(h.store.route.get(), withDocumentInRoute("/", documentId, title)); assert.equal(documentIdFromRoute(h.store.route.get()), documentId);
    assert.equal(h.store.projection.get().documentId, documentId);
    assert.equal(owner.isConnected, false); assert.equal(dialogs.length, 1);
    const chooser = dialogs[0]; assert.ok(fObjectClassed(chooser, "next-format-dialog"));
    assert.equal(chooser.owner.tag, "forma-workspace"); assert.equal(chooser.owner.store, h.store);
    assert.ok(chooser.owner.isConnected && chooser.port.open);
    const inside = node => { for (let at = node; at; at = at.parent) if (at === chooser) return true; return false; };
    assert.equal(tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && node.component?.isConnected && !node.hiddenBy && inside(node)).length, 7);
  }
}

test("C Sessions original blank command departure / pending A / en", { ...fIntelligenceOptions, timeout: 120_000 }, async t => {
  const base = await fSessionContinuationPage(t, "en"), { f, h } = base, raw = "  Original pending study A  ";
  await fSessionDraftType(base, "blank", raw);
  await cSessionCommandSettle(f); // Establish strict transport quiescence BEFORE starting the one held original.
  const a = h.sessionDraftReceipts.arm("blank", raw.trim()), pending = f.act(fSessionDraftForm(base, "blank"), "submit");
  const x = { ...base, a, raw };
  try {
    await h.sessionDraftReceipts.reached(a); await f.settle();
    assert.equal(a.delivered, false); assert.equal(a.receipt.status, 200);
    assert.equal(h.store.events.get().some(event => event.eventId === a.receipt.appended[1].eventId), false);
    const form = fSessionDraftForm(x, "blank"); assert.equal(form.attributes["aria-busy"], "true");
    await cBlankCommandDeparture(t, x, "pending-A", raw, true);
    assert.equal(a.delivered, false, "The command did not settle or cancel the held original response");
  } finally {
    a.gate.resolve(); await pending; await fSessionFinishOriginalTimers(f);
    await cSessionCommandSettle(f); await fSessionDraftEffects(x, a);
  }
});

for (const [state, locale] of [["unchanged-A", "en"], ["newer-B", "ja"], ["B-to-A", "ja"], ["discarded-B", "ja"]])
test("C Sessions original blank command departure / " + state + " / " + locale, { ...fIntelligenceOptions, timeout: 120_000 }, async t => {
  const x = await cUnknownBlankPage(t, locale), { h } = x;
  const originalAck = structuredClone(x.unconfirmed()), history = await h.history(), newer = "  New unsent study B — 保留  ";
  assert.ok(cBlankStatus(x, "sessions.blank.unconfirmed")); cBlankRecoveryPresentation(x);
  let raw = x.raw;
  if (state !== "unchanged-A") { await fSessionDraftType(x, "blank", newer); raw = newer; }
  if (state === "B-to-A") { await fSessionDraftType(x, "blank", x.raw); raw = x.raw; }
  if (state === "discarded-B") {
    const read = cBlankReadPort(t, x), record = read.arm();
    await cBlankAct(x, cBlankButton(x, "blank-original-check"));
    assert.equal(record.status, 200); assert.equal(record.delivered, true);
    assert.ok(cBlankStatus(x, "sessions.blank.openBlocked")); assert.deepEqual(x.unconfirmed(), originalAck);
    assert.equal(fSessionDraftField(x, "blank").port.value, newer);
    await cBlankAct(x, cBlankButton(x, "blank-document-discard")); raw = null;
    cBlankCommandField(x, null); cBlankRecoveryPresentation(x);
    assert.ok(cBlankStatus(x, "sessions.blank.originalAvailable"));
    assert.equal(cBlankButton(x, "blank-original-check").port.matches(":disabled"), false);
    assert.deepEqual(x.unconfirmed(), originalAck, "Local Discard and successful Check do not acknowledge the lost batch");
  }
  await cBlankNoEffects(x, history);
  await cBlankCommandDeparture(t, x, state, raw, state === "newer-B" || state === "B-to-A");
  assert.deepEqual(x.unconfirmed(), originalAck, "Leaving or refusing a view does not rewrite the original unconfirmed receipt");
  await cBlankNoEffects(x, history);
});

test("C Sessions unknown blank offers exact read-only Check then deliberate Open / en", fIntelligenceOptions, async t => {
  const x = await cUnknownBlankPage(t, "en"), { h, a } = x;
  const decoy = "c-unknown-blank-same-title-peer";
  await h.external("DocumentCreated", { project_id: h.a, document_id: decoy, title: x.raw.trim() });
  const history = await h.history(), read = cBlankReadPort(t, x), check = cBlankButton(x, "blank-original-check");
  const originalAck = x.unconfirmed(), route = h.store.route.get(), raw = fSessionDraftField(x, "blank").port.value;
  const first = read.arm(); await cBlankAct(x, check);
  assert.ok(first.delivered); assert.equal(h.store.route.get(), route);
  assert.equal(fSessionDraftField(x, "blank").port.value, raw);
  assert.deepEqual(x.unconfirmed(), originalAck);
  assert.ok(cBlankStatus(x, "sessions.blank.originalAvailable"));
  assert.equal(h.store.events.get().filter(event => event.type === "DocumentCreated"
    && event.payload.title === x.raw.trim()).length, 2, "Same-title peers are not identity proof");
  const open = cBlankOpen(x); assert.equal(open.length, 1);
  assert.equal(open[0].port.matches(":disabled"), false);
  await cBlankNoEffects(x, history);
  // The effects check settles/redraws the finite page. Reacquire the exact
  // current owner/class through the existing unique-control lookup.
  await cBlankAct(x, cBlankButton(x, "blank-original-open"));
  assert.equal(documentIdFromRoute(h.store.route.get()), a.documentId);
  assert.equal(h.store.projection.get().documentId, a.documentId);
  assert.notEqual(h.store.projection.get().documentId, decoy);
  assert.deepEqual(x.unconfirmed(), originalAck); await cBlankNoEffects(x, history);
  t.diagnostic("C_UNKNOWN_BLANK_EXACT_OPEN " + JSON.stringify({ original: a.documentId, decoy,
    readStatus: first.status, batchStillUnconfirmed: true, explicitOpen: true, extraWrites: 0 }));
});

test("C Sessions Check preserves newer B, A-B-A and unsent intent until deliberate local resolution / ja", fIntelligenceOptions, async t => {
  const x = await cUnknownBlankPage(t, "ja"), { f, h, a, owner } = x;
  const history = await h.history(), read = cBlankReadPort(t, x), originalAck = x.unconfirmed();
  const record = read.arm({ hold: true }), check = cBlankButton(x, "blank-original-check");
  const pending = cBlankAct(x, check); let moved = null;
  try {
    await record.entered.promise;
    assert.equal(cBlankOpen(x).length, 0, "Open eligibility is withdrawn while the current read is pending");
    await fSessionDraftType(x, "blank", "  New B — 保留  ");
    await fSessionDraftType(x, "intent", "   ");
    moved = fSessionDraftField(x, "intent").port; f.native.focus(moved);
    const focusBefore = f.native.nativeFocus.length;
    record.gate.resolve(); await pending;
    assert.equal(fSessionDraftField(x, "blank").port.value, "  New B — 保留  ");
    assert.equal(fSessionDraftField(x, "intent").port.value, "   ");
    assert.equal(f.native.document.activeElement, moved); assert.equal(f.native.nativeFocus.length, focusBefore);
    assert.equal(cBlankOpen(x).length, 1); assert.equal(cBlankOpen(x)[0].port.matches(":disabled"), true);
    assert.ok(cBlankStatus(x, "sessions.blank.openBlocked"));
    await fSessionDraftType(x, "blank", x.raw);
    assert.equal(cBlankOpen(x)[0].port.matches(":disabled"), true, "Equal text cannot erase the newer raw-input revision");
    await cBlankAct(x, cBlankButton(x, "blank-document-discard"));
    assert.equal(f.tree().visible("input").some(node => node.owner === owner && node.attributes.id === "blank-document-name"), false);
    assert.equal(fSessionDraftField(x, "intent").port.value, "   ");
    assert.equal(cBlankOpen(x)[0].port.matches(":disabled"), true, "Discard name does not discard even whitespace intent");
    await fSessionDraftType(x, "intent", "");
    assert.equal(cBlankOpen(x)[0].port.matches(":disabled"), false);
    assert.deepEqual(x.unconfirmed(), originalAck); await cBlankNoEffects(x, history);
    await cBlankAct(x, cBlankOpen(x)[0]);
    assert.equal(documentIdFromRoute(h.store.route.get()), a.documentId);
    assert.deepEqual(x.unconfirmed(), originalAck); await cBlankNoEffects(x, history);
  } finally { record.gate.resolve(); await pending; }
});

test("C Sessions original removed before Check is not replaced by a same-title document / fr", fIntelligenceOptions, async t => {
  const x = await cUnknownBlankPage(t, "fr"), { f, h, a } = x;
  await h.external("DocumentCreated", { project_id: h.a, document_id: "c-unknown-blank-other", title: x.raw.trim() });
  await h.external("DocumentRemoved", { project_id: h.a, document_id: a.documentId });
  const history = await h.history(), read = cBlankReadPort(t, x), originalAck = x.unconfirmed();
  const record = read.arm(); await cBlankAct(x, cBlankButton(x, "blank-original-check"));
  assert.ok(record.delivered); assert.ok(record.body.events.some(event => event.type === "DocumentRemoved"
    && event.payload.document_id === a.documentId));
  assert.ok(cBlankStatus(x, "sessions.blank.originalAbsent")); assert.equal(cBlankOpen(x).length, 0);
  assert.equal(h.store.route.get(), "/sessions"); assert.equal(fSessionDraftField(x, "blank").port.value, x.raw);
  assert.equal(f.tree().visible("button").filter(node => node.owner === x.owner && node.attributes.type === "submit"
    && node.parent?.parent?.attributes.class === "blank-document-form").length, 0);
  const requests = h.requests.length;
  await f.act(fSessionDraftForm(x, "blank"), "submit");
  assert.equal(h.requests.length, requests, "The unchanged guarded form submit still cannot resend a removed unknown original");
  assert.deepEqual(x.unconfirmed(), originalAck); await cBlankNoEffects(x, history);
  await cBlankAct(x, cBlankButton(x, "blank-document-discard"));
  assert.equal(cBlankOpen(x).length, 0); assert.ok(cBlankButton(x, "blank-original-check").port.isConnected);
  assert.equal(f.tree().visible("button").some(node => node.owner === x.owner && fSessionDraftClass(node, "blank-choice")), false);
  await cBlankNoEffects(x, history);
});

test("C Sessions failed availability Check is retryable as a read and retires an older found result / ar", fIntelligenceOptions, async t => {
  const x = await cUnknownBlankPage(t, "ar"), { f, h } = x;
  const history = await h.history(), read = cBlankReadPort(t, x), originalAck = x.unconfirmed();
  const failed = read.arm({ failure: true }); await cBlankAct(x, cBlankButton(x, "blank-original-check"));
  assert.equal(failed.status, 503); assert.ok(cBlankStatus(x, "sessions.blank.checkUnavailable"));
  assert.equal(cBlankOpen(x).length, 0); assert.equal(fSessionDraftField(x, "blank").port.value, x.raw);
  const found = read.arm(); await cBlankAct(x, cBlankButton(x, "blank-original-check"));
  assert.equal(found.status, 200); assert.ok(cBlankStatus(x, "sessions.blank.originalAvailable"));
  assert.equal(cBlankOpen(x).length, 1); assert.equal(cBlankOpen(x)[0].port.matches(":disabled"), false);
  const failedAgain = read.arm({ failure: true, hold: true }), pending = cBlankAct(x, cBlankButton(x, "blank-original-check"));
  try {
    await failedAgain.entered.promise;
    // requestUpdate marks the finite page; f.act cannot settle until this
    // held handler returns. Commit its already-requested checking render.
    await f.tick(x.owner);
    assert.equal(failedAgain.delivered, false, "The same availability response remains held during the render");
    assert.equal(cBlankOpen(x).length, 0, "Starting a newer Check removes old Open eligibility before its response");
    failedAgain.gate.resolve(); await pending;
    assert.ok(cBlankStatus(x, "sessions.blank.checkUnavailable")); assert.equal(cBlankOpen(x).length, 0);
    assert.equal(h.store.route.get(), "/sessions"); assert.equal(fSessionDraftField(x, "blank").port.value, x.raw);
    assert.deepEqual(x.unconfirmed(), originalAck); await cBlankNoEffects(x, history);
  } finally { failedAgain.gate.resolve(); await pending; }
});

for (const boundary of [{ locale: "en", kind: "source" }, { locale: "ja", kind: "route" }])
test("C Sessions old original Check yields to current " + boundary.kind + " / " + boundary.locale, fIntelligenceOptions, async t => {
  const x = await cUnknownBlankPage(t, boundary.locale), { f, h, owner } = x;
  const history = await h.history(), read = cBlankReadPort(t, x), record = read.arm({ hold: true });
  const pending = cBlankAct(x, cBlankButton(x, "blank-original-check"));
  let restorePolicy = () => {};
  try {
    await record.entered.promise; assert.equal(record.status, 200); assert.equal(record.delivered, false);
    if (boundary.kind === "source") {
      const env = h.worker.env, key = "FORMA_PILOT_COHORT_ID", had = Object.hasOwn(env, key), previous = env[key];
      env[key] = "synthetic-missing-c-original-check-cohort";
      restorePolicy = () => { if (had) env[key] = previous; else delete env[key]; };
      await assert.rejects(h.store.refreshEvents({ fromStart: true }), /Event stream returned 403/u);
      await f.settle();
      assert.equal(h.store.sourceOwnershipActive(x.before.source), false);
      assert.deepEqual(h.store.events.get(), []); assert.deepEqual(h.store.content.get(), {});
    } else {
      await registerCalmFullPageComponents(f, ["forma-activity"]);
      f.nativeHistoryLocation = h.location;
      await f.settle();
      assert.ok(cBlankStatus(x, "sessions.blank.checkingOriginal")); assert.equal(cBlankOpen(x).length, 0);
      const beforeRequests = h.requests.length, beforeEvents = JSON.stringify(h.store.events.get()), beforeHead = h.store.head.get();
      const acknowledgment = x.unconfirmed(), activity = f.task("/activity"), destination = activity.attributes.href;
      assert.equal(destination, withProjectTaskDocumentInRoute("/activity", h.ad, "/sessions"));
      f.native.emit("pointerdown", activity.port); f.native.focus(activity.port);
      await f.act(activity, "click", { button: 0 }); await f.settle();
      assert.equal(h.store.route.get(), "/sessions", "An active original Check still owns an ordinary departure");
      assert.ok(owner.isConnected); assert.equal(fSessionDraftField(x, "blank").port.value, x.raw);
      assert.equal(h.requests.length, beforeRequests); assert.equal(JSON.stringify(h.store.events.get()), beforeEvents);
      assert.equal(h.store.head.get(), beforeHead); assert.equal(record.delivered, false);
      assert.deepEqual(x.unconfirmed(), acknowledgment); assert.equal(cBlankOpen(x).length, 0);
      assert.equal(h.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
      // Preserve the old Check's retirement proof using an external native
      // history event. This does not assert browser history/draft protection.
      assert.equal(f.native.listeners("popstate"), 1); ports.bindFixture(f);
      globalThis.history.pushState({}, "", destination);
      assert.equal(h.store.route.get(), "/sessions");
      assert.equal(h.location.pathname + h.location.search + h.location.hash, destination);
      f.native.emit("popstate"); assert.equal(h.store.route.get(), destination);
      await f.settle();
      assert.equal(new URL(h.store.route.get(), "https://fixture.invalid").pathname, "/activity");
      assert.ok(h.store.sourceOwnershipActive(x.before.source));
    }
    assert.equal(owner.isConnected, false);
    const route = h.store.route.get(), focus = f.native.nativeFocus.length, scroll = f.native.nativeScroll.length;
    record.gate.resolve(); await pending;
    assert.equal(h.store.route.get(), route); assert.equal(f.native.nativeFocus.length, focus); assert.equal(f.native.nativeScroll.length, scroll);
    assert.equal(f.tree().visible("button").some(node => fSessionDraftClass(node, "blank-original-open")), false);
    if (boundary.kind === "source") {
      assert.equal(f.tree().root.text.includes(x.raw.trim()), false, "The denied private title is not republished by the old Check");
      assert.deepEqual(h.store.events.get(), []); assert.deepEqual(h.store.content.get(), {});
    }
    await cBlankNoEffects(x, history);
  } finally { record.gate.resolve(); await pending; restorePolicy(); }
});


test("C recovery lifetime copy / Sessions Discard keeps exact unknown status and local recovery hint / ja", fIntelligenceOptions, async t => {
  const x = await cUnknownBlankPage(t, "ja"), { f, h, owner } = x;
  const hint = "このセッションページを離れると、元のドキュメントを確認・開くためのローカル操作は利用できなくなります。作成処理の取り消しや結果の確認にはなりません。";
  const originalStatus = f.i18n.t("sessions.blank.unconfirmed"), acknowledgment = x.unconfirmed(), history = await h.history();
  const raw = "  名称 B は未送信\n  "; await fSessionDraftType(x, "blank", raw);
  assert.equal(fSessionDraftField(x, "blank").port.value, raw);
  await cBlankNoEffects(x, history); const requests = h.requests.length;
  await cBlankAct(x, cBlankButton(x, "blank-document-discard"));
  assert.ok(owner.isConnected); assert.equal(h.store.route.get(), "/sessions");
  assert.equal(f.tree().visible("input").some(node => node.owner === owner && node.attributes.id === "blank-document-name"), false);
  assert.equal(cBlankOpen(x).length, 0);
  const check = cBlankButton(x, "blank-original-check");
  assert.ok(check.port.isConnected); assert.equal(check.port.matches(":disabled"), false);
  assert.equal(f.tree().visible("button").some(node => node.owner === owner && fSessionDraftClass(node, "blank-document-discard")), false);
  assert.equal(f.tree().visible("button").some(node => node.owner === owner && fSessionDraftClass(node, "blank-choice")), false);
  const tree = f.tree(), forms = tree.visible("form").filter(node => node.owner === owner && fSessionDraftClass(node, "blank-document-form"));
  assert.equal(forms.length, 1); assert.ok(forms[0].port.isConnected);
  const status = tree.visible("p").filter(node => node.owner === owner && node.parent === forms[0] && node.attributes.role === "status");
  assert.equal(status.length, 1, "One original status, not another notice panel");
  await cBlankNoEffects(x, history); assert.deepEqual(x.unconfirmed(), acknowledgment);
  assert.equal(h.requests.length, requests, "Discard/render does not automatically Check, Open, resend or replace");
  t.diagnostic("C_RECOVERY_LIFETIME_SESSIONS " + JSON.stringify({ locale: "ja", rawNameDiscarded: true,
    originalAcknowledgment: x.unconfirmed().outcome, exactOriginalCheckRetained: true, status: status[0].text,
    requestsAfterDiscard: h.requests.length - requests, evidence: "actual Sessions/Store/RAM Worker and finite native input/Discard" }));
  assert.equal(status[0].text, originalStatus + " " + hint, "Exact old uncertainty statement and exact localized lifetime suffix are both required");
  assert.equal(f.i18n.t("next.sessions.recoveryLifetime"), hint);
});


// The real full Library block editor's Back to Library action owns these
// two return-focus cases. This is not the separate preview/viewer #closeFocus.
for (const [locale, boundary] of [["ja", "healthy"], ["en", "newer-search"]])
test("C Library block editor Close return focus / " + locale + " / " + boundary, fIntelligenceOptions, async t => {
  const release = sceneDeferred(), entered = sceneDeferred(); let restore = () => {};
  t.after(() => { release.resolve(); restore(); });
  const entry = { locale, scope: "library", method: locale === "ja" ? "Enter" : "click", boundary: "healthy" };
  const x = await fDecisionPage(t, entry), { f, h, block, before } = x;
  await fDecisionCommand(x); const opened = await fDecisionEditor(x);
  await fIntelligenceNoCommands(f, before);
  const libraries = f.components().filter(owner => owner.tag === "forma-library");
  assert.equal(libraries.length, 1); const library = libraries[0];
  assert.ok(library instanceof f.modules.get("src/components/forma-library.ts").FormaLibrary);
  assert.ok(library.isConnected && library.store === h.store);
  assert.equal(opened.owner.blockId, block.id); assert.equal(opened.owner.closest("forma-library"), library);
  const tree = f.tree(), header = fDecisionOne(f, tree, "header", node => node.owner === opened.owner
    && fObjectClassed(node, "library-block-editor-header"), "Use the exact original current editor header");
  // As in the preserved Decision4 control, the finite child render does not
  // run the inherited static-copy localizer. Select the actual authored label,
  // not a fabricated translated button or replacement callback.
  const back = fDecisionOne(f, tree, "button", node => node.owner === opened.owner && c19NamingWithin(node, header)
    && node.text === "Back to Library", "The genuine editor supplies its current Close/return action");
  assert.equal(back.port.matches(":disabled"), false);
  const tick = f.tick; let held = false, returned = false;
  f.tick = async owner => {
    const result = await tick(owner);
    if (!held && owner === library && library.isConnected
      && new URL(h.store.route.get(), "https://fixture.invalid").pathname === "/library"
      && f.tree().visible("button").some(node => node.owner === library && node.attributes["data-context-controls-id"] === block.id)) {
      held = true; entered.resolve(); await release.promise; returned = true;
    }
    return result;
  };
  restore = () => { f.tick = tick; };
  f.native.emit("pointerdown", back.port); f.native.focus(back.port);
  const pending = f.act(back, "click", { button: 0 });
  try {
    await finishCommandPreparation(f, entered.promise); await f.settle();
    assert.equal(held, true, "The actual Library editor-exit restoration reaches its original updateComplete");
    assert.equal(returned, false); const route = h.store.route.get();
    assert.equal(new URL(route, "https://fixture.invalid").pathname, "/library");
    assert.equal(f.components().filter(owner => owner.tag === "forma-library").length, 1);
    assert.equal(f.components().find(owner => owner.tag === "forma-library"), library);
    assert.equal(f.tree().visible("form").some(node => fObjectClassed(node, "library-block-form")), false);
    assert.equal(f.tree().visible("dialog").some(node => fObjectClassed(node, "library-focus-dialog")), false);
    const currentTree = f.tree();
    const target = fDecisionOne(f, currentTree, "button", node => node.owner === library
      && node.attributes["data-context-controls-id"] === block.id, "The original decision's current Controls button is available for healthy return");
    assert.equal(target.port.matches(":disabled"), false); h.exact();
    assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === block.id), block);
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    let moved = null;
    if (boundary === "newer-search") {
      const search = fDecisionOne(f, currentTree, "input", node => node.owner.tag === "forma-ui-search"
        && node.owner.parentElement === library, "Use the current Library's actual shared native search input");
      assert.equal(search.port.matches(":disabled"), false); moved = search.port;
      f.native.focus(moved);
      assert.equal(f.native.document.activeElement, moved); assert.equal(f.native.nativeFocus.at(-1).node, moved);
      assert.equal(h.store.route.get(), route, "The newer field interaction does not change route or Source");
    }
    const focusBefore = f.native.nativeFocus.length;
    release.resolve(); await finishCommandPreparation(f, pending); await f.settle();
    assert.equal(returned, true); await fIntelligenceNoCommands(f, before); h.exact();
    assert.equal(h.store.route.get(), route); assert.ok(library.isConnected);
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === block.id), block);
    const focus = f.native.nativeFocus.slice(focusBefore);
    const original = focus.filter(({ node }) => node.owner === library && node.attributes["data-context-controls-id"] === block.id);
    t.diagnostic("C_LIBRARY_EDITOR_RETURN_FOCUS " + JSON.stringify({ locale, boundary, originalBlock: block.id,
      actualCloseReached: true, updateHeld: held, updateReturned: returned, route, sameLibraryOwner: true,
      newerCurrentSearchFocused: Boolean(moved), originalControlsFocusCalls: original.length,
      allLateFocusTargets: focus.map(({ node }) => ({ tag: node.tag, owner: node.owner?.tag,
        id: node.attributes.id ?? null, controlsId: node.attributes["data-context-controls-id"] ?? null })),
      sourceAndFinancialUnchanged: true, submittedCommands: 0,
      evidence: "actual Store/Worker/page and finite native update/focus ports; not physical browser focus certification" }));
    if (boundary === "healthy") {
      assert.equal(original.length, 1, "Uninterrupted Close focuses the exact original current Controls button once");
      assert.equal(original[0].node.tag, "button");
    } else {
      assert.equal(original.length, 0, "The old editor Close cannot take focus from the newer Library search");
      assert.equal(focus.length, 0, "Neither an old Controls target nor a fallback may replace that newer interaction");
    }
  } finally { release.resolve(); restore(); await pending; }
});


// A distinct actual preview Close path. Neither these two cases nor the
// editor pair substitute for the artifact child's synchronous opener restore.
for (const [locale, boundary] of [["ja", "healthy"], ["en", "newer-search"]])
test("C Library saved-block preview Close return focus / " + locale + " / " + boundary, fIntelligenceOptions, async t => {
  const release = sceneDeferred(), entered = sceneDeferred(); let restore = () => {};
  t.after(() => { release.resolve(); restore(); });
  const x = await fDecisionPage(t, { locale, scope: "library", method: "click", boundary: "healthy" });
  const { f, h, block, before } = x;
  await finishCommandPreparation(f, f.act(f.task("/library"), "click", { button: 0 })); h.exact();
  const libraries = f.components().filter(owner => owner.tag === "forma-library");
  assert.equal(libraries.length, 1); const library = libraries[0];
  assert.ok(library instanceof f.modules.get("src/components/forma-library.ts").FormaLibrary);
  assert.ok(library.isConnected && library.store === h.store);
  const card = fDecisionOne(f, f.tree(), "a", node => node.owner === library && fObjectClassed(node, "asset-focus-trigger")
    && libraryFocusFromRoute(node.attributes.href)?.kind === "block" && libraryFocusFromRoute(node.attributes.href)?.id === block.id,
  "The genuine saved decision card supplies its exact native preview opener");
  const href = card.attributes.href;
  f.native.emit("pointerdown", card.port); f.native.focus(card.port);
  assert.equal(f.native.document.activeElement, card.port);
  await finishCommandPreparation(f, f.act(card, "click", { button: 0 })); await f.settle();
  assert.deepEqual(libraryFocusFromRoute(h.store.route.get()), { kind: "block", id: block.id });
  assert.equal(h.store.route.get(), href);
  await fIntelligenceNoCommands(f, before);
  const tree = f.tree(), preview = fDecisionOne(f, tree, "dialog", node => node.owner === library
    && fObjectClassed(node, "library-focus-dialog") && node.attributes["aria-labelledby"] === "block-focus-title",
  "The original saved decision opens in the existing current native preview");
  assert.equal(preview.port.open, true);
  const subject = fDecisionOne(f, tree, "forma-context-block", node => c19NamingWithin(node, preview)
    && node.component?.block?.id === block.id, "The actual preview contains the exact current authored decision");
  assert.equal(subject.component.readOnly, true); assert.deepEqual(subject.component.block, block);
  const close = fDecisionOne(f, tree, "button", node => node.owner === library && c19NamingWithin(node, preview)
    && node.attributes["aria-label"] === f.i18n.t("projects.closePreview", "Close preview"),
  "Use the actual preview Close button, not the editor Back handler");
  assert.equal(close.port.matches(":disabled"), false);
  const tick = f.tick; let holding = true, held = 0, returned = 0;
  f.tick = async owner => {
    const result = await tick(owner);
    if (holding && owner === library && library.isConnected && !libraryFocusFromRoute(h.store.route.get())
      && new URL(h.store.route.get(), "https://fixture.invalid").pathname === "/library") {
      held++; entered.resolve(); await release.promise; returned++;
    }
    return result;
  };
  restore = () => { f.tick = tick; };
  f.native.emit("pointerdown", close.port); f.native.focus(close.port);
  const pending = f.act(close, "click", { button: 0 });
  try {
    await finishCommandPreparation(f, entered.promise); await f.settle();
    assert.ok(held > 0, "The actual preview-close continuation reaches its original Library updateComplete");
    assert.equal(returned, 0); const route = h.store.route.get();
    assert.equal(new URL(route, "https://fixture.invalid").pathname, "/library");
    assert.equal(libraryFocusFromRoute(route), null); assert.ok(library.isConnected);
    assert.equal(f.components().find(owner => owner.tag === "forma-library"), library);
    assert.equal(f.tree().visible("dialog").some(node => fObjectClassed(node, "library-focus-dialog")), false);
    const currentTree = f.tree();
    const target = fDecisionOne(f, currentTree, "a", node => node.owner === library && fObjectClassed(node, "asset-focus-trigger")
      && node.attributes.href === href, "The exact original href has one current healthy return target");
    assert.equal(target.port.matches(":disabled"), false);
    let moved = null;
    if (boundary === "newer-search") {
      const search = fDecisionOne(f, currentTree, "input", node => node.owner.tag === "forma-ui-search"
        && node.owner.parentElement === library, "A newer current shared Library search field receives focus");
      assert.equal(search.port.matches(":disabled"), false); moved = search.port; f.native.focus(moved);
      assert.equal(f.native.document.activeElement, moved); assert.equal(f.native.nativeFocus.at(-1).node, moved);
    }
    assert.equal(h.store.route.get(), route); h.exact();
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    const focusBefore = f.native.nativeFocus.length;
    holding = false; release.resolve(); await finishCommandPreparation(f, pending); await f.settle();
    assert.equal(returned, held); await fIntelligenceNoCommands(f, before); h.exact();
    assert.equal(h.store.route.get(), route); assert.ok(library.isConnected);
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === block.id), block);
    const focus = f.native.nativeFocus.slice(focusBefore);
    const original = focus.filter(({ node }) => node.owner === library && node.tag === "a" && node.attributes.href === href);
    t.diagnostic("C_LIBRARY_PREVIEW_RETURN_FOCUS " + JSON.stringify({ locale, boundary, originalBlock: block.id, originalHref: href,
      route, actualPreviewCloseReached: true, heldNativeUpdates: held, returnedNativeUpdates: returned,
      newerCurrentSearchFocused: Boolean(moved), originalOpenerFocusCalls: original.length,
      allLateFocusTargets: focus.map(({ node }) => ({ tag: node.tag, owner: node.owner?.tag, href: node.attributes.href ?? null })),
      sourceAndFinancialUnchanged: true, submittedCommands: 0,
      evidence: "actual page plus finite native Close/update/focus ports; not physical dialog close timing or browser focus certification" }));
    if (boundary === "healthy") assert.equal(original.length, 1, "Healthy preview Close restores only the exact original current opener");
    else {
      assert.equal(original.length, 0, "The old preview Close cannot reclaim focus from the newer Library search");
      assert.equal(focus.length, 0, "No old origin or same-href fallback may replace the newer interaction");
    }
  } finally { holding = false; release.resolve(); restore(); await pending; }
});


// C Library publisher completion: actual current Shell/Library/Store and the
// existing shared-organization RAM Worker. Only native form lifetime and response
// delivery timing are finite. No Store success, capability, or receipt is faked.
import { createHash as cLibraryPublisherCreateHash } from "node:crypto";

const cLibraryPublisherWithin = (node, parent) => {
  for (let at = node; at; at = at.parent) if (at === parent || at.port && at.port === parent.port) return true;
  return false;
};
const cLibraryPublisherSha = text => cLibraryPublisherCreateHash("sha256").update(text).digest("hex");

// The same-template/native-field principle is reused from nativeFormLifetime
// in workspace-settings-draft-completion. This opt-in extension keeps ordered
// repeated checkbox entries instead of collapsing their names into a Map.
// It changes neither the complete renderer nor any application method.
function cLibraryPublisherNativeForm(t, f, owner, { nextVersion = false, chooseInitialForm = null } = {}) {
  const originalDraw = f.draw, originalValue = f.renderer.value.bind(f.renderer);
  const NativeFormData = globalThis.FormData, records = [], resets = [], closes = [];
  const method = nextVersion ? "publishOrganizationContextPackageVersion" : "createOrganizationContextPackage";
  const formNodes = () => nextVersion ? f.tree().nodes.filter(node => node.tag === "form") : f.tree().visible("form");
  assert.ok(chooseInitialForm === null || nextVersion && typeof chooseInitialForm === "function");
  let retained = null, templates = [], drawing = false, selectedPath = null;
  const fieldsOf = form => f.tree().nodes.filter(node => node.owner === owner
    && cLibraryPublisherWithin(node, form) && ["input", "select", "textarea"].includes(node.tag) && node.attributes.name);
  const editable = node => {
    assert.ok(node.port?.isConnected && !node.hiddenBy && f.renderer.nodes.includes(node.port), "Actual current visible native field");
    assert.equal(Object.hasOwn(node.attributes, "disabled") || node.properties.disabled === true || node.port.disabled === true, false);
    assert.equal(Object.hasOwn(node.attributes, "readonly") || node.properties.readOnly === true, false);
    for (let at = node; at; at = at.parent) {
      assert.equal(Object.hasOwn(at.attributes ?? {}, "inert"), false);
      assert.equal(at.tag === "fieldset" && Object.hasOwn(at.attributes, "disabled"), false);
    }
  };
  const entries = record => record.fields.flatMap(field => {
    if (field.disabled || !field.node.isConnected || field.checkbox && !field.node.checked) return [];
    return [[field.name, String(field.checkbox ? field.defaultValue : field.node.value)]];
  });
  f.renderer.value = (part, current, path, caches) => {
    if (drawing && current === owner && part?.strings
      && part.values.some(value => typeof value === "function" && String(value).includes(method)))
      templates.push({ strings: part.strings, path });
    return originalValue(part, current, path, caches);
  };
  f.draw = () => {
    templates = []; drawing = true;
    let markup; try { markup = originalDraw(); } finally { drawing = false; }
    let forms = formNodes().filter(node => node.owner === owner
      && String(node.handlers.submit).includes(method));
    assert.equal(forms.length, templates.length, "Exact current publisher template and native form agree");
    if (chooseInitialForm) {
      // Only the first visible package choice uses card data. Retention thereafter
      // follows actual rendered path identity: positional map slots stay positional,
      // and an actual application repeat key is preserved without inventing one.
      if (selectedPath === null && forms.length) {
        const chosen = chooseInitialForm(forms), index = forms.indexOf(chosen);
        assert.ok(index >= 0, "Initial selection is one actual current package form");
        selectedPath = templates[index].path;
      }
      const indices = templates.flatMap((template, index) => template.path === selectedPath ? [index] : []);
      assert.ok(indices.length <= 1, "One exact actual template path");
      const index = indices[0];
      forms = index === undefined ? [] : [forms[index]];
      templates = index === undefined ? [] : [templates[index]];
    }
    assert.ok(forms.length <= 1);
    if (retained && (!owner.isConnected || !forms.length || retained.strings !== templates[0].strings || retained.path !== templates[0].path)) {
      retained.form.isConnected = false; retained.form.parentElement = null;
      if (retained.details) { retained.details.isConnected = false; retained.details.parentElement = null; }
      for (const field of retained.fields) { field.node.isConnected = false; field.node.parentElement = null; }
      retained = null;
    }
    if (!forms.length) return markup;
    const fresh = forms[0].port;
    let detailsNode = null;
    if (nextVersion) {
      for (let node = forms[0].parent; node; node = node.parent) if (node.tag === "details") { detailsNode = node; break; }
      assert.ok(detailsNode?.port && detailsNode.owner === owner);
      assert.equal(detailsNode.attributes.class, "library-context-next-version");
      assert.equal(Object.hasOwn(detailsNode.attributes, "open"), false, "The source does not force this disclosure open");
    }
    if (!retained) {
      retained = { form: fresh, strings: templates[0].strings, path: templates[0].path, fields: [], details: detailsNode?.port ?? null };
      const record = retained; records.push(record);
      if (nextVersion) {
        const details = record.details, originalRemove = details.removeAttribute.bind(details), originalSet = details.setAttribute.bind(details);
        let open = Boolean(details.open);
        // Exact native details reflection, scoped to this same template/form.
        // No handler or result is replaced; programmatic removal really closes it.
        Object.defineProperty(details, "open", { configurable: true, get: () => open, set(value) {
          open = Boolean(value); if (open) details.attributes.open = ""; else delete details.attributes.open;
        } });
        details.removeAttribute = name => { if (name === "open") { closes.push({ details, wasOpen: details.open }); details.open = false; } else originalRemove(name); };
        details.setAttribute = (name, value) => { if (name === "open") details.open = true; else originalSet(name, value); };
        const closest = record.form.closest.bind(record.form);
        record.form.closest = selector => selector === "details" ? record.details : closest(selector);
      }
      record.form.reset = () => {
        resets.push({ form: record.form, before: entries(record) });
        for (const field of record.fields) {
          field.node.value = field.defaultValue;
          if (field.checkbox) field.node.checked = field.defaultChecked;
        }
      };
    } else {
      for (const key of ["full", "handlers", "attributes", "properties"]) retained.form[key] = fresh[key];
      f.renderer.nodes[f.renderer.nodes.indexOf(fresh)] = retained.form;
    }
    if (nextVersion) {
      const details = retained.details, freshDetails = detailsNode.port, open = details.open;
      if (details !== freshDetails) {
        for (const key of ["full", "handlers", "attributes", "properties"]) details[key] = freshDetails[key];
        f.renderer.nodes[f.renderer.nodes.indexOf(freshDetails)] = details;
      }
      details.open = open; details.isConnected = true; details.parentElement = owner;
    }
    retained.form.isConnected = true; retained.form.parentElement = retained.details ?? owner;
    const form = formNodes().find(node => node.port === retained.form); assert.ok(form);
    const previous = new Map(retained.fields.map(field => [field.key, field]));
    retained.fields = fieldsOf(form).map(node => {
      assert.equal(node.tag, "input", "This bounded raw publisher form has native text and checkbox inputs only");
      assert.equal(Object.hasOwn(node.properties, "value"), false, "No replacement for controlled application fields");
      const checkbox = node.attributes.type === "checkbox";
      const name = String(node.attributes.name), defaultValue = String(node.attributes.value ?? (checkbox ? "on" : ""));
      const defaultChecked = Object.hasOwn(node.attributes, "checked");
      const key = JSON.stringify([name, checkbox, defaultValue]);
      let field = previous.get(key);
      if (field) {
        assert.equal(field.defaultChecked, defaultChecked, "Current unchanged source keeps the same native checkbox default");
        for (const property of ["full", "handlers", "attributes", "properties"]) field.node[property] = node.port[property];
        f.renderer.nodes[f.renderer.nodes.indexOf(node.port)] = field.node;
        previous.delete(key);
      } else {
        field = { key, name, node: node.port, checkbox, defaultValue, defaultChecked };
        field.node.value = defaultValue; if (checkbox) field.node.checked = defaultChecked;
      }
      field.disabled = Object.hasOwn(node.attributes, "disabled");
      for (let at = node.parent; at && at !== form; at = at.parent)
        field.disabled ||= at.tag === "fieldset" && Object.hasOwn(at.attributes, "disabled");
      field.node.isConnected = true; field.node.parentElement = retained.form;
      return field;
    });
    assert.equal(new Set(retained.fields.map(field => field.key)).size, retained.fields.length, "Exact distinct native control identities");
    for (const field of previous.values()) { field.node.isConnected = false; field.node.parentElement = null; }
    return markup;
  };
  t.mock.method(globalThis, "FormData", function NativePublisherFormData(form) {
    if (form === undefined) return new NativeFormData();
    const record = records.find(value => value.form === form);
    if (!record) return new NativeFormData(form);
    assert.ok(form.isConnected && owner.isConnected && retained === record, "FormData reads only the current exact real publisher form");
    const result = new NativeFormData(); for (const [name, value] of entries(record)) result.append(name, value); return result;
  });
  t.after(() => { f.draw = originalDraw; f.renderer.value = originalValue; });
  const current = ({ allowHidden = false } = {}) => {
    f.draw(); const matches = formNodes().filter(node => node.owner === owner && node.port === retained?.form && (allowHidden || !node.hiddenBy));
    assert.equal(matches.length, 1); return matches[0];
  };
  const fill = (name, selected) => {
    const form = current(), fields = fieldsOf(form), wanted = new Set(selected);
    const names = fields.filter(node => node.attributes.name === "packageName"); assert.equal(names.length, nextVersion ? 0 : 1);
    if (!nextVersion) {
      editable(names[0]); names[0].port.value = name;
      names[0].handlers.input?.call(owner, { type: "input", target: names[0].port, currentTarget: names[0].port });
      form.handlers.input?.call(owner, { type: "input", target: names[0].port, currentTarget: form.port });
    }
    const checkboxes = fields.filter(node => node.attributes.name === "packageBlock");
    assert.ok(checkboxes.length); assert.ok([...wanted].every(id => checkboxes.some(node => node.attributes.value === id)));
    for (const node of checkboxes) {
      editable(node); assert.equal(node.attributes.type, "checkbox");
      node.port.checked = wanted.has(String(node.attributes.value));
      node.handlers.change?.call(owner, { type: "change", target: node.port, currentTarget: node.port });
      form.handlers.change?.call(owner, { type: "change", target: node.port, currentTarget: form.port });
    }
    if (!nextVersion) assert.ok(name.length > 0 && name.length <= Number(names[0].attributes.maxlength), "Genuine required/max-length native text admission");
    return form;
  };
  const raw = options => [...new FormData(current(options).port).entries()];
  const submit = () => {
    const form = current(), buttons = f.tree().visible("button").filter(node => node.owner === owner
      && cLibraryPublisherWithin(node, form) && node.attributes.type === "submit");
    assert.equal(buttons.length, 1); assert.equal(Object.hasOwn(buttons[0].attributes, "disabled"), false);
    fieldsOf(form).forEach(editable);
    if (nextVersion) assert.ok(new FormData(form.port).getAll("packageBlock").length, "Only the nonempty original selection is submitted");
    else assert.ok(new FormData(form.port).get("packageName"));
    return f.act(form, "submit", { submitter: buttons[0].port });
  };
  const disclosure = () => {
    assert.equal(nextVersion, true); current({ allowHidden: true });
    const matches = f.tree().nodes.filter(node => node.tag === "details" && node.port === retained.details);
    assert.equal(matches.length, 1); return matches[0];
  };
  const toggleDisclosure = () => {
    const details = disclosure(), summaries = f.tree().visible("summary").filter(node => node.parent?.port === details.port);
    assert.equal(summaries.length, 1); assert.ok(summaries[0].port?.isConnected && !summaries[0].hiddenBy);
    assert.equal(summaries[0].handlers.click, undefined, "No competing application summary click handler");
    assert.equal(f.renderer.nodes.filter(node => node === details.port).length, 1);
    // Same native-summary default as output-reachability-fixture: the current
    // visible summary toggles open without a Lit update, command or forced form.
    details.port.open = !details.port.open; return f.tree();
  };
  return { current, fill, raw, submit, resets, records, disclosure, toggleDisclosure, closes };
}

// Only this opt-in publisher pair may admit the actual server audit side effects.
// These are canonical observations correlated with the original HTTP responses,
// not client append receipts and not an endpoint/type-wide history exemption.
function cLibraryPublisherAuditAccounting(h, admit, { nextVersion = false } = {}) {
  const calls = [], appended = [];
  let originalOwner = null, created = null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  return {
    events: () => [...appended],
    async observe(record, original) {
      assert.ok(calls.length < 2, "Only the original create and publish responses can admit audit events");
      if (originalOwner) assert.equal(original, originalOwner); else originalOwner = original;
      assert.ok(h.store.sourceOwnershipActive(original.source) && h.store.authorizationScopeActive(original.authorization));
      const session = h.store.session.get(), share = h.worker.sharing, { request, response, body } = record;
      assert.equal(session.user.userId, h.worker.owner); assert.equal(session.projectContext.organizationId, share.organizationId);
      assert.equal(session.projectContext.projectAccessId, share.projectAccessId); assert.equal(session.projectContext.projectId, h.a);
      assert.ok(h.requests.includes(request)); assert.equal(request.init, record.init); assert.equal(request.init.body, record.bytes);
      assert.equal(request.init.method, "POST"); assert.equal(response.bodyUsed, false);
      assert.deepEqual(await response.clone().json(), body, "Observed fields are from the same original response");
      const base = "/api/workspaces/" + share.organizationId + "/context-packages";
      let expected;
      if (!calls.length) {
        assert.equal(request.url, nextVersion ? base + "/" + original.packageId + "/versions" : base);
        assert.equal(response.status, 201); assert.equal(body.status, "draft");
        assert.deepEqual(request.body, { ...(nextVersion ? {} : { name: original.name.trim(), description: "" }), sourceProjectAccessId: share.projectAccessId,
          documentId: h.ad, blockIds: original.selected, expectedSourceHead: original.head,
          sourceRightsConfirmed: false, sourceNonSensitiveConfirmed: false });
        assert.equal(JSON.stringify(request.body), record.bytes);
        assert.match(body.packageId, uuid); assert.match(body.versionId, uuid); assert.notEqual(body.packageId, body.versionId);
        if (nextVersion) {
          const previous = h.store.organizationContextPackages.get().find(row => row.id === original.packageId);
          assert.ok(previous); assert.equal(previous.versionId, original.previousVersionId);
          assert.equal(previous.version, 1); assert.equal(body.packageId, original.packageId);
          assert.notEqual(body.versionId, original.previousVersionId);
        }
        assert.equal(body.version, nextVersion ? 2 : 1); assert.equal(body.blockCount, original.selected.length);
        assert.match(body.contentSha256, /^[a-f0-9]{64}$/u); created = body;
        expected = [...(nextVersion ? [] : [["OrganizationContextPackageCreated", "context-package", body.packageId]]),
          ["OrganizationContextPackageVersionDrafted", "context-package-version", body.versionId]];
      } else {
        assert.equal(request.url, base + "/" + created.packageId + "/versions/" + created.versionId + "/publish");
        assert.equal(request.init.body, undefined); assert.equal(request.body, null);
        assert.equal(response.status, 200); assert.equal(body.status, "published");
        for (const key of ["packageId", "versionId", "version", "contentSha256"]) assert.equal(body[key], created[key]);
        expected = [["OrganizationContextPackageVersionPublished", "context-package-version", created.versionId]];
      }
      const prefix = [...original.history, ...appended], history = await h.history();
      assert.deepEqual(history.slice(0, prefix.length), prefix, "Every previously observed workspace event retains its exact values and order");
      assert.equal(history.length, prefix.length + expected.length, "No extra event may enter this original response's audit suffix");
      const fresh = history.slice(prefix.length), previousSequence = prefix.at(-1)?.sequence ?? 0;
      const priorIds = new Set(prefix.map(event => event.eventId));
      for (const [index, event] of fresh.entries()) {
        const [type, resourceKind, resourceId] = expected[index];
        assert.deepEqual(Object.keys(event).sort(), ["actor", "causationId", "clientId", "compensatesEventId", "correlationId",
          "eventId", "occurredAt", "payload", "recordedAt", "schemaVersion", "sequence", "streamId", "type"].sort());
        assert.equal(event.type, type); assert.equal(event.streamId, h.worker.streamId);
        assert.equal(event.actor, "user:" + h.worker.owner); assert.equal(event.clientId, "server:workspace");
        assert.equal(event.sequence, previousSequence + index + 1); assert.equal(event.schemaVersion, 1);
        assert.equal(event.causationId, null); assert.equal(event.compensatesEventId, null);
        assert.match(event.eventId, uuid); assert.match(event.correlationId, uuid); assert.equal(priorIds.has(event.eventId), false);
        assert.equal(Number.isFinite(Date.parse(event.occurredAt)), true); assert.equal(event.recordedAt, event.occurredAt);
        assert.deepEqual(event.payload, { organization_id: share.organizationId, resource_kind: resourceKind, resource_id: resourceId });
      }
      assert.equal(new Set(fresh.map(event => event.eventId)).size, fresh.length);
      assert.deepEqual(h.counts(), original.counts, "Canonical organization audits do not authorize any financial-row change");
      assert.ok(h.store.sourceOwnershipActive(original.source) && h.store.authorizationScopeActive(original.authorization));
      await admit(fresh); appended.push(...fresh); calls.push(record);
      assert.deepEqual(await h.history(), [...original.history, ...appended], "Only the exact checked audit suffix extends the full original history");
    },
  };
}

function cLibraryPublisherResponses(t, x, original, { nextVersion = false, additionalCreate = false } = {}) {
  const { h } = x, prior = h.intercept, share = h.worker.sharing;
  assert.equal(nextVersion && additionalCreate, false);
  const audits = additionalCreate ? h.libraryReorderAudits : nextVersion ? h.libraryNextVersionAudits : h.libraryPublisherAudits;
  assert.ok(audits, "Exact publisher audit accounting is explicitly opted in");
  const base = "/api/workspaces/" + share.organizationId + "/context-packages";
  const records = [], errors = [], calls = [], gate = sceneDeferred();
  let created = null, held = false, delivered = false;
  const current = () => h.store.sourceOwnershipActive(original.source) && h.store.authorizationScopeActive(original.authorization);
  // Strict observation, not replacement success: invoke the complete original
  // public method once with identical this/arguments and return its SAME Promise.
  // The actual inline handler returns void, so f.act alone cannot join its work.
  const method = nextVersion ? "publishOrganizationContextPackageVersion" : "createOrganizationContextPackage";
  const actualCreate = h.store[method];
  const methodObservation = t.mock.method(h.store, method, function (...args) {
    assert.equal(this, h.store); assert.equal(calls.length, 0); assert.ok(current());
    assert.deepEqual(args, nextVersion ? [original.packageId, original.selected, false, false] : [original.name.trim(), "", original.selected, false, false]);
    const pending = Reflect.apply(actualCreate, this, args);
    assert.ok(pending && typeof pending.then === "function");
    const call = { args, pending, settled: false, result: undefined }; calls.push(call);
    pending.then(result => { call.result = result; call.settled = true; }, error => { call.settled = true; errors.push(error); });
    return pending;
  });
  const execute = async request => {
    if (!request.url.startsWith(base) || (request.init.method ?? "GET") === "GET") return prior?.(request);
    assert.ok(current()); assert.ok(h.requests.includes(request)); assert.equal(request.init.method, "POST");
    assert.equal(records.length < 2, true, "Only one original create and its exact existing publish request");
    const init = request.init, bytes = init.body;
    if (!created) {
      assert.equal(request.url, nextVersion ? base + "/" + original.packageId + "/versions" : base);
      assert.deepEqual(request.body, { ...(nextVersion ? {} : { name: original.name.trim(), description: "" }), sourceProjectAccessId: share.projectAccessId,
        documentId: h.ad, blockIds: original.selected, expectedSourceHead: original.head,
        sourceRightsConfirmed: false, sourceNonSensitiveConfirmed: false });
    } else {
      assert.equal(request.url, base + "/" + created.packageId + "/versions/" + created.versionId + "/publish");
      assert.equal(request.init.body, undefined, "The actual existing publish call has no substituted selection/body");
    }
    const inherited = await prior?.(request), response = inherited ?? await (h.transport
      ? h.transport(request) : h.worker.request(request.url, request.init));
    const body = await response.clone().json();
    assert.equal(response.bodyUsed, false); assert.equal(request.init, init); assert.equal(request.init.body, bytes);
    records.push({ request, init, bytes, response, body, status: response.status });
    if (!created) {
      assert.equal(response.status, 201); assert.equal(body.status, "draft"); assert.equal(body.version, nextVersion ? 2 : 1);
      assert.ok(body.packageId && body.versionId); assert.match(body.contentSha256, /^[a-f0-9]{64}$/u);
      created = body;
      await audits.observe(records.at(-1), original);
    } else {
      assert.equal(response.status, 200); assert.equal(body.status, "published");
      for (const key of ["packageId", "versionId", "version", "contentSha256"]) assert.equal(body[key], created[key]);
      await audits.observe(records.at(-1), original);
      assert.ok(current()); held = true; await gate.promise; delivered = true;
    }
    return response;
  };
  const intercept = request => {
    const pending = execute(request);
    pending.catch(error => { errors.push(error); }); return pending;
  };
  h.intercept = intercept;
  const restore = () => { gate.resolve(); if (h.intercept === intercept) h.intercept = prior; };
  t.after(restore);
  return { records, errors, calls, gate, restore, auditEvents: audits.events, held: () => held, delivered: () => delivered, created: () => created,
    restorePublicMethod() {
      assert.equal(calls.length, 1); assert.equal(calls[0].settled, true); assert.equal(delivered, true);
      assert.equal(h.store[method], methodObservation, "Only this completed observational wrapper may restore its original public method");
      methodObservation.mock.restore(); assert.equal(h.store[method], actualCreate);
    },
    detachHeldInterceptor() {
      assert.equal(held, true); assert.equal(delivered, false); assert.equal(h.intercept, intercept);
      h.intercept = prior; // The original already-running Response/Promise remains held.
    },
    async join() { assert.equal(calls.length, 1); return await calls[0].pending; } };
}

async function cLibraryPublisherPage(t, locale, { nextVersion = false, packageReorder = false, nativePreparation = false } = {}) {
  const f = await navigationPage(t, locale, { nativePreparation, shared: true, libraryPublisherAuditAccounting: true, libraryNextVersionAuditAccounting: nextVersion,
    libraryPackageReorderAuditAccounting: packageReorder }), h = f.navigationHost;
  const session = h.store.session.get(), share = h.worker.sharing;
  assert.ok(share && session.projectContext);
  assert.equal(session.user.userId, h.worker.owner);
  assert.equal(session.projectContext.organizationId, share.organizationId);
  assert.equal(session.projectContext.projectAccessId, share.projectAccessId);
  assert.equal(session.projectContext.projectId, h.a);
  assert.equal(session.projectContext.managedPilot, false, "Existing ordinary organization fixture, not self-approval in a managed pilot");
  assert.ok(session.projectContext.permissions.includes("project.read") && session.projectContext.permissions.includes("project.author"));
  assert.ok(session.organizations.some(row => row.organizationId === share.organizationId && ["owner", "administrator"].includes(row.role)));
  await f.act(f.task("/library"), "click", { button: 0 }); await f.settle();
  const owner = f.components().find(component => component.tag === "forma-library"); assert.ok(owner?.isConnected);
  if (packageReorder) cLibraryPackageNativeOccurrences(t, f, owner);
  const native = cLibraryPublisherNativeForm(t, f, owner); native.current();
  const blocks = h.store.projection.get().blocks;
  const selected = blocks.filter(block => block.id === "scene-reuse-direction" && block.type === "direction" && !block.removed).map(block => block.id);
  assert.equal(selected.length, 1, "Use the actual safe authored direction; no uploaded source/Output/governed reference is invented");
  assert.deepEqual(native.raw(), [["packageName", ""], ["packageBlock", selected[0]]],
    "The real current source has exactly one initially checked safe direction and an empty name");
  await h.navigationResumeReads.settleOriginalRequests();
  assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0, "No older original transport overlaps this deliberate package write");
  const before = { history: await h.history(), counts: h.counts(), route: h.store.route.get(),
    source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(), head: h.store.head.get(),
    requests: h.requests.length };
  assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
  return { f, h, owner, native, selected, before };
}

for (const newer of [false, true]) test("C Library publisher original success " + (newer ? "retains newer enabled raw fields" : "resets unchanged original fields"), fIntelligenceOptions, async t => {
  const x = await cLibraryPublisherPage(t, newer ? "ja" : "en"), { f, h, owner, native, selected, before } = x;
  const original = { ...before, name: "  Original package A — 原本  ", selected };
  const b = "  Newer package B — 未送信  ", originalForm = native.fill(original.name, selected).port;
  const aRaw = native.raw(); assert.deepEqual(aRaw.filter(([name]) => name === "packageBlock").map(([, value]) => value), selected);
  const observed = cLibraryPublisherResponses(t, x, original), submitting = native.submit(), submitErrors = [];
  submitting.catch(error => { submitErrors.push(error); });
  try {
    await untilScene(() => observed.held() || observed.errors.length || submitErrors.length,
      "The original actual publish response reaches its finite delivery gate");
    if (observed.errors.length || submitErrors.length) throw observed.errors[0] ?? submitErrors[0];
    assert.equal(observed.records.length, 2, "Both actual responses were reached before any desired draft assertion");
    assert.ok(owner.isConnected && originalForm.isConnected);
    let bRaw = null;
    if (newer) {
      native.fill(b, []); bRaw = native.raw();
      assert.deepEqual(bRaw, [["packageName", b]], "The genuinely unchecked selection is a newer intermediate draft, not an authorized second submission");
      assert.equal(native.current().port, originalForm);
    }
    observed.gate.resolve(); await submitting;
    assert.equal(await observed.join(), true, "Only the identical original Store Promise reports the actual positive completion");
    assert.equal(observed.calls.length, 1); assert.equal(observed.calls[0].settled, true);
    const created = observed.created();
    await untilScene(() => h.store.organizationContextPackages.get().some(row => row.id === created.packageId && row.versionId === created.versionId),
      "Actual post-publish catalog refresh has completed");
    await f.settle(); await h.worker.drainBackground();
    const pkg = h.worker.sqlite.prepare("SELECT * FROM organization_context_packages WHERE package_id=? AND organization_id=?").get(created.packageId, h.worker.sharing.organizationId);
    const version = h.worker.sqlite.prepare("SELECT * FROM organization_context_package_versions WHERE version_id=? AND package_id=?").get(created.versionId, created.packageId);
    const content = h.worker.sqlite.prepare("SELECT content_json FROM organization_context_package_contents WHERE version_id=?").get(created.versionId);
    assert.equal(pkg.name, original.name.trim()); assert.equal(pkg.created_by_user_id, h.worker.owner);
    assert.equal(version.status, "published"); assert.equal(version.approved_by_user_id, h.worker.owner);
    assert.equal(version.source_project_access_id, h.worker.sharing.projectAccessId); assert.equal(version.source_document_id, h.ad);
    assert.equal(cLibraryPublisherSha(content.content_json), created.contentSha256);
    const snapshot = JSON.parse(content.content_json);
    assert.equal(snapshot.organizationId, h.worker.sharing.organizationId);
    assert.equal(snapshot.sourceProjectAccessId, h.worker.sharing.projectAccessId); assert.equal(snapshot.sourceDocumentId, h.ad);
    assert.equal(snapshot.sourceHead, original.head);
    assert.deepEqual(snapshot.blocks.map(block => block.sourceBlockId), selected);
    assert.equal(snapshot.blocks[0].properties.text, "The keeper checks the harbor.");
    const audit = h.worker.sqlite.prepare("SELECT actor_user_id,action,resource_id FROM organization_audit_events WHERE resource_id IN (?,?) ORDER BY action").all(created.packageId, created.versionId);
    assert.deepEqual(audit.map(row => row.action), ["OrganizationContextPackageCreated", "OrganizationContextPackageVersionDrafted", "OrganizationContextPackageVersionPublished"]);
    assert.ok(audit.every(row => row.actor_user_id === h.worker.owner));
    assert.equal(observed.auditEvents().length, 3, "Exactly the original create/draft/publish audit chain was observed");
    assert.deepEqual(await h.history(), [...before.history, ...observed.auditEvents()]); assert.deepEqual(h.counts(), before.counts);
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    assert.equal(h.store.route.get(), before.route); assert.equal(native.current().port, originalForm);
    assert.deepEqual(h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET"
      && !h.navigationResumeReads.isReadOnlyResume(request) && !observed.records.some(row => row.request === request)), []);
    assert.equal(observed.records.length, 2);
    t.diagnostic("C_LIBRARY_PUBLISHER_COMPLETION " + JSON.stringify({ newer, actualDraftStatus: observed.records[0].status,
      actualPublishStatus: observed.records[1].status, packageId: created.packageId, versionId: created.versionId,
      sameOriginalForm: native.current().port === originalForm, originalSourceUnchanged: true,
      originalAuditEvents: observed.auditEvents().length, extraUnaccountedEvents: 0, extraFinancialRows: 0,
      nativeResets: native.resets.length }));
    if (newer) {
      assert.deepEqual(native.raw(), bRaw, "Original A's actual save cannot reset newer raw package name/selection B");
      assert.equal(native.resets.length, 0);
    } else {
      assert.equal(native.resets.length, 1); assert.deepEqual(native.resets[0].before, aRaw);
      assert.equal(new FormData(native.current().port).get("packageName"), "");
      assert.deepEqual(new FormData(native.current().port).getAll("packageBlock"), selected);
    }
  } finally {
    observed.gate.resolve();
    // Settlement only: retain the existing exact original transport machinery.
    // Join the identical original Store Promise before closing RAM, including
    // when an earlier native/setup assertion fails. This observes completion,
    // not a substituted result. The handler's existing .then is already attached
    // to that same Promise; no private method or callback is invoked by the test.
    try { await submitting; } finally {
      try { if (observed.calls.length) await observed.join(); } finally {
        await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
        await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
      }
    }
    if (observed.held()) assert.equal(observed.delivered(), true);
  }
  if (observed.errors.length) throw observed.errors[0];
});


// C Library archive continuation baselines. Full current Library/Store and RAM
// Worker; finite File.text/change/HTTP delivery ports, not an OS picker or browser.
// This accounting is deliberately separate from all Sessions/navigation observers.
import { exportArchive as cLibraryImportExportArchive } from "../src/model/archive.ts";
import { foldEvents as cLibraryImportFoldEvents } from "../src/model/events.ts";

function cLibraryImportReceiptAccounting(t, h, admit) {
  const prior = h.transport, records = [], proofs = new WeakMap();
  let armed = null;
  const original = request => prior ? prior(request) : h.worker.request(request.url, request.init);
  const exact = request => {
    const proof = proofs.get(request);
    return Boolean(proof && request.url === "/api/events" && request.init === proof.init
      && request.init.method === "POST" && request.init.body === proof.bytes && JSON.stringify(request.body) === proof.bytes);
  };
  const execute = async (request, record) => {
    record.request = request;
    const init = request.init, bytes = init.body, input = JSON.parse(bytes), source = cLibraryImportFoldEvents(record.archive.events);
    assert.ok(h.requests.includes(request)); assert.equal(h.store.route.get(), record.route);
    assert.equal(h.store.session.get().user.userId, record.actor); assert.equal(h.store.session.get().projectContext == null, true);
    assert.ok(h.store.sourceOwnershipActive(record.source) && h.store.authorizationScopeActive(record.authorization));
    assert.equal(h.store.projection.get().projectId, record.projectId);
    const history = await h.history(), financial = h.counts();
    if (record.predecessor) {
      assert.equal(records.length, 2); assert.equal(record.predecessor, records[0]);
      assert.equal(record.predecessor.delivered, true, "The real queue dispatches the second invocation only after A delivery");
      assert.ok(exact(record.predecessor.request)); assert.equal(record.archive, record.predecessor.archive);
      assert.deepEqual(history.slice(-record.predecessor.receipt.appended.length), record.predecessor.receipt.appended,
        "The second exact same-archive invocation starts after the original canonical suffix");
    }
    assert.equal(cLibraryImportFoldEvents(history).projectId, record.projectId,
      "This continuation baseline starts with the same unambiguous canonical/current project");
    assert.deepEqual(Object.keys(input).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
    assert.equal(input.action, "batch"); assert.equal(input.clientId, "web:lit");
    assert.equal(input.expectedSequence, history.at(-1).sequence);
    assert.equal(input.events.length, source.blocks.length + 1); assert.deepEqual(input.event, input.events[0]);
    const documentId = input.event.payload.document_id, ids = input.events.slice(1).map(event => event.payload.block_id);
    for (const id of [documentId, ...ids]) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
    assert.equal(new Set([documentId, ...ids]).size, ids.length + 1);
    assert.equal(history.some(event => [documentId, ...ids].includes(event.payload.document_id)
      || [documentId, ...ids].includes(event.payload.block_id)), false, "The actual one-copy gesture owns new exact IDs");
    assert.deepEqual(input.events, [
      { type: "DocumentForked", payload: { document_id: documentId, title: "Imported · " + source.documentTitle,
        source_stream_id: record.archive.streamId, source_sequence: record.archive.events.at(-1).sequence,
        carried_block_ids: source.blocks.map(block => block.id) } },
      ...source.blocks.map((block, index) => ({ type: "BlockCreated", payload: { block_id: ids[index], document_id: documentId,
        type: block.type, handle: block.handle + "-import", position: "z" + index, properties: block.properties } })),
    ], "Only the exact safe direction archive selected for this gesture may be submitted");
    const response = await original(request), receipt = await response.clone().json();
    assert.equal(response.status, 200, "A held delivery must first be a genuine successful Worker import");
    assert.equal(response.bodyUsed, false); assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]);
    assert.deepEqual(receipt.rejected, []); assert.equal(receipt.appended.length, input.events.length);
    for (const [index, event] of receipt.appended.entries()) {
      assert.equal(event.type, input.events[index].type); assert.deepEqual(event.payload, input.events[index].payload);
      assert.equal(event.streamId, h.worker.streamId); assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit");
      assert.ok(event.eventId && event.correlationId); assert.equal(event.sequence, input.expectedSequence + index + 1);
    }
    assert.equal(receipt.head, receipt.appended.at(-1).sequence);
    await h.worker.drainBackground();
    assert.deepEqual(await h.history(), [...history, ...receipt.appended], "The exact original response equals the entire canonical append");
    assert.deepEqual(h.counts(), financial, "Import is not generation, reservation, counter or payment activity");
    assert.equal(request.init, init); assert.equal(request.init.body, bytes); assert.equal(JSON.stringify(request.body), bytes);
    assert.ok(h.store.sourceOwnershipActive(record.source) && h.store.authorizationScopeActive(record.authorization));
    await admit(receipt.appended);
    proofs.set(request, { init, bytes }); assert.equal(exact({ ...request }), false);
    record.documentId = documentId; record.receipt = receipt; record.response = response;
    if (record.gate) await record.gate.promise;
    record.delivered = true; return response;
  };
  const transport = request => {
    if (request.url !== "/api/events" || request.init.method !== "POST" || request.body?.event?.type !== "DocumentForked") return original(request);
    assert.ok(armed && !armed.request, "Only one explicitly armed import-copy gesture is admitted");
    const record = armed; armed = null; record.pending = execute(request, record);
    record.pending.catch(error => { record.error = error; }); return record.pending;
  };
  h.transport = transport;
  t.after(() => { for (const record of records) record.gate?.resolve(); if (h.transport === transport) h.transport = prior; });
  return {
    arm(archive, hold = false, { pendingActivationAccounting = false } = {}) {
      assert.equal(typeof pendingActivationAccounting, "boolean");
      if (pendingActivationAccounting) assert.equal(hold, true, "Pending-activation accounting requires the original held delivery");
      assert.equal(armed, null); assert.equal(records.length, 0, "This family never retries or imports B automatically");
      const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
      assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      assert.equal(new URL(h.store.route.get(), "https://fixture.invalid").pathname, "/library");
      const projected = cLibraryImportFoldEvents(archive.events); assert.ok(projected.blocks.length > 0);
      assert.ok(projected.blocks.every(block => block.type === "direction"), "No media, Output, approval or rights-copy scope is admitted");
      armed = { archive: structuredClone(archive), route: h.store.route.get(), actor: h.store.session.get().user.userId,
        projectId: h.store.projection.get().projectId, source, authorization, gate: hold ? sceneDeferred() : null,
        request: null, receipt: null, delivered: false, error: null, pendingActivationAccounting };
      records.push(armed); return armed;
    },
    armPendingActivation(original) {
      assert.equal(original.pendingActivationAccounting, true, "Only this test's explicit pending-only opt-in admits a second invocation");
      assert.equal(armed, null); assert.equal(records.length, 1); assert.equal(records[0], original);
      assert.ok(original.gate && original.receipt && exact(original.request));
      assert.equal(original.delivered, false); assert.equal(original.error, null);
      assert.ok(h.store.sourceOwnershipActive(original.source) && h.store.authorizationScopeActive(original.authorization));
      assert.equal(h.store.route.get(), original.route); assert.equal(h.store.session.get().user.userId, original.actor);
      assert.equal(h.store.projection.get().projectId, original.projectId);
      armed = { archive: original.archive, route: original.route, actor: original.actor, projectId: original.projectId,
        source: original.source, authorization: original.authorization, gate: null, request: null, receipt: null,
        delivered: false, error: null, predecessor: original };
      records.push(armed); return armed;
    },
    async reached(record) {
      await untilScene(() => Boolean(record.receipt || record.error), "The original Library import reaches its real Worker receipt");
      if (record.error) throw record.error;
      assert.ok(record.receipt && exact(record.request)); return record.receipt;
    },
    isOriginal: exact, records: () => [...records], appended: () => records.flatMap(record => record.receipt?.appended ?? []),
  };
}

async function cLibraryImportPage(t, locale) {
  const f = await navigationPage(t, locale, { nativePreparation: true, libraryImportReceiptAccounting: true }), h = f.navigationHost;
  await registerCalmFullPageComponents(f, ["forma-library"]);
  // Declared safe archive fixtures are first canonical RAM events, then passed
  // through the existing exporter; no supplied imported projection or response.
  // The reused navigation fixture retains another historical project. Make A
  // the canonical current project as well, without changing import's payload.
  await h.external("ProjectOpened", { project_id: h.a, previous_project_id: h.b, source_surface: "library-import-fixture" });
  const specifications = [["A", 1], ["B", 2]], documents = [];
  for (const [name, count] of specifications) {
    const id = "c-library-import-source-" + name.toLowerCase(), blocks = [];
    await h.external("DocumentCreated", { project_id: h.a, document_id: id, title: "C Library archive " + name });
    for (let index = 0; index < count; index++) {
      const blockId = id + "-direction-" + index; blocks.push(blockId);
      await h.external("BlockCreated", { project_id: h.a, document_id: id, block_id: blockId, type: "direction",
        handle: "direction/" + blockId, position: "a" + index, properties: { text: "C_LIBRARY_ARCHIVE_" + name + "_" + index, weight: 1 } });
    }
    documents.push({ name, id, blocks });
  }
  await h.store.refreshEvents({ fromStart: true }); await f.settle(); h.exact();
  const history = await h.history(), archives = {};
  for (const entry of documents) {
    const events = history.filter(event => event.type === "ProjectCreated" && event.payload.project_id === h.a
      || event.type === "DocumentCreated" && event.payload.document_id === entry.id
      || event.type === "BlockCreated" && entry.blocks.includes(event.payload.block_id));
    assert.equal(events.length, entry.blocks.length + 2);
    const archive = cLibraryImportExportArchive(events), projected = cLibraryImportFoldEvents(archive.events);
    assert.deepEqual(archive.events, events); assert.deepEqual(archive.mediaManifest, []);
    assert.equal(projected.documentId, entry.id); assert.equal(projected.blocks.length, entry.blocks.length);
    archives[entry.name] = { archive, bytes: JSON.stringify(archive), blocks: entry.blocks.length };
  }
  await finishCommandPreparation(f, f.act(f.task("/library"), "click", { button: 0 }));
  await f.settle(); h.exact();
  const owners = f.components().filter(owner => owner.tag === "forma-library"); assert.equal(owners.length, 1);
  const library = owners[0]; assert.ok(library instanceof f.modules.get("src/components/forma-library.ts").FormaLibrary);
  assert.ok(library.isConnected && library.store === h.store);
  assert.equal(h.store.session.get().projectContext, undefined);
  const before = await fIntelligenceBaseline(f);
  return { f, h, library, archives, before, receipts: h.libraryImportReceipts };
}
function cLibraryImportInput(x) {
  const { f, library } = x;
  const node = f.find("input", value => value.owner === library && value.attributes.type === "file" && value.attributes.accept === "application/json");
  assert.ok(node.port.isConnected && f.renderer.nodes.includes(node.port));
  assert.equal(node.port.matches(":disabled"), false); return node;
}
function cLibraryImportFile(entry, held = false) {
  const gate = held ? sceneDeferred() : null, entered = sceneDeferred();
  const record = { gate, entered, reads: 0, file: null };
  // Same declared File.text port as the existing shared-file wrapper tests.
  record.file = { name: "archive-" + entry.blocks + ".json", type: "application/json", async text() {
    record.reads++; entered.resolve(); if (gate) await gate.promise; return entry.bytes;
  } };
  return record;
}
function cLibraryImportChoose(x, file) {
  const input = cLibraryImportInput(x); input.port.files = [file.file];
  return x.f.act(input, "change");
}
function cLibraryImportPreview(x, { pending = false } = {}) {
  const { f, library } = x, tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === library && fObjectClassed(node, "library-import-dialog"));
  assert.ok(dialogs.length <= 1);
  if (!dialogs.length) return null;
  const dialog = dialogs[0]; assert.equal(dialog.port.open, true);
  const metrics = tree.visible("div").filter(node => c19NamingWithin(node, dialog) && fObjectClassed(node, "metric-grid"));
  assert.equal(metrics.length, 1);
  const values = tree.visible("b").filter(node => c19NamingWithin(node, metrics[0])).map(node => node.text);
  assert.equal(values.length, 3);
  const buttons = tree.visible("button").filter(node => node.owner === library && c19NamingWithin(node, dialog));
  const close = buttons.filter(node => node.attributes["aria-label"] === f.i18n.t("projects.closePreview", "Close preview"));
  const submit = buttons.filter(node => node.text === f.i18n.system("Import document copy"));
  assert.equal(close.length, 1); assert.equal(submit.length, 1);
  assert.equal(submit[0].port.matches(":disabled"), pending);
  if (pending) assert.equal(submit[0].attributes["aria-busy"], "true", "The same pending preview truthfully marks its native Import control busy");
  return { dialog, close: close[0], submit: submit[0], values };
}
async function cLibraryImportUnchanged(x, { held = false } = {}) {
  const { f, h, before, receipts } = x;
  if (!held) await h.navigationResumeReads.settleOriginalRequests();
  await f.settle();
  assert.deepEqual(await h.history(), [...before.history, ...receipts.appended()]);
  assert.deepEqual(h.counts(), before.counts);
  assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
  assert.equal(h.store.session.get().user.userId, before.actor);
  assert.equal(h.store.route.get(), before.origin); assert.equal(h.store.projection.get().projectId, before.projection.projectId);
  const writes = h.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET" && !h.navigationResumeReads.isReadOnlyResume(row));
  const originals = receipts.records().map(record => record.request).filter(Boolean);
  assert.deepEqual(writes, originals); assert.ok(originals.every(receipts.isOriginal));
}
function cLibraryImportCopiedA(x, record) {
  const { h, archives } = x, source = cLibraryImportFoldEvents(archives.A.archive.events), projection = h.store.projection.get();
  const document = projection.documents.filter(item => item.id === record.documentId);
  assert.equal(document.length, 1); assert.equal(document[0].removed, false);
  assert.equal(document[0].projectId, h.a); assert.equal(document[0].title, "Imported · " + source.documentTitle);
  const copied = projection.libraryBlocks.filter(block => block.documentId === record.documentId);
  assert.deepEqual(copied.map(block => ({ type: block.type, handle: block.handle, properties: block.properties })),
    source.blocks.map(block => ({ type: block.type, handle: block.handle + "-import", properties: block.properties })));
  assert.equal(record.delivered, true); assert.equal(x.receipts.records().length, 1);
}

test("C Library archive import / en / healthy exact original copy", fIntelligenceOptions, async t => {
  const x = await cLibraryImportPage(t, "en"), file = cLibraryImportFile(x.archives.A);
  await finishCommandPreparation(x.f, cLibraryImportChoose(x, file));
  assert.equal(file.reads, 1); assert.deepEqual(cLibraryImportPreview(x).values, ["1", "0", "0"]);
  await cLibraryImportUnchanged(x); assert.equal(x.receipts.records().length, 0);
  const record = x.receipts.arm(x.archives.A.archive);
  await finishCommandPreparation(x.f, x.f.act(cLibraryImportPreview(x).submit, "click", { button: 0 }));
  await x.receipts.reached(record); await cLibraryImportUnchanged(x); cLibraryImportCopiedA(x, record);
  t.diagnostic("C_LIBRARY_IMPORT " + JSON.stringify({ boundary: "healthy", actualWorkerStatus: record.response.status,
    originalDocumentId: record.documentId, appended: record.receipt.appended.map(event => ({ eventId: event.eventId, type: event.type, sequence: event.sequence })),
    previewOpen: Boolean(cLibraryImportPreview(x)), extraCommands: 0, fiscalUnchanged: true }));
  assert.equal(cLibraryImportPreview(x), null, "Healthy acknowledged A clears only its own original preview");
});

test("C Library archive import / ja / reversed File.text keeps the newer chosen preview", fIntelligenceOptions, async t => {
  const x = await cLibraryImportPage(t, "ja"), a = cLibraryImportFile(x.archives.A, true), b = cLibraryImportFile(x.archives.B, true);
  let pendingA, pendingB;
  try {
    pendingA = cLibraryImportChoose(x, a); await a.entered.promise;
    pendingB = cLibraryImportChoose(x, b); await b.entered.promise;
    b.gate.resolve(); await finishCommandPreparation(x.f, pendingB);
    assert.deepEqual(cLibraryImportPreview(x).values, ["2", "0", "0"], "The real newer file B is visibly current before old A resolves");
    await cLibraryImportUnchanged(x);
    a.gate.resolve(); await finishCommandPreparation(x.f, pendingA);
    await cLibraryImportUnchanged(x); assert.equal(a.reads, 1); assert.equal(b.reads, 1);
    assert.equal(x.receipts.records().length, 0);
    const preview = cLibraryImportPreview(x);
    t.diagnostic("C_LIBRARY_IMPORT " + JSON.stringify({ boundary: "reverse-file-read", locale: "ja", originalReads: a.reads,
      newerReads: b.reads, visibleMetricValues: preview?.values ?? null, commands: 0, sourceAndFiscalUnchanged: true }));
    assert.deepEqual(preview?.values, ["2", "0", "0"], "Late File.text A must not replace the newer explicitly chosen B preview");
  } finally { a.gate.resolve(); b.gate.resolve(); await Promise.allSettled([pendingA, pendingB].filter(Boolean)); }
});

test("C Library archive import / en / committed A cannot clear a newly chosen B preview", fIntelligenceOptions, async t => {
  const x = await cLibraryImportPage(t, "en"), a = cLibraryImportFile(x.archives.A), b = cLibraryImportFile(x.archives.B);
  await finishCommandPreparation(x.f, cLibraryImportChoose(x, a));
  assert.deepEqual(cLibraryImportPreview(x).values, ["1", "0", "0"]);
  const record = x.receipts.arm(x.archives.A.archive, true);
  const pending = x.f.act(cLibraryImportPreview(x).submit, "click", { button: 0 });
  try {
    await finishCommandPreparation(x.f, x.receipts.reached(record));
    assert.equal(record.delivered, false); assert.equal(record.response.status, 200);
    await cLibraryImportUnchanged(x, { held: true });
    const old = cLibraryImportPreview(x, { pending: true }); assert.ok(old);
    await x.f.act(old.close, "click", { button: 0 }); assert.equal(cLibraryImportPreview(x), null);
    await finishCommandPreparation(x.f, cLibraryImportChoose(x, b));
    assert.deepEqual(cLibraryImportPreview(x).values, ["2", "0", "0"], "Close then a genuine new file selection presents B while A's successful reply remains held");
    assert.equal(a.reads, 1); assert.equal(b.reads, 1); assert.equal(x.receipts.records().length, 1);
    record.gate.resolve(); await finishCommandPreparation(x.f, pending);
    await cLibraryImportUnchanged(x); cLibraryImportCopiedA(x, record);
    const preview = cLibraryImportPreview(x);
    t.diagnostic("C_LIBRARY_IMPORT " + JSON.stringify({ boundary: "committed-a-new-b", actualWorkerStatus: record.response.status,
      originalDocumentId: record.documentId, originalEventIds: record.receipt.appended.map(event => event.eventId),
      newerFileRead: b.reads, visibleMetricValues: preview?.values ?? null, originalImportCommands: 1, newerImportCommands: 0, fiscalUnchanged: true }));
    assert.deepEqual(preview?.values, ["2", "0", "0"], "A's positive acknowledgement must not consume the newer unsent B preview");
  } finally { record.gate.resolve(); await pending; }
});


// C pending-only admission: an enabled second current control is genuinely
// activated and allowed through the real serialized Store/Worker path. The
// opt-in observer recognizes at most two exact same-archive original batches.
// Unknown-original recovery after settlement remains a separate D boundary.
test("C Library archive import / en / same-preview pending activation admits only its original copy", fIntelligenceOptions, async t => {
  const x = await cLibraryImportPage(t, "en"), file = cLibraryImportFile(x.archives.A);
  await finishCommandPreparation(x.f, cLibraryImportChoose(x, file));
  assert.deepEqual(cLibraryImportPreview(x).values, ["1", "0", "0"]);
  await cLibraryImportUnchanged(x); assert.equal(x.receipts.records().length, 0);
  const record = x.receipts.arm(x.archives.A.archive, true, { pendingActivationAccounting: true });
  const pending = x.f.act(cLibraryImportPreview(x).submit, "click", { button: 0 });
  let second, pendingSecond, disabled;
  try {
    await finishCommandPreparation(x.f, x.receipts.reached(record));
    assert.equal(record.response.status, 200); assert.equal(record.delivered, false);
    assert.equal(record.response.bodyUsed, false, "A is canonical before its genuine positive delivery is released");
    await cLibraryImportUnchanged(x, { held: true });
    const tree = x.f.tree(), dialogs = tree.visible("dialog").filter(node => node.owner === x.library && fObjectClassed(node, "library-import-dialog"));
    assert.equal(dialogs.length, 1); assert.equal(dialogs[0].port.open, true);
    const metrics = tree.visible("div").filter(node => c19NamingWithin(node, dialogs[0]) && fObjectClassed(node, "metric-grid"));
    assert.equal(metrics.length, 1);
    assert.deepEqual(tree.visible("b").filter(node => c19NamingWithin(node, metrics[0])).map(node => node.text), ["1", "0", "0"],
      "The original A preview is still the sole current same-selection preview");
    const buttons = tree.visible("button").filter(node => node.owner === x.library && c19NamingWithin(node, dialogs[0])
      && node.text === x.f.i18n.system("Import document copy"));
    assert.equal(buttons.length, 1);
    const button = buttons[0]; assert.ok(button.port.isConnected && x.f.renderer.nodes.includes(button.port));
    disabled = button.port.matches(":disabled");
    if (disabled) {
      assert.ok(Object.hasOwn(button.attributes, "disabled"), "The current native button itself owns its pending disabled state");
      assert.equal(typeof button.port.click, "function");
      button.port.click(); // Existing finite native disabled-button primitive; never call its handler directly.
    } else {
      second = x.receipts.armPendingActivation(record);
      pendingSecond = x.f.act(button, "click", { button: 0 });
    }
    await x.f.settle(); await cLibraryImportUnchanged(x, { held: true });
    assert.equal(record.delivered, false, "The second gesture occurs before the original response is released");
    assert.equal(x.h.requests.slice(x.before.requests).filter(request => request.url === "/api/events" && request.body?.event?.type === "DocumentForked").length, 1,
      "The actual append pipeline still owns the first held response, not an invented second parallel Worker call");
  } finally {
    record.gate.resolve();
    await finishCommandPreparation(x.f, Promise.all([pending, pendingSecond].filter(Boolean)));
  }
  if (second?.request) await x.receipts.reached(second);
  await cLibraryImportUnchanged(x);
  const records = x.receipts.records().filter(value => value.request), appended = x.receipts.appended(), forks = appended.filter(event => event.type === "DocumentForked");
  assert.ok(records.every(value => value.delivered && value.response.status === 200 && x.receipts.isOriginal(value.request)));
  assert.equal(new Set(forks.map(event => event.payload.document_id)).size, forks.length, "Any repeated native activation owns genuinely distinct original document IDs");
  const projection = x.h.store.projection.get(), original = cLibraryImportFoldEvents(x.archives.A.archive.events);
  for (const fork of forks) {
    const documents = projection.documents.filter(document => document.id === fork.payload.document_id);
    assert.equal(documents.length, 1); assert.equal(documents[0].removed, false); assert.equal(documents[0].projectId, x.h.a);
    assert.equal(documents[0].title, "Imported · " + original.documentTitle);
    assert.deepEqual(projection.libraryBlocks.filter(block => block.documentId === documents[0].id)
      .map(block => ({ type: block.type, handle: block.handle, properties: block.properties })),
    original.blocks.map(block => ({ type: block.type, handle: block.handle + "-import", properties: block.properties })));
  }
  assert.equal(x.h.store.head.get(), (await x.h.history()).at(-1).sequence);
  assert.equal(file.reads, 1); assert.equal(cLibraryImportPreview(x), null);
  t.diagnostic("C_LIBRARY_IMPORT_PENDING " + JSON.stringify({ boundary: "same-preview-pending-native-activation", locale: "en",
    pendingNativeDisabled: disabled, secondNativeActivation: Boolean(second), actualWorkerStatuses: records.map(value => value.response.status),
    originalDocumentIds: forks.map(event => event.payload.document_id), originalEventIds: appended.map(event => event.eventId),
    importCommands: records.length, canonicalCopies: forks.length, exactCanonicalSuffix: true, resumeAndFiscalUnchanged: true }));
  assert.equal(records.length, 1, "The same pending preview must not admit a second original import batch");
  assert.equal(forks.length, 1, "One pending import gesture produces one exact copied document");
  assert.equal(disabled, true, "The current same-preview Import button is natively disabled while its original is pending");
});


// Distinct next-version disclosure completion, not the create-form reset claim.
// Version 1 is created through the same actual visible publisher and original
// accounted responses; version 2 uses a separate opt-in instance of that observer.
async function cLibraryNextVersionPage(t, locale, { packageReorder = false, nativePreparation = false } = {}) {
  const x = await cLibraryPublisherPage(t, locale, { nextVersion: true, packageReorder, nativePreparation }), { f, h, native, selected, before } = x;
  const seed = { ...before, name: "Existing exact organization context — 基本", selected };
  native.fill(seed.name, selected);
  const observed = cLibraryPublisherResponses(t, x, seed), pending = native.submit(), errors = [];
  let completed;
  pending.catch(error => { errors.push(error); });
  try {
    await untilScene(() => observed.held() || observed.errors.length || errors.length, "The real existing package reaches its publish response");
    if (observed.errors.length || errors.length) throw observed.errors[0] ?? errors[0];
    observed.gate.resolve(); await pending; assert.equal(await observed.join(), true);
    await f.settle(); await h.worker.drainBackground();
    const created = observed.created();
    assert.equal(observed.records[0].status, 201); assert.equal(observed.records[1].status, 200);
    assert.equal(observed.auditEvents().length, 3);
    assert.deepEqual(await h.history(), [...before.history, ...observed.auditEvents()]);
    assert.deepEqual(h.counts(), before.counts); assert.equal(observed.calls.length, 1);
    const previous = h.store.organizationContextPackages.get().find(row => row.id === created.packageId);
    assert.ok(previous); assert.equal(previous.versionId, created.versionId); assert.equal(previous.version, 1);
    const snapshot = h.store.organizationContextVersions.get()[created.versionId];
    assert.ok(snapshot); assert.equal(snapshot.sourceProjectAccessId, h.worker.sharing.projectAccessId);
    assert.equal(snapshot.sourceDocumentId, h.ad); assert.deepEqual(snapshot.blocks.map(block => block.sourceBlockId), selected);
    assert.equal(snapshot.blocks[0].properties.text, "The keeper checks the harbor.");
    completed = { ...x, seed, existing: created, seedAuditEvents: observed.auditEvents(), seedObservation: observed };
  } finally {
    observed.gate.resolve();
    try { await pending; } finally {
      try { if (observed.calls.length) await observed.join(); } finally {
        await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
        await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
        observed.restore();
      }
    }
  }
  if (observed.errors.length) throw observed.errors[0];
  return completed;
}

for (const newer of [false, true]) test("C Library next version original completion " + (newer ? "keeps newer checkbox work visible" : "closes its unchanged current disclosure"), fIntelligenceOptions, async t => {
  const x = await cLibraryNextVersionPage(t, newer ? "ja" : "en"), { f, h, owner, selected, existing } = x;
  // Obtain the actual current authorized source head for this NEW deliberate
  // version command; no version or package row is fabricated in setup.
  await h.store.refreshEvents({ fromStart: true }); await f.settle();
  await h.navigationResumeReads.settleOriginalRequests();
  assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0);
  assert.equal(h.store.organizationContextPackages.get().filter(row => row.id === existing.packageId).length, 1);
  assert.equal(f.tree().visible("h3").filter(node => node.owner === owner && node.text === x.seed.name).length, 1);
  const native = cLibraryPublisherNativeForm(t, f, owner, { nextVersion: true });
  const initial = native.disclosure(); assert.equal(initial.port.open, false);
  native.toggleDisclosure(); assert.equal(native.disclosure().port, initial.port); assert.equal(initial.port.open, true);
  const form = native.fill(null, selected).port, rawA = native.raw();
  assert.deepEqual(rawA, [["packageBlock", selected[0]]]);
  const before = { history: await h.history(), counts: h.counts(), route: h.store.route.get(), requests: h.requests.length,
    source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(), head: h.store.head.get() };
  const original = { ...before, selected, packageId: existing.packageId, previousVersionId: existing.versionId };
  const observed = cLibraryPublisherResponses(t, x, original, { nextVersion: true }), pending = native.submit(), errors = [];
  pending.catch(error => { errors.push(error); });
  try {
    await untilScene(() => observed.held() || observed.errors.length || errors.length, "The exact next-version publish response reaches its delivery gate");
    if (observed.errors.length || errors.length) throw observed.errors[0] ?? errors[0];
    assert.equal(observed.records.length, 2); assert.equal(observed.auditEvents().length, 2);
    assert.equal(native.current().port, form); assert.equal(native.disclosure().port, initial.port);
    assert.equal(initial.port.open, true, "The current visible summary was opened before submission");
    if (newer) {
      native.fill(null, []);
      assert.deepEqual(native.raw(), [], "The enabled checkbox now holds newer intermediate B; it is not submitted");
    }
    observed.gate.resolve(); await pending;
    assert.equal(await observed.join(), true); await f.settle(); await h.worker.drainBackground();
    const created = observed.created();
    assert.equal(created.packageId, existing.packageId); assert.notEqual(created.versionId, existing.versionId); assert.equal(created.version, 2);
    const current = h.store.organizationContextPackages.get().find(row => row.id === existing.packageId);
    assert.ok(current); assert.equal(current.versionId, created.versionId); assert.equal(current.version, 2);
    const pkg = h.worker.sqlite.prepare("SELECT * FROM organization_context_packages WHERE package_id=? AND organization_id=?").get(existing.packageId, h.worker.sharing.organizationId);
    assert.equal(pkg.name, x.seed.name); assert.equal(pkg.created_by_user_id, h.worker.owner);
    const previous = h.worker.sqlite.prepare("SELECT status,content_sha256 FROM organization_context_package_versions WHERE version_id=? AND package_id=?").get(existing.versionId, existing.packageId);
    assert.equal(previous.status, "published"); assert.equal(previous.content_sha256, existing.contentSha256);
    const version = h.worker.sqlite.prepare("SELECT * FROM organization_context_package_versions WHERE version_id=? AND package_id=?").get(created.versionId, existing.packageId);
    assert.equal(version.status, "published"); assert.equal(version.approved_by_user_id, h.worker.owner); assert.equal(version.version, 2);
    assert.equal(version.source_project_access_id, h.worker.sharing.projectAccessId); assert.equal(version.source_document_id, h.ad);
    const content = h.worker.sqlite.prepare("SELECT content_json FROM organization_context_package_contents WHERE version_id=?").get(created.versionId);
    assert.equal(cLibraryPublisherSha(content.content_json), created.contentSha256);
    const snapshot = JSON.parse(content.content_json);
    assert.equal(snapshot.organizationId, h.worker.sharing.organizationId); assert.equal(snapshot.sourceHead, original.head);
    assert.deepEqual(snapshot.blocks.map(block => block.sourceBlockId), selected);
    assert.equal(snapshot.blocks[0].properties.text, "The keeper checks the harbor.");
    const audit = h.worker.sqlite.prepare("SELECT actor_user_id,action,resource_id FROM organization_audit_events WHERE resource_id=? ORDER BY action").all(created.versionId);
    assert.deepEqual(audit.map(row => row.action), ["OrganizationContextPackageVersionDrafted", "OrganizationContextPackageVersionPublished"]);
    assert.ok(audit.every(row => row.actor_user_id === h.worker.owner));
    assert.deepEqual(await h.history(), [...before.history, ...observed.auditEvents()]); assert.deepEqual(h.counts(), before.counts);
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    assert.equal(h.store.route.get(), before.route); assert.equal(native.current({ allowHidden: true }).port, form);
    assert.equal(native.disclosure().port, initial.port); assert.equal(native.resets.length, 0);
    assert.equal(observed.calls.length, 1); assert.equal(observed.records.length, 2);
    assert.deepEqual(h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET"
      && !h.navigationResumeReads.isReadOnlyResume(request) && !observed.records.some(row => row.request === request)), []);
    // Read-only inspection of a connected hidden form distinguishes concealment
    // from raw loss; no hidden field/handler is activated after completion.
    const raw = native.raw({ allowHidden: true }), open = native.disclosure().port.open;
    t.diagnostic("C_LIBRARY_NEXT_VERSION " + JSON.stringify({ newer, originalPackageId: existing.packageId,
      previousVersionId: existing.versionId, versionId: created.versionId, actualDraftStatus: observed.records[0].status,
      actualPublishStatus: observed.records[1].status, originalAuditEvents: observed.auditEvents().length,
      sameForm: true, sameDisclosure: true, openAfterCompletion: open, rawSelection: raw,
      programmaticCloseCalls: native.closes.length, newVersionCommands: 1, submittedBCommands: 0,
      sourceAndFiscalUnchanged: true, evidence: "actual full hosts and RAM Worker; finite native summary/form/reflection, not browser focus or raw-loss inference" }));
    assert.deepEqual(raw, newer ? [] : rawA, "The exact current native selection remains observable without activating hidden controls");
    assert.equal(open, !newer ? false : true, newer
      ? "A's original version completion cannot close the newer current checkbox work"
      : "Healthy unchanged A closes its own current next-version disclosure");
  } finally {
    observed.gate.resolve();
    try { await pending; } finally {
      try { if (observed.calls.length) await observed.join(); } finally {
        await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
        await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
        observed.restore();
      }
    }
  }
  if (observed.errors.length) throw observed.errors[0];
});


// A separate exact-package identity case. Names identify genuine visible cards
// only for the initial user choice; native form retention follows the renderer's
// real template/path, including a real repeat key if the application supplies one.
// Test-local lookup port for the explicitly opted-in multi-package case. Reuse
// the complete existing parser and its visibility calculation; do not copy a
// renderer, synthesize DOM nodes, or retain identity by package data.
function cLibraryPackageNativeOccurrences(t, f, owner, { resetButtons = false } = {}) {
  const originalTree = f.tree;
  const currentTree = () => {
    const renderer = f.renderer, native = renderer.nodes, occurrences = new Map(), used = new Set();
    // The first pass is structural only: its generic port aliases are not used
    // as identity, visibility, selectedness or permission evidence.
    const structure = originalTree(), tokens = new Set();
    const relevantTags = new Set(["article", "details", "summary", "form", "fieldset", "input", "select", "textarea"]);
    for (const node of structure.nodes) {
      if (node.owner !== owner || !relevantTags.has(node.tag)
        && !(resetButtons && node.tag === "button" && node.attributes.type === "reset")) continue;
      let publisher = false;
      for (let parent = node; parent; parent = parent.parent) {
        if (parent.owner !== owner) break;
        if (parent.tag === "article" && String(parent.attributes.class).split(/\s+/u).includes("library-organization-context-card")
          || parent.tag === "form" && /(?:create|publish)OrganizationContextPackage/u.test(String(parent.handlers.submit))) { publisher = true; break; }
      }
      if (!publisher) continue;
      assert.ok(node.port && node.port.owner === owner && node.port.tag === node.tag, "The actual publisher structural node has a native emitted token");
      tokens.add(node.port.full);
    }
    const queues = new Map();
    for (const token of tokens) {
      const expected = structure.nodes.filter(node => node.owner === owner && node.port?.full === token);
      const matches = native.filter(port => port.owner === owner && port.full === token);
      assert.equal(matches.length, expected.length, "Actual owner/token native order must match semantic occurrences; descendant-collection aliases are not waived");
      assert.equal(new Set(matches).size, matches.length, "The original renderer supplies distinct native occurrence objects");
      queues.set(token, matches);
    }
    const lookup = {
      find(predicate) {
        const first = native.find(predicate);
        if (!first || first.owner !== owner || !queues.has(first.full)) return first;
        const matches = queues.get(first.full);
        assert.ok(matches.every(predicate), "One actual owner and exact emitted opening token");
        const index = occurrences.get(first.full) ?? 0;
        assert.ok(index < matches.length, "Each parsed occurrence has an actual current native port");
        const port = matches[index]; occurrences.set(first.full, index + 1);
        assert.equal(used.has(port), false, "Distinct same-token occurrences cannot alias one native port"); used.add(port);
        return port;
      },
    };
    // This is a read-only lookup view, not an installed renderer. In particular,
    // fullPageTree reads each exact DETAILS.open before it computes hiddenBy.
    const tree = cLibraryPackageFullPageTree({ host: f.host, renderer: {
      markup: renderer.markup, attrs: renderer.attrs.bind(renderer), nodes: lookup,
      instances: renderer.instances, openPopovers: renderer.openPopovers,
    } });
    for (const [token, matches] of queues)
      assert.equal(occurrences.get(token), matches.length, "Every relevant native token occurrence was consumed exactly once by the existing parser");
    assert.equal(f.renderer, renderer); assert.equal(renderer.nodes, native);
    return tree;
  };
  f.tree = currentTree;
  t.after(() => { if (f.tree === currentTree) f.tree = originalTree; });
}

function cLibraryPackageCard(x, packageId) {
  const { f, h, owner } = x, catalog = h.store.organizationContextPackages.get();
  const records = catalog.filter(row => row.id === packageId); assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(catalog.filter(row => row.name === record.name).length, 1, "This finite case deliberately uses distinct actual package names");
  const tree = f.tree();
  const headings = tree.visible("h3").filter(node => node.owner === owner && node.text === record.name);
  assert.equal(headings.length, 1, "The exact current catalog package has one genuine visible named card");
  let article = headings[0].parent;
  while (article && article.tag !== "article") article = article.parent;
  assert.ok(article && article.owner === owner && String(article.attributes.class).split(/\s+/u).includes("library-organization-context-card"));
  // Literal ARTICLE openings have equal generic fixture ports. Use one parsed
  // tree's exact nearest-article ancestry, not cross-snapshot port equivalence.
  const ownedByArticle = node => {
    for (let parent = node.parent; parent; parent = parent.parent)
      if (parent.tag === "article") return parent === article;
    return false;
  };
  const forms = tree.nodes.filter(node => node.owner === owner && node.tag === "form"
    && ownedByArticle(node) && String(node.handlers.submit).includes("publishOrganizationContextPackageVersion"));
  assert.equal(forms.length, 1, "The currently named package owns one actual next-version form");
  return { record, article, form: forms[0] };
}

test("C Library next version keeps exact native package ownership through actual catalog insertion", fIntelligenceOptions, async t => {
  const x = await cLibraryNextVersionPage(t, "en", { packageReorder: true }), { f, h, owner, native: createNative, selected, existing } = x;
  // Only the completed seed's observer is removed. The same original public
  // Store implementation remains the one used by the next real create command.
  x.seedObservation.restorePublicMethod();
  await h.store.refreshEvents({ fromStart: true }); await f.settle();
  await h.navigationResumeReads.settleOriginalRequests();
  const aNative = cLibraryPublisherNativeForm(t, f, owner, { nextVersion: true,
    chooseInitialForm: forms => forms.find(form => form.port === cLibraryPackageCard(x, existing.packageId).form.port) });
  assert.equal(aNative.disclosure().port.open, false); aNative.toggleDisclosure();
  const originalForm = aNative.fill(null, selected).port, originalDetails = aNative.disclosure().port;
  const originalPath = aNative.records.at(-1).path;
  assert.equal(cLibraryPackageCard(x, existing.packageId).form.port, originalForm);
  const before = { history: await h.history(), counts: h.counts(), route: h.store.route.get(), requests: h.requests.length,
    source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(), head: h.store.head.get() };
  const original = { ...before, selected, packageId: existing.packageId, previousVersionId: existing.versionId };
  const observed = cLibraryPublisherResponses(t, x, original, { nextVersion: true }), pending = aNative.submit(), errors = [];
  pending.catch(error => { errors.push(error); });
  let inserted = null, inserting = null, originalPackageStillOwnsForm = false, insertionReboundOriginal = false;
  let bNative = null, bForm = null, bDetails = null, insertedOriginal = null;
  try {
    await untilScene(() => observed.held() || observed.errors.length || errors.length, "Original A's actual version2 publish ACK is held after commit");
    if (observed.errors.length || errors.length) throw observed.errors[0] ?? errors[0];
    assert.equal(observed.records.length, 2); assert.equal(observed.auditEvents().length, 2);
    assert.equal(observed.delivered(), false); assert.equal(originalDetails.open, true);
    assert.deepEqual(aNative.raw(), [["packageBlock", selected[0]]]);
    // Detach only interception of NEW requests. This already-dispatched original
    // Response stays held, its Promise unchanged; it is neither lost nor replayed.
    observed.detachHeldInterceptor();
    await h.store.refreshEvents({ fromStart: true }); await f.settle();
    await h.navigationResumeReads.settleOriginalRequests();
    const bName = "Later exact organization context B — 別の文脈";
    insertedOriginal = { history: await h.history(), counts: h.counts(), route: h.store.route.get(),
      source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(), head: h.store.head.get(), name: bName, selected };
    assert.deepEqual(insertedOriginal.history, [...before.history, ...observed.auditEvents()]);
    createNative.fill(bName, selected);
    inserted = cLibraryPublisherResponses(t, x, insertedOriginal, { additionalCreate: true });
    inserting = createNative.submit(); inserting.catch(error => { errors.push(error); });
    await untilScene(() => inserted.held() || inserted.errors.length || errors.length, "A distinct visible create-B command reaches its actual publish ACK");
    if (inserted.errors.length || errors.length) throw inserted.errors[0] ?? errors[0];
    assert.equal(inserted.records.length, 2); assert.equal(inserted.auditEvents().length, 3);
    inserted.gate.resolve(); await inserting; assert.equal(await inserted.join(), true);
    await f.settle(); await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
    const aVersion = observed.created(), bVersion = inserted.created();
    assert.equal(aVersion.packageId, existing.packageId); assert.equal(aVersion.version, 2);
    assert.notEqual(bVersion.packageId, existing.packageId); assert.equal(bVersion.version, 1);
    const catalog = h.store.organizationContextPackages.get();
    assert.deepEqual(catalog.map(row => row.id), [bVersion.packageId, existing.packageId], "Actual server updated_at ordering inserts B before A; no local sort/row is fabricated");
    assert.equal(catalog[0].name, bName); assert.equal(catalog[0].versionId, bVersion.versionId);
    assert.equal(catalog[1].name, x.seed.name); assert.equal(catalog[1].versionId, aVersion.versionId);
    const timestamps = h.worker.sqlite.prepare("SELECT package_id,updated_at FROM organization_context_packages WHERE organization_id=? ORDER BY updated_at DESC").all(h.worker.sharing.organizationId);
    assert.deepEqual(timestamps.map(row => row.package_id), [bVersion.packageId, existing.packageId]);
    assert.ok(Date.parse(timestamps[0].updated_at) > Date.parse(timestamps[1].updated_at), "Real insertion occurred later; a tied clock is an explicit setup failure, never forced ordering");
    const aCard = cLibraryPackageCard(x, existing.packageId), bCard = cLibraryPackageCard(x, bVersion.packageId);
    originalPackageStillOwnsForm = aCard.form.port === originalForm && bCard.form.port !== originalForm;
    insertionReboundOriginal = bCard.form.port === originalForm;
    // If the real positional template reuses A's port for B, observe that same
    // port. If a real key preserved A, prepare B's different actual native path.
    // Never retain by package name/ID or manufacture a key before production does.
    bNative = insertionReboundOriginal ? aNative : cLibraryPublisherNativeForm(t, f, owner, { nextVersion: true,
      chooseInitialForm: forms => forms.find(form => form.port === cLibraryPackageCard(x, bVersion.packageId).form.port) });
    if (!bNative.disclosure().port.open) bNative.toggleDisclosure();
    bForm = bNative.fill(null, []).port; assert.deepEqual(bNative.raw(), []);
    bNative.fill(null, selected); assert.deepEqual(bNative.raw(), [["packageBlock", selected[0]]]);
    bDetails = bNative.disclosure().port; assert.equal(bDetails.open, true);
    assert.equal(cLibraryPackageCard(x, bVersion.packageId).form.port, bForm);
    assert.equal(observed.delivered(), false, "Current B work is prepared before releasing old A's original ACK");
    inserted.restore(); observed.gate.resolve(); await pending; assert.equal(await observed.join(), true);
    await f.settle(); await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
    assert.deepEqual(await h.history(), [...before.history, ...observed.auditEvents(), ...inserted.auditEvents()]);
    assert.equal(x.seedAuditEvents.length + observed.auditEvents().length + inserted.auditEvents().length, 8);
    assert.deepEqual(h.counts(), before.counts);
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    assert.equal(h.store.route.get(), before.route); assert.ok(owner.isConnected);
    for (const [record, input] of [[observed, original], [inserted, insertedOriginal]]) {
      assert.equal(record.calls.length, 1); assert.equal(record.calls[0].settled, true); assert.equal(record.calls[0].result, true);
      assert.deepEqual(record.records.map(row => row.status), [201, 200]); assert.equal(record.delivered(), true);
      const created = record.created(), share = h.worker.sharing;
      const version = h.worker.sqlite.prepare("SELECT * FROM organization_context_package_versions WHERE version_id=? AND package_id=?").get(created.versionId, created.packageId);
      assert.equal(version.status, "published"); assert.equal(version.approved_by_user_id, h.worker.owner);
      assert.equal(version.source_project_access_id, share.projectAccessId); assert.equal(version.source_document_id, h.ad);
      const content = h.worker.sqlite.prepare("SELECT content_json FROM organization_context_package_contents WHERE version_id=?").get(created.versionId);
      assert.equal(cLibraryPublisherSha(content.content_json), created.contentSha256);
      const snapshot = JSON.parse(content.content_json);
      assert.equal(snapshot.organizationId, share.organizationId); assert.equal(snapshot.sourceHead, input.head);
      assert.deepEqual(snapshot.blocks.map(block => block.sourceBlockId), selected);
      assert.equal(snapshot.blocks[0].properties.text, "The keeper checks the harbor.");
      const audits = h.worker.sqlite.prepare("SELECT actor_user_id,action FROM organization_audit_events WHERE resource_id=? ORDER BY action").all(created.versionId);
      assert.deepEqual(audits.map(row => row.action), ["OrganizationContextPackageVersionDrafted", "OrganizationContextPackageVersionPublished"]);
      assert.ok(audits.every(row => row.actor_user_id === h.worker.owner));
    }
    const previous = h.worker.sqlite.prepare("SELECT status,content_sha256 FROM organization_context_package_versions WHERE version_id=? AND package_id=?").get(existing.versionId, existing.packageId);
    assert.equal(previous.status, "published"); assert.equal(previous.content_sha256, existing.contentSha256);
    assert.deepEqual(h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET"
      && !h.navigationResumeReads.isReadOnlyResume(request)
      && ![...observed.records, ...inserted.records].some(row => row.request === request)), []);
    const currentA = cLibraryPackageCard(x, existing.packageId), currentB = cLibraryPackageCard(x, inserted.created().packageId);
    const bStillOpen = bNative.disclosure().port.open, bRaw = bNative.raw({ allowHidden: true });
    assert.equal(currentB.form.port, bForm); assert.equal(bNative.disclosure().port, bDetails);
    assert.deepEqual(bRaw, [["packageBlock", selected[0]]], "Equal values are not a certificate of same-package identity");
    t.diagnostic("C_LIBRARY_PACKAGE_REORDER " + JSON.stringify({ originalPackageId: existing.packageId,
      originalVersionId: observed.created().versionId, insertedPackageId: inserted.created().packageId,
      insertedVersionId: inserted.created().versionId, catalogOrder: h.store.organizationContextPackages.get().map(row => row.id),
      originalTemplatePath: originalPath, originalPackageStillOwnsForm, insertionReboundOriginal,
      currentOriginalStillOwnsForm: currentA.form.port === originalForm, currentBOpen: bStillOpen,
      currentBRaw: bRaw, actualResponseStatuses: [...observed.records, ...inserted.records].map(row => row.status),
      exactAuditEventsIncludingSeed: 8, submittedNewBVersion: false, sourceAndFiscalUnchanged: true,
      evidence: "actual current package responses/order; finite actual-template/path native lifetime, not a browser geometry certificate" }));
    assert.equal(originalPackageStillOwnsForm, true, "Inserting a different exact package cannot rebind A's still-connected native form to B");
    assert.equal(currentA.form.port, originalForm, "A's original form follows its package, not a positional catalog slot or new version ID");
    assert.equal(bStillOpen, true, "Old A completion cannot close current work in the different exact B package");
  } finally {
    observed.gate.resolve(); inserted?.gate.resolve();
    try { await Promise.all([pending, inserting].filter(Boolean)); } finally {
      try {
        if (observed.calls.length) await observed.join();
        if (inserted?.calls.length) await inserted.join();
      } finally {
        await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
        await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
        inserted?.restore(); observed.restore();
      }
    }
  }
  if (observed.errors.length || inserted?.errors.length || errors.length) throw observed.errors[0] ?? inserted?.errors[0] ?? errors[0];
});


// C continuation admission, distinct from original publisher ACK completion.
// Reuse the full authorized Library/native-form/Worker setup. Only next-version
// cases create one real version-1 package during setup; the tested card gesture
// must never submit a package, version, source edit, approval or paid request.
import { nextActionFacts as cLibraryDraftNextActionFacts } from "../src/state/next-action-context.ts";
import { creativeNextActions as cLibraryDraftNextActions } from "../src/model/workspace-intelligence.ts";
import { lifecycleButton as cLibraryDraftLifecycleButton, activateLifecycle as cLibraryDraftActivateLifecycle } from "./helpers/creative-next-action-navigation-fixture.mjs";

function cLibraryDraftNativeDefaults(t, f, owner) {
  const selector = ".library-organization-context form.workspace-settings-form input";
  const priorQuery = f.renderer.query, reflected = new Map();
  const currentInputs = () => {
    // The existing generic query port does not implement this descendant
    // selector. Use its actual same-snapshot tree, including closed details;
    // no port is selected, retained or keyed by a package/name/test value.
    const inputs = f.tree().nodes.filter(node => {
      if (node.owner !== owner || node.tag !== "input") return false;
      let form = null;
      for (let at = node.parent; at; at = at.parent) if (at.tag === "form") { form = at; break; }
      if (!form || !fObjectClassed(form, "workspace-settings-form")) return false;
      for (let at = form.parent; at; at = at.parent)
        if (at.owner === owner && fObjectClassed(at, "library-organization-context")) return true;
      return false;
    });
    assert.equal(new Set(inputs.map(node => node.port)).size, inputs.length, "Every real owned input has a distinct current native port");
    return inputs.map(node => {
      const port = node.port;
      assert.ok(port?.isConnected && port.owner === owner && f.renderer.nodes.includes(port));
      assert.equal(Object.hasOwn(node.properties, "value"), false, "This prerequisite does not substitute controlled fields");
      if (!reflected.has(port)) {
        const previous = Object.fromEntries(["defaultValue", "defaultChecked"].map(key => [key, Object.getOwnPropertyDescriptor(port, key)]));
        // Native defaults reflect the emitted content attributes, independently
        // of the current value/checked properties that the user may have changed.
        Object.defineProperty(port, "defaultValue", { configurable: true, get: () => String(port.getAttribute("value") ?? "") });
        Object.defineProperty(port, "defaultChecked", { configurable: true, get: () => Object.hasOwn(port.attributes, "checked") });
        reflected.set(port, previous);
      }
      return port;
    });
  };
  const query = function (current, requested) {
    return current === owner && requested === selector ? currentInputs() : Reflect.apply(priorQuery, this, [current, requested]);
  };
  f.renderer.query = query;
  t.after(() => {
    if (f.renderer.query === query) f.renderer.query = priorQuery;
    for (const [port, previous] of reflected) for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(port, key, descriptor); else delete port[key];
    }
  });
  return () => {
    const expected = currentInputs(), actual = [...owner.querySelectorAll(selector)];
    assert.deepEqual(actual, expected, "The exact ordinary descendant query sees the complete current native collection");
    return actual;
  };
}

for (const nextVersion of [false, true]) for (const changed of [false, true]) test(
  "C Library " + (nextVersion ? "next-version checkbox" : "publisher name") + " lifecycle departure / "
    + (changed ? "retains current raw edit" : "unchanged form reaches exact preparation"),
  fIntelligenceOptions, async t => {
    const locale = changed ? "ja" : "en";
    const x = nextVersion
      ? await cLibraryNextVersionPage(t, locale, { nativePreparation: true })
      : await cLibraryPublisherPage(t, locale, { nativePreparation: true });
    const { f, h, owner, selected } = x;
    // Finish the genuine setup read before observing this new user gesture.
    // No synthetic project, policy, permission, package or action is inserted.
    await h.store.refreshEvents({ fromStart: true }); await f.settle();
    // Store requestAnimationFrame uses the existing 16ms timer port, separate
    // from component frames. Drain setup route hydration/job reads BEFORE raw
    // edits and the request snapshot; the same drain after the card must not
    // misattribute previously queued setup work to a refused continuation.
    for (let attempt = 0; attempt < 8; attempt++) {
      await f.settle();
      for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
      await h.navigationResumeReads.settleOriginalRequests(); await new Promise(setImmediate);
    }
    await f.settle();
    assert.equal([...h.timers.values()].filter(timer => timer.delay === 16).length, 0, "No setup Store RAF remains queued before the new gesture");
    const setupRequests = h.requests.length;
    await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
    assert.equal(h.requests.length, setupRequests, "Setup transport settlement is quiescent before raw edits and admission accounting");
    await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
    assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0);
    assert.ok(owner.isConnected && f.native);
    assert.equal(h.store.projection.get().projectId, h.a);
    assert.equal(h.store.projection.get().documentId, h.ad);
    const native = nextVersion ? cLibraryPublisherNativeForm(t, f, owner, { nextVersion: true }) : x.native;
    let details = null;
    if (nextVersion) {
      assert.deepEqual(x.seedObservation.records.map(record => record.status), [201, 200]);
      assert.equal(x.seedAuditEvents.length, 3);
      assert.equal(x.seedObservation.calls.length, 1); assert.equal(x.seedObservation.calls[0].result, true);
      assert.equal(h.store.organizationContextPackages.get().filter(row => row.id === x.existing.packageId
        && row.versionId === x.existing.versionId && row.version === 1).length, 1);
      details = native.disclosure().port; assert.equal(details.open, false);
      native.toggleDisclosure(); assert.equal(native.disclosure().port, details); assert.equal(details.open, true);
    }
    const form = native.current().port, defaults = native.raw();
    assert.deepEqual(defaults, nextVersion ? [["packageBlock", selected[0]]]
      : [["packageName", ""], ["packageBlock", selected[0]]]);
    const nameB = "  Current unsent package B — 未送信  ";
    if (changed) native.fill(nextVersion ? null : nameB, nextVersion ? [] : selected);
    const raw = native.raw();
    assert.deepEqual(raw, changed ? nextVersion ? [] : [["packageName", nameB], ["packageBlock", selected[0]]] : defaults,
      "The changed case uses a genuinely enabled native field, not private component state or a submitted B");
    assert.equal(native.current().port, form); assert.ok(form.isConnected);
    if (details) assert.equal(details.open, true, "Both next-version variants start in the genuinely opened disclosure");
    const inputs = cLibraryDraftNativeDefaults(t, f, owner)();
    assert.equal(inputs.length, nextVersion ? 3 : 2, "Only the actual original-direction create/next-version controls are in scope");
    assert.equal(inputs.filter(input => input.getAttribute("type") === "checkbox"
      ? input.checked !== input.defaultChecked : input.value !== input.defaultValue).length, changed ? 1 : 0,
    "Native default reflection distinguishes the one genuine raw edit from an unchanged open form");

    const facts = cLibraryDraftNextActionFacts(h.store, h.ad, null, { lifecycle: true });
    assert.equal(facts.canRead && facts.canAuthor && facts.canConfigure, true);
    const actions = cLibraryDraftNextActions(facts).filter(action => action.target.kind === "configure");
    assert.equal(actions.length, 1, "The actual current shared policy offers one configure recommendation");
    const action = actions[0], target = JSON.stringify(action.target);
    assert.equal(action.target.medium, null); assert.equal(action.target.documentId, h.ad);
    assert.equal(action.target.projectId, h.a); assert.equal(action.target.canvasId, null);
    const button = cLibraryDraftLifecycleButton(f, action.id);
    assert.ok(button.port?.isConnected && button.owner.isConnected && button.owner.tag === "forma-ui-choice-card");
    assert.equal(button.port.matches(":disabled"), false);
    assert.equal(button.owner.closest("forma-library"), owner, "Use the real current Library card, not its shared helper directly");
    assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
    const receipts = () => h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
    const before = { route: h.store.route.get(), history: await h.history(), receipts: receipts(), counts: h.counts(),
      events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), requests: h.requests.length,
      source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(),
      session: JSON.stringify(h.store.session.get()), resets: native.resets.length, closes: native.closes.length,
      publisherAudits: h.libraryPublisherAudits.events(), versionAudits: h.libraryNextVersionAudits?.events() ?? [],
      trace: f.trace.length };
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    assert.equal(action.target.authorityKey, before.authorization.key);
    assert.equal(action.target.sourceGeneration, before.source.generation);

    try {
      f.native.emit("pointerdown", button.port); f.native.focus(button.port);
      cLibraryDraftActivateLifecycle(f, button);
      // The rendered callback is void. Reuse the explicit-media tests' bounded
      // real render/Store-RAF settling; do not replace the private handler or
      // manufacture a resolved application promise to join the opening.
      for (let attempt = 0; attempt < 8; attempt++) {
        await f.settle();
        for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
        await new Promise(setImmediate);
      }
      await h.navigationResumeReads.settleOriginalRequests(); await f.settle(); await h.worker.drainBackground();
      assert.ok(f.trace.slice(before.trace).includes("event:forma-action"), "The native ChoiceCard emitted the real semantic action");
      assert.equal(JSON.stringify(action.target), target);
      assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
      assert.equal(JSON.stringify(h.store.session.get()), before.session);
      assert.equal(h.store.projection.get().projectId, h.a); assert.equal(h.store.projection.get().documentId, h.ad);
      assert.deepEqual(await h.history(), before.history, "The entire actual canonical history, including accounted setup audits, is unchanged");
      assert.deepEqual(receipts(), before.receipts); assert.deepEqual(h.counts(), before.counts);
      assert.equal(JSON.stringify(h.store.events.get()), before.events); assert.equal(h.store.head.get(), before.head);
      assert.deepEqual(h.libraryPublisherAudits.events(), before.publisherAudits);
      assert.deepEqual(h.libraryNextVersionAudits?.events() ?? [], before.versionAudits);
      assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0);
      const requests = h.requests.slice(before.requests);
      assert.deepEqual(requests.filter(request => (request.init.method ?? "GET") !== "GET"
        && !h.navigationResumeReads.isReadOnlyResume(request)), [],
      "Only a separately certified exact free Resume read may use POST; there is no new package/version/approval/execution command");
      const dialogs = f.tree().visible("dialog").filter(node => node.port?.open);
      t.diagnostic("C_LIBRARY_PUBLISHER_LIFECYCLE_DEPARTURE " + JSON.stringify({ nextVersion, changed, locale,
        action: action.id, documentId: h.ad, routeUnchanged: h.store.route.get() === before.route,
        originalLibraryConnected: owner.isConnected, originalFormConnected: form.isConnected,
        rawAtGesture: raw, currentDialogClasses: dialogs.map(node => node.attributes.class),
        subsequentRequests: requests.length, newCommands: 0, canonicalHistoryAndReceiptsUnchanged: true,
        subsequentRequestSummary: requests.map(request => ({ method: request.init.method ?? "GET", url: request.url })),
        financialRowsUnchanged: true, seedAuditEvents: nextVersion ? x.seedAuditEvents.length : 0,
        evidence: "actual complete hosts and RAM Worker; finite native field/default lifetime, not physical keyboard or geometry evidence" }));
      if (changed) {
        assert.equal(h.store.route.get(), before.route, "A recommendation must not discard current raw organization-package work by leaving Library");
        assert.ok(owner.isConnected && form.isConnected); assert.equal(native.current().port, form);
        assert.deepEqual(native.raw(), raw); assert.equal(dialogs.length, 0);
        assert.equal(requests.length, 0, "Refusing this current draft departure does not initiate a destination read");
        assert.equal(native.resets.length, before.resets); assert.equal(native.closes.length, before.closes);
        if (details) { assert.equal(native.disclosure().port, details); assert.equal(details.open, true); }
        assert.equal(h.store.ui.toast, f.i18n.t("next.library.publisherDraft"));
        // This is an explicit recovery gesture AFTER the unchanged dirty-form
        // refusal assertions. Generic toast stays in this baseline so an absent
        // reset is reached before any future package-specific copy migration.
        // Reuse the existing occurrence lookup only for actual reset tokens;
        // create and next-version may have identical handler-free buttons.
        cLibraryPackageNativeOccurrences(t, f, owner, { resetButtons: true });
        const otherForm = nextVersion ? x.native.current().port : null, otherRaw = nextVersion ? x.native.raw() : null;
        const resetTree = f.tree(), currentForm = resetTree.visible("form").filter(node => node.owner === owner && node.port === form);
        assert.equal(currentForm.length, 1);
        const resets = resetTree.visible("button").filter(node => node.owner === owner
          && cLibraryPublisherWithin(node, currentForm[0]) && node.attributes.type === "reset"
          && node.text === f.i18n.t("output.requirement.discard"));
        assert.equal(resets.length, 1, "The current publishing form must expose its own native Discard changes control");
        const reset = resets[0];
        const visibleDiscard = f.i18n.t("output.requirement.discard"), projection = h.store.projection.get();
        const document = projection.documents.filter(item => item.id === h.ad && item.projectId === h.a && !item.removed);
        assert.equal(document.length, 1); assert.equal(projection.documentTitle, document[0].title);
        const packageRows = h.store.organizationContextPackages.get().filter(item => item.versionId);
        if (nextVersion) {
          assert.equal(packageRows.length, 1, "This actual fixture has one unambiguous published package, not synthetic collision coverage");
          assert.equal(packageRows[0].id, x.existing.packageId); assert.equal(packageRows[0].name, x.seed.name);
        }
        const exactResetScope = nextVersion ? x.seed.name
          : f.i18n.system("Publish decisions from the current document") + " · " + document[0].title;
        const isolatedResetScope = "\u2068" + exactResetScope + "\u2069";
        const expectedResetName = f.i18n.t("artifact.delivery.namedAction", "{action} — {name}",
          { action: visibleDiscard, name: isolatedResetScope });
        assert.equal(reset.text, visibleDiscard);
        assert.equal(reset.attributes["aria-label"], expectedResetName, "Accessible reset name identifies this exact package or current-Document form");
        assert.equal(reset.port.getAttribute("aria-label"), expectedResetName, "The actual native button exposes the same contextual name");
        assert.ok(expectedResetName.startsWith(reset.text)); assert.ok(expectedResetName.includes(isolatedResetScope));
        const namedResets = resetTree.visible("button").filter(node => node.owner === owner && node.attributes.type === "reset");
        assert.equal(namedResets.length, nextVersion ? 2 : 1);
        assert.equal(new Set(namedResets.map(node => node.attributes["aria-label"])).size, namedResets.length,
          "The current fixture's create and next-version controls have distinct accessible names");
        assert.ok(namedResets.every(node => typeof node.attributes["aria-label"] === "string"
          && node.attributes["aria-label"].startsWith(node.text) && node.text === visibleDiscard));
        assert.ok(reset.port?.isConnected && f.renderer.nodes.includes(reset.port));
        assert.equal(reset.port.getAttribute("type"), "reset");
        assert.equal(reset.port.closest("form"), form, "The actual reset occurrence belongs to this exact native form");
        assert.equal(reset.port.matches(":disabled"), false); assert.equal(Object.hasOwn(reset.attributes, "disabled"), false);
        assert.equal(reset.handlers.click, undefined, "No application click handler competes with this native default");
        assert.equal(currentForm[0].handlers.reset, undefined, "No application reset handler prevents or replaces the native default");
        assert.equal(typeof form.reset, "function");
        const resetRequests = h.requests.length, resetCount = native.resets.length;
        f.native.emit("pointerdown", reset.port); f.native.focus(reset.port);
        // The existing fixture models native form.reset(), not reset-button
        // default dispatch. With no competing/canceling handler above, deliver
        // only that explicit native default; never submit or call app methods.
        form.reset(); await f.settle();
        await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
        assert.equal(native.resets.length, resetCount + 1);
        assert.equal(native.resets.at(-1).form, form); assert.deepEqual(native.resets.at(-1).before, raw);
        assert.equal(native.current().port, form); assert.deepEqual(native.raw(), defaults);
        assert.equal(h.store.route.get(), before.route); assert.ok(owner.isConnected && form.isConnected);
        assert.equal(native.closes.length, before.closes);
        if (details) { assert.equal(native.disclosure().port, details); assert.equal(details.open, true); }
        if (nextVersion) { assert.equal(x.native.current().port, otherForm); assert.deepEqual(x.native.raw(), otherRaw); }
        assert.equal(h.requests.length, resetRequests, "Native local discard initiates no request");
        assert.deepEqual(await h.history(), before.history); assert.deepEqual(receipts(), before.receipts);
        assert.deepEqual(h.counts(), before.counts); assert.equal(JSON.stringify(h.store.events.get()), before.events);
        assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
        assert.equal(JSON.stringify(h.store.session.get()), before.session);
        assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0, "Discard does not auto-open or navigate");

        const currentActions = cLibraryDraftNextActions(cLibraryDraftNextActionFacts(h.store, h.ad, null, { lifecycle: true }))
          .filter(candidate => candidate.id === action.id && JSON.stringify(candidate.target) === target);
        assert.equal(currentActions.length, 1, "Discard leaves the original exact current recommendation eligible");
        const fresh = cLibraryDraftLifecycleButton(f, action.id), freshTrace = f.trace.length;
        assert.ok(fresh.port?.isConnected); assert.equal(fresh.port.matches(":disabled"), false);
        assert.equal(fresh.owner.closest("forma-library"), owner);
        f.native.emit("pointerdown", fresh.port); f.native.focus(fresh.port); cLibraryDraftActivateLifecycle(f, fresh);
        for (let attempt = 0; attempt < 8; attempt++) {
          await f.settle();
          for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
          await new Promise(setImmediate);
        }
        await h.navigationResumeReads.settleOriginalRequests(); await f.settle(); await h.worker.drainBackground();
        assert.ok(f.trace.slice(freshTrace).includes("event:forma-action"), "A new real native gesture, not Discard itself, starts the continuation");
        assert.equal(documentIdFromRoute(h.store.route.get()), h.ad); assert.notEqual(h.store.route.get(), before.route);
        assert.equal(h.store.projection.get().projectId, h.a); assert.equal(h.store.projection.get().documentId, h.ad);
        const afterDiscardDialogs = f.tree().visible("dialog").filter(node => node.port?.open);
        assert.equal(afterDiscardDialogs.length, 1); assert.ok(fObjectClassed(afterDiscardDialogs[0], "next-format-dialog"));
        assert.equal(afterDiscardDialogs[0].owner.tag, "forma-workspace"); assert.equal(afterDiscardDialogs[0].owner.store, h.store);
        assert.ok(afterDiscardDialogs[0].owner.isConnected);
        assert.deepEqual(await h.history(), before.history); assert.deepEqual(receipts(), before.receipts); assert.deepEqual(h.counts(), before.counts);
        assert.equal(JSON.stringify(h.store.events.get()), before.events); assert.equal(h.store.head.get(), before.head);
        assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
        assert.equal(JSON.stringify(h.store.session.get()), before.session);
        assert.deepEqual(h.libraryPublisherAudits.events(), before.publisherAudits);
        assert.deepEqual(h.libraryNextVersionAudits?.events() ?? [], before.versionAudits);
        assert.deepEqual(h.requests.slice(resetRequests).filter(request => (request.init.method ?? "GET") !== "GET"
          && !h.navigationResumeReads.isReadOnlyResume(request)), []);
        assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0);
        t.diagnostic("C_LIBRARY_PUBLISHER_NATIVE_DISCARD " + JSON.stringify({ nextVersion, locale,
          sameFormReset: true, exactDefaultsRestored: true, otherFormUnchanged: nextVersion ? true : null,
          resetRequests: 0, resetAutoNavigation: false, nextVersionDisclosureKeptOpen: nextVersion ? true : null,
          freshGestureReachedExactChooser: true, documentId: h.ad, newCommands: 0,
          canonicalHistoryAndReceiptsUnchanged: true, financialRowsUnchanged: true,
          evidence: "actual visible reset control and existing public native form.reset port; no pending-publication cancellation or physical-browser claim" }));
      } else {
        assert.equal(documentIdFromRoute(h.store.route.get()), h.ad, "An unchanged native form does not blanket-block the exact current continuation");
        assert.notEqual(h.store.route.get(), before.route);
        const chooser = dialogs.filter(node => fObjectClassed(node, "next-format-dialog"));
        assert.equal(chooser.length, 1); assert.equal(dialogs.length, 1);
        assert.equal(chooser[0].owner.tag, "forma-workspace"); assert.equal(chooser[0].owner.store, h.store);
        assert.ok(chooser[0].owner.isConnected);
      }
    } finally {
      await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
      await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
    }
  });


// C command-origin admission: the same actual publisher forms and native
// defaults as the four lifecycle cases, but the genuine Shell command menu.
// No submitted B, replacement component, shared fixture change, or paid work.
for (const nextVersion of [false, true]) for (const changed of [false, true]) test(
  "C Library " + (nextVersion ? "next-version checkbox" : "publisher name") + " command departure / "
    + (changed ? "retains current raw edit" : "unchanged form reaches exact preparation"),
  fIntelligenceOptions, async t => {
    const locale = changed ? "ja" : "en";
    const x = nextVersion
      ? await cLibraryNextVersionPage(t, locale, { nativePreparation: true })
      : await cLibraryPublisherPage(t, locale, { nativePreparation: true });
    const { f, h, owner, selected } = x;
    await h.store.refreshEvents({ fromStart: true }); await f.settle();
    // Reuse the explicit C67 setup drain before this independent gesture's
    // transport snapshot. Refusal still requires zero attributable requests.
    for (let attempt = 0; attempt < 8; attempt++) {
      await f.settle();
      for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
      await h.navigationResumeReads.settleOriginalRequests(); await new Promise(setImmediate);
    }
    await f.settle();
    assert.equal([...h.timers.values()].filter(timer => timer.delay === 16).length, 0);
    const setupRequests = h.requests.length;
    await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
    assert.equal(h.requests.length, setupRequests, "Setup transport is quiescent before command accounting");
    await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
    assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0);
    assert.ok(owner.isConnected && f.native);
    assert.equal(h.store.projection.get().projectId, h.a); assert.equal(h.store.projection.get().documentId, h.ad);
    const native = nextVersion ? cLibraryPublisherNativeForm(t, f, owner, { nextVersion: true }) : x.native;
    let details = null;
    if (nextVersion) {
      assert.deepEqual(x.seedObservation.records.map(record => record.status), [201, 200]);
      assert.equal(x.seedAuditEvents.length, 3);
      assert.equal(x.seedObservation.calls.length, 1); assert.equal(x.seedObservation.calls[0].result, true);
      assert.equal(h.store.organizationContextPackages.get().filter(row => row.id === x.existing.packageId
        && row.versionId === x.existing.versionId && row.version === 1).length, 1);
      details = native.disclosure().port; assert.equal(details.open, false);
      native.toggleDisclosure(); assert.equal(native.disclosure().port, details); assert.equal(details.open, true);
    }
    const form = native.current().port, defaults = native.raw();
    assert.deepEqual(defaults, nextVersion ? [["packageBlock", selected[0]]]
      : [["packageName", ""], ["packageBlock", selected[0]]]);
    const nameB = "  Current unsent command-origin B — 未送信  ";
    if (changed) native.fill(nextVersion ? null : nameB, nextVersion ? [] : selected);
    const raw = native.raw();
    assert.deepEqual(raw, changed ? nextVersion ? [] : [["packageName", nameB], ["packageBlock", selected[0]]] : defaults);
    assert.equal(native.current().port, form); assert.ok(form.isConnected);
    if (details) assert.equal(details.open, true);
    const inputs = cLibraryDraftNativeDefaults(t, f, owner)();
    assert.equal(inputs.length, nextVersion ? 3 : 2);
    assert.equal(inputs.filter(input => input.getAttribute("type") === "checkbox"
      ? input.checked !== input.defaultChecked : input.value !== input.defaultValue).length, changed ? 1 : 0,
    "Exactly one enabled current raw field distinguishes dirty from clean; no broader default substitution");
    const facts = cLibraryDraftNextActionFacts(h.store, h.ad, null, { lifecycle: true });
    assert.equal(facts.canRead && facts.canAuthor && facts.canConfigure, true);
    const configured = cLibraryDraftNextActions(facts).filter(action => action.target.kind === "configure");
    assert.equal(configured.length, 1); assert.equal(configured[0].target.medium, null);
    assert.equal(configured[0].target.documentId, h.ad); assert.equal(configured[0].target.projectId, h.a);
    assert.equal(configured[0].target.canvasId, null);
    assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
    const receipts = () => h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
    const before = { route: h.store.route.get(), documentTitle: h.store.projection.get().documentTitle,
      history: await h.history(), receipts: receipts(), counts: h.counts(),
      events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), requests: h.requests.length,
      source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(),
      session: JSON.stringify(h.store.session.get()), resets: native.resets.length, closes: native.closes.length,
      publisherAudits: h.libraryPublisherAudits.events(), versionAudits: h.libraryNextVersionAudits?.events() ?? [] };
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    try {
      const trigger = f.find("button", node => node.owner.tag === "forma-shell" && fObjectClassed(node, "command-trigger"));
      assert.ok(trigger.port?.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
      f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port);
      const copy = commandDiscoveryCopy(locale);
      await openDiscoverySearch(f, copy.prepare);
      const input = f.find("input", node => node.owner.tag === "forma-shell" && node.attributes.id === "command-search");
      assert.ok(input.port?.isConnected); assert.equal(input.port.value, copy.prepare);
      assert.equal(h.store.route.get(), before.route); assert.ok(owner.isConnected && form.isConnected);
      assert.equal(native.current().port, form); assert.deepEqual(native.raw(), raw);
      assert.equal(h.requests.length, before.requests, "Opening and searching commands must not read or mutate the destination");
      const commandTree = f.tree(), dialogs = commandTree.visible("dialog").filter(node => node.port?.open);
      assert.equal(dialogs.length, 1); assert.ok(fObjectClassed(dialogs[0], "command-dialog"));
      assert.equal(dialogs[0].owner.tag, "forma-shell"); assert.equal(dialogs[0].owner.store, h.store);
      const options = commandTree.visible("button").filter(node => node.owner === dialogs[0].owner
        && node.attributes.role === "option" && node.children.some(child => typeof child !== "string"
          && child.tag === "span" && child.text === copy.prepare));
      assert.equal(options.length, 1, "The genuine generic preparation command has one exact visible row");
      const option = options[0], hints = option.children.filter(child => typeof child !== "string" && child.tag === "small");
      assert.equal(hints.length, 1);
      assert.equal(hints[0].text, [h.store.projection.get().documentTitle, h.store.projection.get().projectName, copy.preparing].join(" · "));
      assert.ok(option.port?.isConnected && f.renderer.nodes.includes(option.port));
      assert.equal(option.port.matches(":disabled"), false);
      f.native.emit("pointerdown", option.port); f.native.focus(option.port);
      const focusStart = f.native.nativeFocus.length, scrollStart = f.native.nativeScroll.length;
      await f.act(option, "click", { button: 0 });
      // The existing row callback is void. Settle actual component/Store RAFs;
      // do not extract a handler or manufacture an application result promise.
      for (let attempt = 0; attempt < 8; attempt++) {
        await f.settle();
        for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
        await new Promise(setImmediate);
      }
      await h.navigationResumeReads.settleOriginalRequests(); await f.settle(); await h.worker.drainBackground();
      assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
      assert.equal(JSON.stringify(h.store.session.get()), before.session);
      assert.equal(h.store.projection.get().projectId, h.a); assert.equal(h.store.projection.get().documentId, h.ad);
      assert.deepEqual(await h.history(), before.history); assert.deepEqual(receipts(), before.receipts);
      assert.deepEqual(h.counts(), before.counts); assert.equal(JSON.stringify(h.store.events.get()), before.events);
      assert.equal(h.store.head.get(), before.head);
      assert.deepEqual(h.libraryPublisherAudits.events(), before.publisherAudits);
      assert.deepEqual(h.libraryNextVersionAudits?.events() ?? [], before.versionAudits);
      assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0);
      const requests = h.requests.slice(before.requests);
      assert.deepEqual(requests.filter(request => (request.init.method ?? "GET") !== "GET"
        && !h.navigationResumeReads.isReadOnlyResume(request)), [],
      "Only independently certified original free Resume reads can use POST; no publishing, approval, or execution command");
      const afterTree = f.tree(), afterDialogs = afterTree.visible("dialog").filter(node => node.port?.open);
      const destinationDialogs = afterDialogs.filter(node => !fObjectClassed(node, "command-dialog"));
      const lateFocus = f.native.nativeFocus.slice(focusStart), lateScroll = f.native.nativeScroll.slice(scrollStart);
      t.diagnostic("C_LIBRARY_PUBLISHER_COMMAND_DEPARTURE " + JSON.stringify({ nextVersion, changed, locale,
        originalDocumentId: h.ad, command: copy.prepare, rawAtGesture: raw,
        routeUnchanged: h.store.route.get() === before.route, originalLibraryConnected: owner.isConnected,
        originalFormConnected: form.isConnected, destinationDialogClasses: destinationDialogs.map(node => node.attributes.class),
        subsequentRequests: requests.map(request => ({ method: request.init.method ?? "GET", url: request.url })),
        lateFocusOwners: lateFocus.map(call => call.node.owner?.tag ?? null), lateScrollCalls: lateScroll.length,
        canonicalHistoryAndReceiptsUnchanged: true, financialRowsUnchanged: true, newCommands: 0,
        evidence: "actual Shell command and Library/Store/RAM Worker; finite native form/default/focus ports, not physical browser evidence" }));
      if (changed) {
        assert.equal(h.store.route.get(), before.route, "A named command must not discard the same raw publisher work protected from lifecycle cards");
        assert.ok(owner.isConnected && form.isConnected); assert.equal(native.current().port, form);
        assert.deepEqual(native.raw(), raw); assert.equal(destinationDialogs.length, 0);
        assert.equal(requests.length, 0, "Dirty command refusal starts no attributable destination transport");
        assert.equal(native.resets.length, before.resets); assert.equal(native.closes.length, before.closes);
        if (details) { assert.equal(native.disclosure().port, details); assert.equal(details.open, true); }
        assert.equal(lateFocus.some(call => call.node.owner?.tag === "forma-workspace"), false,
          "A refused departure must not transfer focus into a replacement Workspace");
        assert.equal(lateScroll.length, 0, "A refused departure does not scroll a destination");
      } else {
        assert.equal(documentIdFromRoute(h.store.route.get()), h.ad); assert.notEqual(h.store.route.get(), before.route);
        assert.equal(h.store.route.get(), withDocumentInRoute("/", h.ad, before.documentTitle),
          "Healthy preparation uses the exact current Document destination, not a pathname-only substitute");
        assert.equal(owner.isConnected, false, "Healthy command actually leaves the original Library");
        assert.equal(afterDialogs.length, 1); assert.equal(destinationDialogs.length, 1);
        const chooser = destinationDialogs[0]; assert.ok(fObjectClassed(chooser, "next-format-dialog"));
        assert.equal(chooser.owner.tag, "forma-workspace"); assert.equal(chooser.owner.store, h.store);
        assert.ok(chooser.owner.isConnected && chooser.port?.open);
        const inside = node => { for (let at = node; at; at = at.parent) if (at === chooser) return true; return false; };
        assert.equal(afterTree.nodes.filter(node => node.tag === "forma-ui-choice-card" && node.component?.isConnected
          && !node.hiddenBy && inside(node)).length, 7, "The healthy command reaches its genuine seven-format chooser");
      }
    } finally {
      await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
      await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
    }
  });


// C Sessions command-origin admission reuses the complete existing Sessions
// page and its actual .value/input path. The three rows differ only in local
// intent entry; none records an intent, composes a brief, or creates a blank.
async function cSessionCommandSettle(f) {
  const h = f.navigationHost;
  for (let attempt = 0; attempt < 8; attempt++) {
    await f.settle();
    // Deliver only the already-scheduled Store RAF, as in Library command
    // coverage above; do not advance arbitrary timers or invoke app methods.
    for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
    await h.navigationResumeReads.settleOriginalRequests(); await new Promise(setImmediate);
  }
  await f.settle(); await h.worker.drainBackground();
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 16).length, 0);
  assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0);
}
// Literal native ports are re-collected on each fixture draw; only the actual
// component owner and its exact current control/PropertyPart are stable here.
// Do not infer physical DOM/focus identity from an earlier port snapshot.
function cSessionCommandIntentControls(x, expectedRaw, expectedPart = null) {
  const { f, h, owner } = x, tree = f.tree();
  assert.ok(owner.isConnected && f.components().includes(owner));
  assert.equal(owner.store, h.store);
  const forms = tree.visible("form").filter(node => node.owner === owner && fSessionDraftClass(node, "intent-card"));
  const fields = tree.visible("textarea").filter(node => node.owner === owner && node.attributes.id === "session-intent-statement");
  assert.equal(forms.length, 1); assert.equal(fields.length, 1);
  const form = forms[0], field = fields[0];
  for (const node of [form, field]) {
    assert.equal(node.port?.owner, owner); assert.ok(node.port.isConnected && f.renderer.nodes.includes(node.port));
  }
  assert.equal(field.port.matches(":disabled"), false); assert.equal(Object.hasOwn(field.attributes, "disabled"), false);
  let ancestor = field.parent; while (ancestor && ancestor !== form) ancestor = ancestor.parent;
  assert.equal(ancestor, form, "The exact current intent field belongs to the same current intent form in one rendered tree");
  assert.equal(typeof field.handlers.input, "function"); assert.equal(typeof form.handlers.submit, "function");
  assert.equal(typeof field.propertyParts.value, "string");
  if (expectedPart !== null) assert.equal(field.propertyParts.value, expectedPart, "Same owner/template/intent PropertyPart, not another similarly named control");
  assert.equal(field.properties.value, expectedRaw); assert.equal(field.port.value, expectedRaw);
  return { form, field, part: field.propertyParts.value };
}
for (const [state, locale] of [["pristine", "en"], ["raw", "ja"], ["cleared", "ja"]]) test(
  "C Sessions intent command departure / " + locale + " / " + state,
  fIntelligenceOptions, async t => {
    const x = await fSessionPage(t, locale, "thread", { eligible: false }), { f, h, owner } = x;
    const initialControls = cSessionCommandIntentControls(x, ""), initial = initialControls.field, intentPart = initialControls.part;
    assert.ok(f.native && initial.port.isConnected && initialControls.form.port.isConnected && owner.isConnected);
    assert.equal(initial.properties.value, "", "The actual .value-bound field starts pristine, without a defaultValue surrogate");
    assert.equal(initial.port.value, "");
    const raw = "  Current unsent Sessions intent — 未送信\n  ";
    if (state !== "pristine") {
      f.native.emit("pointerdown", initial.port); f.native.focus(initial.port);
      await fSessionDraftType(x, "intent", raw);
      cSessionCommandIntentControls(x, raw, intentPart);
      assert.equal(fSessionDraftField(x, "intent").properties.value, raw, "The native input event reached the real owner-local field");
      if (state === "cleared") {
        await fSessionDraftType(x, "intent", "");
        cSessionCommandIntentControls(x, "", intentPart);
        assert.equal(fSessionDraftField(x, "intent").properties.value, "", "Deliberate editing, not reset or departure, cleared the raw intent");
      }
    }
    const expectedRaw = state === "raw" ? raw : "", currentControls = cSessionCommandIntentControls(x, expectedRaw, intentPart);
    assert.equal(currentControls.field.attributes.id, initial.attributes.id);
    assert.equal(currentControls.form.attributes.class, initialControls.form.attributes.class);
    assert.equal(currentControls.field.port.value, expectedRaw); assert.equal(h.store.route.get(), "/sessions"); h.exact();
    await cSessionCommandSettle(f);
    const setupRequests = h.requests.length;
    await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
    assert.equal(h.requests.length, setupRequests, "Setup transport is quiescent before this actual command gesture");
    cSessionCommandIntentControls(x, expectedRaw, intentPart);
    assert.equal(h.briefReceipts.records().length, 0);
    const before = { route: h.store.route.get(), documentTitle: h.store.projection.get().documentTitle,
      history: await h.history(), counts: h.counts(), events: JSON.stringify(h.store.events.get()), head: h.store.head.get(),
      source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(),
      session: JSON.stringify(h.store.session.get()), requests: h.requests.length };
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    try {
      const trigger = f.find("button", node => node.owner === f.host && fObjectClassed(node, "command-trigger"));
      assert.ok(trigger.port.isConnected); assert.equal(trigger.port.matches(":disabled"), false);
      f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port);
      const copy = commandDiscoveryCopy(locale);
      await openDiscoverySearch(f, copy.prepare);
      const input = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search");
      assert.equal(input.port.value, copy.prepare); assert.ok(input.port.isConnected);
      const searchedControls = cSessionCommandIntentControls(x, expectedRaw, intentPart);
      assert.equal(h.store.route.get(), before.route);
      assert.ok(owner.isConnected && searchedControls.form.port.isConnected && searchedControls.field.port.isConnected);
      assert.equal(searchedControls.field.attributes.id, initial.attributes.id); assert.equal(searchedControls.field.port.value, expectedRaw);
      assert.equal(h.requests.length, before.requests, "Opening and searching the palette neither submits the intent nor reads a destination");
      const tree = f.tree(), dialogs = tree.visible("dialog").filter(node => node.port?.open);
      assert.equal(dialogs.length, 1); assert.equal(dialogs[0].owner, f.host);
      assert.ok(fObjectClassed(dialogs[0], "command-dialog"));
      const options = tree.visible("button").filter(node => node.owner === f.host && node.attributes.role === "option"
        && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === copy.prepare));
      assert.equal(options.length, 1, "One exact localized current-Document preparation command");
      const option = options[0], hints = option.children.filter(child => typeof child !== "string" && child.tag === "small");
      assert.equal(hints.length, 1);
      assert.equal(hints[0].text, [before.documentTitle, h.store.projection.get().projectName, copy.preparing].join(" · "));
      assert.ok(option.port.isConnected && f.renderer.nodes.includes(option.port));
      assert.equal(option.port.matches(":disabled"), false);
      f.native.emit("pointerdown", option.port); f.native.focus(option.port);
      const focusStart = f.native.nativeFocus.length, scrollStart = f.native.nativeScroll.length;
      await f.act(option, "click", { button: 0 }); await cSessionCommandSettle(f);
      assert.equal(h.store.ui.commandOpen, false);
      assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
      assert.equal(JSON.stringify(h.store.session.get()), before.session); h.exact();
      assert.deepEqual(await h.history(), before.history); assert.deepEqual(h.counts(), before.counts);
      assert.equal(JSON.stringify(h.store.events.get()), before.events); assert.equal(h.store.head.get(), before.head);
      assert.equal(h.briefReceipts.records().length, 0);
      await fSessionNoExtraEffects(x);
      const requests = h.requests.slice(before.requests);
      assert.deepEqual(requests.filter(request => (request.init.method ?? "GET") !== "GET"
        && !h.navigationResumeReads.isReadOnlyResume(request)), [],
      "No intent, blank, brief, approval or paid command; only separately certified original free Resume POST is eligible");
      const afterTree = f.tree(), afterDialogs = afterTree.visible("dialog").filter(node => node.port?.open);
      const lateFocus = f.native.nativeFocus.slice(focusStart), lateScroll = f.native.nativeScroll.slice(scrollStart);
      t.diagnostic("C_SESSIONS_INTENT_COMMAND_DEPARTURE " + JSON.stringify({ state, locale,
        originalDocumentId: h.ad, command: copy.prepare, rawLengthAtGesture: expectedRaw.length,
        routeUnchanged: h.store.route.get() === before.route, originalSessionsConnected: owner.isConnected,
        currentIntentFields: afterTree.visible("textarea").filter(node => node.owner === owner && node.attributes.id === "session-intent-statement")
          .map(node => ({ connected: node.port?.isConnected === true, samePropertyPart: node.propertyParts.value === intentPart, rawPreserved: node.port?.value === expectedRaw })),
        destinationDialogClasses: afterDialogs.map(node => node.attributes.class),
        subsequentRequests: requests.map(request => ({ method: request.init.method ?? "GET", url: request.url })),
        lateFocusOwners: lateFocus.map(call => call.node.owner?.tag ?? null), lateScrollCalls: lateScroll.length,
        canonicalAndFinancialRowsUnchanged: true, submittedIntentsOrBriefs: 0,
        evidence: "actual Shell/Sessions/Workspace/Store/RAM Worker with finite native input and focus ports, not a physical browser" }));
      if (state === "raw") {
        assert.equal(h.store.route.get(), before.route, "A command must not discard current owner-local Sessions intent");
        const retainedControls = cSessionCommandIntentControls(x, raw, intentPart);
        assert.ok(owner.isConnected && retainedControls.form.port.isConnected && retainedControls.field.port.isConnected);
        assert.equal(retainedControls.form.attributes.class, initialControls.form.attributes.class);
        assert.equal(retainedControls.field.attributes.id, initial.attributes.id);
        assert.equal(retainedControls.field.port.value, raw); assert.equal(fSessionDraftField(x, "intent").properties.value, raw);
        assert.equal(afterDialogs.length, 0); assert.equal(requests.length, 0, "Refusal starts no attributable destination transport");
        assert.equal(lateFocus.some(call => call.node.owner?.tag === "forma-workspace"), false);
        assert.equal(lateScroll.length, 0);
      } else {
        assert.equal(h.store.route.get(), withDocumentInRoute("/", h.ad, before.documentTitle));
        assert.equal(documentIdFromRoute(h.store.route.get()), h.ad); assert.notEqual(h.store.route.get(), before.route);
        assert.equal(owner.isConnected, false, "Pristine or deliberately cleared intent permits a genuine departure");
        assert.equal(afterDialogs.length, 1);
        const chooser = afterDialogs[0]; assert.ok(fObjectClassed(chooser, "next-format-dialog"));
        assert.equal(chooser.owner.tag, "forma-workspace"); assert.equal(chooser.owner.store, h.store);
        assert.ok(chooser.owner.isConnected && chooser.port?.open);
        const inside = node => { for (let at = node; at; at = at.parent) if (at === chooser) return true; return false; };
        assert.equal(afterTree.nodes.filter(node => node.tag === "forma-ui-choice-card" && node.component?.isConnected
          && !node.hiddenBy && inside(node)).length, 7, "The healthy command arrives at all seven actual format choices");
      }
    } finally {
      await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
      await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
    }
  });


// Conditional regression control over the command-origin base: one finite
// adversarial notification/history ordering, not physical browser task timing.
// No app method, updateComplete, f.tick, native renderer or raw field is replaced.
test("C Library dirty command refusal never revives opener after native route ABA", fIntelligenceOptions, async t => {
  const { f, h, owner, native, selected } = await cLibraryPublisherPage(t, "en", { nativePreparation: true });
  f.nativeHistoryLocation = h.location; // Existing opt-in native Location port.
  await h.store.refreshEvents({ fromStart: true }); await f.settle();
  for (let attempt = 0; attempt < 8; attempt++) {
    await f.settle();
    for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
    await h.navigationResumeReads.settleOriginalRequests(); await new Promise(setImmediate);
  }
  await f.settle(); await h.worker.drainBackground();
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 16).length, 0);
  assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0);
  const setupRequests = h.requests.length; await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
  assert.equal(h.requests.length, setupRequests);
  const rawName = "  Retained Library B during history round trip — 未送信  ";
  const form = native.fill(rawName, selected).port, raw = native.raw();
  assert.deepEqual(raw, [["packageName", rawName], ["packageBlock", selected[0]]]);
  const inputs = cLibraryDraftNativeDefaults(t, f, owner)();
  assert.equal(inputs.length, 2);
  assert.equal(inputs.filter(input => input.getAttribute("type") === "checkbox"
    ? input.checked !== input.defaultChecked : input.value !== input.defaultValue).length, 1);
  assert.ok(owner.isConnected && form.isConnected); assert.equal(native.current().port, form);
  const activity = f.task("/activity"), routeB = activity.attributes.href, routeA = h.store.route.get();
  assert.ok(activity.port.isConnected); assert.equal(activity.port.getAttribute("href"), routeB);
  assert.equal(routeB, withProjectTaskDocumentInRoute("/activity", h.ad, routeA));
  assert.notEqual(routeB, routeA); assert.equal(projectTaskDocumentIdFromRoute(routeB), h.ad);
  assert.equal(h.location.pathname + h.location.search + h.location.hash, routeA);
  assert.equal(f.native.listeners("popstate"), 1, "The actual current Shell owns the history callback");
  const receipts = () => h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
  const before = { history: await h.history(), receipts: receipts(), counts: h.counts(), requests: h.requests.length,
    events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), session: JSON.stringify(h.store.session.get()),
    source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(),
    resets: native.resets.length, closes: native.closes.length, audits: h.libraryPublisherAudits.events(),
    toastTimers: new Set([...h.timers].filter(([, timer]) => timer.delay === 2800).map(([id]) => id)) };
  assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
  const expectedNotice = f.i18n.t("next.library.publisherDraft"), copy = commandDiscoveryCopy("en");
  assert.notEqual(h.store.ui.toast, expectedNotice);
  const trigger = f.find("button", node => node.owner === f.host && fObjectClassed(node, "command-trigger"));
  f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port);
  await openDiscoverySearch(f, copy.prepare);
  const input = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search");
  assert.ok(input.port.isConnected); assert.equal(input.port.value, copy.prepare);
  assert.equal(h.store.route.get(), routeA); assert.equal(h.requests.length, before.requests);
  assert.equal(native.current().port, form); assert.deepEqual(native.raw(), raw);
  const commandTree = f.tree(), dialogs = commandTree.visible("dialog").filter(node => node.owner === f.host
    && fObjectClassed(node, "command-dialog") && node.port?.open);
  assert.equal(dialogs.length, 1);
  const rows = commandTree.visible("button").filter(node => node.owner === f.host && node.attributes.role === "option"
    && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === copy.prepare));
  assert.equal(rows.length, 1); assert.ok(rows[0].port.isConnected); assert.equal(rows[0].port.matches(":disabled"), false);
  let entered = false, observerError = null, focusStart = -1, scrollStart = -1;
  const transitions = [], ownerAtHistory = [], noticeAtHistory = [];
  // Observe the genuine refusal; do not substitute toast, the dispatcher or its
  // awaited update. Deliver both native history events before the ordinary
  // batched redraw. This is an explicit finite adversarial order, not proof of
  // a physical browser's queued-task interleave inside Lit's short microtask.
  const unsubscribe = h.store.subscribe(() => {
    if (entered || h.store.ui.commandOpen || h.store.ui.toast !== expectedNotice) return;
    entered = true; focusStart = f.native.nativeFocus.length; scrollStart = f.native.nativeScroll.length;
    try {
      ports.bindFixture(f);
      for (const destination of [routeB, routeA]) {
        const oldRoute = h.store.route.get(), listeners = f.native.listeners("popstate");
        history.pushState({}, "", destination);
        const beforeEvent = h.store.route.get(), nativeRoute = h.location.pathname + h.location.search + h.location.hash;
        f.native.emit("popstate");
        transitions.push({ oldRoute, beforeEvent, nativeRoute, afterEvent: h.store.route.get(), listeners });
        ownerAtHistory.push({ library: owner.isConnected, form: form.isConnected });
        noticeAtHistory.push(h.store.ui.toast);
      }
    } catch (error) { observerError = error; }
  });
  t.after(unsubscribe);
  const traceStart = f.trace.length;
  try {
    f.native.emit("pointerdown", rows[0].port); f.native.focus(rows[0].port);
    await f.act(rows[0], "click", { button: 0 });
    for (let attempt = 0; attempt < 8; attempt++) {
      await f.settle();
      for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
      await new Promise(setImmediate);
    }
    await h.navigationResumeReads.settleOriginalRequests(); await f.settle(); await h.worker.drainBackground();
    if (observerError) throw observerError;
    assert.equal(entered, true, "Prerequisite: installed command-origin base reaches the actual dirty refusal; old unguarded runtime is not this baseline");
    assert.deepEqual(transitions, [
      { oldRoute: routeA, beforeEvent: routeA, nativeRoute: routeB, afterEvent: routeB, listeners: 1 },
      { oldRoute: routeB, beforeEvent: routeB, nativeRoute: routeA, afterEvent: routeA, listeners: 1 },
    ], "Native location alone does not update Store; both actual Shell popstate callbacks do");
    assert.deepEqual(ownerAtHistory, [{ library: true, form: true }, { library: true, form: true }],
      "Both native events precede ordinary redraw; no replacement owner makes the test pass");
    assert.deepEqual(noticeAtHistory, [expectedNotice, expectedNotice], "The initial legitimate refusal notice is allowed");
    assert.equal(h.store.route.get(), routeA); assert.equal(h.location.pathname + h.location.search + h.location.hash, routeA);
    assert.ok(owner.isConnected && form.isConnected); assert.equal(native.current().port, form); assert.deepEqual(native.raw(), raw);
    assert.equal(native.resets.length, before.resets); assert.equal(native.closes.length, before.closes);
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    assert.equal(JSON.stringify(h.store.session.get()), before.session);
    assert.equal(h.store.projection.get().projectId, h.a); assert.equal(h.store.projection.get().documentId, h.ad);
    assert.deepEqual(await h.history(), before.history); assert.deepEqual(receipts(), before.receipts); assert.deepEqual(h.counts(), before.counts);
    assert.equal(JSON.stringify(h.store.events.get()), before.events); assert.equal(h.store.head.get(), before.head);
    assert.deepEqual(h.libraryPublisherAudits.events(), before.audits); assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0);
    const requests = h.requests.slice(before.requests), newToastTimers = [...h.timers]
      .filter(([id, timer]) => timer.delay === 2800 && !before.toastTimers.has(id));
    assert.deepEqual(requests.filter(request => (request.init.method ?? "GET") !== "GET"
      && !h.navigationResumeReads.isReadOnlyResume(request)), [], "Only separately certified original Resume reads; no destination write, publication or paid command");
    const lateFocus = f.native.nativeFocus.slice(focusStart), lateScroll = f.native.nativeScroll.slice(scrollStart);
    const restoreCalls = lateFocus.filter(call => call.node === trigger.port || call.node.owner === f.host
      && String(call.node.attributes?.class ?? "").split(/\s+/u).includes("command-trigger"));
    const promotions = f.trace.slice(traceStart).filter(value => value.startsWith("open:"));
    t.diagnostic("C_COMMAND_REFUSAL_NATIVE_ROUTE_ABA " + JSON.stringify({ entered, transitions, ownerAtHistory,
      sameLibrary: owner.isConnected, sameForm: native.current().port === form, rawRetained: JSON.stringify(native.raw()) === JSON.stringify(raw),
      staleOpenerOrFallbackFocusCalls: restoreCalls.length, lateFocusOwners: lateFocus.map(call => call.node.owner?.tag ?? null),
      lateScrollCalls: lateScroll.length, promotions, toastTimers: newToastTimers.length,
      canonicalHistoryAndReceiptsUnchanged: true, financialRowsUnchanged: true,
      evidence: "actual Shell notification/popstate handlers; finite reentrant event order, not physical queued-task timing" }));
    assert.equal(restoreCalls.length, 0, "An identity-retired refusal cannot restore its old opener or fallback after A→B→A");
    assert.equal(lateFocus.some(call => call.node.owner?.tag === "forma-workspace"), false);
    assert.equal(lateScroll.length, 0); assert.deepEqual(promotions, []);
    assert.equal(newToastTimers.length, 1, "Only the initial legitimate refusal toast schedules feedback; no second stale promotion");
    assert.equal(h.store.ui.toast, expectedNotice);
    assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
  } finally {
    unsubscribe(); await h.navigationResumeReads.settleOriginalRequests(); await f.settle();
    await h.navigationResumeReads.settleOriginalRequests(); await h.worker.drainBackground();
  }
});

// C80: real current-Project and different-Document palette targets. The current
// discovery model does not expose another Project; do not manufacture that row.
function cTargetHandoffAssistantReads(t, f) {
  const h = f.navigationHost, previous = globalThis.fetch, reads = [], pending = new Set(), errors = [];
  const bridge = (input, init = {}) => {
    const url = new URL(String(input), "https://fixture.invalid");
    if (url.origin !== "https://fixture.invalid" || url.pathname !== "/api/assistant") return previous(input, init);
    assert.equal(init.method ?? "GET", "GET", "Only the actual Assistant context read is bridged");
    const row = { url: url.pathname + url.search, status: null, body: null }; reads.push(row);
    const original = h.fetch(row.url, init).then(async response => {
      row.status = response.status; row.body = await response.clone().json(); return response;
    });
    pending.add(original); void original.then(() => pending.delete(original), error => { errors.push(error); pending.delete(original); });
    return original;
  };
  globalThis.fetch = bridge;
  const restore = () => { if (globalThis.fetch === bridge) globalThis.fetch = previous; }; t.after(restore);
  const empty = () => {
    for (const table of ["assistant_turns", "assistant_action_proposals", "assistant_action_commits", "assistant_specialist_tasks", "assistant_billing_reconciliations"])
      if (h.worker.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
        assert.equal(h.worker.sqlite.prepare('SELECT COUNT(*) AS n FROM "' + table + '"').get().n, 0, table + " has no Assistant business row");
    assert.deepEqual(errors, []);
  };
  empty();
  return { reads, empty, restore, pendingCount: () => pending.size, async settle() {
    while (pending.size) await Promise.allSettled([...pending]);
    await h.worker.drainBackground(); empty();
  } };
}

async function cTargetHandoffSettle(x) {
  let queues;
  for (let step = 0; step < 4; step++) {
    // Same bounded current-queue contract as the proved Assistant r3 helper:
    // join original transport, deliver only already-scheduled Store RAF, and
    // let one unchanged full-page settle drain native frames/Output reads.
    await x.h.navigationResumeReads.settleOriginalRequests(); await x.reads.settle();
    for (const [id, timer] of [...x.h.timers]) if (timer.delay === 16) { x.h.timers.delete(id); timer.callback(0); }
    await x.f.settle();
    await x.h.navigationResumeReads.settleOriginalRequests(); await x.reads.settle();
    queues = { transports: x.h.navigationResumeReads.pendingOriginalCount(), assistantReads: x.reads.pendingCount(),
      componentFrames: x.f.frames.size, storeFrames: [...x.h.timers.values()].filter(timer => timer.delay === 16).length,
      renderRequests: Number(x.f.requested) };
    x.checkpoint("settle-round-" + (step + 1), queues);
    if (Object.values(queues).every(value => value === 0)) break;
  }
  assert.deepEqual(queues, { transports: 0, assistantReads: 0, componentFrames: 0, storeFrames: 0, renderRequests: 0 },
    "Actual original transports, Assistant reads, native/Store frames and render requests must be quiescent");
}

async function cTargetHandoffPage(t, locale, kind, checkpoint) {
  checkpoint("navigation-page-start");
  const f = await navigationPage(t, locale, { nativePreparation: true }), h = f.navigationHost;
  checkpoint("navigation-page-ready");
  f.nativeHistoryLocation = h.location;
  checkpoint("registrar-start");
  await registerCalmFullPageComponents(f, ["forma-projects", "forma-project-contents", "forma-creative-assistant"]);
  checkpoint("registrar-ready");
  // Reuse the established two-native-window event bridge from the mounted
  // Assistant fixture. Deliver the same actual Store event, never a fake route.
  const dispatch = h.window.dispatchEvent;
  const routedDispatch = function (event) {
    const result = dispatch.call(this, event);
    for (const listener of [...(f.listeners.get(event.type) ?? [])]) listener(event);
    return result;
  };
  h.window.dispatchEvent = routedDispatch;
  t.after(() => { if (h.window.dispatchEvent === routedDispatch) h.window.dispatchEvent = dispatch; });
  const reads = cTargetHandoffAssistantReads(t, f), x = { f, h, reads, checkpoint };
  // Restore the genuine Worker session after navigationPage's disclosed calm
  // presentation sample. Do not turn Assistant on with a fabricated flag.
  h.worker.env.OPENAI_API_KEY = ""; // Existing mounted-Assistant fixture's no-provider RAM configuration, not a grant.
  checkpoint("session-refresh-start");
  await h.store.refreshSession(); checkpoint("session-refreshed"); await cTargetHandoffSettle(x);
  checkpoint("session-settled");
  const session = h.store.session.get();
  assert.equal(session.projectContext, undefined); assert.equal(session.assistant.enabled, true);
  assert.equal(session.policy.accepted, true); assert.equal(session.provider.configured, false);
  assert.ok(session.capabilities.includes("project.author"));
  h.exact(h.a, h.ad);
  if (kind === "project") {
    const projects = f.task("/projects"); assert.equal(projects.attributes.href, "/projects");
    f.native.emit("pointerdown", projects.port); f.native.focus(projects.port);
    checkpoint("projects-link-start");
    await f.act(projects, "click", { button: 0 }); checkpoint("projects-link-returned"); await cTargetHandoffSettle(x);
    checkpoint("projects-link-settled");
    assert.equal(h.store.route.get(), "/projects");
    assert.equal(documentIdFromRoute(h.store.route.get()), null);
    assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), null);
    // An unanchored Project route legitimately folds the fixture's latest B;
    // it must not borrow the old A route or pin A solely to make a test pass.
    h.exact(h.b, h.bd);
  }
  const projection = h.store.projection.get(), originRoute = h.store.route.get();
  const launcher = f.find("button", node => node.owner.tag === "forma-assistant-panel" && fObjectClassed(node, "forma-assistant-launcher"));
  const panel = launcher.owner, assistant = panel.parentElement;
  assert.equal(assistant.tag, "forma-creative-assistant"); assert.equal(assistant.store, h.store);
  f.native.emit("pointerdown", launcher.port); f.native.focus(launcher.port);
  checkpoint("assistant-open-start");
  await f.act(launcher, "click", { button: 0 }); checkpoint("assistant-open-returned"); await cTargetHandoffSettle(x);
  checkpoint("assistant-open-settled");
  assert.ok(panel.open && panel.isConnected && assistant.isConnected); assert.equal(panel.navigationBlocked, false);
  const composers = f.components().filter(owner => owner.tag === "forma-ui-conversation-composer" && owner.parentElement === panel);
  assert.equal(composers.length, 1); const composer = composers[0];
  const field = () => f.find("textarea", node => node.owner === composer && fObjectClassed(node, "forma-assistant-input"));
  assert.equal(field().port.value, ""); assert.equal(field().properties.value, "");
  assert.equal(field().port.matches(":disabled"), false);
  const scope = panel.conversationScope, parsed = JSON.parse(scope);
  assert.equal(parsed[0], h.store.captureAuthorizationScope().key);
  assert.equal(parsed[2], projection.projectId); assert.equal(parsed[9], originRoute); assert.deepEqual(parsed[10], []);
  assert.ok(reads.reads.length > 0);
  for (const read of reads.reads) {
    assert.equal(read.status, 200);
    const url = new URL(read.url, "https://fixture.invalid");
    assert.equal(url.searchParams.get("route"), originRoute); assert.equal(url.searchParams.get("projectId"), projection.projectId);
    assert.deepEqual(read.body.context.scope, { actorUserId: session.user.userId, organizationId: null, projectAccessId: null,
      projectId: projection.projectId, documentId: kind === "project" ? null : projection.documentId });
    assert.deepEqual(read.body.turns, []); assert.deepEqual(read.body.tasks, []);
  }
  return { ...x, panel, assistant, composer, field, scope, originRoute, projectId: projection.projectId,
    documentId: projection.documentId, projectName: projection.projectName, documentTitle: projection.documentTitle };
}

// One opt-in original DocumentOpened, following c19ObserveNavigationReceipts.
// The exact gesture may be refused; zero dispatch then needs no receipt. An
// actual unguarded dispatch is still witnessed before the desired refusal fails.
function cTargetHandoffNavigation(t, x, kind) {
  const { h } = x, prior = h.transport, records = [], proofs = new WeakMap(); let armed = false, inFlight = null;
  const expected = { type: "DocumentOpened", payload: { document_id: h.otherA, previous_document_id: h.ad, source_surface: "command-menu" } };
  const isOriginal = request => {
    const proof = proofs.get(request);
    return Boolean(proof && request.init === proof.init && request.init.body === proof.bytes
      && JSON.stringify(request.body) === proof.bytes && request.url === "/api/events" && request.init.method === "POST");
  };
  const transport = request => {
    if (request.url === "/api/events" && request.init.method === "POST") {
      assert.equal(kind, "document"); assert.equal(armed, true); assert.equal(records.length, 0); armed = false;
      const row = { request, pending: null, event: null }; records.push(row); inFlight = row;
      row.pending = (async () => {
        const init = request.init, bytes = init.body, body = JSON.parse(bytes);
        assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
        assert.equal(body.action, "append"); assert.equal(body.clientId, "web:lit");
        assert.deepEqual(body.event, expected); assert.deepEqual(body.events, [expected]);
        assert.ok(h.store.sourceOwnershipActive(x.before.source) && h.store.authorizationScopeActive(x.before.authorization));
        assert.equal(h.store.session.get().user.userId, x.before.actor);
        const history = await h.history(), counts = h.counts(); assert.deepEqual(history, x.before.history);
        assert.equal(body.expectedSequence, history.at(-1).sequence);
        const response = await prior(request); assert.equal(response.status, 200);
        const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
        assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]);
        assert.deepEqual(receipt.rejected, []); assert.equal(receipt.appended.length, 1);
        const event = receipt.appended[0]; assert.equal(event.type, expected.type); assert.deepEqual(event.payload, expected.payload);
        assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit"); assert.equal(event.streamId, h.worker.streamId);
        assert.ok(typeof event.eventId === "string" && event.eventId.length);
        assert.equal(event.sequence, body.expectedSequence + 1); assert.equal(receipt.head, event.sequence);
        await h.worker.drainBackground(); assert.deepEqual(await h.history(), [...history, event]); assert.deepEqual(h.counts(), counts);
        assert.equal(request.init, init); assert.equal(request.init.body, bytes);
        proofs.set(request, { init, bytes }); row.event = event;
        assert.equal(isOriginal({ ...request }), false, "A copied request cannot inherit the original receipt");
        return response;
      })();
      void row.pending.then(() => { if (inFlight === row) inFlight = null; }, () => { if (inFlight === row) inFlight = null; });
      return row.pending;
    }
    const row = inFlight;
    if (row && isOutputFixtureReadOnlyResume(request, { projectId: x.projectId, documentId: h.otherA }))
      return row.pending.then(() => prior(request)); // Existing exact Resume observer certifies itself after the real write.
    return prior(request);
  };
  h.transport = transport;
  const restore = () => { if (h.transport === transport) h.transport = prior; }; t.after(restore);
  return { records, isOriginal, restore, arm() { assert.equal(armed, false); armed = kind === "document"; },
    async verify() {
      await Promise.all(records.map(row => row.pending));
      for (const row of records) assert.ok(row.event && isOriginal(row.request));
      assert.deepEqual(h.requests.slice(x.before.requests).filter(row => row.url === "/api/events" && row.init.method === "POST"), records.map(row => row.request));
      assert.deepEqual(await h.history(), [...x.before.history, ...records.map(row => row.event)]);
    } };
}

for (const [kind, locale] of [["project", "en"], ["document", "ja"]]) for (const state of ["clean", "raw"])
test("C actual command target handoff / " + kind + " / " + state + " / " + locale, fIntelligenceOptions, async t => {
  const started = Date.now();
  const checkpoint = (phase, queues = null) => t.diagnostic("C_COMMAND_TARGET_PHASE " + JSON.stringify({ kind, state, locale,
    phase, elapsedMs: Date.now() - started, ...(queues ? { queues } : {}) }));
  checkpoint("case-start");
  const x = await cTargetHandoffPage(t, locale, kind, checkpoint), { f, h, panel, assistant, field } = x;
  checkpoint("origin-ready");
  const raw = "  Unsent exact command-origin question B — 未送信\n  ";
  if (state === "raw") {
    const input = field(); f.native.emit("keydown", input.port); f.native.focus(input.port);
    input.port.value = raw; await f.act(input, "input");
    assert.equal(field().properties.value, raw); assert.equal(field().port.value, raw); assert.equal(panel.navigationBlocked, true);
  }
  const close = f.find("button", node => node.owner === panel && fObjectClassed(node, "forma-assistant-close"));
  checkpoint("assistant-close-start");
  f.native.emit("pointerdown", close.port); f.native.focus(close.port); await f.act(close, "click", { button: 0 });
  await cTargetHandoffSettle(x);
  checkpoint("assistant-close-settled");
  assert.equal(panel.open, false); assert.equal(panel.navigationBlocked, state === "raw"); assert.equal(panel.conversationScope, x.scope);
  const receipts = () => h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
  const requests = h.requests.length; await cTargetHandoffSettle(x); assert.equal(h.requests.length, requests, "Origin reads and real scheduled frames settle before gesture accounting");
  x.before = { route: h.store.route.get(), source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(),
    actor: h.store.session.get().user.userId, session: JSON.stringify(h.store.session.get()), history: await h.history(), counts: h.counts(), receipts: receipts(),
    events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), requests: h.requests.length,
    selection: { focusBlockId: h.store.ui.focusBlockId, focusCollectionId: h.store.ui.focusCollectionId,
      selectedOutputId: h.store.ui.selectedOutputId, compareOpen: h.store.ui.compareOpen } };
  assert.ok(h.store.sourceOwnershipActive(x.before.source) && h.store.authorizationScopeActive(x.before.authorization));
  const targetId = kind === "project" ? x.projectId : h.otherA;
  const targetTitle = kind === "project" ? x.projectName : h.store.projection.get().documents.find(row => row.id === targetId).title;
  const expectedRoute = kind === "project" ? "/studio/project" : withDocumentInRoute("/", targetId, targetTitle);
  const method = kind === "project" ? "openProject" : "openDocument", original = h.store[method], calls = [];
  t.mock.method(h.store, method, function (...args) {
    assert.equal(args[0], targetId); assert.equal(args[1], expectedRoute);
    if (kind === "document") assert.equal(args[2], "command-menu");
    const call = { args, pending: original.apply(this, args), result: null }; calls.push(call);
    void call.pending.then(value => { call.result = value; }, () => {}); return call.pending;
  });
  const navigation = cTargetHandoffNavigation(t, x, kind);
  try {
    const trigger = f.find("button", node => node.owner === f.host && fObjectClassed(node, "command-trigger"));
    f.native.emit("pointerdown", trigger.port); f.native.focus(trigger.port);
    checkpoint("command-search-start");
    await openDiscoverySearch(f, targetTitle);
    checkpoint("command-search-ready");
    const copy = commandDiscoveryCopy(locale), label = copy.open.replace("{name}", targetTitle);
    const hint = kind === "project" ? copy.project : [copy.document, x.projectName].join(" · ");
    const row = f.find("button", node => node.owner === f.host && node.attributes.role === "option"
      && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label)
      && node.children.some(child => typeof child !== "string" && child.tag === "small" && child.text === hint));
    assert.ok(row.port.isConnected && f.renderer.nodes.includes(row.port)); assert.equal(row.port.matches(":disabled"), false);
    assert.equal(h.store.route.get(), x.originRoute); assert.equal(h.requests.length, x.before.requests);
    assert.equal(panel.conversationScope, x.scope); assert.equal(panel.navigationBlocked, state === "raw");
    navigation.arm(); f.native.emit("pointerdown", row.port); f.native.focus(row.port);
    const focusStart = f.native.nativeFocus.length, scrollStart = f.native.nativeScroll.length;
    checkpoint("command-activate-start");
    await f.act(row, "click", { button: 0 }); checkpoint("command-activate-returned"); await cTargetHandoffSettle(x);
    await Promise.all(calls.map(call => call.pending)); await cTargetHandoffSettle(x); await navigation.verify();
    checkpoint("original-navigation-settled");
    assert.ok(h.store.sourceOwnershipActive(x.before.source) && h.store.authorizationScopeActive(x.before.authorization));
    assert.equal(JSON.stringify(h.store.session.get()), x.before.session); assert.deepEqual(h.counts(), x.before.counts);
    assert.deepEqual(receipts(), x.before.receipts, "This existing DocumentOpened payload has no client_event_id; no invented durable client-key receipt");
    assert.equal(h.navigationResumeReads.pendingOriginalCount(), 0); x.reads.empty();
    const afterRequests = h.requests.slice(x.before.requests), lateFocus = f.native.nativeFocus.slice(focusStart), lateScroll = f.native.nativeScroll.slice(scrollStart);
    assert.deepEqual(afterRequests.filter(request => (request.init.method ?? "GET") !== "GET"
      && !navigation.isOriginal(request) && !h.navigationResumeReads.isReadOnlyResume(request)), [], "Only the exact observed navigation or separately certified original free Resume may write transport");
    t.diagnostic("C_ACTUAL_COMMAND_TARGET_HANDOFF " + JSON.stringify({ kind, state, locale, originRoute: x.originRoute,
      originProjectId: x.projectId, originDocumentId: x.documentId, targetId, expectedRoute, actualRoute: h.store.route.get(),
      originAssistantScope: x.scope, currentAssistantScope: panel.conversationScope, actualStoreCalls: calls.length,
      navigationEvents: navigation.records.map(record => ({ type: record.event.type, eventId: record.event.eventId, sequence: record.event.sequence })),
      subsequentRequests: afterRequests.map(request => ({ method: request.init.method ?? "GET", url: request.url })),
      lateFocus: lateFocus.map(call => ({ owner: call.node.owner?.tag ?? null, id: call.node.attributes?.id ?? null })), lateScrollCalls: lateScroll.length,
      financialRowsUnchanged: true, actualOriginalResponsesOnly: true, evidence: "finite actual host/Worker controls; no physical or provider claim" }));
    if (state === "raw") {
      assert.equal(h.store.route.get(), x.originRoute, "The actual palette target cannot consume current collapsed Assistant raw work");
      assert.equal(calls.length, 0); assert.equal(afterRequests.length, 0); assert.equal(navigation.records.length, 0);
      assert.equal(JSON.stringify(h.store.events.get()), x.before.events); assert.equal(h.store.head.get(), x.before.head);
      assert.deepEqual({ focusBlockId: h.store.ui.focusBlockId, focusCollectionId: h.store.ui.focusCollectionId,
        selectedOutputId: h.store.ui.selectedOutputId, compareOpen: h.store.ui.compareOpen }, x.before.selection);
      assert.ok(assistant.isConnected && panel.isConnected); assert.equal(panel.conversationScope, x.scope); assert.equal(panel.navigationBlocked, true);
      assert.equal(lateFocus.some(call => call.node.attributes?.id === "main-content"), false); assert.equal(lateScroll.length, 0);
      const launcher = f.find("button", node => node.owner === panel && fObjectClassed(node, "forma-assistant-launcher"));
      f.native.emit("pointerdown", launcher.port); f.native.focus(launcher.port); await f.act(launcher, "click", { button: 0 }); await cTargetHandoffSettle(x);
      // Closing really removes the composer template. Reopening must retain the
      // same Panel/Assistant scope, not resurrect a retired child instance.
      assert.ok(panel.open && panel.isConnected && assistant.isConnected);
      assert.equal(panel.parentElement, assistant); assert.equal(assistant.store, h.store);
      assert.equal(panel.conversationScope, x.scope);
      const currentComposers = f.components().filter(owner => owner.tag === "forma-ui-conversation-composer" && owner.parentElement === panel);
      assert.equal(currentComposers.length, 1); const currentComposer = currentComposers[0];
      assert.ok(currentComposer.isConnected);
      const currentField = () => f.find("textarea", node => node.owner === currentComposer && fObjectClassed(node, "forma-assistant-input"));
      assert.equal(currentField().port.matches(":disabled"), false);
      assert.equal(currentField().port.value, raw); assert.equal(currentField().properties.value, raw); assert.equal(panel.conversationScope, x.scope);
      await navigation.verify(); assert.deepEqual(h.counts(), x.before.counts); x.reads.empty();
    } else {
      assert.equal(calls.length, 1); assert.equal(calls[0].result, true); assert.equal(h.store.route.get(), expectedRoute);
      h.exact(x.projectId, kind === "project" ? x.documentId : targetId);
      assert.equal(navigation.records.length, kind === "document" ? 1 : 0);
      const tag = kind === "project" ? "forma-project-contents" : "forma-workspace";
      const owners = f.components().filter(owner => owner.tag === tag && owner.store === h.store); assert.equal(owners.length, 1); assert.ok(owners[0].isConnected);
      const heading = f.tree().visible("h1").filter(node => node.owner === owners[0]); assert.equal(heading.length, 1);
      if (kind === "document") assert.equal(heading[0].text, targetTitle);
      assert.ok(lateFocus.some(call => call.node.owner === f.host && call.node.attributes?.id === "main-content"), "The actual admitted route receives current main-content focus");
    }
    assert.equal(h.store.ui.commandOpen, false);
  } finally {
    await Promise.allSettled(calls.map(call => call.pending)); await cTargetHandoffSettle(x);
    navigation.restore(); x.reads.restore();
    checkpoint("case-cleanup-complete");
  }
});

// Additive current-host controls. Reuse navigationPage, its actual Worker and
// the established native/receipt helpers; no extracted method or new renderer.
async function cLocalWiringWorkspace(t, locale) {
  const f = await navigationPage(t, locale, { nativePreparation: true }), h = f.navigationHost;
  const native = await cOrdinaryNavNative(t, f);
  await registerCalmFullPageComponents(f, ["forma-context-board", "forma-deliver"]);
  await cOrdinaryNavSettle(f); h.exact();
  const owners = f.components().filter(owner => owner.tag === "forma-workspace" && owner.store === h.store && owner.isConnected);
  assert.equal(owners.length, 1);
  return { f, h, native, owner: owners[0], settle: () => cOrdinaryNavSettle(f) };
}
async function cLocalWiringName(t, x, raw) {
  const { f, h, owner } = x, title = h.store.projection.get().documentTitle;
  const selected = cOrdinaryNavRenameNative(t, f, owner);
  const rename = f.find("button", node => node.owner === owner
    && node.attributes["aria-label"] === f.i18n.system("Rename {documentTitle}", { documentTitle: title }));
  f.native.emit("pointerdown", rename.port); f.native.focus(rename.port); await f.act(rename, "click", { button: 0 }); await x.settle();
  const field = () => f.find("input", node => node.owner === owner && node.attributes.id === "document-title-input");
  assert.deepEqual(selected, [{ value: title, start: 0, end: title.length, part: field().propertyParts.value }]);
  const node = field(), part = node.propertyParts.value;
  assert.equal(node.port.matches(":disabled"), false); f.native.emit("keydown", node.port); f.native.focus(node.port);
  node.port.value = raw; await f.act(node, "input"); await x.settle();
  assert.equal(field().port.value, raw); assert.equal(field().properties.value, raw);
  return { field, part, title };
}
async function cLocalWiringDiscardName(x) {
  const tree = x.f.tree(), form = fDecisionOne(x.f, tree, "form", node => node.owner === x.owner
    && fObjectClassed(node, "document-title-editor"), "the exact current local rename form");
  const cancel = fDecisionOne(x.f, tree, "button", node => node.owner === x.owner && c19NamingWithin(node, form)
    && node.attributes.type === "button", "the existing explicit local Cancel");
  x.f.native.emit("pointerdown", cancel.port); x.f.native.focus(cancel.port); await x.f.act(cancel, "click", { button: 0 }); await x.settle();
  assert.equal(x.f.tree().visible("input").filter(node => node.owner === x.owner && node.attributes.id === "document-title-input").length, 0);
}
async function cLocalWiringOverview(x) {
  const { f, owner } = x;
  const result = f.find("button", node => node.owner === owner && node.attributes["data-workbench-pane"] === "result");
  f.native.emit("pointerdown", result.port); f.native.focus(result.port); await f.act(result, "click", { button: 0 }); await x.settle();
  const toggle = f.find("button", node => node.owner === owner && fObjectClassed(node, "document-inspector-toggle"));
  assert.equal(toggle.attributes["aria-controls"], "document-workbench-inspector");
  assert.ok(["true", "false"].includes(String(toggle.attributes["aria-expanded"])));
  if (String(toggle.attributes["aria-expanded"]) === "false") {
    f.native.emit("pointerdown", toggle.port); f.native.focus(toggle.port); await f.act(toggle, "click", { button: 0 }); await x.settle();
  }
  const currentToggle = f.find("button", node => node.owner === owner && fObjectClassed(node, "document-inspector-toggle"));
  assert.ok(owner.isConnected && currentToggle.port.isConnected); assert.equal(currentToggle.port.matches(":disabled"), false);
  assert.equal(currentToggle.attributes["aria-controls"], "document-workbench-inspector");
  assert.equal(String(currentToggle.attributes["aria-expanded"]), "true", "The actual current overview control reports its completed open state");
  const overview = f.find("aside", node => node.owner === owner && node.attributes.id === "document-workbench-inspector");
  assert.equal(overview.hiddenBy, null); assert.ok(overview.port.isConnected);
}

test("C Workspace ordinary See spatially reaches the exact current Document / en", fIntelligenceOptions, async t => {
  const x = await cLocalWiringWorkspace(t, "en"), { f, h, owner, native } = x;
  assert.ok(h.store.projection.get().blocks.length > 0);
  const target = f.find("button", node => node.owner === owner && node.parent?.attributes.class === "document-insight");
  const title = h.store.projection.get().documentTitle, before = await cOrdinaryNavBefore(f);
  await cOrdinaryNavClick(f, target, native); await cOrdinaryNavNoWrite(f, before);
  assert.equal(h.store.route.get(), withDocumentInRoute("/studio/board", h.ad, title)); h.exact();
  assert.equal(owner.isConnected, false);
  const boards = f.components().filter(value => value.tag === "forma-context-board" && value.store === h.store && value.isConnected);
  assert.equal(boards.length, 1); assert.equal(f.host.store, h.store);
  cOrdinaryNavObserve(t, f, before, "workspace-see-spatially-pristine", owner);
});

test("C Workspace overview Activity retains newer raw name until explicit Cancel / ja", fIntelligenceOptions, async t => {
  const x = await cLocalWiringWorkspace(t, "ja"), { f, h, owner, native } = x;
  await cLocalWiringOverview(x);
  const raw = "  Newer overview name B — 未保存  ", name = await cLocalWiringName(t, x, raw);
  const target = () => f.find("button", node => node.owner === owner && node.parent?.attributes.id === "document-workbench-inspector"
    && node.text === f.i18n.t("shell.navigation.activity", "Activity"));
  const before = await cOrdinaryNavBefore(f), gesture = await cOrdinaryNavClick(f, target(), native);
  await cOrdinaryNavNoWrite(f, before); cOrdinaryNavObserve(t, f, before, "workspace-overview-raw-name", owner);
  cOrdinaryNavRefused(f, before, native, gesture, owner);
  assert.equal(name.field().propertyParts.value, name.part); assert.equal(name.field().port.value, raw); assert.equal(name.field().properties.value, raw);
  await cLocalWiringDiscardName(x); assert.equal(h.store.projection.get().documentTitle, name.title);
  await cOrdinaryNavClick(f, target(), native); await cOrdinaryNavNoWrite(f, before);
  assert.equal(h.store.route.get(), withProjectTaskDocumentInRoute("/activity", h.ad, before.route)); h.exact();
  assert.equal(owner.isConnected, false); assert.equal(f.components().filter(value => value.tag === "forma-activity" && value.isConnected).length, 1);
});

async function cLocalWiringProposalPage(t, locale) {
  const x = await cTargetHandoffPage(t, locale, "document", () => {}), { f, h, panel } = x;
  x.settle = () => cTargetHandoffSettle(x);
  const prior = h.intercept, route = h.store.route.get(), delivered = [];
  const proposal = { id: "finite-current-navigate", turnId: "finite-current-navigation-turn", kind: "navigate",
    key: "shell.navigation.activity", route: "/activity", summary: "Finite exact navigation suggestion; no saved Assistant action or provider request" };
  const turn = { id: proposal.turnId, user: "Finite navigation fixture", reply: { text: "Review the existing Activity route" }, proposal };
  h.intercept = async request => {
    const url = new URL(request.url, "https://fixture.invalid");
    if (url.pathname !== "/api/assistant" || url.searchParams.get("route") !== route) return prior?.(request);
    assert.equal(request.init.method ?? "GET", "GET");
    // Obtain genuine current authorization/context, then change only the
    // disclosed finite presentation turn. No database/provider or grant setup.
    const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 200);
    const body = await response.json(); assert.deepEqual(body.turns, []); assert.deepEqual(body.tasks, []);
    assert.equal(body.context.scope.actorUserId, h.store.session.get().user.userId);
    assert.equal(body.context.scope.projectId, h.a); assert.equal(body.context.scope.documentId, h.ad);
    delivered.push(request); return Response.json({ ...body, turns: [turn] });
  };
  t.after(() => { if (h.intercept !== prior) h.intercept = prior; });
  const close = f.find("button", node => node.owner === panel && fObjectClassed(node, "forma-assistant-close"));
  f.native.emit("pointerdown", close.port); f.native.focus(close.port); await f.act(close, "click", { button: 0 }); await x.settle();
  const launcher = f.find("button", node => node.owner === panel && fObjectClassed(node, "forma-assistant-launcher"));
  f.native.emit("pointerdown", launcher.port); f.native.focus(launcher.port); await f.act(launcher, "click", { button: 0 }); await x.settle();
  assert.ok(delivered.length > 0); assert.equal(panel.open, true); assert.equal(panel.proposals.length, 1);
  assert.deepEqual(panel.proposals[0], proposal); x.proposal = panel.proposals[0];
  assert.equal(panel.commandDepartureBlocked, false, "The exact displayed navigation proposal itself must not self-lock");
  assert.equal(panel.conversationScope, x.scope); x.reads.empty();
  const scrolls = [], scroll = ports.windowPort.scrollTo;
  t.mock.method(ports.windowPort, "scrollTo", function (...args) { scrolls.push(args); return scroll.apply(this, args); });
  x.native = { scrolls };
  x.proposalButton = () => {
    const tree = f.tree(), articles = tree.visible("article").filter(node => node.owner === panel && fObjectClassed(node, "forma-assistant-proposal"));
    assert.equal(articles.length, 1);
    return fDecisionOne(f, tree, "button", node => node.owner === panel && c19NamingWithin(node, articles[0])
      && node.text === f.i18n.t(proposal.key), "the exact currently displayed native proposal acceptance control");
  };
  x.currentField = () => {
    const composers = f.components().filter(owner => owner.tag === "forma-ui-conversation-composer" && owner.parentElement === panel && owner.isConnected);
    assert.equal(composers.length, 1);
    return f.find("textarea", node => node.owner === composers[0] && fObjectClassed(node, "forma-assistant-input"));
  };
  assert.equal(x.currentField().port.value, ""); assert.equal(x.proposalButton().port.matches(":disabled"), false);
  return x;
}
async function cLocalWiringAssistantText(x, raw) {
  const field = x.currentField(); assert.equal(field.port.matches(":disabled"), false);
  x.f.native.emit("keydown", field.port); x.f.native.focus(field.port); field.port.value = raw;
  await x.f.act(field, "input"); await x.settle();
  assert.equal(x.currentField().port.value, raw); assert.equal(x.currentField().properties.value, raw);
}

for (const [state, locale] of [["pristine", "en"], ["assistant-raw", "ja"], ["workspace-raw", "en"]])
test("C Assistant ordinary navigation proposal / " + state + " / " + locale, fIntelligenceOptions, async t => {
  const x = await cLocalWiringProposalPage(t, locale), { f, h, panel, assistant, native } = x;
  const workspace = f.components().find(owner => owner.tag === "forma-workspace" && owner.store === h.store && owner.isConnected);
  assert.ok(workspace); x.owner = workspace;
  const raw = "  Newer unsent proposal-adjacent B — 保留\n  "; let name = null;
  if (state === "assistant-raw") await cLocalWiringAssistantText(x, raw);
  if (state === "workspace-raw") name = await cLocalWiringName(t, x, raw);
  assert.equal(panel.commandDepartureBlocked, state === "assistant-raw");
  const before = await cOrdinaryNavBefore(f), originalRoute = h.store.setRoute, routeCalls = [];
  t.mock.method(h.store, "setRoute", function (path, ...args) {
    if (path === x.proposal.route) routeCalls.push({ path, args });
    return originalRoute.call(this, path, ...args);
  });
  const gesture = await cOrdinaryNavClick(f, x.proposalButton(), native, x.settle);
  await cOrdinaryNavNoWrite(f, before); x.reads.empty();
  t.diagnostic("C_ORDINARY_ASSISTANT_PROPOSAL " + JSON.stringify({ state, locale, before: before.route,
    after: h.store.route.get(), routeCalls: routeCalls.length, exactProposalRetained: panel.proposals.includes(x.proposal),
    privateScope: panel.conversationScope === x.scope, sourceEventsReceiptsAndFiscalUnchanged: true,
    finiteNavigationTurnOnly: true, savedAssistantActions: 0, providerRequests: 0 }));
  if (state !== "pristine") {
    cOrdinaryNavRefused(f, before, native, gesture, workspace);
    assert.equal(routeCalls.length, 0); assert.ok(assistant.isConnected && panel.isConnected && panel.open);
    assert.equal(panel.conversationScope, x.scope); assert.equal(panel.proposals.length, 1);
    assert.equal(panel.proposals[0], x.proposal, "Refusal retains the exact currently displayed proposal, not a recreated suggestion");
    assert.equal(x.proposalButton().port.matches(":disabled"), false);
    if (name) {
      assert.equal(name.field().propertyParts.value, name.part); assert.equal(name.field().port.value, raw);
      await cLocalWiringDiscardName(x); assert.equal(h.store.projection.get().documentTitle, name.title);
    } else { assert.equal(x.currentField().port.value, raw); await cLocalWiringAssistantText(x, ""); }
    assert.equal(panel.commandDepartureBlocked, false); assert.equal(panel.proposals[0], x.proposal);
    await cOrdinaryNavClick(f, x.proposalButton(), native, x.settle); await cOrdinaryNavNoWrite(f, before); x.reads.empty();
  }
  assert.equal(routeCalls.length, 1, "Only the newly admitted deliberate proposal gesture reaches the existing route operation");
  assert.equal(h.store.route.get(), withProjectTaskDocumentInRoute(x.proposal.route, h.ad, before.route)); h.exact();
  assert.equal(workspace.isConnected, false); assert.equal(panel.proposals.includes(x.proposal), false);
  assert.equal(f.components().filter(owner => owner.tag === "forma-activity" && owner.isConnected && owner.store === h.store).length, 1);
  assert.equal(h.store.ui.commandOpen, false, "The actual proposal button did not synthesize a command menu action");
});

// Ordinary in-app departures, not command callbacks. Reuse the actual complete
// hosts/Worker and native controls; browser popstate is deliberately separate.
async function cOrdinaryNavSettle(f, settlement = {}) {
  const h = f.navigationHost; let queues;
  for (let step = 0; step < 4; step++) {
    await h.navigationResumeReads.settleOriginalRequests(settlement);
    for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
    await f.settle(); await h.navigationResumeReads.settleOriginalRequests(settlement);
    queues = { requests: h.navigationResumeReads.pendingOriginalCount(settlement), frames: f.frames.size,
      storeFrames: [...h.timers.values()].filter(timer => timer.delay === 16).length, requested: Number(f.requested) };
    if (Object.values(queues).every(value => value === 0)) break;
  }
  assert.deepEqual(queues, { requests: 0, frames: 0, storeFrames: 0, requested: 0 }); await h.worker.drainBackground();
}
async function cOrdinaryNavNative(t, f) {
  const h = f.navigationHost; f.nativeHistoryLocation = h.location;
  await registerCalmFullPageComponents(f, ["forma-workspace", "forma-project-contents", "forma-projects", "forma-chat-studio", "forma-scout", "forma-library", "forma-activity"]);
  const dispatch = h.window.dispatchEvent;
  const forward = function (event) {
    const result = dispatch.call(this, event);
    for (const listener of [...(f.listeners.get(event.type) ?? [])]) listener(event);
    return result;
  };
  h.window.dispatchEvent = forward; t.after(() => { if (h.window.dispatchEvent === forward) h.window.dispatchEvent = dispatch; });
  const scrolls = [], scroll = ports.windowPort.scrollTo;
  t.mock.method(ports.windowPort, "scrollTo", function (...args) { scrolls.push(args); return scroll.apply(this, args); });
  await h.store.refreshSession(); await cOrdinaryNavSettle(f);
  assert.equal(h.store.session.get().projectContext, undefined);
  assert.ok(h.store.session.get().capabilities.includes("project.author"));
  assert.ok(f.native && f.host.isConnected && f.host.store === h.store);
  return { scrolls };
}
function cOrdinaryNavRenameNative(t, f, owner) {
  const prior = f.renderer.query, selected = [];
  const query = function(currentOwner, selector) {
    if (currentOwner !== owner || selector !== ".document-title-editor input") return prior.call(this, currentOwner, selector);
    // Reuse fSessionBlankNative's finite descendant/select port, for this
    // current Workspace rename field only. Never select its form or a peer.
    assert.ok(owner.isConnected && f.components().includes(owner));
    const tree = f.tree(), forms = tree.visible("form").filter(node => node.owner === owner && fObjectClassed(node, "document-title-editor"));
    assert.equal(forms.length, 1);
    const fields = tree.visible("input").filter(node => node.owner === owner
      && node.attributes.id === "document-title-input" && node.parent === forms[0]);
    assert.equal(fields.length, 1); const field = fields[0], port = field.port;
    assert.ok(port.isConnected && f.renderer.nodes.includes(port)); assert.equal(port.owner, owner);
    assert.equal(port.tag, "input"); assert.equal(port.matches(":disabled"), false);
    assert.equal(typeof field.propertyParts.value, "string");
    port.select = function() {
      assert.equal(this, port); assert.ok(this.isConnected && f.renderer.nodes.includes(this));
      this.selectionStart = 0; this.selectionEnd = String(this.value).length;
      selected.push({ value: this.value, start: this.selectionStart, end: this.selectionEnd, part: field.propertyParts.value });
    };
    return [port];
  };
  f.renderer.query = query;
  t.after(() => { if (f.renderer.query === query) f.renderer.query = prior; });
  return selected;
}
async function cOrdinaryNavBefore(f) {
  const h = f.navigationHost, source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
  assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
  return { route: h.store.route.get(), source, authorization, session: JSON.stringify(h.store.session.get()),
    history: await h.history(), counts: h.counts(), events: JSON.stringify(h.store.events.get()), head: h.store.head.get(), requests: h.requests.length,
    receipts: h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all() };
}
async function cOrdinaryNavNoWrite(f, before) {
  const h = f.navigationHost;
  assert.deepEqual(await h.history(), before.history); assert.deepEqual(h.counts(), before.counts);
  assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), before.receipts);
  assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
  assert.equal(JSON.stringify(h.store.session.get()), before.session);
  assert.deepEqual(h.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET"
    && !h.navigationResumeReads.isReadOnlyResume(row)), [], "Only independently certified original free Resume; no navigation event, authoring, approval or provider write");
}
async function cOrdinaryNavClick(f, node, native, settle = () => cOrdinaryNavSettle(f)) {
  assert.ok(node.port?.isConnected && f.renderer.nodes.includes(node.port)); assert.equal(node.hiddenBy, null);
  assert.equal(node.port.matches(":disabled"), false); assert.equal(typeof node.handlers.click, "function");
  f.native.emit("pointerdown", node.port); f.native.focus(node.port);
  const result = { focus: f.native.nativeFocus.length, scroll: f.native.nativeScroll.length, windowScroll: native.scrolls.length };
  await f.act(node, "click", { button: 0, defaultPrevented: false }); await settle(); return result;
}
function cOrdinaryNavRefused(f, before, native, gesture, owner) {
  const h = f.navigationHost;
  assert.equal(h.store.route.get(), before.route, "Ordinary navigation is not consent to discard current raw or pending work");
  assert.equal(h.location.pathname + h.location.search + h.location.hash, before.route, "Native URL and Store view stay coherent");
  assert.ok(owner.isConnected && f.components().includes(owner)); assert.equal(h.requests.length, before.requests);
  assert.equal(JSON.stringify(h.store.events.get()), before.events); assert.equal(h.store.head.get(), before.head);
  assert.equal(f.native.nativeFocus.slice(gesture.focus).some(call => call.node.attributes?.id === "main-content"), false);
  assert.equal(f.native.nativeScroll.length, gesture.scroll); assert.equal(native.scrolls.length, gesture.windowScroll);
}
function cOrdinaryNavObserve(t, f, before, name, owner) {
  t.diagnostic("C_ORDINARY_NAVIGATION " + JSON.stringify({ name, locale: f.locale, before: before.route,
    after: f.navigationHost.store.route.get(), nativeUrl: f.navigationHost.location.pathname + f.navigationHost.location.search + f.navigationHost.location.hash,
    originalOwnerConnected: owner.isConnected, originalHistoryAndFiscalUnchanged: true,
    requests: f.navigationHost.requests.slice(before.requests).map(row => ({ method: row.init.method ?? "GET", url: row.url })),
    evidence: "actual current controls/Store/RAM Worker, finite native events; not browser history or physical focus proof" }));
}

for (const [path, locale] of [["header", "en"], ["rail", "ja"], ["mode", "en"]])
test("C ordinary departure retains native Document rename / " + path + " / " + locale, fIntelligenceOptions, async t => {
  const f = await navigationPage(t, locale, { nativePreparation: true }), h = f.navigationHost;
  // Same explicit RAM navigation-history setup as Sessions. A bare Project
  // overview is tested with genuinely current A history, not a forged route pin.
  await h.external("ProjectOpened", { project_id: h.a });
  await h.external("DocumentOpened", { document_id: h.ad, source_surface: "ordinary-navigation-fixture" });
  await h.store.refreshEvents({ fromStart: true });
  const native = await cOrdinaryNavNative(t, f); h.exact();
  const owner = f.components().find(value => value.tag === "forma-workspace" && value.store === h.store); assert.ok(owner?.isConnected);
  const originalTitle = h.store.projection.get().documentTitle;
  const selected = cOrdinaryNavRenameNative(t, f, owner);
  const rename = f.find("button", node => node.owner === owner
    && node.attributes["aria-label"] === f.i18n.system("Rename {documentTitle}", { documentTitle: originalTitle }));
  await f.act(rename, "click", { button: 0 });
  const field = () => f.find("input", node => node.owner === owner && node.attributes.id === "document-title-input");
  assert.deepEqual(selected, [{ value: originalTitle, start: 0, end: originalTitle.length, part: field().propertyParts.value }],
    "The original deferred select uses the actual current rename input and its complete original title");
  assert.equal(field().port.value, originalTitle); const part = field().propertyParts.value;
  const raw = "  Unsent ordinary route name B — 保留  ", input = field();
  assert.equal(input.port.matches(":disabled"), false); input.port.value = raw; await f.act(input, "input");
  assert.equal(field().properties.value, raw); assert.equal(field().port.value, raw);
  const target = () => path === "header" ? f.find("button", node => node.owner === f.host && fObjectClassed(node, "brand"))
    : path === "rail" ? f.find("a", node => node.owner.tag === "forma-project-rail" && fObjectClassed(node, "rail-project-switch"))
      : f.find("a", node => node.owner.tag === "forma-studio-mode-nav"
        && node.attributes.href === withDocumentInRoute("/studio/chat", h.ad, originalTitle));
  const destination = path === "header" ? "/projects" : path === "rail" ? "/studio/project" : withDocumentInRoute("/studio/chat", h.ad, originalTitle);
  if (path !== "header") assert.equal(target().attributes.href, destination);
  await cOrdinaryNavSettle(f); const before = await cOrdinaryNavBefore(f);
  const gesture = await cOrdinaryNavClick(f, target(), native); await cOrdinaryNavNoWrite(f, before);
  cOrdinaryNavObserve(t, f, before, path + "-raw-document-name", owner);
  cOrdinaryNavRefused(f, before, native, gesture, owner);
  assert.equal(field().propertyParts.value, part); assert.equal(field().properties.value, raw); assert.equal(field().port.value, raw);
  const tree = f.tree(), form = fDecisionOne(f, tree, "form", node => node.owner === owner && fObjectClassed(node, "document-title-editor"), "Same current rename form");
  const cancel = fDecisionOne(f, tree, "button", node => node.owner === owner && c19NamingWithin(node, form)
    && node.attributes.type === "button", "Actual local Cancel resolves the raw rename without saving");
  await f.act(cancel, "click", { button: 0 }); await cOrdinaryNavSettle(f);
  assert.equal(f.tree().visible("input").filter(node => node.owner === owner && node.attributes.id === "document-title-input").length, 0);
  assert.equal(h.store.projection.get().documentTitle, originalTitle); await cOrdinaryNavNoWrite(f, before);
  await cOrdinaryNavClick(f, target(), native); await cOrdinaryNavNoWrite(f, before);
  assert.equal(h.store.route.get(), destination); assert.equal(owner.isConnected, false);
  const tag = path === "header" ? "forma-projects" : path === "rail" ? "forma-project-contents" : "forma-chat-studio";
  assert.equal(f.components().filter(value => value.tag === tag && value.store === h.store && value.isConnected).length, 1);
  assert.equal(h.store.projection.get().projectId, h.a);
});

test("C ordinary AreaNavigation retains raw Sessions intent then permits deliberate clear / ja", fIntelligenceOptions, async t => {
  const x = await fSessionPage(t, "ja", "thread", { eligible: false }), { f, h, owner } = x;
  const native = await cOrdinaryNavNative(t, f), raw = "  Unsent local intent B — 未送信\n  ";
  await fSessionDraftType(x, "intent", raw);
  const part = cSessionCommandIntentControls(x, raw).part;
  const scout = () => f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && node.owner.parentElement?.tag === "forma-area-navigation" && node.attributes.href === "/scout");
  await cOrdinaryNavSettle(f); const before = await cOrdinaryNavBefore(f);
  const gesture = await cOrdinaryNavClick(f, scout(), native); await cOrdinaryNavNoWrite(f, before);
  cOrdinaryNavObserve(t, f, before, "area-raw-intent", owner); cOrdinaryNavRefused(f, before, native, gesture, owner);
  cSessionCommandIntentControls(x, raw, part); assert.equal(h.briefReceipts.records().length, 0);
  await fSessionDraftType(x, "intent", ""); cSessionCommandIntentControls(x, "", part);
  await cOrdinaryNavClick(f, scout(), native); await cOrdinaryNavNoWrite(f, before);
  assert.equal(h.store.route.get(), "/scout"); assert.equal(owner.isConnected, false);
  assert.equal(f.components().filter(value => value.tag === "forma-scout" && value.store === h.store && value.isConnected).length, 1);
  await fSessionNoExtraEffects(x);
});

test("C ordinary primary task reaches exact Activity from pristine Sessions / en", fIntelligenceOptions, async t => {
  const x = await fSessionPage(t, "en", "thread", { eligible: false }), { f, h, owner } = x;
  const native = await cOrdinaryNavNative(t, f); cSessionCommandIntentControls(x, "");
  const before = await cOrdinaryNavBefore(f), link = f.task("/activity"), destination = link.attributes.href;
  assert.equal(destination, "/activity?document=" + h.ad);
  await cOrdinaryNavClick(f, link, native); await cOrdinaryNavNoWrite(f, before);
  cOrdinaryNavObserve(t, f, before, "task-clean-sessions", owner);
  assert.equal(h.store.route.get(), destination); assert.equal(owner.isConnected, false); h.exact();
  assert.equal(f.components().filter(value => value.tag === "forma-activity" && value.store === h.store && value.isConnected).length, 1);
  await fSessionNoExtraEffects(x);
});

test("C ordinary primary task cannot retire an actual pending blank original / en", { ...fIntelligenceOptions, timeout: 120_000 }, async t => {
  const x = await fSessionContinuationPage(t, "en"), { f, h, owner } = x;
  const native = await cOrdinaryNavNative(t, f), raw = "  Pending ordinary departure A  ";
  await fSessionDraftType(x, "blank", raw); await cOrdinaryNavSettle(f);
  const a = h.sessionDraftReceipts.arm("blank", raw.trim()), pending = f.act(fSessionDraftForm(x, "blank"), "submit");
  const held = { ...x, a, raw };
  try {
    await h.sessionDraftReceipts.reached(a); await cBlankCommandPendingPresentation(held);
    assert.equal(a.delivered, false); assert.equal(a.receipt.status, 200);
    assert.equal(h.store.events.get().some(event => event.eventId === a.receipt.appended[1].eventId), false);
    const part = cBlankCommandField(held, raw), before = await cOrdinaryNavBefore(f);
    const link = f.task("/activity"); assert.equal(link.attributes.href, "/activity?document=" + h.ad);
    const gesture = await cOrdinaryNavClick(f, link, native, () => cBlankCommandPendingPresentation(held));
    await cOrdinaryNavNoWrite(f, before); cOrdinaryNavObserve(t, f, before, "task-pending-original", owner);
    assert.equal(a.delivered, false); assert.equal(h.navigationResumeReads.pendingOriginalCount(), 1);
    cOrdinaryNavRefused(f, before, native, gesture, owner); cBlankCommandField(held, raw, part);
    assert.deepEqual(h.sessionDraftReceipts.records(), [a]); assert.equal(h.sessionDraftReceipts.isOriginal(a.request), true);
  } finally {
    a.gate.resolve(); await pending; await fSessionFinishOriginalTimers(f); await cOrdinaryNavSettle(f); await fSessionDraftEffects(x, a);
  }
});

test("C ordinary Library Back caches the exact unsaved editor and permits its real reopening / en", fIntelligenceOptions, async t => {
  const x = await fDecisionPage(t, { locale: "en", scope: "library", method: "click", boundary: "healthy" }), { f, h, block } = x;
  const native = await cOrdinaryNavNative(t, f);
  await cOrdinaryNavClick(f, f.task("/library"), native);
  const library = f.components().find(value => value.tag === "forma-library" && value.store === h.store); assert.ok(library?.isConnected);
  const controls = () => f.find("button", node => node.owner === library && node.attributes["data-context-controls-id"] === block.id);
  await cOrdinaryNavClick(f, controls(), native);
  const editorRoute = libraryBlockEditorRoute(block.id, "/library?document=" + h.ad);
  assert.equal(h.store.route.get(), editorRoute);
  const editors = f.components().filter(value => value.tag === "forma-library-block-editor" && value.blockId === block.id);
  assert.equal(editors.length, 1); const editor = editors[0]; assert.equal(editor.closest("forma-library"), library);
  const field = () => f.find("input", node => node.owner === editor && String(node.attributes.maxlength) === "96");
  assert.equal(field().port.value, block.handle);
  const raw = "  direction/retained-unsent-B  ", input = field(); assert.equal(input.port.matches(":disabled"), false);
  input.port.value = raw; await f.act(input, "input"); assert.equal(field().properties.value, raw); assert.equal(field().port.value, raw);
  await cOrdinaryNavSettle(f); const before = await cOrdinaryNavBefore(f), tree = f.tree();
  const header = fDecisionOne(f, tree, "header", node => node.owner === editor && fObjectClassed(node, "library-block-editor-header"), "Exact current editor header");
  // Existing full-child fixture exposes the authored Back label; no translated
  // control or callback is fabricated to compensate for that disclosed port.
  const back = fDecisionOne(f, tree, "button", node => node.owner === editor && c19NamingWithin(node, header)
    && node.text === "Back to Library", "Real same-scope Back action");
  await cOrdinaryNavClick(f, back, native); await cOrdinaryNavNoWrite(f, before);
  assert.equal(h.store.route.get(), "/library?document=" + h.ad); assert.ok(library.isConnected);
  assert.equal(f.components().find(value => value.tag === "forma-library"), library);
  assert.equal(f.tree().visible("form").filter(node => node.owner === editor && fObjectClassed(node, "library-block-form")).length, 0);
  await cOrdinaryNavClick(f, controls(), native); await cOrdinaryNavNoWrite(f, before);
  assert.equal(h.store.route.get(), editorRoute);
  assert.equal(f.components().find(value => value.tag === "forma-library-block-editor" && value.blockId === block.id), editor);
  assert.ok(editor.isConnected); assert.equal(field().properties.value, raw); assert.equal(field().port.value, raw);
  assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === block.id), block);
  cOrdinaryNavObserve(t, f, before, "safe-cached-library-back-and-reopen", editor);
});

// One actual CollectionTree control, reusing the existing whole-page native
// rename, wide-rail and original Worker accounting ports. No new renderer.
test("C ordinary CollectionTree preserves raw Document owner and filter until deliberate resolution / en", fIntelligenceOptions, async t => {
  const f = await navigationPage(t, "en", { nativePreparation: true }), h = f.navigationHost;
  await h.external("ProjectOpened", { project_id: h.a });
  await h.external("DocumentOpened", { document_id: h.ad, source_surface: "ordinary-collection-fixture" });
  await h.store.refreshEvents({ fromStart: true });
  const native = await cOrdinaryNavNative(t, f); h.exact();
  // Leave the pristine page before installing the existing wide native port;
  // the later actual Rail connects with its correct media/ancestor contract.
  const brand = f.find("button", node => node.owner === f.host && fObjectClassed(node, "brand"));
  await cOrdinaryNavClick(f, brand, native); assert.equal(h.store.route.get(), "/projects");
  assert.equal(f.components().filter(owner => owner.tag === "forma-project-rail").length, 0);
  await cSessionWideNative(t, f);
  const work = f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && documentIdFromRoute(node.attributes.href) === h.ad);
  await cOrdinaryNavClick(f, work, native); h.exact();
  const owners = f.components().filter(owner => owner.tag === "forma-workspace" && owner.store === h.store);
  assert.equal(owners.length, 1); const owner = owners[0]; assert.ok(owner.isConnected);
  const rails = f.components().filter(value => value.tag === "forma-project-rail" && value.store === h.store);
  assert.equal(rails.length, 1); assert.equal(ports.windowPort.matchMedia("(max-width: 47.99rem)").matches, false);
  const toggle = () => f.find("button", node => node.owner === rails[0] && fObjectClassed(node, "rail-collapse-toggle"));
  const expanded = () => {
    const raw = toggle().port.getAttribute("aria-expanded");
    assert.ok(raw === true || raw === false || raw === "true" || raw === "false"); return String(raw);
  };
  if (expanded() === "false") await cOrdinaryNavClick(f, toggle(), native);
  assert.equal(expanded(), "true"); assert.equal(h.store.ui.projectRailCollapsed, false);
  const trees = f.tree().visible("forma-collection-tree"); assert.equal(trees.length, 1);
  const collectionOwner = trees[0].component; assert.ok(collectionOwner.isConnected); assert.equal(collectionOwner.store, h.store);
  assert.equal(collectionOwner.destination, "/studio/project");
  const collectionId = "collection-studio";
  assert.ok(h.store.projection.get().collections.some(row => row.id === collectionId), "Reuse the original Worker-seeded collection, not a fabricated option");
  assert.equal(h.store.ui.focusCollectionId, "");
  const target = () => {
    const tree = f.tree(), rows = tree.visible("li").filter(node => node.owner === collectionOwner
      && node.attributes["data-collection-id"] === collectionId);
    assert.equal(rows.length, 1);
    const buttons = tree.visible("button").filter(node => node.owner === collectionOwner
      && fObjectClassed(node, "tree-name") && node.port.closest("[data-collection-id]") === rows[0].port);
    assert.equal(buttons.length, 1); return buttons[0];
  };
  const originalTitle = h.store.projection.get().documentTitle, selected = cOrdinaryNavRenameNative(t, f, owner);
  await f.act(f.find("button", node => node.owner === owner
    && node.attributes["aria-label"] === f.i18n.system("Rename {documentTitle}", { documentTitle: originalTitle })), "click", { button: 0 });
  const field = () => f.find("input", node => node.owner === owner && node.attributes.id === "document-title-input");
  assert.deepEqual(selected, [{ value: originalTitle, start: 0, end: originalTitle.length, part: field().propertyParts.value }]);
  const raw = "  Unsent collection navigation B  ", input = field();
  assert.equal(input.port.matches(":disabled"), false); input.port.value = raw; await f.act(input, "input");
  assert.equal(field().port.value, raw); const part = field().propertyParts.value;
  await cOrdinaryNavSettle(f); const before = await cOrdinaryNavBefore(f);
  const selection = { focusCollectionId: h.store.ui.focusCollectionId, focusBlockId: h.store.ui.focusBlockId,
    selectedOutputId: h.store.ui.selectedOutputId, compareOpen: h.store.ui.compareOpen };
  const gesture = await cOrdinaryNavClick(f, target(), native); await cOrdinaryNavNoWrite(f, before);
  cOrdinaryNavObserve(t, f, before, "collection-tree-raw-owner", owner);
  assert.deepEqual({ focusCollectionId: h.store.ui.focusCollectionId, focusBlockId: h.store.ui.focusBlockId,
    selectedOutputId: h.store.ui.selectedOutputId, compareOpen: h.store.ui.compareOpen }, selection,
  "A refused collection gesture must not change its filter before departure admission");
  cOrdinaryNavRefused(f, before, native, gesture, owner);
  assert.equal(field().propertyParts.value, part); assert.equal(field().properties.value, raw); assert.equal(field().port.value, raw);
  const tree = f.tree(), form = fDecisionOne(f, tree, "form", node => node.owner === owner
    && fObjectClassed(node, "document-title-editor"), "Actual current rename form");
  const cancel = fDecisionOne(f, tree, "button", node => node.owner === owner && c19NamingWithin(node, form)
    && node.attributes.type === "button", "Actual local Cancel, never an automatic Save");
  await f.act(cancel, "click", { button: 0 }); await cOrdinaryNavSettle(f);
  assert.equal(h.store.projection.get().documentTitle, originalTitle);
  await cOrdinaryNavClick(f, target(), native); await cOrdinaryNavNoWrite(f, before);
  assert.equal(h.store.route.get(), "/studio/project"); assert.equal(h.store.ui.focusCollectionId, collectionId);
  assert.equal(owner.isConnected, false);
  assert.equal(f.components().filter(value => value.tag === "forma-project-contents" && value.store === h.store && value.isConnected).length, 1);
});

// Memory uses its actual controlled fields and the existing full Shell/RAM
// Worker. These three cases do not submit either Memory form or run Scout.
function cMemoryOwnedControls(f, owner, kind, expected, previousPart = null) {
  const tree = f.tree(), length = kind === "preference" ? "120" : "300";
  assert.ok(owner?.isConnected && owner.store === f.navigationHost.store && f.components().includes(owner));
  const fields = tree.visible("input").filter(node => node.owner === owner && String(node.attributes.maxlength) === length);
  assert.equal(fields.length, 1); const field = fields[0];
  let form = field.parent; while (form && form.tag !== "form") form = form.parent;
  assert.ok(form && form.owner === owner && typeof form.handlers.submit === "function");
  const selects = tree.visible("select").filter(node => node.owner === owner && c19NamingWithin(node, form));
  assert.equal(selects.length, kind === "preference" ? 2 : 1);
  for (const node of [form, field, ...selects]) {
    assert.ok(node.port?.isConnected && f.renderer.nodes.includes(node.port));
    assert.equal(node.port.owner, owner); assert.equal(node.hiddenBy, null);
  }
  assert.equal(field.port.matches(":disabled"), false); assert.equal(typeof field.handlers.input, "function");
  assert.equal(typeof field.propertyParts.value, "string");
  if (previousPart !== null) assert.equal(field.propertyParts.value, previousPart);
  assert.equal(field.properties.value, expected.raw); assert.equal(field.port.value, expected.raw);
  assert.deepEqual(selects.map(node => node.properties.value), expected.selects);
  assert.deepEqual(selects.map(node => node.port.value), expected.selects);
  if (kind === "condition") {
    const type = expected.selects[0] === "on_date" ? "date" : "number";
    const extra = tree.visible("input").filter(node => node.owner === owner && c19NamingWithin(node, form) && node.attributes.type === type);
    assert.equal(extra.length, 1); assert.equal(extra[0].port.value, expected.extra);
    assert.equal(extra[0].properties.value, expected.extra);
  }
  return { form, field, selects, part: field.propertyParts.value };
}
async function cMemorySetRaw(f, owner, kind, raw) {
  const field = f.find("input", node => node.owner === owner && String(node.attributes.maxlength) === (kind === "preference" ? "120" : "300"));
  assert.ok(field.port.isConnected); field.port.value = raw; await f.act(field, "input");
}
async function cMemorySetChoice(f, owner, kind, value) {
  const tree = f.tree(), fields = tree.visible("input").filter(node => node.owner === owner
    && String(node.attributes.maxlength) === (kind === "preference" ? "120" : "300"));
  assert.equal(fields.length, 1); let form = fields[0].parent; while (form && form.tag !== "form") form = form.parent;
  const choices = tree.visible("select").filter(node => node.owner === owner && c19NamingWithin(node, form));
  assert.equal(choices.length, kind === "preference" ? 2 : 1);
  const choice = choices[0];
  assert.ok(choice.port.isConnected && typeof choice.handlers.change === "function");
  assert.ok(tree.visible("option").some(node => node.parent === choice && node.attributes.value === value));
  choice.port.value = value; await f.act(choice, "change");
}
async function cMemoryScoutDeparture(f, native, viaCommand) {
  if (!viaCommand) return cOrdinaryNavClick(f, f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && node.owner.parentElement?.tag === "forma-area-navigation" && node.attributes.href === "/scout"), native);
  const label = fIntelligenceLabel(f, F_INTELLIGENCE_ENTRIES[1]), before = f.navigationHost.requests.length;
  await openDiscoverySearch(f, label);
  const input = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search");
  assert.ok(input.port.isConnected); assert.equal(input.port.value, label);
  assert.equal(f.navigationHost.requests.length, before, "Discovery remains available without submitting or fetching a destination");
  const tree = f.tree(), rows = tree.visible("button").filter(node => node.owner === f.host
    && node.attributes.role === "option" && fIntelligenceRowHasLabel(node, label));
  assert.equal(rows.length, 1);
  const gesture = await cOrdinaryNavClick(f, rows[0], native);
  assert.equal(f.store.ui.commandOpen, false); return gesture;
}
async function cMemoryEnter(t, locale) {
  const x = await fSessionPage(t, locale, "thread", { eligible: false }), { f, h } = x;
  await registerCalmFullPageComponents(f, ["forma-memory"]);
  const native = await cOrdinaryNavNative(t, f);
  const before = await cOrdinaryNavBefore(f);
  await cOrdinaryNavClick(f, f.find("button", node => node.owner === x.owner && node.text === "Manage reminders"), native);
  await cOrdinaryNavNoWrite(f, before);
  assert.equal(h.store.route.get(), "/memory"); assert.equal(x.owner.isConnected, false);
  const owner = f.components().find(value => value.tag === "forma-memory" && value.store === h.store);
  assert.ok(owner instanceof f.modules.get("src/components/forma-memory.ts").FormaMemory && owner.isConnected);
  return { ...x, owner, native };
}
for (const [kind, locale, viaCommand] of [["preference", "en", true], ["condition", "ja", false]])
test("C Memory current raw and selector-only work retains departure until deliberate resolution / " + kind + " / " + locale,
  fIntelligenceOptions, async t => {
    const x = await cMemoryEnter(t, locale), { f, h, native } = x;
    const clean = kind === "preference" ? { raw: "", selects: ["style", "affirm"] }
      : { raw: "", selects: ["generation_count"], extra: "3" };
    cMemoryOwnedControls(f, x.owner, kind, clean);
    let before = await cOrdinaryNavBefore(f);
    await cMemoryScoutDeparture(f, native, viaCommand); await cOrdinaryNavNoWrite(f, before);
    assert.equal(h.store.route.get(), "/scout"); assert.equal(x.owner.isConnected, false);
    const scout = f.components().find(value => value.tag === "forma-scout" && value.store === h.store); assert.ok(scout?.isConnected);
    await cOrdinaryNavClick(f, f.find("button", node => node.owner === scout && node.text === "Return to recent work"), native);
    assert.equal(h.store.route.get(), "/sessions"); assert.equal(scout.isConnected, false);
    const sessions = f.components().find(value => value.tag === "forma-sessions" && value.store === h.store); assert.ok(sessions?.isConnected);
    await cOrdinaryNavClick(f, f.find("button", node => node.owner === sessions && node.text === "Manage reminders"), native);
    assert.equal(h.store.route.get(), "/memory");
    const owner = f.components().find(value => value.tag === "forma-memory" && value.store === h.store);
    const part = cMemoryOwnedControls(f, owner, kind, clean).part;
    const raw = "  Unsent Memory B — 未送信\n  ", choice = kind === "preference" ? "lighting" : "on_date";
    await cMemorySetRaw(f, owner, kind, raw); await cMemorySetChoice(f, owner, kind, choice);
    if (kind === "condition") {
      const date = f.find("input", node => node.owner === owner && node.attributes.type === "date");
      date.port.value = "2026-12-31"; await f.act(date, "input");
    }
    const edited = kind === "preference" ? { raw, selects: ["lighting", "affirm"] }
      : { raw, selects: ["on_date"], extra: "2026-12-31" };
    cMemoryOwnedControls(f, owner, kind, edited, part); await cOrdinaryNavSettle(f);
    before = await cOrdinaryNavBefore(f);
    const gesture = await cMemoryScoutDeparture(f, native, viaCommand);
    await cOrdinaryNavNoWrite(f, before); cOrdinaryNavObserve(t, f, before, "memory-" + kind + "-raw", owner);
    cOrdinaryNavRefused(f, before, native, gesture, owner); cMemoryOwnedControls(f, owner, kind, edited, part);
    assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0, "Refusal does not add a confirmation panel");
    await cMemorySetRaw(f, owner, kind, ""); cMemoryOwnedControls(f, owner, kind, { ...edited, raw: "" }, part);
    const selectorBefore = await cOrdinaryNavBefore(f), selectorGesture = await cMemoryScoutDeparture(f, native, viaCommand);
    await cOrdinaryNavNoWrite(f, selectorBefore);
    cOrdinaryNavRefused(f, selectorBefore, native, selectorGesture, owner);
    cMemoryOwnedControls(f, owner, kind, { ...edited, raw: "" }, part);
    if (kind === "condition") {
      const date = f.find("input", node => node.owner === owner && node.attributes.type === "date");
      date.port.value = ""; await f.act(date, "input");
    }
    await cMemorySetChoice(f, owner, kind, clean.selects[0]);
    cMemoryOwnedControls(f, owner, kind, clean, part);
    await cMemoryScoutDeparture(f, native, viaCommand); await cOrdinaryNavNoWrite(f, before);
    assert.equal(h.store.route.get(), "/scout"); assert.equal(owner.isConnected, false); h.exact();
    assert.equal(h.briefReceipts.records().length, 0); await fSessionNoExtraEffects(x);
  });
test("C Sessions direct Manage reminders retains raw intent then permits deliberate clear / en",
  fIntelligenceOptions, async t => {
    const x = await fSessionPage(t, "en", "thread", { eligible: false }), { f, h, owner } = x;
    await registerCalmFullPageComponents(f, ["forma-memory"]);
    const native = await cOrdinaryNavNative(t, f), raw = "  Unsent intent before reminder navigation\n  ";
    await fSessionDraftType(x, "intent", raw); const part = cSessionCommandIntentControls(x, raw).part;
    await cOrdinaryNavSettle(f); const before = await cOrdinaryNavBefore(f);
    const reminder = () => f.find("button", node => node.owner === owner && node.text === "Manage reminders");
    const gesture = await cOrdinaryNavClick(f, reminder(), native);
    await cOrdinaryNavNoWrite(f, before); cOrdinaryNavObserve(t, f, before, "sessions-direct-reminders", owner);
    cOrdinaryNavRefused(f, before, native, gesture, owner); cSessionCommandIntentControls(x, raw, part);
    await fSessionDraftType(x, "intent", ""); cSessionCommandIntentControls(x, "", part);
    await cOrdinaryNavClick(f, reminder(), native); await cOrdinaryNavNoWrite(f, before);
    assert.equal(h.store.route.get(), "/memory"); assert.equal(owner.isConnected, false);
    assert.equal(f.components().filter(value => value.tag === "forma-memory" && value.store === h.store && value.isConnected).length, 1);
    assert.equal(h.briefReceipts.records().length, 0); await fSessionNoExtraEffects(x);
  });

// Read-only Output is one current presentation, not a clean certificate for
// another editor retained by the same Library's existing keyed/cache lifetime.
import { parseOutputRequirement as cLibraryInspectionParse } from "../src/model/output-requirements.ts";

function cLibraryInspectionBack(f, editor) {
  const tree = f.tree(), header = fDecisionOne(f, tree, "header", node => node.owner === editor
    && fObjectClassed(node, "library-block-editor-header"), "Exact current Library editor header");
  return fDecisionOne(f, tree, "button", node => node.owner === editor && c19NamingWithin(node, header)
    && node.text === f.i18n.system("Back to Library"), "The actual current same-Library Back control");
}

for (const cachedRaw of [false, true]) test(
  "C Library read-only Output ordinary departure / " + (cachedRaw ? "retains older cached raw sibling" : "clean exact Document arrival"),
  fIntelligenceOptions, async t => {
    const x = await fDecisionPage(t, { locale: "en", scope: "library", method: "click", boundary: "healthy" }), { f, h, block } = x;
    const requirementId = "c-library-readonly-output", spec = cLibraryInspectionParse({ id: requirementId,
      Type: "Output", Subtype: "Social media image", Content: 'One image at aspect ratio "1:1".' }).spec;
    // Same real RAM audit/source setup as fDecisionPage, before the gesture's
    // closed history/fiscal floor. This is not a generated result or approval.
    await h.external("BlockCreated", { project_id: h.a, document_id: h.ad, block_id: requirementId,
      scope: "document", type: "output", handle: "output/c-library-readonly", position: "zz-readonly-output",
      properties: { text: spec.original_text, subtype: spec.label, output_spec: spec, weight: 1, authority: "authored" } });
    await h.store.refreshEvents({ fromStart: true }); await f.settle();
    const native = await cOrdinaryNavNative(t, f); h.exact();
    await cOrdinaryNavClick(f, f.task("/library"), native);
    const libraries = f.components().filter(owner => owner.tag === "forma-library" && owner.store === h.store && owner.isConnected);
    assert.equal(libraries.length, 1); const library = libraries[0];
    const publisherInputs = cLibraryDraftNativeDefaults(t, f, library);
    assert.deepEqual(publisherInputs(), [], "Actual personal Library has no organization publisher input; do not invent native defaults");
    const controls = id => f.find("button", node => node.owner === library && node.attributes["data-context-controls-id"] === id);
    let older = null;
    const raw = "  direction/cached-sibling-B — 未保存  ";
    if (cachedRaw) {
      await cOrdinaryNavClick(f, controls(block.id), native);
      const matches = f.components().filter(owner => owner.tag === "forma-library-block-editor" && owner.blockId === block.id && owner.store === h.store);
      assert.equal(matches.length, 1); older = matches[0]; assert.ok(older.isConnected);
      const field = f.find("input", node => node.owner === older && String(node.attributes.maxlength) === "96");
      assert.equal(field.port.value, block.handle); assert.equal(field.port.matches(":disabled"), false);
      field.port.value = raw; await f.act(field, "input");
      assert.equal(f.find("input", node => node.owner === older && String(node.attributes.maxlength) === "96").properties.value, raw);
      const backFloor = await cOrdinaryNavBefore(f);
      await cOrdinaryNavClick(f, cLibraryInspectionBack(f, older), native); await cOrdinaryNavNoWrite(f, backFloor);
      assert.equal(h.store.route.get(), "/library?document=" + h.ad); assert.ok(library.isConnected);
      assert.equal(older.isConnected, false, "Existing cache detaches the raw editor; connected queries alone cannot certify it clean");
      assert.equal(f.tree().visible("form").filter(node => node.owner === older && fObjectClassed(node, "library-block-form")).length, 0);
    }
    await cOrdinaryNavClick(f, controls(requirementId), native);
    const route = libraryBlockEditorRoute(requirementId, "/library?document=" + h.ad);
    assert.equal(h.store.route.get(), route); h.exact();
    const inspections = f.components().filter(owner => owner.tag === "forma-library-block-editor" && owner.blockId === requirementId && owner.store === h.store);
    assert.equal(inspections.length, 1); const inspection = inspections[0];
    assert.ok(inspection.isConnected); assert.equal(inspection.closest("forma-library"), library);
    assert.equal(inspection.closest("forma-shell"), f.host); assert.ok(f.host.contains(inspection));
    assert.equal(f.tree().visible("form").filter(node => node.owner === inspection).length, 0);
    const controllers = f.components().filter(owner => owner.tag === "forma-output-requirements" && owner.documentId === h.ad && owner.blockId === requirementId);
    assert.equal(controllers.length, 1); assert.ok(controllers[0].inspectionOnly);
    const resource = h.store.outputRequirements.resource(h.ad);
    assert.equal(resource.state, "ready"); assert.ok(resource.snapshot.requirements.some(row => row.blockId === requirementId));
    const open = f.find("button", node => node.owner === inspection && node.text === f.i18n.system("Open Document"));
    assert.equal(open.port.matches(":disabled"), false);
    const destination = withDocumentInRoute("/", h.ad, h.store.projection.get().documentTitle);
    const before = await cOrdinaryNavBefore(f), gesture = await cOrdinaryNavClick(f, open, native);
    await cOrdinaryNavNoWrite(f, before);
    t.diagnostic("C_LIBRARY_READONLY_CACHED_OWNER " + JSON.stringify({ cachedRaw, originalRoute: before.route,
      actualRoute: h.store.route.get(), requirementId, currentInspectionConnected: inspection.isConnected,
      priorEditorConnected: older?.isConnected ?? null, exactHistoryReceiptFiscalUnchanged: true,
      attributableRequests: h.requests.slice(before.requests).map(row => ({ method: row.init.method ?? "GET", url: row.url })),
      evidence: "actual Library/Output/Store/RAM Worker and existing cache; no physical, generation or approval claim" }));
    assert.deepEqual(h.store.projection.get().libraryBlocks.find(row => row.id === block.id), block);
    assert.equal(h.store.projection.get().libraryBlocks.find(row => row.id === requirementId).properties.text, spec.original_text);
    if (!cachedRaw) {
      assert.equal(h.store.route.get(), destination); assert.equal(h.location.pathname + h.location.search + h.location.hash, destination);
      assert.equal(inspection.isConnected, false); assert.equal(library.isConnected, false);
      const workspaces = f.components().filter(owner => owner.tag === "forma-workspace" && owner.store === h.store && owner.isConnected);
      assert.equal(workspaces.length, 1); assert.equal(h.store.ui.commandOpen, false); return;
    }
    cOrdinaryNavRefused(f, before, native, gesture, inspection);
    assert.equal(h.store.route.get(), route); assert.ok(library.isConnected && inspection.isConnected);
    assert.equal(older.isConnected, false, "Refusal must not silently reopen the cached editor");
    assert.equal(f.tree().visible("form").filter(node => node.owner === older && fObjectClassed(node, "library-block-form")).length, 0);
    await cOrdinaryNavClick(f, cLibraryInspectionBack(f, inspection), native); await cOrdinaryNavNoWrite(f, before);
    assert.equal(h.store.route.get(), "/library?document=" + h.ad); assert.equal(f.components().find(owner => owner.tag === "forma-library"), library);
    await cOrdinaryNavClick(f, controls(block.id), native); await cOrdinaryNavNoWrite(f, before);
    assert.equal(h.store.route.get(), libraryBlockEditorRoute(block.id, "/library?document=" + h.ad));
    assert.equal(f.components().find(owner => owner.tag === "forma-library-block-editor" && owner.blockId === block.id), older);
    assert.ok(older.isConnected); const restored = f.find("input", node => node.owner === older && String(node.attributes.maxlength) === "96");
    assert.equal(restored.properties.value, raw); assert.equal(restored.port.value, raw);
    assert.deepEqual(h.store.projection.get().libraryBlocks.find(row => row.id === block.id), block);
    assert.equal(h.store.ui.commandOpen, false);
  });

test("C Library cached raw editor follows actual Source retirement and restoration / en",
  fIntelligenceOptions, async t => {
    const x = await fDecisionPage(t, { locale: "en", scope: "library", method: "click", boundary: "healthy" }), { f, h, block } = x;
    const native = await cOrdinaryNavNative(t, f);
    await cOrdinaryNavClick(f, f.task("/library"), native); h.exact();
    const library = f.components().find(owner => owner.tag === "forma-library" && owner.store === h.store && owner.isConnected);
    assert.ok(library); assert.deepEqual(cLibraryDraftNativeDefaults(t, f, library)(), []);
    const controls = owner => f.find("button", node => node.owner === owner && node.attributes["data-context-controls-id"] === block.id);
    await cOrdinaryNavClick(f, controls(library), native);
    const original = f.components().find(owner => owner.tag === "forma-library-block-editor" && owner.blockId === block.id && owner.store === h.store);
    assert.ok(original?.isConnected);
    const field = f.find("input", node => node.owner === original && String(node.attributes.maxlength) === "96");
    const raw = "  direction/source-owned-B — 未保存  ";
    assert.equal(field.port.value, block.handle); assert.equal(field.port.matches(":disabled"), false);
    field.port.value = raw; await f.act(field, "input");
    assert.equal(f.find("input", node => node.owner === original && String(node.attributes.maxlength) === "96").properties.value, raw);
    await cOrdinaryNavClick(f, cLibraryInspectionBack(f, original), native);
    assert.equal(original.isConnected, false); assert.ok(library.isConnected);
    const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
    const history = await h.history(), counts = h.counts();
    assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
    // A successful ordinary canonical refresh is not a private-owner retirement.
    await h.store.refreshEvents({ fromStart: true }); await cOrdinaryNavSettle(f);
    assert.ok(h.store.sourceOwnershipActive(source));
    assert.equal(h.store.captureSourceOwnership().generation, source.generation);
    await cOrdinaryNavClick(f, controls(library), native);
    assert.equal(f.components().find(owner => owner.tag === "forma-library-block-editor" && owner.blockId === block.id), original);
    assert.equal(f.find("input", node => node.owner === original && String(node.attributes.maxlength) === "96").port.value, raw);
    await cOrdinaryNavClick(f, cLibraryInspectionBack(f, original), native);
    assert.equal(original.isConnected, false);

    // Same original Worker-denial pattern as the existing decision Source case.
    // The actual positive restore also passes through unchanged, never a new grant.
    const env = h.worker.env, key = "FORMA_PILOT_COHORT_ID", had = Object.hasOwn(env, key), previous = env[key];
    const prior = h.intercept, pending = new Set(), reads = []; let expectedStatus = 403;
    const restorePolicy = () => { if (had) env[key] = previous; else delete env[key]; };
    env[key] = "synthetic-missing-c-library-cached-source-cohort";
    h.intercept = request => {
      if (!request.url.startsWith("/api/events?") || (request.init.method ?? "GET") !== "GET") return prior?.(request);
      const expected = expectedStatus;
      const operation = (async () => {
        const response = await h.worker.request(request.url, request.init);
        assert.equal(response.status, expected);
        if (expected === 403) assert.equal((await response.clone().json()).error, "pilot_participant_required");
        reads.push({ status: response.status, url: request.url }); return response;
      })();
      pending.add(operation); operation.then(() => pending.delete(operation), () => pending.delete(operation)); return operation;
    };
    try {
      await assert.rejects(h.store.refreshEvents({ fromStart: true }), /Event stream returned 403/u);
      await f.settle(); await Promise.all([...pending]);
      assert.ok(reads.some(read => read.status === 403));
      assert.equal(h.store.sourceOwnershipActive(source), false);
      assert.ok(h.store.authorizationScopeActive(authorization), "Source retired without changing the actual actor");
      assert.deepEqual(h.store.events.get(), []); assert.deepEqual(h.store.content.get(), {});
      assert.equal(original.isConnected, false);
      assert.equal(f.tree().visible("input").some(node => node.port?.value === raw), false);

      restorePolicy(); expectedStatus = 200;
      await h.store.refreshEvents({ fromStart: true }); await cOrdinaryNavSettle(f); await Promise.all([...pending]);
      assert.ok(reads.some(read => read.status === 200));
      const restoredSource = h.store.captureSourceOwnership();
      assert.ok(h.store.sourceOwnershipActive(restoredSource)); assert.ok(restoredSource.generation > source.generation);
      assert.equal(h.store.sourceOwnershipActive(source), false, "A fresh source cannot revive the retired certificate");
      assert.ok(h.store.authorizationScopeActive(authorization)); h.exact();
      assert.deepEqual(await h.history(), history); assert.deepEqual(h.counts(), counts);
      assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === block.id), block);
      const restoredLibrary = f.components().filter(owner => owner.tag === "forma-library" && owner.store === h.store && owner.isConnected);
      assert.equal(restoredLibrary.length, 1); const current = restoredLibrary[0];
      assert.deepEqual(cLibraryDraftNativeDefaults(t, f, current)(), []);
      await cOrdinaryNavClick(f, controls(current), native);
      const fresh = f.components().filter(owner => owner.tag === "forma-library-block-editor" && owner.blockId === block.id && owner.store === h.store && owner.isConnected);
      assert.equal(fresh.length, 1); assert.notEqual(fresh[0], original, "True Source retirement ends the old private cache lifetime");
      const restoredField = f.find("input", node => node.owner === fresh[0] && String(node.attributes.maxlength) === "96");
      assert.equal(restoredField.port.value, block.handle); assert.equal(restoredField.properties.value, block.handle);
      await cOrdinaryNavClick(f, cLibraryInspectionBack(f, fresh[0]), native);
      const before = await cOrdinaryNavBefore(f);
      const destination = withDocumentInRoute("/", h.ad, h.store.projection.get().documentTitle);
      const work = f.task(new URL(destination, "https://fixture.invalid").pathname);
      assert.equal(work.attributes.href, destination);
      await cOrdinaryNavClick(f, work, native); await cOrdinaryNavNoWrite(f, before);
      assert.equal(h.store.route.get(), destination); assert.equal(current.isConnected, false);
      assert.equal(f.components().filter(owner => owner.tag === "forma-workspace" && owner.store === h.store && owner.isConnected).length, 1);
      assert.deepEqual(await h.history(), history); assert.deepEqual(h.counts(), counts);
      t.diagnostic("C_LIBRARY_CACHED_SOURCE_RETIREMENT " + JSON.stringify({ normalReadRetainedOriginal: true,
        statuses: reads.map(read => read.status), originalGeneration: source.generation, restoredGeneration: restoredSource.generation,
        oldCertificateRetired: true, currentRawRestoredFromCanonical: true, freshDeparture: destination,
        originalHistoryFiscalUnchanged: true, evidence: "actual Store/Worker Source and cached native host; not physical or new authority" }));
    } finally { await Promise.all([...pending]); h.intercept = prior; restorePolicy(); }
  });

function cLibraryEditorSaveReceiptAccounting(t, h, admit) {
  const prior = h.transport, records = [], proofs = new WeakMap(); let armed = null;
  const original = request => prior ? prior(request) : h.worker.request(request.url, request.init);
  const execute = async (request, record) => {
    record.request = request; const init = request.init, bytes = init.body, input = JSON.parse(bytes);
    assert.ok(h.requests.includes(request)); assert.equal(h.store.route.get(), record.route);
    assert.equal(h.store.session.get().user.userId, record.actor); assert.equal(h.store.session.get().projectContext == null, true);
    assert.equal(h.store.projection.get().projectId, record.projectId);
    assert.ok(h.store.sourceOwnershipActive(record.source) && h.store.authorizationScopeActive(record.authorization));
    const history = await h.history(), counts = h.counts();
    const event = { type: "BlockRenamed", payload: { block_id: record.block.id, old_handle: record.block.handle,
      new_handle: record.raw.trim(), reason: "library-block-editor" } };
    assert.deepEqual(Object.keys(input).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
    assert.equal(input.action, "append"); assert.equal(input.clientId, "web:lit");
    assert.equal(input.expectedSequence, history.at(-1).sequence);
    assert.deepEqual(input.event, event); assert.deepEqual(input.events, [event]);
    const response = await original(request), receipt = await response.clone().json();
    assert.equal(response.status, 200); assert.equal(response.bodyUsed, false);
    assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]); assert.deepEqual(receipt.rejected, []);
    assert.equal(receipt.appended.length, 1);
    const committed = receipt.appended[0];
    assert.equal(committed.type, event.type); assert.deepEqual(committed.payload, event.payload);
    assert.equal(committed.sequence, input.expectedSequence + 1); assert.equal(receipt.head, committed.sequence);
    assert.equal(committed.streamId, h.worker.streamId); assert.equal(committed.actor, "user"); assert.equal(committed.clientId, "web:lit");
    assert.ok(committed.eventId && committed.correlationId);
    await h.worker.drainBackground(); assert.deepEqual(await h.history(), [...history, committed]); assert.deepEqual(h.counts(), counts);
    assert.equal(request.init, init); assert.equal(request.init.body, bytes); assert.equal(JSON.stringify(request.body), bytes);
    assert.ok(h.store.sourceOwnershipActive(record.source) && h.store.authorizationScopeActive(record.authorization));
    await admit([committed]);
    proofs.set(request, { init, bytes }); record.receipt = receipt; record.response = response;
    record.entered.resolve(); await record.gate.promise;
    assert.equal(request.init, init); assert.equal(request.init.body, bytes); assert.equal(response.bodyUsed, false);
    record.delivered = true; return response;
  };
  const transport = request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") return original(request);
    assert.ok(armed && !armed.request, "Only one explicitly armed actual Library Save is admitted");
    const record = armed; armed = null; record.pending = execute(request, record);
    record.pending.catch(error => { record.error = error; record.entered.resolve(); }); return record.pending;
  };
  h.transport = transport;
  t.after(() => { for (const record of records) record.gate.resolve(); if (h.transport === transport) h.transport = prior; });
  return {
    arm(block, raw) {
      assert.equal(armed, null); assert.equal(records.length, 0); assert.equal(block.scope, "library");
      assert.equal(block.type, "direction"); assert.equal(block.projectId, h.a); assert.notEqual(raw.trim(), block.handle);
      const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
      assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      const record = { block: structuredClone(block), raw, source, authorization, projectId: h.a,
        actor: h.store.session.get().user.userId, route: h.store.route.get(), entered: sceneDeferred(), gate: sceneDeferred(),
        request: null, pending: null, receipt: null, response: null, delivered: false, error: null };
      records.push(record); armed = record; return record;
    },
    async reached(record) { await record.entered.promise; if (record.error) throw record.error; assert.ok(record.receipt); },
    exact(request) { const proof = proofs.get(request); return Boolean(proof && request.url === "/api/events"
      && request.init.method === "POST" && request.init === proof.init && request.init.body === proof.bytes && JSON.stringify(request.body) === proof.bytes); },
    records: () => [...records],
  };
}

test("C Library retained original Save blocks Output departure after exact raw revert / en",
  fIntelligenceOptions, async t => {
    const f = await navigationPage(t, "en", { nativePreparation: true, libraryEditorSaveReceiptAccounting: true }), h = f.navigationHost;
    const blockId = "c-library-pending-save-direction", requirementId = "c-library-pending-save-output";
    await h.external("BlockCreated", { project_id: h.a, scope: "library", block_id: blockId,
      type: "direction", handle: "direction/pending-original", position: "l-pending-save",
      properties: { text: "Original reusable direction.", subtype: "Campaign goal", intent: "include", weight: 0.65, authority: "authored" } });
    const spec = cLibraryInspectionParse({ id: requirementId, Type: "Output", Subtype: "Social media image",
      Content: 'One image at aspect ratio "1:1".' }).spec;
    await h.external("BlockCreated", { project_id: h.a, document_id: h.ad, block_id: requirementId,
      scope: "document", type: "output", handle: "output/c-library-pending", position: "zz-pending-output",
      properties: { text: spec.original_text, subtype: spec.label, output_spec: spec, weight: 1, authority: "authored" } });
    await h.store.refreshEvents({ fromStart: true }); await f.settle();
    const native = await cOrdinaryNavNative(t, f); h.exact();
    await cOrdinaryNavClick(f, f.task("/library"), native);
    const library = f.components().find(owner => owner.tag === "forma-library" && owner.store === h.store && owner.isConnected);
    assert.ok(library); assert.deepEqual(cLibraryDraftNativeDefaults(t, f, library)(), []);
    const controls = id => f.find("button", node => node.owner === library && node.attributes["data-context-controls-id"] === id);
    await cOrdinaryNavClick(f, controls(blockId), native);
    const editor = f.components().find(owner => owner.tag === "forma-library-block-editor" && owner.blockId === blockId && owner.store === h.store);
    assert.ok(editor?.isConnected);
    const block = structuredClone(h.store.projection.get().libraryBlocks.find(row => row.id === blockId));
    const field = () => f.find("input", node => node.owner === editor && String(node.attributes.maxlength) === "96");
    const raw = "  direction/submitted-original-A  ";
    assert.equal(field().port.value, block.handle); field().port.value = raw; await f.act(field(), "input");
    const form = f.find("form", node => node.owner === editor && fObjectClassed(node, "library-block-form"));
    const save = f.find("button", node => node.owner === editor && node.text === f.i18n.system("Save changes"));
    assert.equal(save.port.matches(":disabled"), false); assert.equal(save.handlers.click, undefined);
    const record = h.libraryEditorSaveReceipts.arm(block, raw);
    let finished = false;
    const submitting = f.act(form, "submit").then(() => { finished = true; });
    void submitting.catch(() => {}); // The original Promise is still joined in finally.
    try {
      await h.libraryEditorSaveReceipts.reached(record); await f.settle();
      assert.equal(record.delivered, false); assert.equal(finished, false); assert.ok(h.libraryEditorSaveReceipts.exact(record.request));
      assert.equal(h.libraryEditorSaveReceipts.exact({ ...record.request }), false);
      assert.deepEqual(h.store.projection.get().libraryBlocks.find(row => row.id === blockId), block);
      assert.equal(h.store.events.get().some(event => event.eventId === record.receipt.appended[0].eventId), false);
      assert.equal(h.store.busy.get(), "BlockRenamed"); assert.deepEqual(h.store.optimisticEvents.get(), []);
      assert.equal(field().port.matches(":disabled"), false); field().port.value = block.handle; await f.act(field(), "input");
      assert.equal(field().port.value, block.handle); assert.equal(field().properties.value, block.handle);
      // This exact already-verified original Worker200 remains held, not read-only
      // or delivered. Drain every other original using the unchanged finite bound.
      const heldOriginal = { request: record.request, current: () => h.libraryEditorSaveReceipts.exact(record.request)
        && record.response.status === 200 && record.response.bodyUsed === false && !record.delivered && !finished
        && h.store.session.get().user.userId === record.actor && h.store.projection.get().projectId === record.projectId
        && h.store.sourceOwnershipActive(record.source) && h.store.authorizationScopeActive(record.authorization) };
      const settleHeld = async () => {
        assert.equal(heldOriginal.current(), true);
        await cOrdinaryNavSettle(f, { heldOriginal });
        assert.equal(h.navigationResumeReads.pendingOriginalCount(), 1, "The original Save remains counted as pending");
        assert.equal(h.navigationResumeReads.pendingOriginalCount({ heldOriginal }), 0, "Only that exact verified held original is excluded from this wait");
        assert.equal(h.navigationResumeReads.pendingOriginalCount({ heldOriginal: { ...heldOriginal, request: { ...record.request } } }), 1,
          "A cloned outer request cannot exclude the original transport");
        assert.equal(h.navigationResumeReads.isReadOnlyResume(record.request), false, "A real Save is never certified as a free Resume read");
        assert.equal(record.delivered, false); assert.equal(finished, false);
      };
      await cOrdinaryNavClick(f, cLibraryInspectionBack(f, editor), native, settleHeld);
      assert.equal(editor.isConnected, false); assert.ok(library.isConnected); assert.equal(finished, false);
      await cOrdinaryNavClick(f, controls(requirementId), native, settleHeld);
      const inspection = f.components().find(owner => owner.tag === "forma-library-block-editor" && owner.blockId === requirementId && owner.store === h.store);
      assert.ok(inspection?.isConnected); assert.equal(f.tree().visible("form").some(node => node.owner === inspection), false);
      const resource = h.store.outputRequirements.resource(h.ad);
      assert.equal(resource.state, "ready"); assert.ok(resource.snapshot.requirements.some(row => row.blockId === requirementId));
      const before = await cOrdinaryNavBefore(f);
      const open = f.find("button", node => node.owner === inspection && node.text === f.i18n.system("Open Document"));
      const gesture = await cOrdinaryNavClick(f, open, native, settleHeld); await cOrdinaryNavNoWrite(f, before);
      t.diagnostic("C_LIBRARY_RETAINED_PENDING_SAVE " + JSON.stringify({ actualCommittedEvent: record.receipt.appended[0].eventId,
        originalDelivered: record.delivered, originalFinished: finished, originalRawReverted: true,
        originalEditorConnected: editor.isConnected, actualRoute: h.store.route.get(), desiredRoute: before.route,
        currentInspectionConnected: inspection.isConnected, storeBusy: h.store.busy.get(),
        exactOriginalHistoryReceiptFiscal: true, evidence: "actual native Save/Back/Output and held original Worker200; no replacement ACK" }));
      assert.equal(record.delivered, false); assert.equal(finished, false); assert.equal(h.libraryEditorSaveReceipts.records().length, 1);
      cOrdinaryNavRefused(f, before, native, gesture, inspection);
      record.gate.resolve(); await submitting; await cOrdinaryNavSettle(f);
      assert.equal(record.delivered, true); assert.equal(finished, true);
      assert.ok(h.store.events.get().some(event => event.eventId === record.receipt.appended[0].eventId));
      assert.equal(h.store.projection.get().libraryBlocks.find(row => row.id === blockId).handle, raw.trim());
      await cOrdinaryNavClick(f, cLibraryInspectionBack(f, inspection), native);
      await cOrdinaryNavClick(f, controls(blockId), native);
      assert.ok(editor.isConnected); assert.equal(field().port.value, raw.trim());
      await cOrdinaryNavClick(f, cLibraryInspectionBack(f, editor), native);
      await cOrdinaryNavClick(f, controls(requirementId), native);
      const fresh = f.components().find(owner => owner.tag === "forma-library-block-editor" && owner.blockId === requirementId && owner.isConnected);
      assert.ok(fresh); const completed = await cOrdinaryNavBefore(f);
      await cOrdinaryNavClick(f, f.find("button", node => node.owner === fresh && node.text === f.i18n.system("Open Document")), native);
      await cOrdinaryNavNoWrite(f, completed);
      assert.equal(h.store.route.get(), withDocumentInRoute("/", h.ad, h.store.projection.get().documentTitle));
      assert.equal(library.isConnected, false); assert.equal(h.libraryEditorSaveReceipts.records().length, 1);
    } finally { record.gate.resolve(); await submitting; }
    if (record.error) throw record.error;
  });

test("C Library original acknowledged Save preserves newer raw name B / en",
  fIntelligenceOptions, async t => {
    const f = await navigationPage(t, "en", { nativePreparation: true, libraryEditorSaveReceiptAccounting: true }), h = f.navigationHost;
    const blockId = "c-library-save-newer-name";
    await h.external("BlockCreated", { project_id: h.a, scope: "library", block_id: blockId,
      type: "direction", handle: "direction/save-original", position: "l-save-newer",
      properties: { text: "Original reusable direction.", subtype: "Campaign goal", intent: "include", weight: 0.65, authority: "authored" } });
    await h.store.refreshEvents({ fromStart: true }); await f.settle();
    const native = await cOrdinaryNavNative(t, f); h.exact();
    await cOrdinaryNavClick(f, f.task("/library"), native);
    const library = f.components().find(owner => owner.tag === "forma-library" && owner.store === h.store && owner.isConnected);
    assert.ok(library); assert.deepEqual(cLibraryDraftNativeDefaults(t, f, library)(), []);
    const controls = f.find("button", node => node.owner === library && node.attributes["data-context-controls-id"] === blockId);
    await cOrdinaryNavClick(f, controls, native);
    const editor = f.components().find(owner => owner.tag === "forma-library-block-editor" && owner.blockId === blockId && owner.store === h.store);
    assert.ok(editor?.isConnected);
    const block = structuredClone(h.store.projection.get().libraryBlocks.find(row => row.id === blockId));
    const field = () => f.find("input", node => node.owner === editor && String(node.attributes.maxlength) === "96");
    const rawA = "  direction/acknowledged-A  ", rawB = "  direction/newer-B — 保持  ";
    assert.equal(field().port.value, block.handle); assert.equal(field().port.matches(":disabled"), false);
    field().port.value = rawA; await f.act(field(), "input");
    assert.equal(field().properties.value, rawA);
    const form = f.find("form", node => node.owner === editor && fObjectClassed(node, "library-block-form"));
    const save = f.find("button", node => node.owner === editor && node.text === f.i18n.system("Save changes"));
    assert.equal(save.port.matches(":disabled"), false); assert.equal(save.handlers.click, undefined);
    const before = await cOrdinaryNavBefore(f), record = h.libraryEditorSaveReceipts.arm(block, rawA);
    let finished = false;
    const submitting = f.act(form, "submit").then(() => { finished = true; });
    void submitting.catch(() => {}); // Joined below even when the desired assertion fails.
    try {
      await h.libraryEditorSaveReceipts.reached(record); await f.settle();
      assert.equal(record.response.status, 200); assert.equal(record.delivered, false); assert.equal(finished, false);
      assert.ok(h.libraryEditorSaveReceipts.exact(record.request));
      assert.equal(h.libraryEditorSaveReceipts.exact({ ...record.request }), false);
      assert.deepEqual(h.store.projection.get().libraryBlocks.find(row => row.id === blockId), block);
      assert.equal(h.store.events.get().some(event => event.eventId === record.receipt.appended[0].eventId), false);
      const current = field(); assert.equal(current.port.matches(":disabled"), false);
      f.native.emit("pointerdown", current.port); f.native.focus(current.port);
      current.port.value = rawB; await f.act(current, "input");
      assert.equal(field().port.value, rawB); assert.equal(field().properties.value, rawB);
      assert.equal(record.delivered, false); assert.equal(finished, false);
      record.gate.resolve(); await submitting; await cOrdinaryNavSettle(f);
      assert.equal(record.delivered, true); assert.equal(finished, true);
      assert.ok(h.libraryEditorSaveReceipts.exact(record.request)); assert.equal(h.libraryEditorSaveReceipts.records().length, 1);
      assert.deepEqual(await h.history(), [...before.history, ...record.receipt.appended]);
      assert.deepEqual(h.store.events.get(), [...JSON.parse(before.events), ...record.receipt.appended]);
      assert.deepEqual(h.counts(), before.counts);
      assert.equal(JSON.stringify(h.store.session.get()), before.session);
      assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
      assert.equal(h.store.route.get(), before.route); assert.equal(h.location.pathname + h.location.search + h.location.hash, before.route);
      assert.ok(library.isConnected && editor.isConnected); assert.equal(editor.closest("forma-library"), library);
      assert.equal(f.components().filter(owner => owner.tag === "forma-library-block-editor" && owner.blockId === blockId && owner.isConnected).length, 1);
      assert.equal(h.store.projection.get().libraryBlocks.find(row => row.id === blockId).handle, rawA.trim());
      assert.deepEqual(h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET"
        && !h.navigationResumeReads.isReadOnlyResume(request)), [record.request], "Only this exact original Save is an authoring request");
      t.diagnostic("C_LIBRARY_SAVE_ACK_NEWER_RAW " + JSON.stringify({ originalEvent: record.receipt.appended[0].eventId,
        originalDelivered: record.delivered, originalFinished: finished, committedHandle: rawA.trim(),
        rawBeforeAck: rawB, rawAfterAck: field().port.value, originalRoute: before.route, actualRoute: h.store.route.get(),
        sameCurrentEditor: editor.isConnected, exactOriginalHistoryReceiptFiscal: true,
        evidence: "actual native input/Save plus same original Worker200; no physical selection or replacement ACK claim" }));
      assert.equal(field().port.value, rawB, "Original A acknowledgment cannot consume newer raw B");
      assert.equal(field().properties.value, rawB, "The current editor renders the complete newer raw draft");
      assert.equal(field().port.matches(":disabled"), false);
    } finally { record.gate.resolve(); await submitting; }
    if (record.error) throw record.error;
  });

// These are ordinary editor operations, not Kept-library removal or Use-copy.
// A cancelled native confirmation never fabricates cancellation of a dispatched
// original write. The exact one-event modes remain separate from rename Save.
function cLibraryEditorActionReceiptAccounting(t, h, admit) {
  const prior = h.transport, records = [], proofs = new WeakMap(); let armed = null;
  const original = request => prior ? prior(request) : h.worker.request(request.url, request.init);
  const clientReceipts = () => h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
  const execute = async (request, record) => {
    record.request = request; const init = request.init, bytes = init.body, input = JSON.parse(bytes);
    assert.ok(h.requests.includes(request)); assert.equal(h.store.route.get(), record.route);
    assert.equal(h.store.session.get().user.userId, record.actor); assert.equal(h.store.session.get().projectContext == null, true);
    assert.equal(h.store.projection.get().projectId, record.projectId);
    assert.ok(h.store.sourceOwnershipActive(record.source) && h.store.authorizationScopeActive(record.authorization));
    const history = await h.history(), counts = h.counts(), receipts = clientReceipts(), block = record.block;
    assert.equal(h.store.head.get(), history.at(-1).sequence);
    let event;
    if (record.kind === "fork") {
      const id = input.event?.payload?.block_id;
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
      assert.ok(!h.store.projection.get().libraryBlocks.some(value => value.id === id));
      event = { type: "BlockCreated", payload: { block_id: id, project_id: record.projectId, scope: "library",
        type: block.type, handle: block.handle + "-fork-" + String(history.at(-1).sequence + 1).padStart(3, "0"),
        position: "l" + String(history.at(-1).sequence + 1).padStart(6, "0"),
        properties: { ...block.properties, authority: "authored", forked_from_block_id: block.id,
          source_document_id: block.properties.source_document_id || block.documentId || null, created_from: "library-block-editor" } } };
    } else {
      assert.equal(record.kind, "remove");
      event = { type: "BlockRemoved", payload: { block_id: block.id, scope: "library", reason: "removed-from-library-block-editor" } };
    }
    assert.deepEqual(Object.keys(input).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
    assert.equal(input.action, "append"); assert.equal(input.clientId, "web:lit");
    assert.equal(input.expectedSequence, history.at(-1).sequence);
    assert.deepEqual(input.event, event); assert.deepEqual(input.events, [event]);
    const response = await original(request), receipt = await response.clone().json();
    assert.equal(response.status, 200); assert.equal(response.bodyUsed, false);
    assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]);
    assert.deepEqual(receipt.rejected, []); assert.equal(receipt.appended.length, 1);
    const committed = receipt.appended[0];
    assert.equal(committed.type, event.type); assert.deepEqual(committed.payload, event.payload);
    assert.equal(committed.sequence, input.expectedSequence + 1); assert.equal(receipt.head, committed.sequence);
    assert.equal(committed.streamId, h.worker.streamId); assert.equal(committed.actor, "user"); assert.equal(committed.clientId, "web:lit");
    assert.ok(committed.eventId && committed.correlationId); assert.equal(committed.compensatesEventId, null);
    assert.equal(committed.payload.client_event_id, undefined);
    await h.worker.drainBackground(); assert.deepEqual(await h.history(), [...history, committed]); assert.deepEqual(h.counts(), counts);
    const row = h.worker.sqlite.prepare("SELECT e.event_id,e.sequence,e.type,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id AND p.redacted_at IS NULL WHERE e.event_id=?").get(committed.eventId);
    assert.ok(row); assert.equal(row.sequence, committed.sequence); assert.equal(row.type, committed.type);
    assert.deepEqual(JSON.parse(row.private_json), committed.payload);
    assert.deepEqual(clientReceipts(), receipts, "Ordinary one-event append does not acquire an invented client recovery key");
    assert.equal(request.init, init); assert.equal(request.init.body, bytes); assert.equal(JSON.stringify(request.body), bytes);
    assert.ok(h.store.sourceOwnershipActive(record.source) && h.store.authorizationScopeActive(record.authorization));
    await admit([committed]); proofs.set(request, { init, bytes });
    record.receipt = receipt; record.response = response; record.sql = { eventId: row.event_id, sequence: row.sequence, type: row.type };
    record.entered.resolve(); await record.gate.promise;
    assert.equal(request.init, init); assert.equal(request.init.body, bytes); assert.equal(response.bodyUsed, false);
    record.delivered = true; return response;
  };
  const transport = request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") return original(request);
    assert.ok(armed && !armed.request, "Only the one explicitly armed actual Fork or Remove is admitted");
    const record = armed; armed = null; record.pending = execute(request, record);
    record.pending.catch(error => { record.error = error; record.entered.resolve(); }); return record.pending;
  };
  h.transport = transport;
  t.after(() => { for (const record of records) record.gate.resolve(); if (h.transport === transport) h.transport = prior; });
  return {
    arm(kind, block) {
      assert.ok(["fork", "remove"].includes(kind)); assert.equal(armed, null); assert.equal(records.length, 0);
      assert.equal(block.scope, "library"); assert.equal(block.type, "direction"); assert.equal(block.projectId, h.a);
      assert.equal(Boolean(block.locked || block.properties.source_evidence_hash || block.properties.organization_context_package_binding_id), false);
      assert.equal(h.store.projection.get().membership[block.id], undefined);
      assert.deepEqual(h.store.projection.get().libraryBlockRelations.filter(value => value.fromBlockId === block.id || value.toBlockId === block.id), []);
      const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
      assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      const record = { kind, block: structuredClone(block), source, authorization, projectId: h.a,
        actor: h.store.session.get().user.userId, route: h.store.route.get(), entered: sceneDeferred(), gate: sceneDeferred(),
        request: null, pending: null, receipt: null, response: null, sql: null, delivered: false, error: null };
      records.push(record); armed = record; return record;
    },
    async reached(record) { await record.entered.promise; if (record.error) throw record.error; assert.ok(record.receipt && record.sql); },
    exact(request) { const proof = proofs.get(request); return Boolean(proof && request.url === "/api/events"
      && request.init.method === "POST" && request.init === proof.init && request.init.body === proof.bytes && JSON.stringify(request.body) === proof.bytes); },
    records: () => [...records],
  };
}

async function cLibraryEditorActionPage(t) {
  const f = await navigationPage(t, "en", { nativePreparation: true, libraryEditorActionReceiptAccounting: true }), h = f.navigationHost;
  const blockId = "c-library-action-original", otherId = "c-library-action-other";
  for (const [id, handle] of [[blockId, "direction/action-original"], [otherId, "direction/other-current"]])
    await h.external("BlockCreated", { project_id: h.a, scope: "library", block_id: id, type: "direction",
      handle, position: "l-" + id, properties: { text: "Exact reusable direction " + id,
        subtype: "Campaign goal", intent: "include", weight: 0.65, authority: "authored" } });
  await h.store.refreshEvents({ fromStart: true }); await f.settle();
  const native = await cOrdinaryNavNative(t, f); h.exact();
  await cOrdinaryNavClick(f, f.task("/library"), native);
  const library = f.components().find(owner => owner.tag === "forma-library" && owner.store === h.store && owner.isConnected);
  assert.ok(library); assert.deepEqual(cLibraryDraftNativeDefaults(t, f, library)(), []);
  const controls = id => f.find("button", node => node.owner === library && node.attributes["data-context-controls-id"] === id);
  await cOrdinaryNavClick(f, controls(blockId), native);
  const editor = f.components().find(owner => owner.tag === "forma-library-block-editor" && owner.blockId === blockId && owner.store === h.store);
  assert.ok(editor?.isConnected);
  const block = structuredClone(h.store.projection.get().libraryBlocks.find(value => value.id === blockId));
  const field = owner => f.find("input", node => node.owner === owner && String(node.attributes.maxlength) === "96");
  assert.equal(field(editor).port.value, block.handle); assert.equal(field(editor).port.matches(":disabled"), false);
  const button = (owner, label) => f.find("button", node => node.owner === owner && node.text === f.i18n.system(label));
  return { f, h, native, library, editor, block, otherId, controls, field, button };
}

function cLibraryEditorActionHeld(x, record, finished) {
  const { f, h } = x;
  const heldOriginal = { request: record.request, current: () => h.libraryEditorActionReceipts.exact(record.request)
    && record.response.status === 200 && record.response.bodyUsed === false && !record.delivered && !finished()
    && h.store.session.get().user.userId === record.actor && h.store.projection.get().projectId === record.projectId
    && h.store.sourceOwnershipActive(record.source) && h.store.authorizationScopeActive(record.authorization) };
  return async () => {
    assert.equal(heldOriginal.current(), true); await cOrdinaryNavSettle(f, { heldOriginal });
    assert.equal(h.navigationResumeReads.pendingOriginalCount(), 1);
    assert.equal(h.navigationResumeReads.pendingOriginalCount({ heldOriginal }), 0);
    assert.equal(h.navigationResumeReads.pendingOriginalCount({ heldOriginal: { ...heldOriginal, request: { ...record.request } } }), 1);
    assert.equal(h.navigationResumeReads.isReadOnlyResume(record.request), false);
    assert.equal(record.delivered, false); assert.equal(finished(), false);
  };
}

async function cLibraryEditorActionProof(x, record, before) {
  const { f, h } = x;
  assert.equal(record.response.status, 200); assert.equal(record.delivered, true);
  assert.ok(h.libraryEditorActionReceipts.exact(record.request));
  assert.equal(h.libraryEditorActionReceipts.exact({ ...record.request }), false);
  assert.equal(h.libraryEditorActionReceipts.records().length, 1);
  assert.deepEqual(await h.history(), [...before.history, ...record.receipt.appended]);
  assert.deepEqual(h.store.events.get(), [...JSON.parse(before.events), ...record.receipt.appended]);
  assert.deepEqual(h.counts(), before.counts);
  assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), before.receipts);
  assert.equal(JSON.stringify(h.store.session.get()), before.session);
  assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
  assert.deepEqual(h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET"
    && !h.navigationResumeReads.isReadOnlyResume(request)), [record.request], "Only the exact original operation may write");
  assert.equal(h.location.pathname + h.location.search + h.location.hash, h.store.route.get()); h.exact();
  assert.ok(f.components().includes(x.library) && x.library.isConnected);
}

for (const newer of [false, true]) test(
  "C Library Fork original completion / " + (newer ? "preserves newer raw source draft" : "healthy exact independent target"),
  fIntelligenceOptions, async t => {
    const x = await cLibraryEditorActionPage(t), { f, h, library, editor, block, field, button } = x;
    await cOrdinaryNavSettle(f); const before = await cOrdinaryNavBefore(f);
    const record = h.libraryEditorActionReceipts.arm("fork", block), fork = button(editor, "Fork");
    assert.equal(fork.port.matches(":disabled"), false); assert.equal(fork.hiddenBy, null);
    f.native.emit("pointerdown", fork.port); f.native.focus(fork.port);
    let finished = false; const pending = f.act(fork, "click", { button: 0 }).then(() => { finished = true; });
    void pending.catch(() => {});
    try {
      await h.libraryEditorActionReceipts.reached(record);
      const settleHeld = cLibraryEditorActionHeld(x, record, () => finished); await settleHeld();
      assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === block.id), block);
      assert.equal(h.store.events.get().some(event => event.eventId === record.receipt.appended[0].eventId), false);
      const raw = "  direction/newer-after-Fork — 未保存  ";
      if (newer) {
        const current = field(editor); assert.equal(current.port.matches(":disabled"), false);
        f.native.emit("pointerdown", current.port); f.native.focus(current.port);
        current.port.value = raw; await f.act(current, "input"); await settleHeld();
        assert.equal(field(editor).port.value, raw); assert.equal(field(editor).properties.value, raw);
      }
      record.gate.resolve(); await pending; await cOrdinaryNavSettle(f);
      assert.equal(finished, true); await cLibraryEditorActionProof(x, record, before);
      const forked = record.receipt.appended[0].payload;
      const actual = h.store.projection.get().libraryBlocks.find(value => value.id === forked.block_id);
      assert.ok(actual); assert.equal(actual.handle, forked.handle); assert.deepEqual(actual.properties, forked.properties);
      assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === block.id), block);
      t.diagnostic("C_LIBRARY_FORK_ACK_CUSTODY " + JSON.stringify({ newer, originalBlockId: block.id,
        committedForkId: forked.block_id, exactOriginalEvent: record.sql.eventId, originalDelivered: record.delivered,
        originalFinished: finished, beforeRoute: before.route, currentRoute: h.store.route.get(),
        originalEditorConnected: editor.isConnected, visibleHandles: f.tree().visible("input").filter(node => String(node.attributes.maxlength) === "96").map(node => node.port.value),
        sourceReceiptFiscalExact: true, evidence: "actual native Fork/input and original Worker200; not physical focus or a replacement receipt" }));
      if (newer) {
        assert.equal(h.store.route.get(), before.route, "An earlier Fork acknowledgment cannot displace the newer source draft");
        assert.ok(editor.isConnected && editor.closest("forma-library") === library);
        assert.equal(field(editor).port.value, raw); assert.equal(field(editor).properties.value, raw);
      } else {
        assert.equal(h.store.route.get(), libraryBlockEditorRoute(forked.block_id, before.route));
        const current = f.components().filter(owner => owner.tag === "forma-library-block-editor"
          && owner.blockId === forked.block_id && owner.store === h.store && owner.isConnected);
        assert.equal(current.length, 1); assert.equal(field(current[0]).port.value, forked.handle);
      }
    } finally { record.gate.resolve(); await pending; }
    if (record.error) throw record.error;
  });

for (const changedCurrent of [false, true]) test(
  "C Library Remove original completion / " + (changedCurrent ? "Cancel keeps the dispatched removal separate from another current draft" : "healthy exact original removal"),
  fIntelligenceOptions, async t => {
    const x = await cLibraryEditorActionPage(t), { f, h, native, library, editor, block, otherId, controls, field, button } = x;
    await cOrdinaryNavClick(f, button(editor, "Remove"), native);
    const dialog = () => {
      const rows = f.tree().visible("dialog").filter(node => node.owner === editor && fObjectClassed(node, "library-block-remove-dialog"));
      assert.equal(rows.length, 1); assert.equal(rows[0].port.open, true); return rows[0];
    };
    await cOrdinaryNavSettle(f); const before = await cOrdinaryNavBefore(f), record = h.libraryEditorActionReceipts.arm("remove", block);
    dialog(); const confirm = button(editor, "Remove block");
    assert.equal(confirm.port.matches(":disabled"), false); assert.equal(confirm.hiddenBy, null);
    f.native.emit("pointerdown", confirm.port); f.native.focus(confirm.port);
    let finished = false; const pending = f.act(confirm, "click", { button: 0 }).then(() => { finished = true; });
    void pending.catch(() => {}); let other = null, currentRoute = before.route;
    const raw = "  direction/newer-other-after-Cancel — 未保存  ";
    try {
      await h.libraryEditorActionReceipts.reached(record);
      const settleHeld = cLibraryEditorActionHeld(x, record, () => finished); await settleHeld();
      assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === block.id), block);
      assert.equal(h.store.events.get().some(event => event.eventId === record.receipt.appended[0].eventId), false);
      dialog();
      if (changedCurrent) {
        const tree = f.tree(), layer = tree.visible("dialog").find(node => node.owner === editor && fObjectClassed(node, "library-block-remove-dialog"));
        assert.ok(layer);
        const cancel = tree.visible("button").filter(node => node.owner === editor && c19NamingWithin(node, layer) && node.text === f.i18n.system("Cancel"));
        assert.equal(cancel.length, 1); await cOrdinaryNavClick(f, cancel[0], native, settleHeld);
        assert.equal(f.tree().visible("dialog").filter(node => node.owner === editor && fObjectClassed(node, "library-block-remove-dialog")).length, 0);
        assert.equal(record.delivered, false); assert.equal(finished, false);
        await cOrdinaryNavClick(f, cLibraryInspectionBack(f, editor), native, settleHeld);
        assert.equal(editor.isConnected, false); assert.ok(library.isConnected);
        await cOrdinaryNavClick(f, controls(otherId), native, settleHeld);
        other = f.components().find(owner => owner.tag === "forma-library-block-editor" && owner.blockId === otherId && owner.store === h.store && owner.isConnected);
        assert.ok(other); assert.notEqual(other, editor); currentRoute = h.store.route.get();
        assert.equal(currentRoute, libraryBlockEditorRoute(otherId, before.route));
        const current = field(other); assert.equal(current.port.matches(":disabled"), false);
        f.native.emit("pointerdown", current.port); f.native.focus(current.port);
        current.port.value = raw; await f.act(current, "input"); await settleHeld();
        assert.equal(field(other).port.value, raw); assert.equal(field(other).properties.value, raw);
      }
      record.gate.resolve(); await pending; await cOrdinaryNavSettle(f);
      assert.equal(finished, true); await cLibraryEditorActionProof(x, record, before);
      assert.equal(h.store.projection.get().libraryBlocks.some(value => value.id === block.id), false,
        "Cancel closed native presentation; it did not cancel the original committed removal");
      t.diagnostic("C_LIBRARY_REMOVE_ACK_CUSTODY " + JSON.stringify({ changedCurrent, removedOriginalId: block.id,
        exactOriginalEvent: record.sql.eventId, originalDelivered: record.delivered, originalFinished: finished,
        originRoute: before.route, latestRoute: currentRoute, actualRoute: h.store.route.get(),
        originalEditorConnected: editor.isConnected, currentOtherEditorConnected: other?.isConnected ?? null,
        sourceReceiptFiscalExact: true, evidence: "actual native confirmation/Cancel/Back/current input plus original Worker200; no cancellation or physical-focus claim" }));
      if (changedCurrent) {
        assert.equal(h.store.route.get(), currentRoute, "A detached original removal must not replace another current editor");
        assert.ok(other.isConnected && other.closest("forma-library") === library);
        assert.equal(field(other).port.value, raw); assert.equal(field(other).properties.value, raw);
      } else {
        assert.equal(h.store.route.get(), libraryBlockEditorRoute("", before.route));
        const current = f.components().filter(owner => owner.tag === "forma-library-block-editor"
          && owner.blockId === null && owner.store === h.store && owner.isConnected);
        assert.equal(current.length, 1); assert.equal(field(current[0]).port.value, "");
      }
    } finally { record.gate.resolve(); await pending; }
    if (record.error) throw record.error;
  });


// Two additional Remove continuations. The original healthy/Cancel-other pair
// above remains unchanged. The held boundary is the actual editor update result
// after the original removal ACK, not an invented field, receipt or focus lease.
for (const initiallyDirty of [true, false]) test(
  "C Library Remove completion boundary / " + (initiallyDirty
    ? "initially dirty confirmed draft reaches blank"
    : "newer native Back focus during acknowledged render retires blank navigation"),
  fIntelligenceOptions, async t => {
    const releaseRender = sceneDeferred(); let restoreTick = () => {};
    t.after(() => { releaseRender.resolve(); restoreTick(); });
    const x = await cLibraryEditorActionPage(t), { f, h, native, library, editor, block, field, button } = x;
    await cOrdinaryNavSettle(f); const before = await cOrdinaryNavBefore(f);
    const raw = "  direction/intentionally-removed-unsaved — 未保存  ";
    if (initiallyDirty) {
      const current = field(editor);
      assert.ok(current.port.isConnected && f.renderer.nodes.includes(current.port));
      assert.equal(current.port.matches(":disabled"), false);
      f.native.emit("pointerdown", current.port); f.native.focus(current.port);
      current.port.value = raw; await f.act(current, "input"); await cOrdinaryNavSettle(f);
      assert.equal(field(editor).port.value, raw); assert.equal(field(editor).properties.value, raw);
      assert.equal(editor.navigationBlocked, true, "The original confirmed draft is genuinely dirty, not reset to its saved value");
      assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === block.id), block);
      await cOrdinaryNavNoWrite(f, before);
    }
    await cOrdinaryNavClick(f, button(editor, "Remove"), native);
    const dialogs = () => f.tree().visible("dialog").filter(node => node.owner === editor
      && fObjectClassed(node, "library-block-remove-dialog"));
    assert.equal(dialogs().length, 1); assert.equal(dialogs()[0].port.open, true);
    if (initiallyDirty) { assert.equal(field(editor).port.value, raw); assert.equal(field(editor).properties.value, raw); }
    const record = h.libraryEditorActionReceipts.arm("remove", block), confirm = button(editor, "Remove block");
    assert.ok(confirm.port.isConnected && f.renderer.nodes.includes(confirm.port));
    assert.equal(confirm.port.matches(":disabled"), false); assert.equal(confirm.hiddenBy, null);
    f.native.emit("pointerdown", confirm.port); f.native.focus(confirm.port);
    let finished = false, operationError = null;
    const pending = f.act(confirm, "click", { button: 0 }).then(() => { finished = true; }, error => { operationError = error; throw error; });
    void pending.catch(() => {}); // The exact actual-handler Promise is joined in finally.
    let held = false, returned = false, heldBack = null, originalTickResult, returnedTickResult, focusAfterNewer = null;
    let scrollAfterNewer = null, windowScrollAfterNewer = null;
    try {
      await untilScene(() => Boolean(record.receipt || record.error || operationError) || finished,
        "The actual confirmed Remove reaches its original Worker receipt instead of silently returning");
      if (operationError) throw operationError;
      assert.ok(record.receipt || record.error, "A completed handler without an original Remove receipt is not this boundary");
      await h.libraryEditorActionReceipts.reached(record);
      const settleHeldOriginal = cLibraryEditorActionHeld(x, record, () => finished); await settleHeldOriginal();
      assert.deepEqual(h.store.projection.get().libraryBlocks.find(value => value.id === block.id), block);
      assert.equal(h.store.events.get().some(event => event.eventId === record.receipt.appended[0].eventId), false);
      assert.equal(dialogs().length, 1); assert.equal(dialogs()[0].port.open, true);
      if (initiallyDirty) { assert.equal(field(editor).port.value, raw); assert.equal(field(editor).properties.value, raw); }
      if (!initiallyDirty) {
        const tick = f.tick;
        const delayedTick = async owner => {
          const result = await tick(owner);
          if (!held && owner === editor && record.delivered
            && h.store.events.get().some(event => event.eventId === record.receipt.appended[0].eventId)
            && !h.store.projection.get().libraryBlocks.some(value => value.id === block.id)
            && !editor.querySelector(".library-block-remove-dialog")) {
            assert.equal(record.response.status, 200); assert.equal(record.response.bodyUsed, true);
            assert.equal(finished, false); assert.equal(h.store.route.get(), before.route);
            assert.ok(editor.isConnected && editor.store === h.store && editor.closest("forma-library") === library);
            assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
            const tree = f.tree();
            assert.equal(tree.visible("dialog").filter(node => node.owner === editor).length, 0);
            assert.equal(tree.visible("form").filter(node => node.owner === editor).length, 0);
            assert.equal(tree.visible("input").filter(node => node.owner === editor && String(node.attributes.maxlength) === "96").length, 0,
              "The removed-block fallback offers Back, not a fabricated editable Handle field");
            heldBack = cLibraryInspectionBack(f, editor);
            assert.ok(heldBack.port.isConnected && f.renderer.nodes.includes(heldBack.port));
            assert.equal(heldBack.port.owner === editor, true); assert.equal(heldBack.port.closest("forma-library-block-editor") === editor, true);
            assert.equal(heldBack.hiddenBy, null); assert.equal(heldBack.port.matches(":disabled"), false);
            originalTickResult = result; held = true;
            await releaseRender.promise;
            returnedTickResult = result; returned = true;
          }
          return result;
        };
        f.tick = delayedTick;
        restoreTick = () => { if (f.tick === delayedTick) f.tick = tick; };
      }
      record.gate.resolve();
      if (!initiallyDirty) {
        await untilScene(() => held || finished || Boolean(operationError),
          "The actual acknowledged Remove reaches its original Editor updateComplete before blank navigation");
        if (operationError) throw operationError;
        assert.equal(held, true); assert.equal(returned, false); assert.equal(finished, false);
        assert.equal((await record.pending) === record.response, true, "The same original Worker Response was delivered, not replaced by the render gate");
        await cLibraryEditorActionProof(x, record, before);
        assert.equal(h.store.route.get(), before.route);
        assert.equal(h.store.projection.get().libraryBlocks.some(value => value.id === block.id), false);
        assert.equal(dialogs().length, 0);
        const back = cLibraryInspectionBack(f, editor);
        assert.equal(back.port === heldBack.port, true, "Use the exact current Back from the held original rendered fallback");
        assert.ok(back.port.isConnected && f.renderer.nodes.includes(back.port));
        assert.equal(back.port.owner === editor, true); assert.equal(back.port.closest("forma-library-block-editor") === editor, true);
        assert.equal(back.port.matches(":disabled"), false); assert.equal(back.hiddenBy, null);
        const focusBefore = f.native.nativeFocus.length;
        f.native.emit("pointerdown", back.port); f.native.focus(back.port);
        assert.equal(f.native.nativeFocus.length, focusBefore + 1);
        assert.equal(f.native.nativeFocus[focusBefore].node === back.port, true);
        assert.equal(f.native.document.activeElement === back.port, true);
        assert.ok(back.port.isConnected && f.renderer.nodes.includes(back.port));
        assert.equal(h.store.route.get(), before.route, "Pointer/focus is a newer interaction, not an activated Back or fabricated route");
        assert.equal(returned, false); assert.equal(finished, false);
        focusAfterNewer = f.native.nativeFocus.length; scrollAfterNewer = f.native.nativeScroll.length;
        windowScrollAfterNewer = native.scrolls.length;
        releaseRender.resolve();
      }
      await pending; await cOrdinaryNavSettle(f);
      assert.equal(finished, true); await cLibraryEditorActionProof(x, record, before);
      assert.equal(h.store.projection.get().libraryBlocks.some(value => value.id === block.id), false);
      assert.equal(dialogs().length, 0);
      if (initiallyDirty) {
        assert.equal(h.store.route.get(), libraryBlockEditorRoute("", before.route),
          "Confirmed Remove may consume its own already-dirty draft after the original removal succeeds");
        const current = f.components().filter(owner => owner.tag === "forma-library-block-editor"
          && owner.blockId === null && owner.store === h.store && owner.isConnected);
        assert.equal(current.length, 1); assert.equal(current[0] === editor, false);
        assert.equal(field(current[0]).port.value, ""); assert.equal(field(current[0]).properties.value, "");
        assert.equal(held, false);
      } else {
        assert.equal(returned, true); assert.equal(returnedTickResult, originalTickResult);
        assert.equal(h.store.route.get(), before.route, "A newer current fallback interaction retires the late blank-editor continuation");
        assert.ok(editor.isConnected && editor.store === h.store && editor.closest("forma-library") === library);
        assert.equal(f.tree().visible("input").filter(node => node.owner === editor && String(node.attributes.maxlength) === "96").length, 0);
        const currentBack = cLibraryInspectionBack(f, editor);
        assert.ok(currentBack.port.isConnected && f.renderer.nodes.includes(currentBack.port));
        assert.equal(f.native.nativeFocus.length, focusAfterNewer, "Original Remove performs no late focus write after the newer Back focus");
        assert.equal(f.native.nativeScroll.length, scrollAfterNewer); assert.equal(native.scrolls.length, windowScrollAfterNewer);
      }
      t.diagnostic("C_LIBRARY_REMOVE_ADDITIONAL_BOUNDARY " + JSON.stringify({ initiallyDirty,
        originalEvent: record.sql.eventId, originalDelivered: record.delivered, originalFinished: finished,
        originalRenderHeld: held, originalRenderReturned: returned, actualRoute: h.store.route.get(),
        originalEditorConnected: editor.isConnected, newerCurrentBackFocusDelivered: !initiallyDirty,
        sourceReceiptFiscalExact: true, evidence: "actual original Remove and native controls; held original render result, not physical DOM lifetime or replacement ACK" }));
    } finally {
      record.gate.resolve(); releaseRender.resolve();
      try { await pending; } finally { restoreTick(); }
    }
    if (record.error) throw record.error;
  });

// C local handoff custody, additive to all prior navigation/receipt cases.
// These are actual current Shell/component controls with the existing RAM
// Worker and finite native ports, not browser or provider evidence.
async function cLocalCustodyClick(f, node) {
  assert.ok(node.port?.isConnected && f.renderer.nodes.includes(node.port));
  assert.equal(node.hiddenBy, null); assert.equal(node.port.matches(":disabled"), false);
  assert.equal(typeof node.handlers.click, "function");
  f.native.emit("pointerdown", node.port); f.native.focus(node.port);
  await finishCommandPreparation(f, f.act(node, "click", { button: 0, defaultPrevented: false }));
  await cOrdinaryNavSettle(f);
}

for (const dirty of [false, true]) test(
  "C Sessions local Resume / " + (dirty ? "retains pre-existing raw intent until explicit resolution" : "healthy exact original acceptance"),
  fIntelligenceOptions, async t => {
    const x = await fSessionPage(t, dirty ? "ja" : "en"), { f, h, owner } = x;
    const choice = await fSessionPrepare(x, "thread"), destination = choice.item.destination;
    assert.equal(destination.view, "context-block"); assert.equal(destination.ref_id, "scene-reuse-direction");
    const raw = "  Unsent intent before Resume — 未保存\n  ";
    if (dirty) await fSessionDraftType(x, "intent", raw);
    const field = cSessionCommandIntentControls(x, dirty ? raw : "");
    await cOrdinaryNavSettle(f); const before = await cOrdinaryNavBefore(f);
    const resume = () => f.find("button", node => node.owner === owner
      && node.attributes["data-target-ref"] === destination.ref_id && node.attributes["data-destination-view"] === destination.view);
    const original = h.briefReceipts.arm("accept", choice.event);
    // The existing exact observer is armed before the old-runtime gesture so
    // a real erroneous acceptance is accounted, not replaced by an unexpected
    // request assertion. If refused, the same arm awaits the later fresh click.
    await cLocalCustodyClick(f, resume()); await fSessionFinishOriginalTimers(f);
    await fSessionNoExtraEffects(x);
    t.diagnostic("C_SESSIONS_LOCAL_RESUME " + JSON.stringify({ dirty, originalRoute: before.route,
      route: h.store.route.get(), ownerConnected: owner.isConnected,
      originalAcceptanceRequests: Number(Boolean(original.request)), originalAcceptanceDelivered: original.delivered,
      currentRaw: f.tree().visible("textarea").find(node => node.owner === owner
        && node.attributes.id === "session-intent-statement")?.port.value ?? null,
      exactWorkerAccounting: true, fiscalUnchanged: true }));
    if (dirty) {
      assert.equal(h.store.route.get(), before.route, "A current Resume is not permission to discard unrelated unsent intent");
      assert.ok(owner.isConnected); cSessionCommandIntentControls(x, raw, field.part);
      assert.equal(original.request, null, "The dirty refusal does not record an acceptance for a destination it cannot open");
      assert.equal(h.requests.length, before.requests); await cOrdinaryNavNoWrite(f, before);
      assert.equal(h.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
      await fSessionDraftType(x, "intent", ""); cSessionCommandIntentControls(x, "", field.part);
      assert.equal(h.store.route.get(), before.route, "Clearing the actual field is local; it does not resume automatically");
      assert.equal(original.request, null); await cOrdinaryNavNoWrite(f, before);
      await cLocalCustodyClick(f, resume()); await fSessionFinishOriginalTimers(f);
    }
    const receipt = await h.briefReceipts.reached(original); await fSessionNoExtraEffects(x);
    assert.equal(receipt.status, 200); assert.equal(original.delivered, true);
    assert.equal(receipt.appended.length, 1); assert.deepEqual(receipt.appended[0].payload, choice.event.payload);
    assert.equal(h.requests.filter(request => h.briefReceipts.isOriginal(request)
      && request.body?.event?.type === "BriefItemAccepted").length, 1);
    assert.equal(documentIdFromRoute(h.store.route.get()), destination.document_id);
    assert.equal(h.store.projection.get().documentId, destination.document_id);
    assert.equal(h.store.ui.focusBlockId, destination.ref_id);
    assert.ok(f.find("article", node => node.attributes["data-block-id"] === destination.ref_id).port.isConnected);
    assert.equal(owner.isConnected, false); assert.ok(h.store.sourceOwnershipActive(before.source));
  });

for (const dirty of [false, true]) test(
  "C Sessions local blank handoff / " + (dirty ? "confirmed A retains pre-existing intent before fresh exact departure" : "healthy original A opens once"),
  fIntelligenceOptions, async t => {
    const x = await fSessionContinuationPage(t, dirty ? "fr" : "en"), { f, h, owner } = x;
    const title = "Original local blank A", raw = "  Intent B already existed before Create\n  ";
    await fSessionDraftType(x, "blank", "  " + title + "  ");
    if (dirty) await fSessionDraftType(x, "intent", raw);
    const intent = cSessionCommandIntentControls(x, dirty ? raw : "");
    await cOrdinaryNavSettle(f); const before = await cOrdinaryNavBefore(f), original = h.sessionDraftReceipts.arm("blank", title);
    const tree = f.tree(), form = fDecisionOne(f, tree, "form", node => node.owner === owner
      && fSessionDraftClass(node, "blank-document-form"), "The actual current blank creation form");
    const submit = fDecisionOne(f, tree, "button", node => node.owner === owner
      && c19NamingWithin(node, form) && node.attributes.type === "submit", "The actual current blank submit control");
    assert.equal(submit.port.matches(":disabled"), false); assert.equal(form.port, fSessionDraftForm(x, "blank").port);
    f.native.emit("pointerdown", submit.port); f.native.focus(submit.port);
    const pending = f.act(form, "submit", { submitter: submit.port });
    try {
      const receipt = await h.sessionDraftReceipts.reached(original); await f.settle();
      assert.equal(receipt.status, 200); assert.equal(original.delivered, false);
      assert.equal(original.originalResponse.bodyUsed, false);
      assert.equal(h.store.route.get(), before.route);
      assert.equal(h.store.events.get().some(event => event.eventId === receipt.appended[1].eventId), false,
        "Held real commitment is not yet the caller's published acknowledgment");
      cSessionCommandIntentControls(x, dirty ? raw : "", intent.part);
      original.gate.resolve(); await pending; await fSessionFinishOriginalTimers(f); await fSessionDraftEffects(x, original);
      const document = h.store.projection.get().documents.filter(value => value.id === original.documentId && value.projectId === h.a && !value.removed);
      assert.equal(document.length, 1); assert.equal(document[0].title, title);
      assert.equal(h.store.events.get().some(event => event.eventId === receipt.appended[1].eventId), true);
      assert.equal(h.requests.filter(request => h.sessionDraftReceipts.isOriginal(request)).length, 1);
      t.diagnostic("C_SESSIONS_LOCAL_BLANK " + JSON.stringify({ dirty, originalRoute: before.route, route: h.store.route.get(),
        originalDocumentId: original.documentId, originalEventIds: receipt.appended.map(event => event.eventId),
        originalWorkerStatus: receipt.status, originalDelivered: original.delivered, ownerConnected: owner.isConnected,
        currentRaw: f.tree().visible("textarea").find(node => node.owner === owner
          && node.attributes.id === "session-intent-statement")?.port.value ?? null,
        exactOriginalCreatedOnce: true, fiscalUnchanged: true }));
      if (dirty) {
        assert.equal(h.store.route.get(), before.route, "Acknowledging the named blank does not authorize abandoning pre-existing intent B");
        assert.ok(owner.isConnected); cSessionCommandIntentControls(x, raw, intent.part);
        assert.equal(f.tree().visible("input").filter(node => node.owner === owner && node.attributes.id === "blank-document-name").length, 0,
          "Only the acknowledged unchanged original A name is consumed");
        assert.equal(h.store.ui.toast, f.i18n.system("{title} created as a blank document.", { title }));
        const afterAck = await cOrdinaryNavBefore(f);
        await fSessionDraftType(x, "intent", ""); cSessionCommandIntentControls(x, "", intent.part);
        assert.equal(h.store.route.get(), before.route); await cOrdinaryNavNoWrite(f, afterAck);
        const links = f.tree().visible("a").filter(node => node.owner.tag === "forma-ui-audience-navigation"
          && documentIdFromRoute(node.attributes.href) === original.documentId);
        assert.equal(links.length, 1, "The existing Work link names the exact acknowledged original A, not a fallback Document");
        const href = links[0].attributes.href;
        await cLocalCustodyClick(f, links[0]); await fSessionFinishOriginalTimers(f);
        assert.equal(h.store.route.get(), href); await cOrdinaryNavNoWrite(f, afterAck);
      }
      assert.equal(documentIdFromRoute(h.store.route.get()), original.documentId);
      assert.equal(h.store.projection.get().documentId, original.documentId); assert.equal(owner.isConnected, false);
      await fSessionDraftEffects(x, original);
    } finally { original.gate.resolve(); await pending; }
  });

for (const dirty of [false, true]) test(
  "C Library local editor entry / " + (dirty ? "retains publisher raw work until its current native Discard" : "healthy new and exact preview Controls"),
  fIntelligenceOptions, async t => {
    const x = await cLibraryPublisherPage(t, dirty ? "ja" : "en", { nativePreparation: true }), { f, h, owner, native, selected } = x;
    await registerCalmFullPageComponents(f, ["forma-library-block-editor"]);
    f.nativeHistoryLocation = h.location;
    cLibraryPackageNativeOccurrences(t, f, owner, { resetButtons: true });
    const currentInputs = cLibraryDraftNativeDefaults(t, f, owner); await cOrdinaryNavSettle(f);
    const form = native.current().port, defaults = native.raw(), rawName = "  Unsent publisher B before local editor — 未保存  ";
    if (dirty) native.fill(rawName, []);
    const raw = native.raw(), inputs = currentInputs(); assert.equal(inputs.length, 2);
    assert.deepEqual(raw, dirty ? [["packageName", rawName]] : defaults);
    assert.equal(inputs.filter(input => input.getAttribute("type") === "checkbox"
      ? input.checked !== input.defaultChecked : input.value !== input.defaultValue).length, dirty ? 2 : 0);
    const before = await cOrdinaryNavBefore(f), view = h.store.ui.libraryView, resets = native.resets.length;
    const create = () => f.find("button", node => node.owner === owner && node.attributes["data-context-controls-id"] === "__new__");
    assert.equal(create().text.includes(f.i18n.t("projects.newReusableBlock", "New reusable block")), true);
    await cLocalCustodyClick(f, create()); await cOrdinaryNavNoWrite(f, before);
    t.diagnostic("C_LIBRARY_LOCAL_EDITOR " + JSON.stringify({ dirty, originalRoute: before.route,
      route: h.store.route.get(), ownerConnected: owner.isConnected, originalPublisherFormConnected: form.isConnected,
      rawAtGesture: raw, originalSourceAndAuthorityCurrent: true, commands: 0, historyReceiptFiscalUnchanged: true }));
    if (dirty) {
      assert.equal(h.store.route.get(), before.route, "Local New reusable block cannot replace a current unsent publisher form");
      assert.ok(owner.isConnected && form.isConnected); assert.equal(native.current().port, form);
      assert.deepEqual(native.raw(), raw); assert.equal(native.resets.length, resets);
      assert.equal(h.store.ui.libraryView, view, "Refusal precedes local filter mutation");
      assert.equal(h.requests.length, before.requests); assert.equal(h.store.ui.toast, f.i18n.t("next.library.publisherDraft"));
      const tree = f.tree(), currentForm = fDecisionOne(f, tree, "form", node => node.owner === owner && node.port === form,
        "The original still-current publishing form");
      const discard = fDecisionOne(f, tree, "button", node => node.owner === owner && c19NamingWithin(node, currentForm)
        && node.attributes.type === "reset" && node.text === f.i18n.t("output.requirement.discard"), "Its existing visible native Discard");
      assert.equal(discard.port.closest("form"), form); assert.equal(discard.port.matches(":disabled"), false);
      assert.equal(discard.handlers.click, undefined); assert.equal(currentForm.handlers.reset, undefined);
      f.native.emit("pointerdown", discard.port); f.native.focus(discard.port);
      // Same explicit native-default seam as the existing publisher lifecycle
      // cases: no competing handler, no private value assignment or submission.
      form.reset(); await cOrdinaryNavSettle(f);
      assert.equal(native.resets.length, resets + 1); assert.equal(native.resets.at(-1).form, form);
      assert.deepEqual(native.resets.at(-1).before, raw); assert.deepEqual(native.raw(), defaults);
      assert.equal(h.store.route.get(), before.route); assert.equal(h.requests.length, before.requests);
      await cOrdinaryNavNoWrite(f, before); await cLocalCustodyClick(f, create());
    }
    assert.equal(h.store.route.get(), libraryBlockEditorRoute("", before.route));
    let editors = f.components().filter(value => value.tag === "forma-library-block-editor" && value.store === h.store && value.isConnected);
    assert.equal(editors.length, 1); assert.equal(editors[0].blockId, null);
    assert.equal(editors[0].closest("forma-library"), owner); assert.equal(form.isConnected, false);
    await cOrdinaryNavNoWrite(f, before);
    if (!dirty) {
      // The same method also serves a genuine read-only preview. Its own
      // current dialog must not become a blanket blocker for healthy Controls.
      await cLocalCustodyClick(f, cLibraryInspectionBack(f, editors[0]));
      assert.equal(h.store.route.get(), before.route); assert.deepEqual(native.raw(), defaults); currentInputs();
      const blockId = selected[0], block = h.store.projection.get().libraryBlocks.find(value => value.id === blockId);
      assert.ok(block && block.projectId === h.a && !block.removed);
      const links = f.tree().visible("a").filter(node => node.owner === owner && fObjectClassed(node, "asset-focus-trigger")
        && libraryFocusFromRoute(node.attributes.href)?.kind === "block" && libraryFocusFromRoute(node.attributes.href)?.id === blockId);
      assert.equal(links.length, 1); await cLocalCustodyClick(f, links[0]);
      const previewRoute = h.store.route.get(), tree = f.tree();
      const dialog = fDecisionOne(f, tree, "dialog", node => node.owner === owner && fObjectClassed(node, "library-focus-dialog")
        && node.attributes["aria-labelledby"] === "block-focus-title", "The exact current block's read-only preview");
      assert.equal(dialog.port.open, true);
      const heading = fDecisionOne(f, tree, "h2", node => node.owner === owner && c19NamingWithin(node, dialog)
        && node.attributes.id === "block-focus-title", "The original preview's actual visible block name");
      const preview = fDecisionOne(f, tree, "forma-context-block", node => c19NamingWithin(node, dialog)
        && node.component?.block?.id === blockId, "The actual original block owns this read-only preview");
      assert.equal(preview.component.readOnly, true); assert.equal(preview.component.store, h.store);
      const controls = fDecisionOne(f, tree, "button", node => node.owner === owner && c19NamingWithin(node, dialog)
        && node.text === f.i18n.t("context.controls.named", "Controls for {name}", { name: "\u2068" + heading.text + "\u2069" }),
      "The actual current preview's Controls action");
      await cLocalCustodyClick(f, controls);
      assert.equal(h.store.route.get(), libraryBlockEditorRoute(blockId, previewRoute));
      editors = f.components().filter(value => value.tag === "forma-library-block-editor" && value.store === h.store && value.isConnected);
      assert.equal(editors.length, 1); assert.equal(editors[0].blockId, blockId); assert.equal(editors[0].closest("forma-library"), owner);
      assert.equal(f.tree().visible("dialog").some(node => node.owner === owner && node.port.open), false);
      await cOrdinaryNavNoWrite(f, before);
    }
    assert.deepEqual(h.libraryPublisherAudits.events(), [], "No package draft, version, publication or replacement is submitted");
  });

// One additive sibling-owner control. The existing Sessions fixture really
// commits the original two-event blank batch, then loses only its response.
// Measured Open/clear/Open actions begin after that setup and the full Check.
// No provider call, replacement write, private method or fabricated ACK is used.
test("C Sessions recovered original Open retains floating Assistant raw until deliberate clear / en",
  fIntelligenceOptions, async t => {
    const x = await cUnknownBlankPage(t, "en"), { f, h, owner, a } = x;
    f.nativeHistoryLocation = h.location;
    await registerCalmFullPageComponents(f, ["forma-creative-assistant"]);
    // Same actual two-window Store event bridge as cTargetHandoffPage. Native
    // route delivery invokes the original Shell handlers, not an invented route.
    const dispatch = h.window.dispatchEvent;
    const routedDispatch = function (event) {
      const result = dispatch.call(this, event);
      for (const listener of [...(f.listeners.get(event.type) ?? [])]) listener(event);
      return result;
    };
    h.window.dispatchEvent = routedDispatch;
    t.after(() => { if (h.window.dispatchEvent === routedDispatch) h.window.dispatchEvent = dispatch; });
    const reads = cTargetHandoffAssistantReads(t, f);
    const checkpoint = (phase, queues = null) => t.diagnostic("C_RECOVERED_OPEN_ASSISTANT_PHASE "
      + JSON.stringify({ phase, ...(queues ? { queues } : {}) }));
    const settled = { ...x, reads, checkpoint };
    // Restore the genuine Worker session after the disclosed calm sample, using
    // the existing mounted-Assistant no-provider configuration, not a UI flag.
    h.worker.env.OPENAI_API_KEY = "";
    await h.store.refreshSession(); await cTargetHandoffSettle(settled);
    const session = h.store.session.get();
    assert.equal(session.projectContext, undefined); assert.equal(session.assistant.enabled, true);
    assert.equal(session.policy.accepted, true); assert.equal(session.provider.configured, false);
    assert.ok(owner.isConnected && owner.store === h.store);
    assert.equal(h.store.route.get(), "/sessions");
    const acknowledgment = structuredClone(x.unconfirmed()), history = await h.history();
    const read = cBlankReadPort(t, x), checked = read.arm();
    await cBlankAct(x, cBlankButton(x, "blank-original-check")); await cTargetHandoffSettle(settled);
    assert.equal(checked.status, 200); assert.equal(checked.delivered, true);
    assert.ok(cBlankStatus(x, "sessions.blank.originalAvailable"));
    assert.deepEqual(x.unconfirmed(), acknowledgment, "Availability is not the original batch acknowledgment");
    assert.equal(a.receipt.status, 200); assert.equal(a.receipt.appended.length, 2);
    assert.equal(h.store.events.get().some(event => event.eventId === a.receipt.appended[1].eventId), true);
    const original = h.store.projection.get().documents.filter(document => document.id === a.documentId
      && document.projectId === h.a && !document.removed);
    assert.equal(original.length, 1);
    assert.equal(owner.captureCommandDeparture().blocked(), false,
      "Unchanged submitted blank A and empty Sessions intent do not confound sibling custody");
    const launcher = f.find("button", node => node.owner.tag === "forma-assistant-panel"
      && fObjectClassed(node, "forma-assistant-launcher"));
    const panel = launcher.owner, assistant = panel.parentElement;
    assert.equal(assistant.tag, "forma-creative-assistant"); assert.equal(assistant.store, h.store);
    f.native.emit("pointerdown", launcher.port); f.native.focus(launcher.port);
    await f.act(launcher, "click", { button: 0 }); await cTargetHandoffSettle(settled);
    assert.ok(panel.open && panel.isConnected && assistant.isConnected);
    const scope = panel.conversationScope;
    assert.equal(JSON.parse(scope)[9], "/sessions");
    assert.equal(panel.commandDepartureBlocked, false);
    const composers = f.components().filter(value => value.tag === "forma-ui-conversation-composer"
      && value.parentElement === panel && value.isConnected);
    assert.equal(composers.length, 1); const composer = composers[0];
    const field = (raw, part = null) => {
      const fields = f.tree().visible("textarea").filter(node => node.owner === composer
        && fObjectClassed(node, "forma-assistant-input"));
      assert.equal(fields.length, 1); const current = fields[0];
      assert.ok(current.port.isConnected && f.renderer.nodes.includes(current.port));
      assert.equal(current.port.matches(":disabled"), false);
      assert.equal(typeof current.handlers.input, "function"); assert.equal(typeof current.propertyParts.value, "string");
      assert.equal(current.port.value, raw); assert.equal(current.properties.value, raw);
      if (part !== null) assert.equal(current.propertyParts.value, part, "The same current composer owns raw B");
      return current;
    };
    const raw = "  Keep this unsent Assistant question while opening the original — 未送信\n  ";
    const input = field(""); f.native.emit("keydown", input.port); f.native.focus(input.port);
    input.port.value = raw; await f.act(input, "input"); await cTargetHandoffSettle(settled);
    const part = field(raw).propertyParts.value;
    assert.equal(panel.commandDepartureBlocked, true); assert.equal(owner.captureCommandDeparture().blocked(), false);
    assert.ok(reads.reads.length > 0);
    for (const row of reads.reads) {
      assert.equal(row.status, 200); const url = new URL(row.url, "https://fixture.invalid");
      assert.equal(url.searchParams.get("route"), "/sessions"); assert.equal(url.searchParams.get("projectId"), h.a);
    }
    await cBlankNoEffects(x, history); await cTargetHandoffSettle(settled);
    const before = { requests: h.requests.length, counts: h.counts(), events: JSON.stringify(h.store.events.get()),
      head: h.store.head.get(), source: h.store.captureSourceOwnership(), authorization: h.store.captureAuthorizationScope(),
      session: JSON.stringify(h.store.session.get()), focus: f.native.nativeFocus.length, scroll: f.native.nativeScroll.length };
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    // Fresh exact Open is enabled because Sessions itself is resolved. Its
    // actual click must still consult the already-authored floating sibling.
    await cBlankAct(x, cBlankButton(x, "blank-original-open")); await cTargetHandoffSettle(settled);
    await cBlankNoEffects(x, history);
    const after = f.tree(), currentRaw = after.visible("textarea").find(node => node.owner === composer
      && fObjectClassed(node, "forma-assistant-input"));
    t.diagnostic("C_RECOVERED_OPEN_ASSISTANT_CUSTODY " + JSON.stringify({ originalDocumentId: a.documentId,
      originalWorkerStatus: a.receipt.status, originalEventIds: a.receipt.appended.map(event => event.eventId),
      batchStillUnconfirmed: x.unconfirmed().outcome === "unconfirmed", fullCheckStatus: checked.status,
      route: h.store.route.get(), sessionsConnected: owner.isConnected, assistantConnected: assistant.isConnected,
      sameAssistantScope: panel.conversationScope === scope, rawRetained: currentRaw?.port.value === raw,
      measuredRequests: h.requests.slice(before.requests).map(request => ({ url: request.url, method: request.init.method ?? "GET" })),
      evidence: "actual full Shell/Sessions/Assistant and original RAM Worker; no replacement or physical-browser proof" }));
    assert.equal(h.store.route.get(), "/sessions", "Recovered Open cannot abandon pre-existing floating Assistant raw B");
    assert.ok(owner.isConnected && assistant.isConnected && panel.isConnected && panel.open);
    assert.equal(panel.conversationScope, scope); field(raw, part);
    assert.equal(panel.commandDepartureBlocked, true); assert.equal(owner.captureCommandDeparture().blocked(), false);
    assert.equal(h.store.ui.toast, f.i18n.t("next.lifecycle.assistantOwnsWork"));
    assert.equal(h.requests.length, before.requests, "Refused Open performs no additional request, including no POST");
    assert.equal(JSON.stringify(h.store.events.get()), before.events); assert.equal(h.store.head.get(), before.head);
    assert.equal(JSON.stringify(h.store.session.get()), before.session); assert.deepEqual(h.counts(), before.counts);
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    assert.deepEqual(x.unconfirmed(), acknowledgment);
    assert.equal(f.native.nativeFocus.slice(before.focus).some(call => call.node.owner?.tag === "forma-workspace"
      || call.node.attributes?.id === "main-content"), false);
    assert.equal(f.native.nativeScroll.length, before.scroll); reads.empty();
    // Clearing the actual unsent field is local resolution, not cancellation of
    // the original blank creation. A new deliberate Open must remain useful.
    const clear = field(raw, part); f.native.emit("keydown", clear.port); f.native.focus(clear.port);
    clear.port.value = ""; await f.act(clear, "input"); await cTargetHandoffSettle(settled);
    field("", part); assert.equal(panel.commandDepartureBlocked, false);
    assert.equal(owner.captureCommandDeparture().blocked(), false);
    await cBlankNoEffects(x, history); assert.equal(h.requests.length, before.requests);
    await cBlankAct(x, cBlankButton(x, "blank-original-open")); await cTargetHandoffSettle(settled);
    assert.equal(h.store.route.get(), withDocumentInRoute("/", a.documentId, original[0].title));
    assert.equal(h.store.projection.get().documentId, a.documentId); assert.equal(owner.isConnected, false);
    const workspaces = f.components().filter(value => value.tag === "forma-workspace" && value.store === h.store && value.isConnected);
    assert.equal(workspaces.length, 1);
    assert.deepEqual(x.unconfirmed(), acknowledgment); await cBlankNoEffects(x, history); reads.empty();
    assert.deepEqual(h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET"
      && !h.navigationResumeReads.isReadOnlyResume(request)), [],
    "Only the existing certified free Resume read can use POST; Open creates no replacement/event/provider work");
  });


// Eight actual Project Contents entry points, one locale and two deliberate
// states each. D Create/recovered Open and the copied-receipt Open are separate.
const cPC190Controls = [
  { id: "header-canvas", tag: "a", region: "page-header-actions", href: () => "/canvas", label: "Open in Canvas", arrival: "canvas" },
  { id: "header-new-block", tag: "a", region: "page-header-actions", href: () => libraryBlockEditorRoute(), label: "New reusable block", arrival: "new-block" },
  { id: "document-card", tag: "button", region: "document-card-actions", document: true, label: "Open", arrival: "document" },
  { id: "board-card", tag: "a", region: "project-board-grid", href: x => x.boardRoute, label: "Current Project Contents board", arrival: "board" },
  { id: "block-card", tag: "a", region: "project-block-grid", href: x => libraryBlockEditorRoute(x.blockId), label: "Edit block", arrival: "block" },
  { id: "summary-canvas", tag: "button", region: "project-overview-summary", summary: "canvas.board", label: "Board", href: () => "/canvas", arrival: "canvas" },
  { id: "summary-deliver", tag: "button", region: "project-overview-summary", summary: "workbench.creativeResults", label: "Creative results", href: () => "/deliver", arrival: "deliver" },
  { id: "summary-activity", tag: "button", region: "project-overview-summary", summary: "activity.needsYou", label: "Needs you", href: () => "/activity", arrival: "activity" },
];
function cPC190Ancestor(node, predicate) {
  for (let current = node; current; current = current.parent) if (predicate(current)) return current;
  return null;
}
function cPC190Control(x, entry) {
  const { f, owner } = x, tree = f.tree();
  assert.ok(owner.isConnected && owner.store === x.h.store && f.components().includes(owner));
  const candidates = tree.visible(entry.tag).filter(node => {
    if (node.owner !== owner || !cPC190Ancestor(node, value => fObjectClassed(value, entry.region))) return false;
    if (entry.tag === "a" && node.attributes.href !== entry.href(x)) return false;
    if (entry.summary) return node.children.some(child => typeof child !== "string" && child.tag === "span"
      && child.text === f.i18n.t(entry.summary, entry.label));
    if (entry.document) {
      const card = cPC190Ancestor(node, value => value.tag === "article" && fObjectClassed(value, "document-card"));
      return card && tree.visible("h3").some(heading => heading.parent === card && heading.text === x.targetDocument.title)
        && node.text.trim() === f.i18n.system("Open");
    }
    return true;
  });
  assert.equal(candidates.length, 1, "One actual current Project Contents " + entry.id);
  const control = candidates[0];
  assert.ok(control.port.isConnected && f.renderer.nodes.includes(control.port));
  assert.equal(control.port.owner, owner); assert.equal(control.hiddenBy, null);
  assert.equal(control.port.matches(":disabled"), false); assert.equal(typeof control.handlers.click, "function");
  if (entry.tag === "a") assert.equal(control.port.getAttribute("href"), entry.href(x));
  else assert.equal(String(control.attributes.type ?? "submit"), entry.document ? "submit" : "button");
  assert.ok(control.text.includes(f.i18n.system(entry.label)) || entry.summary,
    "The real visible control retains its existing label, not a substituted executor");
  if (entry.id === "block-card") assert.ok(cPC190Ancestor(control, value => value.tag === "article").text.includes(x.blockHandle));
  return control;
}
async function cPC190Click(x, node) {
  const { f } = x;
  assert.ok(node.port.isConnected && f.renderer.nodes.includes(node.port));
  assert.equal(node.hiddenBy, null); assert.equal(node.port.matches(":disabled"), false);
  f.native.emit("pointerdown", node.port); f.native.focus(node.port);
  const before = { focus: f.native.nativeFocus.length, scroll: f.native.nativeScroll.length };
  await f.act(node, "click", { button: 0, defaultPrevented: false });
  await cPC190Settle(x); return before;
}
async function cPC190Settle(x) {
  await x.observed?.settle(); await cTargetHandoffSettle(x); await x.observed?.settle();
  assert.equal(x.h.navigationResumeReads.pendingOriginalCount(), 0); x.reads.empty();
}
function cPC190Assistant(x) {
  const { f, h } = x;
  const assistants = f.components().filter(value => value.tag === "forma-creative-assistant" && value.store === h.store && value.isConnected);
  assert.equal(assistants.length, 1); const assistant = assistants[0];
  const panels = f.components().filter(value => value.tag === "forma-assistant-panel" && value.parentElement === assistant && value.isConnected);
  assert.equal(panels.length, 1); return { assistant, panel: panels[0] };
}
function cPC190Field(x, raw) {
  const { f, panel } = x;
  assert.ok(panel.isConnected && panel.open); assert.equal(panel.conversationScope, x.scope);
  const composers = f.components().filter(value => value.tag === "forma-ui-conversation-composer" && value.parentElement === panel && value.isConnected);
  assert.equal(composers.length, 1);
  const fields = f.tree().visible("textarea").filter(node => node.owner === composers[0] && fObjectClassed(node, "forma-assistant-input"));
  assert.equal(fields.length, 1); const field = fields[0];
  assert.ok(field.port.isConnected && f.renderer.nodes.includes(field.port));
  assert.equal(field.port.matches(":disabled"), false); assert.equal(typeof field.handlers.input, "function");
  assert.equal(typeof field.propertyParts.value, "string"); assert.equal(field.port.value, raw); assert.equal(field.properties.value, raw);
  return field;
}
async function cPC190Type(x, before, raw) {
  const field = cPC190Field(x, before), requests = x.h.requests.length;
  x.f.native.emit("keydown", field.port); x.f.native.focus(field.port); field.port.value = raw;
  await x.f.act(field, "input"); await cPC190Settle(x); cPC190Field(x, raw);
  assert.equal(x.h.requests.length, requests, "Native Assistant typing/clear does not submit or read");
}
async function cPC190Collapse(x, raw) {
  cPC190Field(x, raw);
  await cPC190Click(x, x.f.find("button", node => node.owner === x.panel && fObjectClassed(node, "forma-assistant-close")));
  assert.equal(x.panel.open, false); assert.equal(x.panel.conversationScope, x.scope);
  assert.equal(x.panel.commandDepartureBlocked, raw !== "");
  assert.equal(x.assistant.captureCommandDeparture().blocked(), raw !== "");
}
async function cPC190OpenAssistant(x, raw) {
  assert.ok(x.panel.isConnected && !x.panel.open); assert.equal(x.panel.conversationScope, x.scope);
  await cPC190Click(x, x.f.find("button", node => node.owner === x.panel && fObjectClassed(node, "forma-assistant-launcher")));
  cPC190Field(x, raw);
}
async function cPC190Page(t, entry, state) {
  const started = Date.now(), checkpoint = (phase, queues = null) => t.diagnostic("C_PC_OUTGOING_PHASE " + JSON.stringify({
    control: entry.id, state, phase, elapsedMs: Date.now() - started, ...(queues ? { queues } : {}) }));
  const x = await cTargetHandoffPage(t, "en", "document", checkpoint), { f, h } = x;
  // Retain the genuine initial Assistant scope; close it while pristine before
  // entering the measured page through its actual ProjectRail link.
  x.scope = x.panel.conversationScope;
  await cPC190Collapse(x, "");
  await registerCalmFullPageComponents(f, ["forma-project-contents", "forma-library", "forma-deliver", "forma-activity", "forma-canvas-application", "forma-canvas-surface"]);
  assert.strictEqual(f.renderer.registry["forma-canvas-application"], f.modules.get("src/apps/canvas/entry.ts").FormaCanvasApplication,
    "Synchronous native tree reads use the actual CEM-mapped Canvas entry");
  assert.strictEqual(f.renderer.registry["forma-canvas-surface"], f.modules.get("src/canvas/canvas-application.ts").CanvasApplication,
    "The entry delegates to the actual complete Canvas implementation");
  if (["canvas", "board"].includes(entry.arrival)) {
    // Reuse the single-tab capability and finite native geometry boundary from
    // outcome-desk-canvas-navigation.test.mjs; no application method or timer
    // is replaced. The unchanged full-page teardown owns real disconnection.
    const previousChannel = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = undefined;
    t.after(() => { globalThis.BroadcastChannel = previousChannel; });
    const resizeSeen = new WeakMap(), targets = f.resizeTargets;
    f.resizeTargets = new class extends Map {
      *[Symbol.iterator]() { for (const [observer, node] of super[Symbol.iterator]()) {
        if (node.owner?.tag === "forma-canvas-surface" && node.owner.store === h.store
          && String(node.attributes?.class ?? "").split(/\s+/u).includes("canvas-viewport")) {
          const key = node.owner, parent = resizeSeen.get(key) ?? new Map();
          const box = node.getBoundingClientRect(), stamp = box.width + ":" + box.height;
          if (parent.get("canvas-viewport") === stamp) continue;
          parent.set("canvas-viewport", stamp); resizeSeen.set(key, parent);
        }
        yield [observer, node];
      } }
    }(targets);
  }
  x.blockId = "c190-project-contents-reusable"; x.blockHandle = "direction/c190-project-contents";
  x.boardId = "c190-project-contents-board"; x.boardRoute = "/canvas/" + x.boardId + "/current-project-contents-board";
  // Explicit initial history only, through the existing Worker audit helper.
  // No route, projection, selected block, capability or acknowledgment is forged.
  await h.external("BlockCreated", { project_id: h.a, scope: "library", block_id: x.blockId, type: "direction",
    handle: x.blockHandle, position: "l-c190-project-contents", properties: { text: "Existing reusable Project Contents wording.", weight: .7, intent: "include" } });
  await h.external("CanvasCreated", { project_id: h.a, canvas_id: x.boardId, name: "Current Project Contents board",
    slug: "current-project-contents-board", history_owner_id: h.worker.owner });
  await h.external("ProjectOpened", { project_id: h.a });
  await h.external("DocumentOpened", { document_id: h.ad, source_surface: "project-contents-navigation-fixture" });
  await h.store.refreshEvents({ fromStart: true }); await cPC190Settle(x); h.exact(h.a, h.ad);
  const rail = f.find("a", node => node.owner.tag === "forma-project-rail" && fObjectClassed(node, "rail-project-switch")
    && node.attributes.href === "/studio/project");
  await cPC190Click(x, rail); assert.equal(h.store.route.get(), "/studio/project"); h.exact(h.a, h.ad);
  const owners = f.components().filter(value => value.tag === "forma-project-contents" && value.isConnected && value.store === h.store);
  assert.equal(owners.length, 1); x.owner = owners[0];
  assert.equal(x.owner.parentElement.tag, "forma-creative-application");
  const projection = h.store.projection.get();
  x.targetDocument = projection.documents.find(value => value.id === h.otherA && value.projectId === h.a && !value.removed);
  assert.ok(x.targetDocument); assert.notEqual(x.targetDocument.id, projection.documentId);
  const block = projection.libraryBlocks.find(value => value.id === x.blockId);
  assert.ok(block); assert.equal(block.scope, "library"); assert.equal(block.handle, x.blockHandle);
  const board = h.store.canvasProjection.get().canvases.find(value => value.id === x.boardId);
  assert.ok(board && !board.removed); assert.equal(board.projectId, h.a); assert.equal(board.name, "Current Project Contents board");
  const session = h.store.session.get();
  assert.equal(session.projectContext, undefined); assert.equal(session.canvas.access, true, "Real Worker session exposes these current Canvas controls");
  assert.equal(session.assistant.enabled, true); assert.equal(session.provider.configured, false); assert.equal(session.policy.accepted, true);
  Object.assign(x, cPC190Assistant(x)); x.scope = x.panel.conversationScope;
  assert.equal(JSON.parse(x.scope)[9], "/studio/project"); assert.equal(x.panel.open, false);
  assert.equal(x.panel.commandDepartureBlocked, false);
  await cPC190OpenAssistant(x, "");
  assert.equal(JSON.parse(x.scope)[2], h.a);
  const reads = x.reads.reads.filter(row => new URL(row.url, "https://fixture.invalid").searchParams.get("route") === "/studio/project");
  assert.ok(reads.length > 0);
  for (const read of reads) { assert.equal(read.status, 200); assert.equal(read.body.context.scope.projectId, h.a);
    assert.equal(read.body.context.scope.documentId, null); }
  assert.equal(f.tree().visible("dialog").filter(node => node.port.open).length, 0, "No inert background/control gesture through a modal");
  cPC190Control(x, entry);
  x.destination = entry.document ? withDocumentInRoute("/", x.targetDocument.id, x.targetDocument.title)
    : withProjectTaskDocumentInRoute(entry.href(x), projection.documentId, h.store.route.get());
  x.entry = entry; return x;
}

// Exact original navigation receipt observer for this one cross-Document card.
// All other entries permit no event POST. This does not widen any shared helper.
function cPC190Observe(t, x, before) {
  const { h } = x, prior = h.transport, pending = new Set(), errors = [], canvasReads = [], recoveryReads = [];
  const recoveryUrl = "/api/assistant?" + new URLSearchParams({ route: before.route, projectId: h.a }).toString();
  let original = null;
  const expected = { type: "DocumentOpened", payload: { document_id: x.targetDocument.id,
    previous_document_id: h.ad, source_surface: "studio" } };
  const isOriginal = request => Boolean(original?.receipt && request === original.request && request.init === original.init
    && request.init.body === original.bytes && JSON.stringify(request.body) === original.bytes
    && request.url === "/api/events" && request.init.method === "POST" && original.response.status === 200);
  const observe = async request => {
    const method = request.init.method ?? "GET";
    if (request.url === "/api/events" && method === "POST") {
      assert.equal(x.entry.document, true, "Only the cross-Document card may emit its original navigation event");
      assert.equal(original, null, "No second implicit navigation/authoring batch is exempted");
      const body = request.body, init = request.init, bytes = init.body;
      original = { request, init, bytes, response: null, receipt: null, pending: null };
      assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(body.action, "append"); assert.equal(body.clientId, "web:lit"); assert.equal(body.expectedSequence, before.head);
      assert.equal(bytes, JSON.stringify(body)); assert.deepEqual(body.event, expected); assert.deepEqual(body.events, [expected]);
      assert.ok(h.store.authorizationScopeActive(before.authorization) && h.store.sourceOwnershipActive(before.source));
      const response = await prior(request); assert.equal(response.status, 200, await response.clone().text());
      const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
      assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]); assert.deepEqual(receipt.rejected, []);
      assert.equal(receipt.appended.length, 1); const event = receipt.appended[0];
      assert.equal(event.type, expected.type); assert.deepEqual(event.payload, expected.payload);
      assert.equal(event.sequence, before.head + 1); assert.equal(receipt.head, event.sequence);
      assert.equal(event.streamId, h.worker.streamId); assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit");
      assert.ok(event.eventId && event.correlationId); assert.equal(event.compensatesEventId, null);
      assert.equal(event.payload.client_event_id, undefined); await h.worker.drainBackground();
      assert.deepEqual(await h.history(), [...before.history, event]); assert.deepEqual(h.counts(), before.counts);
      const privateRow = h.worker.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND redacted_at IS NULL").get(event.eventId);
      assert.ok(privateRow); assert.deepEqual(JSON.parse(privateRow.private_json), expected.payload);
      assert.equal(request.init, init); assert.equal(request.init.body, bytes);
      original.response = response; original.receipt = receipt; return response;
    }
    // The unchanged original Resume observer must begin its own zero-change
    // measurement after this exact navigation write, not across that write.
    const writing = original;
    if (writing?.pending && !writing.receipt && isOutputFixtureReadOnlyResume(request,
      { projectId: h.a, documentId: x.targetDocument.id })) await writing.pending;
    const response = await prior(request);
    if (request.url === recoveryUrl) {
      assert.equal(method, "GET"); assert.equal(request.body, null);
      assert.deepEqual(request.init, { headers: { accept: "application/json" }, cache: "no-store" });
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.clone().json(); assert.equal(response.bodyUsed, false);
      assert.deepEqual(body.context.scope, { actorUserId: JSON.parse(before.session).user.userId,
        organizationId: null, projectAccessId: null, projectId: h.a, documentId: null });
      assert.deepEqual(body.turns, []); assert.deepEqual(body.tasks, []);
      recoveryReads.push({ request, response, body });
    }
    if (request.url === "/api/session?audience=canvas") {
      assert.ok(["canvas", "board"].includes(x.entry.arrival)); assert.equal(method, "GET");
      assert.equal(response.status, 200, await response.clone().text()); const body = await response.clone().json();
      assert.equal(response.bodyUsed, false); assert.equal(body.canvas.access, true);
      assert.equal(body.user.userId, JSON.parse(before.session).user.userId); assert.equal(body.provider.configured, false);
      canvasReads.push({ request, response, body });
    }
    return response;
  };
  const transport = request => {
    const result = observe(request); if (original?.request === request) original.pending = result; pending.add(result);
    void result.then(() => pending.delete(result), error => { errors.push(error); pending.delete(result); }); return result;
  };
  h.transport = transport;
  const restore = () => { if (h.transport === transport) h.transport = prior; }; t.after(restore);
  return { canvasReads, recoveryReads, get original() { return original; }, isOriginal, restore,
    async settle() { while (pending.size) await Promise.allSettled([...pending]); assert.deepEqual(errors, []); },
    async verify() {
      await this.settle(); await h.worker.drainBackground();
      const appended = original?.receipt?.appended ?? [];
      if (original) { assert.ok(isOriginal(original.request)); assert.equal(original.response.bodyUsed, true);
        assert.deepEqual(h.store.events.get().find(event => event.eventId === appended[0].eventId), appended[0]); }
      assert.deepEqual(await h.history(), [...before.history, ...appended]); assert.deepEqual(h.counts(), before.counts);
      assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), before.receipts);
      for (const request of h.requests.slice(before.requests)) if ((request.init.method ?? "GET") !== "GET")
        assert.ok(isOriginal(request) || h.navigationResumeReads.isReadOnlyResume(request), "Only the exact original card navigation or certified original free Resume");
      for (const row of canvasReads) assert.equal(row.response.bodyUsed, true, "Actual Store consumes the original permitted Canvas session response");
      for (const row of recoveryReads) assert.equal(row.response.bodyUsed, true,
        "The current Assistant consumes the same original context response after deliberate reopening");
      x.reads.empty(); return appended;
    } };
}
function cPC190Arrived(x, before, appended) {
  const { f, h, entry } = x;
  assert.equal(h.store.route.get(), x.destination); assert.equal(h.location.pathname + h.location.search + h.location.hash, x.destination);
  assert.equal(x.owner.isConnected, false); assert.equal(h.store.projection.get().projectId, h.a);
  const tag = ["canvas", "board"].includes(entry.arrival) ? "forma-canvas-surface" : entry.arrival === "document" ? "forma-workspace"
    : ["block", "new-block"].includes(entry.arrival) ? "forma-library" : "forma-" + entry.arrival;
  const owners = f.components().filter(value => value.tag === tag && value.isConnected && value.store === h.store);
  assert.equal(owners.length, 1, "The actual requested destination is rendered, not just a route string");
  assert.ok(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()));
  assert.ok(h.store.authorizationScopeActive(h.store.captureAuthorizationScope()));
  if (["canvas", "board"].includes(entry.arrival)) {
    assert.equal(x.observed.canvasReads.length, 1); assert.equal(appended.length, 0);
    assert.equal(h.store.session.get().canvas.access, true);
    assert.equal(h.store.canvasProjection.get().selectedCanvasId, x.boardId,
      "The existing fold selects the actual latest board even when Canvas listing has no addressed board");
  } else {
    assert.equal(x.observed.canvasReads.length, 0); assert.equal(JSON.stringify(h.store.session.get()), before.session);
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    assert.equal(appended.length, entry.document ? 1 : 0);
  }
  if (entry.document) { assert.equal(documentIdFromRoute(h.store.route.get()), x.targetDocument.id);
    h.exact(h.a, x.targetDocument.id); const headings = f.tree().visible("h1").filter(node => node.owner === owners[0]);
    assert.equal(headings.length, 1); assert.equal(headings[0].text, x.targetDocument.title); }
  if (["block", "new-block"].includes(entry.arrival)) {
    const editors = f.components().filter(value => value.tag === "forma-library-block-editor" && value.store === h.store && value.isConnected);
    assert.equal(editors.length, 1); assert.equal(editors[0].blockId, entry.arrival === "block" ? x.blockId : null);
    const fields = f.tree().visible("input").filter(node => node.owner === editors[0] && !node.port.matches(":disabled"));
    assert.ok(fields.length > 0, "Healthy destination exposes its actual editable controls");
  }
}
for (const entry of cPC190Controls) for (const state of ["clean", "raw"])
test("C ProjectContents ordinary " + entry.id + " / " + state + " Assistant / en", fIntelligenceOptions, async t => {
  const x = await cPC190Page(t, entry, state), { f, h } = x;
  const raw = "  Retain this exact Project Contents Assistant draft — 未送信\n  ";
  if (state === "raw") await cPC190Type(x, "", raw);
  await cPC190Collapse(x, state === "raw" ? raw : ""); await cPC190Settle(x);
  const before = await cOrdinaryNavBefore(f); x.observed = cPC190Observe(t, x, before);
  try {
    const gesture = await cPC190Click(x, cPC190Control(x, entry)); const appended = await x.observed.verify();
    const sameScope = x.panel.isConnected && x.panel.conversationScope === x.scope;
    t.diagnostic("C_PC_OUTGOING_RESULT " + JSON.stringify({ control: entry.id, state, origin: before.route,
      target: x.destination, actual: h.store.route.get(), originConnected: x.owner.isConnected, sameAssistantScope: sameScope,
      assistantStillBlocks: sameScope && x.panel.commandDepartureBlocked, originalNavigationEvents: appended.length,
      actualCanvasSessionReads: x.observed.canvasReads.length, originalHistoryPrivateReceiptFiscalExact: true,
      evidence: "actual full hosts and original RAM Worker; refusal policy and observed raw retention are distinct; no physical/provider claim" }));
    if (state === "raw") {
      assert.equal(h.store.route.get(), before.route, "This deliberate departure must consult the existing sibling draft owner");
      assert.equal(h.location.pathname + h.location.search + h.location.hash, before.route);
      assert.ok(x.owner.isConnected && f.components().includes(x.owner)); assert.equal(sameScope, true);
      assert.equal(x.panel.open, false); assert.equal(x.panel.commandDepartureBlocked, true);
      assert.equal(x.assistant.captureCommandDeparture().blocked(), true);
      assert.equal(h.requests.length, before.requests, "Refusal does not request a destination, append or submit Assistant text");
      assert.equal(appended.length, 0); assert.equal(x.observed.canvasReads.length, 0);
      assert.equal(JSON.stringify(h.store.events.get()), before.events); assert.equal(h.store.head.get(), before.head);
      assert.equal(JSON.stringify(h.store.session.get()), before.session);
      assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
      assert.equal(h.store.ui.toast, f.i18n.t("next.lifecycle.assistantOwnsWork"));
      assert.equal(f.native.nativeFocus.slice(gesture.focus).some(call => call.node.attributes?.id === "main-content"), false);
      assert.equal(f.native.nativeScroll.length, gesture.scroll);
      assert.equal(x.observed.recoveryReads.length, 0);
      const readsBeforeReopen = x.reads.reads.length;
      await cPC190OpenAssistant(x, raw);
      assert.equal(x.observed.recoveryReads.length, 1, "Only the deliberate current Assistant reopening reads its exact original context");
      const recovery = x.observed.recoveryReads[0];
      assert.equal(x.reads.reads.length, readsBeforeReopen + 1);
      assert.equal(x.reads.reads.at(-1).url, recovery.request.url); assert.equal(x.reads.reads.at(-1).status, 200);
      assert.deepEqual(x.reads.reads.at(-1).body, recovery.body);
      assert.deepEqual(h.requests.slice(before.requests), [recovery.request], "The exact original GET is the sole reopening request");
      await cPC190Type(x, raw, ""); await cPC190Collapse(x, "");
      await x.observed.verify(); assert.equal(h.requests.length, before.requests + 1);
      assert.deepEqual(h.requests.slice(before.requests), [recovery.request], "Typing, clear and collapse add no request or write");
      await cPC190Click(x, cPC190Control(x, entry)); const resolved = await x.observed.verify();
      cPC190Arrived(x, before, resolved);
    } else cPC190Arrived(x, before, appended);
  } finally { await x.observed.settle(); await cTargetHandoffSettle(x); x.observed.restore(); }
});


// C227: the existing historical A+B fixture, not a newly seeded project. One
// genuine ProjectOpened is intentional; Canvas session availability is not ACK.
import { financial as cOtherProjectCanvasFinancial } from "./helpers/event-source-retirement-fixture.mjs";

test("C Projects other-project Canvas footer joins session after original ProjectOpened ACK / en", fIntelligenceOptions, async t => {
  const f = await navigationPage(t, "en", { nativePreparation: true }), h = f.navigationHost;
  await registerCalmFullPageComponents(f, ["forma-projects", "forma-canvas-application", "forma-canvas-surface"]);
  assert.strictEqual(f.renderer.registry["forma-canvas-application"], f.modules.get("src/apps/canvas/entry.ts").FormaCanvasApplication);
  assert.strictEqual(f.renderer.registry["forma-canvas-surface"], f.modules.get("src/canvas/canvas-application.ts").CanvasApplication);
  // Same explicit current Canvas one-tab/unchanged-size native prerequisite as
  // cPC190Page; no application callback, timer or renderer default is replaced.
  const previousChannel = globalThis.BroadcastChannel; globalThis.BroadcastChannel = undefined;
  t.after(() => { globalThis.BroadcastChannel = previousChannel; });
  const resizeSeen = new WeakMap(), targets = f.resizeTargets;
  f.resizeTargets = new class extends Map {
    *[Symbol.iterator]() { for (const [observer, node] of super[Symbol.iterator]()) {
      if (node.owner?.tag === "forma-canvas-surface" && node.owner.store === h.store && String(node.attributes?.class ?? "").split(/\s+/u).includes("canvas-viewport")) {
        const sizes = resizeSeen.get(node.owner) ?? new Map(), box = node.getBoundingClientRect(), stamp = box.width + ":" + box.height;
        if (sizes.get("canvas-viewport") === stamp) continue;
        sizes.set("canvas-viewport", stamp); resizeSeen.set(node.owner, sizes);
      }
      yield [observer, node];
    } }
  }(targets);
  const native = await cOrdinaryNavNative(t, f), setupHistory = await h.history();
  const brand = f.find("button", node => node.owner === f.host && fObjectClassed(node, "brand"));
  await cOrdinaryNavClick(f, brand, native);
  assert.equal(h.store.route.get(), "/projects"); assert.deepEqual(await h.history(), setupHistory, "Entering bare Projects adds no setup navigation event");
  h.exact(h.b, h.bd); // Actual existing bare-history fold, not a new ProjectOpened used to force A.
  const owners = f.components().filter(value => value.tag === "forma-projects" && value.isConnected && value.store === h.store);
  assert.equal(owners.length, 1); const owner = owners[0], projection = h.store.projection.get();
  const target = projection.projects.find(value => value.id === h.a); assert.ok(target && target.id !== projection.projectId);
  assert.ok(setupHistory.some(event => event.type === "DocumentCreated" && event.payload.project_id === h.a && event.payload.document_id === h.otherA));
  assert.equal(h.store.session.get().projectContext, undefined); assert.equal(h.store.session.get().canvas.access, true);
  const origin = owner.captureCommandDeparture(); assert.equal(origin.element, owner); assert.equal(origin.current(), true); assert.equal(origin.blocked(), false);
  const tree = f.tree(), cards = tree.visible("article").filter(node => node.owner === owner && fObjectClassed(node, "project-card")
    && !fObjectClassed(node, "current") && tree.visible("h2").some(heading => heading.owner === owner
      && cPC190Ancestor(heading, value => value === node) && heading.text === target.name));
  assert.equal(cards.length, 1);
  const name = f.i18n.t("projects.openCanvasNamed", "Open in Canvas: {name}", { name: "\u2068" + target.name + "\u2069" });
  const buttons = tree.visible("button").filter(node => node.owner === owner && node.parent?.tag === "footer"
    && cPC190Ancestor(node, value => value === cards[0]) && node.text === f.i18n.t("projects.openCanvas", "Open in Canvas")
    && node.attributes["aria-label"] === name);
  assert.equal(buttons.length, 1); const button = buttons[0];
  assert.ok(button.port.isConnected && f.renderer.nodes.includes(button.port)); assert.equal(button.port.owner, owner);
  assert.equal(button.hiddenBy, null); assert.equal(button.port.matches(":disabled"), false); assert.equal(typeof button.handlers.click, "function");
  assert.equal(tree.visible("dialog").filter(node => node.port.open).length, 0);
  const privateRows = () => ({ content: h.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all(),
    payloads: h.worker.sqlite.prepare("SELECT * FROM event_private_payloads ORDER BY private_event_id").all() });
  const before = { ...await cOrdinaryNavBefore(f), private: privateRows(), money: cOtherProjectCanvasFinancial(h.worker) };
  const gate = sceneDeferred(), prior = h.transport, pending = new Set(), errors = [];
  assert.equal(typeof prior, "function"); assert.equal(h.intercept, null, "No competing transport substitute intercepts the actual requests");
  let open = null, append = null, posted = null, session = null;
  // Read-only call/settlement observation: preserve actual this/args and return
  // each ORIGINAL Promise. Neither wrapper supplies an outcome or navigation.
  const originalOpen = h.store.openProject, originalAppend = h.store.appendWithReceipt;
  t.mock.method(h.store, "openProject", function (...args) {
    assert.equal(this, h.store); assert.equal(open, null); assert.deepEqual(args.slice(0, 2), [h.a, "/canvas"]);
    const options = args[2]; assert.equal(typeof options.current, "function"); assert.equal(typeof options.onOriginHandoff, "function");
    assert.equal(typeof options.onDestinationSource, "function"); assert.equal(typeof options.focus.current, "function");
    open = { args, options, focus: options.focus, promise: null, completed: false, result: undefined };
    const promise = Reflect.apply(originalOpen, this, args); open.promise = promise;
    void promise.then(result => { open.result = result; open.completed = true; }, error => { errors.push(error); open.completed = true; });
    return promise;
  });
  t.mock.method(h.store, "appendWithReceipt", function (...args) {
    assert.equal(this, h.store); assert.equal(append, null);
    append = { args, promise: null, result: null };
    const promise = Reflect.apply(originalAppend, this, args); append.promise = promise;
    void promise.then(result => { append.result = result; }, error => { errors.push(error); });
    return promise;
  });
  const observe = async request => {
    const method = request.init.method ?? "GET", isPost = request.url === "/api/events" && method === "POST";
    if (method !== "GET" && !isPost) {
      assert.ok(isOutputFixtureReadOnlyResume(request, { projectId: h.a, documentId: h.otherA }), "Only the exact existing target's free Resume can accompany navigation");
      if (append?.promise && !append.result) await append.promise; // Existing zero-change proof begins after this one known write.
    }
    if (isPost) {
      assert.equal(posted, null); assert.ok(append);
      const input = request.body.event; assert.equal(input.type, "ProjectOpened");
      const clientId = input.payload.client_event_id; assert.match(clientId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
      assert.deepEqual(input.payload, { project_id: h.a, previous_project_id: h.b, source_surface: "canvas-projects", client_event_id: clientId });
      assert.deepEqual(Object.keys(request.body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
      assert.equal(request.body.action, "append"); assert.equal(request.body.clientId, "web:lit");
      assert.equal(request.body.expectedSequence, before.head); assert.deepEqual(request.body.events, [input]); assert.deepEqual(append.args[0], input);
      assert.deepEqual(append.args[1], { rebaseAttempts: 6, silent: true, background: true });
      posted = { request, init: request.init, bytes: request.init.body, response: null, body: null, clientId };
      assert.equal(JSON.stringify(request.body), posted.bytes);
    }
    const response = await prior(request);
    if (method !== "GET" && !isPost) assert.ok(h.navigationResumeReads.isReadOnlyResume(request), "Original zero-change response certification, not an endpoint waiver");
    if (isPost) {
      assert.equal(response.status, 200, await response.clone().text()); const body = await response.clone().json();
      assert.equal(response.bodyUsed, false); assert.deepEqual(Object.keys(body).sort(), ["appended", "head", "rejected"]);
      assert.deepEqual(body.rejected, []); assert.equal(body.appended.length, 1); const event = body.appended[0];
      assert.equal(event.type, "ProjectOpened"); assert.deepEqual(event.payload, request.body.event.payload);
      assert.equal(event.sequence, before.head + 1); assert.equal(body.head, event.sequence);
      assert.equal(event.streamId, h.worker.streamId); assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit");
      assert.ok(event.eventId && event.correlationId); assert.equal(event.compensatesEventId, null);
      posted.response = response; posted.body = body; return response;
    }
    if (request.url === "/api/session?audience=canvas") {
      assert.equal(session, null); assert.equal(method, "GET"); assert.equal(request.body, null);
      assert.deepEqual(request.init, { cache: "no-store", credentials: "same-origin" });
      assert.equal(response.status, 200, await response.clone().text()); const body = await response.clone().json(), priorSession = JSON.parse(before.session);
      assert.equal(response.bodyUsed, false); assert.equal(body.audience, "canvas"); assert.equal(body.canvas.access, true);
      assert.equal(body.user.userId, priorSession.user.userId); assert.equal(body.permissionEpoch, priorSession.permissionEpoch);
      assert.deepEqual(body.projectContext, priorSession.projectContext); assert.deepEqual(body.provider, priorSession.provider);
      session = { request, init: request.init, response, body, delivered: false };
      await gate.promise; assert.equal(request.init, session.init); assert.equal(response.bodyUsed, false);
      session.delivered = true;
    }
    return response;
  };
  const transport = request => {
    const promise = observe(request); pending.add(promise);
    void promise.then(() => pending.delete(promise), error => { errors.push(error); pending.delete(promise); }); return promise;
  };
  h.transport = transport;
  const join = async () => { while (pending.size) await Promise.allSettled([...pending]); assert.deepEqual(errors, []); };
  const restore = () => { if (h.transport === transport) h.transport = prior; };
  t.after(() => { gate.resolve(); restore(); });
  const evidence = async () => {
    assert.ok(posted?.body && append?.result); const event = posted.body.appended[0], result = append.result, ack = result.acknowledgment;
    assert.equal(posted.request.init, posted.init); assert.equal(posted.request.init.body, posted.bytes); assert.equal(posted.response.bodyUsed, true);
    assert.equal(result.publication, "published"); assert.deepEqual(result.appended, [event]);
    assert.equal(ack.outcome, "observed"); assert.equal(ack.privateUnavailable, false); assert.deepEqual(ack.requestedClientEventIds, [posted.clientId]);
    assert.equal(ack.committed.length, 1); assert.equal(ack.committed[0].eventId, event.eventId);
    assert.equal(ack.committed[0].type, "ProjectOpened"); assert.equal(ack.committed[0].clientEventId, posted.clientId);
    assert.equal(h.store.eventWriteAcknowledgments(ack.owner).find(value => value.observationId === ack.observationId), undefined,
      "The successful published/observed original is pruned from unresolved bookkeeping; its returned ACK remains authoritative");
    await h.worker.drainBackground(); assert.deepEqual(await h.history(), [...before.history, event]);
    assert.deepEqual(h.store.events.get(), [...JSON.parse(before.events), event]); assert.equal(h.store.head.get(), event.sequence);
    assert.deepEqual(h.store.optimisticEvents.get(), [], "Only the genuine observed original replaces its own optimistic event");
    assert.deepEqual(h.worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), before.receipts,
      "Plain append retains its real ACK but creates no canvas_sync/idempotency receipt");
    const after = privateRows(), extra = after.payloads.filter(row => !before.private.payloads.some(old => old.private_event_id === row.private_event_id));
    assert.deepEqual(after.content, before.private.content); assert.equal(extra.length, 1); assert.equal(extra[0].private_event_id, event.eventId);
    assert.equal(extra[0].redacted_at, null); assert.deepEqual(JSON.parse(extra[0].private_json), event.payload);
    assert.deepEqual(after.payloads.filter(row => row.private_event_id !== event.eventId), before.private.payloads);
    assert.deepEqual(h.counts(), before.counts); assert.deepEqual(cOtherProjectCanvasFinancial(h.worker), before.money);
    assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authorization));
    h.exact(h.a, h.otherA);
  };
  f.native.emit("pointerdown", button.port); f.native.focus(button.port);
  const action = f.act(button, "click", { button: 0, defaultPrevented: false });
  let preRelease;
  try {
    await untilScene(() => Boolean(session && append?.result) || errors.length > 0, "Both actual session200 and original ProjectOpened ACK reached");
    assert.deepEqual(errors, []); assert.ok(open && posted?.response && session && append.result);
    assert.equal(session.delivered, false); assert.equal(session.response.bodyUsed, false);
    assert.equal(h.store.route.get(), "/projects"); assert.equal(JSON.stringify(h.store.session.get()), before.session);
    await evidence();
    preRelease = { openCompleted: open.completed, openResult: open.result,
      originalOwnerConnected: owner.isConnected }; // Outcome captured, not fabricated or used as an admission override.
    gate.resolve(); await action; await join(); await cOrdinaryNavSettle(f); await join(); await evidence();
    assert.equal(open.completed, true); assert.equal(open.args[2], open.options); assert.equal(open.options.focus, open.focus);
    assert.equal(session.delivered, true); assert.equal(session.response.bodyUsed, true, "Same original session Response is consumed");
    assert.deepEqual(h.store.session.get(), { ...session.body, audience: JSON.parse(before.session).audience });
    for (const request of h.requests.slice(before.requests)) if ((request.init.method ?? "GET") !== "GET")
      assert.ok(request === posted.request || h.navigationResumeReads.isReadOnlyResume(request), "Only this one original navigation event and certified free Resume");
    t.diagnostic("C_OTHER_PROJECT_CANVAS_JOIN " + JSON.stringify({ beforeProject: h.b, targetProject: h.a, targetDocument: h.otherA,
      preRelease, route: h.store.route.get(), originalEventId: posted.body.appended[0].eventId, originalAck: append.result.acknowledgment.outcome,
      postConsumed: posted.response.bodyUsed, sessionConsumed: session.response.bodyUsed,
      requests: h.requests.slice(before.requests).map(request => ({ method: request.init.method ?? "GET", url: request.url })),
      originalHistoryPrivateAndFiscalExact: true, evidence: "actual native footer/Shell/Store and original RAM Worker; no physical/provider proof" }));
    assert.equal(h.store.route.get(), "/canvas", "Original ProjectOpened ACK must not finish the guarded caller before its original Canvas transition");
    assert.equal(h.location.pathname + h.location.search + h.location.hash, "/canvas"); assert.equal(owner.isConnected, false);
    assert.equal(open.result, true);
    const entries = f.components().filter(value => value.tag === "forma-canvas-application" && value.isConnected && value.store === h.store);
    const canvases = f.components().filter(value => value.tag === "forma-canvas-surface" && value.isConnected && value.store === h.store);
    assert.equal(entries.length, 1); assert.equal(canvases.length, 1); assert.equal(canvases[0].parentElement, entries[0]);
    assert.equal(h.store.canvasProjection.get().projectId, h.a);
    const receipt = h.store.captureWorkspaceNavigationFocus("/canvas", open.focus);
    assert.ok(receipt && receipt.routeCurrent(), "The actual destination retains the exact original gesture's route receipt");
  } finally {
    gate.resolve(); await Promise.allSettled([action, ...(append?.promise ? [append.promise] : []), ...(open?.promise ? [open.promise] : [])]);
    await join(); restore();
  }
});
