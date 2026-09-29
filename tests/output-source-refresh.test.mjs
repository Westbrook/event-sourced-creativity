import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { html } from "lit";
import { createSceneStoreHost, untilScene, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";

// Reuse the actual SQLite setup and complete component loader. Only their test
// registration is omitted: no Store, client, controller, or worker method is replaced.
// The template/DOM ports are deterministic component evidence, not a browser or AT certificate.
async function declarations(relative, names, calls = []) {
  const url = new URL(relative, import.meta.url), source = fs.readFileSync(url, "utf8");
  const tree = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let code = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
    || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)
    || ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && calls.includes(node.expression.expression.getText(tree)))
    .map(node => node.getFullText(tree)).join("\n");
  code = code.replace(/(from\s+|import\s*\()(["'])([^"']+)\2/gu, (_match, prefix, _quote, specifier) =>
    prefix + JSON.stringify(specifier.startsWith(".") ? new URL(specifier, url).href : specifier.startsWith("node:") ? specifier : import.meta.resolve(specifier)));
  code = code.replaceAll('import.meta.resolve("vite")', JSON.stringify(import.meta.resolve("vite"))).replaceAll("import.meta.url", JSON.stringify(url.href));
  code = code.replace("await import(specifier)", 'await import(specifier==="lit/directives/live.js"?' + JSON.stringify(import.meta.resolve("lit/directives/live.js")) + ":specifier)");
  code += "\nexport { " + names.join(", ") + " };\n";
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}
const workers = await declarations("./output-requirements-project-read.test.mjs",
  ["fixture", "governedFixture", "owner", "project", "doc", "appendEvents", "makeEvent", "handleWorkspaces", "handleEvents", "handleOutputRequirements"], ["hook.deregister"]);
const ui = await declarations("./presentation-guidance-accessibility.test.mjs",
  ["fixture", "loadActual", "ElementPort", "documentPort", "windowPort"], ["registerHooks"]);
const { handleSession } = await import("../worker/pilot-policy.ts");
const { parseOutputRequirement } = await import("../src/model/output-requirements.ts");
const { sameOwnerPublishedFixture } = await import("./output-published-package-fixture.mjs");
const { FormaOutputRequirements } = await ui.loadActual("src/components/forma-output-requirements.ts");
const { FormaOutputRequirementCard } = await ui.loadActual("src/components/forma-output-requirement-card.ts");
const { outputDeliveryMessageDescriptor, FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES } = await ui.loadActual("src/components/design-system/locales/output-delivery-runtime-messages.ts");
const targetStale = "output_target_source_projection_stale", originStale = "output_source_projection_stale";
const sourcePath = request => /^\/api\/workspaces\/[^/]+\/projects\/[^/]+\/events\?/u.test(request.url);
const outputPath = request => request.url.startsWith("/api/output-requirements?");
const noProviders = t => t.mock.method(globalThis, "fetch", async () => assert.fail("No external requests or providers"));
const label = (f, code, values = {}) => { const descriptor = outputDeliveryMessageDescriptor(code, values); return f.i18n.t(descriptor.id, FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.en[descriptor.id], descriptor.values); };
const cursor = state => state.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=?").get(state.projectAccessId).last_owner_sequence;
function authoredState(state) {
  const names = state.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name)
    .filter(name => name === "events" || name === "event_private_payloads" || name === "private_content"
      || name.startsWith("output_") || /budget|reservation|grant|acceptance|document_jobs/u.test(name));
  return Object.fromEntries(names.map(name => [name, state.sqlite.prepare('SELECT * FROM "' + name + '"').all()]));
}
function mountSourceController(t, storeHost, documentId, { locale = "en", blockId = "", surface = "deliver" } = {}) {
  const f = ui.fixture(t, { locale, facts: [] }); f.host.disconnectedCallback(); f.store = storeHost.store; f.trace.length = 0;
  f.documentId = documentId; f.blockId = blockId; f.surface = surface;
  class OutputPage extends ui.ElementPort {
    render() { return html`<forma-output-requirements .documentId=${this.fixture.documentId} .blockId=${this.fixture.blockId} .surface=${this.fixture.surface}></forma-output-requirements>`; }
  }
  f.renderer.registry = { "forma-output-requirements": FormaOutputRequirements, "forma-output-requirement-card": FormaOutputRequirementCard };
  f.host = new OutputPage(); f.host.isConnected = true;
  f.draw();
  f.controller = [...f.renderer.instances.values()].map(row => row.instance).find(instance => instance instanceof FormaOutputRequirements);
  assert.ok(f.controller, "The complete production Output controller is mounted");
  f.control = () => f.renderer.ownNodes(f.controller, "button").find(node => Object.hasOwn(node.attributes, "data-output-source-refresh"));
  f.projects = () => f.renderer.ownNodes(f.controller, "a").find(node => Object.hasOwn(node.attributes, "data-output-source-open-projects"));
  f.refresh = () => { const node = f.control(); assert.ok(node, "Actual source refresh button"); return node.handlers.click.call(f.controller, { currentTarget: node, preventDefault() {}, stopPropagation() {} }); };
  return f;
}

async function sourceFixture(t, { locale = "en", selected = true, retained = false, blockId = "", reviewer = false, surface = "deliver", state: supplied } = {}) {
  noProviders(t);
  const state = supplied ?? await workers.fixture();
  let cookie = selected ? state.cookie : "";
  const identityHeaders = {};
  if (reviewer) {
    const now = new Date().toISOString(), user = "source-index-reader";
    state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)").run(user, "source-reader@local.forma", "Source reader", now, now, now);
    state.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,'member','active',?,?,?,?)").run("source-reader-org", state.organizationId, user, workers.owner, now, now, now);
    state.sqlite.prepare("INSERT INTO project_memberships(membership_id,organization_id,project_access_id,project_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'viewer','active',?,?,?)").run("source-reader-project", state.organizationId, state.projectAccessId, workers.project, user, workers.owner, now, now);
    Object.assign(identityHeaders, { "oai-authenticated-user-id": user, "oai-authenticated-user-email": "source-reader@local.forma" });
    const path = [state.organizationId, "projects", state.projectAccessId, "context"];
    const opened = await workers.handleWorkspaces(new Request("http://localhost/api/workspaces/" + path.join("/"), { method: "POST", headers: identityHeaders }), state.env, path);
    assert.equal(opened.status, 200, await opened.clone().text()); cookie = opened.headers.get("set-cookie").split(";")[0];
  }
  const worker = { ...state, documentId: workers.doc, projectId: workers.project, requestId: "unused-no-generation", payload: { workflowSources: [] },
    async request(input, init = {}) {
      const headers = new Headers({ ...identityHeaders, ...init.headers }); if (cookie) headers.set("cookie", cookie);
      const request = new Request("http://localhost" + input, { ...init, headers }), url = new URL(request.url);
      assert.equal(request.method, "GET", "The recovery bridge never admits an authoring request");
      if (url.pathname === "/api/session") return handleSession(request, state.env);
      if (url.pathname === "/api/events") return workers.handleEvents(request, state.env);
      if (url.pathname.startsWith("/api/workspaces/")) return workers.handleWorkspaces(request, state.env, url.pathname.slice("/api/workspaces/".length).split("/").map(decodeURIComponent));
      if (url.pathname === "/api/output-requirements") return workers.handleOutputRequirements(request, state.env, url.pathname, { waitUntil() { assert.fail("No background execution"); } });
      assert.fail("Unexpected in-memory application route " + url.pathname);
    },
    close() { state.sqlite.close(); },
  };
  const storeHost = await createSceneStoreHost({ workerFixture: worker }), store = storeHost.store;
  t.after(() => storeHost.close());
  assert.equal(store.projection.get().projectId, workers.project); assert.equal(store.projection.get().documentId, workers.doc);
  assert.ok(store.projection.get().documents.some(document => document.id === workers.doc));
  assert.equal(Boolean(store.session.get().projectContext), selected);
  if (retained) { const result = await store.outputRequirements.ensure(workers.doc); assert.equal(result.state, "ready"); }
  const indexed = cursor(state);
  await workers.appendEvents(state.env, [workers.makeEvent("creative:" + workers.owner, 0, "user:" + workers.owner, "fixture", "opened-after-store-read", "DocumentOpened", { project_id: workers.project, document_id: workers.doc })]);
  const before = authoredState(state), stale = await store.outputRequirements.ensure(workers.doc, { force: true });
  assert.equal(stale.state, "unavailable"); assert.equal(stale.errorCode, selected ? targetStale : "project_context_required"); assert.equal(Boolean(stale.snapshot), retained);
  assert.equal(cursor(state), indexed, "Output reads cannot repair the source projection");
  const f = mountSourceController(t, storeHost, workers.doc, { locale, blockId, surface });
  f.storeHost = storeHost; f.db = state; f.indexed = indexed; f.before = before;
  f.newRequests = () => storeHost.requests.slice(f.requestStart);
  f.noAuthoring = () => {
    assert.ok(f.newRequests().every(request => !request.init.method || request.init.method === "GET"));
    assert.equal(store.events.get(), f.initialEvents, "No event hydration or append"); assert.equal(store.content.get(), f.initialContent, "No content hydration"); assert.equal(store.head.get(), f.initialHead, "No client source cursor adoption");
    assert.deepEqual(authoredState(state), f.before, "Events, private payloads, grants, holds, jobs, acceptance and Output ledgers unchanged");
  };
  f.initialEvents = store.events.get(); f.initialContent = store.content.get(); f.initialHead = store.head.get();
  f.requestStart = storeHost.requests.length;
  return f;
}

