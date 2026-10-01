import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { model3dReferenceSelection, prepareModel3dRequest } from "../worker/model3d-request.ts";
import { RODIN_IMAGE_MODEL, RODIN_TEXT_MODEL } from "../src/model/model3d.ts";
import { adaptDocumentToModel3d, model3dAdaptationReceipt } from "../src/model/model3d-prompt-adapter.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { hasUnresolvedProviderSubmission, hasUnsettledProviderSubmission, unresolvedProviderSubmissionSql, unsettledProviderSubmissionSql } from "../src/model/provider-submission.ts";
import { interruptedDocumentJobUsage } from "../worker/document-job-reservations.ts";

const ownerId = "model3d-request-owner";
const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1cAAAAASUVORK5CYII=", "base64"));
const contentHash = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
const key = (name) => `${ownerMediaNamespace(ownerId)}/${name}.png`;
const url = (name) => `/api/media/${encodeURIComponent(key(name))}`;
const fact = (name, overrides = {}) => ({ block_id: name, type: "reference", active: true, properties: { reference_id: `${name}-ref`, media_url: url(name), source_content_hash: contentHash, pixel_reference_mode: "inspiration", weight: .7, label: name, ...overrides } });
const rights = (name) => [
  { type: "ReferenceIngested", payload: { reference_id: `${name}-ref`, source_ref: url(name), content_hash: contentHash, rights_class: "asserted" } },
  { type: "RightsAsserted", payload: { reference_id: `${name}-ref`, rights_class: "owned_or_licensed" } },
];

function storage(names = []) {
  const reads = [];
  const object = (name) => names.some((id) => key(id) === name) ? {
    size: bytes.length, body: new Blob([bytes]).stream(), customMetadata: { ownerId, mimeType: "image/png", sha256: contentHash, rights: "asserted" },
    writeHttpMetadata(headers) { headers.set("content-type", "image/png"); },
  } : null;
  return { reads, env: { MEDIA: {
    async get(name) { reads.push(["get", name]); return object(name); },
    async head(name) { reads.push(["head", name]); return object(name); },
  }, DB: { prepare() { throw new Error("Unexpected database access"); } } } };
}

test("Rodin admission rejects malformed settings and long final prompts before reading any asset", async () => {
  const { env, reads } = storage();
  for (const input of [
    { prompt: "x".repeat(1025), settings: {} },
    { prompt: "A ceramic teapot", settings: { nonexistent: true } },
  ]) await assert.rejects(prepareModel3dRequest({ env, ownerId, snapshot: { facts: [] }, sourceEvents: [], referenceBlockIds: [], ...input }), error => error.detail?.action === "edit_request");
  assert.deepEqual(reads, []);
  assert.throws(() => model3dReferenceSelection(["same", "same"]));
  assert.throws(() => model3dReferenceSelection("https://other.example/reference.png"));
  assert.throws(() => model3dReferenceSelection(["1", "2", "3", "4", "5", "6"]));
});

test("text-only generation preserves the exact authored prompt and reads no image", async () => {
  const { env, reads } = storage();
  const prompt = "  A small glazed ceramic teapot.  ";
  const prepared = await prepareModel3dRequest({ env, ownerId, snapshot: { facts: [fact("unused")] }, sourceEvents: rights("unused"), prompt, settings: {}, referenceBlockIds: [] });
  assert.equal(prepared.prompt, prompt);
  assert.equal(prepared.model, RODIN_TEXT_MODEL);
  assert.equal(prepared.estimatedCostMicrousd, 400_000);
  assert.deepEqual(prepared.references, []);
  assert.deepEqual(reads, []);
});

test("document admission derives the reviewed prompt from authorized facts without reading images", async () => {
  const { env, reads } = storage();
  const snapshot = { facts: [{ block_id: "subject", type: "subject", properties: { description: "A ceramic teapot", weight: 1 } }] };
  const adapted = adaptDocumentToModel3d(snapshot);
  const input = { env, ownerId, snapshot, sourceEvents: [], promptSource: "document", prompt: adapted.prompt,
    adaptation: model3dAdaptationReceipt(adapted), settings: {}, referenceBlockIds: [] };
  const prepared = await prepareModel3dRequest(input);
  assert.match(prepared.prompt, /ceramic teapot/);
  assert.equal(prepared.promptSource, "document");
  assert.deepEqual(prepared.adaptation, input.adaptation);
  assert.equal(prepared.estimatedCostMicrousd, 400_000);
  for (const change of [
    { prompt: "A forged substitute" },
    { adaptation: { ...input.adaptation, adapterVersion: "unknown" } },
    { adaptation: { ...input.adaptation, includedBlockIds: [] } },
    { adaptation: { ...input.adaptation, omittedBlockIds: ["not-omitted"] } },
    { adaptation: undefined },
    { snapshot: { facts: [{ block_id: "subject", type: "subject", properties: { description: "A glass bottle", weight: 1 } }] } },
  ]) await assert.rejects(prepareModel3dRequest({ ...input, ...change }), error => error.detail?.code === "model3d_document_adaptation_changed");
  await assert.rejects(prepareModel3dRequest({ ...input, promptSource: "typo" }), error => error.detail?.code === "model3d_prompt_source_invalid");
  assert.deepEqual(reads, []);
});

