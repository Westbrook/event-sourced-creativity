import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveObjectURL } from "node:buffer";
import { artifactApprovalMatches } from "../src/model/artifact-delivery.ts";
import { appendAuditEvent, readWorkspaceEvents } from "../worker/runtime.ts";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { storePrivateContent } from "../worker/pilot-policy.ts";
import { documentArtifactValidationIssues, parseDocumentArtifactContent, documentArtifactRevision } from "../src/model/document-artifacts.ts";
import ts from "typescript";
import path from "node:path";
import { png, readStoredZip } from "./output-asset-fixtures.mjs";
import { storeGeneratedMedia } from "../worker/media-api.ts";

// Existing reviewed fixture, renderer, loader and reviewer setup. Supply the
// actual Office archive namespace through loadActual's existing literal-import argument
// before its normal one-time DocumentArtifacts load; no production method is replaced.
const hostUrl = pathToFileURL(fs.realpathSync(new URL("./helpers/artifact-review-host.mjs", import.meta.url)));
const hostSource = fs.readFileSync(hostUrl, "utf8"), hostVirtual = hostUrl.href + "?storyboard-revision-file-setup";
const prefixExpression = "source.slice(0, first.getStart(tree))";
const viewerLoad = 'loadActual("src/components/document-artifacts.ts")';
const officeUrl = new URL("../../src/model/office-documents.ts", hostUrl).href;
const boundViewerLoad = 'loadActual("src/components/document-artifacts.ts", new Map([["../model/office-documents", await import(' + JSON.stringify(officeUrl) + ')]]))';
assert.equal(hostSource.split(prefixExpression).length, 2, "one existing declaration-prefix extraction");
const qualifiedHostSource = hostSource.replace(prefixExpression,
  prefixExpression + ".replace(" + JSON.stringify(viewerLoad) + ", " + JSON.stringify(boundViewerLoad) + ")");
const nativePrefixUrl = new URL("../inactive-generation-dialog-host.test.mjs", hostUrl);
const nativePrefixSource = fs.readFileSync(nativePrefixUrl, "utf8");
const nativeTree = ts.createSourceFile(nativePrefixUrl.pathname, nativePrefixSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstTest = nativeTree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(nativeTree) === "test");
assert.ok(firstTest);
assert.equal(nativePrefixSource.slice(0, firstTest.getStart(nativeTree)).split(viewerLoad).length, 2, "only the existing viewer's first load gains its declared Office import");
const hostHook = registerHooks({ load(url, context, next) {
  return url === hostVirtual ? { format: "module", source: qualifiedHostSource + "\nexport {fixture,shareWithIndependentReviewer};\n", shortCircuit: true } : next(url, context);
} });
const {
  fixture: createFrame, shareWithIndependentReviewer, loadActual,
  nodes, disabled, reviewControl, settle, click, openGallery, promote,
  currentArtifact, currentHash, currentReview, currentDelivery, hash,
} = await import(hostVirtual).finally(() => hostHook.deregister());
const { localizeTemplateResult } = await loadActual("src/components/design-system/localized-template.ts");
// Reuse the actual media-title test's in-memory bucket declaration. Only this
// named native bucket port is extracted; no test body or source rights are invented.
const bucketUrl = new URL("../event-source-retirement-continuations.test.mjs", hostUrl);
const bucketSource = fs.readFileSync(bucketUrl, "utf8"), bucketTree = ts.createSourceFile(bucketUrl.pathname, bucketSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const bucketDeclaration = bucketTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "retainActualUploadedMedia");
assert.ok(bucketDeclaration);
const { retainActualUploadedMedia } = new Function(bucketDeclaration.getText(bucketTree) + "\nreturn {retainActualUploadedMedia};")();
const pixels = rgba => Uint8Array.from([0, ...rgba, ...rgba, ...rgba, 0, ...rgba, ...rgba, ...rgba]);
const retainedFrames = [png({ raw: pixels([232, 155, 41, 255]) }), png({ raw: pixels([49, 91, 174, 255]) })];
const originalItems = [
  { title: "Harbor readiness", body: "The north channel survey confirms a clear morning passage.", notes: "Frame note A: Wait for the keeper before opening the gate." },
  { title: "Café watch", body: "The shoreline team will inspect the lantern before the evening shift.", notes: "Frame note B: Review the rain log with the crew." },
].map(item => ({ ...item, image_prompt: "Retained synthetic frame; no image generation request.", context_group_ids: [], slide: null }));
const originalMarkdown = "# Harbor decisions\n\n" + originalItems.map(item => item.title + "\n" + item.body).join("\n\n") + "\n";

