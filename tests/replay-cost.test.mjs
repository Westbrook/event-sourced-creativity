import assert from "node:assert/strict";
import test from "node:test";
import { OPENAI_IMAGE_GENERATION_CONTRACT } from "../worker/openai-image-route-contract.ts";
import { selectImageAdapter } from "../worker/image-adapter-selection.ts";
import { estimateOpenAITextCallMaximumMicrousd, priceCurrentOpenAITextUsage, readOpenAITextUsage } from "../worker/openai-text-cost.ts";
import { LIVE_REPLAY_COST_CONTINGENCY, estimateLiveReplayCost, priceImageUsageBreakdownMicrousd, priceImageUsageMicrousd, priceTextUsageBreakdownMicrousd, priceTextUsageMicrousd, replayGenerationProfile } from "../worker/replay-cost.ts";

test("replay estimate model agrees with generation default and respects explicit overrides",()=>{
  assert.equal(estimateLiveReplayCost({}).imageModel,OPENAI_IMAGE_GENERATION_CONTRACT.defaults.model);
  assert.equal(estimateLiveReplayCost({}).imageModel,selectImageAdapter({}).model);
  for(const imageModel of ["gpt-image-2","gpt-image-2.5-sunburst"]){
    const env={OPENAI_IMAGE_MODEL:imageModel};
    assert.equal(estimateLiveReplayCost(env).imageModel,imageModel);
    assert.equal(estimateLiveReplayCost(env).imageModel,selectImageAdapter(env).model);
  }
});

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


test("new text receipts price cache reads and writes separately without double-counting reasoning",()=>{
  const usage=readOpenAITextUsage({input_tokens:12_000,output_tokens:2_000,total_tokens:14_000,input_tokens_details:{cached_tokens:2_000,cache_write_tokens:5_000},output_tokens_details:{reasoning_tokens:1_500}});
  const terra=priceCurrentOpenAITextUsage("gpt-5.6-terra",usage);
  assert.equal(terra.textInputMicrousd,22_900);
  assert.equal(terra.textOutputMicrousd,24_000);
  assert.equal(terra.totalMicrousd,46_900);
  assert.equal(terra.usage.reasoningTokens,1_500);
  const sol=priceCurrentOpenAITextUsage("gpt-5.6-sol",{...usage,inputTokens:14_000,outputTokens:2_500,totalTokens:16_500,cachedInputTokens:3_000,cacheWriteTokens:6_000});
  assert.equal(sol.totalMicrousd,101_200);
  assert.equal(terra.totalMicrousd+sol.totalMicrousd,148_100);
  assert.equal(sol.ratesNanousdPerToken.input,4_000);
  assert.equal(sol.ratesNanousdPerToken.output,20_000);
  // Historical conservative pricing stays independent until its callers migrate explicitly.
  assert.equal(priceTextUsageMicrousd("gpt-5.6-sol",{inputTokens:1_000,outputTokens:500,totalTokens:1_500}),20_000);
});

test("missing or inconsistent token evidence is not converted to zero-dollar settlement",()=>{
  const raw={input_tokens:1_000,output_tokens:500,total_tokens:1_500,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}};
  assert.equal(readOpenAITextUsage(raw).reasoningTokens,null);
  assert.throws(()=>readOpenAITextUsage({...raw,input_tokens_details:{cached_tokens:0}}),{code:"openai_text_usage_details_missing"});
  for(const patch of [
    {input_tokens:-1},{output_tokens:1.5},{total_tokens:1_400},
    {input_tokens_details:{cached_tokens:700,cache_write_tokens:400}},
    {input_tokens_details:{cached_tokens:"0",cache_write_tokens:0}},
    {output_tokens_details:{reasoning_tokens:501}},
  ])assert.throws(()=>readOpenAITextUsage({...raw,...patch}),{code:"openai_text_usage_invalid"});
  const usage=readOpenAITextUsage(raw);
  assert.throws(()=>priceCurrentOpenAITextUsage("unknown-model",usage),{code:"openai_text_model_price_unknown"});
  assert.throws(()=>priceCurrentOpenAITextUsage("gpt-5.6-sol",usage,"fast"),{code:"openai_text_service_tier_unpriced"});
});

