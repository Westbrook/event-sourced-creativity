import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectDecisionAnswer, inspectScoreAnswer } from '../src/still/decision-answer.ts';
import { inspectAnswer } from '../src/still/diagnostics.ts';
import { assessNextBest } from '../src/still/next-best.ts';
import { presentActions, presentEvidence, presentToolbar } from '../src/still/presentation.ts';
import { ACTIONS, evaluateActions } from '../src/still/decisions.ts';

const score = { type: 'score', score: 2.8, confidence: .9, probabilities: { 0: 0, 1: 0, 2: .2, 3: .8 } };
const question = { type: 'choice', instructions: 'Which invitation helps?', criteria: { none: 'None', a: 'A', b: 'B' } };
const choice = { type: 'choice', choice: 'b', confidence: .8, probabilities: { none: .05, a: .15, b: .8 } };
const evidence = { b: { score: 2.8, confidence: .9, usefulProbability: 1, quality: 'valid' } };
const primary = rows => Object.values(rows).filter(row => row.variant === 'primary');

test('one inspector distinguishes complete, degraded and unusable evidence for every consumer', () => {
  const valid = inspectScoreAnswer(score);
  assert.equal(valid.quality, 'valid');
  assert.equal(valid.status, 'Answered');
  assert.deepEqual(valid.probabilities, score.probabilities);
  assert.deepEqual(valid.warnings, []);
  const degraded = inspectScoreAnswer({ ...score, probabilities: undefined });
  assert.equal(degraded.quality, 'degraded');
  assert.equal(degraded.status, 'Answered');
  assert.equal(degraded.score, 2.8, 'A missing distribution can retain ordinary scalar ranking');
  assert.equal(degraded.probabilities, undefined);
  assert.match(degraded.warnings.join(' '), /ordinary ranking only/);
  assert.equal(inspectScoreAnswer().quality, 'unusable');
  assert.equal(inspectScoreAnswer().status, 'Missing answer');
  assert.deepEqual(inspectAnswer(question, choice), inspectDecisionAnswer(question, choice), 'Diagnostics remains the same shared inspector');
});

test('malformed explicit distributions and mismatched answer types cannot be softened to degraded', () => {
  for (const probabilities of [null, [], {}, { 0: 0, 1: 0, 2: .2 }, { 0: 0, 1: 0, 2: .2, 3: .8, secret: 0 }, { 0: 0, 1: 0, 2: NaN, 3: .8 }, { 0: 0, 1: 0, 2: -.1, 3: 1.1 }, { 0: 0, 1: 0, 2: .2, 3: .9 }]) {
    const checked = inspectScoreAnswer({ ...score, probabilities });
    assert.equal(checked.quality, 'unusable');
    assert.equal(checked.status, 'Invalid answer');
    assert.equal(checked.probabilities, undefined);
    assert.ok(checked.warnings.length);
  }
  for (const change of [{ type: 'choice' }, { score: Infinity }, { score: -1 }, { score: 4 }, { confidence: 1.1 }, { confidence: NaN }]) {
    assert.equal(inspectScoreAnswer({ ...score, ...change }).quality, 'unusable');
  }
});

test('score consistency tolerates rounding and checks normalized expectation without rewriting evidence', () => {
  const rounded = { ...score, score: 2.67, probabilities: { 0: 0, 1: 0, 2: .33, 3: .66 } };
  assert.equal(inspectScoreAnswer(rounded).quality, 'valid');
  assert.deepEqual(inspectScoreAnswer(rounded).probabilities, rounded.probabilities, 'The original rounded evidence remains intact');
  assert.equal(inspectScoreAnswer({ ...score, score: 2.77 }).quality, 'valid', 'The inclusive score tolerance accommodates hundredth rounding');
  const inconsistent = inspectScoreAnswer({ ...score, score: 1.8 });
  assert.equal(inconsistent.quality, 'unusable');
  assert.match(inconsistent.warnings.join(' '), /expected value/);
  assert.equal(inconsistent.probabilities, undefined);
  assert.equal(inspectScoreAnswer({ ...score, confidence: .1 }).quality, 'valid', 'Confidence is not assumed to equal distribution concentration');
});

test('choice must be offered and a probability maximum, including honest ties and abstention', () => {
  assert.equal(inspectDecisionAnswer(question, choice).quality, 'valid');
  assert.equal(inspectDecisionAnswer(question, { ...choice, choice: 'a' }).quality, 'unusable');
  assert.match(inspectDecisionAnswer(question, { ...choice, choice: 'a' }).warnings.join(' '), /most probable/);
  assert.equal(inspectDecisionAnswer(question, { ...choice, choice: 'unknown' }).quality, 'unusable');
  assert.equal(inspectDecisionAnswer(question, { ...choice, probabilities: { none: 0, a: .5, b: .5 } }).quality, 'valid');
  assert.equal(inspectDecisionAnswer(question, { ...choice, choice: 'none', probabilities: { none: .8, a: .1, b: .1 } }).quality, 'valid');
  assert.equal(inspectDecisionAnswer(question, { ...choice, probabilities: undefined }).quality, 'degraded');
});

test('binary judgments validate their own probability without requiring unrelated distribution or confidence', () => {
  const q = { type: 'noul', instructions: 'Does this help?' };
  assert.equal(inspectDecisionAnswer(q, { type: 'noul', noul: .8, confidence: 4 }).quality, 'valid');
  assert.equal(inspectDecisionAnswer(q, { type: 'noul', noul: .8, confidence: 4 }).confidence, undefined);
  for (const noul of [undefined, NaN, Infinity, -.1, 1.1]) assert.equal(inspectDecisionAnswer(q, { type: 'noul', noul }).quality, 'unusable');
});

