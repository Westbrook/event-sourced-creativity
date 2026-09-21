import { memoryDigest } from "./scoped-memory.ts";
export type MemoryDerivationPurpose = "rolling-summary" | "profile" | "suggestion";

export const MEMORY_DERIVATION_POLICY = "personal-memory-derivation-v1";
export const MEMORY_DERIVATION_CONTROL = "memory-derivation-control-v1";
export const MEMORY_DERIVATION_PURPOSES = ["rolling-summary", "profile", "suggestion"] as const;
export type MemoryDerivationTerms = Readonly<{
  version: "memory-derivation-terms-v1"; purpose: MemoryDerivationPurpose;
  recipeVersion: "memory-derivation-candidates-v1" | "memory-derivation-candidates-v2" | "memory-profile-consolidation-v1"; provider: "openai"; model: string;
  pricing: Readonly<{ inputMicroUsdPerMillion: number; cachedInputMicroUsdPerMillion: number; outputMicroUsdPerMillion: number }>;
  maximumInputTokens: number; maximumOutputTokens: number; monthlyCapMicroUsd: number;
  payer: "self-ai-allowance"; providerStore: false; retentionPolicyId: string; providerRetentionDisclosure: string;
  evidence: Readonly<Record<"modelAccess" | "pricing" | "retention" | "tokenBounds" | "nativeAccounting" | "failureRecovery" | "privacy" | "benchmark" | "capApproval", string>>;
}>;
export type MemoryDerivationQualification = Readonly<{
  qualification_id: string; source_sha256: string; origin: string; deployment_id: string; terms_json: string; terms_sha256: string;
  status: "qualified" | "withdrawn"; qualified_at: string; expires_at: string;
}>;
export const DERIVATION_QUALIFICATION_COLUMNS = ["qualification_id", "source_sha256", "origin", "deployment_id", "terms_json", "terms_sha256", "status", "qualified_at", "expires_at"] as const;
export const DERIVATION_EVIDENCE = ["modelAccess", "pricing", "retention", "tokenBounds", "nativeAccounting", "failureRecovery", "privacy", "benchmark", "capApproval"] as const;
type Row = Record<string, unknown>;
export const derivationId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  && value.trim() === value && value.isWellFormed() && !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
export const derivationConsentId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
export const derivationHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
export const derivationTime = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const derivationInteger = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
export const derivationObject = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function derivationExact(value: unknown, keys: readonly string[]): value is Row {
  return derivationObject(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor?.enumerable && Object.hasOwn(descriptor, "value");
  });
}
export function derivationCanonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(derivationCanonical).join(",") + "]";
  if (derivationObject(value)) return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + derivationCanonical(value[key])).join(",") + "}";
  throw new Error("memory-derivation-value-invalid");
}
/** Validates a data-only, immutable operator terms snapshot; no authority is granted. */
export function parseMemoryDerivationTerms(terms: unknown): MemoryDerivationTerms | null {
  try {
    if (!derivationExact(terms, ["version", "purpose", "recipeVersion", "provider", "model", "pricing", "maximumInputTokens", "maximumOutputTokens", "monthlyCapMicroUsd", "payer", "providerStore", "retentionPolicyId", "providerRetentionDisclosure", "evidence"])
      || terms.version !== "memory-derivation-terms-v1" || !MEMORY_DERIVATION_PURPOSES.some(purpose => purpose === terms.purpose)
      || !(["memory-derivation-candidates-v1","memory-derivation-candidates-v2","memory-profile-consolidation-v1"] as unknown[]).includes(terms.recipeVersion) || terms.recipeVersion === "memory-profile-consolidation-v1" && terms.purpose !== "profile" || terms.provider !== "openai" || !derivationId(terms.model)
      || !derivationExact(terms.pricing, ["inputMicroUsdPerMillion", "cachedInputMicroUsdPerMillion", "outputMicroUsdPerMillion"])
      || !derivationInteger(terms.pricing.inputMicroUsdPerMillion, 1, 1_000_000_000)
      || !derivationInteger(terms.pricing.cachedInputMicroUsdPerMillion, 0, terms.pricing.inputMicroUsdPerMillion)
      || !derivationInteger(terms.pricing.outputMicroUsdPerMillion, 1, 1_000_000_000)
      || !derivationInteger(terms.maximumInputTokens, 1, 131072) || !derivationInteger(terms.maximumOutputTokens, 1, 8192)
      || !derivationInteger(terms.monthlyCapMicroUsd, 1, 1_000_000_000) || terms.payer !== "self-ai-allowance"
      || terms.providerStore !== false || !derivationId(terms.retentionPolicyId)
      || typeof terms.providerRetentionDisclosure !== "string" || !terms.providerRetentionDisclosure.trim()
      || !terms.providerRetentionDisclosure.isWellFormed() || new TextEncoder().encode(terms.providerRetentionDisclosure).byteLength > 2048
      || Array.from(terms.providerRetentionDisclosure).some(character => {
        const code = character.charCodeAt(0); return code < 32 && !["\t", "\n", "\r"].includes(character) || code === 127;
      })
      || !derivationExact(terms.evidence, DERIVATION_EVIDENCE) || !Object.values(terms.evidence).every(derivationHash)
) return null;
    const accepted = structuredClone(terms) as unknown as MemoryDerivationTerms;
    if (memoryDerivationMaximumMicroUsd(accepted) === null) return null;
    Object.freeze(accepted.pricing); Object.freeze(accepted.evidence); return Object.freeze(accepted);
  } catch { return null; }
}

