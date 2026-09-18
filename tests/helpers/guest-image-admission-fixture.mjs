import assert from 'node:assert/strict';
import { quotedFixture, authorize, issueGuestImageGrant, request, rows, snapshot, changes, nativeEvents, unchangedExcept,
  insert, canonicalJson, digest, contextBytes, payer, origin, addLease, redactSource } from './guest-image-issuer-fixture.mjs';
const [witness, admission] = await Promise.all([
  import('../../worker/experience-guest-image-admission-witness.ts'),
  import('../../worker/experience-guest-image-admission.ts'),
]);
export const { createGuestImageAdmissionAuthority } = witness;
export const { admitGuestImage, readGuestImageAdmission } = admission;

/** Genuine accepted source/approval/SAVE/confirmation/quote/issuer setup.
 * The only canonical user is the synthetic payer; no admitted native graph or
 * trusted guest principal is handcrafted by this helper. */
export async function issuedFixture(t, options = {}) {
  const f = await quotedFixture(t, options);
  const issuedAuthorization = await authorize(f);
  f.issued = await issueGuestImageGrant(f.request, f.env, issuedAuthorization.authority);
  f.authorizationInput = issuedAuthorization.input.authorization;
  f.envelope = JSON.parse(rows(f, 'experience_sponsor_issuances')[0].envelope_json);
  f.original = snapshot(f);
  // The frozen SQLite adapter labels all WITH statements as reads. This native
  // consumption CTE is a write; execute it as such so its real changes ACK is
  // preserved. The actual D1 fixture replaces this adapter without alteration.
  const nativeBatch = f.DB.batch;
  f.DB.batch = statements => nativeBatch.call(f.DB, statements.map(statement => {
    if (/WITH[\s\S]*INSERT INTO experience_sponsor_consumptions/u.test(statement.sql)) {
      const execute = statement.execute;
      statement.execute = function (kind) { return execute.call(this, kind === 'all' ? 'run' : kind); };
    }
    return statement;
  }));
  assert.deepEqual(rows(f, 'users').map(row => row.user_id), [payer]);
  assert.equal(rows(f, 'document_jobs').length, 0);
  assert.equal(rows(f, 'budget_reservations').length, 0);
  assert.equal(rows(f, 'cost_budget_reservations').length, 0);
  return f;
}
export const admissionTables = ['events', 'event_private_payloads', 'output_commands', 'output_execution_grants',
  'output_operation_slots', 'output_operation_routes', 'document_jobs', 'budget_reservations', 'cost_budget_reservations',
  'budget_counters', 'cost_budget_counters', 'experience_sponsor_consumptions', 'experience_sponsor_active_jobs'];
