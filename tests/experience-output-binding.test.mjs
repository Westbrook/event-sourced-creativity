import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digest } from '../src/experiences/compiler.ts';
import {
  experienceOutputAuthorization,
  experienceOutputBinding,
  experienceOutputCommandKey,
  experienceOutputEnvelope,
  validateExperienceOutputEnvelope,
} from '../worker/experience-output-binding.ts';

// New pure helper tests only. No native API, command receipt store, canonical
// runtime graph, database, browser, provider or financial action is exercised.
const stages = ['save', 'confirm', 'preflight', 'authorize', 'run'];
const hash = character => `sha256:${character.repeat(64)}`;
const plan = () => ({
  draftId: `experience-draft-${'a'.repeat(64)}`,
  draftHash: hash('b'),
  request: { intentId: 'logical-intake', subject: 'Original subject', quoteId: 'quote-1' },
  events: [{ type: 'BlockCreated', payload: { block_id: 'source-1', properties: { text: 'Original source' } } }],
  release: { releaseHash: hash('c'), output: { output: 'image' } },
  projectId: 'project-1', documentId: 'document-1', streamId: 'creative:author-1',
});
const requestDigest = async value => (await digest(value)).slice('sha256:'.length);

test('one logical intake keeps every stage key when mutable plan content changes', async () => {
  const original = plan();
  const variants = [
    { ...original, draftHash: hash('d') },
    { ...original, release: { ...original.release, releaseHash: hash('e') } },
    { ...original, request: { ...original.request, subject: 'Changed subject', quoteId: 'quote-2' } },
    { ...original, events: [{ type: 'BlockCreated', payload: { block_id: 'source-1', properties: { text: 'Changed source' } } }] },
    { ...original, projectId: 'project-2', documentId: 'document-2' },
    { ...original, release: { releaseHash: hash('f'), output: { output: 'slides' } } },
  ];
  const binding = await experienceOutputBinding(original);
  for (const candidate of variants) {
    const changed = await experienceOutputBinding(candidate);
    assert.notDeepEqual(changed, binding);
    for (const stage of stages) {
      assert.equal(await experienceOutputCommandKey(changed, stage), await experienceOutputCommandKey(binding, stage));
    }
  }
});

test('stage, logical draft and personal stream separate command identities', async () => {
  const binding = await experienceOutputBinding(plan());
  const keys = await Promise.all(stages.map(stage => experienceOutputCommandKey(binding, stage)));
  assert.equal(new Set(keys).size, stages.length);
  const otherDraft = await experienceOutputBinding({ ...plan(), draftId: `experience-draft-${'b'.repeat(64)}` });
  const otherStream = await experienceOutputBinding({ ...plan(), streamId: 'creative:author-2' });
  for (const stage of stages) {
    const original = await experienceOutputCommandKey(binding, stage);
    assert.notEqual(await experienceOutputCommandKey(otherDraft, stage), original);
    assert.notEqual(await experienceOutputCommandKey(otherStream, stage), original);
  }
  await assert.rejects(experienceOutputCommandKey(binding, 'unknown'), /experience_output_stage_invalid/u);
});

test('binding hashes actual request and source identity without creating authority', async () => {
  for (const output of ['image', 'slides', 'video']) {
    const input = plan(); input.release.output.output = output;
    const binding = await experienceOutputBinding(input);
    assert.equal(binding.requestHash, await digest(input.request));
    assert.equal(binding.sourceBindingHash, await digest({ projectId: input.projectId, documentId: input.documentId, events: input.events }));
    assert.equal(Object.isFrozen(binding), true);
    assert.equal(Object.hasOwn(binding, 'explicitAuthorization'), false);
  }
  const unsupported = plan(); unsupported.release.output.output = 'unsupported-output';
  await assert.rejects(experienceOutputBinding(unsupported), /experience_output_unsupported/u);
});

test('native revision is emitted and replayed as the exact output:head string', async () => {
  const binding = await experienceOutputBinding(plan());
  for (const head of [0, 1, 42, Number.MAX_SAFE_INTEGER]) {
    const fields = { request: { quoteId: 'quote-1', sourceIds: ['source-1'] } };
    const envelope = await experienceOutputEnvelope(binding, 'run', head, fields);
    assert.equal(envelope.expectedRevision, `output:${head}`);
    const replay = await validateExperienceOutputEnvelope(envelope, binding, 'run', await requestDigest(envelope));
    assert.deepEqual(replay, envelope);
    assert.notEqual(replay, envelope);
    assert.notEqual(replay.request, envelope.request);
    fields.request.sourceIds.push('caller-mutation');
    assert.deepEqual(envelope.request.sourceIds, ['source-1']);
    replay.request.sourceIds.push('replay-mutation');
    assert.deepEqual(envelope.request.sourceIds, ['source-1']);
  }
});

