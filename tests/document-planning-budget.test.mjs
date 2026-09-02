import assert from "node:assert/strict";
import test from "node:test";
import { estimateOpenAITextCallMaximumMicrousd } from "../worker/openai-text-cost.ts";
import { manualPresentationMaximumOutputTokens } from "../src/model/presentation-count-policy.ts";
import { resolvePresentationModelRoutes, selectPresentationModelRoute } from "../worker/presentation-model-routing.ts";
import { documentPlanningTokenReservation, documentRenderTokenReservation, presentationTokenReservation } from "../src/model/generation-budget.ts";

test("all document forms reuse the bounded planning allowance without consuming media reserves",()=>{
  assert.equal(documentPlanningTokenReservation(),128_000);
  assert.equal(presentationTokenReservation(),128_000);
  for(const kind of ["short_story","scene","slides","audio"])assert.equal(documentRenderTokenReservation(kind),128_000);
  assert.equal(documentRenderTokenReservation("storyboard",8),320_000);
  assert.equal(documentRenderTokenReservation("video",8),152_000);
  assert.equal(documentPlanningTokenReservation(8),256_000);
  assert.equal(documentRenderTokenReservation("storyboard",16,8),640_000);
});


test("slideshow routing leaves default and routine-work settings unchanged while separating editorial choices",()=>{
  const defaults=resolvePresentationModelRoutes({});
  for(const route of Object.values(defaults)){
    assert.equal(route.model,"gpt-5.6-terra");
    assert.equal(route.reasoningEffort,"low");
    assert.equal(route.cachePolicy,"disabled-explicit");
  }
  const env={OPENAI_MODEL:"gpt-5.6-terra",OPENAI_SLIDES_COMPOSITION_MODEL:"gpt-5.6-sol",OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:"medium",OPENAI_SLIDES_REPAIR_REASONING_EFFORT:"high"};
  const routes=resolvePresentationModelRoutes(env);
  assert.equal(routes.composition.model,"gpt-5.6-sol");
  assert.equal(routes.composition.reasoningEffort,"medium");
  assert.equal(routes.repair.model,"gpt-5.6-terra");
  assert.equal(routes.repair.reasoningEffort,"high");
  assert.equal(env.OPENAI_MODEL,"gpt-5.6-terra");
  assert.equal(selectPresentationModelRoute(routes,"composition"),routes.composition);
  for(const phase of ["validation-repair","editorial-rewrite","editorial-validation-repair"])assert.equal(selectPresentationModelRoute(routes,phase),routes.repair);
  env.OPENAI_SLIDES_COMPOSITION_MODEL="gpt-5.6-terra";
  assert.equal(routes.composition.model,"gpt-5.6-sol");
  assert.throws(()=>{routes.repair.model="gpt-5.6-sol";},TypeError);
});

test("all slideshow workflow settings are validated before a composition can be admitted",()=>{
  for(const env of [
    {OPENAI_SLIDES_REPAIR_MODEL:"unknown-model"},
    {OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:"ultra"},
    {OPENAI_SLIDES_REPAIR_REASONING_EFFORT:""},
    {OPENAI_MODEL:"gpt-5.6-luna"},
  ])assert.throws(()=>resolvePresentationModelRoutes(env),{code:"presentation_model_configuration_invalid"});
  const legacy=resolvePresentationModelRoutes({OPENAI_MODEL:"gpt-5.6-sol"});
  assert.equal(legacy.composition.model,"gpt-5.6-sol");
  assert.equal(legacy.repair.model,"gpt-5.6-sol");
  const explicit=resolvePresentationModelRoutes({OPENAI_MODEL:"gpt-5.6-luna",OPENAI_SLIDES_COMPOSITION_MODEL:"gpt-5.6-terra",OPENAI_SLIDES_REPAIR_MODEL:"gpt-5.6-terra"});
  assert.equal(explicit.composition.model,"gpt-5.6-terra");
  assert.equal(explicit.repair.model,"gpt-5.6-terra");
});


test("frozen mixed-model slideshow allowances use each route's rate without changing the six-slide output cap",()=>{
  const env={OPENAI_MODEL:"gpt-5.6-terra",OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:"medium",OPENAI_SLIDES_REPAIR_MODEL:"gpt-5.6-sol",OPENAI_SLIDES_REPAIR_REASONING_EFFORT:"high"};
  const frozen=resolvePresentationModelRoutes(env),outputCap=manualPresentationMaximumOutputTokens(undefined,6);
  assert.equal(outputCap,6_500);
  const maximum=phase=>estimateOpenAITextCallMaximumMicrousd(selectPresentationModelRoute(frozen,phase).model,64_000,outputCap);
  assert.deepEqual([maximum("composition"),maximum("validation-repair")],[238_000,450_000]);
  assert.equal(maximum("composition")+maximum("validation-repair"),688_000);
  assert.equal(maximum("editorial-rewrite"),450_000);assert.equal(maximum("editorial-validation-repair"),450_000);
  env.OPENAI_SLIDES_REPAIR_MODEL="gpt-5.6-terra";env.OPENAI_SLIDES_REPAIR_REASONING_EFFORT="low";
  assert.equal(maximum("validation-repair"),450_000,"a changed environment does not reduce an already accepted Sol repair allowance");
  const next=resolvePresentationModelRoutes(env);
  assert.equal(estimateOpenAITextCallMaximumMicrousd(next.repair.model,64_000,outputCap),238_000,"only a new request uses the changed rate");
});
