import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { buildOutcomeTelemetry } from "../src/model/outcome-telemetry.ts";
import { adaptiveProposalOptions, buildAdaptiveProposalApplication } from "../src/model/adaptive-proposal-application.ts";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { documentContextBlockFromRoute } from "../src/model/routes.ts";
import { FORMA_OUTCOME_MESSAGES } from "../src/components/design-system/locales/outcome-messages.ts";
import { ADAPTIVE_PROPOSAL_MESSAGES } from "../src/components/design-system/locales/adaptive-proposal-messages.ts";
import { makeEvent, readEvents, appendEvents } from "../worker/runtime.ts";
import { handleAnalytics } from "../worker/analytics-api.ts";
import { compileSqliteExpressionDepth } from "./helpers/d1-expression-depth.mjs";
import { gunzipSync, gzipSync } from "node:zlib";
import { publicEventPayload } from "../worker/event-privacy.ts";
import { normalizeOutputRequirementCreation } from "../worker/output-requirement-event-guards.ts";
import { png } from "./output-asset-fixtures.mjs";

const adaptiveImports = registerOutputSourceImports();
const { adaptiveSelectionKey } = await import("../src/components/adaptive-proposal-review.ts").finally(() => adaptiveImports.deregister());

// Reuse complete existing fixture declarations with their actual imported runtime.
// Only test registration is excluded; no production methods or assertions are replaced.
async function fixtureDefinitions(file, names) {
  const url = new URL(file, import.meta.url), source = readFileSync(url, "utf8");
  const tree = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let declarations = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
    || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
    || ts.isExpressionStatement(node) && node.getText(tree) === "hooks.deregister();")
    .map(node => node.getFullText(tree)).join("\n");
  if (file === "./adaptive-proposal-host.test.mjs") {
    // Locale is a fixture port. The actual dialog/controller methods are unchanged.
    assert.ok(declarations.includes('function render(f,locale="en"){'));
    assert.ok(declarations.includes("ADAPTIVE_PROPOSAL_MESSAGES[locale][key]"));
  }
  const fixtureUrl = new URL(url); fixtureUrl.search = "?phase8-output-forward-fixture";
  const hook = registerHooks({ load(request, context, next) {
    return request === fixtureUrl.href ? { format: "module", source: declarations + "\nexport { " + names.join(",") + " };\n", shortCircuit: true } : next(request, context);
  } });
  try { return await import(fixtureUrl.href); } finally { hook.deregister(); }
}
const paid = await fixtureDefinitions("./adaptive-proposal-host.test.mjs", ["fixture","previewFor","receiptFor","saved","render","deferred","nativeBlock","originalHash","bindingHash","approvalHash","currentHash","structure"]);
const historyHost = await fixtureDefinitions("./outcome-telemetry-host.test.mjs", ["fixture","report","event"]);
const owned = await fixtureDefinitions("./output-requirements-api.test.mjs", ["fixture","planFixture","owner","doc","project"]);

// Reuse the same full-page native ports as the existing Rail and Desk tests.
const {createOutputReachabilityPage,isOutputFixtureReadOnlyResume}=await import("./helpers/output-reachability-fixture.mjs");
const {calmFullPageNativePorts:fullPageNativePorts}=await import("./helpers/calm-full-page-fixture.mjs");
const {installOutputNavigationFocusNative}=await import("./helpers/output-navigation-focus-native.mjs");
const routed = await fixtureDefinitions("./assistant-runtime.test.mjs", ["main170Phase8Fixture","main170Phase8OutputSelection","main170Phase8Ledgers","phase8Request","phase8PaidEvidence","phase8AssertNoPayment",
  "fixture","appendFixtureEvents","adaptiveFixtureResponse","quoteAdaptiveConsent","executeAdaptiveConsent","enforceD1ExpressionDepth"]);

const originalFetch = globalThis.fetch;
let providerCalls = 0;
test.before(() => { globalThis.fetch = async () => { providerCalls++; throw new Error("phase8_output_forward_no_provider"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(providerCalls, 0); });

const outputKindFields = {
  OutputPlanConfirmed: { plan_revision_id: "plan-a" },
  OutputTargetAccepted: { plan_revision_id: "plan-a", target_id: "target-a", result_id: "result-a", acceptance_id: "acceptance-a" },
  OutputFulfillmentSelected: { plan_revision_id: "plan-b", target_id: "target-a", result_id: "result-b", acceptance_id: "acceptance-a" },
  OutputTargetChangesRequested: { plan_revision_id: "plan-a", target_id: "target-a", result_id: "result-a" },
  OutputDeliveryPrepared: { plan_revision_id: "plan-a", manifest_id: "manifest-a" },
};
let eventSequence = 0;
function outputReceipt(type, payload = {}, overrides = {}) {
  const n = ++eventSequence, event = makeEvent("creative:owner-a", n, "user:actor-a", "server:output-requirements", "command-" + n, type,
    { project_id: "project-a", document_id: "doc-a", actor_user_id: "actor-a", ...outputKindFields[type], ...payload });
  return { ...event, ...overrides };
}
const publicReceipt = event => ({ ...event, payload: publicEventPayload(event.eventId, event.payload, true).payload });
const telemetry = (events, options = {}) => buildOutcomeTelemetry([{ streamId: events[0]?.streamId ?? "creative:owner-a", fictional: false, events }], { now: Date.now() + 1000, ...options });
const currentUnknown = history => {
  for (const key of ["scopeAmendmentReceiptCount","currentlyOwedTargetCount","currentlyAcceptedTargetCount","currentScopeAmended","currentDeliveryReady","browserDownloadCount","recipientDeliveryCount"]) assert.equal(history[key], null, key);
};

test("real public Output receipts remain distinct from legacy artifact approvals and exports", () => {
  const events = Object.keys(outputKindFields).map(kind => publicReceipt(outputReceipt(kind)));
  const legacy = { document_id: "doc-a", artifact_id: "artifact-a", artifact_revision: 2, content_sha256: "a".repeat(64) };
  events.push(outputReceipt("ArtifactApproved", legacy), outputReceipt("DocumentArtifactExported", legacy));
  const result = telemetry(events), history = result.outputHistory;
  assert.equal(history.basis, "historical-output-command-receipts");
  for (const key of ["planConfirmationReceiptCount","targetAcceptanceReceiptCount","reusedAcceptanceSelectionReceiptCount","changesRequestedReceiptCount","deliveryPreparationReceiptCount"]) assert.equal(history[key], 1, key);
  assert.equal(result.approvals.receiptCount, 1); assert.equal(result.exports.artifactReceiptCount, 1);
  assert.equal(result.approvals.distinctExactRevisionCount, 1); assert.equal(result.exports.distinctExactRevisionCount, 1);
  assert.equal(history.unclassifiedReceiptCount, 0); assert.equal(history.ignoredDuplicateReceiptCount, 0); currentUnknown(history);
});

test("duplicate event, command, acceptance and numbered-package identities never add approvals or deliveries", () => {
  const acceptance = publicReceipt(outputReceipt("OutputTargetAccepted")), package_ = publicReceipt(outputReceipt("OutputDeliveryPrepared"));
  const events = [acceptance, acceptance, { ...acceptance, eventId: "repeat-command" },
    { ...acceptance, eventId: "repeat-acceptance", correlationId: "other-operation" }, package_,
    { ...package_, eventId: "part-2", correlationId: "download-part-2", payload: { ...package_.payload, part_number: 2 } },
    { ...package_, eventId: "part-3", correlationId: "download-part-3", payload: { ...package_.payload, part_number: 3 } },
    publicReceipt(outputReceipt("OutputFulfillmentSelected")), publicReceipt(outputReceipt("OutputTargetChangesRequested"))];
  const result = telemetry(events);
  assert.equal(result.coverage.ignoredDuplicateReceipts, 1);
  assert.equal(result.outputHistory.targetAcceptanceReceiptCount, 1);
  assert.equal(result.outputHistory.deliveryPreparationReceiptCount, 1);
  assert.equal(result.outputHistory.reusedAcceptanceSelectionReceiptCount, 1);
  assert.equal(result.outputHistory.changesRequestedReceiptCount, 1);
  assert.equal(result.outputHistory.ignoredDuplicateReceiptCount, 4);
  assert.equal(result.approvals.receiptCount, 0); assert.equal(result.exports.artifactReceiptCount, 0); currentUnknown(result.outputHistory);
});

for (const [name, change] of [
  ["foreign client", event => ({ ...event, clientId: "browser:untrusted" })],
  ["foreign actor", event => ({ ...event, actor: "user:other" })],
  ["missing command", event => ({ ...event, correlationId: "" })],
  ["missing project", event => ({ ...event, payload: { ...event.payload, project_id: null } })],
  ["wrong target type", event => ({ ...event, payload: { ...event.payload, target_id: 42 } })],
  ["malformed identity", event => ({ ...event, payload: { ...event.payload, acceptance_id: "acceptance has spaces" } })],
]) test(name + " Output receipt is unclassified, not an acceptance or a zero-current-status claim", () => {
  const result = telemetry([change(publicReceipt(outputReceipt("OutputTargetAccepted")))]);
  assert.equal(result.outputHistory.targetAcceptanceReceiptCount, 0);
  assert.equal(result.outputHistory.unclassifiedReceiptCount, 1); currentUnknown(result.outputHistory);
});

test("history window and synthetic filtering also apply to Output records without inferring current state", () => {
  const now = Date.now(), recent = publicReceipt(outputReceipt("OutputTargetAccepted"));
  const old = { ...recent, eventId: "old", occurredAt: new Date(now - 86_400_000).toISOString() };
  const synthetic = publicReceipt(outputReceipt("OutputDeliveryPrepared", { synthetic: true }));
  const result = telemetry([old, recent, synthetic], { now: now + 1000, rangeStart: new Date(now - 1000).toISOString() });
  assert.equal(result.outputHistory.targetAcceptanceReceiptCount, 1);
  assert.equal(result.outputHistory.deliveryPreparationReceiptCount, 0); currentUnknown(result.outputHistory);
  const missing = buildOutcomeTelemetry([{ streamId: recent.streamId, fictional: true, events: [recent] }], { now: now + 1000 });
  assert.equal(missing.outputHistory.targetAcceptanceReceiptCount, 0); currentUnknown(missing.outputHistory);
});

test("private scope amendments and package bodies never become public historical or current metrics", () => {
  const confirmed = outputReceipt("OutputPlanConfirmed", { scope_amendment: { reason: "PRIVATE_REASON", previous_plan_revision_id: "old", withdrawn_target_ids: ["private-target"] }, confirmed_plan: { targets: [{ label: "PRIVATE_LABEL" }] } });
  const prepared = outputReceipt("OutputDeliveryPrepared", { manifest: { parts: [1,2,3], files: [{ name: "PRIVATE_FILE" }], scopeAmendments: [{}] }, is_partial: false });
  const public_ = [confirmed, prepared].map(publicReceipt);
  assert.equal(public_[0].payload.scope_amendment, undefined); assert.equal(public_[0].payload.confirmed_plan, undefined);
  assert.equal(public_[1].payload.manifest, undefined); assert.equal(public_[1].payload.is_partial, undefined);
  const result = telemetry(public_);
  assert.equal(result.outputHistory.planConfirmationReceiptCount, 1); assert.equal(result.outputHistory.deliveryPreparationReceiptCount, 1);
  currentUnknown(result.outputHistory); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|private-target/);
  // Even an accidentally hydrated payload is not authority to expose private content or infer a metric.
  assert.deepEqual(telemetry([confirmed, prepared]).outputHistory, result.outputHistory);
});

test("actual owned-file Output route creates historical acceptance/reuse/package receipts with zero generation", async t => {
  const state = await owned.planFixture(); t.after(() => state.sqlite.close());
  const target = state.plan.plan.targets.find(item => item.selected && item.aspect_ratio.width === item.aspect_ratio.height);
  assert.ok(target);
  const uploaded = await state.upload(png({ width: 20, height: 20 }));
  const bound = await state.command({ action: "bind", planRevisionId: state.plan.revisionId, targetId: target.id, assetId: uploaded.command.assetId });
  const accepted = await state.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  const delivery = await state.command({ action: "export", planRevisionId: state.plan.revisionId, allowPartial: true });
  const read = async () => (await readEvents(state.env, "creative:" + owned.owner)).map(publicReceipt);
  const before = telemetry(await read()), history = before.outputHistory;
  assert.equal(history.targetAcceptanceReceiptCount, 1); assert.equal(history.deliveryPreparationReceiptCount, 1);
  assert.equal(history.reusedAcceptanceSelectionReceiptCount, 0); currentUnknown(history);
  const downloaded = await state.send(delivery.command.downloadUrl); assert.equal(downloaded.status, 200); await downloaded.arrayBuffer();
  assert.deepEqual(telemetry(await read()).outputHistory, history, "a file GET creates no new package or recipient-delivery receipt");
  const again = await state.command({ action: "confirm" });
  const reused = await state.command({ action: "bind", planRevisionId: again.command.planRevisionId, targetId: target.id, acceptanceId: accepted.command.acceptanceId });
  assert.equal(reused.snapshot.targetStates.find(item => item.target_id === target.id).review, "accepted");
  const after = telemetry(await read()).outputHistory;
  assert.equal(after.planConfirmationReceiptCount, 2);
  assert.equal(after.targetAcceptanceReceiptCount, 1, "reused acceptance is not a second human approval");
  assert.equal(after.reusedAcceptanceSelectionReceiptCount, 1);
  assert.equal(after.deliveryPreparationReceiptCount, 1); currentUnknown(after);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n, 0);
  assert.equal(providerCalls, 0);
});

