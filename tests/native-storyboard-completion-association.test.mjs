import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { jpeg } from "./output-asset-fixtures.mjs";
import { handleNativeRetainedOutputRead } from "../worker/retained-story-api.ts";
import { nativeStoryboardCompletionPath, validateNativeStoryboardCompletion, nativeStoryboardRetainedRoute } from "../src/model/native-storyboard-completion.ts";
import { nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute } from "../src/model/native-retained-output.ts";

// Actual Store Save/admission and Worker execution in the existing RAM fixture.
// The planner, moderation and image responses below are local test values. This
// does not prove a browser action, provider output quality, or live authorization.
test("actual manual Storyboard Save/Create resolves its exact completed attempt and four retained frames", { timeout: 30_000 }, async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No external request during fixture initialization"));
  const worker = await createSceneCostFixture(1, "visual");
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  h.store.patchUi({ instrumentation: false });
  const calls = [], forbidden = [], pending = new Set(), stored = new Map();
  worker.env.MEDIA = {
    async put(key, value, options) { assert.equal(stored.has(key), false); stored.set(key, { bytes: new Uint8Array(value), options }); },
    async get() { assert.fail("This association test does not read generated media"); },
  };
  h.transport = async request => {
    const task = worker.request(request.url, request.init); pending.add(task);
    try { return await task; } finally { pending.delete(task); }
  };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const path = String(url);
    if (path.startsWith("/api/")) return h.fetch(url, init);
    if (!["https://api.openai.com/v1/responses", "https://api.openai.com/v1/moderations", "https://api.openai.com/v1/images/generations"].includes(path)) {
      forbidden.push(path); throw new Error("No external request is permitted");
    }
    assert.equal(init.method, "POST");
    const request = JSON.parse(init.body); calls.push({ path, request });
    if (path.endsWith("/responses")) {
      assert.equal(calls.filter(row => row.path === path).length, 1, "No replacement planner request");
      const input = JSON.parse(request.input), groups = (input.combined_context_plan ?? []).map(group => group.context_key);
      const actions = ["Rain glints on the keeper’s brass lantern as she leaves the stone shelter.",
        "A red buoy drifts beside the mooring; its broken chain disappears into dark water.",
        "From the watchtower, she signals an approaching trawler away from the shallow reef.",
        "At dawn the rescued crew gathers on the quay, wrapped in dry blankets. 雨"];
      const items = actions.map((body, index) => ({ title: `Harbor frame ${index + 1}`,
        body,
        notes: ` Preserve frame ${index + 1}. `, image_prompt: `Wide view of harbor marker ${index + 1}.`, context_group_ids: groups, slide: null }));
      return Response.json({ id: "storyboard-ram-planner", model: "gpt-5.6-terra", output_text: JSON.stringify({
        title: "Four harbor moments", summary: "Four exact saved moments", content_markdown: items.map(item => item.body).join("\n\n"), presentation: null, items }),
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
    }
    if (path.endsWith("/moderations")) return Response.json({ id: "storyboard-ram-moderation", model: "omni-moderation-latest",
      results: [{ flagged: false, categories: {}, category_scores: {} }] });
    assert.equal(request.output_format, "jpeg"); assert.equal(request.n, 1); assert.equal(request.quality, "low");
    const [width, height] = request.size.split("x").map(Number);
    assert.ok(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= 4096 && height <= 4096);
    // Existing baseline JPEG headers, with one zero-DC/EOB pair per 8x8 MCU.
    const template = jpeg({ width, height }), bitCount = Math.ceil(width / 8) * Math.ceil(height / 8) * 2;
    const entropy = new Uint8Array(Math.ceil(bitCount / 8));
    if (bitCount % 8) entropy[entropy.length - 1] = (1 << (8 - bitCount % 8)) - 1;
    const bytes = Buffer.concat([template.slice(0, -3), entropy, Uint8Array.from([255, 217])]);
    return Response.json({ data: [{ b64_json: bytes.toString("base64") }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } },
      { headers: { "x-request-id": `storyboard-ram-image-${calls.filter(row => row.path === path).length}` } });
  });
  t.after(async () => {
    while (pending.size) await Promise.allSettled([...pending]);
    await worker.drainBackground(); await h.close(); assert.deepEqual(forbidden, []);
  });
  const savedText = "The keeper checks four distinct harbor lights. 雨 — saved source.";
  const saved = await h.store.saveBlockText("scene-reuse-direction", savedText, "output-context-editor");
  assert.equal(saved.length, 1); const savedEvent = saved[0];
  assert.equal(savedEvent.type, "BlockPropertyEdited"); assert.equal(savedEvent.payload.property_path, "text");
  assert.equal(savedEvent.payload.new_value, savedText);
  assert.equal(h.requests.filter(request => request.url === "/api/document-jobs").length, 0, "Save never starts a generation");
  assert.equal(calls.length, 0);
  const preCreateHead = worker.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(worker.streamId).head;
  assert.equal(await h.store.renderDocumentArtifact("storyboard", { documentId: worker.documentId,
    productionMode: "manual", itemCount: 4, paidMediaConfirmed: true, locale: "en-US" }), true);
  const admissions = h.requests.filter(request => request.url === "/api/document-jobs" && request.body?.payload?.artifactKind === "storyboard");
  assert.equal(admissions.length, 1); assert.equal(calls.length, 0, "Admission alone has no mocked provider execution");
  const request = admissions[0].body, payload = request.payload;
  assert.equal(request.documentId, worker.documentId); assert.equal(request.sourceSurface, "document");
  assert.equal(payload.productionMode, "manual"); assert.equal(payload.itemCount, 4); assert.equal(payload.paidMediaConfirmed, true);
  assert.equal(payload.requestKey, `render:storyboard:manual:${payload.documentRevision}:4:none:none:silent:general:document-derived:en-us`);
  const savedBlock = h.store.projection.get().libraryBlocks.find(block => block.id === "scene-reuse-direction");
  assert.ok(savedBlock.sourceEvents.includes(savedEvent.eventId));
  const sourceVersion = { block_id: savedBlock.id, version: savedBlock.sourceEvents.length };
  assert.deepEqual(payload.sourceBlockVersions.find(row => row.block_id === savedBlock.id), sourceVersion);
  assert.ok(payload.snapshot.facts.find(row => row.block_id === savedBlock.id).source_event_refs.includes(savedEvent.eventId));
  assert.ok(JSON.stringify(payload.snapshot).includes(savedText));
  for (const field of ["workflowId", "workflowStageId", "workflowSources", "sceneRequestId", "sceneCostConsent", "requestedSlideCount", "slideCountPolicy"]) assert.equal(payload[field], undefined, field);
  const queued = worker.sqlite.prepare("SELECT * FROM document_jobs WHERE document_id=? AND json_extract(request_json,'$.artifactKind')='storyboard'").all(worker.documentId);
  assert.equal(queued.length, 1); assert.equal(queued[0].status, "queued"); assert.equal(queued[0].attempt_count, 0);
  assert.equal(queued[0].requested_sequence, preCreateHead); assert.equal(queued[0].correlation_id, queued[0].job_id);
  const handle = { documentId: worker.documentId, jobId: queued[0].job_id }, run = await worker.run(handle.jobId);
  assert.equal(run.response.status, 200);
  const job = worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(handle.jobId);
  t.diagnostic("LOCAL_STORYBOARD_EXECUTION " + JSON.stringify({ status: job.status, calls: calls.map(row => row.path), storedImages: stored.size }));
  assert.equal(job.status, "completed", JSON.stringify(run.body)); assert.equal(job.attempt_count, 1);
  assert.equal(job.correlation_id, `${handle.jobId}:attempt:1`);
  assert.deepEqual(calls.map(row => row.path.split("/").at(-1)), ["responses", ...Array.from({ length: 4 }, () => ["moderations", "generations"]).flat()]);
  assert.equal(stored.size, 4);
  const result = JSON.parse(job.result_json), completions = worker.sqlite.prepare("SELECT * FROM events WHERE stream_id=? AND correlation_id=? AND type='DocumentRenderCompleted'").all(job.stream_id, job.correlation_id);
  assert.equal(completions.length, 1); const completion = completions[0], publicPayload = JSON.parse(completion.payload);
  assert.equal(completion.actor, "worker:renderer"); assert.equal(completion.client_id, "server:document-job:render_document");
  assert.ok(result.appendedEventIds.includes(completion.event_id)); assert.equal(publicPayload.artifact_id, result.artifactId);
  assert.equal(publicPayload.item_count, 4); assert.equal(publicPayload.items, undefined);
  const privatePayload = JSON.parse(worker.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(completion.event_id).private_json);
  assert.equal(privatePayload.items.length, 4); assert.equal(privatePayload.requested_by_user_id, worker.owner);
  assert.deepEqual(privatePayload.source_block_versions.find(row => row.block_id === savedBlock.id), sourceVersion);
  const raw = worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(publicPayload.content_ref).content;
  const body = JSON.parse(raw), sha256 = createHash("sha256").update(raw).digest("hex");
  assert.equal(body.items.length, 4);
  const user = h.store.session.get().user, reads = [];
  const env = { ...worker.env, DB: { prepare(sql) { assert.match(sql, /^\s*(?:WITH|SELECT)\b/iu); reads.push(sql); return worker.env.DB.prepare(sql); },
    batch() { assert.fail("The completion endpoint is read-only"); } } };
  const headers = { "oai-authenticated-user-id": user.userId, "oai-authenticated-user-email": user.email };
  const before = worker.sqlite.prepare("SELECT total_changes() AS count").get().count;
  const response = await handleNativeRetainedOutputRead(new Request("http://localhost" + nativeStoryboardCompletionPath(handle), { headers }), env);
  const receipt = await response.json();
  t.diagnostic("ACTUAL_NATIVE_STORYBOARD_ASSOCIATION " + JSON.stringify({ handle, savedEventId: savedEvent.eventId,
    savedSequence: savedEvent.sequence, requestedSequence: job.requested_sequence, documentRevision: payload.documentRevision,
    requestKey: payload.requestKey, status: job.status, attemptCount: job.attempt_count, correlationId: job.correlation_id,
    completionEventId: completion.event_id, artifactId: result.artifactId, rawContentSha256: sha256,
    frameIds: privatePayload.items.map(item => item.id), mockedPlannerCalls: 1, mockedModerationCalls: 4, mockedImageCalls: 4,
    storedImages: stored.size, responseStatus: response.status, receipt }));
  assert.equal(response.status, 200, JSON.stringify(receipt));
  assert.deepEqual(validateNativeStoryboardCompletion(receipt, handle), receipt);
  assert.deepEqual(receipt.selection, { documentId: worker.documentId, artifactId: result.artifactId, revision: 0, contentSha256: sha256 });
  assert.equal(reads.length, 6);
  const route = nativeStoryboardRetainedRoute(receipt, handle), target = parseNativeRetainedOutputRoute(route);
  assert.deepEqual(target, { output: "storyboard", selection: receipt.selection });
  const retained = await handleNativeRetainedOutputRead(new Request("http://localhost" + nativeRetainedOutputRequestPath(target), { headers }), env);
  assert.equal(retained.status, 200); const dto = await retained.json();
  assert.deepEqual(dto.content.frames.map(frame => frame.id), privatePayload.items.map(item => item.id));
  for (let index = 0; index < 4; index++) {
    const frame = dto.content.frames[index], source = body.items[index], media = privatePayload.items[index];
    assert.deepEqual([frame.title, frame.body, frame.notes, frame.imagePrompt], [source.title, source.body, source.notes, source.image_prompt]);
    assert.equal(frame.image.url, media.media_url); assert.ok(stored.has(decodeURIComponent(media.media_url.slice("/api/media/".length))));
  }
  assert.equal(worker.sqlite.prepare("SELECT total_changes() AS count").get().count, before);
  assert.equal(calls.length, 9); assert.deepEqual(forbidden, []);
});
