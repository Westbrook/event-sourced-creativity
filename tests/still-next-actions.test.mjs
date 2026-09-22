import test from 'node:test';
import assert from 'node:assert/strict';
import { foldEvents } from '../src/model/events.ts';
import { ACTIONS, eligibleActions, questionsFor } from '../src/still/decisions.ts';
import { destinationsFor, useInPlan } from '../src/still/use-in.ts';
import { compositionIndex, connectionEvidence, refineMenu, shouldEnrich } from '../src/still/assessments.ts';
import { explicitAction, finderEntry, findActions } from '../src/still/finder.ts';
import { presentActions } from '../src/still/presentation.ts';

const event=(type,payload,sequence)=>({eventId:`e${sequence}`,streamId:'creative:test',sequence,type,payload,actor:'user',clientId:'web:test',correlationId:'fixture',occurredAt:'2026-09-17T12:00:00Z',recordedAt:'2026-09-17T12:00:00Z',schemaVersion:1});
const position={projectId:'p',documentId:'d',blockId:'cap',outputId:'',view:'document',intent:'',recentActions:[]};
const abilities={author:true,generate:true,projectCreate:true,formats:['image','model3d','short_story']};
function fixture(){const rows=[['ProjectCreated',{project_id:'p',name:'Objects'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'Ballcap'}],['DocumentCreated',{project_id:'p',document_id:'other',title:'Character'}],['ProjectCreated',{project_id:'other-project',name:'Another project'}],['DocumentCreated',{project_id:'other-project',document_id:'cross',title:'New setting'}]];
  for(const [id,doc,type,text]of [['cap','d','subject','A Spurs baseball cap.'],['brim','d','direction','The brim points right.'],['person','d','subject','A person wearing a cap.'],['existing','d','style','Leave this alone.'],['other-person','other','subject','Mara wears a cap.']])rows.push(['BlockCreated',{project_id:'p',document_id:doc,scope:'document',block_id:id,type,handle:id,position:id,properties:{text,weight:.8}}]);
  rows.push(['BlockRelationAdded',{project_id:'p',document_id:'d',relation_id:'cap-brim',from_block_id:'cap',to_block_id:'brim',kind:'context_contains',properties:{member_order:0}}],['BlockRelationAdded',{project_id:'p',document_id:'d',relation_id:'person-existing',from_block_id:'person',to_block_id:'existing',kind:'context_contains',properties:{member_order:0}}],['BlockLocked',{block_id:'existing'}]);return rows.map(([t,p],i)=>event(t,p,i+1));}
function apply(events,plan){return [...events,...plan.events.map((e,i)=>event(e.type,e.payload,events.length+i+1))];}
const score=(value=3,confidence=.9)=>({type:'score',score:value,confidence,probabilities:{0:0,1:0,2:3-value,3:value-2}});

