import assert from "node:assert/strict";
import test from "node:test";
import { OutputRequirementsClient, outputDownloadFilename } from "../src/state/output-requirements-client.ts";

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const snapshot = (revision, documentId = "doc", projectId = "project") => ({ revision, documentId, projectId, summary: { required: 3 } });
// SIMULATED current command envelope, bound to the action on this request.
// This unit transport is not evidence of an actual server commit.
const simulatedCommittedEnvelope = (request, revision) => ({
  ok: true, replayed: false, appended: [],
  command: { action: JSON.parse(request.body).action, eventId: "simulated-command-event" }, snapshot: snapshot(revision),
});
function fixture(fetch) {
  let scope = { key: "user:permission:1", projectId: "project" };
  let notifications = 0;
  const client = new OutputRequirementsClient({
    captureScope: () => scope,
    scopeActive: (captured) => captured.key === scope?.key && captured.projectId === scope?.projectId,
    fetch,
    isSnapshot: (value, documentId, captured) => Boolean(value && value.documentId === documentId && value.projectId === captured.projectId && typeof value.revision === "string"),
    notify: () => { notifications += 1; },
  });
  return { client, setScope: (next) => { scope = next; }, get notifications() { return notifications; } };
}

test("Output resource starts unknown and never turns an unavailable response into an empty plan", async () => {
  const { client } = fixture(async () => Response.json({ error: "Unavailable" }, { status: 503 }));
  assert.deepEqual(client.resource("doc"), { state: "loading", snapshot: null, error: null });
  const result = await client.ensure("doc");
  assert.equal(result.state, "unavailable");
  assert.equal(result.snapshot, null);
  assert.equal(result.error, "Unavailable");
});

test("Output resource retains the last known denominator but marks failed refresh unavailable", async () => {
  let fail = false;
  const { client } = fixture(async () => fail ? Response.json({ error: "Cannot refresh" }, { status: 503 }) : Response.json(snapshot("1")));
  await client.ensure("doc");
  fail = true;
  const result = await client.ensure("doc", { force: true });
  assert.equal(result.state, "unavailable");
  assert.equal(result.snapshot.summary.required, 3);
});

test("revoked access removes private cached requirement text", async () => {
  let revoked = false;
  const { client } = fixture(async () => revoked ? Response.json({ error: "Forbidden" }, { status: 403 }) : Response.json(snapshot("1")));
  await client.ensure("doc");
  revoked = true;
  const result = await client.ensure("doc", { force: true });
  assert.equal(result.snapshot, null);
  assert.equal(result.state, "unavailable");
});

test("two overlapping refreshes cannot apply the older response last", async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const { client } = fixture(() => (++calls === 1 ? first : second).promise);
  const oldRequest = client.ensure("doc");
  const newRequest = client.ensure("doc", { force: true });
  second.resolve(Response.json(snapshot("2")));
  await newRequest;
  first.resolve(Response.json(snapshot("1")));
  await oldRequest;
  assert.equal(client.resource("doc").snapshot.revision, "2");
});

test("authorization is checked again after asynchronous JSON parsing", async () => {
  const parsed = deferred();
  const fixtureState = fixture(async () => ({ ok: true, status: 200, json: () => parsed.promise }));
  const request = fixtureState.client.ensure("doc");
  await Promise.resolve();
  fixtureState.setScope({ key: "user:permission:2", projectId: "project" });
  parsed.resolve(snapshot("private-old"));
  await request;
  assert.equal(fixtureState.client.resource("doc").snapshot, null);
});

test("scope cache distinguishes the same Document ID in different projects", async () => {
  const fixtureState = fixture(async () => Response.json(snapshot("1")));
  await fixtureState.client.ensure("doc");
  fixtureState.setScope({ key: "user:permission:1", projectId: "other-project" });
  assert.equal(fixtureState.client.resource("doc").snapshot, null);
});