for (const locale of ["en","fr","ar","ja"]) {
  test(locale + " actual analytics host separates Output history and explicitly unmeasured current facts", async () => {
    const f = historyHost.fixture(locale), receipt = publicReceipt(outputReceipt("OutputDeliveryPrepared", {}, { streamId: "creative:actor-a" }));
    const report = historyHost.report([receipt]); await f.load(report);
    const markup = f.analytics.render(), disclosure = f.helpers.outcomeTelemetryDisclosure(report.outcomes, f.i18n, true);
    assert.ok(markup.includes(disclosure));
    for (const id of ["outcome.outputHistory","outcome.outputPlans","outcome.outputAcceptances","outcome.outputReusedSelections","outcome.outputChangesRequested","outcome.outputPreparations","outcome.outputHistoricalOnly","outcome.outputCurrentUnmeasured","outcome.approvals"]) {
      assert.ok(disclosure.includes(FORMA_OUTCOME_MESSAGES[locale][id]), id);
      assert.ok(FORMA_OUTCOME_MESSAGES[locale][id]);
    }
    assert.doesNotMatch(disclosure, /<button|<a |download=|ROI|NaN|undefined|PRIVATE_/u);
    assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 1);
  });
  test(locale + " an old saved report without Output evidence displays unavailable, never invented zero counters", () => {
    const f = historyHost.fixture(locale), report = historyHost.report();
    delete report.outcomes.outputHistory;
    const markup = f.helpers.outcomeTelemetryDisclosure(report.outcomes, f.i18n, false);
    assert.ok(markup.includes(FORMA_OUTCOME_MESSAGES[locale]["outcome.outputUnavailable"]));
    assert.ok(markup.includes(FORMA_OUTCOME_MESSAGES[locale]["outcome.outputCurrentUnmeasured"]));
    assert.ok(!markup.includes("<dt>" + FORMA_OUTCOME_MESSAGES[locale]["outcome.outputAcceptances"] + "</dt>"));
    assert.equal(f.calls.length, 0);
  });
}

function outputFixture(options = {}) {
  const f = paid.fixture(options), source = structuredClone(f.state.source.structure);
  source.suggested_blocks[0] = { ...source.suggested_blocks[0], type: "output", subtype: "Custom deliverables", label: "An authored Output", instruction: "Output exactly one image at 1:1." };
  f.state.source.structure = source;
  const existing = f.state.projection.libraryBlocks[1];
  existing.type = "output"; existing.properties = { ...existing.properties, subtype: "Custom deliverables", text: "Original Output instructions" };
  return f;
}
async function outputPreview(f, selections, id = "output-preview") {
  const scope = f.state.scope, source = f.state.source.structure; let next = 0;
  const planned = buildAdaptiveProposalApplication({ projection: f.state.projection, documentId: scope.documentId, canvasId: scope.canvasId, structure: source, executionId: "paid-original", bindingHash: paid.bindingHash, selections, createId: () => id + "-object-" + (++next) });
  return { previewId: id, approvalHash: paid.approvalHash, sourceHash: paid.currentHash, projectId: scope.projectId, documentId: scope.documentId, canvasId: scope.canvasId, blockId: "",
    events: planned.events.map(event => event.type === "BlockCreated" ? { ...event, payload: normalizeOutputRequirementCreation(event.payload) } : event), changes: planned.changes, blockCount: selections.length, relationCount: 0, expiresAt: "2099-01-01T00:00:00.000Z",
    adaptiveReview: { executionId: "paid-original", bindingHash: paid.bindingHash, selectionKey: await adaptiveSelectionKey(scope, "paid-original", paid.bindingHash, selections), originalSourceHash: paid.originalHash, currentSourceHash: paid.currentHash, sourceChanged: true,
      selections: structuredClone(selections), interpretation: source.interpretation, originalSuggestions: adaptiveProposalOptions(source).filter(item => selections.some(selection => selection.proposalId === item.proposalId)) } };
}
for (const canvasId of [null,"board-a"]) test((canvasId ? "Canvas" : "Document") + " excludes existing Output targets but preserves deliberate new Output draft normalization", async () => {
  const f = outputFixture({ canvasId });
  f.controller.open("paid-original", ["/suggested_blocks/0"], canvasId ? { x: 42, y: 84, w: 300, h: 210 } : undefined);
  assert.deepEqual(f.controller.targets("/suggested_blocks/0"), []);
  assert.equal(f.controller.selections()[0].targetBlockId, undefined);
  assert.equal(f.controller.canPreview, true); assert.equal(f.controller.outputEditorRequired, false);
  const preparing = f.controller.request("preview"), call = await f.take(), preview = await outputPreview(f, call.body.selections);
  assert.ok(preview.events.find(event => event.type === "BlockCreated").payload.properties.output_spec);
  await f.reply(call, { status: "review", preview }); await preparing;
  assert.equal(f.controller.canApply, true); assert.equal(f.controller.executionId, "paid-original"); assert.equal(f.controller.bindingHash, paid.bindingHash);
  const applying = f.controller.request("apply"), apply = await f.take();
  assert.deepEqual(apply.body, { action: "apply", projectId: "project-a", documentId: "doc-a", canvasId, previewId: preview.previewId, approvalHash: paid.approvalHash });
  await f.reply(apply, paid.receiptFor(preview)); await applying;
  assert.equal(f.controller.phase, "applied");
  assert.ok(paid.render(f).markup.includes(ADAPTIVE_PROPOSAL_MESSAGES.en["adaptive.changes.notDelivery"]));
  assert.equal(f.calls.length, 2);
});