for (const locale of ["en", "fr", "ar", "ja"]) test("target-source recovery " + locale + " uses the existing scoped route with no snapshot and no authoring", async t => {
  const f = await sourceFixture(t, { locale });
  assert.ok(f.control()); assert.equal(f.projects(), undefined);
  assert.equal(f.control().attributes["aria-label"], label(f, "output_target_source_refresh") + " · " + label(f, "output_target_source_document_context", { number: f.i18n.number(1), name: "\u2068Exact authorized Document\u2069" }));
  await f.refresh(); await f.flush();
  assert.equal(f.store.outputRequirements.resource(workers.doc).state, "ready");
  assert.equal(f.newRequests().filter(sourcePath).length, 1); assert.equal(f.newRequests().filter(outputPath).length, 1);
  assert.equal(f.newRequests().filter(sourcePath)[0].url, "/api/workspaces/" + encodeURIComponent(f.db.organizationId) + "/projects/" + encodeURIComponent(f.db.projectAccessId) + "/events?after=" + f.store.head.get() + "&limit=1&content=0");
  assert.equal(f.newRequests().filter(sourcePath)[0].init.credentials, "same-origin");
  assert.equal(f.newRequests().filter(sourcePath)[0].init.cache, "no-store");
  assert.ok(cursor(f.db) > f.indexed);
  assert.equal(f.control(), undefined); assert.ok(f.visible().includes(label(f, "output_target_source_refresh_done")));
  f.noAuthoring();
});

