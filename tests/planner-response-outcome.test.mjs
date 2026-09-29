import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPlannerResponseOutcome } from '../worker/planner-response-outcome.ts';
import { plannerEnvelope, stoppedPlannerEnvelopes } from './planner-response-outcome-fixtures.mjs';
for (const [name, change, problem] of stoppedPlannerEnvelopes) test(name + ' precedes candidate parsing and keeps independent accounting', () => {
  for (const accounting of ['unknown', 'usage_recorded', 'settled']) {
    const body = plannerEnvelope(change), before = JSON.stringify(body);
    const result = inspectPlannerResponseOutcome(body, accounting);
    assert.equal(result.problem, problem);
    assert.equal(result.outcome.contentOutcome, problem === 'refused' ? 'refused' : problem === 'incomplete' ? 'invalid' : 'unknown');
    assert.equal(result.outcome.accountingState, accounting);
    assert.equal(result.outcome.pipelineStage, 'planner');
    assert.equal(result.outcome.providerModerationStage, 'unknown');
    assert.equal(result.outcome.dispatchState, 'response_received');
    assert.equal(JSON.stringify(body), before);
    assert(!JSON.stringify(result).includes('Synthetic refusal'));
  }
});
test('model differences, missing usage, and prose do not invent refusal or validate content', () => {
  for (const change of [{ model: 'dated-or-alias-returned-model' }, { usage: undefined }, { output_text: 'refused content_filter incomplete' }, { status: undefined }, { refusal: true }]) {
    const result = inspectPlannerResponseOutcome(plannerEnvelope(change));
    assert.equal(result.problem, null);
    assert.equal(result.outcome.contentOutcome, 'unknown');
    assert.equal(result.outcome.accountingState, 'unknown');
  }
});
test('malformed containers never throw; only exact refusal signals classify safety', () => {
  for (const body of [null, [], 'refusal']) assert.equal(inspectPlannerResponseOutcome(body).problem, 'invalid_envelope');
  for (const output of [null, {}, [null, { content: 'refusal' }]]) assert.equal(inspectPlannerResponseOutcome({ output }).problem, null);
  assert.equal(inspectPlannerResponseOutcome({ output: [null, { content: [null, { type: 'refusal' }] }] }).problem, 'refused');
});