test('revision replay rejects numeric, noncanonical and unsafe values even with their matching digest', async () => {
  const binding = await experienceOutputBinding(plan());
  const valid = await experienceOutputEnvelope(binding, 'run', 1);
  const invalid = [
    0, 1, null, {}, [], '1', 'output:', 'output:00', 'output:01',
    'output:-1', 'output:+1', 'output:1.0', 'output:1e3', 'output: 1', 'output:1 ',
    'output:9007199254740992', 'output:9007199254740993',
    'output:Infinity', 'output:NaN', 'Output:1',
  ];
  for (const expectedRevision of invalid) {
    const value = { ...valid, expectedRevision };
    await assert.rejects(
      validateExperienceOutputEnvelope(value, binding, 'run', await requestDigest(value)),
      /experience_output_original_envelope_unavailable/u,
      `must not normalize ${JSON.stringify(expectedRevision)}`,
    );
  }
  for (const head of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity, '1', null, undefined]) {
    await assert.rejects(experienceOutputEnvelope(binding, 'run', head), /experience_output_revision_invalid/u);
  }
});

test('caller fields cannot replace binding, native revision or command identity', async () => {
  const binding = await experienceOutputBinding(plan());
  for (const field of ['documentId', 'expectedRevision', 'clientMutationId', 'action', 'experienceBinding']) {
    await assert.rejects(
      experienceOutputEnvelope(binding, 'run', 1, { [field]: 'caller-value' }),
      /experience_output_envelope_invalid/u,
    );
  }
});

test('same command key does not hide a changed complete envelope digest', async () => {
  const binding = await experienceOutputBinding(plan());
  const original = await experienceOutputEnvelope(binding, 'run', 1, {
    request: { quoteId: 'quote-1', requirements: ['original'] },
    termsDigest: hash('1'), maximumMicrousd: 1234,
  });
  const originalDigest = await requestDigest(original);
  const changes = [
    { expectedRevision: 'output:2' },
    { request: { quoteId: 'quote-2', requirements: ['original'] } },
    { request: { quoteId: 'quote-1', requirements: ['changed'] } },
    { termsDigest: hash('2') },
    { maximumMicrousd: 1235 },
    { experienceBinding: { ...binding, draftHash: hash('3') } },
    { additionalField: 'changed envelope' },
  ];
  for (const change of changes) {
    const changed = { ...original, ...change };
    assert.equal(changed.clientMutationId, original.clientMutationId);
    assert.notEqual(await requestDigest(changed), originalDigest);
    await assert.rejects(
      validateExperienceOutputEnvelope(changed, binding, 'run', originalDigest),
      /experience_output_original_envelope_unavailable/u,
    );
  }
  await assert.rejects(
    validateExperienceOutputEnvelope(original, binding, 'run', `sha256:${originalDigest}`),
    /experience_output_original_envelope_unavailable/u,
  );
});

test('matching a changed digest cannot substitute a different envelope identity', async () => {
  const binding = await experienceOutputBinding(plan());
  const original = await experienceOutputEnvelope(binding, 'run', 1);
  for (const change of [
    { action: 'authorize' }, { documentId: 'another-document' },
    { clientMutationId: 'caller-mutation' },
    { experienceBinding: { ...binding, requestHash: hash('4') } },
  ]) {
    const changed = { ...original, ...change };
    await assert.rejects(
      validateExperienceOutputEnvelope(changed, binding, 'run', await requestDigest(changed)),
      /experience_output_original_envelope_unavailable/u,
    );
  }
});

test('authorization requires the supplied explicit true and exact shown terms and ceiling', () => {
  const terms = { termsDigest: hash('5'), maximumMicrousd: 1234 };
  const explicit = { explicitAuthorization: true, ...terms };
  assert.deepEqual(experienceOutputAuthorization(explicit, terms), explicit);
  const missingOrInferred = [undefined, null, [], {}, terms,
    { ...explicit, explicitAuthorization: false },
    { ...explicit, explicitAuthorization: 1 },
    { ...explicit, explicitAuthorization: 'true' },
    { ...explicit, termsDigest: hash('6') },
    { ...explicit, maximumMicrousd: 1233 },
    { ...explicit, maximumMicrousd: 1235 },
    { ...explicit, maximumMicrousd: '1234' },
  ];
  for (const confirmation of missingOrInferred) {
    assert.throws(() => experienceOutputAuthorization(confirmation, terms), /experience_output_explicit_authorization_required/u);
  }
  for (const maximumMicrousd of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    const invalidTerms = { ...terms, maximumMicrousd };
    assert.throws(
      () => experienceOutputAuthorization({ explicitAuthorization: true, ...invalidTerms }, invalidTerms),
      /experience_output_explicit_authorization_required/u,
    );
  }
});
