import assert from 'node:assert/strict';
import test from 'node:test';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';

const imports=registerOutputSourceImports();
test.after(()=>imports.deregister());
const {authoritativeCreativeContext}=await import('../worker/context-authority.ts');
const {serializeEvent}=await import('../worker/event-read-primitives.ts');
const {publicEventPayload}=await import('../worker/event-privacy.ts');
const {standingConstraints}=await import('../src/model/taste.ts');
const {preserveMemoryAuthoredCopies}=await import('../src/model/memory-authorship.ts');
const {proveCurrentIncarnation}=await import('../worker/generation-current-source-proof.ts');

// Executable dependency counterexamples, not an inspector qualification suite.
// Every source is synthetic and the real projection/resolver functions run here.
const event=(sequence,type,payload)=>({eventId:`event-${sequence}`,streamId:'creative:owner',sequence,
  occurredAt:'2026-01-01T00:00:00.000Z',recordedAt:'2026-01-01T00:00:00.000Z',actor:'user:owner',
  clientId:'web:editor',correlationId:'synthetic-n6',causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});
const history=()=>[
  event(1,'ProjectCreated',{project_id:'project',name:'Synthetic project'}),
  event(2,'DocumentCreated',{project_id:'project',document_id:'document',title:'Synthetic document'}),
  event(3,'BlockCreated',{project_id:'project',document_id:'document',block_id:'direction',type:'direction',scope:'document',properties:{text:'A quiet harbor',authority:'authored'},position:'a1'}),
];
const resolve=events=>authoritativeCreativeContext(events,{documentId:'document',projectId:'project'});
const identity=context=>({snapshot:context.snapshot,documentRevision:context.documentRevision,sourceBlockVersions:context.sourceBlockVersions});
const rowFor=e=>({event_id:e.eventId,stream_id:e.streamId,sequence:e.sequence,occurred_at:e.occurredAt,recorded_at:e.recordedAt,
  actor:e.actor,client_id:e.clientId,correlation_id:e.correlationId,causation_id:null,compensates_event_id:null,schema_version:1,type:e.type,
  payload:JSON.stringify(publicEventPayload(e.eventId,e.payload,true).payload),private_json:JSON.stringify(e.payload),
  private_event_id:e.eventId,owner_id:'owner',project_id:'project',document_id:e.payload.document_id??null,redacted_at:null});

test('N6 dependency: authorized projection identity does not certify private sidecar custody',()=>{
  const rows=history().map(rowFor),baseline=resolve(rows.map(serializeEvent));
  for(const changed of [
    {owner_id:'other-owner'},
    {project_id:'other-project',document_id:'other-document'},
    {private_event_id:'other-event'},
  ]){
    const altered=rows.map(row=>({...row,...changed}));
    assert.deepEqual(identity(resolve(altered.map(serializeEvent))),identity(baseline));
  }
  // These fields are unavailable after serialization; the resolver cannot
  // distinguish the rows above without a separately owned custody contract.
  assert.equal(Object.hasOwn(serializeEvent(rows[2]),'owner_id'),false);
});

test('N6 dependency: source digest/revision alone does not bind event owner or stream',()=>{
  const events=history(),baseline=resolve(events);
  const substituted=events.map(e=>({...e,streamId:'creative:other-owner',actor:'user:other-owner'}));
  assert.deepEqual(identity(resolve(substituted)),identity(baseline));
  assert.ok(JSON.stringify(baseline.snapshot).length<28000);
});

test('N6 dependency: an unavailable private event can still produce a resolver snapshot',()=>{
  const rows=history().map(rowFor),baseline=resolve(rows.map(serializeEvent));
  // readProfileEventPage's LEFT JOIN supplies no private_json for a missing or
  // redacted sidecar. serializeEvent intentionally falls back to public routing.
  delete rows[2].private_json;
  const fallback=resolve(rows.map(serializeEvent));
  assert.equal(fallback.snapshot.facts.length,1);
  assert.equal(fallback.snapshot.facts[0].properties.text,undefined);
  assert.notDeepEqual(fallback.snapshot,baseline.snapshot);
  assert.deepEqual(fallback.snapshot.facts[0].source_event_refs,['event-3']);
});

