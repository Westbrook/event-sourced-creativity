/** Shared admission contract: JavaScript length counts UTF-16 code units, not code points. */
export const DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH = 120;
export type DocumentRenderGuidanceField = "audience" | "tone";
export type DocumentRenderGuidanceIssue = {
  field: DocumentRenderGuidanceField;
  code: "too_long" | "invalid_type";
  length: number | null;
  maximum: number;
};
export function documentRenderGuidance(input: { audience?: unknown; tone?: unknown }) {
  const values = { audience: "", tone: "" };
  const issues: DocumentRenderGuidanceIssue[] = [];
  for (const field of ["audience", "tone"] as const) {
    const raw = input[field];
    if (raw !== undefined && raw !== null && typeof raw !== "string") {
      issues.push({ field, code: "invalid_type", length: null, maximum: DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH });
      continue;
    }
    values[field] = typeof raw === "string" ? raw.trim() : "";
    if (values[field].length > DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH) {
      issues.push({ field, code: "too_long", length: values[field].length, maximum: DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH });
    }
  }
  return { ...values, issues };
}
/** Public errors contain field names/counts only, never the submitted guidance. */
export function documentRenderGuidanceProblem(input: { audience?: unknown; tone?: unknown }) {
  const checked = documentRenderGuidance(input);
  if (!checked.issues.length) return null;
  return {
    error: checked.issues.some(issue => issue.code === "invalid_type") ? "document_render_guidance_invalid" : "document_render_guidance_too_long",
    message: "Audience and Tone must be text, each no longer than 120 UTF-16 code units after trimming outer whitespace.",
    fieldErrors: checked.issues,
    attemptSubmission: "not-submitted" as const,
  };
}
