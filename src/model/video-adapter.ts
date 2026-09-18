import type { ContextAdapterContract } from "./context-adaptation.ts";

export const VIDEO_DURATION_SECONDS=[4,5,6,7,8,9,10,11,12,13,14,15] as const;
export type VideoDurationSeconds=typeof VIDEO_DURATION_SECONDS[number];
export const VIDEO_AUDIO_MODES=["silent","original_ambient"] as const;
export type VideoAudioMode=typeof VIDEO_AUDIO_MODES[number];

export const isVideoDurationSeconds=(value:unknown):value is VideoDurationSeconds=>typeof value==="number"&&VIDEO_DURATION_SECONDS.includes(value as VideoDurationSeconds);
export const normalizeVideoDurationSeconds=(value:unknown,fallback:VideoDurationSeconds=4):VideoDurationSeconds=>{const parsed=typeof value==="string"&&value.trim()?Number(value):value;return isVideoDurationSeconds(parsed)?parsed:fallback;};
export const isVideoAudioMode=(value:unknown):value is VideoAudioMode=>typeof value==="string"&&VIDEO_AUDIO_MODES.includes(value as VideoAudioMode);
export const normalizeVideoAudioMode=(value:unknown):VideoAudioMode=>isVideoAudioMode(value)?value:"silent";

export const VIDEO_ADAPTER_CONTRACT={
  adapterId:"fal-seedance-reference",
  adapterVersion:"2.0.0",
  provider:"fal",
  model:"bytedance/seedance-2.0/reference-to-video",
  output:"video" as const,
  label:"Seedance 2.0 reference-to-video",
  promptProfile:"positive-only" as const,
  promptAdapterId:"video-production-director",
  promptAdapterVersion:"1.1.0",
  maxPromptCharacters:20_000,
  targetPromptCharacters:10_000,
  maxReferenceImages:9,
  maxReferenceAudioClips:3,
  maxReferenceAudioDurationSeconds:15,
  maxReferenceAudioBytes:15*1024*1024,
  supportedReferenceAudioMimeTypes:["audio/mpeg","audio/mp3","audio/wav","audio/x-wav","audio/wave"] as const,
  maxReferenceBytes:30*1024*1024,
  supportedReferenceMimeTypes:["image/png","image/jpeg","image/webp"] as const,
  supportedFrameSizes:["1280x720","720x1280"] as const,
  supportedResolutions:["480p","720p"] as const,
  supportedDurations:VIDEO_DURATION_SECONDS,
  supportedAudioModes:VIDEO_AUDIO_MODES,
  defaultAudioMode:"silent" as const,
  audioRiskPolicy:"explicit-original-nonmelodic-diegetic-ambience-only" as const,
  referenceUploadConcurrency:3,
  defaultDuration:4 as VideoDurationSeconds,
  defaultResolution:"720p" as const,
  publishedCostPerSecondMicrousd:{"480p":134_505,"720p":302_400} as const,
  evaluatedResolution:"480p" as const,
  capabilities:["video-generation","context-snapshot","versioned-prompt-adaptation","bounded-prompt","ordered-storyboard-beats","reference-pixel-input","multiple-image-input","reference-mode-isolation","explicit-original-ambient-audio","explicit-rights-cleared-audio-reference","silent-by-default","durable-provider-receipt"] as const,
  status:"adopted" as const,
  adoptedAt:"2026-08-21",
} satisfies ContextAdapterContract & Record<string, unknown>;

export const DEFAULT_VIDEO_MODEL="bytedance/seedance-2.0/text-to-video";
export const DEFAULT_REFERENCE_VIDEO_MODEL=VIDEO_ADAPTER_CONTRACT.model;

/** Older installations configured both slots with the reference endpoint. Match
 * new requests to actual media; explicit models (including recovery) stay pinned. */
export function selectVideoModel(env:{FAL_VIDEO_MODEL?:string;FAL_REFERENCE_VIDEO_MODEL?:string},referenceCount:number,providerModel?:string):string {
  if(providerModel)return providerModel;
  if(referenceCount)return env.FAL_REFERENCE_VIDEO_MODEL??DEFAULT_REFERENCE_VIDEO_MODEL;
  const model=env.FAL_VIDEO_MODEL??DEFAULT_VIDEO_MODEL;
  return model===DEFAULT_REFERENCE_VIDEO_MODEL?DEFAULT_VIDEO_MODEL:model;
}
