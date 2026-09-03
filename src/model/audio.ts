import type { ContextAdapterContract } from "./context-adaptation.ts";
import { AUDIO_PROVIDER_INPUT_CONTRACTS, GEMINI_SPEECH_INPUT_POLICY, audioCharacterCount } from "./audio-provider-contracts.ts";

export const AUDIO_ROLES = ["score", "song", "soundscape", "sound_design", "voice", "silence"] as const;
export type AudioRole = typeof AUDIO_ROLES[number];

export const SAFE_AUDIO_MIME_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav",
  "audio/wave", "audio/ogg", "audio/flac", "audio/x-flac", "audio/webm",
] as const;

export const MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024;

export type AudioPlaybackTiming = { seconds: number; basis: "measured" | "estimate" | "recorded" };
const positiveAudioSeconds = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

/** Persist container measurements separately from a requested, unverified runtime. */
export function audioDurationMetadata(media: { url: string; contentHash: string; durationSeconds: number | null }, estimate?: number | null) {
  const measured = positiveAudioSeconds(media.durationSeconds);
  const estimated = measured === null ? positiveAudioSeconds(estimate) : null;
  return { duration_seconds: measured, estimated_duration_seconds: estimated,
    duration_basis: measured !== null ? "media-container" : estimated !== null ? "estimate" : null,
    duration_media_url: media.url, duration_media_sha256: media.contentHash };
}

/** Legacy values are recorded, not newly certified; mismatched media never inherits timing. */
export function audioPlaybackTiming(properties: Record<string, unknown>, mediaUrl: string | null | undefined): AudioPlaybackTiming | null {
  if (!mediaUrl) return null;
  if (properties.duration_media_url !== undefined && properties.duration_media_url !== mediaUrl) return null;
  const sourceHash = properties.source_media_sha256 ?? properties.source_content_hash;
  if (properties.duration_media_sha256 !== undefined && properties.duration_media_sha256 !== sourceHash) return null;
  const measured = positiveAudioSeconds(properties.duration_seconds);
  if (measured !== null && properties.duration_basis !== "estimate")
    return { seconds: measured, basis: properties.duration_basis === "media-container" ? "measured" : "recorded" };
  const estimated = positiveAudioSeconds(properties.estimated_duration_seconds);
  return estimated === null ? null : { seconds: estimated, basis: "estimate" };
}

/** Source replacements invalidate derived timing, without rewriting authored words or permissions. */
export function audioMetadataAfterSourceEdit(type: string, properties: Record<string, unknown>, property: string, value: unknown) {
  if (type !== "audio" && ![properties.media_type, properties.source_mime_type].some(mime => String(mime ?? "").startsWith("audio/"))) return properties;
  if (!["media_url", "media_type", "source_mime_type", "source_content_hash", "source_media_sha256"].includes(property) || Object.is(properties[property], value)) return properties;
  const next = { ...properties };
  for (const key of ["duration_seconds", "estimated_duration_seconds", "duration_basis", "duration_media_url", "duration_media_sha256", "analysis_provenance"]) delete next[key];
  return next;
}


export const AUDIO_ADAPTER_CONTRACT = {
  adapterId: "fal-lyria-music",
  adapterVersion: "1.1.0",
  provider: "fal" as const,
  model: "fal-ai/lyria3/pro",
  output: "audio" as const,
  label: "Lyria 3 Pro",
  maxPromptCharacters: AUDIO_PROVIDER_INPUT_CONTRACTS["fal-ai/lyria3/pro"]!.maxPromptCharacters,
  maximumAdvertisedDurationSeconds: 180,
  publishedCostMicrousd: 80_000,
  supportedOutputMimeTypes: ["audio/mpeg"] as const,
  maximumImageReferences: 1,
  acceptsAudioWaveformInput: false,
  capabilities: [
    "audio-generation", "text-to-audio", "image-to-audio", "semantic-audio-reference",
    "original-music", "sound-design", "durable-provider-receipt", "private-asset-output",
  ] as const,
} satisfies ContextAdapterContract & Record<string, unknown>;

/** User-facing intent is independent from the delivery channel or provider. */
export const AUDIO_GENERATION_GOALS = [
  "music", "timed_music", "sound_effects", "narration", "mixed_audio", "video_music", "video_sound_effects",
] as const;
export const AUDIO_DESTINATIONS = ["standalone", "video", "podcast", "radio"] as const;
export type AudioGenerationGoal = typeof AUDIO_GENERATION_GOALS[number];
export type AudioDestination = typeof AUDIO_DESTINATIONS[number];
export type AudioRequestProfile = {
  role: AudioRole;
  goal: AudioGenerationGoal;
  destination: AudioDestination;
  durationSeconds?: number;
  videoReferenceId?: string;
  speakerCount?: number;
  requireInstrumental?: boolean;
  requireEditableStems?: boolean;
  transcript?: string;
};
export type AudioAdapterPricing = {
  mode: "per_generation" | "per_second" | "per_minute" | "per_1000_characters";
  amountMicrousd: number;
  minimumBillableSeconds?: number;
};
export type AudioAdapterContract = ContextAdapterContract & {
  provider: "fal";
  output: "audio";
  label: string;
  maximumAdvertisedDurationSeconds: number;
  defaultDurationSeconds: number;
  supportedOutputMimeTypes: readonly string[];
  maximumImageReferences: number;
  acceptsAudioWaveformInput: boolean;
  supportsVideoReference: boolean;
  supportsExactDuration: boolean;
  maxSpeakers: number;
  pricing: AudioAdapterPricing;
  publishedCostMicrousd?: number;
  watermark: "synthid" | null;
};

const commonAudioAdapter = {
  adapterVersion: "1.1.0",
  provider: "fal" as const,
  output: "audio" as const,
  maximumImageReferences: 0,
  acceptsAudioWaveformInput: false,
  supportsVideoReference: false,
  supportsExactDuration: false,
  maxSpeakers: 0,
  watermark: null,
  capabilities: ["audio-generation", "text-to-audio", "semantic-audio-reference", "durable-provider-receipt", "private-asset-output"],
};

