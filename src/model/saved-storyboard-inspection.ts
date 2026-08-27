import type { GenerationInputInspection } from "./generation-inputs.ts";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";

/** Inspection may request only an existing, authenticated, same-origin image. */
export function savedStoryboardMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^\/api\/media\/[A-Za-z0-9._~%+-]+$/u.test(value)) return null;
  try {
    const key = decodeURIComponent(value.slice("/api/media/".length));
    return /^u-[A-Za-z0-9_-]+\/generated\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:jpg|jpeg|png|webp)$/u.test(key) ? value : null;
  } catch { return null; }
}

/** A view of the original private checkpoint, never an artifact or reuse approval. */
export function savedStoryboardInspection(inspection: GenerationInputInspection) {
  const job = record(inspection.receipt.job);
  if (!inspection.retained || inspection.outcome !== "failed" || job.kind !== "render_document"
    || job.artifact_kind !== "storyboard" || !["failed", "partial", "canceled"].includes(text(job.status))) return null;
  const checkpoint = record(inspection.receipt.artifact_checkpoint), plan = record(checkpoint.plan);
  const planned = Array.isArray(plan.items) ? plan.items : [];
  const rendered = Array.isArray(checkpoint.rendered_items) ? checkpoint.rendered_items : [];
  if (!planned.length || planned.length > 24 || !rendered.length || rendered.length > planned.length
    || planned.some((item) => !Object.keys(record(item)).length)
    || rendered.some((item) => !Object.keys(record(item)).length)) return null;
  return {
    title: text(plan.title), summary: text(plan.summary), sourceRevision: text(job.document_revision),
    recordedFrameCount: rendered.length, totalFrameCount: planned.length, complete: false as const,
    frames: planned.map((item, index) => {
      const direction = record(item), frame = record(rendered[index]);
      return {
        index: index + 1, title: text(direction.title), body: text(direction.body),
        notes: text(direction.notes), imagePrompt: text(direction.image_prompt), recorded: index < rendered.length,
        mediaUrl: savedStoryboardMediaUrl(frame.media_url),
        provider: text(frame.provider), model: text(frame.provider_model),
      };
    }),
  };
}
