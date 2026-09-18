/** Server-only, fixed-category diagnosis. Never retains source, SQL or IDs. */
const reasons = ['input', 'deadline', 'batch_shape', 'guard_false', 'guard_schema', 'guard_generation', 'guard_caller_proof', 'guard_owner_head', 'guard_deadline', 'metadata', 'hydration', 'consumer', 'proof_shape', 'proof_false'] as const;
export type SceneReadFailureReason = typeof reasons[number];
const allowed = new Set<string>(reasons);
const diagnostics = new WeakMap<object, SceneReadFailureReason>();
export function recordSceneReadFailure<T extends Error>(error: T, reason: SceneReadFailureReason): T {
  if (allowed.has(reason)) diagnostics.set(error, reason);
  return error;
}
export function sceneReadFailureDiagnostic(error: unknown): SceneReadFailureReason | undefined {
  return typeof error === 'object' && error !== null ? diagnostics.get(error) : undefined;
}
