
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { html, nothing } from "lit";
import { registerHooks } from "node:module";
import { untilScene } from "./helpers/scene-cost-store-host.mjs";

// Reuse the full production Store, Output controller/card and SQLite fixture.
// Skip test registration only; production methods and imports stay intact.
const sourceUrl = new URL("./output-source-refresh.test.mjs", import.meta.url);
const sourceText = fs.readFileSync(sourceUrl, "utf8");
const tree = ts.createSourceFile(sourceUrl.pathname, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
  || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)).map(node => node.getFullText(tree)).join("\n")
  + "\nexport { sourceFixture, mountSourceController, ui, workers, cursor, authoredState, label, changeScope };\n";
sourceUrl.search = "shared-project-selector-fixture";
const fixtureHook = registerHooks({ load(url, context, next) {
  return url === sourceUrl.href ? { format: "module", source: declarations, shortCircuit: true } : next(url, context);
} });
const { sourceFixture, mountSourceController, ui, workers, cursor, authoredState, label, changeScope } = await import(sourceUrl.href);
fixtureHook.deregister();
const { FormaWorkspaceSettings } = await ui.loadActual("src/components/forma-workspace-settings.ts");
const { FormaProjects } = await ui.loadActual("src/components/forma-projects.ts");
const { handleSession } = await import("../worker/pilot-policy.ts");
const { handleProjectNotifications } = await import("../worker/project-notifications-api.ts");

const { documentIdFromRoute } = await import("../src/model/routes.ts");

const { ProjectRail } = await ui.loadActual("src/components/project-rail.ts");
const { CollectionTree } = await ui.loadActual("src/components/collection-tree.ts");


