import {
  documentJobCanRecoverPresentation,
  documentJobCanRecoverProviderRender,
  documentJobFailure,
  generationFailureGuidance,
  type DocumentJob,
} from "./document-jobs.ts";
import {
  safePresentationCandidateIssues,
  type PresentationCandidateValidationIssue,
} from "./presentation-candidates.ts";

export type ActivityIssueEvidence = PresentationCandidateValidationIssue;

export type ActivityIssueDisposition =
  | "recover-saved-render"
  | "correct-mandatory-requirement"
  | "review-request"
  | "wait-and-retry"
  | "contact-administrator"
  | "inspect-receipt";

/** Reconstitute public-safe evidence instead of trusting provider-authored issue prose. */
export function activityJobEvidence(job: DocumentJob): ActivityIssueEvidence[] {
  const detail = documentJobFailure(job);
  const issues = detail?.validationIssues ?? [];
  const unique = new Map<string, ActivityIssueEvidence>();
  const latestByPage = new Map<number, number>();

  for (const issue of issues) {
    const pageIndex = Number(issue.pageIndex);
    const pageCount = Number(issue.pageCount);
    const providerAttempt = Number(issue.providerAttempt);
    if (!Number.isSafeInteger(pageIndex) || !Number.isSafeInteger(pageCount)
      || pageIndex < 0 || pageCount < 1 || pageIndex >= pageCount
      || !Number.isSafeInteger(providerAttempt) || providerAttempt < 1
      || issue.stage !== "initial" && issue.stage !== "repair") continue;

    const position = /^items\.(\d+)(?:\.|$)/u.exec(String(issue.path ?? ""));
    const globalSlideIndex = Number(issue.globalSlideIndex);
    const globalStartIndex = position && Number.isSafeInteger(globalSlideIndex)
      && globalSlideIndex > Number(position[1])
      ? globalSlideIndex - Number(position[1]) - 1
      : 0;
    if (globalStartIndex > 100) continue;

    const [safe] = safePresentationCandidateIssues(
      [{ code: String(issue.code ?? ""), path: String(issue.path ?? "$"), message: "" }],
      { pageIndex, pageCount, globalStartIndex, providerAttempt, stage: issue.stage },
    );
    if (!safe) continue;
    latestByPage.set(safe.pageIndex, Math.max(latestByPage.get(safe.pageIndex) ?? 0, safe.providerAttempt));
    const key = `${safe.globalSlideIndex ?? "-"}:${safe.pageIndex}:${safe.path}:${safe.code}`;
    const previous = unique.get(key);
    if (!previous || previous.providerAttempt <= safe.providerAttempt) unique.set(key, safe);
  }

  // Earlier alternatives remain in the retained receipt, not the current action list.
  return [...unique.values()].filter((issue) => issue.providerAttempt === latestByPage.get(issue.pageIndex)).sort((left, right) =>
    Number(right.blocking && !right.overridable) - Number(left.blocking && !left.overridable)
    || (left.globalSlideIndex ?? Number.MAX_SAFE_INTEGER) - (right.globalSlideIndex ?? Number.MAX_SAFE_INTEGER)
    || left.path.localeCompare(right.path)
    || right.providerAttempt - left.providerAttempt);
}

/** Practical next actions remain distinct from starting another paid provider operation. */
export function activityJobDisposition(job: DocumentJob): ActivityIssueDisposition {
  const detail = documentJobFailure(job);
  const guidance = generationFailureGuidance(detail, job.error ?? "", job);
  if (documentJobCanRecoverPresentation(job)
    || guidance.retryAllowed && documentJobCanRecoverProviderRender(job)) return "recover-saved-render";
  if (activityJobEvidence(job).some((issue) => !issue.overridable)) return "correct-mandatory-requirement";
  if (detail?.category === "authentication" || detail?.category === "access" || detail?.category === "quota") return "contact-administrator";
  if (detail?.category === "rate_limit" && detail.retryable) return "wait-and-retry";
  if (detail?.action === "edit_request" || activityJobEvidence(job).length) return "review-request";
  return "inspect-receipt";
}

/** Explicit support-copy omits provider prose, raw inputs, prompts, references, and request IDs. */
export function activityJobIssueReport(job: DocumentJob, documentName = ""): string {
  const detail = documentJobFailure(job);
  const guidance = generationFailureGuidance(detail, job.error ?? "", job);
  const lines = [
    "Forma activity issue report",
    `Issue: ${guidance.title}`,
    ...(documentName ? [`Document: ${documentName}`] : []),
    `Operation: ${job.kind}`,
    ...(job.result?.artifactKind ? [`Output: ${String(job.result.artifactKind)}`] : []),
    `Status: ${job.status}`,
    ...(detail?.code ? [`Reason: ${detail.code}`] : []),
    ...(detail?.category ? [`Category: ${detail.category}`] : []),
    ...(detail?.scope ? [`Scope: ${detail.scope}`] : []),
    `Job: ${job.jobId}`,
    `Requested: ${job.requestedAt}`,
    `Next step: ${activityJobDisposition(job)}`,
  ];

  for (const issue of activityJobEvidence(job)) {
    lines.push(
      "",
      `${issue.globalSlideIndex ? `Slide ${issue.globalSlideIndex} · ` : ""}${issue.code}`,
      `Field: ${issue.path}`,
      `Explanation: ${issue.message}`,
      `Requirement: ${issue.overridable ? "presentation preference" : "mandatory validation"}`,
      `Attempt: ${issue.stage} ${issue.providerAttempt}`,
    );
  }

  return lines.join("\n");
}
