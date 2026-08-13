import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_REPLAY_COST_CONTINGENCY, estimateLiveReplayCost, priceImageUsageMicrousd, priceTextUsageMicrousd } from "../worker/replay-cost.ts";

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
