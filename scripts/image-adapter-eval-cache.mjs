import { createHash } from "node:crypto";

export const IMAGE_EVAL_IDENTITY_VERSION = "image-eval-request-v2";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const imageAdapterIdentityHash = (identity) => sha256(JSON.stringify(canonical(identity)));

/** The caller resolves the operation, never a UI label such as 'preview'. A model
 * alias is not a pinned snapshot without evidence. References are ordered bytes. */
export function imageAdapterRequestIdentity({ provider, model, endpoint, adapterId, adapterVersion, policyVersion,
  canonicalPrompt, providerPrompt, references = [], settings, promptAdapterVersion = "canonical", modelSnapshot = null }) {
  for (const field of [provider, model, endpoint, adapterId, adapterVersion, policyVersion]) {
    if (typeof field !== "string" || !field) throw new Error("image_eval_identity_incomplete");
  }
  if (typeof canonicalPrompt !== "string" || typeof providerPrompt !== "string" || !settings) throw new Error("image_eval_identity_incomplete");
  const identity = {
    schemaVersion: IMAGE_EVAL_IDENTITY_VERSION, provider, model, endpoint, adapterId, adapterVersion, policyVersion,
    modelSnapshot, aliasResolution: modelSnapshot === null ? "unknown" : "pinned", promptAdapterVersion,
    canonicalPromptHash: sha256(canonicalPrompt), providerPromptHash: sha256(providerPrompt), settings: canonical(settings),
    references: references.map((ref) => ({ sha256: sha256(ref.bytes), byteLength: ref.bytes.byteLength,
      mimeType: ref.mimeType, mode: ref.mode ?? null, source: ref.source ?? null, referenceId: ref.referenceId ?? null,
      blockId: ref.blockId ?? null, label: ref.label ?? null })),
  };
  return { ...identity, identityHash: imageAdapterIdentityHash(identity) };
}

/** Frozen candidate cycles reuse paid Image 2 bytes without rewriting history. */
export function retainedCandidateBaseline(receipt, { caseId, canonicalPromptHash, providerPromptHash, bytes }) {
  if (receipt?.status !== "completed" || receipt.provider !== "openai" || receipt.model !== "gpt-image-2"
    || receipt.adapterId !== "openai-image" || receipt.adapterVersion !== "v5"
    || receipt.canonicalPromptHash !== canonicalPromptHash || receipt.providerPromptHash !== providerPromptHash
    || receipt.contentHash !== sha256(bytes)) throw new Error(`candidate_baseline_invalid:${caseId}`);
  return { ...receipt, baselineReused: true, newImageCostMicrousd: 0 };
}

/** Compatibility predicate only; it is never permission to purchase on false. */
export function imageAdapterCacheMatches(receipt, expected) {
  if (receipt?.identity || expected?.identity) return Boolean(receipt?.identity && expected?.identity
    && imageAdapterIdentityHash(receipt.identity) === imageAdapterIdentityHash(expected.identity));
  return Boolean(receipt && receipt.adapterId === expected.adapterId && receipt.adapterVersion === expected.adapterVersion
    && receipt.canonicalPromptHash === expected.canonicalPromptHash && receipt.providerPromptHash === expected.providerPromptHash
    && (receipt.model === expected.model || receipt.status === "failed" && !Object.hasOwn(receipt, "model")));
}

function unresolvedPurchase(receipt) {
  const statuses = [receipt.status, receipt.dispatchState, receipt.submissionStatus, receipt.providerSubmission?.status,
    receipt.detail?.code, receipt.storyboardProviderSubmission, receipt.generationReceipt?.provider_request_status];
  return statuses.some((value) => ["pending", "submitted", "accepted", "uncertain", "unknown", "submission_unknown", "confirmed", "provider_submission_uncertain"].includes(value))
    || Object.values(receipt.providerSubmissions ?? {}).some((entry) => ["pending", "accepted", "uncertain"].includes(entry.status))
    || receipt.status !== "completed" && !statuses.includes("rejected") && (Boolean(receipt.providerRequestId || receipt.providerJobId)
      || ["network", "server"].includes(receipt.detail?.category));
}

/** No dispatch callback by design. Missing/corrupt evidence is not a cache miss.
 * Old receipts may be inspected, but incomplete identity is never upgraded to
 * proof of current equivalence. Preserve the original receipt byte-for-byte. */
export async function imageAdapterReuseDecision(receipt, expected, { readArtifact } = {}) {
  const stop = (status, reason) => ({ status, reason, providerCalls: 0, newTrialRequired: status === "new_trial_needed", retainedReceipt: receipt ?? null });
  if (!receipt) return stop("new_trial_needed", "no_retained_trial");
  if (unresolvedPurchase(receipt)) return stop("reconciliation_required", "retain_original_request_and_uncertainty");
  if (receipt.status !== "completed") return stop("new_trial_needed", "failure_requires_new_authorized_manifest_trial");
  let bytes;
  try { bytes = await readArtifact(receipt); if (!(bytes instanceof Uint8Array)) throw new Error("invalid_artifact_bytes"); } catch { return stop("new_trial_needed", "retained_artifact_unavailable"); }
  if (!receipt.contentHash || sha256(bytes) !== receipt.contentHash) return stop("new_trial_needed", "retained_artifact_corrupt");
  if (receipt.identity) {
    if (imageAdapterIdentityHash(receipt.identity) !== imageAdapterIdentityHash(expected)) return stop("new_trial_needed", "request_identity_changed");
    // The duplicated human-readable receipt fields must agree too.
    for (const key of ["model", "provider", "adapterId", "adapterVersion", "canonicalPromptHash", "providerPromptHash"])
      if (receipt[key] !== expected[key]) return stop("new_trial_needed", "receipt_identity_conflict");
    return { status: "reused", identityCoverage: "exact", providerCalls: 0, receipt };
  }
  for (const key of ["model", "provider", "adapterId", "adapterVersion", "canonicalPromptHash", "providerPromptHash"])
    if (receipt[key] !== expected[key]) return stop("new_trial_needed", `legacy_${key}_mismatch`);
  for (const key of ["quality", "size", "outputFormat"])
    if (receipt[key] !== undefined && receipt[key] !== expected.settings[key]) return stop("new_trial_needed", `legacy_${key}_mismatch`);
  return { status: "reused", identityCoverage: "historical_partial_only", providerCalls: 0, receipt };
}

/** Useful to the new manifest harness: failure metadata names the dispatched
 * operation. Do not infer today's final model, or clear an uncertain purchase. */
export function imageAdapterFailureReceipt(error, identity, submission = null) {
  return { status: "failed", provider: identity.provider, model: identity.model, identity,
    adapterId: identity.adapterId, adapterVersion: identity.adapterVersion,
    canonicalPromptHash: identity.canonicalPromptHash, providerPromptHash: identity.providerPromptHash,
    endpoint: identity.endpoint, providerSubmission: submission, providerRequestId: submission?.providerRequestId ?? null,
    dispatchState: submission?.status ?? "unknown", name: error?.name ?? "Error", message: String(error?.message ?? error), detail: error?.detail ?? null };
}
