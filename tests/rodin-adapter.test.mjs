import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { RODIN_ADAPTER_VERSION, RODIN_IMAGE_MODEL, RODIN_TEXT_MODEL } from "../src/model/model3d.ts";
import { MAX_MODEL3D_GENERATED_FILE_BYTES, falModel3dError, generateFalModel3d } from "../worker/fal-model3d-adapter.ts";
import { hasUnsettledProviderSubmission, mergeProviderSubmissions } from "../src/model/provider-submission.ts";
import { ProviderRequestError } from "../worker/provider-errors.ts";

const ENV = { FAL_KEY: "fal-test-only" };
const PROMPT = "  A carved wooden chair with brass feet.\nPreserve the engraved star.  ";
const REQUEST_ID = "rodin-request-1";
const POST_URL = `https://queue.fal.run/${RODIN_TEXT_MODEL}`;
const RESULT_URL = `https://queue.fal.run/fal-ai/hyper3d/requests/${REQUEST_ID}`;
const STATUS_URL = `${RESULT_URL}/status?logs=1`;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function tinyGlb(name) {
  const json = JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ name, nodes: [] }] });
  const chunk = Buffer.from(json.padEnd(Math.ceil(Buffer.byteLength(json) / 4) * 4, " "));
  const bytes = new Uint8Array(20 + chunk.length);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, bytes.length, true);
  header.setUint32(12, chunk.length, true);
  header.setUint32(16, 0x4e4f534a, true);
  bytes.set(chunk, 20);
  return bytes;
}

const ARTIFACTS = [
  { url: "https://v3.fal.media/files/chair-pbr.glb", name: "chair-pbr.glb", bytes: tinyGlb("PBR chair"), role: "mesh", mime: "model/gltf-binary", format: "glb" },
  { url: "https://v3.fal.media/files/chair-shaded.glb", name: "chair-shaded.glb", bytes: tinyGlb("Shaded chair"), role: "mesh", mime: "model/gltf-binary", format: "glb" },
  { url: "https://v3.fal.media/files/albedo.png", name: "albedo.png", bytes: new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=", "base64")), role: "texture", mime: "image/png", format: null },
  { url: "https://v3.fal.media/files/preview.webp", name: "preview.webp", bytes: new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64")), role: "preview", mime: "image/webp", format: null },
];

function providerResult() {
  const entry = (artifact) => ({ url: artifact.url, file_name: artifact.name, content_type: "application/octet-stream", file_size: artifact.bytes.length });
  return {
    request_id: REQUEST_ID,
    model_mesh: entry(ARTIFACTS[0]), model_meshes: [entry(ARTIFACTS[1])],
    textures: ARTIFACTS.slice(2).map((artifact) => ({ ...entry(artifact), width: null, height: null })), seed: 0,
  };
}

function mockFetch(t, handler) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const call = { url: input instanceof Request ? input.url : String(input), method: init.method ?? "GET", init };
    calls.push(call);
    return handler(call, calls);
  });
  return calls;
}

function downloadResponse(url) {
  const file = ARTIFACTS.find((artifact) => artifact.url === url);
  return file ? new Response(new Uint8Array(file.bytes), { headers: { "content-type": "application/octet-stream" } }) : null;
}

function resultFiles(result) {
  return [result, ...result.additionalMeshes, ...result.textures];
}

function assertFailure(code, prompt = PROMPT) {
  return (error) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.detail.code, code);
    assert.equal(error.preparedPrompt, prompt);
    return true;
  };
}

function submissionCheckpoint(submissions) {
  const providerSubmissions = submissions.reduce((previous, submission) =>
    mergeProviderSubmissions(previous, { [submission.clientRequestId]: submission }), {});
  return { providerSubmissions };
}

function typedModelError(type = "content_policy_violation", requestId = REQUEST_ID) {
  return { request_id: requestId, detail: [{ loc: ["body", "prompt"], type, msg: "The checker could not accept the input." }] };
}

test("submits one reviewed text request without OpenAI and returns every artifact's bytes and hash", async (t) => {
  const submissions = [], receipts = [], stages = [], attempts = [];
  let prepared, polls = 0;
  const calls = mockFetch(t, ({ url, method }) => {
    if (url === POST_URL && method === "POST") return Response.json({ request_id: REQUEST_ID, status: "IN_QUEUE" });
    if (url === STATUS_URL) return Response.json({ request_id: REQUEST_ID, status: polls++ === 0 ? "IN_PROGRESS" : "COMPLETED" });
    if (url === RESULT_URL) return Response.json({ request_id: REQUEST_ID, data: providerResult() });
    const file = downloadResponse(url);
    if (file) return file;
    throw new Error(`Unexpected network request: ${method} ${url}`);
  });
  const result = await generateFalModel3d(ENV, PROMPT, {
    settings: { seed: 0 }, pollIntervalMs: 0,
    onPrepared: (receipt) => { prepared = structuredClone(receipt); },
    onProviderSubmission: (submission) => { submissions.push(structuredClone(submission)); },
    onReceipt: (receipt) => { receipts.push(structuredClone(receipt)); },
    onStage: (stage) => { stages.push(stage); },
    onBeforeProviderAttempt: (attempt) => { attempts.push(attempt); },
  });
  const posts = calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, POST_URL);
  assert.equal(calls.some((call) => call.url.includes("openai.com")), false);
  const submitted = JSON.parse(posts[0].init.body);
  assert.deepEqual(submitted, {
    prompt: PROMPT, tier: "Gen-2.5-High", geometry_file_format: "glb", material: "All",
    quality_mesh_option: "Auto", enable_creative_mode: false, hd_texture: false,
    texture_delight: false, is_micro: false, TAPose: false, addons: { high_pack: false }, seed: 0,
  });
  for (const field of ["image_urls", "use_original_alpha", "preview_render"]) assert.equal(Object.hasOwn(submitted, field), false);
  assert.equal(prepared.submittedPrompt, PROMPT);
  assert.deepEqual(prepared.parameters, submitted);
  assert.deepEqual(prepared.acceptedFields.sort(), Object.keys(submitted).sort());
  assert.deepEqual(prepared.referenceInputs, []);
  assert.equal(prepared.usedReferencePixels, false);
  assert.match(prepared.requestDigest, /^[a-f0-9]{64}$/u);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].maximumInputTokens, 0);
  assert.equal(attempts[0].maximumOutputTokens, 0);
  assert.equal(attempts[0].requestDigest, prepared.requestDigest);
  assert.deepEqual(submissions.map((submission) => submission.status), ["pending", "accepted", "completed"]);
  assert.equal(submissions[1].providerRequestId, REQUEST_ID);
  assert.equal(submissions[2].costMicrousd, 400_000);
  assert.equal(new Set(submissions.map((submission) => submission.clientRequestId)).size, 1);
  assert.equal(receipts[0].providerResponseUrl, RESULT_URL);
  assert.ok(stages.includes("submitting") && stages.includes("rendering-model3d") && stages.includes("finalizing"));
  assert.equal(result.providerRequestId, REQUEST_ID);
  assert.equal(result.adapterVersion, RODIN_ADAPTER_VERSION);
  assert.equal(result.seed, 0);
  assert.equal(result.submittedPrompt, PROMPT);
  assert.equal(result.costMicrousd, 400_000);
  assert.equal(result.costPrecision, "published-provider-estimate");
  assert.equal(result.additionalMeshes.length, 1);
  assert.equal(result.textures.length, 2);
  for (const [index, file] of resultFiles(result).entries()) {
    const fixture = ARTIFACTS[index];
    assert.deepEqual(file.bytes, fixture.bytes);
    assert.equal(file.fileSize, fixture.bytes.length);
    assert.equal(file.sha256, digest(fixture.bytes));
    assert.equal(file.fileName, fixture.name);
    assert.equal(file.mimeType, fixture.mime);
    assert.equal(file.role, fixture.role);
    assert.equal(file.format, fixture.format);
  }
  for (const call of calls.filter((call) => call.url.startsWith("https://queue.fal.run/"))) {
    assert.equal(new Headers(call.init.headers).get("authorization"), "Key fal-test-only");
    assert.equal(call.init.redirect, "manual");
  }
  for (const call of calls.filter((call) => call.url.startsWith("https://v3.fal.media/"))) {
    assert.equal(new Headers(call.init.headers).get("authorization"), null);
  }
});