const authorityState = state => Object.fromEntries(["organization_memberships", "project_memberships", "organization_projects", "capability_grants"].map(table => [table, state.sqlite.prepare('SELECT * FROM "' + table + '"').all()]));
const contextPath = state => "/api/workspaces/" + encodeURIComponent(state.organizationId) + "/projects/" + encodeURIComponent(state.projectAccessId) + "/context";
const method = request => request.init.method ?? "GET";
function installHistory(t, host) {
  Object.defineProperty(host.location, "href", { configurable: true, get() { return this.origin + this.pathname + this.search + this.hash; } });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "history");
  Object.defineProperty(globalThis, "history", { configurable: true, value: {
    pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(host.location, { pathname: url.pathname, search: url.search, hash: url.hash }); },
    replaceState(state, title, route) { this.pushState(state, title, route); },
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, "history", previous) : delete globalThis.history);
}
async function selectorFixture(t, options = {}) {
  const setup = options.state ?? await workers.fixture();
  if (!options.cold) {
    // Existing projects may already have zeroed session counters. Initialize them
    // through the actual read route before the strict immutable recovery baseline.
    const initialized = await handleSession(new Request("http://localhost/api/session", { headers: { cookie: setup.cookie } }), setup.env);
    assert.equal(initialized.status, 200);
  }
  const f = await sourceFixture(t, { ...options, selected: false, state: setup }), h = f.storeHost, state = f.db;
  installHistory(t, h);
  const jar = { cookie: "", contextChoices: 0, permitted: false }, responses = [];
  h.transport = async ({ url: input, init }) => {
    assert.ok(input.startsWith("/api/"), "Only in-memory same-origin application requests");
    const headers = new Headers(init.headers); if (jar.cookie) headers.set("cookie", jar.cookie);
    const request = new Request("http://localhost" + input, { ...init, headers }), url = new URL(request.url);
    assert.ok(request.method === "GET" || request.method === "POST" && url.pathname === contextPath(state) && jar.permitted,
      "Only the human-chosen exact project context may be written");
    if (request.method === "POST") { jar.contextChoices++; jar.permitted = false; }
    let response;
    if (url.pathname === "/api/session") response = await handleSession(request, state.env);
    else if (url.pathname === "/api/events") response = await workers.handleEvents(request, state.env);
    else if (url.pathname === "/api/workspaces" || url.pathname.startsWith("/api/workspaces/")) response = await workers.handleWorkspaces(request, state.env, url.pathname.slice("/api/workspaces".length).split("/").filter(Boolean).map(decodeURIComponent));
    else if (url.pathname === "/api/project-notifications") response = await handleProjectNotifications(request, state.env);
    else if (url.pathname === "/api/output-requirements") response = await workers.handleOutputRequirements(request, state.env, url.pathname, { waitUntil() { assert.fail("No background execution"); } });
    else assert.fail("Unexpected in-memory selector route " + url.pathname);
    const selectedCookie = response.headers.get("set-cookie");
    if (selectedCookie) { assert.equal(url.pathname, contextPath(state)); jar.cookie = selectedCookie.split(";")[0]; }
    responses.push({ url: input, method: request.method, status: response.status, cookie: Boolean(jar.cookie) });
    return response;
  };
  t.mock.method(globalThis, "fetch", (input, init) => h.fetch(input, init));
  f.jar = jar; f.responses = responses;
  f.authorityBefore = authorityState(state); const mediaBefore = structuredClone(state.media);
  f.mount = Class => {
    f.host.isConnected = false; f.host.disconnectedCallback();
    f.host = new Class(); f.host.isConnected = true; f.host.connectedCallback(); f.draw();
    return f.host;
  };
  f.nativeLink = (link, owner = f.controller) => {
    let prevented = false;
    link.handlers.click?.call(owner, { preventDefault() { prevented = true; }, button: 0 });
    assert.equal(prevented, false, "The current native recovery link is actionable");
    f.store.setRoute(link.attributes.href);
  };
  f.unmodified = () => {
    assert.deepEqual(authoredState(state), f.before, "No authored events, private payloads, Output/grant/hold/job/acceptance changes");
    assert.deepEqual(authorityState(state), f.authorityBefore, "Project roles, memberships and capability grants remain unchanged");
    assert.deepEqual(state.media, mediaBefore, "No output files or private media are created or changed");
    assert.deepEqual(f.newRequests().filter(request => method(request) !== "GET").map(request => [method(request), request.url]),
      Array.from({ length: jar.contextChoices }, () => ["POST", contextPath(state)]));
    assert.equal(f.newRequests().some(request => /\/(?:preflight|start|render|execute|run|accept|bind)(?:\/|$|\?)/u.test(request.url)), false);
  };
  return f;
}
const projectOpen = f => f.renderer.ownNodes(f.host, "button").find(button => button.attributes["aria-label"] === f.i18n.t("workspace.admin.openNamed", "Open {name}", { name: "Read-only source test" }));
const projectContinue = f => f.renderer.ownNodes(f.host, "button").find(button => button.attributes["aria-label"] === f.i18n.t("projects.continueNamed", "Continue working on {name}", { name: "\u2068Read-only source test\u2069" }));
async function settle(f, predicate, message) {
  await untilScene(() => { f.draw(); return predicate(); }, message);
}



