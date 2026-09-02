import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { DEFAULT_MODEL3D_SETTINGS, RODIN_TEXT_MODEL } from "../src/model/model3d.ts";
import { documentJobCanRecoverProviderRender, generationFailureGuidance } from "../src/model/document-jobs.ts";
import { appendAuditEvent } from "../worker/runtime.ts";

const prompt = "One carved wooden chair with brass feet.";
const payload = (changes = {}) => ({ artifactKind: "model3d", productionMode: "direct", paidMediaConfirmed: true,
  model3dPrompt: prompt, model3dSettings: {}, model3dReferenceBlockIds: [], ...changes });
const submit = (f, changes = {}) => f.request("/api/document-jobs", f.json({ kind: "render_document", documentId: f.documentId, payload: payload(changes) }));
const savedJob = (f, id) => {
  const row = f.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(id);
  return { ...row, request: JSON.parse(row.request_json), result: JSON.parse(row.result_json) };
};
const budgetRows = (f) => ({ tokens: f.sqlite.prepare("SELECT * FROM budget_reservations").all(), costs: f.sqlite.prepare("SELECT * FROM cost_budget_reservations").all() });

async function fixture(t, { shared = false } = {}) {
  const f = await createSceneCostFixture(1, "visual", { shared });
  f.env.FAL_KEY = "mock-rodin-key";
  delete f.env.OPENAI_API_KEY;
  t.after(async () => { await f.drainBackground(); f.close(); });
  return f;
}

function mockNetwork(t, route) {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const request = { url: input instanceof Request ? input.url : String(input), method: String(init.method ?? "GET").toUpperCase(), init };
    calls.push(request);
    return route(request, calls);
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

function triangleGlb() {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }], buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }] }));
  const length = Math.ceil(json.length / 4) * 4, bytes = Buffer.alloc(28 + length + 36);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); bytes.fill(0x20, 20, 20 + length); json.copy(bytes, 20);
  bytes.writeUInt32LE(36, 20 + length); bytes.writeUInt32LE(0x004e4942, 24 + length);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => bytes.writeFloatLE(value, 28 + length + index * 4));
  return bytes;
}

function rodinResponses({ failSubmit = false, failResult = false } = {}) {
  const id = "rodin-retained-001", root = `https://queue.fal.run/fal-ai/hyper3d/requests/${id}`;
  const media = "https://v3.fal.media/files/original-model.glb", bytes = triangleGlb();
  return async (request) => {
    if (request.url === `https://queue.fal.run/${RODIN_TEXT_MODEL}` && request.method === "POST") {
      assert.equal(JSON.parse(request.init.body).prompt, prompt);
      if (failSubmit) throw new TypeError("Connection closed after sending the request");
      return Response.json({ request_id: id, status: "COMPLETED", status_url: `${root}/status`, response_url: root, cancel_url: `${root}/cancel` });
    }
    assert.equal(request.method, "GET", "Recovery cannot upload or purchase a second model");
    if (request.url === `${root}/status?logs=1`) return Response.json({ request_id: id, status: "COMPLETED" });
    if (request.url === root) return failResult ? Response.json({ message: "Temporary provider failure" }, { status: 503 })
      : Response.json({ request_id: id, model_mesh: { url: media, content_type: "model/gltf-binary", file_name: "original-model.glb", file_size: bytes.length }, model_meshes: [], textures: [], seed: 12 });
    if (request.url === media) return new Response(bytes, { headers: { "content-type": "model/gltf-binary" } });
    throw new Error(`Unexpected external request: ${request.method} ${request.url}`);
  };
}

