import assert from "node:assert/strict";
import test from "node:test";
import {
  captureNativeSlidesHandle, nativeSlidesCompletionPath, parseNativeSlidesCompletionUrl,
  validateNativeSlidesCompletion, nativeSlidesRetainedRoute, NATIVE_SLIDES_COMPLETION_MAX_BYTES,
} from "../src/model/native-slides-completion.ts";
import { validateNativeSceneCompletion, nativeSceneRetainedRoute } from "../src/model/native-scene-completion.ts";
import { validateNativeStoryCompletion } from "../src/model/native-short-story-generation.ts";
import { parseNativeRetainedOutputRoute } from "../src/model/native-retained-output.ts";
import { nativeOutputCompletionPath, parseNativeOutputCompletionUrl, validateNativeOutputCompletion } from "../src/model/native-output-completion.ts";
import { readNativeSlidesCompletion } from "../src/model/retained-short-story-client.ts";

// Pure selection and constructed-response transport controls; no job admission,
// Worker, live database, network, browser, authorization or provider proof.
const origin = "https://forma.test", now = Date.parse("2030-01-01T00:00:00.000Z");
const handle = () => ({ documentId: "document:slides.1", jobId: "job:slides_2-1" });
const completion = () => ({ schemaVersion: 1, kind: "native-slides-completion", handle: handle(),
  selection: { documentId: handle().documentId, artifactId: "artifact:slides.1", revision: 0, contentSha256: "a1".repeat(32) },
  expiresAt: "2099-01-01T00:00:00.000Z" });
const controls = (request, overrides = {}) => ({ origin, request, signal: new AbortController().signal, current: () => true, ...overrides });
const response = (body = JSON.stringify(completion()), options = {}) => {
  const result = new Response(body, { status: options.status ?? 200, headers: options.headers ?? { "content-type": "application/json" } });
  Object.defineProperty(result, "url", { value: options.url ?? origin + nativeSlidesCompletionPath(handle()) });
  return result;
};

test("Slides original job resolves only its exact immutable revision-zero selection and native reader route", () => {
  const receipt = validateNativeSlidesCompletion(completion(), handle(), now);
  assert.deepEqual(receipt, completion());
  for (const row of [receipt, receipt.handle, receipt.selection]) assert.ok(Object.isFrozen(row));
  assert.equal(NATIVE_SLIDES_COMPLETION_MAX_BYTES, 8192);
  assert.equal(nativeSlidesCompletionPath(handle()), "/api/retained-output/slides/jobs/document%3Aslides.1/job%3Aslides_2-1");
  assert.deepEqual(parseNativeSlidesCompletionUrl(origin + nativeSlidesCompletionPath(handle())), handle());
  assert.deepEqual(parseNativeRetainedOutputRoute(nativeSlidesRetainedRoute(receipt, handle())), { output: "slides", selection: receipt.selection });
});

test("Slides completion cannot cross into Scene, Story, arbitrary output, or a later job", () => {
  const value = completion();
  assert.equal(validateNativeSceneCompletion(value, handle(), now), null);
  assert.equal(validateNativeStoryCompletion(value, handle(), now), null);
  assert.equal(nativeSceneRetainedRoute(value, handle()), null);
  for (const kind of ["native-scene-completion", "native-short-story-completion", "native-slides-result"]) {
    assert.equal(validateNativeSlidesCompletion({ ...value, kind }, handle(), now), null);
  }
  assert.equal(validateNativeSlidesCompletion(value, { ...handle(), jobId: "newer-job" }, now), null);
  for (const output of ["short_story", "../slides", "slides/jobs", "Slides", null]) {
    assert.throws(() => nativeOutputCompletionPath(output, handle()), TypeError);
    assert.equal(parseNativeOutputCompletionUrl(output, origin + nativeSlidesCompletionPath(handle())), null);
    assert.equal(validateNativeOutputCompletion(output, value, handle(), now), null);
  }
});

test("Slides handles and canonical paths reject borrowed identity and URL aliases", () => {
  for (const value of [null, {}, [], Object.create(handle()), { ...handle(), artifactId: "borrowed" },
    { ...handle(), jobId: "../slides" }, { ...handle(), documentId: "x".repeat(161) }]) {
    assert.equal(captureNativeSlidesHandle(value), null);
  }
  const url = origin + nativeSlidesCompletionPath(handle());
  for (const candidate of [url + "?", url + "#", url + "/", url + "?job=x", " " + url,
    url.replace("slides/jobs", "scene/jobs"), url.replace("%3A", "%3a"), url.replace("document", "%64ocument"),
    url.replace(origin, "https://user@forma.test"), url.replace("/jobs/", "/jobs/discard/../")]) {
    assert.equal(parseNativeSlidesCompletionUrl(candidate), null, candidate);
  }
});

