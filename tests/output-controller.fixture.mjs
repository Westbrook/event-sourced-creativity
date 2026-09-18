// This entry does not import the application entrypoint, load sessions, or call providers.
import { installSourceOwnershipPort } from "./helpers/source-ownership-port.mjs";
import "/src/components/forma-output-requirements.ts";
import { FormaStore } from "/src/state/store.ts";
import { OutputRequirementsClient } from "/src/state/output-requirements-client.ts";
import * as requirementDomain from "/src/model/output-requirements.ts";
import * as planDomain from "/src/model/output-plan.ts";
import { outputSavedPlanningOptions, resolveOutputPlanningCountPolicy } from "/src/components/output-plan-proposal-state.ts";
import { outputDeliveryReadiness, outputNativeReadiness, outputSourceReadiness } from "/src/components/output-source-readiness.ts";
import { inspectOutputAsset } from "/src/model/output-asset-inspection.ts";
import { setFormaLocale } from "/src/components/design-system/localization.ts";
import { createOutputControllerFixture, reconcileOutputFixtureReceipt, OUTPUT_CONTROLLER_SCENARIOS, FIXTURE_DOCUMENT_IDS, FIXTURE_ACTOR, FIXTURE_PROJECT, FIXTURE_PROJECT_ACCESS } from "./output-controller-fixture-model.mjs";

const query = (selector) => document.querySelector(selector);
if (new URL(window.location.href).searchParams.get("qa") === "automated") {
  document.title = "SYNTHETIC · automated controller QA";
  query("h1").textContent = "SYNTHETIC · automated controller QA";
}
const entries = [];
const totals = { requests: 0, authorize: 0, run: 0, save: 0, confirm: 0, review: 0, upload: 0, receipt: 0, receiptKnown: 0, receiptUncertain: 0, jobSync: 0, blockedGlobalFetch: window.__formaOutputFixtureBlockedRequests?.length ?? 0 };
const listeners = new Set();
let controller;
let adapter;
let store;
let collaboratorClient;
let readStateScheduled = false;
const notify = () => { listeners.forEach((listener) => listener()); scheduleDiagnostics(); };
const notice = (message) => { query("#fixture-notice").textContent = message; };

function record(entry) {
  const row = { sequence: entries.length + 1, ...entry };
  entries.push(row);
  if (entry.type === "fixture-request") { totals.requests++; if (Object.hasOwn(totals, entry.detail.action)) totals[entry.detail.action]++; }
  if (entry.type === "fixture-receipt-check") { if (entry.detail.status === "known") totals.receiptKnown++; else if (entry.detail.status === "uncertain") totals.receiptUncertain++; }
  if (entry.type === "fixture-job-sync") totals.jobSync++;
  query("#fixture-log").textContent = JSON.stringify(entries.slice(-60), null, 2);
  scheduleDiagnostics();
}

function scheduleDiagnostics() {
  if (readStateScheduled) return;
  readStateScheduled = true;
  queueMicrotask(() => { readStateScheduled = false; if (controller && store) diagnostics(); });
}

