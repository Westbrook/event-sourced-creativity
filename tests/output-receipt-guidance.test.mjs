import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { html, nothing } from "lit";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { loadController, eventHandlers, templates, binding } from "./output-ui-source-harness.mjs";
import enMessages from "../src/components/design-system/locales/system-en.ts";
import frMessages from "../src/components/design-system/locales/fr.ts";
import arMessages from "../src/components/design-system/locales/ar.ts";
import jaMessages from "../src/components/design-system/locales/ja.ts";

// Reuse real Worker routes and the complete component/module loader. Only test
// registration is omitted; no production method, receipt, or accounting is substituted.
async function declarations(file, names, namespace) {
  const url = new URL(file, import.meta.url), raw = readFileSync(url, "utf8");
  const tree = ts.createSourceFile(url.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
    || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
    || ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
      && ["registerOutputSourceImports", "registerHooks"].includes(node.expression.expression.getText(tree)))
    .map(node => node.getText(tree)).join("\n") + "\nexport { " + names.join(", ") + " };";
  url.search = "?" + namespace;
  const hook = registerHooks({ load(request, context, next) {
    return request === url.href ? { format: "module", source, shortCircuit: true } : next(request, context);
  } });
  try { return await import(url.href); } finally { hook.deregister(); }
}
const worker = await declarations("./output-execution-http-budget.test.mjs",
  ["fixture", "saveDeck", "authorize", "handleSession", "handleEvents", "handleDocumentJobs", "handleOutputRequirements", "outputDocumentExecutionBridge", "outputFor", "flushExecution"], "receipt-guidance-worker");
const { loadActual } = await declarations("./presentation-guidance-accessibility.test.mjs", ["loadActual"], "receipt-guidance-locale");
const { FormaLocaleController, FORMA_DEFAULT_MESSAGES } = await loadActual("src/components/design-system/localization.ts");
const { localizeTemplateResult } = await loadActual("src/components/design-system/localized-template.ts");
const catalogs = { en: enMessages, fr: frMessages, ar: arMessages, ja: jaMessages };
const expectedGuidance = {
  "en": "The original receipt check could not establish provider acceptance or cost. Review the refreshed operation and accounting for the current state. If acceptance or cost remains unknown, do not submit a replacement; copy the technical receipt and ask an authorized operator to investigate.",
  "fr": "La vérification initiale du reçu n’a pas permis d’établir l’acceptation par le fournisseur ou le coût. Consultez l’opération et les données comptables actualisées pour connaître l’état actuel. Si l’acceptation ou le coût reste inconnu, ne soumettez pas de remplacement ; copiez le reçu technique et demandez à un opérateur autorisé d’enquêter.",
  "ar": "لم يُثبت الفحص الأصلي للإيصال قبول المزوّد أو التكلفة. راجع العملية وبيانات المحاسبة بعد تحديثهما لمعرفة الحالة الحالية. إذا ظل القبول أو التكلفة غير معروف، فلا تُقدّم بديلًا؛ انسخ الإيصال التقني واطلب من مشغّل مخوّل التحقيق.",
  "ja": "元の処理記録の確認では、プロバイダーによる受け付け、または費用を確定できませんでした。現在の状態は、更新された処理と会計情報で確認してください。受け付けや費用がまだ不明な場合は、代わりの試行を送信せず、技術記録をコピーして権限を持つ運用担当者に調査を依頼してください。"
};

async function component(store, documentId, locale) {
  const i18n = new FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC",
      messages: { ...FORMA_DEFAULT_MESSAGES, ...catalogs[locale] }, revision: 1 }, () => {});
    return true;
  } });
  i18n.hostConnected();
  class Host {
    constructor() { this.store = store; this.i18n = i18n; this.isConnected = true; this.updateComplete = Promise.resolve(); }
    requestUpdate() {}
    querySelector() { return null; }
    connectedCallback() { this.isConnected = true; }
    disconnectedCallback() { this.isConnected = false; }
    append() {}
  }
  const Controller = await loadController(Host, { html, nothing });
  const controller = new Controller();
  controller.documentId = documentId; controller.surface = "deliver"; controller.willUpdate(new Map());
  return { controller, i18n };
}
function render(controller) {
  controller.willUpdate(new Map());
  return localizeTemplateResult(controller.render(), controller.i18n);
}
function notice(rendered) {
  const rows = templates(rendered).filter(entry => /^<p(?: class="output-notice")? role=$/u.test(entry.strings[0]));
  assert.equal(rows.length, 1, "the actual controller emits exactly one visible notice");
  const entry = rows[0];
  assert.equal(entry.strings[1], ">");
  assert.equal(entry.strings[2], "</p>");
  assert.equal(typeof entry.values[1], "string");
  return { role: binding(entry, "role"), text: entry.values[1] };
}
const textValues = rendered => templates(rendered).flatMap(entry => entry.values.filter(value => typeof value === "string"));
const settledModes = new Set(["settled", "known", "no-change"]);
const historicalModes = new Set(["held", "settled"]);

