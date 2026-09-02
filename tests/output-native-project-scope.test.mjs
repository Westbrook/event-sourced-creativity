import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
const [runtime, projectAccess, ledger, policy, publication] = await Promise.all([
  import("../worker/runtime.ts"),
  import("../worker/project-access.ts"),
  import("../worker/output-requirements-ledger.ts"),
  import("../worker/pilot-policy.ts"),
  import("../worker/output-native-project-publication.ts"),
]).finally(() => imports.deregister());
const { ensureSchema, eventWriteBindings, EVENT_WRITE_COLUMNS, makeEvent, serializeEvent } = runtime;
const { synchronizeProjectScope, prepareProjectSourceEventsStatement, projectSourceProjectionCurrentAssertion } = projectAccess;
const { ensureOutputRequirementsSchema, outputAssertionStatements } = ledger;
const { prepareOutputNativeProjectPublicationStatements } = publication;

const originalFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw new Error("Native scope tests cannot use a network or provider"); }; });
test.after(() => { globalThis.fetch = originalFetch; });

/** Production schema and triggers; the adapter changes only D1 transport. */
async function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const transport = { d1: 0, queries: [] };
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { assert.ok(values.length <= 100); return new Statement(this.sql, values); }
    execute(kind) {
      transport.queries.push(this.sql);
      const statement = sqlite.prepare(this.sql);
      if (kind === "first") return statement.get(...this.values) ?? null;
      if (kind === "all") return { success: true, results: statement.all(...this.values), meta: { changes: 0 } };
      return { success: true, results: [], meta: { changes: Number(statement.run(...this.values).changes) } };
    }
    async first() { transport.d1++; return this.execute("first"); }
    async all() { transport.d1++; return this.execute("all"); }
    async run() { transport.d1++; return this.execute("run"); }
  }
  const env = { DB: {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      transport.d1++;
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement.execute(/^\s*(?:SELECT|WITH)/u.test(statement.sql) ? "all" : "run"));
        sqlite.exec("COMMIT"); return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } };
  await ensureSchema(env); await ensureOutputRequirementsSchema(env);
  const now = new Date().toISOString();
  const scope = { organizationId: "organization", projectAccessId: "project-access", projectId: "project", ownerUserId: "owner" };
  const insert = (table, row) => sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  insert("organizations", { organization_id: scope.organizationId, name: "Scope test", owner_user_id: "owner", status: "active", created_at: now, updated_at: now });
  for (const user of ["owner", "editor"]) {
    insert("users", { user_id: user, email: `${user}@example.test`, display_name: user, role: "creator", consent_version: policy.POLICY_VERSION, consented_at: now, created_at: now, updated_at: now });
    insert("organization_memberships", { membership_id: `organization-${user}`, organization_id: scope.organizationId, user_id: user, role: "member", status: "active", invited_by_user_id: "owner", accepted_at: now, created_at: now, updated_at: now });
  }
  insert("organization_projects", { project_access_id: scope.projectAccessId, organization_id: scope.organizationId, project_id: scope.projectId, owner_user_id: "owner", status: "active", created_at: now, updated_at: now });
  insert("project_migration_states", { project_access_id: scope.projectAccessId, organization_id: scope.organizationId, owner_user_id: "owner", status: "active", last_owner_sequence: 0, updated_at: now });
  const append = (type, payload, actor = "user:owner", correlation = "fixture") => {
    const head = Number(sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id='creative:owner'").get().head);
    const event = makeEvent("creative:owner", head + 1, actor, "fixture", correlation, type, payload);
    sqlite.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${eventWriteBindings(event).map(() => "?").join(",")})`).run(...eventWriteBindings(event));
    return event;
  };
  append("ProjectCreated", { project_id: scope.projectId, name: "Scoped project" });
  append("DocumentCreated", { project_id: scope.projectId, document_id: "document", title: "Private document wording" });
  await synchronizeProjectScope(env, scope);
  const guard = () => outputAssertionStatements(env, projectSourceProjectionCurrentAssertion(scope));
  const read = async () => {
    const results = await env.DB.batch([...guard(), prepareProjectSourceEventsStatement(env, scope)]);
    return results.at(-1).results.map(serializeEvent);
  };
  const reset = () => { transport.d1 = 0; transport.queries.length = 0; };
  reset();
  return { sqlite, env, scope, insert, append, guard, read, reset, transport, now };
}

test("an already current project manifest uses one exact-scoped read and performs no writes", async () => {
  const state = await fixture();
  assert.deepEqual(await synchronizeProjectScope(state.env, state.scope), { eventCount: 2, documentCount: 1 });
  assert.equal(state.transport.d1, 1);
  assert.equal(state.transport.queries.length, 1);
  assert.match(state.transport.queries[0], /^SELECT/u);
  assert.equal(state.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states").get().last_owner_sequence, 2);
});

test("a stale project still takes the existing complete rebuild before the single-read fast path", async () => {
  const state = await fixture();
  const compiled = state.append("ContextCompiled", { project_id: "project", document_id: "document", compiled_snapshot: { document: { id: "document" } } }, "worker:compiler");
  assert.deepEqual(await synchronizeProjectScope(state.env, state.scope), { eventCount: 3, documentCount: 1 });
  assert.ok(state.transport.d1 > 1);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_event_scopes WHERE event_id=?").get(compiled.eventId).n, 1);
  state.reset();
  await synchronizeProjectScope(state.env, state.scope);
  assert.equal(state.transport.d1, 1);
});

test("a matching cursor without its exact manifest marker cannot bypass the existing rebuild", async () => {
  const state = await fixture();
  state.sqlite.exec("DELETE FROM project_resource_scopes WHERE resource_kind='manifest_version'");
  await synchronizeProjectScope(state.env, state.scope);
  assert.ok(state.transport.d1 > 1);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind='manifest_version'").get().n, 1);
});

test("fast-path document counts do not include another owner or organization under a mismatched custody row", async () => {
  const state = await fixture();
  for (const [id, organization, owner] of [["other-organization-document", "other-organization", "owner"], ["other-owner-document", "organization", "other-owner"]]) {
    state.insert("project_resource_scopes", { project_access_id: "project-access", resource_kind: "document", resource_id: id, organization_id: organization, project_id: "project", owner_user_id: owner, actor_user_id: owner, visibility: "collaborative_output", created_at: state.now });
  }
  assert.deepEqual(await synchronizeProjectScope(state.env, state.scope), { eventCount: 2, documentCount: 1 });
  assert.equal(state.transport.d1, 1);
});

test("the shared prepared SELECT preserves exact source hydration without synchronizing or writing a migration", async () => {
  const state = await fixture();
  const events = await state.read();
  assert.equal(events.length, 2);
  assert.equal(events[1].payload.title, "Private document wording");
  assert.equal(state.transport.d1, 1);
  assert.equal(state.transport.queries.some((sql) => /(?:UPDATE|INSERT INTO) project_migration_states/u.test(sql)), false);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM output_atomic_assertions").get().n, 0);
});

test("project media custody includes model originals, saved views and every generated model file", async () => {
  const state = await fixture();
  try {
    const url = key => "/api/media/" + encodeURIComponent(key);
    const original = "owner/models/original.glb", view = "owner/models/front.png", mesh = "owner/generated/model.glb", alternate = "owner/generated/model.obj", texture = "owner/generated/albedo.png", preview = "owner/generated/preview.webp";
    state.append("ReferenceIngested", { reference_id: "original-reference", source_ref: url(original), content_hash: "a".repeat(64), rights_class: "owned" });
    state.append("ReferenceIngested", { reference_id: "view-reference", source_ref: url(view), content_hash: "b".repeat(64), rights_class: "owned" });
    const created = state.append("BlockCreated", { project_id: "project", document_id: "document", block_id: "model-block", type: "model3d", properties: {
      model_reference_id: "original-reference", reference_id: "view-reference", model_url: url(original), model_mime_type: "model/gltf-binary", media_url: url(view), media_type: "image/png",
    } });
    const completed = state.append("DocumentRenderCompleted", { project_id: "project", document_id: "document", artifact_id: "model-output", artifact_kind: "model3d", title: "Vessel", media_url: url(mesh), media_type: "model/gltf-binary", items: [], settings: { model3d_files: [
      { url: url(mesh), mimeType: "model/gltf-binary", role: "mesh" }, { url: url(alternate), mimeType: "model/obj", role: "mesh" },
      { url: url(texture), mimeType: "image/png", role: "texture" }, { url: url(preview), mimeType: "image/webp", role: "preview" },
    ] } }, "worker:renderer");
    await synchronizeProjectScope(state.env, state.scope);
    const media = state.sqlite.prepare("SELECT resource_id,source_event_id FROM project_resource_scopes WHERE resource_kind='media'").all();
    assert.deepEqual(media.map(row => row.resource_id).sort(), [original, view, mesh, alternate, texture, preview].sort());
    for (const row of media) assert.equal(row.source_event_id, [original, view].includes(row.resource_id) ? created.eventId : completed.eventId);
    assert.deepEqual(state.sqlite.prepare("SELECT resource_id FROM project_resource_scopes WHERE resource_kind='reference' ORDER BY resource_id").all().map(row => row.resource_id), ["original-reference", "view-reference"]);
    const context = { ...state.scope, principalUserId: "owner", permissions: ["project.read"], role: "owner" };
    const page = await projectAccess.readProjectEventPage(state.env, context, 0, 5000, false);
    assert.equal(page.events.find(event => event.eventId === created.eventId).payload.properties.model_url, url(original));
    assert.deepEqual(page.events.find(event => event.eventId === completed.eventId).payload.settings.model3d_files.map(file => file.url), [mesh, alternate, texture, preview].map(url));
    state.append("BlockPropertyEdited", { project_id: "project", document_id: "document", block_id: "model-block", property_path: "model_url", old_value: url(original), new_value: null });
    await synchronizeProjectScope(state.env, state.scope);
    const removed = await projectAccess.readProjectEventPage(state.env, context, 0, 5000, false);
    assert.equal(removed.events.find(event => event.eventId === created.eventId).payload.properties.model_url, undefined, "former mesh URL is removed from shared event payloads");
    assert.equal(JSON.stringify(removed.events).includes(url(original)), false, "a property-edit old value cannot disclose the detached mesh");
  } finally { state.sqlite.close(); }
});

test("read-only Output source proof refuses a stale or quarantined project and never reactivates it", async () => {
  for (const mutation of ["UPDATE project_migration_states SET last_owner_sequence=0", "UPDATE project_migration_states SET status='disabled'", "DELETE FROM project_resource_scopes WHERE resource_kind='manifest_version'"]) {
    const state = await fixture(); state.sqlite.exec(mutation);
    await assert.rejects(state.read, /CHECK constraint/u);
    assert.equal(state.transport.queries.some((sql) => /(?:UPDATE|INSERT INTO) project_migration_states/u.test(sql)), false);
    if (mutation.includes("disabled")) assert.equal(state.sqlite.prepare("SELECT status FROM project_migration_states").get().status, "disabled");
  }
});

test("a quarantine after an authority read invalidates the final source batch and rolls back earlier writes", async () => {
  const state = await fixture();
  const proof = projectSourceProjectionCurrentAssertion(state.scope);
  assert.equal(state.sqlite.prepare(`SELECT (${proof.sql}) AS valid`).get(...proof.bindings).valid, 1);
  state.sqlite.exec("UPDATE project_migration_states SET status='disabled'");
  await assert.rejects(() => state.env.DB.batch([
    state.env.DB.prepare("UPDATE organizations SET name='must roll back'"),
    ...state.guard(), prepareProjectSourceEventsStatement(state.env, state.scope),
  ]), /CHECK constraint/u);
  assert.equal(state.sqlite.prepare("SELECT name FROM organizations").get().name, "Scope test");
  assert.equal(state.sqlite.prepare("SELECT status FROM project_migration_states").get().status, "disabled");
});

test("a different project or owner cannot reuse a current migration or manifest marker", async () => {
  const state = await fixture();
  for (const wrong of [{ organizationId: "elsewhere" }, { ownerUserId: "elsewhere" }, { projectId: "elsewhere" }, { projectAccessId: "elsewhere" }]) {
    const scope = { ...state.scope, ...wrong };
    await assert.rejects(() => state.env.DB.batch([...outputAssertionStatements(state.env, projectSourceProjectionCurrentAssertion(scope)), prepareProjectSourceEventsStatement(state.env, scope)]), /CHECK constraint/u);
  }
  assert.equal(state.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states").get().last_owner_sequence, 2);
});

async function nativeFixture(kind = "generate") {
  const state = await fixture(), { insert, sqlite, env, now } = state;
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const scope = { ...state.scope, kind: "project", key: "output-scope", actorUserId: "editor", documentId: "document", contextId: "selected-context" };
  insert("project_memberships", { membership_id: "project-editor", project_access_id: scope.projectAccessId, organization_id: scope.organizationId, project_id: scope.projectId, user_id: "editor", role: "editor", status: "active", granted_by_user_id: "owner", created_at: now, updated_at: now });
  insert("project_context_sessions", { context_id: scope.contextId, principal_user_id: "editor", organization_id: scope.organizationId, project_access_id: scope.projectAccessId, created_at: now, expires_at: future });
  const plan = state.append("OutputPlanConfirmed", { project_id: "project", document_id: "document", plan_revision_id: "plan" }, "user:editor");
  const preflight = state.append("OutputPlanPreflighted", { project_id: "project", document_id: "document", preflight_id: "preflight" }, "user:editor");
  const authorization = state.append("OutputExecutionAuthorized", { project_id: "project", document_id: "document", grant_id: "grant" }, "user:editor");
  const queued = state.append("ProjectDocumentJobQueued", { job_id: "job", document_id: "document", project_id: "project", project_access_id: "project-access", organization_id: "organization", actor_user_id: "editor", output_slot_id: "slot", output_grant_id: "grant", kind }, "user:editor");
  const hash = "a".repeat(64);
  insert("output_plan_revisions", { scope_key: scope.key, scope_kind: "project", owner_user_id: "owner", project_id: "project", document_id: "document", organization_id: "organization", project_access_id: "project-access", plan_revision_id: "plan", plan_id: "document", revision: 1, confirmed_event_id: plan.eventId, requirements_digest: hash, source_digest: hash, resolver_version: "fixture", source_head: plan.sequence, target_count: 1, created_at: now });
  insert("output_plan_targets", { scope_key: scope.key, plan_revision_id: "plan", target_id: "target", target_contract_digest: hash, media_kind: kind === "generate" ? "image" : "slides", required: 1, selected: 1, ordinal: 0 });
  insert("output_preflights", { scope_key: scope.key, preflight_id: "preflight", plan_revision_id: "plan", actor_user_id: "editor", terms_digest: hash, event_id: preflight.eventId, expires_at: future, created_at: now });
  insert("output_execution_grants", { scope_key: scope.key, grant_id: "grant", plan_revision_id: "plan", actor_user_id: "editor", payer_user_id: "editor", context_id: scope.contextId, preflight_id: "preflight", authorization_event_id: authorization.eventId, maximum_microusd: 1000, maximum_calls: 2, status: "active", expires_at: future, created_at: now });
  insert("output_operation_slots", { scope_key: scope.key, slot_id: "slot", grant_id: "grant", plan_revision_id: "plan", target_id: "target", target_contract_digest: hash, source_digest: hash, provider: "fixture", model: "fixture", route_digest: hash, job_id: "job", cost_reservation_id: "cost", token_reservation_id: "tokens", maximum_microusd: 1000, maximum_calls: 2, maximum_tokens: 1000, status: "running", created_at: now, updated_at: now });
  insert("document_jobs", { job_id: "job", owner_id: "editor", stream_id: "creative:owner", document_id: "document", kind, status: "running", source_surface: "document", correlation_id: "job-correlation", requested_sequence: queued.sequence, request_json: "{}", result_json: "{}", attempt_count: 1, requested_at: now, started_at: now, lease_expires_at: future, expires_at: future, updated_at: now });
  insert("project_resource_scopes", { project_access_id: scope.projectAccessId, resource_kind: "job", resource_id: "job", organization_id: scope.organizationId, project_id: scope.projectId, owner_user_id: "owner", actor_user_id: "editor", visibility: "actor_private", source_event_id: queued.eventId, created_at: now });
  const content = (id, owner, kind, text, visibility) => {
    insert("private_content", { content_id: id, owner_id: owner, kind, content: text, created_at: now, expires_at: future });
    if (visibility) insert("project_resource_scopes", { project_access_id: scope.projectAccessId, resource_kind: "content", resource_id: id, organization_id: scope.organizationId, project_id: scope.projectId, owner_user_id: "owner", actor_user_id: owner, visibility, created_at: now });
  };
  content("provider-output", "editor", "provider-output", "private provider output", "actor_private");
  content("prompt", "editor", "prompt", "private provider prompt", "actor_private");
  content("provider-response", "editor", "provider-response", "private response receipt", "actor_private");
  content("artifact-content", "owner", "document-artifact", JSON.stringify({ title: "Finished deck", items: [] }));
  content("artifact-input", "editor", "document-artifact-input", JSON.stringify({ document_id: "document", project_id: "project", artifact_id: "artifact", private_source: "private planning input" }), "actor_private");
  const storageKey = "owner/native-image.png";
  insert("output_native_storage_writes", { scope_key: scope.key, slot_id: "slot", storage_key: storageKey, content_sha256: hash, status: "written", write_acknowledged: 1, created_at: now, updated_at: now });
  await synchronizeProjectScope(env, scope);
  const job = sqlite.prepare("SELECT * FROM document_jobs WHERE job_id='job'").get();
  const slot = ledger.outputSlotFromRow(scope.key, sqlite.prepare("SELECT * FROM output_operation_slots WHERE slot_id='slot'").get());
  const binding = { scope, slot, job };
  const next = (type, payload = {}, actor) => makeEvent("creative:owner", 0, actor ?? (type === "ContextCompiled" ? "worker:compiler" : type === "GenerationCompleted" ? "worker:generator" : type === "DocumentRenderCompleted" || type === "DocumentRenderFailed" ? "worker:renderer" : type.endsWith("Requested") ? "user:editor" : "worker:policy"), `server:document-job:${kind}`, "job-correlation", type, payload);
  const image = () => next("GenerationCompleted", { document_id: "document", generation_id: "generation", object_id: "object", object_ids: ["object"], quality: "high", purpose: "final", output_ref: "provider-output", prompt_ref: "prompt", media_url: `/api/media/${encodeURIComponent(storageKey)}`, title: "Finished image" });
  const slides = () => next("DocumentRenderCompleted", { project_id: "project", document_id: "document", artifact_id: "artifact", artifact_kind: "slides", requested_by_user_id: "editor", title: "Finished deck", content_ref: "artifact-content", input_ref: "artifact-input", item_count: 1, items: [{ id: "slide-1", title: "First slide", media_url: null }], media_url: null });
  const assign = (events, head = Number(sqlite.prepare("SELECT MAX(sequence) AS head FROM events WHERE stream_id='creative:owner'").get().head)) => {
    events.forEach((event, index) => { event.sequence = head + index + 1; }); return events;
  };
  const stage = (event) => env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?`).bind(...eventWriteBindings(event), event.streamId, event.sequence - 1);
  const commit = (events, { beforeSidecars = [], include = () => true } = {}) => env.DB.batch([
    ...events.filter(include).map(stage), ...beforeSidecars,
    ...prepareOutputNativeProjectPublicationStatements(env, binding, events),
  ]);
  state.reset();
  return { ...state, scope, slot, job, binding, queued, image, slides, next, assign, stage, commit, content, storageKey, future };
}

