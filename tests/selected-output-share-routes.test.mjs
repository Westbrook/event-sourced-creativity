import assert from "node:assert/strict";
import test from "node:test";
import worker from "../dist/server/index.js";
import { resolveServerRoute } from "../src/platform/applications.ts";
import { isSelectedOutputSharePagePath, selectedOutputSharePageToken } from "../src/model/selected-output-share-routes.ts";
import { performanceRouteFamily, performanceRouteSurface } from "../src/performance.ts";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { selectedOutputShareFixture, OWNER, EMAIL, DOCUMENT, ARTIFACT } from "./helpers/selected-output-share-fixture.mjs";

// The actual built Worker dispatches these requests; the actual detached source
// lifecycle seeds synthetic links only. Production dispatch stays closed for
// prepare/commit, so these are not live publication/activation acceptance.
const hooks = registerOutputSourceImports();
let prepareSelectedOutputShare, commitSelectedOutputShare;
try {
  ({ prepareSelectedOutputShare, commitSelectedOutputShare } = await import("../worker/selected-output-share-lifecycle.ts"));
} finally { hooks.deregister(); }
const BASE = "https://forma.invalid", TOKEN = "A".repeat(32);
const headers = { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL };
const context = { waitUntil() { throw new Error("selected-share routes must not schedule background mutations"); } };
const request = (path, { method = "GET", auth = true, body, extra = {} } = {}) => new Request(BASE + path, {
  method, headers: { ...(auth ? headers : {}), ...(body ? { "content-type": "application/json" } : {}), ...extra },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
function responseHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}
function forbiddenEnvironment() {
  return new Proxy({}, { get(_target, key) { throw new Error("route touched forbidden environment: " + String(key)); } });
}
async function fixture(t, options = {}) {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("no network permitted"); });
  const f = await selectedOutputShareFixture(t, options);
  return f;
}
async function syntheticIssue(f) {
  const preparedResponse = await prepareSelectedOutputShare(f.request({ intentKey: "synthetic-routed-review", selection: f.selection(), review: f.review() }), f.env);
  assert.equal(preparedResponse.status, 200);
  const prepared = await preparedResponse.json();
  const issuedResponse = await commitSelectedOutputShare(f.request({ candidateId: prepared.candidateId,
    approval: { purpose: prepared.candidate.purpose, candidateSha256: prepared.candidate.candidateSha256, allowPublicRead: true } }), f.env);
  assert.equal(issuedResponse.status, 200);
  const issued = await issuedResponse.json();
  assert.equal(issued.replayed, false);
  return { prepared, share: issued.share };
}

test("actual dispatcher advertises closed creation and refuses all preparation/commit before environment reads", async () => {
  const environment = forbiddenEnvironment();
  const availability = await worker.fetch(request("/api/selected-output-shares/availability", { auth: false }), environment, context);
  assert.equal(availability.status, 200); responseHeaders(availability);
  assert.deepEqual(await availability.json(), { creationAvailable: false });
  for (const operation of ["prepare", "commit"]) {
    for (const auth of [true, false]) {
      const response = await worker.fetch(request("/api/selected-output-shares/" + operation, { method: "POST", auth,
        body: { arbitrary: "cannot activate even with authenticated principal" } }), environment, context);
      assert.equal(response.status, 503); responseHeaders(response);
      assert.deepEqual(await response.json(), { error: "selected_output_share_creation_unavailable" });
    }
  }
});

test("finite API routes reject method, query, malformed token, traversal and cross-site mutations without fallback", async () => {
  const cases = [
    ["/api/selected-output-shares/prepare", "GET", 405],
    ["/api/selected-output-shares/commit", "DELETE", 405],
    ["/api/selected-output-shares/availability", "HEAD", 405],
    ["/api/selected-output-shares/availability?activate=true", "GET", 404],
    ["/api/selected-output-shares/prepare?enabled=true", "POST", 404],
    ["/api/selected-output-shares/commit/extra", "POST", 404],
    ["/api/selected-output-shares/id%2fother", "DELETE", 404],
    ["/api/selected-output-shares/%00", "DELETE", 404],
    ["/api/selected-output-shares/%", "DELETE", 404],
    ["/api/selected-output-shared", "GET", 404],
    ["/api/selected-output-shared/short", "GET", 404],
    ["/api/selected-output-shared/" + TOKEN + "?token=" + TOKEN, "GET", 404],
    ["/api/selected-output-shared/" + TOKEN + "/file", "GET", 404],
    ["/api/selected-output-shared/" + TOKEN, "HEAD", 405],
    ["/api/selected-output-shared/" + TOKEN, "POST", 405],
    ["/api/selected-output-shared/%41" + TOKEN.slice(1), "GET", 404],
  ];
  for (const [path, method, status] of cases) {
    const response = await worker.fetch(request(path, { method }), forbiddenEnvironment(), context);
    assert.equal(response.status, status, method + " " + path); responseHeaders(response);
  }
  for (const extra of [{ origin: "https://other.invalid" }, { "sec-fetch-site": "cross-site" }]) {
    const response = await worker.fetch(request("/api/selected-output-shares/candidate", { method: "DELETE", extra }), forbiddenEnvironment(), context);
    assert.equal(response.status, 403); responseHeaders(response);
  }
});

