import assert from "node:assert/strict";
import test from "node:test";
import { creatorProductionSummary } from "../src/model/production-summary.ts";

// Actual production helper; no fixture reimplementation, provider or database.
const artifact = Object.freeze({
  id: "original-artifact", documentId: "original-document", kind: "video", itemCount: 4,
  settings: Object.freeze({ production_mode: "managed", video_audio_mode: "original_ambient" }),
});
const maximum = Number.MAX_SAFE_INTEGER;
const cases = [
  ["no usage receipt", [], null],
  ["explicit zero", [{ cost_microusd: 0 }], 0],
  ["two explicit zeros", [{ cost_microusd: 0 }, { cost_microusd: 0 }], 0],
  ["known amount", [{ cost_microusd: 1200 }], 1200],
  ["known sum", [{ cost_microusd: 1200 }, { cost_microusd: 300 }], 1500],
  ["missing amount", [{}], null],
  ["explicit undefined", [{ cost_microusd: undefined }], null],
  ["null amount", [{ cost_microusd: null }], null],
  ["negative amount", [{ cost_microusd: -1 }], null],
  ["fractional microusd", [{ cost_microusd: 0.5 }], null],
  ["numeric string", [{ cost_microusd: "1200" }], null],
  ["boolean", [{ cost_microusd: false }], null],
  ["NaN", [{ cost_microusd: NaN }], null],
  ["positive infinity", [{ cost_microusd: Infinity }], null],
  ["negative infinity", [{ cost_microusd: -Infinity }], null],
  ["known then missing", [{ cost_microusd: 1200 }, {}], null],
  ["missing then known", [{}, { cost_microusd: 1200 }], null],
  ["known zero then missing", [{ cost_microusd: 0 }, {}], null],
  ["maximum safe single amount", [{ cost_microusd: maximum }], maximum],
  ["maximum safe sum", [{ cost_microusd: maximum - 2 }, { cost_microusd: 2 }], maximum],
  ["unsafe single amount", [{ cost_microusd: maximum + 1 }], null],
  ["unsafe accumulated amount", [{ cost_microusd: maximum }, { cost_microusd: 1 }], null],
  ["unsafe accumulated reverse order", [{ cost_microusd: 1 }, { cost_microusd: maximum }], null],
  ["overflowing finite amount", [{ cost_microusd: Number.MAX_VALUE }], null],
];
for (const [name, payloads, expected] of cases) test("production cost truth: " + name, () => {
  const events = [
    { type: "DocumentRenderRequested", payload: { artifact_id: artifact.id, estimated_cost_microusd: 1_000_000 } },
    { type: "BudgetReserved", payload: { artifact_id: artifact.id, reserved_microusd: 2_000_000 } },
    ...payloads.map(payload => ({ type: "GenerationUsageRecorded", payload: { artifact_id: artifact.id, ...payload } })),
    { type: "GenerationUsageRecorded", payload: { artifact_id: "other-artifact", cost_microusd: NaN } },
  ].map(event => Object.freeze({ ...event, payload: Object.freeze(event.payload) }));
  const before = structuredClone(events);
  const summary = creatorProductionSummary(artifact, Object.freeze(events));
  assert.equal(summary.actualMicrousd, expected);
  assert.equal(summary.estimatedMicrousd, 1_000_000, "forecast stays separate");
  assert.equal(summary.reservedMicrousd, 2_000_000, "reservation stays separate");
  assert.equal(summary.delivery, "scene-reel", "no assembled-film claim");
  assert.equal(summary.mediaInspected, false, "no media-quality claim");
  assert.equal(summary.fullyEvaluated, false);
  assert.deepEqual(events, before, "reporting never rewrites original evidence");
});

test("production cost truth: another artifact's known usage cannot certify this artifact", () => {
  const summary = creatorProductionSummary(artifact, [
    { type: "GenerationUsageRecorded", payload: { artifact_id: "other-artifact", cost_microusd: 0 } },
  ]);
  assert.equal(summary.actualMicrousd, null);
  assert.equal(summary.reservedMicrousd, null);
});
