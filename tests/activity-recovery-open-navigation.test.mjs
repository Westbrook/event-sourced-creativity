// Companion to the reduced recovery/Dismiss binding test. Actual Activity,
// Shell, Store and Workspace exercise the common unconditional Open binding.
// The historical failed-job input is not a recoverable/provider receipt.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { lifecyclePage } from "./helpers/creative-next-action-navigation-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { readWorkspaceEvents } from "../worker/runtime.ts";
import { documentIdFromRoute, withDocumentInRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";
import { documentJobCanRecoverPresentation } from "../src/model/document-jobs.ts";

const inside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
const classed = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);

test("Activity failed Slides job Open document uses the actual Shell without new work", { concurrency: false, timeout: 120000 }, async t => {
  const sourceText = await readFile(new URL("../src/components/forma-activity.ts", import.meta.url), "utf8");
  const start = sourceText.indexOf("  #job(job: DocumentJob, documentName: string) {"), end = sourceText.indexOf("  override render() {", start);
  assert.ok(start >= 0 && end > start, "read the current production job renderer, not a copied control");
  const jobSource = sourceText.slice(start, end);
  const openBinding = '<button type="button" class="button secondary" @click=${() => void this.#openDocument(job.documentId, job.kind === "chat" ? "/studio/chat" : job.kind === "structure_adaptive" ? "/studio/adaptive" : "/")}>${this.i18n.t("activity.openDocument", "Open document")} ${icon("arrow")}</button>';
  assert.equal(jobSource.split(openBinding).length, 2, "one exact common job-ID/destination binding");
  assert.ok(jobSource.includes(' : nothing}\n        ' + openBinding + '\n        ${failed&&outputPermission ?'),
    "Open is outside the completed recovery/remediation conditional and before conditional Dismiss, independent of recoverability");
  let externalAttempts = 0;
  t.mock.method(globalThis, "fetch", async () => { externalAttempts++; assert.fail("No external/provider transport in this navigation witness"); });
  const h = await createSceneStoreHost({ count: 1, exposeSceneTestAccessors: false }), worker = h.worker;
  const resume = observeActualSceneResumeReads(h);
  let f, verify = async () => {};
  // Register before lifecyclePage's established verification/close hooks.
  t.after(async () => { try { await resume.settleOriginalRequests(); await verify(); } finally { resume.restore(); } });
  const activityRoute = withProjectTaskDocumentInRoute("/activity", worker.documentId);
  f = await lifecyclePage(t, { route: activityRoute, mode: "job", locale: "en", storeHost: h,
    jobResult: { artifactKind: "slides" } });
  const drain = async () => {
    for (let step = 0; step < 8; step++) {
      await f.settle();
      for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
      await resume.settleOriginalRequests(); await new Promise(setImmediate);
    }
    await f.settle(); await resume.settleOriginalRequests(); await worker.drainBackground();
    assert.equal(resume.pendingOriginalCount(), 0);
  };
  // Remove the helper's presentation-only source before testing navigation.
  // These complete current reads are the original RAM Worker's responses.
  await h.store.refreshSession(); await h.store.refreshEvents({ fromStart: true }); await h.store.syncDocumentJobs(); await drain();
  assert.equal(h.store.events.get().some(event => event.eventId.startsWith("synthetic-study-") || event.eventId.startsWith("synthetic-extra-")), false);
  const projection = h.store.projection.get(), document = projection.documents.find(row => row.id === worker.documentId && !row.removed);
  assert.ok(document && document.projectId === worker.projectId);
  const originalHistory = await readWorkspaceEvents(worker.env, worker.streamId);
  const originalDocument = originalHistory.find(event => event.type === "DocumentCreated" && event.payload.document_id === document.id);
  assert.ok(originalDocument && h.store.events.get().some(event => event.eventId === originalDocument.eventId));
  assert.equal(projection.documentId, document.id, "the original job targets the already-current Document; no navigation append is owed");
  assert.equal(h.store.route.get(), activityRoute);
  const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
  assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
  const job = h.store.documentJobs.get().find(row => row.jobId === f.jobId);
  assert.ok(job && job.documentId === document.id && job.status === "failed");
  assert.equal(job.kind, "render_document"); assert.equal(job.result.artifactKind, "slides");
  assert.equal(documentJobCanRecoverPresentation(job), false, "no fabricated recovery certification: this companion exercises only the source-proven common Open binding");
  const owners = f.components().filter(owner => owner.tag === "forma-activity" && owner.isConnected);
  assert.equal(owners.length, 1); const owner = owners[0];
  assert.equal(f.host.tag, "forma-shell"); assert.equal(owner.closest("forma-shell"), f.host);
  assert.equal(owner.store, h.store); assert.equal(f.host.store, h.store);
  const panels = f.components().filter(panel => panel.tag === "forma-activity-issue-panel" && panel.isConnected && panel.job?.jobId === job.jobId);
  assert.equal(panels.length, 1); assert.equal(panels[0].store, h.store); assert.equal(panels[0].job.documentId, document.id);
  const tree = f.tree(), panelRows = tree.nodes.filter(row => row.component === panels[0]);
  assert.equal(panelRows.length, 1);
  const cards = tree.visible("article").filter(row => row.owner === owner && classed(row, "forma-activity-card--job") && inside(panelRows[0], row));
  assert.equal(cards.length, 1); const card = cards[0];
  const controls = tree.visible("button").filter(row => row.owner === owner && inside(row, card));
  const recovery = controls.filter(row => row.text === f.i18n.system("Recover saved render"));
  const open = controls.filter(row => row.text === f.i18n.t("activity.openDocument", "Open document"));
  assert.equal(recovery.length, 0); assert.equal(open.length, 1);
  assert.equal(card.text.includes(f.i18n.system("Paid once · replay without another provider call")), false);
  for (const row of open) {
    assert.ok(row.port.isConnected && f.renderer.nodes.includes(row.port)); assert.equal(row.hiddenBy, null);
    assert.equal(row.port.matches(":disabled"), false);
  }
  const before = { history: await readWorkspaceEvents(worker.env, worker.streamId), money: financial(worker),
    privateContent: worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(),
    receipts: worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
    events: structuredClone(h.store.events.get()), head: h.store.head.get(), session: JSON.stringify(h.store.session.get()) };
  verify = async () => {
    assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), before.history, "exact history, including navigation, is unchanged");
    assert.deepEqual(financial(worker), before.money, "the original job and all existing fiscal/provider tables are unchanged");
    assert.deepEqual(worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), before.privateContent);
    assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), before.receipts);
    assert.deepEqual(h.store.events.get(), before.events); assert.equal(h.store.head.get(), before.head);
    assert.equal(JSON.stringify(h.store.session.get()), before.session);
    assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
    assert.deepEqual(h.requests.filter(row => (row.init.method ?? "GET") !== "GET" && !resume.isReadOnlyResume(row)), [],
      "Only positively certified exact original no-write Resume reads may use POST");
    assert.equal(h.requests.filter(row => row.url.startsWith("/api/document-jobs") && (row.init.method ?? "GET") !== "GET").length, 0,
      "Open does not recover, retry, dismiss, create or run a provider job");
    assert.equal(externalAttempts, 0);
  };
  f.native.emit("pointerdown", open[0].port); f.native.focus(open[0].port);
  await f.act(open[0], "click", { button: 0, defaultPrevented: false }); await drain();
  const expected = withProjectTaskDocumentInRoute(withDocumentInRoute("/", document.id, document.title), document.id);
  assert.equal(h.store.route.get(), expected); assert.equal(documentIdFromRoute(h.store.route.get()), document.id);
  assert.equal(h.location.pathname + h.location.search + h.location.hash, expected);
  assert.equal(owner.isConnected, false, "the actual routed Activity owner is retired by healthy navigation");
  const currentTree = f.tree(), workspaces = currentTree.nodes.filter(row => row.tag === "forma-workspace" && row.component?.isConnected && !row.hiddenBy);
  assert.equal(workspaces.length, 1); assert.equal(workspaces[0].component.store, h.store);
  assert.equal(h.store.projection.get().projectId, document.projectId); assert.equal(h.store.projection.get().documentId, document.id);
  assert.equal(currentTree.visible("h1").filter(row => row.owner === workspaces[0].component && row.text === document.title).length, 1);
  await verify();
  t.diagnostic("ACTIVITY_RECOVERY_OPEN_COMPANION " + JSON.stringify({ jobId: job.jobId, documentId: document.id, route: expected,
    actualShell: true, originalJobUnchanged: true, completedRecoveryClaim: false, externalAttempts,
    originalResumeProofs: resume.observations().length, physicalBrowserClaim: false }));
});
