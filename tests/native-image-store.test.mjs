import assert from "node:assert/strict";
import test from "node:test";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { withDocumentInRoute } from "../src/model/routes.ts";
import { captureNativeImageHandle, joinNativeImageCompletion } from "../src/model/native-image-generation.ts";

// Focused controls selected from the surviving Image Store supplier.
// The helper loads the complete production Store. Its only new opt-in port calls
// beforeFetch synchronously before the existing async transport and request log.
// Explicit workerFixture avoids the default SQL fixture, but the unchanged helper
// still imports Worker dependencies. Synthetic HTTP bodies provide no provider,
// Worker admission, saved-source custody, loaded-pixel or browser evidence.
// Successful submission controls use complete synthetic ACK/run identities.
// Physical run and refresh settlement remain distinct from the observed ACK.
const OPTIONS = { concurrency: false, timeout: 20_000 };
const OWNER = "native-story-store-owner";
const PROJECT = "native-story-store-project";
const DOCUMENT = "native-story-store-document";
const AT = "2026-09-03T00:00:00.000Z";
const notDispatched = { disposition: "not-dispatched", handle: null, reason: "unavailable" };
function fixtureTransport() {
  const inputs = [
    { type: "ProjectCreated", payload: { project_id: PROJECT, name: "Native story fixtures" } },
    { type: "DocumentCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, title: "Native story fixture" } },
    { type: "BlockCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, block_id: "story-direction", type: "direction",
      handle: "direction/story", position: "a", properties: { text: "A keeper returns a lost compass.", weight: 1 } } },
  ];
  const events = inputs.map((input, index) => ({ ...input, eventId: `native-story-event-${index + 1}`, sequence: index + 1,
    streamId: `creative:${OWNER}`, occurredAt: AT, recordedAt: AT, actor: "user", clientId: "store-fixture",
    correlationId: `native-story-correlation-${index + 1}`, causationId: null, compensatesEventId: null, schemaVersion: 1 }));
  const session = { user: { userId: OWNER, email: "native-story@example.test", displayName: "Story author", role: "creator" },
    impersonation: null, policy: { version: "fixture-policy", accepted: true }, permissionEpoch: "fixture-epoch",
    capabilities: ["project.read", "project.author", "project.output.request"], provider: {} };
  const request = async (url, init = {}) => {
    if (url === "/api/session") return Response.json(session);
    if (url.startsWith("/api/events?") && (!init.method || init.method === "GET")) return Response.json({ events, head: events.length, content: {} });
    assert.fail(`Unexpected fixture HTTP request ${init.method ?? "GET"} ${url}`);
  };
  return { owner: OWNER, projectId: PROJECT, documentId: DOCUMENT, requestId: "unused-scene-request", payload: {}, events, request, close() {} };
}

async function host(t) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No external transport is permitted in native Store tests"));
  const h = await createSceneStoreHost({ workerFixture: fixtureTransport(), exposeSceneTestAccessors: true });
  t.after(() => h.close());
  h.store.route.set(withDocumentInRoute("/", DOCUMENT, "Native story fixture"));
  h.store.loading.set(false);
  h.jobRequests = () => h.requests.filter(row => row.url === "/api/document-jobs" && row.init.method === "POST");
  return h;
}

const runnerRequests = h => h.requests.filter(row => /^\/api\/document-jobs\/[^/]+\/run$/u.test(row.url));
function monthlyBudget(usedMicrousd) {
  const budget = { usedMicrousd, reservedMicrousd: 0, limitMicrousd: 100_000_000, remainingMicrousd: 100_000_000 - usedMicrousd };
  return { period: new Date().toISOString().slice(0, 7), currency: "USD", user: { ...budget }, workspace: { ...budget } };
}

const IMAGE_UNCONFIRMED = Object.freeze({ disposition: "dispatched-unconfirmed", handle: null });
const IMAGE_UNAVAILABLE = Object.freeze({ status: "unavailable" });
const IMAGE_SUPERSEDED = Object.freeze({ status: "superseded" });
function imageSetup(h) {
  return { documentId: DOCUMENT, documentRevision: h.store.documentGenerationRevision(), sourceSurface: "native-image",
    promptTechnique: "prose", kind: "generate", productionMode: "manual", sourcePreviewId: null,
    requestKey: h.store.documentGenerationRequestKey("generate", null, "prose") };
}
function imageJob(setup, overrides = {}) {
  return { ...setup, jobId: "native-image-job", status: "queued", requestedSequence: 3,
    promptFanId: null, parentJobId: null, fanKind: null, members: [], canvasId: null,
    requestedAt: AT, startedAt: null, completedAt: null, updatedAt: AT, notifiedAt: null,
    leaseExpiresAt: null, dismissedAt: null, attemptCount: 0, stage: "queued", progressMessage: "",
    result: null, error: null, errorDetail: null, moderationPromptRef: null, ...overrides };
}
function imageHandle(job) {
  const handle = captureNativeImageHandle(job);
  assert.ok(handle, "The Image fixture must expose a current native Image job identity");
  return handle;
}
function imageEvidence(setup) {
  const generationId = "native-image-generation", eventId = "native-image-completed", objectId = "native-image-output";
  const ownerHex = Array.from(new TextEncoder().encode(OWNER), byte => byte.toString(16).padStart(2, "0")).join("");
  const envelope = { streamId: `creative:${OWNER}`, occurredAt: AT, recordedAt: AT, actor: "worker:generator",
    clientId: "server:document-job:generate", correlationId: "native-image-correlation", causationId: null,
    compensatesEventId: null, schemaVersion: 1 };
  const compiled = { ...envelope, eventId: "native-image-compiled", sequence: 4, type: "ContextCompiled",
    payload: { document_id: DOCUMENT, generation_id: generationId, compiled_snapshot: { document: { id: DOCUMENT } } } };
  const completion = { ...envelope, eventId, sequence: 5, type: "GenerationCompleted",
    payload: { document_id: DOCUMENT, generation_id: generationId, object_id: objectId, object_ids: [objectId],
      model_id: "gpt-image-2", provider: "openai", source_surface: setup.sourceSurface, prompt_technique: setup.promptTechnique,
      media_url: `/api/media/u-${ownerHex}%2Fgenerated%2F${generationId}.png`, media_type: "image/png",
      source_content_hash: "a".repeat(64), image_width: 1536, image_height: 1024,
      quality: "high", purpose: "final", simulation: false, used_ideation_preview_pixels: false,
      canvas_id: null, context_set_id: null, prompt_fan_id: null, promotion_id: null,
      reference_preview_event_id: null, promoted_from_generation_id: null, promoted_from_object_id: null,
      promotion_outcome: null, content_expires_at: new Date(Date.now() + 3_600_000).toISOString() } };
  const job = imageJob(setup, { status: "completed", stage: "completed", startedAt: AT, completedAt: AT,
    result: { head: 5, appendedEventIds: [compiled.eventId, completion.eventId], promoted: false } });
  return { job, compiled, completion, events: [compiled, completion] };
}
test("native Image Store serializes exact manual setup at the actual submission transport", OPTIONS, async t => {
  const h = await host(t), setup = imageSetup(h), original = imageJob(setup);
  h.intercept = async request => {
    if (request.url === "/api/document-jobs" && request.init.method === "POST") return Response.json({ job: original, accepted: true }, { status: 202 });
    if (request.url === "/api/document-jobs/native-image-job/run" && request.init.method === "POST")
      return Response.json({ job: { ...original, status: "running", stage: "running" } });
  };
  await h.store.submitNativeImage(setup, { current: () => true });
  assert.equal(h.jobRequests().length, 1);
  const sent = h.jobRequests()[0].body;
  assert.equal(sent.kind, "generate"); assert.equal(sent.documentId, DOCUMENT); assert.equal(sent.sourceSurface, "native-image");
  for (const key of ["documentRevision", "requestKey", "promptTechnique", "productionMode", "sourcePreviewId"]) assert.equal(sent.payload[key], setup[key]);
  assert.equal(sent.payload.current, undefined); assert.equal(sent.payload.onDispatch, undefined);
});

