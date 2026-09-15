import { OutputConflictError, type OutputSqlAssertion } from "./output-requirements-ledger.ts";

// Only groups created in this module can be flattened. A mutated returned
// assertion loses this optimization; its currently supplied SQL still wins.
const groups = new WeakMap<OutputSqlAssertion, { fingerprint: string; leaves: OutputSqlAssertion[] }>();
const fingerprint = (a: OutputSqlAssertion) => JSON.stringify([a.sql, a.bindings ?? [], a.deadlineMs ?? null]);
const validate = (a: OutputSqlAssertion) => {
  if (!a || typeof a.sql !== "string" || !a.sql || a.bindings !== undefined && (!Array.isArray(a.bindings)
    || a.bindings.length > 99 || Array.from(a.bindings).some(v => v !== null && typeof v !== "string" && !(typeof v === "number" && Number.isFinite(v))))
    || a.deadlineMs !== undefined && !(typeof a.deadlineMs === "number" && Number.isFinite(a.deadlineMs)))
    throw new OutputConflictError("output_model3d_recovery_assertion_invalid", 409);
};

/** Preserve every check and binding while avoiding two D1 statements per
 * individual predicate on every recovery step. No proof is cached or skipped.
 * Our own groups are flattened before repacking: repeatedly nesting groups
 * can exceed D1's expression depth independently of parameter count.
 * Every distinct predicate is rechecked; only exact duplicate leaves coalesce.
 * The assertion writer adds one token
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
    const combined = { sql: balanced(group.map(a => a.sql)), bindings: group.flatMap(a => a.bindings ?? []),
      ...(deadlines.length ? { deadlineMs: Math.min(...deadlines) } : {}) };
    groups.set(combined, { fingerprint: fingerprint(combined), leaves: group.map(a => ({...a, bindings:[...(a.bindings ?? [])]})) });
    result.push(combined);
    group = []; bindings = 0;
  };
  const leaves = assertions.flatMap(a => {
    validate(a);
    const prior = groups.get(a);
    return prior?.fingerprint === fingerprint(a) ? prior.leaves : [a];
  });
  const seen = new Set<string>();
  for (const assertion of leaves) {
    validate(assertion);
    const length = assertion.bindings?.length ?? 0;
    if (!assertion.sql || length > 99 || assertion.deadlineMs !== undefined && !Number.isFinite(assertion.deadlineMs))
      throw new OutputConflictError("output_model3d_recovery_assertion_invalid", 409);
    const identity = fingerprint(assertion);
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (group.length && (group.length >= 8 || bindings + length > 90)) flush();
    group.push(assertion); bindings += length;
  }
  flush(); return result;
}
