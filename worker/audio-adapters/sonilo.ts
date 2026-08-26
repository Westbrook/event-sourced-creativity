import {
  SONILO_MUSIC_ADAPTER_CONTRACT,
  SONILO_SOUND_EFFECTS_ADAPTER_CONTRACT,
  SONILO_VIDEO_MUSIC_ADAPTER_CONTRACT,
  SONILO_VIDEO_SOUND_EFFECTS_ADAPTER_CONTRACT,
} from "../../src/model/audio.ts";
import { AudioProviderInputError, type AudioProviderAdapterInput } from "./types.ts";

/** Sonilo has distinct capability endpoints rather than one interchangeable schema. */
export function serializeSoniloAudioRequest(model: string, { prompt, profile, videoUrl }: AudioProviderAdapterInput) {
  switch (model) {
    case SONILO_MUSIC_ADAPTER_CONTRACT.model:
      return { prompt, duration: profile.durationSeconds ?? 90, num_samples: 1 };
    case SONILO_SOUND_EFFECTS_ADAPTER_CONTRACT.model:
      return { prompt, duration: profile.durationSeconds ?? 8, audio_format: "mp3" };
    case SONILO_VIDEO_MUSIC_ADAPTER_CONTRACT.model:
      if (!videoUrl) throw new AudioProviderInputError("audio_video_reference_required", "Video scoring requires an explicitly approved video.");
      return { video_url: videoUrl, prompt, num_samples: 1, ...(profile.durationSeconds ? { duration: profile.durationSeconds } : {}) };
    case SONILO_VIDEO_SOUND_EFFECTS_ADAPTER_CONTRACT.model:
      if (!videoUrl) throw new AudioProviderInputError("audio_video_reference_required", "Video sound effects require an explicitly approved video.");
      // This endpoint always processes the entire clip; duration is not accepted.
      return { video_url: videoUrl, prompt, audio_format: "mp3" };
    default:
      throw new AudioProviderInputError("audio_provider_model_unsupported", "The requested Sonilo endpoint is not approved.");
  }
}
