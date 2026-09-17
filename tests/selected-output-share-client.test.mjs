import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
const { createSelectedOutputShareClient } = await import("../src/selected-output-share-client.ts");
const { projectSelectedOutputShareCandidate } = await import("../src/model/selected-output-share.ts");
imports.deregister();

const origin = "https://forma.test", base = origin + "/api/selected-output-shares";
const unavailable = error => error instanceof Error && error.message === "selected_output_share_unavailable";
const selection = output => ({ output, documentId: "document-1", artifactId: "artifact-1", revision: 0, contentSha256: "a".repeat(64) });
const review = () => ({ title: "  Reviewed 日本語 العربية  ", expiresAt: new Date(Date.now() + 3600000).toISOString() });
const metadata = () => ({ shareId: "old-share", title: "Old reviewed title", output: "short_story", revision: 0,
  issuedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-02T00:00:00.000Z" });
const cursor = (id = "old-share") => Buffer.from(JSON.stringify(["2020-01-01T00:00:00.000Z", id])).toString("base64url");
async function candidate(output = "short_story", choices = review()) {
  const selected = selection(output), { output: _output, ...nativeSelection } = selected;
  const native = { schemaVersion: 1, selection: nativeSelection, title: "Private native title",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    ...(output === "short_story" ? { kind: "native-retained-short-story", contentMarkdown: "Exact retained <script>literal</script>." }
      : { kind: "native-retained-output", output, content: output === "scene"
        ? { content_markdown: "Exact scene text", medium: "audio" }
        : { presentation: null, items: [{ title: "Slide", body: "Exact slide text", notes: "", image_prompt: "", slide: null }] } }),
  };
  const value = await projectSelectedOutputShareCandidate(selected, native, choices); assert(value);
  return value;
}
function fixture(selected = selection("short_story")) {
  const controller = new AbortController(), calls = [], replies = []; let current = true;
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    assert(replies.length, "unexpected request: " + url);
    const reply = replies.shift(), response = await (typeof reply === "function" ? reply(url, init) : reply);
    if (!Object.hasOwn(response, "url")) Object.defineProperty(response, "url", { value: url });
    return response;
  };
  const lease = { selection: selected, signal: controller.signal, isCurrent: () => current };
  const options = { origin, fetcher }, client = createSelectedOutputShareClient(lease, options);
  return { client, calls, replies, controller, lease, options, retire() { current = false; },
    json(value) { replies.push(Response.json(value)); },
    async enable() { replies.push(Response.json({ creationAvailable: true })); assert.equal(await client.availability(), true); },
  };
}
async function prepare(f, value) {
  value ??= await candidate();
  f.json({ candidateId: "candidate-1", candidate: value, replayed: false });
  return f.client.prepare({ title: value.publicOutput.title, expiresAt: value.publicOutput.expiresAt }, "intent-1");
}

test("actual model candidates for all three outputs retain exact reviewed data and fixed request policy", async () => {
  for (const output of ["short_story", "scene", "slides"]) {
    const f = fixture(selection(output)), value = await candidate(output); await f.enable();
    const result = await prepare(f, value);
    assert.deepEqual(result, { candidateId: "candidate-1", candidate: value, replayed: false });
    assert(Object.isFrozen(result) && Object.isFrozen(result.candidate) && Object.isFrozen(result.candidate.publicOutput.content));
    const sent = f.calls[1]; assert.equal(sent.url, base + "/prepare");
    assert.deepEqual(JSON.parse(sent.init.body), { intentKey: "intent-1", selection: selection(output),
      review: { title: value.publicOutput.title, expiresAt: value.publicOutput.expiresAt } });
    for (const { url, init } of f.calls) {
      assert.equal(new URL(url).origin, origin); assert.equal(init.credentials, "same-origin");
      assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error"); assert.equal(init.referrerPolicy, "no-referrer");
      assert.equal(init.headers.Accept, "application/json"); assert.equal(init.signal, f.controller.signal);
    }
    assert.equal(sent.init.headers["Content-Type"], "application/json");
  }
});

test("availability alone enables creation; false or malformed responses close the gate while management remains usable", async () => {
  const f = fixture(), value = await candidate();
  await assert.rejects(f.client.prepare(review(), "intent"), unavailable);
  await assert.rejects(f.client.commit("candidate-1", value), unavailable); assert.equal(f.calls.length, 0);
  f.json({ creationAvailable: false }); assert.equal(await f.client.availability(), false);
  await assert.rejects(f.client.prepare(review(), "intent"), unavailable); assert.equal(f.calls.length, 1);
  f.json({ shares: [metadata()], nextCursor: null }); assert.deepEqual((await f.client.list()).shares, [metadata()]);
  f.json({ ok: true }); await f.client.revoke("old-share");
  for (const response of [{ creationAvailable: "true" }, { creationAvailable: true, authority: true }, {}]) {
    await f.enable(); f.json(response); await assert.rejects(f.client.availability(), unavailable);
    const count = f.calls.length; await assert.rejects(f.client.prepare(review(), "intent"), unavailable); assert.equal(f.calls.length, count);
  }
});

test("late capability success cannot override a newer unavailable result", async () => {
  const f = fixture(), delayed = Promise.withResolvers(); f.replies.push(() => delayed.promise);
  const previous = f.client.availability(); f.json({ creationAvailable: false });
  assert.equal(await f.client.availability(), false);
  delayed.resolve(Response.json({ creationAvailable: true })); await assert.rejects(previous, unavailable);
  const count = f.calls.length; await assert.rejects(f.client.prepare(review(), "intent"), unavailable); assert.equal(f.calls.length, count);
});

test("captured selection and origin cannot be retargeted; invalid origins and accessor requests refuse", async () => {
  const f = fixture(); f.lease.selection.documentId = "changed"; f.options.origin = "https://foreign.test";
  f.json({ shares: [], nextCursor: null }); await f.client.list();
  const url = new URL(f.calls[0].url); assert.equal(url.origin, origin); assert.equal(url.searchParams.get("documentId"), "document-1");
  for (const supplied of ["https://forma.test/path", "https://user@forma.test", "data:text/plain,x", "https://forma.test/"]) {
    assert.throws(() => createSelectedOutputShareClient(f.lease, { origin: supplied, fetcher: async () => { throw Error("never"); } }));
  }
  await f.enable(); let accesses = 0;
  await assert.rejects(f.client.prepare({ get title() { accesses++; return "Forged"; }, expiresAt: review().expiresAt }, "intent"), unavailable);
  assert.equal(accesses, 0);
});

test("stale or aborted leases refuse before transport and discard delayed responses", async () => {
  for (const mode of ["retire", "abort"]) {
    const f = fixture(); if (mode === "abort") f.controller.abort(); else f.retire();
    await assert.rejects(f.client.list(), unavailable); assert.equal(f.calls.length, 0);
    const active = fixture(), delayed = Promise.withResolvers(); active.replies.push(() => delayed.promise);
    const pending = active.client.list(); if (mode === "abort") active.controller.abort(); else active.retire();
    delayed.resolve(Response.json({ shares: [metadata()], nextCursor: null }));
    await assert.rejects(pending, unavailable); assert.equal(active.calls.length, 1);
  }
});

test("a lease change while response bytes arrive prevents parsing and cancels the body", async () => {
  const f = fixture(); let cancelled = false;
  f.replies.push(new Response(new ReadableStream({ pull(controller) {
    f.retire(); controller.enqueue(new TextEncoder().encode('{"shares":[],'));
  }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }));
  await assert.rejects(f.client.list(), unavailable); assert.equal(cancelled, true);
});

test("prepare rejects forged digests, foreign selections, changed review, extra data and expired candidates", async () => {
  const original = await candidate();
  for (const mutate of [
    value => { value.candidateSha256 = "0".repeat(64); },
    value => { value.publicOutput.content.text = "Forged text"; },
    value => { value.selection.documentId = "foreign"; },
    value => { value.publicOutput.title = "Unreviewed title"; },
    value => { value.owner = "foreign"; },
    value => { value.publicOutput.content.secret = "unexpected"; },
    value => { value.sourceExpiresAt = "2000-01-01T00:00:00.000Z"; },
    value => { value.publicOutput.expiresAt = "2000-01-01T00:00:00.000Z"; },
  ]) {
    const f = fixture(); await f.enable(); const forged = structuredClone(original); mutate(forged);
    f.json({ candidateId: "candidate-1", candidate: forged, replayed: false });
    await assert.rejects(f.client.prepare({ title: original.publicOutput.title, expiresAt: original.publicOutput.expiresAt }, "intent"), unavailable);
    const count = f.calls.length; await assert.rejects(f.client.commit("candidate-1", original), unavailable); assert.equal(f.calls.length, count);
  }
});

test("commit requires its own prepared ID and hash, sends only explicit approval, and never recreates a lost token", async () => {
  const f = fixture(), value = await candidate(); await f.enable();
  await assert.rejects(f.client.commit("unprepared", value), unavailable); assert.equal(f.calls.length, 1);
  const prepared = await prepare(f, value);
  await assert.rejects(f.client.commit(prepared.candidateId, { ...prepared.candidate, candidateSha256: "0".repeat(64) }), unavailable);
  const before = f.calls.length;
  f.replies.push(() => { throw Error("Lost acknowledgment"); });
  await assert.rejects(f.client.commit(prepared.candidateId, prepared.candidate), /Lost acknowledgment/u);
  assert.equal(f.calls.length, before + 1, "no automatic retry or replacement intent");
  f.json({ share: { shareId: prepared.candidateId, expiresAt: value.publicOutput.expiresAt, active: true }, replayed: true });
  const replay = await f.client.commit(prepared.candidateId, prepared.candidate);
  assert.equal(Object.hasOwn(replay.share, "token"), false); assert.equal(replay.replayed, true);
  for (const sent of f.calls.slice(before)) {
    assert.equal(sent.url, base + "/commit");
    assert.deepEqual(JSON.parse(sent.init.body), { candidateId: prepared.candidateId,
      approval: { purpose: "selected-output-read-v1", candidateSha256: value.candidateSha256, allowPublicRead: true } });
  }
});

test("commit validates one-time token versus metadata-only replay and rejects changed identities", async () => {
  const f = fixture(), value = await candidate(); await f.enable(); const prepared = await prepare(f, value);
  const share = { shareId: prepared.candidateId, expiresAt: value.publicOutput.expiresAt, active: true }, token = "A".repeat(32);
  f.json({ share: { ...share, token }, replayed: false });
  assert.deepEqual(await f.client.commit(prepared.candidateId, prepared.candidate), { share: { ...share, token }, replayed: false });
  for (const body of [{ share, replayed: false }, { share: { ...share, token }, replayed: true },
    { share: { ...share, token: "https://foreign.test" }, replayed: false },
    { share: { ...share, shareId: "foreign", token }, replayed: false },
    { share: { ...share, active: false }, replayed: true }, { share, replayed: true, token }]) {
    f.json(body); await assert.rejects(f.client.commit(prepared.candidateId, prepared.candidate), unavailable);
  }
});

test("management allows expired revisions but refuses malformed pages, secrets and cursor substitution", async () => {
  const f = fixture(), row = metadata(); f.json({ shares: [row], nextCursor: null });
  const page = await f.client.list(); assert.deepEqual(page, { shares: [row], nextCursor: null });
  assert(Object.isFrozen(page) && Object.isFrozen(page.shares) && Object.isFrozen(page.shares[0]));
  const rows = Array.from({ length: 50 }, (_, index) => ({ ...row, shareId: "share-" + index }));
  f.json({ shares: rows, nextCursor: cursor("share-49") }); await f.client.list();
  f.json({ shares: [], nextCursor: null }); await f.client.list(cursor("share-49"));
  assert.equal(new URL(f.calls.at(-1).url).searchParams.get("cursor"), cursor("share-49"));
  for (const body of [{ shares: [{ ...row, token: "secret" }], nextCursor: null },
    { shares: [row, row], nextCursor: null }, { shares: [row], nextCursor: cursor() },
    { shares: [{ ...row, issuedAt: row.expiresAt }], nextCursor: null },
    { shares: [{ ...row, revision: -1 }], nextCursor: null }, { shares: [{ ...row, output: ["scene"] }], nextCursor: null }, { shares: [{ ...row, title: "bad\n" }], nextCursor: null },
    { shares: Array(51).fill(row), nextCursor: null }, { shares: [], nextCursor: "https://foreign.test" }]) {
    f.json(body); await assert.rejects(f.client.list(), unavailable);
  }
  const before = f.calls.length;
  await assert.rejects(f.client.list("not-a-cursor"), unavailable);
  await assert.rejects(f.client.revoke("../foreign"), unavailable); assert.equal(f.calls.length, before);
  f.json({ ok: true, token: "secret" }); await assert.rejects(f.client.revoke("old-share"), unavailable);
});

test("a full valid management page fits even when maximum titles require JSON escaping", async () => {
  const f = fixture(), rows = Array.from({ length: 50 }, (_, index) => ({ ...metadata(),
    shareId: "s".repeat(157) + String(index).padStart(3, "0"), title: "\\".repeat(512), revision: Number.MAX_SAFE_INTEGER }));
  const response = { shares: rows, nextCursor: cursor(rows.at(-1).shareId) };
  assert(new TextEncoder().encode(JSON.stringify(response)).byteLength > 65536);
  f.json(response); assert.deepEqual(await f.client.list(), response);
});

test("transport rejects oversized, malformed, non-JSON, redirected and unsuccessful responses", async () => {
  for (const response of [new Response("x".repeat(131073), { headers: { "content-type": "application/json" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "99999999" } }),
    new Response("{}", { headers: { "content-type": "text/html" } }),
    new Response("not JSON", { headers: { "content-type": "application/json" } }),
    new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }),
    Response.json({ shares: [], nextCursor: null }, { status: 403 })]) {
    const f = fixture(); f.replies.push(response); await assert.rejects(f.client.list()); assert.equal(f.calls.length, 1);
  }
  const f = fixture(), redirected = Response.json({ shares: [], nextCursor: null });
  Object.defineProperty(redirected, "redirected", { value: true }); f.replies.push(redirected);
  await assert.rejects(f.client.list(), unavailable);
});