test("native Image Store rejects a present malformed reuse marker before receiving an ACK", OPTIONS, async t => {
  const h = await host(t), setup = imageSetup(h), original = imageJob(setup);
  let acknowledgments = 0;
  h.intercept = request => {
    assert.equal(request.url, "/api/document-jobs"); assert.equal(request.init.method, "POST");
    return Response.json({ job: original, accepted: true, reused: "false" }, { status: 202 });
  };
  assert.deepEqual(await h.store.submitNativeImage(setup, { current: () => true,
    onAcknowledgment() { acknowledgments++; },
  }), IMAGE_UNCONFIRMED);
  assert.equal(acknowledgments, 0); assert.equal(h.jobRequests().length, 1); assert.deepEqual(runnerRequests(h), []);
});

test("native Image Store reports the exact ACK before its physical run settles", OPTIONS, async t => {
  const h = await host(t), setup = imageSetup(h), original = imageJob(setup);
  const runEntered = sceneDeferred(), runResponse = sceneDeferred(), order = [];
  let acknowledgment, settled = false;
  h.intercept = request => {
    if (request.url === "/api/document-jobs" && request.init.method === "POST")
      return Response.json({ job: original, reused: false }, { status: 202 });
    assert.equal(request.url, "/api/document-jobs/native-image-job/run");
    assert.equal(request.init.method, "POST");
    assert.deepEqual(order, ["ack"], "The captured ACK is delivered before run invocation");
    order.push("run"); runEntered.resolve(); return runResponse.promise;
  };
  const pending = h.store.submitNativeImage(setup, { current: () => true,
    onAcknowledgment(value) {
      assert.equal(acknowledgment, undefined); assert.deepEqual(runnerRequests(h), []);
      acknowledgment = value; order.push("ack");
    },
  });
  const observed = pending.then(value => { settled = true; return { status: "fulfilled", value }; },
    reason => { settled = true; return { status: "rejected", reason }; });
  t.after(async () => {
    runResponse.resolve(Response.json({ job: { ...original, status: "running", stage: "running" } }));
    await observed;
  });
  await Promise.race([runEntered.promise, observed.then(() => assert.fail("The owned run was never entered"))]);
  assert.deepEqual(acknowledgment, { disposition: "acknowledged", handle: imageHandle(original), reused: false });
  assert.ok(Object.isFrozen(acknowledgment)); assert.ok(Object.isFrozen(acknowledgment.handle));
  await Promise.resolve(); assert.equal(settled, false, "A known ACK does not settle the pending physical request");
  runResponse.resolve(Response.json({ job: { ...original, status: "running", stage: "running" } }));
  assert.deepEqual(await observed, { status: "fulfilled", value: acknowledgment });
  assert.deepEqual(order, ["ack", "run"]); assert.equal(h.jobRequests().length, 1); assert.equal(runnerRequests(h).length, 1);
});

test("native Image Store preserves a callback failure after its known ACK without authorizing a run", OPTIONS, async t => {
  const h = await host(t), setup = imageSetup(h), original = imageJob(setup);
  const failure = new Error("Image ACK consumer failed");
  let acknowledgment;
  h.intercept = request => {
    assert.equal(request.url, "/api/document-jobs"); assert.equal(request.init.method, "POST");
    return Response.json({ job: original, reused: false }, { status: 202 });
  };
  await assert.rejects(h.store.submitNativeImage(setup, { current: () => true,
    onAcknowledgment(value) { acknowledgment = value; throw failure; },
  }), error => error === failure);
  assert.deepEqual(acknowledgment, { disposition: "acknowledged", handle: imageHandle(original), reused: false });
  assert.ok(Object.isFrozen(acknowledgment)); assert.ok(Object.isFrozen(acknowledgment.handle));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.jobRequests().length, 1); assert.deepEqual(runnerRequests(h), [], "Callback failure cannot invent run authority");
});