test("reasoning-aware request ceilings allow worst-case cache writes and the exact long-context threshold",()=>{
  assert.equal(estimateOpenAITextCallMaximumMicrousd("gpt-5.6-terra",64_000,25_000),460_000);
  assert.equal(estimateOpenAITextCallMaximumMicrousd("gpt-5.6-sol",64_000,25_000),820_000);
  const usage={inputTokens:272_000,outputTokens:1,totalTokens:272_001,cachedInputTokens:0,cacheWriteTokens:272_000,reasoningTokens:null};
  const short=priceCurrentOpenAITextUsage("gpt-5.6-sol",usage);
  const long=priceCurrentOpenAITextUsage("gpt-5.6-sol",{...usage,inputTokens:272_001,totalTokens:272_002,cacheWriteTokens:272_001});
  assert.equal(short.contextBand,"short");
  assert.equal(short.totalMicrousd,1_360_020);
  assert.equal(long.contextBand,"long");
  assert.equal(long.totalMicrousd,2_720_040);
  assert.throws(()=>estimateOpenAITextCallMaximumMicrousd("gpt-5.6-sol",64_000,128_001),{code:"openai_text_request_limit_invalid"});
  assert.throws(()=>estimateOpenAITextCallMaximumMicrousd("gpt-5.6-sol",1_040_000,25_000),{code:"openai_text_request_limit_invalid"});
  // Integer tariff arithmetic rounds once per input/output subtotal, not once per token.
  assert.equal(priceCurrentOpenAITextUsage("gpt-5.6-luna",{inputTokens:115,outputTokens:0,totalTokens:115,cachedInputTokens:0,cacheWriteTokens:0,reasoningTokens:null}).totalMicrousd,23);
});


test("explicit no-cache policy derives only absent cache counters and records the cost basis",()=>{
  const raw={input_tokens:1_000,output_tokens:500,total_tokens:1_500};
  const policy={cachePolicy:"disabled-explicit"};
  assert.throws(()=>readOpenAITextUsage(raw),{code:"openai_text_usage_details_missing"});
  const usage=readOpenAITextUsage(raw,policy);
  assert.equal(usage.cachedInputTokens,0);assert.equal(usage.cacheWriteTokens,0);
  assert.equal(usage.reasoningTokens,null,"missing reasoning detail is never inferred as zero");
  const receipt=priceCurrentOpenAITextUsage("gpt-5.6-terra",usage);
  assert.equal(receipt.totalMicrousd,8_000);
  assert.equal(receipt.costBasis,"measured_usage_request_policy_published_tariff");
  assert.deepEqual(receipt.requestPolicy,{cachePolicy:"disabled-explicit",promptCacheMode:"explicit",explicitBreakpoints:0});
  assert.deepEqual(receipt.derivedUsageFields,["cachedInputTokens","cacheWriteTokens"]);
  assert.equal(receipt.usage.accountingEvidence,undefined,"request evidence remains separate from normalized counters");
  const partial=priceCurrentOpenAITextUsage("gpt-5.6-sol",readOpenAITextUsage({...raw,input_tokens_details:{cached_tokens:0}},policy));
  assert.deepEqual(partial.derivedUsageFields,["cacheWriteTokens"]);
  const complete=priceCurrentOpenAITextUsage("gpt-5.6-terra",readOpenAITextUsage({...raw,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}},policy));
  assert.equal(complete.costBasis,"measured_usage_published_tariff");
  assert.deepEqual(complete.derivedUsageFields,[]);
  assert.equal(complete.requestPolicy.cachePolicy,"disabled-explicit");
  const ordinary=priceCurrentOpenAITextUsage("gpt-5.6-terra",readOpenAITextUsage({...raw,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}}));
  assert.equal(ordinary.requestPolicy,null);
  assert.throws(()=>priceCurrentOpenAITextUsage("gpt-5.6-terra",{...usage,cachedInputTokens:1}),{code:"openai_text_usage_request_policy_conflict"});
});

test("explicit no-cache policy rejects present malformed or conflicting cache evidence",()=>{
  const raw={input_tokens:1_000,output_tokens:500,total_tokens:1_500};
  const policy={cachePolicy:"disabled-explicit"};
  for(const details of [null,[],"unknown",{cached_tokens:undefined},{cache_write_tokens:undefined},{cached_tokens:"0"},{cache_write_tokens:null},{cached_tokens:-1},{cache_write_tokens:0.5}]){
    assert.throws(()=>readOpenAITextUsage({...raw,input_tokens_details:details},policy),{code:"openai_text_usage_invalid"});
  }
  for(const details of [{cached_tokens:1},{cache_write_tokens:1},{cached_tokens:0,cache_write_tokens:1}]){
    assert.throws(()=>readOpenAITextUsage({...raw,input_tokens_details:details},policy),{code:"openai_text_usage_request_policy_conflict"});
  }
  for(const patch of [{input_tokens:undefined},{output_tokens:undefined},{total_tokens:undefined},{total_tokens:1_400}]){
    assert.throws(()=>readOpenAITextUsage({...raw,...patch},policy),{code:"openai_text_usage_invalid"});
  }
  assert.throws(()=>readOpenAITextUsage(raw,{cachePolicy:"implicit"}),{code:"openai_text_request_policy_invalid"});
});
