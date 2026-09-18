import { outputDatabaseFailureKind } from "./output-database-diagnostic.ts";
import { outputProofCapacityDiagnostic } from "./output-proof-capacity-diagnostic.ts";

const stages = new WeakMap<object, "heartbeat_first" | "heartbeat_later">();
/** Keep the original error identity and its classification untouched. */
export function recordOutputJobHeartbeatFailure(error: unknown, first: boolean): void {
  if (error !== null && typeof error === "object" && !stages.has(error)) stages.set(error, first ? "heartbeat_first" : "heartbeat_later");
}
/** Server log only. No fields are added to job receipts or API responses. */
export function logOutputJobFailure(error: unknown): void {
  try {
    const stage = error !== null && typeof error === "object" ? stages.get(error) ?? "execution" : "execution";
    const code = error !== null && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined;
    const capacity = outputProofCapacityDiagnostic(error);
    console.warn("output_native_execution_stopped", {
      stage, kind: code === "output_execution_authority_unverified" ? "authority_unverified" : outputDatabaseFailureKind(error) ?? "unknown",
      ...(capacity ? { capacity } : {}),
    });
  } catch { /* Optional logging cannot change job completion or accounting. */ }
}