function diagnostics() {
  const resource = store.outputRequirements.resource(controller.documentId);
  const snapshot = resource.snapshot;
  query("#fixture-state").textContent = JSON.stringify({
    synthetic: true, providerWiring: "absent", actualServerAuthorityExercised: false,
    documentId: controller.documentId, connected: controller.isConnected, surface: controller.surface,
    authorizationScope: adapter.scope()?.key, resourceState: resource.state, revision: snapshot?.revision ?? null,
    confirmedPlanRevision: snapshot?.confirmedPlan?.revisionId ?? null, heldReply: adapter.heldAction,
    totals, summary: snapshot?.summary ?? null,
    planningSessions: { model: "two independent scoped clients; one synthetic identity", collaboratorResource: collaboratorClient?.resource(controller.documentId).state ?? "not-mounted" },
  }, null, 2);
  const saved = adapter.snapshot(controller.documentId);
  query("#fixture-receipt-state").textContent = JSON.stringify({
    synthetic: true, bridge: "Explicit in-memory store/adapter bridge; NOT the real FormaStore receipt method or actual server",
    providerWiring: "absent", actualServerAuthorityExercised: false,
    scenario: saved?.fixtureScenario, cachedSourceVerification: snapshot?.sourceVerification?.status ?? "unknown",
    counters: { receiptRequests: totals.receipt, knownReplies: totals.receiptKnown, uncertainReplies: totals.receiptUncertain,
      authorize: totals.authorize, run: totals.run, jobSync: totals.jobSync },
    cachedRevision: snapshot?.revision ?? null, adapterRevision: saved?.revision ?? null, heldReply: adapter.heldAction,
    grants: (snapshot?.grants ?? []).map((grant) => ({ id: grant.id, status: grant.status, usedMicrousd: grant.usedMicrousd,
      heldMicrousd: grant.exposedMicrousd, pendingCalls: grant.pendingCalls,
      operations: grant.operations.map((operation) => ({ id: operation.id, jobId: operation.jobId, status: operation.status,
        usedMicrousd: operation.usedMicrousd, heldMicrousd: operation.exposedMicrousd, pendingCalls: operation.pendingCalls })) })),
    jobs: adapter.jobs(controller.documentId).map((job) => ({ jobId: job.jobId, status: job.status, failureCode: job.errorDetail?.code ?? null })),
    checkedFiles: snapshot?.results.length ?? 0, acceptedFiles: snapshot?.results.filter((result) => result.review === "approved").length ?? 0,
  }, null, 2);
  const canPlan = saved?.permissions.canAuthor && saved.requirements.some((row) => row.spec?.deliverables.some((group) => group.media_kind === "slides"));
  query("#fixture-publish-exact11").disabled = !canPlan;
  query("#fixture-publish-structure").disabled = !canPlan;
  query("#fixture-publish-source").disabled = !saved?.permissions.canAuthor;
  inspectPlanning(false);
  const selected = query("#fixture-paid-target").value;
  const buttons = [...controller.querySelectorAll('button[data-output-paid-action="true"]')];
  query("#fixture-paid-target").replaceChildren(...buttons.map((button, index) => {
    const option = document.createElement("option"); option.value = String(index);
    option.textContent = `${index + 1}: ${button.textContent.trim()}${button.disabled ? " (disabled)" : ""}`;
    return option;
  }));
  if (buttons[Number(selected)]) query("#fixture-paid-target").value = selected;
  const settings = controller.querySelector('form[id^="output-authorize-settings-"]');
  const configuration = query("#fixture-configuration");
  configuration.setAttribute("form", settings?.id ?? "fixture-unpaid-configuration");
  query("#fixture-form-owner").textContent = settings
    ? `The fixture text field belongs to the real nonauthorizing settings form (${settings.id}). Enter must never submit the separate paid form.`
    : "No provider disclosure is open. The fixture text field belongs only to its harmless fixture form.";
}

function planningFacts(snapshot) {
  if (!snapshot) return null;
  const options = outputSavedPlanningOptions(snapshot);
  return {
    revision: snapshot.revision, requirementRevision: snapshot.requirementRevision, sourceRevision: snapshot.sourceRevision,
    sourceVerification: snapshot.sourceVerification ?? "not provided",
    readiness: { source: outputSourceReadiness(snapshot), delivery: outputDeliveryReadiness(snapshot), native: outputNativeReadiness(snapshot) },
    rows: snapshot.requirements.map((row) => ({ requirementId: row.blockId, status: row.status,
      deliverables: (row.spec?.deliverables ?? []).map((group) => ({ id: group.id, label: group.label, authoredContentQuantity: group.content_quantity ?? null,
        savedRowProposal: row.planSuggestions ?? null,
        effectiveSavedRule: group.content_quantity ? resolveOutputPlanningCountPolicy(options, group.id, group.id, group.content_quantity.unit) : null,
        separateAim: options.suggested_counts?.[group.id] ?? null,
      })),
    })),
    permissions: snapshot.permissions,
    results: snapshot.results.map((result) => ({ id: result.id, checks: result.checksStatus, review: result.review,
      reviewAllowed: typeof result.reviewAllowed === "boolean" ? result.reviewAllowed : "not provided", independentReviewBlocked: typeof result.independentReviewBlocked === "boolean" ? result.independentReviewBlocked : "not provided",
      resultRevisionMatchesAssetSha: result.resultRevision === snapshot.assets.find((asset) => asset.id === result.assetId)?.sha256,
    })),
  };
}

