/** Log-only fixed labels attached by server code to the original error object.
 * No SQL, source bytes, sizes, identifiers, or wire-authority fields are retained. */
const reasons = [
  "scene_history_limit_config", "scene_history_reads", "scene_history_sql_bytes",
  "scene_history_bindings", "scene_history_binding_bytes", "scene_history_assertions",
  "scene_history_proof_bytes", "scene_history_rows", "scene_history_raw_bytes",
  "private_source_raw_bytes", "private_source_binding_bytes",
  "output_assertion_sql_bytes", "output_assertion_bindings", "output_assertion_binding_bytes",
] as const;
export type OutputProofCapacityReason = typeof reasons[number];
const allowed = new Set<string>(reasons);
const diagnostics = new WeakMap<object, OutputProofCapacityReason>();
export function recordOutputProofCapacity<T extends Error>(error: T, reason: OutputProofCapacityReason): T {
  if (allowed.has(reason)) diagnostics.set(error, reason);
  return error;
}
export function outputProofCapacityDiagnostic(error: unknown): OutputProofCapacityReason | undefined {
  return typeof error === "object" && error !== null ? diagnostics.get(error) : undefined;
}
