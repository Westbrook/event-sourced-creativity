import assert from "node:assert/strict";
import test from "node:test";
import {
  createReviewHost, nodes, disabled, primary, panelOpen, reviewControl, text,
  settle, click, change, openGallery, promote, currentArtifact, currentHash, currentReview,
  currentDelivery, currentWorkflow, workflowStates, loadActual, RendererPort, createReviewCanvas, hash,
} from "./helpers/artifact-review-host.mjs";
import * as deliveryModel from "../src/model/artifact-delivery.ts";
const { artifactApprovalMatches, artifactReviewBindingMatches } = deliveryModel;
import { artifactDeliveryFor } from "../src/state/artifact-delivery-context.ts";
import { artifactFocusOptionsFromRoute } from "../src/model/routes.ts";
import { foldEvents } from "../src/model/events.ts";
import { artifactReviewState } from "../src/model/context-health.ts";
import { productionWorkflowStageStates } from "../src/model/production-workflow.ts";
import { appendAuditEvent } from "../worker/runtime.ts";

const locales = ["en", "fr", "ar", "ja"];
const expectedReview = {
  en: "Review required output",
  fr: "Effectuer la révision requise du résultat",
  ar: "إجراء المراجعة المطلوبة للمخرج",
  ja: "出力の必要なレビューを行う",
};
const reviewWrites = h => h.requests.filter(request => request.url === "/api/events" && request.body?.events?.some(event =>
  ["ArtifactReviewRequested", "ArtifactApproved", "ArtifactChangesRequested"].includes(event.type)));
const replyFor = (replies, type) => replies.find(reply => reply.request.body?.events?.some(event => event.type === type));
const currentBinding = f => ({ artifact_id: f.artifactId, document_id: f.host.documentId, artifact_revision: 0, content_sha256: currentHash(f) });

// Negative pure projections of an ACTUAL acknowledged personal pair. They never
// replace current Store state or simulate a successful response.
function verifyRecordedPairControls(f) {
  const events = structuredClone(f.store.events.get()), artifact = currentArtifact(f), bytes = currentHash(f), workflow = currentWorkflow(f);
  const requestIndex = events.findLastIndex(event => event.type === "ArtifactReviewRequested" && event.payload.artifact_id === artifact.id);
  const approvalIndex = events.findLastIndex(event => event.type === "ArtifactApproved" && event.payload.artifact_id === artifact.id);
  assert.ok(requestIndex >= 0 && approvalIndex > requestIndex);
  const malformed = [
    ["missing request", rows => rows.splice(requestIndex, 1)],
    ["missing request digest", rows => { delete rows[requestIndex].payload.content_sha256; }],
    ["missing approval digest", rows => { delete rows[approvalIndex].payload.content_sha256; }],
    ["request digest mismatch", rows => { rows[requestIndex].payload.content_sha256 = hash("different reviewed bytes"); }],
    ["approval digest mismatch", rows => { rows[approvalIndex].payload.content_sha256 = hash("different approved bytes"); }],
    ["request revision mismatch", rows => { rows[requestIndex].payload.artifact_revision = 1; }],
    ["approval revision mismatch", rows => { rows[approvalIndex].payload.artifact_revision = 1; }],
    ["request document mismatch", rows => { rows[requestIndex].payload.document_id = "other-document"; }],
    ["approval document mismatch", rows => { rows[approvalIndex].payload.document_id = "other-document"; }],
    ["request actor unavailable", rows => { rows[requestIndex].actor = "worker:renderer"; }],
    ["approval actor unavailable", rows => { rows[approvalIndex].actor = "worker:renderer"; }],
    ["new request invalidates approval", rows => { rows.push({ ...rows[requestIndex], eventId: "later-review-request", sequence: rows.at(-1).sequence + 1 }); }],
    ["later changes invalidate approval", rows => { rows.push({ ...rows[approvalIndex], type: "ArtifactChangesRequested", eventId: "later-review-changes", sequence: rows.at(-1).sequence + 1 }); }],
  ];
  for (const [label, change] of malformed) {
    const changed = structuredClone(events); change(changed);
    assert.equal(artifactReviewBindingMatches(artifact, changed, 0, bytes), false, label);
    const projection = foldEvents(changed, Infinity, artifact.documentId, workflow.projectId);
    const states = productionWorkflowStageStates(workflow, projection, changed);
    assert.notEqual(states[0].status, "approved", label);
    if (!states[0].stage.final) assert.equal(states.at(-1).status, "blocked", label);
  }
  if (!workflow.stages[0].final) {
    const changed = structuredClone(workflow);
    changed.stages[0].source.contentSha256 = hash("a different selected source");
    assert.equal(productionWorkflowStageStates(changed, f.store.projection.get(), events)[0].status, "needs-review", "selected source digest participates in required review");
    changed.stages[0].source.revision = 1;
    assert.equal(productionWorkflowStageStates(changed, f.store.projection.get(), events)[0].status, "stale", "a selected revision cannot silently adopt another output revision");
  }
  const stale = structuredClone(f.store.projection.get());
  const block = stale.libraryBlocks.find(value => value.id === "scene-reuse-direction");
  block.sourceEvents.push("new-source-revision");
  assert.equal(productionWorkflowStageStates(workflow, stale, events)[0].status, "stale", "review cannot make changed inputs current");
  const revoked = structuredClone(f.store.projection.get());
  revoked.libraryBlocks.find(value => value.id === "scene-reuse-direction").properties.rights_revoked = true;
  assert.equal(productionWorkflowStageStates(workflow, revoked, events)[0].status, "stale", "review cannot repair revoked source rights");
  assert.equal(artifactDeliveryFor(f.store, artifact, hash("different retained bytes")).action, "reviewPersonal", "viewer uses its real digest rather than only a recorded claim");
  assert.equal(artifactDeliveryFor(f.store, artifact, null).action, "inspect", "known missing private bytes never become a review or export permission");
  assert.equal(artifactApprovalMatches(artifact, events, 0, bytes), false, "all personal controls retain independent-review exclusion");
}


