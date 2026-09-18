/** Fixed diagnostic labels only. Never return messages, SQL, bound values or IDs. */
export function outputDatabaseMessageKind(raw: string): string | undefined {
  const message = raw.slice(0, 2048);
  if (/\b(?:CHECK|UNIQUE|FOREIGN KEY|NOT NULL) constraint failed\b|\bSQLITE_CONSTRAINT(?:_[A-Z_]+)?\b/iu.test(message)) return "d1_constraint";
  if (/\bWrong number of parameter bindings\b|\bSQLITE_RANGE\b/iu.test(message)) return "d1_binding_count";
  if (/\bD1_TYPE_ERROR\b/u.test(message)) return "d1_binding_type";
  if (/\bExpression tree is too large\b/iu.test(message)) return "d1_expression_depth";
  if (/\bparser stack overflow\b/iu.test(message)) return "d1_parser_depth";
  if (/\bmalformed JSON\b/iu.test(message)) return "d1_malformed_json";
  if (/\bambiguous column name\b/iu.test(message)) return "d1_ambiguous_column";
  if (/\bSQLITE_AUTH\b|\bnot authorized\b/iu.test(message) && /\bD1_ERROR\b|\bSQLITE_AUTH\b/u.test(message)) return "d1_sql_authorization";
  if (/\bSQL statement too long\b|\bstatement is too long\b/iu.test(message)) return "d1_statement_length";
  if (/\btoo many terms in compound SELECT\b/iu.test(message)) return "d1_compound_limit";
  if (/\btoo many SQL variables\b/iu.test(message)) return "d1_parameter_limit";
  if (/\bSQLITE_TOOBIG\b|\bstring or blob too big\b/iu.test(message)) return "d1_value_limit";
  if (/\bSQLITE_BUSY\b|\bSQLITE_LOCKED\b|\bdatabase is locked\b/iu.test(message)) return "d1_busy";
  if (/\bno such (?:table|column)\b|\bSQLITE_SCHEMA\b/iu.test(message)) return "d1_schema";
  if (/\bToo many API requests by single worker invocation\b|\bToo many subrequests\b/iu.test(message)) return "worker_subrequest_limit";
  if (/\bD1_ERROR:\s*too many queries\b/iu.test(message)) return "d1_query_limit";
  if (/\bD1_ERROR\b|\bSQLITE_ERROR\b/u.test(message)) return "d1_error";
}

export function outputDatabaseFailureKind(error: unknown): string | undefined {
  let current = error, fallback: string | undefined;
  try {
    for (let depth = 0; depth < 3 && current !== null && typeof current === "object"; depth++) {
      const message = Object.getOwnPropertyDescriptor(current, "message")?.value;
      const kind = typeof message === "string" ? outputDatabaseMessageKind(message) : undefined;
      if (kind && kind !== "d1_error") return kind;
      if (kind) fallback = kind;
      current = Object.getOwnPropertyDescriptor(current, "cause")?.value;
    }
  } catch { /* Diagnosis cannot replace the original failure. */ }
  return fallback;
}
