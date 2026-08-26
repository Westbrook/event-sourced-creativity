import { AudioProviderInputError, type AudioProviderAdapterInput } from "./types.ts";

/** Speech receives authored spoken words only; policy text must never be read aloud. */
export function serializeGeminiSpeechRequest({ profile, spokenScript, voiceDirection }: AudioProviderAdapterInput) {
  let prompt = (spokenScript ?? profile.transcript ?? "").trim();
  if (!prompt) throw new AudioProviderInputError("audio_spoken_script_required", "Narration requires an approved written script.");
  const speakerCount = profile.speakerCount ?? 1;
  if (speakerCount > 2) throw new AudioProviderInputError("audio_speaker_count_unsupported", "Narration supports at most two distinct speakers.");
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
      output_format: "mp3",
      ...(voiceDirection ? { style_instructions: voiceDirection } : {}),
      speakers: speakerIds.slice(0, speakerCount).map((speakerId, index) => ({ speaker_id: providerSpeakerIds.get(speakerId)!, voice: index === 0 ? "Charon" : "Kore" })),
    };
  }
  return { prompt, output_format: "mp3", ...(voiceDirection ? { style_instructions: voiceDirection } : {}), voice: "Kore" };
}
