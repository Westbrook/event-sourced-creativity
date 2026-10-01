import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";

// Ordinary isolated SQLite integration. Native principal/document admission,
// source custody, retention, source selection, bridge SQL and final read witness
// are real modules. Only synthetic persisted records are seeded; this does not
// execute an /api/events producer, Worker/index, provider or hosted database.
const root = new URL("../", import.meta.url).href;
const resolution = registerHooks({ resolve(specifier, context, nextResolve) {
  const local = typeof context.parentURL === "string" && context.parentURL.startsWith(root)
    && !context.parentURL.includes("/node_modules/");
  return nextResolve(local && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const [{ ensureSchema }, { POLICY_VERSION }, { prepareDocumentAuthority }, { recallLiveMemoryResponse },
  { publicEventPayload }] = await Promise.all([
  import("../worker/runtime.ts"), import("../worker/pilot-policy.ts"),
  import("../worker/context-authoring-authority.ts"), import("../worker/memory-live-recall.ts"),
  import("../worker/event-privacy.ts"),
]);
const originalFetch = globalThis.fetch;
let outbound = 0;
before(() => { globalThis.fetch = async () => { outbound++; throw new Error("consumption_reader_outbound_forbidden"); }; });
after(() => { globalThis.fetch = originalFetch; resolution.deregister(); assert.equal(outbound, 0); });

const at = offset => new Date(Date.now() + offset).toISOString();
const copy = value => JSON.parse(JSON.stringify(value));
const snapshotSql = "SELECT * FROM memory_live_enrollments WHERE enrollment_id=? AND actor_user_id=? AND revision=?";
const isBridge = statement => statement.sql.startsWith("WITH binding AS")
  && statement.sql.includes("payload_json") && statement.sql.includes("event.type='DocumentViewVisited'");

async function fixture(t, { shared = false, visits = 1, remember = true } = {}) {
  const sqlite = new DatabaseSync(":memory:"); let verifyCleanup = () => {};
  t.after(() => { try { verifyCleanup(); } finally { sqlite.close(); } });
  const trace = [], hooks = { beforeBatch: null, afterBatch: null, beforeStatement: null, afterStatement: null };
  let recording = false, inBatch = false;
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = [...values]; }
    bind(...values) { assert.ok(values.length <= 100, "existing D1 binding allowance"); return new Statement(this.sql, values); }
    async execute(kind) {
      if (recording) {
        assert.ok(this.sql.length <= 100_000, "bounded SQL text");
        trace.push({ sql: this.sql, values: [...this.values], kind, inBatch });
      }
      if (hooks.beforeStatement) await hooks.beforeStatement(this, kind);
      const statement = sqlite.prepare(this.sql);
      const value = kind === "first" ? statement.get(...this.values) ?? null
        : kind === "all" ? { results: statement.all(...this.values), success: true, meta: { changes: 0 } }
          : { results: [], success: true, meta: { changes: Number(statement.run(...this.values).changes) } };
      if (hooks.afterStatement) await hooks.afterStatement(this, kind, value);
      return value;
    }
    async first() { return this.execute("first"); }
    async all() { return this.execute("all"); }
    async run() { return this.execute("run"); }
  }
  const DB = {
    prepare: sql => new Statement(sql),
    async batch(statements) {
      if (hooks.beforeBatch) await hooks.beforeBatch(statements);
      sqlite.exec("BEGIN"); inBatch = true;
      let results;
      try {
        results = [];
        for (const statement of statements) results.push(await statement.execute(/^\s*(?:SELECT|WITH|PRAGMA)/iu.test(statement.sql) ? "all" : "run"));
        sqlite.exec("COMMIT");
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      finally { inBatch = false; }
      if (hooks.afterBatch) await hooks.afterBatch(statements, results);
      return results;
    },
  };
  const env = { DB, ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, MEDIA: {},
    FORMA_MEMORY_ENABLED: "true", FORMA_MEMORY_USER_IDS: "consumption-actor" };
  await ensureSchema(env);
  for (const name of ["./fixtures/local-migrations/0020_assistant_runtime_tables.sql", "./fixtures/local-migrations/0021_assistant_specialist_consent.sql",
    "../drizzle/0025_memory_live_base.sql", "../drizzle/0026_memory_live_conversation.sql"])
    sqlite.exec(readFileSync(new URL(name, import.meta.url), "utf8"));
  const insert = (table, row) => sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  const actorId = "consumption-actor", ownerId = shared ? "consumption-owner" : actorId;
  const projectId = "consumption-project", documentId = "consumption-document", stream = "creative:" + ownerId;
  const organizationId = "consumption-organization", projectAccessId = "consumption-access";
  const createdAt = at(-60_000), expiresAt = at(3_600_000);
  for (const userId of new Set([actorId, ownerId])) insert("users", {
    user_id: userId, email: `${userId}@example.test`, display_name: userId, role: "creator",
    consent_version: POLICY_VERSION, consented_at: createdAt, created_at: createdAt, updated_at: createdAt,
  });
  if (shared) {
    insert("organizations", { organization_id: organizationId, name: "Synthetic consumption organization", owner_user_id: ownerId,
      status: "active", created_at: createdAt, updated_at: createdAt });
    for (const userId of [ownerId, actorId]) insert("organization_memberships", {
      membership_id: "org-member-" + userId, organization_id: organizationId, user_id: userId,
      role: userId === ownerId ? "owner" : "member", status: "active", invited_by_user_id: ownerId,
      accepted_at: createdAt, created_at: createdAt, updated_at: createdAt, revoked_at: null,
    });
    insert("organization_projects", { project_access_id: projectAccessId, project_id: projectId, organization_id: organizationId,
      owner_user_id: ownerId, status: "active", created_at: createdAt, updated_at: createdAt });
    insert("project_memberships", { membership_id: "consumption-project-member", project_access_id: projectAccessId,
      project_id: projectId, organization_id: organizationId, user_id: actorId, role: "viewer", status: "active",
      granted_by_user_id: ownerId, created_at: createdAt, updated_at: createdAt, revoked_at: null });
    insert("project_migration_states", { project_access_id: projectAccessId, organization_id: organizationId,
      owner_user_id: ownerId, status: "active", last_owner_sequence: 0, updated_at: createdAt });
    insert("project_context_sessions", { context_id: "consumption-context", principal_user_id: actorId,
      organization_id: organizationId, project_access_id: projectAccessId, created_at: createdAt,
      expires_at: expiresAt, revoked_at: null });
  }
  let sequence = 0;
  function append(type, payload, { eventId = "consumption-event-" + (sequence + 1), actor = "user:" + actorId,
    recordedAt = at(-10_000 + sequence), compensates = null, custody = shared, privatePayload = false,
    rawPublic = null, ownerStream = stream, correlationId = eventId, causationId = null, beforeInsert = null } = {}) {
    const envelope = privatePayload ? publicEventPayload(eventId, payload) : null;
    const row = { event_id: eventId, stream_id: ownerStream, sequence: ++sequence,
      occurred_at: recordedAt, recorded_at: recordedAt, actor, client_id: "consumption-reader-fixture",
      correlation_id: correlationId, causation_id: causationId, compensates_event_id: compensates, schema_version: 1,
      type, payload: rawPublic ?? JSON.stringify(envelope?.payload ?? payload) };
    // Negative persisted-history fixtures may alter a draft, or omit one event,
    // before its only INSERT. Never bypass the real append-only event triggers.
    if (beforeInsert?.(row) !== false) insert("events", row);
    if (envelope?.privateJson) insert("event_private_payloads", {
      private_event_id: eventId, owner_id: ownerId, project_id: projectId, document_id: documentId,
      private_json: envelope.privateJson, created_at: recordedAt, redacted_at: null,
    });
    if (custody) insert("project_event_scopes", { event_id: eventId, project_access_id: projectAccessId,
      organization_id: organizationId, project_id: projectId, owner_user_id: ownerId,
      source_stream_id: ownerStream, source_sequence: row.sequence, project_sequence: row.sequence,
      actor_user_id: actor.replace(/^user:/u, ""), created_at: recordedAt });
    if (shared) sqlite.prepare("UPDATE project_migration_states SET last_owner_sequence=?").run(sequence);
    return row;
  }
  append("ProjectCreated", { project_id: projectId, name: "Synthetic consumption project" }, { actor: "user:" + ownerId });
  const document = append("DocumentCreated", { project_id: projectId, document_id: documentId, title: "Synthetic consumption document" }, { actor: "user:" + ownerId });
  if (shared) insert("project_resource_scopes", { project_access_id: projectAccessId, resource_kind: "document",
    resource_id: documentId, organization_id: organizationId, project_id: projectId, owner_user_id: ownerId,
    visibility: "collaborative_output", source_event_id: document.event_id, actor_user_id: ownerId, created_at: document.recorded_at });
  const visit = (options = {}) => append("DocumentViewVisited", {
    document_id: documentId, project_id: projectId, view: "document", focused: true,
    route_family: "document", source_surface: "document-view-navigation", ...options.payload,
  }, { privatePayload: true, ...options });
  const navigation = Array.from({ length: visits }, () => visit());
  const headers = { "oai-authenticated-user-id": actorId, "oai-authenticated-user-email": `${actorId}@example.test`,
    "oai-authenticated-user-name": actorId, ...(shared ? { cookie: "forma_project_context=consumption-context" } : {}) };
  const prepare = () => prepareDocumentAuthority(new Request("http://localhost/api/context/read", { headers }), env,
    { projectId, documentId }, "read");
  const prepared = await prepare();
  assert.ok(!(prepared instanceof Response), prepared instanceof Response ? await prepared.text() : "real preparation required");
  assert.equal(prepared.principal.userId, actorId);
  assert.equal(prepared.binding.scope?.ownerUserId ?? actorId, ownerId);
  assert.equal(Boolean(prepared.binding.scope), shared);
  assert.ok(prepared.principal.authorizationSnapshot);
  const enrollment = { enrollment_id: "consumption-enrollment", actor_user_id: actorId, owner_user_id: ownerId,
    organization_id: shared ? organizationId : null, project_access_id: shared ? projectAccessId : null,
    project_id: projectId, document_id: documentId, permission_epoch: prepared.principal.access.permissionEpoch,
    policy_version: "personal-memory-v2", revision: 1, learn_enabled: 1, recall_enabled: 1, background_enabled: 0,
    retention_days: 30, time_zone: "UTC", enrolled_at: at(-86_400_000), expires_at: expiresAt,
    cursor_sequence: sequence, cutoff_sequence: null, last_local_day: null, last_admitted_at: null,
    next_due_at: at(86_400_000), lease_token: null, lease_expires_at: null, attempts: 0, failure_code: null };
  insert("memory_live_enrollments", enrollment);
  const rememberSource = (row, expires = expiresAt) => insert("memory_live_sources", {
    enrollment_id: enrollment.enrollment_id, event_id: row.event_id, sequence: row.sequence,
    expires_at: expires, conversation_segmented: 0,
  });
  if (remember) navigation.forEach(row => rememberSource(row));
  const recall = options => recallLiveMemoryResponse(env, enrollment, prepared.principal, options ?? { consumptionEpisodes: true });
  const read = async options => {
    const response = await recall(options); assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    return response.json();
  };
  function finalHook(effect, after = false) {
    let fired = 0;
    hooks[after ? "afterBatch" : "beforeBatch"] = async statements => {
      if (statements.length > 1 && statements[0].sql === snapshotSql) {
        assert.equal(++fired, 1, "one final exact witness replay");
        await effect(statements);
      }
    };
    return () => assert.equal(fired, 1);
  }
  recording = true; trace.length = 0;
  verifyCleanup = () => {
    assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.FORMA_ASSISTANT_PROVIDER_USER_IDS, undefined);
    for (const table of ["budget_reservations", "cost_budget_reservations", "consequential_executions", "document_jobs"])
      assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, "read performs no paid work");
  };
  return { sqlite, DB, env, trace, hooks, enrollment, prepared, prepare, recall, read, finalHook, append, visit,
    rememberSource, navigation, actorId, ownerId, projectId, documentId, organizationId, projectAccessId, insert };
}

function projection(value, expected = 1) {
  assert.equal(value.mode, "live-reference-memory");
  const result = value.consumptionEpisodes;
  assert.ok(result, "explicitly requested consumption projection");
  assert.equal(result.version, "memory-consumption-episodes-v1");
  assert.equal(result.treatment, "descriptive-consumption");
  assert.equal(result.episodes.length, expected);
  assert.equal(result.attention, "not-measured"); assert.equal(result.comprehension, "not-measured");
  assert.equal(result.inferredPreferences, false); assert.equal(result.coverage.completeHistory, false);
  for (const episode of result.episodes) {
    assert.equal(episode.episodeId, null); assert.equal(episode.resourceRevision, null);
    assert.equal(episode.independentEvidence, false); assert.deepEqual(episode.origins, ["unknown"]);
    assert.equal(episode.observations.length, 1); assert.equal(episode.observations[0].kind, "visit");
    assert.equal(episode.observations[0].copiedFrom, null);
    assert.equal(value.sources[episode.observations[0].sourceIndex].type, "DocumentViewVisited");
    assert.ok(Date.parse(result.validUntil) <= Date.parse(episode.validUntil));
  }
  assert.equal(value.lifetime.validUntil, result.validUntil);
  assert.doesNotMatch(JSON.stringify(value), /"(?:private_json|payload_json|owner_user_id|actor_user_id|permission_epoch|authorizationSnapshot|sql|bindings)"\s*:/u);
  return result;
}

for (const shared of [false, true]) test(`live consumption: ${shared ? "shared" : "personal"} actual native authority and source query produce visits`, async t => {
  const f = await fixture(t, { shared, visits: 2 });
  const before = f.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n;
  const value = await f.read(); const result = projection(value, 2);
  assert.equal(result.coverage.observationCount, 2);
  assert.equal(value.scope.organizationId, shared ? f.organizationId : null);
  assert.equal(value.scope.documentId, f.documentId);
  assert.deepEqual(result.episodes.map(episode => episode.documentId), [f.documentId, f.documentId]);
  assert.equal(f.trace.filter(isBridge).length, 2, "actual query plus exact trailing replay");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n, before);
});

test("live consumption: omitted or false option preserves original view and avoids bridge reads", async t => {
  const f = await fixture(t);
  for (const options of [{}, { consumptionEpisodes: false }]) {
    const value = await f.read(options);
    assert.equal(Object.hasOwn(value, "consumptionEpisodes"), false);
  }
  assert.equal(f.trace.filter(isBridge).length, 0);
});

test("live consumption: unchanged repeated reads preserve visit identity without collecting extra evidence", async t => {
  const f = await fixture(t); const first = projection(await f.read()), again = projection(await f.read());
  const withoutLease = value => { const result = copy(value); delete result.validUntil; for (const episode of result.episodes) delete episode.validUntil; return result; };
  assert.deepEqual(withoutLease(first), withoutLease(again));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_live_sources").get().n, 1);
  assert.ok(f.trace.every(row => /^\s*(?:SELECT|WITH)/iu.test(row.sql)), "recall only selects existing rows");
});

test("live consumption: unremembered persisted visits remain outside selected source history", async t => {
  const f = await fixture(t, { remember: false }); const value = await f.read();
  projection(value, 0); assert.equal(value.sources.length, 0);
  assert.equal(f.trace.filter(isBridge).length, 2, "empty projection also has a replayed descriptor");
});

test("live consumption: selected non-navigation action is not an invented inspection", async t => {
  const f = await fixture(t, { visits: 0 });
  const source = f.append("ObjectViewed", { project_id: f.projectId, document_id: f.documentId, block_id: "not-a-witness" });
  f.enrollment.cursor_sequence = source.sequence;
  f.sqlite.prepare("UPDATE memory_live_enrollments SET cursor_sequence=?").run(source.sequence); f.rememberSource(source);
  const value = await f.read(); projection(value, 0); assert.equal(value.sources.length, 1);
});

test("live consumption: mixed conversation/actions keep source indexes while bridge bindings contain metadata only", async t => {
  const f = await fixture(t);
  const action = f.append("ObjectViewed", { project_id: f.projectId, document_id: f.documentId, block_id: "unproven-inspection" });
  f.rememberSource(action);
  const turnId = "consumption-conversation", scopeKey = JSON.stringify(["", "", f.projectId, f.documentId]);
  const authored = "PRIVATE_CONSUMPTION_QUESTION", answered = "PRIVATE_CONSUMPTION_ANSWER", expiry = at(25_000);
  const content = (role, body) => {
    const id = "consumption-private-" + role;
    f.insert("private_content", { content_id: id, owner_id: f.actorId, kind: "chat-" + role,
      content: body, created_at: at(-20_000), expires_at: expiry, redacted_at: null });
    return id;
  };
  const userContent = content("user", authored), assistantContent = content("assistant", answered);
  const common = { actor_user_id: f.actorId, project_id: f.projectId, document_id: f.documentId, turn_id: turnId };
  const message = f.append("ChatMessageSent", { ...common, content_ref: userContent }, { correlationId: turnId });
  const response = f.append("AssistantReasoned", { ...common, content_ref: assistantContent, operation: "creative-chat" },
    { correlationId: turnId, causationId: message.event_id });
  f.insert("assistant_turns", { turn_id: turnId, actor_user_id: f.actorId, scope_key: scopeKey,
    organization_id: null, project_access_id: null, project_id: f.projectId, document_id: f.documentId,
    route_family: "document", user_content_ref: userContent, assistant_content_ref: assistantContent,
    proposal_json: null, permission_epoch: f.enrollment.permission_epoch, status: "completed",
    created_at: message.recorded_at, completed_at: response.recorded_at, request_json: null });
  f.rememberSource(response);
  const newest = f.visit(); f.rememberSource(newest);
  f.enrollment.cursor_sequence = newest.sequence;
  f.sqlite.prepare("UPDATE memory_live_enrollments SET cursor_sequence=?").run(newest.sequence);
  const value = await f.read(), result = projection(value, 2);
  assert.deepEqual(value.sources.map(row => row.eventId), [f.navigation[0].event_id, action.event_id, response.event_id, newest.event_id]);
  assert.deepEqual(result.episodes.map(episode => episode.observations[0].sourceIndex), [0, 3]);
  assert.deepEqual(value.rollingConversation.recent.map(row => [row.user, row.assistant]), [[authored, answered]]);
  assert.equal(value.lifetime.validUntil, expiry, "conversation deadline still bounds the enclosing view");
  const queries = f.trace.filter(isBridge); assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.doesNotMatch(JSON.stringify(query.values), /PRIVATE_CONSUMPTION_(?:QUESTION|ANSWER)/u);
    const sources = JSON.parse(query.values[1]);
    assert.equal(sources.length, 4);
    for (const source of sources) assert.deepEqual(Object.keys(source).sort(),
      ["eventId", "sequence", "type", "blockId", "recordedAt", "validUntil"].sort());
  }
});

for (const boundary of ["actor", "document", "project", "private-owner", "private-document", "redacted", "unremembered", "expired-source", "compensated"])
  test(`live consumption: current ${boundary} boundary cannot provide a visit`, async t => {
    const f = await fixture(t, { visits: 0 });
    const options = boundary === "actor" ? { actor: "user:other-actor" }
      : boundary === "document" ? { payload: { document_id: "other-document" } }
        : boundary === "project" ? { payload: { project_id: "other-project" } } : {};
    const row = f.visit(options); f.enrollment.cursor_sequence = row.sequence;
    f.sqlite.prepare("UPDATE memory_live_enrollments SET cursor_sequence=?").run(row.sequence);
    if (boundary !== "unremembered") f.rememberSource(row, boundary === "expired-source" ? at(-1_000) : undefined);
    if (boundary === "private-owner") f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='other-owner' WHERE private_event_id=?").run(row.event_id);
    if (boundary === "private-document") f.sqlite.prepare("UPDATE event_private_payloads SET document_id='other-document' WHERE private_event_id=?").run(row.event_id);
    if (boundary === "redacted") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(at(-1), row.event_id);
    if (boundary === "compensated") f.append("ConsumptionFixtureNegative", {}, { compensates: row.event_id, custody: false });
    projection(await f.read(), 0);
  });

for (const boundary of ["enrollment-revision", "recall-disabled", "consent-revoked", "permission-epoch", "document-removed", "document-rebound"])
  test(`live consumption: current ${boundary} rejects request rather than certify empty history`, async t => {
    const f = await fixture(t);
    if (boundary === "enrollment-revision") f.sqlite.exec("UPDATE memory_live_enrollments SET revision=revision+1");
    if (boundary === "recall-disabled") f.sqlite.exec("UPDATE memory_live_enrollments SET recall_enabled=0");
    if (boundary === "consent-revoked") f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.actorId);
    if (boundary === "permission-epoch") f.sqlite.prepare("UPDATE users SET updated_at=? WHERE user_id=?").run(at(1_000), f.actorId);
    if (boundary === "document-removed") f.append("DocumentRemoved", { project_id: f.projectId, document_id: f.documentId });
    if (boundary === "document-rebound") f.append("DocumentCreated", { project_id: "other-project", document_id: f.documentId, title: "Contradictory latest containment" });
    await assert.rejects(f.recall(), /memory-/u);
  });

for (const boundary of ["membership", "organization", "migration", "document-visibility", "source-custody"])
  test(`live consumption: shared native ${boundary} withdrawal does not expose a visit`, async t => {
    const f = await fixture(t, { shared: true });
    if (boundary === "membership") f.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE user_id=?").run(at(-1), f.actorId);
    if (boundary === "organization") f.sqlite.exec("UPDATE organizations SET status='suspended'");
    if (boundary === "migration") f.sqlite.exec("UPDATE project_migration_states SET status='pending'");
    if (boundary === "document-visibility") f.sqlite.exec("UPDATE project_resource_scopes SET visibility='actor_private'");
    if (boundary === "source-custody") {
      f.sqlite.prepare("UPDATE project_event_scopes SET actor_user_id='other-actor' WHERE event_id=?").run(f.navigation[0].event_id);
      projection(await f.read(), 0);
    } else await assert.rejects(f.recall(), /memory-/u);
  });

for (const boundary of ["private-bytes", "private-redaction", "reference-withdrawal", "reference-expiry", "enrollment", "principal", "document", "compensation"])
  test(`live consumption: late ${boundary} change fails the actual final replay`, async t => {
    const f = await fixture(t); const row = f.navigation[0];
    const checked = f.finalHook(statements => {
      assert.equal(statements.filter(isBridge).length, 1, "same bridge included in final batch");
      if (boundary === "private-bytes") f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.focused',json('false')) WHERE private_event_id=?").run(row.event_id);
      if (boundary === "private-redaction") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(at(-1), row.event_id);
      if (boundary === "reference-withdrawal") f.sqlite.prepare("DELETE FROM memory_live_sources WHERE event_id=?").run(row.event_id);
      if (boundary === "reference-expiry") f.sqlite.prepare("UPDATE memory_live_sources SET expires_at=? WHERE event_id=?").run(at(-1), row.event_id);
      if (boundary === "enrollment") f.sqlite.exec("UPDATE memory_live_enrollments SET revision=revision+1");
      if (boundary === "principal") f.sqlite.prepare("UPDATE users SET updated_at=? WHERE user_id=?").run(at(1_000), f.actorId);
      if (boundary === "document") f.append("DocumentRemoved", { project_id: f.projectId, document_id: f.documentId });
      if (boundary === "compensation") f.append("ConsumptionFixtureNegative", {}, { compensates: row.event_id, custody: false, recordedAt: at(86_400_000) });
    });
    await assert.rejects(f.recall(), /memory-source-changed/u); checked();
  });

test("live consumption: empty projection invalidates when an uncertifiable selected visit becomes certifiable", async t => {
  const f = await fixture(t); const id = f.navigation[0].event_id;
  const original = f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(id).private_json;
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.focused','not-a-boolean') WHERE private_event_id=?").run(id);
  const checked = f.finalHook(statements => {
    assert.equal(statements.filter(isBridge).length, 1);
    f.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(original, id);
  });
  await assert.rejects(f.recall(), /memory-source-changed/u); checked();
});

test("live consumption: flag withdrawal after successful final SQL rejects delivery", async t => {
  const f = await fixture(t); const checked = f.finalHook(() => { f.env.FORMA_MEMORY_ENABLED = "false"; }, true);
  await assert.rejects(f.recall(), /memory-source-changed/u); checked();
});

test("live consumption: deadline passing after successful final SQL rejects delivery", async t => {
  const f = await fixture(t); const dateNow = Date.now; t.after(() => { Date.now = dateNow; });
  const checked = f.finalHook(() => { const later = dateNow() + 61_000; Date.now = () => later; }, true);
  await assert.rejects(f.recall(), /memory-source-changed/u); checked();
});

test("live consumption: malformed persisted public JSON aborts the native read", async t => {
  const f = await fixture(t, { visits: 0 });
  const row = f.visit({ rawPublic: "{malformed native payload" }); f.enrollment.cursor_sequence = row.sequence;
  f.sqlite.prepare("UPDATE memory_live_enrollments SET cursor_sequence=?").run(row.sequence); f.rememberSource(row);
  await assert.rejects(f.recall(), /memory-|malformed JSON/u);
  assert.equal(f.trace.filter(isBridge).length, 0, "native source selection must fail before certifying a bridge result");
});

test("live consumption: final replay malformed public JSON cannot become certified zero history", async t => {
  const f = await fixture(t);
  const checked = f.finalHook(() => { f.append("DocumentCreated", {}, { rawPublic: "{malformed late boundary" }); });
  await assert.rejects(f.recall(), /memory-|malformed JSON/u); checked();
});

test("live consumption: bridge parser failure is unavailable, not a successful empty projection", async t => {
  const f = await fixture(t); let replaced = 0;
  // A transport-corruption seam only; actual SQL runs first. Native authority
  // and source selection are unchanged, and this does not qualify normal rows.
  f.hooks.afterStatement = (statement, kind, result) => {
    if (isBridge(statement) && kind === "all" && ++replaced === 1) result.results[0].payload_json = "{";
  };
  await assert.rejects(f.recall(), /memory-/u); assert.equal(replaced, 1);
});

test("live consumption: current source deadline clips projection and response lease", async t => {
  const f = await fixture(t); const expiry = at(20_000);
  f.sqlite.prepare("UPDATE memory_live_sources SET expires_at=?").run(expiry);
  const value = await f.read(); const result = projection(value);
  assert.equal(value.lifetime.validUntil, expiry); assert.equal(result.episodes[0].validUntil, expiry);
});

test("live consumption: selected source limit stays 64 and all query/witness budgets remain bounded", async t => {
  const f = await fixture(t, { visits: 70 }); const value = await f.read(); projection(value, 64);
  assert.equal(value.sources.length, 64); assert.equal(value.sources[0].eventId, f.navigation[6].event_id);
  assert.ok(f.trace.length <= 64, "bounded total reader SQL statements including final replay");
  const reads = f.trace.filter(isBridge); assert.equal(reads.length, 2);
  assert.equal(reads[0].sql, reads[1].sql); assert.deepEqual(reads[0].values, reads[1].values);
  assert.ok(reads.every(row => row.values.length <= 100));
});

// Optional public inspector successor. All original43 native-reader cases above
// remain intact. These additional tests compose the actual HTTP handler; they
// do not register a route, replace authorization, or execute a collector.
const [{ handleLiveMemory }, { MEMORY_CONSUMPTION_EPISODES_VERSION, parseMemoryConsumptionEpisodes }, { MEMORY_ASSISTED_OUTCOMES_VERSION },
  { MEMORY_SAVED_OUTPUTS_VERSION }] = await Promise.all([
  import("../worker/memory-live-api.ts"), import("../src/model/memory-consumption-episodes.ts"),
  import("../src/model/memory-assisted-outcomes.ts"), import("../src/model/memory-saved-outputs.ts"),
]);
const optedIn = [["consumptionEpisodes", MEMORY_CONSUMPTION_EPISODES_VERSION]];
const allProjections = [...optedIn, ["outcomes", MEMORY_ASSISTED_OUTCOMES_VERSION], ["savedOutputs", MEMORY_SAVED_OUTPUTS_VERSION]];

function apiRequest(f, parameters = optedIn, { method = "GET", actor = f.actorId, operation = "recall", id = f.enrollment.enrollment_id } = {}) {
  const query = new URLSearchParams(id === null ? [] : [["id", id]]);
  for (const [key, value] of parameters) query.append(key, value);
  const headers = { "oai-authenticated-user-id": actor, "oai-authenticated-user-email": `${actor}@example.test`,
    "oai-authenticated-user-name": actor,
    ...(f.enrollment.organization_id !== null ? { cookie: "forma_project_context=consumption-context" } : {}) };
  return handleLiveMemory(new Request(`http://localhost/api/memory/${operation}?${query}`, { method, headers }), f.env, operation);
}

async function apiValue(response, expected = 1) {
  const text = await response.text();
  assert.equal(response.status, 200, text);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie, oai-authenticated-user-id, oai-authenticated-user-email");
  assert.equal(response.headers.get("content-disposition"), null);
  assert.ok(new TextEncoder().encode(text).byteLength <= 65_536, "complete server response cap is unchanged");
  const value = JSON.parse(text); projection(value, expected);
  assert.deepEqual(parseMemoryConsumptionEpisodes(value.consumptionEpisodes, value.sources, value.lifetime, value.scope.documentId),
    value.consumptionEpisodes, "actual native HTTP payload agrees with the strict supported client contract");
  return value;
}

async function apiError(response, status = 403, code = "memory_unavailable") {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie, oai-authenticated-user-id, oai-authenticated-user-email");
  assert.equal(response.headers.get("content-disposition"), null);
  const body = await response.json(); assert.deepEqual(body, { error: code });
  return body;
}

for (const shared of [false, true]) test(`live consumption HTTP: exact opt-in composes ${shared ? "shared" : "personal"} native authority`, async t => {
  const f = await fixture(t, { shared, visits: 2 }); const value = await apiValue(await apiRequest(f), 2);
  assert.equal(value.scope.documentId, f.documentId);
  assert.equal(value.scope.organizationId, shared ? f.organizationId : null);
  assert.equal(f.trace.filter(isBridge).length, 2);
});

test("live consumption HTTP: legacy omission keeps the previous shape and never queries the bridge", async t => {
  const f = await fixture(t); const response = await apiRequest(f, []), value = await response.json();
  assert.equal(response.status, 200); assert.equal(Object.hasOwn(value, "consumptionEpisodes"), false);
  assert.equal(value.sources.length, 1); assert.equal(f.trace.filter(isBridge).length, 0);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

for (const [name, values] of [
  ["empty", [""]], ["unknown", ["memory-consumption-episodes-v2"]], ["boolean", ["true"]],
  ["duplicate exact", [MEMORY_CONSUMPTION_EPISODES_VERSION, MEMORY_CONSUMPTION_EPISODES_VERSION]],
  ["exact then invalid", [MEMORY_CONSUMPTION_EPISODES_VERSION, "invalid"]],
  ["invalid then exact", ["invalid", MEMORY_CONSUMPTION_EPISODES_VERSION]],
  ["padded", [" " + MEMORY_CONSUMPTION_EPISODES_VERSION]],
]) test(`live consumption HTTP: ${name} version rejects before any reader query`, async t => {
  const f = await fixture(t);
  await apiError(await apiRequest(f, values.map(value => ["consumptionEpisodes", value])), 400, "memory_consumption_version_unsupported");
  assert.equal(f.trace.filter(isBridge).length, 0);
  assert.equal(f.trace.some(row => row.sql === snapshotSql), false);
});

test("live consumption HTTP: settings ignores a recall-only parameter without invoking the reader", async t => {
  const f = await fixture(t);
  const response = await apiRequest(f, [["consumptionEpisodes", "not-a-settings-option"]], { operation: "settings" });
  const value = await response.json(); assert.equal(response.status, 200);
  assert.equal(value.enrollments.length, 1); assert.equal(f.trace.filter(isBridge).length, 0);
});

test("live consumption HTTP: unsupported method cannot turn recall opt-in into a write", async t => {
  const f = await fixture(t);
  await apiError(await apiRequest(f, optedIn, { method: "POST" }), 405, "method_not_allowed");
  assert.equal(f.trace.filter(isBridge).length, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_live_enrollments").get().n, 1);
});

test("live consumption HTTP: another authenticated principal cannot retrieve the enrollment", async t => {
  const f = await fixture(t), actor = "consumption-other-principal";
  f.insert("users", { user_id: actor, email: `${actor}@example.test`, display_name: actor, role: "creator",
    consent_version: POLICY_VERSION, consented_at: at(-1_000), created_at: at(-1_000), updated_at: at(-1_000) });
  await apiError(await apiRequest(f, optedIn, { actor }), 404, "memory_not_found");
  assert.equal(f.trace.filter(isBridge).length, 0);
});

test("live consumption HTTP: requested subset may omit a compensated visit without inventing completeness", async t => {
  const f = await fixture(t, { visits: 2 });
  f.append("ConsumptionFixtureNegative", {}, { compensates: f.navigation[0].event_id, custody: false });
  const value = await apiValue(await apiRequest(f));
  assert.equal(value.sources.length, 2);
  assert.deepEqual(value.consumptionEpisodes.episodes.map(episode => episode.observations[0].sourceIndex), [1]);
  assert.equal(value.consumptionEpisodes.coverage.eligibleSourceCount, 2);
  assert.equal(value.consumptionEpisodes.coverage.compensatedObservationCount, 0, "bridge supplies no certified compensation records");
});

test("live consumption HTTP: verified empty visit projection retains a selected but uncertifiable navigation source", async t => {
  const f = await fixture(t);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.focused','unknown')").run();
  const value = await apiValue(await apiRequest(f), 0);
  assert.equal(value.sources.length, 1); assert.equal(value.consumptionEpisodes.coverage.eligibleSourceCount, 1);
  assert.equal(f.trace.filter(isBridge).length, 2);
});

test("live consumption HTTP: all three optional projections share the same bounded selected window", async t => {
  const f = await fixture(t, { visits: 2 }); const value = await apiValue(await apiRequest(f, allProjections), 2);
  assert.equal(value.assistedOutcomes?.coverage.selectedSourceCount, 2);
  assert.equal(value.savedOutputs?.coverage.selectedSourceCount, 2);
  assert.equal(value.assistedOutcomes.outcomes.length, 0); assert.equal(value.savedOutputs.outputs.length, 0);
  assert.equal(value.consumptionEpisodes.coverage.eligibleSourceCount, 2);
  assert.equal(f.trace.filter(isBridge).length, 2);
});

for (const boundary of ["membership", "document-visibility", "enrollment", "principal", "document", "source", "private", "compensation"])
  test(`live consumption HTTP: late ${boundary} withdrawal is sanitized and cannot deliver stale history`, async t => {
    const shared = boundary === "membership" || boundary === "document-visibility", f = await fixture(t, { shared });
    const checked = f.finalHook(() => {
      if (boundary === "membership") f.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE user_id=?").run(at(-1), f.actorId);
      if (boundary === "document-visibility") f.sqlite.exec("UPDATE project_resource_scopes SET visibility='actor_private'");
      if (boundary === "enrollment") f.sqlite.exec("UPDATE memory_live_enrollments SET revision=revision+1");
      if (boundary === "principal") f.sqlite.prepare("UPDATE users SET updated_at=? WHERE user_id=?").run(at(1_000), f.actorId);
      if (boundary === "document") f.append("DocumentRemoved", { project_id: f.projectId, document_id: f.documentId });
      if (boundary === "source") f.sqlite.prepare("DELETE FROM memory_live_sources WHERE event_id=?").run(f.navigation[0].event_id);
      if (boundary === "private") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(at(-1), f.navigation[0].event_id);
      if (boundary === "compensation") f.append("ConsumptionFixtureNegative", {}, { compensates: f.navigation[0].event_id, custody: false });
    });
    await apiError(await apiRequest(f)); checked();
  });

test("live consumption HTTP: empty projection still fails a changed final descriptor", async t => {
  const f = await fixture(t), id = f.navigation[0].event_id;
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.focused','unknown') WHERE private_event_id=?").run(id);
  const checked = f.finalHook(() => {
    f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.focused',json('true')) WHERE private_event_id=?").run(id);
  });
  await apiError(await apiRequest(f)); checked();
});

for (const boundary of ["flag", "deadline"]) test(`live consumption HTTP: ${boundary} changes after final SQL prevent delivery`, async t => {
  const f = await fixture(t), originalNow = Date.now; t.after(() => { Date.now = originalNow; });
  const checked = f.finalHook(() => {
    if (boundary === "flag") f.env.FORMA_MEMORY_ENABLED = "false";
    else { const later = originalNow() + 61_000; Date.now = () => later; }
  }, true);
  await apiError(await apiRequest(f)); checked();
});

test("live consumption HTTP: missing base memory schema has the existing 503 response", async t => {
  const f = await fixture(t); f.sqlite.exec("DROP TABLE memory_live_runs");
  await apiError(await apiRequest(f), 503, "memory_schema_unavailable");
  assert.equal(f.trace.filter(isBridge).length, 0);
});

test("live consumption HTTP: missing reader schema is unavailable, never a fabricated empty projection", async t => {
  const f = await fixture(t); f.sqlite.exec("DROP TABLE memory_live_conversation_segments");
  await apiError(await apiRequest(f)); assert.equal(f.trace.filter(isBridge).length, 0);
});

test("live consumption HTTP: actual malformed persisted JSON is sanitized instead of certified empty", async t => {
  const f = await fixture(t, { visits: 0 }); const source = f.visit({ rawPublic: "{PRIVATE_MALFORMED_PUBLIC_PAYLOAD" });
  f.sqlite.prepare("UPDATE memory_live_enrollments SET cursor_sequence=?").run(source.sequence); f.rememberSource(source);
  await apiError(await apiRequest(f)); assert.equal(f.trace.filter(isBridge).length, 0);
});

test("live consumption HTTP: bridge database failure preserves sanitized unavailability", async t => {
  const f = await fixture(t); let attempted = 0;
  f.hooks.beforeStatement = statement => {
    if (isBridge(statement)) { attempted++; throw new Error("PRIVATE_BRIDGE_DATABASE_FAILURE"); }
  };
  await apiError(await apiRequest(f)); assert.equal(attempted, 1);
});

test("live consumption HTTP: malformed bridge row cannot silently remove the requested projection", async t => {
  const f = await fixture(t); let changed = 0;
  f.hooks.afterStatement = (statement, kind, result) => {
    if (isBridge(statement) && kind === "all" && changed++ === 0) result.results[0].payload_json = "PRIVATE_CORRUPTED_TRANSPORT";
  };
  await apiError(await apiRequest(f)); assert.equal(changed, 1);
});

async function unicodeDocument(f, length) {
  const documentId = "界".repeat(length);
  f.append("DocumentCreated", { project_id: f.projectId, document_id: documentId, title: "Synthetic Unicode document" });
  const visits = Array.from({ length: 64 }, () => f.visit({ payload: { document_id: documentId } }));
  // Persisted fixture metadata follows the seeded document. No writer or
  // collector is exercised and no production record is changed here.
  for (const row of visits) {
    f.sqlite.prepare("UPDATE event_private_payloads SET document_id=? WHERE private_event_id=?").run(documentId, row.event_id);
    f.rememberSource(row);
  }
  f.enrollment.document_id = documentId; f.enrollment.cursor_sequence = visits.at(-1).sequence;
  f.sqlite.prepare("UPDATE memory_live_enrollments SET document_id=?,cursor_sequence=?").run(documentId, visits.at(-1).sequence);
  return documentId;
}

test("live consumption HTTP: maximum current-preparer Unicode document retains the complete response cap", async t => {
  const f = await fixture(t, { visits: 0 }), documentId = await unicodeDocument(f, 120);
  const prepared = await prepareDocumentAuthority(new Request("http://localhost/api/context/read", { headers: {
    "oai-authenticated-user-id": f.actorId, "oai-authenticated-user-email": `${f.actorId}@example.test`,
    "oai-authenticated-user-name": f.actorId,
  } }), f.env, { projectId: f.projectId, documentId }, "read");
  assert.ok(!(prepared instanceof Response), prepared instanceof Response ? await prepared.text() : undefined);
  const legacy = await apiRequest(f, []); assert.equal(legacy.status, 200); const old = await legacy.json();
  assert.equal(old.sources.length, 64); assert.equal(old.scope.documentId, documentId);
  const response = await apiRequest(f, allProjections);
  t.diagnostic(JSON.stringify({ unicodeDocumentUnits: documentId.length, selectedSources: 64,
    combinedStatus: response.status, serializedResponseBytes: new TextEncoder().encode(await response.clone().text()).byteLength }));
  if (response.status === 200) {
    const value = await apiValue(response, 64); assert.equal(value.scope.documentId, documentId);
  } else {
    await assert.rejects(f.recall({ consumptionEpisodes: true, assistedOutcomes: true, savedOutputs: true }), { message: "memory-response-too-large" });
    await apiError(response);
  }
});

test("live consumption HTTP: oversized native-contract Unicode history rejects the whole combined response", async t => {
  const f = await fixture(t, { visits: 0 }), documentId = await unicodeDocument(f, 240);
  // Native reader/source IDs permit240 UTF-16 units; current preparation accepts
  // only120. This is defensive seeded historical data, not current UI output.
  const legacy = await apiRequest(f, []); assert.equal(legacy.status, 200); const old = await legacy.json();
  assert.equal(old.sources.length, 64); assert.equal(old.scope.documentId, documentId);
  await assert.rejects(f.recall({ consumptionEpisodes: true, assistedOutcomes: true, savedOutputs: true }), { message: "memory-response-too-large" });
  await apiError(await apiRequest(f, allProjections));
});

// Maintenance resolver only. Reuse the original native SQLite fixture and its
// read hooks; these cases do not attach the certificate to a retirement caller.
const { createLiveMemoryMaintenanceAttempt } = await import("../worker/memory-live-authority.ts");
const maintenanceEnrollmentSql = "SELECT * FROM memory_live_enrollments WHERE enrollment_id=?";
const maintenancePrincipalQuery = statement => statement.sql.startsWith("WITH memory_maintenance_principal AS (");
const maintenanceQuery = (lane, statement) => lane === "enrollment"
  ? statement.sql === maintenanceEnrollmentSql : maintenancePrincipalQuery(statement);
const maintenanceReplay = statements => statements.some(statement => statement.sql === maintenanceEnrollmentSql)
  && statements.some(maintenancePrincipalQuery);
const maintenanceUnavailable = { message: "memory_maintenance_unavailable" };

async function maintenanceDenied(f) {
  f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.actorId);
  const attempt = createLiveMemoryMaintenanceAttempt(f.env), result = await attempt.resolve(f.enrollment);
  assert.equal(result.status, "denied");
  return { attempt, certificate: result.certificate };
}
async function maintenanceProof(f, attempt, certificate) {
  const statements = attempt.denialPrecommitStatements(f.enrollment, certificate);
  assert.ok(statements.length > 0);
  assert.ok((await f.DB.batch(statements)).every(result => result.success === true));
  return statements;
}

for (const shared of [false, true]) test(`memory maintenance authority: ${shared ? "shared" : "personal"} current authority is independent of consumption history`, async t => {
  const f = await fixture(t, { shared, visits: 0, remember: false });
  const attempt = createLiveMemoryMaintenanceAttempt(f.env);
  assert.equal(Object.isFrozen(attempt), true);
  assert.deepEqual(await attempt.resolve(f.enrollment), { status: "current" });
  assert.equal(f.trace.filter(maintenancePrincipalQuery).length, 2, "native principal capture and exact replay both execute");
  assert.equal(f.trace.filter(isBridge).length, 0, "authority does not infer denial from empty consumption");
  assert.deepEqual(await attempt.resolve(f.enrollment), { status: "unavailable" });
});

for (const boundary of ["null-consent", "old-consent", "absent-principal", "removed-document"])
  test(`memory maintenance authority: real ${boundary} yields only opaque witnessed denial`, async t => {
    const f = await fixture(t, { shared: true });
    if (boundary === "null-consent") f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.actorId);
    if (boundary === "old-consent") f.sqlite.prepare("UPDATE users SET consent_version='old-policy' WHERE user_id=?").run(f.actorId);
    if (boundary === "absent-principal") f.sqlite.prepare("DELETE FROM users WHERE user_id=?").run(f.actorId);
    if (boundary === "removed-document") f.append("DocumentRemoved", { project_id: f.projectId, document_id: f.documentId });
    const attempt = createLiveMemoryMaintenanceAttempt(f.env), result = await attempt.resolve(f.enrollment);
    assert.equal(result.status, "denied"); assert.deepEqual(Object.keys(result).sort(), ["certificate", "status"]);
    assert.equal(Object.getPrototypeOf(result.certificate), null); assert.equal(Object.isFrozen(result.certificate), true);
    assert.deepEqual(Object.keys(result.certificate), []);
    assert.throws(() => JSON.stringify(result.certificate), { message: "memory_certificate_not_serializable" });
    await maintenanceProof(f, attempt, result.certificate);
    assert.throws(() => attempt.denialPrecommitStatements(f.enrollment, result.certificate), maintenanceUnavailable);
    assert.deepEqual(await attempt.resolve(f.enrollment), { status: "unavailable" });
  });

for (const lane of ["enrollment", "principal"]) for (const corruption of ["throw", "failed", "missing-success", "error", "empty", "missing-results", "duplicate", "partial-row", "malformed-field"])
  test(`memory maintenance authority: ${lane} ${corruption} is unavailable rather than denial`, async t => {
    const f = await fixture(t); let changed = 0;
    const selected = statement => maintenanceQuery(lane, statement) && changed === 0;
    if (corruption === "throw") f.hooks.beforeStatement = statement => {
      if (selected(statement)) { changed++; throw new Error("synthetic_maintenance_read_failure"); }
    };
    else f.hooks.afterStatement = (statement, kind, result) => {
      if (kind !== "all" || !selected(statement)) return;
      changed++; assert.equal(result.success, true); assert.equal(result.results.length, 1);
      if (corruption === "failed") result.success = false;
      if (corruption === "missing-success") delete result.success;
      if (corruption === "error") result.error = "synthetic_maintenance_result_failure";
      if (corruption === "empty") result.results = [];
      if (corruption === "missing-results") delete result.results;
      if (corruption === "duplicate") result.results.push(copy(result.results[0]));
      if (corruption === "partial-row") delete result.results[0][lane === "enrollment" ? "lease_token" : "email"];
      if (corruption === "malformed-field") result.results[0][lane === "enrollment" ? "revision" : "memory_principal_count"] = "1";
    };
    const attempt = createLiveMemoryMaintenanceAttempt(f.env);
    assert.deepEqual(await attempt.resolve(f.enrollment), { status: "unavailable" }); assert.equal(changed, 1);
    f.hooks.beforeStatement = f.hooks.afterStatement = null;
    assert.deepEqual(await attempt.resolve(f.enrollment), { status: "unavailable" }, "a failed resolution also consumes its attempt");
    assert.throws(() => attempt.denialPrecommitStatements(f.enrollment, {}), maintenanceUnavailable);
  });

for (const field of ["grants_json", "organizations_json", "projects_json", "identity_policies_json"])
  test(`memory maintenance authority: malformed ${field} cannot become a native policy denial`, async t => {
    const f = await fixture(t, { shared: true }); let changed = 0;
    f.hooks.afterStatement = (statement, kind, result) => {
      if (kind === "all" && maintenancePrincipalQuery(statement) && changed === 0) {
        changed++; result.results[0][field] = "[{\"incomplete_native_policy\":true}]";
      }
    };
    assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "unavailable" });
    assert.equal(changed, 1);
  });

for (const corruption of ["invalid-json", "non-array", "unknown-role", "partial-policy", "malformed-domains", "truncated-projects"])
  test(`memory maintenance authority: ${corruption} principal facts never certify a false denial`, async t => {
    const f = await fixture(t, { shared: true }); let changed = 0;
    f.hooks.afterStatement = (statement, kind, result) => {
      if (kind !== "all" || !maintenancePrincipalQuery(statement) || changed !== 0) return;
      changed++; const row = result.results[0];
      if (corruption === "invalid-json") row.grants_json = "{";
      if (corruption === "non-array") row.identity_policies_json = "{}";
      if (corruption === "unknown-role") row.role = "unknown-native-role";
      if (corruption === "partial-policy") row.identity_policies_json = '[{"organizationId":"consumption-organization"}]';
      if (corruption === "malformed-domains") row.identity_policies_json = JSON.stringify([{
        organizationId: f.organizationId, authenticationSource: "any", allowedDomainsJson: "[1]", requireMfa: 0, version: 1,
        bindingStatus: null, bindingSource: null, bindingSubject: null, ownsData: 0,
      }]);
      if (corruption === "truncated-projects") { assert.ok(JSON.parse(row.projects_json).length > 0); row.projects_json = "[]"; }
    };
    assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "unavailable" });
    assert.equal(changed, 1);
  });

for (const corruption of ["failed-envelope", "missing-success", "missing-result", "changed-row"])
  test(`memory maintenance authority: final replay ${corruption} withholds the certificate`, async t => {
    const f = await fixture(t); let changed = 0;
    f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.actorId);
    f.hooks.afterBatch = (statements, results) => {
      if (!maintenanceReplay(statements)) return;
      assert.equal(++changed, 1);
      if (corruption === "failed-envelope") results[0].success = false;
      if (corruption === "missing-success") delete results[0].success;
      if (corruption === "missing-result") results.pop();
      if (corruption === "changed-row") results[0].results[0].cursor_sequence++;
    };
    assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "unavailable" });
    assert.equal(changed, 1);
  });

for (const corruption of ["failed", "empty", "partial", "invalid-boolean", "forged-zero"])
  test(`memory maintenance authority: native guard ${corruption} cannot mint denial`, async t => {
    const f = await fixture(t); let changed = 0;
    f.hooks.afterStatement = (statement, kind, result) => {
      if (kind !== "all" || !statement.sql.startsWith("SELECT CASE WHEN (")
        || !statement.sql.endsWith(" AS memory_authority_current") || changed !== 0) return;
      changed++; assert.equal(result.success, true); assert.equal(result.results.length, 1);
      assert.equal(result.results[0].memory_authority_current, 1);
      if (corruption === "failed") result.success = false;
      if (corruption === "empty") result.results = [];
      if (corruption === "partial") delete result.results[0].memory_authority_current;
      if (corruption === "invalid-boolean") result.results[0].memory_authority_current = 2;
      if (corruption === "forged-zero") result.results[0].memory_authority_current = 0;
    };
    assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "unavailable" });
    assert.equal(changed, 1);
  });

test("memory maintenance authority: restoration before final replay cannot issue stale denial", async t => {
  const f = await fixture(t); let restored = 0;
  f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.actorId);
  f.hooks.beforeBatch = statements => {
    if (!maintenanceReplay(statements)) return;
    assert.equal(++restored, 1);
    f.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run(POLICY_VERSION, f.actorId);
  };
  assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "unavailable" });
  assert.equal(restored, 1); f.hooks.beforeBatch = null;
  assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "current" });
});

for (const boundary of ["consent", "document", "absent-principal"])
  test(`memory maintenance authority: ${boundary} restoration invalidates the issued transaction proof`, async t => {
    const f = await fixture(t), user = f.sqlite.prepare("SELECT * FROM users WHERE user_id=?").get(f.actorId);
    if (boundary === "consent") f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.actorId);
    if (boundary === "document") f.append("DocumentRemoved", { project_id: f.projectId, document_id: f.documentId });
    if (boundary === "absent-principal") f.sqlite.prepare("DELETE FROM users WHERE user_id=?").run(f.actorId);
    const attempt = createLiveMemoryMaintenanceAttempt(f.env), result = await attempt.resolve(f.enrollment);
    assert.equal(result.status, "denied");
    const proof = attempt.denialPrecommitStatements(f.enrollment, result.certificate);
    if (boundary === "consent") f.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run(POLICY_VERSION, f.actorId);
    if (boundary === "document") f.append("DocumentRestored", { project_id: f.projectId, document_id: f.documentId });
    if (boundary === "absent-principal") f.insert("users", user);
    await assert.rejects(f.DB.batch(proof));
    assert.throws(() => attempt.denialPrecommitStatements(f.enrollment, result.certificate), maintenanceUnavailable);
    assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "current" });
  });

test("memory maintenance authority: copied and fabricated certificates cannot consume a genuine proof", async t => {
  const f = await fixture(t), { attempt, certificate } = await maintenanceDenied(f);
  const descriptorCopy = Object.create(null, Object.getOwnPropertyDescriptors(certificate));
  for (const forged of [{}, { status: "denied" }, { ...certificate }, structuredClone(certificate), descriptorCopy, null])
    assert.throws(() => attempt.denialPrecommitStatements(f.enrollment, forged), maintenanceUnavailable);
  await maintenanceProof(f, attempt, certificate);
});

test("memory maintenance authority: certificates are bound to one attempt and database", async t => {
  const f = await fixture(t), other = await fixture(t), { attempt, certificate } = await maintenanceDenied(f);
  for (const foreign of [createLiveMemoryMaintenanceAttempt(f.env), createLiveMemoryMaintenanceAttempt(other.env)])
    assert.throws(() => foreign.denialPrecommitStatements(f.enrollment, certificate), maintenanceUnavailable);
  const db = f.env.DB; f.env.DB = { ...db };
  assert.throws(() => attempt.denialPrecommitStatements(f.enrollment, certificate), maintenanceUnavailable);
  f.env.DB = db; await maintenanceProof(f, attempt, certificate);
});

test("memory maintenance authority: complete enrollment input identity cannot be retargeted", async t => {
  const f = await fixture(t), { attempt, certificate } = await maintenanceDenied(f);
  const changes = [
    { revision: f.enrollment.revision + 1 }, { cursor_sequence: f.enrollment.cursor_sequence + 1 },
    { cutoff_sequence: f.enrollment.cursor_sequence }, { lease_token: "different-lease", lease_expires_at: at(20_000) },
    { project_id: "different-project" }, { document_id: "different-document" },
    { organization_id: "different-organization", project_access_id: "different-access" },
    { actor_user_id: "different-actor", owner_user_id: "different-actor" }, { recall_enabled: 0 },
  ];
  for (const change of changes)
    assert.throws(() => attempt.denialPrecommitStatements({ ...f.enrollment, ...change }, certificate), maintenanceUnavailable);
  await maintenanceProof(f, attempt, certificate);
});

for (const change of ["revision", "cursor", "cutoff", "lease", "scope", "principal"])
  test(`memory maintenance authority: persisted ${change} drift invalidates transaction-time proof`, async t => {
    const f = await fixture(t), { attempt, certificate } = await maintenanceDenied(f);
    const proof = attempt.denialPrecommitStatements(f.enrollment, certificate);
    if (change === "revision") f.sqlite.exec("UPDATE memory_live_enrollments SET revision=revision+1");
    if (change === "cursor") f.sqlite.exec("UPDATE memory_live_enrollments SET cursor_sequence=cursor_sequence+1");
    if (change === "cutoff") f.sqlite.exec("UPDATE memory_live_enrollments SET cutoff_sequence=cursor_sequence");
    if (change === "lease") f.sqlite.prepare("UPDATE memory_live_enrollments SET lease_token=?,lease_expires_at=?").run("different-lease", at(20_000));
    if (change === "scope") f.sqlite.exec("UPDATE memory_live_enrollments SET document_id='different-document'");
    if (change === "principal") f.sqlite.prepare("UPDATE users SET updated_at=? WHERE user_id=?").run(at(1_000), f.actorId);
    await assert.rejects(f.DB.batch(proof));
  });

test("memory maintenance authority: caller input mutation during resolution is unavailable", async t => {
  const f = await fixture(t); let changed = 0;
  f.hooks.afterBatch = statements => {
    if (maintenanceReplay(statements)) { assert.equal(++changed, 1); f.enrollment.cursor_sequence++; }
  };
  assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "unavailable" });
  assert.equal(changed, 1);
});

for (const condition of ["unknown-policy", "expired-enrollment", "missing-enrollment", "malformed-input"])
  test(`memory maintenance authority: ${condition} is not durable native denial`, async t => {
    const f = await fixture(t, { visits: 0, remember: false });
    if (condition === "unknown-policy") f.enrollment.policy_version = "unknown-memory-policy";
    if (condition === "expired-enrollment") {
      f.enrollment.expires_at = at(-1); f.sqlite.prepare("UPDATE memory_live_enrollments SET expires_at=?").run(f.enrollment.expires_at);
    }
    if (condition === "missing-enrollment") f.sqlite.exec("DELETE FROM memory_live_enrollments");
    if (condition === "malformed-input") f.enrollment.lease_token = "lease-without-expiry";
    assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "unavailable" });
  });

for (const epoch of ["broken", "A".repeat(64), "0".repeat(63)])
  test(`memory maintenance authority: matching malformed ${epoch.length}-character epoch is unavailable`, async t => {
    const f = await fixture(t);
    f.enrollment.permission_epoch = epoch;
    f.sqlite.prepare("UPDATE memory_live_enrollments SET permission_epoch=?").run(epoch);
    assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "unavailable" });
  });

test("memory maintenance authority: well-formed stale permission epoch is witnessed denial", async t => {
  const f = await fixture(t), epoch = "0".repeat(64);
  assert.notEqual(f.enrollment.permission_epoch, epoch);
  f.enrollment.permission_epoch = epoch;
  f.sqlite.prepare("UPDATE memory_live_enrollments SET permission_epoch=?").run(epoch);
  const attempt = createLiveMemoryMaintenanceAttempt(f.env), result = await attempt.resolve(f.enrollment);
  assert.equal(result.status, "denied"); await maintenanceProof(f, attempt, result.certificate);
});

for (const boundary of ["attempt-deadline", "backward-clock", "late-replay"])
  test(`memory maintenance authority: ${boundary} cannot issue denial`, async t => {
    const f = await fixture(t), originalNow = Date.now; t.after(() => { Date.now = originalNow; });
    f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.actorId);
    const started = originalNow(); Date.now = () => started;
    const attempt = createLiveMemoryMaintenanceAttempt(f.env); let replayed = 0;
    if (boundary === "attempt-deadline") Date.now = () => started + 30_000;
    if (boundary === "backward-clock") Date.now = () => started - 1;
    if (boundary === "late-replay") f.hooks.afterBatch = statements => {
      if (maintenanceReplay(statements)) { replayed++; Date.now = () => started + 30_000; }
    };
    assert.deepEqual(await attempt.resolve(f.enrollment), { status: "unavailable" });
    assert.equal(replayed, boundary === "late-replay" ? 1 : 0);
  });

for (const boundary of ["attempt", "enrollment", "backward-clock"])
  test(`memory maintenance authority: issued proof expires at the ${boundary} deadline`, async t => {
    const f = await fixture(t), originalNow = Date.now; t.after(() => { Date.now = originalNow; });
    const started = originalNow(); Date.now = () => started;
    if (boundary === "enrollment") {
      f.enrollment.expires_at = new Date(started + 10_000).toISOString();
      f.sqlite.prepare("UPDATE memory_live_enrollments SET expires_at=?").run(f.enrollment.expires_at);
    }
    const { attempt, certificate } = await maintenanceDenied(f);
    Date.now = () => boundary === "backward-clock" ? started - 1 : started + (boundary === "enrollment" ? 10_000 : 30_000);
    assert.throws(() => attempt.denialPrecommitStatements(f.enrollment, certificate), maintenanceUnavailable);
  });

test("memory maintenance authority: SQL deadline prevents issuance when the JavaScript clock is held behind SQLite", async t => {
  const f = await fixture(t), originalNow = Date.now; t.after(() => { Date.now = originalNow; });
  f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.actorId);
  const earlier = originalNow() - 60_000; Date.now = () => earlier; let checked = 0;
  f.hooks.afterBatch = (statements, results) => {
    if (!maintenanceReplay(statements)) return;
    assert.equal(++checked, 1);
    const deadline = statements.findIndex(statement => statement.sql === "SELECT CASE WHEN (?>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE 0 END AS context_source_current");
    assert.ok(deadline >= 0); assert.deepEqual(statements[deadline].values, [new Date(earlier + 30_000).toISOString()]);
    assert.equal(results[deadline].success, true); assert.equal(results[deadline].results.length, 1);
    assert.equal(results[deadline].results[0].context_source_current, 0, "actual SQLite time has passed the fixed deadline");
  };
  assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "unavailable" });
  assert.equal(checked, 1);
});

for (const boundary of ["cohort", "admins", "late-config", "late-db"])
  test(`memory maintenance authority: ${boundary} drift invalidates the attempt`, async t => {
    const f = await fixture(t); f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.actorId);
    const attempt = createLiveMemoryMaintenanceAttempt(f.env); let replayed = 0;
    if (boundary === "cohort") f.env.FORMA_PILOT_COHORT_ID = "different-cohort";
    if (boundary === "admins") f.env.FORMA_ADMIN_EMAILS = "different-admin@example.test";
    if (boundary === "late-config" || boundary === "late-db") f.hooks.afterBatch = statements => {
      if (!maintenanceReplay(statements)) return;
      replayed++;
      if (boundary === "late-config") f.env.FORMA_ADMIN_EMAILS = "different-admin@example.test";
      else f.env.DB = { ...f.DB };
    };
    assert.deepEqual(await attempt.resolve(f.enrollment), { status: "unavailable" });
    assert.equal(replayed, boundary.startsWith("late-") ? 1 : 0);
  });

test("memory maintenance authority: normalized configuration is stable and operational flags are not authority", async t => {
  const f = await fixture(t);
  f.env.FORMA_PILOT_COHORT_ID = " "; f.env.FORMA_ADMIN_EMAILS = " B@example.test, a@example.test, A@example.test ";
  f.env.FORMA_MEMORY_ENABLED = "false"; f.env.FORMA_MEMORY_USER_IDS = ""; f.env.FORMA_MEMORY_SCHEDULING_ENABLED = "false";
  const current = createLiveMemoryMaintenanceAttempt(f.env);
  f.env.FORMA_PILOT_COHORT_ID = ""; f.env.FORMA_ADMIN_EMAILS = "a@example.test,b@example.test";
  assert.deepEqual(await current.resolve(f.enrollment), { status: "current" });
  const { attempt, certificate } = await maintenanceDenied(f);
  f.env.FORMA_ADMIN_EMAILS = "B@example.test, a@example.test,b@example.test";
  await maintenanceProof(f, attempt, certificate);
});

for (const config of ["FORMA_PILOT_COHORT_ID", "FORMA_ADMIN_EMAILS"])
  test(`memory maintenance authority: issued certificate cannot survive ${config} drift`, async t => {
    const f = await fixture(t), { attempt, certificate } = await maintenanceDenied(f);
    f.env[config] = config === "FORMA_ADMIN_EMAILS" ? "different-admin@example.test" : "different-cohort";
    assert.throws(() => attempt.denialPrecommitStatements(f.enrollment, certificate), maintenanceUnavailable);
  });

test("memory maintenance authority: resolver and proof assembly execute reads without changing persisted data", async t => {
  const f = await fixture(t);
  f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.actorId);
  const tables = ["users", "events", "event_private_payloads", "memory_live_enrollments", "memory_live_sources",
    "memory_live_conversation_segments", "budget_reservations", "cost_budget_reservations", "budget_counters", "cost_budget_counters"];
  const snapshot = () => tables.map(table => [table, f.sqlite.prepare("SELECT * FROM " + table).all()]);
  const before = snapshot(), attempt = createLiveMemoryMaintenanceAttempt(f.env), result = await attempt.resolve(f.enrollment);
  assert.equal(result.status, "denied"); await maintenanceProof(f, attempt, result.certificate);
  assert.deepEqual(snapshot(), before);
  assert.ok(f.trace.length > 0 && f.trace.every(statement => /^\s*(?:SELECT|WITH)/u.test(statement.sql)));
  assert.ok(f.trace.every(statement => !/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/u.test(statement.sql)));
  assert.equal(f.trace.filter(isBridge).length, 0);
});

test("memory maintenance authority: a nonempty legitimate native grant remains current after actual epoch refresh", async t => {
  const f = await fixture(t, { shared: true }), previousEpoch = f.enrollment.permission_epoch, updated = at(-1_000);
  f.insert("capability_grants", {
    grant_id: "maintenance-native-read-grant", user_id: f.actorId, capability: "project.read", scope_type: "project",
    organization_id: f.organizationId, project_access_id: f.projectAccessId, project_id: f.projectId, status: "active",
    granted_by_user_id: f.ownerId, created_at: updated, updated_at: updated, expires_at: at(60_000), revoked_at: null,
  });
  const prepared = await f.prepare(); assert.ok(!(prepared instanceof Response));
  assert.ok(JSON.parse(prepared.principal.authorizationSnapshot.grants).some(grant => grant.capability === "project.read"
    && grant.scope === "project" && grant.organizationId === f.organizationId && grant.projectAccessId === f.projectAccessId));
  f.enrollment.permission_epoch = prepared.principal.access.permissionEpoch;
  assert.notEqual(f.enrollment.permission_epoch, previousEpoch);
  f.sqlite.prepare("UPDATE memory_live_enrollments SET permission_epoch=?").run(f.enrollment.permission_epoch);
  assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "current" });
});

test("memory maintenance authority: a nonempty permissive native identity policy remains current after actual epoch refresh", async t => {
  const f = await fixture(t, { shared: true }), previousEpoch = f.enrollment.permission_epoch;
  f.insert("organization_security_policies", {
    organization_id: f.organizationId, authentication_source: "any", allowed_domains_json: "[]", require_mfa: 0,
    encryption_mode: "platform-unverified", max_session_minutes: 480, version: 1,
    updated_by_user_id: f.ownerId, updated_at: at(-1_000),
  });
  const prepared = await f.prepare(); assert.ok(!(prepared instanceof Response));
  assert.ok(JSON.parse(prepared.principal.authorizationSnapshot.identityPolicies).some(policy => policy.organizationId === f.organizationId
    && policy.authenticationSource === "any" && policy.allowedDomainsJson === "[]" && policy.requireMfa === 0 && policy.version === 1));
  f.enrollment.permission_epoch = prepared.principal.access.permissionEpoch;
  assert.notEqual(f.enrollment.permission_epoch, previousEpoch);
  f.sqlite.prepare("UPDATE memory_live_enrollments SET permission_epoch=?").run(f.enrollment.permission_epoch);
  assert.deepEqual(await createLiveMemoryMaintenanceAttempt(f.env).resolve(f.enrollment), { status: "current" });
});

test("memory maintenance authority: a well-formed restrictive native identity policy yields witnessed denial", async t => {
  const f = await fixture(t, { shared: true }), previousEnrollment = copy(f.enrollment); let observed = 0;
  f.insert("organization_security_policies", {
    organization_id: f.organizationId, authentication_source: "any", allowed_domains_json: "[]", require_mfa: 1,
    encryption_mode: "platform-unverified", max_session_minutes: 480, version: 1,
    updated_by_user_id: f.ownerId, updated_at: at(-1_000),
  });
  f.hooks.afterStatement = (statement, kind, result) => {
    if (kind !== "all" || !maintenancePrincipalQuery(statement)) return;
    observed++; assert.equal(result.success, true); assert.equal(result.results.length, 1);
    assert.ok(JSON.parse(result.results[0].identity_policies_json).some(policy => policy.organizationId === f.organizationId
      && policy.authenticationSource === "any" && policy.requireMfa === 1 && policy.version === 1));
  };
  const attempt = createLiveMemoryMaintenanceAttempt(f.env), result = await attempt.resolve(f.enrollment);
  assert.equal(result.status, "denied"); assert.equal(observed, 2);
  assert.deepEqual(f.enrollment, previousEnrollment);
  await maintenanceProof(f, attempt, result.certificate);
});

// Certified retirement proves the captured original before writes, then the
// exact intended terminal row and the same native denial after those writes.
// Reuse the real fixture batch and source rows as a small rollback footprint;
// caller tests separately exercise complete origin/body/dependency cleanup.
const maintenanceRetirementFields = {
  learn_enabled: 0, recall_enabled: 0, background_enabled: 0,
  lease_token: null, lease_expires_at: null, cutoff_sequence: null,
  failure_code: "access-changed", next_due_at: "9999-12-31T00:00:00.000Z",
};
function maintenanceRetirementExpected(enrollment) {
  const canonical = Object.entries(maintenanceRetirementFields).every(([key, value]) => enrollment[key] === value);
  return { ...enrollment, ...maintenanceRetirementFields, revision: enrollment.revision + (canonical ? 0 : 1) };
}
function maintenanceRetirementUpdate(f, terminal, enrollmentId = f.enrollment.enrollment_id) {
  const columns = Object.keys(terminal);
  return f.DB.prepare("UPDATE memory_live_enrollments SET " + columns.map(column => column + "=?").join(",")
    + " WHERE enrollment_id=?").bind(...columns.map(column => terminal[column]), enrollmentId);
}
function maintenanceRetirementSnapshot(f) {
  return Object.fromEntries(["users", "events", "event_private_payloads", "memory_live_enrollments", "memory_live_sources"]
    .map(table => [table, f.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
}
const maintenanceRetirementDeleteSources = f => f.DB.prepare("DELETE FROM memory_live_sources WHERE enrollment_id=?")
  .bind(f.enrollment.enrollment_id);

for (const shared of [false, true])
  test("memory maintenance retirement: " + (shared ? "shared" : "personal") + " exact terminal transition succeeds in one batch", async t => {
    const f = await fixture(t, { shared });
    Object.assign(f.enrollment, {
      background_enabled: 1, lease_token: "retirement-lease", lease_expires_at: at(20_000),
      cutoff_sequence: f.enrollment.cursor_sequence, attempts: 3, failure_code: "retry",
      last_local_day: "2026-09-01", last_admitted_at: at(-1_000),
    });
    await maintenanceRetirementUpdate(f, f.enrollment).run();
    const original = copy(f.enrollment), { attempt, certificate } = await maintenanceDenied(f);
    const groups = attempt.denialRetirementStatements(f.enrollment, certificate), expected = maintenanceRetirementExpected(original);
    assert.ok(Object.isFrozen(groups)); assert.ok(Object.isFrozen(groups.terminal));
    assert.deepEqual(groups.terminal, expected); assert.deepEqual(f.enrollment, original);
    assert.ok(f.sqlite.prepare("SELECT * FROM memory_live_sources").all().length > 0);
    let batches = 0;
    f.hooks.beforeBatch = () => { batches++; };
    assert.ok((await f.DB.batch([...groups.beforeMutation, maintenanceRetirementDeleteSources(f),
      maintenanceRetirementUpdate(f, groups.terminal), ...groups.afterRetirement])).every(result => result.success === true));
    assert.equal(batches, 1);
    assert.deepEqual({ ...f.sqlite.prepare(maintenanceEnrollmentSql).get(f.enrollment.enrollment_id) }, expected);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM memory_live_sources").all(), []);
    assert.deepEqual(f.enrollment, original);
  });

for (const fault of ["ignored-update", "wrong-flag", "wrong-revision", "unrelated-field", "missing-row"])
  test("memory maintenance retirement: " + fault + " rejects and restores the captured retirement footprint", async t => {
    const f = await fixture(t), { attempt, certificate } = await maintenanceDenied(f);
    const groups = attempt.denialRetirementStatements(f.enrollment, certificate), before = maintenanceRetirementSnapshot(f);
    const wrong = { ...groups.terminal };
    if (fault === "wrong-flag") wrong.recall_enabled = 1;
    if (fault === "wrong-revision") wrong.revision++;
    if (fault === "unrelated-field") wrong.cursor_sequence++;
    const write = fault === "missing-row" ? f.DB.prepare("DELETE FROM memory_live_enrollments WHERE enrollment_id=?").bind(f.enrollment.enrollment_id)
      : maintenanceRetirementUpdate(f, wrong, fault === "ignored-update" ? "missing-retirement-enrollment" : f.enrollment.enrollment_id);
    let written = false, cleaned = false;
    const remove = maintenanceRetirementDeleteSources(f);
    f.hooks.afterStatement = (statement, kind, result) => {
      if (statement === remove || statement === write) assert.equal(kind, "run");
      if (statement === remove) { cleaned = true; assert.ok(result.meta.changes > 0); }
      if (statement === write) { written = true; assert.equal(result.meta.changes, fault === "ignored-update" ? 0 : 1); }
    };
    await assert.rejects(f.DB.batch([...groups.beforeMutation, remove, write, ...groups.afterRetirement]), /malformed JSON/);
    assert.equal(cleaned, true); assert.equal(written, true);
    assert.deepEqual(maintenanceRetirementSnapshot(f), before);
    assert.throws(() => attempt.denialRetirementStatements(f.enrollment, certificate), maintenanceUnavailable);
  });

for (const boundary of ["consent", "document", "absent-principal"])
  test("memory maintenance retirement: late " + boundary + " restoration rolls back the terminal transition", async t => {
    const f = await fixture(t), user = f.sqlite.prepare("SELECT * FROM users WHERE user_id=?").get(f.actorId);
    if (boundary === "consent") f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.actorId);
    if (boundary === "document") f.append("DocumentRemoved", { project_id: f.projectId, document_id: f.documentId });
    if (boundary === "absent-principal") f.sqlite.prepare("DELETE FROM users WHERE user_id=?").run(f.actorId);
    const attempt = createLiveMemoryMaintenanceAttempt(f.env), result = await attempt.resolve(f.enrollment);
    assert.equal(result.status, "denied");
    const groups = attempt.denialRetirementStatements(f.enrollment, result.certificate), before = maintenanceRetirementSnapshot(f);
    const write = maintenanceRetirementUpdate(f, groups.terminal); let restored = 0;
    f.hooks.afterStatement = statement => {
      if (statement !== write) return;
      restored++;
      if (boundary === "consent") f.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run(POLICY_VERSION, f.actorId);
      if (boundary === "document") f.append("DocumentRestored", { project_id: f.projectId, document_id: f.documentId });
      if (boundary === "absent-principal") f.insert("users", user);
      assert.deepEqual({ ...f.sqlite.prepare(maintenanceEnrollmentSql).get(f.enrollment.enrollment_id) }, groups.terminal);
    };
    await assert.rejects(f.DB.batch([...groups.beforeMutation, maintenanceRetirementDeleteSources(f), write, ...groups.afterRetirement]), /malformed JSON/);
    assert.equal(restored, 1); assert.deepEqual(maintenanceRetirementSnapshot(f), before);
  });

for (const change of ["same-revision-drift", "terminal-arrival", "principal-restoration"])
  test("memory maintenance retirement: external " + change + " fails the original proof without undoing that arrival", async t => {
    const f = await fixture(t), { attempt, certificate } = await maintenanceDenied(f);
    const groups = attempt.denialRetirementStatements(f.enrollment, certificate);
    let external = null, attemptedCleanup = false;
    const remove = maintenanceRetirementDeleteSources(f);
    f.hooks.beforeBatch = () => {
      if (change === "same-revision-drift") f.sqlite.prepare("UPDATE memory_live_enrollments SET cursor_sequence=cursor_sequence+1").run();
      if (change === "terminal-arrival") {
        const write = maintenanceRetirementUpdate(f, groups.terminal);
        f.sqlite.prepare(write.sql).run(...write.values);
      }
      if (change === "principal-restoration") f.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id=?").run(POLICY_VERSION, f.actorId);
      external = maintenanceRetirementSnapshot(f);
    };
    f.hooks.beforeStatement = statement => { if (statement === remove) attemptedCleanup = true; };
    await assert.rejects(f.DB.batch([...groups.beforeMutation, remove, maintenanceRetirementUpdate(f, groups.terminal), ...groups.afterRetirement]), /malformed JSON/);
    assert.notEqual(external, null); assert.equal(attemptedCleanup, false);
    assert.deepEqual(maintenanceRetirementSnapshot(f), external);
  });

test("memory maintenance retirement: copied and fabricated certificates do not consume genuine split proof", async t => {
  const f = await fixture(t), { attempt, certificate } = await maintenanceDenied(f);
  for (const forged of [{}, { status: "denied" }, { ...certificate }, structuredClone(certificate),
    Object.create(null, Object.getOwnPropertyDescriptors(certificate)), null])
    assert.throws(() => attempt.denialRetirementStatements(f.enrollment, forged), maintenanceUnavailable);
  const groups = attempt.denialRetirementStatements(f.enrollment, certificate);
  await f.DB.batch([...groups.beforeMutation, maintenanceRetirementUpdate(f, groups.terminal), ...groups.afterRetirement]);
  assert.deepEqual({ ...f.sqlite.prepare(maintenanceEnrollmentSql).get(f.enrollment.enrollment_id) }, maintenanceRetirementExpected(f.enrollment));
});

test("memory maintenance retirement: foreign attempts and replacement database bindings cannot assemble split proof", async t => {
  const f = await fixture(t), other = await fixture(t), { attempt, certificate } = await maintenanceDenied(f);
  for (const foreign of [createLiveMemoryMaintenanceAttempt(f.env), createLiveMemoryMaintenanceAttempt(other.env)])
    assert.throws(() => foreign.denialRetirementStatements(f.enrollment, certificate), maintenanceUnavailable);
  const db = f.env.DB; f.env.DB = { ...db };
  assert.throws(() => attempt.denialRetirementStatements(f.enrollment, certificate), maintenanceUnavailable);
  f.env.DB = db;
  const groups = attempt.denialRetirementStatements(f.enrollment, certificate);
  await f.DB.batch([...groups.beforeMutation, maintenanceRetirementUpdate(f, groups.terminal), ...groups.afterRetirement]);
});

test("memory maintenance retirement: full original input cannot be retargeted before split assembly", async t => {
  const f = await fixture(t), { attempt, certificate } = await maintenanceDenied(f);
  for (const change of [{ revision: f.enrollment.revision + 1 }, { cursor_sequence: f.enrollment.cursor_sequence + 1 },
    { lease_token: "another-lease", lease_expires_at: at(20_000) }, { recall_enabled: 0 },
    { actor_user_id: "another-actor", owner_user_id: "another-actor" }, { document_id: "another-document" }])
    assert.throws(() => attempt.denialRetirementStatements({ ...f.enrollment, ...change }, certificate), maintenanceUnavailable);
  const groups = attempt.denialRetirementStatements(f.enrollment, certificate);
  await f.DB.batch([...groups.beforeMutation, maintenanceRetirementUpdate(f, groups.terminal), ...groups.afterRetirement]);
});

for (const first of ["legacy", "retirement"])
  test("memory maintenance retirement: " + first + " assembly consumes the certificate across both APIs", async t => {
    const f = await fixture(t), { attempt, certificate } = await maintenanceDenied(f);
    const prepared = first === "legacy" ? attempt.denialPrecommitStatements(f.enrollment, certificate)
      : attempt.denialRetirementStatements(f.enrollment, certificate);
    assert.throws(() => attempt.denialPrecommitStatements(f.enrollment, certificate), maintenanceUnavailable);
    assert.throws(() => attempt.denialRetirementStatements(f.enrollment, certificate), maintenanceUnavailable);
    await f.DB.batch(first === "legacy" ? prepared
      : [...prepared.beforeMutation, maintenanceRetirementUpdate(f, prepared.terminal), ...prepared.afterRetirement]);
    assert.deepEqual({ ...f.sqlite.prepare(maintenanceEnrollmentSql).get(f.enrollment.enrollment_id) },
      first === "legacy" ? f.enrollment : maintenanceRetirementExpected(f.enrollment));
  });

for (const boundary of ["attempt", "enrollment", "backward-clock"])
  test("memory maintenance retirement: split assembly rejects the " + boundary + " deadline", async t => {
    const f = await fixture(t), originalNow = Date.now; t.after(() => { Date.now = originalNow; });
    const started = originalNow(); Date.now = () => started;
    if (boundary === "enrollment") {
      f.enrollment.expires_at = new Date(started + 10_000).toISOString();
      f.sqlite.prepare("UPDATE memory_live_enrollments SET expires_at=?").run(f.enrollment.expires_at);
    }
    const { attempt, certificate } = await maintenanceDenied(f), before = maintenanceRetirementSnapshot(f);
    Date.now = () => boundary === "backward-clock" ? started - 1 : started + (boundary === "enrollment" ? 10_000 : 30_000);
    assert.throws(() => attempt.denialRetirementStatements(f.enrollment, certificate), maintenanceUnavailable);
    assert.deepEqual(maintenanceRetirementSnapshot(f), before);
  });

test("memory maintenance retirement: terminal SQL deadline rolls back writes under a synthetic fixture-local clock", async t => {
  const f = await fixture(t), originalNow = Date.now; t.after(() => { Date.now = originalNow; });
  const started = originalNow(); Date.now = () => started;
  const { attempt, certificate } = await maintenanceDenied(f);
  const groups = attempt.denialRetirementStatements(f.enrollment, certificate), before = maintenanceRetirementSnapshot(f);
  const write = maintenanceRetirementUpdate(f, groups.terminal);
  let afterWrite = false, checkedOriginalDeadline = false, checkedTerminalDeadline = false;
  // Override only the two-argument now signature used by this proof. This tests
  // the real SQL deadline assertion deterministically, not real elapsed time.
  f.sqlite.function("strftime", (format, modifier) => {
    assert.equal(format, "%Y-%m-%dT%H:%M:%fZ"); assert.equal(modifier, "now");
    if (afterWrite) checkedTerminalDeadline = true; else checkedOriginalDeadline = true;
    return new Date(started + (afterWrite ? 30_000 : 0)).toISOString();
  });
  f.hooks.afterStatement = statement => { if (statement === write) afterWrite = true; };
  await assert.rejects(f.DB.batch([...groups.beforeMutation, maintenanceRetirementDeleteSources(f), write, ...groups.afterRetirement]), /malformed JSON/);
  assert.equal(afterWrite, true); assert.equal(checkedOriginalDeadline, true); assert.equal(checkedTerminalDeadline, true);
  assert.deepEqual(maintenanceRetirementSnapshot(f), before);
});

for (const revision of [7, Number.MAX_SAFE_INTEGER])
  test("memory maintenance retirement: canonical terminal revision " + revision + " is a proven no-op", async t => {
    const f = await fixture(t);
    Object.assign(f.enrollment, maintenanceRetirementFields, { revision });
    await maintenanceRetirementUpdate(f, f.enrollment).run();
    const { attempt, certificate } = await maintenanceDenied(f), before = maintenanceRetirementSnapshot(f);
    const groups = attempt.denialRetirementStatements(f.enrollment, certificate);
    assert.deepEqual(groups.terminal, f.enrollment); assert.equal(groups.terminal.revision, revision);
    await f.DB.batch([...groups.beforeMutation, ...groups.afterRetirement]);
    assert.deepEqual(maintenanceRetirementSnapshot(f), before);
  });

test("memory maintenance retirement: noncanonical all-off enrollment canonicalizes exactly once", async t => {
  const f = await fixture(t);
  Object.assign(f.enrollment, { learn_enabled: 0, recall_enabled: 0, background_enabled: 0 });
  await maintenanceRetirementUpdate(f, f.enrollment).run();
  const { attempt, certificate } = await maintenanceDenied(f), groups = attempt.denialRetirementStatements(f.enrollment, certificate);
  assert.equal(groups.terminal.revision, f.enrollment.revision + 1);
  assert.deepEqual(groups.terminal, maintenanceRetirementExpected(f.enrollment));
  await f.DB.batch([...groups.beforeMutation, maintenanceRetirementUpdate(f, groups.terminal), ...groups.afterRetirement]);
  const terminal = { ...f.sqlite.prepare(maintenanceEnrollmentSql).get(f.enrollment.enrollment_id) };
  const next = createLiveMemoryMaintenanceAttempt(f.env), denial = await next.resolve(terminal);
  assert.equal(denial.status, "denied");
  const repeated = next.denialRetirementStatements(terminal, denial.certificate);
  assert.deepEqual(repeated.terminal, terminal);
  const before = maintenanceRetirementSnapshot(f);
  await f.DB.batch([...repeated.beforeMutation, ...repeated.afterRetirement]);
  assert.deepEqual(maintenanceRetirementSnapshot(f), before);
});

test("memory maintenance retirement: required revision overflow rejects without consuming the legacy proof", async t => {
  const f = await fixture(t); f.enrollment.revision = Number.MAX_SAFE_INTEGER;
  await maintenanceRetirementUpdate(f, f.enrollment).run();
  const { attempt, certificate } = await maintenanceDenied(f), before = maintenanceRetirementSnapshot(f);
  assert.throws(() => attempt.denialRetirementStatements(f.enrollment, certificate), maintenanceUnavailable);
  assert.deepEqual(maintenanceRetirementSnapshot(f), before);
  await maintenanceProof(f, attempt, certificate);
  assert.deepEqual(maintenanceRetirementSnapshot(f), before);
});

test("memory maintenance retirement: factory authenticity is bound to the original environment object", async t => {
  const { liveMemoryMaintenanceAttemptFor } = await import("../worker/memory-live-authority.ts");
  const f = await fixture(t), other = await fixture(t), attempt = createLiveMemoryMaintenanceAttempt(f.env);
  assert.equal(liveMemoryMaintenanceAttemptFor(f.env, attempt), true);
  for (const lookalike of [{ ...attempt }, Object.create(Object.getPrototypeOf(attempt), Object.getOwnPropertyDescriptors(attempt)),
    Object.create(attempt), Object.freeze({}), null])
    assert.equal(liveMemoryMaintenanceAttemptFor(f.env, lookalike), false);
  assert.equal(liveMemoryMaintenanceAttemptFor(other.env, attempt), false);
  assert.equal(liveMemoryMaintenanceAttemptFor({ ...f.env }, attempt), false);
  assert.equal(liveMemoryMaintenanceAttemptFor(f.env, createLiveMemoryMaintenanceAttempt(other.env)), false);
  assert.equal(liveMemoryMaintenanceAttemptFor(f.env, attempt), true);
});

// Test-only successor: the accepted77-case source above is an unchanged prefix.
// Real supported grants are deliberately redundant with accepted membership:
// their actual raw and filtered authority snapshots still constrain the lease.
// Date.now advancement is a deterministic request-clock seam, not a replacement
// for native SQLite authorization or a claim of hosted clock qualification.
const { PRINCIPAL_WITH_ACCESS_SQL } = await import("../worker/access-policy.ts");
const { liveMemoryAuthority: genuineLiveMemoryAuthority } = await import("../worker/memory-live-authority.ts");
const originalGrantSchemaBoundary = "SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN"
  + "('memory_live_enrollments','memory_live_sources','memory_live_runs','memory_live_conversation_segments'))=4"
  + " AND EXISTS(SELECT 1 FROM pragma_table_info('memory_live_sources') WHERE name='conversation_segmented'"
  + " AND type='INTEGER' AND \"notnull\"=1) THEN 1 ELSE 0 END AS ready";

async function freshGrantEnrollment(f) {
  const prepared = await f.prepare();
  assert.ok(!(prepared instanceof Response), prepared instanceof Response ? await prepared.text() : undefined);
  const priorRevision = f.enrollment.revision;
  Object.assign(f.enrollment, { permission_epoch: prepared.principal.access.permissionEpoch, revision: priorRevision + 1 });
  const changed = f.sqlite.prepare("UPDATE memory_live_enrollments SET permission_epoch=?,revision=? WHERE enrollment_id=? AND revision=?")
    .run(f.enrollment.permission_epoch, f.enrollment.revision, f.enrollment.enrollment_id, priorRevision);
  assert.equal(changed.changes, 1);
  return prepared;
}

async function expiringGrantFixture(t) {
  const f = await fixture(t, { shared: true }), expiresAt = at(20_000), grantedAt = at(-1_000);
  const grant = { grant_id: "consumption-expiring-grant-A", user_id: f.actorId, capability: "project.read", scope_type: "project",
    organization_id: f.organizationId, project_access_id: f.projectAccessId, project_id: f.projectId, status: "active",
    granted_by_user_id: f.ownerId, created_at: grantedAt, updated_at: grantedAt, expires_at: expiresAt, revoked_at: null };
  f.insert("capability_grants", grant);
  const prepared = await freshGrantEnrollment(f);
  assert.equal(prepared.principal.access.grants.length, 1, "supported real grant survives native capability filtering");
  assert.equal(prepared.principal.access.grants[0].expiresAt, expiresAt);
  assert.equal(JSON.parse(prepared.principal.authorizationSnapshot.grants)[0].expiresAt, expiresAt);
  f.trace.length = 0;
  return { f, grant, expiresAt, prepared };
}

function replaceAfterOuterGrant(t, state) {
  const { f, grant, expiresAt } = state, dateNow = Date.now;
  const laterAt = new Date(Date.parse(expiresAt) + 120_000).toISOString();
  let originalEnrollmentRead = false, fired = 0;
  const outerRows = [], subsequentRows = [];
  f.hooks.afterBatch = statements => {
    if (statements.length === 1 && statements[0].sql === snapshotSql) originalEnrollmentRead = true;
  };
  f.hooks.afterStatement = (statement, kind, result) => {
    if (kind === "first" && statement.sql === PRINCIPAL_WITH_ACCESS_SQL && originalEnrollmentRead) {
      (fired ? subsequentRows : outerRows).push(copy(result));
    }
  };
  f.hooks.beforeStatement = (statement, kind) => {
    if (kind !== "first" || statement.sql !== originalGrantSchemaBoundary || fired) return;
    // This is the first awaited statement inside readNativeDocumentMemory,
    // reached only after the outer liveMemoryAuthority call has returned.
    assert.equal(outerRows.length, 1, "exact original native principal query after the enrollment snapshot");
    assert.equal(JSON.parse(outerRows[0].grants_json)[0].expiresAt, expiresAt);
    fired++;
    const crossedAt = Date.parse(expiresAt) + 1;
    Date.now = () => crossedAt;
    f.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=?,updated_at=? WHERE grant_id=?")
      .run(new Date(crossedAt).toISOString(), new Date(crossedAt).toISOString(), grant.grant_id);
    f.insert("capability_grants", { ...grant, grant_id: "consumption-replacement-grant-B",
      expires_at: laterAt, created_at: new Date(crossedAt).toISOString(), updated_at: new Date(crossedAt).toISOString() });
  };
  const release = () => {
    f.hooks.beforeStatement = null; f.hooks.afterStatement = null; f.hooks.afterBatch = null; Date.now = dateNow;
  };
  t.after(release);
  const assertObserved = () => {
    assert.equal(fired, 1, "replacement occurs after completed original authority, not inside its async digest");
    assert.equal(outerRows.length, 1);
    assert.equal(subsequentRows.length, 1, "native context actually rereads the now-current database principal");
    const laterGrants = JSON.parse(subsequentRows[0].grants_json);
    assert.equal(laterGrants.length, 1); assert.equal(laterGrants[0].expiresAt, laterAt);
    assert.ok(Date.parse(expiresAt) < Date.now() && Date.now() < Date.parse(laterAt));
    assert.equal(f.trace.filter(isBridge).length, 0, "changed native authority rejects before an optional projection can be certified");
  };
  return { release, assertObserved, laterAt };
}

test("live consumption grant regression: genuine still-current project grant bounds the complete optional response", async t => {
  const { f, expiresAt, prepared } = await expiringGrantFixture(t);
  const authority = await genuineLiveMemoryAuthority(f.env, f.enrollment);
  assert.ok(authority); assert.equal(authority.principal.access.permissionEpoch, prepared.principal.access.permissionEpoch);
  assert.equal(authority.principal.access.grants[0].expiresAt, expiresAt);
  const value = await apiValue(await apiRequest(f));
  assert.equal(value.lifetime.validUntil, expiresAt);
  assert.equal(value.consumptionEpisodes.validUntil, expiresAt);
  assert.equal(value.consumptionEpisodes.episodes[0].validUntil, expiresAt);
  assert.equal(f.trace.filter(isBridge).length, 2);
});

test("live consumption grant regression: expired original grant cannot be rescued by a later native replacement", async t => {
  const state = await expiringGrantFixture(t), replacement = replaceAfterOuterGrant(t, state);
  await apiError(await apiRequest(state.f)); replacement.assertObserved();
  assert.equal(state.f.sqlite.prepare("SELECT status FROM capability_grants WHERE grant_id=?").get(state.grant.grant_id).status, "revoked");
  assert.equal(state.f.sqlite.prepare("SELECT COUNT(*) AS n FROM capability_grants WHERE status='active'").get().n, 1);
  // Replacement changes recognized-grant epoch and raw snapshot as well as the
  // original deadline. Denial is not attributed exclusively to the deadline.
});

test("live consumption grant regression: a fresh authenticated fixture revision can use the legitimate replacement", async t => {
  const state = await expiringGrantFixture(t), { f, prepared } = state, replacement = replaceAfterOuterGrant(t, state);
  await apiError(await apiRequest(f)); replacement.assertObserved(); replacement.release();
  const oldEpoch = prepared.principal.access.permissionEpoch, oldRevision = f.enrollment.revision;
  // Explicit synthetic enrollment succession only. The actual request principal
  // and document authority are prepared anew; no old grant is retagged as new.
  // This is not an enrollment API or real-user consent exercise.
  const fresh = await freshGrantEnrollment(f);
  assert.notEqual(fresh.principal.access.permissionEpoch, oldEpoch);
  assert.equal(f.enrollment.revision, oldRevision + 1);
  assert.equal(fresh.principal.access.grants[0].expiresAt, replacement.laterAt);
  const authority = await genuineLiveMemoryAuthority(f.env, f.enrollment);
  assert.ok(authority); assert.equal(authority.principal.access.permissionEpoch, fresh.principal.access.permissionEpoch);
  f.trace.length = 0;
  const value = await apiValue(await apiRequest(f));
  assert.equal(value.consumptionEpisodes.episodes.length, 1);
  assert.equal(f.trace.filter(isBridge).length, 2);
  assert.ok(Date.parse(value.lifetime.validUntil) <= Date.parse(replacement.laterAt));
});

test("live consumption grant regression: raw-filtered outer grant replacement cannot publish after final replay", async t => {
  const f = await fixture(t), dateNow = Date.now, shortAt = at(20_000), laterAt = at(180_000), oldAt = at(-120_000);
  t.after(() => { Date.now = dateNow; });
  // This deliberately mismatched legacy/adversarial row is selected by native
  // grants_json but excluded from access.grants (project.read is not self-scoped).
  // It confers no capability. Native admission nevertheless binds its exact raw
  // snapshot and deadline, including a same-timestamp replacement invisible to
  // the filtered capability fingerprint. No authenticated object is fabricated.
  f.insert("capability_grants", { grant_id: "consumption-filtered-raw-grant", user_id: f.actorId,
    capability: "project.read", scope_type: "self", organization_id: null, project_access_id: null, project_id: null,
    status: "active", granted_by_user_id: f.actorId, created_at: oldAt, updated_at: oldAt,
    expires_at: laterAt, revoked_at: null });
  const fresh = await f.prepare(); assert.ok(!(fresh instanceof Response));
  assert.deepEqual(fresh.principal.access.grants, []);
  assert.equal(JSON.parse(fresh.principal.authorizationSnapshot.grants)[0].expiresAt, laterAt);
  assert.equal(fresh.principal.access.permissionEpoch, f.enrollment.permission_epoch);
  const live = await genuineLiveMemoryAuthority(f.env, f.enrollment);
  assert.ok(live); assert.deepEqual(live.principal.access.grants, []);
  assert.equal(JSON.parse(live.principal.authorizationSnapshot.grants)[0].expiresAt, laterAt);
  f.trace.length = 0;
  let snapshotReads = 0, boundaryFired = 0, finalReplay = 0;
  const outerRows = [], laterRows = [], finalOriginalGuards = [];
  f.hooks.afterBatch = (statements, results) => {
    if (statements.length === 1 && statements[0].sql === snapshotSql) {
      assert.equal(++snapshotReads, 1);
      assert.equal(results[0].results[0].permission_epoch, f.enrollment.permission_epoch);
      f.sqlite.prepare("UPDATE capability_grants SET expires_at=? WHERE grant_id='consumption-filtered-raw-grant'").run(shortAt);
    }
    if (statements.length > 1 && statements[0].sql === snapshotSql) {
      assert.equal(++finalReplay, 1); assert.equal(statements.filter(isBridge).length, 1);
      assert.ok(results.every(result => result.success), "the complete actual SQL replay executes");
      for (const [index, statement] of statements.entries()) {
        if (statement.sql.endsWith(" AS context_source_current") && statement.values.some(value =>
          typeof value === "string" && value.includes('"expiresAt":"' + shortAt + '"')))
          finalOriginalGuards.push(results[index].results[0].context_source_current);
      }
    }
  };
  f.hooks.afterStatement = (statement, kind, result) => {
    if (kind === "first" && statement.sql === PRINCIPAL_WITH_ACCESS_SQL && snapshotReads)
      (boundaryFired ? laterRows : outerRows).push(copy(result));
  };
  f.hooks.beforeStatement = (statement, kind) => {
    if (kind !== "first" || statement.sql !== originalGrantSchemaBoundary || boundaryFired) return;
    assert.equal(outerRows.length, 1);
    assert.equal(JSON.parse(outerRows[0].grants_json)[0].expiresAt, shortAt);
    boundaryFired++;
    // Restore the request's still-current B only after the original authority A
    // has returned. Both the later native context and its request guard can now
    // succeed, so this must exercise the outer optional-proof boundary itself.
    f.sqlite.prepare("UPDATE capability_grants SET expires_at=? WHERE grant_id='consumption-filtered-raw-grant'").run(laterAt);
    const crossedAt = Date.parse(shortAt) + 1; Date.now = () => crossedAt;
  };
  await apiError(await apiRequest(f));
  assert.equal(snapshotReads, 1); assert.equal(boundaryFired, 1);
  assert.equal(laterRows.length, 1); assert.equal(JSON.parse(laterRows[0].grants_json)[0].expiresAt, laterAt);
  assert.equal(f.trace.filter(isBridge).length, 2, "real native context, bridge and its exact final replay were reached");
  assert.equal(finalReplay, 1); assert.deepEqual(finalOriginalGuards, [0], "original raw authority rejects restored B");
  const databaseAt = f.sqlite.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now").get().now;
  assert.ok(Date.parse(databaseAt) < Date.parse(shortAt), "SQLite keeps its real clock; this test advances only request Date.now");
  assert.ok(Date.parse(shortAt) < Date.now() && Date.now() < Date.parse(laterAt));
  // Final denial has both an invalid original raw guard and an elapsed captured
  // request-clock deadline. It does not uniquely attribute rejection to either.
});


// Legacy-original receipt seam only. These are producer-equivalent persisted
// snapshots, not executions of a paid chat producer, enrollment or S1 publication.
const { captureLegacyConversationOriginals,replayLegacyConversationOriginals } = await import("../worker/events-api.ts");
const { createHash: legacyOriginalHash } = await import("node:crypto");
const legacyOriginalDigest = text => legacyOriginalHash("sha256").update(text,"utf8").digest("hex");

async function legacyOriginalFixture(t,{shared=false,pairs=1,texts=null,eventSeed=null}={}) {
  let state;const ownedJobs=[];
  // Dispose only this fixture's explicitly registered synthetic job rows. The
  // original cleanup callback and its zero-paid-work assertions remain intact;
  // an unowned job still fails them. Setup/teardown are not reader operations.
  const local={after:callback=>t.after(()=>{
    try{if(state)for(const jobId of ownedJobs)state.sqlite.prepare("DELETE FROM document_jobs WHERE job_id=?").run(jobId);}
    finally{callback();}
  })};
  const f=state=await fixture(local,{shared,visits:0,remember:false});
  const stream="creative:"+f.ownerId,created=at(-8_000),expiry=at(180_000),rows=[];let chronology=0;
  const firstHead=f.sqlite.prepare("SELECT MAX(sequence) AS sequence FROM events WHERE stream_id=?").get(stream).sequence;
  function event(type,payload,{id,actor,correlation,causation=null}={}) {
    const envelope=publicEventPayload(id,payload,true);
    let secret;
    const row=f.append(type,payload,{eventId:id,actor,correlationId:correlation,causationId:causation,
      custody:false,recordedAt:at(-7_000+chronology++),rawPublic:JSON.stringify(envelope.payload),beforeInsert:draft=>{
        secret={private_event_id:id,owner_id:f.ownerId,project_id:payload.project_id??null,
          document_id:payload.document_id??null,private_json:envelope.privateJson,created_at:draft.recorded_at,redacted_at:null};
        return eventSeed?.(draft,secret);
      }});
    assert.equal(typeof envelope.privateJson,"string","actual event writer forces even safe payloads into a private envelope");
    f.insert("event_private_payloads",secret);
    if(shared)f.insert("project_event_scopes",{event_id:row.event_id,project_access_id:f.projectAccessId,organization_id:f.organizationId,
      project_id:f.projectId,owner_user_id:f.ownerId,source_stream_id:stream,source_sequence:row.sequence,project_sequence:row.sequence,
      actor_user_id:f.actorId,created_at:row.recorded_at});
    return row;
  }
  function body(id,role,text) {
    const bodyCreated=at(-7_000+chronology++);
    f.insert("private_content",{content_id:id,owner_id:f.actorId,kind:`chat-${role}`,content:text,created_at:bodyCreated,expires_at:expiry,redacted_at:null});
    if(shared){
      f.insert("project_resource_scopes",{project_access_id:f.projectAccessId,resource_kind:"content",resource_id:id,
        organization_id:f.organizationId,project_id:f.projectId,owner_user_id:f.ownerId,visibility:"actor_private",
        source_event_id:null,actor_user_id:f.actorId,created_at:bodyCreated});
      f.insert("private_content_retention_scopes",{content_id:id,organization_id:f.organizationId,project_access_id:f.projectAccessId,
        project_id:f.projectId,actor_user_id:f.actorId,classification:"transient-private",policy_version:0,assigned_expires_at:expiry,created_at:bodyCreated});
    }
    return {id,role,text,expiry};
  }
  for(let index=0;index<pairs;index++){
    const turnId=`legacy-original-turn-${index}`,jobId=`legacy-original-job-${index}`,correlation=shared?jobId:`legacy-original-correlation-${index}`;
    const supplied=texts?.[index]??[`Exact user ${index}: 🧭 é ${"long source ".repeat(60)} END-USER-${index}`,
      `  Exact assistant ${index}: 🌍 ${"retained answer ".repeat(45)} END-ASSISTANT-${index}  `];
    if(shared){
      const requested=f.sqlite.prepare("SELECT MAX(sequence) AS sequence FROM events WHERE stream_id=?").get(stream).sequence;
      f.insert("document_jobs",{job_id:jobId,owner_id:f.actorId,stream_id:stream,document_id:f.documentId,kind:"chat",status:"completed",
        source_surface:"chat",correlation_id:correlation,requested_sequence:requested,request_json:JSON.stringify({message:supplied[0],livePreview:false}),
        result_json:"{}",error_message:null,attempt_count:1,requested_at:created,started_at:created,completed_at:at(-6_000),
        lease_expires_at:null,notified_at:null,expires_at:expiry,updated_at:at(-6_000)});
      ownedJobs.push(jobId);
      const anchor=event("ProjectDocumentJobQueued",{job_id:jobId,document_id:f.documentId,kind:"chat",organization_id:f.organizationId,
        project_access_id:f.projectAccessId,project_id:f.projectId,history_owner_user_id:f.ownerId,actor_user_id:f.actorId},
        {id:`legacy-original-anchor-${index}`,actor:`user:${f.actorId}`,correlation:jobId});
      f.insert("project_resource_scopes",{project_access_id:f.projectAccessId,resource_kind:"job",resource_id:jobId,
        organization_id:f.organizationId,project_id:f.projectId,owner_user_id:f.ownerId,visibility:"actor_private",
        source_event_id:anchor.event_id,actor_user_id:f.actorId,created_at:created});
    }
    assert.equal(supplied[0],supplied[0].trim(),"legacy producer stores the trimmed user request");
    assert.ok(supplied[0].length<=4000,"legacy producer's authored request limit");
    const user=body(`legacy-original-user-${index}`,"user",supplied[0]);
    const budget=event("BudgetReserved",{operation:"creative-chat",reservation_id:`historical-budget-${index}`,
      cost_reservation_id:`historical-cost-${index}`,reserved_tokens:12000,reserved_microusd:1,period:"2026-09",live_preview:false},
      {id:`legacy-original-budget-${index}`,actor:"worker:policy",correlation});
    const authored=event("ChatMessageSent",{turn_id:turnId,document_id:f.documentId,content_ref:user.id,
      content_expires_at:expiry,source_surface:"chat",live_preview:false},
      {id:`legacy-original-message-${index}`,actor:shared?`user:${f.actorId}`:"user",correlation,causation:budget.event_id});
    const assistant=body(`legacy-original-assistant-${index}`,"assistant",supplied[1]);
    const answered=event("AssistantReasoned",{operation:"creative-chat",turn_id:turnId,document_id:f.documentId,content_ref:assistant.id,
      content_expires_at:expiry,provider:"openai",provider_response_id:`historical-response-${index}`,model_id:"historical-model",
      latency_ms:1,mutation_count:0,reference_pixel_mutation_count:0,preview_worthy:false,live_preview_requested:false,
      preview_queued:false,preview_direction_ref:null,preview_suppressed:false},
      {id:`legacy-original-answer-${index}`,actor:"model:forma-chat",correlation,causation:authored.event_id});
    rows.push({turnId,correlation,jobId:shared?jobId:null,budget,user:{...user,event:authored},assistant:{...assistant,event:answered}});
  }
  // Actual caller preparation may synchronize shared state. It is deliberately
  // outside the captured read footprint and not performed by either new API.
  const current=await f.prepare();assert.ok(!(current instanceof Response));
  assert.equal(current.principal.userId,f.actorId);
  const interval={afterSequence:firstHead,throughSequence:rows.at(-1)?.assistant.event.sequence??firstHead};
  const tracked=["events","event_private_payloads","private_content","document_jobs","project_resource_scopes",
    "private_content_retention_scopes","project_event_scopes","assistant_turns","budget_reservations","cost_budget_reservations",
    "consequential_executions","memory_live_sources","memory_live_enrollments"];
  const footprint=()=>Object.fromEntries(tracked.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
  Object.assign(f,{current,interval,rows,stream,expiry,event,footprint,
    capture:()=>captureLegacyConversationOriginals(f.env,f.current,f.interval),
    replay:handle=>replayLegacyConversationOriginals(f.env,f.current,handle)});
  f.trace.length=0;return f;
}
function assertLegacyOriginalReceipt(f,value,handle) {
  assert.ok(value);assert.equal(value.method,"native-legacy-originals-v1");assert.equal(value.treatment,"untrusted-historical-evidence");
  assert.equal(value.completeFromStart,false);assert.deepEqual(value.interval,f.interval);
  assert.deepEqual(value.scope,{actorUserId:f.actorId,ownerUserId:f.ownerId,streamId:f.stream,projectId:f.projectId,documentId:f.documentId,
    organizationId:f.current.binding.scope?.organizationId??null,projectAccessId:f.current.binding.scope?.projectAccessId??null});
  const expected=f.rows.flatMap(row=>[row.user,row.assistant].map(source=>({eventId:source.event.event_id,sequence:source.event.sequence,
    turnId:row.turnId,role:source.role,actor:source.event.actor,correlationId:row.correlation,causationId:source.event.causation_id,
    contentRef:source.id,text:source.text,contentHash:legacyOriginalDigest(source.text),occurredAt:source.event.occurred_at,
    recordedAt:source.event.recorded_at,expiresAt:source.expiry})));
  assert.deepEqual(value.originals,expected);
  assert.ok(Date.parse(value.checkedAt)<Date.parse(value.validUntil));assert.ok(Date.parse(value.validUntil)<=Date.parse(handle.validUntil));
  for(const source of expected)assert.ok(Date.parse(value.validUntil)<=Date.parse(source.expiresAt));
  assert.doesNotMatch(JSON.stringify(value),/"(?:record|annotations|ledgerRevision|memoryAccess|accepted|sql|bindings)"\s*:/u);
}
function legacyOriginalReadOnly(f,before) {
  assert.deepEqual(f.footprint(),before,"capture/replay do not mutate seeded jobs, bodies, events, custody, memory or financial rows");
  assert.ok(f.trace.length>0);assert.ok(f.trace.every(row=>/^\s*(?:SELECT|WITH)/iu.test(row.sql)),"only actual read statements were issued");
}
function legacyOriginalPayload(event,secret,change,{publicOnly=false,privateOnly=false}={}) {
  for(const [row,column] of [[event,"payload"],[secret,"private_json"]]){
    if(row===event&&privateOnly||row===secret&&publicOnly)continue;
    const value=JSON.parse(row[column]);change(value);row[column]=JSON.stringify(value);
  }
}
function legacyOriginalPrivatePayload(f,eventId,change) {
  const value=JSON.parse(f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(eventId).private_json);
  change(value);f.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(value),eventId);
}

for(const shared of [false,true])test(`legacy original receipts: ${shared?"shared viewer":"personal"} real per-role originals retain full Unicode and read-only custody`,async t=>{
  const f=await legacyOriginalFixture(t,{shared,pairs:2}),before=f.footprint();
  assert.equal(before.assistant_turns.length,0,"legacy originals have no modern assistant_turn row");
  if(shared){
    assert.equal(f.sqlite.prepare("SELECT role FROM project_memberships WHERE user_id=?").get(f.actorId).role,"viewer");
    assert.equal(before.document_jobs.length,2);
    for(const row of f.rows){
      assert.equal(f.sqlite.prepare("SELECT actor_user_id FROM project_event_scopes WHERE event_id=?").get(row.assistant.event.event_id).actor_user_id,f.actorId);
      assert.equal(f.sqlite.prepare("SELECT owner_id FROM event_private_payloads WHERE private_event_id=?").get(row.assistant.event.event_id).owner_id,f.ownerId);
    }
  }
  const handle=await f.capture();assert.ok(handle);assert.deepEqual(Object.keys(handle).sort(),["method","validUntil"]);
  assert.throws(()=>{handle.validUntil=at(86_400_000);},TypeError);
  for(const row of f.rows)assert.equal(JSON.stringify(handle).includes(row.user.text),false);
  const first=await f.replay(handle);assertLegacyOriginalReceipt(f,first,handle);
  const again=await f.replay(handle);assertLegacyOriginalReceipt(f,again,handle);
  assert.deepEqual(again.originals,first.originals);assert.ok(Date.parse(again.validUntil)<=Date.parse(handle.validUntil));
  assert.ok(first.originals.every(row=>Array.from(row.text).length>512));
  assert.equal(first.originals[1].text.startsWith("  "),true);assert.equal(first.originals[1].text.endsWith("  "),true);
  legacyOriginalReadOnly(f,before);
});

test("legacy original receipts: missing, repointed, redacted and expired per-role bytes invalidate the whole selected interval",async t=>{
  for(const role of ["user","assistant"])for(const boundary of ["missing-body","redacted-body","expired-body","body-owner","body-kind",
    "repointed-content","missing-secret","redacted-secret","secret-owner","secret-document","secret-project","secret-ref","secret-created"]){
    const f=await legacyOriginalFixture(t,{eventSeed:(event,secret)=>{
      if(event.type!==(role==="user"?"ChatMessageSent":"AssistantReasoned"))return;
      if(boundary==="repointed-content")legacyOriginalPayload(event,secret,payload=>{payload.content_ref="missing-replacement";});
      if(boundary==="secret-ref")legacyOriginalPayload(event,secret,payload=>{payload._private_ref="wrong-private-id";},{publicOnly:true});
    }}),source=f.rows[0][role];
    if(boundary==="missing-body")f.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(source.id);
    if(boundary==="redacted-body")f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(at(-1),source.id);
    if(boundary==="expired-body")f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(at(-1),source.id);
    if(boundary==="body-owner")f.sqlite.prepare("UPDATE private_content SET owner_id='other-actor' WHERE content_id=?").run(source.id);
    if(boundary==="body-kind")f.sqlite.prepare("UPDATE private_content SET kind='provider-output' WHERE content_id=?").run(source.id);
    if(boundary==="missing-secret")f.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(source.event.event_id);
    if(boundary==="redacted-secret")f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(at(-1),source.event.event_id);
    if(boundary==="secret-owner")f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='other-owner' WHERE private_event_id=?").run(source.event.event_id);
    if(boundary==="secret-document")f.sqlite.prepare("UPDATE event_private_payloads SET document_id='other-document' WHERE private_event_id=?").run(source.event.event_id);
    if(boundary==="secret-project")f.sqlite.prepare("UPDATE event_private_payloads SET project_id='other-project' WHERE private_event_id=?").run(source.event.event_id);
    if(boundary==="secret-created")f.sqlite.prepare("UPDATE event_private_payloads SET created_at=? WHERE private_event_id=?").run(at(-2_000),source.event.event_id);
    const before=f.footprint();assert.equal(await f.capture(),null,`${role}: ${boundary}`);legacyOriginalReadOnly(f,before);
  }
});

test("legacy original receipts: exact actor, operation, chronology and linked budget/user identities are mandatory",async t=>{
  for(const boundary of ["user-actor","assistant-actor","assistant-operation","turn-id","correlation","assistant-cause","user-cause",
    "budget-operation","budget-correlation","budget-actor","budget-client","assistant-client","event-expiry","future-event","foreign-stream","mixed-document","public-private-disagreement"]){
    const f=await legacyOriginalFixture(t,{pairs:boundary==="foreign-stream"?2:1,eventSeed:(event,secret)=>{
      if(event.type==="ChatMessageSent"){
        if(boundary==="user-actor")event.actor="user:other";
        if(boundary==="user-cause")event.causation_id="legacy-original-answer-0";
      }
      if(event.type==="BudgetReserved"){
        if(boundary==="budget-operation")legacyOriginalPayload(event,secret,payload=>{payload.operation="unrelated";});
        if(boundary==="budget-correlation")event.correlation_id="other-correlation";
        if(boundary==="budget-actor")event.actor="user";
        if(boundary==="budget-client")event.client_id="other-reader-client";
      }
      if(event.event_id==="legacy-original-answer-0"){
        if(boundary==="assistant-actor")event.actor="user";
        if(boundary==="assistant-operation")legacyOriginalPayload(event,secret,payload=>{payload.operation="other-operation";});
        if(boundary==="turn-id")legacyOriginalPayload(event,secret,payload=>{payload.turn_id="other-turn";});
        if(boundary==="correlation")event.correlation_id="other-correlation";
        if(boundary==="assistant-cause")event.causation_id="legacy-original-budget-0";
        if(boundary==="assistant-client")event.client_id="other-reader-client";
        if(boundary==="event-expiry")legacyOriginalPayload(event,secret,payload=>{payload.content_expires_at=at(-1);});
        if(boundary==="future-event")event.recorded_at=event.occurred_at=secret.created_at=at(120_000);
        if(boundary==="foreign-stream")event.stream_id="creative:foreign";
        if(boundary==="mixed-document")legacyOriginalPayload(event,secret,payload=>{payload.document_id="other-document";});
        if(boundary==="public-private-disagreement")legacyOriginalPayload(event,secret,payload=>{payload.content_ref="legacy-original-user-0";},{publicOnly:true});
      }
    }});
    if(boundary==="foreign-stream"){
      assert.equal(f.sqlite.prepare("SELECT stream_id FROM events WHERE event_id=?").get(f.rows[0].assistant.event.event_id).stream_id,"creative:foreign");
      assert.equal(f.current.sourceHead,f.rows[1].assistant.event.sequence);assert.equal(f.interval.throughSequence,f.current.sourceHead);
      assert.equal(f.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(f.stream).head,f.current.sourceHead);
    }
    const before=f.footprint();assert.equal(await f.capture(),null,boundary);legacyOriginalReadOnly(f,before);
  }
});

test("legacy original receipts: shared acting-user custody and private retention cannot be substituted by owner fallback",async t=>{
  const governed=await legacyOriginalFixture(t,{shared:true}),ceiling=at(30_000);
  governed.sqlite.prepare("UPDATE private_content_retention_scopes SET assigned_expires_at=? WHERE content_id=?")
    .run(ceiling,governed.rows[0].assistant.id);
  governed.rows[0].assistant.expiry=ceiling;
  const governedBefore=governed.footprint(),governedHandle=await governed.capture();assert.ok(governedHandle);
  assert.equal(governedHandle.validUntil,ceiling,"the current earlier governed ceiling bounds the entire capture, not only body-row expiry");
  assertLegacyOriginalReceipt(governed,await governed.replay(governedHandle),governedHandle);legacyOriginalReadOnly(governed,governedBefore);
  for(const boundary of ["missing-event-custody","owner-event-custody","wrong-source-sequence","wrong-stream","wrong-access","missing-body-custody",
    "body-custody-owner","body-custody-actor","body-visibility","missing-retention","retention-actor","retention-expiry"]){
    const f=await legacyOriginalFixture(t,{shared:true}),source=f.rows[0].assistant;
    if(boundary==="missing-event-custody")f.sqlite.prepare("DELETE FROM project_event_scopes WHERE event_id=?").run(source.event.event_id);
    if(boundary==="owner-event-custody")f.sqlite.prepare("UPDATE project_event_scopes SET actor_user_id=? WHERE event_id=?").run(f.ownerId,source.event.event_id);
    if(boundary==="wrong-source-sequence")f.sqlite.prepare("UPDATE project_event_scopes SET source_sequence=source_sequence+100 WHERE event_id=?").run(source.event.event_id);
    if(boundary==="wrong-stream")f.sqlite.prepare("UPDATE project_event_scopes SET source_stream_id='creative:other' WHERE event_id=?").run(source.event.event_id);
    if(boundary==="wrong-access")f.sqlite.prepare("UPDATE project_event_scopes SET project_access_id='foreign-access' WHERE event_id=?").run(source.event.event_id);
    if(boundary==="missing-body-custody")f.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").run(source.id);
    if(boundary==="body-custody-owner")f.sqlite.prepare("UPDATE project_resource_scopes SET owner_user_id='foreign-owner' WHERE resource_kind='content' AND resource_id=?").run(source.id);
    if(boundary==="body-custody-actor")f.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id=? WHERE resource_kind='content' AND resource_id=?").run(f.ownerId,source.id);
    if(boundary==="body-visibility")f.sqlite.prepare("UPDATE project_resource_scopes SET visibility='collaborative_output' WHERE resource_kind='content' AND resource_id=?").run(source.id);
    if(boundary==="missing-retention")f.sqlite.prepare("DELETE FROM private_content_retention_scopes WHERE content_id=?").run(source.id);
    if(boundary==="retention-actor")f.sqlite.prepare("UPDATE private_content_retention_scopes SET actor_user_id=? WHERE content_id=?").run(f.ownerId,source.id);
    if(boundary==="retention-expiry")f.sqlite.prepare("UPDATE private_content_retention_scopes SET assigned_expires_at=? WHERE content_id=?").run(at(-1),source.id);
    const before=f.footprint();assert.equal(await f.capture(),null,boundary);legacyOriginalReadOnly(f,before);
  }
});

test("legacy original receipts: opaque handles bind exact environment, prepared authority and unchanged original body receipts",async t=>{
  const short=await legacyOriginalFixture(t),until=at(30_000);
  short.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(until,short.rows[0].assistant.id);
  short.rows[0].assistant.expiry=until;
  const shortBefore=short.footprint(),shortHandle=await short.capture();assert.ok(shortHandle);assert.equal(shortHandle.validUntil,until);
  assertLegacyOriginalReceipt(short,await short.replay(shortHandle),shortHandle);legacyOriginalReadOnly(short,shortBefore);
  const f=await legacyOriginalFixture(t),before=f.footprint(),handle=await f.capture();assert.ok(handle);
  assert.equal(await f.replay({...handle}),null);assertLegacyOriginalReceipt(f,await f.replay(handle),handle);
  assert.equal(await replayLegacyConversationOriginals({...f.env},f.current,handle),null);
  const foreign=await legacyOriginalFixture(t,{shared:true});assert.equal(await replayLegacyConversationOriginals(foreign.env,foreign.current,handle),null);
  legacyOriginalReadOnly(f,before);
  for(const change of ["body","ref","expiry","prepared-actor","prepared-head","prepared-document"]){
    const next=await legacyOriginalFixture(t),captured=await next.capture();assert.ok(captured);
    const source=next.rows[0].assistant;
    if(change==="body")next.sqlite.prepare("UPDATE private_content SET content=content||' changed after capture' WHERE content_id=?").run(source.id);
    if(change==="ref")legacyOriginalPrivatePayload(next,source.event.event_id,payload=>{payload.content_ref=next.rows[0].user.id;});
    if(change==="expiry")next.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(at(86_400_000),source.id);
    if(change==="prepared-actor")next.current.principal.userId="foreign-actor";
    if(change==="prepared-head")next.current.sourceHead++;
    if(change==="prepared-document")next.current.binding.documentId="foreign-document";
    const changed=next.footprint();assert.equal(await next.replay(captured),null,change);legacyOriginalReadOnly(next,changed);
  }
});


const legacyOriginalIntervalRead = statement => statement.sql.includes("AND type IN('ChatMessageSent','AssistantReasoned') ORDER BY sequence LIMIT 13");
const legacyOriginalBodyRead = statement => statement.sql.startsWith("SELECT content_id,owner_id,kind,CASE WHEN length(CAST(content AS BLOB))<=16384");
const legacyOriginalFinalRead = statements => statements.some(statement=>statement.sql.includes("AS context_source_current"));
function legacyOriginalCanonicalEnvelope(event,secret,change,newEventId=event.event_id) {
  const payload=JSON.parse(secret.private_json);change(payload);const split=publicEventPayload(newEventId,payload,true);
  event.event_id=newEventId;event.payload=JSON.stringify(split.payload);
  secret.private_event_id=newEventId;secret.private_json=split.privateJson;
}
function legacyOriginalNativeSchema(f) {
  f.sqlite.exec(readFileSync(new URL("../drizzle/0027_memory_native_origins.sql",import.meta.url),"utf8"));
  const prior=f.footprint;
  f.footprint=()=>({...prior(),memory_native_answer_origins:f.sqlite.prepare("SELECT * FROM memory_native_answer_origins ORDER BY origin_id").all().map(row=>({...row})),
    memory_native_answer_dependencies:f.sqlite.prepare("SELECT * FROM memory_native_answer_dependencies ORDER BY origin_id,ordinal").all().map(row=>({...row}))});
}
function legacyOriginalNegativeOrigin(f) {
  const pair=f.rows[0],dependency=f.sqlite.prepare("SELECT * FROM events WHERE type='DocumentCreated' AND stream_id=? ORDER BY sequence LIMIT 1").get(f.stream);
  const originId="legacy-original-negative-origin",created=at(-1_000);
  // A constrained persisted negative marker, NOT an issued native publication.
  // Exact existing events/body refs satisfy unchanged0027 constraints; the
  // legacy exclusion treats presence as denial without certifying this marker.
  f.insert("memory_native_answer_origins",{origin_id:originId,schema_version:1,recipe_version:"native-answer-origin-v1",
    actor_user_id:f.actorId,owner_user_id:f.ownerId,organization_id:f.current.binding.scope?.organizationId??null,
    project_access_id:f.current.binding.scope?.projectAccessId??null,project_id:f.projectId,document_id:f.documentId,
    scope_key:JSON.stringify([f.current.binding.scope?.organizationId??"",f.current.binding.scope?.projectAccessId??"",f.projectId,f.documentId]),
    turn_id:pair.turnId,user_event_id:pair.user.event.event_id,user_content_id:pair.user.id,user_source_sequence:pair.user.event.sequence,
    user_sha256:legacyOriginalDigest(pair.user.text),answer_event_id:pair.assistant.event.event_id,answer_content_id:pair.assistant.id,
    answer_source_sequence:pair.assistant.event.sequence,answer_sha256:legacyOriginalDigest(pair.assistant.text),answer_expires_at:f.expiry,
    consumed_value_sha256:legacyOriginalDigest("synthetic-negative-marker"),dependency_list_sha256:legacyOriginalDigest(JSON.stringify([dependency.event_id])),
    enrollment_id:f.enrollment.enrollment_id,enrollment_revision:f.enrollment.revision,policy_version:f.enrollment.policy_version,
    permission_epoch:f.enrollment.permission_epoch,enrolled_at:f.enrollment.enrolled_at,enrollment_expires_at:f.enrollment.expires_at,
    retention_days:f.enrollment.retention_days,selection_cursor:pair.budget.sequence,source_retention_ceiling:f.expiry,dependency_count:1,
    created_at:created,status:"active",withdrawn_at:null,withdrawal_reason:null});
  f.insert("memory_native_answer_dependencies",{origin_id:originId,ordinal:0,event_stream_id:dependency.stream_id,event_id:dependency.event_id,
    source_sequence:dependency.sequence,event_type:dependency.type,recorded_at:dependency.recorded_at,block_id:null,turn_id:null,
    user_content_id:null,assistant_content_id:null,projection_sha256:legacyOriginalDigest(dependency.payload),source_retention_ceiling:f.expiry,
    consumed:1,segment_enrollment_id:null,segment_revision:null,segment_recipe:null,segment_first_sequence:null,segment_last_sequence:null,
    segment_member_count:null,segment_ordinal:null,segment_created_at:null,segment_retention_ceiling:null});
}

test("legacy original receipts: exact intervals disclose no inferred beginning and reject incomplete or over-twelve selections",async t=>{
  const f=await legacyOriginalFixture(t,{pairs:2});f.interval.throughSequence=f.rows[0].assistant.event.sequence;
  const before=f.footprint(),handle=await f.capture();assert.ok(handle);
  const value=await f.replay(handle);assertLegacyOriginalReceipt({...f,rows:f.rows.slice(0,1)},value,handle);
  assert.equal(value.completeFromStart,false);legacyOriginalReadOnly(f,before);
  for(const change of [interval=>{interval.throughSequence=interval.afterSequence;},interval=>{interval.afterSequence=-1;},
    interval=>{interval.afterSequence=.5;},interval=>{interval.throughSequence=Number.MAX_SAFE_INTEGER;},
    interval=>{interval.afterSequence=f.rows[0].user.event.sequence;},interval=>{interval.throughSequence=f.rows[0].user.event.sequence;}]){
    const next=await legacyOriginalFixture(t);change(next.interval);const expected=next.footprint();
    assert.equal(await next.capture(),null);assert.deepEqual(next.footprint(),expected);
    assert.ok(next.trace.every(row=>/^\s*(?:SELECT|WITH)/iu.test(row.sql)));
  }
  const twelve=await legacyOriginalFixture(t,{pairs:6}),twelveBefore=twelve.footprint(),accepted=await twelve.capture();assert.ok(accepted);
  const complete=await twelve.replay(accepted);assertLegacyOriginalReceipt(twelve,complete,accepted);assert.equal(complete.originals.length,12);
  legacyOriginalReadOnly(twelve,twelveBefore);
  const overflow=await legacyOriginalFixture(t,{pairs:7}),overflowBefore=overflow.footprint();
  assert.equal(await overflow.capture(),null,"the thirteenth original blocks, rather than selecting the older twelve");legacyOriginalReadOnly(overflow,overflowBefore);
  assert.ok(overflow.trace.some(legacyOriginalIntervalRead),"the actual unfiltered bounded interval query ran");
});

test("legacy original receipts: duplicate roles and a foreign-document pair are not filtered into a plausible complete subset",async t=>{
  for(const boundary of ["duplicate-role","mixed-pair","unpaired-second"]){
    const f=await legacyOriginalFixture(t,{pairs:boundary==="unpaired-second"?3:2,eventSeed:(event,secret)=>{
      if(!["legacy-original-message-1","legacy-original-answer-1"].includes(event.event_id))return;
      if(boundary==="duplicate-role")legacyOriginalCanonicalEnvelope(event,secret,payload=>{payload.turn_id="legacy-original-turn-0";});
      if(boundary==="mixed-pair"){
        legacyOriginalCanonicalEnvelope(event,secret,payload=>{payload.document_id="other-document";});secret.document_id="other-document";
      }
      if(boundary==="unpaired-second"&&event.type==="AssistantReasoned")return false;
    }}),second=f.rows[1];
    if(boundary==="unpaired-second"){
      // Keep the final genuine third pair and full selected interval. Only the
      // middle answer event is physically missing, not the captured source head.
      assert.equal(f.sqlite.prepare("SELECT 1 FROM events WHERE event_id=?").get(second.assistant.event.event_id),undefined);
      assert.ok(f.sqlite.prepare("SELECT 1 FROM event_private_payloads WHERE private_event_id=?").get(second.assistant.event.event_id));
      assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(second.assistant.id).content,second.assistant.text);
      assert.equal(f.current.sourceHead,f.rows[2].assistant.event.sequence);assert.equal(f.interval.throughSequence,f.current.sourceHead);
      assert.equal(f.sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id=?").get(f.stream).head,f.current.sourceHead);
    }
    const before=f.footprint();assert.equal(await f.capture(),null,boundary);legacyOriginalReadOnly(f,before);
  }
});

test("legacy original receipts: full original UTF-8 limits reject whole intervals without truncating or normalizing",async t=>{
  const exact="🧭".repeat(4096),atLimit=await legacyOriginalFixture(t,{texts:[["A short authored prompt.",exact]]}),before=atLimit.footprint();
  assert.equal(new TextEncoder().encode(exact).byteLength,16384);
  const handle=await atLimit.capture();assert.ok(handle);assertLegacyOriginalReceipt(atLimit,await atLimit.replay(handle),handle);legacyOriginalReadOnly(atLimit,before);
  const oversized=await legacyOriginalFixture(t,{texts:[["A short authored prompt.",exact+"x"]]});
  assert.equal(await oversized.capture(),null,"a single role over16KiB does not become a clipped quotation");
  const total=await legacyOriginalFixture(t,{pairs:4,texts:Array.from({length:4},()=>["🧭".repeat(2000),"🌍".repeat(3000)])});
  assert.ok(total.rows.every(pair=>pair.user.text.length<=4000),"authored originals respect the actual legacy request limit");
  assert.ok(total.rows.flatMap(pair=>[pair.user,pair.assistant]).every(source=>new TextEncoder().encode(source.text).byteLength<=16384));
  assert.equal(total.rows.flatMap(pair=>[pair.user,pair.assistant]).reduce((size,source)=>size+new TextEncoder().encode(source.text).byteLength,0),80000);
  assert.equal(await total.capture(),null,"eight individually bounded originals exceed the whole interval budget");
});

test("legacy original receipts: canonical forced synthetic or replay markers remain non-native evidence",async t=>{
  const marks=[payload=>{payload.synthetic=true;},payload=>{payload.simulation=true;},payload=>{payload.origin={synthetic:true};},
    payload=>{payload.mock_data_source="fixture";},payload=>{payload.replay_session_id="fixture-replay";},payload=>{payload.fictional_user_id="fixture-user";}];
  for(const mark of marks){
    const f=await legacyOriginalFixture(t,{eventSeed:(event,secret)=>{
      if(event.type==="AssistantReasoned")legacyOriginalCanonicalEnvelope(event,secret,mark);
    }}),source=f.rows[0].assistant,before=f.footprint();
    const stored=f.sqlite.prepare("SELECT payload FROM events WHERE event_id=?").get(source.event.event_id).payload;
    const secret=f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(source.event.event_id).private_json;
    const regenerated=publicEventPayload(source.event.event_id,JSON.parse(secret),true);
    assert.equal(stored,JSON.stringify(regenerated.payload));assert.equal(secret,regenerated.privateJson,"negative is not masked by noncanonical envelope bytes");
    assert.equal(await f.capture(),null);legacyOriginalReadOnly(f,before);
  }
  for(const marker of ["event-id","client-id"]){
    const f=await legacyOriginalFixture(t,{eventSeed:(event,secret)=>{
      if(marker==="event-id"&&event.type==="AssistantReasoned")legacyOriginalCanonicalEnvelope(event,secret,()=>{},"optimistic:legacy-original-answer");
      if(marker==="client-id")event.client_id="optimistic:legacy-client";
    }});
    // All three clients still agree, and a changed event ID has a matching forced
    // private reference. The explicit optimistic marker, not a broken pair, denies.
    const before=f.footprint();assert.equal(await f.capture(),null,marker);legacyOriginalReadOnly(f,before);
  }
});

test("legacy original receipts: noncanonical duplicate or malformed envelope JSON cannot impersonate the actual producer",async t=>{
  for(const boundary of ["duplicate-public","duplicate-private","malformed-public","malformed-private"]){
    const f=await legacyOriginalFixture(t,{eventSeed:(event,secret)=>{
      if(event.type!=="AssistantReasoned")return;
      const privateSide=boundary.endsWith("private"),row=privateSide?secret:event,column=privateSide?"private_json":"payload",original=row[column];
      const changed=boundary.startsWith("malformed")?"{broken":original.slice(0,-1)+`,"turn_id":${JSON.stringify("legacy-original-turn-0")}}`;
      assert.notEqual(changed,original);row[column]=changed;
    }});
    const before=f.footprint();assert.equal(await f.capture(),null,boundary);legacyOriginalReadOnly(f,before);
  }
});

test("legacy original receipts: native ancestry markers and postcapture schema arrival cannot become ordinary history",async t=>{
  for(const boundary of ["private-kind","public-marker","origin-header"]){
    const f=await legacyOriginalFixture(t,{eventSeed:(event,secret)=>{
      if(boundary==="public-marker"&&event.type==="AssistantReasoned")legacyOriginalCanonicalEnvelope(event,secret,payload=>{payload.memory_origin_version=1;});
    }}),source=f.rows[0].assistant;
    if(boundary==="private-kind")f.sqlite.prepare("UPDATE private_content SET kind='chat-assistant-memory' WHERE content_id=?").run(source.id);
    if(boundary==="origin-header"){legacyOriginalNativeSchema(f);legacyOriginalNegativeOrigin(f);}
    const before=f.footprint();assert.equal(await f.capture(),null,boundary);legacyOriginalReadOnly(f,before);
  }
  for(const withMarker of [false,true]){
    const f=await legacyOriginalFixture(t),handle=await f.capture();assert.ok(handle);
    assert.equal(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='memory_native_answer_origins'").get(),undefined);
    legacyOriginalNativeSchema(f);if(withMarker)legacyOriginalNegativeOrigin(f);
    const changed=f.footprint();assert.equal(await f.replay(handle),null,"captured absent-schema branch cannot survive an additive native-origin table");
    legacyOriginalReadOnly(f,changed);
  }
});

test("legacy original receipts: body or authority changes after capture reads are caught by the final exact witness",async t=>{
  const stable=await legacyOriginalFixture(t),stableBefore=stable.footprint();let returnedRows=null,aliasChanges=0;
  stable.hooks.afterBatch=(statements,results)=>{
    if(returnedRows)return;const index=statements.findIndex(legacyOriginalBodyRead);
    if(index>=0)returnedRows=results[index].results;
  };
  const nativeDigest=crypto.subtle.digest;
  const digest=t.mock.method(crypto.subtle,"digest",function(algorithm,data){
    const pending=nativeDigest.call(crypto.subtle,algorithm,data);
    if(returnedRows&&!aliasChanges&&new TextDecoder().decode(data)===stable.rows[0].user.text){
      aliasChanges++;for(const row of returnedRows)row.content="LATE_RETURNED_ROW_ALIAS_CANARY";
    }
    return pending;
  });
  try{
    const captured=await stable.capture();assert.ok(captured);assert.equal(aliasChanges,1);
    assert.ok(returnedRows.every(row=>row.content==="LATE_RETURNED_ROW_ALIAS_CANARY"),"the original DB result objects really changed during a native digest");
    const receipt=await stable.replay(captured);assertLegacyOriginalReceipt(stable,receipt,captured);
    assert.equal(JSON.stringify(receipt).includes("LATE_RETURNED_ROW_ALIAS_CANARY"),false);
    legacyOriginalReadOnly(stable,stableBefore);
  }finally{digest.mock.restore();stable.hooks.afterBatch=null;}
  for(const boundary of ["body","event","authority","custody","prepared","interval"]){
    const f=await legacyOriginalFixture(t,{shared:true});let fired=0,changed;
    f.hooks.afterBatch=statements=>{
      if(fired||!statements.some(legacyOriginalBodyRead))return;fired++;
      const source=f.rows[0].assistant;
      if(boundary==="body")f.sqlite.prepare("UPDATE private_content SET content=content||' late external mutation' WHERE content_id=?").run(source.id);
      if(boundary==="event")legacyOriginalPrivatePayload(f,source.event.event_id,payload=>{payload.content_expires_at=at(86_400_000);});
      if(boundary==="authority")f.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE user_id=?").run(at(-1),f.actorId);
      if(boundary==="custody")f.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id=? WHERE resource_kind='content' AND resource_id=?").run(f.ownerId,source.id);
      if(boundary==="prepared")f.current.sourceHead++;
      if(boundary==="interval")f.interval.throughSequence--;
      changed=f.footprint();
    };
    assert.equal(await f.capture(),null,boundary);assert.equal(fired,1);assert.ok(changed);legacyOriginalReadOnly(f,changed);
  }
});

test("legacy original receipts: replay rechecks current native authority, body bytes and ordinary ancestry without renewing the handle",async t=>{
  for(const boundary of ["body","authority","memory-marker","expired-body"]){
    const f=await legacyOriginalFixture(t,{shared:true});
    if(boundary==="memory-marker")legacyOriginalNativeSchema(f);
    const handle=await f.capture();assert.ok(handle);let fired=0,changed;
    f.hooks.beforeBatch=statements=>{
      if(!legacyOriginalFinalRead(statements)||fired)return;fired++;
      const source=f.rows[0].assistant;
      if(boundary==="body")f.sqlite.prepare("UPDATE private_content SET content=content||' changed before replay' WHERE content_id=?").run(source.id);
      if(boundary==="authority")f.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE user_id=?").run(at(-1),f.actorId);
      if(boundary==="memory-marker")legacyOriginalNegativeOrigin(f);
      if(boundary==="expired-body")f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(at(-1),source.id);
      changed=f.footprint();
    };
    assert.equal(await f.replay(handle),null,boundary);assert.equal(fired,1);legacyOriginalReadOnly(f,changed);
  }
});

test("legacy original receipts: malformed successful-looking DB acknowledgements never certify original text",async t=>{
  for(const phase of ["capture","replay"])for(const boundary of ["error","missing-results","missing-success","false-success"]){
    const f=await legacyOriginalFixture(t),handle=phase==="replay"?await f.capture():null;if(phase==="replay")assert.ok(handle);
    const before=f.footprint();let fired=0;
    f.hooks.afterStatement=(statement,kind,result)=>{
      if(fired||kind!=="all"||!legacyOriginalBodyRead(statement))return;fired++;
      if(boundary==="error")result.error="fixture";
      if(boundary==="missing-results")delete result.results;
      if(boundary==="missing-success")delete result.success;
      if(boundary==="false-success")result.success=false;
    };
    assert.equal(await(phase==="capture"?f.capture():f.replay(handle)),null,`${phase}: ${boundary}`);
    assert.equal(fired,1);legacyOriginalReadOnly(f,before);
  }
});

// Native private-ledger storage only. Synthetic setup uses the existing real
// principal/custody/SQLite fixture; neither semantic generation nor the paid
// legacy producer executes. All earlier S3 source remains unchanged.
const {readStructuredConversationLedger,appendStructuredConversationLedger}=await import("../worker/memory-live-store.ts");
const {prepareLegacyConversationOriginalsCommit}=await import("../worker/events-api.ts");
const STRUCTURED_LEDGER_KIND="memory-structured-ledger";
const structuredLedgerTables=["memory_structured_conversation_heads","memory_structured_conversation_revisions"];
const structuredLedgerRef=(pair,source)=>({eventId:source.event.event_id,sequence:source.event.sequence,turnId:pair.turnId,
  role:source.role,contentRef:source.id,contentHash:legacyOriginalDigest(source.text)});

async function structuredLedgerOwnerFixture(t,{pairs=3,texts=null,expiryOffsetMs=180_000}={}) {
  let state;const ownedJobs=[];
  const local={after:callback=>t.after(()=>{
    try{if(state)for(const jobId of ownedJobs)state.sqlite.prepare("DELETE FROM document_jobs WHERE job_id=?").run(jobId);}
    finally{callback();}
  })};
  const f=state=await legacyOriginalFixture(local,{shared:true,pairs:0});
  // Keep every collaborator setup event and enrollment intact. New owner rows
  // are inserted, never obtained by changing an existing immutable event.
  f.actorId=f.ownerId;f.env.FORMA_MEMORY_USER_IDS="consumption-actor,"+f.actorId;
  const expiry=at(expiryOffsetMs),created=at(-8_000),rows=[];let chronology=0;
  const afterSequence=f.current.sourceHead;
  const ownerEvent=(type,payload,{id,actor,correlation,causation=null})=>{
    const split=publicEventPayload(id,payload,true),recordedAt=at(-7_000+chronology++);
    const row=f.append(type,payload,{eventId:id,actor,correlationId:correlation,causationId:causation,custody:false,
      recordedAt,rawPublic:JSON.stringify(split.payload)});
    f.insert("event_private_payloads",{private_event_id:id,owner_id:f.ownerId,project_id:payload.project_id??null,
      document_id:payload.document_id??null,private_json:split.privateJson,created_at:recordedAt,redacted_at:null});
    f.insert("project_event_scopes",{event_id:id,project_access_id:f.projectAccessId,organization_id:f.organizationId,
      project_id:f.projectId,owner_user_id:f.ownerId,source_stream_id:f.stream,source_sequence:row.sequence,
      project_sequence:row.sequence,actor_user_id:f.actorId,created_at:recordedAt});return row;
  };
  const ownerBody=(id,role,text)=>{
    const bodyCreated=at(-7_000+chronology++);
    f.insert("private_content",{content_id:id,owner_id:f.actorId,kind:"chat-"+role,content:text,created_at:bodyCreated,expires_at:expiry,redacted_at:null});
    f.insert("project_resource_scopes",{project_access_id:f.projectAccessId,resource_kind:"content",resource_id:id,
      organization_id:f.organizationId,project_id:f.projectId,owner_user_id:f.ownerId,visibility:"actor_private",
      source_event_id:null,actor_user_id:f.actorId,created_at:bodyCreated});
    f.insert("private_content_retention_scopes",{content_id:id,organization_id:f.organizationId,project_access_id:f.projectAccessId,
      project_id:f.projectId,actor_user_id:f.actorId,classification:"transient-private",policy_version:0,
      assigned_expires_at:expiry,created_at:bodyCreated});return{id,role,text,expiry};
  };
  for(let index=0;index<pairs;index++){
    const turnId="structured-owner-turn-"+index,jobId="structured-owner-job-"+index;
    const supplied=texts?.[index]??["Owner exact 🧭 é declaration "+index+": "+"original source ".repeat(40)+"END-OWNER-"+index,
      "  Owner answer 🌍 "+index+": "+"historical response ".repeat(35)+"  "];
    assert.equal(supplied[0],supplied[0].trim());assert.ok(supplied[0].length<=4000);
    const requested=f.sqlite.prepare("SELECT MAX(sequence) AS n FROM events WHERE stream_id=?").get(f.stream).n;
    f.insert("document_jobs",{job_id:jobId,owner_id:f.actorId,stream_id:f.stream,document_id:f.documentId,kind:"chat",status:"completed",
      source_surface:"chat",correlation_id:jobId,requested_sequence:requested,request_json:JSON.stringify({message:supplied[0],livePreview:false}),
      result_json:"{}",error_message:null,attempt_count:1,requested_at:created,started_at:created,completed_at:at(-6_000),
      lease_expires_at:null,notified_at:null,expires_at:expiry,updated_at:at(-6_000)});ownedJobs.push(jobId);
    const anchor=ownerEvent("ProjectDocumentJobQueued",{job_id:jobId,document_id:f.documentId,kind:"chat",organization_id:f.organizationId,
      project_access_id:f.projectAccessId,project_id:f.projectId,history_owner_user_id:f.ownerId,actor_user_id:f.actorId},
      {id:"structured-owner-anchor-"+index,actor:"user:"+f.actorId,correlation:jobId});
    f.insert("project_resource_scopes",{project_access_id:f.projectAccessId,resource_kind:"job",resource_id:jobId,
      organization_id:f.organizationId,project_id:f.projectId,owner_user_id:f.ownerId,visibility:"actor_private",
      source_event_id:anchor.event_id,actor_user_id:f.actorId,created_at:created});
    const user=ownerBody("structured-owner-user-"+index,"user",supplied[0]);
    const budget=ownerEvent("BudgetReserved",{operation:"creative-chat",reservation_id:"owner-budget-"+index,cost_reservation_id:"owner-cost-"+index,
      reserved_tokens:12000,reserved_microusd:1,period:"2026-09",live_preview:false},
      {id:"structured-owner-budget-"+index,actor:"worker:policy",correlation:jobId});
    const authored=ownerEvent("ChatMessageSent",{turn_id:turnId,document_id:f.documentId,content_ref:user.id,content_expires_at:expiry,
      source_surface:"chat",live_preview:false},{id:"structured-owner-message-"+index,actor:"user:"+f.actorId,correlation:jobId,causation:budget.event_id});
    const assistant=ownerBody("structured-owner-assistant-"+index,"assistant",supplied[1]);
    const answered=ownerEvent("AssistantReasoned",{operation:"creative-chat",turn_id:turnId,document_id:f.documentId,content_ref:assistant.id,
      content_expires_at:expiry,provider:"openai",provider_response_id:"owner-historical-response-"+index,model_id:"historical-model",
      latency_ms:1,mutation_count:0,reference_pixel_mutation_count:0,preview_worthy:false,live_preview_requested:false,preview_queued:false,
      preview_direction_ref:null,preview_suppressed:false},
      {id:"structured-owner-answer-"+index,actor:"model:forma-chat",correlation:jobId,causation:authored.event_id});
    rows.push({turnId,correlation:jobId,jobId,budget,user:{...user,event:authored},assistant:{...assistant,event:answered}});
  }
  const contextId="structured-owner-context";
  f.insert("project_context_sessions",{context_id:contextId,principal_user_id:f.actorId,organization_id:f.organizationId,
    project_access_id:f.projectAccessId,created_at:created,expires_at:at(Math.max(3_600_000,expiryOffsetMs+60_000)),revoked_at:null});
  f.prepare=()=>prepareDocumentAuthority(new Request("http://localhost/api/context/read",{headers:{
    "oai-authenticated-user-id":f.actorId,"oai-authenticated-user-email":f.actorId+"@example.test",
    "oai-authenticated-user-name":f.actorId,cookie:"forma_project_context="+contextId}}),f.env,
    {projectId:f.projectId,documentId:f.documentId},"read");
  f.current=await f.prepare();assert.ok(!(f.current instanceof Response));assert.equal(f.current.principal.userId,f.ownerId);
  f.enrollment={...f.enrollment,enrollment_id:"structured-owner-enrollment",actor_user_id:f.actorId,
    permission_epoch:f.current.principal.access.permissionEpoch,cursor_sequence:f.current.sourceHead,
    expires_at:at(Math.max(3_600_000,expiryOffsetMs+60_000))};
  f.insert("memory_live_enrollments",f.enrollment);
  Object.assign(f,{rows,expiry,interval:{afterSequence,throughSequence:rows.at(-1).assistant.event.sequence}});return f;
}

async function structuredLedgerFixture(t,{mode="personal",pairs=3,texts=null,schema=true,expiryOffsetMs=180_000}={}) {
  const f=mode==="shared-owner"?await structuredLedgerOwnerFixture(t,{pairs,texts,expiryOffsetMs})
    :await legacyOriginalFixture(t,{shared:mode==="shared-collaborator",pairs,texts});
  if(schema)f.sqlite.exec(readFileSync(new URL("../drizzle/0032_memory_structured_conversation_ledger.sql",import.meta.url),"utf8"));
  const prior=f.footprint;
  f.ledgerFootprint=()=>({...prior(),...Object.fromEntries(structuredLedgerTables.map(table=>[table,
    f.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)
      ?f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row})):null]))});
  f.refs=f.rows.flatMap(pair=>[structuredLedgerRef(pair,pair.user),structuredLedgerRef(pair,pair.assistant)]);
  f.frames=[];
  for(let index=0;index<f.rows.length;index+=6){
    const start=index===0?f.interval.afterSequence:f.rows[index-1].assistant.event.sequence;
    const end=f.rows[Math.min(index+5,f.rows.length-1)].assistant.event.sequence;
    const capture=await captureLegacyConversationOriginals(f.env,f.current,{afterSequence:start,throughSequence:end});
    assert.ok(capture,"genuine original frame before ledger operations");f.frames.push(capture);
  }
  f.ledgerRead=(frames=f.frames)=>readStructuredConversationLedger(f.env,f.enrollment,f.current,frames);
  f.ledgerAppend=(expected,ledger,frames=f.frames)=>appendStructuredConversationLedger(f.env,f.enrollment,f.current,frames,expected,ledger);
  f.trace.length=0;return f;
}
function structuredLedgerDeclaration(f,index,{itemId="declared-goal",revision=1,operation="assert",category="goal",role="user",predecessor=null}={}) {
  const pair=f.rows[index],source=pair[role],characters=Array.from(source.text),start=0,end=Math.min(36,characters.length);
  return{itemId,revision,category,operation,predecessor,source:structuredLedgerRef(pair,source),start,end,text:characters.slice(start,end).join("")};
}
function structuredLedgerProposal(f,read,annotation) {
  return{schemaVersion:1,recipeVersion:"native-declared-ledger-v1",semanticCompleteness:false,
    annotations:[...copy(read.ledger.annotations),copy(annotation)],originals:copy(f.refs)};
}
async function structuredLedgerPublish(f,index=0,read=null,options={}) {
  const expected=read??await f.ledgerRead();assert.ok(expected);
  const proposed=structuredLedgerProposal(f,expected,structuredLedgerDeclaration(f,index,options));
  const written=await f.ledgerAppend(expected,proposed);assert.ok(written);assert.equal(written.status,"active");
  assert.deepEqual(written.ledger,proposed);assert.equal(written.revision,expected.revision+1);return written;
}
const structuredLedgerHead=f=>f.sqlite.prepare("SELECT * FROM memory_structured_conversation_heads WHERE actor_user_id=? AND document_id=?")
  .get(f.actorId,f.documentId);
const structuredLedgerRevisions=f=>f.sqlite.prepare("SELECT * FROM memory_structured_conversation_revisions ORDER BY ledger_id,revision").all().map(row=>({...row}));
function structuredLedgerOrdinaryFootprint(f) {
  const result=f.footprint(),privateIds=new Set(result.private_content.filter(row=>row.kind===STRUCTURED_LEDGER_KIND).map(row=>row.content_id));
  result.private_content=result.private_content.filter(row=>!privateIds.has(row.content_id));
  result.project_resource_scopes=result.project_resource_scopes.filter(row=>row.resource_kind!=="content"||!privateIds.has(row.resource_id));
  result.private_content_retention_scopes=result.private_content_retention_scopes.filter(row=>!privateIds.has(row.content_id));return result;
}

for(const mode of ["personal","shared-collaborator","shared-owner"])
test("structured native ledger: "+mode+" retains immutable exact revisions and negative history",async t=>{
  const f=await structuredLedgerFixture(t,{mode,pairs:4}),ordinary=structuredLedgerOrdinaryFootprint(f),initial=await f.ledgerRead();
  assert.ok(initial);assert.equal(initial.status,"initial");assert.equal(initial.revision,0);assert.ok(Object.isFrozen(initial));
  assert.equal(structuredLedgerHead(f),undefined);assert.deepEqual(structuredLedgerRevisions(f),[]);
  let read=await structuredLedgerPublish(f,0,initial),prior=structuredLedgerRevisions(f);
  const retainedBodies=()=>f.sqlite.prepare("SELECT content_id,content,created_at,expires_at FROM private_content WHERE kind=? ORDER BY content_id")
    .all(STRUCTURED_LEDGER_KIND).map(row=>({...row}));
  for(const [index,operation] of [[1,"correct"],[2,"withdraw"],[3,"supersede"]]){
    const bodies=retainedBodies();
    read=await structuredLedgerPublish(f,index,read,{revision:index+1,operation,predecessor:{itemId:"declared-goal",revision:index}});
    assert.deepEqual(structuredLedgerRevisions(f).slice(0,prior.length),prior,"earlier metadata never overwritten");
    for(const row of bodies)assert.deepEqual(retainedBodies().find(candidate=>candidate.content_id===row.content_id),row,"earlier private bodies never rewritten");
    prior=structuredLedgerRevisions(f);
  }
  assert.equal(read.revision,4);assert.deepEqual(read.ledger.annotations.map(row=>row.operation),["assert","correct","withdraw","supersede"]);
  assert.equal(read.ledger.semanticCompleteness,false);assert.deepEqual(read.ledger.originals,f.refs);
  assert.match(read.ledger.annotations[0].text,/🧭/u);assert.match(read.ledger.annotations[0].text,/é/u);
  const fresh=await f.ledgerRead();assert.ok(fresh);assert.deepEqual(fresh.ledger,read.ledger);
  assert.ok(Date.parse(fresh.validUntil)<=Date.parse(read.validUntil));assert.equal(fresh.expiresAt,read.expiresAt);
  assert.deepEqual(structuredLedgerOrdinaryFootprint(f),ordinary,"private publication cannot change original history, enrollment or financial data");
  for(const row of retainedBodies()){
    const body=f.sqlite.prepare("SELECT owner_id,kind FROM private_content WHERE content_id=?").get(row.content_id);
    assert.equal(body.owner_id,f.actorId);assert.equal(body.kind,STRUCTURED_LEDGER_KIND);
    if(mode!=="personal"){
      const resource=f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(row.content_id);
      const retention=f.sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=?").get(row.content_id);
      assert.equal(resource.owner_user_id,f.ownerId);assert.equal(resource.actor_user_id,f.actorId);assert.equal(resource.visibility,"actor_private");
      assert.equal(retention.actor_user_id,f.actorId);assert.equal(retention.classification,"transient-private");assert.equal(retention.assigned_expires_at,row.expires_at);
    }
  }
  if(mode==="shared-collaborator")assert.equal(f.sqlite.prepare("SELECT role FROM project_memberships WHERE user_id=?").get(f.actorId).role,"viewer");
  if(mode==="shared-owner")assert.equal(f.sqlite.prepare("SELECT actor_user_id FROM memory_live_enrollments WHERE enrollment_id='consumption-enrollment'").get().actor_user_id,"consumption-actor");
});

test("structured native ledger: native purposes and exact issued read are independent of supplied proposals",async t=>{
  for(const boundary of ["learn-paused","recall-paused","expired-enrollment","before-enrollment","wrong-epoch","wrong-document","cloned-read","foreign-environment","foreign-read"]){
    const f=await structuredLedgerFixture(t),initial=await f.ledgerRead();assert.ok(initial);
    const proposed=structuredLedgerProposal(f,initial,structuredLedgerDeclaration(f,0));let expected=initial,env=f.env;
    if(boundary==="learn-paused"){
      f.enrollment.learn_enabled=0;f.sqlite.prepare("UPDATE memory_live_enrollments SET learn_enabled=0 WHERE enrollment_id=?").run(f.enrollment.enrollment_id);
      const readable=await f.ledgerRead();assert.ok(readable,"recall remains available while learning is paused");expected=readable;
    }
    if(boundary==="recall-paused"){f.enrollment.recall_enabled=0;f.sqlite.prepare("UPDATE memory_live_enrollments SET recall_enabled=0").run();}
    if(boundary==="expired-enrollment"){f.enrollment.expires_at=at(-1);f.sqlite.prepare("UPDATE memory_live_enrollments SET expires_at=?").run(f.enrollment.expires_at);}
    if(boundary==="before-enrollment"){
      f.enrollment.enrolled_at=at(-1_000);f.sqlite.prepare("UPDATE memory_live_enrollments SET enrolled_at=?").run(f.enrollment.enrolled_at);
      assert.ok(await replayLegacyConversationOriginals(f.env,f.current,f.frames[0]),"readable original is not a retrospective learning grant");
      expected=await f.ledgerRead();assert.ok(expected);assert.equal(expected.status,"initial","empty scope carries no retained original dependency");
      assert.deepEqual(expected.ledger.annotations,[]);assert.deepEqual(expected.ledger.originals,[]);
    }
    if(boundary==="wrong-epoch"){f.enrollment.permission_epoch="f".repeat(64);f.sqlite.prepare("UPDATE memory_live_enrollments SET permission_epoch=?").run(f.enrollment.permission_epoch);}
    if(boundary==="wrong-document")f.current.binding.documentId="unrelated-document";
    if(boundary==="cloned-read")expected=copy(initial);
    if(boundary==="foreign-environment")env={...f.env};
    if(boundary==="foreign-read"){const other=await structuredLedgerFixture(t,{mode:"shared-collaborator"});expected=await other.ledgerRead();assert.ok(expected);}
    const before=f.ledgerFootprint();
    assert.equal(await appendStructuredConversationLedger(env,f.enrollment,f.current,f.frames,expected,proposed),null,boundary);
    assert.deepEqual(f.ledgerFootprint(),before);
    if(["recall-paused","expired-enrollment","wrong-epoch","wrong-document"].includes(boundary))assert.equal(await f.ledgerRead(),null,boundary);
  }
});

test("structured native ledger: two preissued head writers cannot overwrite a winner or renew an identical replay",async t=>{
  const f=await structuredLedgerFixture(t),left=await f.ledgerRead(),right=await f.ledgerRead();assert.ok(left);assert.ok(right);
  // Both snapshots predate either write; dispatch is serialized by the existing
  // single SQLite connection. This is an exact CAS fork, not a hosted race test.
  const leftLedger=structuredLedgerProposal(f,left,structuredLedgerDeclaration(f,0));
  const rightLedger=structuredLedgerProposal(f,right,structuredLedgerDeclaration(f,0,{itemId:"other-proposal"}));
  const winner=await f.ledgerAppend(left,leftLedger);assert.ok(winner);const committed=f.ledgerFootprint();
  assert.equal(await f.ledgerAppend(right,rightLedger),null);assert.equal(await f.ledgerAppend(left,leftLedger),null);
  assert.deepEqual(f.ledgerFootprint(),committed);assert.equal(structuredLedgerRevisions(f).length,1);
  const fresh=await f.ledgerRead();assert.ok(fresh);assert.equal(fresh.revision,1);assert.deepEqual(fresh.ledger,leftLedger);
  assert.ok(Date.parse(fresh.validUntil)<=Date.parse(winner.validUntil));assert.equal(fresh.expiresAt,winner.expiresAt);
  assert.equal(await f.ledgerAppend(fresh,copy(fresh.ledger)),null,"unchanged or unresolved-only data cannot create a revision");
  assert.deepEqual(f.ledgerFootprint(),committed);
});

test("structured native ledger: malformed declarations cannot acquire structural or semantic authority",async t=>{
  for(const fault of ["unknown-field","assistant-decision","wrong-hash","wrong-role","wrong-event","normalized-quote","bad-span","fresh-revision","forward-predecessor","cross-item","omitted-original","duplicate-original","semantic-complete"]){
    const f=await structuredLedgerFixture(t),initial=await f.ledgerRead();assert.ok(initial);
    const proposed=structuredLedgerProposal(f,initial,structuredLedgerDeclaration(f,0)),annotation=proposed.annotations[0];
    if(fault==="unknown-field")proposed.accepted=true;
    if(fault==="assistant-decision")proposed.annotations[0]=structuredLedgerDeclaration(f,0,{role:"assistant",category:"decision"});
    if(fault==="wrong-hash")annotation.source.contentHash="0".repeat(64);
    if(fault==="wrong-role")annotation.source.role="assistant";
    if(fault==="wrong-event")annotation.source.eventId="unrelated-event";
    if(fault==="normalized-quote")annotation.text=annotation.text.normalize("NFC");
    if(fault==="bad-span")annotation.end++;
    if(fault==="fresh-revision")annotation.revision=2;
    if(fault==="forward-predecessor"){annotation.operation="correct";annotation.predecessor={itemId:annotation.itemId,revision:2};}
    if(fault==="cross-item"){annotation.operation="correct";annotation.predecessor={itemId:"another-item",revision:1};}
    if(fault==="omitted-original")proposed.originals=proposed.originals.filter(ref=>ref.eventId!==annotation.source.eventId);
    if(fault==="duplicate-original")proposed.originals.push(copy(proposed.originals[0]));
    if(fault==="semantic-complete")proposed.semanticCompleteness=true;
    const before=f.ledgerFootprint();assert.equal(await f.ledgerAppend(initial,proposed),null,fault);assert.deepEqual(f.ledgerFootprint(),before);
  }
  const f=await structuredLedgerFixture(t),first=await structuredLedgerPublish(f),negative=await structuredLedgerPublish(f,1,first,
    {revision:2,operation:"withdraw",predecessor:{itemId:"declared-goal",revision:1}});
  for(const change of ["remove-negative","rewrite-prior","fresh-item-restart","overlap"]){
    const current=await f.ledgerRead();assert.ok(current);
    const proposed=structuredLedgerProposal(f,current,structuredLedgerDeclaration(f,2,
      {revision:3,operation:"supersede",predecessor:{itemId:"declared-goal",revision:2}}));
    if(change==="remove-negative")proposed.annotations.splice(1,1);
    if(change==="rewrite-prior")proposed.annotations[0].category="question";
    if(change==="fresh-item-restart")proposed.annotations[2]=structuredLedgerDeclaration(f,2);
    if(change==="overlap")proposed.annotations[2]={...proposed.annotations[2],source:copy(proposed.annotations[1].source),
      start:proposed.annotations[1].start,end:proposed.annotations[1].end,text:proposed.annotations[1].text};
    const before=f.ledgerFootprint();assert.equal(await f.ledgerAppend(current,proposed),null,change);assert.deepEqual(f.ledgerFootprint(),before);
  }
  assert.deepEqual((await f.ledgerRead()).ledger,negative.ledger);
});

test("structured native ledger: complete persisted negative history cannot be replaced by a plausible latest body",async t=>{
  for(const fault of ["missing-middle","redacted-middle","changed-middle","missing-current","head-count","head-hash","revision-predecessor"]){
    const f=await structuredLedgerFixture(t),first=await structuredLedgerPublish(f);
    const second=await structuredLedgerPublish(f,1,first,{revision:2,operation:"withdraw",predecessor:{itemId:"declared-goal",revision:1}});
    const third=await structuredLedgerPublish(f,2,second,{revision:3,operation:"supersede",predecessor:{itemId:"declared-goal",revision:2}});
    const revisions=structuredLedgerRevisions(f);
    if(fault==="missing-middle")f.sqlite.prepare("DELETE FROM memory_structured_conversation_revisions WHERE ledger_id=? AND revision=2").run(third.ledgerId);
    if(fault==="redacted-middle")f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(at(-1),revisions[1].body_ref);
    if(fault==="changed-middle")f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(revisions[1].body_ref);
    if(fault==="missing-current")f.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(revisions[2].body_ref);
    if(fault==="head-count")f.sqlite.prepare("UPDATE memory_structured_conversation_heads SET annotation_count=annotation_count+1").run();
    if(fault==="head-hash")f.sqlite.prepare("UPDATE memory_structured_conversation_heads SET current_body_hash=?").run("0".repeat(64));
    if(fault==="revision-predecessor")f.sqlite.prepare("UPDATE memory_structured_conversation_revisions SET predecessor_hash=? WHERE revision=3").run("0".repeat(64));
    const before=f.ledgerFootprint();assert.equal(await f.ledgerRead(),null,fault);
    const proposed=structuredLedgerProposal(f,third,structuredLedgerDeclaration(f,2,{itemId:"another-goal"}));
    assert.equal(await f.ledgerAppend(third,proposed),null,fault);assert.deepEqual(f.ledgerFootprint(),before);
  }
});

test("structured native ledger: complete prior originals require bounded current proof across every issued frame",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:7});assert.equal(f.frames.length,2);
  const first=await structuredLedgerPublish(f),current=await structuredLedgerPublish(f,6,first,
    {revision:2,operation:"withdraw",predecessor:{itemId:"declared-goal",revision:1}});
  assert.equal(current.ledger.originals.length,14);
  const before=f.ledgerFootprint();assert.equal(await f.ledgerRead([f.frames[1]]),null,"newest interval cannot stand in for retained prior originals");
  assert.equal(await f.ledgerAppend(current,structuredLedgerProposal(f,current,structuredLedgerDeclaration(f,6,{itemId:"unrelated-next-item"})),[f.frames[1]]),null);
  assert.deepEqual(f.ledgerFootprint(),before);
  f.sqlite.prepare("UPDATE private_content SET redacted_at=?,content='' WHERE content_id=?").run(at(-1),f.rows[0].user.id);
  const changed=f.ledgerFootprint();
  assert.ok(await replayLegacyConversationOriginals(f.env,f.current,f.frames[1]),"newest frame remains genuinely valid");
  assert.equal(await f.ledgerRead(),null,"unprovable older original invalidates the entire declared history");
  assert.equal(await f.ledgerAppend(current,structuredLedgerProposal(f,current,structuredLedgerDeclaration(f,6,{itemId:"another-next-item"}))),null);
  assert.deepEqual(f.ledgerFootprint(),changed);
});

test("structured native ledger: original frame union deduplicates identities but retains proofs and aggregate limits",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1});
  const another=await captureLegacyConversationOriginals(f.env,f.current,f.interval);assert.ok(another);
  const before=f.ledgerFootprint(),empty={statements:0,rows:0,bytes:0};
  const one=await prepareLegacyConversationOriginalsCommit(f.env,f.current,[f.frames[0]],empty);assert.ok(one);
  const repeated=await prepareLegacyConversationOriginalsCommit(f.env,f.current,[f.frames[0],f.frames[0]],empty);assert.ok(repeated);
  assert.equal(repeated.frameCount,1);assert.deepEqual(repeated.budget,one.budget);
  const independent=await prepareLegacyConversationOriginalsCommit(f.env,f.current,[f.frames[0],another],empty);assert.ok(independent);
  assert.equal(independent.frameCount,2);assert.deepEqual(independent.originals,one.originals);
  assert.ok(independent.budget.statements>one.budget.statements,"independently issued equal originals retain both proofs");
  assert.ok(Date.parse(independent.validUntil)<=Math.min(Date.parse(another.validUntil),Date.parse(f.frames[0].validUntil)));
  for(const budget of [{statements:33-one.budget.statements,rows:0,bytes:0},
    {statements:0,rows:8193-one.budget.rows,bytes:0},{statements:0,rows:0,bytes:2097153-one.budget.bytes}])
    assert.equal(await prepareLegacyConversationOriginalsCommit(f.env,f.current,f.frames,budget),null,"caller ledger proofs share the same combined allowance");
  for(const handles of [[{...f.frames[0]}],[],[f.frames[0],{...another}]])
    assert.equal(await prepareLegacyConversationOriginalsCommit(f.env,f.current,handles,empty),null);
  assert.equal(await prepareLegacyConversationOriginalsCommit({...f.env},f.current,f.frames,empty),null);
  assert.deepEqual(f.ledgerFootprint(),before);
  const original=f.rows[0].user.text;
  f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(original+" distinct current body",f.rows[0].user.id);
  const changed=await captureLegacyConversationOriginals(f.env,f.current,f.interval);assert.ok(changed);
  assert.equal(await prepareLegacyConversationOriginalsCommit(f.env,f.current,[f.frames[0],changed],empty),null,
    "same event identity cannot collapse a stale proof into its later changed receipt");
});

test("structured native ledger: late original or authority drift aborts its complete body and head transaction",async t=>{
  for(const boundary of ["before-batch-source","during-body-source","during-head-source","during-head-authority","during-head-ledger-arrival"]){
    const f=await structuredLedgerFixture(t),expected=await f.ledgerRead();assert.ok(expected);
    const proposed=structuredLedgerProposal(f,expected,structuredLedgerDeclaration(f,0)),before=f.ledgerFootprint();
    let fired=0,external;
    const mutation=()=>{
      fired++;
      if(boundary==="during-head-authority")f.sqlite.prepare("UPDATE users SET role='suspended' WHERE user_id=?").run(f.actorId);
      else if(boundary==="during-head-ledger-arrival")f.sqlite.prepare("UPDATE memory_structured_conversation_heads SET annotation_count=annotation_count+1").run();
      else f.sqlite.prepare("UPDATE private_content SET content=content||' late changed original' WHERE content_id=?").run(f.rows[0].user.id);
    };
    if(boundary==="before-batch-source")f.hooks.beforeBatch=statements=>{
      if(!fired&&statements.some(statement=>statement.sql.includes("INSERT INTO memory_structured_conversation_revisions"))){mutation();external=f.ledgerFootprint();}
    };
    else f.hooks.afterStatement=(statement,kind)=>{
      const body=statement.sql.includes("INSERT INTO private_content")&&statement.values.includes(STRUCTURED_LEDGER_KIND);
      const head=/^(?:INSERT INTO|UPDATE) memory_structured_conversation_heads/u.test(statement.sql.trim());
      if(!fired&&kind==="run"&&(boundary==="during-body-source"?body:head))mutation();
    };
    await assert.rejects(()=>f.ledgerAppend(expected,proposed),/memory-structured-write-unconfirmed/u,boundary);assert.equal(fired,1,boundary);
    assert.deepEqual(f.ledgerFootprint(),external??before,"outside changes survive; all own in-batch state rolls back");
    if(boundary==="during-head-authority")assert.equal(f.sqlite.prepare("SELECT role FROM users WHERE user_id=?").get(f.actorId).role,"creator");
  }
});

test("structured native ledger: failed or genuinely ignored writes cannot leave publication fragments",async t=>{
  for(const boundary of ["body","resource","retention","revision","head","late-proof","ignored-body"]){
    const f=await structuredLedgerFixture(t,{mode:"shared-collaborator"}),expected=await f.ledgerRead();assert.ok(expected);
    const proposed=structuredLedgerProposal(f,expected,structuredLedgerDeclaration(f,0)),before=f.ledgerFootprint();let fired=0;
    f.hooks.beforeStatement=(statement,kind)=>{
      if(fired||kind!=="run")return;
      const table={body:"private_content",resource:"project_resource_scopes",retention:"private_content_retention_scopes",
        revision:"memory_structured_conversation_revisions",head:"memory_structured_conversation_heads"}[boundary];
      if(table&&statement.sql.startsWith("INSERT INTO "+table)){fired++;throw new Error("fixture ledger write failure");}
    };
    if(boundary==="late-proof")f.hooks.afterStatement=(statement,kind)=>{
      if(!fired&&kind==="run"&&statement.sql.startsWith("INSERT INTO memory_structured_conversation_revisions")){
        fired++;f.sqlite.prepare("DELETE FROM memory_structured_conversation_revisions").run();
      }
    };
    if(boundary==="ignored-body"){
      // Owned temporary fixture fault only: the real INSERT returns zero rows;
      // no production0032 object or D1 acknowledgement is replaced.
      f.sqlite.exec("CREATE TEMP TRIGGER structured_fixture_ignore_body BEFORE INSERT ON main.private_content WHEN NEW.kind='memory-structured-ledger' BEGIN SELECT RAISE(IGNORE); END");
      f.hooks.afterStatement=(statement,kind,result)=>{
        if(kind==="run"&&statement.sql.startsWith("INSERT INTO private_content")&&statement.values.includes(STRUCTURED_LEDGER_KIND)){
          fired++;assert.equal(result.meta.changes,0,"actual SQLite ignored this exact ledger-body insert");
        }
      };
    }
    try{await assert.rejects(()=>f.ledgerAppend(expected,proposed),/memory-structured-write-unconfirmed/u,boundary);assert.equal(fired,1,boundary);assert.deepEqual(f.ledgerFootprint(),before);}
    finally{if(boundary==="ignored-body")f.sqlite.exec("DROP TRIGGER temp.structured_fixture_ignore_body");}
  }
});

test("structured native ledger: malformed postcommit acknowledgement is unconfirmed rather than fictional rollback",async t=>{
  const f=await structuredLedgerFixture(t),expected=await f.ledgerRead();assert.ok(expected);
  const proposed=structuredLedgerProposal(f,expected,structuredLedgerDeclaration(f,0));let fired=0;
  f.hooks.afterBatch=(statements,results)=>{
    if(fired||!statements.some(statement=>statement.sql.includes("INSERT INTO memory_structured_conversation_revisions")))return;
    fired++;results[results.length-1]={success:true,results:[]};
  };
  await assert.rejects(()=>f.ledgerAppend(expected,proposed),/memory-structured-write-unconfirmed/u);assert.equal(fired,1);
  assert.equal(structuredLedgerHead(f).storage_revision,1);assert.equal(structuredLedgerRevisions(f).length,1,"actual transaction committed before receipt damage");
  f.hooks.afterBatch=null;const current=await f.ledgerRead();assert.ok(current);assert.deepEqual(current.ledger,proposed);
});

test("structured native ledger: ordinary hydration and native reference export omit private ledger canaries",async t=>{
  const {loadPrivateContent}=await import("../worker/pilot-policy.ts");
  const {exportLiveMemory}=await import("../worker/memory-live-export.ts");
  for(const mode of ["personal","shared-collaborator","shared-owner"]){
    const f=await structuredLedgerFixture(t,{mode}),canary="LEDGER_ONLY_CANARY_"+mode;
    const written=await structuredLedgerPublish(f,0,null,{itemId:canary}),bodyRef=structuredLedgerHead(f).current_body_ref;
    assert.match(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(bodyRef).content,new RegExp(canary));
    const scope=f.current.binding.scope??undefined,ordinary={contentId:`retained-ordinary-condition-${mode}`},created=at(-1_000),expires=f.expiry;
    // This is retained read evidence, not a new purchase by the viewer fixture.
    assert.equal(f.insert("private_content",{content_id:ordinary.contentId,owner_id:f.actorId,kind:"condition",content:"Ordinary authorized condition",
      created_at:created,expires_at:expires,redacted_at:null}).changes,1);
    if(scope){
      assert.equal(f.insert("project_resource_scopes",{project_access_id:scope.projectAccessId,resource_kind:"content",resource_id:ordinary.contentId,
        organization_id:scope.organizationId,project_id:scope.projectId,owner_user_id:scope.ownerUserId,visibility:"actor_private",
        source_event_id:null,actor_user_id:f.actorId,created_at:created}).changes,1);
      assert.equal(f.insert("private_content_retention_scopes",{content_id:ordinary.contentId,organization_id:scope.organizationId,project_access_id:scope.projectAccessId,
        project_id:scope.projectId,actor_user_id:f.actorId,classification:"transient-private",policy_version:0,assigned_expires_at:expires,created_at:created}).changes,1);
    }
    const before=f.ledgerFootprint();
    for(const view of ["all","chat","memory"]){
      const loaded=await loadPrivateContent(f.env,f.actorId,view,scope);
      assert.equal(Object.hasOwn(loaded,bodyRef),false);assert.equal(JSON.stringify(loaded).includes(canary),false);
      if(view!=="memory")assert.equal(loaded[f.rows[0].user.id],f.rows[0].user.text,"an ordinary original remains readable");
      if(view!=="chat")assert.equal(loaded[ordinary.contentId],"Ordinary authorized condition");
    }
    const response=await exportLiveMemory(f.env,f.enrollment,f.current.principal);assert.equal(response.status,200);
    const exported=await response.json();assert.equal(JSON.stringify(exported).includes(canary),false);
    assert.equal(JSON.stringify(exported).includes(bodyRef),false,"reference export does not become a dedicated ledger export");
    assert.deepEqual(f.ledgerFootprint(),before);assert.equal(written.ledger.semanticCompleteness,false);
  }
});

test("structured native ledger: actual shared rebuild preserves valid private custody without granting malformed history access",async t=>{
  for(const mode of ["shared-owner","shared-collaborator"]){
    const f=await structuredLedgerFixture(t,{mode}),written=await structuredLedgerPublish(f),bodyRef=structuredLedgerHead(f).current_body_ref;
    const shorter=at(90_000);
    f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(shorter,bodyRef);
    f.sqlite.prepare("UPDATE private_content_retention_scopes SET assigned_expires_at=? WHERE content_id=?").run(shorter,bodyRef);
    const resource=f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(bodyRef);
    const retention=f.sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=?").get(bodyRef);
    f.sqlite.prepare("UPDATE project_migration_states SET last_owner_sequence=0 WHERE project_access_id=?").run(f.projectAccessId);f.trace.length=0;
    const prepared=await f.prepare();assert.ok(!(prepared instanceof Response));f.current=prepared;
    assert.ok(f.trace.some(statement=>statement.sql.startsWith("INSERT INTO project_migration_states")&&statement.sql.includes("ON CONFLICT(project_access_id)")),"real reconstruction reaches activation, not the current-manifest fast path");
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(bodyRef),resource);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=?").get(bodyRef),retention);
    f.frames=[await captureLegacyConversationOriginals(f.env,f.current,f.interval)];assert.ok(f.frames[0]);
    const current=await f.ledgerRead();assert.ok(current);assert.deepEqual(current.ledger,written.ledger);assert.equal(current.expiresAt,shorter);
  }
  for(const fault of ["wrong-body","wrong-owner","wrong-actor","wrong-visibility","missing-retention"]){
    const f=await structuredLedgerFixture(t,{mode:"shared-owner"});await structuredLedgerPublish(f);const ref=structuredLedgerHead(f).current_body_ref;
    if(fault==="wrong-body")f.sqlite.prepare("UPDATE memory_structured_conversation_revisions SET body_ref=? WHERE revision=1").run(f.rows[0].user.id);
    if(fault==="wrong-owner")f.sqlite.prepare("UPDATE project_resource_scopes SET owner_user_id='foreign-owner' WHERE resource_kind='content' AND resource_id=?").run(ref);
    if(fault==="wrong-actor")f.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id='foreign-actor' WHERE resource_kind='content' AND resource_id=?").run(ref);
    if(fault==="wrong-visibility")f.sqlite.prepare("UPDATE project_resource_scopes SET visibility='collaborative_output' WHERE resource_kind='content' AND resource_id=?").run(ref);
    if(fault==="missing-retention")f.sqlite.prepare("DELETE FROM private_content_retention_scopes WHERE content_id=?").run(ref);
    f.sqlite.prepare("UPDATE project_migration_states SET last_owner_sequence=0 WHERE project_access_id=?").run(f.projectAccessId);f.trace.length=0;
    const prepared=await f.prepare();assert.ok(!(prepared instanceof Response));f.current=prepared;
    assert.ok(f.trace.some(statement=>statement.sql.startsWith("INSERT INTO project_migration_states")&&statement.sql.includes("ON CONFLICT(project_access_id)")),"fault case also runs actual reconstruction");
    f.frames=[await captureLegacyConversationOriginals(f.env,f.current,f.interval)];assert.ok(f.frames[0]);
    const before=f.ledgerFootprint();assert.equal(await f.ledgerRead(),null,fault);assert.deepEqual(f.ledgerFootprint(),before);
  }
  const f=await structuredLedgerFixture(t,{mode:"shared-owner"});await structuredLedgerPublish(f);
  f.sqlite.prepare("UPDATE project_migration_states SET last_owner_sequence=0 WHERE project_access_id=?").run(f.projectAccessId);let damaged=0;
  f.hooks.afterBatch=(statements,results)=>{
    if(!damaged&&statements.length>=3&&statements[0].sql.includes("memory_structured_schema_changed")){
      damaged++;results[results.length-1]={success:true,results:[]};
    }
  };
  const {synchronizeProjectScope}=await import("../worker/project-access.ts");
  const scope={organizationId:f.organizationId,projectAccessId:f.projectAccessId,projectId:f.projectId,ownerUserId:f.ownerId};
  await assert.rejects(()=>synchronizeProjectScope(f.env,scope),/project_scope_sync_unconfirmed/u);assert.equal(damaged,1);
  // This is a damaged acknowledgement after an actual chunk, not a rollback
  // assertion. A new guarded rebuild must independently finish its work.
  f.hooks.afterBatch=null;await synchronizeProjectScope(f.env,scope);
  assert.equal(f.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=?").get(f.projectAccessId).last_owner_sequence,f.current.sourceHead);
});

test("structured native ledger: absent, partial and changing schema never installs or resets a ledger",async t=>{
  const absent=await structuredLedgerFixture(t,{schema:false}),absentBefore=absent.ledgerFootprint();
  assert.equal(await absent.ledgerRead(),null);assert.deepEqual(absent.ledgerFootprint(),absentBefore);
  for(const boundary of ["partial","extra-index","disappearance-after-read","head-arrival-before-first-write"]){
    const f=await structuredLedgerFixture(t),read=await f.ledgerRead();assert.ok(read);
    if(boundary==="partial")f.sqlite.exec("DROP TABLE memory_structured_conversation_revisions");
    if(boundary==="extra-index")f.sqlite.exec("CREATE INDEX fixture_extra_ledger_index ON memory_structured_conversation_heads(updated_at)");
    if(boundary==="disappearance-after-read"){
      f.sqlite.exec("DROP TABLE memory_structured_conversation_revisions");f.sqlite.exec("DROP TABLE memory_structured_conversation_heads");
    }
    if(boundary==="head-arrival-before-first-write"){
      // A new exact head from another already-issued writer is an arrival,
      // not permission to reuse the old proven empty scope.
      await structuredLedgerPublish(f,0,await f.ledgerRead(),{itemId:"arriving-head"});
    }
    const before=f.ledgerFootprint(),proposed=structuredLedgerProposal(f,read,structuredLedgerDeclaration(f,0));
    assert.equal(await f.ledgerAppend(read,proposed),null,boundary);assert.deepEqual(f.ledgerFootprint(),before);
    if(boundary!=="head-arrival-before-first-write")assert.equal(await f.ledgerRead(),null,boundary);
  }
});

test("structured native ledger: current native retention tightens durable history without renewing its read lease",async t=>{
  const f=await structuredLedgerFixture(t,{mode:"shared-owner",pairs:1,expiryOffsetMs:30*86_400_000});
  const written=await structuredLedgerPublish(f),sourceCeiling=new Date(Math.min(...f.rows.flatMap(pair=>[pair.user,pair.assistant])
    .map(source=>Date.parse(source.event.recorded_at)+86_400_000))).toISOString();
  assert.ok(Date.parse(written.expiresAt)>Date.parse(sourceCeiling),"the stored body is not already limited by another earlier ceiling");
  assert.ok(Date.parse(f.enrollment.expires_at)>Date.parse(sourceCeiling));
  assert.ok(Date.parse(f.sqlite.prepare("SELECT expires_at FROM project_context_sessions WHERE context_id='structured-owner-context'").get().expires_at)>Date.parse(sourceCeiling));
  assert.ok(Date.parse(written.validUntil)<Date.parse(sourceCeiling),"short source/read authorization is not durable body retention");
  for(const source of f.rows.flatMap(pair=>[pair.user,pair.assistant]))assert.ok(Date.parse(source.expiry)>Date.parse(sourceCeiling));
  const stored=structuredLedgerRevisions(f),bodies=f.sqlite.prepare("SELECT * FROM private_content WHERE kind=? ORDER BY content_id").all(STRUCTURED_LEDGER_KIND);
  // Same-revision DB drift is an adversarial fixture, not a supported settings
  // transition. A fresh native read must still enforce the current lower cap.
  f.enrollment.retention_days=1;f.sqlite.prepare("UPDATE memory_live_enrollments SET retention_days=1 WHERE enrollment_id=?").run(f.enrollment.enrollment_id);
  const before=f.ledgerFootprint(),fresh=await f.ledgerRead();assert.ok(fresh);assert.equal(fresh.expiresAt,sourceCeiling);
  assert.ok(Date.parse(fresh.validUntil)<=Date.parse(written.validUntil));assert.deepEqual(f.ledgerFootprint(),before);
  assert.deepEqual(structuredLedgerRevisions(f),stored);assert.deepEqual(f.sqlite.prepare("SELECT * FROM private_content WHERE kind=? ORDER BY content_id").all(STRUCTURED_LEDGER_KIND),bodies);
  f.enrollment.enrolled_at=at(-1_000);f.sqlite.prepare("UPDATE memory_live_enrollments SET enrolled_at=? WHERE enrollment_id=?").run(f.enrollment.enrolled_at,f.enrollment.enrollment_id);
  const changed=f.ledgerFootprint();assert.equal(await f.ledgerRead(),null,"existing retained dependencies cannot move before current enrollment");
  assert.deepEqual(f.ledgerFootprint(),changed);
});

test("structured native ledger: annotation and complete-body budgets reject before private publication",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1}),initial=await f.ledgerRead();assert.ok(initial);
  const full=structuredLedgerProposal(f,initial,structuredLedgerDeclaration(f,0));
  full.annotations=Array.from({length:256},(_,index)=>structuredLedgerDeclaration(f,0,{itemId:"item-"+index}));
  assert.ok(Buffer.byteLength(JSON.stringify(full),"utf8")<131_072,"annotation count control stays within the separate body budget");
  const excess=copy(full);excess.annotations.push(structuredLedgerDeclaration(f,0,{itemId:"item-256"}));
  const before=f.ledgerFootprint();assert.equal(await f.ledgerAppend(initial,excess),null);assert.deepEqual(f.ledgerFootprint(),before);
  const accepted=await f.ledgerAppend(initial,full);assert.ok(accepted);assert.equal(accepted.ledger.annotations.length,256);
  const long=await structuredLedgerFixture(t,{pairs:1,texts:[["Exact original "+"x".repeat(2_900),"Ordinary assistant original"]]});
  const longRead=await long.ledgerRead();assert.ok(longRead);
  const declaration=structuredLedgerDeclaration(long,0);declaration.end=Array.from(long.rows[0].user.text).length;declaration.text=long.rows[0].user.text;
  const one=structuredLedgerProposal(long,longRead,declaration),legitimate=await long.ledgerAppend(longRead,one);assert.ok(legitimate,"the whole exact quote itself is eligible");
  const current=await long.ledgerRead();assert.ok(current);const oversized=copy(current.ledger);
  for(let index=1;index<=64;index++)oversized.annotations.push({...copy(declaration),itemId:"large-item-"+index});
  assert.ok(oversized.annotations.length<256);assert.ok(Buffer.byteLength(JSON.stringify(oversized),"utf8")>131_072);
  const longBefore=long.ledgerFootprint();assert.equal(await long.ledgerAppend(current,oversized),null);assert.deepEqual(long.ledgerFootprint(),longBefore);
});

async function structuredLedgerPersistedHistory(f,count,quoteLength) {
  const {canonicalConsent}=await import("../worker/consequential-consent.ts");
  assert.equal(f.enrollment.organization_id,null,"bounded metadata fixture uses personal custody");
  const initial=await f.ledgerRead();assert.ok(initial);const original=structuredLedgerDeclaration(f,0,{itemId:"x0"});
  original.end=quoteLength;original.text=Array.from(f.rows[0].user.text).slice(0,quoteLength).join("");
  assert.equal(Array.from(original.text).length,quoteLength);
  let ledger=structuredLedgerProposal(f,initial,original),written=await f.ledgerAppend(initial,ledger);assert.ok(written);
  const head={...structuredLedgerHead(f)},first=structuredLedgerRevisions(f)[0];
  const template={...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(first.body_ref)};
  let previousHash=first.body_hash,last=first;
  // Additional rows are explicitly synthetic persisted history, not 64 claimed
  // issued publications. The first write and later full native read are real.
  for(let revision=2;revision<=count;revision++){
    ledger={...ledger,annotations:[...ledger.annotations,{...copy(original),itemId:"x"+(revision-1)}]};
    const content=canonicalConsent(ledger),bodyRef="structured-budget-body-"+revision,hash=legacyOriginalDigest(content);
    assert.ok(Buffer.byteLength(content,"utf8")<=131_072,"individual body remains within its separate bound");
    f.insert("private_content",{...template,content_id:bodyRef,content});
    last={...first,revision,predecessor_revision:revision-1,predecessor_hash:previousHash,body_ref:bodyRef,body_hash:hash,annotation_count:revision};
    f.insert("memory_structured_conversation_revisions",last);previousHash=hash;
  }
  f.sqlite.prepare("UPDATE memory_structured_conversation_heads SET storage_revision=?,current_body_ref=?,current_body_hash=?,annotation_count=? WHERE ledger_id=?")
    .run(count,last.body_ref,last.body_hash,count,head.ledger_id);
  const history=structuredLedgerRevisions(f).map(revision=>({revision,
    body:{...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(revision.body_ref)},resources:[],retentions:[]}));
  return{ledger,history,bytes:Buffer.byteLength(canonicalConsent(history),"utf8")};
}
test("structured native ledger: immutable history has separate revision and cumulative encoded-byte limits",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1}),full=await structuredLedgerPersistedHistory(f,64,1);
  assert.ok(full.bytes<1_048_576,"64-revision positive is not accidentally over the byte ceiling");
  const current=await f.ledgerRead();assert.ok(current);assert.equal(current.revision,64);assert.deepEqual(current.ledger,full.ledger);
  const before=f.ledgerFootprint(),extra=structuredLedgerProposal(f,current,structuredLedgerDeclaration(f,0,{itemId:"x64"}));
  assert.ok(extra.annotations.length<256);assert.equal(await f.ledgerAppend(current,extra),null);assert.deepEqual(f.ledgerFootprint(),before);
  const larger=await structuredLedgerFixture(t,{pairs:1}),over=await structuredLedgerPersistedHistory(larger,64,200);
  assert.ok(over.bytes>1_048_576);assert.ok(over.bytes<2_097_152);
  assert.equal(structuredLedgerRevisions(larger).length,64);const changed=larger.ledgerFootprint();
  let schemaRow=null,historyRow=null;
  larger.hooks.afterBatch=(statements,results)=>{
    if(statements.length===1&&statements[0].sql.includes(" AS enrollment_json"))schemaRow=copy(results[0].results[0]);
    if(statements.length===1&&statements[0].sql.includes(" AS history_json"))historyRow=copy(results[0].results[0]);
  };
  assert.equal(await larger.ledgerRead(),null,"no last-N history, truncated negatives or fresh empty ledger");larger.hooks.afterBatch=null;
  assert.ok(schemaRow);assert.ok(historyRow);assert.equal(historyRow.history_json,null,"the native complete-history SQL cap itself rejects the oversized rowset");
  const {canonicalConsent}=await import("../worker/consequential-consent.ts");
  const uncapped={...historyRow,history_json:JSON.stringify(over.history)};
  const fullReadBytes=Buffer.byteLength(canonicalConsent(schemaRow),"utf8")+Buffer.byteLength(canonicalConsent(uncapped),"utf8");
  const combined=await prepareLegacyConversationOriginalsCommit(larger.env,larger.current,larger.frames,{statements:2,rows:2,bytes:fullReadBytes});
  assert.ok(combined,"even the exact untruncated projection plus genuine source proof fits the distinct aggregate allowance");
  assert.ok(combined.budget.bytes<=2_097_152);assert.deepEqual(larger.ledgerFootprint(),changed);
  const prefixCount=over.history.findIndex((_row,index)=>Buffer.byteLength(canonicalConsent(over.history.slice(0,index+1)),"utf8")>1_048_576);
  assert.ok(prefixCount>0&&prefixCount<64);
  const prefix=over.history.slice(0,prefixCount),next=copy(over.history[prefixCount]),last=prefix.at(-1).revision;
  // Retain the bounded synthetic prefix, not a claimed rollback of 64 issued
  // publications. Both this exact persisted prefix and the next declaration
  // still use the original genuine native source proofs.
  larger.sqlite.prepare("DELETE FROM memory_structured_conversation_revisions WHERE revision>?").run(prefixCount);
  for(const row of over.history.slice(prefixCount))larger.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(row.revision.body_ref);
  larger.sqlite.prepare("UPDATE memory_structured_conversation_heads SET storage_revision=?,current_body_ref=?,current_body_hash=?,annotation_count=? WHERE ledger_id=?")
    .run(prefixCount,last.body_ref,last.body_hash,last.annotation_count,last.ledger_id);
  assert.equal(Buffer.byteLength(canonicalConsent(prefix),"utf8")<=1_048_576,true);
  const under=await larger.ledgerRead();assert.ok(under);assert.equal(under.revision,prefixCount);
  const nextLedger=JSON.parse(next.body.content);assert.deepEqual(nextLedger.annotations.slice(0,-1),under.ledger.annotations);
  // Generated IDs cannot make the true next history smaller than this bound;
  // empty IDs are used ONLY in this byte oracle, never in a proposed record.
  next.revision.body_ref="";next.body.content_id="";
  assert.ok(Buffer.byteLength(canonicalConsent([...prefix,next]),"utf8")>1_048_576);
  assert.ok(prefixCount+1<=64);assert.ok(nextLedger.annotations.length<=256);
  assert.ok(Buffer.byteLength(canonicalConsent(nextLedger),"utf8")<=131_072);
  const beforeCrossing=larger.ledgerFootprint();assert.equal(await larger.ledgerAppend(under,nextLedger),null,"append crossing the cumulative-history ceiling is denied before writing");
  assert.deepEqual(larger.ledgerFootprint(),beforeCrossing);assert.deepEqual((await larger.ledgerRead()).ledger,under.ledger);
});

function assertStructuredLedgerFence(f,previous,{pending=false}={}) {
  const head=structuredLedgerHead(f);assert.ok(head);assert.equal(head.ledger_id,previous.ledger_id);
  assert.equal(head.storage_revision,previous.storage_revision);assert.equal(head.created_at,previous.created_at);
  assert.equal(head.state,pending?"retiring":"retired");assert.ok(head.first_terminal_at);
  for(const key of ["enrollment_id","enrollment_revision","permission_epoch","policy_version","current_body_ref","current_body_hash",
    "annotation_count","coverage_after_sequence","coverage_through_sequence","expires_at"])assert.equal(head[key],null,key);
  if(!pending){assert.equal(head.cleanup_turn,0);assert.equal(structuredLedgerRevisions(f).length,0);}
  for(const key of ["actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id"])assert.equal(head[key],previous[key]);
  return head;
}

test("structured native ledger: existing inverse paths erase private history but preserve a stable scope fence",async t=>{
  const store=await import("../worker/memory-live-store.ts");
  for(const path of ["personal","organization","enrollment"]){
    const f=await structuredLedgerFixture(t,{mode:path==="personal"?"personal":"shared-owner"});
    const first=await structuredLedgerPublish(f),read=await structuredLedgerPublish(f,1,first,
      {revision:2,operation:"withdraw",predecessor:{itemId:"declared-goal",revision:1}});
    const previous={...structuredLedgerHead(f)},revisions=structuredLedgerRevisions(f),ordinary=structuredLedgerOrdinaryFootprint(f);
    const firstRedactedAt=new Date().toISOString();
    f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(firstRedactedAt,revisions[0].body_ref);
    if(path==="enrollment"){
      const result=await store.revokeLiveMemoryCounted(f.env,f.enrollment,"forgotten");assert.equal(result.revoked,true);
    }else{
      const selector=path==="personal"?{actorUserId:f.actorId,personalOnly:true}:{organizationId:f.organizationId};
      await f.DB.batch(await store.liveMemoryErasureStatements(f.env,selector,new Date().toISOString()));
    }
    const fence=assertStructuredLedgerFence(f,previous);
    for(const revision of revisions){
      const body=f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(revision.body_ref);
      assert.equal(body.content,"");assert.ok(body.redacted_at);if(revision.revision===1)assert.equal(body.redacted_at,firstRedactedAt);
      assert.equal(f.sqlite.prepare("SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(revision.body_ref),undefined);
      assert.equal(f.sqlite.prepare("SELECT 1 FROM private_content_retention_scopes WHERE content_id=?").get(revision.body_ref),undefined);
    }
    const protectedAfter=structuredLedgerOrdinaryFootprint(f);
    for(const key of ["memory_live_enrollments","memory_live_sources"]){delete protectedAfter[key];delete ordinary[key];}
    assert.deepEqual(protectedAfter,ordinary,"ordinary originals, jobs, bodies and financial rows survive the memory inverse");
    assert.equal(await f.ledgerAppend(read,structuredLedgerProposal(f,read,structuredLedgerDeclaration(f,2,{itemId:"stale-restart"}))),null);
    const oldEnrollment=f.enrollment.enrollment_id;
    f.sqlite.prepare("DELETE FROM memory_live_enrollments WHERE enrollment_id=?").run(oldEnrollment);
    f.enrollment={...f.enrollment,enrollment_id:oldEnrollment+"-replacement",revision:1,learn_enabled:1,recall_enabled:1,
      background_enabled:0,expires_at:at(3_600_000),failure_code:null,lease_token:null,lease_expires_at:null,cutoff_sequence:null};
    f.insert("memory_live_enrollments",f.enrollment);
    assert.equal(await f.ledgerRead(),null,"a new enrollment identity must still find the retired durable scope");
    const plan=await store.prepareStructuredConversationWithdrawal(f.env,{enrollment:f.enrollment},new Date().toISOString());
    await f.DB.batch([...plan.statements,...plan.terminalAssertions]);
    assert.equal(structuredLedgerHead(f).first_terminal_at,fence.first_terminal_at);assert.equal(structuredLedgerHead(f).storage_revision,read.revision);
  }
});

test("structured native ledger: stale revoke cannot erase a newer exact enrollment or unrelated scope",async t=>{
  const {revokeLiveMemoryCounted,prepareStructuredConversationWithdrawal}=await import("../worker/memory-live-store.ts");
  const f=await structuredLedgerFixture(t,{mode:"shared-collaborator"}),stale=copy(f.enrollment);
  f.enrollment.revision++;f.sqlite.prepare("UPDATE memory_live_enrollments SET revision=? WHERE enrollment_id=?").run(f.enrollment.revision,f.enrollment.enrollment_id);
  const read=await structuredLedgerPublish(f),before=f.ledgerFootprint();
  const result=await revokeLiveMemoryCounted(f.env,stale);assert.equal(result.revoked,false);assert.deepEqual(f.ledgerFootprint(),before);
  for(const selector of [{actorUserId:f.actorId,personalOnly:true},{actorUserId:"unrelated-actor"},{organizationId:"unrelated-organization"}]){
    const plan=await prepareStructuredConversationWithdrawal(f.env,selector,new Date().toISOString());
    await f.DB.batch([...plan.statements,...plan.terminalAssertions]);assert.deepEqual(f.ledgerFootprint(),before);
  }
  assert.deepEqual((await f.ledgerRead()).ledger,read.ledger);
});

test("structured native ledger: held history stays unreadable and physical cleanup cannot target collateral content",async t=>{
  const {prepareStructuredConversationWithdrawal}=await import("../worker/memory-live-store.ts");
  const f=await structuredLedgerFixture(t,{mode:"shared-owner"});await structuredLedgerPublish(f);
  const previous={...structuredLedgerHead(f)},revision=structuredLedgerRevisions(f)[0],body={...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(revision.body_ref)};
  f.insert("organization_legal_holds",{hold_id:"structured-held-body",organization_id:f.organizationId,scope_kind:"content",resource_id:revision.body_ref,
    reason:"isolated fixture hold",status:"active",created_by_user_id:f.actorId,created_at:new Date().toISOString(),released_at:null});
  const plan=await prepareStructuredConversationWithdrawal(f.env,{enrollment:f.enrollment},new Date().toISOString());
  await f.DB.batch([...plan.statements,...plan.terminalAssertions]);const fence=assertStructuredLedgerFence(f,previous,{pending:true});
  assert.deepEqual({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(revision.body_ref)},body);
  assert.equal(structuredLedgerRevisions(f).length,1);assert.equal(await f.ledgerRead(),null,"logical retirement is not physical erasure");
  f.sqlite.prepare("UPDATE organization_legal_holds SET status='released',released_at=? WHERE hold_id=?").run(new Date().toISOString(),"structured-held-body");
  const released=await prepareStructuredConversationWithdrawal(f.env,{enrollment:f.enrollment},new Date().toISOString());
  await f.DB.batch([...released.statements,...released.terminalAssertions]);assertStructuredLedgerFence(f,previous);
  assert.equal(structuredLedgerHead(f).first_terminal_at,fence.first_terminal_at);
  for(const target of ["ordinary-original","other-actor-body"]){
    const bad=await structuredLedgerFixture(t,{mode:"shared-collaborator"});await structuredLedgerPublish(bad);
    let bodyRef=bad.rows[0].user.id;
    if(target==="other-actor-body"){
      const {preparePrivateContent}=await import("../worker/pilot-policy.ts");
      const stored=await preparePrivateContent(bad.env,bad.ownerId,"condition","COLLATERAL OWNER BODY",{...bad.current.binding.scope,actorUserId:bad.ownerId});
      await bad.DB.batch(stored.statements);bodyRef=stored.contentId;
    }
    const survivor=()=>({body:{...bad.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(bodyRef)},
      resources:bad.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").all(bodyRef).map(row=>({...row})),
      retention:bad.sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=?").all(bodyRef).map(row=>({...row}))});
    bad.sqlite.prepare("UPDATE memory_structured_conversation_revisions SET body_ref=? WHERE revision=1").run(bodyRef);
    const before=bad.ledgerFootprint(),protectedRows=survivor();
    await assert.rejects(()=>prepareStructuredConversationWithdrawal(bad.env,{enrollment:bad.enrollment},new Date().toISOString()),/memory-structured/u);
    assert.deepEqual(survivor(),protectedRows);assert.deepEqual(bad.ledgerFootprint(),before,"malformed metadata cannot claim collateral erasure");
  }
});

test("structured native ledger: a late hold after sidecar deletion still rolls back the complete inverse",async t=>{
  const {prepareStructuredConversationWithdrawal}=await import("../worker/memory-live-store.ts");
  const f=await structuredLedgerFixture(t,{mode:"shared-owner"});await structuredLedgerPublish(f);
  const before=f.ledgerFootprint(),bodyRef=structuredLedgerRevisions(f)[0].body_ref;
  const plan=await prepareStructuredConversationWithdrawal(f.env,{enrollment:f.enrollment},new Date().toISOString());let fired=0;
  f.hooks.afterStatement=(statement,kind)=>{
    if(!fired&&kind==="run"&&statement.sql.startsWith("DELETE FROM private_content_retention_scopes")){
      fired++;assert.equal(f.sqlite.prepare("SELECT 1 FROM private_content_retention_scopes WHERE content_id=?").get(bodyRef),undefined);
      f.insert("organization_legal_holds",{hold_id:"structured-late-hold",organization_id:f.organizationId,scope_kind:"project",resource_id:f.projectAccessId,
        reason:"isolated late hold",status:"active",created_by_user_id:f.actorId,created_at:new Date().toISOString(),released_at:null});
    }
  };
  await assert.rejects(()=>f.DB.batch([...plan.statements,...plan.terminalAssertions]));assert.equal(fired,1);
  assert.deepEqual(f.ledgerFootprint(),before);assert.equal(f.sqlite.prepare("SELECT 1 FROM organization_legal_holds WHERE hold_id='structured-late-hold'").get(),undefined);
});

function structuredLedgerAdmin(f) {
  const userId="structured-fixture-admin",createdAt=at(-60_000);
  f.insert("users",{user_id:userId,email:userId+"@example.test",display_name:userId,role:"admin",
    consent_version:POLICY_VERSION,consented_at:createdAt,created_at:createdAt,updated_at:createdAt});
  const headers={"oai-authenticated-user-id":userId,"oai-authenticated-user-email":userId+"@example.test","oai-authenticated-user-name":userId};
  return{userId,headers,dispose:()=>f.sqlite.prepare("DELETE FROM users WHERE user_id=?").run(userId)};
}

test("structured native ledger: actual personal privacy handler erases history after its own earlier private redaction",async t=>{
  const {handleEventPrivacy}=await import("../worker/privacy-api.ts");
  const f=await structuredLedgerFixture(t),admin=structuredLedgerAdmin(f);
  const actorHeaders={"oai-authenticated-user-id":f.actorId,"oai-authenticated-user-email":f.actorId+"@example.test",
    "oai-authenticated-user-name":f.actorId,"content-type":"application/json","origin":"http://localhost"};
  try{
    // The initial native fixture has historical public project events. Use the
    // existing administrator migration, not ad hoc immutable-event updates.
    const migrated=await handleEventPrivacy(new Request("http://localhost/api/privacy",{method:"POST",
      headers:{...admin.headers,"content-type":"application/json","origin":"http://localhost"},
      body:JSON.stringify({action:"migrate-historical-events",confirmation:"MIGRATE_HISTORICAL_EVENT_CONTENT"})}),f.env);
    assert.equal(migrated.status,200,await migrated.text());
    const status=await handleEventPrivacy(new Request("http://localhost/api/privacy",{headers:actorHeaders}),f.env);
    assert.equal(status.status,200);assert.equal((await status.json()).legacyAuthoredEvents,0);
    f.current=await f.prepare();assert.ok(!(f.current instanceof Response));
    f.frames=[await captureLegacyConversationOriginals(f.env,f.current,f.interval)];assert.ok(f.frames[0]);
    const first=await structuredLedgerPublish(f),negative=await structuredLedgerPublish(f,1,first,
      {revision:2,operation:"withdraw",predecessor:{itemId:"declared-goal",revision:1}});
    const previous={...structuredLedgerHead(f)},revisions=structuredLedgerRevisions(f);
    const events=f.sqlite.prepare("SELECT * FROM events ORDER BY sequence").all().map(row=>({...row}));
    const privateBefore=f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE owner_id=? AND redacted_at IS NULL AND kind!='document-artifact'").get(f.actorId).n;
    const eventBodiesBefore=f.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE owner_id=? AND redacted_at IS NULL").get(f.actorId).n;
    let earlyRedaction=0;
    f.hooks.afterStatement=(statement,kind)=>{
      if(kind==="run"&&statement.sql.startsWith("UPDATE private_content SET content='',redacted_at=?")&&statement.sql.includes("kind!='document-artifact'")){
        earlyRedaction++;for(const revision of revisions){const body=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(revision.body_ref);
          assert.equal(body.content,"");assert.ok(body.redacted_at);}
        assert.equal(structuredLedgerRevisions(f).length,2,"the privacy body's redaction precedes the memory inverse");
      }
    };
    const response=await handleEventPrivacy(new Request("http://localhost/api/privacy",{method:"POST",headers:actorHeaders,
      body:JSON.stringify({action:"erase-personal-authored-context",confirmation:"ERASE_MY_PERSONAL_AUTHORED_CONTEXT"})}),f.env);
    assert.equal(response.status,200);const receipt=await response.json();assert.equal(earlyRedaction,1);
    assert.equal(receipt.erasedTemporaryContent,privateBefore);assert.equal(receipt.erasedAuthoredEventBodies,eventBodiesBefore);
    assert.equal(receipt.otherDevicesAndBackupsPurged,false);assert.equal(receipt.sharedOrganizationContextRetained,true);
    assertStructuredLedgerFence(f,previous);assert.deepEqual(f.sqlite.prepare("SELECT * FROM events ORDER BY sequence").all().map(row=>({...row})),events);
    for(const source of f.rows.flatMap(pair=>[pair.user,pair.assistant])){
      const secret=f.sqlite.prepare("SELECT private_json,redacted_at FROM event_private_payloads WHERE private_event_id=?").get(source.event.event_id);
      assert.equal(secret.private_json,"");assert.ok(secret.redacted_at);
      const original=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(source.id);
      assert.equal(original.content,"");assert.ok(original.redacted_at);
    }
    for(const revision of revisions){const body=f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(revision.body_ref);
      assert.equal(body.content,"");assert.ok(body.redacted_at);}
    assert.equal(await f.ledgerRead(),null);assert.equal(await f.ledgerAppend(negative,structuredLedgerProposal(f,negative,structuredLedgerDeclaration(f,2,{itemId:"cannot-republish"}))),null);
  }finally{f.hooks.afterStatement=null;admin.dispose();}
});

test("structured native ledger: an absent-schema inverse cannot silently accept later ledger schema arrival",async t=>{
  const {prepareStructuredConversationWithdrawal}=await import("../worker/memory-live-store.ts");
  const f=await structuredLedgerFixture(t,{schema:false});
  const absent=await prepareStructuredConversationWithdrawal(f.env,{actorUserId:f.actorId,personalOnly:true},new Date().toISOString());
  f.sqlite.exec(readFileSync(new URL("../drizzle/0032_memory_structured_conversation_ledger.sql",import.meta.url),"utf8"));
  await structuredLedgerPublish(f);const before=f.ledgerFootprint();
  await assert.rejects(()=>f.DB.batch([...absent.statements,...absent.terminalAssertions]));
  assert.deepEqual(f.ledgerFootprint(),before,"newly committed schema/history is outside the earlier absence proof");
});

async function structuredLedgerPlatformFixture(f) {
  const admin=structuredLedgerAdmin(f),actorBefore={...f.sqlite.prepare("SELECT * FROM users WHERE user_id=?").get(f.actorId)};
  const {requirePlatformAssistantPrincipal}=await import("../worker/pilot-policy.ts");
  const {handlePlatformAssistant}=await import("../worker/platform-assistant-api.ts");
  try{
    const request=new Request("http://localhost/api/platform-assistant?route=%2Foperations%2Faccess",{headers:admin.headers});
    const authorization=await requirePlatformAssistantPrincipal(request,f.env);assert.equal(authorization.response,null);assert.ok(authorization.principal);
    assert.equal(authorization.principal.role,"admin");
    const response=await handlePlatformAssistant(new Request(request.url,{headers:{...admin.headers,"x-forma-assistant-audience":"operations",
      "x-forma-platform-permission-epoch":authorization.principal.access.permissionEpoch}}),f.env);
    assert.equal(response.status,200);const value=await response.json();assert.deepEqual(value.turns,[]);assert.deepEqual(value.tasks,[]);
    assert.ok(f.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='platform_assistant_private_content'").get());
    assert.deepEqual({...f.sqlite.prepare("SELECT * FROM users WHERE user_id=?").get(f.actorId)},actorBefore);
    // Existing handler initialization in this isolated fixture is not hosted
    // platform capability or scheduling qualification. No POST/provider call.
    return{...admin,epoch:authorization.principal.access.permissionEpoch};
  }catch(error){admin.dispose();throw error;}
}
function structuredLedgerOldBacklog(f,index,platform=null) {
  const createdAt=at(-120_000),expiresAt=at(-60_000),ids={private:"structured-old-private-"+index,artifact:"structured-old-artifact-"+index};
  f.insert("private_content",{content_id:ids.private,owner_id:f.actorId,kind:"condition",content:"EXPIRED ORDINARY PRIVATE "+index,
    created_at:createdAt,expires_at:expiresAt,redacted_at:null});
  f.insert("artifact_revisions",{revision_id:ids.artifact,owner_id:f.actorId,organization_id:null,project_access_id:null,
    project_id:f.projectId,document_id:f.documentId,artifact_id:"structured-old-artifact",revision:index+1,
    content_json:JSON.stringify({text:"EXPIRED ARTIFACT "+index}),content_sha256:legacyOriginalDigest("EXPIRED ARTIFACT "+index),
    created_by_user_id:f.actorId,created_at:createdAt,expires_at:expiresAt,redacted_at:null});
  if(platform){ids.platform="structured-old-platform-"+index;f.insert("platform_assistant_private_content",{content_id:ids.platform,
    actor_user_id:platform.userId,audience:"operations",route_family:"/operations/access",permission_epoch:platform.epoch,
    kind:"platform-chat-user",content:"EXPIRED PLATFORM "+index,created_at:createdAt,expires_at:expiresAt,redacted_at:null});}
  return ids;
}
function structuredLedgerOldCounts(f,platform=false) {
  return [f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE content_id LIKE 'structured-old-private-%' AND redacted_at IS NOT NULL").get().n,
    f.sqlite.prepare("SELECT COUNT(*) AS n FROM artifact_revisions WHERE revision_id LIKE 'structured-old-artifact-%' AND redacted_at IS NOT NULL").get().n,
    platform?f.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_assistant_private_content WHERE content_id LIKE 'structured-old-platform-%' AND redacted_at IS NOT NULL").get().n:0];
}
async function structuredLedgerExpireRetained(f) {
  // Shorten this isolated retained state's deadline without changing any source
  // event or the host/SQL clock; wait for the real future deadline to elapse.
  const deadline=at(30),head=structuredLedgerHead(f),revisions=structuredLedgerRevisions(f);
  assert.ok(revisions.every(row=>row.created_at<deadline));
  f.sqlite.prepare("UPDATE memory_structured_conversation_heads SET expires_at=? WHERE ledger_id=?").run(deadline,head.ledger_id);
  f.sqlite.prepare("UPDATE memory_structured_conversation_revisions SET expires_at=? WHERE ledger_id=?").run(deadline,head.ledger_id);
  for(const row of revisions){f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(deadline,row.body_ref);
    f.sqlite.prepare("UPDATE private_content_retention_scopes SET assigned_expires_at=? WHERE content_id=?").run(deadline,row.body_ref);}
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(deadline)-Date.now())+20));assert.ok(Date.now()>=Date.parse(deadline));
  return{...structuredLedgerHead(f)};
}

test("structured native ledger: finite cleanup remains fair with absent or fully populated optional old classes",async t=>{
  const {sweepExpiredPrivateContent}=await import("../worker/runtime.ts");
  for(const withPlatform of [false,true]){
    const f=await structuredLedgerFixture(t,{mode:"shared-owner"});let platform=null;
    try{
      if(withPlatform)platform=await structuredLedgerPlatformFixture(f);
      else assert.equal(f.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='platform_assistant_private_content'").get(),undefined);
      let read=await structuredLedgerPublish(f);read=await structuredLedgerPublish(f,1,read,{itemId:"second-retained-item"});
      await structuredLedgerPublish(f,2,read,{itemId:"third-retained-item"});
      const previous=await structuredLedgerExpireRetained(f),bodyIds=structuredLedgerRevisions(f).map(row=>row.body_ref);
      const visits=[],expectedClasses=withPlatform?[0,1,2,3]:[0,1,3];let units=0,ledgerUnits=0;
      // Every call replenishes all available old classes, so a ledger turn is
      // never explained by exhaustion of the prior-class backlog.
      while(structuredLedgerHead(f).state!=="retired"&&units<24){
        structuredLedgerOldBacklog(f,units,platform);
        const old=structuredLedgerOldCounts(f,withPlatform),head={...structuredLedgerHead(f)},rows=structuredLedgerRevisions(f);
        let changed=0,commits=0;f.hooks.afterStatement=(_statement,kind,result)=>{if(kind==="run")changed+=Number(result.meta.changes);};
        f.hooks.afterBatch=statements=>{if(statements.some(statement=>statement.sql.startsWith("UPDATE memory_structured_conversation_heads"))){
          commits++;const revision=statements.some(statement=>statement.sql.startsWith("DELETE FROM memory_structured_conversation_revisions"));
          assert.equal(statements.length,revision?18:9,"bounded guarded target commit, not a claim about all preparation round trips");
        }};
        const processed=await sweepExpiredPrivateContent(f.env,1);f.hooks.afterStatement=null;
        f.hooks.afterBatch=null;assert.equal(commits,1);assert.equal(processed,1);assert.ok(changed>=1&&changed<=5,"one bounded work unit, not an unbounded physical-row erase");units++;
        const current=structuredLedgerHead(f),remaining=structuredLedgerRevisions(f),counts=structuredLedgerOldCounts(f,withPlatform);
        const ordinary=counts.map((value,index)=>value-old[index]);assert.ok(ordinary.every(value=>value===0||value===1));
        const physicalLedgerChange=current.state!==head.state||remaining.length!==rows.length;
        if(physicalLedgerChange){assert.equal(ordinary.reduce((a,b)=>a+b,0),0);visits.push(3);ledgerUnits++;
          assert.ok(rows.length-remaining.length>=0&&rows.length-remaining.length<=1);
        }else{assert.equal(ordinary.reduce((a,b)=>a+b,0),1);visits.push(ordinary.indexOf(1));assert.deepEqual(remaining,rows);}
        if(current.state!=="retired")assert.equal(current.cleanup_turn,(visits.at(-1)+1)%4,"next call resumes the persisted successor slot");
        for(let start=0;start+expectedClasses.length<=visits.length;start++)
          assert.deepEqual([...new Set(visits.slice(start,start+expectedClasses.length))].sort(),expectedClasses,"continuously eligible classes all get a finite opportunity");
      }
      assert.equal(ledgerUnits,5,"head retirement, three exact revision/body units, then the terminal fence each cost a unit");
      assertStructuredLedgerFence(f,previous);assert.equal(await f.ledgerRead(),null);
      for(const id of bodyIds){const body=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(id);
        assert.equal(body.content,"");assert.ok(body.redacted_at);}
      // A larger allowance still reports actual bounded work, with no claim of
      // ordinary inter-class fairness once no executable ledger anchor remains.
      const old=structuredLedgerOldCounts(f,withPlatform),processed=await sweepExpiredPrivateContent(f.env,3);
      assert.equal(processed,3);assert.equal(structuredLedgerOldCounts(f,withPlatform).reduce((sum,value,index)=>sum+value-old[index],0),3);
    }finally{f.hooks.afterStatement=null;f.hooks.afterBatch=null;if(platform){f.sqlite.prepare("DELETE FROM platform_assistant_private_content WHERE actor_user_id=?").run(platform.userId);platform.dispose();}}
  }
  const mixed=await structuredLedgerFixture(t,{mode:"shared-owner"}),platform=await structuredLedgerPlatformFixture(mixed);
  try{
    let read=await structuredLedgerPublish(mixed);read=await structuredLedgerPublish(mixed,1,read,{itemId:"mixed-second"});
    await structuredLedgerPublish(mixed,2,read,{itemId:"mixed-third"});await structuredLedgerExpireRetained(mixed);
    let previousHead={...structuredLedgerHead(mixed)},previousRows=structuredLedgerRevisions(mixed),previousCounts=structuredLedgerOldCounts(mixed,true),seed=0;
    const visits=[];
    mixed.hooks.afterBatch=statements=>{
      if(!statements.some(statement=>statement.sql.startsWith("UPDATE memory_structured_conversation_heads")))return;
      const head=structuredLedgerHead(mixed),rows=structuredLedgerRevisions(mixed),counts=structuredLedgerOldCounts(mixed,true);
      const difference=counts.map((value,index)=>value-previousCounts[index]);
      const ledger=head.state!==previousHead.state||rows.length!==previousRows.length;
      if(ledger){assert.equal(difference.reduce((a,b)=>a+b,0),0);visits.push(3);}
      else{assert.equal(difference.reduce((a,b)=>a+b,0),1);visits.push(difference.indexOf(1));}
      assert.equal(head.cleanup_turn,(visits.at(-1)+1)%4);assert.ok(statements.length<=18);
      previousHead={...head};previousRows=rows;previousCounts=counts;
    };
    for(const limit of [3,1,3,1]){
      for(let index=0;index<3;index++)structuredLedgerOldBacklog(mixed,seed++,platform);
      const before=visits.length;let changes=0;mixed.hooks.afterStatement=(_statement,kind,result)=>{if(kind==="run")changes+=Number(result.meta.changes);};
      assert.equal(await sweepExpiredPrivateContent(mixed.env,limit),limit);assert.equal(visits.length-before,limit);assert.ok(changes<=limit*5);
      assert.notEqual(structuredLedgerHead(mixed).state,"retired","larger allowances run while the ledger and old classes remain simultaneously eligible");
    }
    assert.deepEqual(visits,[0,1,2,3,0,1,2,3]);assert.equal(structuredLedgerRevisions(mixed).length,2);
  }finally{mixed.hooks.afterBatch=null;mixed.hooks.afterStatement=null;mixed.sqlite.prepare("DELETE FROM platform_assistant_private_content WHERE actor_user_id=?").run(platform.userId);platform.dispose();}
});

test("structured native ledger: late digest-time caller and native changes cannot publish or expose an obsolete ledger",async t=>{
  for(const change of ["original-body","ledger-body","prepared","proposed","deployment"]){
    const f=await structuredLedgerFixture(t),read=await structuredLedgerPublish(f),head=structuredLedgerHead(f);
    const body=f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(head.current_body_ref).content;
    const proposed=structuredLedgerProposal(f,read,structuredLedgerDeclaration(f,1,{itemId:"late-append"}));
    const nativeDigest=crypto.subtle.digest;let fired=0,changed;
    const digest=t.mock.method(crypto.subtle,"digest",function(algorithm,data){
      const pending=nativeDigest.call(crypto.subtle,algorithm,data);
      if(!fired&&new TextDecoder().decode(data)===body){
        fired++;
        if(change==="original-body")f.sqlite.prepare("UPDATE private_content SET content=content||' late source change' WHERE content_id=?").run(f.rows[0].user.id);
        if(change==="ledger-body")f.sqlite.prepare("UPDATE private_content SET content=content||' late ledger change' WHERE content_id=?").run(head.current_body_ref);
        if(change==="prepared")f.current.sourceHead++;
        if(change==="proposed")proposed.annotations.at(-1).text="late caller mutation";
        if(change==="deployment")f.env.FORMA_MEMORY_ENABLED="false";
        changed=f.ledgerFootprint();
      }
      return pending;
    });
    try{
      const result=change==="proposed"?await f.ledgerAppend(read,proposed):await f.ledgerRead();
      assert.equal(result,null,change);assert.equal(fired,1);assert.ok(changed);assert.deepEqual(f.ledgerFootprint(),changed);
    }finally{digest.mock.restore();}
  }
});

test("structured native ledger: an actual preserving settings replacement still retires the prior ledger scope",async t=>{
  const {handleLiveMemory}=await import("../worker/memory-live-api.ts");
  const {LIVE_MEMORY_POLICY}=await import("../worker/memory-live-authority.ts");
  for(const acknowledgement of ["valid","truncated","outer-guard"]){
  const f=await structuredLedgerFixture(t),oldId=f.enrollment.enrollment_id;
  const enrollmentId=legacyOriginalDigest(JSON.stringify([f.actorId,"","",f.projectId,f.documentId]));
  // Match the native settings identity before any ledger exists, retaining all
  // genuinely prepared fixture authority and source-reference rows.
  const sources=f.sqlite.prepare("SELECT * FROM memory_live_sources WHERE enrollment_id=?").all(oldId).map(row=>({...row}));
  f.sqlite.prepare("DELETE FROM memory_live_sources WHERE enrollment_id=?").run(oldId);
  f.sqlite.prepare("DELETE FROM memory_live_enrollments WHERE enrollment_id=?").run(oldId);
  f.enrollment={...f.enrollment,enrollment_id:enrollmentId};f.insert("memory_live_enrollments",f.enrollment);
  for(const row of sources)f.insert("memory_live_sources",{...row,enrollment_id:enrollmentId});
  const read=await structuredLedgerPublish(f),previous={...structuredLedgerHead(f)},enrolledAt=f.enrollment.enrolled_at,revisions=structuredLedgerRevisions(f);
  let damaged=0;
  f.hooks.afterBatch=(statements,results)=>{
    if(acknowledgement!=="valid"&&statements.some(statement=>statement.sql.startsWith("INSERT INTO memory_live_enrollments")&&statement.sql.includes("ON CONFLICT(enrollment_id)"))){
      damaged++;if(acknowledgement==="truncated")results.splice(1);
      else results[0]={success:true,results:[]};
    }
  };
  const response=await handleLiveMemory(new Request("http://localhost/api/memory/settings",{method:"PUT",headers:{
    "oai-authenticated-user-id":f.actorId,"oai-authenticated-user-email":f.actorId+"@example.test","oai-authenticated-user-name":f.actorId,
    "content-type":"application/json","origin":"http://localhost"},body:JSON.stringify({projectId:f.projectId,documentId:f.documentId,
      learn:true,recall:true,background:false,retentionDays:f.enrollment.retention_days,timeZone:"UTC",expiresAt:f.enrollment.expires_at,
      revision:f.enrollment.revision,confirmation:"ENABLE_PERSONAL_MEMORY",policyVersion:LIVE_MEMORY_POLICY,expectedCustody:{kind:"personal"}})}),f.env,"settings");
  f.hooks.afterBatch=null;const value=await response.json();
  if(acknowledgement==="valid"){
    assert.equal(response.status,200);assert.equal(value.priorMemoryCleared,false,"the actual preserve=true branch is reached");
    assert.equal(value.historyStartsAt,enrolledAt);assert.equal(value.enrollment.revision,f.enrollment.revision+1);assert.equal(damaged,0);
  }else{
    assert.equal(damaged,1);assert.equal(response.status,409);assert.deepEqual(value,{error:"memory_write_unconfirmed"});
  }
  // Receipt damage occurs after the real SQLite commit. Physical cleanup and
  // the new enrollment remain observable even when the handler cannot confirm.
  const committed=f.sqlite.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=?").get(enrollmentId);
  assert.equal(committed.revision,f.enrollment.revision+1);assert.equal(committed.enrolled_at,enrolledAt);
  assertStructuredLedgerFence(f,previous);
  for(const revision of revisions){const body=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(revision.body_ref);
    assert.equal(body.content,"");assert.ok(body.redacted_at);
    assert.equal(f.sqlite.prepare("SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(revision.body_ref),undefined);
    assert.equal(f.sqlite.prepare("SELECT 1 FROM private_content_retention_scopes WHERE content_id=?").get(revision.body_ref),undefined);}
  f.enrollment={...f.sqlite.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=?").get(enrollmentId)};
  assert.equal(await f.ledgerRead(),null);assert.equal(await f.ledgerAppend(read,structuredLedgerProposal(f,read,structuredLedgerDeclaration(f,1,{itemId:"stale-settings-publisher"}))),null);
  }
});

test("structured native ledger: certified native access denial retires retained private history in the existing batch",async t=>{
  const {createLiveMemoryMaintenanceAttempt}=await import("../worker/memory-live-authority.ts");
  const {retireDeniedLiveMemoryCounted}=await import("../worker/memory-live-store.ts");
  const f=await structuredLedgerFixture(t,{mode:"shared-collaborator"});await structuredLedgerPublish(f);
  const previous={...structuredLedgerHead(f)},ordinary=structuredLedgerOrdinaryFootprint(f);
  f.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE user_id=?").run(new Date().toISOString(),f.actorId);
  const attempt=createLiveMemoryMaintenanceAttempt(f.env),resolution=await attempt.resolve(f.enrollment);
  assert.equal(resolution.status,"denied");assert.ok(resolution.certificate);
  const result=await retireDeniedLiveMemoryCounted(f.env,f.enrollment,attempt,resolution.certificate);assert.equal(result.retired,true);
  assertStructuredLedgerFence(f,previous);
  const terminal=f.sqlite.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=?").get(f.enrollment.enrollment_id);
  assert.equal(terminal.failure_code,"access-changed");assert.equal(terminal.learn_enabled,0);assert.equal(terminal.recall_enabled,0);
  assert.equal(terminal.revision,f.enrollment.revision+1);assert.equal(await f.ledgerRead(),null);
  const protectedAfter=structuredLedgerOrdinaryFootprint(f);
  for(const key of ["memory_live_enrollments","memory_live_sources","project_memberships"]){delete ordinary[key];delete protectedAfter[key];}
  assert.deepEqual(protectedAfter,ordinary,"the certified denial does not erase unrelated original or financial evidence");
});

test("structured native ledger: held or malformed cleanup targets do not starve eligible work or count as erased",async t=>{
  const {sweepExpiredPrivateContent}=await import("../worker/runtime.ts");
  const f=await structuredLedgerFixture(t,{mode:"shared-owner"}),first=await structuredLedgerPublish(f);
  await structuredLedgerPublish(f,1,first,{itemId:"eligible-sibling"});const previous=await structuredLedgerExpireRetained(f),rows=structuredLedgerRevisions(f);
  f.insert("organization_legal_holds",{hold_id:"structured-cleanup-hold",organization_id:f.organizationId,scope_kind:"content",resource_id:rows[0].body_ref,
    reason:"isolated cleanup hold",status:"active",created_by_user_id:f.actorId,created_at:new Date().toISOString(),released_at:null});
  const held={...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(rows[0].body_ref)};
  assert.equal(await sweepExpiredPrivateContent(f.env,10),2,"only logical retirement and the unheld sibling are eligible units");
  assertStructuredLedgerFence(f,previous,{pending:true});assert.deepEqual(structuredLedgerRevisions(f),[rows[0]]);
  assert.deepEqual({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(rows[0].body_ref)},held);
  structuredLedgerOldBacklog(f,0);const old=structuredLedgerOldCounts(f);
  assert.equal(await sweepExpiredPrivateContent(f.env,2),2);assert.deepEqual(structuredLedgerOldCounts(f),[old[0]+1,old[1]+1,0]);
  assert.equal(structuredLedgerHead(f).state,"retiring");assert.equal(await f.ledgerRead(),null);
  f.sqlite.prepare("UPDATE organization_legal_holds SET status='released',released_at=? WHERE hold_id='structured-cleanup-hold'").run(new Date().toISOString());
  assert.equal(await sweepExpiredPrivateContent(f.env,1),1);assert.equal(structuredLedgerRevisions(f).length,0);assert.equal(structuredLedgerHead(f).state,"retiring");
  assert.equal(await sweepExpiredPrivateContent(f.env,1),1);assertStructuredLedgerFence(f,previous);
  const bad=await structuredLedgerFixture(t,{mode:"shared-owner"}),a=await structuredLedgerPublish(bad);
  await structuredLedgerPublish(bad,1,a,{itemId:"sound-sibling"});await structuredLedgerExpireRetained(bad);
  const badRows=structuredLedgerRevisions(bad),collateral=bad.rows[0].user.id;
  bad.sqlite.prepare("UPDATE memory_structured_conversation_revisions SET body_ref=? WHERE revision=1").run(collateral);
  const protectedBody={...bad.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(collateral)};
  assert.equal(await sweepExpiredPrivateContent(bad.env,1),1,"logical retirement is possible without deleting malformed collateral");
  assert.equal(await sweepExpiredPrivateContent(bad.env,1),1,"a malformed sibling does not prevent the sound revision's cleanup");
  assert.equal(bad.sqlite.prepare("SELECT 1 FROM memory_structured_conversation_revisions WHERE body_ref=?").get(badRows[1].body_ref),undefined);
  structuredLedgerOldBacklog(bad,0);const before=structuredLedgerOldCounts(bad);
  await assert.rejects(()=>sweepExpiredPrivateContent(bad.env,2),/memory-structured-cleanup-unavailable/u);
  assert.deepEqual(structuredLedgerOldCounts(bad),[before[0]+1,before[1]+1,0],"read-only unavailable preparation still drains the remaining ordinary allowance before throwing");
  assert.deepEqual({...bad.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(collateral)},protectedBody);
  assert.equal(structuredLedgerHead(bad).state,"retiring");assert.equal(structuredLedgerRevisions(bad).length,1);
  const bound=await structuredLedgerFixture(t),replacement=await structuredLedgerFixture(t);
  await structuredLedgerPublish(bound);await structuredLedgerExpireRetained(bound);structuredLedgerOldBacklog(replacement,0);
  const originalDB=bound.env.DB,otherBefore=replacement.ledgerFootprint(),otherCounts=structuredLedgerOldCounts(replacement);let swapped=0;
  replacement.trace.length=0;
  bound.hooks.afterStatement=(statement,kind)=>{
    if(!swapped&&kind==="all"&&statement.sql.includes(" AS schema_json")){swapped++;bound.env.DB=replacement.DB;}
  };
  try{
    await assert.rejects(()=>sweepExpiredPrivateContent(bound.env,2));assert.equal(swapped,1);
    assert.deepEqual(replacement.ledgerFootprint(),otherBefore);assert.deepEqual(structuredLedgerOldCounts(replacement),otherCounts);
    assert.ok(replacement.trace.every(row=>/^\s*(?:SELECT|WITH)/u.test(row.sql)),"failed preparation cannot spend the allowance against a replacement DB binding");
  }finally{bound.env.DB=originalDB;bound.hooks.afterStatement=null;}
});

test("structured native ledger: unconfirmed cleanup stops its allowance and a new call resumes committed progress",async t=>{
  const {sweepExpiredPrivateContent,observeScheduledRetention}=await import("../worker/runtime.ts");
  const f=await structuredLedgerFixture(t,{mode:"shared-owner"});await structuredLedgerPublish(f);const previous=await structuredLedgerExpireRetained(f);
  const bodyRef=structuredLedgerRevisions(f)[0].body_ref;assert.equal(await sweepExpiredPrivateContent(f.env,1),1);
  assert.equal(structuredLedgerHead(f).state,"retiring");let damaged=0,batches=0;
  f.hooks.afterBatch=(statements,results)=>{
    if(statements.some(statement=>statement.sql.startsWith("DELETE FROM memory_structured_conversation_revisions"))){
      batches++;if(!damaged){damaged++;results[results.length-1]={success:true,results:[]};}
    }
  };
  await assert.rejects(()=>sweepExpiredPrivateContent(f.env,10),/memory-structured-cleanup-unconfirmed/u);
  assert.equal(damaged,1);assert.equal(batches,1);assert.equal(structuredLedgerRevisions(f).length,0);
  const body=f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(bodyRef);assert.equal(body.content,"");assert.ok(body.redacted_at);
  assert.equal(structuredLedgerHead(f).state,"retiring","a lost receipt cannot cause an in-call retry or an extra terminal work unit");
  f.hooks.afterBatch=null;
  // This calls the existing observer directly in the isolated fixture; it is
  // not evidence that a hosted scheduler ran or that other devices were erased.
  const processed=await observeScheduledRetention(f.env,1);assert.equal(processed,1);assertStructuredLedgerFence(f,previous);
  const receipt=f.sqlite.prepare("SELECT * FROM retention_sweep_runs ORDER BY started_at DESC,run_id DESC LIMIT 1").get();
  assert.equal(receipt.status,"completed");assert.equal(receipt.processed_count,1);assert.equal(receipt.remaining_count,0);
  assert.equal(await sweepExpiredPrivateContent(f.env,1),0,"the committed body unit is not counted again");
  const replacement=await structuredLedgerFixture(t);structuredLedgerOldBacklog(replacement,0);
  const originalDB=f.env.DB,otherBefore=replacement.ledgerFootprint(),otherCounts=structuredLedgerOldCounts(replacement);let swapped=0;
  replacement.trace.length=0;
  f.hooks.afterStatement=(statement,kind)=>{
    if(!swapped&&kind==="all"&&statement.sql.includes("AS units FROM pending")){swapped++;f.env.DB=replacement.DB;}
  };
  try{
    await assert.rejects(()=>observeScheduledRetention(f.env,1));assert.equal(swapped,1);
    assert.deepEqual(replacement.ledgerFootprint(),otherBefore);assert.deepEqual(structuredLedgerOldCounts(replacement),otherCounts);
    assert.equal(replacement.sqlite.prepare("SELECT COUNT(*) AS n FROM retention_sweep_runs").get().n,0);
    assert.ok(replacement.trace.every(row=>/^\s*(?:SELECT|WITH)/u.test(row.sql)),"neither cleanup nor failure/success metrics may move to the replacement binding");
    const failed=f.sqlite.prepare("SELECT * FROM retention_sweep_runs WHERE status='failed'").all();
    assert.equal(failed.length,1);assert.equal(failed[0].error_code,"retention_cleanup_failed");
  }finally{f.env.DB=originalDB;f.hooks.afterStatement=null;}
});

test("structured native ledger: actual forget distinguishes held physical cleanup from a completed erase",async t=>{
  const {handleLiveMemory}=await import("../worker/memory-live-api.ts");
  for(const held of [false,true]){
    const f=await structuredLedgerFixture(t,{mode:"shared-owner"}),first=await structuredLedgerPublish(f);
    const negative=await structuredLedgerPublish(f,1,first,{revision:2,operation:"withdraw",predecessor:{itemId:"declared-goal",revision:1}});
    const previous={...structuredLedgerHead(f)},rows=structuredLedgerRevisions(f),firstBody={...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(rows[0].body_ref)};
    if(held)f.insert("organization_legal_holds",{hold_id:"structured-forget-hold",organization_id:f.organizationId,scope_kind:"content",resource_id:rows[0].body_ref,
      reason:"isolated forget hold",status:"active",created_by_user_id:f.actorId,created_at:new Date().toISOString(),released_at:null});
    const remove=revision=>handleLiveMemory(new Request("http://localhost/api/memory/settings?id="+encodeURIComponent(f.enrollment.enrollment_id),{
      method:"DELETE",headers:{"oai-authenticated-user-id":f.actorId,"oai-authenticated-user-email":f.actorId+"@example.test",
        "oai-authenticated-user-name":f.actorId,"content-type":"application/json","origin":"http://localhost"},
      body:JSON.stringify({confirmation:"FORGET_MY_MEMORY",revision})}),f.env,"settings");
    const before=f.ledgerFootprint(),stale=await remove(f.enrollment.revision+1);assert.equal(stale.status,409);
    assert.deepEqual(await stale.json(),{error:"memory_revision_changed"});assert.deepEqual(f.ledgerFootprint(),before);
    const response=await remove(f.enrollment.revision),value=await response.json();
    if(held){
      assert.equal(response.status,200);assert.deepEqual(value,{erased:false,memoryWithdrawn:true,physicalCleanupPending:true,
        reEnrollmentRequired:true,otherDevicesAndBackupsPurged:false});
      assertStructuredLedgerFence(f,previous,{pending:true});assert.deepEqual(structuredLedgerRevisions(f),[rows[0]]);
      assert.deepEqual({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(rows[0].body_ref)},firstBody);
    }else{
      assert.equal(response.status,200);assert.deepEqual(value,{erased:true,reEnrollmentRequired:true,otherDevicesAndBackupsPurged:false});
      assertStructuredLedgerFence(f,previous);
    }
    const terminal=f.sqlite.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=?").get(f.enrollment.enrollment_id);
    assert.equal(terminal.revision,f.enrollment.revision+1);assert.equal(terminal.failure_code,"forgotten");
    assert.equal(terminal.learn_enabled,0);assert.equal(terminal.recall_enabled,0);assert.equal(terminal.background_enabled,0);
    assert.equal(await f.ledgerAppend(negative,structuredLedgerProposal(f,negative,structuredLedgerDeclaration(f,2,{itemId:"late-forget-write"}))),null);
    const cleared=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(rows[1].body_ref);
    assert.equal(cleared.content,"");assert.ok(cleared.redacted_at);
    if(held){
      const firstTerminal=structuredLedgerHead(f).first_terminal_at;
      f.sqlite.prepare("UPDATE organization_legal_holds SET status='released',released_at=? WHERE hold_id='structured-forget-hold'").run(new Date().toISOString());
      const retry=await remove(terminal.revision);assert.equal(retry.status,200);
      assert.deepEqual(await retry.json(),{erased:true,reEnrollmentRequired:true,otherDevicesAndBackupsPurged:false});
      assertStructuredLedgerFence(f,previous);assert.equal(structuredLedgerHead(f).first_terminal_at,firstTerminal);
    }
    for(const row of rows){const body=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(row.body_ref);
      assert.equal(body.content,"");assert.ok(body.redacted_at);
      assert.equal(f.sqlite.prepare("SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(row.body_ref),undefined);
      assert.equal(f.sqlite.prepare("SELECT 1 FROM private_content_retention_scopes WHERE content_id=?").get(row.body_ref),undefined);}
    // Actual Worker protocol only. The separately authored client/UI handling
    // and its visible interaction are not executed by this native fixture.
  }
  for(const timing of ["none","existing","late"]){
    const f=await structuredLedgerFixture(t,{schema:false});
    // Persisted actor-owned orphan data, not an issued ledger publication. Missing
    // ledger tables cannot establish its scope or prove that its prose was erased.
    const insertOrphan=()=>f.insert("private_content",{content_id:"structured-orphan-body",owner_id:f.actorId,kind:STRUCTURED_LEDGER_KIND,
      content:"ORPHAN_PRIVATE_LEDGER_CANARY",created_at:at(-1000),expires_at:at(60_000),redacted_at:null});
    if(timing==="existing")insertOrphan();
    const before=f.ledgerFootprint();let arrived=0;
    if(timing==="late")f.hooks.afterStatement=(statement,kind)=>{
      if(!arrived&&kind==="run"&&statement.sql.startsWith("UPDATE memory_live_enrollments SET learn_enabled=0,recall_enabled=0,background_enabled=0,revision=revision+1")){
        arrived++;assert.equal(f.sqlite.prepare("SELECT revision FROM memory_live_enrollments WHERE enrollment_id=?").get(f.enrollment.enrollment_id).revision,f.enrollment.revision+1);
        insertOrphan();assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id='structured-orphan-body'").get().content,"ORPHAN_PRIVATE_LEDGER_CANARY");
      }
    };
    try{
      const response=await handleLiveMemory(new Request("http://localhost/api/memory/settings?id="+encodeURIComponent(f.enrollment.enrollment_id),{
        method:"DELETE",headers:{"oai-authenticated-user-id":f.actorId,"oai-authenticated-user-email":f.actorId+"@example.test",
          "oai-authenticated-user-name":f.actorId,"content-type":"application/json","origin":"http://localhost"},
        body:JSON.stringify({confirmation:"FORGET_MY_MEMORY",revision:f.enrollment.revision})}),f.env,"settings");
      assert.equal(arrived,timing==="late"?1:0);
      if(timing!=="none"){
        assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:"memory_write_unconfirmed"});
        assert.deepEqual(f.ledgerFootprint(),before,timing==="late"
          ?"the actual local transaction rolls back late orphan arrival and enrollment writes; the API only claims unconfirmed"
          :"unresolvable dedicated data is neither guessed away nor reported erased");
      }else{
        assert.equal(response.status,200);assert.deepEqual(await response.json(),{erased:true,reEnrollmentRequired:true,otherDevicesAndBackupsPurged:false});
        const terminal=f.sqlite.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=?").get(f.enrollment.enrollment_id);
        assert.equal(terminal.failure_code,"forgotten");assert.equal(terminal.revision,f.enrollment.revision+1);
      }
    }finally{f.hooks.afterStatement=null;}
  }
});

test("structured native ledger: actual settings status follows stable scope through pending, completion and replacement",async t=>{
  const {handleLiveMemory}=await import("../worker/memory-live-api.ts");
  const {LIVE_MEMORY_POLICY}=await import("../worker/memory-live-authority.ts");
  const f=await structuredLedgerFixture(t,{mode:"shared-owner"}),initial=await f.ledgerRead();assert.ok(initial);
  const headers={"oai-authenticated-user-id":f.actorId,"oai-authenticated-user-email":f.actorId+"@example.test",
    "oai-authenticated-user-name":f.actorId,"content-type":"application/json","origin":"http://localhost","cookie":"forma_project_context=structured-owner-context"};
  const list=()=>handleLiveMemory(new Request("http://localhost/api/memory/settings",{headers}),f.env,"settings");
  const state=async(id=f.enrollment.enrollment_id)=>{
    const response=await list();assert.equal(response.status,200);const value=await response.json();
    assert.equal(JSON.stringify(value).includes("STATUS_PRIVATE_DECLARATION_CANARY"),false);
    const row=value.enrollments.find(enrollment=>enrollment.id===id);assert.ok(row);return row;
  };
  assert.deepEqual((await state()).structuredCleanup,{scopeKey:initial.ledgerId,state:"absent"});
  const first=await structuredLedgerPublish(f,0,initial,{itemId:"STATUS_PRIVATE_DECLARATION_CANARY"});
  await structuredLedgerPublish(f,1,first,{itemId:"STATUS_PRIVATE_DECLARATION_CANARY",revision:2,operation:"withdraw",
    predecessor:{itemId:"STATUS_PRIVATE_DECLARATION_CANARY",revision:1}});
  const beforeRead=f.ledgerFootprint();assert.deepEqual((await state()).structuredCleanup,{scopeKey:initial.ledgerId,state:"active"});
  assert.deepEqual(f.ledgerFootprint(),beforeRead,"status reads expose no ledger prose and do not renew private storage");
  const revisions=structuredLedgerRevisions(f);
  f.insert("organization_legal_holds",{hold_id:"structured-status-hold",organization_id:f.organizationId,scope_kind:"content",resource_id:revisions[0].body_ref,
    reason:"isolated status hold",status:"active",created_by_user_id:f.actorId,created_at:new Date().toISOString(),released_at:null});
  const remove=revision=>handleLiveMemory(new Request("http://localhost/api/memory/settings?id="+encodeURIComponent(f.enrollment.enrollment_id),{
    method:"DELETE",headers,body:JSON.stringify({confirmation:"FORGET_MY_MEMORY",revision})}),f.env,"settings");
  const withdrawn=await remove(f.enrollment.revision);assert.equal(withdrawn.status,200);
  assert.deepEqual(await withdrawn.json(),{erased:false,memoryWithdrawn:true,physicalCleanupPending:true,reEnrollmentRequired:true,otherDevicesAndBackupsPurged:false});
  const pending=await state();assert.deepEqual(pending.structuredCleanup,{scopeKey:initial.ledgerId,state:"pending"});
  assert.equal(pending.learn,false);assert.equal(pending.recall,false);assert.equal(structuredLedgerRevisions(f).length,1);
  const replacement=await handleLiveMemory(new Request("http://localhost/api/memory/settings",{method:"PUT",headers,body:JSON.stringify({
    projectId:f.projectId,documentId:f.documentId,learn:true,recall:true,background:false,retentionDays:30,timeZone:"UTC",expiresAt:at(3_600_000),
    revision:0,confirmation:"ENABLE_PERSONAL_MEMORY",policyVersion:LIVE_MEMORY_POLICY,
    expectedCustody:{kind:"organization",organizationId:f.organizationId,projectAccessId:f.projectAccessId,ownerUserId:f.ownerId}})}),f.env,"settings");
  assert.equal(replacement.status,200);const replacementValue=await replacement.json();
  assert.notEqual(replacementValue.enrollment.id,f.enrollment.enrollment_id,"actual settings identity differs from the original seeded enrollment ID");
  const replacementStatus=await state(replacementValue.enrollment.id);assert.equal(replacementStatus.learn,true);assert.equal(replacementStatus.recall,true);
  assert.deepEqual(replacementStatus.structuredCleanup,{scopeKey:initial.ledgerId,state:"pending"},"an active replacement cannot hide or reset the older retiring scope");
  assert.equal(replacementValue.priorMemoryCleared,false,"held history is not reported physically cleared by replacement");
  f.sqlite.prepare("UPDATE organization_legal_holds SET status='released',released_at=? WHERE hold_id='structured-status-hold'").run(new Date().toISOString());
  const completionHead={...structuredLedgerHead(f)};let damaged=0;
  f.hooks.afterBatch=(statements,results)=>{
    if(!damaged&&statements.some(statement=>statement.sql.startsWith("UPDATE memory_live_enrollments SET learn_enabled=0,recall_enabled=0,background_enabled=0,revision=revision+1"))){
      damaged++;results.length=0; // The native fixture has already committed.
    }
  };
  try{
    const completed=await remove(pending.revision);assert.equal(damaged,1);assert.equal(completed.status,409);
    assert.deepEqual(await completed.json(),{error:"memory_write_unconfirmed"});
  }finally{f.hooks.afterBatch=null;}
  assertStructuredLedgerFence(f,completionHead);
  const terminal=f.sqlite.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=?").get(f.enrollment.enrollment_id);
  assert.equal(terminal.failure_code,"forgotten");assert.equal(terminal.revision,pending.revision+1);
  for(const revision of revisions){
    const body=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(revision.body_ref);
    assert.equal(body.content,"");assert.ok(body.redacted_at);
    assert.equal(f.sqlite.prepare("SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(revision.body_ref),undefined);
    assert.equal(f.sqlite.prepare("SELECT 1 FROM private_content_retention_scopes WHERE content_id=?").get(revision.body_ref),undefined);
  }
  // A fresh status observation does not retroactively confirm the failed response.
  assert.deepEqual((await state()).structuredCleanup,{scopeKey:initial.ledgerId,state:"complete"});
  assert.deepEqual((await state(replacementValue.enrollment.id)).structuredCleanup,{scopeKey:initial.ledgerId,state:"complete"});
  const legacy=await structuredLedgerFixture(t,{schema:false});
  const legacyResponse=await handleLiveMemory(new Request("http://localhost/api/memory/settings",{headers:{
    "oai-authenticated-user-id":legacy.actorId,"oai-authenticated-user-email":legacy.actorId+"@example.test","oai-authenticated-user-name":legacy.actorId}}),legacy.env,"settings");
  assert.equal(legacyResponse.status,200);const legacyValue=await legacyResponse.json();
  assert.deepEqual(legacyValue.enrollments.find(row=>row.id===legacy.enrollment.enrollment_id).structuredCleanup,{scopeKey:null,state:"unreported"});
  for(const fault of ["duplicate-row","error-envelope","late-enrollment"]){
    let fired=0,changed;
    f.hooks.afterStatement=(statement,kind,result)=>{
      if(!fired&&kind==="all"&&statement.sql.includes("AS privacy_status_authorized")){
        fired++;assert.equal(result.results.length,1);
        if(fault==="duplicate-row")result.results.push(copy(result.results[0]));
        if(fault==="error-envelope")result.error="fixture-status-unavailable";
        if(fault==="late-enrollment")f.sqlite.prepare("UPDATE memory_live_enrollments SET revision=revision+1 WHERE enrollment_id=?").run(replacementValue.enrollment.id);
        changed=f.ledgerFootprint();
      }
    };
    try{
      const response=await list();assert.equal(fired,1);assert.equal(response.status,503);
      assert.deepEqual(await response.json(),{error:"memory_cleanup_status_unavailable"});assert.deepEqual(f.ledgerFootprint(),changed);
    }finally{f.hooks.afterStatement=null;}
    assert.deepEqual((await state(replacementValue.enrollment.id)).structuredCleanup,{scopeKey:initial.ledgerId,state:"complete"},"a new successful guarded observation is distinct from the failed request");
  }
  for(const boundary of ["enrollment-list","status-capture"]){
    const originalDB=f.env.DB,before=f.ledgerFootprint();let fired=0,replacementCalls=0;
    // A distinct binding transparently delegates unchanged native rows. Identity
    // rejection must not depend on finding different data in a second database.
    const otherDB={prepare(...args){replacementCalls++;return originalDB.prepare(...args);},
      batch(...args){replacementCalls++;return originalDB.batch(...args);}};
    f.hooks.afterStatement=(statement,kind)=>{
      const selected=boundary==="enrollment-list"?statement.sql.includes("enrollment_id>? ORDER BY enrollment_id LIMIT 51")
        :statement.sql.includes("AS privacy_status_authorized");
      if(!fired&&kind==="all"&&selected){fired++;f.env.DB=otherDB;}
    };
    try{
      const response=await list();assert.equal(fired,1);assert.equal(response.status,503);
      assert.deepEqual(await response.json(),{error:"memory_cleanup_status_unavailable"});
      assert.equal(replacementCalls,0,"no status work may continue through an exchanged request binding");
      assert.deepEqual(f.ledgerFootprint(),before);
    }finally{f.env.DB=originalDB;f.hooks.afterStatement=null;}
    assert.deepEqual((await state(replacementValue.enrollment.id)).structuredCleanup,{scopeKey:initial.ledgerId,state:"complete"});
  }
  // With all revisions gone, the unchanged schema permits a terminal key edit;
  // scope remains unique. This is contradictory metadata, not a new issued key.
  const wrongKey="f".repeat(64);assert.notEqual(wrongKey,initial.ledgerId);
  f.sqlite.prepare("UPDATE memory_structured_conversation_heads SET ledger_id=? WHERE ledger_id=?").run(wrongKey,initial.ledgerId);
  const contradictory=f.ledgerFootprint();
  const denied=await list();assert.equal(denied.status,503);assert.deepEqual(await denied.json(),{error:"memory_cleanup_status_unavailable"});
  assert.deepEqual(f.ledgerFootprint(),contradictory,"contradictory status never falls back to false absence or completion");
});

// Detached S4 privacy successor: real 0032 schema must not turn an unassociated
// dedicated private body into a confirmed erase. These cases reuse the existing
// native fixture and its actual caller transaction; no provider is invoked.
test("structured native ledger: schema-present forget rejects existing unassociated pending custody",async t=>{
  const {handleLiveMemory}=await import("../worker/memory-live-api.ts");
  for(const withHead of [false,true])for(const pending of ["prose","unredacted","resource","retention"]){
    const f=await structuredLedgerFixture(t,{mode:"shared-owner"});
    if(withHead)await structuredLedgerPublish(f);
    assert.equal(structuredLedgerRevisions(f).length,withHead?1:0);
    const orphanId="structured-schema-present-orphan",createdAt=at(-1000),expiresAt=at(60_000);
    f.insert("private_content",{content_id:orphanId,owner_id:f.actorId,kind:STRUCTURED_LEDGER_KIND,
      content:pending==="prose"?"SCHEMA_PRESENT_ORPHAN_CANARY":"",created_at:createdAt,expires_at:expiresAt,
      redacted_at:pending==="unredacted"?null:createdAt});
    if(pending==="resource")f.insert("project_resource_scopes",{project_access_id:f.projectAccessId,resource_kind:"content",resource_id:orphanId,
      organization_id:f.organizationId,project_id:f.projectId,owner_user_id:f.ownerId,visibility:"actor_private",
      source_event_id:null,actor_user_id:f.actorId,created_at:createdAt});
    if(pending==="retention")f.insert("private_content_retention_scopes",{content_id:orphanId,organization_id:f.organizationId,
      project_access_id:f.projectAccessId,project_id:f.projectId,actor_user_id:f.actorId,classification:"transient-private",
      policy_version:0,assigned_expires_at:expiresAt,created_at:createdAt});
    assert.equal(f.sqlite.prepare("SELECT 1 FROM memory_structured_conversation_revisions WHERE body_ref=?").get(orphanId),undefined);
    const before=f.ledgerFootprint(),headers={"oai-authenticated-user-id":f.actorId,"oai-authenticated-user-email":f.actorId+"@example.test",
      "oai-authenticated-user-name":f.actorId,"content-type":"application/json","origin":"http://localhost"};
    const response=await handleLiveMemory(new Request("http://localhost/api/memory/settings?id="+encodeURIComponent(f.enrollment.enrollment_id),{
      method:"DELETE",headers,body:JSON.stringify({confirmation:"FORGET_MY_MEMORY",revision:f.enrollment.revision})}),f.env,"settings");
    assert.equal(response.status,409,`${withHead}: ${pending}`);assert.deepEqual(await response.json(),{error:"memory_write_unconfirmed"});
    assert.deepEqual(f.ledgerFootprint(),before,"an unassociated body or residual custody is neither guessed away nor reported erased");
    const observed=await handleLiveMemory(new Request("http://localhost/api/memory/settings",{headers}),f.env,"settings");
    assert.equal(observed.status,503);assert.deepEqual(await observed.json(),{error:"memory_cleanup_status_unavailable"});
    assert.deepEqual(f.ledgerFootprint(),before,"status and withdrawal agree that the pending unassociated custody is unavailable");
  }
  const f=await structuredLedgerFixture(t);await structuredLedgerPublish(f);
  const revision=structuredLedgerRevisions(f)[0],body={...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(revision.body_ref)};
  // Deliberately corrupt only the registered ownership association. A revision
  // reference by itself cannot exempt the original actor's still-pending body.
  f.sqlite.prepare("UPDATE memory_structured_conversation_heads SET actor_user_id='foreign-ledger-actor',owner_user_id='foreign-ledger-actor'").run();
  const before=f.ledgerFootprint();
  const response=await handleLiveMemory(new Request("http://localhost/api/memory/settings?id="+encodeURIComponent(f.enrollment.enrollment_id),{
    method:"DELETE",headers:{"oai-authenticated-user-id":f.actorId,"oai-authenticated-user-email":f.actorId+"@example.test",
      "oai-authenticated-user-name":f.actorId,"content-type":"application/json","origin":"http://localhost"},
    body:JSON.stringify({confirmation:"FORGET_MY_MEMORY",revision:f.enrollment.revision})}),f.env,"settings");
  assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:"memory_write_unconfirmed"});
  assert.deepEqual({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(revision.body_ref)},body);
  assert.deepEqual(f.ledgerFootprint(),before,"a mismatched head actor is not trustworthy orphan attribution");
});

test("structured native ledger: schema-present orphan arrival brackets the complete forget caller batch",async t=>{
  const {handleLiveMemory}=await import("../worker/memory-live-api.ts");
  for(const withHead of [false,true])for(const timing of ["before-batch","after-enrollment-update"]){
    const f=await structuredLedgerFixture(t);if(withHead)await structuredLedgerPublish(f);
    const previous=f.ledgerFootprint(),owned=structuredLedgerRevisions(f),orphanId="structured-late-schema-orphan";
    const insertOrphan=()=>f.insert("private_content",{content_id:orphanId,owner_id:f.actorId,kind:STRUCTURED_LEDGER_KIND,
      content:"LATE_SCHEMA_PRESENT_ORPHAN_CANARY",created_at:at(-1000),expires_at:at(60_000),redacted_at:null});
    const enrollmentUpdate=statement=>statement.sql.startsWith("UPDATE memory_live_enrollments SET learn_enabled=0,recall_enabled=0,background_enabled=0,revision=revision+1");
    let arrived=0,external;
    if(timing==="before-batch")f.hooks.beforeBatch=statements=>{
      if(!arrived&&statements.some(enrollmentUpdate)){arrived++;insertOrphan();external=f.ledgerFootprint();}
    };
    else f.hooks.afterStatement=(statement,kind)=>{
      if(!arrived&&kind==="run"&&enrollmentUpdate(statement)){
        arrived++;assert.equal(f.sqlite.prepare("SELECT revision FROM memory_live_enrollments WHERE enrollment_id=?").get(f.enrollment.enrollment_id).revision,f.enrollment.revision+1);
        assert.equal(structuredLedgerRevisions(f).length,0,"the real ledger writes have already run before the caller's enrollment UPDATE");
        for(const row of owned){const body=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(row.body_ref);
          assert.equal(body.content,"");assert.ok(body.redacted_at);}
        insertOrphan();assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(orphanId).content,"LATE_SCHEMA_PRESENT_ORPHAN_CANARY");
      }
    };
    try{
      const response=await handleLiveMemory(new Request("http://localhost/api/memory/settings?id="+encodeURIComponent(f.enrollment.enrollment_id),{
        method:"DELETE",headers:{"oai-authenticated-user-id":f.actorId,"oai-authenticated-user-email":f.actorId+"@example.test",
          "oai-authenticated-user-name":f.actorId,"content-type":"application/json","origin":"http://localhost"},
        body:JSON.stringify({confirmation:"FORGET_MY_MEMORY",revision:f.enrollment.revision})}),f.env,"settings");
      assert.equal(arrived,1);assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:"memory_write_unconfirmed"});
      assert.deepEqual(f.ledgerFootprint(),timing==="before-batch"?external:previous,
        "native SQLite rollback is asserted separately from the API's deliberately unconfirmed response");
      const survivor=f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(orphanId);
      if(timing==="before-batch")assert.equal(survivor.content,"LATE_SCHEMA_PRESENT_ORPHAN_CANARY","arrival committed before the transaction is not deleted");
      else assert.equal(survivor,undefined,"arrival inside the failed transaction is actually rolled back");
    }finally{f.hooks.beforeBatch=null;f.hooks.afterStatement=null;}
  }
});

test("structured native ledger: genuine same-actor sibling scope survives forget and foreign orphan is not actor custody",async t=>{
  const {handleLiveMemory}=await import("../worker/memory-live-api.ts");
  const {liveMemoryErasureStatements}=await import("../worker/memory-live-store.ts");
  const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
  const documentId="structured-genuine-sibling-document",turnId="structured-genuine-sibling-turn",correlation="structured-genuine-sibling-correlation";
  const document=f.append("DocumentCreated",{project_id:f.projectId,document_id:documentId,title:"Synthetic sibling document"});
  const expiry=at(180_000),createdAt=at(-8000),texts=["Exact second-document declaration","Exact second-document answer"];
  const bodies=texts.map((text,index)=>{
    const role=index===0?"user":"assistant",id="structured-genuine-sibling-"+role;
    f.insert("private_content",{content_id:id,owner_id:f.actorId,kind:"chat-"+role,content:text,created_at:createdAt,expires_at:expiry,redacted_at:null});
    return{id,role,text,expiry};
  });
  const budget=f.event("BudgetReserved",{operation:"creative-chat",reservation_id:"sibling-historical-budget",cost_reservation_id:"sibling-historical-cost",
    reserved_tokens:12000,reserved_microusd:1,period:"2026-09",live_preview:false},
    {id:"structured-genuine-sibling-budget",actor:"worker:policy",correlation});
  const authored=f.event("ChatMessageSent",{turn_id:turnId,document_id:documentId,content_ref:bodies[0].id,content_expires_at:expiry,
    source_surface:"chat",live_preview:false},{id:"structured-genuine-sibling-message",actor:"user",correlation,causation:budget.event_id});
  const answered=f.event("AssistantReasoned",{operation:"creative-chat",turn_id:turnId,document_id:documentId,content_ref:bodies[1].id,content_expires_at:expiry,
    provider:"openai",provider_response_id:"sibling-historical-response",model_id:"historical-model",latency_ms:1,mutation_count:0,
    reference_pixel_mutation_count:0,preview_worthy:false,live_preview_requested:false,preview_queued:false,preview_direction_ref:null,preview_suppressed:false},
    {id:"structured-genuine-sibling-answer",actor:"model:forma-chat",correlation,causation:authored.event_id});
  const headers={"oai-authenticated-user-id":f.actorId,"oai-authenticated-user-email":f.actorId+"@example.test",
    "oai-authenticated-user-name":f.actorId,"content-type":"application/json","origin":"http://localhost"};
  const current=await prepareDocumentAuthority(new Request("http://localhost/api/context/read",{headers}),f.env,{projectId:f.projectId,documentId},"read");
  assert.ok(!(current instanceof Response),"a genuine new-document authority is required before sibling admission");
  const enrollment={...f.enrollment,enrollment_id:"structured-genuine-sibling-enrollment",document_id:documentId,
    permission_epoch:current.principal.access.permissionEpoch,cursor_sequence:answered.sequence};
  f.insert("memory_live_enrollments",enrollment);
  const rows=[{turnId,correlation,jobId:null,budget,user:{...bodies[0],event:authored},assistant:{...bodies[1],event:answered}}];
  const frames=[await captureLegacyConversationOriginals(f.env,current,{afterSequence:document.sequence,throughSequence:answered.sequence})];
  assert.ok(frames[0],"native private original receipts must be issued for the second document itself");
  const sibling={...f,documentId,current,enrollment,rows,frames,refs:rows.flatMap(pair=>[structuredLedgerRef(pair,pair.user),structuredLedgerRef(pair,pair.assistant)])};
  sibling.ledgerRead=()=>readStructuredConversationLedger(f.env,enrollment,current,frames);
  sibling.ledgerAppend=(expected,ledger)=>appendStructuredConversationLedger(f.env,enrollment,current,frames,expected,ledger);
  const admitted=await structuredLedgerPublish(sibling);assert.equal(admitted.status,"active");
  const readable=await sibling.ledgerRead();assert.ok(readable);assert.deepEqual(readable.ledger,admitted.ledger);
  const siblingRows=()=>{
    const head={...structuredLedgerHead(sibling)},revisions=f.sqlite.prepare("SELECT * FROM memory_structured_conversation_revisions WHERE ledger_id=? ORDER BY revision").all(head.ledger_id);
    return{head,revisions:revisions.map(row=>({...row})),bodies:revisions.map(row=>({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(row.body_ref)})),
      resources:revisions.flatMap(row=>f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").all(row.body_ref).map(value=>({...value}))),
      retentions:revisions.flatMap(row=>f.sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=?").all(row.body_ref).map(value=>({...value}))),
      enrollment:{...f.sqlite.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=?").get(enrollment.enrollment_id)}};
  };
  const protectedRows=siblingRows();assert.equal(protectedRows.revisions.length,1);assert.equal(protectedRows.bodies.length,1);
  assert.deepEqual(protectedRows.resources,[]);assert.deepEqual(protectedRows.retentions,[]);
  const foreignId="structured-foreign-actor-orphan";
  f.insert("private_content",{content_id:foreignId,owner_id:"unrelated-private-actor",kind:STRUCTURED_LEDGER_KIND,
    content:"FOREIGN_ACTOR_ORPHAN_CANARY",created_at:at(-1000),expires_at:at(60_000),redacted_at:null});
  const foreign={...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(foreignId)};
  const removed=await handleLiveMemory(new Request("http://localhost/api/memory/settings?id="+encodeURIComponent(f.enrollment.enrollment_id),{
    method:"DELETE",headers,body:JSON.stringify({confirmation:"FORGET_MY_MEMORY",revision:f.enrollment.revision})}),f.env,"settings");
  assert.equal(removed.status,200);assert.deepEqual(await removed.json(),{erased:true,reEnrollmentRequired:true,otherDevicesAndBackupsPurged:false});
  assert.deepEqual(siblingRows(),protectedRows,"genuinely admitted same-actor different-document custody is exempt, not collateral erasure");
  const after=await sibling.ledgerRead();assert.ok(after);assert.deepEqual(after.ledger,admitted.ledger);
  assert.deepEqual({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(foreignId)},foreign);
  // The broader actor inverse should still succeed despite the foreign orphan;
  // unlike the document-specific DELETE, it intentionally retires the sibling.
  await f.DB.batch(await liveMemoryErasureStatements(f.env,{actorUserId:f.actorId,personalOnly:true},new Date().toISOString()));
  assert.equal(structuredLedgerHead(sibling).state,"retired");assert.equal(await sibling.ledgerRead(),null);
  for(const body of protectedRows.bodies){const erased=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(body.content_id);
    assert.equal(erased.content,"");assert.ok(erased.redacted_at);}
  assert.deepEqual({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(foreignId)},foreign,"actor selection never guesses ownership of another actor's orphan");
});

test("structured native ledger: organization inverse is conservative for unattributable other-actor orphan custody",async t=>{
  const {liveMemoryErasureStatements}=await import("../worker/memory-live-store.ts");
  for(const timing of ["existing","after-enrollment-update"]){
    const f=await structuredLedgerFixture(t,{mode:"shared-owner"});await structuredLedgerPublish(f);
    const orphanId="structured-unattributed-organization-orphan",otherActor="consumption-actor";
    assert.notEqual(otherActor,f.actorId);assert.ok(f.sqlite.prepare("SELECT 1 FROM users WHERE user_id=?").get(otherActor));
    const insertOrphan=()=>f.insert("private_content",{content_id:orphanId,owner_id:otherActor,kind:STRUCTURED_LEDGER_KIND,
      content:"UNATTRIBUTED_ORGANIZATION_ORPHAN_CANARY",created_at:at(-1000),expires_at:at(60_000),redacted_at:null});
    if(timing==="existing")insertOrphan();
    const before=f.ledgerFootprint();let arrived=0;
    if(timing==="after-enrollment-update")f.hooks.afterStatement=(statement,kind)=>{
      if(!arrived&&kind==="run"&&statement.sql.startsWith("UPDATE memory_live_enrollments SET learn_enabled=0,recall_enabled=0,background_enabled=0,revision=revision+1")){
        arrived++;assert.equal(f.sqlite.prepare("SELECT revision FROM memory_live_enrollments WHERE enrollment_id=?").get(f.enrollment.enrollment_id).revision,f.enrollment.revision+1);
        assert.equal(structuredLedgerRevisions(f).length,0);insertOrphan();
        assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(orphanId).content,"UNATTRIBUTED_ORGANIZATION_ORPHAN_CANARY");
      }
    };
    try{
      await assert.rejects(async()=>f.DB.batch(await liveMemoryErasureStatements(f.env,{organizationId:f.organizationId},new Date().toISOString())));
      assert.equal(arrived,timing==="existing"?0:1);assert.deepEqual(f.ledgerFootprint(),before);
      const orphan=f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(orphanId);
      if(timing==="existing")assert.equal(orphan.content,"UNATTRIBUTED_ORGANIZATION_ORPHAN_CANARY","unknown organization association does not authorize deletion");
      else assert.equal(orphan,undefined,"the real terminal guard aborts the full caller transaction, including the late insertion");
    }finally{f.hooks.afterStatement=null;}
  }
});

// R5 separately closes the S4 shared-custody preservation qualification gap.
// All sidecars below belong to actually admitted new-document originals and
// native ledger publication; no previously scoped ledger body is copied.
test("structured native ledger: genuine shared sibling and its nonempty custody sidecars survive selected-scope forget",async t=>{
  const {handleLiveMemory}=await import("../worker/memory-live-api.ts");
  let state;const jobId="structured-shared-sibling-job";
  const local={after:callback=>t.after(()=>{
    try{if(state)state.sqlite.prepare("DELETE FROM document_jobs WHERE job_id=?").run(jobId);}
    finally{callback();}
  })};
  const f=state=await structuredLedgerFixture(local,{mode:"shared-collaborator",pairs:1});
  await structuredLedgerPublish(f);
  const selectedHead={...structuredLedgerHead(f)},selectedBodies=f.sqlite.prepare(
    "SELECT body_ref FROM memory_structured_conversation_revisions WHERE ledger_id=? ORDER BY revision").all(selectedHead.ledger_id);
  assert.equal(selectedBodies.length,1,"selected-scope body erasure checks must be nonvacuous");
  const documentId="structured-shared-sibling-document",turnId="structured-shared-sibling-turn",expiry=at(180_000),createdAt=at(-8000);
  const document=f.append("DocumentCreated",{project_id:f.projectId,document_id:documentId,title:"Synthetic shared sibling document"},
    {actor:"user:"+f.ownerId});
  f.insert("project_resource_scopes",{project_access_id:f.projectAccessId,resource_kind:"document",resource_id:documentId,
    organization_id:f.organizationId,project_id:f.projectId,owner_user_id:f.ownerId,visibility:"collaborative_output",
    source_event_id:document.event_id,actor_user_id:f.ownerId,created_at:document.recorded_at});
  const texts=["Exact shared second-document declaration","Exact shared second-document answer"];
  f.insert("document_jobs",{job_id:jobId,owner_id:f.actorId,stream_id:f.stream,document_id:documentId,kind:"chat",status:"completed",
    source_surface:"chat",correlation_id:jobId,requested_sequence:document.sequence,
    request_json:JSON.stringify({message:texts[0],livePreview:false}),result_json:"{}",error_message:null,attempt_count:1,
    requested_at:createdAt,started_at:createdAt,completed_at:at(-6000),lease_expires_at:null,notified_at:null,expires_at:expiry,updated_at:at(-6000)});
  const anchor=f.event("ProjectDocumentJobQueued",{job_id:jobId,document_id:documentId,kind:"chat",organization_id:f.organizationId,
    project_access_id:f.projectAccessId,project_id:f.projectId,history_owner_user_id:f.ownerId,actor_user_id:f.actorId},
    {id:"structured-shared-sibling-anchor",actor:"user:"+f.actorId,correlation:jobId});
  f.insert("project_resource_scopes",{project_access_id:f.projectAccessId,resource_kind:"job",resource_id:jobId,
    organization_id:f.organizationId,project_id:f.projectId,owner_user_id:f.ownerId,visibility:"actor_private",
    source_event_id:anchor.event_id,actor_user_id:f.actorId,created_at:createdAt});
  const bodies=texts.map((text,index)=>{
    const role=index===0?"user":"assistant",id="structured-shared-sibling-"+role;
    f.insert("private_content",{content_id:id,owner_id:f.actorId,kind:"chat-"+role,content:text,created_at:createdAt,expires_at:expiry,redacted_at:null});
    f.insert("project_resource_scopes",{project_access_id:f.projectAccessId,resource_kind:"content",resource_id:id,
      organization_id:f.organizationId,project_id:f.projectId,owner_user_id:f.ownerId,visibility:"actor_private",
      source_event_id:null,actor_user_id:f.actorId,created_at:createdAt});
    f.insert("private_content_retention_scopes",{content_id:id,organization_id:f.organizationId,project_access_id:f.projectAccessId,
      project_id:f.projectId,actor_user_id:f.actorId,classification:"transient-private",policy_version:0,assigned_expires_at:expiry,created_at:createdAt});
    return{id,role,text,expiry};
  });
  const budget=f.event("BudgetReserved",{operation:"creative-chat",reservation_id:"shared-sibling-historical-budget",cost_reservation_id:"shared-sibling-historical-cost",
    reserved_tokens:12000,reserved_microusd:1,period:"2026-09",live_preview:false},
    {id:"structured-shared-sibling-budget",actor:"worker:policy",correlation:jobId});
  const authored=f.event("ChatMessageSent",{turn_id:turnId,document_id:documentId,content_ref:bodies[0].id,content_expires_at:expiry,
    source_surface:"chat",live_preview:false},{id:"structured-shared-sibling-message",actor:"user:"+f.actorId,correlation:jobId,causation:budget.event_id});
  const answered=f.event("AssistantReasoned",{operation:"creative-chat",turn_id:turnId,document_id:documentId,content_ref:bodies[1].id,content_expires_at:expiry,
    provider:"openai",provider_response_id:"shared-sibling-historical-response",model_id:"historical-model",latency_ms:1,mutation_count:0,
    reference_pixel_mutation_count:0,preview_worthy:false,live_preview_requested:false,preview_queued:false,preview_direction_ref:null,preview_suppressed:false},
    {id:"structured-shared-sibling-answer",actor:"model:forma-chat",correlation:jobId,causation:authored.event_id});
  const headers={"oai-authenticated-user-id":f.actorId,"oai-authenticated-user-email":f.actorId+"@example.test",
    "oai-authenticated-user-name":f.actorId,"content-type":"application/json","origin":"http://localhost",cookie:"forma_project_context=consumption-context"};
  const current=await prepareDocumentAuthority(new Request("http://localhost/api/context/read",{headers}),f.env,{projectId:f.projectId,documentId},"read");
  assert.ok(!(current instanceof Response),"the sibling must have genuine current shared document authority");
  assert.equal(current.binding.scope.organizationId,f.organizationId);assert.equal(current.binding.scope.projectAccessId,f.projectAccessId);
  const enrollment={...f.enrollment,enrollment_id:"structured-shared-sibling-enrollment",document_id:documentId,
    permission_epoch:current.principal.access.permissionEpoch,cursor_sequence:answered.sequence};
  f.insert("memory_live_enrollments",enrollment);
  const rows=[{turnId,correlation:jobId,jobId,budget,user:{...bodies[0],event:authored},assistant:{...bodies[1],event:answered}}];
  const frames=[await captureLegacyConversationOriginals(f.env,current,{afterSequence:document.sequence,throughSequence:answered.sequence})];
  assert.ok(frames[0],"actual shared job anchor, acting-user originals and private sidecars must pass native capture");
  const sibling={...f,documentId,current,enrollment,rows,frames,refs:rows.flatMap(pair=>[structuredLedgerRef(pair,pair.user),structuredLedgerRef(pair,pair.assistant)])};
  sibling.ledgerRead=()=>readStructuredConversationLedger(f.env,enrollment,current,frames);
  sibling.ledgerAppend=(expected,ledger)=>appendStructuredConversationLedger(f.env,enrollment,current,frames,expected,ledger);
  const admitted=await structuredLedgerPublish(sibling);assert.equal(admitted.status,"active");
  const beforeRead=await sibling.ledgerRead();assert.ok(beforeRead);assert.deepEqual(beforeRead.ledger,admitted.ledger);
  const siblingRows=()=>{
    const head={...structuredLedgerHead(sibling)},revisions=f.sqlite.prepare("SELECT * FROM memory_structured_conversation_revisions WHERE ledger_id=? ORDER BY revision").all(head.ledger_id);
    return{head,revisions:revisions.map(row=>({...row})),bodies:revisions.map(row=>({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(row.body_ref)})),
      resources:revisions.flatMap(row=>f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=? ORDER BY project_access_id").all(row.body_ref).map(value=>({...value}))),
      retentions:revisions.flatMap(row=>f.sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=? ORDER BY organization_id,project_access_id").all(row.body_ref).map(value=>({...value}))),
      enrollment:{...f.sqlite.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=?").get(enrollment.enrollment_id)}};
  };
  const protectedRows=siblingRows();
  assert.equal(protectedRows.revisions.length,1);assert.equal(protectedRows.bodies.length,1);
  assert.equal(protectedRows.resources.length,1,"the positive must protect an actual nonempty project-resource sidecar");
  assert.equal(protectedRows.retentions.length,1,"the positive must protect an actual nonempty retention sidecar");
  assert.equal(protectedRows.resources[0].resource_id,protectedRows.bodies[0].content_id);
  assert.equal(protectedRows.resources[0].organization_id,f.organizationId);assert.equal(protectedRows.resources[0].project_access_id,f.projectAccessId);
  assert.equal(protectedRows.resources[0].owner_user_id,f.ownerId);assert.equal(protectedRows.resources[0].actor_user_id,f.actorId);
  assert.equal(protectedRows.resources[0].visibility,"actor_private");
  assert.equal(protectedRows.retentions[0].content_id,protectedRows.bodies[0].content_id);
  assert.equal(protectedRows.retentions[0].organization_id,f.organizationId);assert.equal(protectedRows.retentions[0].project_access_id,f.projectAccessId);
  assert.equal(protectedRows.retentions[0].actor_user_id,f.actorId);assert.equal(protectedRows.retentions[0].classification,"transient-private");
  assert.equal(protectedRows.retentions[0].assigned_expires_at,protectedRows.bodies[0].expires_at);
  const removed=await handleLiveMemory(new Request("http://localhost/api/memory/settings?id="+encodeURIComponent(f.enrollment.enrollment_id),{
    method:"DELETE",headers,body:JSON.stringify({confirmation:"FORGET_MY_MEMORY",revision:f.enrollment.revision})}),f.env,"settings");
  assert.equal(removed.status,200);assert.deepEqual(await removed.json(),{erased:true,reEnrollmentRequired:true,otherDevicesAndBackupsPurged:false});
  assert.equal(structuredLedgerHead(f).state,"retired");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_conversation_revisions WHERE ledger_id=?").get(selectedHead.ledger_id).n,0);
  for(const row of selectedBodies){
    const body=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(row.body_ref);
    assert.equal(body.content,"");assert.ok(body.redacted_at);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(row.body_ref).n,0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content_retention_scopes WHERE content_id=?").get(row.body_ref).n,0);
  }
  assert.deepEqual(siblingRows(),protectedRows,"selected-scope erasure preserves every actual sibling head, revision, body and nonempty custody sidecar byte-for-byte");
  const after=await sibling.ledgerRead();assert.ok(after);assert.deepEqual(after.ledger,admitted.ledger);
  assert.deepEqual(siblingRows(),protectedRows,"the surviving shared ledger remains natively readable without custody repair or mutation");
});

// R5 context/proof coverage is separate from the shared-sibling erasure case.
// These tests use the unchanged isolated native fixture, real source captures,
// actual ledger publication and authentic SQL assertions. No default caller is
// activated and no own-answer-write exemption is manufactured.
const {prepareNativeStructuredConversationContext,replayNativeStructuredConversationContext,
  nativeStructuredConversationContextPrecommitStatements}=await import("../worker/memory-live-context.ts");
const {prepareStructuredConversationContextSource,replayStructuredConversationContextSource,
  structuredConversationContextSourceStatements}=await import("../worker/memory-live-store.ts");
const structuredContextPrepare=(f,options)=>prepareNativeStructuredConversationContext(f.env,f.enrollment,f.current,f.frames,options);
const structuredContextReplayBatch=statements=>statements.at(-1)?.sql.includes("memory_structured_context_expired");
const structuredContextSize=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
const structuredContextMandatory=value=>{
  const mandatory=copy(value);mandatory.recentOriginals=[];
  mandatory.coverage.presentedOriginalCount=0;mandatory.coverage.omittedOriginalCount=mandatory.coverage.capturedOriginalCount;
  return mandatory;
};

for(const mode of ["personal","shared-collaborator","shared-owner"])
test("structured native context: "+mode+" emits exact declared context and authentic read-only publication assertions",async t=>{
  const f=await structuredLedgerFixture(t,{mode,pairs:1}),written=await structuredLedgerPublish(f),before=f.ledgerFootprint();
  const originals=await f.replay(f.frames[0]);assert.ok(originals);
  f.trace.length=0;
  const prepared=await structuredContextPrepare(f);assert.ok(prepared);
  const {context,proof}=prepared;
  assert.equal(context.mode,"native-document-structured-conversation");assert.equal(context.method,"native-declared-ledger-projection-v1");
  assert.equal(context.treatment,"untrusted-historical-evidence");assert.equal(context.declarationMeaning,"caller-declared-not-independently-verified");
  assert.equal(context.semanticCompleteness,false);assert.equal(context.inferredPreferences,false);
  assert.deepEqual(context.scope,originals.scope);assert.deepEqual(context.enrollment,{id:f.enrollment.enrollment_id,revision:f.enrollment.revision});
  assert.equal(context.ledger.id,written.ledgerId);assert.equal(context.ledger.storageRevision,written.revision);
  assert.equal(context.ledger.recipeVersion,"native-declared-ledger-v1");assert.deepEqual(context.ledger.annotations,written.ledger.annotations);
  assert.deepEqual(context.ledger.currentItems,[{itemId:"declared-goal",revision:1,category:"goal"}]);assert.deepEqual(context.ledger.withdrawnItems,[]);
  assert.deepEqual(context.dependencies,{retainedOriginals:f.refs,capturedOriginals:f.refs});
  assert.deepEqual(context.recentOriginals,originals.originals,"per-role Unicode, whitespace and full texts are not clipped or re-authored");
  assert.equal(context.coverage.bounded,true);assert.equal(context.coverage.completeFromStart,false);assert.equal(context.coverage.notSummarized,true);
  assert.equal(context.coverage.allAdmittedLedgerAnnotationsIncluded,true);assert.equal(context.coverage.allRetainedOriginalReferencesIncluded,true);
  assert.equal(context.coverage.sourceHead,f.current.sourceHead);assert.equal(context.coverage.frameCount,f.frames.length);
  assert.equal(context.coverage.retainedOriginalCount,2);assert.equal(context.coverage.capturedOriginalCount,2);
  assert.equal(context.coverage.presentedOriginalCount,2);assert.equal(context.coverage.omittedOriginalCount,0);assert.equal(context.coverage.recentOriginalTextClipped,false);
  assert.ok(Date.parse(context.lifetime.validUntil)<=Date.parse(f.frames[0].validUntil));
  assert.equal(context.lifetime.ledgerExpiresAt,written.expiresAt);assert.ok(structuredContextSize(context)<=16384);
  assert.equal(Object.isFrozen(prepared),true);assert.equal(Object.isFrozen(context),true);assert.equal(Object.isFrozen(context.ledger.annotations[0]),true);
  assert.equal(Object.isFrozen(context.recentOriginals[0]),true);assert.equal(Object.isFrozen(proof),true);assert.equal(Object.getPrototypeOf(proof),null);
  assert.deepEqual(Reflect.ownKeys(proof),[]);
  const statements=nativeStructuredConversationContextPrecommitStatements(f.env,proof);assert.ok(statements?.length);
  assert.ok(structuredContextReplayBatch(statements));assert.equal(statements.at(-1).values[0],context.lifetime.validUntil);
  const results=await f.DB.batch(statements);assert.equal(results.length,statements.length);
  assert.ok(results.every(result=>result.success===true&&result.results.length===1&&result.results[0].context_source_asserted===1));
  const deadline=context.lifetime.validUntil;assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),context);
  assert.equal(context.lifetime.validUntil,deadline,"native replay returns the exact context identity without minting a later lease");
  assert.deepEqual(f.ledgerFootprint(),before);assert.ok(f.trace.length>0);
  assert.ok(f.trace.every(row=>/^\s*(?:SELECT|WITH)/iu.test(row.sql)),"context/proof preparation, materialization and replay only issue native reads");
  assert.doesNotMatch(JSON.stringify(context),/"(?:sql|bindings|authorizationSnapshot|memoryAccess|accepted|proof|private_json)"\s*:/u);
  if(mode!=="personal"){
    const ref=structuredLedgerHead(f).current_body_ref;
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ref).n,1);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content_retention_scopes WHERE content_id=?").get(ref).n,1);
  }
});

test("structured native context: full correction and withdrawal history survives omission of every optional original text",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:4});
  let written=await structuredLedgerPublish(f,0);
  written=await structuredLedgerPublish(f,1,written,{revision:2,operation:"correct",predecessor:{itemId:"declared-goal",revision:1}});
  written=await structuredLedgerPublish(f,2,written,{itemId:"open-question",category:"question"});
  written=await structuredLedgerPublish(f,3,written,{itemId:"open-question",category:"question",revision:2,operation:"withdraw",predecessor:{itemId:"open-question",revision:1}});
  const full=await structuredContextPrepare(f);assert.ok(full);assert.equal(full.context.ledger.annotations.length,4);
  const mandatory=structuredContextMandatory(full.context),maxBytes=structuredContextSize(mandatory);
  assert.ok(maxBytes<16384);assert.ok(full.context.recentOriginals.length>0);
  const limited=await structuredContextPrepare(f,{maxBytes});assert.ok(limited);
  assert.deepEqual(limited.context.recentOriginals,[]);assert.equal(structuredContextSize(limited.context),maxBytes);
  assert.deepEqual(limited.context.ledger.annotations,written.ledger.annotations);
  assert.deepEqual(limited.context.ledger.annotations.map(item=>item.operation),["assert","correct","assert","withdraw"]);
  assert.deepEqual(limited.context.ledger.currentItems,[{itemId:"declared-goal",revision:2,category:"goal"}]);
  assert.deepEqual(limited.context.ledger.withdrawnItems,[{itemId:"open-question",revision:2,category:"question"}]);
  assert.deepEqual(limited.context.dependencies,full.context.dependencies);
  assert.equal(limited.context.coverage.presentedOriginalCount,0);assert.equal(limited.context.coverage.omittedOriginalCount,8);
  assert.equal(limited.context.coverage.allAdmittedLedgerAnnotationsIncluded,true);assert.equal(limited.context.coverage.allRetainedOriginalReferencesIncluded,true);
  assert.equal(limited.context.lifetime.ledgerExpiresAt,full.context.lifetime.ledgerExpiresAt);
  assert.ok(Date.parse(limited.context.lifetime.validUntil)<=Date.parse(f.frames[0].validUntil));
  assert.equal(await structuredContextPrepare(f,{maxBytes:maxBytes-1}),null,"mandatory overflow must not become a valid recent-tail or empty-ledger fallback");
  const proof=nativeStructuredConversationContextPrecommitStatements(f.env,limited.proof);assert.ok(proof?.length);
  f.sqlite.prepare("UPDATE private_content SET content=content||' HIDDEN_PREDECESSOR_CHANGED' WHERE content_id=?").run(f.rows[0].user.id);
  const changed=f.ledgerFootprint();
  await assert.rejects(()=>f.DB.batch(proof),"an omitted predecessor's actual native evidence remains mandatory");
  assert.equal(await replayNativeStructuredConversationContext(f.env,limited),null);
  assert.deepEqual(f.ledgerFootprint(),changed,"failed read certification does not repair or prune the changed history");
});

test("structured native context: unretained captured originals remain visible dependencies and constrain trimmed publication",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:2}),initial=await f.ledgerRead();assert.ok(initial);
  const proposal=structuredLedgerProposal(f,initial,structuredLedgerDeclaration(f,0));proposal.originals=f.refs.slice(0,2);
  const written=await f.ledgerAppend(initial,proposal);assert.ok(written);
  const full=await structuredContextPrepare(f);assert.ok(full);
  assert.deepEqual(full.context.dependencies.retainedOriginals,f.refs.slice(0,2));assert.deepEqual(full.context.dependencies.capturedOriginals,f.refs);
  assert.equal(full.context.coverage.retainedOriginalCount,2);assert.equal(full.context.coverage.capturedOriginalCount,4);
  const maxBytes=structuredContextSize(structuredContextMandatory(full.context));
  const limited=await structuredContextPrepare(f,{maxBytes});assert.ok(limited);assert.deepEqual(limited.context.recentOriginals,[]);
  assert.deepEqual(limited.context.dependencies,full.context.dependencies);
  const assertions=nativeStructuredConversationContextPrecommitStatements(f.env,limited.proof);assert.ok(assertions?.length);
  f.sqlite.prepare("UPDATE private_content SET content=content||' UNRETAINED_CAPTURE_CHANGED' WHERE content_id=?").run(f.rows[1].assistant.id);
  await assert.rejects(()=>f.DB.batch(assertions));assert.equal(await replayNativeStructuredConversationContext(f.env,limited),null);
});

test("structured native context: initial or unavailable native ledger and invalid budgets never produce fallback context",async t=>{
  for(const boundary of ["initial","absent-schema","recall-paused","expired-enrollment","cloned-capture","wrong-document","flag-off"]){
    const f=await structuredLedgerFixture(t,{pairs:1,schema:boundary!=="absent-schema"});
    if(!["initial","absent-schema"].includes(boundary))await structuredLedgerPublish(f);
    if(boundary==="recall-paused"){f.enrollment.recall_enabled=0;f.sqlite.prepare("UPDATE memory_live_enrollments SET recall_enabled=0 WHERE enrollment_id=?").run(f.enrollment.enrollment_id);}
    if(boundary==="expired-enrollment"){f.enrollment.expires_at=at(-1);f.sqlite.prepare("UPDATE memory_live_enrollments SET expires_at=? WHERE enrollment_id=?").run(f.enrollment.expires_at,f.enrollment.enrollment_id);}
    if(boundary==="cloned-capture")f.frames=f.frames.map(frame=>structuredClone(frame));
    if(boundary==="wrong-document")f.current.binding.documentId="different-native-document";
    if(boundary==="flag-off")f.env.FORMA_MEMORY_ENABLED="false";
    const before=f.ledgerFootprint();assert.equal(await structuredContextPrepare(f),null,boundary);assert.deepEqual(f.ledgerFootprint(),before,boundary);
  }
  const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
  const before=f.ledgerFootprint();
  for(const options of [null,[],{maxBytes:0},{maxBytes:-1},{maxBytes:16385},{maxBytes:1.5},{maxBytes:"16384"},{maxBytes:undefined},{maxBytes:NaN},{unknown:true},{[Symbol("budget")]:16384}])
    assert.equal(await structuredContextPrepare(f,options),null);
  let reads=0;const accessor={get maxBytes(){reads++;return 16384;}};
  assert.equal(await structuredContextPrepare(f,accessor),null);assert.equal(reads,0,"budget accessors are rejected without invoking caller code");
  assert.equal(await structuredContextPrepare(f,{maxBytes:1}),null);assert.deepEqual(f.ledgerFootprint(),before);
});

test("structured native context: recall still works with learning paused but exact enrollment drift invalidates existing proof",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
  f.enrollment.learn_enabled=0;f.sqlite.prepare("UPDATE memory_live_enrollments SET learn_enabled=0 WHERE enrollment_id=?").run(f.enrollment.enrollment_id);
  const prepared=await structuredContextPrepare(f);assert.ok(prepared);assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),prepared.context);
  const assertions=nativeStructuredConversationContextPrecommitStatements(f.env,prepared.proof);assert.ok(assertions?.length);
  f.sqlite.prepare("UPDATE memory_live_enrollments SET background_enabled=1 WHERE enrollment_id=?").run(f.enrollment.enrollment_id);
  await assert.rejects(()=>f.DB.batch(assertions),"even a non-recall field is in the exact captured native enrollment");
  assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),null);
});

test("structured native context: copied context wrappers, opaque proofs and raw source lookalikes are not publication authority",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
  const prepared=await structuredContextPrepare(f);assert.ok(prepared);
  const source=await prepareStructuredConversationContextSource(f.env,f.enrollment,f.current,f.frames);assert.ok(source);
  const before=f.ledgerFootprint();f.trace.length=0;
  for(const forged of [null,{},prepared.context,copy(prepared),{...prepared},Object.create(prepared),
    Object.create(Object.getPrototypeOf(prepared),Object.getOwnPropertyDescriptors(prepared))])
    assert.equal(await replayNativeStructuredConversationContext(f.env,forged),null);
  for(const forged of [null,{},prepared,prepared.context,{...prepared.proof},copy(prepared.proof),
    Object.create(prepared.proof),Object.create(null,Object.getOwnPropertyDescriptors(prepared.proof))])
    assert.equal(nativeStructuredConversationContextPrecommitStatements(f.env,forged),null);
  for(const forged of [null,{},copy(source),{...source},Object.create(source),
    Object.create(Object.getPrototypeOf(source),Object.getOwnPropertyDescriptors(source))]){
    assert.equal(structuredConversationContextSourceStatements(f.env,forged),null);
    assert.equal(await replayStructuredConversationContextSource(f.env,forged),null);
  }
  const copiedEnv={...f.env};
  assert.equal(await replayNativeStructuredConversationContext(copiedEnv,prepared),null);
  assert.equal(nativeStructuredConversationContextPrecommitStatements(copiedEnv,prepared.proof),null);
  assert.equal(await replayStructuredConversationContextSource(copiedEnv,source),null);
  assert.equal(structuredConversationContextSourceStatements(copiedEnv,source),null);
  assert.equal(f.trace.length,0,"rejecting local identity lookalikes does not perform a fresh authority read");
  assert.deepEqual(f.ledgerFootprint(),before);
  assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),prepared.context);
  assert.equal(await replayStructuredConversationContextSource(f.env,source),source);
});

test("structured native context: issued capability binds original DB, caller enrollment, prepared scope, frame inventory and budget",async t=>{
  for(const boundary of ["db","enrollment","prepared-scope","prepared-principal","frames-replaced","frames-extended","cap-smaller","cap-added","cap-unknown","flag"]){
    const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
    const options=boundary==="cap-added"?{}:{maxBytes:16384};
    const alternateFrame=boundary==="frames-replaced"?await captureLegacyConversationOriginals(f.env,f.current,f.interval):null;
    if(boundary==="frames-replaced"){assert.ok(alternateFrame);assert.notEqual(alternateFrame,f.frames[0]);}
    const prepared=await structuredContextPrepare(f,options);assert.ok(prepared);
    const originalDb=f.env.DB;let replacementCalls=0;
    if(boundary==="db")f.env.DB={prepare(...args){replacementCalls++;return originalDb.prepare(...args);},batch(...args){replacementCalls++;return originalDb.batch(...args);}};
    if(boundary==="enrollment")f.enrollment.retention_days=29;
    if(boundary==="prepared-scope")f.current.binding.documentId="a-different-document";
    if(boundary==="prepared-principal")f.current.principal.userId="a-different-actor";
    if(boundary==="frames-replaced")f.frames[0]=alternateFrame;
    if(boundary==="frames-extended")f.frames.push(f.frames[0]);
    if(boundary==="cap-smaller")options.maxBytes=1;
    if(boundary==="cap-added")options.maxBytes=16384;
    if(boundary==="cap-unknown")options.unrecognized=true;
    if(boundary==="flag")f.env.FORMA_MEMORY_ENABLED="false";
    const before=f.ledgerFootprint();f.trace.length=0;
    assert.equal(nativeStructuredConversationContextPrecommitStatements(f.env,prepared.proof),null,boundary);
    assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),null,boundary);
    assert.equal(f.trace.length,0,boundary);assert.equal(replacementCalls,0,"replacement DB remains untouched even when it delegates to identical native rows");
    assert.deepEqual(f.ledgerFootprint(),before,boundary);f.env.DB=originalDb;
  }
});

test("structured native context: caller capture and budget mutations across genuine native awaits are rejected",async t=>{
  for(const boundary of ["frame-before-bridge","budget-before-bridge","budget-shape-before-bridge","db-after-native-replay","enrollment-after-native-replay"]){
    const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
    const options=boundary==="budget-shape-before-bridge"?{}:{maxBytes:16384};
    const alternateFrame=boundary==="frame-before-bridge"?await captureLegacyConversationOriginals(f.env,f.current,f.interval):null;
    if(boundary==="frame-before-bridge"){assert.ok(alternateFrame);assert.notEqual(alternateFrame,f.frames[0]);}
    const originalDb=f.env.DB;let fired=0,replacementCalls=0;
    const before=f.ledgerFootprint();
    f.hooks.afterBatch=statements=>{
      const beforeBridge=statements.length===1&&statements[0].sql.includes(" AS schema_json,");
      const afterReplay=structuredContextReplayBatch(statements);
      if(fired||boundary.endsWith("before-bridge")&&!beforeBridge||boundary.endsWith("after-native-replay")&&!afterReplay)return;
      fired++;
      if(boundary==="frame-before-bridge")f.frames[0]=alternateFrame;
      if(boundary==="budget-before-bridge")options.maxBytes=1;
      if(boundary==="budget-shape-before-bridge")options.maxBytes=16384;
      if(boundary==="enrollment-after-native-replay")f.enrollment.cursor_sequence++;
      if(boundary==="db-after-native-replay")f.env.DB={prepare(...args){replacementCalls++;return originalDb.prepare(...args);},batch(...args){replacementCalls++;return originalDb.batch(...args);}};
    };
    try{
      assert.equal(await structuredContextPrepare(f,options),null,boundary);assert.equal(fired,1,boundary);
      assert.equal(replacementCalls,0);assert.deepEqual(f.ledgerFootprint(),before,boundary);
    }finally{f.hooks.afterBatch=null;f.env.DB=originalDb;}
  }
  for(const boundary of ["frames","budget","db"]){
    const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
    const options={maxBytes:16384},prepared=await structuredContextPrepare(f,options);assert.ok(prepared);
    const originalDb=f.env.DB;let fired=0,replacementCalls=0;
    f.hooks.afterBatch=statements=>{
      if(fired||!structuredContextReplayBatch(statements))return;fired++;
      if(boundary==="frames")f.frames.push(f.frames[0]);
      if(boundary==="budget")options.maxBytes=1;
      if(boundary==="db")f.env.DB={prepare(...args){replacementCalls++;return originalDb.prepare(...args);},batch(...args){replacementCalls++;return originalDb.batch(...args);}};
    };
    try{
      assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),null,boundary);assert.equal(fired,1);
      assert.equal(replacementCalls,0);assert.equal(nativeStructuredConversationContextPrecommitStatements(f.env,prepared.proof),null);
    }finally{f.hooks.afterBatch=null;f.env.DB=originalDb;}
  }
});

test("structured native context: exact SQL assertions reject late ledger, enrollment, source and nonempty shared custody drift",async t=>{
  for(const boundary of ["enrollment","head","old-ledger-body","old-original","unretained-original","resource","retention","membership","source-head"]){
    const f=await structuredLedgerFixture(t,{mode:"shared-collaborator",pairs:3}),initial=await f.ledgerRead();assert.ok(initial);
    const first=structuredLedgerProposal(f,initial,structuredLedgerDeclaration(f,0));first.originals=f.refs.slice(0,2);
    let written=await f.ledgerAppend(initial,first);assert.ok(written);
    const next=structuredLedgerProposal(f,written,structuredLedgerDeclaration(f,1,{revision:2,operation:"correct",predecessor:{itemId:"declared-goal",revision:1}}));
    next.originals=f.refs.slice(0,4);written=await f.ledgerAppend(written,next);assert.ok(written);
    const prepared=await structuredContextPrepare(f);assert.ok(prepared);
    const statements=nativeStructuredConversationContextPrecommitStatements(f.env,prepared.proof);assert.ok(statements?.length);
    const old=structuredLedgerRevisions(f)[0],current=structuredLedgerHead(f);
    if(boundary==="enrollment")f.sqlite.prepare("UPDATE memory_live_enrollments SET cursor_sequence=cursor_sequence+1 WHERE enrollment_id=?").run(f.enrollment.enrollment_id);
    if(boundary==="head")f.sqlite.prepare("UPDATE memory_structured_conversation_heads SET annotation_count=annotation_count+1 WHERE ledger_id=?").run(current.ledger_id);
    if(boundary==="old-ledger-body")f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(old.body_ref);
    if(boundary==="old-original")f.sqlite.prepare("UPDATE private_content SET content=content||' OLD_SOURCE_DRIFT' WHERE content_id=?").run(f.rows[0].user.id);
    if(boundary==="unretained-original")f.sqlite.prepare("UPDATE private_content SET content=content||' CAPTURE_DRIFT' WHERE content_id=?").run(f.rows[2].assistant.id);
    if(boundary==="resource"){
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(old.body_ref).n,1);
      f.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id=? WHERE resource_kind='content' AND resource_id=?").run(f.ownerId,old.body_ref);
    }
    if(boundary==="retention"){
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content_retention_scopes WHERE content_id=?").get(old.body_ref).n,1);
      f.sqlite.prepare("UPDATE private_content_retention_scopes SET assigned_expires_at=? WHERE content_id=?").run(at(-1),old.body_ref);
    }
    if(boundary==="membership")f.sqlite.prepare("UPDATE project_memberships SET status='revoked',revoked_at=? WHERE user_id=?").run(at(-1),f.actorId);
    if(boundary==="source-head")f.append("DocumentViewVisited",{project_id:f.projectId,document_id:f.documentId,view:"document",focused:true});
    const changed=f.ledgerFootprint();
    assert.ok(nativeStructuredConversationContextPrecommitStatements(f.env,prepared.proof)?.length,
      "materialization alone makes no database-currentness claim; original native assertions must execute");
    await assert.rejects(()=>f.DB.batch(statements),boundary);
    assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),null,boundary);
    assert.deepEqual(f.ledgerFootprint(),changed,boundary);
  }
});

test("structured native context: late history change before either preparation replay cannot publish prior text",async t=>{
  for(const replayOrdinal of [1,2]){
    const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);let seen=0,changed;
    f.hooks.beforeBatch=statements=>{
      if(!structuredContextReplayBatch(statements)||++seen!==replayOrdinal)return;
      f.sqlite.prepare("UPDATE private_content SET content=content||' LATE_CONTEXT_SOURCE_CANARY' WHERE content_id=?").run(f.rows[0].assistant.id);
      changed=f.ledgerFootprint();
    };
    try{
      assert.equal(await structuredContextPrepare(f),null);assert.equal(seen,replayOrdinal);assert.ok(changed);
      assert.deepEqual(f.ledgerFootprint(),changed,"no stale projected context is returned and actual changed source remains untouched");
    }finally{f.hooks.beforeBatch=null;}
  }
});

test("structured native context: malformed native replay acknowledgements never certify or reuse a previous projection",async t=>{
  for(const phase of ["prepare","replay"])for(const corruption of ["missing","extra","failure","error","row-missing","wrong-assertion"]){
    const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
    const prepared=phase==="replay"?await structuredContextPrepare(f):null;if(phase==="replay")assert.ok(prepared);
    const before=f.ledgerFootprint();let seen=0,damaged=0;
    f.hooks.afterBatch=(statements,results)=>{
      if(!structuredContextReplayBatch(statements)||++seen!==(phase==="prepare"?2:1))return;
      damaged++;assert.equal(results.length,statements.length);assert.ok(results.every(result=>result.success===true));
      if(corruption==="missing")results.pop();
      if(corruption==="extra")results.push(copy(results[0]));
      if(corruption==="failure")results[0].success=false;
      if(corruption==="error")results[0].error="synthetic-replay-ack-error";
      if(corruption==="row-missing")results[0].results=[];
      if(corruption==="wrong-assertion")results.at(-1).results=[{context_source_asserted:0}];
    };
    try{
      const result=phase==="prepare"?await structuredContextPrepare(f):await replayNativeStructuredConversationContext(f.env,prepared);
      assert.equal(result,null,phase+": "+corruption);assert.equal(damaged,1);assert.deepEqual(f.ledgerFootprint(),before);
    }finally{f.hooks.afterBatch=null;}
  }
});

test("structured native context: original host lease expires without refreshing source proof or projected deadline",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
  const prepared=await structuredContextPrepare(f);assert.ok(prepared);
  const source=await prepareStructuredConversationContextSource(f.env,f.enrollment,f.current,f.frames);assert.ok(source);
  const deadline=prepared.context.lifetime.validUntil,sourceDeadline=source.read.validUntil,dateNow=Date.now;
  const crossed=Math.max(Date.parse(deadline),Date.parse(sourceDeadline));
  try{
    Date.now=()=>crossed;
    const before=f.ledgerFootprint();f.trace.length=0;
    assert.equal(nativeStructuredConversationContextPrecommitStatements(f.env,prepared.proof),null);
    assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),null);
    assert.equal(structuredConversationContextSourceStatements(f.env,source),null);
    assert.equal(await replayStructuredConversationContextSource(f.env,source),null);
    assert.equal(prepared.context.lifetime.validUntil,deadline);assert.equal(source.read.validUntil,sourceDeadline);
    assert.equal(f.trace.length,0);assert.deepEqual(f.ledgerFootprint(),before);
  }finally{Date.now=dateNow;}
  // This deterministic host-clock seam is not independent SQLite clock
  // qualification. Native deadline crossing while the host is held fixed remains
  // a separately allocated runtime check, not a new fake clock framework here.
});

test("structured native context: newly persisted actual answer events receive no implicit own-write exemption",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
  const prepared=await structuredContextPrepare(f);assert.ok(prepared);
  const assertions=nativeStructuredConversationContextPrecommitStatements(f.env,prepared.proof);assert.ok(assertions?.length);
  const turnId="structured-context-new-answer-turn",correlation="structured-context-new-answer-correlation",expiry=at(60_000),createdAt=at(-8000);
  for(const role of ["user","assistant"])f.insert("private_content",{content_id:"structured-context-new-"+role,owner_id:f.actorId,
    kind:"chat-"+role,content:role==="user"?"New user message":"New historical answer",created_at:createdAt,expires_at:expiry,redacted_at:null});
  const budget=f.event("BudgetReserved",{operation:"creative-chat",reservation_id:"structured-context-new-budget",cost_reservation_id:"structured-context-new-cost",
    reserved_tokens:12000,reserved_microusd:1,period:"2026-09",live_preview:false},
    {id:"structured-context-new-budget-event",actor:"worker:policy",correlation});
  const authored=f.event("ChatMessageSent",{turn_id:turnId,document_id:f.documentId,content_ref:"structured-context-new-user",content_expires_at:expiry,
    source_surface:"chat",live_preview:false},{id:"structured-context-new-message",actor:"user",correlation,causation:budget.event_id});
  const answered=f.event("AssistantReasoned",{operation:"creative-chat",turn_id:turnId,document_id:f.documentId,content_ref:"structured-context-new-assistant",
    content_expires_at:expiry,provider:"openai",provider_response_id:"synthetic-new-answer",model_id:"historical-model",latency_ms:1,mutation_count:0,
    reference_pixel_mutation_count:0,preview_worthy:false,live_preview_requested:false,preview_queued:false,preview_direction_ref:null,preview_suppressed:false},
    {id:"structured-context-new-answer",actor:"model:forma-chat",correlation,causation:authored.event_id});
  assert.ok(answered.sequence>prepared.context.coverage.sourceHead);const changed=f.ledgerFootprint();
  await assert.rejects(()=>f.DB.batch(assertions));assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),null);
  assert.deepEqual(f.ledgerFootprint(),changed,"the old proof rejects a changed native source head; it does not erase or bless newly seeded answer events");
  const fresh=await f.prepare();assert.ok(!(fresh instanceof Response));
  const capture=await captureLegacyConversationOriginals(f.env,fresh,{afterSequence:prepared.context.coverage.sourceHead,throughSequence:answered.sequence});
  assert.ok(capture,"fresh native authority independently admits the new producer-equivalent original pair");
  const originals=await replayLegacyConversationOriginals(f.env,fresh,capture);assert.ok(originals);
  assert.deepEqual(originals.originals.map(original=>[original.eventId,original.role,original.text]),[
    [authored.event_id,"user","New user message"],[answered.event_id,"assistant","New historical answer"]]);
  // This is synthetic persisted native history, not an exercised assistant
  // write route or answer-origin receipt. Common caller/answer-origin integration
  // must solve its real own-write boundary in a later allocated change.
});

test("structured native context: superseded and withdrawn goal history stays explicit beside assistant proposal and user decision",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:6});
  let written=await structuredLedgerPublish(f,0);
  written=await structuredLedgerPublish(f,1,written,{revision:2,operation:"supersede",predecessor:{itemId:"declared-goal",revision:1}});
  written=await structuredLedgerPublish(f,2,written,{revision:3,operation:"withdraw",predecessor:{itemId:"declared-goal",revision:2}});
  // Native revival of a withdrawn item is a linked correction. A new assert
  // would discard predecessor identity and is not the admitted ledger contract.
  written=await structuredLedgerPublish(f,3,written,{revision:4,operation:"correct",predecessor:{itemId:"declared-goal",revision:3}});
  written=await structuredLedgerPublish(f,4,written,{itemId:"assistant-proposal",category:"proposal",role:"assistant"});
  written=await structuredLedgerPublish(f,5,written,{itemId:"user-decision",category:"decision",role:"user"});
  const prepared=await structuredContextPrepare(f);assert.ok(prepared);const {context}=prepared;
  assert.deepEqual(context.ledger.annotations,written.ledger.annotations);assert.equal(context.ledger.annotations.length,6);
  assert.deepEqual(context.ledger.annotations.slice(0,4).map(item=>[item.operation,item.revision,item.predecessor]),[
    ["assert",1,null],["supersede",2,{itemId:"declared-goal",revision:1}],
    ["withdraw",3,{itemId:"declared-goal",revision:2}],["correct",4,{itemId:"declared-goal",revision:3}]]);
  assert.deepEqual(context.ledger.currentItems,[{itemId:"declared-goal",revision:4,category:"goal"},
    {itemId:"assistant-proposal",revision:1,category:"proposal"},{itemId:"user-decision",revision:1,category:"decision"}]);
  assert.deepEqual(context.ledger.withdrawnItems,[],"the current goal is its linked revision4, not a revived unlinked predecessor");
  const proposal=context.ledger.annotations[4],decision=context.ledger.annotations[5];
  assert.equal(proposal.category,"proposal");assert.equal(proposal.source.role,"assistant");assert.deepEqual(proposal.source,f.refs[9]);
  assert.equal(decision.category,"decision");assert.equal(decision.source.role,"user");assert.deepEqual(decision.source,f.refs[10]);
  assert.equal(context.declarationMeaning,"caller-declared-not-independently-verified");assert.equal(context.semanticCompleteness,false);
  assert.equal(context.inferredPreferences,false);assert.deepEqual(context.dependencies.retainedOriginals,f.refs);
  const maxBytes=structuredContextSize(structuredContextMandatory(context));assert.ok(maxBytes<=16384);
  const limited=await structuredContextPrepare(f,{maxBytes});assert.ok(limited);assert.deepEqual(limited.context.recentOriginals,[]);
  assert.deepEqual(limited.context.ledger,context.ledger,"trimming must not drop withdrawal/supersession or turn an assistant proposal into a user decision");
  assert.deepEqual(limited.context.dependencies,context.dependencies);
  assert.equal(await replayNativeStructuredConversationContext(f.env,limited),limited.context);
});

test("structured native context: actual retirement blocks old proof and active replacement enrollment cannot reset its stable fence",async t=>{
  const {revokeLiveMemoryCounted}=await import("../worker/memory-live-store.ts");
  const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
  const originalEnrollment=copy(f.enrollment),originalHead={...structuredLedgerHead(f)},prepared=await structuredContextPrepare(f);assert.ok(prepared);
  const assertions=nativeStructuredConversationContextPrecommitStatements(f.env,prepared.proof);assert.ok(assertions?.length);
  const revoked=await revokeLiveMemoryCounted(f.env,f.enrollment,"forgotten");assert.equal(revoked.revoked,true);
  const fence={...assertStructuredLedgerFence(f,originalHead)};
  await assert.rejects(()=>f.DB.batch(assertions));assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),null);
  const retained=await replayLegacyConversationOriginals(f.env,f.current,f.frames[0]);assert.ok(retained,
    "ordinary native originals remain genuinely readable after the memory-only retirement");
  // Synthetic replacement setup only, not enrollment API or user consent. The
  // original temporal/source scope remains unchanged so rejection cannot be
  // attributed to a newer enrolled_at excluding the original source events.
  f.sqlite.prepare("DELETE FROM memory_live_enrollments WHERE enrollment_id=?").run(originalEnrollment.enrollment_id);
  f.enrollment={...originalEnrollment,enrollment_id:"structured-context-enabled-replacement",revision:1,
    learn_enabled:1,recall_enabled:1,background_enabled:0,failure_code:null,lease_token:null,lease_expires_at:null,cutoff_sequence:null};
  f.insert("memory_live_enrollments",f.enrollment);
  const authority=await genuineLiveMemoryAuthority(f.env,f.enrollment);assert.ok(authority,"replacement enrollment has actual current recall authority");
  assert.equal(authority.principal.userId,f.actorId);assert.equal(f.enrollment.enrolled_at,originalEnrollment.enrolled_at);
  const before=f.ledgerFootprint();
  assert.equal(await structuredContextPrepare(f),null,"an enabled new enrollment identity cannot turn the retired stable scope into initial context");
  assert.equal(await prepareStructuredConversationContextSource(f.env,f.enrollment,f.current,f.frames),null);
  assert.deepEqual({...structuredLedgerHead(f)},fence);assert.deepEqual(f.ledgerFootprint(),before);
  assert.ok(await replayLegacyConversationOriginals(f.env,f.current,f.frames[0]),"terminal-fence rejection does not depend on broken original source custody");
});

// Inventory-bound R5 successor only. The parent 321904-byte test source is an
// unchanged prefix; these cases exercise the pre-copy bound and own indexed
// data contract without executing any caller iterator, accessor or species.
test("structured native context inventory: invalid bounds and non-data indexes deny before native reads or caller getters",async t=>{
  for(const boundary of ["empty","over-bound","sparse","accessor","inherited-index"]){
    const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
    const handle=f.frames[0],calls={index:0,descriptors:0,iterator:0,constructor:0};
    let captures;
    if(boundary==="empty")captures=[];
    // This finite test-only descriptor trap observes whether any numeric index
    // is inspected before rejecting length33. It does not claim Proxy metadata
    // traps themselves can be read without invoking their JavaScript handler.
    if(boundary==="over-bound")captures=new Proxy(new Array(33).fill(handle),{
      getOwnPropertyDescriptor(target,key){
        if(typeof key==="string"&&/^\d+$/u.test(key))calls.descriptors++;
        return Reflect.getOwnPropertyDescriptor(target,key);
      },
    });
    if(boundary==="sparse")captures=new Array(1);
    if(boundary==="accessor"){
      captures=new Array(1);Object.defineProperty(captures,"0",{configurable:true,get(){calls.index++;throw new Error("inventory_index_getter_forbidden");}});
    }
    if(boundary==="inherited-index"){
      captures=new Array(1);Object.setPrototypeOf(captures,Object.create(Array.prototype,{
        0:{get(){calls.index++;throw new Error("inventory_inherited_index_forbidden");}},
      }));
    }
    Object.defineProperty(captures,Symbol.iterator,{get(){calls.iterator++;throw new Error("inventory_iterator_lookup_forbidden");}});
    Object.defineProperty(captures,"constructor",{get(){calls.constructor++;throw new Error("inventory_constructor_lookup_forbidden");}});
    const originalPrepare=f.DB.prepare;let nativePrepares=0;
    f.DB.prepare=(...args)=>{nativePrepares++;return originalPrepare(...args);};
    const before=f.ledgerFootprint();f.trace.length=0;
    try{
      assert.equal(await prepareStructuredConversationContextSource(f.env,f.enrollment,f.current,captures),null,boundary);
      assert.equal(await prepareNativeStructuredConversationContext(f.env,f.enrollment,f.current,captures),null,boundary);
      assert.equal(nativePrepares,0,"invalid inventory must be rejected before preparing any native SQL");
      assert.equal(f.trace.length,0);assert.deepEqual(calls,{index:0,descriptors:0,iterator:0,constructor:0},boundary);
      assert.deepEqual(f.ledgerFootprint(),before);
    }finally{f.DB.prepare=originalPrepare;}
  }
});

test("structured native context inventory: genuine dense normal frozen and custom-iterator arrays retain real native authority",async t=>{
  for(const form of ["normal","frozen","throwing-iterator","iterator-getter","constructor-getter","species-getter"]){
    const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
    const captures=[f.frames[0]],calls={iterator:0,constructor:0,species:0};
    if(form==="frozen")Object.freeze(captures);
    if(form==="throwing-iterator")Object.defineProperty(captures,Symbol.iterator,{value(){calls.iterator++;throw new Error("custom_inventory_iterator_forbidden");}});
    if(form==="iterator-getter")Object.defineProperty(captures,Symbol.iterator,{get(){calls.iterator++;throw new Error("custom_inventory_iterator_lookup_forbidden");}});
    if(form==="constructor-getter")Object.defineProperty(captures,"constructor",{get(){calls.constructor++;throw new Error("custom_inventory_constructor_forbidden");}});
    if(form==="species-getter")Object.defineProperty(captures,"constructor",{value:{get [Symbol.species](){calls.species++;throw new Error("custom_inventory_species_forbidden");}}});
    const before=f.ledgerFootprint();
    const source=await prepareStructuredConversationContextSource(f.env,f.enrollment,f.current,captures);assert.ok(source,form);
    assert.equal(source.frameCount,1);assert.equal(await replayStructuredConversationContextSource(f.env,source),source);
    const prepared=await prepareNativeStructuredConversationContext(f.env,f.enrollment,f.current,captures);assert.ok(prepared,form);
    assert.equal(prepared.context.coverage.frameCount,1);assert.deepEqual(prepared.context.dependencies.capturedOriginals,f.refs);
    assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),prepared.context);
    const assertions=nativeStructuredConversationContextPrecommitStatements(f.env,prepared.proof);assert.ok(assertions?.length);
    const results=await f.DB.batch(assertions);assert.equal(results.length,assertions.length);
    assert.ok(results.every(result=>result.success===true&&result.results.length===1&&result.results[0].context_source_asserted===1));
    assert.deepEqual(calls,{iterator:0,constructor:0,species:0},"indexed own data is copied without iterator, constructor or species invocation");
    assert.deepEqual(f.ledgerFootprint(),before);
  }
});

test("structured native context inventory: an index accessor or over-bound length arriving across a native await denies without invocation",async t=>{
  for(const boundary of ["accessor","over-bound"])for(const phase of ["before-source-bridge","after-native-replay"]){
    const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
    const captures=[f.frames[0]];let fired=0,indexReads=0;
    f.hooks.afterBatch=statements=>{
      const selected=phase==="before-source-bridge"?statements.length===1&&statements[0].sql.includes(" AS schema_json,")
        :structuredContextReplayBatch(statements);
      if(fired||!selected)return;fired++;
      if(boundary==="accessor")Object.defineProperty(captures,"0",{configurable:true,get(){indexReads++;throw new Error("late_inventory_accessor_forbidden");}});
      else captures.length=33;
    };
    const before=f.ledgerFootprint();
    try{
      assert.equal(await prepareNativeStructuredConversationContext(f.env,f.enrollment,f.current,captures),null,boundary+": "+phase);
      assert.equal(fired,1);assert.equal(indexReads,0);assert.deepEqual(f.ledgerFootprint(),before);
    }finally{f.hooks.afterBatch=null;}
  }
});

test("structured native context inventory: issued proof and source reject later accessor substitution or oversized inventory without database work",async t=>{
  for(const boundary of ["accessor","over-bound","missing-index"]){
    const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
    const captures=[f.frames[0]],source=await prepareStructuredConversationContextSource(f.env,f.enrollment,f.current,captures);assert.ok(source);
    const prepared=await prepareNativeStructuredConversationContext(f.env,f.enrollment,f.current,captures);assert.ok(prepared);
    let indexReads=0;
    if(boundary==="accessor")Object.defineProperty(captures,"0",{configurable:true,get(){indexReads++;throw new Error("issued_inventory_accessor_forbidden");}});
    if(boundary==="over-bound")captures.length=33;
    if(boundary==="missing-index")delete captures[0];
    const originalPrepare=f.DB.prepare;let nativePrepares=0;f.DB.prepare=(...args)=>{nativePrepares++;return originalPrepare(...args);};
    const before=f.ledgerFootprint();f.trace.length=0;
    try{
      assert.equal(structuredConversationContextSourceStatements(f.env,source),null);
      assert.equal(await replayStructuredConversationContextSource(f.env,source),null);
      assert.equal(nativeStructuredConversationContextPrecommitStatements(f.env,prepared.proof),null);
      assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),null);
      assert.equal(indexReads,0);assert.equal(nativePrepares,0);assert.equal(f.trace.length,0);assert.deepEqual(f.ledgerFootprint(),before);
    }finally{f.DB.prepare=originalPrepare;}
  }
});

test("structured native context inventory: harmless iterator and constructor decorations after issuance do not replace its indexed handles",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
  const captures=[f.frames[0]],source=await prepareStructuredConversationContextSource(f.env,f.enrollment,f.current,captures);assert.ok(source);
  const prepared=await prepareNativeStructuredConversationContext(f.env,f.enrollment,f.current,captures);assert.ok(prepared);
  let forbiddenCalls=0;
  Object.defineProperty(captures,Symbol.iterator,{get(){forbiddenCalls++;throw new Error("late_custom_iterator_forbidden");}});
  Object.defineProperty(captures,"constructor",{get(){forbiddenCalls++;throw new Error("late_custom_constructor_forbidden");}});
  const before=f.ledgerFootprint(),deadline=prepared.context.lifetime.validUntil;
  assert.equal(await replayStructuredConversationContextSource(f.env,source),source);
  assert.equal(await replayNativeStructuredConversationContext(f.env,prepared),prepared.context);
  const assertions=nativeStructuredConversationContextPrecommitStatements(f.env,prepared.proof);assert.ok(assertions?.length);
  const results=await f.DB.batch(assertions);assert.equal(results.length,assertions.length);
  assert.ok(results.every(result=>result.success===true&&result.results.length===1&&result.results[0].context_source_asserted===1));
  assert.equal(forbiddenCalls,0);assert.equal(prepared.context.lifetime.validUntil,deadline);assert.deepEqual(f.ledgerFootprint(),before);
});

// R6 selection/discovery uses actual native metadata and issued original
// captures. Compatible 0032 with a genuinely absent scope may select extractive;
// missing, terminal or contradictory structured state is never that absence.
const {prepareNativeMemorySelection,nativeMemorySelectionStatements,replayNativeMemorySelection,
  discoverNativeStructuredConversationOriginals}=await import("../worker/memory-live-store.ts");
const structuredR6Ref=original=>({eventId:original.eventId,sequence:original.sequence,turnId:original.turnId,
  role:original.role,contentRef:original.contentRef,contentHash:original.contentHash});

for(const mode of ["personal","shared-collaborator","shared-owner"])
test("structured native selection: "+mode+" distinguishes witnessed absence from active ledger without reading original prose",async t=>{
  const f=await structuredLedgerFixture(t,{mode,pairs:1,texts:[["R6_SELECTION_USER_PRIVATE_CANARY","R6_SELECTION_ANSWER_PRIVATE_CANARY"]]});
  const observed=[];f.hooks.afterStatement=(_statement,_kind,value)=>{observed.push(copy(value));};
  const before=f.ledgerFootprint(),absent=await prepareNativeMemorySelection(f.env,f.current);assert.ok(absent);
  assert.equal(absent.mode,"extractive");assert.equal(Object.isFrozen(absent),true);assert.equal(Object.isFrozen(absent.proof),true);
  assert.equal(absent.enrollment.enrollment_id,f.enrollment.enrollment_id);
  const absenceStatements=nativeMemorySelectionStatements(f.env,absent);assert.ok(absenceStatements?.length);
  const absenceResults=await f.DB.batch(absenceStatements);assert.equal(absenceResults.length,absenceStatements.length);
  assert.ok(absenceResults.every(result=>result.success===true));assert.equal(await replayNativeMemorySelection(f.env,absent),absent);
  assert.deepEqual(f.ledgerFootprint(),before);
  assert.doesNotMatch(JSON.stringify(observed),/R6_SELECTION_(?:USER|ANSWER)_PRIVATE_CANARY/u,
    "native selection returns metadata, not original or ledger quotation bodies");
  f.hooks.afterStatement=null;
  const written=await structuredLedgerPublish(f);observed.length=0;
  f.hooks.afterStatement=(_statement,_kind,value)=>{observed.push(copy(value));};
  const populated=f.ledgerFootprint(),active=await prepareNativeMemorySelection(f.env,f.current);assert.ok(active);
  assert.equal(active.mode,"structured");assert.equal(active.ledgerId,written.ledgerId);assert.equal(active.enrollment.enrollment_id,f.enrollment.enrollment_id);
  const statements=nativeMemorySelectionStatements(f.env,active);assert.ok(statements?.length);
  const results=await f.DB.batch(statements);assert.equal(results.length,statements.length);assert.ok(results.every(result=>result.success===true));
  assert.equal(await replayNativeMemorySelection(f.env,active),active);assert.deepEqual(f.ledgerFootprint(),populated);
  assert.doesNotMatch(JSON.stringify(observed),/R6_SELECTION_(?:USER|ANSWER)_PRIVATE_CANARY/u);
  f.hooks.afterStatement=null;
  await assert.rejects(()=>f.DB.batch(absenceStatements),"the earlier genuine absence cannot survive a native head arriving");
  assert.equal(await replayNativeMemorySelection(f.env,absent),null);
});

test("structured native selection: missing partial malformed terminal or orphaned structured state never falls back to extractive",async t=>{
  const {revokeLiveMemoryCounted}=await import("../worker/memory-live-store.ts");
  for(const boundary of ["missing-schema","partial-schema","wrong-schema","malformed-head","terminal","orphan-without-head","orphan-with-head"]){
    const noSchema=boundary==="missing-schema"||boundary==="partial-schema";
    const f=await structuredLedgerFixture(t,{pairs:1,schema:!noSchema});
    if(boundary==="partial-schema")f.sqlite.exec("CREATE TABLE memory_structured_conversation_heads(ledger_id TEXT)");
    if(["wrong-schema","malformed-head","terminal","orphan-with-head"].includes(boundary))await structuredLedgerPublish(f);
    if(boundary==="wrong-schema")f.sqlite.exec("DROP INDEX idx_memory_structured_revisions_expiry");
    if(boundary==="malformed-head")f.sqlite.prepare("UPDATE memory_structured_conversation_heads SET enrollment_revision=enrollment_revision+1").run();
    if(boundary==="terminal"){
      const result=await revokeLiveMemoryCounted(f.env,f.enrollment,"forgotten");assert.equal(result.revoked,true);
      const terminal=f.sqlite.prepare("SELECT * FROM memory_live_enrollments WHERE enrollment_id=?").get(f.enrollment.enrollment_id);
      f.enrollment={...terminal,learn_enabled:1,recall_enabled:1,background_enabled:0,failure_code:null};
      f.sqlite.prepare("UPDATE memory_live_enrollments SET learn_enabled=1,recall_enabled=1,background_enabled=0,failure_code=NULL WHERE enrollment_id=?").run(f.enrollment.enrollment_id);
      assert.ok(await genuineLiveMemoryAuthority(f.env,f.enrollment),"terminal rejection must not rely on disabled replacement recall flags");
      assert.equal(structuredLedgerHead(f).state,"retired");
    }
    if(boundary.startsWith("orphan"))f.insert("private_content",{content_id:"r6-selection-unassociated-body",owner_id:f.actorId,
      kind:STRUCTURED_LEDGER_KIND,content:"R6_SELECTION_ORPHAN_CANARY",created_at:at(-1000),expires_at:at(60_000),redacted_at:null});
    const before=f.ledgerFootprint();
    assert.equal(await prepareNativeMemorySelection(f.env,f.current),null,boundary);assert.deepEqual(f.ledgerFootprint(),before,boundary);
  }
});

test("structured native selection: an issued metadata choice rejects head advancement orphan arrival and native enrollment drift",async t=>{
  for(const boundary of ["head-advanced","orphan-arrived","enrollment-changed"]){
    const f=await structuredLedgerFixture(t,{pairs:2}),written=await structuredLedgerPublish(f);
    const selected=await prepareNativeMemorySelection(f.env,f.current);assert.ok(selected);assert.equal(selected.mode,"structured");
    const statements=nativeMemorySelectionStatements(f.env,selected);assert.ok(statements?.length);
    if(boundary==="head-advanced")await structuredLedgerPublish(f,1,written,{revision:2,operation:"withdraw",predecessor:{itemId:"declared-goal",revision:1}});
    if(boundary==="orphan-arrived")f.insert("private_content",{content_id:"r6-selection-late-orphan",owner_id:f.actorId,
      kind:STRUCTURED_LEDGER_KIND,content:"R6_LATE_SELECTION_ORPHAN_CANARY",created_at:at(-1000),expires_at:at(60_000),redacted_at:null});
    if(boundary==="enrollment-changed")f.sqlite.prepare("UPDATE memory_live_enrollments SET background_enabled=1 WHERE enrollment_id=?").run(f.enrollment.enrollment_id);
    const changed=f.ledgerFootprint();await assert.rejects(()=>f.DB.batch(statements),boundary);
    assert.equal(await replayNativeMemorySelection(f.env,selected),null,boundary);assert.deepEqual(f.ledgerFootprint(),changed);
  }
});

test("structured native selection: copied certificates foreign environments and replacement database identities cannot authorize discovery",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
  const selected=await prepareNativeMemorySelection(f.env,f.current);assert.ok(selected);f.trace.length=0;
  for(const forged of [null,{},copy(selected),{...selected},Object.create(selected),
    Object.create(Object.getPrototypeOf(selected),Object.getOwnPropertyDescriptors(selected))]){
    assert.equal(nativeMemorySelectionStatements(f.env,forged),null);
    assert.equal(await replayNativeMemorySelection(f.env,forged),null);
    assert.equal(await discoverNativeStructuredConversationOriginals(f.env,f.current,forged),null);
  }
  const copiedEnv={...f.env};assert.equal(nativeMemorySelectionStatements(copiedEnv,selected),null);
  assert.equal(await replayNativeMemorySelection(copiedEnv,selected),null);
  assert.equal(await discoverNativeStructuredConversationOriginals(copiedEnv,f.current,selected),null);
  const originalDb=f.env.DB;let replacementCalls=0;
  f.env.DB={prepare(...args){replacementCalls++;return originalDb.prepare(...args);},batch(...args){replacementCalls++;return originalDb.batch(...args);}};
  try{
    assert.equal(nativeMemorySelectionStatements(f.env,selected),null);assert.equal(await replayNativeMemorySelection(f.env,selected),null);
    assert.equal(await discoverNativeStructuredConversationOriginals(f.env,f.current,selected),null);
    assert.equal(replacementCalls,0);assert.equal(f.trace.length,0);
  }finally{f.env.DB=originalDb;}
});

for(const mode of ["personal","shared-collaborator"])
test("structured native discovery: "+mode+" captures every retained original across older negative history and a later interval",async t=>{
  const f=await structuredLedgerFixture(t,{mode,pairs:7});
  const first=await structuredLedgerPublish(f),written=await structuredLedgerPublish(f,6,first,
    {revision:2,operation:"withdraw",predecessor:{itemId:"declared-goal",revision:1}});
  const selected=await prepareNativeMemorySelection(f.env,f.current);assert.ok(selected);assert.equal(selected.mode,"structured");
  const before=f.ledgerFootprint(),discovered=await discoverNativeStructuredConversationOriginals(f.env,f.current,selected);assert.ok(discovered);
  assert.deepEqual(discovered.enrollment,f.enrollment);assert.ok(discovered.captures.length>1);assert.ok(discovered.captures.length<=32);
  assert.equal(discovered.intervals.length,discovered.captures.length);
  const originals=[];
  for(let index=0;index<discovered.captures.length;index++){
    const receipt=await replayLegacyConversationOriginals(f.env,f.current,discovered.captures[index]);assert.ok(receipt);
    assert.deepEqual(receipt.interval,discovered.intervals[index]);assert.ok(receipt.originals.length>=2&&receipt.originals.length<=12);
    originals.push(...receipt.originals);
  }
  const unique=[...new Map(originals.map(original=>[original.eventId,original])).values()].sort((left,right)=>left.sequence-right.sequence);
  assert.deepEqual(unique.map(structuredR6Ref),f.refs,"discovery is not only the last six pairs or the latest annotation's sources");
  const context=await prepareNativeStructuredConversationContext(f.env,discovered.enrollment,f.current,discovered.captures);assert.ok(context);
  assert.deepEqual(context.context.ledger.annotations,written.ledger.annotations);assert.deepEqual(context.context.dependencies.retainedOriginals,f.refs);
  assert.equal(context.context.ledger.annotations[0].source.eventId,f.rows[0].user.event.event_id);
  assert.equal(context.context.ledger.annotations[1].operation,"withdraw");assert.deepEqual(context.context.ledger.currentItems,[]);
  assert.deepEqual(context.context.ledger.withdrawnItems,[{itemId:"declared-goal",revision:2,category:"goal"}]);
  assert.deepEqual(f.ledgerFootprint(),before);
});

test("structured native discovery: missing or altered retained originals cannot yield a recent-only context",async t=>{
  for(const boundary of ["missing-original-body","changed-original-body","missing-private-event","missing-old-ledger-body"]){
    const f=await structuredLedgerFixture(t,{pairs:3}),first=await structuredLedgerPublish(f);
    await structuredLedgerPublish(f,2,first,{revision:2,operation:"withdraw",predecessor:{itemId:"declared-goal",revision:1}});
    if(boundary==="missing-original-body")f.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(f.rows[0].user.id);
    if(boundary==="changed-original-body")f.sqlite.prepare("UPDATE private_content SET content=content||' R6_OLD_ORIGINAL_DRIFT' WHERE content_id=?").run(f.rows[0].assistant.id);
    if(boundary==="missing-private-event")f.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(f.rows[0].user.event.event_id);
    if(boundary==="missing-old-ledger-body")f.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(structuredLedgerRevisions(f)[0].body_ref);
    const before=f.ledgerFootprint(),selected=await prepareNativeMemorySelection(f.env,f.current);
    if(selected){
      assert.equal(selected.mode,"structured","broken evidence must never be classified as a true absent ledger");
      assert.equal(await discoverNativeStructuredConversationOriginals(f.env,f.current,selected),null,boundary);
    }
    assert.deepEqual(f.ledgerFootprint(),before);
  }
});

test("structured native selection: exact absent 0033 schema cannot survive its later arrival",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1});
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='memory_structured_answer_origins'").get().n,0);
  const selected=await prepareNativeMemorySelection(f.env,f.current);assert.ok(selected);assert.equal(selected.mode,"extractive");
  const assertions=nativeMemorySelectionStatements(f.env,selected);assert.ok(assertions?.length);
  f.sqlite.exec(readFileSync(new URL("../drizzle/0033_memory_structured_answer_provenance.sql",import.meta.url),"utf8"));
  const after=f.ledgerFootprint();await assert.rejects(()=>f.DB.batch(assertions));
  assert.equal(await replayNativeMemorySelection(f.env,selected),null,"the captured absent-schema bookend is not an unconditional absence shortcut");
  const fresh=await prepareNativeMemorySelection(f.env,f.current);assert.ok(fresh);assert.equal(fresh.mode,"extractive");
  assert.deepEqual(f.ledgerFootprint(),after,"fresh compatible schemas and genuine ledger absence remain read-only");
});

test("structured native selection: actual assertion receipt matching rejects missing extra failed and malformed acknowledgements",async t=>{
  const {nativeMemorySelectionMatches}=await import("../worker/memory-live-store.ts");
  const f=await structuredLedgerFixture(t,{pairs:1}),selection=await prepareNativeMemorySelection(f.env,f.current);assert.ok(selection);
  const statements=nativeMemorySelectionStatements(f.env,selection);assert.ok(statements?.length);
  const results=await f.DB.batch(statements);assert.equal(nativeMemorySelectionMatches(f.env,selection,results),true);
  for(const corrupt of [value=>value.pop(),value=>value.push(copy(value[0])),value=>{value[0].success=false;},
    value=>{value[0].error="synthetic-selection-ack";},value=>{value[0].results=[];},value=>{value[0].results=[{context_source_asserted:0}];}]){
    const damaged=copy(results);corrupt(damaged);assert.equal(nativeMemorySelectionMatches(f.env,selection,damaged),false);
  }
  assert.equal(nativeMemorySelectionMatches(f.env,{...selection},results),false);
  assert.equal(nativeMemorySelectionMatches({...f.env},selection,results),false);
});

const {prepareStructuredConversationContextOwnSend,structuredConversationContextOwnSendStatements,
  replayStructuredConversationContextOwnSend}=await import("../worker/memory-live-store.ts");
function structuredR6OwnFootprint(f,source,{id="r6-own",manifestText="{\"fixture\":\"source-footprint-only-not-an-origin-manifest\"}",
  createdAt=new Date().toISOString(),expiresAt=source.read.expiresAt}={}) {
  const sourceHead=f.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(f.stream).n;
  assert.equal(sourceHead,source.sourceHead);const turnId=id+"-turn";
  const scope=f.enrollment.organization_id===null?null:{organizationId:f.organizationId,projectAccessId:f.projectAccessId,
    projectId:f.projectId,ownerUserId:f.ownerId};
  const contents=[
    [id+"-user",f.actorId,"chat-user","Synthetic explicit memory recall request",createdAt,expiresAt,null],
    [id+"-answer",f.actorId,"chat-assistant-memory","Synthetic declared-history answer",createdAt,expiresAt,null],
    [id+"-manifest",f.actorId,"memory-structured-origin",manifestText,createdAt,expiresAt,null],
  ];
  const eventWrites=[0,1].map(index=>{
    const eventId=id+(index===0?"-user-event":"-answer-event"),payload={actor_user_id:f.actorId,turn_id:turnId,project_id:f.projectId,
      document_id:f.documentId,content_ref:contents[index][0],source_surface:"chat",...(index===1?{operation:"creative-chat",deterministic:true,
        memory_origin_version:2,organization_id:scope?.organizationId??null,project_access_id:scope?.projectAccessId??null,owner_user_id:f.ownerId}:{})};
    const split=publicEventPayload(eventId,payload,true);
    return[eventId,f.stream,sourceHead+index+1,createdAt,createdAt,"user:"+f.actorId,"web:assistant",f.actorId+":"+turnId,
      index===0?null:id+"-user-event",null,1,index===0?"ChatMessageSent":"AssistantReasoned",JSON.stringify(split.payload),
      f.ownerId,f.projectId,f.documentId,split.privateJson];
  });
  return{streamId:f.stream,sourceHead,actorUserId:f.actorId,turnId,projectId:f.projectId,documentId:f.documentId,
    manifestContentId:contents[2][0],memoryAnswer:{version:2},scope,eventWrites,contents,
    receipts:eventWrites.map((row,index)=>[f.stream,id+"-receipt-"+index,row[0],row[2],row[4]]),
    resources:scope?contents.map(row=>[scope.projectAccessId,"content",row[0],scope.organizationId,scope.projectId,scope.ownerUserId,"actor_private",null,f.actorId,row[4]]):[],
    retentions:scope?contents.map(row=>[row[0],scope.organizationId,scope.projectAccessId,scope.projectId,f.actorId,"transient-private",0,row[5],row[4]]):[]};
}
function structuredR6OwnWrites(f,own,{omit=""}={}) {
  const statements=[],add=(table,columns,values)=>statements.push(f.DB.prepare(
    `INSERT INTO ${table}(${columns}) VALUES(${values.map(()=>"?").join(",")})`).bind(...values));
  for(let index=0;index<own.contents.length;index++){
    if(omit==="manifest-body"&&index===2)continue;
    add("private_content","content_id,owner_id,kind,content,created_at,expires_at,redacted_at",own.contents[index]);
    if(own.scope){
      if(!(omit==="manifest-resource"&&index===2))add("project_resource_scopes",
        "project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at",own.resources[index]);
      if(!(omit==="manifest-retention"&&index===2))add("private_content_retention_scopes",
        "content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at",own.retentions[index]);
    }
  }
  const events=own.eventWrites.filter((_row,index)=>!(omit==="answer-event"&&index===1));
  // The producer stages the complete ordered suffix in one statement. Native
  // final assertions run only after all bodies, event/private rows and indexes.
  statements.push(f.DB.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload) VALUES"
    +events.map(()=>"("+Array(13).fill("?").join(",")+")").join(",")).bind(...events.flatMap(row=>row.slice(0,13))));
  for(let index=0;index<events.length;index++){
    const row=events[index];
    if(row[16]!==null&&!(omit==="answer-private-event"&&index===1))add("event_private_payloads",
      "private_event_id,owner_id,project_id,document_id,private_json,created_at,redacted_at",[row[0],row[13],row[14],row[15],row[16],row[4],null]);
    if(!(omit==="answer-receipt"&&index===1))add("event_client_receipts","stream_id,client_event_id,event_id,sequence,created_at",own.receipts[index]);
  }
  if(own.scope){
    const projectHead=f.sqlite.prepare("SELECT COALESCE(MAX(project_sequence),0) AS n FROM project_event_scopes WHERE project_access_id=? AND organization_id=?")
      .get(own.scope.projectAccessId,own.scope.organizationId).n;
    for(let index=0;index<events.length;index++)if(!(omit==="answer-project-index"&&index===1)){
      const row=events[index];add("project_event_scopes",
        "event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at",
        [row[0],own.scope.projectAccessId,own.scope.organizationId,own.projectId,own.scope.ownerUserId,own.streamId,row[2],projectHead+index+1,own.actorUserId,row[4]]);
    }
    if(omit!=="migration-head")statements.push(f.DB.prepare("UPDATE project_migration_states SET last_owner_sequence=? WHERE project_access_id=? AND organization_id=?")
      .bind(own.sourceHead+events.length,own.scope.projectAccessId,own.scope.organizationId));
  }
  return statements;
}
function structuredR6Footprint(f) {
  return{...f.ledgerFootprint(),...Object.fromEntries(["event_client_receipts","project_migration_states"].map(table=>[
    table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]))};
}

for(const mode of ["personal","shared-collaborator","shared-owner"])
test("structured native own source: "+mode+" separately certifies exactly two events and all three private bodies",async t=>{
  const f=await structuredLedgerFixture(t,{mode,pairs:1});await structuredLedgerPublish(f);
  const source=await prepareStructuredConversationContextSource(f.env,f.enrollment,f.current,f.frames);assert.ok(source);
  const own=structuredR6OwnFootprint(f,source),proof=await prepareStructuredConversationContextOwnSend(f.env,source,own);assert.ok(proof);
  const strict=structuredConversationContextSourceStatements(f.env,source),final=structuredConversationContextOwnSendStatements(f.env,proof);
  assert.ok(strict?.length);assert.ok(final?.length);assert.equal(await replayStructuredConversationContextOwnSend(f.env,proof),null,"prewrite state is not a complete own-send final proof");
  const writes=structuredR6OwnWrites(f,own),results=await f.DB.batch([...strict,...writes,...final]);
  assert.equal(results.length,strict.length+writes.length+final.length);assert.ok(results.every(result=>result.success===true));
  assert.equal(await replayStructuredConversationContextSource(f.env,source),null,"the original strict source certificate never receives an own-write exemption");
  assert.equal(await replayStructuredConversationContextOwnSend(f.env,proof),source);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id IN(?,?)").get(own.eventWrites[0][0],own.eventWrites[1][0]).n,2);
  for(const body of own.contents)assert.deepEqual({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(body[0])},
    Object.fromEntries(["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"].map((key,index)=>[key,body[index]])));
  if(own.scope){
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind='content' AND resource_id IN(?,?,?)").get(...own.contents.map(row=>row[0])).n,3);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content_retention_scopes WHERE content_id IN(?,?,?)").get(...own.contents.map(row=>row[0])).n,3);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM project_event_scopes WHERE event_id IN(?,?)").get(...own.eventWrites.map(row=>row[0])).n,2);
    assert.equal(f.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states WHERE project_access_id=?").get(f.projectAccessId).last_owner_sequence,own.sourceHead+2);
  }
  const completed=structuredR6Footprint(f);assert.equal(await replayStructuredConversationContextOwnSend(f.env,proof),source);
  assert.deepEqual(structuredR6Footprint(f),completed);
  // The third body here is an explicit source-footprint-only placeholder. This
  // does not qualify origin manifest semantics or the Creator write route.
});

test("structured native own source: partial suffix or missing manifest body custody receipt or project state cannot commit",async t=>{
  for(const omit of ["answer-event","manifest-body","manifest-resource","manifest-retention","answer-private-event","answer-receipt","answer-project-index","migration-head"]){
    const f=await structuredLedgerFixture(t,{mode:"shared-collaborator",pairs:1});await structuredLedgerPublish(f);
    const source=await prepareStructuredConversationContextSource(f.env,f.enrollment,f.current,f.frames);assert.ok(source);
    const own=structuredR6OwnFootprint(f,source),proof=await prepareStructuredConversationContextOwnSend(f.env,source,own);assert.ok(proof);
    const strict=structuredConversationContextSourceStatements(f.env,source),final=structuredConversationContextOwnSendStatements(f.env,proof);
    assert.ok(strict?.length);assert.ok(final?.length);const before=structuredR6Footprint(f);
    await assert.rejects(()=>f.DB.batch([...strict,...structuredR6OwnWrites(f,own,{omit}),...final]),omit);
    assert.deepEqual(structuredR6Footprint(f),before,"the actual isolated transaction must roll back all staged own rows, not merely hide a partial answer");
    assert.equal(await replayStructuredConversationContextOwnSend(f.env,proof),null);
    assert.equal(await replayStructuredConversationContextSource(f.env,source),source,"failed own insertion leaves the genuine original source snapshot usable");
  }
});

test("structured native own source: completed proof still binds every original ledger body manifest custody and exact scope",async t=>{
  for(const boundary of ["original","ledger-body","manifest","manifest-resource","manifest-retention","event-secret","event-receipt","enrollment"]){
    const f=await structuredLedgerFixture(t,{mode:"shared-collaborator",pairs:1});await structuredLedgerPublish(f);
    const source=await prepareStructuredConversationContextSource(f.env,f.enrollment,f.current,f.frames);assert.ok(source);
    const own=structuredR6OwnFootprint(f,source),proof=await prepareStructuredConversationContextOwnSend(f.env,source,own);assert.ok(proof);
    const strict=structuredConversationContextSourceStatements(f.env,source),final=structuredConversationContextOwnSendStatements(f.env,proof);assert.ok(strict?.length);assert.ok(final?.length);
    await f.DB.batch([...strict,...structuredR6OwnWrites(f,own),...final]);assert.equal(await replayStructuredConversationContextOwnSend(f.env,proof),source);
    if(boundary==="original")f.sqlite.prepare("UPDATE private_content SET content=content||' R6_OWN_OLD_ORIGINAL_DRIFT' WHERE content_id=?").run(f.rows[0].user.id);
    if(boundary==="ledger-body")f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(structuredLedgerHead(f).current_body_ref);
    if(boundary==="manifest")f.sqlite.prepare("UPDATE private_content SET content=content||' R6_OWN_MANIFEST_DRIFT' WHERE content_id=?").run(own.manifestContentId);
    if(boundary==="manifest-resource")f.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id=? WHERE resource_kind='content' AND resource_id=?").run(f.ownerId,own.manifestContentId);
    if(boundary==="manifest-retention")f.sqlite.prepare("UPDATE private_content_retention_scopes SET assigned_expires_at=? WHERE content_id=?").run(at(-1),own.manifestContentId);
    if(boundary==="event-secret")f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=?").run(own.eventWrites[1][0]);
    if(boundary==="event-receipt")f.sqlite.prepare("DELETE FROM event_client_receipts WHERE event_id=?").run(own.eventWrites[1][0]);
    if(boundary==="enrollment")f.sqlite.prepare("UPDATE memory_live_enrollments SET background_enabled=1 WHERE enrollment_id=?").run(f.enrollment.enrollment_id);
    const changed=structuredR6Footprint(f);await assert.rejects(()=>f.DB.batch(final),boundary);
    assert.equal(await replayStructuredConversationContextOwnSend(f.env,proof),null,boundary);assert.deepEqual(structuredR6Footprint(f),changed);
  }
});

test("structured native own source: copied source proof foreign database input mutation and original deadline cannot authorize a suffix",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
  const source=await prepareStructuredConversationContextSource(f.env,f.enrollment,f.current,f.frames);assert.ok(source);
  const own=structuredR6OwnFootprint(f,source),proof=await prepareStructuredConversationContextOwnSend(f.env,source,own);assert.ok(proof);
  for(const forged of [null,{},copy(source),{...source}])assert.equal(await prepareStructuredConversationContextOwnSend(f.env,forged,own),null);
  for(const forged of [null,{},copy(proof),{...proof},Object.create(proof)]){
    assert.equal(structuredConversationContextOwnSendStatements(f.env,forged),null);assert.equal(await replayStructuredConversationContextOwnSend(f.env,forged),null);
  }
  assert.equal(structuredConversationContextOwnSendStatements({...f.env},proof),null);
  assert.equal(await replayStructuredConversationContextOwnSend({...f.env},proof),null);
  const originalDb=f.env.DB;let replacementCalls=0;
  f.env.DB={prepare(...args){replacementCalls++;return originalDb.prepare(...args);},batch(...args){replacementCalls++;return originalDb.batch(...args);}};
  try{assert.equal(structuredConversationContextOwnSendStatements(f.env,proof),null);assert.equal(await replayStructuredConversationContextOwnSend(f.env,proof),null);assert.equal(replacementCalls,0);}
  finally{f.env.DB=originalDb;}
  const oldManifest=own.contents[2][3];own.contents[2][3]+=" CALLER_INPUT_MUTATION";
  assert.equal(structuredConversationContextOwnSendStatements(f.env,proof),null);assert.equal(await replayStructuredConversationContextOwnSend(f.env,proof),null);
  own.contents[2][3]=oldManifest;
  const dateNow=Date.now;
  try{Date.now=()=>Date.parse(source.read.validUntil);assert.equal(structuredConversationContextOwnSendStatements(f.env,proof),null);
    assert.equal(await replayStructuredConversationContextOwnSend(f.env,proof),null);}
  finally{Date.now=dateNow;}
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id IN(?,?)").get(...own.eventWrites.map(row=>row[0])).n,0);
});

test("structured native original context: actual assertion acknowledgements bind cardinality options environment and the original deadline",async t=>{
  const {nativeStructuredConversationContextMatches}=await import("../worker/memory-live-context.ts");
  const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
  const options={maxBytes:16384},wrapper=await prepareNativeStructuredConversationContext(f.env,f.enrollment,f.current,f.frames,options);assert.ok(wrapper);
  const statements=nativeStructuredConversationContextPrecommitStatements(f.env,wrapper.proof);assert.ok(statements?.length);
  const before=structuredR6Footprint(f),results=await f.DB.batch(statements);
  assert.equal(nativeStructuredConversationContextMatches(f.env,wrapper,results),true);
  for(const corrupt of [value=>value.pop(),value=>value.push(copy(value[0])),value=>{value[0].success=false;},
    value=>{delete value[0].success;},value=>{value[0].success=1;},value=>{value[0].error="synthetic-original-ack";},
    value=>{value[0].results=[];},value=>{value[0].results.push(copy(value[0].results[0]));},
    value=>{value[0].results[0].context_source_asserted=0;},value=>{value[0].results[0].context_source_asserted="1";},
    value=>{value[0].results[0].extra=1;},value=>{value[0].results[0]={};}]){
    const damaged=copy(results);corrupt(damaged);assert.equal(nativeStructuredConversationContextMatches(f.env,wrapper,damaged),false);
  }
  for(const forged of [null,{},copy(wrapper),{...wrapper},Object.create(wrapper)])
    assert.equal(nativeStructuredConversationContextMatches(f.env,forged,results),false);
  assert.equal(nativeStructuredConversationContextMatches({...f.env},wrapper,results),false);
  const originalDb=f.env.DB;let replacementCalls=0;
  f.env.DB={prepare(...args){replacementCalls++;return originalDb.prepare(...args);},batch(...args){replacementCalls++;return originalDb.batch(...args);}};
  try{assert.equal(nativeStructuredConversationContextMatches(f.env,wrapper,results),false);assert.equal(replacementCalls,0);}
  finally{f.env.DB=originalDb;}
  options.maxBytes=1;assert.equal(nativeStructuredConversationContextMatches(f.env,wrapper,results),false);
  options.maxBytes=16384;options.unrecognized=true;assert.equal(nativeStructuredConversationContextMatches(f.env,wrapper,results),false);
  delete options.unrecognized;assert.equal(nativeStructuredConversationContextMatches(f.env,wrapper,results),true);
  const dateNow=Date.now;
  try{Date.now=()=>Date.parse(wrapper.context.lifetime.validUntil);assert.equal(nativeStructuredConversationContextMatches(f.env,wrapper,results),false);}
  finally{Date.now=dateNow;}
  assert.deepEqual(structuredR6Footprint(f),before);
  // These are actual original-source assertion receipts, not proof that any
  // allocated answer is absent after rollback; the route owns that extra check.
});

// R6 durable structured-origin publication/privacy. Synthetic native rows only:
// genuine discovery/context/manifest preparation and exact atomic own writes,
// not the independently tested Creator route or a provider invocation.
const structuredR6OriginTables=["memory_structured_answer_origins","memory_structured_answer_originals","memory_structured_answer_ledger_revisions"];
async function structuredR6OriginFixture(t,{mode="personal"}={}) {
  const f=await structuredLedgerFixture(t,{mode,pairs:1});
  f.sqlite.exec(readFileSync(new URL("../drizzle/0033_memory_structured_answer_provenance.sql",import.meta.url),"utf8"));
  f.current=await f.prepare();assert.ok(!(f.current instanceof Response));
  const capture=await captureLegacyConversationOriginals(f.env,f.current,f.interval);assert.ok(capture);
  f.frames=[capture];await structuredLedgerPublish(f);return f;
}
function structuredR6OriginFootprint(f) {
  return{...structuredR6Footprint(f),...Object.fromEntries(structuredR6OriginTables.map(table=>[
    table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]))};
}
async function structuredR6PublishOrigin(f,id) {
  const origin=await import("../worker/memory-native-origin.ts"),context=await import("../worker/memory-live-context.ts");
  // Recapture from current native preparation after each own suffix. Canonical
  // discovery retains the old ledger's exact intervals, not newly written prose.
  f.current=await f.prepare();assert.ok(!(f.current instanceof Response));
  const selected=await prepareNativeMemorySelection(f.env,f.current);assert.ok(selected);assert.equal(selected.mode,"structured");
  const discovered=await discoverNativeStructuredConversationOriginals(f.env,f.current,selected);assert.ok(discovered);
  const wrapper=await prepareNativeStructuredConversationContext(f.env,discovered.enrollment,f.current,discovered.captures);assert.ok(wrapper);
  const evidence=await context.nativeStructuredConversationContextEvidence(f.env,wrapper);assert.ok(evidence);
  const hint=await origin.nativeStructuredMemoryOriginCapture(f.env,wrapper);assert.ok(hint);
  const createdAt=new Date().toISOString(),expiresAt=hint.sourceRetentionCeiling;
  const draft=structuredR6OwnFootprint(f,evidence.source,{id,createdAt,expiresAt});
  const answer={originId:id+"-origin",turnId:draft.turnId,userEventId:draft.eventWrites[0][0],userContentId:draft.contents[0][0],
    userSourceSequence:draft.eventWrites[0][2],user:draft.contents[0][3],answerEventId:draft.eventWrites[1][0],answerContentId:draft.contents[1][0],
    answerSourceSequence:draft.eventWrites[1][2],answer:draft.contents[1][3],createdAt,answerExpiresAt:expiresAt,
    manifestContentRef:draft.contents[2][0],manifestExpiresAt:expiresAt};
  const publication=await origin.prepareNativeStructuredMemoryOrigin(f.env,wrapper,answer);assert.ok(publication);
  const own=structuredR6OwnFootprint(f,evidence.source,{id,createdAt,expiresAt,manifestText:publication.manifest.text});
  const receiptPrefix="assistant:"+f.actorId+":"+(f.enrollment.project_access_id??"personal")+":"+f.documentId+":"+own.turnId;
  own.receipts=own.receipts.map((row,index)=>[row[0],receiptPrefix+(index===0?":user":":assistant"),...row.slice(2)]);
  assert.equal(publication.manifest.contentRef,own.manifestContentId);assert.equal(publication.manifest.expiresAt,expiresAt);
  const proof=await context.prepareNativeStructuredConversationOwnSend(f.env,wrapper,own);assert.ok(proof);
  const strict=nativeStructuredConversationContextPrecommitStatements(f.env,wrapper.proof);
  const final=context.nativeStructuredConversationOwnSendStatements(f.env,proof);assert.ok(strict?.length);assert.ok(final?.length);
  const writes=structuredR6OwnWrites(f,own),metadata=publication.statements.map(query=>f.DB.prepare(query.sql).bind(...query.bindings));
  writes.push(f.DB.prepare("INSERT INTO assistant_turns(turn_id,actor_user_id,scope_key,organization_id,project_access_id,project_id,document_id,route_family,user_content_ref,assistant_content_ref,proposal_json,permission_epoch,request_json,status,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(own.turnId,f.actorId,publication.header.scope_key,f.enrollment.organization_id,f.enrollment.project_access_id,f.projectId,f.documentId,
      "document",answer.userContentId,answer.answerContentId,null,f.enrollment.permission_epoch,JSON.stringify({message:answer.user}),"completed",createdAt,createdAt));
  assert.equal(metadata.length,5);assert.equal(origin.nativeStructuredMemoryOriginPublicationCurrent(f.env,wrapper,publication),true);
  const results=await f.DB.batch([...strict,...writes,...metadata,...final]);
  assert.equal(results.length,strict.length+writes.length+metadata.length+final.length);
  assert.ok(results.every(result=>result?.success===true&&result.error===undefined&&Array.isArray(result.results)));
  for(const result of results.slice(0,strict.length))assert.deepEqual(result.results.map(row=>({...row})),[{context_source_asserted:1}]);
  for(let index=0;index<writes.length;index++)assert.equal(results[strict.length+index].meta.changes,
    writes[index].sql.startsWith("INSERT INTO events(")?2:1,"every own mutation has its exact native receipt");
  const offset=strict.length+writes.length;
  assert.deepEqual(results[offset].results.map(row=>({...row})),[{verified:1}]);assert.deepEqual(results[offset+4].results.map(row=>({...row})),[{verified:1}]);
  for(const [index,changes] of [[1,1],[2,publication.originals.length],[3,publication.ledgerRevisions.length]])
    assert.equal(results[offset+index].meta.changes,changes);
  const ownResults=results.slice(offset+metadata.length);
  assert.equal(context.nativeStructuredConversationOwnSendMatches(f.env,proof,ownResults),true);
  for(const corruption of ["missing","extra","sparse","failure","error","missing-row","wrong-assertion","extra-column"]){
    const damaged=copy(ownResults);
    if(corruption==="missing")damaged.pop();
    if(corruption==="extra")damaged.push(copy(damaged[0]));
    if(corruption==="sparse")delete damaged[0];
    if(corruption==="failure")damaged[0].success=false;
    if(corruption==="error")damaged[0].error="synthetic-own-publication-ack-error";
    if(corruption==="missing-row")damaged[0].results=[];
    if(corruption==="wrong-assertion")damaged[0].results=[{context_source_asserted:0}];
    if(corruption==="extra-column")damaged[0].results=[{context_source_asserted:1,unexpected:1}];
    assert.equal(context.nativeStructuredConversationOwnSendMatches(f.env,proof,damaged),false,corruption);
  }
  assert.equal(origin.nativeStructuredMemoryOriginPublicationCurrent(f.env,wrapper,publication),true);
  return{publication,answer,own,wrapper,proof};
}
async function structuredR6ReadOrigin(f,published) {
  const reader=await import("../worker/memory-native-origin-reader.ts"),{AssistantContextReadWitness}=await import("../worker/assistant-context-source.ts");
  const prepared=await f.prepare();assert.ok(!(prepared instanceof Response));
  const observer=new AssistantContextReadWitness(f.env),target={originId:published.answer.originId,turnId:published.answer.turnId,
    answerEventId:published.answer.answerEventId,answerContentId:published.answer.answerContentId,answer:published.answer.answer};
  const read=await reader.revalidateNativeStructuredAnswerOrigin(f.env,prepared,target,observer);
  if(!read)return null;
  observer.seal(null);const ordinary=observer.statements(),native=reader.nativeStructuredMemoryOriginReadStatements(f.env,read);
  assert.ok(ordinary.length);assert.ok(native?.length);
  const results=await f.DB.batch([...ordinary,...native]);assert.equal(results.length,ordinary.length+native.length);
  assert.ok(results.every(result=>result.success===true&&result.error===undefined&&Array.isArray(result.results)));
  assert.equal(observer.matches(results.slice(0,ordinary.length)),true);
  assert.equal(reader.nativeStructuredMemoryOriginReadMatches(f.env,read,results.slice(ordinary.length)),true);
  assert.equal(reader.nativeStructuredMemoryOriginReadMatches(f.env,read,new Array(native.length)),false,
    "a genuinely issued read cannot acknowledge a same-length sparse final result slice");
  return read;
}

for(const mode of ["personal","shared-collaborator"])
test("structured native origin publication: "+mode+" commits exact manifests dependency rows and native read authority",async t=>{
  const f=await structuredR6OriginFixture(t,{mode}),published=await structuredR6PublishOrigin(f,"r6-published-"+mode);
  const {publication,own}=published;
  assert.deepEqual({...f.sqlite.prepare("SELECT * FROM memory_structured_answer_origins WHERE origin_id=?").get(publication.header.origin_id)},publication.header);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM memory_structured_answer_originals WHERE origin_id=? ORDER BY ordinal").all(publication.header.origin_id).map(row=>({...row})),publication.originals);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM memory_structured_answer_ledger_revisions WHERE origin_id=? ORDER BY ordinal").all(publication.header.origin_id).map(row=>({...row})),publication.ledgerRevisions);
  assert.deepEqual(publication.originals.map(row=>row.event_id),f.refs.map(row=>row.eventId));
  assert.equal(publication.ledgerRevisions.length,1);assert.equal(publication.ledgerRevisions[0].body_ref,structuredLedgerHead(f).current_body_ref);
  for(const body of own.contents)assert.deepEqual({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(body[0])},
    Object.fromEntries(["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"].map((key,index)=>[key,body[index]])));
  const manifest=JSON.parse(publication.manifest.text);assert.equal(manifest.contextJson,JSON.stringify(published.wrapper.context));
  assert.equal(manifest.publicationValidUntil,published.wrapper.context.lifetime.validUntil);
  const before=structuredR6OriginFootprint(f),read=await structuredR6ReadOrigin(f,published);assert.ok(read);
  assert.equal(read.originId,publication.header.origin_id);assert.ok(Date.parse(read.validUntil)<=Date.parse(publication.header.source_retention_ceiling));
  assert.deepEqual(structuredR6OriginFootprint(f),before,"fresh persisted-origin validation is read-only");
});

async function structuredR6DrainOrigins(f) {
  const {prepareNativeStructuredOriginRetentionStep}=await import("../worker/memory-native-origin.ts");
  const now=new Date().toISOString();let units=0;
  // Only this fixture's at most two origins: bounded assertions over the real
  // existing one-unit lifecycle API, not a scheduler or replacement runtime.
  for(let index=0;index<24;index++){
    const step=await prepareNativeStructuredOriginRetentionStep(f.env,{now});
    if(!step)return units;
    assert.equal(step.workUnits,1);
    const results=await f.DB.batch(step.statements.map(query=>f.DB.prepare(query.sql).bind(...query.bindings)));
    assert.equal(results.length,step.statements.length);
    assert.ok(results.every(result=>result.success===true&&result.error===undefined&&Array.isArray(result.results)));
    assert.equal(step.acknowledge(results),true);units++;
  }
  assert.fail("isolated two-origin lifecycle did not complete within its known finite units");
}
const structuredR6MinimizedFields=["origin_id","schema_version","recipe_version","actor_user_id","scope_key","turn_id",
  "user_event_id","user_content_id","answer_event_id","answer_content_id","manifest_content_ref","status","withdrawn_at","withdrawal_reason"];
function structuredR6AssertOriginCleared(f,published,reason="erased") {
  const originId=published.answer.originId,header=f.sqlite.prepare("SELECT * FROM memory_structured_answer_origins WHERE origin_id=?").get(originId);
  assert.equal(header.status,"minimized");assert.ok(Number.isFinite(Date.parse(header.withdrawn_at)));assert.equal(header.withdrawal_reason,reason);
  assert.deepEqual({...header},Object.fromEntries(Object.entries(published.publication.header).map(([key,value])=>[key,
    !structuredR6MinimizedFields.includes(key)?null:key==="status"?"minimized":key==="withdrawn_at"?header.withdrawn_at:key==="withdrawal_reason"?reason:value])));
  for(const ref of [published.answer.answerContentId,published.answer.manifestContentRef]){
    assert.equal(f.sqlite.prepare("SELECT 1 FROM private_content WHERE content_id=?").get(ref),undefined);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ref).n,0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content_retention_scopes WHERE content_id=?").get(ref).n,0);
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_answer_originals WHERE origin_id=?").get(originId).n,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_answer_ledger_revisions WHERE origin_id=?").get(originId).n,0);
  assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(published.answer.userContentId).content,published.answer.user,
    "origin cleanup does not erase the separate authored message");
}

test("structured native origin cleanup: missing enrollment or ledger metadata cannot strand answer manifest or dependency sidecars",async t=>{
  for(const boundary of ["enrollment","ledger"]){
    const f=await structuredR6OriginFixture(t,{mode:"shared-collaborator"}),published=await structuredR6PublishOrigin(f,"r6-lost-"+boundary);
    assert.ok(await structuredR6ReadOrigin(f,published));
    const originalBodies=f.refs.map(ref=>({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(ref.contentRef)}));
    const ledgerId=structuredLedgerHead(f).ledger_id,ledgerRefs=structuredLedgerRevisions(f).map(row=>row.body_ref);
    const ledgerBodies=ledgerRefs.map(ref=>({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(ref)}));
    if(boundary==="enrollment")f.sqlite.prepare("DELETE FROM memory_live_enrollments WHERE enrollment_id=?").run(f.enrollment.enrollment_id);
    else{
      // Simulate isolated native metadata loss in dependency-first order without
      // touching the separate durable-origin graph or its retained private bytes.
      f.sqlite.prepare("DELETE FROM memory_structured_conversation_revisions WHERE ledger_id=?").run(ledgerId);
      f.sqlite.prepare("DELETE FROM memory_structured_conversation_heads WHERE ledger_id=?").run(ledgerId);
      assert.ok(f.sqlite.prepare("SELECT 1 FROM memory_live_enrollments WHERE enrollment_id=?").get(f.enrollment.enrollment_id));
    }
    assert.equal(await structuredR6ReadOrigin(f,published),null,boundary);
    assert.equal(await structuredR6DrainOrigins(f),9,"one mark, two redactions, three dependencies, two body-row removals and one minimization");
    structuredR6AssertOriginCleared(f,published,"source-unavailable");
    const header=f.sqlite.prepare("SELECT status,withdrawal_reason FROM memory_structured_answer_origins WHERE origin_id=?").get(published.answer.originId);
    assert.equal(header.status,"minimized");assert.equal(header.withdrawal_reason,"source-unavailable");
    assert.deepEqual(f.refs.map(ref=>({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(ref.contentRef)})),originalBodies);
    assert.deepEqual(ledgerRefs.map(ref=>({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(ref)})),ledgerBodies,
      "captured body identities remain checkable even after their native ledger rows are gone");
    const completed=structuredR6OriginFootprint(f);assert.equal(await structuredR6DrainOrigins(f),0);assert.deepEqual(structuredR6OriginFootprint(f),completed);
  }
});

const structuredR6PrivacyHeaders=f=>({"oai-authenticated-user-id":f.actorId,"oai-authenticated-user-email":f.actorId+"@example.test",
  "oai-authenticated-user-name":f.actorId,"content-type":"application/json","origin":"http://localhost"});
async function structuredR6Forget(f,revision=f.enrollment.revision) {
  const {handleLiveMemory}=await import("../worker/memory-live-api.ts");
  return handleLiveMemory(new Request("http://localhost/api/memory/settings?id="+encodeURIComponent(f.enrollment.enrollment_id),{
    method:"DELETE",headers:structuredR6PrivacyHeaders(f),body:JSON.stringify({confirmation:"FORGET_MY_MEMORY",revision})}),f.env,"settings");
}
async function structuredR6CleanupStatus(f) {
  const {handleLiveMemory}=await import("../worker/memory-live-api.ts");
  const response=await handleLiveMemory(new Request("http://localhost/api/memory/settings",{headers:structuredR6PrivacyHeaders(f)}),f.env,"settings");
  assert.equal(response.status,200);const value=await response.json();
  assert.equal(JSON.stringify(value).includes("Synthetic declared-history answer"),false);
  assert.equal(JSON.stringify(value).includes("contextJson"),false,"privacy status never exports the private origin manifest");
  const enrollment=value.enrollments.find(row=>row.id===f.enrollment.enrollment_id);assert.ok(enrollment);return enrollment.structuredCleanup;
}
async function structuredR6TwoOrigins(f,id) {
  const first=await structuredR6PublishOrigin(f,id+"-first"),second=await structuredR6PublishOrigin(f,id+"-second");
  assert.notEqual(first.answer.originId,second.answer.originId);assert.notEqual(first.answer.answerEventId,second.answer.answerEventId);
  assert.equal(second.publication.header.source_head,first.publication.header.answer_source_sequence);
  assert.deepEqual(second.publication.originals.map(row=>row.event_id),first.publication.originals.map(row=>row.event_id));
  assert.deepEqual(second.publication.ledgerRevisions.map(row=>[row.ledger_id,row.storage_revision,row.body_ref]),
    first.publication.ledgerRevisions.map(row=>[row.ledger_id,row.storage_revision,row.body_ref]));
  assert.ok(await structuredR6ReadOrigin(f,first));assert.ok(await structuredR6ReadOrigin(f,second));
  return[first,second];
}

test("structured native origin privacy: actual forget withdraws both same-history origins and reports pending until their cleanup completes",async t=>{
  const f=await structuredR6OriginFixture(t),published=await structuredR6TwoOrigins(f,"r6-forget-fanout"),ledgerId=structuredLedgerHead(f).ledger_id;
  const originals=f.refs.map(ref=>({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(ref.contentRef)}));
  const response=await structuredR6Forget(f);assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{erased:false,memoryWithdrawn:true,physicalCleanupPending:true,reEnrollmentRequired:true,otherDevicesAndBackupsPurged:false});
  const tombstones=published.map(value=>({...f.sqlite.prepare("SELECT * FROM memory_structured_answer_origins WHERE origin_id=?").get(value.answer.originId)}));
  assert.ok(tombstones.every(row=>row.status==="withdrawn"&&row.withdrawn_at&&row.withdrawal_reason==="erased"));
  for(const value of published){
    assert.equal(await structuredR6ReadOrigin(f,value),null);
    assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(value.answer.answerContentId).content,value.answer.answer);
    assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(value.answer.manifestContentRef).content,value.publication.manifest.text);
  }
  assert.deepEqual(await structuredR6CleanupStatus(f),{scopeKey:ledgerId,state:"pending"});
  const {prepareNativeStructuredOriginRetentionStep}=await import("../worker/memory-native-origin.ts"),now=new Date().toISOString();
  for(let unit=1;unit<=16;unit++){
    const step=await prepareNativeStructuredOriginRetentionStep(f.env,{now});assert.ok(step);assert.equal(step.workUnits,1);
    const results=await f.DB.batch(step.statements.map(query=>f.DB.prepare(query.sql).bind(...query.bindings)));
    assert.equal(results.length,step.statements.length);
    assert.ok(results.every(result=>result.success===true&&result.error===undefined&&Array.isArray(result.results)));
    assert.equal(step.acknowledge(results),true);
    if(unit===13||unit===15){
      // Check the last consumer's fifth and seventh units. An untouched sibling
      // would otherwise mask a false complete status after redaction or deletion.
      const remaining=published.filter(value=>f.sqlite.prepare("SELECT status FROM memory_structured_answer_origins WHERE origin_id=?").get(value.answer.originId).status!=="minimized");
      assert.equal(remaining.length,1);const current=remaining[0];
      published.filter(value=>value!==current).forEach(value=>structuredR6AssertOriginCleared(f,value));
      assert.equal(f.sqlite.prepare("SELECT status FROM memory_structured_answer_origins WHERE origin_id=?").get(current.answer.originId).status,"withdrawn");
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_answer_originals WHERE origin_id=?").get(current.answer.originId).n,0);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_answer_ledger_revisions WHERE origin_id=?").get(current.answer.originId).n,0);
      for(const ref of [current.answer.answerContentId,current.answer.manifestContentRef]){
        const body=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(ref);
        if(unit===13){assert.ok(body);assert.equal(body.content,"");assert.ok(body.redacted_at);}
        else assert.equal(body,undefined);
      }
      assert.deepEqual(await structuredR6CleanupStatus(f),{scopeKey:ledgerId,state:"pending"},
        unit===13?"blank derived rows and the retained header still require cleanup":"absent derived rows do not complete the remaining header minimization");
    }
  }
  assert.equal(await structuredR6DrainOrigins(f),0,"both independent eight-unit fanouts are minimized, not only the latest answer");
  published.forEach(value=>structuredR6AssertOriginCleared(f,value));
  const retained=header=>Object.fromEntries(structuredR6MinimizedFields.filter(key=>key!=="status").map(key=>[key,header[key]]));
  assert.deepEqual(published.map(value=>retained(f.sqlite.prepare("SELECT * FROM memory_structured_answer_origins WHERE origin_id=?").get(value.answer.originId))),tombstones.map(retained),
    "bounded cleanup preserves the fourteen-field fence's first withdrawal and immutable answer identities");
  assert.deepEqual(await structuredR6CleanupStatus(f),{scopeKey:ledgerId,state:"complete"});
  assert.deepEqual(f.refs.map(ref=>({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(ref.contentRef)})),originals);
});

test("structured native origin privacy: held answer and manifest retain custody while another same-history origin can clear",async t=>{
  const f=await structuredR6OriginFixture(t,{mode:"shared-collaborator"}),published=await structuredR6TwoOrigins(f,"r6-held-fanout");
  const [held,unheld]=published,ledgerId=structuredLedgerHead(f).ledger_id,refs=[held.answer.answerContentId,held.answer.manifestContentRef];
  const heldRows=()=>({bodies:refs.map(ref=>({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(ref)})),
    resources:refs.map(ref=>({...f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(ref)})),
    retentions:refs.map(ref=>({...f.sqlite.prepare("SELECT * FROM private_content_retention_scopes WHERE content_id=?").get(ref)}))});
  for(let index=0;index<refs.length;index++)f.insert("organization_legal_holds",{hold_id:"r6-held-derived-"+index,organization_id:f.organizationId,
    scope_kind:"content",resource_id:refs[index],reason:"isolated derived-body qualification",status:"active",created_by_user_id:f.ownerId,
    created_at:new Date().toISOString(),released_at:null});
  const before=heldRows(),response=await structuredR6Forget(f);assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{erased:false,memoryWithdrawn:true,physicalCleanupPending:true,reEnrollmentRequired:true,otherDevicesAndBackupsPurged:false});
  for(const value of published)assert.equal(await structuredR6ReadOrigin(f,value),null,"legal holds preserve bytes, not recall authority");
  assert.equal(await structuredR6DrainOrigins(f),8);structuredR6AssertOriginCleared(f,unheld);assert.deepEqual(heldRows(),before);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_answer_originals WHERE origin_id=?").get(held.answer.originId).n,2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_answer_ledger_revisions WHERE origin_id=?").get(held.answer.originId).n,1);
  const {nativeStructuredOriginRetentionBacklog}=await import("../worker/memory-native-origin.ts");
  assert.deepEqual(await nativeStructuredOriginRetentionBacklog(f.env,{now:new Date().toISOString()}),{count:0,oldest:null},
    "no currently eligible work is not a physical erasure claim for held residue");
  assert.deepEqual(await structuredR6CleanupStatus(f),{scopeKey:ledgerId,state:"pending"});
  const firstTerminal=f.sqlite.prepare("SELECT withdrawn_at FROM memory_structured_answer_origins WHERE origin_id=?").get(held.answer.originId).withdrawn_at;
  f.sqlite.prepare("UPDATE organization_legal_holds SET status='released',released_at=? WHERE hold_id IN('r6-held-derived-0','r6-held-derived-1')").run(new Date().toISOString());
  assert.equal(await structuredR6DrainOrigins(f),8);structuredR6AssertOriginCleared(f,held);
  assert.equal(f.sqlite.prepare("SELECT withdrawn_at FROM memory_structured_answer_origins WHERE origin_id=?").get(held.answer.originId).withdrawn_at,firstTerminal);
  assert.deepEqual(await structuredR6CleanupStatus(f),{scopeKey:ledgerId,state:"complete"});
});

test("structured native origin privacy: lost actual forget acknowledgement is unknown despite persisted two-origin withdrawal",async t=>{
  const f=await structuredR6OriginFixture(t),published=await structuredR6TwoOrigins(f,"r6-unknown-forget"),ledgerId=structuredLedgerHead(f).ledger_id;
  let damaged=0;
  f.hooks.afterBatch=(statements,results)=>{
    if(damaged||!statements.some(statement=>statement.sql.includes("UPDATE memory_structured_answer_origins"))
      ||!statements.some(statement=>statement.sql.includes("UPDATE memory_live_enrollments")))return;
    damaged++;assert.equal(results.length,statements.length);assert.ok(results.every(result=>result.success===true));
    assert.ok(published.every(value=>f.sqlite.prepare("SELECT status FROM memory_structured_answer_origins WHERE origin_id=?").get(value.answer.originId).status==="withdrawn"));
    const enrollment=f.sqlite.prepare("SELECT revision,recall_enabled FROM memory_live_enrollments WHERE enrollment_id=?").get(f.enrollment.enrollment_id);
    assert.equal(enrollment.revision,f.enrollment.revision+1);assert.equal(enrollment.recall_enabled,0);
    results.pop(); // Damage only the returned receipt after the real native COMMIT.
  };
  let response;
  try{response=await structuredR6Forget(f);}finally{f.hooks.afterBatch=null;}
  assert.equal(damaged,1);assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:"memory_write_unconfirmed"});
  for(const value of published)assert.equal(await structuredR6ReadOrigin(f,value),null);
  assert.deepEqual(await structuredR6CleanupStatus(f),{scopeKey:ledgerId,state:"pending"},"fresh GET observes persisted state without retroactively acknowledging the lost response");
  assert.equal(await structuredR6DrainOrigins(f),16);published.forEach(value=>structuredR6AssertOriginCleared(f,value));
  assert.deepEqual(await structuredR6CleanupStatus(f),{scopeKey:ledgerId,state:"complete"});
});

// Finite R6 discovery/absence review corrections. These extend the same native
// fixture; saved interval data never stands in for an issued capture or proof.
function structuredR6AppendPersonalOriginalPair(f,id,documentId=f.documentId) {
  assert.equal(f.enrollment.organization_id,null);const correlation=id+"-correlation",turnId=id+"-turn";
  const body=(role,text)=>{
    const value={id:id+"-"+role,role,text,expiry:f.expiry};
    f.insert("private_content",{content_id:value.id,owner_id:f.actorId,kind:"chat-"+role,content:text,
      created_at:at(-8_000),expires_at:f.expiry,redacted_at:null});return value;
  };
  const user=body("user","Exact synthetic personal request "+id),budget=f.event("BudgetReserved",{
    operation:"creative-chat",reservation_id:id+"-budget",cost_reservation_id:id+"-cost",reserved_tokens:12000,
    reserved_microusd:1,period:"2026-09",live_preview:false},{id:id+"-budget-event",actor:"worker:policy",correlation});
  const authored=f.event("ChatMessageSent",{turn_id:turnId,document_id:documentId,content_ref:user.id,content_expires_at:f.expiry,
    source_surface:"chat",live_preview:false},{id:id+"-user-event",actor:"user",correlation,causation:budget.event_id});
  const assistant=body("assistant","Exact synthetic personal answer "+id),answered=f.event("AssistantReasoned",{
    operation:"creative-chat",turn_id:turnId,document_id:documentId,content_ref:assistant.id,content_expires_at:f.expiry,
    provider:"openai",provider_response_id:id+"-response",model_id:"historical-model",latency_ms:1,mutation_count:0,
    reference_pixel_mutation_count:0,preview_worthy:false,live_preview_requested:false,preview_queued:false,
    preview_direction_ref:null,preview_suppressed:false},{id:id+"-answer-event",actor:"model:forma-chat",correlation,causation:authored.event_id});
  return{turnId,correlation,jobId:null,budget,user:{...user,event:authored},assistant:{...assistant,event:answered}};
}
const structuredR6PairInterval=pair=>({afterSequence:pair.user.event.sequence-1,throughSequence:pair.assistant.event.sequence});

test("structured native discovery correction: sparse retained turns stay separate across genuine unrelated document chat",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1}),first=f.rows[0],otherDocument="r6-sparse-other-document";
  f.append("DocumentCreated",{project_id:f.projectId,document_id:otherDocument,title:"Synthetic unrelated document"});
  const unrelated=structuredR6AppendPersonalOriginalPair(f,"r6-sparse-unrelated",otherDocument);
  const second=structuredR6AppendPersonalOriginalPair(f,"r6-sparse-retained");
  f.rows=[first,second];f.refs=f.rows.flatMap(pair=>[structuredLedgerRef(pair,pair.user),structuredLedgerRef(pair,pair.assistant)]);
  f.current=await f.prepare();assert.ok(!(f.current instanceof Response));const intervals=f.rows.map(structuredR6PairInterval);
  f.frames=[];for(const interval of intervals){const capture=await captureLegacyConversationOriginals(f.env,f.current,interval);assert.ok(capture);f.frames.push(capture);}
  const asserted=await structuredLedgerPublish(f),withdrawn=await structuredLedgerPublish(f,1,asserted,
    {revision:2,operation:"withdraw",predecessor:{itemId:"declared-goal",revision:1}});
  const selection=await prepareNativeMemorySelection(f.env,f.current);assert.ok(selection);assert.equal(selection.mode,"structured");
  const before=structuredR6Footprint(f),discovered=await discoverNativeStructuredConversationOriginals(f.env,f.current,selection);assert.ok(discovered);
  assert.deepEqual(discovered.intervals,intervals);assert.equal(discovered.captures.length,2);
  const originals=[];
  for(let index=0;index<discovered.captures.length;index++){
    const receipt=await replayLegacyConversationOriginals(f.env,f.current,discovered.captures[index]);assert.ok(receipt);
    assert.deepEqual(receipt.interval,intervals[index]);originals.push(...receipt.originals);
  }
  assert.deepEqual(originals.map(structuredR6Ref),f.refs);
  assert.ok(originals.every(original=>original.eventId!==unrelated.user.event.event_id&&original.eventId!==unrelated.assistant.event.event_id));
  const wrapper=await prepareNativeStructuredConversationContext(f.env,discovered.enrollment,f.current,discovered.captures);assert.ok(wrapper);
  assert.deepEqual(wrapper.context.ledger.annotations,withdrawn.ledger.annotations);assert.deepEqual(wrapper.context.dependencies.retainedOriginals,f.refs);
  assert.equal(await discoverNativeStructuredConversationOriginals(f.env,f.current,selection,[{
    afterSequence:intervals[0].afterSequence,throughSequence:intervals[1].throughSequence}]),null,
    "a requested mixed-document interval must fail genuine source admission, not be silently narrowed");
  assert.deepEqual(structuredR6Footprint(f),before);
});

test("structured native selection correction: absent heads cannot hide malformed markers or actor orphan manifests but preserve registered other scopes",async t=>{
  for(const schema of ["absent","empty"]){
    for(const boundary of ["v2-current","null-marker","string-marker","mixed-null-custody","reverse-mixed-custody","empty-project","empty-document","empty-shared-tuple","orphan-manifest","blank-orphan-manifest"]){
      const f=await structuredLedgerFixture(t,{pairs:0});
      if(schema==="empty")f.sqlite.exec(readFileSync(new URL("../drizzle/0033_memory_structured_answer_provenance.sql",import.meta.url),"utf8"));
      const initial=await prepareNativeMemorySelection(f.env,f.current);assert.ok(initial);assert.equal(initial.mode,"extractive");
      if(boundary==="orphan-manifest"||boundary==="blank-orphan-manifest")f.insert("private_content",{content_id:"r6-unregistered-manifest",owner_id:f.actorId,
        kind:"memory-structured-origin",content:boundary==="blank-orphan-manifest"?"":"Synthetic unregistered manifest metadata",
        created_at:at(-1_000),expires_at:f.expiry,redacted_at:boundary==="blank-orphan-manifest"?at(-500):null});
      else{
        // Deliberate metadata corruption only, not a purported valid answer or
        // private source certificate. Nonmatching scopes isolate shape checks.
        const payload={project_id:f.projectId,document_id:boundary==="v2-current"?f.documentId:"r6-other-marker-document",
          organization_id:null,project_access_id:null,owner_user_id:f.ownerId,actor_user_id:f.actorId,
          content_ref:"r6-marker-body",turn_id:"r6-marker-turn",operation:"creative-chat",deterministic:true,source_surface:"chat",memory_origin_version:2};
        if(boundary==="null-marker"){payload.memory_origin_version=null;payload.document_id=f.documentId;}
        if(boundary==="string-marker"){payload.memory_origin_version="2";payload.document_id=f.documentId;}
        if(boundary==="mixed-null-custody")payload.project_access_id="r6-marker-access";
        if(boundary==="reverse-mixed-custody")payload.organization_id="r6-marker-organization";
        if(boundary==="empty-project")payload.project_id="";
        if(boundary==="empty-document")payload.document_id="";
        if(boundary==="empty-shared-tuple"){payload.organization_id="";payload.project_access_id="";}
        f.append("AssistantReasoned",payload,{eventId:"r6-invalid-marker",actor:"user:"+f.actorId});
      }
      f.current=await f.prepare();assert.ok(!(f.current instanceof Response));
      const before=structuredR6Footprint(f);assert.equal(await prepareNativeMemorySelection(f.env,f.current),null,schema+":"+boundary);
      assert.deepEqual(structuredR6Footprint(f),before);
    }
  }
  const f=await structuredR6OriginFixture(t),otherDocument="r6-valid-other-scope";
  // Create the second real document before the publisher's direct own suffix;
  // the existing append closure must never allocate a post-publication sequence.
  f.append("DocumentCreated",{project_id:f.projectId,document_id:otherDocument,title:"Synthetic other personal scope"});
  const prepareOther=()=>prepareDocumentAuthority(new Request("http://localhost/api/context/read",{headers:structuredR6PrivacyHeaders(f)}),
    f.env,{projectId:f.projectId,documentId:otherDocument},"read");
  const otherPrepared=await prepareOther();assert.ok(!(otherPrepared instanceof Response));
  f.insert("memory_live_enrollments",{...f.enrollment,enrollment_id:"r6-other-scope-enrollment",document_id:otherDocument,
    permission_epoch:otherPrepared.principal.access.permissionEpoch,cursor_sequence:otherPrepared.sourceHead});
  const published=await structuredR6PublishOrigin(f,"r6-registered-other-scope"),current=await prepareOther();assert.ok(!(current instanceof Response));
  const before=structuredR6OriginFootprint(f),selection=await prepareNativeMemorySelection(f.env,current);assert.ok(selection);assert.equal(selection.mode,"extractive");
  assert.equal(selection.enrollment.document_id,otherDocument);assert.equal(await replayNativeMemorySelection(f.env,selection),selection);
  assert.ok(await structuredR6ReadOrigin(f,published),"the genuine other-scope marker and registered manifest remain readable and untouched");
  assert.deepEqual(structuredR6OriginFootprint(f),before);
});

test("structured native discovery correction: saved custom intervals select fresh genuine captures without granting authority",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:2}),saved=f.rows.map(structuredR6PairInterval);f.frames=[];
  for(const interval of saved){const capture=await captureLegacyConversationOriginals(f.env,f.current,interval);assert.ok(capture);f.frames.push(capture);}
  await structuredLedgerPublish(f);
  const issued=await prepareNativeStructuredConversationContext(f.env,f.enrollment,f.current,f.frames);assert.ok(issued);
  const {nativeStructuredConversationContextEvidence,revalidateNativeStructuredConversationProjection}=await import("../worker/memory-live-context.ts");
  const evidence=await nativeStructuredConversationContextEvidence(f.env,issued);assert.ok(evidence);
  const selection=await prepareNativeMemorySelection(f.env,f.current);assert.ok(selection);
  const defaultDiscovery=await discoverNativeStructuredConversationOriginals(f.env,f.current,selection);assert.ok(defaultDiscovery);
  assert.equal(defaultDiscovery.intervals.length,1,"ordinary contiguous pairs have a different canonical grouping from this saved presentation");
  const copiedMetadata=copy(saved),before=structuredR6Footprint(f);
  assert.equal(await replayLegacyConversationOriginals(f.env,f.current,copiedMetadata[0]),null,"interval data is not a capture");
  const discovered=await discoverNativeStructuredConversationOriginals(f.env,f.current,selection,copiedMetadata);assert.ok(discovered);
  assert.deepEqual(discovered.intervals,saved);assert.equal(discovered.captures.length,2);
  const originals=[];
  for(let index=0;index<discovered.captures.length;index++){
    assert.notEqual(discovered.captures[index],f.frames[index],"saved metadata causes a fresh native capture, not a reused public token");
    const receipt=await replayLegacyConversationOriginals(f.env,f.current,discovered.captures[index]);assert.ok(receipt);originals.push(...receipt.originals);
  }
  assert.deepEqual(originals.map(structuredR6Ref),f.refs);
  const replayed=await prepareNativeStructuredConversationContext(f.env,discovered.enrollment,f.current,discovered.captures);assert.ok(replayed);
  assert.deepEqual(replayed.context.dependencies.retainedOriginals,f.refs);
  assert.equal(await revalidateNativeStructuredConversationProjection(f.env,replayed,evidence.contextJson,evidence.projectionOptions),true);
  assert.equal(await prepareNativeStructuredConversationContext(f.env,f.enrollment,f.current,discovered.captures.map(capture=>({...capture}))),null,
    "copying discovered public capture metadata does not mint private authority");
  for(const intervals of [copy(saved).slice(1),[{...saved[0],afterSequence:saved[0].afterSequence+1},copy(saved[1])],
    [copy(saved[0]),{...saved[1],throughSequence:f.current.sourceHead+1}]])
    assert.equal(await discoverNativeStructuredConversationOriginals(f.env,f.current,selection,intervals),null);
  assert.deepEqual(structuredR6Footprint(f),before);
  f.sqlite.prepare("UPDATE private_content SET content=content||' R6_SAVED_SOURCE_DRIFT' WHERE content_id=?").run(f.rows[0].user.id);
  const drifted=structuredR6Footprint(f);assert.equal(await discoverNativeStructuredConversationOriginals(f.env,f.current,selection,copy(saved)),null);
  assert.deepEqual(structuredR6Footprint(f),drifted);
});

test("structured native discovery correction: saved interval inventories reject invalid descriptors and changes before source capture",async t=>{
  const f=await structuredLedgerFixture(t,{pairs:1});await structuredLedgerPublish(f);
  const selection=await prepareNativeMemorySelection(f.env,f.current);assert.ok(selection);
  const interval=structuredR6PairInterval(f.rows[0]),before=structuredR6Footprint(f);let getters=0,iterators=0;
  const oversized=new Array(33).fill(interval);Object.defineProperty(oversized,"0",{get(){getters++;throw new Error("oversized index must not be read");}});
  const accessor=[];Object.defineProperty(accessor,"0",{get(){getters++;return interval;},configurable:true});
  const fieldAccessor={throughSequence:interval.throughSequence};Object.defineProperty(fieldAccessor,"afterSequence",{get(){getters++;return interval.afterSequence;},enumerable:true});
  for(const inventory of [[],oversized,new Array(1),accessor,[fieldAccessor]]){
    Object.defineProperty(inventory,Symbol.iterator,{get(){iterators++;throw new Error("caller iterator must not be read");}});
    f.trace.length=0;assert.equal(await discoverNativeStructuredConversationOriginals(f.env,f.current,selection,inventory),null);
    assert.equal(f.trace.length,0,"invalid saved descriptors fail before any native read");assert.equal(getters,0);assert.equal(iterators,0);
  }
  for(const change of [value=>value.push({...interval}),value=>{value[0].throughSequence++;},value=>{
    Object.defineProperty(value,"0",{get(){getters++;return interval;},configurable:true});}]){
    const inventory=[{...interval}],expected=nativeMemorySelectionStatements(f.env,selection);assert.ok(expected?.length);let fired=0;
    f.trace.length=0;f.hooks.afterBatch=(statements)=>{
      assert.equal(++fired,1);assert.deepEqual(statements.map(statement=>statement.sql),expected.map(statement=>statement.sql));change(inventory);
    };
    try{assert.equal(await discoverNativeStructuredConversationOriginals(f.env,f.current,selection,inventory),null);}
    finally{f.hooks.afterBatch=null;}
    assert.equal(fired,1);assert.equal(f.trace.length,expected.length,
      "only the original selection replay ran; no history discovery or source capture follows changed caller intervals");
    assert.equal(getters,0);assert.equal(iterators,0);
  }
  const frozen=Object.freeze([Object.freeze({...interval})]),good=await discoverNativeStructuredConversationOriginals(f.env,f.current,selection,frozen);assert.ok(good);
  const wrapper=await prepareNativeStructuredConversationContext(f.env,good.enrollment,f.current,good.captures);assert.ok(wrapper);
  assert.deepEqual(wrapper.context.dependencies.retainedOriginals,f.refs);assert.deepEqual(structuredR6Footprint(f),before);
});

// R6 final native privacy composition regressions. TEMP triggers deliberately
// leave the exact main-schema certificates intact; no alternate proof is used.
test("structured native final privacy proof: cursor and retirement triggers cannot remutate an origin behind unchanged pending counts",async t=>{
  const store=await import("../worker/memory-live-store.ts"),origin=await import("../worker/memory-native-origin.ts");
  for(const boundary of ["cursor","retirement"]){
    const f=await structuredR6OriginFixture(t),published=await structuredR6PublishOrigin(f,"r6-final-trigger-"+boundary);
    const ledgerId=structuredLedgerHead(f).ledger_id,restoredText="R6_CURSOR_RESTORED_PRIVATE_ANSWER";
    const changedExpiry=new Date(Date.parse(published.answer.answerExpiresAt)-1).toISOString();
    assert.ok(published.answer.createdAt<changedExpiry);assert.notEqual(changedExpiry,published.answer.answerExpiresAt);
    if(boundary==="cursor"){
      const inverse=await origin.prepareNativeStructuredOriginWithdrawal(f.env,{originId:published.answer.originId},"erased",new Date().toISOString());assert.ok(inverse);
      const results=await f.DB.batch(inverse.statements.map(query=>f.DB.prepare(query.sql).bind(...query.bindings)));assert.equal(inverse.acknowledge(results),true);
    }
    const scrub=Object.keys(published.publication.header).filter(key=>!structuredR6MinimizedFields.includes(key)).map(key=>key+"=NULL").join(",");
    // Do not bypass immutable-origin triggers: private-body mutation is allowed,
    // and the schema permits full withdrawal-to-minimization after deleting the
    // dependency graph. The latter still leaves forbidden derived body residue.
    const remutation=boundary==="cursor"?`UPDATE private_content SET content='${restoredText}',redacted_at=NULL,expires_at='${changedExpiry}'
      WHERE content_id='${published.answer.answerContentId}';`
      :`DELETE FROM memory_structured_answer_originals WHERE origin_id='${published.answer.originId}';
        DELETE FROM memory_structured_answer_ledger_revisions WHERE origin_id='${published.answer.originId}';
        UPDATE memory_structured_answer_origins SET status='minimized',${scrub} WHERE origin_id='${published.answer.originId}';`;
    const trigger="r6_"+boundary+"_origin_remutation";
    f.sqlite.exec(`CREATE TEMP TRIGGER ${trigger} AFTER UPDATE OF ${boundary==="cursor"?"cleanup_turn":"state"}
      ON main.memory_structured_conversation_heads WHEN NEW.ledger_id='${ledgerId}'${boundary==="retirement"?" AND OLD.state='active' AND NEW.state='retiring'":""}
      BEGIN ${remutation} END`);
    assert.ok(f.sqlite.prepare("SELECT 1 FROM temp.sqlite_schema WHERE type='trigger' AND name=?").get(trigger));
    assert.equal(f.sqlite.prepare("SELECT 1 FROM main.sqlite_schema WHERE type='trigger' AND name=?").get(trigger),undefined);
    // A future supplied lifecycle cutoff makes the intact genuine records
    // eligible without altering their timestamps or pretending a host-clock race.
    const now=boundary==="cursor"?new Date(Date.parse(f.expiry)+1).toISOString():new Date().toISOString();
    const ledger=boundary==="cursor"?await store.prepareStructuredConversationRetentionStep(f.env,{now}):null;
    const originStep=boundary==="cursor"?await origin.prepareNativeStructuredOriginRetentionStep(f.env,{now}):null;
    const withdrawal=boundary==="retirement"?await store.prepareStructuredConversationWithdrawal(f.env,{actorUserId:f.actorId,personalOnly:true},now):null;
    if(boundary==="cursor"){assert.ok(ledger);assert.ok(originStep);assert.equal(originStep.workUnits,1);}
    else{assert.ok(withdrawal);assert.equal(withdrawal.pendingOrigins,1);}
    const before=structuredR6OriginFootprint(f);let observed=null,fired=0;
    f.hooks.afterStatement=(statement,kind)=>{
      if(kind!=="run"||!statement.sql.startsWith(boundary==="cursor"?"UPDATE memory_structured_conversation_heads SET cleanup_turn=0,updated_at="
        :"UPDATE memory_structured_conversation_heads SET enrollment_id=NULL"))return;
      fired++;const header=f.sqlite.prepare("SELECT status,answer_sha256 FROM memory_structured_answer_origins WHERE origin_id=?").get(published.answer.originId);
      const body=f.sqlite.prepare("SELECT content,redacted_at,expires_at FROM private_content WHERE content_id=?").get(published.answer.answerContentId);
      const pending=f.sqlite.prepare(`SELECT COUNT(*) AS n FROM memory_structured_answer_origins origin WHERE actor_user_id=? AND organization_id IS NULL AND (
        EXISTS(SELECT 1 FROM private_content body WHERE body.content_id IN(origin.answer_content_id,origin.manifest_content_ref)
          AND (body.content<>'' OR body.redacted_at IS NULL))
        OR EXISTS(SELECT 1 FROM memory_structured_answer_originals dependency WHERE dependency.origin_id=origin.origin_id)
        OR EXISTS(SELECT 1 FROM memory_structured_answer_ledger_revisions dependency WHERE dependency.origin_id=origin.origin_id))`).get(f.actorId).n;
      observed={header:{...header},body:{...body},pending,
        originals:f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_answer_originals WHERE origin_id=?").get(published.answer.originId).n,
        revisions:f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_answer_ledger_revisions WHERE origin_id=?").get(published.answer.originId).n};
    };
    try{
      if(boundary==="cursor")await assert.rejects(()=>ledger.commitOrigin(originStep),/memory-structured-cleanup-unconfirmed/u);
      else await assert.rejects(()=>f.DB.batch(withdrawal.statements));
    }finally{f.hooks.afterStatement=null;}
    assert.equal(fired,1);assert.ok(observed);assert.equal(observed.pending,1);
    if(boundary==="cursor"){
      assert.equal(observed.header.status,"withdrawn");assert.equal(observed.body.content,restoredText);assert.equal(observed.body.redacted_at,null);
      assert.equal(observed.body.expires_at,changedExpiry);assert.equal(observed.originals,2);assert.equal(observed.revisions,1);
    }else{
      assert.equal(observed.header.status,"minimized");assert.equal(observed.header.answer_sha256,null);
      assert.equal(observed.body.content,published.answer.answer);assert.equal(observed.originals,0);assert.equal(observed.revisions,0);
    }
    assert.deepEqual(structuredR6OriginFootprint(f),before,"the actual trigger ran, but the complete native transaction restores cursor, header, bodies and dependencies");
    f.sqlite.exec("DROP TRIGGER temp."+trigger);
    if(boundary==="cursor"){
      const freshLedger=await store.prepareStructuredConversationRetentionStep(f.env,{now});
      const freshOrigin=await origin.prepareNativeStructuredOriginRetentionStep(f.env,{now});assert.ok(freshLedger);assert.ok(freshOrigin);
      assert.equal(await freshLedger.commitOrigin(freshOrigin),1,"the same eligible operation succeeds with a fresh genuine plan after removing the remutation");
      const cleared=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(published.answer.answerContentId);
      assert.equal(cleared.content,"");assert.ok(cleared.redacted_at);
    }else{
      const fresh=await store.prepareStructuredConversationWithdrawal(f.env,{actorUserId:f.actorId,personalOnly:true},now);
      const results=await f.DB.batch(fresh.statements);assert.equal(fresh.acknowledge(results),true);
    }
    assert.equal(f.sqlite.prepare("SELECT status FROM memory_structured_answer_origins WHERE origin_id=?").get(published.answer.originId).status,"withdrawn");
  }
});

test("structured native direct inverse: empty or zero terminal acknowledgements are unknown after actual committed withdrawal",async t=>{
  const {liveMemoryOriginWithdrawalStatements,memoryAtomic}=await import("../worker/memory-live-store.ts");
  for(const terminalRows of [[],[{verified:0}]]){
    const f=await structuredR6OriginFixture(t),published=await structuredR6PublishOrigin(f,"r6-direct-terminal-"+terminalRows.length);
    const writes=await liveMemoryOriginWithdrawalStatements(f.env,{contentId:f.refs[0].contentRef},"erased",new Date().toISOString());assert.ok(writes.length);
    let commits=0,originalTerminal=null,persistedStatus=null;
    f.hooks.afterBatch=(statements,results)=>{
      commits++;originalTerminal=copy(results.at(-1));
      persistedStatus=f.sqlite.prepare("SELECT status FROM memory_structured_answer_origins WHERE origin_id=?").get(published.answer.originId).status;
      results.at(-1).results=copy(terminalRows);
    };
    try{await assert.rejects(()=>memoryAtomic(f.env,[],writes,[]),/memory-write-unconfirmed/u);}
    finally{f.hooks.afterBatch=null;}
    assert.equal(commits,1);assert.equal(originalTerminal.success,true);assert.deepEqual(originalTerminal.results,[{verified:1}]);
    assert.equal(persistedStatus,"withdrawn");assert.equal(f.sqlite.prepare("SELECT status FROM memory_structured_answer_origins WHERE origin_id=?").get(published.answer.originId).status,"withdrawn");
    assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(published.answer.answerContentId).content,published.answer.answer);
    assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(published.answer.manifestContentRef).content,published.publication.manifest.text);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_answer_originals WHERE origin_id=?").get(published.answer.originId).n,2);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_answer_ledger_revisions WHERE origin_id=?").get(published.answer.originId).n,1);
    // The database committed; rejecting a damaged receipt is not a rollback or
    // a physical-erasure acknowledgement, and this inverse is not retried here.
  }
});

test("structured native direct inverse: caller selector drift during actual v1 capture cannot retarget later v2 preparation",async t=>{
  const {prepareNativeMemoryOriginWithdrawal}=await import("../worker/memory-native-origin.ts");
  const {liveMemoryOriginWithdrawalStatements,memoryAtomic}=await import("../worker/memory-live-store.ts");
  const f=await structuredR6OriginFixture(t);legacyOriginalNativeSchema(f);
  const published=await structuredR6PublishOrigin(f,"r6-selector-drift"),selector={contentId:f.refs[0].contentRef},now=new Date().toISOString();
  const legacy=prepareNativeMemoryOriginWithdrawal(selector,"erased",now);assert.ok(legacy);
  const before=structuredR6OriginFootprint(f);let fired=0,capturedRows=null;const readsAfter=[];
  f.trace.length=0;f.hooks.beforeStatement=(statement)=>{if(fired)readsAfter.push(statement.sql);};
  f.hooks.afterStatement=(statement,kind,result)=>{
    if(kind!=="all"||statement.sql!==legacy.targets.sql)return;
    fired++;capturedRows=result.results.length;selector.contentId="r6-unrelated-replacement-content";
  };
  try{await assert.rejects(()=>liveMemoryOriginWithdrawalStatements(f.env,selector,"erased",now),/memory-origin-withdrawal-preparation-changed/u);}
  finally{f.hooks.beforeStatement=null;f.hooks.afterStatement=null;}
  assert.equal(fired,1);assert.equal(capturedRows,0,"the real compatible v1 inventory is empty; the separate v2 origin is genuinely populated");
  assert.deepEqual(readsAfter,[],"selector drift is denied before the next v2 schema/capture read");
  assert.ok(f.trace.every(row=>row.kind!=="run"));assert.deepEqual(structuredR6OriginFootprint(f),before);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_native_answer_origins").get().n,0);
  const stable=await liveMemoryOriginWithdrawalStatements(f.env,{contentId:f.refs[0].contentRef},"erased",now);
  const results=await memoryAtomic(f.env,[],stable,[]);assert.equal(results.length,stable.length);
  assert.equal(f.sqlite.prepare("SELECT status FROM memory_structured_answer_origins WHERE origin_id=?").get(published.answer.originId).status,"withdrawn",
    "an unchanged selector's genuine direct inverse still reaches the populated v2 consumer");
});

// R6 runtime preparation/acknowledgement regressions. These reuse genuine
// existing native classes and the production shared allowance; no scheduler,
// replacement cleanup implementation or assumed full-drain row count is added.
test("structured native retention runtime: one unavailable preparation class does not hide confirmed progress by the other class",async t=>{
  const {sweepExpiredPrivateContent}=await import("../worker/runtime.ts");
  for(const failedClass of ["ledger","origin"]){
    const f=await structuredR6OriginFixture(t),published=await structuredR6PublishOrigin(f,"r6-preparation-"+failedClass);
    if(failedClass==="ledger")f.sqlite.prepare("DELETE FROM memory_live_enrollments WHERE enrollment_id=?").run(f.enrollment.enrollment_id);
    else await structuredLedgerExpireRetained(f);
    const before=structuredR6OriginFootprint(f),ledgerBefore={...structuredLedgerHead(f)};
    const sentinel=new Error("isolated-"+failedClass+"-preparation-failure"),mutations=[];let faults=0;
    const prefix=failedClass==="ledger"?"WITH candidates AS(SELECT head.ledger_id"
      :"WITH lifecycle_clock(now) AS(SELECT ?),pending AS(SELECT origin.origin_id";
    f.hooks.beforeStatement=statement=>{
      if(!faults&&statement.sql.startsWith(prefix)){faults++;throw sentinel;}
    };
    f.hooks.afterBatch=(statements,results)=>{
      if(statements.some(statement=>/^\s*(?:INSERT|UPDATE|DELETE)\b/u.test(statement.sql)))
        mutations.push({statements:statements.map(statement=>statement.sql),results:copy(results)});
    };
    try{await assert.rejects(()=>sweepExpiredPrivateContent(f.env,1),error=>error===sentinel);}
    finally{f.hooks.beforeStatement=null;f.hooks.afterBatch=null;}
    assert.equal(faults,1,"one exact preparation read fails, rather than a forged candidate result");
    assert.equal(mutations.length,1,"the other class commits exactly one bounded native unit before the original failure is surfaced");
    assert.equal(mutations[0].results.length,mutations[0].statements.length);
    assert.ok(mutations[0].results.every(result=>result.success===true&&result.error===undefined&&Array.isArray(result.results)));
    assert.equal(mutations[0].results.reduce((sum,result)=>sum+result.meta.changes,0),1,"only one native mark or fence row changes");
    const after=structuredR6OriginFootprint(f),header=f.sqlite.prepare("SELECT * FROM memory_structured_answer_origins WHERE origin_id=?").get(published.answer.originId);
    if(failedClass==="ledger"){
      assert.equal(header.status,"withdrawn");assert.equal(header.withdrawal_reason,"source-unavailable");assert.ok(header.withdrawn_at);
      assert.deepEqual({...structuredLedgerHead(f)},ledgerBefore,"the unavailable ledger class is not silently executed");
    }else{
      const head=structuredLedgerHead(f);assert.equal(head.state,"retiring");assert.ok(head.first_terminal_at);assert.equal(head.enrollment_id,null);
      assert.equal(head.current_body_ref,null);assert.equal(header.status,"active","a ledger fence does not fabricate an origin-class commit");
    }
    for(const table of ["private_content","project_resource_scopes","private_content_retention_scopes","events","event_private_payloads",
      "memory_structured_conversation_revisions","memory_structured_answer_originals","memory_structured_answer_ledger_revisions"])
      assert.deepEqual(after[table],before[table],table+" evidence remains intact after the single logical unit");
  }
});

test("structured native retention runtime: a lost acknowledgement after a real other-class commit stops the remaining allowance",async t=>{
  const {sweepExpiredPrivateContent}=await import("../worker/runtime.ts");
  const f=await structuredR6OriginFixture(t),published=await structuredR6PublishOrigin(f,"r6-retention-lost-ack");
  f.sqlite.prepare("DELETE FROM memory_live_enrollments WHERE enrollment_id=?").run(f.enrollment.enrollment_id);
  const before=structuredR6OriginFootprint(f),sentinel=new Error("isolated-ledger-preparation-before-unknown-origin");
  let faults=0,mutatingBatches=0,damaged=0,completeBeforeDamage=false,committedStatus=null;
  f.hooks.beforeStatement=statement=>{
    if(!faults&&statement.sql.startsWith("WITH candidates AS(SELECT head.ledger_id")){faults++;throw sentinel;}
  };
  f.hooks.afterBatch=(statements,results)=>{
    if(statements.some(statement=>/^\s*(?:INSERT|UPDATE|DELETE)\b/u.test(statement.sql)))mutatingBatches++;
    if(damaged||!statements.some(statement=>statement.sql.startsWith("UPDATE memory_structured_answer_origins SET status='withdrawn'")))return;
    damaged++;completeBeforeDamage=results.length===statements.length&&results.every(result=>result.success===true&&result.error===undefined);
    committedStatus=f.sqlite.prepare("SELECT status FROM memory_structured_answer_origins WHERE origin_id=?").get(published.answer.originId).status;
    results.pop(); // Only the returned acknowledgement is lost after native COMMIT.
  };
  let failure;
  try{await sweepExpiredPrivateContent(f.env,10);}catch(error){failure=error;}
  finally{f.hooks.beforeStatement=null;f.hooks.afterBatch=null;}
  assert.ok(failure);assert.notEqual(failure,sentinel);assert.equal(failure.message,"retention-cleanup-unconfirmed");
  assert.equal(faults,1);assert.equal(damaged,1);assert.equal(completeBeforeDamage,true);assert.equal(committedStatus,"withdrawn");
  assert.equal(mutatingBatches,1,"an unknown committed unit stops immediately instead of spending or reusing the remaining nine units");
  const after=structuredR6OriginFootprint(f);
  for(const table of ["private_content","project_resource_scopes","private_content_retention_scopes","memory_structured_conversation_heads",
    "memory_structured_conversation_revisions","memory_structured_answer_originals","memory_structured_answer_ledger_revisions"])
    assert.deepEqual(after[table],before[table],table+" remains untouched beyond the committed logical mark");
  const header=f.sqlite.prepare("SELECT * FROM memory_structured_answer_origins WHERE origin_id=?").get(published.answer.originId);
  assert.equal(header.status,"withdrawn");assert.equal(header.withdrawal_reason,"source-unavailable");
  assert.equal(after.memory_structured_answer_originals.length,2);assert.equal(after.memory_structured_answer_ledger_revisions.length,1);
  // A separate invocation may observe the persisted mark. Its single allowance
  // buys only the next answer-body unit, never an implicit replay of the lost unit.
  assert.equal(await sweepExpiredPrivateContent(f.env,1),1);
  const answer=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(published.answer.answerContentId);
  assert.equal(answer.content,"");assert.ok(answer.redacted_at);
  assert.equal(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(published.answer.manifestContentRef).content,published.publication.manifest.text);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_answer_originals WHERE origin_id=?").get(published.answer.originId).n,2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM memory_structured_answer_ledger_revisions WHERE origin_id=?").get(published.answer.originId).n,1);
  assert.equal(f.sqlite.prepare("SELECT withdrawn_at FROM memory_structured_answer_origins WHERE origin_id=?").get(published.answer.originId).withdrawn_at,header.withdrawn_at);
});

test("structured native project sync: minimized origins cannot regain derived custody through rebuild fast paths or mutation races",async t=>{
  const {synchronizeProjectScope}=await import("../worker/project-access.ts"),{loadPrivateContent}=await import("../worker/pilot-policy.ts");
  for(const boundary of ["clean","answer-body","manifest-body","answer-resource","manifest-resource","answer-retention","manifest-retention","late-state","late-write"]){
    const f=await structuredR6OriginFixture(t,{mode:"shared-owner"}),published=await structuredR6PublishOrigin(f,"r6-minimized-sync-"+boundary);
    const scope={organizationId:f.organizationId,projectAccessId:f.projectAccessId,projectId:f.projectId,ownerUserId:f.ownerId};
    const columns={body:["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"],
      resource:["project_access_id","resource_kind","resource_id","organization_id","project_id","owner_user_id","visibility","source_event_id","actor_user_id","created_at"],
      retention:["content_id","organization_id","project_access_id","project_id","actor_user_id","classification","policy_version","assigned_expires_at","created_at"]};
    const saved=(kind,index)=>Object.fromEntries(columns[kind].map((column,position)=>[column,
      (kind==="body"?published.own.contents:kind==="resource"?published.own.resources:published.own.retentions)[index][position]]));
    const authored={...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(published.answer.userContentId)};
    const forgotten=await structuredR6Forget(f);assert.equal(forgotten.status,200);assert.equal((await forgotten.json()).physicalCleanupPending,true);
    assert.equal(await structuredR6DrainOrigins(f),8);structuredR6AssertOriginCleared(f,published);
    const canonical=structuredR6OriginFootprint(f);f.trace.length=0;
    await synchronizeProjectScope(f.env,scope);
    assert.ok(f.trace.some(statement=>statement.sql.includes("AS origin_integrity,migration.status")));
    assert.equal(f.trace.some(statement=>/^\s*(?:INSERT|UPDATE|DELETE)\b/u.test(statement.sql)),false,"current minimized-state fast path does not rebuild custody");
    assert.deepEqual(structuredR6OriginFootprint(f),canonical);
    if(boundary==="clean"||boundary==="late-write"){
      // Remove only the user's surviving permission row so a real rebuild has
      // useful ordinary work. Historical derived event references also remain.
      f.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").run(published.answer.userContentId);
      f.sqlite.prepare("UPDATE project_migration_states SET last_owner_sequence=0 WHERE project_access_id=?").run(f.projectAccessId);
    }
    if(boundary==="clean"){
      f.trace.length=0;await synchronizeProjectScope(f.env,scope);
      assert.ok(f.trace.some(statement=>statement.sql.startsWith("INSERT INTO project_migration_states")&&statement.sql.includes("ON CONFLICT(project_access_id)")));
      structuredR6AssertOriginCleared(f,published);
      assert.deepEqual({...f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(published.answer.userContentId)},authored);
      const permission=f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(published.answer.userContentId);
      assert.ok(permission);assert.equal(permission.project_access_id,f.projectAccessId);assert.equal(permission.organization_id,f.organizationId);
      assert.equal(permission.project_id,f.projectId);assert.equal(permission.owner_user_id,f.ownerId);assert.equal(permission.actor_user_id,f.actorId);
      assert.equal(permission.visibility,"actor_private");assert.equal(permission.source_event_id,published.answer.userEventId);
      const ordinary=await loadPrivateContent(f.env,f.actorId,"chat",f.current.binding.scope);
      assert.equal(ordinary[f.rows[0].user.id],f.rows[0].user.text,"unrelated original chat remains ordinarily readable");
      for(const ref of [published.answer.userContentId,published.answer.answerContentId,published.answer.manifestContentRef])
        assert.equal(Object.hasOwn(ordinary,ref),false,"preserved user bytes do not bypass the registered-origin availability boundary");
      continue;
    }
    if(!boundary.startsWith("late-")){
      const [which,kind]=boundary.split("-"),index=which==="answer"?1:2;
      f.insert(kind==="body"?"private_content":kind==="resource"?"project_resource_scopes":"private_content_retention_scopes",saved(kind,index));
      const before=structuredR6OriginFootprint(f);f.trace.length=0;
      await assert.rejects(()=>synchronizeProjectScope(f.env,scope));
      assert.equal(f.trace.some(statement=>statement.sql.includes("AS origin_integrity,migration.status")),false,"existing residue is rejected by preflight before even the fast-path decision");
      assert.equal(f.trace.some(statement=>/^\s*(?:INSERT|UPDATE|DELETE)\b/u.test(statement.sql)),false);
      assert.deepEqual(structuredR6OriginFootprint(f),before,"unavailable recreated rows are neither silently adopted nor guessed away");
      continue;
    }
    const before=structuredR6OriginFootprint(f);let fired=0,insideTransaction=false,changed=null;
    f.trace.length=0;
    f.hooks.afterStatement=(statement,kind,result)=>{
      const selected=boundary==="late-state"?kind==="all"&&statement.sql.includes("memory_structured_schema_changed")&&statement.sql.endsWith("END AS verified")
        :kind==="run"&&/^\s*(?:INSERT|UPDATE|DELETE)\b/u.test(statement.sql)&&result.meta.changes>0;
      if(fired||!selected)return;fired++;insideTransaction=f.trace.at(-1)?.inBatch===true;
      f.insert("private_content",saved("body",2));changed=structuredR6OriginFootprint(f);
    };
    try{await assert.rejects(()=>synchronizeProjectScope(f.env,scope));}
    finally{f.hooks.afterStatement=null;}
    assert.equal(fired,1);assert.ok(changed);
    if(boundary==="late-state"){
      assert.equal(insideTransaction,false);
      assert.ok(f.trace.some(statement=>statement.sql.includes("AS origin_integrity,migration.status")),"state reads recheck minimized integrity after the successful preflight await");
      assert.deepEqual(structuredR6OriginFootprint(f),changed,"a concurrent pre-snapshot insertion is not falsely claimed rolled back");
    }else{
      assert.equal(insideTransaction,true,"the race is injected synchronously after a real mutation inside its existing native transaction");
      assert.deepEqual(structuredR6OriginFootprint(f),before,"the final existing chunk guard rolls back both staged ordinary custody and injected derived residue");
      assert.equal(f.sqlite.prepare("SELECT 1 FROM private_content WHERE content_id=?").get(published.answer.manifestContentRef),undefined);
      assert.equal(f.sqlite.prepare("SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").get(published.answer.userContentId),undefined);
    }
  }
});
