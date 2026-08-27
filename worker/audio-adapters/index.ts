import { audioAdapterContractForModel } from "../../src/model/audio.ts";
import { serializeGeminiSpeechRequest } from "./gemini-tts.ts";
import { serializeLyriaAudioRequest } from "./lyria.ts";
import { serializeSeedAudioRequest } from "./seed-audio.ts";
import { serializeSoniloAudioRequest } from "./sonilo.ts";
import { serializeStableAudioRequest } from "./stable-audio.ts";
import { AudioProviderInputError, type AudioProviderAdapterInput } from "./types.ts";

/** One pure serializer for preparation, validation, receipts and transport. */
export function serializeAudioRequest(model: string, input: AudioProviderAdapterInput): Record<string, unknown> {
  const contract = audioAdapterContractForModel(model);
  if (!contract) throw new AudioProviderInputError("audio_provider_model_unsupported", "The requested audio model is not approved.");
  switch (contract.adapterId) {
    case "fal-lyria-music": return serializeLyriaAudioRequest(input);
    case "fal-stable-audio-music": return serializeStableAudioRequest(input);
    case "fal-gemini-speech": return serializeGeminiSpeechRequest(input);
    case "fal-seed-mixed-audio": return serializeSeedAudioRequest(input);
    default: return serializeSoniloAudioRequest(model, input);
  }
}
