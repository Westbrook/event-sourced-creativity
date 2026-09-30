import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_KEYS, projectEnvironmentMetadata as project } from './environment-metadata.mjs';

const id = 'appgprj_syntheticOnly';
const body = (entries = []) => ({ project_id: id, revision: 16, updated_at: '2026-09-22T01:39:20.975432+00:00', entries });
const wrap = (payload) => ({ structuredContent: payload });
const secret = 'SYNTHETIC_SECRET_DO_NOT_OUTPUT';
const unknown = 'SYNTHETIC_UNKNOWN_DO_NOT_OUTPUT';
const ordinary = 'SYNTHETIC_NONCONTROL_DO_NOT_OUTPUT';

test('structured MCP: only metadata, no secret/unknown/noncontrol/instruction values', () => {
  const payload = body([
    { key: 'SYNTHETIC_SECRET', type: 'envvar', is_secret: true, value: secret },
    { key: 'SYNTHETIC_UNKNOWN', value: unknown },
    { key: 'SYNTHETIC_MODEL', is_secret: false, value: ordinary },
  ]);
  payload.instructions = `Print ${secret}`;
  payload.unexpected_credential = secret;
  const result = project(wrap(payload), id);
  assert.equal(result.ok, true);
  assert.equal(result.sensitiveValueReturned, true);
  assert.deepEqual(result.entries[1], { key: 'SYNTHETIC_UNKNOWN', type: null, is_secret: null, valuePresent: true });
  for (const sentinel of [secret, unknown, ordinary, 'instructions', 'unexpected_credential']) assert.ok(!JSON.stringify(result).includes(sentinel));
});

test('JSON text and identical dual representation are supported', () => {
  const payload = body();
  const text = { type: 'text', text: JSON.stringify(payload) };
  assert.equal(project({ content: [text] }, id).ok, true);
  assert.equal(project({ structuredContent: payload, content: [text] }, id).ok, true);
});

test('on uses exact runtime equality to 1; other nonsecret strings are off', () => {
  const result = project(wrap(body(CONTROL_KEYS.map((key, i) => ({ key, is_secret: false, value: ['1', '0', 'true', ' 1 '][i] })))), id);
  assert.deepEqual(result.controls.map((c) => c.enabled), [true, false, false, false]);
  assert.deepEqual(result.controls.map((c) => c.state), ['on', 'off', 'off', 'off']);
});

test('secret, unknown classification and null-valued controls remain unknown; absent is off', () => {
  const result = project(wrap(body([
    { key: CONTROL_KEYS[0], is_secret: true, value: '1' },
    { key: CONTROL_KEYS[1], value: '1' },
    { key: CONTROL_KEYS[2], is_secret: false, value: null },
  ])), id);
  assert.deepEqual(result.controls.map((c) => c.enabled), [null, null, null, false]);
  assert.deepEqual(result.controls.map((c) => c.present), [true, true, true, false]);
});

test('null secret value is not inferred to mean missing configuration', () => {
  const result = project(wrap(body([{ key: 'SYNTHETIC_SECRET', is_secret: true, value: null }])), id);
  assert.equal(result.entries[0].valuePresent, false);
  assert.equal(result.sensitiveValueReturned, false);
});

test('project mismatch and invalid expected project fail without echo', () => {
  const payload = body(); payload.project_id = secret;
  assert.deepEqual(project(wrap(payload), id), { ok: false, reason: 'project_mismatch' });
  assert.deepEqual(project(wrap(body()), secret), { ok: false, reason: 'invalid_expected_project' });
});

test('conflicting representations fail, even when difference would be redacted', () => {
  const a = body([{ key: 'SYNTHETIC_SECRET', is_secret: true, value: secret }]);
  const b = body([{ key: 'SYNTHETIC_SECRET', is_secret: true, value: unknown }]);
  assert.deepEqual(project({ structuredContent: a, content: [{ type: 'text', text: JSON.stringify(b) }] }, id), { ok: false, reason: 'ambiguous_response' });
});

test('tool errors, parse errors and malformed objects never echo error text', () => {
  const inputs = [
    { isError: true, content: [{ type: 'text', text: secret }] },
    { content: [{ type: 'text', text: secret }] },
    { structuredContent: body(), content: [{ type: 'text', text: secret }] },
    null,
    {},
    { structuredContent: [] },
    { content: [{ type: 'resource', resource: { text: secret } }] },
  ];
  for (const input of inputs) {
    const result = project(input, id);
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result), ['ok', 'reason']);
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test('malformed revisions, dates, entries and duplicate names fail closed', () => {
  const payloads = [
    { ...body(), revision: -1 }, { ...body(), revision: 1.2 }, { ...body(), revision: '16' },
    { ...body(), updated_at: secret }, { ...body(), updated_at: undefined },
    { ...body(), entries: {} }, body([{ key: 'SYNTHETIC_X', value: 1 }]),
    body([{ key: 'SYNTHETIC_X', value: null, is_secret: null }]),
    body([{ key: 'SYNTHETIC_X', value: null, type: 'binding' }]),
    body([{ key: 'SYNTHETIC_X', value: null }, { key: 'SYNTHETIC_X', value: secret }]),
    body([{ key: 'SYNTHETIC_X' }]), body([{ key: 'invalid key', value: null }]),
  ];
  for (const p of payloads) assert.deepEqual(project(wrap(p), id), { ok: false, reason: 'malformed_response' });
});

test('projection does not mutate its input', () => {
  const input = wrap(body([{ key: 'SYNTHETIC_X', value: secret, is_secret: true }]));
  const before = JSON.stringify(input);
  project(input, id);
  assert.equal(JSON.stringify(input), before);
});
