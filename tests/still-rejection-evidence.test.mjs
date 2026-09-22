import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectionEvidence,compareRejectionEvidence,evidenceSourceLink} from '../src/still/rejection-evidence.ts';
import {documentGenerationInputInspection} from '../src/model/generation-inputs.ts';
import {fixture,scenarios} from './still-rejection-browser/fixtures.mjs';
const model=read=>rejectionEvidence(read,documentGenerationInputInspection(read.job,[],read.content));
for(const name of scenarios)test(`current-schema presentation: ${name}`,()=>{
 const read=fixture(name),result=model(read);
 assert.equal(result.pipelineStage,read.job.errorDetail.pipelineStage);
 assert.equal(result.moderationStage,read.job.errorDetail.providerModerationStage);
 assert.equal(result.correctiveScope,name==='render-then-storage-failure'?'unknown':'request');
 assert.equal(result.sources[0].status,'retained');
 if(name==='render-then-storage-failure'){assert.equal(result.outcome.failureKind,'storage');assert.equal(result.outcome.contentOutcome,'usable');assert.equal(result.outcome.accountingState,'usage_recorded');}
});
test('retained prompt, expired source, absent response remain independent',()=>{
 const result=model(fixture('expired-evidence'));
 assert.deepEqual(result.sources.slice(0,2).map(s=>s.status),['retained','expired']);
 assert.equal(result.sources.find(s=>s.id==='response').status,'not_recorded');
 assert.equal(result.sources[1].value,undefined);
});
test('expiry or mismatch drops each individual envelope without losing other observations',()=>{
 const read=fixture();const entries=Object.entries(read.job.result.generationEvidenceRefs);
 entries[0][1].expiresAt='2020-01-01';read.content[entries[1][1].ref]='{"schemaVersion":"forma-private-generation-evidence-v1","evidenceId":"wrong"}';
 const result=model(read);assert.equal(result.stages.length,2);assert.equal(result.sources[3].status,'expired');assert.equal(result.sources[4].status,'unavailable');
 assert.ok(result.stages.every(s=>s.evidenceId==='original-media'));
});
test('historical request scope and title cannot invent provider stage or model settings',()=>{
 const read=fixture('expired-evidence');delete read.job.result.generationOutcome;delete read.job.errorDetail.outcome;delete read.job.errorDetail.pipelineStage;delete read.job.errorDetail.providerModerationStage;
 read.job.result.generationReceipt.failure_stage='application';read.job.errorDetail.message='Rejected portrait of a named character';
 const result=model(read);assert.equal(result.pipelineStage,'unknown');assert.equal(result.moderationStage,'unknown');assert.equal(result.stages.length,0);assert.equal(result.correctiveScope,'request');
});
test('comparison exposes exact prompt, settings, route, quality and references; unknown stays unknown',()=>{
 const rows=compareRejectionEvidence(model(fixture()),model(fixture('image-output-block','comparison')));
 assert.equal(rows[0].status,'changed');assert.match(rows[0].before,/Green/);assert.match(rows[0].after,/Blue/);
 assert.equal(rows[3].status,'changed');assert.match(JSON.stringify(rows[3].after),/flare/);assert.match(JSON.stringify(rows[3].after),/images\/edits/);
 assert.equal(rows[4].status,'changed');assert.match(JSON.stringify(rows[4].after),/synthetic-blue-reference/);
 const missing=compareRejectionEvidence(model(fixture()),model(fixture('expired-evidence')));assert.equal(missing[3].status,'unknown');
});
test('mixed routes retain each operation identity and correlation IDs',()=>{
 const result=model(fixture('mixed-routes'));assert.ok(result.stages.some(s=>s.operation.provider==='fal'));assert.ok(result.stages.some(s=>s.operation.effectiveModel==='gpt-image-2.5-sunburst'));
 assert.equal(new Set(result.stages.map(s=>s.operation.responseId).filter(Boolean)).size,4);
});

test('a planner response cannot imply availability of an absent media response',()=>{
 const read=fixture();delete read.job.result.generationEvidenceRefs['original-media:response'];
 const result=model(read);assert.equal(result.sources.find(s=>s.id==='original-media:response').status,'not_recorded');
 assert.ok(result.stages.some(s=>s.outcome.pipelineStage==='planner'&&s.phase==='response'));
});

test('source links preserve a bare progress flag and pin comparison identity',()=>{
 const base='http://localhost/still/project/p/document/d/generation/j/rejection?progress-report';
 assert.equal(evidenceSourceLink(base,'j','j','prompt'),base+'#evidence-j-prompt');
 const other=new URL(evidenceSourceLink(base,'j','k','planner:response'));assert.equal(other.searchParams.get('compareAttempt'),'k');assert.ok(other.searchParams.has('progress-report'));
});
