import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { OUTPUT_REQUIREMENTS_SCHEMA, outputScopeAuthority, outputAssertionStatements } from "../worker/output-requirements-ledger.ts";
import { POLICY_VERSION } from "../worker/pilot-policy.ts";
import { outputRequirementHeadGuard } from "../worker/output-requirement-event-guards.ts";
import { outputAssetObjectKeys } from "../worker/output-asset-storage-identity.ts";
import {
  inertOutputRecoveryRecord, outputRecoveryRecordIsInert, outputRequirementRecoveryRecords,
  organizationOutputAssetInventory, outputAssetCustodyMatches, organizationOutputSubmissionBlockers,
  outputOrganizationDeletionGuard, personalOutputErasureStatements, personalOutputErasureProgress, organizationOutputDeletionStatements,
} from "../worker/output-requirement-retention.ts";

const now = "2026-08-27T12:00:00.000Z", future = "2027-01-01T00:00:00.000Z";
const digest = "a".repeat(64);
const sourceSecret = "private source not operational evidence";
globalThis.fetch = async () => { throw new Error("Unexpected network/provider request in governance tests"); };

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,payload TEXT,type TEXT,sequence INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,private_json TEXT,redacted_at TEXT);
    CREATE TABLE project_event_scopes(event_id TEXT,organization_id TEXT,project_access_id TEXT,owner_user_id TEXT,project_id TEXT);
    CREATE TABLE users(user_id TEXT PRIMARY KEY,consent_version TEXT,role TEXT);
    CREATE TABLE organization_projects(project_access_id TEXT PRIMARY KEY,organization_id TEXT,project_id TEXT,owner_user_id TEXT,status TEXT);
    CREATE TABLE organizations(organization_id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE project_migration_states(project_access_id TEXT,organization_id TEXT,status TEXT);
    CREATE TABLE organization_memberships(organization_id TEXT,user_id TEXT,status TEXT,accepted_at TEXT,revoked_at TEXT);
    CREATE TABLE project_memberships(membership_id TEXT,project_access_id TEXT,organization_id TEXT,project_id TEXT,user_id TEXT,role TEXT,status TEXT,revoked_at TEXT);
    CREATE TABLE project_context_sessions(context_id TEXT,principal_user_id TEXT,project_access_id TEXT,organization_id TEXT,revoked_at TEXT,expires_at TEXT);
    CREATE TABLE capability_grants(user_id TEXT,capability TEXT,scope_type TEXT,organization_id TEXT,project_access_id TEXT,status TEXT,revoked_at TEXT,expires_at TEXT);
    CREATE TABLE pilot_cohorts(cohort_id TEXT,organization_id TEXT,status TEXT);
    CREATE TABLE pilot_participants(cohort_id TEXT,organization_id TEXT,user_id TEXT,status TEXT,revoked_at TEXT,role TEXT);
    CREATE TABLE cost_budget_reservations(reservation_id TEXT PRIMARY KEY,owner_id TEXT,status TEXT,reserved_microusd INTEGER,used_microusd INTEGER);
    CREATE TABLE document_jobs(job_id TEXT PRIMARY KEY,status TEXT,attempt_count INTEGER,request_json TEXT,result_json TEXT,error_message TEXT,updated_at TEXT,completed_at TEXT,lease_expires_at TEXT);
    CREATE TABLE organization_deletion_items(job_id TEXT,organization_id TEXT,resource_kind TEXT,resource_id TEXT,status TEXT);
  `);
  for (const sql of OUTPUT_REQUIREMENTS_SCHEMA) sqlite.exec(sql);
  const insert = (table, row) => sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  class Statement {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...args) { assert.ok(args.length <= 100, "D1 bind limit"); return new Statement(this.sql, args); }
    execute(mode) {
      const prepared = sqlite.prepare(this.sql);
      if (mode === "first") return prepared.get(...this.args) ?? null;
      if (mode === "all") return { results: prepared.all(...this.args), success: true, meta: { changes: 0 } };
      const result = prepared.run(...this.args);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    }
    async first() { return this.execute("first"); }
    async all() { return this.execute("all"); }
    async run() { return this.execute("run"); }
  }
  const env = { DB: { prepare(sql) { return new Statement(sql); }, async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = statements.map((statement) => statement.execute(/^\s*(?:SELECT|WITH)/iu.test(statement.sql) ? "all" : "run")); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } };
  const event = (id, owner, organizationId = null, projectId = "project-one") => {
    insert("events", { event_id: id, stream_id: `creative:${owner}`, type: "OutputPlanConfirmed", payload: JSON.stringify({ project_id: projectId, _private_ref: id }) });
    insert("event_private_payloads", { private_event_id: id, owner_id: owner, private_json: JSON.stringify({ text: sourceSecret }), redacted_at: null });
    if (organizationId) insert("project_event_scopes", { event_id: id, organization_id: organizationId, project_access_id: `${organizationId}-access`, owner_user_id: owner, project_id: projectId });
  };
  const plan = ({ key, owner = "owner", organizationId = null, projectId = "project-one", slotStatus = "queued", callStatus = null } = {}) => {
    const planId = `${key}-plan`, grantId = `${key}-grant`, slotId = `${key}-slot`;
    for (const suffix of ["confirm", "preflight", "authorization"]) event(`${key}-${suffix}`, owner, organizationId, projectId);
    insert("output_plan_revisions", { scope_key: key, scope_kind: organizationId ? "project" : "personal", owner_user_id: owner, project_id: projectId, document_id: `${key}-doc`, organization_id: organizationId, project_access_id: organizationId ? `${organizationId}-access` : null, plan_revision_id: planId, plan_id: planId, revision: 1, confirmed_event_id: `${key}-confirm`, requirements_digest: digest, source_digest: digest, resolver_version: "1", source_head: 1, target_count: 1, created_at: now });
    insert("output_plan_targets", { scope_key: key, plan_revision_id: planId, target_id: `${key}-target`, target_contract_digest: digest, media_kind: "image", required: 1, selected: 1, ordinal: 0 });
    insert("output_preflights", { scope_key: key, preflight_id: `${key}-preflight`, plan_revision_id: planId, actor_user_id: owner, terms_digest: digest, event_id: `${key}-preflight`, expires_at: future, created_at: now });
    insert("output_execution_grants", { scope_key: key, grant_id: grantId, plan_revision_id: planId, actor_user_id: owner, payer_user_id: owner, preflight_id: `${key}-preflight`, authorization_event_id: `${key}-authorization`, maximum_microusd: 1000, maximum_calls: 2, status: "authorized", expires_at: future, created_at: now });
    insert("output_operation_slots", { scope_key: key, slot_id: slotId, grant_id: grantId, plan_revision_id: planId, target_id: `${key}-target`, target_contract_digest: digest, source_digest: digest, provider: "test-transport", model: "fixture", route_digest: digest, job_id: `${key}-job`, cost_reservation_id: `${key}-cost`, token_reservation_id: `${key}-token`, maximum_microusd: 1000, maximum_calls: 2, maximum_tokens: 1000, status: slotStatus, outcome_event_id: null, created_at: now, updated_at: now });
    insert("document_jobs", { job_id: `${key}-job`, status: slotStatus === "running" ? "running" : "queued", attempt_count: slotStatus === "running" ? 1 : 0, request_json: JSON.stringify({ snapshot: sourceSecret }), result_json: JSON.stringify({ privateDraft: sourceSecret, reconciliation: `${key}-call` }), error_message: sourceSecret, updated_at: now, completed_at: null, lease_expires_at: future });
    insert("cost_budget_reservations", { reservation_id: `${key}-cost`, owner_id: owner, status: callStatus ? "executing" : "active", reserved_microusd: 1000, used_microusd: 0 });
    insert("output_operation_routes", { scope_key: key, slot_id: slotId, stage_key: "initial", provider: "test-transport", model: "fixture", maximum_calls: 2 });
    if (callStatus) insert("output_provider_calls", { scope_key: key, slot_id: slotId, call_key: "initial:1", client_request_id: `${key}-client-request`, request_digest: digest, stage_key: "initial", provider: "test-transport", model: "fixture", reserved_microusd: 1000, used_microusd: null, status: callStatus, provider_response_id: `${key}-receipt`, created_at: now, settled_at: null });
    return { key, planId, grantId, slotId };
  };
  const asset = ({ key, owner = "owner", organizationId = null } = {}) => {
    event(`${key}-asset-event`, owner, organizationId);
    insert("output_assets", { scope_key: key, asset_id: `${key}-asset`, document_id: `${key}-doc`, owner_user_id: owner, created_by_user_id: owner, source_digest: digest, storage_key: `output-requirements/${owner}/${key}-asset/${digest}.png`, content_sha256: digest, byte_length: 128, mime_type: "image/png", media_kind: "image", created_event_id: `${key}-asset-event`, created_at: now, redacted_at: null });
  };
  const nativeStorage = ({ key, owner = "owner", organizationId = null, status = "writing", acknowledged = 0, published = false } = {}) => {
    if (published) event(`${key}-native-publication`, owner, organizationId);
    insert("output_native_storage_writes", { scope_key: key, slot_id: `${key}-slot`, storage_key: `native/${owner}/${key}.png`, content_sha256: digest, status, write_acknowledged: acknowledged, publication_event_id: published ? `${key}-native-publication` : null, created_at: now, updated_at: now });
  };
  const assetStorage = ({ key, owner = "owner", organizationId = null, status = "writing", acknowledged = 0, published = false } = {}) => {
    if (published) event(`${key}-asset-publication`, owner, organizationId);
    insert("output_asset_storage_writes", { scope_key: key, asset_id: `${key}-staged-asset`, owner_user_id: owner, actor_user_id: owner, organization_id: organizationId,
      project_access_id: organizationId ? `${organizationId}-access` : null, project_id: "project-one", document_id: `${key}-doc`, context_id: organizationId ? `${organizationId}-context` : null,
      command_key: `${key}-command`, request_digest: digest, source_digest: digest, storage_key: `output-requirements/${owner}/${key}-staged-asset/${digest}.png`, content_sha256: digest, byte_length: 128,
      status, write_acknowledged: acknowledged, publication_event_id: published ? `${key}-asset-publication` : null, created_at: now, updated_at: now });
  };
  return { sqlite, env, insert, event, plan, asset, nativeStorage, assetStorage };
}

test("personal erasure revokes only personal authority and retains uncertain monetary evidence", async () => {
  const { sqlite, env, plan } = database();
  plan({ key: "safe" }); plan({ key: "uncertain", slotStatus: "running", callStatus: "uncertain" });
  plan({ key: "shared", organizationId: "org-one" }); plan({ key: "foreign", owner: "another-owner" });
  const scrub = "request_json='{}',result_json=json_object('reconciliation',json_extract(result_json,'$.reconciliation'))";
  const statements = await personalOutputErasureStatements(env, "owner", now, scrub);
  await env.DB.batch([...statements, env.DB.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=event_private_payloads.private_event_id)").bind(now, "owner")]);
  assert.equal(sqlite.prepare("SELECT status FROM output_execution_grants WHERE scope_key='safe'").get().status, "revoked");
  assert.equal(sqlite.prepare("SELECT status FROM output_operation_slots WHERE scope_key='safe'").get().status, "cancelled");
  assert.equal(sqlite.prepare("SELECT status FROM document_jobs WHERE job_id='safe-job'").get().status, "canceled");
  assert.equal(sqlite.prepare("SELECT status FROM output_execution_grants WHERE scope_key='shared'").get().status, "authorized");
  assert.equal(sqlite.prepare("SELECT status FROM output_execution_grants WHERE scope_key='foreign'").get().status, "authorized");
  assert.equal(sqlite.prepare("SELECT status FROM output_operation_slots WHERE scope_key='uncertain'").get().status, "uncertain");
  assert.deepEqual({ ...sqlite.prepare("SELECT status,reserved_microusd,provider_response_id FROM output_provider_calls WHERE scope_key='uncertain'").get() }, { status: "uncertain", reserved_microusd: 1000, provider_response_id: "uncertain-receipt" });
  assert.equal(sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id='uncertain-cost'").get().status, "executing");
  const job = sqlite.prepare("SELECT request_json,result_json,error_message FROM document_jobs WHERE job_id='uncertain-job'").get();
  assert.equal(JSON.stringify(job).includes(sourceSecret), false);
  assert.equal(JSON.parse(job.result_json).reconciliation, "uncertain-call");
  assert.ok(sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id='shared-confirm'").get().private_json.includes(sourceSecret));
});

test("an erasure failure rolls back grant revocation, body erasure and job cancellation together", async () => {
  const { sqlite, env, plan } = database(); plan({ key: "rollback" });
  const statements = await personalOutputErasureStatements(env, "owner", now, "request_json='{}',result_json=NULL");
  await assert.rejects(() => env.DB.batch([...statements, env.DB.prepare("UPDATE event_private_payloads SET private_json=''") , env.DB.prepare("SELECT json('force rollback')")]));
  assert.equal(sqlite.prepare("SELECT status FROM output_execution_grants").get().status, "authorized");
  assert.equal(sqlite.prepare("SELECT status FROM document_jobs").get().status, "queued");
  assert.ok(sqlite.prepare("SELECT private_json FROM event_private_payloads LIMIT 1").get().private_json.includes(sourceSecret));
});

test("adopted file custody includes pre-plan uploads and never leaks another organization", async () => {
  const { env, asset } = database(); asset({ key: "pre-plan", organizationId: "org-one" }); asset({ key: "foreign", organizationId: "org-two" }); asset({ key: "personal" });
  const inventory = await organizationOutputAssetInventory(env, "org-one");
  assert.deepEqual(inventory.map((row) => row.asset_id), ["pre-plan-asset"]);
  const metadata = { outputRequirementAsset: "1", ownerId: "owner", assetId: "pre-plan-asset", scopeKey: "pre-plan", documentId: "pre-plan-doc", sha256: digest };
  assert.equal(outputAssetCustodyMatches(inventory[0], metadata), true);
  for (const patch of [{ scopeKey: "foreign" }, { sha256: "b".repeat(64) }, { assetId: "foreign-asset" }, { documentId: "foreign-doc" }, { ownerId: "foreign" }]) assert.equal(outputAssetCustodyMatches(inventory[0], { ...metadata, ...patch }), false);
  assert.equal(outputAssetCustodyMatches({ ...inventory[0], resource_id: "uploads/foreign.png" }, metadata), false);
});

test("organization snapshots carry exact custody rows but restore no spendable grant or preflight", async () => {
  const { env, plan, asset } = database();
  plan({ key: "shared", organizationId: "org-one", slotStatus: "running", callStatus: "pending" });
  plan({ key: "foreign", organizationId: "org-two" }); asset({ key: "pre-plan", organizationId: "org-one" });
  const records = await outputRequirementRecoveryRecords(env, "org-one");
  assert.deepEqual(records.outputPlans.map((row) => row.scope_key), ["shared"]);
  assert.equal(records.outputAssets[0].scope_key, "pre-plan");
  for (const kind of ["outputGrants", "outputPreflights", "outputSlots", "outputCalls"]) assert.ok(records[kind].every((row) => outputRecoveryRecordIsInert(kind, row)));
  assert.equal(records.outputGrants[0].status, "revoked");
  assert.equal(records.outputGrants[0].historical_status, "authorized");
  assert.equal(records.outputCalls[0].status, "uncertain");
  assert.equal(records.outputCalls[0].provider_response_id, "shared-receipt");
  assert.equal(records.outputRoutes.length, 1);
  assert.equal(JSON.stringify(records).includes(sourceSecret), false);
  assert.equal(outputRecoveryRecordIsInert("outputGrants", { status: "authorized", recovery_inert: true }), false);
  assert.equal(outputRecoveryRecordIsInert("outputSlots", { status: "queued", recovery_inert: true }), false);
  assert.equal(inertOutputRecoveryRecord("outputSlots", { status: "queued" }).status, "cancelled");
});

test("unsettled Output calls block organization deletion inside the SQLite transaction", async () => {
  const { sqlite, env, plan, asset } = database();
  plan({ key: "shared", organizationId: "org-one", slotStatus: "running", callStatus: "uncertain" }); asset({ key: "asset", organizationId: "org-one" });
  assert.equal((await organizationOutputSubmissionBlockers(env, "org-one")).length, 1);
  const guard = await outputOrganizationDeletionGuard(env, "org-one");
  assert.equal(sqlite.prepare(`SELECT (${guard.sql}) AS allowed`).get(...guard.bindings).allowed, 0);
  await assert.rejects(() => env.DB.batch([env.DB.prepare("UPDATE event_private_payloads SET private_json=''") , ...awaitableForbidden() ]));
  function awaitableForbidden() { return [env.DB.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE json('unsettled') END`).bind(...guard.bindings)]; }
  assert.ok(sqlite.prepare("SELECT private_json FROM event_private_payloads LIMIT 1").get().private_json.includes(sourceSecret));
  const statements = await organizationOutputDeletionStatements(env, "org-one", now);
  await assert.rejects(() => env.DB.batch(statements));
  assert.equal(sqlite.prepare("SELECT redacted_at FROM output_assets").get().redacted_at, null);
  assert.equal(sqlite.prepare("SELECT status FROM output_execution_grants").get().status, "authorized");
});

