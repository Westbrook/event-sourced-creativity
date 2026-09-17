import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
const { ensureSchema, appendAuditEvent } = await import("../worker/runtime.ts");
const { POLICY_VERSION } = await import("../worker/policy-version.ts");
const { hostedIdentity, readNativeRetainedTextCustody, nativeRetainedTextCustodySnapshot,
  nativeRetainedTextCustodyAssertion } = await import("../worker/native-retained-text-custody.ts");
const { handleRetainedStoryRead } = await import("../worker/retained-story-api.ts");
const { retainedStoryRequestPath } = await import("../src/model/retained-short-story.ts");
imports.deregister();

const OWNER = "text-custody-owner", EMAIL = "text-custody-owner@example.test", PROJECT = "text-custody-project";
const DOCUMENT = "text-custody-document", ARTIFACT = "text-custody-artifact", CONTENT = "text-custody-content";
const EXPIRY = "2099-01-01T00:00:00.000Z";
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const identity = () => ({ userId: OWNER, email: EMAIL, source: "openai-workspace" });
const bodyFor = () => ({ title: "Literal <title> 日本語", summary: "Private summary",
  content_markdown: "# Exact retained text\n\nLiteral <script> and العربية.", presentation: null,
  items: [{ title: "First item", body: "Exact first item.", notes: "Private notes", image_prompt: "Private prompt", slide: null }] });

// Only fixture preparation uses the runtime initializer and writer. The tested
// helper receives a SELECT-only adapter over the real current SQLite schema.
// Private event JSON is intentionally outside this native custody witness;
// its redaction/owner/document/project metadata remains part of the witness.
async function fixture(t, output = "short_story") {
  const f = outputTestDatabase(); t.after(() => f.sqlite.close());
  t.mock.method(globalThis, "fetch", () => { throw Error("Network forbidden in retained custody tests"); });
  await ensureSchema(f.env);
  const now = new Date().toISOString(), stream = `creative:${OWNER}`;
  f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)")
    .run(OWNER, EMAIL, "Synthetic owner", POLICY_VERSION, now, now, now);
  await appendAuditEvent(f.env, stream, "user", "DocumentCreated", { document_id: DOCUMENT, project_id: PROJECT, title: "Document title" });
  const completion = await appendAuditEvent(f.env, stream, "worker:renderer", "DocumentRenderCompleted", {
    document_id: DOCUMENT, project_id: PROJECT, artifact_id: ARTIFACT, artifact_kind: output,
    requested_by_user_id: OWNER, content_ref: CONTENT, title: "Completion title", item_count: 1,
    ...(output === "scene" ? { scene_medium: "audio" } : {}),
  });
  let raw = JSON.stringify(bodyFor());
  f.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, EXPIRY);
  const calls = [];
  let beforeRead;
  const DB = {
    prepare(sql) {
      assert.match(sql, /^\s*(?:WITH|SELECT)\b/iu, "custody helper may prepare only reads");
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|PRAGMA)\b/iu);
      const make = bindings => ({
        bind(...values) { assert(values.length <= 100); return make(values); },
        async first() { calls.push(sql); await beforeRead?.(sql); return f.DB.prepare(sql).bind(...bindings).first(); },
        async all() { calls.push(sql); await beforeRead?.(sql); return f.DB.prepare(sql).bind(...bindings).all(); },
      });
      return make([]);
    },
    batch() { throw Error("Custody helper may not batch or initialize schema"); },
  };
  const env = { ...f.env, DB,
    MEDIA: new Proxy({}, { get() { throw Error("Custody helper may not access media"); } }),
    ASSETS: { fetch() { throw Error("Custody helper may not access assets"); } } };
  const select = (revision = 0, contentSha256 = digest(raw)) => ({ output, documentId: DOCUMENT, artifactId: ARTIFACT, revision, contentSha256 });
  const replace = body => { raw = typeof body === "string" ? body : JSON.stringify(body);
    f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT); };
  return { ...f, env, calls, completion, select, replace, raw: () => raw,
    read: (selection = select(), actor = identity()) => readNativeRetainedTextCustody(env, actor, selection),
    append: (type, payload) => appendAuditEvent(f.env, stream, "user", type, { project_id: PROJECT, document_id: DOCUMENT, ...payload }),
    setBeforeRead: callback => { beforeRead = callback; } };
}
function snapshot(f) {
  const schema = f.sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
  const tables = Object.fromEntries(schema.filter(row => row.type === "table").map(({ name }) =>
    [name, f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()]));
  return structuredClone({ schema, tables, media: [...f.media] });
}
function current(f, proof) {
  const assertion = nativeRetainedTextCustodyAssertion(proof, f.env);
  assert.match(assertion.sql, /^EXISTS\(WITH /u);
  assert(assertion.bindings.length <= 100);
  return f.sqlite.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).get(...assertion.bindings).current;
}
const unavailable = error => error instanceof Error && error.message === "retained_story_unavailable";

