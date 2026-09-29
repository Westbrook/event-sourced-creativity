import assert from "node:assert/strict";
import test from "node:test";
import {
  createReviewHost, openGallery, currentArtifact, currentHash, currentDelivery, currentReview,
  nodes, primary, text, click, settle, panelOpen, promote, reviewControl, disabled, loadActual, RendererPort,
} from "./helpers/artifact-review-host.mjs";
import { appendAuditEvent } from "../worker/runtime.ts";
import { libraryFocusFromRoute } from "../src/model/routes.ts";
import { ARTIFACT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/artifact-delivery-messages.ts";

// Complete current DocumentArtifacts + Store + Worker + in-memory SQLite.
// Existing native DOM/session ports model the viewer and ordinary details default;
// these tests do not claim physical browser/AT, downloads, or recipient delivery.
// The original export authorization is real fixture setup, never a fabricated
// receipt. All tested viewing/copy gestures make zero further export requests.
const locales = ["en", "fr", "ar", "ja"];
const expected = {
  "en": {
    "downloadCurrent": "Download the current output",
    "reviewRequestedPersonal": "Review requested for this exact output revision."
  },
  "fr": {
    "downloadCurrent": "Télécharger le résultat actuel",
    "reviewRequestedPersonal": "Une révision a été demandée pour cette version exacte du résultat."
  },
  "ar": {
    "downloadCurrent": "تنزيل المخرج الحالي",
    "reviewRequestedPersonal": "تم طلب مراجعة هذه النسخة المحددة من المخرج."
  },
  "ja": {
    "downloadCurrent": "現在の出力をダウンロード",
    "reviewRequestedPersonal": "この出力の指定された版のレビューを依頼しました。"
  }
};
const financeTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"];
const finance = worker => Object.fromEntries(financeTables.map(table =>
  [table, worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
const isExport = request => request.body?.events?.some(event => event.type === "DocumentArtifactExported");

async function originalExportReceipt({ f, h, worker, replies }) {
  const artifact = currentArtifact(f), sha = currentHash(f);
  // Execute the real existing free export-authorization path. Do not replace an
  // acknowledgment or seed an imaginary committed export. No bytes are downloaded.
  const accepted = await h.store.authorizeProjectExport({
    type: "DocumentArtifactExported",
    payload: {
      artifact_id: artifact.id, artifact_kind: artifact.kind,
      document_id: artifact.documentId, project_id: worker.projectId,
      artifact_revision: 0, content_sha256: sha, format: "markdown",
      source_surface: "document-artifact-viewer",
    },
  });
  assert.equal(accepted, true);
  const reply = replies.filter(row => isExport(row.request)).at(-1);
  assert.equal(reply?.status, 200, "the current RAM Worker actually committed the exact authorization");
  const receipt = h.store.events.get().findLast(event => event.type === "DocumentArtifactExported"
    && event.payload.artifact_id === artifact.id);
  assert.ok(receipt);
  assert.ok(reply.body.appended.some(event => event.eventId === receipt.eventId));
  assert.equal(worker.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(receipt.eventId).n, 1);
  assert.equal(receipt.payload.artifact_revision, 0);
  assert.equal(receipt.payload.content_sha256, sha);
  return { receipt, sha };
}

async function revokeCurrentRights({ f, h, worker }) {
  // Reuse the existing authored-source fixture event and real source refresh.
  await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, "ChipEdited", {
    project_id: worker.projectId, document_id: worker.documentId,
    block_id: "scene-reuse-direction", property: "rights_revoked", new_value: true,
  });
  await h.store.refreshEvents();
  f.draw();
}

function openInlineEvidence(f) {
  const own = f.renderer.nodes.filter(node => node.owner === f.host), details = own.find(node => node.tag === "details"
    && node.classList.contains("artifact-viewer-details"));
  assert.ok(details?.isConnected);
  const summary = own.slice(own.indexOf(details) + 1).find(node => node.tag === "summary");
  assert.ok(summary?.isConnected && typeof summary.click === "function");
  assert.deepEqual(Object.keys(summary.handlers), [], "the disclosure uses ordinary native summary behavior");
  const start = f.renderer.markup.indexOf(details.full);
  assert.ok(start >= 0);
  const html = f.renderer.markup.slice(start, f.renderer.markup.indexOf("</details>", start));
  assert.ok(html.includes(f.i18n.t("production.evidence", "Review production evidence")));
  // Existing RendererPort models native buttons/popovers, not summary defaults.
  // Reflect only the standard UA default after activating the current summary;
  // do not invoke a private product method, removed handler, or replacement UI.
  summary.click();
  details.open = true;
  details.setAttribute("open", "");
  assert.equal(details.open, true);
  assert.ok(nodes(f, "dialog").some(node => node.classList.contains("document-artifact-view") && node.open));
  return html;
}

function unchanged(fixture, before, originalReceipts) {
  assert.deepEqual(finance(fixture.worker), before, "all inspected original financial and job rows remain byte-for-byte unchanged");
  assert.equal(fixture.replies.filter(row => isExport(row.request)).length, originalReceipts,
    "opening evidence and current blockers never authorize another export");
  assert.ok(fixture.h.requests.every(request => request.init.method !== "POST"
    || request.url === "/api/events" && isExport(request)), "no generation, paid action, review, or unrelated command");
}

const markdown = f => {
  const values = nodes(f, "button").filter(node => Object.hasOwn(node.attributes, "data-artifact-export"));
  assert.equal(values.length, 1); return values[0];
};
const reviewReply = (x, type) => x.replies.findLast(row => row.request.body?.events?.some(event => event.type === type));
function exactReviewAcknowledgment(x, type, assigned) {
  const row = reviewReply(x, type); assert.ok(row); assert.equal(row.status, 200);
  assert.equal(row.body.appended.length, 1); const event = row.body.appended[0], artifact = currentArtifact(x.f);
  assert.equal(event.payload.artifact_id, artifact.id);
  assert.equal(event.payload.document_id, artifact.documentId);
  assert.equal(event.payload.artifact_revision, 0);
  assert.equal(event.payload.content_sha256, currentHash(x.f));
  if (type === "ArtifactReviewRequested") {
    if (assigned) assert.equal(event.payload.assigned_reviewer_user_id, x.sharing.reviewer);
    else assert.equal(Object.hasOwn(event.payload, "assigned_reviewer_user_id"), false);
  }
  assert.equal(event.actor, assigned ? "user:" + (type === "ArtifactApproved" ? x.sharing.reviewer : x.worker.owner) : "user");
  assert.equal(x.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(event.eventId).n, 1);
  return event;
}
function onlyReviewPair(x, before) {
  const posts = x.h.requests.filter(row => row.init.method === "POST");
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.flatMap(row => {
    assert.equal(row.url, "/api/events"); assert.equal(row.body.events.length, 1);
    return row.body.events.map(event => event.type);
  }), ["ArtifactReviewRequested", "ArtifactApproved"]);
  assert.equal(x.replies.filter(row => isExport(row.request)).length, 0);
  assert.deepEqual(finance(x.worker), before, "review does not mutate generation or financial rows");
}

for (const locale of locales) for (const scenario of [
  "legacy-current", "legacy-revoked", "versioned-current", "versioned-revoked", "versioned-source-edited",
]) test("viewer evidence keeps historical authorization separate from current release " + locale + "/" + scenario, async t => {
  const x = await createReviewHost(t, { locale, unverified: scenario.startsWith("legacy") });
  const { f, h, worker } = x, before = finance(worker);
  const { receipt, sha } = await originalExportReceipt(x);
  const revoked = scenario.endsWith("revoked"), edited = scenario === "versioned-source-edited", blocked = revoked, sourceChanged = revoked || edited;
  if (revoked) await revokeCurrentRights(x);
  if (edited) {
    await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, "ChipEdited", {
      project_id: worker.projectId, document_id: worker.documentId, block_id: "scene-reuse-direction",
      property: "text", new_value: "An explicitly changed current source after the retained export authorization.",
    });
    await h.store.refreshEvents(); f.draw();
  }
  const state = currentDelivery(f), history = structuredClone(h.store.events.get()), stateBefore = JSON.stringify(state);
  assert.equal(state.releaseAllowed, !blocked); assert.equal(state.approved, false);
  assert.equal(state.action, sourceChanged ? "sources" : "exportPersonal"); assert.equal(state.deliveryStatus, "unconfirmed");
  assert.equal(currentHash(f), sha);
  const historical = scenario === "legacy-current" || scenario === "legacy-revoked" || scenario === "versioned-current";
  assert.equal(Boolean(state.exportReceipt), historical);
  if (historical) assert.equal(state.exportReceipt.eventId, receipt.eventId);
  if (revoked) assert.deepEqual(state.rightsBlockIds, ["scene-reuse-direction"]);
  if (edited) { assert.deepEqual(state.rightsBlockIds, []); assert.equal(state.review.status, "stale");
    assert.equal(state.releaseAllowed, true, "existing optional personal export policy is unchanged; stale review is not itself a release denial"); }
  await openGallery(f);
  if (sourceChanged) {
    click(f, primary(f)); await settle(f, () => panelOpen(f));
    assert.ok(f.renderer.markup.includes(f.i18n.t("artifact.delivery.sourcesChanged")));
  }
  const html = openInlineEvidence(f);
  const control = markdown(f); assert.equal(disabled(control), blocked);
  assert.equal(html.includes(f.i18n.t("artifact.delivery.exportAuthorized")), false, "a retained receipt is not a current authorization claim");
  assert.equal(html.includes(f.i18n.t("artifact.delivery.exportRecorded")), historical, "existing receipt selection is preserved");
  assert.equal(html.includes(f.i18n.t("artifact.delivery.currentSourcesBlocked")), blocked, "known current source or rights blocks are explicit");
  assert.ok(html.includes(f.i18n.t("artifact.delivery.notDelivered")));
  assert.deepEqual(h.store.events.get(), history); assert.equal(JSON.stringify(currentDelivery(f)), stateBefore);
  assert.equal(h.store.events.get().filter(event => event.eventId === receipt.eventId).length, 1);
  assert.equal(worker.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(receipt.eventId).n, 1);
  unchanged(x, before, 1);
});

for (const locale of locales) {
  test("viewer evidence does not invent a receipt or source failure for managed review " + locale, async t => {
    const x = await createReviewHost(t, { locale, shared: true }), { f, worker } = x, before = finance(worker);
    const state = currentDelivery(f), history = structuredClone(f.store.events.get());
    assert.equal(state.releaseAllowed, false); assert.equal(state.approved, false); assert.equal(state.exportReceipt, null);
    assert.equal(state.action, "assign"); assert.deepEqual(state.rightsBlockIds, []);
    await openGallery(f); const html = openInlineEvidence(f);
    for (const key of ["exportAuthorized", "exportRecorded", "currentSourcesBlocked"]) assert.equal(html.includes(f.i18n.t("artifact.delivery." + key)), false);
    assert.equal(disabled(markdown(f)), true);
    assert.equal(markdown(f).attributes.title, f.i18n.system("Independent approval is required before export"));
    assert.deepEqual(f.store.events.get(), history); unchanged(x, before, 0);
  });

  test("viewer evidence withdraws its exact private receipt after current actor loss " + locale, async t => {
    const x = await createReviewHost(t, { locale, unverified: true }), { f, h, worker } = x, before = finance(worker);
    const { receipt } = await originalExportReceipt(x);
    await openGallery(f); openInlineEvidence(f);
    h.store.session.set(null); f.draw();
    assert.equal(nodes(f, "details").some(node => node.classList.contains("artifact-viewer-details")), false);
    assert.equal(nodes(f, "dialog").some(node => node.classList.contains("document-artifact-view") && node.open), false);
    assert.equal(nodes(f, "button").some(node => Object.hasOwn(node.attributes, "data-artifact-export")), false);
    assert.equal(worker.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(receipt.eventId).n, 1);
    unchanged(x, before, 1);
  });

  test("enabled personal Markdown title is neutral without independent approval " + locale, async t => {
    const x = await createReviewHost(t, { locale, unverified: true }), { f, worker } = x, before = finance(worker);
    const state = currentDelivery(f), history = structuredClone(f.store.events.get());
    assert.equal(state.approved, false); assert.equal(state.releaseAllowed, true); assert.equal(state.exportReceipt, null);
    await openGallery(f); const button = markdown(f);
    assert.equal(disabled(button), false);
    assert.equal(button.attributes.title, expected[locale].downloadCurrent);
    assert.notEqual(button.attributes.title, f.i18n.system("Download the approved output"));
    assert.equal(text(f, button), f.i18n.system("Download Markdown"));
    assert.equal(ARTIFACT_DELIVERY_MESSAGES[locale]["artifact.delivery.downloadCurrent"], expected[locale].downloadCurrent);
    assert.deepEqual(f.store.events.get(), history); assert.deepEqual(currentDelivery(f), state); unchanged(x, before, 0);
  });

  test("personal required review success names a request, not an independent assignment " + locale, async t => {
    const x = await createReviewHost(t, { locale, final: true }), { f, h, worker } = x, before = finance(worker);
    assert.equal(currentDelivery(f).action, "reviewPersonal"); assert.equal(currentDelivery(f).approved, false);
    await openGallery(f); await promote(f);
    assert.equal(panelOpen(f), true); assert.equal(nodes(f, "select").some(node => node.handlers.change?.toString().includes("#selectedReviewerId")), false);
    click(f, reviewControl(f, "ArtifactReviewRequested"));
    await settle(f, () => currentReview(f).status === "in-review"); await f.flush();
    exactReviewAcknowledgment(x, "ArtifactReviewRequested", false);
    assert.equal(h.store.ui.toast, expected[locale].reviewRequestedPersonal);
    assert.equal(ARTIFACT_DELIVERY_MESSAGES[locale]["artifact.delivery.reviewRequestedPersonal"], expected[locale].reviewRequestedPersonal);
    assert.notEqual(h.store.ui.toast, f.i18n.system("The exact output revision was assigned to its independent reviewer."));
    assert.deepEqual(finance(worker), before);
    click(f, reviewControl(f, "ArtifactApproved"));
    await settle(f, () => currentReview(f).status === "approved"); await f.flush();
    exactReviewAcknowledgment(x, "ArtifactApproved", false);
    assert.equal(currentDelivery(f).approved, false); assert.equal(currentDelivery(f).releaseAllowed, true);
    assert.equal(markdown(f).attributes.title, expected[locale].downloadCurrent);
    assert.equal(h.store.ui.toast, "Output approved against its current source decisions.");
    onlyReviewPair(x, before);
  });

  test("shared review success retains exact independent assignment and approved Markdown title " + locale, async t => {
    const x = await createReviewHost(t, { locale, shared: true }), { f, h, sharing, worker, switchActor } = x, before = finance(worker);
    assert.equal(currentDelivery(f).action, "assign"); assert.equal(currentDelivery(f).approved, false);
    await openGallery(f); await promote(f);
    const selector = nodes(f, "select").find(node => node.handlers.change?.toString().includes("#selectedReviewerId"));
    assert.ok(selector); assert.equal(selector.value, sharing.reviewer);
    assert.equal(reviewControl(f, "ArtifactApproved"), undefined);
    click(f, reviewControl(f, "ArtifactReviewRequested"));
    await settle(f, () => currentReview(f).status === "in-review"); await f.flush();
    exactReviewAcknowledgment(x, "ArtifactReviewRequested", true);
    assert.equal(h.store.ui.toast, "The exact output revision was assigned to its independent reviewer.");
    assert.notEqual(h.store.ui.toast, expected[locale].reviewRequestedPersonal);
    assert.deepEqual(finance(worker), before);
    await switchActor("reviewer"); await openGallery(f); await promote(f);
    assert.equal(currentDelivery(f).action, "review");
    click(f, reviewControl(f, "ArtifactApproved"));
    await settle(f, () => currentDelivery(f).approved); await f.flush();
    exactReviewAcknowledgment(x, "ArtifactApproved", true);
    const state = currentDelivery(f); assert.equal(state.releaseAllowed, true); assert.equal(state.action, "export"); assert.equal(state.exportReceipt, null);
    assert.equal(disabled(markdown(f)), false);
    assert.equal(markdown(f).attributes.title, f.i18n.system("Download the approved output"));
    assert.notEqual(markdown(f).attributes.title, expected[locale].downloadCurrent);
    assert.equal(h.store.ui.toast, "Output approved against its current source decisions.");
    onlyReviewPair(x, before);
  });
}


const { FormaDeliver } = await loadActual("src/components/forma-deliver.ts");
function exactDeliverFooter(t, f) {
  const host = new FormaDeliver(); host.store = f.store; host.i18n = f.i18n; host.fixture = f; host.isConnected = true;
  const renderer = new RendererPort(f, {}); renderer.draw(host);
  t.after(() => {
    host.isConnected = false; host.disconnectedCallback();
    for (const { instance } of renderer.instances.values()) if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
  });
  const view = { ...f, host, renderer };
  const action = nodes(view, "a").find(node => libraryFocusFromRoute(String(node.attributes.href ?? ""))?.id === f.artifactId);
  assert.ok(action, "the full Deliver class emits the exact current artifact link");
  const offset = renderer.markup.indexOf(action.full); assert.ok(offset >= 0);
  const card = nodes(view, "article").find(node => {
    if (!node.classList.contains("forma-deliver-card")) return false;
    const start = renderer.markup.indexOf(node.full), end = renderer.markup.indexOf("</article>", start);
    return start <= offset && end > offset;
  });
  assert.ok(card);
  const start = renderer.markup.indexOf(card.full), body = renderer.markup.slice(start, renderer.markup.indexOf("</article>", start));
  assert.ok(body.includes(currentArtifact(f).title));
  return { body, action };
}
for (const locale of locales) for (const scenario of ["versioned-source-edited", "legacy-source-edited", "versioned-revoked"]) {
  test("Deliver does not turn unopened list bytes into a false release block " + locale + "/" + scenario, async t => {
    const x = await createReviewHost(t, { locale, unverified: scenario.startsWith("legacy") }), { f, h, worker } = x, before = finance(worker);
    const { receipt, sha } = await originalExportReceipt(x);
    const revoked = scenario.endsWith("revoked");
    if (revoked) await revokeCurrentRights(x);
    else {
      await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, "ChipEdited", {
        project_id: worker.projectId, document_id: worker.documentId, block_id: "scene-reuse-direction",
        property: "text", new_value: "Current source text changes without inventing a personal approval prerequisite.",
      });
      await h.store.refreshEvents(); f.draw();
    }
    const state = currentDelivery(f), history = structuredClone(h.store.events.get());
    assert.equal(state.releaseAllowed, !revoked); assert.equal(state.approved, false); assert.equal(currentHash(f), sha);
    assert.equal(state.review.status, scenario.startsWith("legacy") ? "unverified" : "stale");
    assert.equal(Boolean(state.exportReceipt), scenario.startsWith("legacy"));
    if (state.exportReceipt) assert.equal(state.exportReceipt.eventId, receipt.eventId);
    const { body } = exactDeliverFooter(t, f);
    assert.equal(body.includes(f.i18n.t("artifact.delivery.currentSourcesBlocked")), revoked,
      "a list has not opened current bytes; stale review alone must not claim a denied optional personal export");
    assert.equal(body.includes(f.i18n.t("artifact.delivery.exportRecorded")), Boolean(state.exportReceipt));
    if (scenario === "versioned-source-edited") assert.ok(body.includes(f.i18n.t("artifact.delivery.sourcesChanged")), "current changes remain explicit without an invented export denial");
    assert.equal(body.includes(f.i18n.t("artifact.delivery.exportAuthorized")), false);
    assert.deepEqual(h.store.events.get(), history); assert.deepEqual(currentDelivery(f), state);
    assert.equal(worker.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(receipt.eventId).n, 1);
    unchanged(x, before, 1);
  });
}