test("native Image Store propagates the exact physical run failure while retaining the original ACK", OPTIONS, async t => {
  const h = await host(t), setup = imageSetup(h), original = imageJob(setup);
  const failure = new Error("Image physical run transport failed");
  let acknowledgment;
  h.intercept = request => {
    if (request.url === "/api/document-jobs" && request.init.method === "POST")
      return Response.json({ job: original, reused: false }, { status: 202 });
    assert.equal(request.url, "/api/document-jobs/native-image-job/run"); assert.equal(request.init.method, "POST");
    assert.ok(acknowledgment, "The original ACK precedes the failing physical request");
    throw failure;
  };
  await assert.rejects(h.store.submitNativeImage(setup, { current: () => true,
    onAcknowledgment(value) { assert.equal(acknowledgment, undefined); acknowledgment = value; },
  }), error => error === failure);
  assert.deepEqual(acknowledgment, { disposition: "acknowledged", handle: imageHandle(original), reused: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.jobRequests().length, 1); assert.equal(runnerRequests(h).length, 1, "The failed invocation is never retried");
});

test("native Image Store joins its owned events refresh after an immediately completed run", OPTIONS, async t => {
  const h = await host(t), setup = imageSetup(h), original = imageJob(setup), evidence = imageEvidence(setup);
  const refreshEntered = sceneDeferred(), refreshResponse = sceneDeferred(), order = [];
  let acknowledgment, settled = false;
  h.intercept = request => {
    if (request.url === "/api/document-jobs" && request.init.method === "POST")
      return Response.json({ job: original, reused: false }, { status: 202 });
    if (request.url === "/api/document-jobs/native-image-job/run" && request.init.method === "POST") {
      assert.deepEqual(order, ["ack"]); order.push("run");
      return Response.json({ job: evidence.job });
    }
    assert.ok(request.url.startsWith("/api/events?"), "A completed run hydrates through the actual event reader");
    assert.equal(request.init.method ?? "GET", "GET");
    assert.deepEqual(order, ["ack", "run"]); order.push("refresh");
    refreshEntered.resolve(); return refreshResponse.promise;
  };
  const pending = h.store.submitNativeImage(setup, { current: () => true,
    onAcknowledgment(value) { acknowledgment = value; order.push("ack"); },
  });
  const observed = pending.then(value => { settled = true; return { status: "fulfilled", value }; },
    reason => { settled = true; return { status: "rejected", reason }; });
  t.after(async () => {
    refreshResponse.resolve(Response.json({ events: [...h.worker.events, ...evidence.events], head: 5, content: {} }));
    await observed;
  });
  await Promise.race([refreshEntered.promise, observed.then(() => assert.fail("The completed run did not start its owned events refresh"))]);
  await Promise.resolve(); assert.equal(settled, false, "Submission still owns the physical event read after receiving its ACK");
  assert.equal(h.store.events.get().some(event => event.eventId === evidence.completion.eventId), false);
  refreshResponse.resolve(Response.json({ events: [...h.worker.events, ...evidence.events], head: 5, content: {} }));
  assert.deepEqual(await observed, { status: "fulfilled", value: acknowledgment });
  assert.deepEqual(acknowledgment, { disposition: "acknowledged", handle: imageHandle(original), reused: false });
  assert.deepEqual(h.store.events.get().filter(event => evidence.events.some(expected => expected.eventId === event.eventId)), evidence.events);
  assert.equal(h.store.head.get(), 5); assert.equal(h.store.documentGenerationRevision(), setup.documentRevision);
  assert.equal(h.jobRequests().length, 1); assert.equal(runnerRequests(h).length, 1);
  assert.equal(h.requests.filter(request => request.url.startsWith("/api/events?")).length, 1);
});
test("native Image Store keeps active peers ahead of its pending run and retires on authored replacement", OPTIONS, async t => {
  for (const peer of [
    { name: "older queued", status: "queued", requestedAt: "2026-09-02T00:00:00.000Z" },
    { name: "newer running", status: "running", requestedAt: "2026-09-04T00:00:00.000Z" },
    { name: "newer committing", status: "committing", requestedAt: "2026-09-04T00:00:00.000Z" },
  ]) {
    await t.test(peer.name, async child => {
      const h = await host(child), setup = imageSetup(h), original = imageJob(setup), abort = new AbortController();
      const peerJob = imageJob(setup, { jobId: "legacy-peer-image", sourceSurface: "document", requestKey: "legacy-peer-request",
        status: peer.status, stage: peer.status, requestedAt: peer.requestedAt,
        startedAt: peer.status === "queued" ? null : peer.requestedAt, attemptCount: peer.status === "queued" ? 0 : 1 });
      h.store.documentJobs.set([peerJob]);
      let acknowledgment, settled = false;
      h.intercept = request => {
        assert.equal(request.url, "/api/document-jobs"); assert.equal(request.init.method, "POST");
        return Response.json({ job: original, reused: false }, { status: 202 });
      };
      const observed = h.store.submitNativeImage(setup, { current: () => true, signal: abort.signal,
        onAcknowledgment(value) { acknowledgment = value; },
      }).then(value => { settled = true; return { status: "fulfilled", value }; },
        reason => { settled = true; return { status: "rejected", reason }; });
      child.after(async () => { abort.abort(); await observed; });
      await untilScene(() => [...h.timers.values()].some(timer => timer.delay > 60_000 && timer.delay <= 300_000), "The actual bounded pre-run wait owns its timer");
      assert.deepEqual(acknowledgment, { disposition: "acknowledged", handle: imageHandle(original), reused: false });
      assert.equal(settled, false); assert.deepEqual(runnerRequests(h), []);
      imageAuthoredStage(h, "pending-image-run-source-retired");
      assert.deepEqual(await observed, { status: "fulfilled", value: acknowledgment });
      assert.deepEqual(runnerRequests(h), []); assert.equal(h.jobRequests().length, 1);
      assert.equal([...h.timers.values()].some(timer => timer.delay > 60_000 && timer.delay <= 300_000), false);
      h.store.discardOptimisticCanvasEvents(["pending-image-run-source-retired"]);
      h.store.documentJobs.set([{ ...original }, { ...peerJob, status: "completed", stage: "completed" }]); h.store.notify();
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(runnerRequests(h), [], "Restored source and available queue cannot revive the retired Create intent");
    });
  }
});

test("native Image Store releases its pending run once for an equivalent target and terminal older job", OPTIONS, async t => {
  const h = await host(t), setup = imageSetup(h), original = imageJob(setup), abort = new AbortController();
  const older = imageJob(setup, { jobId: "older-legacy-image", sourceSurface: "document", requestKey: "older-legacy-request",
    status: "running", stage: "running", requestedAt: "2026-09-02T00:00:00.000Z", startedAt: "2026-09-02T00:00:00.000Z", attemptCount: 1 });
  const runEntered = sceneDeferred(), runResponse = sceneDeferred();
  h.store.documentJobs.set([older]);
  let acknowledgment;
  h.intercept = request => {
    if (request.url === "/api/document-jobs" && request.init.method === "POST")
      return Response.json({ job: original, reused: false }, { status: 202 });
    assert.equal(request.url, "/api/document-jobs/native-image-job/run"); assert.equal(request.init.method, "POST");
    assert.ok(acknowledgment); runEntered.resolve(); return runResponse.promise;
  };
  const observed = h.store.submitNativeImage(setup, { current: () => true, signal: abort.signal,
    onAcknowledgment(value) { acknowledgment = value; },
  }).then(value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason }));
  t.after(async () => {
    abort.abort(); runResponse.resolve(Response.json({ job: { ...original, status: "running", stage: "running" } }));
    await observed;
  });
  await untilScene(() => [...h.timers.values()].some(timer => timer.delay > 60_000 && timer.delay <= 300_000), "The original Create is waiting behind the older job");
  assert.deepEqual(runnerRequests(h), []);
  const heldTarget = h.store.documentJobs.get().find(job => job.jobId === original.jobId);
  assert.ok(heldTarget);
  const replacement = { ...heldTarget, members: [...heldTarget.members] };
  assert.notEqual(replacement, heldTarget); assert.deepEqual(imageHandle(replacement), acknowledgment.handle);
  h.store.documentJobs.set([replacement, { ...older, status: "completed", stage: "completed" }]); h.store.notify();
  await Promise.race([runEntered.promise, observed.then(() => assert.fail("The owned replacement never received its queue turn"))]);
  assert.equal([...h.timers.values()].some(timer => timer.delay > 60_000 && timer.delay <= 300_000), false);
  h.store.notify(); h.store.notify();
  assert.equal(runnerRequests(h).length, 1, "Repeated publication cannot duplicate the owned physical run");
  runResponse.resolve(Response.json({ job: { ...original, status: "running", stage: "running" } }));
  assert.deepEqual(await observed, { status: "fulfilled", value: acknowledgment });
  h.store.notify(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.jobRequests().length, 1); assert.equal(runnerRequests(h).length, 1);
});

