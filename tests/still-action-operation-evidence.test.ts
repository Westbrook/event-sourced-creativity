import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionOperationEvidence, ACTION_OPERATION_HORIZON_MS } from '../src/still/action-operation-evidence.ts';
import { ACTION_RETENTION_MS, type ActionObservation, type ActionObservationInput, type OutcomeObservation } from '../src/still/action-outcomes.ts';
import type { DocumentJob } from '../src/model/document-jobs.ts';
import type { CreativeEvent } from '../src/model/events.ts';

const baseTime=Date.parse('2026-10-01T12:00:00.000Z');
const scope={projectId:'fictional-project',documentId:'fictional-document'};
function job(status:DocumentJob['status']='queued'):DocumentJob{return {jobId:'fictional-job',documentId:scope.documentId,kind:'generate',status,sourceSurface:'still',requestedSequence:7,documentRevision:'saved-document-revision',requestKey:'fictional-request',sourcePreviewId:null,productionMode:'manual',promptTechnique:'prose',promptFanId:null,parentJobId:null,fanKind:null,members:[],result:null,error:null,errorDetail:null,moderationPromptRef:null,dismissedAt:null,attemptCount:0,requestedAt:new Date(baseTime).toISOString(),startedAt:null,completedAt:null,notifiedAt:null,leaseExpiresAt:null,updatedAt:new Date(baseTime).toISOString(),stage:'queued',progressMessage:''};}
function event(type='DocumentArtifactExported',payload:Record<string,unknown>={artifact_id:'fictional-artifact',artifact_revision:4}):CreativeEvent{return {eventId:'fictional-export',streamId:'fictional-stream',sequence:20,occurredAt:new Date(baseTime).toISOString(),recordedAt:new Date(baseTime).toISOString(),actor:'user',clientId:'web:still',correlationId:'fictional-operation',causationId:null,compensatesEventId:null,schemaVersion:1,type,payload:{...payload,document_id:scope.documentId}};}
function setup(){
  let time=baseTime,sequence=0;
  const calls:ActionObservation[]=[];
  const context={loaded:true,value:{enabled:true,expiresAt:new Date(baseTime+ACTION_RETENTION_MS).toISOString(),observations:[] as ActionObservation[]},
    observation(id:string):ActionObservationInput|undefined{return this.value.observations.find(row=>row.id===id);},
    outcome(value:OutcomeObservation,refs:{parentId:string;eventIds?:string[];jobId?:string}){
      const parent=this.observation(refs.parentId);if(!parent)return;
      const row:ActionObservation={...parent,...refs,id:`observation-${++sequence}`,kind:'outcome',outcome:structuredClone(value),recordedAt:new Date(time).toISOString(),expiresAt:this.value.expiresAt};
      this.value.observations.push(row);calls.push(row);return row.id;
    }};
  const parent=(extra:Partial<ActionObservation>={})=>{const row:ActionObservation={id:'commit-one',scope,kind:'commit',actionId:'create',decisionId:'fictional-decision',source:'toolbar',surface:'document',parentId:'invocation-one',recordedAt:new Date(baseTime).toISOString(),expiresAt:context.value.expiresAt,...extra};context.value.observations.push(row);return row;};
  const snapshot={jobs:[job()],events:[] as CreativeEvent[],jobsLoaded:true,jobsError:''};
  const monitor=new ActionOperationEvidence(context,()=>time);
  return {context,calls,parent,snapshot,monitor,advance:(elapsed:number)=>{time+=elapsed;},now:()=>time};
}

test('job acknowledgment, completion and acceptance are distinct, exactly linked and render-idempotent',()=>{
  const f=setup();f.parent({jobId:'fictional-job'});
  f.monitor.committed('scope-one',['commit-one'],f.snapshot);
  assert.deepEqual(f.calls.map(row=>[row.outcome?.type,row.outcome?.status]),[['acknowledged-commit','observed'],['completed-job','pending']]);
  assert.ok(f.calls.every(row=>row.parentId==='commit-one'&&row.jobId==='fictional-job'&&row.outcome?.target.revision==='saved-document-revision'));
  assert.equal(f.calls[1]!.outcome!.horizonMs,ACTION_OPERATION_HORIZON_MS);
  for(let i=0;i<4;i++){f.monitor.committed('scope-one',['commit-one'],f.snapshot);f.monitor.reconcile('scope-one',f.snapshot);}
  assert.equal(f.calls.length,2);
  f.parent({id:'unrelated-commit',actionId:'edit-block',eventIds:['unrelated-event']});
  f.snapshot.jobs=[job('completed')];f.monitor.reconcile('scope-one',f.snapshot);
  const completed=f.calls[2]!;assert.equal(completed.parentId,'commit-one');assert.equal(completed.outcome!.revision,2);assert.equal(completed.outcome!.supersedesId,f.calls[1]!.id);assert.equal(completed.outcome!.status,'observed');
  assert.ok(f.calls.every(row=>row.outcome?.type!=='user-acceptance'));
  f.monitor.reconcile('scope-one',f.snapshot);assert.equal(f.calls.length,3);
});

