import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readOriginalFalModel3d, MODEL3D_ORIGINAL_READ_LIMITS } from "../worker/fal-model3d-original-reader.ts";
import { serializeRodinInput, RODIN_ADAPTER_VERSION } from "../src/model/model3d.ts";
import { MODEL3D_MINI_APP_SETTINGS, createModel3dOutputContract } from "../src/model/output-model3d-contract.ts";
import { describeModel3dPreparation } from "../worker/output-model3d-preparation.ts";

// Actual reader, serializer, prepared-receipt verifier and shared adapter file
// validation. Only HTTP responses and owner/currentness/publication callbacks
// are synthetic. No database, provider, authority or media-quality claim.
const sha = value => createHash("sha256").update(value).digest("hex");
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const providerId = "original-request-1", clientId = "forma-model3d-original-1";
const base = "https://queue.fal.run/fal-ai/hyper3d/requests/" + providerId;
const glb = () => {
  let json = JSON.stringify({ asset: { version: "2.0" } }); while (json.length % 4) json += " ";
  const bytes = new Uint8Array(20 + json.length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); bytes.set(new TextEncoder().encode(json), 20); return bytes;
};
async function fixture() {
  const contract = createModel3dOutputContract({ draftId: "experience-draft-" + "1".repeat(64), draftHash: "sha256:" + "2".repeat(64),
    releaseHash: "sha256:" + "3".repeat(64), requestHash: "sha256:" + "4".repeat(64), sourceBindingHash: "sha256:" + "5".repeat(64), reference: null });
  const prompt = "An original matte lamp", wire = serializeRodinInput(prompt, MODEL3D_MINI_APP_SETTINGS, []);
  const description = await describeModel3dPreparation(contract, { prompt, model: wire.model, settings: wire.settings, references: [],
    referenceBlockIds: [], estimatedCostMicrousd: wire.estimatedCostMicrousd });
  const prepared = { provider: "fal", model: wire.model, adapterVersion: RODIN_ADAPTER_VERSION, submittedPrompt: prompt, settings: wire.settings,
    parameters: wire.input, acceptedFields: Object.keys(wire.input), referenceInputs: [], usedReferencePixels: false,
    estimatedCostMicrousd: wire.estimatedCostMicrousd, requestDigest: sha(stable({ model: wire.model, parameters: wire.input, referenceInputs: [] })) };
  const preview = { version: "model3d-mini-app-cost-v1", requestId: "model3d-" + "6".repeat(64), actorUserId: "owner", projectId: "project",
    documentId: "document", draftId: contract.source.draftId, sourceDigest: "7".repeat(64), requirementsDigest: "8".repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(), preparationDigest: description.preparationDigest, maximumMicrousd: wire.estimatedCostMicrousd,
    maximumCalls: 1, maximumTokens: 1, model: wire.model, sourceFilesTransferred: 0, sourceKind: null, referenceSha256: null, referenceBytes: 0, referenceMimeType: null };
  const original = structuredClone({ offer: { contract, preview, description }, prepared, submission: { clientRequestId: clientId, provider: "fal",
    operation: "model3d", model: wire.model, status: "accepted", providerRequestId: providerId, requestDigest: prepared.requestDigest, unitId: "model3d:initial" } });
  const bytes = glb(), calls = [], events = [], envelopes = [], paid = [], files = [], leases = [];
  const record = lease => { lease.assertCurrent(); leases.push(lease); };
  const options = { deadlineMs: Date.now() + 10000,
    beforeRead: async lease => { record(lease); events.push("current"); },
    onEnvelope: async (value, lease) => { record(lease); envelopes.push(value); events.push("envelope:" + value.phase); },
    onProviderSubmission: async (value, lease) => { record(lease); paid.push(value); events.push("paid"); },
    onResultManifest: async (value, lease) => { record(lease); events.push("manifest:" + value.length); },
    onGeneratedFile: async (value, index, lease) => { record(lease); files.push({ ...value, bytes: new Uint8Array(value.bytes) }); events.push("file:" + index); },
  };
  const resultBody = { request_id: providerId, model_mesh: { url: "https://fal.media/original.glb", file_name: "original.glb",
    content_type: "model/gltf-binary", file_size: bytes.length }, textures: [], seed: 7 };
  const network = async (url, init) => {
    calls.push({ url: String(url), init }); events.push("get:" + String(url));
    assert.equal(init.method, "GET"); assert.equal(init.redirect, "manual"); assert.ok(init.signal);
    const headers = new Headers(init.headers);
    if (String(url).startsWith(base)) assert.equal(headers.get("authorization"), "Key synthetic-only");
    else assert.equal(headers.has("authorization"), false);
    if (url === base + "/status") return Response.json({ request_id: providerId, status: "COMPLETED" });
    if (url === base) return Response.json(resultBody);
    assert.equal(url, resultBody.model_mesh.url);
    return new Response(bytes, { headers: { "content-type": "model/gltf-binary", "content-length": String(bytes.length) } });
  };
  return { original, options, bytes, calls, events, envelopes, paid, files, leases, resultBody, network };
}
async function network(fetcher, work) { const before = globalThis.fetch; globalThis.fetch = async (...args) => fetcher(...args); try { return await work(); } finally { globalThis.fetch = before; } }
const run = f => readOriginalFalModel3d({ FAL_KEY: "synthetic-only" }, f.original, f.options);

