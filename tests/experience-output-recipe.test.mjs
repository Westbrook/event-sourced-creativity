import assert from "node:assert/strict";
import test from "node:test";
import { createExperienceOutputRecipe, matchExperienceOutputRecipeTarget } from "../worker/experience-output-recipe.ts";

// Synthetic schema-1 plan fixtures only. No canonical compiler, model graph,
// provider, native job, financial record, database or browser is executed here.
const scope = { documentId: "document-1", sourceRevision: "source-1", requirementRevision: "requirements-1" };
const recipeInput = output => ({ output, requirementId: "requirement-1", deliverableId: "deliverable-1",
  ...(output === "image" ? { variantId: "variant-1", aspectRatio: { width: 1, height: 1 } } : {}) });
const recipeFor = output => createExperienceOutputRecipe(recipeInput(output));
function planFor(output) {
  const slides = output === "slides", unit = slides ? "presentation" : "image", label = slides ? "Slides" : "Image";
  const obligationId = slides ? "deliverable-1" : "variant-1", variantId = slides ? null : "variant-1";
  const targetLabel = slides ? "Slides" : "Image 1:1", targetId = `${obligationId}:target:1`;
  return {
    schema_version: 1, document_id: "document-1", source_revision: "source-1", requirement_revision: "requirements-1",
    groups: [{ id: "deliverable-1", requirement_id: "requirement-1", label, media_kind: output,
      required: true, obligation_ids: [obligationId] }],
    obligations: [{ id: obligationId, requirement_id: "requirement-1", deliverable_id: "deliverable-1",
      variant_id: variantId, member_id: null, label: targetLabel, media_kind: output, required: true, selected: true,
      quantity: { kind: "exact", unit, value: 1 }, quantity_policy: { kind: "exact", unit, value: 1 },
      target_ids: [targetId], resolution: "resolved" }],
    targets: [{ id: targetId, requirement_id: "requirement-1", deliverable_id: "deliverable-1",
      obligation_id: obligationId, variant_id: variantId, member_id: null, label: targetLabel, media_kind: output,
      required: true, selected: true, ordinal: 1, quantity: { kind: "exact", unit, value: 1 },
      aspect_ratio: slides ? null : { width: 1, height: 1 }, source_scope: { kind: "document" }, coverage: { kind: slides ? "document_outline" : "document_context" },
      content_quantity: slides ? { kind: "exact", unit: "slide", value: 5 } : null,
      count_policy: slides ? { kind: "exact", unit: "slide", value: 5 } : null,
      suggested_count: null, instruction_text: slides ? "5 slides" : "1 image\n1:1",
      source_revision: "source-1", requirement_revision: "requirements-1", blocking_issues: [] }],
    unresolved_groups: [], issues: [],
  };
}

test("Slides maps one presentation containing five slides, not five files", () => {
  const recipe = recipeFor("slides");
  assert.equal(recipe.spec.deliverables.length, 1);
  assert.deepEqual(recipe.spec.deliverables[0].quantity, { kind: "exact", unit: "presentation", value: 1 });
  assert.deepEqual(recipe.spec.deliverables[0].content_quantity, { kind: "exact", unit: "slide", value: 5 });
  assert.equal(recipe.nativeReadiness, "eligible_for_existing_preflight");
});

test("Image maps the explicitly authored ratio to exactly one image variant", () => {
  const aspectRatio = { width: 16, height: 9 };
  const recipe = createExperienceOutputRecipe({ ...recipeInput("image"), aspectRatio });
  assert.deepEqual(recipe.spec.deliverables[0].quantity, { kind: "exact", unit: "image", value: 1 });
  const variants = recipe.spec.deliverables[0].format_variants;
  assert.equal(variants.length, 1);
  assert.deepEqual(variants[0].aspect_ratio, { width: 16, height: 9 });
  assert.deepEqual(variants[0].value_origins.aspect_ratio, { kind: "authored", text: "16:9" });
  assert.equal(recipe.targetId, "variant-1:target:1");
  aspectRatio.width = 1;
  assert.equal(variants[0].aspect_ratio.width, 16);
  assert.equal(recipe.spec.deliverables[0].content_quantity, undefined);
  assert.equal(recipe.nativeReadiness, "eligible_for_existing_preflight");
});

test("Image requires a registered explicit ratio and distinct stable variant identity", () => {
  for (const input of [
    { output: "image", requirementId: "requirement-1", deliverableId: "deliverable-1" },
    { ...recipeInput("image"), aspectRatio: null },
    { ...recipeInput("image"), aspectRatio: "1:1" },
    { ...recipeInput("image"), aspectRatio: { width: 32, height: 18 } },
    { ...recipeInput("image"), aspectRatio: { width: 1, height: 1, extra: true } },
    { ...recipeInput("image"), variantId: "deliverable-1" },
    { ...recipeInput("image"), variantId: "requirement-1" },
    { ...recipeInput("image"), variantId: "" },
    { ...recipeInput("image"), referencePixels: true },
  ]) assert.throws(() => createExperienceOutputRecipe(input), /experience_output_recipe_invalid/u);
});

