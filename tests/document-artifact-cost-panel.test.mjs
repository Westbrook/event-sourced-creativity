import assert from "node:assert/strict";
import test from "node:test";
import { createReviewHost, openGallery, currentArtifact, nodes, text, loadActual, click, settle } from "./helpers/artifact-review-host.mjs";
import { DOCUMENT_ARTIFACT_KINDS } from "../src/model/document-artifacts.ts";
import { readWorkspaceEvents } from "../worker/runtime.ts";

// Actual complete DocumentArtifacts/Store and existing routed RAM Worker.
// Artifact kind and usage payloads are synthetic retained fixture metadata,
// not generated media, actual charges or an invoice/settlement certificate.
// This suite only opens the saved artifact and ordinary evidence disclosure.
const { DocumentArtifacts } = await loadActual("src/components/document-artifacts.ts");
const locales = ["en", "fr", "ar", "ja"];
const finances = worker => Object.fromEntries(["document_jobs", "budget_counters", "budget_reservations",
  "cost_budget_counters", "cost_budget_reservations"].map(table => [
    table, worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all(),
  ]));
const compact = value => String(value).replace(/\s+/gu, " ").trim();
const costNodes = f => nodes(f, "p").filter(node => node.classList.contains("artifact-generation-cost"));
const cases = [
  { name: "known positive", receipt: { reserved_microusd: 2_000_000, cost_microusd: 1200 }, amount: 1200, reservedMicrousd: 2_000_000 },
  { name: "explicit zero", receipt: { reserved_microusd: 2_000_000, cost_microusd: 0 }, amount: 0, reservedMicrousd: 2_000_000 },
  { name: "unknown", receipt: { reserved_microusd: 2_000_000 }, amount: null, reservedMicrousd: 2_000_000 },
];
const unavailableScopedCost = { amount: null, reservedMicrousd: null };

async function originalUsageRow(worker, artifact, scenario) {
  // Inspect only the fixture's original owner stream. Never put these private
  // records in Store state or replace the actual scoped /events response.
  const usage = (await readWorkspaceEvents(worker.env, worker.streamId)).filter(event =>
    event.type === "GenerationUsageRecorded" && event.payload.artifact_id === artifact.id);
  assert.equal(usage.length, 1, "exactly one original synthetic usage record exists before review");
  assert.equal(usage[0].actor, "worker:policy", "match the actual renderer's accounting event origin");
  assert.deepEqual(usage[0].payload, {
    ...scenario.receipt, operation: "document-render:" + artifact.kind, artifact_kind: artifact.kind,
    project_id: worker.projectId, document_id: worker.documentId,
    artifact_id: artifact.id, requested_by_user_id: worker.owner,
  });
  const completion = worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(artifact.sourceEventId);
  assert.ok(completion);
  assert.equal(usage[0].correlationId, completion.correlation_id, "usage remains linked to its original completion");
  const row = worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(usage[0].eventId);
  assert.ok(row);
  return row;
}
function assertScopedCostsOmitted(h, artifactId, usageRow) {
  assert.equal(h.store.events.get().some(event => event.eventId === usageRow.event_id), false,
    "the original owner-stream usage is not exposed through the shared event feed");
  assert.deepEqual(h.store.events.get().filter(event => event.payload.artifact_id === artifactId
    && ["DocumentRenderRequested", "GenerationUsageRecorded", "BudgetReserved"].includes(event.type)), [],
  "the project output-only allowlist excludes private cost and reservation evidence even for its requester");
}

