import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';

registerOutputSourceImports();
const [{ GUEST_CUSTODY_SCHEMA, GUEST_DB_NOW, readGuestCustodyTerms, guestSession },
  { handleGuestSessionStart, handleGuestSessionRevoke, readGuestClaimProofCookies }, { canonicalJson, digest }] = await Promise.all([
  import('../worker/experience-guest-session.ts'), import('../worker/experience-guest-http.ts'), import('../src/experiences/compiler.ts'),
]);
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
const origin = 'https://guest.example.invalid';
const sessionCookie = '__Host-forma-guest-session', claimCookie = '__Host-forma-guest-claim';
const request = (cookie = '', overrides = {}) => new Request(`${origin}/unregistered-guest-session`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ version: 1 }), ...overrides,
});

// Every operation is forwarded to the actual local workerd D1 binding. This
// wrapper observes statements and parameters; it does not emulate execution.
function observedDatabase(raw) {
  const records = [], handles = new WeakMap();
  function observe(row) {
    const record = { sql: row.sql, parameters: row.bindings.length, sqlBytes: Buffer.byteLength(row.sql) };
    assert.ok(record.parameters <= 100); assert.ok(record.sqlBytes <= 100000); records.push(record);
  }
  function wrap(statement, sql, bindings = []) {
    const row = { statement, sql, bindings };
    const wrapped = {
      bind(...args) { return wrap(statement.bind(...args), sql, args); },
      async first(...args) { observe(row); return statement.first(...args); },
      async all(...args) { observe(row); return statement.all(...args); },
      async run(...args) { observe(row); return statement.run(...args); },
    };
    handles.set(wrapped, row); return wrapped;
  }
  return { records, DB: {
    prepare(sql) { return wrap(raw.prepare(sql), sql); },
    async batch(statements) { return raw.batch(statements.map(statement => { const row = handles.get(statement); assert.ok(row); observe(row); return row.statement; })); },
  } };
}
async function rows(db, table) { return (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results; }
async function schema(db) { return (await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results; }
function credentials(response) {
  const cookies = response.headers.getSetCookie(); assert.equal(cookies.length, 2);
  const values = Object.fromEntries(cookies.map(cookie => { const pair = cookie.split(';')[0], index = pair.indexOf('='); return [pair.slice(0, index), pair.slice(index + 1)]; }));
  assert.deepEqual(Object.keys(values).sort(), [sessionCookie, claimCookie].sort());
  const parse = (name, purpose) => {
    const match = values[name].match(new RegExp(`^v1\\.([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\\.(forma-guest-${purpose}-v1\\.[a-f0-9]{64})$`, 'u'));
    assert.ok(match, `purpose-separated ${purpose} cookie`); return { id: match[1], token: match[2] };
  };
  const session = parse(sessionCookie, 'session'), claim = parse(claimCookie, 'claim');
  assert.equal(session.id, claim.id); assert.notEqual(session.token, claim.token);
  return { proof: { sessionId: session.id, sessionToken: session.token, claimToken: claim.token }, cookies,
    header: `${sessionCookie}=${values[sessionCookie]}; ${claimCookie}=${values[claimCookie]}` };
}
function cookieAttributes(cookies, expiresAtMs) {
  for (const cookie of cookies) {
    const attributes = new Map(cookie.split(';').slice(1).map(value => { const part = value.trim(), index = part.indexOf('='); return index < 0 ? [part.toLowerCase(), true] : [part.slice(0, index).toLowerCase(), part.slice(index + 1)]; }));
    assert.equal(attributes.get('secure'), true); assert.equal(attributes.get('httponly'), true);
    assert.equal(String(attributes.get('samesite')).toLowerCase(), 'lax'); assert.equal(attributes.get('path'), '/');
    assert.equal(attributes.has('domain'), false); assert.equal(attributes.has('max-age'), false, 'absolute expiry does not reset the server deadline');
    assert.equal(Date.parse(attributes.get('expires')), Math.floor(expiresAtMs / 1000) * 1000);
  }
}
async function started(response) {
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const body = await response.json(); assert.deepEqual(Object.keys(body).sort(), ['expiresAtMs', 'status', 'version']);
  assert.equal(body.version, 1); assert.equal(body.status, 'started'); assert.ok(Number.isSafeInteger(body.expiresAtMs));
  const result = credentials(response); cookieAttributes(result.cookies, body.expiresAtMs);
  assert.ok(!JSON.stringify(body).includes(result.proof.sessionId)); assert.ok(!JSON.stringify(body).includes(result.proof.sessionToken)); assert.ok(!JSON.stringify(body).includes(result.proof.claimToken));
  return { ...result, body };
}
async function cleared(response) {
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { version: 1, status: 'revoked' });
  const cookies = response.headers.getSetCookie(); assert.equal(cookies.length, 2);
  assert.deepEqual(cookies.map(cookie => cookie.split(';')[0]).sort(), [`${claimCookie}=`, `${sessionCookie}=`].sort());
  for (const cookie of cookies) {
    assert.match(cookie, /; Path=\/(?:;|$)/u); assert.match(cookie, /; Secure(?:;|$)/u); assert.match(cookie, /; HttpOnly(?:;|$)/u);
    assert.match(cookie, /; SameSite=Lax(?:;|$)/u); assert.match(cookie, /; Max-Age=0(?:;|$)/u);
    assert.match(cookie, /; Expires=Thu, 01 Jan 1970 00:00:00 GMT(?:;|$)/u); assert.doesNotMatch(cookie, /; Domain=/iu);
  }
}
async function denied(response) {
  assert.ok(response instanceof Response); assert.ok(response.status >= 400 && response.status < 500, `denial HTTP ${response.status}`);
  assert.equal(response.headers.getSetCookie().length, 0, 'denial issues no credential cookies');
  const body = await response.json(); assert.deepEqual(Object.keys(body).sort(), ['error', 'status', 'version']);
  assert.equal(body.version, 1); assert.equal(body.status, 'unavailable'); assert.equal(typeof body.error, 'string');
}
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-http-d1-')), egress = [], media = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default { fetch() { return new Response('Local D1 fixture only.', {status:404}); } };",
    d1Databases: ['Guest'], d1Persist: directory, log: new Log(LogLevel.NONE),
    outboundService: req => { egress.push(req.url); throw Error('Worker egress forbidden.'); },
  });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); assert.deepEqual(media, []); });
  const raw = await mf.getD1Database('Guest'), observed = observedDatabase(raw), DB = observed.DB;
  t.mock.method(globalThis, 'fetch', req => { egress.push(typeof req === 'string' ? req : req?.url); throw Error('Application fetch forbidden.'); });
  const env = { DB, MEDIA: Object.fromEntries(['get', 'head', 'put', 'delete', 'list'].map(method => [method, () => { media.push(method); throw Error('Media forbidden.'); }])),
    ASSETS: { fetch() { egress.push('assets'); throw Error('Assets forbidden.'); } } };
  // Only this inert three-table guest schema is installed. No native runtime
  // bootstrap, account, provider, financial or activation setup is performed.
  for (const sql of GUEST_CUSTODY_SCHEMA) await DB.prepare(sql).run();
  const databaseNow = (await DB.prepare(`SELECT ${GUEST_DB_NOW} AS value`).first()).value;
  const terms = readGuestCustodyTerms({ version: 1, policyId: 'synthetic-guest-policy', origin, startsAtMs: databaseNow - 60000, expiresAtMs: databaseNow + 600000,
    sessionLifetimeMs: 120000, leaseLifetimeMs: 100, maximumSessions: 5, maximumLeaseAcquisitions: 2, ...overrides });
  await DB.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').bind(terms.policyId, await digest(terms), canonicalJson(terms), `sha256:${'b'.repeat(64)}`).run();
  const beforeSchema = await schema(DB), beforePolicy = await rows(DB, 'experience_guest_policies');
  assert.deepEqual(beforeSchema.filter(row => row.type === 'table' && !row.name.startsWith('_cf_')).map(row => row.name).sort(),
    ['experience_guest_claim_leases', 'experience_guest_policies', 'experience_guest_sessions']);
  observed.records.length = 0;
  return { DB, env, terms, observed,
    start: (req = request()) => handleGuestSessionStart(req, env, { policyId: terms.policyId }),
    revoke: (cookie, req = request(cookie)) => handleGuestSessionRevoke(req, env),
    async unchanged({ policy = true } = {}) { assert.deepEqual(await schema(DB), beforeSchema); if (policy) assert.deepEqual(await rows(DB, 'experience_guest_policies'), beforePolicy);
      assert.deepEqual(await rows(DB, 'experience_guest_claim_leases'), []); },
    metrics() { t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', executedStatements: observed.records.length,
      maxBindings: Math.max(...observed.records.map(row => row.parameters)), maxSqlBytes: Math.max(...observed.records.map(row => row.sqlBytes)) })); },
  };
}

