import assert from 'node:assert/strict';
import test from 'node:test';
import { qualityReviewCandidate, qualityReviewAssessment } from '../src/still/quality-review.ts';
import type { ActionObservation, StillGoal } from '../src/still/action-outcomes.ts';

const start=Date.parse('2026-10-01T12:00:00Z'),at=(offset:number)=>new Date(start+offset).toISOString();
const goal:StillGoal={id:'fictional-goal',scope:{projectId:'p'},text:'A clear fictional scene',criteria:['One subject','Quiet tone'],status:'active',createdAt:at(-1000),expiresAt:at(10*86400000)};
const review:ActionObservation={id:'review',kind:'workflow',scope:{projectId:'p'},actionId:'new-document',decisionId:'direct',surface:'creation',source:'direct',recordedAt:at(0),expiresAt:at(9*86400000),workflow:{version:'still-workflow-v1',instanceId:'draft',stage:'final-review',transition:'final-review',status:'confirmed',target:{kind:'creation-draft',id:'draft',revision:'7'},draftRevision:7,occurredAt:at(0)}};

test('delayed quality review requires retained explicit review and pre-existing criteria',()=>{
  assert.equal(qualityReviewCandidate([review],goal,start+1000),review);
  assert.equal(qualityReviewCandidate([review],undefined,start+1000),undefined);
  assert.equal(qualityReviewCandidate([review],{...goal,criteria:[]},start+1000),undefined);
  assert.equal(qualityReviewCandidate([review],{...goal,createdAt:at(500)},start+1000),undefined);
  assert.equal(qualityReviewCandidate([{...review,recordedAt:at(600)}],{...goal,createdAt:at(500)},start+1000),undefined,'late delivery does not move a review after the stated criteria');
  assert.equal(qualityReviewCandidate([review],goal,start+9*86400000),undefined);
  assert.equal(qualityReviewCandidate([{...review,workflow:{...review.workflow!,status:'attempted'}}],goal,start+1000),undefined);
});

test('missing judgments remain unknown and append-only corrections keep target and horizon',()=>{
  const first=qualityReviewAssessment(review,goal,'unknown',[{index:0,result:'unknown'},{index:1,result:'met'}],start+86400000);
  assert.equal(first.acceptance,'unknown');assert.equal(first.criteria[0].result,'unknown');
  assert.deepEqual(first.target,review.workflow!.target);assert.equal(first.horizonStartedAt,review.recordedAt);assert.equal(first.horizonMs,7*86400000);
  const saved:ActionObservation={...review,id:'assessment-1',kind:'assessment',workflow:undefined,assessment:first,recordedAt:at(86400000)};
  const correction=qualityReviewAssessment(saved,goal,'needs-work',[{index:0,result:'not-met'}],start+8*86400000);
  assert.equal(correction.revision,2);assert.equal(correction.supersedesId,saved.id);assert.equal(correction.assessmentId,first.assessmentId);
  assert.deepEqual(correction.target,first.target);assert.equal(correction.horizonStartedAt,first.horizonStartedAt);assert.equal(correction.horizonMs,first.horizonMs);
  assert.equal(first.acceptance,'unknown','original remains unchanged');
  const corrected:ActionObservation={...saved,id:'assessment-2',assessment:correction,recordedAt:at(8*86400000)};
  assert.equal(qualityReviewCandidate([corrected,review,saved],goal,start+8*86400000),corrected);
  const laterReview={...review,id:'later-review',recordedAt:at(2*86400000),workflow:{...review.workflow!,instanceId:'later-draft',target:{...review.workflow!.target,id:'later-draft'},occurredAt:at(2*86400000)}};
  assert.equal(qualityReviewCandidate([laterReview,corrected,saved],goal,start+8*86400000),laterReview,'a correction to older work does not hide a newer review');
  const revoked=qualityReviewAssessment(corrected,goal,'revoked',[{index:0,result:'met'}],start+8*86400000+1);
  assert.equal(revoked.revision,3);assert.deepEqual(revoked.criteria,[]);
});

test('short retention truncates declared horizon and changed goal or expiry rejects corrections',()=>{
  const short={...review,expiresAt:at(86400000)};
  assert.equal(qualityReviewAssessment(short,goal,'unknown',[],start+1000).horizonMs,86400000);
  assert.throws(()=>qualityReviewAssessment(short,goal,'accepted',[],start+86400000),/no longer available/);
  const assessment=qualityReviewAssessment(review,goal,'accepted',[{index:0,result:'met'}],start+1000);
  const saved={...review,kind:'assessment' as const,workflow:undefined,assessment};
  assert.throws(()=>qualityReviewAssessment(saved,{...goal,id:'another-goal'},'accepted',[],start+2000),/no longer available/);
  assert.equal(qualityReviewCandidate([saved],{...goal,id:'another-goal'},start+2000),undefined);
});
