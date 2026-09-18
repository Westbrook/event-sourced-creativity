import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

// Exact Scene-local verifier only. No DB, auth, provider, route or time claim.
const source = await readFile(new URL("../worker/scene-history-proof-read.ts", import.meta.url), "utf8");
const start = source.indexOf("export function assertSceneHistoryRead(");
const end = source.indexOf("\n/** Existing bounded read primitives", start);
assert.ok(start >= 0 && end > start);
class OutputConflictError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
const verify = new Function("OutputConflictError", `${stripTypeScriptTypes(source.slice(start, end)).replace(/^export /u, "")}\nreturn assertSceneHistoryRead;`)(OutputConflictError);
const row = () => ({ success: true, results: [{ current: 1 }] });

test("Scene source proof accepts exactly one numeric successful row for every expected predicate", () => {
  const values = [row(), row()];
  assert.equal(verify(values, 2), undefined);
  assert.deepEqual(values, [row(), row()], "verification cannot mutate result evidence");
});

test("Scene source proof rejects holes and every incomplete/coercible returned shape with the stable conflict", () => {
  const sparse = [row(), row()]; delete sparse[0];
  const cases = [
    [sparse, 2], [[null, row()], 2], [[undefined, row()], 2], [null, 2], [{ length: 2 }, 2],
    [[row()], 2], [[row(), row(), row()], 2], [[{ results: [{ current: 1 }] }, row()], 2],
    [[{ success: 1, results: [{ current: 1 }] }, row()], 2], [[{ success: false, results: [{ current: 1 }] }, row()], 2],
    [[{ success: true, results: [{ current: "1" }] }, row()], 2], [[{ success: true, results: [{ current: 1 }, { current: 1 }] }, row()], 2],
    [[{ success: true, results: new Array(1) }, row()], 2], [[{ success: true, results: null }, row()], 2],
    [[row()], 0], [[row()], -1], [[row()], 1.5],
  ];
  for (const [values, expected] of cases) assert.throws(() => verify(values, expected), error =>
    error instanceof OutputConflictError && error.code === "output_source_changed_during_read" && error.status === 409);
});