test("selected references retain explicit material-first ordering and private bytes", async () => {
  const { env, reads } = storage(["front", "back", "unused"]);
  const prepared = await prepareModel3dRequest({ env, ownerId, snapshot: { facts: [fact("front"), fact("back"), fact("unused")] }, sourceEvents: [...rights("front"), ...rights("back"), ...rights("unused")], prompt: "", settings: {}, referenceBlockIds: ["back", "front"] });
  assert.equal(prepared.model, RODIN_IMAGE_MODEL);
  assert.deepEqual(prepared.referenceBlockIds, ["back", "front"]);
  assert.deepEqual(prepared.references.map((reference) => reference.blockId), ["back", "front"]);
  assert.deepEqual(prepared.references[0].bytes, bytes);
  assert.equal(reads.some(([, name]) => name.includes("unused")), false);
  assert.equal(prepared.references.some((reference) => "url" in reference || "model_url" in reference), false);
});

test("inactive, unselected, revoked, hash-mismatched and inaccessible images fail before provider dispatch", async () => {
  for (const fixture of [
    { facts: [fact("front", { active: false })], events: rights("front"), ids: ["front"], code: "model3d_reference_not_authorized" },
    { facts: [], events: rights("front"), ids: ["front"], code: "model3d_reference_not_authorized" },
    { facts: [fact("front")], events: [...rights("front"), { type: "RightsAsserted", payload: { reference_id: "front-ref", rights_class: "revoked" } }], ids: ["front"], code: "model3d_reference_rights_required" },
    { facts: [fact("front", { source_content_hash: "0".repeat(64) })], events: rights("front"), ids: ["front"], code: "model3d_reference_integrity_mismatch" },
    { facts: [fact("front", { media_url: "https://outside.example/model.glb" })], events: rights("front"), ids: ["front"], code: "model3d_reference_image_unavailable" },
  ]) {
    const { env } = storage(["front"]);
    await assert.rejects(prepareModel3dRequest({ env, ownerId, snapshot: { facts: fixture.facts }, sourceEvents: fixture.events, prompt: "A teapot", settings: {}, referenceBlockIds: fixture.ids }), error => error.detail?.code === fixture.code, fixture.code);
  }
});

test("Rodin paid-state JavaScript and SQL keep unknown acceptance reserved and recognize durable request receipts", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE evidence(value TEXT)");
  const receipt = { clientRequestId: "client-3d", provider: "fal", operation: "model3d", model: RODIN_TEXT_MODEL };
  const cases = [
    [{ model3dProviderSubmission: "pending" }, true, true],
    [{ model3dProviderSubmission: "pending", providerJobId: "unknown" }, true, true],
    [{ model3dProviderSubmission: "pending", providerSubmissions: { "client-3d": { ...receipt, status: "pending" } } }, true, true],
    [{ model3dProviderSubmission: "pending", providerSubmissions: { "client-3d": { ...receipt, status: "accepted", providerRequestId: "rodin-1" } } }, false, true],
    [{ model3dProviderSubmission: "confirmed", providerSubmissions: { "client-3d": { ...receipt, status: "completed", providerRequestId: "rodin-1", costMicrousd: 400_000 } } }, false, false],
    [{ model3dProviderSubmission: "rejected", providerSubmissions: { "client-3d": { ...receipt, status: "rejected", costMicrousd: 0 } } }, false, false],
  ];
  for (const [value, unresolved, unsettled] of cases) {
    db.prepare("INSERT INTO evidence(value) VALUES(?)").run(JSON.stringify(value));
    const result = db.prepare(`SELECT ${unresolvedProviderSubmissionSql("evidence.value")} unresolved, ${unsettledProviderSubmissionSql("evidence.value")} unsettled FROM evidence ORDER BY rowid DESC LIMIT 1`).get();
    assert.equal(hasUnresolvedProviderSubmission(value), unresolved);
    assert.equal(hasUnsettledProviderSubmission(value), unsettled);
    assert.equal(Boolean(result.unresolved), unresolved);
    assert.equal(Boolean(result.unsettled), unsettled);
  }
  db.close();
});

test("interruption retains the completed Rodin cost with or without its convenience request ID", () => {
  const receipt = { clientRequestId: "model-cost", provider: "fal", operation: "model3d", model: RODIN_TEXT_MODEL,
    status: "completed", providerRequestId: "rodin-paid", costMicrousd: 400_000, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  for (const providerJobId of [undefined, "rodin-paid"]) {
    const checkpoint = { providerJobId, providerSubmissions: { "model-cost": receipt } };
    const usage = interruptedDocumentJobUsage(checkpoint, { artifactKind: "model3d" });
    assert.equal(usage.totalCostMicrousd, 400_000);
    assert.equal(usage.totalTokens, 0);
  }
  const pending = { providerJobId: "rodin-paid", providerSubmissions: { "model-cost": { ...receipt, status: "accepted", costMicrousd: undefined } } };
  assert.equal(hasUnsettledProviderSubmission(pending), true);
  assert.equal(interruptedDocumentJobUsage(pending, { artifactKind: "model3d" }).totalCostMicrousd, 0);
});
