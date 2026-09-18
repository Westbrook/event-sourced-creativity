import assert from "node:assert/strict";
import test from "node:test";
import { captureExperienceNativeResult } from "../src/experiences/native-result-association.ts";
import type { ExperienceResultIdentity } from "../src/experiences/native-result-association.ts";

type Row = Record<string, unknown>;
const now = Date.parse("2026-09-12T12:00:00.000Z");

// Synthetic plain-data witnesses only. Production identity must come from the
// same fresh authorized server binding, including guarded original correlation
// and job expiry, never a UI-created identity or the grant's expiry. Canonical
// passive-job JSON has no independent correlation/expiry fields to compare.
// These tests neither establish authority nor replace canonical private readers,
// source validation, media availability, quality checks, or end-to-end evidence.
function fixture(output: "image" | "slides" = "image") {
  const identity: ExperienceResultIdentity = {
    output, documentId: "document-original", projectId: "project-original", ownerUserId: "owner-original",
    jobId: "job-original", correlationId: "correlation-original", expiresAt: "2026-09-12T13:00:00.000Z",
  };
  const result: Row = {
    appendedEventIds: ["completion-original"],
    ...(output === "slides" ? { artifactId: "artifact-original", artifactKind: "slides" } : {}),
  };
  const job: Row = {
    jobId: identity.jobId, documentId: identity.documentId, sourceSurface: "outputs", status: "completed",
    kind: output === "image" ? "generate" : "render_document", result,
  };
  const payload: Row = {
    document_id: identity.documentId, source_surface: "outputs",
    ...(output === "image" ? {
      // The real personal Image producer omits project_id. Current Document
      // custody plus the canonical private image reader remain required.
      object_ids: ["output-original"], generation_id: "generation-original", output_ref: "content-image",
      media_url: "/synthetic-private-media/content-image", simulation: false,
    } : {
      project_id: identity.projectId, artifact_id: "artifact-original", content_ref: "content-slides",
      artifact_kind: "slides", item_count: 5, requested_by_user_id: identity.ownerUserId,
    }),
  };
  const event: Row = {
    eventId: "completion-original", correlationId: identity.correlationId, streamId: `creative:${identity.ownerUserId}`,
    type: output === "image" ? "GenerationCompleted" : "DocumentRenderCompleted",
    actor: output === "image" ? "worker:generator" : "worker:renderer", payload,
  };
  const record: Row = output === "image" ? {
    id: "output-original", documentId: identity.documentId, discarded: false, sourceEventId: event.eventId,
    sourceSurface: "outputs", generationId: "generation-original", contentRef: "content-image", mediaUrl: payload.media_url,
  } : {
    id: "artifact-original", documentId: identity.documentId, kind: "slides", itemCount: 5,
    sourceEventId: event.eventId, sourceSurface: "outputs", contentRef: "content-slides",
  };
  const current = {
    documentId: identity.documentId, projectId: identity.projectId,
    documents: [{ id: identity.documentId, projectId: identity.projectId, removed: false }] as Row[],
    events: [event], outputs: output === "image" ? [record] : [], artifacts: output === "slides" ? [record] : [],
  };
  return { identity, job, result, payload, event, record, current };
}

test("captures the exact personal Image candidate without inventing project event metadata", () => {
  const f = fixture("image");
  assert.equal(Object.hasOwn(f.payload, "project_id"), false);
  const candidate = captureExperienceNativeResult(f.identity, f.job, f.current, now);
  assert.deepEqual(candidate, {
    output: "image", documentId: f.identity.documentId, projectId: f.identity.projectId, jobId: "job-original",
    eventId: "completion-original", outputId: "output-original", generationId: "generation-original",
    contentRef: "content-image", mediaUrl: "/synthetic-private-media/content-image", expiresAt: f.identity.expiresAt,
  });
  assert.ok(candidate && Object.isFrozen(candidate));
});

test("captures the exact five-slide artifact candidate", () => {
  const f = fixture("slides");
  const candidate = captureExperienceNativeResult(f.identity, f.job, f.current, now);
  assert.deepEqual(candidate, {
    output: "slides", documentId: f.identity.documentId, projectId: f.identity.projectId, jobId: "job-original",
    eventId: "completion-original", artifactId: "artifact-original", contentRef: "content-slides", expiresAt: f.identity.expiresAt,
  });
  assert.ok(candidate && Object.isFrozen(candidate));
});

