// Actual controller methods/templates with synthetic store, jobs, and domain fixture data.
// This is not browser, institutional authorization, licensing, or database-budget evidence.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOutputControllerFixture, FIXTURE_DOCUMENT_IDS } from "./output-controller-fixture-model.mjs";

const root = process.env.FORMA_OUTPUT_REGRESSION_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => import(pathToFileURL(resolve(root, path)).href);
const [harness, requirements, plan, inspection, readiness, runtime] = await Promise.all([
  source("tests/output-ui-source-harness.mjs"), source("src/model/output-requirements.ts"), source("src/model/output-plan.ts"),
  source("src/model/output-asset-inspection.ts"), source("src/components/output-source-readiness.ts"),
  source("src/components/design-system/locales/output-delivery-runtime-messages.ts"),
]);
const { binding, controllerFixture, eventHandlers, loadController, region, templates } = harness;
const translated = (template, key) => template.values.some((value) => typeof value === "string" && value.includes(`output.delivery.${key}`));
const text = (value) => templates(value).flatMap((entry) => entry.values.filter((part) => typeof part === "string")).join("\n");
const hasRegion = (value, marker) => templates(value).some((entry) => entry.strings.some((part) => part.includes(marker)));

async function renderScenario(scenario, change = () => {}) {
  const adapter = await createOutputControllerFixture({ domain: { ...requirements, ...plan, ...inspection } });
  const snapshot = adapter.seed(FIXTURE_DOCUMENT_IDS[0], scenario); change(snapshot);
  const fixture = await controllerFixture(); fixture.snapshots.set(snapshot.documentId, snapshot);
  fixture.store.documentJobs = { get: () => adapter.jobs(snapshot.documentId) };
  fixture.store.projection = { get: () => ({ projectId: snapshot.projectId, libraryBlocks: adapter.sourceBlocks(snapshot.documentId) }) };
  class Base {
    constructor() { this.store = fixture.store; this.isConnected = true; this.updateComplete = Promise.resolve(); this.i18n = fixture.controller.i18n; }
    requestUpdate() {}
    querySelector() { return null; }
    connectedCallback() {}
    disconnectedCallback() {}
  }
  const Controller = await loadController(Base, { compileOutputPlan: plan.compileOutputPlan });
  const controller = new Controller(); controller.documentId = snapshot.documentId; controller.surface = "deliver";
  controller.willUpdate(new Map());
  return { controller, snapshot, fixture, render: () => controller.render() };
}

test("actual controller distinguishes governed capacity, lists safe labels, and keeps its technical budget collapsed", async () => {
  assert.equal(runtime.outputDeliveryMessageDescriptor("output_source_governance_capacity_exceeded").known, true);
  const f = await renderScenario("governed-capacity"), rendered = f.render();
  const disclosure = region(rendered, 'class="output-governed-source-disclosure"');
  const copy = text(rendered);
  assert.ok(copy.includes("This route cannot fully verify the governed sources"));
  assert.ok(copy.includes("Saved plan; source checks are not verified"));
  assert.ok(text(disclosure).includes("partial list of authorized source labels"));
  assert.ok(text(disclosure).includes("Owned uploads do not bypass them"));
  assert.ok(text(disclosure).includes("spending history remain"));
  assert.ok(text(disclosure).includes("flattening or deleting origin records is not a valid workaround"));
  const labels = templates(disclosure).filter((entry) => entry.strings.some((part) => part.includes('<li dir="auto">'))).flatMap((entry) => entry.values);
  assert.deepEqual(labels, readiness.outputSourceGovernance(f.snapshot).sources.map((row) => row.label));
  assert.equal(labels.length, 32); assert.ok(labels.every((label) => label.length <= 120));
  assert.ok(!templates(disclosure).some((entry) => entry.strings.some((part) => part.includes("<a"))), "no fabricated source or escalation link");
  const details = templates(disclosure).find((entry) => entry.strings.some((part) => part.includes("<details><summary>")));
  assert.ok(details); assert.ok(!details.strings.some((part) => /<details[^>]*\bopen\b/u.test(part)));
  assert.ok(text(details).includes("not a package count or nesting-depth limit"));
  const css = readFileSync(new URL("../src/components/forma-output-requirements.css", import.meta.url), "utf8");
  assert.match(css, /\.output-governed-source-disclosure\s*\{[^}]*overflow-wrap:anywhere/u, "long authorized labels must wrap within a narrow disclosure");
  assert.equal(f.fixture.requests.length, 0);
});

