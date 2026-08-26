import type { AudioRequestProfile } from "../../src/model/audio.ts";

export type AudioProviderAdapterInput = {
  prompt: string;
  profile: AudioRequestProfile;
  imageUrl?: string;
  videoUrl?: string;
  spokenScript?: string;
  voiceDirection?: string;
};

export class AudioProviderInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AudioProviderInputError";
    this.code = code;
  }
}