test("3D admission rejects invalid reviewed requests without reserving, recording a job, or contacting providers", async (t) => {
  const f = await fixture(t), calls = mockNetwork(t, () => { throw new Error("No provider call is authorized"); });
  const counts = () => ({ ...f.counts(), privateContent: f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content").get().n });
  const before = counts();
  for (const [changes, expected, status] of [
    [{ paidMediaConfirmed: false }, "paid_media_confirmation_required", 428],
    [{ model3dPrompt: "x".repeat(1025) }, "model3d_prompt_too_long", 422],
    [{ model3dPrompt: { prompt } }, "model3d_prompt_invalid", 422],
    [{ model3dSettings: { nonexistent_parameter: true } }, "model3d_setting_unsupported", 422],
    [{ model3dReferenceBlockIds: ["not-authorized"] }, "model3d_reference_not_authorized", 403],
    [{ model3dReferenceBlockIds: ["one", "one"] }, "model3d_reference_selection_invalid", 422],
    [{ model3dReferenceBlockIds: undefined }, "model3d_reference_selection_invalid", 422],
    [{ model3dInputReceipt: {} }, "media_recovery_state_server_owned", 400],
    [{ model3dProviderSubmission: "confirmed" }, "media_recovery_state_server_owned", 400],
    [{ model3dEstimatedCostMicrousd: 1 }, "media_recovery_state_server_owned", 400],
    [{ model3dProviderFiles: [{ providerMediaUrl: "https://fal.media/forged.glb" }] }, "media_recovery_state_server_owned", 400],
  ]) {
    const response = await submit(f, changes), body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body)); assert.equal(body.error, expected);
    assert.deepEqual(counts(), before, expected);
  }
  assert.equal(calls.length, 0);
});

test("3D admission pins the exact prompt, settings, single-call price and no OpenAI planner", async (t) => {
  const f = await fixture(t), calls = mockNetwork(t, () => { throw new Error("Admission is read-only"); });
  const changes = { requestKey: "same-authored-request", model3dSettings: { tier: "Gen-2.5-Extreme-High", addons: { high_pack: true } } };
  const response = await submit(f, changes); assert.equal(response.status, 202, await response.clone().text());
  const { job } = await response.json(), retained = savedJob(f, job.jobId);
  assert.equal(retained.request.model3dPrompt, prompt);
  assert.equal(retained.request.productionMode, "manual");
  assert.deepEqual(retained.request.model3dSettings, { ...DEFAULT_MODEL3D_SETTINGS, ...changes.model3dSettings });
  assert.equal(job.result.generationReceipt.provider, "fal"); assert.equal(job.result.generationReceipt.model, RODIN_TEXT_MODEL);
  assert.equal(job.result.generationReceipt.reservation_microusd, 1_600_000);
  assert.equal(job.result.generationReceipt.maximum_provider_call_count, 1);
  assert.equal(job.result.generationReceipt.max_repair_call_count, 0);
  const same = await (await submit(f, changes)).json(); assert.equal(same.job.jobId, job.jobId); assert.equal(same.reused, true);
  const changed = await (await submit(f, { ...changes, model3dPrompt: "A different chair." })).json();
  assert.notEqual(changed.job.jobId, job.jobId, "a changed prompt is a distinct authorized purchase");
  assert.deepEqual(budgetRows(f), { tokens: [], costs: [] }); assert.equal(calls.length, 0);
});

test("an uncertain Rodin acceptance retains its budget and blocks retry without a second submission", async (t) => {
  const f = await fixture(t), calls = mockNetwork(t, rodinResponses({ failSubmit: true }));
  const { job } = await (await submit(f)).json();
  await f.run(job.jobId);
  const failed = savedJob(f, job.jobId);
  assert.equal(failed.status, "failed"); assert.equal(failed.result.generationReceipt.provider_request_status, "submission_unknown");
  assert.equal(Object.values(failed.result.providerSubmissions)[0].status, "pending");
  assert.equal(budgetRows(f).costs[0].status, "executing");
  const retry = await f.request(`/api/document-jobs/${job.jobId}/retry`, f.json({}));
  assert.equal(retry.status, 409, await retry.clone().text());
  assert.equal((await retry.json()).error, "provider_submission_uncertain");
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
});

test("canceling after Rodin completes accounts for its confirmed cost even before local storage finishes", async (t) => {
  const f = await fixture(t), calls = mockNetwork(t, rodinResponses());
  let enterStorage, releaseStorage;
  const entered = new Promise(resolve => { enterStorage = resolve; });
  const blocked = new Promise(resolve => { releaseStorage = resolve; });
  t.after(() => releaseStorage());
  f.env.MEDIA.put = async () => { enterStorage(); await blocked; };
  const { job } = await (await submit(f)).json();
  const running = f.run(job.jobId);
  await entered;
  const paid = savedJob(f, job.jobId);
  assert.equal(Object.values(paid.result.providerSubmissions)[0].status, "completed");
  assert.equal(budgetRows(f).costs[0].status, "executing");
  const canceled = await f.request(`/api/document-jobs/${job.jobId}/cancel`, f.json({}));
  assert.equal(canceled.status, 200, await canceled.clone().text());
  releaseStorage(); await running;
  const retained = savedJob(f, job.jobId), accounts = budgetRows(f);
  assert.equal(retained.status, "canceled");
  assert.equal(accounts.costs.length, 1); assert.equal(accounts.costs[0].status, "settled");
  assert.equal(accounts.costs[0].used_microusd, 400_000, "canceling local work does not erase the completed provider charge");
  assert.equal(accounts.tokens[0].used_tokens, 0);
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
});

