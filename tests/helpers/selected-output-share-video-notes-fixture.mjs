import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerOutputSourceImports } from "../output-server-test-helpers.mjs";
import { originalOutputsMediaFixture } from "./selected-output-share-media-outputs-fixture.mjs";
import { recoveredOutputsMediaFixture } from "./selected-output-share-media-recovery-fixture.mjs";
import { qualifiedOriginalOutputsVideoFixture } from "./selected-output-share-video-notes-qualified-donor.mjs";

const imports = registerOutputSourceImports();
let handleArtifactEdit, inspectVideoPrefix, trimVideoPrefix, readNativeRetainedMediaCustody;
try {
  ({ handleArtifactEdit } = await import("../../worker/artifact-api.ts"));
  ({ inspectVideoPrefix, trimVideoPrefix } = await import("../../src/model/video-container.ts"));
  ({ readNativeRetainedMediaCustody } = await import("../../worker/native-retained-media-custody.ts"));
} finally { imports.deregister(); }
const hash = value => createHash("sha256").update(value).digest("hex");

// Terminal recovery state only; mirrors the existing completed recovery
// fixture for the new qualified donor. No lease or recovery operation executes.
function recoveredQualifiedVideo(f, options) {
  const evidenceMode = options.evidenceMode ?? "original", completion = options.completion ?? "new";
  assert.ok(["original", "retrieved"].includes(evidenceMode)); assert.ok(["new", "existing"].includes(completion));
  const before = JSON.parse(f.sqlite.prepare("SELECT result_json FROM document_jobs WHERE job_id=?").get(f.jobId).result_json);
  const paid = Object.values(before.providerSubmissions).find(call => call.provider === "fal"); assert.ok(paid);
  const media = before.outputVideoMediaResult, token = "11111111-2222-4333-8444-555555555555", evidenceToken = "66666666-7777-4888-8999-aaaaaaaaaaaa";
  const recovery = { version: "output-video-recovery-v1", token, expiresAt: "2020-01-01T00:00:00.000Z", evidenceMode,
    ...(evidenceMode === "retrieved" ? { evidenceToken } : {}), storageKey: decodeURIComponent(media.mediaUrl.slice("/api/media/".length)),
    providerRequestId: paid.providerRequestId, clientRequestId: paid.clientRequestId, requestDigest: media.requestDigest,
    priorStatus: "failed", priorErrorCode: "local_persistence_failed", priorCompletedAt: "2020-01-01T00:00:00.000Z",
    status: "completed", completionEventId: f.completed.eventId };
  const patch = { outputVideoRecovery: recovery };
  if (evidenceMode === "retrieved") {
    patch.outputVideoRecoveryEnvelopes = before.outputVideoMediaEnvelopes.filter(envelope => ["status", "result"].includes(envelope.phase)).map(saved => {
      const original = f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(saved.responseRef);
      const responseRef = `recovery-video-notes-${saved.phase}`;
      f.insert("private_content", { ...original, content_id: responseRef });
      return { version: "output-video-recovery-envelope-v1", token: evidenceToken, phase: saved.phase, responseRef,
        envelopeSha256: hash(original.content), decodedBodySha256: saved.decodedBodySha256, expiresAt: original.expires_at };
    });
    assert.equal(patch.outputVideoRecoveryEnvelopes.length, 2);
  }
  const terminal = { ...before, ...patch, stage: "completed", appendedEventIds: [f.completed.eventId],
    generationReceipt: { ...(before.generationReceipt ?? {}), provider_request_status: "completed" } };
  delete terminal.errorDetail;
  f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(terminal), f.jobId);
  return { ...f, recovery, recoveryKey: "outputVideoRecovery", recoveryOptions: { completion, evidenceMode } };
}

/** Synthetic Outputs receipts plus the actual Artifact editor and retention
 * transaction. No positive edit/restore event or historical snapshot is seeded
 * by hand. Setup copies the already retained local donor once; custody reads
 * are separately counted. This is not a live provider or playback exercise. */
