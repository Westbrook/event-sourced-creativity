// Actual routed Worker/RAM SQLite only. These malformed-input/read controls
// never approve a job, run a provider, mutate a real account, or simulate an ACK.
// The separate actual form-built intake role/persona suites cover real intake.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";

const options = { concurrency: false, timeout: 45_000 };
const noContext = [
  { name: "absent", cookie: null },
  { name: "empty", cookie: "forma_project_context=" },
  { name: "malformed-percent", cookie: "forma_project_context=%E0%A4%A" },
];
const invalidContext = [
  { name: "nonempty-unissued", cookie: "forma_project_context=unissued-cookie-boundary" },
  { name: "decoded-space", cookie: "forma_project_context=%20" },
];
const readShapes = [
  ...noContext.map(shape => ({ ...shape, absent: true })),
  { name: "first-empty-then-unissued", cookie: "forma_project_context=; forma_project_context=unissued-cookie-boundary", absent: true },
  { name: "first-malformed-then-unissued", cookie: "forma_project_context=%E0%A4%A; forma_project_context=unissued-cookie-boundary", absent: true },
  { name: "first-unissued-then-empty", cookie: "forma_project_context=unissued-cookie-boundary; forma_project_context=", absent: false },
  ...invalidContext.map(shape => ({ ...shape, absent: false })),
];
const rows = (x, table) => x.sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all();
const optionalRows = (x, table) => x.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) ? rows(x, table) : null;
const fiscal = x => ({ rows: financial(x), steps: optionalRows(x, "consequential_execution_steps") });
function protectedRows(x) {
  return { events: rows(x, "events"), privatePayloads: rows(x, "event_private_payloads"), privateContent: rows(x, "private_content"),
    receipts: rows(x, "event_client_receipts"), resourceScopes: optionalRows(x, "project_resource_scopes"),
    eventScopes: optionalRows(x, "project_event_scopes"), retentionScopes: optionalRows(x, "private_content_retention_scopes"), fiscal: fiscal(x) };
}
async function fixture(t, shared = false) {
  let external = 0, media = 0;
  t.mock.method(globalThis, "fetch", async () => { external++; assert.fail("No external/provider request in decoded-context fixtures"); });
  const x = await createSceneCostFixture(1, "visual", { shared, depth: false });
  const money = fiscal(x);
  for (const method of ["get", "put"]) t.mock.method(x.env.MEDIA, method, async () => { media++; assert.fail("No media storage access in cookie admission controls"); });
  t.after(() => { try { assert.deepEqual(fiscal(x), money); assert.equal(external, 0); assert.equal(media, 0); } finally { x.close(); } });
  return x;
}
function role(x, next) {
  const previous = x.sqlite.prepare("SELECT role,updated_at FROM users WHERE user_id=?").get(x.owner);
  x.sqlite.prepare("UPDATE users SET role=?,updated_at=? WHERE user_id=?").run(next, new Date().toISOString(), x.owner);
  return () => x.sqlite.prepare("UPDATE users SET role=?,updated_at=? WHERE user_id=?").run(previous.role, previous.updated_at, x.owner);
}
const headers = cookie => cookie === null ? {} : { cookie };
async function result(response) {
  const text = await response.text();
  return { response, text, body: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : null };
}
function unchanged(t, x, before, reply, detail) {
  const after = protectedRows(x);
  assert.deepEqual(after.fiscal, before.fiscal, "all exact original job/financial rows and current execution steps are unchanged");
  const same = isDeepStrictEqual(after, before);
  t.diagnostic(JSON.stringify({ ...detail, status: reply.response.status, error: reply.body?.error ?? null, protectedRowsUnchanged: same }));
  assert.equal(same, true, "cookie admission must not append private input, events, receipts, jobs or money rows");
}
function cacheHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const vary = new Set(String(response.headers.get("vary")).split(",").map(value => value.trim().toLowerCase()));
  for (const value of ["cookie", "oai-authenticated-user-id", "oai-authenticated-user-email"]) assert.equal(vary.has(value), true);
}
const mutationRoutes = [
  { path: "/api/document-jobs", body: { kind: "not-a-job" }, error: "unsupported_document_job" },
  { path: "/api/generation-readiness", body: { kind: "not-a-preflight" }, error: "generation_preflight_input_required" },
  { path: "/api/shares", body: { resourceKind: "not-a-share" }, error: "share_resource_scope_required" },
  { path: "/api/media", multipart: true, error: "A supported image, audio recording, document, or GLB model is required" },
];
function invalidRequest(route, cookie) {
  return route.multipart ? { method: "POST", headers: headers(cookie), body: new FormData() }
    : { method: "POST", headers: { ...headers(cookie), "content-type": "application/json" }, body: JSON.stringify(route.body) };
}

