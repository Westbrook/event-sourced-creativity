import type { ExperienceNativeState, ExperienceNativeUnavailable } from "./output-binding-contract.ts";
import { outputDeliveryMessageDescriptor } from "../components/design-system/locales/output-delivery-runtime-messages.ts";

/** Explain only a saved unavailable preparation. Never substitute a preflight
 * reason for an original execution's outcome or render server-authored prose. */
export function outputAvailabilityMessage(state: ExperienceNativeState) {
  if (state.status !== "unavailable" || state.disposition !== "prepared" || state.original || state.grant
    || state.preflight?.targets.length !== 1 || state.preflight.targets[0]?.available !== false) return null;
  // No reasonValues: unknown codes and incomplete parameterized messages use
  // the registry's safe fallback rather than echoing response content.
  return outputDeliveryMessageDescriptor(state.preflight.targets[0].reasonCode);
}

/** A known source-capacity refusal is not an ambiguous transport failure.
 * This only explains the closed server refusal; it grants no action and makes
 * no assertion about any earlier preparation write or paid request outcome. */
export function outputSourceCapacityMessage(state: ExperienceNativeState | ExperienceNativeUnavailable) {
  if ("draftId" in state || state.status !== "unavailable" || state.originalIntent !== "unknown_or_retained"
    || Object.values(state.permitted).some(Boolean)
    || !["output_source_proof_too_large", "output_source_governance_proof_too_large"].includes(state.error)) return null;
  return outputDeliveryMessageDescriptor(state.error);
}
