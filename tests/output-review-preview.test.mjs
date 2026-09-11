import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { outputReviewPreviewKind, outputReviewPreviewIdentity, readOutputReviewPreview, OUTPUT_REVIEW_PREVIEW_MAX_BYTES } from "../src/model/output-review-preview.ts";

const bytes = new Uint8Array([1, 2, 3, 4]);
const file = { byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: "image/png" };
const response = (body = bytes, headers = {}) => new Response(body, { headers: { "content-type": file.mimeType, ...headers } });
function snapshot() {
  return { documentId: "doc", projectId: "project", scope: { actorUserId: "reviewer" }, sourceRevision: "source", requirementRevision: "requirements",
    permissions: { canDownload: true }, confirmedPlan: { revisionId: "plan", targetContractDigests: { target: "contract" }, plan: { targets: [{ id: "target", media_kind: "image", blocking_issues: [] }] } },
    assets: [{ ...file, id: "asset", mediaKind: "image", available: true, inspection: { status: "inspected" }, downloadUrl: "/api/output-requirements/assets/asset?documentId=doc" }],
    results: [{ id: "result", assetId: "asset", targetId: "target", resultRevision: "result-v1", planRevisionId: "plan", targetContractDigest: "contract", sourceDigest: "source", sha256: file.sha256 }] };
}

test("preview only admits supported passive media, never active documents", () => {
  for (const mime of ["image/jpeg", "image/png"]) assert.equal(outputReviewPreviewKind(mime), "image");
  for (const mime of ["audio/mpeg", "audio/wav", "audio/x-wav"]) assert.equal(outputReviewPreviewKind(mime), "audio");
  assert.equal(outputReviewPreviewKind("video/mp4"), "video");
  for (const mime of ["image/svg+xml", "text/html", "application/pdf", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "model/gltf-binary"]) assert.equal(outputReviewPreviewKind(mime), null);
});

test("preview identity binds exact result, asset, target, plan, source, actor and current rights", () => {
  const original = snapshot(), key = outputReviewPreviewIdentity(original, "result"); assert.ok(key);
  for (const mutate of [s => s.results[0].resultRevision = "v2", s => s.assets[0].downloadUrl += "x", s => s.assets[0].byteLength++, s => s.scope.actorUserId = "other", s => s.requirementRevision = "new"]) {
    const changed = structuredClone(original); mutate(changed); assert.notEqual(outputReviewPreviewIdentity(changed, "result"), key);
  }
  for (const mutate of [s => s.permissions.canDownload = false, s => s.assets[0].available = false, s => s.assets[0].sha256 = "a".repeat(64), s => s.results[0].targetId = "other", s => s.results[0].planRevisionId = "old", s => s.results[0].targetContractDigest = "old", s => s.results[0].sourceDigest = "old", s => s.confirmedPlan.plan.targets[0].blocking_issues.push("blocked")]) {
    const changed = structuredClone(original); mutate(changed); assert.equal(outputReviewPreviewIdentity(changed, "result"), null);
  }
});

test("verified preview preserves exact bytes and declared MIME", async () => {
  const blob = await readOutputReviewPreview(response(), file);
  assert.equal(blob.type, file.mimeType); assert.equal(blob.size, file.byteLength);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
});

test("wrong digest, type, lengths, oversize and redirects never become preview blobs", async () => {
  await assert.rejects(readOutputReviewPreview(response(), { ...file, sha256: "0".repeat(64) }));
  await assert.rejects(readOutputReviewPreview(response(bytes, { "content-type": "text/html" }), file));
  await assert.rejects(readOutputReviewPreview(response(bytes, { "content-length": "3" }), file));
  await assert.rejects(readOutputReviewPreview(response(bytes.slice(0, 3)), file));
  await assert.rejects(readOutputReviewPreview(response(new Uint8Array(5)), file));
  await assert.rejects(readOutputReviewPreview(response(), { ...file, byteLength: OUTPUT_REVIEW_PREVIEW_MAX_BYTES + 1 }));
  const redirected = response(); Object.defineProperty(redirected, "redirected", { value: true });
  await assert.rejects(readOutputReviewPreview(redirected, file));
});

test("oversized stream is cancelled before further reads", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } });
  await assert.rejects(readOutputReviewPreview(response(body), file)); assert.equal(cancelled, true);
});

test("closing during a delayed stream aborts the read", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const pending = readOutputReviewPreview(response(body), file, controller.signal);
  controller.abort(); await assert.rejects(pending); assert.equal(cancelled, true);
});

test("refusal settles even when underlying cancellation never resolves", async () => {
  for (const wrongHeader of [true, false]) {
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; return new Promise(() => {}); } });
    const pending = readOutputReviewPreview(response(stream, wrongHeader ? { "content-type": "text/html" } : {}), file);
    let timer;
    try {
      const outcome = await Promise.race([pending.then(() => "incorrectly accepted", () => "rejected"), new Promise(resolve => { timer = setTimeout(() => resolve("hung"), 100); })]);
      assert.equal(outcome, "rejected"); assert.equal(cancelled, true);
    } finally { clearTimeout(timer); }
  }
});

test("shared UI uses owned verified transport and cleans private media without attesting", async () => {
  const source = await readFile(new URL("../src/components/forma-output-requirements.ts", import.meta.url), "utf8");
  const preview = source.slice(source.indexOf("  #reviewPreviewIdentity("), source.indexOf("  async #download("));
  assert.match(preview, /outputRequirements\.download\(preview\.view\.documentId, asset\.downloadUrl/);
  assert.match(preview, /if \(!this\.#reviewPreviewCurrent\(preview\)\) return/);
  assert.match(preview, /URL\.revokeObjectURL/); assert.match(preview, /media\.pause\(\)/);
  assert.match(preview, /privateRevision/); assert.match(preview, /store\.route\.get\(\) === preview\.route/);
  assert.match(preview, /controls playsinline preload="none"/);
  assert.match(preview, /this\.ownerDocument\.activeElement === failed/);
  assert.match(preview, /toggle\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(preview, /autoplay|<iframe|\.checked\s*=|action:\s*"review"|this\.#command\(/);
  const client = await readFile(new URL("../src/state/output-requirements-client.ts", import.meta.url), "utf8");
  assert.match(client, /preview \? \{ \.\.\.init, redirect: "error" \}/);
  assert.match(client, /readOutputReviewPreview\(response, preview/);
});
