// Actual AST-controller + actual helpers. Synthetic incomplete snapshot and Lit templates.
// This checks UI failure behavior only, not server authorization, browser, or provider behavior.
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(process.env.FORMA_OUTPUT_REGRESSION_ROOT || fileURLToPath(new URL("../", import.meta.url)));
const { binding, controllerFixture, region, startPreflight, templates } =
  await import(pathToFileURL(resolve(root, "tests/output-ui-source-harness.mjs")));
for (const missing of ["map", "selected target digest"]) {
  test(`an incomplete ${missing} cannot crash the controller or offer an inert enabled preflight action`, async () => {
    const f = await controllerFixture();
    const current = f.snapshots.get("doc-a");
    if (missing === "map") delete current.confirmedPlan.targetContractDigests;
    else delete current.confirmedPlan.targetContractDigests[current.confirmedPlan.plan.targets[0].id];
    assert.doesNotThrow(() => f.controller.willUpdate(new Map()),
      "incomplete target identity must remain an unavailable decision, not break the observer");
    const execution = region(f.controller.render(), 'class="output-execution"');
    const check = templates(execution).find((part) => part.values.some((value) =>
      typeof value === "string" && value.includes("output.delivery.checkRun")));
    assert.ok(check);
    assert.equal(binding(check, "?disabled"), true,
      "the visible action must agree with the current target identity guard");
    await startPreflight(f);
    assert.equal(f.requests.length, 0);
  });
}
