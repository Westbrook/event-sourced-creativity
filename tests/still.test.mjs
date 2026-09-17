import test from 'node:test';
import assert from 'node:assert/strict';
import { foldEvents } from '../src/model/events.ts';
import { eligibleActions, buildDecisionState, questionsFor, selectActions, rankFormats, CREATIVE_QUESTIONS } from '../src/still/decisions.ts';
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
  globalThis.fetch=async (url,init)=>{if(url==='/api/session')return json(session);if(url==='/api/document-jobs'){admissions++;throw new Error('connection lost');}if(url==='/api/document-jobs/still-reconcile')throw new Error('Generation check unconfirmed');throw new Error(`Unexpected ${url}`);};
  const draft={format:'model3d',prompt:'A bronze bowl',itemCount:1,tone:'',audience:'',requestId:'request',sourceHead:4,documentId:'d',scopeKey:c.scopeKey};
  try {await assert.rejects(c.generate(draft),/connection lost/);assert.equal(draft.attempted,true);await assert.rejects(c.generate(draft),/[Gg]eneration check unconfirmed/);assert.equal(admissions,1);}finally{globalThis.fetch=original;}
});
test('a definitive budget gate does not count as a purchased generation',async()=>{
  const c=client(), original=globalThis.fetch;
  globalThis.fetch=async url=>url==='/api/session'?json(session):json({error:'generation_budget_acknowledgement_required'},428);
  const draft={format:'image',prompt:'',itemCount:1,tone:'',audience:'',requestId:'request',sourceHead:4,documentId:'d',scopeKey:c.scopeKey};
  try {await assert.rejects(c.generate(draft));assert.equal(draft.attempted,false);}finally{globalThis.fetch=original;}
});
test('recovering an accepted queued image resumes its original job without another admission',async()=>{
  const c=client(),saved=globalThis.fetch,key='still:d:4:original';let admissions=0,runs=[];
  operationJournal.saveGeneration('test:personal',{documentId:'d',format:'image',requestKey:key});
  globalThis.fetch=async(url,init)=>{
    if(url==='/api/session')return json(session);
    if(url==='/api/document-jobs/still-reconcile')return json({documentId:'d',requestKey:key,status:'found',job:{jobId:'accepted',documentId:'d',requestKey:key,kind:'generate',status:'queued'}});
    if(url==='/api/document-jobs'){admissions++;throw new Error('Unexpected new purchase');}
    if(url==='/api/document-jobs/accepted/run'){runs.push(url);return json({});}
    throw new Error(`Unexpected ${url}`);
  };
  try{const job=await c.generate(c.prepareGeneration('image'));assert.equal(job.jobId,'accepted');assert.equal(c.pendingGeneration,null);assert.equal(admissions,0);assert.equal(runs.length,1);}finally{globalThis.fetch=saved;}
});
test('an admission closed during submission opens explicit review instead of retrying the closed key',async()=>{
  const c=client(),saved=globalThis.fetch;let posts=0;
  const draft={format:'image',prompt:'',itemCount:1,tone:'',audience:'',requestId:'closed',sourceHead:4,documentId:'d',scopeKey:c.scopeKey};
  globalThis.fetch=async url=>{if(url==='/api/session')return json(session);posts++;return json({error:'generation_request_closed'},409);};
  try{await assert.rejects(c.generate(draft));assert.equal(draft.recoveryClosed,true);assert.equal(c.pendingGeneration.closed,true);const fresh=c.reviewNewGeneration(draft);assert.notEqual(fresh.requestId,draft.requestId);assert.equal(fresh.previousUnconfirmed,true);assert.equal(posts,1);}finally{globalThis.fetch=saved;}
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
  answers.requested_model3d={type:'noul',noul:1};
  assert.equal(selectActions(candidates,{...position,intent:'Create a 3D model'},answers)[0].id,'model3d');
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
  globalThis.fetch=async(url,init)=>{if(url==='/api/session')return json(session);if(url==='/api/document-jobs/still-reconcile')throw new Error('Generation check unconfirmed');if(init?.method==='POST'){posts++;throw new Error('lost');}return json({jobs:[]});};
  const draft={format:'image',prompt:'',itemCount:1,tone:'',audience:'',requestId:'request',sourceHead:4,documentId:'d',scopeKey:c.scopeKey};
  try {await assert.rejects(c.generate(draft));const reopened=new StillClient();reopened.session=structuredClone(session);reopened.position={...position};await assert.rejects(reopened.generate({...draft,attempted:false,requestId:'different'}),/[Gg]eneration check unconfirmed/);assert.equal(posts,1);}finally{globalThis.fetch=original;}
});
test('a stale personal save is refreshed but never automatically resubmitted',async()=>{
  const c=client(), original=globalThis.fetch;let posts=0;
  const changed=input('BlockPropertyEdited',{block_id:'b',property_path:'text',old_value:'A ceramic observatory on a brass tripod',new_value:'Collaborator text'},5);
  globalThis.fetch=async(url,init)=>{if(url==='/api/session')return json(session);if(init?.method==='POST'){posts++;return json({error:'stale_sequence'},409);}return json({events:[changed],head:5,nextAfter:5,hasMore:false,content:{}});};
  const write={type:'BlockPropertyEdited',payload:{block_id:'b',property_path:'text',old_value:'A ceramic observatory on a brass tripod',new_value:'My obsolete text'}};
  try {await assert.rejects(c.append([write]),/workspace changed/);await assert.rejects(c.append([write]),/changed while you were writing/);assert.equal(posts,1);assert.equal(c.projection.blocks.find(b=>b.id==='b').properties.text,'Collaborator text');}finally{globalThis.fetch=original;}
});


