/** Public routing metadata is a restriction, never permission to execute. */
export type OutputDurablePhase = "queued" | "generating" | "awaiting_provider" | "retaining" | "ready" | "uncertain" | "failed" | "cancel_requested" | "cancelled";
export type OutputDurableObservation = Readonly<{ version: 1; phase: OutputDurablePhase; revision: number }>;

export function hasServerExecutionOwner(job: { executionOwner?: unknown }): boolean {
  return job.executionOwner !== undefined && job.executionOwner !== null && job.executionOwner !== "";
}

export function readOutputDurableObservation(value: unknown): OutputDurableObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const phases: readonly unknown[] = ["queued", "generating", "awaiting_provider", "retaining", "ready", "uncertain", "failed", "cancel_requested", "cancelled"];
  if (Object.keys(row).length !== 3 || row.version !== 1 || !phases.includes(row.phase)
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0) return null;
  return Object.freeze({ version: 1, phase: row.phase as OutputDurablePhase, revision: Number(row.revision) });
}
