import assert from "node:assert/strict";
import test from "node:test";
import { readRetainedShortStory } from "../src/model/retained-short-story-client.ts";
import { RETAINED_STORY_JSON_MAX_BYTES, retainedStoryRequestPath } from "../src/model/retained-short-story.ts";
import { readNativeStoryCompletion } from "../src/model/retained-short-story-client.ts";
import { nativeStoryCompletionPath, NATIVE_STORY_COMPLETION_MAX_BYTES } from "../src/model/native-short-story-generation.ts";
import { readNativeRetainedOutput } from "../src/model/retained-short-story-client.ts";
import { nativeRetainedOutputRequestPath, NATIVE_RETAINED_OUTPUT_JSON_MAX_BYTES } from "../src/model/native-retained-output.ts";
import { readNativeSceneCompletion } from "../src/model/retained-short-story-client.ts";
import { nativeSceneCompletionPath } from "../src/model/native-scene-completion.ts";

// Constructed Response objects model an already received same-origin selector
// response. These controls do not exercise browser networking, Store or custody.
const origin = "https://forma.test";
const selected = () => ({ documentId: "doc-story", artifactId: "artifact-story", revision: 2, contentSha256: "a".repeat(64) });
const result = (selection = selected()) => ({ schemaVersion: 1, kind: "native-retained-short-story", selection,
  title: "  <script>literal</script>\r\nمرحبا  ", contentMarkdown: "\ufeffFirst\r\n\r\n  last <>&\t\n", expiresAt: "2099-01-01T00:00:00.000Z" });
const encoder = new TextEncoder();
function responseFor(selection, body, options = {}) {
  const response = new Response(body, { status: options.status ?? 200,
    headers: options.headers ?? { "content-type": "application/json" } });
  Object.defineProperty(response, "url", { value: options.url ?? new URL(retainedStoryRequestPath(selection), origin).href });
  if (options.redirected) Object.defineProperty(response, "redirected", { value: true });
  return response;
}
function controls(request, overrides = {}) {
  return { origin, signal: new AbortController().signal, current: () => true, request, ...overrides };
}

test("retained story client preserves literal content through one exact bounded GET", async () => {
  const selection = selected(), body = result(selection), encoded = encoder.encode(JSON.stringify(body));
  const calls = [];
  const response = responseFor(selection, encoded, { headers: { "content-type": "application/json; charset=utf-8", "content-length": String(encoded.length) } });
  const settings = controls(async (...args) => { calls.push(args); return response; });
  const value = await readRetainedShortStory(selection, settings);
  assert.deepEqual(value, body);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.selection), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], retainedStoryRequestPath(selection));
  assert.deepEqual(calls[0][1], { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { accept: "application/json" }, signal: settings.signal });
  assert.equal(response.body.locked, false);
});

test("retained story client snapshots the requested identity before awaiting headers", async () => {
  const selection = selected(), original = { ...selection }, body = result(original);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const pending = readRetainedShortStory(selection, controls(async (...args) => { calls.push(args); await gate; return responseFor(original, JSON.stringify(body)); }));
  selection.artifactId = "different-story";
  selection.contentSha256 = "b".repeat(64);
  release();
  const value = await pending;
  assert.deepEqual(value.selection, original);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], retainedStoryRequestPath(original));
});

for (const status of [401, 403, 404, 409, 410, 500]) {
  test(`retained story client withholds status ${status} and cancels its unread body`, async () => {
    const selection = selected();
    let calls = 0, pulls = 0, cancels = 0;
    const stream = new ReadableStream({ pull() { pulls++; }, cancel() { cancels++; } }, { highWaterMark: 0 });
    const response = responseFor(selection, stream, { status });
    await assert.rejects(readRetainedShortStory(selection, controls(async () => { calls++; return response; })), { message: "retained_story_unavailable" });
    assert.equal(calls, 1); assert.equal(pulls, 0); assert.equal(cancels, 1); assert.equal(response.body.locked, false);
  });
}