for (const locale of locales) for (const legacy of ["missing-binding", "nonindependent"]) {
  test("historical approval " + locale + "/" + legacy + ": current Assign reaches a real independent reassignment", async t => {
    const { f, h, worker, replies, switchActor, sharing, initialCounts } = await createReviewHost(t, { locale, shared: true, legacy });
    const bytes = currentHash(f), before = h.store.events.get().length;
    assert.equal(currentReview(f).status, "approved");
    assert.equal(currentDelivery(f).approved, false);
    assert.equal(currentDelivery(f).action, "assign");
    await openGallery(f); await promote(f);
    assert.equal(panelOpen(f), true);
    const request = reviewControl(f, "ArtifactReviewRequested");
    assert.ok(request, "current exact-invalid historical approval must still expose assignment");
    assert.equal(disabled(request), false);
    assert.equal(reviewControl(f, "ArtifactApproved"), undefined, "the original author never gains self-approval");
    const selector = nodes(f, "select").find(node => node.handlers.change?.toString().includes("#selectedReviewerId"));
    assert.equal(selector.value, sharing.reviewer);
    const members = replies.find(reply => reply.request.url === sharing.base + "/members");
    assert.equal(members.status, 200);
    assert.equal(Boolean(members.body.members.find(member => member.user_id === sharing.reviewer)?.review_access), true);
    click(f, request);
    await settle(f, () => currentReview(f).status === "in-review", "actual Store/Worker acknowledged exact reassignment");
    assert.equal(reviewWrites(h).length, 1);
    const response = replyFor(replies, "ArtifactReviewRequested");
    assert.equal(response.status, 200);
    assert.equal(response.body.appended.length, 1);
    const sent = response.request.body.events.find(event => event.type === "ArtifactReviewRequested").payload;
    for (const [key, value] of Object.entries(currentBinding(f))) assert.equal(sent[key], value);
    assert.equal(sent.assigned_reviewer_user_id, sharing.reviewer);
    assert.equal(response.body.appended[0].payload.content_sha256, bytes);
    assert.ok(h.store.events.get().length > before);
    assert.equal(currentHash(f), bytes);
    assert.equal(worker.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentArtifactEdited' AND json_extract(payload,'$.artifact_id')=?").get(f.artifactId).count, 0);
    await switchActor("reviewer");
    await openGallery(f); await promote(f);
    assert.equal(currentDelivery(f).action, "review");
    const approve = reviewControl(f, "ArtifactApproved"); assert.ok(approve); assert.equal(disabled(approve), false);
    click(f, approve);
    await settle(f, () => currentDelivery(f).approved, "actual independent reviewer decides the newly assigned exact revision");
    const decision = replyFor(replies, "ArtifactApproved");
    assert.equal(decision.status, 200); assert.equal(decision.body.appended.length, 1);
    assert.equal(decision.body.appended[0].actor, "user:" + sharing.reviewer);
    assert.equal(artifactApprovalMatches(currentArtifact(f), h.store.events.get(), 0, bytes), true);
    assert.equal(currentDelivery(f).action, "export"); assert.equal(currentDelivery(f).releaseAllowed, true);
    assert.deepEqual(worker.counts(), initialCounts);
    assert.equal(reviewWrites(h).length, 2);
  });
}

for (const locale of locales) {
  test("personal required review " + locale + ": existing workflow and exact personal review stay reachable without independent approval", async t => {
    const { f, h, worker, replies, initialCounts } = await createReviewHost(t, { locale });
    const bytes = currentHash(f);
    assert.equal(workflowStates(f)[0].status, "selected");
    assert.equal(workflowStates(f).at(-1).status, "ready");
    assert.equal(currentDelivery(f).action, "exportPersonal");
    const required = nodes(f, "input").find(node => node.handlers.change?.toString().includes("const approvalRequired"));
    await change(f, required, true);
    await settle(f, () => currentWorkflow(f).stages[0].approvalRequired, "actual workflow requirement acknowledgment");
    assert.equal(workflowStates(f)[0].inputFreshness, "current");
    assert.equal(workflowStates(f)[0].status, "needs-review");
    assert.equal(workflowStates(f).at(-1).status, "blocked");
    assert.equal(currentDelivery(f).action, "reviewPersonal");
    const finalCreate = nodes(f, "button").filter(node => node.attributes.type === "submit");
    assert.equal(finalCreate.length, 1); assert.equal(disabled(finalCreate[0]), true);
    const open = nodes(f, "button").find(node => text(f, node) === f.i18n.t("workflow.open", "Open and review"));
    click(f, open);
    await settle(f, () => Boolean(primary(f)) && panelOpen(f), "workflow's explicit Open and review opens its actual review form");
    assert.equal(text(f, primary(f)), expectedReview[locale]);
    click(f, reviewControl(f, "ArtifactReviewRequested"));
    await settle(f, () => currentReview(f).status === "in-review", "actual personal review request acknowledgment");
    const requested = replyFor(replies, "ArtifactReviewRequested");
    assert.equal(requested.status, 200); assert.equal(requested.body.appended.length, 1);
    assert.equal(requested.body.appended[0].actor, "user");
    assert.equal(requested.body.appended[0].streamId, worker.streamId);
    const approve = reviewControl(f, "ArtifactApproved"); assert.ok(approve); assert.equal(disabled(approve), false);
    click(f, approve);
    await settle(f, () => currentReview(f).status === "approved", "existing permitted personal review acknowledgment");
    const approved = replyFor(replies, "ArtifactApproved");
    assert.equal(approved.status, 200); assert.equal(approved.body.appended.length, 1);
    for (const response of [requested, approved]) {
      assert.equal(response.body.appended[0].payload.content_sha256, bytes);
      assert.equal(response.body.appended[0].payload.artifact_revision, 0);
    }
    assert.equal(artifactReviewBindingMatches(currentArtifact(f), h.store.events.get(), 0, bytes), true);
    assert.equal(artifactApprovalMatches(currentArtifact(f), h.store.events.get(), 0, bytes), false);
    assert.equal(workflowStates(f)[0].status, "approved"); assert.equal(workflowStates(f).at(-1).status, "ready");
    assert.equal(currentDelivery(f).approved, false, "personal review must never become independent approval");
    assert.equal(currentDelivery(f).action, "exportPersonal");
    assert.equal(text(f, primary(f)), f.i18n.t("artifact.delivery.action.exportPersonal"));
    assert.equal(currentHash(f), bytes);
    assert.equal(reviewWrites(h).length, 2); assert.deepEqual(worker.counts(), initialCounts);
    verifyRecordedPairControls(f);
  });
}

const { FormaDeliver } = await loadActual("src/components/forma-deliver.ts");
const { FormaActivity } = await loadActual("src/components/forma-activity.ts");
for (const locale of locales) {
  test("required-review routing " + locale + ": the current Deliver and Activity use the same explicit workflow policy", async t => {
    const { f, h } = await createReviewHost(t, { locale });
    const required = nodes(f, "input").find(node => node.handlers.change?.toString().includes("const approvalRequired"));
    await change(f, required, true); await settle(f, () => currentWorkflow(f).stages[0].approvalRequired);
    for (const Constructor of [FormaDeliver, FormaActivity]) {
      const host = new Constructor(); host.store = h.store; host.i18n = f.i18n; host.fixture = f; host.isConnected = true;
      const renderer = new RendererPort(f, {}); renderer.draw(host);
      const action = renderer.ownNodes(host, "a").find(node => node.classList.contains("button")
        && String(node.attributes.href).includes(encodeURIComponent(f.artifactId)));
      assert.ok(action, "full current surface emits the exact artifact action");
      const options = artifactFocusOptionsFromRoute(action.attributes.href);
      assert.equal(options.intent, "review");
      assert.equal(options.expectedRevision, 0);
      assert.equal(artifactDeliveryFor(h.store, currentArtifact(f)).action, "reviewPersonal");
    }
    assert.equal(reviewWrites(h).length, 0, "routing only does not request or decide a review");
  });
}

for (const locale of locales) {
  test("personal required final " + locale + ": an exact permitted review replaces an invalid historical pair without independent approval", async t => {
    const { f, h, replies, worker, initialCounts } = await createReviewHost(t, { locale, final: true, legacy: "missing-binding" });
    assert.equal(currentReview(f).status, "approved", "the legacy label alone is not a completed required checkpoint");
    assert.equal(workflowStates(f)[0].status, "needs-review");
    assert.equal(currentDelivery(f).action, "reviewPersonal");
    await openGallery(f); await promote(f);
    assert.equal(text(f, primary(f)), expectedReview[locale]);
    click(f, reviewControl(f, "ArtifactReviewRequested"));
    await settle(f, () => currentReview(f).status === "in-review");
    click(f, reviewControl(f, "ArtifactApproved"));
    await settle(f, () => currentReview(f).status === "approved");
    for (const type of ["ArtifactReviewRequested", "ArtifactApproved"]) {
      const response = replyFor(replies, type);
      assert.equal(response.status, 200); assert.equal(response.body.appended.length, 1);
      assert.equal(response.body.appended[0].payload.content_sha256, currentHash(f));
    }
    assert.equal(workflowStates(f)[0].status, "approved");
    assert.equal(currentDelivery(f).action, "exportPersonal"); assert.equal(currentDelivery(f).approved, false);
    assert.equal(reviewWrites(h).length, 2); assert.deepEqual(worker.counts(), initialCounts);
    verifyRecordedPairControls(f);
  });
}

for (const locale of locales) for (const blocker of ["unverified", "stale", "rights"]) {
  test("required-review blocker " + locale + "/" + blocker + ": inspection/source guidance remains reachable without a dead Review primary", async t => {
    const { f, h, worker } = await createReviewHost(t, { locale, unverified: blocker === "unverified" });
    const required = nodes(f, "input").find(node => node.handlers.change?.toString().includes("const approvalRequired"));
    await change(f, required, true); await settle(f, () => currentWorkflow(f).stages[0].approvalRequired);
    if (blocker !== "unverified") {
      await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, "ChipEdited",
        { project_id: worker.projectId, document_id: worker.documentId, block_id: "scene-reuse-direction",
          property: blocker === "rights" ? "rights_revoked" : "text", new_value: blocker === "rights" ? true : "New exact source after generation" });
      await h.store.refreshEvents(); f.draw();
    }
    assert.equal(currentReview(f).status, blocker === "unverified" ? "unverified" : "stale");
    assert.equal(workflowStates(f)[0].status, "stale"); assert.equal(workflowStates(f).at(-1).status, "blocked");
    assert.equal(currentDelivery(f).action, blocker === "unverified" ? "inspect" : "sources");
    const open = nodes(f, "button").find(node => text(f, node) === f.i18n.t("workflow.open", "Open and review"));
    click(f, open); await settle(f, () => Boolean(primary(f)) && panelOpen(f));
    assert.notEqual(text(f, primary(f)), expectedReview[locale]);
    assert.equal(disabled(reviewControl(f, "ArtifactReviewRequested")), true);
    assert.equal(disabled(reviewControl(f, "ArtifactApproved")), true);
    if (blocker === "unverified") assert.ok(f.renderer.markup.includes(f.i18n.t("artifact.review.unverified.label", "Input revision unavailable")));
    else {
      assert.ok(f.renderer.markup.includes(f.i18n.t("artifact.delivery.sourcesChanged")));
      assert.ok(nodes(f, "a").some(node => String(node.attributes.href).includes("scene-reuse-direction")), "the exact current input is reachable without editing or regenerating the output");
    }
    assert.equal(reviewWrites(h).length, 0);
  });
}