test("saving uses the captured revision and command ID exactly once without automatic rebase", async () => {
  const requests = [];
  const { client } = fixture(async (path, init) => { requests.push({ path, body: JSON.parse(init.body) }); return Response.json({ error: "revision_conflict", revision: "2" }, { status: 409 }); });
  const result = await client.command("doc", { action: "save", expectedRevision: "1", clientMutationId: "same-operation", spec: { original_text: "my draft" } }, "save requirements");
  assert.equal(result.status, "conflict");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.expectedRevision, "1");
  assert.equal(requests[0].body.clientMutationId, "same-operation");
  assert.equal(requests[0].body.spec.original_text, "my draft");
});

test("a late read cannot replace the snapshot returned by a successful write", async () => {
  const read = deferred();
  const { client } = fixture((path, init) => init?.method === "POST" ? Promise.resolve(Response.json(simulatedCommittedEnvelope(init, "2"))) : read.promise);
  const reading = client.ensure("doc");
  const result = await client.command("doc", { action: "save", expectedRevision: "1", clientMutationId: "save" }, "save requirements");
  assert.equal(result.status, "saved");
  read.resolve(Response.json(snapshot("1")));
  await reading;
  assert.equal(client.resource("doc").snapshot.revision, "2");
});

test("write response is discarded after a permission scope change during JSON parsing", async () => {
  const parsed = deferred(), parsingEntered = deferred();
  let calls = 0, parses = 0, request;
  const fixtureState = fixture(async (path, init) => {
    assert.equal(path, "/api/output-requirements"); calls++; request = init;
    return { ok: true, status: 200, json: () => { parses++; parsingEntered.resolve(); return parsed.promise; } };
  });
  const writing = fixtureState.client.command("doc", { action: "save", expectedRevision: "1", clientMutationId: "save" }, "save requirements");
  await Promise.race([parsingEntered.promise, writing]);
  assert.equal(calls, 1); assert.equal(parses, 1, "the private body parser really began before the permission change");
  fixtureState.setScope(null);
  parsed.resolve(simulatedCommittedEnvelope(request, "2"));
  assert.equal((await writing).status, "forbidden");
  assert.equal(fixtureState.client.resource("doc").snapshot, null);
});

test("download refuses a cross-origin or unrelated API path before fetching", async () => {
  let calls = 0;
  const { client } = fixture(async () => { calls += 1; throw new Error("Unexpected network"); });
  for (const path of ["https://example.com/file", "//example.com/file", "/api/media/private", "/api/output-requirements/../media/private?documentId=doc", "/api/output-requirements/assets/%2Fprivate?documentId=doc", "/api/output-requirements/assets/a?documentId=another", "/api/output-requirements/assets/a?documentId=doc&documentId=another", "/api/output-requirements/deliveries/a?documentId=doc&part=0", "/api/output-requirements/assets/a?documentId=doc#private"]) {
    assert.equal((await client.download("doc", path)).status, "invalid");
  }
  assert.equal(calls, 0);
});

test("download checks authorization after asynchronous byte transfer", async () => {
  const bytes = deferred();
  const fixtureState = fixture(async () => ({ ok: true, status: 200, headers: new Headers(), blob: () => bytes.promise }));
  const downloading = fixtureState.client.download("doc", "/api/output-requirements/assets/a?documentId=doc");
  await Promise.resolve();
  fixtureState.setScope({ key: "other-user", projectId: "project" });
  bytes.resolve(new Blob(["private"]));
  assert.equal((await downloading).status, "forbidden");
});

test("multipart downloads remain bound to one Document and an explicit positive part", async () => {
  const { client } = fixture(async () => new Response("checked bytes", { headers: { "content-disposition": 'attachment; filename="part-2.zip"' } }));
  const result = await client.download("doc", "/api/output-requirements/deliveries/manifest-a?documentId=doc&part=2");
  assert.equal(result.status, "saved");
  assert.equal(result.body.filename, "part-2.zip");
});