for (const canvasId of [null,"board-a"]) test((canvasId ? "Canvas" : "Document") + " retained existing Output selection keeps exact ID, own edits and Check/Dismiss, never becomes Create", async () => {
  const f = outputFixture({ canvasId });
  f.controller.open("paid-original", ["/suggested_blocks/0"]);
  f.controller.update("/suggested_blocks/0", "targetBlockId", "second-subject");
  f.controller.update("/suggested_blocks/0", "text", "  My unchanged proposal draft.\\n");
  assert.equal(f.controller.outputEditorRequired, true); assert.equal(f.controller.canPreview, false);
  await f.controller.request("preview"); assert.equal(f.calls.length, 0);
  const markup = paid.render(f).markup;
  assert.match(markup, /<option value=second-subject disabled \.selected=true>/u);
  assert.ok(markup.includes(ADAPTIVE_PROPOSAL_MESSAGES.en["adaptive.changes.outputEditorRequired"]));
  assert.equal(f.controller.selections()[0].targetBlockId, "second-subject"); assert.equal(f.controller.selections()[0].edit.text, "  My unchanged proposal draft.\\n");
  const old = await outputPreview(f, f.controller.selections()), resuming = f.controller.resume(), read = await f.take();
  await f.reply(read, { status: "not-applied", preview: old, readOnly: true }); await resuming;
  assert.equal(f.controller.handle.previewId, old.previewId); assert.equal(f.controller.canApply, false); assert.equal(f.controller.canDismiss, true);
  assert.equal(f.controller.selections()[0].targetBlockId, "second-subject"); assert.equal(f.controller.canPreview, false);
  f.controller.close(); f.controller.reopen(); assert.equal(f.controller.handle.previewId, old.previewId);
  const checking = f.controller.resume(), check = await f.take();
  assert.equal(check.body.action, "retrieve"); assert.equal(check.body.previewId, old.previewId);
  await f.reply(check, { status: "not-applied", preview: old, readOnly: true }); await checking;
  const dismissing = f.controller.request("dismiss"), dismiss = await f.take(); await f.reply(dismiss, { status: "dismissed" }); await dismissing;
  assert.equal(f.controller.selections()[0].targetBlockId, "second-subject");
  assert.equal(f.controller.selections()[0].edit.text, "  My unchanged proposal draft.\\n");
  assert.equal(f.controller.canPreview, false);
  f.controller.reopen(); f.controller.update("/suggested_blocks/0", "targetBlockId", "");
  assert.equal(f.controller.selections()[0].targetBlockId, undefined); assert.equal(f.controller.canPreview, true, "Create is a separate explicit user change");
});

test("typed existing-Output refusal retains exact pending identity and own draft instead of offering repeated stale preview", async () => {
  const f = paid.fixture(), preview = await paid.saved(f);
  const applying = f.controller.request("apply"), call = await f.take();
  await f.reply(call, { status: "not-applied", error: "output_requirement_endpoint_required", message: "PRIVATE_RAW_BACKEND_COPY" }, 409); await applying;
  assert.deepEqual(f.controller.handle, { previewId: preview.previewId, approvalHash: preview.approvalHash });
  assert.equal(f.controller.notice, "adaptive.changes.outputEditorRequired");
  assert.equal(f.controller.canApply, false); assert.equal(f.controller.canPreview, false); assert.equal(f.controller.canDismiss, true);
  assert.doesNotMatch(paid.render(f).markup, /PRIVATE_RAW_BACKEND_COPY/);
  f.controller.update("/suggested_blocks/0", "text", "My retained edit"); assert.equal(f.controller.canPreview, false);
  assert.equal(f.controller.selections()[0].edit.text, "My retained edit");
  await f.controller.request("preview"); await f.controller.request("apply"); assert.equal(f.calls.length, 2);
  const checking = f.controller.resume(), read = await f.take();
  assert.equal(read.body.action, "retrieve"); assert.equal(read.body.previewId, preview.previewId);
  await f.reply(read, { status: "not-applied", preview, readOnly: true }); await checking;
  assert.equal(f.controller.canPreview, false); assert.equal(f.controller.canApply, false);
});

for (const change of ["scope","withdrawal","new-presentation"]) test("late Output refusal after " + change + " cannot change a newer review", async () => {
  const f = paid.fixture(), old = await paid.saved(f), applying = f.controller.request("apply"), call = await f.take(), gate = paid.deferred();
  call.gate.resolve({ ok: false, status: 409, json: () => gate.promise }); await new Promise(setImmediate);
  if (change === "scope") f.state.scope = { ...f.state.scope, key: "authority-b", owner: "owner-b", documentId: "doc-b" };
  else if (change === "withdrawal") f.state.source = { ...f.state.source, withdrawalRevision: 1 };
  else { f.controller.suspend(); f.controller.close(); f.state.scope = { ...f.state.scope, key: "authority-b", owner: "owner-b", documentId: "doc-b" }; f.state.source = { ...f.state.source, executionId: "paid-b" }; f.controller.open("paid-b", ["/suggested_blocks/0"]); }
  f.controller.synchronize();
  const before = { notice: f.controller.notice, drafts: structuredClone(f.controller.drafts), handle: structuredClone(f.controller.handle), presentation: f.controller.presentationId, required: f.controller.outputEditorRequired };
  gate.resolve({ status: "not-applied", error: "output_requirement_endpoint_required", previewId: old.previewId }); await applying;
  assert.deepEqual({ notice: f.controller.notice, drafts: f.controller.drafts, handle: f.controller.handle, presentation: f.controller.presentationId, required: f.controller.outputEditorRequired }, before);
});

test("ordinary non-Output stale errors retain the existing explicit free preview path", async () => {
  const f = paid.fixture(); await paid.saved(f);
  const applying = f.controller.request("apply"), call = await f.take(); await f.reply(call, { status: "not-applied", error: "authoring_preview_stale" }, 409); await applying;
  assert.equal(f.controller.notice, "adaptive.changes.stale"); assert.equal(f.controller.outputEditorRequired, false); assert.equal(f.controller.canPreview, true);
  assert.deepEqual(f.controller.targets("/suggested_blocks/0").map(block => block.id), ["first-subject","second-subject"]);
});

test("typed refusal without a positive not-applied status preserves uncertainty and never permits retry or dismissal", async () => {
  const f = paid.fixture(), preview = await paid.saved(f);
  const applying = f.controller.request("apply"), call = await f.take();
  await f.reply(call, { error: "output_requirement_endpoint_required", blockId: "second-subject" }, 409); await applying;
  assert.equal(f.controller.uncertain, true); assert.equal(f.controller.notice, "adaptive.changes.checkRequired");
  assert.equal(f.controller.canApply, false); assert.equal(f.controller.canPreview, false); assert.equal(f.controller.canDismiss, false);
  assert.deepEqual(f.controller.handle, { previewId: preview.previewId, approvalHash: preview.approvalHash });
  await f.controller.request("preview"); await f.controller.request("apply"); await f.controller.request("dismiss"); assert.equal(f.calls.length, 2);
});

