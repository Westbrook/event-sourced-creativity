import assert from "node:assert/strict";
import test from "node:test";
import { intakeFailureKind, recordIntakeDiagnostic } from "../worker/project-intake-diagnostic.ts";

test("intake diagnostics classify bounded causes without exposing private messages", () => {
  for (const [message, expected] of [
    ["NOT NULL constraint failed: private_table.secret", "d1_constraint"],
    ["D1_ERROR: Wrong number of parameter bindings", "d1_binding_count"],
    ["D1_TYPE_ERROR private", "d1_binding_type"], ["parser stack overflow", "d1_expression_depth"],
    ["too many SQL variables", "d1_parameter_limit"], ["SQLITE_TOOBIG", "d1_size_limit"],
    ["database is locked", "d1_busy"], ["no such column: private", "d1_schema"],
    ["stale_sequence", "head_changed"], ["event_append_acknowledgment_invalid", "append_acknowledgment_invalid"],
    ["event_append_contention", "append_contention"], ["private request content", "unknown"],
  ]) assert.equal(intakeFailureKind(new Error(message)), expected);
  assert.equal(intakeFailureKind(new Error("wrapper", { cause: new Error("SQLITE_RANGE") })), "d1_binding_count");
  assert.equal(intakeFailureKind(new Error("x".repeat(2048) + "SQLITE_RANGE")), "unknown");
  const cycle: {cause?: unknown} = {}; cycle.cause = cycle;
  assert.equal(intakeFailureKind(cycle), "unknown");
  let reads = 0;
  assert.equal(intakeFailureKind(Object.defineProperties({}, {
    message: {get() { reads++; return "SQLITE_RANGE"; }}, cause: {get() { reads++; return {}; }},
  })), "unknown");
  assert.equal(reads, 0);
});

test("intake diagnostic output is fixed and logger failure cannot change recovery", () => {
  const original = console.warn, rows: unknown[][] = [];
  try {
    console.warn = (...args) => { rows.push(args); };
    recordIntakeDiagnostic("append", "private-code", new Error("NOT NULL constraint failed: secret"));
    recordIntakeDiagnostic("receipt", "project_intake_original_unavailable");
    assert.deepEqual(rows, [
      ["project_intake_refused", {stage:"append",code:"project_intake_unconfirmed",kind:"d1_constraint"}],
      ["project_intake_refused", {stage:"receipt",code:"project_intake_original_unavailable",kind:"unknown"}],
    ]);
    console.warn = () => { throw Error("logger failed"); };
    assert.doesNotThrow(() => recordIntakeDiagnostic("append", "project_intake_unconfirmed"));
  } finally { console.warn = original; }
});
