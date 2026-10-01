import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../src/still/decisions.ts';
import { ACTION_METADATA_GUIDANCE, ACTION_METADATA_VERSION, describeAction } from '../src/still/action-metadata.ts';

const metadata = id => describeAction({ id });

test('every eligible catalog capability has compact versioned metadata without duplicating prose', () => {
  assert.match(ACTION_METADATA_VERSION, /^still-action-metadata-v\d+$/);
  for (const action of ACTIONS) {
    const value = describeAction(action);
    assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 250, `${action.id}: metadata must remain within the per-candidate evidence budget`);
    assert.equal(value.id, undefined);
    assert.equal(value.label, undefined);
    assert.equal(value.description, undefined);
    assert.ok(value.family);
    assert.ok(value.outcome.includes('user-feedback'));
  }
  assert.throws(() => metadata('new-unreviewed-capability'), /Missing Still action metadata/);
});

test('format selection describes configuration while new paid attempts describe immediate submission', () => {
  for (const id of ['image', 'short_story', 'slides', 'storyboard', 'video', 'audio', 'model3d']) {
    assert.equal(metadata(id).launch, 'configuration');
    assert.equal(metadata(id).cost, 'paid-after-submit');
    assert.equal(metadata(id).confirm, 'submit');
    assert.equal(metadata(id).reversal, 'draft-only');
  }
  assert.equal(metadata('scene').cost, 'quote-before-paid');
  assert.equal(metadata('scene').confirm, 'quote-submit');
  assert.equal(metadata('create').cost, 'free', 'Opening the format picker is free');
  assert.equal(metadata('generate-again').launch, 'mutation');
  assert.equal(metadata('generate-again').confirm, 'action-click');
  assert.equal(metadata('generate-again').reversal, 'not-guaranteed');
});

test('analysis and authoring retain their distinct submission, rights and sharing implications', () => {
  for (const id of ['split-context', 'research-context', 'find-references']) {
    assert.equal(metadata(id).launch, 'configuration');
    assert.equal(metadata(id).cost, 'paid-after-submit');
    assert.equal(metadata(id).confirm, 'analyze-then-save', 'Analysis is explicitly started and subsequent content is reviewed before save');
  }
  assert.ok(metadata('research-context').needs.includes('public-topic'));
  assert.equal(metadata('supply-reference').cost, 'free');
  assert.ok(metadata('supply-reference').needs.includes('rights'));
  assert.equal(metadata('edit-block').risk, 'shared-content');
  assert.equal(metadata('use-in').confirm, 'review-save');
  for (const id of ['lock', 'unlock', 'toggle-context']) {
    assert.equal(metadata(id).launch, 'mutation');
    assert.equal(metadata(id).confirm, 'action-click');
    assert.equal(metadata(id).reversal, 'counter-change');
  }
});

test('navigation, download and user quality evidence remain different', () => {
  assert.equal(metadata('refresh-generation').risk, 'read-only');
  assert.equal(metadata('refresh-generation').cost, 'free');
  assert.equal(metadata('export').risk, 'download');
  assert.ok(metadata('export').outcome.includes('file-delivery'));
  assert.equal(metadata('intent').risk, 'preference');
  assert.match(ACTION_METADATA_GUIDANCE, /not a claim that it was observed/);
  assert.match(ACTION_METADATA_GUIDANCE, /not user acceptance/);
  const altered = metadata('supply-reference');
  altered.needs.push('invented');
  altered.outcome.length = 0;
  assert.ok(!metadata('supply-reference').needs.includes('invented'));
  assert.ok(metadata('supply-reference').outcome.includes('user-feedback'));
});