const headerFaults = [
  ["redirect", { redirected: true }],
  ["foreign URL", { url: "https://elsewhere.test/api/retained-story/doc-story/artifact-story" }],
  ["different exact query", { url: new URL(retainedStoryRequestPath(selected()) + "&extra=1", origin).href }],
  ["wrong content type", { headers: { "content-type": "text/html" } }],
  ["oversize declared body", { headers: { "content-type": "application/json", "content-length": String(RETAINED_STORY_JSON_MAX_BYTES + 1) } }],
  ["invalid declared body", { headers: { "content-type": "application/json", "content-length": "1e3" } }],
];
for (const [name, options] of headerFaults) {
  test(`retained story client rejects ${name} before reading body bytes`, async () => {
    const selection = selected();
    let calls = 0, pulls = 0, cancels = 0;
    const stream = new ReadableStream({ pull() { pulls++; }, cancel() { cancels++; } }, { highWaterMark: 0 });
    const response = responseFor(selection, stream, options);
    await assert.rejects(readRetainedShortStory(selection, controls(async () => { calls++; return response; })), { message: "retained_story_unavailable" });
    assert.equal(calls, 1); assert.equal(pulls, 0); assert.equal(cancels, 1); assert.equal(response.body.locked, false);
  });
}

test("retained story client measures overflow before decoding the streamed body", async () => {
  const selection = selected();
  let pulls = 0, cancels = 0;
  const stream = new ReadableStream({ pull(controller) {
    pulls++;
    controller.enqueue(pulls === 1 ? new Uint8Array(RETAINED_STORY_JSON_MAX_BYTES) : new Uint8Array([1]));
  }, cancel() { cancels++; } }, { highWaterMark: 0 });
  const response = responseFor(selection, stream);
  await assert.rejects(readRetainedShortStory(selection, controls(async () => response)), { message: "retained_story_unavailable" });
  assert.equal(pulls, 2); assert.equal(cancels, 1); assert.equal(response.body.locked, false);
});

test("retained story client rejects a zero-byte nondone chunk without retaining or looping", async () => {
  const selection = selected(); let pulls = 0, cancels = 0;
  const stream = new ReadableStream({ pull(controller) {
    pulls++; controller.enqueue(new Uint8Array(0));
  }, cancel() { cancels++; } }, { highWaterMark: 0 });
  const response = responseFor(selection, stream);
  await assert.rejects(readRetainedShortStory(selection, controls(async () => response)), { message: "retained_story_unavailable" });
  assert.equal(pulls, 1); assert.equal(cancels, 1); assert.equal(response.body.locked, false);
});

test("retained story client rejects a non-byte nondone chunk before byte accounting", async () => {
  const selection = selected(); let pulls = 0, cancels = 0;
  const stream = new ReadableStream({ pull(controller) {
    pulls++; controller.enqueue("not bytes");
  }, cancel() { cancels++; } }, { highWaterMark: 0 });
  const response = responseFor(selection, stream);
  await assert.rejects(readRetainedShortStory(selection, controls(async () => response)), { message: "retained_story_unavailable" });
  assert.equal(pulls, 1); assert.equal(cancels, 1); assert.equal(response.body.locked, false);
});

test("retained story client preserves failure and releases its lock while cancellation stays pending", { timeout: 1000 }, async () => {
  const selection = selected(); let pulls = 0, cancels = 0;
  const stream = new ReadableStream({ pull(controller) {
    pulls++; controller.enqueue(new Uint8Array(0));
  }, cancel() { cancels++; return new Promise(() => {}); } }, { highWaterMark: 0 });
  const response = responseFor(selection, stream);
  await assert.rejects(readRetainedShortStory(selection, controls(async () => response)), { message: "retained_story_unavailable" });
  assert.equal(pulls, 1); assert.equal(cancels, 1); assert.equal(response.body.locked, false);
});

test("retained story client rejects a declared versus received byte mismatch", async () => {
  const selection = selected(), bytes = encoder.encode(JSON.stringify(result(selection)));
  const response = responseFor(selection, bytes, { headers: { "content-type": "application/json", "content-length": String(bytes.length + 1) } });
  await assert.rejects(readRetainedShortStory(selection, controls(async () => response)), { message: "retained_story_unavailable" });
  assert.equal(response.body.locked, false);
});

