import assert from "node:assert/strict";
import fs from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import test,{after} from "node:test";
const ROOT=fileURLToPath(new URL("../",import.meta.url));
const sha=value=>createHash("sha256").update(value).digest("hex");
const originalFetch=globalThis.fetch;let external=0;
globalThis.fetch=async()=>{external++;throw Error("No external/provider transport exists in these regressions");};
const { createSceneCostFixture, sceneCostFixtureProof } = await import("file://" + ROOT + "tests/helpers/scene-cost-fixture.mjs");
const { createSceneStoreHost, sceneDeferred } = await import("file://" + ROOT + "tests/helpers/scene-cost-store-host.mjs");
const { createCalmFullPage, calmFullPageNativePorts } = await import("file://" + ROOT + "tests/helpers/calm-full-page-fixture.mjs");
const { appendAuditEvent, readWorkspaceEvents } = await import("file://" + ROOT + "worker/runtime.ts");
const { storePrivateContent } = await import("file://" + ROOT + "worker/pilot-policy.ts");
const { financial } = await import("file://" + ROOT + "tests/helpers/event-source-retirement-fixture.mjs");
const { artifactFocusOptionsFromRoute, libraryFocusFromRoute, projectTaskDocumentIdFromRoute, documentIdFromRoute, withDocumentInRoute } = await import("file://" + ROOT + "src/model/routes.ts");
const { creativeCreationHref } = await import("file://" + ROOT + "src/platform/applications.ts");

const observations = [];
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

