import type { AudioProviderAdapterInput } from "./types.ts";

/** Lyria's schema accepts exactly one prompt and an optional approved image. */
export function serializeLyriaAudioRequest({ prompt, imageUrl }: AudioProviderAdapterInput) {
  return { prompt, ...(imageUrl ? { image_url: imageUrl } : {}) };
}