for (const output of ["short_story", "scene", "slides"]) test(`${output}: actual custody proof binds the current retained native bytes without effects`, async t => {
  const f = await fixture(t, output), before = snapshot(f), selected = f.select(), actor = identity();
  const proof = await f.read(selected, actor), value = nativeRetainedTextCustodySnapshot(proof, f.env);
  assert.deepEqual(Reflect.ownKeys(proof), []); assert(Object.isFrozen(proof));
  assert.deepEqual(value.identity, actor); assert.deepEqual(value.selection, selected);
  assert.equal(value.projectId, PROJECT); assert.equal(value.contentId, CONTENT);
  assert.equal(value.completionId, f.completion.eventId); assert.equal(value.sourceExpiresAt, EXPIRY);
  assert.equal(value.dto.title, bodyFor().title);
  const { output: _output, ...nativeSelection } = selected;
  assert.deepEqual(value.dto.selection, nativeSelection);
  if (output === "short_story") assert.equal(value.dto.contentMarkdown, bodyFor().content_markdown);
  // The native public completion envelope omits private scene settings; this
  // custody helper does not promote that private metadata into the DTO.
  else if (output === "scene") assert.deepEqual(value.dto.content, { content_markdown: bodyFor().content_markdown, medium: null });
  else {
    assert.equal(value.dto.content.items.length, 1);
    assert.equal(value.dto.content.items[0].title, bodyFor().items[0].title);
    assert.equal(value.dto.content.items[0].body, bodyFor().items[0].body);
    assert.equal(value.dto.content.presentation, null);
    assert(Object.isFrozen(value.dto.content) && Object.isFrozen(value.dto.content.items) && Object.isFrozen(value.dto.content.items[0]));
    assert.throws(() => { value.dto.content.items[0].title = "Mutated"; }, TypeError);
  }
  assert.equal(current(f, proof), 1);
  assert.equal(f.calls.length, 4); assert.equal(f.calls.filter(sql => sql.includes("expected_events AS")).length, 1);
  assert(f.calls.every(sql => !/\b(?:private_json|artifact_revisions|document_jobs)\b/u.test(sql)), "no sponsor/job/private completion-body claim");
  actor.userId = "mutated"; selected.contentSha256 = "0".repeat(64);
  assert.equal(value.identity.userId, OWNER); assert.equal(value.selection.contentSha256, digest(f.raw()));
  assert(Object.isFrozen(value) && Object.isFrozen(value.identity) && Object.isFrozen(value.selection) && Object.isFrozen(value.dto));
  assert.deepEqual(snapshot(f), before);
});

