import assert from "node:assert/strict";
import test from "node:test";
import { createCalmFullPage, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";

const { localizeTemplateResult } = await ports.loadActual("src/components/design-system/localized-template.ts");

// Full current Shell/Workspace/GenerationActions and Store with existing RAM
// Worker/native ports. The queue jobs below are explicitly synthetic view state,
// not provider executions, settled costs or authentic server acknowledgments.
// Tests open confirmation and choose Keep it; they never invoke the Stop executor.
const previousFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error("External/provider calls are forbidden in stop-confirmation copy tests."); };
test.after(() => { try { assert.equal(externalCalls, 0); } finally { globalThis.fetch = previousFetch; } });

const expected = {
  "en": "Stopping does not guarantee that provider work stops or that reserved budget is released. Incurred costs remain; uncertain holds stay reserved until verified. Check the original receipt.",
  "fr": "L’arrêt ne garantit ni l’interruption du travail du fournisseur ni la libération du budget réservé. Les frais engagés subsistent ; les réservations incertaines restent bloquées jusqu’à vérification. Consultez le reçu d’origine.",
  "ar": "الإيقاف لا يضمن توقف عمل المزوّد أو تحرير الميزانية المحجوزة. تبقى التكاليف المتكبّدة، وتظل الحجوزات غير المؤكدة قائمة حتى التحقق. راجع الإيصال الأصلي.",
  "ja": "停止しても、プロバイダーの処理停止や予約予算の解放は保証されません。発生済みの費用は残り、未確認の予約枠は確認が済むまで確保されます。元の処理記録を確認してください。"
};
const oldClaim = "Queued work will be removed; running provider work will be ignored and its reservation released.";
const hasClass = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const within = (node, name) => {
  for (let parent = node?.parent; parent; parent = parent.parent) if (hasClass(parent, name)) return true;
  return false;
};
const normalize = value => String(value).replace(/\s+/gu, " ").trim();
const finances = f => Object.fromEntries(["document_jobs", "budget_counters", "budget_reservations",
  "cost_budget_counters", "cost_budget_reservations"].map(table => [table,
    f.storeHost.worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
const syntheticJob = (f, status) => ({
  jobId: "synthetic-stop-copy-" + status, documentId: f.store.projection.get().documentId,
  kind: status === "queued" ? "preview" : "generate", status, sourceSurface: "studio",
  requestedSequence: f.store.head.get(), documentRevision: f.store.documentGenerationRevision(),
  requestKey: "synthetic-stop-copy-key-" + status, sourcePreviewId: null, productionMode: "manual",
  promptTechnique: "prose", promptFanId: null, parentJobId: null, fanKind: null, members: [],
  result: null, error: null, errorDetail: null, moderationPromptRef: null, dismissedAt: null,
  attemptCount: status === "queued" ? 0 : 1, requestedAt: "2026-08-29T12:00:00.000Z",
  startedAt: status === "queued" ? null : "2026-08-29T12:00:01.000Z", completedAt: null,
  notifiedAt: null, leaseExpiresAt: null, updatedAt: "2026-08-29T12:00:02.000Z",
  stage: status === "running" ? "provider-wait" : status, progressMessage: "",
});

for (const locale of Object.keys(expected)) for (const status of ["queued", "running", "committing"]) {
  test("generation Stop confirmation: " + locale + "/" + status + " never promises a refund or dispatches Stop on review", async t => {
    const f = await createCalmFullPage(t, { locale });
    // The finite base Element port renders directly instead of running Lit's
    // update(). Apply the same actual transform used by FormaPresentationalElement.
    const renderValue = f.renderer.value;
    f.renderer.value = function(value, ...rest) { return renderValue.call(this, localizeTemplateResult(value, f.i18n), ...rest); };
    f.host.requestUpdate();
    await f.settle();
    const workspace = f.components().find(component => component.tag === "forma-workspace");
    assert.ok(workspace?.isConnected);
    const owners = f.components().filter(component => component.tag === "forma-generation-actions" && component.parentElement === workspace);
    assert.equal(owners.length, 1, "existing persistent Document generation owner");
    const generation = owners[0];
    f.store.documentJobs.set([syntheticJob(f, status)]);
    await f.settle();
    const jobs = structuredClone(f.store.documentJobs.get()), source = structuredClone(f.store.events.get());
    const content = structuredClone(f.store.content.get()), money = finances(f), start = f.storeHost.requests.length;
    const previousIntercept = f.storeHost.intercept;
    f.storeHost.intercept = request => {
      assert.ok(["GET", "HEAD"].includes(String(request.init.method ?? "GET").toUpperCase()),
        "review, Keep it and Close must not submit Stop, force-fail, generation or any authored mutation");
      return previousIntercept?.(request);
    };
    const unchanged = () => {
      assert.deepEqual(f.store.documentJobs.get(), jobs, "original view-state job identity and result are unchanged");
      assert.deepEqual(f.store.events.get(), source, "confirmation does not change the authored source");
      assert.deepEqual(f.store.content.get(), content);
      assert.deepEqual(finances(f), money, "confirmation cannot reserve, settle, release or create work");
      assert.deepEqual(f.storeHost.requests.slice(start).filter(request =>
        !["GET", "HEAD"].includes(String(request.init.method ?? "GET").toUpperCase())), []);
      assert.equal(externalCalls, 0);
    };

    await f.act(f.find("button", node => node.owner === workspace && node.attributes["data-workbench-pane"] === "result"));
    await f.act(f.find("button", node => node.owner === generation && hasClass(node, "generation-queue-trigger")));
    assert.ok(f.tree().visible("dialog").some(node => node.owner === generation && hasClass(node, "generation-queue-dialog")),
      "the actual current queue is open, not a directly invoked private queue renderer");
    unchanged();

    if (status === "committing") {
      const finalizing = f.find("p", node => node.owner === generation && hasClass(node, "generation-queue-finalizing"));
      assert.equal(normalize(finalizing.text), f.i18n.system("The provider result is being committed and can no longer be stopped safely."));
      assert.equal(f.tree().visible("div").filter(node => node.owner === generation &&
        (hasClass(node, "generation-queue-actions") || hasClass(node, "generation-queue-confirm"))).length, 0,
      "committing has no stop or force-fail entry and no new confirmation");
    } else {
      const entryLabel = f.i18n.system(status === "queued" ? "Cancel request" : "Stop generation");
      const entry = f.find("button", node => node.owner === generation &&
        within(node, "generation-queue-actions") && node.text === entryLabel);
      await f.act(entry); // Opens only the actual local confirmation.
      const alert = f.find("div", node => node.owner === generation && hasClass(node, "generation-queue-confirm"));
      assert.equal(alert.attributes.role, "alert");
      assert.ok(hasClass(alert, "cancel"));
      const explanation = alert.children.find(node => typeof node !== "string" && node.tag === "p");
      assert.ok(explanation);
      assert.equal(normalize(explanation.text), normalize(f.i18n.system("Stop this request?") + " " + expected[locale]),
        "the visible confirmation gives the exact qualified localized explanation");
      assert.equal(explanation.text.includes(f.i18n.system(oldClaim)), false, "no unconditional release promise survives");
      const stop = f.find("button", node => node.owner === generation &&
        within(node, "generation-queue-confirm") && node.text === f.i18n.system("Stop generation"));
      assert.equal(typeof stop.handlers.click, "function", "the original explicit executor remains, but is not invoked");
      unchanged();
      await f.act(f.find("button", node => node.owner === generation &&
        within(node, "generation-queue-confirm") && node.text === f.i18n.system("Keep it")));
      assert.equal(f.tree().visible("div").filter(node => node.owner === generation && hasClass(node, "generation-queue-confirm")).length, 0);
      unchanged();
    }

    await f.act(f.find("button", node => node.owner === generation && hasClass(node, "modal-close") &&
      within(node, "generation-queue-dialog")));
    assert.equal(f.tree().visible("dialog").filter(node => node.owner === generation && hasClass(node, "generation-queue-dialog")).length, 0);
    unchanged();
  });
}
