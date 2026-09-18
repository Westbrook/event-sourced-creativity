import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { classifyProviderFailure, publicFailureDetail } from "../worker/provider-errors.ts";
import { normalizePromptTechnique } from "../src/model/prompt-structures.ts";
import { documentGenerationRevision, documentGenerationRequestKey } from "../src/model/document-jobs.ts";
import { model3dNativeCheckpoint, MODEL3D_PRIVATE_CHECKPOINT_KEYS } from "../worker/output-model3d-terminal.ts";
import { createModel3dOutputContract } from "../src/model/output-model3d-contract.ts";

// Actual declaration extraction only. No worker startup, database, provider or
// browser. Unrelated serializer branches are not claimed by these native rows.
const sourceURL = process.env.FORMA_FAILURE_COPY_SOURCE
  ? new URL(process.env.FORMA_FAILURE_COPY_SOURCE) : new URL("../worker/document-jobs-api.ts", import.meta.url);
const source = readFileSync(sourceURL, "utf8"), tree = ts.createSourceFile(sourceURL.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ["parseResult", "parseRequest", "sceneConfigurationFromRequest", "generationRevisionFromRequest", "generationRequestIdentity",
  "parentJobIdFromRequest", "fanKindFromRequest", "classifyDocumentJobFailure", "errorDetailFromResult", "failureProgressMessage", "queueRecoveryPresentation", "serializeJob", "safeScopedJob"];
const declarations = names.map(name => {
  const matches = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(matches.length, 1, name); return matches[0].getText(tree);
});
for (const name of ["LOCAL_PERSISTENCE_FAILURE", "SOURCE_FIDELITY_FAILURE", "OUTPUT_STORYBOARD_RETAINED_CHECKPOINT_KEYS", "consentedAdaptiveJob", "certifiedAdaptiveRows"]) {
  const matches = tree.statements.filter(ts.isVariableStatement).flatMap(node => node.declarationList.declarations).filter(node => node.name.getText(tree) === name);
  assert.equal(matches.length, 1, name); declarations.push("const " + matches[0].getText(tree) + ";");
}
const dependencies = { classifyProviderFailure, publicFailureDetail, normalizePromptTechnique, documentGenerationRevision,
  documentGenerationRequestKey, model3dNativeCheckpoint, MODEL3D_PRIVATE_CHECKPOINT_KEYS };
const compiled = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const helpers = new Function(...Object.keys(dependencies), compiled + "\nreturn {failureProgressMessage,serializeJob,safeScopedJob,errorDetailFromResult,classifyDocumentJobFailure};")(...Object.values(dependencies));
const oldImage = "The provider connection ended before an image was returned.";
const expected = {
  model3d_publication_unconfirmed: "Confirmation of the saved 3D result was interrupted. Recover this saved job to check its original result; no new generation will be purchased.",
  model3d_local_persistence_failed: "Rodin finished this 3D request, but its files or saved result could not be stored. Recover the original request to finish saving it without purchasing another generation.",
};
const detail = (code, patch = {}) => ({ code, category: "server", scope: "request", action: "retry", message: expected[code] ?? "Unrelated failure.",
  retryable: true, retryAfterMs: null, requestId: "original-rodin-request", httpStatus: 502, ...patch });
function rowFor(code) {
  const contract = createModel3dOutputContract({ draftId: "experience-draft-" + "a".repeat(64), draftHash: "sha256:" + "b".repeat(64),
    releaseHash: "sha256:" + "c".repeat(64), requestHash: "sha256:" + "d".repeat(64), sourceBindingHash: "sha256:" + "e".repeat(64), reference: null });
  return { job_id: "original-job", owner_id: "owner", stream_id: "creative:owner", document_id: "document", kind: "render_document", status: "failed",
    source_surface: "document", correlation_id: "original-job:attempt:1", requested_sequence: 4,
    request_json: JSON.stringify({ artifactKind: "model3d", productionMode: "manual", documentRevision: "revision", requestKey: "original-request", outputModel3d: contract }),
    result_json: JSON.stringify({ artifactKind: "model3d", stage: "failed", progressMessage: oldImage, errorDetail: publicFailureDetail(detail(code)),
      providerSubmissions: { private: "private-provider-receipt" }, model3dInputReceipt: { prompt: "private-authored-shape" }, quote: { secret: true } }),
    error_message: expected[code], attempt_count: 1, requested_at: "2026-09-13T00:00:00Z", started_at: "2026-09-13T00:00:01Z",
    completed_at: "2026-09-13T00:00:02Z", notified_at: null, lease_expires_at: null, updated_at: "2026-09-13T00:00:02Z" };
}

test("both progress messages exactly reuse existing static Model3D producer copy", () => {
  const producer = readFileSync(new URL("../worker/model3d-render.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("model3d-render.ts", producer, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), found = new Map();
  function walk(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const properties = Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).filter(property => ts.isStringLiteral(property.initializer))
        .map(property => [property.name.getText(ast), property.initializer.text]));
      if (Object.hasOwn(expected, properties.code)) found.set(properties.code, properties.message);
    }
    ts.forEachChild(node, walk);
  }
  walk(ast); assert.deepEqual(Object.fromEntries(found), expected);
});
for (const [code, message] of Object.entries(expected)) {
  test(code + " keeps exact 3D copy ahead of server/network fallback without echoing diagnostics", () => {
    for (const category of ["server", "network"]) {
      const value = detail(code, { category, message: "private diagnostic: token=secret" }), before = structuredClone(value);
      assert.equal(helpers.failureProgressMessage(value), message); assert.deepEqual(value, before);
    }
  });
  test(code + " corrects historical public feed/detail/scoped progress without changing receipt or recovery policy", () => {
    const row = rowFor(code), before = structuredClone(row), parsed = JSON.parse(row.result_json);
    const classified = helpers.errorDetailFromResult(parsed); assert.deepEqual(classified, parsed.errorDetail);
    for (const visible of [helpers.serializeJob(row, null, false), helpers.serializeJob(row), helpers.safeScopedJob(row)]) {
      assert.equal(visible.progressMessage, message); assert.equal(visible.stage, "failed"); assert.equal(visible.status, "failed");
      assert.deepEqual(visible.errorDetail, parsed.errorDetail); assert.equal(visible.attemptCount, 1); assert.equal(visible.jobId, row.job_id);
      assert.equal(visible.errorDetail.retryable, true); assert.equal(visible.errorDetail.action, "retry");
      assert.doesNotMatch(JSON.stringify(visible), /private-provider-receipt|private-authored-shape/u);
    }
    assert.deepEqual(row, before); assert.equal(JSON.parse(row.result_json).progressMessage, oldImage, "read-time presentation never rewrites history");
  });
  test(code + " preserves queue-recovery presentation priority", () => {
    const row = rowFor(code); row.status = "queued";
    const shown = helpers.serializeJob(row, { job_id: "earlier-original-job" });
    assert.equal(shown.stage, "queue-recovery");
    assert.equal(shown.progressMessage, "An earlier operation lost contact. The server is recovering it before this render starts.");
  });
}
for (const [name, value, message] of [
  ["null", null, "The operation failed."],
  ["unrelated server", detail("provider_server_failed"), oldImage],
  ["unrelated network", detail("provider_network_failed", { category: "network" }), oldImage],
  ["near-match 3D code", detail("model3d_publication_unconfirmed_extra"), oldImage],
  ["generic local persistence", detail("local_persistence_failed"), "Forma could not save the generation because a local database or event-store write failed. This is not a provider interruption."],
  ["source fidelity", detail("source_fidelity_validation_failed"), "The generated presentation did not preserve its required source facts, quotations, or authorized slide evidence."],
  ["execution interruption", detail("execution_interrupted"), "Forma lost contact with the generation worker before this operation finished."],
  ["existing uncertain submission", detail("provider_submission_uncertain"), "We couldn’t confirm the original request. We haven’t sent it again, to avoid a duplicate charge."],
  ["ordinary safety", detail("safety_rejected", { category: "safety" }), "Safety checks stopped this generation. Change the request or reference before retrying."],
  ["unknown copy", detail("unknown", { category: "unknown", message: "Retained unrelated failure." }), "Retained unrelated failure."],
]) test("unrelated " + name + " behavior is unchanged", () => assert.equal(helpers.failureProgressMessage(value), message));