function inspectPlanning(log = true) {
  if (!controller || !store || !adapter) return;
  const panel = controller.querySelector(".output-plan-review");
  const form = panel?.querySelector("form");
  const fields = [...(panel?.querySelectorAll("fieldset") ?? [])].filter((group) => group.querySelector("select")).map((group) => ({
    label: group.querySelector("legend")?.textContent.trim(),
    selectedMode: group.querySelector("select")?.value,
    selectedModeText: group.querySelector("select")?.selectedOptions[0]?.textContent.trim(),
    visibleFields: [...group.querySelectorAll('input[type="text"]')].map((input) => ({ label: input.closest("label")?.textContent.trim(), value: input.value, invalid: input.getAttribute("aria-invalid") })),
  }));
  const visible = {
    reviewPanelOpen: Boolean(panel), comparisonShown: Boolean(panel?.querySelector(".output-plan-comparison")),
    confirmDisabled: form?.querySelector('button[type="submit"]')?.disabled ?? null,
    fields,
    resolvedAcceptanceText: [...(form?.children ?? [])].filter((child) => child.tagName === "DIV" && child.querySelector(":scope > b") && child.querySelectorAll(":scope > p").length === 2).map((child) => child.textContent.trim()),
    reviewForms: controller.querySelectorAll(".output-result-review").length,
    paidButtons: controller.querySelectorAll('[data-output-paid-action="true"]').length,
  };
  const data = { synthetic: true, authorityClaimed: false, identityModel: "Same fictional actor, two independent client caches; not two accounts",
    server: planningFacts(adapter.snapshot(controller.documentId)), sessionA: planningFacts(store.outputRequirements.resource(controller.documentId).snapshot),
    sessionB: planningFacts(collaboratorClient?.resource(controller.documentId).snapshot), visible, paidIntents: { authorize: totals.authorize, run: totals.run },
  };
  query("#fixture-planning-state").textContent = JSON.stringify(data, null, 2);
  if (log) record({ type: "fixture-planning-inspection", detail: data });
}

async function publishCollaborator(kind) {
  const documentId = controller.documentId;
  const prepared = await collaboratorClient.ensure(documentId, { force: true });
  if (prepared.state !== "ready" || !prepared.snapshot) throw new Error("Synthetic client B could not obtain a current snapshot.");
  if (kind === "source") {
    adapter.publishSourceRevision(documentId);
    await collaboratorClient.ensure(documentId, { force: true });
  } else {
    const command = adapter.prepareCollaboratorSave(documentId, kind);
    const response = await collaboratorClient.command(documentId, { ...command, expectedRevision: prepared.snapshot.revision, clientMutationId: crypto.randomUUID() }, "save synthetic collaborator planning choices");
    if (response.status !== "saved") throw new Error(`Synthetic client B save was not confirmed: ${response.status}`);
  }
  record({ type: "fixture-collaborator-published", detail: { session: "B", kind, documentId, revision: adapter.snapshot(documentId).revision, sameRequirementAndDeliverableIds: true, synthetic: true } });
  if (query("#fixture-collaborator-refresh").checked) await freshSnapshot();
  else scheduleDiagnostics();
  notice(query("#fixture-collaborator-refresh").checked
    ? "Synthetic B published and A refreshed. Review A’s actual controls and conflict state; no generation was started."
    : "Synthetic B published without refreshing A. A still shows its earlier cache; its next stale write must return 409, not overwrite B.");
  await controller.updateComplete;
  inspectPlanning();
}

function action(selector, operation) {
  query(selector).addEventListener("click", async (event) => {
    try { await operation(event); }
    catch (error) { record({ type: "fixture-control-error", detail: { message: String(error) } }); notice(String(error)); }
  });
}

async function freshSnapshot() {
  await store.outputRequirements.ensure(controller.documentId, { force: true });
  notify();
}

function paidButton() {
  const button = [...controller.querySelectorAll('button[data-output-paid-action="true"]')][Number(query("#fixture-paid-target").value)];
  if (!button || !button.form || button.disabled) { notice("No enabled paid button to probe. Prepare a disclosure and acknowledge it, or load the separate alternative grant."); return null; }
  return button;
}

