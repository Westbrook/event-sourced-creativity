import assert from "node:assert/strict";
import fs from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const sha=value=>createHash("sha256").update(value).digest("hex");
const originalFetch=globalThis.fetch;let external=0;
globalThis.fetch=async()=>{external++;throw Error("No external/provider transport exists in these regressions");};
const { createSceneCostFixture, sceneCostFixtureProof } = await import("file://" + ROOT + "tests/helpers/scene-cost-fixture.mjs");
const { createSceneStoreHost, sceneDeferred } = await import("file://" + ROOT + "tests/helpers/scene-cost-store-host.mjs");
const { createCalmFullPage, calmFullPageNativePorts } = await import("file://" + ROOT + "tests/helpers/calm-full-page-fixture.mjs");
const { appendAuditEvent, readWorkspaceEvents } = await import("file://" + ROOT + "worker/runtime.ts");
const { storePrivateContent } = await import("file://" + ROOT + "worker/pilot-policy.ts");
const { financial } = await import("file://" + ROOT + "tests/helpers/event-source-retirement-fixture.mjs");
const { artifactFocusOptionsFromRoute, libraryFocusFromRoute, projectTaskDocumentIdFromRoute } = await import("file://" + ROOT + "src/model/routes.ts");

const pause = () => new Promise(setImmediate);
const json = body => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function responseBody(response, status = 200) {
  const text = await response.clone().text();
  assert.equal(response.status, status, text);
  return response.json();
}
const frames = h => [...h.timers].filter(([, timer]) => timer.delay === 16);
async function flushStoreFrames(h) {
  // Invoke only genuine pending RAF callbacks, not source/private methods.
  for (const [id, timer] of frames(h)) { h.timers.delete(id); timer.callback(0); }
  await pause();
}
const sourceRows = async w => (await readWorkspaceEvents(w.env, w.streamId))
  .filter(row => !["DocumentOpened", "ProjectOpened"].includes(row.type));