test("uploads PNG and JPEG references in order before an empty-prompt image generation using only Fal", async (t) => {
  const imagePostUrl = `https://queue.fal.run/${RODIN_IMAGE_MODEL}`;
  const uploadUrls = ["https://v3.fal.media/upload/front", "https://v3.fal.media/upload/back"];
  const imageUrls = ["https://v3.fal.media/references/front.png", "https://v3.fal.media/references/back.jpeg"];
  const jpeg = new Uint8Array(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdAAr/2Q==", "base64"));
  const references = [
    { bytes: ARTIFACTS[2].bytes, mimeType: "image/png", blockId: "model-block", referenceId: "view-front", label: "Front material reference" },
    { bytes: jpeg, mimeType: "image/jpeg", blockId: "model-block", referenceId: "view-back", label: "Back view" },
  ];
  const uploads = [], initiations = [];
  let prepared, attemptedAfterUploads;
  const calls = mockFetch(t, async ({ url, method, init }) => {
    const parsed = new URL(url);
    if (["rest.fal.ai", "rest.alpha.fal.ai"].includes(parsed.hostname) && parsed.pathname === "/storage/upload/initiate" && method === "POST") {
      const index = initiations.length;
      initiations.push(JSON.parse(init.body));
      assert.equal(new Headers(init.headers).get("authorization"), "Key fal-test-only");
      return Response.json({ upload_url: uploadUrls[index], file_url: imageUrls[index] });
    }
    const uploadIndex = uploadUrls.indexOf(url);
    if (uploadIndex >= 0 && method === "PUT") {
      const bytes = new Uint8Array(await init.body.arrayBuffer());
      assert.deepEqual(bytes, references[uploadIndex].bytes);
      assert.equal(new Headers(init.headers).get("content-type"), references[uploadIndex].mimeType);
      assert.equal(new Headers(init.headers).get("authorization"), null);
      uploads.push(uploadIndex);
      return new Response("");
    }
    if (url === imagePostUrl && method === "POST") {
      assert.deepEqual(uploads, [0, 1], "All references must finish uploading before the paid POST");
      return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
    }
    if (url === RESULT_URL) return Response.json(providerResult());
    const file = downloadResponse(url);
    if (file) return file;
    throw new Error(`Unexpected image-generation request: ${method} ${url}`);
  });
  const result = await generateFalModel3d(ENV, "", {
    references, settings: { use_original_alpha: true, preview_render: true },
    onPrepared: (receipt) => { prepared = structuredClone(receipt); },
    onBeforeProviderAttempt: () => { attemptedAfterUploads = [...uploads]; },
  });
  assert.deepEqual(initiations.map((input) => input.content_type), ["image/png", "image/jpeg"]);
  assert.deepEqual(attemptedAfterUploads, [0, 1]);
  const paid = calls.filter((call) => call.url.startsWith("https://queue.fal.run/") && call.method === "POST");
  assert.equal(paid.length, 1);
  assert.equal(paid[0].url, imagePostUrl);
  const submitted = JSON.parse(paid[0].init.body);
  assert.equal(submitted.prompt, "");
  assert.deepEqual(submitted.image_urls, imageUrls);
  assert.equal(submitted.use_original_alpha, true);
  assert.equal(submitted.preview_render, true);
  assert.equal(calls.some((call) => call.url.includes("openai.com")), false);
  assert.equal(prepared.model, RODIN_IMAGE_MODEL);
  assert.equal(prepared.usedReferencePixels, true);
  assert.equal(Object.hasOwn(prepared.parameters, "image_urls"), false, "Storage URLs are excluded from the durable pixel receipt");
  assert.deepEqual(prepared.referenceInputs.map((reference) => ({
    index: reference.index, mimeType: reference.mimeType, byteLength: reference.byteLength,
    sha256: reference.sha256, referenceId: reference.referenceId,
  })), references.map((reference, index) => ({
    index, mimeType: reference.mimeType, byteLength: reference.bytes.length,
    sha256: digest(reference.bytes), referenceId: reference.referenceId,
  })));
  assert.equal(result.submittedPrompt, "");
  assert.equal(result.seed, 0);
  assert.equal(result.model, RODIN_IMAGE_MODEL);
});

test("persists primary bytes at index zero before later downloads and releases only returned file bytes", async (t) => {
  const timeline = [], persisted = [];
  const calls = mockFetch(t, ({ url, method }) => {
    if (url === POST_URL && method === "POST") return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
    if (url === RESULT_URL) return Response.json(providerResult());
    const response = downloadResponse(url);
    if (response) { timeline.push(`fetch:${url}`); return response; }
    throw new Error(`Unexpected network request: ${url}`);
  });
  const result = await generateFalModel3d(ENV, PROMPT, {
    retainFileBytes: false,
    onGeneratedFile: async (file, index) => {
      assert.equal(index, persisted.length);
      assert.deepEqual(file.bytes, ARTIFACTS[index].bytes);
      persisted.push(structuredClone(file));
      await new Promise((resolve) => setImmediate(resolve));
      timeline.push(`persisted:${index}`);
    },
  });
  assert.equal(persisted.length, ARTIFACTS.length);
  for (let index = 1; index < ARTIFACTS.length; index++) {
    assert.ok(timeline.indexOf(`persisted:${index - 1}`) < timeline.indexOf(`fetch:${ARTIFACTS[index].url}`));
  }
  for (const [index, file] of resultFiles(result).entries()) {
    assert.equal(file.bytes.length, 0);
    assert.equal(file.fileSize, ARTIFACTS[index].bytes.length);
    assert.equal(file.sha256, digest(ARTIFACTS[index].bytes));
    assert.deepEqual(persisted[index].bytes, ARTIFACTS[index].bytes);
  }
  const beforeMissingSink = calls.length;
  await assert.rejects(() => generateFalModel3d(ENV, PROMPT, { retainFileBytes: false }), assertFailure("model3d_file_sink_required"));
  assert.equal(calls.length, beforeMissingSink);
});

test("resumes an accepted retained submission using GET only without a top-level provider ID", async (t) => {
  const submissions = [], stages = [];
  let saved, retainedSubmission, resumedPrepared, resuming = false;
  const calls = mockFetch(t, ({ url, method }) => {
    if (resuming) assert.equal(method, "GET");
    if (url === POST_URL && method === "POST") return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
    if (url === STATUS_URL) return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
    if (url === RESULT_URL) return Response.json(providerResult());
    const file = downloadResponse(url);
    if (file) return file;
    throw new Error(`Unexpected network request: ${url}`);
  });
  await generateFalModel3d(ENV, PROMPT, {
    settings: { seed: 0 },
    onPrepared: (receipt) => { saved = structuredClone(receipt); },
    onProviderSubmission: (submission) => {
      if (submission.status === "accepted") retainedSubmission = structuredClone(submission);
    },
  });
  const initialCallCount = calls.length;
  resuming = true;
  const result = await generateFalModel3d(ENV, "Changed document text is not resubmitted.", {
    retainedSubmission, retainedReceipt: saved, settings: { seed: -1 }, pollIntervalMs: 0,
    onPrepared: (receipt) => { resumedPrepared = receipt; },
    onProviderSubmission: (submission) => { submissions.push(submission); },
    onStage: (stage) => { stages.push(stage); },
    onBeforeProviderAttempt: () => { assert.fail("Recovery must not begin a paid attempt"); },
  });
  assert.equal(resumedPrepared, saved);
  assert.equal(result.submittedPrompt, PROMPT);
  assert.equal(result.seed, 0);
  assert.equal(result.providerRequestId, REQUEST_ID);
  assert.equal(calls[initialCallCount].url, STATUS_URL);
  assert.equal(calls.slice(initialCallCount).every((call) => call.method === "GET"), true);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1, "Only the first generation purchases work");
  assert.deepEqual(submissions.map((submission) => submission.status), ["completed"]);
  assert.equal(submissions[0].clientRequestId, retainedSubmission.clientRequestId);
  assert.ok(stages.includes("provider-resume"));
  const tampered = structuredClone(saved);
  tampered.parameters.prompt = "A different object was never reviewed.";
  const beforeTamperedResume = calls.length;
  await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
    retainedSubmission, retainedReceipt: tampered,
  }), assertFailure("model3d_prepared_receipt_mismatch"));
  assert.equal(calls.length, beforeTamperedResume);
});