async function assignmentPage(t, entry) {
  const w = await createSceneCostFixture(1, "visual", { shared: true, depth: true });
  const share = w.sharing, reviewer = "assigned-reviewer";
  const identity = { "oai-authenticated-user-id": reviewer, "oai-authenticated-user-email": "assigned-reviewer@example.invalid" };
  const now = new Date().toISOString();
  // Reuse the normal synthetic membership shape from the existing navigation
  // fixture. Permissions/session/task responses below all come from the Worker.
  w.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(reviewer, identity["oai-authenticated-user-email"], "Assigned reviewer", now, now, now);
  w.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,'member','active',?,?,?,?)")
    .run("assigned-reviewer-org", share.organizationId, reviewer, w.owner, now, now, now);
  w.sqlite.prepare("INSERT INTO project_memberships(membership_id,organization_id,project_access_id,project_id,user_id,role,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'viewer','active',?,?,?)")
    .run("assigned-reviewer-project", share.organizationId, share.projectAccessId, w.projectId, reviewer, w.owner, now, now);
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

  let browserHeaders = { ...identity };
  w.setScopedHeaders(browserHeaders);
  let entryDocument = entry === "same-document" ? targetDocument : w.documentId, entryProject = w.projectId;
  if (entry === "cross-project") {
    await responseBody(await w.request("/api/events?after=0&limit=2000&content=0"));
    entryProject = "assigned-personal-project-a"; entryDocument = "assigned-personal-document-a";
    await appendAuditEvent(w.env, "creative:" + reviewer, "user:" + reviewer, "ProjectCreated", { project_id: entryProject, name: "Personal Project A" });
    await appendAuditEvent(w.env, "creative:" + reviewer, "user:" + reviewer, "DocumentCreated", { project_id: entryProject, document_id: entryDocument, title: "Personal A Document" });
    await appendAuditEvent(w.env, "creative:" + reviewer, "user:" + reviewer, "BlockCreated", { project_id: entryProject, document_id: entryDocument, block_id: "personal-source-a", type: "direction", handle: "direction/personal-a", position: "a", properties: { text: "Personal A current source.", weight: 1 } });
  }
  const contextPath = "/api/workspaces/" + share.organizationId + "/projects/" + share.projectAccessId + "/context";
  const selected = await w.request(contextPath, { method: "POST" });
  await responseBody(selected);
  browserHeaders.cookie = selected.headers.get("set-cookie").split(";")[0]; w.setScopedHeaders(browserHeaders);

  const startingDocument = entry === "cross-project" ? w.documentId : entryDocument;
  const h = await createSceneStoreHost({ workerFixture: { ...w, documentId: startingDocument } });
  // Complete native Location/History ports; production load uses location.href
  // for performance resource lookup. No load/route implementation is replaced.
  Object.defineProperty(h.location, "href", { get() { return this.origin + this.pathname + this.search + this.hash; } });
  const previousHistory = globalThis.history;
  globalThis.history = {
    pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash }); },
    replaceState(...args) { this.pushState(...args); },
  };
  const inflight = new Set();
  const nativeRequest = async request => {
    const response = await w.request(request.url, request.init);
    const cookie = response.headers.get("set-cookie");
    if (cookie) {
      // A real browser removes an expired cookie. Sending an empty signed
      // context cookie would manufacture an unrelated authentication denial.
      browserHeaders = /;\s*max-age=0(?:;|$)/iu.test(cookie) ? { ...identity } : { ...identity, cookie: cookie.split(";")[0] };
      w.setScopedHeaders(browserHeaders);
    }
    return response;
  };
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
  const originalOpen = Viewer.prototype.openArtifactById;
  t.mock.method(Viewer.prototype, "openArtifactById", function (id, options) {
    // Observe the real caller's public viewer promise; do not invoke it ourselves.
    const call = { id, options, owner: this }; viewerCalls.push(call);
    call.pending = originalOpen.call(this, id, options);
    void call.pending.then(value => { call.result = value; }, error => { call.error = String(error); });
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
  const button = () => f.find("button", node => node.owner.tag === "forma-activity" && node.text.includes("Open assigned review"));
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
  return { h, w, f, task, button, targetDocument, artifactId, hash, nativeRequest, entryDocument, entryProject, viewerCalls, usedViewAll, revoke, supersede };
}

function observe(q, details) {
  const { h, f } = q, projection = h.store.projection.get();
  const work = creativeCreationHref(projection, (id, title) => withDocumentInRoute("/", id, title));
  const row = {
    ...details, usedViewAll: q.usedViewAll, taskId: q.task.id, taskDocument: q.task.documentId,
    taskRevision: q.task.revision, taskHash: q.task.contentSha256,
    route: h.store.route.get(), project: projection.projectId, document: projection.documentId, work,
    workDocument: documentIdFromRoute(work), focus: libraryFocusFromRoute(h.store.route.get()),
    options: artifactFocusOptionsFromRoute(h.store.route.get()), error: h.store.error.get(), toast: h.store.ui.toast,
    viewerCalls: q.viewerCalls.map(call => ({ id: call.id, result: call.result ?? null, error: call.error ?? null,
      document: call.owner.documentId, connected: call.owner.isConnected, currentOwner: f.components().includes(call.owner) })),
    viewerComponents: f.components().filter(component => component.tag === "forma-document-artifacts").length,
    viewerBodyPresent: f.tree().root.text.includes("EXACT_ASSIGNED_B_BODY"),
  };
  observations.push(row); console.log("ASSIGNED_OBSERVATION", JSON.stringify(row)); return row;
}
const cases = [
  ...["same-document", "different-document", "cross-project"].flatMap(entry =>
    ["inbox-first", "raf-first"].map(order => ({ name: entry + "/" + order, entry, order }))),
  { name: "denied-current-task", entry: "same-document", negative: "denied" },
  { name: "superseded-current-task", entry: "same-document", negative: "superseded" },
];
const selection = process.argv.find(argument => argument.startsWith("--case="))?.slice("--case=".length);
const selectedCases = cases.filter(item => !selection || item.name.includes(selection));
assert.ok(selectedCases.length, "The requested case exists");
for (const scenario of selectedCases) test("actual assigned review / " + scenario.name, { timeout: 25_000 }, async t => {
  const q = await assignmentPage(t, scenario.entry), { h, f } = q;
  await flushStoreFrames(h); await f.settle();
  const originalRoute = h.store.route.get();
  if (scenario.negative === "denied") await q.revoke();
  if (scenario.negative === "superseded") await q.supersede();

  const entered = sceneDeferred(), release = sceneDeferred(); t.after(() => release.resolve());
  let seen = false;
  if (!scenario.negative) h.intercept = async request => {
    // Automatic inbox reads made by refreshSession are not this barrier. The
    // final ordinary inbox read begins only after real load has scheduled RAF.
    if (seen || request.url !== "/api/workspaces/reviews" || h.store.loading.get()
      || !frames(h).some(([, timer]) => String(timer.callback).includes("ownsLoad"))) return;
    seen = true;
    const response = await q.nativeRequest(request); assert.equal(response.status, 200);
    assert.ok((await response.clone().json()).tasks.some(row => row.id === q.task.id
      && row.documentId === q.task.documentId && row.revision === q.task.revision && row.contentSha256 === q.task.contentSha256),
    "The real final inbox response still contains the exact current task");
    entered.resolve(); await release.promise; return response;
  };
  let pending;
  const original = h.store.openAssignedReview;
  t.mock.method(h.store, "openAssignedReview", function (task) {
    assert.equal(task.id, q.task.id);
    pending = original.call(this, task); return pending; // Pass-through observation only.
  });
  const button = q.button(); assert.ok(button.owner.isConnected);
  const activation = f.act(button); // Actual ordinary connected native click.
  if (!scenario.negative) {
    await entered.promise; assert.ok(pending); assert.equal(h.store.error.get(), "");
    observe(q, { case: scenario.name, stage: "inbox-pending", returned: null });
    if (scenario.order === "raf-first") { await flushStoreFrames(h); await f.settle(); }
    release.resolve();
  }
  await activation; assert.ok(pending); const moved = await pending;
  await flushStoreFrames(h); await f.settle(); await flushStoreFrames(h); await f.settle();
  await Promise.allSettled(q.viewerCalls.map(call => call.pending)); await f.settle();
  const outcome = observe(q, { case: scenario.name, stage: "settled", returned: moved });

  if (scenario.negative) {
    assert.equal(moved, false); assert.equal(outcome.focus, null);
    assert.equal(outcome.route, originalRoute); assert.equal(q.viewerCalls.length, 0);
    return;
  }
  assert.equal(moved, true);
  assert.deepEqual(outcome.focus, { kind: "artifact", id: q.artifactId }, "A truthy assigned-review handoff must retain the exact viewer route");
  assert.deepEqual(outcome.options, { expectedRevision: q.task.revision, expectedContentSha256: q.hash, intent: "review" });
  assert.equal(outcome.project, q.task.projectId);
  // Within one Project, Work may intentionally return to origin A. That alone
  // is NOT classified as a failure. Cross-project Work must name a valid B doc.
  const workDocument = scenario.entry === "cross-project" ? q.targetDocument : q.entryDocument;
  assert.equal(outcome.workDocument, workDocument, "The Work return address is valid in the current scope");
  assert.equal(projectTaskDocumentIdFromRoute(outcome.route), workDocument);
  assert.equal(outcome.error, "");
  assert.equal(outcome.toast, "", "A still-current assigned task must not report that its document is unavailable");
  // Deliberate limit: same-document modal opening is not certified by this
  // native renderer. Its observed false result is retained, not recast as a
  // passing viewer assertion or used to blame the within-project path.
});

async function beginAssignedHandoff(t, entry, { supersededReply = false } = {}) {
  const q = await assignmentPage(t, entry), { h, f } = q;
  await flushStoreFrames(h); await f.settle();
  const entered = sceneDeferred(), release = sceneDeferred();
  t.after(() => release.resolve());
  let seen = false, pending;
  h.intercept = async request => {
    if (seen || request.url !== "/api/workspaces/reviews" || h.store.loading.get()
      || !frames(h).some(([, timer]) => String(timer.callback).includes("ownsLoad"))) return;
    seen = true;
    if (supersededReply) await q.supersede();
    const response = await q.nativeRequest(request); assert.equal(response.status, 200);
    const tasks = (await response.clone().json()).tasks;
    assert.equal(tasks.some(row => row.id === q.task.id && row.documentId === q.task.documentId
      && row.revision === q.task.revision && row.contentSha256 === q.task.contentSha256), !supersededReply,
    "The barrier follows the actual final task read, including its exact supersession");
    entered.resolve(); await release.promise; return response;
  };
  const original = h.store.openAssignedReview;
  t.mock.method(h.store, "openAssignedReview", function (task) {
    assert.equal(task.id, q.task.id); pending = original.call(this, task); return pending;
  });
  const activation = f.act(q.button());
  await entered.promise; assert.ok(pending);
  const syncCalls = [], sync = h.store.syncDocumentFromRoute;
  t.mock.method(h.store, "syncDocumentFromRoute", function (...args) {
    syncCalls.push(args); return sync.apply(this, args);
  });
  await flushStoreFrames(h); await f.settle();
  assert.equal(syncCalls.length, 0, "The actual handoff load's RAF is waiting, not discarded");
  return { ...q, activation, pending, release, syncCalls };
}

test("actual assigned handoff / newer ordinary load does not wait for the older task", { timeout: 25_000 }, async t => {
  const q = await beginAssignedHandoff(t, "same-document"), { h, f } = q;
  const newerRoute = "/activity?document=" + q.w.documentId;
  h.store.setRoute(newerRoute);
  h.store.toast("The newer view owns this notice.");
  await h.store.load(); // Must complete before the old inbox response is released.
  await flushStoreFrames(h); await f.settle();
  assert.equal(h.store.route.get(), newerRoute);
  assert.ok(q.syncCalls.length, "The independent newer load executes normal route synchronization");
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), true);
  q.release.resolve(); await q.activation;
  assert.equal(await q.pending, false);
  await flushStoreFrames(h); await f.settle();
  assert.equal(h.store.route.get(), newerRoute);
  assert.equal(h.store.ui.toast, "The newer view owns this notice.");
  assert.equal(q.viewerCalls.length, 0);
});

