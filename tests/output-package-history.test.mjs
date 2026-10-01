// Actual controller bodies with synthetic store replies and Blob release effects.
// No HTTP, browser, provider, or immutable-history repair is exercised by this test.
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(process.env.FORMA_OUTPUT_REGRESSION_ROOT || fileURLToPath(new URL("../", import.meta.url)));
const { binding, controllerFixture, deferred, eventHandlers, handler, region, startDownload, submitEvent, templates } = await import(pathToFileURL(resolve(root, "tests/output-ui-source-harness.mjs")));
const { outputSourceReadiness, outputDeliveryReadiness, outputNativeReadiness, outputPackageReadiness } = await import(pathToFileURL(resolve(root, "src/components/output-source-readiness.ts")));
const { outputDeliveryMessageDescriptor } = await import(pathToFileURL(resolve(root, "src/components/design-system/locales/output-delivery-runtime-messages.ts")));
const code = "output_scope_history_reason_unverified";
const exportForm = (f) => region(f.controller.render(), 'class="output-export"');
const tagged = (part, key) => part.values.some((value) => typeof value === "string" && value.includes(`output.delivery.${key}`));
function historyFailure(f) {
  const current = structuredClone(f.snapshots.get("doc-a"));
  current.capabilities.limitationCodes = [code]; current.summary.delivery_ready = false; current.summary.completion = "unknown";
  for (const summary of Object.values(current.requirementSummaries)) { summary.delivery_ready = false; summary.completion = "unknown"; }
  f.snapshots.set("doc-a", current); f.controller.willUpdate(new Map());
  return current;
}

test("legacy history is explained in the package panel to readers without offering partial export as a repair", async () => {
  const f = await controllerFixture(), current = historyFailure(f);
  current.permissions.canAuthor = false;
  const form = exportForm(f);
  assert.equal(outputDeliveryMessageDescriptor(code).known, true);
  assert.ok(region(form, 'class="output-package-history-warning"'));
  assert.ok(JSON.stringify(form).includes(outputDeliveryMessageDescriptor(code).id));
  assert.ok(!templates(form).some((part) => tagged(part, "partialExplicit")));
  assert.equal(binding(form, "?disabled"), true);
  await handler(form, "submit", "#export").call(f.controller, submitEvent());
  assert.equal(f.requests.length, 0);
  const card = binding(region(f.controller.render(), "<forma-output-requirement-card"), ".snapshot");
  assert.equal(card.summary.overall, "unknown");
  assert.ok(card.summary.headline.includes(outputDeliveryMessageDescriptor(code).id));
  assert.equal(card.summary.requiredRemaining, current.summary.required_obligations - current.summary.fulfilled_required_obligations);
  assert.ok(!card.summary.headline.includes("Delivery scope is unknown. Refresh before acting."));
});

test("a stale partial-export callback cannot work around newly unverified immutable history", async () => {
  const f = await controllerFixture(), before = exportForm(f), oldPartial = eventHandlers(before, "change")[0];
  assert.ok(oldPartial); oldPartial({ target: { checked: true } });
  historyFailure(f);
  oldPartial({ target: { checked: true } });
  await handler(before, "submit", "#export").call(f.controller, submitEvent());
  assert.equal(f.requests.length, 0);
  assert.equal(binding(exportForm(f), "?disabled"), true);
});