test("retained story client measures decoded bytes independently of compressed Content-Length", async () => {
  const selection = selected(), body = result(selection), bytes = encoder.encode(JSON.stringify(body));
  const calls = [];
  // Model Fetch's post-decompression stream, not a gzip implementation test.
  const response = responseFor(selection, bytes, { headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "99" } });
  const value = await readRetainedShortStory(selection, controls(async (...args) => { calls.push(args); return response; }));
  assert.notEqual(bytes.length, 99);
  assert.deepEqual(value, body);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].headers, { accept: "application/json" });
  assert.equal(response.body.locked, false);
});

test("retained story client rejects invalid UTF-8 without a positive payload", async () => {
  const selection = selected(), response = responseFor(selection, new Uint8Array([0x22, 0xff, 0x22]));
  await assert.rejects(readRetainedShortStory(selection, controls(async () => response)), TypeError);
  assert.equal(response.body.locked, false);
});

test("retained story client refuses a response for another native content hash", async () => {
  const selection = selected(), body = result({ ...selection, contentSha256: "b".repeat(64) });
  const response = responseFor(selection, JSON.stringify(body));
  await assert.rejects(readRetainedShortStory(selection, controls(async () => response)), { message: "retained_story_unavailable" });
  assert.equal(response.body.locked, false);
});

test("retained story client abort before dispatch makes no request", async () => {
  const abort = new AbortController(); abort.abort();
  let calls = 0;
  await assert.rejects(readRetainedShortStory(selected(), controls(async () => { calls++; throw new Error("must not dispatch"); }, { signal: abort.signal })), { message: "retained_story_withdrawn" });
  assert.equal(calls, 0);
});

test("retained story client checks current authority after headers before reading", async () => {
  const selection = selected(); let active = true, pulls = 0, cancels = 0;
  const stream = new ReadableStream({ pull() { pulls++; }, cancel() { cancels++; } }, { highWaterMark: 0 });
  const response = responseFor(selection, stream);
  await assert.rejects(readRetainedShortStory(selection, controls(async () => { active = false; return response; }, { current: () => active })), { message: "retained_story_withdrawn" });
  assert.equal(pulls, 0); assert.equal(cancels, 1); assert.equal(response.body.locked, false);
});

test("retained story client checks retirement after the first awaited body read", async () => {
  const selection = selected(); let active = true, pulls = 0, cancels = 0;
  const stream = new ReadableStream({ pull(controller) {
    pulls++; active = false; controller.enqueue(encoder.encode(JSON.stringify(result(selection))));
  }, cancel() { cancels++; } }, { highWaterMark: 0 });
  const response = responseFor(selection, stream);
  await assert.rejects(readRetainedShortStory(selection, controls(async () => response, { current: () => active })), { message: "retained_story_withdrawn" });
  assert.equal(pulls, 1); assert.equal(cancels, 1); assert.equal(response.body.locked, false);
});

// Detached source proposals only: these additions have not been executed.
const nativeHandle = () => ({ documentId: "doc-story", jobId: "job-story" });
const nativeCompletion = (handle = nativeHandle()) => ({ schemaVersion: 1, kind: "native-short-story-completion", handle,
  selection: { ...selected(), documentId: handle.documentId, revision: 0 }, expiresAt: "2099-01-01T00:00:00.000Z" });
function nativeResponseFor(handle, body, options = {}) {
  return responseFor(selected(), body, { ...options, url: options.url ?? new URL(nativeStoryCompletionPath(handle), origin).href });
}

test("native completion client snapshots the acknowledged handle and makes one exact no-store GET", async () => {
  const handle = nativeHandle(), original = { ...handle }, receipt = nativeCompletion(original);
  const encoded = encoder.encode(JSON.stringify(receipt)), calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const response = nativeResponseFor(original, encoded, {
    headers: { "content-type": "application/json; charset=utf-8", "content-length": String(encoded.length) },
  });
  const settings = controls(async (...args) => { calls.push(args); await gate; return response; });
  const pending = readNativeStoryCompletion(handle, settings);
  handle.documentId = "other-document";
  handle.jobId = "other-job";
  release();
  const value = await pending;
  assert.deepEqual(value, receipt);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.handle), true);
  assert.equal(Object.isFrozen(value.selection), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], nativeStoryCompletionPath(original));
  assert.deepEqual(calls[0][1], { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { accept: "application/json" }, signal: settings.signal });
  assert.equal(response.body.locked, false);
});