for (const locale of ["en","fr","ar","ja"]) test(locale + " actual adaptive renderer retains the Output identity and localized dedicated-editor guidance", () => {
  const f = outputFixture();
  f.controller.open("paid-original", ["/suggested_blocks/0"]);
  f.controller.update("/suggested_blocks/0", "targetBlockId", "second-subject");
  const markup = paid.render(f, locale).markup;
  assert.match(markup, /<option value=second-subject disabled \.selected=true>/u);
  for (const id of ["adaptive.changes.outputEditorRequired","adaptive.changes.outputTarget"]) {
    assert.ok(ADAPTIVE_PROPOSAL_MESSAGES[locale][id]); assert.ok(markup.includes(ADAPTIVE_PROPOSAL_MESSAGES[locale][id]), id);
  }
  assert.equal(f.controller.selections()[0].targetBlockId, "second-subject");
  assert.equal(f.controller.canPreview, false); assert.equal(f.calls.length, 0);
});

/** Real Output commands and the actual analytics route share one in-memory database. */
async function analyticsOutputFixture(t) {
  const f = await owned.planFixture();
  const target = f.plan.plan.targets.find(item => item.selected && item.aspect_ratio.width === item.aspect_ratio.height);
  const uploaded = await f.upload(png({ width: 20, height: 20 }));
  const bound = await f.command({ action: "bind", planRevisionId: f.plan.revisionId, targetId: target.id, assetId: uploaded.command.assetId });
  const accepted = await f.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  await f.command({ action: "export", planRevisionId: f.plan.revisionId, allowPartial: true });
  f.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(owned.owner);
  const statement = Object.getPrototypeOf(f.env.DB.prepare("SELECT 1")), execute = statement.execute;
  const compiled = new Set(), failures = [], queries = [];
  statement.execute = function(kind) {
    queries.push({ sql: this.sql, bindings: this.bindings });
    try {
      assert.ok(this.bindings.length <= 100);
      assert.ok(Buffer.byteLength(this.sql) < 100_000);
      const result = compileSqliteExpressionDepth(f.sqlite, this.sql, { limit: 100, bindings: this.bindings });
      assert.equal(result.limit, 100); assert.ok(result.ok, result.error);
      compiled.add(this.sql);
    } catch (error) { failures.push(String(error)); throw error; }
    return execute.call(this, kind);
  };
  t.after(() => { statement.execute = execute; f.sqlite.close(); assert.deepEqual(failures, []); assert.ok(compiled.size > 0); });
  const pending = [], context = { waitUntil(promise) { pending.push(promise); } };
  const request = async (DB = f.env.DB) => {
    const response = await handleAnalytics(new Request("http://localhost/api/analytics?days=all"), { ...f.env, DB }, context);
    assert.equal(response.status, 200, await response.clone().text());
    const report = (await response.json()).report;
    await Promise.all(pending.splice(0));
    return { response, report };
  };
  const cold = () => ({ prepare: sql => f.env.DB.prepare(sql), batch: statements => f.env.DB.batch(statements) });
  const checkpoint = () => {
    const saved = f.sqlite.prepare("SELECT content_id,content FROM external_content WHERE content_id LIKE 'analytics-source:v1:%'").get();
    const value = JSON.parse(saved.content);
    return { ...saved, value, rows: JSON.parse(gunzipSync(Buffer.from(value.payload, "base64")).toString("utf8")) };
  };
  const saveCheckpoint = (saved, value, rows = saved.rows) => f.sqlite.prepare("UPDATE external_content SET content=? WHERE content_id=?")
    .run(JSON.stringify({ ...value, payload: gzipSync(Buffer.from(JSON.stringify(rows))).toString("base64") }), saved.content_id);
  return { ...f, target, accepted, request, cold, checkpoint, saveCheckpoint, queries };
}

test("actual analytics miss, delta and durable hits preserve Output receipt identity without private client text", async t => {
  const f = await analyticsOutputFixture(t);
  const unsafe = [
    makeEvent("creative:" + owned.owner, 0, "user:" + owned.owner, "PRIVATE_CLIENT_PROSE: a human paragraph", "PRIVATE_CORRELATION_PROSE: more human text", "CanvasInteractionRecorded", { project_id: owned.project, document_id: owned.doc, interaction_id: "overview", text: "PRIVATE_PAYLOAD_PROSE" }),
    makeEvent("creative:" + owned.owner, 0, "user:" + owned.owner, "server:output-requirements", "PRIVATE_UNSUPPORTED_CORRELATION", "DocumentArtifactViewed", { project_id: owned.project, document_id: owned.doc, artifact_id: "visible-fixture-artifact", text: "PRIVATE_UNSUPPORTED_CONTENT" }),
    makeEvent("creative:" + owned.owner, 0, "user:" + owned.owner, "browser:untrusted", "PRIVATE_FORGED_OUTPUT_COMMAND", "OutputTargetAccepted", { project_id: owned.project, document_id: owned.doc, actor_user_id: owned.owner, ...outputKindFields.OutputTargetAccepted, review_note: "PRIVATE_REVIEW_PROSE" }),
  ];
  await appendEvents(f.env, unsafe);
  const first = await f.request();
  assert.equal(first.response.headers.get("x-forma-analytics-cache"), "miss");
  assert.equal(first.report.outcomes.outputHistory.planConfirmationReceiptCount, 1);
  assert.equal(first.report.outcomes.outputHistory.targetAcceptanceReceiptCount, 1);
  assert.equal(first.report.outcomes.outputHistory.deliveryPreparationReceiptCount, 1);
  assert.equal(first.report.outcomes.outputHistory.unclassifiedReceiptCount, 1);
  currentUnknown(first.report.outcomes.outputHistory);
  const saved = f.checkpoint();
  assert.equal(saved.value.schema, 2); assert.equal(saved.value.outcomeBindings, 2);
  assert.ok(saved.rows.every(row => row.length === 9));
  const safeKinds = new Set(Object.keys(outputKindFields));
  for (const row of saved.rows) {
    if (!safeKinds.has(row[5]) || row[0] === unsafe[2].eventId) assert.deepEqual(row.slice(7), ["", ""]);
    else {
      assert.equal(row[7], "server:output-requirements"); assert.match(row[8], /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u);
      assert.equal(row[6].actor_user_id, owned.owner);
    }
  }
  assert.doesNotMatch(JSON.stringify(saved.rows), /PRIVATE_(?:CLIENT|CORRELATION|PAYLOAD|UNSUPPORTED|FORGED|REVIEW)/u);
  assert.doesNotMatch(JSON.stringify(first.report), /PRIVATE_(?:CLIENT|CORRELATION|PAYLOAD|UNSUPPORTED|FORGED|REVIEW)/u);
  const confirmed = await f.command({ action: "confirm" });
  await f.command({ action: "bind", planRevisionId: confirmed.command.planRevisionId, targetId: f.target.id, acceptanceId: f.accepted.command.acceptanceId });
  const delta = await f.request();
  assert.equal(delta.response.headers.get("x-forma-analytics-cache"), "delta");
  assert.ok(Number(delta.response.headers.get("x-forma-analytics-source-rows")) > 0);
  assert.equal(delta.report.outcomes.outputHistory.planConfirmationReceiptCount, 2);
  assert.equal(delta.report.outcomes.outputHistory.targetAcceptanceReceiptCount, 1);
  assert.equal(delta.report.outcomes.outputHistory.reusedAcceptanceSelectionReceiptCount, 1);
  assert.equal(delta.report.outcomes.outputHistory.deliveryPreparationReceiptCount, 1);
  const durable = await f.request(f.cold());
  assert.equal(durable.response.headers.get("x-forma-analytics-cache"), "durable");
  assert.deepEqual(durable.report.outcomes.outputHistory, delta.report.outcomes.outputHistory);
  assert.equal(durable.report.outcomes.approvals.receiptCount, 0);
  assert.equal(durable.report.outcomes.exports.artifactReceiptCount, 0);
  currentUnknown(durable.report.outcomes.outputHistory);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n, 0);
  const reads = f.queries.filter(call => /SELECT.*client_id c,correlation_id r/isu.test(call.sql));
  assert.ok(reads.some(call => /rowid>\?/u.test(call.sql))); assert.ok(reads.some(call => /snapshot\(head\)/u.test(call.sql)));
  for (const locale of ["en","fr","ar","ja"]) {
    const view = historyHost.fixture(locale);
    // A real routed result is rendered by the same actual host. The fixture
    // session owns this report, rather than substituting a pure-model report.
    view.session.set({ ...view.session.get(), user: { ...view.session.get().user, userId: owned.owner } });
    await view.load(durable.report);
    assert.ok(view.analytics.render().includes(FORMA_OUTCOME_MESSAGES[locale]["outcome.outputHistory"]));
  }
});

