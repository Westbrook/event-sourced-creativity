import type { AudioProviderAdapterInput } from "./types.ts";

export function serializeStableAudioRequest({ prompt, profile }: AudioProviderAdapterInput) {
  return {
    prompt,
    duration: profile.durationSeconds ?? 30,
    output_format: "mp3",
    enable_safety_checker: true,
    ...(profile.requireInstrumental ? { negative_prompt: "singing, vocals, spoken dialogue" } : {}),
  };
}
