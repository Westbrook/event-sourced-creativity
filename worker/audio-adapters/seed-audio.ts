import type { AudioProviderAdapterInput } from "./types.ts";
import { validateAudioProviderParameters } from "../../src/model/audio-provider-contracts.ts";

/** Never enable Seed's cloned-voice or recording-reference fields implicitly. */
export function serializeSeedAudioRequest({ prompt }: AudioProviderAdapterInput) {
  return validateAudioProviderParameters("bytedance/seed-audio-1.0", { prompt, output_format: "mp3" });
}
