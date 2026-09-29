import assert from "node:assert/strict";
import test from "node:test";
import { savedStoryboardInspection, savedStoryboardMediaUrl } from "../src/model/saved-storyboard-inspection.ts";

function fixture() {
  return {
    title: "Failed generation inputs", subtitle: "storyboard", prompt: "", retained: true, outcome: "failed",
    receipt: {
      job: { kind: "render_document", artifact_kind: "storyboard", status: "failed", document_revision: "rev-original" },
      artifact_checkpoint: {
        plan: { title: "From Overload to Outcome", summary: "Original eight-shot plan", items: Array.from({ length: 8 }, (_, index) => ({ title: `Original shot ${index + 1}`, body: `Original body ${index + 1}`, notes: `Camera ${index + 1}`, image_prompt: `Original image direction ${index + 1}` })) },
        rendered_items: Array.from({ length: 5 }, (_, index) => ({ id: `frame-${index + 1}`, title: `Original shot ${index + 1}`, media_url: `/api/media/u-owner%2Fgenerated%2Foriginal-frame-${index + 1}.jpg`, provider: "fal", provider_model: index < 3 ? "ideogram/v4" : "ideogram/v4/fast" })),
      },
    },
  };
}

test("retains eight original slots, five recorded images, mixed models, and original source without completion claims", () => {
  const inspection = fixture(), before = JSON.stringify(inspection);
  const preview = savedStoryboardInspection(inspection);
  assert.equal(preview.recordedFrameCount, 5);
  assert.equal(preview.totalFrameCount, 8);
  assert.equal(preview.complete, false);
  assert.equal(preview.sourceRevision, "rev-original");
  assert.deepEqual(preview.frames.map((frame) => frame.index), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(preview.frames.filter((frame) => frame.recorded).map((frame) => frame.model), ["ideogram/v4", "ideogram/v4", "ideogram/v4", "ideogram/v4/fast", "ideogram/v4/fast"]);
  for (const frame of preview.frames) {
    assert.equal(frame.title, `Original shot ${frame.index}`);
    assert.equal(frame.body, `Original body ${frame.index}`);
    assert.equal(frame.imagePrompt, `Original image direction ${frame.index}`);
    assert.equal(Boolean(frame.mediaUrl), frame.index <= 5);
  }
  assert.equal(JSON.stringify(inspection), before);
});

test("only relative authenticated generated-image URLs may become image sources", () => {
  const allowed = "/api/media/u-owner%2Fgenerated%2Foriginal-frame-1.jpg";
  assert.equal(savedStoryboardMediaUrl(allowed), allowed);
  for (const value of [null, "", "https://example.org/frame.jpg", "//example.org/frame.jpg", "data:image/png;base64,eA==", "blob:example", "/api/media/file.jpg", "/api/media/%", "/api/media/u-owner%2Fgenerated%2F..%2Fsecret.jpg", "/api/media/u-owner%2Fgenerated%2Fframe.jpg?token=secret", "/api/media/u-owner%252Fgenerated%252Fframe.jpg", "/api/media/u-owner%2Fgenerated%2Fframe.svg", "/api/media/u-owner%2Fgenerated%2Fframe.jpg%00"]) assert.equal(savedStoryboardMediaUrl(value), null, String(value));
});

test("an unavailable image does not change the historical recorded count", () => {
  const inspection = fixture();
  inspection.receipt.artifact_checkpoint.rendered_items[1].media_url = "https://untrusted.example/frame.jpg";
  const preview = savedStoryboardInspection(inspection);
  assert.equal(preview.recordedFrameCount, 5);
  assert.equal(preview.frames[1].recorded, true);
  assert.equal(preview.frames[1].mediaUrl, null);
  assert.equal(preview.frames[5].recorded, false);
});

test("expired, redacted, completed, and malformed inputs cannot invent a storyboard", () => {
  for (const change of [
    (value) => { value.retained = false; }, (value) => { value.outcome = "completed"; },
    (value) => { value.receipt.job.artifact_kind = "video"; }, (value) => { value.receipt.job.status = "running"; },
    (value) => { delete value.receipt.artifact_checkpoint; },
    (value) => { value.receipt.artifact_checkpoint.plan.items = []; },
    (value) => { value.receipt.artifact_checkpoint.plan.items = Array.from({ length: 25 }, () => ({})); },
    (value) => { value.receipt.artifact_checkpoint.rendered_items = []; },
    (value) => { value.receipt.artifact_checkpoint.rendered_items.push(...Array(4).fill({})); },
    (value) => { value.receipt.artifact_checkpoint.rendered_items[1] = null; },
  ]) { const value = fixture(); change(value); assert.equal(savedStoryboardInspection(value), null); }
});
