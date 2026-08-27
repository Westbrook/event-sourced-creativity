import type { AudioRequestProfile } from "../../src/model/audio.ts";
export { AudioProviderInputError } from "../../src/model/audio-provider-contracts.ts";

export type AudioProviderAdapterInput = {
  prompt: string;
  profile: AudioRequestProfile;
  imageUrl?: string;
  videoUrl?: string;
  spokenScript?: string;
  voiceDirection?: string;
  videoDurationSeconds?: number;
};
