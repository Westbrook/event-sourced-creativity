import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { registerOutputSourceImports, outputTestDatabase } from "./output-execution-test-helpers.mjs";
import { parseOutputRequirement } from "../src/model/output-requirements.ts";
import { compileOutputPlan } from "../src/model/output-plan.ts";
import { RODIN_TEXT_MODEL, RODIN_IMAGE_MODEL } from "../src/model/model3d.ts";
import { png, readStoredZip } from "./output-asset-fixtures.mjs";

registerOutputSourceImports();
const { preflightOutputNativeTarget } = await import("../worker/output-document-execution.ts");
const { inspectOutputTargetFile } = await import("../worker/output-requirements-api.ts");
const { inspectOutputAsset } = await import("../src/model/output-asset-inspection.ts");

// Reuse the existing actual HTTP lifecycle fixture without registering its tests.
const fixtureUrl = new URL("./output-native-execution.test.mjs", import.meta.url);
const original = readFileSync(fixtureUrl, "utf8");
const fixtureSource = original.slice(0, original.indexOf("\ntest("))
  .replace(/(from\s+|import\s*\()(["'])([^"']+)\2/gu, (_all, prefix, _quote, specifier) => prefix + JSON.stringify(specifier.startsWith(".") ? new URL(specifier, fixtureUrl).href : specifier.startsWith("node:") ? specifier : import.meta.resolve(specifier)))
  + "\nexport {fixture,authorize,handleDocumentJobs};";
const { fixture, authorize, handleDocumentJobs } = await import("data:text/javascript;base64," + Buffer.from(fixtureSource).toString("base64"));

function triangle(scale = 1) {
  const json = { asset: { version: "2.0" }, scenes: [{ nodes: [0] }], scene: 0, nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [scale, scale, 0] }] };
  const raw = Buffer.from(JSON.stringify(json)), jsonSize = Math.ceil(raw.length / 4) * 4, result = Buffer.alloc(12 + 8 + jsonSize + 8 + 36);
  result.write("glTF"); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonSize, 12); result.writeUInt32LE(0x4e4f534a, 16); result.fill(32, 20, 20 + jsonSize); result.set(raw, 20);
  result.writeUInt32LE(36, 20 + jsonSize); result.writeUInt32LE(0x004e4942, 24 + jsonSize);
  [0, 0, 0, scale, 0, 0, 0, scale, 0].forEach((value, index) => result.writeFloatLE(value, 28 + jsonSize + index * 4));
  return new Uint8Array(result);
}
const specFor = (prompt = "A glazed ceramic teapot with a curved handle.") => {
  const spec = parseOutputRequirement({ id: "models", type: "Output", subtype: "3D models", content: "Create one 3D model." }).spec;
  spec.deliverables[0].original_text = prompt;
  return spec;
};
function preflightInput(facts = [], sourceEvents = [], env = {}) {
  const plan = compileOutputPlan([specFor()], { document_id: "document", source_revision: "source", requirement_revision: "requirements" });
  return { env: { FAL_KEY: "test-only", ...env }, request: new Request("http://localhost"), scope: { kind: "personal", key: "personal:owner:project", ownerUserId: "owner", actorUserId: "owner", documentId: "document", projectId: "project", organizationId: null, projectAccessId: null }, target: plan.targets[0], context: { snapshot: { facts } }, sourceEvents, confirmedPlan: { plan }, sourceDigest: "source", requirementsDigest: "requirements" };
}

test("3D native preflight has one priced Rodin request, exact unchanged text, and no OpenAI dependency", async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("No provider transmission before authorization"); });
  const input = preflightInput(), result = await preflightOutputNativeTarget(input);
  assert.equal(result.available, true);
  assert.equal(result.model, RODIN_TEXT_MODEL);
  assert.equal(result.maximumCalls, 1);
  assert.equal(result.maximumTokens, 1);
  assert.equal(result.maximumMicrousd, 400000);
  assert.equal(result.settings.payload.model3dPrompt, input.target.instruction_text);
  assert.equal(result.settings.payload.paidMediaConfirmed, true);
  assert.equal(result.settings.payload.model3dSettings.geometry_file_format, "glb");
  assert.deepEqual(result.settings.payload.model3dReferenceBlockIds, []);
  assert.deepEqual(result.settings.calls, [{ stage: "model3d:initial", provider: "fal", model: RODIN_TEXT_MODEL, maximumMicrousd: 400000 }]);
  assert.equal(result.settings.executionPolicy.maximumMilliseconds, 900000);
  input.target.instruction_text = "😀".repeat(1025);
  const blocked = await preflightOutputNativeTarget(input);
  assert.equal(blocked.available, false);
  assert.equal(blocked.reasonCode, "model3d_prompt_too_long");
  assert.equal(blocked.reasonValues.promptCharacters, 1025);
  assert.equal(input.target.instruction_text, "😀".repeat(1025));
});

