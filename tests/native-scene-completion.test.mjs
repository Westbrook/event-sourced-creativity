import assert from "node:assert/strict";
import test from "node:test";
import {
  captureNativeSceneHandle, nativeSceneCompletionPath, parseNativeSceneCompletionUrl,
  validateNativeSceneCompletion, nativeSceneRetainedRoute,
} from "../src/model/native-scene-completion.ts";
import {
  nativeStoryCompletionPath, parseNativeStoryCompletionUrl,
  validateNativeStoryCompletion, nativeStoryRetainedRoute,
} from "../src/model/native-short-story-generation.ts";

// Verified pure controls. Pure completion-contract witnesses only; no Worker, job dispatch,
// retained body read, browser, provider, authorization, delivery, or spending proof.
const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const ORIGIN = "https://forma.test";
const SHA = "a1".repeat(32);
const handle = (documentId = "document-scene", jobId = "job-scene") => ({ documentId, jobId });
const completion = (selected = handle(), expiresAt = new Date(NOW + 60000).toISOString()) => ({
  schemaVersion: 1, kind: "native-scene-completion", handle: { ...selected },
  selection: { documentId: selected.documentId, artifactId: "artifact-scene", revision: 0, contentSha256: SHA },
  expiresAt,
});
const freshCompletion = () => completion(handle(), new Date(Date.now() + 3600000).toISOString());

test("native Scene completion round-trips the exact acknowledged Document/job and revision-zero selection", () => {
  const expected = handle("document:scene.1", "job:scene_2-1");
  assert.deepEqual(captureNativeSceneHandle(expected), expected);
  const path = "/api/retained-output/scene/jobs/document%3Ascene.1/job%3Ascene_2-1";
  assert.equal(nativeSceneCompletionPath(expected), path);
  for (const origin of [ORIGIN, "http://127.0.0.1:4186"]) {
    assert.deepEqual(parseNativeSceneCompletionUrl(origin + path), expected);
  }
  const input = completion(expected);
  const result = validateNativeSceneCompletion(input, expected, NOW);
  assert.deepEqual(result, input);
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 8192);
  assert.deepEqual(Object.keys(result).sort(), ["expiresAt", "handle", "kind", "schemaVersion", "selection"]);
});

test("native Scene completion handles reject malformed, non-own, and additional identity fields", () => {
  for (const value of [null, undefined, true, "document-scene", [], {},
    { documentId: "document-scene" }, { jobId: "job-scene" },
    { ...handle(), artifactId: "not-a-job-handle" },
    Object.create(handle()), Object.assign(Object.create({ inherited: true }), handle())]) {
    assert.equal(captureNativeSceneHandle(value), null);
    assert.throws(() => nativeSceneCompletionPath(value), TypeError);
  }
  for (const field of ["documentId", "jobId"]) {
    for (const value of ["", " ", "../scene", "scene/job", "scene\\job", "scene?job", "scene#job",
      "scene%2Fjob", "scene\njob", "雨", "x".repeat(161), 1, null]) {
      const candidate = { ...handle(), [field]: value };
      assert.equal(captureNativeSceneHandle(candidate), null, `${field}: ${JSON.stringify(value)}`);
      assert.throws(() => nativeSceneCompletionPath(candidate), TypeError);
    }
  }
  const boundary = handle("d".repeat(160), "j".repeat(160));
  assert.deepEqual(captureNativeSceneHandle(boundary), boundary);
  assert.deepEqual(captureNativeSceneHandle(Object.assign(Object.create(null), handle())), handle());
});

test("native Scene completion URLs reject aliases, duplicate segments, traversal, and noncanonical encodings", () => {
  const path = nativeSceneCompletionPath(handle());
  const prefix = "/api/retained-output/scene/jobs/";
  const faults = [
    null, undefined, {}, path, "//forma.test" + path,
    "ftp://forma.test" + path, "HTTPS://forma.test" + path, "https://FORMA.test" + path,
    "https://forma.test:443" + path, "http://forma.test:80" + path,
    "https://user:secret@forma.test" + path, "https://@forma.test" + path,
    ORIGIN + path + "?", ORIGIN + path + "?document=x&document=x",
    ORIGIN + path + "#", ORIGIN + path + "#main-content",
    " " + ORIGIN + path, ORIGIN + path + "\n", ORIGIN + path + "\u007f",
    ORIGIN + prefix + "document-scene\\job-scene",
    ORIGIN + path + "/", ORIGIN + path + "/job-scene",
    ORIGIN + prefix + "/document-scene/job-scene",
    ORIGIN + prefix + "discard/../document-scene/job-scene",
    ORIGIN + prefix + "discard/%2e%2e/document-scene/job-scene",
    ORIGIN + prefix + "%252e%252e/job-scene",
    ORIGIN + prefix + "%64ocument-scene/job-scene",
    ORIGIN + prefix + "document%2Fscene/job-scene",
    ORIGIN + prefix + "document%253Ascene/job-scene",
    ORIGIN + prefix + "document%3ascene/job-scene",
    ORIGIN + prefix + "%ZZ/job-scene",
    ORIGIN + "/api/retained-output/Scene/jobs/document-scene/job-scene",
    ORIGIN + "/api/retained-output/scene/jobs/" + "d".repeat(4100) + "/job-scene",
  ];
  for (const value of faults) {
    assert.equal(parseNativeSceneCompletionUrl(value), null, String(value));
  }
});