for (const route of mutationRoutes) for (const actorRole of ["viewer", "agent"]) test(
  "decoded context keeps ordinary creator admission " + route.path + " " + actorRole, options, async t => {
    const x = await fixture(t), restore = role(x, actorRole), before = protectedRows(x);
    try {
      for (const shape of noContext) {
        const reply = await result(await x.request(route.path, invalidRequest(route, shape.cookie)));
        unchanged(t, x, before, reply, { path: route.path, role: actorRole, cookie: shape.name });
        assert.deepEqual({ status: reply.response.status, error: reply.body?.error, required: reply.body?.required, role: reply.body?.role },
          { status: 403, error: "insufficient_role", required: "creator", role: actorRole });
      }
      for (const shape of invalidContext) {
        const reply = await result(await x.request(route.path, invalidRequest(route, shape.cookie)));
        unchanged(t, x, before, reply, { path: route.path, role: actorRole, cookie: shape.name });
        assert.equal(reply.response.status, 403); assert.equal(reply.body?.error, "project_access_revoked");
        assert.ok(reply.response.headers.get("set-cookie")?.startsWith("forma_project_context=;"));
      }
    } finally { restore(); }
  });

for (const route of mutationRoutes) test("decoded context leaves authorized input validation unchanged " + route.path, options, async t => {
  const x = await fixture(t), restore = role(x, "creator"), before = protectedRows(x);
  try {
    for (const shape of noContext) {
      const reply = await result(await x.request(route.path, invalidRequest(route, shape.cookie)));
      unchanged(t, x, before, reply, { path: route.path, role: "creator", cookie: shape.name });
      assert.equal(reply.response.status, 400); assert.equal(reply.body?.error, route.error);
    }
  } finally { restore(); }
});

test("decoded context preserves first-match semantics and raw-presence private event cache headers", options, async t => {
  const x = await fixture(t), path = "/api/events?after=0&limit=2000&content=0";
  const original = await result(await x.request(path)); assert.equal(original.response.status, 200);
  const before = protectedRows(x);
  for (const shape of readShapes) {
    const reply = await result(await x.request(path, { headers: headers(shape.cookie) }));
    unchanged(t, x, before, reply, { path, cookie: shape.name });
    if (shape.cookie !== null) cacheHeaders(reply.response);
    if (shape.absent) { assert.equal(reply.response.status, 200); assert.deepEqual(reply.body.events, original.body.events); }
    else { assert.equal(reply.response.status, 403); assert.equal(reply.body?.error, "project_access_revoked"); assert.equal(Object.hasOwn(reply.body, "events"), false); }
  }
});

