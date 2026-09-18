import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const { handleNativeMemoryBenchmark, purgeExpiredNativeMemoryBenchmark } = await import('../worker/memory-benchmark/native.ts');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const retained = root;
const foundation = root;
const { benchmarkPlan } = await import(path.join(retained, 'worker/memory-benchmark/runner.ts'));
const { POLICY_VERSION, releaseBudget, releaseCostBudget } = await import(path.join(foundation, 'worker/pilot-policy.ts'));
const origin = 'https://benchmark.example.test';
const sourceHash = 'a'.repeat(64);

async function fixture(t, { qualified = true } = {}) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(path.join(foundation, 'drizzle')).filter(file => file.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(path.join(foundation, 'drizzle', file), 'utf8'));
  sqlite.exec(readFileSync(path.join(retained, 'db/memory-benchmark.pending.sql'), 'utf8'));
  sqlite.exec(readFileSync(path.join(root, 'db/memory-benchmark-native.pending.sql'), 'utf8'));
  const hooks = { beforeBatch: null, afterBatch: null, loseAcknowledgement: false, fetches: 0 };
  const prepare = (sql, values = []) => {
    const execute = () => {
      const statement = sqlite.prepare(sql);
      const rows = statement.all(...values).map(row => ({ ...row }));
      return { results: rows, success: true, meta: { changes: Number(sqlite.prepare('SELECT changes() AS n').get().n) } };
    };
    return { sql, values, bind: (...next) => prepare(sql, next),
      first: async () => execute().results[0] ?? null, all: async () => execute(),
      raw: async () => execute().results.map(Object.values), run: async () => execute(), execute };
  };
  const DB = { prepare, async batch(statements) {
    if (hooks.beforeBatch) { const callback = hooks.beforeBatch; hooks.beforeBatch = null; callback(statements); }
    sqlite.exec('BEGIN IMMEDIATE'); let results;
    try { results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    if (hooks.afterBatch) { const callback = hooks.afterBatch; hooks.afterBatch = null; callback(statements); }
    if (hooks.loseAcknowledgement) { hooks.loseAcknowledgement = false; throw new Error('lost acknowledgement'); }
    return results;
  } };
  const now = Date.now(), iso = new Date(now).toISOString(), plan = await benchmarkPlan();
  sqlite.prepare(`INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at)
    VALUES('owner','owner@example.test','Synthetic owner','admin',?,?,?,?)`).run(POLICY_VERSION, iso, iso, iso);
  if (qualified) sqlite.prepare(`INSERT INTO memory_benchmark_native_qualifications VALUES
    ('fixture-qualification',?,?,?,?,'qualified',?,?,1,1,1,1,1,1,1)`)
    .run(plan.planHash, sourceHash, 'b'.repeat(64), origin, now - 1000, now + 3_600_000);
  const env = { DB, FORMA_MEMORY_BENCHMARK_ENABLED: '1', FORMA_MEMORY_BENCHMARK_ORIGIN: origin,
    FORMA_MEMORY_BENCHMARK_ACTOR_IDS: 'owner', FORMA_MEMORY_BENCHMARK_SOURCE_SHA256: sourceHash,
    OPENAI_API_KEY: 'synthetic-fixture-only-never-network' };
  const request = (action, extra = {}) => new Request(origin + '/api/internal/memory-benchmark' + (action === 'approve' ? '/approval' : ''), {
    method: action === 'read' ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json',
      'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.test', ...extra.headers },
    ...(action === 'read' ? {} : { body: JSON.stringify(action === 'approve'
      ? { action: 'approve-synthetic-benchmark', planHash: plan.planHash, maximumMicroUsd: 10_000_000, chargeMyAiAllowance: true }
      : { action: 'step', planHash: plan.planHash, ordinal: 0 }) }), ...extra,
  });
  const invoke = action => handleNativeMemoryBenchmark(request(action), env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    hooks.fetches++; const input = JSON.parse(options.body);
    return Response.json({ id: 'resp_fixture', object: 'response', model: input.model, status: 'completed', service_tier: 'default',
      output: [{ id: 'msg_fixture', type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: 'output_text', text: JSON.stringify({ entries: [] }), annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return { sqlite, DB, env, hooks, request, invoke, plan };
}

test('disabled handler touches neither native authority nor database', async () => {
  const env = { DB: { prepare() { throw new Error('unexpected DB'); } } };
  assert.equal((await handleNativeMemoryBenchmark(new Request(origin), env)).status, 404);
});

for (const drift of ['missing-trigger', 'changed-trigger', 'unknown-table', 'temporary-object', 'external-dependent'])
  test(`native benchmark refuses incomplete or drifted financial schema: ${drift}`, async t => {
    const f = await fixture(t);
    if (drift === 'missing-trigger' || drift === 'changed-trigger') f.sqlite.exec('DROP TRIGGER memory_benchmark_native_token_no_delete');
    if (drift === 'changed-trigger') f.sqlite.exec('CREATE TRIGGER memory_benchmark_native_token_no_delete BEFORE DELETE ON budget_reservations BEGIN SELECT 1; END;');
    if (drift === 'unknown-table') f.sqlite.exec('CREATE TABLE memory_benchmark_unreviewed(id TEXT)');
    if (drift === 'temporary-object') f.sqlite.exec('CREATE TEMP TABLE memory_benchmark_experiments(id TEXT)');
    if (drift === 'external-dependent') f.sqlite.exec('CREATE TRIGGER unknown_budget_guard AFTER UPDATE ON budget_reservations BEGIN DELETE FROM memory_benchmark_assertions; END;');
    assert.notEqual((await f.invoke('approve')).status, 200);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM main.memory_benchmark_native_grants').get().n, 0);
    assert.equal(f.hooks.fetches, 0);
  });

test('financial schema changing before native reservation cannot authorize provider dispatch', async t => {
  const f = await fixture(t); assert.equal((await f.invoke('approve')).status, 200);
  f.hooks.beforeBatch = () => f.sqlite.exec('DROP TRIGGER memory_benchmark_native_token_no_delete');
  assert.notEqual((await f.invoke('step')).status, 200);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM budget_reservations').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cost_budget_reservations').get().n, 0);
  assert.equal(f.hooks.fetches, 0);
});

test('external financial dependency added after capture invalidates native reservation proof', async t => {
  const f = await fixture(t); assert.equal((await f.invoke('approve')).status, 200);
  f.hooks.beforeBatch = () => f.sqlite.exec('CREATE TRIGGER unknown_budget_guard AFTER UPDATE ON budget_reservations BEGIN DELETE FROM memory_benchmark_assertions; END;');
  assert.notEqual((await f.invoke('step')).status, 200);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM budget_reservations').get().n, 0);
  assert.equal(f.hooks.fetches, 0);
});

test('external qualification is required; approval cannot create qualification or spend', async t => {
  const f = await fixture(t, { qualified: false });
  const response = await f.invoke('approve');
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'benchmark_qualification_missing');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_native_grants').get().n, 0);
  assert.equal(f.hooks.fetches, 0);
});

test('confirmed personal synthetic grant uses real native token/dollar helpers and records exactly one charge', async t => {
  const f = await fixture(t);
  const approved = await f.invoke('approve'); assert.equal(approved.status, 200, JSON.stringify(await approved.clone().json()));
  const step = await f.invoke('step'); assert.equal(step.status, 200, JSON.stringify(await step.clone().json()));
  assert.equal(f.hooks.fetches, 1);
  const tokens = f.sqlite.prepare('SELECT * FROM budget_reservations').get();
  const costs = f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get();
  assert.equal(tokens.stream_id, 'memory-benchmark:owner'); assert.equal(tokens.used_tokens, 120);
  assert.equal(costs.used_microusd, 44); assert.equal(tokens.status, 'settled'); assert.equal(costs.status, 'settled');
  assert.equal((await f.invoke('step')).status, 409); assert.equal(f.hooks.fetches, 1);
  const next = await handleNativeMemoryBenchmark(f.request('step', { body: JSON.stringify({ action: 'step', planHash: f.plan.planHash, ordinal: 1 }) }), f.env);
  assert.equal(next.status, 200, JSON.stringify(await next.clone().json())); assert.equal(f.hooks.fetches, 2);
  const result = await f.invoke('read'); assert.equal(result.status, 200);
  assert.equal((await result.json()).completedOperations, 2);
});

for (const [name, mutation] of [
  ['actor allowlist', f => { f.env.FORMA_MEMORY_BENCHMARK_ACTOR_IDS = 'someone-else'; }],
  ['qualification withdrawal', f => f.sqlite.exec("UPDATE memory_benchmark_native_qualifications SET status='withdrawn'")],
  ['administrator removal', f => f.sqlite.exec("UPDATE users SET role='creator'")],
  ['grant revocation', f => f.sqlite.prepare('UPDATE memory_benchmark_native_grants SET revoked_at=?').run(Date.now())],
]) test(`${name} prevents dispatch`, async t => {
  const f = await fixture(t); assert.equal((await f.invoke('approve')).status, 200); mutation(f);
  assert.notEqual((await f.invoke('step')).status, 200); assert.equal(f.hooks.fetches, 0);
});

test('impersonation, arbitrary payer, duplicate confirmation fields and untrusted origin cannot approve', async t => {
  const f = await fixture(t);
  const good = await f.request('approve').text();
  for (const extra of [ { headers: { cookie: 'forma_impersonation=anything' } },
    { headers: { origin: 'https://elsewhere.test' } },
    { body: good.slice(0, -1) + ',"payerId":"other"}' },
    { body: good.slice(0, -1) + ',"maximumMicroUsd":10000000}' } ]) {
    const response = await handleNativeMemoryBenchmark(f.request('approve', extra), f.env);
    assert.notEqual(response.status, 200);
  }
  assert.equal(f.hooks.fetches, 0);
});

test('unknown provider result retains both native holds against generic release', async t => {
  const f = await fixture(t); assert.equal((await f.invoke('approve')).status, 200);
  globalThis.fetch = async () => { f.hooks.fetches++; throw new Error('unknown transport'); };
  assert.equal((await f.invoke('step')).status, 503); assert.equal(f.hooks.fetches, 1);
  const native = f.sqlite.prepare('SELECT * FROM memory_benchmark_native_operations').get();
  assert.ok(native);
  await assert.rejects(() => releaseBudget(f.env, 'owner', native.token_id), /hold retained/);
  await assert.rejects(() => releaseCostBudget(f.env, 'owner', native.cost_id), /hold retained/);
  assert.equal(f.sqlite.prepare("SELECT reserved_tokens FROM budget_counters WHERE scope='user'").get().reserved_tokens, native.maximum_tokens);
  assert.equal(f.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user'").get().reserved_microusd, native.maximum_micro_usd);
  assert.equal((await f.invoke('step')).status, 409); assert.equal(f.hooks.fetches, 1);
});

test('withdrawal immediately before dispatch claim rolls back the claim and sends nothing', async t => {
  const f = await fixture(t); assert.equal((await f.invoke('approve')).status, 200);
  const base = f.DB.batch;
  f.DB.batch = async statements => {
    if (statements.some(statement => statement.sql.includes('SET dispatch_claimed_at=')))
      f.sqlite.prepare('UPDATE memory_benchmark_native_grants SET revoked_at=?').run(Date.now());
    return base(statements);
  };
  assert.equal((await f.invoke('step')).status, 503); assert.equal(f.hooks.fetches, 0);
  assert.equal(f.sqlite.prepare('SELECT dispatch_claimed_at FROM memory_benchmark_operations').get().dispatch_claimed_at, null);
});

test('provider receipt after grant withdrawal preserves verified usage without releasing exposure', async t => {
  const f = await fixture(t); assert.equal((await f.invoke('approve')).status, 200); const provider = globalThis.fetch;
  globalThis.fetch = async (...args) => { const result = await provider(...args);
    f.sqlite.prepare('UPDATE memory_benchmark_native_grants SET revoked_at=?').run(Date.now()); return result; };
  assert.equal((await f.invoke('step')).status, 503);
  const native = f.sqlite.prepare('SELECT * FROM memory_benchmark_native_operations').get();
  assert.equal(native.verified_tokens, 120); assert.equal(native.verified_micro_usd, 44);
  assert.equal(JSON.parse(native.usage_receipt_json).providerId, 'resp_fixture');
  assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status, 'active');
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status, 'executing');
  delete f.env.FORMA_MEMORY_BENCHMARK_ENABLED;
  const recovered = await handleNativeMemoryBenchmark(new Request(origin + '/api/internal/memory-benchmark/reconcile', {
    method: 'POST', headers: { origin, 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.test' },
  }), f.env);
  assert.equal(recovered.status, 200, JSON.stringify(await recovered.clone().json()));
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status, 'settled');
  assert.equal(f.hooks.fetches, 1);
});

