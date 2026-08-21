export const VIDEO_DURATION_SECONDS=[4,5,6,7,8,9,10,11,12,13,14,15] as const;
export type VideoDurationSeconds=typeof VIDEO_DURATION_SECONDS[number];

export const isVideoDurationSeconds=(value:unknown):value is VideoDurationSeconds=>typeof value==="number"&&VIDEO_DURATION_SECONDS.includes(value as VideoDurationSeconds);
export const normalizeVideoDurationSeconds=(value:unknown,fallback:VideoDurationSeconds=4):VideoDurationSeconds=>{const parsed=typeof value==="string"&&value.trim()?Number(value):value;return isVideoDurationSeconds(parsed)?parsed:fallback;};

export const VIDEO_ADAPTER_CONTRACT={
  adapterId:"fal-seedance-reference",
  adapterVersion:"2.0.0",
  provider:"fal",
  model:"bytedance/seedance-2.0/reference-to-video",
  label:"Seedance 2.0 reference-to-video",
  promptProfile:"positive-only" as const,
  maxReferenceImages:9,
  maxReferenceBytes:30*1024*1024,
  supportedResolutions:["480p","720p"] as const,
  supportedDurations:VIDEO_DURATION_SECONDS,
  defaultDuration:4 as VideoDurationSeconds,
  defaultResolution:"720p" as const,
  evaluatedResolution:"480p" as const,
  status:"adopted" as const,
  adoptedAt:"2026-08-21",
};

export const DEFAULT_VIDEO_MODEL=VIDEO_ADAPTER_CONTRACT.model;
export const DEFAULT_REFERENCE_VIDEO_MODEL=VIDEO_ADAPTER_CONTRACT.model;
