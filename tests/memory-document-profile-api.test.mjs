import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Isolated ordinary API/SQLite tests. Native auth/consent, document preparation,
// admission, parent authority and profile/external readers are module-load seams.
// API and privacy callbacks, custody/parser/witness, store/schema SQL execution,
// and the kernel's suppression selector/validator remain real implementations.
// No Worker/index/bootstrap, native-depth harness, provider or hosted DB executes.
globalThis.fetch = async () => { throw new Error("profile_api_external_fetch_forbidden"); };
const root = new URL("../", import.meta.url).href;
const localResolve = (specifier, context, nextResolve) => nextResolve(
  typeof context.parentURL === "string" && context.parentURL.startsWith(root)
    && !context.parentURL.includes("/node_modules/") && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier)
    ? `${specifier}.ts` : specifier, context);
let loading = registerHooks({ resolve: localResolve });
const [kernel, model, store] = await Promise.all([
  import("../worker/memory-document-profile.ts"), import("../src/model/memory-document-profile.ts"),
  import("../worker/memory-document-profile-store.ts"),
]).finally(() => loading.deregister());

const seam = { current: null, kernel };
globalThis.__formaDocumentProfileApiTest = seam;
const seamSources = {
  "pilot-policy": `const s=globalThis.__formaDocumentProfileApiTest;
    export const requireUser=(...args)=>s.current.requireUser(...args);
    export const requireConsent=(...args)=>s.current.requireConsent(...args);`,
  "context-authoring-authority": `const s=globalThis.__formaDocumentProfileApiTest;
    export const prepareDocumentAuthority=(...args)=>s.current.prepareDocumentAuthority(...args);`,
  "consequential-consent": `const s=globalThis.__formaDocumentProfileApiTest;
    export const executionAdmissionGuard=(...args)=>s.current.executionAdmissionGuard(...args);`,
  "memory-live-authority": `const s=globalThis.__formaDocumentProfileApiTest;
    export const LIVE_MEMORY_POLICY="personal-memory-v2";
    export const LIVE_MEMORY_REVIEW_TIMING="daily-with-daytime-catch-up";
    export const LIVE_MEMORY_REVIEW_CONTRACT={timing:LIVE_MEMORY_REVIEW_TIMING};
    export const liveMemoryAuthority=(...args)=>s.current.liveMemoryAuthority(...args);
    // This fixture issues no maintenance attempts; it cannot attest their ownership.
    export const liveMemoryMaintenanceAttemptFor=()=>false;
    export const liveMemoryEnrollmentGuard=()=>{throw new Error("unused_native_enrollment_reader");};`,
  "memory-live-sources": `export const liveMemorySourceQuery=()=>{throw new Error("unused_native_sources");};
    export const liveMemoryView=()=>{throw new Error("unused_native_view");};`,
  "memory-live-recall": `export const recallLiveMemoryResponse=()=>{throw new Error("unused_live_recall");};`,
  "memory-live-export": `export const exportLiveMemory=()=>{throw new Error("unused_live_export");};`,
  "memory-document-profile": `const s=globalThis.__formaDocumentProfileApiTest;
    export const documentProfileGrantValid=(...args)=>s.kernel.documentProfileGrantValid(...args);
    export const nativeDocumentProfileSuppressionsQuery=(...args)=>s.kernel.nativeDocumentProfileSuppressionsQuery(...args);
    export const nativeDocumentProfileSuppressionsValue=(...args)=>s.kernel.nativeDocumentProfileSuppressionsValue(...args);
    export const readNativeDocumentPaletteProfile=(...args)=>s.current.readNativeDocumentPaletteProfile(...args);`,
};
loading = registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = localResolve(specifier, context, nextResolve);
    const name = Object.keys(seamSources).find(name => resolved.url === `${root}worker/${name}.ts`);
    return name && ["memory-document-profile-api", "memory-live-api", "memory-live-store"].some(name => context.parentURL === `${root}worker/${name}.ts`)
      ? { url: `forma-document-profile-test:${name}`, shortCircuit: true } : resolved;
  },
  load(url, context, nextLoad) {
    if (url.startsWith("forma-document-profile-test:")) return {
      format: "module", source: seamSources[url.split(":")[1]], shortCircuit: true,
    };
    return nextLoad(url, context);
  },
});
const [profileApi, liveStore, liveApi] = await Promise.all([import("../worker/memory-document-profile-api.ts"),
  import("../worker/memory-live-store.ts"), import("../worker/memory-live-api.ts")]).finally(() => loading.deregister());
const { handleMemoryDocumentProfile } = profileApi;

const VERSION = "document-profile-control-v1";
const POLICY = "document-profile-v1", RECIPE = "native-document-palette-choice-v1";
const at = offset => new Date(Date.now() + offset).toISOString();
const jsonCopy = value => JSON.parse(JSON.stringify(value));
const keys = value => Object.keys(value).sort();
const GRANT_KEYS = ["grantId", "revision", "organizationId", "projectAccessId", "ownerUserId", "projectId", "documentId",
  "enrollmentId", "enrollmentRevision", "policyVersion", "recipeVersion", "infer", "inspect", "background", "sourceAfterSequence",
  "consentedAt", "expiresAt", "retentionDays", "revokedAt"].sort();

