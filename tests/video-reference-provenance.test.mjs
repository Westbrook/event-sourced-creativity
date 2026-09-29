import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { provenanceFixtures, fixtureInput, captureVideo } from './helpers/video-reference-provenance.mjs';
import { adaptVideoPrompt } from '../worker/video-prompt-adapter.ts';
import { VIDEO_ADAPTER_CONTRACT } from '../src/model/video-adapter.ts';

const readEvidence = async name => JSON.parse(await readFile(new URL(`../docs/evidence/video-reference-provenance/${name}.json`, import.meta.url), 'utf8'));
const before = await readEvidence('before');
const after = await readEvidence('after');
const exactDiff = await readEvidence('exact-diff');
const originSection = prompt => prompt.match(/REFERENCE PROVENANCE\n[^\n]+/u)?.[0];
const withoutOrigin = prompt => prompt.replace(originSection(prompt), '<reference origin>');
const stableCall = call => {
  if (call.url.endsWith('/reference-to-video')) return { ...call, body: '<request>' };
  if (call.url.includes('/storage/upload/initiate')) {
    const body = JSON.parse(call.body);
    assert.match(body.file_name, /^\d+\.png$/u);
    return { ...call, body: { ...body, file_name: '<SDK timestamp>.png' } };
  }
  return call;
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

for (const fixture of provenanceFixtures) test(`Video provenance request bytes: ${fixture.id}`, async () => {
  const { calls, prepared, result, submissions } = await captureVideo(fixture);
  const old = before.captures.find(c => c.fixture === fixture.id);
  const expected = after.captures.find(c => c.fixture === fixture.id);
  const queueCalls = calls.filter(c => c.url.endsWith('/reference-to-video'));
  assert.equal(queueCalls.length, 1);
  const bytes = Buffer.from(queueCalls[0].body, 'utf8');
  assert.deepEqual(bytes, Buffer.from(expected.requestBody, 'utf8'), 'exact provider-facing UTF-8 bytes');
  const diff = exactDiff.diffs.find(d => d.fixture === fixture.id);
  const oldBytes = Buffer.from(old.requestBody, 'utf8');
  const removed = Buffer.from(diff.removedHex, 'hex');
  assert.equal(sha256(oldBytes), diff.beforeSha256);
  assert.equal(sha256(bytes), diff.afterSha256);
  assert.equal(oldBytes.length, diff.beforeBytes);
  assert.equal(bytes.length, diff.afterBytes);
  assert.deepEqual(oldBytes.subarray(diff.offsetBytes, diff.offsetBytes + removed.length), removed);
  assert.deepEqual(Buffer.concat([oldBytes.subarray(0, diff.offsetBytes), Buffer.from(diff.insertedHex, 'hex'), oldBytes.subarray(diff.offsetBytes + removed.length)]), bytes);
  const request = JSON.parse(bytes), oldRequest = JSON.parse(old.requestBody);
  assert.notEqual(request.prompt, oldRequest.prompt);
  assert.equal(withoutOrigin(request.prompt), withoutOrigin(oldRequest.prompt), 'every other prompt section unchanged');
  assert.deepEqual({ ...request, prompt: null }, { ...oldRequest, prompt: null }, 'routing payload, pixels, duration and audio fixed');
  assert.deepEqual(calls.map(stableCall), old.calls.map(stableCall), 'same uploads, original result routes, call order/count; SDK filename clock excluded');
  assert.equal(calls.length, 8, 'two upload initiations, two pixel uploads, one submission, status, result, download');
  assert.equal(submissions.length, 3);
  assert.deepEqual(submissions.map(s => s.status), ['pending', 'accepted', 'completed']);
  assert.equal(submissions[1].providerRequestId, 'fixture-original');
  assert.equal(submissions[2].costMicrousd, old.costMicrousd);
  for (const subject of fixture.subjects) assert.ok(request.prompt.includes(subject), subject);
  assert.match(request.prompt, /Do not add any extra people or change the authored ages/);
  assert.doesNotMatch(request.prompt, /INACTIVE_IDENTITY_MUST_NOT_APPEAR/);
  assert.doesNotMatch(request.prompt, /Any intentionally depicted|fictional and synthetic/);
  assert.match(originSection(request.prompt), /unspecified identity and age remain unknown/);
  if (fixture.id === 'unknown-identity') {
    assert.doesNotMatch(request.prompt, /fictional|synthetic/);
    assert.match(request.prompt, /intended audience is adult museum visitors/);
    assert.match(oldRequest.prompt, /Any intentionally depicted person is an adult fictional character/);
  }
  if (fixture.id === 'historical-generated' || fixture.id === 'mixed-ages') assert.match(oldRequest.prompt, /Any intentionally depicted character is fictional and synthetic/);
  assert.deepEqual(prepared[0], expected.prepared);
  assert.equal(prepared[0].parameters.identity_provenance, 'not-inferred-from-asset-origin');
  assert.equal(prepared[0].parameters.prompt_adapter_version, '1.1.1');
  assert.equal(prepared[0].parameters.adapter_version, '2.0.0');
  const unchangedParameters = ({ identity_provenance, prompt_adapter_version, submitted_prompt_characters, ...rest }) => rest;
  assert.deepEqual(unchangedParameters(prepared[0].parameters), unchangedParameters(old.prepared.parameters));
  assert.deepEqual(prepared[0].referenceInputs, old.prepared.referenceInputs);
  assert.deepEqual(prepared[0].adaptation.referenceBindings, old.prepared.adaptation.referenceBindings);
  assert.deepEqual(prepared[0].adaptation.storyboardBeats, old.prepared.adaptation.storyboardBeats);
  assert.equal(prepared[0].adaptation.timingSource, 'authored');
  assert.deepEqual(prepared[0].adaptation.audio, old.prepared.adaptation.audio);
  assert.equal(result.costMicrousd, old.costMicrousd);
  assert.equal(result.costMicrousd, 538020);
  assert.equal(result.usedReferencePixels, true);
  const { options } = fixtureInput(fixture);
  assert.deepEqual(prepared[0].referenceInputs.map(r => r.sha256), options.references.map(r => sha256(r.bytes)));
  assert.deepEqual(calls.filter(c => c.method === 'PUT').map(c => c.body), options.references.map(r => [...r.bytes]));
});

test('asset origin metadata alone never classifies unknown subject identity or age', () => {
  const fixture = provenanceFixtures.find(f => f.id === 'unknown-identity');
  const { prompt, options } = fixtureInput(fixture);
  const outputs = [];
  for (const origin of [{}, { provider: 'fixture-generator' }, { sourceArtifactKind: 'storyboard' }, { provider: 'fixture-generator', sourceArtifactKind: 'storyboard' }]) {
    const references = options.references.map(({ provider, sourceArtifactKind, ...reference }) => ({ ...reference, ...origin }));
    const adapted = adaptVideoPrompt(prompt, { ...options, references, model: VIDEO_ADAPTER_CONTRACT.model, promptProfile: 'positive-only' });
    outputs.push(originSection(adapted.prompt));
    assert.doesNotMatch(adapted.prompt, /fictional|synthetic|generated creative reference/);
  }
  assert.equal(new Set(outputs).size, 1);
});

test('original video recovery retains historical identity assertion and metadata without relabeling or another purchase', async () => {
  const fixture = provenanceFixtures[0];
  const original = before.captures[0].prepared;
  const retainedReceipt = structuredClone(original);
  const { calls, prepared, result } = await captureVideo(fixture, { references: [], providerJobId: 'fixture-original', providerModel: original.model, retainedReceipt });
  assert.deepEqual(retainedReceipt, original, 'caller-owned historical evidence unchanged');
  assert.deepEqual(prepared, [original], 'original prompt, metadata, version and bindings remain verbatim');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.method === 'GET'), 'no upload or replacement video submission');
  assert.equal(result.providerJobId, 'fixture-original');
  assert.equal(result.costMicrousd, before.captures[0].costMicrousd);
  assert.deepEqual(result.referenceInputs, original.referenceInputs);
});