test("native image publication scopes its exact actor, object and media in the event transaction without exposing private prompts", async () => {
  const state = await nativeFixture();
  const events = state.assign([state.next("ContextCompiled", { project_id: "project", document_id: "document", compiled_snapshot: { document: { id: "document" } } }), state.image(), state.next("GenerationUsageRecorded", { document_id: "document", total_tokens: 5 })]);
  const result = await state.commit(events);
  assert.equal(result.at(-1).meta.changes, 1);
  assert.equal(state.transport.d1, 1);
  const scoped = state.sqlite.prepare("SELECT event_id,actor_user_id,owner_user_id FROM project_event_scopes WHERE event_id IN(?,?,?) ORDER BY project_sequence").all(...events.map((event) => event.eventId));
  assert.deepEqual(scoped.map((row) => [row.event_id, row.actor_user_id, row.owner_user_id]), events.slice(0, 2).map((event) => [event.eventId, "editor", "owner"]));
  for (const [kind, id] of [["output", "object"], ["media", state.storageKey]]) {
    const resource = state.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE resource_kind=? AND resource_id=?").get(kind, id);
    assert.equal(resource.source_event_id, events[1].eventId);
    assert.equal(resource.visibility, "collaborative_output");
    assert.equal(resource.actor_user_id, "editor");
  }
  assert.ok(state.sqlite.prepare("SELECT visibility FROM project_resource_scopes WHERE resource_id IN('prompt','provider-output','provider-response')").all().every((row) => row.visibility === "actor_private"));
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM output_target_acceptances").get().n, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM output_assets").get().n, 0);
  assert.equal(JSON.stringify(state.sqlite.prepare("SELECT payload FROM events").all()).includes("private provider"), false);
});

