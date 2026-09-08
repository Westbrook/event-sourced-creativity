import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveObjectURL } from "node:buffer";
import {
  createReviewHost, nodes, disabled, reviewControl, settle, click, openGallery, promote,
  currentArtifact, currentHash, currentReview, currentDelivery, hash,
} from "./helpers/artifact-review-host.mjs";
import { artifactApprovalMatches } from "../src/model/artifact-delivery.ts";
import { readWorkspaceEvents } from "../worker/runtime.ts";

// One composition of existing actual viewer/Store/Worker fixtures. Distinct
// synthetic principals exercise authorization; no human approval is claimed.
const revisedMarkdown = "# The Signal Garden\n\nMara saved the last signal before dawn.\n\n“Keep the gate open,” she wrote — café, 雨, and 🌱 intact.\n\nThe garden answered.\n";
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
      assert.equal(this.download, "exact-review-source.md");
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

test("Story saved revision 1 reaches a new exact synthetic review and a readable Markdown file", { timeout: 60_000 }, async t => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "forma-story-revision-review-file-"));
  t.after(() => rm(outputDirectory, { recursive: true }));
  const q = await createReviewHost(t, { locale: "en", shared: true }), { f, h, worker, sharing } = q;
  const artifactId = f.artifactId, originalHash = currentHash(f), owner = h.store.session.get().user.userId;
  assert.equal(q.revision(), 0); assert.equal(currentArtifact(f).kind, "short_story");
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
  const artifact = currentArtifact(f), raw = h.store.content.get()[artifact.contentRef], savedHash = currentHash(f);
  assert.equal(JSON.parse(raw).content_markdown, revisedMarkdown); assert.notEqual(savedHash, originalHash);
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
  t.diagnostic("STORY_REVISION_REVIEW_FILE " + JSON.stringify({ artifactId, revision: 1, savedHash, editor: owner, syntheticReviewer: sharing.reviewer,
    file, bytes: opened.length, fileSha256: hash(opened), sequence: chain.map(event => ({ type: event.type, eventId: event.eventId, actor: event.actor })),
    limit: "Actual component handlers, Store and RAM Worker plus a materialized production Blob. Native-control port only: not a browser download, human independent review, recipient delivery or provider-generation claim." }));
  } finally { assert.deepEqual(finances(), beforeFinances); }
});