function negativeProbe(kind, invoke) {
  const button = paidButton(); if (!button) return;
  const before = totals.authorize + totals.run;
  record({ type: "fixture-negative-probe", detail: { kind, button: button.textContent.trim(), userActivation: navigator.userActivation?.isActive === true } });
  invoke(button);
  // Requests dispatch before the fake adapter awaits; next task observes the harmless counters.
  setTimeout(() => {
    const difference = totals.authorize + totals.run - before;
    const message = `${kind}: ${difference} additional authorize/run requests; expected 0. This checks only this isolated browser fixture.`;
    notice(message); record({ type: "fixture-negative-observation", detail: { kind, additionalPaidIntents: difference, expected: 0 } });
  }, 0);
}

for (const [value, label] of Object.entries(OUTPUT_CONTROLLER_SCENARIOS)) {
  const option = document.createElement("option"); option.value = value; option.textContent = label; query("#fixture-scenario").append(option);
}
const parameters = new URLSearchParams(location.search);
const locale = ["en", "fr", "ar", "ja"].includes(parameters.get("locale")) ? parameters.get("locale") : "en";
await setFormaLocale(locale, { persist: false });
query("#fixture-locale").value = locale;
adapter = await createOutputControllerFixture({ domain: { ...requirementDomain, ...planDomain, inspectOutputAsset }, onRecord: record });
store = {
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  notify,
  // Observe this isolated page's URL only; setRoute still records intent without navigating.
  route: { get: () => window.location.pathname + window.location.search + window.location.hash },
  captureAuthorizationScope: () => adapter.scope() ? { key: adapter.scope().key, shared: false } : null,
  authorizationScopeActive: (scope) => Boolean(scope && !scope.shared && scope.key === adapter.scope()?.key),
  session: { get: () => adapter.scope() ? { user: { userId: FIXTURE_ACTOR, displayName: "Fictional fixture author" } } : null },
  projection: { get: () => ({ projectId: FIXTURE_PROJECT, libraryBlocks: FIXTURE_DOCUMENT_IDS.flatMap((documentId) => adapter.sourceBlocks(documentId)) }) },
  refreshEvents: () => adapter.refreshEvents(),
  syncDocumentJobs: async () => { record({ type: "fixture-job-sync", detail: { note: "No job API exists in this fixture." } }); },
  documentJobs: { get: () => controller ? adapter.jobs(controller.documentId) : [] },
  stopDocumentJob: async (jobId) => adapter.stopJob(jobId),
  append: async (event) => adapter.appendFixtureEvent(event),
  setRoute: (route) => record({ type: "fixture-navigation-intent", detail: { route } }),
};
installSourceOwnershipPort(store);
const isFixtureSnapshot = (value, documentId, scope) => value?.schemaVersion === 1 && value.documentId === documentId && value.projectId === scope.projectId
  && typeof value.revision === "string" && Array.isArray(value.requirements) && value.scope?.actorUserId === FIXTURE_ACTOR
  && (value.scope.kind === "personal" && value.scope.projectAccessId === null || value.scope.kind === "project" && value.scope.projectAccessId === FIXTURE_PROJECT_ACCESS);
store.outputRequirements = new OutputRequirementsClient({
  captureScope: () => adapter.scope(), scopeActive: (scope) => adapter.scopeActive(scope), fetch: (path, init) => adapter.fetch(path, init), notify,
  isSnapshot: isFixtureSnapshot,
});
collaboratorClient = new OutputRequirementsClient({
  captureScope: () => adapter.scope(), scopeActive: (scope) => adapter.scopeActive(scope),
  fetch: (path, init) => { record({ type: "fixture-session-client", detail: { session: "B", path: String(path), method: init?.method ?? "GET" } }); return adapter.fetch(path, init); },
  notify: scheduleDiagnostics, isSnapshot: isFixtureSnapshot,
});
// These are the actual public wrapper method bodies, on an explicit fixture host.
// The singleton imported transitively by FormaElement is never connected or loaded.
store.outputRequirementCommand = (command) => FormaStore.prototype.outputRequirementCommand.call(store, command);
store.uploadOutputAsset = (...args) => FormaStore.prototype.uploadOutputAsset.call(store, ...args);
// This one is deliberately NOT borrowed: the actual receipt method owns private #jobDetails.
// Its actual-method/server tests are separate. Here only the controller's UI and adapter boundary run.
store.reconcileOutputOperationReceipt = (documentId, grantId, slotId, jobId) => reconcileOutputFixtureReceipt({
  adapter, client: store.outputRequirements, documentId, grantId, slotId, jobId, notify,
});

