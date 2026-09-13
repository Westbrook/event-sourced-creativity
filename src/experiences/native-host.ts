import type { ExperiencePlan } from "./intake.ts";
import { EXPERIENCE_AUDIO_INTENT } from "./contracts.ts";

/** Canonical intake ACK only. Neither this receipt nor a compiled definition is an execution grant. */
export type ExperienceIntakeReceipt = Readonly<{
  status: "complete"; generation: "unavailable"; projectId: string; documentId: string;
  draftId: string; draftHash: string; documentRoute: string; head: number;
  appended: readonly Readonly<{ eventId: string; sequence: number; type: string; payload: Record<string, unknown> }>[];
  rejected: readonly unknown[];
}>;
export type ExperienceOutputSettings =
  | Readonly<{ output: "storyboard"; kind: "render_document"; productionMode: "manual"; artifactKind: "storyboard"; itemCount: 4 }>
  | Readonly<{ output: "audio"; kind: "render_document"; productionMode: "manual"; artifactKind: "audio"; itemCount: 1; audioProfile: typeof EXPERIENCE_AUDIO_INTENT }>
  | Readonly<{ output: "image"; kind: "generate"; productionMode: "manual"; itemCount: 1 }>
  | Readonly<{ output: "short_story"; kind: "render_document"; productionMode: "manual"; artifactKind: "short_story"; itemCount: 3 }>
  | Readonly<{ output: "scene"; kind: "render_document"; productionMode: "manual"; artifactKind: "scene"; sceneMedium: "visual"; itemCount: 1 }>
  | Readonly<{ output: "slides"; kind: "render_document"; productionMode: "manual"; artifactKind: "slides"; itemCount: 5; requestedSlideCount: 5; slideCountPolicy: Readonly<{ kind: "exact"; unit: "slide"; value: 5 }>; presentationFidelity: "faithful" }>;
export function experienceOutputSettings(plan: ExperiencePlan): ExperienceOutputSettings {
  if (plan.release.output.output === "storyboard") return Object.freeze({ output: "storyboard", kind: "render_document", productionMode: "manual", artifactKind: "storyboard", itemCount: 4 });
  if (plan.release.output.output === "audio") return Object.freeze({ output: "audio", kind: "render_document", productionMode: "manual", artifactKind: "audio", itemCount: 1, audioProfile: EXPERIENCE_AUDIO_INTENT });
  if (plan.release.output.output === "scene") return Object.freeze({ output: "scene", kind: "render_document", productionMode: "manual", artifactKind: "scene", sceneMedium: "visual", itemCount: 1 });
  if (plan.release.output.output === "short_story") return Object.freeze({ output: "short_story", kind: "render_document", productionMode: "manual", artifactKind: "short_story", itemCount: 3 });
  if (plan.release.output.output !== "image" && plan.release.output.output !== "slides") throw new Error("experience_output_unsupported");
  return plan.release.output.output === "image"
    ? Object.freeze({ output: "image", kind: "generate", productionMode: "manual", itemCount: 1 })
    : Object.freeze({ output: "slides", kind: "render_document", productionMode: "manual", artifactKind: "slides", itemCount: 5, requestedSlideCount: 5, slideCountPolicy: Object.freeze({ kind: "exact", unit: "slide", value: 5 }), presentationFidelity: "faithful" });
}
export type ExperienceHostContext = Readonly<{
  plan: ExperiencePlan; receipt: ExperienceIntakeReceipt; settings: ExperienceOutputSettings;
}>;
export type ExperienceNativeHostSession = Readonly<{ dispose(): void }>;
/** Integration seam, NOT an adapter implementation. The canonical host must independently:
 * - revalidate verified principal, canonical source/head, immutable definition and custody;
 * - use native financial admission, original intent/grant/job identity and idempotent recovery;
 * - render only receipt-associated promised output and same-Document Edit in Forma;
 * - retire private content on authority loss, navigation or disposal.
 * Mount must not purchase or generate. Any admission/execution needs an explicit user action
 * in the host's own qualified controls. No global registration/custom event grants authority.
 */
export type ExperienceNativeHostAdapter = Readonly<{
  mount(target: HTMLElement, context: ExperienceHostContext, signal: AbortSignal): Promise<ExperienceNativeHostSession>;
}>;
