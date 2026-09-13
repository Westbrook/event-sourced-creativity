import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const root = new URL("../", import.meta.url).href;
// Only the two private server I/O ports are stubs. These tests do not claim
// SQLite/R2 custody, an authenticated handler or a provider/browser invocation.
const ports = { resolve: null, prepare: null };
globalThis.__model3dPreparationTestPorts = ports;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(root) && specifier.startsWith(".")) {
      const url = new URL(specifier, context.parentURL);
      if (url.href === new URL("worker/output-model3d-source.ts", root).href) return { url: "model3d-test:source", shortCircuit: true };
      if (url.href === new URL("worker/model3d-request.ts", root).href) return { url: "model3d-test:request", shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "model3d-test:source") return { format: "module", shortCircuit: true, source: "export const resolveOutputModel3dSource = input => globalThis.__model3dPreparationTestPorts.resolve(input);" };
    if (url === "model3d-test:request") return { format: "module", shortCircuit: true, source: "export const prepareModel3dRequest = input => globalThis.__model3dPreparationTestPorts.prepare(input);" };
    return next(url, context);
  },
});
const model = await import("../src/model/output-model3d-contract.ts");
const { describeModel3dPreparation } = await import("../worker/output-model3d-preparation.ts");
const { preflightOutputModel3dMiniAppTarget, outputModel3dPreflightAssertions } = await import("../worker/output-model3d-preflight.ts");
const { createExperienceModel3dRecipe } = await import("../worker/experience-model3d-recipe.ts");
const { compileOutputPlan } = await import("../src/model/output-plan.ts");
const { validateModel3dRequest, serializeRodinInput } = await import("../src/model/model3d.ts");
hook.deregister();
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw Error("Network forbidden in pure preparation controls"); };
test.after(() => { globalThis.fetch = originalFetch; delete globalThis.__model3dPreparationTestPorts; });
const source = { draftId: "experience-draft-" + "a".repeat(64), draftHash: "sha256:" + "b".repeat(64),
  releaseHash: "sha256:" + "c".repeat(64), requestHash: "sha256:" + "d".repeat(64), sourceBindingHash: "sha256:" + "e".repeat(64) };
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfQAAAABJRU5ErkJggg==", "base64"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const selected = { version: 1, kind: "image", sourceProjectId: "original-project", sourceDocumentId: "original-document",
  sourceBlockId: "original-block", referenceId: "original-reference", sha256: hash(png), permissionAttestation: "i-own-or-have-permission" };
const contract = hasReference => model.createModel3dOutputContract({ ...source, reference: hasReference
  ? { selection: selected, sourceDigest: "2".repeat(64), copiedBlockId: "document-copy" } : null });