test("retains a pending receipt after an uncertain POST and refuses to purchase again", async (t) => {
  const submissions = [], receipts = [];
  let prepared;
  const calls = mockFetch(t, ({ url, method }) => {
    assert.equal(url, POST_URL);
    assert.equal(method, "POST");
    throw new TypeError("Connection ended after dispatch");
  });
  await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
    onPrepared: (receipt) => { prepared = structuredClone(receipt); },
    onProviderSubmission: (submission) => { submissions.push(structuredClone(submission)); },
    onReceipt: (receipt) => { receipts.push(receipt); },
  }), assertFailure("model3d_submission_uncertain"));
  assert.equal(calls.length, 1);
  assert.deepEqual(submissions.map((submission) => submission.status), ["pending"]);
  assert.equal(submissions[0].providerRequestId, undefined);
  assert.equal(receipts.length, 0);
  await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
    retainedSubmission: submissions[0], retainedReceipt: prepared,
    onProviderSubmission: () => { assert.fail("Pending recovery cannot purchase again"); },
  }), assertFailure("model3d_submission_unresolved"));
  assert.equal(calls.length, 1, "An uncertain dispatch is never automatically retried");
});

test("settles a pending receipt at zero cost when cancellation or a guard definitively prevents dispatch", async (t) => {
  const calls = mockFetch(t, () => { throw new Error("Dispatch was prevented before the POST"); });
  for (const cause of ["abort", "guard"]) {
    const controller = new AbortController();
    const rejected = new Error("The durable dispatch guard rejected this attempt");
    const submissions = [];
    await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
      signal: controller.signal,
      onProviderSubmission: (submission) => {
        submissions.push(structuredClone(submission));
        if (cause === "abort" && submission.status === "pending") controller.abort();
      },
      onBeforeProviderDispatch: () => { if (cause === "guard") throw rejected; },
    }), (error) => cause === "abort" ? error.name === "AbortError" : error === rejected);
    assert.deepEqual(submissions.map((submission) => submission.status), ["pending", "rejected"], cause);
    assert.equal(submissions[1].costMicrousd, 0);
    assert.equal(submissions[1].clientRequestId, submissions[0].clientRequestId);
    assert.equal(submissions[1].providerRequestId, undefined);
  }
  assert.equal(calls.length, 0);
});

