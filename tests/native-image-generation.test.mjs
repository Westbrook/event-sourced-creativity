import assert from "node:assert/strict";
import test from "node:test";
import {
  captureNativeImageSetup, captureNativeImageHandle, captureNativeImageSubmission,
  captureNativeImageRead, joinNativeImageCompletion, nativeImageInspectionPath,
} from "../src/model/native-image-generation.ts";

// Newly reconstructed pure controls, not recovered I1 test bodies. The fixture
// follows the surviving launcher and Store contracts; it proves no media bytes,
// provider execution, application authorization, browser behavior or generation.
const NOW = Date.parse("2099-09-09T12:00:00.000Z");
const AT = "2099-09-09T12:00:00.000Z", EXPIRES = "2099-09-09T12:05:00.000Z";
const UNCONFIRMED = { disposition: "dispatched-unconfirmed", handle: null };
const UNAVAILABLE = { status: "unavailable" }, SUPERSEDED = { status: "superseded" };
function fixture() {
  const setup = { documentId: "document-a", documentRevision: "rev-abc123", sourceSurface: "native-image",
    promptTechnique: "prose", kind: "generate", productionMode: "manual", sourcePreviewId: null,
    requestKey: "generate:rev-abc123:document" };
  const mediaUrl = "/api/media/u-757365722d31%2Fgenerated%2Fgeneration-a.png";
  const job = { ...setup, jobId: "job-a", requestedSequence: 42, status: "completed",
    canvasId: null, promptFanId: null, parentJobId: null, fanKind: null, members: [],
    result: { head: 49, appendedEventIds: ["event-a"], promoted: false },
    error: null, errorDetail: null, moderationPromptRef: null, dismissedAt: null,
    attemptCount: 1, requestedAt: AT, startedAt: AT, completedAt: AT, notifiedAt: null,
    leaseExpiresAt: null, updatedAt: AT, stage: "completed", progressMessage: "" };
  const event = { eventId: "event-a", streamId: "creative:user-1", sequence: 48,
    occurredAt: AT, recordedAt: AT, actor: "worker:generator", clientId: "server:document-job:generate",
    correlationId: "private-correlation-not-job-id", causationId: "compiled-original",
    compensatesEventId: null, schemaVersion: 1, type: "GenerationCompleted",
    payload: { document_id: setup.documentId, generation_id: "generation-a", object_id: "output-a", object_ids: ["output-a"],
      model_id: "gpt-image-2", provider: "openai", source_surface: "native-image", prompt_technique: "prose",
      media_url: mediaUrl, media_type: "image/png", source_content_hash: "a".repeat(64),
      image_width: 1536, image_height: 1024, quality: "high", purpose: "final", simulation: false,
      canvas_id: null, context_set_id: null, prompt_fan_id: null, promotion_id: null,
      reference_preview_event_id: null, promoted_from_generation_id: null, promoted_from_object_id: null,
      promotion_outcome: null, used_ideation_preview_pixels: false, content_expires_at: EXPIRES } };
  const output = { id: "output-a", documentId: setup.documentId, generationId: "generation-a", sourceEventId: event.eventId,
    canvasId: null, contextSetId: null, modelId: "gpt-image-2", provider: "openai", variant: 0,
    latency: 1, sequence: event.sequence, pinned: false, saved: false, discarded: false, library: false,
    contentRef: null, promptRef: null, promptTechnique: "prose", promptFanId: null,
    mediaUrl, mediaType: "image/png", width: 1536, height: 1024, plannerModelId: null,
    quality: "high", purpose: "final", sourceSurface: "native-image", promotionId: null,
    promotedFromId: null, promotedFromEventId: null, focalPoint: null, standalone: true, standaloneSequence: event.sequence };
  const compiled = { ...event, eventId: "compiled-original", sequence: 47, type: "ContextCompiled",
    payload: { document_id: setup.documentId, generation_id: "generation-a", compiled_snapshot: { document: { id: setup.documentId } } } };
  const handle = captureNativeImageHandle(job, setup);
  assert.ok(handle, "the independently authored valid fixture captures a real model identity");
  return { setup, job, event, output, compiled, handle, data: { inspection: { job }, events: [event], outputs: [output] } };
}