test("a completed 3D result recovers after local storage fails using the original payment and only GETs", async (t) => {
  const f = await fixture(t), calls = mockNetwork(t, rodinResponses());
  let failStorage = true;
  f.env.MEDIA.put = async () => { if (failStorage) throw new Error("Local media storage unavailable"); };
  const { job } = await (await submit(f)).json();
  await f.run(job.jobId);
  const failed = savedJob(f, job.jobId), original = budgetRows(f);
  assert.equal(failed.status, "failed"); assert.equal(Object.values(failed.result.providerSubmissions)[0].status, "completed");
  assert.equal(failed.result.model3dProviderFiles[0].providerMediaUrl, "https://v3.fal.media/files/original-model.glb");
  const listed = await f.request(`/api/document-jobs?document=${encodeURIComponent(f.documentId)}`);
  assert.equal((await listed.text()).includes("https://v3.fal.media/files/original-model.glb"), false, "provider file locations remain in the private recovery checkpoint");
  assert.equal(original.costs.length, 1); assert.equal(original.costs[0].status, "settled"); assert.equal(original.costs[0].used_microusd, 400_000);
  assert.equal(original.tokens[0].used_tokens, 0); assert.equal(original.tokens[0].status, "released");
  const retry = await f.request(`/api/document-jobs/${job.jobId}/retry`, f.json({}));
  assert.equal(retry.status, 202, await retry.clone().text());
  failStorage = false; const beforeRecovery = calls.length;
  await f.run(job.jobId);
  const recovered = savedJob(f, job.jobId);
  assert.equal(recovered.status, "completed", JSON.stringify(recovered.result));
  assert.equal(recovered.correlation_id, failed.correlation_id);
  assert.ok(calls.slice(beforeRecovery).length > 0); assert.ok(calls.slice(beforeRecovery).every(call => call.method === "GET"));
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
  assert.deepEqual(budgetRows(f), original, "recovery keeps the same fully settled payment and zero consumed planning tokens");
  const recorded = f.sqlite.prepare("SELECT SUM(COALESCE(json_extract(payload,'$.cost_microusd'),0)) AS amount FROM events WHERE type='GenerationUsageRecorded' AND json_extract(payload,'$.cost_reservation_id')=?").get(original.costs[0].reservation_id);
  assert.equal(recorded.amount, 400_000, "usage receipts record the completed payment once across failed and recovered attempts");
});

test("accepted 3D submission evidence survives an interrupted convenience receipt and resumes under the original hold", async (t) => {
  const f = await fixture(t);
  let route = rodinResponses({ failResult: true });
  const calls = mockNetwork(t, request => route(request));
  const { job } = await (await submit(f)).json();
  await f.run(job.jobId);
  const failed = savedJob(f, job.jobId), before = budgetRows(f);
  assert.equal(failed.status, "failed"); assert.equal(Object.values(failed.result.providerSubmissions)[0].status, "accepted");
  assert.equal(before.costs[0].status, "executing");
  const interrupted = { ...failed.result };
  for (const field of ["providerJobId", "providerModel", "providerStatusUrl", "providerResponseUrl", "providerCancelUrl", "model3dProviderSubmission"]) delete interrupted[field];
  f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(interrupted), job.jobId);
  const retry = await f.request(`/api/document-jobs/${job.jobId}/retry`, f.json({}));
  assert.equal(retry.status, 202, await retry.clone().text());
  route = rodinResponses(); const count = calls.length;
  await f.run(job.jobId);
  const recovered = savedJob(f, job.jobId), after = budgetRows(f);
  assert.equal(recovered.status, "completed", JSON.stringify(recovered.result));
  assert.equal(after.tokens.length, 1); assert.equal(after.costs.length, 1);
  assert.equal(after.costs[0].reservation_id, before.costs[0].reservation_id);
  assert.equal(after.costs[0].used_microusd, 400_000); assert.equal(after.tokens[0].used_tokens, 0);
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
  assert.ok(calls.slice(count).every(call => call.method === "GET"));
});

