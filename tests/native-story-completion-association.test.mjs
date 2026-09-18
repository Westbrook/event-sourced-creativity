import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { scenePilotProvider } from "./helpers/scene-pilot-fixture.mjs";
import { handleRetainedStoryRead } from "../worker/retained-story-api.ts";
import { nativeStoryCompletionPath, validateNativeStoryCompletion, nativeStoryRetainedRoute } from "../src/model/native-short-story-generation.ts";

// Actual Store admission and Worker execution, with one declared Responses reply
// intercepted in memory. This is a protocol regression, not native browser proof.
test("actual native Story completion resolves the current locally executed attempt to its exact retained selection", { timeout: 30_000 }, async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No external request during fixture initialization"));
  const worker = await createSceneCostFixture(1, "visual");
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  h.store.patchUi({ instrumentation: false });
  const providerReplies = scenePilotProvider(t), providerFetch = globalThis.fetch;
  const forbidden = [], pending = new Set();
  h.transport = async request => {
    const task = worker.request(request.url, request.init); pending.add(task);
    try { return await task; } finally { pending.delete(task); }
  };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).startsWith("/api/")) return h.fetch(url, init);
    if (String(url) === "https://api.openai.com/v1/responses") return providerFetch(url, init);
    forbidden.push(String(url)); throw new Error("No external request is permitted");
  });
  t.after(async () => {
    while (pending.size) await Promise.allSettled([...pending]);
    await worker.drainBackground(); await h.close(); assert.deepEqual(forbidden, []);
  });
  const submitted = await h.store.submitNativeShortStory({ documentId: worker.documentId, audience: "", tone: "", locale: "en" }, { current: () => true });
  assert.equal(submitted.disposition, "acknowledged");
  const handle = submitted.handle; assert.ok(handle); assert.equal(handle.documentId, worker.documentId);
  const admissions = h.requests.filter(request => request.url === "/api/document-jobs" && request.body?.payload?.artifactKind === "short_story");
  assert.equal(admissions.length, 1); assert.equal(providerReplies.length, 0);
  assert.equal(admissions[0].body.payload.productionMode, "manual"); assert.equal(admissions[0].body.payload.itemCount, 1);
  const run = await worker.run(handle.jobId); assert.equal(run.response.status, 200);
  const job = worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(handle.jobId);
  assert.equal(job.status, "completed", JSON.stringify(run.body)); assert.equal(job.attempt_count, 1);
  assert.equal(job.correlation_id, `${handle.jobId}:attempt:1`); assert.equal(providerReplies.length, 1);
  const result = JSON.parse(job.result_json);
  const completions = worker.sqlite.prepare("SELECT * FROM events WHERE stream_id=? AND correlation_id=? AND type='DocumentRenderCompleted'").all(job.stream_id, job.correlation_id);
  assert.equal(completions.length, 1); const completion = completions[0], payload = JSON.parse(completion.payload);
  assert.equal(completion.actor, "worker:renderer"); assert.equal(completion.client_id, "server:document-job:render_document");
  assert.ok(result.appendedEventIds.includes(completion.event_id)); assert.equal(payload.artifact_id, result.artifactId);
  const raw = worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(payload.content_ref).content;
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const user = h.store.session.get().user, reads = [];
  const env = { ...worker.env, DB: { prepare(sql) { assert.match(sql, /^\s*(?:WITH|SELECT)\b/iu); reads.push(sql); return worker.env.DB.prepare(sql); },
    batch() { assert.fail("The completion endpoint is read-only"); } } };
  const request = new Request("http://localhost" + nativeStoryCompletionPath(handle), {
    headers: { "oai-authenticated-user-id": user.userId, "oai-authenticated-user-email": user.email },
  });
  const before = worker.sqlite.prepare("SELECT total_changes() AS count").get().count;
  const response = await handleRetainedStoryRead(request, env), body = await response.json();
  t.diagnostic("ACTUAL_NATIVE_STORY_ASSOCIATION " + JSON.stringify({ handle, status: job.status, attemptCount: job.attempt_count,
    correlationId: job.correlation_id, completionEventId: completion.event_id, artifactId: result.artifactId,
    rawContentSha256: sha256, providerReplyCount: providerReplies.length, responseStatus: response.status, receipt: body }));
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(validateNativeStoryCompletion(body, handle), body);
  assert.deepEqual(body.selection, { documentId: worker.documentId, artifactId: result.artifactId, revision: 0, contentSha256: sha256 });
  assert.ok(nativeStoryRetainedRoute(body, handle)?.startsWith("/make/short-story?"));
  assert.equal(reads.length, 5); assert.equal(worker.sqlite.prepare("SELECT total_changes() AS count").get().count, before);
  assert.equal(providerReplies.length, 1); assert.deepEqual(forbidden, []);
});
