import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { createSceneCostFixture } from "./scene-cost-fixture.mjs";
import { createSceneStoreHost } from "./scene-cost-store-host.mjs";
import { appendAuditEvent, readWorkspaceEvents } from "../../worker/runtime.ts";
import { artifactDeliveryFor } from "../../src/state/artifact-delivery-context.ts";
import { artifactReviewState } from "../../src/model/context-health.ts";
import { documentArtifactRevision } from "../../src/model/document-artifacts.ts";
import { DOCUMENT_PRODUCTION_WORKFLOW_EVENT, recommendProductionWorkflow, productionWorkflows, productionWorkflowStageStates } from "../../src/model/production-workflow.ts";

// Full current classes and real LocaleController. Only the existing native
// template/control ports are reused; no production method or crypto replacement.
const url = new URL("../inactive-generation-dialog-host.test.mjs", import.meta.url);
const source = fs.readFileSync(url, "utf8");
const tree = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const first = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(tree) === "test");
assert.ok(first);
const moduleUrl = url.href + "?artifact-review-full-host";
const hook = registerHooks({ load(candidate, context, next) {
  return candidate === moduleUrl ? { format: "module", source: source.slice(0, first.getStart(tree)) + "\nexport {loadActual, RendererPort};\n", shortCircuit: true } : next(candidate, context);
} });
const { fixture, loadActual, RendererPort } = await import(moduleUrl);
hook.deregister();
const { localizeTemplateResult } = await loadActual("src/components/design-system/localized-template.ts");
export { loadActual, RendererPort };
export const hash = value => createHash("sha256").update(value).digest("hex");
export const nodes = (f, tag) => f.renderer.ownNodes(f.host, tag);
export const disabled = node => Object.hasOwn(node.attributes, "disabled");
export const primary = f => nodes(f, "button").find(node => node.classList.contains("artifact-viewer-review-toggle"));
export const panel = f => nodes(f, "div").find(node => node.attributes.id === "artifact-review-panel-" + f.artifactId);
export const panelOpen = f => Boolean(panel(f) && !Object.hasOwn(panel(f).attributes, "hidden"));
export const reviewControl = (f, type) => nodes(f, "button").find(node => node.handlers.click?.toString().includes('"' + type + '"'));
export function text(f, node) {
  const offset = f.renderer.markup.indexOf(node.full);
  assert.ok(offset >= 0, "the current native element comes from the current full template");
  return f.renderer.markup.slice(offset + node.full.length, f.renderer.markup.indexOf("</" + node.tag + ">", offset))
    .replace(/<[^>]*>/gu, "").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim();
}
export async function settle(f, check = () => true, label = "actual review boundary") {
  for (let turn = 0; turn < 120; turn++) { await f.flush(); if (check()) return; }
  assert.fail(label + " " + JSON.stringify(f.reviewReplies?.map(reply => ({ url: reply.request.url, status: reply.status, error: reply.body.error, types: reply.body.appended?.map(event => event.type) }))));
}
export function click(f, node) {
  assert.ok(node && f.renderer.nodes.includes(node) && node.isConnected, "only the current connected native control is activated");
  assert.equal(disabled(node), false); assert.equal(typeof node.handlers.click, "function");
  node.click();
}
export async function change(f, node, value) {
  assert.ok(node && f.renderer.nodes.includes(node) && node.isConnected);
  assert.equal(disabled(node), false);
  if (node.attributes.type === "checkbox") node.checked = value; else node.value = value;
  await f.renderer.handler(f.host, node.tag, current => current === node, "change")();
}
export async function openGallery(f) {
  click(f, nodes(f, "button").find(node => node.attributes["data-forma-content"] === "primary"
    && node.handlers.click?.toString().includes("#openArtifact(artifact)") && text(f, node).includes(currentArtifact(f).title)));
  await settle(f, () => Boolean(primary(f)) && nodes(f, "dialog").some(node => node.classList.contains("document-artifact-view") && node.open), "actual gallery opens current retained output");
  assert.ok(nodes(f, "dialog").find(node => node.classList.contains("document-artifact-view"))?.open);
}
export async function promote(f) {
  click(f, primary(f));
  await settle(f, () => panelOpen(f)
    || nodes(f, "footer").some(node => node.attributes["data-actions-open"] === "true"), "actual promoted intent settles");
}
export const currentArtifact = f => f.store.projection.get().libraryArtifacts.find(item => item.id === f.artifactId);
export const currentHash = f => hash(f.store.content.get()[currentArtifact(f).contentRef]);
export const currentReview = f => artifactReviewState(currentArtifact(f), f.store.projection.get().libraryBlocks, f.store.events.get());
export const currentDelivery = f => artifactDeliveryFor(f.store, currentArtifact(f), currentHash(f));
export const currentWorkflow = f => productionWorkflows(f.store.events.get(), f.host.documentId, f.store.projection.get().projectId).find(item => item.id === "scene-reuse-workflow");
export const workflowStates = f => productionWorkflowStageStates(currentWorkflow(f), f.store.projection.get(), f.store.events.get());