for(const shared of [false, true])test(`editing the ${shared ? "shared" : "personal"} document after 3D acceptance preserves its original paid source during GET recovery`, async (t) => {
  const f = await fixture(t, { shared });
  let route = rodinResponses({ failResult: true });
  const calls = mockNetwork(t, request => route(request));
  const { job } = await (await submit(f)).json();
  await f.run(job.jobId);
  const failed = savedJob(f, job.jobId), sourceVersions = structuredClone(failed.request.sourceBlockVersions);
  assert.equal(failed.status, "failed"); assert.equal(Object.values(failed.result.providerSubmissions)[0].status, "accepted");
  const edit = await appendAuditEvent(f.env, f.streamId, "user", "BlockPropertyEdited", { project_id: f.projectId,
    document_id: f.documentId, block_id: "scene-reuse-direction", property_path: "text", new_value: "A newer document direction remains current." });
  const retry = await f.request(`/api/document-jobs/${job.jobId}/retry`, f.json({}));
  assert.equal(retry.status, 202, await retry.clone().text());
  route = rodinResponses(); const count = calls.length;
  await f.run(job.jobId);
  const recovered = savedJob(f, job.jobId);
  assert.equal(recovered.status, "completed", JSON.stringify(recovered.result));
  assert.deepEqual(recovered.request.sourceBlockVersions, sourceVersions);
  const completed = f.sqlite.prepare("SELECT payload FROM events WHERE type='DocumentRenderCompleted' AND json_extract(payload,'$.artifact_id')=?").get(failed.result.artifactId);
  assert.deepEqual(JSON.parse(completed.payload).source_block_versions, sourceVersions);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='BlockPropertyEdited' AND sequence>=?").get(edit.sequence).n, 1, "retrieving an original never rewrites the current document");
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
  assert.ok(calls.slice(count).every(call => call.method === "GET"));
});

test("image readiness explains a missing saved 3D view before its advisory provider review", async (t) => {
  const f = await fixture(t), calls = mockNetwork(t, () => { throw new Error("Invalid saved views cannot reach a provider"); });
  f.env.OPENAI_API_KEY = "mock-readiness-key";
  await appendAuditEvent(f.env, f.streamId, "user", "BlockCreated", { project_id: f.projectId, document_id: f.documentId,
    block_id: "unprepared-model", type: "model3d", handle: "model3d/unprepared", position: "z", properties: {
      weight: 1, model_url: "/api/media/original.glb", model_mime_type: "model/gltf-binary", pixel_reference_mode: "preserve_subject",
    } });
  const response = await f.request("/api/generation-readiness", f.json({ kind: "generate", documentId: f.documentId, force: true }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json(), readiness = body.readiness ?? body;
  assert.equal(readiness.status, "blocked");
  const reference = readiness.probes.find(probe => probe.id === "reference-availability");
  assert.deepEqual(reference.blockIds, ["unprepared-model"]); assert.match(reference.summary, /save the image view/i);
  assert.equal(calls.length, 0);
});

test("3D recovery guidance requires a confirmed receipt and never retries content rejection", () => {
  const error = { code: "local_persistence_failed", category: "server", scope: "request", action: "retry", message: "Local storage failed", retryable: false, httpStatus: 500 };
  const job = { kind: "render_document", status: "failed", result: { artifactKind: "model3d", model3dProviderSubmission: "confirmed", providerJobId: "rodin-original" }, errorDetail: error };
  assert.equal(documentJobCanRecoverProviderRender(job), true);
  assert.equal(generationFailureGuidance(error, "", job).retryAllowed, true);
  assert.equal(documentJobCanRecoverProviderRender({ ...job, result: { ...job.result, model3dProviderSubmission: "pending" } }), false);
  assert.equal(documentJobCanRecoverProviderRender({ ...job, errorDetail: { ...error, category: "safety", retryable: true } }), false);
  assert.equal(generationFailureGuidance({ ...error, category: "safety", retryable: true }, "", job).retryAllowed, false);
});
