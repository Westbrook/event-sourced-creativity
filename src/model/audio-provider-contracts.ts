/**
 * The fields Forma actually sends, checked against each endpoint's Fal OpenAPI
 * schema on 2026-08-26. This is an approved subset, not every provider option.
 * See docs/evaluations/audio-provider-contracts.md for sources and local policies.
 */
type AudioParameter = {
  type: "string" | "number" | "integer" | "boolean" | "speakers";
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  values?: readonly (string | number | boolean)[];
  default?: string | number | boolean;
  url?: boolean;
};

export type AudioProviderInputContract = {
  parameters: Readonly<Record<string, AudioParameter>>;
  /** An application budget when the provider publishes no character maximum. */
  maxPromptCharacters: number;
};

export const GEMINI_SPEECH_INPUT_POLICY = {
  maxPromptCharacters: 50_000,
  maxStyleCharacters: 4_000,
  inputTokenLimit: 8_192,
  wrapperTokenAllowance: 1_024,
  // Conservative local UTF-8 budget, NOT an exact Gemini token count. Fal's
  // undocumented wrapper also needs headroom; no character/token ratio is safe.
  maxCombinedUtf8Bytes: 7_168,
  targetScriptUtf8Bytes: 6_000,
  maxSpeakers: 2,
} as const;

export const GEMINI_SPEECH_VOICES = [
  "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe", "Callirrhoe", "Charon", "Despina",
  "Enceladus", "Erinome", "Fenrir", "Gacrux", "Iapetus", "Kore", "Laomedeia", "Leda", "Orus", "Pulcherrima",
  "Puck", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi",
] as const;

const prompt: AudioParameter = { type: "string", required: true };
const videoUrl: AudioParameter = { type: "string", required: true, url: true };
const singleSample: AudioParameter = { type: "integer", minimum: 1, maximum: 3, values: [1], default: 1 };
const soundEffectsFormat: AudioParameter = { type: "string", values: ["wav", "mp3", "aac", "flac"], default: "aac" };

export const AUDIO_PROVIDER_INPUT_CONTRACTS: Readonly<Record<string, AudioProviderInputContract>> = {
  "fal-ai/lyria3/pro": {
    maxPromptCharacters: 5_000,
    parameters: { prompt: { ...prompt, minLength: 1, maxLength: 5_000 }, image_url: { type: "string", url: true } },
  },
  "fal-ai/stable-audio-3/medium/text-to-audio": {
    maxPromptCharacters: 5_000,
    parameters: {
      prompt, negative_prompt: { type: "string", default: "" },
      duration: { type: "number", minimum: 1, maximum: 380, default: 30 },
      output_format: { type: "string", values: ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac"], default: "mp3" },
      enable_safety_checker: { type: "boolean", values: [true], default: true },
    },
  },
  "sonilo/v1.1/text-to-music": {
    maxPromptCharacters: 5_000,
    parameters: { prompt, duration: { type: "integer", minimum: 1, maximum: 600, default: 90 }, num_samples: singleSample },
  },
  "sonilo/v1.1/text-to-sound-effects": {
    maxPromptCharacters: 5_000,
    parameters: { prompt, duration: { type: "integer", minimum: 1, maximum: 180, default: 8 }, audio_format: soundEffectsFormat },
  },
  "fal-ai/gemini-3.1-flash-tts": {
    maxPromptCharacters: GEMINI_SPEECH_INPUT_POLICY.maxPromptCharacters,
    parameters: {
      prompt: { ...prompt, minLength: 1, maxLength: GEMINI_SPEECH_INPUT_POLICY.maxPromptCharacters },
      style_instructions: { type: "string", maxLength: GEMINI_SPEECH_INPUT_POLICY.maxStyleCharacters },
      voice: { type: "string", values: GEMINI_SPEECH_VOICES, default: "Kore" },
      speakers: { type: "speakers" },
      output_format: { type: "string", values: ["wav", "mp3", "ogg_opus"], default: "mp3" },
    },
  },
  "bytedance/seed-audio-1.0": {
    maxPromptCharacters: 2_048,
    parameters: {
      prompt: { ...prompt, maxLength: 2_048 },
      output_format: { type: "string", values: ["wav", "mp3", "pcm", "ogg_opus"], default: "mp3" },
    },
  },
  "sonilo/v1.1/video-to-music": {
    maxPromptCharacters: 5_000,
    parameters: {
      video_url: videoUrl, prompt: { type: "string" }, num_samples: singleSample,
      duration: { type: "number", minimum: 1, maximum: 600 },
    },
  },
  "sonilo/v1.1/video-to-video-sound-effects": {
    maxPromptCharacters: 5_000,
    parameters: { video_url: videoUrl, prompt: { type: "string" }, audio_format: soundEffectsFormat },
  },
};

export class AudioProviderInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(code: string, message: string, field = "prompt") {
    super(message);
    this.name = "AudioProviderInputError";
    this.code = code;
    this.field = field;
  }
}

export const audioUtf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export const audioCharacterCount = (value: string) => Array.from(value).length;
export const geminiSpeechInputBytes = (script: string, style = "") => audioUtf8Bytes(style ? `${style}\n\n${script}` : script);

function parameterFailure(field: string, message: string): never {
  throw new AudioProviderInputError(field === "duration" ? "audio_duration_invalid" : "audio_parameter_invalid", message, field);
}

