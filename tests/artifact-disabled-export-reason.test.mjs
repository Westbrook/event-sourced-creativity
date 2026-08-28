import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import {
  createReviewHost, openGallery, currentArtifact, currentHash, currentDelivery,
  nodes, disabled, settle, loadActual,
} from "./helpers/artifact-review-host.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { appendAuditEvent } from "../worker/runtime.ts";
import { artifactDeliveryFor } from "../src/state/artifact-delivery-context.ts";

// Complete current viewer + Store + routed Worker + in-memory SQLite. The
// existing fixture's correctly typed retained media and real review requests are
// reused unchanged. Native controls are deterministic ports, not browser/AT,
// generation, download/Word-export, recipient-delivery or provider evidence.
const fixtureUrl = new URL("./artifact-media-export-title.test.mjs", import.meta.url);
const fixtureSource = fs.readFileSync(fixtureUrl, "utf8");
const fixtureTree = ts.createSourceFile(fixtureUrl.pathname, fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstCase = fixtureTree.statements.find(ts.isForOfStatement);
assert.ok(firstCase);
const fixtureModule = fixtureUrl.href + "?disabled-export-reason-fixture";
const fixtureHook = registerHooks({ load(url, context, next) {
  return url === fixtureModule ? { format: "module", source: fixtureSource.slice(0, firstCase.getStart(fixtureTree))
    + "\nexport {mediaHost,profiles,createFrame,localizeTemplateResult,approveExactMedia,revokeMediaSource,originalMediaUnchanged,finance,exactContentRows};\n",
    shortCircuit: true } : next(url, context);
} });
const {
  mediaHost, profiles, createFrame, localizeTemplateResult, approveExactMedia,
  revokeMediaSource, originalMediaUnchanged, finance, exactContentRows,
} = await import(fixtureModule).finally(() => fixtureHook.deregister());

const locales = ["en", "fr", "ar", "ja"];
const { FormaLocaleController, FORMA_DEFAULT_MESSAGES } = await loadActual("src/components/design-system/localization.ts");
const localeCatalogs = Object.fromEntries(await Promise.all(locales.map(async locale => [
  locale, (await import("./../src/components/design-system/locales/" + (locale === "en" ? "system-en" : locale) + ".ts")).default,
])));
function installLocaleUpdates(f) {
  // The same real controller consumes a faithful context-provider subscription;
  // only native delivery of its existing callback is a deterministic test port.
  let publish, revision = 0;
  const snapshot = () => ({ locale: f.locale, formatLocale: f.locale, direction: f.locale === "ar" ? "rtl" : "ltr",
    timeZone: "UTC", messages: { ...FORMA_DEFAULT_MESSAGES, ...localeCatalogs[f.locale] }, revision });
  f.i18n.hostDisconnected();
  f.i18n = new FormaLocaleController({ addController() {}, requestUpdate() { f.requested = true; },
    dispatchEvent(event) { publish = event.callback; publish(snapshot(), () => {}); return true; } });
  f.host.i18n = f.i18n; f.i18n.hostConnected();
  f.publishTestLocale = locale => { f.locale = locale; revision++; publish(snapshot()); };
}

const reasonCopy = {
  en: {
    source: "Export is blocked now: the inputs changed or their rights are no longer current.",
    unavailable: "The current output bytes are unavailable for review or export.",
  },
  fr: {
    source: "L’exportation est actuellement bloquée : les entrées ont changé ou leurs droits ne sont plus valides.",
    unavailable: "Le contenu actuel du résultat n’est pas disponible pour révision ou exportation.",
  },
  ar: {
    source: "التصدير محظور حاليًا: تغيّرت المدخلات أو لم تعد حقوقها سارية.",
    unavailable: "محتوى المخرج الحالي غير متاح للمراجعة أو التصدير.",
  },
  ja: {
    source: "現在はエクスポートできません。入力が変更されたか、利用権が失効しています。",
    unavailable: "現在の出力内容はレビューやエクスポートに利用できません。",
  },
};
function exportControls(f) {
  const buttons = nodes(f, "button");
  return {
    markdown: buttons.find(node => Object.hasOwn(node.attributes, "data-artifact-export")),
    word: buttons.find(node => node.handlers.click?.toString().includes("#downloadWord(artifact)")),
    archive: buttons.find(node => node.handlers.click?.toString().includes("#downloadMediaArchive(artifact)")),
    direct: buttons.find(node => node.handlers.click?.toString().includes("#downloadMedia(artifact)")),
  };
}
function assertTitles(f, { allowed, approved, reason, branches }) {
  const controls = exportControls(f);
  assert.deepEqual(Object.keys(controls).filter(key => Boolean(controls[key])), branches);
  for (const [branch, control] of Object.entries(controls)) if (control) {
    assert.equal(disabled(control), !allowed, branch + " retains the exact release gate");
    const expected = allowed
      ? branch === "word" ? f.i18n.system("Download an editable Microsoft Word document")
        : branch === "markdown"
          ? approved ? f.i18n.system("Download the approved output") : f.i18n.t("artifact.delivery.downloadCurrent")
          : approved ? f.i18n.system("Download the approved media") : f.i18n.t("projects.downloadMedia")
      : reason === "approval" ? f.i18n.system("Independent approval is required before export")
        : reasonCopy[f.i18n.locale][reason];
    assert.equal(control.attributes.title, expected, branch + " names its actual current blocker, not an invented approval prerequisite");
    if (!allowed && reason !== "approval")
      assert.notEqual(control.attributes.title, f.i18n.system("Independent approval is required before export"));
    assert.equal(typeof control.handlers.click, "function", "the original action remains attached; no download is activated");
  }
}
async function ensureViewer(f) {
  if (!nodes(f, "dialog").some(node => node.classList.contains("document-artifact-view") && node.open))
    await openGallery(f);
  else await settle(f);
}
async function editSource(x) {
  const prior = x.h.store.projection.get().libraryBlocks.find(block => block.id === "scene-reuse-direction");
  assert.ok(prior); const priorVersion = prior.sourceEvents.length;
  const event = await appendAuditEvent(x.worker.env, x.worker.streamId, "user:" + x.worker.owner, "ChipEdited", {
    project_id: x.worker.projectId, document_id: x.worker.documentId, block_id: prior.id,
    property: "text", new_value: "An explicitly edited source after this exact retained output was produced.",
  });
  await x.h.store.refreshEvents(); x.f.draw();
  const current = x.h.store.projection.get().libraryBlocks.find(block => block.id === prior.id);
  assert.ok(current.sourceEvents.length > priorVersion);
  assert.equal(x.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(event.eventId).n, 1);
  assert.equal(currentDelivery(x.f).review.status, "stale");
  assert.deepEqual(currentDelivery(x.f).rightsBlockIds, []);
}
function currentRows(worker) {
  return worker.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();
}
function noExportOrGeneration(x, beforeFinance, beforeRows) {
  assert.deepEqual(finance(x.worker), beforeFinance, "no financial, reservation or job mutation");
  assert.deepEqual(currentRows(x.worker), beforeRows, "viewing and localized titles append no event");
  const posts = x.h.requests.filter(row => row.init.method === "POST");
  for (const row of posts) {
    assert.equal(row.url, "/api/events");
    assert.ok(row.body.events.length);
    assert.ok(row.body.events.every(event => ["ArtifactReviewRequested", "ArtifactApproved"].includes(event.type)),
      "only the explicit real review pair used to prepare the healthy control");
  }
}
async function checkLocaleChange(x, expected) {
  const initial = x.f.i18n.locale, next = locales[(locales.indexOf(initial) + 1) % locales.length];
  const before = structuredClone(x.h.store.events.get());
  x.f.publishTestLocale(next); x.f.draw(); await settle(x.f);
  assertTitles(x.f, expected);
  assert.deepEqual(x.h.store.events.get(), before, "a locale change never changes approval, receipts or source events");
}

for (const locale of locales) for (const scenario of [
  "personal", "shared-approved", "shared-required", "personal-revoked", "shared-stale", "personal-edited",
]) test("current disabled export reason prose " + locale + "/" + scenario, async t => {
  const x = await createReviewHost(t, { locale, shared: scenario.startsWith("shared") });
  installLocaleUpdates(x.f);
  x.originalHash = currentHash(x.f);
  const beforeFinance = finance(x.worker), originalContent = exactContentRows(x.worker);
  let approval;
  if (scenario === "shared-approved" || scenario === "shared-stale") approval = await approveExactMedia(x);
  if (scenario === "personal-revoked") await revokeMediaSource(x);
  if (scenario === "shared-stale" || scenario === "personal-edited") await editSource(x);
  const state = currentDelivery(x.f), approved = scenario === "shared-approved";
  const allowed = ["personal", "personal-edited", "shared-approved"].includes(scenario);
  assert.equal(state.approved, approved); assert.equal(state.releaseAllowed, allowed); assert.equal(state.exportReceipt, null);
  if (scenario === "shared-required") {
    assert.deepEqual(state.rightsBlockIds, []); assert.notEqual(state.review.status, "stale");
    assert.equal(state.action, "assign");
  }
  if (scenario === "personal-edited") assert.equal(state.releaseAllowed, true, "stale optional personal review does not change export policy");
  const beforeRows = currentRows(x.worker), history = structuredClone(x.h.store.events.get());
  await ensureViewer(x.f);
  const expected = { allowed, approved, reason: scenario === "shared-required" ? "approval" : "source", branches: ["markdown", "word"] };
  assertTitles(x.f, expected); await checkLocaleChange(x, expected);
  assert.deepEqual(x.h.store.events.get(), history);
  assert.deepEqual(currentDelivery(x.f), state); assert.equal(currentHash(x.f), x.originalHash);
  if (approval) for (const event of [approval.receipt, approval.acknowledgment])
    assert.equal(x.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(event.eventId).n, 1,
      "a stale source does not delete the original exact independent-review acknowledgment");
  assert.deepEqual(exactContentRows(x.worker), originalContent);
  noExportOrGeneration(x, beforeFinance, beforeRows);
});

for (const locale of locales) for (const profile of profiles) for (const scenario of ["shared-stale", "personal-edited"])
test("current disabled export reason media " + locale + "/" + profile.id + "/" + scenario, async t => {
  const x = await mediaHost(t, { locale, profile, shared: scenario === "shared-stale" });
  installLocaleUpdates(x.f);
  const approval = scenario === "shared-stale" ? await approveExactMedia(x) : null;
  await editSource(x);
  const state = currentDelivery(x.f), allowed = scenario === "personal-edited";
  assert.equal(state.releaseAllowed, allowed); assert.equal(state.approved, false); assert.equal(state.exportReceipt, null);
  const beforeRows = currentRows(x.worker), history = structuredClone(x.h.store.events.get());
  await ensureViewer(x.f);
  const expected = { allowed, approved: false, reason: "source",
    branches: ["markdown", "word", ...(profile.archive ? ["archive"] : []), ...(profile.direct ? ["direct"] : [])] };
  assertTitles(x.f, expected); await checkLocaleChange(x, expected);
  assert.deepEqual(x.h.store.events.get(), history); assert.deepEqual(currentDelivery(x.f), state);
  if (approval) assert.equal(x.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(approval.acknowledgment.eventId).n, 1);
  originalMediaUnchanged(x); noExportOrGeneration(x, x.beforeFinance, beforeRows);
});

for (const locale of locales) for (const profile of profiles)
test("cold retained custody expiry has no independent-approval claim " + locale + "/" + profile.id, async t => {
  const x = await mediaHost(t, { locale, profile });
  const originalRows = exactContentRows(x.worker), originalEvents = currentRows(x.worker);
  const row = originalRows.find(value => value.content_id === x.contentId); assert.ok(row);
  // Fixture-only expiry of the NEW output custody row. Content bytes, original
  // story records and all prior approvals stay intact; do not pretend to erase a
  // live cache. A second complete Store cold-reads the genuine Worker response.
  const expiredAt = "2020-01-01T00:00:00.000Z";
  const changed = x.worker.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?")
    .run(expiredAt, x.contentId);
  assert.equal(changed.changes, 1);
  const afterExpiry = originalRows.map(value => value.content_id === x.contentId ? Object.assign(Object.create(null), value, { expires_at: expiredAt }) : value);
  assert.deepEqual(exactContentRows(x.worker), afterExpiry);
  const response = await x.worker.request("/api/events?after=0&limit=2000&content=1");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(Object.hasOwn(body.content, x.contentId), false, "actual server custody excludes the expired exact ref");
  assert.equal(body.events.some(event => event.payload.artifact_id === x.f.artifactId), true, "history is not erased");

  const h = await createSceneStoreHost({ workerFixture: x.worker });
  h.store.patchUi({ instrumentation: false });
  assert.equal(h.store.content.get()[x.contentId], undefined, "cold Store uses actual absent source bytes, not a fake binding");
  const f = createFrame("create", { locale });
  f.store = h.store; f.host.store = h.store; f.host.documentId = x.worker.documentId; f.host.launcherOnly = false;
  f.artifactId = x.f.artifactId; f.state.documentId = x.worker.documentId;
  installLocaleUpdates(f);
  const render = f.renderer.value;
  f.renderer.value = function(value, ...rest) { return render.call(this, localizeTemplateResult(value, f.i18n), ...rest); };
  f.draw();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.ok(String(url).startsWith("/api/"), "no external request");
    return h.fetch(url, init);
  });
  // The original fixture owns the shared Worker/database cleanup. This second
  // cold view owns only its complete component and native timer ports.
  t.after(() => {
    f.host.isConnected = false; f.host.disconnectedCallback();
    for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) {
      instance.isConnected = false; instance.disconnectedCallback();
    }
    f.i18n.hostDisconnected(); h.timers.clear();
  });
  const artifact = currentArtifact(f); assert.ok(artifact); assert.equal(artifact.contentRef, x.contentId);
  const state = artifactDeliveryFor(h.store, artifact, null);
  assert.equal(state.canRead, true); assert.equal(state.releaseAllowed, false); assert.equal(state.approved, false);
  assert.equal(state.contentSha256, null); assert.deepEqual(state.rightsBlockIds, []); assert.equal(state.exportReceipt, null);
  await openGallery(f);
  const expected = { allowed: false, approved: false, reason: "unavailable", branches: profile.direct ? ["direct"] : [] };
  // Markdown, Word and archives are correctly absent without parsed current
  // content. Only independently retained direct media still has a disabled button.
  assertTitles(f, expected); await checkLocaleChange({ f, h }, expected);
  assert.deepEqual(artifactDeliveryFor(h.store, currentArtifact(f), null), state);
  assert.ok(f.renderer.markup.includes(reasonCopy[f.i18n.locale].unavailable));
  assert.deepEqual(exactContentRows(x.worker), afterExpiry);
  assert.deepEqual([...x.bucket], x.frozenMedia);
  assert.deepEqual(currentRows(x.worker), originalEvents);
  assert.deepEqual(finance(x.worker), x.beforeFinance);
  assert.equal(h.requests.filter(request => request.init.method === "POST").length, 0,
    "viewing expired custody does not request review, export, generation or another command");
});