for (const blockId of ["", "image-assignment"]) test("retained stale Output " + (blockId || "whole Document") + " keeps its full card and exposes exact recovery", async t => {
  const f = await sourceFixture(t, { retained: true, blockId });
  const card = [...f.renderer.instances.values()].map(row => row.instance).find(instance => instance instanceof FormaOutputRequirementCard);
  assert.ok(card, "Complete registered card remains rendered"); assert.equal(card.resourceState, "unavailable");
  assert.ok(card.markup.includes(f.i18n.t("output.requirement.unavailable")), "Retained draft remains explicitly unavailable until refreshed");
  const original = f.store.outputRequirements.resource(workers.doc).snapshot.requirements;
  await f.refresh(); await f.flush();
  assert.deepEqual(f.store.outputRequirements.resource(workers.doc).snapshot.requirements, original);
  assert.ok(f.renderer.markup.includes("forma-output-requirement-card")); f.noAuthoring();
});

for (const locale of ["en", "fr", "ar", "ja"]) test("cookie-free owned migrated scope " + locale + " gives an explicit shared-project selector handoff, never guesses a project", async t => {
  const f = await sourceFixture(t, { selected: false, locale }), link = f.projects();
  assert.equal(f.control(), undefined); assert.ok(link); assert.equal(link.attributes.href, "/settings/workspaces");
  assert.ok(f.visible().includes(label(f, "output_target_source_refresh_needs_project")));
  assert.notEqual(label(f, "output_target_source_refresh_needs_project"), label(f, originStale));
  let prevented = false; link.handlers.click.call(f.controller, { preventDefault() { prevented = true; } });
  assert.equal(prevented, false, "Native link can open the existing shared-project selector");
  assert.equal(f.newRequests().length, 0); assert.equal(cursor(f.db), f.indexed);
  const ordinary = await f.storeHost.worker.request("/api/events?after=0&limit=2000&content=0"); assert.equal(ordinary.status, 200);
  assert.equal(cursor(f.db), f.indexed, "Cookie-free ordinary events are not a project-index repair");
  f.store.route.set("/library");
  link.handlers.click.call(f.controller, { preventDefault() { prevented = true; } });
  assert.equal(prevented, true, "Old handoff cannot navigate from a changed view");
  assert.equal(f.newRequests().length, 0); f.noAuthoring();
});

