import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { originalOutputsMediaFixture } from "./selected-output-share-media-outputs-fixture.mjs";
const hash = value => createHash("sha256").update(value).digest("hex");
const TOKEN = "11111111-2222-4333-8444-555555555555";
const EVIDENCE_TOKEN = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const PAST = "2020-01-01T00:00:00.000Z";

/** A synthetic completed state shaped by the actual recovery producers. This
 * does not run recovery, claim a lease, transfer data, settle money or invoke a
 * provider. Actual native retained readers must validate the completed state. */
export async function recoveredOutputsMediaFixture(t, output, options = {}) {
  const completion = options.completion ?? "new", evidenceMode = options.evidenceMode ?? "original";
  assert.ok(["new", "existing"].includes(completion)); assert.ok(["original", "retrieved"].includes(evidenceMode));
  const f = await originalOutputsMediaFixture(t, output, { ...options,
    ...(completion === "new" ? { completionClientId: `output-${output}-recovery`, completionPayload: { recovered: true } } : {}),
    ...(output === "model3d" && completion === "new" ? { model3dStorageToken: TOKEN } : {}) });
  const row = f.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(f.jobId), before = JSON.parse(row.result_json);
  const body = JSON.parse(f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(f.completed.eventId).private_json);
  const originals = Object.values(before.providerSubmissions), paid = originals.find(call => call.provider === "fal");
  assert.ok(paid);
  let recovery, patch;
  if (output === "video") {
    const media = before.outputVideoMediaResult;
    recovery = { version: "output-video-recovery-v1", token: TOKEN, expiresAt: PAST, evidenceMode,
      ...(evidenceMode === "retrieved" ? { evidenceToken: EVIDENCE_TOKEN } : {}),
      storageKey: decodeURIComponent(media.mediaUrl.slice("/api/media/".length)), providerRequestId: paid.providerRequestId,
      clientRequestId: paid.clientRequestId, requestDigest: media.requestDigest, priorStatus: "failed",
      priorErrorCode: "local_persistence_failed", priorCompletedAt: PAST,
      status: "completed", completionEventId: f.completed.eventId };
    patch = { outputVideoRecovery: recovery };
    if (evidenceMode === "retrieved") {
      patch.outputVideoRecoveryEnvelopes = before.outputVideoMediaEnvelopes.filter(envelope => ["status", "result"].includes(envelope.phase)).map(saved => {
        const original = f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(saved.responseRef);
        const responseRef = `recovery-video-${saved.phase}`;
        // These are separate recovery observations of the same synthetic result,
        // not aliases that replace the original provider response history.
        f.insert("private_content", { ...original, content_id: responseRef });
        return { version: "output-video-recovery-envelope-v1", token: EVIDENCE_TOKEN, phase: saved.phase, responseRef,
          envelopeSha256: hash(original.content), decodedBodySha256: saved.decodedBodySha256, expiresAt: original.expires_at };
      });
      assert.equal(patch.outputVideoRecoveryEnvelopes.length, 2);
    }
  } else {
    const native = body.settings.output_model3d;
    const lease = { version: "output-model3d-recovery-v1", token: TOKEN, expiresAt: PAST, jobId: f.jobId,
      slotId: f.reference.slotId, clientRequestId: paid.clientRequestId, providerRequestId: paid.providerRequestId,
      requestDigest: native.receipt.requestDigest, originalSubmission: { ...paid, inputTokens: 0, outputTokens: 0 },
      priorStatus: "failed", priorErrorCode: "local_persistence_failed", priorCompletedAt: PAST, originalResultSha256: hash(row.result_json) };
    recovery = { ...lease, status: "completed", completionEventId: f.completed.eventId };
    patch = { outputModel3dRecovery: recovery, outputModel3dRecoveryHistory: [lease] };
    if (completion === "new") {
      patch.outputModel3dRecoveryFiles = native.files.map((file, index) => ({ index, token: TOKEN,
        storageKey: decodeURIComponent(file.url.slice("/api/media/".length)), sha256: file.sha256, file,
        providerMediaUrl: `https://fal.media/synthetic-recovered-model-${index}.glb` }));
      patch.outputModel3dRecoveryEnvelopes = ["status", "result"].map(phase => {
        const responseRef = `recovery-model3d-${phase}`;
        // Correct historical wire shape; it is audit data, not an independently
        // verified provider response or an input to the completed GLB proof.
        const decoded = Buffer.from(JSON.stringify({ request_id: paid.providerRequestId, status: "COMPLETED" }));
        const raw = JSON.stringify({ version: "fal-model3d-original-envelope-v1", phase, provider: "fal", model: paid.model,
          clientRequestId: paid.clientRequestId, providerRequestId: paid.providerRequestId, requestDigest: native.receipt.requestDigest,
          requestUrl: `https://queue.fal.run/${paid.model}/requests/${paid.providerRequestId}${phase === "status" ? "/status" : ""}`,
          httpStatus: 200, headers: [["content-type", "application/json"]], byteLength: decoded.length,
          sha256: hash(decoded), bodyBase64: decoded.toString("base64") });
        f.insert("private_content", { content_id: responseRef, owner_id: "owner", kind: "provider-response", content: raw,
          created_at: new Date().toISOString(), expires_at: f.expiry, redacted_at: null });
        return { token: TOKEN, phase, responseRef, sha256: hash(raw), expiresAt: f.expiry };
      });
    }
  }
  const terminal = { ...before, ...patch, stage: "completed", appendedEventIds: [f.completed.eventId],
    generationReceipt: { ...(before.generationReceipt ?? {}), provider_request_status: "completed" } };
  // The producer's recursive json_patch clears errorDetail; do not manufacture
  // a live lease or require the historical lease expiry to remain in the future.
  delete terminal.errorDetail;
  f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(terminal), f.jobId);
  return { ...f, recovery, recoveryKey: output === "video" ? "outputVideoRecovery" : "outputModel3dRecovery", recoveryOptions: { completion, evidenceMode },
    mutateCompletion(change) {
      const value = JSON.parse(f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(f.completed.eventId).private_json);
      change(value);
      f.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(value), f.completed.eventId);
    },
  };
}