test("requires a current canonical identity expiry and valid opaque identifiers", () => {
  const f = fixture();
  for (const expiresAt of ["2026-09-12T11:59:59.999Z", "2026-09-12T12:00:00.000Z", "invalid", "2026-09-12T13:00:00Z", "2026-09-12T13:00:00.000+00:00"]) {
    assert.equal(captureExperienceNativeResult({ ...f.identity, expiresAt }, f.job, f.current, now), null, expiresAt);
  }
  for (const key of ["documentId", "projectId", "ownerUserId", "jobId", "correlationId"] as const) {
    assert.equal(captureExperienceNativeResult({ ...f.identity, [key]: "invalid/id" }, f.job, f.current, now), null, key);
  }
  assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, NaN), null);
  assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, Infinity), null);
});

test("rejects changed job identity, source surface, kind, disposition or result", () => {
  for (const [key, value] of [
    ["jobId", "other-job"], ["documentId", "other-document"], ["sourceSurface", "document"],
    ["kind", "preview"], ["status", "running"], ["result", null],
  ] as const) {
    const f = fixture();
    f.job[key] = value;
    assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, now), null, key);
  }
});

test("rejects changed selection and foreign, removed, missing or duplicate current Document", () => {
  const f = fixture();
  for (const key of ["documentId", "projectId"] as const) {
    assert.equal(captureExperienceNativeResult(f.identity, f.job, { ...f.current, [key]: "other" }, now), null, key);
  }
  for (const documents of [
    [], [...f.current.documents, f.current.documents[0]!],
    [{ ...f.current.documents[0], projectId: "foreign-project" }], [{ ...f.current.documents[0], removed: true }],
  ]) assert.equal(captureExperienceNativeResult(f.identity, f.job, { ...f.current, documents }, now), null);
});

test("requires one exact completion rather than an absent, duplicate or unrelated event", () => {
  for (const output of ["image", "slides"] as const) {
    const f = fixture(output);
    for (const events of [
      [], [f.event, { ...f.event, eventId: "duplicate-completion" }],
      [{ ...f.event, correlationId: "foreign-correlation" }], [{ ...f.event, type: "OtherCompleted" }],
    ]) assert.equal(captureExperienceNativeResult(f.identity, f.job, { ...f.current, events }, now), null, output);
  }
});

test("requires the exact completion ID in the original passive job's appended IDs", () => {
  for (const appendedEventIds of [undefined, [], ["later-completion"], ["completion-original", "bad/id"], "completion-original"]) {
    const f = fixture();
    f.result.appendedEventIds = appendedEventIds;
    assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, now), null);
  }
});

test("rejects changed completion ownership and source provenance", () => {
  for (const [key, value] of [["streamId", "creative:foreign-owner"], ["actor", "user"], ["eventId", "replacement-event"]] as const) {
    const f = fixture();
    f.event[key] = value;
    assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, now), null, key);
  }
  for (const [key, value] of [["document_id", "foreign-document"], ["project_id", "foreign-project"], ["source_surface", "document"]] as const) {
    const f = fixture();
    f.payload[key] = value;
    assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, now), null, key);
  }
  const image = fixture();
  image.payload.project_id = image.identity.projectId;
  assert.ok(captureExperienceNativeResult(image.identity, image.job, image.current, now));
  const slides = fixture("slides");
  delete slides.payload.project_id;
  assert.equal(captureExperienceNativeResult(slides.identity, slides.job, slides.current, now), null);
});

test("requires one non-simulation Image identity with consistent generation and media references", () => {
  for (const [key, value] of [
    ["object_ids", []], ["object_ids", ["output-original", "output-other"]], ["object_ids", ["output-other"]],
    ["generation_id", "other-generation"], ["output_ref", "other-content"], ["media_url", "/other-media"],
    ["simulation", true], ["simulation", undefined],
  ] as const) {
    const f = fixture();
    f.payload[key] = value;
    assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, now), null, key);
  }
});