test('missing reads remain pending, known missing jobs remain unknown, and horizons censor without inventing failure',()=>{
  const f=setup();f.parent({jobId:'fictional-job'});f.monitor.committed('scope-one',['commit-one'],f.snapshot);
  f.snapshot.jobs=[];f.snapshot.jobsLoaded=false;f.monitor.reconcile('scope-one',f.snapshot);assert.equal(f.calls.length,2);
  f.snapshot.jobsLoaded=true;f.snapshot.jobsError='The job history could not be verified.';f.monitor.reconcile('scope-one',f.snapshot);assert.equal(f.calls.length,2);
  f.snapshot.jobsError='';f.monitor.reconcile('scope-one',f.snapshot);assert.equal(f.calls.at(-1)!.outcome!.status,'unknown');
  f.advance(ACTION_OPERATION_HORIZON_MS);f.monitor.reconcile('scope-one',f.snapshot);assert.equal(f.calls.at(-1)!.outcome!.status,'censored');
  f.advance(1000);f.snapshot.jobs=[job('completed')];f.monitor.reconcile('scope-one',f.snapshot);
  const late=f.calls.at(-1)!.outcome!;assert.equal(late.status,'observed');assert.ok(Date.parse(late.occurredAt)>Date.parse(late.horizonStartedAt)+late.horizonMs);assert.equal(late.horizonStartedAt,new Date(baseTime).toISOString());
});

test('failed, canceled and partial jobs do not establish completed jobs; exact recovered completion can correct them',()=>{
  for(const status of ['failed','canceled','partial'] as const){
    const f=setup();f.parent({jobId:'fictional-job'});f.snapshot.jobs=[job(status)];f.monitor.committed('scope-one',['commit-one'],f.snapshot);
    assert.equal(f.calls.at(-1)!.outcome!.status,'unknown');
    f.snapshot.jobs=[job('completed')];f.monitor.reconcile('scope-one',f.snapshot);assert.equal(f.calls.at(-1)!.outcome!.status,'observed');assert.equal(f.calls.at(-1)!.outcome!.revision,2);
  }
});

test('re-entry resumes the retained series and exact commit instead of inventing a new completion series',()=>{
  const f=setup();f.parent({jobId:'fictional-job'});f.monitor.committed('scope-one',['commit-one'],f.snapshot);
  const pending=f.calls[1]!;const resumed=new ActionOperationEvidence(f.context,f.now);
  resumed.reconcile('scope-one',f.snapshot);assert.equal(f.calls.length,2);
  f.snapshot.jobs=[job('completed')];resumed.reconcile('scope-one',f.snapshot);
  assert.equal(f.calls.length,3);assert.equal(f.calls[2]!.outcome!.outcomeId,pending.outcome!.outcomeId);assert.equal(f.calls[2]!.outcome!.supersedesId,pending.id);
});

test('a retained acknowledgment reconstructs only the missing outcome without extending its horizon',()=>{
  for(const file of [false,true]){
    const f=setup();f.parent(file?{actionId:'export',eventIds:['fictional-export']}:{jobId:'fictional-job'});if(file)f.snapshot.events=[event()];
    f.monitor.committed('scope-one',['commit-one'],f.snapshot);const acknowledgment=f.calls[0]!;
    // Both the original commit and interrupted pending write may be outside the read window.
    f.context.value.observations=[acknowledgment];f.snapshot.events=[];f.advance(1000);
    const resumed=new ActionOperationEvidence(f.context,f.now);resumed.reconcile('scope-one',f.snapshot);
    assert.equal(f.calls.length,3);const restored=f.calls[2]!;
    assert.equal(restored.outcome!.type,file?'file-retrieved':'completed-job');assert.equal(restored.outcome!.status,'pending');
    assert.equal(restored.parentId,acknowledgment.id);assert.equal(restored.outcome!.horizonStartedAt,acknowledgment.outcome!.horizonStartedAt);assert.equal(restored.outcome!.horizonMs,acknowledgment.outcome!.horizonMs);
    resumed.reconcile('scope-one',f.snapshot);assert.equal(f.calls.length,3);
  }
});