function fixture(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => { sqlite.close(); if (seam.current === f) seam.current = null; });
  sqlite.exec(`CREATE TABLE memory_live_enrollments (
    enrollment_id TEXT PRIMARY KEY, actor_user_id TEXT, owner_user_id TEXT, organization_id TEXT, project_access_id TEXT,
    project_id TEXT, document_id TEXT, permission_epoch TEXT, policy_version TEXT, revision INTEGER,
    learn_enabled INTEGER, recall_enabled INTEGER, background_enabled INTEGER, retention_days INTEGER, time_zone TEXT,
    enrolled_at TEXT, expires_at TEXT, cursor_sequence INTEGER, cutoff_sequence INTEGER, last_local_day TEXT,
    last_admitted_at TEXT, next_due_at TEXT, lease_token TEXT, lease_expires_at TEXT, attempts INTEGER, failure_code TEXT);
    CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,sequence INTEGER);
    CREATE TABLE users(user_id TEXT PRIMARY KEY,role TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE profile_api_native_authority(actor_id TEXT PRIMARY KEY,epoch TEXT NOT NULL,token TEXT NOT NULL,admitted INTEGER NOT NULL);
    CREATE TABLE profile_api_kernel_source(id TEXT PRIMARY KEY,body TEXT NOT NULL);`);
  if (options.schema !== false) sqlite.exec(readFileSync(new URL("../drizzle/0028_memory_document_profile.sql", import.meta.url), "utf8"));
  const insert = (table, row) => sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  const executed = [], calls = [], hooks = { beforeStatement: null, afterStatement: null, beforeBatch: null, afterBatch: null };
  let inBatch = false;
  class Prepared {
    constructor(sql, bindings = []) { this.sql = sql; this.bindings = [...bindings]; }
    bind(...bindings) { return new Prepared(this.sql, bindings); }
    async all() {
      assert.ok(this.bindings.length <= 99, "bounded D1 parameters");
      assert.ok(this.sql.length <= 90_000, "bounded statement bytes");
      if (hooks.beforeStatement) await hooks.beforeStatement(this, inBatch);
      executed.push({ sql: this.sql, bindings: [...this.bindings], inBatch });
      const statement = sqlite.prepare(this.sql), results = statement.all(...this.bindings).map(row => ({ ...row }));
      const result = { success: true, results, meta: { changes: Number(sqlite.prepare("SELECT changes() AS n").get().n) } };
      if (hooks.afterStatement) await hooks.afterStatement(this, result, inBatch);
      return result;
    }
    async first(column) { const row = (await this.all()).results[0] ?? null; return column && row ? row[column] : row; }
    async run() { return this.all(); }
  }
  const DB = { prepare: sql => new Prepared(sql), async batch(statements) {
    if (hooks.beforeBatch) await hooks.beforeBatch(statements);
    sqlite.exec("BEGIN"); inBatch = true;
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      sqlite.exec("COMMIT"); inBatch = false;
      const replaced = hooks.afterBatch ? await hooks.afterBatch(statements, results) : undefined;
      return replaced === undefined ? results : replaced;
    } catch (error) { if (inBatch) sqlite.exec("ROLLBACK"); inBatch = false; throw error; }
  } };
  const actor = "profile-api-actor", owner = options.shared ? "profile-api-owner" : actor;
  const scope = options.shared ? { organizationId: "profile-api-org", projectAccessId: "profile-api-access", ownerUserId: owner,
    projectId: "profile-api-project", actorUserId: actor } : null;
  const principal = { userId: actor, role: "viewer", email: "profile-api@example.invalid", fictional: false, streamId: `creative:${actor}`,
    access: { permissionEpoch: "epoch-1", grants: [] }, authorizationSnapshot: { grants: "[]", token: "original-token", updatedAt: "original-update" } };
  const binding = { actorUserId: actor, permissionEpoch: "epoch-1", streamId: `creative:${owner}`,
    projectId: "profile-api-project", documentId: "profile-api-document", scope, contextSessionId: null };
  const parent = { enrollment_id: "profile-api-enrollment", actor_user_id: actor, owner_user_id: owner,
    organization_id: scope?.organizationId ?? null, project_access_id: scope?.projectAccessId ?? null,
    project_id: binding.projectId, document_id: binding.documentId, permission_epoch: "epoch-1", policy_version: "personal-memory-v2",
    revision: 1, learn_enabled: 1, recall_enabled: 1, background_enabled: 0, retention_days: 30, time_zone: "UTC",
    enrolled_at: at(-86_400_000), expires_at: at(86_400_000), cursor_sequence: 5, cutoff_sequence: null,
    last_local_day: null, last_admitted_at: null, next_due_at: at(0), lease_token: null, lease_expires_at: null, attempts: 0, failure_code: null };
  if (options.parent !== false) insert("memory_live_enrollments", parent);
  insert("events", { event_id: "source-head", stream_id: binding.streamId, sequence: 7 });
  insert("profile_api_native_authority", { actor_id: actor, epoch: "epoch-1", token: "original-token", admitted: 1 });
  insert("users", { user_id: actor, role: "viewer", updated_at: "original-update" });
  insert("profile_api_kernel_source", { id: "source", body: "original certified palette" });
  const env = { DB, FORMA_MEMORY_ENABLED: "true", FORMA_MEMORY_USER_IDS: actor,
    FORMA_MEMORY_PROFILE_ENABLED: "true", FORMA_MEMORY_PROFILE_USER_IDS: actor };
  const f = { sqlite, DB, env, insert, executed, calls, hooks, principal, binding, parent, scope, sourceHead: 7,
    authResponse: null, prepareResponse: null, consentResponse: null, kernelValue: null,
    afterPrepare: null, afterKernel: null, afterParentAuthority: null, observeKernel: true, parentAuthorityAvailable: true,
    async requireUser(request, actualEnv, role, options) {
      calls.push({ kind: "auth", role, options }); assert.equal(actualEnv, env);
      return f.authResponse ? { response: f.authResponse } : { user: principal };
    },
    requireConsent(user) { calls.push({ kind: "consent" }); assert.equal(user.userId, principal.userId); return f.consentResponse; },
    async prepareDocumentAuthority(request, actualEnv, body, authority) {
      calls.push({ kind: "prepare", authority, body: jsonCopy(body) }); assert.equal(actualEnv, env);
      if (f.prepareResponse) return f.prepareResponse;
      const prepared = { principal: structuredClone(principal), binding: structuredClone(binding), sourceHead: f.sourceHead };
      if (f.afterPrepare) await f.afterPrepare(prepared);
      return prepared;
    },
    executionAdmissionGuard(user, currentBinding, head) {
      calls.push({ kind: "admission", principal: structuredClone(user), binding: structuredClone(currentBinding), head });
      return { sql: "EXISTS(SELECT 1 FROM profile_api_native_authority WHERE actor_id=? AND epoch=? AND token=? AND admitted=1)"
        + (head === null ? "" : " AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?"),
        bindings: [user.userId, user.access.permissionEpoch, user.authorizationSnapshot.token,
          ...(head === null ? [] : [currentBinding.streamId, head])] };
    },
    async liveMemoryAuthority(actualEnv, enrollment) {
      assert.equal(actualEnv, env); calls.push({ kind: "parent-authority", enrollment: structuredClone(enrollment) });
      if (!f.parentAuthorityAvailable) return null;
      const original = structuredClone(principal), bound = structuredClone(binding);
      const native = f.executionAdmissionGuard(original, bound, null);
      const result = { principal: original, binding: bound, guard: { condition: native.sql, bindings: native.bindings } };
      if (f.afterParentAuthority) await f.afterParentAuthority(result);
      return result;
    },
    async readNativeDocumentPaletteProfile(actualEnv, prepared, grantId, observer) {
      calls.push({ kind: "kernel", prepared: structuredClone(prepared), grantId }); assert.equal(actualEnv, env);
      assert.equal(prepared.principal.userId, principal.userId); assert.deepEqual(prepared.binding, binding);
      const value = f.kernelValue ? structuredClone(f.kernelValue) : f.profile(grantId);
      const grant = f.grant(), suppressionQuery = kernel.nativeDocumentProfileSuppressionsQuery(grant);
      const suppressionRows = sqlite.prepare(suppressionQuery.sql).all(...suppressionQuery.bindings).map(row => ({ ...row }));
      const applicable = kernel.nativeDocumentProfileSuppressionsValue(suppressionRows, grant, Date.now());
      if (!applicable) return null;
      value.choices = value.choices.filter(choice => !applicable.suppressed.has(choice.claimKey));
      value.coverage.eligibleChoiceCount = value.choices.length;
      if (f.observeKernel) {
        const query = { sql: "SELECT id,body FROM profile_api_kernel_source ORDER BY id", bindings: [], role: "exact" };
        const statement = DB.prepare(query.sql), result = await statement.all();
        observer.observe([statement], [result], [query]);
        for (const query of [
          { sql: "SELECT * FROM memory_document_profile_grants WHERE grant_id=?", bindings: [grantId], role: "exact" },
          { sql: "SELECT * FROM memory_live_enrollments WHERE enrollment_id=?", bindings: [f.parent.enrollment_id], role: "exact" },
          suppressionQuery,
        ]) {
          const statement = DB.prepare(query.sql).bind(...query.bindings), result = await statement.all();
          observer.observe([statement], [result], [query]);
        }
        observer.require(f.executionAdmissionGuard(prepared.principal, prepared.binding, null));
        observer.before(value.lifetime.validUntil);
        if (applicable.validUntil) observer.before(applicable.validUntil);
      }
      if (f.afterKernel) await f.afterKernel(value, observer);
      return value;
    },
    body(overrides = {}) { return { version: VERSION, policyVersion: POLICY, recipeVersion: RECIPE,
      projectId: binding.projectId, documentId: binding.documentId, enrollmentId: parent.enrollment_id,
      enrollmentRevision: parent.revision, revision: 0,
      expectedCustody: scope ? { kind: "organization", organizationId: scope.organizationId, projectAccessId: scope.projectAccessId, ownerUserId: scope.ownerUserId } : { kind: "personal" },
      infer: true, inspect: true, background: false, retentionDays: 7, expiresAt: at(3_600_000), confirmation: "ENABLE_DOCUMENT_PALETTE_PROFILE", ...overrides }; },
    grant() { return sqlite.prepare("SELECT * FROM memory_document_profile_grants WHERE actor_user_id=? ORDER BY grant_id LIMIT 1").get(actor); },
    profile(grantId) { const g = f.grant(); return { version: RECIPE, treatment: "document-authored-palette-choices", inferredPreferences: false,
      independentEvidence: false, scope: { organizationId: binding.scope?.organizationId ?? null, projectAccessId: binding.scope?.projectAccessId ?? null,
        projectId: binding.projectId, documentId: binding.documentId }, grant: { id: grantId, revision: g?.revision ?? 1 },
      lifetime: { checkedAt: at(0), validUntil: at(30_000) },
      coverage: { bounded: true, completeHistory: false, blockLimit: 16, sourceLimit: 128, selectedBlockCount: 1, eligibleChoiceCount: 1 },
      choices: [{ claimKey: "a".repeat(64), colors: ["#123456"], status: "supported", supports: [{ blockId: "profile-api-block", intent: "prefer",
        lineage: "unknown", independentEvidence: false, sources: [{ eventId: "palette-source", sequence: 8, type: "BlockCreated", recordedAt: at(-1000) }] }], counterevidence: [] }] }; },
    async call(operation, method = "GET", body, query = {}, headers = {}) {
      seam.current = f;
      const url = new URL(`https://forma.example.invalid/api/memory/document-profile/${operation}`);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
      const request = new Request(url, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
      const response = await handleMemoryDocumentProfile(request, env, operation);
      let value = null; try { value = await response.json(); } catch { /* Preserve null so response-shape assertions expose non-JSON failures. */ }
      return { response, status: response.status, value };
    },
    async enable(overrides) { const result = await f.call("settings", "PUT", f.body(overrides)); assert.equal(result.status, 200, JSON.stringify(result.value)); return result.value; },
  };
  seam.current = f;
  return f;
}

function noGrantWrites(f) {
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_grants").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
}
function privateResponse(result) {
  assert.equal(result.response.headers.get("cache-control"), "private, no-store");
  assert.match(result.response.headers.get("vary") ?? "", /Cookie/u);
}
function denied(result) { assert.ok(result.status >= 400 && result.status < 600, JSON.stringify(result.value)); assert.equal(typeof result.value?.error, "string"); }
const queryFor = f => ({ projectId: f.binding.projectId, documentId: f.binding.documentId });

test("document profile API: default settings never enroll a user or create a grant", async t => {
  const f = fixture(t, { parent: false }), result = await f.call("settings", "GET", undefined, queryFor(f));
  assert.equal(result.status, 200, JSON.stringify(result.value)); privateResponse(result);
  assert.equal(result.value.version, VERSION); assert.equal(result.value.policyVersion, POLICY); assert.equal(result.value.recipeVersion, RECIPE);
  assert.equal(result.value.purpose, "authored-palette-organization"); assert.equal(result.value.backgroundSupported, false);
  assert.equal(result.value.parent, null); assert.equal(result.value.grant, null); noGrantWrites(f);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_live_enrollments").get().n, 0);
  assert.ok(f.calls.some(call => call.kind === "prepare" && call.authority === "read"));
  assert.ok(f.calls.filter(call => call.kind === "auth").every(call => call.options.account === "principal"));
});

for (const shared of [false, true]) test(`document profile API: explicit ${shared ? "organization" : "personal"} enable binds native custody and starts after current source head`, async t => {
  const f = fixture(t, { shared }), before = f.sqlite.prepare("SELECT * FROM memory_live_enrollments").all().map(row => ({ ...row }));
  const output = await f.enable(), row = f.grant();
  assert.equal(output.version, VERSION); assert.deepEqual(keys(output.grant), GRANT_KEYS);
  assert.equal(output.historyStartsAfterSequence, 7); assert.equal(output.grant.sourceAfterSequence, 7);
  assert.equal(row.source_after_sequence, 7, "parent review cursor is not the future-only profile boundary");
  assert.equal(row.actor_user_id, f.principal.userId); assert.equal(row.owner_user_id, f.scope?.ownerUserId ?? f.principal.userId);
  assert.equal(row.organization_id, f.scope?.organizationId ?? null); assert.equal(row.project_access_id, f.scope?.projectAccessId ?? null);
  assert.equal(row.enrollment_id, f.parent.enrollment_id); assert.equal(row.enrollment_revision, f.parent.revision);
  assert.equal(row.infer_enabled, 1); assert.equal(row.inspect_enabled, 1); assert.equal(row.background_enabled, 0);
  assert.equal(row.revision, 1); assert.equal(row.revoked_at, null);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM memory_live_enrollments").all().map(value => ({ ...value })), before);
  assert.ok(f.calls.some(call => call.kind === "prepare" && call.authority === "read"));
  const settings = await f.call("settings", "GET", undefined, queryFor(f));
  assert.equal(settings.status, 200, JSON.stringify(settings.value));
  assert.equal(settings.value.grant.grantId, row.grant_id);
  assert.deepEqual(settings.value.scope.custody, f.body().expectedCustody);
});

