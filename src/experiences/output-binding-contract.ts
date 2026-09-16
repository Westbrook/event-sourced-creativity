import type { Model3dMiniAppCostPreview } from "../model/model3d-mini-app-consent.ts";
export type ExperienceModel3dCostApproval = Model3dMiniAppCostPreview & Readonly<{ confirmed: true; providerTransferConfirmed: true }>;
import type { OutputGrantRow, OutputPreflight } from "../model/output-delivery-contract.ts";
import type { SceneMiniAppCostPreview, SceneMiniAppCostApproval } from "../model/scene-mini-app-consent.ts";
import type { AudioMiniAppCostPreview } from "../model/audio-mini-app-consent.ts";
export type ExperienceAudioCostApproval = AudioMiniAppCostPreview & Readonly<{ confirmed: true; providerTransferConfirmed: true }>;
/** Transport only. IDs and dispositions are server evidence, never client authorization. */
export type ExperienceNativeStage = "save" | "confirm" | "preflight" | "authorize" | "run";
export type ExperienceNativePreflight = OutputPreflight;
export type ExperienceNativeOriginal = {
  authorization: { key: string; eventId: string };
  run: { key: string; eventId: string } | null;
  grantId: string; grantStatus: string; slotId: string; slotStatus: string; jobId: string; jobStatus: string;
  targetId: string; targetContractDigest: string; routeDigest: string; planRevisionId: string;
  sourceDigest: string; requirementsDigest: string; expiresAt: string; correlationId: string; jobExpiresAt: string;
};
export type ExperienceNativeState = {
  version: 1; draftId: string; draftHash: string; releaseHash: string; documentId: string; projectId: string;
  output: "image" | "slides" | "short_story" | "scene" | "storyboard" | "audio" | "video" | "model3d"; sourceSurface: "outputs";
  /** Scene-only original disclosure; omission on other outputs preserves their wire shape. */
  sceneCostPreview?: SceneMiniAppCostPreview | null;
  sceneRenewal?: { predecessorPreflightId: string; expiredAt: string };
  slidesRenewal?: { predecessorPreflightId: string; expiredAt: string };
  audioRenewal?: { predecessorPreflightId: string; expiredAt: string };
  storyboardRenewal?: { predecessorPreflightId: string; expiredAt: string };
  videoRenewal?: { predecessorPreflightId: string; expiredAt: string };
  model3dRenewal?: { predecessorPreflightId: string; expiredAt: string };
  /** Audio-only original cost and source-transfer disclosure. */
  audioCostPreview?: AudioMiniAppCostPreview | null;
  model3dCostPreview?: Model3dMiniAppCostPreview | null;
  model3dReplacement?: { cycleId: string; previousSlotId: string; previousJobId: string;
    priorHeldMicrousd: 400000; newMaximumMicrousd: 400000; cumulativeMaximumMicrousd: 800000 };
  status: "absent" | "preparing" | "review" | "authorized" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "partial" | "uncertain" | "unavailable";
  recovery?: "pending" | "completed";
  disposition: "never_admitted" | "prepared" | "original_authorized" | "original_run_recorded";
  /** Changed source is read-only, completed original Image evidence, never a fresh plan. */
  current: { custody: "verified"; source: "verified" | "changed"; sourceDigest: string; requirementsDigest: string };
  stage: ExperienceNativeStage | null;
  plan: { revisionId: string; targetId: string; targetContractDigest: string; sourceDigest: string; requirementsDigest: string } | null;
  preflight: ExperienceNativePreflight | null;
  grant: OutputGrantRow | null;
  original: ExperienceNativeOriginal | null;
  permitted: { prepare: boolean; authorize: boolean; run: boolean; resumeRun: boolean; recoverResult?: boolean; renewPreparation?: boolean; prepareReplacement?: boolean };
};
export type ExperienceNativeUnavailable = {
  version: 1; status: "unavailable"; error: string; originalIntent: "unknown_or_retained";
  permitted: { prepare: false; authorize: false; run: false; resumeRun: false; recoverResult?: false; renewPreparation?: false; prepareReplacement?: false };
};
export type ExperienceNativePrepareRequest = { draftHash: string; explicitRequirementsConfirmation: true };
export type ExperienceNativeAuthorizeRequest = { draftHash: string; termsDigest: string; maximumMicrousd: number; explicitAuthorization: true; sceneCostConsent?: SceneMiniAppCostApproval; audioCostConsent?: ExperienceAudioCostApproval; model3dCostConsent?: ExperienceModel3dCostApproval };
export type ExperienceNativeRunRequest = { draftHash: string; grantId: string; explicitRun: true };

// GET /api/experiences/drafts/:id/output: passive exact original-intent lookup.
// POST .../output/prepare: deliberate recipe confirmation, no financial authorization.
// POST .../output/authorize: exact shown terms/ceiling and deliberate spending consent.
// POST .../output/run: deliberate first run or explicitly permitted original-run
// resume. A resume retains the same command envelope, grant, slot and job.
// GET/reload never dispatches; unavailable is never equivalent to absent.

// POST .../output/recover-result: explicit original accepted-result GET/publication.
// No paid Run command, new slot/job, provider POST or automatic GET dispatch.
