import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderSceneProviderDisclosure } from "../src/components/scene-provider-disclosure.ts";
import { buildManagedProductionPlan } from "../src/model/managed-production.ts";

const locale = {
  t(_id, fallback, values = {}) { return fallback.replace(/\{([^}]+)\}/g, (match, key) => String(values[key] ?? match)); },
  number(value, options) { return new Intl.NumberFormat("en-US", options).format(value); },
};

function renderMarkup(value) {
  if (value === null || value === undefined || typeof value === "symbol" || typeof value === "boolean") return "";
  if (Array.isArray(value)) return value.map(renderMarkup).join("");
  if (typeof value === "object" && Array.isArray(value.strings) && Array.isArray(value.values)) {
    return value.strings.reduce((markup, chunk, index) => markup + chunk + renderMarkup(value.values[index]), "");
  }
  return String(value);
}

test("Scene preflight discloses the configured text model, bounded calls, full ceiling, and written-only output", () => {
  const markup = renderMarkup(renderSceneProviderDisclosure(locale, { model: "gpt-scene-configured" }));
  assert.match(markup, /Paid provider · OpenAI Responses · gpt-scene-configured/);
  assert.match(markup, /1 planned provider request; up to 2 total paid requests/);
  assert.match(markup, /application-enforced spending ceiling: \$1\.00/);
  assert.match(markup, /not a provider-enforced cap/);
  assert.match(markup, /active, authorized text, Scene directions, and selected production source text to OpenAI/);
  assert.match(markup, /Stable source identifiers remain private/);
  assert.match(markup, /does not generate images, video, or audio/);
  assert.match(markup, /Paid attempts and charges remain recorded even if validation prevents an accepted output/);
});

for (const medium of ["visual", "audio"]) {
  test(`${medium} Scene preflight follows real managed batch, repair, and reservation math`, () => {
    const snapshot = { facts: [{ block_id: "scene-source", type: "direction", properties: { text: "The keeper hears the harbor bell." } }] };
    for (const count of [1, 8, 9, 17]) {
      const production = buildManagedProductionPlan("scene", snapshot, { requestedItemCount: count, sceneMedium: medium });
      const batches = Math.ceil(count / 8);
      assert.equal(production.scenes.length, count);
      assert.equal(production.providerCallCount, batches);
      assert.equal(production.maximumProviderCallCount, batches * 4);
      assert.equal(production.estimatedTotalCostMicrousd, batches * 1_000_000, "a written Scene has no media-render cost");
      const markup = renderMarkup(renderSceneProviderDisclosure(locale, { model: "configured-text-model", production }));
      assert.ok(markup.includes(`${batches} planned provider request${batches === 1 ? "" : "s"}; up to ${batches * 4} total paid requests`));
      assert.ok(markup.includes(`application-enforced spending ceiling: $${batches}.00`));
    }
  });
}

test("Scene composer renders its disclosure in both production modes without substituting an image model", async () => {
  const component = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");
  assert.match(component, /this\.#kind==="scene"\?renderSceneProviderDisclosure\(this\.i18n,\{model:session\?\.provider\.plannerModel,production:managedPlan\}\):nothing/);
  const markup = renderMarkup(renderSceneProviderDisclosure(locale, {}));
  assert.match(markup, /Configured text model/);
  assert.doesNotMatch(markup, /gpt-image|gpt-5\.6/);
});
