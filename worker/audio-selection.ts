import {
  audioAdapterContractForModel,
  selectAudioAdapterContract,
  LYRIA_AUDIO_ADAPTER_CONTRACT,
  AudioAdapterSelectionError,
  estimateAudioProviderCostMicrousd,
  normalizeAudioRequestProfile,
  type AudioAdapterSelection,
  type AudioRequestProfile,
} from "../src/model/audio.ts";
import { audioCharacterCount } from "../src/model/audio-provider-contracts.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Legacy environment overrides apply only to the ordinary music goal. */
export function selectAudioAdapter(
  env: Pick<WorkerEnv, "FAL_AUDIO_MODEL">,
  value: unknown,
  options: { preferredModel?: string; videoReferenceAvailable?: boolean; snapshot?: Record<string, unknown> } = {},
): AudioAdapterSelection & {
  provider: "fal";
  model: string;
  adapterId: string;
  adapterVersion: string;
  capabilities: readonly string[];
  profile: AudioRequestProfile;
} {
  const defaultSelection = selectAudioAdapterContract(value, {
    snapshot: options.snapshot,
    ...(options.videoReferenceAvailable !== undefined ? { videoReferenceAvailable: options.videoReferenceAvailable } : {}),
  });
  const profile = defaultSelection.profile;
  const configuredModel = audioAdapterContractForModel(env.FAL_AUDIO_MODEL);
  const configuredMusicModel = configuredModel?.capabilities.includes("original-music") && !configuredModel.supportsVideoReference
    && !configuredModel.capabilities.includes("mixed-scene") ? configuredModel.model : undefined;
  const preferredModel = options.preferredModel ?? (defaultSelection.contract.model === LYRIA_AUDIO_ADAPTER_CONTRACT.model ? configuredMusicModel : undefined);
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

/** A paid provider receipt is immutable; today's admission policy cannot reprice it. */
export function selectRetainedAudioAdapter(model: string, value: unknown, receipt: { submittedPrompt: string; estimatedCostMicrousd?: unknown }): ReturnType<typeof selectAudioAdapter> {
  const contract = audioAdapterContractForModel(model);
  if (!contract) throw new AudioAdapterSelectionError("audio_provider_model_unsupported", "The retained audio model is not approved for recovery.");
  const profile = normalizeAudioRequestProfile(value);
  const retainedCostMicrousd = receipt.estimatedCostMicrousd;
  return {
    contract, profile, provider: "fal", model: contract.model, adapterId: contract.adapterId,
    adapterVersion: contract.adapterVersion, capabilities: contract.capabilities, reason: "recovering the original paid request",
    estimatedCostMicrousd: typeof retainedCostMicrousd === "number" && Number.isFinite(retainedCostMicrousd) && retainedCostMicrousd >= 0
      ? retainedCostMicrousd : estimateAudioProviderCostMicrousd(contract, profile, contract.pricing.mode === "per_1000_characters" ? { characterCount: audioCharacterCount(receipt.submittedPrompt) } : undefined),
  };
}