export const LYRIA_AUDIO_ADAPTER_CONTRACT: AudioAdapterContract = {
  ...AUDIO_ADAPTER_CONTRACT,
  defaultDurationSeconds: 180,
  supportsVideoReference: false,
  supportsExactDuration: false,
  maxSpeakers: 0,
  pricing: { mode: "per_generation", amountMicrousd: 80_000 },
  watermark: "synthid",
};
export const STABLE_AUDIO_ADAPTER_CONTRACT: AudioAdapterContract = {
  ...commonAudioAdapter,
  adapterId: "fal-stable-audio-music",
  model: "fal-ai/stable-audio-3/medium/text-to-audio",
  label: "Stable Audio 3 Medium",
  maxPromptCharacters: AUDIO_PROVIDER_INPUT_CONTRACTS["fal-ai/stable-audio-3/medium/text-to-audio"]!.maxPromptCharacters,
  maximumAdvertisedDurationSeconds: 380,
  defaultDurationSeconds: 30,
  supportedOutputMimeTypes: ["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/ogg", "audio/flac"],
  supportsExactDuration: true,
  pricing: { mode: "per_generation", amountMicrousd: 37_600 },
  capabilities: [...commonAudioAdapter.capabilities, "original-music", "exact-duration", "instrumental-music", "licensed-training-data"],
};
export const SONILO_MUSIC_ADAPTER_CONTRACT: AudioAdapterContract = {
  ...commonAudioAdapter,
  adapterId: "fal-sonilo-music",
  model: "sonilo/v1.1/text-to-music",
  label: "Sonilo Music",
  maxPromptCharacters: AUDIO_PROVIDER_INPUT_CONTRACTS["sonilo/v1.1/text-to-music"]!.maxPromptCharacters,
  maximumAdvertisedDurationSeconds: 600,
  defaultDurationSeconds: 90,
  supportedOutputMimeTypes: ["audio/mp4", "audio/aac", "audio/mpeg"],
  supportsExactDuration: true,
  pricing: { mode: "per_second", amountMicrousd: 2_500, minimumBillableSeconds: 10 },
  capabilities: [...commonAudioAdapter.capabilities, "original-music", "exact-duration", "commercial-use"],
};
export const SONILO_SOUND_EFFECTS_ADAPTER_CONTRACT: AudioAdapterContract = {
  ...commonAudioAdapter,
  adapterId: "fal-sonilo-sound-effects",
  model: "sonilo/v1.1/text-to-sound-effects",
  label: "Sonilo Sound Effects",
  maxPromptCharacters: AUDIO_PROVIDER_INPUT_CONTRACTS["sonilo/v1.1/text-to-sound-effects"]!.maxPromptCharacters,
  maximumAdvertisedDurationSeconds: 180,
  defaultDurationSeconds: 8,
  supportedOutputMimeTypes: ["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/flac"],
  supportsExactDuration: true,
  pricing: { mode: "per_second", amountMicrousd: 1_800 },
  capabilities: [...commonAudioAdapter.capabilities, "sound-design", "sound-effects", "exact-duration", "commercial-use"],
};
export const GEMINI_TTS_ADAPTER_CONTRACT: AudioAdapterContract = {
  ...commonAudioAdapter,
  adapterId: "fal-gemini-speech",
  model: "fal-ai/gemini-3.1-flash-tts",
  label: "Gemini 3.1 Flash Speech",
  maxPromptCharacters: GEMINI_SPEECH_INPUT_POLICY.maxPromptCharacters,
  maximumAdvertisedDurationSeconds: 300,
  defaultDurationSeconds: 30,
  supportedOutputMimeTypes: ["audio/mpeg", "audio/wav", "audio/ogg"],
  maxSpeakers: GEMINI_SPEECH_INPUT_POLICY.maxSpeakers,
  pricing: { mode: "per_1000_characters", amountMicrousd: 50_000 },
  capabilities: [...commonAudioAdapter.capabilities, "speech-generation", "text-to-speech", "preset-voices", "multi-speaker", "dialogue"],
};
export const SEED_AUDIO_ADAPTER_CONTRACT: AudioAdapterContract = {
  ...commonAudioAdapter,
  adapterId: "fal-seed-mixed-audio",
  model: "bytedance/seed-audio-1.0",
  label: "Seed Audio 1.0",
  maxPromptCharacters: AUDIO_PROVIDER_INPUT_CONTRACTS["bytedance/seed-audio-1.0"]!.maxPromptCharacters,
  maximumAdvertisedDurationSeconds: 120,
  defaultDurationSeconds: 60,
  supportedOutputMimeTypes: ["audio/mpeg", "audio/wav", "audio/ogg"],
  maxSpeakers: 4,
  pricing: { mode: "per_minute", amountMicrousd: 187_500 },
  capabilities: [...commonAudioAdapter.capabilities, "speech-generation", "original-music", "sound-effects", "mixed-scene", "dialogue"],
};
export const SONILO_VIDEO_MUSIC_ADAPTER_CONTRACT: AudioAdapterContract = {
  ...commonAudioAdapter,
  adapterId: "fal-sonilo-video-music",
  model: "sonilo/v1.1/video-to-music",
  label: "Sonilo Video Music",
  maxPromptCharacters: AUDIO_PROVIDER_INPUT_CONTRACTS["sonilo/v1.1/video-to-music"]!.maxPromptCharacters,
  maximumAdvertisedDurationSeconds: 180,
  defaultDurationSeconds: 30,
  supportedOutputMimeTypes: ["audio/mp4", "audio/aac", "audio/mpeg"],
  supportsVideoReference: true,
  supportsExactDuration: true,
  pricing: { mode: "per_second", amountMicrousd: 9_000 },
  capabilities: [...commonAudioAdapter.capabilities, "original-music", "video-to-audio", "video-synchronization", "video-reference-input", "exact-duration"],
};
export const SONILO_VIDEO_SOUND_EFFECTS_ADAPTER_CONTRACT: AudioAdapterContract = {
  ...commonAudioAdapter,
  adapterId: "fal-sonilo-video-sound-effects",
  model: "sonilo/v1.1/video-to-video-sound-effects",
  label: "Sonilo Video Sound Effects",
  maxPromptCharacters: AUDIO_PROVIDER_INPUT_CONTRACTS["sonilo/v1.1/video-to-video-sound-effects"]!.maxPromptCharacters,
  maximumAdvertisedDurationSeconds: 180,
  defaultDurationSeconds: 30,
  supportedOutputMimeTypes: ["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/flac"],
  supportsVideoReference: true,
  supportsExactDuration: false,
  pricing: { mode: "per_second", amountMicrousd: 9_000 },
  capabilities: [...commonAudioAdapter.capabilities, "sound-design", "sound-effects", "video-to-audio", "video-synchronization", "video-reference-input", "video-duration-matched", "mixed-video-output"],
};
export const AUDIO_ADAPTER_CONTRACTS: readonly AudioAdapterContract[] = [
  LYRIA_AUDIO_ADAPTER_CONTRACT,
  STABLE_AUDIO_ADAPTER_CONTRACT,
  SONILO_MUSIC_ADAPTER_CONTRACT,
  SONILO_SOUND_EFFECTS_ADAPTER_CONTRACT,
  GEMINI_TTS_ADAPTER_CONTRACT,
  SEED_AUDIO_ADAPTER_CONTRACT,
  SONILO_VIDEO_MUSIC_ADAPTER_CONTRACT,
  SONILO_VIDEO_SOUND_EFFECTS_ADAPTER_CONTRACT,
];
export const audioAdapterContractForModel = (model: unknown) =>
  AUDIO_ADAPTER_CONTRACTS.find((contract) => contract.model === String(model ?? "").trim());