test("actual viewer project permission can refresh source reads without offering authoring", async t => {
  const f = await sourceFixture(t, { reviewer: true });
  assert.ok(f.store.session.get().projectContext.permissions.includes("project.read"));
  assert.equal(f.store.session.get().projectContext.permissions.includes("project.author"), false);
  await f.refresh(); await f.flush();
  const snapshot = f.store.outputRequirements.resource(workers.doc).snapshot;
  assert.equal(snapshot.permissions.canAuthor, false);
  const card = [...f.renderer.instances.values()].map(row => row.instance).find(instance => instance instanceof FormaOutputRequirementCard);
  assert.ok(card); assert.equal(card.snapshot.canEdit, false);
  assert.equal(f.renderer.ownNodes(card, "button").some(button => button.attributes["data-output-edit"] !== undefined), false);
  f.noAuthoring();
});

const changeScope = (f, kind) => {
  const session = f.store.session.get();
  if (kind === "route") f.store.route.set("/library");
  else if (kind === "document") f.documentId = "another-document";
  else if (kind === "current-document") f.store.route.set("/studio?document=another-document");
  else if (kind === "actor") f.store.session.set({ ...session, user: { ...session.user, userId: "another-actor" } });
  else if (kind === "permission-epoch") f.store.session.set({ ...session, permissionEpoch: session.permissionEpoch + "-new" });
  else if (kind === "read-permission") f.store.session.set({ ...session, projectContext: { ...session.projectContext, permissions: [] } });
  else if (kind === "project") f.store.session.set({ ...session, projectContext: { ...session.projectContext, projectId: "another-project" } });
  else if (kind === "selected-context") f.store.session.set({ ...session, projectContext: null });
  else if (kind === "removed-document") {
    const prior = f.store.events.get(); f.store.events.set(prior.filter(event => event.payload.document_id !== workers.doc)); f.initialEvents = f.store.events.get();
  } else if (kind === "disconnected") { f.controller.isConnected = false; f.controller.disconnectedCallback(); }
  else assert.fail("Unknown stale scope " + kind);
};
for (const kind of ["route", "document", "current-document", "actor", "permission-epoch", "read-permission", "project", "selected-context", "removed-document", "disconnected"]) {
  test("source refresh captured control is inert after " + kind, async t => {
    const f = await sourceFixture(t), old = f.control(), requestCount = f.newRequests().length;
    changeScope(f, kind);
    if (kind === "document") f.controller.documentId = f.documentId;
    await old.handlers.click.call(f.controller);
    assert.equal(f.newRequests().length, requestCount); assert.equal(cursor(f.db), f.indexed);
    assert.deepEqual(authoredState(f.db), f.before);
  });
}
for (const kind of ["route", "document", "actor", "read-permission", "project", "selected-context", "disconnected"]) {
  test("late project-source headers cannot refresh or announce into " + kind, async t => {
    const f = await sourceFixture(t), gate = sceneDeferred();
    f.storeHost.intercept = request => sourcePath(request) ? gate.promise : undefined;
    const pending = f.refresh(); await untilScene(() => f.newRequests().some(sourcePath));
    changeScope(f, kind);
    if (kind === "document") f.controller.documentId = f.documentId;
    gate.resolve(Response.json({ events: [], head: 0 }));
    await pending;
    assert.equal(f.newRequests().filter(outputPath).length, 0); assert.equal(cursor(f.db), f.indexed);
    assert.equal(f.controller.markup.includes(label(f, "output_target_source_refresh_done")), false);
    assert.deepEqual(authoredState(f.db), f.before);
  });
}

