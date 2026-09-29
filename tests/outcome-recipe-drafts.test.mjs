import assert from "node:assert/strict";
import test from "node:test";
import { buildOutcomeRecipeDraft, outcomeRecipeFileChoices, OUTCOME_RECIPE_IDS } from "../src/model/outcome-recipes.ts";
import { inspectOutputRequirement, outputRequirementInterpretationNeedsReview } from "../src/model/output-requirements.ts";
import { outcomeRecipeDraftLabels } from "../src/components/design-system/locales/outcome-recipe-draft-messages.ts";
const scope = { projectId: "recipe-project", documentId: "recipe-document", authorizationScopeKey: "actor:project:document" };
const wording = "  Keep the original line exactly.\nنص أصلي — 元の文章。\n";
const input = (recipeId, locale = "en") => ({ scope, expectedRevision: "output:12", sourceRevision: "source-12", requirementRevision: "requirements-12",
  requirementId: "recipe-requirement", recipeId, originalText: wording,
  selectedChoices: outcomeRecipeFileChoices(recipeId).map(choice => choice.key), labels: outcomeRecipeDraftLabels(locale, "Editable requirement") });
for (const locale of ["en", "fr", "ar", "ja"]) for (const recipeId of OUTCOME_RECIPE_IDS) test(`${locale} ${recipeId} is a pure unsaved suggestion, not a format guess or approval`, () => {
  const source = input(recipeId, locale), before = structuredClone(source), draft = buildOutcomeRecipeDraft(source);
  assert.deepEqual(source, before); assert.deepEqual(buildOutcomeRecipeDraft(source), draft);
  assert.equal(inspectOutputRequirement(draft.spec).status, "valid"); assert.equal(draft.spec.original_text, wording);
  assert.equal(outputRequirementInterpretationNeedsReview(draft.spec), true);
  assert.deepEqual(draft.planSuggestions, { countPolicies: {}, suggestedCounts: {} });
  assert.deepEqual(draft.spec.deliverables.map(value => value.id), source.selectedChoices.map(key => source.requirementId + ":" + key));
  for (const value of draft.spec.deliverables) {
    assert.equal(value.quantity.kind, "unknown"); assert.equal(value.source_scope.kind, "unknown"); assert.equal(value.coverage.kind, "unresolved");
    assert.equal(value.original_text, wording); if (value.content_quantity) assert.equal(value.content_quantity.kind, "unknown");
    assert.ok(Object.values(value.value_origins).every(origin => origin.kind === "suggested"));
  }
  assert.equal(draft.spec.value_origins.recipe_template.text, `forma-recipe:${recipeId}@1`);
  assert.equal(Object.hasOwn(draft.spec.value_origins, "interpretation_basis"), false);
});
test("campaign and film never silently add unselected siblings or replace unsupported obligations", () => {
  const campaign = buildOutcomeRecipeDraft({ ...input("campaign"), selectedChoices: ["campaign-audio"] });
  assert.deepEqual(campaign.spec.deliverables.map(value => value.media_kind), ["audio"]);
  const film = buildOutcomeRecipeDraft({ ...input("film-continuity"), selectedChoices: ["script", "composed-film"] });
  assert.deepEqual(film.spec.deliverables.map(value => value.media_kind), ["document", "video"]);
  assert.match(film.spec.deliverables[0].coverage.description, /remains owed/);
  assert.match(film.spec.deliverables[1].coverage.description, /not an assembled final film/);
  for (const selectedChoices of [[], ["deck"], ["campaign-image", "campaign-image"]]) assert.throws(() => buildOutcomeRecipeDraft({ ...input("campaign"), selectedChoices }), /outcome_recipe_draft_invalid/);
});
test("invalid identity and blank prose are refused without silently clipping authored text", () => {
  for (const changes of [{ requirementId: "a".repeat(148) }, { originalText: " \n" }, { expectedRevision: "" }, { scope: { ...scope, authorizationScopeKey: "" } }])
    assert.throws(() => buildOutcomeRecipeDraft({ ...input("executive-deck"), ...changes }), /outcome_recipe_draft_invalid/);
});
