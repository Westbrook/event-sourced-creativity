import test from 'node:test';
import assert from 'node:assert/strict';
import { generationReview, issueAffectsBlock } from '../src/still/generation-review.ts';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { StillClient, ApiError } from '../src/still/client.ts';

test('Still exposes the real admission warning without inventing highlighted blocks', async () => {
  const f = await createSceneCostFixture(1, 'visual'), saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith('/'), 'No external provider requests');
    return f.request(url, init);
  };
  try {
    const client = new StillClient(); await client.load();
    client.position = {...client.position, projectId:f.projectId, documentId:f.documentId, view:'document'};
    const draft = client.prepareGeneration('image'); draft.acknowledgements = {budgetAcknowledged:true};
    let error;
    try { await client.generate(draft); } catch (caught) { error = caught; }
    assert.ok(error instanceof ApiError);
    const review = generationReview(error.status, error.body);
    assert.equal(review.key, 'preflightAcknowledged');
    assert.doesNotMatch(review.message, /highlighted/);
    assert.ok(review.issues.some(i => i.id === 'context-safety' && i.status === 'unknown'));
    assert.ok(review.issues.every(i => !i.blockIds?.length));
    assert.equal(draft.attempted, false);
    assert.equal(client.pendingGeneration, null);
    assert.equal(f.counts().document_jobs, 0);
  } finally { globalThis.fetch = saved; await f.drainBackground(); f.close(); }
});

test('Only implicated context is marked; reference IDs also map to their blocks', () => {
  const issues = [
    {id:'safety',label:'Context safety',status:'warning',severity:'warning',summary:'Review this idea.',blockIds:['one']},
    {id:'reference',label:'Reference',status:'fail',severity:'blocking',summary:'Reference unavailable.',referenceIds:['ref']},
    {id:'pass',label:'Budget',status:'pass',severity:'info',summary:'Ready.'},
  ];
  const review = generationReview(428,{error:'generation_preflight_review_required',readiness:{probes:issues}});
  assert.equal(review.issues.length, 2);
  assert.equal(issueAffectsBlock(review.issues[0],{block_id:'one',properties:{}}),true);
  assert.equal(issueAffectsBlock(review.issues[0],{block_id:'other',properties:{}}),false);
  assert.equal(issueAffectsBlock(review.issues[1],{block_id:'two',properties:{reference_id:'ref'}}),true);
  const blocked = generationReview(409,{error:'generation_preflight_blocked',readiness:{probes:issues}});
  assert.equal(blocked.key,null,'Blocking issues cannot be acknowledged away');
  assert.equal(blocked.issues[1].summary,'Reference unavailable.');
});

test('Budget and unrelated failures retain their distinct handling; missing details remain visible', () => {
  assert.equal(generationReview(428,{error:'generation_budget_acknowledgement_required',message:'Review 80% usage.'}).message,'Review 80% usage.');
  assert.equal(generationReview(409,{error:'context_source_version_mismatch'}),null);
  const missing = generationReview(428,{error:'generation_preflight_review_required'});
  assert.match(missing.issues[0].summary,/details are unavailable/);
  assert.doesNotMatch(missing.message,/highlighted/);
});