test("native slides publish only the owner-held artifact content and leave planning input private", async () => {
  const state = await nativeFixture("render_document"), events = state.assign([state.slides(), state.next("GenerationUsageRecorded", { document_id: "document" })]);
  const result = await state.commit(events);
  assert.equal(result.at(-1).meta.changes, 1);
  const rows = state.sqlite.prepare("SELECT resource_kind,resource_id,visibility,source_event_id,actor_user_id FROM project_resource_scopes WHERE resource_id IN('artifact','artifact-content','artifact-input') ORDER BY resource_id").all();
  assert.deepEqual(rows.map((row) => [row.resource_id, row.visibility, row.source_event_id, row.actor_user_id]), [
    ["artifact", "collaborative_output", events[0].eventId, "editor"],
    ["artifact-content", "collaborative_output", events[0].eventId, "editor"],
    ["artifact-input", "actor_private", events[0].eventId, "editor"],
  ]);
  assert.equal(state.sqlite.prepare("SELECT owner_id FROM private_content WHERE content_id='artifact-content'").get().owner_id, "owner");
  assert.equal(state.sqlite.prepare("SELECT owner_id FROM private_content WHERE content_id='artifact-input'").get().owner_id, "editor");
});

test("native publication resource custody matches the existing full synchronizer", async () => {
  for (const kind of ["generate", "render_document"]) {
    const state = await nativeFixture(kind), event = kind === "generate" ? state.image() : state.slides();
    await state.commit(state.assign([event]));
    const read = () => state.sqlite.prepare("SELECT resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,actor_user_id,source_event_id FROM project_resource_scopes WHERE source_event_id=? ORDER BY resource_kind,resource_id").all(event.eventId).map((row) => ({ ...row }));
    const native = read();
    state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE source_event_id=?").run(event.eventId);
    state.sqlite.exec("UPDATE project_migration_states SET last_owner_sequence=0");
    await synchronizeProjectScope(state.env, state.scope);
    assert.deepEqual(read(), native);
  }
});

