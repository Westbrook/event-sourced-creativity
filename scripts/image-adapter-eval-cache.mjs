import { createHash } from "node:crypto";

/** Frozen candidate cycles reuse their paid Image 2 baseline, independent of
 * today's default model. Invalid evidence must stop the cycle, never buy a
 * replacement while reporting the baseline as free/reused. */
export function retainedCandidateBaseline(receipt, { caseId, canonicalPromptHash, providerPromptHash, bytes }) {
  if (receipt?.status !== "completed" || receipt.provider !== "openai" || receipt.model !== "gpt-image-2"
    || receipt.adapterId !== "openai-image" || receipt.adapterVersion !== "v5"
    || receipt.canonicalPromptHash !== canonicalPromptHash || receipt.providerPromptHash !== providerPromptHash
    || receipt.contentHash !== createHash("sha256").update(bytes).digest("hex")) {
    throw new Error(`candidate_baseline_invalid:${caseId}`);
  }
  return { ...receipt, baselineReused: true, newImageCostMicrousd: 0 };
}

/** Older failed attempts did not record a model. Keep their explicit retry gate
 * when adapter and prompt match; completed pixels always require model identity. */
export function imageAdapterCacheMatches(receipt, expected) {
  return Boolean(receipt && receipt.adapterId === expected.adapterId && receipt.adapterVersion === expected.adapterVersion
    && receipt.canonicalPromptHash === expected.canonicalPromptHash && receipt.providerPromptHash === expected.providerPromptHash
    && (receipt.model === expected.model || receipt.status === "failed" && !Object.hasOwn(receipt, "model")));
}
