import assert from "node:assert/strict";
import test from "node:test";
import { outputContextPackageFailure } from "../worker/output-context-package-policy.ts";
import { prepareOutputRequirementClientEvents } from "../worker/output-requirement-event-guards.ts";
import { parseOutputRequirement } from "../src/model/output-requirements.ts";

test("Output package policy identifies supported drafts, casing, future schemas and disguised structured writes", () => {
  for (const block of [{ type: "Output", properties: {} }, { type: "OUtput", properties: { text: "Custom" } }, { type: "output", properties: { output_spec: { schema_version: 99 } } }, { type: "format", properties: { output_spec: null } }]) {
    const failure = outputContextPackageFailure([block]);
    assert.equal(failure.error, "output_context_package_unsupported"); assert.match(failure.message, /Document/u);
  }
  assert.equal(outputContextPackageFailure([{ type: "format", properties: { text: "Format: 1:1", output_palette: ["blue"] } }, { type: "message", properties: { text: "The word output remains ordinary source prose." } }]), null);
});

test("the generic server event guard also blocks forged package Output creation before parsing or granting anything", () => {
  const spec = parseOutputRequirement({ id: "new-output", type: "output", content: "1 slideshow with 5-15 slides" }).spec;
  for (const field of ["organization_context_package_id", "organization_context_package_version_id", "organization_context_package_binding_id", "organization_context_source_block_id"]) {
    const events = [{ type: "BlockCreated", payload: { block_id: "new-output", type: "OUtput", properties: { text: spec.original_text, output_spec: spec, [field]: "forged-provenance" } } }];
    const original = structuredClone(events), guarded = prepareOutputRequirementClientEvents(events, []);
    assert.equal(guarded.ok, false); assert.equal(guarded.error, "output_context_package_unsupported"); assert.equal(guarded.status, 409);
    assert.deepEqual(events, original);
  }
  const disguised = prepareOutputRequirementClientEvents([{ type: "BlockCreated", payload: { block_id: "new-output", type: "format", properties: { output_spec: spec, organization_context_package_binding_id: "binding" } } }], []);
  assert.equal(disguised.ok, false); assert.equal(disguised.error, "output_context_package_unsupported");
});

test("ordinary independent Output drafts and source Format creation stay available", () => {
  const result = prepareOutputRequirementClientEvents([{ type: "BlockCreated", payload: { block_id: "independent-output", type: "Output", properties: { text: "One deck" } } }, { type: "BlockCreated", payload: { block_id: "format", type: "format", properties: { text: "A4" } } }], []);
  assert.equal(result.ok, true); assert.equal(result.events[0].payload.type, "output");
  assert.equal(result.events[0].payload.properties.output_spec.id, "independent-output"); assert.equal(result.events[1].payload.type, "format");
});