test('lost dispatch acknowledgement sends no provider request and retains both native holds', async t => {
  const f = await fixture(t); assert.equal((await f.invoke('approve')).status, 200);
  const base = f.DB.batch; let lost = false;
  f.DB.batch = async statements => { const result = await base(statements);
    if (!lost && statements.some(statement => statement.sql.includes('SET dispatch_claimed_at='))) { lost = true; throw new Error('lost dispatch ack'); }
    return result; };
  assert.equal((await f.invoke('step')).status, 503); assert.equal(f.hooks.fetches, 0);
  assert.notEqual(f.sqlite.prepare('SELECT dispatch_claimed_at FROM memory_benchmark_operations').get().dispatch_claimed_at, null);
  assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status, 'active');
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status, 'executing');
});

test('partial native settlement reconciles exact verified usage without replay or double charge', async t => {
  const f = await fixture(t); assert.equal((await f.invoke('approve')).status, 200);
  const base = f.DB.batch; let failed = false;
  f.DB.batch = async statements => {
    if (!failed && statements.some(statement => statement.sql.includes('UPDATE cost_budget_counters SET') && statement.sql.includes('used_microusd=used_microusd+'))) {
      failed = true; throw new Error('cost settlement unavailable'); }
    return base(statements);
  };
  assert.equal((await f.invoke('step')).status, 503); assert.equal(f.hooks.fetches, 1);
  assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status, 'settled');
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status, 'executing');
  const reconcile = () => handleNativeMemoryBenchmark(new Request(origin + '/api/internal/memory-benchmark/reconcile', {
    method: 'POST', headers: { origin, 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.test' },
  }), f.env);
  assert.equal((await reconcile()).status, 200); assert.equal((await reconcile()).status, 200);
  assert.equal(f.sqlite.prepare("SELECT used_tokens FROM budget_counters WHERE scope='user'").get().used_tokens, 120);
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user'").get().used_microusd, 44);
  assert.equal(f.sqlite.prepare('SELECT status FROM memory_benchmark_experiments').get().status, 'halted');
  assert.equal(f.hooks.fetches, 1);
});