test("rejects overlength prompts and preflight denials before any network or paid receipt", async (t) => {
  const calls = mockFetch(t, () => { throw new Error("Preflight must stop all network"); });
  let submissions = 0;
  for (const prompt of ["a".repeat(1025), "🪑".repeat(1025)]) {
    await assert.rejects(() => generateFalModel3d(ENV, prompt, {
      onProviderSubmission: () => { submissions++; },
    }), assertFailure("model3d_prompt_too_long", prompt));
  }
  const denied = new Error("The reserved generation budget is unavailable");
  await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
    onBeforeProviderAttempt: () => { throw denied; },
    onProviderSubmission: () => { submissions++; },
  }), (error) => error === denied);
  assert.equal(calls.length, 0);
  assert.equal(submissions, 0);
});

test("durably reports the accepted canonical receipt before rejecting an untrusted queue URL", async (t) => {
  const submissions = [], receipts = [], timeline = [];
  const calls = mockFetch(t, ({ url, method }) => {
    assert.equal(url, POST_URL);
    assert.equal(method, "POST");
    return Response.json({ request_id: REQUEST_ID, status: "IN_QUEUE", response_url: "https://untrusted.example/collect" });
  });
  await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
    onProviderSubmission: async (submission) => {
      await new Promise((resolve) => setImmediate(resolve));
      submissions.push(structuredClone(submission));
      timeline.push(submission.status);
    },
    onReceipt: async (receipt) => {
      await new Promise((resolve) => setImmediate(resolve));
      receipts.push(structuredClone(receipt));
      timeline.push("receipt-durable");
    },
  }), (error) => {
    assertFailure("model3d_queue_url_untrusted")(error);
    assert.equal(error.detail.requestId, REQUEST_ID);
    assert.deepEqual(timeline, ["pending", "accepted", "receipt-durable"]);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(submissions.map((submission) => submission.status), ["pending", "accepted"]);
  assert.equal(submissions[1].providerRequestId, REQUEST_ID);
  assert.deepEqual(receipts, [{
    provider: "fal", model: RODIN_TEXT_MODEL, providerJobId: REQUEST_ID,
    providerStatusUrl: `${RESULT_URL}/status`, providerResponseUrl: RESULT_URL,
    providerCancelUrl: `${RESULT_URL}/cancel`,
  }]);
});

test("classifies a completed status content violation as safety without fetching a result or losing the prompt", async (t) => {
  const submissions = [];
  const calls = mockFetch(t, ({ url, method }) => {
    if (url === POST_URL && method === "POST") return Response.json({ request_id: REQUEST_ID, status: "IN_QUEUE" });
    if (url === STATUS_URL) return Response.json({ request_id: REQUEST_ID, status: "COMPLETED", error_type: "content_policy_violation", error: "The content checker rejected this input." });
    throw new Error(`A rejected generation must not fetch results: ${url}`);
  });
  await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
    pollIntervalMs: 0,
    onProviderSubmission: (submission) => { submissions.push(submission); },
  }), (error) => {
    assertFailure("fal_model3d_content_policy_violation")(error);
    assert.equal(error.detail.category, "safety");
    assert.equal(error.detail.action, "edit_request");
    assert.equal(error.detail.retryable, false);
    assert.equal(error.detail.requestId, REQUEST_ID);
    assert.equal(error.detail.probe, "fal-rodin-provider-content-validation");
    return true;
  });
  assert.deepEqual(calls.map((call) => call.url), [POST_URL, STATUS_URL]);
  assert.deepEqual(submissions.map((submission) => submission.status), ["pending", "accepted", "completed"]);
  const completed = submissions.at(-1);
  assert.equal(completed.clientRequestId, submissions[0].clientRequestId);
  assert.equal(completed.providerRequestId, REQUEST_ID);
  assert.equal(completed.costMicrousd, 0);
  const checkpoint = submissionCheckpoint(submissions);
  assert.deepEqual(Object.values(checkpoint.providerSubmissions), [completed]);
  assert.equal(hasUnsettledProviderSubmission(checkpoint), false);
});

test("blocks an artifact redirect and retains the original request for recovery", async (t) => {
  const submissions = [];
  const calls = mockFetch(t, ({ url, method }) => {
    if (url === POST_URL && method === "POST") return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
    if (url === RESULT_URL) return Response.json(providerResult());
    if (url === ARTIFACTS[0].url) return new Response(null, { status: 302, headers: { location: "https://untrusted.example/model.glb" } });
    throw new Error(`Artifact redirects must not be followed: ${url}`);
  });
  await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
    onProviderSubmission: (submission) => { submissions.push(submission); },
  }), (error) => {
    assertFailure("model3d_download_failed")(error);
    assert.equal(error.detail.requestId, REQUEST_ID);
    assert.equal(error.detail.httpStatus, 302);
    return true;
  });
  const artifactCall = calls.find((call) => call.url === ARTIFACTS[0].url);
  assert.equal(artifactCall.init.redirect, "manual");
  assert.equal(new Headers(artifactCall.init.headers).get("authorization"), null);
  assert.equal(calls.some((call) => call.url.includes("untrusted.example")), false);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(submissions.at(-1).providerRequestId, REQUEST_ID);
  assert.deepEqual(submissions.map((submission) => submission.status), ["pending", "accepted", "completed"]);
  const checkpoint = submissionCheckpoint(submissions);
  assert.equal(Object.values(checkpoint.providerSubmissions)[0].costMicrousd, 400_000);
  assert.equal(hasUnsettledProviderSubmission(checkpoint), false);
});

