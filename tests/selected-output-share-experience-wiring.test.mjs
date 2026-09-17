import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { createHash } from "node:crypto";
import { parseSelectedOutputShareSelection, parseSelectedOutputShareMediaRequestSelection,
  SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY } from "../src/model/selected-output-share.ts";
import { SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY } from "../src/model/selected-output-share-video.ts";
import { SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY } from "../src/model/selected-output-share-model3d.ts";
import { readSelectedOutputShareSourceMedia, accessVerifiedSelectedOutputShareMedia,
  disposeVerifiedSelectedOutputShareMedia } from "../src/selected-output-share-media-client.ts";

const source = readFileSync(new URL("../src/components/forma-experience-host.ts", import.meta.url), "utf8");
const begin = source.indexOf("  #shareSource?:"), end = source.indexOf("  #resultReadStage?:", begin);
assert.ok(begin >= 0 && end > begin, "exact new host sharing lifetime members");
// Execute the complete actual sharing members. Only private names become public
// for fixture setup; source/reader/generation logic is neither stubbed into this
// fragment nor claimed as full browser/host acceptance.
const dependencies = { parseSelectedOutputShareSelection, parseSelectedOutputShareMediaRequestSelection,
  SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY, SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY,
  SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY, readSelectedOutputShareSourceMedia };
const SharingHost = new Function(...Object.keys(dependencies), stripTypeScriptTypes(
  "class SharingHost {" + source.slice(begin, end).replaceAll("#", "") + "}") + ";return SharingHost;")(...Object.values(dependencies));
function fixture(output = "short_story") {
  const host = new SharingHost(), native = { documentId: "doc", artifactId: "artifact", revision: output === "scene" ? 0 : 3, contentSha256: "a".repeat(64) };
  let visible = true, current = true;
  const result = { output, candidate: { artifactId: "artifact" }, current: () => current,
    ...(output === "short_story" ? { story: { selection: native } } : output === "scene" ? { scene: { content: { selection: {
      ...native, screenplaySha256: "b".repeat(64), bodySha256: "c".repeat(64),
      displaySource: { characters: [{ id: "A", name: "One" }, { id: "B", name: "Two" }], location: "Library" }, expiresAt: "2099-01-01T00:00:00.000Z",
    } } } }
      : output === "slides" ? { slides: { selection: native } } : {}) };
  const binding = { plan: { documentId: "doc" } };
  Object.assign(host, { result, binding, busy: false, loading: false, visible: () => visible });
  return { host, native, result, binding, hide: () => { visible = false; }, show: () => { visible = true; }, stale: () => { current = false; }, restore: () => { current = true; } };
}

for (const output of ["short_story", "scene", "slides"]) test(output + " sharing pins the exact retained revision/hash and preserves a live source across rerenders", () => {
  const f = fixture(output), lease = f.host.selectedShareSource(f.result, f.binding);
  assert.deepEqual(lease.selection, { ...f.native, output });
  assert.notEqual(lease.selection, f.native); assert.ok(Object.isFrozen(lease)); assert.ok(Object.isFrozen(lease.selection));
  assert.equal(lease.isCurrent(), true); assert.equal(lease.signal.aborted, false);
  assert.equal(f.host.selectedShareSource(f.result, f.binding), lease, "a locale/render update preserves this source");
});

for (const reason of ["hidden", "source", "busy", "loading", "replacement", "binding"]) test("sharing retires synchronously for " + reason + " and cannot revive A after B", () => {
  const f = fixture("slides"), lease = f.host.selectedShareSource(f.result, f.binding);
  let aborts = 0; lease.signal.addEventListener("abort", () => aborts++);
  if (reason === "hidden") f.hide();
  if (reason === "source") f.stale();
  if (reason === "busy") f.host.busy = true;
  if (reason === "loading") f.host.loading = true;
  if (reason === "replacement") f.host.result = { ...f.result };
  if (reason === "binding") f.host.binding = { ...f.binding };
  f.host.shareSync();
  assert.equal(lease.signal.aborted, true); assert.equal(lease.isCurrent(), false); assert.equal(aborts, 1);
  f.show(); f.restore(); Object.assign(f.host, { busy: false, loading: false, result: f.result, binding: f.binding });
  assert.equal(f.host.selectedShareSource(f.result, f.binding), null);
  const fresh = { ...f.result }; f.host.result = fresh;
  const next = f.host.selectedShareSource(fresh, f.binding);
  assert.ok(next); assert.notEqual(next, lease); assert.equal(next.isCurrent(), true); assert.equal(aborts, 1);
});