// Actual local engine qualification of the dormant transport. This is not a
// deployed endpoint, browser cookie-jar exercise, public guest policy or login.
test('local D1 guest HTTP start issues purpose cookies, proves the exact session and revokes both credentials without native setup', { timeout: 90000 }, async t => {
  const f = await fixture(t), response = await f.start(), accepted = await started(response);
  const sessions = await rows(f.DB, 'experience_guest_sessions'); assert.equal(sessions.length, 1);
  const row = sessions[0]; assert.equal(row.session_id, accepted.proof.sessionId); assert.equal(row.expires_at_ms, accepted.body.expiresAtMs);
  assert.equal(row.expires_at_ms, Math.min(row.created_at_ms + f.terms.sessionLifetimeMs, f.terms.expiresAtMs));
  assert.ok(!JSON.stringify(row).includes(accepted.proof.sessionToken)); assert.ok(!JSON.stringify(row).includes(accepted.proof.claimToken));
  assert.deepEqual(readGuestClaimProofCookies(request(accepted.header)), accepted.proof);
  const authority = await guestSession(f.env, request(), accepted.proof);
  assert.equal(authority.row.session_id, row.session_id); assert.ok(await f.DB.prepare(`SELECT 1 WHERE ${authority.guard.sql}`).bind(...authority.guard.bindings).first());
  await assert.rejects(guestSession(f.env, request(), { ...accepted.proof, sessionToken: accepted.proof.claimToken, claimToken: accepted.proof.sessionToken }), /proof_unavailable/u);
  await cleared(await f.revoke(accepted.header));
  const revokedRow = (await rows(f.DB, 'experience_guest_sessions'))[0]; assert.ok(Number.isSafeInteger(revokedRow.revoked_at_ms));
  assert.deepEqual({ ...revokedRow, revoked_at_ms: null }, row);
  await assert.rejects(guestSession(f.env, request(), accepted.proof), /proof_unavailable/u);
  assert.equal(await f.DB.prepare(`SELECT 1 WHERE ${authority.guard.sql}`).bind(...authority.guard.bindings).first(), null);
  const beforeReplay = f.observed.records.length; await cleared(await f.revoke(accepted.header));
  assert.ok(f.observed.records.slice(beforeReplay).every(record => /^\s*SELECT\b/iu.test(record.sql)), 'exact revocation acknowledgment replay is read only');
  assert.deepEqual(await rows(f.DB, 'experience_guest_sessions'), [revokedRow]);
  await f.unchanged(); f.metrics();
});