function openEvidence(f) {
  const own = f.renderer.nodes.filter(node => node.owner === f.host);
  const details = own.find(node => node.tag === "details" && node.classList.contains("artifact-viewer-details"));
  assert.ok(details?.isConnected, "actual current artifact evidence exists");
  const summary = own.slice(own.indexOf(details) + 1).find(node => node.tag === "summary");
  assert.ok(summary?.isConnected);
  assert.deepEqual(Object.keys(summary.handlers), [], "ordinary native summary, not a replacement product handler");
  summary.click();
  // Existing RendererPort does not implement the browser's summary default.
  // Reflect only that native open state; do not call any private component method.
  details.open = true; details.setAttribute("open", "");
  assert.ok(nodes(f, "dialog").some(node => node.classList.contains("document-artifact-view") && node.open));
  return details;
}
function assertOwnerCost(f, scenario) {
  openEvidence(f);
  const found = costNodes(f);
  assert.equal(found.length, 1, "one existing owner-only cost panel is present");
  const primary = scenario.amount === null
    ? f.i18n.system("Settled provider cost unavailable")
    : f.i18n.system("Settled provider cost: {settledGenerationCost}", { settledGenerationCost: "$" + (scenario.amount / 1_000_000).toFixed(6) });
  const reservation = scenario.reservedMicrousd === null ? ""
    : "· " + f.i18n.t("production.reserved", "Initially reserved: {amount}", { amount: "$" + (scenario.reservedMicrousd / 1_000_000).toFixed(2) });
  assert.equal(compact(text(f, found[0])), compact(primary + " " + reservation));
  if (scenario.amount === null) assert.equal(text(f, found[0]).includes("$0.000000"), false, "unknown is not a known zero");
  assert.equal(nodes(f, "p").filter(node => node.classList.contains("artifact-viewer-provider")).length, 1);
}
function enableImpersonationPort(h) {
  const session = h.store.session.get();
  // Existing projected-session shape, not backend impersonation authorization.
  h.store.session.set({ ...session, impersonation: {
    active: true, impersonationId: "cost-panel-session-port", personaId: "cost-panel-persona",
    replaySessionId: "cost-panel-replay", actor: session.user, fictionalUser: session.user,
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  } });
}
function assertUnchanged(x, before, originalRows, start) {
  assert.deepEqual(finances(x.worker), before, "inspection never changes jobs, reservations or counters");
  for (const row of originalRows) assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(row.event_id), row,
    "the original completion and usage receipt are not rewritten");
  assert.deepEqual(x.h.requests.slice(start).filter(request => (request.init.method ?? "GET") !== "GET"), [], "no generation, approval, export, retry, recovery, Stop or Dismiss request");
}

for (const [index, kind] of DOCUMENT_ARTIFACT_KINDS.entries()) for (const scenario of cases) {
  const locale = locales[index % locales.length];
  test("artifact cost panel: shared " + kind + "/" + locale + "/private " + scenario.name + " stays unavailable and obeys requester gates", async t => {
    const x = await createReviewHost(t, { locale, shared: true, artifactKind: kind, costReceipts: [scenario.receipt] });
    const { f, h, worker } = x, before = finances(worker), start = h.requests.length;
    assert.equal(f.host.constructor, DocumentArtifacts, "the whole actual viewer class is used");
    const artifact = currentArtifact(f);
    assert.equal(artifact.kind, kind);
    const sourceRow = worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(artifact.sourceEventId);
    assert.ok(sourceRow);
    const completed = h.store.events.get().find(event => event.eventId === artifact.sourceEventId);
    assert.equal(completed.payload.requested_by_user_id, worker.owner);
    const usageRow = await originalUsageRow(worker, artifact, scenario), originalRows = [sourceRow, usageRow];
    assertScopedCostsOmitted(h, artifact.id, usageRow);
    assert.equal(worker.sqlite.prepare("SELECT event_id FROM project_event_scopes WHERE event_id=?").get(usageRow.event_id), undefined,
      "migration never scopes private accounting history as a collaborative output");
    assert.equal(h.store.session.get().user.userId, worker.owner);
    assert.ok(h.store.session.get().projectContext);
    assert.equal(Boolean(h.store.session.get().impersonation), false);
    await openGallery(f);
    assertOwnerCost(f, unavailableScopedCost);
    assertUnchanged(x, before, originalRows, start);

    // Real fixture selected-project session and content read for another actor.
    await x.switchActor("reviewer");
    assert.equal(h.store.session.get().user.userId, x.sharing.reviewer);
    assert.notEqual(h.store.session.get().user.userId, completed.payload.requested_by_user_id);
    assertScopedCostsOmitted(h, artifact.id, usageRow);
    await openGallery(f);
    openEvidence(f);
    assert.equal(costNodes(f).length, 0, "another reader never receives even the unavailable/reserved cost panel");
    assert.equal(nodes(f, "p").filter(node => node.classList.contains("artifact-viewer-provider")).length, 0);
    assertUnchanged(x, before, originalRows, start);

    await x.switchActor("owner");
    assert.equal(currentArtifact(f).sourceEventId, artifact.sourceEventId);
    assertScopedCostsOmitted(h, artifact.id, usageRow);
    await openGallery(f);
    assertOwnerCost(f, unavailableScopedCost);

    enableImpersonationPort(h);
    f.draw(); f.draw();
    assert.equal(costNodes(f).length, 0, "current impersonation hides costs; full viewer withdrawal is also allowed");
    assert.equal(nodes(f, "p").filter(node => node.classList.contains("artifact-viewer-provider")).length, 0);
    assertUnchanged(x, before, originalRows, start);
  });
}