test('expired synthetic output is purged with disabled flag while financial and grant tombstones survive', async t => {
  const f = await fixture(t); assert.equal((await f.invoke('approve')).status, 200); assert.equal((await f.invoke('step')).status, 200);
  const expires = f.sqlite.prepare('SELECT expires_at FROM memory_benchmark_experiments').get().expires_at;
  t.mock.method(Date, 'now', () => expires + 1000); delete f.env.FORMA_MEMORY_BENCHMARK_ENABLED;
  assert.deepEqual(await purgeExpiredNativeMemoryBenchmark(f.env), { purged: true });
  assert.equal(f.sqlite.prepare('SELECT result_json FROM memory_benchmark_operations').get().result_json, null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_native_grants').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT verified_tokens FROM memory_benchmark_native_operations').get().verified_tokens, 120);
  assert.equal(f.sqlite.prepare('SELECT used_microusd FROM cost_budget_reservations').get().used_microusd, 44);
});

test('SQL replace cannot reset the one-time grant', async t => {
  const f = await fixture(t); assert.equal((await f.invoke('approve')).status, 200);
  const row = f.sqlite.prepare('SELECT * FROM memory_benchmark_native_grants').get();
  assert.throws(() => f.sqlite.prepare(`INSERT OR REPLACE INTO memory_benchmark_native_grants
    (experiment_id,principal_id,payer_id,plan_hash,qualification_id,period,maximum_micro_usd,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(row.experiment_id, 'other', 'other', row.plan_hash, row.qualification_id, row.period,
      row.maximum_micro_usd, row.created_at, row.expires_at), /cannot replace/);
  assert.equal((await f.invoke('approve')).status, 200);
});

test('cleanup is independent of enabled flag and absent schema is a no-op', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const env = { DB: { prepare(sql) { return { async first() { return sqlite.prepare(sql).get(); } }; } } };
    assert.deepEqual(await purgeExpiredNativeMemoryBenchmark(env), { purged: false });
    sqlite.exec('CREATE TABLE memory_benchmark_experiments(experiment_id TEXT)');
    await assert.rejects(() => purgeExpiredNativeMemoryBenchmark(env), /cleanup_schema_incomplete/);
  } finally { sqlite.close(); }
});

const releaseUndispatchedRequest = () => new Request(origin + '/api/internal/memory-benchmark/release-undispatched', {
  method: 'POST', headers: { origin, 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.test' },
});

async function stoppedBeforeDispatch(t, stage = 'dispatch') {
  const f = await fixture(t); assert.equal((await f.invoke('approve')).status, 200);
  const base = f.DB.batch; let stopped = false;
  f.DB.batch = async statements => {
    const match = stage === 'cost-reserve' ? statements.some(statement => /INSERT(?: OR IGNORE)? INTO cost_budget_reservations /.test(statement.sql))
      : statements.some(statement => statement.sql.includes('SET dispatch_claimed_at='));
    if (!stopped && match) { stopped = true; throw new Error('synthetic pre-dispatch interruption'); }
    return base(statements);
  };
  assert.equal((await f.invoke('step')).status, 503); assert.equal(f.hooks.fetches, 0);
  assert.equal(f.sqlite.prepare('SELECT status FROM memory_benchmark_experiments').get().status, 'halted');
  assert.equal(f.sqlite.prepare('SELECT dispatch_claimed_at FROM memory_benchmark_operations').get().dispatch_claimed_at, null);
  f.DB.batch = base;
  f.release = () => handleNativeMemoryBenchmark(releaseUndispatchedRequest(), f.env);
  return f;
}

test('stopped unclaimed operation releases native holds with an immutable disposition, no fabricated usage or restart', async t => {
  const f = await stoppedBeforeDispatch(t); delete f.env.FORMA_MEMORY_BENCHMARK_ENABLED;
  f.sqlite.prepare('UPDATE memory_benchmark_native_grants SET revoked_at=?').run(Date.now());
  const before = { ...f.sqlite.prepare('SELECT * FROM memory_benchmark_experiments').get() };
  const result = await f.release(); assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  assert.equal((await f.release()).status, 200);
  const native = f.sqlite.prepare('SELECT * FROM memory_benchmark_native_operations').get();
  assert.equal(native.verified_tokens, null); assert.equal(native.usage_receipt_json, null);
  assert.deepEqual({ ...f.sqlite.prepare('SELECT * FROM memory_benchmark_experiments').get() }, before);
  assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status, 'released');
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status, 'released');
  assert.equal(f.sqlite.prepare("SELECT reserved_tokens FROM budget_counters WHERE scope='user'").get().reserved_tokens, 0);
  assert.equal(f.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user'").get().reserved_microusd, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_native_dispositions').get().n, 1);
  assert.throws(() => f.sqlite.exec('DELETE FROM memory_benchmark_native_dispositions'), /cannot reset/);
  assert.throws(() => f.sqlite.exec("UPDATE memory_benchmark_native_dispositions SET recorded_at=recorded_at+1"), /immutable/);
  assert.throws(() => f.sqlite.exec('INSERT OR REPLACE INTO memory_benchmark_native_dispositions SELECT * FROM memory_benchmark_native_dispositions'), /cannot replace|proof unavailable/);
  assert.equal(f.hooks.fetches, 0);
});

test('token-only admission records absent cost and permanently blocks delayed native reservation', async t => {
  const f = await stoppedBeforeDispatch(t, 'cost-reserve');
  const response = await f.release(); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).dollarHold, 'never-reserved');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cost_budget_reservations').get().n, 0);
  const native = f.sqlite.prepare('SELECT * FROM memory_benchmark_native_operations').get();
  const { reserveCostBudget } = await import(path.join(foundation, 'worker/pilot-policy.ts'));
  await assert.rejects(() => reserveCostBudget(f.env, 'owner', native.maximum_micro_usd, {
    maximumMicrousd: native.maximum_micro_usd, allowUserOverage: false, reservationId: native.cost_id,
    period: native.period, streamId: 'memory-benchmark:owner', correlationId: native.binding_id, operation: 'memory-benchmark:' + native.model,
  }), /reservation prohibited/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cost_budget_reservations').get().n, 0);
  assert.equal(f.hooks.fetches, 0);
});

test('concurrent exact no-dispatch releases decrement each native counter only once', async t => {
  const f = await stoppedBeforeDispatch(t);
  const responses = await Promise.all([f.release(), f.release()]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_native_dispositions').get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT reserved_tokens,used_tokens FROM budget_counters WHERE scope='user'").get().reserved_tokens, 0);
  assert.equal(f.sqlite.prepare("SELECT reserved_microusd,used_microusd FROM cost_budget_counters WHERE scope='user'").get().reserved_microusd, 0);
  assert.equal(f.hooks.fetches, 0);
});

for (const phase of ['disposition', 'token-release', 'dollar-release']) test(`lost ${phase} acknowledgement recovers only the original zero-charge disposition`, async t => {
  const f = await stoppedBeforeDispatch(t), base = f.DB.batch; let lost = false;
  f.DB.batch = async statements => {
    const result = await base(statements);
    const match = phase === 'disposition' ? statements.some(statement => statement.sql.includes('INSERT INTO memory_benchmark_native_dispositions'))
      : phase === 'token-release' ? statements.some(statement => statement.sql.includes('UPDATE budget_reservations SET used_tokens='))
        : statements.some(statement => statement.sql.includes('UPDATE cost_budget_reservations SET used_microusd='));
    if (!lost && match) { lost = true; throw new Error('lost definitive no-dispatch acknowledgement'); }
    return result;
  };
  assert.equal((await f.release()).status, 503);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_native_dispositions').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status, phase === 'dollar-release' ? 'released' : 'executing');
  assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status, phase === 'disposition' ? 'active' : 'released');
  assert.equal((await f.release()).status, 200); assert.equal((await f.release()).status, 200);
  assert.equal(f.sqlite.prepare('SELECT used_tokens FROM budget_reservations').get().used_tokens, 0);
  assert.equal(f.sqlite.prepare('SELECT used_microusd FROM cost_budget_reservations').get().used_microusd, 0);
  assert.equal(f.hooks.fetches, 0);
});

test('claimed unknown charge cannot obtain no-dispatch disposition or release', async t => {
  const f = await fixture(t); assert.equal((await f.invoke('approve')).status, 200);
  globalThis.fetch = async () => { f.hooks.fetches++; throw new Error('provider outcome unknown'); };
  assert.equal((await f.invoke('step')).status, 503);
  const response = await handleNativeMemoryBenchmark(releaseUndispatchedRequest(), f.env);
  assert.equal(response.status, 409); assert.equal(f.hooks.fetches, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_native_dispositions').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status, 'active');
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status, 'executing');
});

test('principal withdrawal racing disposition commit preserves both original holds', async t => {
  const f = await stoppedBeforeDispatch(t), base = f.DB.batch; let withdrawn = false;
  f.DB.batch = async statements => {
    if (!withdrawn && statements.some(statement => statement.sql.includes('INSERT INTO memory_benchmark_native_dispositions'))) {
      withdrawn = true; f.sqlite.exec("UPDATE users SET role='creator'");
    }
    return base(statements);
  };
  assert.equal((await f.release()).status, 503);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_native_dispositions').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status, 'active');
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status, 'executing');
});

test('a disposed operation cannot acquire dispatch or a fictional provider usage receipt', async t => {
  const f = await stoppedBeforeDispatch(t); assert.equal((await f.release()).status, 200);
  assert.throws(() => f.sqlite.prepare('UPDATE memory_benchmark_operations SET dispatch_claimed_at=?,dispatch_claim_token=?,updated_at=?')
    .run(Date.now(), crypto.randomUUID(), Date.now()), /dispatch authority unavailable|immutable benchmark operation/);
  assert.throws(() => f.sqlite.exec(`UPDATE memory_benchmark_native_operations SET verified_tokens=1,verified_micro_usd=1,usage_receipt_json='{}'`), /provider usage prohibited/);
  assert.equal(f.hooks.fetches, 0);
});