test("retains the artifact manifest and rejects a known excessive size before reading media", async (t) => {
  assert.equal(MAX_MODEL3D_GENERATED_FILE_BYTES, 64 * 1024 * 1024);
  const excessive = MAX_MODEL3D_GENERATED_FILE_BYTES + 1;
  let source, manifest, headerResponse, cancelled = 0;
  const calls = mockFetch(t, ({ url, method }) => {
    if (url === POST_URL && method === "POST") return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
    if (url === RESULT_URL) {
      const result = providerResult();
      if (source === "metadata") result.model_mesh.file_size = excessive;
      else delete result.model_mesh.file_size;
      return Response.json(result);
    }
    if (url === ARTIFACTS[0].url && source === "header") {
      assert.ok(manifest, "The manifest must be persisted before any media fetch");
      headerResponse = new Response(new ReadableStream({ cancel() { cancelled++; } }), {
        headers: { "content-type": "application/octet-stream", "content-length": String(excessive) },
      });
      t.mock.method(headerResponse, "arrayBuffer", () => { assert.fail("Oversized media must not be buffered"); });
      t.mock.method(headerResponse.body, "getReader", () => { assert.fail("The declared excessive length must be checked before reading"); });
      return headerResponse;
    }
    throw new Error(`An excessive artifact must not be downloaded: ${url}`);
  });
  for (source of ["metadata", "header"]) {
    manifest = undefined;
    const start = calls.length;
    await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
      onResultManifest: async (files) => {
        await new Promise((resolve) => setImmediate(resolve));
        manifest = structuredClone(files);
      },
      onGeneratedFile: () => { assert.fail("No oversized artifact is persisted as complete"); },
    }), (error) => {
      assertFailure("model3d_artifact_transfer_limit")(error);
      assert.equal(error.detail.requestId, REQUEST_ID);
      assert.equal(error.detail.httpStatus, 413);
      return true;
    });
    assert.equal(manifest.length, ARTIFACTS.length);
    assert.equal(manifest[0].providerMediaUrl, ARTIFACTS[0].url);
    assert.equal(manifest[0].fileSize, source === "metadata" ? excessive : null);
    const mediaCalls = calls.slice(start).filter((call) => call.url.startsWith("https://v3.fal.media/"));
    assert.equal(mediaCalls.length, source === "metadata" ? 0 : 1);
  }
  assert.equal(cancelled, 1);
  assert.equal(headerResponse.arrayBuffer.mock.callCount(), 0);
  assert.equal(headerResponse.body.getReader.mock.callCount(), 0);
});

test("cancels a chunked artifact as soon as cumulative bytes cross the private-transfer limit", async (t) => {
  // Reusing this immutable chunk exercises the cumulative limit with one allocation.
  const chunk = new Uint8Array(MAX_MODEL3D_GENERATED_FILE_BYTES / 2 + 1);
  let cancelled = 0, pulls = 0, manifest;
  const calls = mockFetch(t, ({ url, method }) => {
    if (url === POST_URL && method === "POST") return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
    if (url === RESULT_URL) {
      const result = providerResult();
      delete result.model_mesh.file_size;
      return Response.json(result);
    }
    if (url === ARTIFACTS[0].url) {
      assert.ok(manifest, "Recovery descriptors must be retained before streaming bytes");
      return new Response(new ReadableStream({
        pull(controller) { pulls++; controller.enqueue(chunk); },
        cancel() { cancelled++; },
      }, { highWaterMark: 0 }), { headers: { "content-type": "application/octet-stream" } });
    }
    throw new Error(`No later artifact should download after the limit: ${url}`);
  });
  await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
    onResultManifest: (files) => { manifest = structuredClone(files); },
    onGeneratedFile: () => { assert.fail("The overflowing stream must not become a complete artifact"); },
  }), (error) => {
    assertFailure("model3d_artifact_transfer_limit")(error);
    assert.equal(error.detail.requestId, REQUEST_ID);
    return true;
  });
  assert.equal(pulls, 2);
  assert.equal(cancelled, 1);
  assert.equal(manifest[0].providerMediaUrl, ARTIFACTS[0].url);
  assert.equal(calls.filter((call) => call.url.startsWith("https://v3.fal.media/")).length, 1);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("settles original terminal content rejections from immediate completion and result envelopes", async (t) => {
  const scenarios = [
    { name: "completed submission", stage: "submit", response: () => Response.json({ ...typedModelError(), status: "COMPLETED" }) },
    { name: "HTTP 422 typed result", stage: "result", response: () => Response.json(typedModelError(), { status: 422 }) },
    { name: "HTTP 422 result with header identity", stage: "result", response: () => {
      const body = typedModelError();
      delete body.request_id;
      return Response.json(body, { status: 422, headers: { "x-fal-request-id": REQUEST_ID } });
    } },
    { name: "HTTP 200 typed result", stage: "result", response: () => Response.json(typedModelError()) },
    { name: "HTTP 200 nested typed result", stage: "result", response: () => Response.json({ request_id: REQUEST_ID, data: typedModelError() }) },
    { name: "HTTP 201 nested upstream result", stage: "result", code: "fal_model3d_image_content_violation",
      response: () => Response.json({ request_id: REQUEST_ID, data: { request_id: REQUEST_ID, error: "IMAGE_CONTENT_VIOLATION", message: "The input is unavailable in this region." } }, { status: 201 }) },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async (t) => {
    const submissions = [];
    const calls = mockFetch(t, ({ url, method }) => {
      if (url === POST_URL && method === "POST") return scenario.stage === "submit"
        ? scenario.response() : Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
      if (url === RESULT_URL && method === "GET" && scenario.stage === "result") return scenario.response();
      throw new Error("A content rejection must stop before any other request: " + method + " " + url);
    });
    await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
      onProviderSubmission: (submission) => { submissions.push(structuredClone(submission)); },
      onResultManifest: () => { assert.fail("A rejected result cannot produce an artifact manifest"); },
    }), (error) => {
      assertFailure(scenario.code ?? "fal_model3d_content_policy_violation")(error);
      assert.equal(error.detail.category, "safety");
      assert.equal(error.detail.retryable, false);
      assert.equal(error.detail.requestId, REQUEST_ID);
      return true;
    });
    assert.deepEqual(calls.map((call) => call.url), scenario.stage === "submit" ? [POST_URL] : [POST_URL, RESULT_URL]);
    assert.deepEqual(submissions.map((submission) => submission.status), ["pending", "accepted", "completed"]);
    assert.equal(new Set(submissions.map((submission) => submission.clientRequestId)).size, 1);
    const checkpoint = submissionCheckpoint(submissions);
    const [completed] = Object.values(checkpoint.providerSubmissions);
    assert.equal(completed.providerRequestId, REQUEST_ID);
    assert.equal(completed.costMicrousd, 0);
    assert.equal(hasUnsettledProviderSubmission(checkpoint), false);
  });
});