test("reconstructed Image captures exact manual setup and private-free immutable handle", () => {
  const f = fixture(), setup = captureNativeImageSetup(f.setup), handle = captureNativeImageHandle(f.job);
  assert.deepEqual(setup, f.setup); assert.notEqual(setup, f.setup); assert.ok(Object.isFrozen(setup));
  assert.deepEqual(handle, f.handle); assert.ok(Object.isFrozen(handle));
  for (const key of Object.keys(f.setup)) assert.equal(handle[key], f.setup[key]);
  assert.equal(handle.jobId, f.job.jobId); assert.equal(handle.requestedSequence, 42);
  for (const key of ["result", "error", "errorDetail", "moderationPromptRef"]) assert.equal(Object.hasOwn(handle, key), false);
  assert.equal(nativeImageInspectionPath(handle), "/api/document-jobs/job-a?inspection=1");
  for (const change of [{ productionMode: "managed" }, { sourceSurface: "canvas" }, { kind: "edit" },
    { sourcePreviewId: "preview-a" }, { documentRevision: "" }, { requestKey: "wrong-request" }]) {
    assert.equal(captureNativeImageSetup({ ...f.setup, ...change }), null);
  }
  for (const change of [{ documentId: "document-b" }, { documentRevision: "rev-other" },
    { requestKey: "another-request" }, { promptTechnique: "xml" }, { requestedSequence: -1 }]) {
    assert.equal(captureNativeImageHandle({ ...f.job, ...change }, f.setup), null);
  }
  f.job.documentId = "later-document"; assert.equal(handle.documentId, "document-a");
});

test("reconstructed Image submission preserves exact acknowledgments and only known pre-dispatch refusals", () => {
  const f = fixture();
  for (const reused of [false, true]) {
    const result = captureNativeImageSubmission({ disposition: "acknowledged", handle: f.handle, reused }, f.setup);
    assert.deepEqual(result, { disposition: "acknowledged", handle: f.handle, reused });
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.handle));
  }
  for (const reason of ["unavailable", "budget-blocked", "user-canceled"])
    assert.deepEqual(captureNativeImageSubmission({ disposition: "not-dispatched", handle: null, reason }, f.setup),
      { disposition: "not-dispatched", handle: null, reason });
  for (const value of [null, {}, { disposition: "acknowledged", handle: f.handle, reused: "false" },
    { disposition: "acknowledged", handle: { ...f.handle, documentRevision: "rev-other" }, reused: false },
    { disposition: "not-dispatched", handle: null, reason: "try-again" },
    { disposition: "not-dispatched", handle: f.handle, reason: "unavailable" }])
    assert.deepEqual(captureNativeImageSubmission(value, f.setup), UNCONFIRMED);
});

test("reconstructed Image read snapshots own data without getters or unbounded retention", () => {
  const f = fixture(), raw = { status: "data", data: f.data }, captured = captureNativeImageRead(raw, () => true);
  assert.equal(captured.status, "data"); assert.deepEqual(captured.data, f.data);
  assert.notEqual(captured.data, f.data); assert.ok(Object.isFrozen(captured.data));
  assert.ok(Object.isFrozen(captured.data.events)); assert.ok(Object.isFrozen(captured.data.events[0].payload));
  f.event.payload.object_id = "later-output"; assert.equal(captured.data.events[0].payload.object_id, "output-a");
  let getterCalls = 0;
  const accessor = { status: "data" };
  Object.defineProperty(accessor, "data", { enumerable: true, get() { getterCalls++; return f.data; } });
  assert.deepEqual(captureNativeImageRead(accessor, () => true), UNAVAILABLE); assert.equal(getterCalls, 0);
  const nested = fixture();
  Object.defineProperty(nested.output, "title", { enumerable: true, get() { getterCalls++; return "private"; } });
  assert.deepEqual(captureNativeImageRead({ status: "data", data: nested.data }, () => true), UNAVAILABLE);
  assert.equal(getterCalls, 0);
  const cyclic = fixture(); cyclic.data.cycle = cyclic.data;
  assert.deepEqual(captureNativeImageRead({ status: "data", data: cyclic.data }, () => true), UNAVAILABLE);
  const bounded = fixture(); bounded.event.payload.additionalPrivate = "Retained fixture detail.";
  assert.equal(captureNativeImageRead({ status: "data", data: bounded.data }, () => true).status, "data",
    "the extension field is valid before its serialized size exceeds the cap");
  for (const additionalPrivate of ["x".repeat(1_048_577), "\n".repeat(524_289)]) {
    const oversized = fixture(); oversized.event.payload.additionalPrivate = additionalPrivate;
    assert.deepEqual(captureNativeImageRead({ status: "data", data: oversized.data }, () => true), UNAVAILABLE,
      "the byte cap includes JSON escapes inside a valid retained payload field");
  }
  assert.deepEqual(captureNativeImageRead(UNAVAILABLE, () => true), UNAVAILABLE);
  assert.deepEqual(captureNativeImageRead(SUPERSEDED, () => true), SUPERSEDED);
});

