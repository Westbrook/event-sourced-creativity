import assert from "node:assert/strict";
import test from "node:test";
import { inspectOutputRequirement, parseOutputRequirement } from "../src/model/output-requirements.ts";
import { compileOutputPlan } from "../src/model/output-plan.ts";
import { outputMediaQuantityUnit } from "../src/components/output-requirement-editor.ts";
import { OUTPUT_MODEL3D_EXECUTION_POLICY, OUTPUT_NATIVE_EXECUTION_POLICY, readOutputNativeExecutionPolicy } from "../src/model/output-execution-policy.ts";
import { FORMA_OUTPUT_REQUIREMENT_MESSAGES } from "../src/components/design-system/locales/output-requirement-messages.ts";
import { FORMA_OUTPUT_DELIVERY_MESSAGES, outputDeliveryLabelKey } from "../src/components/design-system/locales/output-delivery-messages.ts";
import { outputDeliveryMessageDescriptor } from "../src/components/design-system/locales/output-delivery-runtime-messages.ts";

const parse = content => parseOutputRequirement({ id: "models", type: "Output", subtype: "3D models", content });
const options = { document_id: "document", source_revision: "source-v1", requirement_revision: "requirement-v1" };

test("3D deliverables retain exact prompt and explicit model count with no image geometry or provider fields", () => {
  for (const content of ["Create one 3D model of a ceramic teapot.", "Generate a 3D model of a ceramic teapot.", "Output 2 3D models."]) {
    const parsed = parse(content);
    assert.equal(parsed.recognized, true);
    assert.equal(parsed.needs_confirmation, true);
    assert.deepEqual(parsed.issues, []);
    const spec = parsed.spec, deliverable = spec.deliverables[0];
    assert.equal(deliverable.media_kind, "model3d");
    assert.equal(deliverable.quantity.unit, "model");
    assert.equal(deliverable.quantity.value, content.includes(" 2 ") ? 2 : 1);
    assert.equal(deliverable.original_text, content);
    assert.equal(deliverable.format_variants, undefined);
    assert.equal(deliverable.content_quantity, undefined);
    assert.equal(inspectOutputRequirement(JSON.parse(JSON.stringify(spec))).status, "valid");
    const plan = compileOutputPlan([spec], options);
    assert.deepEqual(plan.issues, []);
    assert.equal(plan.targets.length, deliverable.quantity.value);
    assert.ok(plan.targets.every(target => target.media_kind === "model3d" && target.aspect_ratio === null && target.instruction_text === content && !target.blocking_issues.length));
  }
});

test("ambiguous model counts remain unresolved and explicit range policy uses model units", () => {
  const unknown = parse("A ceramic teapot with a curved handle.");
  assert.equal(unknown.spec.deliverables[0].quantity.kind, "unknown");
  assert.equal(compileOutputPlan([unknown.spec], options).targets.length, 0);
  const ranged = parse("Create 2–4 3D models of a ceramic teapot.");
  const deliverable = ranged.spec.deliverables[0];
  assert.deepEqual(deliverable.quantity, { kind: "range", unit: "model", min: 2, max: 4 });
  const plan = compileOutputPlan([ranged.spec], { ...options, count_policies: { [`${deliverable.id}:model`]: { kind: "exact", unit: "model", value: 3 } } });
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.targets.length, 3);
  assert.ok(plan.targets.every(target => !target.blocking_issues.length));
  deliverable.quantity.unit = "image";
  assert.ok(inspectOutputRequirement(ranged.spec).issues.some(issue => issue.code === "media_quantity_unit_mismatch"));
  assert.equal(outputMediaQuantityUnit("model3d"), "model");
});

test("3D transport windows are exact bounded policies; arbitrary longer windows are not admitted", () => {
  assert.equal(readOutputNativeExecutionPolicy(OUTPUT_NATIVE_EXECUTION_POLICY), OUTPUT_NATIVE_EXECUTION_POLICY);
  assert.equal(readOutputNativeExecutionPolicy({ ...OUTPUT_MODEL3D_EXECUTION_POLICY }), OUTPUT_MODEL3D_EXECUTION_POLICY);
  assert.equal(readOutputNativeExecutionPolicy({ ...OUTPUT_MODEL3D_EXECUTION_POLICY, maximumMilliseconds: 900001 }), null);
  assert.equal(readOutputNativeExecutionPolicy({ ...OUTPUT_MODEL3D_EXECUTION_POLICY, maximumRenewals: 15 }), null);
});

test("3D output authoring, exact prompt disclosure and availability messages exist in every locale", () => {
  for (const locale of ["en", "fr", "ar", "ja"]) {
    assert.ok(FORMA_OUTPUT_REQUIREMENT_MESSAGES[locale]["output.requirement.media.model3d"]);
    assert.ok(FORMA_OUTPUT_REQUIREMENT_MESSAGES[locale]["output.requirement.unit.model"]);
    assert.ok(FORMA_OUTPUT_DELIVERY_MESSAGES[locale]["output.delivery.model3dExactPrompt"]);
    assert.ok(FORMA_OUTPUT_DELIVERY_MESSAGES[locale][`output.delivery.${outputDeliveryLabelKey("unit", "model")}`]);
    for (const code of ["output_native_model3d_ready", "output_native_model3d_unconfigured", "output_native_model3d_contract_unsupported", "output_transfer_model3d_after_authorization", "output_native_model3d_reference_unavailable", "model3d_reference_count", "model3d_prompt_too_long", "model3d_prompt_required", "invalid_glb_model", "output_model3d_visual_review_required"]) {
      const descriptor = outputDeliveryMessageDescriptor(code, { promptCharacters: 1025, maximumCharacters: 1024 });
      assert.equal(descriptor.known, true, code);
      assert.ok(FORMA_OUTPUT_DELIVERY_MESSAGES[locale][descriptor.id]);
    }
  }
});
