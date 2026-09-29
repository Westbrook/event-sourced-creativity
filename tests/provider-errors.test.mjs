import assert from "node:assert/strict";
import test from "node:test";
import { applicationFailureDetail, classifyProviderFailure, providerErrorFromResponse, providerFailurePrompt, providerRetryAfterMs } from "../worker/provider-errors.ts";
import { providerRetryDelay, shouldAutomaticallyRetryProviderFailure } from "../worker/openai-adapter.ts";

test("classifies safety rejections as terminal and preserves provider receipts",()=>{
  const response=new Response(JSON.stringify({error:{message:"Your request was rejected by the safety system.",type:"image_generation_user_error"}}),{status:400,headers:{"x-request-id":"req_safety"}});
  const error=providerErrorFromResponse(response,{error:{message:"Your request was rejected by the safety system.",type:"image_generation_user_error"}},"openai_image_400");
  assert.deepEqual(error.detail,{code:"image_generation_user_error",category:"safety",scope:"request",action:"edit_request",message:"Your request was rejected by the safety system.",retryable:false,retryAfterMs:null,requestId:"req_safety",httpStatus:400,pipelineStage:"unknown",providerModerationStage:"unknown",providerError:{message:"Your request was rejected by the safety system.",type:"image_generation_user_error"}});
  const promptError=providerErrorFromResponse(response,{error:{message:"Your request was rejected by the safety system.",type:"image_generation_user_error"}},"openai_image_400","Exact submitted prompt");
  assert.equal(providerFailurePrompt(promptError),"Exact submitted prompt");
});

test("distinguishes quota, rate limits, and retryable provider failures",()=>{
  assert.equal(classifyProviderFailure(new Error("insufficient_quota"),new Response(null,{status:429})).category,"quota");
  assert.equal(classifyProviderFailure(new Error("rate_limit_exceeded"),new Response(null,{status:429})).category,"rate_limit");
  assert.equal(classifyProviderFailure(new Error("temporary outage"),new Response(null,{status:503})).retryable,true);
});

test("turns provider prompt-length validation into an actionable request error",()=>{
  const detail=classifyProviderFailure(new Error("provider"),new Response(null,{status:400}),{error:{code:"invalid_value",message:"Invalid 'prompt': string too long. Expected a string with maximum length 32000, but got a string with length 39013 instead."}});
  assert.deepEqual([detail.code,detail.category,detail.scope,detail.action,detail.retryable],["image_prompt_too_long","provider","request","edit_request",false]);
  assert.match(detail.message,/32,000-character limit/);
});

test("turns provider image-cardinality validation into an actionable contract error",()=>{
  const detail=classifyProviderFailure(new Error("provider"),new Response(null,{status:400}),{error:{code:"invalid_value",message:"Number of images (2) exceeds maximum of 1"}});
  assert.deepEqual([detail.code,detail.category,detail.scope,detail.action,detail.retryable],["provider_image_cardinality_exceeded","provider","request","edit_request",false]);
  assert.match(detail.message,/split the images into valid probes/);
});

test("turns project and organization limits into specific non-retryable receipts",()=>{
  const project=classifyProviderFailure(new Error("provider"),new Response(null,{status:429}),{error:{code:"project_spend_limit_exceeded",message:"Project spend limit reached"}});
  const organization=classifyProviderFailure(new Error("provider"),new Response(null,{status:429}),{error:{code:"organization_usage_limit_exceeded",message:"Organization usage limit reached"}});
  const credit=classifyProviderFailure(new Error("provider"),new Response(null,{status:429}),{error:{code:"credit_balance_exhausted",message:"Credit balance exhausted"}});
  assert.deepEqual([project.category,project.scope,project.action,project.retryable],["quota","project","raise_limit",false]);
  assert.deepEqual([organization.category,organization.scope,organization.action,organization.retryable],["quota","organization","raise_limit",false]);
  assert.deepEqual([credit.category,credit.scope,credit.action,credit.retryable],["quota","account","add_credits",false]);
});

test("honors provider backoff hints and only auto-retries safe transient responses",()=>{
  const limited=classifyProviderFailure(new Error("provider"),new Response(null,{status:429,headers:{"retry-after":"3"}}),{error:{code:"rate_limit_exceeded",message:"Images per minute exceeded"}});
  const ambiguousNetwork=classifyProviderFailure(new TypeError("fetch failed"));
  assert.equal(providerRetryAfterMs(new Response(null,{status:429,headers:{"x-ratelimit-reset-requests":"1.5s"}})),1500);
  assert.equal(providerRetryDelay(limited,1),3000);
  assert.equal(shouldAutomaticallyRetryProviderFailure(limited),true);
  assert.equal(shouldAutomaticallyRetryProviderFailure(ambiguousNetwork),false);
});

test("identifies application budget scope before any provider request is made",()=>{
  const user=applicationFailureDetail("budget_hard_cap_reached","user",429);
  const workspace=applicationFailureDetail("budget_hard_cap_reached","workspace",429);
  assert.deepEqual([user.category,user.scope,user.action],["quota","user","review_budget"]);
  assert.deepEqual([workspace.category,workspace.scope,workspace.action],["quota","workspace","review_budget"]);
});