for (const invalid of ["old-seven-column", "wrong-row-width", "foreign-owner", "old-epoch"]) {
  test("actual analytics safely rebuilds " + invalid + " durable cache instead of treating missing Output evidence as zero", async t => {
    const f = await analyticsOutputFixture(t);
    const first = await f.request(), saved = f.checkpoint(), value = structuredClone(saved.value);
    let rows = saved.rows;
    if (invalid === "old-seven-column") { value.outcomeBindings = 1; rows = rows.map(row => row.slice(0, 7)); }
    if (invalid === "wrong-row-width") rows = rows.map(row => row.slice(0, 7));
    if (invalid === "foreign-owner") value.owner = "not-the-current-actor";
    if (invalid === "old-epoch") value.epoch = "obsolete-authority-epoch";
    f.saveCheckpoint(saved, value, rows);
    const restored = await f.request(f.cold());
    assert.equal(restored.response.headers.get("x-forma-analytics-cache"), "miss");
    assert.deepEqual(restored.report.outcomes.outputHistory, first.report.outcomes.outputHistory);
    assert.equal(restored.report.outcomes.outputHistory.targetAcceptanceReceiptCount, 1);
    assert.equal(restored.report.outcomes.outputHistory.deliveryPreparationReceiptCount, 1);
    const rebuilt = f.checkpoint();
    assert.equal(rebuilt.value.outcomeBindings, 2); assert.equal(rebuilt.value.owner, owned.owner);
    assert.ok(rebuilt.rows.every(row => row.length === 9)); currentUnknown(restored.report.outcomes.outputHistory);
    assert.equal(providerCalls, 0);
  });
}

test("a certified Output refusal stays bound to its exact target when another selected suggestion changes", async () => {
  const f = paid.fixture(), originals = structuredClone(f.state.source.structure);
  originals.suggested_blocks = [originals.suggested_blocks[0], { ...originals.suggested_blocks[0], label: "Second owned decision" }];
  f.state.source.structure = originals;
  f.controller.open("paid-original", ["/suggested_blocks/0","/suggested_blocks/1"]);
  f.controller.update("/suggested_blocks/0", "targetBlockId", "second-subject");
  f.controller.update("/suggested_blocks/1", "targetBlockId", "first-subject");
  f.controller.update("/suggested_blocks/0", "text", "My exact retained edit.");
  const previewing = f.controller.request("preview"), call = await f.take();
  await f.reply(call, { status: "not-applied", error: "output_requirement_endpoint_required", blockId: "second-subject" }, 409); await previewing;
  assert.equal(f.controller.outputTargetId("/suggested_blocks/0"), "second-subject");
  assert.equal(f.controller.outputTargetId("/suggested_blocks/1"), null);
  f.controller.update("/suggested_blocks/1", "targetBlockId", "");
  assert.equal(f.controller.canPreview, false); assert.equal(f.controller.outputEditorRequired, true);
  assert.equal(f.controller.selections()[0].targetBlockId, "second-subject");
  assert.equal(f.controller.selections()[0].edit.text, "My exact retained edit.");
  const scope = structuredClone(f.state.scope);
  f.state.scope = { ...scope, key: "other-key", owner: "other-owner", documentId: "other-document" };
  f.controller.open("paid-original", ["/suggested_blocks/0"]);
  f.state.scope = scope; f.controller.open("paid-original", ["/suggested_blocks/0","/suggested_blocks/1"]);
  assert.equal(f.controller.outputTargetId("/suggested_blocks/0"), "second-subject");
  assert.equal(f.controller.canPreview, false);
  f.controller.update("/suggested_blocks/0", "targetBlockId", "");
  assert.equal(f.controller.canPreview, true, "only an explicit change of the refused target can request a new preview");
});

test("a foreign refusal block ID is never rendered or used as a navigation target", async () => {
  const f = paid.fixture();
  f.controller.open("paid-original", ["/suggested_blocks/0"]);
  f.controller.update("/suggested_blocks/0", "targetBlockId", "second-subject");
  const previewing = f.controller.request("preview"), call = await f.take();
  await f.reply(call, { status: "not-applied", error: "output_requirement_endpoint_required", blockId: "foreign-private-block" }, 409); await previewing;
  let opened = 0;
  f.controller.ports.openOutputRequirement = async () => { opened++; return true; };
  assert.equal(f.controller.outputTargetId("/suggested_blocks/0"), null);
  assert.equal(f.controller.canOpenOutputTarget("/suggested_blocks/0"), false);
  assert.equal(f.controller.outputEditorRequired, true); assert.equal(f.controller.canPreview, false);
  assert.doesNotMatch(paid.render(f).markup, /foreign-private-block/u);
  assert.equal(await f.controller.openOutputTarget("/suggested_blocks/0", () => f.controller.close()), false);
  assert.equal(opened, 0); assert.equal(f.controller.selections()[0].targetBlockId, "second-subject");
});

test("an explicit navigation-only port closes only its own quiescent review and retains the exact human draft", async () => {
  const f = outputFixture();
  f.controller.open("paid-original", ["/suggested_blocks/0"]);
  f.controller.update("/suggested_blocks/0", "targetBlockId", "second-subject");
  f.controller.update("/suggested_blocks/0", "text", "My retained Output wording.");
  const before = structuredClone(f.controller.selections()); let opened = 0, closed = 0;
  assert.equal(f.controller.canOpenOutputTarget("/suggested_blocks/0"), false, "unavailable port does not invent navigation");
  f.controller.ports.openOutputRequirement = async (blockId, ownership) => {
    opened++; assert.equal(blockId, "second-subject"); assert.equal(ownership.current(), true); assert.equal(ownership.retained(), false);
    assert.equal(ownership.close(), true); assert.equal(ownership.current(), false); assert.equal(ownership.retained(), true);
    return true;
  };
  assert.equal(f.controller.canOpenOutputTarget("/suggested_blocks/0"), true);
  assert.equal(await f.controller.openOutputTarget("/suggested_blocks/0", () => { closed++; f.controller.close(); }), true);
  assert.equal(opened, 1); assert.equal(closed, 1); assert.equal(f.controller.visible, false);
  assert.deepEqual(f.controller.selections(), before); assert.equal(f.controller.busy, false); assert.equal(f.calls.length, 0);
  f.controller.reopen(); assert.deepEqual(f.controller.selections(), before); assert.equal(f.controller.canPreview, false);
});

for (const blocked of ["busy","uncertain"]) test(blocked + " owned proposal work cannot be closed or replaced by an Output handoff", async () => {
  const f = outputFixture();
  f.controller.open("paid-original", ["/suggested_blocks/0"]); f.controller.update("/suggested_blocks/0", "targetBlockId", "second-subject");
  f.controller[blocked] = true; let opened = 0, closed = 0;
  f.controller.ports.openOutputRequirement = async () => { opened++; return true; };
  assert.equal(f.controller.canOpenOutputTarget("/suggested_blocks/0"), false);
  assert.equal(await f.controller.openOutputTarget("/suggested_blocks/0", () => { closed++; f.controller.close(); }), false);
  assert.equal(opened, 0); assert.equal(closed, 0); assert.equal(f.controller.visible, true);
  assert.equal(f.controller[blocked], true); assert.equal(f.controller.selections()[0].targetBlockId, "second-subject");
});

for (const change of ["authorization","withdrawal","new-presentation","route-close"]) test("Output opening cannot close a newer review after " + change, async () => {
  const f = outputFixture();
  f.controller.open("paid-original", ["/suggested_blocks/0"]); f.controller.update("/suggested_blocks/0", "targetBlockId", "second-subject");
  const gate = paid.deferred(); let captured, closed = 0;
  f.controller.ports.openOutputRequirement = async (_blockId, ownership) => { captured = ownership; await gate.promise; return ownership.close(); };
  const opening = f.controller.openOutputTarget("/suggested_blocks/0", () => { closed++; f.controller.close(); });
  assert.equal(captured.current(), true);
  if (change === "authorization") { f.state.scope = { ...f.state.scope, key: "new-authority" }; f.controller.synchronize(); }
  if (change === "withdrawal") { f.state.source = { ...f.state.source, withdrawalRevision: 1 }; f.controller.synchronize(); }
  if (change === "new-presentation") { f.controller.suspend(); f.controller.reopen(); }
  if (change === "route-close") f.controller.suspend();
  const after = { visible: f.controller.visible, presentation: f.controller.presentationId, handle: structuredClone(f.controller.handle), drafts: structuredClone(f.controller.drafts) };
  gate.resolve(); assert.equal(await opening, false); assert.equal(closed, 0);
  assert.deepEqual({ visible: f.controller.visible, presentation: f.controller.presentationId, handle: f.controller.handle, drafts: f.controller.drafts }, after);
  assert.equal(f.calls.length, 0);
});

