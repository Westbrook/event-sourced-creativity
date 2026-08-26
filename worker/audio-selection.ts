import {
  selectAudioAdapterContract,
  LYRIA_AUDIO_ADAPTER_CONTRACT,
  type AudioAdapterSelection,
  type AudioRequestProfile,
} from "../src/model/audio.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Legacy environment overrides apply only to the ordinary music goal. */
export function selectAudioAdapter(
  env: Pick<WorkerEnv, "FAL_AUDIO_MODEL">,
  value: unknown,
  options: { preferredModel?: string; videoReferenceAvailable?: boolean } = {},
): AudioAdapterSelection & {
  provider: "fal";
  model: string;
  adapterId: string;
  adapterVersion: string;
  capabilities: readonly string[];
  profile: AudioRequestProfile;
} {
  const defaultSelection = selectAudioAdapterContract(value, {
    ...(options.videoReferenceAvailable !== undefined ? { videoReferenceAvailable: options.videoReferenceAvailable } : {}),
  });
  const profile = defaultSelection.profile;
  const preferredModel = options.preferredModel ?? (defaultSelection.contract.model === LYRIA_AUDIO_ADAPTER_CONTRACT.model ? env.FAL_AUDIO_MODEL : undefined);
  const selection = selectAudioAdapterContract(profile, {
    ...(preferredModel ? { preferredModel } : {}),
    ...(options.videoReferenceAvailable !== undefined ? { videoReferenceAvailable: options.videoReferenceAvailable } : {}),
  });
  return {
    ...selection,
    provider: "fal",
    model: selection.contract.model,
    adapterId: selection.contract.adapterId,
    adapterVersion: selection.contract.adapterVersion,
    capabilities: selection.contract.capabilities,
  };
}
