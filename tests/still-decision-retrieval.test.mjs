import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDecisionEvidence } from '../src/still/decision-retrieval.ts';
import { connectionEvidence } from '../src/still/assessments.ts';
import { destinationsFor } from '../src/still/use-in.ts';

const candidate=(id,overrides={})=>({id,value:id,projectId:'p',documentId:'d',category:'direction',title:'A useful detail',...overrides});

test('retrieval reaches relevant evidence after the old prefix and keeps explicit focus first',()=>{
  const candidates=Array.from({length:12},(_,i)=>candidate(`early-${i}`));
  candidates.push(candidate('goal',{title:'Make a legible family portrait'}),candidate('focus',{focused:true,title:'Current selection'}));
  const result=selectDecisionEvidence(candidates,{goal:'legible family portrait'},3);
  assert.deepEqual(result.selected.slice(0,2).map(x=>x.id),['focus','goal']);
  assert.ok(result.selected[1].reasons.includes('goal_overlap'));
  assert.equal(result.coverage.candidateTotal,14);
  assert.equal(result.coverage.included,3);
  assert.equal(result.coverage.omitted,11);
  assert.equal(result.coverage.omissionReason,'bounded_retrieval');
});

test('retrieval diversifies equal evidence across documents, projects, and kinds deterministically',()=>{
  const candidates=[candidate('a'),candidate('b'),candidate('c'),candidate('x',{documentId:'other'}),candidate('z',{projectId:'other',documentId:'other',category:'subject'})];
  const result=selectDecisionEvidence(candidates,{},3);
  assert.deepEqual(result.selected.map(x=>x.id),['a','z','x']);
  assert.ok(result.selected[1].reasons.includes('project_diversity'));
  assert.ok(result.selected[1].reasons.includes('category_diversity'));
  assert.ok(result.selected[2].reasons.includes('document_diversity'));
  assert.deepEqual(selectDecisionEvidence([...candidates].reverse(),{},3),result);
});

test('explicit relationships and current goal outweigh a recent but unrelated change',()=>{
  const result=selectDecisionEvidence([candidate('new',{changedRecently:true}),candidate('related',{related:true}),candidate('goal',{title:'Family portrait'})],{goal:'Family portrait'},2);
  assert.deepEqual(result.selected.map(x=>x.id),['goal','related']);
  assert.ok(result.selected[1].reasons.includes('explicit_relationship'));
  assert.equal(selectDecisionEvidence([candidate('a')],{},NaN).selected.length,0);
  assert.equal(selectDecisionEvidence([candidate('a')],{},-1).selected.length,0);
  assert.equal(selectDecisionEvidence([candidate('a')],{},5).coverage.omissionReason,null);
});

const event=(type,payload,sequence)=>({eventId:`retrieval-${sequence}`,streamId:'creative:retrieval',sequence,type,payload,actor:'user',clientId:'fixture',correlationId:'fixture',causationId:null,compensatesEventId:null,occurredAt:'2026-09-30T12:00:00Z',recordedAt:'2026-09-30T12:00:00Z',schemaVersion:1});
const position={projectId:'p',documentId:'d',blockId:'source',outputId:'',view:'document',intent:'family portrait',recentActions:[]};
function fixture(){
  const rows=[['ProjectCreated',{project_id:'p',name:'Objects'}],['ProjectCreated',{project_id:'q',name:'People'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'Objects'}],['DocumentCreated',{project_id:'q',document_id:'other',title:'Family portrait'}]];
  const add=(id,projectId,documentId,text,properties={})=>rows.push(['BlockCreated',{project_id:projectId,document_id:documentId,scope:documentId?'document':'library',block_id:id,type:'subject',handle:id,position:id,properties:{text,...properties}}]);
  add('source','p','d','A red umbrella.');
  for(let i=0;i<10;i++)add(`ordinary-${i}`,'p','d','A geometric scaffold.');
  add('person','q','other','Family portrait. '+ 'A detailed account. '.repeat(140));
  add('related','p','d','Keeps the character dry.');
  add('descendant','p','d','Family portrait.');
  add('protected','p','d','Family portrait.');
  add('library-source','p','','A red umbrella.');
  rows.push(['BlockRelationAdded',{project_id:'p',document_id:'d',relation_id:'source-related',from_block_id:'source',to_block_id:'related',kind:'references',properties:{}}]);
  rows.push(['BlockRelationAdded',{project_id:'p',document_id:'d',relation_id:'source-descendant',from_block_id:'source',to_block_id:'descendant',kind:'context_contains',properties:{}}]);
  rows.push(['BlockLocked',{project_id:'p',document_id:'d',block_id:'protected'}]);
  return rows.map(([type,payload],i)=>event(type,payload,i+1));
}