test('local D1 concurrent HTTP issuance enforces the all-time policy cap and revocation does not replenish it', { timeout: 90000 }, async t => {
  const f = await fixture(t, { maximumSessions: 1 }), responses = await Promise.all(Array.from({ length: 4 }, () => f.start()));
  const accepted = responses.filter(response => response.status === 201); assert.equal(accepted.length, 1);
  for (const response of responses.filter(response => response.status !== 201)) await denied(response);
  const winner = await started(accepted[0]); assert.equal((await rows(f.DB, 'experience_guest_sessions')).length, 1);
  assert.equal((await f.revoke(winner.header)).status, 200);
  const before = await rows(f.DB, 'experience_guest_sessions'); await denied(await f.start());
  assert.deepEqual(await rows(f.DB, 'experience_guest_sessions'), before); await f.unchanged(); f.metrics();
});

test('local D1 time expires the HTTP credential and the captured proof without restoring issuance capacity', { timeout: 90000 }, async t => {
  const f = await fixture(t, { maximumSessions: 1, sessionLifetimeMs: 1200 }), accepted = await started(await f.start());
  const authority = await guestSession(f.env, request(), accepted.proof), before = await rows(f.DB, 'experience_guest_sessions');
  const limit = performance.now() + 5000;
  while (!(await f.DB.prepare(`SELECT ${GUEST_DB_NOW}>=? AS expired`).bind(accepted.body.expiresAtMs).first()).expired) { assert.ok(performance.now() < limit); await delay(20); }
  await assert.rejects(guestSession(f.env, request(), accepted.proof), /proof_unavailable/u);
  assert.equal(await f.DB.prepare(`SELECT 1 WHERE ${authority.guard.sql}`).bind(...authority.guard.bindings).first(), null);
  await denied(await f.revoke(accepted.header)); await denied(await f.start());
  assert.deepEqual(await rows(f.DB, 'experience_guest_sessions'), before); await f.unchanged(); f.metrics();
});

test('local D1 current policy revocation denies HTTP issuance and existing credentials without rewriting session history', { timeout: 90000 }, async t => {
  const f = await fixture(t), accepted = await started(await f.start()), authority = await guestSession(f.env, request(), accepted.proof);
  const before = await rows(f.DB, 'experience_guest_sessions');
  await f.DB.prepare(`UPDATE experience_guest_policies SET revoked_at_ms=${GUEST_DB_NOW} WHERE policy_id=?`).bind(f.terms.policyId).run();
  const revokedPolicy = await rows(f.DB, 'experience_guest_policies');
  await denied(await f.start()); await denied(await f.revoke(accepted.header));
  await assert.rejects(guestSession(f.env, request(), accepted.proof), /policy_unavailable/u);
  assert.equal(await f.DB.prepare(`SELECT 1 WHERE ${authority.guard.sql}`).bind(...authority.guard.bindings).first(), null);
  assert.deepEqual(await rows(f.DB, 'experience_guest_sessions'), before); assert.deepEqual(await rows(f.DB, 'experience_guest_policies'), revokedPolicy);
  await f.unchanged({ policy: false }); f.metrics();
});
