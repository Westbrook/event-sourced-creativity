import assert from 'node:assert/strict';
import { fixture, request, rows, snapshot, changes, nativeEvents, unchangedExcept, insert, canonicalJson, digest,
  contextBytes, payer, origin, addLease, redactSource } from './guest-image-stage-fixture.mjs';
const [{ SPONSOR_ISSUER_SCHEMA }, { prepareGuestImageConfirmation, confirmGuestImageRequirement },
  { preflightGuestImage }, authorization, issuer] = await Promise.all([
  import('../../worker/experience-sponsor-issuer.ts'), import('../../worker/experience-guest-image-confirmation.ts'),
  import('../../worker/experience-guest-image-preflight.ts'), import('../../worker/experience-guest-image-authorization.ts'),
  import('../../worker/experience-guest-image-issuer.ts'),
]);
export const { prepareGuestImageAuthorization, createGuestImageAuthorization } = authorization;
export const { issueGuestImageGrant, readGuestImageIssuance } = issuer;
export const issuerTables = ['experience_sponsor_grants', 'experience_sponsor_resource_receipts', 'experience_sponsor_issuances'];

/** Genuine local guest/source, payer approval, SAVE, confirmation and quote.
 * Only the synthetic payer is a users row. No suite, fake guest principal,
 * provider, financial admission or result setup is imported. */
export async function quotedFixture(t, { operationCap, byteCap, pendingCap, ...options } = {}) {
  const change = options.policyChange;
  const f = await fixture(t, { ...options, policyChange: async (policy, state) => {
    for (const allowance of [policy.resources.campaign, policy.resources.actor]) {
      if (operationCap !== undefined) allowance.maximumOperations = allowance.maximumOperationsPerWindow = operationCap;
      if (byteCap !== undefined) allowance.maximumTextBytes = allowance.maximumTextBytesPerWindow = byteCap;
      if (pendingCap !== undefined) allowance.maximumPendingGrants = pendingCap;
    }
    if (byteCap !== undefined) policy.resources.maximumOperationTextBytes = Math.min(policy.resources.maximumOperationTextBytes, byteCap);
    await change?.(policy, state);
  } });
  for (const sql of SPONSOR_ISSUER_SCHEMA) f.sqlite.exec(sql);
  const review = await prepareGuestImageConfirmation(f.request, f.env, f.input);
  f.confirmed = await confirmGuestImageRequirement(f.request, f.env, { ...f.input,
    reviewedRequirementDigest: review.reviewedRequirementDigest, explicitRequirementsConfirmation: true });
  f.quoted = await preflightGuestImage(f.request, f.env, f.input);
  assert.equal(f.quoted.status, 'quoted');
  assert.deepEqual(rows(f, 'users').map(row => row.user_id), [payer]);
  return f;
}
export async function authorize(f, req = f.request) {
  const review = await prepareGuestImageAuthorization(req, f.env, f.input);
  const input = { ...f.input, authorization: { ...review.authorization, explicitAuthorization: true } };
  return { review, input, authority: await createGuestImageAuthorization(req, f.env, input) };
}
export function receiptAssertions(f, value, replayed = false) {
  assert.deepEqual(Object.keys(value).sort(), ['status', 'documentId', 'preflightId', 'grantId', 'expiresAtMs', 'replayed',
    'nativeAuthorizationCommitted', 'admissionCommitted', 'generationAvailable', 'custodyTransferred'].sort());
  assert.equal(value.status, 'issued'); assert.equal(value.documentId, f.session.documentId);
  assert.equal(value.preflightId, f.quoted.preflight.id); assert.equal(value.replayed, replayed);
  assert.match(value.grantId, /^sponsor-issued-[a-f0-9]{64}$/u);
  assert.ok(Number.isSafeInteger(value.expiresAtMs)); assert.ok(Object.isFrozen(value));
  for (const key of ['nativeAuthorizationCommitted', 'admissionCommitted', 'generationAvailable', 'custodyTransferred']) assert.equal(value[key], false, key);
  for (const secret of [f.subject, f.session.sessionToken, f.session.claimToken, payer, 'SELECT', 'private_json', 'envelope'])
    assert.equal(JSON.stringify(value).includes(secret), false, 'source-free issuance receipt');
}
export const issuanceBatch = statements => statements.some(row => /^INSERT INTO experience_sponsor_grants\(/u.test(row.sql));
export function interceptIssuance(f, action, { before = false } = {}) {
  const batch = f.DB.batch; let calls = 0;
  f.DB.batch = async statements => {
    if (!issuanceBatch(statements)) return batch.call(f.DB, statements);
    calls++;
    if (before) await action(statements);
    const result = await batch.call(f.DB, statements);
    return before ? result : action(result, statements);
  };
  return { get calls() { return calls; }, restore() { f.DB.batch = batch; } };
}
export function assertNoExecution(f) {
  for (const table of ['experience_sponsor_consumptions', 'experience_sponsor_active_jobs', 'document_jobs',
    'budget_reservations', 'cost_budget_reservations']) assert.equal(rows(f, table).length, 0, table);
  assert.equal(nativeEvents(f).filter(event => event.type === 'OutputExecutionAuthorized').length, 0);
  assert.equal(rows(f, 'output_commands').filter(row => row.action === 'authorize').length, 0);
  assert.deepEqual(rows(f, 'users').map(row => row.user_id), [payer]);
}
export { request, rows, snapshot, changes, nativeEvents, unchangedExcept, insert, canonicalJson, digest, contextBytes, payer, origin, addLease, redactSource };
