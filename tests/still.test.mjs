import test from 'node:test';
import assert from 'node:assert/strict';
import { foldEvents } from '../src/model/events.ts';
import { eligibleActions, buildDecisionState, questionsFor, selectActions, CREATIVE_QUESTIONS } from '../src/still/decisions.ts';
import { operationJournal } from '../src/still/operation-journal.ts';
import { StillClient } from '../src/still/client.ts';
import { isBlockKind } from '../src/model/block-types.ts';

const input = (type, payload, sequence) => ({eventId:`e${sequence}`,streamId:'creative:test',sequence,type,payload,actor:'user',clientId:'web:test',correlationId:'fixture',occurredAt:'2026-09-17T12:00:00Z',recordedAt:'2026-09-17T12:00:00Z',causationId:null,compensatesEventId:null,schemaVersion:1});
const events = [input('ProjectCreated',{project_id:'p',name:'Quiet hour'},1),input('DocumentCreated',{project_id:'p',document_id:'d',title:'A small observatory',handle:'observatory'},2),input('BlockCreated',{project_id:'p',document_id:'d',block_id:'b',type:'subject',handle:'The object',position:'1',properties:{text:'A ceramic observatory on a brass tripod',weight:.8}},3),input('BlockCreated',{project_id:'p',document_id:'d',block_id:'x',type:'exclusion',handle:'Avoid',position:'2',properties:{text:'people',weight:1}},4)];
const position = {projectId:'p',documentId:'d',blockId:'b',outputId:'',view:'document',intent:'',recentActions:[]};
const abilities = {author:true,generate:true,projectCreate:true,formats:['image','model3d','short_story']};
const session = {user:{userId:'test',role:'creator',displayName:'Test creator'},permissionEpoch:'1',policy:{accepted:true},provider:{configured:true,plannerConfigured:true,model3dConfigured:true}};
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function client() { operationJournal.clearWrite('test:personal'); operationJournal.clearGeneration('test:personal','d'); const c = new StillClient(); c.session=structuredClone(session);c.events=structuredClone(events);c.head=4;c.position={...position};return c; }

