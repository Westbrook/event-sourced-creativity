/** Transport lifetime is separate from provider billing and the grant expiry. */
export const OUTPUT_NATIVE_EXECUTION_POLICY = Object.freeze({
  maximumMilliseconds: 240_000,
  heartbeatMilliseconds: 60_000,
  maximumRenewals: 3,
});
/** Queued mesh generation needs a longer bounded polling window than images. */
export const OUTPUT_MODEL3D_EXECUTION_POLICY = Object.freeze({
  maximumMilliseconds: 900_000,
  heartbeatMilliseconds: 60_000,
  maximumRenewals: 14,
});
export type OutputNativeExecutionPolicy = typeof OUTPUT_NATIVE_EXECUTION_POLICY | typeof OUTPUT_MODEL3D_EXECUTION_POLICY;

/** An offered contract must match the bounded native transport policy exactly. */
export function readOutputNativeExecutionPolicy(value:unknown):OutputNativeExecutionPolicy|null {
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const candidate=value as Record<string,unknown>;
  return [OUTPUT_NATIVE_EXECUTION_POLICY, OUTPUT_MODEL3D_EXECUTION_POLICY].find(policy =>
    candidate.maximumMilliseconds===policy.maximumMilliseconds
    &&candidate.heartbeatMilliseconds===policy.heartbeatMilliseconds
    &&candidate.maximumRenewals===policy.maximumRenewals) ?? null;
}