for (const [name, mutation] of [
  ["base flag off", f => { f.env.FORMA_MEMORY_ENABLED = "false"; }],
  ["profile flag off", f => { f.env.FORMA_MEMORY_PROFILE_ENABLED = "false"; }],
  ["base enrollment allowlist absent", f => { delete f.env.FORMA_MEMORY_USER_IDS; }],
  ["profile allowlist absent", f => { delete f.env.FORMA_MEMORY_PROFILE_USER_IDS; }],
  ["wildcard allowlist", f => { f.env.FORMA_MEMORY_PROFILE_USER_IDS = "*"; }],
  ["another actor allowlisted", f => { f.env.FORMA_MEMORY_PROFILE_USER_IDS = "some-other-actor"; }],
]) test("document profile API: enable denies " + name, async t => {
  const f = fixture(t); mutation(f); const result = await f.call("settings", "PUT", f.body());
  denied(result); noGrantWrites(f); assert.equal(f.calls.some(call => call.kind === "kernel"), false);
});

const invalidEnable = [
  ["unknown control version", value => { value.version = "future"; }],
  ["legacy parent policy as purpose", value => { value.policyVersion = "personal-memory-v2"; }],
  ["unknown recipe", value => { value.recipeVersion = "all-preferences"; }],
  ["missing explicit custody", value => { delete value.expectedCustody; }],
  ["extra personal custody field", value => { value.expectedCustody.ownerUserId = "profile-api-actor"; }],
  ["unknown field", value => { value.privateText = "must not store"; }],
  ["inference false", value => { value.infer = false; }],
  ["inspection false", value => { value.inspect = false; }],
  ["background true", value => { value.background = true; }],
  ["coerced infer flag", value => { value.infer = "true"; }],
  ["null background flag", value => { value.background = null; }],
  ["missing confirmation", value => { delete value.confirmation; }],
  ["wrong confirmation", value => { value.confirmation = "ENABLE_PERSONAL_MEMORY"; }],
  ["negative revision", value => { value.revision = -1; }],
  ["string revision", value => { value.revision = "0"; }],
  ["fractional parent revision", value => { value.enrollmentRevision = 1.5; }],
  ["zero parent revision", value => { value.enrollmentRevision = 0; }],
  ["unsafe revision", value => { value.revision = Number.MAX_SAFE_INTEGER + 1; }],
  ["zero retention", value => { value.retentionDays = 0; }],
  ["excess retention", value => { value.retentionDays = 366; }],
  ["noncanonical expiry", value => { value.expiresAt = "2099-01-01T00:00:00Z"; }],
  ["empty document", value => { value.documentId = ""; }],
  ["trimmed project", value => { value.projectId = " project "; }],
  ["control identifier", value => { value.enrollmentId = "invalid\nidentifier"; }],
];
for (const [name, edit] of invalidEnable) test("document profile API: strict enable rejects " + name, async t => {
  const f = fixture(t), body = f.body(); edit(body);
  const result = await f.call("settings", "PUT", body); assert.equal(result.status, 400, JSON.stringify(result.value)); noGrantWrites(f);
});

test("document profile API: request bodies are byte-bounded and malformed JSON cannot write", async t => {
  const f = fixture(t);
  for (const body of ["null", "[]", "{", "true"]) {
    const result = await f.call("settings", "PUT", body); assert.equal(result.status, 400); noGrantWrites(f);
  }
  const oversized = JSON.stringify({ ...f.body(), oversized: "文".repeat(4096) });
  const result = await f.call("settings", "PUT", oversized); assert.equal(result.status, 413); noGrantWrites(f);
});

test("document profile API: malformed UTF-8 request bytes fail before native preparation", async t => {
  const f = fixture(t); seam.current = f;
  const request = new Request("https://forma.example.invalid/api/memory/document-profile/settings", {
    method: "PUT", headers: { "content-type": "application/json" }, body: new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]),
  });
  const response = await handleMemoryDocumentProfile(request, f.env, "settings"); assert.equal(response.status, 400);
  assert.equal(f.calls.some(call => call.kind === "prepare"), false); noGrantWrites(f);
});

for (const [operation, method] of [["settings", "POST"], ["inspect", "PUT"], ["suppress", "GET"]])
  test(`document profile API: method admission rejects ${method} ${operation}`, async t => {
    const f = fixture(t), result = await f.call(operation, method);
    assert.equal(result.status, 405); assert.equal(f.calls.length, 0); noGrantWrites(f);
  });

test("document profile API: ambiguous inspection query parameters cannot reach the kernel", async t => {
  const f = fixture(t), enabled = await f.enable(); f.calls.length = 0; seam.current = f;
  const url = new URL("https://forma.example.invalid/api/memory/document-profile/inspect");
  url.searchParams.append("version", VERSION); url.searchParams.append("grantId", enabled.grant.grantId); url.searchParams.append("grantId", "other");
  const response = await handleMemoryDocumentProfile(new Request(url), f.env, "inspect"); assert.equal(response.status, 400);
  assert.equal(f.calls.some(call => call.kind === "kernel"), false);
});

for (const headers of [{ origin: "https://other.example.invalid" }, { "sec-fetch-site": "cross-site" }])
  test("document profile API: cross-origin mutation rejected " + Object.keys(headers)[0], async t => {
    const f = fixture(t), result = await f.call("settings", "PUT", f.body(), {}, headers);
    assert.equal(result.status, 403); noGrantWrites(f);
  });

for (const [name, shared, edit] of [
  ["personal to organization", true, value => { value.expectedCustody = { kind: "personal" }; }],
  ["organization to personal", false, value => { value.expectedCustody = { kind: "organization", organizationId: "org", projectAccessId: "access", ownerUserId: "owner" }; }],
  ...["organizationId", "projectAccessId", "ownerUserId"].map(field => ["different " + field, true, value => { value.expectedCustody[field] += "-different"; }]),
]) test("document profile API: native custody mismatch rejects " + name, async t => {
  const f = fixture(t, { shared }), body = f.body(); edit(body);
  const result = await f.call("settings", "PUT", body); assert.equal(result.status, 409, JSON.stringify(result.value)); noGrantWrites(f);
  assert.ok(f.calls.some(call => call.kind === "prepare"), "expected custody never substitutes for native resolution");
});

for (const [field, value] of [
  ["actor_user_id", "other-actor"], ["owner_user_id", "other-owner"], ["organization_id", "other-org"],
  ["project_access_id", "other-access"], ["project_id", "other-project"], ["document_id", "other-document"],
  ["permission_epoch", "epoch-2"], ["policy_version", "personal-memory-v1"], ["revision", 2],
  ["learn_enabled", 0], ["recall_enabled", 0], ["retention_days", 2], ["failure_code", "revoked"],
]) test("document profile API: parent grant must match original " + field, async t => {
  const f = fixture(t); f.sqlite.prepare(`UPDATE memory_live_enrollments SET ${field}=?`).run(value);
  const result = await f.call("settings", "PUT", f.body()); denied(result); noGrantWrites(f);
});

test("document profile API: unavailable, expired or shorter parent enrollment cannot enable", async t => {
  const f = fixture(t);
  assert.equal((await f.call("settings", "PUT", f.body({ expiresAt: at(-1_000) }))).status, 409); noGrantWrites(f);
  for (const expiry of [at(-1_000), at(10_000)]) {
    f.sqlite.prepare("UPDATE memory_live_enrollments SET expires_at=?").run(expiry);
    const result = await f.call("settings", "PUT", f.body()); denied(result); noGrantWrites(f);
  }
  f.sqlite.exec("DELETE FROM memory_live_enrollments");
  denied(await f.call("settings", "PUT", f.body())); noGrantWrites(f);
});

test("document profile API: future-only source boundary uses exact captured head CAS", async t => {
  const f = fixture(t); let raced = false;
  f.afterPrepare = () => { raced = true; f.insert("events", { event_id: "late-source", stream_id: f.binding.streamId, sequence: 8 }); };
  const result = await f.call("settings", "PUT", f.body()); assert.equal(raced, true);
  assert.equal(result.status, 503, JSON.stringify(result.value)); noGrantWrites(f);
  assert.equal(f.sqlite.prepare("SELECT MAX(sequence) AS n FROM events").get().n, 8);
});

test("document profile API: original principal is not renewed after native preparation", async t => {
  const f = fixture(t); let raced = false;
  f.afterPrepare = () => {
    raced = true; f.sqlite.exec("UPDATE profile_api_native_authority SET token='renewed-token'");
    f.principal.authorizationSnapshot.token = "renewed-token";
  };
  const result = await f.call("settings", "PUT", f.body()); assert.equal(raced, true);
  assert.equal(result.status, 503, JSON.stringify(result.value)); noGrantWrites(f);
  assert.ok(f.calls.some(call => call.kind === "admission" && call.principal.authorizationSnapshot.token === "original-token"));
});