const request = (withReference, prompt = "A matte lamp 日本語 <literal>") => {
  const checked = validateModel3dRequest({ prompt, settings: model.MODEL3D_MINI_APP_SETTINGS, referenceCount: withReference ? 1 : 0 });
  assert.equal(checked.valid, true);
  return { prompt, settings: checked.settings, model: checked.model, estimatedCostMicrousd: checked.estimatedCostMicrousd,
    references: withReference ? [{ bytes: new Uint8Array(png), mimeType: "image/png", blockId: "document-copy", referenceId: selected.referenceId, label: "Owned source" }] : [],
    referenceBlockIds: withReference ? ["document-copy"] : [] };
};
test("reviewed envelope uses the existing serializer and exact source bytes without URL or authority output", async () => {
  for (const withReference of [false, true]) {
    const prepared = request(withReference), result = await describeModel3dPreparation(contract(withReference), prepared);
    const wire = serializeRodinInput(prepared.prompt, prepared.settings, withReference ? ["https://fal.media/reference-1"] : []);
    assert.deepEqual(result.parameters, Object.fromEntries(Object.entries(wire.input).filter(([key]) => key !== "image_urls")));
    assert.deepEqual(result.acceptedFields, Object.keys(wire.input)); assert.equal(result.prompt, prepared.prompt);
    assert.equal(result.references.length, withReference ? 1 : 0); assert.equal(result.maximumCalls, 1);
    if (withReference) { assert.equal(result.references[0].sha256, selected.sha256); assert.equal(result.references[0].byteLength, png.length); }
    assert.match(result.preparationDigest, /^sha256:[a-f0-9]{64}$/u); assert.equal(result.requestDigest, undefined);
    assert.equal(result.grantId, undefined); assert.equal(result.confirmed, undefined); assert.equal(result.sourceFilesAuthorized, undefined);
    assert(!JSON.stringify(result).includes("https://")); assert(Object.isFrozen(result.parameters)); assert(Object.isFrozen(result.references));
    prepared.prompt = "changed after preparation"; assert.notEqual(result.prompt, prepared.prompt);
  }
});
test("changed byte hash, reference identity, selection count, settings or model refuse preparation", async () => {
  for (const change of [p => { p.references[0].bytes[0] ^= 1; }, p => { p.references[0].blockId = "other-copy"; },
    p => { p.references[0].referenceId = "other-reference"; }, p => { p.referenceBlockIds = ["other-copy"]; },
    p => { p.references.push(p.references[0]); }, p => { p.settings.preview_render = true; },
    p => { p.model = "different-model"; }, p => { p.estimatedCostMicrousd++; }, p => { p.references[0].mimeType = "model/gltf-binary"; }]) {
    const prepared = request(true); change(prepared);
    await assert.rejects(describeModel3dPreparation(contract(true), prepared), /output_model3d_(?:reference|preparation)_changed/u);
  }
  await assert.rejects(describeModel3dPreparation(contract(false), request(true)), /preparation_changed/u);
});
function input(withReference = false) {
  const value = contract(withReference), recipe = createExperienceModel3dRecipe({ output: "model3d", requirementId: "requirement", deliverableId: "deliverable", contract: value });
  const target = compileOutputPlan([recipe.spec], { document_id: "document", source_revision: "source", requirement_revision: "requirements" }).targets[0];
  let reads = 0, bindings;
  const env = { DB: { prepare(sql) { assert.match(sql, /^SELECT CASE WHEN /u); return { bind(...values) { bindings = values; return this; } }; },
    async batch(statements) { reads++; return statements.map(() => ({ success: true, results: [{ current: 1 }] })); } } };
  return { request: new Request("https://fixture.invalid/prepare"), env, target,
    confirmedPlan: { confirmedAt: new Date(Date.now() - 1000).toISOString() },
    context: { snapshot: { facts: [{ block_id: "subject", type: "subject", properties: { text: "A matte lamp 日本語" } }] } },
    scope: { actorUserId: "owner", ownerUserId: "owner", projectId: "project", documentId: "document" },
    sourceEvents: [], sourceDigest: "3".repeat(64), requirementsDigest: "4".repeat(64),
    observed: () => ({ reads, bindings }) };
}
test("read-only quote carries current proof and requires configuration plus separate approval, never a grant", async () => {
  const value = input(), seen = [], expiry = new Date(Date.now() + 60_000).toISOString();
  ports.resolve = async received => { assert.equal(received, value); seen.push("source"); return { plan: { draftId: source.draftId }, requestId: "model3d-" + "5".repeat(64), expiresAt: expiry,
    sourceAssertions: [{ sql: "? = ?", bindings: [7, 7] }] }; };
  ports.prepare = async received => { seen.push("private-preparation"); assert.equal(received.env, value.env); assert.equal(received.promptSource, "document");
    assert.deepEqual(received.referenceBlockIds, []); assert.deepEqual(received.settings, model.MODEL3D_MINI_APP_SETTINGS);
    return { ...request(false, received.prompt), adaptation: received.adaptation }; };
  const result = await preflightOutputModel3dMiniAppTarget(value);
  assert.deepEqual(seen, ["source", "private-preparation"]); assert.equal(value.observed().reads, 1);
  assert.equal(result.available, false); assert.equal(result.reasonCode, "output_native_model3d_unconfigured");
  assert.equal(result.maximumMicrousd, request(false).estimatedCostMicrousd); assert.ok(result.maximumMicrousd > 0);
  assert.equal(result.settings.executionAvailable, false); assert.equal(result.settings.preparationOnly, false);
  assert.equal(result.settings.explicitCostAndTransferApprovalRequired, true);
  assert.equal(result.transferCode, "output_transfer_model3d_not_yet_authorized");
  assert.equal(result.settings.payload.paidMediaConfirmed, undefined); assert.equal(result.settings.payload.outputExecution, undefined);
  assert.equal(result.settings.costPreview.confirmed, undefined); assert.equal(result.settings.costPreview.providerTransferConfirmed, undefined);
  assert.equal(result.settings.original.expiresAt, expiry); assert.equal(result.settings.description.maximumCalls, 1);
  const proof = outputModel3dPreflightAssertions(result); assert.equal(proof.length, 2); assert.deepEqual(proof[0].bindings, [7, 7]);
  assert.equal(proof[1].deadlineMs, Date.parse(expiry)); assert.equal(outputModel3dPreflightAssertions(structuredClone(result)), null);
  value.env.FAL_KEY = "local-configuration-flag-only";
  const configured = await preflightOutputModel3dMiniAppTarget(value);
  assert.equal(configured.available, true); assert.equal(configured.reasonCode, "output_model3d_ready_for_separate_approval");
  assert.equal(configured.settings.executionAvailable, true); assert.equal(configured.settings.explicitCostAndTransferApprovalRequired, true);
  assert.equal(configured.transferCode, "output_transfer_model3d_not_yet_authorized");
  assert.deepEqual(configured.settings.costPreview, result.settings.costPreview);
  assert.equal(configured.settings.payload.paidMediaConfirmed, undefined); assert.equal(configured.settings.payload.outputExecution, undefined);
  assert.deepEqual(seen, ["source", "private-preparation", "source", "private-preparation"]); assert.equal(value.observed().reads, 2);
});
test("unsupported shape, expired original, changed final source or private preparation refusal never grants readiness", async () => {
  const value = input(); let sourceReads = 0, preparationReads = 0;
  ports.resolve = async () => { sourceReads++; return { plan: { draftId: source.draftId }, requestId: "model3d-" + "5".repeat(64), expiresAt: new Date(Date.now() - 1).toISOString(), sourceAssertions: [{ sql: "1=1" }] }; };
  ports.prepare = async () => { preparationReads++; throw Error("custody refused"); };
  const unsupported = structuredClone(value.target); unsupported.quantity.value = 2;
  assert.equal((await preflightOutputModel3dMiniAppTarget({ ...value, target: unsupported })).available, false); assert.equal(sourceReads, 0);
  assert.equal((await preflightOutputModel3dMiniAppTarget(value)).reasonCode, "output_model3d_original_expired"); assert.equal(preparationReads, 0);
  ports.resolve = async () => ({ plan: { draftId: source.draftId }, requestId: "model3d-" + "5".repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString(), sourceAssertions: [{ sql: "1=1" }] });
  await assert.rejects(preflightOutputModel3dMiniAppTarget(value), /custody refused/u);
  ports.prepare = async received => request(false, received.prompt);
  value.env.DB.batch = async statements => statements.map(() => ({ success: true, results: [{ current: 0 }] }));
  await assert.rejects(preflightOutputModel3dMiniAppTarget(value), /output_source_changed_during_read/u);
});

