import test from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENT_JOB_STALE_AFTER_MS,
  documentGenerationRequestKey,
  documentGenerationRevision,
  documentJobActionLabel,
  documentJobIsStale,
  documentJobMaxAttempts,
} from "../src/model/document-jobs.ts";

const job = (patch = {}) => ({
  jobId: "job-1",
  documentId: "doc-1",
  kind: "preview",
  status: "queued",
  sourceSurface: "studio",
  requestedSequence: 1,
  documentRevision: "rev-one",
  requestKey: "preview:rev-one",
  sourcePreviewId: null,
  result: null,
  error: null,
  attemptCount: 0,
  requestedAt: "2026-08-12T00:00:00.000Z",
  startedAt: null,
  completedAt: null,
  notifiedAt: null,
  leaseExpiresAt: null,
  updatedAt: "2026-08-12T00:00:00.000Z",
  stage: "queued",
  progressMessage: "",
  ...patch,
});

test("bounds automatic retries for costly image work and avoids replaying chat turns", () => {
  assert.equal(documentJobMaxAttempts("preview"), 2);
  assert.equal(documentJobMaxAttempts("generate"), 2);
  assert.equal(documentJobMaxAttempts("extract_reference"), 2);
  assert.equal(documentJobMaxAttempts("chat"), 1);
  assert.equal(documentJobMaxAttempts("structure_adaptive"), 1);
});

test("recognizes expired leases and missing heartbeats without treating queued work as stale", () => {
  const now = Date.parse("2026-08-12T00:02:00.000Z");
  assert.equal(documentJobIsStale(job({ status: "queued" }), now), false);
  assert.equal(documentJobIsStale(job({ status: "running", leaseExpiresAt: "2026-08-12T00:01:59.000Z", updatedAt: "2026-08-12T00:01:50.000Z" }), now), true);
  assert.equal(documentJobIsStale(job({ status: "running", leaseExpiresAt: "2026-08-12T00:03:00.000Z", updatedAt: new Date(now - DOCUMENT_JOB_STALE_AFTER_MS - 1).toISOString() }), now), true);
  assert.equal(documentJobIsStale(job({ status: "running", leaseExpiresAt: "2026-08-12T00:03:00.000Z", updatedAt: "2026-08-12T00:01:50.000Z" }), now), false);
});

test("reports queued and running stages truthfully", () => {
  assert.equal(documentJobActionLabel(job(), "preview"), "Draft queued…");
  assert.equal(documentJobActionLabel(job({ kind: "generate" }), "generate", true), "Full queued behind draft…");
  assert.equal(documentJobActionLabel(job({ status: "running", stage: "preparing" }), "preview"), "Draft preparing…");
  assert.equal(documentJobActionLabel(job({ status: "running", stage: "rendering" }), "preview"), "Draft rendering…");
  assert.equal(documentJobActionLabel(job({ kind: "generate", status: "running", stage: "rendering" }), "generate"), "Rendering full image…");
});

test("identifies the exact document state independently of object key order", () => {
  const first = { documentId: "doc-1", snapshot: { facts: [{ block_id: "b1", properties: { weight: .5, text: "Quiet light" } }], pins: [] }, sourceBlockVersions: [{ block_id: "b1", version: 2 }] };
  const reordered = { sourceBlockVersions: [{ version: 2, block_id: "b1" }], snapshot: { pins: [], facts: [{ properties: { text: "Quiet light", weight: .5 }, block_id: "b1" }] }, documentId: "doc-1" };
  const changed = { ...first, sourceBlockVersions: [{ block_id: "b1", version: 3 }] };
  assert.equal(documentGenerationRevision(first), documentGenerationRevision(reordered));
  assert.notEqual(documentGenerationRevision(first), documentGenerationRevision(changed));
});

test("distinguishes updated draft work and full generations promoted from different drafts", () => {
  assert.equal(documentGenerationRequestKey("preview", "rev-one"), "preview:rev-one");
  assert.notEqual(documentGenerationRequestKey("preview", "rev-one"), documentGenerationRequestKey("preview", "rev-two"));
  assert.notEqual(documentGenerationRequestKey("generate", "rev-one", "draft-a"), documentGenerationRequestKey("generate", "rev-one", "draft-b"));
  assert.equal(documentGenerationRequestKey("generate", "rev-one"), "generate:rev-one:document");
});