for (const output of ["short_story", "scene", "slides"]) test("actual " + output + " recipient, management and revocation use only exact synthetic selected output", async t => {
  const f = await fixture(t, { kind: output }), issued = await syntheticIssue(f), before = f.changes();
  const bodyBefore = f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get("selected-share-content").content;
  const response = await worker.fetch(request("/api/selected-output-shared/" + issued.share.token, { auth: false }), f.env, context);
  assert.equal(response.status, 200); responseHeaders(response);
  assert.deepEqual(await response.json(), issued.prepared.candidate.publicOutput);
  assert.equal(f.changes(), before);
  const listed = await worker.fetch(request(`/api/selected-output-shares?documentId=${DOCUMENT}&artifactId=${ARTIFACT}`), f.env, context);
  assert.equal(listed.status, 200); responseHeaders(listed);
  const metadata = await listed.json();
  assert.equal(metadata.shares.length, 1); assert.equal(metadata.shares[0].shareId, issued.share.shareId);
  assert.doesNotMatch(JSON.stringify(metadata), /token|owner|source|contentSha256|PRIVATE_/u);
  assert.equal(f.changes(), before);
  const revoked = await worker.fetch(request("/api/selected-output-shares/" + issued.share.shareId, { method: "DELETE" }), f.env, context);
  assert.equal(revoked.status, 200); assert.deepEqual(await revoked.json(), { ok: true });
  assert.equal(f.changes(), before + 1, "only the deliberate revoke changes one row");
  const closed = await worker.fetch(request("/api/selected-output-shared/" + issued.share.token, { auth: false }), f.env, context);
  assert.equal(closed.status, 404); assert.doesNotMatch(await closed.text(), /PRIVATE_|content|selection|token/u);
  assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get("selected-share-content").content, bodyBefore);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("absent and partial schemas refuse routed reads without initialization or background work", async t => {
  const f = await selectedOutputShareFixture(t, { installShareSchema: false }), paths = ["/api/selected-output-shared/" + TOKEN,
    `/api/selected-output-shares?documentId=${DOCUMENT}&artifactId=${ARTIFACT}`];
  for (const partial of [false, true]) {
    if (partial) f.sqlite.exec("CREATE TABLE selected_output_shares(share_id TEXT)");
    const before = f.changes(), schema = f.sqlite.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY name").all();
    for (const path of paths) assert.equal((await worker.fetch(request(path), f.env, context)).status, 404);
    assert.equal((await worker.fetch(request("/api/selected-output-shares/one", { method: "DELETE" }), f.env, context)).status, 404);
    assert.equal(f.changes(), before);
    assert.deepEqual(f.sqlite.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY name").all(), schema);
  }
});

test("recipient navigation stays on isolated share assets including unavailable token paths", async () => {
  for (const path of ["/share/output/" + TOKEN, "/share/output/" + TOKEN + "/", "/share/output", "/share/output/%2f", "/share/output/invalid/extra"]) {
    assert.equal(isSelectedOutputSharePagePath(path), true);
    assert.equal(selectedOutputSharePageToken(path), path.includes(TOKEN) ? TOKEN : "");
    assert.deepEqual(resolveServerRoute(path), { application: "creative", entryPath: "/share/", canonicalFamily: "/share/output/:token" });
    assert.equal(performanceRouteFamily(path), "share"); assert.equal(performanceRouteSurface(path), "shared-output");
    const calls = [];
    const env = { ASSETS: { fetch(req) { calls.push(req.url); return new Response("<forma-public-share></forma-public-share>", { headers: { "content-type": "text/html" } }); } } };
    Object.defineProperty(env, "DB", { get() { throw new Error("public page must not hydrate account or private content"); } });
    const response = await worker.fetch(request(path), env, context);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-forma-route-family"), "/share/output/:token");
    assert.deepEqual(calls, [BASE + "/share/"]); assert.equal(await response.text(), "<forma-public-share></forma-public-share>");
  }
  assert.equal(isSelectedOutputSharePagePath("/share/document-token"), false);
  assert.deepEqual(resolveServerRoute("/share/document-token"), { application: "creative", entryPath: "/share/", canonicalFamily: "/share/:token" });
  assert.equal(performanceRouteSurface("/share/document-token"), "shared-document");
});