test("publication never advances over an unprocessed sibling completion or another semantic event", async () => {
  for (const type of ["GenerationCompleted", "BlockCreated"]) {
    const state = await nativeFixture();
    const prior = state.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states").get().last_owner_sequence;
    const sibling = state.append(type, { document_id: "document", project_id: "project", object_ids: ["sibling-output"], block_id: "sibling-block", type: "direction", properties: { text: "Changed source" } }, type === "GenerationCompleted" ? "worker:generator" : "user:owner", "sibling-job");
    const event = state.image(), result = await state.commit(state.assign([event]));
    assert.equal(result.at(-1).meta.changes, 0);
    assert.equal(state.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states").get().last_owner_sequence, prior);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_event_scopes WHERE event_id=?").get(sibling.eventId).n, 0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_event_scopes WHERE event_id=?").get(event.eventId).n, 1);
  }
});

test("quarantine, membership revocation and grant revocation inside publication roll back its events and every sidecar", async () => {
  for (const sql of ["UPDATE project_migration_states SET status='disabled'", "UPDATE organization_memberships SET status='revoked' WHERE user_id='editor'", "UPDATE output_execution_grants SET status='revoked'", "UPDATE output_plan_targets SET selected=0", "UPDATE document_jobs SET lease_expires_at='2000-01-01T00:00:00.000Z'"]) {
    const state = await nativeFixture(), event = state.image();
    await assert.rejects(() => state.commit(state.assign([event]), { beforeSidecars: [state.env.DB.prepare(sql)] }), /CHECK constraint/u);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(event.eventId).n, 0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE private_event_id=?").get(event.eventId).n, 0);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind IN('output','media')").get().n, 0);
    assert.equal(state.sqlite.prepare("SELECT status FROM project_migration_states").get().status, "active");
  }
});