test("actual assigned handoff / route ABA does not reauthorize an older task continuation", { timeout: 25_000 }, async t => {
  const q = await beginAssignedHandoff(t, "same-document"), { h, f } = q;
  const originalRoute = h.store.route.get();
  h.store.setRoute("/activity?document=" + q.w.documentId);
  h.store.setRoute(originalRoute);
  h.store.toast("The newer return owns this notice.");
  assert.equal(h.store.route.get(), originalRoute);
  q.release.resolve(); await q.activation;
  assert.equal(await q.pending, false, "The existing navigation revision distinguishes an equal URL from the original intent");
  await flushStoreFrames(h); await f.settle();
  assert.equal(h.store.route.get(), originalRoute);
  assert.equal(h.store.ui.toast, "The newer return owns this notice.");
  assert.equal(q.viewerCalls.length, 0);
});

test("actual assigned handoff / source denial before the delayed inbox never restores private work", { timeout: 25_000 }, async t => {
  const q = await beginAssignedHandoff(t, "same-document"), { h, f } = q;
  const source = h.store.captureSourceOwnership(), route = h.store.route.get();
  await q.revoke();
  await assert.rejects(h.store.refreshEvents(), /403/u);
  assert.equal(h.store.sourceOwnershipActive(source), false);
  assert.equal(h.store.events.get().length, 0); assert.deepEqual(h.store.content.get(), {});
  q.release.resolve(); await q.activation;
  assert.equal(await q.pending, false);
  await flushStoreFrames(h); await f.settle();
  assert.equal(h.store.route.get(), route);
  assert.equal(q.syncCalls.length, 0, "The released old RAF retains its original source fence");
  assert.equal(h.store.events.get().length, 0); assert.deepEqual(h.store.content.get(), {});
  assert.equal(h.store.reviewInbox.get().length, 0);
  assert.equal(q.viewerCalls.length, 0);
});

