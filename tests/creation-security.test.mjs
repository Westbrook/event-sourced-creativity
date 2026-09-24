import assert from 'node:assert/strict';
import test from 'node:test';
import { creationReviewHashes, validateCreationPlan, compileCreationPlan } from '../src/model/creation-validation.ts';
import { plainTextIdeaBody, ideaBodyReferences } from '../src/model/idea-body.ts';
import { authorityFromCreationProjection } from '../worker/creation-authority.ts';

// Deterministic adversarial contract tests; no provider or live authority claims.
const evidence = [{kind:'span',start:0,end:4,quote:'Paul'}];
function fixture() {
 const scope={actorUserId:'actor',custodyKey:'personal:actor',permissionEpoch:'epoch',projectId:'project',documentId:null};
 const plan={schemaVersion:1,draftId:'draft',draftRevision:1,entryKind:'idea',scope,sourceText:'Paul',nodes:['first','second'].map(id=>({id,kind:'idea',projectId:'project',title:'Paul',revision:1,disposition:'retained',sourceEvidence:structuredClone(evidence),body:plainTextIdeaBody('Paul'),text:'Paul',type:'subject',subtype:'Human presence'})),uses:[],references:[],issues:[],coverage:[{start:0,end:4,nodeIds:['first','second']}],decisions:[],modelVersion:'manual',compiledEventBound:512};
 const authority={...scope,canCreateProject:false,canAuthorProject:true,documentIds:[],existingBlocks:[],existingRelations:[],existingVersions:[],allocatedIds:{first:'canonical-first',second:'canonical-second',relation:'canonical-relation',duplicate:'canonical-duplicate'},occupiedIds:['project']};
 return {plan,authority};
}
async function approve(plan){const hashes=await creationReviewHashes(plan);return{schemaVersion:1,nodes:Object.fromEntries(Object.entries(hashes.nodeHashes).map(([id,hash])=>[id,{complete:true,presentedHash:hash,approvedHash:hash}])),uses:Object.fromEntries(Object.entries(hashes.useHashes).map(([id,hash])=>[id,{complete:true,presentedHash:hash,approvedHash:hash}])),stage:'final',lastAcknowledgedRevision:1,finalApprovalHash:hashes.approvalHash};}

test('creation approval binds exact semantic relationship graph, including occurrence identities',async()=>{
 const {plan}=fixture();plan.references=[{id:'relation',fromId:'first',toId:'second',kind:'semantic',sourceEvidence:evidence}];
 const original=await creationReviewHashes(plan);
 const changed=structuredClone(plan);changed.references[0].id='different-relationship';
 assert.notEqual((await creationReviewHashes(changed)).approvalHash,original.approvalHash);
 const duplicate=structuredClone(plan);duplicate.references.push({...duplicate.references[0],id:'duplicate'});
 assert.notEqual((await creationReviewHashes(duplicate)).approvalHash,original.approvalHash);
});

test('creation current approval cannot survive body changes or actor/custody/permission changes',async()=>{
 const {plan,authority}=fixture();const review=await approve(plan);
 assert.equal((await validateCreationPlan(plan,authority,review)).issues.length,0);
 for(const key of ['actorUserId','custodyKey','permissionEpoch']){
  const changed=structuredClone(plan);changed.scope[key]='other';
  assert.ok((await validateCreationPlan(changed,authority,review)).issues.some(i=>i.code==='authority_changed'));
 }
 plan.nodes[0].body=plainTextIdeaBody('Jon');plan.nodes[0].text='Jon';
 assert.ok((await validateCreationPlan(plan,authority,review)).issues.some(i=>i.code==='node_not_approved'));
});

test('creation prospective root requires personal creation capability and no shared selection',async()=>{
 const scope={actorUserId:'actor',custodyKey:'personal:actor',permissionEpoch:'epoch',projectId:null,documentId:null};
 const projection={projects:[],documents:[],libraryBlocks:[],libraryBlockRelations:[]};
 for(const options of [{canCreateProject:false,canAuthorProject:true},{canCreateProject:true,canAuthorProject:true,selectedSharedProjectId:'shared'}])await assert.rejects(authorityFromCreationProjection(scope,'project',projection,options),/creation_prospective_project_denied/);
 assert.equal((await authorityFromCreationProjection(scope,'project',projection,{canCreateProject:true,canAuthorProject:false})).canCreateProject,true);
});

test('creation decoder rejects malformed members without throwing an unhandled TypeError',async()=>{
 for(const field of ['nodes','uses','references','coverage','decisions','issues']){
  const {plan,authority}=fixture();plan[field]=[null];
  const result=await validateCreationPlan(plan,authority,undefined,{requireReview:false});
  assert.ok(result.issues.length,field+' must reject malformed member');
 }
});

test('creation mixed new/existing references preserve canonical shared identity',async()=>{
 const {plan,authority}=fixture();plan.nodes=plan.nodes.slice(0,1);plan.coverage[0].nodeIds=['first'];
 const version={id:'existing',projectId:'project',revision:'source-event',hash:'current-source-hash'};
 authority.existingVersions=[version];authority.existingBlocks=[{id:'existing',projectId:'project',documentId:'',scope:'library',type:'subject',handle:'Paul',position:'a',properties:{text:'Paul',subtype:'Human presence'},sourceEvents:['source-event'],removed:false}];
 authority.occupiedIds.push('existing');authority.selectedRootIds=['existing'];
 plan.nodes[0].sourceEvidence.push({kind:'existing',blockId:version.id,projectId:version.projectId,revision:version.revision,hash:version.hash});
 plan.nodes[0].body={schemaVersion:1,document:{type:'en-rich-text',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'token',attrs:{run:{kind:'token',id:'occurrence',type:'still-idea-reference',text:'Paul',label:'Paul',data:{schemaVersion:1,kind:'idea-reference',projectId:'project',blockId:'existing'}}}}]}]}}};
 const compiled=await compileCreationPlan(plan,authority,await approve(plan));
 const body=compiled.events.find(event=>event.type==='BlockCreated').payload.properties.rich_text_body;
 assert.equal(ideaBodyReferences(body)[0].blockId,'existing');
});
