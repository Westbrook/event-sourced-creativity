import { OutputConflictError, type OutputSqlAssertion } from "./output-requirements-ledger.ts";

/** Preserve every check and binding while avoiding two D1 statements per
 * individual predicate on every recovery step. No proof is cached or skipped.
 * Balanced Boolean grouping bounds depth; the assertion writer adds one token
 * binding, so each group leaves room below D1's 100-parameter ceiling. */
export function compactModel3dRecoveryAssertions(assertions: readonly OutputSqlAssertion[]): OutputSqlAssertion[] {
  const result: OutputSqlAssertion[] = [];
  let group: OutputSqlAssertion[] = [], bindings = 0;
  const balanced = (parts: string[]): string => {
    if (parts.length === 1) return "(" + parts[0] + ")";
    const middle = Math.floor(parts.length / 2);
    return "(" + balanced(parts.slice(0, middle)) + " AND " + balanced(parts.slice(middle)) + ")";
  };
  const flush = () => {
    if (!group.length) return;
    const deadlines = group.flatMap(a => a.deadlineMs === undefined ? [] : [a.deadlineMs]);
    result.push({ sql: balanced(group.map(a => a.sql)), bindings: group.flatMap(a => a.bindings ?? []),
      ...(deadlines.length ? { deadlineMs: Math.min(...deadlines) } : {}) });
    group = []; bindings = 0;
  };
  for (const assertion of assertions) {
    const length = assertion.bindings?.length ?? 0;
    if (!assertion.sql || length > 99 || assertion.deadlineMs !== undefined && !Number.isFinite(assertion.deadlineMs))
      throw new OutputConflictError("output_model3d_recovery_assertion_invalid", 409);
    if (group.length && (group.length >= 8 || bindings + length > 90)) flush();
    group.push(assertion); bindings += length;
  }
  flush(); return result;
}
