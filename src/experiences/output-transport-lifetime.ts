import { OUTPUT_NATIVE_EXECUTION_POLICY, OUTPUT_MODEL3D_EXECUTION_POLICY, OUTPUT_VIDEO_EXECUTION_POLICY } from "../model/output-execution-policy.ts";

export type ExperienceForegroundOperation = Readonly<{ action: string; output: string }>;
export const EXPERIENCE_BODY_TIMEOUT_MS = 20_000;
/** Waiting for an already authorized job grants no extra provider time, calls,
 * source access or spend. Server execution/authority deadlines remain unchanged. */
export function experienceResponseTimeout(operation?: ExperienceForegroundOperation) {
  // Preparation performs save, confirm and preflight with fresh custody reads.
  // This is one explicit intent, not automatic continuation or paid execution.
  if (operation?.action === "prepare" || operation?.action === "renewPreparation") return 120_000;
  // Video admission rereads the retained image, rights and quote before its
  // atomic grant. Account-sized custody reads can exceed the old 20s client
  // cutoff. This only waits for that explicit request; server expiry, source
  // proofs, consent and budgets remain unchanged, with no automatic retry/run.
  if (operation?.action === "authorize" && operation.output === "video") return 120_000;
  if (operation?.action === "recoverResult") return 120_000 + 60_000;
  if (operation?.action !== "run" && operation?.action !== "resumeRun") return 20_000;
  const policy = operation.output === "model3d" ? OUTPUT_MODEL3D_EXECUTION_POLICY
    : operation.output === "video" ? OUTPUT_VIDEO_EXECUTION_POLICY : OUTPUT_NATIVE_EXECUTION_POLICY;
  return policy.maximumMilliseconds + 60_000;
}
export function experienceHostTimeout(operation?: ExperienceForegroundOperation) {
  // Image inspection composes source refresh, original-job validation, the
  // bounded server image read, and a final committed-stream refresh. This is
  // presentation waiting only: individual requests and authority still expire
  // independently, and navigation/privacy withdrawal remains immediate.
  if(operation?.action==='inspectResult'&&operation.output==='image')return 90_000;
  const response = experienceResponseTimeout(operation);
  // Include one bounded body read and the existing post-command refresh window.
  return response === 20_000 ? 30_000 : response + EXPERIENCE_BODY_TIMEOUT_MS + 30_000;
}
