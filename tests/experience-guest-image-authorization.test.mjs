import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quotedFixture, authorize, prepareGuestImageAuthorization, createGuestImageAuthorization, issueGuestImageGrant,
  readGuestImageIssuance, request, rows, snapshot, changes, canonicalJson, digest, payer, origin, addLease, redactSource } from './helpers/guest-image-issuer-fixture.mjs';

test('source-free authorization review makes no consent or write; opaque authorization is request-local', async t => {
  const f = await quotedFixture(t), before = snapshot(f), count = changes(f);
  assert.equal(await readGuestImageIssuance(f.request, f.env, f.input), null);
  const { review, input, authority } = await authorize(f);
  assert.deepEqual(Object.keys(review).sort(), ['status', 'documentId', 'sourceRevision', 'authorization', 'reviewedAuthorizationDigest'].sort());
  assert.equal(review.status, 'review'); assert.equal(review.documentId, f.session.documentId);
  assert.equal(review.sourceRevision, f.committed.head + 3); assert.equal(Object.hasOwn(review.authorization, 'explicitAuthorization'), false);
  assert.equal(review.authorization.preflightId, f.quoted.preflight.id);
  assert.equal(review.authorization.termsDigest, f.quoted.preflight.termsDigest);
  assert.equal(review.authorization.maximumMicrousd, f.quoted.preflight.maximumMicrousd);
  assert.ok(Object.isFrozen(review)); assert.ok(Object.isFrozen(review.authorization)); assert.ok(Object.isFrozen(authority));
  assert.equal(review.reviewedAuthorizationDigest, await digest(input.authorization));
  assert.equal(canonicalJson(authority), '{}');
  for (const secret of [f.subject, f.session.sessionToken, f.session.claimToken, payer, 'SELECT', 'private_json', 'OPENAI_API_KEY'])
    assert.equal(JSON.stringify(review).includes(secret), false, 'review reveals no source or payer credentials');
  await assert.rejects(issueGuestImageGrant(f.request, f.env, structuredClone(authority)));
  await assert.rejects(issueGuestImageGrant(request(), f.env, authority));
  await assert.rejects(issueGuestImageGrant(f.request, { ...f.env }, authority));
  await assert.rejects(issueGuestImageGrant(f.request, f.env, { ...input.authorization }));
  assert.deepEqual(snapshot(f), before); assert.equal(changes(f), count);
});

const substitutions = {
  'missing explicit consent': input => { delete input.authorization.explicitAuthorization; },
  'false explicit consent': input => { input.authorization.explicitAuthorization = false; },
  'wrong preflight': input => { input.authorization.preflightId = 'foreign-preflight'; },
  'wrong terms': input => { input.authorization.termsDigest = 'a'.repeat(64); },
  'wrong cap': input => { input.authorization.maximumMicrousd++; },
  'wrong policy': input => { input.authorization.policyDigest = `sha256:${'a'.repeat(64)}`; },
  'wrong session': input => { input.authorization.sessionDigest = `sha256:${'b'.repeat(64)}`; },
  'wrong source': input => { input.authorization.guestSourceDigest = `sha256:${'c'.repeat(64)}`; },
  'caller-selected payer': input => { input.payerUserId = payer; },
  'caller-selected grant': input => { input.authorization.grantId = 'arbitrary-grant'; },
};
test('closed submitted authorization rejects each consent and identity substitution before mutation', async t => {
  const f = await quotedFixture(t), review = await prepareGuestImageAuthorization(f.request, f.env, f.input), before = snapshot(f), count = changes(f);
  for (const [name, substitute] of Object.entries(substitutions)) {
    const input = { ...structuredClone(f.input), authorization: { ...review.authorization, explicitAuthorization: true } };
    substitute(input); await assert.rejects(createGuestImageAuthorization(f.request, f.env, input), undefined, name);
  }
  assert.deepEqual(snapshot(f), before); assert.equal(changes(f), count);
});

const authorityChanges = {
  'payer consent withdrawn': f => f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(payer),
  'payer role changed': f => f.sqlite.prepare("UPDATE users SET role='suspended' WHERE user_id=?").run(payer),
  'campaign disabled': f => f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(f.input.campaignId),
  'guest session revoked': f => f.sqlite.prepare('UPDATE experience_guest_sessions SET revoked_at_ms=1 WHERE session_id=?').run(f.session.sessionId),
  'source policy revoked': f => f.sqlite.prepare('UPDATE experience_guest_source_policies SET revoked_at_ms=1 WHERE policy_id=?').run(f.sourcePolicy.policyId),
  'source redacted': redactSource,
  'destination claim lease': addLease,
  'request headers changed': f => f.request.headers.set('x-changed', 'yes'),
  'database replaced': f => { f.env.DB = { ...f.DB }; },
};
for (const [name, change] of Object.entries(authorityChanges)) test(`captured guest authorization refuses ${name}`, async t => {
  const f = await quotedFixture(t), { authority } = await authorize(f); change(f); const before = snapshot(f);
  await assert.rejects(issueGuestImageGrant(f.request, f.env, authority));
  assert.deepEqual(snapshot(f), before); assert.equal(rows(f, 'experience_sponsor_issuances').length, 0);
});

test('aborted request and non-origin POST cannot create authorization', async t => {
  const f = await quotedFixture(t), controller = new AbortController(); controller.abort();
  for (const req of [new Request(`${origin}/unregistered`, { method: 'POST', headers: { origin }, signal: controller.signal }),
    new Request(`${origin}/unregistered`, { method: 'POST', headers: { origin: 'https://other.example.invalid' } }),
    new Request(`${origin}/unregistered`, { headers: { origin } })]) {
    const before = snapshot(f); await assert.rejects(prepareGuestImageAuthorization(req, f.env, f.input)); assert.deepEqual(snapshot(f), before);
  }
});
