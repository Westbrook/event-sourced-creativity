import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { mp4 } from "./output-asset-fixtures.mjs";
import { handleNativeRetainedOutputRead } from "../worker/retained-story-api.ts";
import { nativeVideoCompletionPath, validateNativeVideoCompletion, nativeVideoRetainedRoute } from "../src/model/native-video-completion.ts";
import { nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute } from "../src/model/native-retained-output.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";

// Actual Store Save/admission and Worker execution in the existing RAM fixture.
// Every planner, Fal and media response is intercepted locally. The retained MP4
// is an authored one-second test asset, not proof of generated four-second video,
// provider quality, browser Create, playback, media editing or live access.
test("actual manual Video Save/Create binds its current attempt, original input and root file to the native reader", { timeout: 30_000 }, async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No external request during fixture initialization"));
  const worker = await createSceneCostFixture(1, "visual");
  worker.env.FAL_KEY = "in-memory-video-test";
  worker.env.FORMA_VIDEO_PROVIDER = "fal";
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  h.store.patchUi({ instrumentation: false });
  const model = "bytedance/seedance-2.0/reference-to-video", providerJobId = "native-video-provider-job";
  const plannerUrl = "https://api.openai.com/v1/responses", submissionUrl = "https://queue.fal.run/" + model;
  const resultUrl = "https://queue.fal.run/bytedance/seedance-2.0/requests/" + providerJobId;
  const statusUrl = resultUrl + "/status?logs=1", mediaUrl = "https://fal.media/native-video-fixture.mp4";
  const fixtureBytes = mp4(), digest = value => createHash("sha256").update(value).digest("hex");
  const calls = [], forbidden = [], pending = new Set(), stored = new Map();
  worker.env.MEDIA = {
    async put(key, value, options) {
      if (stored.has(key)) forbidden.push("duplicate MEDIA.put:" + key);
      assert.equal(stored.has(key), false, "No replacement media write");
      stored.set(key, { bytes: new Uint8Array(value), options });
    },
    async get() { forbidden.push("MEDIA.get"); assert.fail("Association does not fetch stored media"); },
  };
  h.transport = async request => {
    const task = worker.request(request.url, request.init); pending.add(task);
    try { return await task; } finally { pending.delete(task); }
  };
  let plannerPlan;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = String(url);
    if (path.startsWith("/api/")) return h.fetch(url, init);
    if (![plannerUrl, submissionUrl, statusUrl, resultUrl, mediaUrl].includes(path)) {
      forbidden.push(path); throw new Error("No external request is permitted");
    }
    if (calls.some(row => row.path === path)) forbidden.push("duplicate fetch:" + path);
    assert.equal(calls.some(row => row.path === path), false, "No repeated provider or media request");
    const request = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, request });
    assert.equal(init.method, path === plannerUrl || path === submissionUrl ? "POST" : "GET");
    if (path === plannerUrl) {
      const input = JSON.parse(request.input), groups = (input.combined_context_plan ?? []).map(group => group.context_key);
      plannerPlan = { title: "Harbor departure 雨", summary: "One continuous harbor movement", presentation: null,
        content_markdown: "The keeper leaves the stone shelter, lifts a brass lantern and walks toward the red harbor marker. 雨 — literal saved result.",
        items: [{ title: "Lantern at the harbor", body: "The keeper walks from the stone shelter toward a red harbor marker while holding a brass lantern.",
          notes: "A steady lateral camera follows the entire movement.", image_prompt: "", context_group_ids: groups, slide: null }] };
      return Response.json({ id: "video-ram-planner", model: "gpt-5.6-terra", output_text: JSON.stringify(plannerPlan),
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
    }
    if (path !== mediaUrl) assert.equal(new Headers(init.headers).get("authorization"), "Key in-memory-video-test");
    if (path === submissionUrl) {
      assert.equal(typeof request.prompt, "string"); assert.ok(request.prompt.length > 0);
      assert.deepEqual(Object.keys(request).sort(), ["aspect_ratio", "duration", "end_user_id", "generate_audio", "prompt", "resolution"]);
      assert.deepEqual([request.aspect_ratio, request.duration, request.resolution, request.generate_audio], ["16:9", 4, "720p", false]);
      assert.match(request.end_user_id, /^forma_[a-f0-9]{32}$/u);
      return Response.json({ request_id: providerJobId }, { status: 202 });
    }
    if (path === statusUrl) return Response.json({ status: "COMPLETED", request_id: providerJobId });
    if (path === resultUrl) return Response.json({ video: { url: mediaUrl, content_type: "video/mp4" } });
    assert.equal(new Headers(init.headers).has("authorization"), false);
    return new Response(fixtureBytes, { headers: { "content-type": "video/mp4" } });
  });
  t.after(async () => {
    while (pending.size) await Promise.allSettled([...pending]);
    await worker.drainBackground(); await h.close(); assert.deepEqual(forbidden, []);
  });

  const savedText = "The keeper leaves the stone shelter and walks toward the red harbor marker with a brass lantern. 雨 — saved source.";
  const saved = await h.store.saveBlockText("scene-reuse-direction", savedText, "output-context-editor");
  assert.equal(saved.length, 1); const savedEvent = saved[0];
  assert.equal(savedEvent.type, "BlockPropertyEdited"); assert.equal(savedEvent.payload.property_path, "text");
  assert.equal(savedEvent.payload.new_value, savedText);
  assert.equal(h.requests.filter(request => request.url === "/api/document-jobs").length, 0, "Save never starts generation");
  assert.equal(calls.length, 0);
  const preCreateHead = worker.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(worker.streamId).head;
  assert.equal(await h.store.renderDocumentArtifact("video", { documentId: worker.documentId,
    productionMode: "manual", paidMediaConfirmed: true, locale: "en-US", videoSeconds: 4, videoSize: "1280x720", videoAudioMode: "silent" }), true);
  const admissions = h.requests.filter(request => request.url === "/api/document-jobs" && request.body?.payload?.artifactKind === "video");
  assert.equal(admissions.length, 1); assert.equal(calls.length, 0, "Admission alone has no mocked provider execution");
  const request = admissions[0].body, payload = request.payload;
  assert.equal(request.documentId, worker.documentId); assert.equal(request.sourceSurface, "document");
  assert.equal(payload.productionMode, "manual"); assert.equal(payload.paidMediaConfirmed, true);
  assert.deepEqual([payload.videoSeconds, payload.videoSize, payload.videoAudioMode, payload.locale], [4, "1280x720", "silent", "en-US"]);
  assert.equal(Object.hasOwn(payload, "itemCount"), false, "The actual Video UI omits the count; the producer defaults it");
  assert.equal(payload.requestKey, `render:video:manual:${payload.documentRevision}:default:4:1280x720:silent:general:document-derived:en-us`);
  const savedBlock = h.store.projection.get().libraryBlocks.find(block => block.id === "scene-reuse-direction");
  assert.ok(savedBlock.sourceEvents.includes(savedEvent.eventId));
  const sourceVersion = { block_id: savedBlock.id, version: savedBlock.sourceEvents.length };
  assert.deepEqual(payload.sourceBlockVersions.find(row => row.block_id === savedBlock.id), sourceVersion);
  assert.ok(payload.snapshot.facts.find(row => row.block_id === savedBlock.id).source_event_refs.includes(savedEvent.eventId));
  assert.ok(JSON.stringify(payload.snapshot).includes(savedText));
  for (const field of ["workflowId", "workflowStageId", "workflowSources", "outputExecution", "sceneRequestId", "sceneCostConsent", "sceneMedium",
    "requestedSlideCount", "slideCountPolicy", "audioProfile", "audioProviderModel", "soundtrackBlockIds", "sendSoundtrackToVideoProvider"]) assert.equal(payload[field], undefined, field);
  const queued = worker.sqlite.prepare("SELECT * FROM document_jobs WHERE document_id=? AND json_extract(request_json,'$.artifactKind')='video'").all(worker.documentId);
  assert.equal(queued.length, 1); assert.equal(queued[0].status, "queued"); assert.equal(queued[0].attempt_count, 0);
  assert.equal(queued[0].requested_sequence, preCreateHead); assert.equal(queued[0].correlation_id, queued[0].job_id);
  const originalPayload = JSON.parse(queued[0].request_json);
  assert.deepEqual(originalPayload.snapshot, payload.snapshot); assert.deepEqual(originalPayload.sourceBlockVersions, payload.sourceBlockVersions);
  assert.equal(originalPayload.requestKey, payload.requestKey); assert.equal(originalPayload.documentRevision, payload.documentRevision);
  const handle = { documentId: worker.documentId, jobId: queued[0].job_id }, run = await worker.run(handle.jobId);
  assert.equal(run.response.status, 200);
  const job = worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(handle.jobId);
  t.diagnostic("LOCAL_VIDEO_EXECUTION " + JSON.stringify({ status: job.status, calls: calls.map(row => row.path), storedFiles: stored.size }));
  assert.equal(job.status, "completed", JSON.stringify(run.body)); assert.equal(job.attempt_count, 1);
  assert.equal(job.correlation_id, `${handle.jobId}:attempt:1`); assert.equal(job.requested_sequence, preCreateHead);
  assert.equal(job.request_json, queued[0].request_json); assert.equal(job.owner_id, worker.owner);
  assert.deepEqual(calls.map(row => row.path), [plannerUrl, submissionUrl, statusUrl, resultUrl, mediaUrl]);
  assert.equal(stored.size, 1);

  const result = JSON.parse(job.result_json), completions = worker.sqlite.prepare("SELECT * FROM events WHERE stream_id=? AND correlation_id=? AND type='DocumentRenderCompleted'").all(job.stream_id, job.correlation_id);
  assert.equal(completions.length, 1); const completion = completions[0], publicPayload = JSON.parse(completion.payload);
  assert.equal(completion.actor, "worker:renderer"); assert.equal(completion.client_id, "server:document-job:render_document");
  assert.ok(result.appendedEventIds.includes(completion.event_id)); assert.equal(publicPayload.artifact_id, result.artifactId);
  assert.equal(result.providerJobId, providerJobId); assert.equal(result.provider, "fal");
  assert.equal(publicPayload.item_count, 1); assert.equal(publicPayload.items, undefined);
  const secret = worker.sqlite.prepare("SELECT * FROM event_private_payloads WHERE private_event_id=?").get(completion.event_id);
  const full = JSON.parse(secret.private_json);
  assert.equal(secret.owner_id, worker.owner); assert.equal(full.requested_by_user_id, worker.owner);
  assert.equal(full.input_ref, publicPayload.input_ref); assert.equal(full.artifact_id, result.artifactId);
  assert.deepEqual(full.source_block_versions, payload.sourceBlockVersions);
  assert.deepEqual([full.provider, full.provider_job_id, full.model_id], ["fal", providerJobId, model]);
  assert.equal(full.media_type, "video/mp4"); assert.equal(full.settings.source_media_sha256, undefined, "Video does not declare Audio's media digest field");
  assert.deepEqual(full.items, [{ id: `${result.artifactId}-item-1`, title: plannerPlan.items[0].title, slide: null,
    context_group_ids: full.items[0].context_group_ids, media_url: null, media_type: null, width: null, height: null }]);
  const mediaKey = decodeURIComponent(full.media_url.slice("/api/media/".length));
  assert.ok(mediaKey.startsWith(ownerMediaNamespace(worker.owner) + "/generated/"));
  assert.ok(stored.has(mediaKey)); const storedMedia = stored.get(mediaKey);
  assert.deepEqual(storedMedia.bytes, fixtureBytes); assert.equal(storedMedia.options.httpMetadata.contentType, "video/mp4");
  const rawRow = worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(publicPayload.content_ref);
  assert.equal(rawRow.owner_id, worker.owner); assert.equal(rawRow.kind, "document-artifact");
  const raw = rawRow.content, body = JSON.parse(raw), sha256 = digest(raw);
  assert.equal(body.items.length, 1); assert.equal(body.content_markdown, plannerPlan.content_markdown);
  assert.deepEqual([body.items[0].title, body.items[0].body, body.items[0].notes], [plannerPlan.items[0].title, plannerPlan.items[0].body, plannerPlan.items[0].notes]);

  const inputRow = worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(full.input_ref), input = JSON.parse(inputRow.content);
  assert.equal(inputRow.owner_id, worker.owner); assert.equal(inputRow.kind, "document-artifact-input");
  assert.notEqual(full.input_ref, result.generationReceipt.input_ref, "Generated input and admission receipt are distinct actual rows");
  assert.deepEqual([input.schema_version, input.artifact_kind, input.artifact_id, input.document_id, input.project_id], [1, "video", result.artifactId, worker.documentId, worker.projectId]);
  assert.equal(input.document_snapshot.document.id, worker.documentId);
  assert.deepEqual(input.document_snapshot.facts, payload.snapshot.facts);
  for (const [key, value] of Object.entries(payload.snapshot)) {
    if (key !== "document" && key !== "standing_constraints") assert.deepEqual(input.document_snapshot[key], value, key);
  }
  for (const constraint of payload.snapshot.standing_constraints ?? []) assert.ok((input.document_snapshot.standing_constraints ?? []).some(value => JSON.stringify(value) === JSON.stringify(constraint)));
  const expectedSettings = { item_count: 1, production_mode: "manual", audience: "general", tone: "document-derived", video_seconds: 4, video_size: "1280x720", video_audio_mode: "silent" };
  for (const [key, value] of Object.entries(expectedSettings)) { assert.deepEqual(input.request[key], value, key); assert.deepEqual(full.settings[key], value, key); }
  assert.equal(input.request.source_surface, "document"); assert.deepEqual(input.request.soundtrack_block_ids, []);
  assert.equal(input.request.soundtrack_provider_transfer, false);
  assert.deepEqual([input.render.provider, input.render.provider_job_id, input.render.model], [result.provider, result.providerJobId, full.model_id]);
  assert.equal(input.render.submitted_prompt, calls.find(row => row.path === submissionUrl).request.prompt);
  assert.deepEqual(input.render.reference_inputs, []); assert.equal(input.render.used_reference_pixels, false);

  const user = h.store.session.get().user, reads = [], httpBeforeRead = h.requests.length;
  const env = { ...worker.env, DB: { prepare(sql) {
    if (!/^\s*(?:WITH|SELECT)\b/iu.test(sql)) { forbidden.push("reader.prepare:" + sql); assert.fail("The reader prepared a write"); }
    reads.push(sql); return worker.env.DB.prepare(sql);
  }, batch() { forbidden.push("reader.batch"); assert.fail("Completion and retained endpoints are read-only"); } } };
  const headers = { "oai-authenticated-user-id": user.userId, "oai-authenticated-user-email": user.email };
  const changes = () => worker.sqlite.prepare("SELECT total_changes() AS count").get().count;
  const readCompletion = () => handleNativeRetainedOutputRead(new Request("http://localhost" + nativeVideoCompletionPath(handle), { headers }), env);
  const before = changes(), response = await readCompletion(), receipt = await response.json();
  t.diagnostic("ACTUAL_NATIVE_VIDEO_ASSOCIATION " + JSON.stringify({ handle, savedEventId: savedEvent.eventId,
    savedSequence: savedEvent.sequence, requestedSequence: job.requested_sequence, documentRevision: payload.documentRevision,
    requestKey: payload.requestKey, status: job.status, attemptCount: job.attempt_count, correlationId: job.correlation_id,
    completionEventId: completion.event_id, artifactId: result.artifactId, inputRef: full.input_ref,
    admissionInputRef: result.generationReceipt.input_ref, rawContentSha256: sha256, sourceBlockVersions: full.source_block_versions,
    providerJobId: result.providerJobId, ownedMediaPath: full.media_url, mockedMediaBytes: fixtureBytes.length,
    mockedMediaSha256: digest(fixtureBytes), mockedPlannerCalls: 1, mockedFalCalls: 3, mockedMediaCalls: 1,
    responseStatus: response.status, receipt }));
  assert.equal(response.status, 200, JSON.stringify(receipt));
  assert.deepEqual(validateNativeVideoCompletion(receipt, handle), receipt);
  assert.deepEqual(receipt.selection, { documentId: worker.documentId, artifactId: result.artifactId, revision: 0, contentSha256: sha256 });
  assert.equal(reads.length, 7, "One bounded generated-input read joins the completion read path");
  const target = parseNativeRetainedOutputRoute(nativeVideoRetainedRoute(receipt, handle));
  assert.deepEqual(target, { output: "video", selection: receipt.selection });
  const retained = await handleNativeRetainedOutputRead(new Request("http://localhost" + nativeRetainedOutputRequestPath(target), { headers }), env);
  assert.equal(retained.status, 200); const dto = await retained.json();
  assert.deepEqual(dto.content, { primaryMedia: { url: full.media_url, mediaType: "video/mp4" }, content_markdown: body.content_markdown,
    clips: [{ id: full.items[0].id, title: body.items[0].title, body: body.items[0].body, notes: body.items[0].notes, media: null }] });
  assert.equal(changes(), before); assert.equal(calls.length, 5); assert.equal(stored.size, 1);

  // Mutate only this test's RAM rows after the genuine producer has completed;
  // restore each original before the next check. No synthetic job/completion seed.
  for (const fault of ["previous-attempt", "selected-input-source", "selected-input-provider", "selected-input-final-bytes"]) await t.test(fault, async () => {
    let finalWitnesses = 0, afterMutation;
    try {
      if (fault === "previous-attempt") worker.sqlite.prepare("UPDATE document_jobs SET attempt_count=2,correlation_id=? WHERE job_id=?").run(`${handle.jobId}:attempt:2`, handle.jobId);
      if (fault === "selected-input-source" || fault === "selected-input-provider") {
        const changed = structuredClone(input);
        if (fault === "selected-input-source") changed.document_snapshot.facts[0].properties.text = "An unrelated later source.";
        else changed.render.provider_job_id = "a-different-provider-job";
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
    assert.equal(calls.length, 5); assert.equal(stored.size, 1);
  });
  assert.equal(h.requests.length, httpBeforeRead, "Read endpoints issue no application requests");
  assert.deepEqual(forbidden, []);
});
