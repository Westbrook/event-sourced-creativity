/** Keep authoring, confirmation, and portable history on the same reason policy. */
export const OUTPUT_SCOPE_AMENDMENT_REASON_MAX_LENGTH = 2000;

export type OutputScopeAmendmentReasonIssue =
  | "invalid_output_scope_amendment_reason"
  | "output_scope_amendment_reason_required"
  | "output_scope_amendment_reason_too_long"
  | "output_scope_amendment_reason_control_characters";

/**
 * Validate the original value before any caller trims or omits a blank reason.
 * The limit uses UTF-16 code units, matching String.length and HTML maxlength.
 * This preserves the existing export policy: Cc/Cf characters are forbidden
 * except TAB, CR, and LF. In particular, format characters such as ZWJ and BOM
 * are not silently removed or treated as blank. No authored text is changed.
 */
export function outputScopeAmendmentReasonIssue(
  value: unknown,
  options: { required?: boolean } = {},
): OutputScopeAmendmentReasonIssue | null {
  if (value === undefined) return options.required ? "output_scope_amendment_reason_required" : null;
  if (typeof value !== "string") return "invalid_output_scope_amendment_reason";
  if (value.length > OUTPUT_SCOPE_AMENDMENT_REASON_MAX_LENGTH) return "output_scope_amendment_reason_too_long";
  if (/[\p{Cc}\p{Cf}]/u.test(value.replace(/[\t\r\n]/gu, ""))) return "output_scope_amendment_reason_control_characters";
  if (options.required && value.trim().length === 0) return "output_scope_amendment_reason_required";
  return null;
}

/** Validation only; a true result is not evidence of authorization or ancestry. */
export function isOutputScopeAmendmentReason(
  value: unknown,
  options: { required?: boolean } = {},
): boolean {
  return outputScopeAmendmentReasonIssue(value, options) === null;
}