test("native Image Store aborts only its pending queue intent and never revives it after feed reappearance", OPTIONS, async t => {
  const h = await host(t), setup = imageSetup(h), original = imageJob(setup), abort = new AbortController();
  const older = imageJob(setup, { jobId: "older-legacy-image", sourceSurface: "document", requestKey: "older-legacy-request",
    status: "running", stage: "running", requestedAt: "2026-09-02T00:00:00.000Z", startedAt: "2026-09-02T00:00:00.000Z", attemptCount: 1 });
  h.store.documentJobs.set([older]);
  let acknowledgment;
  h.intercept = request => {
    assert.equal(request.url, "/api/document-jobs"); assert.equal(request.init.method, "POST");
    return Response.json({ job: original, reused: false }, { status: 202 });
  };
  const observed = h.store.submitNativeImage(setup, { current: () => true, signal: abort.signal,
    onAcknowledgment(value) { acknowledgment = value; },
  }).then(value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason }));
  t.after(async () => { abort.abort(); await observed; });
  await untilScene(() => [...h.timers.values()].some(timer => timer.delay > 60_000 && timer.delay <= 300_000), "The original Create is physically waiting for queue eligibility");
  assert.deepEqual(acknowledgment, { disposition: "acknowledged", handle: imageHandle(original), reused: false });
  assert.deepEqual(runnerRequests(h), []);
  abort.abort();
  assert.deepEqual(await observed, { status: "fulfilled", value: acknowledgment });
  assert.equal([...h.timers.values()].some(timer => timer.delay > 60_000 && timer.delay <= 300_000), false);
  h.store.documentJobs.set([]); h.store.notify();
  h.store.documentJobs.set([{ ...original }, { ...older, status: "completed", stage: "completed" }]); h.store.notify();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(runnerRequests(h), []); assert.equal(h.jobRequests().length, 1);
});

test("native Image Store expires a delayed queue turn before invocation even when its timer has not fired", OPTIONS, async t => {
  const h = await host(t), setup = imageSetup(h), original = imageJob(setup), abort = new AbortController();
  const older = imageJob(setup, { jobId: "older-legacy-image", sourceSurface: "document", requestKey: "older-legacy-request",
    status: "running", stage: "running", requestedAt: "2026-09-02T00:00:00.000Z", startedAt: "2026-09-02T00:00:00.000Z", attemptCount: 1 });
  h.store.documentJobs.set([older]);
  let acknowledgment;
  h.intercept = request => {
    assert.equal(request.url, "/api/document-jobs"); assert.equal(request.init.method, "POST");
    return Response.json({ job: original, reused: false }, { status: 202 });
  };
  const observed = h.store.submitNativeImage(setup, { current: () => true, signal: abort.signal,
    onAcknowledgment(value) { acknowledgment = value; },
  }).then(value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason }));
  t.after(async () => { abort.abort(); await observed; });
  await untilScene(() => [...h.timers.values()].some(timer => timer.delay > 60_000 && timer.delay <= 300_000), "The bounded queue wait was genuinely entered");
  const waitingNow = Date.now(), heldTarget = h.store.documentJobs.get().find(job => job.jobId === original.jobId);
  assert.ok(heldTarget); assert.deepEqual(runnerRequests(h), []);
  t.mock.method(Date, "now", () => waitingNow + 300_001);
  // No timer callback is invoked: a now-eligible notification must enforce the
  // same absolute deadline before it can authorize the physical request.
  h.store.documentJobs.set([{ ...heldTarget, members: [...heldTarget.members] }, { ...older, status: "completed", stage: "completed" }]);
  h.store.notify();
  const outcome = await observed;
  assert.equal(outcome.status, "rejected"); assert.ok(outcome.reason instanceof Error);
  assert.equal(outcome.reason.message, "native_image_initial_queue_wait_expired");
  assert.deepEqual(acknowledgment, { disposition: "acknowledged", handle: imageHandle(original), reused: false });
  assert.equal(h.jobRequests().length, 1); assert.deepEqual(runnerRequests(h), []);
  assert.equal([...h.timers.values()].some(timer => timer.delay > 60_000 && timer.delay <= 300_000), false);
});