test("native completion client withdraws on abort or retired epoch before dispatch, after headers and after a chunk", async t => {
  for (const phase of ["before", "headers", "chunk"]) {
    for (const cause of ["abort", "epoch"]) {
      await t.test(`${cause} ${phase}`, async () => {
        const handle = nativeHandle(), abort = new AbortController();
        let currentEpoch = 7, calls = 0, pulls = 0, cancels = 0;
        const withdraw = () => { if (cause === "abort") abort.abort(); else currentEpoch++; };
        if (phase === "before") withdraw();
        const stream = new ReadableStream({ pull(controller) {
          pulls++;
          if (phase === "chunk") withdraw();
          controller.enqueue(encoder.encode(JSON.stringify(nativeCompletion(handle))));
        }, cancel() { cancels++; } }, { highWaterMark: 0 });
        const response = nativeResponseFor(handle, stream);
        await assert.rejects(readNativeStoryCompletion(handle, controls(async () => {
          calls++;
          if (phase === "headers") withdraw();
          return response;
        }, { signal: abort.signal, current: () => currentEpoch === 7 })), { message: "retained_story_withdrawn" });
        assert.equal(calls, phase === "before" ? 0 : 1);
        assert.equal(pulls, phase === "chunk" ? 1 : 0);
        assert.equal(cancels, phase === "before" ? 0 : 1);
        assert.equal(response.body.locked, false);
      });
    }
  }
});

test("native completion client rejects unavailable, oversized or invalid completed receipts without retry", async t => {
  for (const fault of ["pending", "unavailable", "wrong-url", "wrong-document", "wrong-job", "edited-revision", "short-hash", "expired", "raw-field", "declared-overflow", "decoded-overflow"]) {
    await t.test(fault, async () => {
      const handle = nativeHandle(), receipt = nativeCompletion(handle), options = {};
      let calls = 0, pulls = 0, cancels = 0;
      if (fault === "pending") options.status = 202;
      else if (fault === "unavailable") options.status = 404;
      else if (fault === "wrong-url") options.url = new URL(nativeStoryCompletionPath({ ...handle, jobId: "another-job" }), origin).href;
      else if (fault === "wrong-document") receipt.selection.documentId = "another-document";
      else if (fault === "wrong-job") receipt.handle = { ...handle, jobId: "another-job" };
      else if (fault === "edited-revision") receipt.selection.revision = 1;
      else if (fault === "short-hash") receipt.selection.contentSha256 = "a".repeat(63);
      else if (fault === "expired") receipt.expiresAt = "2020-01-01T00:00:00.000Z";
      else if (fault === "raw-field") receipt.contentMarkdown = "A completion receipt may not transport content.";
      else if (fault === "declared-overflow") options.headers = { "content-type": "application/json", "content-length": String(NATIVE_STORY_COMPLETION_MAX_BYTES + 1) };
      const body = fault.endsWith("overflow") ? new ReadableStream({ pull(controller) {
        pulls++;
        controller.enqueue(pulls === 1 ? new Uint8Array(NATIVE_STORY_COMPLETION_MAX_BYTES) : new Uint8Array([1]));
      }, cancel() { cancels++; } }, { highWaterMark: 0 }) : JSON.stringify(receipt);
      const response = nativeResponseFor(handle, body, options);
      await assert.rejects(readNativeStoryCompletion(handle, controls(async () => { calls++; return response; })), { message: "retained_story_unavailable" });
      assert.equal(calls, 1, "completion failure must neither poll nor resubmit");
      if (fault.endsWith("overflow")) {
        assert.equal(pulls, fault === "declared-overflow" ? 0 : 2);
        assert.equal(cancels, 1);
      }
      assert.equal(response.body.locked, false);
    });
  }
});

const retainedOutputTarget = output => ({ output, selection: selected() });
const retainedOutputResult = target => ({ schemaVersion: 1, kind: "native-retained-output", output: target.output,
  selection: { ...target.selection }, title: "  <script>literal output</script>\r\nمرحبا  ",
  expiresAt: "2099-01-01T00:00:00.000Z",
  content: target.output === "scene"
    ? { content_markdown: "\ufeff# Scene\r\n\r\n  last <>&\t\n", medium: "visual" }
    : { items: [{ title: "  <b>Slide</b> مرحبا  ", body: "\ufeffFirst\r\n\r\n  last <>&\t\n", notes: "", image_prompt: "", slide: null }], presentation: null },
});
function retainedOutputResponseFor(target, body, options = {}) {
  return responseFor(target.selection, body, {
    ...options, url: options.url ?? new URL(nativeRetainedOutputRequestPath(target), origin).href,
  });
}