test("recipe metadata records interpretation but never author review, spending or acceptance", () => {
  for (const output of ["image", "slides"]) {
    const recipe = recipeFor(output);
    assert.deepEqual(recipe.spec.value_origins.interpretation_basis, { kind: "interpreted", text: recipe.spec.original_text });
    const origins = [...Object.values(recipe.spec.value_origins), ...Object.values(recipe.spec.deliverables[0].value_origins)];
    assert.ok(origins.every(origin => origin.kind === "interpreted"));
    assert.ok(!/confirmed|authorized|accepted|maximumMicrousd|provider/u.test(JSON.stringify(recipe)));
    assert.throws(() => { recipe.spec.deliverables[0].quantity.value = 5; }, TypeError);
  }
});

test("unsupported output kinds and unsafe or aliased requirement identities fail closed", () => {
  for (const input of [null, { output: "video", requirementId: "a", deliverableId: "b" },
    { output: "image", requirementId: "a", deliverableId: "a" },
    { output: "slides", requirementId: " a", deliverableId: "b" },
    { output: "image", requirementId: "a".repeat(149), deliverableId: "b" },
    { output: "image", requirementId: "a", deliverableId: "a/b" },
    { output: "image", requirementId: "a", deliverableId: "b", aspectRatio: { width: 1, height: 1 } },
    { output: "image", requirementId: "a", deliverableId: "b", referencePixels: true }]) {
    assert.throws(() => createExperienceOutputRecipe(input), /experience_output_recipe_invalid/u);
  }
});

for (const output of ["image", "slides"]) {
  test(`${output}: matcher returns the existing exact target without creating an authority record`, () => {
    const plan = planFor(output);
    assert.equal(matchExperienceOutputRecipeTarget(recipeFor(output), plan, scope), plan.targets[0]);
  });
}

test("matcher rejects altered source, scope, instruction and target identity", () => {
  const mutations = [
    p => { p.document_id = "another-document"; },
    p => { p.source_revision = "source-2"; },
    p => { p.requirement_revision = "requirements-2"; },
    p => { p.targets[0].source_revision = "source-2"; },
    p => { p.targets[0].requirement_revision = "requirements-2"; },
    p => { p.targets[0].source_scope = { kind: "blocks", block_ids: ["one-block"] }; },
    p => { p.targets[0].instruction_text = "5 slides; omit source"; },
    p => { p.targets[0].coverage = { kind: "document_context" }; },
    p => { p.targets[0].requirement_id = "another-requirement"; },
    p => { p.targets[0].id = "another-target"; },
    p => { p.targets[0].ordinal = 2; },
  ];
  for (const mutate of mutations) {
    const plan = planFor("slides"); mutate(plan);
    assert.equal(matchExperienceOutputRecipeTarget(recipeFor("slides"), plan, scope), null);
  }
});

test("matcher rejects five presentations, flexible counts and extra or unselected work", () => {
  const mutations = [
    p => { p.targets[0].quantity.value = 5; },
    p => { p.obligations[0].quantity.value = 5; },
    p => { p.targets[0].quantity.unit = "slide"; },
    p => { p.targets[0].content_quantity.value = 6; },
    p => { p.targets[0].count_policy = { kind: "flexible", unit: "slide", min: 4, max: 6 }; },
    p => { p.targets[0].suggested_count = 5; },
    p => { p.targets.push(structuredClone(p.targets[0])); },
    p => { p.targets[0].selected = false; },
    p => { p.targets[0].required = false; },
    p => { p.targets[0].blocking_issues.push({ code: "blocked", path: "", message: "" }); },
    p => { p.obligations[0].resolution = "unresolved"; },
    p => { p.unresolved_groups.push({ id: "extra" }); },
    p => { p.issues.push({ code: "blocked" }); },
  ];
  for (const mutate of mutations) {
    const plan = planFor("slides"); mutate(plan);
    assert.equal(matchExperienceOutputRecipeTarget(recipeFor("slides"), plan, scope), null);
  }
});

test("Image matcher refuses altered aspect ratio, variant identity or reference source", () => {
  for (const mutate of [p => { p.targets[0].aspect_ratio = { width: 16, height: 9 }; },
    p => { p.targets[0].aspect_ratio = null; },
    p => { p.targets[0].id = "deliverable-1:target:1"; },
    p => { p.targets[0].obligation_id = "deliverable-1"; },
    p => { p.targets[0].source_scope.referencePixelMode = "enabled"; },
    p => { p.targets[0].variant_id = "unapproved-format"; }]) {
    const plan = planFor("image"); mutate(plan);
    assert.equal(matchExperienceOutputRecipeTarget(recipeFor("image"), plan, scope), null);
  }
});

test("malformed, expanded or stale plan envelopes cannot match", () => {
  for (const plan of [null, [], {}, { ...planFor("slides"), extra: true },
    { ...planFor("slides"), schema_version: 2 }]) {
    assert.equal(matchExperienceOutputRecipeTarget(recipeFor("slides"), plan, scope), null);
  }
  assert.equal(matchExperienceOutputRecipeTarget(recipeFor("slides"), planFor("slides"), { ...scope, sourceRevision: "" }), null);
});