test("3D native preflight freezes authorized reference order and rejects missing rights or excess references", async t => {
  const db = outputTestDatabase(); t.after(() => db.sqlite.close());
  t.mock.method(globalThis, "fetch", () => { throw new Error("Read-only preflight cannot upload references"); });
  const bytes = png(), digest = createHash("sha256").update(bytes).digest("hex");
  const facts = [], events = [];
  for (const id of ["back", "front"]) {
    const key = `owner/references/${id}.png`, url = `/api/media/${encodeURIComponent(key)}`;
    await db.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/png" }, customMetadata: { ownerId: "owner" } });
    facts.push({ block_id: id, type: "reference", active: true, properties: { reference_id: id, label: id, media_url: url, source_content_hash: digest, pixel_reference_mode: "preserve_style" } });
    events.push({ type: "ReferenceIngested", payload: { reference_id: id, source_ref: url, content_hash: digest, rights_class: "owned" } });
  }
  let reads = 0;
  const read = db.env.MEDIA.get.bind(db.env.MEDIA);
  db.env.MEDIA.get = key => { reads++; return read(key); };
  const input = preflightInput(facts, events, db.env), result = await preflightOutputNativeTarget(input);
  assert.equal(result.available, true, result.reason);
  assert.equal(result.model, RODIN_IMAGE_MODEL);
  assert.deepEqual(result.settings.payload.model3dReferenceBlockIds, ["back", "front"]);
  assert.deepEqual(result.settings.model3dReferences.map(reference => reference.label), ["back", "front"]);
  const firstTargetReads = reads;
  assert.ok(firstTargetReads > 0);
  const sibling = await preflightOutputNativeTarget({ ...input, target: { ...input.target, id: "second-model", instruction_text: "The same teapot with a blue glaze." } });
  assert.equal(sibling.available, true);
  assert.equal(sibling.settings.payload.model3dPrompt, "The same teapot with a blue glaze.");
  assert.deepEqual(sibling.settings.payload.model3dReferenceBlockIds, ["back", "front"]);
  assert.equal(reads, firstTargetReads, "one request reuses verified reference reads across targets without changing each exact prompt");
  assert.equal((await preflightOutputNativeTarget({ ...input, sourceEvents: [] })).reasonCode, "output_native_model3d_reference_unavailable");
  input.context.snapshot.facts = Array.from({ length: 6 }, (_, index) => ({ ...facts[0], block_id: `reference-${index}` }));
  assert.equal((await preflightOutputNativeTarget(input)).reasonCode, "model3d_reference_count");
});

test("3D target matching accepts original GLB and cannot satisfy it with an image preview", async () => {
  const target = preflightInput().target;
  assert.equal(inspectOutputTargetFile(target, await inspectOutputAsset(triangle(), "teapot.glb")).status, "passed");
  assert.ok(inspectOutputTargetFile(target, await inspectOutputAsset(png(), "preview.png")).problems.includes("target_media_kind_mismatch"));
});