test('finder exposes explicit 3D and use-in while uncertain queries keep the catalog',()=>{
  const candidates=eligibleActions(foldEvents(fixture(),Infinity,'d','p'),position,abilities);
  assert.equal(explicitAction('make this 3D',candidates),'model3d');assert.equal(explicitAction('add this to a character',candidates),'use-in');
  for(const query of ['an image or a 3D model','show version history','rename this image','do not make this 3D'])assert.equal(explicitAction(query,candidates),'');
  assert.ok(findActions('unexpected unclear wording',candidates).some(a=>a.id==='model3d'));
  for(const id of ['lock','unlock','toggle-context'])assert.equal(finderEntry(id),'context');assert.equal(finderEntry('export'),'view-result');
  assert.ok(!eligibleActions(foldEvents(fixture(),Infinity,'d','p'),position,{...abilities,author:false}).some(a=>a.id==='use-in'));
});
test('use-in adds destination-to-source without replacing any member, including locked ones',()=>{
  const events=fixture(),plan=useInPlan(events,position,'cap','block:person');
  assert.equal(plan.mode,'link');assert.equal(plan.copies.length,0);assert.ok(!plan.events.some(e=>e.type==='BlockRelationRemoved'));
  const result=foldEvents(apply(events,plan),Infinity,'d','p');
  assert.ok(result.blockRelations.some(r=>r.fromBlockId==='person'&&r.toBlockId==='cap'&&!r.removed));
  assert.ok(result.blockRelations.some(r=>r.id==='person-existing'&&!r.removed));assert.equal(result.blocks.find(b=>b.id==='existing').locked,true);
  assert.throws(()=>useInPlan(apply(events,plan),position,'cap','block:person'));
  assert.throws(()=>useInPlan(events,position,'cap','block:brim'),/unavailable/i);
});
test('cross-document copies preserve complete nested ideas and remap relationships',()=>{
  const events=fixture(),plan=useInPlan(events,position,'cap','block:other-person');assert.equal(plan.mode,'copy');assert.equal(plan.copies.length,2);
  const result=foldEvents(apply(events,plan),Infinity,'other','p'),root=result.blocks.find(b=>b.id===plan.rootId),child=result.blocks.find(b=>b.properties.copied_from_block_id==='brim');
  assert.equal(root.properties.copied_from_block_id,'cap');assert.ok(child);
  assert.ok(result.blockRelations.some(r=>r.fromBlockId===root.id&&r.toBlockId===child.id));assert.ok(result.blockRelations.some(r=>r.fromBlockId==='other-person'&&r.toBlockId===root.id));
  assert.equal(foldEvents(apply(events,plan),Infinity,'d','p').blocks.find(b=>b.id==='cap').properties.text,'A Spurs baseball cap.');
});
test('document destinations copy into the exact personal project and protected dependencies reject the whole plan',()=>{
  const events=fixture(),plan=useInPlan(events,position,'cap','document:cross');
  assert.ok(plan.events.every(e=>e.payload.project_id==='other-project'&&e.payload.document_id==='cross'));
  assert.equal(foldEvents(apply(events,plan),Infinity,'cross','other-project').blocks.length,2);
  assert.ok(!destinationsFor(events,position).some(d=>d.id==='block:brim'));assert.ok(destinationsFor(events,{...position,blockId:'brim'}).some(d=>d.id==='block:person'));
  const locked=[...events,event('BlockLocked',{block_id:'brim'},events.length+1)];assert.throws(()=>useInPlan(locked,position,'cap','document:cross'),/related idea/i);
  assert.throws(()=>useInPlan(events,position,'cap','document:unknown'),/unavailable/i);
});
test('four compositions own each question once, and finder choices only name eligible actions',()=>{
  const candidates=eligibleActions(foldEvents(fixture(),Infinity,'d','p'),position,abilities),questions=questionsFor(candidates,position),index=compositionIndex(questions),ids=index.flatMap(c=>c.questions);
  assert.equal(index.length,4);assert.equal(new Set(ids).size,ids.length);assert.deepEqual([...ids].sort(),Object.keys(questions).sort());
  const finder=questionsFor(candidates,{...position,view:'find-action'});assert.deepEqual(Object.keys(finder.action.criteria).sort(),['none',...candidates.map(a=>a.id)].sort());
});
test('connection enrichment supplies fuller named evidence without changing the authorized destination set',()=>{
  const events=fixture(),evidence=connectionEvidence(events,position),all=new Set(destinationsFor(events,position).map(d=>d.id));
  assert.ok(evidence.destinations.length<=6);assert.ok(evidence.destinations.every(d=>all.has(d.id)));assert.ok(evidence.details.some(d=>d.text&&d.versions.length));
  assert.equal(shouldEnrich(position,{'use_use-in':score()},evidence.destinations.length),true);
  for(const pos of [{...position,blockId:''},{...position,view:'choose-format'},{...position,view:'find-action'}])assert.equal(shouldEnrich(pos,{'use_use-in':score()},4),false);
  assert.equal(shouldEnrich(position,{'use_use-in':score(3,.1)},4),false);
});
test('a concrete connection can replace a redundant action while failed or conflicting evidence cannot',()=>{
  const get=id=>ACTIONS.find(a=>a.id===id),selected=['edit-block','rename','compose','add-context'].map(get),candidates=[...selected,get('use-in')],first={'use_use-in':score()},destinations=[{id:'block:person',label:'person'}];
  const second={target_0:score(),conflict_0:{type:'noul',noul:0}};
  const refined=refineMenu(selected,candidates,first,second,destinations,'connections');assert.equal(refined.actions.length,4);assert.equal(refined.target.id,'block:person');assert.ok(refined.adjustments[0].questions.includes('target_0'));assert.deepEqual(refined.adjustments[0].evidence.find(e=>e.questionId==='use_use-in'),{passId:'assessment',questionId:'use_use-in'});assert.equal(refined.adjustments[0].evidence.find(e=>e.questionId==='target_0').passId,'connections');
  assert.deepEqual(refineMenu(selected,candidates,first,{},destinations,'connections').actions,selected);
  assert.equal(refineMenu(selected,candidates,first,{...second,conflict_0:{type:'noul',noul:.8}},destinations,'connections').target,undefined);
});
test('only a useful clear leader with valid probability evidence receives emphasis',()=>{
  const ids=['a','b'];assert.equal(presentActions(ids,{use_a:score(3),use_b:score(2)})['a'].variant,'primary');
  for(const answers of [{},{use_a:score(),use_b:score()},{use_a:score(3,.2),use_b:score(2)},{use_a:{type:'score',score:3,confidence:1},use_b:score(2)},{use_a:{...score(),probabilities:{0:0,1:0,2:0,3:2}},use_b:score(2)}])assert.ok(Object.values(presentActions(ids,answers)).every(x=>x.variant==='secondary'&&x.size==='medium'));
  assert.equal(presentActions(['a'],{use_a:score()}).a.size,'large');
});


test('idea creation is one Jev candidate',()=>{
  const p=foldEvents(fixture(),Infinity,'d','p');
  const candidates=eligibleActions(p,position,abilities);
  assert.ok(candidates.some(a=>a.id==='add-context'));
  assert.ok(!ACTIONS.some(a=>a.id==='surprise'));
  const questions=questionsFor(candidates,position,p);
  assert.ok(questions['use_add-context']);
  assert.ok(!questions.use_surprise&&!questions.novel_surprise);
  assert.ok(!Object.hasOwn(questions.next_best_action.criteria,'surprise'));
  assert.ok(Object.hasOwn(questions.next_best_action.criteria,'add-context'));
});
