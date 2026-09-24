import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileCreationPlan,creationReviewHashes,validateCreationPlan,creationEnvelopeBytes,exactTitleOnlyPlan,refreshCreationDependencyBindings} from '../src/model/creation-validation.ts';
import {plainTextIdeaBody,ideaBodyReferences} from '../src/model/idea-body.ts';
import {foldEvents} from '../src/model/events.ts';
import {authorityFromCreationProjection} from '../worker/creation-authority.ts';
const fixture=JSON.parse(readFileSync(new URL('../docs/still-unified-creation-fixtures-2026-09-23.json',import.meta.url)));
const evidence=rows=>rows.map(e=>({kind:'span',...e}));
function example(){
 const scope={actorUserId:'author',projectId:null,documentId:null,custodyKey:'personal:author',permissionEpoch:1};
 const nodes=[{...fixture.project,kind:'project',projectId:fixture.project.id},...fixture.documents.map(d=>({id:d.id,title:d.title,kind:'document',projectId:fixture.project.id,sourceEvidence:d.sourceEvidence})),...fixture.ideas.map(i=>({...structuredClone(i),intent:i.properties?.intent,preferredOutputKinds:i.properties?.preferred_output_kinds}))].map(n=>({...n,revision:1,disposition:'retained',sourceEvidence:evidence(n.sourceEvidence)}));
 const uses=fixture.documents.flatMap(d=>d.ideaIds.map((ideaId,order)=>({id:`use-${d.id}-${ideaId}`,documentId:d.id,ideaId,order,revision:1,disposition:'retained',dependencyManifest:[]})));
 const plan={schemaVersion:1,draftId:'white-album',draftRevision:1,entryKind:'project',scope,sourceText:fixture.source,nodes,uses,references:[],issues:[],coverage:[{start:0,end:fixture.source.length,nodeIds:nodes.map(n=>n.id)}],decisions:[],modelVersion:'fixture-v19',compiledEventBound:512};
 const authority={...scope,canCreateProject:true,canAuthorProject:false,documentIds:[],existingBlocks:[],existingRelations:[],existingVersions:[],allocatedIds:Object.fromEntries(nodes.map(n=>[n.id,`canonical-${n.id}`])),occupiedIds:[],selectedRootIds:[]};
 return {plan,authority};
}
async function approve(plan){const hashes=await creationReviewHashes(plan);const entry=hash=>({presentedHash:hash,approvedHash:hash,complete:true});return {schemaVersion:1,nodes:Object.fromEntries(Object.entries(hashes.nodeHashes).map(([id,hash])=>[id,entry(hash)])),uses:Object.fromEntries(Object.entries(hashes.useHashes).map(([id,hash])=>[id,entry(hash)])),stage:'final',lastAcknowledgedRevision:plan.draftRevision,finalApprovalHash:hashes.approvalHash};}
const events=inputs=>inputs.map((event,i)=>({...event,eventId:`event-${i}`,streamId:'creative:author',sequence:i+1,occurredAt:'2026-09-23',actor:'user'}));
test('v19 White Album compiles once per shared identity, preserving tokens and exact scene closure',async()=>{
 const {plan,authority}=example(),compiled=await compileCreationPlan(plan,authority,await approve(plan));
 assert.equal(compiled.events.filter(e=>e.type==='ProjectCreated').length,1);assert.equal(compiled.events.filter(e=>e.type==='DocumentCreated').length,2);assert.equal(compiled.events.filter(e=>e.type==='BlockCreated').length,14);assert.equal(compiled.events.length,33);
 for(const doc of fixture.documents){const projection=foldEvents(events(compiled.events),Infinity,`canonical-${doc.id}`,compiled.projectId);assert.deepEqual(new Set(projection.blocks.map(b=>b.id)),new Set(doc.ideaIds.map(id=>`canonical-${id}`)));}
 const blocks=compiled.events.filter(e=>e.type==='BlockCreated');assert.equal(blocks.filter(e=>e.payload.handle==='Paul').length,1);assert.equal(blocks.filter(e=>e.payload.handle==='Jon').length,1);
 const references=blocks.flatMap(e=>ideaBodyReferences(e.payload.properties.rich_text_body));assert.equal(references.length,15);assert.ok(references.every(r=>r.projectId===compiled.projectId&&r.blockId.startsWith('canonical-')));
 assert.ok(compiled.events.every(e=>!JSON.stringify(e).includes('sourceEvidence')),'private audit source is not compiled into events');
});
test('current content, seen and approval gates fail closed, with unaffected shared identity preserved',async()=>{
 const {plan,authority}=example(),review=await approve(plan);delete review.nodes['idea-paul'].presentedHash;
 assert.ok((await validateCreationPlan(plan,authority,review)).issues.some(i=>i.code==='node_not_approved'));
 const fresh=await approve(plan);plan.nodes.find(n=>n.id==='idea-paul').title='Paul (edited)';const hashes=await creationReviewHashes(plan);
 assert.notEqual(hashes.nodeHashes['doc-paul-jon'],fresh.nodes['doc-paul-jon'].approvedHash);assert.notEqual(hashes.nodeHashes['doc-window'],fresh.nodes['doc-window'].approvedHash);assert.equal(hashes.nodeHashes['idea-ringo'],fresh.nodes['idea-ringo'].approvedHash);
 assert.ok((await validateCreationPlan(plan,authority,fresh)).issues.some(i=>i.code==='final_approval_required'));
});
test('formatting-only and storage acknowledgement changes preserve semantic review hashes',async()=>{
 const {plan}=example(),before=await creationReviewHashes(plan);plan.draftRevision++;const paul=plan.nodes.find(n=>n.id==='idea-paul');paul.revision++;paul.body.document.doc.content[0].content[0].marks=[{type:'strong'}];
 assert.deepEqual(await creationReviewHashes(plan),before);
});
test('titles, unsupported types, empty bodies, cross-project references and cycles are rejected',async()=>{
 for(const [code,change] of [
  ['incomplete_node',p=>p.nodes.find(n=>n.id==='idea-paul').body=plainTextIdeaBody('')],
  ['incomplete_node',p=>p.nodes.find(n=>n.id==='idea-paul').type='object'],
  ['invalid_evidence',p=>p.nodes[0].sourceEvidence[0].quote='invented'],
  ['cross_project_reference',p=>p.nodes.find(n=>n.id==='idea-first-scene').body.document.doc.content[0].content[0].attrs.run.data.projectId='foreign'],
  ['dependency_cycle',p=>{const n=p.nodes.find(n=>n.id==='idea-paul');n.body=structuredClone(p.nodes.find(n=>n.id==='idea-first-scene').body);delete n.text;}],
 ]){const {plan,authority}=example();change(plan);const result=await validateCreationPlan(plan,authority,undefined,{requireReview:false});assert.ok(result.issues.some(i=>i.code===code),`${code}: ${JSON.stringify(result.issues)}`);}
});
test('unchanged clear Project title uses idempotent compiler path but rich description cannot bypass review',async()=>{
 const {plan,authority}=example();plan.nodes=plan.nodes.slice(0,1);plan.sourceText=plan.nodes[0].title;plan.nodes[0].sourceEvidence=[{kind:'span',start:0,end:plan.sourceText.length,quote:plan.sourceText}];plan.coverage=[{start:0,end:plan.sourceText.length,nodeIds:[plan.nodes[0].id]}];plan.uses=[];plan.titleOnly=true;
 assert.equal((await compileCreationPlan(plan,authority)).events.length,1);plan.sourceText='Paul sits with Jon';plan.nodes[0].title=plan.sourceText;assert.equal(exactTitleOnlyPlan(plan),false);
 plan.entryKind='idea';assert.equal(exactTitleOnlyPlan(plan),false);
});
test('512 events commit and 513 events reject before writes',async()=>{
 const {plan,authority}=example();const base=plan.nodes.find(n=>n.id==='idea-paul');plan.nodes=[plan.nodes[0],...Array.from({length:511},(_,i)=>({...structuredClone(base),id:`idea-${i}`}))];plan.uses=[];authority.allocatedIds=Object.fromEntries(plan.nodes.map(n=>[n.id,`new-${n.id}`]));
 const review=await approve(plan);assert.equal((await compileCreationPlan(plan,authority,review)).events.length,512);
 plan.nodes.push({...structuredClone(base),id:'idea-512'});authority.allocatedIds['idea-512']='new-idea-512';assert.ok((await validateCreationPlan(plan,authority,undefined,{requireReview:false})).issues.some(i=>i.code==='event_limit'));
});
test('UTF-8 protected envelope byte bound is exact, with no truncation',async()=>{
 assert.equal(creationEnvelopeBytes('é'),4);const {plan,authority}=example();plan.padding='';plan.padding='a'.repeat(1_000_000-creationEnvelopeBytes({plan}));assert.equal(creationEnvelopeBytes({plan}),1_000_000);assert.ok(!(await validateCreationPlan(plan,authority,undefined,{requireReview:false})).issues.some(i=>i.code==='envelope_too_large'));plan.padding+='a';assert.ok((await validateCreationPlan(plan,authority,undefined,{requireReview:false})).issues.some(i=>i.code==='envelope_too_large'));
});
test('uncovered content and unconfirmed removals cannot silently disappear',async()=>{
 const {plan,authority}=example();plan.coverage=[];plan.nodes.find(n=>n.id==='idea-paul').disposition='removed';const result=await validateCreationPlan(plan,authority,undefined,{requireReview:false});assert.ok(result.issues.some(i=>i.code==='uncovered_source'));assert.ok(result.issues.some(i=>i.code==='unconfirmed_disposition'));
});
test('prospective root authority does not require a fabricated existing Document',async()=>{
 const {plan}=example(),projection=foldEvents([],Infinity);const authority=await authorityFromCreationProjection(plan.scope,'project',projection,{canCreateProject:true,canAuthorProject:false});assert.equal(authority.projectId,null);assert.deepEqual(authority.documentIds,[]);
 await assert.rejects(()=>authorityFromCreationProjection(plan.scope,'project',projection,{canCreateProject:true,canAuthorProject:true,selectedSharedProjectId:'shared'}),/denied/);
});
test('explicit same-Project selected existing identity retains ID and changed revision pauses commit',async()=>{
 const initial=example(),compiled=await compileCreationPlan(initial.plan,initial.authority,await approve(initial.plan)),projection=foldEvents(events(compiled.events),Infinity,'canonical-doc-paul-jon',compiled.projectId);
 const scope={actorUserId:'author',projectId:compiled.projectId,documentId:'canonical-doc-paul-jon',custodyKey:'personal:author',permissionEpoch:1};
 const authority=await authorityFromCreationProjection(scope,'idea',projection,{canCreateProject:false,canAuthorProject:true,allocatedIds:{new:'new-id'},selectedRootIds:['canonical-idea-paul']});
 const body=structuredClone(initial.plan.nodes.find(n=>n.id==='idea-first-scene').body);body.document.doc.content[0].content=[body.document.doc.content[0].content[0]];body.document.doc.content[0].content[0].attrs.run.data={schemaVersion:1,kind:'idea-reference',projectId:compiled.projectId,blockId:'canonical-idea-paul'};
 let plan={...initial.plan,entryKind:'idea',scope,sourceText:'Paul',nodes:[{id:'new',projectId:compiled.projectId,kind:'idea',title:'Paul reference',body,type:'subject',subtype:'Human presence',revision:1,disposition:'retained',sourceEvidence:[{kind:'span',start:0,end:4,quote:'Paul'}]}],uses:[],coverage:[{start:0,end:4,nodeIds:['new']}]};plan=refreshCreationDependencyBindings(plan,authority);
 const review=await approve(plan),result=await compileCreationPlan(plan,authority,review);assert.equal(ideaBodyReferences(result.events[0].payload.properties.rich_text_body)[0].blockId,'canonical-idea-paul');
 authority.existingVersions[0].hash='changed';assert.ok((await validateCreationPlan(plan,authority,review)).issues.some(i=>i.code==='invalid_evidence'||i.code==='unbound_dependency'));
 authority.selectedRootIds=[];assert.ok((await validateCreationPlan(plan,authority,review)).issues.some(i=>i.code==='reference_denied'));
});
test('title-only Idea cannot pass by copying its title into a body without explicit completion',async()=>{
 const {plan,authority}=example();plan.entryKind='idea';plan.scope.projectId='existing-project';authority.projectId='existing-project';authority.canAuthorProject=true;plan.sourceText='Paul';plan.nodes=[{...plan.nodes.find(n=>n.id==='idea-paul'),projectId:'existing-project',sourceEvidence:[{kind:'span',start:0,end:4,quote:'Paul'}]}];plan.uses=[];plan.coverage=[{start:0,end:4,nodeIds:['idea-paul']}];
 assert.ok((await validateCreationPlan(plan,authority,undefined,{requireReview:false})).issues.some(i=>i.code==='title_body_requires_completion'));
 plan.decisions=[{id:'user-completion',kind:'correction',nodeIds:['idea-paul'],revision:1,accepted:true}];plan.nodes[0].sourceEvidence.push({kind:'correction',decisionId:'user-completion'});
 assert.equal((await validateCreationPlan(plan,authority,await approve(plan))).issues.length,0);
});
test('a removed Document use requires an explicit accepted correction',async()=>{
 const {plan,authority}=example();const use=plan.uses[0];use.disposition='removed';let result=await validateCreationPlan(plan,authority,undefined,{requireReview:false});assert.ok(result.issues.some(i=>i.code==='unconfirmed_disposition'&&i.useId===use.id));
 plan.decisions.push({id:'remove-use',kind:'remove',nodeIds:[use.id],revision:1,accepted:true});result=await validateCreationPlan(plan,authority,undefined,{requireReview:false});assert.ok(!result.issues.some(i=>i.code==='unconfirmed_disposition'));
});
test('reuse-only attachment preserves identity; already attached explicit root is a reviewed no-change',async()=>{
 const initial=example(),base=await compileCreationPlan(initial.plan,initial.authority,await approve(initial.plan));
 const projection=foldEvents(events(base.events),Infinity,'canonical-doc-window',base.projectId);
 const scope={actorUserId:'author',projectId:base.projectId,documentId:'canonical-doc-window',custodyKey:'personal:author',permissionEpoch:1};
 const authority=await authorityFromCreationProjection(scope,'idea',projection,{canCreateProject:false,canAuthorProject:true,selectedRootIds:['canonical-idea-microphone']});
 let plan={...initial.plan,entryKind:'idea',scope,sourceText:'Microphone',nodes:[],uses:[{id:'reuse',documentId:scope.documentId,ideaId:'canonical-idea-microphone',order:0,revision:1,disposition:'retained',dependencyManifest:[]}],references:[],coverage:[{start:0,end:10,nodeIds:['canonical-idea-microphone']}],compiledEventBound:1};
 plan=refreshCreationDependencyBindings(plan,authority);
 const review=await approve(plan),compiled=await compileCreationPlan(plan,authority,review);
 assert.equal(compiled.status,'ready');assert.deepEqual(compiled.events.map(e=>e.type),['BlockDocumentAttached']);assert.deepEqual(compiled.changedUses,[{documentId:scope.documentId,ideaId:'canonical-idea-microphone'}]);assert.deepEqual(compiled.idMap,{});
 const attached=foldEvents(events([...base.events,...compiled.events]),Infinity,scope.documentId,base.projectId);
 const current=await authorityFromCreationProjection(scope,'idea',attached,{canCreateProject:false,canAuthorProject:true,selectedRootIds:['canonical-idea-microphone']});
 plan=refreshCreationDependencyBindings(plan,current);plan.compiledEventBound=0;
 const incomplete=await validateCreationPlan(plan,current,undefined);assert.ok(incomplete.issues.some(i=>i.code==='review_required'));
 const result=await compileCreationPlan(plan,current,await approve(plan));assert.equal(result.status,'no-change');assert.deepEqual(result.events,[]);assert.deepEqual(result.changedUses,[]);assert.equal(result.primaryDocumentId,scope.documentId);
});