test("document profile API: authority loss after grant INSERT rolls the entire write back", async t => {
  const f = fixture(t); let raced = false;
  f.hooks.afterStatement = statement => {
    if (/INSERT INTO memory_document_profile_grants/iu.test(statement.sql)) {
      raced = true; f.sqlite.exec("UPDATE profile_api_native_authority SET admitted=0");
    }
  };
  const result = await f.call("settings", "PUT", f.body()); assert.equal(raced, true);
  assert.equal(result.status, 503, JSON.stringify(result.value)); noGrantWrites(f);
  assert.equal(f.sqlite.prepare("SELECT admitted FROM profile_api_native_authority").get().admitted, 1, "same transaction rolls back test race too");
});

test("document profile API: stale initial revision cannot create a second scope grant", async t => {
  const f = fixture(t), first = await f.enable(), result = await f.call("settings", "PUT", f.body());
  assert.equal(result.status, 409, JSON.stringify(result.value));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_grants").get().n, 1);
  assert.equal(f.grant().grant_id, first.grant.grantId); assert.equal(f.grant().revision, 1);
});

test("document profile API: competing initial grant after absent selection defeats commit CAS", async t => {
  const f = fixture(t); let inserted = false;
  f.hooks.beforeBatch = statements => {
    const insert = statements.find(statement => /INSERT INTO memory_document_profile_grants/iu.test(statement.sql));
    if (insert && !inserted) { inserted = true; f.sqlite.prepare(insert.sql).run(...insert.bindings); }
  };
  const result = await f.call("settings", "PUT", f.body()); assert.equal(inserted, true);
  assert.equal(result.status, 503, JSON.stringify(result.value)); assert.equal(result.value.error, "document_profile_commit_delivery_unconfirmed");
  assert.equal(f.grant().revision, 1); assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_grants").get().n, 1);
});

test("document profile API: a thrown lost response after committed enable is not classified as rollback", async t => {
  const f = fixture(t); let injected = false;
  f.hooks.afterBatch = statements => {
    if (statements.some(statement => /INSERT INTO memory_document_profile_grants/iu.test(statement.sql))) {
      injected = true; throw new Error("isolated-lost-postcommit-response");
    }
  };
  const result = await f.call("settings", "PUT", f.body()); assert.equal(injected, true);
  assert.equal(result.status, 503, JSON.stringify(result.value)); assert.equal(result.value.error, "document_profile_commit_delivery_unconfirmed");
  assert.equal(f.grant().revision, 1); assert.equal(f.grant().infer_enabled, 1);
});

for (const [name, replace] of [
  ["duplicate infer", raw => raw.replace('"infer":true', '"infer":true,"infer":true')],
  ["duplicate version", raw => raw.replace('"version":', `"version":"${VERSION}","version":`)],
  ["escaped-equivalent field", raw => raw.replace('"infer":true', '"infer":true,"\\u0069nfer":true')],
  ["nested duplicate custody", raw => raw.replace('"kind":"personal"', '"kind":"personal","kind":"personal"')],
]) test("document profile API: JSON request rejects " + name, async t => {
  const f = fixture(t), result = await f.call("settings", "PUT", replace(JSON.stringify(f.body())));
  assert.equal(result.status, 400, JSON.stringify(result.value)); noGrantWrites(f);
});

test("document profile API: JSON punctuation inside a valid identifier is not treated as structure", async t => {
  const f = fixture(t); f.binding.projectId = 'project:"{},[]:';
  f.sqlite.prepare("UPDATE memory_live_enrollments SET project_id=?").run(f.binding.projectId);
  const enabled = await f.enable(); assert.equal(enabled.grant.projectId, f.binding.projectId);
});

const revokeBody = revision => ({ version: VERSION, revision, confirmation: "REVOKE_DOCUMENT_PALETTE_PROFILE" });
const suppressBody = (grant, overrides = {}) => ({ version: VERSION, grantId: grant.grantId, grantRevision: grant.revision,
  claimKey: "a".repeat(64), revision: 0, confirmation: "SUPPRESS_DOCUMENT_PALETTE_CLAIM", ...overrides });

test("document profile API: original actor can revoke after feature, consent and document access are lost", async t => {
  const f = fixture(t, { shared: true }), enabled = await f.enable(), g = f.grant();
  f.insert("memory_document_profile_suppressions", { grant_id: g.grant_id, grant_revision: g.revision, claim_key: "a".repeat(64),
    revision: 1, state: "active", created_at: at(-1000), expires_at: g.expires_at });
  f.env.FORMA_MEMORY_ENABLED = "false"; f.env.FORMA_MEMORY_PROFILE_ENABLED = "false";
  f.prepareResponse = Response.json({ error: "document_access_revoked" }, { status: 403 });
  f.consentResponse = Response.json({ error: "consent_revoked" }, { status: 403 }); f.calls.length = 0;
  const result = await f.call("settings", "DELETE", revokeBody(1), { grantId: enabled.grant.grantId });
  assert.equal(result.status, 200, JSON.stringify(result.value)); privateResponse(result);
  assert.deepEqual(result.value, { version: VERSION, revoked: true, grantId: g.grant_id, revision: 2, reEnrollmentRequired: true });
  const row = f.grant(); assert.equal(row.revision, 2); assert.ok(row.revoked_at);
  assert.equal(row.infer_enabled, 0); assert.equal(row.inspect_enabled, 0); assert.equal(row.background_enabled, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
  assert.equal(f.calls.some(call => ["prepare", "consent", "kernel", "parent-authority"].includes(call.kind)), false);
});

test("document profile API: stale revoke cannot erase suppression or change the active grant", async t => {
  const f = fixture(t), enabled = await f.enable(), g = f.grant();
  f.insert("memory_document_profile_suppressions", { grant_id: g.grant_id, grant_revision: g.revision, claim_key: "a".repeat(64),
    revision: 1, state: "active", created_at: at(-1000), expires_at: g.expires_at });
  const result = await f.call("settings", "DELETE", revokeBody(2), { grantId: enabled.grant.grantId });
  assert.equal(result.status, 409, JSON.stringify(result.value)); assert.equal(f.grant().revision, 1); assert.equal(f.grant().revoked_at, null);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 1);
});

test("document profile API: another authenticated actor cannot revoke a known grant ID", async t => {
  const f = fixture(t), enabled = await f.enable(); f.principal.userId = "foreign-actor";
  const result = await f.call("settings", "DELETE", revokeBody(1), { grantId: enabled.grant.grantId });
  assert.equal(result.status, 404, JSON.stringify(result.value));
  assert.equal(f.grant().revision, 1); assert.equal(f.grant().revoked_at, null);
});

test("document profile API: maximum terminal revision remains revocable and cannot reactivate", async t => {
  const f = fixture(t), enabled = await f.enable(), maximum = Number.MAX_SAFE_INTEGER;
  assert.throws(() => f.sqlite.prepare("UPDATE memory_document_profile_grants SET revision=?").run(maximum), /CHECK/u);
  f.sqlite.prepare("UPDATE memory_document_profile_grants SET revision=?").run(maximum - 1);
  let result = await f.call("settings", "DELETE", revokeBody(maximum - 1), { grantId: enabled.grant.grantId });
  assert.equal(result.status, 200, JSON.stringify(result.value)); assert.equal(result.value.revision, maximum);
  result = await f.call("settings", "DELETE", revokeBody(maximum), { grantId: enabled.grant.grantId });
  assert.equal(result.status, 200, JSON.stringify(result.value)); assert.equal(f.grant().revision, maximum);
  result = await f.call("settings", "PUT", f.body({ revision: maximum }));
  assert.equal(result.status, 409, JSON.stringify(result.value)); assert.equal(f.grant().infer_enabled, 0);
});

test("document profile API: revoke CAS and suppression deletion roll back together on statement failure", async t => {
  const f = fixture(t), enabled = await f.enable(), g = f.grant();
  f.insert("memory_document_profile_suppressions", { grant_id: g.grant_id, grant_revision: 1, claim_key: "a".repeat(64),
    revision: 1, state: "active", created_at: at(-1000), expires_at: g.expires_at });
  let injected = false;
  f.hooks.beforeStatement = statement => {
    if (/UPDATE memory_document_profile_grants SET infer_enabled=0/iu.test(statement.sql)) { injected = true; throw new Error("isolated-revoke-failure"); }
  };
  const result = await f.call("settings", "DELETE", revokeBody(1), { grantId: enabled.grant.grantId });
  denied(result); assert.equal(injected, true); assert.equal(f.grant().revoked_at, null); assert.equal(f.grant().revision, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 1);
});

test("document profile API: inspection returns only the certified bounded presentation", async t => {
  const f = fixture(t), enabled = await f.enable(); f.calls.length = 0;
  const result = await f.call("inspect", "GET", undefined, { version: VERSION, grantId: enabled.grant.grantId });
  assert.equal(result.status, 200, JSON.stringify(result.value)); privateResponse(result);
  assert.deepEqual(keys(result.value), ["profile", "version"]); assert.equal(result.value.version, VERSION);
  assert.deepEqual(model.parseMemoryDocumentProfile(result.value.profile), result.value.profile);
  assert.equal(result.value.profile.grant.id, enabled.grant.grantId);
  assert.ok(f.calls.some(call => call.kind === "prepare" && call.authority === "read"));
  assert.equal(f.calls.filter(call => call.kind === "kernel").length, 1);
  assert.ok(f.executed.filter(row => row.sql.includes("profile_api_kernel_source")).length >= 2,
    "actual retained witness reselects kernel-certified source before response");
});

test("document profile API: kernel without captured read evidence cannot produce a response", async t => {
  const f = fixture(t), enabled = await f.enable(); f.observeKernel = false;
  const result = await f.call("inspect", "GET", undefined, { version: VERSION, grantId: enabled.grant.grantId });
  denied(result); assert.equal(result.value.profile, undefined);
});

