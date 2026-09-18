import type { WorkerEnv } from "./runtime.ts";
import { outputProofReadStatements } from "./output-disclosure-proof.ts";
import { OutputConflictError } from "./output-command-core.ts";
import { recordOutputProofCapacity } from "./output-proof-capacity-diagnostic.ts";
import { recordSceneReadFailure } from "./scene-read-diagnostic.ts";
import { captureSceneHistoryProof, SceneHistoryProofError, type SceneHistoryScope } from "./scene-history-proof.ts";

/** Scene-only strict result shape. Never treat omitted success, extra rows or a
 * coercible string as evidence that an original predicate was checked. */
export function assertSceneHistoryRead(results: Array<D1Result<Record<string, unknown>>>, expected: number) {
  if (!Number.isSafeInteger(expected) || expected < 1 || !Array.isArray(results) || results.length !== expected) {
    throw recordSceneReadFailure(new OutputConflictError("output_source_changed_during_read", 409), 'proof_shape');
  }
  for (let index = 0; index < expected; index++) {
    const result = results[index];
    if (!result || result.success !== true || !Array.isArray(result.results)
      || result.results.length !== 1 || ![0,1].includes(result.results[0]?.current as number)) {
      throw recordSceneReadFailure(new OutputConflictError("output_source_changed_during_read", 409), 'proof_shape');
    }
    if(result.results[0]?.current !== 1) throw recordSceneReadFailure(new OutputConflictError("output_source_changed_during_read", 409), 'proof_false');
  }
}

/** Existing bounded read primitives, not a new authority or a write-time grant.
 * The caller MUST preserve the returned original assertions through every final
 * transactional/paid boundary. This helper alone must not activate a route. */
export function readSceneHistoryProof(env: WorkerEnv, scope: SceneHistoryScope) {
  return captureSceneHistoryProof({
    async read(sql, bindings) {
      const result = await env.DB.prepare(sql).bind(...bindings).all<Record<string, unknown>>();
      if (!result || result.success !== true || !Array.isArray(result.results)) throw new SceneHistoryProofError("scene_cost_history_unavailable");
      return result.results;
    },
    async verify(assertions) {
      const results = await env.DB.batch<Record<string, unknown>>(outputProofReadStatements(env, assertions));
      assertSceneHistoryRead(results, assertions.length);
    },
  }, scope).catch((error: unknown) => {
    // Reuse existing safe native codes; an unknown DB/transport failure keeps
    // its original identity and is never described as known source rejection.
    if (error instanceof SceneHistoryProofError) {
      const refusal = new OutputConflictError(error.code === "scene_cost_history_capacity_exceeded"
        ? "output_source_proof_too_large" : "output_source_changed_during_read", error.status);
      if (error.capacityReason) recordOutputProofCapacity(refusal, `scene_history_${error.capacityReason}`);
      throw refusal;
    }
    throw error;
  });
}
