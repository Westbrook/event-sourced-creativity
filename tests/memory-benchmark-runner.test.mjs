import assert from 'node:assert/strict';
import test from 'node:test';
import { createBenchmarkDb } from './helpers/memory-benchmark-db.mjs';
import { BenchmarkLedger } from '../worker/memory-benchmark/ledger.ts';
import { benchmarkPlan, EXPERIMENT_ID, handleMemoryBenchmark, operationAt, TOTAL_OPERATIONS } from '../worker/memory-benchmark/runner.ts';

globalThis.fetch = async () => { throw new Error('external_network_forbidden'); };
const origin = 'https://benchmark.example.test';
const path = '/api/internal/memory-benchmark';
const now = Date.parse('2026-09-04T12:00:00Z');

async function fixture(t) {
  const database = createBenchmarkDb(); t.after(database.close);
  const ledger = new BenchmarkLedger(database.DB), plan = await benchmarkPlan();
  let currentGrant = { principalId: 'fixture-admin', payerId: 'fixture-benchmark', period: '2026-09',
    expiresAt: now + 3_600_000, approvedPlanHash: plan.planHash, approvedMaximumMicroUsd: 10_000_000, qualificationId: 'isolated-test-only' };
  const calls = [], reservations = [], settlements = [];
  const env = { FORMA_MEMORY_BENCHMARK_ENABLED: '1', FORMA_MEMORY_BENCHMARK_ORIGIN: origin, OPENAI_API_KEY: 'synthetic-test-placeholder' };
  const dependencies = { ledger, now: () => now, authorize: async () => currentGrant,
    reserveAllowance: async input => { reservations.push(input); return { id: `reservation:${input.operationId}`, maximumMicroUsd: input.maximumMicroUsd,
      maximumTokens: input.maximumInputTokens + input.maximumOutputTokens }; },
    settleAllowance: async input => { settlements.push(input); return { confirmed: true }; },
    fetcher: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, body });
      if (url.endsWith('/embeddings')) return Response.json({ model: body.model, object: 'list',
        data: body.input.map((_, index) => ({ object: 'embedding', index, embedding: Array.from({ length: 512 }, (_, offset) => offset === 0 ? 1 : 0) })),
        usage: { prompt_tokens: 100, total_tokens: 100 } });
      const input = JSON.parse(body.input);
      const output = Object.hasOwn(input, 'day')
        ? { entries: [...input.previous, ...input.changes.map(fact => ({ text: fact.text, factIds: [fact.id] }))] }
        : { answer: 'The supplied context is insufficient.', factIds: [], abstain: true };
      return Response.json({ id: `resp_synthetic_${calls.length}`, object: 'response', model: body.model, status: 'completed', service_tier: 'default',
        output: [{ id: `msg_synthetic_${calls.length}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
    },
  };
  const request = (action = 'step', ordinal = 0, options = {}) => new Request(`${origin}${path}`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...options.headers },
    body: JSON.stringify(action === 'halt' ? { action, planHash: plan.planHash } : { action, planHash: plan.planHash, ordinal }), ...options,
  });
  const invoke = request => handleMemoryBenchmark(request, env, dependencies);
  return { ...database, ledger, plan, calls, reservations, settlements, env, dependencies, request, invoke,
    setGrant: grant => { currentGrant = grant; }, grant: currentGrant };
}

test('benchmark runner: disabled by default without touching authority, DB or provider', async t => {
  const f = await fixture(t); delete f.env.FORMA_MEMORY_BENCHMARK_ENABLED;
  f.dependencies.authorize = async () => { throw new Error('must not authenticate disabled route'); };
  assert.equal((await f.invoke(f.request())).status, 404);
  assert.equal(f.hooks.batches, 0); assert.equal(f.calls.length, 0);
});

test('benchmark runner: read-only plan exposes fixed price ceilings without creating a run', async t => {
  const f = await fixture(t), result = await f.invoke(new Request(`${origin}${path}`)), body = await result.json();
  assert.equal(result.status, 200); assert.equal(body.status, null);
  assert.equal(body.plan.maximumMicroUsd, 10_000_000); assert.equal(body.plan.plannedMaximumProviderMicroUsd, 2_068_000);
  assert.equal(body.plan.totalOperations, 340); assert.equal(body.recommendedMonthlyCap, null);
  assert.equal(f.hooks.batches, 0); assert.equal(f.calls.length, 0);
});

for (const [name, url, method, headers] of [
  ['different origin', 'https://other.example.test' + path, 'GET', {}],
  ['HTTP', 'http://benchmark.example.test' + path, 'GET', {}],
  ['query parameters', origin + path + '?userId=real', 'GET', {}],
  ['different route', origin + '/api/replay-sessions', 'GET', {}],
  ['unsupported method', origin + path, 'DELETE', {}],
  ['missing Origin', origin + path, 'POST', { 'content-type': 'application/json' }],
  ['cross-site metadata', origin + path, 'POST', { origin, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }],
]) test(`benchmark runner: rejects ${name} before side effects`, async t => {
  const f = await fixture(t); let auth = 0; f.dependencies.authorize = async () => { auth++; return f.grant; };
  const result = await f.invoke(new Request(url, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) }));
  assert.ok([400, 403].includes(result.status)); assert.equal(auth, 0); assert.equal(f.hooks.batches, 0); assert.equal(f.calls.length, 0);
});

for (const invalid of [null, { principalId: '' }, { approvedMaximumMicroUsd: 20_000_000 }, { expiresAt: now },
  { period: '2026-08' }, { approvedPlanHash: 'f'.repeat(64) }, { qualificationId: '' }])
  test(`benchmark runner: invalid grant ${JSON.stringify(invalid)}`, async t => {
    const f = await fixture(t); f.setGrant(invalid === null ? null : { ...f.grant, ...invalid });
    assert.equal((await f.invoke(f.request())).status, 403); assert.equal(f.hooks.batches, 0); assert.equal(f.calls.length, 0);
  });

test('benchmark runner: rejects arbitrary prompts, IDs, duplicate keys and oversized payloads', async t => {
  const f = await fixture(t);
  const bodies = [JSON.stringify({ action: 'step', planHash: f.plan.planHash, ordinal: 0, prompt: 'real user text' }),
    `{"action":"step","planHash":"${f.plan.planHash}","ordinal":0,"ordinal":1}`,
    JSON.stringify({ action: 'step', planHash: f.plan.planHash, ordinal: 340 }), ' '.repeat(513),
    JSON.stringify({ action: 'step', planHash: f.plan.planHash, ordinal: 0, model: 'arbitrary' })];
  for (const body of bodies) assert.equal((await f.invoke(f.request('step', 0, { body }))).status, 400);
  assert.equal(f.hooks.batches, 0); assert.equal(f.calls.length, 0);
});

test('benchmark runner: absent key or native billing adapter cannot initialize or dispatch', async t => {
  const f = await fixture(t); delete f.env.OPENAI_API_KEY;
  assert.equal((await f.invoke(f.request())).status, 503); assert.equal(f.hooks.batches, 0);
  f.env.OPENAI_API_KEY = 'synthetic-test-placeholder'; delete f.dependencies.reserveAllowance;
  assert.equal((await f.invoke(f.request())).status, 503); assert.equal(f.hooks.batches, 0); assert.equal(f.calls.length, 0);
});

test('benchmark runner: reserves native allowance before one call and durably settles the receipt', async t => {
  const f = await fixture(t), result = await f.invoke(f.request());
  assert.equal(result.status, 200, await result.clone().text());
  assert.equal(f.calls.length, 1); assert.equal(f.reservations.length, 1); assert.equal(f.settlements.length, 1);
  assert.equal(f.reservations[0].operationId, 'review:luna:1');
  const status = await f.ledger.status(EXPERIMENT_ID);
  assert.equal(status.reservedMicroUsd, 0); assert.ok(status.spentMicroUsd > 0); assert.equal(status.nextOrdinal, 1);
});

test('benchmark runner: duplicate request does not advance to another provider operation', async t => {
  const f = await fixture(t);
  assert.equal((await f.invoke(f.request())).status, 200);
  assert.equal((await f.invoke(f.request())).status, 409); assert.equal(f.calls.length, 1);
  assert.equal((await f.invoke(f.request('step', 1))).status, 200); assert.equal(f.calls.length, 2);
});

test('benchmark runner: concurrent step requests dispatch at most once', async t => {
  const f = await fixture(t);
  const result = await Promise.all([f.invoke(f.request()), f.invoke(f.request())]);
  assert.equal(result.filter(response => response.status === 200).length, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.settlements.length, 1);
});

test('benchmark runner: authority withdrawal after reservation stops before provider and holds exposure', async t => {
  const f = await fixture(t);
  f.dependencies.reserveAllowance = async input => { f.setGrant(null); return { id: 'reservation:withdrawn', maximumMicroUsd: input.maximumMicroUsd,
    maximumTokens: input.maximumInputTokens + input.maximumOutputTokens }; };
  assert.equal((await f.invoke(f.request())).status, 503); assert.equal(f.calls.length, 0);
  const status = await f.ledger.status(EXPERIMENT_ID); assert.equal(status.status, 'halted'); assert.ok(status.reservedMicroUsd > 0);
});

test('benchmark runner: unconfirmed native reservation cannot reach provider', async t => {
  const f = await fixture(t); f.dependencies.reserveAllowance = async () => ({ id: 'bad', maximumMicroUsd: 1 });
  assert.equal((await f.invoke(f.request())).status, 503); assert.equal(f.calls.length, 0);
  assert.equal((await f.ledger.status(EXPERIMENT_ID)).status, 'halted');
});

test('benchmark runner: native adapter cannot mutate the captured grant across awaits', async t => {
  const f = await fixture(t);
  f.dependencies.reserveAllowance = async input => {
    f.grant.payerId = 'changed-payer';
    return { id: 'reservation:changed', maximumMicroUsd: input.maximumMicroUsd,
      maximumTokens: input.maximumInputTokens + input.maximumOutputTokens };
  };
  assert.equal((await f.invoke(f.request())).status, 503); assert.equal(f.calls.length, 0);
  assert.equal((await f.ledger.status(EXPERIMENT_ID)).payerId, 'fixture-benchmark');
});

for (const phase of ['provider', 'accounting']) test(`benchmark runner: uncertain ${phase} cannot retry or refund exposure`, async t => {
  const f = await fixture(t);
  if (phase === 'provider') f.dependencies.fetcher = async () => { f.calls.push({ failed: true }); throw new Error('synthetic-sensitive-error-never-echo'); };
  else f.dependencies.settleAllowance = async () => { throw new Error('synthetic-sensitive-error-never-echo'); };
  const first = await f.invoke(f.request()), body = await first.text();
  assert.equal(first.status, 503); assert.ok(!body.includes('synthetic-sensitive-error'));
  assert.equal((await f.invoke(f.request())).status, 409); assert.equal(f.calls.length, 1);
  const status = await f.ledger.status(EXPERIMENT_ID); assert.equal(status.status, 'halted'); assert.ok(status.reservedMicroUsd > 0);
});

test('benchmark runner: changed payer cannot access or resume an existing run', async t => {
  const f = await fixture(t); assert.equal((await f.invoke(f.request())).status, 200);
  f.setGrant({ ...f.grant, payerId: 'different-payer' });
  assert.equal((await f.invoke(new Request(origin + path))).status, 409);
  assert.equal((await f.invoke(f.request('step', 1))).status, 409); assert.equal(f.calls.length, 1);
});

test('benchmark runner: operator halt is terminal and does not invoke provider', async t => {
  const f = await fixture(t); assert.equal((await f.invoke(f.request())).status, 200);
  assert.equal((await f.invoke(f.request('halt'))).status, 200);
  assert.equal((await f.invoke(f.request('step', 1))).status, 409); assert.equal(f.calls.length, 1);
});

test('benchmark runner: fixed synthetic graph completes under mock transport without claiming a cap', async t => {
  const f = await fixture(t);
  for (let ordinal = 0; ordinal < TOTAL_OPERATIONS; ordinal++) {
    const result = await f.invoke(f.request('step', ordinal));
    assert.equal(result.status, 200, `ordinal ${ordinal}: ${await result.clone().text()}`);
  }
  const final = await f.invoke(new Request(origin + path)), body = await final.json();
  assert.equal(final.status, 200); assert.equal(body.status.status, 'complete'); assert.equal(body.completedOperations, 340);
  assert.equal(body.scores.length, 200); assert.equal(body.recommendedMonthlyCap, null);
  assert.equal(f.calls.filter(call => call.url.endsWith('/embeddings')).length, 100);
  assert.equal(f.calls.filter(call => call.url.endsWith('/responses')).length, 240);
  assert.equal(body.status.reservedMicroUsd, 0); assert.ok(body.status.spentMicroUsd < 10_000_000);
  assert.equal(Object.values(body.costs.groups).reduce((sum, group) => sum + group.microUsd, 0), body.status.spentMicroUsd);
  assert.equal(Object.values(body.costs.groups).reduce((sum, group) => sum + group.calls, 0), 340);
  assert.ok(body.scores.every(score => typeof score.answer.answer === 'string'));
  assert.equal(f.reservations.length, 340); assert.equal(f.settlements.length, 340);
  assert.equal((await f.invoke(f.request('step', 339))).status, 409); assert.equal(f.calls.length, 340);
});

test('benchmark runner: invalid or out-of-range operation ordinals never build work', () => {
  for (const ordinal of [-1, 0.1, NaN, Infinity, 341]) assert.throws(() => operationAt(ordinal, new Map()));
  assert.equal(operationAt(340, new Map()), null);
});

test('benchmark runner: halt during native reservation prevents the dispatch claim', async t => {
  const f = await fixture(t);
  f.dependencies.reserveAllowance = async input => {
    await f.ledger.halt({ experimentId: EXPERIMENT_ID, reason: 'operator_stop', now });
    return { id: 'reservation:stopped', maximumMicroUsd: input.maximumMicroUsd,
      maximumTokens: input.maximumInputTokens + input.maximumOutputTokens };
  };
  assert.equal((await f.invoke(f.request())).status, 503); assert.equal(f.calls.length, 0);
  const status = await f.ledger.status(EXPERIMENT_ID); assert.equal(status.status, 'halted'); assert.ok(status.reservedMicroUsd > 0);
});

test('benchmark runner: lost reservation acknowledgement never reaches native billing or provider', async t => {
  const f = await fixture(t), reserve = f.ledger.reserve.bind(f.ledger);
  f.ledger.reserve = async input => { f.hooks.loseBatchAcknowledgement = true; return reserve(input); };
  assert.equal((await f.invoke(f.request())).status, 409);
  assert.equal(f.calls.length, 0); assert.equal(f.reservations.length, 0);
  assert.ok((await f.ledger.status(EXPERIMENT_ID)).reservedMicroUsd > 0);
});

test('benchmark runner: revoked authority after settlement receives no receipt body', async t => {
  const f = await fixture(t); f.dependencies.settleAllowance = async () => { f.setGrant(null); return { confirmed: true }; };
  const result = await f.invoke(f.request());
  assert.equal(result.status, 403); assert.deepEqual(await result.json(), { error: 'benchmark_authority_changed' });
  assert.equal(f.calls.length, 1); assert.equal((await f.ledger.status(EXPERIMENT_ID)).reservedMicroUsd, 0);
});

test('benchmark runner: current source text replaces oversized or wrong-scope generated prose', () => {
  const result = { kind: 'review', entries: [{ factIds: ['f01'], text: 'Ivo owns Grove. '.repeat(250) }] };
  const nextReview = operationAt(2, new Map([[0, result]]));
  assert.ok(!String(nextReview.input).includes('Grove')); assert.ok(!String(nextReview.input).includes('withdrawnDay'));
  const embedding = operationAt(42, new Map([[38, result]]));
  assert.ok(embedding.input.every(text => !text.includes('Grove')));
  assert.ok(embedding.input.some(text => text.includes('two sentences')));
});

test('benchmark runner: intermediate and later receipts are bound to exact requests and accounted cost', async t => {
  const f = await fixture(t); assert.equal((await f.invoke(f.request())).status, 200);
  const original = f.ledger.results.bind(f.ledger);
  for (const replacement of [{ requestHash: 'f'.repeat(64) }, { actualMicroUsd: 999999 }]) {
    f.ledger.results = async id => (await original(id)).map(row => ({ ...row, ...replacement }));
    assert.equal((await f.invoke(f.request('step', 1))).status, 503);
  }
  assert.equal(f.calls.length, 1);
});

test('benchmark runner: uncited privacy canary halts after accounting and before the next call', async t => {
  const f = await fixture(t);
  for (let ordinal = 0; ordinal < 40; ordinal++) assert.equal((await f.invoke(f.request('step', ordinal))).status, 200);
  const provider = f.dependencies.fetcher;
  f.dependencies.fetcher = async (...args) => {
    const envelope = await (await provider(...args)).json();
    envelope.output[0].content[0].text = JSON.stringify({ answer: 'Taro is the owner.', factIds: [], abstain: true });
    return Response.json(envelope);
  };
  const result = await f.invoke(f.request('step', 40));
  assert.equal(result.status, 409); assert.equal((await f.ledger.status(EXPERIMENT_ID)).status, 'halted');
  assert.equal((await f.invoke(f.request('step', 41))).status, 409); assert.equal(f.calls.length, 41);
  assert.equal(f.settlements.length, 41);
});

test('benchmark runner: concurrent next step cannot advance past a settled privacy failure', async t => {
  const f = await fixture(t);
  for (let ordinal = 0; ordinal < 40; ordinal++) assert.equal((await f.invoke(f.request('step', ordinal))).status, 200);
  const provider = f.dependencies.fetcher;
  f.dependencies.fetcher = async (...args) => {
    const envelope = await (await provider(...args)).json();
    envelope.output[0].content[0].text = JSON.stringify({ answer: 'Taro is the owner.', factIds: [], abstain: true });
    return Response.json(envelope);
  };
  const settle = f.ledger.settle.bind(f.ledger);
  f.ledger.settle = async input => {
    await settle(input);
    if (input.operationId.startsWith('answer:none:')) {
      const competing = await f.invoke(f.request('step', 41));
      assert.equal(competing.status, 409); assert.equal(f.calls.length, 41);
    }
  };
  assert.equal((await f.invoke(f.request('step', 40))).status, 409);
  assert.equal((await f.ledger.status(EXPERIMENT_ID)).status, 'halted'); assert.equal(f.calls.length, 41);
});

test('benchmark runner: privacy-failure response rechecks withdrawn authority', async t => {
  const f = await fixture(t);
  for (let ordinal = 0; ordinal < 40; ordinal++) assert.equal((await f.invoke(f.request('step', ordinal))).status, 200);
  const provider = f.dependencies.fetcher;
  f.dependencies.fetcher = async (...args) => {
    const envelope = await (await provider(...args)).json();
    envelope.output[0].content[0].text = JSON.stringify({ answer: 'Taro is the owner.', factIds: [], abstain: true });
    return Response.json(envelope);
  };
  f.dependencies.settleAllowance = async () => { f.setGrant(null); return { confirmed: true }; };
  const result = await f.invoke(f.request('step', 40));
  assert.equal(result.status, 403); assert.deepEqual(await result.json(), { error: 'benchmark_authority_changed' });
});

test('benchmark runner: operator-halt response rechecks withdrawn authority', async t => {
  const f = await fixture(t); assert.equal((await f.invoke(f.request())).status, 200);
  const halt = f.ledger.halt.bind(f.ledger);
  f.ledger.halt = async input => { await halt(input); f.setGrant(null); };
  const result = await f.invoke(f.request('halt'));
  assert.equal(result.status, 403); assert.deepEqual(await result.json(), { error: 'benchmark_authority_changed' });
});

test('benchmark runner: tiny qualified vectors preserve finite cosine ranking', () => {
  const vector = (x, y) => [x, y, ...Array(510).fill(0)];
  const results = new Map([
    [38, { kind: 'review', entries: [{ factIds: ['f01'], text: 'unused prose' }, { factIds: ['f04'], text: 'unused prose' }] }],
    [42, { kind: 'embedding', vectors: [vector(1e-161, 0), vector(0.5e-161, 1e-161), vector(1e-161, 0)] }],
  ]);
  const operation = operationAt(43, results), context = JSON.parse(operation.input).context;
  assert.deepEqual(context[0].factIds, ['f01']);
});