test("reconstructed Image read and join honor withdrawal and preserve throwing guards", () => {
  const f = fixture();
  assert.deepEqual(captureNativeImageRead({ status: "data", data: f.data }, () => false), SUPERSEDED);
  assert.deepEqual(joinNativeImageCompletion(f.handle, f.data, () => false, NOW), SUPERSEDED);
  for (const failure of [new Error("current guard failed"), undefined]) {
    for (const call of [() => captureNativeImageRead({ status: "data", data: f.data }, () => { throw failure; }),
      () => joinNativeImageCompletion(f.handle, f.data, () => { throw failure; }, NOW)]) {
      let threw = false;
      try { call(); } catch (error) { threw = true; assert.equal(error, failure); }
      assert.equal(threw, true, "even a thrown undefined is preserved, not normalized into retry evidence");
    }
  }
  for (const operation of ["read", "join"]) {
    const next = fixture(); let current = true, traps = 0;
    const proxy = new Proxy(next.data, { ownKeys(target) { traps++; current = false; return Reflect.ownKeys(target); } });
    const result = operation === "read" ? captureNativeImageRead({ status: "data", data: proxy }, () => current)
      : joinNativeImageCompletion(next.handle, proxy, () => current, NOW);
    assert.ok(traps > 0, "the synchronous ownership withdrawal really occurred during snapshot capture");
    assert.deepEqual(result, SUPERSEDED);
  }
});

test("reconstructed Image joins one exact confirmed completion with optional compiled evidence", () => {
  for (const withCompiled of [false, true]) {
    const f = fixture();
    if (withCompiled) { f.data.events.unshift(f.compiled); f.job.result.appendedEventIds.unshift(f.compiled.eventId); }
    const result = joinNativeImageCompletion(f.handle, f.data, () => true, NOW);
    assert.equal(result.status, "matched");
    const image = result.image;
    assert.deepEqual([image.id, image.documentId, image.jobId, image.sourceEventId, image.generationId],
      ["output-a", "document-a", "job-a", "event-a", "generation-a"]);
    assert.deepEqual([image.mediaUrl, image.mediaType, image.width, image.height, image.title],
      [f.output.mediaUrl, "image/png", 1536, 1024, null]);
    assert.deepEqual([image.ownerId, image.sourceContentHash, image.expiresAt], ["user-1", "a".repeat(64), EXPIRES]);
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(image));
    f.output.mediaUrl = "/api/media/replacement.png"; assert.notEqual(image.mediaUrl, f.output.mediaUrl);
  }
});

test("reconstructed Image pending and failed inspections never expose an image", () => {
  for (const [status, expected] of [["queued", "pending"], ["running", "pending"], ["committing", "pending"],
    ["failed", "terminal"], ["partial", "terminal"], ["canceled", "terminal"]]) {
    const f = fixture();
    Object.assign(f.job, { status, stage: status, result: null, completedAt: expected === "terminal" ? AT : null });
    if (status === "queued") f.job.startedAt = null;
    f.data.events = []; f.data.outputs = [];
    const result = joinNativeImageCompletion(f.handle, f.data, () => true, NOW);
    assert.equal(result.status, expected); assert.equal(Object.hasOwn(result, "image"), false);
  }
});

