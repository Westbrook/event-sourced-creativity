import type { ContextAdapterContract } from "./context-adaptation.ts";

export const AUDIO_ROLES = ["score", "song", "soundscape", "sound_design", "voice", "silence"] as const;
export type AudioRole = typeof AUDIO_ROLES[number];

export const SAFE_AUDIO_MIME_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav",
  "audio/wave", "audio/ogg", "audio/flac", "audio/x-flac", "audio/webm",
] as const;

export const MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024;

export const AUDIO_ADAPTER_CONTRACT = {
  adapterId: "fal-lyria-music",
  adapterVersion: "1.0.0",
  provider: "fal",
  model: "fal-ai/lyria3/pro",
  output: "audio" as const,
  label: "Lyria 3 Pro",
  maxPromptCharacters: 5_000,
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
export function audioAuthoringConflict(snapshot: Record<string, unknown>): AudioAuthoringConflict | null {
  const facts = Array.isArray(snapshot.facts) ? snapshot.facts.map(record).filter((fact) => {
    const properties = record(fact.properties);
    return fact.active !== false && fact.removed !== true && properties.active !== false
      && (properties.weight === undefined || Number(properties.weight) > 0);
  }) : [];
  const intendedRoles=audioContexts(snapshot,"all").map((context)=>context.role);
  const nonMusicalOnly=intendedRoles.length>0&&intendedRoles.every((role)=>role==="soundscape"||role==="sound_design"||role==="voice");
  const musicOnlyProhibition=(direction:string)=>/\b(?:no|without|avoid|exclude|excluding|forbid(?:den)?|prohibit(?:ed)?)\s+(?:(?:all|any|background|generated|recorded)\s+){0,3}(?:music|musical\s+score|score|soundtrack|songs?)\b|\b(?:music|soundtrack)[-\s]+free\b/i.test(direction)
    &&!/\b(?:no|without|forbid(?:den)?|prohibit(?:ed)?|exclude|excluding)\s+(?:(?:all|any|audible|background|generated|recorded)\s+){0,3}(?:audio|sound(?:s|\s+effects?)?)\b|\b(?:must|requires?|required|remain|keep)\b[^.;\n]{0,65}\b(?:silent|silence)\b/i.test(direction);

  for (const fact of facts) {
    const properties = record(fact.properties);
    const negative = negativeAudioIntent(fact, properties);
    const locked = fact.locked === true || properties.locked === true || properties.required === true || negative;
    const direction = [properties.text, properties.description, properties.narrative_purpose, properties.transcript, properties.lyrics].map(text).filter(Boolean).join(". ");
    const role = text(properties.audio_role ?? properties.subtype).toLowerCase();
    if (locked && (absoluteAudioProhibition.test(direction)&&!(nonMusicalOnly&&musicOnlyProhibition(direction)) || (fact.type === "audio" || fact.role === "audio") && role === "silence")) {
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
    if (absoluteAudioProhibition.test(direction)&&!(nonMusicalOnly&&musicOnlyProhibition(direction))) {
      return { code: "audio_output_forbidden", message: "A standing creative constraint requires silence or prohibits music and soundtracks. Revise the constraint or remove the soundtrack before starting a paid request." };
    }
    if (!negative && requestsProtectedAudioImitation(direction)) {
      return { code: "audio_originality_required", message: "A standing creative constraint requests a protected musical or vocal imitation. Revise it before starting a paid original-audio request." };
    }
  }

  return null;
}