test('source content and past output choices never imply a format',()=>{
  const p=foldEvents(events,Infinity,'d','p');
  for (const blockId of ['', 'b']) {
    const pos={...position,blockId,recentActions:['image','model3d','image']};
    const candidates=eligibleActions(p,pos,abilities);
    const fallback=selectActions(candidates,pos);
    assert.ok(fallback.some(a=>a.id==='create'));
    assert.ok(!fallback.some(a=>abilities.formats.includes(a.id)));
    const questions=questionsFor(candidates,pos);
    assert.equal(questions.model_subject,undefined);assert.equal(questions.use_image,undefined);
    assert.ok(questions.use_create);assert.ok(questions.manage_ideas);
    const misleading={use_image:{type:'score',score:3,confidence:1},requested_image:{type:'noul',noul:1},subject:{type:'noul',noul:1},light:{type:'noul',noul:1}};
    assert.ok(!selectActions(candidates,pos,misleading).some(a=>a.id==='image'));
  }
});
test('specific creation suggestions require current intent and explicit format evidence',()=>{
  const candidates=eligibleActions(foldEvents(events,Infinity,'d','p'),position,abilities);
  const pos={...position,intent:'Explore what this brass object could become'};
  const answers={use_image:{type:'score',score:3,confidence:1},use_create:{type:'score',score:2,confidence:1}};
  assert.deepEqual(selectActions(candidates,pos,answers).map(a=>a.id),['create']);
  assert.deepEqual(selectActions(candidates,pos,{...answers,requested_image:{type:'noul',noul:.5}}).map(a=>a.id),['create']);
  const specific=selectActions(candidates,{...pos,intent:'Create an image'}, {...answers,requested_image:{type:'noul',noul:1}});
  assert.deepEqual(specific.map(a=>a.id),['image']);
  const viewed=questionsFor(candidates,{...position,view:'artifact'},'short_story');
  assert.ok(viewed.protagonist);assert.equal(viewed.use_short_story,undefined);
});
test('choosing and changing formats is local and resets request-specific approval state',()=>{
  const c=client(), before=JSON.stringify(c.events);
  assert.throws(()=>c.prepareGeneration(''),/Choose an available format/);
  assert.throws(()=>c.prepareGeneration('video'),/Choose an available format/);
  const scene=c.prepareGeneration('scene');
  scene.scenePreview={maximumMicrousd:1};scene.acknowledgements={budgetAcknowledged:true};scene.tone='Old tone';
  const model=c.prepareGeneration('model3d',scene);
  assert.equal(model.format,'model3d');assert.ok(model.adaptation);assert.match(model.prompt,/people/);
  assert.equal(model.scenePreview,undefined);assert.equal(model.acknowledgements,undefined);assert.equal(model.tone,'');
  assert.notEqual(scene.requestId,model.requestId);assert.equal(model.sourceRevision,scene.sourceRevision);
  const slides=c.prepareGeneration('slides',model);assert.equal(slides.itemCount,6);assert.equal(slides.adaptation,undefined);
  assert.equal(JSON.stringify(c.events),before);assert.equal(c.pendingGeneration,null);
  c.events.push(input('BlockPropertyEdited',{block_id:'b',property_path:'text',old_value:'A ceramic observatory on a brass tripod',new_value:'New content'},5));
  assert.equal(slides.sourceSnapshot.facts.find(b=>b.block_id==='b').properties.text,'A ceramic observatory on a brass tripod');
});
test('an unconfirmed generation locks the original format even after returning to the document',()=>{
  const c=client();
  const original=c.prepareGeneration('image');original.attempted=true;
  assert.throws(()=>c.prepareGeneration('model3d',original),/earlier generation/);
  operationJournal.saveGeneration('test:personal',{documentId:'d',format:'scene',requestKey:'earlier'});
  try {
    assert.throws(()=>c.prepareGeneration('image'),/earlier generation/);
    const recovered=c.prepareGeneration(c.pendingGeneration.format);
    assert.equal(recovered.format,'scene');assert.equal(recovered.attempted,true);assert.equal(recovered.scenePreview,undefined);
  } finally {operationJournal.clearGeneration('test:personal','d');}
});


test('format suitability is ranked separately from intent and capped at three available choices',()=>{
  const candidates=eligibleActions(foldEvents(events,Infinity,'d','p'),position,{...abilities,formats:['image','short_story','scene','slides','audio','model3d']});
  const score=(score,confidence=.9)=>({type:'score',score,confidence});
  const answers={fit_short_story:score(3,.95),fit_scene:score(3),fit_audio:score(2,.8),fit_image:score(2,.7),fit_model3d:score(1),fit_video:score(3,1),fit_invented:score(3,1)};
  assert.deepEqual(rankFormats(candidates,answers),['short_story','scene','audio']);
  assert.ok(!selectActions(candidates,position,answers).some(a=>abilities.formats.includes(a.id)));
  const questions=questionsFor(candidates,{...position,view:'choose-format'});
  assert.ok(questions.fit_image);assert.equal(questions.use_image,undefined);assert.equal(questions.requested_image,undefined);
  assert.equal(Object.keys(questions).length,6);
  for (const bad of [score(NaN),score(Infinity),score(-1),score(4),score(2,.49),score(3,2),score('3'),{type:'noul',noul:1}]) assert.deepEqual(rankFormats(candidates,{fit_image:bad}),[]);
  assert.deepEqual(rankFormats(candidates),[]);
});