for (const output of ["scene", "slides"]) {
  test(`native retained ${output} client preserves literal content through one exact bounded GET`, async () => {
    const target = retainedOutputTarget(output), body = retainedOutputResult(target);
    const bytes = encoder.encode(JSON.stringify(body)), calls = [];
    const response = retainedOutputResponseFor(target, bytes, {
      headers: { "content-type": "application/json; charset=utf-8", "content-length": String(bytes.length) },
    });
    const settings = controls(async (...args) => { calls.push(args); return response; });
    const value = await readNativeRetainedOutput(target, settings);
    assert.deepEqual(value, body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], nativeRetainedOutputRequestPath(target));
    assert.deepEqual(calls[0][1], { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { accept: "application/json" }, signal: settings.signal });
    assert.equal(response.body.locked, false);
  });
}

test("native retained output client snapshots the format and nested selection before awaiting headers", async t => {
  for (const output of ["scene", "slides"]) {
    await t.test(output, async () => {
      const target = retainedOutputTarget(output), original = { output, selection: { ...target.selection } };
      const body = retainedOutputResult(original), calls = [];
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const pending = readNativeRetainedOutput(target, controls(async (...args) => {
        calls.push(args); await gate; return retainedOutputResponseFor(original, JSON.stringify(body));
      }));
      target.output = output === "scene" ? "slides" : "scene";
      target.selection.documentId = "other-document";
      target.selection.artifactId = "other-artifact";
      target.selection.revision++;
      target.selection.contentSha256 = "b".repeat(64);
      release();
      assert.deepEqual(await pending, body);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], nativeRetainedOutputRequestPath(original));
    });
  }
});

test("native retained output client rejects a response for another format or selected identity", async t => {
  for (const output of ["scene", "slides"]) {
    for (const fault of ["output", "documentId", "artifactId", "revision", "contentSha256"]) {
      await t.test(`${output} ${fault}`, async () => {
        const target = retainedOutputTarget(output);
        const received = { output: fault === "output" ? (output === "scene" ? "slides" : "scene") : output,
          selection: { ...target.selection } };
        if (fault === "revision") received.selection.revision++;
        else if (fault === "contentSha256") received.selection.contentSha256 = "b".repeat(64);
        else if (fault !== "output") received.selection[fault] = `other-${fault}`;
        const response = retainedOutputResponseFor(target, JSON.stringify(retainedOutputResult(received)));
        let calls = 0;
        await assert.rejects(readNativeRetainedOutput(target, controls(async () => { calls++; return response; })),
          { message: "retained_story_unavailable" });
        assert.equal(calls, 1);
        assert.equal(response.body.locked, false);
      });
    }
  }
});

test("native retained output client rejects foreign response headers and declared or streamed overflow", async t => {
  for (const output of ["scene", "slides"]) {
    for (const fault of ["foreign-url", "declared-overflow", "streamed-overflow"]) {
      await t.test(`${output} ${fault}`, async () => {
        const target = retainedOutputTarget(output), options = {};
        let calls = 0, pulls = 0, cancels = 0;
        if (fault === "foreign-url") options.url = new URL(nativeRetainedOutputRequestPath(target), "https://elsewhere.test").href;
        else if (fault === "declared-overflow") options.headers = {
          "content-type": "application/json", "content-length": String(NATIVE_RETAINED_OUTPUT_JSON_MAX_BYTES + 1),
        };
        const stream = new ReadableStream({ pull(controller) {
          pulls++;
          controller.enqueue(pulls === 1 ? new Uint8Array(NATIVE_RETAINED_OUTPUT_JSON_MAX_BYTES) : new Uint8Array([1]));
        }, cancel() { cancels++; } }, { highWaterMark: 0 });
        const response = retainedOutputResponseFor(target, stream, options);
        await assert.rejects(readNativeRetainedOutput(target, controls(async () => { calls++; return response; })),
          { message: "retained_story_unavailable" });
        assert.equal(calls, 1);
        assert.equal(pulls, fault === "streamed-overflow" ? 2 : 0);
        assert.equal(cancels, 1);
        assert.equal(response.body.locked, false);
      });
    }
  }
});

