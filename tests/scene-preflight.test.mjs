import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderSceneProviderDisclosure } from "../src/components/scene-provider-disclosure.ts";
import { buildManagedProductionPlan } from "../src/model/managed-production.ts";

const locale = {
  t(_id, fallback, values = {}) { return fallback.replace(/\{([^}]+)\}/g, (match, key) => String(values[key] ?? match)); },
  number(value, options) { return new Intl.NumberFormat("en-US", options).format(value); },
};

function verifiedPreview(overrides = {}) {
  return { version: "scene-cost-v1", requestId: "scene-disclosure-fixture", actorUserId: "owner", projectId: "project", documentId: "document",
    contextSessionId: null, permissionEpoch: "epoch", period: "2026-08", requestHash: "a".repeat(64), sourceHash: "b".repeat(64), provider: "openai",
    model: "gpt-scene-configured", sceneMedium: "visual", productionMode: "manual", itemCount: 1, reusedSourceCount: 0,
    providerCallCount: 1, maximumProviderCallCount: 2, maximumMicrousd: 1_000_000, bindingHash: "c".repeat(64), ...overrides };
}

function renderMarkup(value) {
  if (value === null || value === undefined || typeof value === "symbol" || typeof value === "boolean") return "";
  if (Array.isArray(value)) return value.map(renderMarkup).join("");
  if (typeof value === "object" && Array.isArray(value.strings) && Array.isArray(value.values)) {
    return value.strings.reduce((markup, chunk, index) => markup + chunk + renderMarkup(value.values[index]), "");
  }
  return String(value);
}

test("Scene preflight discloses the configured text model, bounded calls, full ceiling, and written-only output", () => {
  const markup = renderMarkup(renderSceneProviderDisclosure(locale, { preview: verifiedPreview() }));
  assert.match(markup, /Paid provider · OpenAI Responses · \u2068gpt-scene-configured\u2069/);
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
      const preview = verifiedPreview({ model: "configured-text-model", sceneMedium: medium, productionMode: "managed", itemCount: count,
        providerCallCount: production.providerCallCount, maximumProviderCallCount: production.maximumProviderCallCount,
        maximumMicrousd: production.estimatedTotalCostMicrousd, reusedSourceCount: 1 });
      const markup = renderMarkup(renderSceneProviderDisclosure(locale, { preview }));
      assert.ok(markup.includes(`${count} planned written scene${count===1?"":"s"} ·`));
      assert.ok(markup.includes("1 reused source items included in this verified plan."));
      assert.ok(markup.includes(`${batches} planned provider request${batches === 1 ? "" : "s"}; up to ${batches * 4} total paid requests`));
      assert.ok(markup.includes(`application-enforced spending ceiling: $${batches}.00`));
    }
  });
}

test("Scene composer uses only its verified descriptor; an absent plan has no invented model, calls or cost", async () => {
  const component = await readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8");
  assert.ok(component.includes("renderSceneProviderDisclosure(this.i18n,{preview:sceneView?.inspection?.preview??null,existing:Boolean(sceneView?.inspection?.job)})"));
  const markup = renderMarkup(renderSceneProviderDisclosure(locale, {}));
  assert.match(markup, /Provider calls and spending ceiling are not verified/);
  assert.match(markup, /does not generate images, video, or audio/);
  assert.doesNotMatch(markup, /planned provider request|Initial reservation|\$[0-9]|Paid provider ·/);
  assert.doesNotMatch(markup, /gpt-image|gpt-5\.6/);
});

test("An original Scene descriptor remains a receipt, not a current-draft reservation or submission approval", () => {
  const markup = renderMarkup(renderSceneProviderDisclosure(locale, { preview: verifiedPreview(), existing: true }));
  assert.match(markup, /Original Scene request — not the current draft/);
  assert.match(markup, /Original approved spending ceiling: \$1\.00/);
  assert.match(markup, /not a settled charge or a current reservation balance/);
  assert.doesNotMatch(markup, /Submitting sends this Document|Initial reservation/);
});