test("accepted original uses exact GETs, retains raw evidence before billing/files, and retires every lease", async () => {
  const f = await fixture(), before = structuredClone(f.original), result = await network(f.network, () => run(f));
  assert.equal(result.status, "completed"); assert.equal(result.submission.providerRequestId, providerId);
  assert.equal(result.submission.costMicrousd, f.original.prepared.estimatedCostMicrousd); assert.equal(result.submission.totalTokens, 0);
  assert.deepEqual(f.calls.map(c => c.url), [base + "/status", base, "https://fal.media/original.glb"]);
  assert.deepEqual(f.envelopes.map(e => e.phase), ["status", "result"]);
  for (const e of f.envelopes) { assert.equal(sha(Buffer.from(e.bodyBase64, "base64")), e.sha256); assert.equal(e.requestDigest, before.prepared.requestDigest); assert(Object.isFrozen(e)); }
  assert(f.events.indexOf("envelope:result") < f.events.indexOf("paid"));
  assert(f.events.indexOf("paid") < f.events.indexOf("manifest:1"));
  assert(f.events.indexOf("manifest:1") < f.events.indexOf("get:https://fal.media/original.glb"));
  assert.deepEqual(f.files[0].bytes, f.bytes); assert.equal(result.files[0].sha256, sha(f.bytes)); assert.equal(result.files[0].bytes, undefined);
  assert.deepEqual(f.original, before); assert(f.calls.every(c => c.init.signal.aborted));
  for (const lease of f.leases) assert.throws(() => lease.assertCurrent(), /retired/);
});

test("pending is exactly one original status GET, no billing, files, polling or fallback", async () => {
  const f = await fixture(); let calls = 0;
  const result = await network(async (url, init) => { calls++; assert.equal(url, base + "/status"); assert.equal(init.method, "GET"); return Response.json({ request_id: providerId, status: "IN_PROGRESS" }); }, () => run(f));
  assert.equal(result.status, "pending"); assert.equal(calls, 1); assert.equal(f.envelopes.length, 1); assert.equal(f.paid.length, 0); assert.equal(f.files.length, 0);
});

test("missing, foreign, pending and altered original receipt/preparation refuse before HTTP", async () => {
  const changes = [o => { delete o.submission; }, o => o.submission.status = "pending", o => o.submission.status = "rejected",
    o => delete o.submission.providerRequestId, o => o.submission.providerRequestId = "../foreign", o => o.submission.clientRequestId = "",
    o => o.submission.provider = "openai", o => o.submission.model = "foreign", o => o.submission.requestDigest = "0".repeat(64),
    o => o.prepared.requestDigest = "0".repeat(64), o => o.prepared.settings.tier = "Gen-2",
    o => { o.prepared.referenceInputs = Array(1); }, o => { Object.defineProperty(o.submission, "providerRequestId", { enumerable: true, get() { return assert.fail("accessor invoked"); } }); },
    o => { o.submission.status = "completed"; o.submission.costMicrousd = 0; o.submission.totalTokens = 0; }];
  for (const change of changes) {
    const f = await fixture(); change(f.original);
    await network(() => assert.fail("no HTTP permitted"), () => assert.rejects(run(f)));
  }
});

