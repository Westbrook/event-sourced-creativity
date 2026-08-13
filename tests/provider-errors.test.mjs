import assert from "node:assert/strict";
import test from "node:test";
import { classifyProviderFailure, providerErrorFromResponse } from "../worker/provider-errors.ts";

test("classifies safety rejections as terminal and preserves provider receipts",()=>{
  const response=new Response(JSON.stringify({error:{message:"Your request was rejected by the safety system.",type:"image_generation_user_error"}}),{status:400,headers:{"x-request-id":"req_safety"}});
  const error=providerErrorFromResponse(response,{error:{message:"Your request was rejected by the safety system.",type:"image_generation_user_error"}},"openai_image_400");
  assert.deepEqual(error.detail,{code:"image_generation_user_error",category:"safety",message:"Your request was rejected by the safety system.",retryable:false,requestId:"req_safety",httpStatus:400});
});

test("distinguishes quota, rate limits, and retryable provider failures",()=>{
  assert.equal(classifyProviderFailure(new Error("insufficient_quota"),new Response(null,{status:429})).category,"quota");
  assert.equal(classifyProviderFailure(new Error("rate_limit_exceeded"),new Response(null,{status:429})).category,"rate_limit");
  assert.equal(classifyProviderFailure(new Error("temporary outage"),new Response(null,{status:503})).retryable,true);
});