export class AudioAdapterSelectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AudioAdapterSelectionError";
  }
}

const audioGoalAliases: Record<string, AudioGenerationGoal> = {
  music: "music", score: "music", song: "music", timed_music: "timed_music", precise_music: "timed_music",
  instrumental: "timed_music", sound_effects: "sound_effects", sound_design: "sound_effects",
  soundscape: "sound_effects", sfx: "sound_effects", narration: "narration", speech: "narration",
  voice: "narration", dialogue: "narration", mixed_audio: "mixed_audio", mixed_scene: "mixed_audio",
  radio: "mixed_audio", video_music: "video_music", video_score: "video_music",
  video_sound_effects: "video_sound_effects", video_sfx: "video_sound_effects",
};

export function normalizeAudioRequestProfile(value: unknown, snapshot: Record<string, unknown> = {}): AudioRequestProfile {
  const source = record(value);
  const requestedGoal = text(source.goal ?? source.audioGoal ?? source.purpose).toLowerCase().replace(/[\s-]+/g, "_");
  const firstContext = audioContexts(snapshot, "inform")[0];
  const explicitRole = text(source.role ?? source.audioRole ?? source.audio_role);
  const initialRole = requestedGoal === "silence" || requestedGoal === "silent"
    ? "silence" : explicitRole ? normalizeAudioRole(explicitRole) : firstContext?.role ?? "score";
  const inferredGoal: AudioGenerationGoal = initialRole === "voice" ? "narration"
    : initialRole === "sound_design" || initialRole === "soundscape" ? "sound_effects" : "music";
  const goal = audioGoalAliases[requestedGoal] ?? inferredGoal;
  const videoGoal = goal === "video_music" || goal === "video_sound_effects";
  const requestedDestination = text(source.destination).toLowerCase();
  const destination: AudioDestination = videoGoal ? "video"
    : AUDIO_DESTINATIONS.includes(requestedDestination as AudioDestination) ? requestedDestination as AudioDestination : "standalone";
  const role: AudioRole = initialRole === "silence" ? "silence"
    : goal === "narration" || goal === "mixed_audio" ? "voice"
      : goal === "sound_effects" || goal === "video_sound_effects" ? initialRole === "soundscape" ? "soundscape" : "sound_design"
        : initialRole === "song" ? "song" : "score";
  const rawDuration = source.durationSeconds ?? source.duration_seconds;
  const duration = typeof rawDuration === "number" && Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : undefined;
  const rawSpeakers = source.speakerCount ?? source.speaker_count;
  const speakers = typeof rawSpeakers === "number" && Number.isFinite(rawSpeakers) && rawSpeakers > 0 ? rawSpeakers : undefined;
  const videoReferenceId = text(source.videoReferenceId ?? source.video_reference_id);
  const transcript = text(source.transcript ?? source.script);
  return {
    role, goal, destination,
    ...(duration ? { durationSeconds: duration } : {}),
    ...(videoReferenceId ? { videoReferenceId } : {}),
    ...(speakers ? { speakerCount: speakers } : {}),
    ...(source.requireInstrumental === true || source.require_instrumental === true ? { requireInstrumental: true } : {}),
    ...(source.requireEditableStems === true || source.require_editable_stems === true ? { requireEditableStems: true } : {}),
    ...(transcript ? { transcript } : {}),
  };
}

