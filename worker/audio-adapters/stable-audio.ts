import type { AudioProviderAdapterInput } from "./types.ts";
import { AUDIO_PROVIDER_INPUT_CONTRACTS, validateAudioProviderParameters } from "../../src/model/audio-provider-contracts.ts";

export function serializeStableAudioRequest({ prompt, profile }: AudioProviderAdapterInput) {
  const model = "fal-ai/stable-audio-3/medium/text-to-audio";
  return validateAudioProviderParameters(model, {
    prompt,
    duration: profile.durationSeconds ?? AUDIO_PROVIDER_INPUT_CONTRACTS[model]!.parameters.duration!.default,
    output_format: "mp3",
    enable_safety_checker: true,
    ...(profile.requireInstrumental ? { negative_prompt: "singing, vocals, spoken dialogue" } : {}),
  });
}