test("native retained output client withholds content when current authority changes after headers or a chunk", async t => {
  for (const output of ["scene", "slides"]) {
    for (const phase of ["headers", "chunk"]) {
      await t.test(`${output} ${phase}`, async () => {
        const target = retainedOutputTarget(output);
        let active = true, calls = 0, pulls = 0, cancels = 0;
        const stream = new ReadableStream({ pull(controller) {
          pulls++; active = false;
          controller.enqueue(encoder.encode(JSON.stringify(retainedOutputResult(target))));
        }, cancel() { cancels++; } }, { highWaterMark: 0 });
        const response = retainedOutputResponseFor(target, stream);
        await assert.rejects(readNativeRetainedOutput(target, controls(async () => {
          calls++; if (phase === "headers") active = false; return response;
        }, { current: () => active })), { message: "retained_story_withdrawn" });
        assert.equal(calls, 1);
        assert.equal(pulls, phase === "chunk" ? 1 : 0);
        assert.equal(cancels, 1);
        assert.equal(response.body.locked, false);
      });
    }
  }
});

test("native retained output client forwards abort to the pending request without retry", { timeout: 1000 }, async t => {
  // The test deadline only bounds a regression; the client has no independent timeout.
  for (const output of ["scene", "slides"]) {
    await t.test(output, async () => {
      const target = retainedOutputTarget(output), abort = new AbortController();
      const reason = new DOMException("Read aborted", "AbortError");
      let calls = 0, observedSignal;
      const pending = readNativeRetainedOutput(target, controls(async (_path, init) => {
        calls++; observedSignal = init.signal;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        });
      }, { signal: abort.signal }));
      const rejected = assert.rejects(pending, error => error === reason);
      abort.abort(reason);
      await rejected;
      assert.equal(calls, 1);
      assert.equal(observedSignal, abort.signal);
    });
  }
});

// Verified controls: Scene adaptations of the three native Story completion controls
// above. Reuse their Response, cancellation, and streaming ports unchanged.
const sceneCompletionHandle = () => ({ documentId: "doc-scene", jobId: "job-scene" });
const sceneCompletionReceipt = (handle = sceneCompletionHandle()) => ({ schemaVersion: 1, kind: "native-scene-completion", handle,
  selection: { documentId: handle.documentId, artifactId: "artifact-scene", revision: 0, contentSha256: "a".repeat(64) },
  expiresAt: "2099-01-01T00:00:00.000Z" });
const sceneCompletionMaxBytes = 8192;
function sceneCompletionResponseFor(handle, body, options = {}) {
  return responseFor(selected(), body, { ...options, url: options.url ?? new URL(nativeSceneCompletionPath(handle), origin).href });
}

test("native Scene completion client snapshots the acknowledged handle and makes one exact no-store GET", async () => {
  const handle = sceneCompletionHandle(), original = { ...handle }, receipt = sceneCompletionReceipt(original);
  const encoded = encoder.encode(JSON.stringify(receipt)), calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const response = sceneCompletionResponseFor(original, encoded, {
    headers: { "content-type": "application/json; charset=utf-8", "content-length": String(encoded.length) },
  });
  const settings = controls(async (...args) => { calls.push(args); await gate; return response; });
  const pending = readNativeSceneCompletion(handle, settings);
  handle.documentId = "other-document";
  handle.jobId = "other-job";
  release();
  const value = await pending;
  assert.deepEqual(value, receipt);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.handle), true);
  assert.equal(Object.isFrozen(value.selection), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], nativeSceneCompletionPath(original));
  assert.equal(calls[0][0], "/api/retained-output/scene/jobs/doc-scene/job-scene");
  assert.deepEqual(calls[0][1], { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { accept: "application/json" }, signal: settings.signal });
  assert.equal(response.body.locked, false);
});