async function shareWithIndependentReviewer(worker) {
  const json = worker.json, reviewer = "independent-reviewer";
  const organization = await worker.request("/api/workspaces", json({ name: "Exact review fixture" }));
  assert.equal(organization.status, 201, await organization.clone().text());
  const organizationId = (await organization.json()).organizationId;
  const project = await worker.request("/api/workspaces/" + organizationId + "/projects", json({ projectId: worker.projectId }));
  assert.equal(project.status, 201, await project.clone().text());
  const projectAccessId = (await project.json()).projectAccessId;
  const base = "/api/workspaces/" + organizationId + "/projects/" + projectAccessId;
  const context = await worker.request(base + "/context", { method: "POST" });
  assert.equal(context.status, 200, await context.clone().text());
  const ownerHeaders = { cookie: context.headers.get("set-cookie").split(";")[0] };
  const reviewerAuth = { "oai-authenticated-user-id": reviewer, "oai-authenticated-user-email": reviewer + "@example.test" };
  worker.setScopedHeaders(reviewerAuth);
  assert.equal((await worker.request("/api/session")).status, 200);
  assert.equal((await worker.request("/api/session", json({ action: "accept_terms", ownershipConfirmed: true, providerProcessingConfirmed: true }))).status, 200);
  worker.setScopedHeaders(ownerHeaders);
  const invite = await worker.request("/api/workspaces/" + organizationId + "/members", json({ email: reviewer + "@example.test", role: "member" }));
  assert.equal(invite.status, 201, await invite.clone().text());
  const invitation = await invite.json();
  worker.setScopedHeaders(reviewerAuth);
  const accepted = await worker.request("/api/workspaces/" + organizationId + "/invitations/" + invitation.invitationId + "/accept",
    json({ token: new URL(invitation.invitationUrl).searchParams.get("token") }));
  assert.equal(accepted.status, 200, await accepted.clone().text());
  worker.setScopedHeaders(ownerHeaders);
  const member = await worker.request(base + "/members", json({ userId: reviewer, role: "viewer" }));
  assert.equal(member.status, 201, await member.clone().text());
  const listed = await worker.request(base + "/members"); assert.equal(listed.status, 200);
  const row = (await listed.json()).members.find(item => item.user_id === reviewer); assert.ok(row);
  const granted = await worker.request(base + "/members/" + row.membership_id, { ...json({ reviewAccess: true }), method: "PATCH" });
  assert.equal(granted.status, 200, await granted.clone().text());
  worker.setScopedHeaders(reviewerAuth);
  const reviewerContext = await worker.request(base + "/context", { method: "POST" });
  assert.equal(reviewerContext.status, 200, await reviewerContext.clone().text());
  const reviewerHeaders = { ...reviewerAuth, cookie: reviewerContext.headers.get("set-cookie").split(";")[0] };
  worker.setScopedHeaders(ownerHeaders);
  worker.sharing = { organizationId, projectAccessId, headers: ownerHeaders };
  return { ownerHeaders, reviewerHeaders, base, reviewer };
}

