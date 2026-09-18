import type { DocumentJob } from "./document-jobs.ts";

export type PresentationReceiptCheckStatus = "known" | "operator_required" | "unavailable";
/** Public eligibility only. The server still verifies exact actor ownership and absence of an Output binding. */
export function documentJobCanCheckSavedPresentationReceipt(job: Pick<DocumentJob, "kind" | "status" | "sourceSurface" | "result">): boolean {
  return job.kind === "render_document" && ["failed", "canceled", "partial"].includes(job.status)
    && typeof job.sourceSurface === "string" && job.sourceSurface !== "outputs" && job.result?.artifactKind === "slides";
}
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** A receipt check never implies generation, recovery, a refund, or zero unknown usage. */
export function savedPresentationReceiptCheckResponse(original: DocumentJob, body: unknown): {job: DocumentJob; status: "known" | "operator_required"} | null {
  const response = record(body), job = record(response?.job), receipt = record(response?.reconciliation);
  if (!job || !receipt || receipt.jobId !== original.jobId || receipt.documentId !== original.documentId
    || receipt.providerRequestsSubmitted !== 0 || receipt.status !== "known" && receipt.status !== "operator_required"
    || receipt.status === "operator_required" && (typeof receipt.reason !== "string" || !receipt.reason || receipt.reason.length > 240)
    || job.jobId !== original.jobId || job.documentId !== original.documentId || job.kind !== original.kind
    || job.status !== original.status || job.sourceSurface !== original.sourceSurface
    || job.requestKey !== original.requestKey || job.requestedAt !== original.requestedAt || job.documentRevision !== original.documentRevision
    || job.attemptCount !== original.attemptCount || typeof job.updatedAt !== "string" || !Number.isFinite(Date.parse(job.updatedAt))
    || Date.parse(job.updatedAt) < Date.parse(original.updatedAt)
    || !documentJobCanCheckSavedPresentationReceipt(job as DocumentJob)) return null;
  return {job: job as DocumentJob, status: receipt.status as "known" | "operator_required"};
}
export function savedPresentationReceiptCheckMessage(status: PresentationReceiptCheckStatus): string {
  if (status === "known") return "Saved receipt checked. No new generation was started. Recovery or a new paid request needs a separate action.";
  if (status === "operator_required") return "Manual review is required. No new generation was started. The original request is unchanged and any original budget hold remains retained.";
  return "The saved receipt could not be verified. No new generation was started. Check the original request again; its billing state is unconfirmed.";
}