for (const locale of locales) {
  test("required-review Canvas " + locale + ": current board output hands off to the real exact Document review form", async t => {
    const host = await createReviewHost(t, { locale }), { f, h } = host;
    const required = nodes(f, "input").find(node => node.handlers.change?.toString().includes("const approvalRequired"));
    await change(f, required, true); await settle(f, () => currentWorkflow(f).stages[0].approvalRequired);
    const canvas = await createReviewCanvas(t, host, locale);
    await canvas.click("button", node => node.classList.contains("canvas-artifact-open"));
    await settle(canvas, () => canvas.renderer.ownNodes(canvas.host, "dialog").some(node => node.classList.contains("canvas-artifact-viewer")));
    const action = canvas.renderer.ownNodes(canvas.host, "button").find(node => node.handlers.click?.toString().includes("#openArtifactDelivery"));
    assert.ok(action); assert.equal(text(canvas, action), expectedReview[locale]);
    await canvas.click("button", node => node === action);
    await settle(canvas, () => {
      const viewer = canvas.renderer.query(canvas.host, "forma-document-artifacts")[0];
      return Boolean(viewer && canvas.renderer.ownNodes(viewer, "dialog").some(node => node.open && node.classList.contains("document-artifact-view")));
    }, "current Canvas hands off through actual openArtifactById");
    const viewer = canvas.renderer.query(canvas.host, "forma-document-artifacts")[0];
    const view = { ...canvas, host: viewer, artifactId: f.artifactId, store: h.store };
    assert.equal(panelOpen(view), true); assert.equal(text(view, primary(view)), expectedReview[locale]);
    assert.equal(artifactDeliveryFor(h.store, currentArtifact(f), undefined, "review-board").action, "reviewPersonal");
    assert.equal(reviewWrites(h).length, 0);
    const request = reviewControl(view, "ArtifactReviewRequested");
    assert.ok(request && canvas.renderer.nodes.includes(request) && request.isConnected);
    assert.equal(disabled(request), false);
    await canvas.renderer.handler(viewer, "button", node => node === request)();
    await settle(canvas, () => artifactReviewState(currentArtifact(f), h.store.projection.get().libraryBlocks, h.store.events.get()).status === "in-review");
    assert.equal(reviewWrites(h).length, 1);
    assert.equal(replyFor(host.replies, "ArtifactReviewRequested").status, 200);
    assert.equal(h.store.route.get(), "/canvas/review-board/review-board", "review stays on the current board rather than replacing or regenerating an output");
  });
}

for (const locale of locales) for (const shared of [false, true]) {
  test("healthy existing delivery " + locale + "/" + (shared ? "shared" : "personal") + ": no configured review requirement invents an extra prerequisite", async t => {
    const { f, h } = await createReviewHost(t, { locale, shared, legacy: shared ? "exact" : null });
    assert.equal(currentDelivery(f).action, shared ? "export" : "exportPersonal");
    assert.equal(currentDelivery(f).approved, shared);
    assert.equal(currentDelivery(f).releaseAllowed, true);
    await openGallery(f); await promote(f);
    assert.equal(text(f, primary(f)), f.i18n.t("artifact.delivery.action." + (shared ? "export" : "exportPersonal")));
    assert.equal(panelOpen(f), false);
    assert.ok(nodes(f, "footer").some(node => node.attributes["data-actions-open"] === "true"));
    if (shared) assert.equal(reviewControl(f, "ArtifactReviewRequested"), undefined, "a current independently approved output does not require reassignment");
    assert.equal(reviewWrites(h).length, 0);
  });
}
