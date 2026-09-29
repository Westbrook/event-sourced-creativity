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
import { wav } from "./output-asset-fixtures.mjs";
import { storeGeneratedMedia } from "../worker/media-api.ts";

// Existing reviewed native frame and actual reviewer setup. Re-export only
// these fixture declarations; no application method or export response changes.
const hostUrl = pathToFileURL(fs.realpathSync(new URL("./helpers/artifact-review-host.mjs", import.meta.url)));
const hostSource = fs.readFileSync(hostUrl, "utf8"), hostVirtual = hostUrl.href + "?audio-review-file-setup";
const hostHook = registerHooks({ load(url, context, next) {
  return url === hostVirtual ? { format: "module", source: hostSource + "\nexport {fixture,shareWithIndependentReviewer};\n", shortCircuit: true } : next(url, context);
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
const retainedAudio = wav({ samples: 16000, sampleRate: 8000, channels: 1 });
const transcript = "# Harbor narration reference\n\nMara checks the café window before the evening watch.\nThe keeper marks 雨 beside the safe channel and leaves a green 🌱 on the chart.\n";
const listeningNote = "Declared silent PCM fixture. This reference transcript is retained text, not a claim that the fixture speaks it.";
const originalItems = [{ title: "Harbor listening reference", body: transcript, notes: listeningNote, image_prompt: "", context_group_ids: [], slide: null }];

async function createAudioReviewHost(t) {
  const worker = await createSceneCostFixture(1, "visual", { depth: true });
  const priorRows = worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all();
  const priorHistory = worker.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();
  const artifactId = "retained-audio-review-file";
  const draft = { title: "Harbor narration", summary: "Declared retained PCM fixture and reference transcript for exact review/file verification.",
    content_markdown: transcript, presentation: null, items: originalItems };
  assert.deepEqual(documentArtifactValidationIssues("audio", parseDocumentArtifactContent(JSON.stringify(draft)), { itemCount: 1 }), []);
  const retained = JSON.stringify(draft), stored = await storePrivateContent(worker.env, worker.owner, "document-artifact", retained);
  const bucket = retainActualUploadedMedia({ worker });
  const media = await storeGeneratedMedia(worker.env, worker.owner, artifactId + "-audio", retainedAudio, "retained-audio-fixture", "audio/wav", { source: "synthetic-retained-fixture", provider: "simulation" });
  assert.deepEqual(bucket.get(media.key).bytes, retainedAudio); assert.equal(bucket.get(media.key).customMetadata.ownerId, worker.owner);
  const frozenMedia = structuredClone([...bucket]);
  const completion = await appendAuditEvent(worker.env, worker.streamId, "worker:renderer", "DocumentRenderCompleted", {
    project_id: worker.projectId, document_id: worker.documentId, artifact_id: artifactId, artifact_kind: "audio",
    title: draft.title, summary: draft.summary, content_ref: stored.contentId, item_count: 1,
    source_block_versions: [{ block_id: "scene-reuse-direction", version: 1 }], requested_by_user_id: worker.owner,
    items: [{ id: artifactId + "-part", title: originalItems[0].title, media_url: media.url, media_type: "audio/wav", duration_seconds: 2 }],
    media_url: media.url, media_type: "audio/wav", settings: { audio_role: "voice", duration_seconds: 2 },
    provider: "simulation", model_id: "retained-audio-fixture", simulation: true, source_surface: "document",
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
        ...(mime.startsWith("audio/") ? { mime, bytes: new Uint8Array(await copy.arrayBuffer()) } : {}) }); return response;
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

// Exact current revision only. The control neither calls an Audio editor nor
// invents an edited-waveform operation. Distinct principals are synthetic.
const isType = (request, type) => request.url === "/api/events"
  && (request.body?.events ?? [request.body?.event]).some(event => event?.type === type);
const replyFor = (q, type) => q.replies.find(reply => isType(reply.request, type));
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
function installAudioFilePorts(t, f, q) {
  const document = f.host.ownerDocument, window = document.defaultView;
  const downloads = [], pending = new Set(), errors = [], timers = [], attached = new Set(), blobUrls = [];
  const descriptors = [document, "createElement", document, "body", window, "setTimeout"];
  const prior = [0,2,4].map(index => Object.getOwnPropertyDescriptor(descriptors[index], descriptors[index+1]));
  Object.defineProperty(document, "createElement", { configurable: true, value(tag) {
    assert.equal(tag, "a");
    return { href: "", download: "", click() {
      const receipts = q.replies.filter(reply => isType(reply.request, "DocumentArtifactExported"));
      const receipt = receipts.at(-1); assert.equal(receipt?.status, 200, "real export ACK precedes native download activation");
      assert.equal(receipts.length, downloads.length + 1, "one new actual authorization per native download");
      const href = this.href, filename = this.download;
      if (href.startsWith("blob:")) {
        const blob = resolveObjectURL(href); assert.ok(blob instanceof Blob); assert.equal(blob.type, "text/markdown;charset=utf-8");
        assert.equal(filename, "harbor-narration.md"); blobUrls.push(href); downloads.push({ blob, href, filename, receipt }); return;
      }
      assert.ok(attached.has(this)); assert.equal(href, q.media.url); assert.equal(filename, "Harbor narration.wav");
      // The missing browser download navigation port follows only the actual
      // application's exact authorized href through the real RAM Worker route.
      // It creates no media response or export acknowledgment itself.
      const work = (async () => {
        const response = await q.h.fetch(href, { credentials: "same-origin" });
        assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "audio/wav");
        const blob = await response.blob(); assert.equal(blob.type, "audio/wav");
        downloads.push({ blob, href, filename, receipt });
      })();
      pending.add(work); work.catch(error => errors.push(error)).finally(() => pending.delete(work));
    }, remove() { assert.equal(attached.delete(this), true); } };
  } });
  Object.defineProperty(document, "body", { configurable: true, value: { append(anchor) { assert.equal(attached.has(anchor), false); attached.add(anchor); } } });
  Object.defineProperty(window, "setTimeout", { configurable: true, value(callback, ms) {
    assert.equal(ms, 1_000, "only the existing Markdown object-URL cleanup timer"); timers.push(callback); return timers.length;
  } });
  const drain = async () => { while (pending.size) await Promise.allSettled([...pending]); assert.deepEqual(errors, []); };
  t.after(async () => {
    try { await drain(); }
    finally {
      try {
        for (const callback of timers.splice(0)) callback();
        for (const href of blobUrls) assert.equal(resolveObjectURL(href), undefined);
        assert.equal(attached.size, 0);
      } finally {
        [0,2,4].forEach((index, ordinal) => { if (prior[ordinal]) Object.defineProperty(descriptors[index], descriptors[index+1], prior[ordinal]); else delete descriptors[index][descriptors[index+1]]; });
      }
    }
  });
  return { downloads, pending, errors, drain };
}
async function preserveFiles(directory, downloads, q) {
  assert.equal(downloads.length, 2);
  const files = [];
  for (const download of downloads) {
    const bytes = Buffer.from(await download.blob.arrayBuffer()), file = join(directory, download.filename);
    await writeFile(file, bytes, { flag: "wx" }); const opened = await readFile(file); assert.deepEqual(opened, bytes);
    if (download.filename.endsWith(".wav")) {
      assert.deepEqual(new Uint8Array(opened.buffer, opened.byteOffset, opened.byteLength), retainedAudio, "actual downloaded file equals all retained PCM bytes");
      assert.equal(opened.toString("ascii",0,4), "RIFF"); assert.equal(opened.readUInt32LE(4), opened.length-8); assert.equal(opened.toString("ascii",8,12), "WAVE");
      assert.equal(opened.toString("ascii",12,16), "fmt "); assert.equal(opened.readUInt32LE(16), 16); assert.equal(opened.readUInt16LE(20), 1);
      assert.equal(opened.readUInt16LE(22), 1); assert.equal(opened.readUInt32LE(24), 8000); assert.equal(opened.readUInt32LE(28), 16000);
      assert.equal(opened.readUInt16LE(32), 2); assert.equal(opened.readUInt16LE(34), 16); assert.equal(opened.toString("ascii",36,40), "data");
      assert.equal(opened.readUInt32LE(40), 32000); assert.equal(opened.length, 32044);
      const reads = q.replies.filter(reply => reply.request.url === q.media.url);
      assert.equal(reads.length, 1); assert.equal(reads[0].status, 200); assert.deepEqual(reads[0].bytes, retainedAudio);
    } else assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(opened), transcript, "the actual Markdown export preserves the complete reference transcript");
    files.push({ file, bytes: opened.length, sha256: hash(opened), mime: download.blob.type });
  }
  return files;
}

test("Retained Audio current revision requires distinct exact review and exports original WAV plus complete transcript", { timeout: 60_000 }, async t => {
  // An explicit packet directory retains the actual exported files for independent
  // readback. It must be new; fixture/URL cleanup remains unchanged in both modes.
  const durableOutput = process.env.FORMA_AUDIO_REVIEW_OUTPUT;
  if (durableOutput) { assert.equal(path.isAbsolute(durableOutput), true); await mkdir(durableOutput); }
  const outputDirectory = durableOutput || await mkdtemp(join(tmpdir(), "forma-audio-review-file-"));
  if (!durableOutput) t.after(() => rm(outputDirectory, { recursive: true }));
  const q = await createAudioReviewHost(t), { f, h, worker, sharing } = q;
  const artifactId = f.artifactId, originalHash = currentHash(f), owner = h.store.session.get().user.userId;
  assert.equal(q.revision(), 0); assert.equal(currentArtifact(f).kind, "audio");
  assert.notEqual(sharing.reviewer, owner);
  const financialTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"];
  const finances = () => Object.fromEntries(financialTables.map(table => [table, worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
  const beforeFinances = finances();
  const port = installAudioFilePorts(t, f, q), { downloads } = port;
  try {
  await openGallery(f); await actions(f);
  assert.equal(nodes(f, "button").some(node => node.handlers.click?.toString().includes("#startArtifactEdit")), false, "this journey does not invent a finished-Audio waveform editor");
  const artifact = currentArtifact(f), raw = h.store.content.get()[artifact.contentRef], savedHash = currentHash(f);
  assert.equal(savedHash, originalHash); assert.equal(q.revision(), 0);
  const content = JSON.parse(raw); assert.equal(content.content_markdown, transcript);
  assert.equal(content.items.length, 1); assert.equal(content.items[0].body, transcript); assert.equal(content.items[0].notes, listeningNote);
  assert.equal(worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(artifact.contentRef).content, raw);
  assert.equal(currentArtifact(f).mediaUrl, q.media.url); assert.equal(currentArtifact(f).mediaType, "audio/wav");
  assert.equal(currentReview(f).status, "draft"); assert.equal(currentDelivery(f).releaseAllowed, false); assert.equal(downloads.length, 0);
  await promote(f);
  assert.equal(reviewControl(f, "ArtifactApproved"), undefined, "the author cannot self-approve");
  const assign = reviewControl(f, "ArtifactReviewRequested"); assert.ok(assign); assert.equal(disabled(assign), false);
  click(f, assign);
  await settle(f, () => currentReview(f).status === "in-review", "exact retained-revision assignment");
  const request = replyFor(q, "ArtifactReviewRequested"); assert.equal(request.status, 200);
  const expected = { artifact_id: artifactId, document_id: worker.documentId, project_id: worker.projectId, artifact_revision: 0, content_sha256: savedHash };
  for (const [key, value] of Object.entries(expected)) assert.equal(request.body.appended[0].payload[key], value);
  assert.equal(request.body.appended[0].payload.assigned_reviewer_user_id, sharing.reviewer);
  assert.equal(currentDelivery(f).releaseAllowed, false);

  await q.switchActor("reviewer");
  await openGallery(f); await promote(f);
  assert.equal(h.store.session.get().user.userId, sharing.reviewer);
  assert.equal(q.revision(), 0); assert.equal(currentHash(f), savedHash);
  assert.equal(currentDelivery(f).action, "review");
  const beforeStale = await readWorkspaceEvents(worker.env, worker.streamId);
  const stale = await worker.request("/api/events", worker.json({ events: [{ type: "ArtifactApproved", payload: { ...request.body.appended[0].payload, artifact_revision: 0, content_sha256: "0".repeat(64) } }] }));
  const staleBody = await stale.json(); assert.equal(stale.status, 409); assert.equal(staleBody.error, "stale_review_context");
  assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), beforeStale, "rejected wrong-hash approval appends no history");
  assert.equal(currentDelivery(f).approved, false); assert.equal(currentDelivery(f).releaseAllowed, false);
  const approve = reviewControl(f, "ArtifactApproved"); assert.ok(approve); assert.equal(disabled(approve), false);
  click(f, approve);
  await settle(f, () => currentDelivery(f).approved, "actual distinct synthetic reviewer decision on retained revision 0");
  const decision = replyFor(q, "ArtifactApproved"); assert.equal(decision.status, 200);
  assert.equal(decision.body.appended[0].actor, "user:" + sharing.reviewer);
  for (const [key, value] of Object.entries(expected)) assert.equal(decision.body.appended[0].payload[key], value);
  assert.equal(artifactApprovalMatches(currentArtifact(f), h.store.events.get(), 0, savedHash), true);
  assert.equal(artifactApprovalMatches(currentArtifact(f), h.store.events.get(), 0, "0".repeat(64)), false, "approval cannot be applied to different bytes at the same revision");
  assert.equal(currentDelivery(f).releaseAllowed, true);

  await promote(f); await actions(f);
  const audio = methodButton(f, "#downloadMedia(artifact)"); assert.equal(disabled(audio), false); click(f, audio);
  await settle(f, () => downloads.length === 1 || port.errors.length > 0, "actual authorized Audio download receives the Worker media response"); await port.drain();
  const mediaExport = downloads[0].receipt;
  for (const [key, value] of Object.entries(expected)) assert.equal(mediaExport.body.appended[0].payload[key], value);
  assert.equal(mediaExport.body.appended[0].payload.artifact_kind, "audio"); assert.equal(mediaExport.body.appended[0].payload.format, "audio/wav"); assert.equal(mediaExport.body.appended[0].actor, "user:" + sharing.reviewer);
  const markdown = methodButton(f, "#download(artifact)"); assert.equal(disabled(markdown), false); click(f, markdown);
  await settle(f, () => downloads.length === 2, "actual authorized transcript Blob reaches the native anchor");
  const textExport = downloads[1].receipt;
  for (const [key, value] of Object.entries(expected)) assert.equal(textExport.body.appended[0].payload[key], value);
  assert.equal(textExport.body.appended[0].payload.artifact_kind, "audio"); assert.equal(textExport.body.appended[0].payload.format, "markdown"); assert.equal(textExport.body.appended[0].actor, "user:" + sharing.reviewer);
  const files = await preserveFiles(outputDirectory, downloads, q);
  assert.equal(currentHash(f), savedHash); assert.equal(q.revision(), 0); assert.deepEqual([...q.bucket], q.frozenMedia, "actual retained Audio bytes and metadata remain unchanged");
  const actual = await readWorkspaceEvents(worker.env, worker.streamId);
  const chain = actual.filter(event => event.payload.artifact_id === artifactId && ["ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"].includes(event.type));
  assert.deepEqual(chain.map(event => event.type), ["ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported", "DocumentArtifactExported"]);
  assert.ok(h.requests.filter(request => ["POST", "PATCH", "DELETE"].includes(request.init.method)).every(request => ["ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"].some(type => isType(request, type))), "only the explicit RAM review/export writes; no edit, generation or additional workflow is performed");
  assert.deepEqual(finances(), beforeFinances);
  for (const row of q.priorRows) assert.deepEqual(worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(row.content_id), row, "original Story content remains exact after Audio review/export");
  for (const row of q.priorHistory) assert.deepEqual(worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(row.event_id), row, "original Story history remains exact");
  t.diagnostic("AUDIO_REVIEW_FILE " + JSON.stringify({ artifactId, kind: "audio", revision: 0, savedHash, author: owner, syntheticReviewer: sharing.reviewer,
    wrongHashApproval: { status: stale.status, error: staleBody.error }, files,
    sequence: chain.map(event => ({ type: event.type, eventId: event.eventId, actor: event.actor })),
    limit: "Actual retained Audio revision0, component review/export handlers, Store and RAM Worker authorization/media route, native download-navigation port, original PCM WAV and production transcript Blob, both preserved and reopened. Silent2second fixture proves media decodability/custody, not spoken narration or listening quality. No Audio editing, browser Download event, human independent review, recipient delivery, provider generation, productionIAM, or accepted-playback rerun claim." }));
  } finally { assert.deepEqual(finances(), beforeFinances); }
});
