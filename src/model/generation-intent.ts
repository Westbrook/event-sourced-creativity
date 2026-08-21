import type { GenerationReadiness } from "./generation-readiness.ts";

export type UserRequestedImageGeneration = "preview" | "generate";

/** Narrow capability boundary so every entry point can share one paid-work gate. */
export type ReadyImageGenerationExecutor = {
  ensureGenerationReadiness: (
    kind: UserRequestedImageGeneration,
    options: { sourcePreviewId?: string | null; sourceSurface?: string },
  ) => Promise<GenerationReadiness | null>;
  generationRiskAcknowledged: (requestKey: string) => boolean;
  preview: (sourceSurface?: string) => Promise<unknown>;
  generate: (options: { sourceSurface?: string; sourcePreviewId?: string }) => Promise<unknown>;
  toast: (message: string) => void;
};

/**
 * A contextual suggestion is still paid provider work. Never queue it before the
 * same document-specific health, budget, safety, and acknowledgement checks used
 * by the primary generation controls have explicitly passed.
 */
export async function runReadyImageGeneration(
  executor: ReadyImageGenerationExecutor,
  kind: UserRequestedImageGeneration,
  options: { sourceSurface: string; sourcePreviewId?: string | null },
) {
  const sourcePreviewId = kind === "generate" ? options.sourcePreviewId ?? null : null;
  let readiness: GenerationReadiness | null;

  try {
    readiness = await executor.ensureGenerationReadiness(kind, {
      sourcePreviewId,
      sourceSurface: options.sourceSurface,
    });
  } catch (error) {
    executor.toast(error instanceof Error ? error.message : "Generation readiness could not be confirmed.");
    return false;
  }

  if (!readiness || readiness.status !== "ready" && (
    readiness.status !== "review" || !executor.generationRiskAcknowledged(readiness.requestKey)
  )) {
    executor.toast(readiness?.status === "review"
      ? "Review and acknowledge the generation warning in the document controls first."
      : readiness?.summary || "Generation readiness could not be confirmed.");
    return false;
  }

  if (kind === "preview") await executor.preview(options.sourceSurface);
  else await executor.generate({
    sourceSurface: options.sourceSurface,
    ...(sourcePreviewId ? { sourcePreviewId } : {}),
  });
  return true;
}