for (const [index, kind] of DOCUMENT_ARTIFACT_KINDS.entries()) for (const scenario of cases) test("artifact cost panel: personal " + kind + "/" + scenario.name + " retains its owner disclosure", async t => {
  const locale = kind === "scene" ? "ja" : locales[index % locales.length];
  const x = await createReviewHost(t, { locale, artifactKind: kind, costReceipts: [scenario.receipt] });
  const { f, h, worker } = x, before = finances(worker), start = h.requests.length;
  assert.equal(f.host.constructor, DocumentArtifacts);
  assert.equal(Boolean(h.store.session.get().projectContext), false);
  const artifact = currentArtifact(f), sourceRow = worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(artifact.sourceEventId);
  assert.equal(artifact.kind, kind);
  assert.ok(sourceRow);
  const usageRow = await originalUsageRow(worker, artifact, scenario), originalRows = [sourceRow, usageRow];
  const usage = h.store.events.get().find(event => event.type === "GenerationUsageRecorded" && event.payload.artifact_id === artifact.id);
  assert.ok(usage);
  assert.equal(usage.eventId, usageRow.event_id, "the personal view receives that exact original receipt");
  assert.equal(usage.payload.cost_microusd, scenario.receipt.cost_microusd);
  await openGallery(f);
  assertOwnerCost(f, scenario);
  enableImpersonationPort(h);
  f.draw(); f.draw();
  assert.equal(costNodes(f).length, 0);
  assertUnchanged(x, before, originalRows, start);
});


// Managed production is opt-in synthetic retained metadata. Inspect the actual
// list, then open its exact saved artifact using the existing Gallery control.
// This does not manufacture a provider outcome or a settled-ledger certificate.
const initialReservationCopy = {
  "en": "Initially reserved: {amount}",
  "fr": "Réservation initiale : {amount}",
  "ar": "المبلغ المحجوز مبدئيًا: {amount}",
  "ja": "当初の確保額：{amount}"
};
const managedCases = [
  { name: "known positive", receipt: { reserved_microusd: 2_000_000, cost_microusd: 1_250_000 }, amount: 1_250_000, reservedMicrousd: 2_000_000 },
  { name: "explicit zero", receipt: { reserved_microusd: 2_000_000, cost_microusd: 0 }, amount: 0, reservedMicrousd: 2_000_000 },
  { name: "unknown", receipt: { reserved_microusd: 2_000_000 }, amount: null, reservedMicrousd: 2_000_000 },
];
const initialReservation = (locale, amount) => initialReservationCopy[locale].replace("{amount}", amount);