/** A qualification is an operator-reviewed receipt, not a browser preference.
 * This parser never creates a receipt, assumes a price, or chooses a monthly cap.
 * The exact canonical bytes reject duplicate/unknown JSON keys and repricing.
 * Native callers must also prove the unchanged qualified row and reviewed build. */
export async function parseMemoryDerivationQualification(value: unknown, binding: Readonly<{ sourceSha256: string; origin: string; deploymentId: string }>, now = new Date().toISOString()): Promise<Readonly<{ row: MemoryDerivationQualification; terms: MemoryDerivationTerms }> | null> {
  try {
    if (!derivationExact(binding, ["sourceSha256", "origin", "deploymentId"])) return null;
    const { sourceSha256, origin, deploymentId } = binding, location = new URL(origin);
    if (!derivationExact(value, DERIVATION_QUALIFICATION_COLUMNS) || !derivationHash(sourceSha256)
      || location.protocol !== "https:" || location.origin !== origin || !derivationId(deploymentId)
      || !derivationId(value.qualification_id) || value.source_sha256 !== sourceSha256 || value.status !== "qualified"
      || value.origin !== origin || value.deployment_id !== deploymentId
      || !derivationHash(value.terms_sha256) || typeof value.terms_json !== "string" || value.terms_json.length > 8192
      || !value.terms_json.isWellFormed() || new TextEncoder().encode(value.terms_json).byteLength > 8192
      || !derivationTime(now) || !derivationTime(value.qualified_at) || !derivationTime(value.expires_at)
      || value.qualified_at > now || value.expires_at <= now || value.qualified_at >= value.expires_at) return null;
    const row = { ...value } as unknown as MemoryDerivationQualification;
    const terms: unknown = JSON.parse(row.terms_json);
    const accepted = parseMemoryDerivationTerms(terms);
    if (!accepted      || derivationCanonical(terms) !== row.terms_json || await memoryDigest(row.terms_json) !== row.terms_sha256
      || Date.now() < Date.parse(row.qualified_at) || Date.now() >= Date.parse(row.expires_at)) return null;
    // Defensive own snapshots: mutating an input during hashing cannot retarget
    // the immutable accepted terms to a different row, purpose or price.
    if (!derivationExact(value, DERIVATION_QUALIFICATION_COLUMNS)
      || DERIVATION_QUALIFICATION_COLUMNS.some(key => value[key] !== row[key])
      || !derivationExact(binding, ["sourceSha256", "origin", "deploymentId"])
      || binding.sourceSha256 !== sourceSha256 || binding.origin !== origin || binding.deploymentId !== deploymentId) return null;
    Object.freeze(row);
    return Object.freeze({ row, terms: accepted });
  } catch { return null; }
}

/** Conservative per-call ceiling, computed without floating point prices.
 * Uncertain dispatch still consumes a hold; a model response is not a refund. */
export function memoryDerivationMaximumMicroUsd(terms: MemoryDerivationTerms): number | null {
  try {
  const input = BigInt(terms.maximumInputTokens) * BigInt(terms.pricing.inputMicroUsdPerMillion),
    output = BigInt(terms.maximumOutputTokens) * BigInt(terms.pricing.outputMicroUsdPerMillion),
    maximum = (input + output + 999999n) / 1000000n;
  return maximum > 0n && maximum <= BigInt(terms.monthlyCapMicroUsd) && maximum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(maximum) : null;
  } catch { return null; }
}

export type MemoryDerivationFinanceView = Readonly<{period:string;checkedAt:string;capMicroUsd:number|null;usedMicroUsd:number;reservedMicroUsd:number;
  remainingMicroUsd:number|null;retention:'independent-of-memory-erasure'}>;
