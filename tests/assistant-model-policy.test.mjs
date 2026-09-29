import assert from "node:assert/strict";
import test from "node:test";
import { ASSISTANT_MODELS, assistantModelCostMicrousd, selectAssistantModel } from "../src/model/assistant-model-policy.ts";

const policy = { allowedModels: ASSISTANT_MODELS, remainingMicrousd: 1_000_000, premiumApproved: false };

test("routes cheap coordination to Luna and normal creative reasoning to Terra", () => {
  assert.equal(selectAssistantModel("intake", policy).model, "gpt-5.6-luna");
  assert.equal(selectAssistantModel("page-guidance", policy).model, "gpt-5.6-luna");
  assert.equal(selectAssistantModel("context-projection", policy).model, "gpt-5.6-luna");
  assert.equal(selectAssistantModel("proposal", policy).model, "gpt-5.6-terra");
  assert.equal(selectAssistantModel("creative-authoring", policy).model, "gpt-5.6-terra");
});

test("Sol escalation remains blocked until explicitly approved and affordable", () => {
  assert.equal(selectAssistantModel("governance-review", policy).reason, "premium-approval-required");
  const authorized = selectAssistantModel("governance-review", { ...policy, premiumApproved: true });
  assert.equal(authorized.model, "gpt-5.6-sol");
  assert.equal(authorized.blocked, false);
  assert.equal(selectAssistantModel("governance-review", { ...policy, premiumApproved: true, remainingMicrousd: 99 }).reason, "budget-exceeded");
});

test("fails closed for unknown models and non-allowlisted browser hints", () => {
  assert.equal(selectAssistantModel("intake", { ...policy, requestedModel: "untrusted-model" }).reason, "unknown-model");
  assert.equal(selectAssistantModel("proposal", { ...policy, allowedModels: ["gpt-5.6-luna"] }).reason, "model-not-allowed");
  assert.equal(selectAssistantModel("governance-review", { ...policy, requestedModel: "gpt-5.6-luna" }).reason, "task-model-insufficient");
});

test("reserves exact Luna, Terra, and Sol list prices for a 12,000-token conversation", () => {
  assert.equal(assistantModelCostMicrousd("gpt-5.6-luna", 10_400, 1_600), 4_000);
  assert.equal(assistantModelCostMicrousd("gpt-5.6-terra", 10_400, 1_600), 40_000);
  assert.equal(assistantModelCostMicrousd("gpt-5.6-sol", 10_400, 1_600), 100_000);
});

test("reserves input and output charges independently so small Luna requests never understate spend", () => {
  assert.equal(assistantModelCostMicrousd("gpt-5.6-luna", 1, 1), 3);
  assert.equal(assistantModelCostMicrousd("gpt-5.6-luna", 0, 1), 2);
  assert.equal(assistantModelCostMicrousd("gpt-5.6-luna", 1, 0), 1);
});