function assertManagedListCost(f, artifact, scenario, locale, allowWithdrawn = false) {
  const facts = nodes(f, "div").filter(node => node.classList.contains("document-production-facts"));
  if (allowWithdrawn && !facts.length) return;
  assert.equal(facts.length, 1, "one exact managed artifact owns the visible production facts");
  assert.ok(facts[0].isConnected);
  const identity = nodes(f, "div").filter(node => node.classList.contains("document-production-identity"));
  assert.equal(identity.length, 1);
  assert.ok(text(f, identity[0]).includes(artifact.title));
  const labels = [f.i18n.t("production.units", "{count} completed units", { count: f.i18n.number(artifact.itemCount) })];
  if (scenario.amount !== null) labels.push(f.i18n.t("production.actual", "Charged {amount}", {
    amount: "$" + (scenario.amount / 1_000_000).toFixed(2),
  }));
  if (scenario.reservedMicrousd !== null) labels.push(initialReservation(locale, "$" + (scenario.reservedMicrousd / 1_000_000).toFixed(2)));
  // The real fact spans are adjacent; strip markup only through the existing
  // host text helper. This is the actual list, not a copied summary renderer.
  assert.equal(compact(text(f, facts[0])), compact(labels.join("")),
    "the list uses the exact historical-reservation caption and no unknown/private charge");
}

async function closeCostViewer(f) {
  const closes = nodes(f, "button").filter(node => node.attributes["aria-label"] === f.i18n.t("action.close", "Close")
    && typeof node.handlers.click === "function" && node.handlers.click.toString().includes("#viewDialog"));
  assert.equal(closes.length, 1, "the current native viewer close control");
  click(f, closes[0]);
  await settle(f, () => !nodes(f, "dialog").some(node => node.classList.contains("document-artifact-view") && node.open));
}

for (const locale of locales) for (const shared of [false, true]) for (const scenario of managedCases) {
  test("managed cost parity: " + locale + "/" + (shared ? "shared private " : "personal ") + scenario.name + " keeps list and exact viewer consistent", async t => {
    const x = await createReviewHost(t, { locale, shared, artifactKind: "video", managed: true, costReceipts: [scenario.receipt] });
    const { f, h, worker } = x, artifact = currentArtifact(f), before = finances(worker), start = h.requests.length;
    assert.equal(f.host.constructor, DocumentArtifacts);
    assert.equal(artifact.settings.production_mode, "managed", "retained fixture metadata actually reaches the production fold");
    const sourceRow = worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(artifact.sourceEventId);
    const usageRow = await originalUsageRow(worker, artifact, scenario), originalRows = [sourceRow, usageRow];
    assert.ok(sourceRow);
    const scoped = shared ? unavailableScopedCost : scenario;
    if (shared) assertScopedCostsOmitted(h, artifact.id, usageRow);
    assertManagedListCost(f, artifact, scoped, locale);
    assert.equal(f.i18n.t("production.reserved", "", { amount: "$2.00" }), initialReservation(locale, "$2.00"),
      "the common key has the independently specified four-locale wording");
    await openGallery(f);
    assert.equal(currentArtifact(f).id, artifact.id);
    assert.equal(currentArtifact(f).sourceEventId, sourceRow.event_id);
    assertOwnerCost(f, scoped);
    if (!shared) assert.ok(text(f, costNodes(f)[0]).includes("· " + initialReservation(locale, "$2.00")),
      "the viewer keeps its separator outside the shared reservation caption");
    assertUnchanged(x, before, originalRows, start);

    if (shared) {
      await closeCostViewer(f);
      await x.switchActor("reviewer");
      assert.equal(h.store.session.get().user.userId, x.sharing.reviewer);
      assertScopedCostsOmitted(h, artifact.id, usageRow);
      assertManagedListCost(f, artifact, unavailableScopedCost, locale);
      await openGallery(f); openEvidence(f);
      assert.equal(costNodes(f).length, 0, "the independent reader does not receive private costs");
      assert.equal(nodes(f, "p").filter(node => node.classList.contains("artifact-viewer-provider")).length, 0);
      assertUnchanged(x, before, originalRows, start);
      await closeCostViewer(f);
      await x.switchActor("owner");
      assert.equal(h.store.session.get().user.userId, worker.owner);
      assertScopedCostsOmitted(h, artifact.id, usageRow);
      assertManagedListCost(f, artifact, unavailableScopedCost, locale);
      await openGallery(f); assertOwnerCost(f, unavailableScopedCost);
    }

    enableImpersonationPort(h); f.draw(); f.draw();
    assertManagedListCost(f, artifact, unavailableScopedCost, locale, true);
    assert.equal(costNodes(f).length, 0, "impersonation cannot recover an owner-only cost panel");
    assert.equal(nodes(f, "p").filter(node => node.classList.contains("artifact-viewer-provider")).length, 0);
    assertUnchanged(x, before, originalRows, start);
  });
}