async function actualOutputOpeningFixture(t, locale = "en") {
  const retainedOriginalRequests = new WeakMap();
  const f = await createOutputReachabilityPage(t, { locale, retainedOriginalRequests }), h = f.storeHost;
  const native=installOutputNavigationFocusNative(t,f,fullPageNativePorts);
  const snapshot = f.outputSnapshot(), documentId = snapshot.documentId, blockId = snapshot.requirements[0].blockId;
  const structure = structuredClone(paid.structure);
  structure.suggested_blocks[0] = { ...structure.suggested_blocks[0], type: "output", subtype: "Custom deliverables", label: "Retained Output proposal", instruction: "Retained original instruction." };
  // The Output domain/native fixture remains synthetic. Its retained planning
  // source, however, is produced and read by the complete existing Worker.
  // One deterministic responder creates the seed; this is not live provider evidence.
  const state = await routed.fixture({ provider: true }), calls = [];
  const actor = f.store.session.get().user, headers = { "oai-authenticated-user-id": actor.userId, "oai-authenticated-user-email": actor.email };
  const stream = "creative:" + actor.userId, request = (url, init = {}) => {
    const merged = new Headers(headers); new Headers(init.headers).forEach((value, key) => merged.set(key, value));
    return state.request(url, { ...init, headers: merged });
  };
  let depth, paidBefore, ledgersBefore, eventsBefore;
  t.after(async () => {
    try {
      await state.drainBackground();
      if (paidBefore) {
        routed.phase8AssertNoPayment(state, paidBefore);
        assert.deepEqual(routed.main170Phase8Ledgers(state), ledgersBefore, "original reads and Output navigation create no new financial or Output records");
        assert.deepEqual(state.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all(), eventsBefore, "post-seed navigation writes no Worker events");
      }
      depth?.assertVerified();
    } finally { depth?.restore(); state.sqlite.close(); }
  });
  // Register and consent this exact synthetic actor through the real session
  // endpoint, then seed the existing fixture events using the unchanged helper.
  const consent = await request("/api/session", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "accept_terms", ownershipConfirmed: true, providerProcessingConfirmed: true }) });
  assert.equal(consent.status, 200); assert.equal((await consent.json()).user.userId, actor.userId);
  routed.appendFixtureEvents(state.sqlite, stream, f.store.events.get().map(event => [event.type, event.payload]));
  const planning = { projectId: snapshot.projectId, documentId, canvasId: null, sourceSurface: "adaptive", projectScope: false,
    prompt: "Retained original instruction.", locale };
  const deniedFetch = globalThis.fetch; let quote;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
      const payload = JSON.parse(init.body); calls.push(payload);
      return routed.adaptiveFixtureResponse(payload, { outputText: JSON.stringify(structure) });
    };
    quote = await routed.quoteAdaptiveConsent(state, planning, headers);
    const accepted = await routed.executeAdaptiveConsent(state, quote, planning, headers);
    assert.equal(accepted.status, 202); await state.drainBackground(); assert.equal(calls.length, 1);
  } finally { globalThis.fetch = deniedFetch; }
  Object.assign(state, { paidQuote: quote, calls, owner: actor.userId, stream, headers });
  depth = routed.enforceD1ExpressionDepth(state);
  const sessionResponse = await request("/api/session"), eventsResponse = await request("/api/events?after=0&limit=2000&content=1");
  assert.equal(sessionResponse.status, 200); assert.equal(eventsResponse.status, 200);
  const session = await sessionResponse.json(), originalEvents = await eventsResponse.json();
  assert.equal(session.user.userId, actor.userId); assert.equal(session.policy.accepted, true);
  assert.ok(originalEvents.events.length > 0); assert.ok(Number.isSafeInteger(originalEvents.head));
  // INITIAL hydration only, exactly as the permanent native recovery fixture.
  // Never copy a quote or private cache proof into the Store.
  f.store.events.set(originalEvents.events); f.store.content.set(originalEvents.content ?? {});
  f.store.head.set(originalEvents.head); f.store.session.set(session);
  paidBefore = routed.phase8PaidEvidence(state); ledgersBefore = routed.main170Phase8Ledgers(state);
  eventsBefore = state.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();
  const priorTransport = h.transport, originalReads = []; let job, originalReadStarted = false;
  h.transport = async row => {
    if (row.url === "/api/document-jobs/adaptive") {
      assert.equal(originalReadStarted, false, "only one exact setup original read is permitted");
      originalReadStarted = true;
      assert.equal(row.init.method, "POST");
      assert.deepEqual(row.body, { projectId: snapshot.projectId, documentId, canvasId: null, sourceSurface: job.sourceSurface,
        projectScope: job.planningProjectScope, locale: job.planningLocale, requestKey: job.requestKey, prompt: "", action: "resume", executionId: job.jobId });
      const response = await request(row.url, row.init);
      originalReads.push({ request: row, status: response.status, body: await response.clone().json() });
      return response;
    }
    if (row.url.startsWith("/api/document-jobs") && !row.url.includes("presentation-candidates")
      || /^\/api\/(?:session|events)(?:[?]|$)/u.test(row.url)) {
      assert.equal(row.init.method ?? "GET", "GET", "all subsequent original-source transport is read-only");
      return request(row.url, row.init);
    }
    return row.url === "/api/workspaces/reviews" ? Response.json({ tasks: [] })
      : priorTransport ? priorTransport(row) : h.worker.request(row.url, row.init);
  };
  const previousHistory = globalThis.history, historyWrites = [];
  globalThis.history = { pushState(_state,_unused,url) { historyWrites.push(url); const next = new URL(url, "http://localhost"); Object.assign(h.location, { pathname: next.pathname, search: next.search, hash: next.hash }); },
    replaceState(_state,_unused,url) { this.pushState(_state,_unused,url); } };
  t.after(() => { globalThis.history = previousHistory;
    assert.deepEqual(h.requests.filter(row => (row.init.method ?? "GET") !== "GET" && !f.isReadOnlyResume(row)), [], "handoff performs no canonical mutation, command, generation, purchase or refund; existing exact resume is a free read"); });
  await f.store.syncDocumentJobs(); await f.settle();
  job = f.store.documentJobs.get().find(value => value.jobId === quote.executionId);
  assert.ok(job); assert.equal(job.status, "completed"); assert.equal(Object.hasOwn(job.result ?? {}, "quote"), false);
  assert.equal(f.store.adaptiveProposalSource(documentId, null, job.jobId)?.readable ?? false, false, "generic job metadata cannot certify a private original");
  // The same public certification sequence as the passing permanent native fixture.
  assert.equal(await f.store.reviewPlanningJob(job.jobId), true, "read the real retained original, not a new execution");
  f.store.closePlanningConsent();
  await f.store.loadDocumentJobDetail(job.jobId); await f.settle();
  const source = f.store.adaptiveProposalSource(documentId, null, job.jobId); assert.equal(source?.readable, true, "the actual Store admits the exact retained job source");
  assert.deepEqual(source.structure, structure, "the unchanged original proposal input survived actual Worker validation");
  assert.equal(originalReads.length, 1);
  const originalRead = originalReads[0];
  assert.equal(originalRead.status, 200); assert.equal(originalRead.body.quote.status, "completed");
  assert.equal(originalRead.body.quote.executionId, job.jobId); assert.equal(originalRead.body.quote.bindingHash, source.bindingHash);
  // Test bookkeeping only: an exact request object/input is exempted only AFTER
  // the original Store validator admitted the real response. Clones, changed
  // inputs, other actions and every subsequent Output command remain forbidden.
  retainedOriginalRequests.set(originalRead.request, Object.freeze({ init: originalRead.request.init, body: originalRead.request.init.body }));
  assert.equal(f.isReadOnlyResume(originalRead.request), true);
  assert.equal(f.isReadOnlyResume({ ...originalRead.request }), false, "a cloned original read never inherits setup evidence");
  assert.equal(f.isReadOnlyResume({ ...originalRead.request, init: { ...originalRead.request.init } }), false);
  const { createAdaptiveProposalReview: create } = await fullPageNativePorts.loadActual("src/components/adaptive-proposal-review.ts");
  assert.equal(typeof create, "function", "reuse the complete actual module with the full-page browser ports");
  const controller = create(f.store, () => ({ documentId, canvasId: null }), () => {}, () => "Review retained proposal changes");
  controller.open(job.jobId, ["/suggested_blocks/0"]);
  controller.update("/suggested_blocks/0", "targetBlockId", blockId);
  controller.update("/suggested_blocks/0", "text", "  My exact human-edited Output draft.\n");
  assert.equal(controller.outputTargetId("/suggested_blocks/0"), blockId); assert.equal(controller.canOpenOutputTarget("/suggested_blocks/0"), true);
  const close = () => controller.close();
  return Object.assign(f,{ h, native, documentId, blockId, job, controller, close, historyWrites, initialOutputRequests: f.outputRequests.length });
}
async function finishOpening(f, promise) {
  let finished = false; promise.finally(() => { finished = true; });
  for (let index = 0; index < 16 && !finished; index++) { await f.settle(); await new Promise(setImmediate); }
  assert.equal(finished, true, "bounded browser frame port completes without a timer or automatic retry");
  return promise;
}
for (const locale of ["en","fr","ar","ja"]) test("actual rendered Output opening "+locale+" reuses the Store and exact existing native card without opening an editor", async t => {
  const f = await actualOutputOpeningFixture(t, locale), before = structuredClone(f.controller.selections()), events = JSON.stringify(f.store.events.get());
  const rendered = paid.render({ controller: f.controller }, locale), open = rendered.buttons.find(button => button.label === ADAPTIVE_PROPOSAL_MESSAGES[locale]["adaptive.changes.openOutput"]);
  assert.ok(open && !open.disabled); const trace = f.trace.length;
  assert.equal(await finishOpening(f, open.click()), true);
  assert.equal(documentContextBlockFromRoute(f.store.route.get()), f.blockId);
  assert.ok(f.trace.slice(trace).includes("focus:output-card-host"), "existing public requirement focus port, not a fabricated editor event");
  assert.equal(f.controller.visible, false); assert.deepEqual(f.controller.selections(), before);
  assert.equal(JSON.stringify(f.store.events.get()), events);
  assert.ok(!f.tree().nodes.some(node => String(node.attributes.class ?? "").includes("output-requirement-form")));
  assert.deepEqual(f.outputRequests.slice(f.initialOutputRequests).filter(row => row.path.startsWith("/api/output-requirements") && row.method !== "GET"), [], "opening never starts an Output command");
});