for (const [name, mutate] of [
  ["source bytes", f => f.sqlite.exec("UPDATE profile_api_kernel_source SET body='withdrawn bytes'")],
  ["source deleted", f => f.sqlite.exec("DELETE FROM profile_api_kernel_source")],
  ["source inserted", f => f.insert("profile_api_kernel_source", { id: "late", body: "late evidence" })],
  ["original authority", f => f.sqlite.exec("UPDATE profile_api_native_authority SET admitted=0")],
  ["grant revision", f => f.sqlite.exec("UPDATE memory_document_profile_grants SET revision=revision+1")],
  ["parent revision", f => f.sqlite.exec("UPDATE memory_live_enrollments SET revision=revision+1")],
  ["parent recall flag", f => f.sqlite.exec("UPDATE memory_live_enrollments SET recall_enabled=0")],
  ["profile rollout flag", f => { f.env.FORMA_MEMORY_PROFILE_ENABLED = "false"; }],
]) test("document profile API: final inspection rejects changed " + name, async t => {
  const f = fixture(t), enabled = await f.enable(); let raced = false;
  f.afterKernel = () => { raced = true; mutate(f); };
  const result = await f.call("inspect", "GET", undefined, { version: VERSION, grantId: enabled.grant.grantId });
  assert.equal(raced, true); denied(result); assert.equal(result.value.profile, undefined);
  assert.equal(JSON.stringify(result.value).includes("#123456"), false);
});

test("document profile API: original presentation deadline cannot extend across the final await", async t => {
  const f = fixture(t), enabled = await f.enable(); let now = Date.now(), delayed = false; t.mock.method(Date, "now", () => now);
  f.hooks.afterBatch = statements => {
    if (statements.some(statement => statement.sql.includes("profile_api_kernel_source"))) { delayed = true; now += 31_000; }
  };
  const result = await f.call("inspect", "GET", undefined, { version: VERSION, grantId: enabled.grant.grantId });
  assert.equal(delayed, true); denied(result); assert.equal(result.value.profile, undefined);
});

for (const [name, mutate] of [
  ["different grant", value => { value.grant.id = "different-grant"; }],
  ["different grant revision", value => { value.grant.revision += 1; }],
  ["different document", value => { value.scope.documentId = "different-document"; }],
  ["different organization", value => { value.scope.organizationId = "other-org"; value.scope.projectAccessId = "other-access"; }],
  ["inferred preference", value => { value.inferredPreferences = true; }],
  ["extra private field", value => { value.privateText = "not presentation"; }],
]) test("document profile API: inspection rejects native result with " + name, async t => {
  const f = fixture(t), enabled = await f.enable(); f.kernelValue = f.profile(enabled.grant.grantId); mutate(f.kernelValue);
  const result = await f.call("inspect", "GET", undefined, { version: VERSION, grantId: enabled.grant.grantId });
  denied(result); assert.equal(result.value.profile, undefined);
});

test("document profile API: suppression requires a currently certified claim and persists metadata only", async t => {
  const f = fixture(t), enabled = await f.enable();
  const result = await f.call("suppress", "PUT", suppressBody(enabled.grant));
  assert.equal(result.status, 200, JSON.stringify(result.value)); privateResponse(result);
  assert.equal(result.value.version, VERSION);
  assert.deepEqual(keys(result.value.suppression), ["claimKey", "createdAt", "expiresAt", "grantId", "grantRevision", "revision", "state"]);
  assert.equal(result.value.suppression.revision, 1); assert.equal(result.value.suppression.state, "active");
  const rows = f.sqlite.prepare("SELECT * FROM memory_document_profile_suppressions").all(); assert.equal(rows.length, 1);
  assert.equal(rows[0].claim_key, "a".repeat(64)); assert.equal(rows[0].grant_id, enabled.grant.grantId);
  assert.equal(rows[0].grant_revision, 1); assert.equal(rows[0].expires_at, f.grant().expires_at);
  assert.equal(JSON.stringify(rows).includes("#123456"), false); assert.equal(JSON.stringify(rows).includes("original certified palette"), false);
});

for (const [name, overrides] of [
  ["arbitrary claim", { claimKey: "b".repeat(64) }],
  ["stale grant revision", { grantRevision: 2 }],
  ["nonexistent suppression revision", { revision: 1 }],
]) test("document profile API: suppression rejects " + name, async t => {
  const f = fixture(t), enabled = await f.enable();
  const result = await f.call("suppress", "PUT", suppressBody(enabled.grant, overrides)); denied(result);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
});

for (const [name, overrides] of [
  ["arbitrary prose", { text: "remember that I prefer purple" }], ["uppercase key", { claimKey: "A".repeat(64) }],
  ["missing confirmation", { confirmation: null }], ["coerced revision", { revision: "0" }],
  ["unsupported version", { version: "future" }], ["extra custody", { expectedCustody: { kind: "personal" } }],
]) test("document profile API: strict suppression rejects " + name, async t => {
  const f = fixture(t), enabled = await f.enable();
  const result = await f.call("suppress", "PUT", suppressBody(enabled.grant, overrides)); assert.equal(result.status, 400, JSON.stringify(result.value));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
});

test("document profile API: changed certified source prevents suppression before any mutation", async t => {
  const f = fixture(t), enabled = await f.enable(); let raced = false;
  f.afterKernel = () => { raced = true; f.sqlite.exec("DELETE FROM profile_api_kernel_source"); };
  const result = await f.call("suppress", "PUT", suppressBody(enabled.grant)); assert.equal(raced, true); denied(result);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
});

test("document profile API: suppression INSERT and final authority check commit atomically", async t => {
  const f = fixture(t), enabled = await f.enable(); let raced = false;
  f.hooks.afterStatement = statement => {
    if (/INSERT INTO memory_document_profile_suppressions/iu.test(statement.sql)) {
      raced = true; f.sqlite.exec("UPDATE profile_api_native_authority SET admitted=0");
    }
  };
  const result = await f.call("suppress", "PUT", suppressBody(enabled.grant)); assert.equal(raced, true); denied(result);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT admitted FROM profile_api_native_authority").get().admitted, 1);
});

test("document profile API: missing and malformed additive schemas fail without DDL or enrollment", async t => {
  const f = fixture(t, { schema: false });
  let result = await f.call("settings", "PUT", f.body()); assert.equal(result.status, 503, JSON.stringify(result.value));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name LIKE 'memory_document_profile_%'").get().n, 0);
  f.sqlite.exec("CREATE TABLE memory_document_profile_grants(grant_id TEXT PRIMARY KEY)");
  result = await f.call("settings", "PUT", f.body()); assert.equal(result.status, 503, JSON.stringify(result.value));
  assert.equal(f.executed.some(row => /\b(CREATE|ALTER|DROP)\b/iu.test(row.sql)), false);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_live_enrollments").get().n, 1);
});

test("document profile API: valid grant-only deployment still permits owner revocation", async t => {
  const f = fixture(t), enabled = await f.enable(); f.sqlite.exec("DROP TABLE memory_document_profile_suppressions");
  const result = await f.call("settings", "DELETE", revokeBody(1), { grantId: enabled.grant.grantId });
  assert.equal(result.status, 200, JSON.stringify(result.value)); assert.equal(f.grant().revision, 2); assert.ok(f.grant().revoked_at);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='memory_document_profile_suppressions'").get().n, 0);
});

test("document profile API: revoked document access does not turn old epoch grant metadata into a current grant", async t => {
  const f = fixture(t), enabled = await f.enable();
  f.principal.access.permissionEpoch = "epoch-2"; f.binding.permissionEpoch = "epoch-2";
  f.sqlite.exec("UPDATE profile_api_native_authority SET epoch='epoch-2'");
  const result = await f.call("settings", "GET", undefined, queryFor(f));
  assert.equal(result.status, 200, JSON.stringify(result.value)); assert.equal(result.value.grant.grantId, enabled.grant.grantId);
  assert.equal(result.value.grant.infer, true, "historical metadata is not silently rewritten");
  assert.equal(result.value.grantCurrent, false); assert.equal(result.value.parent, null);
});

test("document profile API: a fresh explicit grant replaces inert old-epoch metadata only after current parent consent", async t => {
  const f = fixture(t); await f.enable(); suppressionFor(f, f.grant());
  f.principal.access.permissionEpoch = "epoch-2"; f.binding.permissionEpoch = "epoch-2";
  f.sqlite.exec("UPDATE profile_api_native_authority SET epoch='epoch-2'; UPDATE memory_live_enrollments SET permission_epoch='epoch-2'");
  f.sourceHead = 8; f.insert("events", { event_id: "fresh-epoch-source", stream_id: f.binding.streamId, sequence: 8 });
  const result = await f.call("settings", "PUT", f.body({ revision: 1 }));
  assert.equal(result.status, 200, JSON.stringify(result.value)); assert.equal(result.value.grant.revision, 2);
  assert.equal(f.grant().permission_epoch, "epoch-2"); assert.equal(f.grant().source_after_sequence, 8);
  assert.equal(f.grant().revoked_at, null); assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
});

test("document profile API: suppression retention is capped independently of a longer consent lease", async t => {
  const f = fixture(t); f.sqlite.prepare("UPDATE memory_live_enrollments SET expires_at=?").run(at(30 * 86_400_000));
  const enabled = await f.enable({ retentionDays: 1, expiresAt: at(7 * 86_400_000) });
  const result = await f.call("suppress", "PUT", suppressBody(enabled.grant)); assert.equal(result.status, 200, JSON.stringify(result.value));
  const suppression = result.value.suppression;
  assert.equal(Date.parse(suppression.expiresAt) - Date.parse(suppression.createdAt), 86_400_000);
  assert.ok(suppression.expiresAt < enabled.grant.expiresAt);
});

test("document profile API: original authentication lease cannot be renewed during native inspection", async t => {
  const f = fixture(t), enabled = await f.enable(); let now = Date.now(); t.mock.method(Date, "now", () => now);
  const original = { expiresAt: at(2_000) }; f.principal.access.grants = [original]; f.principal.authorizationSnapshot.grants = JSON.stringify([original]);
  f.afterKernel = () => {
    now += 3_000;
    const renewed = { expiresAt: at(3_600_000) }; f.principal.access.grants = [renewed]; f.principal.authorizationSnapshot.grants = JSON.stringify([renewed]);
  };
  const result = await f.call("inspect", "GET", undefined, { version: VERSION, grantId: enabled.grant.grantId });
  denied(result); assert.equal(result.value.profile, undefined);
});