test("duplicate clicks use one source read and the busy control cannot repeat it", async t => {
  const f = await sourceFixture(t), gate = sceneDeferred(), original = f.control();
  f.storeHost.intercept = async request => sourcePath(request) ? (await gate.promise, f.storeHost.worker.request(request.url, request.init)) : undefined;
  const first = original.handlers.click.call(f.controller), second = original.handlers.click.call(f.controller);
  await untilScene(() => f.newRequests().some(sourcePath)); f.draw();
  assert.ok(Object.hasOwn(f.control().attributes, "disabled")); assert.equal(f.newRequests().filter(sourcePath).length, 1);
  gate.resolve(); await Promise.all([first, second]); await f.flush();
  assert.equal(f.store.outputRequirements.resource(workers.doc).state, "ready"); f.noAuthoring();
});

for (const status of [401, 403, 404, 410]) test("source refresh " + status + " headers withdraw private Output details before reading any body", async t => {
  const f = await sourceFixture(t, { retained: true }); let bodyReads = 0;
  f.storeHost.intercept = request => sourcePath(request) ? { status, ok: false, json() { bodyReads++; assert.fail("Denied source bodies cannot be consumed"); } } : undefined;
  await f.refresh(); await f.flush();
  const resource = f.store.outputRequirements.resource(workers.doc);
  assert.equal(resource.snapshot, null); assert.equal(resource.privateUnavailable, true); assert.equal(resource.accessLost, status !== 410);
  assert.ok(resource.privateRevision > 0); assert.equal(bodyReads, 0); assert.equal(f.newRequests().filter(outputPath).length, 0);
  assert.equal(f.control(), undefined); assert.equal(f.renderer.markup.includes("Exact authorized Document"), false);
  f.noAuthoring();
});

for (const kind of ["quarantine", "owner-revoked", "context-revoked"]) test("actual SQLite " + kind + " refuses source recovery and keeps the cursor unchanged", async t => {
  const f = await sourceFixture(t, { retained: true });
  if (kind === "quarantine") f.db.sqlite.prepare("UPDATE project_migration_states SET status='disabled' WHERE project_access_id=?").run(f.db.projectAccessId);
  if (kind === "owner-revoked") f.db.sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id=?").run(new Date().toISOString(), f.db.organizationId, workers.owner);
  if (kind === "context-revoked") f.db.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE principal_user_id=?").run(new Date().toISOString(), workers.owner);
  await f.refresh(); await f.flush();
  assert.equal(f.store.outputRequirements.resource(workers.doc).snapshot, null);
  assert.equal(f.store.outputRequirements.resource(workers.doc).privateUnavailable, true);
  assert.equal(f.newRequests().filter(outputPath).length, 0); assert.equal(cursor(f.db), f.indexed);
  if (kind === "quarantine") assert.equal(f.db.sqlite.prepare("SELECT status FROM project_migration_states WHERE project_access_id=?").get(f.db.projectAccessId).status, "disabled");
  f.noAuthoring();
});

for (const status of [200, 403, 410]) test("a newer owned Output read wins over delayed source status " + status, async t => {
  const f = await sourceFixture(t, { retained: true }), gate = sceneDeferred();
  f.storeHost.intercept = request => sourcePath(request) ? gate.promise : undefined;
  const pending = f.refresh(); await untilScene(() => f.newRequests().some(sourcePath));
  await f.db.refresh(); // Another currently authorized tab's existing source refresh.
  const newer = await f.store.outputRequirements.ensure(workers.doc, { force: true }); assert.equal(newer.state, "ready");
  gate.resolve(Response.json(status === 200 ? { events: [], head: 0 } : { private: "must-not-be-consumed" }, { status }));
  await pending; await f.flush();
  assert.equal(f.store.outputRequirements.resource(workers.doc), newer);
  assert.equal(f.newRequests().filter(outputPath).length, 1, "Only the explicitly newer read ran");
  assert.equal(f.visible().includes(label(f, "output_target_source_refresh_done")), false); f.noAuthoring();
});

test("failed source transport remains explicit and retry does not create work", async t => {
  const f = await sourceFixture(t); f.storeHost.intercept = request => sourcePath(request) ? Promise.reject(new Error("raw-private-transport")) : undefined;
  await f.refresh(); await f.flush();
  assert.ok(f.visible().includes(label(f, "output_target_source_refresh_failed"))); assert.equal(f.visible().includes("raw-private-transport"), false);
  assert.ok(f.control()); assert.equal(Object.hasOwn(f.control().attributes, "disabled"), false);
  f.storeHost.intercept = null; await f.refresh(); await f.flush();
  assert.equal(f.store.outputRequirements.resource(workers.doc).state, "ready"); f.noAuthoring();
});