test('retained outcomes keep their verified correction chain when the original commit leaves the context window',()=>{
  const f=setup();f.parent({jobId:'fictional-job'});f.monitor.committed('scope-one',['commit-one'],f.snapshot);
  const pending=f.calls[1]!;f.context.value.observations=[pending];f.snapshot.jobs=[job('completed')];
  new ActionOperationEvidence(f.context,f.now).reconcile('scope-one',f.snapshot);
  assert.equal(f.calls.length,3);const completed=f.calls[2]!;
  assert.equal(completed.parentId,pending.id);assert.equal(completed.outcome!.supersedesId,pending.id);assert.equal(completed.outcome!.outcomeId,pending.outcome!.outcomeId);assert.equal(completed.outcome!.status,'observed');assert.equal(completed.jobId,pending.jobId);
});

test('completion or file evidence does not backfill an acknowledgment omitted by the bounded read window',()=>{
  for(const file of [false,true]){
    const f=setup();const commit=f.parent(file?{actionId:'export',eventIds:['fictional-export']}:{jobId:'fictional-job'});if(file)f.snapshot.events=[event()];
    f.monitor.committed('scope-one',['commit-one'],f.snapshot);
    f.context.value.observations=[commit,f.calls[1]!];
    new ActionOperationEvidence(f.context,f.now).reconcile('scope-one',f.snapshot);assert.equal(f.calls.length,2);
  }
});

test('ack-only re-entry cannot duplicate a canonical series hidden outside bounded history or guess its correction',()=>{
  for(const file of [false,true]){
    const f=setup();f.parent(file?{actionId:'export',eventIds:['fictional-export']}:{jobId:'fictional-job'});if(file)f.snapshot.events=[event()];
    f.monitor.committed('scope-one',['commit-one'],f.snapshot);
    const acknowledgment=f.calls[0]!,pending=f.calls[1]!,deliver=f.context.outcome.bind(f.context),attempts:OutcomeObservation[]=[];
    f.context.value.observations=[acknowledgment];f.snapshot.events=[];
    // Model the server's atomic existing-series guard while the client only has a queued ID.
    f.context.outcome=(value,refs)=>{attempts.push(value);if(value.revision===1&&value.outcomeId===pending.outcome!.outcomeId)return 'rejected-collision';return deliver(value,refs);};
    const resumed=new ActionOperationEvidence(f.context,f.now);resumed.reconcile('scope-one',f.snapshot);
    assert.equal(attempts.length,1);assert.equal(attempts[0]!.outcomeId,pending.outcome!.outcomeId);assert.equal(f.calls.length,2);
    f.snapshot.jobs=[job('completed')];f.advance(ACTION_OPERATION_HORIZON_MS);resumed.reconcile('scope-one',f.snapshot);
    assert.equal(attempts.length,1,'a rejected or unconfirmed row cannot become a guessed predecessor');assert.equal(f.calls.length,2);
    // A later authorized context read can provide the actual predecessor and permit correction.
    f.context.value.observations=[acknowledgment,pending];resumed.reconcile('scope-one',f.snapshot);
    assert.equal(f.calls.length,3);assert.equal(f.calls[2]!.outcome!.supersedesId,pending.id);assert.equal(f.calls[2]!.outcome!.outcomeId,pending.outcome!.outcomeId);
  }
});

test('a real file handoff waits for pending confirmation and preserves its occurrence time',()=>{
  const f=setup();const commit=f.parent({actionId:'export',eventIds:['fictional-export']});f.snapshot.events=[event()];
  const [ticket]=f.monitor.committed('scope-one',['commit-one'],f.snapshot);const pending=f.calls[1]!;
  f.context.value.observations=[commit,f.calls[0]!];f.advance(1000);const handedOffAt=new Date(f.now()).toISOString();
  f.monitor.fileHandedOff(ticket);assert.equal(f.calls.length,2);
  f.advance(1000);f.context.value.observations.push(pending);f.monitor.reconcile('scope-one',f.snapshot);
  assert.equal(f.calls.length,3);assert.equal(f.calls[2]!.outcome!.status,'observed');assert.equal(f.calls[2]!.outcome!.occurredAt,handedOffAt);assert.equal(f.calls[2]!.outcome!.supersedesId,pending.id);
});

