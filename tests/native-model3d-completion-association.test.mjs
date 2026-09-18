import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { modelBytes } from "./model3d-native/assets.mjs";
import { handleNativeRetainedOutputRead } from "../worker/retained-story-api.ts";
import { nativeModel3dCompletionPath, validateNativeModel3dCompletion, nativeModel3dRetainedRoute } from "../src/model/native-model3d-completion.ts";
import { nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute } from "../src/model/native-retained-output.ts";
import { DEFAULT_MODEL3D_SETTINGS, RODIN_TEXT_MODEL, RODIN_ADAPTER_VERSION } from "../src/model/model3d.ts";
import { model3dAdaptationReceipt } from "../src/model/model3d-prompt-adapter.ts";
import { documentGenerationRevision } from "../src/model/document-jobs.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";

// Actual Store Save/admission and Worker execution in the existing RAM fixture.
// All Rodin replies and the GLB are intercepted local values; the GLB is the
// previously authored cube, not evidence that a provider produced this prompt.
// No browser action, mesh editing, provider quality or live authorization claim.
test("actual document-adapted Model3D Save/Create binds its current attempt, original input and owned GLB to the native reader", { timeout: 30_000 }, async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No external request during fixture initialization"));
  const worker = await createSceneCostFixture(1, "visual");
  worker.env.FAL_KEY = "in-memory-model3d-test";
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  h.store.patchUi({ instrumentation: false });
  assert.equal(h.store.session.get().provider.model3dConfigured, true, "Actual local session observes only the fake fixture binding");
  const providerJobId = "native-model3d-provider-job", submissionUrl = "https://queue.fal.run/" + RODIN_TEXT_MODEL;
  const resultUrl = "https://queue.fal.run/fal-ai/hyper3d/requests/" + providerJobId;
  const statusUrl = resultUrl + "/status?logs=1", mediaUrl = "https://fal.media/native-model.glb";
  const fixtureBytes = modelBytes(), digest = value => createHash("sha256").update(value).digest("hex"), fixtureSha256 = digest(fixtureBytes);
  const calls = [], forbidden = [], pending = new Set(), stored = new Map();
  worker.env.MEDIA = {
    async put(key, value, options) {
      if (stored.has(key)) forbidden.push("duplicate MEDIA.put:" + key);
      assert.equal(stored.has(key), false, "No replacement media write");
      stored.set(key, { bytes: new Uint8Array(value), options });
    },
    async get() { forbidden.push("MEDIA.get"); assert.fail("The association test has no reference or playback reads"); },
  };
  h.transport = async request => {
    const task = worker.request(request.url, request.init); pending.add(task);
    try { return await task; } finally { pending.delete(task); }
  };
  let reviewedPrompt;
  const settings = { ...structuredClone(DEFAULT_MODEL3D_SETTINGS), seed: 7 };
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = String(url);
    if (path.startsWith("/api/")) return h.fetch(url, init);
    if (![submissionUrl, statusUrl, resultUrl, mediaUrl].includes(path)) {
      forbidden.push(path); throw new Error("No external request is permitted");
    }
    if (calls.some(row => row.path === path)) forbidden.push("duplicate fetch:" + path);
    assert.equal(calls.some(row => row.path === path), false, "No repeated Rodin or media request");
    const request = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, request });
    assert.equal(init.method ?? "GET", path === submissionUrl ? "POST" : "GET");
    assert.equal(init.redirect, "manual");
    const headers = new Headers(init.headers);
    if (path !== mediaUrl) {
      assert.equal(headers.get("authorization"), "Key in-memory-model3d-test");
      assert.equal(headers.get("content-type"), "application/json");
      assert.equal(headers.get("x-fal-store-io"), "0");
    }
    if (path === submissionUrl) {
      assert.equal(typeof reviewedPrompt, "string"); assert.ok(reviewedPrompt.length > 0);
      assert.deepEqual(request, { prompt: reviewedPrompt, tier: "Gen-2.5-High", geometry_file_format: "glb", material: "All", quality_mesh_option: "Auto",
        enable_creative_mode: false, hd_texture: false, texture_delight: false, is_micro: false, TAPose: false, addons: { high_pack: false }, seed: 7 });
      return Response.json({ request_id: providerJobId, status: "IN_QUEUE" }, { status: 202 });
    }
    if (path === statusUrl) return Response.json({ request_id: providerJobId, status: "COMPLETED" });
    if (path === resultUrl) return Response.json({ request_id: providerJobId, seed: 7, textures: [],
      model_mesh: { url: mediaUrl, file_name: "native-model.glb", content_type: "model/gltf-binary", file_size: fixtureBytes.length } });
    assert.equal(headers.has("authorization"), false);
    return new Response(fixtureBytes, { headers: { "content-type": "model/gltf-binary", "content-length": String(fixtureBytes.length) } });
  });
  t.after(async () => {
    while (pending.size) await Promise.allSettled([...pending]);
    await worker.drainBackground(); await h.close(); assert.deepEqual(forbidden, []);
  });

  const savedText = "A jade green cube with softly rounded edges and a matte ceramic surface. 雨 — preserve the authored color and shape.";
  const saved = await h.store.saveBlockText("scene-reuse-direction", savedText, "output-context-editor");
  assert.equal(saved.length, 1); const savedEvent = saved[0];
  assert.equal(savedEvent.type, "BlockPropertyEdited"); assert.equal(savedEvent.payload.property_path, "text");
  assert.equal(savedEvent.payload.new_value, savedText);
  assert.equal(h.requests.filter(request => request.url === "/api/document-jobs").length, 0, "Save never starts generation");
  assert.equal(calls.length, 0);
  const adaptation = h.store.documentModel3dAdaptation(worker.documentId, 0);
  assert.equal(adaptation.valid, true, JSON.stringify(adaptation.issues));
  reviewedPrompt = adaptation.prompt;
  assert.ok(reviewedPrompt.includes(savedText));
  const reviewedAdaptation = model3dAdaptationReceipt(adaptation);
  assert.ok(reviewedAdaptation.includedBlockIds.includes("scene-reuse-direction"));
  const preCreateHead = worker.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(worker.streamId).head;
  assert.equal(await h.store.renderDocumentArtifact("model3d", { documentId: worker.documentId,
    model3dPrompt: reviewedPrompt, model3dPromptSource: "document", model3dAdaptation: reviewedAdaptation,
    model3dSettings: settings, model3dReferenceBlockIds: [], paidMediaConfirmed: true, locale: "en-US" }), true);
  const admissions = h.requests.filter(request => request.url === "/api/document-jobs" && request.body?.payload?.artifactKind === "model3d");
  assert.equal(admissions.length, 1); assert.equal(calls.length, 0, "Admission makes no provider request");
  const request = admissions[0].body, payload = request.payload;
  assert.equal(request.documentId, worker.documentId); assert.equal(request.sourceSurface, "document");
  assert.equal(payload.productionMode, "manual"); assert.equal(payload.paidMediaConfirmed, true);
  assert.equal(payload.itemCount, 1); assert.equal(payload.locale, "en-US");
  assert.equal(payload.model3dPrompt, reviewedPrompt); assert.equal(payload.model3dPromptSource, "document");
  assert.deepEqual(payload.model3dAdaptation, reviewedAdaptation); assert.deepEqual(payload.model3dSettings, settings);
  assert.deepEqual(payload.model3dReferenceBlockIds, []);
  const originalSettings = { model3dPrompt: reviewedPrompt, model3dSettings: settings, model3dReferenceBlockIds: [],
    model3dPromptSource: "document", model3dAdaptation: reviewedAdaptation };
  assert.equal(payload.requestKey, `render:model3d:${payload.documentRevision}:${documentGenerationRevision(originalSettings)}`);
  const savedBlock = h.store.projection.get().libraryBlocks.find(block => block.id === "scene-reuse-direction");
  assert.ok(savedBlock.sourceEvents.includes(savedEvent.eventId));
  const sourceVersion = { block_id: savedBlock.id, version: savedBlock.sourceEvents.length };
  assert.deepEqual(payload.sourceBlockVersions.find(row => row.block_id === savedBlock.id), sourceVersion);
  assert.ok(payload.snapshot.facts.find(row => row.block_id === savedBlock.id).source_event_refs.includes(savedEvent.eventId));
  assert.ok(JSON.stringify(payload.snapshot).includes(savedText));
  for (const field of ["workflowId", "workflowStageId", "workflowSources", "outputExecution", "sceneRequestId", "sceneCostConsent", "sceneMedium",
    "requestedSlideCount", "slideCountPolicy", "audioProfile", "audioProviderModel", "videoSeconds", "videoSize", "videoAudioMode", "soundtrackBlockIds"]) assert.equal(payload[field], undefined, field);
  const queued = worker.sqlite.prepare("SELECT * FROM document_jobs WHERE document_id=? AND json_extract(request_json,'$.artifactKind')='model3d'").all(worker.documentId);
  assert.equal(queued.length, 1); assert.equal(queued[0].status, "queued"); assert.equal(queued[0].attempt_count, 0);
  assert.equal(queued[0].requested_sequence, preCreateHead); assert.equal(queued[0].correlation_id, queued[0].job_id);
  const originalPayload = JSON.parse(queued[0].request_json);
  assert.deepEqual(originalPayload.snapshot, payload.snapshot); assert.deepEqual(originalPayload.sourceBlockVersions, payload.sourceBlockVersions);
  assert.equal(originalPayload.requestKey, payload.requestKey); assert.equal(originalPayload.documentRevision, payload.documentRevision);
  for (const [key, value] of Object.entries(originalSettings)) assert.deepEqual(originalPayload[key], value, key);
  const handle = { documentId: worker.documentId, jobId: queued[0].job_id }, run = await worker.run(handle.jobId);
  assert.equal(run.response.status, 200);
  const job = worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(handle.jobId);
  t.diagnostic("LOCAL_MODEL3D_EXECUTION " + JSON.stringify({ status: job.status, calls: calls.map(row => row.path), storedFiles: stored.size }));
  assert.equal(job.status, "completed", JSON.stringify(run.body)); assert.equal(job.attempt_count, 1);
  assert.equal(job.correlation_id, `${handle.jobId}:attempt:1`); assert.equal(job.requested_sequence, preCreateHead);
  assert.equal(job.request_json, queued[0].request_json); assert.equal(job.owner_id, worker.owner);
  assert.deepEqual(calls.map(row => row.path), [submissionUrl, statusUrl, resultUrl, mediaUrl]);
  assert.equal(stored.size, 1);

  const result = JSON.parse(job.result_json), completions = worker.sqlite.prepare("SELECT * FROM events WHERE stream_id=? AND correlation_id=? AND type='DocumentRenderCompleted'").all(job.stream_id, job.correlation_id);
  assert.equal(completions.length, 1); const completion = completions[0], publicPayload = JSON.parse(completion.payload);
  assert.equal(completion.actor, "worker:renderer"); assert.equal(completion.client_id, "server:document-job:render_document");
  assert.ok(result.appendedEventIds.includes(completion.event_id)); assert.equal(publicPayload.artifact_id, result.artifactId);
  assert.equal(result.providerJobId, providerJobId); assert.equal(result.provider, "fal");
  assert.equal(publicPayload.item_count, 0); assert.equal(publicPayload.items, undefined);
  const secret = worker.sqlite.prepare("SELECT * FROM event_private_payloads WHERE private_event_id=?").get(completion.event_id);
  const full = JSON.parse(secret.private_json);
  assert.equal(secret.owner_id, worker.owner); assert.equal(full.requested_by_user_id, worker.owner);
  assert.equal(full.input_ref, publicPayload.input_ref); assert.equal(full.artifact_id, result.artifactId);
  assert.deepEqual(full.source_block_versions, payload.sourceBlockVersions);
  assert.deepEqual([full.provider, full.provider_job_id, full.model_id], ["fal", providerJobId, RODIN_TEXT_MODEL]);
  assert.deepEqual(full.items, []); assert.equal(full.item_count, 0, "A mesh completion has no authored plan items");
  assert.equal(full.source_surface, "document"); assert.equal(full.planner_model_id, null); assert.equal(full.planner_response_id, null);
  assert.deepEqual(full.settings.model3d, settings); assert.deepEqual(full.settings.model3d_settings, settings);
  assert.equal(full.settings.adapter_version, RODIN_ADAPTER_VERSION); assert.equal(full.settings.seed, 7);
  assert.equal(full.settings.source_media_sha256, fixtureSha256);
  assert.deepEqual(full.settings.model3d_files, [{ url: full.media_url, mimeType: "model/gltf-binary", fileName: "native-model.glb",
    fileSize: fixtureBytes.length, format: "glb", role: "mesh", sha256: fixtureSha256, previewSupported: true }]);
  assert.equal(full.media_type, "model/gltf-binary");
  const mediaKey = decodeURIComponent(full.media_url.slice("/api/media/".length));
  assert.ok(mediaKey.startsWith(ownerMediaNamespace(worker.owner) + "/generated/"));
  assert.ok(stored.has(mediaKey)); const storedMedia = stored.get(mediaKey), metadata = storedMedia.options.customMetadata;
  assert.deepEqual(storedMedia.bytes, fixtureBytes); assert.equal(storedMedia.options.httpMetadata.contentType, "model/gltf-binary");
  assert.deepEqual([metadata.ownerId, metadata.artifactId, metadata.documentId, metadata.projectId, metadata.actorUserId],
    [worker.owner, result.artifactId, worker.documentId, worker.projectId, worker.owner]);
  assert.deepEqual([metadata.provider, metadata.providerJobId, metadata.providerRequestId, metadata.providerModel, metadata.providerMediaUrl],
    ["fal", providerJobId, providerJobId, RODIN_TEXT_MODEL, mediaUrl]);
  assert.deepEqual([metadata.sha256, metadata.fileName, metadata.fileSize, metadata.format, metadata.modelFormat, metadata.modelPreviewSafe],
    [fixtureSha256, "native-model.glb", String(fixtureBytes.length), "glb", "glb", "true"]);
  const rawRow = worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(publicPayload.content_ref);
  assert.equal(rawRow.owner_id, worker.owner); assert.equal(rawRow.kind, "document-artifact");
  const raw = rawRow.content, body = JSON.parse(raw), sha256 = digest(raw);
  assert.deepEqual(body, { title: h.store.projection.get().documentTitle + " · 3D model", summary: reviewedPrompt,
    content_markdown: reviewedPrompt, presentation: null, items: [] });

  const inputRow = worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(full.input_ref), input = JSON.parse(inputRow.content);
  assert.equal(inputRow.owner_id, worker.owner); assert.equal(inputRow.kind, "document-artifact-input");
  assert.notEqual(full.input_ref, result.generationReceipt.input_ref, "Generated input and admission receipt are distinct actual rows");
  assert.deepEqual([input.schema_version, input.artifact_kind, input.artifact_id, input.document_id, input.project_id], [1, "model3d", result.artifactId, worker.documentId, worker.projectId]);
  assert.deepEqual(input.source_block_versions, payload.sourceBlockVersions); assert.deepEqual(input.document_snapshot, payload.snapshot);
  assert.equal(input.planner, null);
  assert.deepEqual(input.request.model3d_settings, settings); assert.deepEqual(input.request.model3d_reference_block_ids, []);
  assert.equal(input.request.model3d_prompt, reviewedPrompt); assert.equal(input.request.model3d_prompt_source, "document");
  assert.deepEqual(input.request.model3d_adaptation, reviewedAdaptation); assert.equal(input.request.source_surface, "document");
  assert.equal(input.request.item_count, undefined); assert.equal(input.request.production_mode, undefined);
  assert.deepEqual([input.render.provider, input.render.providerJobId, input.render.model], [result.provider, result.providerJobId, full.model_id]);
  assert.equal(input.render.submittedPrompt, reviewedPrompt); assert.equal(input.render.submitted_prompt, reviewedPrompt);
  assert.deepEqual(input.render.settings, settings); assert.equal(input.render.adapterVersion, RODIN_ADAPTER_VERSION);
  assert.deepEqual(input.render.parameters, calls[0].request); assert.deepEqual(input.render.acceptedFields, Object.keys(calls[0].request));
  assert.deepEqual(input.render.referenceInputs, []); assert.deepEqual(input.render.reference_inputs, []);
  assert.equal(input.render.usedReferencePixels, false); assert.equal(input.render.used_reference_pixels, false);
  assert.equal(input.render.seed, 7); assert.match(input.render.requestDigest, /^[a-f0-9]{64}$/u);

  const user = h.store.session.get().user, reads = [], httpBeforeRead = h.requests.length;
  const env = { ...worker.env, DB: { prepare(sql) {
    if (!/^\s*(?:WITH|SELECT)\b/iu.test(sql)) { forbidden.push("reader.prepare:" + sql); assert.fail("The reader prepared a write"); }
    reads.push(sql); return worker.env.DB.prepare(sql);
  }, batch() { forbidden.push("reader.batch"); assert.fail("Completion and retained endpoints are read-only"); } } };
  const headers = { "oai-authenticated-user-id": user.userId, "oai-authenticated-user-email": user.email };
  const changes = () => worker.sqlite.prepare("SELECT total_changes() AS count").get().count;
  const readCompletion = () => handleNativeRetainedOutputRead(new Request("http://localhost" + nativeModel3dCompletionPath(handle), { headers }), env);
  const before = changes(), response = await readCompletion(), receipt = await response.json();
  t.diagnostic("ACTUAL_NATIVE_MODEL3D_ASSOCIATION " + JSON.stringify({ handle, savedEventId: savedEvent.eventId,
    savedSequence: savedEvent.sequence, requestedSequence: job.requested_sequence, documentRevision: payload.documentRevision,
    requestKey: payload.requestKey, status: job.status, attemptCount: job.attempt_count, correlationId: job.correlation_id,
    completionEventId: completion.event_id, artifactId: result.artifactId, inputRef: full.input_ref,
    admissionInputRef: result.generationReceipt.input_ref, rawContentSha256: sha256, sourceBlockVersions: full.source_block_versions,
    providerJobId: result.providerJobId, ownedMediaPath: full.media_url, mockedMediaBytes: fixtureBytes.length,
    mockedMediaSha256: fixtureSha256, requestedItemCount: payload.itemCount, completedItemCount: full.item_count,
    mockedPlannerCalls: 0, mockedRodinCalls: 3, mockedMediaCalls: 1, responseStatus: response.status, receipt }));
  assert.equal(response.status, 200, JSON.stringify(receipt));
  assert.deepEqual(validateNativeModel3dCompletion(receipt, handle), receipt);
  assert.deepEqual(receipt.selection, { documentId: worker.documentId, artifactId: result.artifactId, revision: 0, contentSha256: sha256 });
  assert.equal(reads.length, 7, "One bounded generated-input read joins the completion read path");
  const target = parseNativeRetainedOutputRoute(nativeModel3dRetainedRoute(receipt, handle));
  assert.deepEqual(target, { output: "model3d", selection: receipt.selection });
  const retained = await handleNativeRetainedOutputRead(new Request("http://localhost" + nativeRetainedOutputRequestPath(target), { headers }), env);
  assert.equal(retained.status, 200); const dto = await retained.json();
  assert.deepEqual(dto.content, { files: full.settings.model3d_files, availability: "mesh-reference" });
  assert.equal(changes(), before); assert.equal(calls.length, 4); assert.equal(stored.size, 1);

  // Only this test's RAM rows are changed after the actual producer completes.
  // Restore each original before the next check; no job/completion seed is used.
  for (const fault of ["previous-attempt", "selected-input-source", "selected-input-provider", "selected-input-final-bytes"]) await t.test(fault, async () => {
    let finalWitnesses = 0, afterMutation;
    try {
      if (fault === "previous-attempt") worker.sqlite.prepare("UPDATE document_jobs SET attempt_count=2,correlation_id=? WHERE job_id=?").run(`${handle.jobId}:attempt:2`, handle.jobId);
      if (fault === "selected-input-source" || fault === "selected-input-provider") {
        const changed = structuredClone(input);
        if (fault === "selected-input-source") changed.document_snapshot.facts[0].properties.text = "An unrelated later shape.";
        else changed.render.providerJobId = "a-different-provider-job";
        worker.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(changed), full.input_ref);
      }
      if (fault === "selected-input-final-bytes") worker.controls.beforeRead = statement => {
        if (!statement.sql.includes("expected_events AS")) return;
        finalWitnesses++;
        worker.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(inputRow.content + " ", full.input_ref);
        afterMutation = changes();
      };
      const boundary = changes(), rejected = await readCompletion();
      assert.equal(rejected.status, 404, fault);
      assert.equal(changes(), afterMutation ?? boundary, "No reader-side mutation");
      assert.equal(finalWitnesses, fault === "selected-input-final-bytes" ? 1 : 0);
    } finally {
      worker.controls.beforeRead = null;
      worker.sqlite.prepare("UPDATE document_jobs SET attempt_count=?,correlation_id=? WHERE job_id=?").run(job.attempt_count, job.correlation_id, handle.jobId);
      worker.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(inputRow.content, full.input_ref);
    }
    assert.equal(calls.length, 4); assert.equal(stored.size, 1);
  });
  assert.equal(h.requests.length, httpBeforeRead, "Read endpoints issue no application requests");
  assert.deepEqual(forbidden, []);
});