test('permission eligibility and rendering budget remain deterministic under arbitrary model replies',()=>{
  const p=foldEvents(events,Infinity,'d','p');
  const readOnly=eligibleActions(p,position,{author:false,generate:false,projectCreate:false,formats:[]});
  assert.ok(readOnly.every(a=>!['write','make','context'].includes(a.group)));
  const candidates=eligibleActions(p,position,abilities);
  assert.ok(!candidates.some(a=>a.id==='video'));
  assert.ok(candidates.some(a=>a.id==='model3d'));
  for(const score of [NaN,Infinity,-10,1000,'3',null]) {
    const chosen=selectActions(candidates,position,{use_image:{type:'score',score,confidence:1},use_invented:{type:'score',score:3,confidence:1}});
    assert.ok(chosen.length<=4);assert.equal(new Set(chosen.map(a=>a.id)).size,chosen.length);
    assert.ok(chosen.every(a=>candidates.some(c=>c.id===a.id)));
  }
});
test('question bank is expansive, typed, and names each action in its instructions',()=>{
  assert.ok(Object.keys(CREATIVE_QUESTIONS).length>=60);
  const candidates=eligibleActions(foldEvents(events,Infinity,'d','p'),position,abilities), questions=questionsFor(candidates);
  for(const candidate of candidates) assert.ok(questions[`use_${candidate.id}`].instructions.includes(candidate.label));
  for(const q of Object.values(questions)) assert.ok(['noul','choice','score'].includes(q.type)&&q.instructions.length>15);
});
test('history aggregation retains old activity, removes forgotten attention and does not forward linked credentials',()=>{
  const full=[...events,input('AttentionEpisodeObserved',{text:'FORGOTTEN_ATTENTION'},5),input('AttentionSignalsForgotten',{before_sequence:5},6),input('PreferenceRecorded',{text:'Warm brass https://private.example/?token=SECRET'},7)];
  const {state}=buildDecisionState(full,position,abilities,7), encoded=JSON.stringify(state);
  assert.equal(state.history.eventCounts.ProjectCreated,1);assert.equal(state.history.coverage.accessibleEvents,7);
  assert.doesNotMatch(encoded,/FORGOTTEN_ATTENTION|token=SECRET/);assert.match(encoded,/Warm brass/);
});
test('canonical context creation and 3D adaptation retain exclusions',()=>{
  const c=client();assert.ok(isBlockKind(c.blockEvent('A thought','Direction').payload.type));
  const adaptation=c.model3dAdaptation();assert.equal(adaptation.valid,true);assert.match(adaptation.prompt,/people/);assert.match(adaptation.prompt,/avoid|exclude|must not|without/i);
});
test('an interrupted generation admission is reconciled without a second purchase',async()=>{
  const c=client(), original=globalThis.fetch;let admissions=0;
  globalThis.fetch=async (url,init)=>{if(url==='/api/session')return json(session);if(url==='/api/document-jobs'){admissions++;throw new Error('connection lost');}if(String(url).startsWith('/api/document-jobs?'))return json({jobs:[]});throw new Error(`Unexpected ${url}`);};
  const draft={format:'model3d',prompt:'A bronze bowl',itemCount:1,tone:'',audience:'',requestId:'request',sourceHead:4,documentId:'d',scopeKey:c.scopeKey};
  try {await assert.rejects(c.generate(draft),/connection lost/);assert.equal(draft.attempted,true);await assert.rejects(c.generate(draft),/original generation is unconfirmed/);assert.equal(admissions,1);}finally{globalThis.fetch=original;}
});
test('a definitive budget gate does not count as a purchased generation',async()=>{
  const c=client(), original=globalThis.fetch;
  globalThis.fetch=async url=>url==='/api/session'?json(session):json({error:'generation_budget_acknowledgement_required'},428);
  const draft={format:'image',prompt:'',itemCount:1,tone:'',audience:'',requestId:'request',sourceHead:4,documentId:'d',scopeKey:c.scopeKey};
  try {await assert.rejects(c.generate(draft));assert.equal(draft.attempted,false);}finally{globalThis.fetch=original;}
});
test('a changed account scope retires all previously rendered private content',async()=>{
  const c=client(), original=globalThis.fetch;c.content={private:'old workspace'};
  globalThis.fetch=async()=>json({...session,projectContext:{projectAccessId:'other',projectId:'other',permissions:['project.read']}});
  try{await assert.rejects(c.refresh(),/workspace changed/);assert.equal(c.events.length,0);assert.deepEqual(c.content,{});assert.equal(c.position.documentId,'');}finally{globalThis.fetch=original;}
});
test('artifact edits retain the original edit revision rather than overwriting new collaborator work',async()=>{
  const c=client(), original=globalThis.fetch;c.events.push(input('DocumentArtifactEdited',{artifact_id:'a'},5));let patches=0;
  globalThis.fetch=async(url,init)=>{if(init?.method==='PATCH')patches++;return json(session);};
  try{await assert.rejects(c.editArtifact('a','Old draft',0),/changed while you were writing/);assert.equal(patches,0);}finally{globalThis.fetch=original;}
});
test('partial or unrelated event acknowledgments never claim a successful save',async()=>{
  const c=client(), original=globalThis.fetch;let writes=0;
  globalThis.fetch=async(url,init)=>{if(url==='/api/session')return json(session);if(init?.method==='POST'){writes++;return json({appended:[input('BlockCreated',{block_id:'another'},5)],head:5});}return json({events:[],head:4,nextAfter:4,hasMore:false,content:{}});};
  try{await assert.rejects(c.append([c.blockEvent('Test','Direction')]),/not fully confirmed/);await assert.rejects(c.append([c.blockEvent('Test','Direction')]),/still unconfirmed/);assert.equal(writes,1);}finally{globalThis.fetch=original;}
});