test("native Scene completion rejects foreign jobs, edited selections, and malformed receipt fields", () => {
  const faults = [
    ["schema", value => { value.schemaVersion = 2; }],
    ["string schema", value => { value.schemaVersion = "1"; }],
    ["kind", value => { value.kind = "native-short-story-completion"; }],
    ["handle Document", value => { value.handle.documentId = "foreign-document"; }],
    ["handle job", value => { value.handle.jobId = "foreign-job"; }],
    ["selection Document", value => { value.selection.documentId = "foreign-document"; }],
    ["edited revision", value => { value.selection.revision = 1; }],
    ["negative revision", value => { value.selection.revision = -1; }],
    ["string revision", value => { value.selection.revision = "0"; }],
    ["missing artifact", value => { delete value.selection.artifactId; }],
    ["empty artifact", value => { value.selection.artifactId = ""; }],
    ["unsafe artifact", value => { value.selection.artifactId = "../artifact"; }],
    ["short hash", value => { value.selection.contentSha256 = "a".repeat(63); }],
    ["long hash", value => { value.selection.contentSha256 = "a".repeat(65); }],
    ["nonhex hash", value => { value.selection.contentSha256 = "g".repeat(64); }],
    ["uppercase hash", value => { value.selection.contentSha256 = "A".repeat(64); }],
    ["numeric hash", value => { value.selection.contentSha256 = 123; }],
    ["extra root", value => { value.contentMarkdown = "a body is not a completion handle"; }],
    ["extra handle", value => { value.handle.status = "completed"; }],
    ["extra selection", value => { value.selection.kind = "scene"; }],
    ["missing expiry", value => { delete value.expiresAt; }],
    ["non-string expiry", value => { value.expiresAt = NOW + 60000; }],
  ];
  for (const [name, mutate] of faults) {
    const value = completion(); mutate(value);
    assert.equal(validateNativeSceneCompletion(value, handle(), NOW), null, name);
  }
  for (const value of [null, undefined, [], {}, true, JSON.stringify(completion())]) {
    assert.equal(validateNativeSceneCompletion(value, handle(), NOW), null);
  }
  for (const expected of [null, {}, { ...handle(), extra: true }, handle("foreign-document"), handle("document-scene", "foreign-job")]) {
    assert.equal(validateNativeSceneCompletion(completion(), expected, NOW), null);
  }
});

test("native Scene completion requires canonical future ISO expiry at the current validation instant", () => {
  const value = completion(), expires = Date.parse(value.expiresAt);
  assert.deepEqual(validateNativeSceneCompletion(value, handle(), expires - 1), value);
  for (const now of [expires, expires + 1, NaN, Infinity, -Infinity]) {
    assert.equal(validateNativeSceneCompletion(value, handle(), now), null, String(now));
  }
  for (const expiresAt of ["2030-01-01T00:01:00Z", "2030-01-01T01:01:00.000+01:00",
    "2030-01-01T00:01:00.000", "2030-01-01", "not-a-date", "",
    "2030-01-01T00:01:00.000Z ", new Date(NOW).toISOString()]) {
    assert.equal(validateNativeSceneCompletion({ ...value, expiresAt }, handle(), NOW), null, expiresAt);
  }
});

