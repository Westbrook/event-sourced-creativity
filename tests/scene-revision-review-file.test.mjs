import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveObjectURL } from "node:buffer";
import {
  nodes, disabled, reviewControl, settle, click, openGallery, promote,
  currentArtifact, currentHash, currentReview, currentDelivery, hash,
} from "./helpers/artifact-review-host.mjs";
import { artifactApprovalMatches } from "../src/model/artifact-delivery.ts";
import { appendAuditEvent, readWorkspaceEvents } from "../worker/runtime.ts";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { storePrivateContent } from "../worker/pilot-policy.ts";
import { documentArtifactValidationIssues, parseDocumentArtifactContent, documentArtifactRevision } from "../src/model/document-artifacts.ts";
import { loadActual } from "./helpers/artifact-review-host.mjs";

// Reuse the existing media-title fixture's export-only frame/reviewer setup.
// No production method is replaced and no test body is executed by this import.
const hostUrl = pathToFileURL(fs.realpathSync(new URL("./helpers/artifact-review-host.mjs", import.meta.url)));
const hostSource = fs.readFileSync(hostUrl, "utf8"), hostVirtual = hostUrl.href + "?scene-revision-file-setup";
const hostHook = registerHooks({ load(url, context, next) {
  return url === hostVirtual ? { format: "module", source: hostSource + "\nexport {fixture,shareWithIndependentReviewer};\n", shortCircuit: true } : next(url, context);
} });
const { fixture: createFrame, shareWithIndependentReviewer } = await import(hostVirtual).finally(() => hostHook.deregister());
const { localizeTemplateResult } = await loadActual("src/components/design-system/localized-template.ts");
const originalMarkdown = "# INT. HARBOR WATCH ROOM — DAWN\n\nMara checks the salt-stained chart beneath a brass lantern.\n\nMARA\nThe channel is clear.\n";

async function createSceneReviewHost(t) {
  const worker = await createSceneCostFixture(1, "visual", { depth: true });
  const priorRows = worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all();
  const priorHistory = worker.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();
  const artifactId = "retained-written-scene-revision-file";
  const draft = { title: "Harbor watch scene", summary: "A declared written Scene for local revision/review/file verification.",
    content_markdown: originalMarkdown, presentation: null,
    items: [{ title: "Harbor watch room", body: originalMarkdown, notes: "Preserve the authored harbor setting.", image_prompt: "", context_group_ids: [], slide: null }] };
  assert.deepEqual(documentArtifactValidationIssues("scene", parseDocumentArtifactContent(JSON.stringify(draft)), { itemCount: 1 }), []);
  const retained = JSON.stringify(draft), stored = await storePrivateContent(worker.env, worker.owner, "document-artifact", retained);
  const completion = await appendAuditEvent(worker.env, worker.streamId, "worker:renderer", "DocumentRenderCompleted", {
    project_id: worker.projectId, document_id: worker.documentId, artifact_id: artifactId, artifact_kind: "scene",
    title: draft.title, summary: draft.summary, content_ref: stored.contentId, item_count: 1,
    source_block_versions: [{ block_id: "scene-reuse-direction", version: 1 }], requested_by_user_id: worker.owner,
    items: [{ id: "retained-written-scene-part", title: draft.items[0].title }],
    provider: "simulation", model_id: "retained-written-scene-fixture", simulation: true, source_surface: "document",
  });
  // A new typed retained fixture is declared through server storage before
  // ordinary content=1 bootstrap. Original Story bytes/history are untouched.
  for (const row of priorRows) assert.deepEqual(worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(row.content_id), row);
  for (const row of priorHistory) assert.deepEqual(worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(row.event_id), row);
  const sharing = await shareWithIndependentReviewer(worker);
  const h = await createSceneStoreHost({ workerFixture: worker, shared: true }); h.store.patchUi({ instrumentation: false });
  const pending = new Set(), replies = [];
  h.transport = async request => {
    const task = worker.request(request.url, request.init); pending.add(task);
    try { const response = await task; replies.push({ request, status: response.status, body: await response.clone().json() }); return response; }
    finally { pending.delete(task); }
  };
  t.mock.method(globalThis, "fetch", async (url, init) => { assert.ok(String(url).startsWith("/api/"), "no provider or external request"); return h.fetch(url, init); });
  const f = createFrame("create", { locale: "en" });
  f.store = h.store; f.host.store = h.store; f.host.documentId = worker.documentId; f.host.launcherOnly = false;
  f.reviewReplies = replies; f.artifactId = artifactId; f.state.documentId = worker.documentId;
  const render = f.renderer.value;
  f.renderer.value = function(value, ...rest) { return render.call(this, localizeTemplateResult(value, f.i18n), ...rest); }; f.draw();
  const initialCounts = worker.counts();
  t.after(async () => {
    await settle(f, () => pending.size === 0, "all actual application replies finish before disposal");
    assert.deepEqual(worker.counts(), initialCounts, "no job or budget admission");
    f.host.isConnected = false; f.host.disconnectedCallback();
    for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
    f.i18n.hostDisconnected(); await h.close();
  });
  assert.equal(currentArtifact(f).sourceEventId, completion.eventId);
  assert.equal(currentArtifact(f).contentRef, stored.contentId);
  assert.equal(h.store.content.get()[stored.contentId], retained);
  const switchActor = async role => {
    worker.setScopedHeaders(role === "reviewer" ? sharing.reviewerHeaders : sharing.ownerHeaders);
    const response = await worker.request("/api/session"); assert.equal(response.status, 200);
    h.store.session.set(await response.json()); await h.store.refreshEvents(); f.draw();
  };
  return { f, h, worker, replies, sharing, switchActor,
    revision: () => documentArtifactRevision(h.store.events.get(), artifactId), priorRows, priorHistory };
}

