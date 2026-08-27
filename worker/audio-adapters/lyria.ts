import type { AudioProviderAdapterInput } from "./types.ts";
import { validateAudioProviderParameters } from "../../src/model/audio-provider-contracts.ts";

/** Lyria's schema accepts exactly one prompt and an optional approved image. */
export function serializeLyriaAudioRequest({ prompt, imageUrl }: AudioProviderAdapterInput) {
  return validateAudioProviderParameters("fal-ai/lyria3/pro", { prompt, ...(imageUrl ? { image_url: imageUrl } : {}) });
}
