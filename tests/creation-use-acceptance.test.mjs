import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {plainTextIdeaBody} from '../src/model/idea-body.ts';
import {creationReviewHashes} from '../src/model/creation-validation.ts';
import {foldEvents} from '../src/model/events.ts';
import {appendAuditEvent,readWorkspaceEvents} from '../worker/runtime.ts';
const json=(body,method='POST')=>({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const sourceText='@Harbor direction';
async function request(f,path,body,method='POST',status=200){const r=await f.request(path,json(body,method));assert.equal(r.status,status,await r.clone().text());return r.json();}
async function prepareUseDraft(f,{entryKind='idea',documentId=null,roots=['scene-reuse-direction']}={}){
 const rich=plainTextIdeaBody(sourceText).document,draft={schemaVersion:1,id:'draft-'+crypto.randomUUID(),scope:{actorUserId:'',projectId:f.projectId,documentId,custodyKey:'',permissionEpoch:''},entryKind,revision:1,originalDocument:rich,workingDocument:rich,markers:[],acknowledgedRevision:1,referenceSelections:[],decisions:[],expiresAt:'',state:'editing'};
 let saved=await request(f,'/api/still/creation/drafts',{draft},'POST',201);const base='/api/still/creation/drafts/'+saved.draft.id;
 const selected=await request(f,base+'/use',{expectedRevision:saved.revision,rootIds:roots});saved=selected;
 const decision={id:'selected-existing',kind:'correction',nodeIds:[],revision:1,accepted:true,detail:'Explicitly selected existing Idea identities'};
 saved.draft.decisions=[decision];saved.draft.referenceSelections[0].sourceDocumentId=f.documentId;
 const destination=entryKind==='document'?'new-container':documentId;
 const nodes=entryKind==='document'?[{id:destination,kind:'document',projectId:f.projectId,title:'Harbor direction',revision:1,disposition:'retained',sourceEvidence:selected.selection.sources.map(s=>({kind:'existing',blockId:s.id,projectId:s.projectId,revision:s.revision,hash:s.hash}))}]:[];
 const uses=destination?selected.selection.rootIds.map((ideaId,order)=>({id:'use-'+order,documentId:destination,ideaId,order,revision:1,disposition:'retained',dependencyManifest:selected.dependencyManifests[ideaId]})):[];
 saved.draft.plan={schemaVersion:1,draftId:saved.draft.id,draftRevision:saved.revision,entryKind,scope:saved.scope,sourceText,nodes,uses,references:[],issues:[],coverage:[{start:0,end:sourceText.length,nodeIds:nodes.map(n=>n.id),decisionId:decision.id}],decisions:[decision],modelVersion:'selected-references-v1',compiledEventBound:nodes.length+uses.length};
 return {saved,base};
}
async function approveAndPreview(f,prepared){const {saved,base}=prepared,hashes=await creationReviewHashes(saved.draft.plan),entry=h=>({presentedHash:h,approvedHash:h,complete:true});saved.draft.review={schemaVersion:1,nodes:Object.fromEntries(Object.entries(hashes.nodeHashes).map(([id,h])=>[id,entry(h)])),uses:Object.fromEntries(Object.entries(hashes.useHashes).map(([id,h])=>[id,entry(h)])),stage:'final',lastAcknowledgedRevision:saved.revision,finalApprovalHash:hashes.approvalHash};
 const acknowledged=await request(f,base,{draft:saved.draft,expectedRevision:saved.revision},'PUT');const operationId='operation-'+crypto.randomUUID();const preview=await request(f,base+'/preview',{expectedRevision:acknowledged.revision,operationId});return {...prepared,saved:acknowledged,preview,operationId};}
async function apply(f,p){return request(f,p.base+'/apply',{operationId:p.operationId,approvalHash:p.preview.approvalHash});}
const committedRows=f=>f.sqlite.prepare("SELECT type,payload FROM events WHERE correlation_id LIKE 'creation:%' ORDER BY sequence").all();
test('reuse-only New Idea into an existing Document creates exactly the selected attachments, no Idea/container copies',async()=>{
 const f=await createSceneCostFixture(1);f.env.STILL_UNIFIED_CREATION_ENABLED='true';const target='existing-destination';await appendAuditEvent(f.env,f.streamId,'user','DocumentCreated',{project_id:f.projectId,document_id:target,title:'Existing destination'});await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,block_id:'existing-lantern',scope:'library',project_owned:true,type:'subject',handle:'Lantern',position:'b',properties:{text:'A lantern at the harbor.',subtype:'Object study'}});
 const before=foldEvents(await readWorkspaceEvents(f.env,f.streamId),Infinity,target,f.projectId);
 const p=await approveAndPreview(f,await prepareUseDraft(f,{documentId:target,roots:['scene-reuse-direction','existing-lantern','scene-reuse-direction']}));assert.equal(p.saved.draft.plan.nodes.length,0);assert.equal(Object.keys(p.saved.draft.review.nodes).length,0);assert.equal(Object.keys(p.saved.draft.review.uses).length,2);assert.equal(p.preview.events.length,2);assert.ok(p.preview.events.every(e=>e.type==='BlockDocumentAttached'));
 const {receipt}=await apply(f,p);assert.deepEqual(receipt.created,[]);assert.equal(receipt.uses.length,2);assert.equal(receipt.primaryDocumentId,target);assert.equal(committedRows(f).length,2);assert.equal(committedRows(f).filter(r=>r.type==='BlockDocumentAttached').length,2);
 const after=foldEvents(await readWorkspaceEvents(f.env,f.streamId),Infinity,target,f.projectId);assert.deepEqual(new Set(after.blocks.map(b=>b.id)),new Set(['scene-reuse-direction','existing-lantern']));assert.equal(after.libraryBlocks.length,before.libraryBlocks.length);for(const id of ['scene-reuse-direction','existing-lantern'])assert.deepEqual(after.libraryBlocks.find(b=>b.id===id).properties,before.libraryBlocks.find(b=>b.id===id).properties);
 await apply(f,p);assert.equal(committedRows(f).length,2,'duplicate Save never adds attachment events');f.close();
});
test('fixed selected source Document roots do not subscribe to a later Soundtrack member',async()=>{
 const f=await createSceneCostFixture(1);f.env.STILL_UNIFIED_CREATION_ENABLED='true';const prepared=await prepareUseDraft(f,{entryKind:'document'}),p=await approveAndPreview(f,prepared);const selectedBefore=structuredClone(p.saved.draft.referenceSelections[0]);
 await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,block_id:'later-soundtrack',scope:'library',project_owned:true,type:'direction',handle:'Soundtrack',position:'b',properties:{text:'A quiet harbor soundtrack.'}});await appendAuditEvent(f.env,f.streamId,'user','BlockDocumentAttached',{project_id:f.projectId,document_id:f.documentId,block_id:'later-soundtrack',position:'b'});
 const reloaded=await f.request(p.base).then(r=>r.json());assert.deepEqual(reloaded.draft.referenceSelections[0],selectedBefore,'membership changes do not mutate the acknowledged selection');
 const {receipt}=await apply(f,p);assert.equal(receipt.created.length,1);assert.equal(receipt.created[0].kind,'document');assert.deepEqual(receipt.uses.map(u=>u.ideaId),['scene-reuse-direction']);const history=await readWorkspaceEvents(f.env,f.streamId),source=foldEvents(history,Infinity,f.documentId,f.projectId),target=foldEvents(history,Infinity,receipt.primaryDocumentId,f.projectId);assert.ok(source.blocks.some(b=>b.id==='later-soundtrack'));assert.deepEqual(target.blocks.map(b=>b.id),['scene-reuse-direction']);assert.equal(committedRows(f).filter(r=>r.type==='BlockDocumentAttached').length,1);assert.equal(committedRows(f).filter(r=>r.type==='BlockCreated').length,0);f.close();
});
test('reuse-only New Idea without a destination offers no-change navigation and writes no records or commit operation',async()=>{
 const f=await createSceneCostFixture(1);f.env.STILL_UNIFIED_CREATION_ENABLED='true';const p=await approveAndPreview(f,await prepareUseDraft(f));assert.deepEqual(p.preview.events,[]);assert.equal(p.preview.status,'no-change');assert.equal(p.preview.projectId,f.projectId);assert.equal(committedRows(f).length,0);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM creation_operations WHERE operation_id=?').get(p.operationId).n,0);f.close();
});
test('an existing attachment is a no-change result rather than another attachment event',async()=>{
 const f=await createSceneCostFixture(1);f.env.STILL_UNIFIED_CREATION_ENABLED='true';const p=await approveAndPreview(f,await prepareUseDraft(f,{documentId:f.documentId}));assert.deepEqual(p.preview.events,[]);assert.equal(p.preview.status,'no-change');assert.equal(p.preview.primaryDocumentId,f.documentId);assert.equal(committedRows(f).length,0);f.close();
});
test('mixed reused attachments review all selected uses but receipt counts only the missing attachment',async()=>{
 const f=await createSceneCostFixture(1);f.env.STILL_UNIFIED_CREATION_ENABLED='true';await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,block_id:'new-shared-lantern',scope:'library',project_owned:true,type:'subject',handle:'Lantern',position:'b',properties:{text:'A lantern at the harbor.',subtype:'Object study'}});
 const p=await approveAndPreview(f,await prepareUseDraft(f,{documentId:f.documentId,roots:['scene-reuse-direction','new-shared-lantern']}));assert.equal(p.saved.draft.plan.uses.length,2);assert.equal(Object.keys(p.saved.draft.review.uses).length,2);assert.equal(p.preview.events.length,1);assert.deepEqual(p.preview.changedUses,[{documentId:f.documentId,ideaId:'new-shared-lantern'}]);const {receipt}=await apply(f,p);assert.deepEqual(receipt.created,[]);assert.deepEqual(receipt.uses,p.preview.changedUses);assert.equal(committedRows(f).length,1);assert.equal(committedRows(f)[0].type,'BlockDocumentAttached');f.close();
});