// One composition of existing actual viewer/Store/Worker fixtures. Distinct
// synthetic principals exercise authorization; no human approval is claimed.
const revisedMarkdown = "# INT. HARBOR WATCH ROOM — DAWN\n\nMara aligns the salt-stained chart beneath the brass lantern. Rain taps the café window.\n\nMARA\nKeep the gate open — the keeper marked 雨 beside the safe channel.\n\nShe leaves a green 🌱 beside the final bearing.\n";
const isType = (request, type) => request.url === "/api/events"
  && (request.body?.events ?? [request.body?.event]).some(event => event?.type === type);
const replyFor = (q, type) => q.replies.find(reply => isType(reply.request, type));
const view = f => nodes(f, "dialog").find(node => node.classList.contains("document-artifact-view") && node.open);
const methodButton = (f, method) => {
  const found = nodes(f, "button").filter(node => node.handlers.click?.toString().includes(method));
  assert.equal(found.length, 1, "one current actual viewer control: " + method); return found[0];
};
async function actions(f) {
  const popover = f.renderer.query(f.host, "forma-ui-popover").find(node => node.attributes.class === "artifact-viewer-actions-popover");
  if (!popover) return;
  const panel = f.renderer.ownNodes(popover, "section").find(node => node.attributes.popover === "auto");
  const trigger = f.renderer.ownNodes(popover, "button").find(node => node.attributes.popovertarget === panel?.attributes.id);
  assert.ok(panel && trigger && trigger.isConnected);
  if (!panel.matches(":popover-open")) trigger.click(); // Existing native popovertarget default.
  await settle(f);
  assert.ok(f.renderer.ownNodes(popover, "section").find(node => node.attributes.popover === "auto")?.matches(":popover-open"));
}
function installMarkdownFilePort(t, f, q) {
  const document = f.host.ownerDocument, window = document.defaultView;
  const downloads = [], timers = [];
  const previousCreate = Object.getOwnPropertyDescriptor(document, "createElement");
  const previousTimer = Object.getOwnPropertyDescriptor(window, "setTimeout");
  // These are missing native ports only. Production creates the real Blob and
  // object URL and must receive real Worker export authorization before click.
  Object.defineProperty(document, "createElement", { configurable: true, value(tag) {
    assert.equal(tag, "a");
    return { href: "", download: "", click() {
      const receipt = replyFor(q, "DocumentArtifactExported");
      assert.equal(receipt?.status, 200, "actual export acknowledgment precedes the native download click");
      const blob = resolveObjectURL(this.href); assert.ok(blob instanceof Blob);
      assert.equal(blob.type, "text/markdown;charset=utf-8");
      assert.equal(this.download, "harbor-watch-scene.md");
      downloads.push({ blob, href: this.href, filename: this.download });
    } };
  } });
  Object.defineProperty(window, "setTimeout", { configurable: true, value(callback, ms) {
    assert.equal(ms, 1000, "only the existing object-URL cleanup timer"); timers.push(callback); return timers.length;
  } });
  t.after(() => {
    for (const callback of timers.splice(0)) callback();
    for (const download of downloads) assert.equal(resolveObjectURL(download.href), undefined);
    if (previousCreate) Object.defineProperty(document, "createElement", previousCreate); else delete document.createElement;
    if (previousTimer) Object.defineProperty(window, "setTimeout", previousTimer); else delete window.setTimeout;
  });
  return downloads;
}