test("native Image Store requires personal creator authority and a confirmed saved selected Document", OPTIONS, async t => {
  for (const invalid of ["project-context", "impersonation", "anonymous", "noncreator", "unaccepted-policy", "wrong-stream", "optimistic-document", "wrong-document", "stale-revision", "optimistic-edit"]) {
    await t.test(invalid, async child => {
      const h = await host(child), setup = imageSetup(h), session = h.store.session.get();
      if (invalid === "project-context") h.setSession({ projectContext: { projectId: PROJECT, organizationId: "organization-a" } });
      else if (invalid === "impersonation") h.setSession({ impersonation: { actor: session.user, subject: session.user } });
      else if (invalid === "anonymous") h.setSession({ user: { ...session.user, userId: "anonymous" } });
      else if (invalid === "noncreator") h.setSession({ user: { ...session.user, role: "viewer" } });
      else if (invalid === "unaccepted-policy") h.setSession({ policy: { ...session.policy, accepted: false } });
      else if (invalid === "wrong-stream") h.store.events.set(h.worker.events.map(event => ({ ...event, streamId: "creative:another-owner" })));
      else if (invalid === "optimistic-document") {
        h.store.events.set(h.worker.events.filter(event => event.type === "ProjectCreated"));
        h.store.optimisticEvents.set(h.worker.events.filter(event => event.type !== "ProjectCreated"));
      } else if (invalid === "wrong-document") setup.documentId = "later-default-document-b";
      else if (invalid === "stale-revision") { setup.documentRevision = "rev-stale"; setup.requestKey = "generate:rev-stale:document"; }
      else h.store.optimisticEvents.set([{ ...h.worker.events[2], eventId: "unconfirmed-image-edit", sequence: 4,
        type: "ChipEdited", payload: { project_id: PROJECT, document_id: DOCUMENT, block_id: "story-direction", property: "text", new_value: "An unconfirmed replacement." } }]);
      assert.deepEqual(await h.store.submitNativeImage(setup, { current: () => true }), notDispatched);
      assert.equal(h.jobRequests().length, 0); assert.deepEqual(runnerRequests(h), []);
    });
  }
});

test("native Image Store rechecks current setup across append, navigation and budget waits", OPTIONS, async t => {
  for (const boundary of ["append", "navigation", "budget"]) {
    for (const withdrawal of ["current", "authored-revision", "authority"]) {
      await t.test(`${boundary} ${withdrawal}`, async child => {
        const h = await host(child), setup = imageSetup(h), gate = sceneDeferred(), entered = sceneDeferred();
        let current = true;
        if (boundary === "budget") h.setSession({ costBudgets: monthlyBudget(61_000_000) });
        // This thenable witnesses the existing production await, rather than
        // inferring arrival from an earlier current callback or a scheduler tick.
        else h.store.sceneGateForTest(boundary, { then(resolve, reject) { entered.resolve(); return gate.promise.then(resolve, reject); } });
        const pending = h.store.submitNativeImage(setup, { current: () => current });
        if (boundary === "budget") await untilScene(() => h.dialog()?.open, "actual Image budget gate");
        else await entered.promise;
        if (withdrawal === "current") current = false;
        else if (withdrawal === "authority") h.setSession({ permissionEpoch: "image-authority-replaced" });
        else h.store.events.set(h.worker.events.map(event => event.type === "BlockCreated"
          ? { ...event, payload: { ...event.payload, properties: { ...event.payload.properties, text: "A replaced authored direction." } } } : event));
        if (boundary === "budget") { if (h.dialog()?.open) h.clickBudget(true); }
        else gate.resolve(true);
        assert.deepEqual(await pending, notDispatched);
        assert.equal(h.jobRequests().length, 0); assert.deepEqual(runnerRequests(h), []);
      });
    }
  }
});
test("native Image Store reads only exact personal inspection with guarded bounded Response bodies", OPTIONS, async t => {
  for (const responseKind of ["healthy", "denied", "malformed", "oversized", "rejected-fetch", "current-before", "aborted-before", "current-after-fetch", "aborted-after-fetch"]) {
    await t.test(responseKind, async child => {
      const h = await host(child), setup = imageSetup(h), evidence = imageEvidence(setup), handle = imageHandle(evidence.job);
      h.store.events.set([...h.worker.events, ...evidence.events]); h.store.head.set(5);
      const abort = new AbortController(), entered = sceneDeferred(), responseGate = sceneDeferred();
      const cancelEntered = sceneDeferred(), cancelGate = sceneDeferred(), readFailure = new Error("Image inspection fetch rejected");
      let current = responseKind !== "current-before", canceled = 0, ownedBody;
      if (responseKind === "aborted-before") abort.abort();
      const path = "/api/document-jobs/native-image-job?inspection=1";
      h.intercept = async request => {
        assert.equal(request.url, path, "inspection never uses ordinary GET, list, refresh or a driver");
        entered.resolve();
        if (responseKind === "rejected-fetch") throw readFailure;
        if (responseKind.endsWith("after-fetch")) return responseGate.promise;
        if (responseKind === "denied") return Response.json({ error: "denied" }, { status: 403 });
        if (responseKind === "malformed") return new Response("{not-json", { headers: { "content-type": "application/json" } });
        if (responseKind === "oversized") return new Response(ownedBody = new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode(" ".repeat(1_048_577))); },
          cancel() { canceled++; cancelEntered.resolve(); return cancelGate.promise; },
        }), { headers: { "content-type": "application/json" } });
        return Response.json({ job: evidence.job });
      };
      const pending = h.store.inspectNativeImage(handle, { current: () => current, signal: abort.signal });
      if (responseKind.endsWith("after-fetch")) {
        await entered.promise;
        if (responseKind === "current-after-fetch") current = false; else abort.abort();
        responseGate.resolve(new Response(ownedBody = new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ job: evidence.job }))); },
          cancel() { canceled++; cancelEntered.resolve(); return cancelGate.promise; },
        }), { headers: { "content-type": "application/json" } }));
      }
      if (responseKind === "oversized" || responseKind.endsWith("after-fetch")) {
        let settled = false;
        pending.then(() => { settled = true; }, () => { settled = true; });
        await cancelEntered.promise;
        assert.equal(ownedBody.locked, false, "reader release is attempted before awaiting owned cancellation");
        await Promise.resolve();
        assert.equal(settled, false, "the read port waits for its genuine cancellation promise");
        cancelGate.resolve();
      }
      let outcome;
      if (responseKind === "rejected-fetch") await assert.rejects(pending, error => error === readFailure);
      else outcome = await pending;
      if (responseKind === "healthy") {
        assert.equal(outcome.status, "data");
        assert.equal(joinNativeImageCompletion(handle, outcome.data, () => true).status, "matched");
      } else if (responseKind !== "rejected-fetch") assert.deepEqual(outcome, responseKind.includes("current") || responseKind.includes("aborted") ? IMAGE_SUPERSEDED : IMAGE_UNAVAILABLE);
      const before = responseKind.endsWith("before");
      assert.equal(h.requests.length, before ? 0 : 1);
      if (!before) {
        const request = h.requests[0];
        assert.equal(request.url, path); assert.equal(request.init.method ?? "GET", "GET");
        assert.equal(request.init.credentials, "same-origin"); assert.equal(request.init.cache, "no-store");
        assert.equal(request.init.signal, abort.signal);
      }
      if (responseKind === "oversized" || responseKind.endsWith("after-fetch")) assert.equal(canceled, 1, "the owned unread body is canceled before the port returns");
      assert.deepEqual(runnerRequests(h), []); assert.equal(h.jobRequests().length, 0);
    });
  }
});
test("native Image Store allows its own completion hydration but retires an authored revision replaced during inspection", OPTIONS, async t => {
  for (const change of ["own-hydration", "authored-replacement"]) {
    await t.test(change, async child => {
      const h = await host(child), setup = imageSetup(h), evidence = imageEvidence(setup), handle = imageHandle(evidence.job);
      const entered = sceneDeferred(), response = sceneDeferred();
      h.intercept = async request => {
        assert.equal(request.url, "/api/document-jobs/native-image-job?inspection=1");
        entered.resolve(); return response.promise;
      };
      const pending = h.store.inspectNativeImage(handle, { current: () => true, signal: new AbortController().signal });
      await entered.promise;
      h.store.events.set([...h.worker.events, ...evidence.events]); h.store.head.set(5);
      if (change === "authored-replacement") h.store.events.set([...h.store.events.get(), { ...evidence.compiled,
        eventId: "new-authored-direction", sequence: 6, type: "ChipEdited", payload: { project_id: PROJECT, document_id: DOCUMENT,
          block_id: "story-direction", property: "text", new_value: "An authored replacement after inspection began." } }]);
      response.resolve(Response.json({ job: evidence.job }));
      const outcome = await pending;
      if (change === "own-hydration") {
        assert.equal(h.store.documentGenerationRevision(), setup.documentRevision, "unpinned completion hydration does not rewrite authored setup");
        assert.equal(outcome.status, "data");
        assert.equal(joinNativeImageCompletion(handle, outcome.data, () => true).status, "matched");
      } else {
        assert.notEqual(h.store.documentGenerationRevision(), setup.documentRevision);
        assert.deepEqual(outcome, IMAGE_SUPERSEDED);
      }
      assert.equal(h.requests.length, 1); assert.deepEqual(runnerRequests(h), []);
    });
  }
});