test('creative evidence changes tied action rankings without changing eligibility or budget',()=>{
  const p=foldEvents(events,Infinity,'d','p'), candidates=eligibleActions(p,{...position,blockId:''},abilities);
  const answers=Object.fromEntries(candidates.map(a=>[`use_${a.id}`,{type:'score',score:2,confidence:.9}]));
  answers.model_subject={type:'noul',noul:1}; answers.model_scale={type:'noul',noul:1}; answers.model_material={type:'noul',noul:1};
  assert.equal(selectActions(candidates,position,answers)[0].id,'model3d');
});
test('large multilingual histories retain the selected block in a bounded state',()=>{
  const full=[...events,...Array.from({length:100},(_,i)=>input('BlockCreated',{project_id:'p',document_id:'d',block_id:`long-${i}`,type:'direction',handle:'方向'.repeat(100),position:String(i+5),properties:{text:'創造的な世界'.repeat(1200),weight:1}},i+5))];
  const {state}=buildDecisionState(full,{...position,blockId:'long-99'},abilities,104);
  assert.equal(state.active.blocks[0].id,'long-99');assert.ok(new TextEncoder().encode(JSON.stringify(state)).byteLength<=20000);
});
test('a lost export receipt never authorizes a different artifact',async()=>{
  const c=client(), original=globalThis.fetch;let committed=[], posts=0;
  globalThis.fetch=async(url,init)=>{if(url==='/api/session')return json(session);if(init?.method==='POST'){posts++;const body=JSON.parse(init.body);committed=[{...input(body.event.type,body.event.payload,5),correlationId:body.correlationId}];throw new Error('connection lost');}return json({events:committed,head:5,nextAfter:5,hasMore:false,content:{}});};
  try {await assert.rejects(c.append([{type:'DocumentArtifactExported',payload:{artifact_id:'A',document_id:'d',artifact_revision:1,content_sha256:'A'}}]));await assert.rejects(c.append([{type:'DocumentArtifactExported',payload:{artifact_id:'B',document_id:'d',artifact_revision:1,content_sha256:'B'}}]),/earlier save was confirmed/);assert.equal(posts,1);}finally{globalThis.fetch=original;}
});
test('generation recovery survives constructing a fresh client and request',async()=>{
  const c=client(), original=globalThis.fetch;let posts=0;
  globalThis.fetch=async(url,init)=>{if(url==='/api/session')return json(session);if(init?.method==='POST'){posts++;throw new Error('lost');}return json({jobs:[]});};
  const draft={format:'image',prompt:'',itemCount:1,tone:'',audience:'',requestId:'request',sourceHead:4,documentId:'d',scopeKey:c.scopeKey};
  try {await assert.rejects(c.generate(draft));const reopened=new StillClient();reopened.session=structuredClone(session);reopened.position={...position};await assert.rejects(reopened.generate({...draft,attempted:false,requestId:'different'}),/original generation is unconfirmed/);assert.equal(posts,1);}finally{globalThis.fetch=original;}
});
test('a stale personal save is refreshed but never automatically resubmitted',async()=>{
  const c=client(), original=globalThis.fetch;let posts=0;
  const changed=input('BlockPropertyEdited',{block_id:'b',property_path:'text',old_value:'A ceramic observatory on a brass tripod',new_value:'Collaborator text'},5);
  globalThis.fetch=async(url,init)=>{if(url==='/api/session')return json(session);if(init?.method==='POST'){posts++;return json({error:'stale_sequence'},409);}return json({events:[changed],head:5,nextAfter:5,hasMore:false,content:{}});};
  const write={type:'BlockPropertyEdited',payload:{block_id:'b',property_path:'text',old_value:'A ceramic observatory on a brass tripod',new_value:'My obsolete text'}};
  try {await assert.rejects(c.append([write]),/workspace changed/);await assert.rejects(c.append([write]),/changed while you were writing/);assert.equal(posts,1);assert.equal(c.projection.blocks.find(b=>b.id==='b').properties.text,'Collaborator text');}finally{globalThis.fetch=original;}
});