export async function createReviewHost(t, { locale = "en", shared = false, legacy = null, final = false, unverified = false, artifactKind = "short_story", costReceipts = [], managed = false } = {}) {
  const worker = await createSceneCostFixture(1, "visual", { depth: true });
  const original = (await readWorkspaceEvents(worker.env, worker.streamId)).find(event => event.type === "DocumentRenderCompleted" && event.payload.artifact_id === "saved-scene-story");
  assert.ok(original && !("_private_ref" in original.payload), "clone the actual retained source, never its redacted public envelope");
  // Append fixture history through the existing server helper; never rewrite
  // append-only history or synthesize a successful client acknowledgment.
  const completionPayload = { ...original.payload, artifact_id: "review-source-story", artifact_kind: artifactKind, title: "Exact review source", requested_by_user_id: worker.owner,
    // Opt-in synthetic production metadata; no team, provider or charge is inferred.
    ...(managed ? { settings: { ...(original.payload.settings ?? {}), production_mode: "managed" } } : {}),
    ...(final ? { workflow_id: worker.workflow.id, workflow_stage_id: "short_story-final", workflow_sources: [] } : {}) };
  if (unverified) delete completionPayload.source_block_versions;
  const completed = await appendAuditEvent(worker.env, worker.streamId, "worker:renderer", "DocumentRenderCompleted", completionPayload);
  // Optional synthetic reporting metadata; no provider execution or ledger
  // settlement is simulated. Existing fixture callers keep their exact defaults.
  for (const receipt of costReceipts) await appendAuditEvent(worker.env, worker.streamId, "worker:policy", "GenerationUsageRecorded", {
    ...receipt, operation: "document-render:" + artifactKind, artifact_kind: artifactKind,
    project_id: worker.projectId, document_id: worker.documentId,
    artifact_id: completionPayload.artifact_id, requested_by_user_id: worker.owner,
  }, completed.correlationId);
  const workflow = final
    ? recommendProductionWorkflow({ id: worker.workflow.id, documentId: worker.documentId, projectId: worker.projectId, target: "short_story", approvalRequired: true })
    : structuredClone(worker.workflow);
  if (!final) {
    workflow.stages[0].source.outputId = "review-source-story";
    workflow.stages[0].source.sourceEventId = completed.eventId;
  }
  await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, DOCUMENT_PRODUCTION_WORKFLOW_EVENT,
    { workflow_id: workflow.id, document_id: worker.documentId, project_id: worker.projectId, target_kind: workflow.target, workflow });
  if (legacy) {
    const exact = { artifact_id: "review-source-story", document_id: worker.documentId, project_id: worker.projectId,
      artifact_revision: 0, content_sha256: hash(worker.content) };
    const old = { artifact_id: exact.artifact_id, document_id: exact.document_id, project_id: exact.project_id };
    await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, "ArtifactReviewRequested",
      { ...(legacy === "missing-binding" ? old : exact), assigned_reviewer_user_id: "independent-reviewer" });
    await appendAuditEvent(worker.env, worker.streamId, "user:" + (legacy === "nonindependent" ? worker.owner : "independent-reviewer"),
      "ArtifactApproved", legacy === "missing-binding" ? old : exact);
  }
  const sharing = shared ? await shareWithIndependentReviewer(worker) : null;
  const h = await createSceneStoreHost({ count: 1, shared, workerFixture: worker });
  h.store.patchUi({ instrumentation: false });
  const pending = new Set(), replies = [];
  h.transport = async request => {
    const task = worker.request(request.url, request.init); pending.add(task);
    try {
      const response = await task;
      replies.push({ request, status: response.status, body: await response.clone().json() });
      return response;
    } finally { pending.delete(task); }
  };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.ok(String(url).startsWith("/api/"), "no provider or external request is allowed");
    return h.fetch(url, init);
  });
  const f = fixture("create", { locale });
  f.store = h.store; f.host.store = h.store; f.host.documentId = worker.documentId; f.host.launcherOnly = false;
  f.reviewReplies = replies;
  f.artifactId = "review-source-story"; f.state.documentId = worker.documentId;
  const render = f.renderer.value;
  f.renderer.value = function(value, ...rest) { return render.call(this, localizeTemplateResult(value, f.i18n), ...rest); };
  f.draw();
  const initialCounts = worker.counts();
  t.after(async () => {
    await settle(f, () => pending.size === 0, "all actual application replies finish before fixture disposal");
    assert.deepEqual(worker.counts(), initialCounts, "review never admits generation or reserves budget");
    f.host.isConnected = false; f.host.disconnectedCallback();
    for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
    f.i18n.hostDisconnected(); await h.close();
  });
  const switchActor = async role => {
    assert.ok(sharing);
    worker.setScopedHeaders(role === "reviewer" ? sharing.reviewerHeaders : sharing.ownerHeaders);
    const response = await worker.request("/api/session"); assert.equal(response.status, 200);
    h.store.session.set(await response.json());
    await h.store.refreshEvents(); f.draw();
  };
  return { f, h, worker, replies, sharing, switchActor, initialCounts,
    revision: () => documentArtifactRevision(h.store.events.get(), f.artifactId) };
}

