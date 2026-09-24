import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCreationInput} from '../src/still/creation-input.ts';
import {compileCreationPlan,exactTitleOnlyPlan,validateCreationPlan} from '../src/model/creation-validation.ts';

function titlePlan(sourceText){
 const scope={actorUserId:'author',projectId:null,documentId:null,custodyKey:'personal:author',permissionEpoch:1};
 const plan={schemaVersion:1,draftId:'title-draft',draftRevision:1,entryKind:'project',scope,sourceText,nodes:[{id:'root',projectId:'root',kind:'project',title:sourceText,revision:1,disposition:'retained',sourceEvidence:[{kind:'span',start:0,end:sourceText.length,quote:sourceText}]}],uses:[],references:[],issues:[],coverage:[{start:0,end:sourceText.length,nodeIds:['root']}],decisions:[],modelVersion:'deterministic-title-v1',compiledEventBound:1,titleOnly:true};
 const authority={...scope,canCreateProject:true,canAuthorProject:false,documentIds:[],existingBlocks:[],existingRelations:[],existingVersions:[],allocatedIds:{root:'canonical-root'},occupiedIds:[],selectedRootIds:[]};
 return {plan,authority};
}

test('unpunctuated authored clauses never enter the automatic empty-container path',async()=>{
 for(const text of ['A man walks into a room','Mara waits beside a closed door','A Man Walks Into A Room','Mara Waits Beside A Closed Door','Mara balances a cup','The lantern flickers softly','Two children dance together','The door creaks open','Elena sketches an empty doorway']){
  assert.equal(classifyCreationInput(text),'description',text);
  const {plan,authority}=titlePlan(text);assert.equal(exactTitleOnlyPlan(plan),false,text);
  const validation=await validateCreationPlan(plan,authority);assert.ok(validation.issues.some(issue=>issue.code==='review_required'),text);
  await assert.rejects(()=>compileCreationPlan(plan,authority),/Present and approve/,text);
 }
});

test('clear names retain exact no-model title compilation without a word-count threshold',async()=>{
 for(const title of ['The White Album','September Notebook','September notebook','  Recording the White Album  ','My new project','The Complete Annual Archive of Summer Research Notes']){
  assert.equal(classifyCreationInput(title),'title',title);
  const {plan,authority}=titlePlan(title);assert.equal(exactTitleOnlyPlan(plan),true);
  const compiled=await compileCreationPlan(plan,authority);assert.deepEqual(compiled.events,[{type:'ProjectCreated',payload:{project_id:'canonical-root',name:title,state:'active'}}]);
 }
});

test('explicit Treat as title reverses ambiguity while retaining marker and graph restrictions',async()=>{
 const {plan,authority}=titlePlan('Mara waits beside a closed door');
 plan.decisions.push({id:'classification',kind:'correction',nodeIds:['root'],revision:1,accepted:true,detail:'explicit-title-classification'});
 assert.equal(classifyCreationInput(plan.sourceText),'description');assert.equal(exactTitleOnlyPlan(plan),true);
 assert.equal((await compileCreationPlan(plan,authority)).events[0].payload.name,plan.sourceText);
 for(const sourceText of ['Mara /image','Mara @Jon']){const marked=titlePlan(sourceText).plan;marked.decisions=plan.decisions;assert.equal(exactTitleOnlyPlan(marked),false);}
 plan.nodes[0].title='Changed title';assert.equal(exactTitleOnlyPlan(plan),false,'the shortcut cannot change the supplied title');
});