export const admissionBatch = statements => statements.some(row => /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+output_execution_grants\b/iu.test(row.sql));
export async function admit(f, req = f.request) {
  const authority = await createGuestImageAdmissionAuthority(req, f.env, f.input);
  return { authority, result: await admitGuestImage(req, f.env, authority) };
}
export function admissionReceiptAssertions(f, result, replayed = false) {
  assert.deepEqual(Object.keys(result).sort(), ['status', 'documentId', 'preflightId', 'grantId', 'sponsorGrantId', 'consumptionId',
    'jobId', 'slotId', 'commandKey', 'eventId', 'expiresAt', 'replayed', 'nativeAuthorizationCommitted', 'admissionCommitted',
    'generationAvailable', 'custodyTransferred'].sort());
  assert.equal(result.status, 'admitted'); assert.equal(result.documentId, f.session.documentId);
  assert.equal(result.preflightId, f.quoted.preflight.id); assert.equal(result.sponsorGrantId, f.issued.grantId);
  assert.equal(result.consumptionId, f.envelope.consumptionId); assert.equal(result.replayed, replayed);
  assert.equal(result.nativeAuthorizationCommitted, true); assert.equal(result.admissionCommitted, true);
  assert.equal(result.generationAvailable, false); assert.equal(result.custodyTransferred, false);
  assert.ok(Object.isFrozen(result)); assert.equal(new Date(result.expiresAt).toISOString(), result.expiresAt);
  assert.ok(Date.parse(result.expiresAt) <= f.issued.expiresAtMs);
  for (const key of ['grantId', 'jobId', 'slotId', 'commandKey', 'eventId']) assert.equal(typeof result[key], 'string', key);
  for (const secret of [f.subject, f.session.sessionToken, f.session.claimToken, payer, 'SELECT', 'private_json', 'reserved_tokens', 'reserved_microusd'])
    assert.equal(JSON.stringify(result).includes(secret), false, 'admission projection excludes source, payer identity and budget data');
}
export function assertOriginalUnchanged(f, before = f.original) {
  unchangedExcept(f, before, admissionTables);
  for (const table of ['events', 'event_private_payloads', 'output_commands'])
    assert.deepEqual(rows(f, table).slice(0, before.contents[table].length), before.contents[table], `original ${table} remains byte-identical`);
  assert.deepEqual(rows(f, 'experience_sponsor_issuances'), before.contents.experience_sponsor_issuances);
  assert.deepEqual(rows(f, 'experience_sponsor_grants'), before.contents.experience_sponsor_grants);
  assert.deepEqual(rows(f, 'experience_sponsor_resource_receipts'), before.contents.experience_sponsor_resource_receipts);
}
export function interceptAdmission(f, action, { before = false } = {}) {
  const batch = f.DB.batch; let calls = 0;
  f.DB.batch = async statements => {
    if (!admissionBatch(statements)) return batch.call(f.DB, statements);
    calls++;
    if (before) statements = await action(statements) ?? statements;
    const result = await batch.call(f.DB, statements);
    return before ? result : action(result, statements);
  };
  return { get calls() { return calls; }, restore() { f.DB.batch = batch; } };
}
export function observeAdmissionSql(f) {
  const prepare = f.DB.prepare, batch = f.DB.batch;
  const observed = { prepared: [], executed: [], batches: [], violations: [], readOnly: false };
  const mutates = sql => /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu.test(sql);
  function note(sql, bindings, method) {
    if (observed.readOnly && mutates(sql)) observed.violations.push({ kind: 'read-only-write', sql });
    if (/^\s*(?:CREATE|ALTER|DROP|PRAGMA)\b/iu.test(sql)) observed.violations.push({ kind: 'schema-operation', sql });
    if (/\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(?:provider_health|generation_preflights)\b/iu.test(sql))
      observed.violations.push({ kind: 'readiness-persistence', sql });
    observed.executed.push({ sql, bindings: bindings.length, sqlBytes: Buffer.byteLength(sql), method });
  }
  function wrap(statement, sql, bindings = []) {
    const bind = statement.bind;
    statement.bind = function (...values) { return wrap(bind.apply(this, values), sql, values); };
    for (const method of ['first', 'all', 'run']) {
      const original = statement[method];
      statement[method] = function (...args) { note(sql, bindings, method); return original.apply(this, args); };
    }
    return statement;
  }
  f.DB.prepare = function (sql) { observed.prepared.push(sql); return wrap(prepare.call(this, sql), sql); };
  f.DB.batch = function (statements) {
    observed.batches.push(statements.map(row => row.sql));
    for (const row of statements) note(row.sql, row.bindings ?? [], 'batch');
    return batch.call(this, statements);
  };
  return { ...observed, get readOnly() { return observed.readOnly; }, set readOnly(value) { observed.readOnly = value; },
    assertClean() { assert.deepEqual(observed.violations, []); }, restore() { f.DB.prepare = prepare; f.DB.batch = batch; } };
}
export { request, rows, snapshot, changes, nativeEvents, unchangedExcept, insert, canonicalJson, digest,
  contextBytes, payer, origin, addLease, redactSource };