test("102 aggregate reference-proof bindings stay in individual SQLite reads with head, row and deadline refusal", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE events(sequence INTEGER,stream_id TEXT); INSERT INTO events VALUES(7,'creative:owner')");
    let batches = 0, largest = 0, batchSize = 0;
    const adapter = {
      prepare(sql) { return { sql, values: [], bind(...values) {
        // The actual D1 helper has this same per-statement ceiling. SQLite here
        // supplies real SELECT evaluation, not a fake success for each proof.
        if (values.length > 100) throw Error("D1 per-statement bind limit");
        largest = Math.max(largest, values.length); this.values = values; return this;
      } }; },
      async batch(statements) {
        batches++; batchSize = statements.length;
        return statements.map(statement => ({ success: true, results: db.prepare(statement.sql).all(...statement.values) }));
      },
    };
    const value = input(true); value.env.DB = adapter;
    const counts = [2, 8, 17, 2, 22, 23, 8, 17, 2];
    const assertions = counts.map(count => ({ sql: Array(count).fill("?=1").join(" AND "), bindings: Array(count).fill(1) }));
    for (const index of [3, 8]) assertions[index] = { sql: "COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)=?", bindings: ["creative:owner", 7] };
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    assert.equal(assertions.reduce((n, proof) => n + proof.bindings.length, 0) + 1, 102);
    const all = [...assertions, { sql: "? > strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [expiresAt] }];
    assert.throws(() => adapter.prepare("SELECT 1 AS current WHERE " + all.map(p => `(${p.sql})`).join(" AND ")).bind(...all.flatMap(p => p.bindings)), /D1 per-statement bind limit/u,
      "the rejected predecessor's flattened final SELECT exceeds the real helper's documented bound");
    ports.resolve = async () => ({ plan: { draftId: source.draftId }, requestId: "model3d-" + "5".repeat(64), expiresAt, sourceAssertions: assertions });
    ports.prepare = async received => request(true, received.prompt);
    const result = await preflightOutputModel3dMiniAppTarget(value);
    assert.equal(result.reasonCode, "output_native_model3d_unconfigured"); assert.equal(result.available, false);
    assert.equal(batches, 1); assert.equal(batchSize, 10); assert.equal(largest, 23);
    assert.deepEqual(outputModel3dPreflightAssertions(result).slice(0, assertions.length), assertions, "all original atomic-command assertions retained without truncation");
    db.exec("INSERT INTO events VALUES(8,'creative:owner')");
    await assert.rejects(preflightOutputModel3dMiniAppTarget(value), /output_source_changed_during_read/u);
    db.exec("DELETE FROM events WHERE sequence=8");
    assertions[0].bindings[0] = 0;
    await assert.rejects(preflightOutputModel3dMiniAppTarget(value), /output_source_changed_during_read/u);
    assertions[0].bindings[0] = 1;
    assertions[0].deadlineMs = Date.now() - 1;
    assert.equal((await preflightOutputModel3dMiniAppTarget(value)).reasonCode, "output_model3d_source_changed", "post-batch deadline remains fail-closed");
    assertions[0] = { sql: Array(101).fill("?=1").join(" AND "), bindings: Array(101).fill(1) };
    await assert.rejects(preflightOutputModel3dMiniAppTarget(value), /output_source_proof_too_large/u, "an oversized individual proof is refused, not split or weakened");
  } finally { db.close(); }
});