test("reconstructed Image refuses ambiguous references and folded aliases without trimming evidence", () => {
  const mutations = [
    ["unreferenced completion", f => f.data.events.push({ ...f.event, eventId: "alias-event", sequence: 49,
      payload: { ...f.event.payload, object_id: "alias-output", object_ids: ["alias-output"] } })],
    ["referenced preview alias", f => {
      f.data.events.push({ ...f.event, eventId: "preview-alias-event", sequence: 49, type: "IdeationPreviewCompleted" });
      f.job.result.appendedEventIds.push("preview-alias-event");
    }],
    ["duplicate event id", f => f.data.events.push({ ...f.compiled, eventId: f.event.eventId, sequence: 49 })],
    ["duplicate sequence", f => { f.data.events.push({ ...f.compiled, sequence: f.event.sequence }); f.job.result.appendedEventIds.push(f.compiled.eventId); }],
    ["missing referenced event", f => f.job.result.appendedEventIds.push("missing-event")],
    ["oversized references", f => { f.job.result.appendedEventIds.push(...Array.from({ length: 65 }, (_, i) => "reference-" + i)); }],
    ["duplicate folded output", f => f.data.outputs.push({ ...f.output })],
    ["folded alias", f => f.data.outputs.push({ ...f.output, id: "alias-output" })],
  ];
  for (const [label, mutate] of mutations) {
    const f = fixture(); mutate(f);
    assert.deepEqual(joinNativeImageCompletion(f.handle, f.data, () => true, NOW), UNAVAILABLE, label);
  }
});

test("reconstructed Image refuses mismatched source, owner, media and nonfinal results", () => {
  const mutations = [
    ["job revision", f => { f.job.documentRevision = "rev-other"; }],
    ["job request key", f => { f.job.requestKey = "wrong-request"; }],
    ["completion Document", f => { f.event.payload.document_id = "document-b"; }],
    ["folded generation", f => { f.output.generationId = "another-generation"; }],
    ["folded source event", f => { f.output.sourceEventId = "another-event"; }],
    ["wrong owner namespace", f => { f.output.mediaUrl = f.event.payload.media_url = "/api/media/u-757365722d32%2Fgenerated%2Fgeneration-a.png"; }],
    ["provider URL", f => { f.output.mediaUrl = f.event.payload.media_url = "https://provider.invalid/output.png"; }],
    ["wrong source surface", f => { f.output.sourceSurface = f.event.payload.source_surface = "canvas"; }],
    ["missing model identity pair", f => { delete f.event.payload.model_id; delete f.output.modelId; }],
    ["wrong media type", f => { f.output.mediaType = f.event.payload.media_type = "text/html"; }],
    ["folded dimensions", f => { f.output.width = 800; }],
    ["malformed source hash", f => { f.event.payload.source_content_hash = "not-a-hash"; }],
    ["simulation", f => { f.event.payload.simulation = true; }],
    ["preview", f => { f.output.purpose = f.event.payload.purpose = "preview"; }],
    ["preview pixels", f => { f.event.payload.used_ideation_preview_pixels = true; }],
    ["promoted job", f => { f.job.result.promoted = true; }],
    ["promoted completion", f => { f.event.payload.promotion_id = "promotion-a"; }],
    ["incoherent correlation", f => { f.data.events.unshift({ ...f.compiled, correlationId: "another-correlation" }); f.job.result.appendedEventIds.unshift(f.compiled.eventId); }],
    ["expired", f => { f.event.payload.content_expires_at = "2099-09-09T11:59:59.999Z"; }],
  ];
  for (const [label, mutate] of mutations) {
    const f = fixture(); mutate(f);
    assert.deepEqual(joinNativeImageCompletion(f.handle, f.data, () => true, NOW), UNAVAILABLE, label);
  }
  for (const now of [NaN, Infinity, -Infinity]) {
    const f = fixture(); assert.deepEqual(joinNativeImageCompletion(f.handle, f.data, () => true, now), UNAVAILABLE);
  }
});