test("a captured source control stays retired after route away-and-back or a disconnect/reconnect", async t => {
  const f = await sourceFixture(t), old = f.control(), route = f.store.route.get();
  f.store.route.set("/library"); f.draw(); f.store.route.set(route); f.draw();
  await old.handlers.click.call(f.controller); assert.equal(f.newRequests().length, 0);
  const fresh = f.control(); f.controller.isConnected = false; f.controller.disconnectedCallback();
  f.controller.isConnected = true; f.controller.connectedCallback(); f.draw();
  await fresh.handlers.click.call(f.controller); assert.equal(f.newRequests().length, 0);
  await f.refresh(); await f.flush(); assert.equal(f.store.outputRequirements.resource(workers.doc).state, "ready"); f.noAuthoring();
});

test("source refresh cancels an unread event body and does not hydrate it", async t => {
  const f = await sourceFixture(t); let canceled = 0, parsed = 0;
  f.storeHost.intercept = async request => {
    if (!sourcePath(request)) return undefined;
    const actual = await f.storeHost.worker.request(request.url, request.init);
    assert.equal(actual.status, 200); await actual.body.cancel();
    const response = new Response(new ReadableStream({ cancel() { canceled++; } }), { status: 200 });
    response.json = () => { parsed++; assert.fail("No event payload is parsed or hydrated by source-index recovery"); };
    return response;
  };
  await f.refresh(); await f.flush();
  assert.equal(canceled, 1); assert.equal(parsed, 0); assert.equal(f.store.outputRequirements.resource(workers.doc).state, "ready");
  f.noAuthoring();
});

for (const locale of ["en", "fr", "ar", "ja"]) test("licensed origin " + locale + " stays a separate source warning and is never silently refreshed", async t => {
  noProviders(t);
  const state = await sameOwnerPublishedFixture(), spec = parseOutputRequirement({ id: "current-output", Type: "Output", Subtype: "Social media image", Content: 'One image at aspect ratio "1:1".' }).spec;
  await workers.appendEvents(state.env, [
    workers.makeEvent("creative:" + workers.owner, 0, "user:" + workers.owner, "fixture", "current-output", "BlockCreated", {
      project_id: state.targetProject, document_id: state.documentId, block_id: spec.id, type: "output", scope: "document", position: "z",
      properties: { text: spec.original_text, output_spec: spec } }),
    workers.makeEvent("creative:" + workers.owner, 0, "user:" + workers.owner, "fixture", "foreign-source-change", "BlockPropertyEdited", {
      project_id: state.sourceProject, document_id: state.sourceDocument, block_id: state.sourceBlock, property_path: "text", new_value: "FOREIGN PRIVATE SOURCE CHANGE MUST NOT BECOME A REFRESH LABEL" }),
  ]);
  const worker = { ...state, projectId: state.targetProject, requestId: "unused", payload: { workflowSources: [] },
    async request(input, init = {}) {
      const request = new Request("http://localhost" + input, { ...init, headers: { ...state.headers, ...init.headers } }), url = new URL(request.url);
      assert.equal(request.method, "GET");
      if (url.pathname === "/api/session") return handleSession(request, state.env);
      if (url.pathname === "/api/events") return workers.handleEvents(request, state.env);
      if (url.pathname === "/api/output-requirements") return workers.handleOutputRequirements(request, state.env, url.pathname, { waitUntil() { assert.fail("No background work"); } });
      assert.fail("Origin or other project endpoints cannot be requested " + url.pathname);
    },
  };
  const storeHost = await createSceneStoreHost({ workerFixture: worker }); t.after(() => storeHost.close());
  const resource = await storeHost.store.outputRequirements.ensure(state.documentId);
  assert.equal(resource.state, "ready");
  assert.equal(resource.snapshot.sourceVerification.status, "unavailable");
  assert.ok(resource.snapshot.sourceVerification.reasonCodes.includes(originStale));
  assert.equal(resource.snapshot.sourceVerification.reasonCodes.includes(targetStale), false);
  const f = mountSourceController(t, storeHost, state.documentId, { locale });
  assert.equal(f.control(), undefined); assert.equal(f.projects(), undefined);
  assert.ok(f.visible().includes(label(f, originStale))); assert.equal(f.visible().includes(label(f, targetStale)), false);
  assert.doesNotMatch(f.visible(), /FOREIGN PRIVATE|published-source-document|published-source-project/u);
  const before = authoredState(state), index = state.sourceCursor(), start = storeHost.requests.length, events = storeHost.store.events.get();
  const refresh = f.renderer.ownNodes(f.controller, "button").find(button => button.attributes.class === "button ghost compact" && button.handlers.click);
  assert.ok(refresh, "The ordinary Output refresh remains available"); await refresh.handlers.click.call(f.controller); await f.flush();
  assert.deepEqual(storeHost.requests.slice(start).map(request => request.url.split("?")[0]), ["/api/output-requirements"]);
  assert.deepEqual(state.sourceCursor(), index, "The foreign origin cursor is unchanged");
  assert.deepEqual(authoredState(state), before); assert.equal(storeHost.store.events.get(), events);
  assert.ok(f.visible().includes(label(f, originStale)));
});