test("native Image Store treats an opt-in synchronous fetch invocation throw as uncertain without resend", OPTIONS, async t => {
  for (const failure of [new Error("synchronous Image fetch boundary"), undefined]) {
    await t.test(failure instanceof Error ? "Error" : "undefined", async child => {
      child.mock.method(globalThis, "fetch", async () => assert.fail("No external transport is permitted"));
      let invoked = 0;
      const h = await createSceneStoreHost({ workerFixture: fixtureTransport(), exposeSceneTestAccessors: true,
        beforeFetch(input, init) {
          if (String(input) === "/api/document-jobs" && init?.method === "POST") { invoked++; throw failure; }
        } });
      child.after(() => h.close());
      h.store.route.set(withDocumentInRoute("/", DOCUMENT, "Native story fixture")); h.store.loading.set(false);
      assert.deepEqual(await h.store.submitNativeImage(imageSetup(h), { current: () => true }), IMAGE_UNCONFIRMED);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(invoked, 1, "the synchronous lexical fetch hook actually ran once");
      assert.deepEqual(h.requests, [], "throw precedes async host.fetch; request logs are not an invocation witness");
      assert.deepEqual(runnerRequests(h), []); assert.deepEqual(h.store.documentJobs.get(), []);
    });
  }
});
function imageLifetime(h, setup = imageSetup(h)) {
  const lifetime = h.store.captureNativeImageLifetime(setup);
  assert.ok(lifetime, "A confirmed personal Document can capture an Image lifetime");
  return lifetime;
}
function imageAuthoredStage(h, clientId) {
  return h.store.stageOptimisticCanvasEvents([{ type: "ChipEdited", payload: {
    project_id: PROJECT, document_id: DOCUMENT, block_id: "story-direction",
    property: "text", new_value: "A different authored Image direction.", client_event_id: clientId,
  } }]);
}
function imageHistoryPort(t, h) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "history"), calls = [];
  const adopt = path => {
    const url = new URL(path, h.location.origin);
    Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash, href: url.href });
  };
  adopt(h.store.route.get());
  Object.defineProperty(globalThis, "history", { configurable: true, writable: true, value: {
    pushState(_state, _unused, path) { calls.push(["push", path]); adopt(path); },
    replaceState(_state, _unused, path) { calls.push(["replace", path]); adopt(path); },
  } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "history", descriptor);
    else delete globalThis.history;
  });
  return calls;
}
function imageAssertNoSemanticWitness(t, h) {
  const get = h.store.projection.get.bind(h.store.projection);
  let reads = 0;
  const observed = t.mock.method(h.store.projection, "get", () => { reads++; return get(); });
  try {
    h.store.notify();
    assert.equal(reads, 0, "With no lease or pending operation, notify retains no Image semantic witness");
  } finally { observed.mock.restore(); }
}