test("held package bytes are not released after same-revision history becomes unverified, while exact files remain available", async () => {
  const f = await controllerFixture(), initial = f.snapshots.get("doc-a"), bytes = deferred(), bytesEntered = deferred();
  initial.summary.delivery_ready = true;
  const revision = initial.revision, source = initial.sourceRevision, plan = initial.confirmedPlan.revisionId;
  const path = "/api/output-requirements/deliveries/synthetic-package?documentId=doc-a";
  f.store.outputRequirementCommand = async (command) => {
    f.requests.push({ kind: "command", ...command });
    return { status: "saved", body: { snapshot: structuredClone(initial), command: { action: "export", manifestId: "synthetic-package", eventId: "synthetic-export-event", downloadUrl: path } } };
  };
  f.store.outputRequirements.download = (documentId, url) => { f.requests.push({ kind: "download", documentId, url }); bytesEntered.resolve(); return bytes.promise; };
  const pending = handler(exportForm(f), "submit", "#export").call(f.controller, submitEvent());
  // Await this exact byte-request entry, not a guessed turn of the digest clock.
  // Unexpected non-dispatch also terminates so the original count assertion fails.
  await Promise.race([bytesEntered.promise, pending]);
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].url, path, "the package-byte request really began before the changed snapshot");
  const current = historyFailure(f);
  assert.equal(current.revision, revision); assert.equal(current.sourceRevision, source); assert.equal(current.confirmedPlan.revisionId, plan);
  bytes.resolve({ status: "saved", body: { blob: new Blob(["synthetic package bytes"]), filename: "synthetic-package.zip" } });
  await pending;
  assert.equal(f.effects.downloads, 0, "no anchor click or Blob URL release follows the package-only history failure");
  assert.equal(outputPackageReadiness(current).allowed, false);
  for (const gate of [outputSourceReadiness, outputDeliveryReadiness, outputNativeReadiness]) assert.equal(gate(current).allowed, true);
  f.store.outputRequirements.download = async (documentId, url) => {
    f.requests.push({ kind: "exact-file", documentId, url });
    return { status: "saved", body: { blob: new Blob(["synthetic exact file"], { type: "image/png" }), filename: "owned.png" } };
  };
  await startDownload(f);
  assert.equal(f.effects.downloads, 1, "the same eligible exact-file review remains possible");
  assert.equal(f.requests.filter((request) => request.action === "export").length, 1);
  assert.equal(f.requests.filter((request) => request.action === "authorize" || request.action === "run").length, 0);
});

test("previously prepared package parts retire and old part callbacks refuse the history failure", async () => {
  const f = await controllerFixture(), initial = f.snapshots.get("doc-a"); initial.summary.delivery_ready = true;
  f.store.outputRequirementCommand = async (command) => {
    f.requests.push({ kind: "command", ...command });
    return { status: "saved", body: { snapshot: initial, command: { action: "export", manifestId: "synthetic-package", eventId: "synthetic-export-event", downloadUrls: [
      "/api/output-requirements/deliveries/synthetic-package?documentId=doc-a&part=1", "/api/output-requirements/deliveries/synthetic-package?documentId=doc-a&part=2",
    ] } } };
  };
  await handler(exportForm(f), "submit", "#export").call(f.controller, submitEvent());
  const parts = region(f.controller.render(), 'class="output-package-parts"'), oldClicks = eventHandlers(parts, "click");
  assert.equal(oldClicks.length, 2); assert.equal(f.requests.length, 1);
  historyFailure(f);
  for (const callback of oldClicks) await callback();
  assert.ok(!templates(f.controller.render()).some(part => part.strings.join("").includes('class="output-package-parts"')),
    "an invalidated inventory retires its recorded package controls");
  assert.equal(f.requests.length, 1, "part release is refused before another bytes request");
});


test("a package-entry wait terminates without dispatch when history changes during digest preparation", async () => {
  const f = await controllerFixture(), bytesEntered = deferred();
  f.snapshots.get("doc-a").summary.delivery_ready = true;
  f.store.outputRequirements.download = () => { bytesEntered.resolve(); throw new Error("unexpected package-byte dispatch"); };
  const pending = handler(exportForm(f), "submit", "#export").call(f.controller, submitEvent());
  historyFailure(f);
  await Promise.race([bytesEntered.promise, pending]); await pending;
  assert.equal(f.requests.length, 0); assert.equal(f.effects.downloads, 0);
  assert.equal(outputPackageReadiness(f.snapshots.get("doc-a")).allowed, false);
});
