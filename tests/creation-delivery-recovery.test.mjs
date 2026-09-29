import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {plainTextIdeaBody} from '../src/model/idea-body.ts';
const json=(body,method='POST')=>({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const seed=()=>({schemaVersion:1,id:'draft-'+crypto.randomUUID(),scope:{actorUserId:'',projectId:null,documentId:null,custodyKey:'',permissionEpoch:''},entryKind:'project',revision:1,originalDocument:plainTextIdeaBody('Harbor notes').document,workingDocument:plainTextIdeaBody('Harbor notes').document,markers:[],acknowledgedRevision:1,referenceSelections:[],decisions:[],expiresAt:'',state:'editing'});
const planFor=d=>({schemaVersion:1,draftId:d.id,draftRevision:d.revision,entryKind:d.entryKind,scope:d.scope,sourceText:'Harbor notes',nodes:[{id:'project-temp',kind:'project',projectId:'project-temp',title:'Harbor notes',revision:1,disposition:'retained',sourceEvidence:[{kind:'span',start:0,end:12,quote:'Harbor notes'}]}],uses:[],references:[],issues:[],coverage:[{start:0,end:12,nodeIds:['project-temp']}],decisions:d.decisions,modelVersion:'fixture-model',compiledEventBound:1,titleOnly:true});
async function setup(t){const f=await createSceneCostFixture(1);t.after(()=>f.close());f.env.STILL_UNIFIED_CREATION_ENABLED='true';f.env.STILL_CREATION_PROVIDER_CUSTODIES=JSON.stringify(['personal:'+f.owner]);f.env.STILL_CREATION_ORGANIZER_MODEL='fixture-model';const r=await f.request('/api/still/creation/drafts',json({draft:seed()}));assert.equal(r.status,201);const {draft}=await r.json();return {...f,draft,base:'/api/still/creation/drafts/'+draft.id};}
for(const mutation of ['discard','revision','pointer','redaction'])test(`interpretation publication denies ${mutation} at the actual transaction boundary without orphan bodies`,async t=>{
 const f=await setup(t);let start,release;const ready=new Promise(r=>start=r),gate=new Promise(r=>release=r);
 f.env.STILL_CREATION_ORGANIZER={fetch:async request=>{const input=await request.json();start();await gate;return Response.json({operationIdentity:input.operationIdentity,plan:planFor(input.draft)});}};
 const operationId='interpret-'+crypto.randomUUID(),running=f.request(f.base+'/interpret',json({expectedRevision:1,operationId}));await ready;
 if(mutation==='discard')assert.equal((await f.request(f.base,json({expectedRevision:1},'DELETE'))).status,200);
 if(mutation==='revision')assert.equal((await f.request(f.base,json({expectedRevision:1,draft:{...f.draft,workingDocument:plainTextIdeaBody('New source').document}},'PUT'))).status,200);
 if(mutation==='pointer')f.sqlite.prepare("UPDATE creation_drafts SET content_id='missing' WHERE draft_id=?").run(f.draft.id);
 if(mutation==='redaction')f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=(SELECT content_id FROM creation_drafts WHERE draft_id=?)').run(new Date().toISOString(),f.draft.id);
 const before=f.sqlite.prepare("SELECT count(*) n FROM private_content WHERE kind='creation-draft'").get().n;release();assert.notEqual((await running).status,200);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM private_content WHERE kind='creation-draft'").get().n,before);
 assert.equal(f.sqlite.prepare('SELECT state FROM creation_operations WHERE operation_id=?').get(operationId).state,'failed');
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM events WHERE correlation_id LIKE 'creation:%'").get().n,0);
 if(mutation==='discard')assert.equal(f.sqlite.prepare("SELECT count(*) n FROM private_content WHERE kind='creation-draft' AND redacted_at IS NULL").get().n,0);
});
test('discard during preview publication rolls back the private payload and operation together',async t=>{
 const f=await setup(t);f.draft.plan=planFor(f.draft);const saved=await (await f.request(f.base,json({expectedRevision:1,draft:f.draft},'PUT'))).json();
 f.controls.beforeBatch=async statements=>{if(statements.some(s=>s.sql.includes("'commit','review'"))){f.controls.beforeBatch=null;assert.equal((await f.request(f.base,json({expectedRevision:saved.revision},'DELETE'))).status,200);}};
 const r=await f.request(f.base+'/preview',json({expectedRevision:saved.revision,operationId:'preview-'+crypto.randomUUID()}));assert.notEqual(r.status,200);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM private_content WHERE kind='creation-draft' AND redacted_at IS NULL").get().n,0);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creation_operations WHERE kind='commit'").get().n,0);
});
test('interrupted interpretation terminalizes its original identity; an explicit new attempt can review, commit and reload its receipt',async t=>{
 const f=await setup(t);let calls=0;f.env.STILL_CREATION_ORGANIZER={fetch:async request=>{calls++;const input=await request.json();return Response.json({operationIdentity:input.operationIdentity,plan:planFor(input.draft)});}};
 const operationId='interpret-'+crypto.randomUUID();f.sqlite.prepare("INSERT INTO creation_operations(operation_id,draft_id,actor_user_id,scope_key,draft_revision,kind,state,request_hash,expires_at,created_at,updated_at) VALUES(?,?,?,?,1,'interpretation','executing','interrupted',?,'2000','2000')").run(operationId,f.draft.id,f.owner,f.draft.scope.custodyKey,f.draft.expiresAt);
 for(let i=0;i<2;i++){const r=await f.request(f.base+'/interpret',json({expectedRevision:1,operationId}));assert.equal((await r.json()).status,'failed');}assert.equal(calls,0);
 const r=await f.request(f.base+'/interpret',json({expectedRevision:1,operationId:'retry-'+crypto.randomUUID()}));assert.equal(r.status,200);f.draft.plan=(await r.json()).plan;
 const saved=await (await f.request(f.base,json({expectedRevision:1,draft:f.draft},'PUT'))).json();const commit='commit-'+crypto.randomUUID();const preview=await (await f.request(f.base+'/preview',json({expectedRevision:saved.revision,operationId:commit}))).json();
 const applied=await f.request(f.base+'/apply',json({operationId:commit,approvalHash:preview.approvalHash}));assert.equal(applied.status,200,await applied.clone().text());const receipt=(await applied.json()).receipt;
 assert.deepEqual((await (await f.request(f.base+'/operations/'+commit)).json()).receipt,receipt);assert.equal(calls,1);
});