let canvasFixture;
export async function createReviewCanvas(t, { f, h, worker }, locale) {
  if (!canvasFixture) {
    const url = new URL("../canvas-calm-controls-host.test.mjs", import.meta.url);
    const raw = fs.readFileSync(url, "utf8"), tree = ts.createSourceFile(url.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const first = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === "test");
    assert.ok(first);
    const moduleUrl = url.href + "?artifact-review-canvas-full-host";
    const hook = registerHooks({ load(candidate, context, next) {
      return candidate === moduleUrl ? { format: "module", source: raw.slice(0, first.getStart(tree)) + "\nexport {fixture};\n", shortCircuit: true } : next(candidate, context);
    } });
    try { canvasFixture = (await import(moduleUrl)).fixture; } finally { hook.deregister(); }
  }
  // Persist synthetic initial board history, then read it through the complete
  // Store. All current UI actions and the handoff execute unchanged production methods.
  const canvasId = "review-board";
  await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, "CanvasCreated",
    { canvas_id: canvasId, project_id: worker.projectId, name: "Exact review board", slug: "review-board", history_owner_id: worker.owner });
  await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, "CanvasItemPlaced",
    { canvas_id: canvasId, project_id: worker.projectId, item_id: "review-artifact-item", source_kind: "artifact", source_id: f.artifactId,
      title: currentArtifact(f).title, block_type: "document-output", frame: { x: 0, y: 0, w: 400, h: 300, z: "a" }, history_owner_id: worker.owner });
  await h.store.refreshEvents();
  assert.equal(h.store.session.get().canvas.access, true, "the real session already permits this current Canvas");
  const priorHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
  Object.defineProperty(globalThis, "history", { configurable: true, value: {
    pushState(_state, _title, route) {
      const url = new URL(route, "http://localhost");
      Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash });
    },
    replaceState(...args) { this.pushState(...args); },
  } });
  t.after(() => { if (priorHistory) Object.defineProperty(globalThis, "history", priorHistory); else delete globalThis.history; });
  assert.equal(await h.store.transitionWorkspace("/canvas/" + canvasId + "/review-board"), true, "actual audience/session transition completes before the current board mounts");
  assert.equal(h.store.route.get(), "/canvas/" + canvasId + "/review-board");
  f.host.isConnected = false; f.host.disconnectedCallback();
  const canvas = canvasFixture({ locale, storeHost: h });
  canvas.reviewReplies = f.reviewReplies;
  t.after(() => {
    canvas.host.isConnected = false; canvas.host.disconnectedCallback();
    for (const { instance } of canvas.renderer.instances.values()) if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
    canvas.i18n.hostDisconnected();
  });
  assert.equal(h.store.canvasProjection.get().selectedCanvasId, canvasId);
  return canvas;
}