async function activePersona(x) {
  const now = new Date().toISOString(), fictional = "decoded-cookie-fictional", persona = "decoded-cookie-persona", acting = "decoded-cookie-acting";
  x.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(fictional, "decoded-cookie@example.test", "Decoded cookie fixture persona", "creator", "pilot-2026-08-10", now, now, now);
  x.sqlite.prepare("INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(persona, "decoded-cookie-replay", x.owner, fictional, "creative:" + fictional, "Decoded cookie fixture persona", "ready", now, now);
  x.sqlite.prepare("INSERT INTO impersonation_sessions(impersonation_id,actor_user_id,persona_id,fictional_user_id,replay_session_id,status,started_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(acting, x.owner, persona, fictional, "decoded-cookie-replay", "active", now, new Date(Date.now() + 3_600_000).toISOString());
  const cookie = context => "forma_impersonation=" + acting + (context === null ? "" : "; " + context);
  const path = "/api/events?after=0&limit=2000&content=0";
  // Actual effective-account GET warms existing seed-simulation content before
  // snapshots; none of those records is claimed as a freshly generated output.
  const principalBefore = rows(x, "events").filter(row => row.stream_id === x.streamId);
  const original = await result(await x.request(path, { headers: headers(cookie(null)) }));
  assert.equal(original.response.status, 200); assert.ok(original.body.events.length);
  assert.equal(original.body.events.every(event => event.streamId === "creative:" + fictional), true);
  assert.deepEqual(rows(x, "events").filter(row => row.stream_id === x.streamId), principalBefore);
  return { cookie, path, original };
}

test("decoded context keeps active-persona event reads in the effective stream including duplicate cookies", options, async t => {
  const x = await fixture(t), persona = await activePersona(x), before = protectedRows(x);
  for (const shape of readShapes) {
    const reply = await result(await x.request(persona.path, { headers: headers(persona.cookie(shape.cookie)) }));
    unchanged(t, x, before, reply, { path: persona.path, cookie: shape.name, activePersona: true });
    if (shape.cookie !== null) cacheHeaders(reply.response);
    if (shape.absent) { assert.equal(reply.response.status, 200); assert.deepEqual(reply.body.events, persona.original.body.events); }
    else { assert.equal(reply.response.status, 409); assert.equal(reply.body?.error, "return_to_principal_before_internal_access"); }
  }
});

test("decoded context index precheck preserves ordinary effective-account policy without running readiness", options, async t => {
  const x = await fixture(t), persona = await activePersona(x), before = protectedRows(x);
  for (const shape of [...noContext, ...invalidContext]) {
    const path = "/api/generation-readiness/provider/refresh";
    const reply = await result(await x.request(path, { method: "GET", headers: headers(persona.cookie(shape.cookie)) }));
    unchanged(t, x, before, reply, { path, cookie: shape.name, activePersona: true });
    if (noContext.includes(shape)) { assert.equal(reply.response.status, 405); assert.equal(reply.text, "Method not allowed"); }
    else { assert.equal(reply.response.status, 409); assert.equal(reply.body?.error, "return_to_principal_before_internal_access"); }
  }
});

test("decoded context media read preserves effective-account namespace refusal without storage", options, async t => {
  const x = await fixture(t), persona = await activePersona(x), before = protectedRows(x);
  for (const shape of [...noContext, ...invalidContext]) {
    const path = "/api/media/not-an-owned-cookie-boundary-key";
    const reply = await result(await x.request(path, { headers: headers(persona.cookie(shape.cookie)) }));
    unchanged(t, x, before, reply, { path, cookie: shape.name, activePersona: true });
    if (noContext.includes(shape)) { assert.equal(reply.response.status, 403); assert.equal(reply.text, "Forbidden"); }
    else { assert.equal(reply.response.status, 409); assert.equal(reply.body?.error, "return_to_principal_before_internal_access"); }
  }
});

test("decoded context leaves explicit URL-scoped workspace reads authorized with absent-equivalent cookies", options, async t => {
  const x = await fixture(t, true), scope = x.sharing;
  assert.ok(scope, "actual Worker-created organization/project/selection");
  const path = "/api/workspaces/" + scope.organizationId + "/projects/" + scope.projectAccessId + "/events?after=0&limit=2000&content=0";
  const original = await result(await x.request(path)); assert.equal(original.response.status, 200);
  x.setScopedHeaders({}); // Existing fixture transport port; no principal/access replacement.
  const before = protectedRows(x);
  for (const shape of readShapes) {
    const reply = await result(await x.request(path, { headers: headers(shape.cookie) }));
    unchanged(t, x, before, reply, { path: "workspace-project-events", cookie: shape.name });
    cacheHeaders(reply.response);
    if (shape.absent) { assert.equal(reply.response.status, 200); assert.deepEqual(reply.body.events, original.body.events); }
    else { assert.equal(reply.response.status, 403); assert.equal(reply.body?.error, "project_access_revoked"); assert.equal(Object.hasOwn(reply.body, "events"), false); }
  }
});

test("decoded context never falls back after the actual selected workspace context is revoked", options, async t => {
  const x = await fixture(t, true), scope = x.sharing;
  const path = "/api/workspaces/" + scope.organizationId + "/projects/" + scope.projectAccessId + "/events?content=0";
  const original = await result(await x.request(path)); assert.equal(original.response.status, 200);
  const previous = x.sqlite.prepare("SELECT revoked_at FROM project_context_sessions WHERE context_id=?").get(scope.contextId);
  x.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), scope.contextId);
  try {
    const before = protectedRows(x), reply = await result(await x.request(path));
    unchanged(t, x, before, reply, { path: "workspace-project-events", cookie: "actual-selected-now-revoked" });
    assert.equal(reply.response.status, 403); assert.equal(reply.body?.error, "project_access_revoked"); assert.equal(Object.hasOwn(reply.body, "events"), false);
    x.setScopedHeaders({});
    const explicit = await result(await x.request(path)); unchanged(t, x, before, explicit, { path: "workspace-project-events", cookie: "absent-independent-URL-authority" });
    assert.equal(explicit.response.status, 200); assert.deepEqual(explicit.body.events, original.body.events);
  } finally { x.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(previous.revoked_at, scope.contextId); }
});
