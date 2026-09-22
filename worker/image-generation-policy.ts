import { OPENAI_IMAGE_GENERATION_CONTRACT } from "./openai-image-route-contract.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Drafts share the full OpenAI prompt/input pipeline and always use Flare. */
export const DRAFT_IMAGE_MODEL = "gpt-image-2.5-flare";
export function openAIImageModel(env: Pick<WorkerEnv, "OPENAI_IMAGE_MODEL">, quality?: string): string {
  return quality === "low" ? DRAFT_IMAGE_MODEL : env.OPENAI_IMAGE_MODEL ?? OPENAI_IMAGE_GENERATION_CONTRACT.defaults.model;
}

/** Keep Draft admission, provider health and execution on the same identity. */
export function draftImageEnvironment(env: WorkerEnv): WorkerEnv {
  return { ...env, FORMA_IMAGE_PROVIDER: "openai", OPENAI_IMAGE_MODEL: DRAFT_IMAGE_MODEL };
}