/** Quotes are conservative before submission and use verified usage only when settling. */
export function estimateAudioProviderCostMicrousd(
  contractOrModel: AudioAdapterContract | string,
  profile: Partial<AudioRequestProfile> = {},
  actualUsage?: { durationSeconds?: number; characterCount?: number },
): number {
  const contract = typeof contractOrModel === "string" ? audioAdapterContractForModel(contractOrModel) : contractOrModel;
  if (!contract) throw new AudioAdapterSelectionError("audio_provider_model_unsupported", "The requested audio model is not approved.");
  if (profile.role === "silence") return 0;
  if (contract.pricing.mode === "per_generation") return contract.pricing.amountMicrousd;
  if (contract.pricing.mode === "per_1000_characters") {
    // Speaker aliases are normalized at submission, so only a final serialized script
    // has a trustworthy exact length. Reserve Forma's admitted input capacity,
    // not Fal's much larger character ceiling independently of its token limit.
    const characters = actualUsage?.characterCount ?? Math.min(contract.maxPromptCharacters, GEMINI_SPEECH_INPUT_POLICY.maxCombinedUtf8Bytes);
    return Math.ceil(characters * contract.pricing.amountMicrousd / 1_000);
  }
  // Seed cannot enforce duration, so reserve its documented maximum before a paid call.
  const requested = actualUsage?.durationSeconds
    ?? (contract.pricing.mode === "per_minute" && !contract.supportsExactDuration
      ? contract.maximumAdvertisedDurationSeconds
      : profile.durationSeconds ?? contract.defaultDurationSeconds);
  const seconds = Math.max(contract.pricing.minimumBillableSeconds ?? 1, Math.ceil(requested));
  return contract.pricing.mode === "per_second"
    ? seconds * contract.pricing.amountMicrousd
    : Math.ceil(seconds * contract.pricing.amountMicrousd / 60);
}

export type AudioAdapterSelection = {
  contract: AudioAdapterContract;
  profile: AudioRequestProfile;
  reason: string;
  estimatedCostMicrousd: number;
};

export function selectAudioAdapterContract(
  value: unknown,
  options: { preferredModel?: string; videoReferenceAvailable?: boolean; snapshot?: Record<string, unknown> } = {},
): AudioAdapterSelection {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new AudioAdapterSelectionError("audio_profile_invalid", "The audio request profile must be an object.");
  }
  const raw = record(value);
  for (const field of ["goal", "audioGoal", "purpose", "role", "audioRole", "audio_role"]) {
    if (raw[field] !== undefined && typeof raw[field] !== "string") throw new AudioAdapterSelectionError(field.toLowerCase().includes("role") ? "audio_role_unsupported" : "audio_goal_unsupported", "Audio goals and roles must use supported text values.");
  }
  const requestedGoal = text(raw.goal ?? raw.audioGoal ?? raw.purpose).toLowerCase().replace(/[\s-]+/g, "_");
  if (requestedGoal && !audioGoalAliases[requestedGoal] && requestedGoal !== "silence" && requestedGoal !== "silent") {
    throw new AudioAdapterSelectionError("audio_goal_unsupported", "The requested audio goal is not supported.");
  }
  if ([raw.durationSeconds, raw.duration_seconds].some((duration) => duration !== undefined && (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0))) {
    throw new AudioAdapterSelectionError("audio_duration_invalid", "Audio duration must be a positive finite number of seconds.");
  }
  const requestedRole = text(raw.role ?? raw.audioRole ?? raw.audio_role).toLowerCase().replace(/[\s-]+/g, "_");
  if (requestedRole && !AUDIO_ROLES.includes(requestedRole as AudioRole)) {
    throw new AudioAdapterSelectionError("audio_role_unsupported", "The requested audio role is not supported.");
  }
  if ([raw.speakerCount, raw.speaker_count].some((speakers) => speakers !== undefined && (typeof speakers !== "number" || !Number.isSafeInteger(speakers) || speakers <= 0))) {
    throw new AudioAdapterSelectionError("audio_speaker_count_invalid", "The number of speakers must be a positive whole number.");
  }
  if (raw.destination !== undefined && !AUDIO_DESTINATIONS.includes(raw.destination as AudioDestination)) {
    throw new AudioAdapterSelectionError("audio_destination_unsupported", "The requested audio destination is not supported.");
  }
  if (raw.transcript !== undefined && typeof raw.transcript !== "string" || raw.script !== undefined && typeof raw.script !== "string") {
    throw new AudioAdapterSelectionError("audio_spoken_script_invalid", "The approved spoken script must be text.");
  }
  for (const key of ["requireInstrumental", "require_instrumental", "requireEditableStems", "require_editable_stems"]) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") throw new AudioAdapterSelectionError("audio_parameter_invalid", "Audio preferences must be true or false.");
  }
  const profile = normalizeAudioRequestProfile(value, options.snapshot);
  if (profile.role === "silence") {
    throw new AudioAdapterSelectionError("audio_silence_requested", "Silence does not require a paid audio-generation request.");
  }
  if (profile.requireEditableStems) {
    throw new AudioAdapterSelectionError("audio_editable_stems_unsupported", "The approved audio models cannot return independently editable stems.");
  }
  const video = profile.goal === "video_music" || profile.goal === "video_sound_effects";
  if (video && options.videoReferenceAvailable === false) {
    throw new AudioAdapterSelectionError("audio_video_reference_required", "Choose an approved video and explicitly authorize sharing it before generating synchronized audio.");
  }
  let contract: AudioAdapterContract;
  switch (profile.goal) {
    case "narration": contract = GEMINI_TTS_ADAPTER_CONTRACT; break;
    case "mixed_audio": contract = SEED_AUDIO_ADAPTER_CONTRACT; break;
    case "sound_effects": contract = SONILO_SOUND_EFFECTS_ADAPTER_CONTRACT; break;
    case "video_music": contract = SONILO_VIDEO_MUSIC_ADAPTER_CONTRACT; break;
    case "video_sound_effects": contract = SONILO_VIDEO_SOUND_EFFECTS_ADAPTER_CONTRACT; break;
    case "timed_music":
      contract = (profile.durationSeconds ?? STABLE_AUDIO_ADAPTER_CONTRACT.defaultDurationSeconds) <= STABLE_AUDIO_ADAPTER_CONTRACT.maximumAdvertisedDurationSeconds
        ? STABLE_AUDIO_ADAPTER_CONTRACT : SONILO_MUSIC_ADAPTER_CONTRACT;
      break;
    default:
      contract = profile.requireInstrumental ? STABLE_AUDIO_ADAPTER_CONTRACT
        : (profile.durationSeconds ?? 0) > STABLE_AUDIO_ADAPTER_CONTRACT.maximumAdvertisedDurationSeconds ? SONILO_MUSIC_ADAPTER_CONTRACT
          : (profile.durationSeconds ?? 0) > LYRIA_AUDIO_ADAPTER_CONTRACT.maximumAdvertisedDurationSeconds ? STABLE_AUDIO_ADAPTER_CONTRACT
            : LYRIA_AUDIO_ADAPTER_CONTRACT;
  }
  if (options.preferredModel) {
    const preferred = audioAdapterContractForModel(options.preferredModel);
    if (!preferred) throw new AudioAdapterSelectionError("audio_provider_model_unsupported", "The configured audio model is not on the approved capability list.");
    const approvedMusicModel = preferred.model === LYRIA_AUDIO_ADAPTER_CONTRACT.model
      || preferred.model === STABLE_AUDIO_ADAPTER_CONTRACT.model || preferred.model === SONILO_MUSIC_ADAPTER_CONTRACT.model;
    const compatible = preferred.model === contract.model || (profile.goal === "music" || profile.goal === "timed_music")
      && approvedMusicModel
      && preferred.capabilities.includes("original-music") && !preferred.supportsVideoReference
      && (!profile.durationSeconds || profile.durationSeconds <= preferred.maximumAdvertisedDurationSeconds)
      && (!profile.requireInstrumental || preferred.capabilities.includes("instrumental-music"))
      && (profile.goal !== "timed_music" || preferred.supportsExactDuration);
    if (!compatible) throw new AudioAdapterSelectionError("audio_provider_model_incompatible", "The configured audio model cannot satisfy this creative goal.");
    contract = preferred;
  }
  if (profile.durationSeconds && profile.durationSeconds > contract.maximumAdvertisedDurationSeconds) {
    throw new AudioAdapterSelectionError("audio_duration_unsupported", `${contract.label} supports up to ${contract.maximumAdvertisedDurationSeconds} seconds.`);
  }
  const durationRule = AUDIO_PROVIDER_INPUT_CONTRACTS[contract.model]?.parameters.duration;
  if (profile.durationSeconds !== undefined && durationRule && (profile.durationSeconds < (durationRule.minimum ?? 0)
    || durationRule.type === "integer" && !Number.isSafeInteger(profile.durationSeconds))) {
    throw new AudioAdapterSelectionError("audio_duration_invalid", `${contract.label} requires ${durationRule.type === "integer" ? "a whole number of" : "at least one"} seconds between ${durationRule.minimum} and ${Math.min(durationRule.maximum ?? Infinity, contract.maximumAdvertisedDurationSeconds)}.`);
  }
  if (profile.requireInstrumental && !contract.capabilities.includes("instrumental-music")) {
    throw new AudioAdapterSelectionError("audio_instrumental_unsupported", `${contract.label} does not support the requested instrumental preference.`);
  }
  if (profile.speakerCount && profile.speakerCount > contract.maxSpeakers) {
    throw new AudioAdapterSelectionError("audio_speaker_count_unsupported", `${contract.label} supports at most ${contract.maxSpeakers} speakers.`);
  }
  if (profile.goal === "narration" && profile.transcript && audioCharacterCount(profile.transcript) > contract.maxPromptCharacters) {
    throw new AudioAdapterSelectionError("audio_prompt_too_long", `${contract.label} supports scripts of at most ${contract.maxPromptCharacters.toLocaleString()} characters.`);
  }
  const reasons: Record<AudioGenerationGoal, string> = {
    music: "original music",
    timed_music: "precise-duration music",
    sound_effects: "purpose-built sound effects",
    narration: "single- or multi-speaker speech",
    mixed_audio: "fully mixed dialogue, music, and effects",
    video_music: "video-synchronized music",
    video_sound_effects: "video-synchronized sound effects",
  };
  return { contract, profile, reason: reasons[profile.goal], estimatedCostMicrousd: estimateAudioProviderCostMicrousd(contract, profile) };
}

