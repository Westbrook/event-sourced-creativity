import assert from "node:assert/strict";
import test from "node:test";
import { beliefHistory, compilerBlameLedger, inferTasteBeliefs, preferenceCapsule, standingConstraints, tasteMetrics } from "../src/model/taste.ts";

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

test("joins critiques through generated objects to compiler inputs and model adapters", () => {
  const evidence = [
    event(1,"ContextCompiled",{generation_id:"g1",model_id:"model-a",adapter_version:"adapter-v2",source_block_versions:[{block_id:"direction-a",version:3},{block_id:"palette-a",version:2}]},"worker:compiler"),
    event(2,"GenerationCompleted",{generation_id:"g1",model_id:"model-a",object_ids:["object-a"]},"worker:generator"),
    event(3,"ObjectCritiqued",{object_id:"object-a",axis_ref:"composition",polarity:"negative",value:"too centered"}),
    event(4,"ObjectCritiqued",{object_id:"object-a",axis_ref:"palette",polarity:"positive",value:"restrained amber"}),
    event(5,"ObjectCritiqued",{object_id:"missing-object",axis_ref:"style",polarity:"negative",value:"too polished"}),
  ];
  const ledger=compilerBlameLedger(evidence); const attributed=ledger.find((cluster)=>cluster.modelId==="model-a"); const unresolved=ledger.find((cluster)=>!cluster.attributed);
  assert.equal(attributed?.adapterVersion,"adapter-v2"); assert.equal(attributed?.critiqueCount,2); assert.deepEqual(attributed?.sourceBlockVersions.map((source)=>`${source.blockId}@${source.version}`),["direction-a@3","palette-a@2"]);
  assert.ok(attributed?.axes.some((row)=>row.axis==="composition"&&row.negative===1)); assert.ok(attributed?.axes.some((row)=>row.axis==="palette"&&row.positive===1)); assert.equal(attributed?.compileRefs.length,1);
  assert.equal(unresolved?.critiqueCount,1); assert.equal(tasteMetrics(evidence).attributedCritiques,2);
});

const savedContext = (facts) => [
  event(1, "ContextCompiled", { generation_id: "g-saved", compiled_snapshot: { facts } }, "worker:compiler"),
  event(2, "GenerationCompleted", { generation_id: "g-saved", object_ids: ["saved-output"] }, "worker:generator"),
  event(3, "ObjectSaved", { object_id: "saved-output" }),
];
const inferenceTime = new Date("2026-08-10T12:00:00.000Z");

test("saved structured context produces readable inferred preferences with its original evidence", () => {
  const facts = [
    { block_id: "private-palette-id", type: "palette", active: true, properties: { colors: ["amber", "ochre"], weight: .8 }, source_event_refs: ["private-source-id"] },
    { type: "direction", properties: { text: "  Restrained\n  grain  ", content_ref: "private-content-id", media_url: "https://private.example/source" } },
    { type: "reference", properties: { description: "Soft window light", media_url: "https://private.example/reference" } },
  ];
  const original = structuredClone(facts);
  const beliefs = inferTasteBeliefs(savedContext(facts), inferenceTime);
  assert.deepEqual(beliefs.map(({ axis, value, authority }) => ({ axis, value, authority })), [
    { axis: "palette", value: "amber, ochre", authority: "inferred" },
    { axis: "style", value: "Restrained grain", authority: "inferred" },
    { axis: "style", value: "Soft window light", authority: "inferred" },
  ]);
  assert.ok(beliefs.every((belief) => belief.polarity === "affirm" && belief.evidenceRefs.join(",") === "event-1,event-2,event-3"));
  assert.doesNotMatch(JSON.stringify(beliefs), /\[object Object\]|private-|https:\/\//u);
  assert.deepEqual(facts, original);
});

test("saved structured context skips inactive and metadata-only facts and preserves exclusions", () => {
  const facts = [
    { type: "palette", active: false, properties: { text: "inactive blue" } },
    { type: "lighting", properties: { text: "disabled flash", weight: 0 } },
    { type: "reference", properties: { media_url: "https://private.example/reference", content_ref: "private-id", weight: .8 } },
    { type: "direction", properties: { text: { secret: "must not stringify nested data" } } },
    { type: "exclusion", intent: "avoid", effect: "must_not_include", properties: { text: "logos" } },
    { type: "subject", intent: "prohibit", properties: { description: "crowds" } },
  ];
  const beliefs = inferTasteBeliefs(savedContext(facts), inferenceTime);
  assert.deepEqual(beliefs.map(({ axis, value, polarity }) => ({ axis, value, polarity })), [
    { axis: "exclusion", value: "logos", polarity: "forbid" },
    { axis: "subject", value: "crowds", polarity: "forbid" },
  ]);
  assert.deepEqual(inferTasteBeliefs(savedContext([null, 42, {}, [], { properties: {} }]), inferenceTime), []);
});

test("legacy saved facts retain their interpretation and structured values stay bounded", () => {
  const beliefs = inferTasteBeliefs(savedContext(["palette/dusk/warm", { type: "composition", properties: { text: "x".repeat(300) } }]), inferenceTime);
  assert.equal(beliefs[0].axis, "palette");
  assert.equal(beliefs[0].value, "dusk/warm");
  assert.equal(beliefs[1].axis, "composition");
  assert.equal(beliefs[1].value.length, 120);
  const unmatched = savedContext([{ type: "subject", properties: { text: "unrelated" } }]);
  unmatched[2].payload.object_id = "other-output";
  assert.deepEqual(inferTasteBeliefs(unmatched, inferenceTime), []);
});