const nonImageStopStates = [
  { status: "queued", kind: "short_story" },
  { status: "running", kind: "scene" },
  { status: "committing", kind: "slides" },
];
for (const locale of locales) for (const { status, kind } of nonImageStopStates) {
  test("non-image Stop parity: " + locale + "/" + kind + "/" + status + " qualifies the current title without executing", async t => {
    const x = await createReviewHost(t, { locale }), { f, h, worker } = x;
    const artifact = currentArtifact(f), sourceRow = worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(artifact.sourceEventId);
    const before = finances(worker), start = h.requests.length;
    assert.equal(f.host.constructor, DocumentArtifacts); assert.ok(sourceRow);
    // Presentation-only queue state; no job is inserted or accepted by Worker.
    const job = {
      jobId: "synthetic-artifact-stop-" + kind + "-" + locale, documentId: worker.documentId,
      kind: "render_document", status, sourceSurface: "document", requestedSequence: h.store.head.get(),
      documentRevision: h.store.documentGenerationRevision(), requestKey: "synthetic-artifact-stop-key-" + status,
      sourcePreviewId: null, productionMode: "manual", promptTechnique: "prose", promptFanId: null,
      parentJobId: null, fanKind: null, members: [], result: { artifactKind: kind, fixtureMarker: "unchanged-original-metadata" },
      error: null, errorDetail: null, moderationPromptRef: null, dismissedAt: null,
      attemptCount: status === "queued" ? 0 : 1, requestedAt: "2026-08-29T12:00:00.000Z",
      startedAt: status === "queued" ? null : "2026-08-29T12:00:01.000Z", completedAt: null, notifiedAt: null,
      leaseExpiresAt: null, updatedAt: "2026-08-29T12:00:02.000Z", stage: status,
      progressMessage: "Synthetic exact current request: " + kind + " / " + locale,
    };
    const foreign = { ...job, jobId: "foreign-" + job.jobId, documentId: "other-document",
      progressMessage: "FOREIGN-REQUEST-MUST-STAY-OUT" };
    h.store.documentJobs.set([foreign, job]); f.draw();
    const originalJobs = structuredClone(h.store.documentJobs.get());
    assert.deepEqual(h.store.documentRenderJobs(worker.documentId), [job], "actual Store filters the original exact document");
    const rows = nodes(f, "div").filter(node => node.classList.contains("document-artifact-jobs"));
    assert.equal(rows.length, 1);
    // Existing localization deliberately shows a translated stage instead of
    // unrecognized provider/system English. The retained raw job stays exact.
    const progress = locale === "en" ? job.progressMessage : f.i18n.t("job.progress." + (status === "running" ? "processing" : status));
    assert.ok(text(f, rows[0]).includes(progress));
    assert.equal(text(f, rows[0]).includes(foreign.progressMessage), false);
    const controls = nodes(f, "button").filter(node => typeof node.handlers.click === "function"
      && node.handlers.click.toString().includes("#stop(job.jobId)"));
    assert.equal(controls.length, 1, "only the current exact Document render owns this unchanged Stop handler");
    const control = controls[0];
    assert.ok(control.isConnected);
    assert.equal(Object.hasOwn(control.attributes, "disabled"), status === "committing");
    assert.equal(control.attributes.title, status === "committing"
      ? f.i18n.system("This result is already being saved") : f.i18n.t("generation.stopUncertainty"));
    assert.equal(text(f, control), f.i18n.system(status === "committing" ? "Saving…" : "Stop"));
    if (status !== "committing") assert.notEqual(control.attributes.title,
      f.i18n.system("Stop this render and release any unspent reservation"), "the unqualified tooltip is no longer used");
    // Deliberately do not activate Stop, including its disabled committing form.
    assert.deepEqual(h.store.documentJobs.get(), originalJobs);
    assertUnchanged(x, before, [sourceRow], start);
  });
}