test('N6 dependency: selected source refs do not establish the project origin census',()=>{
  const events=history(),baseline=resolve(events),withoutProject=resolve(events.slice(1));
  assert.deepEqual(identity(withoutProject),identity(baseline));
  const selectedRefs=new Set([
    ...baseline.snapshot.facts.flatMap(f=>f.source_event_refs),
    ...baseline.snapshot.relationships.flatMap(r=>r.source_event_refs),
    ...baseline.projection.documents.find(d=>d.id==='document').sourceEvents,
  ]);
  assert.equal(selectedRefs.has('event-1'),false);
  assert.throws(()=>proveCurrentIncarnation(events.slice(1),'document'),/document_origin_unproven/);
});

test('N6 dependency: standing constraints are a separate source consumer',()=>{
  const events=history(),withConstraint=[...events,event(4,'PreferenceAuthored',{preference_id:'preference',axis:'exclusion',value:'No lettering',polarity:'forbid'})];
  assert.deepEqual(identity(resolve(withConstraint)),identity(resolve(events)));
  assert.equal(standingConstraints(events).length,0);
  assert.equal(standingConstraints(withConstraint)[0].value,'No lettering');
  assert.deepEqual(standingConstraints(withConstraint)[0].evidenceRefs,['event-4']);
  // No assertion that the ordinary Still source-advisory wire contains this
  // constraint: that wire currently uses the resolver snapshot unchanged.
});

test('N6 dependency: generation rights validation does not qualify every serialized fact lifetime',()=>{
  const events=history();
  events[2].payload.properties={text:'A quiet harbor',weight:0,rights_expires_at:'2000-01-01T00:00:00.000Z'};
  const inactive=resolve(events);
  assert.equal(inactive.snapshot.facts[0].active,false);
  assert.equal(inactive.snapshot.facts[0].properties.rights_expires_at,'2000-01-01T00:00:00.000Z');
  // Moderation's whole snapshot includes disabled facts, unlike generation's
  // active-fact rights validation. N6 needs its own complete lifetime receipt.
  events[2].payload.properties.weight=1;
  assert.throws(()=>resolve(events),error=>error.code==='context_source_rights_expired');
});

test('N6 dependency: current properties cannot certify a retained historical source lifetime',()=>{
  const events=history();
  events[2].payload.properties.rights_expires_at='2000-01-01T00:00:00.000Z';
  events.push(event(4,'BlockPropertyEdited',{block_id:'direction',property_path:'rights_expires_at',old_value:'2000-01-01T00:00:00.000Z',new_value:''}));
  const context=resolve(events);
  assert.equal(context.snapshot.facts[0].properties.rights_expires_at,'');
  assert.deepEqual(context.snapshot.facts[0].source_event_refs,['event-3','event-4']);
  assert.equal(Object.hasOwn(context,'sourceLifetimes'),false);
});

test('N6 dependency: accepted Memory authorship survives later edits and copied authored work',()=>{
  const events=history();events[2].payload.memory_authored_version=1;
  events.push(event(4,'BlockPropertyEdited',{block_id:'direction',property_path:'text',new_value:'A harbor with blue sky'}));
  const context=resolve(events);
  assert.equal(context.snapshot.facts[0].authorship,'accepted-memory-assisted');
  assert.equal(context.snapshot.facts[0].independent_evidence,false);
  const copied=preserveMemoryAuthoredCopies([{type:'BlockCreated',payload:{block_id:'copy',copied_from_block_id:'direction',properties:{text:'A harbor with blue sky'}}}],context.projection.blocks,events);
  assert.equal(copied[0].payload.memory_authored_version,1);
});

test('N6 dependency: standalone current-source lifecycle proof rejects ordinary preflight telemetry',()=>{
  const events=history();assert.equal(proveCurrentIncarnation(events,'document').projectId,'project');
  for(const type of ['GenerationPreflightRequested','GenerationPreflightCompleted']){
    const withTelemetry=[...events,event(4,type,{preflight_id:'preflight',document_id:'document'})];
    assert.deepEqual(identity(resolve(withTelemetry)),identity(resolve(events)));
    assert.throws(()=>proveCurrentIncarnation(withTelemetry,'document'),/current_lifecycle_proof_unavailable/);
  }
});
