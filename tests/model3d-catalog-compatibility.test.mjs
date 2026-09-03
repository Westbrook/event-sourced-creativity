import assert from "node:assert/strict";
import test from "node:test";
import { combinedContextPromptDirectives } from "../src/model/combined-context.ts";
import { buildManagedProductionPlan, productionTeamFor, selectArtifactProductionKind, supportsManagedProduction } from "../src/model/managed-production.ts";
import { productionSystemFor, productionUnitsForPlan } from "../src/model/production-system.ts";
import { productionWorkflowIssues, recommendProductionWorkflow } from "../src/model/production-workflow.ts";
import { generateDocumentArtifact } from "../worker/openai-adapter.ts";

test("3D selection always uses the explicit manual adapter route", () => {
  for (const kind of ["slides", "storyboard", "model3d"]) {
    const selection = selectArtifactProductionKind({ kind, mode: "managed", storyboardManagedDefault: true, storyboardManualOptOut: false }, "model3d");
    assert.deepEqual(selection, { kind: "model3d", mode: "manual", storyboardManagedDefault: false, storyboardManualOptOut: false });
    assert.equal(selectArtifactProductionKind(selection, "model3d"), selection);
  }
});

test("3D models cannot acquire a fictitious managed team, plan, or production unit", () => {
  assert.equal(supportsManagedProduction("model3d"), false);
  assert.equal(supportsManagedProduction("storyboard"), true);
  assert.throws(() => productionTeamFor("model3d"), /managed_production_format_unsupported/);
  assert.throws(() => productionSystemFor("model3d"), /managed_production_format_unsupported/);
  assert.throws(() => buildManagedProductionPlan("model3d", {}), /managed_production_format_unsupported/);
  assert.throws(() => productionUnitsForPlan({ format: "model3d" }), /managed_production_format_unsupported/);
});

test("3D production workflows propose only the explicit final generation", () => {
  const workflow = recommendProductionWorkflow({ id: "model-workflow", documentId: "document", projectId: "project", target: "model3d" });
  assert.deepEqual(productionWorkflowIssues(workflow), []);
  assert.deepEqual(workflow.stages.map(({ format, dependsOn, enabled, final }) => ({ format, dependsOn, enabled, final })), [
    { format: "model3d", dependsOn: [], enabled: true, final: true },
  ]);
});

test("the generic text planner rejects 3D before credentials or provider dispatch", async () => {
  const env = Object.defineProperty({}, "OPENAI_API_KEY", { get() { return assert.fail("3D must not inspect the text provider credentials"); } });
  await assert.rejects(generateDocumentArtifact(env, "owner", "model3d", { documentTitle: "Lantern", snapshot: {} }), /model3d_dedicated_adapter_required/);
});

test("3D context directives preserve the distinction between saved image views and mesh geometry", () => {
  const snapshot = { facts: [{ block_id: "shape", type: "subject", properties: {
    text: "Ceramic lantern",
    combined_context_memberships: [{ context_set_id: "lantern", name: "Lantern", role: "object", target: "Ceramic lantern", application: "isolate", relativity: 1, member_order: 0 }],
  } }] };
  const [direction] = combinedContextPromptDirectives(snapshot, "model3d");
  assert.match(direction, /named 3D subject/);
  assert.match(direction, /Saved model views supply image guidance/);
  assert.match(direction, /do not transfer editable mesh geometry/);
  assert.doesNotMatch(direction, /Reserve one slide|soundscape|dramatic moment/);
});
