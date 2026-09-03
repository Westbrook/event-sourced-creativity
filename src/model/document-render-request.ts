import type { DocumentJob } from "./document-jobs.ts";
import { isDocumentArtifactKind, SLIDE_STYLE_PRESETS, type DocumentArtifactKind, type SlideStylePresetId } from "./document-artifacts.ts";
import { AUDIO_DESTINATIONS, AUDIO_GENERATION_GOALS, type AudioRequestProfile } from "./audio.ts";
import { isVideoAudioMode, isVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT, type VideoAudioMode, type VideoDurationSeconds } from "./video-adapter.ts";
import { isSceneMedium, type SceneMedium } from "./scene-configuration.ts";
import { documentRenderGuidance } from "./document-render-guidance.ts";
import { MAX_MANAGED_PRESENTATION_SLIDES } from "./managed-production.ts";

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const EDITABLE_KEYS = ["itemCount", "requestedSlideCount", "slideCountPolicy", "productionMode", "audience", "tone", "presentationStyle", "presentationFidelity", "sceneMedium", "videoSeconds", "videoSize", "videoAudioMode", "audioProfile", "audioImageBlockId", "audioVideoArtifactId", "soundtrackBlockIds", "sendSoundtrackToVideoProvider", "sendAudioVideoToProvider"] as const;
/** Actor-private request controls only: no source, provider IDs, grant, reservation, or retry state. */
export function captureDocumentRenderSettings(payload: Record<string, unknown>) {
  return { schema_version: 1, artifact_kind: payload.artifactKind, settings: Object.fromEntries(EDITABLE_KEYS.filter(key => payload[key] !== undefined).map(key => [key, payload[key]])) };
}
export type RestoredDocumentRenderSettings = {
  kind: DocumentArtifactKind; audience: string; tone: string; productionMode: "manual" | "managed";
  itemCount: number | null; presentationStyle: SlideStylePresetId | "document"; presentationFidelity: "faithful" | "creative";
  sceneMedium?: SceneMedium; videoSeconds?: VideoDurationSeconds; videoSize?: "1280x720" | "720x1280"; videoAudioMode?: VideoAudioMode;
  audioProfile?: AudioRequestProfile; audioImageBlockId: string; audioVideoArtifactId: string; soundtrackBlockIds: string[];
  needsTransferConfirmation: boolean;
};
/** Call only with the selected actor-authorized response. Never fall back to another job or current document values. */
export function restoreDocumentRenderSettings(job: DocumentJob, content: Record<string, string>): RestoredDocumentRenderSettings | null {
  if (job.kind !== "render_document" || !isDocumentArtifactKind(job.result?.artifactKind)) return null;
  const kind = job.result.artifactKind;
  // This receipt schema does not capture the exact 3D prompt, settings, or ordered references.
  // Do not claim restoration by substituting unrelated defaults or the current 3D draft.
  if (kind === "model3d") return null;
  const receipt = record(job.result.generationReceipt), reference = receipt?.input_ref;
  if (typeof reference !== "string" || !Object.hasOwn(content, reference)) return null;
  let retained: Record<string, unknown> | null;
  try { retained = record(JSON.parse(content[reference])); } catch { return null; }
  if (!retained || retained.job_id !== job.jobId || retained.document_id !== job.documentId || retained.artifact_kind !== kind) return null;
  const request = record(retained.request), captured = record(request?.editable_settings);
  if (!request) return null;
  let settings = captured?.schema_version === 1 && captured.artifact_kind === kind ? record(captured.settings) : null;
  if (Object.hasOwn(request, "editable_settings") && !settings) return null;
  if (!settings) {
    // Legacy slideshow receipts contain all of their non-media controls. Other legacy formats may omit media/transfer choices.
    if (kind !== "slides" || !Object.hasOwn(request, "audience") || !Object.hasOwn(request, "tone") || !Object.hasOwn(request, "production_mode") || !Object.hasOwn(request, "presentation_style") || !Object.hasOwn(request, "presentation_fidelity")) return null;
    if (request.slide_count_policy && record(request.slide_count_policy)?.kind !== "exact") return null;
    settings = { audience: request.audience, tone: request.tone, productionMode: request.production_mode, itemCount: request.requested_slide_count ?? request.item_count, presentationStyle: request.presentation_style, presentationFidelity: request.presentation_fidelity };
  }
  if (settings.slideCountPolicy !== undefined && record(settings.slideCountPolicy)?.kind !== "exact") return null;
  if (settings.itemCount !== undefined && settings.requestedSlideCount !== undefined && settings.itemCount !== settings.requestedSlideCount) return null;
  const guidance = documentRenderGuidance(settings);
  // An overlong historical value is deliberately restored intact so it can be corrected, never silently truncated.
  if (guidance.issues.some(issue => issue.code === "invalid_type")) return null;
  const productionMode = settings.productionMode ?? "manual";
  if (productionMode !== "manual" && productionMode !== "managed") return null;
  const count = settings.requestedSlideCount ?? settings.itemCount ?? null;
  if (count !== null && (!Number.isSafeInteger(count) || Number(count) < 1 || Number(count) > (productionMode === "manual" && kind === "slides" ? 15 : MAX_MANAGED_PRESENTATION_SLIDES))) return null;
  if (kind === "slides" && count === null) return null;
  const style = settings.presentationStyle ?? "document", fidelity = settings.presentationFidelity ?? "faithful";
  if (style !== "document" && !SLIDE_STYLE_PRESETS.some(preset => preset.id === style) || fidelity !== "faithful" && fidelity !== "creative") return null;
  if (settings.sceneMedium !== undefined && !isSceneMedium(settings.sceneMedium)) return null;
  if (settings.videoSeconds !== undefined && !isVideoDurationSeconds(settings.videoSeconds)) return null;
  if (settings.videoSize !== undefined && !VIDEO_ADAPTER_CONTRACT.supportedFrameSizes.includes(settings.videoSize as "1280x720" | "720x1280")) return null;
  if (settings.videoAudioMode !== undefined && !isVideoAudioMode(settings.videoAudioMode)) return null;
  const profile = record(settings.audioProfile);
  if (kind === "audio" && (!profile || !AUDIO_GENERATION_GOALS.includes(profile.goal as AudioRequestProfile["goal"]) || !AUDIO_DESTINATIONS.includes(profile.destination as AudioRequestProfile["destination"]) || profile.durationSeconds !== undefined && (!Number.isFinite(profile.durationSeconds) || Number(profile.durationSeconds) <= 0) || profile.speakerCount !== undefined && (!Number.isSafeInteger(profile.speakerCount) || Number(profile.speakerCount) < 1))) return null;
  if (["audioImageBlockId", "audioVideoArtifactId"].some(key => settings[key] !== undefined && typeof settings[key] !== "string") || settings.soundtrackBlockIds !== undefined && (!Array.isArray(settings.soundtrackBlockIds) || settings.soundtrackBlockIds.some(value => typeof value !== "string"))) return null;
  return {
    kind, audience: guidance.audience, tone: guidance.tone, productionMode, itemCount: count as number | null,
    presentationStyle: style as SlideStylePresetId | "document", presentationFidelity: fidelity,
    ...(isSceneMedium(settings.sceneMedium) ? { sceneMedium: settings.sceneMedium } : {}),
    ...(isVideoDurationSeconds(settings.videoSeconds) ? { videoSeconds: settings.videoSeconds } : {}),
    ...(settings.videoSize ? { videoSize: settings.videoSize as "1280x720" | "720x1280" } : {}),
    ...(isVideoAudioMode(settings.videoAudioMode) ? { videoAudioMode: settings.videoAudioMode } : {}),
    ...(profile ? { audioProfile: profile as AudioRequestProfile } : {}),
    audioImageBlockId: String(settings.audioImageBlockId ?? ""), audioVideoArtifactId: String(settings.audioVideoArtifactId ?? ""),
    soundtrackBlockIds: Array.isArray(settings.soundtrackBlockIds) ? [...settings.soundtrackBlockIds] as string[] : [],
    needsTransferConfirmation: settings.sendSoundtrackToVideoProvider === true || settings.sendAudioVideoToProvider === true,
  };
}