test("keeps conflicting response identities unsettled before interpreting content errors or outputs", async (t) => {
  const foreign = "rodin-other-request";
  const scenarios = [
    { name: "submission header", stage: "submit", response: () => Response.json({ ...typedModelError(), status: "COMPLETED" }, { headers: { "x-fal-request-id": foreign } }) },
    { name: "completed status body", stage: "status", response: () => Response.json({ ...typedModelError("content_policy_violation", foreign), status: "COMPLETED" }) },
    { name: "completed status header", stage: "status", response: () => Response.json({ ...typedModelError(), status: "COMPLETED" }, { headers: { "x-fal-request-id": foreign } }) },
    { name: "HTTP 422 result body", stage: "result", response: () => Response.json(typedModelError("content_policy_violation", foreign), { status: 422, headers: { "x-fal-request-id": REQUEST_ID } }) },
    { name: "HTTP 422 result header", stage: "result", response: () => Response.json(typedModelError(), { status: 422, headers: { "x-fal-request-id": foreign } }) },
    { name: "HTTP 200 nested result body", stage: "result", response: () => Response.json({ request_id: REQUEST_ID, data: typedModelError("content_policy_violation", foreign) }) },
    { name: "HTTP 200 nested result header", stage: "result", response: () => Response.json({ request_id: REQUEST_ID, data: typedModelError() }, { headers: { "x-fal-request-id": foreign } }) },
    { name: "HTTP 422 outer rejection with conflicting nested ID", stage: "result", response: () => Response.json({ ...typedModelError(), data: { request_id: foreign } }, { status: 422 }) },
    { name: "HTTP 200 outer rejection with conflicting nested ID", stage: "result", response: () => Response.json({ ...typedModelError(), data: { request_id: foreign } }) },
    { name: "nested successful output with conflicting ID", stage: "result", response: () => Response.json({ request_id: REQUEST_ID, data: { ...providerResult(), request_id: foreign } }) },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async (t) => {
    const submissions = [];
    const calls = mockFetch(t, ({ url, method }) => {
      if (url === POST_URL && method === "POST") return scenario.stage === "submit"
        ? scenario.response() : Response.json({ request_id: REQUEST_ID, status: scenario.stage === "status" ? "IN_QUEUE" : "COMPLETED" });
      if (url === STATUS_URL && scenario.stage === "status" || url === RESULT_URL && scenario.stage === "result") return scenario.response();
      throw new Error("Conflicting identity must stop further requests: " + method + " " + url);
    });
    await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
      pollIntervalMs: 0,
      onProviderSubmission: (submission) => { submissions.push(structuredClone(submission)); },
      onResultManifest: () => { assert.fail("An unrelated response cannot produce an artifact manifest"); },
    }), (error) => {
      assertFailure("model3d_response_identity_mismatch")(error);
      assert.equal(error.detail.requestId, REQUEST_ID);
      return true;
    });
    assert.deepEqual(calls.map((call) => call.url), scenario.stage === "submit" ? [POST_URL]
      : [POST_URL, scenario.stage === "status" ? STATUS_URL : RESULT_URL]);
    assert.deepEqual(submissions.map((submission) => submission.status), ["pending", "accepted"]);
    const checkpoint = submissionCheckpoint(submissions);
    const [accepted] = Object.values(checkpoint.providerSubmissions);
    assert.equal(accepted.providerRequestId, REQUEST_ID);
    assert.equal(accepted.costMicrousd, undefined);
    assert.equal(hasUnsettledProviderSubmission(checkpoint), true);
  });
});

test("keeps nonterminal, transport, and unclassified result failures unsettled", async (t) => {
  const scenarios = [
    { name: "queued submission content error", stage: "submit", code: "fal_model3d_content_policy_violation",
      response: () => Response.json({ ...typedModelError(), status: "IN_QUEUE" }) },
    { name: "in-progress status content error", stage: "status", code: "fal_model3d_content_policy_violation",
      response: () => Response.json({ ...typedModelError(), status: "IN_PROGRESS" }) },
    { name: "failed status transport", stage: "status", code: "provider_network_failed",
      response: () => { throw new TypeError("Poll connection ended"); } },
    { name: "status server failure", stage: "status", code: "fal_model3d_runner_server_error",
      response: () => Response.json({ request_id: REQUEST_ID, error_type: "runner_server_error", detail: "The runner failed." }, { status: 503 }) },
    { name: "result server failure carrying a content code", stage: "result", code: "fal_model3d_content_policy_violation",
      response: () => Response.json(typedModelError(), { status: 503 }) },
    { name: "result validation error without a content code", stage: "result", code: "fal_model3d_enum",
      response: () => Response.json(typedModelError("enum"), { status: 422 }) },
    { name: "result without generated media", stage: "result", code: "fal_model3d_no_media_generated",
      response: () => Response.json(typedModelError("no_media_generated")) },
    { name: "incomplete result", stage: "result", code: "model3d_result_incomplete",
      response: () => Response.json({ request_id: REQUEST_ID }) },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async (t) => {
    const submissions = [];
    const calls = mockFetch(t, ({ url, method }) => {
      if (url === POST_URL && method === "POST") return scenario.stage === "submit"
        ? scenario.response() : Response.json({ request_id: REQUEST_ID, status: scenario.stage === "status" ? "IN_QUEUE" : "COMPLETED" });
      if (url === STATUS_URL && scenario.stage === "status" || url === RESULT_URL && scenario.stage === "result") return scenario.response();
      throw new Error("The adapter must not resubmit or download after this failure: " + method + " " + url);
    });
    await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
      pollIntervalMs: 0,
      onProviderSubmission: (submission) => { submissions.push(structuredClone(submission)); },
    }), (error) => {
      assertFailure(scenario.code)(error);
      assert.equal(error.detail.requestId, REQUEST_ID);
      return true;
    });
    assert.deepEqual(calls.map((call) => call.url), scenario.stage === "submit" ? [POST_URL]
      : [POST_URL, scenario.stage === "status" ? STATUS_URL : RESULT_URL]);
    assert.deepEqual(submissions.map((submission) => submission.status), ["pending", "accepted"]);
    const checkpoint = submissionCheckpoint(submissions);
    assert.equal(Object.values(checkpoint.providerSubmissions)[0].costMicrousd, undefined);
    assert.equal(hasUnsettledProviderSubmission(checkpoint), true);
  });
});

