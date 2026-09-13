import type { ExperienceNativeState } from "./output-binding-contract.ts";
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