test("missing governance disclosure remains unknown, never zero sources or an invented two-batch limit", async () => {
  const f = await renderScenario("governed-capacity", (snapshot) => { delete snapshot.sourceVerification.governance; });
  const disclosure = region(f.render(), 'class="output-governed-source-disclosure"'), copy = text(disclosure);
  assert.ok(copy.includes("authorized governed-source list is unavailable"));
  assert.ok(copy.includes("database capture-batch limit was not supplied"));
  assert.ok(!copy.includes("Database capture batches allowed"));
  assert.ok(!copy.includes("No governed sources"));
  assert.equal(readiness.outputDeliveryReadiness(f.snapshot).allowed, false);
  assert.equal(readiness.captureOutputRelease(f.snapshot, "file"), null);
});

test("metadata alone and a generic proof-size failure do not display or blame the governed-batch capacity panel", async () => {
  for (const scenario of ["governed-institutional", "governed-licensed"]) {
    const f = await renderScenario(scenario);
    assert.equal(hasRegion(f.render(), 'class="output-governed-source-disclosure"'), false);
    assert.equal(readiness.outputNativeReadiness(f.snapshot).allowed, true);
  }
  for (const reason of ["output_source_proof_too_large", "output_source_governance_proof_too_large", "context_source_evidence_capacity_exceeded", "context_source_rights_expired"]) {
    const f = await renderScenario("governed-capacity", (snapshot) => { snapshot.sourceVerification.reasonCodes = [reason]; });
    assert.equal(hasRegion(f.render(), 'class="output-governed-source-disclosure"'), false, reason);
    assert.equal(readiness.outputSourceReadiness(f.snapshot).allowed, false);
  }
});

test("governed failure preserves free structural review and saved-receipt recovery while generation and delivery remain blocked", async () => {
  const f = await renderScenario("governed-capacity"), rendered = f.render();
  const receipt = templates(rendered).find((entry) => translated(entry, "checkSavedReceipt"));
  assert.ok(receipt); assert.equal(binding(receipt, "?disabled"), false);
  const run = templates(rendered).find((entry) => translated(entry, "checkRun"));
  assert.ok(run); assert.equal(binding(run, "?disabled"), true);
  const delivery = templates(rendered).find((entry) => translated(entry, "downloadFiles"));
  assert.ok(delivery); assert.equal(binding(delivery, "?disabled"), true);
  const partial = eventHandlers(delivery, "change")[0];
  assert.ok(partial); partial({ target: { checked: true } });
  assert.equal(binding(templates(f.render()).find((entry) => translated(entry, "downloadFiles")), "?disabled"), true,
    "requesting a partial package cannot bypass unknown source proof");
  assert.equal(f.snapshot.grants[0].exposedMicrousd, 100_000);
  assert.equal(f.snapshot.assets.length, 1); assert.equal(f.snapshot.results[0].review, "approved");
  const card = binding(region(rendered, "<forma-output-requirement-card"), ".snapshot");
  assert.equal(card.summary.overall, "unknown"); assert.equal(card.summary.requiredRemaining, null);
  assert.equal(card.summary.selectedResultFiles, null); assert.ok(card.results.every((row) => row.canOpen === false));
  const open = eventHandlers(rendered, "click").find((handler) => handler.toString().includes("#openPlan(event.currentTarget)"));
  assert.ok(open); open.call(f.controller, { currentTarget: { isConnected: true, disabled: false, focus() {} } });
  await f.controller.updateComplete;
  const review = region(f.render(), 'class="output-plan-review"');
  assert.equal(binding(review, "?disabled"), false, "free structure agreement is not source verification or delivery approval");
  assert.equal(f.fixture.requests.length, 0);
});
