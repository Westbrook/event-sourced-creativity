import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { appendAuditEvent, readWorkspaceEvents } from "../worker/runtime.ts";
import { artifactFocusOptionsFromRoute, libraryFocusFromRoute, documentIdFromRoute, projectTaskDocumentIdFromRoute, withProjectTaskDocumentInRoute, withDocumentInRoute, libraryFocusRoute, libraryBlockEditorRoute } from "../src/model/routes.ts";
import { creativeCreationHref } from "../src/platform/applications.ts";
import { artifactDeliveryFor } from "../src/state/artifact-delivery-context.ts";
import { createCalmFullPage } from "./helpers/calm-full-page-fixture.mjs";

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
async function navigationFixture(t, { shared = false, reader = false } = {}) {
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

async function navigationPage(t, locale) {
  const h = await navigationFixture(t), events = h.store.events.get(), head = h.store.head.get(), content = h.store.content.get();
  const f = await createCalmFullPage(t, { locale, storeHost: h });
  // Reuse the full actual Shell/route/nested renderer, then restore this test's
  // actual Worker records instead of treating the 14-block presentation sample as source proof.
  h.store.events.set(events); h.store.head.set(head); h.store.content.set(content);
  h.store.setRoute(h.deep); await h.store.syncDocumentFromRoute(); await f.settle();
  f.navigationHost = h;
  f.task = pathname => f.find("a", node => node.owner.tag === "forma-ui-audience-navigation" && new URL(node.attributes.href, "https://fixture.invalid").pathname === pathname);
  return f;
}
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
  assert.equal(h.requests.filter(row => row.init.method === "POST").length, 0, "All real component→Store actions are navigation or free reads only");
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
  assert.equal(h.requests.filter(row => row.init.method === "POST").length, 0);
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
    assert.equal(cold.requests.filter(row => row.init.method === "POST").length, 0);
    const projection = cold.store.projection.get();
    return { route: cold.store.route.get(), projectId: projection.projectId, documentId: projection.documentId,
      historicalBVisible: page.tree().root.text.includes("Historical project B"),
      bSlidesVisible: page.tree().root.text.includes("Historical B Slides"),
      artifacts: projection.libraryArtifacts.map(item => item.id), outputs: projection.libraryOutputs.map(item => item.id) };
  } finally { globalThis.history = previousHistory; await f.settle(); }
}

const secondaryNavigationHeader = f => f.find("a", node => node.owner.tag === "forma-deliver" && node.text.includes(f.i18n.t("deliver.reviewActivity", "Review activity")));
const secondaryNavigationNoPosts = h => assert.equal(h.requests.filter(row => row.init.method === "POST").length, 0, "Navigation sends no source, approval, job or financial mutation");

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
  secondaryNavigationNoPosts(h); assert.deepEqual(await h.history(), history);
});
