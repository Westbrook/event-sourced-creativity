import assert from "node:assert/strict";
import test from "node:test";
import {consentedTextPricing,assertConsentedTextPricing,maximumConsentedTextMicrousd,priceConsentedTextUsageMicrousd} from "../src/model/consented-text-pricing.ts";
for(const[model,plain,cached,written]of[["gpt-5.6-luna",440,260,490],["gpt-5.6-terra",4400,2600,4900],["gpt-5.6-sol",8000,4400,9000]])test("consented text pricing retains exact standard/cache rates: "+model,()=>{
  const snapshot=consentedTextPricing(model),usage={inputTokens:1000,outputTokens:200,totalTokens:1200};
  assert.doesNotThrow(()=>assertConsentedTextPricing(structuredClone(snapshot),model));
  assert.equal(priceConsentedTextUsageMicrousd(snapshot,usage),plain);
  assert.equal(priceConsentedTextUsageMicrousd(snapshot,{...usage,cachedInputTokens:1000}),cached);
  assert.equal(priceConsentedTextUsageMicrousd(snapshot,{...usage,cacheWriteInputTokens:1000}),written);
  assert.equal(maximumConsentedTextMicrousd(snapshot,1000,200),written);
  const changed=consentedTextPricing(model);changed.short.input=999;assert.notEqual(snapshot.short.input,changed.short.input);
  assert.throws(()=>assertConsentedTextPricing(changed,model),/pricing_receipt_invalid/u);
});
test("consented text pricing switches the full request to its retained long-context rates",()=>{
  const snapshot=consentedTextPricing("gpt-5.6-terra"),inputTokens=272001,outputTokens=100,totalTokens=inputTokens+outputTokens;
  assert.equal(priceConsentedTextUsageMicrousd(snapshot,{inputTokens,outputTokens,totalTokens}),272001*4+100*18);
  assert.equal(maximumConsentedTextMicrousd(snapshot,inputTokens,outputTokens),272001*5+100*18);
  assert.equal(priceConsentedTextUsageMicrousd(snapshot,{inputTokens:272000,outputTokens,totalTokens:272100}),272000*2+100*12);
});
test("consented text pricing rejects malformed usage, partitions, tiers, models and snapshots",()=>{
  const snapshot=consentedTextPricing("gpt-5.6-terra"),usage={inputTokens:1000,outputTokens:200,totalTokens:1200};
  for(const patch of[{inputTokens:"1000"},{inputTokens:0},{outputTokens:-1},{totalTokens:1199},{cachedInputTokens:null},{cachedInputTokens:1001},{cacheWriteInputTokens:1.2},{cachedInputTokens:600,cacheWriteInputTokens:401},{inputTokens:NaN},{inputTokens:Infinity}])assert.throws(()=>priceConsentedTextUsageMicrousd(snapshot,{...usage,...patch}),/usage_unverified/u);
  for(const patch of[{version:"future"},{model:"gpt-5.6-sol"},{serviceTier:"priority"},{shortContextLimit:99999},{extra:true},{short:{...snapshot.short,input:2.5}}])assert.throws(()=>assertConsentedTextPricing({...snapshot,...patch},"gpt-5.6-terra"),/pricing_receipt_invalid/u);
  assert.throws(()=>consentedTextPricing("unknown"),/pricing_unavailable/u);
});