async function createStoryboardReviewHost(t) {
  const worker = await createSceneCostFixture(1, "visual", { depth: true });
  const priorRows = worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all();
  const priorHistory = worker.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();
  const artifactId = "retained-storyboard-revision-file";
  const draft = { title: "Harbor storyboard", summary: "Declared retained Storyboard for local revision, exact review and complete archive verification.",
    content_markdown: originalMarkdown, presentation: null, items: originalItems };
  assert.deepEqual(documentArtifactValidationIssues("storyboard", parseDocumentArtifactContent(JSON.stringify(draft)), { itemCount: 2 }), []);
  const retained = JSON.stringify(draft), stored = await storePrivateContent(worker.env, worker.owner, "document-artifact", retained);
  const bucket = retainActualUploadedMedia({ worker }), media = [];
  for (let index = 0; index < retainedFrames.length; index++) {
    const result = await storeGeneratedMedia(worker.env, worker.owner, artifactId + "-frame-" + index, retainedFrames[index], "retained-storyboard-fixture", "image/png", { source: "synthetic-retained-fixture", provider: "simulation" });
    assert.deepEqual(bucket.get(result.key).bytes, retainedFrames[index]); assert.equal(bucket.get(result.key).customMetadata.ownerId, worker.owner); media.push(result);
  }
  const frozenMedia = structuredClone([...bucket]);
  const completion = await appendAuditEvent(worker.env, worker.streamId, "worker:renderer", "DocumentRenderCompleted", {
    project_id: worker.projectId, document_id: worker.documentId, artifact_id: artifactId, artifact_kind: "storyboard",
    title: draft.title, summary: draft.summary, content_ref: stored.contentId, item_count: 2,
    source_block_versions: [{ block_id: "scene-reuse-direction", version: 1 }], requested_by_user_id: worker.owner,
    items: draft.items.map((item,index) => ({ id: artifactId + "-part-" + index, title: item.title, media_url: media[index].url, media_type: "image/png", width: 3, height: 2 })),
    provider: "simulation", model_id: "retained-storyboard-fixture", simulation: true, source_surface: "document",
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
    try {
      const response = await task, copy = response.clone(), mime = String(response.headers.get("content-type") ?? "");
      replies.push({ request, status: response.status, body: mime.includes("json") ? await copy.json() : null,
        ...(mime.startsWith("image/") ? { mime, bytes: new Uint8Array(await copy.arrayBuffer()) } : {}) }); return response;
    }
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
  return { f, h, worker, replies, sharing, switchActor, bucket, media, frozenMedia,
    revision: () => documentArtifactRevision(h.store.events.get(), artifactId), priorRows, priorHistory };
}

// One composition of existing actual viewer/Store/Worker fixtures. Distinct
// synthetic principals exercise authorization; no human approval is claimed.
const revisedItems = [
  { title: "Harbor approval — café", body: "Mara records the safe channel beside the chart.\nKeep the gate open for the final 雨 inspection.", notes: "Frame revised note A: Ask the keeper about the green 🌱 marker.\nPreserve this full continuity instruction with the frame." },
  { title: "Evening lantern decision", body: "The crew checks every brass fitting before dusk.\nA second watch confirms the harbor light remains visible.", notes: "Frame revised note B: Pause here and take the crew's questions.\nKeep the exact café spelling in the continuity notes." },
];
const revisedMarkdown = "# Harbor decisions — revised\n\n" + revisedItems.map(item => item.title + "\n" + item.body).join("\n\n") + "\n";
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
function installArchiveFilePort(t, f, q) {
  const document = f.host.ownerDocument, window = document.defaultView;
  const downloads = [], timers = [], attached = new Set();
  const descriptors = [document, "createElement", document, "body", window, "setTimeout"];
  const prior = [0,2,4].map(index => Object.getOwnPropertyDescriptor(descriptors[index], descriptors[index+1]));
  // Missing native ports only. Production builds the real ZIP, Blob and URL;
  // actual Worker authorization must finish before the native anchor click.
  Object.defineProperty(document, "createElement", { configurable: true, value(tag) {
    assert.equal(tag, "a");
    return { href: "", download: "", click() {
      assert.ok(attached.has(this), "the production anchor is attached before activation");
      const receipts = q.replies.filter(reply => isType(reply.request, "DocumentArtifactExported"));
      const receipt = receipts.at(-1); assert.equal(receipt?.status, 200);
      assert.equal(receipts.length, downloads.length + 1, "one fresh actual Worker authorization per download");
      const blob = resolveObjectURL(this.href); assert.ok(blob instanceof Blob);
      assert.equal(blob.type, "application/zip");
      assert.equal(this.download, "harbor-storyboard.zip");
      downloads.push({ blob, href: this.href, filename: this.download, receipt });
    }, remove() { assert.equal(attached.delete(this), true); } };
  } });
  Object.defineProperty(document, "body", { configurable: true, value: { append(anchor) { assert.equal(attached.has(anchor), false); attached.add(anchor); } } });
  Object.defineProperty(window, "setTimeout", { configurable: true, value(callback, ms) {
    assert.equal(ms, 1_000, "only the existing object-URL cleanup timer"); timers.push(callback); return timers.length;
  } });
  t.after(() => {
    for (const callback of timers.splice(0)) callback();
    for (const download of downloads) assert.equal(resolveObjectURL(download.href), undefined);
    assert.equal(attached.size, 0);
    [0,2,4].forEach((index, ordinal) => { if (prior[ordinal]) Object.defineProperty(descriptors[index], descriptors[index+1], prior[ordinal]); else delete descriptors[index][descriptors[index+1]]; });
  });
  return downloads;
}
async function readStoryboardArchive(directory, download, q, savedHash) {
  const bytes = Buffer.from(await download.blob.arrayBuffer()), file = join(directory, download.filename);
  await writeFile(file, bytes, { flag: "wx" }); const opened = await readFile(file); assert.deepEqual(opened, bytes);
  const entries = readStoredZip(new Uint8Array(opened.buffer, opened.byteOffset, opened.byteLength)), decoder = new TextDecoder("utf-8", { fatal: true });
  assert.deepEqual([...entries.keys()], ["README.md", "manifest.json", "frames/frame-001.png", "frames/frame-002.png"]);
  assert.equal(decoder.decode(entries.get("README.md")), revisedMarkdown);
  const manifest = JSON.parse(decoder.decode(entries.get("manifest.json")));
  assert.equal(manifest.title, "Harbor storyboard"); assert.equal(manifest.kind, "storyboard");
  assert.equal(manifest.revision, 1); assert.equal(manifest.contentSha256, savedHash);
  assert.equal(manifest.items.length, revisedItems.length); assert.equal(Object.hasOwn(manifest, "soundtracks"), false, "no unprovided soundtrack is claimed");
  const frames = [];
  for (let index = 0; index < revisedItems.length; index++) {
    const item = revisedItems[index], filename = `frames/frame-${String(index+1).padStart(3,"0")}.png`;
    assert.deepEqual(manifest.items[index], { position: index+1, title: item.title, description: item.body, notes: item.notes, file: filename, mimeType: "image/png" });
    assert.deepEqual(entries.get(filename), retainedFrames[index], "archive preserves the exact original frame's bytes and order after textual revision");
    const reads = q.replies.filter(reply => reply.request.url === q.media[index].url);
    assert.equal(reads.length, 1); assert.equal(reads[0].status, 200); assert.equal(reads[0].mime, "image/png");
    assert.deepEqual(reads[0].bytes, retainedFrames[index], "actual Worker media route supplied the original authorized frame");
    frames.push({ file: filename, bytes: entries.get(filename).length, sha256: hash(entries.get(filename)) });
  }
  // Preserve the exact exported ZIP and its reopened components for independent
  // archive/media review. These are copied from the actual reopened file only.
  const extracted = join(directory, "reopened-archive"); await mkdir(extracted); await mkdir(join(extracted, "frames"));
  for (const [name, bytes] of entries) await writeFile(join(extracted, name), bytes, { flag: "wx" });
  return { file, bytes: opened.length, sha256: hash(opened), entries: entries.size, frames, manifest, extracted };
}

test("Storyboard edited revision requires distinct exact review and yields a complete retained-frame archive", { timeout: 60_000 }, async t => {
  // An explicit packet directory retains the actual exported files for visual
  // review. It must be new; fixture/URL cleanup remains unchanged in both modes.
  const durableOutput = process.env.FORMA_STORYBOARD_REVIEW_OUTPUT;
  if (durableOutput) { assert.equal(path.isAbsolute(durableOutput), true); await mkdir(durableOutput); }
  const outputDirectory = durableOutput || await mkdtemp(join(tmpdir(), "forma-storyboard-revision-review-file-"));
  if (!durableOutput) t.after(() => rm(outputDirectory, { recursive: true }));
  const q = await createStoryboardReviewHost(t), { f, h, worker, sharing } = q;
  const artifactId = f.artifactId, originalHash = currentHash(f), owner = h.store.session.get().user.userId;
  assert.equal(q.revision(), 0); assert.equal(currentArtifact(f).kind, "storyboard");
  assert.notEqual(sharing.reviewer, owner);
  const financialTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"];
  const finances = () => Object.fromEntries(financialTables.map(table => [table, worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
  const beforeFinances = finances();
  const downloads = installArchiveFilePort(t, f, q);
  try {
  await openGallery(f); await actions(f);
  click(f, methodButton(f, "#startArtifactEdit"));
  await settle(f, () => nodes(f, "textarea").some(node => node.attributes.rows === "12"));
  const editor = nodes(f, "textarea").find(node => node.attributes.rows === "12");
  assert.ok(view(f) && editor.isConnected); assert.equal(disabled(editor), false);
  const input = (node, value) => { assert.ok(node?.isConnected); assert.equal(disabled(node), false); node.value = value; node.handlers.input.call(f.host, { target: node, currentTarget: node }); };
  input(editor, revisedMarkdown);
  const titles = nodes(f, "input").filter(node => /item\.title\s*=/.test(node.handlers.input?.toString() ?? ""));
  const bodies = nodes(f, "textarea").filter(node => node.attributes.rows === "4");
  const notes = nodes(f, "textarea").filter(node => node.attributes.rows === "2");
  assert.equal(titles.length, 2); assert.equal(bodies.length, 2); assert.equal(notes.length, 2);
  for (let index = 0; index < revisedItems.length; index++) {
    input(titles[index], revisedItems[index].title); input(bodies[index], revisedItems[index].body); input(notes[index], revisedItems[index].notes);
  }
  f.draw();
  assert.equal(nodes(f, "textarea").find(node => node.attributes.rows === "12").value, revisedMarkdown);
  click(f, methodButton(f, "#saveArtifactEdit"));
  await settle(f, () => q.revision() === 1 && !nodes(f, "textarea").some(node => node.attributes.rows === "12"), "actual finished-output Save acknowledgment");
  const patches = q.replies.filter(reply => reply.request.url === "/api/artifacts/" + artifactId && reply.request.init.method === "PATCH");
  assert.equal(patches.length, 1); assert.equal(patches[0].status, 200);
  assert.equal(patches[0].request.body.expectedRevision, 0); assert.equal(patches[0].request.body.markdown, revisedMarkdown);
  assert.equal(patches[0].request.body.items.length, 2);
  for (let index = 0; index < revisedItems.length; index++) for (const [key, value] of Object.entries(revisedItems[index])) assert.equal(patches[0].request.body.items[index][key], value);
  const artifact = currentArtifact(f), raw = h.store.content.get()[artifact.contentRef], savedHash = currentHash(f);
  assert.equal(JSON.parse(raw).content_markdown, revisedMarkdown); assert.notEqual(savedHash, originalHash);
  for (let index = 0; index < revisedItems.length; index++) for (const [key, value] of Object.entries(revisedItems[index])) assert.equal(JSON.parse(raw).items[index][key], value);
  assert.deepEqual(documentArtifactValidationIssues("storyboard", parseDocumentArtifactContent(raw), { itemCount: 2 }), []);
  assert.equal(currentReview(f).status, "draft");
  assert.equal(currentArtifact(f).mediaUrl, null, "these retained Storyboard frames do not claim a generated movie or soundtrack");
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
  const beforeStale = await readWorkspaceEvents(worker.env, worker.streamId);
  const stale = await worker.request("/api/events", worker.json({ events: [{ type: "ArtifactApproved", payload: { ...request.body.appended[0].payload, artifact_revision: 0, content_sha256: originalHash } }] }));
  const staleBody = await stale.json(); assert.equal(stale.status, 409); assert.equal(staleBody.error, "stale_review_context");
  assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), beforeStale, "rejected stale approval appends no history");
  assert.equal(currentDelivery(f).approved, false); assert.equal(currentDelivery(f).releaseAllowed, false);
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
  const download = methodButton(f, "#downloadMediaArchive(artifact)"); assert.equal(disabled(download), false); click(f, download);
  await settle(f, () => downloads.length === 1, "actual authorized Storyboard archive Blob reaches native anchor click");
  const exported = downloads[0].receipt; assert.equal(exported.status, 200);
  for (const [key, value] of Object.entries(expected)) assert.equal(exported.body.appended[0].payload[key], value);
  assert.equal(exported.body.appended[0].payload.format, "application/zip"); assert.equal(exported.body.appended[0].payload.artifact_kind, "storyboard");
  assert.equal(exported.body.appended[0].actor, "user:" + sharing.reviewer);
  const archive = await readStoryboardArchive(outputDirectory, downloads[0], q, savedHash);
  assert.equal(currentHash(f), savedHash); assert.equal(q.revision(), 1); assert.deepEqual([...q.bucket], q.frozenMedia, "all actual retained frame bytes and metadata remain unchanged");
  const actual = await readWorkspaceEvents(worker.env, worker.streamId);
  const chain = actual.filter(event => event.payload.artifact_id === artifactId && ["DocumentArtifactEdited", "ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"].includes(event.type));
  assert.deepEqual(chain.map(event => event.type), ["DocumentArtifactEdited", "ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"]);
  assert.ok(h.requests.filter(request => ["POST", "PATCH", "DELETE"].includes(request.init.method)).every(request => request.url === "/api/artifacts/" + artifactId && request.init.method === "PATCH"
    || ["ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"].some(type => isType(request, type))), "only the explicit RAM edit/review/export chain writes");
  assert.deepEqual(finances(), beforeFinances);
  for (const row of q.priorRows) assert.deepEqual(worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(row.content_id), row, "original Story content remains exact after Storyboard edit/review/export");
  for (const row of q.priorHistory) assert.deepEqual(worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(row.event_id), row, "original Story history remains exact");
  t.diagnostic("STORYBOARD_REVISION_REVIEW_FILE " + JSON.stringify({ artifactId, kind: "storyboard", revision: 1, savedHash, editor: owner, syntheticReviewer: sharing.reviewer,
    staleApproval: { status: stale.status, error: staleBody.error }, archive,
    sequence: chain.map(event => ({ type: event.type, eventId: event.eventId, actor: event.actor })),
    limit: "Actual component handlers, Store and RAM Worker media reads/review/export, actual ZIP exporter, production Blob and reopened complete archive. Two declared3x2 synthetic PNG frames establish byte/order/custody only, not image quality or a generated story. No browser Download event, storyboard application rendering, human independent review, recipient delivery, provider generation, soundtrack, or production IAM claim." }));
  } finally { assert.deepEqual(finances(), beforeFinances); }
});