test("Written Scene save synchronizes its item, requires exact revision 1 review, and reaches a readable Markdown file", { timeout: 60_000 }, async t => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "forma-scene-revision-review-file-"));
  t.after(() => rm(outputDirectory, { recursive: true }));
  const q = await createSceneReviewHost(t), { f, h, worker, sharing } = q;
  const artifactId = f.artifactId, originalHash = currentHash(f), owner = h.store.session.get().user.userId;
  assert.equal(q.revision(), 0); assert.equal(currentArtifact(f).kind, "scene");
  assert.notEqual(sharing.reviewer, owner);
  const financialTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"];
  const finances = () => Object.fromEntries(financialTables.map(table => [table, worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
  const beforeFinances = finances();
  const downloads = installMarkdownFilePort(t, f, q);
  try {
  await openGallery(f); await actions(f);
  click(f, methodButton(f, "#startArtifactEdit"));
  await settle(f, () => nodes(f, "textarea").some(node => node.attributes.rows === "12"));
  const editor = nodes(f, "textarea").find(node => node.attributes.rows === "12");
  assert.ok(view(f) && editor.isConnected); assert.equal(disabled(editor), false);
  editor.value = revisedMarkdown; editor.handlers.input.call(f.host, { target: editor, currentTarget: editor });
  f.draw();
  assert.equal(nodes(f, "textarea").find(node => node.attributes.rows === "12").value, revisedMarkdown);
  click(f, methodButton(f, "#saveArtifactEdit"));
  await settle(f, () => q.revision() === 1 && !nodes(f, "textarea").some(node => node.attributes.rows === "12"), "actual finished-output Save acknowledgment");
  const patches = q.replies.filter(reply => reply.request.url === "/api/artifacts/" + artifactId && reply.request.init.method === "PATCH");
  assert.equal(patches.length, 1); assert.equal(patches[0].status, 200);
  assert.equal(patches[0].request.body.expectedRevision, 0); assert.equal(patches[0].request.body.markdown, revisedMarkdown);
  assert.equal(patches[0].request.body.items.length, 1);
  assert.equal(patches[0].request.body.items[0].body, revisedMarkdown, "actual one-item Scene input handler synchronizes the item with edited Markdown");
  assert.equal(patches[0].request.body.items[0].title, "Harbor watch room");
  assert.equal(patches[0].request.body.items[0].notes, "Preserve the authored harbor setting.");
  const artifact = currentArtifact(f), raw = h.store.content.get()[artifact.contentRef], savedHash = currentHash(f);
  assert.equal(JSON.parse(raw).content_markdown, revisedMarkdown); assert.notEqual(savedHash, originalHash);
  assert.equal(JSON.parse(raw).items[0].body, revisedMarkdown);
  assert.deepEqual(documentArtifactValidationIssues("scene", parseDocumentArtifactContent(raw), { itemCount: 1 }), []);
  assert.equal(currentReview(f).status, "draft");
  assert.equal(currentArtifact(f).mediaUrl, null, "this retained written Scene does not claim generated visual/audio media");
  const retained = worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(artifact.contentRef);
  assert.equal(retained.content, raw, "current Store bytes equal the actual Worker retained content");
  const edits = h.store.events.get().filter(event => event.type === "DocumentArtifactEdited" && event.payload.artifact_id === artifactId);
  assert.equal(edits.length, 1); assert.equal(edits[0].actor, "user:" + owner);
  assert.equal(currentDelivery(f).approved, false); assert.equal(currentDelivery(f).releaseAllowed, false);
  assert.equal(downloads.length, 0);

  await promote(f);
  assert.equal(reviewControl(f, "ArtifactApproved"), undefined, "the author/editor cannot self-approve");
  const assign = reviewControl(f, "ArtifactReviewRequested"); assert.ok(assign); assert.equal(disabled(assign), false);
  click(f, assign);
  await settle(f, () => currentReview(f).status === "in-review", "new exact saved-revision assignment");
  const request = replyFor(q, "ArtifactReviewRequested"); assert.equal(request.status, 200);
  const expected = { artifact_id: artifactId, document_id: worker.documentId, project_id: worker.projectId, artifact_revision: 1, content_sha256: savedHash };
  for (const [key, value] of Object.entries(expected)) assert.equal(request.body.appended[0].payload[key], value);
  assert.equal(request.body.appended[0].payload.assigned_reviewer_user_id, sharing.reviewer);
  assert.equal(currentDelivery(f).releaseAllowed, false);

  await q.switchActor("reviewer");
  await openGallery(f); await promote(f);
  assert.equal(h.store.session.get().user.userId, sharing.reviewer);
  assert.equal(q.revision(), 1); assert.equal(currentHash(f), savedHash);
  assert.equal(currentDelivery(f).action, "review");
  const approve = reviewControl(f, "ArtifactApproved"); assert.ok(approve); assert.equal(disabled(approve), false);
  click(f, approve);
  await settle(f, () => currentDelivery(f).approved, "actual distinct synthetic reviewer decision on saved revision 1");
  const decision = replyFor(q, "ArtifactApproved"); assert.equal(decision.status, 200);
  assert.equal(decision.body.appended[0].actor, "user:" + sharing.reviewer);
  for (const [key, value] of Object.entries(expected)) assert.equal(decision.body.appended[0].payload[key], value);
  assert.equal(artifactApprovalMatches(currentArtifact(f), h.store.events.get(), 1, savedHash), true);
  assert.equal(artifactApprovalMatches(currentArtifact(f), h.store.events.get(), 0, originalHash), false, "approval cannot be applied to the old revision's bytes");
  assert.equal(currentDelivery(f).releaseAllowed, true);

  await promote(f); await actions(f);
  const download = methodButton(f, "#download(artifact)"); assert.equal(disabled(download), false);
  click(f, download);
  await settle(f, () => downloads.length === 1, "actual authorized Markdown Blob reaches native anchor click");
  const exported = replyFor(q, "DocumentArtifactExported"); assert.equal(exported.status, 200);
  for (const [key, value] of Object.entries(expected)) assert.equal(exported.body.appended[0].payload[key], value);
  assert.equal(exported.body.appended[0].payload.format, "markdown");
  assert.equal(exported.body.appended[0].payload.artifact_kind, "scene");
  const bytes = Buffer.from(await downloads[0].blob.arrayBuffer());
  const file = join(outputDirectory, downloads[0].filename);
  await writeFile(file, bytes, { flag: "wx" }); const opened = await readFile(file);
  assert.deepEqual(opened, bytes); assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(opened), revisedMarkdown);
  assert.ok(opened.length > 0); assert.equal(currentHash(f), savedHash); assert.equal(q.revision(), 1);
  const actual = await readWorkspaceEvents(worker.env, worker.streamId);
  const chain = actual.filter(event => event.payload.artifact_id === artifactId && ["DocumentArtifactEdited", "ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"].includes(event.type));
  assert.deepEqual(chain.map(event => event.type), ["DocumentArtifactEdited", "ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"]);
  assert.ok(h.requests.filter(request => ["POST", "PATCH", "DELETE"].includes(request.init.method)).every(request => request.url === "/api/artifacts/" + artifactId && request.init.method === "PATCH"
    || ["ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"].some(type => isType(request, type))), "only the explicit RAM edit/review/export chain writes");
  assert.deepEqual(finances(), beforeFinances);
  for (const row of q.priorRows) assert.deepEqual(worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(row.content_id), row, "original Story content remains exact after Scene edit/review/export");
  for (const row of q.priorHistory) assert.deepEqual(worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(row.event_id), row, "original Story history remains exact");
  t.diagnostic("SCENE_REVISION_REVIEW_FILE " + JSON.stringify({ artifactId, kind: "scene", revision: 1, savedHash, editor: owner, syntheticReviewer: sharing.reviewer,
    file, bytes: opened.length, fileSha256: hash(opened), sequence: chain.map(event => ({ type: event.type, eventId: event.eventId, actor: event.actor })),
    limit: "Actual component handlers, Store and RAM Worker plus a materialized production Blob. Native-control port only: not a browser download, human independent review, recipient delivery provider-generation, visual/audio media, or screenplay-application claim." }));
  } finally { assert.deepEqual(finances(), beforeFinances); }
});