for (const reason of ["foreign-block","foreign-document","canvas-only","removed","read-denied"]) test("actual Output opening rejects " + reason + " identity without rehoming or changing the owned draft", async t => {
  const f = await actualOutputOpeningFixture(t), beforeEvents = JSON.stringify(f.store.events.get()); let target = f.blockId;
  if (reason === "foreign-block") target = "not-a-current-block";
  if (reason === "foreign-document") target = f.store.projection.get().libraryBlocks.find(block => block.type === "output" && block.documentId !== f.documentId).id;
  if (reason === "canvas-only") {
    target = "canvas-only-output";
    f.appendEvent("BlockCreated", { block_id: target, document_id: undefined, canvas_id: "only-this-board", scope: "canvas", type: "output", handle: "output/canvas-only", properties: { text: "Canvas draft, never a Document requirement", subtype: "Custom deliverables", authority: "authored" } });
    assert.equal(f.store.projection.get().libraryBlocks.find(block => block.id === target).documentId, "");
  }
  if (reason === "removed") f.appendEvent("BlockRemoved", { block_id: target });
  f.controller.update("/suggested_blocks/0", "targetBlockId", target);
  const before = structuredClone(f.controller.selections()), route = f.store.route.get(), trace = f.trace.length, events = JSON.stringify(f.store.events.get());
  if (reason === "read-denied") f.store.session.set({ ...f.store.session.get(), capabilities: [], permissionEpoch: "read-withdrawn" });
  assert.equal(await finishOpening(f, f.controller.openOutputTarget("/suggested_blocks/0", f.close)), false);
  assert.equal(f.store.route.get(), route); assert.deepEqual(f.historyWrites, []);
  assert.equal(JSON.stringify(f.store.events.get()), events);
  assert.equal(f.controller.selections()[0].targetBlockId, target);
  assert.equal(f.controller.selections()[0].edit.text, before[0].edit.text);
  assert.deepEqual(f.trace.slice(trace).filter(value => value.startsWith("focus:output-")), []);
  if (reason !== "read-denied") { assert.equal(f.controller.visible, true); assert.equal(f.controller.notice, "adaptive.changes.outputEditorRequired"); }
  if (reason === "foreign-block" || reason === "foreign-document") assert.equal(events, beforeEvents);
});

for (const change of ["route","authorization","source","new-presentation","new-focus","pointer","keyboard","unavailable-read"]) {
  test("actual Output opening yields to " + change + " while the original free read is pending", async t => {
    const f = await actualOutputOpeningFixture(t), snapshot = structuredClone(f.outputSnapshot()), gate = paid.deferred(), entered = paid.deferred();
    const route = f.store.route.get(), original = structuredClone(f.controller.selections()), pointer = f.listeners.get("pointerdown")?.length ?? 0, keyboard = f.listeners.get("keydown")?.length ?? 0;
    f.h.intercept = async request => {
      if (!request.url.startsWith("/api/output-requirements")) return;
      entered.resolve(); await gate.promise;
      return change === "unavailable-read" ? Response.json({ error: "PRIVATE_RAW_READ_ERROR" }, { status: 503 }) : Response.json(snapshot);
    };
    f.store.outputRequirements.clear();
    const pending = f.controller.openOutputTarget("/suggested_blocks/0", f.close); await entered.promise;
    assert.equal(f.controller.visible, true, "read approval is not navigation");
    if (change === "route") f.store.route.set(route + "?context=newer-context");
    if (change === "authorization") f.store.session.set({ ...f.store.session.get(), permissionEpoch: "newer-authority" });
    if (change === "source") f.appendEvent("BlockPropertyEdited", { block_id: f.blockId, property_path: "text", new_value: "Newer current Output instructions" });
    if (change === "new-presentation") { f.controller.suspend(); f.controller.reopen(); }
    if (change === "new-focus") f.native.focus(f.tree().visible("select").find(node=>node.owner.tag==="forma-ui-language-picker")?.port);
    if (change === "pointer") {
      const handlers = (f.listeners.get("pointerdown") ?? []).slice(pointer); assert.equal(handlers.length, 1); f.native.emit("pointerdown");
    }
    if (change === "keyboard") {
      const handlers = (f.listeners.get("keydown") ?? []).slice(keyboard); assert.equal(handlers.length, 1); f.native.emit("keydown");
    }
    const currentRoute = f.store.route.get(), trace = f.trace.length; gate.resolve();
    assert.equal(await finishOpening(f, pending), false);
    assert.equal(f.store.route.get(), currentRoute); assert.deepEqual(f.historyWrites, []);
    assert.deepEqual(f.controller.selections(), original);
    assert.deepEqual(f.trace.slice(trace).filter(value => value.startsWith("focus:output-")), []);
    assert.doesNotMatch(paid.render({ controller: f.controller }).markup, /PRIVATE_RAW_READ_ERROR/u);
    assert.equal((f.listeners.get("pointerdown") ?? []).length, pointer); assert.equal((f.listeners.get("keydown") ?? []).length, keyboard);
  });
}

for (const change of ["new-modal","new-focus","source","authorization","new-review"]) test("actual Output opening yields to " + change + " after closing only its own review", async t => {
  const f = await actualOutputOpeningFixture(t), target = f.outputControllers().find(controller => controller.blockId === f.blockId);
  assert.ok(target);
  const gate = paid.deferred(), tick = f.tick; let waiting = false;
  f.tick = async owner => { if (owner === target && !waiting) { waiting = true; await gate.promise; } return tick(owner); };
  const original = structuredClone(f.controller.selections()), pending = f.controller.openOutputTarget("/suggested_blocks/0", f.close);
  for (let index = 0; index < 16 && !waiting; index++) { await f.settle(); await new Promise(setImmediate); }
  assert.equal(waiting, true); assert.equal(f.controller.visible, false);
  if (change === "new-modal") {
    const workspace = f.components().find(component => component.tag === "forma-workspace"); workspace.openContextComposer(); await f.settle();
    assert.ok(fullPageNativePorts.documentPort.querySelector("dialog[open]"));
  }
  if (change === "new-focus") {
    const node = f.tree().visible("select").find(node => node.owner.tag==="forma-ui-language-picker");
    assert.ok(node); f.native.focus(node.port); assert.equal(fullPageNativePorts.documentPort.activeElement, node.port);
  }
  if (change === "source") { f.adapter.publishSourceRevision(f.documentId); await f.store.outputRequirements.ensure(f.documentId, { force: true }); }
  if (change === "authorization") f.store.session.set({ ...f.store.session.get(), permissionEpoch: "newer-output-authority" });
  if (change === "new-review") f.controller.reopen();
  const trace = f.trace.length, route = f.store.route.get(), visible = f.controller.visible, presentation = f.controller.presentationId;
  gate.resolve(); assert.equal(await finishOpening(f, pending), false);
  assert.equal(f.store.route.get(), route); assert.equal(f.controller.visible, visible); assert.equal(f.controller.presentationId, presentation);
  assert.deepEqual(f.controller.selections(), original); assert.deepEqual(f.trace.slice(trace).filter(value => value.startsWith("focus:output-")), []);
});