test("rejects missing, duplicated, foreign, discarded or changed Image projections", () => {
  const original = fixture();
  for (const outputs of [[], [original.record, original.record]]) {
    assert.equal(captureExperienceNativeResult(original.identity, original.job, { ...original.current, outputs }, now), null);
  }
  for (const [key, value] of [
    ["documentId", "foreign-document"], ["discarded", true], ["sourceEventId", "other-event"],
    ["sourceSurface", "document"], ["generationId", "other-generation"], ["contentRef", "other-content"],
    ["mediaUrl", "/other-media"], ["imageRevision", "edited-revision"],
  ] as const) {
    const f = fixture();
    f.record[key] = value;
    assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, now), null, key);
  }
});

test("requires exactly five Slides and original artifact kind, requester and job association", () => {
  for (const [key, value] of [
    ["item_count", 4], ["item_count", 6], ["item_count", "5"], ["artifact_kind", "scene"],
    ["requested_by_user_id", "foreign-owner"], ["artifact_id", "other-artifact"], ["content_ref", "other-content"],
  ] as const) {
    const f = fixture("slides");
    f.payload[key] = value;
    assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, now), null, key);
  }
  for (const [key, value] of [["artifactId", "other-artifact"], ["artifactKind", "scene"]] as const) {
    const f = fixture("slides");
    f.result[key] = value;
    assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, now), null, key);
  }
});

test("rejects missing, duplicated, foreign or changed Slides artifact projections", () => {
  const original = fixture("slides");
  for (const artifacts of [[], [original.record, original.record]]) {
    assert.equal(captureExperienceNativeResult(original.identity, original.job, { ...original.current, artifacts }, now), null);
  }
  for (const [key, value] of [
    ["documentId", "foreign-document"], ["kind", "scene"], ["itemCount", 4],
    ["sourceEventId", "other-event"], ["sourceSurface", "document"], ["contentRef", "other-content"],
  ] as const) {
    const f = fixture("slides");
    f.record[key] = value;
    assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, now), null, key);
  }
});

test("rejects edited original Image or artifact while ignoring unrelated edit events", () => {
  for (const payload of [{ output_id: "output-original" }, { object_id: "output-original" }]) {
    const f = fixture();
    f.current.events.push({ type: "GeneratedImageEdited", payload });
    assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, now), null);
  }
  const slides = fixture("slides");
  slides.current.events.push({ type: "DocumentArtifactEdited", payload: { artifact_id: "artifact-original" } });
  assert.equal(captureExperienceNativeResult(slides.identity, slides.job, slides.current, now), null);
  for (const output of ["image", "slides"] as const) {
    const f = fixture(output);
    f.current.events.push({ type: "GeneratedImageEdited", payload: { output_id: "unrelated-output" } });
    f.current.events.push({ type: "DocumentArtifactEdited", payload: { artifact_id: "unrelated-artifact" } });
    assert.ok(captureExperienceNativeResult(f.identity, f.job, f.current, now));
  }
});

test("never falls back to the newest completion or projected result", () => {
  for (const output of ["image", "slides"] as const) {
    const f = fixture(output);
    const newerEvent = { ...f.event, eventId: "completion-newer", correlationId: "correlation-newer" };
    f.current.events.unshift(newerEvent);
    const records = output === "image" ? f.current.outputs : f.current.artifacts;
    records.unshift({ ...f.record, id: "result-newer", sourceEventId: "completion-newer" });
    const candidate = captureExperienceNativeResult(f.identity, f.job, f.current, now);
    assert.equal(candidate?.eventId, "completion-original", output);
    f.current.events = [newerEvent];
    assert.equal(captureExperienceNativeResult(f.identity, f.job, f.current, now), null, output);
  }
});

test("candidate capture is detached and does not mutate the supplied witness", () => {
  const f = fixture();
  const before = JSON.stringify(f);
  const candidate = captureExperienceNativeResult(f.identity, f.job, f.current, now);
  assert.equal(JSON.stringify(f), before);
  f.payload.output_ref = "replacement-content";
  f.record.contentRef = "replacement-content";
  f.event.eventId = "replacement-event";
  assert.equal(candidate?.contentRef, "content-image");
  assert.equal(candidate?.eventId, "completion-original");
});