export const VIDEO_AUDIO_REFERENCE_CONTRACT = {
  maximumReferences: 3,
  maximumBytesPerReference: 15 * 1024 * 1024,
  maximumCombinedDurationSeconds: 15,
  maximumCombinedMediaReferences: 12,
  supportedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"] as const,
} as const;

export type AudioUsage = {
  informGeneration: boolean;
  includeInOutput: boolean;
  allowProviderAudioTransfer: boolean;
};

export type AudioCue = {
  startSeconds: number;
  endSeconds: number | null;
  label: string;
  targetKind: "scene" | "slide" | "frame" | "chapter" | "moment";
  targetId: string;
  emotionalIntent: string;
};

export type AudioContext = {
  blockId: string;
  label: string;
  role: AudioRole;
  description: string;
  mood: string;
  emotionalArc: string;
  narrativePurpose: string;
  instrumentation: string[];
  texture: string;
  tempoBpm: number | null;
  durationSeconds: number | null;
  transcript: string;
  vocalPolicy: "instrumental" | "vocals" | "unspecified";
  cues: AudioCue[];
  usage: AudioUsage;
  mediaUrl: string | null;
  mimeType: string | null;
  rights: string;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const finitePositive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

export function audioMimeType(value: unknown) {
  const normalized = text(value).split(";")[0]!.trim().toLowerCase();
  return SAFE_AUDIO_MIME_TYPES.includes(normalized as typeof SAFE_AUDIO_MIME_TYPES[number]) ? normalized : null;
}

export function audioFileExtension(mimeType: string) {
  const mime = audioMimeType(mimeType);
  return mime === "audio/mpeg" || mime === "audio/mp3" ? "mp3"
    : mime === "audio/mp4" ? "m4a"
      : mime === "audio/aac" ? "aac"
        : mime === "audio/wav" || mime === "audio/x-wav" || mime === "audio/wave" ? "wav"
          : mime === "audio/ogg" ? "ogg"
            : mime === "audio/flac" || mime === "audio/x-flac" ? "flac"
              : mime === "audio/webm" ? "webm" : null;
}

/** Only positively asserted or account-generated recordings can influence external work. */
export function audioRightsAllowed(value: unknown) {
  return new Set(["owned", "owned_or_licensed", "licensed", "account-generated"]).has(text(value).toLowerCase());
}

/** Importing, listening to, or including a clip never grants another permission. */
export function normalizeAudioUsage(properties: Record<string, unknown>): AudioUsage {
  return {
    informGeneration: properties.inform_generation === true,
    includeInOutput: properties.include_in_output === true,
    allowProviderAudioTransfer: properties.allow_provider_audio_transfer === true,
  };
}

function normalizeAudioRole(value: unknown): AudioRole {
  const candidate = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return AUDIO_ROLES.includes(candidate as AudioRole) ? candidate as AudioRole : "score";
}

export function normalizeAudioCues(value: unknown): AudioCue[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 48).flatMap((candidate) => {
    const cue = record(candidate);
    const startSeconds = typeof cue.start_seconds === "number" ? cue.start_seconds : cue.startSeconds;
    const endSeconds = typeof cue.end_seconds === "number" ? cue.end_seconds : cue.endSeconds;
    if (typeof startSeconds !== "number" || !Number.isFinite(startSeconds) || startSeconds < 0) return [];
    if (endSeconds !== undefined && endSeconds !== null && (typeof endSeconds !== "number" || !Number.isFinite(endSeconds) || endSeconds <= startSeconds)) return [];
    const target = text(cue.target_kind ?? cue.targetKind);
    return [{
      startSeconds,
      endSeconds: typeof endSeconds === "number" ? endSeconds : null,
      label: text(cue.label),
      targetKind: target === "scene" || target === "slide" || target === "frame" || target === "chapter" ? target : "moment",
      targetId: text(cue.target_id ?? cue.targetId),
      emotionalIntent: text(cue.emotional_intent ?? cue.emotionalIntent),
    } satisfies AudioCue];
  }).sort((left, right) => left.startSeconds - right.startSeconds);
}