export async function videoNotesFixture(t, options = {}) {
  let f;
  if (options.qualifiedBytes === true) {
    f = await qualifiedOriginalOutputsVideoFixture(t, options.recovered === true && (options.completion ?? "new") === "new"
      ? { ...options, completionClientId: "output-video-recovery", completionPayload: { recovered: true } } : options);
    if (options.recovered === true) f = recoveredQualifiedVideo(f, options);
  } else f = options.recovered === true
    ? await recoveredOutputsMediaFixture(t, "video", options) : await originalOutputsMediaFixture(t, "video", options);
  const originalSelection = { ...f.selection }, originalKey = decodeURIComponent(f.originalUrl.slice("/api/media/".length));
  const original = await f.env.MEDIA.get(originalKey);
  assert.ok(original);
  const originalBytes = new Uint8Array(await new Response(original.body).arrayBuffer());
  assert.deepEqual(originalBytes, f.expectedBytes);
  const metadataHeaders = new Headers(); original.writeHttpMetadata(metadataHeaders);
  f.media.set(originalKey, { bytes: originalBytes, metadata: structuredClone(original.customMetadata), contentType: metadataHeaders.get("content-type") });
  const setupGets = f.stats.gets; f.stats.gets = 0;
  const editorStats = { gets: 0, puts: 0, deletes: 0 };
  const get = async key => {
    const item = f.media.get(key);
    return item ? { body: new Blob([item.bytes]).stream(), size: item.bytes.length, customMetadata: structuredClone(item.metadata),
      httpEtag: "synthetic-notes-etag", writeHttpMetadata(headers) { headers.set("content-type", item.contentType); } } : null;
  };
  const editorEnv = { ...f.env, DB: f.DB, MEDIA: {
    async get(key) { editorStats.gets++; return get(key); },
    async head(key) { return get(key); },
    async put(key, bytes, parameters = {}) {
      editorStats.puts++;
      f.media.set(key, { bytes: new Uint8Array(bytes).slice(), metadata: structuredClone(parameters.customMetadata ?? {}), contentType: parameters.httpMetadata?.contentType });
      return { key, httpEtag: "synthetic-notes-etag" };
    },
    async delete(key) { editorStats.deletes++; f.media.delete(key); },
  } };
  f.env.MEDIA.get = async key => { f.stats.gets++; return get(key); };
  const currentRaw = () => f.sqlite.prepare("SELECT content FROM private_content WHERE content_id='content'").get().content;
  const revision = () => f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentArtifactEdited'").get().n;
  const selection = () => {
    const raw = currentRaw(), body = JSON.parse(raw);
    return { ...originalSelection, revision: revision(), contentSha256: hash(raw), mediaSha256: body.video_revision?.media.sha256 ?? originalSelection.mediaSha256 };
  };
  const latestEdit = () => f.sqlite.prepare("SELECT e.*,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id WHERE e.type='DocumentArtifactEdited' ORDER BY e.sequence DESC LIMIT 1").get();
  const headers = { "oai-authenticated-user-id": f.identity.userId, "oai-authenticated-user-email": f.identity.email,
    "content-type": "application/json", origin: "https://forma.test" };
  const requestEdit = fields => handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${originalSelection.artifactId}`, {
    method: "PATCH", headers, body: JSON.stringify({ expectedRevision: revision(), ...fields }),
  }), editorEnv, originalSelection.artifactId);
  const accepted = async response => {
    assert.equal(response.status, 200, await response.clone().text());
    const ack = await response.json();
    assert.equal(ack.revision, revision());
    assert.equal(ack.content.content, currentRaw());
    return { ack, selection: selection(), event: latestEdit() };
  };
  const edit = async fields => accepted(await requestEdit(fields));
  const editNotes = notes => edit({ markdown: JSON.parse(currentRaw()).content_markdown, items: [{ index: 0, notes }] });
  const trim = async (endSample = 48) => {
    const selected = selection(), current = JSON.parse(currentRaw()), url = current.video_revision?.media.url ?? f.originalUrl;
    const bytes = f.media.get(decodeURIComponent(url.slice("/api/media/".length))).bytes;
    const info = await inspectVideoPrefix(bytes), trimmed = await trimVideoPrefix(bytes, { startSample: 0, endSample });
    assert.ok(info && trimmed, "synthetic trim must pass the real prefix editor");
    return edit({ expectedContentSha256: selected.contentSha256, videoTrim: { sourceMediaSha256: hash(bytes),
      sourceSampleCount: info.sampleCount, startSample: 0, endSample, resultMediaSha256: hash(trimmed.bytes) } });
  };
  const restore = async (selected = 0) => accepted(await handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${originalSelection.artifactId}/revisions/${selected}/restore`, {
    method: "POST", headers, body: JSON.stringify({ expectedRevision: revision() }),
  }), editorEnv, originalSelection.artifactId, ["revisions", String(selected), "restore"]));
  return { ...f, selection, originalSelection, currentRaw, revision, latestEdit, edit, editNotes, requestEdit, trim, restore, editorStats, setupGets,
    read: (selected = selection()) => readNativeRetainedMediaCustody(f.env, f.identity, selected, f.controller.signal),
    mutateCurrent(change) { const body = JSON.parse(currentRaw()); change(body); f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id='content'").run(JSON.stringify(body)); },
    mutateLatest(change) { const latest = latestEdit(), payload = JSON.parse(latest.private_json); change(payload);
      f.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(payload), latest.event_id); },
  };
}
