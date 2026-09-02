/** Transport lifetime is separate from provider billing and the grant expiry. */
export const OUTPUT_NATIVE_EXECUTION_POLICY = Object.freeze({
  maximumMilliseconds: 240_000,
  heartbeatMilliseconds: 60_000,
  maximumRenewals: 3,
});

/** An offered contract must match the bounded native transport policy exactly. */
export function readOutputNativeExecutionPolicy(value:unknown):typeof OUTPUT_NATIVE_EXECUTION_POLICY|null {
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const candidate=value as Record<string,unknown>;
  return candidate.maximumMilliseconds===OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds
    &&candidate.heartbeatMilliseconds===OUTPUT_NATIVE_EXECUTION_POLICY.heartbeatMilliseconds
    &&candidate.maximumRenewals===OUTPUT_NATIVE_EXECUTION_POLICY.maximumRenewals
    ?OUTPUT_NATIVE_EXECUTION_POLICY:null;
}