test("custody proofs cannot be cloned, forged, rebound to another environment or rebound to another database", async t => {
  const f = await fixture(t), proof = await f.read(), before = snapshot(f);
  for (const forged of [{}, structuredClone(proof), Object.create(proof), new Proxy(proof, {})]) {
    assert.throws(() => nativeRetainedTextCustodySnapshot(forged, f.env), unavailable);
    assert.throws(() => nativeRetainedTextCustodyAssertion(forged, f.env), unavailable);
  }
  assert.throws(() => nativeRetainedTextCustodySnapshot(proof, { ...f.env }), unavailable);
  assert.throws(() => nativeRetainedTextCustodyAssertion(proof, { ...f.env }), unavailable);
  const db = f.env.DB; f.env.DB = { ...db };
  assert.throws(() => nativeRetainedTextCustodySnapshot(proof, f.env), unavailable);
  assert.throws(() => nativeRetainedTextCustodyAssertion(proof, f.env), unavailable);
  f.env.DB = db;
  const changed = nativeRetainedTextCustodyAssertion(proof, f.env);
  changed.sql = "1=1"; changed.bindings.fill("forged");
  assert.equal(current(f, proof), 1, "returned assertion mutation cannot weaken the internally captured proof");
  assert.deepEqual(snapshot(f), before);
});

test("old custody proof cannot refresh itself to a later native revision", async t => {
  const f = await fixture(t), original = f.select(), old = await f.read();
  f.replace({ ...bodyFor(), title: "Revised title", content_markdown: "Revised retained text." });
  await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT, revision: 1,
    content_sha256: digest(f.raw()), edited_by_user_id: OWNER });
  const before = snapshot(f);
  assert.equal(current(f, old), 0);
  assert.deepEqual(nativeRetainedTextCustodySnapshot(old, f.env).selection, original);
  assert.equal(nativeRetainedTextCustodySnapshot(old, f.env).dto.title, bodyFor().title);
  await assert.rejects(f.read(original), unavailable);
  const fresh = await f.read(f.select(1));
  assert.notEqual(fresh, old); assert.equal(current(f, fresh), 1);
  assert.equal(nativeRetainedTextCustodySnapshot(fresh, f.env).dto.title, "Revised title");
  assert.equal(current(f, old), 0, "fresh proof does not rebase an already reviewed selection");
  assert.deepEqual(snapshot(f), before);
});