test("native Scene completion client withdraws on abort or retired epoch before dispatch, after headers and after a chunk", async t => {
  for (const phase of ["before", "headers", "chunk"]) {
    for (const cause of ["abort", "epoch"]) {
      await t.test(`${cause} ${phase}`, async () => {
        const handle = sceneCompletionHandle(), abort = new AbortController();
        let currentEpoch = 7, calls = 0, pulls = 0, cancels = 0;
        const withdraw = () => { if (cause === "abort") abort.abort(); else currentEpoch++; };
        if (phase === "before") withdraw();
        const stream = new ReadableStream({ pull(controller) {
          pulls++;
          if (phase === "chunk") withdraw();
          controller.enqueue(encoder.encode(JSON.stringify(sceneCompletionReceipt(handle))));
        }, cancel() { cancels++; } }, { highWaterMark: 0 });
        const response = sceneCompletionResponseFor(handle, stream);
        await assert.rejects(readNativeSceneCompletion(handle, controls(async () => {
          calls++;
          if (phase === "headers") withdraw();
          return response;
        }, { signal: abort.signal, current: () => currentEpoch === 7 })), { message: "retained_story_withdrawn" });
        assert.equal(calls, phase === "before" ? 0 : 1);
        assert.equal(pulls, phase === "chunk" ? 1 : 0);
        assert.equal(cancels, phase === "before" ? 0 : 1);
        assert.equal(response.body.locked, false);
      });
    }
  }
});

test("native Scene completion client rejects unavailable, oversized or invalid completed receipts without retry", async t => {
  for (const fault of ["pending", "unavailable", "wrong-url", "foreign-url", "wrong-kind", "wrong-document", "wrong-job", "edited-revision", "short-hash", "expired", "raw-field", "declared-overflow", "decoded-overflow"]) {
    await t.test(fault, async () => {
      const handle = sceneCompletionHandle(), receipt = sceneCompletionReceipt(handle), options = {};
      let calls = 0, pulls = 0, cancels = 0;
      if (fault === "pending") options.status = 202;
      else if (fault === "unavailable") options.status = 404;
      else if (fault === "wrong-url") options.url = new URL(nativeSceneCompletionPath({ ...handle, jobId: "another-job" }), origin).href;
      else if (fault === "foreign-url") options.url = new URL(nativeSceneCompletionPath(handle), "https://elsewhere.test").href;
      else if (fault === "wrong-kind") receipt.kind = "native-short-story-completion";
      else if (fault === "wrong-document") receipt.selection.documentId = "another-document";
      else if (fault === "wrong-job") receipt.handle = { ...handle, jobId: "another-job" };
      else if (fault === "edited-revision") receipt.selection.revision = 1;
      else if (fault === "short-hash") receipt.selection.contentSha256 = "a".repeat(63);
      else if (fault === "expired") receipt.expiresAt = "2020-01-01T00:00:00.000Z";
      else if (fault === "raw-field") receipt.contentMarkdown = "A completion receipt may not transport content.";
      else if (fault === "declared-overflow") options.headers = { "content-type": "application/json", "content-length": String(sceneCompletionMaxBytes + 1) };
      const body = fault.endsWith("overflow") ? new ReadableStream({ pull(controller) {
        pulls++;
        controller.enqueue(pulls === 1 ? new Uint8Array(sceneCompletionMaxBytes) : new Uint8Array([1]));
      }, cancel() { cancels++; } }, { highWaterMark: 0 }) : JSON.stringify(receipt);
      const response = sceneCompletionResponseFor(handle, body, options);
      await assert.rejects(readNativeSceneCompletion(handle, controls(async () => { calls++; return response; })), { message: "retained_story_unavailable" });
      assert.equal(calls, 1, "completion failure must neither poll nor resubmit");
      if (fault.endsWith("overflow")) {
        assert.equal(pulls, fault === "declared-overflow" ? 0 : 2);
        assert.equal(cancels, 1);
      }
      assert.equal(response.body.locked, false);
    });
  }
  await t.test("invalid handle never dispatches", async () => {
    let calls = 0;
    await assert.rejects(readNativeSceneCompletion({ documentId: "doc-scene", jobId: "" }, controls(async () => {
      calls++; throw new Error("must not dispatch");
    })), { message: "invalid_native_scene_handle" });
    assert.equal(calls, 0);
  });
});
