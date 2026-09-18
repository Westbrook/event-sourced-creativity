/** Fixed, bounded diagnostics only. Never log authored content, identifiers,
 * SQL, bindings, stacks or arbitrary error strings; never change recovery. */
export function intakeFailureKind(cause: unknown): string {
  let current = cause;
  try {
    for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
      const raw = Object.getOwnPropertyDescriptor(current, "message")?.value;
      const message = typeof raw === "string" ? raw.slice(0, 2048) : "";
      if (/\b(?:CHECK|UNIQUE|FOREIGN KEY|NOT NULL) constraint failed\b|\bSQLITE_CONSTRAINT(?:_[A-Z_]+)?\b/iu.test(message)) return "d1_constraint";
      if (/\bWrong number of parameter bindings\b|\bSQLITE_RANGE\b/iu.test(message)) return "d1_binding_count";
      if (/\bD1_TYPE_ERROR\b/u.test(message)) return "d1_binding_type";
      if (/\bExpression tree is too large\b|\bparser stack overflow\b/iu.test(message)) return "d1_expression_depth";
      if (/\btoo many SQL variables\b/iu.test(message)) return "d1_parameter_limit";
      if (/\bSQLITE_TOOBIG\b|\bstring or blob too big\b|\bSQL statement too long\b/iu.test(message)) return "d1_size_limit";
      if (/\bSQLITE_BUSY\b|\bSQLITE_LOCKED\b|\bdatabase is locked\b/iu.test(message)) return "d1_busy";
      if (/\bno such (?:table|column)\b|\bSQLITE_SCHEMA\b/iu.test(message)) return "d1_schema";
      if (message === "stale_sequence") return "head_changed";
      if (message === "event_append_acknowledgment_invalid") return "append_acknowledgment_invalid";
      if (message === "event_append_contention") return "append_contention";
      current = Object.getOwnPropertyDescriptor(current, "cause")?.value;
    }
  } catch { /* Optional diagnostics must not replace the original outcome. */ }
  return "unknown";
}

export function recordIntakeDiagnostic(stage: "append" | "receipt", code: string, cause?: unknown) {
  const safeCode = ["project_intake_unconfirmed", "project_intake_original_unavailable", "project_intake_authority_changed"].includes(code)
    ? code : "project_intake_unconfirmed";
  try { console.warn("project_intake_refused", { stage: stage === "append" ? "append" : "receipt", code: safeCode, kind: intakeFailureKind(cause) }); }
  catch { /* Logging is not part of the write or receipt protocol. */ }
}
