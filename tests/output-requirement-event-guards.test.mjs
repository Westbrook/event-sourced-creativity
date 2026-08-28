import assert from "node:assert/strict";
import test from "node:test";
import { inspectOutputRequirement } from "../src/model/output-requirements.ts";
import { normalizeOutputRequirementCreation, prepareOutputRequirementClientEvents, outputAuthoringBlocksFromEvents } from "../worker/output-requirement-event-guards.ts";

const create = (extra = {}) => ({ type: "BlockCreated", payload: { block_id: "output-one", document_id: "doc-one", type: "OUtput", properties: { text: 'Output images at aspect ratios "1:1" and "4:5".', subtype: "Social media image", weight: 0.8, intent: "avoid", influence: 1, effect: "must_not_include" }, ...extra } });
const saved = () => [{ id: "output-one", type: "output", position: "a0", properties: normalizeOutputRequirementCreation(create().payload).properties }];
const edit = (property_path, new_value, extra = {}) => ({ type: "BlockPropertyEdited", payload: { block_id: "output-one", property_path, new_value, ...extra } });

test("generic Output authoring creates a canonical draft without corpus influence or job authority", () => {
  const input = create();
  const prepared = prepareOutputRequirementClientEvents([input], []);
  assert.equal(prepared.ok, true);
  const event = prepared.events[0];
  assert.equal(event.payload.type, "output");
  assert.equal(inspectOutputRequirement(event.payload.properties.output_spec).status, "valid");
  for (const key of ["weight", "intent", "influence", "effect"]) assert.equal(Object.hasOwn(event.payload.properties, key), false);
  assert.equal(event.payload.properties.output_spec.deliverables[0].format_variants.length, 2);
  assert.equal(prepared.events.length, 1);
  assert.equal(input.payload.type, "OUtput", "the caller's pending draft is not mutated");
  assert.equal(Object.hasOwn(event.payload.properties, "confirmed"), false);
});

test("malformed and future imported schemas are preserved for non-executable display", () => {
  for (const value of [{ schema_version: 999, unusual: "preserve this requirement" }, { schema_version: 1, deliverables: "invalid" }]) {
    const prepared = prepareOutputRequirementClientEvents([create({ properties: { text: "Original request", output_spec: value } })], []);
    assert.equal(prepared.ok, true);
    assert.deepEqual(prepared.events[0].payload.properties.output_spec, value);
    assert.notEqual(inspectOutputRequirement(prepared.events[0].payload.properties.output_spec).status, "valid");
  }
});

test("valid structured creation cannot reuse another block's requirement identity", () => {
  const spec = normalizeOutputRequirementCreation(create().payload).properties.output_spec;
  const result = prepareOutputRequirementClientEvents([create({ block_id: "different", properties: { output_spec: spec } })], []);
  assert.equal(result.ok, false);
  assert.equal(result.error, "output_requirement_identity_mismatch");
});

test("generic semantic edits cannot silently replace a newer nested requirement", () => {
  for (const event of [edit("output_spec", {}), edit("text", "stale prose"), edit("subtype", "New media"), edit("intent", "prefer"), edit("weight", 0), { type: "ChipEdited", payload: { block_id: "output-one", property: "output_spec", new_value: {} } }]) {
    const result = prepareOutputRequirementClientEvents([event], saved());
    assert.equal(result.ok, false);
    assert.equal(result.error, "output_requirement_endpoint_required");
  }
});

test("creating a duplicate identity cannot evade Output revision commands", () => {
  assert.equal(prepareOutputRequirementClientEvents([create()], saved()).ok, false);
  assert.equal(prepareOutputRequirementClientEvents([create({ type: "format", properties: { text: "overwrite" } })], saved()).ok, false);
  assert.equal(prepareOutputRequirementClientEvents([create(), edit("text", "second event bypass")], []).ok, false);
});

test("removed or non-current Document requirements still require guarded edits", () => {
  const history = [create({ project_id: "other-project", document_id: "other-doc" }), { type: "BlockRemoved", payload: { block_id: "output-one" } }];
  const blocks = outputAuthoringBlocksFromEvents(history);
  assert.equal(prepareOutputRequirementClientEvents([edit("text", "bypass by old Document")], blocks).ok, false);
  assert.equal(prepareOutputRequirementClientEvents([{ type: "BlockRestored", payload: { block_id: "output-one" } }], blocks).ok, false);
});

test("Output type conversion must be atomic through the dedicated save command", () => {
  for (const value of ["output", " Output ", "OUtput"]) assert.equal(prepareOutputRequirementClientEvents([edit("type", value)], [{ id: "output-one", type: "format", properties: {} }]).ok, false);
  assert.equal(prepareOutputRequirementClientEvents([edit("type", "format")], saved()).ok, false);
});

test("server-only history and forged status properties never enter generic writes", () => {
  for (const type of ["OutputPlanConfirmed", "OutputTargetAccepted", "OutputExecutionAuthorized"]) {
    const result = prepareOutputRequirementClientEvents([{ type, payload: { document_id: "doc-one", grant_id: "forged" } }], []);
    assert.equal(result.ok, false);
    assert.equal(result.error, "output_requirement_status_server_owned");
  }
  assert.equal(prepareOutputRequirementClientEvents([create({ properties: { output_grant_id: "forged" } })], []).ok, false);
  assert.equal(prepareOutputRequirementClientEvents([create({ type: "format", properties: { output_spec: {} } })], []).ok, false);
});

test("Output removal, movement across documents and extraction require explicit revision commands", () => {
  for (const type of ["BlockRemoved", "BlockRestored", "BlockRehomed", "BlockRenamed", "BlockWeightSet", "ExtractionRequested"]) {
    assert.equal(prepareOutputRequirementClientEvents([{ type, payload: { block_id: "output-one" } }], saved()).ok, false);
  }
});

test("a position-only change preserves identity and checks the current value", () => {
  assert.equal(prepareOutputRequirementClientEvents([edit("position", "b0")], saved()).ok, false);
  assert.equal(prepareOutputRequirementClientEvents([edit("position", "b0", { old_value: "old" })], saved()).ok, false);
  assert.equal(prepareOutputRequirementClientEvents([edit("position", "b0", { old_value: "a0" })], saved()).ok, true);
});

test("legacy Format authoring, generated-result renaming and ordinary text edits remain unchanged", () => {
  const legacy = { id: "format-one", type: "format", properties: { text: "A4 paper" } };
  const events = [{ type: "BlockPropertyEdited", payload: { block_id: legacy.id, property_path: "text", new_value: "A3 paper" } }, { type: "OutputRenamed", payload: { output_id: "actual-image", new_title: "My result" } }];
  assert.deepEqual(prepareOutputRequirementClientEvents(events, [legacy]), { ok: true, events });
  const generatedInput = create({ type: "reference", properties: { output_palette: ["#aabbcc"], source_output_id: "actual-image" } });
  assert.equal(prepareOutputRequirementClientEvents([generatedInput], []).ok, true);
});