const changes = [
  ["exact artifact JSON bytes", f => f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(CONTENT)],
  ["content redaction", f => f.sqlite.prepare("UPDATE private_content SET redacted_at='2020-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT)],
  ["content owner", f => f.sqlite.prepare("UPDATE private_content SET owner_id='foreign' WHERE content_id=?").run(CONTENT)],
  ["source expiry", f => f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT)],
  ["extended source expiry", f => f.sqlite.prepare("UPDATE private_content SET expires_at='2099-02-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT)],
  ["private source redaction", f => f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2020-01-01T00:00:00.000Z' WHERE private_event_id=?").run(f.completion.eventId)],
  ["private source owner", f => f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign' WHERE private_event_id=?").run(f.completion.eventId)],
  ["private source Document", f => f.sqlite.prepare("UPDATE event_private_payloads SET document_id='foreign' WHERE private_event_id=?").run(f.completion.eventId)],
  ["private source Project", f => f.sqlite.prepare("UPDATE event_private_payloads SET project_id='foreign' WHERE private_event_id=?").run(f.completion.eventId)],
  ["principal epoch snapshot", f => f.sqlite.prepare("UPDATE users SET updated_at='2020-01-01T00:00:00.000Z' WHERE user_id=?").run(OWNER)],
  ["principal consent", f => f.sqlite.prepare("UPDATE users SET consent_version='withdrawn' WHERE user_id=?").run(OWNER)],
  ["principal role", f => f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER)],
  ["organization Project custody", f => f.sqlite.prepare("INSERT INTO organization_projects VALUES(?,?,?,?,?,?,?)").run("tenant-access", PROJECT, "tenant", OWNER, "active", EXPIRY, EXPIRY)],
  ...["content", "document", "artifact"].map(kind => [`Project ${kind} custody`, f => f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run("tenant-access", kind, { content: CONTENT, document: DOCUMENT, artifact: ARTIFACT }[kind], "tenant", PROJECT, OWNER, OWNER, EXPIRY)]),
  ["Project event custody", f => f.sqlite.prepare("INSERT INTO project_event_scopes VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(f.completion.eventId, "tenant-access", "tenant", PROJECT, OWNER, `creative:${OWNER}`, 2, 1, OWNER, EXPIRY)],
  ["governed retention scope", f => f.sqlite.prepare("INSERT INTO private_content_retention_scopes VALUES(?,?,?,?,?,?,?,?,?)")
    .run(CONTENT, "tenant", "tenant-access", PROJECT, OWNER, "internal", 1, EXPIRY, EXPIRY)],
];
test("captured fixed SQL becomes false after each independent source, private metadata, access or custody change", async t => {
  const f = await fixture(t), proof = await f.read();
  assert.equal(current(f, proof), 1);
  for (const [name, mutate] of changes) {
    f.sqlite.exec("SAVEPOINT custody_change"); mutate(f); const before = snapshot(f);
    assert.equal(current(f, proof), 0, name);
    assert.deepEqual(snapshot(f), before, `${name}: assertion evaluation is read-only`);
    f.sqlite.exec("ROLLBACK TO custody_change; RELEASE custody_change");
    assert.equal(current(f, proof), 1, `${name}: fixture reset is exact`);
  }
  await f.append("DocumentRemoved", {});
  assert.equal(current(f, proof), 0, "current Document lifecycle is part of the proof");
  await assert.rejects(f.read(), unavailable);
});

test("a change between content read and final proof refuses issuing custody", async t => {
  const f = await fixture(t); let injected = false;
  f.setBeforeRead(sql => {
    if (sql.includes("expected_events AS")) {
      injected = true; f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(CONTENT);
    }
  });
  await assert.rejects(f.read(), unavailable);
  assert.equal(injected, true); assert.equal(f.calls.length, 4);
});

test("swapping the environment database during the first read cannot mint a proof for either database", async t => {
  const f = await fixture(t), before = snapshot(f), initial = f.env.DB; let injected = false;
  f.setBeforeRead(() => { if (!injected) { injected = true; f.env.DB = { ...initial }; } });
  await assert.rejects(f.read(), unavailable);
  assert.equal(injected, true); assert.equal(f.calls.length, 1);
  assert.deepEqual(snapshot(f), before);
});

const configurationCases = [
  { name: "missing cohort becomes empty", initial: {}, key: "FORMA_PILOT_COHORT_ID", changed: "" },
  { name: "missing admin list becomes empty", initial: {}, key: "FORMA_ADMIN_EMAILS", changed: "" },
  { name: "cohort gains whitespace", initial: { FORMA_PILOT_COHORT_ID: "synthetic-cohort", FORMA_ADMIN_EMAILS: EMAIL },
    key: "FORMA_PILOT_COHORT_ID", changed: " synthetic-cohort " },
  { name: "admin list changes case and whitespace", initial: { FORMA_PILOT_COHORT_ID: "synthetic-cohort", FORMA_ADMIN_EMAILS: EMAIL },
    key: "FORMA_ADMIN_EMAILS", changed: ` ${EMAIL.toUpperCase()} ` },
];
test("every awaited source read pins both exact admission configuration values", async t => {
  // Each substitution preserves effective admission, so refusal must come from
  // the captured environment boundary, not an incidental SQL/policy denial.
  // The configured baseline has an explicit owner breakglass entry.
  for (const variant of configurationCases) for (const readNumber of [1, 2, 3, 4]) {
    const f = await fixture(t); Object.assign(f.env, variant.initial);
    const before = snapshot(f); let injected = false;
    f.setBeforeRead(() => {
      if (f.calls.length === readNumber) { injected = true; f.env[variant.key] = variant.changed; }
    });
    await assert.rejects(f.read(), unavailable, `${variant.name} at source read ${readNumber}`);
    assert.equal(injected, true); assert.equal(f.calls.length, readNumber);
    assert.deepEqual(snapshot(f), before, `${variant.name}: configuration refusal is read-only`);
  }
});

test("issued custody cannot survive configuration substitution through either proof getter", async t => {
  for (const variant of configurationCases) {
    const f = await fixture(t); Object.assign(f.env, variant.initial);
    const proof = await f.read(), before = snapshot(f), calls = f.calls.length;
    const retained = nativeRetainedTextCustodySnapshot(proof, f.env);
    assert.equal(current(f, proof), 1);
    const original = f.env[variant.key];
    f.env[variant.key] = original;
    assert.equal(nativeRetainedTextCustodySnapshot(proof, f.env), retained, "same raw value is not substitution");
    assert.equal(current(f, proof), 1);
    f.env[variant.key] = variant.changed;
    assert.throws(() => nativeRetainedTextCustodySnapshot(proof, f.env), unavailable, variant.name);
    assert.throws(() => nativeRetainedTextCustodyAssertion(proof, f.env), unavailable, variant.name);
    assert.equal(f.calls.length, calls, "proof getters refuse without another source read or refreshed proof");
    assert.deepEqual(snapshot(f), before);
    f.env[variant.key] = original;
    assert.equal(current(f, proof), 1, "restoring the exact captured value restores this unchanged fixture");
  }
});

test("caller identity and selection changes during the first read cannot retarget a proof", async t => {
  const f = await fixture(t), actor = identity(), selected = f.select(), original = structuredClone(selected), before = snapshot(f);
  f.setBeforeRead(() => { actor.userId = "foreign"; actor.email = "foreign@example.test"; selected.artifactId = "foreign"; selected.revision = 1; });
  const proof = await f.read(selected, actor), value = nativeRetainedTextCustodySnapshot(proof, f.env);
  assert.deepEqual(value.identity, identity()); assert.deepEqual(value.selection, original);
  assert.equal(current(f, proof), 1); assert.deepEqual(snapshot(f), before);
});

test("hosted identity requires bounded verified principal headers and rejects project/persona selection", () => {
  const request = headers => new Request("https://forma.test/retained", { headers });
  const headers = { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL.toUpperCase() };
  const parsed = hostedIdentity(request(headers));
  assert.deepEqual(parsed, identity()); assert(Object.isFrozen(parsed));
  for (const values of [{}, { "cf-access-authenticated-user-email": EMAIL }, { ...headers, "oai-authenticated-user-id": "x".repeat(241) },
    { ...headers, "oai-authenticated-user-email": "x".repeat(321) }, { ...headers, "oai-authenticated-user-id": "two words" }]) {
    assert.equal(hostedIdentity(request(values)), null);
  }
  for (const cookie of ["forma_project_context=", "forma_impersonation=selected", "other=x; forma_project_context=selected", "x".repeat(8193)]) {
    assert.throws(() => hostedIdentity(request({ ...headers, cookie })), /personal_principal_required/u);
  }
});

test("authenticated owner access does not override an organization restriction for unauthenticated text delivery", async t => {
  const f = await fixture(t), proof = await f.read(), now = new Date().toISOString();
  assert.equal(current(f, proof), 1); f.calls.length = 0;
  f.sqlite.prepare("INSERT INTO organizations VALUES(?,?,?,?,?,?)").run("policy-org", "Policy org", OWNER, "active", now, now);
  f.sqlite.prepare("INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run("policy-member", "policy-org", OWNER, "owner", "active", OWNER, now, now, now);
  f.sqlite.prepare("INSERT INTO organization_security_policies(organization_id,allowed_domains_json,updated_by_user_id,updated_at) VALUES(?,?,?,?)")
    .run("policy-org", JSON.stringify(["example.test"]), OWNER, now);
  const before = snapshot(f);
  assert.equal(current(f, proof), 0, "a newly restricted owner invalidates prior custody without changing user.updated_at");
  const { output: _output, ...selected } = f.select();
  const authenticated = await handleRetainedStoryRead(new Request("https://forma.test" + retainedStoryRequestPath(selected), {
    headers: { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL },
  }), f.env);
  assert.equal(authenticated.status, 200);
  assert.equal((await authenticated.json()).contentMarkdown, bodyFor().content_markdown);
  f.calls.length = 0;
  await assert.rejects(f.read(), error => error.message === "retained_story_access_denied");
  assert.equal(f.calls.some(sql => sql.includes("event_base AS")), false, "denied before private artifact selection");
  assert.deepEqual(snapshot(f), before);
});
