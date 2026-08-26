import type { AudioProviderAdapterInput } from "./types.ts";

/** Never enable Seed's cloned-voice or recording-reference fields implicitly. */
export function serializeSeedAudioRequest({ prompt }: AudioProviderAdapterInput) {
  return { prompt, output_format: "mp3" };
}
