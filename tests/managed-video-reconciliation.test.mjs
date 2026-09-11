// Dedicated regression: actual application functions, synthetic in-memory SQLite.
// No existing test imports, production credentials, disk database, provider or network.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/u, '');
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('Synthetic research forbids network'); };
const sourcePaths = [
  'worker/managed-video-reconciliation.ts', 'worker/managed-video-reconciliation-schema.ts',
  'drizzle/0037_managed_video_reconciliation.sql', 'worker/generation-accounting-preview.ts',
  'worker/managed-video-accounting-reconciliation.ts', 'worker/budget-hold-dispositions.ts',
  'worker/pilot-policy.ts', 'worker/access-policy.ts', 'worker/output-requirements-ledger.ts', 'worker/runtime.ts',
];
const pins = () => sourcePaths.map(path => { const bytes = readFileSync(`${APP}/${path}`); return {
  path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
}; });
const beforePins = pins();
const load = path => import(pathToFileURL(`${APP}/${path}`).href);
const { VIDEO_TREATMENT: T, previewManagedVideoReconciliation: preview,
  applyManagedVideoReconciliation: apply, verifyManagedVideoReconciliation: verify } = await load('worker/managed-video-reconciliation.ts');
const { PRINCIPAL_WITH_ACCESS_SQL } = await load('worker/access-policy.ts');
const { POLICY_VERSION } = await load('worker/pilot-policy.ts');
const { EVENT_WRITE_STAGE_TRIGGER_SQL } = await load('worker/runtime.ts');
const migration = readFileSync(`${APP}/drizzle/0037_managed_video_reconciliation.sql`, 'utf8');

class Statement {
  constructor(db, sql, bindings = []) { this.db = db; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings); }
  async first(column) { const row = this.db.execute(this).results[0]; return row ? (column === undefined ? row : row[column]) : null; }
  async all() { return this.db.execute(this); }
  async run() { return this.db.execute(this); }
}
class D1Like {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.beforeWriteBatch = null; this.loseAcknowledgement = false; this.trace = []; }
  prepare(sql) { return new Statement(this, sql); }
  execute(statement) {
    const prepared = this.sqlite.prepare(statement.sql);
    const results = prepared.columns().length ? prepared.all(...statement.bindings).map(row => ({ ...row })) : [];
    const meta = prepared.columns().length ? { changes: 0 } : prepared.run(...statement.bindings);
    assert(statement.bindings.length <= 100, "D1 bound-parameter limit");
    assert(Buffer.byteLength(statement.sql) <= 100000, "D1 SQL length limit");
    this.trace.push({ sql: statement.sql, bindings: statement.bindings.length, changes: Number(meta.changes ?? 0) });
    if (this.failAfterWrite && /^(?:UPDATE (?:budget_counters|cost_budget_counters|budget_reservations|cost_budget_reservations)|INSERT INTO (?:managed_video_reconciliations|event_write_stage))/u.test(statement.sql)
      && --this.failAfterWrite === 0) throw new Error("Synthetic failure after intended write");
    return { success: true, results, meta: { changes: Number(meta.changes ?? 0) } };
  }
  async batch(statements) {
    const write = statements.some(statement => /^UPDATE budget_counters /u.test(statement.sql));
    if (write && this.beforeWriteBatch) { const hook = this.beforeWriteBatch; this.beforeWriteBatch = null; hook(); }
    this.sqlite.exec('BEGIN');
    let results;
    try { results = statements.map(statement => this.execute(statement)); this.sqlite.exec('COMMIT'); }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
    if (write && this.loseAcknowledgement) { this.loseAcknowledgement = false; throw new Error('Synthetic lost acknowledgement after commit'); }
    return results;
  }
  close() { this.sqlite.close(); }
}