test("actual assigned handoff / View all supersedes the old scope without waiting for its inbox", { timeout: 25_000 }, async t => {
  const q = await beginAssignedHandoff(t, "cross-project"), { h, f } = q;
  const oldSource = h.store.captureSourceOwnership();
  const all = f.find("button", node => node.owner.tag === "forma-activity" && node.text.includes("View all my assigned reviews"));
  assert.ok(all.owner.isConnected);
  await f.act(all); // A genuine newer DELETE/context refresh/default load.
  await flushStoreFrames(h); await f.settle();
  const route = h.store.route.get();
  assert.equal(h.store.session.get().projectContext, undefined);
  assert.equal(h.store.projection.get().projectId, q.entryProject);
  assert.equal(projectTaskDocumentIdFromRoute(route), q.entryDocument);
  assert.equal(h.store.sourceOwnershipActive(oldSource), false);
  const events = structuredClone(h.store.events.get()), content = structuredClone(h.store.content.get());
  q.release.resolve(); await q.activation;
  assert.equal(await q.pending, false);
  await flushStoreFrames(h); await f.settle();
  assert.equal(h.store.route.get(), route);
  assert.deepEqual(h.store.events.get(), events); assert.deepEqual(h.store.content.get(), content);
  assert.equal(h.store.projection.get().projectId, q.entryProject);
  assert.equal(q.viewerCalls.length, 0);
});

test("actual assigned handoff / an exact-task failure releases normal route synchronization", { timeout: 25_000 }, async t => {
  const q = await beginAssignedHandoff(t, "cross-project", { supersededReply: true }), { h, f } = q;
  q.release.resolve(); await q.activation;
  assert.equal(await q.pending, false);
  await flushStoreFrames(h); await f.settle();
  assert.ok(q.syncCalls.length, "The actual finally releases its waiting load even after an exact-task error");
  assert.equal(h.store.route.get(), "/projects");
  assert.equal(libraryFocusFromRoute(h.store.route.get()), null);
  assert.equal(q.viewerCalls.length, 0);
});

after(()=>{assert.equal(external,0);globalThis.fetch=originalFetch;console.log("ASSIGNED_R2_COMPLETE",JSON.stringify({cases:observations.length,nativeFixtures:sceneCostFixtureProof.fixtures,nativeSqlShapes:sceneCostFixtureProof.nativeQueries.size,maximumBindings:sceneCostFixtureProof.maximumBindings,external}));});