test("never replaces an already billed completion with zero during original-request recovery", async (t) => {
  const submissions = [], resumedSubmissions = [];
  let recovery = false;
  const calls = mockFetch(t, ({ url, method }) => {
    if (recovery) assert.equal(method, "GET", "Recovery cannot buy another request");
    if (!recovery && url === POST_URL && method === "POST") return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
    if (url === STATUS_URL) return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
    if (url === RESULT_URL) return recovery
      ? Response.json(typedModelError(), { status: 422 }) : Response.json(providerResult());
    if (!recovery) {
      const file = downloadResponse(url);
      if (file) return file;
    }
    throw new Error("Unexpected request during retained paid-result recovery: " + method + " " + url);
  });
  const initial = await generateFalModel3d(ENV, PROMPT, {
    onProviderSubmission: (submission) => { submissions.push(structuredClone(submission)); },
  });
  const completed = structuredClone(submissions.at(-1));
  assert.equal(completed.costMicrousd, 400_000);
  const beforeRecovery = calls.length;
  recovery = true;
  await assert.rejects(() => generateFalModel3d(ENV, "This new text must not be submitted.", {
    retainedReceipt: initial.preparedReceipt, retainedSubmission: completed, pollIntervalMs: 0,
    onProviderSubmission: (submission) => { resumedSubmissions.push(structuredClone(submission)); },
    onBeforeProviderAttempt: () => { assert.fail("Recovery cannot start a new paid attempt"); },
  }), assertFailure("fal_model3d_content_policy_violation"));
  assert.deepEqual(calls.slice(beforeRecovery).map((call) => call.url), [STATUS_URL, RESULT_URL]);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.deepEqual(resumedSubmissions, []);
  const checkpoint = submissionCheckpoint([...submissions, ...resumedSubmissions]);
  assert.deepEqual(Object.values(checkpoint.providerSubmissions), [completed]);
  assert.equal(hasUnsettledProviderSubmission(checkpoint), false);
});

test("keeps the successful generation billed when its artifact download returns a content-error body", async (t) => {
  const submissions = [];
  let manifest;
  const calls = mockFetch(t, ({ url, method }) => {
    if (url === POST_URL && method === "POST") return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
    if (url === RESULT_URL) return Response.json(providerResult());
    if (url === ARTIFACTS[0].url) return Response.json(typedModelError(), { status: 422 });
    throw new Error("No later artifact should be downloaded after this failure: " + method + " " + url);
  });
  await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
    onProviderSubmission: (submission) => { submissions.push(structuredClone(submission)); },
    onResultManifest: (files) => { manifest = structuredClone(files); },
  }), (error) => {
    assertFailure("model3d_download_failed")(error);
    assert.equal(error.detail.httpStatus, 422);
    assert.equal(error.detail.requestId, REQUEST_ID);
    return true;
  });
  assert.equal(manifest.length, ARTIFACTS.length);
  assert.deepEqual(calls.map((call) => call.url), [POST_URL, RESULT_URL, ARTIFACTS[0].url]);
  assert.deepEqual(submissions.map((submission) => submission.status), ["pending", "accepted", "completed"]);
  const checkpoint = submissionCheckpoint(submissions);
  assert.equal(Object.values(checkpoint.providerSubmissions)[0].costMicrousd, 400_000);
  assert.equal(hasUnsettledProviderSubmission(checkpoint), false);
});

test("downloads every artifact from the documented Google Storage bucket without credentials", async (t) => {
  const urls = ARTIFACTS.map((artifact) => "https://storage.googleapis.com/falserverless/rodin-tests/" + artifact.name + "?generation=42");
  const body = providerResult();
  [body.model_mesh, ...body.model_meshes, ...body.textures].forEach((file, index) => { file.url = urls[index]; });
  let manifest;
  const calls = mockFetch(t, ({ url, method, init }) => {
    if (url === POST_URL && method === "POST") return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
    if (url === RESULT_URL) return Response.json(body);
    const index = urls.indexOf(url);
    if (index >= 0) {
      assert.equal(method, "GET");
      assert.equal(new Headers(init.headers).get("authorization"), null);
      assert.equal(init.redirect, "manual");
      return new Response(new Uint8Array(ARTIFACTS[index].bytes), { headers: { "content-type": "application/octet-stream" } });
    }
    throw new Error("Unexpected Google Storage request: " + method + " " + url);
  });
  const result = await generateFalModel3d(ENV, PROMPT, {
    onResultManifest: (files) => { manifest = structuredClone(files); },
  });
  assert.deepEqual(calls.map((call) => call.url), [POST_URL, RESULT_URL, ...urls]);
  assert.deepEqual(manifest.map((file) => file.providerMediaUrl), urls);
  assert.deepEqual(resultFiles(result).map((file) => file.providerMediaUrl), urls);
  for (const [index, file] of resultFiles(result).entries()) {
    assert.deepEqual(file.bytes, ARTIFACTS[index].bytes);
    assert.equal(file.sha256, digest(ARTIFACTS[index].bytes));
  }
});

test("rejects artifact URLs outside the exact Google Storage bucket and URL trust boundary", async (t) => {
  const urls = [
    "https://storage.googleapis.com/other-bucket/chair.glb",
    "https://storage.googleapis.com/falserverless-other/chair.glb",
    "https://storage.googleapis.com.evil.example/falserverless/chair.glb",
    "https://user:password@storage.googleapis.com/falserverless/chair.glb",
    "https://storage.googleapis.com:8443/falserverless/chair.glb",
    "http://storage.googleapis.com/falserverless/chair.glb",
    "https://storage.googleapis.com/falserverless/chair.glb#fragment",
    "https://storage.googleapis.com/falserverless/../other-bucket/chair.glb",
  ];
  for (const candidate of urls) await t.test(candidate, async (t) => {
    const submissions = [];
    const calls = mockFetch(t, ({ url, method }) => {
      if (url === POST_URL && method === "POST") return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
      if (url === RESULT_URL) {
        const body = providerResult();
        body.model_mesh.url = candidate;
        return Response.json(body);
      }
      throw new Error("An untrusted artifact URL must never be fetched: " + method + " " + url);
    });
    await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
      onProviderSubmission: (submission) => { submissions.push(structuredClone(submission)); },
    }), assertFailure("model3d_media_url_untrusted"));
    assert.deepEqual(calls.map((call) => call.url), [POST_URL, RESULT_URL]);
    const checkpoint = submissionCheckpoint(submissions);
    assert.equal(Object.values(checkpoint.providerSubmissions)[0].costMicrousd, 400_000);
    assert.equal(hasUnsettledProviderSubmission(checkpoint), false);
  });
});