test("document profile API: native preparation failures remain structured private responses", async t => {
  const f = fixture(t), enabled = await f.enable();
  f.prepareResponse = Response.json({ error: "native-document-denied" }, { status: 403, headers: { "cache-control": "public" } });
  const result = await f.call("inspect", "GET", undefined, { version: VERSION, grantId: enabled.grant.grantId });
  assert.equal(result.status, 403); assert.equal(result.value.error, "native-document-denied"); privateResponse(result);
});

test("document profile API: failed final source recheck returns no profile bytes or uncaught rejection", async t => {
  const f = fixture(t), enabled = await f.enable(); let ready = false, injected = false;
  f.afterKernel = () => { ready = true; };
  f.hooks.beforeStatement = statement => {
    if (ready && statement.sql.includes("profile_api_kernel_source")) { injected = true; throw new Error("isolated-final-read-failure"); }
  };
  const result = await f.call("inspect", "GET", undefined, { version: VERSION, grantId: enabled.grant.grantId });
  assert.equal(injected, true); denied(result); assert.equal(result.value.profile, undefined); privateResponse(result);
});

test("document profile API: a grant becoming expired during settings proof is not advertised current", async t => {
  const f = fixture(t), enabled = await f.enable({ expiresAt: at(5_000) }); let now = Date.now(), raced = false;
  t.mock.method(Date, "now", () => now);
  f.hooks.afterBatch = statements => {
    if (statements.some(statement => statement.sql.includes("profile_api_native_authority"))) { raced = true; now += 6_000; }
  };
  const result = await f.call("settings", "GET", undefined, queryFor(f)); assert.equal(raced, true);
  assert.notEqual(result.status === 200 && result.value.grantCurrent, true);
  assert.equal(f.grant().grant_id, enabled.grant.grantId);
});

test("document profile API: parent eligibility expires during final settings proof even without a purpose grant", async t => {
  const f = fixture(t); f.sqlite.prepare("UPDATE memory_live_enrollments SET expires_at=?").run(at(5_000));
  let now = Date.now(), raced = false; t.mock.method(Date, "now", () => now);
  f.hooks.afterBatch = statements => {
    if (statements.some(statement => statement.sql.includes("profile_api_native_authority"))) { raced = true; now += 6_000; }
  };
  const result = await f.call("settings", "GET", undefined, queryFor(f)); assert.equal(raced, true);
  assert.notEqual(result.status === 200 && result.value.parent !== null, true); noGrantWrites(f);
});

for (const initiallyEnabled of [true, false]) test("document profile API: settings enabled snapshot cannot flip during final await from " + initiallyEnabled, async t => {
  const f = fixture(t); f.env.FORMA_MEMORY_PROFILE_ENABLED = String(initiallyEnabled); let raced = false;
  f.hooks.afterBatch = statements => {
    if (statements.some(statement => statement.sql.includes("profile_api_native_authority"))) {
      raced = true; f.env.FORMA_MEMORY_PROFILE_ENABLED = String(!initiallyEnabled);
    }
  };
  const result = await f.call("settings", "GET", undefined, queryFor(f)); assert.equal(raced, true); denied(result); noGrantWrites(f);
});

test("document profile API: delayed enable acknowledgement never reports stale success or invents rollback", async t => {
  const f = fixture(t); let now = Date.now(), delayed = false; t.mock.method(Date, "now", () => now);
  f.hooks.afterBatch = statements => {
    if (statements.some(statement => /INSERT INTO memory_document_profile_grants/iu.test(statement.sql))) { delayed = true; now += 60_001; }
  };
  const result = await f.call("settings", "PUT", f.body()); assert.equal(delayed, true); assert.equal(result.status, 503, JSON.stringify(result.value));
  assert.equal(result.value.error, "document_profile_commit_delivery_unconfirmed");
  assert.equal(f.grant().revision, 1, "transaction committed before its delayed acknowledgement");
  f.hooks.afterBatch = null;
  const recovered = await f.call("settings", "GET", undefined, queryFor(f));
  assert.equal(recovered.status, 200, JSON.stringify(recovered.value)); assert.equal(recovered.value.grant.revision, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_grants").get().n, 1);
});

test("document profile API: postcommit feature withdrawal denies suppression acknowledgement but preserves committed CAS", async t => {
  const f = fixture(t), enabled = await f.enable(); let delayed = false;
  f.hooks.afterBatch = statements => {
    if (statements.some(statement => /INSERT INTO memory_document_profile_suppressions/iu.test(statement.sql))) {
      delayed = true; f.env.FORMA_MEMORY_PROFILE_ENABLED = "false";
    }
  };
  const result = await f.call("suppress", "PUT", suppressBody(enabled.grant)); assert.equal(delayed, true); assert.equal(result.status, 503, JSON.stringify(result.value));
  assert.equal(result.value.error, "document_profile_commit_delivery_unconfirmed");
  assert.equal(f.sqlite.prepare("SELECT revision FROM memory_document_profile_suppressions").get().revision, 1);
});

test("document profile API: delayed revoke acknowledgement preserves the committed terminal action", async t => {
  const f = fixture(t), enabled = await f.enable(); let now = Date.now(), delayed = false; t.mock.method(Date, "now", () => now);
  f.hooks.afterBatch = statements => {
    if (statements.some(statement => /UPDATE memory_document_profile_grants SET infer_enabled=0/iu.test(statement.sql))) {
      delayed = true; now += 60_001;
    }
  };
  const result = await f.call("settings", "DELETE", revokeBody(1), { grantId: enabled.grant.grantId });
  assert.equal(delayed, true); assert.equal(result.status, 503, JSON.stringify(result.value));
  assert.equal(result.value.error, "document_profile_commit_delivery_unconfirmed");
  assert.equal(f.grant().revision, 2); assert.ok(f.grant().revoked_at);
});

for (const returned of ["empty", "truncated", "unverified", "null", "object", "coerced-success"]) test("document profile API: incomplete mutation batch response is never acknowledged " + returned, async t => {
  const f = fixture(t); let injected = false;
  f.hooks.afterBatch = (statements, results) => {
    if (statements.some(statement => /INSERT INTO memory_document_profile_grants/iu.test(statement.sql))) {
      injected = true;
      if (returned === "null") return null;
      if (returned === "object") return {};
      if (returned === "empty") results.length = 0;
      else if (returned === "truncated") results.pop();
      else if (returned === "coerced-success") results.at(-1).success = "true";
      else results.at(-1).results[0].verified = 0;
    }
  };
  const result = await f.call("settings", "PUT", f.body()); assert.equal(injected, true); assert.equal(result.status, 503, JSON.stringify(result.value));
  assert.equal(result.value.error, "document_profile_commit_delivery_unconfirmed");
  assert.equal(f.grant().revision, 1, "simulated lost acknowledgement is not an assertion that committed data rolled back");
});

function liveTables(f, sources = 2) {
  f.sqlite.exec(`CREATE TABLE memory_live_sources(enrollment_id TEXT,event_id TEXT,sequence INTEGER,expires_at TEXT,conversation_segmented INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE memory_live_runs(run_id TEXT PRIMARY KEY);
    CREATE TABLE memory_live_conversation_segments(enrollment_id TEXT,enrollment_revision INTEGER,recipe_version TEXT,first_sequence INTEGER,
      last_sequence INTEGER,member_count INTEGER,members_json TEXT,created_at TEXT,expires_at TEXT);
    ALTER TABLE events ADD COLUMN recorded_at TEXT;`);
  f.sqlite.prepare("UPDATE events SET recorded_at=?").run(at(-1_000));
  for (let index = 0; index < sources; index++) f.insert("memory_live_sources", { enrollment_id: f.parent.enrollment_id,
    event_id: "live-source-" + index, sequence: index + 1, expires_at: at(3_600_000), conversation_segmented: 0 });
}
function suppressionFor(f, grant, suffix = "a") {
  f.insert("memory_document_profile_suppressions", { grant_id: grant.grant_id, grant_revision: grant.revision,
    claim_key: suffix.repeat(64), revision: 1, state: "active", created_at: at(-1000), expires_at: grant.expires_at });
}
function cloneGrant(f, original, suffix, override = {}) {
  const grant = { ...original, grant_id: "isolated-grant-" + suffix, ...override }; f.insert("memory_document_profile_grants", grant); return grant;
}

test("document profile API: real privacy callback personalOnly retires only the actor personal profile", async t => {
  const f = fixture(t); await f.enable(); liveTables(f); const personal = f.grant();
  const shared = cloneGrant(f, personal, "shared", { organization_id: "org-a", project_access_id: "access-a", owner_user_id: "org-owner" });
  const foreign = cloneGrant(f, personal, "foreign", { actor_user_id: "other-actor", owner_user_id: "other-actor" });
  for (const grant of [personal, shared, foreign]) suppressionFor(f, grant);
  f.env.FORMA_MEMORY_ENABLED = "false";
  await f.DB.batch(await liveStore.liveMemoryErasureStatements(f.env, { actorUserId: f.principal.userId, personalOnly: true }, at(0)));
  const rows = f.sqlite.prepare("SELECT grant_id,revoked_at,revision FROM memory_document_profile_grants ORDER BY grant_id").all();
  assert.ok(rows.find(row => row.grant_id === personal.grant_id).revoked_at);
  for (const grant of [shared, foreign]) assert.equal(rows.find(row => row.grant_id === grant.grant_id).revoked_at, null);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 2);
  assert.equal(f.sqlite.prepare("SELECT learn_enabled FROM memory_live_enrollments").get().learn_enabled, 0);
});

