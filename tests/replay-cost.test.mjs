import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_REPLAY_COST_CONTINGENCY, estimateLiveReplayCost, priceImageUsageBreakdownMicrousd, priceImageUsageMicrousd, priceTextUsageBreakdownMicrousd, priceTextUsageMicrousd, replayGenerationProfile } from "../worker/replay-cost.ts";

test("estimates the exact seven-operation replay workflow in USD",()=>{
  const estimate=estimateLiveReplayCost({OPENAI_MODEL:"gpt-5.6-terra",OPENAI_IMAGE_MODEL:"gpt-image-2"});
  assert.equal(estimate.currency,"USD");
  assert.equal(estimate.pricingVersion,"openai-2026-07-30");
  assert.equal(estimate.operations,7);
  assert.equal(estimate.lines.reduce((sum,line)=>sum+line.operations,0),7);
  assert.deepEqual(estimate.lines.map((line)=>line.key),["planning","reference","preview","fan"]);
  assert.equal(estimate.assumptions.referenceImageInputs,9);
  assert.ok(estimate.estimatedMicrousd>1_000_000&&estimate.estimatedMicrousd<1_400_000);
  assert.equal(estimate.contingencyRate,LIVE_REPLAY_COST_CONTINGENCY);
  assert.equal(estimate.authorizationMicrousd,Math.ceil(estimate.estimatedMicrousd*1.2));
  assert.equal(estimate.profile.targetEventCount,1_000);assert.equal(estimate.profile.requestedCoverage,"automatic");assert.equal(estimate.profile.resolvedCoverage,"minimal");assert.equal(estimate.profile.milestoneCount,1);assert.equal(estimate.profile.imageCount,6);assert.equal(estimate.profile.operations,7);assert.equal(estimate.profile.studyCount,0);assert.equal(estimate.profile.compositionCount,1);assert.deepEqual(estimate.profile.developmentStages.map((stage)=>stage.kind),["composition"]);
});

test("scales event history and paid creative coverage independently",()=>{
  const representativeProfile=replayGenerationProfile(10_000,"automatic");assert.equal(representativeProfile.milestoneCount,2);assert.equal(representativeProfile.imageCount,12);assert.equal(representativeProfile.operations,14);
  const denseProfile=replayGenerationProfile(50_000,"automatic");assert.equal(denseProfile.milestoneCount,3);assert.equal(denseProfile.imageCount,18);assert.equal(denseProfile.operations,21);
  const minimalProfile=replayGenerationProfile(50_000,"minimal");assert.equal(minimalProfile.milestoneCount,1);assert.equal(minimalProfile.imageCount,6);assert.equal(minimalProfile.operations,7);
  const explicitDenseProfile=replayGenerationProfile(1_000,"dense");assert.equal(explicitDenseProfile.milestoneCount,3);assert.equal(explicitDenseProfile.imageCount,18);assert.equal(explicitDenseProfile.operations,21);
  const baseline=estimateLiveReplayCost({OPENAI_MODEL:"gpt-5.6-terra",OPENAI_IMAGE_MODEL:"gpt-image-2"});
  const representative=estimateLiveReplayCost({OPENAI_MODEL:"gpt-5.6-terra",OPENAI_IMAGE_MODEL:"gpt-image-2"},"",{eventCount:10_000,providerCoverage:"automatic"});
  const dense=estimateLiveReplayCost({OPENAI_MODEL:"gpt-5.6-terra",OPENAI_IMAGE_MODEL:"gpt-image-2"},"",{eventCount:50_000,providerCoverage:"automatic"});
  assert.equal(representative.estimatedMicrousd,baseline.estimatedMicrousd*2);assert.equal(representative.operations,14);assert.equal(representative.profile.imageCount,12);
  assert.equal(dense.estimatedMicrousd,baseline.estimatedMicrousd*3);assert.equal(dense.operations,21);assert.equal(dense.profile.imageCount,18);
});

test("prices focused studies before a composition and its locked pixel handoff",()=>{
  const profile=replayGenerationProfile(1_000,"minimal",["character","location","logo","prop"]);
  assert.equal(profile.studyCount,4);assert.equal(profile.compositionCount,1);assert.equal(profile.milestoneCount,5);assert.equal(profile.imageCount,30);assert.equal(profile.operations,35);
  assert.deepEqual(profile.developmentStages.map((stage)=>stage.kind),["character","location","logo","prop","composition"]);
  assert.deepEqual(profile.developmentStages.at(-1).consumesStudies,["character","location","logo","prop"]);
  const estimate=estimateLiveReplayCost({OPENAI_MODEL:"gpt-5.6-terra",OPENAI_IMAGE_MODEL:"gpt-image-2"},"",{eventCount:1_000,providerCoverage:"minimal",studyTypes:["character","location","logo","prop"]});
  assert.equal(estimate.assumptions.referenceImageInputs,61); // 9 per stage + four locked studies across each of four composition fan calls.
  assert.equal(estimate.profile.operations,35);assert.ok(estimate.estimatedMicrousd>estimateLiveReplayCost({OPENAI_MODEL:"gpt-5.6-terra",OPENAI_IMAGE_MODEL:"gpt-image-2"}).estimatedMicrousd*5);
});

test("includes optional seed length and uses current modality-specific rates",()=>{
  const baseline=estimateLiveReplayCost({OPENAI_MODEL:"gpt-5.6-terra",OPENAI_IMAGE_MODEL:"gpt-image-2"});
  const seeded=estimateLiveReplayCost({OPENAI_MODEL:"gpt-5.6-terra",OPENAI_IMAGE_MODEL:"gpt-image-2"},"x".repeat(1200));
  assert.equal(seeded.estimatedMicrousd-baseline.estimatedMicrousd,600);
  assert.equal(priceTextUsageMicrousd("gpt-5.6-terra",{inputTokens:1_000,outputTokens:1_000,totalTokens:2_000}),14_000);
  assert.equal(priceImageUsageMicrousd("gpt-image-2",{inputTokens:3_000,textInputTokens:1_000,imageInputTokens:2_000,outputTokens:5_500,totalTokens:8_500},true),186_000);
});

test("conservatively assigns undifferentiated image-edit input to image tokens",()=>{
  assert.equal(priceImageUsageMicrousd("gpt-image-2",{inputTokens:2_000,outputTokens:196,totalTokens:2_196},true),21_880);
  assert.equal(priceImageUsageMicrousd("gpt-image-2",{inputTokens:2_000,outputTokens:196,totalTokens:2_196},false),15_880);
});

test("retains modality-specific receipt lines for product analytics",()=>{
  const text=priceTextUsageBreakdownMicrousd("gpt-5.6-terra",{inputTokens:1_000,outputTokens:500,totalTokens:1_500});
  assert.deepEqual(text,{textInputMicrousd:2_000,textOutputMicrousd:6_000,imageTextInputMicrousd:0,imageInputMicrousd:0,imageOutputMicrousd:0,totalMicrousd:8_000});
  const image=priceImageUsageBreakdownMicrousd("gpt-image-2",{inputTokens:3_000,textInputTokens:1_000,imageInputTokens:2_000,outputTokens:5_500,totalTokens:8_500},true);
  assert.deepEqual(image,{textInputMicrousd:0,textOutputMicrousd:0,imageTextInputMicrousd:5_000,imageInputMicrousd:16_000,imageOutputMicrousd:165_000,totalMicrousd:186_000});
});
