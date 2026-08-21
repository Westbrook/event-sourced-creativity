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
  defaultResolution:"720p" as const,
  evaluatedResolution:"480p" as const,
  status:"adopted" as const,
  adoptedAt:"2026-08-21",
};

export const DEFAULT_VIDEO_MODEL=VIDEO_ADAPTER_CONTRACT.model;
export const DEFAULT_REFERENCE_VIDEO_MODEL=VIDEO_ADAPTER_CONTRACT.model;