// Minimal declared supporting tables, not a migration of the whole application.
// Critical reservations/counters/events match the source schemas; reconciliation
// migration and staging trigger are imported unchanged from the application.
const supportingSchema = `
CREATE TABLE users(user_id TEXT PRIMARY KEY,email TEXT,display_name TEXT,role TEXT,consent_version TEXT,consented_at TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE organizations(organization_id TEXT PRIMARY KEY,name TEXT,owner_user_id TEXT,status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE organization_memberships(membership_id TEXT,organization_id TEXT,user_id TEXT,role TEXT,status TEXT,accepted_at TEXT,revoked_at TEXT,updated_at TEXT);
CREATE TABLE organization_projects(project_access_id TEXT,project_id TEXT,organization_id TEXT,owner_user_id TEXT,status TEXT,updated_at TEXT);
CREATE TABLE project_memberships(membership_id TEXT,project_access_id TEXT,project_id TEXT,organization_id TEXT,user_id TEXT,role TEXT,status TEXT,revoked_at TEXT,updated_at TEXT);
CREATE TABLE capability_grants(user_id TEXT,capability TEXT,scope_type TEXT,organization_id TEXT,project_access_id TEXT,status TEXT,revoked_at TEXT,expires_at TEXT,updated_at TEXT);
CREATE TABLE organization_security_policies(organization_id TEXT,authentication_source TEXT,allowed_domains_json TEXT,require_mfa INTEGER,version INTEGER,updated_at TEXT);
CREATE TABLE organization_identity_bindings(organization_id TEXT,user_id TEXT,status TEXT,authentication_source TEXT,subject TEXT,updated_at TEXT);
CREATE TABLE pilot_cohorts(cohort_id TEXT,organization_id TEXT,status TEXT,starts_at TEXT,ends_at TEXT);
CREATE TABLE pilot_participants(participant_id TEXT,cohort_id TEXT,organization_id TEXT,user_id TEXT,email_normalized TEXT,status TEXT,revoked_at TEXT,role TEXT);
CREATE TABLE canvas_governance_requirements(requirement_id TEXT PRIMARY KEY NOT NULL,status TEXT NOT NULL,approved_by_user_id TEXT,approved_by_name TEXT,approved_at TEXT,evidence_ref TEXT,details_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
CREATE TABLE impersonation_sessions(actor_user_id TEXT,status TEXT,expires_at TEXT);
CREATE TABLE project_event_scopes(event_id TEXT,project_access_id TEXT,organization_id TEXT,project_sequence INTEGER);
CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT,owner_user_id TEXT);
CREATE TABLE project_budget_reservation_scopes(reservation_id TEXT);
CREATE TABLE pilot_cost_reservation_scopes(reservation_id TEXT);
CREATE TABLE output_operation_slots(job_id TEXT,token_reservation_id TEXT,cost_reservation_id TEXT);
CREATE TABLE consequential_execution_steps(token_reservation_id TEXT,cost_reservation_id TEXT);
CREATE TABLE budget_hold_dispositions(job_id TEXT,token_reservation_id TEXT,cost_reservation_id TEXT);
CREATE TABLE document_jobs(job_id TEXT PRIMARY KEY,owner_id TEXT,stream_id TEXT,document_id TEXT,kind TEXT,status TEXT,correlation_id TEXT,request_json TEXT,result_json TEXT,attempt_count INTEGER,started_at TEXT,completed_at TEXT,lease_expires_at TEXT,expires_at TEXT,updated_at TEXT,output_slot_id TEXT);
CREATE TABLE budget_counters(scope TEXT NOT NULL,scope_id TEXT NOT NULL,period TEXT NOT NULL,used_tokens INTEGER NOT NULL DEFAULT 0,reserved_tokens INTEGER NOT NULL DEFAULT 0,hard_limit_tokens INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(scope,scope_id,period));
CREATE TABLE cost_budget_counters(scope TEXT NOT NULL,scope_id TEXT NOT NULL,period TEXT NOT NULL,used_microusd INTEGER NOT NULL DEFAULT 0,reserved_microusd INTEGER NOT NULL DEFAULT 0,hard_limit_microusd INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(scope,scope_id,period));
CREATE TABLE budget_reservations(reservation_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,stream_id TEXT NOT NULL,correlation_id TEXT NOT NULL,operation TEXT NOT NULL,period TEXT NOT NULL,reserved_tokens INTEGER NOT NULL,used_tokens INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,settlement_reason TEXT,created_at TEXT NOT NULL,settled_at TEXT,updated_at TEXT NOT NULL);
CREATE TABLE cost_budget_reservations(reservation_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,workspace_id TEXT NOT NULL DEFAULT 'forma',stream_id TEXT NOT NULL DEFAULT '',correlation_id TEXT NOT NULL DEFAULT '',operation TEXT NOT NULL,period TEXT NOT NULL,reserved_microusd INTEGER NOT NULL,used_microusd INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,allow_user_overage INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,settled_at TEXT,updated_at TEXT NOT NULL);
CREATE TABLE events(event_id TEXT PRIMARY KEY NOT NULL,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL,actor TEXT NOT NULL,client_id TEXT NOT NULL,correlation_id TEXT NOT NULL,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER NOT NULL DEFAULT 1,type TEXT NOT NULL,payload TEXT NOT NULL);
CREATE UNIQUE INDEX idx_events_stream_sequence ON events(stream_id,sequence);
CREATE TRIGGER events_block_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
CREATE TRIGGER events_block_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT NOT NULL,created_at TEXT NOT NULL,redacted_at TEXT);
CREATE TABLE event_write_stage(event_id TEXT PRIMARY KEY NOT NULL,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT NOT NULL,recorded_at TEXT NOT NULL,actor TEXT NOT NULL,client_id TEXT NOT NULL,correlation_id TEXT NOT NULL,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT);
CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY NOT NULL,passed INTEGER NOT NULL CHECK(passed=1));
`;
const at = '2026-08-27T12:00:00.000Z';
function insert(db, table, row) {
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(row));
}
function fixture() {
  const DB = new D1Like(), db = DB.sqlite;
  db.exec(supportingSchema); db.exec(EVENT_WRITE_STAGE_TRIGGER_SQL); db.exec(migration);
  const actor = { userId: 'synthetic-reconciliation-admin', email: 'synthetic-admin@example.invalid', displayName: 'Synthetic administrator', role: 'admin', consentVersion: POLICY_VERSION, consentedAt: at,
    streamId: 'creative:synthetic-reconciliation-admin', access: { identityPolicyDeniedCustody: false, capabilities: [], grants: [], organizations: [], projects: [], permissionEpoch: at, canvasAccess: false } };
  insert(db, 'users', { user_id: actor.userId, email: actor.email, display_name: actor.displayName, role: actor.role, consent_version: POLICY_VERSION, consented_at: at, created_at: at, updated_at: at });
  insert(db, 'organizations', { organization_id: 'synthetic-org', name: 'Synthetic only', owner_user_id: actor.userId, status: 'active', created_at: at, updated_at: at });
  insert(db, 'pilot_cohorts', { cohort_id: 'synthetic-cohort', organization_id: 'synthetic-org', status: 'active', starts_at: at, ends_at: '2099-01-01T00:00:00.000Z' });
  insert(db, 'pilot_participants', { participant_id: 'synthetic-participant', cohort_id: 'synthetic-cohort', organization_id: 'synthetic-org', user_id: actor.userId, email_normalized: actor.email, status: 'active', revoked_at: null, role: 'member' });
  const principal = db.prepare(PRINCIPAL_WITH_ACCESS_SQL).get(actor.userId);
  actor.authorizationSnapshot = { updatedAt: principal.updated_at, rawEpoch: principal.permission_epoch, grants: principal.grants_json, organizations: principal.organizations_json, projects: principal.projects_json, identityPolicies: principal.identity_policies_json, canvasRequirements: principal.approved_canvas_requirements };
  const checkpoint = {
    reservationId: T.tokenReservationId, costReservationId: T.costReservationId, costReservationPeriod: T.period,
    plannerResponseId: T.plannerId, providerSubmissionProtocol: 1,
    providerSubmissions: {
      'synthetic:planner': { clientRequestId: 'synthetic:planner', provider: 'openai', operation: 'planning', model: 'gpt-5.6-terra', status: 'completed', providerRequestId: T.plannerId, costMicrousd: T.plannerMicrousd, inputTokens: T.plannerInputTokens, outputTokens: T.plannerOutputTokens, totalTokens: T.usedTokens },
      'synthetic:anchor': { clientRequestId: 'synthetic:anchor', provider: 'fal', operation: 'image', model: 'ideogram/v4', unitId: 'continuity-anchor', status: 'completed', providerRequestId: T.anchorId, costMicrousd: T.anchorMicrousd, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      'synthetic:video': { clientRequestId: 'synthetic:video', provider: 'fal', operation: 'video', model: T.videoModel, unitId: `scene:${T.sceneId}`, status: 'accepted', providerRequestId: T.videoId },
    },
    productionAnchor: { sceneId: T.sceneId, providerJobId: T.anchorId, providerSubmissionId: 'synthetic:anchor', costMicrousd: T.anchorMicrousd },
    productionSceneReceipts: { [T.sceneId]: { sceneId: T.sceneId, providerJobId: T.videoId, providerSubmissionId: 'synthetic:video', status: 'submitted', durationSeconds: 15 } },
    generationReceipt: { actual_provider_call_count: 3 },
  };
  insert(db, 'document_jobs', { job_id: T.jobId, owner_id: actor.userId, stream_id: actor.streamId, document_id: T.documentId, kind: 'render_document', status: 'failed', correlation_id: `${T.jobId}:attempt:1`, request_json: JSON.stringify({ artifactKind: 'video', productionMode: 'managed' }), result_json: JSON.stringify(checkpoint), attempt_count: 1, started_at: at, completed_at: at, lease_expires_at: null, expires_at: '2099-01-01T00:00:00.000Z', updated_at: at, output_slot_id: null });
  const common = { owner_id: actor.userId, stream_id: actor.streamId, correlation_id: `${T.jobId}:attempt:1`, operation: 'document-render:video', period: T.period, created_at: at, settled_at: null, updated_at: at };
  insert(db, 'budget_reservations', { reservation_id: T.tokenReservationId, ...common, reserved_tokens: T.reservedTokens, used_tokens: 0, status: 'active', settlement_reason: null });
  insert(db, 'cost_budget_reservations', { reservation_id: T.costReservationId, ...common, workspace_id: 'forma', reserved_microusd: T.reservedMicrousd, used_microusd: 0, status: 'executing', allow_user_overage: 0 });
  for (const [scope, scope_id] of [['user', actor.userId], ['workspace', 'forma']]) for (const period of [T.period, '2026-09']) {
    insert(db, 'budget_counters', { scope, scope_id, period, used_tokens: 111, reserved_tokens: period === T.period ? T.reservedTokens + 222 : 333, hard_limit_tokens: 2000000, updated_at: at });
    insert(db, 'cost_budget_counters', { scope, scope_id, period, used_microusd: 444, reserved_microusd: period === T.period ? T.reservedMicrousd + 555 : 666, hard_limit_microusd: 100000000, updated_at: at });
  }
  const event = (id, sequence, type, payload) => insert(db, 'events', { event_id: id, stream_id: actor.streamId, sequence, occurred_at: at, recorded_at: at, actor: actor.userId, client_id: 'synthetic-seed', correlation_id: `${T.jobId}:attempt:1`, schema_version: 1, type, payload: JSON.stringify(payload) });
  event('synthetic-reservation-audit', 1, 'BudgetReserved', { period: T.period, operation: common.operation, reservation_id: T.tokenReservationId, cost_reservation_id: T.costReservationId, reserved_tokens: T.reservedTokens, reserved_microusd: T.reservedMicrousd });
  event('01a040b8-a890-7be6-9f26-a5fa670e3179', 2, 'DocumentRenderFailed', { http_status: 422, provider_request_id: T.videoId, error_code: 'fal_content_policy_violation', retryable: false });
  return { DB, db, actor, env: { DB, FORMA_PILOT_COHORT_ID: 'synthetic-cohort' } };
}
const tableRows = (f, table) => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row }));
const snapshot = f => Object.fromEntries(['document_jobs', 'budget_reservations', 'cost_budget_reservations', 'budget_counters', 'cost_budget_counters', 'managed_video_reconciliations', 'events', 'event_write_stage', 'output_atomic_assertions'].map(table => [table, tableRows(f, table)]));
async function command(f) { const { preview: p } = await preview(f.env, f.actor); assert(p?.mutationAvailable); return { treatmentId: T.id, treatmentSha256: p.treatmentSha256, snapshotSha256: p.snapshotSha256, evidenceSha256: p.evidenceSha256, acknowledgement: p.acknowledgement }; }
async function rejectCode(action, code) { await assert.rejects(action, error => error?.code === code); }
const results = [];
async function run(name, body) { const f = fixture(); const start = performance.now(); try { const detail = await body(f); results.push({ name, status: 'passed', durationMs: +(performance.now() - start).toFixed(3), ...detail }); } catch (error) { results.push({ name, status: 'failed', code: error.code, message: error.message, stack: error.stack }); } finally { f.DB.close(); } }