test("transport pins final URL, validates identity length and cancels early refusal bodies", async () => {
  for (const patch of [{ url: "" }, { url: "https://foreign.test/data" }, { status: 503 }]) {
    const f = fixture(); let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } });
    for (const [key, value] of Object.entries(patch)) Object.defineProperty(response, key, { value });
    f.replies.push(response); await assert.rejects(f.client.list(), unavailable); assert.equal(cancelled, true);
  }
  for (const encoding of [undefined, "identity", "gzip"]) {
    const f = fixture(), body = { shares: [], nextCursor: null };
    f.replies.push(Response.json(body, { headers: { "content-length": "1", ...(encoding ? { "content-encoding": encoding } : {}) } }));
    if (encoding === "gzip") assert.deepEqual(await f.client.list(), body, "encoded length does not describe decoded bytes");
    else await assert.rejects(f.client.list(), unavailable);
  }
});

test("capability refresh during candidate hashing cannot resurrect pending preparation", async t => {
  const f = fixture(), value = await candidate(); await f.enable();
  const digest = crypto.subtle.digest.bind(crypto.subtle), hashing = Promise.withResolvers(), release = Promise.withResolvers();
  t.mock.method(crypto.subtle, "digest", async (...args) => { hashing.resolve(); await release.promise; return digest(...args); });
  const pending = prepare(f, value); await hashing.promise;
  f.json({ creationAvailable: false }); assert.equal(await f.client.availability(), false);
  await f.enable();
  release.resolve(); await assert.rejects(pending, unavailable);
  const count = f.calls.length; await assert.rejects(f.client.commit("candidate-1", value), unavailable); assert.equal(f.calls.length, count);
});

test("expiry during asynchronous hashing prevents candidate return or approval transport", async t => {
  for (const operation of ["prepare", "commit"]) await t.test(operation, async child => {
    const f = fixture(), value = await candidate(); await f.enable();
    if (operation === "commit") await prepare(f, value);
    let now = Date.now(); child.mock.method(Date, "now", () => now);
    const digest = crypto.subtle.digest.bind(crypto.subtle), hashing = Promise.withResolvers(), release = Promise.withResolvers();
    child.mock.method(crypto.subtle, "digest", async (...args) => { hashing.resolve(); await release.promise; return digest(...args); });
    const count = f.calls.length;
    const pending = operation === "prepare" ? prepare(f, value) : f.client.commit("candidate-1", value);
    await hashing.promise; now = Date.parse(value.publicOutput.expiresAt); release.resolve();
    await assert.rejects(pending, unavailable);
    assert.equal(f.calls.length, count + (operation === "prepare" ? 1 : 0));
  });
});