test("document profile API: real organization privacy callback isolates other organizations and personal scope", async t => {
  const f = fixture(t, { shared: true }); await f.enable(); liveTables(f); const target = f.grant();
  const other = cloneGrant(f, target, "other-org", { organization_id: "other-org", project_access_id: "other-access" });
  const personal = cloneGrant(f, target, "personal", { organization_id: null, project_access_id: null, owner_user_id: f.principal.userId });
  for (const grant of [target, other, personal]) suppressionFor(f, grant);
  await f.DB.batch(await liveStore.liveMemoryErasureStatements(f.env, { organizationId: target.organization_id }, at(0)));
  assert.ok(f.grant().revoked_at);
  for (const grant of [other, personal]) assert.equal(f.sqlite.prepare("SELECT revoked_at FROM memory_document_profile_grants WHERE grant_id=?").get(grant.grant_id).revoked_at, null);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 2);
});

test("document profile API: real privacy callback handles profile-only storage with no parent tables", async t => {
  const f = fixture(t); await f.enable(); const grant = f.grant(); suppressionFor(f, grant);
  f.sqlite.exec("DROP TABLE memory_live_enrollments");
  const writes = await liveStore.liveMemoryErasureStatements(f.env, { actorUserId: f.principal.userId }, at(0));
  assert.ok(writes.length >= 2); await f.DB.batch(writes);
  assert.ok(f.grant().revoked_at); assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
  assert.equal(f.executed.some(row => /\b(CREATE|ALTER|DROP)\b/iu.test(row.sql)), false);
});

test("document profile API: real counted parent revocation returns source deletion count after profile cleanup", async t => {
  const f = fixture(t); await f.enable(); liveTables(f, 3); suppressionFor(f, f.grant());
  const result = await liveStore.revokeLiveMemoryCounted(f.env, { ...f.parent }, "forgotten");
  assert.deepEqual(result, { revoked: true, erased: 3 }); assert.ok(f.grant().revoked_at);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT revision FROM memory_live_enrollments").get().revision, 2);
  assert.deepEqual(await liveStore.revokeLiveMemoryCounted(f.env, { ...f.parent }, "forgotten"), { revoked: false, erased: 0 });
});

test("document profile API: stale counted parent revocation cannot affect a new profile enrollment revision", async t => {
  const f = fixture(t); await f.enable(); liveTables(f);
  f.sqlite.exec("UPDATE memory_live_enrollments SET revision=2; UPDATE memory_document_profile_grants SET enrollment_revision=2");
  suppressionFor(f, f.grant());
  assert.deepEqual(await liveStore.revokeLiveMemoryCounted(f.env, { ...f.parent }, "forgotten"), { revoked: false, erased: 0 });
  assert.equal(f.grant().revoked_at, null); assert.equal(f.grant().enrollment_revision, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 1);
});

for (const variant of ["malformed", "orphan"]) test("document profile API: real privacy callback fails closed for " + variant + " profile metadata", async t => {
  const f = fixture(t); await f.enable(); liveTables(f); suppressionFor(f, f.grant());
  if (variant === "malformed") f.sqlite.exec("ALTER TABLE memory_document_profile_suppressions ADD COLUMN unexpected TEXT");
  else f.sqlite.exec("DROP TABLE memory_document_profile_grants");
  await assert.rejects(liveStore.liveMemoryErasureStatements(f.env, { actorUserId: f.principal.userId }, at(0)), /document_profile_/u);
  assert.equal(f.sqlite.prepare("SELECT revision FROM memory_live_enrollments").get().revision, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_live_sources").get().n, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 1);
});

test("document profile API: parent settings callback withdraws old profile purpose without auto-reenrolling", async t => {
  const f = fixture(t); liveTables(f, 0);
  const enrollmentId = createHash("sha256").update(JSON.stringify([f.principal.userId, "", "", f.binding.projectId, f.binding.documentId])).digest("hex");
  f.sqlite.prepare("UPDATE memory_live_enrollments SET enrollment_id=?").run(enrollmentId); f.parent.enrollment_id = enrollmentId;
  await f.enable(); suppressionFor(f, f.grant());
  const body = { projectId: f.binding.projectId, documentId: f.binding.documentId, policyVersion: "personal-memory-v2",
    learn: true, recall: true, background: false, retentionDays: 7, timeZone: "UTC", expiresAt: at(3_600_000), revision: 1,
    confirmation: "ENABLE_PERSONAL_MEMORY", expectedCustody: { kind: "personal" } };
  const request = new Request("https://forma.example.invalid/api/memory/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  seam.current = f; const response = await liveApi.handleLiveMemory(request, f.env, "settings"), result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.enrollment.revision, 2);
  assert.ok(f.grant().revoked_at); assert.equal(f.grant().enrollment_revision, 1); assert.equal(f.grant().infer_enabled, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
});

test("document profile API: parent forget callback withdraws profile and leaves a revision tombstone", async t => {
  const f = fixture(t); await f.enable(); liveTables(f); suppressionFor(f, f.grant());
  const url = new URL("https://forma.example.invalid/api/memory/settings"); url.searchParams.set("id", f.parent.enrollment_id);
  const request = new Request(url, { method: "DELETE", headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, confirmation: "FORGET_MY_MEMORY" }) });
  seam.current = f; const response = await liveApi.handleLiveMemory(request, f.env, "settings"), result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.erased, true);
  assert.ok(f.grant().revoked_at); assert.equal(f.grant().revision, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
});

function seedSuppressionCapacity(f, grant, count) {
  for (let index = 0; index < count; index++) f.insert("memory_document_profile_suppressions", {
    grant_id: grant.grant_id, grant_revision: grant.revision, claim_key: index.toString(16).padStart(64, "0"), revision: 1,
    state: "active", created_at: grant.consented_at, expires_at: grant.expires_at,
  });
}

test("document profile API: suppression capacity cannot grow beyond the kernel inspection bound", async t => {
  const f = fixture(t), enabled = await f.enable(); seedSuppressionCapacity(f, f.grant(), 128);
  const result = await f.call("suppress", "PUT", suppressBody(enabled.grant)); assert.equal(result.status, 503, JSON.stringify(result.value));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 128);
  const inspect = await f.call("inspect", "GET", undefined, { version: VERSION, grantId: enabled.grant.grantId });
  assert.equal(inspect.status, 200, JSON.stringify(inspect.value)); assert.equal(inspect.value.profile.grant.revision, 1);
});

test("document profile API: expired existing claim suppression can refresh at the bounded capacity", async t => {
  const f = fixture(t), enabled = await f.enable();
  f.sqlite.prepare("UPDATE memory_document_profile_grants SET consented_at=?").run(at(-20_000)); seedSuppressionCapacity(f, f.grant(), 127);
  f.insert("memory_document_profile_suppressions", { grant_id: enabled.grant.grantId, grant_revision: 1, claim_key: "a".repeat(64),
    revision: 1, state: "active", created_at: at(-10_000), expires_at: at(-5_000) });
  const result = await f.call("suppress", "PUT", suppressBody(enabled.grant, { revision: 1 }));
  assert.equal(result.status, 200, JSON.stringify(result.value)); assert.equal(result.value.suppression.revision, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 128);
});

function seedRawGrant(f) {
  const grant = { grant_id: "late-created-profile", actor_user_id: f.principal.userId,
    owner_user_id: f.scope?.ownerUserId ?? f.principal.userId, organization_id: f.scope?.organizationId ?? null,
    project_access_id: f.scope?.projectAccessId ?? null, project_id: f.binding.projectId, document_id: f.binding.documentId,
    permission_epoch: f.principal.access.permissionEpoch, policy_version: POLICY, recipe_version: RECIPE,
    revision: 1, enrollment_id: f.parent.enrollment_id, enrollment_revision: 1, infer_enabled: 1, inspect_enabled: 1,
    background_enabled: 0, source_after_sequence: 7, consented_at: at(-1000), expires_at: at(3_600_000), retention_days: 7, revoked_at: null };
  f.insert("memory_document_profile_grants", grant); return grant;
}

test("document profile API: real privacy callback cannot silently omit newly installed profile storage", async t => {
  const f = fixture(t, { schema: false }); liveTables(f);
  const writes = await liveStore.liveMemoryErasureStatements(f.env, { actorUserId: f.principal.userId }, at(0));
  f.sqlite.exec(readFileSync(new URL("../drizzle/0028_memory_document_profile.sql", import.meta.url), "utf8"));
  suppressionFor(f, seedRawGrant(f));
  await assert.rejects(f.DB.batch(writes), /malformed JSON|document_profile/u);
  assert.equal(f.grant().revoked_at, null); assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT revision FROM memory_live_enrollments").get().revision, 1);
});

test("document profile API: real grant-only privacy callback rejects a late suppression table", async t => {
  const f = fixture(t); await f.enable(); liveTables(f); const grant = f.grant();
  f.sqlite.exec("DROP TABLE memory_document_profile_suppressions");
  const writes = await liveStore.liveMemoryErasureStatements(f.env, { actorUserId: f.principal.userId }, at(0));
  const schema = readFileSync(new URL("../drizzle/0028_memory_document_profile.sql", import.meta.url), "utf8");
  f.sqlite.exec(schema.match(/CREATE TABLE `memory_document_profile_suppressions` \([\s\S]*?\n\);/u)[0]); suppressionFor(f, grant);
  await assert.rejects(f.DB.batch(writes), /malformed JSON|document_profile/u);
  assert.equal(f.grant().revoked_at, null); assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT revision FROM memory_live_enrollments").get().revision, 1);
});