await run('successful exact adjustment, unchanged September/job/limits, durable audit', async f => {
  const before = snapshot(f), c = await command(f); assert.deepEqual(snapshot(f), before);
  const outcome = await apply(f.env, f.actor, c); assert(outcome.applied && !outcome.replayed && outcome.verification.verified);
  const after = snapshot(f); assert.deepEqual(after.document_jobs, before.document_jobs);
  for (const [table, unit, used, remaining] of [['budget_counters', 'tokens', T.usedTokens, 222], ['cost_budget_counters', 'microusd', T.usedMicrousd, 555]]) {
    for (const row of after[table]) { const old = before[table].find(value => value.scope === row.scope && value.period === row.period); if (row.period !== T.period) assert.deepEqual(row, old); else { assert.equal(row[`reserved_${unit}`], remaining); assert.equal(row[`used_${unit}`], old[`used_${unit}`] + used); assert.equal(row[`hard_limit_${unit}`], old[`hard_limit_${unit}`]); } }
  }
  assert.equal(after.budget_reservations[0].used_tokens, T.usedTokens); assert.equal(after.cost_budget_reservations[0].used_microusd, T.usedMicrousd);
  assert.equal(after.budget_reservations[0].status, 'settled'); assert.equal(after.cost_budget_reservations[0].status, 'settled');
  assert.equal(after.managed_video_reconciliations.length, 1); assert.equal(after.events.length, before.events.length + 4);
  assert.deepEqual(after.events.slice(0, 2), before.events); assert.equal(after.event_write_stage.length, 0); assert.equal(after.output_atomic_assertions.length, 0);
  const video = JSON.parse(after.events.find(row => row.event_id === `${T.id}:video`).payload); assert.equal(video.cost_microusd, 0); assert.equal(video.provider_billing_verified, false); assert.equal(video.billing_basis, 'operator_adjudicated_zero');
  const release = JSON.parse(after.events.find(row => row.event_id === `${T.id}:release`).payload); assert.equal(release.released_tokens, 136420); assert.equal(release.released_microusd, 19545516);
  assert.equal(outcome.verification.providerVerified, false); assert.equal(outcome.verification.currentCounters, 'match_recorded_after_state');
  return { usedTokens: T.usedTokens, usedMicrousd: T.usedMicrousd, unusedTokens: release.released_tokens, unusedMicrousd: release.released_microusd, appendedEvents: 4 };
});
await run('same-command replay and changed-command refusal', async f => { const c = await command(f); await apply(f.env, f.actor, c); const before = snapshot(f); const replay = await apply(f.env, f.actor, c); assert(!replay.applied && replay.replayed && replay.verification.verified); assert.deepEqual(snapshot(f), before); await rejectCode(() => apply(f.env, f.actor, { ...c, evidenceSha256: '0'.repeat(64) }), 'reconciliation_command_conflict'); assert.deepEqual(snapshot(f), before); });
await run('post-commit acknowledgement loss is verified replay, not duplicate accounting', async f => { const c = await command(f); f.DB.loseAcknowledgement = true; const out = await apply(f.env, f.actor, c); assert(!out.applied && out.replayed && out.verification.verified); assert.equal(tableRows(f, 'managed_video_reconciliations').length, 1); assert.equal(tableRows(f, 'events').length, 6); });
await run('late SQL failure rolls back counters, reservations, durable record and first three audits', async f => {
  const c = await command(f); f.db.exec("CREATE TRIGGER synthetic_late_failure BEFORE INSERT ON events WHEN NEW.type='BudgetReleased' BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END"); const before = snapshot(f);
  await rejectCode(() => apply(f.env, f.actor, c), 'reconciliation_write_conflict'); assert.deepEqual(snapshot(f), before);
  assert(f.DB.trace.some(row => row.sql.startsWith('INSERT INTO managed_video_reconciliations') && row.changes === 1)); assert.equal(f.DB.trace.filter(row => row.sql.startsWith('INSERT INTO event_write_stage') && row.changes === 1).length, 3);
});
await run('changed counter after preview refuses before mutation', async f => { const c = await command(f); f.db.exec("UPDATE budget_counters SET used_tokens=used_tokens+7 WHERE period='2026-08' AND scope='user'"); const before = snapshot(f); await rejectCode(() => apply(f.env, f.actor, c), 'reconciliation_preview_changed'); assert.deepEqual(snapshot(f), before); });
await run('counter race between snapshot and write batch fails compare-and-swap atomically', async f => { const c = await command(f); let concurrent; f.DB.beforeWriteBatch = () => { f.db.exec("UPDATE budget_counters SET used_tokens=used_tokens+7 WHERE period='2026-08' AND scope='user'"); concurrent = snapshot(f); }; await rejectCode(() => apply(f.env, f.actor, c), 'reconciliation_write_conflict'); assert.deepEqual(snapshot(f), concurrent); });
await run('configured pilot revocation at commit fails closed', async f => { const c = await command(f); const before = snapshot(f); f.DB.beforeWriteBatch = () => f.db.exec("UPDATE pilot_participants SET status='revoked'"); await rejectCode(() => apply(f.env, f.actor, c), 'reconciliation_write_conflict'); assert.deepEqual(snapshot(f), before); });
await run('administrator epoch change refuses stale authority', async f => { const c = await command(f); f.db.exec("UPDATE users SET updated_at='2026-09-11T00:00:00.000Z'"); const before = snapshot(f); await rejectCode(() => apply(f.env, f.actor, c), 'reconciliation_authority_changed'); assert.deepEqual(snapshot(f), before); });
await run('missing exact immutable trigger refuses schema admission', async f => { f.db.exec('DROP TRIGGER managed_video_reconciliations_no_replace'); const before = snapshot(f); await rejectCode(() => preview(f.env, f.actor), 'reconciliation_schema_not_ready'); assert.deepEqual(snapshot(f), before); });
await run('durable record update/delete/replace and reservation update/delete/replace blocked', async f => {
  await apply(f.env, f.actor, await command(f)); const before = snapshot(f); let attempts = 0;
  for (const table of ['managed_video_reconciliations', 'budget_reservations', 'cost_budget_reservations']) {
    const row = tableRows(f, table)[0], id = table === 'managed_video_reconciliations' ? 'reconciliation_id' : 'reservation_id';
    for (const sql of [`UPDATE ${table} SET ${id}=${id}`, `DELETE FROM ${table}`, `INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`]) { assert.throws(() => f.db.exec(sql), /append_only|requires_review/u); attempts++; assert.deepEqual(snapshot(f), before); }
    assert(row[id]);
  }
  assert((await verify(f.env, f.actor)).verified); return { blockedMutationAttempts: attempts };
});
await run('supported prior usage and prepaid marker refuse without writes', async f => {
  const job = tableRows(f, 'document_jobs')[0], original = job.result_json, checkpoint = JSON.parse(original); checkpoint.productionPrepaidAnchor = true;
  f.db.prepare('UPDATE document_jobs SET result_json=?').run(JSON.stringify(checkpoint)); let before = snapshot(f); await rejectCode(() => preview(f.env, f.actor), 'reconciliation_treatment_conflict'); assert.deepEqual(snapshot(f), before);
  f.db.prepare('UPDATE document_jobs SET result_json=?').run(original);
  insert(f.db, 'events', { event_id: 'synthetic-prior-usage', stream_id: f.actor.streamId, sequence: 3, occurred_at: at, recorded_at: at, actor: f.actor.userId, client_id: 'synthetic-seed', correlation_id: `${T.jobId}:attempt:1`, schema_version: 1, type: 'GenerationUsageRecorded', payload: JSON.stringify({ reservation_id: T.tokenReservationId, cost_reservation_id: T.costReservationId, planner_response_id: T.plannerId, total_tokens: 1, cost_microusd: 1 }) }); before = snapshot(f);
  await rejectCode(() => preview(f.env, f.actor), 'reconciliation_treatment_conflict'); assert.deepEqual(snapshot(f), before);
});
for (let index = 1; index <= 11; index++) await run('complete rollback after intended write ' + index, async f => {
  const c = await command(f), before = snapshot(f); f.DB.failAfterWrite = index;
  await rejectCode(() => apply(f.env, f.actor, c), 'reconciliation_write_conflict');
  assert.deepEqual(snapshot(f), before);
});
await run('matching prior event inserted at commit aborts the whole correction', async f => {
  const c = await command(f); let concurrent;
  f.DB.beforeWriteBatch = () => {
    insert(f.db, 'events', { event_id: 'synthetic-new-prior', stream_id: f.actor.streamId, sequence: 3, occurred_at: at, recorded_at: at,
      actor: f.actor.userId, client_id: 'synthetic-seed', correlation_id: T.jobId + ':attempt:1', schema_version: 1,
      type: 'GenerationUsageRecorded', payload: JSON.stringify({ provider_job_id: T.anchorId, cost_microusd: 0 }) });
    concurrent = snapshot(f);
  };
  await rejectCode(() => apply(f.env, f.actor, c), 'reconciliation_write_conflict'); assert.deepEqual(snapshot(f), concurrent);
});
await run('exact model and scene definition refuse self-consistent substitute receipts', async f => {
  const original = tableRows(f, 'document_jobs')[0].result_json;
  for (const field of ['model', 'scene']) {
    const checkpoint = JSON.parse(original);
    if (field === 'model') checkpoint.providerSubmissions['synthetic:planner'].model = 'different-model';
    else {
      checkpoint.providerSubmissions['synthetic:video'].unitId = 'scene:scene-004';
      checkpoint.productionAnchor.sceneId = 'scene-004';
      checkpoint.productionSceneReceipts['scene-003'].sceneId = 'scene-004';
    }
    f.db.prepare('UPDATE document_jobs SET result_json=?').run(JSON.stringify(checkpoint));
    const before = snapshot(f); await rejectCode(() => preview(f.env, f.actor), 'reconciliation_treatment_conflict'); assert.deepEqual(snapshot(f), before);
  }
});
await run('later legitimate counter activity qualifies current verification without replaying money', async f => {
  const c = await command(f); await apply(f.env, f.actor, c);
  f.db.exec("UPDATE budget_counters SET used_tokens=used_tokens+7 WHERE period='2026-08' AND scope='user'");
  const before = snapshot(f), result = await verify(f.env, f.actor);
  assert.equal(result.transactionVerified, true); assert.equal(result.verified, false); assert.equal(result.requiresReview, true);
  assert(result.reviewReasons.includes('counters_changed_since_transaction')); assert.deepEqual(snapshot(f), before);
});
await run('independent verification rejects a self-consistent but malformed before-counter record', async f => {
  await apply(f.env, f.actor, await command(f));
  const { holdHash } = await load('worker/budget-hold-dispositions.ts');
  const { VIDEO_RECONCILIATION_SCHEMA } = await load('worker/managed-video-reconciliation-schema.ts');
  const row = tableRows(f, 'managed_video_reconciliations')[0], record = JSON.parse(row.record_json);
  record.before.tokenCounters = []; record.after.tokenCounters = [];
  f.db.exec('DROP TRIGGER managed_video_reconciliations_no_update');
  f.db.prepare('UPDATE managed_video_reconciliations SET record_json=?,record_sha256=?').run(JSON.stringify(record), await holdHash(record));
  f.db.exec(VIDEO_RECONCILIATION_SCHEMA.find(sql => sql.startsWith('CREATE TRIGGER managed_video_reconciliations_no_update ')));
  await rejectCode(() => verify(f.env, f.actor), 'reconciliation_counter_evidence_conflict');
});
await run('terminal video job cannot become project/Output work inside the commit window', async f => {
  const c = await command(f); let concurrent;
  f.DB.beforeWriteBatch = () => { f.db.exec("UPDATE document_jobs SET output_slot_id='synthetic-protected-slot'"); concurrent = snapshot(f); };
  await rejectCode(() => apply(f.env, f.actor, c), 'reconciliation_write_conflict'); assert.deepEqual(snapshot(f), concurrent);
});
await run('HTTP preview/apply/separate verification preserve exact principal and no-store', async f => {
  const { createVideoReconciliationHandler } = await load('worker/managed-video-reconciliation-api.ts');
  const handler = createVideoReconciliationHandler(async () => ({ user: f.actor, response: null }));
  const base = 'https://forma.example.invalid/api/admin/managed-video-reconciliation';
  const read = await handler(new Request(base + '?jobId=' + T.jobId), f.env);
  assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'private, no-store');
  const p = (await read.json()).preview;
  const c = { treatmentId: T.id, treatmentSha256: p.treatmentSha256, snapshotSha256: p.snapshotSha256, evidenceSha256: p.evidenceSha256, acknowledgement: p.acknowledgement };
  const post = await handler(new Request(base, { method: 'POST', headers: { origin: 'https://forma.example.invalid', 'content-type': 'application/json' }, body: JSON.stringify(c) }), f.env);
  assert.equal(post.status, 200); assert.equal((await post.json()).verification.verified, true);
  const before = snapshot(f), receipt = await handler(new Request(base + '?treatmentId=' + T.id), f.env);
  assert.equal((await receipt.json()).verification.verified, true); assert.deepEqual(snapshot(f), before);
});
await run('HTTP method/origin/body/extra-field and final-authority failures stay fail-closed', async f => {
  const { createVideoReconciliationHandler } = await load('worker/managed-video-reconciliation-api.ts');
  const handler = createVideoReconciliationHandler(async () => ({ user: f.actor, response: null }));
  const base = 'https://forma.example.invalid/api/admin/managed-video-reconciliation', before = snapshot(f), c = await command(f);
  for (const [request, status] of [
    [new Request(base, { method: 'PUT' }), 405],
    [new Request(base, { method: 'POST', headers: { origin: 'https://other.invalid' }, body: '{}' }), 403],
    [new Request(base, { method: 'POST', headers: { origin: 'https://forma.example.invalid', 'content-type': 'text/plain' }, body: '{}' }), 415],
    [new Request(base, { method: 'POST', headers: { origin: 'https://forma.example.invalid', 'content-type': 'application/json' }, body: ' '.repeat(4097) }), 413],
    [new Request(base, { method: 'POST', headers: { origin: 'https://forma.example.invalid', 'content-type': 'application/json' }, body: JSON.stringify({ ...c, usedMicrousd: 0 }) }), 400],
  ]) assert.equal((await handler(request, f.env)).status, status);
  let calls = 0;
  const changed = createVideoReconciliationHandler(async () => ({ user: ++calls === 1 ? f.actor : { ...f.actor, streamId: 'creative:other' }, response: null }));
  const refused = await changed(new Request(base + '?jobId=' + T.jobId), f.env); assert.equal(refused.status, 409);
  assert.deepEqual(snapshot(f), before);
});
assert.equal(networkAttempts, 0); assert.deepEqual(pins(), beforePins, 'Declared source changed during the run');
const versionDb = new DatabaseSync(':memory:');
const sqliteVersion = versionDb.prepare('SELECT sqlite_version() AS version').get().version;
versionDb.close();
console.log(JSON.stringify({ kind: 'detached-synthetic-sqlite-research', node: process.version, sqlite: sqliteVersion,
  generatedAt: new Date().toISOString(), database: ':memory:', realProviderCalls: 0, liveDatabaseConnections: 0, passed: results.filter(row => row.status === 'passed').length,
  failed: results.filter(row => row.status === 'failed').length, results, sourcePins: beforePins,
  limitations: ['Synthetic rows use exact treatment constants, not acquired production evidence.', 'Reduced supporting schema; exact reconciliation migration and event staging trigger execute unchanged.', 'Node SQLite adapter is not actual Cloudflare D1; transaction, trigger and SQL behavior only.', 'No HTTP route/UI, provider billing, live counter ownership or production mutation acceptance.'] }, null, 2));
if (results.some(row => row.status !== 'passed')) process.exitCode = 1;