test("erased queue authority or staged completion bodies cannot be revived by publication", async () => {
  const erased = await nativeFixture(), event = erased.image();
  erased.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(erased.now, erased.queued.eventId);
  await assert.rejects(() => erased.commit(erased.assign([event])), /CHECK constraint/u);
  assert.equal(erased.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(erased.queued.eventId).private_json, "");
  assert.equal(erased.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id=?").get(event.eventId).n, 0);
  const staged = await nativeFixture(), completion = staged.image();
  await assert.rejects(() => staged.commit(staged.assign([completion]), { beforeSidecars: [staged.env.DB.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").bind(staged.now, completion.eventId)] }), /CHECK constraint/u);
  assert.equal(staged.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE private_event_id=?").get(completion.eventId).n, 0);
});

test("a zero-row append caused by a head race leaves no scopes or cursor changes and can retry", async () => {
  const state = await nativeFixture(), event = state.image(); state.assign([event]);
  const old = state.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states").get().last_owner_sequence;
  state.append("GenerationUsageRecorded", { total_tokens: 1 }, "worker:policy", "another-job");
  const first = await state.commit([event]);
  assert.equal(first[0].meta.changes, 0);
  assert.equal(first.at(-1).meta.changes, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind IN('output','media')").get().n, 0);
  assert.equal(state.sqlite.prepare("SELECT last_owner_sequence FROM project_migration_states").get().last_owner_sequence, old);
  const retry = await state.commit(state.assign([event]));
  assert.equal(retry[0].meta.changes, 1);
  assert.equal(retry.at(-1).meta.changes, 0, "the previously unprocessed gap still requires synchronization");
});

test("a partially suppressed event batch rolls back the first event instead of leaving an orphaned private body", async () => {
  const state = await nativeFixture(), events = state.assign([state.image(), state.next("GenerationUsageRecorded", { document_id: "document" })]);
  await assert.rejects(() => state.commit(events, { include: (_event, index) => index === 0 }), /CHECK constraint/u);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_id IN(?,?)").get(...events.map((event) => event.eventId)).n, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM event_private_payloads WHERE private_event_id IN(?,?)").get(...events.map((event) => event.eventId)).n, 0);
});

test("foreign actors, scopes, non-native types and unrelated private content cannot enter native publication", async () => {
  for (const mutate of [(event) => { event.actor = "user:editor"; }, (event) => { event.correlationId = "another-job"; }, (event) => { event.payload.document_id = "another-document"; }, (event) => { event.payload.project_id = "another-project"; }, (event) => { event.type = "OutputTargetAccepted"; }]) {
    const state = await nativeFixture(), event = state.image(); state.assign([event]); mutate(event);
    assert.throws(() => prepareOutputNativeProjectPublicationStatements(state.env, state.binding, [event]), (error) => error.code === "output_native_route_unsupported");
  }
  for (const mutation of ["UPDATE private_content SET owner_id='editor' WHERE content_id='artifact-content'", "UPDATE private_content SET kind='prompt' WHERE content_id='artifact-content'", "UPDATE private_content SET content=json_set(content,'$.document_id','foreign-document') WHERE content_id='artifact-input'"]) {
    const state = await nativeFixture("render_document"), event = state.slides(); state.sqlite.exec(mutation);
    await assert.rejects(() => state.commit(state.assign([event])), /CHECK constraint/u);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind='artifact'").get().n, 0);
  }
});

test("native image media requires a confirmed exact-slot write and cannot publish another file", async () => {
  for (const mutation of ["UPDATE output_native_storage_writes SET write_acknowledged=0", "UPDATE output_native_storage_writes SET status='cleanup_pending'", "UPDATE output_native_storage_writes SET storage_key='owner/other-image.png'"]) {
    const state = await nativeFixture(), event = state.image(); state.sqlite.exec(mutation);
    await assert.rejects(() => state.commit(state.assign([event])), /CHECK constraint/u);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind='media'").get().n, 0);
  }
});

test("worker registry and failure events can advance a current native cursor without creating readable outputs", async () => {
  const state = await nativeFixture("render_document");
  const registered = state.next("ModelRegistered", { model_id: "fixture" }, "worker:registry");
  const failed = state.next("DocumentRenderFailed", { project_id: "project", document_id: "document", artifact_id: "artifact", artifact_kind: "slides", error_code: "fixture_failure" });
  const events = state.assign([registered, failed]);
  assert.ok(events.every((event) => typeof eventWriteBindings(event)[16] === "string"), "production stages retain an exact private envelope even for registry data");
  const result = await state.commit(events);
  assert.equal(result.at(-1).meta.changes, 1);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_event_scopes WHERE event_id IN(?,?)").get(...events.map((event) => event.eventId)).n, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM project_resource_scopes WHERE resource_kind IN('artifact','output','media')").get().n, 0);
});