test("authorization/source retirement aborts immediately without requiring session publication", () => {
  const f = fixture(), lease = f.host.selectedShareSource(f.result, f.binding);
  f.host.shareWithdraw(); assert.equal(lease.signal.aborted, true); assert.equal(lease.isCurrent(), false);
  assert.equal(f.host.selectedShareSource(f.result, f.binding), null);
  for (const type of ["forma-authorization-changed", "forma-event-source-retired"]) {
    assert.ok(source.includes(`addEventListener("${type}", this.#shareWithdraw)`));
    assert.ok(source.includes(`removeEventListener("${type}", this.#shareWithdraw)`));
  }
  assert.match(source, /this\.#shareUnsubscribe = this\.store\.subscribe\(this\.#shareSync\)/u);
  assert.match(source, /this\.#shareUnsubscribe\?\.\(\); this\.#shareUnsubscribe = undefined/u);
});

test("unsupported output kinds and changed exact native identity do not mount a sharing source", () => {
  for (const output of ["image", "storyboard", "audio", "video", "model3d"]) {
    const f = fixture(output); assert.equal(f.host.selectedShareSource(f.result, f.binding), null);
  }
  for (const edit of [native => native.documentId = "foreign", native => native.artifactId = "foreign",
    native => native.contentSha256 = "invalid", native => native.revision = -1]) {
    const f = fixture(); edit(f.native); assert.equal(f.host.selectedShareSource(f.result, f.binding), null);
  }
});

test("result clearing aborts the share before private result cleanup and host rendering uses only that source", () => {
  const start = source.indexOf("  #clearResult() {"), stop = source.indexOf("  #storySync =", start);
  const method = stripTypeScriptTypes(source.slice(start, stop).replace("#clearResult", "function clearResult").replaceAll("this.#", "this."));
  const clear = new Function(method + ";return clearResult;")(), f = fixture(), lease = f.host.selectedShareSource(f.result, f.binding), steps = [];
  lease.signal.addEventListener("abort", () => steps.push("share aborted"));
  Object.assign(f.host, { reader: { abort() { steps.push("reader aborted"); } }, querySelectorAll() { return []; } });
  clear.call(f.host);
  assert.deepEqual(steps, ["share aborted", "reader aborted"]); assert.equal(lease.isCurrent(), false); assert.equal(f.host.result, undefined);
  assert.match(source, /const shareSource = this\.#selectedShareSource\(result, binding\)/u);
  assert.match(source, /shareSource \? html`<forma-selected-output-share-review \.source=\$\{shareSource\} \.enabled=\$\{true\}/u);
});

// Source wiring uses synthetic descriptor/byte identities here. Container
// qualification, server custody and live output journeys are separate evidence.
const mediaBytes = Uint8Array.of(19, 31, 47, 59);
const mediaHash = createHash("sha256").update(mediaBytes).digest("hex");
function mediaFixture(output) {
  const f = fixture(output); f.native.revision = 0;
  const url = "/api/media/owner%2Fgenerated%2Fartifact." + (output === "video" ? "mp4" : "glb");
  const media = { url, sha256: mediaHash, byteLength: mediaBytes.length };
  f.host.ownerDocument = { location: { origin: "https://fixture.invalid" } };
  if (output === "video") {
    f.result.video = { selection: f.native, content: { primaryMedia: { url, mediaType: "video/mp4" },
      clips: [{ media: { url, mediaType: "video/mp4" } }] } };
    f.result.candidate = { output, artifactId: "artifact", mediaUrl: url, video: { contentSha256: f.native.contentSha256,
      receipt: { media: { mediaUrl: url, mediaType: "video/mp4", sha256: mediaHash, byteLength: media.byteLength } } } };
  } else {
    f.result.model3d = { selection: f.native, content: { files: [{ url, sha256: mediaHash, fileSize: media.byteLength,
      mimeType: "model/gltf-binary", format: "glb", role: "mesh", previewSupported: true }] } };
    f.result.candidate = { output, artifactId: "artifact", mediaUrl: url,
      model3d: { receipt: { primarySha256: mediaHash, primaryByteLength: media.byteLength } } };
  }
  const descriptor = output === "video" ? { kind: output, mimeType: "video/mp4", sha256: mediaHash,
    byteLength: media.byteLength, width: 100, height: 100, durationSeconds: 4 }
    : { kind: output, mimeType: "model/gltf-binary", sha256: mediaHash, byteLength: media.byteLength };
  f.publicOutput = { schemaVersion: 1, kind: "selected-output-read", output, title: "Reviewed output",
    expiresAt: new Date(Date.now() + 60_000).toISOString(), attribution: "Forma",
    content: { media: descriptor, disclosure: output === "video" ? { encoderDeclaration: "x264-163-r3060" } : {} } };
  f.media = media; return f;
}

for (const output of ["video", "model3d"]) {
  test(`${output} original binds exactly eight fields and the explicitly offered profile without a mount read`, t => {
    t.mock.method(globalThis, "fetch", () => assert.fail("mounting cannot fetch media"));
    const f = mediaFixture(output), lease = f.host.selectedShareSource(f.result, f.binding);
    assert.ok(lease); assert.equal(typeof lease.readMedia, "function");
    assert.deepEqual(lease.selection, { ...f.native, output, mediaSha256: mediaHash,
      policy: output === "video" ? SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY : SELECTED_OUTPUT_SHARE_MODEL3D_TEXTURE_POLICY,
      projectionPolicy: SELECTED_OUTPUT_SHARE_MEDIA_PROJECTION_POLICY });
    assert.equal(Object.keys(lease.selection).length, 8); assert.equal(lease.isCurrent(), true);
    assert.strictEqual(f.host.selectedShareSource(f.result, f.binding), lease);
  });

  test(`${output} media identity change aborts irreversibly before a render can reuse the source`, () => {
    const f = mediaFixture(output), lease = f.host.selectedShareSource(f.result, f.binding);
    const media = output === "video" ? f.result.candidate.video.receipt.media : f.result.model3d.content.files[0];
    media.sha256 = "f".repeat(64); f.host.shareSync();
    assert.equal(lease.signal.aborted, true); media.sha256 = mediaHash;
    assert.equal(f.host.selectedShareSource(f.result, f.binding), null); assert.equal(lease.isCurrent(), false);
  });

  test(`${output} reader rejects mismatched prepared descriptor and a retired caller without fetching`, async t => {
    t.mock.method(globalThis, "fetch", () => assert.fail("invalid descriptor cannot select a request"));
    const f = mediaFixture(output), lease = f.host.selectedShareSource(f.result, f.binding), abort = new AbortController();
    const changed = structuredClone(f.publicOutput); changed.content.media.sha256 = "e".repeat(64);
    await assert.rejects(lease.readMedia(changed, { signal: abort.signal, isCurrent: () => true }));
    abort.abort(); await assert.rejects(lease.readMedia(f.publicOutput, { signal: abort.signal, isCurrent: () => true }));
    await assert.rejects(lease.readMedia(f.publicOutput, { signal: new AbortController().signal, isCurrent: () => false }));
  });

  test(`${output} trusted reader verifies only the captured source bytes and loses access after source retirement`, async t => {
    const f = mediaFixture(output), lease = f.host.selectedShareSource(f.result, f.binding); let requests = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      requests++; assert.equal(url, "https://fixture.invalid" + f.media.url); assert.equal(init.method, "GET");
      const response = new Response(mediaBytes, { headers: { "content-type": f.publicOutput.content.media.mimeType,
        "content-length": String(mediaBytes.length) } });
      Object.defineProperty(response, "url", { value: url }); return response;
    });
    const handle = await lease.readMedia(f.publicOutput, { signal: new AbortController().signal, isCurrent: () => true });
    try {
      const access = accessVerifiedSelectedOutputShareMedia(handle, f.publicOutput); assert.ok(access);
      assert.deepEqual(new Uint8Array(await access.blob.arrayBuffer()), mediaBytes); assert.equal(requests, 1);
      f.host.shareWithdraw(); assert.equal(accessVerifiedSelectedOutputShareMedia(handle, f.publicOutput), null);
    } finally { disposeVerifiedSelectedOutputShareMedia(handle); }
  });

  for (const retire of ["host", "caller"]) test(`${output} pending trusted media request aborts immediately on ${retire} retirement`, async t => {
    const f = mediaFixture(output), lease = f.host.selectedShareSource(f.result, f.binding), caller = new AbortController();
    let observed, requested;
    const requestStarted = new Promise(resolve => { requested = resolve; });
    t.mock.method(globalThis, "fetch", (url, init) => {
      assert.equal(url, "https://fixture.invalid" + f.media.url); assert.equal(init.credentials, "same-origin");
      assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store"); assert.equal(init.referrerPolicy, "no-referrer");
      observed = init.signal; requested();
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    const pending = lease.readMedia(f.publicOutput, { signal: caller.signal, isCurrent: () => true });
    const rejected = assert.rejects(pending);
    await requestStarted;
    if (retire === "host") f.host.shareWithdraw(); else caller.abort();
    assert.equal(observed.aborted, true, "underlying request receives abort synchronously"); await rejected;
  });
}

test("original media sharing rejects edited revisions, missing sizes, mismatched private references and unsupported Audio", () => {
  for (const output of ["video", "model3d"]) for (const change of ["revision", "size", "reference"]) {
    const f = mediaFixture(output);
    if (change === "revision") f.native.revision = 1;
    if (change === "reference") f.result.candidate.mediaUrl = "/api/media/different";
    if (change === "size" && output === "video") delete f.result.candidate.video.receipt.media.byteLength;
    if (change === "size" && output === "model3d") delete f.result.model3d.content.files[0].fileSize;
    assert.equal(f.host.selectedShareSource(f.result, f.binding), null, output + " " + change);
  }
  const audio = fixture("audio"); audio.result.audio = { selection: audio.native,
    content: { media: { url: "/api/media/original.mp3", mediaType: "audio/mpeg", sha256: mediaHash } } };
  assert.equal(audio.host.selectedShareSource(audio.result, audio.binding), null);
});
