import { GENERATION_OUTCOME_SCHEMA, type AccountingState, type GenerationOutcomeEvidence } from "../src/model/generation-outcome-evidence.ts";

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export type PlannerResponseProblem = "refused" | "incomplete" | "failed" | "invalid_envelope" | null;

/** Responses envelope interpretation only. No artifact acceptance, model alias
 * resolution, usage pricing, custody authority, dispatch or retry decision.
 * Call only on a received envelope; missing status remains legacy-compatible.
 * Native callers still enforce their stricter completion/identity contracts.
 */
export function inspectPlannerResponseOutcome(value: unknown, accountingState: AccountingState = "unknown") {
  const body = record(value);
  const output = Array.isArray(body?.output) ? body.output : [];
  const refusal = output.some(value => {
    const item = record(value);
    return item?.type === "refusal" || Array.isArray(item?.content) && item.content.some(value => record(value)?.type === "refusal");
  });
  const reason = record(body?.incomplete_details)?.reason;
  const error = record(body?.error);
  // Exact documented structured signals only. Model differences, prose and
  // arbitrary nested fields must never be promoted to a safety refusal.
  const refused = refusal || reason === "content_filter" || error?.code === "content_filter";
  const problem: PlannerResponseProblem = !body ? "invalid_envelope" : refused ? "refused"
    : body.error != null || body.status === "failed" ? "failed"
    : body.incomplete_details != null || body.status != null && body.status !== "completed" ? "incomplete" : null;
  const outcome: GenerationOutcomeEvidence = {
    schemaVersion: GENERATION_OUTCOME_SCHEMA,
    pipelineStage: "planner", providerModerationStage: "unknown",
    failureKind: problem === "refused" ? "safety" : problem === "incomplete" ? "incomplete" : problem === "failed" ? "provider" : problem ? "validation" : null,
    correctiveActionScope: problem === "refused" ? "request" : problem ? "provider" : "unknown",
    contentOutcome: problem === "refused" ? "refused" : problem === "incomplete" || problem === "invalid_envelope" ? "invalid" : "unknown",
    dispatchState: "response_received", accountingState,
  };
  return { problem, outcome };
}