test("actual Output opening suppresses only its own delayed native opener restoration", async t => {
  const f = await actualOutputOpeningFixture(t), complete = paid.deferred(), focus = [], dialog = { close() { this.open = false; }, open: true };
  const host = { isConnected: true, ownerDocument: f.native.document, updateComplete: complete.promise, querySelector: selector => selector === ".adaptive-proposal-dialog" ? dialog : null };
  const opener = { isConnected: true, getAttribute: () => null, setAttribute() {}, removeAttribute() {}, focus() { focus.push("old-opener"); } };
  const { closeAdaptiveProposalDialog } = await fullPageNativePorts.loadActual("src/components/adaptive-proposal-dialog.ts");
  const pending = f.controller.openOutputTarget("/suggested_blocks/0", () => closeAdaptiveProposalDialog(host, f.controller, opener, () => null));
  assert.equal(await finishOpening(f, pending), true); assert.equal(dialog.open, false);
  complete.resolve(); await new Promise(setImmediate); assert.deepEqual(focus, []);
  const ordinary = paid.deferred(), normalHost = { ...host, updateComplete: ordinary.promise };
  f.controller.reopen(); assert.equal(f.controller.openingOutputRequirement, false);
  closeAdaptiveProposalDialog(normalHost, f.controller, opener, () => null);
  ordinary.resolve(); await new Promise(setImmediate); assert.deepEqual(focus, ["old-opener"], "ordinary close keeps existing native focus return");
});

test("actual Output opening fixture permits only the exact three-field current-scope read-only resume", async t => {
  const f = await actualOutputOpeningFixture(t);
  const scope = { projectId: "fixture-project", documentId: "fixture-document-a" };
  const body = { action: "resume", ...scope }, request = (value = body, url = "/api/workspace/quick-edit", method = "POST") => ({ url, init: { method, body: JSON.stringify(value) } });
  assert.equal(isOutputFixtureReadOnlyResume(request(), scope), true);
  assert.equal(f.isReadOnlyResume(request()), false, "a shape match is not a transport-certified read");
  const admitted = f.h.requests.find(row => f.isReadOnlyResume(row)); assert.ok(admitted);
  assert.equal(f.isReadOnlyResume({ ...admitted, init: { ...admitted.init } }), false);
  const originalBody = admitted.init.body;
  admitted.init.body = JSON.stringify({ ...JSON.parse(originalBody), extra: "not-a-read" });
  assert.equal(f.isReadOnlyResume(admitted), false);
  admitted.init.body = originalBody; assert.equal(f.isReadOnlyResume(admitted), true);
  for (const action of ["preview","apply","dismiss","retrieve","receipts"]) assert.equal(isOutputFixtureReadOnlyResume(request({ ...body, action }), scope), false);
  for (const changed of [{ ...body, extra: true }, { ...body, projectId: "foreign" }, { ...body, documentId: "other" }, { action: "resume", projectId: scope.projectId }, null, []]) assert.equal(isOutputFixtureReadOnlyResume(request(changed), scope), false);
  for (const url of ["/api/workspace/quick-edit/", "/api/workspace/quick-edit?after=1", "/api/workspace/quick-edit/anything"]) assert.equal(isOutputFixtureReadOnlyResume(request(body, url), scope), false);
  assert.equal(isOutputFixtureReadOnlyResume(request(body, "/api/workspace/quick-edit", "PUT"), scope), false);
  assert.equal(isOutputFixtureReadOnlyResume({ url: "/api/workspace/quick-edit", init: { method: "POST", body: "invalid-json" } }, scope), false);
});

for (const changed of ["new-review","authorization","changed-target"]) test("an old rendered Output opening button cannot act on " + changed, async () => {
  const f = outputFixture(); let opened = 0;
  f.controller.ports.openOutputRequirement = async () => { opened++; return true; };
  f.controller.open("paid-original", ["/suggested_blocks/0"]); f.controller.update("/suggested_blocks/0", "targetBlockId", "second-subject");
  const old = paid.render(f).buttons.find(button => button.label === ADAPTIVE_PROPOSAL_MESSAGES.en["adaptive.changes.openOutput"]);
  assert.ok(old);
  if (changed === "new-review") { f.controller.close(); f.controller.reopen(); }
  if (changed === "authorization") f.state.scope = { ...f.state.scope, key: "different-authority" };
  if (changed === "changed-target") f.controller.update("/suggested_blocks/0", "targetBlockId", "");
  const before = structuredClone(f.controller.selections()), presentation = f.controller.presentationId, visible = f.controller.visible;
  assert.equal(await old.click(), false); assert.equal(opened, 0);
  assert.deepEqual(f.controller.selections(), before); assert.equal(f.controller.presentationId, presentation); assert.equal(f.controller.visible, visible);
});



const {foldEvents}=await import("../src/model/events.ts");
for(const [mode,canvas] of [["personal",false],["personal",true],["shared",true]])test("actual routed normalized new Output is reviewable and exactly applied by the existing "+mode+" "+(canvas?"Canvas":"Document")+" controller",async()=>{
 const state=await routed.main170Phase8Fixture(mode,canvas);
 try{
  const paidBefore=routed.phase8PaidEvidence(state),ledgers=routed.main170Phase8Ledgers(state),f=paid.fixture({canvasId:state.scope.canvasId});
  const execution=state.sqlite.prepare("SELECT result_ref FROM consequential_executions WHERE execution_id=?").get(state.paidQuote.executionId);
  const original=JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(execution.result_ref).content).structure;
  assert.ok(Array.isArray(original.suggested_blocks),"only the actual retained original, not a reconstructed suggestion");
  f.state.scope={...f.state.scope,...state.scope,actorUserId:state.owner};
  f.state.source={...f.state.source,executionId:state.paidQuote.executionId,bindingHash:state.paidQuote.bindingHash,structure:original};
  f.state.projection=foldEvents(await readEvents(state.env,state.stream),Infinity,state.scope.documentId,state.scope.projectId);
  const calls=[];f.ports.request=body=>{calls.push(structuredClone(body));return routed.phase8Request(state,body);};
  f.ports.refresh=async()=>{f.state.projection=foldEvents(await readEvents(state.env,state.stream),Infinity,state.scope.documentId,state.scope.projectId);};
  const selection=routed.main170Phase8OutputSelection(state)[0];
  f.controller.open(state.paidQuote.executionId,[selection.proposalId],selection.placement);
  for(const field of ["type","subtype","label","text"])f.controller.update(selection.proposalId,field,selection.edit[field]);
  assert.deepEqual(f.controller.selections(),[selection]);assert.equal(f.controller.canPreview,true);
  await f.controller.request("preview");
  assert.equal(f.controller.phase,"review",f.controller.notice);
  assert.equal(f.controller.canApply,true);
  const preview=structuredClone(f.controller.preview),event=preview.events.find(item=>item.type==="BlockCreated");
  assert.ok(event.payload.properties.output_spec);assert.equal(event.payload.scope,canvas?"canvas":"document");
  assert.equal(event.payload.history_owner_id,mode==="personal"?undefined:state.owner);
  assert.deepEqual(f.controller.selections(),[selection]);
  assert.equal(f.controller.outputEditorRequired,false,"new Output stays a deliberate draft creation");
  await f.controller.request("apply");assert.equal(f.controller.phase,"applied",f.controller.notice);
  assert.deepEqual(calls.map(call=>call.action),["preview","apply"]);
  assert.deepEqual(f.controller.receipt.blockIds,[event.payload.block_id]);
  assert.equal(f.controller.receipt.canvasItemIds.length,canvas?1:0);
  const written=f.state.projection.libraryBlocks.find(block=>block.id===event.payload.block_id);
  assert.ok(written);assert.deepEqual(written.properties.output_spec,event.payload.properties.output_spec);
  assert.deepEqual(routed.main170Phase8Ledgers(state),ledgers);
  routed.phase8AssertNoPayment(state,paidBefore);
 }finally{await state.cleanup();}
});


for(const changed of ["withdrawal","binding"])test("a closed owned Output opening remains subordinate to explicit paid-original "+changed,async()=>{
 const f=outputFixture(),gate=paid.deferred();let ownership;
 f.controller.ports.openOutputRequirement=async(_blockId,owner)=>{ownership=owner;assert.equal(owner.close(),true);await gate.promise;return owner.retained();};
 f.controller.open("paid-original",["/suggested_blocks/0"]);f.controller.update("/suggested_blocks/0","targetBlockId","second-subject");
 f.controller.update("/suggested_blocks/0","text","My retained human edit.");
 const draft=structuredClone(f.controller.selections()),pending=f.controller.openOutputTarget("/suggested_blocks/0",()=>f.controller.close());
 assert.ok(ownership);assert.equal(ownership.retained(),true);
 if(changed==="withdrawal")f.state.source={...f.state.source,withdrawalRevision:f.state.source.withdrawalRevision+1};
 else f.state.source={...f.state.source,bindingHash:"e".repeat(64)};
 assert.equal(ownership.retained(),false);gate.resolve();assert.equal(await pending,false);
 assert.deepEqual(f.controller.selections(),draft);assert.equal(f.controller.visible,false);
});