async function assignmentPage(t, entry, settings = {}) {
  assert.equal(typeof (settings.projectAuthor ?? false), "boolean", "Project author membership is an explicit false-default fixture option");
  const organizationRole = settings.organizationRole ?? "member";
  assert.ok(["member", "administrator"].includes(organizationRole), "Only an explicit finite organization role is varied");
  const w = await createSceneCostFixture(1, "visual", { shared: true, depth: true });
  const share = w.sharing, reviewer = "assigned-reviewer";
  const identity = { "oai-authenticated-user-id": reviewer, "oai-authenticated-user-email": "assigned-reviewer@example.invalid" };
  const now = new Date().toISOString();
  // Reuse the normal synthetic membership shape from the existing navigation
  // fixture. Permissions/session/task responses below all come from the Worker.
  w.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(reviewer, identity["oai-authenticated-user-email"], "Assigned reviewer", now, now, now);
  w.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,?,'active',?,?,?,?)")
    .run("assigned-reviewer-org", share.organizationId, reviewer, organizationRole, w.owner, now, now, now);
  w.sqlite.prepare("INSERT INTO project_memberships(membership_id,organization_id,project_access_id,project_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',?,?,?)")
    .run("assigned-reviewer-project", share.organizationId, share.projectAccessId, w.projectId, reviewer, settings.projectAuthor ? "editor" : "viewer", w.owner, now, now);
  const memberPath = "/api/workspaces/" + share.organizationId + "/projects/" + share.projectAccessId + "/members/assigned-reviewer-project";
  await responseBody(await w.request(memberPath, { ...json({ reviewAccess: true }), method: "PATCH" }));

  const targetDocument = "assigned-document-b", artifactId = "assigned-result-b", targetBlock = "assigned-source-b";
  await appendAuditEvent(w.env, w.streamId, "user:" + w.owner, "DocumentCreated", { project_id: w.projectId, document_id: targetDocument, title: "Target B Document" });
  await appendAuditEvent(w.env, w.streamId, "user:" + w.owner, "BlockCreated", { project_id: w.projectId, document_id: targetDocument, block_id: targetBlock, type: "direction", handle: "direction/assigned-b", position: "a", properties: { text: "Exact target B source.", weight: 1 } });
  const content = JSON.stringify({ title: "Target B result", summary: "Exact B", content_markdown: "EXACT_ASSIGNED_B_BODY", presentation: null, items: [{ id: "assigned-b-part", title: "Target B result", body: "EXACT_ASSIGNED_B_BODY", notes: "" }] });
  const hash = sha(content), stored = await storePrivateContent(w.env, w.owner, "document-artifact", content);
  const scope = { project_id: w.projectId, document_id: targetDocument, artifact_id: artifactId, artifact_kind: "short_story", source_block_versions: [{ block_id: targetBlock, version: 1 }] };
  await appendAuditEvent(w.env, w.streamId, "user:" + w.owner, "DocumentRenderRequested", scope);
  await appendAuditEvent(w.env, w.streamId, "worker:renderer", "DocumentRenderCompleted", { ...scope, title: "Target B result", summary: "Exact B", content_ref: stored.contentId, item_count: 1, requested_by_user_id: w.owner });
  await appendAuditEvent(w.env, w.streamId, "user:" + w.owner, "DocumentOpened", { project_id: w.projectId, document_id: w.documentId, title: "Original A Document" });
  await responseBody(await w.request("/api/events?after=0&limit=2000&content=0"));
  const reviewPayload = { ...scope, artifact_revision: 0, content_sha256: hash, assigned_reviewer_user_id: reviewer };
  await responseBody(await w.request("/api/events", json({ action: "append", event: { type: "ArtifactReviewRequested", payload: reviewPayload } })));


  // Second assignment is authored through the same real APIs before the
  // fixture's source/accounting baselines. No fake inbox task is injected.
  const secondArtifactId = "assigned-result-c";
  const secondContent = JSON.stringify({ title: "Target C result", summary: "Exact C",
    content_markdown: "EXACT_ASSIGNED_C_BODY", presentation: null,
    items: [{ id: "assigned-c-part", title: "Target C result", body: "EXACT_ASSIGNED_C_BODY", notes: "" }] });
  const secondHash = sha(secondContent);
  const secondStored = await storePrivateContent(w.env, w.owner, "document-artifact", secondContent);

  let secondScope = { ...scope, artifact_id: secondArtifactId }, secondOwnerHeaders = share.headers;
  if (settings.differentTargets) {
    const secondProjectId = "assigned-shared-project-c", secondDocumentId = "assigned-document-c", secondBlockId = "assigned-source-c";
    w.setScopedHeaders({});
    await appendAuditEvent(w.env, w.streamId, "user:" + w.owner, "ProjectCreated", { project_id: secondProjectId, name: "Assigned Project C" });
    await appendAuditEvent(w.env, w.streamId, "user:" + w.owner, "DocumentCreated", { project_id: secondProjectId, document_id: secondDocumentId, title: "Target C Document" });
    await appendAuditEvent(w.env, w.streamId, "user:" + w.owner, "BlockCreated", { project_id: secondProjectId, document_id: secondDocumentId,
      block_id: secondBlockId, type: "direction", handle: "direction/assigned-c", position: "a", properties: { text: "Exact target C source.", weight: 1 } });
    const attached = await responseBody(await w.request("/api/workspaces/" + share.organizationId + "/projects", json({ projectId: secondProjectId })), 201);
    const secondAccessId = attached.projectAccessId;
    const selected = await w.request("/api/workspaces/" + share.organizationId + "/projects/" + secondAccessId + "/context", { method: "POST" });
    await responseBody(selected);
    secondOwnerHeaders = { cookie: selected.headers.get("set-cookie").split(";")[0] };
    w.setScopedHeaders(secondOwnerHeaders);
    w.sqlite.prepare("INSERT INTO project_memberships(membership_id,organization_id,project_access_id,project_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'viewer','active',?,?,?)")
      .run("assigned-reviewer-second-project", share.organizationId, secondAccessId, secondProjectId, reviewer, w.owner, now, now);
    await responseBody(await w.request("/api/workspaces/" + share.organizationId + "/projects/" + secondAccessId + "/members/assigned-reviewer-second-project",
      { ...json({ reviewAccess: true }), method: "PATCH" }));
    secondScope = { ...secondScope, project_id: secondProjectId, document_id: secondDocumentId, source_block_versions: [{ block_id: secondBlockId, version: 1 }] };
  }

  await appendAuditEvent(w.env, w.streamId, "user:" + w.owner, "DocumentRenderRequested", secondScope);
  await appendAuditEvent(w.env, w.streamId, "worker:renderer", "DocumentRenderCompleted", {
    ...secondScope, title: "Target C result", summary: "Exact C", content_ref: secondStored.contentId,
    item_count: 1, requested_by_user_id: w.owner });
  await responseBody(await w.request("/api/events?after=0&limit=2000&content=0"));
  await responseBody(await w.request("/api/events", json({ action: "append", event: {
    type: "ArtifactReviewRequested", payload: { ...secondScope, artifact_revision: 0,
      content_sha256: secondHash, assigned_reviewer_user_id: reviewer } } })));

  w.setScopedHeaders({});
  const restoredOwner = await w.request("/api/workspaces/" + share.organizationId + "/projects/" + share.projectAccessId + "/context", { method: "POST" });
  await responseBody(restoredOwner);
  share.headers = { cookie: restoredOwner.headers.get("set-cookie").split(";")[0] };
  w.setScopedHeaders(share.headers);
  const thirdArtifactId = "assigned-result-d";
  const thirdContent = JSON.stringify({ title: "Target D result", summary: "Exact D", content_markdown: "EXACT_ASSIGNED_D_BODY",
    presentation: null, items: [{ id: "assigned-d-part", title: "Target D result", body: "EXACT_ASSIGNED_D_BODY", notes: "" }] });
  const thirdHash = sha(thirdContent), thirdStored = await storePrivateContent(w.env, w.owner, "document-artifact", thirdContent);
  const thirdScope = { ...scope, artifact_id: thirdArtifactId };
  await appendAuditEvent(w.env, w.streamId, "user:" + w.owner, "DocumentRenderRequested", thirdScope);
  await appendAuditEvent(w.env, w.streamId, "worker:renderer", "DocumentRenderCompleted", {
    ...thirdScope, title: "Target D result", summary: "Exact D", content_ref: thirdStored.contentId, item_count: 1, requested_by_user_id: w.owner });
  await responseBody(await w.request("/api/events?after=0&limit=2000&content=0"));
  await responseBody(await w.request("/api/events", json({ action: "append", event: { type: "ArtifactReviewRequested",
    payload: { ...thirdScope, artifact_revision: 0, content_sha256: thirdHash, assigned_reviewer_user_id: reviewer } } })));
  let activeIdentity = { ...identity }, browserHeaders = { ...identity };

  w.setScopedHeaders(browserHeaders);
  let entryDocument = entry === "same-document" ? targetDocument : w.documentId, entryProject = w.projectId;
  if (entry === "cross-project" || settings.personalSource) {
    await responseBody(await w.request("/api/events?after=0&limit=2000&content=0"));
    const selectedEntry = { entryProject, entryDocument };
    entryProject = "assigned-personal-project-a"; entryDocument = "assigned-personal-document-a";
    await appendAuditEvent(w.env, "creative:" + reviewer, "user:" + reviewer, "ProjectCreated", { project_id: entryProject, name: "Personal Project A" });
    await appendAuditEvent(w.env, "creative:" + reviewer, "user:" + reviewer, "DocumentCreated", { project_id: entryProject, document_id: entryDocument, title: "Personal A Document" });
    await appendAuditEvent(w.env, "creative:" + reviewer, "user:" + reviewer, "BlockCreated", { project_id: entryProject, document_id: entryDocument, block_id: "personal-source-a", type: "direction", handle: "direction/personal-a", position: "a", properties: { text: "Personal A current source.", weight: 1 } });
    if (entry !== "cross-project") { entryProject = selectedEntry.entryProject; entryDocument = selectedEntry.entryDocument; }
  }
  const contextPath = "/api/workspaces/" + share.organizationId + "/projects/" + share.projectAccessId + "/context";
  const selected = await w.request(contextPath, { method: "POST" });
  await responseBody(selected);
  browserHeaders.cookie = selected.headers.get("set-cookie").split(";")[0]; w.setScopedHeaders(browserHeaders);

  const startingDocument = entry === "cross-project" ? w.documentId : entryDocument;
  const h = await createSceneStoreHost({ workerFixture: { ...w, documentId: startingDocument } });
  // The existing selected-context Worker session initializes an eligible
  // administrator's tenant counters before the unchanged beforeMoney snapshot.
  // No extra read, counter seed, late snapshot or fiscal exemption is added.
  if (organizationRole === "administrator") assert.equal(h.store.session.get().organizations
    .find(organization => organization.organizationId === share.organizationId)?.role, organizationRole);
  // Complete native Location/History ports; production load uses location.href
  // for performance resource lookup. No load/route implementation is replaced.
  Object.defineProperty(h.location, "href", { get() { return this.origin + this.pathname + this.search + this.hash; } });
  const previousHistory = globalThis.history;
  globalThis.history = {
    pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash }); },
    replaceState(...args) { this.pushState(...args); },
  };
  const inflight = new Set();
  const receive = response => {
    const cookie = response.headers.get("set-cookie");
    if (cookie) {
      browserHeaders = /;\s*max-age=0(?:;|$)/iu.test(cookie) ? { ...activeIdentity } : { ...activeIdentity, cookie: cookie.split(";")[0] };
      w.setScopedHeaders(browserHeaders);
    }
    return response;
  };
  const serverRequest = request => w.request(request.url, request.init);
  const nativeRequest = async request => receive(await serverRequest(request));
  h.transport = request => {
    const pending = nativeRequest(request); inflight.add(pending);
    void pending.then(() => inflight.delete(pending), () => inflight.delete(pending));
    return pending;
  };
  const events = h.store.events.get(), head = h.store.head.get(), privateContent = h.store.content.get(), session = h.store.session.get();
  // The stock full-page helper temporarily mounts its 14-block synthetic sample.
  // Restore only actual Worker records/session before any tested navigation.
  // Its close port is deferred until all fiscal assertions have executed.
  const f = await createCalmFullPage(t, { storeHost: { ...h, close() {} } });
  const viewerCalls = [], Viewer = f.modules.get("src/components/document-artifacts.ts").DocumentArtifacts;
  const nativeIds = new WeakMap(); let nativeSequence = 0, drawDepth = 0;
  const nativeId = value => {
    if (!value || typeof value !== "object") return null;
    if (!nativeIds.has(value)) nativeIds.set(value, ++nativeSequence);
    return nativeIds.get(value);
  };
  if (settings.observeViewerOpening) {
    const draw = f.renderer.draw;
    f.renderer.draw = function (...args) { drawDepth++; try { return draw.apply(this, args); } finally { drawDepth--; } };
  }
  const originalOpen = Viewer.prototype.openArtifactById;
  t.mock.method(Viewer.prototype, "openArtifactById", function (id, options) {
    // Observe the real caller's public viewer promise; do not invoke it ourselves.
    const call = { id, options, owner: this }; viewerCalls.push(call);
    const capturedArtifact = h.store.projection.get().libraryArtifacts.find(row => row.id === id);
    const retainedEvidence = reference => {
      const value = typeof reference === "string" ? h.store.content.get()[reference] : undefined;
      return { reference: reference ?? null, present: typeof value === "string",
        sha256: typeof value === "string" ? sha(value) : null };
    };
    const snapshot = () => ({ drawDepth, updatingOwner: f.renderer.updatingOwner?.tag ?? null,
      viewer: nativeId(this), viewerConnected: this.isConnected, viewerDocumentId: this.documentId,
      parent: nativeId(this.parentElement), parentTag: this.parentElement?.tag ?? null,
      projectionDocumentId: h.store.projection.get().documentId,
      capturedBinding: retainedEvidence(capturedArtifact?.contentRef),
      currentBinding: retainedEvidence(h.store.projection.get().libraryArtifacts.find(row => row.id === id)?.contentRef),
      // The independently created fixture ref is observed, never supplied to the application.
      originalFixtureBinding: id === artifactId ? retainedEvidence(stored.contentId) : null,
      eventReads: h.requests.filter(row => row.url.startsWith("/api/events?")).slice(-8).map(row => row.url),
      viewers: [...f.renderer.instances].filter(([, row]) => row.instance.tag === "forma-document-artifacts").map(([key, row]) => ({
        id: nativeId(row.instance), parent: nativeId(row.instance.parentElement), connected: row.instance.isConnected,
        seen: f.renderer.seen.has(key), documentId: row.instance.documentId, isCaller: row.instance === this })),
      currentDialogs: f.renderer.nodes.filter(node => node.owner === this && node.tag === "dialog").map(node => ({
        id: nativeId(node), className: node.attributes.class ?? "", open: node.open, connected: node.isConnected })),
      previousDialogs: (f.renderer.previousNodes ?? []).filter(node => node.owner === this && node.tag === "dialog").map(node => ({
        id: nativeId(node), className: node.attributes.class ?? "", open: node.open, connected: node.isConnected })),
    });
    const observed = settings.observeViewerOpening && typeof options?.current === "function";
    const guards = [], watched = observed ? { ...options, current: (...args) => {
      // Exactly one call to the original predicate, preserving its result/throw.
      const value = options.current(...args);
      if (guards.length < 24 || value !== true && guards.length < 32) guards.push({ stage: args[0], result: value, ...snapshot() });
      return value;
    } } : options;
    const report = () => { if (settings.observeViewerOpening) t.diagnostic(JSON.stringify({
      diagnostic: "c19-actual-viewer-current", id, expectedRevision: options?.expectedRevision,
      expectedHash: options?.expectedContentSha256, intent: options?.intent, route: h.store.route.get(),
      result: call.result ?? null, error: call.error ?? null, guards, settled: snapshot(),
    })); };
    call.pending = originalOpen.call(this, id, watched);
    void call.pending.then(value => { call.result = value; report(); }, error => { call.error = String(error); report(); });
    return call.pending;
  });
  const definitions = JSON.parse(fs.readFileSync(ROOT + "custom-elements.json", "utf8"));
  const byTag = new Map(definitions.modules.flatMap(module => (module.declarations ?? [])
    .filter(declaration => declaration.tagName).map(declaration => [declaration.tagName, { file: module.path, name: declaration.name }])));
  async function registerNativeDescendants(tag) {
    if (f.renderer.registry[tag]) return;
    const definition = byTag.get(tag); assert.ok(definition, "Actual component " + tag);
    const module = await calmFullPageNativePorts.loadActual(definition.file);
    f.renderer.registry[tag] = module[definition.name];
    for (const child of new Set([...fs.readFileSync(ROOT + definition.file, "utf8")
      .matchAll(/<(forma-[\w-]+)(?=[\s>])/gu)].map(match => match[1]))) await registerNativeDescendants(child);
  }
  // Side-effect component definitions exist before a browser mounts Library.
  // Pre-register the real descendants to prevent the finite renderer from
  // shifting child ordinals and artificially replacing a pending viewer.
  await registerNativeDescendants("forma-library");
  h.store.events.set(events); h.store.head.set(head); h.store.content.set(privateContent); h.store.session.set(session);
  h.store.setRoute("/activity?document=" + startingDocument); h.store.loading.set(false);
  await h.store.syncReviewInbox(); await f.settle();
  let usedViewAll = false;
  if (entry === "cross-project") {
    const all = f.find("button", node => node.owner.tag === "forma-activity" && node.text.includes("View all my assigned reviews"));
    await f.act(all); await h.store.syncReviewInbox(); await f.settle(); usedViewAll = true;
    assert.equal(h.store.session.get().projectContext, undefined);
    assert.equal(projectTaskDocumentIdFromRoute(h.store.route.get()), entryDocument);
    assert.equal(h.store.projection.get().projectId, entryProject);
  }
  const task = h.store.reviewInbox.get().find(row => row.artifactId === artifactId);
  assert.ok(task, "Real current Worker inbox task"); assert.equal(task.documentId, targetDocument); assert.equal(task.contentSha256, hash);

  const secondTask = h.store.reviewInbox.get().find(row => row.artifactId === secondArtifactId);
  assert.ok(secondTask, "Second real current Worker inbox task");
  assert.notEqual(secondTask.id, task.id); assert.equal(secondTask.documentId, secondScope.document_id); assert.equal(secondTask.projectId, secondScope.project_id);
  assert.equal(secondTask.contentSha256, secondHash);
  const thirdTask=h.store.reviewInbox.get().find(row=>row.artifactId===thirdArtifactId);assert.ok(thirdTask);assert.equal(thirdTask.contentSha256,thirdHash);
  const button = (id = artifactId) => f.find("button", node => {
    if (node.owner.tag !== "forma-activity" || !node.text.includes("Open assigned review")) return false;
    let article = node.parent; while (article && article.tag !== "article") article = article.parent;
    return article?.text.includes(id === artifactId ? "Target B result" : id === secondArtifactId ? "Target C result" : "Target D result");
  });
  assert.ok(button().owner.isConnected, "Ordinary currently mounted Activity entry");

  const beforeMoney = financial(w);
  let expectedSource = await sourceRows(w);
  const personalSource = await readWorkspaceEvents(w.env, "creative:" + reviewer);
  const ownerRequest = (url, init) => {
    w.setScopedHeaders(share.headers);
    const pending = w.request(url, init); // Request headers are copied immediately.
    w.setScopedHeaders(browserHeaders);
    return pending;
  };
  const revoke = async () => {
    const before = expectedSource;
    await responseBody(await ownerRequest(memberPath, { method: "DELETE" }));
    expectedSource = await sourceRows(w);
    assert.deepEqual(expectedSource.slice(0, before.length), before);
    assert.equal(expectedSource.length, before.length + 1);
    assert.equal(expectedSource.at(-1).type, "ProjectMembershipRevoked");
    assert.deepEqual(expectedSource.at(-1).payload, { organization_id: share.organizationId,
      resource_id: "assigned-reviewer-project", resource_kind: "membership" }, "Only the explicitly requested native revocation audit is added");
    assert.equal(w.sqlite.prepare("SELECT status FROM project_review_tasks WHERE task_id=?").get(task.id).status, "canceled");
  };
  const supersede = async () => {
    const before = expectedSource;
    await responseBody(await ownerRequest("/api/events", json({ action: "append", event: { type: "ArtifactReviewRequested", payload: reviewPayload } })));
    expectedSource = await sourceRows(w);
    assert.deepEqual(expectedSource.slice(0, before.length), before);
    assert.equal(expectedSource.length, before.length + 1);
    assert.equal(expectedSource.at(-1).type, "ArtifactReviewRequested", "Only the explicitly simulated new assignment is authored");
    assert.equal(w.sqlite.prepare("SELECT status FROM project_review_tasks WHERE task_id=?").get(task.id).status, "superseded");
  };
  t.after(async () => {
    try {
      await Promise.allSettled([...inflight]);
      assert.deepEqual(financial(w), beforeMoney, "All nine job/reservation/counter/operation tables are unchanged");
      assert.deepEqual(await sourceRows(w), expectedSource, "No unrequested source, result, approval or paid event");
      assert.deepEqual(await readWorkspaceEvents(w.env, "creative:" + reviewer), personalSource, "Personal history is unchanged");
      assert.equal(h.requests.filter(row => row.init.method === "POST" && row.url.startsWith("/api/document-jobs")).length, 0);
    } finally { globalThis.history = previousHistory; await h.close(); }
  });
  const activatePrincipal = headers => { activeIdentity = { ...headers }; browserHeaders = { ...activeIdentity }; w.setScopedHeaders(browserHeaders); };
  const expireCookie=()=>{assert.ok(Date.now()>Date.parse(h.store.session.get().projectContext.expiresAt),"The actual issued cookie has expired");browserHeaders={...activeIdentity};w.setScopedHeaders(browserHeaders);};
  return { h, w, f, task, secondTask, thirdTask, button, targetDocument, artifactId, hash, nativeRequest, serverRequest, receive, activatePrincipal, expireCookie, entryDocument, entryProject, viewerCalls, usedViewAll, revoke, supersede };
}
// Only native ports and synthetic pre-baseline fixture records are supplied here.
// Routes, task checks, cookie responses, source retirement and authorization all execute the production code.
export { assignmentPage, sceneDeferred, flushStoreFrames, frames, responseBody, artifactFocusOptionsFromRoute,
  libraryFocusFromRoute, sceneCostFixtureProof, originalFetch };
export const externalCount=()=>external;