test("native Scene completion inspects own data descriptors without invoking accessors", () => {
  let calls = 0;
  for (const [layer, field] of [["root", "expiresAt"], ["handle", "jobId"], ["selection", "artifactId"]]) {
    const value = completion(), row = layer === "root" ? value : value[layer], saved = row[field];
    Object.defineProperty(row, field, { enumerable: true, get() { calls++; return saved; } });
    assert.equal(validateNativeSceneCompletion(value, handle(), NOW), null, layer);
  }
  const expected = handle();
  Object.defineProperty(expected, "jobId", { enumerable: true, get() { calls++; return "job-scene"; } });
  assert.equal(captureNativeSceneHandle(expected), null);
  assert.equal(validateNativeSceneCompletion(completion(), expected, NOW), null);
  assert.equal(calls, 0, "validation must not execute received getter code");

  for (const layer of ["root", "handle", "selection"]) {
    const extra = completion(), extraRow = layer === "root" ? extra : extra[layer];
    extraRow[Symbol("foreign")] = true;
    assert.equal(validateNativeSceneCompletion(extra, handle(), NOW), null, `${layer} symbol`);
    const hidden = completion(), hiddenRow = layer === "root" ? hidden : hidden[layer];
    const field = layer === "root" ? "expiresAt" : layer === "handle" ? "jobId" : "artifactId";
    Object.defineProperty(hiddenRow, field, { value: hiddenRow[field], enumerable: false });
    assert.equal(validateNativeSceneCompletion(hidden, handle(), NOW), null, `${layer} hidden field`);
    const inherited = completion(), row = layer === "root" ? inherited : inherited[layer];
    Object.setPrototypeOf(row, { inherited: true });
    assert.equal(validateNativeSceneCompletion(inherited, handle(), NOW), null, `${layer} custom prototype`);
  }
  const value = completion();
  Object.setPrototypeOf(value, null); Object.setPrototypeOf(value.handle, null); Object.setPrototypeOf(value.selection, null);
  assert.deepEqual(validateNativeSceneCompletion(value, handle(), NOW), completion());
});

test("native Scene completion never admits oversized content envelopes as selection receipts", () => {
  // Closed bounded IDs keep a valid selection receipt below 8192 bytes. These
  // malformed envelopes do not isolate the byte-limit predicate from shape checks.
  for (const contentMarkdown of ["x".repeat(8193), "🌱".repeat(2049)]) {
    const value = { ...completion(), contentMarkdown };
    assert.ok(Buffer.byteLength(JSON.stringify(value), "utf8") > 8192);
    assert.equal(validateNativeSceneCompletion(value, handle(), NOW), null);
  }
});

test("native Scene retained route uses only an unexpired exact completion selection", () => {
  const expected = handle("document:scene.1", "job:scene.1");
  const value = completion(expected, new Date(Date.now() + 3600000).toISOString());
  value.selection.artifactId = "artifact:scene.1";
  assert.equal(nativeSceneRetainedRoute(value, expected),
    "/make/scene?document=document%3Ascene.1&artifact=artifact%3Ascene.1&revision=0&sha256=" + SHA);
  assert.equal(nativeSceneRetainedRoute(value, handle(expected.documentId, "foreign-job")), null);
  assert.equal(nativeSceneRetainedRoute({ ...value, expiresAt: new Date(Date.now() - 1).toISOString() }, expected), null);
  assert.equal(nativeSceneRetainedRoute({ ...value, selection: { ...value.selection, revision: 1 } }, expected), null);
  assert.equal(nativeSceneRetainedRoute({ ...value, contentMarkdown: "not selection data" }, expected), null);
});

test("native Scene completion remains disjoint from the unchanged direct Story contract", () => {
  const scene = freshCompletion(), expected = handle();
  const story = { ...scene, kind: "native-short-story-completion" };
  assert.deepEqual(validateNativeStoryCompletion(story, expected), story);
  assert.equal(nativeStoryCompletionPath(expected), "/api/retained-story/jobs/document-scene/job-scene");
  assert.deepEqual(parseNativeStoryCompletionUrl(ORIGIN + nativeStoryCompletionPath(expected)), expected);
  assert.equal(nativeStoryRetainedRoute(story, expected),
    "/make/short-story?document=document-scene&artifact=artifact-scene&revision=0&sha256=" + SHA);
  assert.equal(validateNativeStoryCompletion(scene, expected), null);
  assert.equal(validateNativeSceneCompletion(story, expected), null);
  assert.equal(parseNativeSceneCompletionUrl(ORIGIN + nativeStoryCompletionPath(expected)), null);
  assert.equal(parseNativeStoryCompletionUrl(ORIGIN + nativeSceneCompletionPath(expected)), null);
  assert.equal(nativeStoryRetainedRoute(scene, expected), null);
  assert.equal(nativeSceneRetainedRoute(story, expected), null);
});