// The held/settled/retired-scope ordering is the actual reviewed counterexample:
// hold the original uncertain POST response, optionally reconcile that same
// attempt explicitly from another tab, then release it before the Store's GET.
// One mocked original provider response per fixture; no real network, new work,
// release shortcut, inferred settlement, or replacement provider call.
for (const locale of ["en", "fr", "ar", "ja"]) for (const mode of ["held", "settled", "retired-scope", "known", "no-change", "refresh-failure"])
  test("receipt guidance " + locale + " / " + mode + ": actual Worker → Store → localized controller preserves original evidence", async t => {
    const f = await worker.fixture(undefined, { shared: true });
    let host = null, execution, controller, i18n;
    const releaseProvider = Promise.withResolvers();
    const releaseReceipt = Promise.withResolvers();
    const enteredProvider = Promise.withResolvers();
    const enteredReceipt = Promise.withResolvers();
    let monotonic = 0, providerCalls = 0, externalReceiptPosts = 0, oldReceipt;
    const plan = await worker.saveDeck(f), authorized = await worker.authorize(f, plan.planId, [plan.targetId]);
    await f.ok(await f.send({ action: "run", grantId: authorized.grantId }));
    const slot = f.sqlite.prepare("SELECT * FROM output_operation_slots").get(), jobId = slot.job_id;
    const reconcilePath = "/api/document-jobs/" + jobId + "/reconcile-output";
    const originalIdentity = { documentId: f.documentId, grantId: authorized.grantId, slotId: slot.slot_id, jobId };
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
    t.mock.method(performance, "now", () => monotonic);
    t.mock.method(globalThis, "fetch", async url => {
      assert.equal(String(url), "https://api.openai.com/v1/responses", "only the original mocked provider transport is allowed");
      providerCalls++; enteredProvider.resolve(); await releaseProvider.promise;
      return Response.json({ id: "receipt-original-late-known", model: "gpt-5.6-terra",
        output_text: JSON.stringify(worker.outputFor()), usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
    });
    const applicationRequest = async (input, init = {}) => {
      const parsed = new URL(input, "http://localhost"), headers = new Headers(f.headers);
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      const request = new Request(parsed, { ...init, headers });
      if (parsed.pathname === "/api/session") return worker.handleSession(request, f.env);
      if (parsed.pathname === "/api/events") return worker.handleEvents(request, f.env);
      if (parsed.pathname.startsWith("/api/document-jobs/")) return worker.handleDocumentJobs(request, f.env, parsed.pathname.slice("/api/document-jobs/".length));
      assert.ok(parsed.pathname.startsWith("/api/output-requirements"));
      return worker.handleOutputRequirements(request, f.env, parsed.pathname, { waitUntil() { assert.fail("no detached work"); } }, worker.outputDocumentExecutionBridge);
    };
    const financial = () => ({
      token: f.sqlite.prepare("SELECT reservation_id,status,used_tokens,reserved_tokens FROM budget_reservations WHERE reservation_id=?").get(slot.token_reservation_id),
      cost: f.sqlite.prepare("SELECT reservation_id,status,used_microusd,reserved_microusd FROM cost_budget_reservations WHERE reservation_id=?").get(slot.cost_reservation_id),
      calls: f.sqlite.prepare("SELECT scope_key,slot_id,call_key,status,used_microusd FROM output_provider_calls WHERE slot_id=?").all(slot.slot_id),
      slot: f.sqlite.prepare("SELECT slot_id,grant_id,job_id,status FROM output_operation_slots WHERE slot_id=?").get(slot.slot_id),
      grant: f.sqlite.prepare("SELECT grant_id,status FROM output_execution_grants WHERE grant_id=?").get(authorized.grantId),
    });
    const exactIdentity = receipt => {
      for (const [key, value] of Object.entries(originalIdentity)) assert.equal(receipt.reconciliation[key], value, "original " + key);
    };
    const explicitOtherCheck = async () => {
      externalReceiptPosts++;
      const response = await applicationRequest(reconcilePath, { method: "POST" });
      assert.equal(response.status, 200);
      const body = await response.json(); exactIdentity(body); assert.equal(body.reconciliation.status, "known");
      return body;
    };
    try {
      execution = applicationRequest("/api/document-jobs/" + jobId + "/run", { method: "POST" });
      await enteredProvider.promise;
      for (let index = 0; index < 4; index++) { monotonic += 60_000; t.mock.timers.tick(60_000); await worker.flushExecution(); }
      assert.equal((await execution).status, 200);
      assert.equal(f.sqlite.prepare("SELECT status FROM document_jobs WHERE job_id=?").get(jobId).status, "failed");
      host = await createSceneStoreHost({ shared: true, workerFixture: { ...f, request: applicationRequest, requestId: jobId, payload: { workflowSources: [] }, close() { f.sqlite.close(); } } });
      const store = host.store;
      await store.outputRequirements.ensure(f.documentId, { force: true });
      assert.equal(store.outputRequirements.resource(f.documentId).state, "ready");
      ({ controller, i18n } = await component(store, f.documentId, locale));
      assert.equal(controller.i18n.locale, locale);
      const initial = structuredClone(store.outputRequirements.resource(f.documentId).snapshot);
      const privateSource = initial.requirements[0].content;
      assert.ok(privateSource);
      assert.ok(textValues(render(controller)).includes(privateSource), "the initial actual source is visible in this authorized scope");
      const action = eventHandlers(render(controller), "click").find(handler => handler.toString().includes("#checkOperationReceipt"));
      assert.ok(action, "the actual saved-receipt action remains reachable");
      const originalHeld = financial();
      assert.equal(originalHeld.token.status, "active"); assert.equal(originalHeld.cost.status, "executing");
      assert.equal(originalHeld.calls.length, 1); assert.equal(originalHeld.calls[0].status, "pending");
      if (mode === "known" || mode === "no-change") {
        releaseProvider.resolve(); await worker.flushExecution();
        if (mode === "no-change") await explicitOtherCheck();
      }
      host.intercept = async request => {
        if (mode === "refresh-failure" && request.url.startsWith("/api/output-requirements?"))
          return Response.json({ error: "service_unavailable" }, { status: 503 });
        if (request.url !== reconcilePath) return undefined;
        const response = await applicationRequest(request.url, request.init);
        assert.equal(response.status, 200); oldReceipt = await response.clone().json(); exactIdentity(oldReceipt);
        enteredReceipt.resolve(); await releaseReceipt.promise; return response;
      };
      const checking = action(); await enteredReceipt.promise;
      assert.equal(oldReceipt.reconciliation.status, mode === "known" ? "known" : mode === "no-change" ? "not_needed" : "uncertain");
      if (mode === "known") assert.equal(oldReceipt.reconciliation.reconciled, true);
      if (mode === "no-change") assert.equal(oldReceipt.reconciliation.reconciled, false);
      if (mode === "settled") {
        assert.deepEqual(financial(), originalHeld);
        releaseProvider.resolve(); await worker.flushExecution();
        const currentReceipt = await explicitOtherCheck();
        assert.equal(currentReceipt.reconciliation.reconciled, true);
      } else if (mode === "retired-scope")
        f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), f.contextId);
      const currentRows = financial();
      releaseReceipt.resolve(); await checking;
      const resource = store.outputRequirements.resource(f.documentId), rendered = render(controller);
      const currentOperation = resource.snapshot?.grants.find(grant => grant.id === authorized.grantId)?.operations.find(operation => operation.id === slot.slot_id);
      if (settledModes.has(mode)) {
        assert.equal(currentRows.token.reservation_id, slot.token_reservation_id);
        assert.equal(currentRows.cost.reservation_id, slot.cost_reservation_id);
        assert.equal(currentRows.token.status, "settled"); assert.equal(currentRows.token.used_tokens, 200);
        assert.equal(currentRows.cost.status, "settled"); assert.equal(currentRows.cost.used_microusd, 1200);
        assert.equal(currentRows.calls[0].status, "settled"); assert.equal(currentRows.calls[0].used_microusd, 1200);
        assert.equal(currentRows.slot.status, "failed"); assert.equal(currentRows.grant.status, "completed");
        assert.equal(currentOperation.jobId, jobId); assert.equal(currentOperation.pendingCalls, 0);
        assert.equal(currentOperation.exposedMicrousd, 0); assert.equal(currentOperation.usedMicrousd, 1200);
      } else {
        assert.deepEqual(currentRows, originalHeld, "uncertainty and access withdrawal cannot alter either original hold");
      }
      assert.deepEqual(financial(), currentRows, "the old acknowledgment and refreshed UI must not rewrite any ledger");
      assert.equal(providerCalls, 1, "the one original mocked provider call is never repeated");
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n, 1);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_operation_slots").get().n, 1);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_execution_grants").get().n, 1);
      assert.equal(host.requests.length, 3, "one initial GET, one exact receipt POST, and one read-only refresh");
      const posts = host.requests.filter(request => request.init.method === "POST");
      assert.equal(posts.length, 1); assert.equal(posts[0].url, reconcilePath); assert.deepEqual(posts[0].init, { method: "POST" });
      const reads = host.requests.filter(request => request.url.startsWith("/api/output-requirements?"));
      assert.equal(reads.length, 2);
      reads.forEach(request => assert.equal(new URL(request.url, "http://localhost").searchParams.get("documentId"), f.documentId));
      assert.equal(externalReceiptPosts, mode === "settled" || mode === "no-change" ? 1 : 0, "only the explicitly simulated second tab adds a receipt check");
      const shown = notice(rendered);
      if (historicalModes.has(mode)) {
        assert.equal(shown.role, "alert");
        assert.equal(shown.text, expectedGuidance[locale], "visible guidance time-qualifies the original receipt response and makes the safety warning conditional");
        assert.equal(shown.text, i18n.t("output.delivery.operationReceiptStillUnknown"));
        if (mode === "held") {
          assert.equal(currentOperation.pendingCalls, 1);
          assert.ok(textValues(rendered).includes(i18n.t("output.delivery.receiptUncertainHeld")), "genuine current uncertainty keeps its separate held-reservation safeguard");
        } else {
          assert.equal(textValues(rendered).includes(i18n.t("output.delivery.receiptUncertainHeld")), false);
        }
      } else if (mode === "retired-scope") {
        assert.equal(resource.snapshot, null); assert.equal(resource.privateUnavailable, true);
        assert.equal(JSON.stringify(rendered).includes(privateSource), false);
        assert.equal(shown.role, "alert"); assert.equal(shown.text, i18n.t("output.delivery.operationReceiptAccessChanged"));
        assert.notEqual(shown.text, expectedGuidance[locale]);
      } else {
        const key = mode === "known" ? "operationReceiptKnown" : mode === "no-change" ? "operationReceiptNoChange" : "operationReceiptRefreshFailed";
        assert.equal(shown.role, mode === "refresh-failure" ? "alert" : "status"); assert.equal(shown.text, i18n.t("output.delivery." + key));
        assert.notEqual(shown.text, expectedGuidance[locale]);
      }
      if (resource.snapshot) {
        assert.deepEqual(resource.snapshot.requirements, initial.requirements, "localization never rewrites authored requirements");
        assert.equal(currentOperation.jobId, originalIdentity.jobId);
        const money = value => i18n.number(value / 1_000_000, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });
        assert.ok(textValues(rendered).includes(i18n.t("output.delivery.retainedCost", "", {
          used: money(currentOperation.usedMicrousd), exposed: money(currentOperation.exposedMicrousd), maximum: money(currentOperation.maximumMicrousd),
        })), "current operation accounting remains visibly current beside the historical notice");
        assert.ok(textValues(rendered).includes(i18n.t("output.delivery.retainedCalls", "", {
          used: currentOperation.usedCalls, pending: currentOperation.pendingCalls, maximum: currentOperation.maximumCalls,
        })), "current calls and unresolved work are rendered independently of the earlier check response");
      }
    } finally {
      releaseReceipt.resolve(); releaseProvider.resolve(); t.mock.timers.reset();
      if (execution) await execution.catch(() => {});
      await worker.flushExecution(); i18n?.hostDisconnected();
      if (host) await host.close(); else f.sqlite.close();
    }
  });