for (const shared of [false, true]) test(`native Rodin output grant preserves GLB artifacts and verified delivery; shared=${shared}`, async t => {
  let paid = 0;
  const primary = triangle(), alternate = triangle(2), texture = png();
  const files = new Map([["https://fal.media/files/primary.glb", primary], ["https://fal.media/files/shaded.glb", alternate], ["https://fal.media/files/texture.png", texture]]);
  t.mock.method(globalThis, "fetch", async (url, request = {}) => {
    const value = String(url);
    if (value === `https://queue.fal.run/${RODIN_TEXT_MODEL}` && request.method === "POST") {
      paid++;
      const input = JSON.parse(request.body);
      assert.equal(input.prompt, specFor().deliverables[0].original_text);
      assert.equal(input.geometry_file_format, "glb");
      assert.equal(input.image_urls, undefined);
      return Response.json({ request_id: "output-model-request", status: "COMPLETED" });
    }
    if (value === "https://queue.fal.run/fal-ai/hyper3d/requests/output-model-request") return Response.json({ seed: 7, model_mesh: { url: "https://fal.media/files/primary.glb", file_name: "primary.glb", content_type: "model/gltf-binary", file_size: primary.length }, model_meshes: [{ url: "https://fal.media/files/shaded.glb", file_name: "shaded.glb", content_type: "model/gltf-binary", file_size: alternate.length }], textures: [{ url: "https://fal.media/files/texture.png", file_name: "texture.png", content_type: "image/png", file_size: texture.length }] });
    if (files.has(value)) return new Response(files.get(value), { headers: { "content-type": value.endsWith(".png") ? "image/png" : "model/gltf-binary" } });
    throw new Error(`Unexpected provider request ${value}`);
  });
  const f = await fixture(undefined, { shared }); t.after(() => f.sqlite.close());
  f.env.FAL_KEY = "transport-test-only";
  const spec = specFor();
  await f.ok(await f.send({ action: "save", blockId: spec.id, spec }));
  const confirmation = await f.ok(await f.send({ action: "confirm" }));
  const planId = confirmation.command.planRevisionId, targetId = confirmation.snapshot.confirmedPlan.plan.targets[0].id;
  const grant = await authorize(f, planId, [targetId]);
  assert.equal(paid, 0);
  await f.ok(await f.send({ action: "run", grantId: grant.grantId }));
  const jobId = f.sqlite.prepare("SELECT job_id FROM document_jobs").get().job_id;
  await f.ok(await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${jobId}/run`, { method: "POST", headers: f.headers }), f.env, `${jobId}/run`));
  const job = f.sqlite.prepare("SELECT status,error_message,result_json FROM document_jobs").get();
  assert.equal(job.status, "completed", JSON.stringify(job));
  assert.equal(paid, 1);
  const completed = f.sqlite.prepare("SELECT private_json FROM event_private_payloads body JOIN events event ON event.event_id=body.private_event_id WHERE event.type='DocumentRenderCompleted'").all().map(row => JSON.parse(row.private_json)).find(body => body.artifact_kind === "model3d");
  assert.equal(completed.settings.model3d_files.length, 3);
  assert.deepEqual(completed.settings.model3d_files.map(file => file.format), ["glb", "glb", null]);
  const bound = await f.ok(await f.send({ action: "bind", planRevisionId: planId, targetId, nativeJobId: jobId }));
  assert.equal(bound.snapshot.assets[0].mediaKind, "model3d");
  assert.equal(bound.snapshot.assets[0].inspection.extension, "glb");
  assert.equal(bound.snapshot.results[0].review, "pending");
  assert.equal(bound.snapshot.results[0].checksStatus, "passed");
  const downloaded = await f.request(bound.snapshot.assets[0].downloadUrl);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("content-type"), "model/gltf-binary");
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), primary);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_provider_calls").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT cost.used_microusd FROM cost_budget_reservations cost JOIN output_operation_slots slot ON slot.cost_reservation_id=cost.reservation_id WHERE slot.job_id=?").get(jobId).used_microusd, 400000, JSON.stringify({ reservations: f.sqlite.prepare("SELECT * FROM cost_budget_reservations").all(), calls: f.sqlite.prepare("SELECT * FROM output_provider_calls").all(), result: JSON.parse(job.result_json) }));
  if (!shared) {
    await f.ok(await f.send({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true }));
    const delivery = await f.ok(await f.send({ action: "export", planRevisionId: planId }));
    const response = await f.request(delivery.command.downloadUrl);
    assert.equal(response.status, 200);
    const contents = readStoredZip(new Uint8Array(await response.arrayBuffer()));
    assert.ok([...contents.keys()].some(name => name.endsWith(".glb")));
    assert.ok(![...contents.keys()].some(name => name.endsWith(".png")));
  }
});