test('connection retrieval preserves authorized destinations and exposes bounded evidence coverage',()=>{
  const events=fixture(),result=connectionEvidence(events,position),authorized=new Set(destinationsFor(events,position).map(d=>d.id));
  assert.equal(result.destinations.length,6);
  assert.ok(result.destinations.every(d=>authorized.has(d.id)));
  assert.ok(!result.destinations.some(d=>['source','descendant','protected'].includes(d.blockId)));
  assert.ok(result.destinations.some(d=>d.blockId==='person'));
  assert.ok(result.destinations.some(d=>d.blockId==='related'));
  assert.equal(result.coverage.candidateTotal,authorized.size);
  assert.equal(result.coverage.omitted,authorized.size-6);
  assert.equal(result.coverage.indexedTextCharactersPerCandidate,500);
  assert.equal(result.coverage.recentChangeEventLimit,32);
  const person=result.details.find(d=>d.blockId==='person');
  assert.ok(person.retrieval.reasons.includes('goal_overlap'));
  assert.equal(person.text.length,1600);
  assert.ok(person.coverage.textCharacters>person.coverage.includedCharacters);
  assert.ok(result.details.every(d=>d.relationships.length<=12&&d.neighbors.length<=4&&d.versions.length<=12));
  assert.deepEqual(connectionEvidence(events,position),result);
  const savedGoal=connectionEvidence(events,{...position,intent:''},undefined,{goal:'family portrait'});
  assert.ok(savedGoal.details.find(d=>d.blockId==='person')?.retrieval.reasons.includes('goal_overlap'));
});

test('project library focus receives connection evidence and missing focus discloses why none is included',()=>{
  const events=fixture(),result=connectionEvidence(events,{...position,documentId:'',blockId:'library-source',view:'ideas'});
  assert.equal(result.source.id,'library-source');
  assert.ok(result.destinations.length>0);
  const missing=connectionEvidence(events,{...position,blockId:'absent'});
  assert.equal(missing.source,null);
  assert.deepEqual(missing.destinations,[]);
  assert.equal(missing.coverage.omissionReason,'no_selected_idea');
});

test('a reused source retains the selected document membership and stale document selections stay empty',()=>{
  const events=fixture(),extra=[event('DocumentCreated',{project_id:'p',document_id:'second',title:'Another document'},events.length+1),event('BlockDocumentAttached',{project_id:'p',document_id:'second',block_id:'source'},events.length+2)];
  const result=connectionEvidence([...events,...extra],{...position,documentId:'second'});
  assert.equal(result.source.documentId,'second');
  assert.ok(result.source.versions.includes(extra[1].eventId));
  assert.equal(connectionEvidence(events,{...position,blockId:'library-source'}).source,null);
});

test('recent-change evidence includes renamed ideas and reference relation endpoints',()=>{
  const events=fixture();
  for(let i=0;i<40;i++)events.push(event('BlockPropertyEdited',{project_id:'p',document_id:'d',block_id:'ordinary-0',property_path:'text',new_value:`Geometric revision ${i}`},events.length+1));
  events.push(event('BlockRenamed',{project_id:'p',document_id:'d',block_id:'ordinary-9',new_handle:'Renamed detail'},events.length+1));
  events.push(event('BlockRelationAdded',{project_id:'p',document_id:'d',relation_id:'new-reference',from_block_id:'source',to_block_id:'ordinary-8',kind:'references',properties:{}},events.length+1));
  const result=connectionEvidence(events,position);
  for(const id of ['ordinary-9','ordinary-8'])assert.ok(result.details.find(d=>d.blockId===id)?.retrieval.reasons.includes('recent_change'));
  events.push(event('BlockRelationRemoved',{project_id:'p',document_id:'d',relation_id:'new-reference'},events.length+1));
  assert.ok(connectionEvidence(events,position).details.find(d=>d.blockId==='ordinary-8')?.retrieval.reasons.includes('recent_change'));
});
