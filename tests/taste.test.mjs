import assert from "node:assert/strict";
import test from "node:test";
import { beliefHistory, inferTasteBeliefs, preferenceCapsule, standingConstraints, tasteMetrics } from "../src/model/taste.ts";

const event = (sequence, type, payload, actor = "user", occurredAt = "2026-08-09T12:00:00.000Z") => ({
  eventId: `event-${sequence}`, streamId: "stream-taste", sequence, occurredAt,
  recordedAt: new Date(Date.UTC(2026, 7, 10, 12, 0, sequence)).toISOString(),
  actor, clientId: "test", correlationId: `corr-${sequence}`, causationId: null,
  compensatesEventId: null, schemaVersion: 1, type, payload,
});

const base = [
  event(1, "PreferenceAuthored", { preference_id: "p-style", axis: "style", value: "restrained grain", polarity: "affirm" }),
  event(2, "PreferenceAuthored", { preference_id: "p-palette", axis: "palette", value: "cold cyan", polarity: "forbid" }),
  event(3, "PreferenceRevoked", { preference_id: "p-palette" }),
  event(4, "ChipEdited", { block_id: "palette", property: "colors", new_value: "warm amber" }),
  event(5, "ObjectCritiqued", { object_id: "o1", axis_ref: "composition", polarity: "negative", value: "centered symmetry", note_ref: "private-note" }),
];

test("keeps standing authored constraints replayable as of a sequence", () => {
  assert.deepEqual(standingConstraints(base, 2).map((item) => item.preferenceId).sort(), ["p-palette", "p-style"]);
  assert.deepEqual(standingConstraints(base).map((item) => item.preferenceId), ["p-style"]);
});

test("builds decaying inferred beliefs with closed creator axes", () => {
  const beliefs = inferTasteBeliefs(base, new Date("2026-08-10T12:00:00.000Z"));
  assert.ok(beliefs.some((belief) => belief.axis === "palette" && belief.value === "warm amber"));
  assert.ok(beliefs.some((belief) => belief.axis === "composition" && belief.polarity === "forbid"));
  assert.ok(beliefs.every((belief) => belief.confidence > 0 && belief.freshness < 1));
});

test("separates inferred ranking claims from authored promotion and forgetting", () => {
  const beliefs = inferTasteBeliefs(base, new Date("2026-08-10T12:00:00.000Z")); const promoted = beliefs[0];
  const versioned = [...base, event(6, "TasteModelVersioned", { version_id: "v1", beliefs, ranking_policy: { ranking_only: true } }, "worker:taste")];
  const withPromotion = [...versioned, event(7, "PreferenceAuthored", { preference_id: "promoted", axis: promoted.axis, value: promoted.value, polarity: promoted.polarity, source_claim_ref: promoted.claimRef })];
  assert.ok(preferenceCapsule(withPromotion).some((belief) => belief.authority === "authored" && belief.sourceClaimRef === promoted.claimRef));
  const forgotten = [...withPromotion, event(8, "FactRetracted", { fact_ref: beliefs[1].claimRef, reason: "forgotten-by-user" })];
  assert.ok(!preferenceCapsule(forgotten, 20).some((belief) => belief.claimRef === beliefs[1].claimRef && belief.authority === "inferred"));
  const metrics = tasteMetrics(forgotten); assert.equal(metrics.versions, 1); assert.equal(metrics.promoted, 1); assert.ok(metrics.promotionRate > 0);
});

test("exposes valid-time and recorded-time belief history", () => {
  const history = beliefHistory(base);
  assert.equal(history[0].type, "PreferenceRevoked");
  assert.ok(history.every((item) => item.occurredAt && item.recordedAt));
});