controller = document.createElement("forma-output-requirements");
controller.store = store; // Assign before connectedCallback subscribes; TS protected is not a JS private field.
controller.documentId = FIXTURE_DOCUMENT_IDS[0];
controller.documentName = "SYNTHETIC Document A";
controller.surface = "deliver";
const initial = Object.hasOwn(OUTPUT_CONTROLLER_SCENARIOS, parameters.get("case")) ? parameters.get("case") : "ready";
query("#fixture-scenario").value = initial;
adapter.seed(controller.documentId, initial);
query("#fixture-host").append(controller); // Actual Lit lifecycle starts the first scoped fake GET.

new MutationObserver(scheduleDiagnostics).observe(controller, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "id"] });
for (const type of ["click", "submit"]) controller.addEventListener(type, (event) => {
  const button = type === "submit" ? event.submitter : event.target.closest?.("button");
  if (type === "click" && !button) return;
  record({ type: `native-${type}`, detail: { isTrusted: event.isTrusted, button: button?.textContent?.trim() ?? null,
    paidButton: button?.dataset?.outputPaidAction === "true", form: event.target.id || event.target.className || "unnamed",
    userActivation: navigator.userActivation?.isActive === true } });
}, true);
document.addEventListener("submit", (event) => {
  if (event.target.id?.startsWith("output-authorize-settings-") || event.target.id === "fixture-unpaid-configuration") {
    record({ type: "configuration-submit", detail: { form: event.target.id, isTrusted: event.isTrusted, paidIntents: totals.authorize + totals.run } });
  }
}, true);
query("#fixture-configuration").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const before = totals.authorize + totals.run;
  const form = event.currentTarget.form?.id;
  setTimeout(() => {
    const difference = totals.authorize + totals.run - before;
    notice(`Configuration Enter: ${difference} additional authorize/run requests; expected 0.`);
    record({ type: "configuration-enter-observation", detail: { isTrusted: event.isTrusted, form, additionalPaidIntents: difference, expected: 0 } });
  }, 0);
});
query("#fixture-controls").addEventListener("submit", (event) => event.preventDefault());
query("#fixture-unpaid-configuration").addEventListener("submit", (event) => event.preventDefault());
query("#fixture-collaborator-controls").addEventListener("submit", (event) => event.preventDefault());
controller.addEventListener("input", scheduleDiagnostics);
controller.addEventListener("change", scheduleDiagnostics);
controller.addEventListener("focusin", (event) => record({ type: "native-focusin", detail: { tag: event.target.tagName, label: event.target.getAttribute?.("aria-label") || event.target.textContent?.trim().slice(0, 180), view: controller.documentId } }));
query("#fixture-document").addEventListener("change", (event) => {
  controller.documentId = event.target.value; controller.documentName = `SYNTHETIC Document ${controller.documentId.endsWith("a") ? "A" : "B"}`;
  record({ type: "fixture-document-change", detail: { documentId: controller.documentId } });
});
query("#fixture-surface").addEventListener("change", (event) => { controller.surface = event.target.value; });
query("#fixture-locale").addEventListener("change", async (event) => { await setFormaLocale(event.target.value, { persist: false }); notify(); });
query("#fixture-width").addEventListener("change", (event) => { query("#fixture-host").dataset.narrow = String(event.target.value === "narrow"); });
action("#fixture-reset", async () => {
  adapter.seed(controller.documentId, query("#fixture-scenario").value); adapter.changeScope(); store.outputRequirements.clear(); collaboratorClient.clear(); notify();
  notice("Loaded a new fictional scenario. Prior operation identities cannot authorize it.");
});
action("#fixture-disconnect", () => { controller.remove(); record({ type: "fixture-disconnected", detail: { documentId: controller.documentId } }); });
action("#fixture-reconnect", () => { if (!controller.isConnected) query("#fixture-host").append(controller); record({ type: "fixture-reconnected", detail: { documentId: controller.documentId } }); });
action("#fixture-refresh", freshSnapshot);
action("#fixture-publish-exact11", () => publishCollaborator("exact11"));
action("#fixture-publish-structure", () => publishCollaborator("structure"));
action("#fixture-publish-source", () => publishCollaborator("source"));
action("#fixture-inspect-planning", () => { inspectPlanning(); notice("Inspector reads only synthetic saved snapshots and the real controller’s visible fields. It does not change a product choice."); });
action("#fixture-revision", () => adapter.bumpRevision(controller.documentId));
action("#fixture-source-unavailable", async () => { adapter.setSourceVerification(controller.documentId, false); await freshSnapshot(); notice("Synthetic evidence is unavailable with the same source/requirement digests. No sources were removed. Inspect blocked actions and retained Stop controls."); });
action("#fixture-source-verify", async () => { adapter.setSourceVerification(controller.documentId, true); await freshSnapshot(); notice("Rechecked synthetic evidence against the same source set and declared owned/read limit. Over-capacity sources stay unavailable; no count or route limit was changed."); });
action("#fixture-upload-capacity", () => { adapter.failNextUploadCapacity(); notice("The next upload receives a capacity 409, not a revision conflict. Its file must remain selected without a misleading revision-restage action."); });
action("#fixture-conflict", () => { adapter.conflictNextWrite(); notice("The next write will return a code-only 409. Edit and save to exercise the real comparison flow."); });
action("#fixture-hydration", () => { adapter.failNextHydration(); notice("The next committed command will be followed by a failed event refresh; it must not be submitted twice."); });
action("#fixture-unavailable", async () => { adapter.failNextGet(); await freshSnapshot(); });
action("#fixture-revoke", async () => { adapter.setPermissions(controller.documentId, false); await freshSnapshot(); });
action("#fixture-restore", async () => { adapter.setPermissions(controller.documentId, true); await freshSnapshot(); });
action("#fixture-scope", () => { adapter.changeScope(); store.outputRequirements.clear(); collaboratorClient.clear(); notify(); });
action("#fixture-complete", async () => { adapter.completeOperations(controller.documentId); await freshSnapshot(); });
action("#fixture-select-png", () => {
  const input = controller.querySelector('.output-file-upload input[type="file"]');
  if (!input) { notice("Open the Deliver or Document surface with fictional author permission first."); return; }
  const transfer = new DataTransfer(); transfer.items.add(adapter.sampleFile()); input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  record({ type: "fixture-file-selection", detail: { name: adapter.sampleFile().name, byteLength: adapter.sampleFile().size, nativeFilePickerExercised: false } });
  notice("Selected the 68-byte synthetic PNG. Confirm rights using the real checkbox, then use the real Upload button. This does not test the native file picker.");
});
action("#fixture-hold", () => { adapter.armHold(query("#fixture-hold-kind").value, query("#fixture-hold-stage").value); notice("Next matching reply will wait for Release. Continue with the normal product control, then change Document, scope, or connection."); });
action("#fixture-release", () => { notice(adapter.release() ? "Released the frozen old reply. Inspect the current Document and harmless request counters." : "No reply is held."); });
action("#fixture-request-submit", () => negativeProbe("unrelated requestSubmit", (button) => button.form.requestSubmit(button)));
action("#fixture-synthetic-submit", () => negativeProbe("synthetic SubmitEvent", (button) => button.form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }))));
action("#fixture-programmatic-click", () => negativeProbe("programmatic click", (button) => button.click()));
action("#fixture-clear-log", () => { entries.length = 0; query("#fixture-log").textContent = "Visible log cleared; cumulative counters retained."; });
window.addEventListener("fixture-network-blocked", (event) => { totals.blockedGlobalFetch++; record({ type: "blocked-global-fetch", detail: event.detail }); notice("A global fetch was blocked; no request was sent. The source server’s HMR fallback may cause this. An API/provider path would be an isolation defect to investigate."); });
window.addEventListener("unhandledrejection", (event) => { record({ type: "unhandled-rejection", detail: { message: String(event.reason) } }); notice(`Fixture failure: ${String(event.reason)}`); });
window.addEventListener("error", (event) => { record({ type: "window-error", detail: { message: event.message } }); });
await controller.updateComplete;
diagnostics();
notice("Synthetic controller mounted. No provider or real account is connected. Source modules load normally; this page deliberately blocks API connections and HMR sockets.");