/** Check the complete serialized payload, before any uploads or queue mutation. */
export function validateAudioProviderParameters<T extends Record<string, unknown>>(
  model: string,
  input: T,
  options: { videoDurationSeconds?: number } = {},
): T {
  const contract = Object.hasOwn(AUDIO_PROVIDER_INPUT_CONTRACTS, model) ? AUDIO_PROVIDER_INPUT_CONTRACTS[model] : undefined;
  if (!contract) throw new AudioProviderInputError("audio_provider_model_unsupported", "The requested audio model is not approved.");
  for (const field of Object.keys(input)) {
    if (!Object.hasOwn(contract.parameters, field)) parameterFailure(field, `The selected audio adapter does not support the ${field} parameter.`);
  }
  for (const [field, rule] of Object.entries(contract.parameters)) {
    const value = input[field];
    if (value === undefined) {
      if (rule.required) parameterFailure(field, `The audio request requires ${field}.`);
      continue;
    }
    if (rule.type === "speakers") {
      // Fal advertises up to ten; Google's model guide supports two. Forma's
      // approved subset remains two and never opts into extra voices implicitly.
      if (!Array.isArray(value) || value.length !== GEMINI_SPEECH_INPUT_POLICY.maxSpeakers) parameterFailure(field, "A conversation requires exactly two approved speaker configurations.");
      const aliases = new Set<string>();
      for (const speaker of value) {
        if (!speaker || typeof speaker !== "object" || Array.isArray(speaker)
          || Object.keys(speaker).some((key) => !["speaker_id", "voice"].includes(key))
          || typeof speaker.speaker_id !== "string" || !/^\w+$/u.test(speaker.speaker_id)
          || !GEMINI_SPEECH_VOICES.includes(speaker.voice) || aliases.has(speaker.speaker_id)) parameterFailure(field, "Each speaker needs a unique provider-safe alias and an approved voice.");
        aliases.add(speaker.speaker_id);
      }
      const used = new Set([...String(input.prompt ?? "").matchAll(/^\s*([\p{L}][\p{L}\p{N}_ -]{0,31})\s*[:：]/gmu)].map((match) => match[1]!.trim()));
      if (used.size !== aliases.size || [...used].some((alias) => !aliases.has(alias))) parameterFailure(field, "The spoken script must use exactly the configured speaker aliases.");
      if (input.voice !== undefined) parameterFailure("voice", "Choose either a single voice or a conversation, not both.");
    } else if (rule.type === "number" || rule.type === "integer") {
      if (typeof value !== "number" || !Number.isFinite(value) || rule.type === "integer" && !Number.isSafeInteger(value)
        || rule.minimum !== undefined && value < rule.minimum || rule.maximum !== undefined && value > rule.maximum) {
        parameterFailure(field, `${field} must be ${rule.type === "integer" ? "a whole number" : "a finite number"} between ${rule.minimum} and ${rule.maximum}.`);
      }
    } else if (rule.type === "boolean") {
      if (typeof value !== "boolean") parameterFailure(field, `${field} must be true or false.`);
    } else {
      if (typeof value !== "string") parameterFailure(field, `${field} must be text.`);
      const length = audioCharacterCount(value);
      if (rule.minLength !== undefined && length < rule.minLength) parameterFailure(field, `${field} must not be empty.`);
      if (rule.maxLength !== undefined && length > rule.maxLength) {
        throw new AudioProviderInputError(field === "prompt" ? "audio_prompt_too_long" : "audio_style_instructions_too_long", `${field} exceeds the selected audio model's ${rule.maxLength.toLocaleString()}-character limit.`, field);
      }
      if (rule.url) {
        let url: URL;
        try { url = new URL(value); } catch { parameterFailure(field, `${field} must be an approved HTTP or HTTPS URL.`); }
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) parameterFailure(field, `${field} must be an approved HTTP or HTTPS URL without credentials.`);
      }
    }
    if (rule.values && !rule.values.includes(value as string | number | boolean)) parameterFailure(field, `${field} is not an approved value for this audio request.`);
  }
  const submittedPrompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!submittedPrompt.trim()) throw new AudioProviderInputError("audio_prompt_required", "The document did not produce usable audio direction.");
  if (audioCharacterCount(submittedPrompt) > contract.maxPromptCharacters) {
    throw new AudioProviderInputError("audio_prompt_too_long", `The audio direction exceeds Forma's ${contract.maxPromptCharacters.toLocaleString()}-character preparation budget for this model.`);
  }
  if (model === "fal-ai/gemini-3.1-flash-tts" && geminiSpeechInputBytes(submittedPrompt, String(input.style_instructions ?? "")) > GEMINI_SPEECH_INPUT_POLICY.maxCombinedUtf8Bytes) {
    throw new AudioProviderInputError("audio_input_budget_exceeded", `The complete spoken script and voice direction exceed Forma's ${GEMINI_SPEECH_INPUT_POLICY.maxCombinedUtf8Bytes.toLocaleString()}-byte safety budget for Gemini's input-token limit. Shorten or split the script; approved spoken words are never truncated.`);
  }
  if (options.videoDurationSeconds !== undefined && typeof input.duration === "number" && input.duration > options.videoDurationSeconds) {
    throw new AudioProviderInputError("audio_duration_exceeds_video", "Synchronized audio cannot be longer than the approved video clip.", "duration");
  }
  return input;
}