test("does not follow a Google Storage artifact redirect even within the allowed bucket", async (t) => {
  const source = "https://storage.googleapis.com/falserverless/rodin-tests/chair.glb";
  const destination = "https://storage.googleapis.com/falserverless/rodin-tests/redirected.glb";
  const submissions = [];
  const calls = mockFetch(t, ({ url, method }) => {
    if (url === POST_URL && method === "POST") return Response.json({ request_id: REQUEST_ID, status: "COMPLETED" });
    if (url === RESULT_URL) {
      const body = providerResult();
      body.model_mesh.url = source;
      return Response.json(body);
    }
    if (url === source) return new Response(null, { status: 302, headers: { location: destination } });
    throw new Error("Redirect destinations must not be fetched: " + method + " " + url);
  });
  await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
    onProviderSubmission: (submission) => { submissions.push(structuredClone(submission)); },
  }), (error) => {
    assertFailure("model3d_download_failed")(error);
    assert.equal(error.detail.httpStatus, 302);
    return true;
  });
  assert.deepEqual(calls.map((call) => call.url), [POST_URL, RESULT_URL, source]);
  const download = calls.at(-1);
  assert.equal(download.init.redirect, "manual");
  assert.equal(new Headers(download.init.headers).get("authorization"), null);
  const checkpoint = submissionCheckpoint(submissions);
  assert.equal(Object.values(checkpoint.providerSubmissions)[0].costMicrousd, 400_000);
  assert.equal(hasUnsettledProviderSubmission(checkpoint), false);
});

test("keeps the artifact-only Google Storage exception out of reference uploads", async (t) => {
  const storageUrl = "https://storage.googleapis.com/falserverless/rodin-tests/reference.png";
  const uploadUrl = "https://v3.fal.media/upload/reference";
  const imageUrl = "https://v3.fal.media/references/reference.png";
  for (const field of ["upload_url", "file_url"]) await t.test(field, async (t) => {
    const submissions = [];
    const calls = mockFetch(t, async ({ url, method, init }) => {
      const parsed = new URL(url);
      if (["rest.fal.ai", "rest.alpha.fal.ai"].includes(parsed.hostname) && parsed.pathname === "/storage/upload/initiate" && method === "POST") {
        assert.equal(new Headers(init.headers).get("authorization"), "Key fal-test-only");
        return Response.json({ upload_url: uploadUrl, file_url: imageUrl, [field]: storageUrl });
      }
      if (url === uploadUrl && method === "PUT" && field === "file_url") {
        assert.equal(new Headers(init.headers).get("authorization"), null);
        assert.deepEqual(new Uint8Array(await init.body.arrayBuffer()), ARTIFACTS[2].bytes);
        return new Response("");
      }
      throw new Error("The Google Storage exception must not authorize a source upload: " + method + " " + url);
    });
    await assert.rejects(() => generateFalModel3d(ENV, PROMPT, {
      references: [{ bytes: ARTIFACTS[2].bytes, mimeType: "image/png" }],
      onProviderSubmission: (submission) => { submissions.push(structuredClone(submission)); },
      onBeforeProviderAttempt: () => { assert.fail("An untrusted reference cannot reach paid admission"); },
    }), assertFailure(field === "upload_url" ? "model3d_upload_url_untrusted" : "model3d_media_url_untrusted"));
    assert.equal(calls.length, field === "upload_url" ? 1 : 2);
    assert.equal(calls.some((call) => call.url.startsWith("https://storage.googleapis.com/")), false);
    assert.equal(calls.some((call) => call.url.startsWith("https://queue.fal.run/")), false);
    assert.deepEqual(submissions, []);
  });
});

test("honors current and legacy retry-denial headers without retrying safety or validation failures", () => {
  const cases = [
    { name: "server denial", status: 503, headers: { "x-fal-needs-retry": "0" }, retryable: false },
    { name: "server retry", status: 503, headers: { "x-fal-needs-retry": "1" }, retryable: true },
    { name: "rate-limit denial", status: 429, headers: { "x-fal-needs-retry": "0" }, retryable: false },
    { name: "rate-limit retry", status: 429, headers: { "x-fal-needs-retry": "1" }, retryable: true },
    { name: "legacy denial", status: 503, headers: { "x-fal-retryable": "false" }, retryable: false },
    { name: "legacy denial alongside current retry", status: 503, headers: { "x-fal-needs-retry": "1", "x-fal-retryable": "false" }, retryable: false },
    { name: "status fallback", status: 503, headers: {}, retryable: true },
    { name: "safety cannot be made retryable", status: 422, headers: { "x-fal-needs-retry": "1" }, body: typedModelError(), retryable: false },
    { name: "validation cannot be made retryable", status: 422, headers: { "x-fal-needs-retry": "1" }, body: typedModelError("enum"), retryable: false },
  ];
  for (const scenario of cases) {
    const response = new Response(null, { status: scenario.status, headers: { "retry-after": "7", "x-fal-request-id": REQUEST_ID, ...scenario.headers } });
    const error = falModel3dError(response, scenario.body ?? { error_type: "runner_server_error", detail: "The runner could not finish." }, PROMPT, REQUEST_ID);
    assert.ok(error instanceof ProviderRequestError, scenario.name);
    assert.equal(error.detail.retryable, scenario.retryable, scenario.name);
    assert.equal(error.detail.retryAfterMs, scenario.retryable ? 7000 : null, scenario.name);
    assert.equal(error.detail.requestId, REQUEST_ID, scenario.name);
    assert.equal(error.preparedPrompt, PROMPT, scenario.name);
  }
});
