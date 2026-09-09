import assert from "node:assert/strict";
import test from "node:test";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";

// Actual production Store; existing native ports and explicitly synthetic GET
// replies. No Worker request, generation, new admission or human review is implied.
const OWNER = "native-reader-feed-owner", DOCUMENT = "native-reader-document", PROJECT = "native-reader-project";
const AT = "2026-09-08T00:00:00.000Z";
const query = `?document=${DOCUMENT}&artifact=reader-artifact&revision=0&sha256=${"a".repeat(64)}`;
function transport() {
  const events = [
    { type: "ProjectCreated", payload: { project_id: PROJECT, name: "Retained reader" } },
    { type: "DocumentCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, title: "Exact reader Document" } },
  ].map((input, index) => ({ ...input, eventId: `reader-feed-event-${index}`, sequence: index + 1,
    streamId: `creative:${OWNER}`, occurredAt: AT, recordedAt: AT, actor: "user", clientId: "reader-feed-fixture",
    correlationId: `reader-feed-${index}`, causationId: null, compensatesEventId: null, schemaVersion: 1 }));
  const session = { user: { userId: OWNER, email: "native-reader@example.test", displayName: "Reader", role: "creator" },
    impersonation: null, policy: { version: "fixture-policy", accepted: true }, permissionEpoch: "reader-feed-epoch",
    capabilities: ["project.read", "project.author", "project.output.request"], provider: {} };
  return { owner: OWNER, projectId: PROJECT, documentId: DOCUMENT, requestId: "unused", payload: {}, events, close() {},
    async request(url, init = {}) {
      assert.equal(init.method ?? "GET", "GET", "This fixture admits no writer transport");
      if (url === "/api/session") return Response.json(session);
      if (url.startsWith("/api/events?")) return Response.json({ events, head: events.length, content: {} });
      assert.fail(`Unexpected request ${url}`);
    } };
}
async function host(t) {
  const external = [];
  t.mock.method(globalThis, "fetch", async (...args) => { external.push(args.map(String)); assert.fail("No external transport"); });
  const h = await createSceneStoreHost({ workerFixture: transport(), exposeSceneTestAccessors: false });
  h.releases = []; h.pending = [];
  t.after(async () => {
    for (const release of h.releases) release();
    await Promise.allSettled(h.pending);
    await h.close();
    assert.deepEqual(external, [], "Unexpected global transport attempts remain failures even if Store catches them");
    assert.deepEqual(h.requests.filter(request => request.url !== "/api/document-jobs" || (request.init.method ?? "GET") !== "GET"), [],
      "Unexpected paths and writer attempts remain failures even if Store catches them");
  });
  h.store.loading.set(true);
  h.store.route.set("/activity");
  return h;
}
function navigate(h, route) {
  // Existing location port models the address received by Store. Making it
  // current avoids introducing a second history adapter into this source test.
  const url = new URL(route, h.location.origin);
  Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash });
  h.store.setRoute(route);
  assert.equal(h.store.route.get(), route);
}
const options = { concurrency: false, timeout: 20_000 };
for (const output of ["short-story", "scene", "slides"]) {
  test(`retained ${output} rejects job-feed admission without a GET or scheduled poll`, options, async t => {
    const h = await host(t);
    navigate(h, `/make/${output}${query}`);
    const before = h.requests.length;
    await h.store.syncDocumentJobs();
    assert.equal(h.requests.length, before);
    assert.equal([...h.timers.values()].some(timer => timer.delay !== 16), false);
  });
}

test("reader entry retires an in-flight feed before body read and any publication", options, async t => {
  const h = await host(t), entered = sceneDeferred(), headers = sceneDeferred();
  let bodyReads = 0, canceled = 0;
  h.intercept = async request => {
    assert.equal(request.url, "/api/document-jobs"); assert.equal(request.init.method ?? "GET", "GET"); entered.resolve();
    await headers.promise;
    return { ok: true, status: 200, body: { async cancel() { canceled++; } }, async json() { bodyReads++; return { jobs: [] }; } };
  };
  const before = h.store.documentJobs.get(), pending = h.store.syncDocumentJobs();
  h.releases.push(() => headers.resolve()); h.pending.push(pending);
  await entered.promise;
  navigate(h, "/make/scene" + query);
  headers.resolve(); await pending;
  assert.equal(bodyReads, 0); assert.equal(canceled, 1);
  assert.equal(h.store.documentJobs.get(), before);
  assert.equal(h.requests.length, 1);
});

test("return from reader fetches a fresh feed after retiring the original response", options, async t => {
  const h = await host(t), entered = sceneDeferred(), headers = sceneDeferred();
  let bodyReads = 0, canceled = 0, calls = 0;
  h.intercept = async request => {
    assert.equal(request.url, "/api/document-jobs"); assert.equal(request.init.method ?? "GET", "GET");
    if (++calls > 1) return Response.json({ jobs: [] });
    entered.resolve(); await headers.promise;
    return { ok: true, status: 200, body: { async cancel() { canceled++; } }, async json() { bodyReads++; return { jobs: [{ jobId: "stale" }] }; } };
  };
  const before = h.store.documentJobs.get(), pending = h.store.syncDocumentJobs();
  h.releases.push(() => headers.resolve()); h.pending.push(pending);
  await entered.promise;
  navigate(h, "/make/scene" + query);
  navigate(h, "/activity?document=" + DOCUMENT);
  headers.resolve(); await pending;
  await untilScene(() => calls === 2 && h.store.documentJobs.get() !== before
    && h.store.documentJobs.get().length === 0 && [...h.timers.values()].some(timer => timer.delay === 60_000), "fresh current feed publishes and schedules its completed poll");
  assert.equal(bodyReads, 0); assert.equal(canceled, 1); assert.equal(h.requests.length, 2);
  assert.equal(h.requests.some(request => (request.init.method ?? "GET") !== "GET"), false);
});
