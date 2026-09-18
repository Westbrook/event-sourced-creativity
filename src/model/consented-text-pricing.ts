import type { AssistantModel } from "./assistant-model-policy.ts";

type Rates={input:number;cachedInput:number;cacheWriteInput:number;output:number};
export type ConsentedTextPricing={
  version:"openai-standard-usd-2026-08-27-v1";
  model:AssistantModel;
  serviceTier:"default";
  shortContextLimit:272000;
  short:Rates;
  long:Rates;
};
const prices:Record<AssistantModel,{short:Rates;long:Rates}>={
  "gpt-5.6-luna":{short:{input:.2,cachedInput:.02,cacheWriteInput:.25,output:1.2},long:{input:.4,cachedInput:.04,cacheWriteInput:.5,output:1.8}},
  "gpt-5.6-terra":{short:{input:2,cachedInput:.2,cacheWriteInput:2.5,output:12},long:{input:4,cachedInput:.4,cacheWriteInput:5,output:18}},
  "gpt-5.6-sol":{short:{input:4,cachedInput:.4,cacheWriteInput:5,output:20},long:{input:8,cachedInput:.8,cacheWriteInput:10,output:30}},
};
/** Store this snapshot inside the approved request; never reprice an existing receipt.
 * Standard global-endpoint USD rates verified 2026-08-27:
 * https://developers.openai.com/api/docs/pricing
 * https://developers.openai.com/api/docs/models/gpt-5.6-sol
 */
export function consentedTextPricing(model:AssistantModel):ConsentedTextPricing{
  if(!Object.hasOwn(prices,model))throw new Error("assistant_model_pricing_unavailable");
  const rate=prices[model];
  return{version:"openai-standard-usd-2026-08-27-v1",model,serviceTier:"default",shortContextLimit:272000,short:{...rate.short},long:{...rate.long}};
}
const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
export function assertConsentedTextPricing(value:unknown,model:AssistantModel):asserts value is ConsentedTextPricing{
  const snapshot=object(value),expected=consentedTextPricing(model);
  if(!snapshot||Object.keys(snapshot).sort().join(",")!=="long,model,serviceTier,short,shortContextLimit,version"
    ||snapshot.version!==expected.version||snapshot.model!==model||snapshot.serviceTier!=="default"||snapshot.shortContextLimit!==272000)throw new Error("assistant_pricing_receipt_invalid");
  for(const tier of["short","long"]as const){
    const rate=object(snapshot[tier]);
    if(!rate||Object.keys(rate).sort().join(",")!=="cacheWriteInput,cachedInput,input,output"
      ||(["input","cachedInput","cacheWriteInput","output"]as const).some(key=>rate[key]!==expected[tier][key]))throw new Error("assistant_pricing_receipt_invalid");
  }
}
function count(value:unknown):number{
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0)throw new Error("assistant_provider_usage_unverified");
  return value;
}
function total(value:number):number{
  if(!Number.isSafeInteger(value)||value<0)throw new Error("assistant_provider_usage_unverified");
  return value;
}
/** A ceiling, not a prediction: every possible input token may be a cache write. */
export function maximumConsentedTextMicrousd(snapshot:ConsentedTextPricing,inputTokens:number,outputTokens:number){
  assertConsentedTextPricing(snapshot,snapshot.model);const input=count(inputTokens),output=count(outputTokens),rates=input>snapshot.shortContextLimit?snapshot.long:snapshot.short;
  return total(Math.ceil(input*Math.max(rates.input,rates.cachedInput,rates.cacheWriteInput))+Math.ceil(output*rates.output));
}
export function priceConsentedTextUsageMicrousd(snapshot:ConsentedTextPricing,usage:{
  inputTokens:number;outputTokens:number;totalTokens:number;cachedInputTokens?:number;cacheWriteInputTokens?:number;
}){
  assertConsentedTextPricing(snapshot,snapshot.model);
  const input=count(usage.inputTokens),output=count(usage.outputTokens),tokens=count(usage.totalTokens),
    cached=count(usage.cachedInputTokens===undefined?0:usage.cachedInputTokens),written=count(usage.cacheWriteInputTokens===undefined?0:usage.cacheWriteInputTokens);
  if(input===0||tokens!==input+output||cached+written>input)throw new Error("assistant_provider_usage_unverified");
  const rates=input>snapshot.shortContextLimit?snapshot.long:snapshot.short;
  return total(Math.ceil((input-cached-written)*rates.input)+Math.ceil(cached*rates.cachedInput)+Math.ceil(written*rates.cacheWriteInput)+Math.ceil(output*rates.output));
}