test("real exact-file header preserves its UTF-8 display name instead of the output.png fallback", async () => {
  const filename = "résumé-日本語.pptx";
  const disposition = `attachment; filename="output.png"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  assert.equal(outputDownloadFilename(disposition), filename);
  const { client } = fixture(async () => new Response("checked bytes", { headers: { "content-disposition": disposition } }));
  const result = await client.download("doc", "/api/output-requirements/assets/a?documentId=doc");
  assert.equal(result.status, "saved");
  assert.equal(result.body.filename, filename);
});

test("unsafe or malformed extended download names cannot introduce paths or spoofing", () => {
  for (const name of ["../private", "x\\private", "a\u202egnp.exe", "line\nname", ".", "..", "x".repeat(181)]) {
    assert.equal(outputDownloadFilename(`attachment; filename="safe.png"; filename*=UTF-8''${encodeURIComponent(name)}`), "safe.png");
  }
  assert.equal(outputDownloadFilename('attachment; filename="../bad"; filename*=UTF-8\'\'%FF'), "forma-delivery.bin");
});


test("the original snapshot-only 200 is not a receipt and cannot discard its unknown original operation", async () => {
  let calls = 0;
  const { client } = fixture(async () => { calls++; return Response.json({ snapshot: snapshot("2") }); });
  const result = await client.command("doc", { action: "save", expectedRevision: "1", clientMutationId: "original-malformed-save" }, "save requirements");
  assert.equal(result.status, "unavailable"); assert.equal(result.receipt, undefined);
  const owner = client.retainedWrite("doc");
  assert.equal(owner.clientMutationId, "original-malformed-save"); assert.equal(owner.status, "unknown");
  const next = await client.command("doc", { action: "save", expectedRevision: "2", clientMutationId: "different-new-save" }, "save requirements");
  assert.equal(next.status, "not-attempted"); assert.equal(calls, 1); assert.deepEqual(client.retainedWrite("doc"), owner);
});

test("a permission change during real digest preparation is not-attempted and never reaches JSON parsing", async () => {
  let calls = 0, parses = 0;
  const fixtureState = fixture(async () => {
    calls++;
    return { ok: true, status: 200, json: async () => { parses++; return { snapshot: snapshot("2") }; } };
  });
  const writing = fixtureState.client.command("doc", { action: "save", expectedRevision: "1", clientMutationId: "before-dispatch-save" }, "save requirements");
  await Promise.resolve(); // The old microtask boundary, explicitly tested as pre-dispatch rather than response parsing.
  fixtureState.setScope(null);
  assert.equal((await writing).status, "not-attempted");
  assert.equal(calls, 0); assert.equal(parses, 0); assert.equal(fixtureState.client.resource("doc").snapshot, null);
});

test("the healthy current-scope parsing control accepts only its completed simulated canonical receipt", async () => {
  const parsed = deferred(), parsingEntered = deferred();
  let calls = 0, request;
  const { client } = fixture(async (path, init) => {
    assert.equal(path, "/api/output-requirements"); calls++; request = init;
    return { ok: true, status: 200, json: () => { parsingEntered.resolve(); return parsed.promise; } };
  });
  const writing = client.command("doc", { action: "save", expectedRevision: "1", clientMutationId: "healthy-parsed-save" }, "save requirements");
  await Promise.race([parsingEntered.promise, writing]);
  assert.equal(calls, 1); assert.equal(client.retainedWrite("doc").status, "pending");
  parsed.resolve(simulatedCommittedEnvelope(request, "2"));
  assert.equal((await writing).status, "saved"); assert.equal(client.resource("doc").snapshot.revision, "2");
  assert.equal(client.retainedWrite("doc").clientMutationId, "healthy-parsed-save");
  assert.equal(client.retainedWrite("doc").status, "acknowledged"); assert.equal(calls, 1);
});