export function audioContextFromFact(value: unknown): AudioContext | null {
  const fact = record(value);
  if (fact.type !== "audio" && fact.role !== "audio") return null;
  if (fact.active === false || fact.removed === true) return null;
  const properties = record(fact.properties);
  if (properties.active === false || properties.weight !== undefined && Number(properties.weight) <= 0) return null;
  const vocal = text(properties.vocal_policy ?? properties.vocals).toLowerCase();
  return {
    blockId: text(fact.block_id ?? fact.id),
    label: text(properties.label ?? fact.handle) || "Audio reference",
    role: normalizeAudioRole(properties.audio_role ?? properties.subtype),
    description: text(properties.description)||text(properties.text),
    mood: text(properties.mood),
    emotionalArc: text(properties.emotional_arc),
    narrativePurpose: text(properties.narrative_purpose),
    instrumentation: (Array.isArray(properties.instrumentation) ? properties.instrumentation : typeof properties.instrumentation === "string" ? properties.instrumentation.split(",") : []).map(text).filter(Boolean).slice(0, 24),
    texture: text(properties.texture ?? properties.soundscape),
    tempoBpm: finitePositive(properties.tempo_bpm),
    durationSeconds: finitePositive(properties.duration_seconds),
    transcript: text(properties.transcript ?? properties.lyrics),
    vocalPolicy: vocal === "instrumental" || vocal === "no_vocals" ? "instrumental" : vocal === "vocals" || vocal === "voice" ? "vocals" : "unspecified",
    cues: normalizeAudioCues(properties.audio_cues ?? properties.cues),
    usage: normalizeAudioUsage(properties),
    mediaUrl: text(properties.media_url) || null,
    mimeType: audioMimeType(properties.source_mime_type ?? properties.media_type),
    rights: text(properties.rights_class ?? properties.rights),
  };
}

export function audioContexts(snapshot: Record<string, unknown>, mode: "all" | "inform" | "include" | "transfer" = "all") {
  if (!Array.isArray(snapshot.facts)) return [];
  return snapshot.facts.filter((fact)=>!audioFactProhibited(fact)).map(audioContextFromFact).filter((context): context is AudioContext => Boolean(context)).filter((context) =>
    mode === "all" || mode === "inform" && context.usage.informGeneration
      || mode === "include" && context.usage.includeInOutput
      || mode === "transfer" && context.usage.includeInOutput && context.usage.allowProviderAudioTransfer);
}

/** Only deliberately authorized, human-readable musical meaning reaches another model. */
export function audioContextDescription(context: AudioContext) {
  if (!context.usage.informGeneration) return "";
  const sections = [
    `${context.label} (${context.role.replaceAll("_", " ")})`,
    context.description,
    context.narrativePurpose ? `Dramatic purpose: ${context.narrativePurpose}` : "",
    context.mood ? `Mood: ${context.mood}` : "",
    context.emotionalArc ? `Emotional arc: ${context.emotionalArc}` : "",
    context.instrumentation.length ? `Instrumentation: ${context.instrumentation.join(", ")}` : "",
    context.texture ? `Sonic environment: ${context.texture}` : "",
    context.tempoBpm ? `Suggested tempo: ${context.tempoBpm} BPM` : "",
    context.vocalPolicy === "instrumental" ? "Instrumental only; no singing or spoken dialogue." : "",
    context.transcript ? `Authorized words or listening notes: ${context.transcript}` : "",
    ...context.cues.map((cue) => `Cue ${cue.startSeconds}s${cue.endSeconds === null ? "" : `–${cue.endSeconds}s`}: ${[cue.label, cue.emotionalIntent].filter(Boolean).join(" · ")} (${cue.targetKind})`),
  ];
  return sections.filter(Boolean).join(". ").slice(0, 4_000);
}

export function audioContextDirectives(snapshot: Record<string, unknown>) {
  return audioContexts(snapshot, "inform").map(audioContextDescription).filter(Boolean);
}

