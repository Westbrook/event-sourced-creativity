import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

// Real diagnostic module and exact source functions, with explicit DB/log ports.
// No HTTP authorization, production DB, provider, or live-capacity claim.
const read = path => readFile(new URL(`../worker/${path}`, import.meta.url), "utf8");
const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source, { mode: "transform" })).toString("base64");
const diagnosticUrl = moduleUrl(await read("output-proof-capacity-diagnostic.ts"));
const { recordOutputProofCapacity, outputProofCapacityDiagnostic } = await import(diagnosticUrl);
const core = await read("output-command-core.ts"), disclosure = await read("output-disclosure-proof.ts"), api = await read("experience-output-api.ts");
function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `exact source section: ${start}`);
  return stripTypeScriptTypes(source.slice(a, b), { mode: "transform" }).replace(/export /gu, "");
}
const OutputConflictError = new Function(section(core, "export class OutputConflictError", "/** This table") + "return OutputConflictError;")();
const bodies = new Function("OutputConflictError", "recordOutputProofCapacity",
  section(core, "type RetainedOutputBody", "/** Replace only the source capture") + "return {rememberOutputPrivateBody,retainedOutputBodyAssertions};"
)(OutputConflictError, recordOutputProofCapacity);
const statements = new Function("OutputConflictError", "recordOutputProofCapacity",
  section(disclosure, "function outputProofReadStatements(", "function assertOutputProofRead(") + "return outputProofReadStatements;"
)(OutputConflictError, recordOutputProofCapacity);
const historyUrl = moduleUrl(await read("scene-history-proof.ts"));
const { SCENE_HISTORY_PROOF_LIMITS } = await import(historyUrl);
const errorUrl = moduleUrl(core.slice(core.indexOf("export class OutputConflictError"), core.indexOf("/** This table")));
const adapterSource = (await read("scene-history-proof-read.ts"))
  .replace('from "./output-command-core.ts"', `from "${errorUrl}"`)
  .replace('from "./output-proof-capacity-diagnostic.ts"', `from "${diagnosticUrl}"`)
  .replace('from "./scene-history-proof.ts"', `from "${historyUrl}"`)
  .replace('import { outputProofReadStatements } from "./output-disclosure-proof.ts";', 'const outputProofReadStatements = () => { throw new Error("verification must not be reached in refusal fixtures"); };');
const { readSceneHistoryProof } = await import(moduleUrl(adapterSource));

test("diagnostics retain only fixed server-attached labels without mutating/serializing errors", () => {
  const error = new OutputConflictError("output_source_proof_too_large", 413), before = JSON.stringify(error);
  assert.equal(recordOutputProofCapacity(error, "scene_history_reads"), error);
  assert.equal(outputProofCapacityDiagnostic(error), "scene_history_reads");
  assert.equal(JSON.stringify(error), before);
  const forged = { capacityReason: "scene_history_rows" };
  for (const value of [null, "scene_history_rows", forged, Object.create(error), new Error("scene_history_reads")])
    assert.equal(outputProofCapacityDiagnostic(value), undefined);
  let accessed = false;
  const getter = Object.defineProperty({}, "capacityReason", { get() { accessed = true; throw new Error("private content"); } });
  assert.equal(outputProofCapacityDiagnostic(getter), undefined); assert.equal(accessed, false);
  const arbitrary = new Error("private content");
  recordOutputProofCapacity(arbitrary, "SELECT private_json FROM secret");
  assert.equal(outputProofCapacityDiagnostic(arbitrary), undefined);
});

test("proof statement capacity branches retain exact413 and never prepare a rejected statement", () => {
  const env = { DB: { prepare() { throw new Error("must refuse before preparation"); } } };
  for (const [assertion, reason] of [
    [{ sql: "x".repeat(100_001) }, "output_assertion_sql_bytes"],
    [{ sql: "1", bindings: Array(101).fill(null) }, "output_assertion_bindings"],
    [{ sql: "1", bindings: ["x".repeat(2_000_001)] }, "output_assertion_binding_bytes"],
  ]) assert.throws(() => statements(env, [assertion]), error => error.code === "output_source_proof_too_large"
    && error.status === 413 && outputProofCapacityDiagnostic(error) === reason);
});

test("retained body aggregate capacity keeps the original bound and413 identity", () => {
  const scope = { ownerUserId: "owner", projectId: "project", documentId: "document" };
  bodies.rememberOutputPrivateBody(scope, "event", JSON.stringify({ text: "x".repeat(16 * 1024 * 1024) }));
  assert.throws(() => bodies.retainedOutputBodyAssertions(scope), error => error.code === "output_source_proof_too_large"
    && error.status === 413 && outputProofCapacityDiagnostic(error) === "private_source_raw_bytes");
});

test("Scene adapter maps genuine capacity but preserves unknown database failures by identity", async () => {
  let calls = 0;
  const env = { DB: { prepare() { return { bind() { return { async all() {
    calls++; return { success: true, results: [{ owner_head: 1, source_count: SCENE_HISTORY_PROOF_LIMITS.rows + 1, source_head: 1 }] };
  } }; } }; } } };
  await assert.rejects(readSceneHistoryProof(env, { streamId: "creative:owner", expectedOwnerHead: 1 }), error =>
    error.code === "output_source_proof_too_large" && error.status === 413 && outputProofCapacityDiagnostic(error) === "scene_history_rows");
  assert.equal(calls, 1);
  const original = new Error("database transport unavailable");
  env.DB.prepare = () => { throw original; };
  await assert.rejects(readSceneHistoryProof(env, { streamId: "creative:owner", expectedOwnerHead: 1 }), error => error === original);
});

test("native refusal response stays byte-identical; fixed capacity is log-only and code/status-gated", async () => {
  const logs = [], logger = { warn: (...args) => logs.push(args) };
  const unavailable = new Function("diagnosticCodes", "console",
    section(api, "const unavailable =", "async function refused(") + "return unavailable;"
  )(new Set(["output_source_proof_too_large"]), logger);
  const before = unavailable("output_source_proof_too_large", 413, { stage: "prepare_preflight_execute", kind: "coded" });
  const after = unavailable("output_source_proof_too_large", 413, { stage: "prepare_preflight_execute", kind: "coded", capacity: "scene_history_reads" });
  assert.equal(await after.text(), await before.text()); assert.equal(after.status, before.status);
  assert.deepEqual([...after.headers], [...before.headers]);
  assert.deepEqual(logs[1], ["experience_output_refused", { code: "output_source_proof_too_large", status: 413,
    stage: "prepare_preflight_execute", kind: "coded", capacity: "scene_history_reads" }]);
  // Exact catch expression is executed, not a reconstruction of its gate.
  const gate = api.match(/const capacity = ([^\n]+);/u)?.[1]; assert.ok(gate);
  const decide = new Function("code", "item", "cause", "outputProofCapacityDiagnostic", `return ${gate};`);
  const error = recordOutputProofCapacity(new Error("private source"), "scene_history_reads");
  assert.equal(decide("output_source_proof_too_large", { status: 413 }, error, outputProofCapacityDiagnostic), "scene_history_reads");
  for (const [code, status] of [["other_error", 413], ["output_source_proof_too_large", 409], ["output_source_proof_too_large", "413"]])
    assert.equal(decide(code, { status }, error, outputProofCapacityDiagnostic), undefined);
});