test('file retrieval remains pending until a browser handoff and never establishes use or acceptance',()=>{
  for(const exportEvent of [event(),event('ObjectExported',{object_id:'fictional-output'})]){
    const f=setup();f.parent({actionId:'export',eventIds:[exportEvent.eventId]});f.snapshot.events=[exportEvent];
    const [ticket]=f.monitor.committed('scope-one',['commit-one'],f.snapshot);
    assert.ok(ticket);assert.equal(f.calls[1]!.outcome!.status,'pending');assert.deepEqual(f.calls[1]!.eventIds,[exportEvent.eventId]);
    assert.equal(ticket.target.revision,exportEvent.type==='ObjectExported'?exportEvent.eventId:'4');
    f.monitor.reconcile('scope-one',f.snapshot);assert.equal(f.calls.length,2);
    f.monitor.fileHandedOff(ticket);f.monitor.fileHandedOff(ticket);assert.equal(f.calls.length,3);
    assert.equal(f.calls[2]!.outcome!.type,'file-retrieved');assert.equal(f.calls[2]!.outcome!.status,'observed');assert.equal(f.calls[2]!.outcome!.supersedesId,f.calls[1]!.id);
    assert.ok(f.calls.every(row=>row.outcome!.type!=='user-acceptance'));
  }
});

test('an interrupted or unavailable file stays unknown or censored without a synthetic successful handoff',()=>{
  const f=setup();f.parent({actionId:'export',eventIds:['fictional-export']});f.snapshot.events=[event()];
  const [ticket]=f.monitor.committed('scope-one',['commit-one'],f.snapshot);f.monitor.fileUnavailable(ticket);
  assert.equal(f.calls.at(-1)!.outcome!.status,'unknown');
  const resumed=new ActionOperationEvidence(f.context,f.now);resumed.reconcile('scope-one',f.snapshot);assert.equal(f.calls.length,3);
  f.advance(ACTION_OPERATION_HORIZON_MS);resumed.reconcile('scope-one',f.snapshot);assert.equal(f.calls.at(-1)!.outcome!.status,'censored');
  assert.ok(!f.calls.some(row=>row.outcome?.type==='file-retrieved'&&row.outcome.status==='observed'));
});

test('opt-out, erasure, scope changes and expiry retire pending tickets and prevent stale observation delivery',()=>{
  const f=setup();f.parent({actionId:'export',eventIds:['fictional-export']});f.snapshot.events=[event()];
  const [ticket]=f.monitor.committed('scope-one',['commit-one'],f.snapshot);
  f.context.value.enabled=false;f.monitor.reconcile('scope-one',f.snapshot);f.monitor.fileHandedOff(ticket);assert.equal(f.calls.length,2);
  f.context.value.observations=[];f.context.value.enabled=true;f.monitor.reconcile('scope-two',f.snapshot);f.monitor.fileHandedOff(ticket);assert.equal(f.calls.length,2);
  f.parent({jobId:'fictional-job'});f.advance(ACTION_RETENTION_MS);f.monitor.committed('scope-two',['commit-one'],f.snapshot);f.monitor.reconcile('scope-two',f.snapshot);assert.equal(f.calls.length,2);
});

test('unavailable parents and mismatched document revisions cannot acquire a replacement causal link',()=>{
  const f=setup();f.parent({jobId:'fictional-job'});f.snapshot.jobs=[{...job(),documentId:'another-document'}];
  f.monitor.committed('scope-one',['commit-one','missing-parent'],f.snapshot);assert.equal(f.calls.length,0);
  f.snapshot.jobs=[job()];f.monitor.committed('scope-one',['commit-one'],f.snapshot);
  f.snapshot.jobs=[{...job('completed'),documentRevision:'different-revision'}];f.monitor.reconcile('scope-one',f.snapshot);assert.equal(f.calls.at(-1)!.outcome!.status,'unknown');
  const unknown=f.calls.at(-1)!;f.context.value.observations=f.context.value.observations.filter(row=>row.id!=='commit-one');f.snapshot.jobs=[job('completed')];f.monitor.reconcile('scope-one',f.snapshot);assert.equal(f.calls.length,4);assert.equal(f.calls.at(-1)!.parentId,unknown.id);
});

test('observation errors do not block creative work or loop on app updates',()=>{
  const f=setup();f.parent({jobId:'fictional-job'});let attempts=0;f.context.outcome=()=>{attempts++;throw new Error('Observation transport unavailable');};
  assert.doesNotThrow(()=>f.monitor.committed('scope-one',['commit-one'],f.snapshot));
  for(let i=0;i<5;i++)f.monitor.reconcile('scope-one',f.snapshot);
  assert.equal(attempts,2);f.snapshot.jobs=[job('completed')];assert.doesNotThrow(()=>f.monitor.reconcile('scope-one',f.snapshot));assert.equal(attempts,3);
});