test('degraded and contradictory evidence never produce a score primary or Next Best acceptance', () => {
  assert.equal(primary(presentActions(['b'], { use_b: score })).length, 1);
  const degraded = presentActions(['b'], { use_b: { ...score, probabilities: undefined } });
  assert.equal(degraded.b.quality, 'degraded');
  assert.equal(degraded.b.score, 2.8);
  assert.equal(primary(degraded).length, 0);
  assert.equal(primary(presentEvidence(['b'], { b: { ...evidence.b, quality: 'degraded' } })).length, 0, 'Retained evidence cannot drop its degraded label on a smaller surface');
  const contradictory = presentActions(['b'], { use_b: { ...score, score: 3 } });
  assert.equal(contradictory.b.quality, 'unusable');
  assert.equal(contradictory.b.score, undefined);
  assert.equal(primary(contradictory).length, 0);
  const answer = inspectDecisionAnswer(question, choice);
  assert.equal(assessNextBest(answer, ['a', 'b'], evidence, true).accepted, true);
  for (const quality of ['degraded', 'unusable']) assert.equal(assessNextBest(answer, ['a', 'b'], { b: { ...evidence.b, quality } }, true).accepted, false);
  assert.equal(assessNextBest({ ...answer, choice: 'a' }, ['a', 'b'], evidence, true).accepted, false);
  assert.equal(assessNextBest({ ...answer, status: 'Invalidated', reason: 'Final evidence changed' }, ['a', 'b'], evidence, true).reason, 'Final evidence changed');
});

test('missing required context blocks primary emphasis without discarding ordinary scores', () => {
  const reason = 'Constraint coverage is incomplete';
  const blocked = { ...evidence.b, primaryEligible: false, primaryBlockedReason: reason };
  const presented = presentEvidence(['b'], { b: blocked });
  assert.equal(presented.b.score, 2.8);
  assert.equal(presented.b.confidence, .9);
  assert.equal(presented.b.usefulProbability, 1);
  assert.equal(presented.b.quality, 'valid');
  assert.equal(presented.b.primaryEligible, false);
  assert.equal(presented.b.primaryBlockedReason, reason);
  assert.match(presented.b.reason, /Constraint coverage is incomplete/);
  assert.equal(primary(presented).length, 0);
  assert.equal(primary(presentEvidence(['b'], presented)).length, 0, 'Reusing the evidence on a smaller surface preserves the block');
  assert.equal(primary(presentToolbar(['b'], presented, { nextBest: 'b' })).length, 0, 'A retained nomination cannot bypass the context block');
  const assessment = assessNextBest(inspectDecisionAnswer(question, choice), ['a', 'b'], { b: blocked }, true);
  assert.equal(assessment.accepted, false);
  assert.equal(assessment.reason, reason);
  assert.equal(primary(presentEvidence(['b'], { b: { ...blocked, primaryEligible: true } })).length, 1);
});

test('ordinary toolbar ranking requires helpful-now support when a complete distribution supplies it', () => {
  const candidates = ACTIONS.filter(action => ['new-project', 'projects'].includes(action.id));
  const position = { projectId: '', documentId: '', blockId: '', outputId: '', view: 'document', intent: '', recentActions: [] };
  const weak = { type: 'score', score: .2, confidence: .8, probabilities: { 0: .8, 1: .2, 2: 0, 3: 0 } };
  const helpful = { ...weak, probabilities: { 0: .9, 1: 0, 2: .1, 3: 0 } };
  const other = { type: 'score', score: 2, confidence: .8, probabilities: { 0: 0, 1: 0, 2: 1, 3: 0 } };
  const assess = candidate => evaluateActions(candidates, position, { 'use_new-project': candidate, use_projects: other });
  assert.equal(inspectScoreAnswer(weak).quality, 'valid');
  assert.equal(inspectScoreAnswer(helpful).quality, 'valid');
  const excluded = assess(weak);
  assert.equal(excluded.modelRanked, true);
  assert.ok(!excluded.selected.some(action => action.id === 'new-project'));
  assert.ok(!excluded.ranked.some(action => action.id === 'new-project'));
  assert.match(excluded.rows.find(row => row.id === 'new-project').reason, /No helpful-now probability/);
  assert.ok(excluded.selected.some(action => action.id === 'projects'));
  assert.ok(assess(helpful).selected.some(action => action.id === 'new-project'), 'Any positive helpful support preserves ordinary positive-score eligibility');
  assert.ok(assess({ ...weak, probabilities: undefined }).selected.some(action => action.id === 'new-project'), 'Absent distributions retain explicitly degraded scalar ranking');

  const allWeak = Object.fromEntries(candidates.map(action => [`use_${action.id}`, weak]));
  const abstained = evaluateActions(candidates, position, allWeak);
  assert.equal(abstained.modelRanked, true, 'An assessed abstention must not become local fallback');
  assert.deepEqual(abstained.selected, []);
  assert.deepEqual(abstained.ranked, []);
  assert.ok(abstained.rows.every(row => /No helpful-now probability/.test(row.reason)));

  const palette = evaluateActions(candidates, { ...position, palette: { toolbar: [], more: [] } }, allWeak);
  assert.equal(palette.modelRanked, true);
  assert.deepEqual(palette.selected.map(action => action.id).sort(), candidates.map(action => action.id).sort(), 'Palette preserves the full eligible catalog even when no toolbar action is useful now');
  assert.ok(palette.rows.every(row => row.base === .2 && row.basis === 'jev'));
});