async function enterSelector(f) {
  const link = f.projects(); assert.ok(link, "Actual no-context recovery link");
  f.nativeLink(link);
  if (f.store.route.get() !== "/settings/workspaces") {
    // This path is the causal control for the former /projects handoff. It runs
    // its real Continue action rather than pretending that navigation selects context.
    assert.equal(f.store.route.get(), "/projects");
    f.mount(FormaProjects);
    const oldContinuation = projectContinue(f); assert.ok(oldContinuation);
    await oldContinuation.handlers.click.call(f.host, { currentTarget: oldContinuation });
    await f.flush();
    return false;
  }
  f.mount(FormaWorkspaceSettings);
  await settle(f, () => Boolean(projectOpen(f)), "Actual shared-project selector list loaded");
  assert.equal(Boolean(f.store.session.get().projectContext), false);
  assert.equal(f.jar.contextChoices, 0, "Opening settings does not select any project");
  assert.equal(f.jar.cookie, "", "The cookie-free session stays unselected until the explicit choice");
  assert.equal(f.store.outputRequirements.resource(workers.doc).snapshot, null);
  return true;
}
async function chooseProject(f) {
  const choice = projectOpen(f); assert.ok(choice, "Exact original project choice");
  assert.equal(Object.hasOwn(choice.attributes, "disabled"), false);
  f.jar.permitted = true;
  choice.handlers.click.call(f.host, { currentTarget: choice });
  await settle(f, () => Boolean(f.store.session.get()?.projectContext) && f.store.route.get() === "/projects"
    && !f.store.loading.get() && f.store.projection.get().projectId === workers.project
    && projectOpen(f) && !Object.hasOwn(projectOpen(f).attributes, "disabled"),
  "Explicit selection refreshes session and project events");
  assert.equal(f.jar.contextChoices, 1);
  assert.ok(f.jar.cookie.startsWith("forma_project_context="));
  assert.equal(f.store.session.get().projectContext.projectId, workers.project);
  assert.equal(f.store.session.get().projectContext.projectAccessId, f.db.projectAccessId);
  assert.ok(cursor(f.db) > f.indexed, "Existing selected-project event load refreshes the source index");
  const issued = f.db.sqlite.prepare("SELECT * FROM project_context_sessions WHERE context_id=?").get(decodeURIComponent(f.jar.cookie.split("=")[1]));
  assert.ok(issued, "The actual context handler stored the browser cookie identity");
  assert.equal(issued.principal_user_id, workers.owner);
  assert.equal(issued.organization_id, f.db.organizationId);
  assert.equal(issued.project_access_id, f.db.projectAccessId);
  assert.equal(issued.revoked_at, null);
}
async function returnToDocument(t, f, options = {}) {
  f.mount(FormaProjects);
  const continuation = projectContinue(f); assert.ok(continuation, "Actual original project Continue button");
  await continuation.handlers.click.call(f.host, { currentTarget: continuation }); await f.flush();
  assert.equal(f.store.projection.get().projectId, workers.project);
  if (f.store.projection.get().documentId !== workers.doc) {
    f.renderer.registry["forma-collection-tree"] = CollectionTree;
    f.mount(ProjectRail);
    const documentLink = f.renderer.ownNodes(f.host, "a").find(link => documentIdFromRoute(link.attributes.href ?? "") === workers.doc);
    assert.ok(documentLink, "Existing project navigation offers the exact original Document");
    let prevented = false;
    documentLink.handlers.click.call(f.host, { button: 0, preventDefault() { prevented = true; } });
    assert.equal(prevented, true, "The actual Rail handler owns this Document navigation");
    await settle(f, () => f.store.projection.get().documentId === workers.doc, "Explicit original-Document navigation completed");
  }
  assert.equal(f.store.projection.get().documentId, workers.doc);
  assert.equal(documentIdFromRoute(f.store.route.get()), workers.doc, "Actual project navigation returned to the original Document");
  f.host.isConnected = false; f.host.disconnectedCallback();
  const recovered = mountSourceController(t, f.storeHost, workers.doc, options);
  await settle(recovered, () => ["ready", "unavailable"].includes(f.store.outputRequirements.resource(workers.doc).state),
    "Original Document Output completed its current authorized read");
  return recovered;
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const surface of ["document", "deliver"]) {
  test("actual selector recovers original " + surface + " Output " + locale, async t => {
    const options = { locale, surface, ...(surface === "document" ? { blockId: "image-assignment" } : {}) };
    const f = await selectorFixture(t, options), originalLink = f.projects(), originalController = f.controller;
    const entered = await enterSelector(f);
    if (entered) await chooseProject(f);
    const recovered = await returnToDocument(t, f, options), resource = f.store.outputRequirements.resource(workers.doc);
    assert.equal(resource.state, "ready", "Only the explicit shared-project selection recovers Output reads");
    assert.equal(originalLink.attributes.href, "/settings/workspaces");
    assert.equal(resource.snapshot.documentId, workers.doc);
    assert.equal(resource.snapshot.requirements.length, 1);
    assert.equal(recovered.projects(), undefined); assert.equal(recovered.control(), undefined);
    assert.ok(recovered.renderer.markup.includes("forma-output-requirement-card"), "The registered real Output card is visible");
    assert.ok(recovered.visible().includes("Social media image"));
    let prevented = false; const requestCount = f.newRequests().length;
    originalLink.handlers.click.call(originalController, { preventDefault() { prevented = true; } });
    assert.equal(prevented, true, "The former cookie-free control cannot act in the new selected scope");
    assert.equal(f.newRequests().length, requestCount);
    f.unmodified();
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) test("ordinary Projects Continue cannot substitute for context selection " + locale, async t => {
  const f = await selectorFixture(t, { locale });
  f.store.setRoute("/projects"); f.mount(FormaProjects);
  const continuation = projectContinue(f); assert.ok(continuation);
  await continuation.handlers.click.call(f.host, { currentTarget: continuation }); await f.flush();
  const resource = await f.store.outputRequirements.ensure(workers.doc, { force: true });
  assert.equal(resource.state, "unavailable"); assert.equal(resource.errorCode, "project_context_required");
  assert.equal(resource.snapshot, null); assert.equal(Boolean(f.store.session.get().projectContext), false);
  assert.equal(f.jar.contextChoices, 0); assert.equal(f.jar.cookie, ""); assert.equal(cursor(f.db), f.indexed);
  f.unmodified();
});

for (const kind of ["route", "document", "current-document", "actor", "permission-epoch", "read-permission", "project", "removed-document", "disconnected"]) {
  test("captured selector link is inert after " + kind, async t => {
    const f = await selectorFixture(t), link = f.projects(), requests = f.newRequests().length;
    changeScope(f, kind);
    if (kind === "document") f.controller.documentId = f.documentId;
    let prevented = false; link.handlers.click.call(f.controller, { preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(f.newRequests().length, requests);
    assert.equal(f.jar.contextChoices, 0); assert.equal(f.jar.cookie, ""); assert.equal(cursor(f.db), f.indexed);
    f.unmodified();
  });
}

for (const denied of ["permission withdrawn", "project quarantined"]) test("selector rechecks actual current access when " + denied, async t => {
  const f = await selectorFixture(t); assert.equal(await enterSelector(f), true);
  const selectedBefore = f.db.sqlite.prepare("SELECT * FROM project_context_sessions ORDER BY context_id").all();
  const captured = projectOpen(f), now = new Date().toISOString();
  if (denied === "permission withdrawn") f.db.sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id=?").run(now, f.db.organizationId, workers.owner);
  else f.db.sqlite.prepare("UPDATE project_migration_states SET status='disabled' WHERE project_access_id=?").run(f.db.projectAccessId);
  f.authorityBefore = authorityState(f.db); // The external test withdrawal is the new authoritative baseline.
  f.jar.permitted = true; captured.handlers.click.call(f.host, { currentTarget: captured });
  await settle(f, () => f.responses.some(response => response.method === "POST" && response.status === 403)
    && projectOpen(f) && !Object.hasOwn(projectOpen(f).attributes, "disabled"), "Actual project selection was refused");
  assert.equal(f.jar.cookie, ""); assert.equal(Boolean(f.store.session.get().projectContext), false);
  assert.equal(f.store.route.get(), "/settings/workspaces");
  assert.deepEqual(f.db.sqlite.prepare("SELECT * FROM project_context_sessions ORDER BY context_id").all(), selectedBefore);
  assert.equal(f.store.outputRequirements.resource(workers.doc).snapshot, null);
  assert.ok(f.renderer.ownNodes(f.host, "p").some(node => node.attributes.role === "alert"), "The real selector explains refusal");
  assert.equal(cursor(f.db), f.indexed);
  f.unmodified();
});

test("cold shared-session read only materializes zero-use counters", async t => {
  const f = await selectorFixture(t, { cold: true }); assert.equal(await enterSelector(f), true);
  await chooseProject(f); await returnToDocument(t, f);
  assert.equal(f.store.outputRequirements.resource(workers.doc).state, "ready");
  const after = authoredState(f.db), before = structuredClone(f.before);
  for (const [table, used, reserved, limit] of [
    ["budget_counters", "used_tokens", "reserved_tokens", "hard_limit_tokens"],
    ["cost_budget_counters", "used_microusd", "reserved_microusd", "hard_limit_microusd"],
  ]) {
    const added = after[table].filter(row => !before[table].some(old => old.scope === row.scope && old.scope_id === row.scope_id && old.period === row.period));
    assert.equal(added.length, 1);
    assert.equal(added[0].scope, "workspace"); assert.equal(added[0].scope_id, f.db.organizationId);
    assert.equal(added[0][used], 0); assert.equal(added[0][reserved], 0);
    const policy = f.db.sqlite.prepare("SELECT token_limit,microusd_limit FROM budget_scope_policies WHERE scope='workspace' AND scope_id=?").get(f.db.organizationId);
    assert.equal(added[0][limit], policy[limit === "hard_limit_tokens" ? "token_limit" : "microusd_limit"]);
    after[table] = after[table].filter(row => !added.includes(row));
  }
  assert.deepEqual(after, f.before, "Every existing financial row and all authored/Output/private rows remain unchanged");
  assert.deepEqual(authorityState(f.db), f.authorityBefore);
  assert.deepEqual(f.newRequests().filter(request => method(request) !== "GET").map(request => [method(request), request.url]), [["POST", contextPath(f.db)]]);
});


for (const locale of ["en", "fr", "ar", "ja"]) test("choosing the original project stays exact among other shared projects and Documents " + locale, async t => {
  const state = await workers.fixture(), otherProject = "another-readable-project", otherDoc = "another-project-document";
  await workers.appendEvents(state.env, [
    workers.makeEvent("creative:" + workers.owner, 0, "user:" + workers.owner, "fixture", "other-project", "ProjectCreated", { project_id: otherProject, name: "Another shared project" }),
    workers.makeEvent("creative:" + workers.owner, 0, "user:" + workers.owner, "fixture", "other-document", "DocumentCreated", { project_id: otherProject, document_id: otherDoc, title: "Unrelated Document" }),
    workers.makeEvent("creative:" + workers.owner, 0, "user:" + workers.owner, "fixture", "neighbor-document", "DocumentCreated", { project_id: workers.project, document_id: "neighbor-document", title: "Another Document in this project" }),
    workers.makeEvent("creative:" + workers.owner, 0, "user:" + workers.owner, "fixture", "return-project", "ProjectOpened", { project_id: workers.project }),
    workers.makeEvent("creative:" + workers.owner, 0, "user:" + workers.owner, "fixture", "return-original", "DocumentOpened", { project_id: workers.project, document_id: workers.doc }),
  ]);
  const attached = await workers.handleWorkspaces(new Request("http://localhost/api/workspaces/" + state.organizationId + "/projects", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: otherProject }),
  }), state.env, [state.organizationId, "projects"]);
  assert.equal(attached.status, 201, await attached.clone().text());
  const otherAccess = (await attached.json()).projectAccessId;
  const f = await selectorFixture(t, { state, locale }); assert.equal(await enterSelector(f), true);
  const otherChoice = f.renderer.ownNodes(f.host, "button").find(button => button.attributes["aria-label"] === f.i18n.t("workspace.admin.openNamed", "Open {name}", { name: "Another shared project" }));
  assert.ok(otherChoice, "Both real authorized project choices remain available"); assert.notEqual(otherChoice, projectOpen(f));
  assert.equal(f.jar.contextChoices, 0); await chooseProject(f);
  const recovered = await returnToDocument(t, f, { locale }), resource = f.store.outputRequirements.resource(workers.doc);
  assert.equal(resource.state, "ready"); assert.equal(resource.snapshot.documentId, workers.doc);
  assert.equal(f.store.session.get().projectContext.projectAccessId, state.projectAccessId);
  assert.equal(f.newRequests().some(request => request.url.includes(encodeURIComponent(otherAccess))), false);
  assert.equal(recovered.visible().includes("Unrelated Document"), false);
  assert.equal(f.store.outputRequirements.resource(otherDoc).snapshot, null);
  f.unmodified();
});

test("double activation of the selector still selects once and never repeats Output work", async t => {
  const f = await selectorFixture(t); assert.equal(await enterSelector(f), true);
  const choice = projectOpen(f), before = f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM project_context_sessions").get().count;
  f.jar.permitted = true;
  choice.handlers.click.call(f.host, { currentTarget: choice });
  choice.handlers.click.call(f.host, { currentTarget: choice });
  await settle(f, () => f.store.route.get() === "/projects" && !f.store.loading.get()
    && f.store.projection.get().projectId === workers.project && projectOpen(f) && !Object.hasOwn(projectOpen(f).attributes, "disabled"),
  "One actual selection completed");
  await returnToDocument(t, f);
  assert.equal(f.jar.contextChoices, 1);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS count FROM project_context_sessions").get().count, before + 1);
  assert.equal(f.store.outputRequirements.resource(workers.doc).state, "ready"); f.unmodified();
});

for (const locale of ["en", "fr", "ar", "ja"]) test("selector guidance and accessible action name use the real " + locale + " catalog", async t => {
  const f = await selectorFixture(t, { locale }), link = f.projects();
  const visible = {
    en: "Choose shared project", fr: "Choisir le projet partagé", ar: "اختيار المشروع المشترك", ja: "共有プロジェクトを選択",
  };
  const guidance = {
    en: "In Workspace settings, open this Document’s existing shared project, then return to this Document. No project will be selected automatically.",
    fr: "Dans les paramètres des espaces de travail, ouvrez le projet partagé existant de ce document, puis revenez à ce document. Aucun projet ne sera sélectionné automatiquement.",
    ar: "في إعدادات مساحات العمل، افتح المشروع المشترك الموجود لهذا المستند، ثم عُد إلى هذا المستند. لن يُختار أي مشروع تلقائيًا.",
    ja: "ワークスペース設定で、このドキュメントの既存の共有プロジェクトを開いてから、このドキュメントに戻ってください。プロジェクトが自動で選択されることはありません。",
  };
  assert.equal(label(f, "output_target_source_open_projects"), visible[locale]);
  assert.ok(f.visible().includes(visible[locale])); assert.ok(f.visible().includes(guidance[locale]));
  assert.equal(link.attributes["aria-label"], visible[locale] + " · " + label(f, "output_target_source_document_context", {
    number: f.i18n.number(1), name: "\u2068Exact authorized Document\u2069",
  }));
  assert.equal(link.attributes.href, "/settings/workspaces");
  assert.equal(f.i18n.direction, locale === "ar" ? "rtl" : "ltr");
  assert.notEqual(label(f, "output_target_source_refresh_needs_project"), label(f, "output_source_projection_stale"), "Licensed-origin guidance remains distinct");
  assert.equal(f.newRequests().length, 0); f.unmodified();
});


test("native attribute port distinguishes omitted, bare and valued popover attributes", async t => {
  const f = await selectorFixture(t);
  class AttributeProbe extends ui.ElementPort {
    render() {
      return html`<div class="probe-absent"></div><div class="probe-nothing" popover=${nothing}></div><div class="probe-bare" popover></div><div class="probe-auto" popover="auto"></div><div class="probe-bound" popover=${"auto"}></div>`;
    }
  }
  // This checks the shared template/DOM port itself, not browser top-layer behavior.
  f.mount(AttributeProbe);
  for (const name of ["probe-absent", "probe-nothing"]) {
    const rendered = f.renderer.ownNodes(f.host, "div").find(node => node.attributes.class === name);
    assert.ok(rendered); assert.equal(Object.hasOwn(rendered.attributes, "popover"), false);
    assert.equal(f.host.querySelector("." + name + "[popover]"), null);
  }
  for (const [name, value] of [["probe-bare", ""], ["probe-auto", "auto"], ["probe-bound", "auto"]]) {
    const rendered = f.renderer.ownNodes(f.host, "div").find(node => node.attributes.class === name);
    assert.ok(rendered); assert.equal(rendered.attributes.popover, value);
    assert.equal(f.host.querySelector("." + name + "[popover]"), rendered);
  }
  assert.equal(f.newRequests().length, 0); f.unmodified();
});