test("Slides rejects changed Document, artifact, revision, SHA, expiry and unrequested fields", () => {
  const mutations = [
    x => { x.handle.documentId = "foreign"; }, x => { x.handle.jobId = "foreign"; },
    x => { x.selection.documentId = "foreign"; }, x => { x.selection.artifactId = "../foreign"; },
    x => { x.selection.revision = 1; }, x => { x.selection.revision = "0"; },
    x => { x.selection.contentSha256 = "A".repeat(64); }, x => { x.selection.contentSha256 = "a".repeat(63); },
    x => { x.expiresAt = "2000-01-01T00:00:00.000Z"; }, x => { x.expiresAt = "2099-01-01T00:00:00Z"; },
    x => { x.content = "x".repeat(8193); }, x => { x.selection.kind = "slides"; }, x => { x.handle.status = "completed"; },
  ];
  for (const change of mutations) {
    const value = completion(); change(value);
    assert.equal(validateNativeSlidesCompletion(value, handle(), now), null);
    assert.equal(nativeSlidesRetainedRoute(value, handle()), null);
  }
  for (const instant of [NaN, Infinity, Date.parse(completion().expiresAt)]) assert.equal(validateNativeSlidesCompletion(completion(), handle(), instant), null);
});

test("Slides receipt validation does not execute getters or accept inherited, hidden or symbol data", () => {
  let calls = 0;
  for (const layer of ["root", "handle", "selection"]) {
    for (const fault of ["getter", "symbol", "hidden", "prototype"]) {
      const value = completion(), row = layer === "root" ? value : value[layer];
      const key = layer === "root" ? "expiresAt" : layer === "handle" ? "jobId" : "artifactId";
      if (fault === "getter") Object.defineProperty(row, key, { enumerable: true, get() { calls++; return "borrowed"; } });
      if (fault === "symbol") row[Symbol("foreign")] = true;
      if (fault === "hidden") Object.defineProperty(row, key, { value: row[key], enumerable: false });
      if (fault === "prototype") Object.setPrototypeOf(row, { foreign: true });
      assert.equal(validateNativeSlidesCompletion(value, handle(), now), null, layer + fault);
    }
  }
  assert.equal(calls, 0);
});

test("Slides client captures original identity before its single bounded same-origin GET", async () => {
  const requested = handle(), calls = [], settings = controls(async (...args) => {
    calls.push(args); requested.jobId = "a-newer-job"; return response();
  });
  const value = await readNativeSlidesCompletion(requested, settings);
  assert.deepEqual(value, completion());
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [nativeSlidesCompletionPath(handle()), { method: "GET", credentials: "same-origin", cache: "no-store",
    redirect: "error", headers: { accept: "application/json" }, signal: settings.signal }]);
});

test("Slides client refuses malformed handles before any request and stale owners after headers", async () => {
  let calls = 0;
  await assert.rejects(readNativeSlidesCompletion({ ...handle(), extra: true }, controls(async () => { calls++; return response(); })), /invalid_native_slides_handle/);
  assert.equal(calls, 0);
  let current = true, cancellations = 0;
  const body = new ReadableStream({ cancel() { cancellations++; } });
  await assert.rejects(readNativeSlidesCompletion(handle(), controls(async () => { calls++; current = false; return response(body); }, { current: () => current })), /retained_story_withdrawn/);
  assert.equal(calls, 1); assert.equal(cancellations, 1);
});

for (const status of [401, 403, 404, 409, 500]) test(`Slides completion ${status} remains unavailable without retry`, async () => {
  let calls = 0;
  await assert.rejects(readNativeSlidesCompletion(handle(), controls(async () => { calls++; return response("unavailable", { status }); })), /retained_story_unavailable/);
  assert.equal(calls, 1);
});

test("Slides client enforces decoded byte cap, cancels overflow, and releases the reader", async () => {
  let cancellations = 0, pulls = 0;
  const body = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(8193)); }, cancel() { cancellations++; } }, { highWaterMark: 0 });
  const reply = response(body, { headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "1" } });
  await assert.rejects(readNativeSlidesCompletion(handle(), controls(async () => reply)), /retained_story_unavailable/);
  assert.equal(pulls, 1); assert.equal(cancellations, 1); assert.equal(body.locked, false);
});

test("Slides client rejects another output or exact response URL even when Document/job match", async () => {
  for (const reply of [response(JSON.stringify({ ...completion(), kind: "native-scene-completion" })),
    response(undefined, { url: origin + nativeSlidesCompletionPath(handle()) + "?extra=1" }),
    response(undefined, { url: "https://foreign.test" + nativeSlidesCompletionPath(handle()) })]) {
    await assert.rejects(readNativeSlidesCompletion(handle(), controls(async () => reply)), /retained_story_unavailable/);
  }
});