for (const operation of ["DELETE", "UPDATE"]) test("document profile API: real scope erasure rejects an ignored " + operation + " without partial erasure", async t => {
  const f = fixture(t); await f.enable(); liveTables(f); suppressionFor(f, f.grant());
  const table = operation === "DELETE" ? "memory_document_profile_suppressions" : "memory_document_profile_grants";
  f.sqlite.exec(`CREATE TRIGGER ignore_profile_erasure BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(IGNORE); END`);
  await assert.rejects(async () => f.DB.batch(await liveStore.liveMemoryErasureStatements(f.env, { actorUserId: f.principal.userId }, at(0))), /malformed JSON|document_profile/u);
  assert.equal(f.grant().revoked_at, null); assert.equal(f.grant().revision, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT revision FROM memory_live_enrollments").get().revision, 1);
});

test("document profile API: scoped forgetting normalizes future expiry on an already revoked grant without revising its tombstone", async t => {
  const f = fixture(t); await f.enable(); liveTables(f); suppressionFor(f, f.grant());
  const revokedAt = at(0);
  f.sqlite.prepare("UPDATE memory_document_profile_grants SET revision=2,infer_enabled=0,inspect_enabled=0,background_enabled=0,revoked_at=?").run(revokedAt);
  const now = at(0);
  await f.DB.batch(await liveStore.liveMemoryErasureStatements(f.env, { actorUserId: f.principal.userId }, now));
  const grant = f.grant(); assert.equal(grant.revision, 2); assert.equal(grant.revoked_at, revokedAt); assert.ok(grant.expires_at <= now);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
});

test("document profile API: valid expired suppression history beyond 128 neither blocks inspection nor new suppression", async t => {
  const f = fixture(t), enabled = await f.enable();
  f.sqlite.prepare("UPDATE memory_document_profile_grants SET consented_at=?").run(at(-20_000));
  for (let index = 0; index < 160; index++) f.insert("memory_document_profile_suppressions", {
    grant_id: enabled.grant.grantId, grant_revision: 1, claim_key: index.toString(16).padStart(64, "0"), revision: 1,
    state: "active", created_at: at(-10_000), expires_at: at(-5_000),
  });
  const inspect = await f.call("inspect", "GET", undefined, { version: VERSION, grantId: enabled.grant.grantId });
  assert.equal(inspect.status, 200, JSON.stringify(inspect.value));
  const result = await f.call("suppress", "PUT", suppressBody(enabled.grant)); assert.equal(result.status, 200, JSON.stringify(result.value));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 161);
  const query = kernel.nativeDocumentProfileSuppressionsQuery(f.grant());
  assert.equal(f.sqlite.prepare(query.sql).all(...query.bindings).length, 1);
});

function expiredSuppression(f, grantId, claimKey, overrides = {}) {
  f.insert("memory_document_profile_suppressions", { grant_id: grantId, grant_revision: 1, claim_key: claimKey, revision: 1,
    state: "active", created_at: at(-20_000), expires_at: at(-10_000), ...overrides });
}

test("document profile API: physical expiry sweep makes bounded progress with memory disabled and preserves a fresh current row", async t => {
  const f = fixture(t); await f.enable(); const grant = f.grant();
  for (let index = 0; index < 300; index++) expiredSuppression(f, grant.grant_id, index.toString(16).padStart(64, "0"));
  suppressionFor(f, grant, "f"); f.env.FORMA_MEMORY_ENABLED = "false"; f.env.FORMA_MEMORY_PROFILE_ENABLED = "false";
  const first = await store.sweepExpiredDocumentProfileSuppressions(f.env); assert.deepEqual(first, { deleted: 128, pending: true });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 173);
  const second = await store.sweepExpiredDocumentProfileSuppressions(f.env, 256); assert.deepEqual(second, { deleted: 172, pending: false });
  const remaining = f.sqlite.prepare("SELECT claim_key FROM memory_document_profile_suppressions").all();
  assert.deepEqual(remaining.map(row => row.claim_key), ["f".repeat(64)]); assert.equal(f.grant().revoked_at, null);
  assert.deepEqual(await store.sweepExpiredDocumentProfileSuppressions(f.env), { deleted: 0, pending: false });
});

for (const [name, change] of [
  ["missing grant", (f, grant) => f.sqlite.prepare("DELETE FROM memory_document_profile_grants WHERE grant_id=?").run(grant.grant_id)],
  ["old grant revision", f => f.sqlite.exec("UPDATE memory_document_profile_grants SET revision=2")],
  ["disabled inference", f => f.sqlite.exec("UPDATE memory_document_profile_grants SET infer_enabled=0")],
  ["disabled inspection", f => f.sqlite.exec("UPDATE memory_document_profile_grants SET inspect_enabled=0")],
  ["unsupported background", f => f.sqlite.exec("UPDATE memory_document_profile_grants SET background_enabled=1")],
  ["revoked suppression", f => f.sqlite.exec("UPDATE memory_document_profile_suppressions SET state='revoked'")],
  ["expired grant", f => f.sqlite.prepare("UPDATE memory_document_profile_grants SET consented_at=?,expires_at=?").run(at(-20_000), at(-10_000))],
  ["retention age", f => {
    f.sqlite.prepare("UPDATE memory_document_profile_grants SET consented_at=?,retention_days=1").run(at(-3 * 86_400_000));
    f.sqlite.prepare("UPDATE memory_document_profile_suppressions SET created_at=?").run(at(-2 * 86_400_000));
  }],
]) test("document profile API: physical sweep removes abandoned metadata for " + name, async t => {
  const f = fixture(t); await f.enable(); const grant = f.grant(); suppressionFor(f, grant); change(f, grant);
  assert.deepEqual(await store.sweepExpiredDocumentProfileSuppressions(f.env), { deleted: 1, pending: false });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0);
});

test("document profile API: suppression-only expiry sweep removes expired rows without inventing unknown grant eligibility", async t => {
  const f = fixture(t); await f.enable(); const grant = f.grant();
  expiredSuppression(f, grant.grant_id, "a".repeat(64)); suppressionFor(f, grant, "b");
  f.sqlite.exec("DROP TABLE memory_document_profile_grants");
  assert.deepEqual(await store.sweepExpiredDocumentProfileSuppressions(f.env), { deleted: 1, pending: false });
  assert.deepEqual(f.sqlite.prepare("SELECT claim_key FROM memory_document_profile_suppressions").all().map(row => row.claim_key), ["b".repeat(64)]);
});

test("document profile API: physical sweep cannot silently skip a selected DELETE", async t => {
  const f = fixture(t); await f.enable(); expiredSuppression(f, f.grant().grant_id, "a".repeat(64));
  f.sqlite.exec("CREATE TRIGGER ignore_sweep BEFORE DELETE ON memory_document_profile_suppressions BEGIN SELECT RAISE(IGNORE); END");
  await assert.rejects(store.sweepExpiredDocumentProfileSuppressions(f.env), /malformed JSON|document_profile/u);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 1);
});

test("document profile API: physical sweep rejects malformed selected metadata before any deletion", async t => {
  const f = fixture(t); await f.enable();
  expiredSuppression(f, "missing-grant", "a".repeat(64), { created_at: "0000-malformed", expires_at: "2000-malformed" });
  await assert.rejects(store.sweepExpiredDocumentProfileSuppressions(f.env), /document_profile_sweep_invalid/u);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 1);
});

test("document profile API: physical sweep binds the captured grant and source before its deletion batch", async t => {
  const f = fixture(t); await f.enable(); expiredSuppression(f, f.grant().grant_id, "a".repeat(64)); let raced = false;
  f.hooks.beforeBatch = statements => {
    if (!raced && statements.some(statement => /^DELETE FROM memory_document_profile_suppressions WHERE \(grant_id/u.test(statement.sql))) {
      raced = true; f.sqlite.exec("UPDATE memory_document_profile_grants SET revision=2");
    }
  };
  await assert.rejects(store.sweepExpiredDocumentProfileSuppressions(f.env), /malformed JSON|document_profile/u);
  assert.equal(raced, true); assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 1);
});

test("document profile API: physical sweep rejects optional schema drift before mutation", async t => {
  const f = fixture(t); await f.enable(); expiredSuppression(f, f.grant().grant_id, "a".repeat(64)); let raced = false;
  f.hooks.beforeBatch = statements => {
    if (!raced && statements.some(statement => /^DELETE FROM memory_document_profile_suppressions WHERE \(grant_id/u.test(statement.sql))) {
      raced = true; f.sqlite.exec("ALTER TABLE memory_document_profile_grants ADD COLUMN unsupported TEXT");
    }
  };
  await assert.rejects(store.sweepExpiredDocumentProfileSuppressions(f.env), /malformed JSON|document_profile/u);
  assert.equal(raced, true); assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 1);
});

test("document profile API: invalid physical sweep limits are rejected before database access", async t => {
  const f = fixture(t); f.executed.length = 0;
  for (const maximum of [0, -1, 257, 1.5, "128", null]) await assert.rejects(store.sweepExpiredDocumentProfileSuppressions(f.env, maximum), /document_profile_sweep_invalid/u);
  assert.equal(f.executed.length, 0);
});

for (const kind of ["coerced deleted count", "unverified terminal proof", "invalid pending row"])
  test("document profile API: physical sweep does not confirm " + kind, async t => {
    const f = fixture(t); await f.enable(); expiredSuppression(f, f.grant().grant_id, "a".repeat(64)); let injected = false;
    f.hooks.afterBatch = (statements, results) => {
      if (kind === "invalid pending row" && statements.some(statement => /SELECT 1 AS pending/u.test(statement.sql))) {
        injected = true; results[1].results = [{ pending: 2 }];
      } else if (kind !== "invalid pending row" && statements.some(statement => /^DELETE FROM memory_document_profile_suppressions WHERE \(grant_id/u.test(statement.sql))) {
        injected = true;
        if (kind === "coerced deleted count") results[2].meta.changes = "1";
        else results.at(-1).results[0].verified = "1";
      }
    };
    await assert.rejects(store.sweepExpiredDocumentProfileSuppressions(f.env), /document_profile_sweep_unconfirmed/u);
    assert.equal(injected, true);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_document_profile_suppressions").get().n, 0,
      "malformed response after commit is not an assertion that deletion rolled back");
  });