test("after reconciliation, tenant erasure revokes authority without deleting another tenant or accounting receipts", async () => {
  const { sqlite, env, plan, asset } = database();
  plan({ key: "shared", organizationId: "org-one", callStatus: "settled" });
  sqlite.exec("UPDATE cost_budget_reservations SET status='settled'; UPDATE output_operation_slots SET status='succeeded'");
  plan({ key: "foreign", organizationId: "org-two" }); asset({ key: "ours", organizationId: "org-one" }); asset({ key: "theirs", organizationId: "org-two" });
  await env.DB.batch(await organizationOutputDeletionStatements(env, "org-one", now));
  assert.equal(sqlite.prepare("SELECT status FROM output_execution_grants WHERE scope_key='shared'").get().status, "revoked");
  assert.equal(sqlite.prepare("SELECT status FROM output_execution_grants WHERE scope_key='foreign'").get().status, "authorized");
  assert.equal(sqlite.prepare("SELECT redacted_at FROM output_assets WHERE scope_key='ours'").get().redacted_at, now);
  assert.equal(sqlite.prepare("SELECT redacted_at FROM output_assets WHERE scope_key='theirs'").get().redacted_at, null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM output_provider_calls").get().count, 1);
});

function sharedPrincipal(fixture, actor = "editor") {
  const { insert } = fixture;
  for (const user of ["owner", actor]) insert("users", { user_id: user, consent_version: POLICY_VERSION, role: "creator" });
  insert("organizations", { organization_id: "org-one", status: "active" });
  insert("organization_projects", { project_access_id: "access-one", organization_id: "org-one", project_id: "project-one", owner_user_id: "owner", status: "active" });
  insert("project_migration_states", { project_access_id: "access-one", organization_id: "org-one", status: "active" });
  for (const user of ["owner", actor]) insert("organization_memberships", { organization_id: "org-one", user_id: user, status: "active", accepted_at: now, revoked_at: null });
  insert("project_memberships", { membership_id: "member-one", project_access_id: "access-one", organization_id: "org-one", project_id: "project-one", user_id: actor, role: "viewer", status: "active", revoked_at: null });
  insert("project_context_sessions", { context_id: "context-one", principal_user_id: actor, project_access_id: "access-one", organization_id: "org-one", revoked_at: null, expires_at: future });
  for (const capability of ["project.author", "project.output.request", "project.review.approve"]) insert("capability_grants", { user_id: actor, capability, scope_type: "project", organization_id: "org-one", project_access_id: "access-one", status: "active", revoked_at: null, expires_at: future });
  return { kind: "project", key: "scope-one", ownerUserId: "owner", actorUserId: actor, projectId: "project-one", documentId: "doc-one", organizationId: "org-one", projectAccessId: "access-one", contextId: "context-one" };
}

test("live Output authority rechecks selected project, grants and revocation in real SQLite", () => {
  const fixture = database(), { sqlite } = fixture, scope = sharedPrincipal(fixture);
  const permitted = (candidate = scope, permission = "author") => { const guard = outputScopeAuthority(candidate, permission, now); return sqlite.prepare(`SELECT (${guard.sql}) AS allowed`).get(...guard.bindings).allowed === 1; };
  assert.equal(permitted(), true);
  assert.equal(permitted({ ...scope, projectId: "another-project" }), false);
  assert.equal(permitted({ ...scope, contextId: "foreign-context" }), false);
  sqlite.exec("UPDATE capability_grants SET status='revoked' WHERE capability='project.author'");
  assert.equal(permitted(), false); assert.equal(permitted(scope, "review"), true);
  sqlite.exec("UPDATE project_memberships SET role='editor'");
  assert.equal(permitted(), true, "a current editor retains the platform's intrinsic author capability");
  sqlite.exec("UPDATE project_context_sessions SET revoked_at='2026-08-27T12:00:00.000Z'");
  assert.equal(permitted(scope, "review"), false);
});

test("a managed reviewer cannot inherit authoring rights, even with an old author grant", () => {
  const fixture = database(), { sqlite, insert } = fixture, scope = sharedPrincipal(fixture, "reviewer");
  insert("pilot_cohorts", { cohort_id: "pilot", organization_id: "org-one", status: "active" });
  insert("pilot_participants", { cohort_id: "pilot", organization_id: "org-one", user_id: "reviewer", status: "active", revoked_at: null, role: "reviewer" });
  const testPermission = (permission) => { const guard = outputScopeAuthority(scope, permission, now); return sqlite.prepare(`SELECT (${guard.sql}) AS allowed`).get(...guard.bindings).allowed; };
  assert.equal(testPermission("author"), 0); assert.equal(testPermission("request"), 0); assert.equal(testPermission("review"), 1); assert.equal(testPermission("read"), 1);
});

test("a zero-row guard aborts and rolls back earlier ledger writes", async () => {
  const fixture = database(), { sqlite, env } = fixture, scope = sharedPrincipal(fixture);
  sqlite.exec("CREATE TABLE side_effects(id TEXT PRIMARY KEY)");
  await assert.rejects(() => env.DB.batch([
    env.DB.prepare("INSERT INTO side_effects(id) VALUES('must-rollback')"),
    env.DB.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").bind(now, scope.contextId),
    ...outputAssertionStatements(env, outputScopeAuthority(scope, "author", now)),
  ]));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM side_effects").get().count, 0);
  assert.equal(sqlite.prepare("SELECT revoked_at FROM project_context_sessions").get().revoked_at, null);
});

test("a concurrent type conversion invalidates generic authoring before any partial event append", async () => {
  const { sqlite, env } = database();
  sqlite.exec("CREATE TABLE appended_side_effects(id TEXT PRIMARY KEY); INSERT INTO events(event_id,stream_id,sequence,payload,type) VALUES('original','creative:owner',1,'{}','BlockCreated')");
  await assert.rejects(() => env.DB.batch([
    env.DB.prepare("INSERT INTO appended_side_effects(id) VALUES('must-rollback')"),
    env.DB.prepare("INSERT INTO events(event_id,stream_id,sequence,payload,type) VALUES('conversion','creative:owner',2,'{}','BlockPropertyEdited')"),
    outputRequirementHeadGuard(env, "creative:owner", 1),
  ]));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM appended_side_effects").get().count, 0);
  assert.equal(sqlite.prepare("SELECT MAX(sequence) AS head FROM events").get().head, 1);
  await env.DB.batch([outputRequirementHeadGuard(env, "creative:owner", 1), env.DB.prepare("INSERT INTO appended_side_effects(id) VALUES('current-head')")]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM appended_side_effects").get().count, 1);
});

test("personal erasure marks only unpublished personal native and pre-plan upload receipts for cleanup", async () => {
  const fixture = database(), { sqlite, env, plan, nativeStorage, assetStorage } = fixture;
  plan({ key: "personal" }); nativeStorage({ key: "personal" });
  plan({ key: "published" }); nativeStorage({ key: "published", status: "written", acknowledged: 1, published: true });
  plan({ key: "shared", organizationId: "org-one" }); nativeStorage({ key: "shared", organizationId: "org-one" });
  plan({ key: "foreign", owner: "another-owner" }); nativeStorage({ key: "foreign", owner: "another-owner" });
  assetStorage({ key: "pre-plan" }); assetStorage({ key: "saved-upload", status: "written", acknowledged: 1, published: true });
  assetStorage({ key: "shared-upload", organizationId: "org-one" }); assetStorage({ key: "foreign-upload", owner: "another-owner" });
  await env.DB.batch(await personalOutputErasureStatements(env, "owner", now, "request_json='{}',result_json=NULL"));
  assert.equal(sqlite.prepare("SELECT status FROM output_native_storage_writes WHERE scope_key='personal'").get().status, "cleanup_pending");
  assert.equal(sqlite.prepare("SELECT status FROM output_native_storage_writes WHERE scope_key='published'").get().status, "written");
  for (const key of ["shared", "foreign"]) assert.equal(sqlite.prepare("SELECT status FROM output_native_storage_writes WHERE scope_key=?").get(key).status, "writing");
  assert.equal(sqlite.prepare("SELECT status FROM output_asset_storage_writes WHERE scope_key='pre-plan'").get().status, "cleanup_pending");
  assert.equal(sqlite.prepare("SELECT status FROM output_asset_storage_writes WHERE scope_key='saved-upload'").get().status, "written");
  for (const key of ["shared-upload", "foreign-upload"]) assert.equal(sqlite.prepare("SELECT status FROM output_asset_storage_writes WHERE scope_key=?").get(key).status, "writing");
  assert.deepEqual(await personalOutputErasureProgress(env, "owner"), { providerReconciliationPending: 0, storageCleanupPending: 2 });
});

test("personal privacy cannot absorb organization plans when their old event-scope index disappears", async () => {
  const { sqlite, env, plan, nativeStorage } = database();
  plan({ key: "shared", organizationId: "org-one" }); nativeStorage({ key: "shared", organizationId: "org-one" });
  sqlite.exec("DELETE FROM project_event_scopes");
  await env.DB.batch(await personalOutputErasureStatements(env, "owner", now, "request_json='{}',result_json=NULL"));
  assert.equal(sqlite.prepare("SELECT status FROM output_execution_grants").get().status, "authorized");
  assert.equal(sqlite.prepare("SELECT status FROM output_native_storage_writes").get().status, "writing");
  assert.deepEqual(await personalOutputErasureProgress(env, "owner"), { providerReconciliationPending: 0, storageCleanupPending: 0 });
});

test("erasure transaction failure does not strand new storage cleanup or revoke a grant", async () => {
  const { sqlite, env, plan, nativeStorage, assetStorage } = database();
  plan({ key: "personal" }); nativeStorage({ key: "personal" }); assetStorage({ key: "pre-plan" });
  const statements = await personalOutputErasureStatements(env, "owner", now, "request_json='{}',result_json=NULL");
  await assert.rejects(() => env.DB.batch([...statements, env.DB.prepare("SELECT json('abort erasure')")]));
  assert.equal(sqlite.prepare("SELECT status FROM output_native_storage_writes").get().status, "writing");
  assert.equal(sqlite.prepare("SELECT status FROM output_asset_storage_writes").get().status, "writing");
  assert.equal(sqlite.prepare("SELECT status FROM output_execution_grants").get().status, "authorized");
});

test("organization inventory includes exact native custody and uploads made before any plan or canonical event", async () => {
  const { env, plan, nativeStorage, assetStorage } = database();
  plan({ key: "shared", organizationId: "org-one" }); nativeStorage({ key: "shared", organizationId: "org-one", status: "written", acknowledged: 1, published: true });
  plan({ key: "foreign", organizationId: "org-two" }); nativeStorage({ key: "foreign", organizationId: "org-two" });
  assetStorage({ key: "unpublished", organizationId: "org-one" }); assetStorage({ key: "foreign-upload", organizationId: "org-two" });
  const rows = await organizationOutputAssetInventory(env, "org-one");
  assert.deepEqual(rows.map((row) => row.scope_key).sort(), ["shared", "unpublished"]);
  const native = rows.find((row) => row.storage_kind === "native"), staged = rows.find((row) => row.storage_kind === "asset");
  const nativeMetadata = { outputNativeStorage: "1", outputOwnerId: "owner", outputScopeKey: "shared", outputSlotId: "shared-slot", outputDocumentId: "shared-doc", outputSha256: digest };
  assert.equal(outputAssetCustodyMatches(native, nativeMetadata), true);
  for (const patch of [{ outputOwnerId: "other" }, { outputScopeKey: "foreign" }, { outputSlotId: "foreign-slot" }, { outputDocumentId: "foreign-doc" }, { outputSha256: "b".repeat(64) }, { outputNativeStorage: "0" }]) assert.equal(outputAssetCustodyMatches(native, { ...nativeMetadata, ...patch }), false);
  assert.equal(outputAssetCustodyMatches({ ...native, resource_id: "arbitrary/foreign-key" }, nativeMetadata), false);
  assert.equal(outputAssetCustodyMatches(staged, { outputRequirementAsset: "1", ownerId: "owner", scopeKey: "unpublished", assetId: "unpublished-staged-asset", documentId: "unpublished-doc", sha256: digest }), true);
  const keys = outputAssetObjectKeys({ ownerUserId: "owner", projectId: "project-one", documentId: "unpublished-doc", key: "unpublished" }, "unpublished-staged-asset", digest, "png");
  const scoped = { ...staged, resource_id: keys.key }, metadata = { outputRequirementAsset: "1", ownerId: "owner", projectId: "project-one", scopeKey: "unpublished", assetId: "unpublished-staged-asset", documentId: "unpublished-doc", sha256: digest };
  assert.equal(outputAssetCustodyMatches(scoped, metadata), true);
  assert.equal(outputAssetCustodyMatches(scoped, { ...metadata, projectId: "other-project" }), false);
  assert.equal(outputAssetCustodyMatches({ ...scoped, resource_id: keys.key.replace("/project-one/", "/other-project/") }, metadata), false);
});

test("native and pre-plan upload storage activity blocks organization deletion inside the same SQL batch", async () => {
  for (const kind of ["native", "asset"]) {
    const { sqlite, env, plan, nativeStorage, assetStorage } = database();
    if (kind === "native") { plan({ key: "shared", organizationId: "org-one" }); nativeStorage({ key: "shared", organizationId: "org-one", status: "cleanup_pending" }); }
    else assetStorage({ key: "pre-plan", organizationId: "org-one" });
    const blockers = await organizationOutputSubmissionBlockers(env, "org-one");
    assert.equal(blockers.length, 1); assert.equal(blockers[0].storageCleanupPending, true);
    const guard = await outputOrganizationDeletionGuard(env, "org-one");
    assert.equal(sqlite.prepare(`SELECT (${guard.sql}) AS allowed`).get(...guard.bindings).allowed, 0);
    sqlite.exec("CREATE TABLE deletion_side_effects(value TEXT)");
    await assert.rejects(() => env.DB.batch([env.DB.prepare("INSERT INTO deletion_side_effects VALUES('must rollback')"), ...outputAssertionStatements(env, guard)]));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM deletion_side_effects").get().n, 0);
  }
});

test("unknown storage acknowledgement stays blocking even when a deletion has seen no object", async () => {
  const { sqlite, env, assetStorage } = database(); assetStorage({ key: "unknown", organizationId: "org-one", status: "cleanup_pending", acknowledged: 0 });
  assert.equal((await organizationOutputSubmissionBlockers(env, "org-one")).length, 1);
  // Even an invalid historical 'deleted' label cannot override the lost acknowledgement.
  sqlite.exec("UPDATE output_asset_storage_writes SET status='deleted'");
  assert.equal((await organizationOutputSubmissionBlockers(env, "org-one")).length, 1);
  const restored = inertOutputRecoveryRecord("outputAssetStorageWrites", { status: "deleted", write_acknowledged: 0, publication_event_id: null });
  assert.equal(restored.status, "cleanup_pending"); assert.equal(outputRecoveryRecordIsInert("outputAssetStorageWrites", restored), true);
});

test("recovery snapshots preserve unknown storage evidence but cannot resume a write or unpublished fulfillment", async () => {
  const { env, plan, nativeStorage, assetStorage } = database();
  plan({ key: "unknown", organizationId: "org-one" }); nativeStorage({ key: "unknown", organizationId: "org-one" });
  plan({ key: "finished", organizationId: "org-one" }); nativeStorage({ key: "finished", organizationId: "org-one", status: "written", acknowledged: 1, published: true });
  assetStorage({ key: "pre-plan", organizationId: "org-one" });
  const records = await outputRequirementRecoveryRecords(env, "org-one");
  for (const kind of ["outputStorageWrites", "outputAssetStorageWrites"]) assert.ok(records[kind].every((row) => outputRecoveryRecordIsInert(kind, row)));
  assert.equal(records.outputStorageWrites.find((row) => row.scope_key === "unknown").status, "cleanup_pending");
  assert.equal(records.outputStorageWrites.find((row) => row.scope_key === "finished").status, "written");
  assert.equal(records.outputAssetStorageWrites[0].status, "cleanup_pending");
  assert.equal(JSON.stringify(records).includes(sourceSecret), false);
  assert.equal(outputRecoveryRecordIsInert("outputStorageWrites", { status: "writing", write_acknowledged: 0, recovery_inert: true }), false);
  assert.equal(outputRecoveryRecordIsInert("outputAssetStorageWrites", { status: "written", write_acknowledged: 1, publication_event_id: null, recovery_inert: true }), false);
});

test("completed organization deletion tombstones only its published storage receipts after verified cleanup", async () => {
  const { sqlite, env, insert, plan, nativeStorage, assetStorage } = database();
  plan({ key: "ours", organizationId: "org-one" }); nativeStorage({ key: "ours", organizationId: "org-one", status: "written", acknowledged: 1, published: true });
  plan({ key: "theirs", organizationId: "org-two" }); nativeStorage({ key: "theirs", organizationId: "org-two", status: "written", acknowledged: 1, published: true });
  assetStorage({ key: "our-upload", organizationId: "org-one", status: "written", acknowledged: 1, published: true });
  assetStorage({ key: "their-upload", organizationId: "org-two", status: "written", acknowledged: 1, published: true });
  assetStorage({ key: "retained-shared", organizationId: "org-one", status: "written", acknowledged: 1, published: true });
  for (const key of ["native/owner/ours.png", `output-requirements/owner/our-upload-staged-asset/${digest}.png`]) insert("organization_deletion_items", { job_id: "deletion", organization_id: "org-one", resource_kind: "media", resource_id: key, status: "deleted" });
  insert("organization_deletion_items", { job_id: "deletion", organization_id: "org-one", resource_kind: "media", resource_id: `output-requirements/owner/retained-shared-staged-asset/${digest}.png`, status: "retained-shared" });
  await env.DB.batch(await organizationOutputDeletionStatements(env, "org-one", now, "deletion"));
  assert.equal(sqlite.prepare("SELECT status FROM output_native_storage_writes WHERE scope_key='ours'").get().status, "deleted");
  assert.equal(sqlite.prepare("SELECT status FROM output_native_storage_writes WHERE scope_key='theirs'").get().status, "written");
  assert.equal(sqlite.prepare("SELECT status FROM output_asset_storage_writes WHERE scope_key='our-upload'").get().status, "deleted");
  assert.equal(sqlite.prepare("SELECT status FROM output_asset_storage_writes WHERE scope_key='their-upload'").get().status, "written");
  assert.equal(sqlite.prepare("SELECT status FROM output_asset_storage_writes WHERE scope_key='retained-shared'").get().status, "written", "an intentionally retained shared object must never be called physically deleted");
});