test("native Image lifetime disposal releases its witness and late subscriptions retire synchronously", OPTIONS, async t => {
  const h = await host(t), lifetime = imageLifetime(h);
  let removed = 0, delivered = 0, late = 0;
  const unsubscribe = lifetime.subscribe(() => { removed++; });
  lifetime.subscribe(() => { delivered++; assert.equal(lifetime.current(), false); });
  unsubscribe(); unsubscribe();
  assert.equal(lifetime.current(), true);
  lifetime.dispose(); lifetime.dispose();
  assert.equal(lifetime.current(), false);
  assert.equal(removed, 0); assert.equal(delivered, 1);
  const unsubscribeLate = lifetime.subscribe(() => { late++; });
  unsubscribeLate(); unsubscribeLate();
  assert.equal(late, 1);
  imageAssertNoSemanticWitness(t, h);
  const fresh = imageLifetime(h);
  assert.equal(fresh.current(), true, "Disposal is local; it does not invalidate a new lifetime for unchanged inputs");
  fresh.dispose();
  imageAssertNoSemanticWitness(t, h);
});
test("native Image lifetime preserves completion hydration but retires supported authored ABA", OPTIONS, async t => {
  const h = await host(t), setup = imageSetup(h), evidence = imageEvidence(setup), lifetime = imageLifetime(h);
  let retirements = 0;
  lifetime.subscribe(() => { retirements++; });
  h.intercept = async request => {
    if (request.url.startsWith("/api/events?")) return Response.json({
      events: [...h.worker.events, ...evidence.events], head: 5, content: { "private-image-caption": "Hydrated caption" },
    });
  };
  await h.store.refreshEvents({ fromStart: true });
  assert.equal(h.store.documentGenerationRevision(), setup.documentRevision);
  assert.equal(lifetime.current(), true); assert.equal(retirements, 0);
  h.store.content.set({ ...h.store.content.get(), "private-image-caption": "Another private hydration" });
  h.store.head.set(6); h.store.notify();
  assert.equal(lifetime.current(), true, "Content and event head are not invented input revisions");
  imageAuthoredStage(h, "image-authored-aba");
  assert.equal(lifetime.current(), false); assert.equal(retirements, 1);
  h.store.discardOptimisticCanvasEvents(["image-authored-aba"]);
  assert.equal(h.store.documentGenerationRevision(), setup.documentRevision);
  assert.equal(lifetime.current(), false); assert.equal(retirements, 1);
  const fresh = imageLifetime(h);
  assert.equal(fresh.current(), true); fresh.dispose();
});