export type AudioAuthoringConflict = {
  code: "audio_output_forbidden" | "audio_originality_required";
  message: string;
};

const absoluteAudioProhibition = /\b(?:no|without|exclude|excluding|forbid(?:den)?|prohibit(?:ed)?|avoid|never\s+(?:include|add|use|play|generate))\s+(?:(?:all|any|audible|background|generated|recorded|additional)\s+){0,3}(?:audio|sound(?:s|track)?|music|musical\s+score|score)\b|\b(?:must|requires?|required|remain|keep)\b[^.;\n]{0,65}\b(?:silent|silence)\b|\b(?:audio|sound|music|soundtrack)\s*:\s*(?:silent|silence|off|none|disabled|absent)\b|\b(?:audio|sound|music)[-\s]+free\b/i;
const protectedAudioImitation = /\b(?:imitat(?:e|es|ing|ion)|impersonat(?:e|es|ing|ion)|clon(?:e|ed|ing)|recreat(?:e|es|ing)|reproduc(?:e|es|ing)|copy|copies|sound\s+(?:exactly|just)\s+like)\b[^.;\n]{0,110}\b(?:artist|singer|celebrity|voice|melody|song|recording|track|lyrics|copyright(?:ed)?)\b|\b(?:artist|singer|celebrity)[’']s\s+(?:voice|melody|song|recording)\b|\b(?:exact|copyrighted|protected)\s+(?:lyrics|melody|recording|voice)\b/i;
const protectedNamedWork = /\b(?:famous|recognizable|existing|copyrighted|protected|well[- ]known|named|signature)\b[^.;\n]{0,90}\b(?:melody|theme|song|score|track|recording|lyrics|voice|music)\b/i;
function requestsProtectedAudioImitation(value:string){
  return value.split(/[.;]\s+/).some((passage)=>{
    if(/^\s*(?:no|without|never|avoid|exclude|do\s+not|don['’]t)\b/i.test(passage))return false;
    if(protectedAudioImitation.test(passage)||protectedNamedWork.test(passage))return true;
    const named=passage.match(/\b(?:in\s+the\s+style\s+of|sound(?:s|ing)?\s+(?:(?:exactly|just)\s+)?like|imitat(?:e|es|ing)|clon(?:e|es|ing)|impersonat(?:e|es|ing)|(?:music|score|song|theme|melody|voice)\s+(?:by|from))\s+([^.;\n]+)/i);
    if(named&&/^\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+){0,4}(?:\b|$)/u.test(named[1]!.trim()))return true;
    const personVoice=(candidate:string)=>{
      const trimmed=candidate.trim();
      const articleLed=/^(?:an?|the)\s+/i.test(trimmed);
      const value=trimmed.replace(/^(?:an?|the)\s+/i,"").replace(/^(?:actor|singer|artist|performer|celebrity)\s+/i,"").replace(/\s+(?:exactly|precisely|perfectly|please|instead)\b.*$/i,"");
      const words=value.match(/^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,4}/u)?.[0]?.split(/\s+/u)??[];
      if(!words.length||words.some((word)=>/^(?:a|an|the|and|or|calm|warm|friendly|natural|caring|gentle|confident|clear|soft|deep|dramatic|original|professional|human|person|friend|parent|teacher|narrator|storyteller|character|radio|podcast|experienced|guide|trusted|journalist|patient|instructor|real|estate|agent|excited|child|bedtime|story|documentary|host|news|anchor|sports|commentator|cinematic|nature|upbeat|conversational|slow|reassuring|joyful|energetic|quiet|thoughtful|wise|mentor)$/i.test(word)))return false;
      if(articleLed&&!words.some((word)=>/^\p{Lu}/u.test(word))&&/[\p{Lu}\p{Ll}]/u.test(value))return false;
      return words.length>1||/^\p{Lu}/u.test(words[0]!)||!/[\p{Lu}\p{Ll}]/u.test(words[0]!);
    };
    const namedVoice=passage.match(/\b(?:voice|vocals?|speech|narration|voice[- ]?over)\s+(?:of|by|from|like|matching|should\s+be)\s+([^.;\n]+)/iu)
      ??passage.match(/\b(?:narrat(?:e|es|ing)|read(?:s|ing)?|speak(?:s|ing)?|deliver(?:ed|ing)?|sound(?:s|ing)?|imitat(?:e|es|ing)|impersonat(?:e|es|ing)|clon(?:e|es|ing))\s+(?:(?:exactly|just)\s+)?(?:like|as|in\s+the\s+voice\s+of)\s+([^.;\n]+)/iu)
      ??passage.match(/\b(?:speak|read|narrate|deliver)\s+in\s+(?:an?\s+)?([^.;\n]+?)\s+voice\b/iu)
      ??passage.match(/\b(?:narrate|read|speak)\s+in\s+(?:an?\s+)?([^.;\n]+?)\s+style\b/iu)
      ??passage.match(/\b(?:imitate|impersonate|clone|mimic)\s+([^.;\n]+)/iu)
      ??passage.match(/\b(?:use|using|adopt|match|with|in)?\s*(?:an?\s+)?([^.;\n]+?)(?:[-\s]style\s+(?:voice|voice[- ]?over|vocals?|narration|delivery)|[’']s\s+(?:voice|vocals?|narration|delivery))\b/iu);
    if(namedVoice&&personVoice(namedVoice[1]!))return true;
    const recognizable=passage.match(/\b(?:recognizable|famous|well[- ]known|signature)\s+(?:the\s+)?([^.;\n]+)/i);
    if(recognizable&&/^\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+){1,5}(?:\b|$)/u.test(recognizable[1]!.trim()))return true;
    const recreated=passage.match(/\b(?:recreat(?:e|es|ing)|reproduc(?:e|es|ing)|copy|copies)\s+(?:the\s+)?([^.;\n]+)/i);
    return Boolean(recreated&&(/\b(?:by|from)\s+\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+)+/u.test(recreated[1]!)||/^\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+){1,5}(?:\b|$)/u.test(recreated[1]!.trim())));
  });
}
const negativeAudioIntent = (fact: Record<string, unknown>, properties: Record<string, unknown>) =>
  [fact.intent, fact.effect, properties.intent, properties.effect, properties.polarity].some((value) => /^(?:avoid|prohibit|exclude|must_not_include|forbid|negative)$/i.test(String(value ?? "")));

export function audioFactProhibited(value:unknown){
  const fact=record(value);
  return negativeAudioIntent(fact,record(fact.properties));
}

/** Enforce protected silence and originality locally, before a planner or media provider can incur cost. */
export function audioAuthoringConflict(snapshot: Record<string, unknown>, profile?: Partial<AudioRequestProfile>, guidance?: { tone?: unknown; audience?: unknown }): AudioAuthoringConflict | null {
  const facts = Array.isArray(snapshot.facts) ? snapshot.facts.map(record).filter((fact) => {
    const properties = record(fact.properties);
    return fact.active !== false && fact.removed !== true && properties.active !== false
      && (properties.weight === undefined || Number(properties.weight) > 0);
  }) : [];
  const intendedRoles=audioContexts(snapshot,"all").map((context)=>context.role);
  const nonMusicalGoal=profile?.goal==="narration"||profile?.goal==="sound_effects"||profile?.goal==="video_sound_effects";
  const nonMusicalOnly=profile?.goal?nonMusicalGoal:intendedRoles.length>0&&intendedRoles.every((role)=>role==="soundscape"||role==="sound_design"||role==="voice");
  const needsMusic=profile?.goal?["music","timed_music","video_music","mixed_audio"].includes(profile.goal):!nonMusicalOnly;
  const needsSoundEffects=profile?.goal?profile.goal==="sound_effects"||profile.goal==="video_sound_effects"||profile.goal==="mixed_audio":true;
  const needsSpeech=profile?.goal?profile.goal==="narration"||profile.goal==="mixed_audio":true;
  const violatesAudioDirection=(direction:string)=>{
    let recognizedProhibition=false;
    for(const match of direction.matchAll(/(?=\b(?:no|without|avoid|exclude|excluding|forbid(?:den)?|prohibit(?:ed)?|never\s+(?:include|add|use|play|generate))\s+([^.;\n]{1,240}))/giu)){
      const clause=match[1]!.split(/\b(?:but|however|except|instead|although|yet|because|while)\b/iu)[0]!;
      const all=/\baudio\b|\bsounds?\b(?!\s+effects?\b)/iu.test(clause);
      const music=/\b(?:music|musical\s+score|score|soundtrack|songs?)\b/iu.test(clause);
      const effects=/\b(?:sound\s+effects?|foley|sfx)\b/iu.test(clause);
      const speech=/\b(?:speech|dialogue|narration|voice(?:s|[- ]?overs?)?|vocals?|spoken\s+words?|talk(?:ing)?)\b/iu.test(clause);
      if(all||music&&needsMusic||effects&&needsSoundEffects||speech&&needsSpeech)return true;
      recognizedProhibition||=music||effects||speech;
    }
    if(/\b(?:speech|dialogue|narration|voice(?:s|[- ]?overs?)?|vocals?)[-\s]+free\b/iu.test(direction))return needsSpeech;
    if(/\b(?:sound\s+effects?|foley|sfx)[-\s]+free\b/iu.test(direction))return needsSoundEffects;
    if(/\b(?:music|soundtrack)[-\s]+free\b/iu.test(direction))return needsMusic;
    if(recognizedProhibition)return false;
    return absoluteAudioProhibition.test(direction);
  };

  if([guidance?.tone,guidance?.audience].some((value)=>requestsProtectedAudioImitation(text(value)))){
    return { code: "audio_originality_required", message: "Audio delivery instructions cannot imitate a protected artist, recognizable melody, recording, or another person's voice. Revise the requested tone or audience before starting a paid request." };
  }

  for (const fact of facts) {
    const properties = record(fact.properties);
    const negative = negativeAudioIntent(fact, properties);
    const locked = fact.locked === true || properties.locked === true || properties.required === true || negative;
    const direction = [properties.text, properties.description, properties.narrative_purpose, properties.transcript, properties.lyrics].map(text).filter(Boolean).join(". ");
    const role = text(properties.audio_role ?? properties.subtype).toLowerCase();
    if (locked && (violatesAudioDirection(direction) || (fact.type === "audio" || fact.role === "audio") && role === "silence")) {
      return { code: "audio_output_forbidden", message: "A protected creative decision requires silence or prohibits music and soundtracks. Revise that decision or remove the soundtrack before starting a paid request." };
    }
    const relevant = fact.type!=="audio"&&fact.role!=="audio"||locked || (fact.type === "audio" || fact.role === "audio") && properties.inform_generation === true;
    if (relevant && !negative && requestsProtectedAudioImitation(direction)) {
      return { code: "audio_originality_required", message: "Original audio cannot imitate a protected artist, recognizable melody, copyrighted lyrics, recording, or another person's voice. Revise the listening direction before starting a paid request." };
    }
  }

  const constraints = Array.isArray(snapshot.standing_constraints) ? snapshot.standing_constraints.map(record) : [];
  for (const constraint of constraints) {
    const direction = text(constraint.value ?? constraint.text);
    const negative = /^(?:avoid|prohibit|exclude|forbid|negative)$/i.test(text(constraint.polarity));
    if (violatesAudioDirection(direction)) {
      return { code: "audio_output_forbidden", message: "A standing creative constraint requires silence or prohibits music and soundtracks. Revise the constraint or remove the soundtrack before starting a paid request." };
    }
    if (!negative && requestsProtectedAudioImitation(direction)) {
      return { code: "audio_originality_required", message: "A standing creative constraint requests a protected musical or vocal imitation. Revise it before starting a paid original-audio request." };
    }
  }

  return null;
}
