import assert from "node:assert/strict";
import test from "node:test";
import { projectNativeRetainedOutput, validateNativeRetainedOutputDto, parseNativeRetainedOutputRoute, nativeRetainedOutputRequestPath, parseNativeRetainedOutputRequestUrl } from "../src/model/native-retained-output.ts";

const selection = { documentId: "document-a", artifactId: "video-a", revision: 0, contentSha256: "a".repeat(64) };
const target = { output: "video", selection }, expiry = "2099-01-01T00:00:00.000Z";
const raw = () => ({ title: "  Exact 動画\r\n", content_markdown: "\ufeff  Literal <script> & صوت\n\nSecond line.  ",
  items: [{ title: "Edited first <title>", body: "  Body\r\nالعربية  ", notes: "Note 👩‍👩‍👧‍👦" },
    { title: "Missing clip", body: "Text is not a rendered film.", notes: "" }] });
const url = "/api/media/u-owner%2Fgenerated%2Fclip-a.mp4";
const receipt = () => ({ artifact_kind: "video", media_url: null, media_type: null, item_count: 2, items: [
  { id: "clip-a", title: "Original completion title", media_url: url, media_type: "video/mp4", duration_seconds: 32 },
  { id: "clip-b", media_url: null, media_type: null },
] });
const project = (r = receipt(), body = raw()) => projectNativeRetainedOutput(target, body, expiry, null, { videoReceipt: r });

test("Video exact route and DTO preserve current literal text and immutable completion order", () => {
  const route = `/make/video?document=document-a&artifact=video-a&revision=0&sha256=${selection.contentSha256}`;
  assert.deepEqual(parseNativeRetainedOutputRoute(route), target);
  assert.deepEqual(parseNativeRetainedOutputRequestUrl("https://forma.test" + nativeRetainedOutputRequestPath(target)), target);
  const dto = project(); assert.ok(dto); assert.equal(dto.title, raw().title);
  assert.deepEqual(dto.content, { primaryMedia: null, content_markdown: raw().content_markdown, clips: raw().items.map((item, index) => ({
    ...item, id: ["clip-a", "clip-b"][index], media: index === 0 ? { url, mediaType: "video/mp4" } : null,
  })) });
  assert.deepEqual(validateNativeRetainedOutputDto(dto, target), dto);
  assert.ok(Object.isFrozen(dto.content.clips)); assert.ok(dto.content.clips.every(Object.isFrozen));
  assert.ok(Object.isFrozen(dto.content.clips[0].media));
  assert.equal(Object.hasOwn(dto.content.clips[0].media, "sha256"), false, "raw-content identity is not media-byte identity");
  assert.equal(Object.hasOwn(dto.content.clips[0], "duration"), false, "requested duration is not measured playback");
  for (const output of ["scene", "slides", "storyboard", "model3d", "audio"]) assert.equal(validateNativeRetainedOutputDto(dto, { ...target, output }), null);
  for (const key of Object.keys(selection)) assert.equal(validateNativeRetainedOutputDto(dto, { ...target, selection: {
    ...selection, [key]: key === "revision" ? 1 : key === "contentSha256" ? "b".repeat(64) : "other",
  } }), null);
  for (const malformed of [route + "&revision=0", route + "#", route.replace("/video?", "/video/?"), route.replace("/video?", "/Video?"), route + "&input=other"])
    assert.equal(parseNativeRetainedOutputRoute(malformed), null);
});

test("Video requires exact selected clip receipts and refuses malformed media without a plan fallback", () => {
  assert.equal(projectNativeRetainedOutput(target, raw(), expiry), null);
  const changes = [r => r.artifact_kind = "audio", r => r.item_count = 1, r => r.items.pop(),
    r => r.items[1].id = "clip-a", r => r.items[0].id = "../clip", r => r.items[0].media_url = "https://elsewhere.invalid/clip.mp4",
    r => r.items[0].media_url = "/api/shared/token/clip", r => r.items[0].media_url = url + "?q=1",
    r => r.items[0].media_url = url.replace("clip-a.mp4", "%2E%2E%2Fclip-a.mp4"),
    r => r.items[0].media_type = "audio/mpeg", r => r.items[0].media_url = null,
    r => r.items[1].media_type = "video/mp4"];
  for (const change of changes) { const value = receipt(); change(value); assert.equal(project(value), null); }
  const value = receipt(); value.items[0].media_url = null; value.items[0].media_type = null;
  const absent = project(value); assert.ok(absent); assert.ok(absent.content.clips.every(clip => clip.media === null));
  assert.equal(absent.content.content_markdown, raw().content_markdown);
});

test("Video root file and per-clip references stay distinct across real manual and managed envelope forms", () => {
  const primaryUrl = url.replace("clip-a", "primary");
  for (const form of ["root-only", "mixed", "root-equals-first-clip"]) {
    const r = receipt(); r.media_url = form === "root-equals-first-clip" ? url : primaryUrl; r.media_type = "video/mp4";
    if (form === "root-only") r.items.forEach(item => { item.media_url = null; item.media_type = null; });
    const dto = project(r); assert.ok(dto);
    assert.deepEqual(dto.content.primaryMedia, { url: r.media_url, mediaType: "video/mp4" });
    assert.ok(Object.isFrozen(dto.content.primaryMedia));
    assert.equal(dto.content.clips[0].media === null, form === "root-only");
    assert.deepEqual(dto.content.clips.map(clip => clip.id), ["clip-a", "clip-b"]);
    assert.equal(Object.hasOwn(dto.content, "combinedFilm"), false);
  }
  for (const change of [r => delete r.media_url, r => delete r.media_type, r => r.media_type = "video/mp4",
    r => r.media_url = primaryUrl, r => { r.media_url = primaryUrl; r.media_type = "audio/mpeg"; },
    r => { r.media_url = "https://foreign.invalid/file.mp4"; r.media_type = "video/mp4"; }]) {
    const r = receipt(); change(r); assert.equal(project(r), null);
  }
});

test("Video closed DTO and captured receipt reject accessors and surplus capability claims", () => {
  let reads = 0; const metadata = {};
  Object.defineProperty(metadata, "videoReceipt", { enumerable: true, get() { reads++; return receipt(); } });
  assert.equal(projectNativeRetainedOutput(target, raw(), expiry, null, metadata), null);
  const value = receipt(); Object.defineProperty(value.items[0], "media_url", { enumerable: true, get() { reads++; return url; } });
  assert.equal(project(value), null);
  const dto = project(); assert.ok(dto);
  for (const extra of [{ combinedFilm: url }, { editableTimeline: true }])
    assert.equal(validateNativeRetainedOutputDto({ ...dto, content: { ...dto.content, ...extra } }, target), null);
  const clips = structuredClone(dto.content.clips); clips[0].media.sha256 = "c".repeat(64);
  assert.equal(validateNativeRetainedOutputDto({ ...dto, content: { ...dto.content, clips } }, target), null);
  assert.equal(reads, 0);
});