test("native Image standalone operations retain semantic ABA ownership without any UI lifetime", OPTIONS, async t => {
  for (const operation of ["submit", "inspect"]) {
    await t.test(operation, async child => {
      const h = await host(child), setup = imageSetup(h), gate = sceneDeferred(), entered = sceneDeferred();
      let pending;
      if (operation === "submit") {
        h.store.sceneGateForTest("append", { then(resolve, reject) { entered.resolve(); return gate.promise.then(resolve, reject); } });
        pending = h.store.submitNativeImage(setup, { current: () => true });
      } else {
        const job = imageJob(setup);
        h.intercept = async request => {
          entered.resolve(request); return gate.promise;
        };
        pending = h.store.inspectNativeImage(imageHandle(job), { current: () => true, signal: new AbortController().signal });
      }
      child.after(() => gate.resolve(operation === "submit" ? undefined : Response.json({ job: imageJob(setup) })));
      const entry = await Promise.race([entered.promise, pending.then(() => assert.fail("The operation completed before its owned wait"))]);
      if (operation === "inspect") assert.equal(entry.url, "/api/document-jobs/native-image-job?inspection=1");
      imageAuthoredStage(h, "image-operation-aba");
      h.store.discardOptimisticCanvasEvents(["image-operation-aba"]);
      assert.equal(h.store.documentGenerationRevision(), setup.documentRevision, "The exact inputs have returned before the operation resumes");
      gate.resolve(operation === "submit" ? undefined : Response.json({ job: imageJob(setup) }));
      assert.deepEqual(await pending, operation === "submit" ? notDispatched : IMAGE_SUPERSEDED);
      assert.equal(h.jobRequests().length, 0); assert.deepEqual(runnerRequests(h), []);
      imageAssertNoSemanticWitness(child, h);
    });
  }
});
test("native Image accepted Edit hands off before fencing while canceled Edit leaves the original lifetime current", OPTIONS, async t => {
  for (const outcome of ["accepted", "accepted-retired-in-handoff", "canceled"]) {
    await t.test(outcome, async child => {
      const h = await host(child), historyCalls = imageHistoryPort(child, h), lifetime = imageLifetime(h);
      const route = h.store.route.get(), events = h.store.events.get();
      const accepted = outcome !== "canceled";
      let handoffs = 0;
      await h.store.openDocument(DOCUMENT, "/studio/editor", "native-image", {
        current: () => lifetime.current(),
        onOriginHandoff: () => {
          handoffs++; assert.equal(lifetime.current(), true);
          if (outcome === "accepted-retired-in-handoff") lifetime.dispose();
          return accepted;
        },
      });
      assert.equal(handoffs, 1);
      assert.equal(h.store.route.get(), accepted ? withDocumentInRoute("/studio/editor", DOCUMENT, "Native story fixture") : route);
      assert.equal(lifetime.current(), !accepted);
      assert.equal(historyCalls.length, accepted ? 1 : 0);
      assert.equal(h.store.events.get(), events, "Same-Document Edit does not append an authored DocumentOpened event");
      assert.equal(h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST").length, 0);
      if (!accepted) lifetime.dispose();
    });
  }
});
const imageListRequests = h => h.requests.filter(request => /^\/api\/document-jobs(?:\?|$)/u.test(request.url)
  && (request.init.method ?? "GET") === "GET");
function imageListObserved(operation) {
  const observed = { initialOutcome: null, settledOutcome: null };
  const observe = (key, promise) => promise.then(value => (observed[key] = { status: "fulfilled", value }),
    reason => (observed[key] = { status: "rejected", reason }));
  return Object.assign(observed, { initial: observe("initialOutcome", operation.initial), settled: observe("settledOutcome", operation.settled) });
}
async function imageListReleased(...observers) {
  // Public operations have no cancellation port. Release supplied gates first,
  // then drain a bounded number of existing continuations. An orphaned claim
  // regression must fail its assertion, not deadlock the test's cleanup too.
  for (let turn = 0; turn < 120 && observers.some(observed => observed
    && (observed.initialOutcome === null || observed.settledOutcome === null)); turn++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}
function imageListNoWrites(h) {
  assert.deepEqual(h.requests.filter(request => ![undefined, "GET"].includes(request.init.method)), [],
    "The initial-read observer does not add submission, runner, recovery or acknowledgment POSTs");
}
test("native Image initial list read reserves one frozen operation before synchronous fetch reentry", OPTIONS, async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No external transport is permitted"));
  const gate = sceneDeferred();
  let reentered;
  const h = await createSceneStoreHost({ workerFixture: fixtureTransport(), exposeSceneTestAccessors: true,
    beforeFetch(input, init) {
      if (/^\/api\/document-jobs(?:\?|$)/u.test(String(input)) && (!init?.method || init.method === "GET")) {
        reentered = h.store.beginNativeImageInitialListRead();
      }
    } });
  t.after(() => h.close());
  h.store.route.set(withDocumentInRoute("/", DOCUMENT, "Native story fixture")); h.store.loading.set(false);
  h.intercept = request => {
    if (/^\/api\/document-jobs(?:\?|$)/u.test(request.url)) return gate.promise;
  };
  const operation = h.store.beginNativeImageInitialListRead(), observed = imageListObserved(operation);
  t.after(async () => { gate.resolve(Response.json({ jobs: [] })); await imageListReleased(observed); });
  assert.ok(Object.isFrozen(operation));
  assert.deepEqual(Object.keys(operation).sort(), ["initial", "settled"]);
  assert.equal(reentered, operation, "A synchronous fetch-port reentry joins the already-reserved actual pass");
  assert.equal(h.store.beginNativeImageInitialListRead(), operation);
  assert.equal(imageListRequests(h).length, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(observed.initialOutcome, null); assert.equal(observed.settledOutcome, null,
    "The explicit producer's physical channels remain pending until its response");
  gate.resolve(Response.json({ jobs: [] }));
  const initial = await observed.initial;
  assert.equal(initial.status, "fulfilled");
  assert.equal(initial.value.status, "published");
  assert.equal(initial.value.scope, "?document=" + encodeURIComponent(DOCUMENT));
  assert.ok(Object.isFrozen(initial.value)); assert.ok(Object.isFrozen(initial.value.intent));
  assert.equal(typeof initial.value.intent, "object"); assert.notEqual(initial.value.intent, null);
  assert.deepEqual(await observed.settled, { status: "fulfilled", value: undefined });
  assert.equal(imageListRequests(h).length, 1); imageListNoWrites(h);
});
test("native Image initial list read replaces only the latest undispatched navigation claim", OPTIONS, async t => {
  const h = await host(t), firstGate = sceneDeferred(), lastGate = sceneDeferred();
  imageHistoryPort(t, h);
  const origin = h.store.route.get(), middle = withDocumentInRoute("/studio/editor#initial-middle", DOCUMENT, "Native story fixture"),
    destination = withDocumentInRoute("/studio/editor#initial-last", DOCUMENT, "Native story fixture");
  let reads = 0, displacedObserved, latestObserved;
  h.intercept = request => {
    if (/^\/api\/document-jobs(?:\?|$)/u.test(request.url)) return ++reads === 1 ? firstGate.promise : lastGate.promise;
  };
  const first = h.store.beginNativeImageInitialListRead(), firstObserved = imageListObserved(first);
  t.after(async () => {
    firstGate.resolve(Response.json({ jobs: [] })); lastGate.resolve(Response.json({ jobs: [] }));
    await imageListReleased(firstObserved, displacedObserved, latestObserved);
  });
  h.store.setRoute(middle);
  const displaced = h.store.beginNativeImageInitialListRead(); displacedObserved = imageListObserved(displaced);
  assert.equal(h.store.beginNativeImageInitialListRead(), displaced, "The same pending intent joins its exact reserved handle");
  h.store.setRoute(destination);
  const latest = h.store.beginNativeImageInitialListRead(); latestObserved = imageListObserved(latest);
  assert.notEqual(origin, middle); assert.notEqual(first, displaced); assert.notEqual(displaced, latest);
  await untilScene(() => displacedObserved.initialOutcome !== null && displacedObserved.settledOutcome !== null,
    "A displaced undispatched claim receives both terminal outcomes");
  assert.deepEqual(await displacedObserved.initial, { status: "fulfilled", value: { status: "superseded", dispatched: false } });
  assert.deepEqual(await displacedObserved.settled, { status: "fulfilled", value: undefined });
  assert.equal(imageListRequests(h).length, 1, "Changing claims does not dispatch beside an active physical read");
  firstGate.resolve(Response.json({ jobs: [] }));
  assert.deepEqual(await firstObserved.initial, { status: "fulfilled", value: { status: "superseded", dispatched: true } });
  assert.deepEqual(await firstObserved.settled, { status: "fulfilled", value: undefined });
  await untilScene(() => imageListRequests(h).length === 2, "Only the latest undispatched claim is promoted");
  assert.equal(h.store.beginNativeImageInitialListRead(), latest, "Promotion keeps the claimant's original public handle");
  lastGate.resolve(Response.json({ jobs: [] }));
  assert.equal((await latestObserved.initial).value.status, "published");
  assert.deepEqual(await latestObserved.settled, { status: "fulfilled", value: undefined });
  assert.equal(imageListRequests(h).length, 2); imageListNoWrites(h);
});

test("native Image initial list read does not revive route A after a supported A to B to A transition", OPTIONS, async t => {
  const h = await host(t), firstGate = sceneDeferred(), returnGate = sceneDeferred();
  imageHistoryPort(t, h);
  const origin = h.store.route.get(), other = withDocumentInRoute("/studio/editor#initial-away", DOCUMENT, "Native story fixture");
  let reads = 0, returnedObserved;
  h.intercept = request => {
    if (/^\/api\/document-jobs(?:\?|$)/u.test(request.url)) return ++reads === 1 ? firstGate.promise : returnGate.promise;
  };
  const first = h.store.beginNativeImageInitialListRead(), firstObserved = imageListObserved(first);
  t.after(async () => {
    firstGate.resolve(Response.json({ jobs: [] })); returnGate.resolve(Response.json({ jobs: [] }));
    await imageListReleased(firstObserved, returnedObserved);
  });
  h.store.setRoute(other); h.store.setRoute(origin);
  const returned = h.store.beginNativeImageInitialListRead(); returnedObserved = imageListObserved(returned);
  assert.equal(h.store.route.get(), origin); assert.notEqual(returned, first);
  assert.equal(imageListRequests(h).length, 1);
  firstGate.resolve(Response.json({ jobs: [] }));
  assert.deepEqual(await firstObserved.initial, { status: "fulfilled", value: { status: "superseded", dispatched: true } });
  assert.deepEqual(await firstObserved.settled, { status: "fulfilled", value: undefined });
  await untilScene(() => imageListRequests(h).length === 2, "Returned A dispatches under a new navigation revision");
  returnGate.resolve(Response.json({ jobs: [] }));
  assert.equal((await returnedObserved.initial).value.status, "published");
  assert.deepEqual(await returnedObserved.settled, { status: "fulfilled", value: undefined });
  assert.equal(imageListRequests(h).length, 2); imageListNoWrites(h);
});
