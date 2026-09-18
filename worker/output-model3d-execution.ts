/** Shared pure comparisons; only this Worker's original-source/grant hooks may
 * use them for execution. A parsed envelope is never authority by itself. */
export { readOutputModel3dPayload, requireModel3dMiniAppCostApproval, verifyModel3dPreparedReceipt,
  assertModel3dPreparedAttempt, qualifyOutputModel3dCompletion } from "../src/model/model3d-mini-app-execution.ts";
export type { OutputModel3dPayload } from "../src/model/model3d-mini-app-execution.ts";