test("caller mutation after capture cannot substitute original IDs, input, key or callback", async () => {
  const f = await fixture(), first = f.options.beforeRead, env = { FAL_KEY: "synthetic-only" };
  f.options.beforeRead = async lease => {
    await first(lease);
    f.original.submission.providerRequestId = "foreign"; f.original.submission.clientRequestId = "foreign";
    f.original.prepared.parameters.prompt = "changed"; env.FAL_KEY = "foreign";
    f.options.onGeneratedFile = () => assert.fail("late callback substitution");
  };
  const result = await network(f.network, () => readOriginalFalModel3d(env, f.original, f.options));
  assert.equal(result.receipt.providerJobId, providerId); assert.equal(f.files.length, 1);
});

test("currentness failure after response blocks envelope publication and the next request", async () => {
  const f = await fixture(); let revoked = false, calls = 0;
  f.options.beforeRead = lease => { lease.assertCurrent(); if (revoked) throw Error("source-retired"); };
  await network(async () => { calls++; revoked = true; return Response.json({ request_id: providerId, status: "COMPLETED" }); },
    () => assert.rejects(run(f), /source-retired/));
  assert.equal(calls, 1); assert.equal(f.envelopes.length, 0); assert.equal(f.paid.length, 0);
});

test("status/result ID mismatches, errors and malformed JSON never become completed billing", async () => {
  for (const [phase, response] of [
    ["status", () => Response.json({ request_id: "foreign", status: "COMPLETED" })],
    ["status", () => new Response("{", { status: 200 })],
    ["status", () => Response.json({ request_id: providerId, status: "FAILED" })],
    ["result", () => Response.json({ request_id: "foreign", textures: [], seed: 1 })],
    ["result", () => Response.json({ request_id: providerId, data: { request_id: "foreign" } })],
    ["result", () => Response.json({ request_id: providerId, error: "expired" }, { status: 404 })],
  ]) {
    const f = await fixture();
    await network((url, init) => url === (phase === "status" ? base + "/status" : base) ? response() : f.network(url, init),
      () => assert.rejects(run(f)));
    assert.equal(f.paid.length, 0); assert.equal(f.files.length, 0);
  }
});

test("every 3xx refuses without body reading or following, cancellation never delays exit", async () => {
  for (let status = 300; status < 400; status++) {
    const f = await fixture(); let calls = 0, canceled = 0;
    const response = new Response(status === 304 ? null : new ReadableStream({ cancel() { canceled++; return new Promise(() => {}); } }), { status, headers: { location: "https://must-not-follow.invalid/" } });
    await network(async () => { calls++; return response; }, () => assert.rejects(run(f), /model3d_original_redirect_refused/));
    assert.equal(calls, 1); assert.equal(canceled, status === 304 ? 0 : 1); assert.equal(f.envelopes.length, 0);
  }
});

test("held fetch is finite; a late response is canceled and cannot call a sink", { timeout: 2000 }, async () => {
  const f = await fixture(); f.options.deadlineMs = Date.now() + 30; let resolveFetch, canceled = 0;
  await network(() => new Promise(resolve => { resolveFetch = resolve; }), async () => {
    await assert.rejects(run(f), /timeout|expired/);
    if (resolveFetch) resolveFetch(new Response(new ReadableStream({ cancel() { canceled++; return new Promise(() => {}); } })));
    await new Promise(resolve => setImmediate(resolve));
  });
  assert.equal(canceled, resolveFetch ? 1 : 0); assert.equal(f.envelopes.length, 0); assert.equal(f.files.length, 0);
});

test("held body/cancellation and held authority hook are finite", { timeout: 2000 }, async () => {
  for (const mode of ["body", "hook"]) {
    const f = await fixture(); f.options.deadlineMs = Date.now() + 30; let canceled = 0;
    if (mode === "hook") f.options.beforeRead = lease => { lease.assertCurrent(); return new Promise(() => {}); };
    await network(async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { canceled++; return new Promise(() => {}); } })),
      () => assert.rejects(run(f), /timeout|expired/));
    assert.equal(canceled, mode === "body" ? 1 : 0); assert.equal(f.paid.length, 0);
  }
});

test("caller abort and unobserved hook stop without a replacement", async () => {
  const f = await fixture(), control = new AbortController(); f.options.signal = control.signal; control.abort(Error("owned-stop"));
  await network(() => assert.fail("aborted HTTP"), () => assert.rejects(run(f), /owned-stop/));
  const g = await fixture(); g.options.beforeRead = () => {};
  await network(() => assert.fail("unobserved HTTP"), () => assert.rejects(run(g), /hook_unobserved/));
});