test("a newer Output read also owns the result after source headers have already refreshed the index", async t => {
  const f = await sourceFixture(t, { retained: true }), body = sceneDeferred(); let held = false;
  f.storeHost.intercept = async request => {
    if (!outputPath(request) || held) return undefined;
    held = true; const response = await f.storeHost.worker.request(request.url, request.init);
    const value = await response.json(); return { ok: response.ok, status: response.status, json: () => body.promise.then(() => value) };
  };
  const pending = f.refresh(); await untilScene(() => held);
  const newer = await f.store.outputRequirements.ensure(workers.doc, { force: true }); assert.equal(newer.state, "ready");
  body.resolve(); await pending; await f.flush();
  assert.equal(f.store.outputRequirements.resource(workers.doc), newer);
  assert.equal(f.visible().includes(label(f, "output_target_source_refresh_done")), false); f.noAuthoring();
});

test("scope loss while the final Output body waits cannot announce or adopt into another authority", async t => {
  const f = await sourceFixture(t, { retained: true }), body = sceneDeferred(); let held = false;
  f.storeHost.intercept = async request => {
    if (!outputPath(request)) return undefined;
    const response = await f.storeHost.worker.request(request.url, request.init), value = await response.json(); held = true;
    return { ok: response.ok, status: response.status, json: () => body.promise.then(() => value) };
  };
  const pending = f.refresh(); await untilScene(() => held); changeScope(f, "actor");
  const nextScope = f.store.outputRequirements.resource(workers.doc); assert.equal(nextScope.snapshot, null);
  body.resolve(); await pending;
  assert.equal(f.store.outputRequirements.resource(workers.doc).snapshot, null);
  assert.equal(f.controller.markup.includes(label(f, "output_target_source_refresh_done")), false); f.noAuthoring();
});

for (const kind of ["route", "document", "disconnected"]) for (const status of [403, 410]) test("same-authority denial " + status + " retires its original private cache after " + kind + " movement", async t => {
  const f = await sourceFixture(t, { retained: true }), gate = sceneDeferred();
  f.storeHost.intercept = request => sourcePath(request) ? gate.promise : undefined;
  const pending = f.refresh(); await untilScene(() => f.newRequests().some(sourcePath));
  changeScope(f, kind); if (kind === "document") f.controller.documentId = f.documentId;
  gate.resolve({ status, ok: false, json() { assert.fail("No denied private body"); } });
  await pending;
  const original = f.store.outputRequirements.resource(workers.doc);
  assert.equal(original.snapshot, null); assert.equal(original.privateUnavailable, true); assert.equal(original.accessLost, status === 403);
  assert.equal(f.newRequests().filter(outputPath).length, 0); assert.equal(f.controller.markup.includes(label(f, "output_target_source_refresh_done")), false);
  f.noAuthoring();
});

test("actual Store notification reentry cannot duplicate the source-owned Output reload", async t => {
  const f = await sourceFixture(t), unsubscribe = f.store.subscribe(() => f.draw()); t.after(unsubscribe);
  await f.refresh(); await f.flush();
  assert.equal(f.newRequests().filter(sourcePath).length, 1);
  assert.equal(f.newRequests().filter(outputPath).length, 1, "Controller updated() does not compete with the explicit refresh owner");
  assert.equal(f.store.outputRequirements.resource(workers.doc).state, "ready");
  assert.ok(f.visible().includes(label(f, "output_target_source_refresh_done"))); f.noAuthoring();
});
