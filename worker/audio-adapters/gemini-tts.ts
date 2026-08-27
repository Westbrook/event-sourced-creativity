import { AudioProviderInputError, type AudioProviderAdapterInput } from "./types.ts";
import { GEMINI_SPEECH_INPUT_POLICY, validateAudioProviderParameters } from "../../src/model/audio-provider-contracts.ts";

/** Shared by planning and submission so alias expansion is budgeted exactly once. */
export function prepareGeminiSpeechScript({ profile, spokenScript }: Pick<AudioProviderAdapterInput, "profile" | "spokenScript">) {
  const script = spokenScript ?? profile.transcript ?? "";
  if (typeof script !== "string") throw new AudioProviderInputError("audio_spoken_script_invalid", "The approved spoken script must be text.");
  let prompt = script.trim();
  if (!prompt) throw new AudioProviderInputError("audio_spoken_script_required", "Narration requires an approved written script.");
  const speakerCount = profile.speakerCount ?? 1;
  if (!Number.isSafeInteger(speakerCount) || speakerCount <= 0) throw new AudioProviderInputError("audio_speaker_count_invalid", "The number of speakers must be a positive whole number.");
  if (speakerCount > GEMINI_SPEECH_INPUT_POLICY.maxSpeakers) throw new AudioProviderInputError("audio_speaker_count_unsupported", "Narration supports at most two distinct speakers.");
  if (speakerCount > 1) {
    const speakerIds = [...new Set([...prompt.matchAll(/^\s*([\p{L}][\p{L}\p{N}_ -]{0,31})\s*[:：]/gmu)].map((match) => match[1]!.trim()))];
    if (speakerIds.length !== speakerCount) {
      throw new AudioProviderInputError("audio_speaker_script_invalid", "A two-person conversation requires exactly two consistently labeled speakers in the approved script.");
    }
    const providerSpeakerIds = new Map(speakerIds.slice(0, speakerCount).map((speakerId, index) => [speakerId, `Speaker${index + 1}`]));
    prompt = prompt.replace(/^\s*([\p{L}][\p{L}\p{N}_ -]{0,31})\s*[:：]/gmu, (match, speakerId: string) => {
      const normalized = providerSpeakerIds.get(speakerId.trim());
      return normalized ? `${normalized}:` : match;
    });
    return {
      prompt,
      speakers: speakerIds.slice(0, speakerCount).map((speakerId, index) => ({ speaker_id: providerSpeakerIds.get(speakerId)!, voice: index === 0 ? "Charon" : "Kore" })),
    };
  }
  return { prompt, voice: "Kore" };
}

/** Speech receives authored spoken words only; policy text must never be read aloud. */
export function serializeGeminiSpeechRequest(input: AudioProviderAdapterInput) {
  return validateAudioProviderParameters("fal-ai/gemini-3.1-flash-tts", {
    ...prepareGeminiSpeechScript(input), output_format: "mp3",
    ...(input.voiceDirection !== undefined ? { style_instructions: input.voiceDirection } : {}),
  });
}