test("full unique mesh/texture/sidecar manifest is preserved in order with one file sink each", async () => {
  const f = await fixture(), sidecar = new TextEncoder().encode("newmtl original");
  f.resultBody.model_meshes = [{ ...f.resultBody.model_mesh }];
  f.resultBody.textures = [{ url: "https://fal.media/material.mtl", file_name: "material.mtl", file_size: sidecar.length, content_type: "text/plain" }];
  const result = await network((url, init) => url === "https://fal.media/material.mtl"
    ? (assert.equal(new Headers(init.headers).has("authorization"), false), new Response(sidecar, { headers: { "content-type": "text/plain" } })) : f.network(url, init), () => run(f));
  assert.equal(result.manifest.length, 2); assert.equal(result.files.length, 2); assert.deepEqual(f.files.map(file => file.fileName), ["original.glb", "material.mtl"]);
});

test("known billability survives excessive manifest count, with no manifest callback or file transfer", async () => {
  const f = await fixture();
  f.resultBody.textures = Array.from({ length: MODEL3D_ORIGINAL_READ_LIMITS.maximumFiles }, (_, i) => ({ url: "https://fal.media/" + i + ".mtl" }));
  await network(f.network, () => assert.rejects(run(f), /file_count_limit/));
  assert.equal(f.paid.length, 1); assert.equal(f.envelopes.length, 2); assert.equal(f.files.length, 0);
  assert(!f.events.some(event => event.startsWith("manifest:"))); assert.equal(f.calls.length, 2);
});

test("untrusted file URLs and invalid model signatures preserve paid observation, never substitute bytes", async () => {
  const f = await fixture(); f.resultBody.model_mesh.url = "https://foreign.invalid/model.glb";
  await network(f.network, () => assert.rejects(run(f), error => error.detail?.code === "model3d_media_url_untrusted")); assert.equal(f.paid.length, 1); assert.equal(f.calls.length, 2);
  const g = await fixture();
  await network((url, init) => url === "https://fal.media/original.glb" ? new Response(new Uint8Array(g.bytes.length), { headers: { "content-type": "model/gltf-binary" } }) : g.network(url, init),
    () => assert.rejects(run(g), error => error.detail?.code === "model3d_artifact_invalid"));
  assert.equal(g.paid.length, 1); assert.equal(g.files.length, 0);
});

test("unknown file length streams into one bounded destination and copies reused producer chunks", async () => {
  const f = await fixture(); delete f.resultBody.model_mesh.file_size;
  const chunks = [f.bytes.subarray(0, 12), f.bytes.subarray(12)], scratch = new Uint8Array(f.bytes.length);
  let step = 0;
  const result = await network((url, init) => url === "https://fal.media/original.glb"
    ? new Response(new ReadableStream({ pull(controller) {
      if (step === chunks.length) { controller.close(); return; }
      const part = chunks[step++]; scratch.fill(0); scratch.set(part); controller.enqueue(scratch.subarray(0, part.length));
    } }, { highWaterMark: 0 }), { headers: { "content-type": "model/gltf-binary" } }) : f.network(url, init), () => run(f));
  assert.deepEqual(f.files[0].bytes, f.bytes); assert.equal(result.files[0].fileSize, f.bytes.length);
});

test("length/size/header and file redirect failures leave no delivered file", async () => {
  for (const response of [
    f => new Response(f.bytes.subarray(0, f.bytes.length - 1)),
    f => new Response(f.bytes, { headers: { "content-length": "999999999" } }),
    f => new Response(f.bytes, { headers: { "content-type": "text/html" } }),
    () => new Response(null, { status: 302, headers: { location: "https://must-not-follow.invalid/" } }),
  ]) {
    const f = await fixture();
    await network((url, init) => url === "https://fal.media/original.glb" ? response(f) : f.network(url, init), () => assert.rejects(run(f)));
    assert.equal(f.paid.length, 1); assert.equal(f.files.length, 0);
  }
});

test("completed original preserves exact monetary identity and still has no submission branch", async () => {
  const f = await fixture(); Object.assign(f.original.submission, { status: "completed", costMicrousd: f.original.prepared.estimatedCostMicrousd, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  const result = await network(f.network, () => run(f));
  assert.equal(result.status, "completed"); assert.equal(f.paid[0].costMicrousd, f.original.submission.costMicrousd); assert.equal(f.calls.length, 3);
});
